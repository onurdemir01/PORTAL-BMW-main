// server/nginx-loadtest/__tests__/fixtures/kurgu.cjs -- deterministik sentetik kosu dizini ureteci.
//
// El kitinin testler/test_karsilastir.py'sindeki `Kurgu` sinifinin JS karsiligi (+ Portal durumlari).
// Sayilar tam secilir: RPS=20, arka plan worker tik/sn (8, 2) = 100 ms/sn, kosu (24, 6) = 300 ms/sn
// -> net 200 ms/sn / 20 istek = TAM 10.000 ms/istek (user 8, sys 2); arka plan cikarilmazsa 15.000.
//
// AYNI uretec iki duzen yazar:
//   pythonDuzeniYaz : <kok>/<ADIM>/ altinda karsilastir.py'nin bekledigi dosyalar (log duz .tsv)
//   portalDuzeniYaz : Portal kosu dizini (duz; log .tsv.gz; istemci json, baslatilan, konf, SHA256SUMS)
// Beklenen degerler (karsilastir-beklenen.json) Python duzeninden uretildi; `parmakIzi` her adimin
// Python'un okudugu baytlarini ozetler ve test bunu dogrular -> uretec degisirse test KIRMIZI olur
// (beklenenler bayatlamaz). Rastgelelik, saat ya da ortam okunmaz.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const AY = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// yuk_k6.js KOLONLAR ile ayni sira.
const KOLON = [
  'tur', 'adim', 'senaryo', 'kip', 'ae', 'hiz', 'n_olcum', 'rps_gercek', 'p50', 'p95', 'p99', 'ttfb_p95', 'tls_p95',
  'connect_p95', 'hata_orani', 'n_429', 'n_5xx', 'dropped', 'http2', 'bayt_istek', 'p95_js', 'p95_css', 'p95_html',
  'p95_json', 'p95_config', 'p95_buyuk', 'sikistirma_turu', 'isinma_sn', 'sure_sn', 'deneme',
];
const BOM = '\ufeff';

/** yuk_k6.js `hucre`: sayi 3 haneye yuvarlanir, metindeki virgul/satir sonu bosluk olur. */
function hucre(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v).replace(/[,\r\n]/g, ' ');
}

function iki(n) {
  return String(n).padStart(2, '0');
}

/** nginx $time_local, `ofsDk` dakikalik saat dilimiyle (ornek +180 = +0300). */
function tl(t, ofsDk) {
  const d = new Date((t + ofsDk * 60) * 1000);
  const a = Math.abs(ofsDk);
  return `${iki(d.getUTCDate())}/${AY[d.getUTCMonth()]}/${d.getUTCFullYear()}:${iki(d.getUTCHours())}:` +
    `${iki(d.getUTCMinutes())}:${iki(d.getUTCSeconds())} ${ofsDk < 0 ? '-' : '+'}${iki(Math.floor(a / 60))}${iki(a % 60)}`;
}

// request_time cesitli (yuzdelikler esit cikmasin): 0.001 .. 0.037 sn, (t, i)'den belirli.
function rtVarsayilan(t, i) {
  return (0.001 * (1 + ((t * 7 + i * 13) % 37))).toFixed(3);
}

class Kurgu {
  constructor(adim, { t0 = 1800000000, bosta = 60, rps = 20, bg = [8, 2], ofsDk = 180, host = 'test', denemeKolonu = true } = {}) {
    Object.assign(this, { adim, t0, rps, bg, ofsDk, host, denemeKolonu });
    this.t = t0 + bosta;
    this.aralik = [];
    this.istemci = [];
    this.hatali = [];
    this.zaman = [];
    this.baslatilan = [];
    this.log = [];
    this.reloadT = null;
    this.kapanan = [];
    this.diger = [];
  }

  satir(tur, faz, t, durum, deneme, govde, rt, cr) {
    this.log.push([tur, faz, t, durum, deneme, govde, rt, cr]);
  }

