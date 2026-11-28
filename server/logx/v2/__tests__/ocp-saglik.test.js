'use strict';
// OCP CLUSTER SAGLIGI (server/logx/v2/ocp-health.cjs) — Admin > LogX > OCP cluster'lari ekranindaki
// "Baglantiyi dene" ve "Pod durumu". Yoklama GERCEK bir yerel HTTP sunucusuna gider; DB, AWX
// kosucusu, playbook kaydi ve atlama sunucusu cozumu cagri aninda okunur, yerinde sahte.
//   OH1 yoklama: /version yolu, Bearer belirteci (yoksa baslik yok), 2xx/3xx erisilebilir, 401/403
//       erisilebilir + aciklama, digerleri yanitin ilk 150 karakteriyle; gecersiz URL; TLS ayari
//       kurulamazsa istek gitmez; kapali port; tavani asan yanit; zaman asimi.
//   OH2 baglanti denemesi: cluster yoksa 404, API URL yoksa 400; sonuc ve sure doner, durum
//       ('ok' / 'unreachable') yazilir; durum yazilamazsa sonuc yine doner.
//   OH3 pod durumu: cluster yok 404; atlama sunucusu yok 400; sablon yok 503; extra_vars on
//       denetimi (reddederse is baslatilmaz); is 2 sn arayla yoklanir, basarili bitince cikti;
//       basarisiz biterse hemen, 30 denemede bitmezse 502.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const db = require('../../../db/index.cjs');
const admin = require('../admin.cjs');
const runner = require('../../../ansible/runner.cjs');
const kayit = require('../../../ansible/playbook-registry.cjs');
const onDenetim = require('../../../ansible/template-preflight.cjs');
const { testConnection, podStatus, getClusterRow, _probeApiUrl } = require('../ocp-health.cjs');

/** Yerel OCP API taklidi; istekler kaydedilir. */
async function api(t, isle) {
  const istekler = [];
  const s = http.createServer((req, res) => {
    istekler.push({ yol: req.url, yetki: req.headers.authorization });
    isle(req, res);
  });
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => {
    s.closeAllConnections();
    return new Promise((r) => s.close(r));
  });
  return { url: `http://127.0.0.1:${s.address().port}/api/ignored`, istekler };
}

const yanitla =
  (kod, govde = '') =>
  (_req, res) =>
    res.writeHead(kod).end(govde);

test('OH1 yoklama sonuclari', async (t) => {
  let a = await api(t, yanitla(200, '{"major":"1"}'));
  assert.deepEqual(await _probeApiUrl(a.url, 'gizli-belirtec'), { ok: true });
  assert.deepEqual(a.istekler, [{ yol: '/version', yetki: 'Bearer gizli-belirtec' }]);
  assert.deepEqual(await _probeApiUrl(a.url, ''), { ok: true });
  assert.equal(a.istekler[1].yetki, undefined, 'belirtec yokken yetki basligi gitti');

  a = await api(t, yanitla(302));
  assert.deepEqual(await _probeApiUrl(a.url), { ok: true });

  for (const kod of [401, 403]) {
    a = await api(t, yanitla(kod));
    assert.deepEqual(await _probeApiUrl(a.url), {
      ok: true,
      message: `Erişilebilir (HTTP ${kod} — kimlik doğrulama beklenen davranış, token portalda tutulmaz).`,
    });
  }

  const uzun = 'x'.repeat(400);
  a = await api(t, yanitla(503, uzun));
  assert.deepEqual(await _probeApiUrl(a.url), {
    ok: false,
    message: `HTTP 503: ${'x'.repeat(150)}`,
  });

  assert.deepEqual(await _probeApiUrl('gecersiz adres'), {
    ok: false,
    message: 'Geçersiz API URL.',
  });

  // TLS ayari kurulamazsa (zorunlu CA dosyasi okunamiyor) istek hic gitmez, sebep doner.
  const eskiCa = process.env.OCP_TLS_CA;
  process.env.OCP_TLS_CA = '/yok/ocp-ca.pem';
  try {
    assert.deepEqual(await _probeApiUrl('https://127.0.0.1:1/'), {
      ok: false,
      message:
        'OCP_TLS_CA okunamadi: /yok/ocp-ca.pem (dosya yok ya da izin yok; docs/TLS-SETUP.md)',
    });
  } finally {
    if (eskiCa === undefined) delete process.env.OCP_TLS_CA;
    else process.env.OCP_TLS_CA = eskiCa;
  }

  // Kapali port (acilip hemen kapatilan): ag hatasi iletisiyle.
  const bos = http.createServer();
  bos.listen(0, '127.0.0.1');
  await once(bos, 'listening');
  const olu = bos.address().port;
  await new Promise((r) => bos.close(r));
  const r = await _probeApiUrl(`http://127.0.0.1:${olu}/`);
  assert.equal(r.ok, false);
  assert.match(r.message, /ECONNREFUSED/);

  // Tavan: 256 KB'i asan yanit okunmaz.
  a = await api(t, (_req, res) => {
    res.writeHead(500);
    res.end('y'.repeat(300 * 1024));
  });
  const buyuk = await _probeApiUrl(a.url);
  assert.equal(buyuk.ok, false);
  assert.match(buyuk.message, /OCP saglik yoklamasi/);
});

