// server/db/__tests__/housekeeping.test.cjs — TBMWANS doluluk/uyari/temizlik (2026-09-18).
// Gercek DB yok: saf fonksiyonlar (ust sinir hesabi, uyari yuzdesi, gunde-bir uyari secimi,
// Teams karti) ve kaynak kod sozlesmesi (parti parti UPDATE/DELETE, env belgeleri).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const hk = require('../housekeeping.cjs');

test('HK1 fileCapMb: -1 ve 2 TB "sinirsiz" -> null; 0 -> mevcut boyut; sayfa -> MB', () => {
  assert.equal(hk.fileCapMb({ max_size: -1, size_mb: 100 }), null);
  assert.equal(hk.fileCapMb({ max_size: 268435456, size_mb: 100 }), null);
  assert.equal(hk.fileCapMb({ max_size: 0, size_mb: 100 }), 100);
  assert.equal(hk.fileCapMb({ max_size: 1280000, size_mb: 100 }), 10000); // 10 GB
});

test('HK2 effectivePercent: ust sinir varsa ona gore (kullanicinin %96.4 durumu)', () => {
  const f = { used_mb: 9636.4, size_mb: 10000, cap_mb: 10000, volume_free_mb: 500000, pct_of_file: 96.4 };
  assert.equal(hk.effectivePercent(f).toFixed(1), '96.4');
});

test('HK3 effectivePercent: sinirsiz dosya diske gore; disk bilgisi yoksa dosya ici', () => {
  const f = { used_mb: 100, size_mb: 100, cap_mb: null, volume_free_mb: 900, pct_of_file: 100 };
  assert.equal(hk.effectivePercent(f), 10); // 100 / (100 + 900)
  const g = { used_mb: 50, size_mb: 100, cap_mb: null, volume_free_mb: null, pct_of_file: 50 };
  assert.equal(hk.effectivePercent(g), 50);
});

test('HK4 filesNeedingAlert: esik ustu ve bugun uyarilmamis olanlar; dosya basina gunde bir', () => {
  const usage = {
    files: [
      { name: 'FG_DATA', alert_pct: 96.4 },
      { name: 'log', alert_pct: 0.2 },
      { name: 'primary', alert_pct: 90 },
    ],
  };
  const cfg = { alertPercent: 85 };
  const due = hk.filesNeedingAlert(usage, cfg, { primary: '2026-09-18' }, '2026-09-18');
  assert.deepEqual(due.map((f) => f.name), ['FG_DATA']);
  // ertesi gun primary yeniden uyarilir
  const due2 = hk.filesNeedingAlert(usage, cfg, { primary: '2026-09-18' }, '2026-09-19');
  assert.deepEqual(due2.map((f) => f.name), ['FG_DATA', 'primary']);
});

test('HK5 buildAlertCard: Adaptive Card; log icin BACKUP LOG, veri icin MAXSIZE ipucu; log_reuse_wait', () => {
  const usage = { database: 'TBMWANS', logReuseWait: 'LOG_BACKUP' };
  const files = [
    { name: 'TBMWANS_log', kind: 'log', alert_pct: 99.1, used_mb: 9910, cap_mb: 10000 },
    { name: 'TBMWANS_FG_DATA', kind: 'data', alert_pct: 96.4, used_mb: 9636, cap_mb: 10000 },
  ];
  const card = hk.buildAlertCard(usage, files, { alertPercent: 85 });
  const text = JSON.stringify(card);
  assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.match(text, /TBMWANS/);
  assert.match(text, /BACKUP LOG/);
  assert.match(text, /MAXSIZE=UNLIMITED/);
  assert.match(text, /LOG_BACKUP/);
  assert.match(text, /%99\.1/);
});

test('HK6 temizlik parti parti: her UPDATE/DELETE "TOP (@n)" tasir (tek buyuk islem log dolduruyordu)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'housekeeping.cjs'), 'utf8');
  // portal_config_blobs'a yazilan tek satirlik durum UPDATE'i kapsam disi
  const stmts = (src.match(/`\s*(UPDATE|DELETE)[^`]*`/g) || []).filter((s) => /logx_v2_/.test(s));
  assert.ok(stmts.length >= 3, 'en az 3 logx_v2 temizlik ifadesi bekleniyor');
  for (const s of stmts) assert.match(s, /TOP \(@n\)/, `parti parti degil: ${s.slice(0, 60)}`);
  // silme yalniz suresi dolmus istekler (expires_at) — canli sihirbaz oturumu silinmez
  assert.match(src, /DELETE TOP \(@n\) FROM logx_v2_requests[\s\S]*expires_at < GETUTCDATE\(\)/);
});

test('HK7 env belgeleri ve kayit: .env.example + server/index.cjs', () => {
  const env = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.env.example'), 'utf8');
  for (const k of ['DB_USAGE_ALERT_PERCENT', 'DB_USAGE_ALERT_WEBHOOK_URL', 'DB_HOUSEKEEPING_HOUR', 'LOGX_V2_BLOB_RETENTION_DAYS', 'LOGX_V2_ROW_RETENTION_DAYS']) {
    assert.match(env, new RegExp(`^${k}=`, 'm'), `${k} .env.example'da yok`);
  }
  const idx = fs.readFileSync(path.join(__dirname, '..', '..', 'index.cjs'), 'utf8');
  assert.match(idx, /housekeeping\.cjs'\)\.initDbHousekeeping\(app\)/);
});

test('HK8 getConfig: bos/NaN env varsayilana duser, sinirlar kelepcelenir', () => {
  const saved = { ...process.env };
  process.env.DB_USAGE_ALERT_PERCENT = '';
  process.env.DB_HOUSEKEEPING_CHECK_INTERVAL_MINUTES = 'abc';
  process.env.DB_HOUSEKEEPING_HOUR = '99';
  try {
    const cfg = hk.getConfig();
    assert.equal(cfg.alertPercent, 85);
    assert.equal(cfg.checkIntervalMinutes, 15);
    assert.equal(cfg.hour, 23);
  } finally {
    process.env = saved;
  }
});
