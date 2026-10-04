// server/nginx-migration/__tests__/_harness.cjs - nginx-migration davranis testlerinin ORTAK
// duzenegi (test dosyasi DEGIL: run-tests.cjs yalniz *.test.cjs toplar).
//
// GERCEK olanlar: Express ucu (initNginxMigration), runner.cjs (template/survey okuma, launch,
// iptal - yerel SAHTE AWX'e HTTP ile), gorunurluk motoru (auth/visibility.cjs: decide, Admin
// muafiyeti, kaskad, fail-closed). ENJEKTE edilenler (require.cache): DB, requireAuth/
// getRequestUser, tasima gorunumu (loadMigration), denetim kaydi.
//
// Sahte AWX, AWX'in sessiz yutma kuralini uygular: Prompt on launch kapali + survey acikken
// survey'de olmayan degiskenler launch yanitinin ignored_fields'ina DEGERLERIYLE duser
// (gercek AWX gibi) - runner'in disari yalniz ADLARI verdigi bu sayede olculur.
// Kurgu dugmeleri (awxSifirla): iptal 403/405/409, is detayi okunamaz (jobGetStatus), is
// detayinda job_template yok (jobTemplate=null), launch job id dondurmez (launchNoId),
// bu modulun OLMAYAN isler (foreignJobs: job-status IDOR).
//
// Kullanim: require ONCE (stub'lar index.cjs/runner.cjs'ten once kurulmali), sonra
// `await h.start()` (before) ve `h.reset()` (beforeEach).
'use strict';

const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');

const TOKEN = 'NF-SIR-TOKEN-91c4e7a2b3';
const DELETE_TPL = 20;
const CREATE_TPL = 10;
const JOB_ID = 9001;

for (const k of Object.keys(process.env)) {
  if (/^AWX_/.test(k) || /^(HTTPS?_PROXY|https?_proxy)$/.test(k) || k === 'VISIBILITY_FAIL_OPEN') delete process.env[k];
}

// ── ENJEKSIYON ───────────────────────────────────────────────────────────────
const SERVER = path.join(__dirname, '..', '..');
const stub = (rel, exports) => {
  const file = path.join(SERVER, rel);
  const m = new Module(file);
  m.filename = file;
  m.loaded = true;
  m.exports = exports;
  require.cache[file] = m;
};

// Gorunurluk ogeleri: seed'deki gibi Denetim sayfasi (yalniz Admin; mssql-setup closeDenetimToUsers)
// + Nginx Hub sayfasi + SPA sekmesi, hepsi varsayilan KAPALI. Denetim KAYITLI olmali: motor
// kayitsiz ogeyi gorunur sayar ve 'Denetim' kapisi testte bos yere yesil kalirdi.
const ELEMENTS = [
  { element_key: 'Denetim', element_type: 'page', parent_key: null, label: 'Middleware Ic Denetim', route: '/denetim', sort_order: 3, enabled: 1, default_visible: 0, metadata: null },
  { element_key: 'NginxConsole', element_type: 'page', parent_key: null, label: 'Nginx Hub', route: '/nginx-console', sort_order: 1, enabled: 1, default_visible: 0, metadata: null },
  { element_key: 'tab:nginx:spa', element_type: 'tab', parent_key: 'NginxConsole', label: 'SPA', route: null, sort_order: 28, enabled: 1, default_visible: 0, metadata: null },
];
const allow = (elementKey, principalType, principalId) => ({ element_key: elementKey, principal_type: principalType, principal_id: principalId, allow: 1 });

// Oturum nesnesi GERCEK sekliyle: auth/index.cjs login'i `mail` yazar, `email` YAZMAZ
// (eskiden burada `email` vardi ve user.email okuyan kod testte dolu, uretimde bos gidiyordu).
const USERS = {
  // Denetim + Nginx Hub sayfasi + SPA sekmesi acilmis ekip uyesi (Admin DEGIL).
  ekip: { username: 'odemir', mail: 'o@x', displayName: 'Onur Test', role: 'User' },
  yabanci: { username: 'yabanci', mail: 'y@x', displayName: 'Yetkisiz', role: 'User' },
  admin: { username: 'yonetici', mail: 'a@x', displayName: 'Yonetici', role: 'Admin' },
};
// "Nginx Hub Erisimi" paneli YALNIZ NginxConsole + tab:nginx:* yazar (visibility-routes.cjs);
// ekranin veri ucu (/api/denetim/nginx-migration) ek olarak 'Denetim' ister - ekip uyesine
// Admin > "Denetim Erisimi"nden o da acilmis olmali.
const NGINX_PANEL_RULES = [allow('NginxConsole', 'user', 'odemir'), allow('tab:nginx:spa', 'user', 'odemir')];
const EKIP_RULES = [allow('Denetim', 'user', 'odemir'), ...NGINX_PANEL_RULES];

