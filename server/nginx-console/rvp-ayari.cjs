// server/nginx-console/rvp-ayari.cjs — RP Secimi sihirbazinin kurum verisi (2026-11-20).
//
// Karar tablosu ekranda (src/components/nginx_console/rvpSecim.ts); kutularin SUNUCULARI ve ustverisi
// kurum ayarinda (`nginx.rvp`, server/util/kurum-ayari.cjs; sunucu adlari repoda degil, K17):
//   icAlan     ic domain (metinde gosterilir)
//   sunucular  {SUNUCU: {lokasyon: 'Pendik'|'Ankara', domain, surum, amac}}
//   kutular    {<kutu>: [SUNUCU]}  kutu adlari rvpSecim.ts RvpKutu ile ayni
// Gecersiz girdi atilir ve `hata`da soylenir; ayar yoksa bos doner (ekran kutuyu "tanimsiz" gosterir).
'use strict';

const { bolum } = require('../util/kurum-ayari.cjs');
// Sunucu adi kurali Admin > Kurum Ayari kaydiyla ortak (SUNUCU_ALANLARI nginx.rvp.*): shared/kurumAyari.cjs.
const { SUNUCU } = require('../../shared/kurumAyari.cjs');

const KUTULAR = Object.freeze([
  'arkInternetNprAcik',
  'nprKapali',
  'arkInternetProd',
  'arkIntranetNpr',
  'arkIntranetProd',
  'hostingInternetNprAcik',
  'hostingInternetProd',
]);
const LOKASYON = new Set(['Pendik', 'Ankara']);
const metin = (v, sinir = 200) => (typeof v === 'string' ? v.slice(0, sinir) : '');

/** -> { rvp: { icAlan, sunucular, kutular }, hata } */
function rvpAyari(env = process.env) {
  const bos = { icAlan: '', sunucular: {}, kutular: {} };
  const { deger, hata } = bolum('nginx.rvp', env);
  if (hata) return { rvp: bos, hata };
  if (!deger || typeof deger !== 'object' || Array.isArray(deger))
    return { rvp: bos, hata: 'kurum ayari nginx.rvp bir nesne degil' };
  let atilan = 0;
  const sunucular = {};
  for (const [k, v] of Object.entries(deger.sunucular || {})) {
    const host = String(k).trim().toUpperCase();
    if (!SUNUCU.test(host) || !v || typeof v !== 'object' || !LOKASYON.has(v.lokasyon)) {
      atilan += 1;
      continue;
    }
    sunucular[host] = {
      lokasyon: v.lokasyon,
      domain: metin(v.domain, 253),
      surum: metin(v.surum, 80),
      amac: metin(v.amac),
    };
  }
  const kutular = {};
  for (const ad of KUTULAR) {
    const liste = Array.isArray(deger.kutular?.[ad]) ? deger.kutular[ad] : [];
    const temiz = liste.map((h) => String(h).trim().toUpperCase()).filter((h) => SUNUCU.test(h));
    atilan += liste.length - temiz.length;
    if (temiz.length) kutular[ad] = temiz;
  }
  return {
    rvp: { icAlan: metin(deger.icAlan, 253), sunucular, kutular },
    hata: atilan ? `kurum ayari nginx.rvp: ${atilan} gecersiz girdi atildi` : null,
  };
}

module.exports = { rvpAyari, KUTULAR };
