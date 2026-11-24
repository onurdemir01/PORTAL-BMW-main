// server/ansible/__tests__/awx-sunucu-uclari.test.js - AWX saglik, sunucu listesi, sunucu yonetimi (etkin / devre
// disi) ve son isler uclari GERCEK runner.cjs ile (2026-11-24, kapsam PR-2). Sahte: AWX (HTTP), ansible_awx_servers
// tablosu (bellek ici), bagimlilik ozeti.
//   AS1 saglik: erisilebilir (surum, token), kimlik dogrulanamayan (auth_failed), kimlik bilgisi eksik; durum DB'ye yazilir
//   AS2 sunucu listesi ve yonetim listesi (bellekte olan / olmayan); yonetim okunamazsa 503
//   AS3 bagimlilik: gecersiz no 400, kayit yok 404, ozet; hata 503
//   AS4 durum: dogrulama; son etkin sunucu kapatilmaz; bitmemis is varsa / okunamayan bagimlilikta kapatilmaz;
//       kapatma bellekten de dusurur ve denetime yazar; etkinlestirme listeyi yeniden yukler
//   AS5 son isler: maestro adli sunucu tercih edilir; kimlik bilgisi eksik sunucu hatasi satirda
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const AWX = { istekler: [] };
const awx = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  AWX.istekler.push(`${req.method} ${u.pathname}`);
  const json = (kod, g) => {
    res.writeHead(kod, { 'content-type': 'application/json' });
    res.end(JSON.stringify(g));
  };
  if (u.pathname === '/api/v2/ping/') return json(200, { version: '24.6.1' });
  if (u.pathname === '/api/v2/jobs/')
    return json(200, {
      results: [
        {
          id: 701,
          name: 'Saglik',
          status: 'running',
          created: '2026-11-24T09:00:00Z',
          started: '2026-11-24T09:00:05Z',
          summary_fields: {
            created_by: { username: 'svc' },
            job_template: { id: 41, name: 'Saglik' },
          },
        },
      ],
    });
  json(401, { detail: 'Kimlik dogrulanamadi' });
});

let satirlar = [];
const DB = { yazim: [], okumaHata: false, yenidenYuklemeHata: false };
function sahte(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', '..', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
sahte('db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('FROM ansible_awx_servers')) {
      if (DB.okumaHata) throw new Error('tablo kilitli');
      if (DB.yenidenYuklemeHata && s.startsWith('SELECT * FROM ansible_awx_servers'))
        throw new Error('yeniden yukleme okunamadi');
      if (s.includes('WHERE server_no = $1'))
        return { rows: satirlar.filter((r) => r.server_no === params[0]) };
      if (s.includes('WHERE enabled = 1')) return { rows: satirlar.filter((r) => r.enabled) };
      return { rows: satirlar.map((r) => ({ ...r })) };
    }
    if (s.startsWith('UPDATE ansible_awx_servers SET enabled')) {
      const r = satirlar.find((x) => x.server_no === params[1]);
      if (r) r.enabled = params[0];
      DB.yazim.push({ s, params });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE ansible_awx_servers SET last_checked_at')) {
      DB.yazim.push({ s, params });
      return { rows: [], rowCount: 1 };
    }
    if (/COUNT\(\*\) AS n/.test(s)) return { rows: [{ n: 1 }] };
    return { rows: [], rowCount: 0 };
  },
});
const denetim = [];
sahte('audit/index.cjs', {
  auditPortal: (req, olay, ek) => denetim.push({ olay, detay: JSON.parse(ek.detail) }),
  auditLogin: () => {},
});

const uclar = {};
const app = new Proxy(
  {},
  {
    get: (_, k) =>
      k === 'use'
        ? () => {}
        : (yol, ...fn) => {
            if (typeof yol === 'string') uclar[`${String(k)} ${yol}`] = fn[fn.length - 1];
          },
  },
);
function cagir(uc, { params = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      kod: 200,
      status(n) {
        this.kod = n;
        return this;
      },
      json(g) {
        resolve({ status: this.kod, body: g });
      },
    };
    Promise.resolve(
      uclar[uc](
        { params, body, query: {}, session: { user: { username: 'adm1', role: 'Admin' } } },
        res,
      ),
    ).catch(reject);
  });
}