  kosu({
    sen = 'K', kip = 'yeni', ae = 'br', hiz = 250, r = 1, ru = 24, rs = 6, p95 = 50.0, n429 = 0, fark = 1.0, host = 400,
    reload = false, bayt = 10000.0, deneme = 1, govde = 1000, hata = null, s5xx_isinma = 0, s5xx_olcum = 0, dropped = 0,
    isinma = 10, olcum = 60, bosluk = 20, kayma = 0, yenidenKullan = 0, istemciAlan = {}, hatali = false, kapanan = null,
    n429_isinma = 0, reloadOfs = 40,
  } = {}) {
    const tur = `${this.adim}_${sen}_${kip}_${ae}_${hiz}_r${r}`;
    const bas = this.t;
    const son = bas + 1 + isinma + olcum;
    this.aralik.push([bas + 1 + kayma, son + kayma, ru, rs, host]);
    for (let t = bas + 1; t < son; t++) {
      const faz = t < bas + 1 + isinma ? 'isinma' : 'olcum';
      for (let i = 0; i < this.rps; i++) {
        let durum = faz === 'olcum' && n429 && t === bas + 20 && i < n429 ? 429 : 200;
        if (faz === 'isinma' && t === bas + 5 && i < n429_isinma) durum = 429;
        let cr = '1';
        if (kip === 'ka') cr = String(1 + (i % 5));
        else if (yenidenKullan && i % yenidenKullan === 0) cr = '2';
        this.satir(tur, faz, t + kayma, durum, deneme, govde, rtVarsayilan(t, i), cr);
      }
    }
    for (let j = 0; j < s5xx_isinma; j++) this.satir(tur, 'isinma', bas + 5 + kayma, 503, deneme, govde, '0.010', '1');
    for (let j = 0; j < s5xx_olcum; j++) this.satir(tur, 'olcum', bas + 30 + kayma, 503, deneme, govde, '0.010', '1');
    // reloadOfs / kapanan kosu basina gore; 80+ kosudan SONRAKI bosluga duser (arka plan bloklari).
    if (reload) this.reloadT = bas + reloadOfs + kayma;
    if (kapanan) this.kapanan.push([bas + kapanan[0] + kayma, bas + kapanan[1] + kayma]);
    const n = Math.round(this.rps * olcum * fark);
    const d = Object.fromEntries(KOLON.map((k) => [k, '']));
    Object.assign(d, {
      tur, adim: this.adim, senaryo: sen, kip, ae, hiz, n_olcum: n, rps_gercek: n / olcum, p50: 20, p95, p99: p95 * 1.5,
      ttfb_p95: p95 * 0.8, tls_p95: 5, connect_p95: 1, hata_orani: hata === null ? n429 / n : hata, n_429: n429 + n429_isinma,
      n_5xx: 0, dropped, http2: 0, bayt_istek: bayt, sikistirma_turu: 'DINAMIK', isinma_sn: isinma, sure_sn: olcum,
      deneme,
    }, istemciAlan);
    (hatali ? this.hatali : this.istemci).push(d);
    this.baslatilan.push([tur, bas, deneme]);
    this.zaman.push([tur, bas, son + 1, hatali ? 99 : 0, deneme]);
    this.t = son + 1 + bosluk;
    return tur;
  }

