// server/ansible/__tests__/kurum-degiskenleri-kosum.test.js - kurum degerleri AWX template Variables'ta
// (2026-11-20, K17): playbook'larda sabit kurum sunucu adi yok; degisken TANIMSIZSA is acikca durur
// ve Portal'in okudugu sonuc (set_stats) YINE yayinlanir. GERCEK ansible-playbook ile.
//
// NEDEN: `delegate_to` atlanacak gorevde bile sablonlanir: TANIMSIZ degisken core 2.19+'da "is undefined",
// BOS ("") ya da null degisken HER surumde "Empty hostname produced from delegate_to" ile patlar. Localhost
// duser, son play'deki set_stats'a hic varilmaz, Portal sonucsuz bir FAILED gorurdu (2026-11-20/21 olculdu;
// opsx_was'ta islem YAPILDIKTAN sonra). Bu yuzden her delegate_to `default('yazici-sunucu-tanimsiz', true)`
// ile cozulemeyen bir yer tutucuya duser ve girdi kapisi degiskeni ilk gorevde ister (null da reddedilir).
// Her senaryo uc kipte: tanimsiz, bos, null.
//   KD1 nginx_loadtest: degiskenler eksikken girdi kapisi "AWX sablon degiskenleri eksik" der,
//       nginx_loadtest_result yayinlanir (dort kip tanimsiz; kosu / araclar bos ve null); degiskenler
//       verilince ayni kapi gecer (sonraki kural: EDU reddi).
//   KD2 nginx_console_fetch: kesif play'i atlanir, set_stats discovery_error "tanimli degil" der, is duser;
//       envanterde olmayan ad "envanterde yok" der (yanlis teshis "Sonuclar: []" degil).
//   KD3 nginx_console_push: girdi kapisi durur; hedefe hicbir gorev gitmez (null 'None' olup gecmez).
// Belge: docs/AWX-KOPYALAMA-HARITASI.md "Kurum degerleri".
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ansiblePythonu } = require('./fixtures/python-bul.cjs');

const PB = path.join(__dirname, '..', 'playbooks', 'bmw_portal');
const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;
const ATLA = { skip: !HAS_ANSIBLE && 'ansible-playbook yok' };

function envanter() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kurum-degisken-'));
  const inv = path.join(kok, 'envanter.ini');
  const py = ansiblePythonu() || 'python3';
  fs.writeFileSync(
    inv,
    [
      `localhost ansible_connection=local ansible_python_interpreter=${py}`,
      // Hedef olarak verilen ad ulasilamaz bir adrese gider: kapidan gecse bile bir sey yapamaz.
      "ORNGXT01 ansible_host=192.0.2.1 ansible_connection=ssh ansible_ssh_common_args='-o ConnectTimeout=2'",
      '',
    ].join('\n'),
  );
  return { kok, inv };
}

function oynat(playbook, ev) {
  const { kok, inv } = envanter();
  const r = spawnSync(
    'ansible-playbook',
    ['-i', inv, path.join(PB, playbook), '-e', JSON.stringify(ev)],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ANSIBLE_SHOW_CUSTOM_STATS: 'True',
        ANSIBLE_HOST_KEY_CHECKING: 'False',
        ANSIBLE_STDOUT_CALLBACK: 'default',
        ANSIBLE_NOCOLOR: '1',
        ANSIBLE_RETRY_FILES_ENABLED: 'False',
      },
      cwd: kok,
      timeout: 240000,
    },
  );
  const satir = r.stdout.split('\n').find((s) => s.includes('RUN: {'));
  const stats = satir ? JSON.parse(satir.slice(satir.indexOf('{'))) : null;
  return { ...r, stats, cikti: `${r.stdout}\n${r.stderr}` };
}

const EKSIK = {
  tanimsiz: {},
  bos: { portal_yazici_host: '', portal_edu_hostlari: '' },
  null: { portal_yazici_host: null, portal_edu_hostlari: null },
};
const PATLAMA = /is undefined|Empty hostname|cannot have empty values/;

const YT_TABAN = { yuk_run_id: '5', yuk_hedef_host: 'ORNGXT01', yuk_yuk_host: 'ORNGXT02' };
const YT_KIPLER = {
  on_kontrol: { ...YT_TABAN, yuk_islem: 'on_kontrol' },
  kosu: { ...YT_TABAN, yuk_islem: 'kosu' },
  durdur: { ...YT_TABAN, yuk_islem: 'durdur' },
  araclar: {
    yuk_islem: 'araclar',
    yuk_run_id: '5',
    yuk_derleme_host: 'ORNGXT01',
    yuk_k6_surum: 'v0.50.0',
    yuk_wrk_surum: '4.2.0',
    yuk_cikti_kok: '/sw/BMW_PORTAL/kd',
  },
};

