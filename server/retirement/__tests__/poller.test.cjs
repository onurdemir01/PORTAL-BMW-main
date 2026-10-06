// server/retirement/__tests__/poller.test.cjs — RP1..RP8 (2026-10-06).
//
// Retirement poller'i: STOP'u OCO penceresi acilinca, DELETE'i silme tarihi gelince
// tetikler ve DELETE'i SONUCLANDIRIR (kullanici karari: "delete kismi icin ekstra talep
// olmaz, otomatik olarak is scheduled edilir ve tarih geldiginde is yapilir").
//
// EN PAHALI DORT YANLIS:
//   1. Penceresi KACIRILMIS bir STOP'u kosturmak -> onaylanmamis saatte uretim durur
//   2. Durdurulmamis bir uygulamayi silmeye kalkmak
//   3. Launch dustugunde hedefi 'stopping'de BIRAKMAK -> pencere icinde bir daha denenmez
//   4. AWX okunamadiginda 'failed' yazmak -> basarili olmus bir silme basarisiz gorunur
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// DB'yi require onbelleginde degistiririz: poller `require('../db/index.cjs')` cagiriyor.
const DB_YOL = path.join(__dirname, '..', '..', 'db', 'index.cjs');
const sahteDb = { query: async () => ({ rows: [], rowCount: 0 }) };
require.cache[Module._resolveFilename(DB_YOL, module)] = { id: DB_YOL, filename: DB_YOL, loaded: true, exports: sahteDb };

const poller = require('../poller.cjs');

