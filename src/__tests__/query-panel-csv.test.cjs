// src/__tests__/query-panel-csv.test.cjs — Custom SQL sonucu CSV indirilebilir (2026-09-14).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Custom SQL panelinde sorgu sonucu icin CSV dugmesi var ve tum satirlari verir', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components/envanter/QueryPanel.tsx'), 'utf8');
  assert.ok(src.includes('downloadResultCsv(visibleCols, result.rows'), 'CSV dugmesi sonucun tamamini vermeli');
  assert.ok(/disabled=\{result\.rows\.length === 0\}/.test(src), 'bos sonucta dugme pasif');
  // Turkce Excel: ";" ayirici + BOM + CRLF
  assert.ok(src.includes('.join(";")') && src.includes('"\\ufeff"') && src.includes('"\\r\\n"'));
});
