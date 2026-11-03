// server/crypto-hub/__tests__/_node_harness.cjs - Indexer / Node uclari icin duzenek (2026-11-02).
//
// GERCEK express yonlendiricisi + GERCEK change-gates.openSmartTicket + GERCEK
// prod-approval.smartApprovalFor + GERCEK smart/metadata (nunjucks). Sahte olanlar: AWX
// (runner), Smart API (client), smart_tickets deposu, Portal DB, denetim, yetki motoru.
// Sahte DB SQL metnini yorumlar: kosul gevserse (mutasyon) sahte DB de gevser.
'use strict';

const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const KOK = path.join(__dirname, '..', '..');
const yol = (p) => require.resolve(path.join(KOK, p));
const REAL_REDACT = require('../../ansible/runner.cjs').redactExtraVarsForHistory;

const hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SIR = 'SIRSIR123';

// ── Ornek node_env_get ciktisi ────────────────────────────────────────────────────────
const T = 'metaco_das_test';
const G_EVM = 'uis:evm-ethereum-mainnet';
const G_BTC = 'eski:btc-mainnet';
const G_LTC = 'eski:ltc-mainnet';
const G_DOT = 'eski:polkadot-assethub';
const D = {
  idx: 'hmz-harmonize-uis-indexer-evm-ethereum-mainnet',
  adp: 'hmz-harmonize-uis-adapter-evm-ethereum-mainnet',
  api: 'hmz-harmonize-uis-api-evm-ethereum-mainnet',
  prc: 'hmz-harmonize-uis-processor-evm-ethereum-mainnet',
  nbx: 'hmz-harmonize-nbxplorer-mainnet',
  dot: 'hmz-harmonize-substrate-polkadot-assethub',
};
const URL_A = 'https://eth-a.example.net/****';
const URL_B = 'https://eth-b.example.net/****';
const SHA = {
  a: hex('eth-a'),
  b: hex('eth-b'),
  btcP2p: hex('btc-p2p-1'),
  btcRpc: hex('btc-rpc-1'),
  btcP2pB: hex('btc-p2p-2'),
  btcRpcB: hex('btc-rpc-2'),
  ltcP2p: hex('ltc-p2p-1'),
  ltcRpc: hex('ltc-rpc-1'),
  dotUrl: hex('dot-url-1'),
  dotAuth: hex('dot-auth-1'),
  dotUrlB: hex('dot-url-2'),
  dotAuthB: hex('dot-auth-2'),
};

/**
 * @param {{t?:string, stdin?:string, patch?:string, gitops?:Record<string,string>,
 *          kaynak?:string, tutarsiz?:boolean, eksik?:boolean, endYok?:boolean, replicas?:number,
 *          apiTasimaz?:boolean}} o
 */
