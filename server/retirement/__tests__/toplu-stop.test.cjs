// server/retirement/__tests__/toplu-stop.test.cjs — TS1..TS6 (2026-10-08).
//
// Kullanici: "Production'da 2 sunucu veya 4 sunucu ayni anda sectim; hepsi icin ayri ayri job'i
// tetiklemek istemiyorum. Tek seferde calistiralim ve SCC'ye tek e-posta gitsin."
// Kilit: secilen hedefler TEK iste; kapilar HER hedefte, biri tutmazsa hicbir is yok; her hedef
// KENDI sonucuyla sonuclanir (bir sunucunun dusmesi digerini 'failed' yapmaz, baskasinin OK'i
// da ona yazilmaz).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stopSonucu, stopKarari } = require('../stop-sonuc.cjs');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const ex = (art, k) => art[k];
const sat = (kod, m = 'x') => `RESULT\tstop\t${kod}\t${m}`;

test('TS1 coklu iste hedef KENDI sunucusunun sonucunu alir (buyuk/kucuk harf duyarsiz)', () => {
  const art = {
    app_retirement_stop_results: { GBJBOP10: { line: sat('OK'), plan_only: false }, gbjbop11: { line: sat('FAIL', 'hata'), plan_only: false } },
    app_retirement_stop_result: { host: 'gbjbop11', line: sat('FAIL', 'hata') },
  };
  const a = stopSonucu(art, 'gbjbop10', ex);
  const b = stopSonucu(art, 'GBJBOP11', ex);
  assert.equal(a.coklu, true);
  assert.equal(stopKarari('failed', a).ok, true, 'diger sunucu dustu diye basarili hedef failed sayildi');
  assert.equal(stopKarari('failed', b).ok, false);
  assert.equal(stopSonucu(art, 'GBJBOP99', ex).sonuc, null, 'listede olmayan hedefe baskasinin sonucu yazildi');
});

test('TS2 tek hedefte eski kural: is successful DEGILSE OK sayilmaz; eski playbook (yalniz tek anahtar) okunur', () => {
  const art = { app_retirement_stop_result: { host: 'A', line: sat('OK'), plan_only: false } };
  const s = stopSonucu(art, 'A', ex);
  assert.equal(s.coklu, false);
  assert.equal(stopKarari('successful', s).ok, true);
  assert.equal(stopKarari('failed', s).ok, false);
  assert.equal(stopSonucu({ app_retirement_stop_result: { host: 'B', line: sat('OK') } }, 'A', ex).sonuc, null, 'baska sunucunun tek sonucu bu hedefe yazildi');
});

test('TS3 coklu on kontrol: PLAN satiri planned, FAIL satiri failed (is durumu degil)', () => {
  const art = { app_retirement_stop_results: { A: { line: sat('PLAN'), plan_only: true }, B: { line: sat('FAIL'), plan_only: true } } };
  assert.equal(stopKarari('failed', stopSonucu(art, 'A', ex)).plan, true);
  assert.equal(stopKarari('successful', stopSonucu(art, 'B', ex)).plan, false);
});

const uc = IDX.slice(IDX.indexOf('async function stopBaslat('), IDX.indexOf("router.post('/:id/targets/:tid/rollback'"));

test('TS4 toplu uc: kapilar HER hedefte ve HEPSI launch\'tan ONCE; tek launch, tum hedefler ayni is no', () => {
  assert.match(IDX, /router\.post\('\/:id\/stop-toplu'/);
  const dongu = uc.indexOf('for (const t of hedefler) {');
  const launch = uc.indexOf('await launch(req, `Retirement: ${confirmed');
  assert.ok(dongu > 0 && launch > dongu, 'kapi dongusu yok ya da launch dongunun icinde/oncesinde');
  for (const k of ["if (confirmed && t.status !== 'planned')", "if (!confirmed && t.status === 'stop_scheduled')", "['planning', 'stopping', 'deleting', 'rolling_back'].includes(t.status)"]) {
    const i = uc.indexOf(k);
    assert.ok(i > dongu && i < launch, `kapi hedef dongusunde degil: ${k}`);
  }
  assert.equal(uc.split('await launch(req, `Retirement: ${confirmed').length - 1, 1, 'STOP isi birden fazla kez baslatiliyor');
  assert.match(uc, /for \(const h of hedefler\)\s*await db\(\)\.query\(`UPDATE retirement_targets SET status = \$1, last_job_id = \$2/, 'hedeflere ayni is no yazilmiyor');
});

test('TS5 toplu uc: farkli ortam ve ayni sunucu reddedilir; cokluda rt_hedefler, tekte eski degiskenler', () => {
  assert.match(uc, /new Set\(hedefler\.map\(\(h\) => h\.env\)\)\.size > 1/);
  assert.match(uc, /new Set\(hedefler\.map\(\(h\) => String\(h\.host\)\.toUpperCase\(\)\)\)\.size !== hedefler\.length/);
  assert.match(uc, /coklu\s*\? \{ rt_hedefler: hedefler\.map/);
  assert.match(uc, /: \{ target_host: t\.host, application: t\.appName/);
  // SCC karari is basina BIR kez (mail playbook'ta tek)
  assert.equal(uc.split('const notifyScc =').length - 1, 1);
});

test('TS6 sonuclandirma uclari hedefin KENDI sonucunu okur (job-status, tazele, poller)', () => {
  const js = IDX.slice(IDX.indexOf("router.get('/:id/targets/:tid/job-status"));
  assert.match(js, /stopSonucu\(statusInfo\.artifacts, hedefSatir\.rows\?\.\[0\]\?\.host, extractStatsKey\)/);
  assert.ok(!/extractStatsKey\(statusInfo\.artifacts, 'app_retirement_stop_result'\)/.test(IDX), 'tek anahtar dogrudan okunuyor - toplu iste baska hedefin sonucu yazilir');
  assert.match(IDX, /stopSonucu\(info\.artifacts, t\.host, extractStatsKey\)/);
  assert.equal(IDX.split('stopSonucu(info.artifacts, t.host, extractStatsKey)').length - 1, 2, 'tazele ve poller sonlandiricisinin ikisi de hedef sonucunu okumali');
});
