// server/ansible/__tests__/spa-package-install.test.js - SPI1..SPI40 (2026-11-23).
//
// Intranet SPA paket kurulumu (bmw_portal/spa_package_install): Artifactory'deki paketi ve OCP
// ConfigMap'indeki application.json'u PROD intranet Nginx sunucusuna ILK KEZ kurar.
//
// Kilitler:
//   * Playbook: '#' yorum yok, '{{ }}' icinde kacisli tirnak yok, gorev adlari Ingilizce ASCII,
//     set_stats son fail'den once, host play'i www + dzdo + ignore_unreachable, kimlik / ConfigMap
//     gorevleri no_log, girdi kapisi (mod, 1..10 kalem, 1..8 sunucu, izinli sunucu alt kumesi,
//     regex'ler, https paket koku), kurum degeri varsayilani YOK, erisilemeyen bastion tek hata.
//   * spa_package_host.sh (GERCEK bash, sahte HYSUXSCRIPTS / curl / unzip): plan hicbir sey
//     yazmaz, kurulu hedefin ya da var olan paket dizininin uzerine yazilmaz (SKIP), Content-Type
//     ve yazilabilirlik denetimi, indirme / zip hatasinda yalniz betigin yazdiklari silinir,
//     kurulumdan once hedef yeniden denetlenir, nginx_delete.sh yalniz hedef bu kosununsa cagrilir,
//     mutlu yolda betik sirasi ve 7 arguman + job_no; her yolda tek ve son satir RESULT.
//   * spa_package_ocp.sh (GERCEK bash, sahte oc): replikasi en buyuk workload, volume'lardan tek
//     ConfigMap, 0 -> etiket yedegi, >1 -> ERR, Secret hic okunmaz, kosuya ozel gecici dizin
//     silinir, gecersiz girdide oc hic cagrilmaz.
//   * spa_package_merge.py (GERCEK python): imaj yolu / digest / etiket == surum / application.json
//     nesne ve boyut kurallari (python yoksa KOSMADI diye atlanir).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BASH, BASH_SURUM, posixYol } = require('./fixtures/kabuk.cjs');
const { adaylar } = require('./fixtures/python-bul.cjs');

const DIR = path.join(__dirname, '..', 'playbooks', 'bmw_portal', 'spa_package_install');
const PLAYBOOK = path.join(DIR, 'spa_package_install.yml');
const HOST_SH = path.join(DIR, 'files', 'spa_package_host.sh');
const OCP_SH = path.join(DIR, 'files', 'spa_package_ocp.sh');
const MERGE_PY = path.join(DIR, 'files', 'spa_package_merge.py');
const PB = fs.readFileSync(PLAYBOOK, 'utf8');

const TIMEOUT_VAR =
  spawnSync(BASH, ['-c', 'timeout 1 true && base64 --version >/dev/null && echo ok'], {
    encoding: 'utf8',
  }).stdout === 'ok\n';
const SKIP = (() => {
  if (TIMEOUT_VAR && BASH_SURUM >= 4) return false;
  return 'bash 4+ / timeout / base64 bulunamadi (Git Bash gerekir) - SPA paket betik davranis bekcileri KOSMADI';
})();

const NS = 'musteri-gelir-prod';
const APP = 'gelir-app-v0';
const VER = '0.8.0-68-prod';
const JOB = '424242';
const URL = `https://repo.invalid/artifactory/ark-binaries/${NS}/${APP}/${VER}.zip`;
const APPJSON = '{"apiUrl":"https://api.invalid","flag":true}';
const B64 = Buffer.from(APPJSON).toString('base64');

// -- Playbook metni -------------------------------------------------------------------------------

/** Play'leri `- name:` ile baslayan kok ogelere boler. */
function plays() {
  return PB.split(/\n(?=- name: )/).filter((p) => p.startsWith('- name: '));
}

/** Bir gorevin metni (adiyla). Gorev bloklari `- name: "<ad>"` ile baslar. */
function gorev(ad) {
  const i = PB.indexOf(`- name: "${ad}"`);
  assert.ok(i >= 0, `gorev yok: ${ad}`);
  const geri = PB.slice(i + 1);
  const j = geri.search(/\n\s*- name: /);
  return j < 0 ? geri : geri.slice(0, j);
}

test("SPI1 playbook: '#' yorum satiri yok, kacisli tirnak yok", () => {
  const yorumlu = PB.split('\n').filter((l) => /^\s*#/.test(l));
  assert.deepEqual(yorumlu, [], "playbook'ta # yorum satiri var");
  assert.ok(!PB.includes('\\"'), "'{{ }}' icinde ya da YAML'da kacisli tirnak var");
});

test('SPI2 playbook: play ve gorev adlari Ingilizce ASCII', () => {
  const adlar = [...PB.matchAll(/^\s*- name: "([^"]*)"/gm)].map((m) => m[1]);
  assert.ok(adlar.length > 30, `beklenenden az ad: ${adlar.length}`);
  const turkce =
    /\b(ve|icin|basina|sonuc|sonuclari|girdi|kapisi|hata|kalem|sunucu|betik|dogrula|yayinla|temizlik|kopyasi)\b/i;
  for (const ad of adlar) {
    assert.match(ad, /^[\x20-\x7e]+$/, `ASCII olmayan ad: ${ad}`);
    assert.ok(!turkce.test(ad), `Turkce ad: ${ad}`);
  }
});

test('SPI3 playbook: set_stats son fail gorevinden ONCE ve kosulsuz', () => {
  const iStats = PB.indexOf('ansible.builtin.set_stats');
  const iFail = PB.lastIndexOf('ansible.builtin.fail');
  assert.ok(iStats > 0 && iFail > iStats, 'set_stats son fail oncesinde degil');
  assert.match(PB, /spa_package_install_result:/);
  const stats = gorev('spa_package_install_result is published');
  assert.ok(!/\n\s+when:/.test(stats), 'set_stats kosullu');
  assert.ok(!/zip_url/.test(stats), 'zip_url yayinlaniyor');
});

test('SPI4 playbook: Nginx play www + dzdo, ignore_unreachable; erisilemeyen host FAIL', () => {
  const nginx = plays().find((p) => /hosts: spi_nginx/.test(p));
  assert.ok(nginx, 'spi_nginx play yok');
  assert.match(nginx, /\n {2}ignore_unreachable: true\n/);
  assert.match(nginx, /\n {2}become: true\n/);
  assert.match(nginx, /\n {2}become_user: www\n/);
  assert.match(nginx, /\n {2}become_method: dzdo\n/);
  assert.match(nginx, /unreachable/);
  const bastion = plays().find((p) => /hosts: spi_terminal/.test(p));
  assert.match(bastion, /\n {2}ignore_unreachable: true\n/);
  assert.match(bastion, /\n {2}become: false\n/);
  const son = plays().at(-1);
  assert.match(son, /clear_host_errors/);
  assert.match(son, /step: unreachable/);
});

test('SPI5 playbook: kimlik ve ConfigMap iceren gorevler no_log', () => {
  const zorunlu = [
    'Cluster connection details',
    'Read image and application.json per item',
    'Bastion results',
    'Merge input per item',
    'Merge OCP results',
    'Merged items',
    'Final item state',
    'Run the host script per item',
  ];
  for (const ad of zorunlu) assert.match(gorev(ad), /\n\s+no_log: true/, `no_log eksik: ${ad}`);
  for (const blok of PB.split(/\n\s*- name: /)) {
    if (/resolved_password:|OCP_PASS:|appjson_b64|spi_appjson\[/.test(blok)) {
      assert.match(blok, /no_log: true/, `no_log eksik: ${blok.slice(0, 60)}`);
    }
  }
});

test('SPI6 playbook: girdi kapisi assert kurallari', () => {
  const kapi = plays()[0];
  const beklenen = [
    "spi_mode in ['plan', 'apply']",
    'spi_items | length >= 1',
    'spi_items | length <= 10',
    'item.hosts | length >= 1',
    'item.hosts | length <= 8',
    "difference(spi_allowed_hosts | map('string') | map('upper') | list) | length) == 0",
    "is match('^https://[!-~]+$')",
    "spi_ns_re: '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$'",
    "spi_app_re: '^[A-Za-z0-9]([-A-Za-z0-9._]*[A-Za-z0-9])?$'",
    "spi_ver_re: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'",
    "spi_host_re: '^[A-Z0-9-]{3,32}$'",
    "is match('^[0-9]{1,18}$')",
    "item.id == (item.namespace ~ '/' ~ item.application)",
  ];
  for (const b of beklenen) assert.ok(kapi.includes(b), `girdi kapisinda yok: ${b}`);
  assert.match(kapi, /ansible\.builtin\.assert[\s\S]*add_host/, 'add_host kapidan once');
});

test('SPI7 playbook: kurum degerinin varsayilani yok, sabit adres / sunucu yok', () => {
  for (const m of PB.matchAll(/spi_package_base_url \| default\(([^)]*)\)/g))
    assert.equal(m[1], "'', true", `spi_package_base_url varsayilani: ${m[1]}`);
  for (const m of PB.matchAll(/spi_allowed_hosts[^|\n]*\| default\(([^)]*)\)/g))
    assert.equal(m[1], '[], true', `spi_allowed_hosts varsayilani: ${m[1]}`);
  assert.ok(!/https:\/\/[a-z0-9]/i.test(PB), 'playbookta sabit https adresi');
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(PB), 'playbookta IP');
});

