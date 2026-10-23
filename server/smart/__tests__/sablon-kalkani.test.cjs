// server/smart/__tests__/sablon-kalkani.test.cjs - SK1..SK9 (2026-10-23).
//
// Smart metadata sablonunu admin yazar, sunucu nunjucks ile render eder. Kalkan
// (server/smart/sablon-kalkani.cjs) sablonun JS nesnelerinin ic ozelliklerine erisimini keser.
// Bu testler iki seyi birlikte sabitler: mesru sablonlar kalkanli ve kalkansiz AYNI ciktiyi
// verir (SK1); ic ozelliklere giden her yol render'i durdurur (SK2-SK6). SK9 yeni bir nunjucks
// ortaminin kalkansiz acilmasini engeller.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nunjucks = require('nunjucks');

const { buildSmartMetadata } = require('../metadata.cjs');
const kalkan = require('../sablon-kalkani.cjs');

const SERVER = path.join(__dirname, '..', '..');

function sessiz(fn) {
  const asilLog = console.log;
  const asilWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = asilLog;
    console.warn = asilWarn;
  }
}

const BAGLAM = {
  username: 'ali.veli@ornek',
  email: 'ali.veli@ornek',
  templateName: 'Ornek Sablon',
  extraVars: { env: 'Production', app: 'odeme', oco: 'CHG0001', hedefler: ['a', 'b', 'c'] },
  scalex: { ortam: 'Production', uygulamalar: ['x', 'y'], islem: 'stop', hedefSayisi: 2 },
};

function tekAlan(deger, baglam = BAGLAM) {
  return sessiz(() => buildSmartMetadata(`ALAN: "${deger}"`, baglam)).ALAN;
}

function redMi(deger) {
  try {
    sessiz(() => buildSmartMetadata(`ALAN: "${deger}"`, BAGLAM));
    return null;
  } catch (e) {
    return e;
  }
}

// Mesru sablon ornekleri: Self Servis, OpsX ve ScaleX pencerelerindeki yardim metinlerinde
// gecen bicimler + metin metodlari, filtreler, donguler.
const MESRU = [
  '{{ username }} / {{ templateName }}',
  '{{ extraVars.app | upper }}-{{ extraVars.env | lower }}',
  "{% if extraVars.env == 'Production' %}PROD {{ extraVars.oco }}{% else %}TEST{% endif %}",
  "{{ username.split('@')[0] }}",
  "{{ extraVars.app.startsWith('od') }} {{ extraVars.app.length }}",
  "{{ extraVars.hedefler | join(', ') }} ({{ extraVars.hedefler | length }})",
  '{% for h in extraVars.hedefler %}{{ loop.index }}:{{ h }} {% endfor %}',
  '{% for i in range(3) %}{{ i }}{% endfor %}|{% for i in range(5, 0, -2) %}{{ i }}{% endfor %}',
  "{{ extraVars.yok | default('bos') }} {{ extraVars.app | replace('o', '0') | trim }}",
  "{{ scalex.uygulamalar | join(',') }} {{ scalex.islem | capitalize }} {{ scalex.hedefSayisi + 1 }}",
  '{{ extraVars.hedefler | first }}{{ extraVars.hedefler | last }} {{ extraVars | dump | length > 0 }}',
  "{% set c = cycler('t', 'c') %}{{ c.next() }}{{ c.next() }}{{ c.next() }}",
  "{{ 'ACIKLAMA' if extraVars.env == 'Production' else 'yok' }}\\nikinci satir",
  "{{ extraVars.hedefler | sort | reverse | join('') }} {{ extraVars.app | truncate(3, true, '') }}",
];

function kalkansizRender(sablon, baglam) {
  const asillar = nunjucks.runtime[kalkan.KALKAN_ISARETI];
  assert.ok(asillar, 'kalkan kurulu degil');
  kalkan.runtimeKalkaniniKaldir(nunjucks.runtime);
  try {
    const env = new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: true });
    return env.renderString(sablon, baglam);
  } finally {
    kalkan.runtimeSertlestir(nunjucks.runtime);
  }
}

test('SK1: mesru sablonlar kalkanli ve kalkansiz AYNI ciktiyi verir', () => {
  const env = kalkan.sablonKalkaniKur(
    nunjucks,
    new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: true }),
  );
  for (const sablon of MESRU) {
    const kalkanli = env.renderString(sablon, BAGLAM);
    assert.equal(kalkanli, kalkansizRender(sablon, BAGLAM), `fark: ${sablon}`);
    assert.ok(kalkanli.length > 0, `bos cikti: ${sablon}`);
  }
  // Uctan uca: buildSmartMetadata yolu da ayni (son isleme dahil).
  assert.equal(tekAlan("{{ username.split('@')[0] | upper }}"), 'ALI.VELI');
  assert.equal(tekAlan('{% for h in extraVars.hedefler %}{{ h }}{% endfor %}'), 'abc');
});

