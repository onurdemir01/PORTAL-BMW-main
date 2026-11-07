// server/server-hub/notlar-uclar.cjs - Kalici Admin notlari / siniflar uclari (2026-11-07).
//
// GET    /notlar[?arsiv=1]             notlar (+ yetim, veri degisti) ve siniflar
// GET    /notlar/varlik?anahtar=       bir varliga ulasan notlar (dogrudan + yayilan, "buradan geldi" yolu)
// POST   /notlar                       { konu, supheli_kod?, sinif, etiketler[], metin, yayilim } -> 201 { id, yetim }
// PUT    /notlar/:id                   { ...ayni alanlar, surum } (konu degismez; iyimser kilit 409)
// DELETE /notlar/:id[?kalici=1&onay=1] arsivle; kalici silme acik onay ister (gecmis kalir)
// POST   /notlar/:id/geri-al           arsivden geri al
// GET    /notlar/:id/gecmis            her degisiklik (onceki hali)
// GET    /siniflar | PUT /siniflar | DELETE /siniflar/:ad
// Router zaten yalniz Admin ve gorunurluk kapisinin arkasinda (index.cjs). Her yazim denetim kaydina gider.
// Kodlar proxy-guvenli: 400 gecersiz, 409 cakisma / yok, 422 bilinmeyen sinif, 424 depo.
'use strict';

const N = require('./notlar.cjs');

const ID_RE = /^\d{1,9}$/;

