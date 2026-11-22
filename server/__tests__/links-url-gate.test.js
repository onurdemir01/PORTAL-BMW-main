// server/__tests__/links-url-gate.test.js — link URL'i icin sema kapisi.
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
const { esnek } = require('./fixtures/kod-deseni.cjs');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

const urlError = loadServerGate();

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

// LU3 (onyuz ikinci katmani) ve LU4 (ekran guvensiz adresi tiklanabilir yapmaz) KALDIRILDI: Linkler
// sayfasi 2026-10-02'de silindi, portal_links'i render eden bir ekran YOK; onyuz katmani
// (src/utils/safeUrl.ts) 2026-11-18'de olu kod olarak silindi. Sayfa geri gelirse safeUrl.ts
// git gecmisinden (7196be20^) geri getirilir, render ondan gecer ve LU3 / LU4 geri yazilir.

test('LU5 validate() URL kapisini GERCEKTEN cagiriyor', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/links/index.cjs'), 'utf8');
  const fn = src.slice(src.indexOf('function validate(body)'), src.indexOf('function initLinks'));
  assert.match(fn, /urlError\(body\.url\)/, 'validate() kapiyi cagirmiyor — kapi olu kod');
  // Eski "yalnizca bos mu" kontrolu geri gelmemeli.
  assert.doesNotMatch(
    fn.replace(/\s+/g, ' '),
    esnek(/if \(!body\.url \|\| !String\(body\.url\)\.trim\(\)\) errors\.push/),
    'eski bos-kontrolu geri gelmis',
  );
});
