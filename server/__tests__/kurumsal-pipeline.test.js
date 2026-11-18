// server/__tests__/kurumsal-pipeline.test.js — kurumsal Jenkins isi (deploy/jenkins/*.groovy) bayatlamasin.
//
// Kurumsal is calismiyordu (2026-11-18, kurumdaki 560 groovy ve standart_pipeline koduyla karsilastirildi):
// Node araci yoktu (kutuphane Linux ajanini yalniz `tools: [nodejs]` ile secer), var olmayan `build`
// dizini sikistiriliyordu, war ve deployment adlari SI kaydiyla (BMWPORTAL.war, BMWPORTAL-D) uyusmuyordu.
// Bu bekci dogru is tanimlarini (DVL, TST, PRD) repo ile ve birbirleriyle uyumlu tutar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..');
const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');
const GROOVY = 'deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy';
// Ortam basina deployment adi. DVL: SI kaydi. TST: kurumdaki -D / -T / -Q kalibi (SI ile dogrulanmali).
// PRD: deploy YOK (uretim kurulumu staging'den ayri surecle; kurumdaki PRD islerinin cogu ve onceki
// PRD tanimi boyle).
const ORTAMLAR = {
  DVL: { dosya: GROOVY, deployment: 'BMWPORTAL-D' },
  TST: { dosya: 'deploy/jenkins/TST_JAVASCRIPT_GAR_BMW_PORTAL.groovy', deployment: 'BMWPORTAL-T' },
  PRD: { dosya: 'deploy/jenkins/PRD_JAVASCRIPT_GAR_BMW_PORTAL.groovy', deployment: null },
};
/** Derleme + paket + war + staging bolumu: ortamlar arasinda BIREBIR ayni olmali. */
const derlemeBolumu = (metin) => {
  const i = metin.indexOf('    checkout: [');
  const j = metin.indexOf('    copyToStagingArea: [');
  const k = metin.indexOf(']', j);
  return i < 0 || j < 0 ? '' : metin.slice(i, k + 1);
};

// Kurumsal standart_pipeline kutuphanesinin Node izin listesinden (StandardPipelineUtilities.groovy,
// 2026-11-17 okundu) bu repoda kullanilabilenler. 22.20.0 listede YOK.
const NODE_IZINLI = ['22.23.4', '24.22.1', '26.12.1'];
const PAKET_KOKU = 'build/BMWPORTAL';
// Groovy YALNIZ install + tek giris noktasini cagirir (kurumsal is #46, 2026-11-18): groovy her dala ayni
// anda uygulanir; yeni bir npm betigi cagirirsa o betigi tasimayan dal "Missing script" ile kirilir.
// Derleme adimlari scripts/kurumsal-derle.cjs'te, kodla birlikte surumlenir.
const BEKLENEN_KOMUTLAR = ['install', 'run kurumsal:derle'];
const GIRIS = require('../../scripts/kurumsal-derle.cjs');
// Groovy ayristirici provayla ORTAK: CI'daki prova ile bu bekci groovy'yi ayni sekilde okur.
const PROVA = require('../../scripts/kurumsal-prova.cjs');
// Uygulamanin SI/CMDB kaydi (DVL): Deployment Name BMWPORTAL-D, War Name BMWPORTAL.war, Application Type Java.
const SI = { war: 'BMWPORTAL.war', platform: 'JAVA' };

