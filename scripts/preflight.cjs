#!/usr/bin/env node
// scripts/preflight.cjs — DEVREYE ALMA ON KONTROLU.
//
// NEDEN VAR: bu depoda merge edilen bir PR TEK BASINA yururluge girmiyor. Iki paket
// AWX'e ELLE kopyalaniyor (`scalex_app/`, `ocp_telnet_control.yml`) ve bir kismi
// yapilandirma DB'de/`.env`de duruyor. Kopyalama unutuldugunda ortaya cikan belirti
// hep AYNI ve HEP GEC: ekran "paket surumu uyusmuyor" der, ya da playbook eski
// davranisi surdurur ve kimse sebebini aramaz.
//
// BU BETIK NE YAPAR: dagitimdan ONCE, tek komutla, neyin eksik oldugunu SOYLER.
//   - YEREL kontroller her zaman kosar (surum ucluleri, ozet, .env.example butunlugu)
//   - UZAK kontroller (DB/AWX) yalnizca erisim varsa kosar; yoksa "DOGRULANAMADI"
//     der ve elle nasil bakilacagini yazar — SESSIZCE GECMEZ.
//
// CIKIS KODU: yalnizca KESIN bir eksiklik varsa 1. "Dogrulanamadi" 1 DONDURMEZ:
// bir CI makinesinde AWX'e erisim olmamasi bir hata degildir; ama ekranda GORUNUR.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const results = [];
const ok = (title, detail) => results.push({ level: 'ok', title, detail });
const warn = (title, detail, fix) => results.push({ level: 'warn', title, detail, fix });
const fail = (title, detail, fix) => results.push({ level: 'fail', title, detail, fix });

// ── 1. ScaleX AWX paketi: surum ucluSU ve ozet ──────────────────────────────
function checkScalexPackage() {
  const APP = 'server/ansible/bmw_portal/scalex/scalex_app';
  let version, runnerVersion, expected, manifest;
  try {
    version = read(`${APP}/VERSION`).trim();
    runnerVersion = (read(`${APP}/files/scalex_runner.sh`).match(/PACKAGE_VERSION="(\d+)"/) ||
      [])[1];
    expected = (read('server/scalex/result.cjs').match(/EXPECTED_PACKAGE_VERSION = '(\d+)'/) ||
      [])[1];
    manifest = read(`${APP}/PACKAGE_MANIFEST`);
  } catch (err) {
    fail('ScaleX paketi okunamadi', err.message, 'Dosya yollari degismis olabilir.');
    return null;
  }

  const trio = [version, runnerVersion, expected];
  if (new Set(trio).size !== 1) {
    fail(
      'ScaleX surum ucluSU AYRISMIS',
      `VERSION=${version} PACKAGE_VERSION=${runnerVersion} EXPECTED=${expected}`,
      'Ucunu de ayni sayiya getirin (runner degistiyse hepsi artar).',
    );
  } else {
    ok('ScaleX surum ucluSU tutarli', `surum ${version}`);
  }

  const actualSha = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, APP, 'files/scalex_runner.sh')))
    .digest('hex');
  const declaredSha = (manifest.match(/runner_sha256=([0-9a-f]+)/) || [])[1];
  if (actualSha !== declaredSha) {
    fail(
      'ScaleX runner ozeti MANIFEST ile uyusmuyor',
      `gercek=${actualSha.slice(0, 16)}… manifest=${String(declaredSha).slice(0, 16)}…`,
      'Runner degistiyse VERSION artirin ve PACKAGE_MANIFEST ozetini yenileyin.',
    );
  } else {
    ok('ScaleX runner ozeti manifest ile ayni', actualSha.slice(0, 16) + '…');
  }
  return version;
}