test('OH1b yanit vermeyen sunucu 5 sn sonra zaman asimi', async (t) => {
  const a = await api(t, () => {
    /* hic yanit yok */
  });
  const bas = Date.now();
  assert.deepEqual(await _probeApiUrl(a.url), {
    ok: false,
    message: 'Bağlantı zaman aşımına uğradı.',
  });
  const gecen = Date.now() - bas;
  assert.ok(gecen >= 4900 && gecen < 8000, `zaman asimi 5 sn degil (${gecen} ms)`);
});

/** Cluster satiri ve durum yazimi; yazilan durumlar kaydedilir. */
function sahteDb(t, satir, { yazimHatasi } = {}) {
  const yazilan = [];
  const sorgular = [];
  t.mock.method(db, 'query', async (sql, p) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    sorgular.push({ q, p });
    if (q.startsWith('SELECT TOP 1')) return { rows: satir ? [satir] : [] };
    if (q.startsWith('UPDATE ocp_cluster_index')) {
      if (yazimHatasi) throw yazimHatasi;
      yazilan.push(p);
      return { rows: [] };
    }
    throw new Error(`beklenmeyen sorgu: ${q}`);
  });
  return { yazilan, sorgular };
}

const SATIR = {
  id: 4,
  env: 'PROD',
  tenant: 'ana',
  cluster_name: 'ocp-a',
  api_url: null,
  token: 'b1',
  terminal_host: null,
  default_namespace: 'varsayilan-ns',
};

test('OH2 baglanti denemesi ve durum yazimi', async (t) => {
  let d = sahteDb(t, null);
  await assert.rejects(testConnection('4'), { status: 404, message: 'Cluster bulunamadı.' });
  assert.deepEqual(d.sorgular[0].p, [4]);
  assert.match(d.sorgular[0].q, /FROM ocp_cluster_index WHERE id = \$1$/);
  assert.equal(await getClusterRow(4), null);

  d = sahteDb(t, SATIR);
  await assert.rejects(testConnection(4), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /API URL tanımlı değil/);
    return true;
  });

  const a = await api(t, yanitla(200));
  d = sahteDb(t, { ...SATIR, api_url: a.url });
  let r = await testConnection('4');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'ok');
  assert.equal(r.message, undefined);
  assert.equal(typeof r.responseTimeMs, 'number');
  assert.deepEqual(d.yazilan, [['ok', 4]]);
  assert.equal(a.istekler[0].yetki, 'Bearer b1');

  const b = await api(t, yanitla(500, 'olmadi'));
  d = sahteDb(t, { ...SATIR, api_url: b.url }, { yazimHatasi: new Error('kilit') });
  r = await testConnection(4);
  assert.deepEqual([r.ok, r.status, r.message], [false, 'unreachable', 'HTTP 500: olmadi']);
});

/** Pod durumu bagimliliklari; is durumlari sirayla doner. */
function podKur(
  t,
  { satir = SATIR, eksik = [], kayitSatiri, sablon = 77, durumlar = ['successful'] } = {},
) {
  sahteDb(t, satir);
  const cozum = t.mock.method(admin, 'resolveTerminalHosts', async (env, tenant, adlar) => ({
    hosts: eksik.length ? {} : { [adlar[0]]: 'atlama-1' },
    missing: eksik,
  }));
  t.mock.method(kayit, 'getByKey', async () =>
    kayitSatiri === undefined ? { awxServerId: 3 } : kayitSatiri,
  );
  t.mock.method(kayit, 'getEffectiveTemplateId', () => sablon);
  const on = t.mock.method(onDenetim, 'assertTemplateAcceptsExtraVars', async () => {});
  const baslat = t.mock.method(runner, 'launchJob', async () => ({ jobId: 901 }));
  const sira = [...durumlar];
  const durum = t.mock.method(runner, 'getJobStatus', async () => ({
    status: sira.length > 1 ? sira.shift() : sira[0],
  }));
  t.mock.method(runner, 'getJobOutput', async () => ({ output: 'POD-LISTESI' }));
  return { cozum, on, baslat, durum };
}

