// server/smart/sablon-kalkani.cjs - Smart metadata sablonlari icin nunjucks kalkani.
//
// Neden: metadata sablonunu admin yazar ve sablon SUNUCUDA render edilir. nunjucks bir kum
// havuzu degildir: sablon icinden JS nesnelerinin ic ozelliklerine (constructor, __proto__ ...)
// erisilebilir ve oradan Function kurucusuna ulasilirsa sablon sunucuda kod calistirir. Yani
// "portal admin'i" yetkisi "sunucuda kabuk" yetkisine donusur. Bu dosya o kopruyu keser.
//
// Nasil: derlenmis sablon ozellik ve ad aramalarini nunjucks runtime'inin uc fonksiyonuyla
// yapar (memberLookup, contextOrFrameLookup, callWrap). Bunlar her cagride runtime nesnesinden
// okunur, yani o nesnedeki fonksiyonlari degistirmek derlenmis her sablonu kapsar. Kontrol
// calisma aninda yapilir: hesaplanan anahtar ("con" ~ "structor") metin taramasiyla yakalanmaz.
//
// Iki katman:
//   1. Ad: ENGELLI_ADLAR icindeki bir ozellik ya da ust duzey ad tanimsiz doner.
//   2. Deger: GUVENSIZ_DEGERLER icindeki bir deger (Function ailesi, Object, Reflect ...) hangi
//      yoldan gelirse gelsin tanimsiz doner ve cagrilamaz. Adin engellenmedigi dolambacli yollar
//      (ornegin bir tanimlayicinin "value" alani) burada kapanir.
// Tanimsiz donen deger ciktiya yazilmak istenirse throwOnUndefined render'i durdurur; Smart
// talebi acilmaz ve admin net bir hata gorur. Mesru sablonlar (degisken, kosul, filtre, metin
// metodu, dongu) degismeden calisir.
//
// Ek olarak: filtre ve test adlari yalniz ortamin KENDI kayitlarindan cozulur (kalitsal
// Object.prototype uyeleri filtre olarak cagrilamaz) ve range() en fazla RANGE_UST_SINIR eleman
// uretir (yanlis yazilmis bir sinir sureci bellek tasmasina goturmesin).
'use strict';

const ENGELLI_ADLAR = new Set([
  'constructor',
  '__proto__',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

const GUVENSIZ_DEGERLER = new Set(
  [
    Function,
    Object.getPrototypeOf(async function () {}).constructor,
    Object.getPrototypeOf(function* () {}).constructor,
    Object.getPrototypeOf(async function* () {}).constructor,
    Object,
    Reflect,
    Proxy,
    globalThis,
    globalThis.eval,
    globalThis.process,
    typeof require === 'function' ? require : null,
    typeof module === 'object' ? module : null,
  ].filter(Boolean),
);

const RANGE_UST_SINIR = 10000;
const KALKAN_ISARETI = Symbol.for('portal.smartSablonKalkani');

function anahtar(val) {
  return typeof val === 'symbol' ? val : String(val);
}

function guvensizMi(deger) {
  return (
    (typeof deger === 'function' || (typeof deger === 'object' && deger !== null)) &&
    GUVENSIZ_DEGERLER.has(deger)
  );
}

function guvenliMemberLookup(obj, val) {
  if (obj === undefined || obj === null) return undefined;
  if (guvensizMi(obj)) return undefined;
  const ad = anahtar(val);
  if (ENGELLI_ADLAR.has(ad)) return undefined;
  const deger = obj[ad];
  if (guvensizMi(deger)) return undefined;
  if (typeof deger === 'function') {
    return function (...args) {
      return deger.apply(obj, args);
    };
  }
  return deger;
}

function runtimeSertlestir(runtime) {
  if (runtime[KALKAN_ISARETI]) return runtime;
  const asilContextOrFrameLookup = runtime.contextOrFrameLookup;
  const asilCallWrap = runtime.callWrap;
  const asillar = {
    memberLookup: runtime.memberLookup,
    contextOrFrameLookup: asilContextOrFrameLookup,
    callWrap: asilCallWrap,
  };
  runtime.memberLookup = guvenliMemberLookup;
  runtime.contextOrFrameLookup = function guvenliContextOrFrameLookup(context, frame, name) {
    if (ENGELLI_ADLAR.has(anahtar(name))) return undefined;
    const deger = asilContextOrFrameLookup(context, frame, name);
    return guvensizMi(deger) ? undefined : deger;
  };
  runtime.callWrap = function guvenliCallWrap(obj, name, context, args) {
    if (guvensizMi(obj)) {
      throw new Error('Unable to call `' + name + '`, which is not allowed in templates');
    }
    return asilCallWrap(obj, name, context, args);
  };
  Object.defineProperty(runtime, KALKAN_ISARETI, { value: asillar, configurable: true });
  return runtime;
}

function runtimeKalkaniniKaldir(runtime) {
  const asillar = runtime[KALKAN_ISARETI];
  if (!asillar) return;
  Object.assign(runtime, asillar);
  delete runtime[KALKAN_ISARETI];
}

function sinirliRange(asilRange) {
  return function range(start, stop, step) {
    let bas = start;
    let son = stop;
    let adim = step;
    if (typeof son === 'undefined') {
      son = bas;
      bas = 0;
      adim = 1;
    } else if (!adim) {
      adim = 1;
    }
    const adet = Math.ceil((Number(son) - Number(bas)) / Number(adim));
    if (adet > RANGE_UST_SINIR) {
      throw new Error(`range() en fazla ${RANGE_UST_SINIR} eleman uretebilir (istenen: ${adet})`);
    }
    return asilRange(start, stop, step);
  };
}

function ortamSertlestir(env) {
  const kendi = (nesne, ad) => Object.prototype.hasOwnProperty.call(nesne, ad);
  env.getFilter = function getFilter(name) {
    if (!kendi(this.filters, name) || !this.filters[name]) {
      throw new Error('filter not found: ' + name);
    }
    return this.filters[name];
  };
  env.getTest = function getTest(name) {
    if (!kendi(this.tests, name) || !this.tests[name]) {
      throw new Error('test not found: ' + name);
    }
    return this.tests[name];
  };
  if (typeof env.globals.range === 'function') {
    env.addGlobal('range', sinirliRange(env.globals.range));
  }
  return env;
}

// Tek giris noktasi: runtime'i (surec genelinde, bir kez) ve verilen ortami sertlestirir.
function sablonKalkaniKur(nunjucks, env) {
  runtimeSertlestir(nunjucks.runtime);
  return ortamSertlestir(env);
}

module.exports = {
  sablonKalkaniKur,
  runtimeSertlestir,
  runtimeKalkaniniKaldir,
  guvenliMemberLookup,
  ENGELLI_ADLAR,
  GUVENSIZ_DEGERLER,
  RANGE_UST_SINIR,
  KALKAN_ISARETI,
};
