// server/audit/__tests__/denetim-env-normalize.test.cjs — B4/B5.
//
// B4 · SESSIZ VERI KAYBI. Denetim matrisinde env degeri UC ayri yerde normalize
//      ediliyordu ve biri FARKLIYDI: sutun listesi ile istatistikler
//      `.trim().toUpperCase() || '(bos)'`, hucre anahtari ise sadece `.toUpperCase()`.
//      Sonuc: env'i bosluklu (" qa ") ya da bos olan satirlar " QA " / "" anahtari
//      uretiyor, bu anahtarlar sutun listesinde OLMADIGI icin hucre HICBIR SUTUNA
//      dusmuyordu. Ekranda hata yok, uyari yok — veri yalnizca KAYBOLUYORDU.
//
// B5 · Kaynak dosyada HAM U+0000 bayti: git dosyayi BINARY sayiyor, `git diff` ve
//      `git blame` calismiyordu — denetim modulunde yapilan degisiklik kod
//      incelemesinde hic gorunmuyordu. Ayni ayirici denetim.cjs'te zaten KACIS
//      DIZISI olarak yaziliydi; iki dosya arasinda tutarsizlik vardi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DENETIM = path.join(__dirname, '..', 'denetim.cjs');
const NGINX_LOC = path.join(__dirname, '..', 'nginx-locations.cjs');
const SRC = fs.readFileSync(DENETIM, 'utf8');

test('B4: env normalize TEK bir fonksiyondan gecer', () => {
  assert.match(SRC, /const normEnv = \(v\) => String\(v \|\| ''\)\.trim\(\)\.toUpperCase\(\) \|\| '\(bos\)';/);
});

test('B4: hucre anahtari artik trimsiz normalize EDILMIYOR', () => {
  // Matris blogu normEnv'i kullanmali; eski kalibin tek bir kalintisi bile
  // bosluklu/bos env satirlarini yeniden kaybettirir.
  const matrix = SRC.slice(SRC.indexOf('const SEVERITY'), SRC.indexOf('const SEVERITY') + 2000);
  assert.ok(
    !/String\(r\.env \|\| ''\)\.toUpperCase\(\)/.test(matrix),
    'hucre anahtari hala trimsiz normalize ediliyor — bosluklu env satirlari kaybolur'
  );
  assert.ok((matrix.match(/normEnv\(/g) || []).length >= 1, 'matris blogu normEnv kullanmiyor');
});

test('B4: normalize davranisi — bosluklu ve bos degerler sutunla ESLESIR', () => {
  const m = SRC.match(/const normEnv = .*;/);
  assert.ok(m, 'normEnv bulunamadi');
  const normEnv = new Function(`${m[0]}; return normEnv;`)();
  assert.equal(normEnv(' qa '), 'QA', 'bosluklu env kanonik sutuna dusmeli');
  assert.equal(normEnv(''), '(bos)');
  assert.equal(normEnv(null), '(bos)');
  assert.equal(normEnv('Prod'), 'PROD');
});

test('B5: denetim kaynak dosyalarinda HAM NUL bayti yok', () => {
  for (const f of [DENETIM, NGINX_LOC]) {
    const buf = fs.readFileSync(f);
    assert.equal(buf.includes(0), false,
      `${path.basename(f)} ham NUL iceriyor — git dosyayi binary sayar, diff/blame calismaz`);
  }
});

test('B5: ayirici hala U+0000 (davranis degismedi, yalnizca yazimi degisti)', () => {
  const ngx = fs.readFileSync(NGINX_LOC, 'utf8');
  const m = ngx.match(/\.map\(\(x\) => String\(x \|\| ''\)\)\.join\('(.*?)'\);/);
  assert.ok(m, 'keyOf ayiricisi bulunamadi');
  assert.equal(m[1], '\\u0000', 'ayirici kacis dizisiyle yazilmali');
  assert.equal(new Function(`return '${m[1]}';`)(), String.fromCharCode(0),
    'kacis dizisi gercekten NUL uretmeli — ayirici davranisi degismemeli');
});