// ── 2. AWX'e ELLE kopyalanmasi gereken paketler ─────────────────────────────
//
// Portalin AWX'teki kopyayi DOGRUDAN gormesinin bir yolu yok; bu yuzden burada
// KESIN bir yargi verilmez — operatore NE karsilastiracagi soylenir. "Sessizce
// gecme" kurali: hicbir sey yazmamak, kopyalamanin yapildigini varsaymak olurdu.
function checkManualCopies(scalexVersion) {
  warn(
    'AWX kopyasi ELLE dogrulanmali: scalex_app',
    `Portal paket surumu ${scalexVersion} bekliyor.`,
    'AWX projesindeki bmw_portal/scalex/scalex_app/VERSION dosyasi da ' +
      `"${scalexVersion}" olmali. Degilse server/ansible/bmw_portal/scalex/scalex_app/ ` +
      'klasorunu oldugu gibi kopyalayin. (Uyusmazlikta ekran tahmin etmez, soyler.)',
  );
  warn(
    'AWX kopyasi ELLE dogrulanmali: ocp_telnet_control.yml',
    'Repo kopyasi REFERANS; portal onu calistirmaz.',
    'server/ansible/bmw_portal/telnet_openshift/telnet_openshift.yaml icerigini AWX projesindeki ' +
      'bmw_openshift_jobs/ocp_telnet_control.yml dosyasina kopyalayin. ' +
      'Kopyalanmazsa "pod hazir degil" durumu yine KAPALI olarak raporlanir.',
  );
}

// ── 2b. OCP playbook surum damgalari ────────────────────────────────────────
//
// NEDEN VAR: `server/ansible/bmw_portal/logx/ocp/` klasoru AWX'e ELLE kopyalanir.
// Kopyalanmadiginda AWX ESKI surumu kosar ve portalda gorunen hata repodaki
// (coktan duzeltilmis) koda ait olur. 2026-09-07'de bu dongude dort tur donuldu.
//
// Damga guncelse portal, AWX'teki kopyanin bayat oldugunu KENDISI soyleyebilir;
// damga guncel degilse o yetenek SESSIZCE olur.
function checkPlaybookRevisions() {
  let rev;
  try {
    rev = require('./playbook-rev.cjs');
  } catch (e) {
    // Betik ya da bagimliliklari yoksa preflight'in KENDISI dusmemeli: bu kontrol
    // dagitimin one sartı degil, kolaylastiricisi. Ama sessizce de gecmemeli.
    warn(
      'Playbook surum damgasi DOGRULANAMADI',
      `scripts/playbook-rev.cjs okunamadi: ${e.message}`,
      '`npm run playbook:rev -- --check` ile elle bakin.',
    );
    return;
  }
  let manifest = {};
  try {
    manifest = JSON.parse(read('server/ansible/playbook-revisions.json'));
  } catch {
    fail(
      "Playbook surum damgasi manifest'i YOK",
      'server/ansible/playbook-revisions.json okunamadi.',
      '`npm run playbook:rev` calistirin.',
    );
    return;
  }

  const computed = rev.computeAll();
  const bayat = Object.keys(computed).filter((k) => manifest[k]?.hash !== computed[k].hash);
  if (bayat.length) {
    fail(
      'Playbook surum damgasi GUNCEL DEGIL',
      bayat.join(', '),
      '`npm run playbook:rev` calistirip degisikligi commit edin. Damga guncellenmezse ' +
        'portal AWX kopyasinin bayat oldugunu ANLAYAMAZ.',
    );
    return;
  }

  ok(
    'Playbook surum damgalari guncel',
    Object.entries(computed)
      .map(([k, v]) => `${k.split('/').pop()}=${v.revision}`)
      .join(', '),
  );
  warn(
    'AWX kopyasi ELLE dogrulanmali: logx/ocp/',
    'Portal, AWX isinin yayinladigi damgayi yukaridakiyle karsilastirir.',
    'server/ansible/bmw_portal/logx/ocp/ klasorunu AWX projesindeki bmw_portal/logx/ocp/ ' +
      'altina kopyalayin. Kopyalanmazsa isler kosar ama portal "AWX\'teki kopya eski" uyarisi ' +
      'gosterir — ve gosterdiginde HAKLIDIR.',
  );
}

