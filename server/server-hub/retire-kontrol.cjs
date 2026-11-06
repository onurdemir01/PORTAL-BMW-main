// server/server-hub/retire-kontrol.cjs - Retirement etiketlerinin kayitli manuel kontrolu (2026-11-06).
//
// Kullanici: "Manuel kontrol de gerekecek" (anket: "Kayitli manuel kontrol"). Admin her etiket icin
// "dogrulandi" ya da "yanlis alarm" isaretler; not, kim, ne zaman ve O ANKI KANIT IMZASI tutulur.
// DEPO: Portal DB server_hub_retire_kontrol (anahtar -> son karar) + server_hub_retire_kontrol_gecmisi
// (her isaretleme ve geri alma). Karar + gecmis tek transaction.
// OKUNAMAZSA null doner: etiketler yine listelenir ama hicbiri dogrulanmis SAYILMAZ (BILINMIYOR).
'use strict';

const db = () => require('../db/index.cjs');
const T = (s) => String(s == null ? '' : s).trim();
const SONUCLAR = ['DOGRULANDI', 'YANLIS_ALARM'];

function hata(status, message) {
  return Object.assign(new Error(message), { status });
}

/** @returns {Promise<Map<string, object>|null>}  null = okunamadi */
async function kontrolleriOku() {
  try {
    const { rows } = await db().query(
      `SELECT anahtar, sonuc, aciklama, imza, seviye, isaretleyen, isaretlendi FROM server_hub_retire_kontrol`,
    );
    const out = new Map();
    for (const r of rows || []) {
      const sonuc = T(r.sonuc);
      if (!SONUCLAR.includes(sonuc)) continue;
      out.set(T(r.anahtar), {
        sonuc,
        aciklama: r.aciklama || '',
        imza: T(r.imza),
        seviye: r.seviye || null,
        isaretleyen: r.isaretleyen || null,
        zaman: r.isaretlendi ? new Date(r.isaretlendi).toISOString() : null,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Tek etiketin kararini yazar. sonuc GERI_AL kaydi siler. Etiketin VAR oldugu ve imzanin GUNCEL oldugu
 * cagiran tarafindan (retire-uclar) dogrulanir; burada yalniz girdi ve yazim.
 */
async function kontrolYaz({ anahtar, sonuc, aciklama, imza, seviye, kim }) {
  const a = T(anahtar);
  const s = T(sonuc);
  const not = T(aciklama).slice(0, 1000);
  if (!a || a.length > 400) throw hata(400, 'Geçersiz etiket anahtarı.');
  if (![...SONUCLAR, 'GERI_AL'].includes(s))
    throw hata(400, `Geçersiz sonuç: ${s || '(boş)'} (DOGRULANDI / YANLIS_ALARM / GERI_AL)`);
  if (s !== 'GERI_AL' && not.length < 5)
    throw hata(400, 'Not zorunlu (en az 5 karakter): neye bakıldı, kim onayladı?');
  if (!/^[0-9a-f]{32}$/.test(T(imza))) throw hata(400, 'Geçersiz kanıt imzası.');
  const sql =
    s === 'GERI_AL'
      ? `DELETE FROM server_hub_retire_kontrol WHERE anahtar = $1;`
      : `UPDATE server_hub_retire_kontrol WITH (UPDLOCK, HOLDLOCK)
           SET sonuc = $2, aciklama = $3, imza = $4, seviye = $5, isaretleyen = $6, isaretlendi = SYSUTCDATETIME()
         WHERE anahtar = $1;
         IF @@ROWCOUNT = 0
           INSERT INTO server_hub_retire_kontrol (anahtar, sonuc, aciklama, imza, seviye, isaretleyen)
           VALUES ($1, $2, $3, $4, $5, $6);`;
  await db().query(
    `SET XACT_ABORT ON;
     IF OBJECT_ID(N'server_hub_retire_kontrol', N'U') IS NULL OR OBJECT_ID(N'server_hub_retire_kontrol_gecmisi', N'U') IS NULL
       THROW 50001, N'Retirement kontrol tablolari hazir degil.', 1;
     BEGIN TRAN;
     ${sql}
     INSERT INTO server_hub_retire_kontrol_gecmisi (anahtar, sonuc, aciklama, imza, seviye, isaretleyen)
     VALUES ($1, $2, $3, $4, $5, $6);
     COMMIT;`,
    [a, s === 'GERI_AL' ? 'GERI_ALINDI' : s, not || null, T(imza), seviye || null, kim],
  );
  return { anahtar: a, sonuc: s === 'GERI_AL' ? null : s };
}

/** Bir etiketin (ya da tumunun) gecmisi, en yeni once. */
async function kontrolGecmisi(anahtar, n = 50) {
  const ust = Math.max(1, Math.min(500, Number(n) || 50));
  const { rows } = anahtar
    ? await db().query(
        `SELECT TOP ${ust} anahtar, sonuc, aciklama, seviye, isaretleyen, zaman FROM server_hub_retire_kontrol_gecmisi WHERE anahtar = $1 ORDER BY id DESC`,
        [T(anahtar)],
      )
    : await db().query(
        `SELECT TOP ${ust} anahtar, sonuc, aciklama, seviye, isaretleyen, zaman FROM server_hub_retire_kontrol_gecmisi ORDER BY id DESC`,
      );
  return (rows || []).map((r) => ({
    anahtar: r.anahtar,
    sonuc: r.sonuc,
    aciklama: r.aciklama || '',
    seviye: r.seviye || null,
    isaretleyen: r.isaretleyen,
    zaman: r.zaman ? new Date(r.zaman).toISOString() : null,
  }));
}

module.exports = { kontrolleriOku, kontrolYaz, kontrolGecmisi, SONUCLAR };
