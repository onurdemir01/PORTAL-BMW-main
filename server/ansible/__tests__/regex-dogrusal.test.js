// server/ansible/__tests__/regex-dogrusal.test.js — Sonar S8786: ansible modullerindeki regex'ler
// dogrusal yazildi; yeni desen (KAYNAKTAN okunur) eskisiyle AYNI sonucu verir, kotu girdide hizli biter.
//
//   AR1 sondaki '/' kirpma: `\/+$` -> `(?<!\/)\/+$` (choice-sources x4, runner x2) ve `[/]+$` ->
//       `(?<![/])[/]+$` (runner normApiBase, long-job-cancel-token). Esdeger: replace'in en soldaki
//       eslesmesi zaten sondaki '/' dizisinin BASINDA baslar (bir onceki karakter '/' degildir); geri
//       bakis yalniz dizinin icinden yeniden denemeyi keser. Eski desen '/'... + 'a' girdisinde her
//       '/'den sona tarar: karesel.
//   AR2 degisken-gizle sir satiri (yalniz test()): anahtar kelime iceren [\w.-] kelimesi, ardindan
//       istege bagli tirnak, bosluk ve ':'. Eski: kelimenin her konumundan ve her anahtar kelimeden
//       yeniden tarama. Yeni: kelime basina capali, anahtar kelime ileri bakisla aranir, kelime bir kez
//       yenir. Ayni kelimedeki her anahtar kelime ayni kuyrugu denetledigi icin sonuc ayni.
//   AR3 ss-erisim grup anahtari (replace, g): virgul cevresindeki bosluk. Eski `\s*,\s*` uzun bosluk
//       dizisinin her konumundan virgul arardi. Yeni: bosluk yalniz dizinin basindan yenir; bir onceki
//       eslesmenin yuttugu boslugu izleyen virgul ikinci kolla (`,\s*`) yine eslesir.
//   2026-11-20 (Sonar S5843 karmasiklik / S5869 sinifta kopya; davranis ayni):
//   AR4 runner Bearer maskesi: /i altinda `[A-Za-z0-9._~+/=-]` -> `[\w.~+/=-]` (ayni 69 karakter).
//   AR5 degisken-gizle sir anahtari: tek desen (31) iki desene ayrildi (biri eslesirse sir).
//       `pass(word|wd|phrase)?` yalniz test()'te kullanildigi icin `pass` ile ayni.
//   AR6 degisken-gizle sir degerleri: `(?:export\s+)?` dustu (export'tan sonraki bosluk zaten ayirici
//       sinifinda), `[A-Za-z0-9_]` -> `\w`, Bearer / Basic siniflari /i altinda sadelesti. Liste bir
//       butun olarak (herhangi biri eslesir mi) eski listeyle ayni.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');
const { sirAnahtariMi, SIR_DEGERI } = require('../degisken-gizle.cjs');

const CHOICE = H.kaynak('server/ansible/choice-sources.cjs');
const RUNNER = H.kaynak('server/ansible/runner.cjs');
const LONGJOB = H.kaynak('server/ansible/long-job-cancel-token.cjs');
const GIZLE = H.kaynak('server/ansible/degisken-gizle.cjs');
const SSERISIM = H.kaynak('server/ansible/ss-erisim.cjs');

const EGIK = ['/', '/', '/', 'a', 'x.y', ':', '-', ' ', '\t', '\n', 'ş', 'İ'];

test('AR1 sondaki egik cizgi kirpma: 8 nokta eskisiyle ayni, kotu girdide hizli', () => {
  const noktalar = [
    [CHOICE, 'const k = kok.replace(', /\/+$/],
    [CHOICE, 'const yalin = govde.replace(', /\/+$/],
    [CHOICE, 'const yalin = onek.replace(', /\/+$/],
    [CHOICE, 'const kokSade = kokYol.replace(', /\/+$/],
    [RUNNER, 'return ham.replace(', /\/+$/],
    [RUNNER, "String(server.url || '').replace(", /\/+$/],
    [RUNNER, 'return withSlash.replace(', /[/]+$/],
    [LONGJOB, 'return withSlash.replace(', /[/]+$/],
  ];
  for (const [metin, capa, eski] of noktalar) {
    const yeni = H.literalAl(metin, capa);
    H.esdeger({ eski, yeni, kip: 'replace', tokenlar: EGIK, enAzEslesen: 500 });
    H.hizli(yeni, `${'/'.repeat(50000)}a`, { kip: 'replace' });
    H.hizli(yeni, `a${'/'.repeat(50000)}`, { kip: 'replace' });
  }
});

test('AR2 degisken-gizle sir satiri: test() sonucu ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(GIZLE, 'degerSirMi(govde) ||\n      ');
  const eski = /["']?[\w.-]*(pass|secret|token|parola|sifre)[\w.-]*["']?\s*:/i;
  H.esdeger({
    eski,
    yeni,
    kip: 'test',
    tokenlar: [
      'pass',
      'PASS',
      'Token',
      'secret',
      'sifre',
      'parola',
      'pas',
      'a',
      'x_1',
      '.',
      '-',
      '"',
      "'",
      ':',
      ': ',
      ' ',
      '\t',
      '{',
      ',',
      'ş',
      '\n',
    ],
    el: [
      'db_password: x',
      '"api.token" : 1',
      '{a: 1, sifre: 2}',
      'passwd',
      'my-secret-x  :',
      "'Parola'\t:",
    ],
    uzun: 60,
    enAzEslesen: 300,
  });
  H.hizli(yeni, `${'pass'.repeat(12500)} x`, { kip: 'test' });
  H.hizli(yeni, `${'a.'.repeat(25000)}token`, { kip: 'test' });
});

