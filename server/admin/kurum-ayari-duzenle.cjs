// server/admin/kurum-ayari-duzenle.cjs - Admin > Kurum Ayari: KURUM_AYAR_DOSYASI'ni Portal'dan
// okuma, duzenleme, yedekten geri donme (2026-11-27).
//
// Okuma tarafi DEGISMEDI: server/util/kurum-ayari.cjs dosyayi her erisimde degisiklik zamanina gore
// okur; burada yazilan dosya yeniden baslatma olmadan gecerli olur. Bu modul yalniz yazar:
//   * iyimser kilit: istemci okudugu icerigin sha256'sini (oncekiSha) yollar; diskteki farkliysa 409
//     (baskasi ya da sunucuda elle degistirildi). Kontrol, yedek ve yazma tek senkron adimdir: ayni
//     surecte iki istek araya giremez.
//   * icerik bir JSON NESNESI, en cok MAKS_BAYT, en cok MAKS_DERINLIK ic ice; ust duzey bolum silmek /
//     bosaltmak ve dolu bir sunucu alanini silmek ayrica onay ister (428, shared onayliSilmeler).
//   * bilinen sunucu adi alanlarinda YENI ihlal reddedilir (shared/kurumAyari.cjs SUNUCU_ALANLARI):
//     okuyan taraf gecersiz girdiyi sessizce atar, yazim hatasi sunucuyu otomasyondan dusururdu.
//   * geri yukleme: icerik gercekten o yedegin icerigi olmali (sha), yoksa 400.
//   * repo calisma agacindaki dosya (yerel gelistirmede izlenen ornek dosya) yazilmaz: 409 repo-ici.
//   * salt okunur dosya (W_OK yok) yazilmaz: rename dizin iznini yeterli sayardi, yonetici kilidi asilirdi.
//   * once yedek: <dosya>.yedek/<zaman>.json (dosyanin yaninda, en cok MAKS_YEDEK, eskiler budanir;
//     az once alinan yedek hic budanmaz). Yazma basarisizsa yeni yedek silinir.
//   * atomik yazma: ayni dizinde gecici dosya + fsync + rename; ozgun dosya modu korunur; sembolik
//     bagda hedef dosya yazilir (bag korunur).
//   * yazdiktan sonra okuyucu (kurumAyari) yeniden okur, veri gonderilenle ayni mi dogrular.
//   * degisen anahtar yollari YAZMADAN ONCE hesaplanir: denetim kaydi, yazmadan sonraki her hatada da
//     (result=fail) dusar.
//   * GET disi 5xx yaniti 424 + upstreamStatus + nginxRed (util/nginx-red.cjs): kurumsal nginx 5xx
//     govdesini HTML ile degistirir, izin hatasi ekrana ulasmazdi.
// Dosya ya da dizin OLUSTURULMAZ (yalniz yedek alt dizini). Icerik loglanmaz, yanita ve denetime
// degerler yazilmaz: denetimde yalniz degisen anahtar yollari durur. Belge: docs/KURUM-AYARI.md.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { kurumAyari, kurumAyariOnbellekSifirla } = require('../util/kurum-ayari.cjs');
const {
  MAKS_DERINLIK,
  derinlikAsildi,
  farkHesapla,
  farkYollari,
  onayliSilmeler,
  yeniSunucuIhlalleri,
} = require('../../shared/kurumAyari.cjs');

const ENV_ADI = 'KURUM_AYAR_DOSYASI';
const MAKS_BAYT = 1024 * 1024;
const MAKS_YEDEK = 30;
// Yedek adi: 20261127T101112345Z.json (cakisirsa -1..-99). Istemciden gelen ad bu kaliba uymali.
const YEDEK_AD = /^(\d{8}T\d{9}Z)(?:-(\d{1,2}))?\.json$/;
const SHA = /^[a-f0-9]{64}$/;
const YAZMA_PENCERESI_MS = 60_000;
const YAZMA_SINIRI = 10;
const IZIN_KODLARI = new Set(['EACCES', 'EPERM', 'EROFS']);
const DISK_KODLARI = new Set(['ENOSPC', 'EDQUOT']);
const DENETIM_YOL_SINIRI = 40;
const DENETIM_METIN_SINIRI = 1990;
// Repo koku: yerel gelistirmede KURUM_AYAR_DOSYASI izlenen ornek dosyayi gosterir (.env.example).
const REPO_KOKU = path.resolve(__dirname, '..', '..');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const nesneMi = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Yanit hatasi: durum kodu + makine kodu + ek alanlar (icerik degeri TASIMAZ). */
class AyarHatasi extends Error {
  constructor(status, code, message, ek = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.ek = ek;
    // Denetime result=fail olarak yazilir mi (yazma girisimi) ve hangi anahtar yollariyla.
    this.denetle = false;
    this.yollar = null;
  }
}

