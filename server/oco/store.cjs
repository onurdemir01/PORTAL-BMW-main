// server/oco/store.cjs — oco_scheduled_launches tablosu icin CRUD.
//
// server/smart/store.cjs ile AYNI desen ve AYNI gerekce: poller ve
// server/ansible/runner.cjs ayni DB erisim mantigini paylassin diye ayri dosya.
//
// NEDEN AYRI TABLO (smart_tickets'a kolon eklemek yerine): iki mekanizmanin BEKLEME
// SEBEBI farkli. Smart bileti bir INSANIN onayini bekler, suresiz olabilir; OCO kaydi
// bir SAATI bekler ve penceresi kapaninca GECERSIZ olur. Ayni tabloda tutmak, "hangi
// sebeple bekliyor" sorusunu her sorguda dallandirmayi gerektirirdi.
'use strict';

const db = require('../db/index.cjs');

function rowToRec(r) {
  return {
    id: r.id,
    username: r.username,
    awxServerId: r.awx_server_id,
    awxTemplateId: r.awx_template_id,
    ocoNumber: r.oco_number,
    ocoSubject: r.oco_subject,
    runAt: r.run_at,
    windowEnd: r.window_end,
    status: r.status,
    pendingLaunch: JSON.parse(r.pending_launch_json),
    awxJobId: r.awx_job_id,
    awxScheduleId: r.awx_schedule_id ?? null,
    cancelledBy: r.cancelled_by ?? null,
    cancelNote: r.cancel_note ?? null,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}

async function create({ username, awxServerId, awxTemplateId, ocoNumber, ocoSubject, runAt, windowEnd, pendingLaunch }) {
  const { rows } = await db.query(
    `INSERT INTO oco_scheduled_launches
       (username, awx_server_id, awx_template_id, oco_number, oco_subject, run_at, window_end, status, pending_launch_json)
     OUTPUT INSERTED.*
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'SCHEDULED', $8)`,
    [username, awxServerId, awxTemplateId, ocoNumber, ocoSubject || null, runAt, windowEnd, JSON.stringify(pendingLaunch)]
  );
  return rowToRec(rows[0]);
}

// AWX'in KENDI schedule'i olusturuldugunda kullanilir. status = 'AWX_SCHEDULED':
// listScheduled() yalnizca 'SCHEDULED' dondurdugu icin Portal poller'i bu satirlara
// DOKUNMAZ - isi AWX tetikler, Portal yalnizca kaydi tutar.
async function createAwxScheduled({ username, awxServerId, awxTemplateId, ocoNumber, ocoSubject, runAt, windowEnd, awxScheduleId, pendingLaunch }) {
  const { rows } = await db.query(
    `INSERT INTO oco_scheduled_launches
       (username, awx_server_id, awx_template_id, oco_number, oco_subject, run_at, window_end, status, awx_schedule_id, pending_launch_json)
     OUTPUT INSERTED.*
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'AWX_SCHEDULED', $8, $9)`,
    [username, awxServerId, awxTemplateId, ocoNumber, ocoSubject || null, runAt, windowEnd, awxScheduleId, JSON.stringify(pendingLaunch)]
  );
  return rowToRec(rows[0]);
}

// Admin ekrani icin: TUM kullanicilarin ileri tarihli/gecmis OCO tetiklemeleri.
// Buyuyen bir tablo oldugu icin sayfalama ZORUNLU.
async function listAll({ limit = 100, offset = 0, status = '', username = '', q = '' } = {}) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (username) { params.push(`%${username}%`); where.push(`username LIKE $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(oco_number LIKE $${params.length} OR oco_subject LIKE $${params.length} OR pending_launch_json LIKE $${params.length})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM oco_scheduled_launches ${w}
      ORDER BY id DESC
      OFFSET ${Number(offset) || 0} ROWS FETCH NEXT ${Number(limit) || 100} ROWS ONLY`,
    params
  );
  const cnt = await db.query(`SELECT COUNT(*) AS n FROM oco_scheduled_launches ${w}`, params);
  return { items: rows.map(rowToRec), total: Number(cnt.rows[0]?.n || 0) };
}

async function get(id) {
  const { rows } = await db.query(`SELECT * FROM oco_scheduled_launches WHERE id = $1`, [id]);
  return rows[0] ? rowToRec(rows[0]) : null;
}

// Poller'in ise yarayan tek sorgusu: hala SCHEDULED olanlar. Zamani gelip gelmedigi
// karari JS tarafinda verilir - DB ile uygulama sunucusunun saati ayrisirsa tek bir
// saat kaynagina (uygulama) bagli kalmak, tetiklemeyi ONGORULEBILIR kilar.
async function listScheduled() {
  const { rows } = await db.query(`SELECT * FROM oco_scheduled_launches WHERE status = 'SCHEDULED'`);
  return rows.map(rowToRec);
}

async function listByUsername(username, limit = 50) {
  const { rows } = await db.query(
    `SELECT TOP (${Number(limit) || 50}) * FROM oco_scheduled_launches
      WHERE username = $1 ORDER BY id DESC`,
    [username]
  );
  return rows.map(rowToRec);
}

async function markLaunched(id, awxJobId) {
  await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'LAUNCHED', awx_job_id = $2, updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      WHERE id = $1`,
    [id, awxJobId]
  );
}

async function markFailed(id, message) {
  await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'FAILED', error_message = $2, updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      WHERE id = $1`,
    [id, String(message || '').slice(0, 4000)]
  );
}

// Pencere kapandigi halde hala tetiklenmemis kayit: OCO'nun izin verdigi saat gecti,
// artik CALISTIRILMAZ. (Portal kapaliyken run_at gecmisse bu dal devreye girer.)
async function markExpired(id) {
  await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'EXPIRED', updated_at = GETUTCDATE(), resolved_at = GETUTCDATE(),
            error_message = N'OCO kesinti penceresi tetikleme yapılmadan kapandı.'
      WHERE id = $1`,
    [id]
  );
}

async function cancel(id, username) {
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'CANCELLED', updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE id = $1 AND status = 'SCHEDULED' AND username = $2`,
    [id, username]
  );
  return rows[0] ? rowToRec(rows[0]) : null;
}

// Admin iptali: SAHIP KONTROLU YOK (cancel() kullanicinin kendi kaydi icindi) ve
// LAUNCHED kayitlar da iptal edilebilir - o durumda AWX'te calisan job durdurulur.
// Zaten sonuclanmis (CANCELLED/EXPIRED/FAILED) kayitlar tekrar iptal EDILMEZ: cagiran
// taraf null gorup "bulunamadi/zaten kapali" der.
async function adminCancel(id, { cancelledBy, note }) {
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'CANCELLED', cancelled_by = $2, cancel_note = $3,
            updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE id = $1 AND status IN ('SCHEDULED', 'AWX_SCHEDULED', 'LAUNCHED')`,
    [id, cancelledBy || null, String(note || '').slice(0, 1000) || null]
  );
  return rows[0] ? rowToRec(rows[0]) : null;
}

module.exports = { create, createAwxScheduled, get, listScheduled, listAll, listByUsername, markLaunched, markFailed, markExpired, cancel, adminCancel };
