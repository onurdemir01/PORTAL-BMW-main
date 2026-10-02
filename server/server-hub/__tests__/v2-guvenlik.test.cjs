// server/server-hub/__tests__/v2-guvenlik.test.cjs - Server Hub sozlesme v3, dalga 1 (2026-10-01).
//
// BEKCI G10 (D1-C01..C28) + G7'nin Portal kismi (mask.cjs, 14 ortak vaka) + baglayici ek
// EK-2 (duvar saati tazeligi), EK-3 (atfedilemeyen proxy), EK-5 (olculemeyen web varligi).
//
// Ortak ilke: "olculemedi" ile "yok" ASLA karismaz; olculemeyen ya da bayat kanit YAZMA
// EYLEMI (fix) uretmez. Testler DAVRANISSALDIR (assess() fixture'lari, sahte sorgu ile
// loadLatest, sahte express ile uclar); metin bekcisi yalniz normalize() ile.
//
// Her bekcinin mutasyonu (davranisi geri al -> bu dosya KIRMIZI) uygulama raporundadir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { normalize } = require('../../util/guard-text.cjs');
const { assess, flattenFindings } = require('../assess.cjs');
const { rebootReadiness, KOD_ANLAMI } = require('../reboot-readiness.cjs');
const mask = require('../mask.cjs');
const { buildTargets, discover } = require('../../retirement/discover.cjs');

// ── ortak fixture yardimcilari ──────────────────────────────────────────────────────
const BUGUN = '2026-10-01';
const NOW = Date.parse(`${BUGUN}T10:00:00Z`);
const gunOnce = (n) =>
  new Date(Date.parse(`${BUGUN}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const A = (d, now = NOW) => assess(d, { now });
const sunucu = (r, h) => r.hosts.find((x) => x.host === h);
const bul = (r, h, code) => sunucu(r, h).findings.filter((f) => f.code === code);
const tumFix = (r) => r.hosts.flatMap((h) => h.findings.filter((f) => f.fix).map((f) => f.fix));

// 3-tier adlar: GBCJAP01 (uygulama) -> 5. harf A->W -> GBCJWP01 (web). Ikisi de PROD/Pendik.
const APP = 'GBCJAP01';
const WEB = 'GBCJWP01';

const H3 = (host, ek = {}) => ({
  host,
  scan_date: BUGUN,
  products: '',
  wall_s: 1,
  cpu_s: 0.1,
  note: '',
  scan_ver: '2.1',
  rec_counts: '',
  scan_errors: '',
  proc_visibility: 'FULL',
  sock_visibility: 'PID',
  loaded_at: `${ek.scan_date || BUGUN}T06:00:00Z`,
  ...ek,
});
const W3 = (host, product = 'IHS', ek = {}) => ({
  host,
  product,
  running: 1,
  syntax: 'OK',
  detail: '2 vhost',
  check_class: 'OK',
  syntax_verification: 'VERIFIED',
  run_as: 'www',
  check_rc: 0,
  vhost_trust: 'FULL',
  running_src: 'PS',
  ...ek,
});
// www'nin anahtari okuyamadigi web sunucusu: sozdizimi dogrulanamadi, vhost envanteri yok
const NONE3 = (host, product = 'IHS') =>
  W3(host, product, {
    syntax: 'UNKNOWN',
    detail: 'sozdizimi OLCULEMEDI (kosan: www): ACCESS_DENIED /etc/pki/x.key',
    check_class: 'ACCESS_DENIED',
    syntax_verification: 'NOT_VERIFIED',
    check_rc: 1,
    vhost_trust: 'NONE',
  });
const V3 = (host, server_name, ek = {}) => ({
  host,
  product: 'IHS',
  listen: '10.0.0.1:443',
  server_name,
  aliases: '',
  access_log: `/l/${server_name}`,
  proxy_targets: '',
  req_24h: 0,
  req_7d: 0,
  hc_24h: 3,
  shared: 0,
  sampled: 0,
  conf_file: `/c/${server_name}.conf`,
  traffic_state: 'NO_RECENT_TRAFFIC',
  traffic_reason: 'OK',
  cover_from_epoch: 1,
  last_req_epoch: null,
  last_line_epoch: null,
  log_read_as: 'www',
  ...ek,
});
const J3 = (host, jvm, ek = {}) => ({
  host,
  gen: 7,
  jvm,
  grp: 'g',
  running: 0,
  auto_start: 'false',
  server_state: 'stopped',
  ports: '',
  running_src: 'PS_ABSENT',
  cfg_src: 'CLI_WILDCARD',
  ...ek,
});
// v3 kolonlarini atip ESKI tarayici satiri yap (DDL kosmus ama eski tarayici: NULL)
const YENI = {
  host: ['scan_ver', 'rec_counts', 'scan_errors', 'proc_visibility', 'sock_visibility', 'loaded_at'],
  jvm: ['running_src', 'cfg_src'],
  web: ['check_class', 'syntax_verification', 'run_as', 'check_rc', 'vhost_trust', 'running_src'],
  vhost: [
    'traffic_state',
    'traffic_reason',
    'cover_from_epoch',
    'last_req_epoch',
    'last_line_epoch',
    'log_read_as',
  ],
};
const eski = (tur) => (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !YENI[tur].includes(k)));

/** Tam v2 kaniti: durmus oldapp, Web-App ile WEB'deki NRT/OK/FULL vhost'a esli. */
const tamKanit = () => ({
  hosts: [H3(APP, { products: 'JBOSS7' }), H3(WEB, { products: 'IHS' })],
  init: [],
  jboss: [],
  jvms: [J3(APP, 'oldapp')],
  web: [W3(WEB)],
  vhosts: [V3(WEB, 'oldapp.bmw.local')],
  ips: [],
  sshd: [],
});
const RETIRE_FIX = { action: 'jboss_retire', gen: 7, jvm: 'oldapp' };

// ── P1: trafik turetimi ve guvenlik kapilari ────────────────────────────────────────

test('D1-C04 tam v2 kaniti -> jboss_retire; ALIAS esleme -> fix null; eski satirlar -> fix null; otoriter cfg_ports -> EXACT_JVM', () => {
  const r = A(tamKanit());
  const f = bul(r, APP, 'RETIRE_CANDIDATE');
  assert.equal(f.length, 1, 'tam kanitta retire adayi yok - senaryo kurulamadi');
  assert.deepEqual(f[0].fix, RETIRE_FIX, 'tam v2 kanitinda eylem onerilmedi');
  assert.equal(sunucu(r, APP).jvms[0].mapping, 'WEB_APP');

  const al = tamKanit();
  al.vhosts = [V3(WEB, 'legacy.bmw.local', { aliases: 'oldapp.bmw.local' })];
  const fa = bul(A(al), APP, 'RETIRE_CANDIDATE');
  assert.equal(fa.length, 1);
  assert.equal(fa[0].fix, null, 'ALIAS eslemesi yikici eyleme kanit sayildi');
  assert.match(fa[0].text, /eşleme türü ALIAS/);

  const es = tamKanit();
  es.hosts = es.hosts.map(eski('host'));
  es.jvms = es.jvms.map(eski('jvm'));
  es.web = es.web.map(eski('web'));
  es.vhosts = es.vhosts.map(eski('vhost'));
  const fe = bul(A(es), APP, 'RETIRE_CANDIDATE');
  assert.equal(fe.length, 1, 'eski satirlarda retire adayi bulgusu kayboldu');
  assert.equal(fe[0].fix, null, 'eski satir (v2 kaniti yok) jboss_retire uretti');

  const ex = tamKanit();
  ex.vhosts = [V3(WEB, 'portal.bmw.local', { proxy_targets: 'gbcjap01.bmw.local:8443' })];
  ex.jvms = [J3(APP, 'oldapp', { cfg_ports: '8443', cfg_ports_src: 'CLI' })];
  const rx = A(ex);
  assert.equal(sunucu(rx, APP).jvms[0].mapping, 'EXACT_JVM');
  assert.deepEqual(bul(rx, APP, 'RETIRE_CANDIDATE')[0].fix, RETIRE_FIX);
  // otoriter OLMAYAN cfg_ports (SLAVE'de NOT_AUTHORITATIVE) esleme kaniti DEGIL
  ex.jvms = [J3(APP, 'oldapp', { cfg_ports: '8443', cfg_ports_src: 'NOT_AUTHORITATIVE' })];
  assert.notEqual(sunucu(A(ex), APP).jvms[0].mapping, 'EXACT_JVM');
});

test('D1-C01 esli vhost biri UNREADABLE (-1) biri NRT -> RETIRE/NO_LOAD YOK, TRAFFIC_UNVERIFIED var, req7d null; D1-C13 log read', () => {
  const d = tamKanit();
  d.vhosts = [
    V3(WEB, 'oldapp.a.local', {
      req_24h: -1,
      req_7d: -1,
      hc_24h: -1,
      traffic_state: 'UNREADABLE',
      traffic_reason: 'PERM_DENIED',
    }),
    V3(WEB, 'oldapp.b.local'),
  ];
  const r = A(d);
  const h = sunucu(r, APP);
  assert.ok(!h.findings.some((f) => f.code === 'RETIRE_CANDIDATE'), 'okunamayan log 0 sayildi');
  assert.ok(!h.findings.some((f) => f.code === 'NO_LOAD'));
  const tu = bul(r, APP, 'TRAFFIC_UNVERIFIED');
  assert.equal(tu.length, 1, 'dogrulanamayan trafik sessiz kaldi');
  assert.equal(tu[0].fix, null);
  assert.equal(h.jvms[0].req7d, null);
  assert.equal(h.jvms[0].trafficState, 'UNREADABLE');
  // D1-C13: -1 "okundu" DEGIL
  const loglar = Object.fromEntries(tu[0].logs.map((l) => [l.serverName, l]));
  assert.equal(loglar['oldapp.a.local'].read, false, '-1 log okunmus gibi isaretlendi');
  assert.equal(loglar['oldapp.b.local'].read, true);
  // Calisan JVM'de de "yuk yok" iddia edilmez
  d.jvms = [J3(APP, 'oldapp', { running: 1, running_src: 'PS', server_state: 'running', auto_start: 'true' })];
  assert.ok(!A(d).hosts.some((x) => x.findings.some((f) => f.code === 'NO_LOAD')));
});

test('D1-C02 ayni senaryo ESKI satirlarla (A -1, B 0) -> RETIRE_CANDIDATE yok', () => {
  const d = tamKanit();
  d.hosts = d.hosts.map(eski('host'));
  d.jvms = d.jvms.map(eski('jvm'));
  d.web = d.web.map(eski('web'));
  d.vhosts = [
    eski('vhost')(V3(WEB, 'oldapp.a.local', { req_24h: -1, req_7d: -1, hc_24h: -1 })),
    eski('vhost')(V3(WEB, 'oldapp.b.local')),
  ];
  const r = A(d);
  assert.ok(!bul(r, APP, 'RETIRE_CANDIDATE').length, 'eski -1 satiri 0 istek sayildi (K0#0)');
  assert.equal(bul(r, APP, 'TRAFFIC_UNVERIFIED').length, 1);
});

test('D1-C03 aday web sunucusunda (webHostOf) vhost_trust=NONE -> UNVERIFIED, retire/STOPPED yok', () => {
  const d = tamKanit();
  d.web = [NONE3(WEB)];
  d.vhosts = [];
  const r = A(d);
  const j = sunucu(r, APP).jvms[0];
  assert.equal(j.trafficState, 'UNVERIFIED');
  assert.ok(!bul(r, APP, 'RETIRE_CANDIDATE').length);
  assert.ok(!bul(r, APP, 'STOPPED').length, 'olculemeyen web katmani "eslenemedi" gibi gosterildi');
  assert.equal(bul(r, APP, 'TRAFFIC_UNVERIFIED').length, 1);
});

test('D1-C03b p1b_probe A: proxy eslesmesinde de webMatch hesaplanir; gateHosts webHostOf W\'yi icerir -> UNVERIFIED', () => {
  const X = 'GBGWXP01';
  const d = {
    hosts: [H3(APP, { products: 'JBOSS7' }), H3(X, { products: 'NGINX' }), H3(WEB, { products: 'IHS' })],
    jvms: [J3(APP, 'OLDAPP', { cfg_ports: '8080', cfg_ports_src: 'CLI' })],
    web: [W3(X, 'NGINX'), NONE3(WEB)],
    vhosts: [V3(X, 'legacy.oldapp', { product: 'NGINX', proxy_targets: 'GBCJAP01:8080' })],
  };
  const r = A(d);
  const j = sunucu(r, APP).jvms[0];
  assert.equal(j.matchKind, 'proxy');
  assert.ok(j.webMatch, 'proxy eslesmesinde webMatch hesaplanmadi');
  assert.ok(j.gateHosts.includes(WEB), `gateHosts W'yi icermiyor: ${j.gateHosts}`);
  assert.equal(j.trafficState, 'UNVERIFIED');
  assert.ok(!tumFix(r).some((f) => f.action === 'jboss_retire'));
});

test('D1-C03c p1b_probe B: W\'de VHOST yok + uygulama sunucusunda ad eslesen vhost -> gateHosts W\'yi webHostOf ile icerir', () => {
  const d = {
    hosts: [H3(APP, { products: 'JBOSS7 NGINX' }), H3(WEB, { products: 'IHS' })],
    jvms: [J3(APP, 'OLDAPP')],
    web: [W3(APP, 'NGINX'), NONE3(WEB)],
    vhosts: [V3(APP, 'oldapp.local', { product: 'NGINX' })],
  };
  const r = A(d);
  const j = sunucu(r, APP).jvms[0];
  assert.equal(j.webMatch.webHost, APP, 'senaryo: webMatch uygulama sunucusuna dusmeliydi');
  assert.ok(j.gateHosts.includes(WEB), `gateHosts webHostOf W'yi icermiyor: ${j.gateHosts}`);
  assert.equal(j.trafficState, 'UNVERIFIED');
  assert.ok(!tumFix(r).some((f) => f.action === 'jboss_retire'));
});

test('D1-C05 + D1-C21 runningKnown: UNMEASURED kapali DEGIL; BLIND+PS bilinen; NULL ve CLI_STATUS bilinen', () => {
  const A2 = 'GBCJAP02';
  const d = {
    hosts: [
      H3(APP, { products: 'JBOSS7', proc_visibility: 'BLIND' }),
      H3(A2, { products: 'JBOSS7', proc_visibility: 'BLIND' }),
    ],
    jvms: [
      J3(APP, 'gizli', { running_src: 'UNMEASURED', auto_start: 'true', server_state: 'unknown' }),
      J3(A2, 'kosan', {
        running: 1,
        running_src: 'PS',
        auto_start: 'false',
        server_state: 'running',
        ports: '8080',
      }),
      J3(A2, 'clidur', { running_src: 'CLI_STATUS', auto_start: 'true' }),
      eski('jvm')(J3(A2, 'eskisatir', { running: 1, auto_start: 'true', server_state: 'running' })),
    ],
  };
  const r = A(d);
  const by = Object.fromEntries(r.hosts.flatMap((h) => h.jvms).map((j) => [j.name, j]));
  assert.equal(by.gizli.runningKnown, false);
  assert.equal(by.kosan.runningKnown, true, 'BLIND + PS pozitif kanit bilinmeyen sayildi');
  assert.equal(by.clidur.runningKnown, true);
  assert.equal(by.eskisatir.runningKnown, true, 'NULL running_src bilinmeyen sayildi');
  assert.ok(!bul(r, APP, 'STOPPED_AUTOSTART_ON').length, 'olculemeyen JVM "kapali" sayildi');
  assert.ok(!tumFix(r).some((f) => f.action === 'jboss_autostart_off' && f.jvm === 'gizli'));
  assert.equal(bul(r, APP, 'RUNNING_UNMEASURED').length, 1);
  const rb = bul(r, A2, 'REBOOT_RISK');
  assert.equal(rb.length, 1, 'BLIND + PS olculmus REBOOT_RISK kayboldu');
  assert.deepEqual(rb[0].fix, { action: 'jboss_autostart_on', gen: 7, jvm: 'kosan' });
  const so = bul(r, A2, 'STOPPED_AUTOSTART_ON');
  assert.equal(so.length, 1, 'CLI_STATUS normal degerlendirilmedi');
  const rr = rebootReadiness(r.hosts, [APP, A2]);
  const v = Object.fromEntries(rr.rows.map((x) => [x.host, x.verdict]));
  assert.equal(v[APP], 'unknown', 'olculemeyen JVM hazirlikta "ok" ya da "risk"');
  assert.equal(v[A2], 'blocked');
});

test('D1-C06 WEB v3: ACCESS_DENIED -> SYNTAX_UNVERIFIED; SYNTAX_ERROR + "~" -> fix null; temiz SYNTAX_ERROR -> apache_comment_line; eski satir 9675be9', () => {
  const sozHata = (ek = {}) =>
    W3(WEB, 'IHS', {
      syntax: 'FAIL',
      check_class: 'SYNTAX_ERROR',
      syntax_verification: 'VERIFIED',
      check_rc: 1,
      vhost_trust: 'PARTIAL',
      detail: "AH00526: Syntax error on line 12 of /usr/IBMIHS/conf/httpd.conf: Invalid command 'Foo'",
      ...ek,
    });
  const kos = (web) => A({ hosts: [H3(WEB, { products: 'IHS' })], web: [web] });
  const r1 = kos(NONE3(WEB));
  assert.equal(bul(r1, WEB, 'SYNTAX_UNVERIFIED').length, 1);
  assert.ok(!bul(r1, WEB, 'SYNTAX_FAIL').length, 'erisim reddi sozdizimi hatasi sayildi');
  const r2 = kos(sozHata({ detail: 'Syntax error on line 12 of /usr/IBMIHS/conf/httpd.conf: Invalid ~' }));
  assert.equal(bul(r2, WEB, 'SYNTAX_FAIL')[0].fix, null, "kesilmis ('~') detail'de eylem onerildi");
  const r3 = kos(sozHata());
  assert.deepEqual(bul(r3, WEB, 'SYNTAX_FAIL')[0].fix, {
    action: 'apache_comment_line',
    product: 'IHS',
    file: '/usr/IBMIHS/conf/httpd.conf',
    line: 12,
  });
  // eski satir: syntax FAIL + erisim deseni -> dogrulanamadi (9675be9 aynen)
  const r4 = kos(
    eski('web')(
      sozHata({
        detail:
          'AH00526: Syntax error on line 45 of /etc/httpd/conf.d/ssl.conf: SSLCertificateFile: file /x.crt does not exist or is empty',
      }),
    ),
  );
  assert.equal(bul(r4, WEB, 'SYNTAX_UNVERIFIED').length, 1);
  assert.ok(!bul(r4, WEB, 'SYNTAX_FAIL').length);
});

