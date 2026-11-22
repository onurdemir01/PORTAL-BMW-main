#!/usr/bin/env node
// scripts/guvenlik-denetim.cjs — bagimlilik zafiyet kapisi (2026-11-12). `npm run guvenlik`.
//
// Kural (docs/GUVENLIK-0-ZAFIYET.md): teslim edilen agac HER ZAMAN 0 zafiyet.
//   - Calisma zamani bagimliligi (kilitte `dev` olmayan): HER seviyede bulgu kapiyi dusurur.
//   - Gelistirme bagimliligi: duzeltmesi YAYIMLANMIS her bulgu kapiyi dusurur. Duzeltmesi olmayan
//     gelistirme bulgusu yazdirilir ama dusurmez: calisma zamani paketine (npm run paket) girmez,
//     duzeltme yayimlaninca bu kapi onu da ister.
// Kaynak `npm audit --json` (GitHub danisma veritabani). Kurumsal tarayici farkli bir veritabani
// kullanir; bu kapi ONUN yerine gecmez, ondan ONCE yakalar (yerel tarama tezgahi ayrica kosar).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { aracYolu } = require('./arac-yolu.cjs');

const KOK = path.join(__dirname, '..');
// TAM agac (calisma zamani + gelistirme) gelistirme/ altindadir; kok manifest yalniz calisma
// zamanidir (scripts/manifest.cjs). Kapi tam agaca bakar: gelistirmede duzeltmesi yayimlanmis
// bulgu da build'i durdurur.
const TAM = path.join(KOK, 'gelistirme');

// Ana surum hattina gore kurumsal tarama (Xray) en dusuk guvenli tabanlari.
const XRAY_TABAN = {
  undici: { 7: '7.30.2', 8: '8.12.4' },
  'body-parser': { 2: '2.4.0' },
  qs: { 6: '6.16.2' },
  '@azure/msal-node': { 7: '7.1.0' },
  hono: { 4: '4.13.18' },
  '@hono/node-server': { 2: '2.1.7' },
  'fast-uri': { 3: '3.1.9' },
  'express-rate-limit': { 8: '8.7.2' },
  debug: { 4: '4.0.0' },
  minimatch: { 11: '11.0.8' },
  'brace-expansion': { 5: '5.0.13' },
  vite: { 8: '8.3.7' },
  semver: { 7: '7.5.2' },
};

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmpSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function paketAdi(yol) {
  const s = String(yol || '');
  const idx = s.lastIndexOf('node_modules/');
  return idx >= 0 ? s.slice(idx + 'node_modules/'.length) : s;
}

/** Saf karar: tam kilit + kok kilit Xray tabanlarini ve runtime izolasyonunu denetler. */
function xrayTabanKontrol(tamKilitPaketleri, kokKilitPaketleri = {}) {
  const dusuren = [];
  const bilgi = [];

  for (const [yol, meta] of Object.entries(tamKilitPaketleri || {})) {
    if (!yol || !meta || typeof meta !== 'object') continue;
    const ad = paketAdi(yol);
    const surumStr = String(meta.version || '');
    const sv = parseSemver(surumStr);
    const hatlar = XRAY_TABAN[ad];
    if (hatlar) {
      const tabanStr = sv ? hatlar[sv[0]] : null;
      const taban = tabanStr ? parseSemver(tabanStr) : null;
      if (!sv || !taban || cmpSemver(sv, taban) < 0) {
        dusuren.push(
          `${ad}@${surumStr || '?'} (xray taban ${tabanStr || 'hat yok'}${meta.dev ? ', gelistirme' : ', calisma zamani'}): ${yol}`,
        );
      }
    }
    if (ad === 'uri-js' && !String(meta.resolved || '').includes('/fast-uri/-/fast-uri-')) {
      dusuren.push(
        `uri-js@${surumStr || '?'} (gercek uri-js yasak, fast-uri alias gerekli): ${yol}`,
      );
    }
    if (ad === 'picomatch') {
      if (meta.dev) {
        bilgi.push(`picomatch@${surumStr} (gelistirme, duzeltme yok, pakete girmez): ${yol}`);
      } else {
        dusuren.push(`picomatch@${surumStr} (calisma zamanina sizdi): ${yol}`);
      }
    }
  }

  for (const [yol, meta] of Object.entries(kokKilitPaketleri || {})) {
    if (!yol || !meta || typeof meta !== 'object') continue;
    const ad = paketAdi(yol);
    if (meta.dev || meta.devOptional) {
      dusuren.push(`${ad}@${meta.version || '?'} (kok kilitte dev/devOptional yasak): ${yol}`);
    }
    if (ad === 'picomatch') {
      dusuren.push(`picomatch@${meta.version || '?'} (calisma zamani kok kilidinde yasak): ${yol}`);
    }
  }

  return {
    dusuren: dusuren.toSorted((a, b) => a.localeCompare(b)),
    bilgi: bilgi.toSorted((a, b) => a.localeCompare(b)),
  };
}

