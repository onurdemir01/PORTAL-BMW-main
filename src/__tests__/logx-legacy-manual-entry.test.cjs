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
    /discoverLegacy\( requestId, legacyApp, hosts, opts\.manual\.length > 0, \)/,
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
  assert.match(norm(HOST_STEP), /\{manualTyped\}/, 'gonderilecek sunucu adi gosterilmiyor');
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
    /const manualInInventory = \(hosts \|\| \[\]\)\.some\(/,
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
    /const manualFormatBad =[^;]*SAFE_MANUAL_HOST_RE\.test\(manualTyped\)/,
    'bicim durumu regex`ten TURETILMIYOR — denetim sahte olabilir',
  );
  assert.match(n, /\{manualTyped && manualFormatBad && \(/, 'hata mesaji RENDER EDILMIYOR');
  assert.match(n, /Geçersiz karakter/, 'kullaniciya ne oldugunu soyleyen metin yok');
});

test('ME6 gecersiz deger EKLENEMEZ (dugme kapali)', () => {
  const n = norm(HOST_STEP);
  assert.match(
    n,
    /const manualCanAdd = manualTyped\.length >= 2 && !manualFormatBad && !manualInInventory && !manualAlreadyAdded/,
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
  const n = norm(HOST_STEP);
  assert.match(
    n,
    /if \(hosts\.length === 0 && manual\.length === 0\)/,
    'bos envanter hala mutlak cikmaz',
  );
  assert.match(n, /\{manualEntryBlock\}/, 'cikmaz ekraninda elle giris sunulmuyor');
  // TEK TANIM, IKI KULLANIM: iki kopya sessizce ayrisirdi.
  assert.equal(
    (n.match(/\{manualEntryBlock\}/g) || []).length,
    2,
    'elle giris blogu iki yerde de kullanilmiyor (ya da kopyalanmis)',
  );
});

// ── SUNUCUYA GERCEKTEN GIDIYOR MU ───────────────────────────────────────────

test('ME9 elle girilenler gonderilen listeye DAHIL ediliyor', () => {
  assert.match(
    norm(HOST_STEP),
    /onSubmit\(\[\.\.\.selectedHostNames, \.\.\.manual\], \{ manual \}\)/,
    'elle girilen sunucular gonderime dahil edilmiyor — kullanici ekledi saniyor',
  );
});
