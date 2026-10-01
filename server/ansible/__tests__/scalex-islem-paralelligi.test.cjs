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
  dosya = '11_run_phase_parallel.yml',
  tekJump = false,
  uygulamalar = {},
  tipler = {},
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
          : 'printf \'%s;%s;odeme-api;Deployment;%s;OK;faz=%s batch=%s apps=%s kinds=%s\\n\' "$CLUSTER" "$JUMP_SERVER" "$(printf %s "$SCALEX_PHASE" | tr a-z A-Z)" "$SCALEX_PHASE" "$SCALEX_BATCH_EXECUTE" "${APP_RAW:-}" "${WORKLOAD_KINDS:-}"',
        `[ ${exitKodu} -ne 0 ] && echo 'sahte runner patladi; sebep=deneme' >&2`,
        `exit ${exitKodu}`,
      ].join('\n'),
      { mode: 0o644 },
    );

    // Tek tur yolu sarmalayiciyi da `playbook_dir/files`tan okur.
    fs.copyFileSync(
      path.join(APP, 'files', 'scalex_batch.sh'),
      path.join(tmp, 'files', 'scalex_batch.sh'),
    );
    let gorev = path.join(TASKS, dosya);
    let src = fs.readFileSync(gorev, 'utf8');
    if (!delegasyon) {
      const hedef =
        dosya === '11_run_phase_parallel.yml'
          ? '  delegate_to: "{{ item.scalex_target.runtime_host }}"\n'
          : '  delegate_to: "{{ item._phase_host }}"\n';
      const bozuk = src.replace(hedef, '  # DELEGASYON BILEREK KALDIRILDI (bekci)\n');
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
      runtime_host: tekJump ? 'lp_tek' : `lp_${c}`,
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
      scalex_cluster_apps_effective: uygulamalar,
      target_app_list: ['odeme-api'],
      operation_action_effective: 'stop',
      target_replicas_effective: '0',
      workload_kind_effective: 'auto',
      cluster_workload_kinds_effective: tipler,
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
        `        ansible_async_dir: "${tmp}/async_{{ item.runtime_host }}"`,
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
test('L8 precheck (uc yol) -> STRICT karari -> execute (uc yol); yollar birbirini dislar', () => {
  const src = fs.readFileSync(path.join(APP, 'main.yml'), 'utf8');
  const sira = [
    'PRECHECK | Validate every target before mutation (one session per jump server)',
    'PRECHECK | Validate every target before mutation (parallel)',
    'PRECHECK | Validate every target before mutation"',
    'STRICT MODE | Block all mutations when any precheck fails',
    'EXECUTE | Apply verified operations (one session per jump server)',
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
    blok('PRECHECK | Validate every target before mutation (one session per jump server)'),
    /when: phase_transport_effective == 'batch'/,
  );
  const prePar = blok('PRECHECK | Validate every target before mutation (parallel)');
  assert.match(prePar, /- phase_parallel_effective \| bool/);
  assert.match(prePar, /- phase_transport_effective == 'async'/);
  const exeBat = blok('EXECUTE | Apply verified operations (one session per jump server)');
  assert.match(exeBat, /- not _strict_blocked/);
  assert.match(exeBat, /- phase_transport_effective == 'batch'/);
  assert.match(
    blok('PRECHECK | Validate every target before mutation"'),
    /when: not \(phase_parallel_effective \| bool\)/,
  );
  const exePar = blok('EXECUTE | Apply verified operations in parallel');
  assert.match(exePar, /- not _strict_blocked/);
  assert.match(exePar, /- phase_parallel_effective \| bool/);
  assert.match(exePar, /- phase_transport_effective == 'async'/);
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
function strictKostur({ kismi, tasima = 'batch' }) {
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
    fs.copyFileSync(
      path.join(APP, 'files', 'scalex_batch.sh'),
      path.join(tmp, 'files', 'scalex_batch.sh'),
    );
    const main = fs.readFileSync(path.join(APP, 'main.yml'), 'utf8').replace(/\r\n/g, '\n');
    const bas =
      main.lastIndexOf(
        '\n',
        main.indexOf(
          '- name: "PRECHECK | Validate every target before mutation (one session per jump server)"',
        ),
      ) + 1;
    const son = main.lastIndexOf('\n', main.indexOf('- name: "Build consolidated report"')) + 1;
    const blok = main
      .slice(bas, son)
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .map((l) => l.replace(/^ {4}/, ''))
      .join('\n')
      .replace(/tasks\/1([012])_run_phase/g, `${TASKS}/1$1_run_phase`);
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
      phase_transport_effective: tasima,
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

for (const tasima of ['batch', 'async']) {
  test(
    'L10 [' +
      tasima +
      '] bir cluster`in precheck`i dusmusse HICBIR cluster`da execute baslamaz (main.yml gorevleri)',
    { skip: !HAS_ANSIBLE },
    () => {
      const r = strictKostur({ kismi: false, tasima });
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
      const acik = strictKostur({ kismi: true, tasima });
      assert.ok(
        acik.iz.some((x) => x.startsWith('execute')),
        `kismi calistirma acikken de execute baslamadi: ${JSON.stringify(acik.iz)}\n${acik.out.slice(-1500)}`,
      );
    },
  );
}

// ══ P AILESI: TEK TUR YOLU (12_run_phase_batch.yml) ═════════════════════════
//
// Ayni sahte runner ve ayni kostur; yalnizca gorev dosyasi farkli. Davranis
// sozlesmesi eski paralel yolla AYNI olmali (satirlar, FAIL metinleri, tampon
// ayrimi, tekrarlanan cluster engeli).
const BAT = { dosya: '12_run_phase_batch.yml' };

test('P1 [cok jump] cluster`lar AYNI ANDA, satirlar toplaniyor', { skip: !HAS_ANSIBLE }, () => {
  const r = kostur({ ...BAT, fazlar: ['execute'] });
  assert.ok(!r.playFailed, r.out.slice(-1500));
  const basla = r.iz.map((x) => x.startsWith('BASLA')).lastIndexOf(true);
  const bitti = r.iz.findIndex((x) => x.startsWith('BITTI'));
  assert.ok(basla >= 0 && bitti >= 0 && basla < bitti, `SERI kostu: ${JSON.stringify(r.iz)}`);
  assert.equal(r.exe.length, 2, JSON.stringify(r.exe));
});

test('P1b [tek jump] iki cluster TEK oturumda ve AYNI ANDA', { skip: !HAS_ANSIBLE }, () => {
  for (const faz of ['precheck', 'execute']) {
    const r = kostur({ ...BAT, fazlar: [faz], tekJump: true });
    assert.ok(!r.playFailed, r.out.slice(-1500));
    const basla = r.iz.map((x) => x.startsWith('BASLA')).lastIndexOf(true);
    const bitti = r.iz.findIndex((x) => x.startsWith('BITTI'));
    assert.ok(basla < bitti, `${faz} SERI kostu: ${JSON.stringify(r.iz)}`);
    const satir = faz === 'precheck' ? r.pre : r.exe;
    assert.equal(satir.length, 2, `${faz}: ${JSON.stringify(satir)}`);
  }
});

test(
  'P2 precheck/execute satirlari kendi tamponlarinda, ortam runner`a ulasiyor',
  { skip: !HAS_ANSIBLE },
  () => {
    const r = kostur({ ...BAT, fazlar: ['precheck', 'execute'], sleepSaniye: 0 });
    assert.ok(!r.playFailed, r.out.slice(-1500));
    assert.equal(r.pre.length, 2, JSON.stringify(r.pre));
    assert.equal(r.exe.length, 2, JSON.stringify(r.exe));
    assert.ok(
      r.pre.every((x) => /;PRECHECK;OK;faz=precheck/.test(x)),
      JSON.stringify(r.pre),
    );
    assert.ok(
      r.exe.every((x) => /;EXECUTE;OK;faz=execute batch=true/.test(x)),
      JSON.stringify(r.exe),
    );
    assert.ok(
      r.exe.every((x) => /^c\d;jump-c\d;/.test(x)),
      'cluster/jump alanlari tasinmadi',
    );
  },
);

test(
  'P3 async_status delegasyonu kaldirilirsa cluster`lar FAIL (sessiz basari yok)',
  { skip: !HAS_ANSIBLE },
  () => {
    const r = kostur({ ...BAT, fazlar: ['execute'], delegasyon: false, sleepSaniye: 0 });
    const fail = r.exe.filter((x) => /;RUNNER;FAIL;Runner could not complete/.test(x));
    assert.equal(fail.length, 2, JSON.stringify(r.exe));
  },
);

test(
  'P4 sifir disi cikis: eski metin + rc + stderr; bos cevap: eski metin',
  { skip: !HAS_ANSIBLE },
  () => {
    const r = kostur({
      ...BAT,
      fazlar: ['execute'],
      clusters: ['c1'],
      exitKodu: 3,
      sleepSaniye: 0,
    });
    const fail = r.exe.find((x) => /;RUNNER;FAIL;/.test(x));
    assert.ok(fail, JSON.stringify(r.exe));
    assert.match(
      fail,
      /;RUNNER;FAIL;Runner could not complete because of SSH\/transport\/shell\/runtime failure \(rc=3: /,
    );
    assert.match(fail, /sahte runner patladi/);
    assert.equal(fail.split(';').length, 7, fail);
    const b = kostur({
      ...BAT,
      fazlar: ['precheck'],
      clusters: ['c1'],
      bosCikti: true,
      sleepSaniye: 0,
    });
    assert.ok(
      b.pre.includes('c1;jump-c1;-;-;RUNNER;FAIL;Runner returned no structured result rows'),
      JSON.stringify(b.pre),
    );
  },
);

test('P5 ayni cluster iki kez hedefteyse HICBIR runner baslamaz', { skip: !HAS_ANSIBLE }, () => {
  const r = kostur({ ...BAT, fazlar: ['execute'], clusters: ['c1', 'c1'], sleepSaniye: 0 });
  assert.ok(r.playFailed, 'tekrarlanan cluster ile play devam etti');
  assert.deepEqual(r.iz, []);
});

// ── P6: ORTAM ESKI PARALEL YOLLA AYNI (anahtar kumesi + ifadeler) ──────────
test('P6 runner`a verilen ortam 11_run_phase_parallel launch blogu ile AYNI', () => {
  const satirlar = (blok) =>
    new Map([...blok.matchAll(/^\s+([A-Z_]+): (.+)$/gm)].map((m) => [m[1], m[2].trim()]));
  const eski = satirlar(ortam('11_run_phase_parallel.yml'));
  const src = fs.readFileSync(path.join(TASKS, '12_run_phase_batch.yml'), 'utf8');
  const ortak = /_phase_batch_common:\n([\s\S]*?)\n {4}_phase_batch_env:/.exec(src);
  assert.ok(ortak, '_phase_batch_common bulunamadi');
  const yeni = satirlar(ortak[1]);
  const anahtarlar = /SCALEX_BATCH_KEYS: "([^"]+)"/.exec(ortak[1]);
  assert.ok(anahtarlar, 'SCALEX_BATCH_KEYS yok');
  for (const k of ['SCALEX_BATCH_TIMEOUT', 'SCALEX_BATCH_LABEL', 'SCALEX_BATCH_KEYS'])
    yeni.delete(k);
  // Ortak anahtarlar: ifade BIREBIR ayni.
  for (const [k, v] of yeni) assert.equal(v, eski.get(k), `${k} ifadesi kaydi`);
  // Cluster'a ozgu anahtarlar sozlukte kuruluyor.
  for (const k of anahtarlar[1].split(/\s+/)) {
    assert.ok(src.includes(`'SCALEX_T' ~ _i ~ '_${k}'`), `${k} cluster sozlugunde yok`);
    yeni.set(k, '*');
  }
  assert.deepEqual([...yeni.keys()].sort(), [...eski.keys()].sort());
});

// ── P7: EXECUTE TEK JUMP'TA DA ASYNC; PRECHECK TEK JUMP'TA SENKRON ──────────
// Senkron execute'ta SSH koparsa sarmalayici runner'lari oldurur ve olcekleme
// yarida kalir. Davranis olcumu: async yolun kanitı `async_status` gorevinin
// KOSMASI (atlanmamasi).
test(
  'P7 execute tek jump`ta da async (SSH kopsa da runner surer), precheck senkron',
  { skip: !HAS_ANSIBLE },
  () => {
    const exe = kostur({ ...BAT, fazlar: ['execute'], tekJump: true, sleepSaniye: 0 });
    const pre = kostur({ ...BAT, fazlar: ['precheck'], tekJump: true, sleepSaniye: 0 });
    const kostu = (out) => {
      const i = out.indexOf('Collect results from every jump server');
      const j = out.indexOf('TASK [', i + 1);
      return /\bok: \[|changed: \[/.test(out.slice(i, j));
    };
    assert.ok(kostu(exe.out), 'execute tek jump`ta async DEGIL (async_status kosmadi)');
    assert.ok(!kostu(pre.out), 'precheck tek jump`ta gereksiz async turu yapiyor');
    assert.equal(exe.exe.length, 2, JSON.stringify(exe.exe));
  },
);

test('P8 varsayilan tasima batch; async ve seri geri donusler duruyor', () => {
  const prep = fs.readFileSync(path.join(TASKS, '01_prepare.yml'), 'utf8');
  assert.match(prep, /scalex_phase_transport \| default\('batch'\)/);
  assert.match(prep, /'serial' if not \(\(scalex_parallel_clusters \| default\(true\)\) \| bool\)/);
});

// ── P9: CLUSTER'A OZGU UYGULAMA/TIP HARITASI DOGRU RUNNER'A ─────────────────
// Execute'ta EN PAHALI hata: bir cluster'in uygulama listesi bos ya da baska
// cluster'inki olarak gitmesi. Tek jump'ta (ayni sarmalayici) ve iki yolda.
for (const dosya of ['12_run_phase_batch.yml', '11_run_phase_parallel.yml']) {
  test(
    `P9 [${dosya}] cluster basina APP_RAW/WORKLOAD_KINDS kendi runner'ina gidiyor`,
    { skip: !HAS_ANSIBLE },
    () => {
      const r = kostur({
        dosya,
        fazlar: ['execute'],
        tekJump: dosya === '12_run_phase_batch.yml',
        sleepSaniye: 0,
        uygulamalar: { c1: 'a1,a2', c2: 'b1' },
        tipler: { c1: 'a1=deploy,a2=sts', c2: 'b1=dc' },
      });
      assert.ok(!r.playFailed, r.out.slice(-1500));
      const c = (ad) => r.exe.find((x) => x.startsWith(`${ad};`)) || '';
      assert.match(c('c1'), / apps=a1,a2 kinds=a1=deploy,a2=sts$/, JSON.stringify(r.exe));
      assert.match(c('c2'), / apps=b1 kinds=b1=dc$/, JSON.stringify(r.exe));
    },
  );
}
