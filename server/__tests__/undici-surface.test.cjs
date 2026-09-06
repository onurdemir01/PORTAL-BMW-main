// server/__tests__/undici-surface.test.cjs — undici API YUZEYI DUMAN TESTI.
//
// NEDEN VAR: portalin AWX/Smart/OCO/MCP cagrilarinin TAMAMI undici uzerinden gidiyor
// ama testlerin hepsi HTTP'yi mock'luyor — yani bir surum yukseltmesinin kirilmasi
// ancak URETIMDE gorunurdu. Bu dosya, kodun GERCEKTEN kullandigi dar yuzeyi yerel bir
// HTTP sunucusuna karsi calistirir: yukseltmeden ONCE yesil olmasi testin gecerli
// oldugunu, SONRA yesil kalmasi yukseltmenin bu yuzeyi bozmadigini kanitlar.
//
// KULLANILAN YUZEY (kaynaktan cikarildi, tahmin degil):
//   Agent({ connect })            — server/oco/client.cjs, smart/client.cjs, mcp/client.cjs
//   ProxyAgent({ uri, requestTls })— ayni uc dosya
//   request()                     — server/oco/client.cjs
//   fetch                         — server/mcp/client.cjs
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const undici = require('undici');

function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', async () => {
      const { port } = srv.address();
      try {
        await fn(`http://127.0.0.1:${port}`);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        srv.close();
      }
    });
  });
}

test('UN1 kullanilan disa aktarimlar VAR (Agent, ProxyAgent, request, fetch)', () => {
  for (const name of ['Agent', 'ProxyAgent', 'request', 'fetch']) {
    assert.equal(typeof undici[name], 'function', `undici.${name} yok ya da fonksiyon degil`);
  }
});

test('UN2 `Agent({ connect })` kurulabiliyor ve GERCEK istekte calisiyor', async () => {
  // `connect` icine TLS secenekleri konuyor (ca, rejectUnauthorized). Duz HTTP'de
  // bunlar yok sayilir; olculen sey secenegin KABUL EDILMESI ve istegin gecmesi.
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    },
    async (base) => {
      const agent = new undici.Agent({ connect: { rejectUnauthorized: false } });
      const r = await undici.request(`${base}/deneme`, { dispatcher: agent });
      assert.equal(r.statusCode, 200);
      const body = await r.body.json();
      assert.deepEqual(body, { ok: true, path: '/deneme' });
      await agent.close();
    },
  );
});

test('UN3 `ProxyAgent({ uri, requestTls })` kurulabiliyor', () => {
  // Proxy'ye gercekten baglanmiyoruz (kurumsal proxy testte yok); olculen sey
  // YAPICININ bu secenek adlarini kabul etmesi — v7'de `requestTls` yeniden
  // adlandirilsaydi kurulum burada patlardi.
  const agent = new undici.ProxyAgent({
    uri: 'http://127.0.0.1:1',
    requestTls: { rejectUnauthorized: false },
  });
  assert.ok(agent, 'ProxyAgent kurulamadi');
  assert.equal(typeof agent.close, 'function');
  agent.close().catch(() => {});
});

test('UN4 `fetch` dispatcher secenegiyle calisiyor (MCP yolu)', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ mcp: true }));
    },
    async (base) => {
      const agent = new undici.Agent({ connect: { rejectUnauthorized: false } });
      const res = await undici.fetch(`${base}/mcp`, { dispatcher: agent });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { mcp: true });
      await agent.close();
    },
  );
});

test('UN5 HTTP hata kodu ISTISNA FIRLATMAZ (kod `statusCode`a bakiyor)', async () => {
  // `server/oco/client.cjs` yanit kodunu kendisi denetliyor; undici'nin 4xx/5xx'te
  // throw etmeye baslamasi o mantigi sessizce atlatirdi.
  await withServer(
    (req, res) => {
      res.writeHead(503);
      res.end('yok');
    },
    async (base) => {
      const r = await undici.request(`${base}/hata`);
      assert.equal(r.statusCode, 503, 'hata kodu istisnaya donusmus olabilir');
      await r.body.text();
    },
  );
});

test('UN6 bildirilen surum ile KURULU surum ayni ana surumde', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const declared = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies
    .undici;
  const installed = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'node_modules', 'undici', 'package.json'), 'utf8'),
  ).version;
  const major = (v) =>
    String(v)
      .replace(/^[^0-9]*/, '')
      .split('.')[0];
  assert.equal(
    major(declared),
    major(installed),
    `package.json ${declared} diyor, kurulu ${installed} — ana surum ayrismis`,
  );
});
