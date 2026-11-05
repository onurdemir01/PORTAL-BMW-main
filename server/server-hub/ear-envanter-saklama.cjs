// server/server-hub/ear-envanter-saklama.cjs - Uygulama Envanteri saklama (2026-11-04).
//
// DB: son N FILO kosusu tutulur (ayar saklama_kosu, varsayilan 12) ve onlardan YENI tum secili kosular.
// "Son N kosu" deseydik pilot / tek sunucu kosulari son filo taramasini silebilirdi. Silme kucuk
// parcalarla (TOP 20000) yapilir: tek dev DELETE transaction log'unu doldurmasin.
//
// /sw: yalniz EAR_ENVANTER_DIR altindaki `kosu-<n>` dizinleri; calisan kosu ve son N TAM kosusu
// (saklama_ham, varsayilan 3) KALIR. Agac goruntuleyici ve sunucu ZIP'i ham dosyayi okur; OZET'in
// ham dosyasi alimdan sonra gereksizdir. DB okunamazsa HICBIR SEY silinmez (fail-closed). DB'de
// karsiligi olmayan dizin ancak 7 gunden eskiyse silinir.
// AWX'ten elle baslatilan isin dizini `awx-<is no>` (2026-11-05): ayni kural, kosu numarasi
// partileri.awx_job_id uzerinden bulunur. Henuz alinmamis is (AWX alimi 7 gun geriye bakar) 7 gun korunur.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const alim = require('./ear-envanter-alim.cjs');
const ayar = require('./ear-envanter-ayar.cjs');

const PARCA = 20000;
const YETIM_GUN = 7;
const KOSU_DIZINI = /^kosu-(\d{1,9})$/;
const AWX_DIZINI = /^awx-(\d{1,9})$/;
const db = () => require('../db/index.cjs');

async function parcaliSil(tablo, kosul, params) {
  let toplam = 0;
  for (let i = 0; i < 1000; i++) {
    const r = await db().query(`DELETE TOP (${PARCA}) FROM ${tablo} WHERE ${kosul}`, params, {
      tekrar: false,
    });
    toplam += Number(r.rowCount || 0);
    if (Number(r.rowCount || 0) < PARCA) break;
  }
  return toplam;
}

/** Saklanacak en eski kosu numarasi (sinir) ya da null (silinecek bir sey yok). */
async function dbSiniri(n) {
  const { rows } = await db().query(
    `SELECT COUNT(*) AS adet, MIN(id) AS sinir FROM (
       SELECT TOP (${Math.max(2, Math.min(52, Number(n) || 12))}) id FROM ear_envanter_kosulari
        WHERE kapsam = 'FILO' AND durum <> 'CALISIYOR' ORDER BY id DESC) t`,
  );
  const r = rows && rows[0];
  if (!r || Number(r.adet) < Number(n) || r.sinir == null) return null;
  // Calisan kosu (olagan disi: cok eski) sinirin altinda kalmasin.
  const c = await db().query(
    `SELECT MIN(id) AS id FROM ear_envanter_kosulari WHERE durum = 'CALISIYOR'`,
  );
  const calisan = c.rows && c.rows[0] && c.rows[0].id != null ? Number(c.rows[0].id) : null;
  return calisan != null ? Math.min(Number(r.sinir), calisan) : Number(r.sinir);
}

async function dbSaklama(n) {
  const sinir = await dbSiniri(n);
  const sonuc = { sinir, war: 0, uygulama: 0, host: 0, parti: 0, kosu: 0, set: 0 };
  if (sinir != null) {
    sonuc.war = await parcaliSil('ear_envanter_warlari', 'kosu_id < $1', [sinir]);
    sonuc.uygulama = await parcaliSil('ear_envanter_uygulamalari', 'kosu_id < $1', [sinir]);
    sonuc.host = await parcaliSil('ear_envanter_hostlari', 'kosu_id < $1', [sinir]);
    sonuc.parti = await parcaliSil('ear_envanter_partileri', 'kosu_id < $1', [sinir]);
    sonuc.kosu = await parcaliSil('ear_envanter_kosulari', "id < $1 AND durum <> 'CALISIYOR'", [
      sinir,
    ]);
  }
  // Hicbir WAR / uygulamanin gostermedigi setler. Yeni set alim transaction'inda satiriyla birlikte
  // yazilir; 6 saat payi yine de yarisi kapatir.
  sonuc.set = await parcaliSil(
    'ear_envanter_kutuphane_setleri',
    `created_at < DATEADD(HOUR, -6, SYSUTCDATETIME())
       AND NOT EXISTS (SELECT 1 FROM ear_envanter_warlari w WHERE w.kutuphane_seti = ear_envanter_kutuphane_setleri.iz)
       AND NOT EXISTS (SELECT 1 FROM ear_envanter_uygulamalari u WHERE u.ear_kutuphane_seti = ear_envanter_kutuphane_setleri.iz)`,
    [],
  );
  await parcaliSil(
    'ear_envanter_set_kutuphaneleri',
    'NOT EXISTS (SELECT 1 FROM ear_envanter_kutuphane_setleri s WHERE s.iz = ear_envanter_set_kutuphaneleri.iz)',
    [],
  );
  return sonuc;
}

