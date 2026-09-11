// server/audit/__tests__/nginx-audit.test.cjs
//
// Denetim > "Nginx Audit" ekraninin hesabini kilitler (bes tablo -> host bazli gorunum).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeAudit } = require('../nginx-audit.cjs');

const host = (h, over = {}) => ({
  host: h,
  status: 'ok',
  files: 7,
  server_blocks: 2,
  locations: 10,
  locations_proxy: 8,
  upstreams: 5,
  ups_no_resolve: 0,
  ups_no_keepalive: 0,
  ups_no_zone: 0,
  unused_upstreams: 0,
  proxy_fqdn: 0,
  proxy_undefined: 0,
  settings_mismatch: 0,
  ...over,
});

test('bes tablo host bazinda birlesir; dosya adi kisaltilir, tam yol korunur', () => {
  const out = summarizeAudit({
    hosts: [host('GBRVPP07')],
    servers: [
      {
        host: 'GBRVPP07',
        conf_file: '/usr/nginx/conf.d/GLOMO-PROD.conf',
        seq: 1,
        listen: '10.0.0.1:444 ssl',
        server_name: 'glomo.x',
        ssl: 1,
        cert_file: '/usr/nginx/ssl/wildcard.x.crt',
        locations: 9,
      },
    ],
    locations: [],
    upstreams: [],
    settings: [],
  });
  const s = out.hosts[0].servers[0];
  assert.equal(s.file, 'GLOMO-PROD.conf');
  assert.equal(s.filePath, '/usr/nginx/conf.d/GLOMO-PROD.conf');
  assert.equal(s.cert, 'wildcard.x.crt');
  assert.equal(s.ssl, true);
  assert.equal(s.locations, 9);
});

test('location ozeti DOSYA bazinda; bulgu olanlar ADIYLA listelenir', () => {
  const L = (file, location, kind, target) => ({
    host: 'GBRVPP07',
    conf_file: file,
    srv_seq: 1,
    location,
    behaviour: kind === 'none' ? 'deny' : 'proxy',
    proxy_target: target,
    target_kind: kind,
  });
  const out = summarizeAudit({
    hosts: [host('GBRVPP07')],
    servers: [],
    locations: [
      L('/c/A.conf', '/a/', 'upstream', 'ups-a'),
      L('/c/A.conf', '/b/', 'fqdn', 'b.apps.fw'),
      L('/c/A.conf', '/c/', 'undefined', 'yok'),
      L('/c/A.conf', '~ /\\.', 'none', ''),
      L('/c/B.conf', '/d/', 'upstream', 'ups-d'),
    ],
    upstreams: [],
    settings: [],
  });
  const files = out.hosts[0].locationsByFile;
  assert.equal(files.length, 2);
  const a = files.find((f) => f.file === 'A.conf');
  assert.equal(a.total, 4);
  assert.equal(a.proxy, 3);
  assert.equal(a.other, 1);
  assert.deepEqual(a.fqdnList, [{ location: '/b/', target: 'b.apps.fw' }]);
  assert.deepEqual(a.undefinedList, [{ location: '/c/', target: 'yok' }]);
  // Cok location'i olan dosya ustte.
  assert.equal(files[0].file, 'A.conf');
});

test('ayarlar: GLOBAL uyumsuzluk bulgu, server/location farki OVERRIDE (sayilir)', () => {
  const S = (ctx, directive, value, ref, matches, file = '/c/x.conf') => ({
    host: 'GBRVPP07',
    conf_file: file,
    context: ctx,
    directive,
    value,
    reference_value: ref,
    matches,
  });
  const out = summarizeAudit({
    hosts: [host('GBRVPP07')],
    servers: [],
    locations: [],
    upstreams: [],
    settings: [
      S('main', 'autoindex', 'off', 'off', 1),
      S('main', 'server_tokens', 'on', 'off', 0), // GLOBAL SAPMA
      S('global', 'charset', '', 'utf-8', 0, ''), // referansta var, sunucuda YOK
      S('location', 'proxy_read_timeout', '60s', '20s', 0),
      S('location', 'proxy_read_timeout', '60s', '20s', 0),
      S('location', 'proxy_read_timeout', '60s', '20s', 0),
      S('server', 'ssl_protocols', 'TLSv1.2', 'TLSv1.2 TLSv1.3', 0),
    ],
  });
  const h = out.hosts[0];
  assert.deepEqual(
    h.settingsMismatched.map((m) => [m.directive, m.missing]),
    [
      ['charset', true],
      ['server_tokens', false],
    ],
  );
  // 3 ayni override -> TEK satir, count=3. Once en cok tekrar eden.
  assert.deepEqual(
    h.settingsOverrides.map((o) => [o.directive, o.value, o.count]),
    [
      ['proxy_read_timeout', '60s', 3],
      ['ssl_protocols', 'TLSv1.2', 1],
    ],
  );
});

test('siralama: -T dusen en ustte, sonra tanimsiz hedef, sonra global sapma', () => {
  const out = summarizeAudit({
    hosts: [
      host('GBTEMIZ'),
      host('GBSAPMA', { settings_mismatch: 2 }),
      host('GBTANIMSIZ', { proxy_undefined: 1 }),
      host('GBBOZUK', { status: 'fail' }),
    ],
    servers: [],
    locations: [],
    upstreams: [],
    settings: [],
  });
  assert.deepEqual(
    out.hosts.map((h) => h.host),
    ['GBBOZUK', 'GBTANIMSIZ', 'GBSAPMA', 'GBTEMIZ'],
  );
  assert.equal(out.totals.configInvalid, 1);
  assert.equal(out.totals.hostsWithMismatch, 1);
});

test('ortam ve lokasyon sunucu adindan turer', () => {
  const out = summarizeAudit({
    hosts: [host('GBRVPAP03'), host('GBNGXT50')],
    servers: [],
    locations: [],
    upstreams: [],
    settings: [],
  });
  const ap = out.hosts.find((h) => h.host === 'GBRVPAP03');
  assert.equal(ap.env, 'PROD');
  assert.equal(ap.site, 'Ankara');
  const t50 = out.hosts.find((h) => h.host === 'GBNGXT50');
  assert.equal(t50.tier, 'intranet');
});

test('bos girdi cokmez', () => {
  const out = summarizeAudit({ hosts: [], servers: [], locations: [], upstreams: [], settings: [] });
  assert.equal(out.hosts.length, 0);
  assert.equal(out.totals.hosts, 0);
});