/** Sorgu metnine gore yanit veren sahte DB; yazilan UPDATE'leri kaydeder. */
function dbKur(okumalar) {
  const yazilan = [];
  sahteDb.query = async (sql, params) => {
    const t = String(sql).replace(/\s+/g, ' ');
    if (/^SELECT/i.test(t.trim())) {
      for (const [desen, rows] of okumalar) if (t.includes(desen)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    }
    yazilan.push({ sql: t, params });
    // UPDATE ... WHERE status = 'X' claim'i: varsayilan olarak TUTAR
    return { rows: [], rowCount: 1 };
  };
  return yazilan;
}

const N = new Date('2026-10-06T12:00:00Z');
const hedef = (o = {}) => ({
  id: 7, record_id: 3, host: 'GBJBOP01', app_name: 'CRM', jboss_gen: 7, app_path: '/hysdeploy/CRM.ear',
  env: 'PROD', smart_no: '123', oco_no: 'OCO-1', scheduled_at: '2026-10-06T10:00:00Z',
  window_end: '2026-10-06T14:00:00Z', ...o,
});

test('RP1 pencere ACIKSA STOP tetiklenir ve CLAIM once yapilir', async () => {
  const yazilan = dbKur([["FROM retirement_targets t JOIN retirement_records r", [hedef()]]]);
  const cagri = [];
  poller.startPoller(async (kind, t) => { cagri.push({ kind, t }); return { jobId: 999 }; });
  const r = await poller._stopTick(N);
  poller.stopPoller();
  assert.equal(r.kosan, 1);
  assert.equal(cagri.length, 1);
  assert.equal(cagri[0].kind, 'stop');
  assert.equal(cagri[0].t.host, 'GBJBOP01');
  // CLAIM LAUNCH'TAN ONCE: iki tick ust uste binerse ayni hedef iki kez baslatilmasin
  const claim = yazilan.findIndex((w) => /status = 'stopping'/.test(w.sql) && /status = 'stop_scheduled'/.test(w.sql));
  assert.ok(claim >= 0, 'claim UPDATE yok');
  const jobYaz = yazilan.findIndex((w) => /last_job_id/.test(w.sql));
  assert.ok(claim < jobYaz, 'claim launch sonrasina kalmis - cift tetikleme riski');
});

test('RP2 pencere ACILMADIYSA hicbir sey yapilmaz', async () => {
  dbKur([["FROM retirement_targets t JOIN retirement_records r", [hedef({ scheduled_at: '2026-10-06T22:00:00Z', window_end: '2026-10-07T00:00:00Z' })]]]);
  const cagri = [];
  poller.startPoller(async (k, t) => { cagri.push({ k, t }); return { jobId: 1 }; });
  const r = await poller._stopTick(N);
  poller.stopPoller();
  assert.equal(r.kosan, 0);
  assert.equal(cagri.length, 0, 'pencere acilmadan is baslatilmis');
});

test('RP3 pencere KAPANDIYSA kosmaz ve SESSIZ kalmaz', async () => {
  const yazilan = dbKur([["FROM retirement_targets t JOIN retirement_records r", [hedef({ scheduled_at: '2026-10-05T10:00:00Z', window_end: '2026-10-05T12:00:00Z' })]]]);
  const cagri = [];
  poller.startPoller(async (k) => { cagri.push(k); return { jobId: 1 }; });
  const r = await poller._stopTick(N);
  poller.stopPoller();
  assert.equal(cagri.length, 0, 'penceresi kacirilmis is kosturulmus');
  assert.equal(r.gecen, 1);
  // 'stop_scheduled'da asili kalmaz: 'failed' yazilir ve sebebi kaydedilir
  assert.ok(yazilan.some((w) => /status = 'failed'/.test(w.sql)), 'kacirilan pencere isaretlenmemis');
});

test('RP4 LAUNCH DUSERSE claim GERI ALINIR (pencere icinde tekrar denenebilsin)', async () => {
  const yazilan = dbKur([["FROM retirement_targets t JOIN retirement_records r", [hedef()]]]);
  poller.startPoller(async () => { throw new Error('AWX 500'); });
  const r = await poller._stopTick(N);
  poller.stopPoller();
  assert.equal(r.kosan, 0);
  const geri = yazilan.find((w) => /SET status = 'stop_scheduled'/.test(w.sql));
  assert.ok(geri, "claim geri alinmamis - hedef 'stopping'de kalir ve bir daha denenmez");
  assert.match(String(geri.params[0]), /AWX 500/);
});

test('RP5 DELETE: tarihi gelmeyen hedef tetiklenmez', async () => {
  dbKur([["FROM retirement_targets t JOIN retirement_records r", [{
    id: 9, record_id: 4, host: 'H', app_name: 'A', jboss_gen: 8, app_path: '', env: 'TEST',
    smart_no: '1', planned_delete_at: '2026-12-01', stop_at: '2026-10-01', delete_after_days: 45,
  }]]]);
  const cagri = [];
  poller.startPoller(async (k) => { cagri.push(k); return { jobId: 1 }; });
  const r = await poller._deleteTick(N);
  poller.stopPoller();
  assert.equal(r.kosan, 0);
  assert.equal(cagri.length, 0);
});

test('RP6 DELETE: tarih gelince tetiklenir, plan_only YOK (insan izlemiyor)', async () => {
  dbKur([["FROM retirement_targets t JOIN retirement_records r", [{
    id: 9, record_id: 4, host: 'H', app_name: 'A', jboss_gen: 8, app_path: '', env: 'TEST',
    smart_no: '1', planned_delete_at: '2026-10-05', stop_at: '2026-09-01', delete_after_days: 45,
  }]]]);
  const cagri = [];
  poller.startPoller(async (kind, t) => { cagri.push({ kind, t }); return { jobId: 777 }; });
  const r = await poller._deleteTick(N);
  poller.stopPoller();
  assert.equal(r.kosan, 1);
  assert.equal(cagri[0].kind, 'delete');
});

test('RP7 SONLANDIRMA: basarili DELETE "deleted" yazar, basarisiz "failed"', async () => {
  const kur = (ok) => {
    const yazilan = dbKur([
      ['WHERE status = \'deleting\' AND delete_job_id IS NOT NULL', [{ id: 9, record_id: 4, host: 'H', app_name: 'A', delete_job_id: 5 }]],
      ['SELECT COUNT(*) AS n FROM retirement_targets', [{ n: 0 }]],
    ]);
    poller.startPoller(async () => ({ jobId: 1 }), async () => ({ terminal: true, ok, message: ok ? 'silindi' : 'patladi' }));
    return yazilan;
  };
  let y = kur(true);
  let r = await poller._finalizeTick();
  poller.stopPoller();
  assert.equal(r.kapanan, 1);
  assert.ok(y.some((w) => /status = 'deleted'/.test(w.sql)), 'basarili silme isaretlenmemis');
  // TUM hedefler silindiyse KAYIT da kapanir
  assert.ok(y.some((w) => /UPDATE retirement_records SET status = 'deleted'/.test(w.sql)), 'kayit kapanmamis');

  y = kur(false);
  r = await poller._finalizeTick();
  poller.stopPoller();
  assert.ok(y.some((w) => /status = 'failed'/.test(w.sql)), 'basarisiz silme isaretlenmemis');
});

test('RP8 OKUNAMADI != BASARISIZ: AWX duserse hedef "deleting"de KALIR', async () => {
  // 'failed' yazmak, aslinda BASARILI olmus bir silmeyi basarisiz gostermek olurdu.
  const yazilan = dbKur([
    ['WHERE status = \'deleting\' AND delete_job_id IS NOT NULL', [{ id: 9, record_id: 4, host: 'H', app_name: 'A', delete_job_id: 5 }]],
  ]);
  poller.startPoller(async () => ({ jobId: 1 }), async () => { throw new Error('AWX erisilemedi'); });
  const r = await poller._finalizeTick();
  poller.stopPoller();
  assert.equal(r.kapanan, 0);
  assert.equal(yazilan.length, 0, 'okunamayan is icin durum yazilmis');
  // Is HENUZ BITMEDIYSE de dokunulmaz
  const y2 = dbKur([['WHERE status = \'deleting\' AND delete_job_id IS NOT NULL', [{ id: 9, record_id: 4, host: 'H', app_name: 'A', delete_job_id: 5 }]]]);
  poller.startPoller(async () => ({ jobId: 1 }), async () => ({ terminal: false }));
  await poller._finalizeTick();
  poller.stopPoller();
  assert.equal(y2.length, 0, 'bitmemis is sonuclandirilmis');
});

test('RP9 CLAIM TUTMAZSA launch EDILMEZ (cift tetikleme korumasi)', async () => {
  // Iki tick ust uste binerse ayni hedefi iki kez baslatmamak claim'in isi: durum ONCE
  // degisir, tutmadiysa (baska tick almis) is BASLATILMAZ. Sahte DB varsayilan olarak
  // rowCount:1 donuyor, o yuzden bu testte claim'i BILEREK dusururuz - yoksa mutasyon
  // `if (!claim.rowCount) continue;` silinse bile bekci susuyordu (mutasyon M2).
  const yazilan = [];
  sahteDb.query = async (sql, params) => {
    const t = String(sql).replace(/\s+/g, ' ');
    if (/^SELECT/i.test(t.trim())) return { rows: [hedef()], rowCount: 1 };
    yazilan.push({ sql: t, params });
    if (/SET status = 'stopping'/.test(t)) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  };
  const cagri = [];
  poller.startPoller(async (k) => { cagri.push(k); return { jobId: 1 }; });
  const r = await poller._stopTick(N);
  poller.stopPoller();
  assert.equal(cagri.length, 0, 'claim tutmadigi halde is baslatilmis - cift tetikleme');
  assert.equal(r.kosan, 0);
});

test('RP10 DELETE sorgusu DURUM ve deleted_at suzgecini TASIR', () => {
  // SAHTE DB SQL SEMANTIGINI MODELLEMEZ: sorgu metnindeki WHERE kaldirilsa bile ayni
  // satirlar doner, yani davranis testi bu kaybi goremez (mutasyon M4 boyle sagkaldi).
  // Suzgecin VARLIGI kaynak uzerinden olculur. Kaybi: `t.status = 'stopped'` silinirse
  // DURDURULMAMIS bir uygulama silinmeye kalkar.
  const fs = require('node:fs');
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'poller.cjs'), 'utf8');
  const sorgu = src.slice(src.indexOf('async function deleteTick'), src.indexOf('let kosan = 0;', src.indexOf('async function deleteTick')));
  assert.match(sorgu, /t\.status = 'stopped'/, "DELETE sorgusu 'stopped' suzgecini kaybetmis - durdurulmamis uygulama silinir");
  assert.match(sorgu, /t\.deleted_at IS NULL/, 'zaten silinmis hedef tekrar silinmeye kalkar');
  assert.match(sorgu, /r\.status NOT IN \('cancelled', 'deleted'\)/, 'iptal edilmis kaydin hedefi silinir');
  // STOP sorgusu da kendi suzgecini tasimali
  const sstop = src.slice(src.indexOf('async function stopTick'), src.indexOf('let kosan = 0;', src.indexOf('async function stopTick')));
  assert.match(sstop, /t\.status = 'stop_scheduled'/, 'STOP sorgusu zamanlanmis hedef suzgecini kaybetmis');
  assert.match(sstop, /r\.status <> 'cancelled'/, 'iptal edilmis kaydin STOP"u kosar');
});

