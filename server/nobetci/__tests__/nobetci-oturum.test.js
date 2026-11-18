// server/nobetci/__tests__/nobetci-oturum.test.js — nobet uclari oturum ister (2026-11-14).
// Uclar "kimliklenmemis kullaniciya da acik" diye kapisizdi; /list yuzlerce kisinin adini,
// e-postasini ve telefonunu oturumsuz donduruyordu. Gercek express uygulamasi + gercek HTTP.
//   NO1 oturumsuz: today / today/avatar / list -> 401, govdede kisi verisi yok
//   NO2 oturumlu (Admin olmayan da): isleyici calisir (401 degil)
//   NO3 avatar ortak onbellege girmez (private)
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

// Dis servis yok: liste ucu kaynak bulamaz ve kendi hata koduyla doner; onemli olan kapidan
// GECIP GECMEDIGI.
delete process.env.NOBETCI_API_URL;
const { initNobetci } = require('../index.cjs');

const UCLAR = ['/api/nobetci/today', '/api/nobetci/today/avatar', '/api/nobetci/list'];
let sunucu;
let taban;

before(async () => {
  const app = express();
  // Sahte oturum katmani: `x-test-rol` basligi varsa oturum var sayilir (yalniz bu testte).
  app.use((req, _res, next) => {
    const rol = req.headers['x-test-rol'];
    req.session = rol ? { user: { username: 'deneme', role: String(rol) } } : {};
    next();
  });
  initNobetci(app);
  sunucu = http.createServer(app);
  await new Promise((coz) => sunucu.listen(0, '127.0.0.1', coz));
  taban = `http://127.0.0.1:${sunucu.address().port}`;
});
after(() => new Promise((coz) => sunucu.close(coz)));

test('NO1 oturumsuz cagri 401 alir ve kisi verisi tasimaz', async () => {
  for (const uc of UCLAR) {
    const r = await fetch(taban + uc);
    assert.equal(r.status, 401, uc);
    const govde = await r.text();
    assert.doesNotMatch(govde, /email|phone|intercom|asNobetci|records/i, uc);
  }
});

test('NO2 oturumu olan her kullanici kapidan gecer', async () => {
  for (const rol of ['User', 'Admin']) {
    for (const uc of UCLAR) {
      const r = await fetch(taban + uc, { headers: { 'x-test-rol': rol } });
      assert.notEqual(r.status, 401, `${uc} (${rol})`);
      assert.notEqual(r.status, 403, `${uc} (${rol})`);
      await r.arrayBuffer();
    }
  }
});

test('NO3 avatar ortak onbellege girmez', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const i = kaynak.indexOf('"/api/nobetci/today/avatar"');
  const govde = kaynak.slice(i, kaynak.indexOf('app.get("/api/nobetci/list"', i));
  assert.match(govde, /"Cache-Control", "private, max-age=300"/);
  assert.doesNotMatch(govde, /"Cache-Control", "public/);
});
