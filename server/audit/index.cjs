// server/audit/index.cjs — Portal geneli hash-zincirli denetim kaydi.
// logx/audit.cjs'teki v3 tek-yazar-kuyrugu deseninin tablo-parametreli genellemesi:
// createAuditChain(tableName) ayni semali herhangi bir audit tablosuna yazar/dogrular.
// Portal instance'i portal_audit_logs tablosuna yazar; LogX kendi tablosunda kalir.
//
// auditPortal(req, action, opts): request'ten kullanici/rol/IP cikarip fire-and-forget
// yazar — cagiran handler DB hatasindan bloklanmaz.
'use strict';

const crypto = require('crypto');
const db = require('../db/index.cjs');

const HASH_PREFIX = 'v3:';

function computeEntryHash(prevHash, username, action, detail) {
  return HASH_PREFIX + crypto
    .createHash('sha256')
    .update([prevHash, username, action, String(detail || '')].join('|'))
    .digest('hex');
}

// Tablo basina bagimsiz zincir + tek-yazar kuyrugu.
function createAuditChain(tableName) {
  let _writeQueue = Promise.resolve();

  async function getLastHash() {
    try {
      const { rows } = await db.query(
        `SELECT TOP 1 entry_hash FROM ${tableName} ORDER BY id DESC`
      );
      return rows[0]?.entry_hash || '';
    } catch {
      return '';
    }
  }

  async function writeEntry({ sessionId, username, authSource, role, targetHost, targetIp, action, result, detail, clientIp }) {
    try {
      const prevHash = await getLastHash();
      // detail kirpmasi hash'ten ONCE — hash DB'de birebir saklanan deger uzerinden hesaplanir.
      const storedDetail = detail ? String(detail).slice(0, 2000) : null;
      const entryHash = computeEntryHash(prevHash, username, action, storedDetail);
      await db.query(
        `INSERT INTO ${tableName}
           (session_id, username, auth_source, role, target_host, target_ip, action, result, detail, client_ip, prev_hash, entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          sessionId || null, username || 'system',
          authSource || 'local', role || null,
          targetHost || null, targetIp || null,
          action, result || null,
          storedDetail,
          clientIp || null, prevHash, entryHash,
        ]
      );
    } catch (err) {
      console.error(`[audit:${tableName}] write failed:`, err.message);
    }
  }

  function log(entry) {
    const task = _writeQueue.then(() => writeEntry(entry));
    _writeQueue = task.catch(() => {});
    return task;
  }

  async function getLogs({ limit = 200, offset = 0, username, targetHost, action } = {}) {
    const conditions = [];
    const params = [];
    if (username)   { params.push(username);   conditions.push(`username = $${params.length}`);    }
    if (targetHost) { params.push(targetHost); conditions.push(`target_host = $${params.length}`); }
    if (action)     { params.push(action);     conditions.push(`action = $${params.length}`);      }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(offset, limit);
    const { rows } = await db.query(
      `SELECT * FROM ${tableName} ${where}
       ORDER BY created_at DESC
       OFFSET $${params.length - 1} ROWS FETCH NEXT $${params.length} ROWS ONLY`,
      params
    );
    return rows;
  }

  async function verifyChain() {
    const { rows: countRows } = await db.query(`SELECT COUNT(*) AS total FROM ${tableName}`);
    const totalRows = Number(countRows[0]?.total || 0);
    const { rows } = await db.query(
      `SELECT id, username, action, detail, prev_hash, entry_hash
       FROM ${tableName} WHERE entry_hash LIKE 'v3:%' ORDER BY id ASC`
    );
    const legacyCount = totalRows - rows.length;
    if (rows.length === 0) {
      return { ok: true, verified: 0, broken: 0, firstBrokenId: null, legacyCount };
    }
    const brokenIds = new Set();
    let firstBrokenId = null;
    let runningPrev = rows[0].prev_hash;
    for (const row of rows) {
      const prevMismatch = row.prev_hash !== runningPrev;
      const expected = computeEntryHash(row.prev_hash, row.username, row.action, row.detail);
      const hashMismatch = expected !== row.entry_hash;
      if (prevMismatch || hashMismatch) {
        brokenIds.add(row.id);
        if (!firstBrokenId) firstBrokenId = row.id;
      }
      runningPrev = row.entry_hash;
    }
    const broken = brokenIds.size;
    return { ok: broken === 0, verified: rows.length, broken, firstBrokenId, legacyCount };
  }

  return { log, getLogs, verifyChain };
}

// ── Portal geneli instance ───────────────────────────────────────────────────
const portalChain = createAuditChain('portal_audit_logs');

// Request'ten kimlik/IP cikaran kisa yol. Fire-and-forget — hicbir handler'i bloklamaz.
// action: 'login', 'role_change', 'selfservice_update', 'ansible_launch' ... gibi
// snake_case eylem adi. opts: { detail, result, targetHost, targetIp, username }.
function auditPortal(req, action, opts = {}) {
  const user = (req && (req.session?.user || req.user)) || {};
  portalChain.log({
    sessionId: req?.sessionID || null,
    username: opts.username || user.username || 'system',
    authSource: user.authSource || 'local',
    role: user.role || null,
    targetHost: opts.targetHost || null,
    targetIp: opts.targetIp || null,
    action,
    result: opts.result || 'ok',
    detail: opts.detail || null,
    clientIp: req?.ip || null,
  });
}

// ── Body redaksiyonu — sifre/token/secret degerleri audit'e asla yazilmaz ────
const SECRET_KEY_RE = /(pass|password|token|secret|key|credential|authorization)/i;

function redactObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_RE.test(k)) out[k] = '[REDACTED]';
    else if (v && typeof v === 'object') out[k] = redactObject(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

// ── Genel mutasyon audit middleware'i ────────────────────────────────────────
// Router/prefix'e takilir; basarili (2xx) her non-GET istegi otomatik audit'ler:
// action = `${prefix}_${method}`, detail = URL + redakte edilmis body ozeti.
// Handler'lara dokunmadan tum CRUD'u kapsar; hassas alanlar redactObject ile maskelenir.
function auditMutations(prefix, { exclude = [] } = {}) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const pathOnly = (req.path || '').toLowerCase();
    if (exclude.some((e) => pathOnly.startsWith(e))) return next();
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      let detail = req.originalUrl;
      try {
        if (req.body && typeof req.body === 'object') {
          const body = JSON.stringify(redactObject(req.body));
          if (body && body !== '{}') detail += ' ' + body.slice(0, 800);
        }
      } catch { /* body serilestirilemedi — yalnizca URL */ }
      auditPortal(req, `${prefix}_${req.method.toLowerCase()}`, { detail });
    });
    next();
  };
}

// ── Admin okuma endpoint'leri ────────────────────────────────────────────────
// GET /api/portal-audit         → portal geneli denetim kayitlari (filtre: username/action)
// GET /api/portal-audit/verify  → hash zinciri dogrulama ozeti
function initPortalAudit(app) {
  let requireAuth, requireAdmin;
  try {
    const auth = require('../auth/index.cjs');
    requireAuth = auth.requireAuth;
    requireAdmin = auth.requireAdmin;
  } catch { /* auth yok → endpoint acilmaz */ }
  if (!requireAuth || !requireAdmin) return;

  app.get('/api/portal-audit', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await portalChain.getLogs({
        limit: Math.min(Number(req.query.limit) || 200, 1000),
        offset: Number(req.query.offset) || 0,
        username: req.query.username || undefined,
        action: req.query.action || undefined,
      });
      res.json({ ok: true, logs: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, logs: [] });
    }
  });

  app.get('/api/portal-audit/verify', requireAuth, requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, ...(await portalChain.verifyChain()) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  console.log('[Audit] /api/portal-audit (admin) mounted');
}

module.exports = {
  createAuditChain,
  auditPortal,
  auditMutations,
  portalAudit: portalChain,
  initPortalAudit,
};
