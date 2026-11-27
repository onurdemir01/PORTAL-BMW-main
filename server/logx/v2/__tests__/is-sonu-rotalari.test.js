// server/logx/v2/__tests__/is-sonu-rotalari.test.js — LogX v2 is durumu / cikti / iptal ve geri sarma
// uclari (2026-11-27, kapsam PR-2; index.cjs dal dusuk).
//
// Is bittiginde istegi ilerleten `finalizeIfNeeded` (kesif sonucu yazma, indirme token'i uretme)
// hicbir testte kosmuyordu; token uretiminin kismi basarisizligi, cift poll'da ikinci token ve
// arsivsiz transfer gibi kurallar yalnizca yorumdaydi. Bu bekci GERCEK router'i, gercek requireAuth
// ile kosturur; is / istek / indirme / denetim modullerinin disari acilan islevleri sahtedir.
//   IS1  is yok / baska kullanicinin isi (red) / Admin gecer
//   IS2  terminal olmayan ya da zaten terminal olan is finalize edilmez
//   IS3  kesif isleri: legacy (denetim kaydi), OCP namespace ve uygulama
//   IS4  tekil arsiv: token (varsayilan dosya adi, yedek dizin), istek ready, denetim
//   IS5  cok arsivli OCP: yolsuz satir atlanir, onceden token'li arsiv yeniden token'lanmaz,
//        bir arsivin hatasi digerlerini dusurmez
//   IS6  arsivsiz transfer istegi failed yapar; token listesi / denetim hatasi yanit degistirmez
//   IS7  yanit: gecen sure, teknik ayrinti yalniz Admin
//   IS8  cikti ve iptal uclari
//   IS9  geri sarma: gecersiz hedef 400, hedefe gore alanlar temizlenir, sahiplik
//   IS10 Legacy kesif ucu: elle uygulama kisit kapisindan gecer, elle giris yalniz acik bayrakla,
//        elle uygulama / sunucu denetime yazilir
//   IS11 cluster katalogu yonetim uclari: yalniz Admin, kayit yoksa 404
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { reddedildi } = require('./fixtures/nginx-red.cjs');

const db = require('../../../db/index.cjs');
const jobsMod = require('../jobs.cjs');
const requests = require('../requests.cjs');
const downloads = require('../downloads.cjs');
const legacy = require('../legacy.cjs');
const ocp = require('../ocp.cjs');
const audit = require('../../audit.cjs');
const restrictions = require('../restrictions.cjs');
const adminData = require('../admin.cjs');

const asil = {
  query: db.query,
  getJobById: jobsMod.getJobById,
  pollJob: jobsMod.pollJob,
  getJobOutput: jobsMod.getJobOutput,
  cancelJob: jobsMod.cancelJob,
  getRequestRow: requests.getRequestRow,
  updateRequest: requests.updateRequest,
  listTokenizedPaths: downloads.listTokenizedPaths,
  issueDownloadToken: downloads.issueDownloadToken,
  finalizeDiscovery: legacy.finalizeDiscovery,
  finalizeNamespaceDiscovery: ocp.finalizeNamespaceDiscovery,
  finalizeAppDiscovery: ocp.finalizeAppDiscovery,
  log: audit.log,
  assertAllowed: restrictions.assertAllowed,
  discover: legacy.discover,
  listClusterIndex: adminData.listClusterIndex,
  createClusterIndexRow: adminData.createClusterIndexRow,
  updateClusterIndexRow: adminData.updateClusterIndexRow,
  deleteClusterIndexRow: adminData.deleteClusterIndexRow,
};

// ── sahte durum ──────────────────────────────────────────────────────────────
let isler; // id -> is
let sonraki; // id -> pollJob sonucu
let satir; // istek satiri
let cagri; // kaydedilen cagrilar
let tokenli; // listTokenizedPaths sonucu (Set ya da Error)
let tokenHatasi; // staged_path -> hata
let denetimHatasi;

