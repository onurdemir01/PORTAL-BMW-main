// scripts/ic-ad-bekcisi.cjs — kurum ic adi bekcisi (kalite kapisi K17, 2026-11-20).
//   node scripts/ic-ad-bekcisi.cjs --tum            CI / npm run kapi: izlenen TUM dosyalar
//   node scripts/ic-ad-bekcisi.cjs --staged         commit oncesi: sahnelenen eklenen satirlar
//   node scripts/ic-ad-bekcisi.cjs --mesaj <dosya>  commit mesaji (commit-msg)
//   node scripts/ic-ad-bekcisi.cjs --aralik A..B    CI: araliktaki commit mesajlari
//
// Repo PUBLIC: kurumun sunucu adlari ve alan adlari koda, teste, belgeye ya da commit mesajina
// yazilmaz. Kodun bildigi kurum listeleri kurum ayarindadir (server/util/kurum-ayari.cjs,
// KURUM_AYAR_DOSYASI), playbook degerleri AWX template Variables'tadir (docs/AWX-KOPYALAMA-HARITASI.md
// "Kurum degerleri"); ornek ve testler kurgusal adlar kullanir (on ek OR, alan adi *.invalid).
//
// Desenler GENEL: gercek ad listesi repoya girmez. Ad kurali (iki harf kurum oneki + tur + ortam
// harfi + numara) ve kurumun alan adi uzantisi (.com.tr) yeter. Bulunan deger YAZDIRILMAZ (CI
// gunlugu de public): yalniz dosya:satir ve tur.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { aracYolu } = require('./arac-yolu.cjs');
const { farkAyristir } = require('./sir-tarama.cjs');

// Harf tutarli (TAMAMI buyuk ya da TAMAMI kucuk): karisik harfli base64 (kilit dosyasi butunluk
// ozeti) yanlis pozitif vermez.
const DESENLER = [
  ['kurum sunucu adi', /(?<![A-Za-z0-9])GB[A-Z][A-Z0-9]{1,20}\d[A-Z]?(?![A-Za-z0-9])/],
  ['kurum sunucu adi', /(?<![A-Za-z0-9])gb[a-z][a-z0-9]{1,20}\d[a-z]?(?![A-Za-z0-9])/],
  ['istirak OCP / sunucu adi', /(?<![A-Za-z0-9])gi(?:a?ocp|hst)[a-z0-9]*\d(?![A-Za-z0-9])/],
  ['istirak OCP / sunucu adi', /(?<![A-Za-z0-9])da(?:a?ocp|mtc)[a-z0-9]*\d(?![A-Za-z0-9])/],
  // Regex icindeki kacisli bicim de (noktalardan once ters bolu): IU5 testi bu bicimle gozden kacmisti.
  ['kurum alan adi (.com.tr)', /(?<![a-z0-9-])[a-z0-9-]+\\?\.com\\?\.tr(?![a-z0-9-])/i],
];

// Rakamsiz kurum onekli ad (ad KURALINI anlatan `<onek>RVP*`, `<onek>NG[WX]` ya da kisa host etiketi
// `<onek>xx.fw...`): harf tutarli, onekten sonra en az iki harf.
DESENLER.push(
  ['kurum onekli ad kalibi', /(?<![A-Za-z0-9])GB[A-Z]{2,12}(?![A-Za-z0-9])/],
  ['kurum onekli ad kalibi', /(?<![A-Za-z0-9])gb[a-z]{2,10}\.[a-z]/],
);

