// server/__tests__/fixtures/regex-esdeger.cjs — duzenli ifade esdegerlik yardimcisi (Sonar S8786).
//
// NEDEN VAR: S8786 ("dogrusal olmayan geri izleme") duzeltmelerinde yeni desen eskisiyle AYNI sonucu
// vermeli (eslesme / gruplar / replace ciktisi) ve kotu girdide hizli bitmeli. Bu yardimciyi kullanan
// testler:
//   - yeni deseni KAYNAKTAN okur (literalAl): kod degisirse test degisen deseni sinar;
//   - eski deseni yalniz REFERANS olarak tutar;
//   - ikisini ayni deterministik girdilerde karsilastirir (token alfabesi + ortak uclar + elle uclar);
//   - kotu girdide (on binlerce karakter) yeni desenin suresini olcer (genis sinir, titremesin).
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..', '..');

/** Depo kokune gore dosya metni. */
function kaynak(goreli) {
  return fs.readFileSync(path.join(KOK, goreli), 'utf8');
}

/**
 * `onek` metninden HEMEN sonra gelen regex literalini RegExp olarak dondurur. `onek` metinde tam bir
 * kez gecmeli: belirsiz bir capa sessizce baska bir deseni sinamasin.
 */
function literalAl(metin, onek) {
  const i = metin.indexOf(onek);
  assert.ok(i >= 0, `kaynakta yok: ${JSON.stringify(onek)}`);
  assert.equal(metin.indexOf(onek, i + 1), -1, `capa birden cok geciyor: ${JSON.stringify(onek)}`);
  const bas = i + onek.length;
  assert.equal(metin[bas], '/', `capadan sonra regex literali yok: ${JSON.stringify(onek)}`);
  let sinif = false;
  let k = bas + 1;
  for (; k < metin.length; k += 1) {
    const c = metin[k];
    assert.notEqual(c, '\n', `literal satir sonuna kadar kapanmadi: ${JSON.stringify(onek)}`);
    if (c === '\\') k += 1;
    else if (sinif) sinif = c !== ']';
    else if (c === '[') sinif = true;
    else if (c === '/') break;
  }
  const bayrak = /^[a-z]*/.exec(metin.slice(k + 1))[0];
  return new RegExp(metin.slice(bas + 1, k), bayrak);
}

/** Deterministik xorshift32: ayni tohum, ayni girdiler (bulunan fark yeniden uretilebilir). */
function rastgele(tohum) {
  let x = tohum >>> 0 || 0x9e3779b9;
  return (n) => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x % n;
  };
}

// Her desene verilen ortak uclar: bos, yalniz bosluk, satir sonlari, Unicode bosluklar, Turkce harfler.
const ORTAK_UCLAR = Object.freeze([
  '',
  ' ',
  '   ',
  '\t',
  '\n',
  '\r\n',
  ' \t\r\n',
  '\u00a0\u2028\u2029\u3000\ufeff',
  'çğıİöşüÇĞÖŞÜ',
  'İstanbul şube: ğ / ş',
]);

/**
 * Girdi listesi: ortak uclar + elle uclar + `adet` rastgele token dizisi + her ilk dort tokenin `uzun`
 * kez tekrari (cok uzun girdi; dogruluk icin, hiz ayrica olculur). `onek` (metin ya da metin listesi):
 * rastgele girdilerin yarisinin basina eklenir; capali desenler boylece sik tetiklenir.
 */
function girdiler({
  tokenlar,
  adet = 3000,
  maks = 24,
  el = [],
  onek = '',
  tohum = 1,
  uzun = 1000,
}) {
  const r = rastgele(tohum);
  const out = [...ORTAK_UCLAR, ...el];
  for (let n = 0; n < adet; n += 1) {
    const o = Array.isArray(onek) ? onek[r(onek.length)] : onek;
    let s = o && r(2) ? o : '';
    const uz = r(maks + 1);
    for (let k = 0; k < uz; k += 1) s += tokenlar[r(tokenlar.length)];
    out.push(s);
  }
  const ilk = Array.isArray(onek) ? onek[0] : onek;
  for (const t of tokenlar.slice(0, 4)) out.push(ilk + t.repeat(uzun));
  return out;
}

const KIPLER = Object.freeze({
  exec: (re, s) => {
    const m = new RegExp(re.source, re.flags).exec(s);
    return m ? JSON.stringify({ g: [...m], i: m.index }) : null;
  },
  test: (re, s) => new RegExp(re.source, re.flags).test(s),
  replace: (re, s, yerine) => s.replace(new RegExp(re.source, re.flags), yerine),
  // islev karsilastirmasi: eski / yeni birer islev (girdi -> sonuc)
  fn: (f, s) => JSON.stringify(f(s)) ?? 'undefined',
});

/**
 * Eski ve yeni ayni sonucu verir mi? Her RegExp her cagrida yeniden kurulur (g / lastIndex durumu
 * tasinmaz). `enAzEslesen`: anlamli (eslesen / degistiren) girdi sayisi alt siniri; alfabe deseni hic
 * tetiklemiyorsa test bos gecmesin.
 */
function esdeger({ eski, yeni, kip = 'exec', yerine = '', enAzEslesen = 1, ...secenek }) {
  const f = (re, s) => KIPLER[kip](re, s, yerine);
  const liste = girdiler(secenek);
  let eslesen = 0;
  for (const s of liste) {
    const o = f(eski, s);
    const y = f(yeni, s);
    if (y !== o) {
      assert.fail(
        `fark: girdi=${JSON.stringify(s)} eski=${JSON.stringify(o)} yeni=${JSON.stringify(y)}`,
      );
    }
    if (o !== null && o !== false && o !== s && o !== JSON.stringify(s) && o !== 'null')
      eslesen += 1;
  }
  assert.ok(
    eslesen >= enAzEslesen,
    `yalniz ${eslesen}/${liste.length} girdi eslesti (beklenen >= ${enAzEslesen})`,
  );
  return { adet: liste.length, eslesen };
}

/** Yeni desen (ya da islev) kotu girdide `sinirMs` altinda biter mi? */
function hizli(yeni, girdi, { kip = 'exec', yerine = '', sinirMs = 200 } = {}) {
  const t0 = performance.now();
  KIPLER[kip](yeni, girdi, yerine);
  const ms = performance.now() - t0;
  assert.ok(
    ms < sinirMs,
    `kotu girdi (${girdi.length} karakter): ${ms.toFixed(1)} ms >= ${sinirMs} ms`,
  );
  return ms;
}

module.exports = { kaynak, literalAl, girdiler, esdeger, hizli, rastgele, ORTAK_UCLAR, KOK };