// ── 3. `.env.example` butunlugu ─────────────────────────────────────────────
//
// Kodun okudugu bir degisken orada belgeli degilse, yeni bir kurulum onu HIC
// bilmez ve varsayilanla calisir — ki bu sessizce yanlis bir yapilandirmadir.
function checkEnvExample() {
  const example = read('.env.example');
  const prefixes = ['SCALEX_', 'LOG_'];
  const used = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(cjs|mjs)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
          if (prefixes.some((pre) => m[1].startsWith(pre))) used.add(m[1]);
        }
      }
    }
  };
  walk(path.join(ROOT, 'server'));
  const missing = [...used].filter((v) => !new RegExp(`^${v}=`, 'm').test(example)).sort();
  if (missing.length) {
    fail(
      '.env.example EKSIK degisken tasiyor',
      missing.join(', '),
      'Her birini `.env.example` icine bir aciklamayla ekleyin.',
    );
  } else {
    ok('.env.example butunlugu', `${used.size} degisken belgeli`);
  }
}

// ── 4. Playbook kayitlari: yapilandirma DB'de ───────────────────────────────
function checkPlaybookRegistry() {
  warn(
    'Playbook kayitlari ELLE dogrulanmali',
    'ScaleX/LogX/Telnet AWX sablon kimlikleri DB`de (ansible_playbook_registry) ya da .env`de tutulur.',
    'Admin > Playbook Kayitlari ekraninda su anahtarlarin template ID`si dolu olmali: ' +
      'scalex_run, scalex_discovery, logx_ocp_app_discovery, telnet_openshift_operation. ' +
      'Bos olan bir anahtar ilgili ozelligi 501 ile kapatir.',
  );
}

// ── 4b. Ortam eki haritasi: QA satiri seed'de YOK ───────────────────────────
function checkEnvSuffixMap() {
  // BILGILENDIRME AMACLI BIR KONTROL, TUM ON KONTROLU DUSURMEMELI. Ilk halinde
  // dosyayi dogrudan okuyordu ve dosya yoksa `read()` firlatip preflight'i komple
  // cokertiyordu (PF4-PF8 sahte deposunda tam olarak bu oldu). Okunamazsa
  // "yok" DEMEZ — "dogrulanamadi" der; bilmemek, yanlis iddiadan iyidir.
  let setup;
  try {
    setup = read('server/db/mssql-setup.cjs');
  } catch {
    warn(
      'Ortam eki haritasi dogrulanamadi',
      'server/db/mssql-setup.cjs okunamadi.',
      'QA ortami icin `logx_env_suffix_map` satirini Admin ekranindan elle dogrulayin.',
    );
    return;
  }
  const seed = setup.slice(
    setup.indexOf('const ENV_SUFFIX_SEED'),
    setup.indexOf('async function seedEnvSuffixMap'),
  );
  const labels = [...seed.matchAll(/env_label:\s*'([^']+)'/g)].map((m) => m[1]);
  if (labels.includes('QA')) {
    ok('Ortam eki haritasi', `seed satirlari: ${labels.join(', ')}`);
    return;
  }
  // BILEREK SEED'E EKLENMEDI. Ekin harfi (`-Q` mi baska bir sey mi) bu kurumun
  // konvansiyonuna bagli ve DOGRULANMADI. Yanlis bir ek seed'lemek, prod'da yanlis
  // ortam etiketi uretir ve sonradan elle temizlenmesi gerekir — bilmemek,
  // uydurmaktan iyidir. Kullanici Admin ekranindan dogru eki girmeli.
  warn(
    'Ortam eki haritasi: QA satiri YOK',
    `logx_env_suffix_map seed'inde yalnizca ${labels.join(', ')} var.`,
    'QA ortamindaki EAR klasorleri ortam etiketi ALMAZ (bos gorunur). Dogru son eki ' +
      'Admin > LogX Yapilandirma > Ortam Eki Haritasi ekranindan ekleyin. ' +
      "Seed'e yazilmadi cunku ekin harfi dogrulanmadi; yanlis bir deger prod'da " +
      'yanlis ortam etiketi uretirdi.',
  );
}

