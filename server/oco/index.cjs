// server/oco/index.cjs — OCO Takvimi uclari.
//
// Kullanici (2026-09-28): "Ekibime ait production operational change order'lari listeleyen
// bir endpoint gonderecegim. Portal'da solda 'OCO Takvimi' diye bir sekme olustur ve
// buradaki OCO'lari tarihlere ve basliga isleyerek kronolojik listele."
//
// SALT OKUNUR: bu modul OCO acmaz, kapatmaz, guncellemez — yalnizca listeler. (Zamanlanmis
// tetikleme ve OCO penceresi denetimi ayri yerlerde: oco/poller.cjs, oco/window.cjs.)
// ISTISNA (2026-11-17): /manuel uclari yalniz Portal DB'deki elle eklenen olaylara yazar
// (oco/manuel.cjs); kurumsal OCO servisine yine HIC yazilmaz.
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
      // "YAPILANDIRILMAMIS" ile "OCO YOK" AYRI: bos bir liste dondurmek, ekipte hic
      // degisiklik yokmus gibi okunurdu.
      //
      // HTTP KODU 400: anlam olarak 503 ama TELDEN 503 GECMEZ. Portal nginx arkasinda
      // `proxy_intercept_errors on` ile calisiyor ve 403/404/500/502/503/504 cevaplarinin
      // GOVDESINI kendi HTML sayfasiyla degistiriyor — yani asagidaki mesaj kullaniciya
      // hic ulasmaz, ekranda ham HTML gorunurdu (bkz. oco/client.cjs httpStatus).
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
      // 502/503 govdesini nginx yutardi; anlam err.status'ta kalir, tel uzerinde 400'e cevrilir.
      res.status(httpStatus(err)).json({ ok: false, message: err.message });
    }
  });

  initManuelUclari(router);

  app.use('/api/oco', router);
  console.log('[OCO] module mounted at /api/oco');
}

// ── Elle eklenen olaylar (2026-11-17, server/oco/manuel.cjs) ─────────────────────────
// Servis listesinden AYRI uc: /calendar onbellegine girmez (yazinca hemen gorunsun) ve OCO
// servisi yapilandirilmamis olsa da calisir. Gorunurluk router'in OcoTakvimi kuralindan gelir.
// Bu fonksiyon initOco ALTINDA: route-auth-order bekcisi (RO1) metin sirasina bakar; uclar
// kimlik kapisindan (router.use(requireAuth)) sonra kurulur ve dosyada da sonra yazilir.
// 403/404 nginx'te govdesi yutuldugu icin telden httpStatus ile gider (bkz. client.cjs).
function initManuelUclari(router, { db: dbVerilen, kullanici: kullaniciVerilen, denetim } = {}) {
  const mo = require('./manuel.cjs');
  const db = () => dbVerilen || require('../db/index.cjs');
  const kim = (req) =>
    (kullaniciVerilen || require('../auth/index.cjs').getRequestUser)(req) || null;
  const iz = (req, action, detail) => {
    try {
      (denetim || require('../audit/index.cjs').auditPortal)(req, action, {
        result: 'ok',
        detail: JSON.stringify(detail),
      });
    } catch {
      /* denetim kaydi dusse de islem sonucu degismez */
    }
  };
  const hata = (res, status, message, ek = {}) =>
    res.status(httpStatus({ status })).json({ ok: false, message, ...ek });
  const disaVer = (o, u) => ({ ...o, duzenleyebilir: mo.yetkili(o, u) });

  router.get('/manuel', async (req, res) => {
    try {
      const u = kim(req);
      const { olaylar, kirpildi } = await mo.listele(db());
      res.json({ ok: true, olaylar: olaylar.map((o) => disaVer(o, u)), kirpildi });
    } catch (err) {
      hata(res, 503, `Elle eklenen olaylar okunamadı: ${err.message}`);
    }
  });

  router.post('/manuel', async (req, res) => {
    const u = kim(req);
    const v = mo.dogrula(req.body || {});
    if (v.hata) return hata(res, 400, v.hata);
    try {
      const o = await mo.ekle(db(), v, u?.username || null);
      iz(req, 'oco_manuel_ekle', { id: o?.id, ocoNo: v.ocoNo, baslik: v.baslik });
      res.json({ ok: true, olay: o ? disaVer(o, u) : null });
    } catch (err) {
      hata(res, 503, `Olay kaydedilemedi: ${err.message}`);
    }
  });

  // Ortak on kontrol: id gecerli, kayit var, kullanici yetkili. Yanit verildiyse null doner.
  async function yetkiliKayit(req, res) {
    const id = mo.idCoz(req.params.id);
    if (!id) {
      hata(res, 400, 'Geçersiz olay kimliği.');
      return null;
    }
    const mevcut = await mo.getir(db(), id);
    if (!mevcut) {
      hata(res, 404, 'Olay bulunamadı (silinmiş olabilir).', { yok: true });
      return null;
    }
    const u = kim(req);
    if (!mo.yetkili(mevcut, u)) {
      hata(res, 403, 'Bu olayı yalnız ekleyen kişi ya da yönetici değiştirebilir.', {
        yetkisiz: true,
      });
      return null;
    }
    return { id, mevcut, u };
  }

  router.put('/manuel/:id', async (req, res) => {
    const v = mo.dogrula(req.body || {});
    if (v.hata) return hata(res, 400, v.hata);
    try {
      const k = await yetkiliKayit(req, res);
      if (!k) return;
      const o = await mo.guncelle(db(), k.id, v, k.u?.username || null);
      if (!o) return hata(res, 404, 'Olay bulunamadı (silinmiş olabilir).', { yok: true });
      iz(req, 'oco_manuel_guncelle', { id: k.id, ocoNo: v.ocoNo, baslik: v.baslik });
      res.json({ ok: true, olay: disaVer(o, k.u) });
    } catch (err) {
      hata(res, 503, `Olay güncellenemedi: ${err.message}`);
    }
  });

  router.delete('/manuel/:id', async (req, res) => {
    try {
      const k = await yetkiliKayit(req, res);
      if (!k) return;
      await mo.sil(db(), k.id);
      iz(req, 'oco_manuel_sil', { id: k.id, ocoNo: k.mevcut.ocoNo, baslik: k.mevcut.baslik });
      res.json({ ok: true, id: k.id });
    } catch (err) {
      hata(res, 503, `Olay silinemedi: ${err.message}`);
    }
  });
}

module.exports = { initOco, initManuelUclari, _onbellek };
