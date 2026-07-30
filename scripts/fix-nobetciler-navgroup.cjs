#!/usr/bin/env node
// scripts/fix-nobetciler-navgroup.cjs
//
// "Operasyon" grubunu "Nobetciler" olarak yeniden adlandirir ve Gorevler sayfasini
// menuden cikarir. Grup tek ogeli kaldigi icin PageNav onu otomatik olarak
// UST-SEVIYE tek bir baglanti gibi cizer (bkz. PageNav.tsx:72 — items.length === 1
// dali); alt menu kalmaz.
//
// NEDEN AYRI SCRIPT: seedPortalElements() idempotenttir — var olan element_key
// satirlarini ATLAR. Bu yuzden yeni surumdeki etiket/parent degisiklikleri MEVCUT
// veritabanina uygulanmaz. Frontend'deki NAV_GROUPS ise yalnizca FALLBACK'tir;
// DB'de nav_group satirlari varsa hic kullanilmaz.
//
// GOREVLER SILINMEZ: sayfanin parent_key'i NULL yapilir. Sayfa kaydi, /gorev rotasi,
// portal_tasks verileri ve Admin > Gorevler sekmesi OLDUGU GIBI KALIR — yalnizca sol
// menude gorunmez. Geri almak icin parent_key tekrar bir nav_group'a set edilir.
//
// Kullanim (proje kokunden):
//   node scripts/fix-nobetciler-navgroup.cjs prod --dry-run
//   node scripts/fix-nobetciler-navgroup.cjs prod
//
// Idempotent: birden fazla kez calistirilabilir.
'use strict';

const path = require('path');

// Env yukleme sirasi server/index.cjs ile AYNI.
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

  // Gruba bagli olmayan sayfalar — menude gorunmezler ama rotalari calisir.
  const { rows: orphans } = await db.query(
    `SELECT element_key, route FROM portal_elements
      WHERE element_type = 'page' AND parent_key IS NULL
      ORDER BY element_key`
  );
  if (orphans.length) {
    console.log(`    (menu disi sayfalar: ${orphans.map((o) => `${o.element_key} -> ${o.route}`).join(', ')})`);
  }
}

async function main() {
  console.log(`[fix-nav] APP_ENV=${process.env.APP_ENV || '(yok)'}  DB=${process.env.PORTAL_DB_DATABASE || process.env.MSSQL_DATABASE || '?'}`);

  await dumpNav('ONCE');

  if (DRY_RUN) {
    console.log('\n[fix-nav] --dry-run: hicbir degisiklik yazilmadi.');
    process.exit(0);
  }

  // 1) Grup etiketi
  const lbl = await db.query(
    `UPDATE portal_elements SET label = N'Nöbetçiler', updated_at = GETUTCDATE()
      WHERE element_key = 'navgroup:operasyon' AND element_type = 'nav_group'`
  );
  console.log(`[fix-nav] grup etiketi -> Nobetciler (etkilenen satir: ${lbl.rowCount})`);

  // 2) Gorevler sayfasini menuden cikar (SILME — yalniz gruptan koparma)
  const det = await db.query(
    `UPDATE portal_elements SET parent_key = NULL, updated_at = GETUTCDATE()
      WHERE element_key = N'Görevler' AND element_type = 'page'`
  );
  console.log(`[fix-nav] Gorevler menuden cikarildi (etkilenen satir: ${det.rowCount})`);

  if (!lbl.rowCount && !det.rowCount) {
    console.log('[fix-nav] Degisiklik yok — muhtemelen zaten uygulanmis.');
  }

  await dumpNav('SONRA');

  console.log('\n[fix-nav] Tamam. Simdi portali yeniden baslatin:');
  console.log('  ./deploy/run.sh prod restart');
  console.log('Ardindan tarayicida Ctrl+Shift+R.');
  console.log('\nNot: /gorev rotasi ve portal_tasks verileri KORUNDU — sayfa yalnizca menude yok.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fix-nav] HATA:', err.message);
    process.exit(1);
  });
