// server/nginx-loadtest/sablon.cjs - Yuk Testi KAYITLI TEST (sablon) (2026-11-04).
//
// Kullanici: "biz onden bir testi komple kaydedebiliyor muyuz ... onun ustunden hizlica tum senaryolari girmek
// istiyorum". Sablon, Yeni kosu formunun ON KONTROL GOVDESIDIR (senaryo, hedef / yuk sunucusu, parametreler); kuyruga
// tek tek ayni degerleri girmemek icin saklanir.
//
//   * HAR ICERMEZ: HAR Portal'a gitmez; sablon senaryoId'ye baglidir. Senaryo silinirse form uyarir.
//   * KAPI DEGILDIR: yalniz bicim denetlenir (onKontrolGovdesi). Sablondan doldurulan form kosu / kuyruk kapilarindan
//     normal gecer; hedef bugun uygun olmayabilir.
//   * etiket saklanmaz (oge etiketi her kosu icin ayri yazilir).
//   * Ad silinmemislerde tekil: on kontrol + filtreli tekil indeks UX_nls_ad (eszamanli iki kayit).
//   * Yumusak silme: denetim kayitlari sablon numarasina bakar; ad yeniden kullanilabilir.
//
// Uclar index.cjs'te (sablonUclari); hepsi Admin, ADMIN_DISI_OKUMA'da YOK. SQL /*KQ:ad*/ etiketli (kuyruk.cjs kalibi;
// etiket ilk anahtar sozcukten sonra, db/index.cjs RETURNING cevirisi `^INSERT` arar).
'use strict';

const AD_MAX = 120;
const GOVDE_MAX_BAYT = 16 * 1024;
// dogrula.cjs KONTROL_KARAKTERI ile ayni sinif.
// eslint-disable-next-line no-control-regex
const KONTROL_KARAKTERI = /[\u0000-\u001f\u007f]/;

function hata(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

const KOLONLAR = 'id, ad, govde, created_by, created_at, updated_by, updated_at';

const SQL = Object.freeze({
  liste: `SELECT /*KQ:sablonListe*/ TOP 200 ${KOLONLAR} FROM nginx_loadtest_sablonlar WHERE silindi = 0 ORDER BY ad ASC`,
  // $2 NULL: yeni kayit; dolu: duzenlenen satirin kendi adi cakisma sayilmaz.
  adVar: `SELECT /*KQ:sablonAdVar*/ TOP 1 id FROM nginx_loadtest_sablonlar WHERE ad = $1 AND silindi = 0 AND ($2 IS NULL OR id <> $2)`,
  ekle: `INSERT /*KQ:sablonEkle*/ INTO nginx_loadtest_sablonlar (ad, govde, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
  guncelle: `UPDATE /*KQ:sablonGuncelle*/ nginx_loadtest_sablonlar SET ad = $2, govde = $3, updated_by = $4, updated_at = GETUTCDATE()
     WHERE id = $1 AND silindi = 0`,
  sil: `UPDATE /*KQ:sablonSil*/ nginx_loadtest_sablonlar SET silindi = 1, updated_by = $2, updated_at = GETUTCDATE()
     WHERE id = $1 AND silindi = 0`,
});

function sablonAdi(v) {
  const ad = typeof v === 'string' ? v.trim() : '';
  if (!ad) throw hata(400, 'gecersiz_istek', 'Kayıtlı test adı gerekli.');
  if (ad.length > AD_MAX) throw hata(400, 'gecersiz_istek', `Kayıtlı test adı en çok ${AD_MAX} karakter olabilir.`);
  if (KONTROL_KARAKTERI.test(ad)) throw hata(400, 'gecersiz_istek', 'Kayıtlı test adı satır sonu / kontrol karakteri içeremez.');
  return ad;
}

/**
 * POST / PUT govdesi -> { ad, govde (nesne), govdeJson }. `bicimDenetle`: index.cjs onKontrolGovdesi (kurallari iki
 * yerde tutmamak icin verilir; kanonik alanlari dondurur). Yalniz bilinen alanlar saklanir; etiket dusurulur.
 */
function sablonGovdesi(b, bicimDenetle) {
  const g = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  const ad = sablonAdi(g.ad);
  if (!g.govde || typeof g.govde !== 'object' || Array.isArray(g.govde)) throw hata(400, 'gecersiz_istek', 'Ayarlar (govde) eksik.');
  const og = bicimDenetle({ ...g.govde, etiket: undefined });
  const p = og.parametrelerHam;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw hata(400, 'gecersiz_istek', 'parametreler nesne olmalı.');
  const govde = { senaryoId: og.senaryoId, hedefHost: og.hedefHost, hedefIp: og.hedefIp, vhost: og.vhost, yukHost: og.yukHost, sni: og.sni, parametreler: p };
  const govdeJson = JSON.stringify(govde);
  if (Buffer.byteLength(govdeJson, 'utf8') > GOVDE_MAX_BAYT) throw hata(400, 'gecersiz_istek', `Ayarlar çok büyük (en çok ${GOVDE_MAX_BAYT / 1024} KB).`);
  return { ad, govde, govdeJson };
}

const iso = (v) => (v == null || v === '' ? null : v instanceof Date ? v.toISOString() : String(v));

function sablonApi(r) {
  let govde = null;
  try {
    govde = typeof r.govde === 'string' ? JSON.parse(r.govde) : r.govde ?? null;
  } catch {
    govde = null;
  }
  return {
    id: Number(r.id), ad: r.ad, govde,
    createdBy: r.created_by ?? null, createdAt: iso(r.created_at), updatedBy: r.updated_by ?? null, updatedAt: iso(r.updated_at),
  };
}

/** UX_nls_ad ihlali: on kontrolden sonra ayni adla baska kayit yazildi. */
function tekilIhlali(e) {
  return /2627|2601|duplicate|UNIQUE/i.test(String(e && (e.number ?? '')) + String(e && e.message));
}

module.exports = { AD_MAX, GOVDE_MAX_BAYT, SQL, sablonGovdesi, sablonApi, tekilIhlali };
