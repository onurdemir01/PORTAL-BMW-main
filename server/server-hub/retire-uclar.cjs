// server/server-hub/retire-uclar.cjs - Server Hub > Retirement etiketleri uclari (2026-11-06).
//
// GET  /retire-etiketleri            etiketler (KESIN / SUPHELI) OZET: zincir nedenleri, sunucular, kopya
//                                    sayisi, manuel kontrol durumu, kural seviyeleri; ?fresh=1 tazeler
// GET  /retire-etiketleri/ayrinti    ?anahtar= : tek etiket, eslenik kopyalarin TAMAMI (zincir)
// PUT  /retire-kontrol               { anahtar, sonuc: DOGRULANDI | YANLIS_ALARM | GERI_AL, aciklama, imza }
// GET  /retire-kontrol/gecmis        ?anahtar=  (bos: tum gecmis)
// Router zaten yalniz Admin ve gorunurluk kapisinin arkasinda (index.cjs). Kontrol yalniz GUNCEL
// etikete yazilir: etiket artik yoksa ya da kaniti degistiyse 409 (ekran yenileyip yeniden sorar).
// Durum kodlari proxy-guvenli (400 / 409 / 424): 5xx govdesi HTML'e cevrilirdi.
'use strict';

const { ETIKET_KURALLARI } = require('./kural-katalogu.cjs');
const { etiketle, ozetle } = require('./retire-etiket.cjs');

function kurallarListesi(ayar) {
  return ETIKET_KURALLARI.map((k) => {
    const m = (ayar.kayitlar || {})[`etiket:${k.kural}`] || null;
    return {
      kural: k.kural,
      tur: k.tur,
      ad: k.ad,
      kosul: k.kosul,
      varsayilan: k.varsayilan,
      gecerli: (ayar.etiketler || {})[k.kural] || k.varsayilan,
      degistiren: m ? m.updatedBy : null,
      zaman: m ? m.updatedAt : null,
      aciklama: m ? m.aciklama : '',
      dogrulama: k.dogrulama,
    };
  });
}

/** Degerlendirme + Admin kural seviyeleri + manuel kontroller -> etiketler (Uygulama 360 da kullanir). */
function etiketHesabiKur({ getAssessment, ayarlar, kontrol }) {
  return async function hesap(fresh) {
    const [a, ayar, kontroller] = await Promise.all([
      getAssessment(fresh === true),
      ayarlar.oku(),
      kontrol.kontrolleriOku(),
    ]);
    const sonuc = a.tableMissing
      ? etiketle({ hosts: [], kurallar: ayar.etiketler, kontroller })
      : etiketle({ hosts: a.hosts, kurallar: ayar.etiketler, kontroller });
    return { a, ayar, kontroller, sonuc };
  };
}

function mount(router, { getAssessment, ayarlar, kontrol, audit }) {
  const kim = (req) => (req.session && req.session.user && req.session.user.username) || 'unknown';
  const hesap = etiketHesabiKur({ getAssessment, ayarlar, kontrol });

  router.get('/retire-etiketleri', async (req, res) => {
    try {
      const { a, ayar, kontroller, sonuc } = await hesap(req.query.fresh === '1');
      res.json({
        ok: true,
        tableMissing: a.tableMissing === true,
        latestScan: a.latestScan || null,
        // Uygulama Envanteri okunamadiysa EAR / GIRDI etiketleri YOKTUR; bu "temiz" demek degil.
        ear: a.ear || null,
        // Capraz kaynaklar (OpenShift / Dynatrace / Retirement) okunamadiysa R9-R12'nin bir kismi YOK.
        capraz: a.capraz || null,
        kontrolOkunamadi: kontroller === null,
        ayarOkunamadi: ayar.okunamadi === true,
        kurallar: kurallarListesi(ayar),
        ozet: sonuc.ozet,
        // Liste kopyalari tasimaz (buyuk filoda MB'lar); acilan etiket ayrinti ucundan tam gelir.
        etiketler: sonuc.etiketler.map(ozetle),
      });
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, message: err.message || 'Retirement etiketleri alınamadı.' });
    }
  });

  router.get('/retire-etiketleri/ayrinti', async (req, res) => {
    try {
      const anahtar = String(req.query.anahtar || '').slice(0, 400);
      const { sonuc } = await hesap(false);
      const e = sonuc.etiketler.find((x) => x.anahtar === anahtar);
      if (!e)
        return res
          .status(409)
          .json({
            ok: false,
            message: 'Bu etiket artık yok (son taramada koşul kalktı). Listeyi yenileyin.',
          });
      res.json({ ok: true, etiket: e });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Etiket ayrıntısı alınamadı.' });
    }
  });

  router.put('/retire-kontrol', async (req, res) => {
    const b = req.body || {};
    try {
      const { kontroller, sonuc } = await hesap(false);
      if (kontroller === null)
        return res.status(424).json({
          ok: false,
          message:
            'Manuel kontrol kayıtları okunamadı; şimdi yazılamaz. Biraz sonra yeniden deneyin.',
        });
      const e = sonuc.etiketler.find((x) => x.anahtar === String(b.anahtar || ''));
      if (!e)
        return res.status(409).json({
          ok: false,
          message: 'Bu etiket artık yok (son taramada koşul kalktı). Listeyi yenileyin.',
        });
      if (e.imza !== String(b.imza || ''))
        return res.status(409).json({
          ok: false,
          message: 'Etiketin kanıtı siz bakarken değişti. Listeyi yenileyip yeniden kontrol edin.',
          imza: e.imza,
        });
      const r = await kontrol.kontrolYaz({
        anahtar: e.anahtar,
        sonuc: b.sonuc,
        aciklama: b.aciklama,
        imza: e.imza,
        seviye: e.seviye,
        kim: kim(req),
      });
      audit(req, { op: 'retire_kontrol', anahtar: e.anahtar, sonuc: r.sonuc, seviye: e.seviye });
      const sonra = await hesap(false);
      res.json({
        ok: true,
        etiket: sonra.sonuc.etiketler.find((x) => x.anahtar === e.anahtar) || null,
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  router.get('/retire-kontrol/gecmis', async (req, res) => {
    try {
      const anahtar = req.query.anahtar ? String(req.query.anahtar).slice(0, 400) : null;
      res.json({ ok: true, gecmis: await kontrol.kontrolGecmisi(anahtar, 100) });
    } catch (err) {
      // null = gecmis OKUNAMADI (bos liste ile ayni sey degil)
      res.json({ ok: true, gecmis: null, message: err.message });
    }
  });
}

module.exports = { mount, kurallarListesi, etiketHesabiKur };
