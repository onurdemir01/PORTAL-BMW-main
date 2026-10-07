// server/retirement/__tests__/akis.test.cjs — AK1..AK8 (2026-10-08).
//
// Kullanici: "Tum bu ozet tabloyu, uygulanacak komutlari ve akisi retirement kaydina
// girdikten sonra ekrana yansitabilir miyiz? Hangi adimda oldugunu, daha ne kadar
// kaldigini vesaire gorebilmek istiyorum."
//
// EN PAHALI UC YANLIS:
//   1. Bir asamanin yapildigini VARSAYMAK. Kullanici silme saatini bu ekrana gore
//      planliyor; "bitti" demek olculmus olmak zorunda, bilinmeyen durum 'bilinmiyor'.
//   2. "Tarih yok"u "0 gun kaldi" gostermek. STOP yapilmadiysa silme gunu YOKTUR
//      (schedule.etkinSilmeGunu ile ayni kural); 0 gun "bugun sil" demek olurdu.
//   3. LB/IP/DNS asamasini AKISTAN DUSURMEK ya da yapilmis gibi gostermek. Portal o
//      adimlari KOSTURMUYOR; dusurmek ekibin unutmasina, "bitti" demek yanlis guven.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'RetirementAkis.tsx'),
  'utf8',
);
const TAB = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'RetirementTab.tsx'),
  'utf8',
);
const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

test('AK1 KALAN GUN: tarih yoksa null (0 gun DEGIL)', () => {
  // `kalanGun` saf fonksiyon; burada kaynak duzeyinde sozlesmesi kilitlenir.
  assert.match(SRC, /export function kalanGun\(/, 'kalanGun ihrac edilmiyor');
  assert.match(SRC, /if \(!effectiveDeleteAt\) return null;/, 'tarih yoksa null donmuyor');
  // "0 gun" ile "tarih yok" ekranda da AYRI yazilmali
  assert.match(SRC, /tarih YOK — STOP yapılınca/, 'tarih yok hali ekranda ayrilmiyor');
  assert.match(SRC, /silme BUGÜN/, 'bugun hali ayri yazilmiyor');
});

test('AK2 BILINMEYEN durum "bitti" SAYILMAZ', () => {
  assert.match(SRC, /'bilinmiyor'/, 'bilinmiyor durumu yok');
  // STOP asamasi bilinmeyen statude 'bilinmiyor'a dusmeli, 'bitti'ye DEGIL
  const stop = SRC.slice(SRC.indexOf('const stopDurum'), SRC.indexOf('const stopBilgi'));
  assert.match(stop, /: 'bilinmiyor';/, 'STOP asamasi bilinmeyen durumda bitti sayiyor');
});

test('AK3 asamalar KOMUTU yaziyor (kullanici "hangi komut" diye sordu)', () => {
  for (const k of [
    'app_retirement_stop.yml',
    'stop-servers',
    'apache_retire_vhost',
    'app_retirement_delete.yml',
    'app_retirement_rollback.yml',
  ]) {
    assert.ok(SRC.includes(k), `akista ${k} komutu yazili degil`);
  }
  assert.match(SRC, /GERİ ALINAMAZ/, 'DELETE geri alinamaz uyarisi yok');
  assert.match(SRC, /DOKUNMAZ/, 'plan adiminin sunucuya dokunmadigi yazili degil');
});

test('AK4 LB/IP/DNS asamasi VAR ve "elle" diyor', () => {
  assert.match(SRC, /LB \/ IP \/ DNS/, 'LB/IP/DNS asamasi akista yok');
  assert.match(SRC, /Portal bu adımı ÇALIŞTIRMAZ/, 'otomatize edilmedigi yazili degil');
  // DOSYA BASINDAKI YORUMDA da "LB / IP / DNS" geciyor; `indexOf` onu buluyordu ve
  // bekci kod yerine yorumu olcuyordu. Asama nesnesinin KENDISI aranir.
  const i = SRC.indexOf("ad: '⚑ LB / IP / DNS'");
  assert.ok(i > 0, 'LB/IP/DNS asama nesnesi bulunamadi');
  assert.match(SRC.slice(i, i + 300), /durum: 'elle'/, 'LB/IP/DNS asamasi elle olarak isaretlenmemis');
});

test('AK5 NGINX vhost otomatik DEGIL - akista yazili', () => {
  assert.match(SRC, /NGINX otomatik DEĞİL|NGINX otomatik DEGIL/, 'nginx istisnasi akista yazili degil');
  assert.match(SRC, /ELLE \(NGINX\)/, 'manual vhost sayisi nginx olarak etiketlenmiyor');
});

test('AK6 GERI ALINDIYSA bekleme/DELETE atlanir, silme devre disi yazilir', () => {
  // Geri alinmis bir hedefte "38 gun kaldi" gostermek yanlis olurdu: silme kapisi kapali.
  assert.match(SRC, /geri alındı — silme devre dışı/, 'geri alinmis hedefte silme devre disi yazilmiyor');
  const bekleme = SRC.slice(SRC.indexOf('const beklemeDurum'), SRC.indexOf('const beklemeBilgi'));
  assert.match(bekleme, /geriAlindi \? 'atlandi'/, 'geri alinmis hedefte bekleme atlanmiyor');
});

test('AK7 UYGULANAN web sonucu sunucudan DONUYOR (akis onu okuyor)', () => {
  // `web` alani KESIF listesi; uygulanan sonuc (web_result_json) onyuze hic gitmiyordu.
  assert.match(IDX, /webSonuc: \(\(\) => \{/, 'webSonuc onyuze donmuyor');
  assert.match(IDX, /t\.web_result_json/, 'uygulanan vhost sonucu okunmuyor');
  assert.match(IDX, /scheduledAt: t\.scheduled_at/, 'OCO zamanlamasi onyuze donmuyor');
});

test('AK8 TAKILMIS gecis durumu icin "Durumu tazele" yolu var ve OLCER', () => {
  // Kullanici: "iptal ettigim kayda dokunamiyorum" - hedef 'stopping'de kalinca ne STOP
  // ne geri alma dugmesi gorunuyordu.
  const ep = IDX.slice(IDX.indexOf("router.post('/:id/targets/:tid/refresh-status'"), IDX.indexOf('// ── GERI AL'));
  assert.ok(ep.length > 0, 'refresh-status ucu yok');
  // OKUNAMADI != BASARISIZ: AWX okunamazsa hedefe DOKUNULMAZ
  assert.match(ep, /AWX işi okunamadı/, 'okunamayan is icin ayri yanit yok');
  assert.match(ep, /if \(!TERMINAL\.has\(info\.status\)\)/, 'calisan isi sonuclandiriyor');
  // Artifact yoksa 'successful' bile OK sayilmamali (poller ile ayni kural)
  assert.match(ep, /info\.status === 'successful' && line\.split/, 'artifact kontrolu yok');
  // Yalniz GECIS durumlarinda calismali
  assert.match(ep, /TAZELE_ADIM\[t\.status\]/, 'gecis durumu kontrolu yok');
  assert.match(ep, /bir geçiş durumu değil/, 'gecis disi durumda ret mesaji yok');
  // Ekranda dugme
  assert.match(TAB, /'planning', 'stopping', 'rolling_back', 'deleting'/, 'tazele dugmesi gecis durumlarina bagli degil');
  assert.match(TAB, /Durumu tazele/, 'tazele dugmesi yok');
});
