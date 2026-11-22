// server/__tests__/fixtures/kod-deseni.cjs — kaynak metnine bakan bekcilerin bicimden bagimsiz yardimcisi.
//
// NEDEN VAR (2026-11-20, kurumsal is #52): repo bir kez Prettier'dan gecti. Kaynak metnine regex ile
// bakan bekciler tek satirlik yazima bagliydi: zincir satirlara bolununce, "..." '...' olunca, nesneye
// sondaki virgul eklenince bekci DUSTU ama kod ayniydi. Bekcinin sinadigi sey yazim degil yapi:
// ayni belirtecler ayni sirada. Bu yardimci yalniz yazim farkini yok sayar:
//   - belirtecler arasindaki bosluk / satir sonu (`(`, `{`, `[` sonrasi; `)`, `}`, `]` oncesi, `,` / `;`
//     sonrasi, zincirdeki `.` oncesi; desendeki her bosluk);
//   - dizgi tirnagi (' ya da ");
//   - kapanistan once sondaki virgul;
//   - JSX'te bitisik etiketler arasindaki satir sonu (`><`).
// Belirteclerin kendisi, sirasi ve desenin geri kalani (sinif, gruplar, niceleyiciler) AYNI kalir.
'use strict';

const NICELEYICI = new Set(['*', '+', '?', '{']);

/** Tek satirlik kod icin yazilmis deseni bicimden bagimsiz hale getirir. */
function esnek(re) {
  const k = re.source;
  let out = '';
  let sinif = false;
  // Her dal kac karakter tukettigini `adim`a yazar (kacisli cift 2, niceleyici `{m,n}` tamami).
  let i = 0;
  while (i < k.length) {
    const c = k[i];
    let adim = 1;
    if (c === '\\') {
      const ikili = k.slice(i, i + 2);
      adim = 2;
      const n = ikili[1];
      // Ardindan niceleyici geliyorsa (`\(?`) belirtecin kendisi niceleniyor: araya bir sey girmez.
      if (sinif || NICELEYICI.has(k[i + 2])) out += ikili;
      else if (n === '(' || n === '{' || n === '[') out += `${ikili}\\s*`;
      else if (n === ')' || n === '}' || n === ']') out += `,?\\s*${ikili}`;
      else if (n === '.') out += `\\s*${ikili}`;
      else out += ikili;
    } else if (c === '{' && /^\{\d+(,\d*)?\}/.test(k.slice(i))) {
      // Niceleyici ({0,200}): oldugu gibi.
      const son = k.indexOf('}', i);
      out += k.slice(i, son + 1);
      adim = son + 1 - i;
    } else if (sinif) {
      out += c;
      if (c === ']') sinif = false;
    } else if (c === '[') {
      sinif = true;
      out += c;
    } else if (c === ' ') {
      out += NICELEYICI.has(k[i + 1]) ? '\\s' : '\\s*';
    } else if (c === "'" || c === '"') {
      out += `['"]`;
    } else if (c === '>') {
      // JSX: cok satirli ozniteliklerde `>` kendi satirina iner (`}}>` / `">` oncesi bosluk) ve
      // kardes / ic ice etiketler ayri satirlara duser (`><` -> `>\n  <`).
      const once = k[i - 1] === '}' || k[i - 1] === '"' || k[i - 1] === "'" ? '\\s*' : '';
      out += `${once}>${k[i + 1] === '<' ? '\\s*' : ''}`;
    } else if ((c === ',' || c === ';') && !NICELEYICI.has(k[i + 1])) {
      out += `${c}\\s*`;
    } else {
      out += c;
    }
    i += adim;
  }
  return new RegExp(out, re.flags);
}

const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Duz metin parcasini (tek satirlik kod) bicimden bagimsiz bir desene cevirir. */
function parcaDeseni(parca) {
  return esnek(new RegExp(kacis(parca)));
}

/** `parca`nin `metin`de `bas`tan sonraki ilk konumu ve eslesen uzunluk; yoksa { konum: -1 }. */
function parcaBul(metin, parca, bas = 0) {
  const birebir = metin.indexOf(parca, bas);
  if (birebir >= 0) return { konum: birebir, uzunluk: parca.length };
  const re = new RegExp(parcaDeseni(parca).source, 'g');
  re.lastIndex = bas;
  const m = re.exec(metin);
  return m ? { konum: m.index, uzunluk: m[0].length } : { konum: -1, uzunluk: 0 };
}

/** `metin`, tek satirlik `parca`yi (bicimden bagimsiz) iceriyor mu? */
function iceriyor(metin, parca) {
  return parcaBul(metin, parca).konum >= 0;
}

/** `metin.indexOf(parca, bas)` gibi; bicimden bagimsiz. */
function konum(metin, parca, bas = 0) {
  return parcaBul(metin, parca, bas).konum;
}

module.exports = { esnek, parcaDeseni, parcaBul, iceriyor, konum };
