// server/crypto-hub/__tests__/_ortak_harness.cjs - Crypto Hub test duzeneklerinin (_kaynak_harness, _node_harness)
// ORTAK parcalari (2026-11-24; iki duzenekte kopyaydi): sahte oturum kapilari ve gercek HTTP istemcisi.
'use strict';

const http = require('node:http');

/** Sahte auth/index.cjs: kullanici x-test-user basligindan (JSON); yoksa 401. Admin kapisi rolden (403). */
function sahteAuth() {
  return {
    requireAuth(req, res, next) {
      const h = req.headers['x-test-user'];
      if (!h) return res.status(401).json({ ok: false });
      req.session = { user: JSON.parse(h) };
      next();
    },
    requireAdmin(req, res, next) {
      if (!(req.session?.user?.role === 'Admin')) {
        return res.status(403).json({ ok: false });
      }
      next();
    },
  };
}

/**
 * Yerel sunucuya (127.0.0.1:port) /api/crypto-hub istegi. Donus: { status, body } (JSON degilse { ham }).
 * user verilirse x-test-user basligi olarak gider.
 */
function istekci(port) {
  return function istek(method, url, user, body) {
    return new Promise((resolve, reject) => {
      const veri = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: `/api/crypto-hub${url}`,
          method,
          headers: {
            'content-type': 'application/json',
            ...(user ? { 'x-test-user': JSON.stringify(user) } : {}),
            ...(veri ? { 'content-length': Buffer.byteLength(veri) } : {}),
          },
        },
        (res) => {
          let s = '';
          res.on('data', (c) => (s += c));
          res.on('end', () => {
            let j = null;
            try {
              j = JSON.parse(s);
            } catch {
              j = { ham: s };
            }
            resolve({ status: res.statusCode, body: j });
          });
        },
      );
      req.on('error', reject);
      if (veri) req.write(veri);
      req.end();
    });
  };
}

module.exports = { sahteAuth, istekci };
