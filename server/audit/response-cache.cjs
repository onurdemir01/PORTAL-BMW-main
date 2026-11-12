// server/audit/response-cache.cjs - Denetim GET uclari icin bellek-ici yanit onbellegi.
//
// NEDEN (2026-09-15, kullanici: "Denetim sayfalari yavas"): her sekme acilisi 5-7 buyuk
// MSSQL sorgusu kosturuyordu (kapsam ucu tek basina ~900 ms, on binlerce satir). Veri
// gunde bir (job) degisir; 60 sn'lik onbellek ayni sayfayi ard arda acan/gezinen
// kullanicilar icin sorguyu SIFIRLAR, tazeligi ise pratikte bozmaz.
//
// KURALLAR
//   - Yalniz GET, yalniz 200 + JSON. Anahtar: yol + sorgu dizesi (kullaniciya gore DEGIL:
//     bu uclar kullaniciya ozel veri donmez; gorunurluk kapisi router'da onbellekten once).
//   - ?fresh=1 onbellegi ATLAR ve yeniler ("Yenile" dugmesi bunu gonderir).
//   - Yanit basligi X-Portal-Cache: HIT | MISS | BYPASS | SKIP-SIZE | SHARED | STALE.
//   - Sinir: en fazla MAX_ENTRIES giris; dolunca en eski atilir. Cok buyuk govdeler
//     (> MAX_BODY_BYTES) onbellege alinmaz - baslik SKIP-SIZE olur ve bir kez loglanir.
//
// TEK UCUS + BAYAT-IKEN-YENILE (2026-11-12): TTL dolduktan sonraki ilk istek ~1 sn+ yeniden
// hesap bekliyordu, ayni anda gelen kacirmalar da HER BIRI ayri hesap kosturuyordu.
//   - Tek ucus: ayni anahtar icin hesap surerken gelen (fresh olmayan) istekler handler'i
//     KOSTURMAZ; ilk hesabin yakalanan govdesini alir (baslik SHARED). Ilk hesap 200 + ok
//     disinda biterse (hata, ok:false, json'suz kapanis, zaman asimi) bekleyenler handler'i
//     KENDILERI kosturur - hata yaniti paylasilmaz (gecici hata herkese yayilmasin).
//   - Bayat-iken-yenile: giris TTL'den sonra staleMs boyunca tutulur. Bayat girise gelen
//     istek bayat govdeyi HEMEN alir (baslik STALE) ve AYNI istegin handler zinciri yanit
//     gonderildikten SONRA arka planda kosturulur; cikti yalniz onbellege yazilir.
//     NEDEN SENTETIK req/res DEGIL: Express'in next()'i ozgun req/res'e baglidir, middleware
//     icinden route handler'i baska nesneyle yeniden kosturmanin yolu yok. Ozgun istek
//     kullanildigi icin req.user / oturum / sorgu birebir aynidir (gorunurluk kapisi zaten
//     onbellekten ONCE gecildi). Yanit gonderildikten sonra res.json yakalanir (yazmaz),
//     res.send / res.setHeader yutulur (headers-sent hatasi olmaz). Anahtar basina tek yenileme.
//   - clear(): girisleri siler, kusagi arttirir; eski kusaktan donen hesap onbellege YAZILMAZ,
//     clear oncesi bekleyenler handler'i kendileri kosturur (yazma sonrasi eski veri paylasilmaz).
//   - Bir hesap inflightMaxMs (varsayilan 2 dk) icinde bitmezse ucus birakilir, bekleyenler
//     kendi hesabini kosturur (asili handler herkesi asmasin).
//   - staleMs: RESPONSE_CACHE_STALE_MS ortam degiskeni (varsayilan 10 dk); 0 = kapali.
'use strict';

const DEFAULT_TTL_MS = 60 * 1000;
const DEFAULT_STALE_MS = 10 * 60 * 1000;
const DEFAULT_INFLIGHT_MAX_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 64;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function envStaleMs() {
  const raw = process.env.RESPONSE_CACHE_STALE_MS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_STALE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STALE_MS;
}

