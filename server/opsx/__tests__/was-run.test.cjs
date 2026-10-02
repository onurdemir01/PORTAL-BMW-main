// server/opsx/__tests__/was-run.test.cjs - OpsX WAS uclari (2026-10-02).
//
// GERCEK Express rotalari (server/opsx/was.cjs) sahte DB / envanter / AWX ile kosturulur.
// Kilitlenen kurallar (tasarim (4) "was-run.test.cjs" listesi + kilit + yetki):
//   W1  onay kutusu VE JVM adinin elle yazilmasi zorunlu
//   W2  dizi halinde host / coklu hedef -> 400 (toplu islem yok)
//   W3  envanterde olmayan host -> 400
//   W4  baska kullanicinin kesif sonucu -> 403
//   W5  OLCULEMEDI / COKLU_SUREC / kimlik yok / tutarsiz olcum -> 409
//   W6  kilit doluyken (ayni uygulama, BASKA host) -> 409; is bitince kilit kendiliginden duser
//   W7  AWX'e limit HIC gonderilmez
//   W8  kisitli uygulamada User 403, Admin gecer
//   ... ve server===app, 15 dk, durum kapisi, ASKIDA onayi, durum ucu sahipligi (fail-closed),
//   sonuc denetimi tek sefer, sonuc yoksa OLCULEMEDI.
// Duzeltici turu (2026-10-02, dogrulanmis bulgularin tersleri; her biri mutasyonla dogrulandi):
//   W23 kilit is BITMEDEN birakilmaz   W24 sonradan kisitlanan uygulama   W25 kesif baglama
//   W26 bayat kesif (LB cifti) 409 kesif_eski   W27 sonuc denetimi genel uctan bagimsiz
//   W28 uzlastirici (sekme kapali)   W29 gecmis yazilamazsa sahiplik yedegi + acik uyari
//   W30 baska istegin sonucu OLCULEMEDI   W31 ackWarnings yalniz boolean true
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const db = require('../../db/index.cjs');
const inventoryDb = require('../../inventory/mssql.cjs');
const runner = require('../../ansible/runner.cjs');
const auditMod = require('../../audit/index.cjs');
const { flatten } = require('../../util/guard-text.cjs');

// ── SAHTE DUNYA ──────────────────────────────────────────────────────────────
const ALI = { username: 'ali', role: 'User', groups: [] };
const VELI = { username: 'veli', role: 'User', groups: [] };
const ADMIN = { username: 'admin1', role: 'Admin', groups: [] };

const INV = [
  { app: 'APPX', host: 'gbwasp01', env: 'PROD', os: 'LINUX', was_version: '9.0.5.24', status: 'running' },
  { app: 'APPX', host: 'GBWASP02', env: 'PROD', os: 'LINUX', was_version: '9.0.5.24', status: 'running' },
  { app: 'APPX', host: 'GBWASA01', env: 'PROD', os: 'AIX', was_version: '8.5.5', status: 'running' },
  { app: 'KISITLI', host: 'GBWASP01', env: 'TEST', os: 'LINUX', was_version: '9.0.5', status: 'running' },
  { app: 'NOAPP', host: 'GBWASP03', env: 'PROD', os: 'LINUX', was_version: '9.0.5', status: 'stopped' },
  ...Array.from({ length: 11 }, (_, i) => ({
    app: 'BUYUK',
    host: `GBBUY${String(i + 1).padStart(2, '0')}`,
    env: 'TEST',
    os: 'LINUX',
    was_version: '9.0.5',
    status: 'running',
  })),
];

const S = {};
function reset() {
  S.history = [];
  S.ops = new Map();
  S.locks = new Map();
  S.jobs = new Map();
  S.launches = [];
  S.audits = [];
  S.failDb = null;
  S.poolDown = false;
  S.restricted = new Set(['KISITLI']);
  S.nextJobId = 5000;
  S.templates = [
    { id: 101, name: 'was-discover', playbook: 'bmw_portal/opsx_was/opsx_was_discover.yml', ask_variables: true },
    { id: 102, name: 'was-operation', playbook: 'bmw_portal/opsx_was/opsx_was_operation.yml', ask_variables: true },
  ];
  S.registry = {
    opsx_was_discover: {
      key_name: 'opsx_was_discover',
      enabled: 1,
      awx_template_id: 101,
      awx_server_id: 1,
      playbook_path: 'server/ansible/bmw_portal/opsx_was/opsx_was_discover.yml',
      env_var_name: 'OPSX_WAS_DISCOVER_TEMPLATE_ID',
    },
    opsx_was_operation: {
      key_name: 'opsx_was_operation',
      enabled: 1,
      awx_template_id: 102,
      awx_server_id: 1,
      playbook_path: 'server/ansible/bmw_portal/opsx_was/opsx_was_operation.yml',
      env_var_name: 'OPSX_WAS_OPERATION_TEMPLATE_ID',
    },
  };
}
reset();

const jobKey = (sid, jid) => `${sid}:${jid}`;

// Kilit tablosunun BEKLENEN anlami. CAS kosulu SQL metninden okunur: kosul silinirse
// (mutasyon) bu sahte DB de kosulsuz yazar ve W6 kirmiziya doner.
const CAS_GUARD = /AND \(held IS NULL OR held = 0 OR locked_until IS NULL OR locked_until < GETUTCDATE\(\)\)/;
// last_op_finished_at yalniz SQL metninde ileri-gitme CASE'i varsa yazilir (mutasyon: CASE
// silinirse zaman hic kaydedilmez ve bayat kesif bekcisi kirmiziya doner).
const LAST_OP_CASE = /last_op_finished_at = CASE WHEN \$3 IS NOT NULL AND \(last_op_finished_at IS NULL OR last_op_finished_at < \$3\) THEN \$3 ELSE last_op_finished_at END/;
function sonIslemYaz(row, s, fin) {
  if (LAST_OP_CASE.test(s) && fin && (!row.last_op_finished_at || row.last_op_finished_at < fin)) {
    row.last_op_finished_at = fin;
  }
}
const opsKey = (sid, jid) => `${sid}:${jid}`;