test('D1-C25 SYNTAX_FAIL v3: run_as=www + taze -> eylem; run_as=none -> null; bayat -> null', () => {
  const satir = (run_as) =>
    W3(WEB, 'IHS', {
      syntax: 'FAIL',
      check_class: 'SYNTAX_ERROR',
      syntax_verification: 'VERIFIED',
      run_as,
      vhost_trust: 'PARTIAL',
      detail: 'Syntax error on line 7 of /usr/IBMIHS/conf/x.conf: Invalid command Foo',
    });
  const kos = (web, scan_date = BUGUN) =>
    bul(
      A({ hosts: [H3(WEB, { scan_date }), H3('GBZZAP09')], web: [web] }),
      WEB,
      'SYNTAX_FAIL',
    )[0];
  assert.equal(kos(satir('www')).fix.action, 'apache_comment_line');
  assert.equal(kos(satir('none')).fix, null, 'www ile kosmamis kontrol satir yorumlatiyor');
  const bayat = kos(satir('www'), gunOnce(5));
  assert.equal(bayat.fix, null, 'bayat sozdizimi hatasi satir yorumlatiyor');
  assert.match(bayat.text, new RegExp(`bayat kanıt: ${gunOnce(5)}`));
});

test('D1-C07 IP "unverified" atil SAYILMAZ (bulgu, ozet, satir sayaci)', () => {
  const { hostRow } = require('../index.cjs');
  const r = A({
    hosts: [H3(WEB)],
    ips: [
      { host: WEB, ip: '10.0.0.8', iface: 'eth0', used_by: 'unverified', is_primary: 0 },
      { host: WEB, ip: '10.0.0.9', iface: 'eth0', used_by: 'none', is_primary: 0 },
    ],
  });
  const ip = bul(r, WEB, 'IP_UNUSED');
  assert.equal(ip.length, 1);
  assert.match(ip[0].text, /10\.0\.0\.9/);
  assert.equal(r.summary.ips.unused, 1);
  assert.equal(r.summary.ips.unverified, 1);
  assert.equal(hostRow(sunucu(r, WEB)).unusedIps, 1);
});

test('D1-C08 INIT UNREADABLE: INIT_UNREADABLE (DIFF/MISSING degil), cogunluga girmez, uyumlu sayilmaz, hazirlik unknown', () => {
  const hs = ['GBAAAP01', 'GBAAAP02', 'GBAAAP03', 'GBAAAP04', 'GBAAAP05'];
  const d = {
    hosts: hs.map((h) => H3(h)),
    init: [
      { host: hs[0], root: 'vhosting', file: 'start.sh', status: 'OK', sha512: 'A' },
      { host: hs[1], root: 'vhosting', file: 'start.sh', status: 'OK', sha512: 'A' },
      // okunamayan uc sunucu ayni "bos" sha'yi tasisa bile cogunluk OLAMAZ
      { host: hs[2], root: 'vhosting', file: 'start.sh', status: 'UNREADABLE', sha512: 'BOS' },
      { host: hs[3], root: 'vhosting', file: 'start.sh', status: 'UNREADABLE', sha512: 'BOS' },
      { host: hs[4], root: 'vhosting', file: 'start.sh', status: 'UNREADABLE', sha512: 'BOS' },
      { host: hs[4], root: 'vhosting', file: 'stop.sh', status: 'UNREADABLE', sha512: '' },
    ],
  };
  const r = A(d);
  for (const h of hs.slice(0, 2)) {
    assert.ok(!bul(r, h, 'INIT_DIFF').length, `okunamayanlar cogunluk oldu, ${h} DIFF gosterildi`);
    assert.equal(sunucu(r, h).init[0].status, 'OK');
  }
  for (const h of hs.slice(2)) {
    assert.equal(bul(r, h, 'INIT_UNREADABLE').length, h === hs[4] ? 2 : 1);
    assert.ok(!bul(r, h, 'INIT_DIFF').length && !bul(r, h, 'INIT_MISSING').length);
  }
  assert.equal(r.summary.init.compliant, 2, 'okunamayan sunucu uyumlu sayildi');
  assert.equal(r.summary.init.diffFiles, 0);
  assert.equal(r.summary.init.missingFiles, 0);
  const rr = rebootReadiness(r.hosts, [hs[2]]);
  assert.equal(rr.rows[0].verdict, 'unknown');
});

test('D1-C09 + D1-C24 LoadIssues: run_at > loaded_at -> LOAD_EXCLUDED (tum eylemler null, hazirlik unknown); loaded_at NULL -> scan_date; ayni makine -> LOAD_DUPLICATE', () => {
  const temel = () => ({
    hosts: [H3(APP, { products: 'JBOSS7' })],
    jvms: [J3(APP, 'crm', { running: 1, running_src: 'PS', auto_start: 'false', server_state: 'running', ports: '8080' })],
  });
  // kontrol: yukleme izi yokken eylem VAR
  assert.ok(bul(A(temel()), APP, 'REBOOT_RISK')[0].fix);
  const d = temel();
  d.loadIssues = [
    { host: APP, scan_date: BUGUN, issue: 'REC_COUNT_MISMATCH', detail: 'JVM=3 != 2', run_at: `${BUGUN}T14:00:00Z` },
  ];
  const r = A(d);
  const le = bul(r, APP, 'LOAD_EXCLUDED');
  assert.equal(le.length, 1);
  assert.equal(le[0].severity, 'warning');
  assert.match(le[0].text, /REC_COUNT_MISMATCH/);
  assert.equal(bul(r, APP, 'REBOOT_RISK')[0].fix, null, 'disarida kalan sunucuda eylem onerildi');
  assert.equal(sunucu(r, APP).fresh, false);
  assert.equal(rebootReadiness(r.hosts, [APP]).rows[0].verdict, 'unknown');
  // run_at < loaded_at: eski kosunun izi, sunucu sonradan yazildi -> dislama YOK
  d.loadIssues[0].run_at = `${BUGUN}T05:00:00Z`;
  assert.ok(!bul(A(d), APP, 'LOAD_EXCLUDED').length);
  // loaded_at NULL (eski HOST satiri): scan_date karsilastirmasi
  const e = temel();
  e.hosts = [eski('host')(H3(APP, { products: 'JBOSS7', scan_date: gunOnce(1) }))];
  e.loadIssues = [{ host: APP, scan_date: BUGUN, issue: 'FIELD_TOO_LONG', detail: 'x', run_at: `${BUGUN}T02:00:00Z` }];
  assert.equal(bul(A(e), APP, 'LOAD_EXCLUDED').length, 1);
  e.loadIssues[0].scan_date = gunOnce(1);
  assert.ok(!bul(A(e), APP, 'LOAD_EXCLUDED').length);
  // ayni makine iki adla: bilgi, dislama degil
  const s = temel();
  s.loadIssues = [
    { host: APP, scan_date: BUGUN, issue: 'HOST_DUPLICATE_SAME_MACHINE', detail: 'inv=gbcjap01 inv=GBCJAP01.bmw.local', run_at: `${BUGUN}T14:00:00Z` },
  ];
  const rs = A(s);
  assert.ok(!bul(rs, APP, 'LOAD_EXCLUDED').length, 'ayni makine dislama sayildi');
  assert.equal(bul(rs, APP, 'LOAD_DUPLICATE').length, 1);
  assert.match(bul(rs, APP, 'LOAD_DUPLICATE')[0].text, /inv=gbcjap01/);
  assert.ok(bul(rs, APP, 'REBOOT_RISK')[0].fix);
});

test('D1-C10 JBoss urunu var, tarama JVM satiri yok -> JVM_DATA_MISSING, hazirlik unknown', () => {
  const r = A({ hosts: [H3(APP, { products: 'JBOSS7' })] });
  const f = bul(r, APP, 'JVM_DATA_MISSING');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning');
  assert.equal(rebootReadiness(r.hosts, [APP]).rows[0].verdict, 'unknown');
});

test('D1-C12 VHOST_IDLE: v2 tam -> apache_retire_vhost; UNVERIFIED -> bulgu yok; eski 0 -> bulgu var, fix null', () => {
  const kos = (vh, web = W3(WEB)) => A({ hosts: [H3(WEB, { products: 'IHS' })], web: [web], vhosts: [vh] });
  const f1 = bul(kos(V3(WEB, 'lonely.bmw.local')), WEB, 'VHOST_IDLE');
  assert.equal(f1.length, 1);
  assert.deepEqual(f1[0].fix, {
    action: 'apache_retire_vhost',
    product: 'IHS',
    file: '/c/lonely.bmw.local.conf',
    server_name: 'lonely.bmw.local',
  });
  const f2 = bul(
    kos(V3(WEB, 'lonely.bmw.local', { req_24h: -1, req_7d: -1, hc_24h: -1, traffic_state: 'UNVERIFIED', traffic_reason: 'NO_HOST_FIELD' })),
    WEB,
    'VHOST_IDLE',
  );
  assert.equal(f2.length, 0, 'dogrulanamayan trafik "bosta" sayildi');
  const f3 = bul(
    A({ hosts: [eski('host')(H3(WEB))], web: [eski('web')(W3(WEB))], vhosts: [eski('vhost')(V3(WEB, 'lonely.bmw.local'))] }),
    WEB,
    'VHOST_IDLE',
  );
  assert.equal(f3.length, 1);
  assert.equal(f3[0].fix, null, 'eski satirda vhost silme onerildi');
  // urunun vhost_trust'i FULL degilse (PARTIAL) bulgu yok
  const f4 = bul(kos(V3(WEB, 'lonely.bmw.local'), W3(WEB, 'IHS', { vhost_trust: 'PARTIAL' })), WEB, 'VHOST_IDLE');
  assert.equal(f4.length, 0);
});

test('D1-C14 FIX_ACTIONS 5 eylemle DONUK (toplu eylem yok)', () => {
  const { FIX_ACTIONS } = require('../index.cjs');
  assert.deepEqual([...FIX_ACTIONS].sort(), [
    'apache_comment_line',
    'apache_retire_vhost',
    'jboss_autostart_off',
    'jboss_autostart_on',
    'jboss_retire',
  ]);
});

test('D1-C16 BLIND sayaclari: running=1 stopped=0 unmeasured=3; byEnv, hostRow, hostDetail; web UNMEASURED NOT_RUNNING degil', () => {
  const { hostRow, hostDetail } = require('../index.cjs');
  const d = {
    hosts: [H3(APP, { products: 'JBOSS7 IHS', proc_visibility: 'BLIND' })],
    jvms: [
      J3(APP, 'g1', { running_src: 'UNMEASURED', server_state: 'unknown' }),
      J3(APP, 'g2', { running_src: 'UNMEASURED', server_state: 'unknown' }),
      J3(APP, 'g3', { running_src: 'UNMEASURED', server_state: 'unknown' }),
      J3(APP, 'k1', { running: 1, running_src: 'PS', auto_start: 'true', server_state: 'running', ports: '8080' }),
    ],
    web: [W3(APP, 'IHS', { running: 0, running_src: 'UNMEASURED' })],
    vhosts: [V3(APP, 'site.bmw.local', { traffic_state: 'ACTIVE', req_7d: 10, req_24h: 1 })],
  };
  const r = A(d);
  assert.equal(r.summary.jvm.running, 1);
  assert.equal(r.summary.jvm.stopped, 0, 'olculemeyen JVM "kapali" sayildi');
  assert.equal(r.summary.jvm.unmeasured, 3);
  assert.equal(r.summary.byEnv.Production.jvmRunning, 1);
  assert.equal(r.summary.byEnv.Production.jvmUnmeasured, 3);
  const h = sunucu(r, APP);
  const row = hostRow(h);
  assert.equal(row.jvmsRunning, 1);
  assert.equal(row.jvmsUnmeasured, 3);
  const det = hostDetail(h);
  const by = Object.fromEntries(det.jvms.map((j) => [j.name, j]));
  assert.equal(by.g1.runningKnown, false);
  assert.equal(by.g1.runningSrc, 'UNMEASURED');
  assert.equal(by.k1.runningKnown, true);
  assert.equal(by.k1.runningSrc, 'PS');
  assert.equal(det.web[0].runningSrc, 'UNMEASURED');
  assert.ok(!bul(r, APP, 'NOT_RUNNING').length, "BLIND'da gorulmeyen web 'calismiyor' sayildi");
  assert.equal(r.summary.web.IHS.notRunning, 0);
  assert.equal(r.summary.web.IHS.notRunningUnmeasured, 1);
  assert.equal(r.summary.byEnv.Production.web.IHS.notRunning, 0);
  assert.equal(r.summary.byEnv.Production.web.IHS.notRunningUnmeasured, 1);
  // olculmus kapali web hala NOT_RUNNING uretir (kontrol)
  d.web = [W3(APP, 'IHS', { running: 0, running_src: 'PS_ABSENT' })];
  assert.equal(bul(A(d), APP, 'NOT_RUNNING').length, 1);
});

test('D1-C17 tazelik: web sunucusu 10 gun once -> RETIRE fix null "bayat kanit: <web> <tarih>"; dun -> eylem korunur', () => {
  const d = tamKanit();
  d.hosts[1] = H3(WEB, { products: 'IHS', scan_date: gunOnce(10) });
  const f = bul(A(d), APP, 'RETIRE_CANDIDATE');
  assert.equal(f.length, 1, 'bayat web kanitinda retire bulgusu kayboldu');
  assert.equal(f[0].fix, null, 'bayat web taramasi bugunun retire eylemini besledi');
  assert.match(f[0].text, new RegExp(`bayat kanıt: ${WEB} ${gunOnce(10)}`));
  d.hosts[1] = H3(WEB, { products: 'IHS', scan_date: gunOnce(1) });
  assert.deepEqual(bul(A(d), APP, 'RETIRE_CANDIDATE')[0].fix, RETIRE_FIX, '1 gun tolerans calismiyor');
});

test('D1-C18 LOAD_EXCLUDED ve 3 gun once taranmis sunucu: VHOST_IDLE/REBOOT_RISK/SYNTAX_FAIL kalir, hepsi fix null + "(bayat kanit: <tarih>)"', () => {
  const S = 'GBCJAP05';
  const kur = (scan_date, loadIssues) => ({
    hosts: [H3(S, { products: 'JBOSS7 IHS RHA', scan_date }), H3('GBZZAP09')],
    jvms: [J3(S, 'crm', { running: 1, running_src: 'PS', auto_start: 'false', server_state: 'running', ports: '8080' })],
    web: [
      W3(S, 'IHS', {
        syntax: 'FAIL',
        check_class: 'SYNTAX_ERROR',
        vhost_trust: 'PARTIAL',
        detail: 'Syntax error on line 3 of /usr/IBMIHS/conf/y.conf: Invalid command Bar',
      }),
      W3(S, 'RHA'),
    ],
    vhosts: [V3(S, 'idle.bmw.local', { product: 'RHA' })],
    loadIssues,
  });
  const kodlar = ['VHOST_IDLE', 'REBOOT_RISK', 'SYNTAX_FAIL'];
  // kontrol: taze sunucuda uc eylem de VAR
  const t = A(kur(BUGUN, []));
  for (const k of kodlar) assert.ok(bul(t, S, k)[0] && bul(t, S, k)[0].fix, `kontrol: ${k} eylemsiz`);
  const vakalar = [
    ['LOAD_EXCLUDED', kur(BUGUN, [{ host: S, scan_date: BUGUN, issue: 'CTRL_CHAR', detail: 'note', run_at: `${BUGUN}T15:00:00Z` }]), BUGUN],
    ['3 gun once', kur(gunOnce(3), []), gunOnce(3)],
  ];
  for (const [ad, d, tarih] of vakalar) {
    const r = A(d);
    for (const k of kodlar) {
      const f = bul(r, S, k);
      assert.equal(f.length, 1, `${ad}: ${k} bulgusu kayboldu`);
      assert.equal(f[0].fix, null, `${ad}: ${k} eylemi kalkmadi`);
      assert.ok(f[0].text.includes(`(bayat kanıt: ${tarih})`), `${ad}: ${k} metni bayat demiyor`);
    }
  }
});

test('D1-C19 web katmani (S3): ayni env+site W2 NONE -> RETIRE fix null "web katmaninda olculemeyen host var: W2", retireBlockedByWebTier=1; baska site/env -> eylem', () => {
  const kos = (w2, invEnv) => {
    const d = tamKanit();
    if (w2) {
      d.hosts.push(H3(w2, { products: 'IHS' }));
      d.web.push(NONE3(w2));
    }
    if (invEnv) d.invEnv = invEnv;
    return A(d);
  };
  const r = kos('GBXXWP02');
  const f = bul(r, APP, 'RETIRE_CANDIDATE');
  assert.equal(f.length, 1);
  assert.equal(f[0].fix, null, 'web katmaninda olculemeyen host varken retire onerildi');
  assert.match(f[0].text, /web katmanında ölçülemeyen host var: GBXXWP02/);
  assert.equal(r.summary.jvm.retireBlockedByWebTier, 1);
  assert.deepEqual(bul(kos('GBXXWAP02'), APP, 'RETIRE_CANDIDATE')[0].fix, RETIRE_FIX, 'baska site engelledi');
  assert.deepEqual(bul(kos('GBXXWT02'), APP, 'RETIRE_CANDIDATE')[0].fix, RETIRE_FIX, 'baska ortam engelledi');
  // envanterde web urunu olan ama TARANMAMIS ayni katman sunucusu da olculmemistir
  const ri = kos(null, [{ host: 'GBYYWP03', env: 'PROD', invProducts: ['IHS'] }]);
  assert.equal(bul(ri, APP, 'RETIRE_CANDIDATE')[0].fix, null, 'taranmamis katman sunucusu yok sayildi');
});

