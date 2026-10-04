// server/nginx-migration/__tests__/nginx-migration-yetki.test.cjs
//
// YETKI ACIGI (2026-10-04): /api/nginx-migration uclari yalniz requireAuth istiyordu - Nginx
// Hub > SPA > "Production Tasimalari" sayfasini GOREMEYEN herhangi bir oturum PROD silme
// (nginx_ops action=delete) ya da tanim isi baslatabiliyor, takip tablosuna yazabiliyordu.
// Kapi artik ekranin veri ucuyla (/api/denetim/nginx-migration) AYNI uc anahtar: Denetim +
// NginxConsole + tab:nginx:spa. Admin muaf.
//
// Testler GERCEK gorunurluk motorunu (auth/visibility.cjs) ve gercek Express ucunu kosturur;
// "ulasmadi" iddiasi sahte AWX'in istek kaydi ve DB sorgu kaydiyla olculur.
//
//   Y1 kurali olmayan kullanici: TUM uclar 403; AWX'e ve DB'ye (gorunurluk disi) ULASMAZ
//   Y2 Denetim + sayfa acik ama SPA sekmesi kapali: 403 (yalniz sayfa kapisi yetmez)
//   Y3 Denetim + sekme acik ama sayfa kapali: 403 (kaskad)
//   Y3b sekme ogesi kayitli degil (kayitsiz = gorunur): sayfa kapisi yine 403
//   Y4 Denetim + sayfa + sekme acilmis ekip uyesi: silme ve takip yazimi GECER
//   Y5 Admin (hic kural yok): silme, tanim ve takip yazimi GECER
//   Y6 gorunurluk motoru okunamazsa: kullanici 503 (fail-closed), Admin gecer
//   Y7 OKUMA = YAZMA: ayni kural kumesiyle ekranin veri ucu (GERCEK denetim router'i) ile
//      PROD silme ucu AYNI karari verir. Eskiden "Nginx Hub Erisimi" paneli (NginxConsole +
//      tab:nginx:spa) ile GET /api/denetim/nginx-migration 403, POST /delete 200 idi.
//   J1-J5 GET /job-status IDOR: yalniz bu modulun template'lerindeki isler; baska isin stdout'u
//      HIC istenmez (404); template olculemezse 503 (fail-closed)
'use strict';

const h = require('./_harness.cjs');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Y7 icin: ekranin veri ucu GERCEK denetim router'iyla (ayni gorunurluk motoru, ayni stub'lar).
const denetim = { srv: null, port: 0 };
before(async () => {
  await h.start();
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    if (h.sessionUser) req.session = { user: h.sessionUser };
    next();
  });
  require('../../audit/denetim.cjs').initDenetim(app);
  denetim.srv = http.createServer(app);
  await new Promise((r) => denetim.srv.listen(0, '127.0.0.1', r));
  denetim.port = denetim.srv.address().port;
});
after(async () => {
  await new Promise((r) => denetim.srv.close(r));
  await h.stop();
});
beforeEach(h.reset);

const denetimGet = (p) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: denetim.port, path: p }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      })
      .on('error', reject);
  });

const TRACK = { group: 'glomo', namespace: 'digital-banking-ch-prod', application: 'base-app-v0', state: 'planned', plannedDate: '2026-10-10' };
const CREATE = { ...h.BODY, inputPath: '/yeni/' };
// Modulun TUM uclari: yazanlar + okuyanlar (okuma uclari da sayfa kapisinda - gerekce index.cjs).
const UCLAR = [
  ['POST', '/api/nginx-migration/delete', h.BODY],
  ['POST', '/api/nginx-migration/create', CREATE],
  ['PUT', '/api/nginx-migration/tracking', TRACK],
  ['PUT', '/api/nginx-migration/tracking/bulk', { items: [TRACK] }],
  ['POST', '/api/nginx-migration/rescan', { hosts: ['GBNGXP40'] }],
  ['PUT', '/api/nginx-migration/config', { awxServerId: 1, templateId: 10, deleteTemplateId: 20 }],
  ['GET', '/api/nginx-migration/tracking'],
  ['GET', `/api/nginx-migration/job-status/${h.JOB_ID}`],
  ['GET', '/api/nginx-migration/config'],
  ['GET', '/api/nginx-migration/delete-guard'],
];
const kapidanGecti = (st) => st !== 401 && st !== 403 && st !== 503;

async function hepsiReddedilir(t, beklenen) {
  for (const [method, url, body] of UCLAR) {
    const r = await h.call(method, url, body);
    assert.equal(r.status, beklenen, `${method} ${url}: ${r.status} ${r.body}`);
    assert.equal(r.json.ok, false);
  }
  assert.equal(h.awx.istekler.length, 0, `AWX'e istek gitti: ${JSON.stringify(h.awx.istekler.map((x) => x.method + ' ' + x.yol))}`);
  assert.deepEqual(h.appQueries().map((q) => q.sql.slice(0, 60)), [], 'gorunurluk disinda DB sorgusu calisti (uca ulasildi)');
  assert.equal(h.audits.length, 0, 'denetim kaydi yazildi (uca ulasildi)');
}

