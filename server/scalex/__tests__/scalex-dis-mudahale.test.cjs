// server/scalex/__tests__/scalex-dis-mudahale.test.cjs
// DIS MUDAHALE TOLERANSI — "biri ayaga kaldirdiysa SORUN YOK de".
//
// KULLANICI (2026-09-17): "benim ekibimde biri bunu ayaga kaldirdiysa bunu da
// handle et sorun yok de."
//
// ESKI DAVRANIS: durum ConfigMap'i yoksa portal "biri elle geri almis OLABILIR"
// yaziyordu. Bu bir TAHMINDI ve IKI FARKLI gercegi ayni sekilde gosteriyordu:
//
//   * uygulama AYAKTA → kayit ANLAMSIZ kalmis; kapatilmali, "sorun yok".
//   * uygulama 0'DA   → geri alma bilgisi KAYIP; asil bakilmasi gereken durum.
//
// `discover_state` yalnizca ConfigMap listeliyordu, canli replica TASIMIYORDU —
// yani karari verecek veri yoktu. Artik `LIVE` satirlari geliyor.
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const calls = { cleared: [], updated: [], audit: [] };

const audit = require('../../audit/index.cjs');
audit.auditPortal = (_req, action, p) => calls.audit.push({ action, ...p });

// Ayna satirlari ve UPDATE'ler sahte bir DB uzerinde.
let mirror = [];
const db = require('../../db/index.cjs');
db.query = async (sqlText, params) => {
  const s = String(sqlText).replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT TOP 501 * FROM scalex_state_mirror WHERE env')) {
    return { rows: mirror.map((m) => ({ ...m })) };
  }
  if (s.startsWith('DELETE FROM scalex_state_mirror')) {
    const [env, tenant, cluster, ns, app] = params;
    const before = mirror.length;
    mirror = mirror.filter(
      (m) =>
        !(m.env === env && m.tenant === tenant && m.cluster_name === cluster &&
          m.namespace === ns && m.app_name === app),
    );
    calls.cleared.push({ cluster, app });
    return { rowCount: before - mirror.length };
  }
  if (s.startsWith('UPDATE scalex_state_mirror SET drift_status')) {
    calls.updated.push({ drift: params[0], id: params[1] });
    return { rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};

const state = require('../state.cjs');

function row(over = {}) {
  return {
    id: 1, env: 'test', tenant: 'ark', cluster_name: 'gbocptest1',
    namespace: 'ns1', app_name: 'app1', workload_kind: 'DeploymentConfig',
    previous_replicas: 1, phase: 'scaled_down', stopped_by: 'uxmid',
    stopped_at: null, stopped_by_groups: null, restore_attempts: 0,
    last_restore_at: null, last_restore_error: null, operation_id: 1,
    last_seen_at: null, drift_status: 'in_sync', ...over,
  };
}
function live(over = {}) {
  return {
    env: 'test', tenant: 'ark', clusterName: 'gbocptest1',
    namespace: 'ns1', appName: 'app1', readyReplicas: 1, workloadAbsent: false, ...over,
  };
}
const refresh = (liveStates) =>
  state.refreshDrift({
    env: 'test', tenant: 'ark', scannedClusters: ['gbocptest1'],
    clusterStates: [], // ConfigMap YOK
    liveStates,
  });

beforeEach(() => {
  mirror = [row()];
  calls.cleared.length = 0;
  calls.updated.length = 0;
  calls.audit.length = 0;
});

// EX1 — ASIL ISTEK. ConfigMap yok AMA uygulama ayakta -> satir KAPANIR.
test('EX1 ConfigMap yok + uygulama AYAKTA -> satir kapatilir, "sorun yok"', async () => {
  await refresh([live({ readyReplicas: 1 })]);
  assert.equal(calls.cleared.length, 1, 'ayakta olan uygulamanin kaydi kapatilmadi');
  assert.equal(mirror.length, 0);
  const ev = calls.audit.find((a) => a.action === 'scalex_drift_resolved');
  assert.ok(ev, 'cozulme denetime yazilmadi');
  assert.equal(ev.result, 'ok', 'bu bir ARIZA degil — alarm seviyesinde yazilmis');
});

// EX2 — GEVSEMEDIGINI KANITLA. Uygulama kapaliysa satir DURUR ve sapma isaretlenir.
test('EX2 ConfigMap yok + uygulama 0`DA -> satir DURUR ve sapma isaretlenir', async () => {
  await refresh([live({ readyReplicas: 0 })]);
  assert.equal(calls.cleared.length, 0, 'kapali uygulamanin kaydi SILINDI — geri alinamaz olur');
  assert.equal(mirror.length, 1);
  assert.deepEqual(
    calls.updated.map((u) => u.drift),
    ['missing_on_cluster'],
    'sapma isaretlenmedi',
  );
});

// EX3 — `spec=1` AMA `ready=0`. Pod ayaga kalkamiyor (imaj/kota). Kayit ANLAMSIZ
// DEGIL: kullanici hala geri almak isteyebilir.
test('EX3 spec=1 ama ready=0 ise satir DURUR (olcut `ready`)', async () => {
  await refresh([live({ specReplicas: 1, statusReplicas: 1, readyReplicas: 0 })]);
  assert.equal(calls.cleared.length, 0, '`spec` ile karar verilmis — pod hazir degil');
});

// EX4 — CANLI VERI HIC YOKSA (eski paket) eski davranis surmeli. Aksi halde AWX'e
// yeni paket kopyalanana kadar HICBIR sapma isaretlenmezdi.
test('EX4 LIVE satiri hic gelmezse eski davranis (sapma isaretlenir)', async () => {
  await refresh([]);
  assert.equal(calls.cleared.length, 0);
  assert.deepEqual(calls.updated.map((u) => u.drift), ['missing_on_cluster']);
});

// EX5 — UYGULAMA NAMESPACE'TE YOK. Silinmis; ayakta DEGIL, satir DURMALI.
test('EX5 workload_absent -> satir DURUR', async () => {
  await refresh([live({ workloadAbsent: true, readyReplicas: null })]);
  assert.equal(calls.cleared.length, 0, 'silinmis uygulamanin kaydi "ayakta" sayildi');
});

// EX6 — BASKA BIR UYGULAMANIN canli kaydi bu satiri KAPATMAMALI. Anahtar
// eslesmesi gevserse bir uygulamanin ayakta olmasi otekinin kaydini silerdi.
test('EX6 farkli uygulamanin LIVE kaydi bu satiri kapatmaz', async () => {
  await refresh([live({ appName: 'baska-app', readyReplicas: 5 })]);
  assert.equal(calls.cleared.length, 0, 'anahtar eslesmesi gevsek — yanlis satir silindi');
});