beforeEach(() => {
  isler = {};
  sonraki = {};
  satir = { request_id: 'r1', username: 'ali', session_token: 'oturum-1', state: 'transferring' };
  cagri = {
    update: [],
    token: [],
    legacy: [],
    ns: [],
    app: [],
    audit: [],
    cancel: [],
    output: [],
    kapi: [],
    kesif: [],
    katalog: [],
  };
  tokenli = new Set();
  tokenHatasi = {};
  denetimHatasi = false;
});

const is = (o) => ({
  id: 7,
  requestId: 'r1',
  jobType: 'legacy_transfer',
  status: 'running',
  artifacts: null,
  startedAt: null,
  errorMessage: null,
  ...o,
});

let server;
let base;
let oturum = null;

before(async () => {
  db.query = async () => ({ rows: [] });
  jobsMod.getJobById = async (id) => isler[String(id)] || null;
  jobsMod.pollJob = async (j) => sonraki[String(j.id)] || j;
  jobsMod.getJobOutput = async (j) => {
    cagri.output.push(j.id);
    if (j.outputHatasi) throw new Error('AWX stdout yok');
    return 'TASK [x] ok';
  };
  jobsMod.cancelJob = async (j) => {
    cagri.cancel.push(j.id);
    return { ...j, status: 'canceled' };
  };
  requests.getRequestRow = async (id) => (id === satir.request_id ? satir : null);
  requests.updateRequest = async (id, alanlar) => {
    cagri.update.push([id, alanlar]);
  };
  downloads.listTokenizedPaths = async () => {
    if (tokenli instanceof Error) throw tokenli;
    return tokenli;
  };
  downloads.issueDownloadToken = async (a) => {
    cagri.token.push(a);
    if (tokenHatasi[a.stagedPath]) throw new Error(tokenHatasi[a.stagedPath]);
    return { token: `tok${cagri.token.length}`.padEnd(12, 'x') };
  };
  legacy.finalizeDiscovery = async (r, j) => {
    cagri.legacy.push([r.request_id, j.id]);
  };
  ocp.finalizeNamespaceDiscovery = async (r, j) => {
    cagri.ns.push([r.request_id, j.id]);
  };
  ocp.finalizeAppDiscovery = async (r, j) => {
    cagri.app.push([r.request_id, j.id]);
  };
  audit.log = async (e) => {
    cagri.audit.push(e);
    if (denetimHatasi) throw new Error('denetim yazilamadi');
  };
  restrictions.assertAllowed = async (tur, ad, u) => {
    cagri.kapi.push([tur, ad, u.username]);
    if (ad === 'kisitli-app')
      throw Object.assign(new Error('Bu uygulamaya erişiminiz yok.'), { status: 403 });
  };
  legacy.discover = async (r, app, hosts, opts) => {
    cagri.kesif.push([r.request_id, app, hosts, opts]);
    const elle = (hosts || []).filter((h) => h.startsWith('ELLE'));
    return {
      job: { id: 55 },
      manualHosts: opts.allowManual ? elle : [],
      manualApp: app === 'yeni-app',
    };
  };
  adminData.listClusterIndex = async () => [{ id: 1, cluster_name: 'c1' }];
  adminData.createClusterIndexRow = async (b) => {
    cagri.katalog.push(['ekle', b]);
    return { id: 2, ...b };
  };
  adminData.updateClusterIndexRow = async (id, b) => {
    cagri.katalog.push(['guncelle', id, b]);
    return id === '404' ? null : { id: Number(id), ...b };
  };
  adminData.deleteClusterIndexRow = async (id) => {
    cagri.katalog.push(['sil', id]);
    return id !== '404';
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oturum) req.session = { user: oturum };
    next();
  });
  const { initLogXv2 } = require('../index.cjs');
  initLogXv2(app);
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  db.query = asil.query;
  Object.assign(jobsMod, {
    getJobById: asil.getJobById,
    pollJob: asil.pollJob,
    getJobOutput: asil.getJobOutput,
    cancelJob: asil.cancelJob,
  });
  requests.getRequestRow = asil.getRequestRow;
  requests.updateRequest = asil.updateRequest;
  downloads.listTokenizedPaths = asil.listTokenizedPaths;
  downloads.issueDownloadToken = asil.issueDownloadToken;
  legacy.finalizeDiscovery = asil.finalizeDiscovery;
  ocp.finalizeNamespaceDiscovery = asil.finalizeNamespaceDiscovery;
  ocp.finalizeAppDiscovery = asil.finalizeAppDiscovery;
  audit.log = asil.log;
  restrictions.assertAllowed = asil.assertAllowed;
  legacy.discover = asil.discover;
  Object.assign(adminData, {
    listClusterIndex: asil.listClusterIndex,
    createClusterIndexRow: asil.createClusterIndexRow,
    updateClusterIndexRow: asil.updateClusterIndexRow,
    deleteClusterIndexRow: asil.deleteClusterIndexRow,
  });
  server && server.close();
});

