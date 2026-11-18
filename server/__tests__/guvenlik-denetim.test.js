// server/__tests__/guvenlik-denetim.test.js — Xray taban kapisi ve npm audit karar mantigi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  XRAY_TABAN,
  karar,
  xrayTabanKontrol,
  gercekDuzeltme,
  kokDuzeltmeVar,
} = require('../../scripts/guvenlik-denetim.cjs');

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

test('karar(): eski ana surume inme onerisi duzeltme sayilmaz; yeni surume yukseltme sayilir', () => {
  const kilit = {
    'node_modules/picomatch': { version: '4.0.7', dev: true },
    'node_modules/vite': { version: '8.3.7', dev: true },
    'node_modules/fdir': { version: '6.4.0', dev: true },
  };
  // 2026-11-18 gercek audit bicimi: picomatch <=4.0.7, npm "vite 6.2.7 (ana surum)" oneriyor.
  const geri = { name: 'vite', version: '6.2.7', isSemVerMajor: true };
  const r = karar(
    {
      vulnerabilities: {
        picomatch: { severity: 'high', fixAvailable: geri },
        fdir: { severity: 'high', fixAvailable: geri },
        vite: { severity: 'high', fixAvailable: geri },
      },
    },
    kilit,
  );
  assert.deepEqual(r.dusuren, []);
  assert.equal(r.bilgi.length, 3);
  // Yukseltme gercek duzeltmedir (ana surum olsa bile); calisma zamani bulgusu her durumda dusurur.
  assert.equal(
    gercekDuzeltme({ name: 'vite', version: '9.0.1', isSemVerMajor: true }, kilit),
    true,
  );
  assert.equal(
    gercekDuzeltme({ name: 'vite', version: '8.3.8', isSemVerMajor: false }, kilit),
    true,
  );
  assert.equal(gercekDuzeltme(true, kilit), true);
  assert.equal(gercekDuzeltme(false, kilit), false);
  assert.equal(
    gercekDuzeltme({ name: 'bilinmeyen', version: '1.0.0' }, kilit),
    true,
    'bilinmeyen kurulu surum siki tarafta kalmali',
  );
  const calisma = karar(
    {
      vulnerabilities: {
        hono: {
          severity: 'high',
          fixAvailable: { name: 'hono', version: '3.0.0', isSemVerMajor: true },
        },
      },
    },
    { 'node_modules/hono': { version: '4.13.18', dev: false } },
  );
  assert.equal(calisma.dusuren.length, 1, 'calisma zamani bulgusu duzeltme olmasa da dusurmeli');
});

test('karar(): zincir bulgusu kok danismanin duzeltmesine bakar (ara paketin yaniltici fixAvailable: true)', () => {
  const kilit = {
    'node_modules/picomatch': { version: '4.0.7', dev: true },
    'node_modules/fdir': { version: '6.5.0', dev: true },
    'node_modules/vite': { version: '8.3.7', dev: true },
  };
  const danisma = { source: 1, name: 'picomatch', range: '<=4.0.7', severity: 'high' };
  const z = {
    picomatch: {
      severity: 'high',
      via: [danisma],
      fixAvailable: { name: 'vite', version: '6.2.7', isSemVerMajor: true },
    },
    fdir: { severity: 'high', via: ['picomatch'], fixAvailable: true },
  };
  assert.equal(
    kokDuzeltmeVar('fdir', z, kilit),
    false,
    'kok danismanin duzeltmesi yok; ara paket dusurmemeli',
  );
  assert.deepEqual(karar({ vulnerabilities: z }, kilit).dusuren, []);
  // Kok danisma duzeltilince (picomatch yeni surum) zincirin tamami yine dusurur.
  const duzeldi = { ...z, picomatch: { ...z.picomatch, fixAvailable: true } };
  assert.equal(kokDuzeltmeVar('fdir', duzeldi, kilit), true);
  assert.equal(karar({ vulnerabilities: duzeldi }, kilit).dusuren.length, 2);
  // Dongu guvenli.
  assert.equal(kokDuzeltmeVar('a', { a: { via: ['b'] }, b: { via: ['a'] } }, kilit), false);
});

test('karar(): dongulu audit zinciri (vitest <-> coverage-v8) yalanci yama uretmez; gercek ileri yama tum zinciri bloke eder', () => {
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
