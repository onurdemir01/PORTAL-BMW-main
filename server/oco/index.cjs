// server/oco/index.cjs — OCO Takvimi uçları.
//
// Kullanıcı (2026-09-28): "Ekibime ait production operational change order'ları listeleyen
// bir endpoint göndereceğim. Portal'da solda 'OCO Takvimi' diye bir sekme oluştur ve
// buradaki OCO'ları tarihlere ve başlığa işleyerek kronolojik listele."
//
// SALT OKUNUR: bu modül OCO açmaz, kapatmaz, güncellemez — yalnızca listeler. (Zamanlanmış
// tetikleme ve OCO penceresi denetimi ayrı yerlerde: oco/poller.cjs, oco/window.cjs.)
//
// ONBELLEK (2026-11-13): arama ucu her cagrida tum sayfalari gezer (3-4 sn). Onbellek
// takvim-onbellek.cjs'te: 5 dk taze, 60 dk'ya kadar bayat deger ANINDA doner ve arka planda
// tek yenileme baslar; ucustaki cekim paylasilir; hata onceki iyi degeri silmez. Yenile
// dugmesi (refresh=1) taze cekimi bekler. Server-Timing basligi sureyi ve hit/stale/miss'i
// tarayiciya soyler (uretimde olcum icin).
'use strict';

const express = require('express');
const { httpStatus } = require('./client.cjs');
const { createTakvimOnbellek } = require('./takvim-onbellek.cjs');

async function grubuCek(grup) {
  const { searchChangeOrders } = require('./search.cjs');
  const r = await searchChangeOrders({ groupId: grup });
  return {
    ok: true,
    group: grup,
    rows: r.rows,
    total: r.total,
    fetched: r.fetched,
    // SESSIZ KIRPMA YOK: sayfa sinirina takildiysak ekran bunu soyler.
    truncated: r.truncated,
    // Iki sorgu (actigimiz + bize acilan): biri dustuyse ekran bunu soyler.
    kaynak: r.kaynak,
    eksik: r.eksik,
    fetchedAt: new Date().toISOString(),
  };
}

const _onbellek = createTakvimOnbellek({ fetch: grubuCek });

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
      //
      // HTTP KODU 400: anlam olarak 503 ama TELDEN 503 GEÇMEZ. Portal nginx arkasında
      // `proxy_intercept_errors on` ile çalışıyor ve 403/404/500/502/503/504 cevaplarının
      // GÖVDESİNİ kendi HTML sayfasıyla değiştiriyor — yani aşağıdaki mesaj kullanıcıya
      // hiç ulaşmaz, ekranda ham HTML görünürdü (bkz. oco/client.cjs httpStatus).
      return res.status(httpStatus({ status: 503 })).json({
        ok: false,
        notConfigured: true,
        message: 'OCO servisi yapılandırılmamış (Admin > Sistem > OCO_API_URL).',
      });
    }

    const varsayilanGrup = String(getConfig().searchGroupId || '').trim();
    const grup = String(req.query.group || varsayilanGrup || '').trim();
    const taze = String(req.query.refresh || '') === '1';
    const t0 = Date.now();

    try {
      const { value, cache } = await _onbellek.get({ group: grup, refresh: taze });
      // Ilk istekten sonra varsayilan grup arka planda taze tutulur (yalniz bir kez kurulur).
      _onbellek.isit({ group: varsayilanGrup, isConfigured });
      res.setHeader('Server-Timing', `oco;dur=${Date.now() - t0}, cache;desc=${cache}`);
      res.json({ ...value, cached: cache !== 'miss', stale: cache === 'stale' });
    } catch (err) {
      // 502/503 gövdesini nginx yutardı; anlam err.status'ta kalır, tel üzerinde 400'e çevrilir.
      res.status(httpStatus(err)).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/oco', router);
  console.log('[OCO] module mounted at /api/oco');
}

module.exports = { initOco, _onbellek };
