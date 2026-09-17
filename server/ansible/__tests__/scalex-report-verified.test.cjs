// server/ansible/__tests__/scalex-report-verified.test.cjs
// HEDEF SATIRINDAKI `verified` ALANI — "uygulandi mi" sorusu, "OK mi" sorusundan AYRI.
//
// URETIM TESPITI (2026-09-17, AWX is #3326330). Geri alma isi WARN dondu, portal
// "geri alinamadi" yazdi, uygulama ise AYAKTAYDI (replicas 1, readyReplicas 1, pod
// Running) ve betik ayni iste `STATE;OK;Deleted restore state ConfigMap` basmisti.
// Iki taraf ZIT karar verdi.
//
// ZINCIR:
//   1. `scalex_runner.sh` acma yolunda uyarip `return 0` yapiyor ama `VERIFY;OK`
//      BASMIYOR (dogru — pod hazir degil, "dogrulandi" demek yalan olurdu).
//   2. `20_build_report.yml` hedef durumunu `VERIFY;OK` satirinin VARLIGINA gore
//      veriyordu; satir olmayinca akis `exe_warn` daline dusuyor.
//   3. `server/scalex/index.cjs` `status !== 'OK'` gorunce `recordRestoreFailure`.
//
// COZUM: uyari satiri `applied=yes` makine belirteci tasiyor, rapor bunu ayri bir
// dalda degerlendiriyor ve satira `verified` alanini EKLIYOR. Portal karari artik
// `status` yerine `verified` ile veriyor.
//
// BU TEST JINJA'YI GERCEKTEN CALISTIRIR (ansible varsa). `ansible-playbook
// --syntax-check` bu sinifi GORMEZ: YAML gecerlidir, ifade ancak calisma aninda
// derlenir (bkz. ocp-playbook-username.test.cjs ayni gerekce).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const SCALEX_APP = path.join(ROOT, 'server/ansible/bmw_portal/scalex/scalex_app');
const REPORT = path.join(SCALEX_APP, 'tasks', '20_build_report.yml');
const RUNNER = path.join(SCALEX_APP, 'files', 'scalex_runner.sh');

const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;

/** `cluster;jump;app;kind;step;status;detail` — betigin `log` bicimi. */
function row(step, status, detail, { app = 'app1', cluster = 'c1' } = {}) {
  return `${cluster};j1;${app};Deployment;${step};${status};${detail}`;
}

/**
 * `20_build_report.yml`i GERCEKTEN kosturur ve uretilen `mail_result_rows`u doner.
 * Gorev dosyasi oldugu gibi `include_tasks` ile cagrilir — kopyasi degil.
 */
