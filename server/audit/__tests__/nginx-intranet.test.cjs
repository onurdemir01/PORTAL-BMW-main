// server/audit/__tests__/nginx-intranet.test.cjs
//
// Denetim > Nginx SPA > "Intranet" katmaninin hesabini kilitler.
//
// NEDEN VAR (2026-09-10, kullanici duzeltmesi): intranet sunuculari once internet
// sunuculariyla AYNI olculuyordu, yani <SERVICE>-<ENV>.conf vhost'unda location/include
// cifti araniyordu. Oysa o sunucularda GLOMO gibi servis vhost'lari HIC YOKTUR; oraya
// yalnizca OpenShift'teki intranet uygulamalari dagitilir ve kontrol UC DIZIN uzerinden
// yapilir. Eski hesap her intranet uygulamasini "eksik" gosterirdi.
//
// KILITLENEN IKI TASARIM KARARI:
//  1) YARIM kurulum (uc dizinden biri eksik) "tam"dan da "yok"tan da AYRI sayilir.
//     Yarim kurulum 404 doner ama mudahalesi bastan kurulumdan farklidir.
//  2) Kapsam orani YALNIZCA tam kurulumlar uzerinden hesaplanir - yarim kurulumu
//     kapsandi saymak, 404 donen uygulamayi yesil gostermek olurdu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { indexIntranetRows, coverageForEnv } = require('../nginx-intranet.cjs');

const row = (host, ns, app, hys, appd, conf) => ({
  host,
  namespace: ns,
  application: app,
  hys_deployed: hys,
  app_deployed: appd,
  conf_exists: conf,
  status: hys && appd && conf ? 'OK' : 'PARTIAL',
});

test('ortam SUNUCU ADINDAN turer, GBNGXT51 EDU istisnasi korunur', () => {
  const idx = indexIntranetRows([
    row('GBNGXD50', 'ns-dev', 'a', 1, 1, 1),
    row('GBNGXT50', 'ns-test', 'b', 1, 1, 1),
    row('GBNGXT51', 'ns-edu', 'c', 1, 1, 1),
    row('GBNGXQ50', 'ns-qa', 'd', 1, 1, 1),
    row('GBNGXP50', 'ns-prod', 'e', 1, 1, 1),
    row('GBNGXAP51', 'ns-prod', 'f', 1, 1, 1),
  ]);
  assert.deepEqual([...idx.keys()].sort(), ['DEV', 'EDU', 'PROD', 'QA', 'TEST']);
  // Iki prod sunucusu AYNI ortam kovasina duser.
  assert.deepEqual([...idx.get('PROD').keys()].sort(), ['e', 'f']);
});

test('intranet OLMAYAN host satiri sayilmaz', () => {
  // GBNGXT34 internete acik bir test sunucusu. Dizinleri intranet kapsamina katmak
  // orani oldugundan iyi gosterirdi.
  const idx = indexIntranetRows([
    row('GBNGXT34', 'ns-test', 'sizinti', 1, 1, 1),
    row('GBNGXT50', 'ns-test', 'gercek', 1, 1, 1),
  ]);
  assert.deepEqual([...idx.get('TEST').keys()], ['gercek']);
});

test('tam / yarim / yok UC AYRI kovada durur', () => {
  const idx = indexIntranetRows([
    row('GBNGXT50', 'ns-test', 'tam-app', 1, 1, 1),
    row('GBNGXT50', 'ns-test', 'confsuz', 1, 1, 0),
    row('GBNGXT50', 'ns-test', 'dosyasiz', 1, 0, 1),
  ]);
  const c = coverageForEnv(['tam-app', 'confsuz', 'dosyasiz', 'hic-yok'], idx.get('TEST'));

  assert.equal(c.total, 4);
  assert.equal(c.fullCount, 1);
  assert.equal(c.partialCount, 2);
  assert.equal(c.missingCount, 1);
  assert.deepEqual(c.missing, ['hic-yok']);

  // Eksik olanin NE oldugu ekranda yazacak kadar acik durmali.
  const confsuz = c.partial.find((p) => p.app === 'confsuz');
  assert.deepEqual(confsuz.hosts, [{ host: 'GBNGXT50', missing: ['conf'] }]);
  const dosyasiz = c.partial.find((p) => p.app === 'dosyasiz');
  assert.deepEqual(dosyasiz.hosts, [{ host: 'GBNGXT50', missing: ['applications'] }]);
});

