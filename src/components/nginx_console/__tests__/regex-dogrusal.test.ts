// src/components/nginx_console/__tests__/regex-dogrusal.test.ts — Sonar S8786: NGINX Console / Yuk Testi
// desenleri dogrusal yazildi. Yeni desen KAYNAKTAN okunur, eski desen yalniz referans; sozlesme sunucu
// tarafiyla ortak (server/__tests__/fixtures/regex-esdeger.cjs).
//
//   NC1 capasiz surum / oran desenleri (NimTabs, OnKontrolPaneli, RateLimitTab): bastaki `\d+` / `[\d.]+`
//       her rakam konumundan yeniden deneniyordu. Geri bakis eslesmeyi kosunun basina capalar; en soldaki
//       eslesme zaten oradan baslar (bir onceki karakter kosuya ait olsaydi oradan da eslesirdi).
//   NC2 harSenaryo %g sondaki sifirlar: `0+$` -> `(?<!0)0+$`.
//   NC3 nedenler `arka_plan_yok:` kodu: tembel `(.+?)\(` her '(' adayindan `.*\)$` ile sona tarardi. Yeni
//       grup 1 ilk karakter + ilk '(' ya da satir sonuna kadar olan kosu; ilk aday basarisizsa sonraki
//       adaylar da basarisizdir (son ')' ve satir sonu kosulu ayni). Grup 1 ayni.
import { describe, it } from 'vitest';
import * as H from '../../../../server/__tests__/fixtures/regex-esdeger.cjs';

const kok = 'src/components/nginx_console';
const NIM = H.kaynak(`${kok}/NimTabs.tsx`);
const ORAN = H.kaynak(`${kok}/RateLimitTab.tsx`);
const ONK = H.kaynak(`${kok}/yukTesti/OnKontrolPaneli.tsx`);
const HAR = H.kaynak(`${kok}/yukTesti/harSenaryo.ts`);
const NEDEN = H.kaynak(`${kok}/yukTesti/nedenler.ts`);

const SURUM_ONEK = ['1.2.', 'nginx/1.', 'wrk 4.2.0 ', 'x1.24'];
const SURUM = [
  '1',
  '2',
  '25',
  '.',
  '.',
  '-',
  'nginx/',
  ' (nginx-plus-r30)',
  'a',
  ' ',
  '\u0663',
  'ş',
];

describe('Sonar S8786 dogrusal desenler (NGINX Console)', () => {
  it('NC1 surum ve oran desenleri: gruplar ayni, kotu girdide hizli', () => {
    const noktalar: [RegExp, RegExp, string[], string[]][] = [
      [H.literalAl(NIM, 'const version = (s.match('), /(\d+\.\d+\.\d+)/, SURUM, SURUM_ONEK],
      [H.literalAl(ONK, 'const surum = o.wrkSurum ? ('), /\d+\.\d+(?:\.\d+)?/, SURUM, SURUM_ONEK],
      [
        H.literalAl(ORAN, 'if (!v) return null;\n  const m = '),
        /([\d.]+)\s*r\/(s|m)/i,
        ['1', '0', '.', '.', 'r', '/', 's', 'm', 'M', 'R', ' ', 'x', 'r/s', '500r/m'],
        ['500r/', '1.5 r/', '10 R/', '.r/'],
      ],
    ];
    for (const [yeni, eski, tokenlar, onek] of noktalar) {
      H.esdeger({ eski, yeni, tokenlar, onek, adet: 6000, enAzEslesen: 500 });
      H.hizli(yeni, '1'.repeat(50000));
      H.hizli(yeni, `${'1.'.repeat(25000)}x`);
    }
  });

  it('NC2 harSenaryo sondaki sifir kirpma: cikti ayni, kotu girdide hizli', () => {
    const yeni = H.literalAl(HAR, "const kirp = (s: string) => (s.includes('.') ? s.replace(");
    H.esdeger({
      eski: /0+$/,
      yeni,
      kip: 'replace',
      tokenlar: ['0', '0', '0', '1', '5', '.', '-', 'e'],
      el: ['1.50000', '2.00000', '100', '0.00000', '-1.20000'],
      enAzEslesen: 1000,
    });
    H.hizli(yeni, `${'0'.repeat(50000)}1`, { kip: 'replace' });
  });

  it('NC3 nedenler arka_plan_yok kodu: grup ayni, kotu girdide hizli', () => {
    const yeni = H.literalAl(NEDEN, "olduğundan yüksek çıkabilir.',\n  },\n  {\n    re: ");
    H.esdeger({
      eski: /^arka_plan_yok:(.+?)\(.*\)$/,
      yeni,
      tokenlar: ['(', '(', ')', ')', ')', 'R1', 'a', ' ', 'İ', '\n'],
      el: [
        'arka_plan_yok:(x)',
        'arka_plan_yok:((x)',
        'arka_plan_yok:a(b)c(d)',
        'arka_plan_yok:a(b\n)',
        'arka_plan_yok:a(b)\r',
        'arka_plan_yok:a\u2028(b)',
      ],
      onek: ['arka_plan_yok:', 'arka_plan_yok:R2'],
      adet: 6000,
      maks: 8,
      enAzEslesen: 150,
    });
    H.hizli(yeni, `arka_plan_yok:a${'('.repeat(50000)}`);
    H.hizli(yeni, `arka_plan_yok:${'a('.repeat(25000)}\n)`);
  });
});
