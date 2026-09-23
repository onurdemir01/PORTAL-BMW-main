// server/logx/v2/__tests__/temizlik-sinirlari.test.cjs
//
// TEMIZLIK TURU KENDI KENDINI KOTULESTIRMESIN.
//
// Iki temizlik yolu `... IN ($1, ... $N)` uretiyordu ve `N` = suresi dolmus satir
// sayisiydi. MSSQL bir sorguda en fazla **2100 parametre** kabul eder. Normal
// gunlerde N kucuk; ama tur bir sure kosamazsa (portal kapali, DB erisilemez)
// N birikir ve 2100'u astigi anda sorgu HATA verir → tur basarisiz olur →
// satirlar TEMIZLENMEZ → her turda N daha da buyur. Hicbir sey olmadan baslayip
// hic duzelmeyen bir ariza.
//
// EN KRITIK BEKCI TS4'TUR: `SELECT`e tavan koyup `UPDATE`i TOPLU birakmak,
// okunmayan isteklerin staged DOSYALARINI SESSIZCE YETIM birakirdi — cunku
// `state` 'expired' olur ve `state <> 'expired'` predikati onlari bir daha HIC
// gormez. Sinir koymanin kendisi yeni bir sessiz veri kaybi uretebilirdi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function dilim(src, bas, son) {
  const i = src.indexOf(bas);
  assert.ok(i >= 0, `dilim baslangici yok: ${bas}`);
  const j = src.indexOf(son, i + bas.length);
  assert.ok(j > i, `dilim sonu yok: ${son}`);
  return src.slice(i, j);
}

const { chunk, MAX_PARAMS_PER_QUERY } = require('../../../util/sql-chunk.cjs');

test('TS1 parcalayici MSSQL tavaninin ALTINDA kalir', () => {
  const liste = Array.from({ length: 5000 }, (_, i) => `t${i}`);
  const parcalar = chunk(liste);
  assert.ok(parcalar.length > 1, 'hic parcalanmadi');
  for (const p of parcalar) {
    assert.ok(p.length <= MAX_PARAMS_PER_QUERY, `parca ${p.length} eleman — tavan asildi`);
    assert.ok(p.length <= 2000, 'MSSQL 2100 parametre sinirina tehlikeli yakin');
  }
  // HICBIR ELEMAN KAYBOLMAZ: parcalama bir veri kaybi yolu olmamali.
  assert.deepEqual(parcalar.flat(), liste);
});

test('TS2 BOS liste hic sorgu uretmez (bos `IN ()` sozdizimi hatasidir)', () => {
  assert.deepEqual(chunk([]), []);
  assert.deepEqual(chunk(null), []);
  assert.deepEqual(chunk(undefined), []);
});

test('TS3 `cleanupExpiredDownloads` hem TAVAN hem PARCALAMA tasir', () => {
  const d = dilim(kodOnly(oku('server/logx/v2/downloads.cjs')),
    'async function cleanupExpiredDownloads', 'module.exports');
  assert.match(d, /SELECT TOP \(/, 'sinirsiz SELECT — once bellegi doldurur');
  assert.match(d, /for \(const parca of chunk\(/, 'DELETE parcalanmiyor — 2100 parametre siniri');
  assert.doesNotMatch(d, /if\s*\(\s*(true|false|0|null|undefined)\s*\)/, 'sabit kosullu dal');
});

test('TS4 `expireOldRequests` UPDATE`i GORULEN satirlara hedefler (yetim dosya yok)', () => {
  const d = dilim(kodOnly(oku('server/logx/v2/requests.cjs')),
    'async function expireOldRequests', 'async function listRequestsForAdmin');
  assert.match(d, /SELECT TOP \(/, 'sinirsiz SELECT');
  // ASIL SINAV: UPDATE artik WHERE predikatiyla TOPLU kosmamali.
  assert.doesNotMatch(
    d,
    /UPDATE logx_v2_requests SET state = 'expired'\s*\n?\s*WHERE expires_at/,
    'UPDATE hala TOPLU — okunmayan isteklerin dosyalari yetim kalir',
  );
  assert.match(d, /WHERE request_id IN \(/, 'UPDATE gorulen satirlari hedeflemiyor');
  assert.match(d, /chunk\(/, 'hedefli UPDATE parcalanmiyor — 2100 parametre siniri geri geldi');
});

test('TS5 temizlik zamanlayicisi sureci CANLI TUTMAZ', () => {
  const d = kodOnly(oku('server/logx/v2/cleanup.cjs'));
  assert.match(d, /unref/, 'setInterval unref edilmiyor — kapanis gecikir');
});

test('TS6 cikti yoklamasinin KENDI durdurucusu var', () => {
  const d = kodOnly(oku('src/components/logx_v2/shared/JobProgress.tsx'));
  const i = d.indexOf('jobOutput(jobId)');
  assert.ok(i > 0, 'cikti yoklamasi bulunamadi');
  const blok = d.slice(Math.max(0, i - 900), i + 1200);
  assert.doesNotMatch(blok, /\.catch\(\(\)\s*=>\s*\{\}\)/, 'hata hala sessizce yutuluyor');
  assert.match(blok, /ardArdaHata/, 'kendi hata sayaci yok');

  // ── SEBEP HATA DALINDA YAZILMALI ────────────────────────────────────────────
  // Ilk yazimda yalnizca "blokta `setOutputError` geciyor mu" soruluyordu ve
  // bekci KORDU: hata dalindaki cagri silindiginde BASARI dalindaki
  // `setOutputError(null)` esleseiyor ve bekci geciyordu. Bu oturumda ucuncu kez
  // ayni desen (tanimlayicinin VARLIGI ≠ DOGRU YERDE olmasi). Artik yalnizca
  // `.catch(` sonrasina bakiliyor.
  const katch = d.indexOf('.catch(', i);
  assert.ok(katch > 0, 'hata dali bulunamadi');
  const hataDali = d.slice(katch, katch + 900);
  assert.match(
    hataDali,
    /setOutputError\(/,
    'sebep HATA dalinda ekrana yazilmiyor — kullanici bos terminal gorur ve nedenini ogrenemez',
  );
});

test('TS7 BASARILI cekim sayaci SIFIRLAR (gecici kesinti kalici olmasin)', () => {
  const d = kodOnly(oku('src/components/logx_v2/shared/JobProgress.tsx'));
  const then = d.indexOf('.then(', d.indexOf('jobOutput(jobId)'));
  const katch = d.indexOf('.catch(', then);
  assert.ok(then > 0 && katch > then, 'basari/hata dallari bulunamadi');

  // SADECE BASARI DALINA BAK. Ilk yazimda `indexOf('ardArdaHata = 0')` tum dosyada
  // araniyordu ve `let ardArdaHata = 0;` TANIMINI buluyordu — yani bekci sifirlamayi
  // degil bildirimi olcuyordu. (Ayni tuzaga bu depoda daha once `MB6`da dusulmustu.)
  const basariDali = d.slice(then, katch);
  assert.match(
    basariDali,
    /ardArdaHata\s*=\s*0/,
    'sayac BASARI dalinda sifirlanmiyor — tek gecici hata birikir ve yoklama kalici olarak olur',
  );
});
