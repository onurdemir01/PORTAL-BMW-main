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

test('VE2: SIKI oge NON-ADMIN icin kapali; ADMIN MUAF (2026-10-01 karari)', () => {
  // NOT: bu iddialar KODUN YAZIMINA degil ANLAMINA baksin diye desen esnek tutuldu;
  // 2026-09-26'da iz (explain) eklenince birebir metin eslesmesi bosuna dusmustu.
  //
  // ANLAM DEGISTI (kullanici, 2026-10-01): "adminlerin yetkisi gitti bu sefer. Adminler
  // default olarak her seyi gorebilir ve her seyi yapabiliyor olsun." Eskiden strict
  // admin muafiyetini DE kaldiriyordu; Crypto Hub siki yapilinca yoneticiler kapida
  // kaldi. Artik muafiyet KOSULSUZ, strict yalnizca non-admin tarafi baglar.
  assert.match(SRC, /role === 'Admin'\)[\s\S]{0,120}return true/);
  assert.ok(
    !/role === 'Admin' && !strict/.test(SRC),
    'admin muafiyeti yine sikilige baglanmis - yoneticiler kapida kalir',
  );
  // Acik kural yoksa strict oge KAPALIDIR (default_visible'a bakilmaz).
  const iStrictFalse = SRC.search(/if \(strict\)[\s\S]{0,120}return false/);
  const iDefault = SRC.indexOf('return truthy(el.default_visible)');
  assert.ok(iStrictFalse > 0, 'strict ogede acik kural yoksa erisim kapali olmali');
  assert.ok(iStrictFalse < iDefault, "strict kontrolu default_visible'dan ONCE gelmeli");
  // Kill-switch hala once gelir: strict, kapali bir ogeyi acmamali.
  const iEnabled = SRC.indexOf('!truthy(el.enabled)');
  const iStrict = SRC.indexOf('let strict = false;');
  assert.ok(iEnabled > 0 && iEnabled < iStrict, "enabled kontrolu strict'ten once olmali");
});

test('VE3: Crypto Hub SIKI DEGIL ama normal kullaniciya KAPALI', () => {
  // 2026-10-01: sikilik kaldirildi (yoneticiler kapida kaliyordu). Sayfanin normal
  // kullaniciya kapali kalmasi `roles: ['Admin']`den gelir - seed onu default_visible=0
  // olarak yazar. Ikisini birlikte olcmek sart: yalniz sikiligi kaldirmak, sayfayi
  // herkese acmak anlamina GELMEMELI.
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const i = setup.indexOf("element_key: 'CryptoHub'");
  assert.ok(i > 0, 'CryptoHub seed satiri olmali');
  const blok = setup.slice(i, i + 900);
  assert.ok(
    !/metadata: \{ strict: true \}/.test(blok),
    'CryptoHub yeniden SIKI yapilmis - yoneticiler kapida kalir',
  );
  assert.match(blok, /roles: \['Admin'\]/, 'sayfa normal kullaniciya acilmis');
  assert.match(setup, /restricted\s*\?\s*0/, "roles verilen oge default_visible=0 olmali");
  // Seed metadata kolonunu GERCEKTEN yazmali; baska siki ogeler icin hala gerekli.
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
    path.join(
      __dirname,
      '..',
      '..',
      '..',
      'src',
      'components',
      'admin',
      'tabs',
      'PageVisibilityTab.tsx',
    ),
    'utf8',
  );
  assert.match(tab, /elementsApi\.setStrict/);
  assert.match(tab, /admin muafiyeti YOKTUR/, 'siki ogede ipucu duzeltilmis olmali');
});