// KURUM ADI (marka, 2026-11-21): ad repoya YAZILMAZ; sozcuklerin sha256 ozeti karsilastirilir. Marka
// sozcugu ayni zamanda siradan bir Turkce sozcuk oldugu icin TEK BASINA yasak degil; yasak olanlar:
//   TEK     markanin ayirt edici sozcukleri (bilesik ad, kisaltma, istirak / bolge adi, servis hesabi)
//   BILESIK marka sozcugu bir bilesik kimligin parcasi (`<marka>_values`, `<marka>-root`, `fw.<marka>`)
//   IKILI   "<marka> <unvan>" sozcuk ciftleri
// Ozetlerin kaynagi git disinda (.ai-workspace/ic-ad/marka-ozetleri.json); yeni bir kurum sozcugu
// eklenirken ozeti oradan uretilir.
const MARKA = {
  tek: new Set([
    '97da5be440bba77decf3bdad872c24ac3cd490e40e7917c4c43a680d61980f3e',
    '54aaf21894d8da2d2493fac653d1421885ec156b9b345b8408fed3d8ad93a598',
    '359f1894d33dfc2a453701347292823530a493899299cc7c3836834b01be2f05',
    'c56f9bd5162f4e447f2d4dc3765fe73cf9a5b8c702e1975f4f2358b078fb6c58',
    '81d86d207b69079c05f40b2d48495399e531bd679654a19d2b0310d379123f76',
    '52f774b36a01d431c2bf798426c67bb85fd52bc6b1aef1dbe4719a053264c445',
    '9cef189bd4f608d43a52d0f48e92af9b02fda185154eab9b82a0d497fb554b11',
  ]),
  bilesikParca: '6852f22c97000168960b9c191c07aa4ce64391dadbe530e91da768d7d4a50d42',
  ikili: new Set([
    '7bc295a30ede2335be51822daf1fbc113b0772341af6f273be6c616004382eb3',
    '5c1d9872c09cda2acdc15350ca497353a7e03bef9e5c8b218862a041a18ee063',
    'ade4b85d1114a785fafc7ec1bc2e58569a628d5afed82ed017e607adb1150039',
  ]),
};
const ozet = (t) => crypto.createHash('sha256').update(t).digest('hex');
const SOZCUK = /[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g;

/** Satirdaki kurum adi bicimleri -> true / false. Saf islev (ozetler testte kurgusal verilir). */
function markaVar(satir, ozetler = MARKA) {
  let onceki = null;
  for (const m of String(satir).matchAll(SOZCUK)) {
    const parcalar = m[0].toLowerCase().split(/[._-]/);
    if (parcalar.some((p) => ozetler.tek.has(ozet(p)))) return true;
    if (parcalar.length > 1 && parcalar.some((p) => ozet(p) === ozetler.bilesikParca)) return true;
    const ilk = parcalar[0];
    if (
      onceki !== null &&
      m.index === onceki.son + 1 &&
      ozetler.ikili.has(ozet(`${onceki.t} ${ilk}`))
    )
      return true;
    onceki = { t: parcalar[parcalar.length - 1], son: m.index + m[0].length };
  }
  return false;
}

// KURUM IC AGLARI (2026-11-21): gercek ag on ekleri de yalniz ozetle tutulur. 10.x icin /16, 192.168.x
// icin /24 (192.168 /16'sinin cogu kurgusal test adresidir). Testler ozel ag (RFC 1918) anlami gerektirdigi
// icin kurgusal IP'ler 10.x olabilir; yalniz bilinen GERCEK aglar yasak. Kaynak: .ai-workspace/ic-ad/
// ip-ozetleri.json (uretim ic ag ayari + envanterden gelen adresler).
const IP_AGLARI = {
  s16: new Set([
    '09b5b4be2fb4c54174385b3208bc8d1ad8a3106df78b620b0ac5281898a14c36',
    '8dd188857b5d212413c53b3908b23328c61a8f01a8d36e092ba3248ca71f859e',
    'fc6189ae531c7636e3d7716c2e09a28951a615f0579ea9b07c2b92f826cbc66b',
    '226d08cd5099b48da142b4f810848e389b844bb57c3dd1256ba0932458c7ecd5',
    '583fbc64285aff02bca7ebaf7ca30f70b21fe6bea13e671b51a1485fbad0e2b9',
  ]),
  s24: new Set([
    '58e2e3e17ebc43425c6314f95378885553c8708c433167f035fb597317d912c8',
    '2181e12a90472f47066ce0d8a5e0b500f57563434aad7bf32aacf824d32f2a12',
    '4caa2bc379c52b21f6cb9bae617581f1d0e0236fa448eb9b6572b19fd8273511',
    '9f3e303e5df9ee0e29a3cc950f585e8f19c287788c3c3c50cd16c1f173c62106',
  ]),
};
const IP_10 = /(?<![0-9.])10\.(\d{1,3})\.\d{1,3}\.\d{1,3}(?![0-9]|\.\d)/g;
const IP_192 = /(?<![0-9.])192\.168\.(\d{1,3})\.\d{1,3}(?![0-9]|\.\d)/g;

/** Satirda bilinen gercek kurum ic agindan bir adres var mi? Saf islev (aglar testte kurgusal verilir). */
function ipAgiVar(satir, aglar = IP_AGLARI) {
  const metin = String(satir);
  for (const m of metin.matchAll(IP_10)) if (aglar.s16.has(ozet(`10.${m[1]}`))) return true;
  for (const m of metin.matchAll(IP_192)) if (aglar.s24.has(ozet(`192.168.${m[1]}`))) return true;
  return false;
}

/** Tek satir -> bulgu turleri (tekrarsiz). Saf islev. */
function satirTara(satir) {
  const out = [];
  for (const [ad, re] of DESENLER) if (re.test(satir) && !out.includes(ad)) out.push(ad);
  if (markaVar(satir)) out.push('kurum adi');
  if (ipAgiVar(satir)) out.push('kurum ic IP agi');
  return out;
}

/** Metin -> [{ satir, ad }]. Saf islev. */
function metinTara(metin, { yorumAtla = false } = {}) {
  const out = [];
  String(metin)
    .split('\n')
    .forEach((s, i) => {
      if (yorumAtla && s.startsWith('#')) return;
      for (const ad of satirTara(s)) out.push({ satir: i + 1, ad });
    });
  return out;
}

/** Dosya icerigi metin mi? NUL bayti ikili dosyadir (resim, arsiv): taranmaz. Saf islev. */
const metinMi = (buf) => !buf.subarray(0, 8192).includes(0);

const git = (args) =>
  execFileSync(aracYolu('git'), args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function tumAgac() {
  const bulgular = [];
  const dosyalar = git(['ls-files', '-z']).split('\0').filter(Boolean);
  for (const dosya of dosyalar) {
    let buf;
    try {
      buf = fs.readFileSync(dosya);
    } catch {
      continue; // izlenen ama calisma agacinda silinmis dosya: git kendi gosterir
    }
    if (!metinMi(buf)) continue;
    for (const b of metinTara(buf.toString('utf8'))) bulgular.push({ dosya, ...b });
  }
  return { bulgular, baglam: `${dosyalar.length} izlenen dosya` };
}

function aralikMesajlari(aralik) {
  const bulgular = [];
  const kayitlar = git(['log', '--format=%h%x00%B%x01', aralik]).split('\x01');
  for (const kayit of kayitlar) {
    const [sha, govde] = kayit.replace(/^\n/, '').split('\0');
    if (!sha || govde === undefined) continue;
    for (const b of metinTara(govde)) bulgular.push({ dosya: `commit ${sha} mesaji`, ...b });
  }
  return { bulgular, baglam: `${aralik} commit mesajlari` };
}

function rapor({ bulgular, baglam }) {
  if (!bulgular.length) {
    console.log(`[ic-ad] temiz (${baglam}).`);
    return 0;
  }
  console.error(
    `[ic-ad] KIRMIZI (${baglam}): ${bulgular.length} bulgu. Degerler yazdirilmaz (CI gunlugu public).`,
  );
  for (const b of bulgular.slice(0, 50)) console.error(`  - ${b.dosya}:${b.satir}  ${b.ad}`);
  console.error(
    "  Kurum degeri ise kurum ayarina (KURUM_AYAR_DOSYASI) ya da AWX template Variables'a tasi;\n" +
      '  ornek / test ise kurgusal ad kullan (on ek OR, alan adi *.invalid). docs/KALITE-KAPILARI.md K17.',
  );
  return 1;
}

function main(argv) {
  if (argv.includes('--tum')) return rapor(tumAgac());
  if (argv.includes('--mesaj')) {
    const yol = argv[argv.indexOf('--mesaj') + 1];
    const bulgular = metinTara(fs.readFileSync(yol, 'utf8'), { yorumAtla: true }).map((b) => ({
      dosya: 'commit mesaji',
      ...b,
    }));
    return rapor({ bulgular, baglam: 'commit mesaji' });
  }
  if (argv.includes('--aralik')) return rapor(aralikMesajlari(argv[argv.indexOf('--aralik') + 1]));
  // --staged (varsayilan)
  const fark = git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff']);
  const bulgular = farkAyristir(fark).flatMap(({ dosya, satir, metin }) =>
    satirTara(metin).map((ad) => ({ dosya, satir, ad })),
  );
  return rapor({ bulgular, baglam: 'sahnelenen fark' });
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  DESENLER,
  MARKA,
  IP_AGLARI,
  satirTara,
  metinTara,
  metinMi,
  markaVar,
  ipAgiVar,
  ozet,
};
