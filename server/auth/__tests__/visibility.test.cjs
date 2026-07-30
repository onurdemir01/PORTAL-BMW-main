// server/auth/__tests__/visibility.test.cjs — Gorunurluk motorunun SAF karar mantigi
// (DB gerektirmez). Cozunurluk onceligini dogrular: enabled kill-switch → admin → user
// kurali > role kurali → default_visible. Bkz. server/auth/visibility.cjs.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const db = require('../../db/index.cjs');
const {
  _decide: decide, _buildRuleIndex: buildRuleIndex, requireVisiblePrefix,
  writeVisibility, readVisibility, DEFAULT_VISIBILITY,
} = require('../visibility.cjs');

function mockRes() {
  return {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const EL = (over = {}) => ({ element_key: 'page:x', enabled: 1, default_visible: 1, ...over });

test('disabled element herkese kapalı — admin dahil (global kill-switch)', () => {
  const idx = buildRuleIndex([]);
  assert.equal(decide(EL({ enabled: 0 }), idx, 'Admin', 'jdoe'), false);
  assert.equal(decide(EL({ enabled: 0 }), idx, 'User', 'jdoe'), false);
});

test('enabled element: admin her zaman görür (kurallardan bağımsız)', () => {
  const idx = buildRuleIndex([{ element_key: 'page:x', principal_type: 'role', principal_id: 'Admin', allow: 0 }]);
  assert.equal(decide(EL(), idx, 'Admin', 'jdoe'), true);
});

test('user kuralı role kuralını EZER (user deny > role allow)', () => {
  const idx = buildRuleIndex([
    { element_key: 'page:x', principal_type: 'role', principal_id: 'User', allow: 1 },
    { element_key: 'page:x', principal_type: 'user', principal_id: 'jdoe', allow: 0 },
  ]);
  assert.equal(decide(EL(), idx, 'User', 'jdoe'), false);
});

test('user allow, role deny → user allow kazanır', () => {
  const idx = buildRuleIndex([
    { element_key: 'page:x', principal_type: 'role', principal_id: 'User', allow: 0 },
    { element_key: 'page:x', principal_type: 'user', principal_id: 'jdoe', allow: 1 },
  ]);
  assert.equal(decide(EL(), idx, 'User', 'jdoe'), true);
});

test('yalnızca role kuralı: allow → görünür, deny → gizli', () => {
  const allow = buildRuleIndex([{ element_key: 'page:x', principal_type: 'role', principal_id: 'User', allow: 1 }]);
  const deny = buildRuleIndex([{ element_key: 'page:x', principal_type: 'role', principal_id: 'User', allow: 0 }]);
  assert.equal(decide(EL({ default_visible: 0 }), allow, 'User', 'jdoe'), true);
  assert.equal(decide(EL({ default_visible: 1 }), deny, 'User', 'jdoe'), false);
});

test('hiç kural yoksa default_visible geçerli', () => {
  const idx = buildRuleIndex([]);
  assert.equal(decide(EL({ default_visible: 1 }), idx, 'User', 'jdoe'), true);
  assert.equal(decide(EL({ default_visible: 0 }), idx, 'User', 'jdoe'), false);
});

test('principal_id eşleşmesi büyük/küçük harf duyarsız', () => {
  const idx = buildRuleIndex([{ element_key: 'page:x', principal_type: 'user', principal_id: 'JDoe', allow: 0 }]);
  // decide username'i lowercase bekler (resolveVisibility oyle gecirir)
  assert.equal(decide(EL(), idx, 'User', 'jdoe'), false);
});

test('requireVisiblePrefix: exempt yol (ör. /health) auth/görünürlük kontrolüne girmeden geçer', () => {
  const mw = requireVisiblePrefix('Envanter', { exempt: ['/health'] });
  let nexted = false;
  const res = mockRes();
  mw({ path: '/health', headers: {}, session: undefined }, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(res.statusCode, 0); // hic yanit yazilmadi
});

test('requireVisiblePrefix: exempt olmayan yol, session/secret yoksa 401 (auth zorlanır)', () => {
  const mw = requireVisiblePrefix('Envanter', { exempt: ['/health'] });
  let nexted = false;
  const res = mockRes();
  // getRequestUser: session yok + PORTAL_TRUSTED_HEADER_SECRET yok → null → 401
  mw({ path: '/tables', headers: {}, session: undefined }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

// ── Legacy sayfa-gorunurlugu: writeVisibility per-row hata izolasyonu (review.md #15) ──
// auth/index.cjs'ten buraya tasindiktan sonra, bir sayfanin DB yazimi basarisiz olsa bile
// digerleri etkilenmemeli VE hangi sayfalarin basarisiz oldugu caller'a raporlanmali
// (eskiden ilk hata donguyu sessizce kesip kismi/tutarsiz durum birakiyordu).
test('writeVisibility(): bir sayfanin yazimi basarisiz olsa da digerleri yazilir, failed listesi doner', async (t) => {
  const written = [];
  t.mock.method(db, 'query', async (sql, params) => {
    if (/^UPDATE/.test(sql)) {
      if (params[1] === 'Ansible') throw new Error('simüle DB hatası');
      written.push(params[1]);
      return { rowCount: 1 };
    }
    return { rows: [] };
  });
  const result = await writeVisibility({
    Dashboard: ['Admin', 'User'],
    Ansible: ['Admin'],
    LogX: ['Admin', 'User'],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ['Ansible']);
  assert.deepEqual(written, ['Dashboard', 'LogX'], 'basarisiz sayfa disindaki yazimlar etkilenmemeli');
});

test('writeVisibility(): hicbir hata yoksa ok=true, failed=[]', async (t) => {
  t.mock.method(db, 'query', async (sql) => (/^UPDATE/.test(sql) ? { rowCount: 1 } : { rows: [] }));
  const result = await writeVisibility({ Dashboard: ['Admin', 'User'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failed, []);
});

test('readVisibility(): DB bossa DEFAULT_VISIBILITY doner', async (t) => {
  t.mock.method(db, 'query', async () => ({ rows: [] }));
  const v = await readVisibility();
  assert.deepEqual(v, DEFAULT_VISIBILITY);
});
