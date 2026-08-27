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

const SRC = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');

test('fallback dalindaki client anahtarlari GUVENILMEZ olarak isaretlenir', () => {
  // Dogrulamadan gecmeyen tek dal bu; oradan gelen her anahtar untrustedKeys'e girmeli.
  assert.match(
    SRC,
    /if \(val !== ""\) \{ extraVars\[k\] = val; untrustedKeys\.add\(k\); \}/,
    'fallback dali client anahtarlarini isaretlemiyor — kapi yine ham girdiyi okur'
  );
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
