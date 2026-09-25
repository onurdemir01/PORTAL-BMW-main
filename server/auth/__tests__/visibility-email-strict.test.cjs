// server/auth/__tests__/visibility-email-strict.test.cjs — e-posta yetkisi ve SIKI oge
// (kullanici, 2026-09-26: "Crypto Hub'i sadece istedigim kisiler goruntuleyebilsin,
//  birde e-posta ile de izin verebiliyor olayim").
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// decide() disari verilmiyor; davranis, motorun KAYNAK sozlesmesi uzerinden ve
// kurallarin sirasi uzerinden dogrulanir.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'visibility.cjs'), 'utf8');

test('VE1: e-posta kurali kullanici kuralindan SONRA, grup kuralindan ONCE', () => {
  const iUser = SRC.indexOf('|user|${usernameLower}');
  const iMail = SRC.indexOf('|email|${mailLower}');
  const iGroup = SRC.indexOf('|group|${g}');
  assert.ok(iUser > 0 && iMail > 0 && iGroup > 0, 'uc principal tipi de olmali');
  assert.ok(iUser < iMail, 'kullanici adi kurali e-postadan once degerlendirilmeli');
  assert.ok(iMail < iGroup, 'e-posta kurali grup kuralindan once degerlendirilmeli');
  // Eslestirme kucuk harf uzerinden yapilmali; aksi halde "Ad.Soyad@..." eslesmez.
  assert.match(SRC, /mailLower = \(\(user && user\.mail\) \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  // Memo anahtari e-postayi da icermeli; yoksa iki kullanici ayni onbellegi paylasir.
  assert.match(SRC, /memoKey = `\$\{role\}\|\$\{usernameLower\}\|\$\{mailLower\}\|/);
});

test('VE2: SIKI ogede admin muafiyeti YOK ve varsayilan kapali', () => {
  // Admin muafiyeti yalnizca strict DEGILKEN gecerli olmali.
  assert.match(SRC, /if \(role === 'Admin' && !strict\) return true;/);
  // Acik kural yoksa strict oge KAPALIDIR (default_visible'a bakilmaz).
  assert.match(SRC, /if \(strict\) return false;/);
  // Kill-switch hala once gelir: strict, kapali bir ogeyi acmamali.
  const iEnabled = SRC.indexOf("if (!truthy(el.enabled)) return false;");
  const iStrict = SRC.indexOf('let strict = false;');
  assert.ok(iEnabled > 0 && iEnabled < iStrict, 'enabled kontrolu strict\'ten once olmali');
});

test('VE3: Crypto Hub SIKI olarak seed ediliyor', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const i = setup.indexOf("element_key: 'CryptoHub'");
  assert.ok(i > 0, 'CryptoHub seed satiri olmali');
  const blok = setup.slice(i, i + 900);
  assert.match(blok, /metadata: \{ strict: true \}/, 'CryptoHub siki oge olmali');
  // Seed metadata kolonunu GERCEKTEN yazmali; yoksa strict hic etkili olmaz.
  assert.match(setup, /INSERT INTO portal_elements \([^)]*metadata\)/);
});

test('VE4: kural yazimi email principalini kabul eder', () => {
  const el = fs.readFileSync(path.join(__dirname, '..', 'elements.cjs'), 'utf8');
  assert.match(el, /\['user', 'group', 'email'\]\.includes\(r\.principalType\)/);
  // role disindaki her principal kucuk harfe cevrilmeli (e-posta dahil).
  assert.match(el, /pt === 'role' \? pid : pid\.toLowerCase\(\)/);
});

test('VE5: sikilik Admin ekranindan yonetilebilir', () => {
  // Kullanici: "Crypto Hub gorunurlugunu Admin sekmesine ekler misin? bazi kisilere
  // gosterecegim." Oge zaten listede duruyordu ama SIKI bayragi ne gorunuyordu ne de
  // degistirilebiliyordu; ustelik "Admin her zaman gorur" ipucu siki ogede YANLISTI.
  const el = fs.readFileSync(path.join(__dirname, '..', 'elements.cjs'), 'utf8');
  assert.match(el, /async function setElementStrict/);
  // metadata'nin DIGER alanlari korunmali - strict yazarken ustune yazilmamali.
  assert.match(el, /if \(strict\) meta\.strict = true; else delete meta\.strict;/);
  assert.match(el, /strict: \(\(\) => \{/, 'listElements strict bayragini dondurmeli');

  const routes = fs.readFileSync(path.join(__dirname, '..', 'visibility-routes.cjs'), 'utf8');
  assert.match(routes, /elements\/:key\/strict/);
  assert.match(routes, /requireAdmin/);
  // Degisiklik aninda yansimali (gorunurluk onbellegi dusurulmeli).
  const i = routes.indexOf('elements/:key/strict');
  assert.match(routes.slice(i, i + 400), /bumpVersion\(\)/);

  const tab = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'admin', 'tabs', 'PageVisibilityTab.tsx'), 'utf8',
  );
  assert.match(tab, /elementsApi\.setStrict/);
  assert.match(tab, /admin muafiyeti YOKTUR/, 'siki ogede ipucu duzeltilmis olmali');
});
