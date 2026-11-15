// server/logx/__tests__/regex-dogrusal.test.cjs — Sonar S8786: LogX AI yanit ayristirma ve ingest adresi
// desenleri dogrusal yazildi; yeni desen (KAYNAKTAN okunur) eskisiyle AYNI sonucu verir.
//
//   LX1 ```json citi: eski `\s*([\s\S]+?)\s*```` tembel icerik iki yandaki boslukla takas ediyordu (uzun
//       bosluk dizisinde karesel). Yeni icerik `\S(?:[\s\S]*?\S)??`: bosluksuz baslayip biten EN KISA
//       metin (bos secenek once denenir; `?` olsaydi ilk kapanista durmazdi) VEYA citte yalniz bosluk +
//       kapanis varsa eskinin geri izleyip sectigi tek bosluk: `\s(?=```)`.
//   LX2 `{...}` yedegi: eski `({[\s\S]+})` her '{'den sona tarardi; ilk '{' basarisizsa sonrakiler de
//       basarisizdir (son '}' ayni). Yeni `^[^{]*({[\s\S]+})` ilk '{'e capali; kod yalniz grup 1'i
//       kullanir (grup 1 ve eslesme var/yok ayni). Iki desen birlikte (`||`) de karsilastirilir.
//   LX3 ingest taban adresi sondaki '/' kirpma: `\/+$` -> `(?<!\/)\/+$`.
'use strict';

const { test } = require('node:test');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');

const AI = H.kaynak('server/logx/ai-analyzer.cjs');
const INGEST = H.kaynak('server/logx/v2/ingest.cjs');

const YANIT = [
  '```json',
  '```',
  '`',
  '{',
  '}',
  '{"a":1}',
  'a',
  'json',
  ' ',
  ' ',
  '\t',
  '\n',
  '\r\n',
  'ş',
];
const YANIT_UC = [
  '```json\n{"a":1}\n```',
  '```json```',
  '```json   ```',
  '```json\n```\n{"b":2}',
  'x {"a":{}} y',
  '{}',
  '{ }',
  '```json `` ```',
];

test('LX1 json citi: gruplar ve eslesme ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(AI, 'const jsonMatch = rawContent.match(');
  H.esdeger({
    eski: /```json\s*([\s\S]+?)\s*```/,
    yeni,
    tokenlar: YANIT,
    el: YANIT_UC,
    adet: 6000,
    enAzEslesen: 1000,
  });
  H.hizli(yeni, `\`\`\`json a${' '.repeat(50000)}b`);
  H.hizli(yeni, `\`\`\`json${' \n'.repeat(25000)}`);
});

test('LX2 suslu parantez yedegi ve iki desen birlikte: grup 1 ayni, kotu girdide hizli', () => {
  const cit = H.literalAl(AI, 'const jsonMatch = rawContent.match(');
  const suslu = H.literalAl(AI, ') || rawContent.match(');
  const grup1 =
    (...desenler) =>
    (s) => {
      for (const d of desenler) {
        const m = s.match(d);
        if (m) return m[1];
      }
      return null;
    };
  const ortak = { kip: 'fn', tokenlar: YANIT, el: YANIT_UC, adet: 6000, enAzEslesen: 1000 };
  H.esdeger({ ...ortak, eski: grup1(/({[\s\S]+})/), yeni: grup1(suslu) });
  H.esdeger({
    ...ortak,
    eski: grup1(/```json\s*([\s\S]+?)\s*```/, /({[\s\S]+})/),
    yeni: grup1(cit, suslu),
  });
  H.hizli(grup1(suslu), '{'.repeat(50000), { kip: 'fn' });
});

test('LX3 ingest taban adresi sondaki egik cizgi kirpma: cikti ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(INGEST, '5055}`).replace(');
  H.esdeger({
    eski: /\/+$/,
    yeni,
    kip: 'replace',
    tokenlar: ['/', '/', '/', 'http:', 'localhost:5055', 'a', ' ', '\n', 'ş'],
    enAzEslesen: 500,
  });
  H.hizli(yeni, `${'/'.repeat(50000)}a`, { kip: 'replace' });
});
