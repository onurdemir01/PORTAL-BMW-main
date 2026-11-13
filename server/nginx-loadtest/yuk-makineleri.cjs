// server/nginx-loadtest/yuk-makineleri.cjs - Yuk Testi: yuk makinesi izin listesi Portal'dan (2026-11-13).
//
// Kullanici: "bu degisikligi direkt Portal uzerinden yapamaz miyiz ya niye .env dosyasinda islem yapiyoruz".
// Liste Portal DB'de (nginx_loadtest_yuk_hostlari) tutulur; Yuk Testi > Araclar'dan YALNIZ Admin ekler / cikarir.
//
// KAYNAK SIRASI:
//   - tabloda en az bir satir varsa liste ODUR ('portal')
//   - tablo bossa eski davranis: NGINX_LOADTEST_YUK_HOSTLARI, o da yoksa GBNGXT34 ('ortam')
//   - ilk Portal degisikliginde o anki ortam listesi tabloya TASINIR (ekleme mevcut makineyi dusurmesin)
//   - son makine cikarilamaz (tablo bosalip sessizce ortam listesine donmesin)
//   - tablo OKUNAMAZSA kapali kalir (424): ortam listesine sessizce donmek Admin'in cikardigi makineyi geri acardi
//
// LISTE KAPIYI GEVSETEMEZ: ekleme aninda ve her kosuda dogrula.yukHostKapisi ayni kurallari uygular (ad kuralina
// gore DEV/TEST/QA, uretim isareti yok, envanterde kayitli). Playbook ad kuralini ayrica denetler.
'use strict';

const dg = require('./dogrula.cjs');

const TABLO = 'nginx_loadtest_yuk_hostlari';
const NOT_MAX = 300;
const EN_COK = 20;

function hata(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

async function satirlar(db) {
  const r = await db.query(`SELECT host, note, created_by, created_at FROM ${TABLO} ORDER BY host`, []);
  return (r.rows || [])
    .map((x) => ({
      host: dg.hostNormalle(x.host),
      not: x.note || null,
      ekleyen: x.created_by || null,
      eklendi: x.created_at ? new Date(x.created_at).toISOString() : null,
    }))
    .filter((x) => x.host);
}

/**
 * Etkin liste. Firlatir (424 yuk_makineleri_okunamadi) - cagiran kapali kalir.
 * @returns {Promise<{ hostlar: string[], kaynak: 'portal'|'ortam', kayitlar: object[] }>}
 */
async function oku(db) {
  let k;
  try {
    k = await satirlar(db);
  } catch (e) {
    throw hata(424, 'yuk_makineleri_okunamadi', `Yük makinesi listesi Portal veritabanından okunamadı: ${e && e.message}`);
  }
  if (k.length) return { hostlar: k.map((x) => x.host), kaynak: 'portal', kayitlar: k };
  const ortam = dg.yukHostlari();
  return { hostlar: ortam, kaynak: 'ortam', kayitlar: ortam.map((host) => ({ host, not: null, ekleyen: null, eklendi: null })) };
}

/** Bos tabloya o anki ortam listesini tasir (ilk Portal degisikligi). */
async function tasi(db, by) {
  const mevcut = await satirlar(db);
  if (mevcut.length) return;
  for (const host of dg.yukHostlari()) {
    await db.query(
      `INSERT INTO ${TABLO} (host, note, created_by) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM ${TABLO} WHERE host = $1)`,
      [host, 'Ortam değişkeninden taşındı (NGINX_LOADTEST_YUK_HOSTLARI / varsayılan)', by],
    );
  }
}

/**
 * Ekle: once kapi (envanter + ad kurali + uretim isareti), sonra yaz.
 * @param kapi async (host) => { ok, message } (index.cjs kaynaklariOku + yukHostKapisi)
 */
async function ekle(db, { host: ham, not: notHam }, by, kapi) {
  const host = dg.hostNormalle(ham);
  if (!host) throw hata(400, 'gecersiz_istek', 'Geçersiz sunucu adı.');
  const not = String(notHam == null ? '' : notHam).trim().slice(0, NOT_MAX) || null;
  const once = await oku(db);
  if (once.kaynak === 'portal' && once.hostlar.includes(host)) throw hata(409, 'zaten_var', `${host} zaten listede.`);
  if (once.hostlar.length >= EN_COK && !once.hostlar.includes(host)) throw hata(409, 'liste_dolu', `En çok ${EN_COK} yük makinesi.`);
  const k = await kapi(host);
  if (!k.ok) throw hata(409, k.code || 'yuk_host_izinsiz', k.message);
  await tasi(db, by);
  await db.query(
    `INSERT INTO ${TABLO} (host, note, created_by) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM ${TABLO} WHERE host = $1)`,
    [host, not, by],
  );
  return oku(db);
}

async function cikar(db, ham, by) {
  const host = dg.hostNormalle(ham);
  if (!host) throw hata(400, 'gecersiz_istek', 'Geçersiz sunucu adı.');
  const once = await oku(db);
  if (!once.hostlar.includes(host)) throw hata(404, 'yok', `${host} listede değil.`);
  if (once.hostlar.length <= 1) throw hata(409, 'son_makine', 'Son yük makinesi çıkarılamaz; önce başka bir makine ekleyin.');
  await tasi(db, by);
  await db.query(`DELETE FROM ${TABLO} WHERE host = $1`, [host]);
  return oku(db);
}

module.exports = { TABLO, oku, ekle, cikar, NOT_MAX, EN_COK };
