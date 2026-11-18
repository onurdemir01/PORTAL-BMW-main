// Alan degerine gore Smart onayi atlama kurali. Saf fonksiyon - ag/DB yok.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isSmartRequired, matchSkip, parseSkipRules } = require('../smart-gate.cjs');

const SA = (skipWhen) => ({ enabled: true, flowKey: 'F', skipWhen });

test('kapali servis hicbir durumda onay istemez', () => {
  assert.strictEqual(isSmartRequired({ enabled: false, skipWhen: '' }, { op_selection: 'create' }), false);
  assert.strictEqual(isSmartRequired(undefined, {}), false);
});

test('kural YOKSA eski davranis: her talepte onay', () => {
  for (const sw of ['', undefined, null, '   ', '# sadece yorum']) {
    assert.strictEqual(isSmartRequired(SA(sw), { op_selection: 'read' }), true, JSON.stringify(sw));
  }
});

test('kullanicinin ornegi: op_selection=read -> onay ISTENMEZ', () => {
  assert.strictEqual(isSmartRequired(SA('op_selection: read'), { op_selection: 'read' }), false);
});

test('ayni serviste diger islemler onaya TABI kalir', () => {
  const sa = SA('op_selection: read');
  for (const op of ['create', 'update', 'delete']) {
    assert.strictEqual(isSmartRequired(sa, { op_selection: op }), true, op);
  }
});

test('alan adi ve deger harf duyarsiz, bosluklar onemsiz', () => {
  const sa = SA('  op_selection :  READ  ');
  assert.strictEqual(isSmartRequired(sa, { OP_SELECTION: 'Read' }), false);
  assert.strictEqual(isSmartRequired(sa, { op_selection: ' read ' }), false);
});

test('tek satirda virgulle birden fazla deger (VEYA)', () => {
  const sa = SA('op_selection: read, list');
  assert.strictEqual(isSmartRequired(sa, { op_selection: 'list' }), false);
  assert.strictEqual(isSmartRequired(sa, { op_selection: 'read' }), false);
  assert.strictEqual(isSmartRequired(sa, { op_selection: 'create' }), true);
});

test('birden fazla satir (VEYA) ve farkli alanlar', () => {
  const sa = SA('op_selection: read\naction: read\nmode: dry-run');
  assert.strictEqual(isSmartRequired(sa, { action: 'read' }), false);
  assert.strictEqual(isSmartRequired(sa, { mode: 'dry-run', action: 'create' }), false);
  assert.strictEqual(isSmartRequired(sa, { action: 'create' }), true);
});

test('GUVENLI TARAF: kuraldaki alan talepte YOKSA onay istenir', () => {
  const sa = SA('op_selection: read');
  assert.strictEqual(isSmartRequired(sa, { baska_alan: 'read' }), true);
  assert.strictEqual(isSmartRequired(sa, {}), true);
});

test('GUVENLI TARAF: gecersiz kural satiri onayi ATLATMAZ', () => {
  // Iki nokta yok -> kural degil. Sessizce "atla" demek, yazim hatasinin prod'u
  // onaysiz gecirmesi olurdu.
  const sa = SA('op_selection read');
  assert.strictEqual(isSmartRequired(sa, { op_selection: 'read' }), true);
  assert.deepStrictEqual(parseSkipRules('op_selection read').invalid, ['op_selection read']);
});

test('GUVENLI TARAF: bos deger eslesme sayilmaz', () => {
  const sa = SA('op_selection: read');
  assert.strictEqual(isSmartRequired(sa, { op_selection: '' }), true);
  assert.strictEqual(isSmartRequired(sa, { op_selection: '   ' }), true);
});

test('kismi eslesme YOK - tam deger karsilastirmasi', () => {
  const sa = SA('op_selection: read');
  assert.strictEqual(isSmartRequired(sa, { op_selection: 'read_only' }), true);
  assert.strictEqual(isSmartRequired(sa, { op_selection: 'reader' }), true);
});

test('matchSkip hangi kuralin tuttugunu bildirir (audit icin)', () => {
  const m = matchSkip(SA('op_selection: read'), { op_selection: 'READ' });
  assert.deepStrictEqual(m, { skip: true, field: 'op_selection', value: 'read' });
});

test('parseSkipRules: yorum ve bos satirlar atlanir', () => {
  const { rules, invalid } = parseSkipRules('# yorum\n\nop_selection: read\n  \naction: a, b');
  assert.deepStrictEqual(rules, [
    { field: 'op_selection', values: ['read'] },
    { field: 'action', values: ['a', 'b'] },
  ]);
  assert.deepStrictEqual(invalid, []);
});
