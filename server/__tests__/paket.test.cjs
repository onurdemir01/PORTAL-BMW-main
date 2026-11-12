// server/__tests__/paket.test.cjs — calisma zamani paketi ve guvenlik kapisi (2026-11-12).
//
// Kurumsal bagimlilik taramasi `npm install`in kurdugu BUTUN agaci tarar; paket yalniz calisma
// zamani agacini tasir (scripts/paket.cjs). Bu bekciler paketin GELISTIRME ARACI SIZDIRMADIGINI,
// kilit surumlerinin DEGISMEDIGINI ve dagitim betiklerinin sunucuda gelistirme paketi
// BIRAKMADIGINI sinar.
//   PK1 package.json: devDependencies / prepare / lint-staged yok; build = dist dogrulama; test = duman
//   PK2 gercek kilit budanir: calisma zamani bagimliliklarinin hepsi var, gelistirme agaci (vite,
//       vitest, eslint, picomatch, minimatch, uri-js...) YOK, surumler birebir, `dev` bayragi yok
//   PK3 npm cozumleme kurali: ic ice kopya ustteki kopyayi golgeler; erisilemeyen girdi atilir
//   PK4 gelistirme paketi sizintisi: yerlesik / calisma zamani / k6 serbest, vite yakalanir
//   PK5 haric listesi: test, .env (sir), node_modules ve gelistirme betikleri pakete girmez
//   PK6 dist manifesti + dogrulayici: saglam dist gecer, degisen / eksik dosya duser
//   PK7 guvenlik kapisi karari: calisma zamani her bulguda, gelistirme yalniz duzeltmesi varsa duser
//   PK8 dagitim betikleri: calisma zamani paketinde --omit=dev, kaynak agacta build sonrasi prune
//   PK9 Jenkinsfile: Guvenlik asamasi var, Paket asamasi uretici ile
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KOK = path.join(__dirname, '..', '..');
const P = require('../../scripts/paket.cjs');
const { karar } = require('../../scripts/guvenlik-denetim.cjs');
const PKG = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
const KILIT = JSON.parse(fs.readFileSync(path.join(KOK, 'package-lock.json'), 'utf8'));
const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');

test('PK1 calisma zamani package.json', () => {
  const p = P.paketJson(PKG);
  assert.equal(p.devDependencies, undefined);
  assert.equal(p['lint-staged'], undefined);
  assert.equal(
    p.scripts.prepare,
    undefined,
    'husky prepare kurulumu kirar (husky gelistirme paketi)',
  );
  assert.equal(p.scripts.build, 'node scripts/dist-dogrula.cjs');
  assert.equal(p.scripts.test, 'node scripts/paket-duman.cjs');
  for (const ad of ['start', 'prod', 'qa', 'migrate'])
    assert.equal(p.scripts[ad], PKG.scripts[ad], ad);
  for (const ad of ['dev', 'lint', 'test:ui', 'preview', 'ui:tarama', 'paket', 'guvenlik']) {
    assert.equal(p.scripts[ad], undefined, `${ad} gelistirme araci ister`);
  }
  assert.deepEqual(p.dependencies, PKG.dependencies);
  // Yalniz calisma zamani paketine ait override'lar kalir.
  for (const k of Object.keys(p.overrides || {}))
    assert.ok(PKG.dependencies[k], `override ${k} calisma zamaninda yok`);
  assert.ok(
    p.overrides && p.overrides.compression,
    'compression altindaki debug override kayboldu',
  );
});

test('PK2 gercek kilit calisma zamanina budanir', () => {
  const pkg = P.paketJson(PKG);
  const b = P.kilitBudama(KILIT, pkg).packages;
  for (const ad of Object.keys(PKG.dependencies))
    assert.ok(b[`node_modules/${ad}`], `${ad} budandi`);
  const gelistirme = Object.keys(b).filter((k) =>
    /(^|\/)node_modules\/(vite|vitest|eslint|picomatch|minimatch|uri-js|jsdom|typescript|@testing-library\/[^/]+)$/.test(
      k,
    ),
  );
  assert.deepEqual(gelistirme, [], 'gelistirme paketi pakete sizdi');
  for (const [k, v] of Object.entries(b)) {
    if (!k) continue;
    assert.equal(v.version, KILIT.packages[k].version, `${k} surumu degisti`);
    assert.ok(!v.dev && !v.devOptional, `${k} dev bayragi tasiyor`);
  }
  assert.equal(b[''].devDependencies, undefined);
  // Kilitte dev olmayan HER girdi pakette olmali (budama calisma zamanindan bir sey dusurmesin).
  const eksik = Object.entries(KILIT.packages)
    .filter(([k, v]) => k && !v.dev && !v.devOptional && !v.optional && !b[k])
    .map(([k]) => k);
  assert.deepEqual(eksik, []);
});