test('SK2: ic ozellik adlari (nokta, koseli parantez, hesaplanan anahtar) render i durdurur', () => {
  const ifadeler = [
    '{{ username.constructor }}',
    '{{ extraVars.constructor }}',
    "{{ extraVars['constructor'] }}",
    "{{ extraVars['con' ~ 'structor'] }}",
    // Dizi anahtar: JS onu metne cevirip ayni ozelligi okur; ad kontrolu once metne cevirmeli.
    // (Metin uzerinde: String kurucusu deger katmaninda yakalanmaz, yalniz ad kontrolu keser.)
    "{{ username[['constructor']] }}",
    '{{ extraVars.__proto__ }}',
    "{{ extraVars['__pro' ~ 'to__'] }}",
    '{{ range.prototype }}',
    '{{ extraVars.__lookupGetter__ }}',
    '{{ extraVars.__defineSetter__ }}',
    '{{ constructor }}',
    '{{ __proto__ }}',
  ];
  for (const ifade of ifadeler) {
    const hata = redMi(ifade);
    assert.ok(hata, `render durmadi: ${ifade}`);
    assert.equal(hata.status, 400, `400 degil: ${ifade}`);
  }
});

test('SK3: guvensiz DEGER hangi yoldan gelirse gelsin tanimsiz (ad engelli olmasa da)', () => {
  const asyncKurucu = Object.getPrototypeOf(async function () {}).constructor;
  for (const deger of [Function, asyncKurucu, Object, Reflect, globalThis]) {
    assert.equal(kalkan.guvenliMemberLookup({ value: deger }, 'value'), undefined);
    assert.equal(kalkan.guvenliMemberLookup(deger, 'name'), undefined);
  }
  // Ust duzey ad: baglamda guvensiz bir deger olsa bile sablona verilmez.
  const env = kalkan.sablonKalkaniKur(
    nunjucks,
    new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: true }),
  );
  assert.throws(() => env.renderString('{{ f }}', { f: Function }), /undefined/);
  assert.throws(() => env.renderString('{{ d.value }}', { d: { value: Object } }), /undefined/);
  // Mesru fonksiyon degerleri cagrilabilir kalir, `this` korunur.
  const nesne = {
    ad: 'x',
    selam() {
      return `merhaba ${this.ad}`;
    },
  };
  assert.equal(kalkan.guvenliMemberLookup(nesne, 'selam')(), 'merhaba x');
});

test('SK4: callWrap guvensiz degeri cagirmaz', () => {
  const { callWrap } = nunjucks.runtime;
  assert.throws(() => callWrap(Function, 'f', {}, ['1']), /not allowed/);
  assert.throws(() => callWrap(Object, 'o', {}, []), /not allowed/);
  assert.equal(
    callWrap((a) => a + 1, 'g', {}, [1]),
    2,
  );
});

test('SK5: filtre ve test adlari yalniz ortamin kendi kayitlarindan', () => {
  for (const ad of ['constructor', 'hasOwnProperty', 'toString', '__lookupGetter__']) {
    const hata = redMi(`{{ username | ${ad} }}`);
    assert.ok(hata && /filter not found/.test(hata.message), `filtre cozuldu: ${ad}`);
    const testHata = redMi(`{% if username is ${ad} %}e{% endif %}`);
    assert.ok(testHata && /test not found/.test(testHata.message), `test cozuldu: ${ad}`);
  }
  assert.equal(tekAlan('{{ username | upper }}{% if 3 is odd %}T{% endif %}'), 'ALI.VELI@ORNEKT');
});

test('SK6: range ust siniri', () => {
  const sinir = kalkan.RANGE_UST_SINIR;
  assert.equal(tekAlan(`{{ range(${sinir}) | length }}`), String(sinir));
  assert.equal(tekAlan(`{{ range(10, 10 + ${sinir}) | length }}`), String(sinir));
  for (const ifade of [
    `{{ range(${sinir + 1}) | length }}`,
    `{{ range(0, ${sinir * 2}, 1) | length }}`,
    `{{ range(${sinir * 3}, 0, -1) | length }}`,
  ]) {
    const hata = redMi(ifade);
    assert.ok(hata && /range\(\) en fazla/.test(hata.message), `sinir islemedi: ${ifade}`);
  }
});

