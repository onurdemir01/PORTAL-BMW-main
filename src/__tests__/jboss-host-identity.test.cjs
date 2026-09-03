// src/__tests__/jboss-host-identity.test.cjs — J1..J6.
//
// NE OLDU: kurumsal envanter (`MWAppsInventory`) AYNI sunucu icin birden cok satir
// donduruyor — biri JBoss 7 kurulumu, digeri JBoss 8. Dort modulun (LogX, OpsX,
// Telnet, FileX) sunucu secim ekrani satiri YALNIZCA host adiyla kimlikliyordu:
//     key={h.host}          selected: Set<string>   // host adi
// Sonucu kullanicinin bildirdigi uc belirti:
//   · iki satir tek onay kutusu durumunu paylasiyordu (birini isaretleyince digeri de),
//   · "yalnizca bu sunucunun JBoss 8 kurulumu" denemiyordu,
//   · satirlar gorsel olarak ayirt edilemiyordu ("uygulamaci anlamiyor").
// Ustelik React ayni `key`i iki kez aliyordu.
//
// NEDEN BUGUNE KADAR YAKALANMADI: JBoss surum mantigi icin repoda TEK BIR TEST
// YOKTU. Uc ayri `JbossVersionStep` kopyasi vardi ve ikisinde duzeltilen bir hata
// ucuncusunde (FileX) aylarca yasadi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// KAYNAK TARAMASI YORUMLARI GORMEZ. Bu dosyalarin basinda eski hatali deseni
// ANLATAN yorumlar var (`key={h.host}` gibi) — onlari yasakli desen sanmak,
// duzeltmeyi belgeleyen yorumu silmeye zorlardi. Yalnizca tam satir yorumlari
// atilir; satir ici `//` (ornegin bir URL) elenmez.
const codeOf = (p) => read(p)
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

// Gercek kaynagi derleyip CALISTIRIR — kopyasini degil.
function load(rel) {
  const out = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, require);
  return m.exports;
}

const J = load('utils/jboss.ts');

// Dort modulun sunucu secim ekrani — hepsi AYNI kurallara tabi.
const HOST_STEPS = [
  'components/logx_v2/steps/legacy/HostSelectStep.tsx',
  'components/opsx/steps/HostSelectStep.tsx',
  'components/telnet/steps/HostSelectStep.tsx',
  'components/filex/steps/HostSelectStep.tsx',
];

// ── J1: satir kimligi host DEGIL, (host, major) ciftidir ────────────────────
test('J1: ayni host iki majorde iki FARKLI anahtar uretir', () => {
  const j7 = J.hostKey('GBCJAP01', '7');
  const j8 = J.hostKey('GBCJAP01', '8');
  assert.notEqual(j7, j8, 'cift kurulumlu host tek anahtara cokuyor — secim yine paylasilir');

  // Cozumleme kayipsiz olmali: secim sunucuya cift olarak gidiyor.
  assert.deepEqual(J.parseHostKey(j8), { host: 'GBCJAP01', jbossMajor: '8' });

  // Buyuk/kucuk harf ayni sunucuyu iki kez SECTIRMEMELI.
  assert.equal(J.hostKey('gbcjap01', '8'), j8);
});

test('J1b: majoru bilinmeyen host da kararli bir anahtar alir', () => {
  const k = J.hostKey('WASHOST01', '');
  assert.equal(J.parseHostKey(k).host, 'WASHOST01');
  assert.equal(J.parseHostKey(k).jbossMajor, '');
  // "NF" ve bos ayni gruba duser — WAS gibi JBoss olmayan uygulamalar.
  assert.equal(J.normalizeJbossVersion('NF'), '');
  assert.equal(J.normalizeJbossVersion('  '), '');
});

