// server/ansible/__tests__/scalex-sure-kirilimi.test.cjs
//
// KESIF SURE KIRILIMI — PLAYBOOK TARAFI (PR-O).
//
// AWX 3365168/81/88: runner 3-8 sn, is 40+ sn. Farkin nerede oldugu
// loglardaki zaman damgalarindan ELLE cikarildi. Playbook artik kendi
// paylarini (`hazirlik`, `tasima`, `yayin`) ve oyun baslangicini
// `scalex_discovery_result.playbook_timing` ile yayinliyor; portal AWX isinin
// created/started/finished alanlariyla birlestiriyor.
//
//   O1  damgalar dogru YERDE: oyun basi -> tasima basi -> tasima sonu -> yayin
//   O2  yayin gorevi GERCEK ansible ile kosar: paylar sayi, eksik damga -1
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { SCALEX_PKG: PKG } = require('../paths.cjs');
const APP = path.join(PKG, 'scalex_app');
const DISCOVERY = fs.readFileSync(path.join(APP, 'discovery.yml'), 'utf8');
const PUBLISH = path.join(APP, 'tasks', 'discovery', '25_publish_result.yml');

const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;

/** Yorum satirlari atilir: bekci kendi gerekcesini okuyup yesile donmesin. */
const kod = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

test('O1 damgalar dogru sirada: oyun basi < tasima basi < tasima include`lari < tasima sonu < yayin', () => {
  const d = kod(DISCOVERY);
  const yer = (s) => {
    const i = d.indexOf(s);
    assert.ok(i >= 0, `bulunamadi: ${s}`);
    return i;
  };
  const oyun = yer('_t_play_start_ms:');
  const basla = yer('_t_transport_start_ms:');
  const batch = yer('tasks/discovery/10_discover_batch.yml');
  const paralel = yer('tasks/discovery/10_discover_parallel.yml');
  const seri = yer('tasks/discovery/10_discover.yml');
  const bitti = yer('_t_transport_end_ms:');
  const yayin = yer('tasks/discovery/25_publish_result.yml');
  assert.ok(oyun < basla, 'oyun damgasi tasimadan sonra');
  assert.ok(basla < Math.min(batch, paralel, seri), 'tasima damgasi include`lardan sonra');
  assert.ok(Math.max(batch, paralel, seri) < bitti, 'tasima sonu bir include`dan once');
  assert.ok(bitti < yayin, 'tasima sonu yayindan sonra');
  // Oyun damgasi `block`un DISINDA ilk gorevde: hazirlik payi eksik kalmasin.
  assert.ok(oyun < d.indexOf('block:'), 'oyun damgasi block icinde (hazirlik eksik olculur)');
  // Yayin set_stats'i alani tasiyor.
  const p = kod(fs.readFileSync(PUBLISH, 'utf8'));
  const stats = p.slice(p.indexOf('ansible.builtin.set_stats:'));
  assert.match(stats, /playbook_timing:\s*"\{\{ _disc_playbook_timing \}\}"/);
  assert.ok(
    p.indexOf('_disc_playbook_timing:') < p.indexOf('ansible.builtin.set_stats:'),
    'kirilim set_stats`tan SONRA hesaplaniyor',
  );
});

function yayinKostur(damgalar) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sx-pt-'));
  try {
    const vars = {
      _discovery_rows: ['c1;j1;-;-;RUNNER;INFO;package_version=24 phase=discover'],
      _failed_clusters: [],
      cluster_list: ['c1'],
      discovery_mode_effective: 'workloads',
      oc_namespace: 'ns1',
      oc_namespaces_effective: ['ns1'],
      oc_platform: 'p',
      oc_environment: 'lab',
      ...damgalar,
    };
    const play = path.join(tmp, 'p.yml');
    fs.writeFileSync(
      play,
      [
        '- hosts: localhost',
        '  connection: local',
        '  gather_facts: false',
        '  tasks:',
        `    - ansible.builtin.include_tasks: ${JSON.stringify(PUBLISH)}`,
      ].join('\n'),
    );
    const vf = path.join(tmp, 'v.json');
    fs.writeFileSync(vf, JSON.stringify(vars));
    const r = spawnSync('ansible-playbook', [play, '-e', `@${vf}`], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ANSIBLE_STDOUT_CALLBACK: 'json',
        ANSIBLE_SHOW_CUSTOM_STATS: '1',
        ANSIBLE_LOCALHOST_WARNING: '0',
        ANSIBLE_INVENTORY_UNPARSED_WARNING: '0',
      },
    });
    assert.equal(r.status, 0, r.stdout.slice(-3000) + r.stderr.slice(-2000));
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    return j.global_custom_stats.scalex_discovery_result.playbook_timing;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('O2a yayin: damgalar varsa paylar SAYI ve tutarli', { skip: !HAS_ANSIBLE }, () => {
  const simdi = Date.now();
  const pt = yayinKostur({
    _t_play_start_ms: simdi - 10000,
    _t_transport_start_ms: simdi - 7000,
    _t_transport_end_ms: simdi - 2000,
  });
  assert.equal(Number(pt.start_epoch_ms), simdi - 10000);
  assert.equal(Number(pt.prep_ms), 3000);
  assert.equal(Number(pt.transport_ms), 5000);
  // Yayin payi "simdi - tasima sonu": en az 2 sn, makul ust sinir.
  assert.ok(Number(pt.publish_ms) >= 2000 && Number(pt.publish_ms) < 60000, String(pt.publish_ms));
});

test('O2b yayin: damga yoksa -1 (portal NULL yapar), gorev DUSMEZ', { skip: !HAS_ANSIBLE }, () => {
  const pt = yayinKostur({});
  assert.deepEqual(
    [pt.start_epoch_ms, pt.prep_ms, pt.transport_ms, pt.publish_ms].map(Number),
    [-1, -1, -1, -1],
  );
});
