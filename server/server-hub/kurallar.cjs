// server/server-hub/kurallar.cjs - Server Hub > "Kurallar & Limitler" uclari (2026-10-20).
//
// GET  /kurallar                 tarama maddeleri, her ciktinin varsayilan / gecerli seviyesi, son
//                                taramadaki bulgu ve sunucu sayisi, limitler, ayar gecmisi
// GET  /limitler                 tek seferde girilebilecek sunucu sayilari (sekmelerin girdi alani)
// PUT  /kurallar/seviye/:kod     { seviye, aciklama }  ('ok' = sorun yok; varsayilana donus satiri siler)
// PUT  /kurallar/limit/:ad       { deger, aciklama }
// Yazma sonrasi degerlendirme onbellegi silinir: sunucu durumu ve sayaclar hemen yeni seviyeyle.
// Sayim OLCULEMEDIYSE (tablo yok / degerlendirme dustu) sayilar null doner, 0 DEGIL.
'use strict';

const { MADDELER, ALANLAR } = require('./kural-katalogu.cjs');
const { LIMITLER } = require('./ayarlar.cjs');

/** Son degerlendirmeden kod -> { bulgu, sunucu }. Taramadan dusen sunucu sayilmaz. */
function sayimlar(a) {
  const out = new Map();
  for (const h of (a && a.hosts) || []) {
    if (h.taramadanDustu) continue;
    for (const f of h.findings || []) {
      if (!out.has(f.code)) out.set(f.code, { bulgu: 0, sunucu: new Set() });
      const b = out.get(f.code);
      b.bulgu += 1;
      b.sunucu.add(h.host);
    }
  }
  return out;
}

/** Saf yanit kurucu (test edilir). a null / tableMissing ise sayilar null. */
function kurallarYaniti(ayar, a, gecmis) {
  const olculdu = !!(a && !a.tableMissing);
  const say = sayimlar(olculdu ? a : null);
  const meta = (anahtar) => ayar.kayitlar[anahtar] || null;
  return {
    ok: true,
    okunamadi: ayar.okunamadi === true,
    hata: ayar.hata || '',
    taramaTarihi: (olculdu && a.latestScan) || null,
    sayimOlculdu: olculdu,
    alanlar: ALANLAR,
    maddeler: MADDELER.map((m) => ({
      id: m.id,
      alan: m.alan,
      alanAd: ALANLAR[m.alan] || m.alan,
      ad: m.ad,
      neTaranir: m.neTaranir,
      ciktilar: m.ciktilar.map((c) => {
        if (!c.kod) return { kod: null, kosul: c.kosul, varsayilan: 'ok', gecerli: 'ok' };
        const k = meta(`seviye:${c.kod}`);
        const n = say.get(c.kod);
        return {
          kod: c.kod,
          kosul: c.kosul,
          varsayilan: c.seviye,
          gecerli: ayar.seviyeler[c.kod] || c.seviye,
          degistiren: k ? k.updatedBy : null,
          zaman: k ? k.updatedAt : null,
          aciklama: k ? k.aciklama : '',
          bulgu: olculdu ? (n ? n.bulgu : 0) : null,
          sunucu: olculdu ? (n ? n.sunucu.size : 0) : null,
        };
      }),
    })),
    limitler: limitListesi(ayar),
    // null = gecmis OKUNAMADI (bos liste ile ayni sey degil)
    gecmis,
  };
}

function limitListesi(ayar) {
  return Object.entries(LIMITLER).map(([ad, L]) => {
    const k = ayar.kayitlar[`limit:${ad}`] || null;
    return {
      ad,
      etiket: L.ad,
      aciklama: L.aciklama,
      varsayilan: L.varsayilan,
      ust: L.ust,
      gecerli: ayar.limitler[ad],
      degistiren: k ? k.updatedBy : null,
      zaman: k ? k.updatedAt : null,
      not: k ? k.aciklama : '',
    };
  });
}

function mount(router, { ayarlar, getAssessment, onbellekSil, audit }) {
  router.get('/kurallar', async (req, res) => {
    try {
      const ayar = await ayarlar.oku(req.query.fresh === '1');
      const a = await getAssessment(req.query.fresh === '1').catch(() => null);
      const g = await ayarlar.gecmis(100).catch(() => null);
      res.json(kurallarYaniti(ayar, a, g));
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  router.get('/limitler', async (req, res) => {
    try {
      const ayar = await ayarlar.oku();
      res.json({ ok: true, okunamadi: ayar.okunamadi === true, limitler: limitListesi(ayar) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  const kim = (req) => (req.session && req.session.user && req.session.user.username) || 'unknown';

  router.put('/kurallar/seviye/:kod', async (req, res) => {
    try {
      const r = await ayarlar.seviyeYaz({
        kod: req.params.kod,
        seviye: req.body && req.body.seviye,
        aciklama: req.body && req.body.aciklama,
        kim: kim(req),
      });
      onbellekSil();
      if (!r.degismedi) audit(req, { op: 'seviye_degistir', kod: String(req.params.kod), eski: r.eski, yeni: r.yeni });
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  router.put('/kurallar/limit/:ad', async (req, res) => {
    try {
      const r = await ayarlar.limitYaz({
        ad: req.params.ad,
        deger: req.body && req.body.deger,
        aciklama: req.body && req.body.aciklama,
        kim: kim(req),
      });
      if (!r.degismedi) audit(req, { op: 'limit_degistir', ad: String(req.params.ad), eski: r.eski, yeni: r.yeni });
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });
}

module.exports = { mount, kurallarYaniti, sayimlar, limitListesi };
