// server/kibana/index.cjs — Kibana health route (Artim 2)
'use strict';

const { isConfigured, checkReachable } = require('./client.cjs');

function initKibana(app) {
  let requireAuth = (req, res, next) => next();
  try {
    const { requireAuth: ra } = require('../auth/index.cjs');
    if (typeof ra === 'function') requireAuth = ra;
  } catch { /* auth modulu yoksa passthrough */ }

  app.get('/api/kibana/health', requireAuth, async (req, res) => {
    const configured = isConfigured();
    const reachable = configured ? await checkReachable() : false;
    res.json({
      ok: true,
      configured,
      reachable,
      message: configured
        ? (reachable ? undefined : 'Kibana sunucusuna ulaşılamıyor (ağ/VPN erişimi gerekli olabilir).')
        : 'KIBANA_BASE_URL tanımlı değil — Kibana entegrasyonu devre dışı.',
    });
  });
}

module.exports = { initKibana };