test('Y1 kurali olmayan kullanici: TUM uclar 403; AWX ve DB ye ULASMAZ', async (t) => {
  h.mockConsole(t);
  h.sessionUser = h.USERS.yabanci;
  await hepsiReddedilir(t, 403);
});

test('Y2 sayfa acik ama SPA sekmesi kapali -> 403 (yalniz sayfa kapisi yetmez)', async (t) => {
  h.mockConsole(t);
  h.sessionUser = h.USERS.yabanci;
  // Denetim ACIK: 403'u YALNIZ sekme kapisi uretmeli (yoksa Denetim kapisi onu maskelerdi).
  h.setRules([h.allow('Denetim', 'user', 'yabanci'), h.allow('NginxConsole', 'user', 'yabanci')]);
  await hepsiReddedilir(t, 403);
});

test('Y3 sekme acik ama sayfa kapali -> 403 (sayfa kapisi + kaskad)', async (t) => {
  h.mockConsole(t);
  h.sessionUser = h.USERS.yabanci;
  h.setRules([h.allow('Denetim', 'user', 'yabanci'), h.allow('tab:nginx:spa', 'user', 'yabanci')]);
  await hepsiReddedilir(t, 403);
});

test('Y3b SPA sekme ogesi DB de KAYITLI DEGILSE (motor: kayitsiz = gorunur) sayfa kapisi yine durdurur', async (t) => {
  h.mockConsole(t);
  h.sessionUser = h.USERS.yabanci;
  h.elements = h.elements.filter((e) => e.element_key !== 'tab:nginx:spa');
  h.setRules([h.allow('Denetim', 'user', 'yabanci')]);
  await hepsiReddedilir(t, 403);
});

test('Y4 sayfa + SPA sekmesi acilmis ekip uyesi (Admin DEGIL): silme ve takip yazimi GECER; config yazimi yine Admin', async (t) => {
  h.mockConsole(t);
  h.sessionUser = h.USERS.ekip;
  let r = await h.sil();
  assert.equal(r.status, 200, r.body);
  assert.equal(h.launches().length, 1);
  r = await h.call('PUT', '/api/nginx-migration/tracking', TRACK);
  assert.equal(r.status, 200, r.body);
  assert.ok(h.appQueries().some((q) => /INSERT INTO nginx_migration_tracking/.test(q.sql)), 'takip yazilmali');
  r = await h.call('PUT', '/api/nginx-migration/config', { awxServerId: 1, templateId: 10, deleteTemplateId: 20 });
  assert.equal(r.status, 403, 'yapilandirma yazimi Admin kapisinda kalmali');
});

test('Y5 Admin (hic kural yok): silme, tanim ve takip yazimi GECER', async (t) => {
  h.mockConsole(t);
  h.sessionUser = h.USERS.admin;
  h.setRules([]);
  let r = await h.sil();
  assert.equal(r.status, 200, r.body);
  r = await h.call('POST', '/api/nginx-migration/create', CREATE);
  assert.equal(r.status, 200, r.body);
  assert.equal(h.launches().length, 2, 'silme + tanim isi baslatilmali');
  r = await h.call('PUT', '/api/nginx-migration/tracking', TRACK);
  assert.equal(r.status, 200, r.body);
  r = await h.call('GET', '/api/nginx-migration/delete-guard');
  assert.equal(r.status, 200, r.body);
});

test('Y6 gorunurluk motoru okunamazsa: kullanici 503 (fail-closed, AWX e gitmez), Admin gecer', async (t) => {
  h.mockConsole(t);
  h.visibilityDown = true;
  h.visibility.bumpVersion();
  h.sessionUser = h.USERS.ekip;
  let r = await h.sil();
  assert.equal(r.status, 503, r.body);
  assert.equal(h.awx.istekler.length, 0);
  h.sessionUser = h.USERS.admin;
  r = await h.sil();
  assert.equal(r.status, 200, r.body);
  assert.equal(h.launches().length, 1);
});

