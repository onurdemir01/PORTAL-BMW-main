// server/nginx-console/__tests__/kanit-orani.test.cjs — KO1..KO5 (2026-10-08).
//
// KULLANICI BULGUSU: "match_by sorgusunu calistirdim, bence bu 'namespace okunamadi'
// uyarisinda bir sikinti var gibi... namespace'de ne okunamadi, direkt komple hicbir obje
// mi goruntulenemiyor? Cunku o zaman hic veri olmazdi gibi."
//
// Hakliydi. Uretim verisi:
//     ad        25072 satir  (12458 SPA)
//     ''         1306 satir
//     selector     48 satir
// Yani IS YUKLERI OKUNUYOR; okunamayan YALNIZCA `services`. Iki sonuc:
//   1. Ansible mesaji yanlis ozneliydi ("<tur>: N namespace okunamadi" -> "namespace
//      erisilemiyor" gibi okunuyordu). Duzeltildi: "N namespace'te <tur> okunamadi".
//   2. SPA kararlarinin %94,9'u ad benzerligine dayaniyor ve bu ORAN ekranda YOKTU -
//      uygulama basina "zayif kanit" rozeti vardi ama toplam gorunmuyordu. "12.458 SPA"
//      ile "12.458 SPA, cogu ad benzerligi" ayni guvenle okunuyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'spa-discovery.cjs'), 'utf8');
const UI = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'NginxSpaDiscovery.tsx'),
  'utf8',
);

test('KO1 byMatch kirilimi sunucu ozetinde URETILIYOR', () => {
  assert.match(SRC, /byMatch: rows\.reduce/, 'byMatch histogrami yok');
  assert.match(SRC, /if \(r\.matchBy\) m\[r\.matchBy\]/, 'matchBy sayilmiyor');
});

test('KO2 ORAN ekranda gorunuyor ve selector/ad AYRI yaziliyor', () => {
  assert.match(UI, /const bmSelector = bm\.selector \|\| 0;/, 'selector sayisi okunmuyor');
  assert.match(UI, /const bmAd = bm\.ad \|\| 0;/, 'ad sayisi okunmuyor');
  assert.match(UI, /Eşleşme kanıtı:/, 'kanit orani ozette gosterilmiyor');
  assert.match(UI, /ad benzerliği/, 'zayif kanit adiyla anilmiyor');
  assert.match(UI, /selector/, 'kesin kanit adiyla anilmiyor');
});

test('KO3 YUZDE yalniz ESLESENLER uzerinden (kapsam ile karistirilmaz)', () => {
  // Eslesmeyenleri paydaya koymak "kanit kalitesi" sorusunu "kapsam" sorusuyla
  // karistirirdi; eslesmeyen sayisi AYRICA gosteriliyor.
  assert.match(UI, /const bmOlculen = bmSelector \+ bmAd;/, 'payda eslesenler degil');
  assert.match(UI, /bmAd \/ bmOlculen/, 'yuzde yanlis payda kullaniyor');
  assert.ok(!/bmAd \/ \(?rs\.routes/.test(UI), 'yuzde route toplamina bolunuyor (kapsam karismis)');
  // Eslesmeyen sayisi ayrica yazili olmali
  assert.match(UI, /satır hiç eşleşmedi/, 'eslesmeyen sayisi gosterilmiyor');
});

test('KO4 ORAN BASKINSA uyari tonu ve SEBEP yazili', () => {
  assert.match(UI, /bmAdYuzde >= 50/, 'baskinlik esigi yok');
  assert.match(UI, /status-warning/, 'baskin oranda uyari tonu yok');
  // Duzeltmenin KOD degil YETKI oldugu yazili olmali: ekip yanlis yerde cozum aramasin.
  assert.match(UI, /Düzeltmesi kod değil <b>yetki<\/b>/, 'cozumun yetki oldugu yazili degil');
  assert.match(UI, /<code>services<\/code>/, 'hangi yetki oldugu yazili degil');
});

test('KO5 SIFIR/BOS veride iddia URETILMEZ', () => {
  // `byMatch` bos ise (eski yukleyici ya da veri yok) oran GOSTERILMEZ - "%0 zayif"
  // demek, olculmemis seyi olculmus gibi sunmak olurdu.
  assert.match(UI, /bmOlculen > 0 \? Math\.round/, 'bos veride yuzde hesaplaniyor');
  assert.match(UI, /: null;/, 'bos veride null donmuyor');
  assert.match(UI, /bmAdYuzde != null && bmAd > 0 &&/, 'kutu bos veride de ciziliyor');
});
