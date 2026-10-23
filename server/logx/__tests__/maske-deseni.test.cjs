// server/logx/__tests__/maske-deseni.test.cjs - MD1..MD8 (2026-10-23).
//
// LogX maskeleme kurali admin'den gelir ve AI'ya giden her log satirina olay dongusunde
// uygulanir. Iki ariza vardi: (1) desen yalniz derlenerek dogrulaniyordu - felaket geri izleme
// yapan bir desen maskeleme sirasinda butun portali kilitlerdi; (2) bayrakta `g` yoksa replace
// yalniz ILK eslesmeyi maskeliyordu - ayni satirdaki ikinci kimlik numarasi dis AI'ya gidiyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const md = require('../maske-deseni.cjs');
const db = require('../../db/index.cjs');

const KOK = path.join(__dirname, '..', '..', '..');
const oku = (y) => fs.readFileSync(path.join(KOK, y), 'utf8');

function seedKurallari() {
  const src = oku('server/db/mssql-setup.cjs');
  const bas = src.indexOf('const MASK_RULES_SEED = [');
  const son = src.indexOf('\n];', bas);
  assert.ok(bas > 0 && son > bas, 'MASK_RULES_SEED bulunamadi');
  return vm.runInNewContext(src.slice(bas + 'const MASK_RULES_SEED = '.length, son + 2));
}

// Yapisal kontrolun yakaladigi (ic ice sinirsiz niceleyici) ve yalniz davranissal kontrolun
// yakalayabildigi (ortusen alternatif) desenler.
const YAPISAL_KOTU = [
  '(a+)+$',
  '(\\w+\\s?)+$',
  '(?:\\d*)*x',
  '(\\w+)*@',
  '(x+x+)+y',
  '([a-z0-9]+[-.]?)+@',
  '(a+){2,}',
  '(?<ad>\\w+)+!',
  '((a)+b?)*c',
  // ic grup sinirsiz ama kendisi nicelenmemis; dis grup nicelenmis
  '((a+)b)*c',
];
const DAVRANIS_KOTU = ['(a|a)*b', '^(a|aa)+$', '(x|x)*y', '(k|kk)+$'];
const SAGLAM = [
  '\\d{3}-\\d{4}',
  '(?:[ -]?\\d{4}){5}',
  '(ab)+',
  '(a+b)',
  '[(+]+x',
  '\\(\\w+\\)+',
  '(?<ad>\\w+)\\s',
  '(?<=x)a+',
  '(?:\\d[ -]?){13,16}',
  'a{2,5}(b{1,3})+',
  // sinif icindeki + / * / ) niceleyici ya da grup degildir
  '([+*]a)+',
  '(a[)+]b)+',
];

test('MD1: bayrak normallestirme - g her zaman, y atilir, sira ve tekrar duzelir', () => {
  assert.equal(md.bayraklariNormallestir(''), 'g');
  assert.equal(md.bayraklariNormallestir(undefined), 'g');
  assert.equal(md.bayraklariNormallestir('i'), 'gi');
  assert.equal(md.bayraklariNormallestir('yig'), 'gi');
  assert.equal(md.bayraklariNormallestir('gg'), 'g');
  assert.equal(md.bayraklariNormallestir('usmig'), 'gimsu');
});

test('MD2: yapisal kontrol ic ice sinirsiz niceleyiciyi yakalar, saglam desenlere dokunmaz', () => {
  for (const p of YAPISAL_KOTU) {
    assert.ok(md.icIceSinirsizNiceleyici(p), `yakalanmadi: ${p}`);
  }
  for (const p of [...SAGLAM, ...seedKurallari().map((r) => r.pattern)]) {
    assert.equal(md.icIceSinirsizNiceleyici(p), null, `yanlis alarm: ${p}`);
  }
});

test('MD3: davranissal kontrol ortusen alternatifi sure sinirinda keser; saglam desen gecer', async () => {
  for (const p of DAVRANIS_KOTU) {
    assert.equal(md.icIceSinirsizNiceleyici(p), null, `on kosul: yapisal yakalamamali: ${p}`);
    const t0 = Date.now();
    const d = await md.davranisDenetle(p, 'g', { sureMs: 300 });
    assert.equal(d.ok, false, `gecti: ${p}`);
    assert.match(d.sebep, /bitmedi/);
    assert.ok(Date.now() - t0 < 5000, 'worker sonlandirilmadi');
  }
  const ok = await md.davranisDenetle('\\b[1-9]\\d{10}\\b', 'g', { sureMs: 5000 });
  assert.deepEqual(ok, { ok: true });
});