const origQuery = db.query;
db.query = async (sql, params = []) => {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (S.failDb && S.failDb.test(s)) throw new Error('DB erisilemiyor (test)');
  if (/FROM ansible_playbook_registry WHERE key_name = \$1/.test(s)) {
    const r = S.registry[params[0]];
    return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
  }
  if (/FROM logx_v2_restrictions r/.test(s)) {
    if (/r\.resource_key = \$2/.test(s)) {
      return {
        rows: S.restricted.has(params[1]) ? [{ id: 1, username: 'yetkili', group_dn: null }] : [],
      };
    }
    return {
      rows: [...S.restricted].map((k) => ({ resource_key: k, username: 'yetkili', group_dn: null })),
    };
  }
  if (/logx_v2_restriction_owners/.test(s)) return { rows: [] };
  if (/^SELECT TOP 1 username FROM ansible_job_history WHERE job_id = \$1 AND awx_server_id = \$2/.test(s)) {
    const h = S.history.find((x) => x.job_id === params[0] && x.awx_server_id === params[1]);
    return { rows: h ? [{ username: h.username }] : [] };
  }
  if (/^SELECT TOP 1 params FROM ansible_job_history WHERE job_id = \$1 AND awx_server_id = \$2/.test(s)) {
    const h = S.history.find((x) => x.job_id === params[0] && x.awx_server_id === params[1]);
    return { rows: h ? [{ params: h.params }] : [] };
  }
  if (/^INSERT INTO ansible_job_history/.test(s)) {
    const [username, awx_server_id, template_id, template_name, job_id, status, p] = params;
    S.history.push({ username, awx_server_id, template_id, template_name, job_id, status, params: p, finished_at: null });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE ansible_job_history SET status = \$3, finished_at = COALESCE\(finished_at, GETUTCDATE\(\)\)/.test(s)) {
    let n = 0;
    for (const h of S.history) {
      if (h.job_id === params[0] && h.awx_server_id === params[1] && (h.finished_at == null || h.status !== params[2])) {
        h.finished_at = h.finished_at ?? Date.now();
        h.status = params[2];
        n++;
      }
    }
    return { rows: [], rowCount: n };
  }
  // opsx_was_ops (islem kaydi + sonuc denetimi isareti)
  if (/^INSERT INTO opsx_was_ops \(awx_server_id, awx_job_id, request_id, username, params\) SELECT/.test(s)) {
    const k = opsKey(params[0], params[1]);
    if (S.ops.has(k)) return { rows: [], rowCount: 0 };
    S.ops.set(k, { awx_server_id: params[0], awx_job_id: params[1], request_id: params[2], username: params[3], params: params[4], audited_at: null });
    return { rows: [], rowCount: 1 };
  }
  if (/^INSERT INTO opsx_was_ops \(awx_server_id, awx_job_id, result,/.test(s)) {
    const k = opsKey(params[0], params[1]);
    if (S.ops.has(k)) return { rows: [], rowCount: 0 };
    S.ops.set(k, {
      awx_server_id: params[0], awx_job_id: params[1], result: params[2], before_state: params[3], after_state: params[4],
      awx_status: params[5], awx_finished: params[6], request_id: params[7], username: params[8], params: params[9],
      audited_at: Date.now(),
    });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE opsx_was_ops SET result = \$3/.test(s)) {
    const row = S.ops.get(opsKey(params[0], params[1]));
    if (!row || (/AND audited_at IS NULL/.test(s) && row.audited_at != null)) return { rows: [], rowCount: 0 };
    Object.assign(row, { result: params[2], before_state: params[3], after_state: params[4], awx_status: params[5], awx_finished: params[6], audited_at: Date.now() });
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT TOP 1 username, params, audited_at FROM opsx_was_ops/.test(s)) {
    const row = S.ops.get(opsKey(params[0], params[1]));
    return { rows: row ? [{ ...row }] : [] };
  }
  if (/^SELECT TOP 50 awx_server_id, awx_job_id FROM opsx_was_ops WHERE audited_at IS NULL/.test(s)) {
    return { rows: [...S.ops.values()].filter((r) => r.audited_at == null) };
  }
  if (/^SELECT TOP 50 awx_server_id, awx_job_id FROM opsx_was_locks WHERE held = 1/.test(s)) {
    return { rows: [...S.locks.values()].filter((r) => r.held && r.awx_job_id != null) };
  }
  if (/^IF NOT EXISTS \(SELECT 1 FROM opsx_was_locks WHERE lock_key = \$1\)/.test(s)) {
    if (!S.locks.has(params[0])) S.locks.set(params[0], { held: 0 });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE opsx_was_locks SET held = 1/.test(s)) {
    const row = S.locks.get(params[0]);
    if (!row) return { rows: [], rowCount: 0 };
    const free = !row.held || row.locked_until == null || row.locked_until < Date.now();
    if (CAS_GUARD.test(s) && !free) return { rows: [], rowCount: 0 };
    Object.assign(row, {
      held: 1,
      holder: params[1],
      lock_id: params[2],
      target_desc: params[3],
      locked_until: Date.now() + Number(params[4]) * 60000,
      awx_server_id: null,
      awx_job_id: null,
    });
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT TOP 1 lock_key, held, holder/.test(s)) {
    const row = S.locks.get(params[0]);
    return { rows: row ? [{ lock_key: params[0], ...row }] : [] };
  }
  if (/^UPDATE opsx_was_locks SET held = 0, updated_at = GETUTCDATE\(\).* WHERE lock_key = \$1 AND lock_id = \$2 AND held = 1/.test(s)) {
    const row = S.locks.get(params[0]);
    if (row && row.lock_id === params[1] && row.held) {
      row.held = 0;
      sonIslemYaz(row, s, params[2]);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/^UPDATE opsx_was_locks SET awx_server_id = \$3, awx_job_id = \$4/.test(s)) {
    const row = S.locks.get(params[0]);
    if (row && row.lock_id === params[1] && row.held) {
      row.awx_server_id = params[2];
      row.awx_job_id = params[3];
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/WHERE awx_server_id = \$1 AND awx_job_id = \$2 AND held = 1/.test(s)) {
    let n = 0;
    for (const row of S.locks.values()) {
      if (row.held && row.awx_server_id === params[0] && row.awx_job_id === params[1]) {
        row.held = 0;
        sonIslemYaz(row, s, params[2]);
        n++;
      }
    }
    return { rows: [], rowCount: n };
  }
  if (/^SELECT TOP 1 holder, target_desc, awx_job_id, locked_until FROM opsx_was_locks/.test(s)) {
    const row = S.locks.get(params[0]);
    return {
      rows: row && row.held && row.locked_until > Date.now() ? [{ ...row }] : [],
    };
  }
  throw new Error(`beklenmeyen sorgu: ${s.slice(0, 140)}`);
};

const origPool = inventoryDb.getPool;
inventoryDb.getPool = async () => {
  if (S.poolDown) return null;
  return {
    request: () => {
      const inputs = {};
      return {
        input(k, v) {
          inputs[k] = v;
        },
        query: async (sql) => {
          if (/SELECT DISTINCT TOP/.test(sql)) {
            const q = String(inputs.q || '').replace(/%/g, '').toUpperCase();
            const apps = [...new Set(INV.map((r) => r.app))].filter((a) => a.includes(q)).sort();
            return { recordset: apps.map((app) => ({ app })) };
          }
          if (/WHERE app = @app/.test(sql)) {
            return { recordset: INV.filter((r) => r.app === inputs.app) };
          }
          throw new Error(`beklenmeyen envanter sorgusu: ${sql}`);
        },
      };
    },
  };
};

const orig = {
  launch: runner.launchJobOnServer,
  status: runner.getJobStatusOnServer,
  output: runner.getJobOutputOnServer,
  servers: runner.getServers,
  templates: runner.listTemplatesForServer,
  audit: auditMod.auditPortal,
};
runner.launchJobOnServer = async (serverId, templateId, extraVars, limit, requester) => {
  const jobId = ++S.nextJobId;
  S.launches.push({ serverId, templateId, extraVars, limit, requester, jobId });
  S.jobs.set(jobKey(serverId, jobId), { status: 'pending', artifacts: {} });
  return { jobId, status: 'pending' };
};
runner.getJobStatusOnServer = async (sid, jid) => {
  const j = S.jobs.get(jobKey(sid, jid));
  if (!j) throw Object.assign(new Error('AWX job yok'), { status: 404 });
  return { jobId: jid, status: j.status, started: j.started, finished: j.finished, playbook: j.playbook, artifacts: j.artifacts || {} };
};
runner.getJobOutputOnServer = async () => ({ output: 'TASK [x] cmd: wsadmin -password Gizli123 bitti' });
runner.getServers = () => [{ id: 1, url: 'https://awx.test' }];
runner.listTemplatesForServer = async () => S.templates;
auditMod.auditPortal = (req, action, opts = {}) => {
  S.audits.push({ action, user: req?.session?.user?.username, ...opts });
};

let server;
let base;
before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    const u = req.headers['x-test-user'];
    if (u) req.session = { user: JSON.parse(String(u)) };
    next();
  });
  const requireAuth = (req, res, next) =>
    req.session?.user ? next() : res.status(401).json({ ok: false });
  require('../was.cjs').initOpsXWas(app, { requireAuth, reconcile: false });
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  db.query = origQuery;
  inventoryDb.getPool = origPool;
  runner.launchJobOnServer = orig.launch;
  runner.getJobStatusOnServer = orig.status;
  runner.getJobOutputOnServer = orig.output;
  runner.getServers = orig.servers;
  runner.listTemplatesForServer = orig.templates;
  auditMod.auditPortal = orig.audit;
  server && server.close();
});

beforeEach(() => reset());