test('PK3 npm cozumleme kurali ve erisilemeyen girdi', () => {
  const kilit = {
    packages: {
      '': {},
      'node_modules/a': { version: '1.0.0', dependencies: { b: '^2' } },
      'node_modules/a/node_modules/b': { version: '2.0.0' },
      'node_modules/b': { version: '1.0.0', dev: true },
      'node_modules/c': { version: '1.0.0', dependencies: { b: '^1' } },
      'node_modules/d': { version: '1.0.0', devOptional: true },
    },
  };
  assert.equal(P.cozumle(kilit.packages, 'node_modules/a', 'b'), 'node_modules/a/node_modules/b');
  assert.equal(P.cozumle(kilit.packages, 'node_modules/c', 'b'), 'node_modules/b');
  assert.equal(P.cozumle(kilit.packages, 'node_modules/a/node_modules/b', 'x'), null);
  const b = P.kilitBudama(kilit, { dependencies: { a: '^1', d: '^1' } }).packages;
  assert.deepEqual(Object.keys(b).sort(), [
    '',
    'node_modules/a',
    'node_modules/a/node_modules/b',
    'node_modules/d',
  ]);
  assert.equal(b['node_modules/d'].optional, true, 'devOptional -> optional');
  assert.equal(b['node_modules/d'].devOptional, undefined);
});

test('PK4 gelistirme paketi sizintisi', () => {
  const dosyalar = [
    {
      goreli: 'server/a.cjs',
      metin: "require('node:fs'); require('express'); require('@azure/identity/x');",
    },
    { goreli: 'server/b.cjs', metin: "const v = require('vite');\nimport('vitest/config');" },
    { goreli: 'server/ansible/x/files/k.js', metin: "import http from 'k6/http';" },
    { goreli: 'server/c.mjs', metin: "import x from 'fs';\nimport 'eslint';" },
  ];
  const s = P.devSizintisi(dosyalar, ['express', '@azure/identity']);
  assert.deepEqual(s, ['server/b.cjs: vite', 'server/b.cjs: vitest', 'server/c.mjs: eslint']);
  assert.equal(P.paketAdi('@azure/identity/lib/x'), '@azure/identity');
  assert.equal(P.paketAdi('qs/lib'), 'qs');
});

test('PK4b gercek sunucu / paylasilan / betik kodu calisma zamani disinda paket yuklemiyor', () => {
  const dosyalar = [];
  const yuru = (g) => {
    const tam = path.join(KOK, g);
    if (P.haricMi(g)) return;
    if (fs.statSync(tam).isDirectory())
      return fs.readdirSync(tam).forEach((x) => yuru(`${g}/${x}`));
    if (/\.(c?js|mjs)$/.test(g)) dosyalar.push({ goreli: g, metin: fs.readFileSync(tam, 'utf8') });
  };
  ['server', 'shared', 'scripts'].forEach(yuru);
  assert.ok(dosyalar.length > 100);
  assert.deepEqual(P.devSizintisi(dosyalar, Object.keys(PKG.dependencies)), []);
});

test('PK5 haric listesi', () => {
  for (const g of [
    'server/__tests__/x.test.cjs',
    'src/components/a/__tests__/b.test.tsx',
    'server/x.test.cjs',
    '.env',
    '.env.prod',
    'server/.env.local',
    'scripts/run-tests.cjs',
    'scripts/ui-tarama/tarama.mjs',
    'scripts/paket.cjs',
    'scripts/guvenlik-denetim.cjs',
    'node_modules/x/index.js',
  ]) {
    assert.equal(P.haricMi(g), true, g);
  }
  for (const g of [
    '.env.example',
    'server/index.cjs',
    'scripts/preflight.cjs',
    'scripts/dist-dogrula.cjs',
    'deploy/release.sh',
  ]) {
    assert.equal(P.haricMi(g), false, g);
  }
  assert.ok(
    P.DAHIL.includes('server') && !P.DAHIL.includes('sunum') && !P.DAHIL.includes('Jenkinsfile'),
  );
});