test('SPI8 playbook: gecici dosya, sha1 dogrulama, timeout -k, kubeconfig deseni', () => {
  assert.match(PB, /prefix: \.spa_package_ocp\./);
  assert.match(PB, /prefix: \.spa_package_host\./);
  assert.equal((PB.match(/checksum_algorithm: sha1/g) || []).length, 3);
  assert.match(PB, /timeout -k 10 300 bash/);
  assert.match(PB, /timeout -k 10 \{\{ spi_run_timeout \}\} bash/);
  assert.match(PB, /SPI_RUN_PREFIX: "\/tmp\/spa-pkg-\{\{ spi_job \}\}-\{\{ spi_idx \}\}"/);
  assert.ok(!/KUBECONFIG/.test(PB), 'playbook kubeconfig yolunu kendisi veriyor');
  assert.equal((PB.match(/patterns: "spa-pkg-\{\{ spi_job \}\}-\*"/g) || []).length, 2);
  assert.match(gorev('Remove run directories'), /state: absent/);
  assert.match(gorev('Host fails when temporary files remain'), /spi_run_dirs_after\.matched/);
  assert.match(gorev('Remove the script'), /state: absent/);
  assert.match(PB, /Host fails when temporary files remain/);
  assert.match(PB, /Host fails when the script remains/);
  assert.match(
    PB,
    /- \.\.\/\.\.\/bmw_openshift_jobs\/global_variables\/credentials\.yaml/,
    'kimlik dosyasi derinlik 1 ile aranmiyor',
  );
});

test('SPI9 playbook: application.json stdin ile gider (ortam degiskeni degil)', () => {
  const kos = gorev('Run the host script per item');
  assert.match(kos, /stdin: "\{\{ hostvars\['localhost'\]\.spi_appjson\[item\.id\]/);
  assert.ok(!/APPJSON/.test(kos), 'application.json ortam degiskeniyle gidiyor');
  assert.match(kos, /SPI_JOB_NO: "\{\{ hostvars\['localhost'\]\.spi_job_no \}\}"/);
});

// -- spa_package_host.sh --------------------------------------------------------------------------

const SAHTE_NGINX = [
  '#!/bin/bash',
  'n=$(basename "$0" .sh); n=${n#nginx_}',
  'printf \'%s %s %s\\n\' "nginx_${n}.sh" "$#" "$*" >> "$CALLS"',
  'rcvar="FAKE_RC_${n}"; rc=${!rcvar:-0}',
  'case "$n" in',
  '  unzip)',
  '    [ -n "${FAKE_UNZIP_NODIR:-}" ] && exit "$rc"',
  '    mkdir -p "$SPI_APP_ROOT/$2/$3"; printf \'%s\\n\' "${FAKE_UNZIP_VERSION:-$4}" > "$SPI_APP_ROOT/$2/$3/.version"',
  '    [ -n "${FAKE_FOREIGN_BACKUP:-}" ] && mkdir -p "$SPI_APP_ROOT/$2/$3_${FAKE_FOREIGN_BACKUP}" ;;',
  '  configuration)',
  '    mkdir -p "$SPI_CONF_DIR/application-confs"',
  '    { echo "server {"; echo "listen 192.0.2.10:443 ssl;"; echo "server_name $3-$2.apps.invalid;"; echo "include ${FAKE_CONF_INCLUDE:-$SPI_CONF_DIR/application-confs/$3-$2.conf};"; echo "}"; } > "$SPI_CONF_DIR/$3-$2.conf"',
  '    echo "location / { root ${FAKE_CONF_ROOT:-$SPI_APP_ROOT/$2/$3/}; }" > "$SPI_CONF_DIR/application-confs/$3-$2.conf" ;;',
  '  delete) rm -rf "$SPI_APP_ROOT/$1/$2" "$SPI_HYS_ROOT/$1/$2" "$SPI_CONF_DIR/$2-$1.conf" "$SPI_CONF_DIR/application-confs/$2-$1.conf" ;;',
  'esac',
  'exit "$rc"',
  '',
].join('\n');

const SAHTE_CURL = [
  '#!/bin/bash',
  'echo "curl $*" >> "$CALLS"',
  'out=""; head=0; w=""',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    -sSI) head=1 ;;',
  '    -o) out="$2"; shift ;;',
  '    -w) w="$2"; shift ;;',
  '    --max-time|--max-redirs|--proto|--proto-redir|--max-filesize|--resolve) shift ;;',
  '  esac',
  '  shift',
  'done',
  'if [ $head = 1 ]; then',
  '  [ "${FAKE_HEAD_RC:-0}" = 0 ] || exit "$FAKE_HEAD_RC"',
  '  printf \'HTTP/1.1 %s X\\r\\nContent-Length: %s\\r\\n\' "${FAKE_HEAD_CODE:-200}" "${FAKE_CL:-2048}"',
  '  [ "${FAKE_CT-application/zip}" = - ] || printf \'Content-Type: %s\\r\\n\' "${FAKE_CT-application/zip}"',
  "  printf '\\r\\n'",
  '  exit 0',
  'fi',
  'if [ -n "$w" ]; then printf \'%s\' "${FAKE_VERIFY_CODE:-200}"; exit 0; fi',
  'if [ "${FAKE_DL_RC:-0}" != 0 ]; then printf partial > "$out"; exit "$FAKE_DL_RC"; fi',
  'printf PKfake > "$out"',
  '[ -n "${FAKE_DL_ALSO:-}" ] && printf foreign > "$(dirname "$out")/$FAKE_DL_ALSO"',
  '[ -n "${FAKE_DL_MKDIR:-}" ] && mkdir -p "$FAKE_DL_MKDIR"',
  'exit 0',
  '',
].join('\n');

