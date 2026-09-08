// server/inventory/__tests__/search-sargability.test.cjs
//
// Envanter aramasinin YAVAS olmasinin sebebi: her filtre predicate'i kolonu
// `CAST(col AS NVARCHAR(MAX))` ile sariyordu. Kolon zaten metin oldugunda bu CAST
// kolonun index'ini KULLANILAMAZ hale getiriyor (ifade uzerinde index yoktur) ve
// NVARCHAR(MAX) LOB semantigi satir basina donusum maliyeti ekliyor.
//
// Bu testler SQL'in SEKLINI dogrular (DB gerektirmez):
//   1) metin kolonlarinda CAST YOK,
//   2) metin-disi kolonlarda CAST VAR (dogru string temsili icin gerekli),
//   3) parametre tipi kolon tipiyle ESLESIYOR — bu ikinci yari OLMAZSA kazanc da olmaz:
//      varchar kolonu NVarChar parametresiyle karsilastirmak implicit conversion uretir
//      ve index'i CAST kadar kesin oldurur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sql = require('mssql');
const {
  _colExprFor: colExprFor,
  _strParam: strParam,
  _buildAdvancedWhereClause: buildAdvancedWhereClause,
} = require('../index.cjs');

const types = new Map([
  ['ad', 'nvarchar'],
  ['kod', 'varchar'],
  ['bayrak', 'nchar'],
  ['kisa', 'char'],
  ['aciklama', 'nvarchar'],
  ['notlar', 'text'],
  ['sayi', 'int'],
  ['tarih', 'datetime'],
]);

test('Unicode metin kolonlarinda CAST YOK (index kullanilabilir)', () => {
  for (const c of ['ad', 'bayrak', 'aciklama']) {
    const { expr, ansi } = colExprFor(c, types);
    assert.equal(expr, `[${c}]`, `${c} CAST'siz olmali`);
    assert.equal(ansi, false, `${c} NVarChar parametre almali`);
  }
});

test('ANSI metin kolonlarinda CAST YOK ve parametre VarChar (implicit conversion tuzagi)', () => {
  for (const c of ['kod', 'kisa']) {
    const { expr, ansi } = colExprFor(c, types);
    assert.equal(expr, `[${c}]`);
    assert.equal(ansi, true, `${c} VarChar parametre almali — NVarChar implicit conversion uretir`);
  }
  // Tip eslemesi gercekten farkli bir mssql tipi mi uretiyor?
  assert.notEqual(strParam(true, 256).type, strParam(false, 256).type);
  assert.equal(strParam(true, 256).type, sql.VarChar().type);
  assert.equal(strParam(false, 256).type, sql.NVarChar().type);
});

test('Metin-disi ve LOB kolonlarda CAST KORUNUR', () => {
  for (const c of ['sayi', 'tarih', 'notlar']) {
    const { expr } = colExprFor(c, types);
    assert.equal(expr, `CAST([${c}] AS NVARCHAR(MAX))`, `${c} CAST'li kalmali`);
  }
});

test('Tip bilgisi YOKSA guvenli tarafa duser (CAST)', () => {
  assert.equal(colExprFor('x', new Map()).expr, 'CAST([x] AS NVARCHAR(MAX))');
  assert.equal(colExprFor('x', undefined).expr, 'CAST([x] AS NVARCHAR(MAX))');
});

// buildAdvancedWhereClause'un urettigi metni ve BAGLANAN parametre tiplerini yakalar.
function fakeReq() {
  const bound = [];
  return { bound, input(name, type, value) { bound.push({ name, type, value }); return this; } };
}

test('Gelismis filtre: metin kolonu CAST siz, parametre tipi kolonla esli', () => {
  const req = fakeReq();
  const where = buildAdvancedWhereClause(
    { mode: 'AND', filters: [{ col: 'kod', op: 'equals', value: 'ABC' }] },
    ['kod'], req, types,
  );
  assert.equal(where, '[kod] = @af0');
  assert.equal(req.bound[0].type.type, sql.VarChar().type, 'varchar kolon -> VarChar parametre');
});

test('Gelismis filtre: sayisal kolon CAST li kalir', () => {
  const req = fakeReq();
  const where = buildAdvancedWhereClause(
    { mode: 'AND', filters: [{ col: 'sayi', op: 'contains', value: '7' }] },
    ['sayi'], req, types,
  );
  assert.equal(where, 'CAST([sayi] AS NVARCHAR(MAX)) LIKE @af0');
});

test('Gelismis filtre: colTypes verilmezse ESKI davranis (geriye donuk uyum)', () => {
  const req = fakeReq();
  const where = buildAdvancedWhereClause(
    { mode: 'AND', filters: [{ col: 'ad', op: 'equals', value: 'x' }] },
    ['ad'], req,
  );
  assert.equal(where, 'CAST([ad] AS NVARCHAR(MAX)) = @af0');
});

test('isNull/isNotNull kolonu HIC sarmaz (zaten sargable idi)', () => {
  const req = fakeReq();
  assert.equal(
    buildAdvancedWhereClause({ mode: 'AND', filters: [{ col: 'ad', op: 'isNull' }] }, ['ad'], req, types),
    '[ad] IS NULL',
  );
});
