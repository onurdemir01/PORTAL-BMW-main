// server/spa-report/__tests__/gecis.test.cjs — Glomo Gecis Plani (2026-10-13).
//
// Kullanici: Excel'deki takvim (Calisma 1-7) Portal'a; eksikler Calisma 7'ye; herkes "kullanimda mi"
// + "katilacak kisi" girer, set tarihi / OCO / gecti / gecis tarihi yalniz Admin; tabloyu
// dolduranin adi TUTULMAZ.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const DB_YOL = path.join(__dirname, '..', '..', 'db', 'index.cjs');
const sets = new Map();
const apps = new Map();
const sorgular = [];
const sahteDb = {
  query: async (sql, p = []) => {
    const t = String(sql).replace(/\s+/g, ' ').trim();
    sorgular.push({ t, p });
    if (t.startsWith('IF NOT EXISTS (SELECT 1 FROM spa_gecis_set')) { if (!sets.has(p[0])) sets.set(p[0], { no: p[0], calisma_at: null, oco_no: null }); return { rows: [], rowCount: 1 }; }
    if (t === 'SELECT app_key FROM spa_gecis_app') return { rows: [...apps.keys()].map((k) => ({ app_key: k })) };
    if (t.startsWith('INSERT INTO spa_gecis_app')) {
      apps.set(p[0], { namespace: p[1], application: p[2], set_no: p[3], kaynak: t.includes("'portal'") ? 'portal' : 'excel', kullanimda: null, katilimci: null, gecti: false, gecis_tarihi: null });
      return { rows: [], rowCount: 1 };
    }
    if (t.startsWith('SELECT no, calisma_at')) return { rows: [...sets.values()] };
    if (t.startsWith('SELECT namespace, application, set_no')) return { rows: [...apps.values()] };
    if (t.startsWith('UPDATE spa_gecis_app SET kullanimda')) { const a = apps.get(p[0]); if (!a) return { rowCount: 0 }; a.kullanimda = p[1]; a.katilimci = p[2]; return { rowCount: 1 }; }
    if (t.startsWith('UPDATE spa_gecis_set')) { const s = sets.get(p[0]); s.calisma_at = p[1]; s.oco_no = p[2]; return { rowCount: 1 }; }
    if (t.startsWith('UPDATE spa_gecis_app SET gecti = 1')) { let n = 0; for (const a of apps.values()) if (a.set_no === p[0] && !a.gecti) { a.gecti = true; a.gecis_tarihi = a.gecis_tarihi || p[1]; n++; } return { rowCount: n }; }
    if (t.startsWith('UPDATE spa_gecis_app SET')) {
      const a = apps.get(p[0]); if (!a) return { rowCount: 0 };
      const atamalar = t.slice('UPDATE spa_gecis_app SET '.length, t.indexOf(', updated_at')).split(', ');
      for (const at of atamalar) { const [kol, ph] = at.split(' = '); a[kol] = p[Number(ph.slice(1)) - 1]; }
      return { rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
};
require.cache[Module._resolveFilename(DB_YOL, module)] = { id: DB_YOL, filename: DB_YOL, loaded: true, exports: sahteDb };

const gecis = require('../gecis.cjs');
const SEED = require('../glomo-gecis-seed.json');

// Canli rapor: Excel'deki ilk uygulama + Excel'de OLMAYAN bir Glomo uygulamasi + baska servis.
const ilk = SEED[0];
const rapor = {
  ok: true,
  scanDate: '2026-10-12',
  rows: [
    { service: 'GLOMO', namespace: ilk.namespace, application: ilk.application, location: '/x/', team: ['GT-Ekip'], traffic: { state: 'active', req7: 10 } },
    { service: 'GLOMO', namespace: 'yeni-ns-prod', application: 'yeni-app-v0', location: '/yeni/', team: ['GT-Yeni'], traffic: null },
    { service: 'WEBFORMS', namespace: 'w-ns', application: 'w-app', location: '/w/', team: [], traffic: null },
  ],
};

let rol = 'User';
async function sunucu() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: { username: 'ali', role: rol } }; next(); });
  const router = express.Router();
  gecis.mountGecis(router, {
    loadReport: async () => rapor,
    // Namespace sahibi tablosu: e-posta buradan gelir.
    sahipYukle: async () => ({ ready: true, byNs: new Map([[ilk.namespace.toLowerCase(), { group: 'GT-Ekip', email: 'gt-ekip@banka.com', status: 'OK' }]]) }),
  });
  app.use('/api/spa-report', router);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { s, base: `http://127.0.0.1:${s.address().port}/api/spa-report` };
}
const istek = (base, yol, method = 'GET', body) =>
  fetch(base + yol, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, j: await r.json() }));