function dosyaYolu() {
  const ham = String(process.env[ENV_ADI] ?? '').trim();
  return ham ? path.resolve(ham) : '';
}

/** Sembolik bag ise hedef dosya (rename bagi duz dosyayla ezmesin). */
function gercekYol(yol) {
  try {
    return fs.realpathSync(yol);
  } catch {
    return yol;
  }
}

/** Dosya bir git calisma agacinin (bu repo) icinde mi: oradaki dosya Portal'dan yazilmaz. */
function repoIciMi(gercek, kok = REPO_KOKU) {
  if (!fs.existsSync(path.join(kok, '.git'))) return false;
  const rel = path.relative(gercekYol(kok), gercek);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const yedekDizini = (gercek) => path.join(path.dirname(gercek), `${path.basename(gercek)}.yedek`);

/** JSON.parse hatasindan yalniz konum (mesaj icerikten parca alintilayabilir). */
function jsonHataKonumu(e, metin) {
  const m = /position (\d+)/.exec(String(e?.message || ''));
  if (!m) return 'geçerli bir JSON değil';
  const once = metin.slice(0, Number(m[1])).split('\n');
  return `geçerli bir JSON değil (satır ${once.length}, sütun ${once.at(-1).length + 1})`;
}

const OKUMA_HATASI = {
  ENOENT: 'dosya bulunamadı',
  EACCES: 'okuma izni yok',
  EPERM: 'okuma izni yok',
  EISDIR: 'yol bir dosya değil, dizin',
  ENOTDIR: 'yoldaki bir parça dizin değil',
};
const okumaHatasi = (e) => `${OKUMA_HATASI[e?.code] || 'okunamadı'} (${e?.code || 'hata'})`;

function izinMetni(e) {
  return (
    `Kurum ayar dosyasına yazılamadı (${e.code}). Portal'ın çalıştığı kullanıcının dosyaya VE ` +
    'bulunduğu dizine yazma izni olmalı: dosya salt okunursa kayıt reddedilir; yedek alt dizini ve ' +
    'atomik yazmanın geçici dosyası aynı dizinde oluşturulur. Dosya değişmedi.'
  );
}

function erisebilir(yol, mod) {
  try {
    fs.accessSync(yol, mod);
    return true;
  } catch {
    return false;
  }
}

/** Ekran icin dosya durumu ve icerigi. */
function durumOku() {
  const yol = dosyaYolu();
  const temel = {
    envAdi: ENV_ADI,
    envTanimli: !!yol,
    dosyaAdi: yol ? path.basename(yol) : null,
    sinirlar: { maksBayt: MAKS_BAYT, maksYedek: MAKS_YEDEK, maksDerinlik: MAKS_DERINLIK },
  };
  const bos = { okunabilir: false, gecerli: false, icerik: null, sha: null, bolumler: [] };
  if (!yol) return { ...temel, ...bos, hata: `${ENV_ADI} tanımlı değil` };
  let st;
  let buf;
  try {
    st = fs.statSync(yol);
    buf = fs.readFileSync(yol);
  } catch (e) {
    return { ...temel, ...bos, hata: okumaHatasi(e) };
  }
  const icerik = buf.toString('utf8');
  let veri = null;
  let hata = null;
  try {
    const n = JSON.parse(icerik);
    if (nesneMi(n)) veri = n;
    else hata = 'bir JSON nesnesi değil';
  } catch (e) {
    hata = jsonHataKonumu(e, icerik);
  }
  const gercek = gercekYol(yol);
  return {
    ...temel,
    okunabilir: true,
    gecerli: !hata,
    hata,
    icerik,
    sha: sha256(buf),
    boyut: st.size,
    mtime: st.mtime.toISOString(),
    dosyaYazilabilir: erisebilir(gercek, fs.constants.W_OK),
    dizinYazilabilir: erisebilir(path.dirname(gercek), fs.constants.W_OK),
    repoIci: repoIciMi(gercek),
    bolumler: veri ? Object.keys(veri) : [],
  };
}

function yedekDiziniHatasi(dizin, neden) {
  return new AyarHatasi(
    500,
    'yedek-dizini',
    `${path.basename(dizin)} ${neden}; yedek alınmadı, dosya değişmedi. Sunucuda düzeltin.`,
  );
}

/** Var olan yedek dizininin bilgisi; gercek dizin olmali (sembolik bag / dosya degil). Yoksa null. */
function yedekDiziniVar(dizin) {
  const st = fs.lstatSync(dizin, { throwIfNoEntry: false });
  if (!st) return null;
  if (st.isSymbolicLink() || !st.isDirectory())
    throw yedekDiziniHatasi(dizin, 'bir dizin değil (sembolik bağ ya da dosya)');
  return st;
}

/** Yedek dizinini hazirlar: yoksa 0700 olusturur; varsa gercek dizin olmali, gevsek izni daraltilir. */
function yedekDiziniHazirla(gercek) {
  const dizin = yedekDizini(gercek);
  const st = yedekDiziniVar(dizin);
  if (!st) {
    fs.mkdirSync(dizin, { mode: 0o700 });
    return dizin;
  }
  if (process.platform !== 'win32' && st.mode & 0o077) {
    try {
      fs.chmodSync(dizin, 0o700);
    } catch {
      throw yedekDiziniHatasi(
        dizin,
        `izinleri gevşek (${(st.mode & 0o777).toString(8)}) ve 0700 yapılamadı`,
      );
    }
  }
  return dizin;
}

/** Yedek siralamasi: zaman, sonra cakisma eki SAYI olarak; en yeni once. */
function yedekKarsilastir(a, b) {
  const ma = YEDEK_AD.exec(a);
  const mb = YEDEK_AD.exec(b);
  if (ma[1] !== mb[1]) return ma[1] < mb[1] ? 1 : -1;
  return Number(mb[2] || 0) - Number(ma[2] || 0);
}

function yedekAdlari(gercek) {
  const dizin = yedekDizini(gercek);
  if (!yedekDiziniVar(dizin)) return [];
  return fs
    .readdirSync(dizin)
    .filter((a) => YEDEK_AD.test(a))
    .sort(yedekKarsilastir);
}

/** 20261127T101112345Z -> ISO zaman. */
function yedekZamani(ad) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z/.exec(ad);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : null;
}

