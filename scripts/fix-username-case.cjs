#!/usr/bin/env node
// scripts/fix-username-case.cjs
//
// Kullanici adlarini TEK BICIME (kucuk harf) getirir.
//
// NEDEN GEREKLI (kullanici, 2026-09-28): "Osman Koz icin yasadigimiz kucuk harf buyuk harf
// sorunu halen devam ediyor." Kod tarafi duzeltildi — giris, LDAP aramasi ve kimlik cozumu
// artik `normalizeUsername` ile ayni bicimi uretiyor. Ama ESKI SATIRLAR duzelmiyor: daha
// once karisik yazimla yazilmis kayitlar (is gecmisi, tercihler, AI sohbetleri, OCO,
// yetki kurallari) sahibinden kopuk kaliyor. Bu script onlari toplar.
//
// VARSAYILAN RAPORDUR, YAZMAZ. Yazmak icin `--apply` gerekir.
//
// CAKISMA SESSIZCE COZULMEZ: hem "Osman.Koz" hem "osman.koz" satiri varsa, kucultmek
// benzersizlik kisitini bozabilir ya da iki kaydi birlestirmis gibi yapip birini
// kaybettirebilir. Bu script boyle satirlari YAZMAZ, AYRI BASLIK altinda listeler —
// kararini insan verir.
//
// Kullanim (proje kokunden):
//   node scripts/fix-username-case.cjs prod              # yalniz rapor
//   node scripts/fix-username-case.cjs prod --apply      # duzeltmeyi uygular
//
// Idempotent: ikinci kosuda "duzeltilecek satir yok" der.
'use strict';

const path = require('path');

// Env yukleme sirasi server/index.cjs ile AYNI (dotenv ilk-yukleneni korur).
const APP_ENV = String(process.env.APP_ENV || process.argv[2] || '')
  .trim()
  .toLowerCase();
const VALID_ENVS = ['dev', 'test', 'qa', 'prod'];
if (APP_ENV && VALID_ENVS.includes(APP_ENV)) {
  process.env.APP_ENV = APP_ENV;
  require('dotenv').config({ path: path.resolve(__dirname, `../.env.${APP_ENV}`) });
}
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const APPLY = process.argv.includes('--apply');
const db = require('../server/db/index.cjs');

// (tablo, kolon, benzersizlik anahtari) — benzersizlik anahtari cakismayi belirler.
// portal_element_visibility: principal_id yalniz principal_type='user' icin kullanici adi
// tasir; 'group'/'email'/'role' ayri anlamda (grup DN'i, e-posta, rol adi).
const HEDEFLER = [
  { tablo: 'portal_users', kolon: 'username', anahtar: ['username'] },
  { tablo: 'portal_user_preferences', kolon: 'username', anahtar: ['username', 'pref_key'] },
  { tablo: 'user_role_overrides', kolon: 'username', anahtar: ['username'] },
  { tablo: 'ansible_job_history', kolon: 'username', anahtar: null },
  { tablo: 'ai_conversations', kolon: 'username', anahtar: null },
  {
    tablo: 'portal_element_visibility',
    kolon: 'principal_id',
    anahtar: ['element_key', 'principal_type', 'principal_id'],
    kosul: "principal_type = 'user'",
  },
];

async function varMi(tablo) {
  const { rows } = await db.query(`SELECT OBJECT_ID('dbo.${tablo}') AS oid`);
  return !!(rows[0] && rows[0].oid);
}

