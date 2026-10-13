// API/UI sozlesmesi: job ID'siz gecis claim'i "is hic baslatilmadi" diye yorumlanamaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

test('RO4 hedef DTO DELETE job kimligini tasir', () => {
  const row = INDEX.slice(
    INDEX.indexOf('function rowTarget'),
    INDEX.indexOf('async function addEvent'),
  );
  assert.match(row, /deleteJobId:\s*t\.delete_job_id/);
});

test('RO5 job ID yoklugu baslatilmadi diye sunulmaz ve otomatik retry onermez', () => {
  const refresh = INDEX.slice(
    INDEX.indexOf("router.post('/:id/targets/:tid/refresh-status'"),
    INDEX.indexOf('// ── GERI AL', INDEX.indexOf("router.post('/:id/targets/:tid/refresh-status'")),
  );
  assert.doesNotMatch(refresh, /iş hiç başlatılamamış/);
  assert.match(refresh, /başlayıp başlamadığı doğrulanamıyor/);
  assert.match(refresh, /otomatik tekrar başlatılmaz/);
  assert.match(refresh, /jobMissing:\s*true/);
});
