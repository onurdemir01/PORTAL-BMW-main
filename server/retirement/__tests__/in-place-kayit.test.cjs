// server/retirement/__tests__/in-place-kayit.test.cjs - IK1..IK4 (2026-10-26).
//
// Kullanici: "Ozellikle in place uygulamalari ozel uyariyla belirtmeni istiyorum. Eger JBoss ya da uygulamasi
// icin ayni sunucuda JBoss 8 de kesfedilirse giris yapan kisiyi uyaralim, dikkatli ol ... Hicbir sey
// engellemesin ama insanlar yine de bilincinde olsun."
// Kesif in-place'i isaretliyordu (discover.inPlaceIsaretle: inPlace + digerSurumler) ama kayit acilinca bilgi
// KAYBOLUYORDU. Simdi retirement_targets.diger_surumler'e yazilir ve hedef satiri inPlace / digerSurumler doner:
//   [] -> inPlace false, [8] -> true, NULL (alandan once acilmis kayit) -> null = BILINMIYOR ("yok" degil).
// Ayni testte hedef satirinin awxIsleri alani (loadRecord): gecmis TEK sorguda, okunamazsa kayit yine doner.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const durum = { sorgular: [], kayit: null, hedefler: [], gecmisHata: false, gecmis: [], kesif: null };
sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    durum.sorgular.push({ sql: s, params });
    if (/^SELECT \* FROM retirement_records WHERE id = \$1/.test(s)) return { rows: durum.kayit ? [durum.kayit] : [] };
    if (/^SELECT \* FROM retirement_targets WHERE record_id = \$1/.test(s)) return { rows: durum.hedefler };
    if (/FROM retirement_events/.test(s)) return { rows: [] };
    if (/FROM ansible_job_history/.test(s)) {
      if (durum.gecmisHata) throw new Error('gecmis okunamadi');
      return { rows: durum.gecmis.filter((g) => params.map(Number).includes(g.job_id)) };
    }
    if (/^INSERT INTO retirement_records/.test(s)) return { rows: [{ id: 41 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => next() });
sahte('../../auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next() });
sahte('../poller.cjs', { startPoller() {}, kayitCanli: async () => ({}), zamanlayici: () => ({}), awxDurumu: () => null, webSimdi: async () => ({ kosan: 0 }), pollSaniye: () => 300 });
sahte('../../audit/index.cjs', { auditPortal: () => {} });
sahte('../discover.cjs', { discover: async () => durum.kesif, searchApps: async () => [] });
sahte('../../ansible/runner.cjs', { redactSecrets: (s) => s, getServerById: (id) => (id === 1 ? { id: 1 } : null) });

const { initRetirement } = require('../index.cjs');
let router = null;
initRetirement({ use: (yol, r) => { if (yol === '/api/retirement') router = r; } });
const isleyici = (yontem, yol) => {
  const l = router.stack.find((x) => x.route && x.route.path === yol && x.route.methods[yontem]);
  assert.ok(l, `${yontem} ${yol} yok`);
  return l.route.stack[l.route.stack.length - 1].handle;
};
async function cagir(yontem, yol, req) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await isleyici(yontem, yol)({ session: { user: { username: 'onur', role: 'Admin' } }, query: {}, body: {}, params: {}, ...req }, res);
  return res;
}

const SETUP = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');

test('IK1 diger_surumler CREATE + ALTER ile tanimli ve NULL (eski kayit = bilinmiyor)', () => {
  const bas = SETUP.indexOf('CREATE TABLE retirement_targets (');
  const t = SETUP.slice(bas, SETUP.indexOf(')`', bas));
  assert.match(t, /diger_surumler\s+NVARCHAR\(100\) NULL/, 'CREATE TABLE retirement_targets diger_surumler tasimiyor');
  assert.ok(SETUP.includes('ALTER TABLE retirement_targets ADD diger_surumler NVARCHAR(100) NULL'), 'mevcut kurulumlara ALTER yok');
  assert.match(SETUP, /table: 'retirement_targets',\s*col: 'diger_surumler',/);
});

test('IK2 kayit acilirken kesfin in-place isareti hedefe yazilir ([8] / [7] / []); olay kaydi in-place hedefleri sayar', async () => {
  const h = (o) => ({ site: 'Pendik', env: 'TEST', appName: 'GBPOSWEBAPI-T', appPath: '/vhosting/GBPOSWEBAPI.ear', web: [], ...o });
  durum.kesif = {
    targets: [
      h({ host: 'GBJEXP05', gen: 7, inPlace: true, digerSurumler: [8] }),
      h({ host: 'GBJEXP05', gen: 8, appPath: '/vhosting8/GBPOSWEBAPI.ear', inPlace: true, digerSurumler: [7] }),
      h({ host: 'GBJEXP06', gen: 8 }),
      h({ host: 'GBJEXP07', gen: null, inPlace: true, digerSurumler: [0, 8] }),
    ],
    summary: { bySite: { Pendik: 4, Ankara: 0 } },
  };
  durum.sorgular = [];
  const r = await cagir('post', '/', { body: { app: 'GBPOSWEBAPI', smartNo: '123456' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ins = durum.sorgular.filter((x) => /^INSERT INTO retirement_targets/.test(x.sql));
  assert.equal(ins.length, 4);
  assert.match(ins[0].sql, /\(record_id, host, site, env, app_name, jboss_gen, app_path, web_json, diger_surumler\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9\)/);
  assert.deepEqual(ins.map((x) => x.params[8]), ['[8]', '[7]', '[]', '[0,8]'], 'in-place isareti kayda yazilmadi');
  const olay = durum.sorgular.find((x) => /^INSERT INTO retirement_events/.test(x.sql) && x.params[2] === 'created');
  assert.match(olay.params[3], /IN-PLACE: GBPOSWEBAPI-T @ GBJEXP05 \(JBoss 7; aynı sunucuda diğer kurulum: JBoss 8\)/);
  assert.ok(!/GBJEXP06/.test(olay.params[3].split('IN-PLACE')[1]), 'tek kurulumlu hedef in-place sayildi');
});

test('IK5 cok sayida in-place hedefte olay metni yarida kalmaz: ilk 5 hedef + "+N hedef daha" (1000 karakter siniri)', async () => {
  const h = (i) => ({ host: `GBJEXP${String(i).padStart(2, '0')}`, site: 'Pendik', env: 'TEST', appName: 'GBCORPORATEBANKINGSERVICE-T', gen: 7, appPath: '/vhosting/X.ear', web: [], inPlace: true, digerSurumler: [8] });
  durum.kesif = { targets: Array.from({ length: 8 }, (_, i) => h(i + 1)), summary: { bySite: { Pendik: 8, Ankara: 0 } } };
  durum.sorgular = [];
  const r = await cagir('post', '/', { body: { app: 'GBCORPORATEBANKINGSERVICE', smartNo: '123456', ocoNo: '' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const olay = durum.sorgular.find((x) => /^INSERT INTO retirement_events/.test(x.sql) && x.params[2] === 'created').params[3];
  assert.ok(olay.length <= 1000, `olay ${olay.length} karakter`);
  assert.match(olay, /GBJEXP05 \(JBoss 7; aynı sunucuda diğer kurulum: JBoss 8\) \+3 hedef daha/, 'kalan in-place hedef sayisi yazilmadi (metin kesildi)');
  assert.ok(!/GBJEXP06/.test(olay));
});

test('IK3 hedef satiri inPlace / digerSurumler: [] false, [8] true, NULL ve bozuk = null (BILINMIYOR); awxIsleri tek gecmis sorgusuyla', async () => {
  durum.kayit = { id: 5, app: 'A', status: 'open', planned_delete_at: null, stop_at: null, delete_after_days: 45 };
  const t = (id, diger, o = {}) => ({ id, record_id: 5, host: `H${id}`, app_name: 'A', status: 'pending', jboss_gen: 8, web_json: '[]', diger_surumler: diger, ...o });
  durum.hedefler = [
    t(1, null), t(2, '[]'), t(3, '[8]'), t(4, 'bozuk'), t(5, '[0]'),
    t(6, '[]', { status: 'stopped', last_job_id: 500 }), t(7, '[]', { status: 'planning', last_job_id: 501 }),
  ];
  durum.gecmis = [{ job_id: 500, awx_server_id: 1, template_id: 7, template_name: 'Retirement: STOP A @ H6', username: 'onur', started_at: null, params: JSON.stringify({ target_host: 'H6', application: 'A', jboss_gen: '8', plan_only: false }) }];
  durum.gecmisHata = false;
  durum.sorgular = [];
  const r = await cagir('get', '/:id', { params: { id: '5' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ts = r.body.record.targets;
  assert.deepEqual(ts.slice(0, 5).map((x) => [x.inPlace, x.digerSurumler]), [[null, null], [false, []], [true, [8]], [null, null], [true, [0]]]);
  assert.equal(durum.sorgular.filter((x) => /FROM ansible_job_history/.test(x.sql)).length, 1, 'gecmis hedef basina sorgulaniyor (N+1)');
  assert.deepEqual(ts[5].awxIsleri.map((x) => [x.adim, x.jobId, x.durum, x.sunucuKapali]), [['stop', 500, 'basarili', false]]);
  assert.deepEqual(ts[6].awxIsleri.map((x) => [x.adim, x.jobId, x.durum]), [['onkontrol', 501, 'suruyor']]);
  assert.deepEqual(ts[0].awxIsleri, [], 'isi olmayan hedefte awxIsleri bos dizi degil');
});

test('IK4 is gecmisi okunamazsa kayit YINE doner; kanitlanamayan is listeye konmaz (awxIsleriEksik)', async () => {
  durum.gecmisHata = true;
  const r = await cagir('get', '/:id', { params: { id: '5' } });
  assert.equal(r.statusCode, 200, 'gecmis okunamayinca kayit ekrani dustu');
  const ts = r.body.record.targets;
  assert.equal(ts[5].awxIsleriEksik, true);
  assert.deepEqual(ts[5].awxIsleri, []);
  assert.deepEqual(ts[6].awxIsleri.map((x) => x.adim), ['onkontrol'], "'planning' degismezi gecmissiz de kanit");
  durum.gecmisHata = false;
});
