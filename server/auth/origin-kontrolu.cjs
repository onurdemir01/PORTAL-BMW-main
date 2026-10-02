// server/auth/origin-kontrolu.cjs — CSRF: DURUM DEGISTIREN ISTEKTE KOKEN KONTROLU (Faz E).
//
// `SameSite=Lax` cerez, baska bir siteden gelen POST/PUT/DELETE'e oturum cerezini
// GONDERMEZ — ama "ayni site" (kardes alt alan adi) bu korumanin disindadir ve eski
// tarayicilar Lax'i uygulamaz. OWASP'in ikinci katman onerisi: durum degistiren istekte
// `Origin` (yoksa `Referer`) basligi portalin kendi kokeni mi?
//
//   * Origin/Referer HIC YOKSA gecer: tarayici disi istemciler (betik, servis-servis
//     guvenilir baslik cagrilari) bu basliklari gondermez; tarayicilar durum degistiren
//     isteklerde Origin'i her zaman gonderir.
//   * Kendi koken: istegin Host'u (nginx `proxy_set_header Host $host` iletir), ayrica
//     CORS_ORIGIN (gelistirme) ve PORTAL_ALLOWED_ORIGINS (virgullu liste).
//   * `Origin: null` (sandbox iframe, file://) REDDEDILIR.
//   * Ret 403'tur, oturum 401'i DEGIL: kullanici atilmaz.
//
// Mod: CSRF_ORIGIN_CHECK = enforce (varsayilan) | log (yalnizca uyari) | off.
'use strict';

const DEGISTIREN = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function liste() {
  return String(process.env.PORTAL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);
}

function kokenCoz(deger) {
  try {
    const u = new URL(deger);
    return { origin: u.origin.toLowerCase(), host: u.host.toLowerCase() };
  } catch {
    return null;
  }
}

/** Istek kabul edilir mi? { ok, sebep } */
function kokenUygunMu(req) {
  if (!DEGISTIREN.has(req.method)) return { ok: true };
  const origin = req.headers.origin;
  const referer = req.headers.referer || req.headers.referrer;
  if (origin === undefined && !referer) return { ok: true, sebep: 'baslik-yok' };
  if (origin === 'null') return { ok: false, sebep: 'origin-null' };
  const k = kokenCoz(origin !== undefined ? origin : referer);
  if (!k) return { ok: false, sebep: 'cozulemedi' };
  const host = String(req.headers.host || '').toLowerCase();
  if (host && k.host === host) return { ok: true };
  // service.cjs CORS'u ile AYNI varsayilan: gelistirmede Vite proxy'si Host'u hedefe
  // cevirebilir, koken ise localhost:3000 kalir.
  const cors = String(process.env.CORS_ORIGIN || 'http://localhost:3000').toLowerCase().replace(/\/+$/, '');
  if (cors && k.origin === cors) return { ok: true };
  if (liste().includes(k.origin)) return { ok: true };
  return { ok: false, sebep: `yabanci-koken ${k.origin}` };
}

function originKontrolu() {
  return function originKontroluMw(req, res, next) {
    const mod = String(process.env.CSRF_ORIGIN_CHECK || 'enforce').toLowerCase();
    if (mod === 'off') return next();
    const r = kokenUygunMu(req);
    if (r.ok) return next();
    console.warn(`[CSRF] ${mod === 'log' ? '(yalnizca log) ' : ''}reddedilen istek: ${req.method} ${req.originalUrl} sebep=${r.sebep}`);
    if (mod === 'log') return next();
    try {
      require('../audit/index.cjs').auditPortal(req, 'csrf_blocked', { result: 'fail', detail: `${req.method} ${req.path} ${r.sebep}` });
    } catch {
      /* denetim yoksa yoksay */
    }
    return res.status(403).json({
      ok: false,
      code: 'koken',
      error: 'İstek portalın kendi sayfasından gelmediği için reddedildi. Sayfayı yenileyip tekrar deneyin.',
    });
  };
}

module.exports = { originKontrolu, kokenUygunMu };
