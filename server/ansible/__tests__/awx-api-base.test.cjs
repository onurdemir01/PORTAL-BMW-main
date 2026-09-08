// server/ansible/__tests__/awx-api-base.test.cjs
//
// NEDEN VAR (2026-09-08): Yeni bir AWX (maestro3) eklenirken token alınamadı:
//   "AWX v2/tokens yanıtı JSON değil: <!doctype html> ... <title>Not Found</title>"
// İlk teşhis "firewall" yönündeydi ama gelen şey Django'nun 404 SAYFASIYDI — yani
// bağlantı kurulmuş, istek karşıya ulaşmış ve uygulama cevap vermişti. Firewall olsaydı
// zaman aşımı veya bağlantı reddi olurdu.
//
// Gerçek sebep: AAP 2.5 ile controller API'si bir gateway'in arkasına alındı ve yolu
// değişti — /api/v2/... yerine /api/controller/v2/... . Sunucu üzerinde doğrulandı:
//   /api/v2/ping/            -> 404
//   /api/controller/v2/ping/ -> 200
//
// Kodun 27 yerinde yol `/api/v2/...` olarak sabitti ve sunucu adresine önek yazmak
// ÇÖZMÜYORDU: `new URL(mutlakYol, taban)` tabandaki yolu atar. Bu yüzden çeviri tek
// noktada, istek katmanında yapılıyor. Bu test o çevirinin doğru ve YAN ETKİSİZ
// olduğunu kilitler — mevcut AWX sunucularının davranışı değişmemeli.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { _normalizeApiBase: normalizeApiBase, _mapApiPath: mapApiPath } = require('../runner.cjs');

const AWX = { name: 'Maestro2', apiBase: '/api/v2' };
const AAP = { name: 'Maestro3', apiBase: '/api/controller/v2' };

test('taban verilmezse KLASIK AWX yolu kalir (geriye donuk uyum)', () => {
  assert.strictEqual(normalizeApiBase(''), '/api/v2');
  assert.strictEqual(normalizeApiBase(null), '/api/v2');
  assert.strictEqual(normalizeApiBase(undefined), '/api/v2');
  assert.strictEqual(normalizeApiBase('   '), '/api/v2');
});

test('taban normalize edilir: bastaki / eklenir, sondaki / atilir', () => {
  assert.strictEqual(normalizeApiBase('api/controller/v2'), '/api/controller/v2');
  assert.strictEqual(normalizeApiBase('/api/controller/v2/'), '/api/controller/v2');
  assert.strictEqual(normalizeApiBase('/api/controller/v2///'), '/api/controller/v2');
});

test('MEVCUT sunucularin yollari DEGISMEZ (yan etki yok)', () => {
  for (const p of ['/api/v2/tokens/', '/api/v2/ping/', '/api/v2/job_templates/?page_size=100',
                   '/api/v2/jobs/42/stdout/?format=txt']) {
    assert.strictEqual(mapApiPath(AWX, p), p);
    assert.strictEqual(mapApiPath(undefined, p), p, 'sunucu bilinmiyorsa da degismemeli');
    assert.strictEqual(mapApiPath({}, p), p, 'apiBase yoksa da degismemeli');
  }
});

test('AAP 2.5 sunucusunda /api/v2 -> /api/controller/v2', () => {
  assert.strictEqual(mapApiPath(AAP, '/api/v2/tokens/'), '/api/controller/v2/tokens/');
  assert.strictEqual(mapApiPath(AAP, '/api/v2/ping/'), '/api/controller/v2/ping/');
});

test('sorgu dizesi ve derin yollar KORUNUR', () => {
  assert.strictEqual(
    mapApiPath(AAP, '/api/v2/jobs/42/stdout/?format=txt'),
    '/api/controller/v2/jobs/42/stdout/?format=txt',
  );
  assert.strictEqual(
    mapApiPath(AAP, '/api/v2/job_events/?page_size=500&order_by=counter'),
    '/api/controller/v2/job_events/?page_size=500&order_by=counter',
  );
});

test('/api/v2 ile BASLAMAYAN yollara DOKUNULMAZ', () => {
  // OAuth ucu controller altinda DEGIL; yanlislikla cevrilirse token akisi bozulurdu.
  assert.strictEqual(mapApiPath(AAP, '/api/o/token/'), '/api/o/token/');
  assert.strictEqual(mapApiPath(AAP, '/o/token/'), '/o/token/');
  assert.strictEqual(mapApiPath(AAP, '/api/login/'), '/api/login/');
});

test('cevrim yalnizca BASTAKI oneke uygulanir', () => {
  // Yol icinde gecen benzer bir metin ikinci kez cevrilmemeli.
  assert.strictEqual(
    mapApiPath(AAP, '/api/v2/job_templates/?search=/api/v2/'),
    '/api/controller/v2/job_templates/?search=/api/v2/',
  );
});