  /** kos.sh'in DUR dedigi deneme (429): log + zaman (rc 99) + hatali_istemci; istemci csv'si YOK. */
  yarim({ hiz = 250, r = 1, ru = 40, rs = 10, sn = 40, deneme = 1, n429 = 3, hataliYaz = true } = {}) {
    const tur = `${this.adim}_K_yeni_br_${hiz}_r${r}`;
    const bas = this.t;
    this.aralik.push([bas + 1, bas + sn + 1, ru, rs, 400]);
    for (let t = bas + 1; t < bas + sn + 1; t++) {
      const faz = t < bas + 11 ? 'isinma' : 'olcum';
      for (let i = 0; i < this.rps; i++) {
        this.satir(tur, faz, t, t === bas + sn && i < n429 ? 429 : 200, deneme, 1000, rtVarsayilan(t, i), '1');
      }
    }
    if (hataliYaz) {
      const d = Object.fromEntries(KOLON.map((k) => [k, '']));
      Object.assign(d, { tur, adim: this.adim, senaryo: 'K', kip: 'yeni', ae: 'br', hiz, n_olcum: 600, rps_gercek: 20,
        p50: 20, p95: 50, p99: 75, hata_orani: n429 / 600, n_429: n429, n_5xx: 0, dropped: 0, http2: 0,
        sikistirma_turu: 'DINAMIK', isinma_sn: 10, sure_sn: 60, deneme });
      this.hatali.push(d);
    }
    this.baslatilan.push([tur, bas, deneme]);
    this.zaman.push([tur, bas, bas + sn + 2, 99, deneme]);
    this.t = bas + sn + 22;
    return tur;
  }

  /** Baslatilip yarida kesilen TUR (AWX iptali / timeout): baslatilan + bir miktar log; zaman/istemci YOK. */
  kesik({ hiz = 400, r = 1, sn = 20, deneme = 1 } = {}) {
    const tur = `${this.adim}_K_yeni_br_${hiz}_r${r}`;
    const bas = this.t;
    this.aralik.push([bas + 1, bas + sn + 1, 24, 6, 400]);
    for (let t = bas + 1; t < bas + sn + 1; t++) {
      const faz = t < bas + 11 ? 'isinma' : 'olcum';
      for (let i = 0; i < this.rps; i++) this.satir(tur, faz, t, 200, deneme, 1000, rtVarsayilan(t, i), '1');
    }
    this.baslatilan.push([tur, bas, deneme]);
    this.t = bas + sn + 2;
    return tur;
  }

  /** Test disi trafik: [bas, bit) araliginda saniyede `adet` istek (diger_*.tsv). */
  digerEkle(bas, bit, adet) {
    for (let t = bas; t < bit; t++) this.diger.push([t, adet]);
  }