const h = {
  TOKEN,
  DELETE_TPL,
  CREATE_TPL,
  JOB_ID,
  USERS,
  EKIP_RULES,
  NGINX_PANEL_RULES,
  allow,
  dbLog: [],
  audits: [],
  rules: EKIP_RULES.slice(),
  elements: ELEMENTS,
  visibilityDown: false,
  sessionUser: USERS.ekip,
  awx: { srv: null, port: 0, istekler: [] },
  portal: { srv: null, port: 0 },
};

const VIS_SQL = /FROM portal_element(s|_visibility)\b/;
stub('db/index.cjs', {
  query: async (sql, params) => {
    h.dbLog.push({ sql: String(sql), params });
    if (/FROM portal_elements\b/.test(sql)) {
      if (h.visibilityDown) throw new Error('DB erisilemiyor (test)');
      return { rows: h.elements };
    }
    if (/FROM portal_element_visibility\b/.test(sql)) {
      if (h.visibilityDown) throw new Error('DB erisilemiyor (test)');
      return { rows: h.rules };
    }
    if (/FROM portal_config_blobs/.test(sql)) {
      return { rows: [{ data: JSON.stringify({ awxServerId: 1, templateId: CREATE_TPL, deleteTemplateId: DELETE_TPL }) }] };
    }
    return { rows: [], rowCount: 0 };
  },
});
stub('auth/index.cjs', {
  requireAuth: (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ ok: false, error: 'Oturum yok' })),
  requireAdmin: (req, res, next) =>
    req.session && req.session.user && req.session.user.role === 'Admin' ? next() : res.status(403).json({ ok: false, error: 'Admin' }),
  getRequestUser: (req) => (req.session && req.session.user) || null,
});
stub('inventory/mssql.cjs', { query: async () => ({ recordset: [] }), sql: {} });
h.GROUPS = [
  {
    id: 'glomo',
    newHosts: ['GBNGXP40'],
    oldHosts: ['GBRVPP07', 'GBRVPP08'],
    apps: [
      {
        namespace: 'digital-banking-ch-prod',
        application: 'base-app-v0',
        status: 'ready',
        written: ['base_up'],
        paths: [
          { service: 'GLOMO', location: '/base/', hosts: ['GBRVPP07'], newStatus: 'defined' },
          { service: 'GLOMO', location: '/yeni/', hosts: ['GBRVPP07'], newStatus: 'missing' },
        ],
      },
    ],
  },
];
stub('audit/nginx-migration.cjs', { loadMigration: async () => ({ groups: h.GROUPS }) });
stub('audit/index.cjs', { auditPortal: (_req, action, opts) => h.audits.push({ action, ...opts }) });

// ── SAHTE AWX ────────────────────────────────────────────────────────────────
function awxSifirla() {
  const a = h.awx;
  a.istekler.length = 0;
  // Template ayarlari (GET /job_templates/<DELETE_TPL>/). omit: yanitta OLMAYACAK alanlar.
  a.tpl = { ask_variables_on_launch: true, survey_enabled: false, spec: [], omit: [] };
  a.tplStatus = 0; // template detayi bu kodla reddedilir
  a.surveyStatus = 0; // survey_spec bu kodla reddedilir
  a.surveyBody = undefined; // verilirse survey_spec bu govdeyi doner (bozuk bicim kurgusu)
  a.forceIgnore = []; // AWX bu degiskenleri (ayar ne olursa olsun) yok sayar - yaris kurgusu
  a.noIgnoredFields = false; // launch yaniti ignored_fields TASIMAZ (olculemedi kurgusu)
  a.cancel = 'ok'; // 'ok' | '403' | '405' | '409'
  a.jobStatus = 'pending';
  a.jobGetStatus = 0; // GET /jobs/<JOB_ID>/ bu kodla reddedilir (durum OLCULEMEDI kurgusu)
  a.jobTemplate = DELETE_TPL; // GET /jobs/<JOB_ID>/ job_template alani; null -> alan YOK
  a.stdout = 'TASK [nginx_ops] ok\n';
  // Bu modulun OLMAYAN isler (job-status IDOR kurgusu): id -> { job_template, stdout }
  a.foreignJobs = { 7777: { job_template: 999, stdout: 'TASK [debug] ok: db_password=BASKA-EKIBIN-SIRRI\n' } };
  a.launchNoId = false; // launch yaniti job id TASIMAZ
  a.lastLaunch = null;
  a.lastIgnored = undefined;
}

