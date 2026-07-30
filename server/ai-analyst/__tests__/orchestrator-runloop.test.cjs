// server/ai-analyst/__tests__/orchestrator-runloop.test.cjs — runAnthropic/runOpenAI'nin
// ortak cikarilan runLoop() cekirdeginin izole davranis testleri (DB/gercek API gerektirmez).
// Kurumsal AI kod incelemesinin Finding 23 (kod tekrari) duzeltmesinin regresyon kilidi:
// deadline kontrolu, isDone kisa-devresi, arac basari/hata yollari, azami-iterasyon mesaji.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { _runLoop: runLoop, _truncate: truncate } = require('../orchestrator.cjs');

function collectEmits() {
  const events = [];
  return { events, emit: (e) => events.push(e) };
}

test('runLoop(): isDone=true ise tek turda biter, pushAssistantTurn/pushToolResults ASLA cagrilmaz', async () => {
  const { events, emit } = collectEmits();
  let assistantPushed = false, resultsPushed = false;
  await runLoop({
    tools: [],
    emit,
    deadline: Date.now() + 10_000,
    callApi: async () => ({ text: 'final cevap' }),
    parseResponse: (resp) => ({ textParts: [resp.text], toolCalls: [], isDone: true }),
    pushAssistantTurn: () => { assistantPushed = true; },
    pushToolResults: () => { resultsPushed = true; },
  });
  assert.equal(assistantPushed, false, 'final yanitta assistant turu convo\'ya yazilmamali (orijinal davranis)');
  assert.equal(resultsPushed, false);
  assert.deepEqual(events, [{ type: 'text', text: 'final cevap' }]);
});

test('runLoop(): arac basariyla calisirsa tool_call + tool_result(ok:true) emit edilir, sonuc pushToolResults\'a gider', async () => {
  const { events, emit } = collectEmits();
  let callCount = 0;
  let pushedResults = null;
  const fakeTool = { name: 'test_tool', exec: async (args) => `sonuc:${args.x}` };

  await runLoop({
    tools: [fakeTool],
    emit,
    deadline: Date.now() + 10_000,
    callApi: async () => {
      callCount++;
      return callCount === 1
        ? { hasTool: true }
        : { hasTool: false };
    },
    parseResponse: (resp) => resp.hasTool
      ? { textParts: [], toolCalls: [{ id: 't1', name: 'test_tool', args: { x: 42 } }], isDone: false }
      : { textParts: ['bitti'], toolCalls: [], isDone: true },
    pushAssistantTurn: () => {},
    pushToolResults: (results) => { pushedResults = results; },
  });

  assert.equal(callCount, 2, 'ilk turda arac cagrisi, ikinci turda final yanit');
  assert.deepEqual(events[0], { type: 'tool_call', name: 'test_tool', args: { x: 42 } });
  assert.equal(events[1].type, 'tool_result');
  assert.equal(events[1].ok, true);
  assert.equal(pushedResults.length, 1);
  assert.equal(pushedResults[0].content, 'sonuc:42');
});

test('runLoop(): bilinmeyen arac adi HATA olarak yakalanir, dongu cokmez', async () => {
  const { events, emit } = collectEmits();
  let turn = 0;
  await runLoop({
    tools: [], // hicbir arac tanimli degil
    emit,
    deadline: Date.now() + 10_000,
    callApi: async () => { turn++; return { turn }; },
    parseResponse: (resp) => resp.turn === 1
      ? { textParts: [], toolCalls: [{ id: 'x', name: 'olmayan_arac', args: {} }], isDone: false }
      : { textParts: ['tamam'], toolCalls: [], isDone: true },
    pushAssistantTurn: () => {},
    pushToolResults: () => {},
  });
  const toolResultEvent = events.find((e) => e.type === 'tool_result');
  assert.equal(toolResultEvent.ok, false);
  assert.match(toolResultEvent.preview, /Bilinmeyen araç/);
});

test('runLoop(): deadline gecmisse hemen hata firlatir (API cagirilmadan)', async () => {
  let called = false;
  await assert.rejects(
    () => runLoop({
      tools: [], emit: () => {}, deadline: Date.now() - 1,
      callApi: async () => { called = true; return {}; },
      parseResponse: () => ({ textParts: [], toolCalls: [], isDone: true }),
      pushAssistantTurn: () => {}, pushToolResults: () => {},
    }),
    /süre bütçesi aşıldı/
  );
  assert.equal(called, false);
});

test('runLoop(): MAX_ITERATIONS (15) turu da arac istegi donerse azami-iterasyon mesajiyla biter', async () => {
  const { events, emit } = collectEmits();
  const fakeTool = { name: 't', exec: async () => 'ok' };
  await runLoop({
    tools: [fakeTool], emit, deadline: Date.now() + 30_000,
    callApi: async () => ({}),
    parseResponse: () => ({ textParts: [], toolCalls: [{ id: '1', name: 't', args: {} }], isDone: false }),
    pushAssistantTurn: () => {}, pushToolResults: () => {},
  });
  const last = events[events.length - 1];
  assert.equal(last.type, 'text');
  assert.match(last.text, /[Mm]aksimum araç çağrısı/);
});

test('truncate(): TOOL_RESULT_MAX (8000) üstü metin kırpılır ve karakter sayısı belirtilir', () => {
  const long = 'a'.repeat(9000);
  const out = truncate(long);
  assert.ok(out.length < long.length);
  assert.match(out, /kırpıldı, toplam 9000 karakter/);
});

test('truncate(): kısa metin/obje aynen (JSON.stringify ile) döner', () => {
  assert.equal(truncate('kisa'), 'kisa');
  assert.equal(truncate({ a: 1 }), '{"a":1}');
});
