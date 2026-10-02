// server/opsx/was.cjs - OpsX WAS (WebSphere) restart/stop/start.
//
// JBoss akisindan (server/opsx/index.cjs /api/opsx/run) BILEREK AYRI. Kullanici
// kurallari (2026-10-02) burada dort katmanin ikisinde uygulanir (UI + sunucu;
// playbook assert + bekciler digerleri):
//
//   TOPLU ISLEM YOK      tek host (string) + tek JVM. Dizi gelirse 400.
//   OLCULEMEDI != DURDU  olculemeyen JVM'e islem yapilmaz (409), sonuc ekraninda
//                        ayri (sari) "gercek durum bilinmiyor".
//   AWX'E LIMIT YOK      launchJobOnServer'in limit argumani HER ZAMAN ''. AWX, Limit
//                        icin "Prompt on launch" kapaliyken limit'i SESSIZCE yutar ve
//                        playbook tum envantere yayilir (uretimde yasandi, bkz. MEMORY).
//                        Hedef target_host(s) extra_var'i + playbook icinde add_host.
//   SIR YOK              extra_vars'ta parola yok; WAS kimligi hostun soap.client.props
//                        dosyasinda (K2-a), TBMWANS parolasi AWX credential'inda.
//
// UCLAR (hepsi /api/opsx altinda -> requireVisiblePrefix('OpsX') kapisindan gecer):
//   GET  /api/opsx/was/apps?search=
//   GET  /api/opsx/was/hosts?app=
//   POST /api/opsx/was/discover                         { app, hosts? }
//   GET  /api/opsx/was/discover/:serverId/:jobId/status
//   POST /api/opsx/was/run                              { app, host, profile, cell, node,
//                                                         server, operation, confirmed,
//                                                         confirmText, discoverJobId,
//                                                         discoverServerId, ackWarnings? }
//   GET  /api/opsx/was/run/:serverId/:jobId/status
//
// YETKI: her uc restrictions 'legacy_app' kapisindan gecer (Admin muaf - restrictions.cjs).
// Kapi karari HATA alirsa REDDEDILIR (503); is sahipligi sorgusu da oyle (AZ2 bekcisi).
'use strict';

const crypto = require('node:crypto');
const inventoryDb = require('../inventory/mssql.cjs');
const { getWasAppsTable } = require('../config/apps-table.cjs');
const ws = require('./was-state.cjs');

const WAS_KEYS = Object.freeze({
  discover: 'opsx_was_discover',
  operation: 'opsx_was_operation',
});

// AWX template'inin playbook DOSYA ADI bununla eslesmeli (registry playbook_path ile ayni).
const EXPECTED_PLAYBOOK = Object.freeze({
  discover: 'opsx_was_discover.yml',
  operation: 'opsx_was_operation.yml',
});

// ansible_job_history.params.platform - durum uclari BASKA bir isi okuyamasin diye.
const PLATFORM = Object.freeze({
  discover: 'was-discover',
  operation: 'was-operation',
});

const STATS_KEYS = Object.freeze({
  discover: 'opsx_was_discover_result',
  operation: 'opsx_was_op_result',
});

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const APP_LIST_MAX = 200;

function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status }, extra || {});
}

function currentUser(req) {
  return req.session?.user || {};
}

function sameUser(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase() && !!String(a || '');
}

function sendError(res, err) {
  const body = { ok: false, message: err.message };
  if (err.restriction) body.restriction = err.restriction;
  if (err.warnings) body.warnings = err.warnings;
  if (err.lock) body.lock = err.lock;
  if (err.code) body.code = err.code;
  res.status(err.status || 500).json(body);
}

function cleanApp(raw) {
  const app = typeof raw === 'string' ? raw.trim() : '';
  if (!app) throw httpError(400, 'Uygulama adı gerekli.');
  if (ws.isNoApp(app)) throw httpError(400, 'NOAPP bir uygulama değil (envanter yer tutucusu).');
  if (!ws.isValidName(app)) throw httpError(400, 'Uygulama adı beklenmeyen karakter içeriyor.');
  return app;
}

// legacy_app kisiti. Admin restrictions.cjs icinde muaf. DB hatasi = RET (fail-closed).
async function assertAppAllowed(app, user) {
  const restrictions = require('../logx/v2/restrictions.cjs');
  try {
    await restrictions.assertAllowed('legacy_app', app, user);
  } catch (err) {
    if (err && err.status === 403) throw err;
    console.warn('[OpsX WAS] erisim kisiti dogrulanamadi - istek reddedildi:', err?.message);
    throw httpError(503, 'Erişim kısıtlaması doğrulanamadı — işlem reddedildi, lütfen tekrar deneyin.');
  }
}

async function inventoryPool() {
  const pool = await inventoryDb.getPool();
  if (!pool) throw httpError(503, 'Envanter veritabanına erişilemiyor.');
  return pool;
}

async function inventoryHostsForApp(app) {
  const pool = await inventoryPool();
  const r = pool.request();
  r.input('app', app);
  const result = await r.query(
    `SELECT host, env, os, was_version, status FROM ${getWasAppsTable()} WHERE app = @app`,
  );
  return ws.shapeInventoryHosts(result.recordset || []);
}

