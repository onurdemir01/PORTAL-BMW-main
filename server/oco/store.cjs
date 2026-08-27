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
    smartTicketId: r.smart_ticket_id ?? null,
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

// ── CLAIM DESENI (2026-08-28) ───────────────────────────────────────────────────
// Poller kaydi okur, sonra AWX'i cagirir (AG UZERINDE SANIYELER surer), sonra sonucu
// yazar. Bu aralikta kullanici "iptal"e basarsa eski kod KOSULSUZ `UPDATE ... WHERE
// id=$1` yaziyor ve iptali EZIYORDU: kayit CANCELLED'dan LAUNCHED'a geri donuyor,
// kullanici iptal ettigini saniyor. Ayrica portal birden fazla ornekle kosarsa iki
// poller AYNI kaydi ayni anda tetikleyebiliyordu.
//
// Cozum, `cancel()`in zaten kullandigi desen: durum gecisleri KOSULLU yazilir ve
// etkilenen satir sayisi dondurulur. Once `claimForLaunch` kaydi SCHEDULED -> LAUNCHING
// yapar; yalnizca bu gecisi KAZANAN poller AWX'i cagirir.
async function claimForLaunch(id) {
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'LAUNCHING', updated_at = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE id = $1 AND status = 'SCHEDULED'`,
    [id]
  );
  return rows[0] ? rowToRec(rows[0]) : null;
}

// Sonuc yazimlari LAUNCHING'e kosullu: arada admin iptali geldiyse (adminCancel
// LAUNCHING'i de kapsar) 0 satir etkilenir ve cagiran bunu GORUR — sessizce ezmez.
async function markLaunched(id, awxJobId) {
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'LAUNCHED', awx_job_id = $2, updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      OUTPUT INSERTED.id
      WHERE id = $1 AND status = 'LAUNCHING'`,
    [id, awxJobId]
  );
  return rows.length > 0;
}

// ONAY BEKLIYOR (2026-08-28): Smart onayi acikken zamanlanmis is HEMEN calismaz —
// once bir Smart bileti acilir. Eski kod bu donusu de `markLaunched` ile yaziyor,
// `result.jobId` olmadigi icin `awx_job_id = NULL` birakiyordu: panel YESIL "Tetiklendi"
// gosteriyor ama ortada job YOK. Bilet 15 dk icinde onaylanmazsa sessizce oluyordu ve
// ekranda hicbir sey degismiyordu. Artik kendi durumu var.
async function markPendingApproval(id, { smartTicketId, externalTicketId }) {
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'PENDING_APPROVAL', smart_ticket_id = $2,
            error_message = $3, updated_at = GETUTCDATE()
      OUTPUT INSERTED.id
      WHERE id = $1 AND status = 'LAUNCHING'`,
    [id, smartTicketId ?? null,
     `Kesinti saati geldi; Smart onay talebi acildi (#${externalTicketId || '?'}). Is, onay gelince tetiklenecek.`]
  );
  return rows.length > 0;
}

// Smart bileti onaylanip AWX job'i gercekten tetiklendiginde cagrilir (bkz.
// runner.cjs smart poller callback'i). PENDING_APPROVAL -> LAUNCHED.
async function markApprovedLaunched(id, awxJobId) {
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'LAUNCHED', awx_job_id = $2, error_message = NULL,
            updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      OUTPUT INSERTED.id
      WHERE id = $1 AND status = 'PENDING_APPROVAL'`,
    [id, awxJobId ?? null]
  );
  return rows.length > 0;
}

// Smart bileti reddedildi/zaman asimina ugradi/hata verdi: OCO kaydi da kapatilir,
// yoksa PENDING_APPROVAL'da sonsuza dek asili kalirdi.
async function markApprovalResolved(id, { status, message }) {
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = $2, error_message = $3,
            updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      OUTPUT INSERTED.id
      WHERE id = $1 AND status = 'PENDING_APPROVAL'`,
    [id, status, String(message || '').slice(0, 4000) || null]
  );
  return rows.length > 0;
}

async function markFailed(id, message) {
  // Kosullu: yalnizca HENUZ SONUCLANMAMIS bir kaydi FAILED yapar. Arada kullanici
  // iptal ettiyse CANCELLED korunur — "iptal ettim ama basarisiz yaziyor" olmasin.
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'FAILED', error_message = $2, updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      OUTPUT INSERTED.id
      WHERE id = $1 AND status IN ('SCHEDULED', 'LAUNCHING', 'PENDING_APPROVAL')`,
    [id, String(message || '').slice(0, 4000)]
  );
  return rows.length > 0;
}

// Pencere kapandigi halde hala tetiklenmemis kayit: OCO'nun izin verdigi saat gecti,
// artik CALISTIRILMAZ. (Portal kapaliyken run_at gecmisse bu dal devreye girer.)
async function markExpired(id) {
  await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'EXPIRED', updated_at = GETUTCDATE(), resolved_at = GETUTCDATE(),
            error_message = N'OCO kesinti penceresi tetikleme yapılmadan kapandı.'
      WHERE id = $1 AND status = 'SCHEDULED'`,
    [id]
  );
}

async function cancel(id, username) {
  const { rows } = await db.query(
    `UPDATE oco_scheduled_launches
        SET status = 'CANCELLED', updated_at = GETUTCDATE(), resolved_at = GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE id = $1 AND status IN ('SCHEDULED', 'PENDING_APPROVAL') AND username = $2`,
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
      WHERE id = $1 AND status IN ('SCHEDULED', 'AWX_SCHEDULED', 'LAUNCHING', 'PENDING_APPROVAL', 'LAUNCHED')`,
    [id, cancelledBy || null, String(note || '').slice(0, 1000) || null]
  );
  return rows[0] ? rowToRec(rows[0]) : null;
}

module.exports = { create, createAwxScheduled, get, listScheduled, listAll, listByUsername, claimForLaunch, markLaunched, markPendingApproval, markApprovedLaunched, markApprovalResolved, markFailed, markExpired, cancel, adminCancel };
