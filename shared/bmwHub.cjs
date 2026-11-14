// shared/bmwHub.cjs - BMW Hub (acik isler) kurallari: sunucu ve ekran AYNI kurali kullanir.
//
// Kullanici (2026-11-08): "otomasyon tasklari icin bir BMW Hub ve acik isler sayfasi olsun;
// is girebileyim, hangi acik islerin oldugunu, statulerini, deadline tarihlerini, isi kimin
// sahiplendigini goreyim. Sadece adminler gorsun. Talebi acanin ismi de gozuksun."
//
// "SANA KOMUT ATARAK" GIRIS: Portal'a disaridan yazan bir anahtar/token ACILMADI (sir
// Portal'a duz metin girmez kurali). Bunun yerine toplu ekleme metni var: her satir bir is,
// alanlar `|` ile ayrilir. Claude (ya da herkes) bu bicimde satir uretir, admin yapistirir.
// Ayristirici burada durur ki ekrandaki onizleme ile sunucunun kaydettigi BIREBIR ayni olsun.
'use strict';

/** Durumlar. `acikMi`: "acik isler" gorunumune girer mi. Sira ekrandaki siradir. */
const DURUMLAR = [
  { key: 'acik', label: 'Açık', acikMi: true },
  { key: 'devam', label: 'Devam ediyor', acikMi: true },
  { key: 'bekliyor', label: 'Beklemede', acikMi: true },
  { key: 'tamam', label: 'Tamamlandı', acikMi: false },
  { key: 'iptal', label: 'İptal edildi', acikMi: false },
];

const ONCELIKLER = [
  { key: 'yuksek', label: 'Yüksek' },
  { key: 'orta', label: 'Orta' },
  { key: 'dusuk', label: 'Düşük' },
];

const SINIR = { baslik: 300, aciklama: 8000, kisi: 200, beklenen: 500, kategori: 100, not: 4000, toplu: 200 };

const VARSAYILAN_KATEGORI = 'Otomasyon';

/** Turkce harfleri sadelestirip kucuk harfe cevirir (eslestirme icin; gosterim icin degil). */
function sade(s) {
  return String(s == null ? '' : s)
    .trim()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ');
}

const DURUM_ES = {
  acik: 'acik', yeni: 'acik', open: 'acik', todo: 'acik',
  devam: 'devam', 'devam ediyor': 'devam', suruyor: 'devam', 'in progress': 'devam', progress: 'devam',
  bekliyor: 'bekliyor', beklemede: 'bekliyor', bekleniyor: 'bekliyor', blocked: 'bekliyor', waiting: 'bekliyor',
  tamam: 'tamam', tamamlandi: 'tamam', bitti: 'tamam', done: 'tamam', kapandi: 'tamam',
  iptal: 'iptal', 'iptal edildi': 'iptal', cancelled: 'iptal', canceled: 'iptal',
};

const ONCELIK_ES = {
  yuksek: 'yuksek', y: 'yuksek', high: 'yuksek', acil: 'yuksek', kritik: 'yuksek',
  orta: 'orta', o: 'orta', medium: 'orta', normal: 'orta',
  dusuk: 'dusuk', d: 'dusuk', low: 'dusuk',
};

/** Serbest yazilmis durumu anahtara cevirir; taninmazsa null. */
function durumCoz(s) {
  const k = sade(s);
  if (!k) return null;
  return DURUM_ES[k] || null;
}

/** Serbest yazilmis onceligi anahtara cevirir; taninmazsa null. */
function oncelikCoz(s) {
  const k = sade(s);
  if (!k) return null;
  return ONCELIK_ES[k] || null;
}

function gecerliGun(y, a, g) {
  if (y < 2000 || y > 2100 || a < 1 || a > 12 || g < 1) return false;
  const d = new Date(Date.UTC(y, a - 1, g));
  return d.getUTCFullYear() === y && d.getUTCMonth() === a - 1 && d.getUTCDate() === g;
}

const iki = (n) => String(n).padStart(2, '0');

/**
 * Son tarihi `YYYY-MM-DD` bicimine cevirir. Kabul: 2026-11-20, 20.11.2026, 20/11/2026, 20-11-2026.
 * Bos -> '' (tarih yok). Gecersiz -> null (cagiran hata verir; sessizce tarihsiz kaydedilmez).
 */
function tarihCoz(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [y, a, g] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return gecerliGun(y, a, g) ? `${y}-${iki(a)}-${iki(g)}` : null;
  }
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const [g, a, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return gecerliGun(y, a, g) ? `${y}-${iki(a)}-${iki(g)}` : null;
  }
  return null;
}

const DURUM_KEYS = new Set(DURUMLAR.map((d) => d.key));
const ONCELIK_KEYS = new Set(ONCELIKLER.map((o) => o.key));

const metin = (v) => (v == null ? '' : String(v)).trim();

/**
 * Bir is kaydini dogrular ve normallestirir. `kismi` = PATCH: yalniz gelen alanlar denetlenir.
 * Donus: { deger, hatalar } — hatalar bos degilse kayit YAPILMAZ.
 */
