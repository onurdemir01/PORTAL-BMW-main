// src/__tests__/logx-legacy-manual-entry.test.cjs — LEGACY ELLE GIRIS (ekran tarafi).
//
// Uygulama ve sunucu SADECE envanter listesinden secilebiliyordu; envantere henuz
// girmemis (ya da adi farkli kaydedilmis) bir uygulama icin kullanicinin hicbir yolu
// yoktu ve akis orada BITIYORDU.
//
// BES SART, HER BIRI AYRI BEKCI:
//   KONTROLLU     — sunucu kapisi varsayilan KAPALI; ekran yalnizca bayragi tetikler.
//   ONGORULUR     — ne gonderilecegi (BUYUK HARF hali) yazmadan ONCE gorunur.
//   ANLASILIR     — envanterde olmamanin ne demek oldugu acikca yazar.
//   GERI BILDIRIM — bicim hatasi ANINDA soylenir; kullanici 400 beklemez.
//   IZLENEBILIR   — elle girilenler istek kaydina ve denetime yazilir (sunucu tarafi:
//                   server/logx/v2/__tests__/legacy-host-selection.test.cjs EG7/EG10).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
    .join('\n');
// Bicim degil KURAL: prettier bu depoda tek seferde 14 bekci kirdi.
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

const APP_STEP = codeOnly(read('components/logx_v2/steps/legacy/AppSearchStep.tsx'));
const HOST_STEP = codeOnly(read('components/logx_v2/steps/legacy/HostSelectStep.tsx'));
const PAGE = codeOnly(read('components/logx_v2/LogXWizardPage.tsx'));
const API = codeOnly(read('api/logxV2Api.ts'));

// ── KONTROLLU ───────────────────────────────────────────────────────────────

test('ME1 bayrak YALNIZCA elle giris varken gonderilir (kapi bos yere acilmaz)', () => {
  // Elle girilen sunucu yoksa istek eskisiyle BIREBIR ayni gitmeli ve sunucudaki
  // anti-TOCTOU kapisi tam gucuyle calismali.
  assert.match(
    norm(PAGE),
    // Prettier cagriyi tek satira toplayabilir ya da satirlara bolebilir; sondaki
    // virgul de bicime gore gelir/gider. Olculen KURAL: bayrak, elle giris olup
    // olmadigina BAGLI.
    /discoverLegacy\(\s*requestId,\s*legacyApp,\s*hosts,\s*opts\.manual\.length > 0,?\s*\)/,
    'bayrak kosulsuz gonderiliyor ya da hic gonderilmiyor',
  );
});

test('ME2 API bayragi YALNIZCA true iken govdeye koyar', () => {
  assert.match(
    norm(API),
    /\.\.\.\(allowManual \? \{ allowManual: true \} : \{\}\)/,
    'bayrak her istekte gonderiliyor — kapi surekli acik kalir',
  );
});

// ── ONGORULUR ───────────────────────────────────────────────────────────────

test('ME3 gonderilecek deger BUYUK HARFE cevrilir ve ekranda GOSTERILIR', () => {
  // Kullanici yazdigini degil GONDERILECEGI gormeli.
  assert.match(norm(APP_STEP), /const typed = search\.trim\(\)\.toUpperCase\(\)/);
  assert.match(norm(APP_STEP), /\{typed\}/, 'gonderilecek deger ekranda gosterilmiyor');
  assert.match(norm(HOST_STEP), /const manualTyped = manualInput\.trim\(\)\.toUpperCase\(\)/);
  // COKLU EKLEME (2026-10-02): gonderilecek adlar LISTE olarak gosterilir.
  assert.match(
    norm(HOST_STEP),
    /\{manualNew\.join\(", "\)\}/,
    'gonderilecek sunucu adlari gosterilmiyor',
  );
});

test('ME4 listede ZATEN VARSA serbest metin yolu CIKMAZ (yinelenen giris olmasin)', () => {
  assert.match(
    norm(APP_STEP),
    /const exactExists = apps\.some\(\(a\) => a\.toUpperCase\(\) === typed\)/,
    'uygulama adi icin yinelenen giris kontrolu yok',
  );
  assert.match(norm(APP_STEP), /!exactExists/, 'kontrol hesaplaniyor ama KULLANILMIYOR');
  assert.match(
    norm(HOST_STEP),
    /const manualInInventory = manualTokens\.filter\(\(t\) => inventoryNames\.has\(t\)\)/,
    'sunucu icin envanterde-var kontrolu yok',
  );
});

