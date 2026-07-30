#!/usr/bin/env node
// server/db/seed.cjs
// Run: node server/db/seed.cjs  (or: npm run db:seed)
// Gelistirme/test icin ornek inventory host'lari ekler. Tekrar calistirmak guvenlidir
// (hostname+ip ikilisi zaten varsa atlar).
//
// Not: PostgreSQL bagimliligi kaldirildi — portal tamamen MSSQL kullanir
// (bkz. server/db/portal-mssql.cjs + server/db/index.cjs adapter'i).
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const { setupTables } = require('./mssql-setup.cjs');
const db = require('./index.cjs');

const SAMPLE_HOSTS = [
  {
    hostname: 'app-server-01',
    fqdn: 'app-server-01.internal.corp',
    ip: '10.10.1.101',
    environment: 'production',
    product_type: 'backend',
    middleware_type: 'JBoss',
    middleware_version: '7.4',
    port: 1111,
    is_active: true,
    notes: 'Primary JBoss EAP node',
  },
  {
    hostname: 'app-server-02',
    fqdn: 'app-server-02.internal.corp',
    ip: '10.10.1.102',
    environment: 'production',
    product_type: 'backend',
    middleware_type: 'JBoss',
    middleware_version: '7.4',
    port: 1111,
    is_active: true,
    notes: 'Secondary JBoss EAP node',
  },
  {
    hostname: 'web-proxy-01',
    fqdn: 'web-proxy-01.internal.corp',
    ip: '10.10.2.11',
    environment: 'production',
    product_type: 'frontend',
    middleware_type: 'IBM IHS',
    middleware_version: '9.0',
    port: 1111,
    is_active: true,
    notes: 'IBM HTTP Server proxy',
  },
  {
    hostname: 'was-node-01',
    fqdn: 'was-node-01.internal.corp',
    ip: '10.10.3.21',
    environment: 'production',
    product_type: 'backend',
    middleware_type: 'WebSphere',
    middleware_version: '9.0',
    port: 1111,
    is_active: true,
    notes: 'WebSphere Application Server',
  },
  {
    hostname: 'test-server-01',
    fqdn: 'test-server-01.internal.corp',
    ip: '10.20.1.101',
    environment: 'test',
    product_type: 'backend',
    middleware_type: 'JBoss',
    middleware_version: '8.0',
    port: 1111,
    is_active: true,
    notes: 'Test environment — JBoss EAP 8',
  },
];

async function run() {
  // Tablolar yoksa olustur (boot'taki idempotent kurulumla ayni yol)
  await setupTables();

  let inserted = 0;
  let skipped = 0;
  for (const h of SAMPLE_HOSTS) {
    // MSSQL'de ON CONFLICT yok — once varlik kontrolu (hostname+ip)
    const { rows } = await db.query(
      `SELECT 1 AS x FROM inventory_hosts WHERE hostname = $1 AND ip = $2`,
      [h.hostname, h.ip]
    );
    if (rows.length > 0) {
      skipped++;
      console.log(`  ~ ${h.hostname} (already exists)`);
      continue;
    }
    await db.query(
      `INSERT INTO inventory_hosts
         (hostname, fqdn, ip, environment, product_type, middleware_type, middleware_version, port, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [h.hostname, h.fqdn, h.ip, h.environment, h.product_type,
       h.middleware_type, h.middleware_version, h.port, h.is_active ? 1 : 0, h.notes]
    );
    inserted++;
    console.log(`  + ${h.hostname}`);
  }
  console.log(`[seed] done — ${inserted} inserted, ${skipped} skipped.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('[seed]', err.message);
  process.exit(1);
});
