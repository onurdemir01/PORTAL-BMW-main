// server/server-hub/iliski-uclar.cjs - Iliski grafigi uclari (2026-11-07).
//
// GET /iliski/durum              grafik boyutu, kaynaklarin okunabilirligi, kurulum suresi
// GET /iliski/ara?q=             uygulama / sunucu / vhost / DNS / IP adinda gecen varliklar (en cok 50)
// GET /iliski/varlik?anahtar=    tek varlik: kenarlari (yontem + guven + durum), bagli bilesen, capraz
//                                dogrulamalari (kendisi + komsulari)
// GET /iliski/kararlar           uygulama basina retirement karari (ozet satirlar + karar sayilari)
// GET /iliski/karar?anahtar=     app: | sunucu: | jvm: | was: icin karar ayrintisi (maddeler, eksikler,
//                                celiskiler, yapilabilecekler); senaryo.cjs
// Router zaten yalniz Admin ve gorunurluk kapisinin arkasinda (index.cjs). Kodlar proxy-guvenli: 400 gecersiz,
// 409 varlik artik grafikte yok, 424 degerlendirme okunamadi.
//
// ONBELLEK: grafik, degerlendirme nesnesi degisince ya da Uygulama Envanteri verisi VERI_MS'den eskiyse
// yeniden kurulur (tek ucus). Okunamayan kaynak grafigi dusurmez; /durum bunu soyler.
'use strict';