  /**
   * Dosya icerikleri: Map<ad, { icerik: string, py: bool, portal: bool, log: bool }>.
   * py = karsilastir.py'nin okudugu dosya; portal = Portal kosu dizinine yazilir; log = Portal'da gzip.
   */
  dosyalar({
    df_bas = 40, df_bit = 40, konf_bit = 'abc', gecersiz = [], uyari = [], not = 'test', nproc = 8, clk = 100,
    sunucuYok = false, bilgiYok = false, logYok = false, zamanYok = false, kesir = '', crlfIstemci = false,
    bomZaman = false, ekKesit = null,
  } = {}) {
    const out = new Map();
    const ekle = (ad, icerik, { py = true, portal = true, log = false } = {}) => out.set(ad, { icerik, py, portal, log });
    const anahtar = `${this.adim}_${this.host}`;
    const son = this.t + 10;
    const sunucuYaz = (bas, bit, ekTik) => {
      const satirlar = ['epoch,isci_utime,isci_stime,isci_sayi,kapanan_sayi,pidler,cpu_user,cpu_nice,cpu_system,' +
        'cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal'];
      let u = 0;
      let s = 0;
      let busy = 0;
      let idle = 0;
      for (let t = bas; t <= bit; t++) {
        const p = this.reloadT !== null && t >= this.reloadT ? '201+202' : '101+102';
        const k = this.kapanan.some(([a, b]) => a <= t && t < b) ? 1 : 0;
        satirlar.push(`${t}${kesir},${u},${s},2,${k},${p},${busy},0,0,${idle},0,0,0,0`);
        let [ru, rs] = this.bg;
        let hb = 80;
        for (const [a, b, xu, xs, xh] of this.aralik) {
          if (a <= t && t < b) {
            ru = xu;
            rs = xs;
            hb = xh;
          }
        }
        u += ru + ekTik;
        s += rs;
        busy += hb;
        idle += 800 - hb;
      }
      return satirlar.join('\n') + '\n';
    };
    if (!sunucuYok) ekle(`sunucu_${anahtar}.csv`, sunucuYaz(this.t0, son, 0));
    if (ekKesit) ekle(`sunucu_${anahtar}_2.csv`, sunucuYaz(ekKesit[0], ekKesit[1], 1));
    if (!bilgiYok) {
      const b = [
        'surum=1', `adim=${this.adim}`, `host=${this.host}`, `nproc=${nproc}`, `clk_tck=${clk}`, 'master_pid=100',
        `bas_epoch=${this.t0}`, `bit_epoch=${son}`, `df_bas=${df_bas}`, `df_bit=${df_bit}`, 'konf_hash_bas=abc',
        `konf_hash_bit=${konf_bit}`, 'konf_dosya_sayisi=3', 'isci_sayisi_bas=2', 'isci_pid_bas=101+102',
        `isci_pid_bit=${this.reloadT !== null ? '201+202' : '101+102'}`, `ornek_sayisi=${son - this.t0 + 1}`,
        `test_satiri=${this.log.length}`, `diger_satiri=${this.diger.reduce((t, x) => t + x[1], 0)}`, 'bozuk_ua_satiri=0',
        'log=access.log|1234|0|99999|tamam',
        ...uyari.map((x) => `uyari=${x}`), ...gecersiz.map((x) => `gecersiz=${x}`),
      ];
      ekle(`bilgi_${anahtar}.txt`, b.join('\n') + '\n');
      ekle(`konf_${anahtar}.txt`, `# konf_${anahtar}: yalniz dosya adlari\n# dosya_sayisi=3 ozet=abc\n0123456789abcdef  /usr/nginx/conf/nginx.conf\n# direktifler\n`, { py: false });
    }
    if (!logYok) {
      const bas = ['tur', 'faz', 'time_local', 'status', 'yol', 'request_time', 'response_lenght', 'connection_request'];
      if (this.denemeKolonu) bas.push('deneme');
      const satirlar = [bas.join('\t')];
      for (const [tur, faz, t, durum, den, govde, rt, cr] of this.log) {
        const p = [tur, faz, tl(t, this.ofsDk), String(durum), '/a.js', rt, govde === null ? '-' : String(govde), cr];
        if (this.denemeKolonu) p.push(den === null ? '-' : String(den));
        satirlar.push(p.join('\t'));
      }
      ekle(`log_${anahtar}.tsv`, satirlar.join('\n') + '\n', { log: true });
    }
    if (this.diger.length) {
      const satirlar = ['time_local\tadet', ...this.diger.map(([t, n]) => `${tl(t, this.ofsDk)}\t${n}`)];
      ekle(`diger_${anahtar}.tsv`, satirlar.join('\n') + '\n');
    }
    const sl = crlfIstemci ? '\r\n' : '\n';
    for (const d of this.istemci) {
      ekle(`istemci_${d.tur}.csv`, KOLON.join(',') + sl + KOLON.map((k) => hucre(d[k])).join(',') + sl);
      ekle(`istemci_${d.tur}.json`, JSON.stringify(d, null, 2) + '\n', { py: false });
    }
    for (const d of this.hatali) {
      ekle(`hatali_istemci_${d.tur}.csv`, KOLON.join(',') + '\n' + KOLON.map((k) => hucre(d[k])).join(',') + '\n');
    }
    if (!zamanYok && this.zaman.length) {
      const z = ['tur,bas_epoch,bit_epoch,rc,deneme', ...this.zaman.map((x) => x.join(','))];
      ekle('zaman.csv', (bomZaman ? BOM : '') + z.join('\n') + '\n');
    }
    if (this.baslatilan.length) {
      ekle('baslatilan.csv', ['tur,bas_epoch,deneme', ...this.baslatilan.map((x) => x.join(','))].join('\n') + '\n', { py: false });
    }
    ekle('NOT.txt', `${not}\n`);
    return out;
  }
}

