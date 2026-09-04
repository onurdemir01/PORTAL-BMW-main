// server/telnet/__tests__/result-contract.test.cjs — E1/E2: Telnet SONUC sozlesmesi.
//
// URETIMDEKI DURUM: playbook ACIK/KAPALI satirlarini yalnizca `debug` mesaji olarak
// uretiyordu; portal bunlari HIC okumuyordu (backend `artifacts`i eline alip ATIYORDU —
// repo genelinde "ACIK" aramasi yalnizca playbook'u buluyordu). Sonuc: TUM portlar
// KAPALI olsa bile AWX job'i `successful` dondugu icin ekranda YESIL TIK cikiyordu.
// Bu "sonuc yok"tan kotudur: aktif olarak YANLIS bilgi veriyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const PLAYBOOK = fs.readFileSync(
  path.join(__dirname, '..', '..', 'ansible', 'playbooks', 'ocp_telnet_control.yml'),
  'utf8',
);

// `extractTelnetResult` + `normalizeTelnetResult` saf fonksiyonlar — dosyadan cikarilip
// GERCEK davranislariyla test edilir (index.cjs'i require etmek express/DB yuklerdi).
function loadExtractor() {
  const a = SRC.indexOf('function extractTelnetResult(');
  const b = SRC.indexOf('// Sahiplik kapisi');
  assert.ok(a > 0 && b > a, 'extractTelnetResult bulunamadi');
  const body = SRC.slice(a, b);
  return new Function(`${body}; return extractTelnetResult;`)();
}
const extract = loadExtractor();

const SAMPLE = {
  overall_status: 'partial',
  target: { host: '10.10.1.101', port: '8080' },
  counts: { total: '3', open: '1', closed: '1', error: '1' },
  targets: [
    {
      cluster: 'gbocptest1',
      bastion: 'GBARKAP82',
      namespace: 'ns-a',
      ip: '10.10.1.101',
      port: '8080',
      state: 'open',
      rc: 0,
      detail: '',
    },
    {
      cluster: 'gbocptest2',
      bastion: 'GBARKAP82',
      namespace: 'ns-a',
      ip: '10.10.1.101',
      port: '8080',
      state: 'closed',
      rc: '1',
      detail: 'Connection refused',
    },
    {
      cluster: 'gbocptest3',
      bastion: 'GBARKAP83',
      namespace: 'ns-b',
      ip: '10.10.1.101',
      port: '8080',
      state: 'error',
      rc: '1',
      detail: 'pod not ready',
    },
  ],
};

test('E2: artifacts UC AWX seklinden de okunur', () => {
  // LogX'te uretimde her uc sekil de goruldu (bkz. jobs.cjs esnek anahtar cozumu).
  for (const shape of [
    { telnet_result: SAMPLE },
    { data: { telnet_result: SAMPLE } },
    { ansible_stats: { data: { telnet_result: SAMPLE } } },
  ]) {
    const r = extract(shape);
    assert.ok(r, `sekil okunamadi: ${Object.keys(shape)[0]}`);
    assert.equal(r.counts.total, 3);
  }
});

test('E2: JSON METIN olarak yayinlanan sonuc da cozulur', () => {
  const r = extract({ telnet_result: JSON.stringify(SAMPLE) });
  assert.ok(r);
  assert.equal(r.targets.length, 3);
});

test('E2: Jinja METIN olarak yayinlar — sayilar SAYIYA cevrilir', () => {
  // `set_stats` her seyi string olarak yayinlayabilir; ekran sayi bekliyor.
  const r = extract({ telnet_result: SAMPLE });
  assert.strictEqual(r.counts.open, 1);
  assert.strictEqual(r.counts.error, 1);
  assert.strictEqual(r.targets[1].rc, 1);
});

test('E2: bilinmeyen state UYDURULMAZ, error’a duser', () => {
  const r = extract({ telnet_result: { ...SAMPLE, targets: [{ cluster: 'c', state: 'belki' }] } });
  assert.equal(
    r.targets[0].state,
    'error',
    'bilinmeyen durum "open" sayilirsa kullanici yanlis bilgilenir',
  );
});

test('E2: gecersiz overall_status error’a duser', () => {
  assert.equal(
    extract({ telnet_result: { ...SAMPLE, overall_status: '   failed' } }).overallStatus,
    'error',
  );
});

test('E2: sonuc yoksa null doner (eski playbook hala AWX’teyken cokmez)', () => {
  assert.equal(extract({}), null);
  assert.equal(extract(null), null);
  assert.equal(extract({ telnet_result: 'gecersiz json' }), null);
});

test('E2: job-status ucu sonucu YANITA koyar', () => {
  assert.match(
    SRC,
    /result: extractTelnetResult\(statusInfo\.artifacts\)/,
    'artifacts yine eline alinip atiliyor — ekranda sonuc olmaz',
  );
});

// ── Playbook tarafi ─────────────────────────────────────────────────────────
test('E1: playbook telnet_result yayinliyor', () => {
  assert.match(PLAYBOOK, /ansible\.builtin\.set_stats:/);
  assert.match(PLAYBOOK, /telnet_result:/);
  for (const field of ['overall_status', 'targets', 'counts']) {
    assert.ok(PLAYBOOK.includes(`${field}:`), `sozlesmede eksik alan: ${field}`);
  }
});

