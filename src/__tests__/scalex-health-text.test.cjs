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
const { humanizeRunLog } = load('utils/scalexLog.ts');

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


// ── L. ISLEM GUNLUGU (rows[]) ───────────────────────────────────────────────
//
// `rows` uzun suredir sonuca dahildi ve `result_json`a yaziliyordu ama EKRANDA HIC
// gosterilmiyordu: kullanici "ne oldu?" sorusunun cevabini ancak AWX job log'unun
// 360 satirini acarak bulabiliyordu. Asagidaki satirlar GERCEK bir uretim
// calistirmasindan (AWX job #3280511) alinmistir.

const REAL_ROWS = [
  'GLOBAL;-;odeme-api;-;INPUT;INFO;NS=odeme ACTION=restore TARGET=auto-from-state',
  'c1;j1;-;-;WORKDIR;INFO;Selected writable workdir=/sw/openshift/chaos-scale-job',
  'c1;j1;-;-;CLIENT;OK;oc_path=/usr/local/bin/oc Client Version: 4.7.4',
  'c1;j1;-;-;LOGIN;OK;Login success',
  'c1;j1;-;-;NAMESPACE;OK;Using project odeme',
  'c1;j1;-;-;RBAC;OK;HPA read permission available HPA will remain untouched',
  'c1;j1;odeme-api;DeploymentConfig;DISCOVERY;OK;Detected resource=dc current_spec_replicas=0',
  'c1;j1;odeme-api;DeploymentConfig;OBJECT;INFO;odeme-api 27 0 0 ',
  'c1;j1;odeme-api;DeploymentConfig;HPA;INFO;No HPA found for application/scaleTargetRef',
  'c1;j1;odeme-api;DeploymentConfig;STATE;OK;Restore target from state: previous_replicas=1 cm=scalex-state-odeme-api version=2',
  'c1;j1;odeme-api;DeploymentConfig;GERI_AL;OK;Patch accepted replicas=1. HPA was not changed.',
  'c1;j1;odeme-api;DeploymentConfig;VERIFY;OK;desired=1 current=1 ready=0 target=1',
  'c1;j1;odeme-api;DeploymentConfig;READINESS;INFO;Replica change succeeded pod readiness is still converging ready=0 target=1',
];

test('L1 altyapi gurultusu ELENIYOR, olaylar kaliyor', () => {
  const out = humanizeRunLog(REAL_ROWS);
  const steps = out.map((e) => e.step);
  // "Hangi dizine yazdim" ve ham `oc get` ciktisi kullaniciya bir sey soylemez ve
  // asil olaylari gorunmez kilar. Ham hallerı AWX log'unda duruyor.
  for (const gizli of ['Çalışma dizini', 'oc istemcisi', 'Nesne', 'Girdi']) {
    assert.ok(!steps.includes(gizli), `${gizli} elenmemis`);
  }
  assert.ok(steps.includes('Geri alma'), 'asil olay elenmis');
  assert.ok(steps.includes('Doğrulama'));
});

test('L2 EN DEGERLI satir okunur: replica geldi ama pod hazir degil', () => {
  // Playbook yalnizca `spec.replicas` esitligine bakiyor ve bu durumu BASARILI
  // sayiyor. Kullanicinin gormesi gereken tek satir bu olabilir.
  const e = humanizeRunLog(REAL_ROWS).find((x) => x.step === 'Hazırlık');
  assert.ok(e, 'hazirlik satiri kaybolmus');
  assert.match(e.text, /pod'lar henüz hazır değil \(hazır 0\/1\)/);
});

test('L3 olgular cumleye giriyor (uydurma yok)', () => {
  const out = humanizeRunLog(REAL_ROWS);
  assert.match(out.find((e) => e.step === 'Tespit').text, /şu anki replica: 0/);
  assert.match(out.find((e) => e.step === 'Durum kaydı').text, /önceki replica: 1/);
  assert.match(out.find((e) => e.step === 'Doğrulama').text, /replica 1 oldu/);
  // "HPA yok" ile "HPA var" ayirt edilmeli — ekran bu konuda bir kez yalan soyledi.
  assert.equal(out.find((e) => e.step === 'HPA').text, 'HPA yok.');
  assert.equal(
    humanizeRunLog(['c;j;a;k;HPA;INFO;HPA_PRESENT read-only policy left untouched'])[0].text,
    'HPA var; üzerinde değişiklik yapılmadı.');
});

test('L4 HAM metin kaybolmuyor', () => {
  // Cevirinin eksik kaldigi yerde teknik ayrinti hala elde olmali.
  const e = humanizeRunLog(REAL_ROWS).find((x) => x.step === 'Doğrulama');
  assert.match(e.raw, /desired=1 current=1 ready=0 target=1/);
});

test('L5 BILINMEYEN adim sessizce ATILMAZ', () => {
  const out = humanizeRunLog(['c;j;a;k;YEPYENI_ADIM;WARN;bir sey oldu']);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'bir sey oldu', 'taninmayan adim kayboldu — kullanici yine AWX log\'una gider');
  assert.equal(out[0].tone, 'warn');
});

test('L6 bozuk satir ve bos girdi patlamaz', () => {
  assert.deepEqual(humanizeRunLog(null), []);
  assert.deepEqual(humanizeRunLog(['eksik;alan']), []);
  // `detail` icinde `;` olabilir — son alan BIRLESTIRILMELI.
  const out = humanizeRunLog(['c;j;a;k;RUNNER;FAIL;a; b; c']);
  assert.equal(out[0].raw, 'a; b; c');
});

test('L7 durum → ton eslemesi', () => {
  const rows = ['c;j;a;k;PRECHECK;OK;x', 'c;j;a;k;PRECHECK;WARN;x', 'c;j;a;k;PRECHECK;FAIL;x', 'c;j;a;k;PRECHECK;INFO;x'];
  assert.deepEqual(humanizeRunLog(rows).map((e) => e.tone), ['ok', 'warn', 'fail', 'info']);
});