async function main() {
  console.log(
    APPLY ? '>> UYGULAMA MODU (--apply)' : '>> RAPOR MODU (yazmaz) — uygulamak icin --apply',
  );
  let toplamDuzeltilecek = 0;
  let toplamCakisma = 0;

  for (const h of HEDEFLER) {
    if (!(await varMi(h.tablo))) {
      console.log(`\n[${h.tablo}] tablo yok — atlandi.`);
      continue;
    }
    const ek = h.kosul ? ` AND ${h.kosul}` : '';

    // KAC SATIRA BAKILDI (2026-09-28, uretim raporu): rapor alti tablo icin de "temiz"
    // dedi. "Temiz" ile "BAKILACAK SATIR YOKTU" ayni cumleye cikiyordu — bos bir tablo da,
    // kosulun hicbir satiri tutmadigi bir tablo da ayni sekilde temiz gorunuyordu. Bu,
    // kullanicinin sordugu soruyu ("Osman'in sorunu duzeldi mi?") cevapsiz birakiyordu:
    // sifir bulgu, ancak paydayi bilirsen bir sey ifade eder. Ozellikle
    // portal_element_visibility'de principal_type='user' satiri HIC yoksa, yetkiler
    // grup/e-posta ile veriliyor demektir ve kullanici adi yazimi orada zaten hic rol
    // oynamamistir — bu bilgi rapordan okunabilmeli.
    const { rows: sayim } = await db.query(
      `SELECT COUNT(*) AS adet FROM dbo.${h.tablo} WHERE 1 = 1${ek}`,
    );
    const bakilan = Number((sayim[0] && sayim[0].adet) || 0);

    // Karisik yazimli satirlar: kolonun kendisi kucuk halinden FARKLI olanlar.
    const { rows: bozuk } = await db.query(
      `SELECT ${h.kolon} AS deger, COUNT(*) AS adet
         FROM dbo.${h.tablo}
        WHERE ${h.kolon} COLLATE Latin1_General_BIN2 <> LOWER(${h.kolon}) COLLATE Latin1_General_BIN2${ek}
        GROUP BY ${h.kolon}
        ORDER BY ${h.kolon}`,
    );
    if (!bozuk.length) {
      console.log(
        bakilan === 0
          ? `\n[${h.tablo}] BAKILACAK SATIR YOK (${h.kosul ? h.kosul + ' kosuluna uyan kayit yok' : 'tablo bos'}) — "temiz" DEGIL, olculecek bir sey yoktu.`
          : `\n[${h.tablo}] temiz — ${bakilan} satir bakildi, hepsi tek bicimde.`,
      );
      continue;
    }
    console.log(`\n[${h.tablo}] ${bakilan} satir bakildi.`);

    // Cakisma: kucultuldugunde ayni benzersizlik anahtarina sahip BASKA bir satir varsa.
    let cakisan = [];
    if (h.anahtar) {
      const digerler = h.anahtar.filter((a) => a !== h.kolon);
      const esitlik = digerler.map((a) => `b.${a} = k.${a}`).join(' AND ');
      const { rows } = await db.query(
        `SELECT DISTINCT b.${h.kolon} AS deger
           FROM dbo.${h.tablo} b
           JOIN dbo.${h.tablo} k
             ON LOWER(b.${h.kolon}) = k.${h.kolon}${esitlik ? ' AND ' + esitlik : ''}
          WHERE b.${h.kolon} COLLATE Latin1_General_BIN2 <> LOWER(b.${h.kolon}) COLLATE Latin1_General_BIN2${ek}`,
      );
      cakisan = rows.map((r) => String(r.deger));
    }

    const duzeltilecek = bozuk.filter((r) => !cakisan.includes(String(r.deger)));
    toplamDuzeltilecek += duzeltilecek.reduce((a, r) => a + Number(r.adet || 0), 0);
    toplamCakisma += cakisan.length;

    console.log(`\n[${h.tablo}] karisik yazimli ${bozuk.length} deger:`);
    for (const r of duzeltilecek) console.log(`   duzeltilecek: ${r.deger}  (${r.adet} satir)`);
    for (const c of cakisan)
      console.log(`   CAKISMA (elle bakin): ${c}  -> ${String(c).toLowerCase()} zaten var`);

    if (APPLY && duzeltilecek.length) {
      // KUCUK PARCALAR HALINDE: TBMWANS FULL recovery + AG ile calisiyor; tek seferlik
      // buyuk bir yazim log'u sisirir (2026-09-22'de bir kez yasandi).
      for (const r of duzeltilecek) {
        let kalan = true;
        while (kalan) {
          const { rowCount } = await db.query(
            `UPDATE TOP (2000) dbo.${h.tablo}
                SET ${h.kolon} = LOWER(${h.kolon})
              WHERE ${h.kolon} = $1
                AND ${h.kolon} COLLATE Latin1_General_BIN2 <> LOWER(${h.kolon}) COLLATE Latin1_General_BIN2${ek}`,
            [r.deger],
          );
          kalan = Number(rowCount || 0) === 2000;
        }
        console.log(`   yazildi: ${r.deger} -> ${String(r.deger).toLowerCase()}`);
      }
    }
  }

  console.log(
    `\nOZET: ${toplamDuzeltilecek} satir ${APPLY ? 'duzeltildi' : 'duzeltilecek'}, ` +
      `${toplamCakisma} deger CAKISMA nedeniyle elle karar bekliyor.`,
  );
  if (!APPLY && toplamDuzeltilecek) console.log('Uygulamak icin: --apply');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('HATA:', e.message);
    process.exit(1);
  });
