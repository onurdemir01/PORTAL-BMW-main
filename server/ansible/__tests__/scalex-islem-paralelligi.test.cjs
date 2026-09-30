// server/ansible/__tests__/scalex-islem-paralelligi.test.cjs
//
// PRECHECK / EXECUTE — CLUSTER'LAR PARALEL (`tasks/11_run_phase_parallel.yml`).
//
// Kesif paralelliginin (PF ailesi) uretimde ogrettigi uc sey burada da
// GERCEK `ansible-playbook` ile sinanir:
//   * `async_status` delege edilmezse BASARI taklidi yapar (L3),
//   * `/tmp` noexec: betik yorumlayiciya okutulur, kopya 0600 (L6),
//   * hata satiri sebebi (rc/stderr) tasir (L4).
// Ve bu faza ozgu iki kural:
//   * ayni cluster iki kez hedefte olamaz — es zamanli iki yazici (L5),
//   * TUM cluster'larin precheck'i bitmeden execute baslamaz (L8).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP = path.join(__dirname, '..', 'bmw_portal', 'scalex', 'scalex_app');
const TASKS = path.join(APP, 'tasks');
const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;

test('L0 CI`da ansible KURULU (L ailesi sessizce atlanmasin)', () => {
  if (process.env.CI !== 'true') return;
  assert.ok(HAS_ANSIBLE, 'CI=true ama `ansible-playbook` yok — L ailesi kosmuyor.');
});

/**
 * `11_run_phase_parallel.yml`i GERCEKTEN kosturur. `playbook_dir` set
 * edilemedigi icin sahte runner gecici dizinin `files/` altina konur ve play
 * orada kosar (uretim kodunda test dikisi yok).
 *
 * `fazlar`: sirayla kosturulacak fazlar — iki faz AYNI play'de kosunca satir
 * tamponlarinin birbirine karismadigi da olculur.
 */
