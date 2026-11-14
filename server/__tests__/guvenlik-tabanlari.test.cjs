// server/__tests__/guvenlik-tabanlari.test.cjs — kilitteki paketler bilinen zafiyetli surumlere
// GERI DUSMESIN (2026-11-12).
//
// Kurumsal bagimlilik taramasi (Xray) bu paketlerin asagidaki surumlerinden ESKISINI ihlal sayiyordu
// (29 ihlal; teslim kapisi "Fail_build"). Duzeltme kilit guncellemesi + `overrides` ile yapildi; bu
// bekci kilidi okur ve HER kopyanin (ic ice olanlar dahil) tabanin ustunde oldugunu sinar. Biri
// `npm install` ile eski bir alt surumu geri getirirse ya da bir override silinirse kirmizi doner.
//   GT1 her paket, her kopya: taban <= surum (ayni ana surum hattinda)
//   GT2 uri-js (bakimsiz, duzeltmesi yok) gercek paket olarak agacta YOK; ajv@6 icin fast-uri
//   GT3 debug 2.x (compression / express-session sabitliyordu) agacta YOK
//   GT4 package.json overrides yerinde (silinirse bir sonraki `npm install` geri getirir)
//
// 2026-11-14 (ikinci tarama, 11 ihlal): vite, hono, @hono/node-server, minimatch, brace-expansion
// tabanlari yukseldi. Gelistirme araclarinin glob kutuphanesinin duzeltmesi YOK (bakimcisi
// yayimlamiyor): kurumsal tarama repo kokunde `npm install`in kurdugu agaci gordugu icin kok
// manifest YALNIZ calisma zamani paketlerini tasir; tam agac gelistirme/ altindadir
// (scripts/manifest.cjs, scripts/kur.cjs).
//   GT5 kok manifest ve kok kilit gelistirme paketi TASIMAZ
//   GT6 kok manifestler tam manifestten turetilenle ESIT; turetme surum degistirmez
//   GT7 `prepare` husky yokken kurulumu DUSURMEZ (davranis: bos dizinde kosulur)
//   GT8 gelistirici kurulumu: bag kurulur / cozulur (davranis: gecici dizin); arac-kontrol
//   GT9 guvenlik kapisi TAM agaca bakar; Jenkins tam kurulumu kullanir
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const KOK = path.join(__dirname, '..', '..');
// TAM agac (calisma zamani + gelistirme) gelistirme/ altindadir; kok manifest ondan turetilir.
const TAM = path.join(KOK, 'gelistirme');
const KILIT = JSON.parse(fs.readFileSync(path.join(TAM, 'package-lock.json'), 'utf8')).packages;
const PKG = JSON.parse(fs.readFileSync(path.join(TAM, 'package.json'), 'utf8'));
const KOK_KILIT = JSON.parse(fs.readFileSync(path.join(KOK, 'package-lock.json'), 'utf8')).packages;
const KOK_PKG = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));

/** Kilitteki bir paketin butun kopyalari: [{ yer, surum, kaynak }]. */
function kopyalar(ad) {
  return Object.entries(KILIT)
    .filter(([k]) => k === `node_modules/${ad}` || k.endsWith(`/node_modules/${ad}`))
    .map(([k, v]) => ({ yer: k, surum: v.version, kaynak: v.resolved || '' }));
}

// Ana surum hattina gore en dusuk guvenli surum. Bir hat listede yoksa o hattaki HER surum ihlaldir.
const TABAN = {
  undici: { 7: '7.30.2', 8: '8.12.4' },
  'body-parser': { 2: '2.4.0' },
  qs: { 6: '6.16.2' },
  '@azure/msal-node': { 7: '7.1.0' },
  hono: { 4: '4.13.18' },
  '@hono/node-server': { 2: '2.1.7' },
  'fast-uri': { 3: '3.1.9' },
  'express-rate-limit': { 8: '8.7.2' },
  debug: { 4: '4.0.0' },
  minimatch: { 11: '11.0.8' },
  'brace-expansion': { 5: '5.0.13' },
  vite: { 8: '8.3.7' },
  semver: { 7: '7.5.2' },
};

test('GT1 guvenlik acisindan duyarli her paketin her kopyasi taban surumun ustunde', () => {
  const ihlal = [];
  for (const [ad, hatlar] of Object.entries(TABAN)) {
    const k = kopyalar(ad);
    assert.ok(k.length > 0, `${ad} kilitte yok - liste bayatlamis olabilir`);
    for (const { yer, surum } of k) {
      const taban = hatlar[semver.major(surum)];
      if (!taban || semver.lt(surum, taban))
        ihlal.push(`${yer}@${surum} (taban ${taban || 'bu hat yok'})`);
    }
  }
  assert.deepEqual(ihlal, []);
});

test('GT2 uri-js gercek paket olarak yok; ajv@6 fast-uri kullaniyor', () => {
  for (const { yer, kaynak } of kopyalar('uri-js')) {
    assert.match(
      kaynak,
      /\/fast-uri\/-\/fast-uri-/,
      `${yer}: uri-js gercek paket (bakimsiz, duzeltmesi yok)`,
    );
  }
});