// Registry'den template + AWX sunucusu. index.cjs resolveByKey ile ayni mantik; tek
// fark DB hatasi "template tanimsiz" (501) DEGIL 503 olarak doner.
async function resolveTemplate(kind) {
  const keyName = WAS_KEYS[kind];
  const playbookRegistry = require('../ansible/playbook-registry.cjs');
  let row;
  try {
    row = await playbookRegistry.getByKey(keyName);
  } catch (e) {
    throw httpError(503, `Playbook kaydı okunamadı (${keyName}): ${e.message}`);
  }
  if (!row || row.enabled === false) {
    return { templateId: null, serverId: null, keyName, playbookPath: '' };
  }
  const templateId = playbookRegistry.getEffectiveTemplateId(row);
  const envServer = Number(String(process.env.OPSX_AWX_SERVER_ID || '').trim());
  const serverId =
    row.awxServerId != null
      ? Number(row.awxServerId)
      : Number.isInteger(envServer) && envServer >= 0
        ? envServer
        : 0;
  return { templateId: templateId || null, serverId, keyName, playbookPath: row.playbookPath || '' };
}

function notConfigured(kind, keyName) {
  const label = kind === 'discover' ? 'WAS keşfi' : 'WAS restart/stop/start';
  return httpError(
    501,
    `OpsX ${label} için AWX job template'i henüz tanımlanmadı. Yönetici, Admin > Playbook ` +
      `Kayıtları ekranında "${keyName}" satırının Template ID alanını doldurmalı.`,
  );
}

function basenameOf(p) {
  const s = String(p || '').replace(/\\/g, '/').trim();
  return s.slice(s.lastIndexOf('/') + 1).toLowerCase();
}

// Template'in playbook'u beklenen dosya mi? Yanlis template'e restart gitmesin.
// Metadata okunamazsa (AWX erisilemez / salt-okunur liste filtresi) BLOKLAMAZ - ayni
// karar template-preflight.cjs ve LogX'in assertTemplateMatchesRegistry'sinde.
async function assertTemplatePlaybook(kind, tpl) {
  const expected = basenameOf(tpl.playbookPath) || EXPECTED_PLAYBOOK[kind];
  const { findTemplate } = require('../ansible/template-preflight.cjs');
  const meta = await findTemplate(tpl.serverId, tpl.templateId);
  if (!meta || !meta.playbook) return;
  const actual = basenameOf(meta.playbook);
  if (actual !== expected) {
    throw httpError(
      409,
      `Playbook Registry eşleşme hatası: "${tpl.keyName}" template ${tpl.templateId} playbook='${actual}', ` +
        `beklenen='${expected}'. Admin > Playbook Kayıtları'nda Template ID'yi kontrol edin.`,
    );
  }
}

function parseParams(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const p = JSON.parse(String(raw));
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function targetHostsOf(params) {
  const v = params?.target_hosts;
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  return list.map((h) => ws.normalizeHost(h)).filter(Boolean);
}

// FAIL-CLOSED is kaydi: DB okunamazsa erisim REDDEDILIR (503). Fail-open olsaydi bir DB
// kesintisi herkesin herkesin WAS isini okumasi ve kilit birakmasi demek olurdu.
// `opsFallback`: islem isinde ansible_job_history satiri yoksa (launch sonrasi INSERT
// basarisiz olduysa) sahiplik opsx_was_ops kaydindan okunur - o da DB hatasinda RET.
// Donus: { ok, status?, message?, found, owner, params }
async function loadJob(serverId, jobId, { opsFallback = false } = {}) {
  const db = require('../db/index.cjs');
  try {
    const own = await db.query(
      `SELECT TOP 1 username FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
      [jobId, serverId],
    );
    if (!own.rows.length) {
      const op = opsFallback ? await ws.loadOpRecord(db, serverId, jobId) : null;
      if (op) {
        return { ok: true, found: true, owner: String(op.username || ''), params: parseParams(op.params) };
      }
      return { ok: true, found: false, owner: null, params: {} };
    }
    const meta = await db.query(
      `SELECT TOP 1 params FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
      [jobId, serverId],
    );
    return {
      ok: true,
      found: true,
      owner: String(own.rows[0].username || ''),
      params: parseParams(meta.rows[0]?.params),
    };
  } catch (e) {
    console.warn('[OpsX WAS] is kaydi okunamadi - erisim reddedildi:', e.message);
    return { ok: false, status: 503, message: 'İş sahipliği doğrulanamadı, lütfen tekrar deneyin.' };
  }
}

// Durum uclarinin kapisi: is kaydi var, dogru tipte, (Admin degilse) istekte bulunanin,
// ve uygulama kisiti hala gecerli. Admin sahiplikten muaf, tipten ve kisittan degil
// (kisit Admin'i zaten restrictions.cjs icinde muaf tutar).
async function authorizeJob(req, serverId, jobId, platform) {
  const user = currentUser(req);
  const rec = await loadJob(serverId, jobId, { opsFallback: platform === PLATFORM.operation });
  if (!rec.ok) return rec;
  const isAdmin = user.role === 'Admin';
  if (!rec.found) {
    return isAdmin
      ? { ok: false, status: 404, message: 'Bu iş OpsX WAS kayıtlarında yok.' }
      : { ok: false, status: 403, message: 'Bu iş size ait değil.' };
  }
  if (rec.params.platform !== platform) {
    return { ok: false, status: 404, message: 'Bu iş bir OpsX WAS işi değil.' };
  }
  if (!isAdmin && !sameUser(rec.owner, user.username)) {
    try {
      require('../audit/index.cjs').auditPortal(req, 'opsx_was_access_denied', {
        result: 'fail',
        detail: JSON.stringify({ serverId, jobId, owner: rec.owner || null, platform }),
      });
    } catch {
      /* denetim best-effort; karar zaten RET */
    }
    return { ok: false, status: 403, message: 'Bu iş size ait değil.' };
  }
  try {
    await assertAppAllowed(String(rec.params.app || ''), user);
  } catch (err) {
    return { ok: false, status: err.status || 403, message: err.message };
  }
  return { ok: true, owner: rec.owner, params: rec.params };
}

function parseIds(req) {
  const serverId = Number(req.params.serverId);
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(serverId) || serverId < 0 || !Number.isInteger(jobId) || jobId <= 0) {
    return null;
  }
  return { serverId, jobId };
}