const SAHTE_UNZIP = [
  '#!/bin/bash',
  'echo "unzip $*" >> "$CALLS"',
  'case "$1" in',
  '  -tq) exit "${FAKE_UNZIP_T_RC:-0}" ;;',
  '  -Z1) for f in ${FAKE_ZIP_LIST:-index.html main.js assets/a.css}; do echo "$f"; done ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

const BETIKLER = [
  'pre_deployment',
  'unzip',
  'configuration',
  'syntax_check',
  'reload',
  'cleanup_backup',
  'delete',
];

function yaz(dosya, icerik) {
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  fs.writeFileSync(dosya, icerik, { mode: 0o755 });
}

/** Sahte sunucu agaci: HYSUXSCRIPTS, /hysdeploy, /usr/nginx, curl, unzip. */
function sahteSunucu(eksik = []) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-pkg-host-'));
  const d = {
    kok,
    scripts: path.join(kok, 'HYSUXSCRIPTS'),
    hys: path.join(kok, 'hysdeploy'),
    apps: path.join(kok, 'applications'),
    conf: path.join(kok, 'conf.d'),
    calls: path.join(kok, 'calls.txt'),
    curl: path.join(kok, 'bin', 'curl'),
    unzip: path.join(kok, 'bin', 'unzip'),
  };
  for (const b of BETIKLER)
    if (!eksik.includes(b)) yaz(path.join(d.scripts, `nginx_${b}.sh`), SAHTE_NGINX);
  for (const x of [d.hys, d.apps, d.conf]) fs.mkdirSync(x, { recursive: true });
  yaz(d.curl, SAHTE_CURL);
  yaz(d.unzip, SAHTE_UNZIP);
  fs.writeFileSync(d.calls, '');
  return d;
}

/** Betigi kosturur; RESULT satirini ve cagrilari dondurur. */
function hostKos(d, env = {}, stdin = B64) {
  const r = spawnSync(BASH, [posixYol(HOST_SH)], {
    encoding: 'utf8',
    input: stdin,
    env: {
      ...process.env,
      SPI_MODE: 'apply',
      SPI_NS: NS,
      SPI_APP: APP,
      SPI_VERSION: VER,
      SPI_JOB_NO: JOB,
      SPI_ZIP_URL: URL,
      SPI_SCRIPTS_DIR: posixYol(d.scripts),
      SPI_HYS_ROOT: posixYol(d.hys),
      SPI_APP_ROOT: posixYol(d.apps),
      SPI_CONF_DIR: posixYol(d.conf),
      SPI_CURL: posixYol(d.curl),
      SPI_UNZIP: posixYol(d.unzip),
      CALLS: posixYol(d.calls),
      ...env,
    },
  });
  const satirlar = r.stdout.replace(/\n$/, '').split('\n');
  const sonuclar = satirlar.filter((l) => l.startsWith('RESULT\t'));
  assert.equal(sonuclar.length, 1, `tek RESULT satiri olmali:\n${r.stdout}\n${r.stderr}`);
  assert.equal(satirlar.at(-1), sonuclar[0], `RESULT son satir degil:\n${r.stdout}`);
  const [, status, step, ...msg] = sonuclar[0].split('\t');
  const calls = fs.readFileSync(d.calls, 'utf8').trim().split('\n').filter(Boolean);
  return { r, status, step, message: msg.join('\t'), calls };
}

function sahteIle(eksik, fn) {
  const d = sahteSunucu(eksik);
  try {
    return fn(d);
  } finally {
    fs.rmSync(d.kok, { recursive: true, force: true });
  }
}

const nginxCagrilari = (calls) => calls.filter((c) => c.startsWith('nginx_'));
const curlCagrilari = (calls) => calls.filter((c) => c.startsWith('curl '));
const hysDir = (d) => path.join(d.hys, NS, APP);
const nsDir = (d) => path.join(d.hys, NS);

test(
  'SPI10 host plan: PLAN_OK, hicbir sey yazmaz, deployment betigi cagrilmaz',
  { skip: SKIP },
  () =>
    sahteIle([], (d) => {
      const s = hostKos(d, { SPI_MODE: 'plan' }, '');
      assert.equal(s.status, 'PLAN_OK', s.r.stdout);
      assert.equal(s.step, 'check');
      assert.equal(s.r.status, 0);
      assert.equal(fs.existsSync(hysDir(d)), false, 'plan /hysdeploy dizini acti');
      assert.deepEqual(nginxCagrilari(s.calls), []);
      const curl = curlCagrilari(s.calls);
      assert.equal(curl.length, 1);
      assert.match(curl[0], /-sSI/);
      assert.ok(!curl[0].includes(' -k '), 'varsayilan TLS dogrulamasi kapali');
      assert.ok(!s.message.includes('repo.invalid'), 'mesajda paket adresi');
    }),
);

test('SPI11 host: hedeflerden biri varsa SKIP, uzerine yazilmaz', { skip: SKIP }, () => {
  const hedefler = [
    (d) => fs.mkdirSync(path.join(d.apps, NS, APP), { recursive: true }),
    (d) => fs.writeFileSync(path.join(d.conf, `${APP}-${NS}.conf`), 'x'),
    (d) => {
      fs.mkdirSync(path.join(d.conf, 'application-confs'), { recursive: true });
      fs.writeFileSync(path.join(d.conf, 'application-confs', `${APP}-${NS}.conf`), 'x');
    },
  ];
  for (const kur of hedefler) {
    sahteIle([], (d) => {
      kur(d);
      const s = hostKos(d);
      assert.equal(s.status, 'SKIP', s.r.stdout);
      assert.match(s.message, /zaten kurulu/);
      assert.equal(s.r.status, 0);
      assert.deepEqual(nginxCagrilari(s.calls), []);
      assert.deepEqual(curlCagrilari(s.calls), [], 'SKIP iken paket adresine gidildi');
      assert.equal(fs.existsSync(hysDir(d)), false);
    });
  }
});

test('SPI12 host: indirme hatasi FAIL download, dosya / dizin kalmaz', { skip: SKIP }, () =>
  sahteIle([], (d) => {
    const s = hostKos(d, { FAKE_DL_RC: '22' });
    assert.equal(s.status, 'FAIL');
    assert.equal(s.step, 'download');
    assert.match(s.message, /curl rc=22/);
    assert.equal(s.r.status, 1);
    assert.equal(fs.existsSync(hysDir(d)), false, 'betigin actigi dizin kaldi');
    assert.equal(fs.existsSync(nsDir(d)), false, 'betigin actigi namespace dizini kaldi');
    assert.deepEqual(nginxCagrilari(s.calls), []);
  }),
);

test(
  'SPI13 host: /hysdeploy/<ns>/<app> onceden varsa SKIP, hicbir seye dokunulmaz',
  { skip: SKIP },
  () => {
    for (const mod of ['plan', 'apply']) {
      sahteIle([], (d) => {
        fs.mkdirSync(hysDir(d), { recursive: true });
        fs.writeFileSync(path.join(hysDir(d), '.env'), 'X=1\n');
        const s = hostKos(d, { SPI_MODE: mod });
        assert.equal(s.status, 'SKIP', s.r.stdout);
        assert.equal(s.step, 'check');
        assert.match(
          s.message,
          /paket dizini zaten var \(pipeline yuklemis olabilir\); elle bakin/,
        );
        assert.equal(s.r.status, 0);
        assert.deepEqual(curlCagrilari(s.calls), [], 'SKIP iken paket adresine gidildi');
        assert.deepEqual(nginxCagrilari(s.calls), []);
        assert.deepEqual(fs.readdirSync(hysDir(d)), ['.env']);
      });
    }
  },
);

test(
  'SPI29 host: namespace dizini betik actiysa 777 ve hatada bossa silinir; onceden varsa kalir',
  { skip: SKIP },
  () => {
    sahteIle([], (d) => {
      const s = hostKos(d);
      assert.equal(s.status, 'OK', s.r.stdout);
      assert.ok(fs.statSync(nsDir(d)).isDirectory());
      if (process.platform !== 'win32')
        assert.equal(fs.statSync(nsDir(d)).mode & 0o777, 0o777, 'namespace dizini 777 degil');
    });
    sahteIle([], (d) => {
      const s = hostKos(d, { FAKE_UNZIP_T_RC: '2' });
      assert.equal(s.step, 'zip_check');
      assert.equal(fs.existsSync(nsDir(d)), false, 'bos namespace dizini kaldi');
    });
    sahteIle([], (d) => {
      fs.mkdirSync(path.join(nsDir(d), 'baska-app'), { recursive: true });
      const s = hostKos(d, { FAKE_DL_RC: '22' });
      assert.equal(s.step, 'download');
      assert.deepEqual(
        fs.readdirSync(nsDir(d)),
        ['baska-app'],
        'onceden var olan ns dizini bozuldu',
      );
    });
    const kaynak = fs.readFileSync(HOST_SH, 'utf8');
    assert.match(kaynak, /NS_CREATED=1\n\s+chmod 0777 -- "\$NS_DIR"/);
  },
);