test('kapsam orani YALNIZCA tam kurulumlar uzerinden hesaplanir', () => {
  const idx = indexIntranetRows([
    row('GBNGXT50', 'ns-test', 'a', 1, 1, 1),
    row('GBNGXT50', 'ns-test', 'b', 1, 1, 0), // yarim
  ]);
  const c = coverageForEnv(['a', 'b'], idx.get('TEST'));
  // Yarim kurulumu kapsandi saysaydik %100 gorurduk.
  assert.equal(c.coverage, 50);
});

test('ayni ortamdaki BIR sunucuda tam kurulum varsa uygulama tamdir', () => {
  // Prod'da dort intranet sunucusu var ve birbirinin aynasi degil. Birinde tam kurulum
  // varsa uygulama calisir; hangisinde eksik oldugu 'hosts' icinde durur.
  const idx = indexIntranetRows([
    row('GBNGXP50', 'ns-prod', 'a', 1, 1, 1),
    row('GBNGXP51', 'ns-prod', 'a', 1, 0, 0),
  ]);
  const c = coverageForEnv(['a'], idx.get('PROD'));
  assert.equal(c.fullCount, 1);
  assert.equal(c.partialCount, 0);
});

test('hicbir satir yoksa kapsam OLCULEMEZ - "%0" degil null', () => {
  const c = coverageForEnv(['a', 'b'], undefined);
  assert.equal(c.measured, false);
  assert.equal(c.coverage, null);
  // Beklenen kume yine de bildirilir; ekran "2 uygulama, olculemedi" diyebilsin.
  assert.equal(c.total, 2);
  assert.equal(c.missingCount, 2);
});

test('sunucuda olup OpenShift intranet listesinde olmayan uygulama BILGI olarak durur', () => {
  const idx = indexIntranetRows([
    row('GBNGXT50', 'ns-test', 'beklenen', 1, 1, 1),
    row('GBNGXT50', 'ns-test', 'retire-olmus', 1, 1, 1),
  ]);
  const c = coverageForEnv(['beklenen'], idx.get('TEST'));
  assert.equal(c.fullCount, 1);
  assert.deepEqual(c.onlyOnServer, ['retire-olmus']);
  // Bulgu DEGIL: kapsam oranini dusurmemeli.
  assert.equal(c.coverage, 100);
});

test('buyuk/kucuk harf farki ayni uygulamayi ikiye bolmez', () => {
  const idx = indexIntranetRows([row('GBNGXT50', 'ns-test', 'Sube-Portali', 1, 1, 1)]);
  const c = coverageForEnv(['sube-portali'], idx.get('TEST'));
  assert.equal(c.fullCount, 1);
  // Ekranda OpenShift'teki degil, SUNUCUDAKI yazim gosterilir (gercek olan o).
  assert.deepEqual(c.full, ['Sube-Portali']);
});

// ── Kablolama ────────────────────────────────────────────────────────────────────────
// Modul r.hys_deployed / r.app_deployed / r.conf_exists okuyor; denetim.cjs bu adlari
// SQL'de secmezse alanlar undefined gelir ve HER SEY "hic yok" gorunur - ekran sessizce
// yanlis olur, hicbir yerde hata cikmaz. Iki tarafi birbirine kilitliyoruz.
const fs = require('node:fs');
const path = require('node:path');

test('denetim.cjs sorgusu modulun okudugu KOLONLARI seciyor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  const m = /FROM dbo\.Nginx_Intranet_Audit/.exec(src);
  assert.ok(m, 'dbo.Nginx_Intranet_Audit sorgusu bulunamadi');
  // SELECT ... FROM arasindaki kolon listesi.
  const before = src.slice(0, m.index);
  const sel = before.lastIndexOf('SELECT');
  const cols = before.slice(sel);
  for (const c of [
    'host',
    'namespace',
    'application',
    'hys_deployed',
    'app_deployed',
    'conf_exists',
    'status',
  ]) {
    assert.ok(new RegExp('\\b' + c + '\\b').test(cols), `SQL'de eksik kolon: ${c}`);
  }
});

test('modul GERCEKTEN bu alan adlarini okuyor (kolon adi degisirse bu duser)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'nginx-intranet.cjs'), 'utf8');
  for (const c of ['hys_deployed', 'app_deployed', 'conf_exists']) {
    assert.ok(src.includes('r.' + c), `modul ${c} alanini okumuyor`);
  }
});