function istek(method, url, user, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      `${base}${url}`,
      {
        method,
        headers: {
          ...(user ? { 'x-test-user': JSON.stringify(user) } : {}),
          ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(b);
          } catch {
            /* govde JSON degil */
          }
          resolve({ status: res.statusCode, body: json, raw: b });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Varsayilan kesif sonucu: APPX iki hostta RUNNING; ayni hostta BASKA bir uygulamanin
// JVM'i de var (istemciye adi SIZMAMALI).
function kesifSonucu(mut) {
  const r = {
    hosts: [
      {
        host: 'GBWASP01',
        overall: 'ok',
        reason: '',
        profiles: [
          {
            profile: 'AppSrv01',
            cell: 'CELL01',
            node: 'NODE01',
            kimlik: 'var',
            servers: [
              { server: 'APPX', cluster: 'CL_APPX', state: 'RUNNING', pids: 1, ss: 'UP', reason: '' },
              { server: 'GIZLIAPP', cluster: '', state: 'RUNNING', pids: 1, ss: 'UP', reason: '' },
            ],
          },
        ],
      },
      {
        host: 'GBWASP02',
        overall: 'ok',
        reason: '',
        profiles: [
          {
            profile: 'AppSrv01',
            cell: 'CELL02',
            node: 'NODE02',
            kimlik: 'var',
            servers: [{ server: 'APPX', cluster: 'CL_APPX', state: 'RUNNING', pids: 1, ss: 'UP', reason: '' }],
          },
        ],
      },
    ],
  };
  if (mut) mut(r);
  return r;
}

// Kesfi GERCEK uctan baslatir, sonra AWX isini bitmis gosterir.
async function kesifYap(user, { app = 'APPX', hosts, sonuc = kesifSonucu(), onceMs = 60_000, status = 'successful', playbook } = {}) {
  const r = await istek('POST', '/api/opsx/was/discover', user, { app, ...(hosts ? { hosts } : {}) });
  assert.equal(r.status, 200, `kesif baslatilamadi: ${r.raw}`);
  const j = S.jobs.get(jobKey(r.body.awxServerId, r.body.jobId));
  j.status = status;
  j.finished = new Date(Date.now() - onceMs).toISOString();
  j.started = new Date(Date.now() - onceMs - 5000).toISOString();
  j.playbook = playbook || 'bmw_portal/opsx_was/opsx_was_discover.yml';
  j.artifacts = sonuc ? { opsx_was_discover_result: sonuc } : {};
  return { discoverJobId: r.body.jobId, discoverServerId: r.body.awxServerId };
}

function govde(k, over = {}) {
  return {
    app: 'APPX',
    host: 'GBWASP01',
    profile: 'AppSrv01',
    cell: 'CELL01',
    node: 'NODE01',
    server: 'APPX',
    operation: 'restart',
    confirmed: true,
    confirmText: 'APPX',
    ...k,
    ...over,
  };
}

const islemLaunchlari = () => S.launches.filter((l) => l.templateId === 102);

// ── TESTLER ─────────────────────────────────────────────────────────────────

test('W1 onay kutusu ve JVM adinin elle yazilmasi zorunlu', async () => {
  const k = await kesifYap(ALI);
  for (const over of [
    { confirmed: undefined },
    { confirmed: 'true' },
    { confirmText: undefined },
    { confirmText: 'appx' },
    { confirmText: 'APPX2' },
  ]) {
    const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, over));
    assert.equal(r.status, 400, `${JSON.stringify(over)} -> ${r.status} ${r.raw}`);
  }
  assert.equal(islemLaunchlari().length, 0, 'onaysiz istek is baslatti');
});

test('W2 dizi halinde host ya da coklu hedef reddedilir (toplu islem yok)', async () => {
  const k = await kesifYap(ALI);
  for (const over of [
    { host: ['GBWASP01'] },
    { host: ['GBWASP01', 'GBWASP02'] },
    { hosts: ['GBWASP01'] },
    { targets: [{ host: 'GBWASP01' }] },
    { server: ['APPX'] },
  ]) {
    const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, over));
    assert.equal(r.status, 400, `${JSON.stringify(over)} -> ${r.status} ${r.raw}`);
  }
  assert.equal(islemLaunchlari().length, 0);
});

test('W3 envanterde olmayan ya da AIX host reddedilir', async () => {
  const k = await kesifYap(ALI);
  let r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { host: 'GBYABANCI01' }));
  assert.equal(r.status, 400, r.raw);
  assert.match(r.body.message, /envanterinde yok/);
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { host: 'GBWASA01' }));
  assert.equal(r.status, 400, r.raw);
  assert.equal(islemLaunchlari().length, 0);
});

test('W4 baska kullanicinin kesif sonucu kullanilamaz (Admin dahil)', async () => {
  const kVeli = await kesifYap(VELI);
  let r = await istek('POST', '/api/opsx/was/run', ALI, govde(kVeli));
  assert.equal(r.status, 403, r.raw);
  r = await istek('POST', '/api/opsx/was/run', ADMIN, govde(kVeli));
  assert.equal(r.status, 403, `Admin bile baskasinin kesfiyle islem yapamaz (TOCTOU): ${r.raw}`);
  assert.equal(islemLaunchlari().length, 0);
});

test('W5 olculemeyen / coklu surec / kimliksiz / tutarsiz hedefte 409, is acilmaz', async () => {
  const durumlar = [
    ['OLCULEMEDI', (s) => Object.assign(s, { state: 'OLCULEMEDI', pids: 1, ss: '?' })],
    ['COKLU_SUREC', (s) => Object.assign(s, { state: 'COKLU_SUREC', pids: 2, ss: 'UP' })],
    // Playbook STOPPED dedi ama surec var: tablo (3) ile celisir -> OLCULEMEDI.
    ['tutarsiz', (s) => Object.assign(s, { state: 'STOPPED', pids: 1, ss: 'ULASILAMIYOR' })],
    // Bilinmeyen durum adi -> OLCULEMEDI (asla STOPPED degil).
    ['bilinmeyen', (s) => Object.assign(s, { state: 'DURDU', pids: 0, ss: 'ULASILAMIYOR' })],
  ];
  for (const [ad, mut] of durumlar) {
    reset();
    const k = await kesifYap(ALI, { sonuc: kesifSonucu((x) => mut(x.hosts[0].profiles[0].servers[0])) });
    for (const operation of ['restart', 'stop', 'start']) {
      const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation, ackWarnings: true }));
      assert.equal(r.status, 409, `${ad}/${operation}: ${r.status} ${r.raw}`);
    }
    assert.equal(islemLaunchlari().length, 0, `${ad}: is acildi`);
  }
  // Kimlik yok: olcum RUNNING olsa bile islem YAPILMAZ (K2-a).
  reset();
  const k = await kesifYap(ALI, { sonuc: kesifSonucu((x) => (x.hosts[0].profiles[0].kimlik = 'yok')) });
  const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { ackWarnings: true }));
  assert.equal(r.status, 409, r.raw);
  assert.match(r.body.message, /kimli/i);
  // Host olculemedi: altindaki JVM RUNNING bildirilse de 409.
  reset();
  const k2 = await kesifYap(ALI, { sonuc: kesifSonucu((x) => (x.hosts[0].overall = 'olculemedi')) });
  const r2 = await istek('POST', '/api/opsx/was/run', ALI, govde(k2, { ackWarnings: true }));
  assert.equal(r2.status, 409, r2.raw);
  assert.equal(islemLaunchlari().length, 0);
});

test('W6 kilit: ayni uygulamanin baska hostunda is surerken 409; is bitince kilit duser', async () => {
  const kAli = await kesifYap(ALI);
  const ilk = await istek('POST', '/api/opsx/was/run', ALI, govde(kAli));
  assert.equal(ilk.status, 200, ilk.raw);

  // Ayni JVM'e ikinci istek
  let r = await istek('POST', '/api/opsx/was/run', ALI, govde(kAli));
  assert.equal(r.status, 409, r.raw);

  // Baska kullanici, AYNI uygulama, BASKA host
  const kVeli = await kesifYap(VELI);
  r = await istek('POST', '/api/opsx/was/run', VELI, govde(kVeli, { host: 'GBWASP02', cell: 'CELL02', node: 'NODE02' }));
  assert.equal(r.status, 409, r.raw);
  assert.equal(r.body.lock?.scope, 'app', 'uygulama kilidi raporlanmadi');
  assert.equal(islemLaunchlari().length, 1);

  // Ilk is AWX'te bitti ama kimse durum ucunu okumadi: bayat kilit bir sonraki denemede
  // AWX'e sorularak birakilir VE isin bitis zamani kaydedilir. VELI'nin kesfi ALI'nin isi
  // BITMEDEN baslamisti: 01'i hala "calisiyor" gosterir -> bayat kesif, 409 kesif_eski.
  const ilkIs = S.jobs.get(jobKey(ilk.body.awxServerId, ilk.body.jobId));
  ilkIs.status = 'successful';
  ilkIs.finished = new Date(Date.now() - 30_000).toISOString();
  r = await istek('POST', '/api/opsx/was/run', VELI, govde(kVeli, { host: 'GBWASP02', cell: 'CELL02', node: 'NODE02' }));
  assert.equal(r.status, 409, r.raw);
  assert.equal(r.body.code, 'kesif_eski', r.raw);
  assert.equal(S.locks.get('A|APPX').last_op_finished_at, ilkIs.finished, 'son islem zamani kaydedilmedi');
  assert.equal(S.locks.get('A|APPX').held, 0, 'reddedilen istek uygulama kilidini tutuyor');
  // ALI'nin isinden SONRA baslayan taze kesifle gecer.
  const kTaze = await kesifYap(VELI, { onceMs: 1000 });
  r = await istek('POST', '/api/opsx/was/run', VELI, govde(kTaze, { host: 'GBWASP02', cell: 'CELL02', node: 'NODE02' }));
  assert.equal(r.status, 200, r.raw);
  // Hicbir kilit satiri SILINMEDI.
  assert.ok(S.locks.has('A|APPX'));
});