// ── J2: dort ekranin hicbiri host adini kimlik olarak kullanmaz ─────────────
//
// Bu test bir DAVRANIS testi degil, KAYNAK taramasidir — bilerek. Dort dosyayi
// da JSDOM'da render etmek bu depoda kurulu degil; asil risk ise duzeltmenin
// dort dosyadan birinde unutulmasi (uc `JbossVersionStep` kopyasinda tam olarak
// bu yasandi).
test('J2: dort sunucu ekraninda da satir/secim kimligi host adi DEGIL', () => {
  for (const rel of HOST_STEPS) {
    const src = codeOf(rel);
    assert.ok(
      !/key=\{h\.host\}/.test(src),
      `${rel}: satir key'i hala host adi — ayni host iki kez gelince React ayni key'i iki kez alir`
    );
    assert.ok(
      !/selected\.has\(h\.host\)/.test(src),
      `${rel}: secim hala host adiyla kontrol ediliyor — iki satir tek onay kutusunu paylasir`
    );
    assert.ok(
      /hostKey\(/.test(src),
      `${rel}: ortak hostKey() kullanilmiyor`
    );
    // KULLANIMI ara, adi DEGIL: yalnizca `import JbossTag ...` satiri de "JbossTag"
    // gecirir ve rozet render'dan silinse bile bekci yesil kalirdi (mutasyonla
    // dogrulandi — ilk yazimda tam olarak bu yasandi).
    assert.ok(
      /<JbossTag[\s/>]/.test(src),
      `${rel}: satirda JBoss rozeti RENDER EDILMIYOR — iki satir gorsel olarak ayirt edilemez`
    );
  }
});

// ── J3: ortak yardimci ortak yerde ──────────────────────────────────────────
test('J3: jbossMajorOf bir modulun sihirbaz adimindan DEGIL, utils/jboss.ts\'ten gelir', () => {
  assert.equal(typeof J.jbossMajorOf, 'function');
  assert.ok(
    !/export function jbossMajorOf/.test(codeOf('components/opsx/steps/JbossVersionStep.tsx')),
    'jbossMajorOf hala OpsX adimindan export ediliyor — Telnet oraya bagimli kalir'
  );
  const all = [
    ...HOST_STEPS,
    'components/opsx/steps/JbossVersionStep.tsx',
    'components/telnet/steps/JbossVersionStep.tsx',
    'components/filex/steps/JbossVersionStep.tsx',
  ];
  for (const rel of all) {
    assert.ok(
      !/from "@\/components\/opsx\/steps\/JbossVersionStep"/.test(codeOf(rel)),
      `${rel}: hala OpsX'in adimindan import ediyor`
    );
  }
});

// ── J4: majör bazinda gruplama (FileX regresyonu) ───────────────────────────
test('J4: ayni majörün iki yamasi AYNI gruba duser', () => {
  assert.equal(J.jbossMajorOf('8.0.7'), '8');
  assert.equal(J.jbossMajorOf('8.1.2'), '8');
  assert.equal(J.jbossMajorOf('7.3.10'), '7');
  assert.equal(J.jbossMajorOf(''), '');
  assert.equal(J.jbossMajorOf('NF'), '');

  assert.equal(J.majorOfHost({ jbossVersion: '8.1.2' }), '8');
  assert.equal(J.majorOfHost({ jbossVersion: 'NF' }), '');
});

test('J4b: uc surum adiminin hicbiri TAM surum string\'ine gore gruplamaz', () => {
  for (const rel of [
    'components/opsx/steps/JbossVersionStep.tsx',
    'components/telnet/steps/JbossVersionStep.tsx',
    'components/filex/steps/JbossVersionStep.tsx',
  ]) {
    const src = codeOf(rel);
    // Eski hatali desen: ham surumu dogrudan sayac anahtari yapmak.
    assert.ok(
      !/counts\.set\(v,/.test(src),
      `${rel}: hala tam surum string'ine gore grupluyor — "8.0.7" secilince "8.1.2" host'lari kaybolur`
    );
    assert.ok(
      /majorOfHost\(/.test(src),
      `${rel}: ortak majorOfHost() kullanilmiyor`
    );
  }
});

// ── J5: secilen anahtarlardan sunucuya gidecek cift uretimi ─────────────────
test('J5: cift kurulumlu host tek ad + iki major olarak gonderilir', () => {
  const keys = [
    J.hostKey('GBCJAP01', '7'),
    J.hostKey('GBCJAP01', '8'),
    J.hostKey('GBCJAP02', '8'),
  ];
  const pairs = J.toHostPairs(keys);
  const hosts = [...new Set(pairs.map((p) => p.host))];
  const majors = [...new Set(pairs.map((p) => p.jbossMajor))].sort();

  assert.deepEqual(hosts, ['GBCJAP01', 'GBCJAP02'], 'ayni sunucu iki kez gonderilmemeli');
  assert.deepEqual(majors, ['7', '8'], 'iki kurulum da isaretlendi — ikisi de gitmeli');

  // Yalniz JBoss 8 satirlari isaretlendiginde 7 GITMEMELI: kullanicinin
  // "birini sectiremiyor" sikayetinin tam karsiligi.
  const only8 = J.toHostPairs([J.hostKey('GBCJAP01', '8'), J.hostKey('GBCJAP02', '8')]);
  assert.deepEqual([...new Set(only8.map((p) => p.jbossMajor))], ['8']);
});

// ── J6: rozet metni renge bagimli degil ─────────────────────────────────────
test('J6: rozet majoru METIN olarak yazar (renk tek basina ayirt etmez)', () => {
  assert.equal(J.jbossLabel('7'), 'JBoss 7');
  assert.equal(J.jbossLabel('8'), 'JBoss 8');
  assert.equal(J.jbossLabel(''), 'Bilinmiyor');
  const tag = codeOf('components/common/JbossTag.tsx');
  assert.ok(/jbossLabel\(major\)/.test(tag), 'rozet metni yazmiyor — ayirt etme yalniz renge kaliyor');
  // Durum renkleri (yesil/kirmizi/sari) surum bilgisine tasinmamali: ayni ekranda
  // "calisiyor/durmus" rozetleri var, iki farkli sey ayni dile girmemeli.
  for (const forbidden of ['pf-label--green', 'pf-label--red', 'pf-label--gold', 'pf-label--orange']) {
    assert.ok(!tag.includes(forbidden), `JbossTag durum rengi kullaniyor: ${forbidden}`);
  }
});
