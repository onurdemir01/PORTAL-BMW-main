// src/__tests__/opsx-was-single-select.test.cjs - OpsX WAS ekranlarinda TOPLU ISLEM YOK.
//
// Kullanici kurali (2026-10-02): WAS restart/stop/start TEK host + TEK JVM uzerinde yapilir.
// Kural dort katmanda korunur: UI (bu dosya), sunucu (server/opsx/__tests__/was-run.test.cjs
// W2), playbook assert + add_host ve playbook bekcileri (server/ansible/__tests__/opsx-was-*).
// Bu bekci UI katmanini kilitler:
//   UI1 WAS adimlarinda "Tumunu sec" / "hepsini sec" / select-all YOK (yeni Was* dosyalari dahil)
//   UI2 JVM secimi RADYO ve TEK anahtar (dizi/Set yok); onSubmit TEK hedef verir
//   UI3 API govdesi tek host (metin) tasir; sihirbaz tek host gonderir, limit gondermez
//   UI4 onay: JVM adi elle yazilir (yapistirma kapali), onay kutusu ayrica iletilir
//   UI5 OLCULEMEDI ayri (sari) gosterilir; bilinmeyen durum OLCULEMEDI'ye duser, Durmus'a degil
//   UI6 sihirbaz Legacy -> urun secimi -> WAS akisi; JBoss'un coklu secim adimlari WAS'a girmez
//
// Yontem bu depodaki diger UI bekcileriyle ayni: kaynak metni uzerinde yapisal denetim.
// Metin server/util/guard-text.cjs normalize() ile duzlestirilir (prettier'den bagimsiz).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../../server/util/guard-text.cjs');

const SRC = path.join(__dirname, '..');
const STEPS_DIR = path.join(SRC, 'components', 'opsx', 'steps');
const read = (rel) => fs.readFileSync(path.join(SRC, ...rel.split('/')), 'utf8');

// Yorum satirlarini atar (aciklamalarda "tumunu sec yok" gibi cumleler gecebilir), sonra
// bosluk ve tirnak normalize edilir.
const codeOnly = (s) =>
  normalize(
    String(s)
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
      .join('\n'),
  );

// Iki isaret arasindaki metin; isaret yoksa bekci KOR kalmasin diye test duser.
function between(text, startMark, endMark, label) {
  const a = text.indexOf(startMark);
  assert.ok(a >= 0, `${label}: baslangic isareti bulunamadi (${startMark})`);
  const b = text.indexOf(endMark, a + startMark.length);
  assert.ok(b > a, `${label}: bitis isareti bulunamadi (${endMark})`);
  return text.slice(a, b);
}

// WAS adimlari: dizindeki TUM was*/Was* dosyalari + urun secimi. Yeni bir WAS dosyasi
// eklenirse listeye kendiliginden girer.
const WAS_STEP_FILES = [
  'LegacyProductStep.tsx',
  ...fs
    .readdirSync(STEPS_DIR)
    .filter((n) => /^was/i.test(n) && /\.(tsx|ts)$/.test(n))
    .sort(),
];

const JVM = codeOnly(read('components/opsx/steps/WasJvmSelectStep.tsx'));
const CONFIRM = codeOnly(read('components/opsx/steps/WasConfirmStep.tsx'));
const RESULT = codeOnly(read('components/opsx/steps/WasResultPanel.tsx'));
const LABELS = codeOnly(read('components/opsx/steps/wasLabels.ts'));
const API = codeOnly(read('api/opsxApi.ts'));
const WIZARD = codeOnly(read('components/opsx/OpsXWizardPage.tsx'));

// Turkce buyuk/kucuk harf ve sapkasiz yazim dahil.
const SELECT_ALL = [/t[uü]m[uü]n[uü]/, /hepsini\s*se[cç]/, /select\s*all/, /selectall/, /toggleall/, /t[uü]m[uü]\s*se[cç]/];
const lowerTr = (s) => String(s).toLocaleLowerCase('tr-TR');

