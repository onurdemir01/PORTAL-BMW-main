// server/ansible/__tests__/spa-package-install.test.js - SPI1..SPI22, SPI28..SPI34, SPI41..SPI48.
//
// Intranet SPA paket kurulumu (bmw_portal/spa_package_install): Artifactory'deki paketi PROD intranet
// Nginx sunucusuna ILK KEZ kurar; application.json uygulamanin OCP route'undaki /config'ten (pod'daki
// nginx config.json = ConfigMap application.json sunar) Nginx sunucusunun kendisince cekilir.
// 2026-11-23 kullanici karari "A": bastion / OCP okumasi YOK (ortak AWX envanteri yok); SPI23-27 ve
// SPI35-40 (spa_package_ocp.sh / spa_package_merge.py) betiklerle birlikte kalkti.
//
// Kilitler:
//   * Playbook: '#' yorum yok, '{{ }}' icinde kacisli tirnak yok, gorev adlari Ingilizce ASCII,
//     set_stats son fail'den once, YALNIZ localhost + spi_nginx play'leri (bastion / oc / kimlik
//     dosyasi yok), host play'i www + dzdo + ignore_unreachable, kosu gorevi no_log, girdi kapisi
//     (mod, 1..50 kalem, 1..8 sunucu, izinli sunucu alt kumesi, regex'ler, config_urls 1..3 tekil
//     https://<host>/config), kurum degeri varsayilani YOK, sonucta 'ocp' alani yok.
//   * spa_package_host.sh (GERCEK bash + GERCEK python JSON denetimi, sahte HYSUXSCRIPTS / curl /
//     unzip): plan hicbir sey yazmaz, kurulu hedefin ya da var olan paket dizininin uzerine
//     yazilmaz (SKIP), Content-Type ve yazilabilirlik denetimi, /config gecerli JSON nesnesi
//     (HTML / dizi / bos / 404 / 1 MB ustu -> FAIL config; ilk adres duserse sonraki), apply'da
//     yazilan application.json /config icerigiyle birebir, indirme / zip hatasinda yalniz betigin
//     yazdiklari silinir, nginx_delete.sh yalniz hedef bu kosununsa cagrilir, mutlu yolda betik
//     sirasi ve 7 arguman + job_no; her yolda tek ve son satir RESULT; adres mesaja yazilmaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BASH, BASH_SURUM, posixYol } = require('./fixtures/kabuk.cjs');
const { adaylar, pythonBul } = require('./fixtures/python-bul.cjs');

const DIR = path.join(__dirname, '..', 'playbooks', 'bmw_portal', 'spa_package_install');
const PLAYBOOK = path.join(DIR, 'spa_package_install.yml');
const HOST_SH = path.join(DIR, 'files', 'spa_package_host.sh');
const PB = fs.readFileSync(PLAYBOOK, 'utf8');

const TIMEOUT_VAR =
  spawnSync(BASH, ['-c', 'timeout 1 true && mktemp --version >/dev/null && echo ok'], {
    encoding: 'utf8',
  }).stdout === 'ok\n';

/** Betigin JSON denetimi icin gercek python (Git Bash'ten gorunen); yoksa davranis testleri KOSMAZ. */
function pythonuBul() {
  for (const [komut, on] of adaylar()) {
    if (on.length) continue;
    const r = spawnSync(
      BASH,
      ['-c', '"$1" -E -s -c "import json" && command -v -- "$1"', '_', komut],
      {
        encoding: 'utf8',
      },
    );
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}
const PY = TIMEOUT_VAR && BASH_SURUM >= 4 ? pythonuBul() : null;
const SKIP = (() => {
  if (!(TIMEOUT_VAR && BASH_SURUM >= 4))
    return 'bash 4+ / timeout / mktemp bulunamadi (Git Bash gerekir) - SPA paket betik davranis bekcileri KOSMADI';
  if (!PY) return 'python bulunamadi - SPA paket betik davranis bekcileri KOSMADI';
  return false;
})();

const NS = 'musteri-gelir-prod';
const APP = 'gelir-app-v0';
const VER = '0.8.0-68-prod';
const JOB = '424242';
const URL = `https://repo.invalid/artifactory/ark-binaries/${NS}/${APP}/${VER}.zip`;
const APPJSON = '{\n  "apiUrl": "https://api.invalid",\n  "flag": true\n}\n';
const CFG = (n) => `https://cfg${n}.invalid/config`;

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
  const son = plays().at(-1);
  assert.match(son, /clear_host_errors/);
  assert.match(son, /step: unreachable/);
});

