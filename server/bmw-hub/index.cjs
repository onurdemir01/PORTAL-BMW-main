// server/bmw-hub/index.cjs - BMW Hub: ekibin acik isleri (2026-11-08).
//
// Kullanici: "otomasyon tasklari icin bir BMW Hub ve acik isler sayfasi olsun; is girebileyim,
// acik isleri, statulerini, deadline tarihlerini, isi kimin sahiplendigini goreyim. Sadece
// adminler goruntulesin. Talebi acanin ismi de gozuksun."
//
// YETKI: her uc Admin ister (requireAdmin). Sayfa gorunurlugu (BmwHub, roles Admin) ekrani
// gizler; burasi VERIYI korur - bir gorunurluk kurali sayfayi bir kullaniciya acsa bile veri
// yalniz Admin'e doner.
//
// KIM ACTI: istemciden gelen ad KULLANILMAZ; acan / not yazan / guncelleyen her zaman
// oturumdaki kullanicidir (aksi halde baskasi adina is acilabilirdi).
//
// GECMIS: olusturma ve durum / sahip / son tarih / oncelik degisimi bmw_hub_notlar'a otomatik
// satir yazar. "Kim ne zaman tamamladi" sorusu boylece kayitsiz kalmaz.
'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db/index.cjs');
const { requireAdmin, getRequestUser } = require('../auth/index.cjs');
const K = require('../../shared/bmwHub.cjs');

const LISTE_TAVAN = 2000;

const kim = (req) => {
  const u = getRequestUser(req) || {};
  const kullanici = String(u.username || '').trim().toLowerCase() || 'bilinmiyor';
  return { kullanici, ad: String(u.displayName || '').trim() || kullanici };
};

