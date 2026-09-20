// server/__tests__/sinirsiz-db-okumalari.test.cjs
//
// SINIRSIZ DB OKUMALARI VE BUDANMAYAN ONBELLEKLER — PR #109 taramasinin kalani.
//
// BU TURDA BILEREK DOKUNULMAYANLAR: `server/audit/denetim.cjs`teki envanter
// sorgulari. Onlara korlemesine `TOP` koymak, denetim ekraninin SESSIZCE EKSIK
// SAYMASI demek olurdu — "N uygulama" diyen bir ekranin yanlis sayi gostermesi,
// yavas gostermesinden KOTUDUR. O sorgular icin kirpmanin nasil raporlanacagi
// ayri bir karar; bu dosya o kalemi KAPSAMAZ ve kapsiyormus gibi de yapmaz.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const oku = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
/**
 * YORUMLARI ELE. Bu depoda tekrar eden kor bekci bicimi #1: bekci kendi
 * aradigi ifadeyi bir YORUM icinde bulur. Burada ters yonde vurdu — DB5,
 * `statSync`ten ONCE gelen bir aciklama satirindaki "readFileSync" kelimesini
 * gercek cagri sanip kirmizi dondu. Kural dogruydu, olcum yanlisti.
 */
const kodOnly = (s) =>
  s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
/**
 * FAIL-CLOSED dilimleyici. `indexOf` -1 dondugunde `slice` HATA VERMEZ —
 * sessizce yanlis bir dilim uretir ve olumsuz assert'ler bos metinde HER ZAMAN
 * gecer, yani bekci FAIL-OPEN olur. Sinir bulunamazsa test DUSER.
 */
function dilim(src, bas, son) {
  const i = src.indexOf(bas);
  const j = src.indexOf(son, i + 1);
  assert.ok(i >= 0, `dilim baslangici bulunamadi: ${bas}`);
  assert.ok(j > i, `dilim sonu bulunamadi: ${son}`);
  return src.slice(i, j);
}

const CS = kodOnly(oku('ansible/choice-sources.cjs'));
const LG = kodOnly(oku('logx/v2/legacy.cjs'));

// ── DB1-DB3: secenek onbellegi (KULLANICI ANAHTARLI) ───────────────────────

test('DB1 secenek onbellegi GIRIS SAYISINI sinirliyor', () => {
  // Anahtar survey form degerlerini tasiyor (`paramsFromValues`); her yeni
  // bilesim kalici bir giris birakiyordu ve her giris tam bir secenek listesi
  // (on binlerce cift) tutuyordu.
  assert.match(CS, /const CACHE_MAX_ENTRIES = \d+;/, 'giris tavani yok');
  assert.match(
    CS,
    /while \(cache\.size >= CACHE_MAX_ENTRIES\) cache\.delete\(cache\.keys\(\)\.next\(\)\.value\)/,
    'dolunca en eski atilmiyor',
  );
});

test('DB2 SURESI DOLAN giris SILINIYOR (TTL bellegi de koruyor)', () => {
  const i = CS.indexOf('const hit = cache.get(key);');
  const govde = CS.slice(i, i + 700);
  assert.match(govde, /cache\.delete\(key\)/, 'suresi dolan giris silinmiyor — TTL yalnizca tazeligi koruyor');
  // Silme, "taze mi" kontrolunden SONRA olmali; once olsaydi taze giris de silinirdi.
  const tazeIdx = govde.indexOf('< CACHE_TTL_MS');
  const silIdx = govde.indexOf('cache.delete(key)');
  assert.ok(tazeIdx > 0 && silIdx > tazeIdx, 'silme tazelik kontrolunden ONCE — taze giris de silinir');
  // OLU DAL YASAK. Mutasyon turunda silmenin onune `if (false)` koymak hicbir
  // seyi ates almadi: kod metinde duruyordu ama HIC KOSMUYORDU. Bu depoda
  // tekrar eden kor bekci bicimi #4 — "varligi arar, ULASILABILIRLIGI degil".
  assert.ok(
    !/if \((?:false|0|null|undefined)\)/.test(govde),
    'silme OLU DALA alinmis — metinde duruyor ama hic kosmuyor',
  );
});

test('DB3 yeniden yazimda FIFO sirasi TAZELENIYOR', () => {
  // `Map.set` mevcut anahtarin sirasini DEGISTIRMEZ; onceden silinmezse sicak
  // bir giris haksiz yere "en eski" sayilir ve atilir.
  const i = CS.indexOf('const choices = await src.load(p);');
  const govde = CS.slice(i, i + 500);
  const silIdx = govde.indexOf('cache.delete(key)');
  const setIdx = govde.indexOf('cache.set(key,');
  assert.ok(silIdx > 0 && silIdx < setIdx, 'yazimdan once silinmiyor — FIFO sirasi bozulur');
});

// ── DB4-DB6: legacy yedek dosyasi ──────────────────────────────────────────

