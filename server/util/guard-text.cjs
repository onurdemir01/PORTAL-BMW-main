// server/util/guard-text.cjs — kaynak tarayan BEKCILER icin metin normalizasyonu.
//
// NEDEN VAR (2026-09-28, onuncu kez yasandi): bekcilerin cogu kaynak dosyada dizgi ariyor.
// Bir commit o dosyaya dokununca lint-staged prettier'i calistiriyor; prettier tek satirlik
// bir ifadeyi cok satira boluyor ya da tirnagi degistiriyor. Kod DAVRANISI aynen duruyor
// ama bekci kirmiziya donuyor. Boyle bir kirmizi iki kat zararli: hem bos yere zaman
// harciyor, hem de "bekciler zaten ara ara kirilir" aliskanligi yaratip GERCEK bulguyu
// gormezden gelmeyi kolaylastiriyor.
//
// KULLANIM: dosyayi `flatten()` ile duzlestir, deseni TEK BOSLUKLU yaz.
//
//   const { flatten } = require('../../util/guard-text.cjs');
//   const ui = flatten(fs.readFileSync(YOL, 'utf8'));
//   assert.match(ui, /const isDefinitionConfirmed = \( job: MigrationPathJob/);
//
// SINIR: duzlestirme ARALIKLARI yok saydirir, ICERIGI degil. Bir alan gercekten silinirse
// bekci yine kirmiziya doner — korumak istedigimiz duyarlilik budur.
'use strict';

/** Ardisik bosluk/satir sonlarini TEK bosluga indirir, bas/son bosluklari atar. */
const flatten = (s) =>
  String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim();

/** Cift tirnaklari tek tirnaga cevirir (prettier tirnak stilini degistirebiliyor). */
const singleQuoted = (s) => String(s == null ? '' : s).replace(/"/g, "'");

/** Ikisi birden: bicimlendiriciden TAMAMEN bagimsiz karsilastirma icin. */
const normalize = (s) => singleQuoted(flatten(s));

module.exports = { flatten, singleQuoted, normalize };
