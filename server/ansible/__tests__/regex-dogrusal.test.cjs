// server/ansible/__tests__/regex-dogrusal.test.cjs — Sonar S8786: ansible modullerindeki regex'ler
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
'use strict';

const { test } = require('node:test');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');

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
