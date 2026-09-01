// server/ansible/ss-customizations.cjs — servis bazli SMART/OCO ayarlarinin OKUYUCUSU.
//
// NEDEN VAR: Self Service'teki nginx isleri gibi URETIMDE CALISAN akislarda SMART
// onayi ve OCO kontrolu `ansible_ss_customizations` tablosunda, `(awx_server_id,
// template_id)` cifti basina saklaniyor ve admin bunlari `FieldOverridesModal`
// ekranindan yonetiyor ("Alanlari Getir" ile gercek `ElementName`leri cekmek dahil).
//
// ScaleX de AYNI yapiyi kullanir: kendi template'i icin kendi satirini okur. Boylece
// admin ikinci bir ayar yuzeyi ogrenmez ve `SCALEX_SMART_FLOW_KEY` gibi bir env
// degiskeni gerekmez — flowKey/metadataFields/ocoCheck hep ayni yerde yasar.
//
// NEDEN `runner.cjs`teki `readCustom` KULLANILMIYOR: o fonksiyon `initAnsible`in
// KAPANISINA gomulu ve disa acik degil. Disari cikarmak, uretimde calisan Self Service
// launch yolunu yeniden duzenlemek demekti — bu modulun sagladigi degere kiyasla
// oransiz bir risk. Ayni TABLOYU, ayni SEKILDE okuyoruz; paylasilan sey veri
// sozlesmesi, kod degil.
//
// Yazma BILEREK YOK: ayarlari yalnizca admin ekrani (runner.cjs uzerinden) yazar.
// Iki yazar olsaydi onbellekler ayrisirdi.
'use strict';

const db = require('../db/index.cjs');

// Kisa omurlu onbellek. Admin ekrandan degistirdiginde en gec bu kadar sonra gorunur;
// launch yolunda her istek icin DB'ye gitmemek adina. `runner.cjs`in kalici onbellegini
// PAYLASAMIYORUZ (kapanis icinde), o yuzden kisa TTL ile taze kaliyoruz.
const TTL_MS = 30_000;
let _cache = null;
let _loadedAt = 0;

function key(serverId, templateId) {
  return `${Number(serverId)}_${Number(templateId)}`;
}

async function load() {
  const { rows } = await db.query(`SELECT awx_server_id, template_id, data FROM ansible_ss_customizations`);
  const map = new Map();
  for (const r of rows) {
    try { map.set(key(r.awx_server_id, r.template_id), JSON.parse(r.data)); }
    catch { /* bozuk satiri atla — runner.cjs ile AYNI davranis */ }
  }
  _cache = map;
  _loadedAt = Date.now();
}

/**
 * Bir AWX template'i icin servis ayarlarini dondurur.
 * Sekil `runner.cjs`in `readCustom`i ile BIREBIR AYNI:
 *   { smartApproval: { flowKey, metadataFields, integrationKey, skipWhen },
 *     ocoCheck: { enabled }, ... }
 *
 * DB okunamazsa BOS NESNE doner — cagiran taraf bunu "ayar yok" olarak yorumlar.
 * Bu FAIL-OPEN gibi gorunur ama degildir: bos `smartApproval` demek, `smart-gate`in
 * "istisna listesi" mantiginda hicbir kuralin tutmamasi ve onayin GEREKLI kalmasi
 * demektir (bkz. server/ansible/smart-gate.cjs basligi).
 */
async function readCustom(serverId, templateId) {
  if (!_cache || Date.now() - _loadedAt > TTL_MS) {
    try { await load(); }
    catch (e) {
      console.warn('[ss-customizations] okunamadi, bos ayar donuluyor:', e.message);
      return {};
    }
  }
  return _cache.get(key(serverId, templateId)) || {};
}

function invalidate() { _cache = null; _loadedAt = 0; }

module.exports = { readCustom, invalidate };