/** Yoklama dongusunu sahte saatle ilerletir: her adimda mikro gorevler bosaltilir. */
async function ilerlet(t, soz, adim = 2000, en = 40) {
  let bitti = false;
  // Bitis yan dalda izlenir; asil promise dondurulur (ret, beklenene kadar yakalanmamis sayilmasin).
  soz.then(
    () => (bitti = true),
    () => (bitti = true),
  );
  for (let i = 0; i < en && !bitti; i++) {
    for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(adim);
  }
  return soz;
}

test('OH3 pod durumu: on kosullar', async (t) => {
  sahteDb(t, null);
  await assert.rejects(podStatus(9), { status: 404 });

  podKur(t, { eksik: ['ocp-a'] });
  await assert.rejects(podStatus(4), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /Jump Server tanımlı değil: ocp-a .*"ana\/PROD" için yedek eşleme/);
    return true;
  });

  podKur(t, { sablon: null });
  await assert.rejects(podStatus(4), (e) => {
    assert.equal(e.status, 503);
    assert.match(e.message, /template ID tanımlı değil/);
    return true;
  });
  podKur(t, { kayitSatiri: null });
  await assert.rejects(podStatus(4), { status: 503 });
});

test('OH3b pod durumu: on denetim, yoklama, cikti', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = podKur(t, { durumlar: ['pending', 'running', 'successful'] });
  const soz = podStatus(4, { labelSelector: 'app=odeme' });
  // Ilk yoklama 2 sn SONRA: 1999 ms'de henuz sorulmaz.
  for (let k = 0; k < 10; k++) await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(1999);
  for (let k = 0; k < 10; k++) await new Promise((r) => setImmediate(r));
  assert.equal(s.durum.mock.callCount(), 0, 'is 2 sn dolmadan yoklandi');
  t.mock.timers.tick(1);
  for (let k = 0; k < 10; k++) await new Promise((r) => setImmediate(r));
  assert.equal(s.durum.mock.callCount(), 1);
  const r = await ilerlet(t, soz);
  assert.deepEqual(r, { ok: true, output: 'POD-LISTESI', jobId: 901, jumpHost: 'atlama-1' });
  assert.deepEqual(s.cozum.mock.calls[0].arguments, ['PROD', 'ana', ['ocp-a']]);
  const beklenen = {
    jump_host: 'atlama-1',
    namespace: 'varsayilan-ns',
    label_selector: 'app=odeme',
  };
  assert.deepEqual(s.on.mock.calls[0].arguments, [3, 77, beklenen, { label: 'ocp_pod_status' }]);
  assert.deepEqual(s.baslat.mock.calls[0].arguments, [77, beklenen, 'atlama-1']);
  assert.equal(s.durum.mock.callCount(), 3);

  const s2 = podKur(t, { kayitSatiri: {}, sablon: '12', durumlar: ['successful'] });
  await ilerlet(t, podStatus(4, { namespace: 'ozel' }));
  assert.equal(s2.on.mock.calls[0].arguments[0], 0, 'AWX sunucusu yoksa 0');
  assert.deepEqual(s2.baslat.mock.calls[0].arguments[1], {
    jump_host: 'atlama-1',
    namespace: 'ozel',
    label_selector: '',
  });
});

test('OH3d on denetim reddederse is baslatilmaz', async (t) => {
  const s = podKur(t);
  s.on.mock.mockImplementation(async () => {
    throw Object.assign(new Error('sablon extra_vars kabul etmiyor'), { status: 409 });
  });
  await assert.rejects(podStatus(4), { status: 409, message: 'sablon extra_vars kabul etmiyor' });
  assert.equal(s.baslat.mock.callCount(), 0, 'on denetimi gecemeyen is baslatildi');
});

test('OH3c pod durumu: basarisiz is ve zaman asimi 502', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const b = podKur(t, { durumlar: ['running', 'failed'] });
  await assert.rejects(ilerlet(t, podStatus(4)), {
    status: 502,
    message: 'AWX job failed (job 901).',
  });
  assert.equal(b.durum.mock.callCount(), 2, 'basarisiz biten is yoklanmaya devam etti');

  const s = podKur(t, { durumlar: ['running'] });
  await assert.rejects(ilerlet(t, podStatus(4)), {
    status: 502,
    message: 'AWX job running (job 901).',
  });
  assert.equal(s.durum.mock.callCount(), 30, 'yoklama 30 denemede durmadi');
});
