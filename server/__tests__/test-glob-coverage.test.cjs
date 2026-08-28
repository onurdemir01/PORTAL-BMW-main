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
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const TEST_SCRIPT = pkg.scripts.test;

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

  const missing = dirs.filter((d) => {
    const pattern = `${d.split(path.sep).join('/')}/*.test.cjs`;
    return !TEST_SCRIPT.includes(pattern);
  });
  assert.deepEqual(missing, [],
    `bu dizinlerdeki testler HIC KOSMUYOR — package.json "test" glob’una ekle:\n${missing.join('\n')}`);
});

test('glob’da var olmayan dizin YOK (bayat girdi kalmasin)', () => {
  const patterns = TEST_SCRIPT.match(/[\w./-]+__tests__\/\*\.test\.cjs/g) || [];
  const stale = patterns.filter((p) => !fs.existsSync(path.join(ROOT, path.dirname(p))));
  assert.deepEqual(stale, [], `glob’da var olmayan dizinler: ${stale.join(', ')}`);
});
