// server/__tests__/preflight.test.cjs — DEVREYE ALMA ON KONTROLU.
//
// NEDEN VAR: bu depoda merge edilen bir PR TEK BASINA yururluge girmiyor. Iki paket
// AWX'e ELLE kopyalaniyor (`scalex_app/`, `ocp_telnet_control.yml`). Kopyalama
// unutuldugunda belirti hep AYNI ve HEP GEC: ekran "paket surumu uyusmuyor" der ya
// da playbook eski davranisi surdurur ve kimse sebebini aramaz.
//
// Betigin KENDISI de sessizce korelebilir — bu dosya onu engeller.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

// Betigi GERCEKTEN calistirir (kaynak taramakla yetinmez) ve ciktisini doner.
//
// KOPYADAKI BETIK CALISTIRILIR, orijinal degil: `preflight.cjs` kok dizini
// `__dirname`den turetiyor, yani `cwd` degistirmek HICBIR SEY degistirmez —
// ilk surumde bes mutasyon testi tam olarak bu yuzden yesil kaldi.
function run(root = ROOT) {
  const script = path.join(root, 'scripts', 'preflight.cjs');
  try {
    return { code: 0, out: execFileSync('node', [script], { cwd: root, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status ?? 1, out: String(err.stdout || '') + String(err.stderr || '') };
  }
}

// Depoyu gecici bir kopyaya alip bozarak sinar — CALISMA AGACINA DOKUNMAZ.
function withBrokenCopy(mutate, fn) {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'preflight-'));
  for (const rel of [
    'package.json',
    'Jenkinsfile',
    '.env.example',
    'scripts/check-ascii.cjs',
    'scripts/preflight.cjs',
    'server/scalex/result.cjs',
    'server/ansible/bmw_portal/scalex/scalex_app/VERSION',
    'server/ansible/bmw_portal/scalex/scalex_app/PACKAGE_MANIFEST',
    'server/ansible/bmw_portal/scalex/scalex_app/files/scalex_runner.sh',
    'server/log.cjs',
  ]) {
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
  }
  try {
    mutate(tmp);
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('PF1 temiz depoda GECER (exit 0)', () => {
  const r = run();
  assert.equal(r.code, 0, `preflight temiz depoda dusuyor:\n${r.out}`);
  assert.match(r.out, /DEVREYE ALMA ON KONTROLU/);
});

test('PF2 ELLE adimlar HER ZAMAN raporlanir (sessizce varsayilmaz)', () => {
  // Portal AWX'teki kopyayi goremez. Hicbir sey yazmamak, kopyalamanin yapildigini
  // VARSAYMAK olurdu — bu betigin var olus sebebi tam da bu varsayimi kirmak.
  const r = run();
  assert.match(r.out, /scalex_app/, 'ScaleX paketi elle adimlarda yok');
  assert.match(r.out, /ocp_telnet_control\.yml/, 'telnet playbook elle adimlarda yok');
  assert.match(r.out, /elle dogrulanacak/, 'ozet satirinda elle adim sayisi yok');
});

test('PF3 ELLE adimlar cikis kodunu DUSURMEZ (CI makinesinde AWX yok)', () => {
  // Aksi halde her yapida kirmizi olurdu ve betik ilk firsatta devre disi birakilirdi
  // — `lint:ascii` kapisinin basina gelenin aynisi.
  const r = run();
  assert.equal(r.code, 0);
  assert.match(r.out, /Cikis kodunu DUSURMEZLER/);
});

test('PF4 surum ucluSU ayrisirsa DUSER', () => {
  const r = withBrokenCopy(
    (tmp) =>
      fs.writeFileSync(
        path.join(tmp, 'server/ansible/bmw_portal/scalex/scalex_app/VERSION'),
        '4\n',
      ),
    (tmp) => run(tmp),
  );
  assert.equal(r.code, 1, 'surum ayrismasi yakalanmadi');
  assert.match(r.out, /surum ucluSU AYRISMIS/);
});

test('PF5 runner ozeti manifest ile uyusmazsa DUSER', () => {
  const r = withBrokenCopy(
    (tmp) => {
      const f = path.join(
        tmp,
        'server/ansible/bmw_portal/scalex/scalex_app/files/scalex_runner.sh',
      );
      fs.appendFileSync(f, '\n# degistirildi\n');
    },
    (tmp) => run(tmp),
  );
  assert.equal(r.code, 1, 'ozet uyusmazligi yakalanmadi');
  assert.match(r.out, /ozeti MANIFEST ile uyusmuyor/);
});

test('PF6 `.env.example` eksik degisken tasiyorsa DUSER', () => {
  const r = withBrokenCopy(
    (tmp) => {
      const f = path.join(tmp, '.env.example');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^LOG_KEEP=$/m, ''));
    },
    (tmp) => run(tmp),
  );
  assert.equal(r.code, 1, 'belgelenmemis env degiskeni yakalanmadi');
  assert.match(r.out, /LOG_KEEP/);
});

test('PF7 CI adimi silinirse DUSER', () => {
  const r = withBrokenCopy(
    (tmp) => {
      const f = path.join(tmp, 'Jenkinsfile');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\s*sh 'npm run test:ui'\n/, '\n'));
    },
    (tmp) => run(tmp),
  );
  assert.equal(r.code, 1, 'eksik CI adimi yakalanmadi');
  assert.match(r.out, /CI adimi EKSIK: npm run test:ui/);
});

test('PF8 `lint:ascii` kapisi acilirsa DUSER', () => {
  const r = withBrokenCopy(
    (tmp) => {
      const f = path.join(tmp, 'scripts/check-ascii.cjs');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n\s*process\.exit\(1\);/, ''));
    },
    (tmp) => run(tmp),
  );
  assert.equal(r.code, 1, 'acilan kapi yakalanmadi');
  assert.match(r.out, /lint:ascii kapisi ACIK/);
});

test('PF9 CI ve npm scripti olarak BAGLI (yazilip cagrilmayan betik olmasin)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.preflight, '`npm run preflight` tanimli degil');
  const jenkins = fs
    .readFileSync(path.join(ROOT, 'Jenkinsfile'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  assert.match(jenkins, /npm run preflight\b/, 'Jenkinsfile preflight calistirmiyor');
});

test('PF10 runbook var ve elle adimlari ANLATIYOR', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'DEVREYE-ALMA.md'), 'utf8');
  assert.match(doc, /npm run preflight/, 'runbook tek komutu yazmiyor');
  assert.match(doc, /scalex_app/, 'ScaleX kopyalama adimi yok');
  assert.match(doc, /ocp_telnet_control\.yml/, 'telnet kopyalama adimi yok');
  // Belirti → sebep tablosu: devreye aldiktan SONRA ne izlenecegi.
  assert.match(doc, /Belirti/, 'devreye alma sonrasi izleme bolumu yok');
});
