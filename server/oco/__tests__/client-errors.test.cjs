// server/oco/__tests__/client-errors.test.cjs — OLMAYAN OCO icin okunur hata.
//
// Kullanici bildirimi (2026-09-15): OCO Kontrolu acikken var olmayan bir numara girilince
// ekranda "OCO servisi 404 dondu." gibi ham bir satir cikiyordu. Kullanici ne oldugunu ve
// ne yapmasi gerektigini okuyabilmeli; HTTP kodu yonetici icin parantezde kalir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeUpstreamError, upstreamHint } = require('../client.cjs');

test('OE1 404 -> "bulunamadi" + numarayi kontrol et; ham "404 dondu" YOK', () => {
  const e = describeUpstreamError(404, '', '22502813');
  assert.equal(e.status, 404);
  assert.match(e.message, /OCO 22502813 bulunamadı/);
  assert.match(e.message, /Numarayı kontrol edin/);
  assert.doesNotMatch(e.message, /servisi 404 döndü/);
});

test('OE2 5xx -> "yanit veremiyor, tekrar deneyin"; 401/403 -> "yoneticiye bildirin"', () => {
  const s = describeUpstreamError(503, '', '1');
  assert.equal(s.status, 502);
  assert.match(s.message, /yanıt veremiyor/);
  assert.match(s.message, /tekrar deneyin/);
  const f = describeUpstreamError(403, '', '1');
  assert.match(f.message, /yöneticiye bildirin/);
  assert.match(f.message, /HTTP 403/);
});

test('OE3 servis govdesi: JSON mesaji ipucu olur, HTML hata sayfasi ATILIR', () => {
  assert.equal(upstreamHint('{"Message":"No record for wfInstanceId"}'), 'No record for wfInstanceId');
  assert.equal(upstreamHint('<!DOCTYPE html><html><body><h1>404 - File or directory not found.</h1></body></html>'), '');
  assert.equal(upstreamHint(''), '');
  assert.match(describeUpstreamError(404, '{"Message":"yok"}', '5').message, /\(yok\)$/);
});
