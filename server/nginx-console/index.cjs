// server/nginx-console/index.cjs — "Nginx Hub" (2026-09-19): tum nginx sunucularinin
// konfigurasyon agaci, dosya icerikleri, sertifika envanteri ve TEK dosya push'u.
//
// MIMARI (kullanici kisitlari): Portal sunuculara YALNIZ Ansible ile ulasir; nginx
// dosyalarina www kullanicisiyla (dzdo) dokunulur. Bu yuzden:
//   - OKUMA: nginx_console_fetch.yml secilen host(lar)ta files/nginx_console_dump.sh'i kosar,
//     ciktiyi GBLABT02 uzerinden /sw/BMW_PORTAL/nginx_console/raw/<HOST>.txt'ye yazar;
//     Portal AYNI mount'u dogrudan okur (bkz. hafiza: Portal /sw'ye dogrudan erisir).
//     Tum filo taramasi 30-40 dk surer (kullanici deneyimi) -> ekrandaki "Yenile" yalniz
//     secilen hostlari gonderir; tam tarama AWX'te gece zamanlanir.
//   - YAZMA: nginx_console_push.yml (yol beyaz listesi, deployment kilidi, yedek, nginx -t,
//     geri alma, reload) ve ardindan o host'un dokumu yenilenir. Yalniz Admin.
//
// Dokum ayristirma SAF modulde (dump-parse.cjs) — test edilir. Bu dosya: HTTP + AWX + cache.
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseDump, buildTree, aggregateCerts, daysLeft } = require('./dump-parse.cjs');

const REGISTRY_KEYS = Object.freeze({
  fetch: 'nginx_console_fetch',
  push: 'nginx_console_push',
});

function consoleDir() {
  return (process.env.NGINX_CONSOLE_DIR || '/sw/BMW_PORTAL/nginx_console').replace(/\/+$/, '');
}
function rawDir() {
  return path.join(consoleDir(), 'raw');
}

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/;
const ALLOWED_PATH_RE = /^\/usr\/nginx\/(conf\.d|conf)\/[^\0]+$/;
const MAX_CONTENT = 512 * 1024;

// ── Dokum onbellegi (dosya mtime'i degismedikce yeniden ayristirilmaz) ─────────────────
const _cache = new Map(); // HOST -> { mtimeMs, parsed }

function dumpPathOf(host) {
  return path.join(rawDir(), `${String(host).toUpperCase()}.txt`);
}

function loadDump(host) {
  const p = dumpPathOf(host);
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return null;
  }
  const hit = _cache.get(host.toUpperCase());
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.parsed;
  const parsed = parseDump(fs.readFileSync(p, 'utf8'));
  parsed.dumpedAt = st.mtime.toISOString();
  parsed.host = parsed.host || host.toUpperCase();
  _cache.set(host.toUpperCase(), { mtimeMs: st.mtimeMs, parsed });
  return parsed;
}

function listDumpedHosts() {
  try {
    return fs
      .readdirSync(rawDir())
      .filter((f) => f.endsWith('.txt'))
      .map((f) => {
        const st = fs.statSync(path.join(rawDir(), f));
        return { host: f.slice(0, -4).toUpperCase(), dumpedAt: st.mtime.toISOString(), size: st.size };
      });
  } catch {
    return [];
  }
}