function statsOf(artifacts, key) {
  const { extractStatsKey } = require('./index.cjs');
  return extractStatsKey(artifacts, key);
}

async function insertHistory(req, { serverId, templateId, templateName, jobId, status, params }) {
  const db = require('../db/index.cjs');
  await db.query(
    `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      currentUser(req).username || 'unknown',
      serverId,
      templateId,
      templateName,
      jobId,
      status || 'pending',
      JSON.stringify(params),
    ],
  );
}

function audit(req, action, opts) {
  try {
    require('../audit/index.cjs').auditPortal(req, action, opts);
  } catch {
    /* denetim best-effort */
  }
}

// Kayit yazimi bir kez kisa gecikmeyle yeniden denenir (anlik DB hickirigi is zaten
// baslamisken kaydi kaybettirmesin). Donus: yazildi mi.
async function birKezTekrarla(ad, fn) {
  try {
    await fn();
    return true;
  } catch (e1) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      await fn();
      return true;
    } catch (e2) {
      console.warn(`[OpsX WAS] ${ad} yazilamadi (2 deneme):`, e2.message || e1.message);
      return false;
    }
  }
}

// RUN icin kesif dogrulamasi: AYNI kullanicinin, AYNI uygulama icin, en cok 15 dk
// once BITMIS kesfi; secilen host o kesfin hedefleri arasinda. Sonuc AWX'ten YENIDEN
// okunur - istemcinin gonderdigi duruma GUVENILMEZ. Donus: { discovery, started } -
// `started` (AWX) bayat-kesif kuralinda kullanilir (bkz. ws.staleDiscovery).
async function verifyDiscovery(user, { serverId, jobId, app, host }) {
  const rec = await loadJob(serverId, jobId);
  if (!rec.ok) throw httpError(rec.status, rec.message);
  if (!rec.found) throw httpError(403, 'Keşif kaydı bulunamadı — keşfi yeniden çalıştırın.');
  if (rec.params.platform !== PLATFORM.discover) {
    throw httpError(400, 'Gönderilen iş bir WAS keşfi değil.');
  }
  if (!sameUser(rec.owner, user.username)) {
    throw httpError(403, 'Bu keşif size ait değil — işlemden önce kendi keşfinizi çalıştırın.');
  }
  if (String(rec.params.app || '') !== app) {
    throw httpError(400, 'Keşif başka bir uygulama için yapılmış.');
  }
  const requested = targetHostsOf(rec.params);
  if (!requested.includes(host)) {
    throw httpError(409, `${host} bu keşifte taranmadı — keşfi bu sunucuyla yeniden çalıştırın.`);
  }
  const runner = require('../ansible/runner.cjs');
  const st = await runner.getJobStatusOnServer(serverId, jobId);
  if (!TERMINAL.has(st.status)) throw httpError(409, 'Keşif henüz bitmedi.');
  if (st.playbook && basenameOf(st.playbook) !== EXPECTED_PLAYBOOK.discover) {
    throw httpError(409, 'Gönderilen iş WAS keşif playbook\'u ile çalışmamış.');
  }
  const age = ws.discoveryAge(st.finished);
  if (!age.ok) {
    throw httpError(409, `Keşif sonucu geçersiz (${age.reason}) — keşfi yenileyin.`, {
      code: 'kesif_eski',
    });
  }
  const raw = statsOf(st.artifacts, STATS_KEYS.discover);
  if (!raw) throw httpError(409, 'Keşif sonucu okunamadı — keşfi yenileyin.');
  return { discovery: ws.parseDiscoverResult(raw, requested), started: st.started || null };
}

// ISLEM SONUCLANDIRMA - durum ucu (kullanici yoklamasi) ve uzlastirici (sunucu tarafi) AYNI
// fonksiyonu cagirir; mantik tek yerde. Idempotent: kilit birakma UPDATE'i held = 1 kosullu,
// sonuc denetimi opsx_was_ops.audited_at CAS'i ile TEK sefer.
async function finalizeOpJob({ serverId, jobId, st, owner, params, req, observer }) {
  const db = require('../db/index.cjs');
  const p = params || {};
  let parsed = ws.parseOpResult(statsOf(st.artifacts, STATS_KEYS.operation));
  let message = '';
  const fark = ws.opResultMismatch(parsed, p);
  if (fark) {
    message = `Yayınlanan sonuç bu isteğe ait değil (${fark} uyuşmuyor) — gerçek durum bilinmiyor.`;
    parsed = null;
  }
  const result = parsed || {
    host: String(p.host || ''),
    profile: String(p.profile || ''),
    cell: String(p.cell || ''),
    node: String(p.node || ''),
    server: String(p.server || ''),
    op: String(p.operation || ''),
    requestId: String(p.request_id || ''),
    before: '',
    after: '',
    result: 'OLCULEMEDI',
    steps: [],
    line: '',
  };
  if (!parsed && !message) {
    message =
      st.status === 'successful'
        ? "İş tamamlandı ancak sonuç alınamadı — gerçek durum bilinmiyor (playbook'un set_stats adımını kontrol edin)."
        : `İş ${st.status} ile bitti ve sonuç üretmedi — gerçek durum bilinmiyor.`;
  } else if (parsed && (result.result === 'OK' || result.result === 'SKIP') && st.status !== 'successful') {
    message = `İşlem sonucu ${result.result}, ancak AWX işi "${st.status}" ile bitti — sonraki adımlar (ör. envanter yazımı) başarısız olmuş olabilir.`;
  }

  // Kilit birakilir (UPDATE, DELETE yok) ve isin AWX bitis zamani kaydedilir.
  try {
    await ws.releaseLocksForJob(db, serverId, jobId, st.finished || new Date().toISOString());
  } catch (e) {
    console.warn('[OpsX WAS] kilit birakilamadi (uzlastirici/TTL ile dusecek):', e.message);
  }
  // Genel gecmis satiri (bilgi amacli; sonuc denetimi buna BAGLI DEGIL).
  try {
    await db.query(
      `UPDATE ansible_job_history SET status = $3, finished_at = COALESCE(finished_at, GETUTCDATE())
        WHERE job_id = $1 AND awx_server_id = $2 AND (finished_at IS NULL OR status <> $3)`,
      [jobId, serverId, st.status],
    );
  } catch (e) {
    console.warn('[OpsX WAS] gecmis durumu guncellenemedi:', e.message);
  }
  // SONUC DENETIMI - TEK sefer (opsx_was_ops.audited_at CAS).
  let first = false;
  try {
    first = await ws.markOpAudited(db, {
      serverId,
      jobId,
      result: result.result,
      before: result.before,
      after: result.after,
      awxStatus: st.status,
      finished: st.finished,
      requestId: p.request_id || null,
      username: owner || null,
      params: p,
    });
  } catch (e) {
    console.warn('[OpsX WAS] sonuc isareti yazilamadi (uzlastirici yeniden dener):', e.message);
  }
  if (first) {
    audit(req, 'opsx_was_result', {
      username: owner || undefined,
      targetHost: String(p.host || ''),
      result: ws.auditResultOf(result.result),
      detail: JSON.stringify({
        app: p.app,
        host: p.host,
        cell: p.cell,
        node: p.node,
        server: p.server,
        operation: p.operation,
        result: result.result,
        before: result.before,
        after: result.after,
        awxStatus: st.status,
        jobId,
        request_id: p.request_id || null,
        ...(fark ? { mismatch: fark } : {}),
        observedBy: observer || null,
      }),
    });
  }
  return { result, message };
}

// UZLASTIRICI (ScaleX reconciler deseni): sonucu yazilmamis WAS islemlerini ve bir ise bagli
// dolu kilitleri SUNUCU TARAFINDA sonuclandirir. Kullanici sekmeyi kapatsa da sonuc denetimi
// yazilir ve kilit (bitis zamaniyla) birakilir. Birincil yol hala durum ucu.
async function reconcileTick({ limit = 20 } = {}) {
  const db = require('../db/index.cjs');
  const runner = require('../ansible/runner.cjs');
  const jobs = await ws.pendingWasJobs(db, limit);
  let islenen = 0;
  for (const { serverId, jobId } of jobs) {
    let st;
    try {
      st = await runner.getJobStatusOnServer(serverId, jobId);
    } catch (e) {
      console.warn(`[OpsX WAS] uzlastirici: AWX #${jobId} okunamadi:`, e.message);
      continue;
    }
    if (!TERMINAL.has(st.status)) continue;
    const rec = await loadJob(serverId, jobId, { opsFallback: true });
    if (rec.ok && rec.found && rec.params.platform === PLATFORM.operation) {
      await finalizeOpJob({
        serverId,
        jobId,
        st,
        owner: rec.owner,
        params: rec.params,
        req: null,
        observer: 'system:opsx-was-uzlastirici',
      });
    } else {
      try {
        await ws.releaseLocksForJob(db, serverId, jobId, st.finished || new Date().toISOString());
      } catch (e) {
        console.warn('[OpsX WAS] uzlastirici: kilit birakilamadi:', e.message);
      }
    }
    islenen++;
  }
  return islenen;
}

