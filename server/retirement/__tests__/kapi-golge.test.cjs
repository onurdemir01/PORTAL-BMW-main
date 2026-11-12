// server/retirement/__tests__/kapi-golge.test.cjs - KG1..KG3 (2026-11-11, Faz 3 golge kapi).
//
// docs/RETIREMENT-MOTOR-BIRLESTIRME.md: Retirement kaydi acilirken her hedefin Retirement Analizi karari
// kayda (olay 'kapi_golge') ve denetime yazilir; GOLGE kipte HICBIR SEY ENGELLENMEZ.
//   KG1 KULLANIMDA hedef: kayit ACILIR, olay "Zorunlu kipte bu kayit ACILMAZDI ... KULLANIMDA" der
//   KG2 hedef secilmeden (butun ortamlar) acilan kayit da "acilmazdi" diye isaretlenir; hepsi aday ve
//       hedef secili ise "zorunlu kipte de acilirdi"
//   KG3 Analiz hata verirse kayit YINE acilir; olay "Analiz okunamadi" der (golge kip kaydi durdurmaz)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const durum = { sorgular: [], kesif: null, analiz: null, denetim: [] };
sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    durum.sorgular.push({ sql: s, params });
    if (/^INSERT INTO retirement_records/.test(s)) return { rows: [{ id: 77 }], rowCount: 1 };
    if (/^SELECT \* FROM retirement_records WHERE id = \$1/.test(s)) return { rows: [{ id: 77, app: 'A', status: 'open' }] };
    return { rows: [], rowCount: 1 };
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => next() });
sahte('../../auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next() });
sahte('../poller.cjs', { startPoller() {}, kayitCanli: async () => ({}), zamanlayici: () => ({}), awxDurumu: () => null, webSimdi: async () => ({ kosan: 0 }), pollSaniye: () => 300 });
sahte('../../audit/index.cjs', { auditPortal: (_r, _a, o) => durum.denetim.push(JSON.parse(o.detail)) });
sahte('../discover.cjs', { discover: async () => durum.kesif, searchApps: async () => [] });
sahte('../../ansible/runner.cjs', { redactSecrets: (s) => s, getServerById: () => null });
sahte('../../server-hub/index.cjs', {
  retirementAnalizi: async (targets) => {
    if (durum.analiz instanceof Error) throw durum.analiz;
    return { okunamadi: false, hedefler: targets.map((t) => ({ host: t.host, appName: t.appName, gen: t.gen, karar: durum.analiz[t.host] || 'RETIRE_ADAYI' })) };
  },
});

const { initRetirement } = require('../index.cjs');
let router = null;
initRetirement({ use: (yol, r) => { if (yol === '/api/retirement') router = r; } });
const isleyici = () => {
  const l = router.stack.find((x) => x.route && x.route.path === '/' && x.route.methods.post);
  return l.route.stack[l.route.stack.length - 1].handle;
};
async function ac(body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  durum.sorgular = [];
  durum.denetim = [];
  await isleyici()({ session: { user: { username: 'onur', role: 'Admin' } }, query: {}, params: {}, body }, res);
  const olay = durum.sorgular.find((x) => /^INSERT INTO retirement_events/.test(x.sql) && x.params[2] === 'kapi_golge');
  return { res, olay: olay && olay.params[3] };
}
const h = (host) => ({ host, site: 'Pendik', env: 'TEST', appName: 'A-T', gen: 8, appPath: '/vhosting8/A.ear', web: [] });

test('KG1 KULLANIMDA hedef: kayit acilir, zorunlu kipte acilmazdi', async () => {
  durum.kesif = { targets: [h('H1'), h('H2')], summary: { bySite: { Pendik: 2, Ankara: 0 } } };
  durum.analiz = { H1: 'KULLANIMDA' };
  const { res, olay } = await ac({ app: 'A', smartNo: '123', targets: [{ host: 'H1', appName: 'A-T', gen: 8 }, { host: 'H2', appName: 'A-T', gen: 8 }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.id, 77, 'golge kip kaydi durdurdu');
  assert.match(olay, /gölge kapı, engellemez/);
  assert.match(olay, /1 KULLANIMDA, 1 RETIRE_ADAYI/);
  assert.match(olay, /Zorunlu kipte bu kayıt AÇILMAZDI: KULLANIMDA: A-T @ H1/);
  assert.equal(res.body.kapiGolge.engellenirdi, true);
  assert.equal(durum.denetim.at(-1).kapiGolge.kullanimda, 1);
});

test('KG2 hedef secilmeden acilan kayit isaretlenir; hepsi aday + secili -> acilirdi', async () => {
  durum.kesif = { targets: [h('H1')], summary: { bySite: { Pendik: 1, Ankara: 0 } } };
  durum.analiz = {};
  let r = await ac({ app: 'A', smartNo: '123' });
  assert.equal(r.res.statusCode, 200);
  assert.match(r.olay, /hedef seçilmeden \(bütün ortamlar\)/);
  r = await ac({ app: 'A', smartNo: '123', targets: [{ host: 'H1', appName: 'A-T', gen: 8 }] });
  assert.match(r.olay, /Zorunlu kipte de açılırdı/);
  assert.equal(r.res.body.kapiGolge.engellenirdi, false);
});

test('KG3 Analiz hatasi kaydi durdurmaz', async () => {
  durum.kesif = { targets: [h('H1')], summary: { bySite: { Pendik: 1, Ankara: 0 } } };
  durum.analiz = new Error('grafik kurulamadi');
  const { res, olay } = await ac({ app: 'A', smartNo: '123', targets: [{ host: 'H1', appName: 'A-T', gen: 8 }] });
  assert.equal(res.statusCode, 200);
  assert.match(olay, /Analiz okunamadı \(grafik kurulamadi\)/);
  assert.equal(res.body.kapiGolge.okunamadi, true);
});
