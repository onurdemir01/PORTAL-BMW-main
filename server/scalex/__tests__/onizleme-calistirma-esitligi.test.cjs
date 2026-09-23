// server/scalex/__tests__/onizleme-calistirma-esitligi.test.cjs
//
// ONIZLEME ILE CALISTIRMA AYNI HEDEF SAYISINI SOYLESIN.
//
// PR #123 hedef bazli secimi getirdi: sunucu `req.body.targets`i okuyup
// `computeBlastRadius`a `selectedTargets` olarak veriyor. AMA yalnizca `/run`
// yolunda. `/preview` cagrisi istemcide `targets` GONDERMIYORDU — sunucu okuyor,
// istemci yollamiyor.
//
// Sonuc: kullanici 12 hedeften 5'ini haric tutsa bile onizleme "12 hedef" diyor,
// `requiresWrittenConfirm` ve `exceedsMaxTargets` o SISMIS sayidan hesaplaniyor
// (gereksiz yazili onay) ve calistirma baska bir sayi kullaniyordu. Ekran,
// gerceklesmeyecek bir patlama yaricapi gosteriyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const launch = require('../launch.cjs');

const KAPSAM = {
  clusters: ['c1', 'c2', 'c3', 'c4'],
  apps: ['a', 'b', 'c'],
  environment: 'prod',
  action: 'stop',
  executionMode: 'apply',
};

test('PV1 GERCEK hesap: haric tutulan hedefler sayiya girmez', () => {
  const hepsi = launch.computeBlastRadius(KAPSAM);
  assert.equal(hepsi.targets, 12, 'tam carpim beklenirdi');

  // 12 hedeften 5'i haric tutuldu → 7 kalmali.
  const secili = [];
  for (const c of KAPSAM.clusters) for (const a of KAPSAM.apps) secili.push({ cluster: c, name: a });
  const kalan = secili.slice(0, 7);

  const daraltilmis = launch.computeBlastRadius({ ...KAPSAM, selectedTargets: kalan });
  assert.equal(daraltilmis.targets, 7, 'haric tutulanlar hala sayiliyor');
  assert.ok(
    daraltilmis.targets < hepsi.targets,
    'daraltma patlama yaricapini hic etkilemiyor',
  );
});

test('PV2 ONIZLEME ve CALISTIRMA ayni girdide AYNI sonucu verir', () => {
  const secili = [
    { cluster: 'c1', name: 'a' },
    { cluster: 'c2', name: 'b' },
  ];
  const onizleme = launch.computeBlastRadius({ ...KAPSAM, selectedTargets: secili });
  const calistirma = launch.computeBlastRadius({ ...KAPSAM, selectedTargets: secili });
  assert.deepEqual(onizleme, calistirma);
  assert.equal(onizleme.targets, 2);
});

test('PV3 yazili onay esigi SISMIS sayidan hesaplanmaz', () => {
  // Tam carpim esigi asiyor ama gercek secim asmiyorsa yazili onay ISTENMEMELI.
  const hepsi = launch.computeBlastRadius(KAPSAM);
  const tek = launch.computeBlastRadius({
    ...KAPSAM,
    selectedTargets: [{ cluster: 'c1', name: 'a' }],
  });
  if (hepsi.requiresWrittenConfirm) {
    assert.equal(
      tek.requiresWrittenConfirm,
      false,
      'tek hedef icin bile yazili onay isteniyor — sismis sayi kullaniliyor',
    );
  }
  assert.ok(tek.targets < hepsi.targets);
});

test('PV4 istemci `/preview` cagrisi `targets` GONDERIYOR', () => {
  const kod = kodOnly(oku('src/components/scalex/steps/PreviewStep.tsx'));
  const i = kod.indexOf('scalexApi');
  assert.ok(i > 0, 'preview cagrisi bulunamadi');
  const d = kod.slice(i, kod.indexOf('.then(', i));
  assert.match(d, /targets:\s*selectedTargets/, '/preview hedefleri gondermiyor');
});

test('PV5 `targets` istemci TIPINDE var (sessiz eksik tekrar etmesin)', () => {
  // PR #123'te `ocoAction` tam bu sekilde tipten eksik kalmisti: cagri YAYILIM
  // kullandigi icin TypeScript'in fazla-ozellik denetimi hic devreye girmemisti.
  const api = kodOnly(oku('src/api/scalexApi.ts'));
  const d = dilimArasi(api, '  preview(', '  run(');
  assert.match(d, /targets\?:\s*\{\s*cluster:\s*string;\s*name:\s*string\s*\}\[\]/, 'preview tipinde targets yok');

  function dilimArasi(src, bas, son) {
    const a = src.indexOf(bas);
    assert.ok(a >= 0, `bulunamadi: ${bas}`);
    const b = src.indexOf(son, a + bas.length);
    assert.ok(b > a, `bulunamadi: ${son}`);
    return src.slice(a, b);
  }
});

test('PV6 hedefler ONIZLEME bilesenine PROP olarak geciriliyor', () => {
  const kod = kodOnly(oku('src/components/scalex/ScaleXPage.tsx'));
  const i = kod.indexOf('<PreviewStep');
  assert.ok(i > 0, 'PreviewStep render edilmiyor');
  const d = kod.slice(i, kod.indexOf('/>', i));
  assert.match(d, /selectedTargets=\{selectedTargets\}/, 'hedefler onizlemeye gecirilmiyor');
});

test('PV7 onizleme LISTESI de haric tutulani gostermiyor', () => {
  const kod = kodOnly(oku('src/components/scalex/steps/PreviewStep.tsx'));
  const i = kod.indexOf('const picked =');
  assert.ok(i > 0, 'picked listesi bulunamadi');
  const d = kod.slice(i, i + 400);
  assert.match(d, /haricKumesi/, 'liste yalnizca uygulama ADINA bakiyor — cikarilan satir listede kaliyor');
});
