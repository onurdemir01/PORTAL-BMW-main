// scripts/shared-cjs-shim.cjs — shared/*.cjs dosyalarini DEV sunucusu icin ESM'e saran mantik.
//
// NEDEN AYRI DOSYA (2026-10-07): bu mantik vite.config.ts icindeydi ve disa aktarilan adlari
// `module.exports = { ... }` metnini REGEX ile okuyarak cikariyordu. Regex ILK eslesmeyi
// aliyordu; `shared/cryptoHubResources.cjs` tam da bu kisitlamayi anlatan bir yorum tasiyor
// ("Dev sunucusu shim'i yalniz `module.exports = { a, b }` bicimini anlar") ve o yorum gercek
// disa aktarimdan ONCE geliyor. Sonuc: shim `a` ve `b` adlarini disa aktariyor, Crypto Hub
// sayfasi dev sunucusunda "Export 'a' is not defined in module" ile HIC acilmiyordu.
//
// Artik adlar metinden TAHMIN EDILMEZ: modul Node'da gercekten yuklenir ve
// `Object.keys(module.exports)` kullanilir. Yorumlar, ic ice suslu parantezler ve
// `{ a: b }` bicimi sorun olmaktan cikar. Burada durmasinin sebebi test edilebilirlik:
// `src/__tests__/shared-cjs-shim.test.cjs` her shared modulu bu fonksiyondan gecirip
// sonucu GERCEK bir ES modulu olarak ice aktarir.
'use strict';

const AD = /^[A-Za-z_$][\w$]*$/;

/** Dosyanin GERCEK disa aktarim adlari. Yuklenemezse null (cagiran sarmayi atlar). */
function exportKeys(dosya) {
  const yol = require.resolve(dosya);
  // Dev sunucusu dosya degistikce yeniden sorar: onbellekteki eski hali kullanilmasin.
  delete require.cache[yol];
  try {
    const m = require(yol);
    return m && typeof m === 'object' ? Object.keys(m).filter((k) => AD.test(k)) : [];
  } catch {
    return null;
  }
}

/**
 * CommonJS kaynagini ESM'e sarar. Adlar dosyanin ust kapsamindaki degiskenlerle CAKISMAZ:
 * her biri `module.exports`tan okunup takma adla disa aktarilir.
 */
function wrapSharedCjs(code, keys) {
  const satirlar = keys.map((k, i) => `const __shim_e${i} = __shim_m[${JSON.stringify(k)}];`);
  const adlar = keys.map((k, i) => `__shim_e${i} as ${k}`);
  return (
    'const module = { exports: {} }; const exports = module.exports;\n' +
    `${code}\n` +
    'const __shim_m = module.exports;\n' +
    `${satirlar.join('\n')}\n` +
    (adlar.length ? `export { ${adlar.join(', ')} };\n` : '') +
    'export default __shim_m;\n'
  );
}

module.exports = { exportKeys, wrapSharedCjs };