function yedekleriListele() {
  const yol = dosyaYolu();
  if (!yol) return [];
  const gercek = gercekYol(yol);
  const dizin = yedekDizini(gercek);
  return yedekAdlari(gercek).map((ad) => {
    const buf = fs.readFileSync(path.join(dizin, ad));
    return { ad, zaman: yedekZamani(ad), boyut: buf.length, shaKisa: sha256(buf).slice(0, 12) };
  });
}

const adGecerli = (ad) => typeof ad === 'string' && YEDEK_AD.test(ad) && path.basename(ad) === ad;

/** Yol gecisi yok: ad siki kaliba uymali ve yalin dosya adi olmali. */
function yedekBaytlari(gercek, ad) {
  if (!adGecerli(ad)) throw new AyarHatasi(400, 'yedek-adi', 'Geçersiz yedek adı.');
  const dizin = yedekDizini(gercek);
  if (!yedekDiziniVar(dizin)) throw new AyarHatasi(404, 'yedek-yok', 'Yedek bulunamadı.');
  try {
    return fs.readFileSync(path.join(dizin, ad));
  } catch (e) {
    if (e.code === 'ENOENT') throw new AyarHatasi(404, 'yedek-yok', 'Yedek bulunamadı.');
    throw e;
  }
}

function yedekOku(ad) {
  const yol = dosyaYolu();
  if (!yol) throw new AyarHatasi(503, 'env-yok', `${ENV_ADI} tanımlı değil.`);
  const buf = yedekBaytlari(gercekYol(yol), ad);
  return { ad, zaman: yedekZamani(ad), icerik: buf.toString('utf8'), sha: sha256(buf) };
}

