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
// GECICI ALAN (2026-10-13; saha: bir sunucuda /vhosting8/dumpdir DOSYAYA donusmus, log
// alinamamis). Okuma kullanicisinin ZIP'i yazdigi ara dizin artik sirali bir aday listesinden
// secilir. Render testi (X11) stat ve df sonuclarini TAKLIT eder; buradakiler gercek dosya
// sisteminde kosar:
//   LG6  ilk aday DOSYA (sahadaki olay) -> is DUSMEZ, siradaki adayla tamamlanir; bozuk yola
//        dokunulmaz
//   LG7  teslim dizini ilk adaysa o kullanilir; is bitince teslimde YALNIZ nihai ZIP kalir
//   LG8  bos alan butcesi: gercek `df -Pk` ciktisi okunur; butceyi asan aday elenir
//   LG9  olmayan `logx-tmp` adayi acilir (0711), ise ozel dizin temizlenir, ust dizin kalir
//   LG10 hicbir aday uygun degil -> failed; her adayin sebebi yazilir, genel metin YOK
//   LG11 on kontrolu gecen adayda dizin acilamazsa siradaki BIR KEZ denenir; ikisi de duserse
//        iki sebep birden yazilir
//   LG12 disaridan verilen aday listesinde goreli / kok yol -> hicbir sunucuya dokunmadan durur
//   (iki sunucunun AYNI adayi paylasmasi: LG4)
//
// KOSUL: PATH'te ansible-playbook (LG2/LG4/LG5 icin ayrica community.general.archive). Yoksa testler
// ATLANIR (ayni sozlesme: scalex-sure-kirilimi O2a/O2b; CI'da Ansible'in kurulu olmasini
// scalex-verify-timing VT0 zorlar). Windows'ta ansible calismaz.
// Uretimden farklar bilerek: yerel baglanti, `ansible_become=false` (dzdo/was gecisi yok),
// kokler gecici dizine cevrilir (`legacy_log_roots`), aktarimda aday listesi
// (`logx_legacy_tmp_bases`) gecici dizine cevrilir. Tek kullaniciyla kosuldugu icin "okuma
// kullanicisi yazamiyor ama baglanan yazabiliyor" (0733) yolu burada OLCULEMEZ -> X11 + kanarya.
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

/**
 * Gercek ansible-playbook; sonuc: set_stats ile yayinlanan logx_result.
 * `sonucsuz`: playbook'un sonuc YAYINLAMADAN dusmesi beklenen kosular (girdi dogrulamasi).
 * `ayrintili`: gorev sonuclari da yazilir (-v); `cikti`da modullerin dondurdugu yollar okunur.
 */
function kostur(
  playbook,
  vars,
  tmp,
  envanter = 'localhost,',
  { sonucsuz = false, ayrintili = false } = {},
) {
  const vf = path.join(tmp, `vars-${path.basename(playbook)}.json`);
  fs.writeFileSync(vf, JSON.stringify({ ansible_become: false, ...vars }));
  const r = spawnSync(
    'ansible-playbook',
    ['-i', envanter, '-c', 'local', playbook, '-e', `@${vf}`, ...(ayrintili ? ['-v'] : [])],
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
  if (sonucsuz && !satir) return { rc: r.status, sonuc: null, cikti };
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
      const dump = path.join(kok, 'dump');
      fs.mkdirSync(staging);
      fs.mkdirSync(dump);
      const { rc, sonuc, cikti } = kostur(
        AKTARIM,
        {
          selected_files: secilen.map((p) => ({ host: 'localhost', path: p })),
          staging_dir: staging,
          fallback_dir: path.join(kok, 'fallback'),
          archive_name: 'lg2-numarali.zip',
          logx_legacy_tmp_bases: [{ dir: dump }],
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
      // Okuma kullanicisinin ise ozel dizini geride kalmaz (aday dizin dolmasin); adayin
      // kendisi yerinde durur.
      assert.equal(sonuc.tmp_dir, dump);
      assert.deepEqual(fs.readdirSync(dump), [], 'gecici dizin temizlenmedi');
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
          // Iki "host" da bu makine ve AYNI adayi kullaniyor: teslim dizini uretimde boyle
          // paylasimlidir.
          logx_legacy_tmp_bases: [{ dir: staging, tur: 'teslim' }],
        },
        kok,
        'sunucu-a,sunucu-b,',
        { ayrintili: true },
      );
      assert.equal(rc, 0, cikti.slice(-2500));
      // Her sunucu KENDI dizinini acar (modulun dondurdugu yoldan okunur). Ayni dizini
      // paylassalardi ilk biten sunucunun temizligi otekinin ZIP'ini silebilirdi; bu bir
      // YARISTIR ve her kosuda tetiklenmez - sonuca bakarak degil, yola bakarak olculur.
      for (const h of ['sunucu-a', 'sunucu-b'])
        assert.ok(
          cikti.includes(`"path": "${path.join(staging, `logx-lg4-iki-host-${h}`)}"`),
          `${h}: ise ozel dizin sunucu adini tasimiyor`,
        );
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
      // Parca dizini ve iki sunucunun ise ozel gecici dizinleri geride kalmaz: paylasimli
      // teslim dizininde YALNIZ nihai arsiv durur.
      assert.deepEqual(fs.readdirSync(staging), ['lg4-iki-host.zip']);
      for (const h of sonuc.hosts) assert.equal(h.tmp_dir, staging, h.host);
    } finally {
      temizle(kok);
    }
  },
);

