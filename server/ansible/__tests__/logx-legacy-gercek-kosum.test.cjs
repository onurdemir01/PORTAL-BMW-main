// server/ansible/__tests__/logx-legacy-gercek-kosum.test.cjs
//
// LogX LEGACY: GERCEK ANSIBLE ILE UCTAN UCA (2026-10-07).
//
// Kullanici: "...../log|logs|log1|log2|logs1...|logs2.../... gibi durumlarda da log
// alabilmemiz cok onemli."
//
// `logx-legacy-olculemedi.test.cjs` karar mantigini Jinja ile render eder ama uzak modullerin
// sonucunu SENARYODAN enjekte eder: `ansible.builtin.find`in desen esleme kurali, atlanan
// yollari nasil bildirdigi ve `community.general.archive`in ZIP'e ne yazdigi orada OLCULMEZ
// (taklit edilir). Bu dosya o korlugu kapatir: gecici bir dizin agaci kurar ve GERCEK
// playbook'lari GERCEK ansible-playbook ile kosturur.
//
//   LG1  kesif: log, logs ve numarali dizinlerdeki dosyalar bulunur; log4j / logs_old / logsX /
//        config / mylogs, alt duzeydeki log dizini ve BASKA uygulamanin klasoru bulunmaz;
//        desen artifact'ta yayinlanir
//   LG1b "yok" hata degildir: uygulama hostta yok + koklerden biri hostta yok -> ok + 0 dosya
//   LG3  "olculemedi" yok degildir: okunamayan log dizini -> error, yol adiyla; kismi liste yok
//   LG2  kesif -> aktarim (tek host): numarali dizinlerden secilen dosyalar ZIP'e girer;
//        log1/server.log ile log2/server.log AYNI ADLA birbirini ezmez
//   LG4  aktarim (iki host): host basina parca ZIP'ler tek arsivde birlesir, gecici dizinler
//        temizlenir
//   LG5  portal ekraninin okudugu sonuc bicimleri (kismi / basarisiz) gercek kosumla uretilir ve
//        ekran testlerinin girdisi olan ornek dosyasiyla karsilastirilir (dosyanin sonunda)
//
// KOSUL: PATH'te ansible-playbook (LG2/LG4/LG5 icin ayrica community.general.archive). Yoksa testler
// ATLANIR (ayni sozlesme: scalex-sure-kirilimi O2a/O2b; CI'da Ansible'in kurulu olmasini
// scalex-verify-timing VT0 zorlar). Windows'ta ansible calismaz.
// Uretimden farklar bilerek: yerel baglanti, `ansible_become=false` (dzdo/was gecisi yok),
// kokler gecici dizine cevrilir (`legacy_log_roots`), aktarimda `was_tmp_dir` gecici dizinde.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ansiblePythonu } = require('./fixtures/python-bul.cjs');

const DIR = path.join(__dirname, '..', 'bmw_portal', 'logx', 'legacy');
const KESIF = path.join(DIR, 'logx_legacy_discovery.yml');
const AKTARIM = path.join(DIR, 'logx_legacy_transfer.yml');

const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;
const HAS_ARCHIVE =
  HAS_ANSIBLE &&
  spawnSync('ansible-doc', ['-t', 'module', 'community.general.archive'], { stdio: 'ignore' })
    .status === 0;
const ANSIBLE_YOK = !HAS_ANSIBLE && 'ansible-playbook yok';
const ARSIV_YOK = !HAS_ARCHIVE && 'ansible-playbook ya da community.general.archive yok';
// root her dizini okur: "okunamayan dizin" kurulamaz.
const ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const EAR = 'vhosting8/APPX-T.ear';
// EAR'in altinda: taranmasi gerekenler ve tuzaklar. Buyuk harfli `Logs` BILEREK yok: macOS
// dosya sistemi harf duyarsizdir, `logs` ile ayni dizine duser (desen tablosu onu ayrica sinar).
// log1 ve log2'de AYNI adli dosya: numarali dizinlerin olagan hali (ornek basina bir dizin).
const TARANACAK = [
  `${EAR}/log/server.log`,
  `${EAR}/logs/SystemOut.log`,
  `${EAR}/log1/server.log`,
  `${EAR}/log2/server.log`,
  `${EAR}/log2/alt/b.log`,
  `${EAR}/logs1/c.log`,
  `${EAR}/logs2/d.log`,
  `${EAR}/logs10/e.log`,
  'vhosting/APPX-P.ear/logs3/p.log',
];
const TUZAK = [
  `${EAR}/log4j/log4j.xml`,
  `${EAR}/logs_old/eski.log`,
  `${EAR}/logsX/x.log`,
  `${EAR}/logs1a/y.log`,
  `${EAR}/log-1/z.log`,
  `${EAR}/config/APPX.properties`,
  `${EAR}/mylogs/m.log`,
  `${EAR}/alt/logs2/derin.log`,
  'vhosting8/BASKA.ear/logs1/o.log',
];
const icerik = (f) => `icerik ${f}\n`;

