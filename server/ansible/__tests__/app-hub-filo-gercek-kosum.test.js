// server/ansible/__tests__/app-hub-filo-gercek-kosum.test.js - Application Hub saatlik filo playbook'u GERCEK
// ansible-playbook ile (2026-11-22, PR-R). app_hub/ gecici dizine kopyalanir; `oc` sahte bir betiktir (argv'yi,
// KUBECONFIG'i ve slot dizinini gunluge yazar); bastion yerel baglantidir, ikinci bastion ulasilamaz (127.0.0.1:1).
// CI'da Ansible kurulu degil: bu dosya gelistirici makinesinde (npm run kapi) kosar; 2.16 icin PATH'e eski surum.
//
// NEDEN: fc7678e9 (main'e PR'siz) ile gelen saatlik tarama paylasilan dizine YAZAMADIGINDA da "ok / written"
// yayinliyordu: copy eylemi modul dustugunde de `checksum` ekler, `failed_when: false` da `failed`'i siler; is yesil
// biterdi. Parola Ansible `environment:` ile uzak komut satirina (`/bin/sh -c 'OCP_PASS=...'`, -vvv ciktisi) gidiyordu;
// slot dizini ve kubeconfig tahmin edilebilir /tmp yollarindaydi; ulasilamayan bastion "oc yok" diye raporlaniyordu;
// bos / null terminal_host kimse tarafindan taranmiyordu; giris kapisi duserse sonuc hic yayinlanmiyordu. Eski AF5
// yalniz metne bakiyordu; bu dosya davranisi kilitler (core 2.21 ve 2.16'da olculdu).
//   FK1 mutlu yol: cluster ok + written, paylasilan dosya var; parola oc'ye ulasir; kosu boyunca async is dizininde
//       parola YOK (core 2.16 `command` `stdin:` dahil modul argumanlarini ~/.ansible_async/<jid>'e duz yazar; parola
//       bu yuzden tek seferlik 0600 dosyayla gider ve betik okuyunca siler); kubeconfig betigin 0700 is dizininde;
//       kosu dizini tempfile adli (is numarasindan tahmin edilemez); is bitince ikisi de silinir
//   FK2 paylasilan dosya yazilamazsa written:false, overall failed, sebep metni tasinir, is FAILED. Senaryo eski hatanin
//       SINIFI: copy MODULU duser (tarama surerken cikti dizini kaybolur; /sw dolu ya da yazma reddi ayni yol) ve eylem
//       eklentisi sonuca yine `checksum` koyar. "Hedef bir dizin" gibi eylemde erken dusen hata bu sinifi SINAMAZ.
//   FK3 ulasilamayan bastion "bastion unreachable" (oc yok DEGIL); bos ve null terminal_host ilk bastionda taranir;
//       -vvv ciktisinda parola yok
//   FK4 giris kapisi dusunce de set_stats yayinlanir (error + results [] + failed); tarama play'i kosmaz; is FAILED
//   FK5 bastionda gecici dosya silinemezse sonuc YINE yayinlanir (cleanup_errors), is sonra FAILED (eskiden tek
//       bastionda assert tum partiyi dusurur, toplayici play hic kosmazdi)
//   FK6 yazici kapida ulasilamazsa sebep yayinlanir ("writer host unreachable"; rescue ulasilamazligi yakalamaz)
//   FK7 yazici YAZMA aninda ulasilamazsa written:false (ulasilamayan dongu ogesinde `failed` yok: `is succeeded` true)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { ansiblePythonu } = require('./fixtures/python-bul.cjs');

