// server/ansible/__tests__/scalex-kesif-tek-tur.test.cjs
//
// KESIF: JUMP BASINA TEK SSH TURU (PR-M).
//
// AWX 3365168/3365181/3365188 (2026-09-30): kesif 1 uygulamada da 19'da da
// 40+ sn. Runner 3-8 sn; kalan sure cluster BASINA ayri SSH modul turlari
// (copy + launch + async_status + remove). `10_discover_batch.yml` bunlari jump
// basina TEK `shell` gorevine indirir: runner STDIN ile gider, cluster'lari
// `files/scalex_batch.sh` arka planda AYNI ANDA kosar.
//
// Bekciler iki katmanda:
//   * M2-M5 sarmalayiciyi DOGRUDAN (bash) kosar: paralellik, hata satirlari,
//     gecici dizin temizligi, parola argv'de yok ve cluster'lar arasi sizinti yok.
//   * M1/M7 gorev dosyasini GERCEK `ansible-playbook` ile kosar ve eski paralel
//     yolla AYNI satirlari urettigini kanitlar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { SCALEX_PKG: PKG } = require('../paths.cjs');
const { BASH, PS_ARGV_KOMUTU, bekle, kabukPath, posixYol } = require('./fixtures/kabuk.cjs');
const APP = path.join(PKG, 'scalex_app');
const DISC = path.join(APP, 'tasks', 'discovery');
const BATCH = path.join(APP, 'files', 'scalex_batch.sh');

const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;
// `timeout` node'un calistirilabilir aramasiyla DEGIL, betigin kullandigi
// kabugun gozuyle olculur: Windows'ta ayni adli bir Windows komutu var ve
// varligi YANLIS raporlanabiliyor.
const HAS_TIMEOUT = spawnSync(BASH, ['-c', 'timeout 1 true'], { stdio: 'ignore' }).status === 0;

/**
 * Sahte runner: giris/cikis izi, kendi ortamindaki `SCALEX_T*` sayisi ve
 * gordugu parolalar. `mod` cluster adina gore davranisi secer.
 */
function sahteRunner(iz) {
  const q = JSON.stringify(posixYol(iz));
  return [
    `printf 'BASLA %s\\n' "$CLUSTER" >> ${q}`,
    'case "$CLUSTER" in',
    '  yavas*) sleep 5 ;;',
    '  *) sleep 1 ;;',
    'esac',
    `printf 'BITTI %s\\n' "$CLUSTER" >> ${q}`,
    `printf 'ENV %s %s\\n' "$CLUSTER" "$(env | grep -c '^SCALEX_T' || true)" >> ${q}`,
    `printf 'PW %s %s\\n' "$CLUSTER" "$OCP_PASSWORD" >> ${q}`,
    // Parola hicbir surecin argv'sinde gorunmemeli (M5). `ps -eo args=` her
    // kabukta YOK (Git Bash: "unknown option -- o"); yoksa cikis bos kalir,
    // `grep` eslesmez ve bekci "sizinti yok" sanip HEP yesil yanardi.
    // Bakilamadigi durumu ayrica bildirir: M5 onu da kirmizi sayar.
    `_ps="$(${PS_ARGV_KOMUTU})"`,
    `case "$_ps" in ps_yok|'') printf 'PS_YOK %s\\n' "$CLUSTER" >> ${q} ;; esac`,
    `printf '%s' "$_ps" | grep -F -- "$OCP_PASSWORD" >/dev/null && printf 'ARGV_SIZINTI %s\\n' "$CLUSTER" >> ${q}`,
    'case "$CLUSTER" in',
    '  bos*) exit 0 ;;',
    "  kirik*) echo 'sahte patladi' >&2; exit 7 ;;",
    'esac',
    'printf \'%s;%s;odeme-api;Deployment;WORKLOAD;OK;ns=%s\\n\' "$CLUSTER" "$JUMP_SERVER" "$NS"',
    'exit 0',
  ].join('\n');
}

