// server/retirement/__tests__/silme-web-uclari.test.js - Retirement silme on kontrolu ve web adimini yeniden deneme
// uclari gercek router ile (2026-11-24, kapsam PR-2). Sahte: Portal DB, AWX runner, playbook kaydi, poller.
//   SW1 delete-plan: kayit iptal / silinmis 400; hedef yok; JBoss nesli yok 400; durdurulmamis / silinmis hedef 409;
//       30 dk icinde suren on kontrol 409 (eskisi engellemez)
//   SW2 delete-plan: playbook kaydi yok / kapali / template bos 501 (sebep ekranda); basarida plan_only AWX'e,
//       on kontrol kaydi yalniz 'stopped' hedefe, olay; hicbir sey silinmez
//   SW3 web-retry: iptal kayit, durum, web listesi yok / bozuk; suren is ayni dosyada iken yeniden denenmez
//   SW4 web-retry: basarisiz ve atlanmis vhost'lar tekillestirilip 'pending' olur; poller hemen tetiklenir,
//       poller hatasi yaniti bozmaz
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const D = { kayit: null, hedefler: [], webJson: null, yazim: [], olaylar: [] };
sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM retirement_records WHERE id = $1'))
      return { rows: D.kayit && D.kayit.id === params[0] ? [D.kayit] : [] };
    if (s.startsWith('SELECT * FROM retirement_targets WHERE record_id = $1'))
      return { rows: D.hedefler };
    if (s.startsWith('SELECT TOP 200 * FROM retirement_events')) return { rows: [] };
    if (s.startsWith('SELECT web_result_json FROM retirement_targets'))
      return { rows: [{ web_result_json: D.webJson }] };
    if (s.startsWith('INSERT INTO retirement_events')) {
      D.olaylar.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (/^(UPDATE retirement_targets|INSERT INTO ansible_job_history)/.test(s)) {
      D.yazim.push({ s, params });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => next() });
sahte('../../auth/visibility.cjs', {
  requireVisiblePrefix: () => (req, res, next) => next(),
  canSee: async () => true,
});
const POL = { simdi: { kosan: 2, kilitli: false }, hata: null };
sahte('../poller.cjs', {
  startPoller() {},
  kayitCanli: async () => ({}),
  zamanlayici: () => ({}),
  awxDurumu: () => null,
  webSimdi: async () => {
    if (POL.hata) throw POL.hata;
    return POL.simdi;
  },
  pollSaniye: () => 300,
});
sahte('../../audit/index.cjs', { auditPortal: () => {} });
const REG = { satir: null };
sahte('../../ansible/playbook-registry.cjs', {
  getByKey: async () => REG.satir,
  getEffectiveTemplateId: (r) => r.awxTemplateId || null,
});
sahte('../../ansible/template-preflight.cjs', {
  assertRegistryPlaybook: async () => {},
  assertTemplateAcceptsExtraVars: async () => {},
  BEKLENEN_PLAYBOOK: {},
});
const AWX = { cagri: [] };
sahte('../../ansible/runner.cjs', {
  redactSecrets: (s) => s,
  getServerById: () => ({ id: 2 }),
  launchJobOnServer: async (...a) => {
    AWX.cagri.push(a);
    return { jobId: 810, status: 'pending' };
  },
  getJobStatusOnServer: async () => ({ status: 'running' }),
});

const { initRetirement } = require('../index.cjs');
let router = null;
initRetirement({
  use: (yol, r) => {
    if (yol === '/api/retirement') router = r;
  },
});
function istek(url, body = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        resolve(this);
        return this;
      },
      setHeader() {},
      getHeader() {},
    };
    router.handle(
      {
        method: 'POST',
        url,
        headers: {},
        body,
        session: { user: { username: 'adm1', role: 'Admin' } },
        query: {},
      },
      res,
      (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }),
    );
  });
}