function isDogrula(girdi, { kismi = false } = {}) {
  const g = girdi && typeof girdi === 'object' ? girdi : {};
  const deger = {};
  const hatalar = [];
  const var_ = (k) => Object.hasOwn(g, k);

  if (!kismi || var_('baslik')) {
    const b = metin(g.baslik);
    if (!b) hatalar.push('Başlık gerekli.');
    else if (b.length > SINIR.baslik) hatalar.push(`Başlık en çok ${SINIR.baslik} karakter olabilir.`);
    deger.baslik = b;
  }
  if (!kismi || var_('aciklama')) {
    const a = metin(g.aciklama);
    if (a.length > SINIR.aciklama) hatalar.push(`Açıklama en çok ${SINIR.aciklama} karakter olabilir.`);
    deger.aciklama = a;
  }
  if (!kismi || var_('durum')) {
    const d = metin(g.durum) || 'acik';
    if (!DURUM_KEYS.has(d)) hatalar.push(`Tanınmayan durum: ${d}`);
    deger.durum = d;
  }
  if (!kismi || var_('oncelik')) {
    const o = metin(g.oncelik) || 'orta';
    if (!ONCELIK_KEYS.has(o)) hatalar.push(`Tanınmayan öncelik: ${o}`);
    deger.oncelik = o;
  }
  if (!kismi || var_('sahip')) {
    const s = metin(g.sahip);
    if (s.length > SINIR.kisi) hatalar.push(`Sahip adı en çok ${SINIR.kisi} karakter olabilir.`);
    deger.sahip = s;
  }
  if (!kismi || var_('beklenen')) {
    const s = metin(g.beklenen);
    if (s.length > SINIR.beklenen) hatalar.push(`"Ne bekleniyor" en çok ${SINIR.beklenen} karakter olabilir.`);
    deger.beklenen = s;
  }
  if (!kismi || var_('kategori')) {
    const s = metin(g.kategori) || VARSAYILAN_KATEGORI;
    if (s.length > SINIR.kategori) hatalar.push(`Kategori en çok ${SINIR.kategori} karakter olabilir.`);
    deger.kategori = s;
  }
  if (!kismi || var_('sonTarih')) {
    const t = tarihCoz(g.sonTarih);
    if (t === null) hatalar.push(`Son tarih anlaşılamadı: "${metin(g.sonTarih)}" (örnek: 2026-11-20 ya da 20.11.2026).`);
    deger.sonTarih = t || '';
  }
  return { deger, hatalar };
}

/**
 * Toplu ekleme metnini ayristirir. Her dolu satir bir is:
 *   Baslik | Sahip | Son tarih | Oncelik | Durum | Ne bekleniyor | Aciklama
 * Yalniz baslik zorunlu; sondaki alanlar atlanabilir, aradaki bos birakilabilir (`a || 20.11.2026`).
 * `#` ile baslayan satir ve bos satir yok sayilir; basindaki `- `, `* `, `1. ` atilir.
 * Donus: [{ satir, deger, hatalar }] — hatali satir da listede kalir (ekran gosterir, kaydetmez).
 */
function topluAyristir(text) {
  const sonuc = [];
  const satirlar = String(text == null ? '' : text).split(/\r?\n/);
  satirlar.forEach((ham, i) => {
    let s = ham.trim();
    if (!s || s.startsWith('#')) return;
    s = s.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '');
    const p = s.split('|').map((x) => x.trim());
    const [baslik, sahip, sonTarih, oncelikHam, durumHam, beklenen, ...kalan] = p;
    const aciklama = kalan.join(' | ');
    const hatalar = [];
    const oncelik = oncelikHam ? oncelikCoz(oncelikHam) : 'orta';
    if (oncelikHam && !oncelik) hatalar.push(`Tanınmayan öncelik: "${oncelikHam}" (yüksek / orta / düşük).`);
    const durum = durumHam ? durumCoz(durumHam) : 'acik';
    if (durumHam && !durum) hatalar.push(`Tanınmayan durum: "${durumHam}" (açık / devam / beklemede / tamam / iptal).`);
    const v = isDogrula({
      baslik,
      sahip,
      sonTarih,
      oncelik: oncelik || 'orta',
      durum: durum || 'acik',
      beklenen,
      aciklama,
    });
    sonuc.push({ satir: i + 1, deger: v.deger, hatalar: hatalar.concat(v.hatalar) });
  });
  return sonuc;
}

/** Bugunun `YYYY-MM-DD`si (Istanbul saati; sunucu UTC'de olsa da gecikme ayni gun dogru cikar). */
function bugunIst(simdi) {
  const d = new Date((simdi == null ? Date.now() : simdi) + 3 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${iki(d.getUTCMonth() + 1)}-${iki(d.getUTCDate())}`;
}

/** Acik bir isin son tarihi gecti mi. Tamamlanan / iptal edilen is gecikmis sayilmaz. */
function gecikmisMi(is, bugun) {
  if (!is?.sonTarih) return false;
  const d = DURUMLAR.find((x) => x.key === is.durum);
  if (!d?.acikMi) return false;
  return is.sonTarih < (bugun || bugunIst());
}

module.exports = {
  DURUMLAR,
  ONCELIKLER,
  SINIR,
  VARSAYILAN_KATEGORI,
  durumCoz,
  oncelikCoz,
  tarihCoz,
  isDogrula,
  topluAyristir,
  bugunIst,
  gecikmisMi,
};
