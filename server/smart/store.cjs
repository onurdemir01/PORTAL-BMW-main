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

async function markState(id, { status, smartStateName, awxJobId, errorMessage, resolved }) {
  await db.query(
    `UPDATE smart_tickets
       SET status = $1, smart_state_name = $2, awx_job_id = $3, error_message = $4,
           updated_at = GETUTCDATE(), resolved_at = ${resolved ? 'GETUTCDATE()' : 'resolved_at'}
     WHERE id = $5`,
    [status, smartStateName || null, awxJobId || null, errorMessage || null, id]
  );
}

module.exports = { createTicket, getTicket, listPending, markState };
