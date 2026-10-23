// server/audit/__tests__/web-app-onbellek.test.cjs — Denetim > Web-App hesap onbellegi (2026-10-23).
//
// Kullanici: "sorgulama yaparken bir turlu getirmedi sorgular cok uzun suruyor 'Yenile' butonu donup
// duruyor". Her arama TUM hesabi (tam tablo okumalari + satir basina AJP/mod_cluster taramasi) bastan
// kosturuyordu ve senkron dongu Node'u kilitliyordu.
//   WO1 ayni anda gelen istekler TEK hesap bekler (tek ucus)
//   WO2 arama / "sadece eslesmeyenler" onbellekteki sonuc uzerinde: yeni DB okumasi YOK; sayaclar tam kume
//   WO3 fresh=1 ("Yenile") onbellegi atlar, yeni veriyi getirir
//   WO4 hata onbellege YAZILMAZ: sonraki istek yeniden dener
//   WO5 suzulen kume CAP'ten buyukse capped=true, degilse false (eski ">= CAP" yanlis pozitifi yok)
//   WO6 uzun hesap olay dongusune nefes aldirir (DILIM satirda bir setImmediate)
'use strict';

process.env.WEBAPP_ONBELLEK_MS = String(10 * 60 * 1000);
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const MSSQL = path.join(__dirname, '..', '..', 'inventory', 'mssql.cjs');
let veri = {};
let appOkuma = 0;
let appHata = null;
let appGecikme = 0;
const sahte = {
  sql: {},
  query: async (q) => {
    const t = String(q).replace(/\s+/g, ' ');
    if (t.includes('FROM dbo.MWAppsInventory')) {
      appOkuma += 1;
      if (appGecikme) await new Promise((ok) => setTimeout(ok, appGecikme));
      if (appHata) throw new Error(appHata);
      return { recordset: veri.apps || [] };
    }
    if (t.includes('FROM dbo.BMW_Certificates_Inventory')) return { recordset: veri.certs || [] };
    if (t.includes('sys.columns')) return { recordset: [{ name: 'host' }, { name: 'jvm' }, { name: 'ports' }, { name: 'cfg_ports' }] };
    if (t.includes('FROM dbo.Server_Hub_Vhosts')) return { recordset: veri.vhosts || [] };
    return { recordset: [] };
  },
};
require.cache[Module._resolveFilename(MSSQL, module)] = { id: MSSQL, filename: MSSQL, loaded: true, exports: sahte };

const { registerWebApp, _webAppOnbellekTemizle } = require('../web-app.cjs');

async function sunucu() {
  const app = express();
  const r = express.Router();
  registerWebApp(r);
  app.use(r);
  const s = app.listen(0);
  await new Promise((ok) => s.once('listening', ok));
  const taban = `http://127.0.0.1:${s.address().port}/web-app?source=mw`;
  return { getir: (ek = '') => fetch(taban + ek).then(async (x) => ({ status: x.status, j: await x.json() })), kapat: () => s.close() };
}

const uygulamalar = (n) => Array.from({ length: n }, (_, i) => ({ app: `app${String(i).padStart(4, '0')}`, host: `GBCJAP${String(i % 90 + 10)}`, env: 'PROD', domain: 'fw.garanti.com.tr' }));

beforeEach(() => {
  _webAppOnbellekTemizle();
  veri = { apps: uygulamalar(3) };
  appOkuma = 0;
  appHata = null;
  appGecikme = 0;
});

test('WO1 ayni anda gelen istekler TEK hesap bekler; suren hesap varken "Yenile" de onu bekler', async () => {
  appGecikme = 50;
  const s = await sunucu();
  try {
    const [a, b, c] = await Promise.all([s.getir(), s.getir('&q=app0001'), s.getir('&onlyUnmatched=1')]);
    assert.equal(appOkuma, 1, `envanter ${appOkuma} kez okundu`);
    assert.equal(a.j.total, 3);
    assert.equal(b.j.rows.length, 1);
    assert.equal(c.j.total, 3);
    // Kullanici "Yenile"ye art arda basar: her basis ayri bir agir hesap baslatmamali.
    await Promise.all([s.getir('&fresh=1'), s.getir('&fresh=1&q=app0002'), s.getir('&fresh=1&onlyUnmatched=1')]);
    assert.equal(appOkuma, 2, `art arda Yenile ${appOkuma - 1} hesap baslatti`);
  } finally { s.kapat(); }
});

test('WO2 arama ve suzme onbellekten: DB yeniden okunmaz, sayaclar tam kume uzerinden', async () => {
  const s = await sunucu();
  try {
    const ilk = await s.getir();
    assert.equal(ilk.j.shown, 3);
    const ara = await s.getir('&q=APP0002');
    assert.equal(appOkuma, 1, 'arama DB okumasi tetiklememeli');
    assert.deepEqual(ara.j.rows.map((r) => r.app), ['app0002']);
    assert.equal(ara.j.total, 3);
    assert.equal(ara.j.shown, 1);
    assert.equal(ara.j.hesaplandi, ilk.j.hesaplandi);
  } finally { s.kapat(); }
});

test('WO3 fresh=1 onbellegi atlar ve yeni veriyi getirir', async () => {
  const s = await sunucu();
  try {
    await s.getir();
    veri = { apps: uygulamalar(5) };
    const eski = await s.getir();
    assert.equal(eski.j.total, 3, 'TTL icinde onbellek kullanilmali');
    const yeni = await s.getir('&fresh=1');
    assert.equal(appOkuma, 2);
    assert.equal(yeni.j.total, 5);
    const sonra = await s.getir();
    assert.equal(sonra.j.total, 5, 'taze hesap onbellege yazilmali');
  } finally { s.kapat(); }
});

test('WO4 hata onbellege yazilmaz: sonraki istek yeniden dener', async () => {
  const s = await sunucu();
  try {
    appHata = 'baglanti koptu';
    const k = await s.getir();
    assert.equal(k.status, 500);
    assert.match(k.j.message, /baglanti koptu/);
    appHata = null;
    const ok = await s.getir();
    assert.equal(ok.status, 200);
    assert.equal(ok.j.total, 3);
    assert.equal(appOkuma, 2);
  } finally { s.kapat(); }
});

test('WO5 capped yalniz suzulen kume CAP (1000) ustundeyse', async () => {
  veri = { apps: uygulamalar(1000) };
  const s = await sunucu();
  try {
    const tam = await s.getir();
    assert.equal(tam.j.shown, 1000);
    assert.equal(tam.j.capped, false, 'tam 1000 satir varken kirpilmis denmemeli');
    veri = { apps: uygulamalar(1001) };
    const fazla = await s.getir('&fresh=1');
    assert.equal(fazla.j.shown, 1000);
    assert.equal(fazla.j.capped, true);
    assert.equal(fazla.j.rows[0].app, 'app0000', 'kirpma alfabetik siradan sonra');
  } finally { s.kapat(); }
});

test('WO6 uzun hesap olay dongusune nefes aldirir', async () => {
  const asil = global.setImmediate;
  let sayac = 0;
  global.setImmediate = (...a) => { sayac += 1; return asil(...a); };
  const s = await sunucu();
  try {
    veri = { apps: uygulamalar(10) };
    sayac = 0;
    await s.getir('&fresh=1');
    const az = sayac;
    veri = { apps: uygulamalar(1000) };
    sayac = 0;
    await s.getir('&fresh=1');
    assert.ok(sayac - az >= 4, `1000 satirda yalniz ${sayac - az} ek nefes (beklenen >= 4)`);
  } finally { global.setImmediate = asil; s.kapat(); }
});