test('D1-C20 esli web sunucusunda fuse:VHOST -> jboss_retire yok; ayni sunucunun VHOST_IDLE eylemi yok', () => {
  const kur = (scan_errors) => {
    const d = tamKanit();
    d.hosts[1] = H3(WEB, { products: 'IHS', scan_errors });
    d.vhosts.push(V3(WEB, 'lonely.bmw.local'));
    return A(d);
  };
  const t = kur('');
  assert.deepEqual(bul(t, APP, 'RETIRE_CANDIDATE')[0].fix, RETIRE_FIX, 'kontrol: retire yok');
  assert.ok(bul(t, WEB, 'VHOST_IDLE')[0].fix, 'kontrol: vhost eylemi yok');
  const r = kur('fuse:VHOST=3');
  assert.ok(!tumFix(r).some((f) => f.action === 'jboss_retire'), 'kesilmis vhost envanteriyle retire');
  const vi = bul(r, WEB, 'VHOST_IDLE');
  assert.ok(vi.every((f) => f.fix === null), 'kesilmis vhost envanteriyle vhost silme onerildi');
});

test('D1-C23 cfg_src PS_ONLY -> JVM_INVENTORY_UNMEASURED (warning, hazirlik unknown); XML/CLI_WILDCARD -> yok', () => {
  const kos = (cfg_src) =>
    A({
      hosts: [H3(APP, { products: 'JBOSS7' })],
      jvms: [J3(APP, 'k', { running: 1, running_src: 'PS', auto_start: 'true', server_state: 'running', cfg_src, ports: '8080' })],
    });
  const r = kos('PS_ONLY');
  const f = bul(r, APP, 'JVM_INVENTORY_UNMEASURED');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning');
  assert.equal(rebootReadiness(r.hosts, [APP]).rows[0].verdict, 'unknown');
  for (const c of ['XML', 'CLI_WILDCARD']) assert.ok(!bul(kos(c), APP, 'JVM_INVENTORY_UNMEASURED').length);
});

// ── T2-C2: cfg_src UNAVAILABLE (kaynak OKUNDU, calisan JVM tanimda yok) != PS_ONLY ──────
// Dogrulayici dv_t9_a7 / dv_unavail: cli=OK + UNAVAILABLE satirina Portal 'CLI ve host XML
// okunamadi - durmus JVM'ler listede olmayabilir' ve AUTOSTART_UNKNOWN 'JBoss CLI cevap
// vermedi' diyordu (yanlis kok neden: operator dzdo/CLI erisimini arar). Metin bekcisi
// normalize() ile; karar tarafi (hazirlik unknown, eylem yok) iki durumda da AYNI.

test("T2-C2 UNAVAILABLE + cli=OK: metin 'okunamadi/cevap vermedi' demez, JVM adini soyler, 'listede olmayabilir' yok; PS_ONLY eski metni korur; hazirlik ikisinde de unknown", () => {
  const kos = (cfg_src, cli, ek = {}) =>
    A({
      hosts: [H3(APP, { products: 'JBOSS7' })],
      jboss: [{ host: APP, gen: 7, host_name: 'm', host_state: 'running', cli, note: '' }],
      jvms: [
        J3(APP, 'tanimli', {
          running: 1,
          running_src: 'PS',
          auto_start: 'true',
          server_state: 'running',
          cfg_src: cfg_src === 'PS_ONLY' ? 'PS_ONLY' : 'CLI_WILDCARD',
          ports: '8080',
        }),
        J3(APP, 'hayalet', { running: 1, running_src: 'PS', auto_start: 'unknown', server_state: 'unknown', cfg_src, ports: '8180' }),
      ],
      ...ek,
    });
  const metinler = (r) => sunucu(r, APP).findings.map((f) => normalize(f.text));
  const hazirlik = (r) => rebootReadiness(r.hosts, [APP]).rows[0];

  // ── UNAVAILABLE + cli=OK ──
  const u = kos('UNAVAILABLE', 'OK');
  const t = bul(u, APP, 'JVM_UNDEFINED_PROCESS');
  assert.equal(t.length, 1, 'UNAVAILABLE icin tanimsiz surec bulgusu yok');
  assert.equal(t[0].severity, 'warning');
  assert.deepEqual(t[0].undefinedJvms, ['hayalet']);
  const tm = normalize(t[0].text);
  assert.ok(tm.includes('hayalet'), `JVM adi yok: ${tm}`);
  assert.ok(tm.includes('tanım kaynağı okundu') && tm.includes('tanımsız süreç'), tm);
  assert.ok(tm.includes('(CLI)'), `okunan kaynak soylenmedi: ${tm}`);
  assert.equal(bul(u, APP, 'JVM_INVENTORY_UNMEASURED').length, 0, 'UNAVAILABLE yine envanter olculemedi sayildi');
  for (const m of metinler(u)) {
    assert.ok(!m.includes('okunamad'), `cli=OK iken 'okunamadi': ${m}`);
    assert.ok(!m.includes('cevap vermedi'), `cli=OK iken 'cevap vermedi': ${m}`);
    assert.ok(!m.includes('listede olmayabilir'), `liste tamken 'listede olmayabilir': ${m}`);
  }
  const au = bul(u, APP, 'AUTOSTART_UNKNOWN');
  assert.equal(au.length, 1);
  assert.equal(au[0].autoStartReason, 'tanimsiz-surec');
  assert.ok(normalize(au[0].text).includes('tanımsız süreç'), au[0].text);
  assert.equal(u.summary.jvm.autoUnknownBy['tanimsiz-surec'], 1);
  assert.equal(u.summary.jvm.autoUnknownBy['cli-okunamadi'], 0, 'tanimsiz surec CLI hatasi sayildi');
  const hu = hazirlik(u);
  assert.equal(hu.verdict, 'unknown', 'tanimsiz calisan JVM hazir sayildi');
  assert.ok(hu.reasons.some((x) => x.code === 'JVM_UNDEFINED_PROCESS' && x.tip === 'unknown'));
  for (const x of hu.reasons) {
    const m = normalize(`${x.aciklama} ${x.text}`);
    assert.ok(!m.includes('listede olmayabilir'), `hazirlikta 'listede olmayabilir': ${m}`);
    assert.ok(!m.includes('okunamad') && !m.includes('cevap vermedi'), `hazirlikta yanlis kok neden: ${m}`);
  }
  // envanterde auto-start alani BOS: 'envanterde-yok' ('CLI okunamadi, ...') tanimsiz sureci ortmez
  const ue = kos('UNAVAILABLE', 'OK', {
    mwApps: [{ host: APP, app: 'hayalet', domain: 'd', status: 'running', autostarts: '', jvm_count: 1 }],
  });
  const aue = bul(ue, APP, 'AUTOSTART_UNKNOWN');
  assert.equal(aue.length, 1);
  assert.equal(aue[0].autoStartReason, 'tanimsiz-surec');
  assert.ok(!normalize(aue[0].text).includes('okunamad'), aue[0].text);
  // eylem yok: tanimsiz surece auto-start acma/kapama onerilmez
  assert.ok(!sunucu(u, APP).findings.some((f) => f.fix && f.fix.jvm === 'hayalet'), 'tanimsiz surece eylem');

  // ── PS_ONLY (CLI dustu, XML yok): eski metin KORUNUR ──
  const p = kos('PS_ONLY', 'FAIL');
  const pi = bul(p, APP, 'JVM_INVENTORY_UNMEASURED');
  assert.equal(pi.length, 1);
  const pm = normalize(pi[0].text);
  assert.ok(pm.includes('okunamad'), `PS_ONLY metni okunamadi demiyor: ${pm}`);
  assert.ok(pm.includes('listede olmayabilir'), pm);
  assert.equal(bul(p, APP, 'JVM_UNDEFINED_PROCESS').length, 0, 'PS_ONLY tanimsiz surec sayildi');
  assert.notEqual(bul(p, APP, 'AUTOSTART_UNKNOWN')[0].autoStartReason, 'tanimsiz-surec');
  const hp = hazirlik(p);
  assert.equal(hp.verdict, 'unknown');
  assert.ok(hp.reasons.some((x) => x.code === 'JVM_INVENTORY_UNMEASURED' && normalize(x.aciklama).includes('listede olmayabilir')));
  // kontrol: tanimli kaynak (CLI_WILDCARD) ikisini de uretmez
  const k = kos('CLI_WILDCARD', 'OK');
  assert.equal(bul(k, APP, 'JVM_UNDEFINED_PROCESS').length + bul(k, APP, 'JVM_INVENTORY_UNMEASURED').length, 0);
});

// ── TUR 3 #8: tanimsiz surece (UNAVAILABLE) envanter auto-start degeri yazilmaz ──────────
// Dogrulayici probe_unavail: MWAppsInventory autostarts='false' gelince hayalet icin
// REBOOT_RISK (danger) + jboss_autostart_on ve hazirlik 'blocked' cikiyordu; T2-C2 bekcisi
// yalniz envanteri BOS vakayi sinadi. Yetkili kaynagin "tanimsiz" kaniti yetkisiz envanterin
// "kapali/acik" iddiasina yenilmez: deger yalniz invAutoStart'ta bilgi olarak kalir.
const tanimsizKur = (o = {}) => ({
  hosts: [H3(APP, { products: 'JBOSS7' })],
  jboss: [{ host: APP, gen: 7, host_name: 'm', host_state: 'running', cli: o.cli || 'OK', note: '' }],
  jvms: [
    ...(o.tanimli === false
      ? []
      : [J3(APP, 'tanimli', { running: 1, running_src: 'PS', auto_start: 'true', server_state: 'running', cfg_src: o.tanimliSrc || 'CLI_WILDCARD', ports: '8080' })]),
    J3(APP, 'hayalet', { running: 1, running_src: 'PS', auto_start: o.taramaAuto || 'unknown', server_state: 'unknown', cfg_src: 'UNAVAILABLE', ports: '8180' }),
  ],
  mwApps: o.inv == null ? [] : [{ host: APP, app: 'hayalet', domain: 'd', status: 'running', autostarts: o.inv, jvm_count: 1 }],
});

test("T3-C8 UNAVAILABLE + envanter auto-start 'false'/'true': deger EZMEZ (unknown, tanimsiz-surec), REBOOT_RISK ve eylem yok, hazirlik unknown", () => {
  for (const inv of ['false', 'true']) {
    const r = A(tanimsizKur({ inv }));
    const j = sunucu(r, APP).jvms.find((x) => x.name === 'hayalet');
    assert.equal(j.autoStart, 'unknown', `inv=${inv}: envanter tanimsiz surecin auto-start'ini ezdi`);
    assert.equal(j.autoStartReason, 'tanimsiz-surec', `inv=${inv}: sebep ${j.autoStartReason}`);
    assert.notEqual(j.autoStartSource, 'envanter', `inv=${inv}: kaynak envanter yazildi`);
    assert.equal(j.invAutoStart, inv, `inv=${inv}: envanter bilgisi kayboldu`);
    const kodlar = sunucu(r, APP).findings.filter((f) => f.text.includes('hayalet')).map((f) => f.code).sort();
    assert.deepEqual(kodlar, ['AUTOSTART_UNKNOWN', 'JVM_UNDEFINED_PROCESS'], `inv=${inv}: kodlar`);
    assert.equal(bul(r, APP, 'AUTOSTART_UNKNOWN')[0].autoStartReason, 'tanimsiz-surec');
    assert.ok(!sunucu(r, APP).findings.some((f) => f.fix && f.fix.jvm === 'hayalet'), `inv=${inv}: tanimsiz surece eylem`);
    assert.ok(!bul(r, APP, 'INV_MISMATCH').some((f) => /auto-start/.test(f.text)), `inv=${inv}: tanimsiz surecte auto-start celiskisi`);
    assert.equal(r.summary.jvm.autoStartFromInventory, 0, `inv=${inv}: envanterden auto-start sayildi`);
    assert.equal(r.summary.jvm.autoUnknownBy['tanimsiz-surec'], 1);
    const hz = rebootReadiness(r.hosts, [APP]).rows[0];
    assert.equal(hz.verdict, 'unknown', `inv=${inv}: hazirlik ${hz.verdict}`);
    assert.ok(!hz.reasons.some((x) => x.code === 'REBOOT_RISK' || x.code === 'STOPPED_AUTOSTART_ON'));
  }
  // tarayici (varsayimsal) deger yazsa bile tanimi olmayan JVM'in auto-start'i yoktur. TUR 4:
  // tarayicinin 'true' degeri de ZORLANIR (EK-7.6 "tarayici ne derse desin"); yalniz 'false'u
  // sinamak "zorlama yalniz 'true' degilken" mutantini (W1) goremiyordu.
  for (const o of [
    { taramaAuto: 'false', inv: 'true' },
    { taramaAuto: 'true' },
    { taramaAuto: 'true', inv: 'false' },
  ]) {
    const t = A(tanimsizKur(o));
    const th = sunucu(t, APP).jvms.find((x) => x.name === 'hayalet');
    assert.equal(th.autoStart, 'unknown', `${JSON.stringify(o)}: tanimsiz surecin auto-start'i ${th.autoStart}`);
    assert.equal(th.autoStartReason, 'tanimsiz-surec', `${JSON.stringify(o)}: sebep ${th.autoStartReason}`);
    assert.equal(bul(t, APP, 'REBOOT_RISK').length, 0, 'tanimsiz surece REBOOT_RISK');
    assert.ok(!bul(t, APP, 'INV_MISMATCH').some((f) => /auto-start/.test(f.text)));
    assert.equal(t.summary.jvm.autoUnknownBy['tanimsiz-surec'], 1, `${JSON.stringify(o)}: sayac`);
  }
  // KONTROL: TANIMLI (CLI_WILDCARD) JVM'de envanter kurali aynen: CLI okuyamadiysa envanter kazanir
  const kd = A({
    hosts: [H3(APP, { products: 'JBOSS7' })],
    jvms: [J3(APP, 'normal', { running: 1, running_src: 'PS', auto_start: 'unknown', server_state: 'running', ports: '8080' })],
    mwApps: [{ host: APP, app: 'normal', domain: 'd', status: 'running', autostarts: 'false', jvm_count: 1 }],
  });
  const kj = sunucu(kd, APP).jvms[0];
  assert.equal(kj.autoStart, 'false');
  assert.equal(kj.autoStartSource, 'envanter');
  assert.deepEqual(bul(kd, APP, 'REBOOT_RISK')[0].fix, { action: 'jboss_autostart_on', gen: 7, jvm: 'normal' }, 'kontrol: tanimli JVM\'de eylem kalkti');
});

test("T3-C10b JVM_UNDEFINED_PROCESS okunan kaynagi dogru soyler: XML -> '(host XML)' ('(CLI)' degil); bos liste + CLI FAIL -> '(CLI)' yok; bos liste + CLI OK -> '(CLI)'", () => {
  const metin = (o) => {
    const f = bul(A(tanimsizKur(o)), APP, 'JVM_UNDEFINED_PROCESS');
    assert.equal(f.length, 1, `${JSON.stringify(o)}: bulgu yok`);
    return normalize(f[0].text);
  };
  const x = metin({ tanimliSrc: 'XML' });
  assert.ok(x.includes('(host XML)'), `XML kaynagi soylenmedi: ${x}`);
  assert.ok(!x.includes('(CLI)'), `XML kaynagi CLI diye yazildi: ${x}`);
  const bf = metin({ tanimli: false, cli: 'FAIL' });
  assert.ok(!bf.includes('(CLI)'), `CLI dustugu halde kaynak CLI dendi: ${bf}`);
  const bo = metin({ tanimli: false, cli: 'OK' });
  assert.ok(bo.includes('(CLI)'), `bos liste + CLI OK kaynagi soylemedi: ${bo}`);
});

test('D1-C27 SCAN_PARTIAL: deadline -> hazirlik unknown; yalniz fuse -> hazirlik etkilenmez', () => {
  const r1 = A({ hosts: [H3(WEB, { scan_errors: 'deadline:IHS,ps_blind' })] });
  const f1 = bul(r1, WEB, 'SCAN_PARTIAL');
  assert.equal(f1.length, 1);
  assert.equal(f1[0].severity, 'info');
  assert.match(f1[0].text, /deadline:IHS/);
  assert.equal(rebootReadiness(r1.hosts, [WEB]).rows[0].verdict, 'unknown');
  const r2 = A({ hosts: [H3(WEB, { scan_errors: 'fuse:VHOST=1' })] });
  assert.equal(bul(r2, WEB, 'SCAN_PARTIAL').length, 1);
  assert.equal(rebootReadiness(r2.hosts, [WEB]).rows[0].verdict, 'ok');
});

// ── EK-2: tazelik DUVAR SAATINE de bagli ────────────────────────────────────────────

test('EK-2 now 3 gun ileri: TUM fix null, hazirlik TUM sunucularda unknown, staleFleet { lastLoad, ageDays }', () => {
  const d = tamKanit();
  d.jvms.push(J3(APP, 'crm', { running: 1, running_src: 'PS', auto_start: 'false', server_state: 'running', ports: '8080' }));
  const t = A(d);
  assert.ok(tumFix(t).length >= 2, 'kontrol: taze filoda eylem yok');
  assert.equal(t.staleFleet, null);
  const r = A(d, NOW + 3 * 86400000);
  assert.deepEqual(tumFix(r), [], 'yukleyici gunlerdir dusukken eylem onerildi');
  assert.deepEqual(r.staleFleet, { lastLoad: BUGUN, ageDays: 3 });
  const rr = rebootReadiness(r.hosts, [APP, WEB]);
  for (const x of rr.rows) assert.equal(x.verdict, 'unknown', `${x.host} bayatken ${x.verdict}`);
  // REBOOT_RISK (engel) olsa bile bayat sunucu "blocked" degil "unknown"
  assert.ok(sunucu(r, APP).findings.some((f) => f.code === 'REBOOT_RISK'));
});

