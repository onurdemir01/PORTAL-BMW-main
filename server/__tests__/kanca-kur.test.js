'use strict';
// GIT KANCALARI KURULUMU (scripts/kanca-kur.mjs, package.json `prepare`) — GERCEK betik alt surecte.
//   KH1 husky kuruluysa onun ciktisi yazilir, cikis 0 (HUSKY=0: husky kurmadan doner; depoya dokunmaz).
//   KH2 husky cozulemezse (kok manifest kurulumu: kurumsal pipeline, uretim sunucusu) sessizce cikis 0.
//   KH3 baska bir yukleme hatasi YUTULMAZ: kurulum duser.
// husky'nin cozulemedigi durum fixtures/husky-coz.mjs yukleme kancasiyla kurulur (betigin kopyasi
// degil, deponun kendi dosyasi kosar). Kopyayla sinayan bekci: guvenlik-tabanlari GT7.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, '..', '..', 'scripts', 'kanca-kur.mjs');
const KANCA = path.join(__dirname, 'fixtures', 'husky-coz.mjs');

function kos(t, { env = {}, kanca = false } = {}) {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'kanca-kur-'));
  t.after(() => fs.rmSync(dizin, { recursive: true, force: true }));
  const argv = kanca ? ['--import', KANCA, BETIK] : [BETIK];
  const r = spawnSync(process.execPath, argv, {
    cwd: dizin,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { kod: r.status, out: r.stdout, err: r.stderr };
}

test('KH1 husky kuruluysa ciktisi yazilir, cikis 0', (t) => {
  const r = kos(t, { env: { HUSKY: '0' } });
  assert.equal(r.kod, 0, r.err);
  assert.equal(r.out, 'HUSKY=0 skip install\n');
});

test('KH2 husky cozulemezse sessizce cikis 0', (t) => {
  const r = kos(t, { env: { HUSKY_COZ: 'yok' }, kanca: true });
  assert.equal(r.kod, 0, r.err);
  assert.equal(r.out, '');
  assert.equal(r.err, '');
});

test('KH3 baska bir yukleme hatasi yutulmaz', (t) => {
  const r = kos(t, { env: { HUSKY_COZ: 'bozuk' }, kanca: true });
  assert.notEqual(r.kod, 0, 'bozuk husky kurulumu basarili gibi gecti');
  assert.match(r.err, /sahte husky: bozuk/);
});
