'use strict';
// ASCII KURALI (lint:ascii / fix:ascii) — scripts/check-ascii.cjs ve scripts/fix-ascii.cjs GERCEK
// betik olarak, gecici bir agacta kosar (betikler calisma dizinindeki server/ ve scripts/'i gezer).
//   AK1 denetleyici: yorum, blok yorum ve console.* satirindaki Turkce harf ihlal; dizgi, `ascii-ok`,
//       kapsam disi dosya (.js, node_modules, src/) ihlal degil; cikis 1 ve dosya:satir listesi.
//   AK2 blok yorumunu kapatan satir `ascii-ok` tasisa da yorum kapanir (sonraki kod denetlenmez).
//   AK3 50'den fazla ihlalde liste kirpilir, kalan sayi yazilir.
//   AK4 duzeltici yalniz yorum ve log bolumunu donusturur, dizgiye dokunmaz; *.test.js dosyalarini
//       da duzeltir; sonrasinda denetleyici temiz, ikinci kosu 0 satir.
//   AK5 duzeltici AK2'deki dosyada durmaz (eskiden "yorum DISINA tasti" deyip hicbir sey yazmiyordu);
//       blok sonrasi kod korunur, on iki harfin hepsi donusur.
//   AK6 ortak tespit (scripts/ascii-kurali.cjs): yorum acilisi, kacis, `://`, bolum araliklari.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { findCommentStart, denetlenenBolumler } = require('../../scripts/ascii-kurali.cjs');

const DENETLE = path.join(__dirname, '..', '..', 'scripts', 'check-ascii.cjs');
const DUZELT = path.join(__dirname, '..', '..', 'scripts', 'fix-ascii.cjs');

function agac(t, dosyalar) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'ascii-kurali-'));
  t.after(() => fs.rmSync(kok, { recursive: true, force: true }));
  for (const [ad, icerik] of Object.entries(dosyalar)) {
    fs.mkdirSync(path.dirname(path.join(kok, ad)), { recursive: true });
    fs.writeFileSync(path.join(kok, ad), icerik);
  }
  return kok;
}

function kos(betik, kok) {
  const r = spawnSync(process.execPath, [betik], { cwd: kok, encoding: 'utf8' });
  return { kod: r.status, out: r.stdout, err: r.stderr };
}

const oku = (kok, ad) => fs.readFileSync(path.join(kok, ad), 'utf8');

const ORNEK = {
  'server/a.cjs': [
    '// yorum çay', // 1 ihlal
    "const s = 'çay'; // ascii yorum",
    "console.log('kuyruk dolu: ş');", // 3 ihlal (log satirinin tamami)
    '/* blok',
    '   ğ satiri', // 5 ihlal
    "*/ const t = 'ı';", // blok burada biter, sonrasi kod
    "const u = 'http://ş.ornek'; const v = 1;",
    'f(); // istisna ö ascii-ok',
    "const w = 'x'; /* tek satir Ü */",
  ].join('\n'),
  'server/alt/b.test.js': '// test yorumu ş\n',
  'server/c.js': '// kapsam disi uzanti ş\n',
  'server/node_modules/d.cjs': '// paket ş\n',
  'scripts/e.mjs': 'export const x = 1; // modul ç\n',
  'src/f.cjs': '// kapsam disi kok ş\n',
};

test('AK1 denetleyici yorum ve log ihlallerini dosya:satir ile listeler, cikis 1', (t) => {
  const kok = agac(t, ORNEK);
  const r = kos(DENETLE, kok);
  assert.equal(r.kod, 1, r.out + r.err);
  const satirlar = r.err.split('\n').filter((s) => /^ {2}\S+:\d+: /.test(s));
  const yerler = satirlar.map((s) => s.trim().split(': ')[0]).sort();
  assert.deepEqual(yerler, [
    'scripts/e.mjs:1',
    'server/a.cjs:1',
    'server/a.cjs:3',
    'server/a.cjs:5',
    'server/a.cjs:9',
    'server/alt/b.test.js:1',
  ]);
  assert.match(r.err, /^\[lint:ascii\] 6 ihlal bulundu:/);
  assert.match(r.err, / {2}server\/a\.cjs:3: console\.log\('kuyruk dolu: ş'\);/);
  assert.match(r.err, /Duzeltmek icin: npm run fix:ascii/);
  assert.match(r.err, /Bilerek istisna icin satir sonuna: ascii-ok/);
  assert.equal(r.out, '');
});

test('AK2 blok yorumu `ascii-ok` satirinda da kapanir; sonraki dizgi denetlenmez', (t) => {
  const kok = agac(t, {
    'server/a.cjs': "/* blok\n   son ş */ // ascii-ok\nconst s = 'çay';\nconsole.log('x');\n",
  });
  const r = kos(DENETLE, kok);
  assert.equal(r.kod, 0, r.err);
  assert.equal(r.out, '[lint:ascii] OK — yorum/log satirlari ASCII.\n');
});