// ── EK-3: atfedilemeyen proxy ───────────────────────────────────────────────────────

test('EK-3 durmus JVM + ayni sunucuya port belirten ACTIVE vhost (hicbir JVM\'e ait degil) -> retire yok, TRAFFIC_UNATTRIBUTED', () => {
  const d = tamKanit();
  d.vhosts.push(
    V3(WEB, 'payments.bmw.local', {
      proxy_targets: 'gbcjap01.bmw.local:8443',
      req_24h: 7,
      req_7d: 50,
      traffic_state: 'ACTIVE',
    }),
  );
  const r = A(d);
  const f = bul(r, APP, 'RETIRE_CANDIDATE');
  assert.equal(f.length, 1);
  assert.equal(f[0].fix, null, 'atfedilemeyen trafik varken retire onerildi');
  const u = bul(r, APP, 'TRAFFIC_UNATTRIBUTED');
  assert.equal(u.length, 1);
  assert.equal(u[0].severity, 'warning');
  assert.match(u[0].text, /:8443/);
  assert.ok(!KOD_ANLAMI.TRAFFIC_UNATTRIBUTED, 'hazirlik etkilenmemeli');
  // trafigi OLCULEMEYEN atfedilemeyen proxy de engeller
  d.vhosts[1] = V3(WEB, 'payments.bmw.local', {
    proxy_targets: 'gbcjap01:8443',
    req_24h: -1,
    req_7d: -1,
    hc_24h: -1,
    traffic_state: 'UNREADABLE',
    traffic_reason: 'PERM_DENIED',
  });
  assert.equal(bul(A(d), APP, 'RETIRE_CANDIDATE')[0].fix, null);
  // kontrol 1: port calisan bir JVM'e AITSE atfedilebilir -> retire korunur
  d.vhosts[1] = V3(WEB, 'payments.bmw.local', { proxy_targets: 'gbcjap01:8443', req_7d: 50, traffic_state: 'ACTIVE' });
  d.jvms.push(J3(APP, 'payments', { running: 1, running_src: 'PS', auto_start: 'true', server_state: 'running', ports: '8443' }));
  assert.deepEqual(bul(A(d), APP, 'RETIRE_CANDIDATE')[0].fix, RETIRE_FIX);
  // kontrol 2: atfedilemeyen ama OLCULMUS 0 trafik engellemez
  d.jvms.pop();
  d.vhosts[1] = V3(WEB, 'payments.bmw.local', { proxy_targets: 'gbcjap01:8443' });
  assert.deepEqual(bul(A(d), APP, 'RETIRE_CANDIDATE')[0].fix, RETIRE_FIX);
  // JVM'in KENDI esli vhost'u (okunamayan) onun trafik durumunda degerlendirilir; ayni
  // sunucudaki portu bilinmeyen KARDES JVM ise TRAFFIC_UNATTRIBUTED alir.
  const k = tamKanit();
  k.vhosts = [
    V3(WEB, 'oldapp.bmw.local', {
      proxy_targets: 'gbcjap01:8080',
      req_24h: -1,
      req_7d: -1,
      hc_24h: -1,
      traffic_state: 'UNREADABLE',
      traffic_reason: 'TIMEOUT',
    }),
  ];
  k.jvms.push(J3(APP, 'kardes'));
  const rk = A(k);
  const tu = bul(rk, APP, 'TRAFFIC_UNATTRIBUTED');
  assert.equal(tu.length, 1, 'kok neden ayni JVM icin iki kez raporlandi ya da kardes JVM atlandi');
  assert.match(tu[0].text, /kardes/);
  assert.ok(bul(rk, APP, 'TRAFFIC_UNVERIFIED').some((f) => /oldapp/.test(f.text)));
});

// ── EK-5: varligi olculemeyen web urunu ─────────────────────────────────────────────

test('EK-5 yalniz web_presence_unknown jetonu: WEB_PRESENCE_UNKNOWN, hazirlik ok DEGIL; PRODUCT_NOT_SCANNED unknown; katmanda olculmemis', () => {
  const r = A({ hosts: [H3(WEB, { scan_errors: 'web_presence_unknown:IHS' })] });
  const f = bul(r, WEB, 'WEB_PRESENCE_UNKNOWN');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'info');
  assert.match(f[0].text, /IHS/);
  assert.notEqual(rebootReadiness(r.hosts, [WEB]).rows[0].verdict, 'ok', 'olculemeyen web "hazir"');
  assert.equal((KOD_ANLAMI.WEB_PRESENCE_UNKNOWN || {}).tip, 'unknown');
  assert.equal((KOD_ANLAMI.PRODUCT_NOT_SCANNED || {}).tip, 'unknown');
  const d = tamKanit();
  d.hosts.push(H3('GBXXWP02', { scan_errors: 'web_presence_unknown:NGINX' }));
  assert.equal(bul(A(d), APP, 'RETIRE_CANDIDATE')[0].fix, null, 'varligi bilinmeyen katman sunucusu olculmus sayildi');
});

// ── C1: EK-3 hedef cozumlemesi (IP / localhost / balancer / VIP) ────────────────────
// Dogrulayici dv_probe7: durmus crm'e 7 gunde 5000 istek tasiyan ikinci vhost'un hedefi
// IP, localhost ya da balancer adiyken EK-3 kordu ve jboss_retire oneriliyordu.

const CRM_FIX = { action: 'jboss_retire', gen: 7, jvm: 'crm' };
/** dv_probe7 duzenegi: durmus crm (portu bilinmiyor) + crm.bmw.de (NRT/OK, Web-App eslemesi)
 * + ayni web sunucusunda 5000 istekli api.bmw.de (hedefi parametre). */
const ek3Kur = (hedef, o = {}) => {
  const webHost = o.webHost || WEB;
  const hosts = [H3(APP, { products: webHost === APP ? 'JBOSS7 IHS' : 'JBOSS7' })];
  if (webHost !== APP) hosts.push(H3(webHost, { products: 'IHS' }));
  return {
    hosts,
    jvms: [J3(APP, 'crm'), ...(o.ekJvm || [])],
    web: [W3(webHost)],
    ips: o.ips || [{ host: APP, ip: '10.1.2.3', iface: 'eth0', used_by: 'other', is_primary: 1 }],
    vhosts: [
      V3(webHost, 'crm.bmw.de'),
      V3(webHost, 'api.bmw.de', {
        proxy_targets: hedef,
        req_24h: 700,
        req_7d: 5000,
        traffic_state: 'ACTIVE',
        ...(o.vek || {}),
      }),
    ],
  };
};
const crmRetire = (d) => bul(A(d), APP, 'RETIRE_CANDIDATE')[0];
// 8180'i DINLEYEN calisan JVM: o porta giden trafik ona atfedilir (kontrol vakalari)
const KOSAN_8180 = J3(APP, 'api', { running: 1, running_src: 'PS', auto_start: 'true', server_state: 'running', ports: '8180' });

test('C1 EK-3 IP hedefi data.ips ile sunucuya cozulur: atfedilemeyen port retire\'i engeller; port calisan JVM\'inse retire korunur', () => {
  assert.deepEqual(crmRetire(ek3Kur('')).fix, CRM_FIX, 'kontrol: proxy yokken retire yok');
  const r = A(ek3Kur('10.1.2.3:8180'));
  const f = bul(r, APP, 'RETIRE_CANDIDATE')[0];
  assert.equal(f.fix, null, 'IP hedefli 5000 istekli proxy varken retire onerildi');
  assert.equal(f.retireBlock, 'UNATTRIBUTED');
  const u = bul(r, APP, 'TRAFFIC_UNATTRIBUTED');
  assert.equal(u.length, 1);
  assert.match(u[0].text, /:8180/);
  assert.equal(u[0].unattributed[0].kind, 'PORT', 'IP hedefi sunucuya cozulmedi (PORT degil)');
  // COZUMLEME KONTROLU: 8180 calisan bir JVM'in portuysa trafik ONA aittir -> retire korunur.
  // IP cozulmeseydi hedef "bilinmeyen" sayilir ve burada da engellerdi.
  assert.deepEqual(crmRetire(ek3Kur('10.1.2.3:8180', { ekJvm: [KOSAN_8180] })).fix, CRM_FIX, 'IP hedefi APP\'e cozulmedi');
  // IP iki sunucuda (VIP / kayan IP): hangisine gittigi bilinmez -> engel
  const ikiSahip = [
    { host: APP, ip: '10.1.2.3', iface: 'eth0', used_by: 'other', is_primary: 1 },
    { host: 'GBCJAP02', ip: '10.1.2.3', iface: 'eth0', used_by: 'other', is_primary: 0 },
  ];
  assert.equal(crmRetire(ek3Kur('10.1.2.3:8180', { ekJvm: [KOSAN_8180], ips: ikiSahip })).fix, null, 'iki sunucudaki IP tek sunucuya cozuldu');
});

test('C1 EK-3 localhost / 127.0.0.1 / [::1] vhost\'un KENDI sunucusudur (2 katman)', () => {
  for (const hedef of ['localhost:8180', '127.0.0.1:8180', '[::1]:8180']) {
    const f = crmRetire(ek3Kur(hedef, { webHost: APP }));
    assert.ok(f, `${hedef}: senaryo kurulamadi`);
    assert.equal(f.fix, null, `${hedef}: ayni sunucudaki 5000 istekli proxy retire'i engellemedi`);
    // kontrol: 8180 ayni sunucuda calisan JVM'in -> atfedilir, retire korunur
    assert.deepEqual(
      crmRetire(ek3Kur(hedef, { webHost: APP, ekJvm: [KOSAN_8180] })).fix,
      CRM_FIX,
      `${hedef}: vhost'un kendi sunucusuna cozulmedi`,
    );
  }
});

test('C1 EK-3 cozulemeyen hedef (balancer://, VIP, upstream adi): ayni katmanda trafigi varsa retire yok, TRAFFIC_UNATTRIBUTED; olculmus 0 ya da baska site engellemez', () => {
  for (const hedef of ['crmcluster', '10.9.9.9:8180', 'api-vip.bmw.de:443']) {
    const r = A(ek3Kur(hedef));
    const f = bul(r, APP, 'RETIRE_CANDIDATE')[0];
    assert.equal(f.fix, null, `${hedef}: hedefi bilinmeyen ACTIVE proxy varken retire onerildi`);
    assert.equal(f.retireBlock, 'UNATTRIBUTED');
    const u = bul(r, APP, 'TRAFFIC_UNATTRIBUTED');
    assert.equal(u.length, 1, `${hedef}: TRAFFIC_UNATTRIBUTED yok`);
    assert.ok(u[0].text.includes(`${hedef} (hedefi bilinmiyor)`), u[0].text);
    assert.equal(u[0].unattributed[0].kind, 'HEDEF');
  }
  // trafigi OLCULEMEYEN hedefi bilinmeyen proxy de engeller
  const okunamadi = { req_24h: -1, req_7d: -1, hc_24h: -1, traffic_state: 'UNREADABLE', traffic_reason: 'PERM_DENIED' };
  assert.equal(crmRetire(ek3Kur('crmcluster', { vek: okunamadi })).fix, null);
  // kontrol: olculmus 0 trafik engellemez
  const sifir = { req_24h: 0, req_7d: 0, traffic_state: 'NO_RECENT_TRAFFIC' };
  assert.deepEqual(crmRetire(ek3Kur('crmcluster', { vek: sifir })).fix, CRM_FIX, 'olculmus 0 trafik engelledi');
  // kontrol: hedefi bilinmeyen proxy BASKA sitedeki (Ankara) web sunucusunda -> ayni katman degil
  const katman = (web2) => {
    const d = ek3Kur('');
    d.hosts.push(H3(web2, { products: 'IHS' }));
    d.web.push(W3(web2));
    d.vhosts.push(V3(web2, 'api.bmw.de', { proxy_targets: 'crmcluster', req_7d: 5000, traffic_state: 'ACTIVE' }));
    return crmRetire(d);
  };
  assert.deepEqual(katman('GBXXWAP05').fix, CRM_FIX, 'baska sitedeki web sunucusu engelledi');
  assert.equal(katman('GBXXWP05').fix, null, 'ayni katmandaki (PROD/Pendik) hedefi bilinmeyen proxy engellemedi');
});

// ── C4: kesik hedef listesi (' ~' / '~TRUNC') ───────────────────────────────────────

test('C4 kesik proxy_targets: kesik parca ayristirilmaz, vhost "hedefi eksik", web sunucusu EK-3 icin olculmemis', () => {
  const d = (hedef, vek) => {
    const x = ek3Kur(hedef, { vek });
    x.hosts.push(H3('GBZZAP09'));
    return x;
  };
  const sifir = { req_24h: 0, req_7d: 0, traffic_state: 'NO_RECENT_TRAFFIC' };
  // kontrol: kesik olmayan (cozulen) liste, olculmus 0 trafik -> retire korunur
  assert.deepEqual(crmRetire(d('gbzzap09.bmw.local:80', sifir)).fix, CRM_FIX, 'kontrol: kesiksiz liste engelledi');
  // B'nin tasma jetonu (loader TASMA_JETONU, README): son parca tam olarak '~TRUNC'; hic hedef
  // sigmazsa deger yalniz '~TRUNC'. Eski loader: ' ~' soneki (parca ortasindan kesik).
  for (const hedef of ['gbzzap09.bmw.local:80,~TRUNC', '~TRUNC', 'gbzzap09.bmw.local:80,gbcjap01.bmw.local:81 ~', 'gbzzap09.bmw.local:80 ~']) {
    const r = A(d(hedef, sifir));
    const f = bul(r, APP, 'RETIRE_CANDIDATE')[0];
    assert.equal(f.fix, null, `${hedef}: kesik hedef listesi varken retire onerildi`);
    const u = bul(r, APP, 'TRAFFIC_UNATTRIBUTED');
    assert.equal(u.length, 1);
    assert.match(u[0].text, /hedef listesi kesik/);
    const v = sunucu(r, WEB).vhosts.find((x) => x.serverName === 'api.bmw.de');
    assert.equal(v.targetsTruncated, true);
    assert.ok(!v.proxyTargets.some((t) => t.port === 81), 'kesik parca (yarim port) ayristirildi');
    assert.ok(v.proxyTargets.every((t) => !String(t.host).includes('~')), 'kesik parca cop host uretti');
    assert.ok(v.proxyTargetsRaw.endsWith(',~') || v.proxyTargetsRaw === '~', `gosterim: ${v.proxyTargetsRaw}`);
    assert.ok(!v.proxyTargetsRaw.includes('gbcjap01.bmw.local:81'), 'kesik parcanin icerigi gosterildi');
  }
});

// ── T2-C1: portu OTORITER cfg_ports ile bilinen DURMUS JVM ──────────────────────────
// Dogrulayici dv_t9_c1 / dv_c1_cfgports: hedefiBilinmeyenTrafik kapisi 'portBilinmiyor
// degilse atla' idi; cfg_ports=8180 (CLI) verilince cozulemeyen hedef (balancer, VIP, DNS adi)
// ve kesik liste retire'i ENGELLEMIYORDU. Hedef hicbir sunucuya cozulmediyse portu bilmek
// trafigin bu JVM'e gitmedigini kanitlamaz (LB port cevirisi). Dalga 2 cfg_ports'u doldurunca
// acilacak delikti. KORLUK: yalniz ayni ortam+site katmani sinanir; baska site/ortamdaki
// RP'nin VIP'i bilerek kapsam disi (tierOf).

