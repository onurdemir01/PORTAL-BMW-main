// src/__tests__/modal-focus-stable.test.cjs
//
// Modal odak tuzagi her tus vurusunda odagi X dugmesine tasiyordu (kullanici bildirimi,
// 2026-09-15, Nginx Audit > istisna notu). Sebep: odak efekti `[open, onClose]`e bagliydi;
// `onClose={() => setX(null)}` her render'da yeni fonksiyon -> efekt yeniden kosar ->
// ilk odaklanabilir oge (kapatma X'i) odaklanir. Bekci: efekt yalniz `open`a bagli,
// onClose ref uzerinden okunur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'components/common/Modal.tsx'), 'utf8');
const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('MF1 odak efekti onClose kimligine BAGLI DEGIL (yalniz open)', () => {
  const i = code.indexOf('returnFocusRef.current = document.activeElement');
  assert.ok(i > 0, 'odak efekti bulunamadi');
  const tail = code.slice(i);
  const deps = /\n\s*\}, \[([^\]]*)\]\);/.exec(tail);
  assert.ok(deps, 'efekt bagimlilik listesi bulunamadi');
  assert.equal(deps[1].trim(), 'open', `odak efekti [${deps[1]}] bagimli — inline onClose her tusta odagi X'e tasir`);
  assert.match(code, /const onCloseRef = useRef\(onClose\)/, 'onClose ref tutulmuyor');
  assert.match(code, /if \(e\.key === "Escape"\) \{ onCloseRef\.current\(\); return; \}/, 'ESC ref uzerinden cagirmiyor (eski onClose kapanir)');
});
