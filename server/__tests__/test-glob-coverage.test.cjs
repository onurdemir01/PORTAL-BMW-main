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
const { execFileSync } = require('node:child_process');

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
    if (e.name === '__tests__') {
      out.push(path.relative(ROOT, p));
      continue;
    }
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
  assert.deepEqual(
    missing,
    [],
    `bu dizinlerdeki testler HIC KOSMUYOR — scripts/run-tests.cjs TEST_DIRS'e ekle:\n${missing.join('\n')}`,
  );
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
  const jenkins = fs
    .readFileSync(path.join(ROOT, 'Jenkinsfile'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  // Once UCLU tirnakli bloklar, sonra TEK tirnakli adimlar. (Ilk yazimda desen
  // `'''?` idi ve bu "en az IKI tirnak" demek — tek tirnakli `sh 'npm test'` adimlari
  // hic gorunmuyordu; bekci ters yonde de kordu.)
  const triple = [...jenkins.matchAll(/sh\s+'''([\s\S]*?)'''/g)].map((m) => m[1]);
  const single = [...jenkins.matchAll(/sh\s+'([^'\n]*)'/g)].map((m) => m[1]);
  const shSteps = [...triple, ...single].join('\n');
  assert.match(shSteps, /npm (run )?test\b/, 'Jenkinsfile bir adimda `npm test` calistirmali');
});

// `sh '...'` adimlarinin metnini toplar. YORUMLAR ELENIR: aciklama satirlari da
// "npm test" gibi ifadeler iceriyor ve bekci KENDI ACIKLAMASIYLA eslesip kor
// kaliyordu (bu dosyada bir kez tam olarak bu oldu).
function jenkinsShSteps() {
  const jenkins = fs
    .readFileSync(path.join(ROOT, 'Jenkinsfile'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  const triple = [...jenkins.matchAll(/sh\s+'''([\s\S]*?)'''/g)].map((m) => m[1]);
  const single = [...jenkins.matchAll(/sh\s+'([^'\n]*)'/g)].map((m) => m[1]);
  return [...triple, ...single].join('\n');
}

test('CI VITEST de kosuyor (React bilesen testleri kosmayan suit olmasin)', () => {
  // `npm test` node:test kosucusudur ve `src/**/__tests__/*.tsx` dosyalarini
  // GORMEZ. Yani WorkloadStep dahil tum bilesen testleri, `npm test`in bir zamanlar
  // dustugu duruma dusmustu: yazilmis, yesil sanilan, HIC kosmayan testler.
  assert.match(
    jenkinsShSteps(),
    /npm run test:ui\b/,
    'Jenkinsfile bir adimda `npm run test:ui` calistirmali — bilesen testleri CI da kosmuyor',
  );
});

test('CI ESLINT kosuyor (kurulmus ama cagrilmayan kapi olmasin)', () => {
  // ESLint 2026-09-04'te kuruldu ama boru hattinda HIC cagrilmiyordu.
  assert.match(
    jenkinsShSteps(),
    /npm run lint\b(?!:)/,
    'Jenkinsfile bir adimda `npm run lint` calistirmali',
  );
});

test('`lint:ascii` kapisi GERCEKTEN bloke ediyor (belge ile davranis ayrismasin)', () => {
  // 2026-09-04'te kapi bilerek gevsetildi (blok yerine uyari) ama betigin KENDI
  // BASLIGI hala "exit 1 doner (CI guard)" diyordu: kapi ACIKTI, belge KAPALI
  // diyordu. Bir kapinin en tehlikeli hali, kapali sanilan acik halidir.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'check-ascii.cjs'), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  assert.match(code, /process\.exit\(1\)/, 'ihlal bulundugunda cikis kodu 1 DONMUYOR');
  assert.match(jenkinsShSteps(), /npm run lint:ascii\b/, 'Jenkinsfile `lint:ascii` calistirmali');
  // Otomatik duzeltme yolu OLMALI: bir kalite kapisi ancak duzeltmesi ucuzsa
  // kalici olur. 122 satiri elle duzeltmek zorunda kalan gelistirici kapiyi
  // ilk firsatta tekrar gevsetir — nitekim oyle oldu.
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkgJson.scripts['fix:ascii'], 'otomatik duzeltme scripti (`fix:ascii`) yok');
});

test('glob’da var olmayan dizin YOK (bayat girdi kalmasin)', () => {
  const stale = TEST_DIRS.filter((d) => !fs.existsSync(path.join(ROOT, d)));
  assert.deepEqual(stale, [], `TEST_DIRS'te var olmayan dizinler: ${stale.join(', ')}`);
});

// ── ESLINT UYARI CIRCIRI ────────────────────────────────────────────────────
//
// 127 uyarinin 121'i `react-hooks` kurallari; en buyugu (74) `set-state-in-effect`.
// Bunlarin COGU MESRU veri-cekme deseni (React 19'un kurali agresif) — 74 effect'i
// refactor etmek CALISAN kodu riske atmak olurdu ve bu oturumdaki en pahali hata
// sinifi tam olarak "calisan bir seyi kurcalamak" degil, "kurcalarken sessizce
// bozmak"tir.
//
// SECILEN YOL: sayiyi DONDUR. Yeni kod uyari EKLEYEMEZ; mevcut olanlar zamanla
// azaltilir. `--max-warnings N` bunu eslint'in kendisiyle zorlar.
//
// BU BEKCI NE ISE YARAR: `N`in sessizce YUKARI kaymasini engeller. Biri uyari
// ekleyip siniri buyutur ve kimse fark etmezse cirCir anlamsizlasir — `lint:ascii`
// kapisinin basina gelenin aynisi.
test('RT1 `--max-warnings` siniri GERCEK uyari sayisiyla AYNI', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = Number((pkg.scripts.lint.match(/--max-warnings\s+(\d+)/) || [])[1]);
  assert.ok(Number.isInteger(declared), '`lint` scripti --max-warnings tasimiyor');

  let out = '';
  try {
    out = execFileSync('npx', ['eslint', 'src/', 'server/', '-f', 'json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // eslint uyari varken de 0 doner (hata yoksa); yine de savunmaci okuyoruz.
    out = String(err.stdout || '');
  }
  const actual = JSON.parse(out).reduce((n, f) => n + f.warningCount, 0);

  assert.equal(
    declared,
    actual,
    `Sinir ${declared}, gercek uyari ${actual}.\n` +
      (actual < declared
        ? `Uyari AZALMIS — sinirI ${actual} yapin ki kazanim KILITLENSIN.`
        : `Uyari ARTMIS — yeni uyari eklenmis. Ya duzeltin ya da bilerek siniri yukseltin.`),
  );
});
