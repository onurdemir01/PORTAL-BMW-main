// server/crypto-hub/__tests__/_kaynak_harness.cjs — Crypto Hub uclarini GERCEK express
// yonlendiricisiyle, sahte AWX / DB / denetim / yetki modulleriyle kosturur (2026-10-02).
//
// NEDEN: kaynak metninde "kapi var mi" diye bakan bekci, kapi BASKA bir dala tasininca ya
// da kosulu gevseyince yesil kalir. Bu duzenek davranisi olcer: istegi atar, durum kodunu,
// AWX'e giden degiskenleri, gecmis kaydini ve kilit tablosunu okur.
//
// Sahte moduller require.cache'e GERCEK yollarin anahtariyla konur; index.cjs bunlari
// istek aninda require ettigi icin sahte olan kullanilir. Is bitince eski girisler geri
// konur (baska testleri kirletmez).
'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');

const KOK = path.join(__dirname, '..', '..');
const yol = (p) => require.resolve(path.join(KOK, p));
const REAL_REDACT = require('../../ansible/runner.cjs').redactExtraVarsForHistory;

function hex(n) {
  return require('node:crypto').createHash('sha256').update(String(n)).digest('hex');
}

/**
 * @param {{prodAcik?: boolean, gizliAlan?: string}} [secenek]
 */
