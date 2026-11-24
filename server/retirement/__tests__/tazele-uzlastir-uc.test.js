// server/retirement/__tests__/tazele-uzlastir-uc.test.js - Retirement hedefinde "Durumu tazele" ve orphan claim
// uzlastirma uclari gercek router ile (2026-11-24, kapsam PR-2). orphan-recovery.test.js dogrulama kuralini sinar;
// uclarin kendisi testsizdi. Sahte: Portal DB (kayit / hedef / olay), AWX runner, playbook kaydi.
//   TU1 refresh-status: kayit / hedef yok 400; gecis durumu degil 400; is numarasi yok 400 (otomatik tekrar YOK)
//   TU2 refresh-status: AWX okunamaz 502; is kosuyorsa degisiklik yok
//   TU3 refresh-status: stopping -> stopped (zaman damgasi) / failed; deleting -> deleted; planning -> planned + izin
//   TU4 reconcile-job: dogrulama (job ID, kayit, hedef, durum, template), dogrulama reddi 409, yaris 409
//   TU5 reconcile-job: basari olay + denetim yazar; AWX hatasi 502
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const D = {
  kayit: null,
  hedefler: [],
  isNo: null,
  yazim: [],
  guncellenen: 1,
  olaylar: [],
  gecmis: null,
};
sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM retirement_records WHERE id = $1'))
      return { rows: D.kayit && D.kayit.id === params[0] ? [D.kayit] : [] };
    if (s.startsWith('SELECT * FROM retirement_targets WHERE record_id = $1'))
      return { rows: D.hedefler };
    if (s.startsWith('SELECT TOP 200 * FROM retirement_events')) return { rows: [] };
    if (/^SELECT \w+ AS job_id FROM retirement_targets/.test(s))
      return { rows: [{ job_id: D.isNo }] };
    if (s.startsWith('SELECT TOP 1 awx_server_id, template_id'))
      return { rows: D.gecmis ? [D.gecmis] : [] };
    if (s.startsWith('SELECT id, record_id, host')) return { rows: [] };
    if (s.startsWith('SELECT TOP 20 at, text FROM retirement_events')) return { rows: [] };
    if (s.startsWith('INSERT INTO retirement_events')) {
      D.olaylar.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE retirement_targets')) {
      D.yazim.push({ s, params });
      return { rows: [], rowCount: D.guncellenen };
    }
    return { rows: [], rowCount: 0 };
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => next() });
sahte('../../auth/visibility.cjs', {
  requireVisiblePrefix: () => (req, res, next) => next(),
  canSee: async () => true,
});
sahte('../poller.cjs', {
  startPoller() {},
  kayitCanli: async () => ({}),
  zamanlayici: () => ({}),
  awxDurumu: () => null,
  webSimdi: async () => ({ kosan: 0 }),
  pollSaniye: () => 300,
});
const denetim = [];
sahte('../../audit/index.cjs', {
  auditPortal: (req, olay, ek) => denetim.push({ olay, detay: JSON.parse(ek.detail) }),
});
const REG = { satir: { awxTemplateId: 61, awxServerId: 2 } };
sahte('../../ansible/playbook-registry.cjs', {
  getByKey: async () => REG.satir,
  getEffectiveTemplateId: (r) => r.awxTemplateId || null,
});
sahte('../../ansible/template-preflight.cjs', {
  assertRegistryPlaybook: async () => {},
  assertTemplateAcceptsExtraVars: async () => {},
  BEKLENEN_PLAYBOOK: {
    app_retirement_stop: 'app_retirement_stop.yml',
    app_retirement_delete: 'app_retirement_delete.yml',
  },
});
const AWX = { durum: null, hata: null, cagri: [] };
sahte('../../ansible/runner.cjs', {
  redactSecrets: (s) => s,
  getServerById: () => ({ id: 2 }),
  launchJobOnServer: async () => ({ jobId: 1 }),
  getJobStatusOnServer: async (...a) => {
    AWX.cagri.push(a);
    if (AWX.hata) throw AWX.hata;
    return AWX.durum;
  },
});

const { initRetirement } = require('../index.cjs');
const kurtarma = require('../orphan-recovery.cjs');
let router = null;
initRetirement({
  use: (yol, r) => {
    if (yol === '/api/retirement') router = r;
  },
});

function istek(url, body = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        resolve(this);
        return this;
      },
      setHeader() {},
      getHeader() {},
    };
    router.handle(
      {
        method: 'POST',
        url,
        headers: {},
        body,
        session: { user: { username: 'adm1', role: 'Admin' } },
        query: {},
      },
      res,
      (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }),
    );
  });
}