// ── GERI BILDIRIM ───────────────────────────────────────────────────────────

test('ME5 bicim hatasi ANINDA soylenir (400 beklenmez)', () => {
  const n = norm(HOST_STEP);
  // Sunucudaki kapinin AYNISI ekranda da olmali ki kullanici yazarken gorsun.
  assert.match(n, /const SAFE_MANUAL_HOST_RE = \/\^\[A-Za-z0-9\._-\]\{1,64\}\$\//);
  // TANIMLAYICININ VARLIGI YETMEZ — REGEX'TEN TURETILDIGI aranir. Ilk surum
  // yalnizca `const manualFormatBad = ` ariyordu ve denetimi `= false` yapmak
  // bekciyi YESIL birakiyordu (mutasyonla yakalandi): kullanici gecersiz bir ad
  // yazip sunucudan 400 almayi bekliyordu, yani "aninda geri bildirim" sarti
  // sessizce kaybolmustu.
  assert.match(
    n,
    /const manualBad = manualTokens\.filter\(\(t\) => !SAFE_MANUAL_HOST_RE\.test\(t\)/,
    'bicim durumu regex`ten TURETILMIYOR — denetim sahte olabilir',
  );
  assert.match(n, /const manualFormatBad = manualBad\.length > 0/);
  assert.match(n, /\{manualTyped && manualFormatBad && \(/, 'hata mesaji RENDER EDILMIYOR');
  assert.match(n, /Geçersiz karakter/, 'kullaniciya ne oldugunu soyleyen metin yok');
});

test('ME6 gecersiz deger EKLENEMEZ (dugme kapali)', () => {
  const n = norm(HOST_STEP);
  assert.match(
    n,
    /const manualCanAdd = manualNew\.length > 0 && !manualFormatBad/,
    'ekleme kosulu eksik',
  );
  assert.match(n, /disabled=\{busy \|\| !manualCanAdd\}/, 'dugme kosula BAGLI degil');
});

// ── ANLASILIR ───────────────────────────────────────────────────────────────

test('ME7 envanterde OLMAMANIN ne demek oldugu yaziyor', () => {
  const n = norm(HOST_STEP);
  assert.match(n, /envanterde yok/, 'sonucu anlatan metin yok');
  assert.match(n, /ortamı da bilinmiyor|ortamı da\s*bilinmiyor/, 'ortam bilinmezligi soylenmiyor');
  // Eklenen her ad ROZETLE isaretlenmeli: liste icinde kaybolmasin.
  assert.match(n, /\{manual\.map\(\(h\) => \(/, 'elle eklenenler listelenmiyor');
});

test('ME8 envanterde HIC sunucu yokken de elle giris YAPILABILIR', () => {
  // Bu cikmaz ozellikle ELLE GIRILEN bir uygulamada KESIN olusur: envanterde kaydi
  // olmayan bir uygulamanin sunucusu da yoktur. Acilmazsa uygulama adini elle girme
  // ozelligi tek basina ISE YARAMAZDI.
  // TEK DUZEN (2026-10-02): erken donus ekrani ilk "Ekle"de liste ekranina geciyor,
  // tarama dugmesi ise HIC acilmiyordu. Artik ayri bir "envanter bos" ekrani YOK;
  // davranis LogXSihirbaz.test.tsx H1-H3'te render edilerek kanitlanir.
  const n = norm(HOST_STEP);
  assert.doesNotMatch(
    n,
    /if \(hosts\.length === 0 && manual\.length === 0\)/,
    'ayri "envanter bos" ekrani geri gelmis — tarama dugmesi orada yok',
  );
  assert.equal(
    (n.match(/\{manualEntryBlock\}/g) || []).length,
    1,
    'elle giris blogu tek duzende bir kez cizilmeli',
  );
});

// ── SUNUCUYA GERCEKTEN GIDIYOR MU ───────────────────────────────────────────

test('ME9 elle girilenler gonderilen listeye DAHIL ediliyor', () => {
  assert.match(
    norm(HOST_STEP),
    /onSubmit\(\[\.\.\.selectedHostNames, \.\.\.manual\], \{ manual \}\)/,
    'elle girilen sunucular gonderime dahil edilmiyor — kullanici ekledi saniyor',
  );
  // DUGME ELLE EKLENENLERI DE SAYAR — raporlanan hata buydu.
  assert.match(norm(HOST_STEP), /const toplam = selectedHostNames\.length \+ manual\.length/);
  assert.match(norm(HOST_STEP), /disabled=\{busy \|\| toplam === 0\}/);
});
