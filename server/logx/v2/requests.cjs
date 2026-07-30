// server/logx/v2/requests.cjs — Sihirbaz oturumu CRUD'u. Her satir, sayfa yenilemesinden
// sonra kaldigi yerden devam edebilmenin (resumption) ve transfer/discover-fetch
// isteklerinin discovery sonucuna karsi dogrulanmasinin (TOCTOU kaynagi) tek gercegi.
'use strict';

const db = require('../../db/index.cjs');

const REQUEST_TTL_HOURS = 24;

function normalizeRequest(row) {
  return {
    id: row.request_id,
    username: row.username,
    platform: row.platform,
    state: row.state,
    input: row.input_json ? JSON.parse(row.input_json) : null,
    discoveryResult: row.discovery_result_json ? JSON.parse(row.discovery_result_json) : null,
    selectedFiles: row.selected_files_json ? JSON.parse(row.selected_files_json) : null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

async function createRequest(user, platform) {
  if (platform !== 'legacy' && platform !== 'openshift') {
    throw Object.assign(new Error('Geçersiz platform.'), { status: 400 });
  }
  const { rows } = await db.query(
    `INSERT INTO logx_v2_requests (username, auth_source, role, session_token, platform, state, expires_at)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3,$4,$5,'draft', DATEADD(HOUR, $6, GETUTCDATE()))`,
    [user.username, user.authSource || 'local', user.role || 'User', user.sessionToken, platform, REQUEST_TTL_HOURS]
  );
  return normalizeRequest(rows[0]);
}

async function getRequestRow(requestId) {
  const { rows } = await db.query(`SELECT * FROM logx_v2_requests WHERE request_id = $1`, [requestId]);
  return rows[0] || null;
}

async function getRequest(requestId) {
  const row = await getRequestRow(requestId);
  return row ? normalizeRequest(row) : null;
}

// Sahiplik kontrolu: yalnizca istegi olusturan kullanici VEYA Admin gorebilir/ilerletebilir.
function assertOwnership(row, user) {
  if (!row) throw Object.assign(new Error('İstek bulunamadı.'), { status: 404 });
  if (row.username !== user.username && user.role !== 'Admin') {
    throw Object.assign(new Error('Bu isteğe erişim yetkiniz yok.'), { status: 403 });
  }
}

async function updateRequest(requestId, fields) {
  const sets = [];
  const params = [];
  let i = 1;
  const map = {
    state: 'state', input: 'input_json', discoveryResult: 'discovery_result_json',
    selectedFiles: 'selected_files_json', errorMessage: 'error_message',
  };
  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) {
      sets.push(`${col} = $${i}`);
      const v = fields[key];
      params.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
      i++;
    }
  }
  if (sets.length === 0) return getRequest(requestId);
  sets.push(`updated_at = GETUTCDATE()`);
  params.push(requestId);
  const { rows } = await db.query(
    `UPDATE logx_v2_requests SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE request_id = $${i}`,
    params
  );
  return rows[0] ? normalizeRequest(rows[0]) : null;
}

// Suresi dolmus istekleri 'expired' isaretler ve iliskili staged dosyalari diskten siler
// (bkz. downloads.cjs deleteStagedFile) — periyodik expiry-sweep job deseni, dosya
// sistemi temizligi eklenmis haliyle.
async function expireOldRequests(deleteStagedFileFn) {
  const { rows } = await db.query(
    `SELECT r.request_id, d.staged_path
     FROM logx_v2_requests r
     LEFT JOIN logx_v2_downloads d ON d.request_id = r.request_id
     WHERE r.expires_at < GETUTCDATE() AND r.state <> 'expired'`
  );
  const seen = new Set();
  for (const row of rows) {
    if (row.staged_path && deleteStagedFileFn) {
      try { await deleteStagedFileFn(row.staged_path); } catch { /* best-effort */ }
    }
    seen.add(row.request_id);
  }
  // Dosya temizligi per-row kalir (farkli staged_path'ler), ama state guncellemesi
  // dongu disina, ayni WHERE predikatiyla tek toplu sorguya alinir — N+1 UPDATE yerine
  // 1 UPDATE (kurumsal AI kod incelemesi, review.md #9).
  if (seen.size > 0) {
    await db.query(
      `UPDATE logx_v2_requests SET state = 'expired' WHERE expires_at < GETUTCDATE() AND state <> 'expired'`
    );
  }
  return seen.size;
}

// Admin istek listesi — route handler'in ham SQL calistirmasi yerine burada kapsullenir
// (kurumsal AI kod incelemesi, review.md #12). limit adaptSql'in $n → OFFSET/FETCH NEXT
// cevrimiyle parametrize edilir (review.md #13 — TOP() string-interpolasyonu yerine).
async function listRequestsForAdmin({ state, platform, limit = 100 } = {}) {
  const conditions = [];
  const params = [];
  let i = 1;
  if (state) { conditions.push(`state = $${i++}`); params.push(state); }
  if (platform) { conditions.push(`platform = $${i++}`); params.push(platform); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Number(limit) || 100);
  const { rows } = await db.query(
    `SELECT * FROM logx_v2_requests ${where} ORDER BY id DESC LIMIT $${i}`,
    params
  );
  return rows.map(normalizeRequest);
}

module.exports = {
  createRequest, getRequest, getRequestRow, assertOwnership, updateRequest, expireOldRequests,
  normalizeRequest, listRequestsForAdmin,
};
