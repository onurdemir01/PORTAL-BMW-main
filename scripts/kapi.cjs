// scripts/kapi.cjs — kalite kapilarinin TAMAMI tek komutta (docs/KALITE-KAPILARI.md).
//   npm run kapi            K1-K12: push / PR oncesi, CI'nin kosturdugu kapilarin aynisi
//   npm run kapi:hizli      yalniz hizli kapilar (pre-push kancasi; ~1-2 dk)
//   npm run kapi:sonar      K13: yerel SonarQube kalite kapisi (scripts/sonar-kapi.cjs)
//
// Bir kapi kirmizi olsa da sonrakiler kosar (hepsinin durumu tek seferde gorulur); sonunda
// herhangi biri kirmiziysa cikis 1. CI ayni listeyi .github/workflows/ci.yml'de kosturur; liste
// ile is akisinin esitligini server/__tests__/kalite-kapilari.test.js kilitler.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { aracYolu, kabukIcin } = require('./arac-yolu.cjs');

const KOK = path.join(__dirname, '..');
const PAKET_CIKTI = path.join(os.tmpdir(), 'bmw-paket-kapi');

// `ci`: ci.yml'de bu kapiyi kosturan satirda gecmesi gereken metin.
const KAPILAR = [
  {
    id: 'K1',
    ad: 'tip denetimi (strict)',
    komut: ['npx', 'tsc', '--noEmit'],
    ci: 'npx tsc --noEmit',
    hizli: true,
  },
  {
    id: 'K2',
    ad: 'lint (0 uyari)',
    komut: ['npm', 'run', '-s', 'lint'],
    ci: 'npm run lint',
    hizli: true,
  },
  {
    id: 'K3',
    ad: 'ASCII kurali',
    komut: ['npm', 'run', '-s', 'lint:ascii'],
    ci: 'npm run lint:ascii',
    hizli: true,
  },
  {
    id: 'K4',
    ad: 'sunucu denetimi',
    komut: ['npm', 'run', '-s', 'check:server'],
    ci: 'npm run check:server',
    hizli: true,
  },
  {
    id: 'K5',
    ad: 'manifest esitligi',
    komut: ['node', 'scripts/manifest.cjs', '--dogrula'],
    ci: 'node scripts/manifest.cjs --dogrula',
    hizli: true,
  },
  {
    id: 'K6',
    ad: 'bagimlilik guvenligi (0 zafiyet)',
    komut: ['npm', 'run', '-s', 'guvenlik'],
    ci: 'npm run guvenlik',
    hizli: true,
  },
  {
    id: 'K7',
    ad: 'on kontrol',
    komut: ['npm', 'run', '-s', 'preflight'],
    ci: 'npm run preflight',
    hizli: true,
  },
  {
    id: 'K8',
    ad: 'testler + kapsam',
    komut: ['npm', 'run', '-s', 'test:coverage'],
    ci: 'npm run test:coverage',
  },
  {
    id: 'K9',
    ad: 'kapsam esigi',
    komut: ['node', 'scripts/kapsam-esik.cjs'],
    ci: 'node scripts/kapsam-esik.cjs',
  },
  {
    id: 'K10',
    ad: 'mutasyon testi',
    komut: ['npm', 'run', '-s', 'test:mutation'],
    ci: 'npm run test:mutation',
  },
  { id: 'K11', ad: 'SBOM ve lisans', komut: ['npm', 'run', '-s', 'sbom'], ci: 'npm run sbom' },
  {
    id: 'K12',
    ad: 'derleme + calisma zamani paketi',
    komut: [
      'bash',
      '-c',
      `npm run -s build && rm -rf "${PAKET_CIKTI}" && npm run -s paket -- --cikti "${PAKET_CIKTI}" --derleme-yok; rc=$?; rm -rf "${PAKET_CIKTI}"; exit $rc`,
    ],
    ci: 'npm run paket -- --cikti',
  },
];

// Kapi listesinde olmayan ama CI'da ayrica kosan kapilar (fark araligi ister / ayri is).
const CI_EK = [
  { id: 'K0', ad: 'sir taramasi (PR / push araligi)', ci: 'node scripts/sir-tarama.cjs --aralik' },
  { id: 'K13', ad: 'SonarQube kalite kapisi', ci: 'node scripts/sonar-kapi.cjs' },
  { id: 'K14', ad: 'kurumsal is provasi', ci: 'npm run kurumsal:prova' },
  { id: 'K15', ad: 'kurumsal Sonar taklidi', ci: 'node scripts/sonar-kapi.cjs --ci --kurumsal' },
];

function kos(k) {
  const bas = Date.now();
  // Arac sabit dizinden (PATH'te aranmaz; scripts/arac-yolu.cjs). Windows'ta npm / npx kabuk ister.
  const r = spawnSync(kabukIcin(aracYolu(k.komut[0])), k.komut.slice(1), {
    cwd: KOK,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return { ...k, tamam: r.status === 0, sn: Math.round((Date.now() - bas) / 1000) };
}

function main(argv) {
  const hizli = argv.includes('--hizli');
  const secilen = KAPILAR.filter((k) => !hizli || k.hizli);
  if (!fs.existsSync(path.join(KOK, 'node_modules', '.bin'))) {
    console.error('[kapi] gelistirme agaci yok: once npm run kur');
    return 1;
  }
  const sonuc = [];
  for (const k of secilen) {
    console.log(`\n[kapi] ${k.id} ${k.ad} ...`);
    sonuc.push(kos(k));
  }
  console.log('\n[kapi] ozet:');
  for (const s of sonuc)
    console.log(`  ${s.tamam ? 'TAMAM ' : 'KIRMIZI'} ${s.id.padEnd(4)} ${s.ad} (${s.sn} sn)`);
  const kirmizi = sonuc.filter((s) => !s.tamam);
  if (kirmizi.length) {
    console.error(
      `[kapi] ${kirmizi.length} kapi kirmizi: ${kirmizi.map((s) => s.id).join(', ')}. Push etme.`,
    );
    return 1;
  }
  console.log(
    hizli
      ? '[kapi] hizli kapilar yesil.'
      : '[kapi] tum kapilar yesil (Sonar icin: npm run kapi:sonar).',
  );
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { KAPILAR, CI_EK };
