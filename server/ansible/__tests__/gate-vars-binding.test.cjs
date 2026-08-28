// server/ansible/__tests__/gate-vars-binding.test.cjs
//
// NEDEN VAR: 2026-08-28'de Self Servis'te HER is tetiklemesi 502 ile dustu:
//   POST /api/ansible/launch-ss/2/1554 -> {"ok":false,"message":"gateVars is not defined"}
//
// Sebep: `resolveSsLaunchPlan` artik `gateVars` de donduruyor (AWX'e giden extraVars ile
// onay kapisinin okudugu nesne guvenlik gerekcesiyle AYRILDI) ve uc cagri yeri
// `gateVars` kullaniyor; ama iki handler'daki DESTRUCTURE satirina eklenmemis. Bu bir
// ReferenceError - kod ayaga kalkar, yalnizca o satira VARILDIGINDA patlar. Satir ana
// launch yolunda oldugu icin tetikleme tamamen calismaz hale gelmisti.
//
// Mevcut smart-gate-input.test.cjs bunu YAKALAYAMAZ: o test kaynak metninde `gateVars`
// gecip gecmedigine bakiyor - gecmisti, sadece BAGLI DEGILDI.
//
// Bu test kaynagi kaba bir "kapsam" bolmesiyle tarar ve `gateVars` kullanan her
// kapsamda o adin ya tanimlandigini ya da destructure edildigini dogrular. Ayni
// kontrol asagida SENTETIK bozuk bir kaynak uzerinde de calistirilir - boylece testin
// kendisinin gercekten ise yaradigi kanitlanir (yesil ama kor bir test olmasin).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'runner.cjs');

// Kapsam sinirlari: iki bosluk girintili handler/fonksiyon baslangiclari.
const SCOPE_START = /^ {2}(app\.(get|post|put|delete)\(|(async )?function )/;

/** `name` kullanan ama onu baglamayan kapsamlarin adlarini dondurur. */
function unboundScopes(src, name) {
  const lines = src.split('\n');
  const scopes = [];
  let cur = { head: '(dosya basi)', body: [] };
  for (const line of lines) {
    if (SCOPE_START.test(line)) {
      scopes.push(cur);
      cur = { head: line.trim().slice(0, 70), body: [] };
    }
    cur.body.push(line);
  }
  scopes.push(cur);

  const usesName = new RegExp(`\\b${name}\\b`);
  // Baglanma bicimleri: dogrudan tanim, ya da bir destructure listesinde yer alma.
  const declares = new RegExp(`(const|let|var)\\s+${name}\\s*=`);
  const destructures = new RegExp(`(const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`, 's');

  return scopes
    .filter((s) => {
      const body = s.body.join('\n');
      return usesName.test(body) && !declares.test(body) && !destructures.test(body);
    })
    .map((s) => s.head);
}

test('runner.cjs: gateVars kullanan HER kapsamda gateVars BAGLI', () => {
  const src = fs.readFileSync(SRC, 'utf-8');
  const bad = unboundScopes(src, 'gateVars');
  assert.deepStrictEqual(
    bad, [],
    'gateVars su kapsam(lar)da bagli degil - calisma aninda "gateVars is not defined" verir:\n  ' +
      bad.join('\n  ')
  );
});

test('kontrol GERCEKTEN yakaliyor: sentetik bozuk kaynak reddedilir', () => {
  // 2026-08-28'deki hatanin birebir kucultulmus hali: plan gateVars donduruyor,
  // handler kullaniyor ama destructure'a almamis.
  const broken = [
    '  async function resolveSsLaunchPlan(a) {',
    '    const gateVars = {};',
    '    return { extraVars, gateVars };',
    '  }',
    '  app.post("/api/ansible/launch-ss/:id", async (req, res) => {',
    '    const { detail, overrides, extraVars } = await resolveSsLaunchPlan(1);',
    '    if (isSmartRequired(overrides.smartApproval, gateVars)) { return; }',
    '  });',
  ].join('\n');
  const bad = unboundScopes(broken, 'gateVars');
  assert.strictEqual(bad.length, 1, 'bozuk kaynakta tam bir kapsam isaretlenmeli');
  assert.match(bad[0], /launch-ss/);
});

test('kontrol YANLIS ALARM vermiyor: duzeltilmis sentetik kaynak temiz', () => {
  const fixed = [
    '  async function resolveSsLaunchPlan(a) {',
    '    const gateVars = {};',
    '    return { extraVars, gateVars };',
    '  }',
    '  app.post("/api/ansible/launch-ss/:id", async (req, res) => {',
    '    const { detail, overrides, extraVars, gateVars } = await resolveSsLaunchPlan(1);',
    '    if (isSmartRequired(overrides.smartApproval, gateVars)) { return; }',
    '  });',
  ].join('\n');
  assert.deepStrictEqual(unboundScopes(fixed, 'gateVars'), []);
});
