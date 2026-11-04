// server/server-hub/__tests__/ear-envanter-sorgu.test.cjs - Uygulama Envanteri eslenik analizi ve sorgular.
//
//   ES1  AYNI yalniz her kopya TAM, ayni kip, ayni yapi ve kutuphane izinde
//   ES2  EKSIK_TARAMA: bir kopya bile TAM degilse AYNI / FARKLI denmez (eksik veri karsilastirilmaz)
//   ES3  KARSILASTIRILAMAZ: OZET izi TAM iziyle kiyaslanmaz
//   ES4  FARKLI_KUTUPHANE onceliklidir; gruplar hangi hostun hangi izde oldugunu soyler; siralama farklar once
//   ES5  tek hostluk uygulama listede yok (tumu=1 ile TEK); ortam ve JBoss nesli ayri gruplar
//   ES6  iki nesil: ayni hostta ayni EAR hem 7 hem 8; kutuphane karsilastirmasi yalniz ikisi TAM iken
//   ES7  LIKE deseni kacisli (% _ [ \\); sorgular SON DURUM CTE'sini ve kosu suzgecini kullanir
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/ear-envanter.cjs');

const sorgu = require('../ear-envanter-sorgu.cjs');
afterEach(() => F.dbKaldir());

const r = (host, ek = {}) => ({
  host,
  ortam: 'PROD',
  ad: 'ODEME.ear',
  jboss: '8',
  durum: 'TAM',
  kip: 'TAM',
  yapi_izi: 'y1',
  kutuphane_izi: 'k1',
  ...ek,
});
const karar = (satirlar, ek) => sorgu.eslenikAnalizi(satirlar, ek).gruplar.map((g) => g.karar);

test('ES1 AYNI', () => {
  assert.deepEqual(karar([r('H1'), r('H2'), r('H3')]), ['AYNI']);
});

test('ES2 EKSIK_TARAMA asla AYNI degil', () => {
  assert.deepEqual(karar([r('H1'), r('H2', { durum: 'KISMI_SINIR' })]), ['EKSIK_TARAMA']);
  assert.deepEqual(karar([r('H1'), r('H2', { durum: 'ARSIV_ACILMADI', kutuphane_izi: 'k9' })]), [
    'EKSIK_TARAMA',
  ]);
  const g = sorgu.eslenikAnalizi([r('H1'), r('H2', { durum: 'KISMI_IZIN' })]).gruplar[0];
  assert.deepEqual(g.eksik, ['H2:KISMI_IZIN']);
});

test('ES3 KARSILASTIRILAMAZ', () => {
  assert.deepEqual(karar([r('H1'), r('H2', { kip: 'OZET', yapi_izi: 'baska' })]), [
    'KARSILASTIRILAMAZ',
  ]);
});

test('ES4 FARKLI_KUTUPHANE ve FARKLI_YAPI', () => {
  const s = sorgu.eslenikAnalizi([
    r('H1'),
    r('H2', { kutuphane_izi: 'k2', yapi_izi: 'y2' }),
    r('H3'),
    r('H1', { ad: 'B.ear', yapi_izi: 'yA' }),
    r('H2', { ad: 'B.ear', yapi_izi: 'yB' }),
    r('H1', { ad: 'A.ear' }),
    r('H2', { ad: 'A.ear' }),
  ]).gruplar;
  assert.deepEqual(
    s.map((g) => [g.uygulama, g.karar]),
    [
      ['ODEME.ear', 'FARKLI_KUTUPHANE'],
      ['B.ear', 'FARKLI_YAPI'],
      ['A.ear', 'AYNI'],
    ],
  );
  assert.deepEqual(s[0].gruplar, [
    { iz: 'y1/k1', hostlar: ['H1', 'H3'] },
    { iz: 'y2/k2', hostlar: ['H2'] },
  ]);
});

test('ES5 tek host ve ayri gruplar', () => {
  assert.deepEqual(karar([r('H1')]), []);
  assert.deepEqual(karar([r('H1')], { tumu: true }), ['TEK']);
  const g = sorgu.eslenikAnalizi([r('H1'), r('H2', { ortam: 'TEST' }), r('H3', { jboss: '7' })], {
    tumu: true,
  }).gruplar;
  assert.equal(g.length, 3, 'ortam / nesil ayri grup olmali');
  assert.deepEqual(
    karar([r('H1', { ortam: null }), r('H2', { ortam: '' })]),
    ['AYNI'],
    'bos ortam ayni grup (?)',
  );
});

test('ES6 iki nesil', () => {
  const s = sorgu.eslenikAnalizi([
    r('H1', { jboss: '7' }),
    r('H1', { jboss: '8' }),
    r('H2', { jboss: '7', kutuphane_izi: 'a' }),
    r('H2', { jboss: '8', kutuphane_izi: 'b' }),
    r('H3', { jboss: '7' }),
    r('H3', { jboss: '8', durum: 'KISMI_SINIR' }),
  ]).ikiNesil;
  assert.deepEqual(
    s.map((x) => [x.host, x.ayni_kutuphane]),
    [
      ['H1', true],
      ['H2', false],
      ['H3', null],
    ],
  );
});

test('ES7 LIKE ve sorgu kalibi', async () => {
  assert.equal(sorgu.likeDeseni('a%b_c[d\\e'), '%a\\%b\\_c\\[d\\\\e%');
  assert.equal(sorgu.likeDeseni('  '), '');
  const db = F.sahteDb([[/WITH son AS/, () => ({ rows: [{ toplam: 3, host: 'H1' }] })]]);
  F.dbKur(db);
  const u = await sorgu.uygulamalar({
    q: 'odeme',
    jboss: '9',
    durum: 'EKSIK',
    limit: 10000,
    offset: -5,
  });
  assert.equal(u.toplam, 3);
  const c = db.cagrilar[0];
  assert.match(c.sql, /WHERE veri_var = 1 AND \(\$1 = 0 OR kosu_id = \$1\) GROUP BY host/);
  assert.match(c.sql, /ESCAPE '\\'/);
  assert.equal(c.params[0], 0);
  assert.equal(c.params[1], '%odeme%');
  assert.equal(c.params[3], '', 'gecersiz nesil suzgeci yok sayilir');
  assert.equal(c.params[6], 0, 'negatif offset');
  assert.equal(c.params[7], 500, 'sayfa ust siniri');
  await sorgu.uygulamalar({ kosu: '12' });
  assert.equal(db.cagrilar[1].params[0], 12);
  assert.equal(db.cagrilar[1].params[7], 200000, 'disa aktarim sayfasiz');
});

test('ES8 ozet hostlari cekmez; bos ortamli eslenik farki bulunur', async () => {
  const db = F.sahteDb([
    [
      /FROM ear_envanter_kosulari WHERE id = \$1/,
      () => ({ rows: [{ id: 3, parametreler: '{}' }] }),
    ],
    [/WITH son AS/, () => ({ rows: [] })],
  ]);
  F.dbKur(db);
  const d = await sorgu.kosuDetay(3, { hostlarla: false });
  assert.deepEqual(d.hostlar, []);
  assert.ok(
    !db.cagrilar.some((c) => /veri AS \(SELECT host/.test(c.sql)),
    'ozet host listesi sorgulamamali',
  );
  await sorgu.eslenikFarki({ ad: 'A.ear', ortam: '?', jboss: '8' });
  const u = db.cagrilar.find((c) => /COUNT\(\*\) OVER\(\) AS toplam/.test(c.sql));
  assert.equal(u.params[2], '', "'?' ortami LIKE desenine donmemeli");
});
