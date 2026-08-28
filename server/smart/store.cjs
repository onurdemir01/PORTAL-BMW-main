// server/smart/store.cjs — smart_tickets tablosu icin CRUD. Ayri tutulur ki
// poller.cjs ve server/ansible/runner.cjs ayni DB erisim mantigini paylassin.
'use strict';

const db = require('../db/index.cjs');

function rowToTicket(r) {
  return {
    id: r.id,
    externalTicketId: r.external_ticket_id,
    username: r.username,
    awxServerId: r.awx_server_id,
    awxTemplateId: r.awx_template_id,
    flowKey: r.flow_key,
    status: r.status,
    smartStateName: r.smart_state_name,
    pendingLaunch: JSON.parse(r.pending_launch_json),
    awxJobId: r.awx_job_id,
    errorMessage: r.error_message,
    cancelNote: r.cancel_note ?? null,
    cancelledBy: r.cancelled_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}

async function createTicket({ externalTicketId, username, awxServerId, awxTemplateId, flowKey, pendingLaunch }) {
  const { rows } = await db.query(
    `INSERT INTO smart_tickets (external_ticket_id, username, awx_server_id, awx_template_id, flow_key, status, pending_launch_json)
     OUTPUT INSERTED.*
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)`,
    [externalTicketId, username, awxServerId, awxTemplateId, flowKey || null, JSON.stringify(pendingLaunch)]
  );
  return rowToTicket(rows[0]);
}

async function getTicket(id) {
  const { rows } = await db.query(`SELECT * FROM smart_tickets WHERE id = $1`, [id]);
  return rows[0] ? rowToTicket(rows[0]) : null;
}

async function listPending() {
  const { rows } = await db.query(`SELECT * FROM smart_tickets WHERE status = 'PENDING'`);
  return rows.map(rowToTicket);
}

// TUM kullanicilarin TUM talepleri — Admin > Smart Talepleri ekrani icin (2026-08-20).
// listByUsername'den farki: kullanici filtresi YOK. Buyuyen bir tablo oldugu icin
// (her Self Service Smart launch'i bir satir) sayfalama ZORUNLU; opsiyonel filtreler
// sunucu tarafinda uygulanir ki 10binlerce satir istemciye tasinmasin.
async function listAll({ limit = 100, offset = 0, status = '', username = '', q = '' } = {}) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (username) { params.push(`%${username}%`); where.push(`username LIKE $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    // Talep numarasi ya da pendingLaunch icindeki servis adi/degiskenler icinde arama.
    where.push(`(external_ticket_id LIKE $${params.length} OR pending_launch_json LIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await db.query(`SELECT COUNT(*) AS n FROM smart_tickets ${whereSql}`, params);
  const total = Number(countRes.rows[0]?.n || 0);

  // OFFSET/FETCH degerleri parametre yerine DOGRUDAN gomuluyor: mssql surucusunun bu
  // iki konumda tip cikarimi guvenilmez. Enjeksiyon riski yok — ikisi de Number'a
  // zorlanip tamsayiya yuvarlaniyor ve sinirlaniyor, string olarak hic gecmiyorlar.
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const lim = Math.min(500, Math.max(1, Math.floor(Number(limit) || 100)));
  const { rows } = await db.query(
    `SELECT * FROM smart_tickets ${whereSql}
      ORDER BY created_at DESC
      OFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY`,
    params
  );
  return { total, tickets: rows.map(rowToTicket) };
}

// Durum bazli ozet (Admin ekranindaki rozetler) — sayfalamadan BAGIMSIZ, TUM tabloyu
// kapsar; aksi halde "3 bekliyor" rozeti yalnizca gorunen sayfayi sayardi.
async function statusSummary() {
  const { rows } = await db.query(`SELECT status, COUNT(*) AS n FROM smart_tickets GROUP BY status`);
  const out = {};
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

// Kullanicinin kendi actigi TUM talepleri (durum farketmeksizin) — "Taleplerim" ekrani icin.
async function listByUsername(username) {
  const { rows } = await db.query(
    `SELECT * FROM smart_tickets WHERE LOWER(username) = LOWER($1) ORDER BY created_at DESC`,
    [username]
  );
  return rows.map(rowToTicket);
}

// Kullanici, otomasyon (AWX job'i) TETIKLENMEDEN once kendi talebini iptal edebilir.
// Sadece hala PENDING olan bir talep iptal edilebilir — WHERE kosulunda status='PENDING'
// olmasi, poller.cjs'in ayni anda talebi onaylayip LAUNCHED yapmasiyla yarisan bir durumda
// (iki islem ayni satiri ayni anda guncellemeye calisirsa) once davranan kazanir, once
// LAUNCHED olmus bir talep asla CANCELLED'a geri donmez. Poller sadece status='PENDING'
// olanlari isledigi icin (bkz. listPending), CANCELLED yapilan bir talep bir sonraki
// tick'te artik hic islenmez — otomasyon boylece tetiklenmeden durdurulmus olur.
// `note` opsiyoneldir: admin bir baskasinin talebini iptal ederken GEREKCE yazabilir
// (2026-08-20). `actor` iptali YAPAN kisidir - talebi ACAN (username) ile ayni olmak
// zorunda degil, admin baskasinin talebini iptal edebiliyor.
async function cancelTicket(id, username, isAdmin, note = '', actor = '') {
  const params = [id];
  if (!isAdmin) params.push(username);
  const ownerCond = isAdmin ? '' : `AND LOWER(username) = LOWER($${params.length})`;
  params.push(note ? String(note).slice(0, 1000) : null); const noteP = `$${params.length}`;
  params.push(actor || username || null);                 const actorP = `$${params.length}`;
  const { rows } = await db.query(
    `UPDATE smart_tickets
       SET status = 'CANCELLED', updated_at = GETUTCDATE(), resolved_at = GETUTCDATE(),
           cancel_note = ${noteP}, cancelled_by = ${actorP}
     OUTPUT INSERTED.*
     WHERE id = $1 AND status = 'PENDING' ${ownerCond}`,
    params
  );
  return rows[0] ? rowToTicket(rows[0]) : null;
}

// AWX'i tetiklemeden ONCE bileti sahiplen (2026-08-28). Poller `checkTicketStatus`te
// AG UZERINDE bekler; o sirada kullanici "iptal"e basarsa bilet CANCELLED olur. Eski
// kod bunu gormeden `_onApproved`i cagirip isi TETIKLIYOR, sonra kosulsuz `markState`
// ile iptali EZIP LAUNCHED yaziyordu — kullanici iptal ettigini sanirken is calisiyordu.
// `cancelTicket` zaten bu deseni kullaniyordu; simdi karsi taraf da ayni kapidan geciyor.
// PENDING -> LAUNCHING gecisini KAZANAN taraf tetikler; kaybeden hicbir sey yapmaz.
async function claimForLaunch(id) {
  const { rows } = await db.query(
    `UPDATE smart_tickets
       SET status = 'LAUNCHING', updated_at = GETUTCDATE()
     OUTPUT INSERTED.*
     WHERE id = $1 AND status = 'PENDING'`,
    [id]
  );
  return rows[0] ? rowToTicket(rows[0]) : null;
}

// KOSULLU durum yazimi. `expected` verilirse yalnizca bilet O DURUMDAYKEN yazar ve
// yazip yazmadigini DONDURUR. Kosulsuz `UPDATE ... WHERE id=$1` iptal/zaman asimi gibi
// arada olusan sonuclari sessizce eziyordu.
async function markState(id, { status, smartStateName, awxJobId, errorMessage, resolved, expected }) {
  const params = [status, smartStateName || null, awxJobId || null, errorMessage || null, id];
  let cond = '';
  if (expected) {
    const list = Array.isArray(expected) ? expected : [expected];
    cond = ' AND status IN (' + list.map((st) => { params.push(st); return `$${params.length}`; }).join(', ') + ')';
  }
  const { rows } = await db.query(
    `UPDATE smart_tickets
       SET status = $1, smart_state_name = $2, awx_job_id = $3, error_message = $4,
           updated_at = GETUTCDATE(), resolved_at = ${resolved ? 'GETUTCDATE()' : 'resolved_at'}
     OUTPUT INSERTED.id
     WHERE id = $5${cond}`,
    params
  );
  return rows.length > 0;
}

module.exports = { createTicket, getTicket, listPending, listByUsername, listAll, statusSummary, cancelTicket, claimForLaunch, markState };