/** Saf denetim: groovy metni + repo bilgileri -> hata listesi (bos = uyumlu). */
function denetle(metin, { dockerNode, nvmrc, betikler, paketKaynak }, deployment = 'BMWPORTAL-D') {
  const h = [];
  const g = PROVA.ayristir(metin);
  const araclar = g.araclar || '';
  const node = g.node;
  if (!NODE_IZINLI.includes(node)) h.push(`Node ${node} kurumsal izin listesinde degil`);
  if (node !== dockerNode) h.push(`Node ${node} != Dockerfile ${dockerNode}`);
  if (!node || node.split('.')[0] !== nvmrc)
    h.push(`Node ${node} ana surumu .nvmrc (${nvmrc}) ile ayni degil`);
  // Kutuphane (generateSuitableLabel) Linux ajanini yalniz npm + YALNIZ nodejs aracinda secer.
  if ((araclar.match(/\w+:/g) || []).length !== 1)
    h.push(`tools yalniz nodejs olmali (Linux ajani): ${araclar}`);
  if (/^\s*agent:/m.test(metin))
    h.push('agent elle verilmez: npm isinde kutuphane etiketi kendisi secer');

  const komutlar = g.komutlar || [];
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

  const sikistir = g.sikistir && [null, g.sikistir.from, g.sikistir.to];
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
  if (deployment === null) {
    if (/^\s*deploy:/m.test(metin))
      h.push('PRD isinde deploy olmaz (uretim kurulumu ayri surecle)');
  } else {
    if (!new RegExp(`deploymentPlatform:\\s*'${SI.platform}'`).test(metin))
      h.push(`deploymentPlatform ${SI.platform} degil`);
    if (!new RegExp(`configurationName:\\s*'${deployment}'`).test(metin))
      h.push(`configurationName ${deployment} degil`);
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

test('KJ1 kurumsal is tanimlari repo ve SI kaydi ile uyumlu (Node/ajan, komutlar, war, deployment, e-posta)', () => {
  for (const [ortam, o] of Object.entries(ORTAMLAR)) {
    assert.deepEqual(denetle(oku(o.dosya), BAGLAM(), o.deployment), [], ortam);
  }
});

test('KJ4 TST ve PRD derlemesi DVL ile birebir ayni (yalniz deploy farkli)', () => {
  const dvl = derlemeBolumu(oku(GROOVY));
  assert.ok(
    dvl.includes('commands:') && dvl.includes('artifactsToCopy'),
    'DVL derleme bolumu okunamadi',
  );
  assert.ok(dvl.startsWith('    checkout: ['), 'DVL derleme bolumu checkout ile baslamiyor');
  assert.ok(
    dvl.includes(`"${BEKLENEN_KOMUTLAR[1]}"`) && dvl.includes('compress:') && dvl.endsWith(']'),
    'DVL derleme bolumu eksik okundu',
  );
  // Bekci kor degil: KJ1'in gormedigi bir ayrisma (TST'ye dal eklemek) de farkli bolum uretir.
  const tst = oku(ORTAMLAR.TST.dosya);
  const ayrik = tst.replace(
    "repository: 'GAR_BMW_PORTAL'",
    "repository: 'GAR_BMW_PORTAL',\n        branch: 'develop'",
  );
  assert.notEqual(ayrik, tst, 'ayrisma uygulanamadi');
  assert.notEqual(derlemeBolumu(ayrik), dvl, 'TST ayrismasi yakalanmadi');
  for (const ortam of ['TST', 'PRD']) {
    assert.equal(
      derlemeBolumu(oku(ORTAMLAR[ortam].dosya)),
      dvl,
      `${ortam} derlemesi DVL'den ayrismis`,
    );
  }
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
      'giris noktasi yok',
      asil.replace(',\n            "run kurumsal:derle"', ''),
      /beklenen sirada/,
    ],
    [
      'groovy yeni betik cagiriyor (surum kaymasi)',
      // Yalniz komut satiri (12 bosluk girinti); baslik yorumunda da ayni metin geciyor.
      asil.replace(
        '            "run kurumsal:derle"\n',
        '            "run kurumsal:derle",\n            "run kapsam:kurumsal"\n',
      ),
      /beklenen sirada/,
    ],
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
    [
      'PRD isinde deploy',
      oku(ORTAMLAR.PRD.dosya).replace(
        "        artifactsToCopy: 'BMWPORTAL/*.war'\n    ]\n",
        "        artifactsToCopy: 'BMWPORTAL/*.war'\n    ],\n    deploy: [\n        deploymentPlatform: 'JAVA',\n        configurationName: 'BMWPORTAL'\n    ]\n",
      ),
      /PRD isinde deploy/,
      null,
    ],
    [
      'TST DVL adiyla',
      oku(ORTAMLAR.TST.dosya).replace(
        "configurationName: 'BMWPORTAL-T'",
        "configurationName: 'BMWPORTAL-D'",
      ),
      /configurationName BMWPORTAL-T/,
      'BMWPORTAL-T',
    ],
  ];
  for (const [ad, metin, beklenen, deployment = 'BMWPORTAL-D'] of bozuk) {
    assert.ok(
      !Object.values(ORTAMLAR).some((o) => oku(o.dosya) === metin),
      `${ad}: bozulma uygulanamadi (groovy degismis)`,
    );
    const h = denetle(metin, b, deployment);
    assert.ok(
      h.some((x) => beklenen.test(x)),
      `${ad} yakalanmadi: ${JSON.stringify(h)}`,
    );
  }
  assert.ok(
    denetle(asil, { ...b, betikler: { ...b.betikler, 'kurumsal:derle': undefined } }).some((x) =>
      /kurumsal:derle/.test(x),
    ),
    'eksik npm betigi yakalanmadi',
  );
  assert.ok(
    denetle(asil, { ...b, dockerNode: '22.99.0' }).some((x) => /Dockerfile/.test(x)),
    'Dockerfile farki yakalanmadi',
  );
});

