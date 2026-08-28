// LogX: dosya boyutu bicimlendirme ve toplama.
//
// NEDEN VAR: uretimde "a.toFixed is not a function" ile LogX > JBoss8 akisinda sayfa
// cizilemedi. Kesif sonucu playbook set_stats'tan geldigi icin boyutlar TIPTE number,
// GERCEKTE string olabiliyor.
//
// Fonksiyonlar KAYNAKTAN cikarilip calistirilir. Elle kopyalanmis bir kopyayi test
// etmek, kaynak degistiginde testin sessizce alakasizlasmasi demek olurdu - nitekim bu
// dosyanin ilk halinde fmtSize FileSelectionStep.tsx icindeydi, sonra paylasilan
// logFileMeta.ts'e tasindi ve HATA AYNEN TASINDI. Test yolu takip etmeli.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'components', 'logx_v2', 'shared', 'logFileMeta.ts');

function loadFns() {
  const src = fs.readFileSync(SRC, 'utf-8');
  const grab = (name) => {
    const start = src.indexOf(`export function ${name}(`);
    if (start < 0) throw new Error(`${name} bulunamadi (tasinmis olabilir - testi guncelleyin)`);
    let depth = 0, end = -1;
    for (let k = src.indexOf('{', start); k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    return src.slice(start, end).replace(/^export\s+/, '');
  };
  // TS tip notasyonlarini soy - Node ham TS calistiramaz.
  const strip = (code) => code
    .replace(/:\s*unknown/g, '')
    .replace(/\)\s*:\s*string\s*\{/, ') {')
    .replace(/\)\s*:\s*number\s*\{/, ') {')
    .replace(/bytes\?\s*:\s*number/g, 'bytes')
    .replace(/(\w)\s*:\s*number\b/g, '$1');
  const code = strip(grab('toNumericSize')) + '\n' + strip(grab('fmtSize'))
    + '\nreturn { toNumericSize, fmtSize };';
  // eslint-disable-next-line no-new-func
  return new Function(code)();
}

const { toNumericSize, fmtSize } = loadFns();

test('SAYI boyutlar dogru bicimlenir', () => {
  assert.strictEqual(fmtSize(512), '512 B');
  assert.strictEqual(fmtSize(1024), '1.0 KB');
  assert.strictEqual(fmtSize(1048576), '1.0 MB');
});

test('STRING boyutlar cokmez (uretimdeki hata)', () => {
  // 1024 ALTI: onceki halde "toFixed is not a function" ile patliyordu.
  assert.strictEqual(fmtSize('512'), '512 B');
  assert.strictEqual(fmtSize('900'), '900 B');
  assert.strictEqual(fmtSize('1'), '1 B');
  // 1024 USTU zaten calisiyordu - regresyon olmadigini dogrula.
  assert.strictEqual(fmtSize('1024'), '1.0 KB');
  assert.strictEqual(fmtSize('1048576'), '1.0 MB');
});

test('bos/sifir/gecersiz degerler bos dize doner, patlamaz', () => {
  for (const v of [0, '0', null, undefined, '', 'abc', NaN, -5, '-5', {}, []]) {
    assert.strictEqual(fmtSize(v), '', JSON.stringify(v));
  }
});

test('toNumericSize: toplama icin guvenli sayi uretir', () => {
  assert.strictEqual(toNumericSize('512'), 512);
  assert.strictEqual(toNumericSize(512), 512);
  assert.strictEqual(toNumericSize('0'), 0);
  assert.strictEqual(toNumericSize('abc'), 0);
  assert.strictEqual(toNumericSize(undefined), 0);
  assert.strictEqual(typeof toNumericSize('512'), 'number');
});

test('TOPLAM: normalize edilmis boyutlar birlestirilmez, toplanir', () => {
  // Onceki hal: 0 += "512" -> "0512", sonra "05122048" ... hem yanlis hem cokme.
  const sizes = ['512', '2048', '100'].map(toNumericSize);
  const bytes = sizes.reduce((n, v) => n + v, 0);
  assert.strictEqual(bytes, 2660);
  assert.strictEqual(typeof bytes, 'number');
  assert.strictEqual(fmtSize(bytes), '2.6 KB');
});
