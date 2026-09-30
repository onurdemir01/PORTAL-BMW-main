// server/ansible/__tests__/scalex-cluster-paralelligi.test.cjs
//
// CLUSTER PARALELLIGI (PR-F) — DAVRANISSAL.
//
// Bu tur planda "risk: YUKSEK" isaretliydi ve iki varsayimi vardi; IKISI DE
// OLCULDU ve BIRI YANLIS CIKTI:
//
//   1. "`script` gorevi `async` alir"  -> YANLIS.
//      "This action (ansible.builtin.script) does not support async."
//      Bu yuzden betik once jump sunucusuna KOPYALANIR, `shell` ile async
//      baslatilir ve sonda SILINIR.
//
//   2. "`async_status` delege edilmezse 'job not found' ile DUSER" -> YANLIS.
//      Olculen sonuc: `finished: true`, `msg: "could not find job"`,
//      `stdout_lines: []`. Yani `until: finished` ANINDA gecer ve is BASARILI
//      gorunur; `rc` HIC GELMEZ. Sadece `finished`/`rc` degerine bakan bir
//      toplama, TUM cluster'lari sessizce BOS dondururdu.
//
// Bu yuzden asagidaki bekciler hem "paralel calisiyor mu" hem de "delegasyon
// bozulursa GURULTULU dusuyor mu" sorusunu GERCEK `ansible-playbook` ile sorar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { SCALEX_PKG: PKG } = require('../paths.cjs');
const APP = path.join(PKG, 'scalex_app');
const DISC = path.join(APP, 'tasks', 'discovery');

const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;

// CI'DA ATLAMA SESSIZ OLMASIN (VT0/CK0 ile ayni gerekce).
test('PF0 CI`da ansible KURULU (PF ailesi sessizce atlanmasin)', () => {
  if (process.env.CI !== 'true') return;
  assert.ok(HAS_ANSIBLE, 'CI=true ama `ansible-playbook` yok — PF ailesi kosmuyor.');
});

/**
 * `10_discover_parallel.yml`i GERCEKTEN kosturur.
 *
 * `playbook_dir` bir MAGIC degisken ve set edilemez; gorev dosyasi betigi
 * `{{ playbook_dir }}/files/scalex_runner.sh` yolundan kopyaliyor. Bu yuzden
 * gecici dizine `files/` altinda SAHTE bir runner konur ve play ORADA kosar —
 * uretim kodunda test icin bir dikis acmadan.
 *
 * Jump sunucularini taklit etmek icin `add_host` ile YEREL takma adlar kurulur
 * ve her birine AYRI `ansible_async_dir` verilir: gercek hayatta async is
 * dosyalari delege edilen host'ta durur, burada da oyle.
 */
