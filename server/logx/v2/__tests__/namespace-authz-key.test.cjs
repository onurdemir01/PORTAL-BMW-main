// server/logx/v2/__tests__/namespace-authz-key.test.cjs
//
// GERCEK ACIK: namespace yetki anahtari `${tenant}/${env}/${clusters.join('+')}/${ns}`
// seklinde kuruluyordu. Kullanici TEK cluster secince anahtar `ark/prod/c1/ns` olup
// kisitlama satirina takiliyor, IKI cluster secince `ark/prod/c1+c2/ns` oluyor ve hicbir
// satirla eslesmedigi icin VARSAYILAN-ACIK modelde sessizce izin veriliyordu. Yani
// kisitlama, ikinci bir cluster secilerek atlanabiliyordu.
//
// Bu test kaynak metni denetler cunku ilgili kod bir Express route kapanisi icindedir ve
// dogrudan cagrilamaz; kritik olan da zaten "birlestirilmis anahtarin geri gelmemesi".
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

// Yorum satirlari ayiklanir: acigi ANLATAN yorum (index.cjs'te bilerek duruyor, tekrar
// edilmesin diye) desenin kendisini icerir ve testi yanlis yere dusururdu.
const CODE = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('namespace yetki anahtarinda BIRLESTIRILMIS cluster listesi kullanilmaz', () => {
  // `clusters.join('+')` deseninin herhangi bir bicimi geri gelirse acik da geri gelir.
  const birlesik = CODE.match(/clusters[^\n]*\.join\(\s*['"]\+['"]\s*\)/g) || [];
  assert.deepEqual(birlesik, [], 'yetki anahtari cluster basina kurulmali');
});

test('hem log cekme hem uygulama kesfi AYNI yetki kapisindan gecer', () => {
  assert.match(SRC, /async function assertNamespaceAllowed\(/, 'ortak yardimci tanimli olmali');

  // Iki uc de yardimciyi cagirmali; biri unutulursa yetki iki uctan farkli uygulanir.
  const cagrilar = SRC.match(/assertNamespaceAllowed\(/g) || [];
  assert.ok(cagrilar.length >= 3, `tanim + en az iki cagri beklenir, bulunan: ${cagrilar.length}`);

  const fetchRoute = SRC.slice(SRC.indexOf("router.post('/ocp/:requestId/discover-fetch'"));
  assert.match(fetchRoute.slice(0, 600), /assertNamespaceAllowed\(/,
    'log cekme ucu yetki kapisindan gecmeli');

  const appsRoute = SRC.slice(SRC.indexOf("router.post('/ocp/:requestId/apps/discover'"));
  assert.match(appsRoute.slice(0, 900), /assertNamespaceAllowed\(/,
    'uygulama kesfi ucu yetki kapisindan gecmeli');
});

test('canlı kesif sonucu da kisitlamalardan gecirilir', () => {
  // Onbellek ucu filtreliyordu ama AWX kesfinin sonucu ham donuyordu; kullanici
  // "listele" diyerek kisitli namespace'leri gorebiliyordu.
  assert.match(SRC, /async function filterDiscoveryResult\(/);
  const getRoute = SRC.slice(SRC.indexOf("router.get('/requests/:requestId'"));
  assert.match(getRoute.slice(0, 1400), /filterDiscoveryResult\(/,
    'istek okuma ucu kesif sonucunu suzmeli');
});
