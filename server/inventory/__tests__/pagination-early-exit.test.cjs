// server/inventory/__tests__/pagination-early-exit.test.cjs
//
// Envanter aramasinin ERKEN CIKABILMESINI kilitler.
//
// NEDEN: onceki sorgu `SELECT COUNT(*) OVER() AS __total, * ... OFFSET/FETCH` idi.
// COUNT(*) OVER() WHERE'e uyan TUM satirlari saymak zorundadir; bu yuzden yalnizca
// `limit` satir istense bile SQL Server erken cikamiyor, HER aramada tum tabloyu
// tariyordu. Buyuk tablolarda aramanin yavas olmasinin yapisal sebebi buydu.
//
// Yeni yaklasim `limit + 1` yoklamasi: sayim yapilmaz, bir fazla satir istenir.
//   gelen <= limit   -> toplam KESIN (offset + gelen)
//   gelen == limit+1 -> daha var; toplam bilinmiyor, alt sinir bildirilir
// Kesin sayi KAYBOLMADI, varsayilan olmaktan cikti: ?exactCount=1 ile istenebilir.
//
// Kontroller KAYNAK metin uzerinden yapilir (rota DB'siz calistirilamiyor); amac
// eski desene sessizce geri donulmesini yakalamak.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

/** Yorumlari atar: aciklama metinlerindeki kalip adlari yanlis pozitif uretmesin. */
function stripComments(t) {
  return t
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

const CODE = stripComments(SRC);

test('COUNT(*) OVER() KODDA KALMADI (erken cikisi engelliyordu)', () => {
  assert.ok(
    !/COUNT\(\*\)\s*OVER\s*\(\)/i.test(CODE),
    'pencere fonksiyonu geri gelmis - her arama yine tum tabloyu tarar',
  );
});

test('veri sorgusu limit + 1 satir istiyor (daha var mi yoklamasi)', () => {
  assert.match(
    CODE,
    /dataReq\.input\('limit',\s*sql\.Int,\s*limit\s*\+\s*1\)/,
    'limit+1 yoklamasi yok - "daha var mi" bilgisi ancak sayarak bulunurdu',
  );
});

test('fazladan satir kullaniciya SIZMIYOR', () => {
  // limit+1 istendi; o fazladan satir yalnizca "daha var" isareti icindir, EKRANA
  // dusmemeli - aksi halde her sayfada bir satir fazla gorunurdu.
  assert.match(CODE, /const hasMore = rows\.length > limit;/);
  assert.match(CODE, /if \(hasMore\) rows = rows\.slice\(0, limit\);/);
});

test('toplam KESIN oldugunda dogru hesaplaniyor (offset + gelen)', () => {
  assert.match(CODE, /let total = offset \+ rows\.length;/);
  assert.match(CODE, /let exact = !hasMore;/);
});

test('kesin sayi ISTENDIGINDE hesaplaniyor (?exactCount=1)', () => {
  assert.match(CODE, /req\.query\.exactCount/, 'kesin sayi yolu kaldirilmis');
  assert.match(
    CODE,
    /SELECT COUNT\(\*\) AS total FROM \$\{quoteIdent\(table\)\}/,
    'ayri COUNT sorgusu yok - kesin sayi hic hesaplanamazdi',
  );
});

test('var-olmayan sayfa istendiginde de dogru toplam donuyor', () => {
  // Bos sayfa + offset>0 durumunda alt sinir YANILTICI olurdu (offset kadar gosterirdi),
  // bu yuzden orada kesin sayima dusulur.
  assert.match(CODE, /wantExact \|\| \(rows\.length === 0 && offset > 0\)/);
});

test('CSV disa aktarma durma kosulu `hasMore` (sayiya DEGIL)', () => {
  // Disa aktarma sayfalari arka arkaya cekiyor. Durma kosulu `pages` olsaydi, toplam
  // kesin olmadiginda "en az bu kadar" degerine bagli kalir ve export YARIM kalabilirdi.
  // `hasMore` sayidan bagimsizdir ve her zaman guvenilir.
  const page = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'EnvanterPage.tsx'),
    'utf8',
  );
  const fn = page.match(/async function handleExportCsv\([\s\S]*?\n  \}/);
  assert.ok(fn, 'handleExportCsv bulunamadi');
  assert.match(fn[0], /more = r\.pagination\.hasMore;/, 'durma kosulu hasMore olmali');
  assert.ok(
    !/while \(page <= totalPages\)/.test(fn[0]),
    'eski `pages` tabanli dongu geri gelmis',
  );
});

test('yanit exact/hasMore tasiyor (arayuz ikisini ayirt ediyor)', () => {
  const m = CODE.match(/pagination:\s*\{[\s\S]{0,260}?\}/);
  assert.ok(m, 'pagination yaniti bulunamadi');
  assert.match(m[0], /\bexact\b/, 'exact tasinmazsa arayuz "+" gosteremez');
  assert.match(m[0], /\bhasMore\b/, 'hasMore tasinmazsa sonraki sayfa dugmesi calismaz');
});
