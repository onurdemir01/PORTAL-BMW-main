// server/ai/__tests__/provider.test.cjs — checkRateLimit + _rateMap sizinti duzeltmesinin
// (kurumsal AI kod incelemesi Finding 6) regresyon testleri. Gercek HTTPS/API cagrisi
// gerektirmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const provider = require('../provider.cjs');

test('checkRateLimit(): limit altinda false doner, limite ulasinca true', () => {
  const user = `test-user-${Date.now()}-a`;
  // FEATURE_LIMITS.logs = { max: 10, windowMs: 1h }
  for (let i = 0; i < 10; i++) {
    assert.equal(provider.checkRateLimit(user, 'logs'), false, `istek #${i + 1} limit altinda kalmali`);
  }
  assert.equal(provider.checkRateLimit(user, 'logs'), true, '11. istek limiti asmali');
});

test('checkRateLimit(): farkli feature ayni kullanici icin BAGIMSIZ kota tutar', () => {
  const user = `test-user-${Date.now()}-b`;
  for (let i = 0; i < 20; i++) provider.checkRateLimit(user, 'chat'); // chat kotasini doldur
  // logs kotasi chat'ten etkilenmemeli
  assert.equal(provider.checkRateLimit(user, 'logs'), false);
});

// ── Finding 6: sizinti onlemi — pencere disina dusen anahtarlar supurulmeli ────────────
test('_sweepRateMap(): tum zaman damgalari eskimis anahtarlar Map\'ten silinir', () => {
  const user = `test-user-${Date.now()}-c`;
  provider.checkRateLimit(user, 'logs'); // anahtari olustur
  const key = `logs:${user}`;
  assert.ok(provider._rateMap.has(key), 'anahtar once var olmali');

  // zaman damgasini yapay olarak pencerenin (1 saat) cok disina tasi
  provider._rateMap.set(key, [Date.now() - 999_999_999]);
  provider._sweepRateMap();

  assert.ok(!provider._rateMap.has(key), 'supurme sonrasi eskimis anahtar silinmis olmali');
});

test('_sweepRateMap(): AKTIF (pencere icinde) anahtarlara dokunmaz', () => {
  const user = `test-user-${Date.now()}-d`;
  provider.checkRateLimit(user, 'chat');
  const key = `chat:${user}`;
  provider._sweepRateMap();
  assert.ok(provider._rateMap.has(key), 'aktif anahtar supurme sonrasi kalmali');
});

test('getFeatureLimits(): saat basina limitleri ozetler', () => {
  const limits = provider.getFeatureLimits();
  assert.deepEqual(limits, { logs: { maxPerHour: 10 }, chat: { maxPerHour: 20 } });
});

// ── ai_review_3.md #22: API-key header'lari merkezi tek fonksiyondan gelir ────────────
// Eskiden orchestrator.cjs VE logx/ai-analyzer.cjs process.env.ANTHROPIC_API_KEY/
// OPENAI_API_KEY'e dogrudan erisip kendi header nesnelerini kuruyordu (2 ayri kopya).
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

test('getApiHeaders(): anthropic icin x-api-key + anthropic-version doner', () => {
  withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' }, () => {
    assert.deepEqual(provider.getApiHeaders(), {
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
    });
  });
});

test('getApiHeaders(): openai icin Bearer authorization doner', () => {
  withEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-oai-test' }, () => {
    assert.deepEqual(provider.getApiHeaders(), { authorization: 'Bearer sk-oai-test' });
  });
});
