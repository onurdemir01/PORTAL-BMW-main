// server/auth/session-policy.cjs — OTURUM POLITIKASI (Faz A, 2026-10-02).
//
// NEDEN: kullanicilar "sik atiliyoruz" dedi. Sunucu tarafindaki iki kok neden:
//   * cerez giristen 8 SAAT sonra kesin bitiyordu (`rolling` yok, sabit kodlu),
//     etkinlik sureyi hic uzatmiyordu;
//   * bosta kalma (idle) ile mutlak sure ayrimi yoktu.
// Kullanici karari (2026-10-01): bosta 60 dk, mutlak 12 sa, "beni hatirla" 7 gun
// (kapatilabilir; bosta kalma kurali yine gecerli). Hepsi Admin'den degistirilebilir:
// degerler HER ISTEKTE `process.env`'den okunur (env override'lar process.env'i aninda
// gunceller — boot'ta dondurulan bir deger "restart ister" demek olurdu).
//
// ETKINLIK: VARSAYILAN olarak her istek etkinliktir. Yalnizca bilinen ARKA PLAN
// yoklamalari (Dashboard/presence/gorunurluk) ve `X-Portal-Activity: background`
// basligi tasiyan istekler sureyi UZATMAZ — acik unutulan bir sekme oturumu sonsuza
// dek acik tutamasin. Ters mantik (yalnizca isaretli istekler etkinlik) istemci
// guncellenmeden deploy edilseydi herkesi 60 dk'da atardi.
'use strict';

// [ortam anahtari, alt sinir, ust sinir, varsayilan]
const AYARLAR = {
  idleMinutes: ['SESSION_IDLE_MINUTES', 5, 720, 60],
  absoluteHours: ['SESSION_ABSOLUTE_HOURS', 1, 72, 12],
  rememberDays: ['SESSION_REMEMBER_DAYS', 0, 30, 7],
  warnSeconds: ['SESSION_WARN_SECONDS', 30, 900, 120],
};

const _uyarildi = new Set();
function oku([anahtar, alt, ust, vars]) {
  const ham = process.env[anahtar];
  if (ham === undefined || String(ham).trim() === '') return vars;
  const n = Number(ham);
  if (!Number.isFinite(n) || n < alt || n > ust) {
    // Bozuk/sinir disi deger: varsayilana dusulur ve BIR KEZ soylenir (her istekte log basmaz).
    const k = `${anahtar}=${ham}`;
    if (!_uyarildi.has(k)) {
      _uyarildi.add(k);
      console.warn(`[Oturum] ${anahtar}="${ham}" gecersiz (${alt}-${ust}); varsayilan ${vars} kullaniliyor.`);
    }
    return vars;
  }
  return Math.round(n);
}

function policy() {
  const idleMinutes = oku(AYARLAR.idleMinutes);
  const absoluteHours = oku(AYARLAR.absoluteHours);
  const rememberDays = oku(AYARLAR.rememberDays);
  return {
    idleMs: idleMinutes * 60 * 1000,
    absoluteMs: absoluteHours * 60 * 60 * 1000,
    rememberMs: rememberDays * 24 * 60 * 60 * 1000,
    rememberEnabled: rememberDays > 0,
    warnSeconds: oku(AYARLAR.warnSeconds),
  };
}

// Oturumun MUTLAK siniri: "beni hatirla" ise hatirlama suresi, degilse mutlak sure.
function mutlakMs(meta, p = policy()) {
  return meta && meta.remember && p.rememberEnabled ? p.rememberMs : p.absoluteMs;
}

// Bitis zamanlari (epoch ms). Bosta kalma bitisi mutlak siniri asamaz.
function bitisler(meta, p = policy()) {
  const absoluteExpiresAt = meta.createdAt + mutlakMs(meta, p);
  const idleExpiresAt = Math.min(meta.lastSeenAt + p.idleMs, absoluteExpiresAt);
  return { idleExpiresAt, absoluteExpiresAt };
}

// ARKA PLAN YOKLAMALARI: sureyi uzatmaz. Yalnizca GET; yol tam eslesir.
const ARKA_PLAN_YOLLARI = new Set([
  '/api/users/online', // Dashboard cevrimici kullanicilar (25 sn)
  '/api/visibility/version', // gorunurluk surum yoklamasi (45 sn, her sayfada)
  '/api/ansible/awx/recent-jobs', // Dashboard kuyruk paneli (15 sn)
  '/api/auth/session', // istemci oturum saati (kendi suresini uzatmamali)
]);

