// server/filex/__tests__/filex-parse.test.cjs — filex_list_files.yml v2'nin ham
// meta_raw/sha_raw ciktisinin ayristirmasi. Ayristirma playbook'ta DEGIL burada yapildigi
// icin asil dogruluk garantisi bu testlerdedir (bkz. ocp-app-parse.test.cjs ile ayni ilke).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMetaLine, parseShaLine, parseHostFiles, parseFilexResult } = require('../filex-parse.cjs');

test('parseMetaLine(): mod|sahip|grup|boyut|mtime|yol tam ayristirilir', () => {
  const m = parseMetaLine('644|was|was|12345|1752483600.123456|/vhosting8/APP-T.ear/lib/app.jar');
  assert.deepEqual(m, {
    path: '/vhosting8/APP-T.ear/lib/app.jar',
    mode: '0644', owner: 'was', group: 'was',
    size: 12345, mtime: 1752483600.123456,
  });
});

test('parseMetaLine(): 4 haneli mod (ör. 1777) padStart ile bozulmaz', () => {
  const m = parseMetaLine('1777|root|root|4096|1700000000|/tmp/foo');
  assert.equal(m.mode, '1777');
});

test('parseMetaLine(): yol icinde "|" olsa bile (nadir) tum yol korunur', () => {
  const m = parseMetaLine('644|was|was|10|1700000000|/vhosting8/weird|name.txt');
  assert.equal(m.path, '/vhosting8/weird|name.txt');
});

test('parseMetaLine(): eksik alan varsa null doner (tum host dusurulmez, satir atlanir)', () => {
  assert.equal(parseMetaLine('644|was|was|10'), null);
});

test('parseShaLine(): metin modu (bosluk) ayristirilir', () => {
  const hash = 'a'.repeat(128);
  const s = parseShaLine(`${hash}  /vhosting8/APP-T.ear/lib/app.jar`);
  assert.deepEqual(s, { path: '/vhosting8/APP-T.ear/lib/app.jar', sha512: hash });
});

test('parseShaLine(): ikili mod (*) ayristirilir', () => {
  const hash = 'b'.repeat(128);
  const s = parseShaLine(`${hash} */vhosting8/APP-T.ear/lib/app.jar`);
  assert.equal(s.path, '/vhosting8/APP-T.ear/lib/app.jar');
});

test('parseShaLine(): gecersiz satir null doner', () => {
  assert.equal(parseShaLine('bozuk satir'), null);
});

test('parseHostFiles(): meta + sha path bazinda birlestirilir', () => {
  const hashA = 'a'.repeat(128);
  const hashB = 'b'.repeat(128);
  const meta = [
    '644|was|was|100|1700000000|/app.ear/a.jar',
    '644|was|was|200|1700000001|/app.ear/b.jar',
  ].join('\n');
  const sha = [
    `${hashA}  /app.ear/a.jar`,
    `${hashB}  /app.ear/b.jar`,
  ].join('\n');
  const files = parseHostFiles(meta, sha);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, '/app.ear/a.jar');
  assert.equal(files[0].sha512, hashA);
  assert.equal(files[1].sha512, hashB);
});

test('parseHostFiles(): checksum satiri eksikse dosya DUSMEZ, sha512 bos string olur', () => {
  const meta = '644|was|was|100|1700000000|/app.ear/a.jar';
  const files = parseHostFiles(meta, '');
  assert.equal(files.length, 1);
  assert.equal(files[0].sha512, '');
});

test('parseHostFiles(): sonuc yol adina gore alfabetik siralanir', () => {
  const meta = [
    '644|was|was|1|1700000000|/app.ear/z.txt',
    '644|was|was|1|1700000000|/app.ear/a.txt',
  ].join('\n');
  const files = parseHostFiles(meta, '');
  assert.deepEqual(files.map((f) => f.path), ['/app.ear/a.txt', '/app.ear/z.txt']);
});

test('parseHostFiles(): bos meta_raw bos liste doner (EAR bulunamadi durumu)', () => {
  assert.deepEqual(parseHostFiles('', ''), []);
});

test('parseFilexResult(): status=ok olmayan host icin files[] uretilmez (ham veri kullanilmaz)', () => {
  const out = parseFilexResult({
    overall_status: 'partial',
    hosts: [
      { host: 'A', status: 'ok', ear_dirs: ['/app.ear'], meta_raw: '644|was|was|1|1700000000|/app.ear/x', sha_raw: '' },
      { host: 'B', status: 'error', error: 'unreachable', ear_dirs: [], meta_raw: 'bu-asla-okunmamali', sha_raw: '' },
    ],
  });
  assert.equal(out.hosts[0].files.length, 1);
  assert.deepEqual(out.hosts[1].files, []);
  assert.equal(out.hosts[1].error, 'unreachable');
});

test('parseFilexResult(): hosts dizisi yoksa girdi oldugu gibi geri doner', () => {
  const out = parseFilexResult({ overall_status: 'failed' });
  assert.deepEqual(out, { overall_status: 'failed' });
});