test('RP11 STOP"u da POLLER sonuclandirir (gece kimse yoklamiyor)', async () => {
  // ACIK BOSLUKTU: STOP artik OCO penceresine zamanlaniyor, yani is gece 02:00'de
  // poller tarafindan baslatiliyor. Onyuzun job-status yoklamasi yalnizca ekranda
  // bekleyen bir insan varken calisir. Bu sonlandirma olmadan hedef sonsuza dek
  // 'stopping'de kalirdi VE silme hic tetiklenmezdi (deleteTick yalniz 'stopped'e bakar).
  const yazilan = [];
  sahteDb.query = async (sql, params) => {
    const t = String(sql).replace(/\s+/g, ' ');
    if (/^SELECT/i.test(t.trim())) {
      if (/status = 'stopping' AND last_job_id IS NOT NULL/.test(t))
        return { rows: [{ id: 7, record_id: 3, host: 'H', app_name: 'A', env: 'PROD', job_id: 11 }], rowCount: 1 };
      if (/COUNT\(\*\) AS n/.test(t)) return { rows: [{ n: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
    yazilan.push({ sql: t, params });
    return { rows: [], rowCount: 1 };
  };
  const gorulen = [];
  poller.startPoller(async () => ({ jobId: 1 }), async (kind) => { gorulen.push(kind); return { terminal: true, ok: true, message: 'durduruldu' }; });
  const r = await poller._finalizeTick();
  poller.stopPoller();
  assert.ok(gorulen.includes('stop'), 'STOP sonlandirmasi hic cagrilmamis');
  assert.equal(r.kapanan, 1);
  assert.ok(yazilan.some((w) => /status = 'stopped'/.test(w.sql)), "hedef 'stopped' yazilmamis");
  // stop_at ILK stop'ta yazilir: silme tarihi buradan sayilir
  assert.ok(
    yazilan.some((w) => /stop_at = COALESCE\(stop_at, GETUTCDATE\(\)\)/.test(w.sql)),
    'stop_at yazilmamis - silme tarihi hic hesaplanamaz',
  );
});