test('SPI5 playbook: bastionsuz - yalniz localhost ve spi_nginx; OCP / kimlik dosyasi yok; ocp alani yok', () => {
  const hedefler = plays().map((p) => /\n {2}hosts: (\S+)/.exec(p)?.[1]);
  assert.deepEqual(hedefler, ['localhost', 'spi_nginx', 'localhost']);
  for (const yasak of [
    /terminal_hosts/,
    /ocp_clusters/,
    /spi_terminal/,
    /credentials\.yaml/,
    /bmw_openshift_jobs/,
    /\boc_bin/,
    /spa_package_ocp/,
    /spa_package_merge/,
    /'ocp':/,
    /step: ocp/,
    /appjson/i,
  ])
    assert.ok(!yasak.test(PB), `playbookta OCP / bastion izi: ${yasak}`);
  assert.match(gorev('Run the host script per item'), /\n\s+no_log: true/);
  const sonuc = gorev('Result per item');
  assert.match(sonuc, /'version': item\.version,\n\s+'hosts':/, 'sonuc kalemi bicimi');
  assert.ok(!/'cluster'/.test(sonuc), 'sonuc kalemi cluster tasiyor');
});

test('SPI6 playbook: girdi kapisi assert kurallari', () => {
  const kapi = plays()[0];
  const beklenen = [
    "spi_mode in ['plan', 'apply']",
    'spi_items | length >= 1',
    'spi_items | length <= 50',
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
    "spi_config_url_re: '^https://([A-Za-z0-9-]{1,63}[.])+[A-Za-z][A-Za-z0-9-]{0,62}/config$'",
    'item.namespace == (item.namespace | trim)',
    'item.application == (item.application | trim)',
    'item.version == (item.version | trim)',
    "(item.config_urls | map('trim') | list) == item.config_urls",
    "(item.config_urls | map('length') | max) <= 268",
    'item.config_urls | length >= 1',
    'item.config_urls | length <= 3',
    "(item.config_urls | select('string') | select('match', spi_config_url_re) | list | length) == (item.config_urls | length)",
    '(item.config_urls | unique | length) == (item.config_urls | length)',
  ];
  for (const b of beklenen) assert.ok(kapi.includes(b), `girdi kapisinda yok: ${b}`);
  assert.match(kapi, /ansible\.builtin\.assert[\s\S]*add_host/, 'add_host kapidan once');
});

test('SPI41 config_urls deseni: Portal adresi gecer, port / yol / http / kullanici / IP / localhost gecmez; uc yerde ayni', () => {
  // Desen JS ile sinanir (anchor'lar disinda JS ve Python re burada ayni davranir); Python '$'in
  // sondaki satir sonunu kabul etmesi SPI48'de gercek Python re + Jinja ile sinanir.
  const desen = /spi_config_url_re: '([^']+)'/.exec(PB)?.[1];
  assert.ok(desen, 'spi_config_url_re yok');
  const re = new RegExp(desen);
  for (const iyi of [CFG(1), 'https://a-b.c.invalid/config', 'https://x1.apps.c-2.invalid/config'])
    assert.ok(re.test(iyi), `reddedildi: ${iyi}`);
  for (const kotu of [
    'http://cfg1.invalid/config',
    'https://cfg1.invalid/config/',
    'https://cfg1.invalid:8443/config',
    'https://cfg1.invalid/config?x=1',
    'https://user@cfg1.invalid/config',
    'https://cfg 1.invalid/config',
    'https://cfg1.invalid/ready',
    'https://169.254.169.254/config',
    'https://127.0.0.1/config',
    'https://localhost/config',
    'https://intranetapp/config',
    'https://a.b.123/config',
    'https://cfg1.invalid./config',
  ])
    assert.ok(!re.test(kotu), `kabul edildi: ${kotu}`);
  // Ayni desen Portal'da (host) ve betikte (url): biri gevserse digerleri onu yakalamaz.
  const portal = fs.readFileSync(
    path.join(__dirname, '..', '..', 'spa-report', 'paket-kurulum.cjs'),
    'utf8',
  );
  const portalHost = /const ROUTE_HOST_RE = \/\^(.+)\$\/;/.exec(portal)?.[1];
  assert.equal(
    `^https://${portalHost}/config$`,
    desen,
    'Portal ROUTE_HOST_RE playbook deseninden farkli',
  );
  const betikDesen = /^CFG_URL_RE='([^']+)'$/m.exec(fs.readFileSync(HOST_SH, 'utf8'))?.[1];
  assert.equal(`^${betikDesen}$`, desen, 'betik CFG_URL_RE playbook deseninden farkli');
  const kos = gorev('Run the host script per item');
  assert.match(kos, /SPI_CONFIG_URLS: "\{\{ item\.config_urls \| join\(' '\) \}\}"/);
  assert.match(
    kos,
    /SPI_PYTHON: "\{\{ ansible_facts\['discovered_interpreter_python'\] \| default\('', true\) \}\}"/,
  );
  assert.match(gorev('Jobs per nginx host'), /'config_urls': item\.0\.config_urls/);
});