function yedekAdiUret(dizin, simdi) {
  const kok = simdi.toISOString().replaceAll(/[-:.]/g, '');
  for (let i = 0; i < 100; i++) {
    const ad = i ? `${kok}-${i}.json` : `${kok}.json`;
    if (!fs.existsSync(path.join(dizin, ad))) return ad;
  }
  throw new AyarHatasi(500, 'yedek-adi', 'Yedek adı üretilemedi.');
}

/** Diskteki eski hali yedekler; yedek adini dondurur. Yarida kalan yedek silinir. */
function yedekAl(gercek, buf, simdi) {
  const dizin = yedekDiziniHazirla(gercek);
  const ad = yedekAdiUret(dizin, simdi);
  const hedef = path.join(dizin, ad);
  const fd = fs.openSync(hedef, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(fd, buf);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    fs.rmSync(hedef, { force: true });
    throw e;
  }
  return ad;
}

/** En yeni MAKS_YEDEK yedek kalir (az once alinan `koru` her zaman); budanan sayisi doner. */
function yedekleriBuda(gercek, koru) {
  const digerleri = yedekAdlari(gercek).filter((a) => a !== koru);
  const fazla = digerleri.slice(MAKS_YEDEK - 1);
  for (const ad of fazla) fs.unlinkSync(path.join(yedekDizini(gercek), ad));
  return fazla.length;
}

