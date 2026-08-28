// server/__tests__/unbound-identifier.test.cjs — `gateVars` SINIFI icin kalici bekci.
//
// NE OLDU: 7eba0d5 `resolveSsLaunchPlan`a `gateVars` ekledi ve cagri yerlerini ona
// cevirdi ama IKI handler'in DESTRUCTURE satirina eklemeyi unuttu. `gateVars` o
// kapsamlarda TANIMSIZ kaldi ve HER Self Servis tetiklemesi ReferenceError ile 502
// dondu. Uretimde otomasyonlar durdu.
//
// NEDEN MEVCUT TESTLER YAKALAMADI: `smart-gate-input.test.cjs` kaynak METNINDE
// `gateVars` GECIYOR MU diye bakiyordu — geciyordu, sadece BAGLI DEGILDI. Metin
// aramasi bu sinifi ilkesel olarak yakalayamaz.
//
// NEDEN TSC: `src/` TypeScript ile denetleniyor ve bu sinif orada IMKANSIZ. Ama
// `server/**/*.cjs` HICBIR denetimden gecmiyordu — bosluk tam olarak oradaydi.
// TypeScript `--checkJs` ile duz JS'i de kapsam analizinden gecirir; TS2304
// ("Cannot find name") ve TS2552 ("Did you mean...") tam olarak bu sinifi isaretler.
//
// NEDEN YALNIZCA BU IKI KOD: `checkJs` tipsiz JS'te yuzlerce TS2339/TS18047 gibi
// gurultu uretir (bunlar CALISMA ZAMANI hatasi DEGIL). TS2304/TS2552 ise farkli:
// o satir calisirsa ReferenceError KESINDIR. Bekci bu yuzden dar tutuldu — genis
// tutulsaydi gurultuye bogulur ve kapatilirdi.
//
// NOT: JSDoc'ta `@returns { a: string }` yazimi da TS2304 uretir (tek suslu parantez
// bir TIP ifadesi olarak okunur; dogrusu `{{ a: string }}`). Bu bir calisma zamani
// hatasi degildir ama bekciyi kirmizi tutar — bu yuzden yazim da duzeltilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const TSCONFIG = path.join(ROOT, 'tsconfig.server-check.json');

test('tsconfig.server-check.json repoda var ve server/**/*.cjs kapsiyor', () => {
  assert.ok(fs.existsSync(TSCONFIG), 'sunucu denetim yapilandirmasi silinmis');
  const cfg = JSON.parse(fs.readFileSync(TSCONFIG, 'utf8'));
  assert.ok(cfg.compilerOptions.checkJs, 'checkJs kapatilmis — bekci ise yaramaz');
  assert.ok(cfg.compilerOptions.allowJs);
  assert.deepEqual(cfg.include, ['server/**/*.cjs']);
});

test('server/**/*.cjs icinde TANIMSIZ KIMLIK yok (gateVars sinifi)', () => {
  let out = '';
  try {
    execFileSync('npx', ['tsc', '-p', TSCONFIG], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    // tsc gurultu (TS2339 vb.) yuzunden sifir-disi kod doner; ciktiyi biz suzeriz.
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const unbound = out.split('\n').filter((l) => /error TS(2304|2552):/.test(l));
  assert.deepEqual(unbound, [],
    'bu satirlar CALISTIGINDA ReferenceError verir:\n' + unbound.join('\n'));
});

test('bekcinin kendisi kor DEGIL: sentetik bir ihlali yakalar', () => {
  // Bekci "hep yesil" olmasin diye: gecici bir dosyaya tanimsiz kimlik yazilir ve
  // tsc'nin bunu GERCEKTEN TS2304 olarak isaretledigi dogrulanir.
  const probe = path.join(ROOT, 'server', '__unbound_probe__.cjs');
  fs.writeFileSync(probe, "'use strict';\nfunction f() { return buSeyTanimliDegil; }\nmodule.exports = { f };\n");
  try {
    let out = '';
    try {
      execFileSync('npx', ['tsc', '-p', TSCONFIG], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      out = `${e.stdout || ''}${e.stderr || ''}`;
    }
    assert.match(out, /__unbound_probe__\.cjs.*error TS2304/,
      'tsc sentetik ihlali yakalamadi — bekci kor, yesil olmasi hicbir sey ifade etmez');
  } finally {
    fs.unlinkSync(probe);
  }
});