test('E1: set_stats TEK bir toplayici play’de (aggregate ezmesi olmasin)', () => {
  // LogX'te dict uzerinde `aggregate: true` son gelen host'un oncekini EZDI ve bes
  // sunuculu bir kesifte yalniz bir sunucu gorundu. Ayni tuzaga dusmemeli.
  const occurrences = (PLAYBOOK.match(/set_stats:/g) || []).length;
  assert.equal(occurrences, 1, 'birden fazla set_stats yazari var — sonuclar birbirini ezer');
  assert.match(
    PLAYBOOK,
    /hosts: localhost[\s\S]*set_stats:/,
    'set_stats bastion play’inde — toplayici localhost play’inde olmali',
  );
});

test('F2: katlamali skalerde bosluk denetimi var (belgelenmis tuzak)', () => {
  // logx_ocp_namespace_discovery.yml notu: deger uretimde "      failed" olarak
  // yayinlanmisti. `{% set %}` kullanilan her yerde `{%- -%}` sart.
  // YORUM SATIRLARI HARIC: bu dosyadaki aciklamalar tuzagi ANLATMAK icin `{% set %}`
  // metnini iceriyor; tarama gercek Jinja ifadelerine bakmali.
  const code = PLAYBOOK.split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const setBlocks = code.match(/\{%-?\s*set [\s\S]{0,400}?%\}/g) || [];
  for (const b of setBlocks) {
    assert.match(b, /^\{%-/, `bosluk denetimsiz {% set %}: ${b.slice(0, 60)}`);
  }
});

test('F1: playbook COGUL namespaces bekliyor (portalin gonderdigi sekil)', () => {
  // Portal 2026-08-20'den beri `namespaces` DIZI gonderiyor; repo kopyasi hala tekil
  // `namespace` assert ediyordu. Dosya basligi "AWX'e kopyalanacak metin budur"
  // dedigi icin bu haliyle kopyalayan Telnet'i KIRARDI.
  assert.match(PLAYBOOK, /ns_list:/, 'namespace listesi kurulmuyor');
  assert.ok(
    !/- namespace is defined\n\s+- \(namespace \| string \| length\) > 0/.test(PLAYBOOK),
    'tekil namespace assert’i duruyor — coklu namespace ile job duser',
  );
});

test('F1: (cluster x namespace) capraz carpimi product() ile kuruluyor', () => {
  assert.match(PLAYBOOK, /ok_units \| product\(ns_list\) \| list/);
  assert.match(
    PLAYBOOK,
    /-n \{\{ item\.ns \| quote \}\}/,
    'oc komutlari hala tek namespace’e sabit',
  );
});

test('F1: temizlik TUM (cluster x namespace) ciftlerini kapsiyor', () => {
  // Aksi halde akis ortada duserse bazi namespace’lerde pod KALIRDI.
  assert.match(PLAYBOOK, /\(telnet_units \| default\(\[\]\)\) \| product\(ns_list\) \| list/);
});

test('guvenlik: no_log korunuyor, parola hala yalniz login gorevinde', () => {
  assert.match(PLAYBOOK, /no_log: true/);
  assert.match(
    PLAYBOOK,
    /lookup\('vars', item\.credential_key, default=''\)/,
    'parola vault degisken ADI uzerinden cozulmeli — asla extra_vars’ta tasinmaz',
  );
});

// ── B-01: Telnet vault soft-check BEKCISI ────────────────────────────────────
// LogX/ScaleX vault kontrolunu SERT yapar ("doomed job'i baslatma") ama Telnet
// YUMUSAK yapmalidir: uyari log'lar, job'u DURDURMAZ. Sebep: playbook'un
// inventory-fallback yolu var — portal DB'de eksik veri olsa bile statik
// inventory dosyasindan tamamlayabilir. Sert kontrol bu yolu kapatirdi.
test("B-01: vault on-kontrol YUMUSAK (try/catch + warn) — job'u DURDURMAZ", () => {
  const idx = SRC.indexOf('assertVaultKeysKnownOrThrow');
  assert.ok(idx > 0, 'assertVaultKeysKnownOrThrow cagrisi bulunamadi');
  // Cagri oncesi 200 karakter icinde `try {` olmali
  const before = SRC.slice(Math.max(0, idx - 200), idx);
  assert.match(
    before,
    /try\s*\{/,
    "vault cagrisi try/catch icinde DEGIL — sert kontrol job'u bloke eder",
  );
  // catch blogu `console.warn` icermeli (sessiz yutmamali, yeniden firlatmamali)
  const afterCatch = SRC.slice(idx, idx + 300);
  assert.match(afterCatch, /catch\s*\(e\)/, 'catch blogu bulunamadi');
  assert.match(
    afterCatch,
    /console\.warn/,
    "catch blogu uyari LOG'lamiyor — sessiz yutma veya yeniden firlatma",
  );
  assert.doesNotMatch(
    afterCatch,
    /throw\s+e/,
    'catch blogu YENIDEN FIRLATIYOR — yumusak kontrol anlamsizlasir',
  );
});

// ── B-01b: playbook inventory-fallback YUKLENMELI ────────────────────────────
// Portal DB'de api_url/credential_key NULL olabilir. Playbook statik inventory
// dosyasindan EKSIK ALANLARI tamamlar. Bu yukleme KALDIRILIRSA Telnet isleri
// sessizce basarisiz olur.
test('B-01b: playbook inventory-fallback dosyasi YUKLENMELI', () => {
  assert.match(
    PLAYBOOK,
    /openshift_inventory_vars\.yaml/,
    'inventory fallback dosyasi referansi kaybolmus',
  );
  assert.match(
    PLAYBOOK,
    /first_found.*errors=.ignore/,
    'fallback dosyasi YOKSA playbook CRASH etmemeli',
  );
  assert.match(
    PLAYBOOK,
    /clusters is defined/,
    'enrichment YALNIZCA clusters tanimliysa calismali',
  );
});
