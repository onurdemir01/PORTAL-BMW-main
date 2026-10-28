// server/nginx-loadtest/sonuc.cjs -- Yuk Testi kosu dizini okuyucu (<NGINX_LOADTEST_DIR>/<runId>/).
//
// NE OKUR: nginx_loadtest.yml (kosu modu) iki makinedeki kit ciktilarini toplayip Portal'in /sw
// kosu dizinine DUZ (alt dizinsiz) yazar. Bu modul o dizini okur ve analiz.cjs'in bekledigi
// KosuVerisi'ni kurar; el kitinin karsilastir.py `Adim.yukle()` adiminin karsiligidir:
//   istemci_<TUR>.csv            yuk_k6.js ozeti (kos.sh'in basarili saydigi kosu) ya da wrk_kos.sh'in ayni
//                                semali awk ciktisi (wrk'nin olcemedigi hucreler bos: analizde null)
//   hatali_istemci_<TUR>.csv     kos.sh / wrk_kos.sh'in DUR dedigi kosu (429 / 5xx / http2 / rc!=0 / olcum yok)
//   zaman.csv, baslatilan.csv    kos.sh: bitis ve baslangic damgalari
//   sunucu_<ADIM>_<host>.csv     cpu_kaydedici.sh: saniyelik worker/host CPU ornekleri
//   bilgi_<ADIM>_<host>.txt      cpu_kaydedici.sh: nproc, clk_tck, df, konf ozeti, gecersiz=
//   log_<ADIM>_<host>.tsv.gz     cpu_kaydedici.sh: YALNIZ test isteklerinin log satirlari (gzip)
//   diger_<ADIM>_<host>.tsv      cpu_kaydedici.sh: test disi istek sayisi / saniye
//   konf_*.txt, NOT.txt, istemci_*.json, SHA256SUMS
// Hepsi istege bagli: eksik dosya analizde "olculmedi" (null) ya da GECERSIZ nedeni olur, okuma
// hatasi OLMAZ. karsilastir.py'nin glob/sirasi korunur (ad sirasina gore, buyuk-kucuk harf duyarli).
// Serbest hedef kosusunda (kaydedici yok) dizinde yalniz yuk makinesinin dosyalari olur (istemci_*,
// hatali_istemci_*, zaman.csv, baslatilan.csv, SHA256SUMS); okuyucu motor / hedef turu bilmez, sunucu
// dosyalarini serbestte yok sayan analizdir (analiz.cjs PORTAL FARKLARI 8).
//
// OKUNAMADI != GECERSIZ. Su durumlarda `.code = 'OKUNAMADI'` ile hata atilir ve analiz YAPILMAZ:
// dizin yok/okunamiyor, bayt ya da dosya tavani asildi, gzip bozuk, SHA256SUMS'te listelenen dosya
// yok ya da ozeti tutmuyor (kopya yarim), bilinen adli bir girdi normal dosya degil (symlink),
// ya da karsilastir.py'nin de kullanim hatasi saydigi bicim bozuklugu (sunucu_*.csv kolonu eksik,
// log_*.tsv basligi taninmadi). Cagiran (poller) satiri oldugu gibi birakir; "okunamadi" hicbir
// zaman "basarili" ya da "gecersiz" diye yazilmaz.
//
// BELLEK (OOM dersi, bkz. audit/spool.cjs): varsayilan bir K adiminin log_*.tsv'si ~225k satir,
// en kotu butcede ~1M satir. Hicbir dosya bellege toptan alinmaz: her dosya akisla okunur
// (fs -> sha256 -> [gunzip] -> tavan -> satir bolucu), toplam ACILMIS bayt `maxBayt`i gecerse akis
// kesilir (gzip bombasi da burada durur). Log satirlari nesne olarak degil, TUR basina sutunlu
// tipli dizilerde tutulur (~45 bayt/satir). Tek satir MAX_SATIR_KAR'i asarsa atlanir (sayilir).
// Bayt tavani TEK BASINA YETMEZ (inceleme guvenlik-log-tur-oom): log'a test UA'siyla disaridan
// sizan 200k farkli TUR 12 MiB'lik dosyada +3.2 GB, 8 MiB'lik 'a\n' zaman.csv'si +0.9 GB demekti.
// Bu yuzden: `adim` verilirse yalniz `<adim>_` ile baslayan TUR'lar depoya girer (digerleri tek
// uyariyla sayilir); depoda en cok MAX_TUR farkli TUR (asilirsa OKUNAMADI); Kolon kucuk baslar; her
// okuyucunun satir/anahtar tavani var (SATIR_TAVANI; asilirsa dosya adiyla OKUNAMADI).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { StringDecoder } = require('node:string_decoder');