test('T2-C1 cfg_ports=8180 (CLI) bilinen durmus JVM: cozulemeyen hedef ve kesik liste retire\'i ENGELLER; kendi IP:8180 EXACT_JVM ve olculmus 0 trafikte retire korunur', () => {
  const cfgli = (hedef, o = {}) => {
    const d = ek3Kur(hedef, o);
    d.jvms[0] = J3(APP, 'crm', { cfg_ports: '8180', cfg_ports_src: 'CLI' });
    return d;
  };
  // on kosul: crm'in portu GERCEKTEN otoriter biliniyor (yoksa test eski C1'i tekrar ederdi)
  const crm0 = sunucu(A(cfgli('')), APP).jvms.find((j) => j.name === 'crm');
  assert.equal(crm0.cfgPortsAuth, true, 'cfg_ports_src=CLI otoriter sayilmadi');
  assert.deepEqual(crm0.cfgPorts, [8180]);
  assert.deepEqual(crmRetire(cfgli('')).fix, CRM_FIX, 'kontrol: proxy yokken retire yok');

  const vakalar = [
    ['balancer://crmcluster', ['HEDEF']],
    ['10.9.9.9:8180', ['HEDEF']],
    ['crm-vip.bmw.local:8180', ['HEDEF']],
    ['x:9000,~TRUNC', ['EKSIK', 'HEDEF']],
  ];
  for (const [hedef, turler] of vakalar) {
    const r = A(cfgli(hedef));
    const f = bul(r, APP, 'RETIRE_CANDIDATE')[0];
    assert.ok(f, `${hedef}: senaryo kurulamadi (RETIRE_CANDIDATE yok)`);
    assert.equal(f.fix, null, `${hedef}: cfg_ports bilinen durmus JVM'de hedefi bilinmeyen 5000 istekli proxy varken retire onerildi`);
    assert.equal(f.retireBlock, 'UNATTRIBUTED', `${hedef}: engel kodu ${f.retireBlock}`);
    const u = bul(r, APP, 'TRAFFIC_UNATTRIBUTED');
    assert.equal(u.length, 1, `${hedef}: TRAFFIC_UNATTRIBUTED yok`);
    assert.deepEqual([...new Set(u[0].unattributed.map((x) => x.kind))].sort(), turler, `${hedef}: tur`);
    // '~TRUNC' jetonu kendi basina bir HEDEF girdisi olmaz; kesiklik yalniz EKSIK ('~') ile tasinir
    assert.ok(
      !u[0].unattributed.some((x) => x.kind !== 'EKSIK' && String(x.target || '').includes('~')),
      `${hedef}: kesik jeton sahte hedef oldu: ${JSON.stringify(u[0].unattributed.map((x) => [x.kind, x.target]))}`,
    );
    // portu otoriter bilinen JVM icin "portu olculemedi" denmez (olculeni anlat)
    assert.ok(!normalize(u[0].text).includes('portu ölçülemedi'), `${hedef}: ${u[0].text}`);
  }
  // '~TRUNC' sahte hedef DEGIL: ayristirilmaz, vhost EKSIK isaretini tasir
  const rt = A(cfgli('x:9000,~TRUNC'));
  const vt = sunucu(rt, WEB).vhosts.find((x) => x.serverName === 'api.bmw.de');
  assert.equal(vt.targetsTruncated, true);
  assert.deepEqual(vt.proxyTargets, [{ host: 'X', port: 9000 }], 'kesik jeton hedef sanildi');
  const { parseTargets: pt } = require('../assess.cjs');
  assert.deepEqual(pt('x:9000,~TRUNC'), [{ host: 'X', port: 9000 }], 'parseTargets kesik jetonu hedef yapti');
  assert.deepEqual(pt('~TRUNC'), [], 'parseTargets yalniz jetondan hedef uretti');

  // KONTROL: hedef APP'in KENDI IP'si:8180 -> sunucuya cozulur, cfg_ports ile EXACT_JVM;
  // olculmus 0 trafikte retire korunur (yeni kapi cozulen hedefi engellemez)
  const sifir = { req_24h: 0, req_7d: 0, traffic_state: 'NO_RECENT_TRAFFIC' };
  const k = crmRetire(cfgli('10.1.2.3:8180', { vek: sifir }));
  assert.equal(k.mapping, 'EXACT_JVM', `kendi IP:8180 EXACT_JVM eslenmedi: ${k.mapping}`);
  assert.deepEqual(k.fix, CRM_FIX, 'cozulen ve olculmus 0 trafikli hedef retire\'i engelledi');
  assert.equal(bul(A(cfgli('10.1.2.3:8180', { vek: sifir })), APP, 'TRAFFIC_UNATTRIBUTED').length, 0);
  // ayni hedefte 5000 istek: trafik crm'e ATFEDILIR (ACTIVE), retire adayi bile degil
  assert.equal(bul(A(cfgli('10.1.2.3:8180')), APP, 'RETIRE_CANDIDATE').length, 0, 'EXACT_JVM trafigi crm\'e atfedilmedi');
  // KONTROL: hedefi bilinmeyen ama OLCULMUS 0 trafikli proxy engellemez
  assert.deepEqual(crmRetire(cfgli('crm-vip.bmw.local:8180', { vek: sifir })).fix, CRM_FIX, 'olculmus 0 trafik engelledi');
  // KONTROL: CALISAN ve portu olculmus JVM'e katman genisliginde TRAFFIC_UNATTRIBUTED yazilmaz
  const d = cfgli('crm-vip.bmw.local:8180');
  d.jvms.push(J3(APP, 'api', { running: 1, running_src: 'PS', auto_start: 'true', server_state: 'running', ports: '8280' }));
  const ra = A(d);
  assert.ok(!sunucu(ra, APP).findings.some((x) => x.code === 'TRAFFIC_UNATTRIBUTED' && x.text.startsWith('JBoss7 api ')), 'calisan JVM\'e gurultu');
  assert.equal(bul(ra, APP, 'TRAFFIC_UNATTRIBUTED').length, 1, 'kontrol: durmus crm icin bulgu yok');

  // ── TUR 3 (#7): EK-6.9'un cfg_ports'lu JVM'de kilitlenmemis maddeleri ──
  // Her vaka mutasyonla dogrulandi (A1 port cevirisi dislamasi, A2 cfg'li JVM'de olculemeyen
  // HEDEF'i saymama, A10 cfg'li JVM'de olculmus 0'li EKSIK'i saymama, A6 capasiz unix atlamasi).
  const engel = (d, tur, ad) => {
    const r = A(d);
    const f = bul(r, APP, 'RETIRE_CANDIDATE')[0];
    assert.ok(f, `${ad}: senaryo kurulamadi`);
    assert.equal(f.fix, null, `${ad}: cfg_ports=8180 bilinen durmus crm'e retire onerildi`);
    assert.equal(f.retireBlock, 'UNATTRIBUTED', `${ad}: engel kodu ${f.retireBlock}`);
    const u = bul(r, APP, 'TRAFFIC_UNATTRIBUTED');
    assert.equal(u.length, 1, `${ad}: TRAFFIC_UNATTRIBUTED yok`);
    assert.deepEqual([...new Set(u[0].unattributed.map((x) => x.kind))], [tur], `${ad}: tur`);
    return u[0];
  };
  // (a) VIP PORT CEVIRISI: VIP:443 -> JVM:8180. Port esitligi HICBIR yerde dislama olcutu degil.
  const a = engel(cfgli('crm-vip.bmw.local:443'), 'HEDEF', 'VIP:443');
  assert.equal(a.unattributed[0].port, 443);
  assert.equal(a.unattributed[0].target, 'crm-vip.bmw.local:443');
  // (b) trafigi OLCULEMEYEN (UNREADABLE, -1) hedefi bilinmeyen proxy cfg'li JVM'de de engeldir
  const okunamadi = { req_24h: -1, req_7d: -1, hc_24h: -1, traffic_state: 'UNREADABLE', traffic_reason: 'PERM_DENIED' };
  engel(cfgli('crm-vip.bmw.local:8180', { vek: okunamadi }), 'HEDEF', 'UNREADABLE');
  // (c) KESIK liste + OLCULMUS 0: EKSIK "her zaman" engeldir (kesilen kisim hic bilinmez)
  engel(cfgli('gbzzap09.bmw.local:80,~TRUNC', { vek: sifir }), 'EKSIK', 'kesik+0');
  // (d) adinda 'unix' gecen VIP unix soketi DEGIL; yalniz 'unix:' onekli parca yerel surectir
  engel(cfgli('unixgw-vip.bmw.local:8180'), 'HEDEF', 'unixgw-vip');
  // KONTROL: gercek unix soketi (5000 ACTIVE) engel uretmez
  assert.deepEqual(crmRetire(cfgli('unix:/run/x.sock')).fix, CRM_FIX, 'unix soketi hedef sayildi');
  assert.equal(bul(A(cfgli('unix:/run/x.sock')), APP, 'TRAFFIC_UNATTRIBUTED').length, 0);
});

// ── TUR 3 #6: hedef kaydi birakmayan proxy ve JVM'siz / taranmamis sunucuya cozulen hedef ──
// Dogrulayici probe_c1: RewriteRule [P] / JkMount / Include / nginx include ile 5000 istek
// tasiyan vhost proxy_targets='' basiyordu ve durmus crm'e jboss_retire oneriliyordu. Tarayici
// artik '~DYNAMIC' parcasi ekler (A); Portal onu HEDEF sayar (kesik liste DEGIL: olculmus 0
// trafikte engellemez). Ayni ailede: hedef JVM'siz bir sunucuya (ayri WEB'deki localhost:8180,
// WEB'in kendi IP'si:8443) ya da envanterde olup taranmamis sunucuya cozulurse trafik hicbir
// JVM'in kapisinda degerlendirilmiyordu. KORLUK: tarayici isareti koymazsa (yeni bir mekanizma)
// Portal yine goremez; RP -> olculmus WEB (hedef portu dinleyen vhost) zinciri bilerek HEDEF
// sayilmaz (trafik WEB'de yeniden sayilir).

const CFG_CRM = J3(APP, 'crm', { cfg_ports: '8180', cfg_ports_src: 'CLI' });
const SIFIR = { req_24h: 0, req_7d: 0, traffic_state: 'NO_RECENT_TRAFFIC' };
const OKUNAMADI = { req_24h: -1, req_7d: -1, hc_24h: -1, traffic_state: 'UNREADABLE', traffic_reason: 'PERM_DENIED' };
/** crm retire engellendi mi; engellendiyse tek TRAFFIC_UNATTRIBUTED girdisini dondurur. */
const engelli = (d, ad) => {
  const r = A(d);
  const f = bul(r, APP, 'RETIRE_CANDIDATE')[0];
  assert.ok(f, `${ad}: senaryo kurulamadi`);
  assert.equal(f.fix, null, `${ad}: 5000 istekli atfedilemeyen proxy varken retire onerildi`);
  assert.equal(f.retireBlock, 'UNATTRIBUTED', `${ad}: engel kodu ${f.retireBlock}`);
  const u = bul(r, APP, 'TRAFFIC_UNATTRIBUTED');
  assert.equal(u.length, 1, `${ad}: TRAFFIC_UNATTRIBUTED yok`);
  return { r, u: u[0] };
};

test("T3-C6 '~DYNAMIC' dinamik proxy HEDEF'tir (kesik degil): 5000 ACTIVE -> retire yok (cfg'siz ve cfg_ports'lu); olculmus 0 engellemez; olculemeyen engeller", () => {
  // kontrol: isaretsiz bos proxy_targets (tarayici kacisi) retire'i gecirir - isaret sart
  assert.deepEqual(crmRetire(ek3Kur('')).fix, CRM_FIX);
  for (const [ad, crm] of [['cfgsiz', null], ['cfg_ports CLI', CFG_CRM]]) {
    const kur = (hedef, o = {}) => {
      const d = ek3Kur(hedef, o);
      if (crm) d.jvms[0] = crm;
      return d;
    };
    const { r, u } = engelli(kur('~DYNAMIC'), `${ad} ~DYNAMIC`);
    assert.deepEqual(
      u.unattributed.map((x) => [x.kind, x.target, x.reason, x.port, x.host, x.serverName]),
      [['HEDEF', '~DYNAMIC', 'DINAMIK', null, WEB, 'api.bmw.de']],
      `${ad}: dinamik proxy girdisi`,
    );
    assert.ok(normalize(u.text).includes('dinamik proxy (hedef kaydı yok)'), u.text);
    assert.ok(!normalize(u.text).includes('hedef listesi kesik'), `dinamik proxy kesik liste diye anlatildi: ${u.text}`);
    const v = sunucu(r, WEB).vhosts.find((x) => x.serverName === 'api.bmw.de');
    assert.equal(v.targetsDynamic, true, 'vhost targetsDynamic tasimiyor');
    assert.equal(v.targetsTruncated, false, 'dinamik proxy kesik liste sayildi');
    assert.deepEqual(v.proxyTargets, [], 'jeton hedef sanildi');
    assert.equal(v.proxyTargetsRaw, '~DYNAMIC');
    // hostDetail (ekran yaniti) alani tasir
    const { hostDetail } = require('../index.cjs');
    assert.equal(hostDetail(sunucu(r, WEB)).vhosts.find((x) => x.serverName === 'api.bmw.de').targetsDynamic, true);
    // HEDEF semantigi: OLCULMUS 0 trafikte engel YOK (EKSIK olsaydi her zaman engellerdi)
    assert.deepEqual(crmRetire(kur('~DYNAMIC', { vek: SIFIR })).fix, CRM_FIX, `${ad}: olculmus 0 dinamik proxy engelledi (EKSIK sanildi)`);
    // trafigi OLCULEMEYEN dinamik proxy engeller
    engelli(kur('~DYNAMIC', { vek: OKUNAMADI }), `${ad} ~DYNAMIC okunamadi`);
    // cozulen (crm'e ait olmayan) hedefle birlikte; tarayici bicimi (jeton BASTA) ve tersi
    for (const hedef of ['~DYNAMIC,gbcjap01.bmw.local:9000', 'gbcjap01.bmw.local:9000,~DYNAMIC']) {
      const k = engelli(kur(hedef), `${ad} karisik ${hedef}`).u;
      assert.ok(k.unattributed.some((x) => x.reason === 'DINAMIK'), `${ad}: karisik listede dinamik parca kayboldu (${hedef})`);
    }
    // TUR 4 (v): dinamik vhost'un literal hedefi BASKA bir calisan JVM'e (api:8280) EXACT esli.
    // Dinamik kisim yine bilinmez: trafigin bir kismi durmus crm'e gidiyor olabilir. "vhost zaten
    // bir JVM'e esli, trafik onundur" kisayolu (mutant V3) retire'i geri acardi.
    const KOSAN_8280 = J3(APP, 'api', { running: 1, running_src: 'PS', auto_start: 'true', server_state: 'running', ports: '8280' });
    const dx = kur('~DYNAMIC,gbcjap01.bmw.local:8280', { ekJvm: [KOSAN_8280] });
    const ex = engelli(dx, `${ad} dinamik + baska JVM'e EXACT esli`);
    const apiJ = sunucu(ex.r, APP).jvms.find((j) => j.name === 'api');
    assert.equal(apiJ.mapping, 'EXACT_JVM', `${ad}: duzenek: api 8280 hedefine EXACT esli degil (${apiJ.mapping})`);
    assert.deepEqual(
      ex.u.unattributed.map((x) => [x.kind, x.reason, x.target]),
      [['HEDEF', 'DINAMIK', '~DYNAMIC']],
      `${ad}: baska JVM'e esli dinamik vhost'un dinamik payi kayboldu`,
    );
  }
  // baska sitedeki (Ankara) web sunucusundaki dinamik proxy katman disidir (bilinen korluk)
  const d = ek3Kur('');
  d.hosts.push(H3('GBXXWAP05', { products: 'IHS' }));
  d.web.push(W3('GBXXWAP05'));
  d.vhosts.push(V3('GBXXWAP05', 'api.bmw.de', { proxy_targets: '~DYNAMIC', req_7d: 5000, traffic_state: 'ACTIVE' }));
  assert.deepEqual(crmRetire(d).fix, CRM_FIX, 'baska sitedeki dinamik proxy engelledi');
});

test("T3-C6b JVM'siz ya da taranmamis sunucuya cozulen hedef HEDEF'tir; olculmus ve hedef portu dinleyen vhost'u olan sunucu (RP -> WEB) yeniden sayar", () => {
  // ayri WEB (JVM'siz) uzerindeki 'localhost:8180': WEB'de 8180'i dinleyen vhost yok
  for (const hedef of ['localhost:8180', '10.0.0.1:8443', 'gbcjwp01.bmw.local:8443']) {
    const o = { ips: [{ host: APP, ip: '10.1.2.3', iface: 'eth0', used_by: 'other', is_primary: 1 }, { host: WEB, ip: '10.0.0.1', iface: 'eth0', used_by: 'IHS', is_primary: 1 }] };
    for (const crm of [null, CFG_CRM]) {
      const d = ek3Kur(hedef, o);
      if (crm) d.jvms[0] = crm;
      const { u } = engelli(d, `${hedef}${crm ? ' cfg' : ''}`);
      assert.deepEqual(u.unattributed.map((x) => [x.kind, x.reason, x.target]), [['HEDEF', 'JVMSIZ', hedef]], `${hedef}: girdi`);
      assert.ok(normalize(u.text).includes('hedef sunucuda JVM ya da bu portu dinleyen ölçülmüş vhost yok'), u.text);
    }
    // olculmus 0 trafik engellemez
    assert.deepEqual(crmRetire(ek3Kur(hedef, { ...o, vek: SIFIR })).fix, CRM_FIX, `${hedef}: olculmus 0 engelledi`);
  }
  // envanterde olup TARANMAMIS sunucu (LB/RP)
  const tar = (hedef, o) => {
    const d = ek3Kur(hedef, o);
    d.invEnv = [{ host: 'GBCJLB01', env: 'PROD', invProducts: [] }];
    return d;
  };
  const t = engelli(tar('gbcjlb01.bmw.local:443'), 'taranmamis').u;
  assert.deepEqual(t.unattributed.map((x) => [x.kind, x.reason, x.port]), [['HEDEF', 'TARANMAMIS', 443]]);
  assert.ok(normalize(t.text).includes('hedef sunucu taranmamış'), t.text);
  assert.deepEqual(crmRetire(tar('gbcjlb01.bmw.local:443', { vek: SIFIR })).fix, CRM_FIX);

  // SONRAKI HOP: hedef sunucu (Ankara, katman disi) JVM'siz ama OLCULMUS ve hedef portu
  // dinleyen vhost'u var -> trafik orada yeniden sayilir, HEDEF degil.
  const W2 = 'GBCJWAP05';
  const hop = (w2web, listen, o = {}) => {
    const d = ek3Kur(`${W2.toLowerCase()}.bmw.local:8180`);
    const hRow = H3(W2, { products: 'IHS', ...(o.host || {}) });
    const vRow = V3(W2, 'ic.bmw.local', { listen });
    d.hosts.push(o.eski ? eski('host')(hRow) : hRow);
    d.web.push(o.eski ? eski('web')(w2web) : w2web);
    d.vhosts.push(o.eski ? eski('vhost')(vRow) : vRow);
    return d;
  };
  assert.deepEqual(crmRetire(hop(W3(W2), '*:8180')).fix, CRM_FIX, 'olculmus ve 8180 dinleyen sonraki hop HEDEF sayildi');
  assert.deepEqual(crmRetire(hop(W3(W2), '10.9.9.9:443,8180')).fix, CRM_FIX, 'coklu listen ayristirilmadi');
  // port tutmuyor: sonraki hop yok
  assert.deepEqual(engelli(hop(W3(W2), '*:443'), 'port tutmuyor').u.unattributed.map((x) => x.reason), ['JVMSIZ']);
  // olculmemis (vhost_trust NONE) sonraki hop: vhost envanteri eksik olabilir -> HEDEF
  assert.deepEqual(engelli(hop(NONE3(W2), '*:8180'), 'olculmemis hop').u.unattributed.map((x) => x.reason), ['JVMSIZ']);
  // ── TUR 4: sonrakiHop'un port ve OLCUM kosulu (mutantlar V1, V2, V4 yesil kaliyordu) ──
  const jvmsiz = (d, ad) => {
    const { u } = engelli(d, ad);
    assert.deepEqual(u.unattributed.map((x) => [x.kind, x.reason]), [['HEDEF', 'JVMSIZ']], `${ad}: girdi`);
  };
  // (i) port eslesmesi SAYI ile: '*:18180' 8180'i dinlemez (alt dizge degil)
  jvmsiz(hop(W3(W2), '*:18180'), "listen '*:18180' hedef 8180");
  jvmsiz(hop(W3(W2), '10.9.9.9:81800,18180'), "coklu listen '81800,18180' hedef 8180");
  // (ii) sonraki hop TAM olculmus olmali: trafik guveni (trustOk) yetmez - bayat ya da ESKI satirli
  // (scan_ver / vhost_trust NULL) sunucunun vhost envanteri bugunu anlatmaz
  jvmsiz(hop(W3(W2), '*:8180', { host: { scan_date: gunOnce(10) } }), 'bayat hop (10 gun once)');
  jvmsiz(hop(W3(W2), '*:8180', { eski: true }), 'eski satirli hop (scan_ver/vhost_trust NULL)');
  // (iii) listen'i BOS vhost port eslesmesi SAYMAZ (EK-7.5 guvenli yon; joker degil)
  jvmsiz(hop(W3(W2), ''), "hop vhost listen ''");
  // (iv) trafigi OLCULEMEYEN (UNREADABLE, -1) JVM'siz / taranmamis hedef de engeldir (EK-6.9:
  // "trafigi > 0 YA DA olculemediyse"); yalniz 5000 ACTIVE ile sinamak V5 mutantini goremiyordu
  const oIp = { ips: [{ host: APP, ip: '10.1.2.3', iface: 'eth0', used_by: 'other', is_primary: 1 }, { host: WEB, ip: '10.0.0.1', iface: 'eth0', used_by: 'IHS', is_primary: 1 }] };
  for (const crm of [null, CFG_CRM]) {
    const d = ek3Kur('localhost:8180', { ...oIp, vek: OKUNAMADI });
    if (crm) d.jvms[0] = crm;
    const { u } = engelli(d, `localhost:8180 UNREADABLE${crm ? ' cfg' : ''}`);
    assert.deepEqual(u.unattributed.map((x) => [x.kind, x.reason, x.trafficState]), [['HEDEF', 'JVMSIZ', 'UNREADABLE']]);
  }
  const tu = engelli(tar('gbcjlb01.bmw.local:443', { vek: OKUNAMADI }), 'taranmamis UNREADABLE').u;
  assert.deepEqual(tu.unattributed.map((x) => [x.kind, x.reason, x.trafficState]), [['HEDEF', 'TARANMAMIS', 'UNREADABLE']]);
  // KONTROL: JVM'li sunucuya cozulen hedef PORT kapisinda kalir (degismedi)
  assert.equal(engelli(ek3Kur('10.1.2.3:8180'), 'PORT').u.unattributed[0].kind, 'PORT');
});

