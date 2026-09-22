// server/nginx-console/__tests__/drift.test.cjs — "Tutarlılık" (2026-09-22): ayni servis+ortam
// sunuculari arasinda dosya bazinda sha farki (GLOMO eski sunuculari vb.).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeDrift, expectedLocal } = require('../drift.cjs');

const inv = [
  { host: 'GBRVPP07', env: 'prod', services: ['GLOMO'] },
  { host: 'GBRVPP08', env: 'prod', services: ['GLOMO'] },
  { host: 'GBRVPAP07', env: 'prod', services: ['GLOMO'] },
  { host: 'GBRVPT01', env: 'test', services: ['GLOMO'] },
  { host: 'GBNGXP40', env: 'prod', services: ['SPA', 'GLOMO'] },
];
const tree = (files) => ({ tree: Object.entries(files).map(([p, sha]) => ({ path: p, sha256: sha, size: 10, mtime: '2026-09-01 00:00:00' })) });
const dumps = new Map([
  ['GBRVPP07', tree({ '/usr/nginx/conf.d/GLOMO-PROD.conf': 'A', '/usr/nginx/conf/bmw_defaults.conf': 'D', '/usr/nginx/conf.d/only07.conf': 'X', '/usr/nginx/conf.d/GLOMO-PROD.conf_945': 'B', '/usr/nginx/conf.d/gbrvpp07-local.conf': 'L1' })],
  ['GBRVPP08', tree({ '/usr/nginx/conf.d/GLOMO-PROD.conf': 'A', '/usr/nginx/conf/bmw_defaults.conf': 'D2', '/usr/nginx/conf.d/gbrvpp08-local.conf': 'L2' })],
  ['GBRVPAP07', tree({ '/usr/nginx/conf.d/GLOMO-PROD.conf': 'A2', '/usr/nginx/conf/bmw_defaults.conf': 'D' })],
  ['GBNGXP40', tree({ '/usr/nginx/conf.d/SPA.conf': 'S' })],
]);

test('DR1 grup = servis+ortam; tek dokumlu grup karsilastirilmaz; cok servisli host her grupta', () => {
  const r = computeDrift(inv, dumps);
  const keys = r.groups.map((g) => g.key).sort();
  assert.deepEqual(keys, ['GLOMO|prod', 'GLOMO|test', 'SPA|prod']);
  const glomo = r.groups.find((g) => g.key === 'GLOMO|prod');
  assert.deepEqual(glomo.hosts, ['GBNGXP40', 'GBRVPAP07', 'GBRVPP07', 'GBRVPP08']);
  assert.deepEqual(glomo.dumped, ['GBNGXP40', 'GBRVPAP07', 'GBRVPP07', 'GBRVPP08']);
  const t = r.groups.find((g) => g.key === 'GLOMO|test');
  assert.equal(t.dumped.length, 0); assert.deepEqual(t.dumpMissing, ['GBRVPT01']); assert.equal(t.files.length, 0);
  const spa = r.groups.find((g) => g.key === 'SPA|prod');
  assert.equal(spa.files.length, 0, 'tek dokumlu grup karsilastirilmaz');
});

test('DR2 farkli / eksik / sunucuya ozel siniflari; cogunluk ustte; sayaclar', () => {
  const r = computeDrift(inv.filter((h) => h.host.startsWith('GBRVP')), dumps);
  const g = r.groups.find((x) => x.key === 'GLOMO|prod');
  const by = Object.fromEntries(g.files.map((f) => [f.path, f]));
  const main = by['/usr/nginx/conf.d/GLOMO-PROD.conf'];
  assert.equal(main.status, 'differ'); assert.equal(main.variants.length, 2);
  assert.deepEqual(main.variants[0].hosts, ['GBRVPP07', 'GBRVPP08'], 'cogunluk (A) ustte');
  assert.deepEqual(main.variants[1].hosts, ['GBRVPAP07']);
  assert.equal(main.majority, 'A');
  const defaults = by['/usr/nginx/conf/bmw_defaults.conf'];
  assert.equal(defaults.status, 'differ'); assert.equal(defaults.variants[0].sha, 'D');
  assert.equal(by['/usr/nginx/conf.d/only07.conf'].status, 'missing');
  assert.deepEqual(by['/usr/nginx/conf.d/only07.conf'].missing, ['GBRVPAP07', 'GBRVPP08']);
  assert.equal(by['/usr/nginx/conf.d/GLOMO-PROD.conf_945'].status, 'local', 'deployment yedegi beklenen fark');
  assert.equal(by['/usr/nginx/conf.d/gbrvpp07-local.conf'].status, 'local', 'yolunda host adi');
  assert.deepEqual(g.counts, { same: 0, differ: 2, missing: 1, local: 3 });
  assert.deepEqual(g.files.map((f) => f.status), ['differ', 'differ', 'missing', 'local', 'local', 'local'], 'siralama: farkli, eksik, ozel');
});

test('DR3 hepsi ayni -> same sayilir, listelenmez; expectedLocal', () => {
  const d = new Map([['H1', tree({ '/a.conf': 'Z' })], ['H2', tree({ '/a.conf': 'Z' })]]);
  const r = computeDrift([{ host: 'H1', env: 'prod', services: ['X'] }, { host: 'H2', env: 'prod', services: ['X'] }], d);
  assert.deepEqual(r.groups[0].counts, { same: 1, differ: 0, missing: 0, local: 0 });
  assert.equal(r.groups[0].files.length, 0);
  assert.ok(expectedLocal('/usr/nginx/conf.d/x.conf.bak', 'H1') && expectedLocal('/etc/h1.conf', 'H1') && !expectedLocal('/etc/app.conf', 'H1'));
});

test('DR4 UI/uc sozlesmesi: /drift ucu, Tutarlilik sekmesi, Instances durum suzgeci, Audit hizli suzgec + kabul edilen degerler', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.ok(idx.includes("router.get('/drift'") && idx.includes('computeDrift(hosts, dumps)'), '/drift ucu');
  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'NginxConsolePage.tsx'), 'utf8');
  assert.ok(/\{tab === 'drift' && <DriftTab/.test(page) && page.includes("label: 'Tutarlılık'"), 'Tutarlilik sekmesi');
  const nim = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'NimTabs.tsx'), 'utf8');
  for (const id of ["'offline'", "'tfail'", "'nodump'", "'unknownver'"]) assert.ok(nim.includes(id), 'Instances suzgeci ' + id);
  const audit = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxAudit.tsx'), 'utf8');
  assert.ok(audit.includes("'upsNoKeepalive', 'keepalive yok'") && audit.includes("title=\"Kabul edilen değerler\""), 'Audit hizli suzgec + kabul paneli');
  const den = fs.readFileSync(path.join(__dirname, '..', '..', 'audit', 'denetim.cjs'), 'utf8');
  assert.ok(den.includes("router.put('/nginx-audit/allowed'") && den.includes("router.delete('/nginx-audit/allowed/:id'") && den.includes('allowedQ,'), 'allowed uclari + yukleme');
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.ok(setup.includes("name: 'nginx_audit_allowed_values'"), 'seed tablosu');
  const drift = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'DriftTab.tsx'), 'utf8');
  assert.ok(/title=\{f\.path\}/.test(drift) && /title=\{g\.hosts\.join/.test(drift) && !/confirm\(|alert\(/.test(drift), 'kirpilan alanlarda title, popup yok');
});