test('W6b kilit DB hatasi: islem REDDEDILIR (503), is acilmaz', async () => {
  const k = await kesifYap(ALI);
  S.failDb = /opsx_was_locks/;
  const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(r.status, 503, r.raw);
  assert.equal(islemLaunchlari().length, 0);
});

test("W7 AWX'e limit HIC gonderilmez (kesif ve islem)", async () => {
  const k = await kesifYap(ALI);
  const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(r.status, 200, r.raw);
  assert.ok(S.launches.length >= 2);
  for (const l of S.launches) {
    assert.equal(l.limit, '', `launch limit gonderdi: ${JSON.stringify(l.limit)}`);
    assert.ok(!('limit' in l.extraVars), 'extra_vars icinde limit var');
  }
  assert.ok(!('limit' in r.body.sentBody), 'yanitta limit gorunuyor');
});

test('W8 kisitli uygulama: User 403 (hosts/discover/run), Admin gecer', async () => {
  let r = await istek('GET', '/api/opsx/was/hosts?app=KISITLI', ALI);
  assert.equal(r.status, 403, r.raw);
  r = await istek('POST', '/api/opsx/was/discover', ALI, { app: 'KISITLI' });
  assert.equal(r.status, 403, r.raw);
  r = await istek('POST', '/api/opsx/was/run', ALI, govde({ discoverJobId: 1, discoverServerId: 1 }, { app: 'KISITLI', server: 'KISITLI', confirmText: 'KISITLI' }));
  assert.equal(r.status, 403, r.raw);
  assert.equal(S.launches.length, 0);

  r = await istek('GET', '/api/opsx/was/hosts?app=KISITLI', ADMIN);
  assert.equal(r.status, 200, r.raw);
  const sonuc = {
    hosts: [
      {
        host: 'GBWASP01',
        overall: 'ok',
        reason: '',
        profiles: [
          {
            profile: 'AppSrv01',
            cell: 'CELL01',
            node: 'NODE01',
            kimlik: 'var',
            servers: [{ server: 'KISITLI', cluster: '', state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR', reason: '' }],
          },
        ],
      },
    ],
  };
  const k = await kesifYap(ADMIN, { app: 'KISITLI', sonuc });
  r = await istek('POST', '/api/opsx/was/run', ADMIN, govde(k, { app: 'KISITLI', server: 'KISITLI', confirmText: 'KISITLI', operation: 'start' }));
  assert.equal(r.status, 200, r.raw);
});

test('W8b kisit karari HATA alirsa REDDEDILIR (503)', async () => {
  S.failDb = /logx_v2_restrictions/;
  const r = await istek('GET', '/api/opsx/was/hosts?app=APPX', ALI);
  assert.equal(r.status, 503, r.raw);
  const r2 = await istek('GET', '/api/opsx/was/apps?search=', ALI);
  assert.equal(r2.status, 503, r2.raw);
});

test('W9 JVM adi uygulamayla birebir ayni olmali', async () => {
  const k = await kesifYap(ALI);
  const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { server: 'GIZLIAPP', confirmText: 'GIZLIAPP' }));
  assert.equal(r.status, 400, r.raw);
  assert.equal(islemLaunchlari().length, 0);
});

test('W10 15 dakikadan eski ya da bitmemis kesif kabul edilmez', async () => {
  let k = await kesifYap(ALI, { onceMs: 16 * 60_000 });
  let r = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(r.status, 409, r.raw);
  reset();
  k = await kesifYap(ALI, { status: 'running' });
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(r.status, 409, r.raw);
  reset();
  // Baska playbook'la kosmus bir is "kesif" diye gonderilemez.
  k = await kesifYap(ALI, { playbook: 'bmw_portal/baska/baska.yml' });
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(r.status, 409, r.raw);
  assert.equal(islemLaunchlari().length, 0);
});

test('W11 islem-durum kapisi: STOPPED -> yalniz start, RUNNING -> stop/restart', async () => {
  const stopped = kesifSonucu((x) => Object.assign(x.hosts[0].profiles[0].servers[0], { state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR' }));
  let k = await kesifYap(ALI, { sonuc: stopped });
  for (const operation of ['stop', 'restart']) {
    const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation, ackWarnings: true }));
    assert.equal(r.status, 409, `${operation}: ${r.raw}`);
  }
  let r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'start' }));
  assert.equal(r.status, 200, r.raw);
  reset();
  k = await kesifYap(ALI);
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'start' }));
  assert.equal(r.status, 409, r.raw);
});

