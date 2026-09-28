// server/oco/index.cjs — OCO Takvimi uçları.
//
// Kullanıcı (2026-09-28): "Ekibime ait production operational change order'ları listeleyen
// bir endpoint göndereceğim. Portal'da solda 'OCO Takvimi' diye bir sekme oluştur ve
// buradaki OCO'ları tarihlere ve başlığa işleyerek kronolojik listele."
//
// SALT OKUNUR: bu modül OCO açmaz, kapatmaz, güncellemez — yalnızca listeler. (Zamanlanmış
// tetikleme ve OCO penceresi denetimi ayrı yerlerde: oco/poller.cjs, oco/window.cjs.)
//
// ÖNBELLEK: arama ucu her çağrıda tüm sayfaları gezer. Ekran her açıldığında bunu yapmak
// hem yavaş hem de kurumsal servise gereksiz yük. 60 saniyelik önbellek, "az önce açtım"
// ile "şimdi tazeledim" arasındaki farkı kullanıcıya bırakır (Yenile düğmesi önbelleği
// atlar).
'use strict';

const express = require('express');

const TTL_MS = 60 * 1000;
let _cache = { at: 0, key: '', value: null };

function initOco(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use(requireAuth);

  try {
    const { requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisible('OcoTakvimi'));
  } catch {
    /* gorunurluk motoru yoksa yoksay */
  }

  router.get('/calendar', async (req, res) => {
    const { isConfigured, getConfig } = require('./config.cjs');
    if (!isConfigured()) {
      // "YAPILANDIRILMAMIS" ile "OCO YOK" AYRI: boş bir liste döndürmek, ekipte hiç
      // değişiklik yokmuş gibi okunurdu.
      return res.status(503).json({
        ok: false,
        notConfigured: true,
        message: 'OCO servisi yapılandırılmamış (Admin > Sistem > OCO_API_URL).',
      });
    }

    const grup = String(req.query.group || getConfig().searchGroupId || '').trim();
    const taze = String(req.query.refresh || '') === '1';
    const key = `g:${grup}`;
    if (!taze && _cache.value && _cache.key === key && Date.now() - _cache.at < TTL_MS) {
      return res.json({ ..._cache.value, cached: true });
    }

    try {
      const { searchChangeOrders } = require('./search.cjs');
      const r = await searchChangeOrders({ groupId: grup });
      const value = {
        ok: true,
        group: grup,
        rows: r.rows,
        total: r.total,
        fetched: r.fetched,
        // SESSIZ KIRPMA YOK: sayfa sınırına takıldıysak ekran bunu söyler.
        truncated: r.truncated,
        fetchedAt: new Date().toISOString(),
      };
      _cache = { at: Date.now(), key, value };
      res.json({ ...value, cached: false });
    } catch (err) {
      res.status(err.status || 502).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/oco', router);
  console.log('[OCO] module mounted at /api/oco');
}

module.exports = { initOco };
