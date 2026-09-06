// src/__tests__/survey-suggestions.test.cjs — SABLON YAPILANDIRMA ONERILERI.
//
// NEDEN VAR: AWX sablonu Self Service'e eklendiginde `FieldOverridesModal` ZATEN
// otomatik aciliyor — ama ici tamamen BOS geliyordu: `ocoCheck`, `smartApproval`,
// `outputFilter`, `customSurveyFields` hepsi kapali/bos. Sonuc: sablon "eklendi"
// sayiliyor ama hicbir onay kapisi baglanmamis oluyor ve bunu kimse fark etmiyor.
//
// EN ONEMLI KURAL — HICBIR ONERI KENDILIGINDEN UYGULANMAZ. `smartApproval`i sessizce
// acmak prod'da `apply` yolunu fail-closed KAPATIR (SMART yapilandirilmadan is
// baslamaz); "yardim" niyetiyle calisan bir akisi durdurmus olurduk.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
    .join('\n')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');

// GERCEK kaynagi derleyip CALISTIRIR — kopyasini degil (datetime.test.cjs deseni).
function load(rel) {
  const out = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, require);
  return m.exports;
}

const S = load('utils/surveySuggestions.ts');
const ids = (list) => list.map((x) => x.id).sort();

// ── DEGISIKLIK / SALT-OKUNUR AYRIMI ─────────────────────────────────────────

test('SG1 degisiklik ima eden sablonda SMART onerilir', () => {
  const out = S.buildSuggestions({ templateName: 'Nginx - Restart Service' });
  assert.ok(ids(out).includes('smartApproval'), 'degisiklik isleminde onay kapisi onerilmiyor');
});

test('SG2 SALT-OKUNUR sablonda kapi onerisi URETILMEZ', () => {
  // Bir sorgu sablonuna onay kapisi onermek, oneriyi gurultuye cevirir ve
  // yonetici tum paneli gormezden gelmeye baslar.
  for (const name of ['Nginx - Status Check', 'Sunucu Durum Raporu', 'List Pods']) {
    const out = S.buildSuggestions({
      templateName: name,
      fieldNames: ['env', 'namespace'],
    });
    assert.deepEqual(
      ids(out).filter((i) => i === 'smartApproval' || i === 'ocoCheck'),
      [],
      `salt-okunur sablonda kapi onerisi cikti: ${name}`,
    );
  }
});

test('SG3 sablon adi BILINMIYORSA kapi onerisi uretilmez (tahmin yok)', () => {
  const out = S.buildSuggestions({ templateName: '', fieldNames: ['env'] });
  assert.deepEqual(ids(out), [], 'ad yokken tahmin uretiliyor');
});

// ── OCO ─────────────────────────────────────────────────────────────────────

test('SG4 OCO YALNIZCA `env`/`ortam` alani varken onerilir', () => {
  // Prod tespiti SUNUCUDA tam olarak bu iki anahtara bakar (`prod-detect.cjs`
  // ENV_KEYS) ve bu BILEREK yapilandirilamaz. Baska adli bir ortam alani OCO
  // kapisini zaten atesleMEZ — onermek yaniltici olurdu.
  const withEnv = S.buildSuggestions({ templateName: 'Deploy App', fieldNames: ['env'] });
  assert.ok(ids(withEnv).includes('ocoCheck'));

  const withOrtam = S.buildSuggestions({ templateName: 'Deploy App', fieldNames: ['ortam'] });
  assert.ok(ids(withOrtam).includes('ocoCheck'));

  // BASKA adli ortam alani: onerilmemeli.
  const other = S.buildSuggestions({ templateName: 'Deploy App', fieldNames: ['environment'] });
  assert.ok(
    !ids(other).includes('ocoCheck'),
    'sunucunun okumadigi bir alan icin OCO onerildi — kapi zaten atesnlenmez',
  );
});

test('SG5 zaten ACIK olan kapi TEKRAR onerilmez', () => {
  const out = S.buildSuggestions({
    templateName: 'Deploy App',
    fieldNames: ['env'],
    ocoEnabled: true,
    smartEnabled: true,
  });
  assert.deepEqual(ids(out), [], 'yapilandirilmis kapilar tekrar oneriliyor');
});

// ── KIMLIK ALANI ────────────────────────────────────────────────────────────

test('SG6 kullanicidan ELLE istenen kimlik alani icin enjeksiyon onerilir', () => {
  // Elle yazilan bir kullanici adi hem gereksiz bir soru hem bir SAHTECILIK yolu.
  for (const f of ['email', 'username', 'kullanici']) {
    const out = S.buildSuggestions({ templateName: 'Status', fieldNames: [f] });
    assert.ok(ids(out).includes('injectUserInfo'), `${f} icin enjeksiyon onerilmedi`);
  }
});

test('SG7 kimlik onerisi SALT-OKUNUR sablonda da gecerlidir', () => {
  // Sahtecilik riski islemin turunden bagimsizdir; ayrica bu bir KAPI degil.
  const out = S.buildSuggestions({ templateName: 'Durum Raporu', fieldNames: ['username'] });
  assert.ok(ids(out).includes('injectUserInfo'));
});

