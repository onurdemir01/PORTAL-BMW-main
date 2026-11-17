// server/oco/manuel.cjs - OCO Takvimi: elle eklenen olaylar (2026-11-17).
//
// Kullanici: "OCO Takvimi'ne manuel ekleme olayi da ekler misin?"
//
// NEDEN PORTAL DB: OCO listesi kurumsal arama servisinden SALT OKUNUR gelir (oco/index.cjs);
// servise yazma yok. Servisin dondurmedigi bir OCO ya da OCO'su olmayan planli bir calisma
// (bakim, test, duyuru) takvimde gorunsun diye kayit Portal DB'de (oco_manuel_olaylar) tutulur.
//
// KURALLAR:
//   * Elle olay OCO DEGILDIR: ekranda "manuel" rozetiyle ayri gorunur; servis satiriyla
//     birlestirilmez, servisteki OCO'yu gizlemez ya da degistirmez.
//   * OCO no ISTEGE BAGLI (yalniz rakam). Ayni OCO serviste de varsa ikisi de gorunur; ekran
//     formda bunu uyarir (engel degil: servis kaydi gecikmeli gelebilir).
//   * Baslangic ZORUNLU (takvim gunu ondan hesaplanir); bitis istege bagli, varsa >= baslangic.
//   * Ekleme: sayfayi gorebilen herkes. Duzenleme/silme: yalniz ekleyen ya da Admin (sunucu
//     denetler; ekrandaki dugme yalniz kolaylik).
//   * Okuma ASLA firlatmaz sozlesmesi cagiranda: ekran olaylar okunamazsa OCO listesiyle devam
//     eder ve hatayi yazar (bos liste "olay yok" gibi okunmasin).
'use strict';

const BASLIK_EN_COK = 300;
const ACIKLAMA_EN_COK = 2000;
const OCO_NO_RE = /^\d{1,20}$/;
// Tek olay en cok 31 gun: yanlis yil girisi (2062) takvimi aylarca boyamasin.
const EN_UZUN_MS = 31 * 24 * 60 * 60 * 1000;
// Kac yil ileri/geri kabul edilir (yazim hatasi kalkani).
const YIL_PAYI = 5;
const EN_COK_KAYIT = 2000;

