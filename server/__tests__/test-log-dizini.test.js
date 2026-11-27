// server/__tests__/test-log-dizini.test.js — TESTLER DEPONUN logs/ DIZININI KIRLETMEZ (2026-11-27).
//
// Denetim ara katmanindan gecen rota testleri (LogX /admin, gorunurluk, ...) DB'siz ortamda kaydi
// LOG_DIR/audit-spool.<tablo>.ndjson'a spool'luyordu. LOG_DIR verilmediginde bu deponun logs/ dizini
// demek: her `npm run kapi` kosusu calisma agacinda dosya biriktiriyordu (main'de 1,8 MB). Kosucu
// (scripts/run-tests.cjs) artik kosu basina gecici bir LOG_DIR verir ve kosu bitince siler.
//   TL1 kosucu altinda LOG_DIR var, deponun disinda, kosu basina ayri dizin
//   TL2 spool yolu o dizine duser
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test('TL1 koşucu altında LOG_DIR var, deponun dışında, koşu başına geçici dizin', () => {
  const dir = process.env.LOG_DIR;
  assert.ok(
    dir,
    "LOG_DIR yok: denetim spool'u deponun logs/ dizinine yazar (testi scripts/run-tests.cjs ile kosun)",
  );
  const gercek = fs.realpathSync(dir);
  assert.ok(
    !gercek.startsWith(fs.realpathSync(ROOT) + path.sep),
    `LOG_DIR deponun icinde: ${gercek}`,
  );
  assert.ok(
    gercek.startsWith(fs.realpathSync(os.tmpdir())),
    `LOG_DIR gecici dizinde degil: ${gercek}`,
  );
  assert.match(path.basename(gercek), /^portal-test-log-/);
});

test('TL2 spool yolu geçici dizine düşer', () => {
  const { spoolPath } = require('../audit/spool.cjs');
  const yol = spoolPath('portal_audit_logs');
  assert.equal(path.dirname(yol), process.env.LOG_DIR);
  assert.ok(!yol.startsWith(path.join(ROOT, 'logs')), yol);
});