/**
 * Sarmalayiciya GERCEK SIGTERM gonderir (AWX iptali / SSH kopmasi).
 *
 * Sinyali KABUK ICINDEN gonderiyoruz, `spawnSync`in `killSignal`i ile DEGIL:
 * node Windows'ta POSIX sinyali tasiyamaz, `SIGTERM` TerminateProcess'e doner
 * ve bash TERM/EXIT tuzaklarini HIC kosturmaz. Bekci o zaman betigin degil
 * platformun yuzunden kizarir. `kill -TERM` ayni kabuk ad uzayindan gidince
 * tuzaklar iki platformda da calisir.
 */
function termGonder(tmp, env, iz) {
  const bat = path.join(tmp, 'batch.sh');
  const run = path.join(tmp, 'runner.sh');
  fs.writeFileSync(bat, fs.readFileSync(BATCH, 'utf8'));
  fs.writeFileSync(run, sahteRunner(iz));
  const q = (x) => `'${posixYol(x)}'`;
  return spawnSync(
    BASH,
    [
      '-c',
      [
        `bash ${q(bat)} < ${q(run)} &`,
        'p=$!',
        'sleep 1.5',
        'kill -TERM "$p" 2>/dev/null',
        'wait "$p" 2>/dev/null',
        'exit 0',
      ].join('\n'),
    ],
    { env, encoding: 'utf8', timeout: 60000 },
  );
}