test('SPI7 playbook: kurum degerinin varsayilani yok, sabit adres / sunucu yok', () => {
  for (const m of PB.matchAll(/spi_package_base_url \| default\(([^)]*)\)/g))
    assert.equal(m[1], "'', true", `spi_package_base_url varsayilani: ${m[1]}`);
  for (const m of PB.matchAll(/spi_allowed_hosts[^|\n]*\| default\(([^)]*)\)/g))
    assert.equal(m[1], '[], true', `spi_allowed_hosts varsayilani: ${m[1]}`);
  assert.ok(!/https:\/\/[a-z0-9]/i.test(PB), 'playbookta sabit https adresi');
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(PB), 'playbookta IP');
});

test('SPI8 playbook: gecici betik, sha1 dogrulama, timeout -k, temizlik', () => {
  assert.match(PB, /prefix: \.spa_package_host\./);
  assert.equal((PB.match(/checksum_algorithm: sha1/g) || []).length, 2);
  assert.match(PB, /timeout -k 10 \{\{ spi_run_timeout \}\} bash/);
  assert.match(gorev('Remove the script'), /state: absent/);
  assert.match(PB, /Host fails when the script remains/);
  assert.match(
    gorev('Run the host script per item'),
    /== \(hostvars\['localhost'\]\.spi_host_src_sha1 \| default\('x'\)\)/,
  );
});

test('SPI9 playbook: betige stdin gitmez; job numarasi ve TLS bayragi', () => {
  const kos = gorev('Run the host script per item');
  assert.ok(!/\bstdin:/.test(kos), 'betige stdin gidiyor (application.json artik /configten)');
  assert.match(kos, /SPI_JOB_NO: "\{\{ hostvars\['localhost'\]\.spi_job_no \}\}"/);
  assert.match(
    kos,
    /SPI_INSECURE: "\{\{ '0' if \(hostvars\['localhost'\]\.spi_validate_certs \| default\(true\) \| bool\) else '1' \}\}"/,
  );
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

// /config adresleri https://cfg<n>.invalid/config: cevap FAKE_CFG<n>_RC (curl cikis kodu),
// FAKE_CFG<n>_CODE (HTTP, varsayilan 200) ve FAKE_CFG<n>_BODY (govde dosyasi; varsayilan
// FAKE_CFG_BODY) ile verilir.
const SAHTE_CURL = [
  '#!/bin/bash',
  'echo "curl $*" >> "$CALLS"',
  'out=""; head=0; w=""; url=""; resolve=0; hdr=""',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    -sSI) head=1 ;;',
  '    -o) out="$2"; shift ;;',
  '    -w) w="$2"; shift ;;',
  '    -D) hdr="$2"; shift ;;',
  '    --resolve) resolve=1; shift ;;',
  '    --max-time|--max-redirs|--proto|--proto-redir|--max-filesize) shift ;;',
  '    https://*) url="$1" ;;',
  '  esac',
  '  shift',
  'done',
  // /config: basliklar -D dosyasina, govde -o hedefine ("-" = stdout). FAKE_CFG<n>_STREAM=1:
  // Content-Length'siz akan govde (64 KB parcalar, en cok 1000); yazilan parca sayisi $CALLS.stream'e.
  'if [ $resolve = 0 ] && [[ "$url" =~ ^https://cfg([0-9])\\.invalid/config$ ]]; then',
  '  n=${BASH_REMATCH[1]}',
  '  rcv="FAKE_CFG${n}_RC"; codev="FAKE_CFG${n}_CODE"; bodyv="FAKE_CFG${n}_BODY"; strv="FAKE_CFG${n}_STREAM"',
  '  [ "${!rcv:-0}" = 0 ] || exit "${!rcv}"',
  '  [ -n "$hdr" ] && printf \'HTTP/1.1 %s X\\r\\n\\r\\n\' "${!codev:-200}" > "$hdr"',
  '  [ "$out" = - ] || exec > "$out"',
  '  if [ "${!strv:-0}" = 1 ]; then',
  "    parca=$(printf '%065536d' 0); i=0",
  '    while [ $i -lt 1000 ]; do printf \'%s\' "$parca" || exit 23; i=$((i+1)); echo $i > "$CALLS.stream"; done',
  '    exit 0',
  '  fi',
  '  cat "${!bodyv:-$FAKE_CFG_BODY}" || exit 23',
  '  exit 0',
  'fi',
  'if [ $head = 1 ]; then',
  '  [ "${FAKE_HEAD_RC:-0}" = 0 ] || exit "$FAKE_HEAD_RC"',
  '  printf \'HTTP/1.1 %s X\\r\\nContent-Length: %s\\r\\n\' "${FAKE_HEAD_CODE:-200}" "${FAKE_CL:-2048}"',
  '  [ "${FAKE_CT-application/zip}" = - ] || printf \'Content-Type: %s\\r\\n\' "${FAKE_CT-application/zip}"',
  "  printf '\\r\\n'",
  '  exit 0',
  'fi',
  // Gercek sablon: /ready bir dizine alias, nginx sondaki '/' icin her zaman 301 doner (job 3590287).
  'if [ -n "$w" ]; then case "$url" in */ready) printf 301 ;; *) printf \'%s\' "${FAKE_VERIFY_CODE:-200}" ;; esac; exit 0; fi',
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
    tmp: path.join(kok, 'tmp'),
    govde: path.join(kok, 'govde'),
  };
  for (const b of BETIKLER)
    if (!eksik.includes(b)) yaz(path.join(d.scripts, `nginx_${b}.sh`), SAHTE_NGINX);
  for (const x of [d.hys, d.apps, d.conf, d.tmp, d.govde]) fs.mkdirSync(x, { recursive: true });
  yaz(d.curl, SAHTE_CURL);
  yaz(d.unzip, SAHTE_UNZIP);
  fs.writeFileSync(d.calls, '');
  fs.writeFileSync(path.join(d.govde, 'gecerli.json'), APPJSON);
  return d;
}