const KAYNAK = path.join(__dirname, '..', 'playbooks', 'bmw_portal', 'app_hub');
const VAR = (komut, arg = '--version') => spawnSync(komut, [arg], { stdio: 'ignore' }).status === 0;
const ATLA = {
  skip:
    (process.platform === 'win32' && 'POSIX kabuk gerekir') ||
    (!VAR('ansible-playbook') && 'ansible-playbook yok') ||
    (!VAR('timeout') && 'timeout yok (coreutils)') ||
    (!VAR('bash') && 'bash yok'),
};
const SSH_ATLA = { skip: ATLA.skip || (!VAR('ssh', '-V') && 'ssh istemcisi yok') };
const ROOT_ATLA = {
  skip: ATLA.skip || (process.getuid?.() === 0 && 'root izin hatasi uretemez'),
};
const PAROLA = `Kosum-Parola-${crypto.randomBytes(6).toString('hex')}`;

/**
 * Gecici kopya + sahte oc. taramadaSil: tarama surerken cikti dizini silinir (FK2). kalintiBirak: oc, bu isin
 * adiyla silinemeyen bir is dizini birakir (FK5). yaziciyiKopar: tarama surerken yazici host ulasilamaz olur (FK7).
 */
function ortam({ taramadaSil = false, kalintiBirak = false, yaziciyiKopar = false } = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'apphub-filo-kosum-'));
  fs.cpSync(KAYNAK, path.join(kok, 'bmw_portal', 'app_hub'), { recursive: true });
  const gv = path.join(kok, 'bmw_openshift_jobs', 'global_variables');
  fs.mkdirSync(gv, { recursive: true });
  fs.writeFileSync(
    path.join(gv, 'credentials.yaml'),
    `ocp_username: sahte\nsahte_cred: ${PAROLA}\n`,
  );
  const gunluk = path.join(kok, 'oc.log');
  const baglanti = path.join(kok, 'wr-baglanti');
  fs.writeFileSync(baglanti, 'local');
  const podOncesi = [
    taramadaSil ? `rm -rf '${path.join(kok, 'cikti', 'run-41', 'raw')}'` : '',
    kalintiBirak
      ? 'K="/tmp/app-hub-fleet-w.$FLEET_JOB.kalinti"; mkdir -p "$K/k" && : > "$K/k/f" && chmod 500 "$K/k"'
      : '',
    yaziciyiKopar ? `echo ssh > '${baglanti}'` : '',
  ]
    .filter(Boolean)
    .map((k) => `${k}; `)
    .join('');
  const oc = path.join(kok, 'oc');
  fs.writeFileSync(
    oc,
    [
      '#!/bin/bash',
      `echo "$* KUBECONFIG=$KUBECONFIG SLOT=\${FLEET_SLOT_DIR:-}" >> '${gunluk}'`,
      'case "$1" in',
      '  login) echo "apiVersion: v1" > "$KUBECONFIG"; exit 0 ;;',
      '  get)',
      '    case "$2" in',
      "      deployment) printf 'OBJ\\tns1\\tDeployment\\tapp1\\t2\\t2\\t2\\t2\\tRollingUpdate\\t\\t2026-01-01T00:00:00Z\\n'; exit 0 ;;",
      `      pods) ${podOncesi}printf 'PODRAW\\tns1\\tReplicaSet\\tapp1-abc\\tabc\\t-\\t-\\tapp1-abc-x\\tRunning\\tn1\\tRC\\t0,\\t2026-01-01T00:00:00Z\\n'; exit 0 ;;`,
      '      *) echo "error: the server doesn\'t have a resource type \\"$2\\"" >&2; exit 1 ;;',
      '    esac ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const py = ansiblePythonu() || 'python3';
  const inv = path.join(kok, 'envanter.ini');
  fs.writeFileSync(
    inv,
    [
      `localhost ansible_connection=local ansible_python_interpreter=${py}`,
      `bast1 ansible_connection=local ansible_python_interpreter=${py}`,
      "bast2 ansible_host=127.0.0.1 ansible_port=1 ansible_connection=ssh ansible_ssh_common_args='-o ConnectTimeout=2'",
      `wr ansible_python_interpreter=${py}`,
      '',
    ].join('\n'),
  );
  // Yazici host'un baglanti turu her gorevde dosyadan okunur: oc tarama sirasinda 'ssh' yazinca ulasilamaz olur.
  fs.mkdirSync(path.join(kok, 'host_vars'));
  fs.writeFileSync(
    path.join(kok, 'host_vars', 'wr.yml'),
    [
      `ansible_connection: "{{ lookup('file', '${baglanti}') }}"`,
      'ansible_host: 127.0.0.1',
      'ansible_port: 1',
      'ansible_ssh_common_args: "-o ConnectTimeout=2"',
      '',
    ].join('\n'),
  );
  return { kok, inv, oc, gunluk };
}

/** Dizindeki dosyalarda parola var mi (async is dosyalari kosu boyunca yoklanir). */
function parolaIceren(dizin) {
  let n = 0;
  let ogeler = [];
  try {
    ogeler = fs.readdirSync(dizin);
  } catch {
    return 0;
  }
  for (const ad of ogeler) {
    try {
      if (fs.readFileSync(path.join(dizin, ad), 'utf8').includes(PAROLA)) n++;
    } catch {
      /* dosya o an silindi */
    }
  }
  return n;
}

async function oynat(o, ek = {}, bayrak = []) {
  const is = String(900000 + crypto.randomInt(99999));
  const asyncDizin = path.join(o.kok, 'async');
  const ev = {
    terminal_hosts: ['bast1'],
    ocp_clusters: [
      {
        cluster_name: 'c1',
        terminal_host: 'bast1',
        api_url: 'https://api.c1:6443',
        credential_key: 'sahte_cred',
      },
    ],
    app_hub_fleet_run: '41',
    app_hub_fleet_dir: path.join(o.kok, 'cikti'),
    app_hub_fleet_writer: 'localhost',
    oc_binary: o.oc,
    tower_job_id: is,
    app_hub_fleet_slot_wait: 30,
    app_hub_fleet_cluster_timeout: 60,
    app_hub_fleet_poll_delay: 1,
    ...ek,
  };
  const c = spawn(
    'ansible-playbook',
    [
      ...bayrak,
      '-i',
      o.inv,
      path.join(o.kok, 'bmw_portal', 'app_hub', 'app_hub_fleet.yml'),
      '-e',
      JSON.stringify(ev),
    ],
    {
      cwd: o.kok,
      env: {
        ...process.env,
        ANSIBLE_SHOW_CUSTOM_STATS: 'True',
        ANSIBLE_STDOUT_CALLBACK: 'default',
        ANSIBLE_NOCOLOR: '1',
        ANSIBLE_RETRY_FILES_ENABLED: 'False',
        ANSIBLE_HOST_KEY_CHECKING: 'False',
        ANSIBLE_ASYNC_DIR: asyncDizin,
      },
    },
  );
  let stdout = '';
  let stderr = '';
  c.stdout.on('data', (d) => (stdout += d));
  c.stderr.on('data', (d) => (stderr += d));
  let asyncSizinti = 0;
  const yokla = setInterval(() => {
    asyncSizinti = Math.max(asyncSizinti, parolaIceren(asyncDizin));
  }, 100);
  const sure = setTimeout(() => c.kill('SIGKILL'), 240000);
  const status = await new Promise((coz) => c.on('close', coz));
  clearInterval(yokla);
  clearTimeout(sure);
  asyncSizinti = Math.max(asyncSizinti, parolaIceren(asyncDizin));
  const satir = stdout.split('\n').find((s) => s.includes('RUN: {'));
  const stats = satir ? JSON.parse(satir.slice(satir.indexOf('{'))).app_hub_fleet_result : null;
  const gunluk = fs.existsSync(o.gunluk) ? fs.readFileSync(o.gunluk, 'utf8') : '';
  const kalan = fs.readdirSync('/tmp').filter((n) => n.startsWith(`app-hub-fleet-w.${is}.`));
  return { status, stdout, stderr, stats, gunluk, is, kalan, ev, asyncSizinti };
}

const kume = (stats) => Object.fromEntries((stats?.results || []).map((x) => [x.cluster, x]));

test(
  'FK1 mutlu yol: ok + written; async dosyasinda parola yok; ozel dizinler silinir',
  ATLA,
  async () => {
    const o = ortam();
    try {
      const r = await oynat(o);
      assert.equal(r.status, 0, r.stdout.slice(-3000));
      assert.equal(r.stats.overall_status, 'ok', JSON.stringify(r.stats));
      assert.deepEqual(r.stats.cleanup_errors, []);
      assert.deepEqual(
        [r.stats.results[0].ok, r.stats.results[0].written, r.stats.results[0].complete],
        [true, true, true],
      );
      const dosya = path.join(r.ev.app_hub_fleet_dir, 'run-41', 'raw', 'c1.out');
      assert.match(fs.readFileSync(dosya, 'utf8'), /@@APPHUB_FLEET_END@@/);
      assert.equal(r.asyncSizinti, 0, 'parola async is dosyasinda (ansible_async_dir)');
      const login = r.gunluk.split('\n').find((l) => l.startsWith('login '));
      assert.ok(login, r.gunluk);
      assert.ok(login.includes(`--password=${PAROLA} `), "parola oc login'e ulasmadi");
      const kc = /KUBECONFIG=(\S+)/.exec(login)[1];
      assert.match(kc, new RegExp(`^/tmp/app-hub-fleet-w\\.${r.is}\\.[A-Za-z0-9]+/kubeconfig$`));
      const slot = /SLOT=(\S*)/.exec(login)[1];
      assert.match(slot, /^\/tmp\/app-hub-fleet-slots-[A-Za-z0-9_]+$/);
      assert.notEqual(
        slot,
        `/tmp/app-hub-fleet-slots-${r.is}`,
        'kosu dizini is numarasindan tahmin edilebilir',
      );
      assert.equal(fs.existsSync(path.dirname(kc)), false, 'kubeconfig is dizini kaldi');
      assert.equal(fs.existsSync(slot), false, 'kosu dizini (slot + parola dosyasi) kaldi');
      assert.deepEqual(r.kalan, []);
    } finally {
      fs.rmSync(o.kok, { recursive: true, force: true });
    }
  },
);

test('FK2 paylasilan dosya yazilamazsa written:false, failed, sebep; is FAILED', ATLA, async () => {
  const o = ortam({ taramadaSil: true });
  try {
    const r = await oynat(o);
    assert.notEqual(r.status, 0, 'yazilamayan tarama yesil bitti');
    assert.equal(r.stats.overall_status, 'failed', JSON.stringify(r.stats));
    const c1 = r.stats.results[0];
    assert.deepEqual([c1.ok, c1.written, c1.complete], [false, false, true]);
    assert.match(
      c1.error,
      /^could not write to the shared directory: Destination directory .* does not exist/,
    );
    assert.deepEqual(r.kalan, []);
  } finally {
    fs.rmSync(o.kok, { recursive: true, force: true });
  }
});

test(
  'FK3 ulasilamayan bastion; bos / null terminal_host ilk bastionda; -vvv ciktisinda parola yok',
  SSH_ATLA,
  async () => {
    const o = ortam();
    try {
      const kayit = (ad, bast) => ({
        cluster_name: ad,
        terminal_host: bast,
        api_url: `https://api.${ad}:6443`,
        credential_key: 'sahte_cred',
      });
      const r = await oynat(
        o,
        {
          terminal_hosts: ['bast2', 'bast1'],
          ocp_clusters: [
            kayit('c1', 'bast1'),
            kayit('c2', 'bast2'),
            kayit('c3', ''),
            kayit('c4', null),
          ],
        },
        ['-vvv'],
      );
      assert.equal(r.status, 0, r.stdout.slice(-3000));
      assert.equal(r.stats.overall_status, 'partial');
      const k = kume(r.stats);
      assert.equal(k.c1.ok, true);
      assert.equal(k.c2.ok, false);
      assert.match(k.c2.error, /^bastion unreachable: \S/);
      // Siralanmis ilk bastion bast1: bos / null sahipli cluster'lar orada taranir.
      assert.deepEqual([k.c3.ok, k.c3.written, k.c4.ok, k.c4.written], [true, true, true, true]);
      assert.ok(!`${r.stdout}\n${r.stderr}`.includes(PAROLA), 'parola -vvv ciktisinda');
      assert.equal(r.asyncSizinti, 0, 'parola async is dosyasinda');
      assert.deepEqual(r.kalan, []);
    } finally {
      fs.rmSync(o.kok, { recursive: true, force: true });
    }
  },
);

test(
  'FK4 giris kapisi dusunce de sonuc yayinlanir: error + bos results + failed',
  ATLA,
  async () => {
    const o = ortam();
    try {
      const r = await oynat(o, { app_hub_fleet_dir: '/tmp/../etc' });
      assert.notEqual(r.status, 0);
      assert.ok(r.stats, 'kapi hatasinda set_stats yayinlanmadi');
      assert.equal(r.stats.overall_status, 'failed');
      assert.deepEqual(r.stats.results, []);
      assert.match(r.stats.error, /^Required variables are missing or invalid/);
      assert.equal(r.gunluk, '', 'kapi dustukten sonra tarama kostu');
    } finally {
      fs.rmSync(o.kok, { recursive: true, force: true });
    }
  },
);

test('FK5 gecici dosya silinemezse sonuc yine yayinlanir, is sonra FAILED', ROOT_ATLA, async () => {
  const o = ortam({ kalintiBirak: true });
  let kalinti = null;
  try {
    const r = await oynat(o);
    kalinti = `/tmp/app-hub-fleet-w.${r.is}.kalinti`;
    assert.notEqual(r.status, 0, 'silinemeyen gecici dosyaya ragmen is yesil');
    assert.ok(r.stats, 'temizlik hatasinda set_stats yayinlanmadi');
    assert.equal(r.stats.overall_status, 'ok', 'tarama sonucu kayboldu');
    assert.equal(r.stats.results[0].written, true);
    assert.equal(r.stats.cleanup_errors.length, 1, JSON.stringify(r.stats.cleanup_errors));
    assert.match(
      r.stats.cleanup_errors[0],
      new RegExp(
        `^bast1: temporary credential, script or run files could not be removed: .*${r.is}\\.kalinti`,
      ),
    );
  } finally {
    if (kalinti && fs.existsSync(`${kalinti}/k`)) fs.chmodSync(`${kalinti}/k`, 0o700);
    if (kalinti) fs.rmSync(kalinti, { recursive: true, force: true });
    fs.rmSync(o.kok, { recursive: true, force: true });
  }
});

test('FK6 yazici kapida ulasilamazsa sebep yayinlanir', SSH_ATLA, async () => {
  const o = ortam();
  try {
    const r = await oynat(o, { app_hub_fleet_writer: 'bast2' });
    assert.notEqual(r.status, 0);
    assert.ok(r.stats, 'yazici ulasilamazken set_stats yayinlanmadi');
    assert.equal(r.stats.overall_status, 'failed');
    assert.match(r.stats.error, /^writer host unreachable: bast2 - \S/);
    assert.equal(r.gunluk, '', 'kapi dustukten sonra tarama kostu');
  } finally {
    fs.rmSync(o.kok, { recursive: true, force: true });
  }
});

test('FK7 yazici yazma aninda ulasilamazsa written:false', SSH_ATLA, async () => {
  const o = ortam({ yaziciyiKopar: true });
  try {
    const r = await oynat(o, { app_hub_fleet_writer: 'wr' });
    assert.notEqual(r.status, 0, 'yazilamayan tarama yesil bitti');
    assert.equal(r.stats.overall_status, 'failed', JSON.stringify(r.stats));
    const c1 = r.stats.results[0];
    assert.deepEqual([c1.ok, c1.written], [false, false]);
    assert.match(c1.error, /^could not write to the shared directory/);
  } finally {
    fs.rmSync(o.kok, { recursive: true, force: true });
  }
});
