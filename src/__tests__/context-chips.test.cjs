// src/__tests__/context-chips.test.cjs — SIHIRBAZ KUNYESI.
//
// NEDEN VAR: bu portalda bir islem birden cok adimda kuruluyor (ortam → tenant →
// cluster → namespace → uygulama → islem). Kullanici ucuncu adimda "ben hangi
// ortamdaydim?" diye sordugunda ekranda cevabi YOKTU: kunye yalnizca Telnet'te,
// yalnizca son adimda ve ELLE YAZILMIS halde duruyordu.
//
// Kozmetik bir eksik degil: ScaleX'in sonu bir PROD kesintisi olabilir ve "hangi
// ortamdayim" sorusu kullanicinin KAZARA ogrenmemesi gereken bir bilgidir.
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
// Bicim degil KURAL olculur: prettier bu depoda tek seferde 14 bekci kirdi.
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

const WIZARDS = [
  ['ScaleX', 'components/scalex/ScaleXPage.tsx'],
  ['LogX', 'components/logx_v2/LogXWizardPage.tsx'],
  ['Telnet', 'components/telnet/TelnetWizardPage.tsx'],
];

test('CC1 her sihirbaz ortak kunye bilesenini GERCEKTEN render ediyor', () => {
  // TANIMIN VARLIGI DEGIL KULLANIMI aranir: bu depoda bekciler defalarca `import`
  // satiriyla eslesip, render silindiginde yesil kaldi.
  for (const [name, f] of WIZARDS) {
    const code = norm(codeOnly(read(f)));
    assert.match(code, /<ContextChips/, `${name}: kunye RENDER EDILMIYOR (import yetmez)`);
  }
});

test('CC2 PROD tespiti TEK tanimdan gelir (ekranda ikinci kopya yok)', () => {
  // Ayni soru artik hem ScopeStep'in prod vurgusunda hem her adimdaki kunyede
  // soruluyor. Ikinci bir kopya, birinin degisip digerinin sessizce eskimesi demekti.
  const util = norm(codeOnly(read('utils/env.ts')));
  assert.match(util, /const PROD_VALUES = \["prod", "production"\]/, 'ortak tanim yok');

  // Hicbir ekran kendi listesini tasimamali.
  const suspects = [
    'components/scalex/ScaleXPage.tsx',
    'components/scalex/steps/ScopeStep.tsx',
    'components/logx_v2/LogXWizardPage.tsx',
    'components/telnet/TelnetWizardPage.tsx',
  ];
  for (const f of suspects) {
    const code = norm(codeOnly(read(f)));
    assert.ok(
      !/\["prod", "production"\]/.test(code),
      `${f}: prod listesinin IKINCI bir kopyasi var — biri degisince digeri eskir`,
    );
  }
});

test('CC3 ScaleX kunyesinde PROD ayri agirlik tasiyor', () => {
  // ScopeStep prod'u zaten vurguluyordu ama YALNIZCA kendi adiminda; sonraki dort
  // adimda o vurgu kayboluyordu.
  const code = norm(codeOnly(read('components/scalex/ScaleXPage.tsx')));
  assert.match(
    code,
    /tone: isProdEnv\(env\) \? "danger" : "neutral"/,
    'prod ortami kunyede vurgulanmiyor',
  );
});

test('CC4 bos deger kunyede SATIR URETMEZ', () => {
  // "Cluster: —" gibi bir satir bilgi vermez, yalnizca gurultu uretir; kunye de
  // zaten dar bir seride duruyor.
  const code = norm(codeOnly(read('components/common/ContextChips.tsx')));
  assert.match(
    code,
    /items\.filter\(\(c\) => String\(c\.value \?\? ""\)\.trim\(\) !== ""\)/,
    'bos degerler suzulmuyor',
  );
  assert.match(code, /if \(visible\.length === 0\) return null;/, 'bos kunye bos kutu birakiyor');
});

test('CC5 kunye ERISILEBILIR (adim degistikce degisen bir bolge)', () => {
  const code = norm(codeOnly(read('components/common/ContextChips.tsx')));
  assert.match(code, /aria-label="Seçim künyesi"/, 'ekran okuyucu icin etiket yok');
  // Ayirici karakter okunmamali.
  assert.match(code, /<span aria-hidden="true">·<\/span>/, 'ayirici ekran okuyucuya sizar');
});

test('CC6 uzun deger kunyeyi TASIRMAZ, tam metni `title`da durur', () => {
  // Coklu cluster/namespace seciminde liste tek satiri asar; kunye tasarsa
  // adim basligini ekranin disina iter.
  for (const [name, f] of WIZARDS) {
    const code = norm(codeOnly(read(f)));
    assert.match(code, /title: /, `${name}: uzun deger icin tam metin saklanmiyor`);
  }
});
