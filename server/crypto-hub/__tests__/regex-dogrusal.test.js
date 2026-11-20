// server/crypto-hub/__tests__/regex-dogrusal.test.js — Sonar S8786: Crypto Hub YAML satir desenleri
// ve URL parcalayici dogrusal yazildi; yeni desen (KAYNAKTAN okunur) eskisiyle AYNI gruplari verir.
//
//   CR1 `anahtar: deger` (index maskValues, resources sir anahtari): eski `\s*(.+?)\s*$` tembel deger ile
//       sondaki bosluk karakter takas ediyordu (uzun bosluk + satir sonu girdisinde karesel). Yeni deger
//       `\S(?:.*\S)?` (bosluksuz baslar / biter, satir sonu gecmez) VEYA deger yalniz bosluksa eskinin
//       geri izleyip sectigi SON satir-ici bosluk karakteri: `[^\S<satir sonu>](?=<satir sonu>*$)`.
//       resources'ta onek `\s*-?\s*` -> `\s*(?:-\s*)?` (ayni grup 1, `\s*\s*` takasi yok).
//       2026-11-20 (Sonar S5843 karmasiklik 22 > 20, S5869): iki kol iki desen oldu, kod onlari sirayla
//       dener (DEGERLI || BOS). Iki kol ayni satirda birlikte eslesemez (biri bosluk disi karakter ister,
//       digeri yalniz bosluk); ':' konumu onekten bagimsiz oldugu icin gruplar tek desenle ayni.
//       `[^\S<satir sonu>]` -> `(?!<satir sonu>)\s` (ayni 21 karakter; Sonar sinifta kopya goruyordu).
//   CR2 resources blok anahtari: tembel `[^:#]*?` ile `\s*` takasi -> `(?:[^:#]*[^\s:#])?` (anahtar
//       bosluksuz biter; ':' oncesi bosluk `\s*`a kalir: tek gecerli bolme).
//   CR3 resources `#` yorum kirpma: girdi `(.*)$` grubu (satir sonu icermez) -> `#.*$` == `#.*`.
//       Ikisi birlikte (dis desen + ic replace) satir uzerinden karsilastirilir.
//   CR4 resources `name:` / `value:` ve values-compare `anahtar: deger`: `\s*(.*)$` -> `\s*(?!\s)(.*)$`.
//       Eski desen yalniz en uzun bosluk bolmesinde basarili olabilirdi (kisa bolme `.*`a satir sonu
//       verir); ileri bakis bu bolmeyi zorlar, basarisizlikta bosluk geri izlemesi O(1).
//   CR5 shared/cryptoHubNodes URL_PARCA_RE: `([^/?#]*)(.*)$` -> `([^/?#]*)(?![^/?#])(.*)$` (grup 2 her
//       zaman en uzun kosu; eski desen de yalniz onunla basarili olabilirdi).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../__tests__/fixtures/regex-esdeger.cjs');

const INDEX = H.kaynak('server/crypto-hub/index.cjs');
const RES = H.kaynak('server/crypto-hub/resources.cjs');
const VC = H.kaynak('server/crypto-hub/values-compare.cjs');
const NODES = H.kaynak('shared/cryptoHubNodes.cjs');

const BOSLUK = [' ', ' ', '\t', '\n', '\r', '\u00a0', '\u2028', '\u2029', '\u3000'];
const YAML = [
  'key',
  'db.pass',
  'a_b-c',
  ':',
  ':',
  ': ',
  '-',
  '- ',
  'x',
  'v v',
  '#',
  '|',
  '"q"',
  "'s'",
  '{}',
  'ş',
  ...BOSLUK,
  ...BOSLUK,
];
const VC_ONEK = ['a/b: ', '  - k.x:', '- a/b :', 'k:', '  key:\t'];
const KV_ONEK = ['key: ', '  db.pass:', '- a_b-c :', 'password:', '  token:\t', '  - k: v'];
const YAML_UC = [
  'password:   ',
  'password: \t\n',
  'password:\n',
  'password:',
  '  token: abc  ',
  'k: a\r',
  'k: a\rb',
  'k: \n x',
  '  - name: DB_PASS',
  '- value: |',
  'value:',
  'a/b.c: d',
  '"q q": x',
  "'k' : v",
  'k#x: y',
];