function etkinlikMi(req) {
  const isaret = String(req.headers['x-portal-activity'] || '').toLowerCase();
  if (isaret === 'background') return false;
  if (isaret === 'user') return true;
  if (req.method === 'GET' && ARKA_PLAN_YOLLARI.has(String(req.path || req.originalUrl || '').split('?')[0]))
    return false;
  return true;
}

// ── Yaptirim ────────────────────────────────────────────────────────────────
// Saat enjekte edilebilir: bekciler sinirlari +-1 sn ile sinar (gercek bekleme yok).
let saat = () => Date.now();
// Yaptirimla AYNI saat: liste/rapor kodu "bitti mi" sorusunu ayni ana gore cevaplasin.
function simdi() {
  return saat();
}
function _saatAyarla(fn) {
  saat = typeof fn === 'function' ? fn : () => Date.now();
}

// lastSeenAt en fazla bu aralikla yazilir: her istekte DB'ye UPDATE atmamak icin.
// Bedeli: bosta kalma suresi en fazla 60 sn erken dolabilir (kullanici lehine degil,
// guvenli yonde).
const YAZMA_ARALIGI_MS = 60 * 1000;

const BASLIK_SEBEP = 'X-Portal-Session-Reason';
const BASLIK_BOSTA = 'X-Portal-Session-Expires';
const BASLIK_MUTLAK = 'X-Portal-Session-Absolute';

function kisaKimlik() {
  return require('node:crypto').randomBytes(4).toString('hex');
}

// Giriste yazilan oturum kunyesi. `id` gorunen kisa kimliktir (Faz D: "aktif
// oturumlarim"), oturum anahtari DEGILDIR.
function yeniMeta(req, { remember = false } = {}, now = saat()) {
  return {
    id: kisaKimlik(),
    createdAt: now,
    lastSeenAt: now,
    remember: !!remember,
    ip: String(req.ip || '').slice(0, 64),
    ua: String((req.headers && req.headers['user-agent']) || '').slice(0, 200),
  };
}

// Bu surum ONCESI acilmis oturumlarda kunye yok: kimseyi atmadan baslatilir.
// Mutlak sure girisin kendisinden sayilir (`loginAt`) — eski cerez zaten 8 sa ile
// sinirliydi, yani 12 sa'lik sinir kimseyi erken atmaz.
function eksikMetaTamamla(sess, now = saat()) {
  if (sess.meta && Number.isFinite(sess.meta.createdAt) && Number.isFinite(sess.meta.lastSeenAt))
    return false;
  const giris = Date.parse(sess.user && sess.user.loginAt);
  const createdAt = Number.isFinite(giris) && giris <= now ? giris : now;
  sess.meta = { id: kisaKimlik(), createdAt, lastSeenAt: now, remember: false, ip: '', ua: '' };
  return true;
}

// Cerez: "beni hatirla" ise KALICI ve mutlak sinira kadar; degilse tarayici oturumu
// cerezi (tarayici kapaninca gider). Asil yaptirim sunucudadir; cerez yalnizca
// tarayicinin ne zaman unutacagini belirler. `rolling: true` ile her yanitta yeniden
// gonderilir — eski 8 sa'lik kalici cerezler ilk yanitta bu modele gecer.
function cerezAyarla(sess, p = policy(), now = saat()) {
  if (!sess || !sess.cookie || !sess.meta) return;
  if (sess.meta.remember && p.rememberEnabled) {
    // `maxAge` degil `expires`: express-session maxAge'i kendi saatiyle tarihe cevirir;
    // sinir mutlak bir AN oldugu icin dogrudan o an yazilir.
    const { absoluteExpiresAt } = bitisler(sess.meta, p);
    sess.cookie.expires = new Date(Math.max(now, absoluteExpiresAt));
  } else {
    sess.cookie.expires = null;
  }
}

// Rol YUKSELTMESI oturumu dusurmez, yerinde yansir (2026-10-02). Kayit, yalnizca
// kayittan ONCE acilmis oturumlara uygulanir: sonradan acilanlar rolu zaten giriste
// guncel okur. Sinirli: en fazla 1000 kullanici, 72 sa'ten eski kayit dusurulur.
const rolYukseltmeleri = new Map();
const ROL_KAYIT_UST = 1000;
const ROL_KAYIT_OMRU_MS = 72 * 60 * 60 * 1000;
function rolYukseltmesiKaydet(username, role, now = saat()) {
  const k = String(username || '').toLowerCase();
  if (!k) return;
  rolYukseltmeleri.delete(k);
  rolYukseltmeleri.set(k, { role, at: now });
  for (const [ad, v] of rolYukseltmeleri) {
    if (rolYukseltmeleri.size <= ROL_KAYIT_UST && now - v.at < ROL_KAYIT_OMRU_MS) break;
    rolYukseltmeleri.delete(ad);
  }
}
function rolKaydiniSil(username) {
  rolYukseltmeleri.delete(String(username || '').toLowerCase());
}
function rolYukseltmesiUygula(sess, now = saat()) {
  const k = String(sess.user.username || '').toLowerCase();
  const kayit = rolYukseltmeleri.get(k);
  if (!kayit || now - kayit.at >= ROL_KAYIT_OMRU_MS) return false;
  if (sess.meta.createdAt >= kayit.at || sess.user.role === kayit.role) return false;
  sess.user.role = kayit.role;
  return true;
}

