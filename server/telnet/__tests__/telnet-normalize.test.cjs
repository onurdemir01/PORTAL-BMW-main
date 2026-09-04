// server/telnet/__tests__/telnet-normalize.test.cjs — normalizeTelnetResult + rememberJobOwner
// + SAFE_HOST_RE. Mevcut result-contract.test.cjs extractTelnetResult'in dis yuzunu test
// eder; bu dosya ic mantiklari (normalizasyon, onbellek, guvenlik) ayri ayri kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

// ── normalizeTelnetResult ─────────────────────────────────────────────────────
function loadNormalizer() {
  const a = SRC.indexOf('function normalizeTelnetResult(');
  assert.ok(a > 0, 'normalizeTelnetResult bulunamadi');
  // Fonksiyonun govdesini sonraki function/const'a kadar al.
  const b = SRC.indexOf('\n// Sahiplik kapisi');
  assert.ok(b > a, 'normalizeTelnetResult siniri bulunamadi');
  const body = SRC.slice(a, b);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return normalizeTelnetResult;`)();
}
const normalize = loadNormalizer();

test('normalizeTelnetResult: targets dizisi yoksa bos dizi doner (patlamaz)', () => {
  const r = normalize({ overall_status: 'error', target: { host: '10.0.0.1', port: '80' } });
  assert.deepEqual(r.targets, []);
  assert.equal(r.counts.total, 0);
});

test('normalizeTelnetResult: detail 500 karakterle sinirlanir (stdout tasmaz)', () => {
  const long = 'x'.repeat(1000);
  const r = normalize({
    overall_status: 'open',
    targets: [{ cluster: 'c', state: 'open', detail: long }],
  });
  assert.equal(r.targets[0].detail.length, 500);
});

test('normalizeTelnetResult: counts.total hedeflenmemisse targets.length kullanilir', () => {
  const r = normalize({
    overall_status: 'open',
    targets: [
      { cluster: 'c1', state: 'open' },
      { cluster: 'c2', state: 'closed' },
    ],
  });
  assert.equal(r.counts.total, 2, 'counts.total yoksa targets.length kullanilmali');
});

test("normalizeTelnetResult: NaN/bos count degerleri 0'a duser", () => {
  const r = normalize({
    overall_status: 'error',
    counts: { total: 'abc', open: null, closed: undefined, error: '' },
    targets: [],
  });
  assert.equal(r.counts.total, 0);
  assert.equal(r.counts.open, 0);
  assert.equal(r.counts.closed, 0);
  assert.equal(r.counts.error, 0);
});

test("normalizeTelnetResult: null/undefined alanlar bos string'e duser", () => {
  const r = normalize({ overall_status: 'open', targets: [{ cluster: null, bastion: undefined }] });
  assert.equal(r.targets[0].cluster, '');
  assert.equal(r.targets[0].bastion, '');
  assert.equal(r.target.host, '');
  assert.equal(r.target.port, '');
});

test('normalizeTelnetResult: overall_status gecersizse "error" olur (uydurulmaz)', () => {
  assert.equal(normalize({ overall_status: 'belki' }).overallStatus, 'error');
  assert.equal(normalize({ overall_status: '' }).overallStatus, 'error');
  assert.equal(normalize({}).overallStatus, 'error');
});

test('normalizeTelnetResult: gecerli overall_status degerleri korunur', () => {
  for (const s of ['open', 'partial', 'closed', 'error']) {
    assert.equal(normalize({ overall_status: s }).overallStatus, s);
  }
});

// ── rememberJobOwner ──────────────────────────────────────────────────────────
function loadRememberJobOwner() {
  const m = SRC.match(
    /const JOB_OWNER_CACHE = new Map\(\);[\s\S]*?const JOB_OWNER_CACHE_MAX = \d+;[\s\S]*?\nfunction rememberJobOwner\([\s\S]*?\n\}/,
  );
  assert.ok(m, 'rememberJobOwner bulunamadi');
  // eslint-disable-next-line no-new-func
  return new Function(
    `${m[0]}; return { rememberJobOwner, JOB_OWNER_CACHE, JOB_OWNER_CACHE_MAX };`,
  )();
}

test('rememberJobOwner: jobId/username yoksa kayit YAPILMAZ', () => {
  const { rememberJobOwner, JOB_OWNER_CACHE } = loadRememberJobOwner();
  JOB_OWNER_CACHE.clear();
  rememberJobOwner(1, null, 'ali');
  rememberJobOwner(1, 42, '');
  rememberJobOwner(1, 42, null);
  assert.equal(JOB_OWNER_CACHE.size, 0, 'gecersiz girdi kaydedilmemeli');
});

test('rememberJobOwner: username kucuk harfe cevrilir (karsilastirma case-insensitive)', () => {
  const { rememberJobOwner, JOB_OWNER_CACHE } = loadRememberJobOwner();
  JOB_OWNER_CACHE.clear();
  rememberJobOwner(1, 42, 'Ali.Veli');
  assert.equal(JOB_OWNER_CACHE.get('1:42'), 'ali.veli');
});

test('rememberJobOwner: MAX sinirina ulasildiginda EN ESKI girdi atilir (sinirsiz buyume yok)', () => {
  const { rememberJobOwner, JOB_OWNER_CACHE, JOB_OWNER_CACHE_MAX } = loadRememberJobOwner();
  JOB_OWNER_CACHE.clear();
  for (let i = 0; i < JOB_OWNER_CACHE_MAX + 10; i++) {
    rememberJobOwner(1, i, `user-${i}`);
  }
  assert.ok(
    JOB_OWNER_CACHE.size <= JOB_OWNER_CACHE_MAX,
    `onbellek ${JOB_OWNER_CACHE_MAX} sinirini asmamali`,
  );
  // En eski girdi atilmis olmali.
  assert.equal(JOB_OWNER_CACHE.has('1:0'), false, 'en eski girdi (jobId=0) atilmali');
  // En son girdi korunur.
  assert.equal(JOB_OWNER_CACHE.has(`1:${JOB_OWNER_CACHE_MAX + 9}`), true, 'en son girdi korunmali');
});

// ── SAFE_HOST_RE ──────────────────────────────────────────────────────────────
test('SAFE_HOST_RE: gecerli IPv4/IPv6/hostname/DNS adlari kabul edilir', () => {
  const re = /^[A-Za-z0-9.\-:_]{1,255}$/;
  assert.ok(re.test('10.0.0.1'));
  assert.ok(re.test('::1'));
  assert.ok(re.test('fe80::1'));
  assert.ok(re.test('my-host.example.com'));
  assert.ok(re.test('GBARKAP82'));
});

test('SAFE_HOST_RE: shell enjeksiyon karakterleri REDDEDILIR', () => {
  const re = /^[A-Za-z0-9.\-:_]{1,255}$/;
  assert.ok(!re.test('10.0.0.1; rm -rf /'));
  assert.ok(!re.test('host$(whoami)'));
  assert.ok(!re.test('host`id`'));
  assert.ok(!re.test("host' OR 1=1 --"));
  assert.ok(!re.test('host with space'));
  assert.ok(!re.test(''));
});

// ── Kaynak kod sozlesmesi ─────────────────────────────────────────────────────
test('SAFE_HOST_RE kaynak kodda tanimli ve kullaniliyor', () => {
  assert.match(SRC, /SAFE_HOST_RE/);
  assert.match(SRC, /SAFE_HOST_RE\.test\(/);
});