const hedef = (ek = {}) => ({
  id: 11,
  record_id: 37,
  host: 'ORJEXP01',
  site: 'Pendik',
  env: 'PROD',
  app_name: 'ORPOSWEBAPI',
  jboss_gen: 7,
  app_path: '/vhosting/ORPOSWEBAPI.ear',
  status: 'stopped',
  stopped_at: '2026-11-24T09:00:00Z',
  deleted_at: null,
  ...ek,
});
const web = (host, serverName, status, ek = {}) => ({
  host,
  serverName,
  product: 'IHS',
  confFile: 'mod-jk.conf',
  status,
  jobId: 40,
  message: null,
  ...ek,
});

beforeEach((t) => {
  D.kayit = {
    id: 37,
    app: 'ORPOSWEBAPI',
    smart_no: '364244',
    status: 'open',
    created_at: '2026-11-20T10:00:00Z',
  };
  D.hedefler = [hedef()];
  Object.assign(D, { webJson: null, yazim: [], olaylar: [] });
  REG.satir = { awxTemplateId: 62, awxServerId: 2 };
  AWX.cagri = [];
  POL.simdi = { kosan: 2, kilitli: false };
  POL.hata = null;
  t.mock.method(console, 'warn', () => {});
});

const silmePlani = () => istek('/37/targets/11/delete-plan');

test('SW1 delete-plan: kayit ve hedef durum denetimleri', async () => {
  for (const [durum, re] of [
    ['cancelled', /iptal edilmiş/],
    ['deleted', /zaten silinmiş/],
  ]) {
    D.kayit.status = durum;
    const r = await silmePlani();
    assert.equal(r.statusCode, 400);
    assert.match(r.body.message, re);
  }
  D.kayit.status = 'open';
  assert.equal((await istek('/37/targets/12/delete-plan')).body.message, 'Hedef yok.');
  D.hedefler = [hedef({ jboss_gen: null })];
  let r = await silmePlani();
  assert.equal(r.statusCode, 400);
  assert.match(r.body.message, /JBoss nesli belirlenemedi/);
  D.hedefler = [hedef({ status: 'active' })];
  r = await silmePlani();
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /silinmeye hazır değil \(durum: active\)/);
  D.hedefler = [hedef({ deleted_at: '2026-11-24T10:00:00Z' })];
  assert.equal((await silmePlani()).statusCode, 409);
  D.hedefler = [
    hedef({
      delete_onkontrol_json: JSON.stringify({
        jobId: 805,
        at: new Date().toISOString(),
        durum: 'running',
      }),
    }),
  ];
  r = await silmePlani();
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /zaten sürüyor \(iş #805\)/);
  D.hedefler = [
    hedef({
      delete_onkontrol_json: JSON.stringify({
        jobId: 805,
        at: new Date(Date.now() - 31 * 60000).toISOString(),
        durum: 'running',
      }),
    }),
  ];
  assert.equal((await silmePlani()).statusCode, 200, '30 dakikadan eski on kontrol engelledi');
  assert.equal(AWX.cagri.length, 1);
});

test('SW2 delete-plan: playbook kaydi sebepleri ve plan_only tetik', async () => {
  for (const [satir, re] of [
    [null, /"app_retirement_delete" anahtarlı satır YOK/],
    [{ awxTemplateId: 62, enabled: false }, /satırı KAPALI/],
    [{ awxTemplateId: null }, /satırında Template ID boş/],
  ]) {
    REG.satir = satir;
    const r = await silmePlani();
    assert.equal(r.statusCode, 501);
    assert.match(r.body.message, re);
  }
  assert.equal(AWX.cagri.length, 0);
  REG.satir = { awxTemplateId: 62, awxServerId: 2 };
  const r = await silmePlani();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.jobId, r.body.planOnly, r.body.awxServerId], [810, true, 2]);
  const [sunucu, sablon, degiskenler] = AWX.cagri[0];
  assert.deepEqual([sunucu, sablon], [2, 62]);
  assert.deepEqual(degiskenler, {
    target_host: 'ORJEXP01',
    application: 'ORPOSWEBAPI',
    jboss_gen: '7',
    app_path: '/vhosting/ORPOSWEBAPI.ear',
    smart_no: '364244',
    plan_only: true,
    requested_by: 'adm1',
  });
  const yaz = D.yazim.find((y) =>
    y.s.startsWith('UPDATE retirement_targets SET delete_onkontrol_json'),
  );
  assert.match(yaz.s, /WHERE id = \$2 AND status = 'stopped'/);
  const kayit = JSON.parse(yaz.params[0]);
  assert.equal(kayit.jobId, 810);
  assert.equal(kayit.kaynak, 'elle');
  assert.equal(kayit.kullanici, 'adm1');
  assert.ok(
    D.yazim.some((y) => y.s.startsWith('INSERT INTO ansible_job_history')),
    'is gecmisi yazilmadi',
  );
  assert.equal(D.olaylar.at(-1)[2], 'delete-plan');
  assert.match(D.olaylar.at(-1)[3], /hiçbir şey silinmez/);
});