// ── 4c. Node surumu: hangi paketler calisan surumle uyumsuz ─────────────────
//
// OLCUM, LISTE DEGIL. Uyumsuz paketleri elle yazmak, bagimliliklar degistikce
// yalan soylemeye baslar. Burada `package-lock.json` okunur ve her paketin
// `engines.node` araligi CALISAN surumle karsilastirilir.
//
// ASIL AYRIM CALISMA ZAMANI / GELISTIRME: `vitest`, `jsdom`, `lint-staged`
// yalnizca gelistirici makinesinde kosar — uyari gurultudur. Ama `dependencies`
// agacindan gelen bir paket UYGULAMA ICINDE calisir; orada uyumsuzluk gercek
// bir risktir.
function checkNodeVersion() {
  // SURUM OVERRIDE'I BILEREK VAR. Gelistirici makinesi prod'dan farkli bir Node
  // kosuyor olabilir (burada 26, prod'da 20.20.2) — o zaman kontrol "her sey
  // uyumlu" der ve prod'daki gercek durumu HIC gostermez. Bu bayrakla prod
  // surumu sorulabilir:
  //     PREFLIGHT_NODE_VERSION=20.20.2 npm run preflight
  const running = String(process.env.PREFLIGHT_NODE_VERSION || '').trim() || process.versions.node;
  const simulated = running !== process.versions.node;
  let lock;
  try {
    lock = JSON.parse(read('package-lock.json'));
  } catch {
    warn('Node surumu dogrulanamadi', 'package-lock.json okunamadi.', 'Elle kontrol edin.');
    return;
  }

  // Calisma zamani agaci: `dependencies` ve onlarin ic ice kopyalari HARIC —
  // ic ice kopyalar (or. jsdom/node_modules/undici) yalnizca o paketin
  // dunyasinda yasar ve gelistirme bagimliligiysa uygulamaya girmez.
  const rootPkg = JSON.parse(read('package.json'));
  const runtimeNames = new Set(Object.keys(rootPkg.dependencies || {}));

  const satisfies = (version, range) => {
    try {
      return require('semver').satisfies(version, range, { includePrerelease: true });
    } catch {
      return true; // semver yoksa iddia etme
    }
  };

  const bad = [];
  for (const [key, meta] of Object.entries(lock.packages || {})) {
    const range = meta && meta.engines && meta.engines.node;
    if (!range || !key.startsWith('node_modules/')) continue;
    if (satisfies(running, range)) continue;
    const name = key.slice('node_modules/'.length);
    // Ic ice kopya: `a/node_modules/b` -> sahibi `a`.
    const nested = name.includes('/node_modules/');
    const owner = nested ? name.split('/node_modules/')[0] : name;
    bad.push({ name, range, runtime: !nested && runtimeNames.has(owner), owner });
  }

  if (bad.length === 0) {
    ok(
      'Node surumu',
      `${running}${simulated ? ' (simule)' : ''} — tum paketlerin engines araligi karsilaniyor`,
    );
    return;
  }

  // CALISMA ZAMANI agacindan gelen uyumsuzluklar: `dependencies` altindaki bir
  // paketin KENDISI ya da onun gecisli bagimliliklari.
  const runtimeBad = bad.filter((b) => b.runtime || RUNTIME_TRANSITIVE.has(b.name));
  const devBad = bad.filter((b) => !runtimeBad.includes(b));

  const lines = [];
  if (runtimeBad.length) {
    lines.push(
      'CALISMA ZAMANI: ' +
        runtimeBad.map((b) => `${b.name} (${b.range})`).join(', ') +
        ' — bunlar uygulama icinde kosuyor.',
    );
  }
  if (devBad.length) {
    lines.push(
      'Gelistirme: ' +
        devBad.map((b) => b.name).join(', ') +
        ' — yalnizca gelistirici/CI makinesinde kosar.',
    );
  }
  warn(
    `Node ${running}${simulated ? ' (simule)' : ''}: ${bad.length} paket engines araligini karsilamiyor`,
    lines.join(' | '),
    'Node 22`ye gecince bu uyarilar biter. Gecis: docs/DEVREYE-ALMA.md > "Node 22`ye gecis". ' +
      'package.json `engines` BILEREK >=20.18.0 birakildi — prod bugun kirilmasin diye.',
  );
}