const ALI = { username: 'ali', role: 'User', authSource: 'ldap', groups: [] };
const VELI = { username: 'veli', role: 'User', authSource: 'ldap', groups: [] };
const ADMIN = { username: 'yonetici', role: 'Admin', authSource: 'ldap', groups: [] };

/**
 * @param {string} yontem
 * @param {string} yol
 * @param {{ kim?: object, govde?: object }} [secenek]
 */
function istek(yontem, yol, { kim = ALI, govde = undefined } = {}) {
  oturum = kim;
  return new Promise((resolve, reject) => {
    const r = http.request(
      `${base}/api/logx/v2${yol}`,
      { method: yontem, headers: { 'content-type': 'application/json' } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
      },
    );
    r.on('error', reject);
    if (govde) r.write(JSON.stringify(govde));
    r.end();
  });
}
const durum = (id = 7, kim) => istek('GET', `/jobs/${id}/status`, { kim });

test('IS1 iş yok / başka kullanıcının işi reddedilir; Admin geçer', async () => {
  reddedildi(await durum(99), 404);
  isler['7'] = is({});
  reddedildi(await durum(7, VELI), 403);
  const r = await durum(7, ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'running');
  // istek satiri yoksa (silinmis) 404
  isler['8'] = is({ id: 8, requestId: 'yok' });
  reddedildi(await durum(8), 404);
});

test('IS2 terminal olmayan ya da zaten terminal olan iş finalize edilmez', async () => {
  isler['7'] = is({ status: 'running' });
  sonraki['7'] = is({ status: 'running' });
  await durum();
  isler['7'] = is({ status: 'successful', artifacts: { staged_path: '/s/a.zip' } });
  sonraki['7'] = isler['7'];
  const r = await durum();
  assert.equal(r.body.status, 'successful');
  assert.equal(cagri.token.length, 0);
  assert.equal(cagri.update.length, 0);
  assert.equal(cagri.audit.length, 0);
});

test('IS3 keşif işleri: Legacy (denetim kaydıyla), OCP namespace ve uygulama', async () => {
  isler['7'] = is({ jobType: 'legacy_discovery' });
  sonraki['7'] = is({
    jobType: 'legacy_discovery',
    status: 'successful',
    artifacts: { overall_status: 'partial' },
  });
  await durum();
  assert.deepEqual(cagri.legacy, [['r1', 7]]);
  assert.deepEqual(
    cagri.audit.map((a) => [a.action, a.result, a.detail, a.username]),
    [['v2_discover', 'partial', 'platform=legacy', 'ali']],
  );
  // sonuc ozeti yoksa "unknown"
  sonraki['7'] = is({ jobType: 'legacy_discovery', status: 'failed', artifacts: null });
  await durum();
  assert.equal(cagri.audit.at(-1).result, 'unknown');

  isler['7'] = is({ jobType: 'ocp_namespace_discovery' });
  sonraki['7'] = is({ jobType: 'ocp_namespace_discovery', status: 'failed' });
  await durum();
  isler['7'] = is({ jobType: 'ocp_app_discovery' });
  sonraki['7'] = is({ jobType: 'ocp_app_discovery', status: 'successful' });
  await durum();
  assert.deepEqual(cagri.ns, [['r1', 7]]);
  assert.deepEqual(cagri.app, [['r1', 7]]);
  // bilinmeyen is tipi: hicbir sey yapilmaz
  isler['7'] = is({ jobType: 'eski_tip' });
  sonraki['7'] = is({ jobType: 'eski_tip', status: 'successful' });
  const r = await durum();
  assert.equal(r.status, 200);
  assert.equal(cagri.update.length, 0);
});

