'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { _probeClusterApiVersion: probe } = require('../runner.cjs');

function fakeHttp({ statusCode = 200, body = '', destroyError = null } = {}) {
  let destroyed = false;
  const req = new EventEmitter();
  req.end = () => {};
  req.destroy = () => {
    destroyed = true;
    if (destroyError) req.emit('error', destroyError);
  };
  return {
    lib: {
      request(_options, onResponse) {
        queueMicrotask(() => {
          const res = new PassThrough();
          res.statusCode = statusCode;
          onResponse(res);
          res.end(body);
        });
        return req;
      },
    },
    wasDestroyed: () => destroyed,
  };
}

test('OCP probe kucuk 2xx/401/403/500 sozlesmesini korur', async () => {
  for (const [statusCode, body, expected] of [
    [200, '{"gitVersion":"v1"}', { ok: true }],
    [401, 'unauthorized', { ok: false, message: 'Erişilebilir ama kimlik doğrulama başarısız (HTTP 401).' }],
    [403, 'forbidden', { ok: false, message: 'Erişilebilir ama kimlik doğrulama başarısız (HTTP 403).' }],
    [500, 'boom', { ok: false, message: 'HTTP 500: boom' }],
  ]) {
    const fake = fakeHttp({ statusCode, body });
    const actual = await probe({ apiUrl: 'http://cluster.test', token: 't' }, { httpLib: fake.lib });
    assert.deepEqual(actual, expected);
  }
});

test('OCP probe buyuk govdeyi kapatir ve destroy error limit nedenini ezmez', async () => {
  const fake = fakeHttp({
    statusCode: 500,
    body: Buffer.alloc(320 * 1024, 0x78),
    destroyError: new Error('sentetik destroy error'),
  });
  const result = await Promise.race([
    probe({ apiUrl: 'http://cluster.test' }, { httpLib: fake.lib }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('probe askida kaldi')), 1000)),
  ]);

  assert.equal(result.ok, false);
  assert.match(result.message, /yanıt çok büyük \(> 256 KB\)/);
  assert.equal(fake.wasDestroyed(), true, 'limit asiminda upstream request kapanmadi');
});

test('OCP connection route auth ve admin sirasi ile davranis helperini kullanir', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  const start = src.indexOf("'/api/ansible/clusters/:id/test-connection'");
  const end = src.indexOf("'/api/ansible/clusters/:id/pod-status'", start);
  const route = src.slice(start, end);

  assert.ok(start >= 0 && end > start, 'connection route siniri bulunamadi');
  assert.match(route, /test-connection',\s*requireAuth,\s*requireAdmin,\s*async/s);
  assert.match(route, /await probeClusterApiVersion\(cluster\)/);
});