test('PK6 dist manifesti ve dogrulayici', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pk6-'));
  try {
    fs.mkdirSync(path.join(d, 'dist', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(d, 'dist', 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(d, 'dist', 'assets', 'ApiKeyForm-a1.js'), 'x=1');
    const m = P.manifestYaz(path.join(d, 'dist'), { surum: '1.0.0', commit: 'abc' });
    assert.equal(m.dosyaSayisi, 2);
    // sha256sum bicimi: once hash, sonra yol (sir tarayicilari "anahtar = deger" sanmasin).
    const satirlar = fs
      .readFileSync(path.join(d, 'dist', P.MANIFEST), 'utf8')
      .trim()
      .split('\n');
    assert.equal(satirlar.length, 2);
    for (const s of satirlar) assert.match(s, /^[0-9a-f]{64} {2}\S+$/);
    assert.ok(
      !fs.existsSync(path.join(d, 'dist', '.manifest.json')),
      'eski JSON manifest geri gelmis',
    );
    const dogrula = () =>
      execFileSync(process.execPath, [path.join(KOK, 'scripts', 'dist-dogrula.cjs')], {
        cwd: d,
        stdio: 'pipe',
      }).toString();
    assert.match(dogrula(), /2 dosya dogrulandi \(surum 1\.0\.0, commit abc\)/);
    fs.writeFileSync(path.join(d, 'dist', 'assets', 'ApiKeyForm-a1.js'), 'x=2');
    assert.throws(dogrula, /degismis/);
    fs.rmSync(path.join(d, 'dist', 'assets', 'ApiKeyForm-a1.js'));
    assert.throws(dogrula, /yok/);
    fs.writeFileSync(path.join(d, 'dist', P.MANIFEST), 'bozuk satir\n');
    assert.throws(dogrula, /satiri bozuk/);
    fs.rmSync(path.join(d, 'dist', P.MANIFEST));
    assert.throws(dogrula, /manifest/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('PK7 guvenlik kapisi karari', () => {
  const kilit = {
    'node_modules/qs': {},
    'node_modules/picomatch': { dev: true },
    'node_modules/minimatch': { dev: true },
  };
  const audit = {
    vulnerabilities: {
      qs: { severity: 'low', nodes: ['node_modules/qs'], fixAvailable: true },
      picomatch: { severity: 'high', nodes: ['node_modules/picomatch'], fixAvailable: false },
      minimatch: {
        severity: 'moderate',
        nodes: ['node_modules/minimatch'],
        fixAvailable: { name: 'x' },
      },
    },
  };
  const k = karar(audit, kilit);
  assert.equal(k.dusuren.length, 2);
  assert.match(k.dusuren.join('\n'), /qs \(low, calisma zamani\)/);
  assert.match(k.dusuren.join('\n'), /minimatch \(moderate, gelistirme\)/);
  assert.deepEqual(k.bilgi.length, 1);
  assert.match(k.bilgi[0], /picomatch \(high, gelistirme, duzeltme yok\)/);
  // Duzeltmesi olmayan bulgu CALISMA ZAMANINDA ise yine duser.
  const k2 = karar(
    {
      vulnerabilities: {
        qs: { severity: 'high', nodes: ['node_modules/qs'], fixAvailable: false },
      },
    },
    kilit,
  );
  assert.equal(k2.dusuren.length, 1);
  assert.deepEqual(karar({}, kilit), { dusuren: [], bilgi: [] });
});

test('PK8 dagitim betikleri sunucuda gelistirme paketi birakmaz', () => {
  const lib = oku('deploy/stage-lib.sh');
  const fn = lib.slice(lib.indexOf('stage_bagimlilik_ve_build() {'));
  assert.match(fn, /devDependencies \? 1 : 0/);
  assert.match(
    fn,
    /npm ci --omit=dev --no-audit --no-fund \|\| exit 1\n\s*npm run build \|\| exit 1/,
  );
  assert.match(
    fn,
    /npm run build \|\| exit 1\n\s*npm prune --omit=dev --no-audit --no-fund \|\| exit 1/,
  );
  for (const f of ['deploy/release.sh', 'deploy/release-git.sh', 'deploy/run.sh']) {
    assert.match(oku(f), /stage_bagimlilik_ve_build "\$/, `${f} ortak islevi kullanmiyor`);
  }
});

test('PK9 Jenkinsfile: Guvenlik asamasi ve uretici ile Paket', () => {
  const j = oku('Jenkinsfile');
  assert.match(j, /stage\('Güvenlik'\) \{\s*steps \{ sh 'npm run guvenlik' \}/);
  assert.ok(
    j.indexOf("stage('Güvenlik')") < j.indexOf("stage('Testler')"),
    "Guvenlik Testler'den once",
  );
  assert.match(j, /npm run paket -- --cikti .* --zip .* --derleme-yok/);
  assert.doesNotMatch(j, /cp -r dist server scripts deploy/, 'eski elle paketleme geri gelmis');
});