/** Sarmalayiciyi Ansible'in `shell` gorevi gibi kosturur: `bash -c <metin>`, stdin = runner. */
function sarmalayiciKostur(clusters, { zamanAsimi = 30, tmpdir, sinyal } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sx-batch-'));
  const kok = tmpdir || path.join(tmp, 'tmpdir');
  fs.mkdirSync(kok, { recursive: true });
  const iz = path.join(tmp, 'iz.log');
  try {
    const env = {
      PATH: kabukPath(),
      TMPDIR: posixYol(kok),
      NS: 'ns1',
      SCALEX_BATCH_TIMEOUT: String(zamanAsimi),
      SCALEX_BATCH_IDX: clusters.map((_, i) => i).join(' '),
    };
    clusters.forEach((c, i) => {
      env[`SCALEX_T${i}_CLUSTER`] = c;
      env[`SCALEX_T${i}_JUMP_LABEL`] = `jump-${c}`;
      env[`SCALEX_T${i}_JUMP_SERVER`] = `jump-${c}`;
      env[`SCALEX_T${i}_OCP_PASSWORD`] = `gizli-${c}-parola`;
    });
    const r = sinyal
      ? termGonder(tmp, env, iz)
      : spawnSync(BASH, ['-c', fs.readFileSync(BATCH, 'utf8')], {
          input: sahteRunner(iz),
          env,
          encoding: 'utf8',
          timeout: 60000,
        });
    // Sinyal senaryosunda cocuklarin kapanmasina firsat ver.
    // Yavas runner 5 sn uyuyor: 6 sn sonra hala yazmadiysa GERCEKTEN olduruldu.
    if (sinyal) bekle(6);
    const trace = fs.existsSync(iz) ? fs.readFileSync(iz, 'utf8').split('\n').filter(Boolean) : [];
    const kalan = fs.readdirSync(kok).filter((x) => x.startsWith('scalex_batch_'));
    return { status: r.status, out: r.stdout || '', err: r.stderr || '', trace, kalan };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── M2: CLUSTER'LAR AYNI ANDA KOSUYOR ───────────────────────────────────────
// Duvar saati yok: olcut IC ICE GECME (bekci-korlugu-desenleri).
test('M2 sarmalayici cluster`lari AYNI ANDA kosar (ic ice gecme)', { skip: !HAS_TIMEOUT }, () => {
  const r = sarmalayiciKostur(['c1', 'c2', 'c3']);
  assert.equal(r.status, 0, r.err);
  const basla = r.trace.filter((x) => x.startsWith('BASLA'));
  assert.equal(basla.length, 3, JSON.stringify(r.trace));
  const sonBasla = r.trace.indexOf(basla[basla.length - 1]);
  const ilkBitti = r.trace.findIndex((x) => x.startsWith('BITTI'));
  assert.ok(sonBasla < ilkBitti, `cluster'lar SERI kosuyor: ${JSON.stringify(r.trace)}`);
  // Cikti cluster SIRASIYLA ve her birinin sonunda bitti isareti.
  const satirlar = r.out.split('\n').filter(Boolean);
  assert.deepEqual(satirlar, [
    'c1;jump-c1;odeme-api;Deployment;WORKLOAD;OK;ns=ns1',
    '__SCALEX_DONE__;c1',
    'c2;jump-c2;odeme-api;Deployment;WORKLOAD;OK;ns=ns1',
    '__SCALEX_DONE__;c2',
    'c3;jump-c3;odeme-api;Deployment;WORKLOAD;OK;ns=ns1',
    '__SCALEX_DONE__;c3',
  ]);
});

// ── M3: HATA SATIRLARI eski yolla ayni metinde ──────────────────────────────
test('M3 rc!=0, zaman asimi ve bos cevap FAIL satiri uretir', { skip: !HAS_TIMEOUT }, () => {
  const r = sarmalayiciKostur(['iyi', 'kirik', 'bos', 'yavas'], { zamanAsimi: 3 });
  assert.equal(r.status, 0, r.err);
  const s = r.out.split('\n').filter(Boolean);
  assert.ok(s.includes('iyi;jump-iyi;odeme-api;Deployment;WORKLOAD;OK;ns=ns1'), r.out);
  assert.ok(
    s.includes(
      'kirik;jump-kirik;-;-;RUNNER;FAIL;Discovery could not complete because of SSH/transport/shell/runtime failure (rc=7: sahte patladi)',
    ),
    r.out,
  );
  assert.ok(
    s.includes('bos;jump-bos;-;-;RUNNER;FAIL;Discovery returned no structured result rows'),
    r.out,
  );
  assert.ok(
    s.some((x) => x.startsWith('yavas;jump-yavas;-;-;RUNNER;FAIL;') && x.includes('(rc=124')),
    `zaman asimi rc=124 satiri yok: ${r.out}`,
  );
  // Hatali cluster'lar da BITTI isareti alir: ansible tarafi onlari ikinci kez saymaz.
  for (const c of ['iyi', 'kirik', 'bos', 'yavas'])
    assert.ok(s.includes(`__SCALEX_DONE__;${c}`), c);
  // Iyi cluster'da FAIL yok.
  assert.ok(!s.some((x) => x.startsWith('iyi;') && x.includes(';FAIL;')), r.out);
});

// ── M4: GECICI DIZIN HER DURUMDA SILINIR ────────────────────────────────────
// Runner metni (ve jump'ta kalan hicbir iz) diskte BIRAKILMAZ.
test(
  'M4 gecici dizin basari, hata, zaman asimi ve sinyal sonrasi silinir',
  { skip: !HAS_TIMEOUT },
  () => {
    assert.deepEqual(sarmalayiciKostur(['c1']).kalan, [], 'basari');
    assert.deepEqual(sarmalayiciKostur(['kirik1']).kalan, [], 'hata');
    assert.deepEqual(sarmalayiciKostur(['yavas1'], { zamanAsimi: 1 }).kalan, [], 'zaman asimi');
    const s = sarmalayiciKostur(['yavas1'], { sinyal: true });
    assert.deepEqual(s.kalan, [], 'SIGTERM sonrasi dizin kaldi');
    // Sinyal yolunda cikti yari kalir; ansible tarafi isaretsiz cluster'i tasima hatasi sayar.
    assert.ok(!s.out.includes('__SCALEX_DONE__;yavas1'), s.out);
    // TERM tuzagi COCUKLARI da oldurur. Olmasa bile EXIT tuzagi dizini siler
    // (bash sinyalde de EXIT'i kosar, olculdu) — ama runner oksuz kalir ve
    // cluster'a `oc` cagirmaya devam ederdi. Iptal edilen is arkada is birakmaz.
    assert.ok(
      !s.trace.includes('BITTI yavas1'),
      `runner sinyalden sonra yasamaya devam etti: ${JSON.stringify(s.trace)}`,
    );
  },
);

// ── M5: PAROLA ARGV'DE YOK, cluster'lar arasi SIZINTI YOK ───────────────────
test(
  'M5 parola argv`de gorunmez ve baska cluster`in runner`ina sizmaz',
  { skip: !HAS_TIMEOUT },
  () => {
    const r = sarmalayiciKostur(['c1', 'c2']);
    assert.equal(r.status, 0, r.err);
    // `ps` bakamadiysa bu bekci hicbir sey KANITLAMAZ: bos cikis basari degil.
    assert.ok(
      !r.trace.some((x) => x.startsWith('PS_YOK')),
      `ps argv'ye bakamadi: ${JSON.stringify(r.trace)}`,
    );
    assert.ok(!r.trace.some((x) => x.startsWith('ARGV_SIZINTI')), JSON.stringify(r.trace));
    assert.ok(r.trace.includes('PW c1 gizli-c1-parola'), JSON.stringify(r.trace));
    assert.ok(r.trace.includes('PW c2 gizli-c2-parola'), JSON.stringify(r.trace));
    // Runner'in ortaminda HIC `SCALEX_T*` kalmaz: oteki cluster'in parolasi da gitti.
    assert.ok(r.trace.includes('ENV c1 0'), JSON.stringify(r.trace));
    assert.ok(r.trace.includes('ENV c2 0'), JSON.stringify(r.trace));
  },
);

// ── M6: ORTAM ANAHTARLARI eski paralel launch blogu ile AYNI ────────────────
// Iki yol kayarsa biri digerinden farkli degerle kosar (bkz. L7).
test('M6 runner`a verilen ortam anahtarlari eski paralel yolla ayni', () => {
  const par = fs.readFileSync(path.join(DISC, '10_discover_parallel.yml'), 'utf8');
  const blok =
    /Launch every selected cluster in parallel[\s\S]*?environment:\n([\s\S]*?)\n {2}delegate_to:/.exec(
      par,
    );
  assert.ok(blok, 'paralel launch ortam blogu bulunamadi');
  const eski = new Set([...blok[1].matchAll(/^ {4}([A-Z_]+):/gm)].map((m) => m[1]));

  const bat = fs.readFileSync(path.join(DISC, '10_discover_batch.yml'), 'utf8');
  const ortak = /_disc_batch_common:\n([\s\S]*?)\n {4}_disc_batch_env:/.exec(bat);
  assert.ok(ortak, '_disc_batch_common blogu bulunamadi');
  const yeni = new Set([...ortak[1].matchAll(/^ {6}([A-Z_]+):/gm)].map((m) => m[1]));
  yeni.delete('SCALEX_BATCH_TIMEOUT'); // sarmalayicinin kendi girdisi, runner'a gitmez
  const sh = fs.readFileSync(BATCH, 'utf8');
  const kume = /^PER_CLUSTER_KEYS="([^"]+)"/m.exec(sh);
  assert.ok(kume, 'PER_CLUSTER_KEYS yok');
  for (const k of kume[1].split(/\s+/)) {
    yeni.add(k);
    assert.ok(bat.includes(`'SCALEX_T' ~ _i ~ '_${k}'`), `${k} cluster sozlugunde kurulmuyor`);
  }
  assert.deepEqual([...yeni].sort(), [...eski].sort());
});

