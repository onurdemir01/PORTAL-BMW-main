// server/__tests__/kapsam-yayinla.test.js — kurumsal SonarQube icin repoda tasinan kapsam raporu
// (2026-11-14, docs/adr/0004-kapsam-raporu-repoda.md).
//   KP1 lcovSuz: test dosyalari ve islev satirlari cikar; DA / BRDA kalir; kararli sira; toplamlar
//   KP2 kaynakMi: sonar.sources ile ayni dizinler, test / tip dosyalari haric
//   KP3 kaynakOzeti: icerik ya da dosya listesi degisince degisir, degismeyince sabit (gecici git deposu)
//   KP4 --dogrula: guncel rapor 0, bayat / eksik rapor 1 (betigin kendisi, gecici depoda)
//   KP5 SonarQube ayari repodaki raporu okur; tazeleme is akisi yalniz raporu commit eder
//   KP6 vurus sayilari 0/1: ayni kapsam farkli sayilarla AYNI rapor; kapsanma degisirse rapor degisir
//   KP7 --kurumsal: guncel rapor coverage/lcov.info'ya kopyalanir; bayat / yok rapor Sonar kosusunu
//       dusurur, normal derlemeyi durdurmaz ve hicbir zaman kopyalanmaz
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { lcovSuz, kaynakMi, kaynakOzeti } = require('../../scripts/kapsam-yayinla.cjs');

const KOK = path.join(__dirname, '..', '..');

const kayit = (sf, govde) => [`SF:${sf}`, ...govde, 'end_of_record'].join('\n');

test('KP1 lcovSuz yalniz kaynak dosyalarini ve Sonar satirlarini tutar', () => {
  const kayitlar = [
    kayit('server/b.cjs', [
      'FN:1,f',
      'FNDA:1,f',
      'FNF:1',
      'FNH:1',
      'DA:1,1',
      'DA:2,0',
      'BRDA:2,0,0,1',
      'BRF:1',
      'BRH:1',
      'LF:2',
      'LH:1',
    ]),
    kayit('server/__tests__/b.test.js', ['DA:1,1', 'LF:1', 'LH:1']),
    kayit('src\\components\\A.tsx', ['DA:3,5', 'LF:1', 'LH:1']),
    kayit('src/components/A.test.tsx', ['DA:1,1', 'LF:1', 'LH:1']),
    kayit('scripts/x.cjs', ['DA:1,1', 'LF:1', 'LH:1']),
    kayit('node_modules/y/index.js', ['DA:1,1', 'LF:1', 'LH:1']),
  ];
  const girdi = kayitlar.join('\n');
  const r = lcovSuz(girdi);
  assert.deepEqual(r.dosyalar, ['server/b.cjs', 'src/components/A.tsx']);
  assert.equal(r.lf, 3);
  assert.equal(r.lh, 2);
  assert.doesNotMatch(r.metin, /^FN/m, 'islev satirlari kalmamali');
  assert.match(r.metin, /^BRDA:2,0,0,1$/m);
  assert.match(r.metin, /^SF:src\/components\/A\.tsx$/m, 'ters bolu duzeltilmeli');
  assert.ok(r.metin.endsWith('end_of_record\n'));
  // Kararli: kayit sirasi girdiden bagimsiz.
  const ters = [...kayitlar].reverse().join('\n');
  assert.equal(lcovSuz(ters).metin, lcovSuz(girdi).metin);
  assert.deepEqual(lcovSuz(''), { metin: '', dosyalar: [], lf: 0, lh: 0 });
});

test('KP2 kaynakMi sonar.sources ile ayni', () => {
  for (const y of ['server/a.cjs', 'src/x/Y.tsx', 'src/u.ts', 'shared/z.cjs', 'server/m.mjs'])
    assert.equal(kaynakMi(y), true, y);
  for (const y of [
    'server/__tests__/a.test.js',
    'src/x/__tests__/Y.test.tsx',
    'src/a.spec.ts',
    'src/test/setup.ts',
    'src/vite-env.d.ts',
    'scripts/a.cjs',
    'server/ansible/bmw_portal/x/files/a.py',
    'server/data/a.json',
  ])
    assert.equal(kaynakMi(y), false, y);
});

function geciciDepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kapsam-'));
  const git = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });
  git('init', '-q');
  fs.mkdirSync(path.join(d, 'server'), { recursive: true });
  fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(d, 'server', 'a.cjs'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(d, 'server', 'b.test.js'), 'test\n');
  git('add', '.');
  return { d, git };
}

test('KP3 kaynakOzeti icerik ve dosya listesine bagli, test dosyasina degil', () => {
  const { d, git } = geciciDepo();
  try {
    const o1 = kaynakOzeti(d);
    assert.equal(o1.dosya, 1);
    assert.equal(kaynakOzeti(d).ozet, o1.ozet, 'degismeyen agac ayni ozet');
    fs.writeFileSync(path.join(d, 'server', 'b.test.js'), 'degisti\n');
    assert.equal(kaynakOzeti(d).ozet, o1.ozet, 'test dosyasi ozeti etkilemez');
    fs.writeFileSync(path.join(d, 'server', 'a.cjs'), 'module.exports = 2;\n');
    const o2 = kaynakOzeti(d);
    assert.notEqual(o2.ozet, o1.ozet, 'icerik degisince ozet degisir');
    fs.writeFileSync(path.join(d, 'server', 'c.cjs'), 'x\n');
    git('add', 'server/c.cjs');
    const o3 = kaynakOzeti(d);
    assert.equal(o3.dosya, 2);
    assert.notEqual(o3.ozet, o2.ozet, 'yeni izlenen dosya ozeti degistirir');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('KP4 --dogrula guncel raporda 0, bayat ya da eksik raporda 1', () => {
  const { d } = geciciDepo();
  try {
    for (const betik of ['kapsam-yayinla.cjs', 'arac-yolu.cjs'])
      fs.copyFileSync(path.join(KOK, 'scripts', betik), path.join(d, 'scripts', betik));
    const kos = (...a) =>
      spawnSync(process.execPath, ['scripts/kapsam-yayinla.cjs', ...a], {
        cwd: d,
        encoding: 'utf8',
      });
    assert.equal(kos('--dogrula').status, 1, 'rapor yokken basarili olmamali');
    assert.equal(kos().status, 1, 'coverage/lcov.info yokken yayinlamamali');
    fs.mkdirSync(path.join(d, 'coverage'));
    fs.writeFileSync(
      path.join(d, 'coverage', 'lcov.info'),
      kayit(path.join(d, 'server', 'a.cjs').replace(`${d}/`, ''), ['DA:1,1', 'LF:1', 'LH:1']),
    );
    const y = kos();
    assert.equal(y.status, 0, y.stderr);
    const ozet = JSON.parse(fs.readFileSync(path.join(d, 'kalite', 'kapsam', 'ozet.json'), 'utf8'));
    assert.deepEqual(ozet.satir, { toplam: 1, kapsanan: 1, oran: 100 });
    assert.equal(kos('--dogrula').status, 0);
    fs.writeFileSync(path.join(d, 'server', 'a.cjs'), 'module.exports = 3;\n');
    const b = kos('--dogrula');
    assert.equal(b.status, 1);
    assert.match(b.stderr, /BAYAT/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('KP7 --kurumsal: guncel rapor kopyalanir; bayat ya da eksik rapor Sonar kosusunu dusurur', () => {
  const { d } = geciciDepo();
  try {
    for (const betik of ['kapsam-yayinla.cjs', 'arac-yolu.cjs'])
      fs.copyFileSync(path.join(KOK, 'scripts', betik), path.join(d, 'scripts', betik));
    const kos = (env, ...a) =>
      spawnSync(process.execPath, ['scripts/kapsam-yayinla.cjs', ...a], {
        cwd: d,
        encoding: 'utf8',
        env: { ...process.env, BUILD_NOTE: '', ...env },
      });
    const hedef = path.join(d, 'coverage', 'lcov.info');
    const sonar = { BUILD_NOTE: 'sonarqube - kurumsal analiz' };

    // Rapor yok: Sonar kosusu duser, normal derleme surer; hicbir sey yazilmaz.
    assert.equal(kos(sonar, '--kurumsal').status, 1);
    assert.equal(kos({}, '--kurumsal').status, 0);
    assert.equal(fs.existsSync(hedef), false);

    // Guncel rapor: aynen kopyalanir (Sonar kosusunda da).
    fs.mkdirSync(path.join(d, 'coverage'));
    fs.writeFileSync(hedef, kayit('server/a.cjs', ['DA:1,1', 'LF:1', 'LH:1']));
    assert.equal(kos({}).status, 0);
    fs.rmSync(hedef);
    const g = kos(sonar, '--kurumsal');
    assert.equal(g.status, 0, g.stderr);
    assert.equal(
      fs.readFileSync(hedef, 'utf8'),
      fs.readFileSync(path.join(d, 'kalite', 'kapsam', 'lcov.info'), 'utf8'),
    );

    // Bayat rapor: Sonar kosusu duser; normal derleme surer ama yanlis eslesen rapor kopyalanmaz.
    fs.rmSync(hedef);
    fs.writeFileSync(path.join(d, 'server', 'a.cjs'), 'module.exports = 4;\n');
    const b = kos(sonar, '--kurumsal');
    assert.equal(b.status, 1);
    assert.match(b.stderr, /BAYAT/);
    assert.equal(kos({}, '--kurumsal').status, 0);
    assert.equal(fs.existsSync(hedef), false, 'bayat rapor kopyalandi');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('KP5 SonarQube ayari ve tazeleme is akisi', () => {
  const sonar = fs.readFileSync(path.join(KOK, 'sonar-project.properties'), 'utf8');
  const yollar = (/^sonar\.javascript\.lcov\.reportPaths=(.+)$/m.exec(sonar) || [])[1] || '';
  assert.ok(
    yollar
      .split(',')
      .map((s) => s.trim())
      .includes('kalite/kapsam/lcov.info'),
    yollar,
  );
  assert.match(sonar, /^sonar\.python\.version=3\.6, ?3\.9$/m, 'hedef makineler RHEL 8 / 9 Python');
  const akis = fs.readFileSync(path.join(KOK, '.github', 'workflows', 'kapsam-raporu.yml'), 'utf8');
  assert.match(akis, /npm run test:coverage/);
  assert.match(akis, /npm run kapsam:yayinla/);
  assert.match(akis, /npm run kapsam:dogrula/);
  assert.match(akis, /git add kalite\/kapsam\n/, 'yalniz rapor commit edilmeli');
  assert.doesNotMatch(akis, /git add (-A|\.|--all)/);
  assert.doesNotMatch(akis, /push[^\n]*--force/);
  assert.match(akis, /\n\s+contents: write\n/);
  // Rapor git disi olmamali (coverage/ disidir, kalite/ degil).
  const ignore = fs.readFileSync(path.join(KOK, '.gitignore'), 'utf8');
  assert.doesNotMatch(ignore, /^\/?kalite\/?$/m);
  const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['kapsam:yayinla'], 'node scripts/kapsam-yayinla.cjs');
  assert.equal(pkg.scripts['kapsam:dogrula'], 'node scripts/kapsam-yayinla.cjs --dogrula');
});

test('KP6 vurus sayilari 0/1; kapsanma bilgisi korunur', () => {
  const { vurusIndir } = require('../../scripts/kapsam-yayinla.cjs');
  assert.equal(vurusIndir('DA:12,37'), 'DA:12,1');
  assert.equal(vurusIndir('DA:12,0'), 'DA:12,0');
  assert.equal(vurusIndir('BRDA:5,0,1,9'), 'BRDA:5,0,1,1');
  assert.equal(vurusIndir('BRDA:5,0,1,-'), 'BRDA:5,0,1,-');
  assert.equal(vurusIndir('BRDA:5,0,1,0'), 'BRDA:5,0,1,0');
  assert.equal(vurusIndir('LF:10'), 'LF:10');
  assert.equal(vurusIndir('DA:3,2,abc123'), 'DA:3,1,abc123', 'istege bagli saglama korunur');
  const a = kayit('server/a.cjs', ['DA:1,5', 'DA:2,0', 'BRDA:1,0,0,3', 'LF:2', 'LH:1']);
  const b = kayit('server/a.cjs', ['DA:1,99', 'DA:2,0', 'BRDA:1,0,0,1', 'LF:2', 'LH:1']);
  const c = kayit('server/a.cjs', ['DA:1,5', 'DA:2,4', 'BRDA:1,0,0,3', 'LF:2', 'LH:2']);
  assert.equal(lcovSuz(a).metin, lcovSuz(b).metin, 'yalniz sayi farki rapor degistirmemeli');
  assert.notEqual(lcovSuz(a).metin, lcovSuz(c).metin, 'kapsanma farki rapora yansimali');
});