test('VE6: "neden goremiyor" tanisi - explain ucu', () => {
  // Kullanici: "e-postalarini ekledigim kisiler icin halen 403 aliyorum."
  // Sebebi TAHMIN etmek yerine OLCMEK icin: explain, motorun gercekten hangi degerlerle
  // karar verdigini (ozellikle oturumdaki e-postayi) ve hangi kuralin eslestigini doner.
  assert.match(SRC, /async function explainVisibility/);
  // Karar gerekcesi ve eslesen kural donmeli.
  assert.match(SRC, /sebep:/);
  assert.match(SRC, /eslesenKural:/);
  // OTURUMDAKI E-POSTA gorunmeli: en sik sebep, kuralin yanlis olmasi degil oturumdaki
  // mail'in bos/farkli olmasidir.
  assert.match(SRC, /kullanici: \{ username: usernameLower, mail: mailLower/);
  // Ata zinciri de degerlendirilmeli: ust oge gizliyse cocuk da gorunmez.
  assert.match(SRC, /ust oge gizli/);

  const routes = fs.readFileSync(path.join(__dirname, '..', 'visibility-routes.cjs'), 'utf8');
  // Tirnak turu degisebilir (prettier); iddia ucun VARLIGI.
  const i = routes.search(/['"]\/explain['"]/);
  assert.ok(i > 0, 'explain ucu olmali');
  const blok = routes.slice(i, i + 1200);
  // Herkes KENDINI sorgulayabilir; BASKASINI yalniz Admin simule edebilir - aksi halde bu
  // uc, kimin neye erisebildigini sizdiran bir kesif araci olurdu.
  // Tirnak turu iddianin konusu degil (prettier cevirebiliyor).
  assert.match(blok, /me\.role !== ['"]Admin['"]/);
  assert.match(blok, /status\(403\)/);
});

test('VE6b: simulasyon GERCEK kimlikle yapilir (gruplar bos varsayilmaz)', () => {
  // Uretim (2026-09-29): "Osman Kozen kullanicisi halen erisemiyor". Teshis icin explain
  // ucu kullanilir - ama uc, simule edilen kullaniciyi HER ZAMAN `role:'User', groups:[]`
  // ile kuruyordu. Yani grup kuraliyla yetkilendirilmis birine "goremez" diyordu:
  // "neden erisemiyor" sorusunu cevaplamak icin yazilmis arac, tam da o soruda YANLIS
  // cevap uretiyordu.
  const routes = fs.readFileSync(path.join(__dirname, '..', 'visibility-routes.cjs'), 'utf8');
  const i = routes.search(/['"]\/explain['"]/);
  const blok = routes.slice(i, i + 3000);
  assert.match(blok, /findLdapUserByUsername/, 'simulasyonda gercek LDAP kimligi okunmuyor');
  assert.match(blok, /hedef\.groups = /, 'gruplar simulasyona tasinmiyor - grup kurali gorunmez');
  // EKSIK VERIYLE VERILEN CEVAP, KESIN CEVAP GIBI GORUNMEMELI.
  // CATCH DALI da uyarmali: LDAP dusunce sessizce 'gruplar bos' varsaymak, yanlis
  // cevabi kesin cevap gibi gosterirdi.
  const duz = blok.replace(/\s+/g, ' ');
  assert.match(
    duz,
    /catch \(err\) \{ hedef\.kimlikUyarisi/,
    'LDAP okunamadiginda uyari yok - eksik cevap kesin sanilir',
  );
  assert.match(blok, /kimlikKaynagi/, 'cevabin neye dayandigi bildirilmiyor');

  // LDAP tarafi gruplari GERCEKTEN donmeli (memberOf zaten cekiliyordu ama tasinmiyordu).
  const ldap = fs.readFileSync(path.join(__dirname, '..', 'ldap.cjs'), 'utf8');
  const j = ldap.indexOf('async function findLdapUserByUsername');
  assert.ok(j > 0, 'findLdapUserByUsername yok');
  assert.match(ldap.slice(j, j + 2500), /groups:/, 'findLdapUserByUsername gruplari donmuyor');
});

test('VE7: kullanici adi BUYUK/KUCUK harf ayrimi yapmaz', () => {
  // Uretimde gorulen (2026-09-26): "osmankoz ile girersem yetkin yok diyor, OsmanKoz ile
  // girersem goruyorum." Oturumdaki kullanici adi zaten normalizeUsername ile kucuk harfe
  // ceviriliyor; kirilma noktasi VERITABANI tarafiydi - rol override'i YAZARKEN kullanicinin
  // yazdigi bicim kaydediliyor, OKURKEN kucuk harf araniyordu. Harf duyarli bir collation'da
  // satir bulunamiyor ve kullanici rolunu sessizce kaybediyordu.
  const rs = fs.readFileSync(path.join(__dirname, '..', 'role-store.cjs'), 'utf8');
  assert.match(
    rs,
    /const uname = String\(username \|\| ''\)\.trim\(\)\.toLowerCase\(\);/,
    'setRoleOverride kullanici adini kucuk harfe cevirmeli',
  );
  // Okuma ve silme de collation'dan BAGIMSIZ olmali.
  for (const sorgu of [
    /SELECT role FROM user_role_overrides WHERE LOWER\(username\)/,
    /DELETE FROM user_role_overrides WHERE LOWER\(username\)/,
    /UPDATE user_role_overrides SET role = \$1[\s\S]{0,140}WHERE LOWER\(username\)/,
  ]) {
    assert.match(rs, sorgu, 'sorgu LOWER(username) ile eslestirmeli');
  }
  // Ham (normalize edilmemis) kullanici adiyla yazma KALMAMALI.
  assert.ok(
    !/VALUES \(\$1, \$2, 'manual'[\s\S]{0,80}\[username,/.test(rs),
    'INSERT ham kullanici adini yazmamali',
  );

  // Gorunurluk kural indeksi de okuma tarafinda normalize etmeli (elle atilmis satirlar).
  assert.match(SRC, /String\(r\.principal_id\)\.trim\(\)\.toLowerCase\(\)/);
});