// ── LG6-LG11: GECICI ALAN GERCEK DOSYA SISTEMINDE ─────────────────────────────────────────

/** Aday tablosu: {goreli yol: 'uygun/<olusturan>' | '<sebep>'}. */
const adayTablosu = (kok, sonuc) =>
  Object.fromEntries(
    sonuc.tmp_adaylar.map((a) => [
      goreli(kok, a.dir),
      a.uygun ? `uygun/${a.olusturan}` : a.sebep.split(kok).join(''),
    ]),
  );
const kip = (p) => (fs.statSync(p).mode & 0o777).toString(8);

/** Tek dosyalik aktarim; aday listesi ve arsiv adi senaryodan. */
function alanKostur(kok, adaylar, arsiv) {
  fs.mkdirSync(path.join(kok, 'staging'), { recursive: true });
  return kostur(
    AKTARIM,
    {
      selected_files: [{ host: 'localhost', path: path.join(kok, EAR, 'log1', 'server.log') }],
      staging_dir: path.join(kok, 'staging'),
      fallback_dir: path.join(kok, 'fallback'),
      archive_name: `${arsiv}.zip`,
      logx_legacy_tmp_bases: adaylar,
    },
    kok,
  );
}
const arsivTamam = (kok, arsiv) =>
  assert.deepEqual(Object.values(zipOku(path.join(kok, 'staging', `${arsiv}.zip`))), [
    icerik(`${EAR}/log1/server.log`),
  ]);