/** /config govdesi olarak kullanilacak dosyayi yazar; betige verilecek (posix) yolu dondurur. */
function govde(d, ad, icerik) {
  const f = path.join(d.govde, ad);
  fs.writeFileSync(f, icerik);
  return posixYol(f);
}

/** Betigi kosturur; RESULT satirini ve cagrilari dondurur. */
function hostKos(d, env = {}) {
  const r = spawnSync(BASH, [posixYol(HOST_SH)], {
    encoding: 'utf8',
    input: '',
    env: {
      ...process.env,
      SPI_MODE: 'apply',
      SPI_NS: NS,
      SPI_APP: APP,
      SPI_VERSION: VER,
      SPI_JOB_NO: JOB,
      SPI_ZIP_URL: URL,
      SPI_CONFIG_URLS: CFG(1),
      SPI_PYTHON: PY || '',
      FAKE_CFG_BODY: posixYol(path.join(d.govde, 'gecerli.json')),
      TMPDIR: posixYol(d.tmp),
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
  assert.deepEqual(
    fs.readdirSync(d.tmp).filter((f) => f.startsWith('.spa_package_cfg')),
    [],
    'kosuya ozel /config gecici dizini silinmedi',
  );
  assert.ok(!r.stdout.includes('api.invalid'), `/config icerigi ciktiya yazildi:\n${r.stdout}`);
  assert.ok(!/cfg\d\.invalid/.test(r.stdout), `/config adresi ciktiya yazildi:\n${r.stdout}`);
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
      const s = hostKos(d, { SPI_MODE: 'plan' });
      assert.equal(s.status, 'PLAN_OK', s.r.stdout);
      assert.equal(s.step, 'check');
      assert.equal(s.r.status, 0);
      assert.equal(fs.existsSync(hysDir(d)), false, 'plan /hysdeploy dizini acti');
      assert.deepEqual(nginxCagrilari(s.calls), []);
      const curl = curlCagrilari(s.calls);
      assert.equal(curl.length, 2);
      assert.match(curl[0], /-sSI/);
      assert.match(curl[1], /--proto =https --proto-redir =https/);
      assert.match(curl[1], /--max-filesize 1048576 /);
      assert.match(curl[1], /--max-time 30 /);
      assert.ok(curl[1].endsWith(` ${CFG(1)}`), curl[1]);
      assert.match(s.message, /application\.json 1\. config adresinden alindi/);
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
      const s = hostKos(d, { SPI_MODE: 'plan', FAKE_CT: ct });
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
    const s = hostKos(d, { SPI_MODE: 'plan', SPI_HYS_ROOT: posixYol(path.join(d.kok, 'yok')) });
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
      const s = hostKos(d, { SPI_MODE: 'plan' });
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
      // /ready dogrulanmaz: sablonda dizine alias, her zaman 301 (job 3590287); kok (index.html) ve /config 200.
      for (const yol of ['/', '/config']) {
        assert.ok(
          dogrulama.some(
            (c) =>
              c.includes(`${APP}-${NS}.apps.invalid:443:192.0.2.10`) &&
              c.endsWith(`${APP}-${NS}.apps.invalid${yol}`),
          ),
          `${yol} dogrulanmadi`,
        );
      }
      assert.ok(!dogrulama.some((c) => c.endsWith('/ready')), '/ready dogrulanmamali');
      assert.ok(!s.message.includes('apps.invalid'), 'mesajda server_name');
    }),
);

test('SPI19 host: kok adres 200 degilse FAIL verify ve geri alma', { skip: SKIP }, () =>
  sahteIle([], (d) => {
    const s = hostKos(d, { FAKE_VERIFY_CODE: '404' });
    assert.equal(s.step, 'verify');
    assert.match(s.message, /^\/ HTTP 404 \(beklenen 200\)/);
    assert.equal(nginxCagrilari(s.calls).at(-1), `nginx_delete.sh 2 ${NS} ${APP}`);
  }),
);

test(
  'SPI20 host: gecersiz girdi (config adresleri dahil) FAIL check, hicbir adrese ve betiklere gidilmez',
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
      { SPI_CONFIG_URLS: '' },
      { SPI_CONFIG_URLS: 'http://cfg1.invalid/config' },
      { SPI_CONFIG_URLS: 'https://cfg1.invalid/ready' },
      { SPI_CONFIG_URLS: 'https://cfg1.invalid:8443/config' },
      { SPI_CONFIG_URLS: 'https://u@cfg1.invalid/config' },
      { SPI_CONFIG_URLS: `${CFG(1)} ${CFG(1)}` },
      { SPI_CONFIG_URLS: [1, 2, 3, 4].map(CFG).join(' ') },
      // Satir sonu: read -a yalniz ilk satiri okurdu, ikinci adres sessizce duserdi.
      { SPI_CONFIG_URLS: `${CFG(1)}\n${CFG(2)}` },
      { SPI_CONFIG_URLS: `${CFG(1)}\n` },
      { SPI_CONFIG_URLS: `${CFG(1)}  ${CFG(2)}` },
      { SPI_CONFIG_URLS: ` ${CFG(1)}` },
      { SPI_CONFIG_URLS: 'https://169.254.169.254/config' },
      { SPI_CONFIG_URLS: 'https://127.0.0.1/config' },
      { SPI_CONFIG_URLS: 'https://localhost/config' },
      {
        SPI_CONFIG_URLS: `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.invalid/config`,
      },
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
    const s = hostKos(d, { SPI_MODE: 'plan' });
    assert.match(s.message, /eksik deployment betigi.*nginx_reload\.sh/);
  });
  sahteIle([], (d) => {
    const s = hostKos(d, { SPI_MODE: 'plan', FAKE_HEAD_CODE: '404' });
    assert.equal(s.status, 'FAIL');
    assert.match(s.message, /HTTP 404/);
  });
  sahteIle([], (d) => {
    const s = hostKos(d, { SPI_MODE: 'plan', SPI_MAX_ZIP_MB: '1', FAKE_CL: '2097152' });
    assert.equal(s.status, 'FAIL');
    assert.match(s.message, /cok buyuk/);
  });
  sahteIle([], (d) => {
    const s = hostKos(d, { SPI_MODE: 'plan', SPI_INSECURE: '1' });
    assert.equal(s.status, 'PLAN_OK');
    assert.match(curlCagrilari(s.calls)[0], / -k /);
  });
});