test('MD4: seed kurallarinin hepsi tam denetimden gecer (uretimdeki varsayilan set reddedilmez)', async () => {
  for (const r of seedKurallari()) {
    const d = await md.maskeDeseniDenetle(r.pattern, r.flags, { sureMs: 5000 });
    assert.equal(d.ok, true, `${r.name}: ${d.sebep}`);
  }
  const bozuk = await md.maskeDeseniDenetle('(', 'g');
  assert.equal(bozuk.ok, false);
  assert.match(bozuk.sebep, /derlenemedi/);
});

test('MD5: masker - g eksik kural tum eslesmeleri maskeler; guvensiz kural uygulanmaz ve raporlanir', async (t) => {
  t.mock.method(db, 'query', async () => ({
    rows: [
      { name: 'FOO', pattern: 'foo\\d+', flags: 'i', replacement: '[FOO]', sort_order: 1 },
      { name: 'IC_ICE', pattern: '(a+)+$', flags: 'g', replacement: '[X]', sort_order: 2 },
      { name: 'ORTUSEN', pattern: '(x|x)*y', flags: 'g', replacement: '[Y]', sort_order: 3 },
      { name: 'YAPISKAN', pattern: 'bar', flags: 'y', replacement: '[BAR]', sort_order: 4 },
    ],
  }));
  const masker = require('../masker.cjs');
  const n = await masker.reloadMaskRules();
  assert.equal(n, 2);
  const { masked, counts } = masker.maskString('FOO1 ve foo22; once bar sonra bar');
  assert.equal(masked, '[FOO] ve [FOO]; once [BAR] sonra [BAR]');
  assert.equal(counts.FOO, 2);
  const red = Object.fromEntries(masker.reddedilenKurallar().map((r) => [r.name, r.sebep]));
  assert.deepEqual(Object.keys(red).sort(), ['IC_ICE', 'ORTUSEN']);
  // Ic ice niceleyici yapisal kontrolde ANINDA elenir (worker'a, sure sinirina gitmez);
  // ortusen alternatif yalniz davranissal kontrolde yakalanir.
  assert.match(red.IC_ICE, /iç içe sınırsız niceleyici/);
  assert.match(red.ORTUSEN, /bitmedi/);
});

test('MD6: masker - butun DB kurallari reddedilirse sabit set devrede kalir', async (t) => {
  t.mock.method(db, 'query', async () => ({
    rows: [{ name: 'IC_ICE', pattern: '(a+)+$', flags: 'g', replacement: '[X]', sort_order: 1 }],
  }));
  const masker = require('../masker.cjs');
  assert.equal(await masker.reloadMaskRules(), 0);
  assert.match(masker.maskString('TCKN: 12345678901').masked, /\[TCKN\]/);
  assert.equal(masker.reddedilenKurallar().length, 1);
});

test('MD7: admin kaydi guvensiz deseni DB ye yazmadan 400 ile reddeder; bayrak normallesir', async (t) => {
  const sorgular = [];
  t.mock.method(db, 'query', async (sql, params) => {
    sorgular.push({ sql, params });
    return { rows: [{ id: 1, name: params[0], pattern: params[1], flags: params[2] }] };
  });
  const admin = require('../v2/admin.cjs');
  for (const pattern of ['(\\w+\\s?)+$', '(a|a)*b']) {
    await assert.rejects(
      admin.createMaskRule({ name: 'K', pattern, flags: 'g', replacement: '[K]' }),
      (e) => e.status === 400 && /pattern reddedildi/.test(e.message),
    );
  }
  await assert.rejects(
    admin.updateMaskRule(1, { name: 'K', pattern: '(a+)+', flags: 'g', replacement: '[K]' }),
    (e) => e.status === 400,
  );
  assert.equal(sorgular.length, 0, 'guvensiz desen DB ye ulasti');
  await admin.createMaskRule({ name: 'K', pattern: 'kimlik\\d+', flags: 'yi', replacement: '[K]' });
  assert.equal(sorgular.length, 1);
  assert.equal(sorgular[0].params[2], 'gi');
});

test('MD8: liste ucu reddedilenleri dondurur ve ekran gosterir', () => {
  const idx = oku('server/logx/v2/index.cjs');
  assert.match(
    idx,
    /reddedilen: masker\.reddedilenKurallar\(\)/,
    'liste ucu reddedilenleri donmuyor',
  );
  const ui = oku('src/components/admin/tabs/logxv2/LogXBolumleri.tsx');
  assert.match(ui, /setReddedilen\(Array\.isArray\(r\.reddedilen\) \? r\.reddedilen : \[\]\)/);
  assert.match(ui, /reddedilen\.length > 0 &&/);
  assert.match(ui, /güvenlik denetiminden geçmediği için uygulanmıyor/);
});
