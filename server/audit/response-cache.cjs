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
//   - Yanit basligi X-Portal-Cache: HIT | MISS | BYPASS | SKIP-SIZE (log/teshis icin).
//   - Sinir: en fazla MAX_ENTRIES giris; dolunca en eski atilir. Cok buyuk govdeler
//     (> MAX_BODY_BYTES) onbellege alinmaz - baslik SKIP-SIZE olur ve bir kez loglanir.
'use strict';

const DEFAULT_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 64;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function createResponseCache({ ttlMs = DEFAULT_TTL_MS, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  const store = new Map(); // key -> { at, body }
  // SINIR ASIMI SESSIZ DEGIL (2026-10-01, Gercek SPA Kesfi dogrulama bulgusu): govde siniri
  // asinca onbellek hicbir sey saklamiyor, baslik yine 'MISS' diyordu - her acilis tum
  // sorgulari yeniden kosturuyor ve kimse bilmiyordu. Simdi baslik 'SKIP-SIZE' olur ve
  // anahtar basina BIR KEZ uyari loglanir.
  const uyarildi = new Set();

  function middleware(req, res, next) {
    if (req.method !== 'GET') return next();
    const fresh = String(req.query.fresh || '') === '1';
    const key = req.originalUrl.replace(/([?&])fresh=1&?/, '$1').replace(/[?&]$/, '');
    const hit = store.get(key);
    if (!fresh && hit && Date.now() - hit.at < ttlMs) {
      res.setHeader('X-Portal-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).send(hit.body);
    }
    res.setHeader('X-Portal-Cache', fresh ? 'BYPASS' : 'MISS');
    const origJson = res.json.bind(res);
    res.json = (payload) => {
      try {
        if (res.statusCode === 200 && payload && payload.ok !== false) {
          const body = JSON.stringify(payload);
          if (body.length <= maxBodyBytes) {
            if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
            store.set(key, { at: Date.now(), body });
          } else {
            res.setHeader('X-Portal-Cache', 'SKIP-SIZE');
            if (!uyarildi.has(key)) {
              if (uyarildi.size >= MAX_ENTRIES) uyarildi.clear();
              uyarildi.add(key);
              console.warn(
                `[response-cache] ${key}: govde ${body.length} > ${maxBodyBytes} karakter - onbellege ALINMADI (her istek yeniden hesaplanir)`,
              );
            }
          }
        }
      } catch {
        /* onbellek hatasi yaniti etkilemez */
      }
      return origJson(payload);
    };
    next();
  }

  return { middleware, store, clear: () => store.clear() };
}

module.exports = { createResponseCache, DEFAULT_TTL_MS, MAX_BODY_BYTES };