function satirlar(o = {}) {
  const t = o.t || T;
  const L = [];
  const add = (...f) => L.push(f.map(String).join('\t'));
  add('NODETOOL', t, 'python', '3.6.8', '-');
  add('NODETOOL', t, 'oc', '4.14.0', '-');
  add('NODETOOL', t, 'stdin_env', o.stdin || 'var', '-');
  add('NODETOOL', t, 'patch_file', o.patch || 'var', '-');
  add('NODEGRP', t, G_EVM, 'uis', 'uis-evm-ethereum-mainnet', 'evm-ethereum-mainnet');
  // uis_env_haritasi.md (kullanici olcumu): adapter/api NODE_ADDR, indexer NODE_URI_<ZA>,
  // processor node env'i YOK (genel envFrom'u var -> 11. alan 'var', satir uretmez).
  for (const [ad, b] of [
    [D.idx, 'indexer'],
    [D.adp, 'adapter'],
    [D.api, 'api'],
    [D.prc, 'processor'],
  ]) {
    add(
      'NODEDEP', t, G_EVM, ad, b, o.replicas == null ? 1 : o.replicas, 1, 4, (o.gitops && o.gitops[b]) || 'hayir', 'hmz',
      b === 'processor' ? 'var' : '-',
    );
  }
  add('NODEALLOW', t, G_EVM, 'rpc', 'NODE_ADDR', 'url');
  add('NODEALLOW', t, G_EVM, 'rpc', 'NODE_URI_EVM_ETHEREUM_MAINNET', 'url');
  add('NODEENV', t, G_EVM, D.idx, 'app', 'NODE_URI_EVM_ETHEREUM_MAINNET', 'rpc', o.kaynak || 'literal', URL_A, SHA.a, 'hayir');
  add(
    'NODEENV', t, G_EVM, D.adp, 'app', 'NODE_ADDR', 'rpc', 'literal',
    o.tutarsiz ? URL_B : URL_A, o.tutarsiz ? SHA.b : SHA.a, 'evet',
  );
  if (!o.apiTasimaz) add('NODEENV', t, G_EVM, D.api, 'app', 'NODE_ADDR', 'rpc', 'literal', URL_A, SHA.a, 'hayir');
  add('NODECAT', t, 'das_test_eth_a', G_EVM, 'rpc', 'Sağlayıcı A', URL_A, SHA.a, '-');
  add('NODECAT', t, 'das_test_eth_b', G_EVM, 'rpc', 'Sağlayıcı B', URL_B, SHA.b, '-');
  add('NODECAT', t, 'das_test_eth_c', G_EVM, 'rpc', 'Sağlayıcı C', '-', 'cozulemedi', 'sir_eksik');

  add('NODEGRP', t, G_BTC, 'eski', 'eski-nbxplorer-mainnet', 'nbxplorer-mainnet (BTC)');
  add('NODEDEP', t, G_BTC, D.nbx, '-', 1, 1, 9, 'hayir', 'hmz');
  add('NODEALLOW', t, G_BTC, 'p2p', 'NBXPLORER_BTCNODEENDPOINT', 'hostport');
  add('NODEALLOW', t, G_BTC, 'rpc', 'NBXPLORER_BTCRPCURL', 'url');
  add('NODEENV', t, G_BTC, D.nbx, 'nbxplorer', 'NBXPLORER_BTCNODEENDPOINT', 'p2p', 'literal', '10.1.2.3:8333', SHA.btcP2p, 'hayir');
  add('NODEENV', t, G_BTC, D.nbx, 'nbxplorer', 'NBXPLORER_BTCRPCURL', 'rpc', 'literal', 'http://10.1.2.3:8332/****', SHA.btcRpc, 'hayir');
  add('NODECAT', t, 'das_test_btc_b', G_BTC, 'p2p', 'BTC B', '10.9.9.9:8333', SHA.btcP2pB, '-');
  add('NODECAT', t, 'das_test_btc_b', G_BTC, 'rpc', 'BTC B', 'http://10.9.9.9:8332/****', SHA.btcRpcB, '-');
  add('NODECAT', t, 'das_test_btc_tek', G_BTC, 'rpc', 'BTC yalniz rpc', 'http://10.8.8.8:8332/****', SHA.btcRpcB, '-');

  add('NODEGRP', t, G_LTC, 'eski', 'eski-nbxplorer-mainnet', 'nbxplorer-mainnet (LTC)');
  add('NODEDEP', t, G_LTC, D.nbx, '-', 1, 1, 9, 'hayir', 'hmz');
  add('NODEALLOW', t, G_LTC, 'p2p', 'NBXPLORER_LTCNODEENDPOINT', 'hostport');
  add('NODEALLOW', t, G_LTC, 'rpc', 'NBXPLORER_LTCRPCURL', 'url');
  add('NODEENV', t, G_LTC, D.nbx, 'nbxplorer', 'NBXPLORER_LTCNODEENDPOINT', 'p2p', 'literal', '10.1.2.4:9333', SHA.ltcP2p, 'hayir');
  add('NODEENV', t, G_LTC, D.nbx, 'nbxplorer', 'NBXPLORER_LTCRPCURL', 'rpc', 'literal', 'http://10.1.2.4:9332/****', SHA.ltcRpc, 'hayir');
  add('NODECAT', t, 'das_test_ltc_b', G_LTC, 'p2p', 'LTC B', '10.7.7.7:9333', hex('ltc-p2p-2'), '-');
  add('NODECAT', t, 'das_test_ltc_b', G_LTC, 'rpc', 'LTC B', 'http://10.7.7.7:9332/****', hex('ltc-rpc-2'), '-');

  // Polkadot: SIDECAR_AUTH_VALUE SIRDIR. Betik hatasi benzetimi: maskeli alanlarda HAM sir.
  add('NODEGRP', t, G_DOT, 'eski', 'eski-substrate-polkadot-assethub', 'substrate-polkadot-assethub');
  add('NODEDEP', t, G_DOT, D.dot, '-', 1, 1, 2, 'hayir', 'hmz');
  add('NODEALLOW', t, G_DOT, 'auth', 'SIDECAR_AUTH_VALUE', 'sir');
  add('NODEALLOW', t, G_DOT, 'url', 'SIDECAR_URL', 'url');
  add('NODEENV', t, G_DOT, D.dot, 'sidecar', 'SIDECAR_URL', 'url', 'literal', `https://dot.example.net/v1/${SIR}`, SHA.dotUrl, 'hayir');
  add('NODEENV', t, G_DOT, D.dot, 'sidecar', 'SIDECAR_AUTH_VALUE', 'auth', 'literal', SIR, SHA.dotAuth, 'hayir');
  add('NODECAT', t, 'das_test_dot_b', G_DOT, 'url', 'DOT B', `https://dot-b.example.net/${SIR}`, SHA.dotUrlB, '-');
  add('NODECAT', t, 'das_test_dot_b', G_DOT, 'auth', 'DOT B', SIR, SHA.dotAuthB, '-');

  if (!o.endYok) add('NODEEND', t, 'node_env_get', o.eksik ? 'eksik' : 'ok');
  return L;
}

