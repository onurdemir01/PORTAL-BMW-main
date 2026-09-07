// server/__tests__/route-auth-order.test.cjs — her uc KIMLIK KAPISININ ARKASINDA mi.
//
// Express middleware'i SIRAYLA uygular: `router.use(requireAuth)` satirindan ONCE
// tanimlanan her route KIMLIK DOGRULAMASIZ kalir. Bu, kodda hicbir yerde "yanlis"
// gorunmez — route dogru yazilmistir, yalnizca YANLIS YERDEDIR. Bir dosyanin
// ustune yeni bir uc eklemek yeterlidir.
//
// Bugun iki BILINCLI istisna var ve ikisi de kodda gerekcesiyle yazili. Bu bekci
// onlari dondurur: YENI bir muafiyet sessizce eklenemez, listeye yazilip
// gerekcelendirilmesi gerekir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..');

// BILINCLI MUAFIYETLER — her biri kodda da gerekcesiyle yazili.
//   * logx/v2 `/ingest/:token` : kimlik TEK KULLANIMLIK TOKEN'dir; yukleyen kaynak
//     host'un portal session'i YOKTUR. `requireAuth` onu 401'e dusururdu.
//   * selfservice `/health`    : probe ucu; izleme sistemleri session tasimaz.
const EXEMPT = new Set(['logx/v2/index.cjs::/ingest/:token', 'selfservice/index.cjs::/health']);

function routerFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.cjs')) out.push(p);
    }
  })(SERVER);
  return out;
}

test('RO1 hicbir uc KIMLIK KAPISINDAN once tanimlanmamis (bilinen muafiyetler haric)', () => {
  const offenders = [];
  let checked = 0;

  for (const f of routerFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const lines = src.split('\n');
    // Kapi: `router.use(requireAuth)` ya da gorunurluk kapisi.
    const gate = lines.findIndex((l) => /router\.use\(\s*requireAuth\s*\)/.test(l));
    if (gate < 0) continue; // bu modul kapi uygulamiyor — kapsam disi
    checked++;

    const rel = path.relative(SERVER, f);
    lines.slice(0, gate).forEach((l, i) => {
      const m = l.match(/router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/);
      if (!m) return;
      const key = `${rel}::${m[2]}`;
      if (EXEMPT.has(key)) return;
      offenders.push(`${rel}:${i + 1}  ${m[1].toUpperCase()} ${m[2]}`);
    });
  }

  // Bekci yanlis yere bakiyorsa sessizce yesil kalmasin.
  assert.ok(
    checked >= 3,
    `yalnizca ${checked} router modulu incelendi — toplayici yanlis dizine bakiyor olabilir`,
  );

  assert.deepEqual(
    offenders,
    [],
    'KIMLIK DOGRULAMASIZ uc(lar):\n' +
      offenders.join('\n') +
      '\n\nBu route`lar `router.use(requireAuth)` satirindan ONCE tanimli, yani kimlik\n' +
      'dogrulamasi UYGULANMIYOR. Ya kapinin ALTINA tasiyin, ya da gercekten muaf\n' +
      'olmasi gerekiyorsa bu testteki EXEMPT listesine GEREKCESIYLE ekleyin.',
  );
});

test('RO2 muafiyet listesi BAYATLAMAMIS (kaldirilan uc listede kalmasin)', () => {
  // Olu bir muafiyet, listeyi zamanla anlamsizlastirir ve bir sonraki okuyucu
  // "demek ki boyle seyler normal" diye dusunur.
  for (const key of EXEMPT) {
    const [rel, route] = key.split('::');
    const src = fs.readFileSync(path.join(SERVER, rel), 'utf8');
    assert.ok(
      src.includes(`'${route}'`) || src.includes(`"${route}"`) || src.includes(`\`${route}\``),
      `muafiyet listesinde OLMAYAN bir uc var: ${key} — kaldirildiysa listeden de cikarin`,
    );
  }
});

test('RO3 muafiyetler kodda GEREKCESIYLE yazili', () => {
  // Listede olmasi yetmez: kodu okuyan kisi NEDEN muaf oldugunu orada gormeli.
  const cases = [
    ['logx/v2/index.cjs', '/ingest/:token', /requireAuth'tan ONCE|tek-kullanimlik token/i],
    ['selfservice/index.cjs', '/health', /guard'siz|probe/i],
  ];
  for (const [rel, route, re] of cases) {
    const src = fs.readFileSync(path.join(SERVER, rel), 'utf8');
    // ROUTE TANIMI aranir, ciplak metin DEGIL. Ilk deneme `indexOf(route)` idi ve
    // YORUMUN KENDISINI buluyordu ("// /health guard'siz kalir (probe)") — pencere
    // gerekcenin ONUNE dusuyor, gerekce pencerenin DISINDA kaliyordu. Bekci, aranan
    // seyin tam da icinde durdugu metni gormeden kirmizi donuyordu.
    const defRe = new RegExp(
      `router\\.(?:get|post|put|delete|patch)\\(\\s*['"\`]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`,
    );
    const dm = defRe.exec(src);
    assert.ok(dm, `${rel}: ${route} route TANIMI bulunamadi`);
    const at = dm.index;
    // Route tanimindan HEMEN ONCEKI aciklama blogu.
    const above = src.slice(Math.max(0, at - 600), at);
    assert.match(above, re, `${rel}: ${route} muafiyeti kodda gerekcelendirilmemis`);
  }
});