test("T3-MS3 gateHosts: crm'in esli vhost'u BASKA sitedeki WEB2'de; WEB2'de hedefi bilinmeyen ACTIVE proxy -> retire yok (katman disi ama gateHost)", () => {
  // WEB2 PROD/Ankara: crm'in katmani (PROD/Pendik) DEGIL. crm WEB2'deki crm.bmw.de'ye proxy
  // hedefiyle (kendi IP'si:8180, cfg_ports CLI) EXACT_JVM esli; WEB2 bu yuzden gateHosts'ta.
  const W2 = 'GBCJWAP05';
  const kur = (ek) => ({
    hosts: [H3(APP, { products: 'JBOSS7' }), H3(W2, { products: 'IHS' })],
    jvms: [CFG_CRM],
    web: [W3(W2)],
    ips: [{ host: APP, ip: '10.1.2.3', iface: 'eth0', used_by: 'other', is_primary: 1 }],
    vhosts: [V3(W2, 'crm.bmw.de', { proxy_targets: '10.1.2.3:8180' }), ...ek],
  });
  const k = A(kur([]));
  const crm = sunucu(k, APP).jvms.find((j) => j.name === 'crm');
  assert.equal(crm.mapping, 'EXACT_JVM', 'duzenek: crm WEB2 vhost\'una esli degil');
  assert.ok(crm.gateHosts.includes(W2), 'duzenek: WEB2 gateHosts\'ta degil');
  assert.deepEqual(bul(k, APP, 'RETIRE_CANDIDATE')[0].fix, CRM_FIX, 'kontrol: engel yokken retire yok');
  const { u } = engelli(kur([V3(W2, 'api.bmw.de', { proxy_targets: 'balancer://x', req_24h: 700, req_7d: 5000, traffic_state: 'ACTIVE' })]), 'gateHost');
  assert.deepEqual(u.unattributed.map((x) => [x.host, x.kind, x.target]), [[W2, 'HEDEF', 'balancer://x']]);
});

test("T3-C10 TRAFFIC_UNATTRIBUTED metni olculeni anlatir: cfg'siz durmus JVM'de 'portu olculemedi' VAR, cfg_ports'lu JVM'de YOK", () => {
  const { u } = engelli(ek3Kur('crmcluster'), 'cfgsiz');
  assert.ok(normalize(u.text).includes('portu ölçülemedi ve'), `cfg'siz JVM'de port bilgisi yoklugu soylenmedi: ${u.text}`);
  const d = ek3Kur('crmcluster');
  d.jvms[0] = CFG_CRM;
  assert.ok(!normalize(engelli(d, 'cfgli').u.text).includes('portu ölçülemedi'));
});

// ── C5: proxy_targets userinfo (eski tarayici satirlari) ────────────────────────────

test('C5 proxy_targets userinfo yapisal silinir: assess ciktisinda ve hostDetail yanitinda ham alan yok', () => {
  const { hostDetail } = require('../index.cjs');
  const { hedefUserinfoSil, parseTargets } = require('../assess.cjs');
  assert.equal(hedefUserinfoSil('u:p@h:8080'), 'h:8080');
  assert.deepEqual(parseTargets(hedefUserinfoSil('u:p@h:8080')), [{ host: 'H', port: 8080 }]);
  const r = A({
    hosts: [H3(WEB, { products: 'IHS' })],
    web: [W3(WEB)],
    vhosts: [
      V3(WEB, 'a.bmw.local', { proxy_targets: 'u:p@h:8080' }),
      V3(WEB, 'b.bmw.local', { proxy_targets: 'svc:S3cr@backend:8080, u2:p@ss@gbcjap01:8443' }),
    ],
  });
  const vs = Object.fromEntries(sunucu(r, WEB).vhosts.map((v) => [v.serverName, v]));
  // assess KENDISI temizler (index.cjs'ten bagimsiz)
  assert.equal(vs['a.bmw.local'].proxyTargetsRaw, 'h:8080');
  assert.deepEqual(vs['a.bmw.local'].proxyTargets, [{ host: 'H', port: 8080 }]);
  assert.equal(vs['b.bmw.local'].proxyTargetsRaw.replace(/ /g, ''), 'backend:8080,gbcjap01:8443');
  const json = JSON.stringify(hostDetail(sunucu(r, WEB)));
  for (const sir of ['p@', 'S3cr', 'u:p', 'ss@']) assert.ok(!json.includes(sir), `hostDetail yanitinda userinfo: ${sir}`);
  // hostDetail KENDI temizligini yapar (ucuncu katman): ham sunucu nesnesi
  const h = sunucu(r, WEB);
  const ham = { ...h, vhosts: h.vhosts.map((v) => ({ ...v, proxyTargetsRaw: 'x:Gizli9@z:1' })) };
  const det = hostDetail(ham);
  assert.equal(det.vhosts[0].proxyTargets, 'z:1');
  assert.ok(!JSON.stringify(det).includes('Gizli9'), 'hostDetail spread ile ham proxyTargetsRaw sizdi');
});

// ── C2: envanterdeki web urunu taramada yok -> katmanda olculmemis ──────────────────

test('C2 PRODUCT_NOT_SCANNED web urunu: katman kapisinda olculmus SAYILMAZ (dv_probe8) -> fix null, retireBlock WEB_TIER', () => {
  const WEB2 = 'GBCJWP02';
  const kur = (web2Taranmis) => ({
    hosts: [H3(APP, { products: 'JBOSS7' }), H3(WEB, { products: 'IHS' }), H3(WEB2, { products: web2Taranmis ? 'NGINX' : 'NONE' })],
    jvms: [J3(APP, 'crm')],
    web: [W3(WEB), ...(web2Taranmis ? [W3(WEB2, 'NGINX')] : [])],
    vhosts: [V3(WEB, 'crm.bmw.de')],
    invEnv: [
      { host: APP, env: 'PRODUCTION', invProducts: ['JBOSS'] },
      { host: WEB, env: 'PRODUCTION', invProducts: ['IHS'] },
      { host: WEB2, env: 'PRODUCTION', invProducts: ['NGINX'] },
    ],
  });
  // kontrol: ikinci web sunucusu nginx'i gorduyse katman olculmus -> retire
  assert.deepEqual(crmRetire(kur(true)).fix, CRM_FIX, 'kontrol: tam olculmus katmanda retire yok');
  const r = A(kur(false));
  assert.equal(bul(r, WEB2, 'PRODUCT_NOT_SCANNED').length, 1);
  assert.equal(rebootReadiness(r.hosts, [WEB2]).rows[0].verdict, 'unknown');
  const f = bul(r, APP, 'RETIRE_CANDIDATE')[0];
  assert.equal(f.fix, null, 'Portal\'in "olculemedi" dedigi web sunucusu katman kapisinda olculmus sayildi');
  assert.equal(f.retireBlock, 'WEB_TIER');
  assert.match(f.text, /web katmanında ölçülemeyen host var: GBCJWP02/);
});

// ── C6: tazelikte latestScan sarti TEK BASINA ───────────────────────────────────────

test('C6 latestScan sarti: web sunucusu 2 gun once, uygulama bugun, now bugun -> retire fix null "bayat kanit: <web> <tarih>" (duvar saati 2 gune izin verir)', () => {
  const d = tamKanit();
  d.hosts[1] = H3(WEB, { products: 'IHS', scan_date: gunOnce(2) });
  const r = A(d);
  // duvar saati sarti bu sunucuyu GECIRIR (2 <= FRESH_MAX_DAYS); bayat sayan tek sart latestScan
  const f = bul(r, APP, 'RETIRE_CANDIDATE');
  assert.equal(f.length, 1);
  assert.equal(f[0].fix, null, '2 gunluk web kaniti bugunun retire eylemini besledi (latestScan sarti yok)');
  assert.ok(f[0].text.includes(`bayat kanıt: ${WEB} ${gunOnce(2)}`), f[0].text);
  assert.equal(sunucu(r, WEB).fresh, false);
  assert.equal(sunucu(r, APP).fresh, true);
});

test('C6 sinir: ayni gun taranmis filo (latestScan sarti devre disi) - now=g+2 taze, now=g+3 bayat', () => {
  const d = tamKanit();
  const g2 = A(d, NOW + 2 * 86400000);
  assert.ok(g2.hosts.every((h) => h.fresh), 'g+2 bayat sayildi (sinir <= FRESH_MAX_DAYS)');
  assert.deepEqual(bul(g2, APP, 'RETIRE_CANDIDATE')[0].fix, RETIRE_FIX, 'g+2 eylem kalkti');
  assert.equal(g2.staleFleet, null);
  const g3 = A(d, NOW + 3 * 86400000);
  assert.ok(g3.hosts.every((h) => !h.fresh), 'g+3 taze sayildi');
  assert.equal(bul(g3, APP, 'RETIRE_CANDIDATE')[0].fix, null, 'g+3 eylem kalkmadi');
});

// ── M1/M2: tirnakli ve XML sir serbest metin alanlarinda (hostDetail) ───────────────

test('M1/M2 tirnakli deger ve XML bicimli sir JBOSS.note / WEB.detail / LoadIssues.detail\'de maskeli', () => {
  const { hostDetail } = require('../index.cjs');
  const r = A({
    hosts: [H3(APP, { products: 'JBOSS7 IHS' })],
    jboss: [{ host: APP, gen: 7, host_name: 'm', host_state: 'running', cli: 'FAIL', note: 'cli rc=1 <secret value="cGFzc3dvcmQ="/> x' }],
    web: [W3(APP, 'IHS', { syntax: 'UNKNOWN', check_class: 'UNKNOWN', syntax_verification: 'NOT_VERIFIED', vhost_trust: 'NONE', detail: 'ERR password="quoted secret" <password>Dsx77</password>' })],
    loadIssues: [{ host: APP, scan_date: BUGUN, issue: 'SQL_ERROR', detail: 'token="T0k3n"', run_at: `${BUGUN}T14:00:00Z` }],
  });
  const json = JSON.stringify(hostDetail(sunucu(r, APP)));
  for (const sir of ['cGFzc3dvcmQ=', 'quoted secret', 'Dsx77', 'T0k3n']) assert.ok(!json.includes(sir), `maskelenmemis sir: ${sir}`);
  assert.ok(json.includes('<secret value=\\"***\\"/>'), 'XML bicimi korunmadi');
  assert.ok(json.includes('password=\\"***\\"'), 'tirnaklar korunmadi');
});

// ── G7 (Portal): maskeleme ──────────────────────────────────────────────────────────

const VAKALAR = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'mask_cases.json'), 'utf8'),
).vakalar;
const sekme = (s) => String(s).replace(/<TAB>/g, '\t');

test('D1-C26 ortak 40 maske vakasi (14 sozlesme + M1-M3 + Unicode + jvm_arg_diff + EK-7.8) mask.cjs\'te birebir (G7)', () => {
  assert.equal(
    VAKALAR.length,
    40,
    'ortak vaka listesi 40 degil (14 + M1-M3 5 + T2-M1 Unicode 8 + T2-M2 jvm_arg_diff 6 + R8a 1 + bicimsiz/devam 6)',
  );
  assert.deepEqual(
    VAKALAR.map((v) => v.no),
    Array.from({ length: 40 }, (_, i) => i + 1),
    'vaka numaralari 1..40 sirali degil (TSV ile birebir karsilastirilir)',
  );
  const ISLEV = {
    serbest: mask.maskText,
    alan: mask.maskText,
    jvm_args: mask.maskJvmArgs,
    jvm_arg_diff: mask.maskJvmArgDiff,
  };
  for (const v of VAKALAR) {
    const girdi = sekme(v.girdi);
    const beklenen = sekme(v.beklenen);
    assert.ok(Object.prototype.hasOwnProperty.call(ISLEV, v.tur), `vaka ${v.no}: bilinmeyen tur ${v.tur}`);
    const cikti = ISLEV[v.tur](girdi);
    assert.equal(cikti, beklenen, `vaka ${v.no}`);
    // -D belirtecleri jvm_args beyaz listesinden de ayni sonucu almali
    if (v.tur === 'serbest' && girdi.startsWith('-D'))
      assert.equal(mask.maskJvmArgs(girdi), beklenen, `vaka ${v.no} (beyaz liste)`);
  }
});

test('G7 desenler sekmeyi asamaz: R1-R6 icinde bosluk sinifi [[:space:]] / \\s YOK', () => {
  for (const d of mask.DESENLER) {
    assert.ok(!d.desen.includes('[[:space:]]'), `${d.ad} POSIX sinifi iceriyor`);
    assert.ok(!/\\s/.test(d.desen), `${d.ad} \\s iceriyor (sekmeyi esler)`);
  }
});

