// server/__tests__/test-yerel-dongu.test.js - Yerel HTTP testleri sunucuyu 127.0.0.1'e baglar (2026-11-24).
//
// NEDEN: `app.listen(0)` cift yigin '::' dinler; testler istegi 127.0.0.1'e atar. macOS'ta ayni port 127.0.0.1'de baska
// bir surecte (dil sunuculari, limactl, gelistirme araclari) aciksa istek O surece gider: BN3 "Client sent an HTTP
// request to an HTTPS server", AH14 "Unexpected end of JSON input" ile aralikli dustu, kapi tekrar kosturuldu. Host
// verilince adres eszamansizdir; `listening` beklenir. CI (Linux) etkilenmiyordu, bu yuzden kural yerelde de gecerli.
//   TY1 server/**/__tests__ altinda host'suz `.listen(0)` yok
//   TY2 bekci kor degil: sentetik ihlali yakalar, host'lu bicimi gecer
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const KOK = path.join(__dirname, '..', '..');
const DESEN = /\.listen\(\s*0\s*\)/;

function ihlaller(metin) {
  return metin
    .split('\n')
    .map((satir, i) => ({ satir, no: i + 1 }))
    .filter(({ satir }) => DESEN.test(satir) && !/^\s*\/\//.test(satir));
}

test("TY1 server testlerinde host'suz listen(0) yok", () => {
  const dosyalar = spawnSync('git', ['ls-files', 'server/**/__tests__/*.js'], {
    cwd: KOK,
    encoding: 'utf8',
  })
    .stdout.split('\n')
    .filter(Boolean);
  assert.ok(dosyalar.length > 50, 'test dosyasi listesi bos (bekci kor)');
  const bulunan = dosyalar.flatMap((d) =>
    ihlaller(fs.readFileSync(path.join(KOK, d), 'utf8')).map((x) => `${d}:${x.no}`),
  );
  assert.deepEqual(bulunan, [], "listen(0, '127.0.0.1') + 'listening' bekle");
});

test('TY2 bekci kor degil', () => {
  assert.equal(ihlaller('  const s = app.listen(0);').length, 1);
  assert.equal(ihlaller('const s = uygulama().listen( 0 );').length, 1);
  assert.equal(ihlaller("  const s = app.listen(0, '127.0.0.1');").length, 0);
  assert.equal(ihlaller('  // eski: app.listen(0)').length, 0);
});