// -- /config (application.json kaynagi) ----------------------------------------------------------

const ONE_MB = 1048576;

test(
  'SPI22 host: /config bos yanit FAIL config; plan ve apply hicbir sey yazmaz, paket indirilmez',
  { skip: SKIP },
  () => {
    for (const mod of ['plan', 'apply']) {
      sahteIle([], (d) => {
        const s = hostKos(d, { SPI_MODE: mod, FAKE_CFG_BODY: govde(d, 'bos.json', '') });
        assert.equal(s.status, 'FAIL', s.r.stdout);
        assert.equal(s.step, 'config');
        assert.equal(s.r.status, 1);
        assert.match(
          s.message,
          /^application\.json \/config'ten alinamadi \(1\. adres: bos yanit\)$/,
        );
        assert.equal(fs.existsSync(hysDir(d)), false, `${mod}: /hysdeploy dizini acildi`);
        assert.equal(fs.existsSync(nsDir(d)), false);
        assert.deepEqual(nginxCagrilari(s.calls), []);
        assert.ok(
          !curlCagrilari(s.calls).some((c) => c.includes(' -o ') && c.endsWith(URL)),
          'config gecmeden paket indirildi',
        );
      });
    }
  },
);

test(
  'SPI42 host: /config HTML, dizi, gecersiz JSON, 404, erisilemez, 1 MB ustu -> FAIL config',
  { skip: SKIP },
  () => {
    const durumlar = [
      [{ body: '<!DOCTYPE html>\n<html><body>giris</body></html>' }, 'HTML dondu \\(JSON degil\\)'],
      [{ body: '  \n <html></html>' }, 'HTML dondu \\(JSON degil\\)'],
      [{ body: '[{"a":1}]' }, 'JSON nesnesi degil \\(dizi ya da tek deger\\)'],
      [{ body: '"metin"' }, 'JSON nesnesi degil \\(dizi ya da tek deger\\)'],
      [{ body: '{"a":' }, 'gecerli JSON degil'],
      [{ body: '{"a":1} fazla' }, 'gecerli JSON degil'],
      [{ code: '404' }, 'HTTP 404'],
      [{ code: '302' }, 'HTTP 302'],
      [{ rc: '6' }, 'erisilemedi \\(curl rc=6\\)'],
      [{ rc: '63' }, '1 MB ustu'],
      [{ body: JSON.stringify({ a: 'x'.repeat(ONE_MB) }) }, '1 MB ustu'],
    ];
    for (const [cevap, beklenen] of durumlar) {
      for (const mod of ['plan', 'apply']) {
        sahteIle([], (d) => {
          const env = { SPI_MODE: mod };
          if (cevap.body !== undefined) env.FAKE_CFG1_BODY = govde(d, 'c.json', cevap.body);
          if (cevap.code) env.FAKE_CFG1_CODE = cevap.code;
          if (cevap.rc) env.FAKE_CFG1_RC = cevap.rc;
          const s = hostKos(d, env);
          const ad = `${mod} ${JSON.stringify(cevap).slice(0, 60)}`;
          assert.equal(s.status, 'FAIL', `${ad}: ${s.r.stdout}`);
          assert.equal(s.step, 'config', ad);
          assert.match(s.message, new RegExp(`\\(1\\. adres: ${beklenen}\\)$`), ad);
          assert.equal(fs.existsSync(hysDir(d)), false, `${ad}: yazildi`);
          assert.deepEqual(nginxCagrilari(s.calls), [], ad);
        });
      }
    }
  },
);