test('GT3 debug 2.x agacta yok', () => {
  const eski = kopyalar('debug').filter((x) => semver.major(x.surum) < 4);
  assert.deepEqual(eski, []);
});

test('GT4 overrides yerinde', () => {
  const o = PKG.overrides || {};
  assert.equal(o.compression?.debug, '^4.4.3');
  assert.equal(o['express-session']?.debug, '^4.4.3');
  assert.match(String(o.minimatch), /^\^11\./);
  assert.ok(
    semver.gte(semver.minVersion(o.minimatch), '11.0.8'),
    `minimatch override ${o.minimatch}`,
  );
  assert.match(String(o['@babel/core']?.semver), /^\^7\./);
  assert.match(String(o['@babel/helper-compilation-targets']?.semver), /^\^7\./);
  assert.match(String(o['uri-js']), /^npm:fast-uri@\^3\./);
});

const oku = (...p) => fs.readFileSync(path.join(KOK, ...p), 'utf8');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const manifest = require('../../scripts/manifest.cjs');

// Kurumsal taramanin ihlal saydigi ya da yalniz gelistirmede anlamli paketler: kok kilide girerse
// kurumsal pipeline onlari kurar ve tarar.
const GELISTIRME_PAKETLERI = [
  'vite',
  'vitest',
  'eslint',
  'typescript',
  'husky',
  'jsdom',
  'picomatch',
  'minimatch',
  'brace-expansion',
  'rolldown',
];

