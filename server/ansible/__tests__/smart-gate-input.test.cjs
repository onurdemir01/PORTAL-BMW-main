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
// 2026-08-29: kapi mantigi change-gates.cjs'e tasindi (ScaleX de ayni kapidan
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

// GERCEK CAGRI YERI = bir nesne uzerinden cagri (`gates.isSmartRequired(...)`) ya da
// modul icinden dogrudan cagri. FONKSIYON BILDIRIMI ve `require(...).isSmartRequired`
// delegasyonu SAYILMAZ.
//
// NEDEN: ilk yazimda desen duz `isSmartRequired\(...\)` idi ve tum kaynaklar tek bir
// metinde birlestiriliyordu. Kod change-gates.cjs'e tasininca O DOSYA TEK BASINA
// 4 eslesme uretmeye basladi (bildirim + delegasyon + iki gercek cagri) — yani
// runner.cjs'teki IKI GERCEK KAPI CAGRISI DA SILINSE sayac 4'te kalir ve bekci
// YESIL kalirdi. Somut senaryo: ss/test/run'daki guard silinse her admin "Gercekten
// Calistir" Smart onayini atlayarak is tetikler, test gecerdi. Artik sayim DOSYA
// BAZINDA ve bildirim/delegasyon haric.
function realCallSites(src) {
  // Eleme BURADA yapilir, cagiranda DEGIL: filtreyi cagirana birakmak, yeni bir
  // cagiran eklendiginde sessizce atlanmasina yol acardi.
  const code = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))                 // yorumlar
    .filter((l) => !/^\s*function\s+isSmartRequired\s*\(/.test(l))  // BILDIRIM
    .filter((l) => !/require\([^)]*smart-gate\.cjs[^)]*\)\s*\.isSmartRequired/.test(l)) // DELEGASYON
    .join('\n');
  return code.match(/(?:\w+\.)?isSmartRequired\([^)]*\)/g) || [];
}

test('kapi extraVars DEGIL gateVars okur (her cagri yerinde, her dosyada)', () => {
  const runnerCalls = realCallSites(RUNNER);
  const gatesCalls = realCallSites(GATES);
  // Iki dosya AYRI AYRI denetlenir; birinin fazlaligi digerinin eksigini ORTEMEZ.
  assert.ok(runnerCalls.length >= 2,
    `runner.cjs'te beklenen 2+ kapi cagrisi (launchOrRequestApproval + ss/test/run), bulunan ${runnerCalls.length}`);
  assert.ok(gatesCalls.length >= 2,
    `change-gates.cjs'te beklenen 2+ kapi cagrisi (evaluateOcoGate + runChangeGates), bulunan ${gatesCalls.length}`);
  for (const c of [...runnerCalls, ...gatesCalls]) {
    assert.ok(/gateVars/.test(c), `kapi ham extraVars ile cagriliyor — bypass geri gelmis: ${c}`);
  }
  // Ham nesneye geri dusen bir yedek OLMAMALI.
  assert.ok(
    !/isSmartRequired\([^)]*gateVars \|\| extraVars/.test(SRC),
    "gateVars yoksa extraVars'a dusmek, kapatilan acigi eski kayitlar icin geri acar"
  );
});

test('bekci KOR DEGIL: gercek bir kapi cagrisi silinirse kirmizi olur', () => {
  // Once mevcut kaynagin esigi GECTIGINI dogrula — aksi halde asagidaki sabotaj
  // testi "zaten sifirdi" diye anlamsiz gecerdi.
  assert.ok(realCallSites(RUNNER).length >= 2, 'baslangic durumu yanlis: runner.cjs 2 cagri tasimali');

  // ss/test/run'daki guard'i sil (her admin "Gercekten Calistir" Smart onayini
  // atlayarak is tetikleyebilir hale gelirdi) — sayac esigin ALTINA dusmeli.
  const sabotaged = RUNNER.replace(/if \(gates\.isSmartRequired\(overrides\.smartApproval, gateVars\)\)/, 'if (false)');
  assert.notEqual(sabotaged, RUNNER, 'sabotaj deseni tutmadi — bekci guncellenmeli');
  assert.ok(realCallSites(sabotaged).length < 2,
    'gercek bir kapi cagrisi silindigi halde sayac esigin ustunde kaldi — bekci KOR');

  // change-gates.cjs tarafi: bildirim ve delegasyon SAYILMAMALI, yoksa o dosya tek
  // basina esigi doldurur ve runner.cjs'teki silmeler gorunmez olurdu (asil hata buydu).
  const declOnly = 'function isSmartRequired(smartApproval, gateVars) {\n'
    + "  return require('./smart-gate.cjs').isSmartRequired(smartApproval, gateVars || {});\n}";
  assert.equal(realCallSites(declOnly).length, 0,
    'bildirim + delegasyon cagri yeri olarak sayiliyor — bekci yine korlesir');
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