// ── Sahte Portal DB ──────────────────────────────────────────────────────────────────
function yeniDurum() {
  return {
    launches: [],
    preflight: [],
    prefill: [],
    sira: [],
    history: [],
    audits: [],
    logs: [],
    rows: [],
    nextId: 1,
    indeks: true,
    dbBozuk: false,
    smartCreated: [],
    smartTickets: [],
    nextTicket: 500,
    smartHata: null,
    storeHata: null,
    baglamaNoop: false,
    jobs: new Map(),
    nextJob: 3000,
    components: [],
    preflightHata: null,
    opsxCfg: {
      smart: {
        openshift: {
          flowKey: 'FLOW_OPENSHIFT',
          metadataFields:
            "JRDESTAPPLICATION_1: {{ opsx.hedefler }}\nACIKLAMA: {{ opsx.aciklama | default(opsx.islem) }}\nJRENV: {% if opsx.ortam == 'prod' %}Production_9{% else %}Test_3{% endif %}\nCLUSTER: {{ extraVars.oc_cluster }}",
          integrationKey: 'RFF',
        },
      },
      openshift: { ocClusterKey: 'oc_cluster', ocInputKey: 'oc_input' },
    },
    sablonVarsayilan: { job_type: 'run' },
  };
}

const SUTUN_SIRASI = [
  'tenant_key', 'grup', 'kilit', 'lokasyon', 'yeni_node_id', 'yeni_node_ad', 'eski_ozet', 'yeni_ozet',
  'hedefler', 'plan_sha', 'gerekce', 'username', 'es_talep_id',
];