test('UI1 WAS adimlarinda "Tumunu sec" / select-all YOK', () => {
  for (const known of [
    'LegacyProductStep.tsx',
    'WasAppSearchStep.tsx',
    'WasJvmSelectStep.tsx',
    'WasConfirmStep.tsx',
    'WasResultPanel.tsx',
    'WasBadges.tsx',
    'wasLabels.ts',
  ]) {
    assert.ok(WAS_STEP_FILES.includes(known), `${known} WAS adim listesinde yok`);
  }
  // Pozitif kontrol: desenler gercek "Tumunu Sec" yazimlarini YAKALIYOR (bekci kor degil).
  for (const sample of ['Tümünü Seç', 'TÜMÜNÜ SEÇ', 'tumunu sec', 'Hepsini seç', 'Select all', 'toggleAll']) {
    assert.ok(
      SELECT_ALL.some((re) => re.test(lowerTr(sample))),
      `desen "${sample}" yazimini yakalamiyor`,
    );
  }
  for (const f of WAS_STEP_FILES) {
    const text = lowerTr(read(`components/opsx/steps/${f}`));
    for (const re of SELECT_ALL) {
      assert.doesNotMatch(text, re, `${f}: toplu secim metni/isleyicisi bulundu (${re})`);
    }
  }
});

