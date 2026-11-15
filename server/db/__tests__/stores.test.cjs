// server/db/__tests__/stores.test.cjs — "Her sey DB'de" kaliciligi birim testleri.
// db.query t.mock.method ile sahtelenir — gercek MSSQL GEREKMEZ. Kapsam:
//   - portal audit zinciri (hash hesap + verify + redaksiyon)
//   - env-overrides beyaz liste zorlamasi
//   - kullanici tercihi KV yazimi (upsert + null → delete)
//   - masker DB kural derleme + sira korunumu + fallback
//   - duty-roster upsert merge anahtari (duty_date + lower(email))
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../index.cjs');

// ── portal audit zinciri ──────────────────────────────────────────────────────
test('auditPortal(): portal_audit_logs INSERT v3 hash zinciriyle yazilir', async (t) => {
  const queries = [];
  t.mock.method(db, 'query', async (sql, params) => {
    queries.push({ sql, params });
    if (/SELECT TOP 1 entry_hash/i.test(sql)) return { rows: [{ entry_hash: 'v3:prevhash' }] };
    return { rows: [], rowCount: 1 };
  });
  const { portalAudit } = require('../../audit/index.cjs');
  await portalAudit.log({ username: 'jdoe', action: 'login', detail: 'authSource=ldap' });

  const ins = queries.find((q) => /INSERT INTO portal_audit_logs/i.test(q.sql));
  assert.ok(ins, 'INSERT calismali');
  assert.equal(ins.params[1], 'jdoe');
  assert.equal(ins.params[6], 'login');
  assert.equal(ins.params[10], 'v3:prevhash');            // prev_hash
  assert.match(ins.params[11], /^v3:[a-f0-9]{64}$/);      // entry_hash
});

test('verifyChain(): bozulmus kayit tespit edilir', async (t) => {
  const crypto = require('crypto');
  const mk = (prev, u, a, d) => 'v3:' + crypto.createHash('sha256')
    .update([prev, u, a, String(d || '')].join('|')).digest('hex');
  const h1 = mk('', 'u1', 'login', 'x');
  const rows = [
    { id: 1, username: 'u1', action: 'login', detail: 'x', prev_hash: '', entry_hash: h1 },
    // Ikinci kayit: detail sonradan degistirilmis gibi — hash uyusmaz
    { id: 2, username: 'u1', action: 'login', detail: 'TAMPERED', prev_hash: h1, entry_hash: mk(h1, 'u1', 'login', 'orijinal') },
  ];
  t.mock.method(db, 'query', async (sql) => {
    if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: 2 }] };
    return { rows };
  });
  const { createAuditChain } = require('../../audit/index.cjs');
  const result = await createAuditChain('portal_audit_logs').verifyChain();
  assert.equal(result.ok, false);
  assert.equal(result.broken, 1);
  assert.equal(result.firstBrokenId, 2);
});

test('auditMutations(): body redaksiyonu — sifre/token degerleri audit detayina yazilmaz', async (t) => {
  const inserts = [];
  t.mock.method(db, 'query', async (sql, params) => {
    if (/INSERT INTO portal_audit_logs/i.test(sql)) inserts.push(params);
    if (/SELECT TOP 1 entry_hash/i.test(sql)) return { rows: [] };
    return { rows: [], rowCount: 1 };
  });
  const { auditMutations } = require('../../audit/index.cjs');
  const mw = auditMutations('testmod');

  // finish handler'ini yakalayan sahte req/res
  let finishCb = null;
  const req = {
    method: 'POST', path: '/items', originalUrl: '/api/test/items',
    body: { name: 'abc', password: 'gizli123', nested: { apiToken: 'sekret' } },
    session: { user: { username: 'adm', role: 'Admin' } }, ip: '1.2.3.4',
  };
  const res = { statusCode: 200, on: (ev, cb) => { if (ev === 'finish') finishCb = cb; } };
  await new Promise((resolve) => { mw(req, res, resolve); });
  assert.ok(finishCb, 'finish dinleyicisi takilmali');
  finishCb();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(inserts.length, 1, 'bir audit kaydi yazilmali');
  const detail = inserts[0][8];
  assert.match(detail, /abc/);
  assert.doesNotMatch(detail, /gizli123/);
  assert.doesNotMatch(detail, /sekret/);
  assert.match(detail, /\[REDACTED\]/);
});