function dizinFsync(dizin) {
  // Windows'ta dizin acilamaz / fsync edilemez: rename yine de tamamdir.
  try {
    const fd = fs.openSync(dizin, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* dizin fsync desteklenmiyor */
  }
}

/** Ayni dizinde gecici dosya + fsync + rename; mod korunur. */
function atomikYaz(gercek, buf, mod) {
  const dizin = path.dirname(gercek);
  const gecici = path.join(
    dizin,
    `.${path.basename(gercek)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let fd = null;
  try {
    fd = fs.openSync(gecici, 'wx', mod);
    fs.writeFileSync(fd, buf);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.chmodSync(gecici, mod);
    fs.renameSync(gecici, gercek);
  } catch (e) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(gecici, { force: true });
    throw e;
  }
  dizinFsync(dizin);
}

function govdeDogrula(b) {
  if (typeof b.icerik !== 'string') throw new AyarHatasi(400, 'icerik', 'icerik bir metin olmalı.');
  if (typeof b.oncekiSha !== 'string' || !SHA.test(b.oncekiSha))
    throw new AyarHatasi(400, 'onceki-sha', 'oncekiSha (64 karakter sha256) gerekli.');
  if (b.geriYuklenenYedek !== undefined && !adGecerli(b.geriYuklenenYedek))
    throw new AyarHatasi(400, 'yedek-adi', 'Geçersiz yedek adı.');
  const buf = Buffer.from(b.icerik, 'utf8');
  if (buf.length > MAKS_BAYT)
    throw new AyarHatasi(413, 'boyut', `İçerik en çok ${MAKS_BAYT} bayt olabilir (${buf.length}).`);
  let veri;
  try {
    veri = JSON.parse(b.icerik);
  } catch (e) {
    throw new AyarHatasi(400, 'json', `İçerik ${jsonHataKonumu(e, b.icerik)}.`);
  }
  if (!nesneMi(veri)) throw new AyarHatasi(400, 'json', 'İçerik bir JSON nesnesi olmalı.');
  if (derinlikAsildi(veri))
    throw new AyarHatasi(400, 'derinlik', `İçerik en çok ${MAKS_DERINLIK} düzey iç içe olabilir.`);
  return { buf, veri };
}

function mevcutOku(yol) {
  try {
    return { st: fs.statSync(yol), buf: fs.readFileSync(yol) };
  } catch (e) {
    if (e.code === 'ENOENT')
      throw new AyarHatasi(
        503,
        'dosya-yok',
        `${path.basename(yol)} bulunamadı. Portal dosya oluşturmaz: dosyayı sunucuda oluşturun.`,
      );
    if (IZIN_KODLARI.has(e.code)) {
      const h = new AyarHatasi(500, 'okuma-izni', izinMetni(e));
      h.denetle = true;
      throw h;
    }
    throw e;
  }
}

function eskiVeri(buf) {
  try {
    const n = JSON.parse(buf.toString('utf8'));
    return nesneMi(n) ? n : null;
  } catch {
    return null;
  }
}

function onKosullar(b, yeniSha, yeni, eski, gercek) {
  if (
    b.geriYuklenenYedek !== undefined &&
    sha256(yedekBaytlari(gercek, b.geriYuklenenYedek)) !== yeniSha
  )
    throw new AyarHatasi(
      400,
      'yedek-uyusmuyor',
      'Geri yüklenen içerik bu yedeğin içeriği değil. Yedeği yeniden seçip olduğu gibi geri yükleyin.',
    );
  const { bolumler, sunucuAlanlari } = onayliSilmeler(eski || {}, yeni);
  if ((bolumler.length || sunucuAlanlari.length) && b.bolumSilmeOnayi !== true) {
    const parca = [];
    if (bolumler.length) parca.push(`silinen ya da boşaltılan bölüm: ${bolumler.join(', ')}`);
    if (sunucuAlanlari.length) parca.push(`silinen sunucu alanı: ${sunucuAlanlari.join(', ')}`);
    throw new AyarHatasi(
      428,
      'bolum-silme-onayi',
      `${parca.join('; ')}. Kaydetmek için ayrıca onaylayın.`,
      { silinenBolumler: bolumler, silinenSunucuAlanlari: sunucuAlanlari },
    );
  }
  const ihlaller = yeniSunucuIhlalleri(eski || {}, yeni).map(({ yol, neden }) => ({ yol, neden }));
  if (ihlaller.length)
    throw new AyarHatasi(
      400,
      'sunucu-adi',
      `Sunucu adı kuralına uymayan ${ihlaller.length} girdi var (harfle başlar; harf, rakam, tire).`,
      { ihlaller: ihlaller.slice(0, 50) },
    );
}

/** Yazma asamasindaki her hata: adlandirilir, denetime fail olarak yazilir (yollarla). */
function yazmaHatasi(e, yollar) {
  let h;
  if (e instanceof AyarHatasi) h = e;
  else if (IZIN_KODLARI.has(e?.code)) h = new AyarHatasi(500, 'yazma-izni', izinMetni(e));
  else if (DISK_KODLARI.has(e?.code))
    h = new AyarHatasi(
      500,
      'disk-dolu',
      `Kurum ayar dosyasının diskinde yer yok (${e.code}); dosya değişmedi. Sunucuda yer açın.`,
    );
  else
    h = new AyarHatasi(
      500,
      'yazma-hatasi',
      `Kurum ayarı yazılırken beklenmeyen hata (${e?.code || e?.name || 'hata'}). Dosyanın son halini görmek için ekranı yenileyin.`,
    );
  h.denetle = true;
  h.yollar = yollar;
  return h;
}

/**
 * Kaydet: dogrula -> kilit -> on kosullar -> yollar -> yedek -> atomik yaz -> budama -> okuyucuyla
 * dogrula.
 * @returns {{ degisiklikYok?: boolean, sha: string, yedek?: string, budanan?: number,
 *   yollar?: {eklenen: string[], silinen: string[], degisen: string[]} }}
 */
function kaydet(b, simdi = new Date()) {
  const yol = dosyaYolu();
  if (!yol)
    throw new AyarHatasi(
      503,
      'env-yok',
      `${ENV_ADI} tanımlı değil: Portal'ın düzenleyeceği bir kurum ayar dosyası yok.`,
    );
  const { buf, veri } = govdeDogrula(b);
  const mevcut = mevcutOku(yol);
  const gercek = gercekYol(yol);
  if (repoIciMi(gercek))
    throw new AyarHatasi(
      409,
      'repo-ici',
      `${path.basename(yol)} repo çalışma ağacının içinde (izlenen dosya); Portal'dan yazılmaz. Denemek için dosyayı repo dışına kopyalayıp ${ENV_ADI} ile gösterin.`,
    );
  const oncekiSha = sha256(mevcut.buf);
  if (oncekiSha !== b.oncekiSha)
    throw new AyarHatasi(
      409,
      'cakisma',
      'Dosya siz düzenlerken değişti (başka bir yönetici ya da sunucuda elle). Yeniden yükleyip değişikliği tekrar uygulayın.',
      { sha: oncekiSha },
    );
  const yeniSha = sha256(buf);
  if (yeniSha === oncekiSha) return { degisiklikYok: true, sha: oncekiSha };
  const eski = eskiVeri(mevcut.buf);
  onKosullar(b, yeniSha, veri, eski, gercek);
  // Denetime gidecek yollar YAZMADAN once: hesap duserse dosyaya dokunulmaz.
  const yollar = farkYollari(farkHesapla(eski || {}, veri));
  let yedek;
  try {
    if (!erisebilir(gercek, fs.constants.W_OK))
      throw Object.assign(new Error('dosya salt okunur'), { code: 'EACCES' });
    yedek = yedekAl(gercek, mevcut.buf, simdi);
    try {
      atomikYaz(gercek, buf, mevcut.st.mode & 0o777);
    } catch (e) {
      // Dosya degismedi: yeni yedek ayni icerigin kopyasi, kotayi yemesin.
      fs.rmSync(path.join(yedekDizini(gercek), yedek), { force: true });
      yedek = undefined;
      throw e;
    }
    let budanan = 0;
    try {
      budanan = yedekleriBuda(gercek, yedek);
    } catch {
      /* budama yapilamadi: yazim tamam, bir sonraki kayitta yeniden denenir */
    }
    kurumAyariOnbellekSifirla();
    const okunan = kurumAyari();
    const sorun =
      okunan.hata ||
      (sha256(fs.readFileSync(yol)) !== yeniSha && 'içerik farklı') ||
      (JSON.stringify(okunan.veri) !== JSON.stringify(veri) && 'okuyucu eski veriyi görüyor');
    if (sorun)
      throw new AyarHatasi(
        500,
        'dogrulama',
        `Yazıldı ama yeniden okunamadı (${sorun}). Yedek: ${yedek}.`,
      );
    return { sha: yeniSha, yedek, budanan, yollar };
  } catch (e) {
    throw yazmaHatasi(e, yollar);
  }
}

/** Denetim ayrintisi: yalniz anahtar yollari; kirpilan kategori (+N) ile, metin sinira sigar. */
function denetimMetni(b, { sha, yedek, yollar, code }) {
  const liste = (ad, l) => {
    if (!l?.length) return '';
    const fazla = l.length - DENETIM_YOL_SINIRI;
    const ek = fazla > 0 ? ` (+${fazla})` : '';
    return ` ${ad}=${l.slice(0, DENETIM_YOL_SINIRI).join(',')}${ek}`;
  };
  const metin =
    (code ? `code=${code} ` : '') +
    `dosya=${path.basename(dosyaYolu())} sha=${String(b.oncekiSha || '').slice(0, 12)}->${sha ? sha.slice(0, 12) : '-'}` +
    (yedek ? ` yedek=${yedek}` : '') +
    (b.geriYuklenenYedek ? ` geriYuklenen=${b.geriYuklenenYedek}` : '') +
    liste('eklenen', yollar?.eklenen) +
    liste('silinen', yollar?.silinen) +
    liste('degisen', yollar?.degisen);
  if (metin.length <= DENETIM_METIN_SINIRI) return metin;
  return `${metin.slice(0, DENETIM_METIN_SINIRI - 12)} (kirpildi)`;
}

function denetle(req, action, opts) {
  try {
    require('../audit/index.cjs').auditPortal(req, action, opts);
  } catch {
    /* denetim yazilamadi: islem yine de tamam */
  }
}

const kullaniciAdi = (req) => require('../auth/utils.cjs').getRequestUser(req)?.username || '';

// Kullanici basina yazma siniri (genel API sinirinin ustune): kazara dongu dosyayi yedekle bogmasin.
// Anahtar requireAdmin'in kullandigi kimlik (oturum ya da guvenilen baslik); yoksa istemci adresi.
const yazmalar = new Map();
function yazmaSiniri(req, res, next) {
  const k = kullaniciAdi(req) || req.ip || '-';
  const simdi = Date.now();
  const l = (yazmalar.get(k) || []).filter((t) => simdi - t < YAZMA_PENCERESI_MS);
  if (l.length >= YAZMA_SINIRI)
    return res
      .status(429)
      .json({ ok: false, error: 'Çok sık kayıt. Bir dakika sonra tekrar deneyin.' });
  l.push(simdi);
  yazmalar.set(k, l);
  next();
}

/** GET disi 5xx -> 424 + upstreamStatus + nginxRed (kurumsal nginx 5xx govdesini HTML ile degistirir). */
function hataYaniti(req, res, e, etiket) {
  const eylem = req.method !== 'GET' && req.method !== 'HEAD';
  let status = 500;
  let govde = { ok: false, code: 'kurum_ayari_sunucu_hatasi', error: 'Kurum ayarı işlenemedi.' };
  if (e instanceof AyarHatasi) {
    status = e.status;
    govde = { ok: false, code: e.code, error: e.message, ...e.ek };
  } else {
    console.error(`[KurumAyari] ${etiket} hatasi: ${e?.code || e?.name}`);
  }
  if (status >= 500 && eylem)
    return res
      .status(424)
      .json({ ...govde, message: govde.error, upstreamStatus: status, nginxRed: true });
  return res.status(status).json(govde);
}

// Gec require: auth modulu testlerde sahtelenir. Ad route-auth-order RO1b bekcisinin aradigi kapi adidir.
const requireAdmin = (req, res, next) => require('../auth/index.cjs').requireAdmin(req, res, next);

function kurumAyariRouter() {
  const router = express.Router();
  router.get('/', requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, ...durumOku() });
    } catch (e) {
      hataYaniti(req, res, e, 'durum');
    }
  });
  router.get('/yedekler', requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, yedekler: yedekleriListele() });
    } catch (e) {
      hataYaniti(req, res, e, 'yedek listesi');
    }
  });
  router.get('/yedekler/:ad', requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, ...yedekOku(req.params.ad) });
    } catch (e) {
      hataYaniti(req, res, e, 'yedek okuma');
    }
  });
  router.put('/', requireAdmin, yazmaSiniri, (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const action = b.geriYuklenenYedek ? 'kurum_ayari_restore' : 'kurum_ayari_update';
    try {
      const sonuc = kaydet(b);
      if (sonuc.degisiklikYok) return res.json({ ok: true, degisiklikYok: true, sha: sonuc.sha });
      denetle(req, action, { detail: denetimMetni(b, sonuc) });
      console.log(
        `[KurumAyari] ${kullaniciAdi(req) || '-'} kurum ayarini guncelledi (yedek ${sonuc.yedek}).`,
      );
      res.json({ ok: true, ...sonuc });
    } catch (e) {
      if (e instanceof AyarHatasi && e.denetle)
        denetle(req, action, {
          result: 'fail',
          detail: denetimMetni(b, { code: e.code, yollar: e.yollar }),
        });
      hataYaniti(req, res, e, 'kayit');
    }
  });
  return router;
}

function initKurumAyariDuzenle(app) {
  app.use('/api/admin/kurum-ayari', kurumAyariRouter());
  console.log('[KurumAyari] admin uclari /api/admin/kurum-ayari altinda');
}

module.exports = {
  initKurumAyariDuzenle,
  kurumAyariRouter,
  repoIciMi,
  MAKS_BAYT,
  MAKS_YEDEK,
  _yazmaSiniriSifirla: () => yazmalar.clear(),
};
