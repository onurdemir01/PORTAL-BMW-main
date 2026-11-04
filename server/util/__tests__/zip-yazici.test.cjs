// server/util/__tests__/zip-yazici.test.cjs - kucuk ZIP yazici (yeni bagimlilik yok).
//
//   ZY1  uretilen arsiv `unzip -t` ve python zipfile ile hatasiz acilir; icerik, UTF-8 ad, bos dosya,
//        sikistirilamayan veri (stored) dogru
//   ZY2  ad kurallari: mutlak yol, '..', bos parca, ters bolu, NUL reddedilir (zip slip); ayni ad iki kez yok
//   ZY3  sinirlar: giris sayisi ve toplam bayt asilinca 422 (bellege sinirsiz yigilmaz)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { zipOlustur } = require('../zip-yazici.cjs');

const PY = spawnSync('python3', ['-c', 'pass']).status === 0 ? 'python3' : null;
const UNZIP = spawnSync('unzip', ['-v']).status === 0;

test('ZY1 arsiv gercek araclarla acilir', { skip: PY ? false : 'python3 yok' }, () => {
  const rastgele = crypto.randomBytes(4096);
  const b = zipOlustur([
    { ad: 'a.csv', veri: '\uFEFFsunucu;durum\r\nAPPSRV01;TAM\r\n' },
    { ad: 'uygulamalar/vhosting8/ÖDEME.ear/tree.txt', veri: 'x'.repeat(20000) },
    { ad: 'bos.txt', veri: '' },
    { ad: 'ikili.bin', veri: rastgele },
  ]);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-'));
  const z = path.join(d, 'a.zip');
  fs.writeFileSync(z, b);
  if (UNZIP) assert.equal(spawnSync('unzip', ['-t', z]).status, 0, 'unzip -t');
  const r = spawnSync(PY, [
    '-c',
    'import sys, zipfile, json, hashlib\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({i.filename: [i.compress_type, hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()}))',
    z,
  ]);
  assert.equal(r.status, 0, String(r.stderr));
  const o = JSON.parse(String(r.stdout));
  const h = (v) => crypto.createHash('sha256').update(v).digest('hex');
  assert.equal(o['a.csv'][1], h(Buffer.from('\uFEFFsunucu;durum\r\nAPPSRV01;TAM\r\n')));
  assert.equal(
    o['uygulamalar/vhosting8/ÖDEME.ear/tree.txt'][0],
    8,
    'tekrarli metin sikistirilmali',
  );
  assert.equal(o['ikili.bin'][0], 0, 'sikismayan veri stored');
  assert.equal(o['ikili.bin'][1], h(rastgele));
  assert.equal(o['bos.txt'][1], h(Buffer.alloc(0)));
});

test('ZY2 ad kurallari', () => {
  for (const kotu of ['/abs', '../x', 'a/../b', 'a//b', 'a\\b', 'a\0b', '', './a', 'a/'])
    assert.throws(
      () => zipOlustur([{ ad: kotu, veri: 'x' }]),
      (e) => e.status === 422,
      JSON.stringify(kotu),
    );
  assert.throws(
    () =>
      zipOlustur([
        { ad: 'a', veri: '1' },
        { ad: 'a', veri: '2' },
      ]),
    /iki kez/,
  );
});

test('ZY3 sinirlar', () => {
  assert.throws(
    () =>
      zipOlustur(
        [
          { ad: 'a', veri: 'x' },
          { ad: 'b', veri: 'y' },
        ],
        { sinirGiris: 1 },
      ),
    (e) => e.status === 422,
  );
  assert.throws(
    () => zipOlustur([{ ad: 'a', veri: crypto.randomBytes(2048) }], { sinirBayt: 1024 }),
    (e) => e.status === 422,
  );
  assert.throws(
    () => zipOlustur('degil'),
    (e) => e.status === 422,
  );
});