let reconcileTimer = null;
function startWasReconciler() {
  if (reconcileTimer) return;
  const sn = Math.max(Number(process.env.OPSX_WAS_RECONCILE_INTERVAL_SECONDS) || 120, 30);
  const run = () => reconcileTick().catch((e) => console.warn('[OpsX WAS] uzlastirici tick hatasi:', e.message));
  reconcileTimer = setInterval(run, sn * 1000);
  reconcileTimer.unref?.();
  const kick = setTimeout(run, 20_000);
  kick.unref?.();
}

function lockBusyError(lock) {
  const row = lock.busy || {};
  const which = String(lock.busyKey || '').startsWith('A|') ? 'Bu uygulamada' : 'Bu JVM üzerinde';
  const who = row.holder ? ` (${row.holder}` + (row.awx_job_id ? `, AWX #${row.awx_job_id})` : ')') : '';
  return httpError(
    409,
    `${which} süren bir WAS işlemi var${who}. Aynı uygulamanın iki sunucusu aynı anda indirilmez — ` +
      'işlem bitince tekrar deneyin.',
    {
      code: 'kilit_dolu',
      lock: {
        scope: String(lock.busyKey || '').startsWith('A|') ? 'app' : 'target',
        holder: row.holder || null,
        target: row.target_desc || null,
        jobId: row.awx_job_id ?? null,
      },
    },
  );
}

