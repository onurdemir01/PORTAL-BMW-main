// server/nginx-loadtest/py-bicim.cjs -- Python int(str) / float(str) soz dizimi (alt cizgi ayiracli
// rakamlar dahil). analiz.cjs (karsilastir.py portu) ve sonuc.cjs (kosu dizini okuyucu) ayni kurali
// kullanir; iki modul birbirini require etmez, ikisi de bunu kullanir.
//
// inf / nan burada kabul edilmez: sonlu olmayan deger zaten null'a doner (cagiranlar ayrica bakar).
// Eski tek desenli yazimla (`^[+-]?(?:D(?:\.(?:D)?)?|\.D)(?:[eE][+-]?D)?$`, D = rakam grubu) birebir
// ayni kabul / ret: __tests__/py-bicim.test.js.
'use strict';

// Rakam grubu: rakamla baslar ve biter; iki rakam arasinda en cok bir alt cizgi ('1_000' evet;
// '1__0', '_1', '1_' hayir).
const RAKAM_GRUBU = /^\d(?:_?\d)*$/;

const rakamGrubu = (s) => RAKAM_GRUBU.test(s);
const isaretsiz = (s) => (s[0] === '+' || s[0] === '-' ? s.slice(1) : s);

/** Python int(str): istege bagli isaret + rakam grubu. */
function pyTamsayiBicimi(s) {
  return rakamGrubu(isaretsiz(s));
}

/**
 * Python float(str), sonlu sayilar: istege bagli isaret, mantis (`A`, `A.`, `A.B` ya da `.B`; A ve B
 * rakam grubu), istege bagli us (`e` / `E`, istege bagli isaret, rakam grubu).
 */
function pyOndalikBicimi(s) {
  const govde = isaretsiz(s);
  const e = govde.search(/[eE]/);
  if (e >= 0 && !rakamGrubu(isaretsiz(govde.slice(e + 1)))) return false;
  const mantis = e >= 0 ? govde.slice(0, e) : govde;
  const nokta = mantis.indexOf('.');
  if (nokta < 0) return rakamGrubu(mantis);
  const tam = mantis.slice(0, nokta);
  const kesir = mantis.slice(nokta + 1);
  if (tam === '') return rakamGrubu(kesir);
  return rakamGrubu(tam) && (kesir === '' || rakamGrubu(kesir));
}

module.exports = { pyTamsayiBicimi, pyOndalikBicimi };