test('AK3 50 ihlalden fazlasi kirpilir, kalan sayisi yazilir', (t) => {
  const satirlar = Array.from({ length: 52 }, (_, i) => `// satir ${i} ş`);
  satirlar.unshift(`// ${'u'.repeat(140)} ş`);
  const kok = agac(t, { 'server/cok.cjs': satirlar.join('\n') });
  const r = kos(DENETLE, kok);
  assert.equal(r.kod, 1);
  assert.match(r.err, /^\[lint:ascii\] 53 ihlal bulundu:/);
  assert.equal((r.err.match(/^ {2}server\/cok\.cjs:\d+: /gm) || []).length, 50);
  assert.match(r.err, / {2}\.\.\. ve 3 tane daha/);
  assert.match(
    r.err,
    new RegExp(`^ {2}server/cok\\.cjs:1: // u{97}$`, 'm'),
    'uzun satir kirpilmadi',
  );
});

test('AK4 duzeltici yalniz yorum ve log bolumunu donusturur, test dosyalarini da', (t) => {
  const kok = agac(t, ORNEK);
  const r = kos(DUZELT, kok);
  assert.equal(r.kod, 0, r.err);
  assert.equal(r.out, '[fix:ascii] 3 dosyada 6 satir donusturuldu.\n');
  assert.equal(
    oku(kok, 'server/a.cjs'),
    [
      '// yorum cay',
      "const s = 'çay'; // ascii yorum",
      "console.log('kuyruk dolu: s');",
      '/* blok',
      '   g satiri',
      "*/ const t = 'ı';",
      "const u = 'http://ş.ornek'; const v = 1;",
      'f(); // istisna ö ascii-ok',
      "const w = 'x'; /* tek satir U */",
    ].join('\n'),
  );
  assert.equal(oku(kok, 'server/alt/b.test.js'), '// test yorumu s\n', 'test dosyasi duzeltilmedi');
  assert.equal(oku(kok, 'scripts/e.mjs'), 'export const x = 1; // modul c\n');
  for (const ad of ['server/c.js', 'server/node_modules/d.cjs', 'src/f.cjs'])
    assert.equal(oku(kok, ad), ORNEK[ad], `${ad} kapsam disiyken degisti`);

  assert.equal(kos(DENETLE, kok).kod, 0, 'duzeltmeden sonra denetleyici hala ihlal buluyor');
  assert.equal(kos(DUZELT, kok).out, '[fix:ascii] 0 dosyada 0 satir donusturuldu.\n');
});

test('AK5 duzeltici `ascii-ok` ile kapanan blokta durmaz; blok sonrasi kod ve harfler', (t) => {
  const icerik = [
    '/* blok ç',
    '   son ş */ // ascii-ok',
    "const s = 'çay'; // yorum ğ",
    '/* iki',
    "   bitti ö */ const z = 'ç';",
    '// harfler çÇğĞıİöÖşŞüÜ',
    "console.debug('ı');",
  ].join('\n');
  const kok = agac(t, { 'server/a.cjs': icerik });
  const r = kos(DUZELT, kok);
  assert.equal(r.kod, 0, r.err);
  assert.equal(r.out, '[fix:ascii] 1 dosyada 5 satir donusturuldu.\n');
  assert.equal(
    oku(kok, 'server/a.cjs'),
    [
      '/* blok c',
      '   son ş */ // ascii-ok',
      "const s = 'çay'; // yorum g",
      '/* iki',
      "   bitti o */ const z = 'ç';",
      '// harfler cCgGiIoOsSuU',
      "console.debug('i');",
    ].join('\n'),
  );
});

test('AK6 ortak tespit: yorum acilisi, kacis, `://` ve bolum araliklari', () => {
  assert.equal(findCommentStart('x(); // y'), 5);
  assert.equal(findCommentStart("const a = '//' + 1; /* z */"), 20);
  assert.equal(
    findCommentStart("const a = 'x\\' // y'; // z"),
    22,
    'kacisli tirnak dizgiyi kapatti',
  );
  assert.equal(findCommentStart('const b = "a" + `//` + "\'"; // c'), 28);
  assert.equal(findCommentStart('git(adres://ornek)'), -1, '`://` yorum sayildi');
  assert.equal(findCommentStart('const c = 1;'), -1);

  assert.deepEqual(
    denetlenenBolumler([
      "const s = 'ş'; // yorum",
      '/* tek satir */ kod();',
      'kod();',
      '  console.warn(x);',
      '/* uzun',
      '   orta',
      '   son */ kod();',
      '// ascii-ok sonda degil',
      '// istisna ascii-ok  ',
      'printf(); // console.log degil',
    ]),
    [
      { satir: 0, bas: 15, son: 23 },
      { satir: 1, bas: 0, son: 22 },
      { satir: 3, bas: 0, son: 18 },
      { satir: 4, bas: 0, son: 7 },
      { satir: 5, bas: 0, son: 7 },
      { satir: 6, bas: 0, son: 9 },
      { satir: 7, bas: 0, son: 23 },
      { satir: 9, bas: 10, son: 30 },
    ],
  );
});
