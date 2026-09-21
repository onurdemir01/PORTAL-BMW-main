// server/audit/__tests__/route-traffic.test.cjs — RT1..RT7 (2026-09-21).
//
// Route Trafigi siniflamasi: "bu route yasiyor mu?" hukmu gun toplamlarindan verilir.
// Kilit: esikler (30/90 gun), cluster'larin toplanmasi, envanterde olup trafik satiri
// olmayan route'un "veri yok" olmasi, ilk kosunun 14 gunluk penceresinin gunluk
// ortalamayi sisirmemesi, ve denetim.cjs'in sekme kapisi/rotasi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildRouteTraffic } = require('../route-traffic.cjs');

const NOW = new Date('2026-09-21T10:00:00Z');
const day = (n) => new Date(Date.UTC(2026, 8, 21 - n)); // n gun once
const row = (n, ns, route, req, extra = {}) => ({
  scan_date: day(n), window_hours: 24, cluster: 'gbocpprod1', namespace: ns, route, req_total: req,
  r2xx: req, r4xx: 0, r5xx: 0, ...extra,
});
const inv = (ns, route, address = '') => ({ cluster_name: 'gbocpprod1', namespace_name: ns, route_name: route, route_address: address });

test('RT1: son 30 gunde istek -> active; 30-90 arasi -> silent; hic -> dead', () => {
  const t = [
    row(1, 'a-prod', 'x', 5), row(45, 'a-prod', 'x', 1),
    row(1, 'b-prod', 'y', 0), row(45, 'b-prod', 'y', 3),
    row(1, 'c-prod', 'z', 0), row(60, 'c-prod', 'z', 0),
  ];
  const r = buildRouteTraffic(t, [], { now: NOW });
  const by = Object.fromEntries(r.rows.map((x) => [x.route, x]));
  assert.equal(by.x.status, 'active');
  assert.equal(by.y.status, 'silent');
  assert.equal(by.z.status, 'dead');
  assert.equal(by.y.lastSeen, '2026-08-07');
  assert.equal(by.z.lastSeen, null);
  assert.deepEqual(r.summary, { routes: 3, active: 1, silent: 1, dead: 1, nodata: 0, spa: 0, spaDead: 0 });
});

test('RT2: envanterde var, trafik satiri yok -> nodata (listede gorunur)', () => {
  const r = buildRouteTraffic([row(1, 'a-prod', 'x', 1)], [inv('a-prod', 'x'), inv('q-prod', 'ghost', 'ghost-q-prod.apps.x')], { now: NOW });
  const ghost = r.rows.find((x) => x.route === 'ghost');
  assert.ok(ghost);
  assert.equal(ghost.status, 'nodata');
  assert.equal(ghost.inInventory, true);
  assert.equal(ghost.address, 'ghost-q-prod.apps.x');
  assert.equal(r.rows.find((x) => x.route === 'x').inInventory, true);
});

test('RT3: ayni route iki cluster\'da -> toplanir, cluster listesi ikisini de tasir', () => {
  const t = [row(1, 'a-prod', 'x', 2), row(1, 'a-prod', 'x', 3, { cluster: 'gbocpprod2' })];
  const r = buildRouteTraffic(t, [], { now: NOW });
  assert.equal(r.rows[0].req7, 5);
  assert.deepEqual(r.rows[0].clusters, ['gbocpprod1', 'gbocpprod2']);
});

test('RT4: ilk kosu 14d penceresi (336 saat) gunluk ortalamayi sisirmez', () => {
  const t = [row(1, 'a-prod', 'x', 1400, { window_hours: 336 })];
  const r = buildRouteTraffic(t, [], { now: NOW });
  assert.equal(r.rows[0].req30, 1400);
  assert.equal(r.rows[0].perDay, 100); // 1400 / 14 gun
});

test('RT5: SPA tespiti adresten (-app-v), 4xx/5xx yuzdesi 90 gun toplamindan', () => {
  const t = [row(1, 'a-prod', 'cso-app-v1-route-1', 100, { r2xx: 0, r4xx: 100 }), row(2, 'a-prod', 'api', 200, { r2xx: 190, r5xx: 10 })];
  const r = buildRouteTraffic(t, [inv('a-prod', 'cso-app-v1-route-1', 'cso-app-v1-a-prod.apps.x')], { now: NOW });
  const by = Object.fromEntries(r.rows.map((x) => [x.route, x]));
  assert.equal(by['cso-app-v1-route-1'].spa, true);
  assert.equal(by['cso-app-v1-route-1'].err4xxPct, 100);
  assert.equal(by['cso-app-v1-route-1'].app, 'cso-app-v1');
  assert.equal(by.api.spa, false);
  assert.equal(by.api.err5xxPct, 5);
  assert.equal(r.summary.spa, 1);
});

test('RT6: kapsanan gun sayisi ve tarih araligi donuyor (ekran "veri N gun" notu)', () => {
  const r = buildRouteTraffic([row(1, 'a', 'x', 1), row(3, 'a', 'x', 1), row(3, 'b', 'y', 0)], [], { now: NOW });
  assert.equal(r.daysCovered, 2);
  assert.equal(r.latestScan, '2026-09-20');
  assert.equal(r.earliestScan, '2026-09-18');
  assert.equal(r.deadDays, 90);
});

test('RT7: denetim.cjs rota + sekme kapisi + seed + sayfa sekmesi', () => {
  const den = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  assert.match(den, /\[\/\^\\\/route-traffic\(\\\/\|\$\)\/, 'routetraffic'\]/);
  assert.match(den, /router\.get\('\/route-traffic'/);
  assert.match(den, /DATEADD\(day, -\$\{DEAD_DAYS\}/);
  const seed = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(seed, /element_key: 'tab:denetim:routetraffic'/);
  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'DenetimPage.tsx'), 'utf8');
  assert.match(page, /id: 'routetraffic', label: 'Route Trafiği'/);
});