test(
  'SPI43 host: ilk adres duserse sonraki denenir; mesaj sira numarasini yazar, adresi yazmaz',
  { skip: SKIP },
  () => {
    sahteIle([], (d) => {
      const s = hostKos(d, {
        SPI_MODE: 'plan',
        SPI_CONFIG_URLS: `${CFG(1)} ${CFG(2)}`,
        FAKE_CFG1_CODE: '404',
      });
      assert.equal(s.status, 'PLAN_OK', s.r.stdout);
      assert.match(s.message, /application\.json 2\. config adresinden alindi/);
      const cfg = curlCagrilari(s.calls).filter(
        (c) => c.endsWith('/config') && !c.includes('--resolve'),
      );
      assert.deepEqual(
        cfg.map((c) => c.split(' ').at(-1)),
        [CFG(1), CFG(2)],
      );
    });
    // Ilk gecerli alinir; sonraki adrese gidilmez.
    sahteIle([], (d) => {
      const s = hostKos(d, { SPI_MODE: 'plan', SPI_CONFIG_URLS: `${CFG(1)} ${CFG(2)} ${CFG(3)}` });
      assert.equal(s.status, 'PLAN_OK', s.r.stdout);
      const cfg = curlCagrilari(s.calls).filter((c) => c.endsWith('/config'));
      assert.equal(cfg.length, 1, 'gecerli ilk adresten sonra digerlerine gidildi');
    });
    // Ucu de duser: her birinin nedeni sirayla.
    sahteIle([], (d) => {
      const s = hostKos(d, {
        SPI_MODE: 'apply',
        SPI_CONFIG_URLS: `${CFG(1)} ${CFG(2)} ${CFG(3)}`,
        FAKE_CFG1_CODE: '404',
        FAKE_CFG2_BODY: govde(d, 'html', '<html></html>'),
        FAKE_CFG3_BODY: govde(d, 'dizi', '[]'),
      });
      assert.equal(s.step, 'config');
      assert.equal(
        s.message,
        "application.json /config'ten alinamadi (1. adres: HTTP 404; 2. adres: HTML dondu (JSON degil); 3. adres: JSON nesnesi degil (dizi ya da tek deger))",
      );
      assert.equal(fs.existsSync(hysDir(d)), false);
    });
  },
);

test(
  'SPI44 host apply: yazilan application.json /config icerigiyle bayt bayt ayni (ikinci adresten)',
  { skip: SKIP },
  () =>
    sahteIle([], (d) => {
      const icerik = Buffer.from(
        '﻿{\r\n  "baslik": "Gelir özeti",\r\n  "liste": [1, 2],\r\n  "ic": {"x": null}\r\n}',
        'utf8',
      );
      const ikinci = path.join(d.govde, 'ikinci.json');
      fs.writeFileSync(ikinci, icerik);
      const s = hostKos(d, {
        SPI_CONFIG_URLS: `${CFG(1)} ${CFG(2)}`,
        FAKE_CFG1_BODY: govde(d, 'html', '<html>oturum</html>'),
        FAKE_CFG2_BODY: posixYol(ikinci),
      });
      assert.equal(s.status, 'OK', s.r.stdout);
      assert.match(s.message, /application\.json 2\. config adresinden/);
      const yazilan = fs.readFileSync(path.join(hysDir(d), 'application.json'));
      assert.ok(yazilan.equals(icerik), 'application.json /config icerigiyle ayni degil');
      if (process.platform !== 'win32')
        assert.equal(fs.statSync(path.join(hysDir(d), 'application.json')).mode & 0o777, 0o644);
      assert.ok(
        !fs.readdirSync(hysDir(d)).some((f) => f.startsWith('.application.json')),
        'gecici application.json kaldi',
      );
    }),
);

