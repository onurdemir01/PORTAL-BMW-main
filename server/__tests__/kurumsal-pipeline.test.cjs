// server/__tests__/kurumsal-pipeline.test.cjs — kurumsal Jenkins isi (deploy/jenkins/*.groovy) bayatlamasin.
//
// Kurumsal Sonar kapsami %0 gorunuyordu: is tanimi testleri hic kosturmuyordu (2026-11-17). Dogru is
// tanimi bu repoda tutulur; bu bekci onun repo ile uyumunu zorlar: Node surumu izin listesinde ve
// Dockerfile ile ayni, kapsam adimi build'den once, `npm run` betikleri var, paket calisma alani
// DISINDA, public repoda gercek e-posta adresi yok.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..');
const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');
const GROOVY = 'deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy';

// Kurumsal standart_pipeline kutuphanesinin Node izin listesi (StandardPipelineUtilities.groovy,
// 2026-11-17 okundu). 22.20.0 listede YOK. Liste degisirse burasi ve groovy birlikte guncellenir.
const NODE_IZINLI = ['22.23.4', '24.22.1', '26.12.1'];
const BEKLENEN_KOMUTLAR = [
  'install',
  'run kur',
  'run test:coverage',
  'run build',
  'run paket -- --cikti ${PAKET}/PORTAL-BMW-main --derleme-yok',
];

/** Saf denetim: groovy metni + repo bilgileri -> hata listesi (bos = uyumlu). */
function denetle(metin, { dockerNode, nvmrc, betikler, paketKaynak }) {
  const h = [];
  const node = (metin.match(/tools:\s*\[nodejs:\s*"([^"]+)"\]/) || [])[1];
  if (!NODE_IZINLI.includes(node)) h.push(`Node ${node} kurumsal izin listesinde degil`);
  if (node !== dockerNode) h.push(`Node ${node} != Dockerfile ${dockerNode}`);
  if (!node || node.split('.')[0] !== nvmrc)
    h.push(`Node ${node} ana surumu .nvmrc (${nvmrc}) ile ayni degil`);

  const blok = (metin.match(/commands:\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const komutlar = [...blok.replace(/\/\/.*$/gm, '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (JSON.stringify(komutlar) !== JSON.stringify(BEKLENEN_KOMUTLAR))
    h.push(`komutlar beklenen sirada degil: ${JSON.stringify(komutlar)}`);
  for (const k of komutlar) {
    const ad = (k.match(/^run ([\w:-]+)/) || [])[1];
    if (ad && !betikler[ad]) h.push(`package.json'da "${ad}" betigi yok`);
  }

  const paket = (metin.match(/def PAKET = '([^']+)'/) || [])[1] || '';
  if (!paket.startsWith('../')) h.push(`paket calisma alani icinde: ${paket || '(tanimsiz)'}`);
  const sikistir = metin.match(/compress:\s*\[from:\s*(\w+),\s*to:\s*"([^"]+)"\]/);
  const staging = (metin.match(/artifactsToCopy:\s*'([^']+)'/) || [])[1];
  if (!sikistir || sikistir[1] !== 'PAKET') h.push('compress paket dizininden yapilmiyor');
  if (!sikistir || sikistir[2] !== staging) h.push(`staging (${staging}) compress ciktisi degil`);
  for (const bayrak of ['--cikti', '--derleme-yok']) {
    if (!paketKaynak.includes(`'${bayrak}'`))
      h.push(`scripts/paket.cjs ${bayrak} bayragini tanimiyor`);
  }

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

test('KP1 kurumsal is tanimi repo ile uyumlu (Node, komut sirasi, betikler, paket yeri, e-posta)', () => {
  assert.deepEqual(denetle(oku(GROOVY), BAGLAM()), []);
});

test("KP2 kapsam raporu Sonar'in aradigi yerde uretilir", () => {
  // Kutuphanenin Sonar adimi `**/coverage/lcov.info` arar; repo ayari da ayni dosyayi gosterir.
  assert.match(oku('scripts/lcov-birlestir.cjs'), /let out = 'coverage\/lcov\.info'/);
  assert.match(
    oku('sonar-project.properties'),
    /^sonar\.javascript\.lcov\.reportPaths=(?:[^,\n]+,)*coverage\/lcov\.info(?:,|$)/m,
  );
  assert.match(JSON.parse(oku('package.json')).scripts['test:coverage'], /lcov-birlestir\.cjs/);
});

test('KP3 bekcinin kendisi kor degil: her bozulma ayri yakalanir', () => {
  const asil = oku(GROOVY);
  const b = BAGLAM();
  const bozuk = [
    ['izin disi Node', asil.replace('nodejs: "22.23.4"', 'nodejs: "22.20.0"'), /izin listesinde/],
    ['kapsam adimi yok', asil.replace('            "run test:coverage",\n', ''), /beklenen sirada/],
    [
      'kapsam build sonrasi',
      asil.replace(
        '"run test:coverage",\n            "run build",',
        '"run build",\n            "run test:coverage",',
      ),
      /beklenen sirada/,
    ],
    [
      'paket calisma alaninda',
      asil.replace("'../DVL_JAVASCRIPT_GAR_BMW_PORTAL-paket'", "'paket'"),
      /calisma alani icinde/,
    ],
    [
      'gercek e-posta',
      asil.replace("'EKIP_EPOSTA_ADRESI'", "'ekip@ornek.com.tr'"),
      /gercek e-posta/,
    ],
    [
      'staging farkli',
      asil.replace(
        "artifactsToCopy: 'outdir/PORTAL-BMW-main.zip'",
        "artifactsToCopy: 'outdir/x.zip'",
      ),
      /staging/,
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
    denetle(asil, { ...b, betikler: { ...b.betikler, 'test:coverage': undefined } }).some((x) =>
      /test:coverage/.test(x),
    ),
    'eksik npm betigi yakalanmadi',
  );
  assert.ok(
    denetle(asil, { ...b, dockerNode: '22.99.0' }).some((x) => /Dockerfile/.test(x)),
    'Dockerfile farki yakalanmadi',
  );
});
