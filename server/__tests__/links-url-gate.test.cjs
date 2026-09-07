// server/__tests__/links-url-gate.test.cjs — link URL'i icin sema kapisi.
//
// GUVENLIK ACIGI (2026-09-07'de kapatildi): `server/links/index.cjs` URL'i YALNIZCA
// "bos mu" diye kontrol ediyordu:
//
//     if (!body.url || !String(body.url).trim()) errors.push("url gerekli");
//
// Onyuz degeri DOGRUDAN `href`e basiyordu (`ImportantLinksPage`), yani
// `javascript:alert(1)` kaydedilebiliyor ve TIKLAYAN HERKESTE portal origin'inde
// calisiyordu — depolanmis XSS. Linkleri admin girse de bu bir kapi olmalidir:
// admin hesabi ele gecirilirse ya da yanlis yapistirma yapilirsa zarar TUM
// kullanicilara yayilir.
//
// SEED'DEKI `/logx` SATIRI KIRILMAMALI: portal ici goreli yollar mesru.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..');

// Sunucu tarafindaki kapiyi GERCEK kaynaktan cikarip calistirir — kopyasini degil.
function loadServerGate() {
  const src = fs.readFileSync(path.join(ROOT, 'server/links/index.cjs'), 'utf8');
  const from = src.indexOf('const ALLOWED_URL_SCHEMES');
  const to = src.indexOf('function validate(body)');
  assert.ok(from >= 0 && to > from, 'sunucu URL kapisi bulunamadi');
  const mod = { exports: {} };
  new Function('module', 'exports', `${src.slice(from, to)}\nmodule.exports = { urlError };`)(
    mod,
    mod.exports,
  );
  return mod.exports.urlError;
}

// Onyuzdeki ikinci katmani da GERCEK kaynaktan yukler.
function loadClientGate() {
  const out = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'src/utils/safeUrl.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, require);
  return m.exports.safeLinkUrl;
}

const urlError = loadServerGate();
const safeLinkUrl = loadClientGate();

const REDDEDILMELI = [
  'javascript:alert(1)',
  'JavaScript:alert(1)', // sema buyuk/kucuk harf duyarsizdir
  '  javascript:alert(1)  ', // bosluklu
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  '//evil.example.com', // protokol-goreli: https gibi gorunur, BASKA origin'e gider
  'not a url at all',
  '',
];

const KABUL_EDILMELI = [
  'https://connect.example.com',
  'http://intranet.local/sayfa',
  '/logx', // seed satiri 7 — portal ici yol
  '/admin/ansible?tab=1',
];

test('LU1 SUNUCU kapisi tehlikeli semalari REDDEDER', () => {
  for (const u of REDDEDILMELI) {
    assert.ok(
      urlError(u),
      `sunucu kapisi kabul etti: ${JSON.stringify(u)} — depolanmis XSS yolu acik`,
    );
  }
});

test('LU2 SUNUCU kapisi mesru adresleri KABUL EDER (seed kirilmiyor)', () => {
  for (const u of KABUL_EDILMELI) {
    assert.equal(urlError(u), null, `sunucu kapisi mesru adresi reddetti: ${u}`);
  }
});

test('LU3 ONYUZ ikinci katmani da ayni kararlari verir', () => {
  // Sunucu kapisi yalnizca YENI yazimlari korur; tabloda ZATEN duran satirlar
  // dogrulanmadan gecmistir. Render aninda ayni kural uygulanmali.
  for (const u of REDDEDILMELI) {
    const r = safeLinkUrl(u);
    assert.equal(r.safe, false, `onyuz kabul etti: ${JSON.stringify(u)}`);
    assert.equal(r.href, '', 'guvensiz adres icin href BOS olmali');
    assert.ok(r.reason.length > 0, 'sebep yazilmamis');
  }
  for (const u of KABUL_EDILMELI) {
    const r = safeLinkUrl(u);
    assert.equal(r.safe, true, `onyuz mesru adresi reddetti: ${u}`);
    assert.equal(r.href, u.trim());
  }
});

test('LU4 ekran guvensiz adresi TIKLANABILIR yapmaz', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'src/components/ImportantLinksPage.tsx'), 'utf8');
  // Ham `link.url` DOGRUDAN href'e basilmamali.
  assert.doesNotMatch(
    ui.replace(/\s+/g, ' '),
    /href=\{link\.url\}/,
    "ham link.url dogrudan href'e basiliyor — eski kayitlardaki javascript: hala calisir",
  );
  assert.match(ui, /safeLinkUrl\(/, 'render aninda kapi uygulanmiyor');
  // Guvensizse `<a>` YERINE metin gosterilmeli.
  assert.match(ui, /Güvensiz adres/, 'guvensiz adres kullaniciya bildirilmiyor');
});

test('LU5 validate() URL kapisini GERCEKTEN cagiriyor', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/links/index.cjs'), 'utf8');
  const fn = src.slice(src.indexOf('function validate(body)'), src.indexOf('function initLinks'));
  assert.match(fn, /urlError\(body\.url\)/, 'validate() kapiyi cagirmiyor — kapi olu kod');
  // Eski "yalnizca bos mu" kontrolu geri gelmemeli.
  assert.doesNotMatch(
    fn.replace(/\s+/g, ' '),
    /if \(!body\.url \|\| !String\(body\.url\)\.trim\(\)\) errors\.push/,
    'eski bos-kontrolu geri gelmis',
  );
});
