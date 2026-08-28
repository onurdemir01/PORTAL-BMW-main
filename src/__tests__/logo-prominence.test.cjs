// src/__tests__/logo-prominence.test.cjs — logo belirginligi.
//
// UC AYRI SORUN vardi (2026-08-28 kullanici istegi: "logo daha belirgin olsun"):
//
//  1. BOYUT. Masthead'de 28px (h-7), giriste 36px (h-9). PF6 masthead'i logoya
//     `masthead__logo--MaxHeight: 2.375rem` (38px) ayirir — yani ayrilan yerin
//     ancak dortte ucu kullaniliyordu.
//
//  2. KIRPMA. Yuklenen logo `object-cover scale-[1.16]` ile BUYUTULUP KIRPILIYORDU.
//     Gerekce PNG'lerin tam saydam olmayan kose piksellerini gizlemekti, ama bu
//     KARE OLMAYAN her logoyu bozuyordu: genis bir wordmark'in sol/sag kenarlari
//     kesiliyor, ekranda ortasindan bir serit kaliyordu.
//
//  3. GOMULU VARSAYILAN. Dort-bolme motifinde karsit ceyrekler `opacity: 0.35`'ti;
//     28px'te motif bulanik bir kirmizi kareye donusuyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Yorumlar KALDIRILAN kodu ANLATMAK icin ondan alinti yapiyor; "hala duruyor mu"
// taramasi gercek KODA bakmali.
const stripComments = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const LOGO = stripComments(read('components/common/PortalLogo.tsx'));
const MASTHEAD = read('components/layout/Masthead.tsx');
const LOGIN = read('components/LoginPage.tsx');

test('BOYUT: masthead 36px (sade isaret), giris 56px (wordmark ile)', () => {
  assert.match(MASTHEAD, /<PortalLogo className="h-9 w-9" \/>/,
    'masthead logosu buyutulmemis (PF6 bu alana 38px kadar yer ayiriyor)');
  // Giris ekraninda logo TEK BASINA ve buyuk durur; wordmark'in okunabildigi en
  // kucuk boyut 56px.
  assert.match(LOGIN, /<PortalLogo className="h-14 w-14" withWordmark \/>/);
});

test('WORDMARK yalnizca BUYUK ve TEK BASINA kullanimda', () => {
  // Masthead'de logonun HEMEN YANINDA zaten "BMW Portal" yaziyor; ikonda tekrar
  // etmek 36px'te ~7px'lik okunmaz bir yazi uretirdi.
  assert.ok(!/withWordmark/.test(MASTHEAD), 'masthead sade isaret kullanmali');
  assert.match(LOGIN, /withWordmark/);
});

test('KIRPMA YOK: yuklenen logo tamami gorunur', () => {
  assert.ok(!/object-cover/.test(LOGO),
    'object-cover duruyor — kare olmayan logolar (wordmark) kenarlarindan KESILIR');
  assert.ok(!/scale-\[1\.16\]/.test(LOGO), 'buyutup kirpan olcek duruyor');
  assert.match(LOGO, /object-contain/, 'logo en-boy orani korunarak sigdirilmali');
});

test('GOMULU ISARET: referansin ogeleri (kutu + bulut + mozaik) yerinde', () => {
  // Tasarim kaynagi: action_list/logos.md (kullanici USTTEKI referansi sectti).
  assert.match(LOGO, /rx="13\.5"/, 'yuvarlak kose kutu yok');
  assert.match(LOGO, /CLOUD_D/, 'bulut konturu yok');
  assert.match(LOGO, /PIXELS_MARK/, 'veri mozaigi yok');
});

test('RENKLER referanstan ORNEKLENDI (uydurulmadi)', () => {
  // Referans goruntunun pikselleri orneklendi; degerler degistirilirse marka
  // kimligi kayar.
  for (const hex of ['#002351', '#000c22', '#00dba4', '#00f4d1', '#0085fd']) {
    assert.ok(LOGO.includes(hex), `referans rengi kayip: ${hex}`);
  }
});

test('GRADYAN ID’leri BENZERSIZ (ayni sayfada iki logo cakismasin)', () => {
  // Sabit id kullanilsaydi ayni sayfada iki logo ayni id'yi tanimlar, tarayici
  // ILKINI kullanir ve ikinci logo yanlis renkte cizilirdi.
  assert.match(LOGO, /React\.useId\(\)/);
  assert.match(LOGO, /id=\{`tile\$\{uid\}`\}/);
});

test('FAVICON ayni isareti kullanir ve METIN icermez', () => {
  const fav = fs.readFileSync(
    path.join(ROOT, '..', 'server', 'admin', 'branding.cjs'), 'utf8');
  const block = fav.slice(fav.indexOf('const DEFAULT_FAVICON_SVG'), fav.indexOf("'utf-8'"));
  assert.ok(!/<text/.test(block),
    'favicon bagimsiz servis edilir ve sayfanin fontlarina ERISEMEZ — <text> sistem fontuna duser');
  assert.ok(!/#ee0000/.test(block), 'eski kirmizi "B" favicon’u duruyor');
  assert.match(block, /#00dba4/, 'marka gradyani favicon’a tasinmamis');
  assert.match(block, /M2\.25 15a4\.5/, 'ayni bulut yolu kullanilmali');
});

test('AYIRICI: marka blogu araclardan gorsel olarak ayrisiyor', () => {
  assert.match(MASTHEAD, /aria-hidden="true" className="hidden sm:block h-8 w-px"/,
    'dikey ayirici yok — logo kalabalikta kayboluyor');
  assert.match(MASTHEAD, /background: "var\(--masthead-border\)"/);
});

test('marka metni token okuyor (masthead artik temayi izliyor)', () => {
  assert.match(MASTHEAD, /color: "var\(--nav-text\)"/);
  assert.match(MASTHEAD, /color: "var\(--nav-text-muted\)"/);
});

test('giris ekrani KOYU kalir, yalnizca tonlari PF6 notrlerine tasindi', () => {
  assert.match(LOGIN, /linear-gradient\(150deg, #151515 0%, #292929 45%, #1f1f1f 100%\)/,
    'giris gradyani PF6 notr grilerine tasinmamis');
});