const isoGun = (v) => {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const isoAn = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function satirdanIs(r) {
  return {
    id: r.id,
    baslik: r.baslik,
    aciklama: r.aciklama || '',
    durum: r.durum,
    oncelik: r.oncelik,
    kategori: r.kategori || K.VARSAYILAN_KATEGORI,
    sahip: r.sahip || '',
    beklenen: r.beklenen || '',
    sonTarih: isoGun(r.son_tarih),
    acanKullanici: r.acan_kullanici,
    acanAd: r.acan_ad || r.acan_kullanici,
    guncelleyenAd: r.guncelleyen_ad || '',
    olusturma: isoAn(r.olusturma),
    guncelleme: isoAn(r.guncelleme),
    kapanis: isoAn(r.kapanis),
  };
}

function satirdanNot(r) {
  return {
    id: r.id,
    tur: r.tur,
    metin: r.metin,
    yazanKullanici: r.yazan_kullanici,
    yazanAd: r.yazan_ad || r.yazan_kullanici,
    olusturma: isoAn(r.olusturma),
  };
}

function ozetle(isler, bugun) {
  const o = { acik: 0, gecikmis: 0, sahipsiz: 0, buHafta: 0, tamamlanan30: 0 };
  const hafta = new Date(`${bugun}T00:00:00Z`);
  hafta.setUTCDate(hafta.getUTCDate() + 7);
  const haftaSonu = hafta.toISOString().slice(0, 10);
  const otuzOnce = Date.now() - 30 * 86400 * 1000;
  for (const is of isler) {
    const d = K.DURUMLAR.find((x) => x.key === is.durum);
    if (d && d.acikMi) {
      o.acik += 1;
      if (!is.sahip) o.sahipsiz += 1;
      if (K.gecikmisMi(is, bugun)) o.gecikmis += 1;
      else if (is.sonTarih && is.sonTarih <= haftaSonu) o.buHafta += 1;
    } else if (is.durum === 'tamam' && is.kapanis && Date.parse(is.kapanis) >= otuzOnce) {
      o.tamamlanan30 += 1;
    }
  }
  return o;
}

const DURUM_AD = Object.fromEntries(K.DURUMLAR.map((d) => [d.key, d.label]));
const ONCELIK_AD = Object.fromEntries(K.ONCELIKLER.map((o) => [o.key, o.label]));
const kapaliMi = (durum) => !(K.DURUMLAR.find((d) => d.key === durum) || {}).acikMi;

async function notYaz(isId, tur, metin, k) {
  await db.query(
    `INSERT INTO bmw_hub_notlar (is_id, tur, metin, yazan_kullanici, yazan_ad) VALUES ($1, $2, $3, $4, $5)`,
    [isId, tur, metin, k.kullanici, k.ad],
  );
}

async function isEkle(v, k) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO bmw_hub_isler (id, baslik, aciklama, durum, oncelik, kategori, sahip, beklenen, son_tarih,
       acan_kullanici, acan_ad, guncelleyen_ad, kapanis)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ${kapaliMi(v.durum) ? 'GETUTCDATE()' : 'NULL'})`,
    [
      id,
      v.baslik,
      v.aciklama || null,
      v.durum,
      v.oncelik,
      v.kategori,
      v.sahip || null,
      v.beklenen || null,
      v.sonTarih || null,
      k.kullanici,
      k.ad,
      k.ad,
    ],
  );
  await notYaz(id, 'olusturma', 'İşi açtı.', k);
  return id;
}

async function isOku(id) {
  const { rows } = await db.query(`SELECT * FROM bmw_hub_isler WHERE id = $1`, [id]);
  return rows.length ? satirdanIs(rows[0]) : null;
}

/** PATCH ile degisen alanlarin gecmis metni. Yalniz izlenen alanlar yazilir. */
function degisimMetinleri(eski, yeni) {
  const m = [];
  if (yeni.durum !== undefined && yeni.durum !== eski.durum)
    m.push(['durum', `Durum: ${DURUM_AD[eski.durum] || eski.durum} → ${DURUM_AD[yeni.durum] || yeni.durum}`]);
  if (yeni.sahip !== undefined && yeni.sahip !== eski.sahip)
    m.push(['sahip', `Sahip: ${eski.sahip || 'yok'} → ${yeni.sahip || 'yok'}`]);
  if (yeni.sonTarih !== undefined && yeni.sonTarih !== eski.sonTarih)
    m.push(['tarih', `Son tarih: ${eski.sonTarih || 'yok'} → ${yeni.sonTarih || 'yok'}`]);
  if (yeni.oncelik !== undefined && yeni.oncelik !== eski.oncelik)
    m.push(['oncelik', `Öncelik: ${ONCELIK_AD[eski.oncelik] || eski.oncelik} → ${ONCELIK_AD[yeni.oncelik] || yeni.oncelik}`]);
  return m;
}

const KOLON = {
  baslik: 'baslik',
  aciklama: 'aciklama',
  durum: 'durum',
  oncelik: 'oncelik',
  kategori: 'kategori',
  sahip: 'sahip',
  beklenen: 'beklenen',
  sonTarih: 'son_tarih',
};

const dbHatasi = (res, e, ne) => {
  console.warn(`[BmwHub] ${ne}: ${e && e.message}`);
  return res.status(500).json({ ok: false, error: `${ne}. Portal veritabanına ulaşılamıyor olabilir.` });
};

function createRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  try {
    router.use(require('../util/nginx-red.cjs').nginxRedCevirici({ onek: 'bmw' }));
  } catch {
    /* yoksay */
  }
  router.use(requireAdmin);
  try {
    router.use(require('../auth/visibility.cjs').requireVisiblePrefix('BmwHub'));
  } catch {
    /* motor yoksa yoksay */
  }
  try {
    router.use(require('../audit/index.cjs').auditMutations('bmw_hub'));
  } catch {
    /* yoksay */
  }

  router.get('/isler', async (_req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT TOP ${LISTE_TAVAN} * FROM bmw_hub_isler ORDER BY guncelleme DESC`,
      );
      const isler = rows.map(satirdanIs);
      const bugun = K.bugunIst();
      res.json({ ok: true, isler, ozet: ozetle(isler, bugun), bugun, tavan: rows.length >= LISTE_TAVAN ? LISTE_TAVAN : null });
    } catch (e) {
      return dbHatasi(res, e, 'İşler okunamadı');
    }
  });

  router.get('/isler/:id', async (req, res) => {
    try {
      const is = await isOku(req.params.id);
      if (!is) return res.status(404).json({ ok: false, error: 'İş bulunamadı (silinmiş olabilir).' });
      const { rows } = await db.query(
        `SELECT * FROM bmw_hub_notlar WHERE is_id = $1 ORDER BY olusturma DESC, id DESC`,
        [req.params.id],
      );
      res.json({ ok: true, is, notlar: rows.map(satirdanNot) });
    } catch (e) {
      return dbHatasi(res, e, 'İş okunamadı');
    }
  });

  router.post('/isler', async (req, res) => {
    const { deger, hatalar } = K.isDogrula(req.body);
    if (hatalar.length) return res.status(400).json({ ok: false, error: hatalar.join(' ') });
    try {
      const id = await isEkle(deger, kim(req));
      res.json({ ok: true, is: await isOku(id) });
    } catch (e) {
      return dbHatasi(res, e, 'İş kaydedilemedi');
    }
  });

  // TOPLU EKLEME: ya hepsi ya hicbiri. Hatali bir satir varsa HICBIRI yazilmaz; ekran zaten
  // ayni ayristiriciyla onizleme gosterir, buraya hatali gelmesi beklenmez.
  router.post('/toplu', async (req, res) => {
    const sonuc = K.topluAyristir(req.body && req.body.metin);
    if (!sonuc.length) return res.status(400).json({ ok: false, error: 'Eklenecek satır yok.' });
    if (sonuc.length > K.SINIR.toplu)
      return res.status(400).json({ ok: false, error: `Bir seferde en çok ${K.SINIR.toplu} iş eklenebilir.` });
    const hatali = sonuc.filter((s) => s.hatalar.length);
    if (hatali.length) {
      return res.status(400).json({
        ok: false,
        error: `${hatali.length} satırda hata var; hiçbir iş eklenmedi. İlk hata: satır ${hatali[0].satir}: ${hatali[0].hatalar[0]}`,
        satirlar: hatali.map((s) => ({ satir: s.satir, hatalar: s.hatalar })),
      });
    }
    const k = kim(req);
    const eklenen = [];
    try {
      for (const s of sonuc) eklenen.push(await isEkle(s.deger, k));
    } catch (e) {
      // Yarim kalan toplu ekleme geri alinir: "hepsi ya hicbiri" sozu DB hatasinda da gecerli.
      for (const id of eklenen) {
        try {
          await db.query(`DELETE FROM bmw_hub_notlar WHERE is_id = $1`, [id]);
          await db.query(`DELETE FROM bmw_hub_isler WHERE id = $1`, [id]);
        } catch {
          /* geri alma da dustuyse asagidaki mesaj sayiyi soyler */
        }
      }
      console.warn(`[BmwHub] toplu ekleme ${eklenen.length}. satirdan sonra dustu: ${e && e.message}`);
      return res.status(500).json({ ok: false, error: 'Toplu ekleme yarıda kaldı ve geri alındı. Portal veritabanını kontrol edip tekrar deneyin.' });
    }
    res.json({ ok: true, eklenen: eklenen.length });
  });

  router.patch('/isler/:id', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const gelen = {};
    for (const k of Object.keys(KOLON)) if (Object.prototype.hasOwnProperty.call(body, k)) gelen[k] = body[k];
    if (!Object.keys(gelen).length) return res.status(400).json({ ok: false, error: 'Değişecek alan yok.' });
    const { deger, hatalar } = K.isDogrula(gelen, { kismi: true });
    if (hatalar.length) return res.status(400).json({ ok: false, error: hatalar.join(' ') });
    try {
      const eski = await isOku(req.params.id);
      if (!eski) return res.status(404).json({ ok: false, error: 'İş bulunamadı (silinmiş olabilir).' });
      // CAKISMA: iki admin ayni isi ayni anda duzenlerse sonraki kaydin oncekini sessizce
      // ezmemesi icin ekran okudugu `guncelleme` damgasini gonderir.
      if (body.beklenenGuncelleme && body.beklenenGuncelleme !== eski.guncelleme) {
        return res.status(409).json({
          ok: false,
          code: 'bmw_cakisma',
          error: `Bu iş siz düzenlerken ${eski.guncelleyenAd || 'başka biri'} tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.`,
          is: eski,
        });
      }
      const k = kim(req);
      const set = [];
      const params = [];
      for (const [alan, v] of Object.entries(deger)) {
        params.push(alan === 'sonTarih' || alan === 'sahip' || alan === 'beklenen' || alan === 'aciklama' ? v || null : v);
        set.push(`${KOLON[alan]} = $${params.length}`);
      }
      if (deger.durum !== undefined && deger.durum !== eski.durum) {
        set.push(kapaliMi(deger.durum) ? 'kapanis = GETUTCDATE()' : 'kapanis = NULL');
      }
      params.push(k.ad);
      set.push(`guncelleyen_ad = $${params.length}`);
      set.push('guncelleme = GETUTCDATE()');
      params.push(req.params.id);
      await db.query(`UPDATE bmw_hub_isler SET ${set.join(', ')} WHERE id = $${params.length}`, params);
      for (const [tur, metin] of degisimMetinleri(eski, deger)) await notYaz(req.params.id, tur, metin, k);
      res.json({ ok: true, is: await isOku(req.params.id) });
    } catch (e) {
      return dbHatasi(res, e, 'İş güncellenemedi');
    }
  });

  router.post('/isler/:id/notlar', async (req, res) => {
    const metin = String((req.body && req.body.metin) || '').trim();
    if (!metin) return res.status(400).json({ ok: false, error: 'Not boş olamaz.' });
    if (metin.length > K.SINIR.not)
      return res.status(400).json({ ok: false, error: `Not en çok ${K.SINIR.not} karakter olabilir.` });
    try {
      const is = await isOku(req.params.id);
      if (!is) return res.status(404).json({ ok: false, error: 'İş bulunamadı (silinmiş olabilir).' });
      const k = kim(req);
      await notYaz(req.params.id, 'not', metin, k);
      await db.query(`UPDATE bmw_hub_isler SET guncelleme = GETUTCDATE(), guncelleyen_ad = $1 WHERE id = $2`, [
        k.ad,
        req.params.id,
      ]);
      res.json({ ok: true });
    } catch (e) {
      return dbHatasi(res, e, 'Not kaydedilemedi');
    }
  });

  router.delete('/isler/:id', async (req, res) => {
    try {
      const is = await isOku(req.params.id);
      if (!is) return res.status(404).json({ ok: false, error: 'İş bulunamadı (silinmiş olabilir).' });
      await db.query(`DELETE FROM bmw_hub_notlar WHERE is_id = $1`, [req.params.id]);
      await db.query(`DELETE FROM bmw_hub_isler WHERE id = $1`, [req.params.id]);
      console.log(`[BmwHub] is silindi: ${req.params.id} (${kim(req).kullanici})`);
      res.json({ ok: true });
    } catch (e) {
      return dbHatasi(res, e, 'İş silinemedi');
    }
  });

  return router;
}

function initBmwHub(app) {
  app.use('/api/bmw-hub', createRouter());
  console.log('[BmwHub] module mounted at /api/bmw-hub');
}

module.exports = { initBmwHub, createRouter, _ic: { satirdanIs, ozetle, degisimMetinleri } };
