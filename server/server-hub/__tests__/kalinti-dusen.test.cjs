// server/server-hub/__tests__/kalinti-dusen.test.cjs — KD1..KD4 (2026-10-08).
//
// Kullanici (Server Hub > Bulgular, 142 JBoss satiri):
//   * "jboss-cli yok; host XML bulunamadi" (28) ve "was dizine giremiyor" (47) birer CLI SORUNU
//     degil, KULLANILAN KURULUM YOK demek -> JBOSS_KALINTI, JBoss CLI kartinin paydasina girmez.
//   * "artik varolmayan silinmis sunucularin da bilgisi geliyor, onlari ana sayidan dusmemiz
//     lazim" -> son tam taramada gorulmeyen sunucu (taramadanDustu) sayilara/bulgulara girmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assess: assessHam, flattenFindings, jbKalinti } = require('../assess.cjs');

const D = '2026-10-08';
const NOW = Date.parse(`${D}T12:00:00Z`);
const assess = (d) => assessHam(d, { now: NOW });

const KALINTI_YOK = "jboss-cli yok (/usr/jboss/AppServer/bin); host XML bulunamadi (/usr/jboss/AppServer/domain/configuration)";
const KALINTI_IZIN = "JBoss dizini GORULEMEDI (/usr/jboss/AppServer) - 'was' ust dizinlerden birine giremiyor (izin) - dzdo gerekmez, denenmedi; dizin yok ya da kalinti olabilir";

test('KD1 jbKalinti: iki kalinti bicimi tanınır; gercek CLI sorunlari kalinti SAYILMAZ', () => {
  assert.equal(jbKalinti({ cli: 'SKIP', note: KALINTI_YOK }), true);
  assert.equal(jbKalinti({ cli: 'SKIP', note: KALINTI_IZIN }), true);
  // eski tarayici metni (dzdo reddi) - gercekten dzdo sorunu olabilir, kalinti DENMEZ
  assert.equal(jbKalinti({ cli: 'SKIP', note: "JBoss dizini GORULEMEDI (/usr/jboss/AppServer) - dzdo 'test' izni yok" }), false);
  assert.equal(jbKalinti({ cli: 'SKIP', note: 'host controller calismiyor, CLI acilmadi; host XML belirsiz: host.xml,host-slave.xml' }), false);
  assert.equal(jbKalinti({ cli: 'FAIL', note: KALINTI_YOK }), false, 'yalniz SKIP kalinti olabilir');
  assert.equal(jbKalinti({ cli: 'SKIP', note: 'jboss-cli yok (/usr/jboss/AppServer/bin); kaynak: host XML' }), false, 'host XML okunduysa kurulum var');
});

const veri = () => ({
  hosts: [
    { host: 'GBEFJAP01', scan_date: D, products: 'JBOSS8' },
    { host: 'GBJBKAL01', scan_date: D, products: 'JBOSS7' },
    { host: 'GBJBOK01', scan_date: D, products: 'JBOSS7' },
    { host: 'GBJTPQ01', scan_date: '2026-09-26', products: 'JBOSS7' },
  ],
  jboss: [
    { host: 'GBEFJAP01', gen: 8, host_name: 'primary', host_state: 'running', cli: 'OK', note: '' },
    { host: 'GBEFJAP01', gen: 7, host_name: 'master', host_state: 'UNKNOWN', cli: 'SKIP', note: KALINTI_IZIN },
    { host: 'GBJBKAL01', gen: 7, host_name: 'master', host_state: 'UNKNOWN', cli: 'SKIP', note: KALINTI_YOK },
    { host: 'GBJBOK01', gen: 7, host_name: 'master', host_state: 'running', cli: 'OK', note: '' },
    { host: 'GBJTPQ01', gen: 7, host_name: 'master', host_state: 'UNKNOWN', cli: 'FAIL', note: "cli rc=1 Sorry, user www is not allowed to execute '/bin/bash -lc ...'" },
  ],
  jvms: [],
  web: [],
  vhosts: [],
  ips: [],
});

test('KD2 kalinti satiri JBOSS_KALINTI bulgusu olur (CLI_SKIP degil); CLI kartinda payda disi', () => {
  const r = assess(veri());
  const ef = r.hosts.find((h) => h.host === 'GBEFJAP01');
  assert.ok(ef.findings.some((f) => f.code === 'JBOSS_KALINTI'));
  assert.ok(!ef.findings.some((f) => f.code === 'CLI_SKIP'), 'kalinti hala CLI_SKIP diye raporlaniyor');
  const jc = r.summary.jbossCli;
  // GBEFJAP01 (JBoss 8 OK + JBoss 7 kalinti) ve GBJBOK01 OK; GBJBKAL01 yalniz kalinti -> sayilmaz
  assert.equal(jc.hosts, 2, 'yalniz kalinti olan sunucu JBoss CLI paydasinda');
  assert.equal(jc.ok, 2, 'kalinti satiri olan sunucu "okunamadi" sayiliyor');
  assert.equal(jc.skip, 0);
  assert.equal(jc.kalinti, 2);
});

test('KD3 taramadan dusen sunucu: sayilara, sunucu ozetine ve bulgulara GIRMEZ; ayri listelenir', () => {
  const r = assess(veri());
  const td = r.summary.taramadanDusen;
  assert.equal(td.sayi, 1);
  assert.deepEqual(td.sunucular.map((s) => [s.host, s.scanDate]), [['GBJTPQ01', '2026-09-26']]);
  assert.ok(!flattenFindings(r.hosts).some((f) => f.host === 'GBJTPQ01'), 'silinmis sunucunun bulgusu listede');
  assert.equal(r.summary.jbossCli.fail, 0, 'silinmis sunucu CLI hatasi sayiliyor');
});

test('KD4 bir gun geride kalan sunucu ("simdi tara" toleransi) taramadan DUSMUS sayilmaz', () => {
  const v = veri();
  v.hosts.find((h) => h.host === 'GBJTPQ01').scan_date = '2026-10-07';
  const r = assess(v);
  assert.equal(r.summary.taramadanDusen.sayi, 0);
  assert.ok(flattenFindings(r.hosts).some((f) => f.host === 'GBJTPQ01'));
});