test('SW3 web-retry: denetimler ve suren is', async () => {
  const dene = () => istek('/37/targets/11/web-retry');
  D.kayit.status = 'cancelled';
  assert.equal((await dene()).body.message, 'Kayıt iptal edilmiş.');
  D.kayit.status = 'open';
  D.hedefler = [hedef({ status: 'active' })];
  let r = await dene();
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /yalnız durdurulmuş hedefte/);
  D.hedefler = [hedef()];
  for (const j of [null, '{bozuk', '[]']) {
    D.webJson = j;
    r = await dene();
    assert.equal(r.statusCode, 400, String(j));
    assert.match(r.body.message, /web listesi yok/);
  }
  D.webJson = JSON.stringify([web('ORJEXW01', 'pos.ornek.invalid', 'ok')]);
  r = await dene();
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /Yeniden denenecek başarısız ya da atlanmış vhost yok/);
  D.webJson = JSON.stringify([
    web('ORJEXW01', 'pos.ornek.invalid', 'failed'),
    // Ayni vhost girdisi (sunucu + dosya + ad) icin hala kosan bir is var.
    web('ORJEXW01', 'pos.ornek.invalid', 'running', { jobId: 41 }),
  ]);
  r = await dene();
  assert.equal(r.statusCode, 409);
  assert.match(r.body.message, /aynı dosyada iş hâlâ sürüyor/);
  assert.equal(D.yazim.length, 0, 'yeniden denenmeyen liste yazildi');
});

test('SW4 web-retry: basarisiz / atlanmis vhost pending olur, poller tetiklenir', async () => {
  D.webJson = JSON.stringify([
    web('ORJEXW01', 'pos.ornek.invalid', 'failed', { message: 'reload hatasi' }),
    web('ORJEXW02', 'pos.ornek.invalid', 'skip'),
    web('ORJEXW03', 'pos.ornek.invalid', 'ok'),
  ]);
  let r = await istek('/37/targets/11/web-retry');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(
    [r.body.adet, r.body.basladi, r.body.kilitli, r.body.pollSaniye],
    [2, 2, false, 300],
  );
  const liste = JSON.parse(D.yazim[0].params[0]);
  const durumlar = Object.fromEntries(liste.map((w) => [w.host, w.status]));
  assert.deepEqual(durumlar, { ORJEXW01: 'pending', ORJEXW02: 'pending', ORJEXW03: 'ok' });
  const ilk = liste.find((w) => w.host === 'ORJEXW01');
  assert.deepEqual(
    [ilk.oncekiJobId, ilk.oncekiMesaj, ilk.yenidenDene],
    [40, 'reload hatasi', true],
  );
  assert.match(D.yazim[0].s, /AND status = 'stopped'/);
  assert.match(D.olaylar.at(-1)[3], /YENIDEN DENENECEK - ORJEXW01 \/ pos.ornek.invalid, ORJEXW02/);

  POL.hata = new Error('kilit alinamadi');
  r = await istek('/37/targets/11/web-retry');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.baslatmaHatasi, 'kilit alinamadi');
  assert.equal(r.body.basladi, 0);
});