test('UI2 JVM secimi RADYO ve TEK anahtar; onSubmit TEK hedef verir', () => {
  const radios = JVM.match(/type='radio'/g) || [];
  assert.equal(radios.length, 1, 'JVM listesinde tek bir radyo girdisi (satir basina) olmali');
  assert.match(JVM, /name='was-jvm'/, 'radyo grubu tek bir ad tasimali');
  assert.doesNotMatch(JVM, /type='checkbox'/, 'JVM seciminde onay kutusu (coklu secim) olmamali');
  assert.match(JVM, /role='radiogroup'/);
  // Secim TEK metin anahtari; dizi/Set ile coklu secim yok.
  assert.match(JVM, /const \[selectedKey, setSelectedKey\] = useState\(''\)/);
  assert.doesNotMatch(JVM, /useState<\s*(Set|string\[\]|WasTarget\[\]|Record)/);
  assert.doesNotMatch(JVM, /setSelectedKey\(\s*\(/, 'secim bir onceki secime EKLENMEMELI');
  assert.match(JVM, /onChange=\{\(\) => \{ setSelectedKey\(k\); setOperation\(null\); \}\}/);
  // Secilemeyen (olculemeyen / coklu surec / kimliksiz) satirin radyosu kapali.
  assert.match(JVM, /disabled=\{busy \|\| !t\.selectable\}/);
  // onSubmit tek hedef + tek islem.
  assert.match(
    JVM,
    /onSubmit: \(v: \{ target: WasTarget; operation: WasOperation; discovery: WasDiscoveryRef \}\) => void/,
  );
  assert.doesNotMatch(JVM, /WasTarget\[\]/);
  assert.match(JVM, /onSubmit\(\{ target: selected, operation,/);
});

test('UI3 API govdesi ve sihirbaz TEK host gonderir; limit yok', () => {
  const body = between(API, 'export interface WasRunBody {', '}', 'WasRunBody');
  assert.match(body, /host: string;/);
  assert.doesNotMatch(body, /\bhosts\??:/, 'WasRunBody coklu host alani tasimamali');
  assert.doesNotMatch(body, /\[\]/, 'WasRunBody dizi alani tasimamali');
  assert.doesNotMatch(body, /\blimit\??:/, "AWX'e limit gitmez");

  const run = between(WIZARD, 'async function runWas(', 'const wasEnv', 'runWas');
  assert.match(run, /if \(busyRef\.current\) return;/, 'WAS islemi cift tik kilidinden gecmeli');
  assert.match(run, /opsxWasApi\.run\(\{ app: wasSel\.app, host: wasTarget\.host, profile: wasTarget\.profile,/);
  assert.doesNotMatch(run, /\bhosts\s*:/);
  assert.doesNotMatch(run, /\blimit\b/);
  assert.match(run, /confirmed: v\.confirmed, confirmText: v\.confirmText,/);
});

test('UI4 onay: JVM adi ELLE yazilir, onay kutusu ve uyari kabulu ayrica', () => {
  assert.match(CONFIRM, /onPaste=\{\(e\) => e\.preventDefault\(\)\}/, 'yapistirma kapali olmali');
  assert.match(CONFIRM, /onDrop=\{\(e\) => e\.preventDefault\(\)\}/, 'surukle-birak kapali olmali');
  assert.match(CONFIRM, /const \[typed, setTyped\] = useState\(''\)/, 'alan BOS baslamali (on doldurma yok)');
  assert.doesNotMatch(CONFIRM, /useState\(target\.server\)/);
  assert.match(CONFIRM, /const nameOk = typed === target\.server;/);
  assert.match(CONFIRM, /const canSubmit = !busy && nameOk && consent && \(warnings\.length === 0 \|\| ack\);/);
  assert.match(CONFIRM, /disabled=\{!canSubmit\}/);
  assert.match(CONFIRM, /onConfirm\(\{ confirmed: consent, confirmText: typed, ackWarnings: warnings\.length > 0 && ack \}\)/);
});

test('UI5 OLCULEMEDI ayri (sari); bilinmeyen durum OLCULEMEDI, asla Durmus', () => {
  const states = between(LABELS, 'export const WAS_STATE_INFO', 'export function wasStateInfo', 'WAS_STATE_INFO');
  const clsOf = (name) => {
    const m = states.match(new RegExp(`${name}: \\{ label: '([^']*)', cls: '([^']*)'`));
    assert.ok(m, `${name} etiketi bulunamadi`);
    return { label: m[1], cls: m[2] };
  };
  const olc = clsOf('OLCULEMEDI');
  const stop = clsOf('STOPPED');
  assert.match(olc.cls, /yellow/, 'OLCULEMEDI sari olmali');
  assert.notEqual(olc.cls, stop.cls, 'OLCULEMEDI ile STOPPED ayni gorunmemeli');
  assert.notEqual(olc.label, stop.label);
  assert.match(LABELS, /return WAS_STATE_INFO\[state as WasState\] \|\| WAS_STATE_INFO\.OLCULEMEDI;/);
  assert.match(LABELS, /return WAS_RESULT_INFO\[code as WasOpResultCode\] \|\| WAS_RESULT_INFO\.OLCULEMEDI;/);
  // Sonuc paneli: bilinmeyen sonuc sari ve "gercek durum bilinmiyor".
  assert.match(RESULT, /Ölçülemedi — gerçek durum bilinmiyor/);
  assert.match(RESULT, /: 'bg-yellow-50 border-yellow-200 text-yellow-800'/);
});

test('UI6 sihirbaz: Legacy -> urun secimi -> WAS; JBoss coklu secim adimlari WAS akisina girmez', () => {
  assert.match(WIZARD, /setStep\(p === 'legacy' \? 'legacy_product' : 'ocp_target'\)/);
  assert.match(WIZARD, /setStep\(p === 'was' \? 'was_app' : 'legacy_app'\)/);
  const wasRender = between(WIZARD, "{step === 'legacy_product' &&", "{step === 'legacy_app' &&", 'WAS render');
  for (const s of ['was_app', 'was_jvm', 'was_confirm', 'was_done']) {
    assert.ok(wasRender.includes(`{step === '${s}'`), `${s} adimi WAS render blogunda yok`);
  }
  assert.doesNotMatch(
    wasRender,
    /<(HostSelectStep|ServerConfigSelectStep|LegacyJvmSelectStep|OperationStep|AppSearchStep|JbossVersionStep)\b/,
    "JBoss'un coklu secim adimlari WAS akisinda kullanilmamali",
  );
  assert.match(wasRender, /<WasJvmSelectStep/);
  assert.match(wasRender, /<WasConfirmStep/);
  assert.match(wasRender, /onConfirm=\{runWas\}/);
});