const VARSAYILAN_MAX_BAYT = 200 * 1024 * 1024;
// Bir kosu dizininde beklenen: TUR basina 2-4 istemci dosyasi (<= 15 TUR) + ~10 kaydedici dosyasi.
const MAX_DOSYA = 500;
const MAX_SATIR_KAR = 64 * 1024;
// Bir Portal kosusu en cok 5 hiz x 3 tekrar = 15 TUR uretir (yeniden deneme ayni TUR adini kullanir).
// Her yeni TUR yeni kolonlar actigindan farkli TUR sayisi bellek sinirinin parcasidir.
const MAX_TUR = 64;
// Kolon baslangic kapasitesi (ikiye katlayarak buyur): yeni bir TUR ~1 KB ayirir, ~11 KB degil.
const KOLON_ILK = 16;
// Okuyucu basina tavanlar: csv/sunucu = tutulan satir, diger = farkli saniye (dosyalar arasi ortak),
// bilgi_liste = uyari= / gecersiz= satirlarinin HER BIRI. Gercek kosular bunlarin cok altinda. log= TAVANSIZ:
// kaydedici /web_log altindaki HER *.log icin bir satir yazar (cok vhost'lu hedefte yuzlerce) ve okuyucu
// Python gibi yalniz son degeri tutar (bellek buyumez).
const SATIR_TAVANI = Object.freeze({
  zaman: 2000, baslatilan: 2000, istemci: 100, hatali_istemci: 100, sunucu: 20000, diger: 20000, bilgi_liste: 2000,
});
// analiz.cjs ADIM_RE ile ayni (moduller birbirini require etmez).
const ADIM_RE = /^[A-Za-z0-9-]+$/;

// cpu_kaydedici.sh sunucu_*.csv kolonlari (karsilastir.py ORNEK_KOLON ile ayni).
const ORNEK_KOLON = Object.freeze([
  'epoch', 'isci_utime', 'isci_stime', 'isci_sayi', 'kapanan_sayi', 'pidler', 'cpu_user', 'cpu_nice',
  'cpu_system', 'cpu_idle', 'cpu_iowait', 'cpu_irq', 'cpu_softirq', 'cpu_steal',
]);

// Dosya adi -> tur. Sira onemsiz; ilk eslesen kazanir. `hatali_istemci_` once denenir cunku
// `istemci_` deseni onu YAKALAMAZ (glob gibi bastan baglidir) ama okunurluk icin ayri tutulur.
const DESENLER = Object.freeze([
  [/^hatali_istemci_.*\.csv$/, 'hatali_istemci'],
  [/^istemci_.*\.csv$/, 'istemci'],
  [/^(hatali_)?istemci_.*\.json$/, 'yalniz_ozet'],
  [/^zaman\.csv$/, 'zaman'],
  [/^baslatilan\.csv$/, 'baslatilan'],
  [/^sunucu_.*\.csv$/, 'sunucu'],
  [/^bilgi_.*\.txt$/, 'bilgi'],
  [/^log_.*\.tsv$/, 'log'],
  [/^log_.*\.tsv\.gz$/, 'log_gz'],
  [/^diger_.*\.tsv$/, 'diger'],
  [/^diger_.*\.tsv\.gz$/, 'diger_gz'],
  [/^konf_.*\.txt$/, 'konf'],
  [/^NOT\.txt$/, 'not'],
  [/^SHA256SUMS$/, 'sha'],
]);

