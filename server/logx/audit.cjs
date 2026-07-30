// server/logx/audit.cjs
'use strict';

const crypto = require('crypto');
const db = require('../db/index.cjs');

// Hash sema gecmisi:
//  v1: saklanmayan timestamp hash'leniyordu → dogrulama matematiksel olarak imkânsizdi.
//  v2: timestamp cikarildi AMA yazimlar paralel geldiginde (LogX proxy alt-istekleri)
//      getLastHash→INSERT atomik olmadigi icin iki kayit ayni prev_hash'i aliyor ve
//      zincir kiriliyordu (HAR'da: 104 v2 kaydindan 51 kirik).
//  v3: formul ayni; yazimlar artik TEK-YAZAR KUYRUGU ile serilestirilir (asagida) —
//      yaris ortadan kalkar. Yaris altinda yazilmis v2 kayitlari duzeltilemeyecegi
//      icin dogrulama yalniz v3'u kapsar; v1+v2 legacyCount olarak raporlanir.
const HASH_PREFIX = 'v3:';

function computeEntryHash(prevHash, username, action, detail) {
  return HASH_PREFIX + crypto
    .createHash('sha256')
    .update([prevHash, username, action, String(detail || '')].join('|'))
    .digest('hex');
}

async function getLastHash() {
  try {
    const { rows } = await db.query(
      `SELECT TOP 1 entry_hash FROM logx_audit_logs ORDER BY id DESC`
    );
    return rows[0]?.entry_hash || '';
  } catch {
    return '';
  }
}

// ── Tek-yazar kuyrugu ─────────────────────────────────────────────────────────
// Zincir butunlugu "son hash'i oku → yeni hash'i yaz" adimlarinin atomik SIRAYLA
// calismasini gerektirir. Eszamanli log() cagrilari (LogX proxy'nin paralel
// alt-istekleri gibi) bu promise zincirine seri baglanir — tek instance icin
// yeterli garanti (coklu replika senaryosu icin bkz. docs/SCALABILITY.md).
let _writeQueue = Promise.resolve();

function log(entry) {
  const task = _writeQueue.then(() => writeEntry(entry));
  // Kuyruk hatada kopmasin — hata writeEntry icinde loglanir, zincir devam eder
  _writeQueue = task.catch(() => {});
  return task;
}

async function writeEntry({ sessionId, username, authSource, role, targetHost, targetIp, action, result, detail, clientIp }) {
  try {
    const prevHash = await getLastHash();
    // detail kirpmasi hash'ten ONCE yapilmali — hash yalnizca DB'de birebir saklanan
    // deger uzerinden hesaplanmazsa dogrulama uyusmaz
    const storedDetail = detail ? String(detail).slice(0, 2000) : null;
    const entryHash = computeEntryHash(prevHash, username, action, storedDetail);

    await db.query(
      `INSERT INTO logx_audit_logs
         (session_id, username, auth_source, role, target_host, target_ip, action, result, detail, client_ip, prev_hash, entry_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        sessionId || null, username,
        authSource || 'local', role || null,
        targetHost || null, targetIp || null,
        action, result || null,
        storedDetail,
        clientIp || null, prevHash, entryHash,
      ]
    );
  } catch (err) {
    console.error('[audit] write failed:', err.message);
  }
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
    `SELECT * FROM logx_audit_logs ${where}
     ORDER BY created_at DESC
     OFFSET $${params.length - 1} ROWS FETCH NEXT $${params.length} ROWS ONLY`,
    params
  );
  return rows;
}

async function verifyChain() {
  // Yalnizca v3 kayitlari dogrulanir — v1/v2/legacy satirlara dokunulmaz, sadece
  // legacyCount olarak raporlanir (v1: saklanmayan timestamp; v2: yaris kosulu
  // altinda yazilmis olabilir — bkz. HASH_PREFIX uzerindeki sema gecmisi).
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) AS total FROM logx_audit_logs`
  );
  const totalRows = Number(countRows[0]?.total || 0);

  const { rows } = await db.query(
    `SELECT id, username, action, detail, prev_hash, entry_hash
     FROM logx_audit_logs
     WHERE entry_hash LIKE 'v3:%'
     ORDER BY id ASC`
  );

  const legacyCount = totalRows - rows.length;

  if (rows.length === 0) {
    return { ok: true, verified: 0, broken: 0, firstBrokenId: null, legacyCount };
  }

  const brokenIds = new Set();
  let firstBrokenId = null;
  // Genesis: ilk v3 satirinin prev_hash'i bir v1/v2 hash'e (veya '' seed'ine)
  // isaret edebilir — bu baglanti kontrol edilmez, zincir buradan baslar.
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

module.exports = { log, getLogs, verifyChain };