test('W12 ASKIDA ve SON_CALISAN uyarilari onaysiz gecmez', async () => {
  const askida = kesifSonucu((x) => Object.assign(x.hosts[0].profiles[0].servers[0], { state: 'ASKIDA', pids: 1, ss: 'ULASILAMIYOR' }));
  let k = await kesifYap(ALI, { sonuc: askida });
  let r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  assert.equal(r.status, 409, r.raw);
  assert.ok(r.body.warnings.some((w) => w.code === 'ASKIDA'), r.raw);
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'start', ackWarnings: true }));
  assert.equal(r.status, 409, 'ASKIDA iken start izinli degil');
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop', ackWarnings: true }));
  assert.equal(r.status, 200, r.raw);

  // Diger hosttaki ornek DURMUS: bu JVM son calisan -> onay sart.
  reset();
  const son = kesifSonucu((x) => Object.assign(x.hosts[1].profiles[0].servers[0], { state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR' }));
  k = await kesifYap(ALI, { sonuc: son });
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  assert.equal(r.status, 409, r.raw);
  assert.ok(r.body.warnings.some((w) => w.code === 'SON_CALISAN'), r.raw);
  // Ikisi de calisirken uyari YOK, onaysiz gecer.
  reset();
  k = await kesifYap(ALI);
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  assert.equal(r.status, 200, r.raw);
});

test('W13 basarili akis: extra_vars sozlesmesi, gecmis, baslatma denetimi, kilit', async () => {
  const k = await kesifYap(ALI);
  const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop', host: 'gbwasp01' }));
  assert.equal(r.status, 200, r.raw);
  const l = islemLaunchlari()[0];
  assert.equal(l.templateId, 102);
  assert.deepEqual(Object.keys(l.extraVars).sort(), [
    'confirm_text',
    'consent',
    'operation',
    'opsx_request_id',
    'target_host',
    'was_cell',
    'was_node',
    'was_profile',
    'was_server',
  ]);
  assert.equal(l.extraVars.target_host, 'GBWASP01');
  assert.equal(typeof l.extraVars.target_host, 'string');
  assert.equal(l.extraVars.was_server, 'APPX');
  assert.equal(l.extraVars.confirm_text, 'APPX');
  assert.equal(l.extraVars.consent, true);
  assert.equal(l.extraVars.operation, 'stop');
  assert.equal(l.requester.username, 'ali');
  const h = S.history.find((x) => x.job_id === r.body.jobId);
  assert.ok(h, 'gecmis satiri yok');
  assert.equal(JSON.parse(h.params).platform, 'was-operation');
  assert.equal(JSON.parse(h.params).env, 'Production', 'env normalize edilmedi');
  const a = S.audits.find((x) => x.action === 'opsx_was_operation');
  assert.ok(a, 'baslatma denetimi yok');
  assert.equal(a.targetHost, 'GBWASP01');
  assert.equal(S.locks.get('A|APPX').held, 1);
  assert.equal(S.locks.get('T|GBWASP01|CELL01|NODE01|APPX').held, 1);
  assert.equal(S.locks.get('A|APPX').awx_job_id, r.body.jobId, 'kilit ise baglanmadi');
  assert.equal(r.body.historyWritten, true);
  const op = S.ops.get(opsKey(r.body.awxServerId, r.body.jobId));
  assert.ok(op && op.username === 'ali' && op.audited_at == null, 'islem kaydi (opsx_was_ops) yazilmadi');
  assert.equal(JSON.parse(op.params).request_id, r.body.requestId);
});

test('W14 islem durum ucu: sahiplik fail-closed, Admin gorur, terminalde kilit birakilir, sonuc denetimi TEK', async () => {
  const k = await kesifYap(ALI);
  const run = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(run.status, 200, run.raw);
  const url = `/api/opsx/was/run/${run.body.awxServerId}/${run.body.jobId}/status`;

  let r = await istek('GET', url, VELI);
  assert.equal(r.status, 403, r.raw);
  assert.ok(S.audits.some((x) => x.action === 'opsx_was_access_denied'));

  S.failDb = /FROM ansible_job_history/;
  r = await istek('GET', url, ALI);
  assert.equal(r.status, 503, `DB hatasinda sahiplik GECMEMELI: ${r.raw}`);
  S.failDb = null;

  r = await istek('GET', url, ALI);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.status, 'pending');
  assert.doesNotMatch(r.body.output, /Gizli123/, 'parola maskelenmedi');

  const job = S.jobs.get(jobKey(run.body.awxServerId, run.body.jobId));
  job.status = 'successful';
  job.artifacts = {
    opsx_was_op_result: {
      host: 'GBWASP01', profile: 'AppSrv01', cell: 'CELL01', node: 'NODE01', server: 'APPX', op: 'restart',
      before: 'RUNNING', after: 'RUNNING', result: 'OK',
      steps: [{ step: 'stop', status: 'OK', msg: 'durdu' }, { step: 'start', status: 'OK', msg: 'basladi' }],
      line: 'RESULT\trestart\tOK\tRUNNING\tRUNNING\ttamam',
    },
  };
  r = await istek('GET', url, ADMIN);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.result.result, 'OK');
  assert.equal(r.body.severity, 'ok');
  assert.equal(S.locks.get('A|APPX').held, 0, 'kilit birakilmadi');
  assert.equal(S.locks.get('T|GBWASP01|CELL01|NODE01|APPX').held, 0);
  r = await istek('GET', url, ALI);
  assert.equal(r.status, 200);
  const sonuc = S.audits.filter((x) => x.action === 'opsx_was_result');
  assert.equal(sonuc.length, 1, 'sonuc denetimi her yoklamada tekrar yaziliyor');
  assert.equal(sonuc[0].username, 'ali', 'sonuc isi baslatana atfedilmeli');
  assert.equal(sonuc[0].result, 'ok');
});

test('W15 sonuc yoksa ya da tanimsizsa OLCULEMEDI (gercek durum bilinmiyor)', async () => {
  const k = await kesifYap(ALI);
  const run = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  const url = `/api/opsx/was/run/${run.body.awxServerId}/${run.body.jobId}/status`;
  const job = S.jobs.get(jobKey(run.body.awxServerId, run.body.jobId));
  job.status = 'failed';
  job.artifacts = {};
  let r = await istek('GET', url, ALI);
  assert.equal(r.body.result.result, 'OLCULEMEDI');
  assert.equal(r.body.severity, 'unknown');
  assert.match(r.body.message, /bilinmiyor/);
  const a = S.audits.find((x) => x.action === 'opsx_was_result');
  assert.equal(a.result, 'fail');

  reset();
  const k2 = await kesifYap(ALI);
  const run2 = await istek('POST', '/api/opsx/was/run', ALI, govde(k2));
  const job2 = S.jobs.get(jobKey(run2.body.awxServerId, run2.body.jobId));
  job2.status = 'failed';
  job2.artifacts = { opsx_was_op_result: { result: 'BELKI', before: 'RUNNING', after: 'DURDU' } };
  r = await istek('GET', `/api/opsx/was/run/${run2.body.awxServerId}/${run2.body.jobId}/status`, ALI);
  assert.equal(r.body.result.result, 'OLCULEMEDI');
  assert.equal(r.body.result.after, 'OLCULEMEDI', 'bilinmeyen son durum STOPPED/bos sayildi');
});

test('W16 kesif kurallari: en cok 10 host, AIX/NOAPP yok, envanter yoksa 503, limit yok', async () => {
  let r = await istek('POST', '/api/opsx/was/discover', ALI, { app: 'BUYUK' });
  assert.equal(r.status, 400, r.raw);
  r = await istek('POST', '/api/opsx/was/discover', ALI, { app: 'BUYUK', hosts: INV.filter((x) => x.app === 'BUYUK').slice(0, 10).map((x) => x.host) });
  assert.equal(r.status, 200, r.raw);
  r = await istek('POST', '/api/opsx/was/discover', ALI, { app: 'APPX', hosts: ['GBWASA01'] });
  assert.equal(r.status, 400, r.raw);
  r = await istek('POST', '/api/opsx/was/discover', ALI, { app: 'NOAPP' });
  assert.equal(r.status, 400, r.raw);
  r = await istek('POST', '/api/opsx/was/discover', ALI, { app: 'APPX' });
  assert.equal(r.status, 200, r.raw);
  const l = S.launches.at(-1);
  assert.equal(l.extraVars.target_hosts, 'GBWASP01,GBWASP02', 'AIX host kesfe girdi ya da bicim bozuk');
  // Suzgec = uygulama (JVM) adi: cok JVM'li hostta hedef JVM butce dolmadan olculur.
  assert.equal(l.extraVars.was_server_filter, 'APPX', 'kesif was_server_filter gondermiyor');
  assert.deepEqual(Object.keys(l.extraVars).sort(), ['target_hosts', 'was_server_filter']);
  assert.equal(l.limit, '');
  S.poolDown = true;
  r = await istek('POST', '/api/opsx/was/discover', ALI, { app: 'APPX' });
  assert.equal(r.status, 503, r.raw);
});

test('W17 uygulama listesi: NOAPP yok, kisitli uygulama yalniz Admin icin', async () => {
  let r = await istek('GET', '/api/opsx/was/apps?search=', ALI);
  assert.equal(r.status, 200, r.raw);
  assert.ok(r.body.apps.includes('APPX'));
  assert.ok(!r.body.apps.includes('NOAPP'));
  assert.ok(!r.body.apps.includes('KISITLI'));
  r = await istek('GET', '/api/opsx/was/apps?search=', ADMIN);
  assert.ok(r.body.apps.includes('KISITLI'));
});

test('W18 sunucu listesi: env normalize, AIX gorunur ama secilemez', async () => {
  const r = await istek('GET', '/api/opsx/was/hosts?app=APPX', ALI);
  assert.equal(r.status, 200, r.raw);
  const byHost = Object.fromEntries(r.body.hosts.map((h) => [h.host, h]));
  assert.equal(byHost.GBWASP01.env, 'Production');
  assert.equal(byHost.GBWASP01.envRaw, 'PROD');
  assert.equal(byHost.GBWASP01.selectable, true);
  assert.equal(byHost.GBWASA01.selectable, false);
  assert.match(byHost.GBWASA01.reason, /Linux/);
});