test('IS4 tekil arşiv: token (varsayılan dosya adı, yedek dizin), istek ready, denetim', async () => {
  isler['7'] = is({});
  sonraki['7'] = is({
    status: 'successful',
    artifacts: {
      staged_path: '/sw/logx/r1.zip',
      size_bytes: 2048,
      is_fallback: 1,
      overall_status: 'ok',
    },
  });
  const r = await durum();
  assert.equal(r.status, 200);
  assert.deepEqual(cagri.token, [
    {
      requestId: 'r1',
      username: 'ali',
      sessionToken: 'oturum-1',
      stagedPath: '/sw/logx/r1.zip',
      filename: 'logs.zip',
      sizeBytes: 2048,
      isFallback: true,
    },
  ]);
  assert.deepEqual(cagri.update, [['r1', { state: 'ready' }]]);
  const d = cagri.audit.at(-1);
  assert.equal(d.action, 'v2_transfer');
  assert.equal(d.result, 'ok');
  assert.equal(d.detail, 'download_token_issued count=1/1 token_prefixes=tok1xxxx');
});

test("IS5 çok arşivli OCP: yolsuz satır atlanır, token'lı arşiv yeniden token'lanmaz, bir hata diğerlerini düşürmez", async () => {
  tokenli = new Set(['/sw/b.zip']);
  tokenHatasi['/sw/c.zip'] = 'disk dolu';
  isler['7'] = is({ jobType: 'ocp_discover_fetch' });
  sonraki['7'] = is({
    jobType: 'ocp_discover_fetch',
    status: 'successful',
    artifacts: {
      // tekil alan da var ama dizi oncelikli
      staged_path: '/sw/tekil.zip',
      staged_files: [
        { staged_path: '/sw/a.zip', filename: 'c1.zip', size_bytes: 10 },
        { filename: 'yolsuz.zip' },
        null,
        { staged_path: '/sw/b.zip', filename: 'c2.zip' },
        { staged_path: '/sw/c.zip', filename: 'c3.zip' },
      ],
    },
  });
  const r = await durum();
  assert.equal(r.status, 200);
  assert.deepEqual(
    cagri.token.map((t) => [t.stagedPath, t.filename, t.isFallback]),
    [
      ['/sw/a.zip', 'c1.zip', false],
      ['/sw/c.zip', 'c3.zip', false],
    ],
  );
  assert.deepEqual(cagri.update, [['r1', { state: 'ready' }]]);
  const d = cagri.audit.at(-1);
  assert.equal(d.action, 'v2_ocp_discover_fetch');
  assert.equal(d.result, 'unknown');
  assert.equal(
    d.detail,
    'download_token_issued count=1/3 token_prefixes=tok1xxxx failed=[c3.zip: disk dolu]',
  );
  // bos dizi tekil alana duser; dosya adi yoksa yol yazilir
  cagri.token = [];
  cagri.audit = [];
  tokenli = new Set();
  tokenHatasi['/sw/tekil.zip'] = 'izin yok';
  sonraki['7'] = is({
    jobType: 'ocp_discover_fetch',
    status: 'successful',
    artifacts: { staged_files: [], staged_path: '/sw/tekil.zip' },
  });
  await durum();
  assert.deepEqual(
    cagri.token.map((t) => t.stagedPath),
    ['/sw/tekil.zip'],
  );
  assert.match(
    cagri.audit.at(-1).detail,
    /count=0\/1 token_prefixes= failed=\[\/sw\/tekil\.zip: izin yok\]$/,
  );
});