const KD1_DURUMLAR = [
  ...Object.keys(YT_KIPLER).map((kip) => [kip, 'tanimsiz']),
  ['kosu', 'bos'],
  ['kosu', 'null'],
  ['araclar', 'bos'],
  ['araclar', 'null'],
];
for (const [kip, eksik] of KD1_DURUMLAR) {
  test(
    `KD1 nginx_loadtest (${kip}, ${eksik}): AWX degiskenleri eksikken kapi durur, sonuc yayinlanir`,
    ATLA,
    () => {
      const r = oynat('nginx_loadtest/nginx_loadtest.yml', { ...YT_KIPLER[kip], ...EKSIK[eksik] });
      assert.notEqual(r.status, 0, 'is basarili bitmemeli');
      assert.doesNotMatch(r.cikti, PATLAMA, 'eksik degisken sablonlamada patladi');
      const sonuc = r.stats?.nginx_loadtest_result;
      assert.ok(sonuc, `nginx_loadtest_result yayinlanmadi\n${r.stdout.slice(-1500)}`);
      assert.equal(sonuc.durum, 'FAIL');
      assert.match(String(sonuc.hata), /AWX sablon degiskenleri eksik: portal_yazici_host/);
    },
  );
}

test(
  'KD1 kontrol: degiskenler verilince AWX kapisi gecer (sonraki kural EDU reddi isler)',
  ATLA,
  () => {
    const r = oynat('nginx_loadtest/nginx_loadtest.yml', {
      ...YT_KIPLER.on_kontrol,
      yuk_hedef_host: 'ORNGXT51',
      portal_yazici_host: 'ORLABT02',
      portal_edu_hostlari: ['ORNGXT51'],
    });
    const sonuc = r.stats?.nginx_loadtest_result;
    assert.ok(sonuc, 'nginx_loadtest_result yayinlanmadi');
    assert.equal(sonuc.durum, 'FAIL');
    assert.doesNotMatch(String(sonuc.hata), /AWX sablon degiskenleri eksik/);
    assert.match(String(sonuc.hata), /EDU degil/, 'EDU hedef reddedilmeli');
  },
);

for (const eksik of Object.keys(EKSIK)) {
  test(`KD2 nginx_console_fetch (${eksik}): set_stats "tanimli degil" der`, ATLA, () => {
    const r = oynat('nginx_console/nginx_console_fetch.yml', {
      target_hosts: ['ORNGXT01'],
      ...EKSIK[eksik],
    });
    assert.notEqual(r.status, 0, 'is basarili bitmemeli');
    assert.doesNotMatch(r.cikti, PATLAMA, 'eksik degisken sablonlamada patladi');
    const sonuc = r.stats?.nginx_console_fetch_result;
    assert.ok(sonuc, `nginx_console_fetch_result yayinlanmadi\n${r.stdout.slice(-1500)}`);
    assert.match(String(sonuc.discovery_error), /portal_yazici_host tanimli degil/);
    assert.equal(Number(sonuc.ok_count), 0);
    assert.match(r.cikti, /Hedef kesfi basarisiz: portal_yazici_host tanimli degil/);
  });
}

test('KD2 nginx_console_fetch: envanterde olmayan yazici sunucu "envanterde yok" der', ATLA, () => {
  const r = oynat('nginx_console/nginx_console_fetch.yml', {
    target_hosts: ['ORNGXT01'],
    portal_yazici_host: 'ORYOKT99',
  });
  assert.notEqual(r.status, 0, 'is basarili bitmemeli');
  const sonuc = r.stats?.nginx_console_fetch_result;
  assert.ok(sonuc, 'nginx_console_fetch_result yayinlanmadi');
  assert.match(String(sonuc.discovery_error), /portal_yazici_host \(ORYOKT99\) envanterde yok/);
});

for (const eksik of Object.keys(EKSIK)) {
  test(`KD3 nginx_console_push (${eksik}): girdi kapisi durur, hedefe gorev gitmez`, ATLA, () => {
    const r = oynat('nginx_console/nginx_console_push.yml', {
      target_hosts: ['ORNGXT01'],
      file_path: '/usr/nginx/conf.d/kd.conf',
      mode: 'create',
      content_b64: Buffer.from('server {}\n').toString('base64'),
      ...EKSIK[eksik],
    });
    assert.notEqual(r.status, 0, 'is basarili bitmemeli');
    assert.doesNotMatch(r.cikti, PATLAMA);
    assert.match(r.cikti, /portal_yazici_host AWX template Variables'ta tanimli olmali/);
    assert.doesNotMatch(
      r.cikti,
      /PLAY \[--- \[Play\] Uygula ---\][^\n]*\n+TASK/,
      'hedefe gorev gitmemeli',
    );
  });
}