const hedef = (ek = {}) => ({
  id: 11,
  record_id: 37,
  host: 'ORJEXP01',
  site: 'Pendik',
  env: 'PROD',
  app_name: 'ORPOSWEBAPI',
  jboss_gen: 7,
  app_path: '/vhosting/ORPOSWEBAPI.ear',
  status: 'stopping',
  last_job_id: null,
  delete_job_id: null,
  updated_at: '2026-11-24T10:00:00Z',
  ...ek,
});
const satir = (host, kod, ek = {}) => ({
  host,
  line: `${host}\tORPOSWEBAPI\t${kod}\tmesaj ${kod}`,
  ...ek,
});

beforeEach((t) => {
  D.kayit = {
    id: 37,
    app: 'ORPOSWEBAPI',
    smart_no: '364244',
    status: 'open',
    created_at: '2026-11-20T10:00:00Z',
  };
  D.hedefler = [hedef()];
  Object.assign(D, { isNo: 500, yazim: [], guncellenen: 1, olaylar: [], gecmis: null });
  Object.assign(AWX, { durum: null, hata: null, cagri: [] });
  REG.satir = { awxTemplateId: 61, awxServerId: 2 };
  denetim.length = 0;
  t.mock.method(console, 'warn', () => {});
});

const tazele = () => istek('/37/targets/11/refresh-status');

test('TU1 refresh-status: kayit / hedef / gecis durumu / is numarasi denetimi', async () => {
  let r = await istek('/99/targets/11/refresh-status');
  assert.deepEqual([r.statusCode, r.body.message], [400, 'Kayıt yok.']);
  r = await istek('/37/targets/12/refresh-status');
  assert.deepEqual([r.statusCode, r.body.message], [400, 'Hedef yok.']);
  D.hedefler = [hedef({ status: 'stopped' })];
  r = await tazele();
  assert.equal(r.statusCode, 400);
  assert.match(r.body.message, /"stopped" bir geçiş durumu değil/);
  D.hedefler = [hedef()];
  D.isNo = null;
  r = await tazele();
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.jobMissing, true);
  assert.equal(r.body.uncertainLaunch, true);
  assert.equal(AWX.cagri.length, 0, 'is numarasi yokken AWX okundu');
});

