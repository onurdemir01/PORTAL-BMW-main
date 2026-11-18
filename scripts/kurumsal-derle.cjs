#!/usr/bin/env node
'use strict';
// scripts/kurumsal-derle.cjs — kurumsal Jenkins isinin TEK giris noktasi: `npm run kurumsal:derle`.
//
// NEDEN TEK GIRIS (2026-11-18, kurumsal is #46): groovy (kurumsal is tanimi deposu) her dala AYNI ANDA
// uygulanir, kod ise dal dal ilerler. Groovy yeni bir npm betigini (`kapsam:kurumsal`) cagirinca o
// betigi henuz tasimayan dal kirildi: "npm error Missing script". Bu yuzden groovy yalniz `install` ve
// bu betigi cagirir; derleme adimlari KODLA BIRLIKTE surumlenir ve her dal kendi adimlarini kosar.
// Adim eklemek / degistirmek groovy degisikligi GEREKTIRMEZ.
//
// SOZLESME (degismez; deploy/jenkins/*.groovy ve server/__tests__/kurumsal-pipeline.test.cjs):
//   - betik adi: kurumsal:derle
//   - cikti:     build/BMWPORTAL/PORTAL-BMW-main  (groovy: compress build/BMWPORTAL -> BMWPORTAL/BMWPORTAL.war)
//
// Adimlar sirayla kosar; biri duserse hangi adimin dustugu yazilir ve onun cikis koduyla cikilir.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const CIKTI = 'build/BMWPORTAL/PORTAL-BMW-main';
const NODE = process.execPath;

const ADIMLAR = [
  // Derleme araclari (vite vb.) gelistirme/ agacindan; kokteki `npm install` yalniz calisma zamani.
  { ad: 'derleme araclari', komut: NODE, argumanlar: ['scripts/kur.cjs'] },
  // CI'in gercek testlerle urettigi kapsam raporu -> coverage/lcov.info (bayatsa Sonar kosusu duser).
  // Testler burada kosmaz: kutuphane npm komutlarini tek bir 15 dk zaman asimi icinde kosturur.
  { ad: 'kapsam raporu', komut: NODE, argumanlar: ['scripts/kapsam-yayinla.cjs', '--kurumsal'] },
  { ad: 'arayuz derlemesi', komut: 'npm', argumanlar: ['run', '-s', 'build'] },
  {
    ad: 'calisma zamani paketi',
    komut: NODE,
    argumanlar: ['scripts/paket.cjs', '--cikti', CIKTI, '--derleme-yok'],
  },
];

/** Adimlari sirayla kosar; ilk dusen adimda durur. Cikis kodunu doner (0 = hepsi tamam). */
function calistir(
  adimlar = ADIMLAR,
  { kos = spawnSync, yaz = console.log, hata = console.error } = {},
) {
  for (const [i, a] of adimlar.entries()) {
    yaz(
      `[kurumsal] ${i + 1}/${adimlar.length} ${a.ad}: ${[path.basename(a.komut), ...a.argumanlar].join(' ')}`,
    );
    const r = kos(a.komut, a.argumanlar, { cwd: KOK, stdio: 'inherit', env: process.env });
    const kod = r.error || r.status == null ? 1 : r.status;
    if (kod !== 0) {
      const ayrinti = [`cikis ${kod}`];
      if (r.error) ayrinti.push(r.error.message);
      if (r.signal) ayrinti.push(`sinyal ${r.signal}`);
      hata(`[kurumsal] ADIM DUSTU: ${a.ad} (${ayrinti.join(', ')})`);
      return kod;
    }
  }
  yaz(`[kurumsal] tamam: ${CIKTI}`);
  return 0;
}

if (require.main === module) process.exit(calistir());

module.exports = { ADIMLAR, CIKTI, calistir };
