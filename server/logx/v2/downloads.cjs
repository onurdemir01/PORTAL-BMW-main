// server/logx/v2/downloads.cjs — Guvenli indirme token'i uretimi + akis (streaming) indirme.
// IDOR'a direncli: token crypto.randomBytes(32) (256-bit), username+session'a bagli, TTL'li,
// yalnizca istegi acan kullanici (veya Admin) tuketebilir. Frontend gercek dosya sistemi
// yolunu ASLA gormez — yalnizca opak token'i.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../db/index.cjs');
const audit = require('../audit.cjs');

const DOWNLOAD_TTL_MINUTES = 15;

async function issueDownloadToken({ requestId, username, sessionToken, stagedPath, filename, sizeBytes, isFallback }) {
  const token = crypto.randomBytes(32).toString('hex');
  // size_bytes BIGINT sutunudur; playbook set_stats ham/Jinja string (or. "0", bir dict
  // stringi) emitebilir — dogrudan insert edilirse MSSQL "nvarchar to bigint" hatasi verir
  // ve /jobs/:id/status icindeki finalize adimi 500'e duser. Guvenli tamsayiya zorla.
  const n = Number(sizeBytes);
  const safeSize = Number.isFinite(n) ? Math.floor(n) : null;
  await db.query(
    `INSERT INTO logx_v2_downloads (token, request_id, username, session_token, staged_path, filename, size_bytes, is_fallback, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, DATEADD(MINUTE, $9, GETUTCDATE()))`,
    [token, requestId, username, sessionToken, stagedPath, filename, safeSize, isFallback ? 1 : 0, DOWNLOAD_TTL_MINUTES]
  );
  return { token, expiresInMinutes: DOWNLOAD_TTL_MINUTES };
}

async function getDownloadByToken(token) {
  const { rows } = await db.query(`SELECT * FROM logx_v2_downloads WHERE token = $1`, [token]);
  return rows[0] || null;
}

// Bir istegin en guncel indirme kaydi — route handler'larin ham SQL calistirmasi yerine
// (kurumsal AI kod incelemesi, review.md #12) burada kapsullenir.
async function getLatestDownloadForRequest(requestId) {
  const { rows } = await db.query(
    `SELECT TOP 1 token, filename, size_bytes, expires_at FROM logx_v2_downloads WHERE request_id = $1 ORDER BY id DESC`,
    [requestId]
  );
  return rows[0]
    ? { token: rows[0].token, filename: rows[0].filename, sizeBytes: rows[0].size_bytes, expiresAt: rows[0].expires_at }
    : null;
}

// GET /api/logx/v2/downloads/:token — requireAuth zaten uygulanmis olmali (index.cjs'de).
async function handleDownloadRoute(req, res) {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ ok: false, message: 'Geçersiz token.' });
  }

  const row = await getDownloadByToken(token).catch(() => null);
  if (!row) return res.status(404).json({ ok: false, message: 'İndirme bulunamadı.' });

  const now = new Date();
  if (new Date(row.expires_at) < now) {
    return res.status(410).json({ ok: false, message: 'İndirme süresi doldu.' });
  }

  const sessionUser = req.session?.user;
  const currentUsername = sessionUser?.username || req.user?.username;
  const currentRole = sessionUser?.role || req.user?.role;
  if (row.username !== currentUsername && currentRole !== 'Admin') {
    return res.status(403).json({ ok: false, message: 'Bu indirmeye erişim yetkiniz yok.' });
  }

  // Playbook'un bildirdigi yola koru korune bagli kalma: dosyayi portalin KENDI staging
  // koklerinde filename ile de ara (paylasilan NFS'te mount yolu farkli olsa bile bulunur).
  const servePath = resolveStagedFile({ stagedPath: row.staged_path, filename: row.filename });
  if (!servePath) {
    // Teshis: dosya ne bildirilen yolda ne de portalin staging koklerinde bulunamadi. En sik
    // neden, playbook arsivi kaynak host'un YEREL diskine yaziyor (NFS'e cp yapmiyor) ya da
    // staging koku portal ile paylasilmiyor. Yolu yalnizca sunucu log'una yazariz.
    console.warn(`[LogXv2] Indirme basarisiz — arsiv bulunamadi. staged_path="${row.staged_path}", ` +
      `filename="${row.filename}", aranan kokler=[${stagingRoots().join(', ')}]. Playbook arsivi ` +
      `PAYLASILAN NFS staging dizinine yazmali; kaynak host NFS'e erisemiyorsa portal host'una fetch edilmeli.`);
    audit.log({ username: currentUsername, role: currentRole, action: 'v2_download', result: 'not_found',
      detail: `filename=${row.filename} token_prefix=${token.slice(0, 8)}` }).catch(() => {});
    return res.status(404).json({
      ok: false,
      message: 'Log arşivi portal sunucusunda bulunamadı. Genelde staging dizini (NFS) portal ile paylaşılmıyordur ya da temizlenmiştir. Lütfen tekrar deneyin veya yöneticinize staging mount\'unu kontrol ettirin.',
    });
  }

  await db.query(`UPDATE logx_v2_downloads SET consumed_count = consumed_count + 1 WHERE token = $1`, [token]);
  // Indirme TUKETIMI denetim kaydi (token issuance zaten finalizeIfNeeded'de loglaniyor; bu,
  // dosyanin gercekten kim tarafindan indirildigini hash-zincirli audit'e ekler).
  audit.log({ username: currentUsername, role: currentRole, action: 'v2_download', result: 'ok',
    detail: `filename=${row.filename} token_prefix=${token.slice(0, 8)}` }).catch(() => {});

  res.download(servePath, row.filename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ ok: false, message: 'İndirme akışı başarısız oldu.' });
    }
  });
}