let runner;
let bagimlilik;
let url;
const tabanSatirlar = () => [
  {
    server_no: 1,
    name: 'AWX Ana',
    url,
    token: 'tok-1',
    enabled: 1,
    last_status: 'ok',
    last_checked_at: null,
  },
  { server_no: 2, name: 'Maestro AWX', url, username: 'svc', password: 'yanlis', enabled: 1 },
  { server_no: 3, name: 'AWX Eksik', url, enabled: 1 },
  { server_no: 4, name: 'AWX Eski', url, token: 'tok-4', enabled: 0 },
];
before(async () => {
  await new Promise((r) => awx.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${awx.address().port}`;
  satirlar = tabanSatirlar();
  const log = console.log;
  console.log = () => {};
  runner = require('../runner.cjs');
  runner.initAnsibleRunner(app);
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  console.log = log;
  bagimlilik = require('../awx-sunucu-bagimlilik.cjs');
});
after(() => {
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
  awx.close();
});
beforeEach((t) => {
  AWX.istekler = [];
  DB.yazim = [];
  DB.okumaHata = false;
  DB.yenidenYuklemeHata = false;
  denetim.length = 0;
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
});

test('AS1 saglik: erisilebilir, kimlik dogrulanamayan, kimlik bilgisi eksik', async () => {
  const r = await cagir('get /api/ansible/awx/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, 'bir sunucu calisirken genel durum ok olmali');
  assert.equal(r.body.serverCount, 3, 'devre disi sunucu listede');
  const [ana, maestro, eksik] = r.body.servers;
  assert.deepEqual(
    [ana.reachable, ana.authOk, ana.awxVersion, ana.connectionType],
    [true, true, '24.6.1', 'token'],
  );
  assert.deepEqual(
    [maestro.reachable, maestro.authOk, maestro.connectionType],
    [false, false, 'user_pass'],
  );
  assert.ok(maestro.error);
  assert.deepEqual([eksik.configured, eksik.error], [false, 'Kimlik bilgisi eksik.']);
  assert.equal(r.body.version, '24.6.1');
  const durumlar = DB.yazim
    .filter((y) => y.s.includes('last_checked_at'))
    .map((y) => [y.params[2], y.params[0]]);
  assert.deepEqual(durumlar.sort(), [
    [1, 'ok'],
    [2, 'auth_failed'],
  ]);
  assert.ok(!JSON.stringify(r.body).includes('tok-1'), 'token istemciye gitti');
});

test('AS2 sunucu listesi ve yonetim listesi', async () => {
  const s = await cagir('get /api/ansible/servers');
  assert.deepEqual(s.body.servers, [
    { id: 1, name: 'AWX Ana', configured: true },
    { id: 2, name: 'Maestro AWX', configured: true },
    { id: 3, name: 'AWX Eksik', configured: false },
  ]);
  const y = await cagir('get /api/ansible/awx-servers/yonetim');
  assert.deepEqual(
    y.body.servers.map((x) => [x.no, x.enabled, x.bellekte]),
    [
      [1, true, true],
      [2, true, true],
      [3, true, true],
      [4, false, false],
    ],
  );
  assert.ok(!JSON.stringify(y.body).includes('tok-'), 'sir yonetim listesine sizdi');
  DB.okumaHata = true;
  const h = await cagir('get /api/ansible/awx-servers/yonetim');
  assert.equal(h.status, 503);
  assert.match(h.body.message, /tablo kilitli/);
});

test('AS3 bagimlilik ozeti', async (t) => {
  const uc = 'get /api/ansible/awx-servers/:no/bagimlilik';
  assert.equal((await cagir(uc, { params: { no: '0' } })).status, 400);
  assert.equal((await cagir(uc, { params: { no: '10' } })).status, 400);
  assert.equal((await cagir(uc, { params: { no: '7' } })).status, 404);
  const ozet = t.mock.method(bagimlilik, 'bagimlilikOzeti', async () => ({
    kapatilabilir: true,
    okunamayan: [],
  }));
  const r = await cagir(uc, { params: { no: '2' } });
  assert.deepEqual(r.body, { ok: true, ozet: { kapatilabilir: true, okunamayan: [] } });
  assert.equal(ozet.mock.calls[0].arguments[0], 2);
  assert.equal(ozet.mock.calls[0].arguments[1].sunucuUrl, url);
  ozet.mock.mockImplementation(async () => {
    throw new Error('AWX yok');
  });
  assert.equal((await cagir(uc, { params: { no: '2' } })).status, 503);
});

test('AS4 durum degisikligi: korumalar, kapatma, etkinlestirme', async (t) => {
  const uc = 'post /api/ansible/awx-servers/:no/durum';
  assert.equal((await cagir(uc, { params: { no: 'x' }, body: { enabled: false } })).status, 400);
  let r = await cagir(uc, { params: { no: '2' }, body: { enabled: 'false' } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /true ya da false/);
  assert.equal((await cagir(uc, { params: { no: '8' }, body: { enabled: false } })).status, 404);

  const ozet = t.mock.method(bagimlilik, 'bagimlilikOzeti', async () => ({
    kapatilabilir: false,
    okunamayan: [],
    bekleyen: [{ tur: 'oco', id: 3 }],
  }));
  r = await cagir(uc, { params: { no: '2' }, body: { enabled: false } });
  assert.equal(r.status, 409);
  assert.equal(r.body.message, 'Önce bitmesi gereken işler var.');
  ozet.mock.mockImplementation(async () => ({ kapatilabilir: false, okunamayan: ['smart'] }));
  r = await cagir(uc, { params: { no: '2' }, body: { enabled: false } });
  assert.match(r.body.message, /okunamadı; güvenli olduğu doğrulanamadan kapatılmaz/);

  ozet.mock.mockImplementation(async () => ({ kapatilabilir: true, okunamayan: [] }));
  r = await cagir(uc, { params: { no: '2' }, body: { enabled: false } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.message, /AWX #2 \(Maestro AWX\) devre dışı bırakıldı/);
  assert.equal(satirlar.find((x) => x.server_no === 2).enabled, 0);
  assert.deepEqual(
    runner.getServers().map((x) => x.id),
    [1, 3],
    'kapatilan sunucu bellekte kaldi',
  );
  assert.deepEqual(denetim.at(-1), {
    olay: 'awx_server_durum',
    detay: { no: 2, name: 'Maestro AWX', enabled: false },
  });

  // Liste yeniden yuklenemese de kapatilan sunucu bellekten duser (yanit bunu soyler).
  satirlar.find((x) => x.server_no === 2).enabled = 1;
  await cagir(uc, { params: { no: '2' }, body: { enabled: true } });
  assert.ok(runner.getServers().some((x) => x.id === 2));
  DB.yenidenYuklemeHata = true;
  r = await cagir(uc, { params: { no: '2' }, body: { enabled: false } });
  assert.equal(r.status, 200);
  assert.equal(r.body.yuklendi, false);
  assert.match(r.body.message, /sunucu listesinin tamamı yenilenemedi/);
  assert.ok(
    !runner.getServers().some((x) => x.id === 2),
    'yeniden yukleme olmadan kapatilan sunucu bellekte kaldi',
  );
  // Etkinlestirme yuklenemezse guvenli tarafta kalir: 503.
  r = await cagir(uc, { params: { no: '2' }, body: { enabled: true } });
  assert.equal(r.status, 503);
  assert.match(r.body.message, /güvenli olarak etkinleştirilmedi/);
  DB.yenidenYuklemeHata = false;

  // Son etkin sunucu korunur.
  for (const x of satirlar) if (x.server_no !== 1) x.enabled = 0;
  r = await cagir(uc, { params: { no: '1' }, body: { enabled: false } });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /Son etkin AWX sunucusu devre dışı bırakılamaz/);

  r = await cagir(uc, { params: { no: '2' }, body: { enabled: true } });
  assert.equal(r.status, 200);
  assert.match(r.body.message, /etkinleştirildi/);
  assert.ok(runner.getServers().some((x) => x.id === 2));
  satirlar = tabanSatirlar();
});

test('AS5 son isler: maestro sunucusu tercih edilir', async () => {
  satirlar = tabanSatirlar();
  await cagir('post /api/ansible/awx-servers/:no/durum', {
    params: { no: '2' },
    body: { enabled: true },
  });
  const r = await cagir('get /api/ansible/awx/recent-jobs');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.servers.length, 1, 'maestro adli sunucu varken digerleri de soruldu');
  assert.equal(r.body.servers[0].serverName, 'Maestro AWX');
  assert.equal(r.body.servers[0].ok, false, 'kimligi dogrulanamayan sunucu basarili sayildi');
});