async function kur(secenek = {}) {
  const durum = {
    launches: [],
    history: [],
    audits: [],
    locks: new Map(),
    sqlLog: [],
    jobs: new Map(),
    nextJob: 1000,
    dbBozuk: false,
    launchHata: null,
    kosan: '1.5.19',
  };

  const sahte = {
    'server/auth/index.cjs': {
      requireAuth(req, res, next) {
        const h = req.headers['x-test-user'];
        if (!h) return res.status(401).json({ ok: false });
        req.session = { user: JSON.parse(h) };
        next();
      },
    },
    'server/auth/visibility.cjs': {
      requireVisible: () => (_req, _res, next) => next(),
      async canSee(user, key) {
        if (user.role === 'Admin') return true;
        return (user.apps || []).includes(String(key).split(':').pop());
      },
    },
    'server/auth/utils.cjs': { getRequestUser: (req) => (req.session && req.session.user) || null },
    'server/ansible/playbook-registry.cjs': {
      getByKey: async () => ({ enabled: true, awxServerId: 1 }),
      getEffectiveTemplateId: () => 77,
    },
    'server/ansible/template-preflight.cjs': { assertTemplateAcceptsExtraVars: async () => {} },
    'server/ansible/ss-customizations.cjs': {
      readCustom: async () =>
        secenek.gizliAlan ? { fieldOverrides: [{ fieldName: secenek.gizliAlan, hidden: true }] } : {},
    },
    'server/ansible/runner.cjs': {
      redactExtraVarsForHistory: REAL_REDACT,
      async launchJobOnServer(serverId, templateId, extraVars, limit, user) {
        if (durum.launchHata) throw Object.assign(new Error(durum.launchHata), { status: 502 });
        const jobId = durum.nextJob++;
        durum.launches.push({ serverId, templateId, extraVars: { ...extraVars }, limit, user, jobId });
        durum.jobs.set(jobId, { status: 'running', artifacts: {} });
        return { jobId, status: 'pending' };
      },
      async getJobStatusOnServer(serverId, jobId) {
        const j = durum.jobs.get(Number(jobId)) || { status: 'successful', artifacts: {} };
        return { jobId, status: j.status, artifacts: j.artifacts, finished: j.finished || null };
      },
      async getJobOutputOnServer(serverId, jobId) {
        return { output: `cikti ${jobId}` };
      },
    },
    'server/opsx/index.cjs': {
      extractStatsKey: (artifacts, key) => (artifacts && artifacts[key]) || null,
    },
    'server/audit/index.cjs': {
      auditPortal: (req, action, opts) =>
        durum.audits.push({ action, opts, user: req && req.session && req.session.user }),
    },
    'server/inventory/mssql.cjs': {
      sql: { NVarChar: () => 'nvarchar' },
      async query(sqlText) {
        if (/Crypto_Hub_Releases/.test(sqlText)) {
          return {
            recordset: durum.kosan
              ? [{ release_name: 'wydenapp', chart: 'wyden', chart_version: durum.kosan, status: 'deployed' }]
              : [],
          };
        }
        return { recordset: [] };
      },
    },
    'server/db/index.cjs': { query: (sqlText, p) => dbSorgu(durum, sqlText, p || []) },
  };
  if (secenek.prodAcik) {
    const gercek = require('../../../shared/cryptoHubTenants.cjs');
    sahte['shared/cryptoHubTenants.cjs'] = { ...gercek, isOpen: (t) => !!t };
  }

  const onceki = new Map();
  for (const [p, exp] of Object.entries(sahte)) {
    const r = p.startsWith('shared/') ? require.resolve(path.join(KOK, '..', p)) : yol(p.replace(/^server\//, ''));
    onceki.set(r, require.cache[r]);
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exp };
  }
  const idx = require.resolve('../index.cjs');
  const resYol = require.resolve('../resources.cjs');
  delete require.cache[idx];
  delete require.cache[resYol];
  const mod = require('../index.cjs');
  const RES = require('../resources.cjs');
  RES._sifirla();

  // Arka plan sonuc taramasi testte zamanlayiciyla KOSMAZ; testler mod.uygulamaSonuclariniTara()
  // ile elle tetikler (zamanlayici sahte moduller geri konduktan sonra gercek DB'ye giderdi).
  const oncekiTarama = process.env.CRYPTO_HUB_SONUC_TARAMA_SN;
  process.env.CRYPTO_HUB_SONUC_TARAMA_SN = '0';
  const app = express();
  mod.initCryptoHub(app);
  if (oncekiTarama === undefined) delete process.env.CRYPTO_HUB_SONUC_TARAMA_SN;
  else process.env.CRYPTO_HUB_SONUC_TARAMA_SN = oncekiTarama;
  const srv = await new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s));
  });
  const port = srv.address().port;

  async function istek(method, url, user, body) {
    return new Promise((resolve, reject) => {
      const veri = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: `/api/crypto-hub${url}`,
          method,
          headers: {
            'content-type': 'application/json',
            ...(user ? { 'x-test-user': JSON.stringify(user) } : {}),
            ...(veri ? { 'content-length': Buffer.byteLength(veri) } : {}),
          },
        },
        (res) => {
          let s = '';
          res.on('data', (c) => (s += c));
          res.on('end', () => {
            let j = null;
            try {
              j = JSON.parse(s);
            } catch {
              j = { ham: s };
            }
            resolve({ status: res.statusCode, body: j });
          });
        },
      );
      req.on('error', reject);
      if (veri) req.write(veri);
      req.end();
    });
  }

  /** AWX isini bitir: set_stats sonucunu ver. `finished` (ISO) AWX'in bildirdigi bitis ani. */
  function bitir(jobId, action, tenant, lines, status = 'successful', finished = null) {
    durum.jobs.set(Number(jobId), {
      status,
      finished,
      artifacts: { crypto_hub_ops_result: { tenant, action, lines } },
    });
  }

  async function kapat() {
    await new Promise((r) => srv.close(r));
    for (const [r, eski] of onceki) {
      if (eski) require.cache[r] = eski;
      else delete require.cache[r];
    }
    delete require.cache[idx];
    delete require.cache[resYol];
  }

  return { durum, istek, bitir, kapat, mod, RES };
}