/**
 * npm audit `fixAvailable` -> gercekten YAYIMLANMIS bir duzeltme mi? Saf islev.
 * `true` (uyumlu guncelleme) ya da kurulu surumden YENI bir surume yukseltme duzeltmedir.
 * Kurulu surumden ESKI bir ana surume inme onerisi (2026-11-18: picomatch <=4.0.7 icin
 * "vite 6.2.7", kurulu vite 8) duzeltme DEGILDIR: guncel paketin duzeltmesi yoktur ve eski
 * surum kapatilmis zafiyetleri geri getirir.
 */
function gercekDuzeltme(fixAvailable, kilitPaketleri) {
  if (fixAvailable === false || fixAvailable == null) return false;
  if (fixAvailable === true) return true;
  const kurulu = parseSemver(
    String(kilitPaketleri[`node_modules/${fixAvailable.name}`]?.version || ''),
  );
  const oneri = parseSemver(String(fixAvailable.version || ''));
  if (!kurulu || !oneri) return true; // bilinemiyorsa siki tarafta kal
  return cmpSemver(oneri, kurulu) > 0;
}

/**
 * Bulgunun duzeltmesi KOK danismada mi? `via` dizesi baska bir paketin bulgusunu tasidigini
 * soyler (fdir -> picomatch); duzeltme o kok danismanin paketinde yayimlanmis olmali. npm,
 * zincirdeki ara pakete "fixAvailable: true" diyebilir ama guncelleme kok danismayi kapatmaz
 * (2026-11-18 olculdu: `npm audit fix` sonrasi 13 bulgunun 13'u yerinde). Saf islev.
 */
function kokDuzeltmeVar(ad, zafiyetler, kilitPaketleri, gorulen = new Set()) {
  if (gorulen.has(ad)) return false;
  gorulen.add(ad);
  const v = zafiyetler[ad];
  if (!v) return false;
  const via = Array.isArray(v.via) ? v.via : [];
  const kendiDanismasi = !via.length || via.some((x) => x && typeof x === 'object');
  if (kendiDanismasi && gercekDuzeltme(v.fixAvailable, kilitPaketleri)) return true;
  return via.some(
    (x) => typeof x === 'string' && kokDuzeltmeVar(x, zafiyetler, kilitPaketleri, gorulen),
  );
}

/** Saf karar: audit JSON'u + kilit paketleri -> { dusuren, bilgi }. */
function karar(audit, kilitPaketleri) {
  const dusuren = [];
  const bilgi = [];
  for (const [ad, v] of Object.entries(audit?.vulnerabilities || {})) {
    const yollar = Array.isArray(v.nodes) && v.nodes.length ? v.nodes : [`node_modules/${ad}`];
    const calisma = yollar.some((y) => kilitPaketleri[y] && !kilitPaketleri[y].dev);
    const duzeltmeVar = kokDuzeltmeVar(ad, audit.vulnerabilities, kilitPaketleri);
    const satir = `${ad} (${v.severity}${calisma ? ', calisma zamani' : ', gelistirme'}${duzeltmeVar ? '' : ', duzeltme yok'}): ${yollar.join(', ')}`;
    if (calisma || duzeltmeVar) dusuren.push(satir);
    else bilgi.push(satir);
  }
  return {
    dusuren: dusuren.toSorted((a, b) => a.localeCompare(b)),
    bilgi: bilgi.toSorted((a, b) => a.localeCompare(b)),
  };
}

function main() {
  const r = spawnSync(aracYolu('npm'), ['audit', '--json'], {
    cwd: TAM,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let audit;
  try {
    audit = JSON.parse(r.stdout || '{}');
  } catch {
    console.error('[guvenlik] npm audit ciktisi okunamadi (ag?):', (r.stderr || '').slice(0, 300));
    process.exit(2);
  }
  if (audit.error) {
    console.error('[guvenlik] npm audit hatasi:', JSON.stringify(audit.error).slice(0, 300));
    process.exit(2);
  }
  const kilit =
    JSON.parse(fs.readFileSync(path.join(TAM, 'package-lock.json'), 'utf8')).packages || {};
  const kokKilitPath = path.join(KOK, 'package-lock.json');
  const kokKilit = fs.existsSync(kokKilitPath)
    ? JSON.parse(fs.readFileSync(kokKilitPath, 'utf8')).packages || {}
    : {};
  const auditSonuc = karar(audit, kilit);
  const xraySonuc = xrayTabanKontrol(kilit, kokKilit);
  const bilgi = [...auditSonuc.bilgi, ...xraySonuc.bilgi];
  const dusuren = [...auditSonuc.dusuren, ...xraySonuc.dusuren];
  for (const s of bilgi)
    console.log(`[guvenlik] bilgi (gelistirme, duzeltme yok, pakete girmez): ${s}`);
  if (dusuren.length) {
    console.error(
      `[guvenlik] ${dusuren.length} zafiyet kapiyi dusuruyor:\n  ${dusuren.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log('[guvenlik] OK - calisma zamaninda 0, gelistirmede duzeltmesi olan 0 zafiyet.');
}

module.exports = { XRAY_TABAN, karar, gercekDuzeltme, kokDuzeltmeVar, xrayTabanKontrol };
if (require.main === module) main();