test('W19 kesif durumu: erisilemeyen host dusmez, baska uygulamanin JVM adi sizmaz', async () => {
  const sonuc = kesifSonucu((x) => x.hosts.splice(1, 1));
  const k = await kesifYap(ALI, { sonuc });
  const r = await istek('GET', `/api/opsx/was/discover/${k.discoverServerId}/${k.discoverJobId}/status`, ALI);
  assert.equal(r.status, 200, r.raw);
  const h2 = r.body.hosts.find((h) => h.host === 'GBWASP02');
  assert.ok(h2, 'sonucta olmayan host listeden dustu');
  assert.equal(h2.overall, 'olculemedi');
  assert.ok(r.body.targets.every((t) => t.server === 'APPX'));
  assert.doesNotMatch(r.raw, /GIZLIAPP/, 'baska uygulamanin JVM adi istemciye gitti');
  // baska kullanici bu kesfi okuyamaz
  const r2 = await istek('GET', `/api/opsx/was/discover/${k.discoverServerId}/${k.discoverJobId}/status`, VELI);
  assert.equal(r2.status, 403, r2.raw);
});

test('W20 template tanimsizsa 501, playbook uyusmazsa 409 - is acilmaz', async () => {
  const k = await kesifYap(ALI);
  S.registry.opsx_was_operation.awx_template_id = null;
  let r = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(r.status, 501, r.raw);
  S.registry.opsx_was_operation.awx_template_id = 102;
  S.templates[1].playbook = 'bmw_portal/java_app_ops/java_app_ops.yml';
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(r.status, 409, r.raw);
  assert.equal(islemLaunchlari().length, 0);
  assert.equal(S.locks.get('A|APPX')?.held || 0, 0, 'reddedilen istek kilit birakmadi');
});

test('W21 launch hatasinda kilit geri birakilir', async () => {
  const k = await kesifYap(ALI);
  const eski = runner.launchJobOnServer;
  runner.launchJobOnServer = async () => {
    throw Object.assign(new Error('AWX 500'), { status: 502 });
  };
  try {
    const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
    assert.equal(r.status, 502, r.raw);
  } finally {
    runner.launchJobOnServer = eski;
  }
  assert.equal(S.locks.get('A|APPX').held, 0);
  assert.equal(S.locks.get('T|GBWASP01|CELL01|NODE01|APPX').held, 0);
});

// Mutasyon turunda (2026-10-02) bulunan korluk: authorizeJob'daki is TIPI kontrolu
// silindiginde hicbir test kirmiziya donmuyordu. Tip kontrolu olmasa islem durum ucu bir
// KESIF isini "sonuc uretmedi -> OLCULEMEDI" diye kapatir, gecmis kaydini bitmis isaretler
// ve sahte bir opsx_was_result denetimi yazardi; baska modulun (JBoss) isi de okunurdu.
test('W22 durum uclari is TIPINI ayirir (kesif / islem / baska modul), Admin dahil', async () => {
  const k = await kesifYap(ALI);
  let r = await istek('GET', `/api/opsx/was/run/${k.discoverServerId}/${k.discoverJobId}/status`, ALI);
  assert.equal(r.status, 404, `kesif isi islem ucundan okundu: ${r.raw}`);
  assert.equal(S.audits.filter((a) => a.action === 'opsx_was_result').length, 0, 'kesif isine sonuc denetimi yazildi');
  assert.ok(S.history.every((h) => h.finished_at == null), 'kesif kaydi islem sonucu gibi kapatildi');
  r = await istek('GET', `/api/opsx/was/run/${k.discoverServerId}/${k.discoverJobId}/status`, ADMIN);
  assert.equal(r.status, 404, `Admin tip kontrolunden muaf olmamali: ${r.raw}`);

  const ilk = await istek('POST', '/api/opsx/was/run', ALI, govde(k));
  assert.equal(ilk.status, 200, ilk.raw);
  r = await istek('GET', `/api/opsx/was/discover/${ilk.body.awxServerId}/${ilk.body.jobId}/status`, ALI);
  assert.equal(r.status, 404, `islem isi kesif ucundan okundu: ${r.raw}`);

  S.history.push({
    username: 'ali',
    awx_server_id: 1,
    template_id: 7,
    template_name: 'OpsX',
    job_id: 4242,
    status: 'pending',
    params: JSON.stringify({ platform: 'legacy', application: 'APPX' }),
    finished_at: null,
  });
  S.jobs.set(jobKey(1, 4242), { status: 'successful', artifacts: {} });
  r = await istek('GET', '/api/opsx/was/run/1/4242/status', ALI);
  assert.equal(r.status, 404, `JBoss isi WAS ucundan okundu: ${r.raw}`);
});

// -- DUZELTICI TURU (2026-10-02) BEKCILERI ------------------------------------
// Her biri dogrulanmis bir bulgunun TERSIDIR (bulguda "bugun 200 donuyor" olan yol burada
// 4xx bekler); her biri mutasyonla dogrulandi (kontrol silinince kirmizi).

// Islem isini AWX'te bitmis gosterir. `once`: bitis zamaninin kac ms once oldugu.
function bitir(run, artifacts, { status = 'successful', once = 30_000 } = {}) {
  const job = S.jobs.get(jobKey(run.body.awxServerId, run.body.jobId));
  job.status = status;
  job.finished = new Date(Date.now() - once).toISOString();
  job.started = new Date(Date.now() - once - 60_000).toISOString();
  job.artifacts = artifacts;
  return job;
}
const stopOk = (run, host, cell, node, extra = {}) => ({
  opsx_was_op_result: {
    host, profile: 'AppSrv01', cell, node, server: 'APPX', op: 'stop', request_id: run.body.requestId,
    before: 'RUNNING', after: 'STOPPED', result: 'OK', steps: [], line: 'RESULT\tstop\tOK\tRUNNING\tSTOPPED\tok',
    ...extra,
  },
});
const sonucDenetimleri = () => S.audits.filter((x) => x.action === 'opsx_was_result');
const DIGER = { host: 'GBWASP02', cell: 'CELL02', node: 'NODE02' };

test('W23 durum yoklamasi is BITMEDEN kilidi birakmaz (LB cifti korumasi)', async () => {
  const k = await kesifYap(ALI);
  const kV = await kesifYap(VELI);
  const run = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  assert.equal(run.status, 200, run.raw);
  const url = `/api/opsx/was/run/${run.body.awxServerId}/${run.body.jobId}/status`;
  for (const st of ['pending', 'waiting', 'running']) {
    S.jobs.get(jobKey(run.body.awxServerId, run.body.jobId)).status = st;
    const r = await istek('GET', url, ALI);
    assert.equal(r.body.status, st, r.raw);
    assert.equal(S.locks.get('A|APPX').held, 1, `${st} yoklamasinda uygulama kilidi birakildi`);
    assert.equal(S.locks.get('T|GBWASP01|CELL01|NODE01|APPX').held, 1, `${st} yoklamasinda hedef kilidi birakildi`);
  }
  assert.equal(sonucDenetimleri().length, 0, 'bitmemis ise sonuc denetimi yazildi');
  const iki = await istek('POST', '/api/opsx/was/run', VELI, govde(kV, { operation: 'stop', ...DIGER }));
  assert.equal(iki.status, 409, iki.raw);
  assert.equal(iki.body.lock?.scope, 'app', iki.raw);
});

test('W24 durum uclari: uygulama sonradan kisitlanirsa sahibi de okuyamaz, Admin okur', async () => {
  const k = await kesifYap(ALI);
  const run = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  assert.equal(run.status, 200, run.raw);
  S.restricted.add('APPX');
  const url = `/api/opsx/was/run/${run.body.awxServerId}/${run.body.jobId}/status`;
  assert.equal((await istek('GET', url, ALI)).status, 403, 'kisitli uygulamanin islem sonucu sahibine gorundu');
  assert.equal((await istek('GET', url, ADMIN)).status, 200, 'Admin kisittan muaf olmali');
  const dUrl = `/api/opsx/was/discover/${k.discoverServerId}/${k.discoverJobId}/status`;
  assert.equal((await istek('GET', dUrl, ALI)).status, 403, 'kisitli uygulamanin kesfi sahibine gorundu');
});

