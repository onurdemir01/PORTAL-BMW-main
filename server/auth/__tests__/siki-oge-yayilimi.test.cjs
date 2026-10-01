// server/auth/__tests__/siki-oge-yayilimi.test.cjs — SY1..SY5 (2026-10-01).
//
// URETIM: "Crypto Hub'a halen osmankoz@garantibbva.com.tr giremiyor." Admin ekraninda
// `navgroup:cryptohub` ogesinde UC kisi kurali duruyordu (ekran goruntusu: "3 kisi kurali")
// ama kullanici 403 aliyordu.
//
// SEBEP: `CryptoHub` SAYFASI `metadata.strict = true` (kullanicinin 2026-09-26 istegi:
// "sadece istedigim kisiler goruntuleyebilsin"). Motorda:
//   * ata kaskadi yalnizca KISITLAR, asla YETKI VERMEZ
//   * siki ogede varsayilan HER ZAMAN kapalidir (default_visible bakilmaz)
// Yani ataya yazilan kural siki cocuk icin HICBIR ISE YARAMIYOR - ve ekranda bunu
// soyleyen hicbir sey yoktu. Ayni tuzaga birden fazla kez dusuldu.
//
// COZUM: ataya kisi kurali yazilinca ayni kural SIKI torunlara da yazilir, hangilerine
// yazildigi yanitta doner. Motorun anlambilimi DEGISMEDI.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ELEMENTS = fs.readFileSync(path.join(__dirname, '..', 'elements.cjs'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'visibility-routes.cjs'), 'utf8');
const SEED = fs.readFileSync(
  path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'),
  'utf8',
);

/** elements.cjs'i sahte bir db ile yukler. */
function yukle(elements, rules) {
  const yazilan = [];
  const fake = {
    query: async (sql, params = []) => {
      if (/FROM portal_elements/.test(sql)) return { rows: elements, rowCount: elements.length };
      if (/SELECT principal_type, principal_id FROM portal_element_visibility/.test(sql)) {
        const k = params[0];
        return { rows: rules.filter((r) => r.element_key === k), rowCount: 0 };
      }
      if (/INSERT INTO portal_element_visibility/.test(sql)) {
        yazilan.push({ key: params[0], type: params[1], id: params[2] });
        rules.push({ element_key: params[0], principal_type: params[1], principal_id: params[2] });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const yol = require.resolve('../elements.cjs');
  const dbYol = require.resolve('../../db/index.cjs');
  const onceki = require.cache[dbYol];
  require.cache[dbYol] = { id: dbYol, filename: dbYol, loaded: true, exports: fake };
  delete require.cache[yol];
  const mod = require('../elements.cjs');
  delete require.cache[yol];
  if (onceki) require.cache[dbYol] = onceki;
  else delete require.cache[dbYol];
  return { mod, yazilan };
}

const CRYPTO = [
  { element_key: 'navgroup:cryptohub', parent_key: null, metadata: null },
  { element_key: 'CryptoHub', parent_key: 'navgroup:cryptohub', metadata: '{"strict":true}' },
];

test('SY1 ata kisi kurali SIKI cocuga da yazilir (uretimdeki 403)', async () => {
  const { mod, yazilan } = yukle([...CRYPTO], []);
  const etkilenen = await mod.propagateToStrictDescendants('navgroup:cryptohub', [
    { principalType: 'email', principalId: 'osmankoz@garantibbva.com.tr', allow: true },
  ]);
  assert.deepEqual(etkilenen, ['CryptoHub']);
  assert.deepEqual(yazilan, [
    { key: 'CryptoHub', type: 'email', id: 'osmankoz@garantibbva.com.tr' },
  ]);
});

test('SY2 SIKI OLMAYAN cocuga YAZILMAZ (kaskad zaten yetiyor)', async () => {
  const { mod, yazilan } = yukle(
    [
      { element_key: 'navgroup:x', parent_key: null, metadata: null },
      { element_key: 'SayfaX', parent_key: 'navgroup:x', metadata: null },
    ],
    [],
  );
  const etkilenen = await mod.propagateToStrictDescendants('navgroup:x', [
    { principalType: 'email', principalId: 'a@b.c', allow: true },
  ]);
  assert.deepEqual(etkilenen, [], 'siki olmayan ogeye gereksiz kural yazilmis');
  assert.deepEqual(yazilan, []);
});

test('SY3 ZATEN VAR OLAN kural tekrar yazilmaz (idempotent)', async () => {
  const { mod, yazilan } = yukle([...CRYPTO], [
    { element_key: 'CryptoHub', principal_type: 'email', principal_id: 'osmankoz@garantibbva.com.tr' },
  ]);
  const etkilenen = await mod.propagateToStrictDescendants('navgroup:cryptohub', [
    { principalType: 'email', principalId: 'OsmanKoz@garantibbva.com.tr', allow: true },
  ]);
  assert.deepEqual(etkilenen, [], 'ayni kural ikinci kez yazilmis (buyuk/kucuk harf)');
  assert.deepEqual(yazilan, []);
});

test('SY4 allow=false YAYILMAZ (yalniz EKLER, silmez)', async () => {
  // Ata kuralini kaldirmak cocuktaki kurali silmemeli: cocuga DOGRUDAN verilmis bir
  // yetkiyi sessizce iptal etmek, bu hatadan daha kotu bir surpriz olurdu.
  const { mod, yazilan } = yukle([...CRYPTO], []);
  const etkilenen = await mod.propagateToStrictDescendants('navgroup:cryptohub', [
    { principalType: 'email', principalId: 'a@b.c', allow: false },
  ]);
  assert.deepEqual(etkilenen, []);
  assert.deepEqual(yazilan, []);
});

test('SY5 uc yayilimi CAGIRIYOR ve sonucu BILDIRIYOR; CryptoHub hala siki', () => {
  assert.match(
    ROUTES,
    /propagateToStrictDescendants\(req\.params\.key, rules\)/,
    "kural ucu yayilimi cagirmiyor - ataya yazilan kural siki cocukta ISE YARAMAZ",
  );
  assert.match(ROUTES, /strictChildren/, 'hangi siki cocuklara yazildigi bildirilmiyor');
  // Sikilik KALDIRILARAK "cozulmesin": kullanici 2026-09-26'da bunu acikca istedi.
  const i = SEED.indexOf("element_key: 'CryptoHub'");
  assert.ok(i > 0, 'CryptoHub seed bulunamadi');
  assert.match(
    SEED.slice(i, i + 900),
    /metadata: \{ strict: true \}/,
    'CryptoHub artik SIKI degil - erisim sorunu sikiligi kaldirarak "cozulmus" olabilir',
  );
});
