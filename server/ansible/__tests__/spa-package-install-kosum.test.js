// server/ansible/__tests__/spa-package-install-kosum.test.js - SPA paket kurulumu playbook'u GERCEK ansible-playbook
// ile (2026-11-24, PR-R). spa_package_install/ gecici dizine kopyalanir; files/spa_package_host.sh yerine gercek
// bicimde RESULT satiri basan sahte betik konur (kaynak ve kopya ayni dosya: sha1 kapisi gecer); Nginx sunucusu yerel
// baglantidir (ansible_become=false: dzdo yok).
//
// NEDEN (playbook-denetci, 2026-11-24): tek sunuculuk partide temizlik sirasinda baglanti koparsa "Host fails when
// the script remains" assert'i tum partiyi dusuruyor, yayin play'i hic kosmuyor, set_stats yayinlanmiyordu (kurulum
// basarili bittiyse de); Portal "sonuc yayinlanmadi" diyor, 24 saatlik kapi OK kurulumu gormuyordu. Girdi kapisi
// duserse de sonuc yoktu. Sonuc satiri gelmeyen apply "yarim kurulum" demiyordu.
//   SK1 girdi kapisi duserse sonuc yine yayinlanir: error + bos items + failed; is FAILED
//   SK2 paket adresinde kimlik bilgisi ('@') kapida reddedilir (adres sunucuda curl komut satirina gider)
//   SK3 temizlikte sunucu koparsa sonuc yine yayinlanir (OK satiri + cleanup_errors), is SONRA FAILED
//   SK4 apply'da sonuc satiri gelmezse mesaj yarim kurulumu ve nginx_delete.sh komutunu soyler
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ansiblePythonu } = require('./fixtures/python-bul.cjs');

const KAYNAK = path.join(__dirname, '..', 'playbooks', 'bmw_portal', 'spa_package_install');
const VAR = (komut) => spawnSync(komut, ['--version'], { stdio: 'ignore' }).status === 0;
const ATLA = {
  skip:
    (process.platform === 'win32' && 'POSIX kabuk gerekir') ||
    (!VAR('ansible-playbook') && 'ansible-playbook yok') ||
    (!VAR('timeout') && 'timeout yok (coreutils)'),
};
const NS = 'musteri-gelir-prod';
const APP = 'gelir-app-v0';

