// server/__tests__/guvenlik-tabanlari.test.cjs — kilitteki paketler bilinen zafiyetli surumlere
// GERI DUSMESIN (2026-11-12).
//
// Kurumsal bagimlilik taramasi (Xray) bu paketlerin asagidaki surumlerinden ESKISINI ihlal sayiyordu
// (29 ihlal; teslim kapisi "Fail_build"). Duzeltme kilit guncellemesi + `overrides` ile yapildi; bu
// bekci kilidi okur ve HER kopyanin (ic ice olanlar dahil) tabanin ustunde oldugunu sinar. Biri
// `npm install` ile eski bir alt surumu geri getirirse ya da bir override silinirse kirmizi doner.
//   GT1 her paket, her kopya: taban <= surum (ayni ana surum hattinda)
//   GT2 uri-js (bakimsiz, duzeltmesi yok) gercek paket olarak agacta YOK; ajv@6 icin fast-uri
//   GT3 debug 2.x (compression / express-session sabitliyordu) agacta YOK
//   GT4 package.json overrides yerinde (silinirse bir sonraki `npm install` geri getirir)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const KOK = path.join(__dirname, '..', '..');
const KILIT = JSON.parse(fs.readFileSync(path.join(KOK, 'package-lock.json'), 'utf8')).packages;
const PKG = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));

/** Kilitteki bir paketin butun kopyalari: [{ yer, surum, kaynak }]. */
function kopyalar(ad) {
  return Object.entries(KILIT)
    .filter(([k]) => k === `node_modules/${ad}` || k.endsWith(`/node_modules/${ad}`))
    .map(([k, v]) => ({ yer: k, surum: v.version, kaynak: v.resolved || '' }));
}

// Ana surum hattina gore en dusuk guvenli surum. Bir hat listede yoksa o hattaki HER surum ihlaldir.
const TABAN = {
  undici: { 7: '7.30.2', 8: '8.12.4' },
  'body-parser': { 2: '2.4.0' },
  qs: { 6: '6.16.2' },
  '@azure/msal-node': { 7: '7.1.0' },
  hono: { 4: '4.13.16' },
  '@hono/node-server': { 2: '2.1.6' },
  'fast-uri': { 3: '3.1.9' },
  'express-rate-limit': { 8: '8.7.2' },
  debug: { 4: '4.0.0' },
  minimatch: { 11: '11.0.1' },
  semver: { 7: '7.5.2' },
};

test('GT1 guvenlik acisindan duyarli her paketin her kopyasi taban surumun ustunde', () => {
  const ihlal = [];
  for (const [ad, hatlar] of Object.entries(TABAN)) {
    const k = kopyalar(ad);
    assert.ok(k.length > 0, `${ad} kilitte yok - liste bayatlamis olabilir`);
    for (const { yer, surum } of k) {
      const taban = hatlar[semver.major(surum)];
      if (!taban || semver.lt(surum, taban))
        ihlal.push(`${yer}@${surum} (taban ${taban || 'bu hat yok'})`);
    }
  }
  assert.deepEqual(ihlal, []);
});

test('GT2 uri-js gercek paket olarak yok; ajv@6 fast-uri kullaniyor', () => {
  for (const { yer, kaynak } of kopyalar('uri-js')) {
    assert.match(
      kaynak,
      /\/fast-uri\/-\/fast-uri-/,
      `${yer}: uri-js gercek paket (bakimsiz, duzeltmesi yok)`,
    );
  }
});

test('GT3 debug 2.x agacta yok', () => {
  const eski = kopyalar('debug').filter((x) => semver.major(x.surum) < 4);
  assert.deepEqual(eski, []);
});

test('GT4 overrides yerinde', () => {
  const o = PKG.overrides || {};
  assert.equal(o.compression?.debug, '^4.4.3');
  assert.equal(o['express-session']?.debug, '^4.4.3');
  assert.match(String(o.minimatch), /^\^11\./);
  assert.match(String(o['@babel/core']?.semver), /^\^7\./);
  assert.match(String(o['@babel/helper-compilation-targets']?.semver), /^\^7\./);
  assert.match(String(o['uri-js']), /^npm:fast-uri@\^3\./);
});