test('SPI45 host: SPI_INSECURE=1 /config isteginde de -k; varsayilanda yok', { skip: SKIP }, () => {
  for (const [insecure, beklenen] of [
    ['0', false],
    ['1', true],
  ]) {
    sahteIle([], (d) => {
      const s = hostKos(d, { SPI_MODE: 'plan', SPI_INSECURE: insecure });
      assert.equal(s.status, 'PLAN_OK', s.r.stdout);
      const cfg = curlCagrilari(s.calls).find((c) => c.endsWith(CFG(1)));
      assert.equal(/ -k /.test(cfg), beklenen, cfg);
    });
  }
});

test(
  "SPI46 host: SPI_PYTHON yoksa ya da gecersizse PATH'teki python bulunur",
  { skip: SKIP },
  () => {
    const pathte = spawnSync(BASH, ['-c', 'command -v python3 || command -v python'], {
      encoding: 'utf8',
    });
    if (pathte.status !== 0) return;
    for (const py of ['', '/yok/python3']) {
      sahteIle([], (d) => {
        const s = hostKos(d, { SPI_MODE: 'plan', SPI_PYTHON: py });
        assert.equal(s.status, 'PLAN_OK', `${py}: ${s.r.stdout}`);
      });
    }
  },
);

test('SPI28 betik ASCII ve set -u; files/ altinda yalniz host betigi (OCP / birlestirme betigi yok)', () => {
  const s = fs.readFileSync(HOST_SH, 'utf8');
  assert.match(s, /^#!\/bin\/bash\n/);
  assert.match(s, /\nset -u\n/);
  assert.ok(!/[^\t\n\x20-\x7e]/.test(s), 'ASCII disi karakter: spa_package_host.sh');
  assert.deepEqual(fs.readdirSync(path.join(DIR, 'files')), ['spa_package_host.sh']);
  assert.ok(!/base64/.test(s), 'betik hala base64 / stdin bekliyor');
  assert.match(s, /^CFG_MAX=1048576$/m);
  assert.match(s, /fetch_one_config\(\) \{[\s\S]*--proto '=https' --proto-redir '=https'/);
});

test(
  "SPI47 host: Content-Length'siz akan /config govdesi 1 MB + bir parcada kesilir (indirme sinirli)",
  { skip: SKIP },
  () => {
    for (const mod of ['plan', 'apply']) {
      sahteIle([], (d) => {
        const s = hostKos(d, { SPI_MODE: mod, FAKE_CFG1_STREAM: '1' });
        assert.equal(s.status, 'FAIL', s.r.stdout);
        assert.equal(s.step, 'config');
        assert.match(s.message, /\(1\. adres: 1 MB ustu\)$/);
        // 64 KB parcalar: 1 MB'a 16 parca; boru tamponu birkac parca daha alir. Sinirsiz indirme
        // 1000 parcanin (64 MB) hepsini yazar.
        const yazilan = Number(fs.readFileSync(`${d.calls}.stream`, 'utf8').trim());
        assert.ok(yazilan >= 16 && yazilan < 100, `akan govde kesilmedi: ${yazilan} parca`);
        assert.equal(fs.existsSync(hysDir(d)), false);
      });
    }
  },
);

// -- Girdi kapisi gercek Python re + Jinja ile ---------------------------------------------------
// Ansible 'match' testi Python re.match'tir ve '$' sondaki '\n'i kabul eder; JS RegExp bunu gormez.
// Ansible bu makinede yok: kapinin 'Item format' kosullari duz jinja2 ile, Ansible'in match / regex
// testleri ve difference filtresinin esdegeriyle degerlendirilir (Templar degil; kosullar yalniz
// bunlari kullanir - SPI48 kullanilan test / filtre listesini de kilitler).
const KAPI_HARNESS = [
  'import json, re, sys, yaml, jinja2',
  'pb = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))',
  'play = pb[0]',
  'task = next(t for t in play["tasks"] if t["name"] == "Item format")',
  'that = task["ansible.builtin.assert"]["that"]',
  'env = jinja2.Environment()',
  'env.tests["match"] = lambda v, p: re.match(p, v) is not None',
  'env.filters["difference"] = lambda a, b: [x for x in dict.fromkeys(a) if x not in b]',
  // Ansible'in unique'i liste dondurur (jinja2'ninki uretec: '| length' patlar).
  'env.filters["unique"] = lambda a: list(dict.fromkeys(a))',
  'out = {}',
  'for ad, item in json.loads(sys.stdin.read()).items():',
  '    sonuc = []',
  '    for kosul in that:',
  '        try:',
  '            t = env.from_string("{% if " + kosul + " %}1{% else %}0{% endif %}")',
  '            sonuc.append(t.render(item=item, spi_allowed_hosts=["NGINXP01", "nginxp02"], **play["vars"]))',
  '        except Exception as e:',
  '            sonuc.append("hata: " + type(e).__name__)',
  '    out[ad] = sonuc',
  'print(json.dumps({"that": that, "out": out}))',
  '',
].join('\n');

test('SPI48 girdi kapisi Python re + Jinja: sondaki satir sonu, IP / localhost adresi, izinsiz sunucu gecmez', () => {
  const py = pythonBul();
  assert.ok(
    py,
    'SPI48 KOR: python3 + jinja2 + PyYAML bulunamadi (PORTAL_TEST_PYTHON ile gosterin)',
  );
  const iyi = {
    id: `${NS}/${APP}`,
    namespace: NS,
    application: APP,
    version: VER,
    cluster: 'arkprod1',
    hosts: ['NGINXP01', 'NGINXP02'],
    config_urls: [CFG(1), CFG(2)],
  };
  const durumlar = {
    iyi,
    urlSatirSonu: { ...iyi, config_urls: [`${CFG(1)}\n`] },
    urlIcindeSatir: { ...iyi, config_urls: [`${CFG(1)}\n${CFG(2)}`] },
    nsSatirSonu: { ...iyi, namespace: `${NS}\n`, id: `${NS}\n/${APP}` },
    appSatirSonu: { ...iyi, application: `${APP}\n`, id: `${NS}/${APP}\n` },
    surumSatirSonu: { ...iyi, version: `${VER}\n` },
    ip: { ...iyi, config_urls: ['https://169.254.169.254/config'] },
    localhost: { ...iyi, config_urls: ['https://localhost/config'] },
    uzun: {
      ...iyi,
      config_urls: [
        `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.invalid/config`,
      ],
    },
    tekrar: { ...iyi, config_urls: [CFG(1), CFG(1)] },
    dort: { ...iyi, config_urls: [1, 2, 3, 4].map(CFG) },
    sayi: { ...iyi, config_urls: [5] },
    izinsiz: { ...iyi, hosts: ['NGINXP09'] },
  };
  const r = spawnSync(py.komut, [...py.on, '-c', KAPI_HARNESS, PLAYBOOK], {
    input: JSON.stringify(durumlar),
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(r.status, 0, r.stderr);
  const { that, out } = JSON.parse(r.stdout);
  // Kosullar yalniz harness'in esdegerini sagladigi Ansible test / filtrelerini kullanir.
  const ansibleOzel = new Set(
    that.flatMap((k) => [...k.matchAll(/(?:is|\|)\s*(?:not\s+)?([a-z_]+)/g)].map((m) => m[1])),
  );
  const bilinen = new Set([
    'mapping',
    'defined',
    'string',
    'match',
    'sequence',
    'length',
    'select',
    'list',
    'unique',
    'difference',
    'map',
    'trim',
    'max',
  ]);
  assert.deepEqual(
    [...ansibleOzel].filter((x) => !bilinen.has(x)),
    [],
    'harness kapsamadigi test / filtre',
  );
  assert.deepEqual(
    out.iyi,
    that.map(() => '1'),
    `gecerli kalem reddedildi: ${JSON.stringify(out.iyi)}`,
  );
  for (const [ad, sonuc] of Object.entries(out)) {
    if (ad === 'iyi') continue;
    assert.ok(
      sonuc.some((x) => x !== '1'),
      `kapidan gecti: ${ad}`,
    );
  }
  // Kanit: Python re '$' sondaki satir sonunu kabul eder; bu durumu yalniz trim kosulu yakalar.
  const desenKosulu = that.findIndex((k) => k.includes("select('match', spi_config_url_re)"));
  const trimKosulu = that.findIndex((k) => k.includes("map('trim')"));
  assert.equal(out.urlSatirSonu[desenKosulu], '1', "Python re '$' davranisi degisti mi?");
  assert.equal(out.urlSatirSonu[trimKosulu], '0');
  const nsDesen = that.findIndex((k) => k.includes('item.namespace is match(spi_ns_re)'));
  assert.equal(out.nsSatirSonu[nsDesen], '1');
});