/** Gecici kopya. sahte: host betiginin govdesi. kopar: betik calisinca NGXA ulasilamaz olur. */
function ortam(sahte, { kopar = false } = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-pkg-kosum-'));
  const dizin = path.join(kok, 'spa_package_install');
  fs.cpSync(KAYNAK, dizin, { recursive: true });
  const baglanti = path.join(kok, 'baglanti');
  fs.writeFileSync(baglanti, 'local');
  fs.writeFileSync(
    path.join(dizin, 'files', 'spa_package_host.sh'),
    ['#!/bin/bash', 'cat >/dev/null', kopar ? `echo ssh > '${baglanti}'` : '', sahte, ''].join(
      '\n',
    ),
  );
  const py = ansiblePythonu() || 'python3';
  const inv = path.join(kok, 'envanter.ini');
  fs.writeFileSync(
    inv,
    [
      `localhost ansible_connection=local ansible_python_interpreter=${py}`,
      `NGXA ansible_become=false ansible_python_interpreter=${py}`,
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(kok, 'host_vars'));
  fs.writeFileSync(
    path.join(kok, 'host_vars', 'NGXA.yml'),
    [
      `ansible_connection: "{{ lookup('file', '${baglanti}') }}"`,
      'ansible_host: 127.0.0.1',
      'ansible_port: 1',
      'ansible_ssh_common_args: "-o ConnectTimeout=2"',
      '',
    ].join('\n'),
  );
  return { kok, dizin, inv };
}

function oynat(o, ek = {}) {
  const ev = {
    spi_mode: 'apply',
    spi_items: [
      {
        id: `${NS}/${APP}`,
        namespace: NS,
        application: APP,
        version: '0.8.0',
        cluster: 'arkprod1',
        hosts: ['NGXA'],
        config_urls: ['https://cfg1.invalid/config'],
      },
    ],
    spi_package_base_url: 'https://repo.invalid/artifactory/ark',
    spi_allowed_hosts: ['NGXA'],
    tower_job_id: 4242,
    ...ek,
  };
  const r = spawnSync(
    'ansible-playbook',
    ['-i', o.inv, path.join(o.dizin, 'spa_package_install.yml'), '-e', JSON.stringify(ev)],
    {
      encoding: 'utf8',
      cwd: o.kok,
      env: {
        ...process.env,
        ANSIBLE_SHOW_CUSTOM_STATS: 'True',
        ANSIBLE_STDOUT_CALLBACK: 'default',
        ANSIBLE_NOCOLOR: '1',
        ANSIBLE_RETRY_FILES_ENABLED: 'False',
        ANSIBLE_HOST_KEY_CHECKING: 'False',
      },
      timeout: 240000,
    },
  );
  const satir = r.stdout.split('\n').find((s) => s.includes('RUN: {'));
  const stats = satir
    ? JSON.parse(satir.slice(satir.indexOf('{'))).spa_package_install_result
    : null;
  return { ...r, stats };
}

const OK = `printf 'RESULT\\tOK\\tcleanup\\tkuruldu\\n'`;

test('SK1 girdi kapisi duserse sonuc yayinlanir: error + bos items', ATLA, () => {
  const o = ortam(OK);
  try {
    const r = oynat(o, { spi_items: [] });
    assert.notEqual(r.status, 0);
    assert.ok(r.stats, `kapi hatasinda set_stats yok\n${r.stdout.slice(-1500)}`);
    assert.equal(r.stats.overall, 'failed');
    assert.deepEqual(r.stats.items, []);
    assert.match(r.stats.error, /Zorunlu degiskenler eksik ya da gecersiz/);
  } finally {
    fs.rmSync(o.kok, { recursive: true, force: true });
  }
});

test("SK2 paket adresinde kimlik bilgisi ('@') kapida reddedilir", ATLA, () => {
  const o = ortam(OK);
  try {
    const r = oynat(o, { spi_package_base_url: 'https://kul:tok@repo.invalid/ark' });
    assert.notEqual(r.status, 0);
    assert.match(r.stats.error, /AWX sablon degiskenleri eksik ya da gecersiz/);
    assert.ok(!r.stdout.includes('kul:tok'), 'kimlik bilgisi ciktiya yazildi');
  } finally {
    fs.rmSync(o.kok, { recursive: true, force: true });
  }
});

test('SK3 temizlikte sunucu koparsa sonuc yine yayinlanir, is sonra FAILED', ATLA, () => {
  const o = ortam(OK, { kopar: true });
  try {
    const r = oynat(o);
    assert.notEqual(r.status, 0, 'silinemeyen gecici betige ragmen is yesil');
    assert.ok(r.stats, `temizlik hatasinda set_stats yok\n${r.stdout.slice(-2000)}`);
    assert.equal(r.stats.overall, 'ok', JSON.stringify(r.stats));
    assert.equal(r.stats.items[0].hosts[0].status, 'OK');
    assert.equal(r.stats.cleanup_errors.length, 1, JSON.stringify(r.stats.cleanup_errors));
    assert.match(
      r.stats.cleanup_errors[0],
      /^NGXA: gecici betik silinemedi ya da dogrulanamadi \(sunucuya erisilemedi\): /,
    );
  } finally {
    fs.rmSync(o.kok, { recursive: true, force: true });
  }
});

test('SK4 apply: sonuc satiri gelmezse yarim kurulum uyarisi', ATLA, () => {
  const o = ortam("echo '== pre_deployment'; exit 137");
  try {
    const r = oynat(o);
    assert.notEqual(r.status, 0);
    const h = r.stats.items[0].hosts[0];
    assert.equal(h.status, 'FAIL');
    assert.equal(
      h.message,
      `betik sonuc satiri vermedi (rc=137) - kurulum yarim kalmis olabilir: nginx_delete.sh ${NS} ${APP} ile inceleyin`,
    );
    assert.deepEqual(r.stats.cleanup_errors, []);
  } finally {
    fs.rmSync(o.kok, { recursive: true, force: true });
  }
});
