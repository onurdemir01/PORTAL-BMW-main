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

test('BOYUT: masthead 36px, giris 48px', () => {
  assert.match(MASTHEAD, /<PortalLogo className="h-9 w-9" \/>/,
    'masthead logosu buyutulmemis (PF6 bu alana 38px kadar yer ayiriyor)');
  assert.match(LOGIN, /<PortalLogo className="h-12 w-12" \/>/);
});

test('KIRPMA YOK: yuklenen logo tamami gorunur', () => {
  assert.ok(!/object-cover/.test(LOGO),
    'object-cover duruyor — kare olmayan logolar (wordmark) kenarlarindan KESILIR');
  assert.ok(!/scale-\[1\.16\]/.test(LOGO), 'buyutup kirpan olcek duruyor');
  assert.match(LOGO, /object-contain/, 'logo en-boy orani korunarak sigdirilmali');
});

test('GOMULU VARSAYILAN kucuk boyutta okunur', () => {
  const opacities = [...LOGO.matchAll(/opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(opacities.length, 2, 'dort-bolme motifi iki soluk ceyrek icermeli');
  for (const o of opacities) {
    assert.ok(o >= 0.55, `ceyrek opakligi ${o} — 28-36px'te motif bulaniklasir`);
    // 1.0 yapmak motifi tek duz beyaz pencereye cevirirdi; donusumlu desen korunmali.
    assert.ok(o < 1, 'karsit ceyrekler duz beyaz olmamali, desen kaybolur');
  }
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