function initOpsXWas(app, deps = {}) {
  const express = require('express');
  let requireAuth = deps.requireAuth;
  if (typeof requireAuth !== 'function') {
    requireAuth = (req, res) => res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
    try {
      const authMod = require('../auth/index.cjs');
      if (typeof authMod.requireAuth === 'function') requireAuth = authMod.requireAuth;
    } catch {
      /* auth modulu yoksa deny kalir */
    }
  }

  // GET /api/opsx/was/apps?search= - WASAppsInventory'den JVM (uygulama) adlari.
  // NOAPP satirlari dislanir. Kisitli uygulamalar Admin disindakilere LISTELENMEZ.
  app.get('/api/opsx/was/apps', requireAuth, async (req, res) => {
    try {
      const user = currentUser(req);
      const term = String(req.query.search || '').trim().slice(0, 100);
      const pool = await inventoryPool();
      const r = pool.request();
      r.input('q', `%${term}%`);
      const result = await r.query(
        `SELECT DISTINCT TOP (${APP_LIST_MAX + 1}) app FROM ${getWasAppsTable()} ` +
          `WHERE app LIKE @q AND UPPER(LTRIM(RTRIM(app))) <> 'NOAPP' ORDER BY app`,
      );
      const hepsi = (result.recordset || [])
        .map((x) => String(x.app || '').trim())
        .filter((a) => a && !ws.isNoApp(a));
      const truncated = hepsi.length > APP_LIST_MAX;
      const apps = truncated ? hepsi.slice(0, APP_LIST_MAX) : hepsi;
      const restrictions = require('../logx/v2/restrictions.cjs');
      let allowed;
      try {
        allowed = await restrictions.filterAllowed('legacy_app', apps, user);
      } catch (e) {
        console.warn('[OpsX WAS] uygulama listesi kisit filtresi basarisiz - liste verilmedi:', e.message);
        throw httpError(503, 'Erişim kısıtlamaları okunamadı — liste gösterilemiyor.');
      }
      res.json({ ok: true, apps: allowed, truncated, limit: APP_LIST_MAX });
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /api/opsx/was/hosts?app= - uygulamanin envanterdeki sunuculari. AIX satirlari
  // GORUNUR ama selectable=false. env normalize edilmis (PROD -> Production).
  app.get('/api/opsx/was/hosts', requireAuth, async (req, res) => {
    try {
      const appName = cleanApp(req.query.app);
      await assertAppAllowed(appName, currentUser(req));
      const hosts = await inventoryHostsForApp(appName);
      res.json({ ok: true, app: appName, hosts, maxDiscoverHosts: ws.MAX_DISCOVER_HOSTS });
    } catch (err) {
      sendError(res, err);
    }
  });

  // POST /api/opsx/was/discover - SALT OKUNUR kesif. `hosts` verilmezse uygulamanin
  // TUM Linux sunuculari (en cok 10); verilirse her biri envanterde ve Linux olmali.
  app.post('/api/opsx/was/discover', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const user = currentUser(req);
      const appName = cleanApp(req.body?.app);
      await assertAppAllowed(appName, user);
      const inv = await inventoryHostsForApp(appName);
      if (!inv.length) throw httpError(404, `${appName} WAS envanterinde bulunamadı.`);
      let hosts;
      if (req.body?.hosts !== undefined) {
        if (!Array.isArray(req.body.hosts)) throw httpError(400, 'hosts bir liste olmalı.');
        hosts = [...new Set(req.body.hosts.map((h) => ws.normalizeHost(h)).filter(Boolean))];
        for (const h of hosts) {
          const row = inv.find((x) => x.host === h);
          if (!row) throw httpError(400, `${h} bu uygulamanın envanterinde yok.`);
          if (!row.selectable) throw httpError(400, `${h}: ${row.reason}`);
        }
      } else {
        hosts = inv.filter((h) => h.selectable).map((h) => h.host);
      }
      if (!hosts.length) {
        throw httpError(400, 'Keşfedilecek Linux sunucusu yok (AIX ve diğerleri bu sürümde desteklenmiyor).');
      }
      if (hosts.length > ws.MAX_DISCOVER_HOSTS) {
        throw httpError(
          400,
          `Tek keşifte en çok ${ws.MAX_DISCOVER_HOSTS} sunucu taranır (${hosts.length} seçildi) — sunucu seçin.`,
          { code: 'cok_sunucu' },
        );
      }

      const tpl = await resolveTemplate('discover');
      if (!tpl.templateId) throw notConfigured('discover', tpl.keyName);
      await assertTemplatePlaybook('discover', tpl);
      // was_server_filter = uygulama (JVM) adi: betik yalniz o JVM'i ve ayni kumedeki
      // kardeslerini olcer. Cok JVM'li hostta hedef JVM kesif butcesi (300 sn) dolmadan
      // olculur; peers mantigi (ayni ad + ayni kume) icin gereken her sey yine olculur.
      const extraVars = { target_hosts: hosts.join(','), was_server_filter: appName };
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(
        tpl.serverId,
        tpl.templateId,
        extraVars,
        { label: tpl.keyName },
      );
      const runner = require('../ansible/runner.cjs');
      // limit BILEREK '' - AWX'e limit GONDERILMEZ (dosya basi).
      const result = await runner.launchJobOnServer(tpl.serverId, tpl.templateId, extraVars, '', user);
      try {
        await insertHistory(req, {
          serverId: tpl.serverId,
          templateId: tpl.templateId,
          templateName: 'OpsX: WAS keşfi',
          jobId: result?.jobId,
          status: result?.status,
          params: { platform: PLATFORM.discover, app: appName, target_hosts: hosts.join(',') },
        });
      } catch (e) {
        console.warn('[OpsX WAS] kesif gecmisi yazilamadi:', e.message);
        throw httpError(
          503,
          'Keşif başlatıldı ama kaydı yazılamadı; sonucu size gösterilemez. Lütfen tekrar deneyin.',
        );
      }
      audit(req, 'opsx_was_discover', {
        detail: JSON.stringify({ app: appName, hosts, jobId: result?.jobId ?? null }),
      });
      console.log(
        `[OpsX WAS] ${user.username} -> kesif app=${appName} hosts=${hosts.join(',')} template=${tpl.templateId} server=${tpl.serverId} job=${result?.jobId ?? '?'}`,
      );
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: tpl.serverId,
        hosts,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /api/opsx/was/discover/:serverId/:jobId/status
  app.get('/api/opsx/was/discover/:serverId/:jobId/status', requireAuth, async (req, res) => {
    const ids = parseIds(req);
    if (!ids) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    try {
      const auth = await authorizeJob(req, ids.serverId, ids.jobId, PLATFORM.discover);
      if (!auth.ok) return res.status(auth.status).json({ ok: false, message: auth.message });
      const runner = require('../ansible/runner.cjs');
      const st = await runner.getJobStatusOnServer(ids.serverId, ids.jobId);
      if (!TERMINAL.has(st.status)) return res.json({ ok: true, status: st.status });
      // BASARISIZ ISTE DE ARTIFACT OKUNUR (bkz. index.cjs, 2026-09-30 notu).
      const raw = statsOf(st.artifacts, STATS_KEYS.discover);
      if (!raw) {
        return res.json({
          ok: true,
          status: st.status,
          message:
            st.status === 'successful'
              ? "İş tamamlandı ancak keşif sonucu alınamadı — playbook'un set_stats adımını kontrol edin."
              : 'Keşif sonucu alınamadı (iş başarısız oldu).',
        });
      }
      const appName = String(auth.params.app || '');
      const discovery = ws.parseDiscoverResult(raw, targetHostsOf(auth.params));
      const targets = ws.targetsForApp(discovery, appName);
      const finishedMs = new Date(String(st.finished || '')).getTime();
      let appLock = null;
      try {
        const row = await ws.activeAppLock(require('../db/index.cjs'), appName);
        if (row) {
          appLock = { holder: row.holder || null, target: row.target_desc || null, jobId: row.awx_job_id ?? null };
        }
      } catch {
        /* bilgi amacli; karar /run'da kilitle verilir */
      }
      res.json({
        ok: true,
        status: st.status,
        app: appName,
        hosts: discovery.hosts.map((h) => ({
          host: h.host,
          overall: h.overall,
          reason: h.reason,
          hasApp: targets.some((t) => t.host === h.host),
        })),
        targets,
        finishedAt: st.finished || null,
        validUntil: Number.isFinite(finishedMs)
          ? new Date(finishedMs + ws.DISCOVERY_MAX_AGE_MS).toISOString()
          : null,
        appLock,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // POST /api/opsx/was/run - TEK host + TEK JVM.
  app.post('/api/opsx/was/run', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
    const user = currentUser(req);
    const b = req.body || {};
    try {
      // 1) TOPLU ISLEM YOK - dizi ya da coklu alan gelirse en bastan red.
      if (b.hosts !== undefined || b.targets !== undefined || typeof b.host !== 'string') {
        throw httpError(400, 'Tek bir sunucu (metin) gerekli — toplu işlem yapılmaz.');
      }
      for (const k of ['profile', 'cell', 'node', 'server']) {
        if (typeof b[k] !== 'string' || !ws.isValidName(b[k].trim())) {
          throw httpError(400, `Geçersiz ${k} değeri.`);
        }
      }
      const appName = cleanApp(b.app);
      const host = ws.normalizeHost(b.host);
      if (!ws.isValidName(host)) throw httpError(400, 'Geçersiz sunucu adı.');
      const profile = b.profile.trim();
      const cell = b.cell.trim();
      const node = b.node.trim();
      const server = b.server.trim();
      const operation = b.operation;
      if (!ws.OPERATIONS.includes(operation)) throw httpError(400, 'Geçersiz işlem.');

      // 2) ACIK ONAY: kutu + JVM adinin elle yazilmasi.
      if (b.confirmed !== true) throw httpError(400, 'Bu işlem açık onay ister (confirmed).');
      if (typeof b.confirmText !== 'string' || b.confirmText.trim() !== server) {
        throw httpError(400, 'Onay metni JVM adıyla birebir aynı olmalı.');
      }

      // 3) JVM = uygulama (birebir). Baska uygulamanin JVM'i bu uctan hedeflenemez.
      if (server !== appName) {
        throw httpError(400, 'JVM adı seçilen uygulamayla birebir aynı olmalı.');
      }

      // 4) Yetki.
      await assertAppAllowed(appName, user);

      // 5) Host bu uygulamanin envanterinde ve Linux.
      const inv = await inventoryHostsForApp(appName);
      const invHost = inv.find((h) => h.host === host);
      if (!invHost) throw httpError(400, `${host} bu uygulamanın envanterinde yok.`);
      if (!invHost.selectable) throw httpError(400, `${host}: ${invHost.reason}`);

      // 6) Kesif: ayni kullanici, <= 15 dk, hedef olculmus.
      const discoverJobId = Number(b.discoverJobId);
      const discoverServerId = Number(b.discoverServerId);
      if (!Number.isInteger(discoverJobId) || discoverJobId <= 0 || !Number.isInteger(discoverServerId) || discoverServerId < 0) {
        throw httpError(400, 'Keşif iş numarası gerekli — önce keşfi çalıştırın.');
      }
      const { discovery, started: discoveryStarted } = await verifyDiscovery(user, {
        serverId: discoverServerId,
        jobId: discoverJobId,
        app: appName,
        host,
      });
      const target = ws.findTarget(discovery, { host, profile, cell, node, server });
      const gate = ws.gateOperation(target, operation);
      if (!gate.ok) throw httpError(gate.status, gate.message, { code: 'durum_kapisi' });
      const warnings = ws.computeWarnings(discovery, target, operation);
      if (warnings.length && b.ackWarnings !== true) {
        throw httpError(409, 'Bu işlem için uyarıları okuyup onaylamanız gerekiyor.', {
          code: 'uyari_onayi',
          warnings,
        });
      }

      // 7) Template.
      const tpl = await resolveTemplate('operation');
      if (!tpl.templateId) throw notConfigured('operation', tpl.keyName);
      await assertTemplatePlaybook('operation', tpl);
      const requestId = crypto.randomUUID();
      const extraVars = {
        target_host: host,
        was_profile: profile,
        was_cell: cell,
        was_node: node,
        was_server: server,
        operation,
        consent: true,
        confirm_text: server,
        opsx_request_id: requestId,
      };
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(
        tpl.serverId,
        tpl.templateId,
        extraVars,
        { label: tpl.keyName },
      );

      // 8) Kilit (uygulama + hedef). DB hatasi = RET.
      const db = require('../db/index.cjs');
      const runner = require('../ansible/runner.cjs');
      const keys = ws.lockKeys({ app: appName, host, cell, node, server });
      let lock;
      try {
        lock = await ws.acquireLocks(db, keys, {
          lockId: requestId,
          holder: user.username || 'unknown',
          desc: `${operation} ${host}/${server}`,
          ttlMin: ws.lockTtlMinutes(),
          isJobTerminal: async (sid, jid) => {
            const s = await runner.getJobStatusOnServer(sid, jid);
            return { terminal: TERMINAL.has(s.status), finished: s.finished || null };
          },
        });
      } catch (e) {
        console.warn('[OpsX WAS] kilit alinamadi (DB) - islem reddedildi:', e.message);
        throw httpError(503, 'İşlem kilidi alınamadı — işlem başlatılmadı, lütfen tekrar deneyin.');
      }
      if (!lock.ok) throw lockBusyError(lock);

      // 8b) BAYAT KESIF (LB cifti): kesif bu uygulamadaki SON islem bitmeden baslamissa
      // kardeslerin durumu (SON_CALISAN) o islemden onceki olcumdur - RED. Kilit ALINDIKTAN
      // sonra okunur: bayat kilit yolunda (acquireLocks) biten isin zamani o an yazilir.
      let bayat = '';
      try {
        const appRow = await ws.readLock(db, keys.app);
        bayat = ws.staleDiscovery(discoveryStarted, appRow?.last_op_finished_at);
      } catch (e) {
        await ws.releaseLocks(db, keys, requestId).catch(() => {});
        console.warn('[OpsX WAS] son islem zamani okunamadi - islem reddedildi:', e.message);
        throw httpError(503, 'Uygulamanın son işlem zamanı okunamadı — işlem başlatılmadı, lütfen tekrar deneyin.');
      }
      if (bayat) {
        await ws.releaseLocks(db, keys, requestId).catch(() => {});
        throw httpError(
          409,
          `Keşif sonucu bu uygulamadaki son WAS işlemine göre bayat (${bayat}). Diğer sunuculardaki ` +
            'durum değişmiş olabilir — keşfi yenileyin.',
          { code: 'kesif_eski' },
        );
      }

      // 9) Launch - limit BILEREK ''.
      let result;
      try {
        result = await runner.launchJobOnServer(tpl.serverId, tpl.templateId, extraVars, '', user);
        if (result?.jobId == null) throw httpError(502, 'AWX iş numarası döndürmedi.');
      } catch (e) {
        try {
          await ws.releaseLocks(db, keys, requestId);
        } catch (re) {
          console.warn('[OpsX WAS] launch hatasi sonrasi kilit birakilamadi:', re.message);
        }
        throw e;
      }
      try {
        await ws.bindLocks(db, keys, requestId, { awxServerId: tpl.serverId, awxJobId: result.jobId });
      } catch (e) {
        // Kilit tam TTL ile alindi; baglanamamasi yalniz erken birakmayi geciktirir.
        console.warn('[OpsX WAS] kilit isle baglanamadi (TTL ile dusecek):', e.message);
      }

      // 10) Gecmis + denetim (BASLATMA). Sonuc ayri kayit olarak durum ucunda yazilir.
      const params = {
        platform: PLATFORM.operation,
        app: appName,
        host,
        profile,
        cell,
        node,
        server,
        operation,
        env: invHost.env,
        discover_job_id: discoverJobId,
        request_id: requestId,
      };
      // Is ZATEN baslatildi: kayit hatasi istegi geri cevirmez ama SESSIZCE YUTULMAZ. Iki
      // bagimsiz kayit (genel gecmis + WAS islem kaydi), her biri bir kez yeniden denenir;
      // biri yazilirsa durum ucu sahibi bulur. Ikisi de yazilamazsa yanit ve denetim bunu soyler.
      const historyOk = await birKezTekrarla('islem gecmisi', () =>
        insertHistory(req, {
          serverId: tpl.serverId,
          templateId: tpl.templateId,
          templateName: 'OpsX: WAS işlem',
          jobId: result.jobId,
          status: result.status,
          params,
        }),
      );
      const opsOk = await birKezTekrarla('islem kaydi', () =>
        ws.insertOpRecord(db, {
          serverId: tpl.serverId,
          jobId: result.jobId,
          requestId,
          username: user.username || 'unknown',
          params,
        }),
      );
      const kayitVar = historyOk || opsOk;
      audit(req, 'opsx_was_operation', {
        targetHost: host,
        detail: JSON.stringify({
          ...params,
          stage: 'baslatildi',
          jobId: result.jobId,
          warnings: warnings.map((w) => w.code),
          ...(historyOk ? {} : { historyMissing: true }),
          ...(opsOk ? {} : { opsRecordMissing: true }),
        }),
      });
      console.log(
        `[OpsX WAS] ${user.username} -> ${operation} app=${appName} host=${host} cell=${cell} node=${node} server=${server} template=${tpl.templateId} server=${tpl.serverId} job=${result.jobId}`,
      );
      res.json({
        ok: true,
        jobId: result.jobId,
        status: result.status ?? null,
        awxServerId: tpl.serverId,
        templateId: tpl.templateId,
        requestId,
        historyWritten: kayitVar,
        ...(kayitVar
          ? {}
          : {
              warning:
                `İşlem başlatıldı (AWX #${result.jobId}) ancak kaydı Portal veritabanına yazılamadı: sonucu bu ` +
                `ekrandan izlenemeyebilir. Durumu AWX'te #${result.jobId} numaralı işten kontrol edin.`,
            }),
        sentBody: { extra_vars: extraVars },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /api/opsx/was/run/:serverId/:jobId/status - canli cikti + terminalde sonuc.
  app.get('/api/opsx/was/run/:serverId/:jobId/status', requireAuth, async (req, res) => {
    const ids = parseIds(req);
    if (!ids) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    try {
      const auth = await authorizeJob(req, ids.serverId, ids.jobId, PLATFORM.operation);
      if (!auth.ok) return res.status(auth.status).json({ ok: false, message: auth.message });
      const runner = require('../ansible/runner.cjs');
      const st = await runner.getJobStatusOnServer(ids.serverId, ids.jobId);
      let output = '';
      try {
        output = ws.maskSecrets((await runner.getJobOutputOnServer(ids.serverId, ids.jobId))?.output || '');
      } catch {
        /* cikti ikincil; durum yine doner */
      }
      if (!TERMINAL.has(st.status)) return res.json({ ok: true, status: st.status, output });

      const { result, message } = await finalizeOpJob({
        serverId: ids.serverId,
        jobId: ids.jobId,
        st,
        owner: auth.owner,
        params: auth.params,
        req,
        observer: currentUser(req).username || null,
      });
      res.json({
        ok: true,
        status: st.status,
        output,
        result,
        severity: ws.resultSeverity(result.result),
        ...(message ? { message } : {}),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Uzlastirici: testler `reconcile: false` verir ve reconcileTick'i dogrudan cagirir.
  if (deps.reconcile !== false && process.env.OPSX_WAS_RECONCILE !== '0') startWasReconciler();

  console.log('[OpsX] WAS endpoints mounted at /api/opsx/was');
}

// Genel durum uclari (/api/opsx/job-status, /api/ansible/ss/job-status) WAS isini tanisin
// diye: playbook dosya adi ya da gecmis satirinin platform alani.
function isWasPlaybook(playbook) {
  const b = basenameOf(playbook);
  return b === EXPECTED_PLAYBOOK.discover || b === EXPECTED_PLAYBOOK.operation;
}

function isWasPlatform(params) {
  return /^was-/.test(String(parseParams(params)?.platform || ''));
}

module.exports = {
  initOpsXWas,
  reconcileTick,
  isWasPlaybook,
  isWasPlatform,
  WAS_KEYS,
  EXPECTED_PLAYBOOK,
  PLATFORM,
  STATS_KEYS,
};