test('IS5b hiçbir arşive bağlantı üretilemezse istek ready değil failed olur (sebep kullanıcıya)', async () => {
  tokenHatasi['/sw/a.zip'] = 'disk dolu';
  tokenHatasi['/sw/c.zip'] = 'disk dolu';
  isler['7'] = is({ jobType: 'ocp_discover_fetch' });
  sonraki['7'] = is({
    jobType: 'ocp_discover_fetch',
    status: 'successful',
    artifacts: { staged_files: [{ staged_path: '/sw/a.zip' }, { staged_path: '/sw/c.zip' }] },
  });
  await durum();
  // eskiden 'ready' yaziliyordu: ekran "arsiv bulunamadi (temizlenmis olabilir)" diyordu, sebep yalniz denetimde
  assert.deepEqual(cagri.update, [
    [
      'r1',
      {
        state: 'failed',
        errorMessage:
          'Arşiv hazırlandı ama indirme bağlantısı üretilemedi. Lütfen sistem yöneticinize başvurun.',
      },
    ],
  ]);
  assert.match(
    cagri.audit.at(-1).detail,
    /count=0\/2 .*failed=\[\/sw\/a\.zip: disk dolu \| \/sw\/c\.zip: disk dolu\]$/,
  );
  // biri onceden token'li, digerinin token'i bu turda dusuyor: indirilebilir arsiv var, istek ready
  cagri.update = [];
  isler['7'] = is({ jobType: 'ocp_discover_fetch' });
  tokenli = new Set(['/sw/a.zip']);
  await durum();
  assert.deepEqual(cagri.update, [['r1', { state: 'ready' }]]);
  // ikinci poll ayni arsivleri onceden token'li bulursa (yaris) istek ready kalir: hata uydurulmaz
  cagri.update = [];
  isler['7'] = is({ jobType: 'ocp_discover_fetch' });
  tokenli = new Set(['/sw/a.zip', '/sw/c.zip']);
  await durum();
  assert.deepEqual(cagri.update, [['r1', { state: 'ready' }]]);
});

test('IS6 arşivsiz transfer isteği failed yapar; token listesi / denetim hatası yanıtı değiştirmez', async () => {
  isler['7'] = is({});
  sonraki['7'] = is({ status: 'failed', errorMessage: 'Kaynak sunucuya ulaşılamadı (iş 41).' });
  await durum();
  assert.deepEqual(cagri.update, [
    ['r1', { state: 'failed', errorMessage: 'Kaynak sunucuya ulaşılamadı (iş 41).' }],
  ]);
  sonraki['7'] = is({ status: 'error', artifacts: { staged_files: [{ filename: 'yolsuz' }] } });
  await durum();
  assert.deepEqual(cagri.update.at(-1), [
    'r1',
    { state: 'failed', errorMessage: 'Transfer başarısız oldu.' },
  ]);
  // token listesi okunamazsa bos sayilir; denetim yazilamazsa yanit yine 200
  tokenli = new Error('DB yok');
  denetimHatasi = true;
  sonraki['7'] = is({
    status: 'successful',
    artifacts: { staged_path: '/sw/d.zip', filename: 'd.zip' },
  });
  const r = await durum();
  assert.equal(r.status, 200);
  assert.deepEqual(
    cagri.token.map((t) => t.filename),
    ['d.zip'],
  );
  assert.deepEqual(cagri.update.at(-1), ['r1', { state: 'ready' }]);
  // kesif denetimi de yanit degistirmez
  isler['7'] = is({ jobType: 'legacy_discovery' });
  sonraki['7'] = is({ jobType: 'legacy_discovery', status: 'successful' });
  assert.equal((await durum()).status, 200);
});

