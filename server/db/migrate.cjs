#!/usr/bin/env node
// server/db/migrate.cjs
// Run: node server/db/migrate.cjs  (or: npm run migrate)
//
// Not: PostgreSQL migration sistemi kaldirildi — portal tamamen MSSQL kullanir.
// Tum sema (tablolar + kolon ekleme/genisletme migration'lari) tek yerden,
// idempotent olarak yonetilir: server/db/mssql-setup.cjs (sunucu boot'unda da
// otomatik calisir). Bu script yalnizca ayni kurulumu elle tetiklemek icindir.
'use strict';

// ORTAM YUKLEME SIRASI server/index.cjs ILE BIREBIR AYNI OLMALI. Eskiden burada
// yalnizca .env.local okunuyordu; portal "npm run prod" (APP_ENV=prod -> .env.prod) ile
// calisirken "npm run migrate" BASKA bir veritabanina baglanabiliyor, sema/temizlik
// islemleri calisan portalin gordugu DB'ye HIC ISLEMIYORDU. Sessiz ve tesbiti zor bir
// tuzak: komut "tamamlandi" diyor ama portal degismiyor.
const path0 = require('path');
const APP_ENV = String(process.env.APP_ENV || process.argv[2] || '').trim().toLowerCase();
if (APP_ENV) {
  process.env.APP_ENV = APP_ENV;
  require('dotenv').config({ path: path0.resolve(__dirname, `../../.env.${APP_ENV}`) });
}
require('dotenv').config({ path: path0.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ path: path0.resolve(__dirname, '../../.env') });
// Hangi veritabanina baglanildigi ACIKCA yazilir - "calistirdim ama degismedi"
// durumunda ilk bakilacak yer burasi (bkz. server/db/portal-mssql.cjs degisken adlari).
console.log(`[migrate] APP_ENV=${APP_ENV || '(yok)'} DB=${process.env.PORTAL_DB_DATABASE || process.env.MSSQL_DATABASE || '(tanimsiz)'} @ ${process.env.PORTAL_DB_SERVER || process.env.MSSQL_SERVER || '(tanimsiz)'}`);

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
