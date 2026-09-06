// server/__tests__/declared-dependencies.test.cjs — BILDIRILMEMIS RUNTIME BAGIMLILIGI.
//
// URETIMDE NE OLABILIRDI: `server/service.cjs` `express-rate-limit`i require ediyordu
// ama paket `package.json`da HIC BILDIRILMEMISTI. Yalnizca
// `@modelcontextprotocol/sdk` onu kendi bagimliligi olarak deklare ettigi ve npm
// ust seviyeye HOIST ettigi icin cozuluyordu.
//
// NEDEN SESSIZ VE TEHLIKELI: `npm ci` BASARIYLA biter (lock dosyasi tutarli), build
// gecer, testler gecer — sunucu ise ACILISTA `Cannot find module` ile duser. Yani
// hata, dagitim yapilana kadar hicbir kapida gorunmez. Tetigi cekmek icin MCP SDK'nin
// bir surumde o bagimliligi birakmasi ya da hoisting'in degismesi yeterliydi.
//
// BU BEKCI NE OLCUYOR: `server/` altinda require edilen her HARICI paketin
// `package.json`da (dependencies ya da devDependencies) bildirilmis olmasi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
]);

// Node'un kendi modulleri bildirilmez. `node:` onekli olanlar zaten ayirt edilebilir;
// bu liste onek KULLANILMAYAN eski cagrilar icin.
const BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'dns',
  'events',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'url',
  'util',
  'worker_threads',
  'zlib',
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(cjs|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

// `require('paket')` / `require('paket/alt/yol')` → paket adi. Kapsam ('@scope/ad')
// iki parcali okunur. Goreli yollar (`./`, `../`) ve `node:` onekliler atlanir.
function packageNameOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

test('DEP1 `server/` altinda require edilen her paket package.json`da BILDIRILMIS', () => {
  const missing = new Map();
  for (const file of walk(path.join(ROOT, 'server'))) {
    const src = fs.readFileSync(file, 'utf8');
    // Yorum satirlarini at: aciklamalar ornek `require(...)` metni icerebilir.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    for (const m of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const name = packageNameOf(m[1]);
      if (!name || BUILTINS.has(name) || declared.has(name)) continue;
      if (!missing.has(name)) missing.set(name, new Set());
      missing.get(name).add(path.relative(ROOT, file));
    }
  }

  const lines = [...missing.entries()].map(
    ([name, files]) => `${name} → ${[...files].slice(0, 3).join(', ')}`,
  );
  assert.deepEqual(
    lines,
    [],
    'Bu paketler require ediliyor ama package.json`da BILDIRILMEMIS.\n' +
      'Baska bir bagimliligin hoist etmesiyle cozuluyorlar: `npm ci` gecer, sunucu\n' +
      'ACILISTA duser. Cozum: package.json dependencies`e ekleyip lock`u esitlemek.\n' +
      lines.join('\n'),
  );
});

test('DEP2 lock dosyasi package.json ile AYNI kok bagimliliklari tasiyor', () => {
  // `package.json`a elle eklenip `npm install` unutulursa `npm ci` "lock dosyasi
  // package.json ile senkron degil" diye DUSER — ama bu ancak CI'da gorunur.
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const lockDeps = lock.packages?.['']?.dependencies || {};
  const drift = [];
  for (const [name, range] of Object.entries(pkg.dependencies || {})) {
    if (lockDeps[name] !== range) {
      drift.push(`${name}: package.json=${range} lock=${lockDeps[name] ?? '(yok)'}`);
    }
  }
  assert.deepEqual(
    drift,
    [],
    `lock dosyasi esitlenmemis (npm install gerekli):\n${drift.join('\n')}`,
  );
});

test('DEP3 `express-rate-limit` bildirimi DURUYOR (gerileme bekcisi)', () => {
  // Bu ozel satirin bir bekcisi var cunku bir kez SESSIZCE kayboldu ve kimse fark
  // etmedi: paket baska bir bagimliligin altindan geldigi icin her sey calisiyordu.
  assert.ok(
    declared.has('express-rate-limit'),
    'express-rate-limit yeniden bildirilmemis — sunucu hoisting sansina bagli',
  );
  const svc = fs.readFileSync(path.join(ROOT, 'server', 'service.cjs'), 'utf8');
  assert.match(
    svc,
    /require\(["']express-rate-limit["']\)/,
    'kullanim kayboldu — bekci artik anlamsiz',
  );
});

// ── ISTEMCI TARAFI TIP BAGIMLILIKLARI ───────────────────────────────────────
//
// `@types/react` HIC BILDIRILMEMISTI: yalnizca `@types/react-router-dom@5`in
// (react-router-dom v7 kendi tiplerini getirdigi icin ZATEN gereksiz olan bir
// paket) altindan geliyordu. Yani bir TypeScript projesi, tip tanimlarini YANLIS
// surumlu bir paketin tesadufune borcluydu — `express-rate-limit` ile AYNI SINIF:
// `npm ci` gecer, kurulum calisir, ta ki o paket kaldirilana kadar.
//
// Kaldirildiginda `tsc` hemen dustu (`children` ButtonProps'ta yok...) — yani
// eksiklik sessiz DEGILDI, ama sebebi de gorunmuyordu.
test('DEP4 React tip paketleri ACIKCA bildirilmis', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of ['@types/react', '@types/react-dom']) {
    assert.ok(
      declared[name],
      `${name} bildirilmemis — tip cozumu baska bir paketin hoist'ine bagli kalir`,
    );
  }
});

test('DEP5 React tip paketleri React ile AYNI ana surumde', () => {
  // `@types/react@18` + `react@19` sessizce yanlis tipler uretir: kod derlenir ama
  // tipler gercegi anlatmaz (React 19'da `children` artik ortuk DEGIL).
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = (v) =>
    String(v)
      .replace(/^[^0-9]*/, '')
      .split('.')[0];
  assert.equal(
    major(pkg.devDependencies['@types/react']),
    major(pkg.dependencies.react),
    '@types/react ile react ana surumleri ayrismis',
  );
});

test('DEP6 kendi tiplerini getiren pakete AYRI bir @types EKLENMEMIS', () => {
  // `react-router-dom` v7 kendi tiplerini getiriyor; `@types/react-router-dom@5`
  // hem GEREKSIZ hem de v5 API'sini tarif ettigi icin CAKISMA riskiydi.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const offenders = [];
  for (const name of Object.keys(declared)) {
    if (!name.startsWith('@types/')) continue;
    const target = name.slice('@types/'.length).replace(/^([^_]+)__(.+)$/, '@$1/$2');
    const targetPkg = path.join(ROOT, 'node_modules', target, 'package.json');
    if (!fs.existsSync(targetPkg)) continue;
    const meta = JSON.parse(fs.readFileSync(targetPkg, 'utf8'));
    if (meta.types || meta.typings) offenders.push(`${name} (${target} kendi tiplerini getiriyor)`);
  }
  assert.deepEqual(offenders, [], `Gereksiz @types paketi:\n${offenders.join('\n')}`);
});
