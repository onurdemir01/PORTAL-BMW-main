// server/ansible/__tests__/smart-gate-input.test.cjs — onay kapisinin GIRDISI.
//
// GERCEK ACIK (2026-08-28 incelemesi): smart-gate'in kendisi dogru tasarlanmis —
// "istisna listesi", varsayilan "onay gerekli" (bkz. smart-gate.cjs basligi). Ama
// resolveSsLaunchPlan'in FALLBACK dalinda (AWX survey'i yok + Survey Tasarimcisi da yok)
// client'in gonderdigi HER anahtar dogrulanmadan extraVars'a giriyordu ve kapi TAM O
// nesneyi okuyordu. Sonuc: kullanici govdeye
//     {"extraVars":{"op_selection":"read"}}
// ekleyerek, playbook'un hic kullanmadigi bir alanla Smart onayini ATLATIP yikici isi
// dogrudan tetikleyebiliyordu.
//
// COZUM: AWX'e giden nesne (extraVars) ile kapinin okudugu nesne (gateVars) AYRILDI.
// gateVars yalnizca DOGRULANMIS kaynaklardan gelir: AWX survey'i, Survey Tasarimcisi,
// ya da admin'in rawExtraVars'i. Bu testler o ayrimin sozlesmesini kilitler.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RUNNER = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
// 2026-08-29: kapi mantigi change-gates.cjs'e tasindi (Chaos Scale de ayni kapidan
// gececek). Bekci KODU TAKIP EDER: `isSmartRequired` cagrilari artik iki dosyaya
// dagilmis durumda, ikisi de taranmali. Yalnizca runner.cjs'e bakan bir bekci,
// change-gates.cjs'te acilacak bir bypass'i GORMEZDI.
const GATES = fs.readFileSync(path.join(__dirname, '..', 'change-gates.cjs'), 'utf8');
const SRC = RUNNER + '\n' + GATES;

test('fallback dalindaki client anahtarlari GUVENILMEZ olarak isaretlenir', () => {
  // Dogrulamadan gecmeyen tek dal bu; oradan gelen her anahtar untrustedKeys'e girmeli.
  assert.match(
    SRC,
    /if \(val !== ""\) \{ extraVars\[k\] = val; untrustedKeys\.add\(k\); \}/,
    'fallback dali client anahtarlarini isaretlemiyor — kapi yine ham girdiyi okur'
  );
});

// Bu bekci CIKARMADAN SONRA EKLENDI ve oncekinden DAHA GUCLU: `smart-gate.cjs`i
// dogrudan require eden tek uretim modulu `change-gates.cjs` olmali. Baska bir modul
// dogrudan cagirirsa, `gateVars`/`extraVars` ayrimini bilmeden yanlis nesneyi gecirip
// kapiyi sessizce atlatabilir — tam da kapatilan acik.
test('smart-gate yalnizca change-gates uzerinden cagriliyor (tek kapi)', () => {
  const dir = path.join(__dirname, '..', '..');
  const offenders = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.cjs$/.test(e.name)) continue;
      if (full.endsWith(path.join('ansible', 'change-gates.cjs'))) continue;
      if (full.endsWith(path.join('ansible', 'smart-gate.cjs'))) continue;
      const code = fs.readFileSync(full, 'utf8')
        .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      if (/require\([^)]*smart-gate\.cjs[^)]*\)/.test(code)) offenders.push(path.relative(dir, full));
    }
  })(dir);
  assert.deepStrictEqual(offenders, [],
    `smart-gate.cjs dogrudan require ediliyor — kapi change-gates.cjs uzerinden gecmeli:\n${offenders.join('\n')}`);
});

test('kapi extraVars DEGIL gateVars okur (dort cagri yerinin hepsi)', () => {
  const calls = SRC.match(/isSmartRequired\([^)]*\)/g) || [];
  assert.ok(calls.length >= 4, `beklenen 4+ kapi cagrisi, bulunan ${calls.length}`);
  for (const c of calls) {
    assert.ok(
      /gateVars/.test(c),
      `kapi ham extraVars ile cagriliyor — bypass geri gelmis: ${c}`
    );
  }
  // Ham nesneye geri dusen bir yedek OLMAMALI.
  assert.ok(
    !/isSmartRequired\([^)]*gateVars \|\| extraVars/.test(SRC),
    "gateVars yoksa extraVars'a dusmek, kapatilan acigi eski kayitlar icin geri acar"
  );
});

test('gateVars YOKSA guvenli tarafa dusulur (bos nesne -> onay gerekli)', () => {
  assert.match(
    SRC,
    /isSmartRequired\(overrides\?\.smartApproval, gateVars \|\| \{\}\)/,
    'eski pendingLaunch kayitlari icin guvenli varsayilan yok'
  );
});

test('gateVars yalnizca guvenilir anahtarlardan kurulur', () => {
  assert.match(SRC, /const gateVars = \{\};[\s\S]{0,200}if \(!untrustedKeys\.has\(k\)\) gateVars\[k\] = v;/);
  assert.match(SRC, /return \{ detail, overrides, extraVars, gateVars, specFields, resolvedLaunchOptions \};/);
});

test("admin'in rawExtraVars'i dogrulanmamis client degerini EZER", () => {
  // Aksi halde admin `op_selection: create` yazarak kapiyi sabitlemeye calissa bile
  // kullanici uzerine yazabilirdi.
  assert.match(
    SRC,
    /if \(untrustedKeys\.has\(k\)\) \{ extraVars\[k\] = raw\[k\]; untrustedKeys\.delete\(k\); \}/,
    "admin'in acik tanimi dogrulanmamis client degeri tarafindan eziliyor"
  );
});
