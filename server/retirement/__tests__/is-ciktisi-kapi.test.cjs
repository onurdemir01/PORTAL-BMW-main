// server/retirement/__tests__/is-ciktisi-kapi.test.cjs - RC8, RC11 (2026-10-26).
//
// RC8  is ciktisi ucu Retirement router'inin KIMLIK + ADMIN + ServerHub gorunurluk kapilarinin ARKASINDA.
//      Uc ayri modulde (mount); `app.get('/api/retirement/...')` ya da kapidan once baglanirsa kapilar
//      atlanir ve bunu genel bekci (route-auth-order) GORMEZ: o yalniz dosyanin kendi router.get'lerine bakar.
// RC11 vhost GERI ACMA isi (webGeriAl) is gecmisine yazilmiyor; sunucusu web_result_json'a isle BIRLIKTE
//      yazilmali. Yazilmazsa girdide eski KALDIRMA isinin sunucusu kalir ve cikti ucu baska sunucudaki
//      ayni numarali isi okur.
// index.cjs gercek; db / kimlik / gorunurluk / poller / AWX sahte (require.cache).
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

const durum = { sorgular: [], hedefSatiri: null, webJson: null, registry: null, launch: [] };
sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    durum.sorgular.push({ sql: s, params });
    if (/^SELECT \* FROM retirement_targets WHERE id = \$1 AND record_id = \$2/.test(s)) return { rows: durum.hedefSatiri ? [durum.hedefSatiri] : [] };
    if (/^SELECT web_result_json FROM retirement_targets/.test(s)) return { rows: [{ web_result_json: durum.webJson }] };
    return { rows: [], rowCount: 1 };
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => (req.session?.user ? next() : res.status(401).json({ ok: false, kimlik: true })) });
sahte('../../auth/visibility.cjs', {
  requireVisiblePrefix: (onek) => (req, res, next) => (req.gizli ? res.status(403).json({ ok: false, gorunurluk: onek }) : next()),
});
sahte('../poller.cjs', {
  startPoller(_launch, _finalize, web) { durum.webBaslatici = web; },
  kayitCanli: async () => ({}), zamanlayici: () => ({}), awxDurumu: () => null, webSimdi: async () => ({ kosan: 0 }), pollSaniye: () => 300,
});
sahte('../../audit/index.cjs', { auditPortal: () => {} });
sahte('../../ansible/playbook-registry.cjs', { getByKey: async () => durum.registry, getEffectiveTemplateId: (r) => r.awxTemplateId || null });
sahte('../../ansible/template-preflight.cjs', {
  assertRegistryPlaybook: async () => {}, assertTemplateAcceptsExtraVars: async () => {},
  BEKLENEN_PLAYBOOK: { server_hub_fix: 'server_hub_fix.yml', app_retirement_stop: 'app_retirement_stop.yml' },
});
sahte('../../ansible/runner.cjs', {
  redactSecrets: (s) => s,
  getServerById: () => null,
  launchJobOnServer: async (...a) => { durum.launch.push(a); return { jobId: 900 }; },
  getJobStatusOnServer: async () => { throw new Error('bu testte AWX okunmamali'); },
});

const IDX_YOL = path.join(__dirname, '..', 'index.cjs');
const IDX = fs.readFileSync(IDX_YOL, 'utf8');
const { initRetirement, _webGeriAl } = require('../index.cjs');
const { hedefIsleri } = require('../is-ciktisi.cjs');

let router = null;
initRetirement({ use: (yol, r) => { if (yol === '/api/retirement') router = r; } });

function istek(url, { session = { user: { username: 'onur', role: 'Admin' } }, gizli = false, query = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
      setHeader() {}, getHeader() {},
    };
    router.handle({ method: 'GET', url, headers: {}, session, gizli, query }, res, (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }));
  });
}

