#!/usr/bin/env node
// scripts/remove-tasks.cjs
//
// "Gorevler" ozelligini MEVCUT veritabanindan tamamen kaldirir:
//   * portal_elements: 'Gorevler' (page) ve 'admintab:tasks' (admin_tab) satirlari
//   * portal_element_visibility: bu iki element'e bagli gorunurluk kurallari
//   * page_visibility: eski sema 'Gorevler' satiri
//   * portal_task_comments + portal_tasks TABLOLARI (once comments — FK bagimliligi)
//
// DIKKAT: portal_tasks ve portal_task_comments VERI ICERIR. Bu tablolari DROP etmek
// GERI ALINAMAZ. Yeni surumun seed'inde bu tablolar artik yok, ama seed idempotent
// oldugu icin var olan tablolari KENDILIGINDEN SILMEZ — bu yuzden acikca burada
// dusuruluyor. Onemli veri varsa once yedek alin.
//
// Kullanim (proje kokunden):
//   node scripts/remove-tasks.cjs prod --dry-run    # ne yapilacagini raporlar
//   node scripts/remove-tasks.cjs prod --drop-tables # tablolari da dusurur
//   node scripts/remove-tasks.cjs prod              # tablolari BIRAKIR, yalniz menu/gorunurluk temizler
//
// Varsayilan GUVENLI: --drop-tables VERILMEZSE tablolar DOKUNULMADAN birakilir
// (menuden kalkar ama veri diskte durur). Tablolari da silmek icin acik onay gerekir.
'use strict';

const path = require('path');

const APP_ENV = String(process.env.APP_ENV || process.argv[2] || '').trim().toLowerCase();
const VALID_ENVS = ['dev', 'test', 'qa', 'prod'];
if (APP_ENV && VALID_ENVS.includes(APP_ENV)) {
  process.env.APP_ENV = APP_ENV;
  require('dotenv').config({ path: path.resolve(__dirname, `../.env.${APP_ENV}`) });
}
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const DROP_TABLES = process.argv.includes('--drop-tables');
const db = require('../server/db/index.cjs');

async function tableExists(name) {
  const { rows } = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = $1`, [name]
  );
  return rows.length > 0;
}

async function rowCount(name) {
  try {
    const { rows } = await db.query(`SELECT COUNT(*) AS n FROM ${name}`);
    return rows[0]?.n ?? 0;
  } catch { return '?'; }
}

async function main() {
  console.log(`[remove-tasks] APP_ENV=${process.env.APP_ENV || '(yok)'}  DB=${process.env.PORTAL_DB_DATABASE || process.env.MSSQL_DATABASE || '?'}`);
  console.log(`[remove-tasks] mod: ${DRY_RUN ? 'DRY-RUN' : (DROP_TABLES ? 'TABLOLAR DAHIL SILME' : 'yalniz menu/gorunurluk (tablolar korunur)')}`);

  const hasTasks = await tableExists('portal_tasks');
  const hasComments = await tableExists('portal_task_comments');
  console.log(`\n--- Durum ---`);
  console.log(`portal_tasks:          ${hasTasks ? `var (${await rowCount('portal_tasks')} kayit)` : 'yok'}`);
  console.log(`portal_task_comments:  ${hasComments ? `var (${await rowCount('portal_task_comments')} kayit)` : 'yok'}`);

  const { rows: elems } = await db.query(
    `SELECT element_key, element_type FROM portal_elements
      WHERE element_key IN (N'Görevler', 'admintab:tasks')`
  );
  console.log(`portal_elements:       ${elems.length ? elems.map((e) => e.element_key).join(', ') : '(temiz)'}`);

  if (DRY_RUN) {
    console.log('\n[remove-tasks] --dry-run: hicbir degisiklik yazilmadi.');
    if (hasTasks && !DROP_TABLES) {
      console.log('NOT: tablolari da silmek icin --drop-tables ekleyin (GERI ALINAMAZ).');
    }
    process.exit(0);
  }

  // 1) Gorunurluk kurallari (element_key'e bagli)
  const vis = await db.query(
    `DELETE FROM portal_element_visibility WHERE element_key IN (N'Görevler', 'admintab:tasks')`
  );
  console.log(`\n[remove-tasks] gorunurluk kurallari silindi (satir: ${vis.rowCount})`);

  // 2) portal_elements satirlari
  const el = await db.query(
    `DELETE FROM portal_elements WHERE element_key IN (N'Görevler', 'admintab:tasks')`
  );
  console.log(`[remove-tasks] portal_elements satirlari silindi (satir: ${el.rowCount})`);

  // 3) Eski sema page_visibility (tablo hala varsa)
  if (await tableExists('page_visibility')) {
    const pv = await db.query(`DELETE FROM page_visibility WHERE page_name = N'Görevler'`);
    console.log(`[remove-tasks] page_visibility satiri silindi (satir: ${pv.rowCount})`);
  }

  // 4) Tablolar — yalniz acik onayla
  if (DROP_TABLES) {
    // Once comments (portal_tasks'a FK ile bagli), sonra tasks.
    if (hasComments) {
      await db.query(`DROP TABLE portal_task_comments`);
      console.log('[remove-tasks] portal_task_comments TABLOSU dusuruldu.');
    }
    if (hasTasks) {
      await db.query(`DROP TABLE portal_tasks`);
      console.log('[remove-tasks] portal_tasks TABLOSU dusuruldu.');
    }
  } else if (hasTasks || hasComments) {
    console.log('\n[remove-tasks] Tablolar KORUNDU (menuden kalkti ama veri diskte duruyor).');
    console.log('Tablolari da silmek icin: node scripts/remove-tasks.cjs prod --drop-tables');
  }

  console.log('\n[remove-tasks] Tamam. Portali yeniden baslatin:');
  console.log('  ./deploy/run.sh prod restart');
  console.log('Ardindan tarayicida Ctrl+Shift+R.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[remove-tasks] HATA:', err.message);
    process.exit(1);
  });
