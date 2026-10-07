// server/retirement/__tests__/vhost-trafik.test.cjs — TR1..TR7 (2026-10-08).
//
// Kullanici: "Retirement kaydi girilirken sunucunun Apache loglarinda hc istegi disinda
// istegin olup olmadigi kontrol edilip kaydi acana gosterilebilir mi? 'Bak halen istek
// var, yine de retire prosedurune devam etmek istiyor musun?' gibi soru sorulabilir."
//
// OLCUM YENI DEGIL: server_hub_scan.sh RHA/IHS access log kuyrugunu `www` ile okuyor,
// vhost basina sayiyor ve hc.html|hc.jsp isteklerini AYRI kovaya alip asil sayimdan
// disliyor. Portal'in retirement kesfi bunu OKUMUYORDU; eklenen sey o baglanti.
//
// EN PAHALI YANLIS: "OLCULEMEDI"yi "TRAFIK YOK" saymak. Retire karari buna dayaniyor;
// yanlis tarafa dusmek, hala istek alan bir uygulamayi durdurmak demek. Server Hub
// degismezi (server_hub/README.md): req_24h/req_7d/hc_24h >= 0 ANCAK VE ANCAK
// traffic_state ∈ {ACTIVE, NO_RECENT_TRAFFIC}; diger her durumda -1.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trafikSinifi } = require('../discover.cjs');
const DISC = fs.readFileSync(path.join(__dirname, '..', 'discover.cjs'), 'utf8');
const TAB = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'RetirementTab.tsx'),
  'utf8',
);

test('TR1 ACTIVE -> trafik VAR, sayilar hc HARIC', () => {
  const r = trafikSinifi({
    traffic_state: 'ACTIVE', traffic_reason: 'OK',
    req_24h: 12, req_7d: 340, hc_24h: 2880, sampled: 0, scan_date: '2026-10-07',
  });
  assert.equal(r.durum, 'var');
  assert.equal(r.req7, 340);
  assert.equal(r.req24, 12);
  // hc AYRI alanda durur; asil sayima KATILMAZ (tarayici zaten disliyor)
  assert.equal(r.hc24, 2880);
});

test('TR2 NO_RECENT_TRAFFIC -> trafik YOK (olculdu)', () => {
  const r = trafikSinifi({ traffic_state: 'NO_RECENT_TRAFFIC', traffic_reason: 'OK', req_24h: 0, req_7d: 0, hc_24h: 2880 });
  assert.equal(r.durum, 'yok');
  assert.equal(r.req7, 0);
});

test('TR3 OLCULMEMIS durumlar "yok" SAYILMAZ', () => {
  // Server Hub degismezi: bu durumlarda sayilar -1. "yok" demek en pahali yanlis.
  for (const st of ['UNVERIFIED', 'BUDGET_EXCEEDED', 'DEADLINE', 'DZDO_DENIED', 'EMPTY_LOG', 'NO_TIMESTAMP', '']) {
    const r = trafikSinifi({ traffic_state: st, traffic_reason: 'LOCATION_LOG', req_24h: -1, req_7d: -1, hc_24h: -1 });
    assert.equal(r.durum, 'olculemedi', `${st} durumu "${r.durum}" sayildi`);
    assert.ok(r.sebep, `${st} icin sebep yazilmamis`);
  }
});

test('TR4 SATIR YOK -> olculemedi (tarama o vhost\'u gormemis)', () => {
  const r = trafikSinifi(null);
  assert.equal(r.durum, 'olculemedi');
  assert.match(r.sebep, /kayit yok/i);
  assert.equal(trafikSinifi(undefined).durum, 'olculemedi');
});

test('TR5 TUTARSIZ veri (ACTIVE ama -1) olculemedi sayilir', () => {
  // Degismez geregi olculmus durumda sayi >= 0 olmali. -1 gelirse veri tutarsizdir;
  // "yok" saymak uygulamayi yanlis yere goturur, "var" saymak da uydurma olur.
  const r = trafikSinifi({ traffic_state: 'ACTIVE', req_7d: -1, req_24h: -1 });
  assert.equal(r.durum, 'olculemedi');
  assert.match(r.sebep, /sayi yok/i);
});

test('TR6 sampled=1 ALT SINIR olarak isaretlenir', () => {
  // Log kuyrugu kesildi: gercek sayi DAHA BUYUK olabilir. "340 istek" demek,
  // olculenin tamami oldugu izlenimi verirdi.
  const r = trafikSinifi({ traffic_state: 'ACTIVE', req_7d: 50, req_24h: 5, hc_24h: 100, sampled: 1 });
  assert.equal(r.sampled, true);
  assert.match(TAB, /tr\.sampled \? 'en az ' : ''/, 'ekran alt siniri belirtmiyor');
});

test('TR7 kesif ve ekran: sorgu en yeni taramadan, onay ZORUNLU', () => {
  // Sorgu EN YENI tarama ile sinirli olmali: eski bir taramanin trafigi "hala istek var"
  // demek olurdu.
  assert.match(DISC, /FROM dbo\.Server_Hub_Vhosts v/, 'vhost tablosu okunmuyor');
  // SUZGEC KONTROLU VHOST SORGUSUNA DARALTILIR. Ayni JOIN metni Server_Hub_Jvms
  // sorgusunda da geciyor; dosya genelinde aramak, vhost sorgusundan suzgeci
  // kaldiran mutasyonu KACIRIYORDU (W5, 2026-10-08).
  const vq = DISC.slice(DISC.indexOf('FROM dbo.Server_Hub_Vhosts v'));
  const vqSon = vq.slice(0, vq.indexOf('`'));
  assert.match(
    vqSon,
    /JOIN \(SELECT host, MAX\(scan_date\) AS d FROM dbo\.Server_Hub_Hosts GROUP BY host\) m\s*\n?\s*ON m\.host = v\.host AND m\.d = v\.scan_date/,
    'vhost sorgusunda en yeni tarama suzgeci yok - eski taramanin trafigi "hala istek var" dedirtir',
  );
  // Tablo okunamazsa HER vhost olculemedi olur - "yok" DEGIL
  assert.match(DISC, /trafikError = String/, 'okunamayan tablo bildirilmiyor');
  // server_name BUYUK/KUCUK HARF DUYARSIZ eslesmeli (Apache kasa korumuyor)
  assert.match(DISC, /server_name \|\| ''\)\.trim\(\)\.toLowerCase\(\)/, 'vhost anahtari kasaya duyarli');
  // Ozet uc kovayi AYRI tutar
  assert.match(DISC, /olculemedi: tumWeb\.filter/, 'ozet olculemedi kovasi tutmuyor');

  // EKRAN: onay kutusu ZORUNLU, yalnizca uyari gostermek yetmez
  assert.match(TAB, /if \(trafikli\.length && !trafikOnay\)/, 'onay kutusu kayit acmayi engellemiyor');
  assert.match(TAB, /devam etmek istiyorum/, 'onay metni yok');
  assert.match(TAB, /bu “istek yok” DEMEK DEĞİL/, 'olculemedi uyarisi "istek yok" ile karistirilabilir');
  // Yalniz SECILI hedefler sayilir
  assert.match(TAB, /const trafikli = selected\.flatMap/, 'trafik tum hedeflerden sayiliyor (secili olmayan dahil)');
});