const { grafikKur, ara, varlik } = require('./iliski-grafigi.cjs');
const { dogrula } = require('./dogrulama.cjs');
const { kararla, KARARLAR } = require('./senaryo.cjs');

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
      const kararlar = kararla({ g: grafik, dogrulamalar, hosts: a.hosts });
      durum = {
        a,
        veri,
        veriAt: veriBayat ? simdi() : durum.veriAt,
        grafik,
        dogrulamalar,
        kararlar,
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

function mount(
  router,
  { getAssessment, iliskiVerisi, notDurumu = () => require('./notlar.cjs').notDurumu() },
) {
  const hesap = iliskiHesabiKur({ getAssessment, ...(iliskiVerisi ? { iliskiVerisi } : {}) });
  // Kalici notlar (notlar.cjs): kararlari zenginlestirir; okunamazsa notsuz devam (notOkunamadi: true).
  const notBaglami = async (h) => {
    const nd = await notDurumu().catch(() => ({ okunamadi: true, notlar: [], siniflar: [] }));
    const { notlariIndeksle } = require('./notlar.cjs');
    return {
      nd,
      indeks: notlariIndeksle(nd.notlar, h.grafik),
      siniflar: nd.siniflar,
      g: h.grafik,
      kararlar: h.kararlar,
    };
  };
  const notOzeti = (n) =>
    n ? { id: n.id, sinif: n.sinif, metin: n.metin, konu: n.konu, dogrudan: n.dogrudan } : null;
  /** Kopya / uygulama + notlari; BILINEN notun bastirdigi maddeler isaretlenir (karar DEGISMEZ). */
  const notlu = (x, ctx) => {
    if (!x) return x;
    const { kararNotlari } = require('./notlar.cjs');
    const kn = kararNotlari(x.anahtar, ctx);
    return {
      ...x,
      notlar: kn.notlar,
      bilinen: notOzeti(kn.tumuBilinen),
      ...(x.maddeler
        ? {
            maddeler: x.maddeler.map((m) => ({
              ...m,
              bilinen: notOzeti(kn.bilinenKodlar.get(m.kod) || kn.tumuBilinen),
            })),
          }
        : {}),
    };
  };
  const okunamadi = (res) =>
    res.status(424).json({
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

  router.get('/iliski/kararlar', async (req, res) => {
    try {
      const h = await hesap(req.query.fresh === '1');
      if (!h.grafik) return okunamadi(res);
      const ctx = await notBaglami(h);
      const { kararNotlari } = require('./notlar.cjs');
      const liste = [...h.kararlar.uygulamalar.values()].map((u) => {
        const kn = kararNotlari(u.anahtar, ctx);
        return {
          anahtar: u.anahtar,
          ad: u.ad,
          karar: u.karar,
          kararMetni: u.kararMetni,
          ozet: u.ozet,
          sayilar: u.sayilar,
          notSayisi: kn.notlar.length,
          siniflar: [...new Set(kn.notlar.map((n) => n.sinif))],
          veriDegisti: kn.notlar.some((n) => n.veriDegisti),
          // BILINEN etkili not uygulamanin tamamina yaziliysa uygulama ana sayimdan dusup "Bilinen" bolumune gecer.
          bilinen: notOzeti(kn.tumuBilinen),
        };
      });
      liste.sort((a, b) => a.ad.localeCompare(b.ad));
      const ana = liste.filter((u) => !u.bilinen);
      const sayilar = Object.fromEntries(
        KARARLAR.map((k) => [k, ana.filter((u) => u.karar === k).length]),
      );
      res.json({
        ok: true,
        sayilar,
        bilinenSayisi: liste.length - ana.length,
        notOkunamadi: ctx.nd.okunamadi === true,
        siniflar: ctx.siniflar,
        yetimNotSayisi: ctx.indeks.yetimler.length,
        uygulamalar: liste,
      });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message || 'Kararlar hesaplanamadı.' });
    }
  });

  router.get('/iliski/karar', async (req, res) => {
    const anahtar = String(req.query.anahtar || '');
    if (!/^(app|sunucu|jvm|was):[^\s]{1,390}$/.test(anahtar))
      return res
        .status(400)
        .json({ ok: false, message: 'Anahtar app: / sunucu: / jvm: / was: ile başlamalı.' });
    try {
      const h = await hesap(false);
      if (!h.grafik) return okunamadi(res);
      const { uygulamalar, kopyalar } = h.kararlar;
      const ctx = await notBaglami(h);
      const ek = { siniflar: ctx.siniflar, notOkunamadi: ctx.nd.okunamadi === true };
      if (anahtar.startsWith('app:')) {
        const u = uygulamalar.get(anahtar);
        if (!u)
          return res
            .status(409)
            .json({ ok: false, message: 'Uygulama artık grafikte yok ya da kopyası yok.' });
        return res.json({
          ok: true,
          tur: 'app',
          ...ek,
          uygulama: notlu(u, ctx),
          kopyalar: u.kopyalar.map((k) => notlu(kopyalar.get(k), ctx)).filter(Boolean),
        });
      }
      if (anahtar.startsWith('sunucu:')) {
        if (!h.grafik.dugumler.has(anahtar))
          return res.status(409).json({ ok: false, message: 'Sunucu artık grafikte yok.' });
        const kk = h.grafik
          .komsuKenarlar(anahtar)
          .filter((e) => e.kaynak === anahtar && e.tur === 'barindirir')
          .map((e) => notlu(kopyalar.get(e.hedef), ctx))
          .filter(Boolean);
        const web = h.grafik
          .komsuKenarlar(anahtar)
          .filter(
            (e) => e.kaynak === anahtar && e.tur === 'barindirir' && e.hedef.startsWith('web:'),
          )
          .map((e) => h.grafik.dugumler.get(e.hedef))
          .filter(Boolean)
          .map((w) => ({
            anahtar: w.anahtar,
            ad: w.ad,
            vhost: h.grafik.komsuKenarlar(w.anahtar).filter((e) => e.tur === 'sunar').length,
          }));
        return res.json({
          ok: true,
          tur: 'sunucu',
          ...ek,
          notlar: require('./notlar.cjs').kararNotlari(anahtar, ctx).notlar,
          sunucu: h.grafik.dugumler.get(anahtar),
          kopyalar: kk,
          web,
        });
      }
      const k = kopyalar.get(anahtar);
      if (!k) return res.status(409).json({ ok: false, message: 'Kopya artık grafikte yok.' });
      // Kopyanin ait oldugu uygulama(lar): ekran karttan uygulamaya gecer.
      const sahipler = h.grafik
        .komsuKenarlar(anahtar)
        .filter((e) => e.tur === 'kopya' && e.hedef === anahtar)
        .map((e) => e.kaynak);
      res.json({ ok: true, tur: 'kopya', ...ek, kopya: { ...notlu(k, ctx), uygulamalar: sahipler } });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message || 'Karar okunamadı.' });
    }
  });
  return hesap;
}

module.exports = { mount, iliskiHesabiKur, ANAHTAR_RE, VERI_MS };
