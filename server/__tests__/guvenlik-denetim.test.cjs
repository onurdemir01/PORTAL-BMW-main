// server/__tests__/guvenlik-denetim.test.cjs — Xray taban kapisi ve npm audit karar mantigi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { XRAY_TABAN, karar, xrayTabanKontrol } = require('../../scripts/guvenlik-denetim.cjs');

const KOK = path.join(__dirname, '..', '..');

test('karar(): runtime bulgu veya duzeltmesi olan dev bulgu dusurur; duzeltmesiz dev bilgidir', () => {
  const kilit = {
    'node_modules/hono': { version: '4.13.18', dev: false },
    'node_modules/picomatch': { version: '4.0.7', dev: true },
    'node_modules/vite': { version: '8.3.7', dev: true },
  };
  const r = karar(
    {
      vulnerabilities: {
        hono: { severity: 'high', fixAvailable: false },
        picomatch: { severity: 'high', fixAvailable: false },
        vite: { severity: 'moderate', fixAvailable: true },
      },
    },
    kilit,
  );
  assert.equal(r.bilgi.length, 1);
  assert.match(r.bilgi[0], /picomatch/);
  assert.equal(r.dusuren.length, 2);
  assert.ok(r.dusuren.some((s) => s.includes('hono')));
  assert.ok(r.dusuren.some((s) => s.includes('vite')));
});

test('karar(): npm downgrade onerisi picomatch yamasi sayilmaz; gercek ileri yama kapiyi acar', () => {
  const kilit = {
    'node_modules/picomatch': { version: '4.0.7', dev: true },
    'node_modules/vite': { version: '8.3.7', dev: true },
  };
  const audit = {
    vulnerabilities: {
      picomatch: {
        severity: 'high',
        nodes: ['node_modules/picomatch'],
        via: [{ url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }],
        fixAvailable: { name: 'vite', version: '6.2.7' },
      },
      vite: {
        severity: 'high',
        nodes: ['node_modules/vite'],
        via: ['picomatch'],
        fixAvailable: { name: 'vite', version: '6.2.7' },
      },
      vitest: {
        severity: 'high',
        nodes: ['node_modules/vitest'],
        via: ['coverage-v8', 'vite'],
        fixAvailable: { name: 'vitest', version: '3.1.4' },
      },
      'coverage-v8': {
        severity: 'high',
        nodes: ['node_modules/coverage-v8'],
        via: ['vitest'],
        fixAvailable: true,
      },
    },
  };
  const yamasiz = karar(audit, kilit);
  assert.deepEqual(yamasiz.dusuren, []);
  assert.equal(yamasiz.bilgi.length, 4, 'dongulu audit zinciri yalanci yama uretmemeli');

  audit.vulnerabilities.picomatch.fixAvailable = { name: 'picomatch', version: '4.0.8' };
  const yamali = karar(audit, kilit);
  assert.equal(yamali.dusuren.length, 4, 'gercek ileri yama yayinlaninca tum zincir bloke etmeli');
});

test('xrayTabanKontrol(): gecerli repo kilit dosyalarinda 0 ihlal doner', () => {
  const tam =
    JSON.parse(fs.readFileSync(path.join(KOK, 'gelistirme', 'package-lock.json'), 'utf8'))
      .packages || {};
  const kok =
    JSON.parse(fs.readFileSync(path.join(KOK, 'package-lock.json'), 'utf8')).packages || {};
  const r = xrayTabanKontrol(tam, kok);
  assert.deepEqual(r.dusuren, []);
  assert.ok(XRAY_TABAN.hono[4] === '4.13.18');
});

test('xrayTabanKontrol(): eski Xray surumlerini, gercek uri-js ve runtime picomatch sizintisini yakalar', () => {
  const r = xrayTabanKontrol(
    {
      'node_modules/hono': { version: '4.13.0', dev: false },
      'node_modules/@hono/node-server': { version: '2.1.6', dev: false },
      'node_modules/vite': { version: '8.3.0', dev: true },
      'node_modules/minimatch': { version: '11.0.7', dev: true },
      'node_modules/brace-expansion': { version: '5.0.12', dev: true },
      'node_modules/uri-js': {
        version: '4.4.1',
        resolved: 'https://registry.npmjs.org/uri-js/-/uri-js-4.4.1.tgz',
      },
      'node_modules/picomatch': { version: '4.0.7', dev: true },
    },
    {
      'node_modules/picomatch': { version: '4.0.7', dev: false },
      'node_modules/eslint': { version: '9.0.0', dev: true },
    },
  );
  assert.ok(r.dusuren.some((s) => s.includes('hono@4.13.0')));
  assert.ok(r.dusuren.some((s) => s.includes('@hono/node-server@2.1.6')));
  assert.ok(r.dusuren.some((s) => s.includes('vite@8.3.0')));
  assert.ok(r.dusuren.some((s) => s.includes('minimatch@11.0.7')));
  assert.ok(r.dusuren.some((s) => s.includes('brace-expansion@5.0.12')));
  assert.ok(r.dusuren.some((s) => s.includes('uri-js@4.4.1')));
  assert.ok(r.dusuren.some((s) => s.includes('kok kilitte dev/devOptional yasak')));
  assert.ok(r.dusuren.some((s) => s.includes('calisma zamani kok kilidinde yasak')));
  assert.equal(r.bilgi.length, 1);
  assert.match(r.bilgi[0], /picomatch@4\.0\.7/);
});
