// server/__tests__/kurumsal-pipeline.test.cjs — kurumsal Jenkins isi (deploy/jenkins/*.groovy) bayatlamasin.
//
// Kurumsal is calismiyordu (2026-11-18, kurumdaki 560 groovy ve standart_pipeline koduyla karsilastirildi):
// Node araci yoktu (kutuphane Linux ajanini yalniz `tools: [nodejs]` ile secer), var olmayan `build`
// dizini sikistiriliyordu, war ve deployment adlari SI kaydiyla (BMWPORTAL.war, BMWPORTAL-D) uyusmuyordu.
// Bu bekci dogru is tanimini repo ile uyumlu tutar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..');
const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');
const GROOVY = 'deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy';

// Kurumsal standart_pipeline kutuphanesinin Node izin listesinden (StandardPipelineUtilities.groovy,
// 2026-11-17 okundu) bu repoda kullanilabilenler. 22.20.0 listede YOK.
const NODE_IZINLI = ['22.23.4', '24.22.1', '26.12.1'];
const PAKET_KOKU = 'build/BMWPORTAL';
const BEKLENEN_KOMUTLAR = [
  'install',
  'run kur',
  'run kapsam:kurumsal',
  'run build',
  `run paket -- --cikti ${PAKET_KOKU}/PORTAL-BMW-main --derleme-yok`,
];
// Uygulamanin SI/CMDB kaydi: Deployment Name BMWPORTAL-D, War Name BMWPORTAL.war, Application Type Java.
const SI = { war: 'BMWPORTAL.war', deployment: 'BMWPORTAL-D', platform: 'JAVA' };