function paralelKostur({
  delegasyon = true,
  clusters = ['c1', 'c2'],
  sleepSaniye = 2,
  asyncSaniye = 60,
  exitKodu = 0,
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-pf-'));
  try {
    fs.mkdirSync(path.join(tmp, 'files'));
    const iz = path.join(tmp, 'iz.log');
    // KOPYALANAN BETIGIN YOLU GECICI DIZINDE: silinip silinmedigi olculebilsin
    // (uretimde `/tmp/scalex_runner_<job_id>.sh`).
    const runnerYolu = path.join(tmp, 'kopyalanan_runner.sh');
    // SAHTE RUNNER: giris/cikis izi birakir ve gercek satir bicimini basar.
    fs.writeFileSync(
      path.join(tmp, 'files', 'scalex_runner.sh'),
      [
        '#!/bin/bash',
        `printf 'BASLA %s\\n' "$CLUSTER" >> ${JSON.stringify(iz)}`,
        `sleep ${sleepSaniye}`,
        `printf 'BITTI %s\\n' "$CLUSTER" >> ${JSON.stringify(iz)}`,
        'printf \'%s;%s;odeme-api;Deployment;WORKLOAD;OK;namespace=ns1 resource=deployments.apps scalable=yes spec=3 status=3 ready=3\\n\' "$CLUSTER" "$JUMP_SERVER"',
        `exit ${exitKodu}`,
      ].join('\n'),
      { mode: 0o755 },
    );

    let gorevDosyasi = path.join(DISC, '10_discover_parallel.yml');
    if (!delegasyon) {
      // TUZAGI YENIDEN URET: `async_status`un `delegate_to` satirini KALDIR.
      // Gercek hayatta bu, "toplama yanlis host'ta kosuyor" halidir.
      const src = fs.readFileSync(gorevDosyasi, 'utf8');
      const bozuk = src.replace(
        '  delegate_to: "{{ item.item.runtime_host }}"\n',
        '  # DELEGASYON BILEREK KALDIRILDI (bekci)\n',
      );
      assert.notEqual(bozuk, src, '`async_status` delegasyonu bulunamadi — bekci kendi hedefini kaybetti');
      gorevDosyasi = path.join(tmp, 'bozuk.yml');
      fs.writeFileSync(gorevDosyasi, bozuk);
    }

    const matrix = clusters.map((c) => ({
      cluster: c,
      jump_label: `jump-${c}`,
      physical_host: `jump-${c}`,
      runtime_host: `pf_${c}`,
      api_url: 'https://a:6443',
      credential: 'pf_sifre',
      tls_verify: false,
      oc_paths: ['/bin/oc'],
    }));

    const vars = {
      target_matrix: matrix,
      _disc_runner_path: runnerYolu,
      discovery_async_seconds_effective: asyncSaniye,
      discovery_mode_effective: 'workloads',
      username: 'uxmid',
      pf_sifre: 'gizli',
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
        // Jump sunucusu takma adlari: AYRI async dizini (gercek host gibi).
        '    - ansible.builtin.add_host:',
        '        name: "{{ item.runtime_host }}"',
        '        ansible_connection: local',
        `        ansible_async_dir: "${tmp}/async_{{ item.cluster }}"`,
        '      loop: "{{ target_matrix }}"',
        '    - block:',
        `        - ansible.builtin.include_tasks: ${gorevDosyasi}`,
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
      env: { ...process.env, ANSIBLE_LOCALHOST_WARNING: 'False', ANSIBLE_DEPRECATION_WARNINGS: 'False' },
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    // `|| [, '']` SEYREK DIZI uretiyordu (lint hatasi). Eslesme yoksa BOS dizi
    // dondurmek hem okunur hem de "eslesmedi" ile "bos eslesti" ayrimini korur:
    // eslesmezse satir listesi bos kalir ve testin assert'i sebebi yazar.
    const yakala = (re) => {
      const m = re.exec(out);
      return m ? m[1] : '';
    };
    const rows = yakala(/ROWS=(.*?)"/).split('~~').filter(Boolean);
    const failed = yakala(/FAILED=(.*?)"/).split(',').filter(Boolean);
    const trace = fs.existsSync(iz) ? fs.readFileSync(iz, 'utf8').split('\n').filter(Boolean) : [];
    const kopyaKaldi = fs.existsSync(runnerYolu);
    return { out, rows, failed, trace, kopyaKaldi, playFailed: /PLAY_FAILED/.test(out) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── PF1: CLUSTER'LAR GERCEKTEN AYNI ANDA KOSUYOR ────────────────────────────
//
// SURE OLCULMUYOR — BILEREK. Bir duvar saati esigi makinenin yukunu olcer
// (PD1'de tam bu tuzaga dusuldu). Olcut IC ICE GECME: ikinci cluster'in
// BASLAMASI, birincinin BITMESINDEN once gorunmus olmali. Seri kosuda iz
// `BASLA c1, BITTI c1, BASLA c2, BITTI c2` olur ve bu tutmaz.
test('PF1 cluster`lar AYNI ANDA kosuyor (ic ice gecme)', { skip: !HAS_ANSIBLE }, () => {
  const r = paralelKostur();
  assert.ok(!r.playFailed, `play dustu:\n${r.out.slice(-2500)}`);
  assert.equal(r.trace.filter((x) => x.startsWith('BASLA')).length, 2, `iz: ${JSON.stringify(r.trace)}`);
  assert.equal(r.trace.filter((x) => x.startsWith('BITTI')).length, 2, `iz: ${JSON.stringify(r.trace)}`);
  const ikinciBasla = r.trace.lastIndexOf(r.trace.filter((x) => x.startsWith('BASLA')).pop());
  const ilkBitti = r.trace.findIndex((x) => x.startsWith('BITTI'));
  assert.ok(
    ikinciBasla < ilkBitti,
    `cluster'lar SERI kosuyor (biri bitmeden oteki baslamamis): ${JSON.stringify(r.trace)}`,
  );
});

// ── PF2: SONUC GERILEMEDI ───────────────────────────────────────────────────
// Hizlanma, satirlari kaybederek elde edilmis olmasin.
test('PF2 her cluster`in satirlari toplaniyor', { skip: !HAS_ANSIBLE }, () => {
  const r = paralelKostur();
  assert.equal(r.rows.length, 2, `satirlar: ${JSON.stringify(r.rows)}`);
  for (const c of ['c1', 'c2']) {
    assert.ok(
      r.rows.some((x) => x.startsWith(`${c};jump-${c};odeme-api;`)),
      `${c} satiri yok: ${JSON.stringify(r.rows)}`,
    );
  }
  assert.deepEqual(r.failed, [], `basarisiz cluster yok beklenirdi: ${JSON.stringify(r.failed)}`);
});

// ── PF3: EN KRITIK — DELEGASYON BOZULURSA GURULTULU DUSER ───────────────────
//
// OLCULEN GERCEK: `async_status` yanlis host'ta kosunca `finished: true` ve
// `msg: "could not find job"` doner, `rc` HIC GELMEZ ve `stdout_lines` BOStur.
// Yani `until: finished` gecer, is BASARILI gorunur. Plan bunun "job not found"
// ile dusecegini varsayiyordu — DUSMUYOR.
//
// Bu yuzden toplama `rc` alaninin VARLIGINI soruyor. Bu bekci o kurali kilitler:
// delegasyon kaldirildiginda cluster'lar SESSIZCE bos donmez, FAIL raporlanir.
test('PF3 delegasyon kaldirilirsa cluster`lar SESSIZCE degil FAIL ile duser', { skip: !HAS_ANSIBLE }, () => {
  const r = paralelKostur({ delegasyon: false });
  assert.ok(!r.playFailed, `play dustu:\n${r.out.slice(-2500)}`);
  // Her cluster BASARISIZ listesinde olmali.
  assert.deepEqual(
    [...r.failed].sort(),
    ['c1', 'c2'],
    `delegasyon bozukken cluster'lar sessizce kayboldu — failed=${JSON.stringify(r.failed)} rows=${JSON.stringify(r.rows)}`,
  );
  // Ve sebep SATIR OLARAK yaziliyor: portal `problems[]` ile gosterir.
  assert.ok(
    r.rows.filter((x) => /;RUNNER;FAIL;/.test(x)).length === 2,
    `FAIL satirlari yok: ${JSON.stringify(r.rows)}`,
  );
});

// ── PF4: ZAMAN ASIMI DA GURULTULU ───────────────────────────────────────────
//
// MUTASYON TURUNDA BULUNDU: `finished` kontrolunu kaldirmak hicbir bekciyi
// kizartmiyordu. Delegasyon tuzaginda `finished` ZATEN true doner (PF3), yani o
// kontrol baska bir sinifi koruyor: yoklama TUKENDIGI halde is HALA KOSUYOR.
// Bu halde `rc` de gelmez ama sebebi FARKLI — ve kontrol kalkarsa cluster
// SESSIZCE bos doner.
test('PF4 yoklama tukenirse (is hala kosuyor) cluster FAIL ile duser', { skip: !HAS_ANSIBLE }, () => {
  // Async butcesi 3 sn -> `retries = 1`, `delay = 3`. Betik 12 sn uyur, yani ILK
  // yoklamada is BITMEMISTIR ve yoklama TUKENIR.
  const r = paralelKostur({ clusters: ['c1'], sleepSaniye: 12, asyncSaniye: 3 });
  assert.ok(!r.playFailed, `play dustu:\n${r.out.slice(-2000)}`);
  assert.deepEqual(
    r.failed,
    ['c1'],
    `bitmemis is basarili sayildi — failed=${JSON.stringify(r.failed)} rows=${JSON.stringify(r.rows)}`,
  );
  assert.equal(
    r.rows.filter((x) => /;RUNNER;FAIL;/.test(x)).length,
    1,
    `FAIL satiri yok: ${JSON.stringify(r.rows)}`,
  );
});

// ── PF5: KOPYALANAN BETIK SILINIYOR ─────────────────────────────────────────
//
// `ansible.builtin.script` kopya BIRAKMIYORDU; `copy` + `shell` birakir. Jump
// sunucularinda biriken kopyalar hem cop hem de "hangi surum kosuyor" sorusunu
// bulandiran bir iz. Silme ATLANIRSA bu bekci kizarir.
test('PF5 kopyalanan betik SONDA siliniyor', { skip: !HAS_ANSIBLE }, () => {
  const r = paralelKostur({ clusters: ['c1'] });
  assert.ok(!r.playFailed, `play dustu:\n${r.out.slice(-2000)}`);
  assert.equal(r.kopyaKaldi, false, 'kopyalanan betik jump sunucusunda KALDI');
  // Ve kopyalama GERCEKTEN yapilmis olmali: silme testini, kopyalamayi silerek
  // gecmek mumkun olmasin.
  assert.equal(r.rows.length, 1, `betik kosmamis: ${JSON.stringify(r.rows)}`);
});

// ── PF6: PARALEL ve SERI YOL BIRBIRINI DISLIYOR ─────────────────────────────
//
// DURUST NOT — BU BIR METIN BEKCISI. `discovery.yml`in tamamini yerel kosturmak
// cluster katalogu, vault kimlikleri ve SSH `add_host` gerektiriyor; bu kutuk
// gorev dosyasini DOGRUDAN kosturuyor. Yine de kilitleniyor, cunku iki yolun
// AYNI ANDA kosmasi her satiri IKI KEZ toplamak demek: `_discovery_rows`
// ciftlenir ve ekran her uygulamayi iki kez gosterir.
test('PF6 paralel ve seri yol AYNI ANDA kosamaz', () => {
  const play = fs.readFileSync(path.join(APP, 'discovery.yml'), 'utf8');
  const par = /10_discover_parallel\.yml[\s\S]{0,400}?when: (.+)/.exec(play);
  const ser = /include_tasks: tasks\/discovery\/10_discover\.yml[\s\S]{0,400}?when: (.+)/.exec(play);
  assert.ok(par, 'paralel yolun `when` kosulu yok — her zaman kosar');
  assert.ok(ser, 'seri yolun `when` kosulu yok — her zaman kosar');
  assert.match(par[1], /discovery_parallel_effective \| bool/);
  assert.match(ser[1], /not \(discovery_parallel_effective \| bool\)/);
  // PLAY SAYISI 1'DE KALMALI: ikinci bir play `vars:` kapsamini TASIMAZ (TUZAK 3/4).
  assert.equal((play.match(/^- name:/gm) || []).length, 1, 'play sayisi 1 degil');
});

// ── PF7: BETIK SIFIR DISI CIKARSA CLUSTER FAIL ──────────────────────────────
//
// MUTASYON TURUNDA BULUNDU: `rc != 0` dalini kaldirmak hicbir bekciyi
// kizartmiyordu. PF4 (yoklama tukendi) `rc` HIC TASIMIYOR, yani o dali
// sinamiyor; bu ayri bir yol.
//
// Runner sozlesmesi "is hatalari SATIRLA bildirilir, surec 0 doner" diyor — ama
// betik CALISTIRILAMAZSA (kopya bozuk, izin yok, kabuk yok) `shell` sifir disi
// doner. O halde satirlar gelse bile cluster GUVENILMEZ: seri yol da ayni kurali
// uyguluyor (`10_discover.yml`).
test('PF7 betik sifir disi cikarsa cluster FAIL (satir gelse bile)', { skip: !HAS_ANSIBLE }, () => {
  const r = paralelKostur({ clusters: ['c1'], exitKodu: 3 });
  assert.ok(!r.playFailed, `play dustu:\n${r.out.slice(-2000)}`);
  assert.deepEqual(
    r.failed,
    ['c1'],
    `sifir disi cikan is basarili sayildi — failed=${JSON.stringify(r.failed)} rows=${JSON.stringify(r.rows)}`,
  );
  assert.ok(
    r.rows.some((x) => /;RUNNER;FAIL;/.test(x)),
    `FAIL satiri yok: ${JSON.stringify(r.rows)}`,
  );
  // Ve betigin GERCEKTEN kostugunun kaniti: kendi satiri da toplanmis olmali.
  // Aksi halde bu test, betigi hic kosturmadan da gecerdi.
  assert.ok(
    r.rows.some((x) => x.startsWith('c1;jump-c1;odeme-api;')),
    `betik kosmamis: ${JSON.stringify(r.rows)}`,
  );
});
