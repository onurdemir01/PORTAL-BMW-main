// server/telnet/__tests__/pod-hazir-degil-kapali-degil.test.cjs
//
// "PORT KAPALI" ile "TEST YAPILAMADI" AYNI SEY DEGIL.
//
// URETIMDE NE OLDU (job 3291766, gbocptest4): test pod'u ayaga kalkmadi, `oc exec`
//     error: unable to upgrade connection: container not found ("telnet-test-3291766")
// dondu ve ekran bunu KAPALI diye gosterdi. Kullanici "port kapali" sanip guvenlik/ag
// ekibine gidiyordu; oysa sorun testin KENDISINDEYDI.
//
// KOK NEDEN: `create`/`wait` gorevlerinin ikisi de `failed_when: false` oldugu icin
// `oc exec` pod hic ayaga kalkmasa bile calisiyordu. Sonuc eslemesi `state`i yalnizca
// `item.skipped` iken `error` yapiyordu — ama gorev SKIP degil FAIL oluyordu, yani o
// dal HIC calismiyordu. Playbook'un yorumu "pod acilamadiysa sonuc error'dur" diyordu;
// KOD BUNU YAPMIYORDU. (Bu depoda tekrar eden sinif: vaadedilen ama hic atesnlenmeyen kapi.)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Yorumlari at: bekci kendi ACIKLAMASIYLA eslesmemeli.
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const PLAYBOOK = codeOnly(
  fs.readFileSync(
    path.join(__dirname, '..', '..', 'ansible', 'playbooks', 'ocp_telnet_control.yml'),
    'utf8',
  ),
);
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
// Bicim degil KURAL olculur (prettier bu depoda tek seferde 14 bekci kirdi).
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

// `explainTelnetRow` saf fonksiyon — dosyadan cikarilip GERCEK davranisiyla test edilir
// (index.cjs'i require etmek express/DB yuklerdi; kardes bekcilerle ayni desen).
function loadExplainer() {
  const a = SRC.indexOf('const RC_HINTS');
  const b = SRC.indexOf('\n// Sahiplik kapisi');
  assert.ok(a > 0 && b > a, 'explainTelnetRow siniri bulunamadi');
  // eslint-disable-next-line no-new-func
  return new Function(`${SRC.slice(a, b)}; return explainTelnetRow;`)();
}
const explain = loadExplainer();

// ── PLAYBOOK: pod hazir degilse telnet HIC denenmez ─────────────────────────

test('T1 telnet gorevi `wait` sonucuna BAGLI (pod hazir degilse calismaz)', () => {
  const n = norm(PLAYBOOK);
  assert.match(
    n,
    /when: \(wait_results\.results\[wu_idx\]\.rc \| default\(1\) \| int\) == 0/,
    'telnet gorevi pod hazirligina bakmadan calisiyor — "container not found" KAPALI olarak raporlanir',
  );
  assert.match(n, /index_var: wu_idx/, 'birim indisi yok — wait sonucu ile eslestirilemez');
});