/** Saf denetim: groovy metni + repo bilgileri -> hata listesi (bos = uyumlu). */
function denetle(metin, { dockerNode, nvmrc, betikler, paketKaynak }) {
  const h = [];
  const araclar = (metin.match(/tools:\s*\[([^\]]*)\]/) || [])[1] || '';
  const node = (araclar.match(/nodejs:\s*"([^"]+)"/) || [])[1];
  if (!NODE_IZINLI.includes(node)) h.push(`Node ${node} kurumsal izin listesinde degil`);
  if (node !== dockerNode) h.push(`Node ${node} != Dockerfile ${dockerNode}`);
  if (!node || node.split('.')[0] !== nvmrc)
    h.push(`Node ${node} ana surumu .nvmrc (${nvmrc}) ile ayni degil`);
  // Kutuphane (generateSuitableLabel) Linux ajanini yalniz npm + YALNIZ nodejs aracinda secer.
  if ((araclar.match(/\w+:/g) || []).length !== 1)
    h.push(`tools yalniz nodejs olmali (Linux ajani): ${araclar}`);
  if (/^\s*agent:/m.test(metin))
    h.push('agent elle verilmez: npm isinde kutuphane etiketi kendisi secer');

  const blok = (metin.match(/commands:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const komutlar = [...blok.replace(/\/\/.*$/gm, '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (JSON.stringify(komutlar) !== JSON.stringify(BEKLENEN_KOMUTLAR))
    h.push(`komutlar beklenen sirada degil: ${JSON.stringify(komutlar)}`);
  for (const k of komutlar) {
    const ad = (k.match(/^run ([\w:-]+)/) || [])[1];
    if (ad && !betikler[ad]) h.push(`package.json'da "${ad}" betigi yok`);
  }
  for (const bayrak of ['--cikti', '--derleme-yok']) {
    if (!paketKaynak.includes(`'${bayrak}'`))
      h.push(`scripts/paket.cjs ${bayrak} bayragini tanimiyor`);
  }

  const sikistir = metin.match(/compress:\s*\[from:\s*"([^"]+)",\s*to:\s*"([^"]+)"\]/);
  const staging = (metin.match(/artifactsToCopy:\s*'([^']+)'/) || [])[1] || '';
  if (!sikistir || sikistir[1] !== PAKET_KOKU)
    h.push(`compress paket kokunden (${PAKET_KOKU}) yapilmiyor`);
  if (!sikistir || path.posix.basename(sikistir[2]) !== SI.war)
    h.push(`war adi SI kaydindaki ${SI.war} degil`);
  if (
    !sikistir ||
    path.posix.dirname(sikistir[2]) !== path.posix.dirname(staging) ||
    !staging.endsWith('.war')
  )
    h.push(`staging (${staging}) compress ciktisini almiyor`);
  if (!new RegExp(`deploymentPlatform:\\s*'${SI.platform}'`).test(metin))
    h.push(`deploymentPlatform ${SI.platform} degil`);
  if (!new RegExp(`configurationName:\\s*'${SI.deployment}'`).test(metin))
    h.push(`configurationName SI kaydindaki ${SI.deployment} degil`);

  const epostalar = metin.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [];
  if (epostalar.length) h.push(`gercek e-posta adresi public repoda: ${epostalar.join(', ')}`);
  if (!/to:\s*'EKIP_EPOSTA_ADRESI'/.test(metin)) h.push('e-posta yer tutucusu yok');
  return h;
}

const BAGLAM = () => ({
  dockerNode: (oku('Dockerfile').match(/^FROM node:([\d.]+)-/m) || [])[1],
  nvmrc: oku('.nvmrc').trim(),
  betikler: JSON.parse(oku('package.json')).scripts,
  paketKaynak: oku('scripts/paket.cjs'),
});

test('KJ1 kurumsal is tanimi repo ve SI kaydi ile uyumlu (Node/ajan, komutlar, war, deployment, e-posta)', () => {
  assert.deepEqual(denetle(oku(GROOVY), BAGLAM()), []);
});

test("KJ2 paket build/ altinda uretilebilir ve kurumsal Sonar onu taramaz; kapsam Sonar'in aradigi yerde", () => {
  const { ciktiYeriHatasi } = require('../../scripts/paket.cjs');
  assert.equal(ciktiYeriHatasi(path.join(KOK, PAKET_KOKU, 'PORTAL-BMW-main')), null);
  assert.match(oku('.gitignore'), /^\/build$/m, 'build/ git disi degil');
  // Kutuphanenin Sonar adimi `**/coverage/lcov.info` arar; kapsam:kurumsal onu oraya koyar.
  assert.match(
    JSON.parse(oku('package.json')).scripts['kapsam:kurumsal'],
    /kapsam-yayinla\.cjs --kurumsal/,
  );
  assert.match(oku('scripts/kapsam-yayinla.cjs'), /path\.join\(KOK, 'coverage', 'lcov\.info'\)/);
  assert.match(
    oku('sonar-project.properties'),
    /^sonar\.javascript\.lcov\.reportPaths=(?:[^,\n]+,)*coverage\/lcov\.info(?:,|$)/m,
  );
});

test('KJ3 bekcinin kendisi kor degil: her bozulma ayri yakalanir', () => {
  const asil = oku(GROOVY);
  const b = BAGLAM();
  const bozuk = [
    ['izin disi Node', asil.replace('nodejs: "22.23.4"', 'nodejs: "22.20.0"'), /izin listesinde/],
    [
      'ek arac (Linux ajani kaybolur)',
      asil.replace('tools: [nodejs: "22.23.4"]', 'tools: [nodejs: "22.23.4", jdk: \'OPEN8\']'),
      /yalniz nodejs/,
    ],
    [
      'elle ajan',
      asil.replace('    global: [\n', "    global: [\n        agent: 'NODEJS',\n"),
      /agent elle/,
    ],
    [
      'kapsam adimi yok',
      asil.replace('            "run kapsam:kurumsal",\n', ''),
      /beklenen sirada/,
    ],
    ['kur yok', asil.replace('            "run kur",\n', ''), /beklenen sirada/],
    [
      'eski build dizini',
      asil.replace('compress: [from: "build/BMWPORTAL"', 'compress: [from: "build"'),
      /paket kokunden/,
    ],
    [
      'yanlis war adi',
      asil.replace('"BMWPORTAL/BMWPORTAL.war"', '"GAR_BMW_PORTAL/GAR_BMW_PORTAL.war"'),
      /war adi/,
    ],
    [
      'yanlis deployment',
      asil.replace("configurationName: 'BMWPORTAL-D'", "configurationName: 'GAR_BMW_PORTAL'"),
      /configurationName/,
    ],
    [
      'staging farkli',
      asil.replace("artifactsToCopy: 'BMWPORTAL/*.war'", "artifactsToCopy: 'outdir/*.war'"),
      /staging/,
    ],
    [
      'gercek e-posta',
      asil.replace("'EKIP_EPOSTA_ADRESI'", "'ekip@ornek.com.tr'"),
      /gercek e-posta/,
    ],
  ];
  for (const [ad, metin, beklenen] of bozuk) {
    assert.notEqual(metin, asil, `${ad}: bozulma uygulanamadi (groovy degismis)`);
    const h = denetle(metin, b);
    assert.ok(
      h.some((x) => beklenen.test(x)),
      `${ad} yakalanmadi: ${JSON.stringify(h)}`,
    );
  }
  assert.ok(
    denetle(asil, { ...b, betikler: { ...b.betikler, 'kapsam:kurumsal': undefined } }).some((x) =>
      /kapsam:kurumsal/.test(x),
    ),
    'eksik npm betigi yakalanmadi',
  );
  assert.ok(
    denetle(asil, { ...b, dockerNode: '22.99.0' }).some((x) => /Dockerfile/.test(x)),
    'Dockerfile farki yakalanmadi',
  );
});