// ── env-overrides beyaz liste ─────────────────────────────────────────────────
test('loadEnvOverrides(): beyaz liste DISINDAKI anahtar process.env\'e uygulanmaz', async (t) => {
  t.mock.method(db, 'query', async () => ({
    rows: [
      { env_key: 'AI_PROVIDER', env_value: 'anthropic' },
      { env_key: 'EVIL_INJECTED_KEY', env_value: 'hacked' },
      { env_key: 'PATH', env_value: '/tmp/evil' },
    ],
  }));
  const savedPath = process.env.PATH;
  delete process.env.EVIL_INJECTED_KEY;
  const prevProvider = process.env.AI_PROVIDER;

  const { loadEnvOverrides } = require('../env-overrides.cjs');
  await loadEnvOverrides();

  assert.equal(process.env.AI_PROVIDER, 'anthropic');
  assert.equal(process.env.EVIL_INJECTED_KEY, undefined, 'beyaz liste disi anahtar uygulanmamali');
  assert.equal(process.env.PATH, savedPath, 'PATH degismemeli');

  if (prevProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = prevProvider;
});

test('setEnvOverride(): beyaz liste disi anahtar reddedilir', async (t) => {
  t.mock.method(db, 'query', async () => ({ rows: [], rowCount: 1 }));
  const { setEnvOverride } = require('../env-overrides.cjs');
  await assert.rejects(() => setEnvOverride('LD_PRELOAD', '/evil.so', 'adm'), /duzenlenemez/);
});

// Kurumsal AI kod incelemesi Finding 24: NODE_ENV DB'den hot-swap edilebilseydi, DB yazma
// erisimi olan biri restart'siz secure-cookie'yi devre disi birakabilirdi (auth/index.cjs
// NODE_ENV'i her istekte canli okuyor). NODE_ENV bilerek SYSTEM_CONFIG_KEYS disinda tutulur.
test('SYSTEM_CONFIG_KEYS: NODE_ENV listede DEGIL (DB uzerinden degistirilemez)', () => {
  const { SYSTEM_CONFIG_KEYS } = require('../env-overrides.cjs');
  assert.ok(!SYSTEM_CONFIG_KEYS.includes('NODE_ENV'), 'NODE_ENV DB override whitelist\'inde olmamali');
});

test('setEnvOverride(): NODE_ENV acikca reddedilir (whitelist disi)', async (t) => {
  t.mock.method(db, 'query', async () => ({ rows: [], rowCount: 1 }));
  const { setEnvOverride } = require('../env-overrides.cjs');
  await assert.rejects(() => setEnvOverride('NODE_ENV', 'development', 'adm'), /duzenlenemez/);
});

test('loadEnvOverrides(): DB icinde NODE_ENV satiri olsa bile process.env.NODE_ENV DEGISMEZ', async (t) => {
  t.mock.method(db, 'query', async () => ({
    rows: [{ env_key: 'NODE_ENV', env_value: 'development' }],
  }));
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const { loadEnvOverrides } = require('../env-overrides.cjs');
  await loadEnvOverrides();
  assert.equal(process.env.NODE_ENV, 'production', 'DB\'deki NODE_ENV satiri uygulanmamali');
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

// ── ai_review_3.md #17: production'da anahtarsiz gizli-deger yazimi ARTIK reddedilir ──
test('setEnvOverride(): production + ENV_OVERRIDES_ENCRYPTION_KEY yokken ANTHROPIC_API_KEY yazimi reddedilir', async (t) => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedKey = process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  process.env.NODE_ENV = 'production';
  delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;

  t.mock.method(db, 'query', async () => ({ rows: [], rowCount: 1 }));
  const { setEnvOverride } = require('../env-overrides.cjs');
  await assert.rejects(
    () => setEnvOverride('ANTHROPIC_API_KEY', 'sk-secret', 'adm'),
    /ENV_OVERRIDES_ENCRYPTION_KEY tanimli degil/
  );

  if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
  if (savedKey === undefined) delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY; else process.env.ENV_OVERRIDES_ENCRYPTION_KEY = savedKey;
});

test('setEnvOverride(): DEV/test ortaminda (production DEGIL) anahtarsiz yazim hala duz metin olarak kabul edilir', async (t) => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedKey = process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  process.env.NODE_ENV = 'test';
  delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;

  let writtenValue = null;
  t.mock.method(db, 'query', async (sql, params) => {
    if (/^UPDATE/.test(sql)) { writtenValue = params[0]; return { rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  });
  const { setEnvOverride } = require('../env-overrides.cjs');
  await setEnvOverride('ANTHROPIC_API_KEY', 'sk-secret', 'adm');
  assert.equal(writtenValue, 'sk-secret', 'anahtarsiz dev/test ortaminda graceful-degrade (duz metin) korunmali');

  delete process.env.ANTHROPIC_API_KEY;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
  if (savedKey === undefined) delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY; else process.env.ENV_OVERRIDES_ENCRYPTION_KEY = savedKey;
});

// ── env-overrides sifreli gizli-anahtar saklama (review.md #7) ─────────────────
test('setEnvOverride(): ENV_OVERRIDES_ENCRYPTION_KEY tanimliyken ANTHROPIC_API_KEY DB\'ye sifreli (enc:v1: onekli) yazilir', async (t) => {
  const savedKey = process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  process.env.ENV_OVERRIDES_ENCRYPTION_KEY = 'a'.repeat(64); // 32 byte hex

  let writtenValue = null;
  t.mock.method(db, 'query', async (sql, params) => {
    if (/^UPDATE/.test(sql)) { writtenValue = params[0]; return { rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  });

  const { setEnvOverride } = require('../env-overrides.cjs');
  await setEnvOverride('ANTHROPIC_API_KEY', 'sk-plaintext-secret', 'adm');

  assert.ok(writtenValue.startsWith('enc:v1:'), 'DB\'ye yazilan deger sifreli olmali');
  assert.ok(!writtenValue.includes('sk-plaintext-secret'), 'duz metin sifreli deger icinde gorunmemeli');
  assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-plaintext-secret', 'process.env her zaman duz deger almali');

  delete process.env.ANTHROPIC_API_KEY;
  if (savedKey === undefined) delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  else process.env.ENV_OVERRIDES_ENCRYPTION_KEY = savedKey;
});

test('setEnvOverride(): gizli-olmayan anahtar (AWX_URL) sifrelenmez, duz metin kalir', async (t) => {
  const savedKey = process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  process.env.ENV_OVERRIDES_ENCRYPTION_KEY = 'a'.repeat(64);

  let writtenValue = null;
  t.mock.method(db, 'query', async (sql, params) => {
    if (/^UPDATE/.test(sql)) { writtenValue = params[0]; return { rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  });

  const { setEnvOverride } = require('../env-overrides.cjs');
  await setEnvOverride('AWX_URL', 'https://awx.internal', 'adm');

  assert.equal(writtenValue, 'https://awx.internal');

  delete process.env.AWX_URL;
  if (savedKey === undefined) delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  else process.env.ENV_OVERRIDES_ENCRYPTION_KEY = savedKey;
});

test('loadEnvOverrides(): sifreli ANTHROPIC_API_KEY dogru anahtarla cozulup process.env\'e duz yazilir', async (t) => {
  const savedKey = process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  process.env.ENV_OVERRIDES_ENCRYPTION_KEY = 'b'.repeat(64);

  // Ayni surecte once setEnvOverride ile sifrele, DB'ye yazilan degeri yakala, sonra
  // o degeri loadEnvOverrides'a "DB'den okunmus" gibi geri ver — round-trip testi.
  let stored = null;
  t.mock.method(db, 'query', async (sql, params) => {
    if (/^UPDATE/.test(sql)) { stored = params[0]; return { rowCount: 1 }; }
    return { rows: [] };
  });
  const { setEnvOverride } = require('../env-overrides.cjs');
  await setEnvOverride('OPENAI_API_KEY', 'sk-roundtrip-secret', 'adm');
  delete process.env.OPENAI_API_KEY;

  t.mock.method(db, 'query', async () => ({ rows: [{ env_key: 'OPENAI_API_KEY', env_value: stored }] }));
  const { loadEnvOverrides } = require('../env-overrides.cjs');
  await loadEnvOverrides();

  assert.equal(process.env.OPENAI_API_KEY, 'sk-roundtrip-secret');

  delete process.env.OPENAI_API_KEY;
  if (savedKey === undefined) delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  else process.env.ENV_OVERRIDES_ENCRYPTION_KEY = savedKey;
});

test('loadEnvOverrides(): ENV_OVERRIDES_ENCRYPTION_KEY eksikken sifreli satir atlanir, process crash olmaz', async (t) => {
  const savedKey = process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  t.mock.method(db, 'query', async () => ({
    rows: [{ env_key: 'ANTHROPIC_API_KEY', env_value: 'enc:v1:eyJmYWtlIjoidmFsdWUifQ==' }],
  }));
  const { loadEnvOverrides } = require('../env-overrides.cjs');
  await assert.doesNotReject(() => loadEnvOverrides());
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, 'anahtar yoksa cozulemeyen satir process.env\'e uygulanmamali');

  if (savedKey === undefined) delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  else process.env.ENV_OVERRIDES_ENCRYPTION_KEY = savedKey;
});

// ── kullanici tercihleri (portal_user_preferences) ────────────────────────────
test('setPref(): UPDATE bulamazsa INSERT (upsert), null deger DELETE', async (t) => {
  const calls = [];
  t.mock.method(db, 'query', async (sql, params) => {
    calls.push({ sql, params });
    if (/^UPDATE/i.test(sql.trim())) return { rows: [], rowCount: 0 }; // yok → insert'e dus
    return { rows: [], rowCount: 1 };
  });
  const users = require('../../auth/users.cjs');

  await users.setPref('JDoe', 'bmw-theme', 'dark');
  assert.ok(calls.some((c) => /INSERT INTO portal_user_preferences/i.test(c.sql)), 'INSERT olmali');
  const ins = calls.find((c) => /INSERT INTO portal_user_preferences/i.test(c.sql));
  assert.equal(ins.params[0], 'jdoe', 'username lowercase saklanir');
  assert.equal(ins.params[1], 'bmw-theme');
  assert.equal(ins.params[2], 'dark');

  calls.length = 0;
  await users.setPref('jdoe', 'bmw-theme', null);
  assert.ok(calls.some((c) => /DELETE FROM portal_user_preferences/i.test(c.sql)), 'null → DELETE olmali');
});

// ── masker DB kurallari ───────────────────────────────────────────────────────
test('reloadMaskRules(): DB kurallari sirayla derlenir ve maskString onlari kullanir', async (t) => {
  t.mock.method(db, 'query', async () => ({
    rows: [
      { name: 'FOO', pattern: 'foo\\d+', flags: 'g', replacement: '[FOO]', sort_order: 1 },
      { name: 'BAR', pattern: 'bar', flags: 'gi', replacement: '[BAR]', sort_order: 2 },
    ],
  }));
  const masker = require('../../logx/masker.cjs');
  const n = await masker.reloadMaskRules();
  assert.equal(n, 2);
  const { masked, counts } = masker.maskString('foo123 ve BAR burada');
  assert.match(masked, /\[FOO\]/);
  assert.match(masked, /\[BAR\]/);
  assert.equal(counts.FOO, 1);
  assert.equal(counts.BAR, 1);
});

test('reloadMaskRules(): DB bos donerse sabit fallback set aktif kalir (TCKN maskeleme surer)', async (t) => {
  t.mock.method(db, 'query', async () => ({ rows: [] }));
  const masker = require('../../logx/masker.cjs');
  await masker.reloadMaskRules();
  const { masked } = masker.maskString('TCKN: 12345678901');
  assert.match(masked, /\[TCKN\]/, 'fallback kurallar calismali');
});

// ── duty-roster merge anahtari ────────────────────────────────────────────────
// Kurumsal AI kod incelemesi Finding 22: eskiden her cagri DELETE+INSERT (2 sorgu) yapiyordu;
// artik UPDATE-once → 0 satir etkilenirse INSERT deseni (bkz. server/auth/users.cjs).
test('duty-roster upsertItem(): kayit ZATEN VARSA tek UPDATE sorgusu yeterli, INSERT calismaz', async (t) => {
  const calls = [];
  t.mock.method(db, 'query', async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rows: [], rowCount: 1 }; // UPDATE 1 satiri etkiledi → kayit zaten var
  });
  const { _upsertItem: upsertItem } = require('../../duty-roster/index.cjs');
  await upsertItem({ id: 'x1', date: '2026-07-20', firstName: 'Ali', lastName: 'Veli', phone: '5551112233', email: 'Ali.Veli@Corp.com' });

  assert.equal(calls.length, 1, 'kayit zaten varsa tek sorgu (UPDATE) yeterli olmali');
  assert.match(calls[0].sql, /^UPDATE duty_roster SET/i);
  assert.match(calls[0].sql, /WHERE duty_date = \$4 AND LOWER\(email\) = LOWER\(\$5\)/i);
});

test('duty-roster upsertItem(): kayit YOKSA UPDATE (0 satir) + INSERT sirasiyla calisir', async (t) => {
  const calls = [];
  t.mock.method(db, 'query', async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/^UPDATE/i.test(sql.trim())) return { rows: [], rowCount: 0 }; // hicbir satir eslesmedi
    return { rows: [], rowCount: 1 };
  });
  const { _upsertItem: upsertItem } = require('../../duty-roster/index.cjs');
  await upsertItem({ id: 'x2', date: '2026-07-21', firstName: 'Ayse', lastName: 'Kaya', phone: '5559998877', email: 'ayse@corp.com' });

  assert.equal(calls.length, 2, 'yeni kayit icin UPDATE (0 satir) + INSERT gerekir');
  assert.match(calls[0].sql, /^UPDATE duty_roster SET/i);
  assert.match(calls[1].sql, /^INSERT INTO duty_roster/i);
  assert.equal(calls[1].params[0], 'x2', 'INSERT id parametresini korur');
});