// Suresi dolan oturum: store'dan silinir (regenerate eskiyi yok eder, yerine BOS ve
// kaydedilmeyen bir oturum koyar — boylece ayni istekteki /login gibi uclar
// `req.session`'i kullanabilir). Karari asagidaki katman verir: requireAuth imzali
// 401 doner, sebep basligi zaten yanitta durur.
function oturumuBitir(req, res, sebep, next) {
  res.setHeader(BASLIK_SEBEP, sebep);
  // Denetim (Faz D): "sik atiliyoruz" sikayeti sebebe gore olculebilsin (idle/absolute).
  try {
    const m = req.session.meta || {};
    require('../audit/index.cjs').auditPortal(req, 'session_expired', {
      username: req.session.user && req.session.user.username,
      detail: `reason=${sebep} id=${m.id || '-'} ageMin=${Math.round((saat() - (m.createdAt || saat())) / 60000)}`,
    });
  } catch {
    /* denetim yoksa yoksay */
  }
  req.oturumBitti = sebep;
  req.session.regenerate((err) => {
    if (err) console.warn('[Oturum] suresi dolan oturum silinemedi:', err.message);
    next();
  });
}

function basliklariYaz(res, meta, p) {
  const { idleExpiresAt, absoluteExpiresAt } = bitisler(meta, p);
  res.setHeader(BASLIK_BOSTA, String(idleExpiresAt));
  res.setHeader(BASLIK_MUTLAK, String(absoluteExpiresAt));
}

function oturumYaptirimi() {
  return function oturumYaptirimiMw(req, res, next) {
    const sess = req.session;
    if (!sess || !sess.user) return next();
    const now = saat();
    const p = policy();
    eksikMetaTamamla(sess, now);
    const { idleExpiresAt, absoluteExpiresAt } = bitisler(sess.meta, p);
    if (now >= absoluteExpiresAt) return oturumuBitir(req, res, 'absolute', next);
    if (now >= idleExpiresAt) return oturumuBitir(req, res, 'idle', next);

    rolYukseltmesiUygula(sess, now);
    if (etkinlikMi(req) && now - sess.meta.lastSeenAt >= YAZMA_ARALIGI_MS) {
      sess.meta.lastSeenAt = now;
    }
    cerezAyarla(sess, p, now);
    basliklariYaz(res, sess.meta, p);
    next();
  };
}

// Istemci saati icin ozet (GET /api/auth/session ve /session/extend).
function oturumOzeti(sess, p = policy(), now = saat()) {
  const { idleExpiresAt, absoluteExpiresAt } = bitisler(sess.meta, p);
  return {
    ok: true,
    serverNow: now,
    idleExpiresAt,
    absoluteExpiresAt,
    warnSeconds: p.warnSeconds,
    remember: !!(sess.meta.remember && p.rememberEnabled),
  };
}

// "Surdur": kisitlama araligini beklemeden etkinlik yazar.
function uzat(req, res, now = saat()) {
  const p = policy();
  req.session.meta.lastSeenAt = now;
  cerezAyarla(req.session, p, now);
  basliklariYaz(res, req.session.meta, p);
  return oturumOzeti(req.session, p, now);
}

module.exports = {
  policy,
  bitisler,
  mutlakMs,
  etkinlikMi,
  yeniMeta,
  eksikMetaTamamla,
  cerezAyarla,
  oturumYaptirimi,
  oturumOzeti,
  uzat,
  rolYukseltmesiKaydet,
  rolKaydiniSil,
  ARKA_PLAN_YOLLARI,
  AYARLAR,
  YAZMA_ARALIGI_MS,
  BASLIK_SEBEP,
  BASLIK_BOSTA,
  BASLIK_MUTLAK,
  simdi,
  _saatAyarla,
  _rolYukseltmeleri: rolYukseltmeleri,
};
