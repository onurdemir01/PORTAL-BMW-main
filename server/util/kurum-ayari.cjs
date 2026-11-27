// server/util/kurum-ayari.cjs — kurumun altyapi envanteri KOD DISINDA (2026-11-20).
//
// Repo public: sunucu adlari, kurum alan adlari ve kisi bilgisi koda yazilmaz (kalite kapisi K17,
// scripts/ic-ad-bekcisi.cjs). Kodun calismak icin bildigi kurum listeleri (nginx filosu, OCP kumeleri,
// varsayilan hedefler) tek bir JSON dosyasindadir:
//   KURUM_AYAR_DOSYASI=/yol/kurum-ayari.json
// Uretimde dosya repo DISINDADIR; bicimi ve kurgusal degerleri deploy/kurum-ayari.ornek.json'da
// (testler ve yerel gelistirme bunu kullanir). Dosya her erisimde degisiklik zamanina gore yeniden
// okunur: guncellemek yeniden baslatma istemez.
//
// FAIL-LOUD: dosya tanimsiz / okunamaz / bozuksa uygulama DUSMEZ, ama ornek degere de DUSULMEZ (ornek
// dosya uretimde var olmayan sunuculara gitmek olurdu). Bolum bos doner ve `hata` sebebi soyler;
// kullanan ekran / API "kurum ayari yok" der.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
// Sunucu adi kurali ekranla (Admin > Kurum Ayari kaydi) ortak: shared/kurumAyari.cjs.
const { SUNUCU } = require('../../shared/kurumAyari.cjs');

// Onbellek anahtari: yol + mtime + boyut + inode + ctime. Kaba saat cozunurluklu dosya sisteminde ayni
// tikte ayni boyutla yapilan elle duzenleme de yakalanir (rename yeni inode, yerinde yazma yeni ctime).
const BOS_ONBELLEK = {
  yol: '',
  mtimeMs: -1,
  boyut: -1,
  ino: -1,
  ctimeMs: -1,
  veri: {},
  hata: null,
};
let onbellek = BOS_ONBELLEK;
const ayniDosya = (o, yol, st) =>
  o.yol === yol &&
  o.mtimeMs === st.mtimeMs &&
  o.boyut === st.size &&
  o.ino === st.ino &&
  o.ctimeMs === st.ctimeMs;

/** Ayar dosyasinin tamami -> { veri, hata }. Degisiklik zamani ayniysa onbellekten. */
function kurumAyari(env = process.env) {
  const ham = String(env.KURUM_AYAR_DOSYASI ?? '').trim();
  if (!ham) return { veri: {}, hata: 'KURUM_AYAR_DOSYASI tanimli degil' };
  const yol = path.resolve(ham);
  let st;
  try {
    st = fs.statSync(yol);
  } catch {
    return { veri: {}, hata: `KURUM_AYAR_DOSYASI okunamadi (${path.basename(yol)})` };
  }
  if (ayniDosya(onbellek, yol, st)) return onbellek;
  let veri = {};
  let hata = null;
  try {
    const n = JSON.parse(fs.readFileSync(yol, 'utf8'));
    if (n && typeof n === 'object' && !Array.isArray(n)) veri = n;
    else hata = 'KURUM_AYAR_DOSYASI bir JSON nesnesi degil';
  } catch {
    hata = 'KURUM_AYAR_DOSYASI gecerli bir JSON degil';
  }
  onbellek = {
    yol,
    mtimeMs: st.mtimeMs,
    boyut: st.size,
    ino: st.ino,
    ctimeMs: st.ctimeMs,
    veri,
    hata,
  };
  return onbellek;
}

/** Onbellegi bosaltir: Portal'dan yazilan dosya ayni boyut ve ayni zaman damgasiyla (kaba saat
 *  cozunurlugu olan dosya sistemi) eski veri sanilmasin. Okuma davranisi degismez. */
function kurumAyariOnbellekSifirla() {
  onbellek = BOS_ONBELLEK;
}

/** Noktali anahtar ('nginx.intranetSunuculari') -> { deger, hata }; yoksa deger undefined. */
function bolum(anahtar, env = process.env) {
  const { veri, hata } = kurumAyari(env);
  if (hata) return { deger: undefined, hata };
  let d = veri;
  for (const parca of String(anahtar).split('.')) {
    if (!d || typeof d !== 'object' || !Object.hasOwn(d, parca))
      return { deger: undefined, hata: `kurum ayarinda ${anahtar} yok` };
    d = d[parca];
  }
  return { deger: d, hata: null };
}

// Sunucu adi buyuk harfe cevrilir (envanter ve ekranlar boyle).
const buyuk = (v) => String(v).trim().toUpperCase();

/** Sunucu adi listesi -> { liste: string[] (BUYUK HARF), hata }. Gecersiz tek girdi atilir, soylenir. */
function sunucuListesi(anahtar, env = process.env) {
  const { deger, hata } = bolum(anahtar, env);
  if (hata) return { liste: [], hata };
  if (!Array.isArray(deger)) return { liste: [], hata: `kurum ayari ${anahtar} bir liste degil` };
  const liste = deger.filter((v) => typeof v === 'string' && SUNUCU.test(v.trim())).map(buyuk);
  const atilan = deger.length - liste.length;
  return { liste, hata: atilan ? `kurum ayari ${anahtar}: ${atilan} gecersiz girdi atildi` : null };
}

/** { anahtar: [sunucu...] } -> { harita: {ANAHTAR: string[]}, hata }. Anahtarlar buyuk harf. */
function sunucuHaritasi(anahtar, env = process.env) {
  const { deger, hata } = bolum(anahtar, env);
  if (hata) return { harita: {}, hata };
  if (!deger || typeof deger !== 'object' || Array.isArray(deger))
    return { harita: {}, hata: `kurum ayari ${anahtar} bir nesne degil` };
  const harita = {};
  let atilan = 0;
  for (const [k, v] of Object.entries(deger)) {
    const liste = Array.isArray(v)
      ? v.filter((x) => typeof x === 'string' && SUNUCU.test(x.trim()))
      : [];
    atilan += (Array.isArray(v) ? v.length : 1) - liste.length;
    harita[buyuk(k)] = liste.map(buyuk);
  }
  return {
    harita,
    hata: atilan ? `kurum ayari ${anahtar}: ${atilan} gecersiz girdi atildi` : null,
  };
}

/** Tek sunucu adi -> { ad: string (BUYUK) | '', hata }. */
function sunucuAdi(anahtar, env = process.env) {
  const { deger, hata } = bolum(anahtar, env);
  if (hata) return { ad: '', hata };
  if (typeof deger !== 'string' || !SUNUCU.test(deger.trim()))
    return { ad: '', hata: `kurum ayari ${anahtar} gecerli bir sunucu adi degil` };
  return { ad: buyuk(deger), hata: null };
}

module.exports = {
  kurumAyari,
  kurumAyariOnbellekSifirla,
  bolum,
  sunucuListesi,
  sunucuHaritasi,
  sunucuAdi,
};
