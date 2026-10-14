// server/logx/v2/__tests__/sablon-tek-okuma.test.cjs — LogX baslatmadan once template'i
// TEK kez okur; sihirbazin hazirlik ucu kayitlari paralel ve tek okumayla kontrol eder.
//
// URETIM (13 Ekim): LogX Legacy kesif/aktarim istekleri ortalama 4,6 sn surdu; sihirbazin
// OCP uygulama kesfinden ONCE bekledigi `/playbook-readiness` 9,3-9,7 sn. Kok: her baslatma
// playbook eslesmesi ve "Prompt on launch" icin AYRI AYRI tum AWX template listesini sayfa
// sayfa cekiyordu (iki tam liste + baslatma); hazirlik ucu bes kaydi SIRAYLA ve her biri
// icin tam listeyle okuyordu.
//
// Testler GERCEK runner'i sahte bir AWX'e karsi kosturur; DB, istek satiri, kimlik ve
// Playbook Kayitlari taklittir (konu degiller).
//   ST1 baslatma: template TEK okunur, liste HIC cekilmez, is baslar
//   ST2 "Prompt on launch" kapali: 409 ayni kod/metin, is BASLATILMAZ
//   ST3 playbook eslesmiyor: 409, is BASLATILMAZ
//   ST4 template okunamazsa (AWX 500) bloklanmaz (fail-open, eski davranis)
//   ST5 hazirlik: bes kayit PARALEL, her biri tek okuma, liste yok; 404/500/alan-yok ayrimi
//   ST6 baslatmada "Prompt on launch" alani yoksa bloklanmaz
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

// ── Sahte AWX ───────────────────────────────────────────────────────────────
const istekler = [];
let sablonlar = new Map(); // id -> { durum, govde }
let gecikmeMs = 0;
let eszamanli = 0;
let enCokEszamanli = 0;