test(
  'SPI30 host: indirme sirasinda hedef olusursa FAIL check, nginx_delete cagrilmaz, indirilen silinir',
  { skip: SKIP },
  () =>
    sahteIle([], (d) => {
      const hedef = path.join(d.apps, NS, APP);
      const s = hostKos(d, { FAKE_DL_MKDIR: posixYol(hedef) });
      assert.equal(s.status, 'FAIL', s.r.stdout);
      assert.equal(s.step, 'check');
      assert.match(s.message, /kurulum sirasinda baska bir deployment hedefi olusturdu/);
      assert.deepEqual(
        nginxCagrilari(s.calls),
        [],
        'deployment betigi ya da nginx_delete cagrildi',
      );
      assert.equal(fs.existsSync(hysDir(d)), false, 'indirilen dosyalar kaldi');
      assert.equal(fs.existsSync(nsDir(d)), false);
      assert.ok(fs.existsSync(hedef), 'baskasinin hedefi silindi');
    }),
);

test(
  'SPI31 host: geri alma yalniz hedef bu kosununsa nginx_delete; degilse dokunulmaz',
  { skip: SKIP },
  () => {
    sahteIle([], (d) => {
      const s = hostKos(d, { FAKE_RC_configuration: '7', FAKE_UNZIP_VERSION: '9.9.9-baska' });
      assert.equal(s.step, 'configuration');
      assert.match(
        s.message,
        /geri alma yapilmadi: hedef baska bir surec tarafindan degistirilmis \(\.version 9\.9\.9-baska\)/,
      );
      assert.ok(!nginxCagrilari(s.calls).some((c) => c.startsWith('nginx_delete')));
      assert.ok(fs.existsSync(path.join(d.apps, NS, APP)));
    });
    // Ayni surumu kuran baska bir deployment araya girdi: onun unzip yedegi (<app>_<baska job>) var.
    sahteIle([], (d) => {
      const s = hostKos(d, { FAKE_RC_configuration: '7', FAKE_FOREIGN_BACKUP: '313131' });
      assert.equal(s.step, 'configuration');
      assert.match(s.message, /geri alma yapilmadi: .*baska bir isin yedegi var: .*_313131/);
      assert.ok(!nginxCagrilari(s.calls).some((c) => c.startsWith('nginx_delete')));
      assert.ok(fs.existsSync(path.join(d.apps, NS, APP)));
    });
    sahteIle([], (d) => {
      const s = hostKos(d, { FAKE_RC_pre_deployment: '59' });
      assert.equal(s.step, 'pre_deployment');
      assert.match(s.message, /geri alma: hedef olusmamisti, indirilen dosyalar silindi/);
      assert.ok(!nginxCagrilari(s.calls).some((c) => c.startsWith('nginx_delete')));
      assert.equal(fs.existsSync(hysDir(d)), false);
      assert.equal(fs.existsSync(nsDir(d)), false);
    });
    sahteIle([], (d) => {
      const s = hostKos(d, { FAKE_UNZIP_NODIR: '1', FAKE_RC_syntax_check: '5' });
      assert.equal(s.step, 'syntax_check');
      assert.match(s.message, /geri alma: nginx_delete\.sh rc=0/);
      assert.equal(nginxCagrilari(s.calls).at(-1), `nginx_delete.sh 2 ${NS} ${APP}`);
    });
    sahteIle([], (d) => {
      const s = hostKos(d, {
        FAKE_UNZIP_NODIR: '1',
        FAKE_RC_syntax_check: '5',
        FAKE_CONF_ROOT: '/baska/yer/',
      });
      assert.match(s.message, /geri alma yapilmadi: .*conf baska yeri gosteriyor/);
      assert.ok(!nginxCagrilari(s.calls).some((c) => c.startsWith('nginx_delete')));
    });
  },
);

test(
  'SPI32 host: hedef zip onceden varsa uzerine yazilmaz ve silinmez; yalniz .part silinir',
  { skip: SKIP },
  () =>
    sahteIle([], (d) => {
      const s = hostKos(d, { FAKE_DL_ALSO: `${VER}.zip` });
      assert.equal(s.status, 'FAIL', s.r.stdout);
      assert.equal(s.step, 'zip_check');
      assert.match(s.message, /hedef paket zaten var, uzerine yazilmadi/);
      assert.match(s.message, /bos degil, birakildi/);
      assert.deepEqual(fs.readdirSync(hysDir(d)), [`${VER}.zip`]);
      assert.equal(fs.readFileSync(path.join(hysDir(d), `${VER}.zip`), 'utf8'), 'foreign');
      assert.deepEqual(nginxCagrilari(s.calls), []);
    }),
);

