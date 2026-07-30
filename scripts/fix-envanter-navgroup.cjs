#!/usr/bin/env node
// scripts/fix-envanter-navgroup.cjs
//
// Envanter'i "Genel" grubundan ayirip kendi ust-seviye grubuna tasir.
//
// NEDEN AYRI SCRIPT: mssql-setup.cjs icindeki seedPortalElements() idempotenttir —
// var olan element_key satirlarini ATLAR (`if (exists.recordset.length) continue;`).
// Bu yuzden yeni surumde 'navgroup:envanter' OLUSUR ama zaten var olan 'Envanter'
// sayfasinin parent_key'i GUNCELLENMEZ. Bu script o duzeltmeyi yapar.
//
// sqlcmd GEREKTIRMEZ — projenin kendi mssql havuzunu (node_modules/mssql) kullanir.
//
// Kullanim (proje kokunden):
//   node scripts/fix-envanter-navgroup.cjs prod     # .env.prod okur
//   node scripts/fix-envanter-navgroup.cjs          # .env.local / .env okur
//   node scripts/fix-envanter-navgroup.cjs prod --dry-run   # yalniz raporlar, yazmaz
//
// Idempotent: birden fazla kez calistirilabilir.
'use strict';

const path = require('path');

// Env yukleme sirasi server/index.cjs ile AYNI (dotenv ilk-yukleneni korur).
const APP_ENV = String(process.env.APP_ENV || process.argv[2] || '').trim().toLowerCase();
const VALID_ENVS = ['dev', 'test', 'qa', 'prod'];
if (APP_ENV && VALID_ENVS.includes(APP_ENV)) {
  process.env.APP_ENV = APP_ENV;
  require('dotenv').config({ path: path.resolve(__dirname, `../.env.${APP_ENV}`) });
}
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const db = require('../server/db/index.cjs');

// Hedef yapi: Envanter kendi grubunda, digerleri bir sira kayar.
const GROUP_ORDER = [
  ['navgroup:genel', 1],
  ['navgroup:envanter', 2],
  ['navgroup:logx', 3],
  ['navgroup:performance', 4],
  ['navgroup:operasyon', 5],
  ['navgroup:otomasyon', 6],
  ['navgroup:ai', 7],
  ['navgroup:kaynaklar', 8],
  ['navgroup:admin', 9],
];

async function dumpNav(title) {
  const { rows } = await db.query(
    `SELECT g.element_key AS grp, g.label AS grp_label, g.sort_order AS grp_order,
            p.element_key AS page, p.sort_order AS page_order
       FROM portal_elements g
       LEFT JOIN portal_elements p
              ON p.parent_key = g.element_key AND p.element_type = 'page'
      WHERE g.element_type = 'nav_group'
      ORDER BY g.sort_order, p.sort_order`
  );
  console.log(`\n--- ${title} ---`);
  let current = null;
  for (const r of rows) {
    if (r.grp !== current) {
      current = r.grp;
      console.log(`${String(r.grp_order).padStart(2)}. ${r.grp_label}  (${r.grp})`);
    }
    console.log(`      ${r.page ? '- ' + r.page : '- (bos)'}`);
  }
}

async function main() {
  console.log(`[fix-nav] APP_ENV=${process.env.APP_ENV || '(yok)'}  DB=${process.env.PORTAL_DB_DATABASE || process.env.MSSQL_DATABASE || '?'}`);

  await dumpNav('ONCE');

  if (DRY_RUN) {
    console.log('\n[fix-nav] --dry-run: hicbir degisiklik yazilmadi.');
    process.exit(0);
  }

  // 1) Grup yoksa olustur (yeni surum seed'i zaten olusturmus olabilir).
  const grp = await db.query(
    `SELECT 1 FROM portal_elements WHERE element_key = 'navgroup:envanter'`
  );
  if (!grp.rows.length) {
    await db.query(
      `INSERT INTO portal_elements
         (element_key, element_type, parent_key, label, route, sort_order, enabled, default_visible)
       VALUES ('navgroup:envanter', 'nav_group', NULL, N'Envanter', NULL, 2, 1, 1)`
    );
    console.log('[fix-nav] navgroup:envanter olusturuldu');
  } else {
    console.log('[fix-nav] navgroup:envanter zaten var');
  }

  // 2) ASIL DUZELTME — Envanter sayfasini yeni gruba tasi.
  const moved = await db.query(
    `UPDATE portal_elements
        SET parent_key = 'navgroup:envanter', sort_order = 1, updated_at = GETUTCDATE()
      WHERE element_key = 'Envanter' AND element_type = 'page'`
  );
  console.log(`[fix-nav] Envanter sayfasi tasindi (etkilenen satir: ${moved.rowCount})`);

  // 3) Dashboard "Genel" altinda tek oge kalsin.
  await db.query(
    `UPDATE portal_elements
        SET parent_key = 'navgroup:genel', sort_order = 1, updated_at = GETUTCDATE()
      WHERE element_key = 'Dashboard' AND element_type = 'page'`
  );

  // 4) Grup siralarini duzelt (mevcut kurulumda logx de sort_order=2 idi — cakisma).
  for (const [key, order] of GROUP_ORDER) {
    await db.query(
      `UPDATE portal_elements SET sort_order = $1, updated_at = GETUTCDATE()
        WHERE element_key = $2 AND element_type = 'nav_group'`,
      [order, key]
    );
  }
  console.log('[fix-nav] grup siralari guncellendi');

  await dumpNav('SONRA');

  console.log('\n[fix-nav] Tamam. Simdi portali yeniden baslatin:');
  console.log('  ./deploy/run.sh prod restart');
  console.log('Ardindan tarayicida Ctrl+Shift+R (nav gruplari sayfa yuklenirken bir kez cekilir).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fix-nav] HATA:', err.message);
    process.exit(1);
  });
