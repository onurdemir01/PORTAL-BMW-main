// server/util/nginx-red.cjs — NGINX'IN YAKALADIGI REDLER KULLANICIYA ULASSIN (2026-10-23).
//
// Kurumsal nginx `proxy_intercept_errors` + `error_page 403 404 500 502 503 504` ile bu kodlu
// yanitlarin GOVDESINI kendi HTML sayfasiyla degistiriyor (bkz. oco/client.cjs `httpStatus`).
// Bir modulun bilerek verdigi ret ("bu namespace icin yetkiniz yok; su gruba basvurun",
// "playbook kaydi tanimli degil") ekrana HIC ulasmiyor; istemci yalnizca bir HTML govdesi gorur.
//
// Bu ara katman bir yonlendiricinin ILK katmani olarak baglanir ve `ok: false` tasiyan JSON
// redlerini nginx'in dokunmadigi koda cevirir. Asil kod `upstreamStatus`ta, tur `code`da kalir
// (cagiranin kendi `code`u varsa korunur); mesaj ve diger alanlar aynen.
//
//   403 -> 409  `<onek>_forbidden`      (her yontem)
//   404 -> 409  `<onek>_not_found`      (her yontem)
//   eylem5xx acikken, YALNIZ GET/HEAD DISI isteklerde:
//   501 -> 409  `<onek>_not_configured`
//   502 / 503 / 504 -> 424  `<onek>_upstream_unavailable`
//
// DEGISMEYENLER: 401 (oturum bekcisi ona bakar), 500 (beklenmeyen hata; genel mesaj dogru),
// GET'teki 5xx (yoklayicilar gecici hatayi yeniden dener), `ok: false` tasimayan ya da JSON
// olmayan govde.
'use strict';

const YAKALANAN_5XX = new Set([502, 503, 504]);

function nginxRedCevirici({ onek, eylem5xx = false }) {
  const kodlar = { 403: `${onek}_forbidden`, 404: `${onek}_not_found` };
  return function nginxRedCeviriciMw(req, res, next) {
    const asilJson = res.json.bind(res);
    res.json = (body) => {
      if (!body || typeof body !== 'object' || body.ok !== false) return asilJson(body);
      const asil = res.statusCode;
      let yeni = null;
      let kod = null;
      if (kodlar[asil]) {
        yeni = 409;
        kod = kodlar[asil];
      } else if (eylem5xx && req.method !== 'GET' && req.method !== 'HEAD') {
        if (asil === 501) {
          yeni = 409;
          kod = `${onek}_not_configured`;
        } else if (YAKALANAN_5XX.has(asil)) {
          yeni = 424;
          kod = `${onek}_upstream_unavailable`;
        }
      }
      if (!yeni) return asilJson(body);
      res.status(yeni);
      return asilJson({ ...body, code: body.code || kod, upstreamStatus: asil });
    };
    next();
  };
}

module.exports = { nginxRedCevirici };