test('W25 kesif baglama: baska uygulamanin kesfi 400, taranmamis host 409, islem isi kesif diye 400', async () => {
  // (a) APPX kesfi (KISITLI'nin JVM'i de ayni hostta olculmus) KISITLI icin kullanilamaz.
  const kAppx = await kesifYap(ALI);
  S.jobs
    .get(jobKey(kAppx.discoverServerId, kAppx.discoverJobId))
    .artifacts.opsx_was_discover_result.hosts[0].profiles[0].servers.push({
      server: 'KISITLI', cluster: '', state: 'RUNNING', pids: 1, ss: 'UP', reason: '',
    });
  S.restricted.delete('KISITLI');
  let r = await istek('POST', '/api/opsx/was/run', ALI, govde(kAppx, { app: 'KISITLI', server: 'KISITLI', confirmText: 'KISITLI', operation: 'stop', ackWarnings: true }));
  assert.equal(r.status, 400, `baska uygulamanin kesfi kabul edildi: ${r.raw}`);
  assert.match(r.body.message, /başka bir uygulama/);
  // (b) kesif yalniz GBWASP02'yi taradi; artifact 01'i de icerse bile 01 icin kullanilamaz.
  reset();
  const k2 = await kesifYap(ALI, { hosts: ['GBWASP02'] });
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(k2, { operation: 'stop' }));
  assert.equal(r.status, 409, `kesifte taranmayan host kabul edildi: ${r.raw}`);
  assert.match(r.body.message, /taranmadı/);
  // (c) ISLEM isi (target_hosts'u ve kesif sonucu olsa bile) kesif yerine gecemez.
  reset();
  const k3 = await kesifYap(ALI);
  const op = await istek('POST', '/api/opsx/was/run', ALI, govde(k3, { operation: 'stop' }));
  assert.equal(op.status, 200, op.raw);
  const h = S.history.find((x) => x.job_id === op.body.jobId);
  h.params = JSON.stringify({ ...JSON.parse(h.params), target_hosts: 'GBWASP01,GBWASP02' });
  Object.assign(S.jobs.get(jobKey(op.body.awxServerId, op.body.jobId)), {
    status: 'successful',
    finished: new Date().toISOString(),
    playbook: undefined,
    artifacts: { opsx_was_discover_result: kesifSonucu() },
  });
  r = await istek('POST', '/api/opsx/was/run', ALI, govde({ discoverJobId: op.body.jobId, discoverServerId: op.body.awxServerId }, { operation: 'stop', ...DIGER }));
  assert.equal(r.status, 400, `islem isi kesif diye kabul edildi: ${r.raw}`);
  assert.match(r.body.message, /keşfi değil/);
});

test('W26 LB cifti: ilk islem bittikten sonra ESKI kesifle ikinci host 409 kesif_eski (iki kullanici, iki sekme)', async () => {
  const kAli = await kesifYap(ALI);
  const kVeli = await kesifYap(VELI);
  const ilk = await istek('POST', '/api/opsx/was/run', ALI, govde(kAli, { operation: 'stop' }));
  assert.equal(ilk.status, 200, ilk.raw);
  const job = bitir(ilk, stopOk(ilk, 'GBWASP01', 'CELL01', 'NODE01'));
  const st = await istek('GET', `/api/opsx/was/run/${ilk.body.awxServerId}/${ilk.body.jobId}/status`, ALI);
  assert.equal(st.body.result.after, 'STOPPED', st.raw);
  assert.equal(S.locks.get('A|APPX').held, 0);
  assert.equal(S.locks.get('A|APPX').last_op_finished_at, job.finished, 'son islem zamani kilitle birlikte yazilmadi');
  // VELI'nin kesfi ALI'nin isinden ONCE: 01'i "calisiyor" gosterir -> SON_CALISAN sorulmazdi.
  let r = await istek('POST', '/api/opsx/was/run', VELI, govde(kVeli, { operation: 'stop', ...DIGER }));
  assert.equal(r.status, 409, `bayat kesifle ikinci host durduruldu: ${r.raw}`);
  assert.equal(r.body.code, 'kesif_eski');
  // Ayni kullanici, ayni eski kesif (ikinci sekme).
  r = await istek('POST', '/api/opsx/was/run', ALI, govde(kAli, { operation: 'stop', ...DIGER }));
  assert.equal(r.status, 409, r.raw);
  assert.equal(r.body.code, 'kesif_eski');
  assert.equal(islemLaunchlari().length, 1);
  // Taze kesif 01'i DURMUS olcer -> 02 son calisan: onaysiz 409 uyari_onayi, onayla 200.
  const taze = await kesifYap(VELI, {
    onceMs: 1000,
    sonuc: kesifSonucu((x) => Object.assign(x.hosts[0].profiles[0].servers[0], { state: 'STOPPED', pids: 0, ss: 'ULASILAMIYOR' })),
  });
  r = await istek('POST', '/api/opsx/was/run', VELI, govde(taze, { operation: 'stop', ...DIGER }));
  assert.equal(r.status, 409, r.raw);
  assert.equal(r.body.code, 'uyari_onayi');
  assert.ok(r.body.warnings.some((w) => w.code === 'SON_CALISAN'), r.raw);
  r = await istek('POST', '/api/opsx/was/run', VELI, govde(taze, { operation: 'stop', ackWarnings: true, ...DIGER }));
  assert.equal(r.status, 200, r.raw);
});

test("W27 sonuc denetimi genel ucun gecmisi sonlandirmasindan BAGIMSIZ ve TEK sefer", async () => {
  const k = await kesifYap(ALI);
  const run = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  bitir(run, stopOk(run, 'GBWASP01', 'CELL01', 'NODE01'));
  // /api/ansible/ss/job-status (Self Service Gecmis) satiri ONCE sonlandirdi.
  const h = S.history.find((x) => x.job_id === run.body.jobId);
  Object.assign(h, { status: 'successful', finished_at: Date.now() });
  const url = `/api/opsx/was/run/${run.body.awxServerId}/${run.body.jobId}/status`;
  let r = await istek('GET', url, ALI);
  assert.equal(r.status, 200, r.raw);
  assert.equal(sonucDenetimleri().length, 1, 'genel uc gecmisi sonlandirinca sonuc denetimi HIC yazilmadi');
  assert.equal(sonucDenetimleri()[0].username, 'ali');
  r = await istek('GET', url, ADMIN);
  assert.equal(r.status, 200);
  assert.equal(sonucDenetimleri().length, 1, 'sonuc denetimi tekrarlandi');
  assert.ok(S.ops.get(opsKey(run.body.awxServerId, run.body.jobId)).audited_at, 'islem kaydi isaretlenmedi');
});

test('W28 uzlastirici: sekme kapaliyken sonuc denetimi yazilir, kilit bitis zamaniyla birakilir', async () => {
  const { reconcileTick } = require('../was.cjs');
  const k = await kesifYap(ALI);
  const run = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  assert.equal(run.status, 200, run.raw);
  // Is surerken uzlastirici hicbir sey yapmaz.
  await reconcileTick();
  assert.equal(S.locks.get('A|APPX').held, 1);
  assert.equal(sonucDenetimleri().length, 0);
  // Is bitti; kullanici sekmeyi kapatmisti (durum ucu HIC yoklanmadi).
  const job = bitir(run, stopOk(run, 'GBWASP01', 'CELL01', 'NODE01'));
  await reconcileTick();
  assert.equal(sonucDenetimleri().length, 1, 'kimse bakmayinca sonuc denetimi yazilmadi');
  const a = sonucDenetimleri()[0];
  assert.equal(a.username, 'ali', 'sonuc isi baslatana atfedilmeli');
  assert.equal(JSON.parse(a.detail).observedBy, 'system:opsx-was-uzlastirici');
  assert.equal(S.locks.get('A|APPX').held, 0, 'uzlastirici kilidi birakmadi');
  assert.equal(S.locks.get('A|APPX').last_op_finished_at, job.finished);
  // Kullanici sonra bakarsa sonucu gorur; denetim tekrarlanmaz.
  const r = await istek('GET', `/api/opsx/was/run/${run.body.awxServerId}/${run.body.jobId}/status`, ALI);
  assert.equal(r.body.result.result, 'OK', r.raw);
  await reconcileTick();
  assert.equal(sonucDenetimleri().length, 1, 'sonuc denetimi tekrarlandi');
});

