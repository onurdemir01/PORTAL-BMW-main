#!/usr/bin/env node
// scripts/oco-arama-dene.cjs
//
// OCO ARAMA UCUNU PORTAL SUNUCUSUNDAN DENER (salt okunur; hicbir sey yazmaz).
//
// NEDEN (kullanici, 2026-09-28): OCO Takvimi ekraninda "HTTP 400" aliniyor. Ayni adres
// kullanicinin TARAYICISINDA calisiyor. Bu iki bilgi tek basina yeterli degil - arada
// uc apayri ihtimal var ve ucu de ayni ekrana ayni hatayi basiyor:
//
//   1) Portal'daki OCO_API_URL baska bir adres (Admin > Sistem'den girilen deger),
//   2) `servicerepository` adi Portal sunucusundan BASKA bir IP'ye cozuluyor
//      (ya da arada OCO_PROXY_URL/kurumsal proxy var),
//   3) adres dogru, servis Portal'in kimliksiz cagrisini reddediyor
//      (WCF, islem icinde hata alirsa 400 + "Request Error" HTML sayfasi dondurur).
//
// Bu script ucunu da AYIRT EDILEBILIR kilar: ayarin okudugu degeri, adin cozuldugu IP'yi
// ve servisin ham cevabini yan yana basar. URETIMDEKI KOD YOLUNUN AYNISINI kullanir
// (server/oco/search.cjs) - ayri bir istemci yazmak, TLS/proxy/timeout kurallarinin
// bir gun ayrismasi demekti.
//
// Kullanim (proje kokunden, Portal SUNUCUSUNDA):
//   node scripts/oco-arama-dene.cjs prod
//   node scripts/oco-arama-dene.cjs prod 6203     # baska bir grup denemek icin
'use strict';

const path = require('path');

// Env yukleme sirasi server/index.cjs ile AYNI (dotenv ilk-yukleneni korur).
const APP_ENV = String(process.env.APP_ENV || process.argv[2] || '')
  .trim()
  .toLowerCase();
if (['dev', 'test', 'qa', 'prod'].includes(APP_ENV)) {
  process.env.APP_ENV = APP_ENV;
  require('dotenv').config({ path: path.resolve(__dirname, `../.env.${APP_ENV}`) });
}
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const GRUP = process.argv.find((a, i) => i > 2 && /^\d+$/.test(a)) || '';

async function main() {
  // GERCEK AYAR DB'DE: Admin > Sistem ekranindan girilen degerler portal_env_overrides
  // tablosunda sifreli durur ve boot'ta process.env'e uygulanir. Bunu atlayip .env'e
  // bakmak, "script calisti ama Portal baska bir adrese gidiyor" demekti.
  try {
    await require('../server/db/env-overrides.cjs').loadEnvOverrides();
    console.log('[1] DB ayarlari (portal_env_overrides) yuklendi.');
  } catch (err) {
    console.log(
      `[1] DB ayarlari YUKLENEMEDI (${err.message}) - yalniz .env degerleri kullanilacak.`,
    );
  }

  const { getConfig } = require('../server/oco/config.cjs');
  const cfg = getConfig();
  console.log('[2] Cozulen ayarlar:');
  console.log(`      OCO_API_URL          = ${cfg.baseUrl || '(BOS - ayar girilmemis)'}`);
  console.log(`      OCO_SEARCH_GROUP_ID  = ${cfg.searchGroupId}`);
  console.log(`      OCO_PROXY_URL        = ${cfg.proxyUrl || '(yok)'}`);
  console.log(`      OCO_TIMEOUT_MS       = ${cfg.timeoutMs}`);
  if (!cfg.baseUrl) {
    console.log('\nSONUC: OCO_API_URL bos. Admin > Sistem ekranindan girilmeli.');
    process.exit(2);
  }

  // AD COZUMU: "tarayicimda calisiyor" ile "sunucudan calismiyor" farkinin en sik sebebi.
  const host = new URL(cfg.baseUrl).hostname;
  try {
    const { lookup } = require('dns').promises;
    const adresler = await lookup(host, { all: true });
    console.log(`[3] ${host} -> ${adresler.map((a) => a.address).join(', ')}`);
  } catch (err) {
    console.log(`[3] ${host} COZULEMEDI: ${err.message}`);
  }

  const { searchChangeOrders, PAGE_SIZE } = require('../server/oco/search.cjs');
  const grup = GRUP || cfg.searchGroupId;
  console.log(`[4] Arama deneniyor (grup=${grup}, sayfa boyu=${PAGE_SIZE})...`);
  try {
    const r = await searchChangeOrders({ groupId: grup });
    console.log(`\nSONUC: BASARILI. ${r.fetched} kayit alindi (servis toplam=${r.total}).`);
    if (r.truncated) console.log('UYARI: sayfa ust sinirina takildi, liste EKSIK.');
    for (const row of r.rows.slice(0, 5)) {
      console.log(
        `  OCO ${row.oco}  ${row.plannedStart || '(tarihsiz)'}  ${row.subject.slice(0, 60)}`,
      );
    }
    if (r.rows.length > 5) console.log(`  ... (+${r.rows.length - 5} kayit)`);
  } catch (err) {
    // Ustteki [OCO] satiri servisin HAM govdesinin basini tasir - sebep cogu zaman orada.
    console.log(`\nSONUC: BASARISIZ.\n${err.message}`);
    console.log(
      '\nBir sonraki adim: yukarida yazan "Cagrilan adres"i KENDI TARAYICINIZDA acin.' +
        '\n  * Tarayicida da hata veriyorsa  -> adres/grup yanlis (Admin > Sistem).' +
        '\n  * Tarayicida CALISIYORSA        -> servis Portal sunucusunun kimliksiz cagrisini' +
        '\n    reddediyor demektir; servis sahibinden Portal sunucusu icin erisim istenmeli.',
    );
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Beklenmeyen hata:', err);
    process.exit(1);
  });