// Calisma zamani agacindan gelen ama `dependencies` icinde ADI GECMEYEN paketler
// (gecisli). Elle yazilir cunku lock dosyasi sahiplik zincirini tutmuyor; liste
// KISA tutulur ve yalnizca uygulama icinde GERCEKTEN kosanlari icerir.
//
// `tedious`: MSSQL surucusu, `mssql` uzerinden gelir ve portal her DB cagrisinda
// onu kullanir. Node 22 istiyor; prod Node 20'de kosuyorsa bu listedeki TEK
// gercek uretim riski odur.
const RUNTIME_TRANSITIVE = new Set(['tedious']);

// ── 5. CI kapilari gercekten kapali mi ──────────────────────────────────────
function checkGates() {
  const check = read('scripts/check-ascii.cjs')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  if (!/process\.exit\(1\)/.test(check)) {
    fail(
      'lint:ascii kapisi ACIK',
      'Ihlal bulundugunda cikis kodu 1 donmuyor.',
      'scripts/check-ascii.cjs icinde process.exit(1) geri konmali.',
    );
  } else {
    ok('lint:ascii kapisi kapali', 'ihlalde exit 1');
  }

  const jenkins = read('Jenkinsfile')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  for (const [label, re] of [
    ['npm test', /npm test\b/],
    ['npm run test:ui', /npm run test:ui\b/],
    ['npm run lint', /npm run lint\b(?!:)/],
    ['npm run lint:ascii', /npm run lint:ascii\b/],
  ]) {
    if (re.test(jenkins)) ok(`CI adimi var: ${label}`, '');
    else
      fail(
        `CI adimi EKSIK: ${label}`,
        'Jenkinsfile bu adimi calistirmiyor.',
        'Jenkinsfile`a ekleyin.',
      );
  }
}

// ── Rapor ───────────────────────────────────────────────────────────────────
function report() {
  const icon = { ok: '  OK  ', warn: ' ELLE ', fail: ' EKSIK' };
  console.log('\n=== DEVREYE ALMA ON KONTROLU ===\n');
  for (const r of results) {
    console.log(`[${icon[r.level]}] ${r.title}`);
    if (r.detail) console.log(`          ${r.detail}`);
    if (r.fix) console.log(`          → ${r.fix}`);
  }
  const fails = results.filter((r) => r.level === 'fail').length;
  const warns = results.filter((r) => r.level === 'warn').length;
  console.log('');
  console.log(
    `Sonuc: ${results.length - fails - warns} tamam · ${warns} elle dogrulanacak · ${fails} eksik`,
  );
  if (warns) {
    console.log('');
    console.log('"ELLE" isaretliler otomatik dogrulanamaz (AWX/DB portalin disinda).');
    console.log('Cikis kodunu DUSURMEZLER ama dagitimdan once gozle bakilmalidir.');
  }
  console.log('');
  return fails === 0 ? 0 : 1;
}

const v = checkScalexPackage();
if (v) checkManualCopies(v);
checkPlaybookRevisions();
checkEnvExample();
checkPlaybookRegistry();
checkEnvSuffixMap();
checkNodeVersion();
checkGates();
process.exit(report());