test('D1-C15 hostDetail maskeli: note/detail/bulgu metni deseni, jvm_args BEYAZ LISTE; discover hub.runningKnown', () => {
  const { hostDetail } = require('../index.cjs');
  const d = {
    hosts: [H3(APP, { products: 'JBOSS7 IHS', note: 'kullanici=www x.keyStorePassword=abc' })],
    jboss: [{ host: APP, gen: 7, host_name: 'm', host_state: 'running', cli: 'FAIL', note: 'x.keyStorePassword=abc dzdo' }],
    jvms: [
      J3(APP, 'k1', {
        running: 1,
        running_src: 'PS',
        auto_start: 'true',
        server_state: 'running',
        ports: '8080',
        jvm_args: '-Xmx2g -Dfoo.bar=baz -Djboss.node.name=n1 -Ddb.password=gizli1',
      }),
    ],
    web: [W3(APP, 'IHS', { syntax: 'UNKNOWN', check_class: 'UNKNOWN', syntax_verification: 'NOT_VERIFIED', vhost_trust: 'NONE', detail: 'sozdizimi OLCULEMEDI: token: xyz' })],
  };
  const h = sunucu(A(d), APP);
  const det = hostDetail(h);
  const json = JSON.stringify(det);
  for (const sir of ['abc', 'xyz', 'baz', 'gizli1'])
    assert.ok(!json.includes(sir), `ayrintida maskelenmemis sir: ${sir}`);
  assert.match(det.jboss[0].note, /keyStorePassword=\*\*\*/);
  assert.equal(det.jvms[0].jvmArgs, '-Xmx2g -Dfoo.bar=*** -Djboss.node.name=n1 -Ddb.password=***');
  // agir kolonlar ayri sorgudan (tek sunucu) gelirse de maskelenir
  const agir = new Map([['7|k1', { jvm_args: '-Dapp.encryption.key=K3y -Duser.timezone=UTC', jvm_arg_diff: '-Dfoo.bar running=a configured=b' }]]);
  const det2 = hostDetail(h, agir);
  assert.equal(det2.jvms[0].jvmArgs, '-Dapp.encryption.key=*** -Duser.timezone=UTC');
  assert.equal(det2.jvms[0].jvmArgDiff, '-Dfoo.bar running=*** configured=*** (farkli)');
  // bulgu listesi (Bulgular sekmesi) de maskeli metin tasir
  assert.ok(!JSON.stringify(flattenFindings([h])).includes('abc'));
  // hostDetail KENDI maskesini uygular (assess'ten bagimsiz ucuncu katman): ham sunucu nesnesi
  const ham = {
    ...h,
    note: 'pass=abc1',
    findings: [{ code: 'X', severity: 'info', area: 'scan', text: 'token: abc2', fix: null }],
    jboss: [{ gen: 7, note: 'password=abc3', cliRescue: 'runs=1 secret=abc4' }],
    web: [{ product: 'IHS', detail: 'pwd=abc5', runningSrc: 'PS' }],
    jvms: [
      {
        ...h.jvms[0],
        jvmArgs: '-Dfoo=abc6',
        configuredJvmArgs: '-Dbar=abc7',
        jvmArgDiff: '-Dfoo running=abc8 configured=x',
      },
    ],
  };
  const hamJson = JSON.stringify(hostDetail(ham));
  for (const sir of ['abc1', 'abc2', 'abc3', 'abc4', 'abc5', 'abc6', 'abc7', 'abc8'])
    assert.ok(!hamJson.includes(sir), `hostDetail maskelemedi: ${sir}`);
  // discover: UNMEASURED -> bilinmiyor; BLIND+PS ve kolonsuz satir -> bilinen
  const t = buildTargets('CRM', [{ app: 'CRM', host: 'GBCRAP01' }, { app: 'CRM', host: 'GBCRAP02' }, { app: 'CRM', host: 'GBCRAP03' }], [], [
    { host: 'GBCRAP01', jvm: 'CRM', running: 0, auto_start: 'true', running_src: 'UNMEASURED' },
    { host: 'GBCRAP02', jvm: 'CRM', running: 1, auto_start: 'true', running_src: 'PS' },
    { host: 'GBCRAP03', jvm: 'CRM', running: 0, auto_start: 'true' },
  ]);
  const hub = Object.fromEntries(t.targets.map((x) => [x.host, x.hub]));
  assert.equal(hub.GBCRAP01.runningKnown, false);
  assert.equal(hub.GBCRAP02.runningKnown, true);
  assert.equal(hub.GBCRAP03.runningKnown, true);
});

// ── P9: sys.columns tabanli kolon listeleri (sahte sorgu) ───────────────────────────

// Sozlesme v3 DDL'inden nihai kolonlar (id ve scan_date dahil) - SPEC yazim hatasi bekcisi.
const V3_SEMA = {
  Server_Hub_Hosts: ['id', 'scan_date', 'host', 'products', 'wall_s', 'cpu_s', 'note', 'scan_ver', 'rec_counts', 'scan_errors', 'proc_visibility', 'sock_visibility', 'loaded_at'],
  Server_Hub_Init: ['id', 'scan_date', 'host', 'root', 'file', 'status', 'sha512'],
  Server_Hub_Jboss: ['id', 'scan_date', 'host', 'gen', 'host_name', 'host_state', 'cli', 'note', 'mgmt_cfg', 'mgmt_state', 'cli_rescue', 'cli_run_as', 'host_config', 'dc_role'],
  Server_Hub_Jvms: ['id', 'scan_date', 'host', 'gen', 'jvm', 'grp', 'running', 'auto_start', 'server_state', 'ports', 'running_src', 'cfg_src', 'state_src', 'config_changed', 'config_risk', 'config_mtime_epoch', 'process_start_epoch', 'os_startup', 'reboot_expected', 'reboot_status', 'cfg_ports', 'cfg_ports_src', 'jvm_arg_status', 'jvm_args_src', 'jvm_args', 'configured_jvm_args', 'jvm_arg_diff'],
  Server_Hub_Web: ['id', 'scan_date', 'host', 'product', 'running', 'syntax', 'detail', 'check_class', 'syntax_verification', 'run_as', 'check_rc', 'vhost_trust', 'running_src'],
  Server_Hub_Vhosts: ['id', 'scan_date', 'host', 'product', 'listen', 'server_name', 'aliases', 'access_log', 'proxy_targets', 'req_24h', 'req_7d', 'hc_24h', 'shared', 'sampled', 'conf_file', 'traffic_state', 'traffic_reason', 'cover_from_epoch', 'last_req_epoch', 'last_line_epoch', 'log_read_as'],
  Server_Hub_Ips: ['id', 'scan_date', 'host', 'ip', 'iface', 'used_by', 'is_primary'],
  Server_Hub_Sshd: ['id', 'scan_date', 'host', 'max_sessions', 'max_startups', 'active_sessions'],
  Server_Hub_LoadIssues: ['id', 'scan_date', 'host', 'issue', 'detail', 'run_at'],
};
const SAYILAR = { Server_Hub_Hosts: 13, Server_Hub_Init: 7, Server_Hub_Jboss: 14, Server_Hub_Jvms: 27, Server_Hub_Web: 13, Server_Hub_Vhosts: 21, Server_Hub_Ips: 7, Server_Hub_Sshd: 6, Server_Hub_LoadIssues: 6 };
// Eski 8 tablolu sema: yalniz CREATE TABLE govdeleri (DDL henuz kosmamis)
const ESKI_SEMA = {
  Server_Hub_Hosts: V3_SEMA.Server_Hub_Hosts.slice(0, 7),
  Server_Hub_Init: V3_SEMA.Server_Hub_Init,
  Server_Hub_Jboss: V3_SEMA.Server_Hub_Jboss.slice(0, 8),
  Server_Hub_Jvms: V3_SEMA.Server_Hub_Jvms.slice(0, 10),
  Server_Hub_Web: V3_SEMA.Server_Hub_Web.slice(0, 7),
  Server_Hub_Vhosts: V3_SEMA.Server_Hub_Vhosts.slice(0, 15),
  Server_Hub_Ips: V3_SEMA.Server_Hub_Ips,
  Server_Hub_Sshd: V3_SEMA.Server_Hub_Sshd,
};
const YENI_KOLON_ADLARI = Object.keys(ESKI_SEMA).flatMap((t) =>
  V3_SEMA[t].filter((c) => !ESKI_SEMA[t].includes(c)),
);

/** SQL Server gibi davranan sahte sorgu: semada olmayan kolon/tablo -> istisna. */
function sahteSorgu(sema, satirlar, kayit) {
  return async (sqlText) => {
    const s = String(sqlText);
    kayit.push(s);
    if (/OBJECT_ID\('dbo\.Server_Hub_Hosts'\) AS oid/.test(s)) return { recordset: [{ oid: 1 }] };
    if (/FROM sys\.columns c WHERE c\.object_id IN/.test(s)) {
      const out = [];
      for (const m of s.matchAll(/OBJECT_ID\('dbo\.(\w+)'\)/g))
        for (const c of sema[m[1]] || []) out.push({ tbl: m[1], name: c });
      return { recordset: out };
    }
    const tekTablo = /sys\.columns WHERE object_id = OBJECT_ID\('dbo\.(\w+)'\)/.exec(s);
    if (tekTablo) return { recordset: (sema[tekTablo[1]] || []).map((name) => ({ name })) };
    if (/dbo\.MWAppsInventory|FROM dbo\.Inventory|BMW_Certificates_Inventory/.test(s)) return { recordset: [] };
    if (/dbo\.Server_Hub_LoadIssues/.test(s)) {
      if (!sema.Server_Hub_LoadIssues) throw new Error("Invalid object name 'dbo.Server_Hub_LoadIssues'.");
      return { recordset: satirlar.Server_Hub_LoadIssues || [] };
    }
    const m = /FROM dbo\.(Server_Hub_\w+) t\b/.exec(s);
    if (m) {
      const cols = sema[m[1]];
      if (!cols) throw new Error(`Invalid object name 'dbo.${m[1]}'.`);
      if (/\bt\.\*/.test(s)) return { recordset: satirlar[m[1]] || [] };
      const secilen = [...s.matchAll(/\bt\.\[?(\w+)\]?/g)].map((x) => x[1]);
      for (const c of secilen) if (!cols.includes(c)) throw new Error(`Invalid column name '${c}'.`);
      return {
        recordset: (satirlar[m[1]] || []).map((r) =>
          Object.fromEntries(Object.entries(r).filter(([k]) => secilen.includes(k))),
        ),
      };
    }
    throw new Error(`sahte sorgu: beklenmeyen SQL ${s.slice(0, 80)}`);
  };
}

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}
const sahteSql = { NVarChar: () => 'nvarchar' };
let aktifSorgu = null;
stub('../../inventory/mssql.cjs', { query: (...a) => aktifSorgu(...a), sql: sahteSql });

const gunumuz = new Date().toISOString().slice(0, 10);
const ESKI_SATIRLAR = {
  Server_Hub_Hosts: [{ id: 1, scan_date: gunumuz, host: APP, products: 'JBOSS7', wall_s: 1, cpu_s: 0.1, note: 'kosan: www' }, { id: 2, scan_date: gunumuz, host: WEB, products: 'IHS', wall_s: 1, cpu_s: 0.1, note: '' }],
  Server_Hub_Init: [],
  Server_Hub_Jboss: [],
  Server_Hub_Jvms: [{ id: 1, scan_date: gunumuz, host: APP, gen: 7, jvm: 'oldapp', grp: 'g', running: 0, auto_start: 'false', server_state: 'stopped', ports: '' }],
  Server_Hub_Web: [{ id: 1, scan_date: gunumuz, host: WEB, product: 'IHS', running: 1, syntax: 'OK', detail: '1 vhost' }],
  Server_Hub_Vhosts: [{ id: 1, scan_date: gunumuz, host: WEB, product: 'IHS', listen: '*:443', server_name: 'oldapp.bmw.local', aliases: '', access_log: '/l/o', proxy_targets: '', req_24h: 0, req_7d: 0, hc_24h: 0, shared: 0, sampled: 0, conf_file: '/c/o.conf' }],
  Server_Hub_Ips: [],
  Server_Hub_Sshd: [],
};

test('D1-C11 + P9: v3 semada kolonlar acik listede; yildizli SELECT yok; filo Jvms sorgusunda jvm_args ailesi yok; SPEC kolonlari DDL alt kumesi', async () => {
  for (const [t, n] of Object.entries(SAYILAR)) assert.equal(V3_SEMA[t].length, n, `${t} kolon sayisi sozlesmeyle uyusmuyor`);
  const { loadLatest, SH_KOLONLAR, JVM_AGIR_KOLONLAR } = require('../index.cjs');
  for (const [t, cols] of Object.entries(SH_KOLONLAR))
    for (const c of cols) assert.ok(V3_SEMA[t.slice(4)].includes(c), `SPEC kolonu DDL'de yok (yazim?): ${t}.${c}`);
  const kayit = [];
  aktifSorgu = sahteSorgu(V3_SEMA, {
    ...ESKI_SATIRLAR,
    Server_Hub_Hosts: ESKI_SATIRLAR.Server_Hub_Hosts.map((r) => ({ ...r, scan_ver: '2.1', scan_errors: 'fuse:VHOST=2' })),
    Server_Hub_LoadIssues: [{ host: APP, scan_date: gunumuz, issue: 'SQL_ERROR', detail: 'password=abc', run_at: new Date() }],
  }, kayit);
  const { data } = await loadLatest();
  const veri = kayit.filter((s) => /FROM dbo\.Server_Hub_(Hosts|Init|Jboss|Jvms|Web|Vhosts|Ips|Sshd) t\b/.test(s));
  assert.equal(veri.length, 8);
  for (const s of veri) assert.ok(!/\bt\.\*/.test(s), `yildizli SELECT: ${s.slice(0, 60)}`);
  const jvmSql = veri.find((s) => /FROM dbo\.Server_Hub_Jvms t\b/.test(s));
  for (const c of JVM_AGIR_KOLONLAR) assert.ok(!jvmSql.includes(`[${c}]`), `filo sorgusunda agir kolon: ${c}`);
  assert.ok(jvmSql.includes('[running_src]') && jvmSql.includes('[cfg_src]'));
  assert.ok(veri.find((s) => /Server_Hub_Init t\b/.test(s)).includes('t.[file]'), "'file' koseli yazilmali");
  assert.equal(data.hosts[0].scan_ver, '2.1');
  assert.equal(data.loadIssues.length, 1);
  // LoadIssues tablosu YOKSA uclar dusmez
  aktifSorgu = sahteSorgu({ ...V3_SEMA, Server_Hub_LoadIssues: undefined }, ESKI_SATIRLAR, []);
  assert.deepEqual((await loadLatest()).data.loadIssues, []);
  // metin bekcisi (normalize): LoadIssues sorgusunun catch'i
  const src = normalize(fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8'));
  const i = src.indexOf('FROM dbo.Server_Hub_LoadIssues li');
  assert.ok(i > 0, 'LoadIssues sorgusu bulunamadi');
  assert.ok(src.slice(i, i + 500).includes('.catch(() => [])'), 'LoadIssues sorgusunda .catch(() => []) yok');
});

test('D1-C22 eski 8 tablolu sema: loadLatest dusmez, SELECT\'lerde yeni kolon yok, yeni alanlar null, eski satir fix null; /overview /host /reboot-readiness 200', async () => {
  const kayit = [];
  aktifSorgu = sahteSorgu(ESKI_SEMA, ESKI_SATIRLAR, kayit);
  const { loadLatest, initServerHub } = require('../index.cjs');
  const { data } = await loadLatest();
  const veri = kayit.filter((s) => /FROM dbo\.Server_Hub_\w+ t\b/.test(s));
  for (const s of veri)
    for (const c of YENI_KOLON_ADLARI)
      assert.ok(!new RegExp(`\\[${c}\\]`).test(s), `eski semada yeni kolon secildi: ${c}`);
  assert.equal(data.hosts[0].scan_ver, undefined);
  const r = assess(data);
  const h = sunucu(r, APP);
  assert.equal(h.scanVer, null);
  assert.equal(h.jvms[0].runningSrc, null);
  assert.equal(h.jvms[0].runningKnown, true);
  assert.equal(bul(r, APP, 'RETIRE_CANDIDATE')[0].fix, null, 'eski satir P1 davranisi: eylem yok');
  // HTTP: uclar 200
  stub('../../auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
  stub('../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { role: 'Admin', username: 'test' } };
    next();
  });
  const log = console.log;
  console.log = () => {};
  try {
    initServerHub(app);
  } finally {
    console.log = log;
  }
  const srv = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  try {
    const kok = `http://127.0.0.1:${srv.address().port}/api/server-hub`;
    const o = await fetch(`${kok}/overview?fresh=1`);
    assert.equal(o.status, 200, '/overview eski semada dustu');
    const oj = await o.json();
    assert.equal(oj.ok, true);
    assert.equal(oj.rollback.allowed, true);
    const hh = await fetch(`${kok}/host/${APP}?fresh=1`);
    assert.equal(hh.status, 200, '/host eski semada dustu');
    const rr = await fetch(`${kok}/reboot-readiness`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hosts: [APP, WEB] }),
    });
    assert.equal(rr.status, 200, '/reboot-readiness eski semada dustu');
  } finally {
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close();
  }
});

test('D1-C28 discover: running_src kolonu yokken sorgu dusmez (sys.columns), runningKnown=true; kolon varken UNMEASURED -> false', async () => {
  const inv = [{ app: 'CRM', host: 'GBCRAP01', env: 'Production', domain: '', jboss_version: '7.4', app_path: '', status: 'stopped' }];
  const satirlar = { Server_Hub_Jvms: [{ host: 'GBCRAP01', jvm: 'CRM', running: 0, auto_start: 'true', scan_date: gunumuz, running_src: 'UNMEASURED' }] };
  const db = (sema) => ({
    sql: sahteSql,
    query: async (s, p) => {
      if (/dbo\.MWAppsInventory/.test(s)) return { recordset: inv };
      return sahteSorgu(sema, satirlar, [])(s, p);
    },
  });
  const eskiR = await discover('CRM', db({ Server_Hub_Jvms: ESKI_SEMA.Server_Hub_Jvms, Server_Hub_Hosts: ESKI_SEMA.Server_Hub_Hosts }));
  assert.ok(eskiR.targets[0].hub, 'kolon eksikligi hedefleri "tarama yok" gosterdi');
  assert.equal(eskiR.targets[0].hub.runningKnown, true);
  assert.equal(eskiR.summary.hubUnavailable, false);
  const yeniR = await discover('CRM', db(V3_SEMA));
  assert.equal(yeniR.targets[0].hub.runningKnown, false);
  assert.equal(yeniR.targets[0].hub.runningSrc, 'UNMEASURED');
  // Server Hub hic okunamazsa "tarama yok" degil, "okunamadi" isaretlenir
  const warn = console.warn;
  console.warn = () => {};
  try {
    const yok = await discover('CRM', db({}));
    assert.equal(yok.summary.hubUnavailable, true);
  } finally {
    console.warn = warn;
  }
});

// ── C3 / C7: sunucu uclari (gercek router, sahte mssql) ─────────────────────────────

