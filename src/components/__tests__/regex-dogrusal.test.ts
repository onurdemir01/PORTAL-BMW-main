// src/components/__tests__/regex-dogrusal.test.ts — Sonar S8786: arayuz bilesenlerindeki desenler dogrusal
// yazildi. Yeni desen KAYNAKTAN okunur, eski desen yalniz referans; sozlesme sunucu tarafiyla ortak
// (server/__tests__/fixtures/regex-esdeger.cjs).
//
//   UI1 sondaki dizi kirpma `X+$` -> `(?<!X)X+$` (RetirementTab '/', Dynatrace URL sonu noktalama) ve
//       servis adi kisa cizgileri `^-+|-+$` (g): en soldaki eslesme zaten dizinin basinda baslar.
//   UI2 e-posta (PageVisibilityTab, test): alan adi = ilk karakter + '.' icermeyen kosu + ilk '.' + kalan.
//   UI3 ondalik sayi (SelfServicePage, test): `^-?\d*\.?\d+$` -> `^-?(?:\d*\.)?\d+$` (ayni dil: nokta
//       yoksa `\d*\d+` == `\d+`), rakam takasi yok.
//   UI4 grup anahtari (SsErisimBolumu, replace g): sunucudaki ss-erisim ile ayni yazim.
//   UI5 NginxEnvanteri surumAyristir: `(\d+\.\d+)((?:\.\d+)*)(.*)$` sayi kosularini ileri bakisla en uzun
//       bolmeye zorlar (eski desen yalniz o bolmede basarili olabilirdi); gruplar ve islev sonucu ayni.
import { describe, expect, it } from 'vitest';
import * as H from '../../../server/__tests__/fixtures/regex-esdeger.cjs';
import { surumAyristir } from '../denetim/NginxEnvanteri';

const SSP = H.kaynak('src/components/SelfServicePage.tsx');
const PVT = H.kaynak('src/components/admin/tabs/PageVisibilityTab.tsx');
const NGX = H.kaynak('src/components/denetim/NginxEnvanteri.tsx');
const DYN = H.kaynak('src/components/dynatrace/DynatracePage.tsx');
const SSE = H.kaynak('src/components/self_service/SsErisimBolumu.tsx');
const RET = H.kaynak('src/components/server_hub/RetirementTab.tsx');

describe('Sonar S8786 dogrusal desenler (arayuz)', () => {
  it('UI1 sondaki dizi ve kisa cizgi kirpma: cikti ayni, kotu girdide hizli', () => {
    const noktalar: [RegExp, RegExp, string][] = [
      [H.literalAl(RET, 'const temiz = yol.replace('), /\/+$/, '/'],
      [H.literalAl(DYN, 'problemId).replace('), /[.,)\s]+$/, '.,) '],
      [H.literalAl(SSP, ".replace(/[^a-z0-9]+/g, '-')\n      .replace("), /^-+|-+$/g, '-'],
    ];
    for (const [yeni, eski, x] of noktalar) {
      H.esdeger({
        eski,
        yeni,
        kip: 'replace',
        tokenlar: [...x, ...x, 'a', 'pid=1', '/sw/app', '(', ' ', '\t', '\n', 'ş'],
        enAzEslesen: 500,
      });
      H.hizli(yeni, `a${x.repeat(20000)}a`, { kip: 'replace' });
    }
  });

  it('UI2 PageVisibilityTab e-posta: test() sonucu ayni, kotu girdide hizli', () => {
    const yeni = H.literalAl(PVT, "kind === 'email'\n      ? ");
    H.esdeger({
      eski: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
      yeni,
      kip: 'test',
      tokenlar: ['a', 'b', 'com', 'tr', 'ş', '.', '.', '.', 'x.y', '@', ' ', '\n'],
      el: ['a@b.c', 'a@.b.c', 'a@b.', 'a@.b', 'a@b..c', 'a@b@c.d'],
      onek: ['ali@', 'a.b@', 'ş@'],
      maks: 6,
      enAzEslesen: 150,
    });
    H.hizli(yeni, `a@${'.a'.repeat(25000)} `, { kip: 'test' });
  });

  it('UI3 SelfServicePage ondalik sayi: test() sonucu ayni, kotu girdide hizli', () => {
    const yeni = H.literalAl(SSP, "if (f.type === 'float' && !");
    H.esdeger({
      eski: /^-?\d*\.?\d+$/,
      yeni,
      kip: 'test',
      tokenlar: ['-', '1', '0', '9', '.', '.', 'e', ' ', '\u0663'],
      el: ['-.5', '.5', '5.', '1.2.3', '-', '--1', '007'],
      maks: 8,
      enAzEslesen: 200,
    });
    H.hizli(yeni, `${'1'.repeat(50000)}a`, { kip: 'test' });
  });

  it('UI4 SsErisimBolumu grup anahtari: cikti ayni, kotu girdide hizli', () => {
    const yeni = H.literalAl(SSE, 'g.trim().toLowerCase().replace(');
    H.esdeger({
      eski: /\s*,\s*/g,
      yeni,
      kip: 'replace',
      yerine: ',',
      tokenlar: [',', ',', ' ', ' ', '\t', 'cn=a', 'ou=b', '\n', '\u00a0', 'ş'],
      el: ['cn=a , , ou=b', ' , ', ',,'],
      enAzEslesen: 1000,
    });
    H.hizli(yeni, `${' '.repeat(50000)}a`, { kip: 'replace', yerine: ',' });
  });

  it('UI5 NginxEnvanteri surum deseni ve surumAyristir: sonuc ayni, kotu girdide hizli', () => {
    const yeni = H.literalAl(NGX, 'bilinmiyor: true };\n  const m = ');
    const eski = /^(?:nginx(?:-plus)?\/)?(\d+\.\d+)((?:\.\d+)*)(.*)$/i;
    const tokenlar = [
      'nginx/',
      'NGINX-plus/',
      '1',
      '24',
      '.',
      '.',
      ' (r30)',
      'x',
      ' ',
      '\n',
      '\u0663',
    ];
    H.esdeger({
      eski,
      yeni,
      tokenlar,
      onek: ['1.', 'nginx/1.', 'NGINX-plus/2.', '1.25.'],
      adet: 6000,
      enAzEslesen: 300,
    });
    H.hizli(yeni, `1.${'1'.repeat(50000)}\nx`);
    H.hizli(yeni, `1.1${'.1'.repeat(25000)}\nx`);
    const eskiAyristir = (v: string) => {
      const ham = String(v ?? '').trim();
      if (/^(unknown|\(bilinmiyor\)|n\/a|-)?$/i.test(ham))
        return { ham, aile: '', yama: '', ek: '', bilinmiyor: true };
      const m = eski.exec(ham);
      if (!m) return { ham, aile: ham, yama: '', ek: '', bilinmiyor: false };
      return { ham, aile: m[1], yama: m[2], ek: m[3].trim(), bilinmiyor: false };
    };
    for (const s of H.girdiler({ tokenlar, adet: 2000 }))
      expect(surumAyristir(s)).toEqual(eskiAyristir(s));
  });
});