let awx;
before(async () => {
  awx = http.createServer((q, r) => {
    istekler.push(`${q.method} ${q.url}`);
    const gonder = (kod, govde) => {
      r.writeHead(kod, { 'content-type': 'application/json' });
      r.end(JSON.stringify(govde));
    };
    let m = /^\/api\/v2\/job_templates\/(\d+)\/$/.exec(q.url);
    if (q.method === 'GET' && m) {
      eszamanli++;
      enCokEszamanli = Math.max(enCokEszamanli, eszamanli);
      return setTimeout(() => {
        eszamanli--;
        const s = sablonlar.get(Number(m[1]));
        if (!s) return gonder(404, { detail: 'Not found.' });
        gonder(s.durum, s.govde);
      }, gecikmeMs);
    }
    if (q.method === 'GET' && /^\/api\/v2\/job_templates\/\?/.test(q.url)) {
      return gonder(200, { count: 0, next: null, results: [] });
    }
    m = /^\/api\/v2\/job_templates\/(\d+)\/survey_spec\/$/.exec(q.url);
    if (q.method === 'GET' && m) return gonder(200, {});
    m = /^\/api\/v2\/job_templates\/(\d+)\/launch\/$/.exec(q.url);
    if (q.method === 'POST' && m) {
      q.resume();
      return q.on('end', () => gonder(201, { job: 9001, id: 9001, status: 'pending' }));
    }
    gonder(404, { detail: `sahte AWX tanimiyor: ${q.method} ${q.url}` });
  });
  await new Promise((ok) => awx.listen(0, '127.0.0.1', ok));
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.address().port}`;
  process.env.AWX_1_TOKEN = 'logx-test-token';
  process.env.AWX_1_NAME = 'awx-logx-test';
});
after(() => awx && awx.close());

beforeEach(() => {
  istekler.length = 0;
  sablonlar = new Map();
  gecikmeMs = 0;
  enCokEszamanli = 0;
});

// ── Taklitler ───────────────────────────────────────────────────────────────
const yer = (p, exports) => {
  const tam = require.resolve(p);
  require.cache[tam] = { id: tam, filename: tam, loaded: true, exports };
};
const KAYITLAR = {
  logx_legacy_discovery: { templateId: 501, playbookPath: 'logx/logx_legacy_discovery.yml' },
  logx_legacy_transfer: { templateId: 502, playbookPath: 'logx/logx_legacy_transfer.yml' },
  logx_ocp_namespace_discovery: { templateId: 503, playbookPath: 'logx/x.yml' },
  logx_ocp_app_discovery: { templateId: 504, playbookPath: 'logx/y.yml' },
  logx_ocp_discover_fetch: { templateId: 505, playbookPath: 'logx/z.yml' },
};
const eklenen = [];
yer('../../../db/index.cjs', {
  query: async (sql) => {
    if (/^\s*SELECT \* FROM logx_v2_jobs WHERE request_id/.test(sql)) return { rows: [] };
    if (/^\s*INSERT INTO logx_v2_jobs/.test(sql)) {
      const satir = {
        id: eklenen.length + 1,
        request_id: 'R1',
        job_type: 'legacy_discovery',
        awx_server_id: 1,
        awx_job_id: 9001,
        status: 'pending',
      };
      eklenen.push(satir);
      return { rows: [satir] };
    }
    throw new Error(`taklit DB tanimiyor: ${sql.slice(0, 80)}`);
  },
});
yer('../../../ansible/playbook-registry.cjs', {
  getByKey: async (k) =>
    KAYITLAR[k]
      ? { keyName: k, displayName: k, enabled: true, awxServerId: 1, ...KAYITLAR[k] }
      : null,
  getEffectiveTemplateId: (row) => row.templateId,
  updateServerId: async () => false,
});
yer('../requests.cjs', { getRequestRow: async () => ({ username: 'kullanici1' }) });
yer('../../../auth/users.cjs', {
  getUserIdentity: async () => ({
    username: 'kullanici1',
    displayName: 'Kullanici Bir',
    mail: 'k1@ornek.test',
  }),
});
yer('../../audit.cjs', {});

const jobs = require('../jobs.cjs');
const readiness = require('../playbook-readiness.cjs');

const sablon = (id, alanlar) =>
  sablonlar.set(id, {
    durum: 200,
    govde: {
      id,
      name: `Sablon ${id}`,
      playbook: 'logx/logx_legacy_discovery.yml',
      ask_variables_on_launch: true,
      survey_enabled: false,
      ...alanlar,
    },
  });
const listeCekildi = () => istekler.filter((i) => /^GET \/api\/v2\/job_templates\/\?/.test(i));
const sablonOkumasi = (id) => istekler.filter((i) => i === `GET /api/v2/job_templates/${id}/`);
const baslatma = (id) => istekler.filter((i) => i === `POST /api/v2/job_templates/${id}/launch/`);

test('ST1 baslatma: template TEK okunur, tam liste HIC cekilmez, is baslar', async () => {
  sablon(501);
  const is = await jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' });
  assert.equal(is.awxJobId, 9001);
  assert.equal(sablonOkumasi(501).length, 1, `template ${sablonOkumasi(501).length} kez okundu`);
  assert.deepEqual(listeCekildi(), [], 'tum template listesi hala cekiliyor');
  assert.equal(baslatma(501).length, 1);
});

test('ST2 "Prompt on launch" kapali: 409 + ortak kod, is BASLATILMAZ', async () => {
  sablon(501, { ask_variables_on_launch: false });
  await assert.rejects(
    () => jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' }),
    (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, 'awx_prompt_on_launch_disabled');
      assert.match(e.message, /logx_legacy_discovery/);
      assert.match(e.message, /Sablon 501/);
      return true;
    },
  );
  assert.equal(baslatma(501).length, 0, 'degiskenleri yutacak template ile is baslatildi');
});

test('ST3 playbook Playbook Kayitlari ile eslesmiyor: 409, is BASLATILMAZ', async () => {
  sablon(501, { playbook: 'retirement/app_retirement_stop.yml' });
  await assert.rejects(
    () => jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' }),
    (e) => e.status === 409 && /eşleşme hatası/.test(e.message),
  );
  assert.equal(baslatma(501).length, 0);
});

test('ST4 template okunamazsa (AWX 500) BLOKLANMAZ — eski fail-open davranis', async () => {
  sablonlar.set(501, { durum: 500, govde: { detail: 'gecici' } });
  const is = await jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' });
  assert.equal(is.awxJobId, 9001);
  assert.equal(baslatma(501).length, 1);
});

test('ST5 hazirlik: bes kayit PARALEL ve tek okumayla; bulunamadi / bilinmiyor / kapali ayrimi', async () => {
  gecikmeMs = 120;
  sablon(501);
  sablon(502, { ask_variables_on_launch: false });
  sablonlar.set(503, { durum: 500, govde: { detail: 'gecici' } });
  // 504 tanimsiz -> AWX 404
  sablon(505, { ask_variables_on_launch: undefined });
  const satirlar = await readiness.getRows();
  assert.ok(
    enCokEszamanli >= 2,
    `kayitlar SIRAYLA okundu (en cok ${enCokEszamanli} eszamanli istek)`,
  );
  assert.deepEqual(listeCekildi(), [], 'hazirlik ucu hala tum template listesini cekiyor');
  for (const id of [501, 502, 503, 504, 505])
    assert.equal(sablonOkumasi(id).length, 1, `template ${id}`);

  const k = Object.fromEntries(satirlar.map((s) => [s.keyName, s]));
  assert.deepEqual(Object.keys(k), readiness.LOGX_KEYS, 'satir sirasi degisti');
  assert.equal(k.logx_legacy_discovery.foundOnAwx, true);
  assert.equal(k.logx_legacy_discovery.promptOnLaunch, true);
  assert.equal(k.logx_legacy_discovery.templateName, 'Sablon 501');
  assert.equal(k.logx_legacy_transfer.promptOnLaunch, false);
  assert.equal(
    k.logx_ocp_namespace_discovery.foundOnAwx,
    null,
    'okuma hatasi "bulunamadi" sayildi',
  );
  assert.equal(k.logx_ocp_namespace_discovery.promptOnLaunch, null);
  assert.equal(k.logx_ocp_app_discovery.foundOnAwx, false, 'AWX 404 "bulunamadi" sayilmadi');
  assert.equal(k.logx_ocp_discover_fetch.promptOnLaunch, null, 'alan yokken "kapali" denmemeli');

  const pub = readiness.toPublic(satirlar);
  assert.equal(
    pub.find((p) => p.keyName === 'logx_legacy_transfer').reason,
    'prompt_on_launch_disabled',
  );
  assert.equal(
    pub.find((p) => p.keyName === 'logx_ocp_namespace_discovery').ready,
    true,
    'bilinmiyor HAZIR sayilmali',
  );
});

test('ST6 "Prompt on launch" alani YOKSA bloklanmaz (yalniz acikca false reddedilir)', async () => {
  // Eski liste yolu alan yokken `|| false` ile "kapali" sayiyordu; tek okuma HAM bayrak
  // tasir ve "bilinmiyor"u reddetmez (ScaleX ile ayni kural).
  sablon(501, { ask_variables_on_launch: undefined });
  const is = await jobs.launchJob('R1', 'legacy_discovery', { logx_app: 'UYG' });
  assert.equal(is.awxJobId, 9001);
  assert.equal(baslatma(501).length, 1);
});
