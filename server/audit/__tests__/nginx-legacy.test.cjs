// server/audit/__tests__/nginx-legacy.test.cjs
//
// Denetim > "Nginx Legacy (PROD)" ekraninin hesabini kilitler.
//
// EN KRITIK KARAR: servis toplamlari sunucular arasinda TOPLANMAZ, EN YUKSEK sunucudan
// alinir. Ayni tanim her eslenik sunucuda tekrar ettigi icin toplamak, "236 location"
// yerine "1888 location" gibi sunucu adedi kadar sisirilmis bir sayi uretirdi. Bu,
// fark edilmesi zor ama raporu tamamen yaniltan turden bir hatadir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeLegacy } = require('../nginx-legacy.cjs');

const row = (host, service, over = {}) => ({
  host,
  service,
  peer_group: 'B',
  vhost_files: service + '-PROD',
  upstream_files: service.toLowerCase() + '-prod-upstreams',
  server_blocks: 2,
  locations_total: 240,
  locations_proxy: 236,
  locations_other: 4,
  upstreams_total: 236,
  upstreams_in_vhost: 0,
  upstreams_in_file: 236,
  proxy_without_upstream: 1,
  unused_upstreams: 9,
  ups_no_resolve: 0,
  ups_no_keepalive: 0,
  ups_no_zone: 0,
  ...over,
});

test('servis toplamlari TOPLANMAZ - eslenik sunucular ayni tanimi tekrar eder', () => {
  const out = summarizeLegacy(
    [row('GBRVPP07', 'GLOMO'), row('GBRVPP08', 'GLOMO'), row('GBRVPP09', 'GLOMO')],
    [],
  );
  const g = out.services[0];
  assert.equal(g.hostCount, 3);
  // Uc sunucu x 240 = 720 DEGIL.
  assert.equal(g.locationsTotal, 240);
  assert.equal(g.upstreamsTotal, 236);
  assert.equal(out.totals.locations, 240);
});

test('eslenik sunucular AYNI ise tutarli, farkli ise isaretlenir', () => {
  const same = summarizeLegacy([row('GBRVPP07', 'GLOMO'), row('GBRVPP08', 'GLOMO')], []);
  assert.equal(same.services[0].consistent, true);
  assert.equal(same.totals.inconsistent, 0);

  const diff = summarizeLegacy(
    [row('GBRVPP07', 'GLOMO'), row('GBRVPP08', 'GLOMO', { locations_total: 239 })],
    [],
  );
  assert.equal(diff.services[0].consistent, false);
  assert.equal(diff.totals.inconsistent, 1);
  assert.equal(diff.services[0].signatures.length, 2);
});

test('en yuksek sunucu esas alinir - eksik olan toplami dusurmez', () => {
  const out = summarizeLegacy(
    [row('GBRVPP07', 'GLOMO'), row('GBRVPP08', 'GLOMO', { locations_total: 100 })],
    [],
  );
  assert.equal(out.services[0].locationsTotal, 240);
});

test('bulgular sunucuya dagitilir ve ONEM sirasina gore dizilir', () => {
  const out = summarizeLegacy(
    [row('GBRVPP07', 'GLOMO')],
    [
      { host: 'GBRVPP07', service: 'GLOMO', finding_type: 'UNUSED_UPSTREAM', item: 'z-ups' },
      { host: 'GBRVPP07', service: 'GLOMO', finding_type: 'PROXY_NO_UPSTREAM', item: '/a/' },
      {
        host: 'GBRVPP07',
        service: 'GLOMO',
        finding_type: 'PEER_MISSING_LOCATION',
        item: '/b/',
      },
    ],
  );
  const f = out.services[0].hosts[0].findings;
  // Once nginx davranisini gercekten degistirenler.
  assert.deepEqual(
    f.map((x) => x.type),
    ['PEER_MISSING_LOCATION', 'PROXY_NO_UPSTREAM', 'UNUSED_UPSTREAM'],
  );
  // Tip kodu degil, okunabilir etiket gosterilmeli.
  assert.equal(f[1].label, 'upstream katmanını atlıyor');
  assert.equal(out.services[0].findings, 3);
});

test('bulgusu cok olan servis basta', () => {
  const out = summarizeLegacy(
    [row('GBRVPP07', 'GLOMO'), row('GBRVPP01', 'WEBFORMS')],
    [
      { host: 'GBRVPP01', service: 'WEBFORMS', finding_type: 'UPS_NO_ZONE', item: 'u1' },
      { host: 'GBRVPP01', service: 'WEBFORMS', finding_type: 'UPS_NO_ZONE', item: 'u2' },
    ],
  );
  assert.equal(out.services[0].service, 'WEBFORMS');
});

test('bilinmeyen bulgu tipi GIZLENMEZ, kodu ile gosterilir', () => {
  const out = summarizeLegacy(
    [row('GBRVPP07', 'GLOMO')],
    [{ host: 'GBRVPP07', service: 'GLOMO', finding_type: 'YENI_TIP', item: 'x' }],
  );
  const f = out.services[0].hosts[0].findings[0];
  assert.equal(f.label, 'YENI_TIP');
  assert.equal(out.byType[0].type, 'YENI_TIP');
});

test('bos girdi cokmez', () => {
  const out = summarizeLegacy([], []);
  assert.equal(out.services.length, 0);
  assert.equal(out.totals.hosts, 0);
  assert.equal(out.totals.findings, 0);
});