function buildRows({ executeRows, precheckRows = [], mode = 'apply' }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-rv-'));
  try {
    const out = path.join(tmp, 'rows.json');
    const play = path.join(tmp, 'play.yml');
    fs.writeFileSync(
      play,
      [
        '---',
        '- hosts: localhost',
        '  gather_facts: false',
        '  vars:',
        '    cluster_list: ["c1"]',
        '    target_app_list: ["app1"]',
        `    execution_mode_effective: "${mode}"`,
        '    operation_action_effective: "restore"',
        '    allow_partial_execution_effective: true',
        '    _strict_blocked: false',
        '    _input_row: "c1;j1;-;-;INPUT;OK;ok"',
        `    _precheck_rows: ${JSON.stringify(precheckRows)}`,
        `    _execute_rows: ${JSON.stringify(executeRows)}`,
        '  tasks:',
        // BLOCK/RESCUE: gorev dosyasi `mail_result_rows`tan SONRA e-posta/HTML
        // rapor bloguna geciyor ve orasi bu testin konusu olmayan bir suru
        // degisken istiyor (job_id, oc_namespace, ...). Onlari burada taklit
        // etmek, testin ILGISIZ bir nedenle bayatlamasi demekti — yarin rapora
        // bir degisken eklenince kirmizi olurdu. `mail_result_rows` uretildikten
        // sonraki hata YUTULUR; `always` bloguna gelindiginde deger HAZIRDIR.
        '    - block:',
        `        - ansible.builtin.include_tasks: ${REPORT}`,
        '      rescue:',
        '        - ansible.builtin.debug: { msg: "rapor blogu atlandi" }',
        '      always:',
        '        - ansible.builtin.copy:',
        '            content: "{{ mail_result_rows | default([]) | to_json }}"',
        `            dest: ${out}`,
      ].join('\n'),
    );
    const r = spawnSync('ansible-playbook', [play], {
      encoding: 'utf8',
      env: { ...process.env, ANSIBLE_LOCALHOST_WARNING: 'False', ANSIBLE_DEPRECATION_WARNINGS: 'False' },
    });
    if (!fs.existsSync(out)) {
      throw new Error(`mail_result_rows uretilemedi (rc=${r.status}):\n${r.stdout}`);
    }
    const rows = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (!rows.length) {
      throw new Error(`mail_result_rows BOS geldi — gorev dosyasi satiri uretmeden dustu:\n${r.stdout}`);
    }
    return rows;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// RV1 — BETIK BELIRTECI BASIYOR MU. Zincirin ilk halkasi; bu satir olmadan
// asagidaki her sey olu kalir.
test('RV1 acma uyarisi `applied=yes` makine belirteci tasiyor', () => {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const warnLine = src
    .split('\n')
    .find((l) => l.includes('aciliyor, $RV_READY/$target'));
  assert.ok(warnLine, 'acma uyari satiri bulunamadi');
  assert.ok(
    warnLine.includes('applied=yes'),
    'acma uyarisi makine belirteci tasimiyor — rapor bunu "yalnizca uyari" sanir',
  );
  // `VERIFY;OK` BASILMAMALI: pod hazir degilken "dogrulandi" demek yalan olur.
  assert.doesNotMatch(
    warnLine,
    /"VERIFY" "OK"/,
    'acma uyari dalinda VERIFY;OK basiliyor — hazir olmayan seye dogrulandi deniyor',
  );
});

test('RV2 `applied=yes` tasiyan WARN hedefi `verified: true` uretir', { skip: !HAS_ANSIBLE }, () => {
  const rows = buildRows({
    executeRows: [
      row('SCALE', 'OK', 'patched replicas=1'),
      row('VERIFY', 'WARN', 'applied=yes aciliyor, 0/1, 5 dk bekleniyor; replica degisikligi UYGULANDI, pod hazir olmayi surduruyor'),
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verified, true, 'uygulanmis bir hedef `verified: false` geldi');
  assert.match(
    rows[0].detail,
    /Replica değişikliği uygulandı/,
    'hedef detayi ham uyari metni — yeni dal calismamis',
  );
});

test('RV3 gercek `VERIFY;OK` da `verified: true` uretir (mevcut yol bozulmadi)', { skip: !HAS_ANSIBLE }, () => {
  const rows = buildRows({
    executeRows: [row('SCALE', 'OK', 'patched'), row('VERIFY', 'OK', 'desired=1 current=1 ready=1 target=1')],
  });
  assert.equal(rows[0].status, 'OK');
  assert.equal(rows[0].verified, true);
});

// RV4 — ASIL AYRIM. `VERIFY;FAIL` hala FAIL ve `verified: false`. Bu dal
// gevserse portal GERCEK bir basarisizligi "olmus" sayar.
test('RV4 `VERIFY;FAIL` hedefi FAIL ve `verified: false` kalir', { skip: !HAS_ANSIBLE }, () => {
  const rows = buildRows({
    executeRows: [row('SCALE', 'OK', 'patched'), row('VERIFY', 'FAIL', '0 olmasi 10 dk gecti expected=0 current=2')],
  });
  assert.equal(rows[0].status, 'FAIL');
  assert.equal(rows[0].verified, false, 'basarisiz dogrulama `verified: true` geldi');
});

// RV5 — BELIRTECSIZ WARN, `verified` VERMEZ. Yeni dal "her WARN'i gecerli say"
// haline gelirse bu kirmizi olur.
test('RV5 belirtecsiz WARN `verified: false` kalir', { skip: !HAS_ANSIBLE }, () => {
  const rows = buildRows({
    executeRows: [row('SCALE', 'WARN', 'HPA pin failed hpa=x')],
  });
  assert.equal(rows[0].verified, false, 'belirtecsiz uyari uygulanmis sayildi');
});

// RV6 — DAL SIRASI. `verify_applied` dali `_strict_blocked`tan ONCE ve
// `exe_warn`dan ONCE gelmeli; `verify_fail`den SONRA gelmeli.
test('RV6 yeni dal karar zincirinde DOGRU YERDE', () => {
  const src = fs.readFileSync(REPORT, 'utf8');
  const iFail = src.indexOf("verify_fail.items | length > 0");
  const iApplied = src.indexOf('verify_applied.items | length > 0 -%}');
  const iWarn = src.lastIndexOf("exe_warn | length > 0 or pre_warn | length > 0");
  assert.ok(iApplied > 0, '`verify_applied` dali yok');
  assert.ok(iFail > 0 && iFail < iApplied, 'FAIL dali `verify_applied`ten SONRA — gercek hata uygulanmis sayilir');
  assert.ok(iApplied < iWarn, '`verify_applied` dali `exe_warn`dan SONRA — hic ateslenmez');
});