test('IS7 yanıt: geçen süre; teknik ayrıntı yalnız Admin', async () => {
  const basladi = new Date(Date.now() - 90_000).toISOString();
  isler['7'] = is({});
  sonraki['7'] = is({
    startedAt: basladi,
    errorMessage: 'sade mesaj',
    technicalDetail: 'AWX traceback',
  });
  const r = await durum();
  assert.ok(r.body.elapsedSec >= 89 && r.body.elapsedSec <= 95, String(r.body.elapsedSec));
  assert.equal(r.body.errorMessage, 'sade mesaj');
  assert.equal(r.body.jobType, 'legacy_transfer');
  assert.equal('technicalDetail' in r.body, false);
  const a = await durum(7, ADMIN);
  assert.equal(a.body.technicalDetail, 'AWX traceback');
  sonraki['7'] = is({});
  const b = await durum(7, ADMIN);
  assert.equal(b.body.elapsedSec, 0);
  assert.equal('technicalDetail' in b.body, false);
});

test('IS8 çıktı ve iptal uçları', async () => {
  reddedildi(await istek('GET', '/jobs/99/output'), 404);
  isler['7'] = is({});
  reddedildi(await istek('GET', '/jobs/7/output', { kim: VELI }), 403);
  assert.deepEqual((await istek('GET', '/jobs/7/output')).body, {
    ok: true,
    output: 'TASK [x] ok',
  });
  isler['7'] = is({ outputHatasi: true });
  assert.deepEqual((await istek('GET', '/jobs/7/output')).body, { ok: true, output: '' });

  reddedildi(await istek('POST', '/jobs/99/cancel'), 404);
  reddedildi(await istek('POST', '/jobs/7/cancel', { kim: VELI }), 403);
  assert.deepEqual(cagri.cancel, []);
  const r = await istek('POST', '/jobs/7/cancel');
  assert.deepEqual(r.body, { ok: true, status: 'canceled' });
  assert.deepEqual(cagri.update, [
    ['r1', { state: 'failed', errorMessage: 'İşlem kullanıcı tarafından iptal edildi.' }],
  ]);
  assert.deepEqual(
    cagri.audit.map((a) => [a.action, a.result, a.detail]),
    [['v2_cancel', 'canceled', 'jobType=legacy_transfer jobId=7']],
  );
  denetimHatasi = true;
  assert.equal((await istek('POST', '/jobs/7/cancel')).status, 200);
});

test('IS9 geri sarma: geçersiz hedef 400, hedefe göre alanlar temizlenir, sahiplik', async () => {
  const geri = (to, kim) => istek('POST', '/requests/r1/reset', { kim, govde: { to } });
  const g = await geri('platform');
  assert.equal(g.status, 400);
  assert.equal(g.body.message, 'Geçersiz geri-dönüş hedefi.');
  assert.equal((await istek('POST', '/requests/r1/reset', {})).status, 400);
  reddedildi(await geri('legacy_app', VELI), 403);
  reddedildi(await istek('POST', '/requests/yok/reset', { govde: { to: 'legacy_app' } }), 404);
  assert.deepEqual(cagri.update, []);
  await geri('legacy_app');
  await geri('ocp_cluster_select');
  await geri('ocp_namespace_step');
  assert.deepEqual(cagri.update, [
    ['r1', { state: 'draft', discoveryResult: null, selectedFiles: null, errorMessage: null }],
    ['r1', { state: 'draft', input: null, discoveryResult: null, errorMessage: null }],
    ['r1', { state: 'draft', discoveryResult: null, errorMessage: null }],
  ]);
});

