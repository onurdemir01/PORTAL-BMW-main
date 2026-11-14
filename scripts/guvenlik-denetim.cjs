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

const KOK = path.join(__dirname, '..');
// TAM agac (calisma zamani + gelistirme) gelistirme/ altindadir; kok manifest yalniz calisma
// zamanidir (scripts/manifest.cjs). Kapi tam agaca bakar: gelistirmede duzeltmesi yayimlanmis
// bulgu da build'i durdurur.
const TAM = path.join(KOK, 'gelistirme');

/** Saf karar: audit JSON'u + kilit paketleri -> { dusuren, bilgi }. */
function karar(audit, kilitPaketleri) {
  const dusuren = [];
  const bilgi = [];
  for (const [ad, v] of Object.entries((audit && audit.vulnerabilities) || {})) {
    const yollar = Array.isArray(v.nodes) && v.nodes.length ? v.nodes : [`node_modules/${ad}`];
    const calisma = yollar.some((y) => kilitPaketleri[y] && !kilitPaketleri[y].dev);
    const duzeltmeVar = v.fixAvailable !== false;
    const satir = `${ad} (${v.severity}${calisma ? ', calisma zamani' : ', gelistirme'}${duzeltmeVar ? '' : ', duzeltme yok'}): ${yollar.join(', ')}`;
    if (calisma || duzeltmeVar) dusuren.push(satir);
    else bilgi.push(satir);
  }
  return { dusuren: dusuren.sort(), bilgi: bilgi.sort() };
}

function main() {
  const r = spawnSync('npm', ['audit', '--json'], {
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
  const { dusuren, bilgi } = karar(audit, kilit);
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

module.exports = { karar };
if (require.main === module) main();
