// src/__tests__/scalex-health-text.test.cjs — sağlık satırlarının çevirisi.
//
// İşlem sonrası sağlık bloğu ekranda ham playbook çıktısını basıyordu:
//   "merchant-info-business-v0-27-qkjbw 0/1 ContainerCreating 0 22s"
//   "Missing list events permission"
// İkincisi üstelik WARN seviyesindeydi, yani bir YETKİ YOKLUĞU ekranda kehribar
// renkte, hata gibi duruyordu. Kullanıcı ne olduğunu da, ne isteyeceğini de
// öğrenemiyordu.
//
// Bu testler ÇEVİRİCİYİ GERÇEKTEN ÇALIŞTIRIR (kaynak metnine bakmaz).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Gercek kaynagi derleyip CALISTIRIR — kopyasini degil (datetime.test.cjs deseni).
function load(rel) {
  const out = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, require);
  return m.exports;
}

const { humanizeHealth } = load('utils/scalexHealth.ts');

const row = (over) => ({ app: 'odeme-api', cluster: 'c1', step: 'PODS', status: 'OK', detail: '', ...over });

// ── H1 Yetki yokluğu ────────────────────────────────────────────────────────

test('H1 yetki yoklugu HATA degil BILGI, ve ne istenecegini SOYLER', () => {
  const out = humanizeHealth([
    row({ step: 'EVENTS', status: 'INFO', detail: 'permission_missing=yes verb=list resource=events' }),
  ], 'odeme-prod');

  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].tone, 'info', 'yetki yoklugu uyari tonunda gosteriliyor');
  assert.match(out.lines[0].text, /okunamadı/);
  // ASIL DEGER: kullanici platformdan NE isteyecegini bilmeli.
  assert.equal(out.asks.length, 1);
  assert.match(out.asks[0], /list events/, 'istenecek yetki adiyla yazilmamis');
  assert.match(out.asks[0], /odeme-prod/, 'hangi namespace icin oldugu yazilmamis');
});

test('H2 blok YALNIZCA yetki uyarilarindan ibaretse ACILMAZ', () => {
  // Iki satir "okuyamadim" gostermek ekrani doldurup hicbir sey soylememek olurdu.
  const out = humanizeHealth([
    row({ step: 'PODS', status: 'INFO', detail: 'permission_missing=yes verb=list resource=pods' }),
    row({ step: 'EVENTS', status: 'INFO', detail: 'permission_missing=yes verb=list resource=events' }),
  ]);
  assert.equal(out.hasContent, false, 'yalnizca yetki satirlari varken blok acilmamali');
  assert.equal(out.asks.length, 2, 'istenecek yetkiler yine de bildirilmeli');
});

test('H3 ayni yetki iki kez gelirse istek TEKRARLANMAZ', () => {
  const out = humanizeHealth([
    row({ app: 'a', step: 'EVENTS', status: 'INFO', detail: 'permission_missing=yes verb=list resource=events' }),
    row({ app: 'b', step: 'EVENTS', status: 'INFO', detail: 'permission_missing=yes verb=list resource=events' }),
  ], 'ns');
  assert.equal(out.asks.length, 1);
});

// ── H4 Pod durumu ───────────────────────────────────────────────────────────

test('H4 HAZIR pod sakin, HAZIR OLMAYAN pod uyari tonunda', () => {
  const out = humanizeHealth([
    row({ detail: 'pod=api-1 ready=1/1 status=Running restarts=0 age=7d' }),
    row({ detail: 'pod=api-2 ready=0/1 status=ContainerCreating restarts=0 age=22s' }),
  ]);
  assert.equal(out.lines[0].tone, 'ok');
  assert.match(out.lines[0].text, /api-1 · hazır 1\/1 · Running/);
  // "replica geldi ama uygulama ayaga kalkmadi" durumu playbook'un basari
  // olcutunden KACIYOR — ekran bunu gormeli.
  assert.equal(out.lines[1].tone, 'warn', 'hazir olmayan pod sakin tonda gosteriliyor');
  assert.match(out.lines[1].text, /hazır 0\/1 · ContainerCreating/);
  assert.equal(out.hasContent, true);
});

test('H5 yeniden baslatma sayisi GORUNUR ve tonu uyariya cevirir', () => {
  const out = humanizeHealth([row({ detail: 'pod=api-1 ready=1/1 status=Running restarts=7 age=1h' })]);
  assert.equal(out.lines[0].tone, 'warn', 'surekli yeniden baslayan pod sakin gosteriliyor');
  assert.match(out.lines[0].text, /7 yeniden başlatma/);
});

test('H6 `ready=0/0` TAM sayilmaz', () => {
  // 0/0 "hazir" degil, "hic pod yok" demek. Esitlik kontrolu tek basina yanilirdi.
  const out = humanizeHealth([row({ detail: 'pod=api-1 ready=0/0 status=Pending restarts=0 age=5s' })]);
  assert.equal(out.lines[0].tone, 'warn');
});

test('H7 hic pod yoksa ACIKCA soylenir', () => {
  const out = humanizeHealth([row({ detail: 'pods=0' })]);
  assert.equal(out.lines[0].tone, 'warn');
  assert.match(out.lines[0].text, /Hiç pod görünmüyor/);
});

// ── H8 Olaylar ──────────────────────────────────────────────────────────────

test('H8 uyari olayi sebebiyle birlikte gosterilir, olay yoksa sakin', () => {
  const out = humanizeHealth([
    row({ step: 'EVENTS', status: 'WARN', detail: 'reason=BackOff object=pod/api-1 age=30s' }),
    row({ app: 'b', step: 'EVENTS', status: 'OK', detail: 'events=0' }),
  ]);
  assert.equal(out.lines[0].tone, 'warn');
  assert.match(out.lines[0].text, /BackOff \(pod\/api-1\)/);
  assert.equal(out.lines[1].tone, 'ok');
  assert.match(out.lines[1].text, /Uyarı olayı yok/);
});

// ── H9 Eski biçim ───────────────────────────────────────────────────────────

test('H9 ESKI bicim (ham satir) sessizce ATILMAZ', () => {
  // Playbook AWX'e ELLE kopyalaniyor: portal guncellendiginde eski surum bir sure
  // calismaya devam eder. Ayristirilamayan satiri atmak, sağlık blogunu BOS
  // birakirdi — kullanici hicbir sey goremezdi.
  const out = humanizeHealth([
    row({ detail: 'merchant-info-27-qkjbw 0/1 ContainerCreating 0 22s' }),
    row({ step: 'EVENTS', status: 'WARN', detail: 'Missing list events permission' }),
  ]);
  assert.equal(out.lines.length, 2);
  assert.match(out.lines[0].text, /merchant-info-27-qkjbw/);
  assert.match(out.lines[1].text, /Missing list events permission/);
  assert.equal(out.hasContent, true, 'eski bicimde blok acilmali');
});

test('H10 bos girdi patlamaz', () => {
  for (const v of [null, undefined, []]) {
    const out = humanizeHealth(v);
    assert.deepEqual([out.lines.length, out.asks.length, out.hasContent], [0, 0, false]);
  }
});