function tarihCoz(v) {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Istek govdesini dogrular (SAF). { hata } ya da { ocoNo, baslik, aciklama, baslangic, bitis }.
 * @param {object} govde
 * @param {Date} [simdi]
 */
function dogrula(govde, simdi = new Date()) {
  const g = govde && typeof govde === 'object' ? govde : {};
  const baslik = String(g.baslik == null ? '' : g.baslik).trim();
  if (!baslik) return { hata: 'Başlık zorunlu.' };
  if (baslik.length > BASLIK_EN_COK) return { hata: `Başlık en çok ${BASLIK_EN_COK} karakter.` };
  const aciklamaHam = String(g.aciklama == null ? '' : g.aciklama).trim();
  if (aciklamaHam.length > ACIKLAMA_EN_COK)
    return { hata: `Açıklama en çok ${ACIKLAMA_EN_COK} karakter.` };
  const ocoHam = String(g.ocoNo == null ? '' : g.ocoNo).trim();
  if (ocoHam && !OCO_NO_RE.test(ocoHam)) return { hata: 'OCO no yalnız rakamlardan oluşmalı.' };
  const baslangic = tarihCoz(g.baslangic);
  if (!baslangic)
    return {
      hata: baslangic === undefined ? 'Başlangıç tarihi geçersiz.' : 'Başlangıç tarihi zorunlu.',
    };
  const bitis = tarihCoz(g.bitis);
  if (bitis === undefined) return { hata: 'Bitiş tarihi geçersiz.' };
  if (bitis && bitis.getTime() < baslangic.getTime())
    return { hata: 'Bitiş, başlangıçtan önce olamaz.' };
  if (bitis && bitis.getTime() - baslangic.getTime() > EN_UZUN_MS)
    return { hata: 'Bir olay en çok 31 gün sürebilir.' };
  const yil = simdi.getUTCFullYear();
  if (Math.abs(baslangic.getUTCFullYear() - yil) > YIL_PAYI)
    return { hata: `Başlangıç yılı ${yil - YIL_PAYI}–${yil + YIL_PAYI} arasında olmalı.` };
  return {
    ocoNo: ocoHam || null,
    baslik,
    aciklama: aciklamaHam || null,
    baslangic,
    bitis: bitis || null,
  };
}

function iso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** DB satiri -> API bicimi. */
function satirdan(x) {
  return {
    id: Number(x.id),
    ocoNo: x.oco_no ? String(x.oco_no) : null,
    baslik: String(x.baslik || ''),
    aciklama: x.aciklama ? String(x.aciklama) : '',
    baslangic: iso(x.baslangic),
    bitis: iso(x.bitis),
    olusturan: x.olusturan || null,
    olusturmaAt: iso(x.olusturma_at),
    guncelleyen: x.guncelleyen || null,
    guncellemeAt: iso(x.guncelleme_at),
  };
}

/** Kullanici bu olayi degistirebilir mi? Ekleyen ya da Admin. Ad buyuk/kucuk harf duyarsiz. */
function yetkili(olay, kullanici) {
  if (!kullanici) return false;
  if (kullanici.role === 'Admin') return true;
  const a = String(olay?.olusturan || '')
    .trim()
    .toLowerCase();
  const b = String(kullanici.username || '')
    .trim()
    .toLowerCase();
  return !!a && a === b;
}

async function listele(db) {
  const r = await db.query(
    `SELECT TOP (${EN_COK_KAYIT}) id, oco_no, baslik, aciklama, baslangic, bitis, olusturan, olusturma_at, guncelleyen, guncelleme_at
       FROM oco_manuel_olaylar ORDER BY baslangic DESC, id DESC`,
    [],
  );
  const rows = (r.rows || []).map(satirdan);
  return { olaylar: rows, kirpildi: rows.length >= EN_COK_KAYIT };
}

async function getir(db, id) {
  const r = await db.query(
    `SELECT id, oco_no, baslik, aciklama, baslangic, bitis, olusturan, olusturma_at, guncelleyen, guncelleme_at
       FROM oco_manuel_olaylar WHERE id = $1`,
    [id],
  );
  const x = (r.rows || [])[0];
  return x ? satirdan(x) : null;
}

async function ekle(db, v, kim) {
  const r = await db.query(
    `INSERT INTO oco_manuel_olaylar (oco_no, baslik, aciklama, baslangic, bitis, olusturan, guncelleyen) OUTPUT INSERTED.id VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [v.ocoNo, v.baslik, v.aciklama, v.baslangic, v.bitis, kim],
  );
  const id = Number((r.rows || [])[0]?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Kayıt eklendi ama kimliği okunamadı.');
  return getir(db, id);
}

async function guncelle(db, id, v, kim) {
  await db.query(
    `UPDATE oco_manuel_olaylar SET oco_no = $2, baslik = $3, aciklama = $4, baslangic = $5, bitis = $6, guncelleyen = $7, guncelleme_at = GETUTCDATE() WHERE id = $1`,
    [id, v.ocoNo, v.baslik, v.aciklama, v.baslangic, v.bitis, kim],
  );
  return getir(db, id);
}

async function sil(db, id) {
  await db.query(`DELETE FROM oco_manuel_olaylar WHERE id = $1`, [id]);
}

/** ":id" parametresi -> pozitif tamsayi ya da null. */
function idCoz(v) {
  const s = String(v == null ? '' : v);
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 2147483647 ? n : null;
}

module.exports = {
  dogrula,
  satirdan,
  yetkili,
  listele,
  getir,
  ekle,
  guncelle,
  sil,
  idCoz,
  BASLIK_EN_COK,
  ACIKLAMA_EN_COK,
  EN_COK_KAYIT,
};