// Portalin okuyabildigi staging kok dizinleri (paylasilan NFS mount'lari + yerel fallback).
function stagingRoots() {
  return [
    process.env.LOGX_V2_STAGING_LEGACY_DIR || '/sw/BMW_PORTAL/logs/legacy',
    process.env.LOGX_V2_STAGING_OCP_DIR || '/sw/BMW_PORTAL/logs/ocp',
    process.env.LOGX_STAGING_FALLBACK_DIR || path.join(process.cwd(), 'data', 'logx-v2-fallback'),
  ].map((r) => path.resolve(r));
}

// Bir staged dosyayi diskten guvenle siler — path staging kok dizinlerinden biri altinda
// degilse SESSIZCE atlanir (savunma katmani; normalde path her zaman bizim urettigimiz).
function isUnderStagingRoot(filePath) {
  const resolved = path.resolve(filePath);
  return stagingRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

// Arsivin portalda GERCEK yolunu cozer. Playbook'un bildirdigi `staged_path`'e koru korune
// bagli kalmaz: paylasilan NFS'te dosya, portalin env mount yolu farkli olsa bile `filename`
// (kripto-rastgele, benzersiz) ile portalin KENDI staging koklerinde aranir. `basename`
// kullanildigi icin filename tarafinda path-traversal yuzeyi yok. `stagedPath` ise DB'deki
// staged_path sutunundan gelir (playbook set_stats ciktisi) — GUVENILMEZ girdi sayilir ve
// staging koklerinden biri altinda degilse reddedilir (path traversal onlemi — bir playbook
// veya AWX job'i /etc/passwd gibi bir sistem dosyasini staged_path olarak bildirse bile
// disariya servis edilmez).
// Donus: mevcut mutlak yol | null.
function resolveStagedFile({ stagedPath, filename }) {
  const candidates = [];
  // 1) Playbook'un bildirdigi yol — YALNIZCA staging koklerinden biri altindaysa kabul edilir.
  if (stagedPath) {
    const resolved = path.resolve(stagedPath);
    if (isUnderStagingRoot(resolved)) {
      candidates.push(resolved);
    } else {
      console.warn(`[LogXv2] staged_path staging koku disinda, atlaniyor: ${resolved}`);
    }
  }
  // 2) Portalin kendi staging koklerinde filename ile ara (mount yolu/isim uyusmazligina dayanikli).
  const base = filename ? path.basename(String(filename)) : '';
  if (base) {
    for (const root of stagingRoots()) candidates.push(path.join(root, base));
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch { /* erisim hatasi → siradaki aday */ }
  }
  return null;
}

async function deleteStagedFile(stagedPath) {
  if (!stagedPath || !isUnderStagingRoot(stagedPath)) return;
  await fs.promises.unlink(stagedPath).catch(() => { /* zaten silinmis olabilir */ });
}

// Suresi dolmus indirme token'larinin dosyalarini temizler (henuz bir request-expiry
// dongusunden silinmemisse) — TTL cleanup job'inin ikinci ayagi.
async function cleanupExpiredDownloads() {
  const { rows } = await db.query(
    `SELECT token, staged_path FROM logx_v2_downloads WHERE expires_at < GETUTCDATE()`
  );
  for (const row of rows) {
    await deleteStagedFile(row.staged_path);
  }
  // Ikinci bagimsiz WHERE-predikatli DELETE yerine, SELECT'te GORULEN token'lari hedefler
  // — aradaki surede yeni suresi dolan satirlarin dosyasiz silinmesini (TOCTOU) onler
  // (kurumsal AI kod incelemesi, review.md #10). token 256-bit rastgele hex, IN(...) icin guvenli.
  if (rows.length > 0) {
    const tokens = rows.map((r) => r.token);
    await db.query(
      `DELETE FROM logx_v2_downloads WHERE token IN (${tokens.map((_, i) => `$${i + 1}`).join(',')})`,
      tokens
    );
  }
  return rows.length;
}

module.exports = {
  issueDownloadToken, getDownloadByToken, getLatestDownloadForRequest, handleDownloadRoute,
  deleteStagedFile, cleanupExpiredDownloads, resolveStagedFile, isUnderStagingRoot, stagingRoots,
};