// ── Sahte DB: ansible_job_history + crypto_hub_locks (SQL metni yorumlanir) ──────────
function dbSorgu(durum, sqlText, p) {
  durum.sqlLog.push(sqlText);
  if (durum.dbBozuk) return Promise.reject(new Error('db erisilemez'));
  const s = sqlText.replace(/\s+/g, ' ').trim();
  if (/^DELETE/i.test(s)) return Promise.reject(new Error('DELETE YASAK (TBMWANS)'));
  if (/^INSERT INTO ansible_job_history/.test(s)) {
    durum.history.push({
      username: p[0],
      awx_server_id: p[1],
      template_id: p[2],
      template_name: p[3],
      job_id: p[4],
      status: p[5],
      params: p[6],
    });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (/^SELECT TOP 1 username, template_name FROM ansible_job_history/.test(s)) {
    const r = durum.history.find((h) => Number(h.job_id) === Number(p[0]) && Number(h.awx_server_id) === Number(p[1]));
    return Promise.resolve({ rows: r ? [r] : [], rowCount: r ? 1 : 0 });
  }
  const simdi = Date.now();
  const L = durum.locks;
  if (/^UPDATE crypto_hub_locks SET held = 1/.test(s)) {
    const row = L.get(p[0]);
    // CAS: yalniz bos / birakilmis / suresi dolmus kilit alinir. Kosul metinden okunur ki
    // kosul gevserse (mutasyon) sahte DB de gevsesin.
    const cas = /AND \(held IS NULL OR held = 0 OR locked_until IS NULL OR locked_until < GETUTCDATE\(\)\)/.test(s);
    if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
    const bos = !row.held || !row.locked_until || row.locked_until < simdi;
    if (cas && !bos) return Promise.resolve({ rows: [], rowCount: 0 });
    Object.assign(row, {
      held: 1,
      holder: p[1],
      lock_id: p[2],
      awx_server_id: null,
      awx_job_id: null,
      locked_until: simdi + 75 * 60 * 1000,
    });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (/^SELECT TOP 1 held, holder, awx_server_id, awx_job_id, locked_until FROM crypto_hub_locks/.test(s)) {
    const row = L.get(p[0]);
    return Promise.resolve({ rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 });
  }
  if (/^SELECT TOP 50 lock_key, awx_server_id, awx_job_id FROM crypto_hub_locks WHERE held = 1 AND awx_job_id IS NOT NULL$/.test(s)) {
    const rows = [...L.values()].filter((r) => r.held && r.awx_job_id != null).map((r) => ({ ...r }));
    return Promise.resolve({ rows, rowCount: rows.length });
  }
  if (/^INSERT INTO crypto_hub_locks/.test(s)) {
    if (L.has(p[0])) return Promise.reject(new Error('UNIQUE KEY ihlali'));
    L.set(p[0], {
      lock_key: p[0],
      tenant_key: p[1],
      release_name: p[2],
      held: 1,
      holder: p[3],
      lock_id: p[4],
      locked_until: simdi + 75 * 60 * 1000,
    });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (/^UPDATE crypto_hub_locks SET awx_server_id = \$3, awx_job_id = \$4/.test(s)) {
    const row = L.get(p[0]);
    if (row && row.lock_id === p[1] && row.held) {
      row.awx_server_id = p[2];
      row.awx_job_id = p[3];
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  if (/^UPDATE crypto_hub_locks SET held = 0/.test(s)) {
    let n = 0;
    for (const row of L.values()) {
      const tut = /WHERE lock_key = \$1 AND lock_id = \$2/.test(s)
        ? row.lock_key === p[0] && row.lock_id === p[1]
        : Number(row.awx_server_id) === Number(p[0]) && Number(row.awx_job_id) === Number(p[1]);
      if (tut && row.held) {
        row.held = 0;
        row.locked_until = null;
        row.last_result = /WHERE lock_key/.test(s) ? p[2] : p[2];
        n += 1;
      }
    }
    return Promise.resolve({ rows: [], rowCount: n });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}

// ── Ornek RES* satirlari ─────────────────────────────────────────────────────────────
const T = 'wyden_qa_h2';
const ornek = {
  get: (t = T) => [
    `RESTOOL\t${t}\tpython3\tvar\t3.6.8`,
    `RESREL\t${t}\twydenapp\t1.5.19`,
    `RESWL\t${t}\tDeployment\twydenapp-access-gateway\t2\t2\tRollingUpdate\twydenapp`,
    `RESLIVE\t${t}\tDeployment\twydenapp-access-gateway\tapp\tkap\t500m\tYOK\t2\t2Gi`,
    `RESLR\t${t}\t-\t-\t-\t-\tYOK`,
    `RESQUOTA\t${t}\t-\t-\t-\tYOK`,
    `RESSRC\t${t}\t/vhosting/setup-wyden/4-wyden/qa/1.5.19/clqa1/garanti_values.yaml\tokundu\tdogrulanmadi\t${hex('dosya')}\t1234\tevet\tyalniz resources satirlari doner`,
    `RESFILE\t${t}\taccess-gateway\trequests.cpu\t500m\t44`,
    `RESFILE\t${t}\taccess-gateway\trequests.memory\tYOK\t-`,
    `RESFILE\t${t}\taccess-gateway\tlimits.cpu\t2\t47`,
    `RESFILE\t${t}\taccess-gateway\tlimits.memory\t2Gi\t48`,
    `RESPEER\t${t}\twyden_qa_h3\t/vhosting/x/clqa2/garanti_values.yaml\ttanimli\t${hex('es')}\tes cluster dosyasi`,
    `RESEND\t${t}\tresources_get\tok\t-`,
  ],
  plan: ({ t = T, durum = 'ok', kod = '-', riskli = 'hayir', bekleyen = '-' } = {}) => [
    `RESCHK\t${t}\tgirdi\tgecti\taccess-gateway / kap app: limits.memory: 2Gi -> 3Gi`,
    `RESCHK\t${t}\tlimitrange\tolculemedi\tLimitRange okunamadi`,
    `RESEDIT\t${t}\tbirincil\taccess-gateway\tlimits.memory\t2Gi\t3Gi\tdegistir`,
    `RESDIFF\t${t}\tDeployment\twydenapp-access-gateway\tapp\tlimits.memory\t2Gi\t3Gi`,
    `RESAFFECT\t${t}\tDeployment\twydenapp-access-gateway\tRollingUpdate\t2\t${riskli}`,
    `RESPEER\t${t}\twyden_qa_h3\t/vhosting/x/clqa2/garanti_values.yaml\tyazilir\t${hex('es')}\tayni duzenleme`,
    `RESPLAN\t${t}\t${durum}\t${kod}\t${hex('dosya')}\t${hex('yeni')}\t${hex('chart')}\t${bekleyen}\t${riskli}\t${durum === 'ok' ? hex('jeton') : '-'}`,
    `RESEND\t${t}\tresources_plan\t${durum}\t${kod}`,
  ],
  apply: ({ t = T, sonuc = 'uygulandi' } = {}) => [
    `RESSTEP\t${t}\tkilit\tok\talindi`,
    `RESSTEP\t${t}\tupgrade\tok\tgecti`,
    `RESOBS\t${t}\toom\tgecti\tyok`,
    `RESEND\t${t}\tresources_apply\t${sonuc}\t-`,
  ],
};

const KULLANICI = {
  ali: { username: 'ali', role: 'User', apps: ['wyden'] },
  veli: { username: 'veli', role: 'User', apps: ['wyden'] },
  metacocu: { username: 'mete', role: 'User', apps: ['metaco'] },
  admin: { username: 'boss', role: 'Admin' },
};

const PLAN_GOVDE = {
  tenant: T,
  action: 'resources_plan',
  targets: [],
  component: 'access-gateway',
  container: 'app',
  kind: 'Deployment',
  name: 'wydenapp-access-gateway',
  changes: [{ alan: 'limits.memory', eski: '2Gi', yeni: '3Gi' }],
};

module.exports = { kur, ornek, KULLANICI, PLAN_GOVDE, T, hex };
