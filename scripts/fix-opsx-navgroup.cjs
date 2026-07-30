#!/usr/bin/env node
// scripts/fix-opsx-navgroup.cjs
//
// Navigasyonu yeniden yapilandirir:
//   * "LogX" ust-seviye grubu KALDIRILIR — LogX artik "otomasyon" grubunun alt ogesi
//   * "otomasyon" grubunun ETIKETI "Otomasyon" -> "Self Servis"
//   * "Self Service" SAYFASININ etiketi "Self Service" -> "Otomasyon"
//   * Yeni "OpsX" sayfasi eklenir (rota /opsx), ayni grubun altinda
//
// ANAHTARLAR DEGISMEZ: element_key degerleri ('navgroup:otomasyon', 'Self Service')
// oldugu gibi kalir — portal_element_visibility kurallari ve koddaki canViewPage()
// cagrilari bu anahtarlara bagli. Yalniz GORUNEN etiketler (label) degisir.
//
// NEDEN AYRI SCRIPT: seedPortalElements() idempotenttir — var olan element_key
// satirlarini ATLAR. Bu yuzden yeni surumdeki etiket/parent degisiklikleri MEVCUT
// veritabanina uygulanmaz. Frontend'deki NAV_GROUPS yalnizca FALLBACK'tir; DB'de
// nav_group satirlari varsa hic kullanilmaz.
//
// Kullanim (proje kokunden):
//   node scripts/fix-opsx-navgroup.cjs prod --dry-run
//   node scripts/fix-opsx-navgroup.cjs prod
//
// Idempotent: birden fazla kez calistirilabilir.
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
const db = require('../server/db/index.cjs');

async function dumpNav(title) {
  const { rows } = await db.query(
    `SELECT g.element_key AS grp, g.label AS grp_label, g.sort_order AS grp_order,
            p.element_key AS page, p.label AS page_label, p.sort_order AS page_order
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
    console.log(`      ${r.page ? `- ${r.page_label}  [${r.page}]` : '- (bos)'}`);
  }
}

async function main() {
  console.log(`[fix-nav] APP_ENV=${process.env.APP_ENV || '(yok)'}  DB=${process.env.PORTAL_DB_DATABASE || process.env.MSSQL_DATABASE || '?'}`);

  await dumpNav('ONCE');

  if (DRY_RUN) {
    console.log('\n[fix-nav] --dry-run: hicbir degisiklik yazilmadi.');
    process.exit(0);
  }

  // 1) Grup etiketi: Otomasyon -> Self Servis (ANAHTAR ayni)
  const g = await db.query(
    `UPDATE portal_elements SET label = N'Self Servis', updated_at = GETUTCDATE()
      WHERE element_key = 'navgroup:otomasyon' AND element_type = 'nav_group'`
  );
  console.log(`[fix-nav] grup etiketi -> Self Servis (satir: ${g.rowCount})`);

  // 2) Sayfa etiketi: Self Service -> Otomasyon (ANAHTAR ayni)
  const p = await db.query(
    `UPDATE portal_elements SET label = N'Otomasyon', updated_at = GETUTCDATE()
      WHERE element_key = 'Self Service' AND element_type = 'page'`
  );
  console.log(`[fix-nav] sayfa etiketi -> Otomasyon (satir: ${p.rowCount})`);

  // 3) LogX sayfasini otomasyon grubuna tasi
  const l = await db.query(
    `UPDATE portal_elements SET parent_key = 'navgroup:otomasyon', sort_order = 7, updated_at = GETUTCDATE()
      WHERE element_key = 'LogX' AND element_type = 'page'`
  );
  console.log(`[fix-nav] LogX -> navgroup:otomasyon (satir: ${l.rowCount})`);

  // 4) Artik bos kalan navgroup:logx'i devre disi birak.
  //    SILMEK yerine enabled=0: nav-groups endpoint'i yalniz enabled=1 gruplari
  //    dondurur (bkz. visibility-routes.cjs), yani menuden kalkar; kayit ve ona
  //    bagli olasi gorunurluk kurallari korunur (geri alinabilir).
  const og = await db.query(
    `UPDATE portal_elements SET enabled = 0, updated_at = GETUTCDATE()
      WHERE element_key = 'navgroup:logx' AND element_type = 'nav_group'`
  );
  console.log(`[fix-nav] navgroup:logx devre disi (satir: ${og.rowCount})`);

  // 5) OpsX sayfasi (yoksa olustur)
  const ex = await db.query(`SELECT 1 FROM portal_elements WHERE element_key = 'OpsX'`);
  if (!ex.rows.length) {
    await db.query(
      `INSERT INTO portal_elements
         (element_key, element_type, parent_key, label, route, sort_order, enabled, default_visible)
       VALUES ('OpsX', 'page', 'navgroup:otomasyon', N'OpsX', '/opsx', 8, 1, 1)`
    );
    console.log('[fix-nav] OpsX sayfasi olusturuldu');

    // Gorunurluk: seed'deki diger sayfalarla ayni desen — Admin + User
    for (const role of ['Admin', 'User']) {
      try {
        await db.query(
          `INSERT INTO portal_element_visibility (element_key, principal_type, principal_id, allow)
           VALUES ('OpsX', 'role', $1, 1)`,
          [role]
        );
      } catch { /* zaten varsa yoksay */ }
    }
    console.log('[fix-nav] OpsX gorunurlugu: Admin + User');
  } else {
    console.log('[fix-nav] OpsX zaten var');
  }

  await dumpNav('SONRA');

  console.log('\n[fix-nav] Tamam. Simdi portali yeniden baslatin:');
  console.log('  ./deploy/run.sh prod restart');
  console.log('Ardindan tarayicida Ctrl+Shift+R.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fix-nav] HATA:', err.message);
    process.exit(1);
  });
