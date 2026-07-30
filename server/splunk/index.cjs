// server/splunk/index.cjs — Splunk REST API proxy route'lari
//
// server/dynatrace/index.cjs'in requireAuth + cache desenini birebir takip eder.
// KPI hesaplama (rps/latency/P95) YOK — ham event sayisi + ornek satirlar doner
// (bilinmeyen gercek log alan formatina dayali KPI hesaplamasi bu sprintte spekulatif olurdu).
'use strict';

const { isConfigured, checkReachable, listProducts, search } = require('./client.cjs');
const cache = require('../dynatrace/cache.cjs'); // jenerik TTL cache, Dynatrace'e ozgu hicbir sey yok

const SEARCH_TTL = 5 * 60 * 1000; // 5 dakika

function initSplunk(app) {
  let requireAuth = (req, res, next) => next();
  try {
    const { requireAuth: ra } = require('../auth/index.cjs');
    if (typeof ra === 'function') requireAuth = ra;
  } catch { /* auth modulu yoksa passthrough */ }

  // Splunk, Performance sayfasinin bir alt-tab'idir — Performance gizliyse gercek 403. /health muaf.
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    app.use('/api/splunk', requireVisiblePrefix('Performance', { exempt: ['/health'] }));
  } catch { /* motor yoksa yoksay */ }

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/api/splunk/health', requireAuth, async (req, res) => {
    const configured = isConfigured();
    const reachable = configured ? await checkReachable() : false;
    res.json({
      ok: true,
      configured,
      reachable,
      message: configured
        ? (reachable ? undefined : 'Splunk sunucusuna ulaşılamıyor (ağ/VPN erişimi gerekli olabilir).')
        : 'SPLUNK_BASE_URL/SPLUNK_TOKEN tanımlı değil — Splunk entegrasyonu devre dışı.',
    });
  });

  // ── Urun listesi (config'ten) ─────────────────────────────────────────────
  app.get('/api/splunk/products', requireAuth, (req, res) => {
    res.json({ ok: true, products: listProducts() });
  });

  // ── Arama (sabit urun+zaman araligi, serbest SPL yok) ─────────────────────
  app.get('/api/splunk/search', requireAuth, async (req, res) => {
    const { product, windowMinutes, refresh } = req.query;
    if (!product) return res.status(400).json({ ok: false, message: 'product query param zorunlu.' });

    const cacheKey = `splunk-${product}-${windowMinutes || 15}`;
    if (refresh !== '1') {
      const cached = cache.get(cacheKey, SEARCH_TTL);
      if (cached) return res.json({ ok: true, source: 'cache', ...cached });
    }

    try {
      const result = await search({ product: String(product), windowMinutes: Number(windowMinutes) || 15 });
      cache.set(cacheKey, result);
      res.json({ ok: true, source: 'live', ...result });
    } catch (err) {
      console.error('[Splunk] search hatasi:', err.message);
      res.status(502).json({ ok: false, message: err.message });
    }
  });
}

module.exports = { initSplunk };
