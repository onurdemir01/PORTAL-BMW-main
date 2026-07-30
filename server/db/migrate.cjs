#!/usr/bin/env node
// server/db/migrate.cjs
// Run: node server/db/migrate.cjs  (or: npm run migrate)
//
// Not: PostgreSQL migration sistemi kaldirildi — portal tamamen MSSQL kullanir.
// Tum sema (tablolar + kolon ekleme/genisletme migration'lari) tek yerden,
// idempotent olarak yonetilir: server/db/mssql-setup.cjs (sunucu boot'unda da
// otomatik calisir). Bu script yalnizca ayni kurulumu elle tetiklemek icindir.
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const { setupTables } = require('./mssql-setup.cjs');

setupTables()
  .then(() => {
    console.log('[migrate] MSSQL sema kurulumu tamamlandi (idempotent).');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[migrate]', err.message);
    process.exit(1);
  });