/** Silinmeyecek kosu numaralari: calisan / alinan + son N TAM. DB okunamazsa hata (hicbir sey silinmez). */
async function hamKorunan(n) {
  const { rows } = await db().query(
    `SELECT id, kip, durum FROM ear_envanter_kosulari k
      WHERE k.durum = 'CALISIYOR'
         OR EXISTS (SELECT 1 FROM ear_envanter_partileri p WHERE p.kosu_id = k.id AND p.durum IN ('CALISIYOR', 'ALINIYOR'))
         OR k.id IN (SELECT TOP (${Math.max(1, Math.min(10, Number(n) || 3))}) id FROM ear_envanter_kosulari WHERE kip = 'TAM' ORDER BY id DESC)`,
  );
  const tum = await db().query(`SELECT id FROM ear_envanter_kosulari`);
  const awx = await db().query(
    `SELECT p.awx_job_id, p.kosu_id FROM ear_envanter_partileri p
       JOIN ear_envanter_kosulari k ON k.id = p.kosu_id
      WHERE k.kaynak = 'AWX' AND p.awx_job_id IS NOT NULL`,
  );
  return {
    korunan: new Set((rows || []).map((r) => Number(r.id))),
    bilinen: new Set((tum.rows || []).map((r) => Number(r.id))),
    // AWX is no -> kosu no
    awxKosu: new Map((awx.rows || []).map((r) => [Number(r.awx_job_id), Number(r.kosu_id)])),
  };
}

/**
 * /sw saklamasi. Dizin kurallari earDizin()'de (mutlak, '..' yok, en az iki seviye); burada ek olarak
 * dizinin gercek yolu kendisi olmali (sembolik bagla baska yere yonlenmis kok silinmez) ve her aday
 * `kosu-<n>` adli GERCEK dizin olmali.
 */
async function hamSaklama(n, { dizin = alim.earDizin(), simdi = Date.now() } = {}) {
  const sonuc = { dizin, silinen: [], korunan: 0, atlanan: [] };
  let gercek;
  try {
    gercek = await fs.promises.realpath(dizin);
  } catch (e) {
    sonuc.atlanan.push(`dizin okunamadı (${e.code || e.message})`);
    return sonuc;
  }
  if (gercek !== dizin) {
    sonuc.atlanan.push(`dizin sembolik bağ (${gercek}); silme yapılmadı`);
    return sonuc;
  }
  const { korunan, bilinen, awxKosu } = await hamKorunan(n);
  const girisler = await fs.promises.readdir(dizin, { withFileTypes: true });
  for (const g of girisler) {
    if (!g.isDirectory()) continue;
    const m = KOSU_DIZINI.exec(g.name);
    const a = m ? null : AWX_DIZINI.exec(g.name);
    if (!m && !a) continue;
    // awx-<is>: kosusu yoksa (henuz alinmadi) NaN -> bilinmeyen, 7 gun korunur.
    const id = m ? Number(m[1]) : awxKosu.has(Number(a[1])) ? awxKosu.get(Number(a[1])) : NaN;
    if (korunan.has(id)) {
      sonuc.korunan += 1;
      continue;
    }
    const tam = path.join(dizin, g.name);
    try {
      const st = await fs.promises.lstat(tam);
      if (!st.isDirectory()) continue;
      if (!bilinen.has(id) && simdi - st.mtimeMs < YETIM_GUN * 86400000) continue;
      await fs.promises.rm(tam, { recursive: true, force: true });
      sonuc.silinen.push(g.name);
    } catch (e) {
      sonuc.atlanan.push(`${g.name}: ${e.code || e.message}`);
    }
  }
  return sonuc;
}

async function saklama() {
  const a = await ayar.oku();
  if (a.okunamadi) return { atlandi: 'ayarlar okunamadı' };
  const dbSonuc = await dbSaklama(Number(a.deger.saklama_kosu));
  let ham;
  try {
    ham = await hamSaklama(Number(a.deger.saklama_ham));
  } catch (e) {
    ham = { hata: e.message };
  }
  if (dbSonuc.kosu || dbSonuc.set || (ham.silinen && ham.silinen.length))
    console.log(
      `[EarEnvanter] saklama: kosu=${dbSonuc.kosu} set=${dbSonuc.set} ham=${(ham.silinen || []).length}`,
    );
  return { db: dbSonuc, ham };
}

module.exports = {
  saklama,
  dbSaklama,
  dbSiniri,
  hamSaklama,
  hamKorunan,
  KOSU_DIZINI,
  AWX_DIZINI,
  PARCA,
};