function dbSorgu(d, sqlText, p) {
  const s = String(sqlText).replace(/\s+/g, ' ').trim();
  d.logs.push(s);
  if (d.dbBozuk) return Promise.reject(new Error('db erisilemez'));
  const ok = (rows, rowCount) => Promise.resolve({ rows, rowCount: rowCount == null ? rows.length : rowCount });
  if (/FROM sys\.indexes WHERE name = 'UX_chnc_acik'/.test(s)) {
    return ok(d.indeks && /is_unique = 1/.test(s) && /has_filter = 1/.test(s) ? [{ v: 1 }] : []);
  }
  if (/^INSERT INTO ansible_job_history/.test(s)) {
    d.history.push({ username: p[0], awx_server_id: p[1], template_id: p[2], template_name: p[3], job_id: p[4], status: p[5], params: p[6] });
    return ok([], 1);
  }
  if (/^SELECT TOP 1 username, template_name FROM ansible_job_history/.test(s)) {
    const r = d.history.find((h) => Number(h.job_id) === Number(p[0]) && Number(h.awx_server_id) === Number(p[1]));
    return ok(r ? [r] : []);
  }
  if (/^INSERT INTO crypto_hub_node_changes/.test(s)) {
    const row = {};
    SUTUN_SIRASI.forEach((k, i) => (row[k] = p[i] === undefined ? null : p[i]));
    if (d.indeks && d.rows.some((r) => r.kapandi_at == null && r.tenant_key === row.tenant_key && r.kilit === row.kilit)) {
      return Promise.reject(Object.assign(new Error('Cannot insert duplicate key row in object'), { number: 2601 }));
    }
    Object.assign(row, {
      id: d.nextId++,
      durum: /'ACILIYOR'/.test(s) ? 'ACILIYOR' : '?',
      smart_ticket_id: null,
      external_ticket_id: null,
      awx_server_id: null,
      awx_job_id: null,
      sonuc_kod: null,
      sonuc_json: null,
      created_at: new Date(),
      updated_at: new Date(),
      kapandi_at: null,
    });
    d.rows.push(row);
    return ok([{ id: row.id }], 1);
  }
  if (/^UPDATE crypto_hub_node_changes SET durum = \$1, sonuc_kod = \$2, sonuc_json = \$3, kapandi_at = SYSUTCDATETIME\(\)/.test(s)) {
    const cas = /WHERE id = \$4 AND kapandi_at IS NULL/.test(s);
    let n = 0;
    for (const r of d.rows) {
      if (r.id !== Number(p[3])) continue;
      if (cas && r.kapandi_at != null) continue;
      Object.assign(r, { durum: p[0], sonuc_kod: p[1], sonuc_json: p[2], kapandi_at: new Date() });
      n += 1;
    }
    return ok([], n);
  }
  if (/^UPDATE crypto_hub_node_changes SET durum = 'BEKLIYOR', smart_ticket_id = \$1, external_ticket_id = \$2/.test(s)) {
    if (d.baglamaNoop) return ok([], 0);
    let n = 0;
    for (const r of d.rows) {
      if (r.id !== Number(p[2]) || r.kapandi_at != null) continue;
      if (/AND durum = 'ACILIYOR'/.test(s) && r.durum !== 'ACILIYOR') continue;
      Object.assign(r, { durum: 'BEKLIYOR', smart_ticket_id: p[0], external_ticket_id: p[1] });
      n += 1;
    }
    return ok([], n);
  }
  if (/^UPDATE crypto_hub_node_changes SET durum = 'BEKLIYOR', external_ticket_id = \$1/.test(s)) {
    const r = d.rows.find((x) => x.id === Number(p[1]) && x.kapandi_at == null);
    if (r) Object.assign(r, { durum: 'BEKLIYOR', external_ticket_id: p[0] });
    return ok([], r ? 1 : 0);
  }
  if (/^UPDATE crypto_hub_node_changes SET durum = 'CALISIYOR'/.test(s)) {
    const r = d.rows.find((x) => x.id === Number(p[2]) && x.kapandi_at == null);
    if (r) Object.assign(r, { durum: 'CALISIYOR', awx_server_id: p[0], awx_job_id: p[1] });
    return ok([], r ? 1 : 0);
  }
  if (/^SELECT TOP 1 id, external_ticket_id FROM crypto_hub_node_changes WHERE tenant_key = \$1 AND grup = \$2 AND created_at >= DATEADD\(day, -(\d+), SYSUTCDATETIME\(\)\) AND durum NOT IN \('REDDEDILDI', 'HATA', 'IPTAL'\) AND id NOT IN \(SELECT es_talep_id FROM crypto_hub_node_changes WHERE es_talep_id IS NOT NULL AND tenant_key = \$3\) ORDER BY created_at DESC, id DESC$/.test(s)) {
    const gun = Number(/DATEADD\(day, -(\d+)/.exec(s)[1]);
    const bagli = new Set(d.rows.filter((x) => x.es_talep_id != null && x.tenant_key === p[2]).map((x) => Number(x.es_talep_id)));
    const r = d.rows
      .filter((x) => x.tenant_key === p[0] && x.grup === p[1])
      .filter((x) => Date.now() - new Date(x.created_at).getTime() <= gun * 86400000)
      .filter((x) => !['REDDEDILDI', 'HATA', 'IPTAL'].includes(x.durum) && !bagli.has(Number(x.id)))
      .sort((a, b) => b.id - a.id)[0];
    return ok(r ? [{ id: r.id, external_ticket_id: r.external_ticket_id }] : []);
  }
  if (/^SELECT TOP 1 id, external_ticket_id FROM crypto_hub_node_changes WHERE tenant_key = \$1 AND kilit = \$2 AND kapandi_at IS NULL/.test(s)) {
    const r = d.rows.find((x) => x.tenant_key === p[0] && x.kilit === p[1] && x.kapandi_at == null);
    return ok(r ? [{ ...r }] : []);
  }
  if (/^SELECT TOP 1 id, external_ticket_id FROM smart_tickets WHERE pending_launch_json LIKE \$1/.test(s)) {
    const desen = new RegExp(
      '^' +
        String(p[0])
          .replace(/[.*+?^${}()|\\]/g, (c) => (c === '[' || c === ']' ? c : '\\' + c))
          .replace(/%/g, '.*') +
        '$',
    );
    const r = [...d.smartTickets].reverse().find((t) => desen.test(t.pending_launch_json));
    return ok(r ? [{ id: r.id, external_ticket_id: r.external_ticket_id }] : []);
  }
  if (/FROM crypto_hub_node_changes WHERE id = \$1$/.test(s)) {
    const r = d.rows.find((x) => x.id === Number(p[0]));
    return ok(r ? [{ ...r }] : []);
  }
  if (/FROM crypto_hub_node_changes WHERE tenant_key = \$1 AND kapandi_at IS NULL$/.test(s)) {
    return ok(d.rows.filter((x) => x.tenant_key === p[0] && x.kapandi_at == null).map((x) => ({ ...x })));
  }
  if (/^SELECT TOP 20 .* FROM crypto_hub_node_changes WHERE tenant_key = \$1 ORDER BY/.test(s)) {
    return ok(
      d.rows
        .filter((x) => x.tenant_key === p[0])
        .sort((a, b) => b.id - a.id)
        .slice(0, 20)
        .map((x) => ({ ...x })),
    );
  }
  if (/FROM crypto_hub_node_changes WHERE kapandi_at IS NULL$/.test(s)) {
    return ok(d.rows.filter((x) => x.kapandi_at == null).map((x) => ({ ...x })));
  }
  return ok([], 0);
}

// ── Kurulum ──────────────────────────────────────────────────────────────────────────
async function kur() {
  const d = yeniDurum();
  const gercekGates = (() => {
    const p = yol('ansible/change-gates.cjs');
    const eski = require.cache[p];
    delete require.cache[p];
    const m = require(p);
    if (eski) require.cache[p] = eski;
    else delete require.cache[p];
    return m;
  })();

  const sahte = {
    'auth/index.cjs': {
      requireAuth(req, res, next) {
        const h = req.headers['x-test-user'];
        if (!h) return res.status(401).json({ ok: false });
        req.session = { user: JSON.parse(h) };
        next();
      },
    },
    'auth/visibility.cjs': {
      requireVisible: () => (_req, _res, next) => next(),
      async canSee(user, key) {
        if (user.motorBozuk) throw new Error('motor yok');
        if (user.role === 'Admin') return true;
        return (user.yetkiler || []).includes(key);
      },
    },
    'auth/utils.cjs': { getRequestUser: (req) => (req.session && req.session.user) || null },
    'ansible/playbook-registry.cjs': {
      async getByKey(key) {
        if (key === 'crypto_hub_ops') return d.registryYok ? null : { key, enabled: true, awxServerId: 1, tid: 77 };
        if (key === 'opsx_openshift_operation') return { key, enabled: true, awxServerId: 1, tid: 55 };
        return null;
      },
      getEffectiveTemplateId: (row) => row.tid,
    },
    'ansible/template-preflight.cjs': {
      async assertTemplateAcceptsExtraVars(serverId, templateId, ev, o) {
        d.sira.push('preflight');
        d.preflight.push({ serverId, templateId, ev: { ...ev }, o });
        if (d.preflightHata) throw Object.assign(new Error(d.preflightHata), { status: 409 });
      },
    },
    'ansible/ss-customizations.cjs': { readCustom: async () => ({}) },
    'ansible/runner.cjs': {
      redactExtraVarsForHistory: REAL_REDACT,
      async launchJobOnServer(serverId, templateId, extraVars, limit, user) {
        d.sira.push('launch');
        const jobId = d.nextJob++;
        d.launches.push({ serverId, templateId, extraVars: { ...extraVars }, limit, user, jobId });
        d.jobs.set(jobId, { status: 'running', artifacts: {} });
        return { jobId, status: 'pending' };
      },
      async getJobStatusOnServer(serverId, jobId) {
        if (d.awxBozuk) throw new Error('awx yok');
        const j = d.jobs.get(Number(jobId)) || { status: 'running', artifacts: {} };
        return { jobId, status: j.status, artifacts: j.artifacts, finished: j.finished || null };
      },
      async getJobOutputOnServer(serverId, jobId) {
        return { output: `cikti ${jobId}` };
      },
      async prefillSurveyDefaultsOnServer(serverId, templateId, ev) {
        d.sira.push('prefill');
        d.prefill.push({ serverId, templateId });
        return { ...ev, zorunlu_alan: 'varsayilan' };
      },
      async getTemplateVariableDefaultsOnServer(serverId, templateId) {
        d.sira.push(`sablon:${templateId}`);
        return { ...d.sablonVarsayilan };
      },
    },
    'ansible/change-gates.cjs': {
      async openSmartTicket(args) {
        d.sira.push('openSmartTicket');
        d.gateArgs = args;
        return gercekGates.openSmartTicket(args);
      },
    },
    'smart/client.cjs': {
      async createTicket({ flowKey, username, metadata, integrationKey }) {
        d.sira.push('smart:create');
        if (d.smartHata) throw new Error(d.smartHata);
        const ticketId = `SM-${d.nextTicket}`;
        d.smartCreated.push({ flowKey, username, metadata, integrationKey, ticketId });
        return { ticketId };
      },
    },
    'smart/store.cjs': {
      async createTicket({ externalTicketId, username, awxServerId, awxTemplateId, flowKey, pendingLaunch }) {
        if (d.storeHata) throw new Error(d.storeHata);
        const t = {
          id: d.nextTicket++,
          external_ticket_id: externalTicketId,
          username,
          awx_server_id: awxServerId,
          awx_template_id: awxTemplateId,
          flow_key: flowKey,
          status: 'PENDING',
          pending_launch_json: JSON.stringify(pendingLaunch),
          awx_job_id: null,
          created_at: new Date(),
        };
        d.smartTickets.push(t);
        return { id: t.id, externalTicketId };
      },
      async cancelTicket(id, username, isAdmin, note, actor) {
        d.iptaller = d.iptaller || [];
        d.iptaller.push({ id: Number(id), username, isAdmin, note, actor });
        if (d.iptalYarisi) return null; // poller bileti bu arada LAUNCHING'e almis gibi
        const t = d.smartTickets.find((x) => x.id === Number(id) && x.status === 'PENDING');
        if (!t) return null;
        t.status = 'CANCELLED';
        return { id: t.id, status: 'CANCELLED' };
      },
      async getTicket(id) {
        if (d.storeOkunamaz) throw new Error('store yok');
        const t = d.smartTickets.find((x) => x.id === Number(id));
        if (!t) return null;
        return {
          id: t.id,
          externalTicketId: t.external_ticket_id,
          status: t.status,
          smartStateName: t.state || null,
          awxServerId: t.awx_server_id,
          awxJobId: t.awx_job_id,
          errorMessage: t.error || null,
          createdAt: t.created_at,
          pendingLaunch: JSON.parse(t.pending_launch_json),
        };
      },
    },
    'opsx/config.cjs': {
      getConfig: async () => d.opsxCfg,
      parseExtraVarLines: require('../../opsx/config.cjs').parseExtraVarLines,
    },
    'opsx/index.cjs': { extractStatsKey: (a, k) => (a && a[k]) || null },
    'audit/index.cjs': {
      auditPortal: (req, action, opts) =>
        d.audits.push({ action, opts, user: req && req.session && req.session.user }),
    },
    'inventory/mssql.cjs': {
      sql: { NVarChar: () => 'nvarchar' },
      async query(sqlText) {
        if (/Crypto_Hub_Components/.test(sqlText) && !/want > 0/.test(sqlText)) {
          return { recordset: d.components };
        }
        return { recordset: [] };
      },
    },
    'db/index.cjs': { query: (q, p) => dbSorgu(d, q, p || []) },
  };

  const onceki = new Map();
  for (const [p, exp] of Object.entries(sahte)) {
    const r = yol(p);
    onceki.set(r, require.cache[r]);
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exp };
  }
  // GERCEK olup sahteleri kullanmasi gerekenler taze yuklenir.
  const taze = ['crypto-hub/index.cjs', 'crypto-hub/resources.cjs', 'crypto-hub/node.cjs', 'opsx/prod-approval.cjs', 'smart/metadata.cjs'].map(yol);
  const tazeOnceki = new Map(taze.map((r) => [r, require.cache[r]]));
  for (const r of taze) delete require.cache[r];
  const mod = require('../index.cjs');
  const NODE = require('../node.cjs');
  const RES = require('../resources.cjs');
  RES._sifirla();
  NODE._sifirla();

  // console.* casusu: hicbir log satirinda sir dizesi olmamali (N11).
  const konsol = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(konsol)) {
    console[k] = (...a) => d.logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  }

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

  function istek(method, url, user, body) {
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

  /** Kiraci icin taze okuma (NODE_OKUMA'ya dogrudan; ucun kendisi ayrica sinanir). */
  function okumaVer(o = {}, at = Date.now(), t = T) {
    NODE.okumaKaydet(t, NODE.parseNodeLines(satirlar({ ...o, t })), at, { jobId: 1, serverId: 1, username: 'okuyan' });
  }

  function bitir(jobId, lines, status = 'successful', tenant = T, finished = null) {
    d.jobs.set(Number(jobId), {
      status,
      finished,
      artifacts: { crypto_hub_ops_result: { tenant, action: 'node_env_get', lines } },
    });
  }

  async function kapat() {
    await new Promise((r) => srv.close(r));
    Object.assign(console, konsol);
    for (const [r, eski] of onceki) {
      if (eski) require.cache[r] = eski;
      else delete require.cache[r];
    }
    for (const [r, eski] of tazeOnceki) {
      if (eski) require.cache[r] = eski;
      else delete require.cache[r];
    }
  }

  return { d, istek, okumaVer, bitir, kapat, mod, NODE, RES };
}

const K = {
  nodecu: { username: 'nodecu', role: 'User', mail: 'nodecu@x.test', yetkiler: ['cryptohub:node:degistir'] },
  metacocu: { username: 'mete', role: 'User', yetkiler: ['cryptohub:app:metaco'] },
  wydenci: { username: 'wy', role: 'User', yetkiler: ['cryptohub:app:wyden'] },
  yetkisiz: { username: 'yok', role: 'User', yetkiler: [] },
  admin: { username: 'boss', role: 'Admin', mail: 'boss@x.test' },
};

const GOVDE = (o = {}) => ({
  tenant: T,
  grup: G_EVM,
  nodeId: 'das_test_eth_b',
  gerekce: 'Sağlayıcı A kesinti yaşıyor, B ye geçiyoruz',
  ...o,
});

module.exports = { kur, satirlar, hex, SIR, T, G_EVM, G_BTC, G_LTC, G_DOT, D, SHA, URL_A, URL_B, K, GOVDE, dbSorgu, yeniDurum };
