// server/server-hub/iliski-uclar.cjs - Iliski grafigi uclari (2026-11-07).
//
// GET /iliski/durum              grafik boyutu, kaynaklarin okunabilirligi, kurulum suresi
// GET /iliski/ara?q=             uygulama / sunucu / vhost / DNS / IP adinda gecen varliklar (en cok 50)
// GET /iliski/varlik?anahtar=    tek varlik: kenarlari (yontem + guven + durum), bagli bilesen, capraz
//                                dogrulamalari (kendisi + komsulari)
// Router zaten yalniz Admin ve gorunurluk kapisinin arkasinda (index.cjs). Kodlar proxy-guvenli: 400 gecersiz,
// 409 varlik artik grafikte yok, 424 degerlendirme okunamadi.
//
// ONBELLEK: grafik, degerlendirme nesnesi degisince ya da Uygulama Envanteri verisi VERI_MS'den eskiyse
// yeniden kurulur (tek ucus). Okunamayan kaynak grafigi dusurmez; /durum bunu soyler.
'use strict';

const { grafikKur, ara, varlik } = require('./iliski-grafigi.cjs');
const { dogrula } = require('./dogrulama.cjs');

const VERI_MS = 60 * 1000;
const ANAHTAR_RE = /^(sunucu|jvm|was|web|vhost|ip|dns|app):[^\s]{1,390}$/;

function iliskiHesabiKur({
  getAssessment,
  iliskiVerisi = () => require('./iliski-verisi.cjs').iliskiVerisi(),
  simdi = Date.now,
}) {
  let durum = { a: null, veri: null, veriAt: 0, grafik: null, dogrulamalar: null, sureMs: null };
  let ucus = null;
  return async function hesap(fresh) {
    const a = await getAssessment(fresh === true);
    if (a.tableMissing) return { a, grafik: null };
    const veriBayat = fresh === true || !durum.veri || simdi() - durum.veriAt > VERI_MS;
    if (durum.grafik && durum.a === a && !veriBayat) return { a, ...durum };
    if (ucus) return ucus;
    ucus = (async () => {
      const t0 = simdi();
      const veri = veriBayat ? await iliskiVerisi() : durum.veri;
      const grafik = grafikKur({ hosts: a.hosts, veri });
      const dogrulamalar = dogrula(grafik, { veri });
      durum = {
        a,
        veri,
        veriAt: veriBayat ? simdi() : durum.veriAt,
        grafik,
        dogrulamalar,
        sureMs: simdi() - t0,
      };
      return { a, ...durum };
    })();
    try {
      return await ucus;
    } finally {
      ucus = null;
    }
  };
}

function mount(router, { getAssessment, iliskiVerisi }) {
  const hesap = iliskiHesabiKur({ getAssessment, ...(iliskiVerisi ? { iliskiVerisi } : {}) });
  const okunamadi = (res) =>
    res
      .status(424)
      .json({
        ok: false,
        message: 'Server Hub tabloları henüz yok ya da okunamadı; ilişki grafiği kurulamadı.',
      });

  router.get('/iliski/durum', async (req, res) => {
    try {
      const h = await hesap(req.query.fresh === '1');
      if (!h.grafik) return okunamadi(res);
      const turler = {};
      for (const d of h.grafik.dugumler.values()) turler[d.tur] = (turler[d.tur] || 0) + 1;
      const kenarDurum = {};
      for (const e of h.grafik.kenarlar)
        kenarDurum[e.durum || '-'] = (kenarDurum[e.durum || '-'] || 0) + 1;
      const vh = h.veri && h.veri.hostlar instanceof Map ? [...h.veri.hostlar.values()] : [];
      res.json({
        ok: true,
        dugum: h.grafik.dugumler.size,
        kenar: h.grafik.kenarlar.length,
        turler,
        kenarDurum,
        sureMs: h.sureMs,
        kaynaklar: {
          uygulamaEnvanteri:
            h.veri && h.veri.okunamadi
              ? { okunamadi: true, hata: h.veri.hata || '' }
              : { okunamadi: false, host: vh.length },
          fazA: vh.filter((v) => v.jboss && v.jboss.some((k) => k.faz)).length,
          fazW: vh.filter((v) => v.web).length,
          baglanti: vh.filter((v) => v.baglanti && v.baglanti.durum === 'OLCULDU').length,
          ipEnvanteri:
            h.veri && h.veri.ipEnvanteri && h.veri.ipEnvanteri.okunamadi
              ? { okunamadi: true }
              : {
                  okunamadi: false,
                  satir: ((h.veri && h.veri.ipEnvanteri && h.veri.ipEnvanteri.satirlar) || [])
                    .length,
                },
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message || 'İlişki grafiği kurulamadı.' });
    }
  });

  router.get('/iliski/ara', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length > 128)
      return res.status(400).json({ ok: false, message: 'Arama metni 1-128 karakter olmalı.' });
    try {
      const h = await hesap(false);
      if (!h.grafik) return okunamadi(res);
      res.json({ ok: true, sonuclar: ara(h.grafik, q) });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message || 'Arama yapılamadı.' });
    }
  });

  router.get('/iliski/varlik', async (req, res) => {
    const anahtar = String(req.query.anahtar || '');
    if (!ANAHTAR_RE.test(anahtar))
      return res.status(400).json({ ok: false, message: 'Geçersiz varlık anahtarı.' });
    try {
      const h = await hesap(false);
      if (!h.grafik) return okunamadi(res);
      const v = varlik(h.grafik, anahtar);
      if (!v)
        return res
          .status(409)
          .json({ ok: false, message: 'Varlık artık grafikte yok (son taramada görülmedi).' });
      const dogrulamalar = {};
      for (const k of [
        anahtar,
        ...v.kenarlar.map((e) => e.karsi && e.karsi.anahtar).filter(Boolean),
      ]) {
        const l = h.dogrulamalar.get(k);
        if (l) dogrulamalar[k] = l;
      }
      res.json({ ok: true, ...v, dogrulamalar });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message || 'Varlık okunamadı.' });
    }
  });
}

module.exports = { mount, iliskiHesabiKur, ANAHTAR_RE, VERI_MS };
