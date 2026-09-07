#!/usr/bin/env node
// scripts/playbook-rev.cjs — AWX'e kopyalanan playbook'lar icin SURUM DAMGASI.
//
// NEDEN VAR: `server/ansible/bmw_portal/` klasoru AWX projesine ELLE kopyalanir.
// Kopyalanmadiginda AWX ESKI surumu kosar, portalda gorunen hata ise repodaki
// (duzeltilmis) koda ait olur ve teshis yanlis yerde aranir. 2026-09-07'de bu
// tam dort kez oldu; son seferinde #3297277'nin sebebi zaten duzeltilmisti ama
// AWX'teki kopya bayatti.
//
// Damga, dosya iceriginin sha256'sinin ilk 10 hanesidir. Playbook onu `set_stats`
// ile play 1'de yayinlar; portal gelen degeri bu manifest'le karsilastirir ve
// uyusmuyorsa (ya da HIC gelmiyorsa) kullaniciya "AWX'teki kopya eski" der.
//
//   npm run playbook:rev            damgalari ve manifest'i GUNCELLER
//   npm run playbook:rev -- --check  guncel mi diye BAKAR (yazmaz, kod 1 doner)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { AWX_TREE, PLAYBOOKS } = require('../server/ansible/paths.cjs');

const MANIFEST = path.join(__dirname, '..', 'server', 'ansible', 'playbook-revisions.json');
// YALNIZCA HEX damga satirini yakalar.
//
// Ilk hali `".*"` idi ve `set_stats` icindeki
// `logx_playbook_revision: "{{ logx_playbook_revision }}"` SABLONUNU da eziyordu:
// damga yayinlanmayi birakiyor, mekanizma SESSIZCE olu kaliyordu. (Bekci PV3
// bunu ilk kosuda yakaladi.)
const STAMP_RE = /^(\s*)logx_playbook_revision:\s*"[0-9a-f]*"\s*$/gm;

/** Damgalanan playbook'lar: AWX'te kosan ve portalin sonucunu okudugu olanlar. */
const STAMPED = [
  PLAYBOOKS.logxOcpNamespaceDiscovery,
  PLAYBOOKS.logxOcpAppDiscovery,
  PLAYBOOKS.logxOcpDiscoverFetch,
];

/**
 * Damga, kendi hesabina GIRMEZ.
 *
 * Girseydi hesap kendini kovalardi: damgayi yaz -> icerik degisir -> damga degisir.
 * Bu yuzden hash alinmadan once tum damga satirlari NOTRLENIR.
 */
function contentHash(src) {
  const normalized = src.replace(STAMP_RE, '$1logx_playbook_revision: ""');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function computeAll() {
  const out = {};
  for (const rel of STAMPED) {
    const src = fs.readFileSync(path.join(AWX_TREE, rel), 'utf8');
    const hash = contentHash(src);
    out[rel] = { revision: hash.slice(0, 10), hash };
  }
  return out;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return {};
  }
}

function main() {
  const check = process.argv.includes('--check');
  const computed = computeAll();
  const stored = readManifest();
  const stale = [];

  for (const [rel, { revision, hash }] of Object.entries(computed)) {
    const src = fs.readFileSync(path.join(AWX_TREE, rel), 'utf8');
    const stamps = [...src.matchAll(STAMP_RE)];
    const current = [...src.matchAll(/logx_playbook_revision:\s*"(.*?)"/g)].map((m) => m[1]);
    const okStamp = stamps.length > 0 && current.every((v) => v === revision);
    const okManifest = stored[rel]?.hash === hash && stored[rel]?.revision === revision;
    if (okStamp && okManifest) continue;

    stale.push(rel);
    if (check) continue;
    fs.writeFileSync(
      path.join(AWX_TREE, rel),
      src.replace(STAMP_RE, `$1logx_playbook_revision: "${revision}"`),
    );
  }

  if (!check && stale.length) {
    // Damga yazildi -> icerik degisti; manifest NIHAI dosyadan yeniden hesaplanir.
    const finalManifest = computeAll();
    fs.writeFileSync(MANIFEST, JSON.stringify(finalManifest, null, 2) + '\n');
  }

  if (check) {
    if (stale.length) {
      console.error(
        'Playbook surum damgasi GUNCEL DEGIL:\n' +
          stale.map((r) => `  - ${r}`).join('\n') +
          '\n`npm run playbook:rev` calistirip degisikligi commit edin.\n' +
          'Damga guncellenmezse portal AWX kopyasinin bayat oldugunu ANLAYAMAZ.',
      );
      process.exitCode = 1;
    } else {
      console.log('Playbook surum damgalari guncel.');
    }
    return;
  }

  if (stale.length) {
    console.log('Damga guncellendi:\n' + stale.map((r) => `  - ${r}`).join('\n'));
    console.log("\nAWX'e KOPYALAMAYI unutmayin: server/ansible/bmw_portal/ -> AWX bmw_portal/");
  } else {
    console.log('Damgalar zaten guncel.');
  }
}

if (require.main === module) main();

module.exports = { contentHash, computeAll, STAMPED, MANIFEST, STAMP_RE };