test('SPI33 host plan: Content-Type ZIP degilse FAIL check', { skip: SKIP }, () => {
  const durumlar = [
    ['application/zip', 'PLAN_OK'],
    ['Application/X-Zip-Compressed', 'PLAN_OK'],
    ['application/octet-stream; charset=binary', 'PLAN_OK'],
    ['text/html; charset=utf-8', 'FAIL'],
    ['application/json', 'FAIL'],
    ['-', 'FAIL'],
  ];
  for (const [ct, beklenen] of durumlar) {
    sahteIle([], (d) => {
      const s = hostKos(d, { SPI_MODE: 'plan', FAKE_CT: ct }, '');
      assert.equal(s.status, beklenen, `${ct}: ${s.r.stdout}`);
      if (beklenen === 'FAIL') {
        assert.equal(s.step, 'check');
        assert.match(s.message, /paket ZIP degil \(Content-Type: /);
      }
    });
  }
});

test('SPI34 host plan: /hysdeploy yazilabilir degilse FAIL check', { skip: SKIP }, () => {
  sahteIle([], (d) => {
    const s = hostKos(d, { SPI_MODE: 'plan', SPI_HYS_ROOT: posixYol(path.join(d.kok, 'yok')) }, '');
    assert.equal(s.status, 'FAIL', s.r.stdout);
    assert.match(s.message, /yazilabilir degil/);
    assert.deepEqual(curlCagrilari(s.calls), []);
  });
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  if (process.platform === 'win32' || root) return;
  sahteIle([], (d) => {
    fs.mkdirSync(nsDir(d), { recursive: true });
    fs.chmodSync(nsDir(d), 0o555);
    try {
      const s = hostKos(d, { SPI_MODE: 'plan' }, '');
      assert.equal(s.status, 'FAIL', s.r.stdout);
      assert.match(s.message, new RegExp(`${NS} yazilabilir degil`));
    } finally {
      fs.chmodSync(nsDir(d), 0o755);
    }
  });
});

test('SPI14 host: bozuk zip FAIL zip_check, dosya kalmaz', { skip: SKIP }, () =>
  sahteIle([], (d) => {
    const s = hostKos(d, { FAKE_UNZIP_T_RC: '2' });
    assert.equal(s.status, 'FAIL');
    assert.equal(s.step, 'zip_check');
    assert.match(s.message, /bozuk/);
    assert.equal(fs.existsSync(hysDir(d)), false);
  }),
);

test('SPI15 host: arsiv kokunde index.html yoksa FAIL zip_check', { skip: SKIP }, () =>
  sahteIle([], (d) => {
    const s = hostKos(d, { FAKE_ZIP_LIST: 'dist/index.html main.js' });
    assert.equal(s.status, 'FAIL');
    assert.equal(s.step, 'zip_check');
    assert.match(s.message, /index\.html yok/);
    assert.equal(fs.existsSync(hysDir(d)), false);
  }),
);

test(
  'SPI16 host: configuration duserse nginx_delete.sh ile geri alinir, mesaj sonucu yazar',
  { skip: SKIP },
  () =>
    sahteIle([], (d) => {
      const s = hostKos(d, { FAKE_RC_configuration: '7' });
      assert.equal(s.status, 'FAIL');
      assert.equal(s.step, 'configuration');
      assert.match(s.message, /nginx_configuration\.sh rc=7/);
      assert.match(s.message, /geri alma: nginx_delete\.sh rc=0/);
      const n = nginxCagrilari(s.calls);
      assert.equal(n.at(-1), `nginx_delete.sh 2 ${NS} ${APP}`);
      assert.ok(!n.some((c) => c.startsWith('nginx_syntax_check')), 'hatadan sonra devam edildi');
      assert.equal(fs.existsSync(path.join(d.apps, NS, APP)), false);
    }),
);

test('SPI17 host: geri alma da duserse mesaj elle inceleme ister', { skip: SKIP }, () =>
  sahteIle([], (d) => {
    const s = hostKos(d, { FAKE_RC_reload: '57', FAKE_RC_delete: '64' });
    assert.equal(s.step, 'reload');
    assert.match(s.message, /geri alma BASARISIZ: nginx_delete\.sh rc=64/);
  }),
);

test(
  'SPI18 host mutlu yol: OK, betik sirasi, 7 arguman ve job_no, application.json',
  { skip: SKIP },
  () =>
    sahteIle([], (d) => {
      const s = hostKos(d);
      assert.equal(s.status, 'OK', s.r.stdout);
      assert.equal(s.step, 'cleanup');
      assert.equal(s.r.status, 0);
      const n = nginxCagrilari(s.calls);
      const sira = [
        'pre_deployment',
        'unzip',
        'configuration',
        'syntax_check',
        'reload',
        'cleanup_backup',
      ];
      assert.deepEqual(
        n,
        sira.map((b) => `nginx_${b}.sh 7 prod ${NS} ${APP} ${VER} portal / ${JOB}`),
      );
      assert.equal(fs.readFileSync(path.join(hysDir(d), 'application.json'), 'utf8'), APPJSON);
      assert.equal(fs.readFileSync(path.join(hysDir(d), `${VER}.zip`), 'utf8'), 'PKfake');
      assert.ok(!fs.readdirSync(hysDir(d)).some((f) => f.endsWith('.part')), '.part kaldi');
      const dogrulama = curlCagrilari(s.calls).filter((c) => c.includes('--resolve'));
      assert.equal(dogrulama.length, 2);
      for (const yol of ['/ready', '/config']) {
        assert.ok(
          dogrulama.some(
            (c) => c.includes(`${APP}-${NS}.apps.invalid:443:192.0.2.10`) && c.endsWith(yol),
          ),
          `${yol} dogrulanmadi`,
        );
      }
      assert.ok(!s.message.includes('apps.invalid'), 'mesajda server_name');
    }),
);

test('SPI19 host: /ready 200 degilse FAIL verify ve geri alma', { skip: SKIP }, () =>
  sahteIle([], (d) => {
    const s = hostKos(d, { FAKE_VERIFY_CODE: '404' });
    assert.equal(s.step, 'verify');
    assert.match(s.message, /\/ready HTTP 404/);
    assert.equal(nginxCagrilari(s.calls).at(-1), `nginx_delete.sh 2 ${NS} ${APP}`);
  }),
);

test(
  'SPI20 host: gecersiz girdi FAIL check, paket adresine ve betiklere gidilmez',
  { skip: SKIP },
  () => {
    const durumlar = [
      { SPI_NS: 'Kotu NS' },
      { SPI_APP: 'a;rm -rf /' },
      { SPI_VERSION: '../x' },
      { SPI_JOB_NO: 'abc' },
      { SPI_MODE: 'sil' },
      { SPI_ZIP_URL: URL.replace('https://', 'http://') },
      { SPI_ZIP_URL: URL.replace(`${VER}.zip`, 'baska.zip') },
      { SPI_MAX_ZIP_MB: '0' },
    ];
    for (const env of durumlar) {
      sahteIle([], (d) => {
        const s = hostKos(d, env);
        assert.equal(s.status, 'FAIL', JSON.stringify(env));
        assert.equal(s.step, 'check');
        assert.equal(s.r.status, 1);
        assert.deepEqual(s.calls, [], `cagri yapildi: ${JSON.stringify(env)}`);
      });
    }
  },
);

test('SPI21 host: eksik betik, HEAD 404 ve boyut siniri FAIL check', { skip: SKIP }, () => {
  sahteIle(['reload'], (d) => {
    const s = hostKos(d, { SPI_MODE: 'plan' }, '');
    assert.match(s.message, /eksik deployment betigi.*nginx_reload\.sh/);
  });
  sahteIle([], (d) => {
    const s = hostKos(d, { SPI_MODE: 'plan', FAKE_HEAD_CODE: '404' }, '');
    assert.equal(s.status, 'FAIL');
    assert.match(s.message, /HTTP 404/);
  });
  sahteIle([], (d) => {
    const s = hostKos(d, { SPI_MODE: 'plan', SPI_MAX_ZIP_MB: '1', FAKE_CL: '2097152' }, '');
    assert.equal(s.status, 'FAIL');
    assert.match(s.message, /cok buyuk/);
  });
  sahteIle([], (d) => {
    const s = hostKos(d, { SPI_MODE: 'plan', SPI_INSECURE: '1' }, '');
    assert.equal(s.status, 'PLAN_OK');
    assert.match(curlCagrilari(s.calls)[0], / -k /);
  });
});

test('SPI22 host: bos application.json FAIL write, indirilen paket silinir', { skip: SKIP }, () =>
  sahteIle([], (d) => {
    const s = hostKos(d, {}, '');
    assert.equal(s.step, 'write');
    assert.equal(fs.existsSync(hysDir(d)), false);
    assert.deepEqual(nginxCagrilari(s.calls), []);
  }),
);

// -- spa_package_ocp.sh ---------------------------------------------------------------------------

const T = '\t';

/**
 * Sahte oc. Workload ciktisi wl.txt'ten, ConfigMap'ler cm/<ad> (application.json anahtari VAR) ya
 * da nokey/<ad> (anahtar YOK) dosyalarindan, etiket listesi label.txt'ten.
 */
function sahteOc(kur) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-pkg-oc-'));
  fs.mkdirSync(path.join(dir, 'cm'));
  fs.mkdirSync(path.join(dir, 'nokey'));
  fs.writeFileSync(path.join(dir, 'calls.txt'), '');
  kur(dir);
  const D = posixYol(dir);
  const oc = path.join(dir, 'oc');
  yaz(
    oc,
    [
      '#!/bin/bash',
      `D="${D}"`,
      "printf '%s\\n' \"$(printf '%s' \"$*\" | tr '\\n' ' ')\" >> \"$D/calls.txt\"",
      'ad=$3',
      'case "$1 $2" in',
      '  "login "*) : > "$KUBECONFIG" || exit 8; printf \'%s\\n\' "$KUBECONFIG" > "$D/kc.txt"; exit 0 ;;',
      '  "get deployment") [ "$ad" = "${WL_NAME:-$APP}" ] && [ -f "$D/wl.txt" ] && cat "$D/wl.txt"; exit 0 ;;',
      '  "get deploymentconfig") echo "error: the server doesn\'t have a resource type deploymentconfig" >&2; exit 1 ;;',
      '  "get statefulset"|"get rollouts.argoproj.io") [ -f "$D/$2.txt" ] && cat "$D/$2.txt"; exit 0 ;;',
      '  "get configmap")',
      '    case "$*" in',
      '      *" -l "*) [ -f "$D/label.txt" ] && cat "$D/label.txt"; exit 0 ;;',
      '      *"Y{{end}}"*) [ -f "$D/cm/$ad" ] && printf Y; exit 0 ;;',
      '      *) cat "$D/cm/$ad"; exit $? ;;',
      '    esac ;;',
      'esac',
      'echo "beklenmeyen: $*" >&2',
      'exit 9',
      '',
    ].join('\n'),
  );
  return { dir, oc };
}