test('Y7 OKUMA = YAZMA: ayni kurallarla ekranin veri ucu ve PROD silme ucu AYNI karari verir', async (t) => {
  h.mockConsole(t);
  const { allow, USERS, NGINX_PANEL_RULES, EKIP_RULES } = h;
  // gecer: ayni kurallarla IKI uc da kapidan gecer mi
  const durumlar = [
    { ad: 'yalniz Nginx Hub Erisimi paneli (Denetim YOK)', user: USERS.ekip, rules: NGINX_PANEL_RULES, gecer: false },
    { ad: 'Denetim + Nginx Hub + SPA sekmesi', user: USERS.ekip, rules: EKIP_RULES, gecer: true },
    { ad: 'yalniz Denetim', user: USERS.ekip, rules: [allow('Denetim', 'user', 'odemir')], gecer: false },
    {
      ad: 'Denetim + Nginx Hub, SPA sekmesi YOK',
      user: USERS.ekip,
      rules: [allow('Denetim', 'user', 'odemir'), allow('NginxConsole', 'user', 'odemir')],
      gecer: false,
    },
    { ad: 'Admin, hic kural yok', user: USERS.admin, rules: [], gecer: true },
  ];
  for (const { ad, user, rules, gecer } of durumlar) {
    h.reset();
    h.sessionUser = user;
    h.setRules(rules);
    const oku = await denetimGet('/api/denetim/nginx-migration');
    const yaz = await h.sil();
    assert.equal(kapidanGecti(oku.status), gecer, `${ad}: ekran verisi ${oku.status} ${oku.body.slice(0, 120)}`);
    assert.equal(kapidanGecti(yaz.status), gecer, `${ad}: PROD silme ${yaz.status} ${yaz.body.slice(0, 120)}`);
    assert.equal(h.launches().length, gecer ? 1 : 0, `${ad}: AWX launch`);
  }
});

// ── J1-J5: job-status sahiplik (IDOR) ────────────────────────────────────────
const SIR = 'BASKA-EKIBIN-SIRRI';

test('J1 sayfayi goren ekip uyesi BASKA bir isin (7777) ciktisini OKUYAMAZ: 404, stdout HIC istenmez', async (t) => {
  h.mockConsole(t);
  const r = await h.call('GET', '/api/nginx-migration/job-status/7777');
  assert.equal(r.status, 404, r.body);
  assert.equal(r.json.ok, false);
  assert.ok(!r.body.includes(SIR), 'baska isin stdout u sizdi');
  assert.deepEqual(h.outputReads(7777).map((x) => x.yol), [], "yabanci isin stdout'u AWX'ten istendi");
  assert.equal(h.appQueries().filter((q) => /UPDATE nginx_migration/.test(q.sql)).length, 0, 'yabanci is takip tablosuna yazildi');
});

test('J2 kendi isleri (silme ve tanim template i) izlenir: 200 + cikti', async (t) => {
  h.mockConsole(t);
  for (const tpl of [h.DELETE_TPL, h.CREATE_TPL]) {
    h.awx.jobTemplate = tpl;
    const r = await h.call('GET', `/api/nginx-migration/job-status/${h.JOB_ID}`);
    assert.equal(r.status, 200, `tpl ${tpl}: ${r.body}`);
    assert.equal(r.json.ok, true);
    assert.ok(r.json.output.includes('TASK [nginx_ops] ok'), r.body);
  }
});

test('J3 isin template i OLCULEMEZSE (job_template alani yok) 503: cikti verilmez ("baskasinin" de denmez)', async (t) => {
  const log = h.mockConsole(t);
  h.awx.jobTemplate = null;
  const r = await h.call('GET', `/api/nginx-migration/job-status/${h.JOB_ID}`);
  assert.equal(r.status, 503, r.body);
  assert.deepEqual(h.outputReads(h.JOB_ID).map((x) => x.yol), []);
  assert.ok(log.warn.some((l) => /OLCULEMEDI/.test(l)));
});

test('J4 Admin icin de modul kapsami: yabanci is 404 (genel cikti ucu /api/ansible/job/:id/output ayri)', async (t) => {
  h.mockConsole(t);
  h.sessionUser = h.USERS.admin;
  h.setRules([]);
  const r = await h.call('GET', '/api/nginx-migration/job-status/7777');
  assert.equal(r.status, 404, r.body);
  assert.deepEqual(h.outputReads(7777), []);
});

test('J5 saf: jobTemplateAllowed', () => {
  const f = h.nm.jobTemplateAllowed;
  const cfg = { templateId: 10, deleteTemplateId: 20 };
  assert.equal(f({ templateId: 20 }, cfg), true);
  assert.equal(f({ templateId: 10 }, cfg), true);
  assert.equal(f({ templateId: 999 }, cfg), false);
  assert.equal(f({ templateId: undefined }, cfg), null, 'alan yok: OLCULEMEDI');
  assert.equal(f({}, cfg), null);
  assert.equal(f(null, cfg), null);
  assert.equal(f({ templateId: 0 }, { templateId: 0, deleteTemplateId: 0 }), null);
  assert.equal(f({ templateId: 5 }, { templateId: 0, deleteTemplateId: 0 }), false, 'yapilandirilmamis template hicbir isi kapsamaz');
});
