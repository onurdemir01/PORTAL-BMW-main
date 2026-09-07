// src/__tests__/ansible-progress.test.cjs — "su an ne oluyor" UYDURULMAZ.
//
// `JobProgress` bu bilgiyi KRONOMETREDEN uretiyordu:
//   <10sn  -> "Sunuculara baglaniliyor…"
//   <30sn  -> (genel etiket)
//   >30sn  -> "Bu biraz uzun suruyor — buyuk bir sonuc kumesi olabilir…"
//
// Ucu de playbook'un gercekte ne yaptigina DEGIL, gecen sureye bakiyordu. Sonuncusu
// bir adim daha ileri gidip UYDURULMUS BIR TESHIS koyuyordu: 2026-09'daki LogX OCP
// arizasinda is BOS PAROLA yuzunden takiliyken kullaniciya "buyuk bir sonuc kumesi"
// deniyordu — ekran yanlis yeri isaret ediyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
function load(rel) {
  const out = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, require);
  return m.exports;
}
const P = load('utils/ansibleProgress.ts');

const STDOUT = [
  'PLAY [Validate input and add terminal hosts dynamically] ***',
  'TASK [Kimlik dosyasi bulundu mu] ***',
  'ok: [localhost]',
  'TASK [Login and list namespace pods in parallel] ***',
  'ok: [gbaocp01]',
].join('\n');

test('AP1 GERCEK adim ciktidan okunur (kronometreden degil)', () => {
  assert.equal(P.currentTaskName(STDOUT), 'Login and list namespace pods in parallel');
  // SONUNCUSU alinir: ilkini almak, is ilerledikce ekranin donmasi demekti.
  assert.notEqual(P.currentTaskName(STDOUT), 'Kimlik dosyasi bulundu mu');
});

test('AP2 adim SAYISI sayilir, tahmin edilmez', () => {
  assert.equal(P.taskCount(STDOUT), 2, 'TASK basliklari sayilmiyor');
  // `PLAY` bir gorev DEGIL — sayima girmemeli.
  assert.equal(P.taskCount('PLAY [x] ***'), 0);
});

test('AP3 cikti YOKKEN sebep hakkinda IDDIA EDILMEZ', () => {
  const t = P.progressText('running', '');
  assert.match(t, /Calisiyor|Çalışıyor/i, 'durum soylenmiyor');
  // UYDURULMUS TESHIS YASAK: veri buyuklugu, ag, yavaslik gibi sebepler
  // ciktiya bakmadan iddia edilemez.
  assert.doesNotMatch(
    t,
    /sonuç kümesi|sonuc kumesi|büyük|yavaş|uzun sürüyor/i,
    'sebep hakkinda uydurma iddia var',
  );
});

test('AP4 kuyruk durumu GERCEK veridir, korunur', () => {
  assert.match(P.progressText('pending', ''), /kuyru/i, 'AWX kuyruk durumu kayboldu');
});

test('AP5 cikti VARSA adim adi ve numarasi yazilir', () => {
  const t = P.progressText('running', STDOUT);
  assert.match(t, /Adım 2/, 'adim numarasi yazilmiyor');
  assert.match(t, /bağlanılıyor/i, 'gorev adi insan diline cevrilmiyor');
});

test('AP6 ESLESMEYEN gorev adi AYNEN gecer (ceviri uydurmaz)', () => {
  const raw = 'Some completely unmapped task name';
  assert.equal(P.humanizeTask(raw), raw);
});

test('AP7 ekran KRONOMETREYE dayali metin URETMIYOR', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'components', 'logx_v2', 'shared', 'JobProgress.tsx'),
    'utf8',
  );
  const code = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(code, /function phaseText\(/, 'kronometreye dayali metin geri gelmis');
  assert.doesNotMatch(code, /function pseudoProgress\(/, 'sahte ilerleme yuzdesi geri gelmis');
  assert.doesNotMatch(code, /elapsedSec < \d+/, 'gecen sureye gore icerik uretiliyor');
  assert.match(code, /progressText\(status, output\)/, 'gercek adim kaynagi kullanilmiyor');
});