function agacKur() {
  // realpath: macOS'ta /var -> /private/var; playbook yollari find'in dondurdugu gibi karsilastirilir.
  const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'logx-lg-')));
  for (const f of [...TARANACAK, ...TUZAK]) {
    fs.mkdirSync(path.dirname(path.join(kok, f)), { recursive: true });
    fs.writeFileSync(path.join(kok, f), icerik(f));
  }
  return kok;
}

/** Gercek ansible-playbook; sonuc: set_stats ile yayinlanan logx_result. */
function kostur(playbook, vars, tmp, envanter = 'localhost,') {
  const vf = path.join(tmp, `vars-${path.basename(playbook)}.json`);
  fs.writeFileSync(vf, JSON.stringify({ ansible_become: false, ...vars }));
  const r = spawnSync(
    'ansible-playbook',
    ['-i', envanter, '-c', 'local', playbook, '-e', `@${vf}`],
    {
      encoding: 'utf8',
      timeout: 180000,
      env: {
        ...process.env,
        // Varsayilan geri-cagri + ozel istatistik satiri: yalniz ansible-core kuruluyken de calisir
        // (`json` geri-cagrisi tam pakette gelir, core'da yoktur).
        ANSIBLE_STDOUT_CALLBACK: 'default',
        ANSIBLE_SHOW_CUSTOM_STATS: '1',
        ANSIBLE_NOCOLOR: '1',
        ANSIBLE_FORCE_COLOR: '0',
        ANSIBLE_LOCALHOST_WARNING: '0',
        ANSIBLE_INVENTORY_UNPARSED_WARNING: '0',
        ANSIBLE_DEPRECATION_WARNINGS: '0',
      },
    },
  );
  const cikti = `${r.stdout || ''}\n${r.stderr || ''}`;
  const satir = (r.stdout || '').split('\n').find((l) => l.includes('RUN: {'));
  assert.ok(satir, `logx_result yayinlanmadi (rc=${r.status}):\n${cikti.slice(-3000)}`);
  const stats = JSON.parse(satir.slice(satir.indexOf('RUN: ') + 5));
  return { rc: r.status, sonuc: stats.logx_result, cikti };
}