function mount(router, { iliskiHesabi, audit = () => {} }) {
  const kim = (req) => (req.session && req.session.user && req.session.user.username) || 'unknown';
  const gonder = (res, err) =>
    res
      .status([400, 409, 422, 424].includes(err.status) ? err.status : 424)
      .json({ ok: false, message: err.message });
  // Grafik / kararlar imza ve yayilim icin; okunamazsa notlar yine listelenir (yetim / imza bilinmez).
  const grafikCtx = async () => {
    try {
      const h = await iliskiHesabi(false);
      return h && h.grafik ? h : null;
    } catch {
      return null;
    }
  };
  const idAl = (req) => {
    if (!ID_RE.test(String(req.params.id))) throw N.hata(400, 'Geçersiz not kimliği.');
    return Number(req.params.id);
  };

  router.get('/notlar', async (req, res) => {
    const [n, s, h] = await Promise.all([
      N.notlariOku({ arsiv: req.query.arsiv === '1' }),
      N.siniflariOku(),
      grafikCtx(),
    ]);
    const yetim = new Set(h ? N.notlariIndeksle(n.notlar, h.grafik).yetimler.map((x) => x.id) : []);
    res.json({
      ok: true,
      okunamadi: n.okunamadi,
      hata: n.hata || '',
      grafikYok: !h,
      siniflar: s.siniflar,
      notlar: n.notlar.map((x) => {
        const simdi = h ? N.imzaOf(h.grafik, h.kararlar, x.konu) : null;
        return {
          ...x,
          yetim: h ? yetim.has(x.id) : null,
          veriDegisti: !!(x.imza && simdi && simdi !== x.imza),
        };
      }),
    });
  });

  router.get('/notlar/varlik', async (req, res) => {
    const anahtar = String(req.query.anahtar || '');
    if (!N.KONU_RE.test(anahtar))
      return res.status(400).json({ ok: false, message: 'Geçersiz varlık anahtarı.' });
    const [nd, h] = await Promise.all([N.notDurumu(), grafikCtx()]);
    const indeks = N.notlariIndeksle(nd.notlar, h ? h.grafik : null);
    const kn = N.kararNotlari(anahtar, {
      indeks,
      siniflar: nd.siniflar,
      g: h ? h.grafik : null,
      kararlar: h ? h.kararlar : null,
    });
    res.json({ ok: true, okunamadi: nd.okunamadi, siniflar: nd.siniflar, notlar: kn.notlar });
  });

  router.post('/notlar', async (req, res) => {
    try {
      const { siniflar } = await N.siniflariOku();
      const n = N.notDogrula(req.body, siniflar);
      const h = await grafikCtx();
      const id = await N.notEkle(n, {
        kim: kim(req),
        imza: h ? N.imzaOf(h.grafik, h.kararlar, n.konu) : null,
      });
      N.onbellekSil();
      audit(req, {
        op: 'not_ekle',
        id,
        konu: n.konu,
        sinif: n.sinif,
        supheli_kod: n.supheli_kod,
        yayilim: n.yayilim,
      });
      res.status(201).json({ ok: true, id, yetim: h ? !h.grafik.dugumler.has(n.konu) : null });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.put('/notlar/:id', async (req, res) => {
    try {
      const id = idAl(req);
      const once = await N.notGetir(id).catch((e) => {
        throw N.hata(424, e.message);
      });
      if (!once) throw N.hata(409, 'Not artık yok.');
      const b = req.body || {};
      if (b.konu != null && String(b.konu).trim() !== once.konu)
        throw N.hata(400, 'Notun konusu değiştirilemez; yeni not ekleyin.');
      const { siniflar } = await N.siniflariOku();
      const n = N.notDogrula({ ...b, konu: once.konu }, siniflar);
      if (!Number.isInteger(Number(b.surum))) throw N.hata(400, 'surum eksik.');
      const h = await grafikCtx();
      await N.notGuncelle(id, n, {
        kim: kim(req),
        surum: Number(b.surum),
        imza: h ? N.imzaOf(h.grafik, h.kararlar, once.konu) : once.imza,
      });
      N.onbellekSil();
      audit(req, { op: 'not_guncelle', id, konu: once.konu, sinif: n.sinif });
      res.json({ ok: true, id });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.delete('/notlar/:id', async (req, res) => {
    try {
      const id = idAl(req);
      const kalici = req.query.kalici === '1';
      if (kalici && req.query.onay !== '1')
        throw N.hata(
          400,
          'Kalıcı silme açık onay ister (onay=1). Arşivlemek için kalici parametresini kaldırın.',
        );
      const once = await N.notDurum(id, kalici ? 'SIL' : 'ARSIV', { kim: kim(req) });
      N.onbellekSil();
      audit(req, { op: kalici ? 'not_sil' : 'not_arsivle', id, konu: once.konu });
      res.json({ ok: true, id, durum: kalici ? 'SILINDI' : 'ARSIV' });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.post('/notlar/:id/geri-al', async (req, res) => {
    try {
      const id = idAl(req);
      const once = await N.notDurum(id, 'AKTIF', { kim: kim(req) });
      N.onbellekSil();
      audit(req, { op: 'not_geri_al', id, konu: once.konu });
      res.json({ ok: true, id, durum: 'AKTIF' });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.get('/notlar/:id/gecmis', async (req, res) => {
    try {
      res.json({ ok: true, gecmis: await N.notGecmisi(idAl(req)) });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.get('/siniflar', async (req, res) => {
    const s = await N.siniflariOku();
    res.json({ ok: true, okunamadi: s.okunamadi, siniflar: s.siniflar });
  });

  router.put('/siniflar', async (req, res) => {
    try {
      const s = N.sinifDogrula(req.body);
      await N.sinifYaz(s, { kim: kim(req) });
      N.onbellekSil();
      audit(req, { op: 'sinif_kaydet', ad: s.ad, etki: s.etki });
      res.json({ ok: true, ...(await N.siniflariOku()) });
    } catch (err) {
      gonder(res, err);
    }
  });

  router.delete('/siniflar/:ad', async (req, res) => {
    try {
      await N.sinifSil(req.params.ad);
      N.onbellekSil();
      audit(req, { op: 'sinif_sil', ad: String(req.params.ad).toUpperCase() });
      res.json({ ok: true, ...(await N.siniflariOku()) });
    } catch (err) {
      gonder(res, err);
    }
  });
}

module.exports = { mount };
