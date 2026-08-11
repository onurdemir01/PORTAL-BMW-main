// server/opsx/downloads.cjs — OpsX Thread/Heap Dump indirme token akisi.
//
// server/logx/v2/downloads.cjs ile AYNI IDOR-direncli desen (crypto.randomBytes(32) token,
// TTL, yalniz token sahibi/Admin tuketebilir) — ama LogX'in logx_v2_requests/logx_v2_jobs
// state-machine'ine BAGLANMAZ. OpsX'in kendi tablosu: opsx_dump_downloads (awx_server_id +
// awx_job_id dogrudan tutulur, ayri bir "request" kavrami yok). Ingest/push-fallback
// (server/logx/v2/ingest.cjs benzeri) BILEREK yok — v1 kapsami disi, paylasilan staging
// dizininin hedef host'larda da mount'lu oldugu varsayilir (LogX'in birincil varsayimiyla ayni).
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db/index.cjs');

const DOWNLOAD_TTL_MINUTES = 15;

function stagingRoot() {
  return path.resolve(process.env.OPSX_DUMP_STAGING_DIR || '/sw/BMW_PORTAL/opsx/dumps');
}

async function issueDownloadToken({ username, awxServerId, awxJobId, stagedPath, filename, sizeBytes }) {
  const token = crypto.randomBytes(32).toString('hex');
  // size_bytes BIGINT sutunudur; playbook set_stats ham/Jinja string emitebilir (or.
  // logx_v2_downloads.issueDownloadToken'daki AYNI ders) — dogrudan insert edilirse MSSQL
  // "nvarchar to bigint" hatasi verir. Guvenli tamsayiya zorla.
  const n = Number(sizeBytes);
  const safeSize = Number.isFinite(n) ? Math.floor(n) : null;
  await db.query(
    `INSERT INTO opsx_dump_downloads (token, username, awx_server_id, awx_job_id, staged_path, filename, size_bytes, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, DATEADD(MINUTE, $8, GETUTCDATE()))`,
    [token, username, awxServerId, awxJobId, stagedPath, filename, safeSize, DOWNLOAD_TTL_MINUTES]
  );
  return { token, expiresInMinutes: DOWNLOAD_TTL_MINUTES };
}

async function getDownloadByToken(token) {
  const { rows } = await db.query(`SELECT * FROM opsx_dump_downloads WHERE token = $1`, [token]);
  return rows[0] || null;
}

// Portalin okuyabildigi staging kok dizini — tek dizin (LogX'in Legacy/OCP ayrimindan
// FARKLI olarak OpsX dump'lari tek bir paylasilan dizinde toplanir, ikisi de kucuk hacimli).
function stagingRoots() {
  return [stagingRoot()];
}

function isUnderStagingRoot(filePath) {
  const resolved = path.resolve(filePath);
  return stagingRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

// logx/v2/downloads.cjs.resolveStagedFile ile AYNI mantik: playbook'un bildirdigi yola
// koru korune bagli kalinmaz, portalin KENDI staging kokunde filename ile de aranir
// (paylasilan mount'ta yol farkli olsa bile bulunur). path traversal onlemi: staged_path
// staging koku altinda degilse reddedilir.
function resolveStagedFile({ stagedPath, filename }) {
  const candidates = [];
  if (stagedPath) {
    const resolved = path.resolve(stagedPath);
    if (isUnderStagingRoot(resolved)) {
      candidates.push(resolved);
    } else {
      console.warn(`[OpsX] staged_path staging koku disinda, atlaniyor: ${resolved}`);
    }
  }
  const base = filename ? path.basename(String(filename)) : '';
  if (base) candidates.push(path.join(stagingRoot(), base));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch { /* erisim hatasi → siradaki aday */ }
  }
  return null;
}

// GET /api/opsx/dump/download/:token — requireAuth cagirandan once uygulanmis olmali.
async function handleDownloadRoute(req, res) {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ ok: false, message: 'Geçersiz token.' });
  }

  const row = await getDownloadByToken(token).catch(() => null);
  if (!row) return res.status(404).json({ ok: false, message: 'İndirme bulunamadı.' });

  if (new Date(row.expires_at) < new Date()) {
    return res.status(410).json({ ok: false, message: 'İndirme süresi doldu.' });
  }

  const sessionUser = req.session?.user;
  const currentUsername = sessionUser?.username || req.user?.username;
  const currentRole = sessionUser?.role || req.user?.role;
  if (row.username !== currentUsername && currentRole !== 'Admin') {
    return res.status(403).json({ ok: false, message: 'Bu indirmeye erişim yetkiniz yok.' });
  }

  const servePath = resolveStagedFile({ stagedPath: row.staged_path, filename: row.filename });
  if (!servePath) {
    console.warn(`[OpsX] Indirme basarisiz — dump dosyasi bulunamadi. staged_path="${row.staged_path}", ` +
      `filename="${row.filename}", staging koku=${stagingRoot()}. Playbook dump'i paylasilan staging ` +
      `dizinine yazmali (OPSX_DUMP_STAGING_DIR).`);
    try {
      require('../audit/index.cjs').auditPortal(req, 'opsx_dump_download', {
        username: currentUsername, result: 'not_found', detail: `filename=${row.filename} token_prefix=${token.slice(0, 8)}`,
      });
    } catch { /* audit modulu yoksa yoksay */ }
    return res.status(404).json({
      ok: false,
      message: 'Dump dosyası portal sunucusunda bulunamadı. Genelde staging dizini (NFS) hedef sunucuyla paylaşılmıyordur ya da temizlenmiştir.',
    });
  }

  await db.query(`UPDATE opsx_dump_downloads SET consumed_count = consumed_count + 1 WHERE token = $1`, [token]);
  try {
    require('../audit/index.cjs').auditPortal(req, 'opsx_dump_download', {
      username: currentUsername, result: 'ok', detail: `filename=${row.filename} token_prefix=${token.slice(0, 8)}`,
    });
  } catch { /* audit modulu yoksa yoksay */ }

  res.download(servePath, row.filename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ ok: false, message: 'İndirme akışı başarısız oldu.' });
    }
  });
}

async function deleteStagedFile(stagedPath) {
  if (!stagedPath || !isUnderStagingRoot(stagedPath)) return;
  await fs.promises.unlink(stagedPath).catch(() => { /* zaten silinmis olabilir */ });
}

// Suresi dolmus indirme token'larinin dosyalarini temizler — logx_v2_downloads'un AYNI
// cleanup deseni, ayri bir zamanlanmis cagriya baglanir (bkz. server/index.cjs).
async function cleanupExpiredDownloads() {
  const { rows } = await db.query(
    `SELECT token, staged_path FROM opsx_dump_downloads WHERE expires_at < GETUTCDATE()`
  );
  for (const row of rows) {
    await deleteStagedFile(row.staged_path);
  }
  if (rows.length > 0) {
    const tokens = rows.map((r) => r.token);
    await db.query(
      `DELETE FROM opsx_dump_downloads WHERE token IN (${tokens.map((_, i) => `$${i + 1}`).join(',')})`,
      tokens
    );
  }
  return rows.length;
}

module.exports = {
  stagingRoot, issueDownloadToken, getDownloadByToken, handleDownloadRoute,
  resolveStagedFile, isUnderStagingRoot, deleteStagedFile, cleanupExpiredDownloads,
};