test('GG1 Excel 210 uygulama Set 1-7; Excel\'de olmayan canli Glomo uygulamasi Set 7\'ye eklenir, baska servis eklenmez', async () => {
  const { s, base } = await sunucu();
  try {
    const { j } = await istek(base, '/gecis');
    assert.equal(j.ok, true);
    assert.equal(j.sets.length, 7);
    assert.equal(j.apps.filter((a) => a.kaynak === 'excel').length, 210);
    const yeni = j.apps.find((a) => a.application === 'yeni-app-v0');
    assert.equal(yeni?.setNo, 7);
    assert.equal(yeni?.kaynak, 'portal');
    assert.ok(!j.apps.some((a) => a.application === 'w-app'), 'Glomo disi servis plana girdi');
    const x = j.apps.find((a) => a.application === ilk.application);
    assert.deepEqual(x.ekip, ['GT-Ekip']);
    assert.equal(x.yuk.state, 'active');
    assert.equal(x.taramadaYok, false);
    assert.equal(j.apps.find((a) => a.application === SEED[1].application).taramadaYok, true);
    assert.equal(j.admin, false);
  } finally { s.close(); }
});

test('GG2 herkes kullanimda + katilimci girer; kim yazdi TUTULMAZ; "hayir" katilimciyi bosaltir', async () => {
  rol = 'User';
  const { s, base } = await sunucu();
  try {
    let r = await istek(base, '/gecis/app', 'PUT', { namespace: ilk.namespace, application: ilk.application, kullanimda: 'yes', katilimci: 'Ayse Yilmaz' });
    assert.equal(r.j.ok, true);
    const yaz = sorgular.filter((q) => q.t.startsWith('UPDATE spa_gecis_app SET kullanimda')).pop();
    assert.ok(!yaz.p.includes('ali'), 'yazan kullanici kaydediliyor');
    assert.ok(!/_by\b/.test(yaz.t), 'yazan kullanici kolonu var');
    r = await istek(base, '/gecis', 'GET');
    assert.equal(r.j.apps.find((a) => a.application === ilk.application).katilimci, 'Ayse Yilmaz');
    assert.ok(!JSON.stringify(r.j).includes('"ali"'), 'yanitta dolduranin adi var');
    await istek(base, '/gecis/app', 'PUT', { namespace: ilk.namespace, application: ilk.application, kullanimda: 'no', katilimci: 'X' });
    r = await istek(base, '/gecis', 'GET');
    const a = r.j.apps.find((x) => x.application === ilk.application);
    assert.equal(a.kullanimda, 'no');
    assert.equal(a.katilimci, '');
  } finally { s.close(); }
});

test('GG3 set / gecti / gecis tarihi yalniz Admin', async () => {
  rol = 'User';
  let { s, base } = await sunucu();
  try {
    assert.equal((await istek(base, '/gecis/set', 'PUT', { no: 6, calismaAt: '2026-10-15T23:00', ocoNo: 'OCO-1' })).status, 403);
    assert.equal((await istek(base, '/gecis/app-admin', 'PUT', { namespace: ilk.namespace, application: ilk.application, gecti: true })).status, 403);
    assert.equal((await istek(base, '/gecis/set/1/gecti', 'POST', { tarih: '2026-10-01' })).status, 403);
  } finally { s.close(); }
  rol = 'Admin';
  ({ s, base } = await sunucu());
  try {
    assert.equal((await istek(base, '/gecis/set', 'PUT', { no: 6, calismaAt: '2026-10-15T23:00', ocoNo: 'OCO-1' })).j.ok, true);
    assert.equal((await istek(base, '/gecis/set', 'PUT', { no: 6, calismaAt: '15.10.2026', ocoNo: '' })).status, 400);
    assert.equal((await istek(base, '/gecis/app-admin', 'PUT', { namespace: ilk.namespace, application: ilk.application, gecti: true, gecisTarihi: '2026-09-30' })).j.ok, true);
    const t = await istek(base, '/gecis/set/1/gecti', 'POST', { tarih: '2026-10-01' });
    assert.equal(t.j.guncellenen, SEED.filter((x) => x.set === 1).length - 1);
    const { j } = await istek(base, '/gecis');
    assert.equal(j.admin, true);
    assert.deepEqual(j.sets.find((x) => x.no === 6), { no: 6, calismaAt: '2026-10-15T23:00', ocoNo: 'OCO-1' });
    assert.equal(j.apps.find((a) => a.application === ilk.application).gecisTarihi, '2026-09-30', 'toplu islem elle girilen tarihi ezdi');
    assert.ok(j.apps.filter((a) => a.setNo === 1).every((a) => a.gecti));
  } finally { s.close(); }
});

test('GG4 ekip e-postasi namespace sahibi tablosundan gelir; canli raporda olmayan uygulamada da', async () => {
  rol = 'User';
  const { s, base } = await sunucu();
  try {
    const { j } = await istek(base, '/gecis');
    assert.equal(j.epostaVar, true);
    const x = j.apps.find((a) => a.application === ilk.application);
    assert.deepEqual(x.ekipEposta, ['gt-ekip@banka.com']);
    assert.deepEqual(x.ekip, ['GT-Ekip']);
    const yok = j.apps.find((a) => a.namespace === ilk.namespace && a.application !== ilk.application && a.taramadaYok);
    if (yok) assert.deepEqual(yok.ekipEposta, ['gt-ekip@banka.com'], 'canli raporda olmayan uygulama e-postayi alamadi');
  } finally { s.close(); }
});