test("KJ5 tek giris noktasi: adimlar kodla birlikte, cikti groovy'nin sikistirdigi yerde", () => {
  assert.equal(
    JSON.parse(oku('package.json')).scripts['kurumsal:derle'],
    'node scripts/kurumsal-derle.cjs',
  );
  assert.equal(
    GIRIS.CIKTI,
    `${PAKET_KOKU}/PORTAL-BMW-main`,
    'cikti groovy compress kokunun altinda degil',
  );
  const ozet = GIRIS.ADIMLAR.map((a) => [path.basename(a.komut), ...a.argumanlar].join(' '));
  assert.deepEqual(ozet, [
    // Ilk adim teslim butunlugu (is #48): yarim aktarim derlemeden once, dosyasiyla soylenir.
    `${path.basename(process.execPath)} scripts/teslim.cjs --dogrula`,
    `${path.basename(process.execPath)} scripts/kur.cjs`,
    `${path.basename(process.execPath)} scripts/kapsam-yayinla.cjs --kurumsal`,
    'npm run -s build',
    `${path.basename(process.execPath)} scripts/paket.cjs --cikti ${GIRIS.CIKTI} --derleme-yok`,
  ]);
  for (const a of GIRIS.ADIMLAR.filter((x) => x.komut === process.execPath)) {
    assert.ok(fs.existsSync(path.join(KOK, a.argumanlar[0])), `${a.argumanlar[0]} yok`);
  }
  assert.ok(JSON.parse(oku('package.json')).scripts.build, 'build betigi yok');
});

test('KJ6 calistir(): ilk dusen adimda durur, adimi ve cikis kodunu soyler; hepsi tamamsa 0', () => {
  const adimlar = [
    { ad: 'bir', komut: 'a', argumanlar: [] },
    { ad: 'iki', komut: 'b', argumanlar: ['x'] },
    { ad: 'uc', komut: 'c', argumanlar: [] },
  ];
  const kos = (sonuclar) => {
    const kosulan = [];
    const mesaj = [];
    const kod = GIRIS.calistir(adimlar, {
      kos: (k) => {
        kosulan.push(k);
        return sonuclar[k];
      },
      yaz: () => {},
      hata: (m) => mesaj.push(m),
    });
    return { kod, kosulan, mesaj };
  };
  const tamam = kos({ a: { status: 0 }, b: { status: 0 }, c: { status: 0 } });
  assert.deepEqual([tamam.kod, tamam.kosulan, tamam.mesaj], [0, ['a', 'b', 'c'], []]);
  const duser = kos({ a: { status: 0 }, b: { status: 7 }, c: { status: 0 } });
  assert.deepEqual([duser.kod, duser.kosulan], [7, ['a', 'b']], 'dusen adimdan sonra devam etti');
  assert.match(duser.mesaj[0], /ADIM DUSTU: iki \(cikis 7\)/);
  const baslamadi = kos({ a: { error: new Error('ENOENT'), status: null } });
  assert.equal(baslamadi.kod, 1);
  assert.match(baslamadi.mesaj[0], /ADIM DUSTU: bir \(cikis 1, ENOENT\)/);
  const sinyal = kos({ a: { status: null, signal: 'SIGTERM' } });
  assert.equal(sinyal.kod, 1, 'sinyalle olen adim basari sayildi');
});

