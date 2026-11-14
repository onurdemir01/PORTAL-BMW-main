// server/util/guvenlik-yardimci.cjs
// Pure security helpers for server/index.cjs:
//   - TRUST_PROXY env resolution (removes hardcoded prod IPs from source code)
//   - Global Express error response builder with correlationId (suppresses err.message in prod)
'use strict';

const crypto = require('node:crypto');

/**
 * Resolves Express `trust proxy` configuration from environment string.
 * Supports booleans (`true`/`false`), non-negative integer hop counts (`1`, `2`),
 * or comma-separated proxy IP/subnet/loopback tokens. Defaults safely to `'loopback'`.
 */
function resolveTrustProxy(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'loopback';
  const low = s.toLowerCase();
  if (low === 'true') return true;
  if (low === 'false') return false;
  if (/^\d+$/.test(s)) {
    const hops = Number(s);
    if (Number.isInteger(hops) && hops >= 0 && hops <= 16) return hops;
  }
  const tokens = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!tokens.length) return 'loopback';
  return tokens.length === 1 ? tokens[0] : tokens.join(', ');
}

/**
 * Formats JSON payload for global uncaught Express errors.
 * In production mode (`isProd === true`), omits `detail` so internal `err.message`
 * or DB/host paths are never disclosed to the client; returns a `correlationId` instead.
 */
function formatGlobalError(err, opts = {}) {
  const isProd =
    typeof opts.isProd === 'boolean' ? opts.isProd : process.env.NODE_ENV === 'production';
  const correlationId = opts.correlationId || crypto.randomUUID();
  const status = Number(err && err.status) || 500;
  const body = {
    ok: false,
    error: 'Sunucu hatas\u0131',
    correlationId,
  };
  if (!isProd && err && err.message) {
    body.detail = String(err.message);
  }
  return { status, body, correlationId };
}

function globalErrorMiddleware(opts = {}) {
  return function bmwGlobalErrorMw(err, req, res, next) {
    const { status, body, correlationId } = formatGlobalError(err, opts);
    console.error(`[Server] [${correlationId}] ${req.method} ${req.originalUrl} hata:`, err);
    if (res.headersSent) return next(err);
    return res.status(status).json(body);
  };
}

module.exports = {
  resolveTrustProxy,
  formatGlobalError,
  globalErrorMiddleware,
};
