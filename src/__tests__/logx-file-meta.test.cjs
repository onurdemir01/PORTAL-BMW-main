// src/__tests__/logx-file-meta.test.cjs — D1/D3: mtime normalize ve secim siniri.
//
// `logFileMeta.ts` TypeScript; testler CJS. Kaynak ts->js olarak DERLENMEDEN, saf
// fonksiyonlar dosyadan cikarilip calistirilir (tip anotasyonlari soyulur). Boylece
// test, kodun GERCEK davranisini olcer — kopyasini degil.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'logx_v2', 'shared', 'logFileMeta.ts'), 'utf8'
);

// TypeScript derleyicisiyle (repo bagimliligi) CommonJS'e cevrilir. Elle regex ile
// tip soymak kirilgandi; burada GERCEK kaynak derlenip calistirilir.
function loadModule() {
  const ts = require('typescript');
  const out = ts.transpileModule(SRC, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  // `Blob` tarayici API'si; Node'da ayni baytlari Buffer ile olculur.
  const shim = out.replace(
    'new Blob([JSON.stringify(selected)]).size',
    "Buffer.byteLength(JSON.stringify(selected), 'utf8')"
  );
  new Function('module', 'exports', 'require', 'Buffer', shim)(m, m.exports, require, Buffer);
  return m.exports;
}

const L = loadModule();

// ── D1: mtime normalize ─────────────────────────────────────────────────────
test('D1: saniye epoch (ansible find’in GERCEK ciktisi) dogru cozulur', () => {
  const sec = 1756300000;                       // 2025-08-27 civari
  assert.equal(L.normalizeMtime(sec), sec * 1000);
});

test('D1: milisaniye epoch saniye sanilmaz', () => {
  const ms = 1756300000000;
  assert.equal(L.normalizeMtime(ms), ms, 'ms deger 1000 ile carpilirsa tarih 5138 yilina firlar');
});

test('D1: ISO metin kabul edilir (tip tanimindaki eski varsayim)', () => {
  assert.equal(L.normalizeMtime('2026-08-27T10:00:00Z'), Date.parse('2026-08-27T10:00:00Z'));
});

test('D1: sayi-metin epoch olarak yorumlanir, ISO olarak DEGIL', () => {
  assert.equal(L.normalizeMtime('1756300000'), 1756300000 * 1000);
});

test('D1: mtime yoksa DOSYA ADINDAKI tarihe dusulur', () => {
  // Uretimde gercekten gorulen kaliplar.
  assert.equal(L.normalizeMtime(undefined, '/logs/app-2026-08-27.log'), Date.UTC(2026, 7, 27));
  assert.equal(L.normalizeMtime(null, '/logs/server.log.20260827'), Date.UTC(2026, 7, 27));
  assert.equal(L.normalizeMtime('', '/logs/SystemOut_25.08.27.log'), Date.UTC(2025, 7, 27));
  assert.equal(L.normalizeMtime(undefined, '/logs/audit_2026_08_27_14.log'), Date.UTC(2026, 7, 27));
});

test('D1: hicbir ipucu yoksa null (uydurma tarih URETILMEZ)', () => {
  assert.equal(L.normalizeMtime(undefined, '/logs/server.log'), null);
  assert.equal(L.normalizeMtime('gecersiz', '/logs/server.log'), null);
  assert.equal(L.normalizeMtime(0, '/logs/server.log'), null, 'epoch 0 gecerli bir log tarihi degil');
});

test('D1: gecersiz ay/gun kabul edilmez', () => {
  assert.equal(L.parseDateFromFilename('/logs/app-2026-13-45.log'), null);
});

test('D1: goreli zaman metni', () => {
  const now = Date.now();
  assert.equal(L.relativeTime(now - 30 * 1000), 'az önce');
  assert.equal(L.relativeTime(now - 5 * 60000), '5 dk önce');
  assert.equal(L.relativeTime(now - 2 * 3600000), '2 saat önce');
  assert.equal(L.relativeTime(now - 3 * 86400000), '3 gün önce');
  assert.equal(L.relativeTime(null), '');
});

// ── Log tipi ────────────────────────────────────────────────────────────────
test('log tipi dosya adindan cikarilir', () => {
  assert.equal(L.logKind('/logs/SystemErr.log'), 'error');
  assert.equal(L.logKind('/logs/access_log'), 'access');
  assert.equal(L.logKind('/logs/gc.log'), 'gc');
  assert.equal(L.logKind('/logs/SystemOut.log'), 'output');
  assert.equal(L.logKind('/logs/server.log.gz'), 'archive');
  assert.equal(L.logKind('/logs/veri.txt'), 'other');
});

// ── D3: secim siniri ────────────────────────────────────────────────────────
test('D3: sinir express.json 2MB limitinden TURETILIR (uydurma sayi degil)', () => {
  assert.equal(L.SELECTION_MAX_BYTES, Math.floor(2 * 1024 * 1024 / 2));
});

test('D3: olcum GERCEK govde uzerinden yapilir, dosya SAYISI uzerinden degil', () => {
  // Ayni sayida ama COK daha uzun yollu secim, daha buyuk govde uretmeli — sinirin
  // "dosya sayisi" olarak ifade edilememesinin sebebi tam olarak bu.
  const kisa = Array.from({ length: 100 }, (_, i) => ({ host: 'H1', path: `/l/${i}.log` }));
  const uzun = Array.from({ length: 100 }, (_, i) => ({ host: 'H1', path: `/vhosting/cok/derin/bir/dizin/yapisi/altinda/uygulama/logs/${i}.log` }));
  assert.ok(L.selectionPayloadBytes(uzun) > L.selectionPayloadBytes(kisa) * 2);
});

test('D3: kademeli basinc — sessizce sinira dayanilmaz', () => {
  assert.equal(L.selectionPressure(0), 'ok');
  assert.equal(L.selectionPressure(L.SELECTION_MAX_BYTES * 0.5), 'ok');
  assert.equal(L.selectionPressure(L.SELECTION_MAX_BYTES * 0.7), 'warn');
  assert.equal(L.selectionPressure(L.SELECTION_MAX_BYTES * 0.95), 'danger');
  assert.equal(L.selectionPressure(L.SELECTION_MAX_BYTES + 1), 'over');
});

test('D3: sunucu AYNI turetmeyi kullanir (iki taraf ayrisamaz)', () => {
  const legacy = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'logx', 'v2', 'legacy.cjs'), 'utf8'
  );
  assert.match(legacy, /const EXPRESS_JSON_LIMIT_BYTES = 2 \* 1024 \* 1024;/);
  assert.match(legacy, /const TRANSFER_SELECTION_MAX_BYTES = Math\.floor\(EXPRESS_JSON_LIMIT_BYTES \/ 2\);/);
  assert.match(legacy, /code: 'selection_too_large'/);
});