// ── Envanter: nginx sunuculari (dbo.nginx_inventory, nginx_metadata job'i) ──────────────
async function inventoryHosts() {
  const { query } = require('../inventory/mssql.cjs');
  const r = await query(
    `SELECT hostname, env, location, service, services, nginx_version, nginx_prefix, config_count, ip
       FROM dbo.nginx_inventory ORDER BY env, service, hostname`,
  );
  return (r.recordset || []).map((x) => ({
    host: String(x.hostname || '').trim().toUpperCase(),
    env: String(x.env || '').trim().toLowerCase() || null,
    location: x.location || null,
    service: x.service || null,
    services: String(x.services || '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    nginxVersion: x.nginx_version || null,
    prefix: x.nginx_prefix || null,
    configCount: x.config_count == null ? null : Number(x.config_count),
    ip: x.ip || null,
  })).filter((h) => h.host);
}

// ── AWX ─────────────────────────────────────────────────────────────────────────────────
async function resolveByKey(keyName) {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(keyName).catch(() => null);
  if (!row || row.enabled === false) return { templateId: null, serverId: null, keyName };
  const templateId = reg.getEffectiveTemplateId(row);
  const serverId = row.awxServerId != null ? Number(row.awxServerId) : 0;
  return { templateId: templateId || null, serverId, keyName };
}

async function launch(req, keyName, templateName, extraVars, platformDetail) {
  const { templateId, serverId } = await resolveByKey(keyName);
  if (!templateId) {
    throw Object.assign(
      new Error(`AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${keyName}" satırına Template ID girilmeli.`),
      { status: 501 },
    );
  }
  const runner = require('../ansible/runner.cjs');
  await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: keyName });
  const user = req.session?.user || {};
  const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '', user);
  try {
    const db = require('../db/index.cjs');
    await db.query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.username || 'unknown', serverId, templateId, templateName, result?.jobId, result?.status || 'pending', JSON.stringify({ ...extraVars, content_b64: extraVars.content_b64 ? `<${extraVars.content_b64.length} b64>` : undefined })],
    );
  } catch (e) {
    console.warn('[NginxConsole] job gecmisi yazilamadi:', e.message);
  }
  try {
    require('../audit/index.cjs').auditPortal(req, 'nginx_console', { detail: JSON.stringify({ ...platformDetail, jobId: result?.jobId ?? null }) });
  } catch { /* best-effort */ }
  return { jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId };
}