test('IS10 Legacy keşif ucu: kısıt kapısı, elle giriş yalnız açık bayrakla, denetim', async () => {
  const kesif = (govde, kim) => istek('POST', '/legacy/r1/discover', { kim, govde });
  // envanterdeki sunucular, bayraksiz: elle giris kapali
  let r = await kesif({ app: 'odeme-app', hosts: ['ORWASP01'] });
  assert.deepEqual(r.body, { ok: true, jobId: 55, manualHosts: [], manualApp: false });
  assert.deepEqual(cagri.kapi, [['legacy_app', 'odeme-app', 'ali']]);
  assert.deepEqual(cagri.kesif[0], ['r1', 'odeme-app', ['ORWASP01'], { allowManual: false }]);
  assert.equal(cagri.audit.length, 0);
  // bayrak yalniz true ise acik ("true" metni / 1 gecmez)
  await kesif({ app: 'odeme-app', hosts: ['ELLE01'], allowManual: 'true' });
  assert.deepEqual(cagri.kesif.at(-1)[3], { allowManual: false });
  // elle uygulama ve elle sunucu: ikisi de denetime yazilir
  r = await kesif({ app: 'yeni-app', hosts: ['ORWASP01', 'ELLE01', 'ELLE02'], allowManual: true });
  assert.deepEqual(r.body, {
    ok: true,
    jobId: 55,
    manualHosts: ['ELLE01', 'ELLE02'],
    manualApp: true,
  });
  assert.deepEqual(
    cagri.audit.map((a) => [a.action, a.result, a.detail, a.username]),
    [
      ['v2_legacy_manual_app', 'accepted', 'app=yeni-app jobId=55', 'ali'],
      ['v2_legacy_manual_host', 'accepted', 'app=yeni-app hosts=ELLE01,ELLE02 jobId=55', 'ali'],
    ],
  );
  // denetim yazilamazsa is yine baslar
  denetimHatasi = true;
  assert.equal(
    (await kesif({ app: 'yeni-app', hosts: ['ELLE01'], allowManual: true })).status,
    200,
  );
  // kisitli uygulama elle yazilsa da reddedilir; kesif baslamaz
  const once = cagri.kesif.length;
  reddedildi(await kesif({ app: 'kisitli-app', hosts: ['ORWASP01'] }), 403);
  assert.equal(cagri.kesif.length, once);
  // uygulama adi yoksa kapi sorulmaz (sunucu listesinden kesif)
  const kapiOnce = cagri.kapi.length;
  await kesif({ hosts: ['ORWASP01'] });
  assert.equal(cagri.kapi.length, kapiOnce);
  // baskasinin istegi
  reddedildi(await kesif({ app: 'odeme-app', hosts: ['ORWASP01'] }, VELI), 403);
});

test('IS11 cluster kataloğu yönetim uçları: yalnız Admin, kayıt yoksa 404', async () => {
  reddedildi(await istek('GET', '/admin/ocp-cluster-index'), 403);
  reddedildi(
    await istek('POST', '/admin/ocp-cluster-index', { govde: { cluster_name: 'x' } }),
    403,
  );
  assert.deepEqual(cagri.katalog, []);
  const l = await istek('GET', '/admin/ocp-cluster-index', { kim: ADMIN });
  assert.deepEqual(l.body, { ok: true, rows: [{ id: 1, cluster_name: 'c1' }] });
  const e = await istek('POST', '/admin/ocp-cluster-index', {
    kim: ADMIN,
    govde: { cluster_name: 'c2' },
  });
  assert.deepEqual(e.body, { ok: true, row: { id: 2, cluster_name: 'c2' } });
  const g = await istek('PUT', '/admin/ocp-cluster-index/3', {
    kim: ADMIN,
    govde: { env: 'prod' },
  });
  assert.deepEqual(g.body, { ok: true, row: { id: 3, env: 'prod' } });
  reddedildi(await istek('PUT', '/admin/ocp-cluster-index/404', { kim: ADMIN, govde: {} }), 404);
  assert.deepEqual((await istek('DELETE', '/admin/ocp-cluster-index/3', { kim: ADMIN })).body, {
    ok: true,
  });
  assert.deepEqual((await istek('DELETE', '/admin/ocp-cluster-index/404', { kim: ADMIN })).body, {
    ok: false,
  });
  assert.deepEqual(cagri.katalog, [
    ['ekle', { cluster_name: 'c2' }],
    ['guncelle', '3', { env: 'prod' }],
    ['guncelle', '404', {}],
    ['sil', '3'],
    ['sil', '404'],
  ]);
});
