// server/ansible/__tests__/survey-conditions.test.cjs
//
// Survey Tasarimcisi "kosullu goster" mantigi. Bu modul PAYLASILANDIR: istemci
// (SelfServicePage) alani gosterip gizlemek icin, sunucu (resolveCustomSurveyExtraVars)
// alani dogrulamamak ve extra_vars'a EKLEMEMEK icin AYNI fonksiyonu cagirir. Iki taraf
// ayrisirsa alan ekranda gizli gorunurken sunucu onu yine de gonderir - sessiz ve
// teshisi zor bir hata. Bu yuzden mantik tek yerde ve testi burada.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isFieldActive, allConditions, hasNoConditions } = require('../../../shared/surveyConditions.cjs');

// Kullanicinin istedigi sekil: (ortam=X VEYA Y VEYA Z) VE (operasyon=P)
const IKI_DUZEY = {
  mode: 'all',
  groups: [
    {
      mode: 'any',
      conditions: [
        { field: 'ortam', equals: 'X' },
        { field: 'ortam', equals: 'Y' },
        { field: 'ortam', equals: 'Z' },
      ],
    },
    { mode: 'all', conditions: [{ field: 'operasyon', equals: 'P' }] },
  ],
};

test('(X VEYA Y VEYA Z) VE P — her VEYA dali P ile birlikte gecerli', () => {
  for (const ortam of ['X', 'Y', 'Z']) {
    assert.equal(isFieldActive(IKI_DUZEY, { ortam, operasyon: 'P' }), true, `ortam=${ortam}`);
  }
});

test('(X VEYA Y VEYA Z) VE P — VEYA grubu tutmazsa gosterilmez', () => {
  assert.equal(isFieldActive(IKI_DUZEY, { ortam: 'Q', operasyon: 'P' }), false);
});

test('(X VEYA Y VEYA Z) VE P — VE kosulu tutmazsa gosterilmez', () => {
  assert.equal(isFieldActive(IKI_DUZEY, { ortam: 'X', operasyon: 'R' }), false);
  assert.equal(isFieldActive(IKI_DUZEY, { ortam: 'X' }), false, 'operasyon hic gonderilmedi');
});

test('Gruplar arasi VEYA: gruplardan biri yeterli', () => {
  const dep = {
    mode: 'any',
    groups: [
      { mode: 'all', conditions: [{ field: 'a', equals: '1' }, { field: 'b', equals: '2' }] },
      { mode: 'all', conditions: [{ field: 'c', equals: '3' }] },
    ],
  };
  assert.equal(isFieldActive(dep, { a: '1', b: '2' }), true, 'ilk grup tuttu');
  assert.equal(isFieldActive(dep, { c: '3' }), true, 'ikinci grup tuttu');
  assert.equal(isFieldActive(dep, { a: '1', c: '9' }), false, 'hicbiri tutmadi');
});

test('GERIYE DONUK UYUM: eski duz conditions listesi aynen calisir', () => {
  const eskiVeya = {
    mode: 'any',
    conditions: [
      { field: 'op', equals: 'activate' },
      { field: 'op', equals: 'deactivate' },
    ],
  };
  assert.equal(isFieldActive(eskiVeya, { op: 'activate' }), true);
  assert.equal(isFieldActive(eskiVeya, { op: 'deactivate' }), true);
  assert.equal(isFieldActive(eskiVeya, { op: 'create' }), false);

  const eskiVe = {
    mode: 'all',
    conditions: [
      { field: 'env', equals: 'prod' },
      { field: 'op', equals: 'update' },
    ],
  };
  assert.equal(isFieldActive(eskiVe, { env: 'prod', op: 'update' }), true);
  assert.equal(isFieldActive(eskiVe, { env: 'prod', op: 'create' }), false);
});

test('Tek gruba tasima ANLAM DEGISTIRMEZ (normalizer bunu yapiyor)', () => {
  // {mode:'any', conditions:[a,b]} ile {mode:'all', groups:[{mode:'any', conditions:[a,b]}]}
  // her girdide AYNI sonucu vermeli - aksi halde tasarimciyi acip kaydetmek davranisi
  // sessizce degistirirdi.
  const conds = [
    { field: 'op', equals: 'activate' },
    { field: 'op', equals: 'deactivate' },
  ];
  const eski = { mode: 'any', conditions: conds };
  const yeni = { mode: 'all', groups: [{ mode: 'any', conditions: conds }] };
  for (const op of ['activate', 'deactivate', 'create', '']) {
    assert.equal(isFieldActive(eski, { op }), isFieldActive(yeni, { op }), `op=${op}`);
  }
});

test('notEmpty operatoru: herhangi bir deger yeterli, bosluk sayilmaz', () => {
  const dep = { mode: 'all', groups: [{ mode: 'all', conditions: [{ field: 'x', operator: 'notEmpty' }] }] };
  assert.equal(isFieldActive(dep, { x: 'herhangi' }), true);
  assert.equal(isFieldActive(dep, { x: '   ' }), false, 'yalniz bosluk = bos');
  assert.equal(isFieldActive(dep, {}), false);
});

test('Kosul yoksa alan HER ZAMAN gosterilir (bugunku davranis korunur)', () => {
  assert.equal(isFieldActive(undefined, {}), true);
  assert.equal(isFieldActive({ mode: 'all' }, {}), true);
  assert.equal(isFieldActive({ mode: 'all', conditions: [] }, {}), true);
  assert.equal(isFieldActive({ mode: 'all', groups: [] }, {}), true);
});

test('BOS grup YOK SAYILIR — yarim kalmis grup alani sessizce gizlememeli', () => {
  const dep = {
    mode: 'all',
    groups: [
      { mode: 'all', conditions: [{ field: 'a', equals: '1' }] },
      { mode: 'all', conditions: [] }, // admin "Grup Ekle" dedi, henuz doldurmadi
    ],
  };
  assert.equal(isFieldActive(dep, { a: '1' }), true, 'dolu grup tuttu, bos grup engellememeli');
});

test('allConditions duz + gruplu kosullarin TAMAMINI dondurur (kayit dogrulamasi)', () => {
  assert.equal(allConditions(IKI_DUZEY).length, 4);
  assert.equal(allConditions({ mode: 'any', conditions: [{ field: 'a', equals: '1' }] }).length, 1);
  assert.equal(allConditions(undefined).length, 0);
});

test('hasNoConditions: yalnizca BOS gruplar varsa "kosul yok" sayilir', () => {
  assert.equal(hasNoConditions({ mode: 'all', groups: [{ mode: 'all', conditions: [] }] }), true);
  assert.equal(hasNoConditions(IKI_DUZEY), false);
});

test('Degerler trim edilir ve string olarak karsilastirilir', () => {
  const dep = { mode: 'all', groups: [{ mode: 'all', conditions: [{ field: 'n', equals: '5' }] }] };
  assert.equal(isFieldActive(dep, { n: '  5  ' }), true, 'bosluklar kirpilir');
  assert.equal(isFieldActive(dep, { n: 5 }), true, 'sayi string e cevrilir');
});