function awxIstegi(req, res, body) {
  const a = h.awx;
  const u = new URL(req.url, 'http://x');
  const yol = u.pathname;
  a.istekler.push({ method: req.method, yol, body, auth: req.headers.authorization || null });
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };
  if (req.method === 'GET' && yol === `/api/v2/job_templates/${DELETE_TPL}/`) {
    if (a.tplStatus) return send(a.tplStatus, { detail: 'gecici AWX hatasi' });
    const t = { id: DELETE_TPL, name: 'Nginx Reverse Proxy Operations', ask_variables_on_launch: a.tpl.ask_variables_on_launch, survey_enabled: a.tpl.survey_enabled, extra_vars: '' };
    for (const k of a.tpl.omit || []) delete t[k];
    return send(200, t);
  }
  if (req.method === 'GET' && yol === `/api/v2/job_templates/${DELETE_TPL}/survey_spec/`) {
    if (a.surveyStatus) return send(a.surveyStatus, { detail: `You do not have permission (got ${req.headers.authorization})` });
    if (a.surveyBody !== undefined) return send(200, a.surveyBody);
    return send(200, a.tpl.survey_enabled ? { name: '', description: '', spec: a.tpl.spec } : {});
  }
  const launchM = /^\/api\/v2\/job_templates\/(\d+)\/launch\/$/.exec(yol);
  if (req.method === 'POST' && launchM) {
    const tplId = Number(launchM[1]);
    const payload = JSON.parse(body || '{}');
    const ev = JSON.parse(payload.extra_vars || '{}');
    const ignored = {};
    if (tplId === DELETE_TPL) {
      // AWX kurali: prompt kapali + survey acik -> survey disi degisken YOK SAYILIR (degeriyle);
      // prompt kapali + survey kapali -> hepsi yok sayilir.
      const t = a.tpl;
      const inSurvey = new Set((t.survey_enabled ? t.spec : []).map((q) => q.variable));
      for (const [k, v] of Object.entries(ev)) {
        if (a.forceIgnore.includes(k) || (!t.ask_variables_on_launch && !inSurvey.has(k))) ignored[k] = v;
      }
    }
    a.lastLaunch = { tplId, ev };
    a.lastIgnored = Object.keys(ignored).length ? { extra_vars: ignored } : {};
    const resp = a.launchNoId ? { status: 'pending' } : { job: JOB_ID, id: JOB_ID, status: 'pending' };
    if (!a.noIgnoredFields) resp.ignored_fields = a.lastIgnored;
    return send(201, resp);
  }
  if (req.method === 'GET' && yol === `/api/v2/jobs/${JOB_ID}/`) {
    if (a.jobGetStatus) return send(a.jobGetStatus, { detail: 'gecici AWX hatasi' });
    const j = { id: JOB_ID, status: a.jobStatus, summary_fields: { created_by: { username: 'portal_svc' } } };
    if (a.jobTemplate != null) j.job_template = a.jobTemplate;
    return send(200, j);
  }
  if (req.method === 'GET' && yol === `/api/v2/jobs/${JOB_ID}/stdout/`) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(a.stdout);
  }
  const yabanciM = /^\/api\/v2\/jobs\/(\d+)\/(stdout\/)?$/.exec(yol);
  if (req.method === 'GET' && yabanciM && a.foreignJobs[yabanciM[1]]) {
    const fj = a.foreignJobs[yabanciM[1]];
    if (yabanciM[2]) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(fj.stdout);
    }
    return send(200, { id: Number(yabanciM[1]), status: 'successful', job_template: fj.job_template, finished: '2026-10-01', failed: false });
  }
  if (req.method === 'POST' && yol === `/api/v2/jobs/${JOB_ID}/cancel/`) {
    if (a.cancel === '403') {
      return send(403, { detail: `You do not have permission to perform this action. (got ${req.headers.authorization})` });
    }
    // 405/409: araya giren vekil/WAF POST'u reddeder ya da AWX "iptal edilemez" der.
    if (a.cancel === '405') return send(405, { detail: 'Method "POST" not allowed.' });
    if (a.cancel === '409') return send(409, { detail: 'Job cannot be canceled.' });
    a.jobStatus = 'canceled';
    return send(202);
  }
  if (req.method === 'GET' && yol === '/api/v2/me/') return send(200, { results: [{ username: 'portal_svc' }] });
  return send(404, { detail: 'Not found.' });
}