// ── GORUNUR SIR ─────────────────────────────────────────────────────────────

test('SG8 gizli OLMAYAN password alani icin gizleme onerilir', () => {
  const out = S.buildSuggestions({
    templateName: 'Status Check',
    visiblePasswordFields: ['vault_pass', 'db_pass'],
  });
  assert.deepEqual(ids(out), ['hideField:db_pass', 'hideField:vault_pass']);
});

test('SG9 sir onerisi SALT-OKUNUR sablonda da URETILIR', () => {
  // Kapi onerileri salt-okunurda susar ama sir gizleme SUSMAZ: gorunur bir parola
  // sablonun turuyle ilgisiz bir sorundur.
  const out = S.buildSuggestions({
    templateName: 'Sunucu Durum Raporu',
    visiblePasswordFields: ['vault_pass'],
  });
  assert.deepEqual(ids(out), ['hideField:vault_pass']);
});

// ── REDDETME ────────────────────────────────────────────────────────────────

test('SG10 REDDEDILEN oneri bir daha uretilmez', () => {
  const base = { templateName: 'Deploy App', fieldNames: ['env'] };
  assert.ok(ids(S.buildSuggestions(base)).includes('ocoCheck'));
  const after = S.buildSuggestions({ ...base, dismissed: ['ocoCheck'] });
  assert.ok(!ids(after).includes('ocoCheck'), 'reddedilen oneri tekrar cikiyor');
  // Digerleri ETKILENMEZ.
  assert.ok(ids(after).includes('smartApproval'));
});

// ── GUVENLIK YONU ───────────────────────────────────────────────────────────

test('SG11 hicbir oneri bir kapiyi KAPATMAYI onermez', () => {
  // Yon guvenli olmali: yanlislikla uygulanan bir oneri en kotu ihtimalle
  // gereksiz bir onay adimi ekler, bir kapiyi KALDIRMAZ.
  const all = S.buildSuggestions({
    templateName: 'Restart Deploy Delete',
    fieldNames: ['env', 'username'],
    visiblePasswordFields: ['p'],
  });
  assert.ok(all.length >= 4, 'ornek girdi tum onerileri uretmedi');
  for (const s of all) {
    assert.ok(
      ['ocoCheck', 'smartApproval', 'injectUserInfo', 'hideField'].includes(s.patch.kind),
      `bilinmeyen oneri turu: ${s.patch.kind}`,
    );
  }
});

test('SG12 her oneri GEREKCE tasir', () => {
  const all = S.buildSuggestions({
    templateName: 'Restart App',
    fieldNames: ['env', 'email'],
    visiblePasswordFields: ['p'],
  });
  for (const s of all) {
    assert.ok(s.why && s.why.length > 20, `gerekcesiz oneri: ${s.id}`);
    assert.ok(s.title && s.title.length > 3, `basliksiz oneri: ${s.id}`);
  }
});

// ── EKRAN SOZLESMESI ────────────────────────────────────────────────────────

test('SG13 oneriler ekranda RENDER ediliyor ve OTOMATIK UYGULANMIYOR', () => {
  const modal = codeOnly(read('components/self_service/FieldOverridesModal.tsx'));
  assert.match(modal, /buildSuggestions\(\{/, 'motor cagrilmiyor');
  assert.match(modal, /suggestions\.map\(\(s\) => \(/, 'oneriler RENDER EDILMIYOR (hesap yetmez)');
  assert.match(modal, /\{s\.why\}/, 'gerekce ekrana basilmiyor');

  // OTOMATIK UYGULAMA YOK: `applySuggestion` yalnizca bir tiklamaya bagli olmali.
  assert.match(modal, /onClick=\{\(\) => applySuggestion\(s\)\}/, 'uygulama dugmeye bagli degil');
  // PENCERE `[^)]*` OLAMAZ: `useEffect(() => {` kalibinda ilk `)` hemen geliyor ve
  // desen orada duruyordu — bir effect icinde `applySuggestion` cagrilsa bile bekci
  // YESIL kaliyordu (mutasyonla yakalandi). Her `useEffect(` icin SONRASINDAKI
  // pencereye bakilir.
  const flat = modal.replace(/\s+/g, ' ');
  for (const m of flat.matchAll(/useEffect\(/g)) {
    const window = flat.slice(m.index, m.index + 400);
    assert.ok(
      !/applySuggestion\(/.test(window),
      'oneriler bir effect icinde OTOMATIK uygulaniyor — sessizce kapi aciliyor',
    );
  }
});

test('SG14 reddedilenler KAYDEDILIYOR (yoneticinin karari kalici)', () => {
  const modal = codeOnly(read('components/self_service/FieldOverridesModal.tsx'));
  assert.match(modal, /dismissedSuggestions: dismissed/, 'reddedilenler kaydedilmiyor');
  assert.match(modal, /setDismissed\(/, 'kayittan geri okunmuyor');
});