test('TU2 refresh-status: AWX okunamaz 502; is kosuyorsa degisiklik yok', async () => {
  AWX.hata = new Error('AWX yanit vermedi');
  let r = await tazele();
  assert.equal(r.statusCode, 502);
  assert.match(r.body.message, /AWX işi okunamadı \(#500\): AWX yanit vermedi/);
  AWX.hata = null;
  AWX.durum = { status: 'running', artifacts: {} };
  r = await tazele();
  assert.deepEqual(
    { degisti: r.body.degisti, jobId: r.body.jobId, jobStatus: r.body.jobStatus },
    { degisti: false, jobId: 500, jobStatus: 'running' },
  );
  assert.deepEqual(AWX.cagri[0], [2, 500], 'stop kaydinin AWX sunucusu kullanilmadi');
  assert.equal(D.yazim.length, 0);
});

test('TU3 refresh-status: terminal is hedefi sonuca gore gecirir', async () => {
  AWX.durum = {
    status: 'successful',
    artifacts: { app_retirement_stop_result: satir('ORJEXP01', 'OK') },
  };
  let r = await tazele();
  assert.deepEqual(
    [r.body.from, r.body.to, r.body.message],
    ['stopping', 'stopped', 'OK — mesaj OK'],
  );
  assert.match(D.yazim[0].s, /stopped_at = GETUTCDATE\(\)/);
  assert.deepEqual(
    D.yazim[0].params.slice(-2),
    [11, 'stopping'],
    'kosullu yazim (durum degismediyse)',
  );
  assert.match(D.olaylar[0][3], /stopping -> stopped \(iş #500, successful\)/);

  D.yazim = [];
  AWX.durum = {
    status: 'successful',
    artifacts: { app_retirement_stop_result: satir('ORJEXP01', 'FAIL') },
  };
  r = await tazele();
  assert.equal(r.body.to, 'failed');
  assert.ok(!/stopped_at/.test(D.yazim[0].s), 'basarisiz iste zaman damgasi yazildi');
  // Baska sunucunun sonucu bu hedefe yazilmaz.
  AWX.durum = {
    status: 'successful',
    artifacts: { app_retirement_stop_result: satir('BASKA01', 'OK') },
  };
  r = await tazele();
  assert.equal(r.body.to, 'failed');

  D.hedefler = [hedef({ status: 'deleting', delete_job_id: 700 })];
  AWX.durum = {
    status: 'successful',
    artifacts: { app_retirement_delete_result: satir('ORJEXP01', 'OK') },
  };
  D.yazim = [];
  r = await tazele();
  assert.equal(r.body.to, 'deleted');
  assert.match(D.yazim[0].s, /deleted_at = GETUTCDATE\(\)/);

  D.hedefler = [hedef({ status: 'planning' })];
  AWX.durum = {
    status: 'successful',
    artifacts: {
      app_retirement_stop_result: satir('ORJEXP01', 'PLAN', {
        plan_only: true,
        izinler: ['onay:stop'],
        steps: ['kontrol'],
      }),
    },
  };
  D.yazim = [];
  r = await tazele();
  assert.equal(r.body.to, 'planned');
  assert.match(D.yazim[0].s, /plan_text = \$3, detail_json = \$4, stop_izin_json = \$5/);
  assert.notEqual(D.yazim[0].params[4], null, 'basarili on kontrolde STOP izni yazilmadi');
  // Is basarisiz biterse sonucta izin olsa bile STOP izni yazilmaz.
  AWX.durum = {
    status: 'failed',
    artifacts: {
      app_retirement_stop_result: satir('ORJEXP01', 'PLAN', { izinler: ['onay:stop'] }),
    },
  };
  D.yazim = [];
  r = await tazele();
  assert.equal(r.body.to, 'failed');
  assert.equal(D.yazim[0].params[4], null, 'basarisiz on kontrol STOP izni verdi');
});

test('TU4 reconcile-job: dogrulama, kurtarma reddi, yaris', async (t) => {
  const uzlas = (body, tid = 11) => istek(`/37/targets/${tid}/reconcile-job`, body);
  assert.equal((await uzlas({ jobId: 'x' })).statusCode, 400);
  assert.equal((await istek('/99/targets/11/reconcile-job', { jobId: 900 })).statusCode, 400);
  assert.equal((await uzlas({ jobId: 900 }, 12)).statusCode, 400);
  D.hedefler = [hedef({ status: 'stopped' })];
  let r = await uzlas({ jobId: 900 });
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /bu durumda uzlaştırılamaz \(stopped\)/);
  D.hedefler = [hedef()];
  REG.satir = { awxTemplateId: null, awxServerId: 2 };
  r = await uzlas({ jobId: 900 });
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /etkin template bilgisi yok/);
  REG.satir = { awxTemplateId: 61, awxServerId: 2, enabled: false };
  r = await uzlas({ jobId: 900 });
  assert.equal(r.statusCode, 409, 'pasif kayitla uzlastirildi');
  assert.match(r.body.message, /etkin template bilgisi yok/);

  REG.satir = { awxTemplateId: 61, awxServerId: 2 };
  AWX.durum = { jobId: 900, status: 'running' };
  const dogrula = t.mock.method(kurtarma, 'validateRecovery', () => ({
    ok: false,
    reason: 'Smart numarası eşleşmiyor.',
  }));
  r = await uzlas({ jobId: 900 });
  assert.deepEqual([r.statusCode, r.body.message], [409, 'Smart numarası eşleşmiyor.']);
  const girdi = dogrula.mock.calls[0].arguments[0];
  assert.deepEqual(
    [girdi.kind, girdi.expectedServerId, girdi.expectedTemplateId, girdi.expectedPlaybook],
    ['stop', 2, 61, 'app_retirement_stop.yml'],
  );
  assert.equal(D.yazim.length, 0, 'reddedilen uzlastirma yazdi');

  dogrula.mock.mockImplementation(() => ({
    ok: true,
    field: 'last_job_id',
    jobId: 900,
    status: 'stopping',
  }));
  D.guncellenen = 0;
  r = await uzlas({ jobId: 900 });
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /Hedef bu arada değişti/);
  assert.match(D.yazim[0].s, /last_job_id IS NULL/);
  assert.match(D.yazim[0].s, /UPDLOCK, HOLDLOCK/);
});

test('TU5 reconcile-job: basari olay ve denetim yazar; AWX hatasi 502', async (t) => {
  AWX.durum = { jobId: 900, status: 'running' };
  t.mock.method(kurtarma, 'validateRecovery', () => ({
    ok: true,
    field: 'last_job_id',
    jobId: 900,
    status: 'stopping',
  }));
  let r = await istek('/37/targets/11/reconcile-job', { jobId: 900 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.jobId, 900);
  assert.equal(r.body.jobStatus, 'running');
  assert.ok(r.body.record, 'guncel kayit donmedi');
  assert.deepEqual(D.yazim[0].params, [900, 11, 37, 'stopping', 'stop']);
  assert.equal(D.olaylar[0][2], 'reconcile');
  assert.match(D.olaylar[0][3], /STOP orphan claim, doğrulanmış AWX işi #900/);
  assert.deepEqual(denetim.at(-1), {
    olay: 'retirement_orphan_reconcile',
    detay: { id: 37, tid: 11, kind: 'stop', jobId: 900, serverId: 2, templateId: 61 },
  });
  D.hedefler = [hedef({ status: 'deleting' })];
  AWX.hata = new Error('AWX 500');
  r = await istek('/37/targets/11/reconcile-job', { jobId: 901 });
  assert.equal(r.statusCode, 502);
  assert.match(r.body.message, /AWX işi doğrulanamadı: AWX 500/);
});