function isAdmin(req) {
  return req.session?.user?.role === 'Admin';
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────
function initNginxConsole(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));
  router.use(requireAuth);
  // YALNIZ Admin (kullanici, 2026-09-19): sayfa elementi de Admin'e seed'lenir; burada
  // sunucu tarafinda da kapali ki gorunurluk kurali degistirilse bile uclar acilmasin.
  router.use((req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ ok: false, message: 'Nginx Hub yalnız Admin.' })));
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('NginxConsole'));
  } catch { /* motor yoksa yoksay */ }

  // Sunucu listesi: envanter (env/servis) + dokum durumu (var mi, ne zaman, nginx -t, sertifika sayisi)
  router.get('/hosts', async (_req, res) => {
    try {
      let inv = [];
      let invError = null;
      try {
        inv = await inventoryHosts();
      } catch (e) {
        invError = e.message;
      }
      const dumped = new Map(listDumpedHosts().map((d) => [d.host, d]));
      const seen = new Set();
      const hosts = inv.map((h) => {
        seen.add(h.host);
        const d = dumped.get(h.host);
        const parsed = d ? loadDump(h.host) : null;
        return {
          ...h,
          dumpedAt: d ? d.dumpedAt : null,
          nginxT: parsed ? parsed.nginxT.status : null,
          fileCount: parsed ? parsed.tree.length : null,
          certCount: parsed ? parsed.certs.size : null,
          certMinDays: parsed ? minDays(parsed) : null,
        };
      });
      // Envanterde olmayip dokumu olan host'lar da listelenir (envanter gecikmis olabilir)
      for (const d of dumped.values()) {
        if (seen.has(d.host)) continue;
        const parsed = loadDump(d.host);
        hosts.push({ host: d.host, env: null, location: null, service: null, services: [], nginxVersion: null, prefix: null, configCount: null, ip: null, dumpedAt: d.dumpedAt, nginxT: parsed ? parsed.nginxT.status : null, fileCount: parsed ? parsed.tree.length : null, certCount: parsed ? parsed.certs.size : null, certMinDays: parsed ? minDays(parsed) : null, inventoryMissing: true });
      }
      res.json({ ok: true, hosts, consoleDir: consoleDir(), inventoryError: invError });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  router.get('/tree/:host', (req, res) => {
    const host = String(req.params.host || '').toUpperCase();
    if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    const d = loadDump(host);
    if (!d) return res.json({ ok: true, host, dumped: false, message: 'Bu sunucu için henüz dokum yok — "Yenile" ile alın.' });
    res.json({
      ok: true,
      host,
      dumped: true,
      dumpedAt: d.dumpedAt,
      time: d.time,
      prefix: d.prefix,
      nginxT: d.nginxT,
      tree: buildTree(d.tree, d.prefix),
      fileCount: d.tree.length,
      certs: [...d.certs.values()].map((c) => ({ ...c, daysLeft: daysLeft(c.notAfter) })),
      certUses: d.certUses,
    });
  });

  router.get('/file/:host', (req, res) => {
    const host = String(req.params.host || '').toUpperCase();
    const p = String(req.query.path || '');
    if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    const d = loadDump(host);
    if (!d) return res.status(400).json({ ok: false, message: 'Dokum yok.' });
    const f = d.files.get(p);
    const t = d.tree.find((x) => x.path === p);
    if (!f && !t) return res.status(400).json({ ok: false, message: 'Dosya dokumde yok.' });
    res.json({ ok: true, host, path: p, sha256: f ? f.sha256 : t.sha256, size: f ? f.size : t.size, mtime: t ? t.mtime : null, content: f ? f.content : null, tooLarge: !f });
  });

  // Ayni dosya farkli sunucularda: (host -> sha) — "bu dosya hangi sunucuda farkli?"
  router.get('/compare', (req, res) => {
    const p = String(req.query.path || '');
    const hostsParam = String(req.query.hosts || '');
    const hosts = hostsParam ? hostsParam.split(',').map((h) => h.trim().toUpperCase()).filter((h) => HOST_RE.test(h)) : listDumpedHosts().map((d) => d.host);
    const rows = [];
    for (const h of hosts) {
      const d = loadDump(h);
      if (!d) continue;
      const t = d.tree.find((x) => x.path === p);
      rows.push({ host: h, exists: !!t, sha256: t ? t.sha256 : null, size: t ? t.size : null, mtime: t ? t.mtime : null });
    }
    const groups = new Map();
    for (const r of rows) if (r.exists) groups.set(r.sha256, (groups.get(r.sha256) || 0) + 1);
    res.json({ ok: true, path: p, rows, variants: groups.size });
  });

  // Sertifika envanteri (tum dokumler; ?host= ile tek sunucu)
  router.get('/certs', (req, res) => {
    const only = String(req.query.host || '').toUpperCase();
    const hosts = only ? [only] : listDumpedHosts().map((d) => d.host);
    const dumps = hosts.map(loadDump).filter(Boolean);
    const certs = aggregateCerts(dumps);
    const now = Date.now();
    res.json({
      ok: true,
      hostsScanned: dumps.length,
      certs,
      summary: {
        total: certs.length,
        expired: certs.filter((c) => c.daysLeft != null && c.daysLeft < 0).length,
        within30: certs.filter((c) => c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= 30).length,
        within90: certs.filter((c) => c.daysLeft != null && c.daysLeft > 30 && c.daysLeft <= 90).length,
        missing: certs.filter((c) => !c.exists).length,
        selfSigned: certs.filter((c) => c.selfSigned).length,
        generatedAt: new Date(now).toISOString(),
      },
    });
  });

  // Dokum yenile: secilen host'lar (tum filo 30-40 dk — istemci uyarir)
  router.post('/refresh', async (req, res) => {
    const list = Array.isArray(req.body?.hosts) ? req.body.hosts : [];
    const hosts = [...new Set(list.map((h) => String(h || '').trim().toUpperCase()).filter((h) => HOST_RE.test(h)))];
    if (!hosts.length) return res.status(400).json({ ok: false, message: 'En az bir sunucu seçilmeli.' });
    if (hosts.length > 400) return res.status(400).json({ ok: false, message: 'Tek seferde en fazla 400 sunucu.' });
    try {
      const extraVars = { target_hosts: hosts, console_dir: consoleDir(), requester: req.session?.user?.username || '' };
      const r = await launch(req, REGISTRY_KEYS.fetch, 'Nginx Hub: dokum yenile', extraVars, { op: 'fetch', hosts });
      res.json({ ok: true, ...r, hosts });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Publish (NIM "Publish" karsiligi): BIR dosya, bir ya da daha fazla sunucu (instance group =
  // servis). Yalniz Admin. expectedSha: host basina Portal'in gordugu sha (anti-TOCTOU).
  router.post('/push', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, message: 'Konfigürasyon değişikliği yalnız Admin.' });
    const list = Array.isArray(req.body?.hosts) ? req.body.hosts : req.body?.host ? [req.body.host] : [];
    const hosts = [...new Set(list.map((h) => String(h || '').trim().toUpperCase()).filter(Boolean))];
    const filePath = String(req.body?.path || '').trim();
    const mode = String(req.body?.mode || 'update');
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    const expectedIn = req.body?.expectedSha && typeof req.body.expectedSha === 'object' ? req.body.expectedSha : {};
    if (req.body?.expectedSha256 && hosts.length === 1) expectedIn[hosts[0]] = String(req.body.expectedSha256);
    const force = req.body?.force === true;
    if (!hosts.length || hosts.some((h) => !HOST_RE.test(h))) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    if (hosts.length > 50) return res.status(400).json({ ok: false, message: 'Tek seferde en fazla 50 sunucu.' });
    if (!ALLOWED_PATH_RE.test(filePath) || filePath.includes('..') || filePath.includes('/.console_backup/')) {
      return res.status(400).json({ ok: false, message: 'Yol yalnız /usr/nginx/conf.d/ veya /usr/nginx/conf/ altında olabilir.' });
    }
    if (!['create', 'update'].includes(mode)) return res.status(400).json({ ok: false, message: 'mode create|update olmalı.' });
    if (content == null || !content.trim()) return res.status(400).json({ ok: false, message: 'İçerik boş.' });
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT) return res.status(400).json({ ok: false, message: 'İçerik 512 KB sınırını aşıyor.' });
    if (/\x00/.test(content)) return res.status(400).json({ ok: false, message: 'İçerikte geçersiz karakter.' });

    // Host basina on kontrol (dokum uzerinden): update'te dosya var mi + sha; create'te dosya yok mu.
    const expected = {};
    const conflicts = [];
    for (const h of hosts) {
      const d = loadDump(h);
      const t = d ? d.tree.find((x) => x.path === filePath) : null;
      if (mode === 'update') {
        if (!t) { conflicts.push({ host: h, reason: 'dosya dokumde yok (önce Yenile)' }); continue; }
        const exp = String(expectedIn[h] || '').trim();
        if (!force && exp && exp !== t.sha256) conflicts.push({ host: h, reason: 'dosya siz açtıktan sonra değişmiş', currentSha256: t.sha256 });
        expected[h] = t.sha256; // sunucuda son gorulen hal; betik bununla karsilastirir
      } else if (t && !force) {
        conflicts.push({ host: h, reason: 'bu yolda dosya zaten var — update kullanın' });
      }
    }
    if (conflicts.length) return res.status(409).json({ ok: false, message: `Ön kontrol: ${conflicts.map((c) => `${c.host}: ${c.reason}`).join('; ')}`, conflicts, currentSha256: conflicts[0]?.currentSha256 || null });

    const normalized = content.replace(/\r\n/g, '\n');
    const body = normalized.endsWith('\n') ? normalized : normalized + '\n';
    const content_b64 = Buffer.from(body, 'utf8').toString('base64');
    const newSha = crypto.createHash('sha256').update(body).digest('hex');
    try {
      const extraVars = {
        target_hosts: hosts,
        file_path: filePath,
        mode,
        content_b64,
        expected_sha: force ? {} : expected,
        force,
        console_dir: consoleDir(),
        requester: req.session?.user?.username || '',
      };
      const r = await launch(req, REGISTRY_KEYS.push, `Nginx Hub: ${mode} ${path.basename(filePath)} → ${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'}`, extraVars, { op: 'publish', hosts, filePath, mode, newSha256: newSha, force });
      res.json({ ok: true, ...r, hosts, path: filePath, mode, newSha256: newSha });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Canli job durumu + stdout (JobTracker penceresi)
  router.get('/job-status/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([runner.getJobStatusOnServer(serverId, jobId), runner.getJobOutputOnServer(serverId, jobId)]);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      let result = null;
      if (TERMINAL.has(statusInfo.status)) {
        // Dokum degismis olabilir -> onbellek mtime ile kendini yeniler; ek is yok.
        const { extractStatsKey } = require('../opsx/index.cjs');
        result = extractStatsKey(statusInfo.artifacts, 'nginx_console_push_result') || extractStatsKey(statusInfo.artifacts, 'nginx_console_fetch_result') || null;
      }
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '', result });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/nginx-console', router);
  console.log(`[NginxConsole] mounted at /api/nginx-console (dir: ${consoleDir()})`);
}

function minDays(parsed) {
  let m = null;
  for (const c of parsed.certs.values()) {
    const dl = daysLeft(c.notAfter);
    if (dl == null) continue;
    if (m == null || dl < m) m = dl;
  }
  return m;
}

module.exports = { initNginxConsole, REGISTRY_KEYS, ALLOWED_PATH_RE, HOST_RE, consoleDir, _loadDumpForTest: loadDump };
