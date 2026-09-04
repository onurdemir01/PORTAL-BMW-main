// server/scalex/__tests__/scalex-state.test.cjs — state.cjs BEKCI testleri.
//
// `classifyDrift` saf fonksiyonu zaten scalex-contract.test.cjs'te kapsamli
// test edilir (CD1-CD12 + property). Bu dosya DB-bagimli fonksiyonlarin
// (refreshDrift, upsertStopped) KAYNAK UZERINDEN dogrulanmasini yapar:
// kritik SQL desenleri ve kontrol akislari kod icinden aranir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'state.cjs'), 'utf8');

// ── B4: refreshDrift — cluster-only satirlar icin last_seen_at ────────────────
//
// COZDUGU SORUN: `source === 'portal'` kontrolu drift-status-update mantiginda
// kalmali, ama `onCluster` olan TUM satirlar (cluster'dan gelenler dahil) icin
// `last_seen_at` UPDATE'si AYRI calismali. Aksi halde StoppedPanel'in 7 gunluk
// "eski" esigi bu satirlari haksiz yere yakalar ve ekranda GHOST gosterir.
test('B4: cluster-sourced onCluster satirlar last_seen_at GUNCELLER (dogal anahtarla)', () => {
  const idx = SRC.indexOf("source === 'cluster'");
  assert.ok(idx > 0, "source === 'cluster' kontrolu bulunamadi");
  const block = SRC.slice(idx, idx + 400);
  assert.match(block, /onCluster/, 'cluster kaynakli satir icin onCluster kontrolu kaybolmus');
  assert.match(
    block,
    /last_seen_at = GETUTCDATE\(\)/,
    'cluster satirlari icin last_seen_at guncellenmesi YOK',
  );
  // Dogal anahtar (id yoksa bile): env + tenant + cluster_name + namespace + app_name
  assert.match(block, /cluster_name = \$3/, 'dogal anahtar cluster_name icermeli');
  assert.match(block, /namespace = \$4/, 'dogal anahtar namespace icermeli');
  assert.match(block, /app_name = \$5/, 'dogal anahtar app_name icermeli');
});

test('B4: portal-sourced satirlar drift DEGISMESE BILE last_seen_at GUNCELLER', () => {
  // refreshDrift icindeki `if (rowCount === 0)` blogu: UPDATE `drift_status <> $1`
  // yuzunden 0 satir dondururse (yani drift ayni), `last_seen_at` AYRI bir UPDATE
  // ile guncellenmeli. Yorum satirindaki `rowCount === 0`i ATLA.
  const fnStart = SRC.indexOf('async function refreshDrift');
  assert.ok(fnStart > 0, 'refreshDrift fonksiyonu bulunamadi');
  const fnBody = SRC.slice(fnStart);
  const idx = fnBody.indexOf('if (rowCount === 0)');
  assert.ok(idx > 0, 'rowCount === 0 kontrolu refreshDrift icinde bulunamadi');
  const block = fnBody.slice(idx, idx + 200);
  assert.match(
    block,
    /last_seen_at = GETUTCDATE\(\)/,
    'degismeyen satirlarda last_seen_at guncellenmesi YOK',
  );
});

// ── upsertStopped ─────────────────────────────────────────────────────────────
// Durdurma islemi basariyla dogrulandiginda cagrilir. MERGE ile INSERT veya UPDATE.
test('upsertStopped: MERGE deseni MATCHED ve NOT MATCHED dallarini icerir', () => {
  const idx = SRC.indexOf('function upsertStopped');
  assert.ok(idx > 0, 'upsertStopped fonksiyonu bulunamadi');
  const body = SRC.slice(idx, idx + 1000);
  assert.match(body, /WHEN MATCHED THEN UPDATE/, 'MERGE MATCHED dali kaybolmus');
  assert.match(body, /WHEN NOT MATCHED THEN INSERT/, 'MERGE NOT MATCHED dali kaybolmus');
  assert.match(body, /drift_status.*in_sync/, 'durdurulan uygulama in_sync olarak isaretlenmeli');
});

// ── DRIFT sabitleri ───────────────────────────────────────────────────────────
test('DRIFT sabitleri Object.freeze ile korunur', () => {
  assert.match(
    SRC,
    /Object\.freeze\(\{[\s\S]*?IN_SYNC[\s\S]*?MISSING_ON_CLUSTER[\s\S]*?UNKNOWN_TO_PORTAL/,
  );
});

// ── keyOf yardımcı ────────────────────────────────────────────────────────────
test('keyOf: env/tenant/cluster/namespace/app birlestir (ayrac \\u001f)', () => {
  const fnBody = SRC.slice(SRC.indexOf('function keyOf'), SRC.indexOf('function keyOf') + 200);
  assert.match(
    fnBody,
    /\.join\(.\\u001f.\)/,
    'keyOf birlestiricisi \\u001f olmali (benzersiz ayirac)',
  );
});
