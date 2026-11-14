'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasControlChars, replaceControlCharsWithSpace } = require('../control-chars.cjs');

test('CC1 varsayilan hasControlChars C0 ve DEL yakalar, normal metni gecirir', () => {
  assert.equal(hasControlChars('normal-etiket_123 üğşçö'), false);
  assert.equal(hasControlChars('a\x00b'), true);
  assert.equal(hasControlChars('a\nb'), true);
  assert.equal(hasControlChars('a\tb'), true);
  assert.equal(hasControlChars('a\x1fb'), true);
  assert.equal(hasControlChars('a\x7fb'), true);
  assert.equal(hasControlChars('a\u0085b'), false);
});

test('CC2 c1, lineSep ve invisible bayraklari siniflari ayri ayri ekler', () => {
  assert.equal(hasControlChars('x\u0080y', { c1: true }), true);
  assert.equal(hasControlChars('x\u009fy', { c1: true }), true);
  assert.equal(hasControlChars('x\u2028y', { lineSep: true }), true);
  assert.equal(hasControlChars('x\u2029y', { lineSep: true }), true);
  assert.equal(hasControlChars('x\u200by', { invisible: true }), true);
  assert.equal(hasControlChars('x\ufeffy', { invisible: true }), true);
});

test('CC3 replaceControlCharsWithSpace ardisik kontrol dizilerini tek bosluga indirger', () => {
  assert.equal(replaceControlCharsWithSpace('merhaba\r\n\t  dunya\x7f!'), 'merhaba   dunya !');
  assert.equal(replaceControlCharsWithSpace(null), '');
});
