// server/retirement/web-liste.cjs — retirement hedefinin web (vhost) listesi yardimcilari.
//
// AYNI VHOST IKI KEZ (uretim 2026-10-08, job 3387660 + 3387662): kesif ayni host / conf /
// ServerName'i iki kaynaktan getirebiliyor; liste tekillestirilmediginde web adimi ayni vhost icin
// IKI is baslatiyordu (biri blogu yorumluyor, digeri "zaten yorumlu" diyordu) ve onizleme ayni
// blogu iki kez gosteriyordu. Anahtar: HOST (buyuk harf) | conf yolu | ServerName (kucuk harf).
'use strict';

function webAnahtar(w) {
  return `${String(w?.host || '').toUpperCase()}|${String(w?.confFile || '')}|${String(w?.serverName || '').toLowerCase()}`;
}

/** Ilk geleni tutar; atilan sayisini da dondurur (cagiran degisikligi yazip olay dusebilsin). */
function webTekille(liste) {
  if (!Array.isArray(liste)) return { liste, atilan: 0 };
  const gorulen = new Set();
  const out = [];
  for (const w of liste) {
    const k = webAnahtar(w);
    if (gorulen.has(k)) continue;
    gorulen.add(k);
    out.push(w);
  }
  return { liste: out, atilan: liste.length - out.length };
}

module.exports = { webAnahtar, webTekille };