test('W29 gecmis yazimi basarisiz: sahip islem kaydindan bulunur; ikisi de yazilamazsa yanit soyler', async () => {
  const k = await kesifYap(ALI);
  S.failDb = /^INSERT INTO ansible_job_history/;
  const run = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  S.failDb = null;
  assert.equal(run.status, 200, run.raw);
  assert.equal(run.body.historyWritten, true, 'islem kaydi yazildigi halde historyWritten false');
  assert.ok(JSON.parse(S.audits.find((x) => x.action === 'opsx_was_operation').detail).historyMissing, 'denetimde historyMissing yok');
  bitir(run, stopOk(run, 'GBWASP01', 'CELL01', 'NODE01'));
  const url = `/api/opsx/was/run/${run.body.awxServerId}/${run.body.jobId}/status`;
  let r = await istek('GET', url, ALI);
  assert.equal(r.status, 200, `gecmis satiri yokken sahip kendi isini goremedi: ${r.raw}`);
  assert.equal(r.body.result.result, 'OK');
  assert.equal(sonucDenetimleri().length, 1);
  r = await istek('GET', url, VELI);
  assert.equal(r.status, 403, r.raw);
  // Iki kayit da yazilamaz: is yine baslatilmistir ama yanit bunu SESSIZCE yutmaz.
  reset();
  const k2 = await kesifYap(ALI);
  S.failDb = /^INSERT INTO (ansible_job_history|opsx_was_ops)/;
  const run2 = await istek('POST', '/api/opsx/was/run', ALI, govde(k2, { operation: 'stop' }));
  S.failDb = null;
  assert.equal(run2.status, 200, run2.raw);
  assert.equal(run2.body.historyWritten, false);
  assert.match(run2.body.warning, new RegExp(`#${run2.body.jobId}`));
  const d = JSON.parse(S.audits.find((x) => x.action === 'opsx_was_operation').detail);
  assert.ok(d.historyMissing && d.opsRecordMissing, 'denetimde kayit eksigi yazmiyor');
});

test('W30 yayinlanan sonuc baska istege aitse OLCULEMEDI (basarili sayilmaz)', async () => {
  const k = await kesifYap(ALI);
  const run = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop' }));
  bitir(run, stopOk(run, 'GBWASP01', 'CELL01', 'NODE01', { request_id: 'baska-istek' }));
  const r = await istek('GET', `/api/opsx/was/run/${run.body.awxServerId}/${run.body.jobId}/status`, ALI);
  assert.equal(r.body.result.result, 'OLCULEMEDI', r.raw);
  assert.equal(r.body.result.after, '', 'baska istegin sonrasi gosterildi');
  assert.match(r.body.message, /bu isteğe ait değil/);
  assert.equal(sonucDenetimleri()[0].result, 'fail');
  // host uyusmazligi da ayni
  reset();
  const k2 = await kesifYap(ALI);
  const run2 = await istek('POST', '/api/opsx/was/run', ALI, govde(k2, { operation: 'stop' }));
  bitir(run2, stopOk(run2, 'GBWASP02', 'CELL01', 'NODE01'));
  const r2 = await istek('GET', `/api/opsx/was/run/${run2.body.awxServerId}/${run2.body.jobId}/status`, ALI);
  assert.equal(r2.body.result.result, 'OLCULEMEDI', r2.raw);
});

test('W31 uyari onayi YALNIZ boolean true', async () => {
  const askida = kesifSonucu((x) => Object.assign(x.hosts[0].profiles[0].servers[0], { state: 'ASKIDA', pids: 1, ss: 'ULASILAMIYOR' }));
  const k = await kesifYap(ALI, { sonuc: askida });
  for (const ackWarnings of ['true', 1, 'evet']) {
    const r = await istek('POST', '/api/opsx/was/run', ALI, govde(k, { operation: 'stop', ackWarnings }));
    assert.equal(r.status, 409, `ackWarnings=${JSON.stringify(ackWarnings)} onay sayildi: ${r.raw}`);
  }
  assert.equal(islemLaunchlari().length, 0);
});

// ── STATIK SOZLESME ──────────────────────────────────────────────────────────
const SRV = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(SRV, rel), 'utf8');

test("WS1 index.cjs was.cjs'i OpsX sayfa kapisindan SONRA baglar", () => {
  const src = flatten(read('opsx/index.cjs'));
  const kapi = src.indexOf("app.use('/api/opsx', requireVisiblePrefix('OpsX'))");
  const was = src.indexOf("require('./was.cjs').initOpsXWas(app, { requireAuth })");
  assert.ok(kapi > 0, 'OpsX sayfa kapisi bulunamadi');
  assert.ok(was > kapi, 'was.cjs sayfa kapisindan once (ya da hic) baglaniyor');
});

test('WS2 registry anahtarlari, seed satirlari ve paths ayni sozlesmeyi soyluyor', () => {
  const { REGISTRY_KEYS } = require('../index.cjs');
  const { WAS_KEYS, EXPECTED_PLAYBOOK } = require('../was.cjs');
  const { PLAYBOOKS } = require('../../ansible/paths.cjs');
  assert.equal(REGISTRY_KEYS.wasDiscover, WAS_KEYS.discover);
  assert.equal(REGISTRY_KEYS.wasOperation, WAS_KEYS.operation);
  assert.equal(PLAYBOOKS.opsxWasDiscover, `opsx_was/${EXPECTED_PLAYBOOK.discover}`);
  assert.equal(PLAYBOOKS.opsxWasOperation, `opsx_was/${EXPECTED_PLAYBOOK.operation}`);
  const setup = flatten(read('db/mssql-setup.cjs'));
  for (const [key, env, file] of [
    ['opsx_was_discover', 'OPSX_WAS_DISCOVER_TEMPLATE_ID', EXPECTED_PLAYBOOK.discover],
    ['opsx_was_operation', 'OPSX_WAS_OPERATION_TEMPLATE_ID', EXPECTED_PLAYBOOK.operation],
  ]) {
    const i = setup.indexOf(`key_name: '${key}'`);
    assert.ok(i > 0, `${key} seed satiri yok`);
    const blok = setup.slice(i, setup.indexOf('}', i));
    assert.match(blok, new RegExp(`playbook_path: 'server/ansible/bmw_portal/opsx_was/${file.replace('.', '\\.')}'`));
    assert.match(blok, new RegExp(`env_var_name: '${env}'`));
  }
  assert.match(setup, /name: 'opsx_was_locks'/);
  assert.match(setup, /CREATE TABLE opsx_was_locks \( .*lock_key NVARCHAR\(450\) NOT NULL.*UNIQUE\(lock_key\) \)/);
  // Bayat kesif kurali (W26) ve sonuc denetimi isareti / uzlastirici (W27-W29) semasi.
  assert.match(setup, /CREATE TABLE opsx_was_locks \( .*last_op_finished_at NVARCHAR\(40\) NULL/);
  assert.match(setup, /table: 'opsx_was_locks', col: 'last_op_finished_at', sql: `ALTER TABLE opsx_was_locks ADD last_op_finished_at NVARCHAR\(40\) NULL`/);
  assert.match(setup, /name: 'opsx_was_ops'/);
  assert.match(setup, /CREATE TABLE opsx_was_ops \( .*audited_at DATETIME2 NULL.*UNIQUE\(awx_server_id, awx_job_id\) \)/);
  // opsx_legacy_operation artik WAS demiyor
  const j = setup.indexOf("key_name: 'opsx_legacy_operation'");
  assert.doesNotMatch(setup.slice(j, setup.indexOf('}', j)), /JBoss\/WAS/);
});

test('WS3 WAS kodunda DELETE yok; her launch limit olarak bos metin verir', () => {
  for (const rel of ['opsx/was.cjs', 'opsx/was-state.cjs']) {
    const kod = read(rel)
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    assert.doesNotMatch(kod, /\bDELETE\b/i, `${rel}: DELETE (TBMWANS'ta yasak)`);
  }
  const src = flatten(read('opsx/was.cjs'));
  const cagrilar = [...src.matchAll(/runner\.launchJobOnServer\(([^;]*?)\);/g)].map((m) => m[1]);
  assert.ok(cagrilar.length >= 2, `launch cagrisi sayisi beklenmedik: ${cagrilar.length}`);
  for (const c of cagrilar) {
    assert.match(c, /extraVars, '', user$/, `limit bos degil: ${c}`);
  }
});