function kostur({
  fazlar = ['precheck'],
  clusters = ['c1', 'c2'],
  sleepSaniye = 2,
  exitKodu = 0,
  bosCikti = false,
  delegasyon = true,
  gorevDegistir = null,
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-lp-'));
  try {
    fs.mkdirSync(path.join(tmp, 'files'));
    const iz = path.join(tmp, 'iz.log');
    const runnerYolu = path.join(tmp, 'kopyalanan_runner.sh');
    fs.writeFileSync(
      path.join(tmp, 'files', 'scalex_runner.sh'),
      [
        '#!/bin/bash',
        `printf 'BASLA %s %s\\n' "$SCALEX_PHASE" "$CLUSTER" >> ${JSON.stringify(iz)}`,
        `sleep ${sleepSaniye}`,
        `printf 'BITTI %s %s\\n' "$SCALEX_PHASE" "$CLUSTER" >> ${JSON.stringify(iz)}`,
        bosCikti
          ? 'true'
          : 'printf \'%s;%s;odeme-api;Deployment;%s;OK;faz=%s batch=%s\\n\' "$CLUSTER" "$JUMP_SERVER" "$(printf %s "$SCALEX_PHASE" | tr a-z A-Z)" "$SCALEX_PHASE" "$SCALEX_BATCH_EXECUTE"',
        `[ ${exitKodu} -ne 0 ] && echo 'sahte runner patladi; sebep=deneme' >&2`,
        `exit ${exitKodu}`,
      ].join('\n'),
      { mode: 0o644 },
    );

    let gorev = path.join(TASKS, '11_run_phase_parallel.yml');
    let src = fs.readFileSync(gorev, 'utf8');
    if (!delegasyon) {
      const bozuk = src.replace(
        '  delegate_to: "{{ item.scalex_target.runtime_host }}"\n',
        '  # DELEGASYON BILEREK KALDIRILDI (bekci)\n',
      );
      assert.notEqual(
        bozuk,
        src,
        '`async_status` delegasyonu bulunamadi — bekci hedefini kaybetti',
      );
      src = bozuk;
    }
    if (gorevDegistir) src = gorevDegistir(src);
    gorev = path.join(tmp, 'gorev.yml');
    fs.writeFileSync(gorev, src);

    const matrix = clusters.map((c) => ({
      cluster: c,
      jump_label: `jump-${c}`,
      physical_host: `jump-${c}`,
      runtime_host: `lp_${c}`,
      api_url: 'https://a:6443',
      credential: 'lp_sifre',
      tls_verify: false,
      oc_paths: ['/bin/oc'],
    }));
    const vars = {
      target_matrix: matrix,
      username: 'uxmid',
      lp_sifre: 'gizli',
      oc_namespace: 'ns1',
      scalex_cluster_apps_effective: {},
      target_app_list: ['odeme-api'],
      operation_action_effective: 'stop',
      target_replicas_effective: '0',
      workload_kind_effective: 'auto',
      cluster_workload_kinds_effective: {},
      workload_kinds_effective: '',
      verify_warn_seconds_effective: '300',
      verify_fail_seconds_effective: '600',
      wait_attempts: 30,
      wait_seconds: 2,
      job_id: '1',
      hpa_pin_effective: false,
      _precheck_rows: [],
      _execute_rows: [],
    };
    const faz = (f) => [
      `        - ansible.builtin.include_tasks: ${gorev}`,
      '          vars:',
      `            scalex_phase: ${f}`,
      `            _phase_runner_path: ${JSON.stringify(runnerYolu)}`,
      '            _phase_async_seconds: 60',
    ];
    const play = path.join(tmp, 'p.yml');
    fs.writeFileSync(
      play,
      [
        '---',
        '- hosts: localhost',
        '  connection: local',
        '  gather_facts: false',
        `  vars: ${JSON.stringify(vars)}`,
        '  tasks:',
        '    - ansible.builtin.add_host:',
        '        name: "{{ item.runtime_host }}"',
        '        ansible_connection: local',
        `        ansible_async_dir: "${tmp}/async_{{ item.cluster }}"`,
        '      loop: "{{ target_matrix }}"',
        '    - block:',
        ...fazlar.flatMap(faz),
        '        - ansible.builtin.debug:',
        '            msg: "PRE={{ _precheck_rows | join(\'~~\') }}"',
        '        - ansible.builtin.debug:',
        '            msg: "EXE={{ _execute_rows | join(\'~~\') }}"',
        '      rescue:',
        '        - ansible.builtin.debug: { msg: "PLAY_FAILED" }',
      ].join('\n'),
    );
    const r = spawnSync('ansible-playbook', [play], {
      encoding: 'utf8',
      cwd: tmp,
      env: {
        ...process.env,
        ANSIBLE_LOCALHOST_WARNING: 'False',
        ANSIBLE_DEPRECATION_WARNINGS: 'False',
      },
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const yakala = (re) => {
      const m = re.exec(out);
      return m ? m[1] : '';
    };
    return {
      out,
      pre: yakala(/PRE=(.*?)"/)
        .split('~~')
        .filter(Boolean),
      exe: yakala(/EXE=(.*?)"/)
        .split('~~')
        .filter(Boolean),
      iz: fs.existsSync(iz) ? fs.readFileSync(iz, 'utf8').split('\n').filter(Boolean) : [],
      kopyaKaldi: fs.existsSync(runnerYolu),
      playFailed: /PLAY_FAILED/.test(out),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── L1: CLUSTER'LAR AYNI ANDA ───────────────────────────────────────────────
// Sure olculmuyor; olcut IC ICE GECME (ikinci BASLA, ilk BITTI'den once).
test('L1 cluster`lar AYNI ANDA kosuyor (ic ice gecme)', { skip: !HAS_ANSIBLE }, () => {
  const r = kostur({ fazlar: ['execute'] });
  assert.ok(!r.playFailed, r.out.slice(-1500));
  const basla = r.iz.map((x) => x.startsWith('BASLA')).lastIndexOf(true);
  const bitti = r.iz.findIndex((x) => x.startsWith('BITTI'));
  assert.ok(
    basla >= 0 && bitti >= 0 && basla < bitti,
    `cluster'lar SERI kostu: ${JSON.stringify(r.iz)}`,
  );
  assert.equal(r.exe.length, 2, `satirlar toplanmadi: ${JSON.stringify(r.exe)}`);
});

// ── L2: SATIRLAR DOGRU TAMPONA, FAZLAR KARISMAZ ─────────────────────────────
test(
  'L2 precheck ve execute satirlari kendi tamponlarina gidiyor, karismiyor',
  { skip: !HAS_ANSIBLE },
  () => {
    const r = kostur({ fazlar: ['precheck', 'execute'], sleepSaniye: 0 });
    assert.ok(!r.playFailed, r.out.slice(-1500));
    assert.equal(r.pre.length, 2, JSON.stringify(r.pre));
    assert.equal(r.exe.length, 2, JSON.stringify(r.exe));
    assert.ok(
      r.pre.every((x) => /;PRECHECK;OK;faz=precheck/.test(x)),
      JSON.stringify(r.pre),
    );
    assert.ok(
      r.exe.every((x) => /;EXECUTE;OK;faz=execute/.test(x)),
      `execute tamponunda precheck satiri: ${JSON.stringify(r.exe)}`,
    );
    // Ortam gercekten tasiniyor: toplu execute anahtari runner'a ulasiyor.
    assert.ok(
      r.exe.every((x) => /batch=true/.test(x)),
      JSON.stringify(r.exe),
    );
  },
);

// ── L3: DELEGASYON KALDIRILIRSA SESSIZ BASARI DEGIL, FAIL ───────────────────
test(
  'L3 `async_status` delegasyonu kaldirilirsa cluster`lar FAIL ile duser',
  { skip: !HAS_ANSIBLE },
  () => {
    const r = kostur({ fazlar: ['execute'], delegasyon: false, sleepSaniye: 0 });
    const fail = r.exe.filter((x) => /;RUNNER;FAIL;/.test(x));
    assert.equal(fail.length, 2, `delegasyon tuzagi SESSIZ gecti: ${JSON.stringify(r.exe)}`);
  },
);

// ── L4: HATA SEBEBI SATIRDA; BOS CEVAP DA FAIL ──────────────────────────────
test('L4 sifir disi cikista satir rc ve stderr tasiyor', { skip: !HAS_ANSIBLE }, () => {
  const r = kostur({ fazlar: ['execute'], clusters: ['c1'], exitKodu: 3, sleepSaniye: 0 });
  const fail = r.exe.find((x) => /;RUNNER;FAIL;/.test(x));
  assert.ok(fail, JSON.stringify(r.exe));
  assert.match(fail, /rc=3/);
  assert.match(fail, /sahte runner patladi/);
  assert.equal(fail.split(';').length, 7, `sebep satir bicimini bozdu: ${fail}`);
});
test('L4b betik hic satir basmazsa cluster FAIL', { skip: !HAS_ANSIBLE }, () => {
  const r = kostur({ fazlar: ['precheck'], clusters: ['c1'], bosCikti: true, sleepSaniye: 0 });
  assert.ok(
    r.pre.some((x) => /;RUNNER;FAIL;Runner returned no structured result rows/.test(x)),
    JSON.stringify(r.pre),
  );
});

// ── L5: AYNI CLUSTER IKI KEZ -> HIC BASLATILMAZ ─────────────────────────────
test('L5 ayni cluster iki kez hedefteyse HICBIR runner baslamaz', { skip: !HAS_ANSIBLE }, () => {
  const r = kostur({ fazlar: ['execute'], clusters: ['c1', 'c1'], sleepSaniye: 0 });
  assert.ok(r.playFailed, 'tekrarlanan cluster ile play devam etti');
  assert.deepEqual(r.iz, [], `runner baslatildi: ${JSON.stringify(r.iz)}`);
});

// ── L6: NOEXEC `/tmp` ───────────────────────────────────────────────────────
// Kopya 0600: dogrudan calistirmaya donen her degisiklik L1/L2'de rc=126 ile
// kirmiziya doner (noexec bagi olmadan). Bu bekci iki yarisini acikca yazar.
test('L6 kopya 0600 ve betik `/bin/bash` ile okutuluyor', () => {
  const src = fs.readFileSync(path.join(TASKS, '11_run_phase_parallel.yml'), 'utf8');
  assert.match(src, /dest: "\{\{ _phase_runner_path \}\}"\n\s+mode: "0600"/);
  assert.match(src, /cmd: "\/bin\/bash \{\{ _phase_runner_path \| quote \}\}"/);
});

// ── L7: ORTAM IKI YOLDA AYNI ────────────────────────────────────────────────
// Seri ve paralel yol ayni runner'i ayni degiskenlerle cagirmali. Iki kopya
// kayarsa (biri yeni bir anahtar alir, oteki almaz) paralel yol sessizce
// farkli davranir.
function ortam(dosya) {
  const src = fs.readFileSync(path.join(TASKS, dosya), 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf('  environment:\n');
  const j = src.indexOf('  delegate_to:', i);
  return src
    .slice(i, j)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l) && l.trim())
    .join('\n');
}
test('L7 paralel ve seri yolun `environment` bloklari BIREBIR ayni', () => {
  const seri = ortam('10_run_phase.yml');
  const paralel = ortam('11_run_phase_parallel.yml');
  assert.ok(seri.includes('SCALEX_PHASE'), 'seri ortam blogu okunamadi');
  assert.equal(paralel, seri);
});

// ── L8: GUVENLIK SIRASI main.yml'DE ─────────────────────────────────────────
// METIN BEKCISI (acikca): davranisi L1-L5 kanitliyor; bu, fazlarin SIRASINI
// ve seri/paralel yolun AYNI ANDA kosamayacagini kilitler.
test('L8 precheck (her iki yol) -> STRICT karari -> execute (her iki yol); yollar birbirini dislar', () => {
  const src = fs.readFileSync(path.join(APP, 'main.yml'), 'utf8');
  const sira = [
    'PRECHECK | Validate every target before mutation (parallel)',
    'PRECHECK | Validate every target before mutation"',
    'STRICT MODE | Block all mutations when any precheck fails',
    'EXECUTE | Apply verified operations in parallel',
    'EXECUTE | Apply verified operations serially',
  ].map((ad) => src.indexOf(ad));
  assert.ok(
    sira.every((x) => x > 0),
    `gorev bulunamadi: ${JSON.stringify(sira)}`,
  );
  assert.deepEqual(
    [...sira].sort((a, b) => a - b),
    sira,
    'faz sirasi bozulmus',
  );
  const blok = (ad) => src.slice(src.indexOf(ad), src.indexOf('\n\n', src.indexOf(ad)));
  assert.match(
    blok('PRECHECK | Validate every target before mutation (parallel)'),
    /when: phase_parallel_effective \| bool/,
  );
  assert.match(
    blok('PRECHECK | Validate every target before mutation"'),
    /when: not \(phase_parallel_effective \| bool\)/,
  );
  const exePar = blok('EXECUTE | Apply verified operations in parallel');
  assert.match(exePar, /- not _strict_blocked/);
  assert.match(exePar, /- phase_parallel_effective \| bool/);
  const exeSeri = blok('EXECUTE | Apply verified operations serially');
  assert.match(exeSeri, /- not _strict_blocked/);
  assert.match(exeSeri, /- not \(phase_parallel_effective \| bool\)/);
});

// ── L9: KOPYA SONDA SILINIR ─────────────────────────────────────────────────
test('L9 kopyalanan betik SONDA siliniyor', { skip: !HAS_ANSIBLE }, () => {
  const r = kostur({ fazlar: ['precheck'], clusters: ['c1'], sleepSaniye: 0 });
  assert.equal(r.pre.length, 1, JSON.stringify(r.pre));
  assert.equal(r.kopyaKaldi, false, 'kopya jump sunucusunda kaldi');
});

// ── L10: STRICT MODE DAVRANISSAL — main.yml'IN KENDI GOREVLERIYLE ───────────
//
// L8 sirayi METIN olarak kilitliyor; bu bekci AYNI gorevleri KOSTURUR.
// `main.yml`den precheck -> execute arasi gorev blogu METIN OLARAK kesilir
// (yeni bir YAML bagimliligi eklemeden) ve gercek `ansible-playbook` ile
// calistirilir. c1'in precheck'i FAIL, c2'ninki OK:
//   kismi calistirma KAPALI -> HICBIR cluster'da execute baslamaz (BLOCKED),
//   kismi calistirma ACIK   -> execute baslar (kontrol: bekci kor degil).
function strictKostur({ kismi }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-strict-'));
  try {
    fs.mkdirSync(path.join(tmp, 'files'));
    const iz = path.join(tmp, 'iz.log');
    fs.writeFileSync(
      path.join(tmp, 'files', 'scalex_runner.sh'),
      [
        '#!/bin/bash',
        `printf '%s %s\\n' "$SCALEX_PHASE" "$CLUSTER" >> ${JSON.stringify(iz)}`,
        'SONUC=OK; [ "$SCALEX_PHASE" = precheck ] && [ "$CLUSTER" = c1 ] && SONUC=FAIL',
        'printf \'%s;%s;odeme-api;Deployment;%s;%s;x\\n\' "$CLUSTER" "$JUMP_SERVER" "$(printf %s "$SCALEX_PHASE" | tr a-z A-Z)" "$SONUC"',
      ].join('\n'),
    );
    const main = fs.readFileSync(path.join(APP, 'main.yml'), 'utf8').replace(/\r\n/g, '\n');
    const bas =
      main.lastIndexOf(
        '\n',
        main.indexOf('- name: "PRECHECK | Validate every target before mutation (parallel)"'),
      ) + 1;
    const son = main.lastIndexOf('\n', main.indexOf('- name: "Build consolidated report"')) + 1;
    const blok = main
      .slice(bas, son)
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .map((l) => l.replace(/^ {4}/, ''))
      .join('\n')
      .replace(/tasks\/1([01])_run_phase/g, `${TASKS}/1$1_run_phase`);
    assert.ok(blok.includes('STRICT MODE'), 'main.yml blogu kesilemedi');
    const matrix = ['c1', 'c2'].map((c) => ({
      cluster: c,
      jump_label: `j-${c}`,
      physical_host: `j-${c}`,
      runtime_host: `st_${c}`,
      api_url: 'https://a:6443',
      credential: 'st_sifre',
      tls_verify: false,
      oc_paths: ['/bin/oc'],
    }));
    const vars = {
      target_matrix: matrix,
      username: 'u',
      st_sifre: 'x',
      oc_namespace: 'ns1',
      scalex_cluster_apps_effective: {},
      target_app_list: ['odeme-api'],
      operation_action_effective: 'stop',
      target_replicas_effective: '0',
      workload_kind_effective: 'auto',
      cluster_workload_kinds_effective: {},
      workload_kinds_effective: '',
      verify_warn_seconds_effective: '300',
      verify_fail_seconds_effective: '600',
      wait_attempts: 30,
      wait_seconds: 2,
      job_id: '1',
      hpa_pin_effective: false,
      execution_mode_effective: 'apply',
      allow_partial_execution_effective: kismi,
      phase_parallel_effective: true,
      _precheck_rows: [],
      _execute_rows: [],
      _strict_blocked: false,
    };
    const play = path.join(tmp, 'p.yml');
    fs.writeFileSync(
      play,
      [
        '---',
        '- hosts: localhost',
        '  connection: local',
        '  gather_facts: false',
        `  vars: ${JSON.stringify(vars)}`,
        '  tasks:',
        '    - ansible.builtin.add_host:',
        '        name: "{{ item.runtime_host }}"',
        '        ansible_connection: local',
        `        ansible_async_dir: "${tmp}/async_{{ item.cluster }}"`,
        '      loop: "{{ target_matrix }}"',
        blok,
        '    - ansible.builtin.debug:',
        '        msg: "EXE={{ _execute_rows | join(\'~~\') }}"',
      ].join('\n'),
    );
    const r = spawnSync('ansible-playbook', [play], {
      encoding: 'utf8',
      cwd: tmp,
      env: { ...process.env, ANSIBLE_LOCALHOST_WARNING: 'False' },
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const m = /EXE=(.*?)"/.exec(out);
    return {
      out,
      exe: m ? m[1].split('~~').filter(Boolean) : null,
      iz: fs.existsSync(iz) ? fs.readFileSync(iz, 'utf8').split('\n').filter(Boolean) : [],
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test(
  'L10 bir cluster`in precheck`i dusmusse HICBIR cluster`da execute baslamaz (main.yml gorevleri)',
  { skip: !HAS_ANSIBLE },
  () => {
    const r = strictKostur({ kismi: false });
    assert.ok(r.exe, `play tamamlanmadi:\n${r.out.slice(-2000)}`);
    assert.deepEqual(r.iz.filter((x) => x.startsWith('precheck')).sort(), [
      'precheck c1',
      'precheck c2',
    ]);
    assert.deepEqual(
      r.iz.filter((x) => x.startsWith('execute')),
      [],
      `precheck FAIL varken execute BASLADI: ${JSON.stringify(r.iz)}`,
    );
    assert.ok(
      r.exe.some((x) => /^GLOBAL;-;-;-;BLOCKED;FAIL;/.test(x)),
      JSON.stringify(r.exe),
    );
    // KONTROL: kismi calistirma aciksa execute GERCEKTEN baslar — bekci "execute
    // hic calismiyor" halinde de yesil kalmasin.
    const acik = strictKostur({ kismi: true });
    assert.ok(
      acik.iz.some((x) => x.startsWith('execute')),
      `kismi calistirma acikken de execute baslamadi: ${JSON.stringify(acik.iz)}\n${acik.out.slice(-1500)}`,
    );
  },
);
