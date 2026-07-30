// server/ai-analyst/__tests__/history.test.cjs — server/ai-analyst/history.cjs icin
// db.query t.mock.method ile sahtelenip yazilan SQL/paramlar dogrulanir (gercek MSSQL
// GEREKMEZ) — bkz. server/logx/v2/__tests__/persistence.test.cjs ile ayni desen.
// Kurumsal AI kod incelemesi bulgu #9 (SQL string interpolasyonu), #14 (appendMessage
// round-trip sayisi), #28 (ham OUTPUT INSERTED yerine RETURNING) icin regresyon kilidi.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/index.cjs');
const history = require('../history.cjs');

// ── Finding 28: createConversation adaptorun RETURNING sozdizimini kullanmali ──────────────
test('createConversation(): RETURNING id kullanilir, ham OUTPUT INSERTED DEGIL', async (t) => {
  let captured = null;
  t.mock.method(db, 'query', async (sql, params) => {
    captured = { sql, params };
    return { rows: [{ id: 42 }] };
  });
  const id = await history.createConversation('JDoe', 'Test sohbeti');
  assert.equal(id, 42);
  assert.match(captured.sql, /RETURNING id/i);
  assert.doesNotMatch(captured.sql, /OUTPUT INSERTED/i, 'adaptorun cevirdigi tasinabilir sozdizimi kullanilmali');
  assert.equal(captured.params[0], 'jdoe', 'username lowercase saklanir');
});

// ── Finding 14: appendMessage TEK db.query cagrisinda (multi-statement batch) yapilmali ───
test('appendMessage(): INSERT+UPDATE tek db.query cagrisinda (2 round-trip degil 1)', async (t) => {
  let callCount = 0;
  let captured = null;
  t.mock.method(db, 'query', async (sql, params) => {
    callCount++;
    captured = { sql, params };
    return { rows: [], rowCount: 1 };
  });
  await history.appendMessage(7, 'assistant', 'merhaba', null);
  assert.equal(callCount, 1, 'INSERT ve UPDATE ayni db.query cagrisinda batch edilmeli');
  assert.match(captured.sql, /INSERT INTO ai_messages/i);
  assert.match(captured.sql, /UPDATE ai_conversations SET updated_at/i);
  // conversationId ($1) her iki ifadede de ayni degere baglanmali
  assert.equal(captured.params[0], 7);
});

// ── Finding 9: usageSummary days parametre olarak gecmeli, string interpolasyonu DEGIL ────
test('usageSummary(): days SQL metnine gomulmez, baglanmis parametre olarak gecer', async (t) => {
  let captured = null;
  t.mock.method(db, 'query', async (sql, params) => {
    captured = { sql, params };
    return { rows: [] };
  });
  await history.usageSummary(14);
  assert.doesNotMatch(captured.sql, /-14,/, 'days degeri metne interpolasyonla gomulmemeli');
  assert.match(captured.sql, /DATEADD\(day, -\$1,/i);
  assert.equal(captured.params[0], 14);
});

test('usageSummary(): days 365 ile sinirlanir (ust sinir asilmaz)', async (t) => {
  let captured = null;
  t.mock.method(db, 'query', async (sql, params) => { captured = { sql, params }; return { rows: [] }; });
  await history.usageSummary(9999);
  assert.equal(captured.params[0], 365);
});