function wl(dir, satirlar) {
  fs.writeFileSync(path.join(dir, 'wl.txt'), satirlar.map((s) => s.join(T)).join('\n') + '\n');
}

/** Onekle baslayan kalinti dizinlerin sayisi (betigin gordugu /tmp, Git Bash'te de). */
function kalinti(onek) {
  const r = spawnSync(BASH, ['-c', 'shopt -s nullglob; a=("$1".*); echo ${#a[@]}', '_', onek], {
    encoding: 'utf8',
  });
  return Number(r.stdout.trim());
}

function ocKos(kur, env = {}) {
  const { dir, oc } = sahteOc(kur);
  const onek = `/tmp/spa-pkg-test-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    const r = spawnSync(BASH, [posixYol(OCP_SH)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OC_BIN: posixYol(oc),
        OCP_URL: 'https://api.invalid:6443',
        OCP_USER: 'u',
        OCP_PASS: 'gizliparola',
        NS,
        APP,
        KUBECONFIG: '/tmp/disaridan-gelen.kubeconfig',
        SPI_RUN_PREFIX: onek,
        ...env,
      },
    });
    const calls = fs.readFileSync(path.join(dir, 'calls.txt'), 'utf8').trim();
    const kcDosya = path.join(dir, 'kc.txt');
    const kc = fs.existsSync(kcDosya) ? fs.readFileSync(kcDosya, 'utf8').trim() : null;
    const satir = r.stdout.split('\n').filter(Boolean);
    return {
      r,
      calls,
      kc,
      onek,
      kalan: kalinti(onek),
      satir,
      cm: satir.filter((l) => l.startsWith('CM\t')),
      err: satir.filter((l) => l.startsWith('ERR\t')),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function salt(calls) {
  const lines = calls.split('\n').filter(Boolean);
  assert.deepEqual(
    [...new Set(lines.map((l) => l.split(' ')[0]))].sort(),
    ['get', 'login'],
    `salt okunur degil: ${calls}`,
  );
  assert.ok(!/secret/i.test(calls), `Secret okundu: ${calls}`);
}

const ORNEK_WL = [
  ['KIND', 'Deployment'],
  ['IMG', 'app', `registry.invalid/${NS}/${APP}:${VER}`],
  ['IMG', 'sidecar', 'registry.invalid/ortak/proxy:1.2'],
  ['VOL', `${APP}-j-app-config-6v`],
  ['VOL', 'ortak-ayar'],
];

test(
  'SPI23 ocp: volume icinden application.json anahtarli tek ConfigMap secilir',
  { skip: SKIP },
  () => {
    const o = ocKos((dir) => {
      wl(dir, ORNEK_WL);
      fs.writeFileSync(path.join(dir, 'cm', `${APP}-j-app-config-6v`), APPJSON);
      fs.writeFileSync(path.join(dir, 'nokey', 'ortak-ayar'), 'x');
    });
    assert.equal(o.r.status, 0, o.r.stderr);
    assert.deepEqual(o.err, [], o.r.stdout);
    assert.deepEqual(o.cm, [`CM${T}${APP}-j-app-config-6v${T}${B64}`]);
    assert.ok(o.satir.includes(`IMG${T}app${T}registry.invalid/${NS}/${APP}:${VER}`));
    assert.equal(o.satir.at(-1), 'END');
    assert.ok(!o.r.stdout.includes('gizliparola'));
    assert.ok(!/ -l /.test(o.calls), 'volume yeterliyken etiket yedegine gidildi');
    salt(o.calls);
    assert.ok(
      o.kc && o.kc.startsWith(`${o.onek}.`) && o.kc.endsWith('/kubeconfig'),
      `kubeconfig kosuya ozel dizinde degil: ${o.kc}`,
    );
    assert.equal(o.kalan, 0, 'kosuya ozel gecici dizin silinmedi');
  },
);

test(
  'SPI35 ocp: ayni adli tum workload turleri okunur, spec.replicas en buyuk olan secilir',
  { skip: SKIP },
  () => {
    const o = ocKos((dir) => {
      wl(dir, [
        ['KIND', 'Deployment'],
        ['REPL', '0'],
        ['IMG', 'app', `registry.invalid/${NS}/${APP}:0.0.1-eski`],
        ['VOL', 'eski-cm'],
      ]);
      fs.writeFileSync(
        path.join(dir, 'rollouts.argoproj.io.txt'),
        [
          ['KIND', 'Rollout'],
          ['REPL', '3'],
          ['IMG', 'app', `registry.invalid/${NS}/${APP}:${VER}`],
          ['VOL', `${APP}-j-app-config-6v`],
        ]
          .map((s) => s.join(T))
          .join('\n') + '\n',
      );
      fs.writeFileSync(path.join(dir, 'cm', 'eski-cm'), '{"eski":true}');
      fs.writeFileSync(path.join(dir, 'cm', `${APP}-j-app-config-6v`), APPJSON);
    });
    assert.deepEqual(o.err, [], o.r.stdout);
    const img = o.satir.filter((l) => l.startsWith('IMG\t'));
    assert.deepEqual(img, [`IMG${T}app${T}registry.invalid/${NS}/${APP}:${VER}`]);
    assert.deepEqual(o.cm, [`CM${T}${APP}-j-app-config-6v${T}${B64}`]);
    for (const tur of ['deployment', 'deploymentconfig', 'statefulset', 'rollouts.argoproj.io'])
      assert.match(
        o.calls,
        new RegExp(`get ${tur.replace('.', '\\.')} ${APP} `),
        `${tur} okunmadi`,
      );

    const esit = ocKos((dir) => {
      wl(dir, [
        ['KIND', 'Deployment'],
        ['REPL', '2'],
        ['IMG', 'app', `registry.invalid/${NS}/${APP}:${VER}`],
        ['VOL', `${APP}-j-app-config-6v`],
      ]);
      fs.writeFileSync(
        path.join(dir, 'statefulset.txt'),
        `KIND${T}StatefulSet\nREPL${T}2\nIMG${T}app${T}registry.invalid/${NS}/${APP}:baska\n`,
      );
      fs.writeFileSync(path.join(dir, 'cm', `${APP}-j-app-config-6v`), APPJSON);
    });
    assert.deepEqual(
      esit.satir.filter((l) => l.startsWith('IMG\t')),
      [`IMG${T}app${T}registry.invalid/${NS}/${APP}:${VER}`],
      'esitlikte ilk bulunan secilmedi',
    );
  },
);

test('SPI24 ocp: volume yoksa etiket yedegi; >1 aday ERR; workload yok ERR', { skip: SKIP }, () => {
  const yedek = ocKos((dir) => {
    wl(dir, ORNEK_WL.slice(0, 3));
    fs.writeFileSync(path.join(dir, 'label.txt'), `CAND${T}${APP}-cfg\n`);
    fs.writeFileSync(path.join(dir, 'cm', `${APP}-cfg`), APPJSON);
  });
  assert.deepEqual(yedek.cm, [`CM${T}${APP}-cfg${T}${B64}`], yedek.r.stdout);
  assert.match(yedek.calls, new RegExp(`-l app=${APP}`));
  salt(yedek.calls);

  const iki = ocKos((dir) => {
    wl(dir, ORNEK_WL);
    fs.writeFileSync(path.join(dir, 'cm', `${APP}-j-app-config-6v`), APPJSON);
    fs.writeFileSync(path.join(dir, 'cm', 'ortak-ayar'), '{}');
  });
  assert.deepEqual(iki.cm, []);
  assert.match(iki.err[0], /birden cok configmap: .*-j-app-config-6v, ortak-ayar/);
  salt(iki.calls);

  const ikiEtiket = ocKos((dir) => {
    wl(dir, ORNEK_WL.slice(0, 3));
    fs.writeFileSync(path.join(dir, 'label.txt'), `CAND${T}a\nCAND${T}b\n`);
  });
  assert.deepEqual(ikiEtiket.cm, []);
  assert.match(ikiEtiket.err[0], /birden cok configmap: a, b/);

  const hic = ocKos((dir) => wl(dir, ORNEK_WL.slice(0, 3)));
  assert.match(hic.err[0], /application\.json tasiyan configmap yok/);

  const yok = ocKos(() => {});
  assert.match(yok.err[0], /adli deployment \/ deploymentconfig \/ statefulset \/ rollout yok/);
  assert.equal(yok.satir.at(-1), 'END');
  salt(yok.calls);
});

test(
  'SPI25 ocp: rollout workloadRef Deployment okunur; buyuk application.json ERR',
  { skip: SKIP },
  () => {
    const ref = ocKos(
      (dir) => {
        fs.writeFileSync(
          path.join(dir, 'rollouts.argoproj.io.txt'),
          `KIND${T}Rollout\nREF${T}Deployment${T}gercek-dep\n`,
        );
        wl(dir, ORNEK_WL);
        fs.writeFileSync(path.join(dir, 'cm', `${APP}-j-app-config-6v`), APPJSON);
      },
      { WL_NAME: 'gercek-dep' },
    );
    assert.deepEqual(ref.err, [], ref.r.stdout);
    assert.equal(ref.cm.length, 1);
    assert.match(ref.calls, /get deployment gercek-dep/);

    const buyuk = ocKos(
      (dir) => {
        wl(dir, ORNEK_WL);
        fs.writeFileSync(path.join(dir, 'cm', `${APP}-j-app-config-6v`), APPJSON);
      },
      { SPA_MAX_APPJSON_BYTES: '10' },
    );
    assert.deepEqual(buyuk.cm, []);
    assert.match(buyuk.err[0], /cok buyuk/);
  },
);

test(
  'SPI26 ocp: gecersiz NS / APP / gecici dizin oneki / URL -> ERR, oc HIC cagrilmaz',
  { skip: SKIP },
  () => {
    for (const env of [
      { NS: 'Kotu NS' },
      { APP: 'a;rm -rf /' },
      { SPI_RUN_PREFIX: '/etc/passwd' },
      { SPI_RUN_PREFIX: '/tmp/app-hub-x' },
      { SPI_RUN_PREFIX: '/tmp/spa-pkg-../../etc/x' },
      { OCP_URL: '' },
    ]) {
      const o = ocKos(() => {}, env);
      assert.notEqual(o.r.status, 0, JSON.stringify(env));
      assert.equal(o.err.length, 1);
      assert.equal(o.calls, '', `oc cagrildi: ${o.calls}`);
    }
  },
);

test('SPI27 ocp betik kaynagi: oc yalniz OC() ile, yalniz login / get; secret sozcugu komutta yok', () => {
  const s = fs.readFileSync(OCP_SH, 'utf8');
  const kod = s.split('\n').filter((l) => !/^\s*#/.test(l));
  const cagrilar = [...kod.join('\n').matchAll(/\bOC\s+([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(cagrilar.length >= 5, `beklenenden az OC cagrisi: ${cagrilar.length}`);
  for (const c of cagrilar) assert.ok(['login', 'get'].includes(c), `yazan oc alt komutu: ${c}`);
  const dogrudan = kod.filter((l) => l.includes('"$OC_BIN"'));
  assert.equal(dogrudan.length, 1, `OC() disinda oc cagrisi: ${dogrudan.join(' | ')}`);
  assert.match(dogrudan[0], /^OC\(\) \{ timeout /);
  assert.ok(!kod.some((l) => /secret/i.test(l)), 'betik kodunda secret');
  assert.match(s, /unset OCP_PASS/);
  assert.match(s, /\^\/tmp\/spa-pkg-\[A-Za-z0-9\._-\]\+\$/);
  assert.match(s, /RUN_DIR=\$\(mktemp -d "\$\{SPI_RUN_PREFIX\}\.XXXXXX"\)/);
  assert.match(s, /export KUBECONFIG="\$\{RUN_DIR\}\/kubeconfig"/);
  assert.match(s, /ERRF="\$\{RUN_DIR\}\/oc\.err"/);
  assert.match(s, /temizle\(\) \{ \[\[ -n "\$RUN_DIR" \]\] && rm -rf -- "\$RUN_DIR"; \}/);
  assert.ok(!/\/tmp\/\.spapkg_err/.test(s), 'paylasilan /tmp hata dosyasi');
  assert.ok(!/komut satirina SIR konmaz/i.test(s), 'yanlis sir iddiasi (oc login --password argv)');
  assert.match(s, /Bilinen sinir/);
});

test('SPI28 betikler ASCII ve set -u', () => {
  for (const f of [HOST_SH, OCP_SH]) {
    const s = fs.readFileSync(f, 'utf8');
    assert.match(s, /^#!\/bin\/bash\n/);
    assert.match(s, /\nset -u\n/);
    assert.ok(!/[^\t\n\x20-\x7e]/.test(s), `ASCII disi karakter: ${path.basename(f)}`);
  }
  const py = fs.readFileSync(MERGE_PY, 'utf8');
  assert.ok(!/[^\t\n\x20-\x7e]/.test(py), 'ASCII disi karakter: spa_package_merge.py');
  const importlar = [...py.matchAll(/^(?:import|from) ([a-z0-9_.]+)/gm)].map((m) => m[1]);
  assert.deepEqual(importlar.sort(), ['base64', 'binascii', 'json', 're', 'sys']);
});

// -- spa_package_merge.py -------------------------------------------------------------------------

function pythonuBul() {
  for (const [komut, on] of adaylar()) {
    if (spawnSync(komut, [...on, '-c', 'import json, base64'], { stdio: 'ignore' }).status === 0)
      return { komut, on };
  }
  return null;
}
const PY = pythonuBul();
const PY_SKIP = PY ? false : 'python3 bulunamadi - spa_package_merge.py bekcileri KOSMADI';

function rapor(satirlar, ek = {}) {
  return { ok: true, unreachable: false, error: '', lines: [...satirlar, 'END'], ...ek };
}

function kalem(ek = {}) {
  return {
    id: `${NS}/${APP}`,
    namespace: NS,
    application: APP,
    version: VER,
    cluster: 'ocp-prod-1',
    catalog: true,
    owner: 'BASTION01',
    blocked: '',
    report: rapor([
      `IMG${T}app${T}registry.invalid/${NS}/${APP}:${VER}`,
      `CM${T}${APP}-j-app-config-6v${T}${B64}`,
    ]),
    ...ek,
  };
}

function birlestir(items) {
  const r = spawnSync(PY.komut, [...PY.on, '-I', MERGE_PY], {
    encoding: 'utf8',
    input: JSON.stringify({ items }),
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).items;
}

function tek(ek) {
  const [o] = birlestir([kalem(ek)]);
  return o;
}

const img = (imaj) => `IMG${T}app${T}${imaj}`;
const cmSatir = (veri) => `CM${T}cfg${T}${Buffer.from(veri).toString('base64')}`;

test('SPI36 merge: gecerli kalem OK, application.json base64 doner', { skip: PY_SKIP }, () => {
  const o = tek({});
  assert.deepEqual(o, {
    id: `${NS}/${APP}`,
    ok: true,
    image: `registry.invalid/${NS}/${APP}:${VER}`,
    tag: VER,
    configmap: `${APP}-j-app-config-6v`,
    error: null,
    appjson_b64: B64,
  });
  const buyukHarf = tek({
    report: rapor([
      img(`registry.invalid/${NS.toUpperCase()}/${APP.toUpperCase()}:${VER}`),
      cmSatir('{}'),
    ]),
  });
  assert.equal(buyukHarf.ok, true, `harf duyarsiz ns/app: ${buyukHarf.error}`);
  const portlu = tek({
    report: rapor([img(`registry.invalid:5000/${NS}/${APP}:${VER}`), cmSatir('{}')]),
  });
  assert.equal(portlu.ok, true, portlu.error);
});

test('SPI37 merge: imaj ve etiket kurallari', { skip: PY_SKIP }, () => {
  const fark = tek({
    report: rapor([img(`registry.invalid/${NS}/${APP}:0.0.1-1-prod`), cmSatir('{}')]),
  });
  assert.equal(fark.ok, false);
  assert.match(fark.error, new RegExp(`^OCP'de kosan surum 0\\.0\\.1-1-prod, planlanan ${VER}`));
  assert.equal(fark.appjson_b64, null);

  const digest = tek({
    report: rapor([img(`registry.invalid/${NS}/${APP}@sha256:${'a'.repeat(64)}`), cmSatir('{}')]),
  });
  assert.equal(digest.ok, false);
  assert.match(digest.error, /imaj etiketsiz ya da digest ile/);

  const etiketliDigest = tek({
    report: rapor([
      img(`registry.invalid/${NS}/${APP}:${VER}@sha256:${'b'.repeat(64)}`),
      cmSatir('{}'),
    ]),
  });
  assert.equal(etiketliDigest.ok, false);
  assert.match(etiketliDigest.error, /digest/);

  const etiketsiz = tek({ report: rapor([img(`registry.invalid/${NS}/${APP}`), cmSatir('{}')]) });
  assert.equal(etiketsiz.ok, false);
  assert.match(etiketsiz.error, /imaj etiketsiz ya da digest ile/);

  const ikiYol = tek({
    report: rapor([
      img('registry.invalid/ortak/proxy:1.2'),
      img(`registry.invalid/${NS}/${APP}:${VER}`),
      cmSatir('{}'),
    ]),
  });
  assert.equal(ikiYol.ok, true, ikiYol.error);
  assert.equal(ikiYol.image, `registry.invalid/${NS}/${APP}:${VER}`);

  const yolYok = tek({
    report: rapor([
      img(`registry.invalid/baska-ns/${APP}:${VER}`),
      img(`registry.invalid/x${NS}/${APP}:${VER}`),
      cmSatir('{}'),
    ]),
  });
  assert.equal(yolYok.ok, false);
  assert.match(yolYok.error, /^imaj yolu uygulamayla eslesmiyor: /);

  const ikiEtiket = tek({
    report: rapor([
      img(`registry.invalid/${NS}/${APP}:${VER}`),
      `IMG${T}init${T}registry.invalid/${NS}/${APP}:0.0.2`,
      cmSatir('{}'),
    ]),
  });
  assert.equal(ikiEtiket.ok, false);
  assert.match(ikiEtiket.error, /birden cok etiketle kosuyor/);
});