test('T2 sonuc eslemesi create/wait sonuclarini GERCEKTEN okuyor', () => {
  // Eskiden `create_results`/`wait_results` register EDILIYOR ama HIC OKUNMUYORDU.
  const n = norm(PLAYBOOK);
  assert.match(
    n,
    /_create_rc: "\{\{ create_results\.results\[res_idx\]\.rc/,
    'create sonucu okunmuyor',
  );
  assert.match(n, /_wait_rc: "\{\{ wait_results\.results\[res_idx\]\.rc/, 'wait sonucu okunmuyor');
  assert.match(n, /index_var: res_idx/, 'sonuc indisi yok');
});

test('T3 `state` uc yoldan `error` olabiliyor — yalnizca `skipped` degil', () => {
  const n = norm(PLAYBOOK);
  // Karar satiri: skipped VEYA pod kayip -> error.
  assert.match(
    n,
    /"state": \("error" if \(_skipped or \(_pod_missing \| bool\)\)/,
    'pod kaybolma durumu hala KAPALI olarak siniflaniyor',
  );
  assert.match(
    n,
    /_pod_missing:[\s\S]{0,160}unable to upgrade connection/,
    '"unable to upgrade connection" hala bir port sonucu sayiliyor',
  );
});

test('T4 pod adi cakismasi: `tower_job_id` yokken SABIT ad kullanilmiyor', () => {
  // Sabit `local` iken es zamanli iki calistirma ayni pod adini paylasiyor; birinin
  // temizligi digerinin `oc exec`ini SIGTERM'liyor ve rc=143 (sahte KAPALI) uretiyordu.
  const n = norm(PLAYBOOK);
  assert.ok(
    !/job_tag: "\{\{ tower_job_id \| default\("local"\) \}\}"/.test(n),
    'job_tag hala sabit "local"a dusuyor — es zamanli calistirmalar birbirinin pod`unu siler',
  );
  assert.match(
    n,
    /job_tag:[\s\S]{0,200}random/,
    'tanimsizlikta calistirmaya ozgu deger uretilmiyor',
  );
  // `set_fact` ile BIR KEZ hesaplanmali: `vars:` her referansta yeniden degerlendirilir
  // ve pod BIR adla olusturulup BASKA adla silinmeye calisilirdi.
  const i = PLAYBOOK.indexOf('Resolve a collision-free job tag');
  assert.ok(i > 0, 'job tag gorevi yok');
  assert.match(PLAYBOOK.slice(i, i + 400), /set_fact:/, 'job_tag set_fact ile sabitlenmemis');
});

// ── PORTAL: ham rc insan diline cevriliyor ──────────────────────────────────

test('T5 rc=143 zaman asimi olarak aciklanir (busybox timeout)', () => {
  // netshoot Alpine tabanli; busybox `timeout` zaman asiminda 124 DEGIL 128+SIGTERM=143
  // dondurur. Yani 143 dogru bir KAPALI sonucudur, yalnizca okunaksizdi.
  const hint = explain({
    state: 'closed',
    rc: 143,
    detail: 'command terminated with exit code 143',
  });
  assert.match(hint, /zaman asimi/i);
  assert.equal(explain({ state: 'closed', rc: 124, detail: '' }), hint);
});

test('T6 "container not found" bir PORT sonucu gibi aciklanmaz', () => {
  const hint = explain({
    state: 'error',
    rc: 1,
    detail: 'error: unable to upgrade connection: container not found ("telnet-test-3291766")',
  });
  assert.match(hint, /pod/i, 'pod sorunu oldugu soylenmiyor');
  assert.ok(
    !/port kapali/i.test(hint),
    'test yapilamadi durumu hala "port kapali" gibi aciklaniyor',
  );
});

test('T7 basarili baglantida aciklama YOK (gurultu uretme)', () => {
  assert.equal(explain({ state: 'open', rc: 0, detail: 'Connected to 10.0.0.1' }), '');
});

test('T8 normalize her satira `hint` ekliyor (karar noktasi)', () => {
  const n = norm(SRC);
  assert.match(
    n,
    /hint: explainTelnetRow\(\{ state, rc, detail \}\)/,
    'normalizeTelnetResult satirlara aciklama eklemiyor — ekran ham rc gostermeye devam eder',
  );
});

test('T9 ekran ONCE aciklamayi gosteriyor, ham rc ikinci planda', () => {
  const ui = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      '..',
      'src',
      'components',
      'telnet',
      'steps',
      'TelnetResultPanel.tsx',
    ),
    'utf8',
  );
  const n = norm(ui);
  assert.match(n, /\{t\.hint && \(/, 'aciklama render EDILMIYOR (tip tanimi yetmez)');
  assert.match(
    n,
    /t\.state !== "open" && \(t\.hint \|\| t\.detail\)/,
    'kosul aciklamayi hesaba katmiyor',
  );
});