test(
  'LG6 SAHADAKI OLAY: gecici alan adayi DOSYA olmus -> is dusmez, siradaki adayla tamamlanir',
  { skip: ARSIV_YOK },
  () => {
    const kok = agacKur();
    try {
      const bozuk = path.join(kok, 'dumpdir');
      fs.writeFileSync(bozuk, 'dizin olmasi gerekirdi\n');
      // Kullanilan aday SEMBOLIK BAG: dumpdir'in baska bir diske baglandigi sunucularda da
      // "dizin degil" denmemeli (stat bagi izler).
      fs.mkdirSync(path.join(kok, 'gercek-yedek'));
      fs.symlinkSync(path.join(kok, 'gercek-yedek'), path.join(kok, 'yedek'));
      const { rc, sonuc, cikti } = alanKostur(
        kok,
        [{ dir: bozuk }, { dir: path.join(kok, 'hic-yok') }, { dir: path.join(kok, 'yedek') }],
        'lg6',
      );
      assert.equal(rc, 0, cikti.slice(-2500));
      assert.equal(sonuc.overall_status, 'success', JSON.stringify(sonuc).slice(0, 800));
      assert.equal(sonuc.error, '');
      assert.deepEqual(adayTablosu(kok, sonuc), {
        dumpdir: 'dizin degil (dosya)',
        'hic-yok': 'yok',
        yedek: 'uygun/was',
      });
      assert.equal(sonuc.tmp_dir, path.join(kok, 'yedek'));
      arsivTamam(kok, 'lg6');
      // Bozuk yola DOKUNULMAZ (silmek / dizine cevirmek sunucu sahibinin isi) ve kullanilan
      // adayda iz kalmaz.
      assert.equal(fs.readFileSync(bozuk, 'utf8'), 'dizin olmasi gerekirdi\n');
      assert.deepEqual(fs.readdirSync(path.join(kok, 'gercek-yedek')), []);
      assert.ok(fs.lstatSync(path.join(kok, 'yedek')).isSymbolicLink(), 'bag silindi');
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG7 teslim dizini ILK adaydir; is bitince teslimde yalniz nihai ZIP kalir',
  { skip: ARSIV_YOK },
  () => {
    const kok = agacKur();
    try {
      const staging = path.join(kok, 'staging');
      const yedek = path.join(kok, 'yedek');
      fs.mkdirSync(yedek);
      const { rc, sonuc, cikti } = alanKostur(
        kok,
        [{ dir: staging, tur: 'teslim' }, { dir: yedek }],
        'lg7',
      );
      assert.equal(rc, 0, cikti.slice(-2500));
      assert.equal(sonuc.overall_status, 'success');
      assert.equal(sonuc.tmp_dir, staging, 'teslim dizini uygunken baska aday kullanildi');
      assert.equal(sonuc.is_fallback, false);
      arsivTamam(kok, 'lg7');
      assert.deepEqual(fs.readdirSync(staging), ['lg7.zip'], 'teslimde gecici dizin kaldi');
      assert.deepEqual(fs.readdirSync(yedek), [], 'kullanilmayan adaya dokunuldu');
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG8 bos alan butcesi GERCEK df ciktisiyla: butceyi asan aday elenir, sigan kullanilir',
  { skip: ARSIV_YOK },
  () => {
    const kok = agacKur();
    try {
      for (const d of ['dar', 'genis']) fs.mkdirSync(path.join(kok, d));
      const { rc, sonuc, cikti } = alanKostur(
        kok,
        [
          { dir: path.join(kok, 'dar'), yuzde: 0 },
          { dir: path.join(kok, 'genis'), yuzde: 100 },
        ],
        'lg8',
      );
      assert.equal(rc, 0, cikti.slice(-2500));
      const t = adayTablosu(kok, sonuc);
      // %0: izinli alan sifir -> her is butceyi asar (kuralin kendisi, diskin doluluguna bagli degil).
      assert.match(
        t.dar,
        /^yer yetersiz: gerekli [\d.]+ MB, izinli 0\.0 MB \(bos alan [\d.]+ MB, sinir %0\)$/,
      );
      // %100: ayni dizinde df ciktisi OKUNABILDI ve birkac baytlik is sigdi. Cikti bu isletim
      // sisteminde ayristirilamasaydi sebep "bos alan olculemedi" olurdu.
      assert.equal(t.genis, 'uygun/was', `df ciktisi okunamadi mi? ${t.genis}`);
      assert.equal(sonuc.tmp_dir, path.join(kok, 'genis'));
      assert.equal(sonuc.overall_status, 'success');
      assert.deepEqual(fs.readdirSync(path.join(kok, 'dar')), [], 'elenen adaya yazildi');
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG9 olmayan logx-tmp adayi ACILIR (0711); ise ozel dizin temizlenir, sonraki is onu kullanir',
  { skip: ARSIV_YOK },
  () => {
    const kok = agacKur();
    try {
      const vh = path.join(kok, 'vh');
      fs.mkdirSync(vh);
      const adaylar = [
        { dir: path.join(kok, 'dumpdir-yok') },
        // Ust dizini de olmayan aday ACILMAZ: playbook dizin agaci uydurmaz.
        { dir: path.join(kok, 'yok', 'logx-tmp'), olustur: true },
        { dir: path.join(vh, 'logx-tmp'), olustur: true },
      ];
      const ilk = alanKostur(kok, adaylar, 'lg9a');
      assert.equal(ilk.rc, 0, ilk.cikti.slice(-2500));
      assert.deepEqual(adayTablosu(kok, ilk.sonuc), {
        'dumpdir-yok': 'yok',
        'yok/logx-tmp': 'yok; ust dizin de yok',
        'vh/logx-tmp': 'uygun/was',
      });
      assert.equal(ilk.sonuc.overall_status, 'success');
      arsivTamam(kok, 'lg9a');
      const acilan = path.join(vh, 'logx-tmp');
      // 0711: baglanan kullanici icinden gecer, kimse listeleyemez (icindeki dizin adlari
      // arsiv adini tasir).
      assert.equal(kip(acilan), '711');
      assert.deepEqual(fs.readdirSync(acilan), [], 'ise ozel dizin temizlenmedi');
      assert.ok(!fs.existsSync(path.join(kok, 'yok')), 'ust dizini olmayan aday acildi');
      // Ikinci is: dizin artik VAR -> oldugu gibi kullanilir, kipi degismez.
      const ikinci = alanKostur(kok, adaylar, 'lg9b');
      assert.equal(ikinci.sonuc.overall_status, 'success');
      assert.equal(ikinci.sonuc.tmp_dir, acilan);
      assert.equal(kip(acilan), '711');
      arsivTamam(kok, 'lg9b');
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG10 hicbir aday uygun degil -> failed; HER adayin sebebi yazilir, "ZIP olusturulamadi" DEGIL',
  { skip: ARSIV_YOK },
  () => {
    const kok = agacKur();
    try {
      fs.writeFileSync(path.join(kok, 'dumpdir'), 'dizin olmasi gerekirdi\n');
      const { sonuc } = alanKostur(
        kok,
        [{ dir: path.join(kok, 'dumpdir') }, { dir: path.join(kok, 'hic-yok') }],
        'lg10',
      );
      assert.equal(sonuc.overall_status, 'failed');
      assert.equal(
        sonuc.error,
        `Gecici alan bulunamadi. Adaylar: ${path.join(kok, 'dumpdir')}: dizin degil (dosya) | ` +
          `${path.join(kok, 'hic-yok')}: yok`,
      );
      assert.ok(!/ZIP arsivi olusturulamadi/.test(sonuc.error));
      assert.equal(sonuc.staged_path, '');
      assert.equal(sonuc.tmp_dir, '');
      // Dosyanin kendisinde sorun yok; sebep sunucu duzeyinde.
      assert.deepEqual(
        sonuc.per_file_status.map((f) => f.status),
        ['ok'],
      );
      assert.deepEqual(fs.readdirSync(path.join(kok, 'staging')), []);
      assert.ok(!fs.existsSync(path.join(kok, 'fallback')), 'arsiv yokken yedek dizin acildi');
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG11 on kontrolu gecen adaya YAZILAMAZSA siradaki bir kez denenir; ikisi de duserse iki sebep',
  { skip: ARSIV_YOK },
  () => {
    // Ise ozel dizinin yerinde bir dosya: aday dizin yazilabilir gorunur (on kontrol gecer)
    // ama dizin acilamaz. Uretimdeki karsiligi: kota, salt-okunur baglama, araya giren dolu disk.
    const engelle = (kok, aday, arsiv) =>
      fs.writeFileSync(path.join(kok, aday, `logx-${arsiv}-localhost`), 'engel\n');
    const kok = agacKur();
    try {
      for (const d of ['a', 'b', 'c']) fs.mkdirSync(path.join(kok, d));
      const adaylar = ['a', 'b', 'c'].map((d) => ({ dir: path.join(kok, d) }));

      engelle(kok, 'a', 'lg11a');
      const bir = alanKostur(kok, adaylar, 'lg11a');
      assert.equal(bir.rc, 0, bir.cikti.slice(-2500));
      assert.equal(bir.sonuc.overall_status, 'success', JSON.stringify(bir.sonuc).slice(0, 800));
      assert.equal(bir.sonuc.tmp_dir, path.join(kok, 'b'), 'ikinci deneme siradaki adayda degil');
      assert.equal(bir.sonuc.error, '');
      arsivTamam(kok, 'lg11a');
      for (const d of ['a', 'b', 'c'])
        assert.deepEqual(fs.readdirSync(path.join(kok, d)), [], `${d}: iz kaldi`);

      engelle(kok, 'a', 'lg11b');
      engelle(kok, 'b', 'lg11b');
      const iki = alanKostur(kok, adaylar, 'lg11b');
      assert.equal(iki.sonuc.overall_status, 'failed');
      assert.match(
        iki.sonuc.error,
        /^Loglar was kullanicisiyla ziplenemedi\. 1\. deneme \(\S+\/a\): \S.* \| 2\. deneme \(\S+\/b\): \S/,
      );
      assert.ok(!/ZIP arsivi olusturulamadi/.test(iki.sonuc.error));
      // Karar "bir kez": ucuncu uygun aday vardi ama denenmedi.
      assert.equal(adayTablosu(kok, iki.sonuc).c, 'uygun/was');
      assert.ok(!fs.existsSync(path.join(kok, 'staging', 'lg11b.zip')));
      assert.deepEqual(fs.readdirSync(path.join(kok, 'c')), []);
    } finally {
      temizle(kok);
    }
  },
);

test(
  'LG12 disaridan verilen aday listesi DOGRULANIR: goreli ya da kok yol -> hicbir sey yapilmadan durur',
  { skip: ARSIV_YOK },
  () => {
    // Liste AWX is sablonundan verilebilir. Ise ozel dizin `<aday>/logx-...` olarak kurulur ve
    // is sonunda SILINIR: goreli bir yol uzak kullanicinin calisma dizinine, "/" ise dosya
    // sisteminin kokune yazmak demektir. Ikisi de ilk play'de reddedilir.
    const kok = agacKur();
    try {
      fs.mkdirSync(path.join(kok, 'staging'));
      for (const kotu of [{ dir: 'goreli/dizin' }, { dir: '/' }, { yol: '/tmp' }, 'duz-metin']) {
        const { rc, sonuc, cikti } = kostur(
          AKTARIM,
          {
            selected_files: [
              { host: 'localhost', path: path.join(kok, EAR, 'log1', 'server.log') },
            ],
            staging_dir: path.join(kok, 'staging'),
            fallback_dir: path.join(kok, 'fallback'),
            archive_name: 'lg12.zip',
            logx_legacy_tmp_bases: [{ dir: path.join(kok, 'staging') }, kotu],
          },
          kok,
          'localhost,',
          { sonucsuz: true },
        );
        const ad = JSON.stringify(kotu);
        assert.notEqual(rc, 0, `${ad}: gecersiz aday kabul edildi`);
        assert.equal(sonuc, null, `${ad}: gecersiz listeyle is yurudu`);
        assert.match(cikti, /Gecersiz logx_legacy_tmp_bases kaydi/, ad);
        assert.deepEqual(
          fs.readdirSync(path.join(kok, 'staging')),
          [],
          `${ad}: dosya sistemine dokunuldu`,
        );
      }
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

/**
 * Makineye ozgu degerleri sabitler: gecici kok -> '', arsiv boyutu -> 1 / 0, host sirasi -> ada gore.
 * Boyut SAYIYA cevrilir: ansible-core 2.19 oncesi (yerel tipsiz Jinja) ayni alani metin ("0")
 * olarak yayinlar; ornek dosyasi Ansible surumune gore degismesin.
 */
function ornekle(kok, sonuc) {
  const o = JSON.parse(JSON.stringify(sonuc).split(kok).join(''), (k, v) =>
    k === 'size_bytes' ? (Number(v) > 0 ? 1 : 0) : v,
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
  logx_legacy_tmp_bases: [{ dir: path.join(kok, 'dump') }],
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
    ad: 'aktarim_tek_gecici_alan_yok',
    ne: 'tek host: dosyalar yerinde ama sunucuda kullanilabilir gecici alan yok (biri dosya olmus, biri yok)',
    skip: ARSIV_YOK,
    playbook: AKTARIM,
    kur(kok) {
      fs.writeFileSync(path.join(kok, 'dumpdir'), 'dizin olmasi gerekirdi\n');
      return {
        ...aktarimVars(kok, [['localhost', `${EAR}/log1/server.log`]]),
        logx_legacy_tmp_bases: [
          { dir: path.join(kok, 'dumpdir') },
          { dir: path.join(kok, 'olmayan-dizin') },
        ],
      };
    },
  },
  {
    ad: 'aktarim_tek_ziplenemedi',
    ne: 'tek host: iki aday da on kontrolu gecti ama ikisine de yazilamadi (iki deneme)',
    skip: ARSIV_YOK,
    playbook: AKTARIM,
    kur(kok) {
      // Ise ozel dizinin yerinde bir DOSYA var: on kontrol (aday dizin yazilabilir) gecer,
      // dizin acma duser. Uretimdeki karsiligi: kota, salt-okunur baglama, dolu disk.
      for (const d of ['dump', 'dump2']) {
        fs.mkdirSync(path.join(kok, d), { recursive: true });
        fs.writeFileSync(path.join(kok, d, 'logx-ornek-localhost'), 'engel\n');
      }
      return {
        ...aktarimVars(kok, [['localhost', `${EAR}/log1/server.log`]]),
        logx_legacy_tmp_bases: [{ dir: path.join(kok, 'dump') }, { dir: path.join(kok, 'dump2') }],
      };
    },
  },
  {
    ad: 'aktarim_cok_gecici_alan_yok',
    ne: 'iki host: birinin dosyasi arsive girdi, otekinde gecici alan yok',
    skip: ARSIV_YOK,
    playbook: AKTARIM,
    envanter: IKI_HOST,
    kur(kok) {
      // Aday yolu sunucu adini tasir; yalniz sunucu-a'ninki var.
      fs.mkdirSync(path.join(kok, 'alan-sunucu-a'));
      return {
        ...aktarimVars(kok, [
          ['sunucu-a', `${EAR}/log1/server.log`],
          ['sunucu-b', `${EAR}/log2/server.log`],
        ]),
        logx_legacy_tmp_bases: [{ dir: path.join(kok, 'alan-{{ inventory_hostname }}') }],
      };
    },
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
        fs.mkdirSync(path.join(kok, 'dump'));
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
