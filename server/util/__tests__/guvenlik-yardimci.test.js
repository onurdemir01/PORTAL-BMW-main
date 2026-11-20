// server/util/__tests__/guvenlik-yardimci.test.js
//
// Security hardening tests for partner tasks (TASK-005 / TASK-006):
//   GY1 resolveTrustProxy handles defaults, booleans, integer hops, and proxy IP lists
//   GY2 formatGlobalError returns correlationId and omits err.message in production
//   GY3 server/index.cjs removes hardcoded internal proxy IP & delegates error middleware
//   GY4 sessionOrIpKey ignores spoofed x-portal-user unless trusted header auth verifies it
//   GY5 /api/nobetci/today/avatar returns Cache-Control: private, max-age=300
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const ROOT = path.join(__dirname, '..', '..', '..');
const {
  resolveTrustProxy,
  formatGlobalError,
  globalErrorMiddleware,
} = require('../guvenlik-yardimci.cjs');

function listenTemp(app) {
  const srv = http.createServer(app);
  srv.listen(0, '127.0.0.1');
  return new Promise((resolve) => {
    srv.on('listening', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('GY1 resolveTrustProxy varsayilan, boolean, hop sayisi ve proxy listesi', () => {
  // Tanimsiz: gelistirmede 'loopback', uretimde tek atlama (GY6 / GY7 nedenini sinar).
  for (const bos of [undefined, '', '   ', ' , ']) {
    assert.equal(resolveTrustProxy(bos, { isProd: false }), 'loopback');
    assert.equal(resolveTrustProxy(bos, { isProd: true }), 1);
  }
  assert.equal(resolveTrustProxy('loopback', { isProd: true }), 'loopback', 'acik deger aynen');
  assert.equal(resolveTrustProxy('true'), true);
  assert.equal(resolveTrustProxy('false'), false);
  assert.equal(resolveTrustProxy('1'), 1);
  assert.equal(resolveTrustProxy('2'), 2);
  assert.equal(resolveTrustProxy('loopback, 10.0.0.10'), 'loopback, 10.0.0.10');
});

test('GY2 formatGlobalError production ortaminda ic hata ayrintisini gizler', () => {
  const err = new Error('MSSQL login failed for user sa on 10.1.2.3');
  err.status = 502;
  const prod = formatGlobalError(err, { isProd: true, correlationId: 'corr-prod-1' });
  assert.equal(prod.status, 502);
  assert.deepEqual(prod.body, {
    ok: false,
    error: 'Sunucu hatas\u0131',
    correlationId: 'corr-prod-1',
  });
  assert.equal(prod.body.detail, undefined);

  const dev = formatGlobalError(err, { isProd: false, correlationId: 'corr-dev-1' });
  assert.equal(dev.status, 502);
  assert.equal(dev.body.correlationId, 'corr-dev-1');
  assert.match(dev.body.detail, /MSSQL/);
});

test('GY2b globalErrorMiddleware Express yanitinda correlationId doner', async () => {
  const app = express();
  app.get('/boom', (_req, _res, next) => next(new Error('secret-stack-info')));
  app.use(globalErrorMiddleware({ isProd: true }));
  const { srv, url } = await listenTemp(app);
  try {
    const r = await fetch(`${url}/boom`);
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.equal(body.detail, undefined);
    assert.ok(typeof body.correlationId === 'string' && body.correlationId.length >= 16);
  } finally {
    srv.close();
  }
});

test('GY3 server/index.cjs sabit proxy IP icermez ve yardimci modulu kullanir', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.cjs'), 'utf8');
  assert.doesNotMatch(src, /'trust proxy',\s*'loopback,\s*\d+\./);
  assert.match(src, /resolveTrustProxy\(process\.env\.TRUST_PROXY\)/);
  assert.match(src, /globalErrorMiddleware\(/);
});

test('GY4 sessionOrIpKey sahte x-portal-user basligini yoksayar', () => {
  const { sessionOrIpKey } = require('../../service.cjs');
  const prevSecret = process.env.PORTAL_TRUSTED_HEADER_SECRET;
  const prevUsers = process.env.PORTAL_TRUSTED_HEADER_ALLOWED_USERS;
  try {
    delete process.env.PORTAL_TRUSTED_HEADER_SECRET;
    delete process.env.PORTAL_TRUSTED_HEADER_ALLOWED_USERS;
    const keySpoof = sessionOrIpKey({
      headers: { 'x-portal-user': 'victim-admin' },
      ip: '127.0.0.10',
    });
    assert.equal(keySpoof, '127.0.0.10');

    process.env.PORTAL_TRUSTED_HEADER_SECRET = 'top-secret-header-token';
    process.env.PORTAL_TRUSTED_HEADER_ALLOWED_USERS = 'svc-bot';
    const keyTrusted = sessionOrIpKey({
      headers: {
        'x-portal-auth-secret': 'top-secret-header-token',
        'x-portal-user': 'svc-bot',
      },
      ip: '127.0.0.11',
    });
    assert.equal(keyTrusted, 'usr:svc-bot');
  } finally {
    if (prevSecret === undefined) delete process.env.PORTAL_TRUSTED_HEADER_SECRET;
    else process.env.PORTAL_TRUSTED_HEADER_SECRET = prevSecret;
    if (prevUsers === undefined) delete process.env.PORTAL_TRUSTED_HEADER_ALLOWED_USERS;
    else process.env.PORTAL_TRUSTED_HEADER_ALLOWED_USERS = prevUsers;
  }
});

test('GY5 /api/nobetci/today/avatar Cache-Control private olarak doner', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'nobetci', 'index.cjs'), 'utf8');
  const idx = src.indexOf('app.get("/api/nobetci/today/avatar"');
  assert.ok(idx > -1, '/api/nobetci/today/avatar route bulunamadi');
  const snippet = src.slice(idx, idx + 450);
  assert.match(snippet, /private,\s*max-age=300/);
  assert.doesNotMatch(snippet, /public,\s*max-age=300/);
});

// 2026-11-14 gerilemesi: varsayilan 'loopback' yapilmisti. Uretimde nginx Node'a makinenin
// loopback OLMAYAN adresinden baglanir; o baglanti guvenilmeyince X-Forwarded-Proto yok
// sayilir, `req.secure` false kalir ve express-session (cookie.secure) cerezi HIC vermez.
const VEKIL_ADRESI = '192.0.2.10'; // RFC 5737 belge adresi: loopback degil

/** Verilen `trust proxy` degeriyle, vekilden (loopback olmayan adres) gelen HTTPS istegi. */
async function vekildenIstek(trustProxy) {
  const session = require('express-session');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  // Baglantinin karsi ucu vekil adresiymis gibi (gercek soket loopback'ten gelir).
  app.use((req, _res, next) => {
    Object.defineProperty(req.socket, 'remoteAddress', { value: VEKIL_ADRESI, configurable: true });
    next();
  });
  app.use(
    session({
      secret: 'deneme-sirri',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: true },
    }),
  );
  app.get('/giris', (req, res) => {
    req.session.user = { username: 'deneme' };
    res.json({ secure: req.secure, ip: req.ip });
  });
  const { srv, url } = await listenTemp(app);
  try {
    const r = await fetch(`${url}/giris`, {
      headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.7' },
    });
    return { govde: await r.json(), cerez: r.headers.get('set-cookie') };
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
}

test('GY6 uretim varsayilaniyla vekil arkasinda oturum cerezi VERILIR ve istemci IP`si dogru', async () => {
  const uretim = await vekildenIstek(resolveTrustProxy(undefined, { isProd: true }));
  assert.equal(uretim.govde.secure, true, 'X-Forwarded-Proto guvenilmedi');
  assert.match(String(uretim.cerez), /connect\.sid=.*Secure/i, 'oturum cerezi verilmedi');
  assert.equal(uretim.govde.ip, '198.51.100.7', 'istemci IP`si vekil adresine cokmus');
  // Gerilemenin kendisi: yalniz 'loopback' guvenilirse cerez YOK (bu yuzden varsayilan olamaz).
  const yalnizLoopback = await vekildenIstek('loopback');
  assert.equal(yalnizLoopback.govde.secure, false);
  assert.equal(yalnizLoopback.cerez, null);
  assert.equal(yalnizLoopback.govde.ip, VEKIL_ADRESI);
  // Adres sabitlenmis yapilandirma (onerilen) da calisir.
  const sabit = await vekildenIstek(
    resolveTrustProxy(`loopback, ${VEKIL_ADRESI}`, { isProd: true }),
  );
  assert.equal(sabit.govde.secure, true);
  assert.match(String(sabit.cerez), /connect\.sid=/);
});

test('GY7 tek atlama yalniz dogrudan baglanan vekile guvenir; zincirin gerisi sahtelenemez', () => {
  const app = express();
  app.set('trust proxy', resolveTrustProxy(undefined, { isProd: true }));
  const guven = app.get('trust proxy fn');
  assert.equal(guven(VEKIL_ADRESI, 0), true, 'dogrudan baglanan vekil');
  assert.equal(
    guven('198.51.100.7', 1),
    false,
    'ikinci atlama (istemcinin yazdigi baslik) guvenilmez',
  );
  // Gelistirme varsayilani: yalniz loopback.
  const gel = express();
  gel.set('trust proxy', resolveTrustProxy(undefined, { isProd: false }));
  assert.equal(gel.get('trust proxy fn')('127.0.0.1', 0), true);
  assert.equal(gel.get('trust proxy fn')(VEKIL_ADRESI, 0), false);
  // server/index.cjs yardimciyi ortam degiskeniyle cagirir ve tanimsiz uretimde uyarir.
  const idx = fs.readFileSync(path.join(ROOT, 'server', 'index.cjs'), 'utf8');
  assert.match(idx, /app\.set\('trust proxy', resolveTrustProxy\(process\.env\.TRUST_PROXY\)\);/);
  assert.match(idx, /\[Guvenlik\] TRUST_PROXY tanimli degil/);
});