/** Gercek index.cjs router'ini ayaga kaldirir; fn(kok) bitince kapatir. */
async function httpIle(fn) {
  stub('../../auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
  stub('../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
  const { initServerHub } = require('../index.cjs');
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { role: 'Admin', username: 'test' } };
    next();
  });
  const log = console.log;
  console.log = () => {};
  try {
    initServerHub(app);
  } finally {
    console.log = log;
  }
  const srv = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}/api/server-hub`);
  } finally {
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close();
  }
}
const SYS_COLUMNS_COK = /FROM sys\.columns c WHERE c\.object_id IN/;
/** v3 satirlari: BLIND sunucuda olculemeyen JVM (auto-start acik) + calisan auto-start
 * kapali JVM + tam v2 kanitli durmus oldapp. Sema okunabilirse eylemler VARDIR. */
const v3Satirlar = (gun) => ({
  Server_Hub_Hosts: [
    { id: 1, scan_date: gun, host: APP, products: 'JBOSS7', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.1', rec_counts: '', scan_errors: '', proc_visibility: 'BLIND', sock_visibility: 'PID', loaded_at: `${gun}T06:00:00Z` },
    { id: 2, scan_date: gun, host: WEB, products: 'IHS', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.1', rec_counts: '', scan_errors: '', proc_visibility: 'FULL', sock_visibility: 'PID', loaded_at: `${gun}T06:00:00Z` },
  ],
  Server_Hub_Init: [],
  Server_Hub_Jboss: [],
  Server_Hub_Jvms: [
    { id: 1, scan_date: gun, ...J3(APP, 'gizli', { running_src: 'UNMEASURED', auto_start: 'true', server_state: 'unknown' }) },
    { id: 2, scan_date: gun, ...J3(APP, 'kosan', { running: 1, running_src: 'PS', auto_start: 'false', server_state: 'running', ports: '8080' }) },
    { id: 3, scan_date: gun, ...J3(APP, 'oldapp') },
  ],
  Server_Hub_Web: [{ id: 1, scan_date: gun, ...W3(WEB) }, { id: 2, scan_date: gun, ...W3(APP, 'IHS', { running: 0, running_src: 'UNMEASURED' }) }],
  Server_Hub_Vhosts: [{ id: 1, scan_date: gun, ...V3(WEB, 'oldapp.bmw.local') }],
  Server_Hub_Ips: [],
  Server_Hub_Sshd: [],
  Server_Hub_LoadIssues: [],
});

test('C3 sys.columns sorgusu duserse KAPALI: hicbir fix yok, running=0 bilinmiyor, rollback.allowed=false, hazirlik unknown, sonuc onbellege alinmaz', async () => {
  const { loadLatest } = require('../index.cjs');
  const satirlar = v3Satirlar(gunumuz);
  // kontrol: sema okunabilirken ayni veride eylemler VAR (autostart_off, autostart_on, retire)
  aktifSorgu = sahteSorgu(V3_SEMA, satirlar, []);
  const saglam = assess((await loadLatest()).data);
  const saglamEylem = saglam.hosts.flatMap((h) => h.findings.filter((f) => f.fix).map((f) => f.fix.action)).sort();
  assert.deepEqual(saglamEylem, ['jboss_autostart_on', 'jboss_retire'], `kontrol: saglam semada eylemler beklenmedik: ${saglamEylem}`);
  // sys.columns (coklu tablo) gecici hata atar; diger sorgular doner
  let semaSorgusu = 0;
  const ic = sahteSorgu(V3_SEMA, satirlar, []);
  aktifSorgu = async (s, p) => {
    if (SYS_COLUMNS_COK.test(String(s))) {
      semaSorgusu += 1;
      throw new Error('Timeout expired');
    }
    return ic(s, p);
  };
  const { data } = await loadLatest();
  assert.equal(data.schemaUnknown, true, 'sema okunamadi isaretlenmedi');
  const r = assess(data);
  assert.deepEqual(tumFix(r), [], 'sema bilinmiyorken eylem onerildi');
  const gizli = sunucu(r, APP).jvms.find((j) => j.name === 'gizli');
  assert.equal(gizli.runningKnown, false, 'running_src secilemeyen running=0 JVM "kapali" sayildi');
  assert.ok(!bul(r, APP, 'STOPPED_AUTOSTART_ON').length, 'olculemeyen JVM STOPPED_AUTOSTART_ON uretti');
  assert.equal(r.summary.jvm.stopped, 0);
  assert.equal(r.summary.scanVersion.rollbackAllowed, false);
  assert.equal(r.schemaUnknown, true);
  await httpIle(async (kok) => {
    semaSorgusu = 0;
    const o = await (await fetch(`${kok}/overview?fresh=1`)).json();
    assert.equal(o.ok, true);
    assert.equal(o.schemaUnknown, true, '/overview sema bilinmiyor demiyor');
    assert.equal(o.rollback.allowed, false, 'sema bilinmiyorken geri alma serbest dendi (EK-1 tersine dondu)');
    // ONBELLEK YOK: ikinci (fresh olmayan) istek kolonlari YENIDEN okur
    const o2 = await (await fetch(`${kok}/overview`)).json();
    assert.equal(o2.schemaUnknown, true);
    assert.equal(semaSorgusu, 2, `sema bilinmiyor sonucu onbellege alindi (sys.columns ${semaSorgusu} kez)`);
    const f = await (await fetch(`${kok}/findings?fresh=1`)).json();
    assert.ok(f.findings.length > 0);
    assert.ok(f.findings.every((x) => !x.fix && !x.fixable), '/findings eylem tasiyor');
    const hd = await (await fetch(`${kok}/host/${APP}?fresh=1`)).json();
    assert.equal(hd.host.schemaUnknown, true);
    assert.ok(hd.host.jvms.find((j) => j.name === 'gizli').runningKnown === false);
    assert.equal(hd.host.web[0].runningSrc, 'UNMEASURED', 'calismayan web "calismiyor" gosterilir');
    const rr = await (
      await fetch(`${kok}/reboot-readiness`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: [APP, WEB] }),
      })
    ).json();
    for (const x of rr.rows) assert.equal(x.verdict, 'unknown', `${x.host} sema bilinmiyorken ${x.verdict}`);
    // /fix: sunucu eylemi yeniden turetir; sema bilinmiyorken HICBIR eylem kabul edilmez
    const fx = await fetch(`${kok}/fix`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: APP, code: 'REBOOT_RISK', fixKey: JSON.stringify({ action: 'jboss_autostart_on', gen: 7, jvm: 'kosan' }) }),
    });
    assert.equal(fx.status, 400, 'sema bilinmiyorken /fix eylemi kabul etti');
  });
  // sema yeniden okunabilir olunca eylemler geri gelir (kalici kapanma yok)
  aktifSorgu = sahteSorgu(V3_SEMA, satirlar, []);
  await httpIle(async (kok) => {
    const o = await (await fetch(`${kok}/overview?fresh=1`)).json();
    assert.equal(o.schemaUnknown, false);
    assert.equal(o.rollback.allowed, false, 'v3 veri varken geri alma serbest');
    assert.equal(o.rollback.v3Hosts, 2);
  });
});

test('C3 discover: Server_Hub_Jvms kolon sorgusu duserse hubUnavailable=true ve hicbir hedefe hub verisi baglanmaz', async () => {
  const inv = [{ app: 'CRM', host: 'GBCRAP01', env: 'Production', domain: '', jboss_version: '7.4', app_path: '', status: 'stopped' }];
  const satirlar = { Server_Hub_Jvms: [{ host: 'GBCRAP01', jvm: 'CRM', running: 0, auto_start: 'true', scan_date: gunumuz, running_src: 'UNMEASURED' }] };
  const ic = sahteSorgu(V3_SEMA, satirlar, []);
  const db = {
    sql: sahteSql,
    query: async (s, p) => {
      if (/dbo\.MWAppsInventory/.test(s)) return { recordset: inv };
      if (/sys\.columns WHERE object_id = OBJECT_ID\('dbo\.Server_Hub_Jvms'\)/.test(s)) throw new Error('deadlock victim');
      return ic(s, p);
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  let r;
  try {
    r = await discover('CRM', db);
  } finally {
    console.warn = warn;
  }
  assert.equal(r.summary.hubUnavailable, true, 'kolon sorgusu hatasi Server Hub okunamadi sayilmadi');
  assert.ok(r.targets.length === 1 && r.targets[0].hub === null, 'kolonlari bilinmeyen Jvms satiri hedefe baglandi ("kapali" okunur)');
});

test('C7 /findings staleFleet tasir (HTTP): bayat filoda /overview ile AYNI, taze filoda null', async () => {
  const bes = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  aktifSorgu = sahteSorgu(V3_SEMA, v3Satirlar(bes), []);
  await httpIle(async (kok) => {
    const o = await (await fetch(`${kok}/overview?fresh=1`)).json();
    const f = await (await fetch(`${kok}/findings?fresh=1`)).json();
    assert.ok(o.staleFleet && o.staleFleet.ageDays === 5, 'duzenek: /overview bayat demiyor');
    assert.ok(Object.prototype.hasOwnProperty.call(f, 'staleFleet'), '/findings staleFleet alanini tasimiyor');
    assert.deepEqual(f.staleFleet, o.staleFleet, '/findings ve /overview bayatligi farkli bildiriyor');
  });
  aktifSorgu = sahteSorgu(V3_SEMA, v3Satirlar(gunumuz), []);
  await httpIle(async (kok) => {
    const f = await (await fetch(`${kok}/findings?fresh=1`)).json();
    assert.equal(f.staleFleet, null);
  });
});

// ── TUR 3 #8: /jvm-autostart tanimsiz surece (cfg_src=UNAVAILABLE) is ACMAZ ─────────────
// Satir dugmesi bulgudan bagimsizdir; eskiden cfgSrc'ye bakmadan plan_only:false is aciyordu
// (playbook 'host xml'de tanimli degil' ile dusuyordu). Gercek router + sahte mssql; AWX'e
// gidilmez: playbook kaydi sahte (template yok -> 501), yani kontrol JVM'i TUM kapilardan
// gecip launch'a ulasir, tanimsiz surec ondan ONCE 400 ile durur.
test("T3-C8b /jvm-autostart: UNAVAILABLE JVM 400 'tanim kaynaginda yok' (envanter 'false' olsa da); tanimli JVM kapilari gecer", async () => {
  stub('../../ansible/playbook-registry.cjs', { getByKey: async () => null, getEffectiveTemplateId: () => null });
  const g = gunumuz;
  const satirlar = {
    ...v3Satirlar(g),
    Server_Hub_Jboss: [{ id: 1, scan_date: g, host: APP, gen: 7, host_name: 'm', host_state: 'running', cli: 'OK', note: '' }],
    Server_Hub_Jvms: [
      { id: 1, scan_date: g, ...J3(APP, 'kosan', { running: 1, running_src: 'PS', auto_start: 'false', server_state: 'running', ports: '8080' }) },
      { id: 2, scan_date: g, ...J3(APP, 'hayalet', { running: 1, running_src: 'PS', auto_start: 'unknown', server_state: 'unknown', cfg_src: 'UNAVAILABLE', ports: '8180' }) },
    ],
  };
  const ic = sahteSorgu(V3_SEMA, satirlar, []);
  const inv = [{ host: APP, app: 'hayalet', env: 'PROD', domain: 'd', status: 'running', jvm_count: 1, autostarts: 'false', tier: null }];
  aktifSorgu = async (s, p) => (/dbo\.MWAppsInventory/.test(String(s)) ? { recordset: inv } : ic(s, p));
  await httpIle(async (kok) => {
    const post = (body) =>
      fetch(`${kok}/jvm-autostart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: APP, gen: 7, confirmed: true, ...body }),
      });
    for (const enable of [true, false]) {
      const r = await post({ jvm: 'hayalet', enable });
      assert.equal(r.status, 400, `tanimsiz surece auto-start ${enable ? 'acma' : 'kapama'} isi kabul edildi (${r.status})`);
      const j = await r.json();
      assert.ok(normalize(j.message).includes('tanım kaynağında yok'), j.message);
    }
    // KONTROL: tanimli JVM tum kapilari gecer ve launch'a ulasir (sahte kayit: template yok)
    const k = await post({ jvm: 'kosan', enable: true });
    assert.equal(k.status, 501, `kontrol: tanimli JVM launch'a ulasmadi (${k.status})`);
  });
});

// ── TUR 4: /jvm-autostart YAZMA KAPILARI (EK-7.10 C acik isi) ─────────────────────────────
// Satir dugmesi bulgudan bagimsizdir; /fix'in finding.fix kapilarini (bayat / sema) devralmaz.
// Eskiden yalniz cfg_src=UNAVAILABLE reddediliyordu: 5 gun once taranmis sunucuda ya da sema
// okunamadiyken plan_only:false is aciliyordu (v3 "bayat sunucuda TUM yazma eylemleri
// onerilmez", EK-6.13 "schemaUnknown: HICBIR eylem"). running_src=UNMEASURED BILEREK kapi degil
// (v3: tek-JVM dugmesi admine acik, onay metni uyarir) - kontrol vakasi launch'a ulasir.
test('T4-C11 /jvm-autostart: bayat sunucu ve sema okunamadi 400 (is acilmaz); running_src=UNMEASURED kapi DEGIL', async () => {
  stub('../../ansible/playbook-registry.cjs', { getByKey: async () => null, getEffectiveTemplateId: () => null });
  const satir = (appGun) => {
    const s = v3Satirlar(gunumuz);
    s.Server_Hub_Hosts = s.Server_Hub_Hosts.map((x) =>
      x.host === APP ? { ...x, scan_date: appGun, loaded_at: `${appGun}T06:00:00Z` } : x,
    );
    return s;
  };
  const post = (kok, body) =>
    fetch(`${kok}/jvm-autostart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: APP, gen: 7, confirmed: true, ...body }),
    });
  // (a) BAYAT: APP 5 gun once taranmis, WEB bugun (latestScan bugun) -> APP !fresh
  const bes = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  aktifSorgu = sahteSorgu(V3_SEMA, satir(bes), []);
  await httpIle(async (kok) => {
    for (const enable of [true, false]) {
      const r = await post(kok, { jvm: 'kosan', enable });
      assert.equal(r.status, 400, `bayat sunucuda auto-start ${enable ? 'acma' : 'kapama'} isi kabul edildi (${r.status})`);
      const j = await r.json();
      assert.ok(normalize(j.message).includes('bayat'), j.message);
      assert.ok(normalize(j.message).includes('iş açılmadı'), j.message);
    }
  });
  // (b) SEMA OKUNAMADI: sys.columns (coklu tablo) dusuyor
  const ic = sahteSorgu(V3_SEMA, satir(gunumuz), []);
  aktifSorgu = async (s, p) => {
    if (SYS_COLUMNS_COK.test(String(s))) throw new Error('Timeout expired');
    return ic(s, p);
  };
  await httpIle(async (kok) => {
    const r = await post(kok, { jvm: 'kosan', enable: true });
    assert.equal(r.status, 400, `sema okunamadiyken auto-start isi kabul edildi (${r.status})`);
    assert.ok(normalize((await r.json()).message).includes('şeması'), 'sebep sema degil');
  });
  // KONTROL: taze sunucu + okunan sema -> kapilar gecilir (launch: sahte kayit -> 501); calisma
  // durumu OLCULEMEYEN 'gizli' JVM de launch'a ulasir (running_src kapi degil, v3)
  aktifSorgu = sahteSorgu(V3_SEMA, satir(gunumuz), []);
  await httpIle(async (kok) => {
    const k = await post(kok, { jvm: 'kosan', enable: true });
    assert.equal(k.status, 501, `kontrol: taze sunucuda tanimli JVM launch'a ulasmadi (${k.status})`);
    const g = await post(kok, { jvm: 'gizli', enable: false });
    assert.equal(g.status, 501, `running_src=UNMEASURED JVM kapida kaldi (${g.status}) - v3: dugme admine acik`);
  });
});

// ── TUR 4: vhost conf'u OKUNAMADI (CONF_UNREADABLE) -> hedefleri bilinmiyor ────────────────
// Dogrulayici probe_confunr: tarayici conf'u okunamayan vhost'a proxy_targets='' basiyordu;
// Portal onu "proxy yok" sayip ayni katmandaki durmus crm'e jboss_retire oneriyordu. Tarayici
// artik '~DYNAMIC' yazar (A, sc_H3); Portal ayrica (derinlemesine savunma, eski satirlar)
// CONF_UNREADABLE vhost'u HEDEF/CONF_OKUNAMADI sayar ve metni "conf okunamadi" der.
test("T4-C12 CONF_UNREADABLE vhost: '' (eski satir) ve '~DYNAMIC' (yeni tarayici) -> retire yok, HEDEF/CONF_OKUNAMADI; blok bulunamadi '~DYNAMIC' -> DINAMIK", () => {
  const confU = { req_24h: -1, req_7d: -1, hc_24h: -1, access_log: '', traffic_state: 'UNREADABLE', traffic_reason: 'CONF_UNREADABLE' };
  for (const [ad, crm] of [['cfgsiz', null], ['cfg_ports CLI', CFG_CRM]]) {
    for (const hedef of ['', '~DYNAMIC']) {
      const d = ek3Kur(hedef, { vek: confU });
      if (crm) d.jvms[0] = crm;
      const { u } = engelli(d, `${ad} CONF_UNREADABLE '${hedef}'`);
      assert.deepEqual(
        u.unattributed.map((x) => [x.kind, x.reason, x.target, x.serverName]),
        [['HEDEF', 'CONF_OKUNAMADI', hedef ? '~DYNAMIC' : null, 'api.bmw.de']],
        `${ad} '${hedef}': tek girdi (CONF_OKUNAMADI) bekleniyordu`,
      );
      const t = normalize(u.text);
      assert.ok(t.includes("hedef bilinmiyor (vhost conf'u okunamadı)"), u.text);
      assert.ok(!t.includes('hedef kaydı yok'), `conf okunamadigi halde "hedef kaydi yok" dendi: ${u.text}`);
    }
  }
  // blok bulunamadi (conf okundu): '~DYNAMIC' + NO_VHOST_LOG -> DINAMIK (trafik olculemedi -> engel)
  const nvl = { req_24h: -1, req_7d: -1, hc_24h: -1, access_log: '', traffic_state: 'UNVERIFIED', traffic_reason: 'NO_VHOST_LOG' };
  assert.deepEqual(engelli(ek3Kur('~DYNAMIC', { vek: nvl }), 'blok bulunamadi').u.unattributed.map((x) => x.reason), ['DINAMIK']);
  // KONTROL: okunan conf'ta proxy'siz vhost (gercekten proxy yok) retire'i engellemez
  assert.deepEqual(crmRetire(ek3Kur('')).fix, CRM_FIX);
});
