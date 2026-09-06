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
  const APP = 'server/ansible/scalex_file/scalex_app';
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
      `"${scalexVersion}" olmali. Degilse server/ansible/scalex_file/scalex_app/ ` +
      'klasorunu oldugu gibi kopyalayin. (Uyusmazlikta ekran tahmin etmez, soyler.)',
  );
  warn(
    'AWX kopyasi ELLE dogrulanmali: ocp_telnet_control.yml',
    'Repo kopyasi REFERANS; portal onu calistirmaz.',
    'server/ansible/playbooks/ocp_telnet_control.yml icerigini AWX projesindeki ' +
      'bmw_openshift_jobs/ocp_telnet_control.yml dosyasina kopyalayin. ' +
      'Kopyalanmazsa "pod hazir degil" durumu yine KAPALI olarak raporlanir.',
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
checkEnvExample();
checkPlaybookRegistry();
checkGates();
process.exit(report());