test('CR1 anahtar: deger (index + resources) gruplari ayni, kotu girdide hizli', () => {
  // Kodun yaptigi gibi: once DEGERLI, eslesmezse BOS.
  const sirayla = (a, b) => (s) => {
    const m = a.exec(s) || b.exec(s);
    return m ? { g: [...m], i: m.index } : null;
  };
  const tekDesen = (re) => (s) => {
    const m = re.exec(s);
    return m ? { g: [...m], i: m.index } : null;
  };
  assert.match(INDEX, /const m = l\.match\(KV_DEGERLI\) \|\| l\.match\(KV_BOS\);/);
  assert.match(RES, /const k = MANIFEST_KV_DEGERLI\.exec\(l\) \|\| MANIFEST_KV_BOS\.exec\(l\);/);
  const noktalar = [
    [
      [H.literalAl(INDEX, 'const KV_DEGERLI = '), H.literalAl(INDEX, 'const KV_BOS = ')],
      /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/,
    ],
    [
      [
        H.literalAl(RES, 'const MANIFEST_KV_DEGERLI = '),
        H.literalAl(RES, 'const MANIFEST_KV_BOS ='),
      ],
      /^(\s*-?\s*)([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/,
    ],
  ];
  for (const [[degerli, bos], eski] of noktalar) {
    const yeni = sirayla(degerli, bos);
    H.esdeger({
      eski: tekDesen(eski),
      yeni,
      kip: 'fn',
      tokenlar: YAML,
      el: YAML_UC,
      onek: KV_ONEK,
      adet: 6000,
      enAzEslesen: 600,
    });
    for (const kotu of [
      `k: a${' '.repeat(50000)}b\nc`,
      `k:${' \t'.repeat(25000)}`,
      `k:${' '.repeat(50000)}x\ny`,
      `k:${'\n'.repeat(50000)}`,
      `${' '.repeat(50000)}k`,
    ])
      H.hizli(yeni, kotu, { kip: 'fn' });
  }
});

test('CR2 resources blok anahtari gruplari ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(RES, 'if (blokGirinti < 0) blokGirinti = girinti;\n        const m = ');
  H.esdeger({
    eski: /^(\s*)("[^"]*"|'[^']*'|[^\s:#][^:#]*?)\s*:(\s|$)/,
    yeni,
    tokenlar: YAML,
    el: YAML_UC,
    adet: 6000,
    enAzEslesen: 1000,
  });
  H.hizli(yeni, `a${' '.repeat(50000)}b`);
  H.hizli(yeni, `a${' b'.repeat(25000)}#`);
});

test('CR3 resources data/stringData yorum kirpma: dis desen + ic replace birlikte ayni', () => {
  const dis = H.literalAl(RES, 'if (secret[i] && girinti === 0) {\n      const m = ');
  const ic = H.literalAl(RES, 'const rest = m[2].replace(');
  const kirp = (icDesen) => (l) => {
    const m = dis.exec(l);
    return m ? m[2].replace(icDesen, '').trim() : null;
  };
  H.esdeger({
    eski: kirp(/#.*$/),
    yeni: kirp(ic),
    kip: 'fn',
    tokenlar: ['#', '#', 'a', ' # b', ' ', 'x:y', '\t', 'ş', '\n'],
    maks: 12,
    onek: ['data:', 'stringData:', 'data: ', 'stringData:\t'],
    enAzEslesen: 400,
  });
  H.hizli(kirp(ic), `data:${'#'.repeat(50000)}`, { kip: 'fn' });
});

test('CR4 name: / value: / values-compare anahtar: deger gruplari ayni, kotu girdide hizli', () => {
  const noktalar = [
    [
      H.literalAl(RES, 'const ad = '),
      /^(\s*)-?\s*name:\s*["']?([A-Za-z0-9_.-]+)["']?\s*$/,
      ['name: ', '  - name:', '- name: "', "name: '", '  name:\t'],
    ],
    [
      H.literalAl(RES, 'const v = '),
      /^(\s*)(-\s*)?value:\s*(.*)$/,
      ['value: ', '  - value:', '- value: |', 'value:', '  value:\t'],
    ],
    [
      H.literalAl(VC, "startsWith('#')) continue;\n    const m = l.match("),
      /^(\s*)(-\s*)?([A-Za-z0-9_.\-/]+)\s*:\s*(.*)$/,
      VC_ONEK,
    ],
    [
      H.literalAl(VC, "startsWith('#')) continue;\n      const m = l.match("),
      /^(\s*)(-\s*)?([A-Za-z0-9_.\-/]+)\s*:\s*(.*)$/,
      VC_ONEK,
    ],
  ];
  for (const [yeni, eski, onek] of noktalar) {
    H.esdeger({
      eski,
      yeni,
      tokenlar: ['"', "'", 'DB_PASS', 'x', 'a.b', '|', ' ', ' ', '\t', ...YAML],
      el: YAML_UC,
      onek,
      adet: 6000,
      maks: 10,
      enAzEslesen: 200,
    });
    H.hizli(yeni, `${onek[0]}${' '.repeat(50000)}x\ny`);
    H.hizli(yeni, `${' '.repeat(50000)}x`);
  }
});

test('CR5 cryptoHubNodes URL_PARCA_RE gruplari ayni, kotu girdide hizli', () => {
  const yeni = H.literalAl(NODES, 'const URL_PARCA_RE = ');
  H.esdeger({
    eski: /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/,
    yeni,
    tokenlar: ['//', '/', '?', '#', 'h', 'host.x', ':', '8443', '@', 'ş', ...BOSLUK],
    el: ['https://h:1/p?q#f', 'a://\n/', 'a://x\ny/z', 'ldaps://dc.local'],
    onek: ['https://', 'a+b.c-d://', 'x://', '1://'],
    adet: 6000,
    enAzEslesen: 500,
  });
  H.hizli(yeni, `a://${'x'.repeat(50000)}/\n`);
  H.hizli(yeni, `a://${'x\n'.repeat(25000)}/\n`);
});