test('KJ7 prova groovy ayristiricisi: Node, komutlar, sikistirma; eksik ya da yanlis groovy reddedilir', () => {
  const asil = oku(GROOVY);
  const g = PROVA.groovyOku(asil);
  assert.equal(g.node, '22.23.4');
  assert.deepEqual(g.komutlar, BEKLENEN_KOMUTLAR);
  assert.deepEqual(g.sikistir, { from: PAKET_KOKU, to: 'BMWPORTAL/BMWPORTAL.war' });
  assert.equal(PROVA.GROOVY, GROOVY);
  // Yorum satirindaki komut sayilmaz.
  assert.deepEqual(
    PROVA.ayristir('commands: [\n  "install",\n  // "run eski"\n  "run x"\n]').komutlar,
    ['install', 'run x'],
  );
  assert.deepEqual(PROVA.ayristir('bos'), {
    araclar: undefined,
    node: undefined,
    komutlar: undefined,
    sikistir: undefined,
  });
  const bozuk = [
    [asil.replace('tools: [nodejs: "22.23.4"]', 'tools: []'), /tools nodejs yok/],
    [asil.replace(/commands: \[[\s\S]*?\]/, 'commands: []'), /commands yok/],
    [asil.replace(/compress: \[[^\]]*\]/, ''), /compress yok/],
    [asil.replace('"install",\n', ''), /ilk komutu install degil: run kurumsal:derle/],
  ];
  for (const [metin, beklenen] of bozuk) {
    assert.notEqual(metin, asil, `bozulma uygulanamadi: ${beklenen}`);
    assert.throws(() => PROVA.groovyOku(metin), beklenen);
  }
  const t = { yaz: [], hata: [] };
  const g2 = { yaz: (m) => t.yaz.push(m), hata: (m) => t.hata.push(m) };
  assert.equal(PROVA.main(['--node-surumu'], { kok: KOK, ...g2 }), 0);
  assert.deepEqual(t.yaz, ['22.23.4']);
  assert.equal(PROVA.main(['--bilinmeyen'], { kok: KOK, ...g2 }), 2);
  assert.match(t.hata.at(-1), /kullanim/);
  const bos = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'prova-kok-'));
  try {
    assert.equal(
      PROVA.main(['--node-surumu'], { kok: bos, ...g2 }),
      1,
      'groovy yokken surum yazildi',
    );
    assert.match(t.hata.at(-1), /\[prova\] ENOENT/);
  } finally {
    fs.rmSync(bos, { recursive: true, force: true });
  }
});

