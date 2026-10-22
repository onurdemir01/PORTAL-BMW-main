// server/retirement/__tests__/onkontrol.test.cjs — OK1..OK7 (2026-10-22).
//
// Kullanici: "On Kontrol adiminda hangi komutlarin uygulanacagi, hangi uygulamanin, hangi
// konfigurasyonlarin, filesystem'de hangi dizinlerin etkilenecegi acik acik yazdiralim ve bunlarin
// disinda hicbir seye dokunulmadigindan emin olalim."
// Portal'in payi: on kontrol listesini ve izin listesini saklar; onayli STOP (elle ve zamanlanmis)
// YALNIZ son on kontrolun izin listesiyle kosar; liste yoksa onay acilmaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { onKontrolIzinleri, planKaydi } = require('../stop-sonuc.cjs');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const dilim = (bas, son) => {
  const i = IDX.indexOf(bas);
  assert.ok(i >= 0, `bulunamadi: ${bas}`);
  const j = IDX.indexOf(son, i + bas.length);
  return IDX.slice(i, j > i ? j : undefined);
};

test('OK1 izin kaydi yalniz onay kimligi varsa ve AYNI on kontrol isine aitse gecerli', () => {
  const k = JSON.stringify({ jobId: 10, izinler: ['onay:A|JBoss7|H', 'mv:/vhosting/A.ear'] });
  assert.deepEqual(onKontrolIzinleri(k, 10), ['onay:A|JBoss7|H', 'mv:/vhosting/A.ear']);
  assert.equal(onKontrolIzinleri(k, 11), null, 'baska on kontrol isinin listesi kabul edildi');
  assert.equal(onKontrolIzinleri(JSON.stringify({ jobId: 10, izinler: ['mv:/x'] }), 10), null, 'onay kimligi olmayan liste kabul edildi');
  assert.equal(onKontrolIzinleri('{bozuk', 10), null);
  assert.equal(onKontrolIzinleri(null, 10), null);
});

test('OK2 planKaydi: onkontrol ayrintiya, izinler ayri kayda; uzun ayrinti KESILMEZ (gecerli JSON kalir)', () => {
  const r = { steps: ['STEP\ta\tOK\tx'], renamed: [], onkontrol: ['ONKONTROL\tozet\t1\tx'], izinler: ['onay:A|JBoss7|H'] };
  const k = planKaydi(r, 5);
  assert.deepEqual(JSON.parse(k.detailJson).onkontrol, ['ONKONTROL\tozet\t1\tx']);
  assert.deepEqual(JSON.parse(k.izinJson).izinler, ['onay:A|JBoss7|H']);
  assert.equal(JSON.parse(k.izinJson).jobId, 5);
  assert.equal(planKaydi({ ...r, izinler: undefined }, 5).izinJson, null, 'eski playbook ciktisinda izin uyduruldu');
  const uzun = planKaydi({ ...r, steps: Array.from({ length: 3000 }, (_, i) => `STEP\tx\tOK\t${'y'.repeat(40)}${i}`) }, 5);
  const d = JSON.parse(uzun.detailJson);
  assert.equal(d.kisaltildi, true);
  assert.ok(uzun.detailJson.length <= 60000);
});

test('OK3 onayli STOP izin listesi olmadan BASLAMAZ; kapi hedef dongusunde, OCO ve launch ONCESI', () => {
  const ep = dilim('async function stopBaslat(', "router.post('/:id/targets/:tid/refresh-status'");
  const kapi = ep.indexOf('if (confirmed && !t.stopIzin)');
  assert.ok(kapi > 0, 'onayli STOP izin listesi kapisi yok');
  assert.ok(kapi < ep.indexOf('ocoClient.getChangeOrder'), 'kapi OCO zamanlamasindan sonra - izinsiz zamanlama yazilabilir');
  assert.ok(kapi < ep.indexOf('await launch('), 'kapi launch sonrasi');
});

test('OK4 onayli STOP hedef basina onaylanan listeyi gonderir; on kontrol eski listeyi siler', () => {
  const ep = dilim('async function stopBaslat(', "router.post('/:id/targets/:tid/refresh-status'");
  assert.match(ep, /const izinOf = \(h\) => \(confirmed \? \{ izinler: h\.stopIzin\.izinler \} : \{\}\);/);
  assert.match(ep, /rt_hedefler: hedefler\.map\(\(h\) => \(\{[^}]*\.\.\.izinOf\(h\) \}\)\)/, 'toplu iste hedef basina izin gitmiyor');
  assert.match(ep, /app_path: t\.appPath \|\| '', \.\.\.izinOf\(t\) \}/, 'tek hedefte izin gitmiyor');
  assert.match(ep, /SET status = \$1, last_job_id = \$2, stop_izin_json = NULL/, 'yeni on kontrol eski izin listesini gecersiz kilmiyor');
});

test('OK5 on kontrol sonucu (job-status ve tazele) ayrintiyi ve izin listesini yazar; gercek kosu izin yazmaz', () => {
  const js = dilim("router.get('/:id/targets/:tid/job-status", '// ── POLLER');
  assert.match(js, /const \{ detailJson, izinJson \} = planKaydi\(result, jobId\);/);
  assert.match(js, /detail_json = \$3, stop_izin_json = \$4, updated_at = GETUTCDATE\(\) WHERE id = \$5`, \[karar\.plan \? 'planned' : 'failed', msg\.slice\(0, 1000\), detailJson, karar\.plan \? izinJson : null, tid\]/);
  const tz = dilim("router.post('/:id/targets/:tid/refresh-status'", '// ── GERI AL');
  assert.match(tz, /if \(adim\.kind === 'stop' && t\.status === 'planning'\)/, 'tazele on kontrolun ayrintisini / izin listesini yazmiyor');
  assert.match(tz, /stop_izin_json = \$5/);
});

test('OK6 zamanlanmis STOP launcher izin listesini hedef basina betige tasir', () => {
  const ln = dilim("require('./poller.cjs').startPoller(", 'SONLANDIRICI');
  assert.match(ln, /const izinOf = \(h\) => \(kind === 'stop' \? \{ izinler: h\.izinler \|\| \[\] \} : \{\}\);/);
  assert.match(ln, /\.\.\.izinOf\(h\) \}\)\)/);
  assert.match(ln, /\.\.\.izinOf\(t\) \}/);
});

test('OK7 hedef satiri izin listesini yalniz son on kontrol isine aitse dondurur', () => {
  const rt = dilim('function rowTarget(t) {', '\n}\n');
  assert.match(rt, /onKontrolIzinleri\(t\.stop_izin_json, t\.last_job_id\)/);
});
