#!/usr/bin/env node
// scripts/dist-dogrula.cjs — calisma zamani paketinde `npm run build` (2026-11-12).
//
// Pakette derleme ARACI YOK (vite gelistirme bagimliligidir; kurumsal taramada ve uretim
// sunucusunda kurulmaz). Arayuz `scripts/paket.cjs` tarafindan onceden derlenip `dist/` olarak
// pakete konur; her dosyanin sha256'si `dist/.manifest.sha256`dadir (sha256sum bicimi:
// `cd dist && sha256sum -c .manifest.sha256` ile de dogrulanir). Jenkins, deploy/release.sh ve
// deploy/run.sh `npm run build` cagirdiginda bu betik dist'in EKSIKSIZ ve DEGISMEMIS oldugunu
// dogrular; bozuksa cikis kodu 1 (yarim dist ile sunucu baslamasin).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIST = path.join(process.cwd(), 'dist');
const MANIFEST = path.join(DIST, '.manifest.sha256');
const BILGI = path.join(DIST, '.paket.json');

function dur(mesaj) {
  console.error(`[dist] HATA: ${mesaj}`);
  console.error(
    '[dist] Paket bozuk ya da eksik - paketi yeniden uretin: npm run paket (repo kokunde).',
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) dur('dist/index.html yok');
if (!fs.existsSync(MANIFEST))
  dur('dist/.manifest.sha256 yok (bu bir calisma zamani paketi degil mi?)');

const satirlar = fs.readFileSync(MANIFEST, 'utf8').split('\n').filter(Boolean);
if (!satirlar.length) dur('manifest bos');
const dosyalar = [];
for (const s of satirlar) {
  const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(s);
  if (!m) dur(`manifest satiri bozuk: ${s.slice(0, 80)}`);
  dosyalar.push([m[2], m[1]]);
}
if (!dosyalar.some(([f]) => f === 'index.html')) dur('manifest index.html icermiyor');

const bozuk = [];
for (const [goreli, beklenen] of dosyalar) {
  const tam = path.join(DIST, goreli);
  if (!tam.startsWith(DIST + path.sep)) {
    bozuk.push(`${goreli} (dist disi yol)`);
    continue;
  }
  if (!fs.existsSync(tam)) {
    bozuk.push(`${goreli} (yok)`);
    continue;
  }
  const gercek = crypto.createHash('sha256').update(fs.readFileSync(tam)).digest('hex');
  if (gercek !== beklenen) bozuk.push(`${goreli} (degismis)`);
}
if (bozuk.length) dur(`${bozuk.length} dosya: ${bozuk.slice(0, 10).join(', ')}`);

let bilgi = {};
try {
  bilgi = JSON.parse(fs.readFileSync(BILGI, 'utf8'));
} catch {
  /* bilgi dosyasi yalniz bilgi amacli */
}
console.log(
  `[dist] ${dosyalar.length} dosya dogrulandi (surum ${bilgi.surum || '?'}, commit ${String(bilgi.commit || '?').slice(0, 8)})`,
);