const AYLAR = Object.freeze({
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
});
const ZAMAN_RE = /^([0-9]{2})\/([A-Za-z]{3})\/([0-9]{4}):([0-9]{2}):([0-9]{2}):([0-9]{2}) ([+-])([0-9]{2})([0-9]{2})$/;
// Python float() dizgi soz dizimi (alt cizgi ayiracli rakamlar dahil); inf/nan sonlu olmadigi icin
// `sayi` zaten None dondurur, burada kabul edilmeleri gerekmez.
const PY_FLOAT_RE = /^[+-]?(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;
const PY_INT_RE = /^[+-]?[0-9](?:_?[0-9])*$/;

function okunamadi(mesaj, neden) {
  const e = new Error(mesaj);
  e.code = 'OKUNAMADI';
  if (neden) e.cause = neden;
  return e;
}

// ---------------------------------------------------------------------------------------------
// Python uyumlu ayrisdiricilar (karsilastir.py ile AYNI kabul/ret kurallari)
// ---------------------------------------------------------------------------------------------

/** karsilastir.py `sayi`: bos, nan, -, none, null -> null; sonlu olmayan -> null. Sayi da kabul eder. */
function sayi(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).trim();
  const k = s.toLowerCase();
  if (s === '' || k === 'nan' || k === '-' || k === 'none' || k === 'null') return null;
  if (!PY_FLOAT_RE.test(s)) return null;
  const v = Number(s.replace(/_/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** Python int(str): ValueError yerine null. */
function tamSayi(s) {
  const t = String(s).trim();
  if (!PY_INT_RE.test(t)) return null;
  const v = Number(t.replace(/_/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** Python float(str) (sonlu olmayan reddedilir: siralama anahtari olarak NaN kullanilamaz). */
function ondalik(s) {
  const t = String(s).trim();
  if (!PY_FLOAT_RE.test(t)) return null;
  const v = Number(t.replace(/_/g, ''));
  return Number.isFinite(v) ? v : null;
}

// Howard Hinnant days_from_civil: proleptik Gregoryen gun sayisi (1970-01-01 = 0). calendar.timegm
// tarihi dogrulamaz (31 Subat 3 Mart olur) ve Date.UTC'nin 0-99 yili 1900'e cevirme tuzagi yoktur.
function gunSayisi(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** nginx $time_local ("27/Oct/2026:10:00:00 +0300") -> UTC epoch saniye; taninmazsa null. */
function zamanEpoch(s) {
  const m = ZAMAN_RE.exec(String(s === null || s === undefined ? '' : s).trim());
  if (!m) return null;
  const ay = AYLAR[m[2]];
  const yil = Number(m[3]);
  // Python date(0, ...) ValueError atar ve karsilastir.py butun kosuyu durdurur; burada satir atlanir.
  if (!ay || yil < 1) return null;
  const t = (gunSayisi(yil, ay, 1) + Number(m[1]) - 1) * 86400 + Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]);
  const ofs = (Number(m[8]) * 3600 + Number(m[9]) * 60) * (m[7] === '+' ? 1 : -1);
  return t - ofs;
}

/**
 * Tek CSV satiri -> alanlar (Python csv, excel lehcesi, satir ici). Bos satir -> [] (Python ile ayni).
 * Cok satirli tirnakli alan desteklenmez: kit dosyalari tirnak icermez (k6 `hucre` virgulu bosluga cevirir).
 */
function csvAyir(satir) {
  if (satir === '') return [];
  const alanlar = [];
  let alan = '';
  let tirnakta = false;
  let alanBasi = true;
  for (let i = 0; i < satir.length; i++) {
    const c = satir[i];
    if (tirnakta) {
      if (c === '"') {
        if (satir[i + 1] === '"') {
          alan += '"';
          i++;
        } else tirnakta = false;
      } else alan += c;
      continue;
    }
    if (c === ',') {
      alanlar.push(alan);
      alan = '';
      alanBasi = true;
      continue;
    }
    if (c === '"' && alanBasi) {
      tirnakta = true;
      alanBasi = false;
      continue;
    }
    alan += c;
    alanBasi = false;
  }
  alanlar.push(alan);
  return alanlar;
}

/**
 * Python csv.DictReader + karsilastir.py `csv_oku` (anahtar/deger kirpilir, fazla alan atilir, eksik
 * alan ''). Satir isleyici dondurur; `bitir()` sozluk listesini verir. `maxSatir`: tutulan (bos
 * olmayan) veri satiri tavani; asilinca dosya adiyla OKUNAMADI.
 */
function csvSozlukOkuyucu(ad = 'csv', maxSatir = Infinity) {
  let baslik = null;
  const satirlar = [];
  return {
    satir(s) {
      const alanlar = csvAyir(s);
      if (baslik === null) {
        baslik = alanlar;
        return;
      }
      if (!alanlar.length) return;
      if (satirlar.length >= maxSatir) throw okunamadi(`${ad}: satir tavani asildi (en cok ${maxSatir} satir)`);
      // dict(zip(...)): yinelenen ham anahtar ilk konumunu korur, son degeri alir; eksik alan None.
      const ham = new Map();
      for (let i = 0; i < baslik.length; i++) ham.set(baslik[i], i < alanlar.length ? alanlar[i] : null);
      const d = Object.create(null);
      for (const [k, v] of ham) d[k.trim()] = (v === null ? '' : v).trim();
      satirlar.push(d);
    },
    bitir: () => satirlar,
  };
}

// ---------------------------------------------------------------------------------------------
// Log deposu: TUR basina sutunlu tipli diziler. NaN = olculmedi (Python None).
// ---------------------------------------------------------------------------------------------

class Kolon {
  constructor(Tip) {
    this.Tip = Tip;
    this.a = new Tip(KOLON_ILK);
    this.n = 0;
  }

  ekle(v) {
    if (this.n === this.a.length) {
      const b = new this.Tip(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }

  dizi() {
    return this.a.slice(0, this.n);
  }
}

/**
 * Log satirlarini toplar. `bitir()` -> { fazlar: string[], turlar: Map<tur, LogKaydi> } ;
 * LogKaydi = { n, faz: Uint8Array (fazlar indeksi), t: Float64Array (epoch sn), durum: Int32Array
 * (Python `int(status)`, yoksa 0), rt/cr/bl/d: Float64Array (NaN = yok) }.
 * En cok MAX_TUR farkli TUR: fazlasi OKUNAMADI (Portal kosusu degil ya da loga dis satir sizmis).
 * Testlerin bellekte KosuVerisi kurabilmesi icin disari da verilir.
 */
class LogDeposu {
  constructor() {
    this.fazlar = [];
    this.fazKod = new Map();
    this.turlar = new Map();
  }

  ekle(tur, faz, t, durum, rt, cr, bl, d) {
    let k = this.fazKod.get(faz);
    if (k === undefined) {
      // 255'ten fazla farkli faz adi pratikte yok (isinma/olcum/setup); yine de tasarsa son kova. Tasan
      // ad haritaya YAZILMAZ (kod yine 255): faz UA'dan gelir ([a-z]+), farkli ad sayisi sinirsizdir.
      k = Math.min(this.fazlar.length, 255);
      if (k === this.fazlar.length) {
        this.fazlar.push(faz);
        this.fazKod.set(faz, k);
      }
    }
    let x = this.turlar.get(tur);
    if (!x) {
      if (this.turlar.size >= MAX_TUR) {
        throw okunamadi(`log dosyasinda ${MAX_TUR}'ten fazla farkli TUR (Portal kosusu gibi gorunmuyor)`);
      }
      x = {
        faz: new Kolon(Uint8Array), t: new Kolon(Float64Array), durum: new Kolon(Int32Array),
        rt: new Kolon(Float64Array), cr: new Kolon(Float64Array), bl: new Kolon(Float64Array), d: new Kolon(Float64Array),
      };
      this.turlar.set(tur, x);
    }
    x.faz.ekle(k);
    x.t.ekle(t);
    // Yalniz 429 ve 5xx sayilir; Int32 disindaki anlamsiz durum kodu ikisi de degildir -> 0.
    x.durum.ekle(Number.isInteger(durum) && durum >= -2147483648 && durum <= 2147483647 ? durum : 0);
    x.rt.ekle(rt === null ? NaN : rt);
    x.cr.ekle(cr === null ? NaN : cr);
    x.bl.ekle(bl === null ? NaN : bl);
    x.d.ekle(d === null ? NaN : d);
  }

  bitir() {
    const turlar = new Map();
    for (const [tur, x] of this.turlar) {
      turlar.set(tur, {
        n: x.t.n, faz: x.faz.dizi(), t: x.t.dizi(), durum: x.durum.dizi(),
        rt: x.rt.dizi(), cr: x.cr.dizi(), bl: x.bl.dizi(), d: x.d.dizi(),
      });
    }
    return { fazlar: this.fazlar.slice(), turlar };
  }
}

// ---------------------------------------------------------------------------------------------
// Dosya bazli satir isleyiciler (karsilastir.py okuyucularinin karsiliklari)
// ---------------------------------------------------------------------------------------------

/**
 * karsilastir.py `log_oku`. Baslik taninmazsa OKUNAMADI (Python KullanimHatasi). `suzgec`
 * ({ onek, sayi }, dosyalar arasi ortak) verilirse TUR'u `onek` ile baslamayan satir depoya girmez,
 * yalniz `suzgec.sayi` artar (bozuk satir sayaci `atlanan`dan ayri).
 */
function logOkuyucu(ad, depo, suzgec = null) {
  let bas = null;
  let boyut = 0;
  let satir = 0;
  let atlanan = 0;
  return {
    satir(s) {
      if (!s) return;
      const p = s.split('\t');
      if (bas === null) {
        bas = new Map();
        p.forEach((k, i) => bas.set(k, i));
        boyut = bas.size;
        if (!bas.has('tur') || !bas.has('faz') || !bas.has('time_local')) {
          throw okunamadi(`${ad}: baslik satiri taninmadi`);
        }
        return;
      }
      if (p.length < boyut) {
        atlanan++;
        return;
      }
      const tur = p[bas.get('tur')];
      if (suzgec !== null && !tur.startsWith(suzgec.onek)) {
        suzgec.sayi++;
        return;
      }
      const t = zamanEpoch(p[bas.get('time_local')]);
      if (t === null) {
        atlanan++;
        return;
      }
      const durum = bas.has('status') ? sayi(p[bas.get('status')]) : null;
      const deneme = bas.has('deneme') ? sayi(p[bas.get('deneme')]) : null;
      depo.ekle(
        tur, p[bas.get('faz')], t,
        durum === null ? 0 : Math.trunc(durum),
        bas.has('request_time') ? sayi(p[bas.get('request_time')]) : null,
        bas.has('connection_request') ? sayi(p[bas.get('connection_request')]) : null,
        // response_lenght = $body_bytes_sent (bmw log_format): sikistirilmis govde, TLS/baslik haric
        bas.has('response_lenght') ? sayi(p[bas.get('response_lenght')]) : null,
        deneme === null ? null : Math.trunc(deneme),
      );
      satir++;
    },
    bitir: () => ({ dosya: ad, satir, atlanan, baslik: bas !== null }),
  };
}

/**
 * karsilastir.py `ornekleri_oku`. Kolon eksikse OKUNAMADI (Python KullanimHatasi). `maxSatir`:
 * tutulan ornek tavani (atlanan bozuk satir sayilmaz); asilinca dosya adiyla OKUNAMADI.
 */
function ornekOkuyucu(ad, maxSatir = Infinity) {
  let bas = null;
  let idx = null;
  let bitti = false;
  const ornekler = [];
  return {
    satir(s) {
      if (bitti) return;
      const r = csvAyir(s);
      if (bas === null) {
        bas = r;
        if (!bas.length) {
          // Python: ilk satir bossa `if not bas: return ornekler` -> dosyanin geri kalani okunmaz.
          bitti = true;
          return;
        }
        idx = new Map();
        bas.forEach((k, i) => idx.set(k.trim(), i));
        const eksik = ORNEK_KOLON.filter((k) => !idx.has(k));
        if (eksik.length) throw okunamadi(`${ad}: eksik kolon ${eksik.join(',')}`);
        return;
      }
      if (r.length < bas.length) return;
      const v = {};
      for (const k of ORNEK_KOLON) v[k] = r[idx.get(k)].trim();
      const sayilar = [];
      for (const k of ['cpu_user', 'cpu_nice', 'cpu_system', 'cpu_idle', 'cpu_iowait', 'cpu_irq', 'cpu_softirq', 'cpu_steal']) {
        const x = tamSayi(v[k]);
        if (x === null) return;
        sayilar.push(x);
      }
      const [user, nice, system, idle, iowait, irq, softirq, steal] = sayilar;
      const t = ondalik(v.epoch);
      const u = tamSayi(v.isci_utime);
      const st = tamSayi(v.isci_stime);
      const n = tamSayi(v.isci_sayi);
      const k = tamSayi(v.kapanan_sayi);
      if (t === null || u === null || st === null || n === null || k === null) return;
      const busy = user + nice + system + irq + softirq + steal;
      if (ornekler.length >= maxSatir) throw okunamadi(`${ad}: satir tavani asildi (en cok ${maxSatir} satir)`);
      ornekler.push({ t, u, s: st, n, k, p: v.pidler, busy, tot: busy + idle + iowait });
    },
    // Array.prototype.sort kararlidir (Python sort gibi): ayni t'li ornekler yerini korur.
    bitir: () => ornekler.sort((a, b) => a.t - b.t),
  };
}

/**
 * karsilastir.py `bilgi_oku`. Liste satirlari (uyari= / gecersiz=) HER BIRI en cok `maxListe` kez;
 * asilinca dosya adiyla OKUNAMADI. log= Python gibi son degeri tutar, sayilmaz (bellek buyumez).
 */
function bilgiOkuyucu(ad, maxListe = Infinity) {
  const b = Object.create(null);
  b.uyari = [];
  b.gecersiz = [];
  const tekrar = { uyari: 0, gecersiz: 0 };
  return {
    satir(s) {
      if (!s.includes('=') || s.startsWith('#')) return;
      const i = s.indexOf('=');
      const k = s.slice(0, i).trim();
      const v = s.slice(i + 1).trim();
      if ((k === 'uyari' || k === 'gecersiz') && ++tekrar[k] > maxListe) {
        throw okunamadi(`${ad}: ${k}= satir tavani asildi (en cok ${maxListe} satir)`);
      }
      if (k === 'uyari' || k === 'gecersiz') b[k].push(v);
      else b[k] = v;
    },
    bitir: () => b,
  };
}

/**
 * karsilastir.py `diger_oku`: saniye -> test disi istek adedi (birden cok dosya toplanir). `maxAnahtar`:
 * ortak haritadaki farkli saniye tavani; asilinca o an okunan dosyanin adiyla OKUNAMADI.
 */
function digerOkuyucu(ad, hedef, maxAnahtar = Infinity) {
  return {
    satir(s) {
      const p = s.split('\t');
      if (p.length < 2) return;
      const t = zamanEpoch(p[0]);
      const n = sayi(p[1]);
      if (t !== null && n !== null) {
        if (hedef.size >= maxAnahtar && !hedef.has(t)) {
          throw okunamadi(`${ad}: anahtar tavani asildi (en cok ${maxAnahtar} farkli saniye)`);
        }
        hedef.set(t, (hedef.get(t) || 0) + Math.trunc(n));
      }
    },
    bitir: () => null,
  };
}

/** NOT.txt: ilk bos olmayan satir (karsilastir.py `not_`). */
function notOkuyucu() {
  let not = null;
  return {
    satir(s) {
      if (not === null && s.trim()) not = s.trim();
    },
    bitir: () => not || '',
  };
}

/** konf_*.txt: yalniz "# dosya_sayisi=N ozet=H" ozeti (analizde kullanilmaz, ozet icin). */
function konfOkuyucu(ad) {
  const o = { dosya: ad, dosya_sayisi: null, ozet: null };
  return {
    satir(s) {
      const m = /^# dosya_sayisi=([0-9]+) ozet=(\S*)$/.exec(s);
      if (m && o.ozet === null) {
        o.dosya_sayisi = Number(m[1]);
        o.ozet = m[2];
      }
    },
    bitir: () => o,
  };
}

/** SHA256SUMS (sha256sum ciktisi: "<64 hex>  <ad>" ya da "<64 hex> *<ad>"). */
function shaOkuyucu() {
  const ozetler = new Map();
  return {
    satir(s) {
      if (!s.trim()) return;
      const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(s);
      if (!m) throw okunamadi('SHA256SUMS: satir bicimi taninmadi');
      const ad = m[2].replace(/^\.\//, '');
      // Duz dizin: alt yol ya da ust dizin adi kopya bozuk demektir; disari okuma da boylece kapanir.
      if (ad.includes('/') || ad.includes('\\') || ad === '.' || ad === '..') {
        throw okunamadi(`SHA256SUMS: duz dizin disi ad: ${ad}`);
      }
      // `sha256sum * > SHA256SUMS` dosyanin kendisini (o an bos/yarim) da listeler: dogrulanamaz, atlanir.
      if (ad === 'SHA256SUMS') return;
      ozetler.set(ad, m[1].toLowerCase());
    },
    bitir: () => ozetler,
  };
}

// ---------------------------------------------------------------------------------------------
// Akis: fs -> sha256 (ham bayt) -> [gunzip] -> tavan (acilmis bayt) -> satir bolucu
// ---------------------------------------------------------------------------------------------

/** Ham baytlari ozetler ve sayar; veriyi degistirmeden gecirir. */
function ozetleyici(sonuc) {
  const h = crypto.createHash('sha256');
  return new Transform({
    transform(parca, _k, cb) {
      h.update(parca);
      sonuc.ham += parca.length;
      cb(null, parca);
    },
    flush(cb) {
      sonuc.sha256 = h.digest('hex');
      cb();
    },
  });
}

/** Toplam okunan (acilmis) bayti sayar; tavan asilinca akisi OKUNAMADI ile keser. */
function tavan(sayac, ad) {
  return new Transform({
    transform(parca, _k, cb) {
      sayac.toplam += parca.length;
      if (sayac.toplam > sayac.max) {
        cb(okunamadi(`kosu dizini bayt tavanini asti (${sayac.max} bayt; ${ad} okunurken)`));
        return;
      }
      cb(null, parca);
    },
  });
}

/**
 * Satir bolucu (Python evrensel satir sonu: \n, \r\n, \r). Ilk satirdaki BOM atilir (utf-8-sig).
 * Gecersiz UTF-8 U+FFFD olur (Python errors='replace'). MAX_SATIR_KAR'i asan satir atlanir.
 */
class SatirYazici extends Writable {
  constructor(isle) {
    super();
    this.isle = isle;
    this.cozucu = new StringDecoder('utf8');
    this.kalan = '';
    this.ilk = true;
    this.atla = false;
    this.uzun = 0;
  }

  _write(parca, _k, cb) {
    try {
      this._metin(this.cozucu.write(parca), false);
      cb();
    } catch (e) {
      cb(e);
    }
  }

  _final(cb) {
    try {
      this._metin(this.cozucu.end(), true);
      cb();
    } catch (e) {
      cb(e);
    }
  }

  _satir(s) {
    if (this.atla) {
      this.atla = false;
      return;
    }
    if (this.ilk) {
      this.ilk = false;
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    }
    this.isle(s);
  }

  _metin(parca, son) {
    const m = this.kalan + parca;
    let bas = 0;
    const re = /\r\n|\n|\r/g;
    let x;
    while ((x = re.exec(m)) !== null) {
      // Parcanin sonundaki tek \r bir sonraki parcadaki \n ile \r\n olabilir: bekle.
      if (!son && x[0] === '\r' && x.index === m.length - 1) break;
      this._satir(m.slice(bas, x.index));
      bas = x.index + x[0].length;
    }
    this.kalan = m.slice(bas);
    if (this.kalan.length > MAX_SATIR_KAR) {
      this.kalan = '';
      if (!this.atla) this.uzun++;
      this.atla = true;
    }
    if (son && this.kalan !== '') {
      this._satir(this.kalan);
      this.kalan = '';
    }
  }
}

/**
 * Bir dosyayi akisla okur. `isleyici` null ise yalniz ozetlenir (SHA256SUMS dogrulamasi icin).
 * Doner: { ham, sha256, uzun }.
 */
async function dosyaAkit(yol, ad, { gz, isleyici, sayac }) {
  const sonuc = { ham: 0, sha256: null, uzun: 0 };
  const bayrak = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const asamalar = [fs.createReadStream(yol, { flags: bayrak }), ozetleyici(sonuc)];
  let yazici;
  if (isleyici) {
    if (gz) asamalar.push(zlib.createGunzip());
    asamalar.push(tavan(sayac, ad));
    yazici = new SatirYazici((s) => isleyici.satir(s));
  } else {
    asamalar.push(tavan(sayac, ad));
    yazici = new Writable({ write: (_p, _k, cb) => cb() });
  }
  asamalar.push(yazici);
  try {
    await pipeline(asamalar);
  } catch (e) {
    if (e && e.code === 'OKUNAMADI') throw e;
    const tur = gz && e && /^Z_|incorrect header|unexpected end/i.test(`${e.code || ''} ${e.message || ''}`) ? 'gzip acilamadi' : 'okunamadi';
    throw okunamadi(`${ad}: ${tur} (${e && e.message ? e.message : e})`, e);
  }
  if (yazici instanceof SatirYazici) sonuc.uzun = yazici.uzun;
  return sonuc;
}

// ---------------------------------------------------------------------------------------------
// Ana okuyucu
// ---------------------------------------------------------------------------------------------

/**
 * Kosu dizinini okur ve KosuVerisi dondurur (analiz.cjs `kosuAnaliz` girdisi).
 *
 * KosuVerisi:
 *   dizin, okunanBayt
 *   istemci / hataliIstemci : [{ dosya, satir }]   (satir = csv sozlugu; dosya adi sirasiyla)
 *   zaman / baslatilan      : [sozluk] | null      (dosya yoksa null)
 *   kesitler   : [{ anahtar, dosya, ornekler: [{t,u,s,n,k,p,busy,tot}], bilgi, bilgiVar }]
 *   log        : { fazlar, turlar: Map<tur, LogKaydi> }   (bkz. LogDeposu)
 *   loglar     : [{ dosya, satir, atlanan }]               (okunan log dosyalari)
 *   diger      : Map<epoch_sn, adet>
 *   not        : string
 *   konf       : [{ dosya, dosya_sayisi, ozet }]
 *   dosyalar   : [{ ad, bayt }]                             (adi taninan ve okunan dosyalar)
 *   sha256     : { durum: 'dogrulandi'|'yok', dosya_sayisi }
 *   uyarilar   : string[]                                    (okuma uyarilari, analiz uyarisi DEGIL)
 *
 * `adim` (ornek 'R17'; poller 'R' + id verir): verilirse log satirlarindan yalniz TUR'u `<adim>_` ile
 * baslayanlar depoya girer; digerleri sayilir ve TEK uyari olur: `log_baska_adim_satiri:<n>`.
 * Verilmezse (null/undefined) suzgec yok. Depo tavani (MAX_TUR) her iki durumda da gecerlidir.
 *
 * @param {string} dizin
 * @param {{maxBayt?: number, adim?: string|null}} [secenek]
 */
async function kosuDiziniOku(dizin, { maxBayt = VARSAYILAN_MAX_BAYT, adim = null } = {}) {
  if (typeof dizin !== 'string' || !dizin) throw okunamadi('kosu dizini verilmedi');
  if (!(Number.isFinite(maxBayt) && maxBayt > 0)) throw new TypeError('maxBayt pozitif sayi olmali');
  if (adim !== null && !(typeof adim === 'string' && ADIM_RE.test(adim))) throw new TypeError('adim gecersiz (ornek R17)');
  const suzgec = adim === null ? null : { onek: `${adim}_`, sayi: 0 };
  let st;
  try {
    st = await fs.promises.stat(dizin);
  } catch (e) {
    throw okunamadi(`kosu dizini okunamadi: ${dizin} (${e.code || e.message})`, e);
  }
  if (!st.isDirectory()) throw okunamadi(`kosu dizini dizin degil: ${dizin}`);
  let girdiler;
  try {
    girdiler = await fs.promises.readdir(dizin, { withFileTypes: true });
  } catch (e) {
    throw okunamadi(`kosu dizini listelenemedi: ${dizin} (${e.code || e.message})`, e);
  }

  const uyarilar = [];
  const dosyalar = [];
  const tur = new Map();
  for (const g of girdiler) {
    const ad = g.name;
    const desen = DESENLER.find(([re]) => re.test(ad));
    if (!g.isFile()) {
      // Bilinen adli girdi normal dosya degilse (symlink, dizin) veri eksik/supheli: okunmaz.
      if (desen) throw okunamadi(`${ad}: normal dosya degil`);
      continue;
    }
    if (desen) tur.set(ad, desen[1]);
  }

  const sayac = { toplam: 0, max: maxBayt };
  const boyut = async (ad) => (await fs.promises.lstat(path.join(dizin, ad))).size;
  const okunacak = [...tur.keys()].sort();
  if (okunacak.length > MAX_DOSYA) throw okunamadi(`kosu dizininde cok fazla dosya: ${okunacak.length} (> ${MAX_DOSYA})`);
  let toplamBoyut = 0;
  for (const ad of okunacak) {
    let b;
    try {
      b = await boyut(ad);
    } catch (e) {
      throw okunamadi(`${ad}: boyut okunamadi (${e.code || e.message})`, e);
    }
    dosyalar.push({ ad, bayt: b });
    toplamBoyut += b;
  }
  if (toplamBoyut > maxBayt) throw okunamadi(`kosu dizini bayt tavanini asti (${toplamBoyut} > ${maxBayt})`);

  // Duz .tsv ile .tsv.gz birlikteyse (gzip yarida kaldi) duz olan TAM kopyadir; .gz yalniz ozetlenir.
  const atlanacakGz = new Set();
  for (const ad of okunacak) {
    const t = tur.get(ad);
    if ((t === 'log_gz' || t === 'diger_gz') && tur.has(ad.slice(0, -3))) {
      atlanacakGz.add(ad);
      uyarilar.push(`gz_ve_duz_birlikte:${ad}(duz_dosya_okundu)`);
    }
  }

  const veri = {
    dizin, okunanBayt: 0, istemci: [], hataliIstemci: [], zaman: null, baslatilan: null, kesitler: [],
    log: null, loglar: [], diger: new Map(), not: '', konf: [], dosyalar, sha256: null, uyarilar,
  };
  const depo = new LogDeposu();
  const bilgiler = new Map();
  const sunucular = [];
  const ozetler = new Map();
  let shaListe = null;

  for (const ad of okunacak) {
    const t = tur.get(ad);
    const yol = path.join(dizin, ad);
    let isleyici = null;
    let gz = false;
    switch (t) {
      case 'istemci':
      case 'hatali_istemci':
      case 'zaman':
      case 'baslatilan':
        isleyici = csvSozlukOkuyucu(ad, SATIR_TAVANI[t]);
        break;
      case 'sunucu':
        isleyici = ornekOkuyucu(ad, SATIR_TAVANI.sunucu);
        break;
      case 'bilgi':
        isleyici = bilgiOkuyucu(ad, SATIR_TAVANI.bilgi_liste);
        break;
      case 'log':
      case 'log_gz':
        if (!atlanacakGz.has(ad)) isleyici = logOkuyucu(ad, depo, suzgec);
        gz = t === 'log_gz';
        break;
      case 'diger':
      case 'diger_gz':
        if (!atlanacakGz.has(ad)) isleyici = digerOkuyucu(ad, veri.diger, SATIR_TAVANI.diger);
        gz = t === 'diger_gz';
        break;
      case 'konf':
        isleyici = konfOkuyucu(ad);
        break;
      case 'not':
        isleyici = notOkuyucu();
        break;
      case 'sha':
        isleyici = shaOkuyucu();
        break;
      default:
        isleyici = null;
    }
    const s = await dosyaAkit(yol, ad, { gz, isleyici, sayac });
    ozetler.set(ad, s.sha256);
    if (s.uzun) uyarilar.push(`uzun_satir_atlandi:${ad}(${s.uzun})`);
    if (!isleyici) continue;
    const sonuc = isleyici.bitir();
    switch (t) {
      case 'istemci':
      case 'hatali_istemci': {
        const hedef = t === 'istemci' ? veri.istemci : veri.hataliIstemci;
        for (const satir of sonuc) if (satir.tur) hedef.push({ dosya: ad, satir });
        break;
      }
      case 'zaman':
        veri.zaman = sonuc;
        break;
      case 'baslatilan':
        veri.baslatilan = sonuc;
        break;
      case 'sunucu':
        sunucular.push({ ad, ornekler: sonuc });
        break;
      case 'bilgi':
        bilgiler.set(ad, sonuc);
        break;
      case 'log':
      case 'log_gz':
        veri.loglar.push(sonuc);
        break;
      case 'konf':
        veri.konf.push(sonuc);
        break;
      case 'not':
        veri.not = sonuc;
        break;
      case 'sha':
        shaListe = sonuc;
        break;
      default:
        break;
    }
  }
  if (suzgec !== null && suzgec.sayi > 0) uyarilar.push(`log_baska_adim_satiri:${suzgec.sayi}`);

  // SHA256SUMS: listelenen her dosya dizinde olmali ve ozeti tutmali (kopya yarim/bozuk degil).
  if (shaListe) {
    for (const [ad, beklenen] of shaListe) {
      if (!ozetler.has(ad)) {
        let var_ = false;
        try {
          var_ = (await fs.promises.lstat(path.join(dizin, ad))).isFile();
        } catch {
          var_ = false;
        }
        if (!var_) throw okunamadi(`SHA256SUMS'teki dosya kosu dizininde yok: ${ad}`);
        // Bilinmeyen adli ama listelenmis dosya: yalniz ozetlenir.
        const s = await dosyaAkit(path.join(dizin, ad), ad, { gz: false, isleyici: null, sayac });
        ozetler.set(ad, s.sha256);
      }
      if (ozetler.get(ad) !== beklenen) throw okunamadi(`SHA256SUMS tutmuyor: ${ad}`);
    }
    veri.sha256 = { durum: 'dogrulandi', dosya_sayisi: shaListe.size };
  } else {
    veri.sha256 = { durum: 'yok', dosya_sayisi: 0 };
    uyarilar.push('SHA256SUMS_yok(butunluk_dogrulanamadi)');
  }

  // karsilastir.py: anahtar = sunucu_<ANAHTAR>.csv; bilgi_<ANAHTAR>.txt yoksa "bilgi dosyasi yok" uyarisi.
  for (const { ad, ornekler } of sunucular) {
    const anahtar = ad.slice('sunucu_'.length, -'.csv'.length);
    const bilgi = bilgiler.get(`bilgi_${anahtar}.txt`);
    const yedek = Object.create(null);
    yedek.uyari = ['bilgi dosyasi yok'];
    yedek.gecersiz = [];
    veri.kesitler.push({ anahtar, dosya: ad, ornekler, bilgi: bilgi || yedek, bilgiVar: !!bilgi });
  }
  veri.log = depo.bitir();
  veri.okunanBayt = sayac.toplam;
  return veri;
}

module.exports = {
  kosuDiziniOku,
  LogDeposu,
  sayi,
  zamanEpoch,
  VARSAYILAN_MAX_BAYT,
  ORNEK_KOLON,
  _csvAyirForTest: csvAyir,
  _csvSozlukOkuyucuForTest: csvSozlukOkuyucu,
  _SatirYaziciForTest: SatirYazici,
  _MAX_SATIR_KAR: MAX_SATIR_KAR,
};