function createResponseCache({
  ttlMs = DEFAULT_TTL_MS,
  maxBodyBytes = MAX_BODY_BYTES,
  staleMs = envStaleMs(),
  inflightMaxMs = DEFAULT_INFLIGHT_MAX_MS,
} = {}) {
  const store = new Map(); // key -> { at, body }
  const inflight = new Map(); // key -> { gen, waiters: [fn], timer, done }
  let gen = 0;
  // SINIR ASIMI SESSIZ DEGIL (2026-10-01, Gercek SPA Kesfi dogrulama bulgusu): govde siniri
  // asinca onbellek hicbir sey saklamiyor, baslik yine 'MISS' diyordu - her acilis tum
  // sorgulari yeniden kosturuyor ve kimse bilmiyordu. Simdi baslik 'SKIP-SIZE' olur ve
  // anahtar basina BIR KEZ uyari loglanir.
  const uyarildi = new Set();

  function sendBody(res, tag, body) {
    res.setHeader('X-Portal-Cache', tag);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(body);
  }

  // Yakalanan govde onbellege girer mi? Girerse { body } doner; paylasilabilir (200 + ok) ise
  // body her durumda doner, saklandi mi ayrica belirtilir.
  function captureResult(key, myGen, res, payload) {
    if (!(res.statusCode === 200 && payload && payload.ok !== false)) return null;
    const body = JSON.stringify(payload);
    let stored = false;
    if (body.length <= maxBodyBytes) {
      if (myGen === gen) {
        store.delete(key);
        if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
        store.set(key, { at: Date.now(), body });
        stored = true;
      }
    } else {
      if (!uyarildi.has(key)) {
        if (uyarildi.size >= MAX_ENTRIES) uyarildi.clear();
        uyarildi.add(key);
        console.warn(
          `[response-cache] ${key}: govde ${body.length} > ${maxBodyBytes} karakter - onbellege ALINMADI (her istek yeniden hesaplanir)`,
        );
      }
    }
    return { body, stored, tooBig: body.length > maxBodyBytes };
  }

  // Ucus baslatir; settle(result|null) bekleyenleri bir kez serbest birakir.
  function openFlight(key) {
    const fl = { gen, waiters: [], timer: null, done: false };
    fl.timer = setTimeout(() => settle(key, fl, null), inflightMaxMs);
    if (fl.timer && typeof fl.timer.unref === 'function') fl.timer.unref();
    inflight.set(key, fl);
    return fl;
  }

  function settle(key, fl, result) {
    if (!fl || fl.done) return;
    fl.done = true;
    clearTimeout(fl.timer);
    if (inflight.get(key) === fl) inflight.delete(key);
    const ws = fl.waiters.splice(0);
    for (const w of ws) {
      try {
        w(result);
      } catch {
        /* bir bekleyenin hatasi digerlerini etkilemez */
      }
    }
  }

  // Normal (yaniti istemciye giden) yakalama. fl verilirse sonuc bekleyenlere dagitilir.
  function runCapturing(key, req, res, next, fl) {
    const myGen = fl ? fl.gen : gen;
    const origJson = res.json.bind(res);
    res.json = (payload) => {
      let result = null;
      try {
        result = captureResult(key, myGen, res, payload);
        if (result && result.tooBig) res.setHeader('X-Portal-Cache', 'SKIP-SIZE');
      } catch {
        result = null; /* onbellek hatasi yaniti etkilemez */
      }
      if (fl) settle(key, fl, result && myGen === gen ? result : null);
      return origJson(payload);
    };
    if (fl && typeof res.once === 'function') {
      // json'suz kapanis (send/end, next(err), istemci koptu): bekleyenler kendi hesabini yapar.
      res.once('close', () => settle(key, fl, null));
    }
    next();
  }

  // Bayat yanit gonderildikten SONRA ayni istegin handler zincirini arka planda kosturur.
  function runBackgroundRefresh(key, res, next) {
    const fl = openFlight(key);
    const myGen = fl.gen;
    res.json = (payload) => {
      let result = null;
      try {
        result = captureResult(key, myGen, res, payload);
        if (!result) {
          console.warn(
            `[response-cache] ${key}: arka plan yenileme basarisiz (HTTP ${res.statusCode}) - bayat giris korunur`,
          );
        }
      } catch {
        result = null;
      }
      settle(key, fl, result && myGen === gen ? result : null);
      return res;
    };
    res.send = () => res;
    res.setHeader = () => res;
    try {
      next();
    } catch {
      settle(key, fl, null);
    }
  }

  function middleware(req, res, next) {
    if (req.method !== 'GET') return next();
    const fresh = String((req.query && req.query.fresh) || '') === '1';
    const key = req.originalUrl.replace(/([?&])fresh=1&?/, '$1').replace(/[?&]$/, '');
    const now = Date.now();
    let hit = store.get(key);
    if (hit && now - hit.at >= ttlMs + Math.max(0, staleMs)) {
      store.delete(key);
      hit = null;
    }
    if (!fresh && hit) {
      if (now - hit.at < ttlMs) return sendBody(res, 'HIT', hit.body);
      // Bayat: hemen yanitla; yenileme yoksa bu istek arka planda yeniler.
      sendBody(res, 'STALE', hit.body);
      if (!inflight.has(key)) runBackgroundRefresh(key, res, next);
      return undefined;
    }
    if (!fresh) {
      const fl = inflight.get(key);
      if (fl) {
        fl.waiters.push((result) => {
          if (result) return sendBody(res, 'SHARED', result.body);
          res.setHeader('X-Portal-Cache', 'MISS');
          return runCapturing(key, req, res, next, null);
        });
        return undefined;
      }
    }
    res.setHeader('X-Portal-Cache', fresh ? 'BYPASS' : 'MISS');
    const fl = inflight.has(key) ? null : openFlight(key);
    return runCapturing(key, req, res, next, fl);
  }

  function clear() {
    gen += 1;
    store.clear();
    const flights = [...inflight.entries()];
    inflight.clear();
    for (const [key, fl] of flights) settle(key, fl, null);
  }

  return { middleware, store, inflight, clear };
}

module.exports = { createResponseCache, DEFAULT_TTL_MS, DEFAULT_STALE_MS, MAX_BODY_BYTES };
