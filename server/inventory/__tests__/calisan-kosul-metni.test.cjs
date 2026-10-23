// server/inventory/__tests__/calisan-kosul-metni.test.cjs - CK1..CK5 (2026-10-23).
//
// Envanter "Calisan kosul" satiri, sorgunun WHERE'ini baglanan degerlerle yazmak icin vardi
// (2026-10-01). Degistirme deseni `new RegExp('@' + ad + '\b')` ile kuruluyordu; JS metninde
// '\b' GERI ALMA karakteridir, desen hic eslesmiyordu ve ekranda `@filter0`, `@af1` gibi yer
// tutucular kaliyordu. Mevcut GF4 yalniz kaynak metnini ariyordu, davranisi olcmuyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  _calisanKosulMetni: calisanKosulMetni,
  _buildAdvancedWhereClause: buildAdvancedWhereClause,
} = require('../index.cjs');

function sahteReq() {
  return {
    parameters: {},
    input(n, t, v) {
      this.parameters[n] = { name: n, type: t, value: v };
    },
  };
}

test('CK1: gercek WHERE uretecinin parametreleri degerleriyle yazilir (af1 / af10 karismaz)', () => {
  const req = sahteReq();
  const filtreler = Array.from({ length: 12 }, (_, i) => ({
    col: 'app_name',
    op: 'equals',
    value: `deger${i}`,
  }));
  const where = buildAdvancedWhereClause(
    { mode: 'AND', filters: filtreler },
    ['app_name'],
    req,
    new Map([['app_name', 'nvarchar']]),
  );
  assert.match(where, /@af10\b/, 'on kosul: en az 11 parametre uretilmeli');
  const metin = calisanKosulMetni(`WHERE ${where}`, req.parameters);
  assert.ok(!/@af\d/.test(metin), `yer tutucu kaldi: ${metin}`);
  for (let i = 0; i < 12; i += 1) assert.ok(metin.includes(`'deger${i}'`), `deger${i} yok`);
  assert.ok(!metin.includes("'deger1'0"), 'af10 af1 ile karisti');
});

test('CK2: deger metni yeniden islenmez; ozel diziler ve tirnak dogru yazilir', () => {
  const p = {
    filter0: { value: "%@filter1 $& o'neil%" },
    filter1: { value: 'ikinci' },
  };
  const metin = calisanKosulMetni('WHERE a LIKE @filter0 AND b LIKE @filter1', p);
  assert.equal(metin, "WHERE a LIKE '%@filter1 $& o''neil%' AND b LIKE 'ikinci'");
});

test('CK3: bilinmeyen ad ve sayfa parametreleri oldugu gibi kalir; sayi tirnaksiz', () => {
  const p = { limitVal: { value: 50 }, offsetVal: { value: 0 }, mf0: { value: 7 } };
  assert.equal(
    calisanKosulMetni('WHERE x IN (@mf0, @yok) ORDER BY 1 OFFSET @offsetVal FETCH @limitVal', p),
    'WHERE x IN (7, @yok) ORDER BY 1 OFFSET @offsetVal FETCH @limitVal',
  );
  assert.equal(calisanKosulMetni('', p), '');
});

test('CK4: /query isleyicisi gosterim metnini yardimcidan alir', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /_appliedWhere = calisanKosulMetni\(w, req2\.parameters\);/);
});

// CK5 tarayicisi: `new RegExp(...)` argumanlarindaki METIN sabitlerinde tek ters bolu + b.
// ESLint no-useless-escape bunu yakalamaz ('\b' gecerli bir kacis, sadece anlami farkli).
function regexpMetinlerindeGeriAlma(kaynak) {
  const bulgular = [];
  const satirBasi = (i) => kaynak.lastIndexOf('\n', i) + 1;
  let ara = 0;
  for (;;) {
    const bas = kaynak.indexOf('new RegExp(', ara);
    if (bas < 0) break;
    ara = bas + 1;
    const satir = kaynak.slice(satirBasi(bas), bas);
    if (/^\s*\/\/|(^|\s)\/\/\s/.test(satir)) continue;
    let i = bas + 'new RegExp('.length;
    let derinlik = 1;
    while (i < kaynak.length && derinlik > 0) {
      const c = kaynak[i];
      if (c === '(') derinlik += 1;
      else if (c === ')') derinlik -= 1;
      else if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        let icerik = '';
        while (j < kaynak.length && kaynak[j] !== c) {
          if (kaynak[j] === '\\') {
            icerik += kaynak.slice(j, j + 2);
            j += 2;
          } else {
            icerik += kaynak[j];
            j += 1;
          }
        }
        if (/(^|[^\\])(\\\\)*\\b/.test(icerik)) {
          bulgular.push(kaynak.slice(0, bas).split('\n').length);
        }
        i = j;
      }
      i += 1;
    }
  }
  return bulgular;
}

function kodDosyalari(dizin, out = []) {
  for (const g of fs.readdirSync(dizin, { withFileTypes: true })) {
    if (g.name === 'node_modules' || g.name === 'dist' || g.name.startsWith('.')) continue;
    const yol = path.join(dizin, g.name);
    if (g.isDirectory()) kodDosyalari(yol, out);
    else if (/\.(c|m)?[jt]sx?$/.test(g.name)) out.push(yol);
  }
  return out;
}

test('CK5: RegExp metin argumanlarinda geri alma karakteri yok (ve tarayici kor degil)', () => {
  const kok = path.join(__dirname, '..', '..', '..');
  const ihlaller = [];
  let taranan = 0;
  for (const d of ['server', 'src', 'scripts', 'shared']) {
    const dizin = path.join(kok, d);
    if (!fs.existsSync(dizin)) continue;
    for (const dosya of kodDosyalari(dizin)) {
      if (dosya === __filename) continue;
      taranan += 1;
      for (const satir of regexpMetinlerindeGeriAlma(fs.readFileSync(dosya, 'utf8'))) {
        ihlaller.push(`${path.relative(kok, dosya)}:${satir}`);
      }
    }
  }
  assert.deepEqual(ihlaller, []);
  assert.ok(taranan > 100, `tarama kor: ${taranan} dosya`);
  // Tarayicinin kendisi: eski hatali satir yakalanir; dogru bicimler yakalanmaz.
  const bs = '\\';
  assert.deepEqual(
    regexpMetinlerindeGeriAlma(`x.replace(\n  new RegExp('@' + ad + '${bs}b', 'g'),\n)`),
    [2],
  );
  assert.deepEqual(regexpMetinlerindeGeriAlma(`new RegExp(\`^${bs}b\${a}\`)`), [1]);
  assert.deepEqual(regexpMetinlerindeGeriAlma(`new RegExp('@' + ad + '${bs}${bs}b', 'g')`), []);
  assert.deepEqual(regexpMetinlerindeGeriAlma(`new RegExp(/${bs}b/.source + a)`), []);
  assert.deepEqual(regexpMetinlerindeGeriAlma(`// new RegExp('${bs}b')`), []);
});