// ── PORTAL (gercek Express ucu + gercek gorunurluk motoru) ───────────────────
h.runner = require('../../ansible/runner.cjs');
h.nm = require('../index.cjs');
h.visibility = require('../../auth/visibility.cjs');

h.start = async () => {
  h.awx.srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => awxIstegi(req, res, b));
  });
  await new Promise((r) => h.awx.srv.listen(0, '127.0.0.1', r));
  h.awx.port = h.awx.srv.address().port;
  process.env.AWX_1_URL = `http://127.0.0.1:${h.awx.port}`;
  process.env.AWX_1_TOKEN = TOKEN;
  process.env.AWX_1_NAME = 'maestro-test';

  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    if (h.sessionUser) req.session = { user: h.sessionUser };
    next();
  });
  h.nm.initNginxMigration(app);
  h.portal.srv = http.createServer(app);
  await new Promise((r) => h.portal.srv.listen(0, '127.0.0.1', r));
  h.portal.port = h.portal.srv.address().port;
};

h.stop = async () => {
  await new Promise((r) => h.awx.srv.close(r));
  await new Promise((r) => h.portal.srv.close(r));
};

h.reset = () => {
  awxSifirla();
  h.audits.length = 0;
  h.dbLog.length = 0;
  h.rules = EKIP_RULES.slice();
  h.elements = ELEMENTS;
  h.visibilityDown = false;
  h.sessionUser = USERS.ekip;
  h.visibility.bumpVersion(); // gorunurluk onbellegi kural degisikligini gormeli
};

h.setRules = (rules) => {
  h.rules = rules;
  h.visibility.bumpVersion();
};

h.call = (method, urlPath, body) =>
  new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const req = http.request({ host: '127.0.0.1', port: h.portal.port, path: urlPath, method, headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(b || '{}');
        } catch {
          json = {};
        }
        resolve({ status: res.statusCode, body: b, json });
      });
    });
    req.on('error', reject);
    req.end(data);
  });

h.BODY = { group: 'glomo', namespace: 'digital-banking-ch-prod', application: 'base-app-v0', service: 'GLOMO', inputPath: '/base/' };
h.sil = (body = h.BODY) => h.call('POST', '/api/nginx-migration/delete', body);

h.launches = () => h.awx.istekler.filter((r) => r.method === 'POST' && /\/launch\/$/.test(r.yol));
/** Bir isin CIKTISINA (stdout ya da job_events) giden istekler. */
h.outputReads = (jobId) => h.awx.istekler.filter((r) => new RegExp(`/jobs/${jobId}/(stdout|job_events)/`).test(r.yol));
h.cancels = () => h.awx.istekler.filter((r) => r.method === 'POST' && /\/cancel\/$/.test(r.yol));
h.deleteStamp = () => h.dbLog.filter((q) => /delete_job_id/.test(q.sql) && /(UPDATE|INSERT)/.test(q.sql));
/** Gorunurluk motorunun kendi okumalari DISINDAKI DB sorgulari (uca "ulasildi" kaniti). */
h.appQueries = () => h.dbLog.filter((q) => !VIS_SQL.test(q.sql));

h.mockConsole = (t) => {
  const out = { warn: [], error: [], log: [] };
  for (const n of ['warn', 'error', 'log']) t.mock.method(console, n, (...a) => out[n].push(a.join(' ')));
  return out;
};

module.exports = h;