// ── M7 + M1: GERCEK ansible-playbook ────────────────────────────────────────
/**
 * Gorev dosyasini `paralelKostur` (scalex-cluster-paralelligi) deseniyle kosar.
 * `hosts`: kac farkli jump. 1 -> senkron yol, >1 -> async + delege async_status.
 */
function ansibleKostur({
  gorev = '10_discover_batch.yml',
  hosts = 1,
  clusters = ['c1', 'c2'],
  exitKodu = 0,
  batch,
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sx-bat-'));
  try {
    fs.mkdirSync(path.join(tmp, 'files'));
    const iz = path.join(tmp, 'iz.log');
    fs.writeFileSync(
      path.join(tmp, 'files', 'scalex_runner.sh'),
      [
        '#!/bin/bash',
        `printf 'BASLA %s\\n' "$CLUSTER" >> ${JSON.stringify(iz)}`,
        // BARIYER, uyku degil: yuk altinda jump'lar arasi baslatma gecikmesi
        // 1 sn'yi asabiliyor (tam suitte gozlendi). Her cluster OTEKILERIN
        // basladigini gorene kadar bekler; SERI kosuda bekleme tavana (20 sn)
        // vurur ve iz `BASLA c1, BITTI c1, ...` kalir -> bekci yine kizarir.
        `for _ in $(seq 1 200); do [ "$(grep -c BASLA ${JSON.stringify(iz)})" -ge ${clusters.length} ] && break; sleep 0.1; done`,
        `printf 'BITTI %s\\n' "$CLUSTER" >> ${JSON.stringify(iz)}`,
        `[ ${exitKodu} -ne 0 ] && echo 'sahte patladi' >&2`,
        'printf \'%s;%s;odeme-api;Deployment;WORKLOAD;OK;ns=%s\\n\' "$CLUSTER" "$JUMP_SERVER" "$NS"',
        `exit ${exitKodu}`,
      ].join('\n'),
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(tmp, 'files', 'scalex_batch.sh'),
      batch ?? fs.readFileSync(BATCH, 'utf8'),
    );
    const matrix = clusters.map((c, i) => ({
      cluster: c,
      jump_label: `jump-${c}`,
      physical_host: `jump-${c}`,
      runtime_host: `h${i % hosts}`,
      api_url: 'https://a:6443',
      credential: 'pw',
      tls_verify: false,
      oc_paths: ['/bin/oc'],
    }));
    const vars = {
      target_matrix: matrix,
      _disc_runner_path: path.join(tmp, 'kopya.sh'),
      discovery_async_seconds_effective: '60',
      discovery_mode_effective: 'workloads',
      username: 'uxmid',
      pw: 'gizli',
      oc_namespace: 'ns1',
      oc_namespaces_effective: ['ns1'],
      target_app_list: [],
      job_id: '1',
      scalex_cluster_kinds_effective: {},
      scalex_extra_kinds_fallback: '',
      _discovery_rows: [],
      _failed_clusters: [],
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
        '        name: "{{ item }}"',
        '        ansible_connection: local',
        '        ansible_pipelining: true',
        `        ansible_async_dir: "${tmp}/async_{{ item }}"`,
        '      loop: "{{ target_matrix | map(attribute=\'runtime_host\') | unique | list }}"',
        '    - block:',
        `        - ansible.builtin.include_tasks: ${path.join(DISC, gorev)}`,
        '        - ansible.builtin.debug:',
        '            msg: "ROWS={{ _discovery_rows | join(\'~~\') }}"',
        '        - ansible.builtin.debug:',
        '            msg: "FAILED={{ _failed_clusters | join(\',\') }}"',
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
      rows: yakala(/ROWS=(.*?)"/)
        .split('~~')
        .filter(Boolean),
      failed: yakala(/FAILED=(.*?)"/)
        .split(',')
        .filter(Boolean),
      trace: fs.existsSync(iz) ? fs.readFileSync(iz, 'utf8').split('\n').filter(Boolean) : [],
      playFailed: /PLAY_FAILED/.test(out),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const sirali = (a) => [...a].sort();

for (const hosts of [1, 2]) {
  test(
    `M7 ansible uctan uca (${hosts} jump): satirlar toplanir, cluster'lar ic ice`,
    { skip: !HAS_ANSIBLE || !HAS_TIMEOUT },
    () => {
      const r = ansibleKostur({ hosts });
      assert.ok(!r.playFailed, r.out.slice(-2500));
      assert.deepEqual(sirali(r.rows), [
        'c1;jump-c1;odeme-api;Deployment;WORKLOAD;OK;ns=ns1',
        'c2;jump-c2;odeme-api;Deployment;WORKLOAD;OK;ns=ns1',
      ]);
      assert.deepEqual(r.failed, []);
      const basla = r.trace.filter((x) => x.startsWith('BASLA'));
      assert.ok(
        r.trace.indexOf(basla[1]) < r.trace.findIndex((x) => x.startsWith('BITTI')),
        JSON.stringify(r.trace),
      );
    },
  );

  // M1: eski paralel yolla AYNI satirlar (basari ve sifir disi cikis).
  test(
    `M1 (${hosts} jump) eski paralel yolla ayni satirlar ve basarisiz liste`,
    { skip: !HAS_ANSIBLE || !HAS_TIMEOUT },
    () => {
      for (const exitKodu of [0, 3]) {
        const yeni = ansibleKostur({ hosts, exitKodu });
        const eski = ansibleKostur({ hosts, exitKodu, gorev: '10_discover_parallel.yml' });
        assert.ok(
          !yeni.playFailed && !eski.playFailed,
          `${yeni.out.slice(-1500)}\n${eski.out.slice(-1500)}`,
        );
        assert.deepEqual(sirali(yeni.rows), sirali(eski.rows), `exit=${exitKodu}`);
        assert.deepEqual(sirali(yeni.failed), sirali(eski.failed), `exit=${exitKodu}`);
      }
    },
  );

  // Sarmalayici isaret basamadan olurse (SSH koptu, iptal): cluster SESSIZCE kaybolmaz.
  test(
    `M8 (${hosts} jump) bitti isareti gelmeyen cluster tasima hatasi sayilir`,
    { skip: !HAS_ANSIBLE },
    () => {
      // Sahte sarmalayici once stdin'i TUKETIR. Gorev runner metnini stdin'den yollar; onu
      // okumadan cikan surec yuk altinda Ansible'in yazmasiyla yarisir ve sonuc `rc=5` yerine
      // `rc=32: Error executing command.` (EPIPE) olur - tam suitte ara ara kizariyordu.
      const r = ansibleKostur({ hosts, batch: 'cat >/dev/null; echo kirik >&2; exit 5' });
      assert.ok(!r.playFailed, r.out.slice(-2500));
      assert.deepEqual(sirali(r.failed), ['c1', 'c2']);
      for (const c of ['c1', 'c2']) {
        assert.ok(
          r.rows.some((x) => x.startsWith(`${c};jump-${c};-;-;RUNNER;FAIL;`) && x.includes('rc=5')),
          JSON.stringify(r.rows),
        );
      }
    },
  );
}

// ── M9: UC YOL BIRBIRINI DISLIYOR ───────────────────────────────────────────
// Iki yol ayni anda kosarsa her satir IKI KEZ toplanir.
test('M9 batch / async / serial yollari birbirini dislar', () => {
  const play = fs.readFileSync(path.join(APP, 'discovery.yml'), 'utf8');
  const kosul = (dosya) => {
    const m = new RegExp(
      `include_tasks: tasks/discovery/${dosya.replace('.', '\\.')}[\\s\\S]{0,400}?when: (.+)`,
    ).exec(play);
    assert.ok(m, `${dosya} icin when yok`);
    return m[1];
  };
  assert.match(kosul('10_discover_batch.yml'), /discovery_transport_effective == 'batch'/);
  assert.match(kosul('10_discover_parallel.yml'), /discovery_transport_effective == 'async'/);
  assert.match(kosul('10_discover.yml'), /not \(discovery_parallel_effective \| bool\)/);
  const prep = fs.readFileSync(path.join(DISC, '01_prepare.yml'), 'utf8');
  // VARSAYILAN tek tur: anahtar verilmediginde hizli yol secilir.
  assert.match(prep, /scalex_discovery_transport \| default\('batch'\)/);
  // Seri secildiginde transport ASLA batch/async olamaz.
  assert.match(
    prep,
    /discovery_transport_effective:[\s\S]{0,200}'serial' if not \(\(scalex_discovery_parallel/,
  );
});