test('SPI38 merge: application.json ve ConfigMap kurallari', { skip: PY_SKIP }, () => {
  const imajSatiri = img(`registry.invalid/${NS}/${APP}:${VER}`);
  const dizi = tek({ report: rapor([imajSatiri, cmSatir('[1,2]')]) });
  assert.equal(dizi.ok, false);
  assert.match(dizi.error, /JSON nesnesi degil/);

  const bozuk = tek({ report: rapor([imajSatiri, cmSatir('{"a":')]) });
  assert.equal(bozuk.ok, false);
  assert.match(bozuk.error, /gecersiz JSON/);

  const b64Bozuk = tek({ report: rapor([imajSatiri, `CM${T}cfg${T}%%%`]) });
  assert.equal(b64Bozuk.ok, false);
  assert.match(b64Bozuk.error, /base64 cozulemedi/);

  const buyuk = tek({
    report: rapor([imajSatiri, cmSatir(JSON.stringify({ a: 'x'.repeat(1048576) }))]),
  });
  assert.equal(buyuk.ok, false);
  assert.match(buyuk.error, /cok buyuk/);

  const cmYok = tek({ report: rapor([imajSatiri]) });
  assert.equal(cmYok.ok, false);
  assert.match(cmYok.error, /ConfigMap'i okunamadi/);

  const cmErr = tek({
    report: rapor([imajSatiri, `ERR${T}application.json tasiyan birden cok configmap: a, b`]),
  });
  assert.equal(cmErr.ok, false);
  assert.match(cmErr.error, /birden cok configmap: a, b/);

  const endYok = tek({
    report: { ...rapor([imajSatiri, cmSatir('{}')]), lines: [imajSatiri, cmSatir('{}')] },
  });
  assert.equal(endYok.ok, false);
  assert.match(endYok.error, /END satiri yok/);
});

test(
  'SPI39 merge: katalog, bastion erisilemedi, sonuc yok, okuma hatasi',
  { skip: PY_SKIP },
  () => {
    const [katalog, erisilemez, sonucYok, hata] = birlestir([
      kalem({ catalog: false }),
      kalem({ report: { ok: false, unreachable: true, error: 'x', lines: [] } }),
      kalem({ report: null, blocked: 'zaman asimi' }),
      kalem({
        report: {
          ok: false,
          error: 'OCP okumasi basarisiz (rc=4)',
          lines: [`ERR${T}oc login basarisiz`],
        },
      }),
    ]);
    assert.match(katalog.error, /cluster Portal OCP katalogunda yok: ocp-prod-1/);
    assert.equal(erisilemez.error, 'bastion erisilemedi: BASTION01');
    assert.match(sonucYok.error, /Bastion sonuc bildirmedi .*BASTION01 zaman asimi/);
    assert.match(hata.error, /rc=4.*oc login basarisiz/);
    for (const o of [katalog, erisilemez, sonucYok, hata]) {
      assert.equal(o.ok, false);
      assert.equal(o.appjson_b64, null);
    }
    const r = spawnSync(PY.komut, [...PY.on, '-I', MERGE_PY], { encoding: 'utf8', input: 'bozuk' });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
  },
);

test('SPI40 playbook: erisilemeyen bastion tek hata satiri verir; birlestirme betikte', () => {
  assert.match(gorev('Bastion reachability'), /ansible\.builtin\.ping:/);
  const dusuk = gorev('Items fail when the bastion is unreachable');
  assert.match(dusuk, /'unreachable': true/);
  assert.match(dusuk, /'bastion erisilemedi: ' ~ inventory_hostname/);
  assert.match(dusuk, /when: spi_bastion_down \| bool/);
  assert.match(
    PB,
    /spi_live: "\{\{ \(my_items \| default\(\[\]\) \| length > 0\) and not \(spi_bastion_down/,
  );
  assert.match(
    gorev('Bastion results'),
    /when: \(spi_live \| bool\) and \(oc_bin \| default\(''\) \| trim \| length > 0\)/,
  );
  assert.match(
    gorev('Items fail when oc is missing'),
    /when: \(spi_live \| bool\) and \(\(oc_bin \| default\(''\) \| trim \| length\) == 0\)/,
  );
  const kos = gorev('Merge OCP results');
  assert.match(
    kos,
    /- "\{\{ ansible_playbook_python \}\}"\n\s+- "-I"\n\s+- "\{\{ playbook_dir \}\}\/files\/spa_package_merge\.py"/,
  );
  assert.match(kos, /stdin: "\{\{ \{'items': spi_merge_input\} \| to_json \}\}"/);
  assert.match(gorev('Merged items'), /\['items'\]/);
  assert.ok(!/regex_escape|ignorecase/.test(PB), 'kalem gecerliligi hala Jinja icinde');
});
