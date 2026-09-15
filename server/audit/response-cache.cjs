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
//   - Yanit basligi X-Portal-Cache: HIT | MISS | BYPASS (log/teshis icin).
//   - Sinir: en fazla MAX_ENTRIES giris; dolunca en eski atilir. Cok buyuk govdeler
//     (> MAX_BODY_BYTES) onbellege alinmaz.
'use strict';

const DEFAULT_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 64;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function createResponseCache({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const store = new Map(); // key -> { at, body }

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
          if (body.length <= MAX_BODY_BYTES) {
            if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
            store.set(key, { at: Date.now(), body });
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

module.exports = { createResponseCache, DEFAULT_TTL_MS };
