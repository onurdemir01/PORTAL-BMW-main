// server/oco/__tests__/client-errors.test.cjs — OLMAYAN OCO icin okunur hata.
//
// Kullanici bildirimi (2026-09-15): OCO Kontrolu acikken var olmayan bir numara girilince
// ekranda "OCO servisi 404 dondu." gibi ham bir satir cikiyordu. Kullanici ne oldugunu ve
// ne yapmasi gerektigini okuyabilmeli; HTTP kodu yonetici icin parantezde kalir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeUpstreamError, upstreamHint, httpStatus } = require('../client.cjs');

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

// Ekran goruntusu (2026-09-16): 404 JSON cevabi nginx (proxy_intercept_errors + error_page
// 403 404 500 502 503 504) tarafindan HTML hata sayfasiyla degistiriliyor; kullanici
// "<!doctype html>..." goruyordu. Kullaniciya mesaj tasiyan cevaplar 400 ile donmeli.
test('OE4 nginx tarafindan yakalanan kodlar (404/502/503) HTTP katmaninda 400 olur, digerleri kalir', () => {
  assert.equal(httpStatus(describeUpstreamError(404, '', '1')), 400);
  assert.equal(httpStatus(describeUpstreamError(503, '', '1')), 400);
  assert.equal(httpStatus({ status: 502 }), 400);
  assert.equal(httpStatus({ status: 400 }), 400);
  assert.equal(httpStatus({ status: 422 }), 422);
  assert.equal(httpStatus({}), 400);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'change-gates.cjs'), 'utf8');
  assert.match(src, /status: ocoClient\.httpStatus\(ocoErr\)/, 'change-gates OCO hatasinda ham status donuyor (404 -> HTML)');
  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'runner.cjs'), 'utf8');
  assert.match(runner, /httpStatus\(err\)\)\.json\(\{ ok: false, message: err\.message \}\)/, 'oco/validate ucu ham status donuyor');
});