test('SK7: metadata.cjs yuklenince kalkan surec runtime inda kurulu', () => {
  assert.ok(nunjucks.runtime[kalkan.KALKAN_ISARETI], 'isaret yok');
  assert.equal(nunjucks.runtime.memberLookup, kalkan.guvenliMemberLookup);
});

test('SK8: ikinci kurulum sarmaz; kaldirinca ozgunler geri gelir', () => {
  const ilk = nunjucks.runtime.contextOrFrameLookup;
  kalkan.runtimeSertlestir(nunjucks.runtime);
  assert.equal(nunjucks.runtime.contextOrFrameLookup, ilk, 'iki kez sarildi');
  const asillar = nunjucks.runtime[kalkan.KALKAN_ISARETI];
  kalkan.runtimeKalkaniniKaldir(nunjucks.runtime);
  try {
    assert.equal(nunjucks.runtime.memberLookup, asillar.memberLookup);
    assert.equal(nunjucks.runtime.callWrap, asillar.callWrap);
    assert.equal(nunjucks.runtime[kalkan.KALKAN_ISARETI], undefined);
  } finally {
    kalkan.runtimeSertlestir(nunjucks.runtime);
  }
});

// SK9 tarayicisi: nunjucks'u yukleyen her uygulama dosyasi ortamini sablonKalkaniKur'dan
// gecirmeli; modul duzeyi (kalkansiz varsayilan ortam) render cagrilari yasak.
function kalkansizNunjucks(kaynak) {
  if (!/require\(\s*['"]nunjucks['"]\s*\)/.test(kaynak)) return [];
  const sorunlar = [];
  if (!/sablonKalkaniKur\(/.test(kaynak)) sorunlar.push('sablonKalkaniKur yok');
  const ortamSayisi = (kaynak.match(/new\s+nunjucks\.Environment\(/g) || []).length;
  const kalkanSayisi = (kaynak.match(/sablonKalkaniKur\(/g) || []).length;
  if (ortamSayisi > kalkanSayisi) sorunlar.push('kalkansiz Environment');
  if (/nunjucks\.(renderString|render|configure|compile)\(/.test(kaynak)) {
    sorunlar.push('varsayilan ortam cagrisi');
  }
  return sorunlar;
}

function uygulamaDosyalari(dizin, out = []) {
  for (const g of fs.readdirSync(dizin, { withFileTypes: true })) {
    if (g.name === 'node_modules' || g.name === '__tests__') continue;
    const yol = path.join(dizin, g.name);
    if (g.isDirectory()) uygulamaDosyalari(yol, out);
    else if (/\.(c|m)?js$/.test(g.name)) out.push(yol);
  }
  return out;
}

test('SK9: kalkansiz nunjucks ortami yok (ve tarayici kor degil)', () => {
  const ihlaller = [];
  let yukleyen = 0;
  for (const dosya of uygulamaDosyalari(SERVER)) {
    const kaynak = fs.readFileSync(dosya, 'utf8');
    if (/require\(\s*['"]nunjucks['"]\s*\)/.test(kaynak)) yukleyen += 1;
    const s = kalkansizNunjucks(kaynak);
    if (s.length) ihlaller.push(`${path.relative(SERVER, dosya)}: ${s.join(', ')}`);
  }
  assert.deepEqual(ihlaller, []);
  assert.ok(yukleyen >= 1, 'hic nunjucks yukleyen dosya bulunamadi - tarama kor');
  // Tarayicinin kendisi: bilinen kotu bicimleri yakaliyor.
  const req = "const nunjucks = require('nunjucks');\n";
  assert.deepEqual(kalkansizNunjucks(`${req}const e = new nunjucks.Environment(null, {});`), [
    'sablonKalkaniKur yok',
    'kalkansiz Environment',
  ]);
  assert.deepEqual(
    kalkansizNunjucks(
      `${req}const a = sablonKalkaniKur(nunjucks, new nunjucks.Environment());\n` +
        'const b = new nunjucks.Environment();',
    ),
    ['kalkansiz Environment'],
  );
  assert.deepEqual(
    kalkansizNunjucks(`${req}sablonKalkaniKur(nunjucks, e);\nnunjucks.renderString(x, y);`),
    ['varsayilan ortam cagrisi'],
  );
  assert.deepEqual(
    kalkansizNunjucks(`${req}const e = sablonKalkaniKur(nunjucks, new nunjucks.Environment());`),
    [],
  );
});