test('GT5 kok manifest ve kok kilit gelistirme paketi tasimaz', () => {
  assert.equal(KOK_PKG.devDependencies, undefined, 'kok package.json devDependencies tasiyor');
  assert.equal(KOK_KILIT[''].devDependencies, undefined);
  const devGirdi = Object.entries(KOK_KILIT).filter(([, v]) => v.dev || v.devOptional);
  assert.deepEqual(
    devGirdi.map(([k]) => k),
    [],
  );
  const adlar = new Set(Object.keys(KOK_KILIT).map((k) => k.replace(/^.*node_modules\//, '')));
  assert.deepEqual(
    GELISTIRME_PAKETLERI.filter((a) => adlar.has(a)),
    [],
  );
  // Tam manifestte hepsi VAR (liste bayatlamasin).
  const tamAdlar = new Set(Object.keys(KILIT).map((k) => k.replace(/^.*node_modules\//, '')));
  assert.deepEqual(
    GELISTIRME_PAKETLERI.filter((a) => !tamAdlar.has(a)),
    [],
  );
  // Kok override'lari yalniz calisma zamani ust paketleri icindir.
  for (const ad of Object.keys(KOK_PKG.overrides || {}))
    assert.ok(KOK_PKG.dependencies[ad], `kok override ${ad} calisma zamani paketi degil`);
});

test('GT6 kok manifestler tam manifestten turetilenle esit; turetme surum degistirmez', () => {
  assert.deepEqual(manifest.farklar(), [], 'npm run manifest calistirilmali');
  // Calisma zamani bagimliliklari iki manifestte AYNI.
  assert.deepEqual(KOK_PKG.dependencies, PKG.dependencies);
  // Kok kilitteki her paket tam kilitte AYNI surum ve AYNI butunluk degeriyle var.
  for (const [k, v] of Object.entries(KOK_KILIT)) {
    if (!k) continue;
    assert.ok(KILIT[k], `${k} tam kilitte yok`);
    assert.equal(v.version, KILIT[k].version, k);
    assert.equal(v.integrity, KILIT[k].integrity, k);
  }
  // Saf islev: gelistirme paketi eklenen bir tam manifestten kok manifeste SIZMAZ; calisma zamani
  // bagimliligi eklenirse kok manifeste GECER.
  const tam = JSON.parse(JSON.stringify(PKG));
  tam.devDependencies['ornek-gelistirme-araci'] = '^1.0.0';
  tam.overrides['ornek-gelistirme-araci'] = '^1.0.1';
  tam.dependencies['ornek-calisma-paketi'] = '^2.0.0';
  tam.overrides['ornek-calisma-paketi'] = { ic: '^3.0.0' };
  const kok = manifest.kokPaketTuret(tam, { ...KOK_PKG, devDependencies: { eski: '1' } });
  assert.equal(kok.devDependencies, undefined);
  assert.equal(kok.dependencies['ornek-calisma-paketi'], '^2.0.0');
  assert.equal(kok.dependencies['ornek-gelistirme-araci'], undefined);
  assert.deepEqual(kok.overrides['ornek-calisma-paketi'], { ic: '^3.0.0' });
  assert.equal(kok.overrides['ornek-gelistirme-araci'], undefined);
  assert.deepEqual(kok.scripts, KOK_PKG.scripts, 'scripts kokte yasar, turetme dokunmaz');
  // Kilit turetme: gelistirme girdileri duser, kok adi / surumu kokten gelir.
  const kilit = manifest.kokKilitTuret(manifest.tamKilit(), KOK_PKG);
  assert.equal(kilit.name, KOK_PKG.name);
  assert.equal(kilit.packages[''].name, KOK_PKG.name);
  assert.ok(!kilit.packages['node_modules/vite'] && kilit.packages['node_modules/express']);
  assert.ok(Object.keys(kilit.packages).length < Object.keys(KILIT).length / 2);
});

test('GT7 prepare husky yokken kurulumu dusurmez', () => {
  assert.equal(KOK_PKG.scripts.prepare, 'node scripts/kanca-kur.mjs');
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'kanca-'));
  try {
    // husky'nin cozulemedigi yer: betigin KOPYASI bos bir dizinde (ust dizinlerde node_modules yok).
    fs.copyFileSync(path.join(KOK, 'scripts', 'kanca-kur.mjs'), path.join(dizin, 'kanca-kur.mjs'));
    const r = spawnSync(process.execPath, ['kanca-kur.mjs'], { cwd: dizin, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
  // Baska bir hata (bozuk husky) YUTULMAZ.
  assert.match(
    oku('scripts', 'kanca-kur.mjs'),
    /e\.code === 'ERR_MODULE_NOT_FOUND'\) process\.exit\(0\);\s*throw e;/,
  );
});

test('GT8 gelistirici kurulumu bagi kurar ve cozer; arac-kontrol eksigi soyler', () => {
  const { bagla, coz } = require('../../scripts/kur.cjs');
  const { eksikAraclar } = require('../../scripts/arac-kontrol.cjs');
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'kur-'));
  const tamNm = path.join(dizin, 'gelistirme', 'node_modules');
  const bag = path.join(dizin, 'node_modules');
  const paketKoy = (ad) => {
    fs.mkdirSync(path.join(tamNm, ad), { recursive: true });
    fs.writeFileSync(path.join(tamNm, ad, 'package.json'), '{}');
  };
  try {
    paketKoy('vite');
    // (1) Kokte GERCEK bir node_modules varken (eski duzen): bagla onu bagla degistirir.
    fs.mkdirSync(path.join(bag, 'eski-paket'), { recursive: true });
    assert.deepEqual(eksikAraclar(dizin, ['vite']), ['vite']);
    bagla(dizin);
    assert.ok(fs.lstatSync(bag).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(bag, 'eski-paket')));
    assert.deepEqual(eksikAraclar(dizin, ['vite', 'eslint']), ['eslint']);
    // (2) Yeniden baglamak (bag zaten var) hedefin ICERIGINI silmez.
    bagla(dizin);
    assert.ok(fs.existsSync(path.join(tamNm, 'vite', 'package.json')));
    // (3) coz: bag ve gelistirme agaci gider; kok dizin ve gelistirme/ manifest dizini kalir.
    fs.writeFileSync(path.join(dizin, 'gelistirme', 'package.json'), '{}');
    coz(dizin);
    assert.equal(fs.existsSync(bag), false);
    assert.throws(() => fs.lstatSync(bag));
    assert.equal(fs.existsSync(tamNm), false);
    assert.ok(fs.existsSync(path.join(dizin, 'gelistirme', 'package.json')));
    // (4) coz, kokte GERCEK bir node_modules'a (calisma zamani kurulumu) DOKUNMAZ.
    fs.mkdirSync(path.join(bag, 'express'), { recursive: true });
    coz(dizin);
    assert.ok(fs.existsSync(path.join(bag, 'express')));
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
  for (const ad of ['predev', 'prebuild', 'prelint', 'pretest:ui'])
    assert.equal(KOK_PKG.scripts[ad], 'node scripts/arac-kontrol.cjs', ad);
  assert.equal(KOK_PKG.scripts.kur, 'node scripts/kur.cjs');
  assert.equal(KOK_PKG.scripts.manifest, 'node scripts/manifest.cjs');
});

test('GT9 guvenlik kapisi tam agaca bakar; Jenkins tam kurulumu kullanir', () => {
  const kapi = oku('scripts', 'guvenlik-denetim.cjs');
  assert.match(kapi, /const TAM = path\.join\(KOK, 'gelistirme'\);/);
  assert.match(kapi, /spawnSync\('npm', \['audit', '--json'\], \{\s*cwd: TAM,/);
  assert.match(kapi, /path\.join\(TAM, 'package-lock\.json'\)/);
  // Yorum satirlari haric (Groovy `//`, kabuk `#`): yalniz CALISAN adimlar.
  const jenkins = oku('Jenkinsfile')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|#)/.test(l))
    .join('\n');
  assert.match(jenkins, /sh 'node --version && npm run kur'/);
  assert.doesNotMatch(
    jenkins,
    /\bnpm ci\b/,
    'Jenkins kokte npm ci calistiriyor (gelistirme araclari kurulmaz)',
  );
  // Dependabot tam manifesti izler.
  assert.match(oku('.github', 'dependabot.yml'), /\n\s*directory: \/gelistirme\n/);
});