test('RC8 is ciktisi ucu kimlik + Admin + ServerHub kapilarinin ARKASINDA (davranis)', async () => {
  assert.ok(router, 'router baglanmadi');
  durum.hedefSatiri = { id: 9, record_id: 5, host: 'H', status: 'pending', last_job_id: null, web_result_json: null };
  const url = '/5/targets/9/is-ciktisi?adim=stop';
  const q = { adim: 'stop' };
  for (const [ne, ops, kod] of [
    ['oturumsuz', { session: null, query: q }, 401],
    ['Admin olmayan', { session: { user: { username: 'u', role: 'User' } }, query: q }, 403],
    ['ServerHub gorunurlugu yok', { gizli: true, query: q }, 403],
  ]) {
    durum.sorgular = [];
    const r = await istek(url, ops);
    assert.equal(r.statusCode, kod, `${ne}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, undefined, `${ne}: istek uca ulasti`);
    assert.equal(durum.sorgular.length, 0, `${ne}: uc DB okudu`);
  }
  durum.sorgular = [];
  const r = await istek(url, { query: q });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'is_yok'], 'Admin icin uc bagli degil');
  assert.ok(durum.sorgular.some((x) => /AND record_id = \$2/.test(x.sql)));
});

test('RC8b mount satiri uc kapidan SONRA ve router uygulamaya baglanmadan ONCE; modul app\'e dogrudan baglanmaz', () => {
  const kod = IDX.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const mount = kod.indexOf("require('./is-ciktisi.cjs').mount(router");
  assert.ok(mount > 0, 'is ciktisi ucu baglanmiyor');
  for (const kapi of ['router.use(requireAuth);', "res.status(403).json({ ok: false, message: 'Retirement yalnız Admin.' })", "requireVisiblePrefix('ServerHub')"]) {
    const i = kod.indexOf(kapi);
    assert.ok(i > 0 && i < mount, `mount kapidan once: ${kapi}`);
  }
  assert.ok(mount < kod.indexOf("app.use('/api/retirement', router)"));
  const mod = fs.readFileSync(path.join(__dirname, '..', 'is-ciktisi.cjs'), 'utf8');
  assert.ok(!/\bapp\.(get|use|post|all)\(/.test(mod), 'is ciktisi modulu uygulamaya dogrudan baglaniyor');
});

test('RC11 vhost geri acma isi sunucusunu ve baslama anini web_result_json\'a ISLE BIRLIKTE yazar', async () => {
  const kaldirma = { host: 'W1', serverName: 'a.x.com', product: 'IHS', confFile: 'a.conf', status: 'ok', jobId: 510, awxServerId: 1, basladi: '2026-10-21T10:00:00Z', bitti: '2026-10-21T10:02:00Z' };
  const elle = { host: 'W2', serverName: 'b.x.com', product: 'NGINX', confFile: 'b.conf', status: 'manual', jobId: null };
  durum.webJson = JSON.stringify([kaldirma, elle]);
  durum.registry = { enabled: true, awxServerId: 3, awxTemplateId: 44 };
  durum.sorgular = [];
  durum.launch = [];
  await _webGeriAl(5, 9, 'onur');
  assert.equal(durum.launch.length, 1);
  assert.equal(durum.launch[0][0], 3, 'geri acma isi kayittaki sunucuda baslamadi');
  const yaz = durum.sorgular.find((x) => /^UPDATE retirement_targets SET web_result_json/.test(x.sql));
  const liste = JSON.parse(yaz.params[0]);
  assert.deepEqual([liste[0].status, liste[0].jobId, liste[0].awxServerId], ['restoring', 900, 3], 'geri acma isinin sunucusu yazilmadi');
  // Isaret: awxServerId BU isin (isaretsiz eski 'restoring' girdisinin sunucusuna is-ciktisi guvenmez, RC16).
  assert.equal(liste[0].sunucuIsi, 900, 'geri acma isinin sunucu isareti yazilmadi');
  assert.ok(liste[0].basladi && liste[0].basladi !== kaldirma.basladi, 'baslama ani eski kaldirma isinin');
  assert.equal(liste[0].bitti, undefined, 'eski kaldirma isinin bitis ani geri acma isine kaldi');
  assert.deepEqual(liste[1], elle);
  // Cikti ucu da AYNI sunucuyu cozer.
  const is = hedefIsleri({ id: 9, host: 'H', status: 'rolling_back', web_result_json: yaz.params[0] }, []).awxIsleri.find((x) => x.adim === 'web');
  assert.deepEqual([is.jobId, is.durum], [900, 'suruyor']);
  const { _hedefIsKayitlari } = require('../is-ciktisi.cjs');
  assert.equal(_hedefIsKayitlari({ id: 9, host: 'H', status: 'rolling_back', web_result_json: yaz.params[0] }, []).isler.find((x) => x.adim === 'web')._sunucu.id, 3);

  // Template yoksa geri acma BASLAMAZ: girdi kaldirma isinin numarasini ve SUNUCUSUNU korur.
  durum.webJson = JSON.stringify([kaldirma]);
  durum.registry = { enabled: true, awxServerId: 3, awxTemplateId: null };
  durum.sorgular = [];
  durum.launch = [];
  await _webGeriAl(5, 9, 'onur');
  const y2 = JSON.parse(durum.sorgular.find((x) => /^UPDATE retirement_targets SET web_result_json/.test(x.sql)).params[0]);
  assert.deepEqual([y2[0].status, y2[0].jobId, y2[0].awxServerId], ['restore_manual', 510, 1]);
  assert.equal(durum.launch.length, 0);

  // Zamanlayicinin vhost KALDIRMA isi da sunucuyu dondurur (poller onu girdiye yazar, poller.test:355).
  durum.registry = { enabled: true, awxServerId: 4, awxTemplateId: 44 };
  const w = await durum.webBaslatici({ webHost: 'W1', product: 'IHS', confFile: 'a.conf', serverName: 'a.x.com' });
  assert.deepEqual([w.jobId, w.awxServerId], [900, 4], 'web adimi baslaticisi sunucuyu dondurmuyor');
});
