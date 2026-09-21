// server/scalex/__tests__/hedef-bazli-secim.test.cjs
//
// HEDEF BAZLI SECIM (PBI P1-2).
//
// Secim bugune kadar AD BAZLIYDI ve hedefler `uygulama × cluster` CARPIMI
// olarak uretiliyordu — "su cluster'da uygula, otekinde uygulama" IFADE
// EDILEMIYORDU. Kullanici dort cluster'lik bir listede tek bir cluster'i haric
// tutamiyor, ya hepsi ya hicbiri oluyordu.
//
// EN TEHLIKELI HATA SINIFI BURADA YETKI GENISLEMESI: istemciden gelen bir hedef
// listesi, kullanicinin GOREMEDIGI bir cluster'a dokunmasina yol acmamali.
// Liste yalnizca DARALTABILIR.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const launch = require('../launch.cjs');
const IX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const RUNPHASE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'ansible', 'bmw_portal', 'scalex', 'scalex_app', 'tasks', '10_run_phase.yml'),
  'utf8',
);

test('HT1 cluster basina uygulama haritasi dogru kuruluyor', () => {
  const m = launch.buildClusterAppMap(
    [
      { cluster: 'c1', name: 'a' },
      { cluster: 'c1', name: 'b' },
      { cluster: 'c2', name: 'a' },
    ],
    ['a', 'b'],
  );
  assert.deepEqual(m, { c1: 'a,b', c2: 'a' });
});

test('HT2 YETKI SUZGECINDEN GECMEYEN ad haritaya GIREMEZ', () => {
  // Istemciden gelen liste kapsami GENISLETEMEZ. `allowedApps` zaten
  // `ocp_app` yetki suzgecinden gecmis kumedir.
  const m = launch.buildClusterAppMap(
    [
      { cluster: 'c1', name: 'a' },
      { cluster: 'c1', name: 'gizli-uygulama' },
    ],
    ['a'],
  );
  assert.deepEqual(m, { c1: 'a' }, 'yetkisiz ad haritaya sizmis');
});

test('HT3 TAM CARPIM tespit ediliyor (gereksiz extra_var gonderilmesin)', () => {
  const tam = { c1: 'a,b', c2: 'a,b' };
  assert.equal(launch.isFullProduct(tam, ['c1', 'c2'], ['a', 'b']), true);
  // Bir cluster'da bir uygulama eksik -> TAM CARPIM DEGIL
  assert.equal(launch.isFullProduct({ c1: 'a,b', c2: 'a' }, ['c1', 'c2'], ['a', 'b']), false);
  // Bir cluster hic yok -> TAM CARPIM DEGIL
  assert.equal(launch.isFullProduct({ c1: 'a,b' }, ['c1', 'c2'], ['a', 'b']), false);
});

test('HT4 PATLAMA YARICAPI carpim degil GERCEK hedef sayisi', () => {
  // Carpimi kullanmak, kullanici hedeflerin yarisini haric tuttugunda bile
  // "yazili onay gerekir" demek — ve daha kotusu, `maxTargets` sinirini HIC
  // etkilenmeyecek hedefler yuzunden asmak olurdu.
  const ortak = { clusters: ['c1', 'c2'], apps: ['a', 'b'], environment: 'prod', action: 'stop', executionMode: 'apply' };
  assert.equal(launch.computeBlastRadius(ortak).targets, 4, 'carpim yanlis');
  assert.equal(
    launch.computeBlastRadius({ ...ortak, selectedTargets: [{ cluster: 'c1', name: 'a' }] }).targets,
    1,
    'hedef bazli sayim yapilmiyor',
  );
});

test('HT5 istemci listesi kapsami GENISLETEMEZ (sunucu normalizasyonu)', () => {
  const kod = IX.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const i = kod.indexOf('function normalizeTargets');
  assert.ok(i > 0, 'normalize edici yok');
  const govde = kod.slice(i, kod.indexOf('async function readOcoConfig'));
  assert.match(govde, /clusterSet\.has\(cluster\)/, 'cluster kapsam disi olabiliyor');
  assert.match(govde, /appSet\.has\(name\)/, 'uygulama kapsam disi olabiliyor');
  // Olu dal yasak — kapinin metinde durup hic kosmamasi bu depoda tekrar eden bicim.
  assert.ok(!/if \((?:false|0)\)/.test(govde), 'kapi OLU DALA alinmis');
});

test('HT6 UC ucun hepsi hedef listesini OKUYOR (ayrisma olmasin)', () => {
  const kod = IX.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // `/preview` ve `/run` — ikisi de normalize edip patlama yaricapina gecirmeli.
  const kez = (kod.match(/normalizeTargets\(req\.body\?\.targets/g) || []).length;
  assert.ok(kez >= 2, `hedef listesi ${kez} ucta okunuyor — /preview ve /run ikisi de okumali`);
  const gecir = (kod.match(/selectedTargets,?\n?\s*\}\)/g) || []).length;
  assert.ok(gecir >= 1, 'patlama yaricapina gecirilmiyor');
  assert.match(kod, /targets: selectedTargets/, 'extra_vars`a gecirilmiyor');
});

test('HT7 playbook APP_RAW`i CLUSTER BASINA cozuyor', () => {
  assert.match(
    RUNPHASE,
    /APP_RAW: "\{\{ scalex_cluster_apps_effective\[scalex_target\.cluster\] \| default\(target_app_list \| join\(','\)\) \}\}"/,
    'APP_RAW hala tum listeye sabit',
  );
  // `default(x, true)` BOOLEAN bicimi KULLANILMAMALI: bu cluster icin KASITLI
  // bos liste gonderilmis olabilir (kullanici o cluster'da hicbir hedef
  // birakmadi) ve boolean bicimi onu "tanimsiz" sayip TUM listeye geri duserdi
  // — haric tutulan hedefler YINE islem gorurdu.
  const satir = RUNPHASE.split('\n').find((l) => l.includes('APP_RAW:'));
  assert.ok(!/default\([^)]*,\s*true\s*\)/.test(satir), 'BOOLEAN default kullanilmis — kasitli bos liste ezilir');
});

test('HT8 hedef verilmediginde davranis BUGUNKU ile ayni', () => {
  // Geriye uyum: `targets` yoksa harita bos, `scalex_cluster_apps` gonderilmez
  // ve playbook `target_app_names`e (tam carpim) duser.
  assert.deepEqual(launch.buildClusterAppMap(null, ['a']), {});
  assert.deepEqual(launch.buildClusterAppMap([], ['a']), {});
  const kod = IX.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.match(kod, /if \(!Array\.isArray\(raw\) \|\| !raw\.length\) return null;/, 'bos liste null donmuyor');
});