/** ZIP'in icerigi: {ad: metin}; ic ice ZIP ise {ad: {ad: metin}}. Ansible'in python'u ile okunur. */
function zipOku(zip) {
  const py = spawnSync(
    ansiblePythonu() || 'python3',
    [
      '-c',
      [
        'import io, json, sys, zipfile',
        'def oku(z):',
        '    c = {}',
        '    for n in z.namelist():',
        '        v = z.read(n)',
        '        c[n] = oku(zipfile.ZipFile(io.BytesIO(v))) if n.endswith(".zip") else v.decode("utf-8", "replace")',
        '    return c',
        'print(json.dumps(oku(zipfile.ZipFile(sys.argv[1]))))',
      ].join('\n'),
      zip,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(py.status, 0, py.stderr);
  return JSON.parse(py.stdout);
}

const goreli = (kok, p) => path.relative(kok, p).split(path.sep).join('/');
const temizle = (kok) => fs.rmSync(kok, { recursive: true, force: true });

test(
  'LG1 gercek kesif: numarali log dizinleri bulunur, benzer adlar ve baska uygulama bulunmaz',
  { skip: ANSIBLE_YOK },
  () => {
    const kok = agacKur();
    try {
      const { rc, sonuc, cikti } = kostur(
        KESIF,
        {
          app_name: 'APPX',
          target_hosts: 'localhost',
          legacy_log_roots: [path.join(kok, 'vhosting'), path.join(kok, 'vhosting8')],
        },
        kok,
      );
      assert.equal(rc, 0, cikti.slice(-2000));
      assert.equal(sonuc.overall_status, 'success', JSON.stringify(sonuc).slice(0, 800));
      assert.equal(sonuc.hosts.length, 1);
      const h = sonuc.hosts[0];
      assert.equal(h.status, 'ok', h.error);
      assert.deepEqual(
        h.files.map((f) => goreli(kok, f.path)).sort(),
        [...TARANACAK].sort(),
        'bulunan dosyalar beklenenden farkli',
      );
      // Portal eski AWX kopyasini bu alanin yoklugundan anlar.
      assert.equal(sonuc.log_dir_regex, 'logs?[0-9]*');
      assert.equal(h.log_dir_regex, 'logs?[0-9]*');
      // Dosya kayitlari portalin kullandigi alanlari tasir.
      assert.ok(
        h.files.every((f) => Number(f.size) > 0 && Number(f.mtime) > 0),
        'size/mtime eksik',
      );
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG1b gercek kesif: uygulama hostta yok + koklerden biri hostta yok -> "ok + 0 dosya" (hata degil)',
  { skip: ANSIBLE_YOK },
  () => {
    const kok = agacKur();
    try {
      // JBoss7 hostunda /vhosting8, JBoss8 hostunda /vhosting yoktur: find onu `skipped_paths`e
      // "is not a directory" diye yazar. Bu metin modulun kendisinden gelir; surumle degisirse
      // TUM hostlar `error` gorunur - render testi bunu goremez, bu test gorur.
      const { rc, sonuc, cikti } = kostur(
        KESIF,
        {
          app_name: 'HICYOK',
          target_hosts: 'localhost',
          legacy_log_roots: [path.join(kok, 'vhosting8'), path.join(kok, 'olmayan-kok')],
        },
        kok,
      );
      assert.equal(rc, 0, cikti.slice(-2000));
      assert.equal(sonuc.hosts[0].status, 'ok', sonuc.hosts[0].error);
      assert.equal(sonuc.hosts[0].error, '');
      assert.deepEqual(sonuc.hosts[0].files, []);
      assert.equal(sonuc.overall_status, 'success');
      assert.equal(sonuc.log_dir_regex, 'logs?[0-9]*');
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG3 gercek kesif: okunamayan log dizini "dosya yok" DEGIL -> error, yol adiyla; kismi liste sunulmaz',
  { skip: ANSIBLE_YOK || (ROOT && 'root her dizini okur') },
  () => {
    const kok = agacKur();
    const kilitli = path.join(kok, EAR, 'log1');
    try {
      fs.chmodSync(kilitli, 0o000);
      const { rc, sonuc } = kostur(
        KESIF,
        {
          app_name: 'APPX',
          target_hosts: 'localhost',
          legacy_log_roots: [path.join(kok, 'vhosting8')],
        },
        kok,
      );
      const h = sonuc.hosts[0];
      assert.equal(h.status, 'error', JSON.stringify(h).slice(0, 600));
      assert.match(h.error, /okunamayan \d+ yol/);
      assert.ok(h.error.includes(kilitli), `hata okunamayan yolu adlandirmiyor: ${h.error}`);
      // Okunabilen dizinlerdeki dosyalar da gosterilmez: kismi liste "tam" diye sunulmaz.
      assert.deepEqual(h.files, []);
      assert.equal(sonuc.overall_status, 'failed');
      // Is BASARISIZ biter ama sonuc yine yayinlanmistir (yukarida okundu): portal sebebi gosterir.
      assert.notEqual(rc, 0);
    } finally {
      fs.chmodSync(kilitli, 0o755);
      temizle(kok);
    }
  },
);

test(
  'LG2 gercek kesif -> aktarim: numarali dizinlerdeki loglar ZIP`e girer; ayni adli dosyalar ezilmez',
  { skip: ARSIV_YOK },
  () => {
    const kok = agacKur();
    try {
      const kesif = kostur(
        KESIF,
        {
          app_name: 'APPX',
          target_hosts: 'localhost',
          legacy_log_roots: [path.join(kok, 'vhosting8')],
        },
        kok,
      ).sonuc;
      // Kullanicinin sececegi: YALNIZCA numarali dizinlerdeki dosyalar (eski playbook bunlari
      // hic listelemezdi).
      const secilen = kesif.hosts[0].files
        .map((f) => f.path)
        .filter((p) => /\/logs?[0-9]+\//.test(p));
      const beklenen = TARANACAK.filter((f) => f.startsWith(EAR) && /\/logs?[0-9]+\//.test(f));
      assert.deepEqual(secilen.map((p) => goreli(kok, p)).sort(), [...beklenen].sort());
      assert.equal(beklenen.length, 6);

      const staging = path.join(kok, 'staging');
      const dump = path.join(kok, 'dump', 'logx-lg2');
      fs.mkdirSync(staging);
      fs.mkdirSync(path.join(kok, 'dump'));
      const { rc, sonuc, cikti } = kostur(
        AKTARIM,
        {
          selected_files: secilen.map((p) => ({ host: 'localhost', path: p })),
          staging_dir: staging,
          fallback_dir: path.join(kok, 'fallback'),
          archive_name: 'lg2-numarali.zip',
          was_tmp_dir: dump,
        },
        kok,
      );
      assert.equal(rc, 0, cikti.slice(-2500));
      assert.equal(sonuc.overall_status, 'success', JSON.stringify(sonuc).slice(0, 800));
      const zip = path.join(staging, 'lg2-numarali.zip');
      assert.ok(fs.existsSync(zip), `arsiv teslim dizininde yok: ${cikti.slice(-1500)}`);
      assert.equal(sonuc.staged_path, zip);
      assert.equal(sonuc.is_fallback, false);

      // ZIP'in icinde gercekten o dosyalar var; log1/server.log ile log2/server.log AYRI
      // girdiler ve her biri KENDI icerigini tasiyor.
      const arsiv = zipOku(zip);
      assert.equal(Object.keys(arsiv).length, beklenen.length, Object.keys(arsiv).join(', '));
      for (const f of beklenen) {
        const son = f.slice(EAR.length + 1);
        const ad = Object.keys(arsiv).find((a) => a === son || a.endsWith(`/${son}`));
        assert.ok(ad, `${son} arsivde yok: ${Object.keys(arsiv)}`);
        assert.equal(arsiv[ad], icerik(f), `${son} baska bir dosyanin icerigini tasiyor`);
      }
      // Okuma kullanicisinin gecici dizini geride kalmaz (uretimde dumpdir dolmasin).
      assert.ok(!fs.existsSync(dump), 'gecici dizin temizlenmedi');
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG4 gercek aktarim (iki host): host basina parcalar tek arsivde birlesir, gecici dizinler temizlenir',
  { skip: ARSIV_YOK },
  () => {
    const kok = agacKur();
    try {
      const staging = path.join(kok, 'staging');
      fs.mkdirSync(staging);
      const tam = (f) => path.join(kok, f);
      const { rc, sonuc, cikti } = kostur(
        AKTARIM,
        {
          selected_files: [
            { host: 'sunucu-a', path: tam(`${EAR}/log1/server.log`) },
            { host: 'sunucu-a', path: tam(`${EAR}/logs10/e.log`) },
            { host: 'sunucu-b', path: tam(`${EAR}/log2/server.log`) },
          ],
          staging_dir: staging,
          fallback_dir: path.join(kok, 'fallback'),
          archive_name: 'lg4-iki-host.zip',
          // Iki "host" da bu makine: gecici dizinler cakismasin diye host adiyla ayrilir
          // (uretimde her hostun kendi dosya sistemi vardir).
          was_tmp_dir: path.join(kok, 'dump', '{{ inventory_hostname }}', 'logx-lg4'),
        },
        kok,
        'sunucu-a,sunucu-b,',
      );
      assert.equal(rc, 0, cikti.slice(-2500));
      assert.equal(sonuc.overall_status, 'success', JSON.stringify(sonuc).slice(0, 800));
      assert.deepEqual(sonuc.hosts.map((h) => `${h.host}:${h.status}`).sort(), [
        'SUNUCU-A:ok',
        'SUNUCU-B:ok',
      ]);
      const zip = path.join(staging, 'lg4-iki-host.zip');
      assert.equal(sonuc.staged_path, zip);
      const arsiv = zipOku(zip);
      assert.deepEqual(Object.keys(arsiv).sort(), ['sunucu-a.zip', 'sunucu-b.zip']);
      const a = arsiv['sunucu-a.zip'];
      assert.equal(Object.keys(a).length, 2, Object.keys(a).join(', '));
      assert.ok(Object.values(a).includes(icerik(`${EAR}/log1/server.log`)));
      assert.ok(Object.values(a).includes(icerik(`${EAR}/logs10/e.log`)));
      // Ayni adli dosya (server.log) iki hosttan da geldi; her parca KENDI hostununkini tasir.
      assert.deepEqual(Object.values(arsiv['sunucu-b.zip']), [icerik(`${EAR}/log2/server.log`)]);
      // Parca dizini ve okuma kullanicisinin gecici dizinleri geride kalmaz.
      assert.deepEqual(fs.readdirSync(staging), ['lg4-iki-host.zip']);
      for (const h of ['sunucu-a', 'sunucu-b'])
        assert.ok(
          !fs.existsSync(path.join(kok, 'dump', h, 'logx-lg4')),
          `${h}: gecici dizin kaldi`,
        );
    } finally {
      temizle(kok);
    }
  },
);

// ── LG5: PORTAL EKRANININ OKUDUGU BICIMLER ────────────────────────────────────────────────
// Basarisizlik ekrani ve "arsiv eksik" uyarisi playbook'un yayinladigi alanlari okur:
// hosts[].status / error, per_file_status[].status / error, ust duzey error. O ekranin
// testleri (src/components/logx_v2/__tests__/LegacySebepler.test.tsx) asagidaki ORNEK DOSYASINI
// girdi olarak kullanir. Burada her ornek GERCEK playbook ciktisiyla karsilastirilir: playbook
// bicimi degistirirse bu test kizarir; ekran testleri eski bicimle yesil KALAMAZ.
//
// Ornekleri yeniden uretmek icin:  LOGX_ORNEK_YAZ=1 node --test <bu dosya>
const ORNEK_DOSYASI = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'components',
  'logx_v2',
  '__tests__',
  'fixtures',
  'legacy-sonuc-ornekleri.json',
);
const ORNEK_YAZ = process.env.LOGX_ORNEK_YAZ === '1';
const ornekleriOku = () =>
  fs.existsSync(ORNEK_DOSYASI) ? JSON.parse(fs.readFileSync(ORNEK_DOSYASI, 'utf8')) : {};

/** Makineye ozgu degerleri sabitler: gecici kok -> '', arsiv boyutu -> 1, host sirasi -> ada gore. */
function ornekle(kok, sonuc) {
  const o = JSON.parse(JSON.stringify(sonuc).split(kok).join(''), (k, v) =>
    k === 'size_bytes' && Number(v) > 0 ? 1 : v,
  );
  if (Array.isArray(o.hosts))
    o.hosts.sort((a, b) => String(a.host).localeCompare(String(b.host), 'en'));
  return o;
}

const aktarimVars = (kok, secili) => ({
  selected_files: secili.map(([host, f]) => ({ host, path: path.join(kok, f) })),
  staging_dir: path.join(kok, 'staging'),
  fallback_dir: path.join(kok, 'fallback'),
  archive_name: 'ornek.zip',
  was_tmp_dir: path.join(kok, 'dump', '{{ inventory_hostname }}', 'logx-ornek'),
});
const IKI_HOST = 'sunucu-a,sunucu-b,';
const YOK = `${EAR}/log9/yok.log`;
const ROOT_ATLA = ROOT && 'root her dosyayi okur';

const ORNEKLER = [
  {
    ad: 'aktarim_tek_kismi',
    ne: 'tek host: bir dosya arsive girdi, biri yerinde yok, biri okunamiyor',
    skip: ARSIV_YOK || ROOT_ATLA,
    playbook: AKTARIM,
    kur(kok) {
      fs.chmodSync(path.join(kok, EAR, 'log2', 'server.log'), 0o000);
      return aktarimVars(kok, [
        ['localhost', `${EAR}/log1/server.log`],
        ['localhost', YOK],
        ['localhost', `${EAR}/log2/server.log`],
      ]);
    },
  },
  {
    ad: 'aktarim_tek_basarisiz',
    ne: 'tek host: secilen dosyalarin hicbiri yerinde degil',
    skip: ARSIV_YOK,
    playbook: AKTARIM,
    kur: (kok) => aktarimVars(kok, [['localhost', YOK]]),
  },
  {
    ad: 'aktarim_cok_kismi',
    ne: 'iki host: birinin dosyasi arsive girdi, otekinin dosyasi yerinde yok',
    skip: ARSIV_YOK,
    playbook: AKTARIM,
    envanter: IKI_HOST,
    kur: (kok) =>
      aktarimVars(kok, [
        ['sunucu-a', `${EAR}/log1/server.log`],
        ['sunucu-b', YOK],
      ]),
  },
  {
    ad: 'aktarim_cok_basarisiz',
    ne: 'iki host: hicbirinden dosya alinamadi',
    skip: ARSIV_YOK,
    playbook: AKTARIM,
    envanter: IKI_HOST,
    kur: (kok) =>
      aktarimVars(kok, [
        ['sunucu-a', YOK],
        ['sunucu-b', `${EAR}/log8/yok.log`],
      ]),
  },
  {
    ad: 'kesif_envanterde_yok',
    ne: 'kesif: hedef sunucu adi AWX envanterinde yok (elle yanlis yazilan ad)',
    skip: ANSIBLE_YOK,
    playbook: KESIF,
    kur: (kok) => ({
      app_name: 'APPX',
      target_hosts: 'OLMAYAN-SUNUCU',
      legacy_log_roots: [path.join(kok, 'vhosting8')],
    }),
  },
  {
    ad: 'kesif_okunamayan',
    ne: 'kesif: kok altinda okunamayan dizin',
    skip: ANSIBLE_YOK || ROOT_ATLA,
    playbook: KESIF,
    kur(kok) {
      fs.chmodSync(path.join(kok, EAR, 'log1'), 0o000);
      return {
        app_name: 'APPX',
        target_hosts: 'localhost',
        legacy_log_roots: [path.join(kok, 'vhosting8')],
      };
    },
  },
];

for (const o of ORNEKLER) {
  test(
    `LG5 ekranin okudugu bicim GERCEK ciktiyla ayni: ${o.ad} (${o.ne})`,
    { skip: o.skip },
    () => {
      const kok = agacKur();
      try {
        fs.mkdirSync(path.join(kok, 'staging'));
        const { rc, sonuc } = kostur(o.playbook, o.kur(kok), kok, o.envanter);
        const gercek = { is_basarili: rc === 0, sonuc: ornekle(kok, sonuc) };
        if (ORNEK_YAZ) {
          const hepsi = ornekleriOku();
          hepsi._aciklama =
            'GERCEK playbook ciktilari (gecici kok dizin silinmis, arsiv boyutu 1). ELLE DUZENLENMEZ. ' +
            'Yeniden uretmek icin: LOGX_ORNEK_YAZ=1 node --test server/ansible/__tests__/logx-legacy-gercek-kosum.test.cjs';
          hepsi[o.ad] = { ne: o.ne, ...gercek };
          fs.writeFileSync(ORNEK_DOSYASI, `${JSON.stringify(hepsi, null, 2)}\n`);
          return;
        }
        const ornek = ornekleriOku()[o.ad];
        assert.ok(ornek, `${o.ad} ornek dosyasinda yok: ${ORNEK_DOSYASI}`);
        assert.deepEqual(
          gercek,
          { is_basarili: ornek.is_basarili, sonuc: ornek.sonuc },
          `${o.ad}: playbook ciktisi ornekten FARKLI. Bicim bilerek degistiyse ornegi yeniden uretin ` +
            '(LOGX_ORNEK_YAZ=1) ve ekranin yeni bicimi okudugunu dogrulayin.',
        );
      } finally {
        spawnSync('chmod', ['-R', 'u+rwx', kok]);
        temizle(kok);
      }
    },
  );
}

test('LG5b ornek dosyasinda sahipsiz ornek yok (her ornek gercek kosumla karsilastiriliyor)', () => {
  const adlar = Object.keys(ornekleriOku()).filter((k) => !k.startsWith('_'));
  assert.deepEqual(adlar.sort(), ORNEKLER.map((o) => o.ad).sort());
});
