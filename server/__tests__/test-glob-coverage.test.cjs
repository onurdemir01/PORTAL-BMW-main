// server/__tests__/test-glob-coverage.test.cjs — npm test glob'u ELDE tutuluyor.
//
// GERCEK OLAY: `server/telnet/__tests__` diye bir dizin YILLARDIR yoktu; olusturuldugunda
// `package.json`'daki glob listesine eklenmesi UNUTULABILIRDI ve testler sessizce HIC
// KOSMAZDI. Yesil bir CI, kosmayan testlerle de yesildir — bu, testsizlikten kotudur
// cunku "kapsanmis" yanilgisi yaratir.
//
// Bu test glob'un TUM `server/**/__tests__` ve `src/__tests__` dizinlerini kapsadigini
// dogrular. Yeni bir modul test dizini actiginda buraya dusen hata, glob'u guncellemesi
// gerektigini SOYLER.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// 2026-08-30: kapsam listesi `package.json` glob'undan `scripts/run-tests.cjs`
// icindeki TEST_DIRS'e tasindi (kosucu, Node surumune gore `--experimental-test-
// module-mocks` bayragina karar veriyor — bkz. o dosyanin basligi). BEKCI DE
// TASINDI: eski hali `pkg.scripts.test` metnine bakiyordu ve script degisince
// SESSIZCE KORLESIRDI — tam olarak bu testin engellemek icin var oldugu sey.
const RUNNER = fs.readFileSync(path.join(ROOT, 'scripts', 'run-tests.cjs'), 'utf8');
const TEST_DIRS = [...RUNNER.matchAll(/'([\w./-]+__tests__)'/g)].map((m) => m[1]);
// Kosucunun `npm test` tarafindan gercekten cagrildigini de dogrula: aksi halde
// dogru bir listeyi kimse okumuyor olabilirdi.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function findTestDirs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.name === '__tests__') { out.push(path.relative(ROOT, p)); continue; }
    findTestDirs(p, out);
  }
  return out;
}

test('npm test glob’u TUM test dizinlerini kapsiyor', () => {
  const dirs = [
    ...findTestDirs(path.join(ROOT, 'server')),
    ...findTestDirs(path.join(ROOT, 'src')),
  ];
  assert.ok(dirs.length > 5, `test dizini taramasi suphesiz az sonuc verdi: ${dirs.length}`);

  const missing = dirs.filter((d) => !TEST_DIRS.includes(d.split(path.sep).join('/')));
  assert.deepEqual(missing, [],
    `bu dizinlerdeki testler HIC KOSMUYOR — scripts/run-tests.cjs TEST_DIRS'e ekle:\n${missing.join('\n')}`);
});

test('npm test GERCEKTEN kosucuyu cagiriyor', () => {
  // Dogru bir TEST_DIRS listesi, kimse okumuyorsa ise yaramaz.
  assert.match(pkg.scripts.test, /scripts\/run-tests\.cjs/);
});

test('CI testleri KOSUYOR (yesil ama kosmayan suit tuzagi)', () => {
  // 900+ bekci yalnizca gelistirici makinesinde kosuyordu: Jenkinsfile tsc/lint/build
  // yapiyor ama `npm test` HIC cagirmiyordu. Yesil bir boru hatti, kosmayan testlerle
  // de yesildir.
  // YORUMLAR ELENIR: Jenkinsfile'daki aciklama satiri da "npm test" ifadesini
  // iceriyor ve bekci KENDI ACIKLAMASIYLA eslesip kor kaliyordu — asama tamamen
  // silinse bile yesil donuyordu. Yalnizca `sh '...'` adimlarina bakiyoruz.
  const jenkins = fs.readFileSync(path.join(ROOT, 'Jenkinsfile'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // Once UCLU tirnakli bloklar, sonra TEK tirnakli adimlar. (Ilk yazimda desen
  // `'''?` idi ve bu "en az IKI tirnak" demek — tek tirnakli `sh 'npm test'` adimlari
  // hic gorunmuyordu; bekci ters yonde de kordu.)
  const triple = [...jenkins.matchAll(/sh\s+'''([\s\S]*?)'''/g)].map((m) => m[1]);
  const single = [...jenkins.matchAll(/sh\s+'([^'\n]*)'/g)].map((m) => m[1]);
  const shSteps = [...triple, ...single].join('\n');
  assert.match(shSteps, /npm (run )?test\b/, 'Jenkinsfile bir adimda `npm test` calistirmali');
});

test('glob’da var olmayan dizin YOK (bayat girdi kalmasin)', () => {
  const stale = TEST_DIRS.filter((d) => !fs.existsSync(path.join(ROOT, d)));
  assert.deepEqual(stale, [], `TEST_DIRS'te var olmayan dizinler: ${stale.join(', ')}`);
});