test('DB4 yedek dosyasi HEM YAZMADA HEM OKUMADA sinirli', () => {
  assert.match(LG, /const SNAPSHOT_MAX_BYTES = /, 'tavan tanimli degil');
  // DILIM SINIRI KOD OLMALI, YORUM DEGIL. Ilk yazdigimda sinir olarak
  // `// GET /legacy/apps` yorumunu vermistim — ama yukarida yorumlari ELIYORUZ,
  // yani o sinir kaynakta YOK ve `indexOf` -1 donuyordu. `slice(i, -1)` hata
  // VERMEZ, sessizce bambaska bir dilim uretir ve bekci bos/yanlis metni
  // tarardi. Mutasyon turu bunu yakaladi (M5/M6 "kor" cikti).
  const yaz = dilim(LG, 'function writeSnapshotAsync', 'async function searchApps');
  const okuF = dilim(LG, 'function readSnapshot', 'function writeSnapshotAsync');
  // KOSULU OLC, MESAJI DEGIL. Ilk yazdigimda yalnizca `SNAPSHOT_MAX_BYTES`
  // gectigini ariyordum — ama o ad `console.warn` METNINDE de geciyor. Kapiyi
  // `if (false)` yapan mutasyon hicbir seyi ates almadi: sabit hala metinde
  // duruyordu. (kor bekci bicimi #4)
  assert.match(yaz, /if \(bayt > SNAPSHOT_MAX_BYTES\)/, 'YAZMADA sinir KOSULU yok');
  assert.match(okuF, /if \(st\.size > SNAPSHOT_MAX_BYTES\)/, 'OKUMADA sinir KOSULU yok');
  for (const [ad, g] of [['yazma', yaz], ['okuma', okuF]]) {
    assert.ok(
      !/if \((?:false|0|null|undefined)\)/.test(g),
      `${ad} kapisi OLU DALA alinmis — metinde duruyor ama hic kosmuyor`,
    );
  }
});

test('DB5 okumada ONCE BOYUTA bakiliyor, sonra dosya aciliyor', () => {
  const okuF = dilim(LG, 'function readSnapshot', 'function writeSnapshotAsync');
  const statIdx = okuF.indexOf('statSync');
  const readIdx = okuF.indexOf('readFileSync');
  assert.ok(statIdx > 0, 'boyut hic olculmuyor');
  assert.ok(statIdx < readIdx, 'dosya ONCE okunuyor — boyut kontrolu bellegi kurtarmaz');
});

test('DB6 yedek GIRINTISIZ yaziliyor (dosyayi ~2 kat buyutuyordu)', () => {
  const yaz = dilim(LG, 'function writeSnapshotAsync', 'async function searchApps');
  // BASIT VE SAGLAM: `[^)]*` desenim `new Date().toISOString()` icindeki
  // parantezi GECEMIYORDU, yani girintiyi geri koyan mutasyon eslesmiyordu ve
  // bekci yesil kaliyordu. Girinti argumani tek basina aranir.
  assert.ok(!/,\s*null,\s*2\s*\)/.test(yaz), 'hala girintili yaziliyor (`null, 2`)');
});

// ── DB7: uygulama listesi ──────────────────────────────────────────────────

test('DB7 uygulama listesi sinirli ve kirpma SESSIZ DEGIL', () => {
  // Bos aramada desen `LIKE '%%'` olur ve TUM tablo doner.
  assert.match(LG, /TOP \(\$\{APP_LIST_MAX \+ 1\}\)/, 'satir tavani yok');
  // `+1` KASITLI: tavana ulasildigini anlamak icin.
  assert.match(LG, /const truncated = hepsi\.length > APP_LIST_MAX/, 'kirpma tespit edilmiyor');
  assert.match(LG, /return \{ apps, fallbackMode: false, truncated/, 'kirpma cagiranla PAYLASILMIYOR');
});

// ── DB8: KAPSAM DISI OLANLAR ACIKCA BELGELI ────────────────────────────────

test('DB8 denetim envanter sorgulari BU TURDA kapsam disi ve bu YAZILI', () => {
  // Bir bekci, KAPSAMADIGI seyi de soylemeli; aksi halde "sinirsiz okumalar
  // kapandi" baslikli bir dosya, kapanmamis kalemleri kapanmis sandirir.
  const bu = fs.readFileSync(__filename, 'utf8');
  assert.match(bu, /denetim\.cjs.*kapsam disi|BILEREK DOKUNULMAYANLAR/s, 'kapsam disi kalemler belgelenmemis');
  const denetim = oku('audit/denetim.cjs');
  // Hala sinirsiz olduklarini KAYIT ALTINA al — ileride biri "kapatilmis"
  // sanmasin.
  assert.match(
    denetim,
    /SELECT DISTINCT namespace, application FROM dbo\.Openshift_Inventory/,
    'denetim sorgusu degismis — bu bekcinin varsayimi guncellenmeli',
  );
});
