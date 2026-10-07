// server/retirement/ayar.cjs — Retirement ayarlari: SCC bilgilendirme adresi (2026-10-08).
//
// Kullanici: "SCC bilgilendirme adresi (RETIREMENT_SCC_MAIL_TO) tanimli degil" uyarisini gordu,
// "bunu application retirement sayfasinda girmek istiyorum" dedi. Adres eskiden YALNIZ Portal
// sunucusunun ortam degiskenindeydi (acilista bir kez okunuyordu).
//
// ONCELIK: ekranda girilen (portal_config_blobs 'retirement:scc') > ortam degiskeni
// (RETIREMENT_SCC_MAIL_TO / _CC) > yok. Ekrandaki "Kime" BOS kaydedilirse ekran degeri
// kalkar ve ortam degiskenine geri dusulur. Kaynak her zaman DONDURULUR ki ekran "bu adres
// .env'den geliyor" diyebilsin - eski DB satirinin kod varsayilanini sessizce ezmesi bu
// depoda yasandi (bkz. memory: Stale DB config overrides code defaults); burada kaynak acik.
//
// Adres her okumada DB'den gelir (onbellek yok): kaydedilen deger yeniden baslatma
// gerektirmeden bir sonraki STOP'ta kullanilir. DB okunamazsa ortam degiskenine dusulur
// ve kaynak 'env' degil 'env (DB okunamadi)' olarak bildirilir.
'use strict';

const BLOB_NAME = 'retirement:scc';
const ADRES_MAX = 10;
// Sade bir kontrol: tek @, iki tarafta bosluk/ayirac yok, alan adinda nokta. RFC uyumu degil,
// yanlis yapistirmayi (virgul/noktali virgul kacmasi, isim + adres) yakalamak icin.
const ADRES_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

function db() { return require('../db/index.cjs'); }

/** "a@x.com; b@x.com,  c@x.com" -> { ok, liste, hata }. Bos girdi gecerli (bos liste). */
function adresleriAyristir(girdi) {
  const ham = String(girdi ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const liste = [...new Set(ham.map((s) => s.toLowerCase()))];
  const bozuk = liste.filter((a) => !ADRES_RE.test(a));
  if (bozuk.length) return { ok: false, liste: [], hata: `Geçersiz e-posta adresi: ${bozuk.slice(0, 3).join(', ')}` };
  if (liste.length > ADRES_MAX) return { ok: false, liste: [], hata: `En çok ${ADRES_MAX} adres girilebilir.` };
  return { ok: true, liste, hata: null };
}

async function blobOku() {
  const { rows } = await db().query(`SELECT data, updated_at FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
  if (!rows.length) return null;
  const o = JSON.parse(rows[0].data);
  return { ...o, updatedAt: rows[0].updated_at ?? o.updatedAt ?? null };
}

/** Etkin SCC ayari: { to, cc, kaynak: 'ekran'|'env'|'yok', dbHatasi, guncelleyen, guncellendi }.
 *  `to`/`cc` virgulle birlesik dizgedir (Ansible mail modulu bu bicimi kabul eder). */
async function sccAyar() {
  const envTo = (process.env.RETIREMENT_SCC_MAIL_TO || '').trim();
  const envCc = (process.env.RETIREMENT_SCC_MAIL_CC || '').trim();
  let blob = null;
  let dbHatasi = null;
  try { blob = await blobOku(); } catch (e) { dbHatasi = String(e.message || e); }
  if (blob && Array.isArray(blob.to) && blob.to.length) {
    return {
      to: blob.to.join(','), cc: Array.isArray(blob.cc) ? blob.cc.join(',') : '',
      kaynak: 'ekran', dbHatasi: null, guncelleyen: blob.updatedBy || null, guncellendi: blob.updatedAt || null,
    };
  }
  return { to: envTo, cc: envCc, kaynak: envTo ? 'env' : 'yok', dbHatasi, guncelleyen: null, guncellendi: null };
}

/** Ekrandan kaydet. Kime BOS ise ekran degeri KALKAR (ortam degiskenine dusulur). */
async function sccKaydet({ to, cc }, username) {
  const t = adresleriAyristir(to);
  if (!t.ok) return { ok: false, message: `Kime: ${t.hata}` };
  const c = adresleriAyristir(cc);
  if (!c.ok) return { ok: false, message: `Bilgi (CC): ${c.hata}` };
  if (!t.liste.length && c.liste.length) return { ok: false, message: '“Kime” boşken CC tek başına kaydedilemez.' };
  if (!t.liste.length) {
    await db().query(`DELETE FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
    return { ok: true, ayar: await sccAyar() };
  }
  const json = JSON.stringify({ to: t.liste, cc: c.liste, updatedBy: username || null, updatedAt: new Date().toISOString() });
  const upd = await db().query(`UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`, [json, BLOB_NAME]);
  if (!upd.rowCount) await db().query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [BLOB_NAME, json]);
  return { ok: true, ayar: await sccAyar() };
}

module.exports = { sccAyar, sccKaydet, adresleriAyristir, BLOB_NAME };
