// server/__tests__/sql-interpolation.test.cjs — SQL sablonuna ISTEK VERISI girmesin.
//
// Bu repo SQL'i parametreyle yaziyor (`db.query(sql, params)`) ve tarama sonucunda
// ISTEK VERISININ dogrudan SQL'e aktigi TEK BIR yer bile bulunmadi (2026-09-07,
// 68 enterpolasyon incelendi). Bu bekci o durumu KORUR.
//
// NEDEN GEREKLI: SQL sablonundaki `${...}` her zaman kotu degildir — repoda mesru
// kullanimlari var:
//   * `${placeholders}`        -> "$1,$2,$3" gibi URETILMIS yer tutucular
//   * `${quoteIdent(col)}`     -> tanimlayici kacisi
//   * `${Number(limit) || 25}` -> sayisal zorlama
//   * `${noteP}`               -> "$4" gibi yer tutucu ADI (deger params'tan gider)
// Hepsini yasaklamak gurultu uretir ve bekci gormezden gelinir. Yasaklanan sey
// DAR ve KESIN: `req.*` (body/query/params/headers) degerinin SQL metnine
// dogrudan gomulmesi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..');

function serverFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.cjs')) out.push(p);
    }
  })(SERVER);
  return out;
}

// `.query(`...`)` cagrisindaki sablonu ve icindeki `${...}` ifadelerini cikarir.
function sqlInterpolations(src) {
  const out = [];
  const re = /\.query\(\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    for (const v of [...m[1].matchAll(/\$\{([^}]*)\}/g)]) out.push({ expr: v[1].trim(), line });
  }
  return out;
}

// DAR VE KESIN: yalnizca `req` NESNESINDEN gelen degerler. `params.length` gibi
// YEREL bir dizinin uzunlugu tehlikeli DEGILDIR — ilk denememde `\bparams\b`
// desenine takilip dort YANLIS POZITIF uretmistim (o `params` SQL parametre
// dizisiydi, `req.params` degil).
const REQUEST_DATA = /\breq\s*[.[]|\brequest\s*[.[]/;

test('SQ1 istek verisi SQL metnine dogrudan gomulmuyor', () => {
  const offenders = [];
  let scanned = 0;
  for (const f of serverFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    for (const { expr, line } of sqlInterpolations(src)) {
      scanned++;
      if (REQUEST_DATA.test(expr)) {
        offenders.push(`${path.relative(SERVER, f)}:${line}  \${${expr}}`);
      }
    }
  }
  // Toplayici yanlis yere bakiyorsa "hic ihlal yok" diye SESSIZCE yesil kalmasin.
  assert.ok(
    scanned >= 40,
    `yalnizca ${scanned} SQL enterpolasyonu incelendi — toplayici SQL cagrilarini bulamiyor olabilir`,
  );
  assert.deepEqual(
    offenders,
    [],
    'ISTEK VERISI dogrudan SQL metnine gomulmus (SQL enjeksiyonu):\n' +
      offenders.join('\n') +
      '\n\nDegeri SQL metnine yazmayin: `db.query(sql, params)` ile parametre olarak gecirin.',
  );
});

test('SQ2 tanimlayici enterpolasyonu KACISTAN geciyor', () => {
  // Tablo/kolon adlari parametre OLAMAZ (SQL dilbilgisi izin vermez), o yuzden
  // enterpole edilirler. Ama o zaman da kacistan gecmeleri gerekir. Envanter
  // modulu bunu `quoteIdent()` ile yapiyor; bu bekci o cagrinin kaybolmamasini
  // saglar — kaldirilirsa kolon adi ham gecer.
  const inv = fs.readFileSync(path.join(SERVER, 'inventory/index.cjs'), 'utf8');
  assert.match(inv, /function quoteIdent\(/, 'quoteIdent tanimi kaybolmus');
  const uses = (inv.match(/quoteIdent\(/g) || []).length;
  assert.ok(
    uses >= 4,
    `quoteIdent yalnizca ${uses} yerde kullaniliyor — ham tanimlayici sizmis olabilir`,
  );
});

test('SQ3 `db.query` ikinci argumani (parametreler) GERCEKTEN kullaniliyor', () => {
  // Parametreli API'nin varligi tek basina bir sey ifade etmez; kullanilmiyorsa
  // herkes sablona yazmaya baslar. En az bu kadar cagri parametre gecirmeli.
  let withParams = 0;
  for (const f of serverFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    withParams += (src.match(/\.query\(\s*`[\s\S]*?`\s*,\s*\[/g) || []).length;
  }
  assert.ok(
    withParams >= 50,
    `yalnizca ${withParams} cagri parametre gecirmis — parametreli yol terk edilmis olabilir`,
  );
});