test('AR3 ss-erisim grup anahtari: virgul cevresi bosluk silme ciktisi ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(SSERISIM, '    .toLowerCase()\n    .replace(');
  H.esdeger({
    eski: /\s*,\s*/g,
    yeni,
    kip: 'replace',
    yerine: ',',
    tokenlar: [',', ',', ' ', ' ', '\t', 'cn=a', 'ou=b', 'dc=x', '\n', '\u00a0', '\u3000', 'ş'],
    el: ['cn=a , , ou=b', 'cn=a ,\t, ,ou=b ', ' , ', ',,', 'a ,b, c ,d'],
    enAzEslesen: 1000,
  });
  H.hizli(yeni, `${' '.repeat(50000)}a`, { kip: 'replace', yerine: ',' });
  H.hizli(yeni, `a${' \t'.repeat(25000)}b,`, { kip: 'replace', yerine: ',' });
});

// Kelvin isareti ve uzun s: /i altinda ASCII harfle eslesmeyen, ama toLowerCase'te k / s olan karakterler.
const HARF_UC = ['\u212a', '\u017f', 'İ', 'ı', 'ş', 'K', 'k'];

test('AR4 runner Bearer maskesi: replace ciktisi ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(RUNNER, 'return s.replace(');
  H.esdeger({
    eski: /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
    yeni,
    kip: 'replace',
    yerine: '$1***',
    tokenlar: [
      'Bearer',
      'bearer',
      ' ',
      '\t',
      'abc',
      'Z9',
      '.',
      '_',
      '~',
      '+',
      '/',
      '=',
      '-',
      ':',
      '"',
      ...HARF_UC,
    ],
    onek: ['Authorization: Bearer ', 'x Bearer '],
    adet: 8000,
    enAzEslesen: 2000,
  });
  H.hizli(yeni, `Bearer ${'a'.repeat(100000)}`, { kip: 'replace', yerine: '$1***' });
});

test('AR5 sir anahtari: iki desen eski tek desenle ayni sonuc', () => {
  const eski =
    /pass(word|wd|phrase)?|parola|sifre|secret|token|api[_-]?key|private[_-]?key|credential|webhook|(?:(?:^|[_-])pwd(?:[_-]|$))|(?:(?:^|[_-])key$)/i;
  H.esdeger({
    eski: (s) => eski.test(s),
    yeni: sirAnahtariMi,
    kip: 'fn',
    tokenlar: [
      'pass',
      'word',
      'wd',
      'phrase',
      'parola',
      'sifre',
      'secret',
      'token',
      'api',
      'private',
      'key',
      'KEY',
      'credential',
      'webhook',
      'pwd',
      '_',
      '-',
      '.',
      'db',
      'x',
      'monkey',
      ...HARF_UC,
    ],
    adet: 20000,
    maks: 6,
    enAzEslesen: 8000,
  });
  for (const [ad, beklenen] of [
    ['DB_PASSWORD', true],
    ['ssh_key', true],
    ['keystore', false],
    ['db_pwd_eski', true],
    ['pwdx', false],
    ['monkey', false],
    [undefined, false],
  ])
    assert.equal(sirAnahtariMi(ad), beklenen, String(ad));
});

test('AR6 sir degerleri: liste eskisiyle ayni sonuc, kotu girdide hizli', () => {
  const eskiListe = [
    /\b(pwd|password|parola|sifre)\s*=\s*[^;\s"']+/i,
    /(?:^|[\s;|&"'])(?:export\s+)?[A-Za-z0-9_]*(?:password|passwd|pwd|parola|sifre|secret|token|api[_-]?key)[A-Za-z0-9_]*\s*=\s*[^\s"';]+/i,
    /:\/\/[^/\s:@]+:[^@\s/]+@/,
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
    /\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}\b/i,
    /[?&](sig|signature|token|access_token|api[_-]?key|code)=[^&\s"']{8,}/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /--(password|passwd|pwd|token|secret|api-key)[= ]\S+/i,
  ];
  assert.equal(SIR_DEGERI.length, eskiListe.length);
  const herhangi = (liste) => (s) => liste.some((d) => d.test(s));
  H.esdeger({
    eski: herhangi(eskiListe),
    yeni: herhangi(SIR_DEGERI),
    kip: 'fn',
    tokenlar: [
      'export',
      'PG',
      'PASSWORD',
      'passwd',
      'MY_',
      'token',
      'api-key',
      'apikey',
      '=',
      ' ',
      '\t',
      ';',
      '|',
      '&',
      '"',
      "'",
      'v4l',
      'Bearer ',
      'Basic ',
      'abcdefgh12345678',
      'QUJD+/==',
      '://u:p@h',
      '?sig=',
      '--token ',
      ...HARF_UC,
    ],
    onek: ['export ', 'x ', 'cmd;'],
    adet: 20000,
    maks: 10,
    enAzEslesen: 6000,
  });
  H.hizli(herhangi(SIR_DEGERI), `${'export '.repeat(20000)}x`, { kip: 'fn' });
  H.hizli(herhangi(SIR_DEGERI), ` ${'a'.repeat(100000)}=`, { kip: 'fn' });
});