test('KJ8 prova: komutlar groovy sirasiyla temiz agacta; paket, sure ve dusen adim; agac her durumda silinir', () => {
  const os = require('node:os');
  const CIKTI = GIRIS.CIKTI;
  /** Sahte kos: kosulanlari kaydeder; worktree add agaci, kurumsal:derle paketi olusturur. */
  const sahte = ({ dus, paketYok, devDep } = {}) => {
    const kayit = [];
    const kos = (komut, args, sec) => {
      kayit.push({ komut: path.basename(komut), args, cwd: sec.cwd, env: sec.env });
      const ad = [path.basename(komut), ...args].join(' ');
      if (dus && ad.includes(dus)) return { status: 3 };
      if (args[0] === 'worktree' && args[1] === 'add') fs.mkdirSync(args[3], { recursive: true });
      if (ad === 'npm run kurumsal:derle' && !paketYok) {
        const k = path.join(sec.cwd, CIKTI);
        for (const p of PROVA.PAKET_ICERIGI) {
          fs.mkdirSync(path.dirname(path.join(k, p)), { recursive: true });
          if (p === 'server') fs.mkdirSync(path.join(k, p), { recursive: true });
          else
            fs.writeFileSync(
              path.join(k, p),
              p === 'package.json' && devDep ? '{"devDependencies":{}}' : '{}',
            );
        }
      }
      return { status: 0 };
    };
    return { kayit, kos };
  };
  const calis = (s, { dk = 3 } = {}) => {
    const t = { yaz: [], hata: [] };
    let n = 0;
    const kod = PROVA.prova({
      kok: KOK,
      kos: s.kos,
      yaz: (m) => t.yaz.push(m),
      hata: (m) => t.hata.push(m),
      simdi: () => (n++ === 0 ? 0 : dk * 60000),
      surum: 'v22.23.4',
    });
    return { kod, ...t };
  };
  const eskiNot = process.env.BUILD_NOTE;
  process.env.BUILD_NOTE = 'sonarqube taramasi';
  try {
    const s = sahte();
    const r = calis(s);
    assert.equal(r.kod, 0, r.hata.join('\n'));
    const ozet = s.kayit.map((k) => [k.komut, ...k.args].join(' '));
    const agac = s.kayit[0].args[3];
    assert.deepEqual(ozet, [
      `git worktree add --detach ${agac} HEAD`,
      `${path.basename(process.execPath)} scripts/teslim.cjs --yaz`,
      'npm install',
      'npm run kurumsal:derle',
      `git worktree remove --force ${agac}`,
    ]);
    assert.equal(s.kayit[0].cwd, KOK);
    for (const k of s.kayit.slice(1, 4)) {
      assert.equal(k.cwd, agac, `${k.args.join(' ')} temiz agacta kosmadi`);
      assert.equal(k.env.BUILD_NOTE, undefined, 'Sonar kosusu tetiklenmemeli');
    }
    assert.ok(!fs.existsSync(path.dirname(agac)), 'gecici dizin silinmedi');
    assert.match(
      r.yaz.at(-1),
      /tamam: 3\.0 dk, paket build\/BMWPORTAL\/PORTAL-BMW-main -> BMWPORTAL\/BMWPORTAL\.war/,
    );
    assert.ok(!r.yaz.some((m) => /UYARI/.test(m)), 'ayni surumde uyari verildi');
  } finally {
    if (eskiNot === undefined) delete process.env.BUILD_NOTE;
    else process.env.BUILD_NOTE = eskiNot;
  }

  // Dusen adimda durur (sonraki adim kosmaz), adimi soyler, agaci yine siler.
  const dusmeler = [
    ['worktree add', 'temiz agac'],
    ['teslim.cjs', 'teslim imzasi'],
    ['npm install', 'groovy "install"'],
    ['kurumsal:derle', 'groovy "run kurumsal:derle"'],
  ];
  for (const [i, [dus, adim]] of dusmeler.entries()) {
    const s = sahte({ dus });
    const r = calis(s);
    assert.equal(r.kod, 1, dus);
    assert.equal(r.hata[0], `[prova] DUSTU: ${adim} (cikis 3)`, dus);
    assert.equal(s.kayit.length, i + 2, `${dus}: dusen adimdan sonra devam etti`);
    assert.deepEqual(
      s.kayit.at(-1).args.slice(0, 2),
      ['worktree', 'remove'],
      `${dus}: agac silinmedi`,
    );
  }
  const baslamadi = calis({
    kayit: [],
    kos: (k, a) => (a[1] === 'add' ? { status: null, error: new Error('ENOENT') } : { status: 0 }),
  });
  assert.match(baslamadi.hata[0], /DUSTU: temiz agac \(cikis 1, ENOENT\)/);

  const paketsiz = calis(sahte({ paketYok: true }));
  assert.equal(paketsiz.kod, 1);
  assert.match(paketsiz.hata.join('\n'), /PAKET EKSIK[\s\S]*PORTAL-BMW-main\/dist\/index\.html/);
  const gelistirmeli = calis(sahte({ devDep: true }));
  assert.equal(gelistirmeli.kod, 1);
  assert.match(gelistirmeli.hata.join('\n'), /devDependencies tasiyor/);
  const yavas = calis(sahte(), { dk: PROVA.SURE_SINIRI_DK + 0.5 });
  assert.equal(yavas.kod, 1);
  assert.match(yavas.hata[0], /SURE ASILDI: 10\.5 dk > 10 dk/);
  assert.equal(calis(sahte(), { dk: PROVA.SURE_SINIRI_DK }).kod, 0, 'sinirda dusmemeli');

  // Paket sikistirilan dizinin disindaysa groovy onu war'a koymaz.
  assert.match(
    PROVA.paketDenetle(os.tmpdir(), 'build/BASKA')[0],
    /sikistirilan dizinin \(build\/BASKA\) altinda degil/,
  );
  // Surum farki uyarilir ama prova kosar.
  const t = { yaz: [] };
  PROVA.prova({
    kok: KOK,
    kos: sahte().kos,
    yaz: (m) => t.yaz.push(m),
    hata: () => {},
    simdi: () => 0,
    surum: 'v20.0.0',
  });
  assert.match(t.yaz[0], /UYARI: Node v20\.0\.0; kurumsal is Node 22\.23\.4/);
  assert.deepEqual(PROVA.ortam({ A: '1', BUILD_NOTE: 'x' }), { A: '1' });
});
