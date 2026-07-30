// server/logx/inventory.cjs
'use strict';

const db = require('../db/index.cjs');

async function listHosts() {
  const { rows } = await db.query(
    `SELECT id, hostname, fqdn, ip, environment, product_type,
            middleware_type, middleware_version, port, is_active, notes, server_type
     FROM inventory_hosts
     WHERE is_active = 1
     ORDER BY environment, hostname`
  );
  return rows.map(normalizeHost);
}

async function getAllHosts() {
  const { rows } = await db.query(
    `SELECT id, hostname, fqdn, ip, environment, product_type,
            middleware_type, middleware_version, port, is_active, notes, server_type,
            created_at, updated_at
     FROM inventory_hosts
     ORDER BY environment, hostname`
  );
  return rows.map(normalizeHost);
}

async function getHostById(id) {
  const { rows } = await db.query(
    'SELECT * FROM inventory_hosts WHERE id = $1', [id]
  );
  return rows[0] ? normalizeHost(rows[0]) : null;
}

async function createHost(data) {
  const { hostname, fqdn, ip, environment, product_type,
          middleware_type, middleware_version, port, is_active, notes, server_type } = data;
  const { rows } = await db.query(
    `INSERT INTO inventory_hosts
       (hostname, fqdn, ip, environment, product_type, middleware_type,
        middleware_version, port, is_active, notes, server_type, updated_at)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,GETUTCDATE())`,
    [hostname, fqdn || null, ip, environment || null, product_type || null,
     middleware_type || null, middleware_version || null, port || 1111,
     is_active !== false ? 1 : 0, notes || null, server_type || 'generic']
  );
  return rows[0] ? normalizeHost(rows[0]) : null;
}

async function updateHost(id, data) {
  const { hostname, fqdn, ip, environment, product_type,
          middleware_type, middleware_version, port, is_active, notes, server_type } = data;
  const { rows } = await db.query(
    `UPDATE inventory_hosts SET
       hostname = $1, fqdn = $2, ip = $3, environment = $4, product_type = $5,
       middleware_type = $6, middleware_version = $7, port = $8,
       is_active = $9, notes = $10, server_type = $11, updated_at = GETUTCDATE()
     OUTPUT INSERTED.*
     WHERE id = $12`,
    [hostname, fqdn || null, ip, environment || null, product_type || null,
     middleware_type || null, middleware_version || null, port || 1111,
     is_active !== false ? 1 : 0, notes || null, server_type || 'generic', id]
  );
  return rows[0] ? normalizeHost(rows[0]) : null;
}

async function deleteHost(id) {
  const { rowCount } = await db.query(
    'DELETE FROM inventory_hosts WHERE id = $1', [id]
  );
  return rowCount > 0;
}

// MSSQL returns BIT as true/false in recordset — normalize to JS boolean
function normalizeHost(row) {
  return { ...row, is_active: row.is_active === true || row.is_active === 1 };
}

module.exports = { listHosts, getAllHosts, getHostById, createHost, updateHost, deleteHost };