/** Python'un okudugu dosyalarin (ad + sha256) ozeti: uretec degisirse beklenenler gecersiz kalir. */
function parmakIzi(dosyalar) {
  const h = crypto.createHash('sha256');
  for (const ad of [...dosyalar.keys()].sort()) {
    const f = dosyalar.get(ad);
    if (!f.py) continue;
    h.update(`${ad}\n${crypto.createHash('sha256').update(f.icerik, 'utf8').digest('hex')}\n`);
  }
  return h.digest('hex');
}

function pythonDuzeniYaz(kok, adim, dosyalar) {
  const d = path.join(kok, adim);
  fs.mkdirSync(d, { recursive: true });
  for (const [ad, f] of dosyalar) if (f.py) fs.writeFileSync(path.join(d, ad), f.icerik, 'utf8');
  return d;
}

/** Portal kosu dizini: duz; log'lar gzip; SHA256SUMS (sha256sum bicimi) istege bagli. */
function portalDuzeniYaz(dizin, dosyalar, { sha = true, gz = true } = {}) {
  fs.mkdirSync(dizin, { recursive: true });
  const yazilan = [];
  for (const [ad, f] of dosyalar) {
    if (!f.portal) continue;
    let hedefAd = ad;
    let bayt = Buffer.from(f.icerik, 'utf8');
    if (f.log && gz) {
      hedefAd = `${ad}.gz`;
      bayt = zlib.gzipSync(bayt);
    }
    fs.writeFileSync(path.join(dizin, hedefAd), bayt);
    yazilan.push([hedefAd, crypto.createHash('sha256').update(bayt).digest('hex')]);
  }
  if (sha) {
    const satirlar = yazilan.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([ad, h]) => `${h}  ${ad}`);
    fs.writeFileSync(path.join(dizin, 'SHA256SUMS'), satirlar.join('\n') + '\n');
  }
  return dizin;
}

/** test_karsilastir.py `standart`: 100/250/400 x 2 tekrar; ozel ayarlar 250_r1 (ve 400_r2 host) icin. */
function standart(adim, o = {}) {
  const { ru = 24, rs = 6, p95 = 50.0, hizlar = [100, 250, 400], tekrar = 2, kurgu = {}, kosuEk = null } = o;
  const k = new Kurgu(adim, kurgu);
  for (const h of hizlar) {
    for (let r = 1; r <= tekrar; r++) {
      const ozel = h === 250 && r === 1;
      if (o.yarim && ozel) k.yarim({ hiz: h, r });
      k.kosu({
        hiz: h, r, ru, rs,
        p95: h === 400 && o.p95_400 !== undefined ? o.p95_400 : p95,
        n429: ozel ? o.n429 || 0 : 0,
        fark: ozel && o.fark !== undefined ? o.fark : 1.0,
        reload: !!o.reload && ozel,
        host: h === 400 && r === 2 && o.host !== undefined ? o.host : 400,
        deneme: o.yarim && ozel ? 2 : 1,
        govde: o.govde !== undefined ? o.govde : 1000,
        hata: o.hata !== undefined ? o.hata : null,
        s5xx_isinma: ozel ? o.s5xx_isinma || 0 : 0,
        s5xx_olcum: ozel ? o.s5xx_olcum || 0 : 0,
        ...(kosuEk ? kosuEk(h, r) : {}),
      });
    }
  }
  return k;
}

module.exports = { Kurgu, standart, parmakIzi, pythonDuzeniYaz, portalDuzeniYaz, tl, hucre, KOLON };
