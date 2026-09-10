// src/hooks/__tests__/async-effect-mekanizmasi.test.cjs
// `useAsyncEffect` MEKANIZMASI SILINEMEZ.
//
// NEDEN VAR — ve bu bekci bu depodaki en ONEMLI "durustluk" bekcilerinden biri:
//
// ESLint'in `react-hooks/set-state-in-effect` kurali OZEL HOOK'LARIN ICINE BAKMAZ.
// `useEffect(() => { load(); }, [])` yazan 19 cagri yeri `useAsyncEffect(...)`
// haline gelince kural onlari ARTIK DENETLEMIYOR. Yani uyari sayaci dustu, ama
// bunun bir kismi "duzeltildi", bir kismi "gorunmez oldu".
//
// Takas bilincli yapildi: 19 ayri ayri isaretlenen yer yerine TEK bir denetlenmis
// uygulama. Ama o uygulama GERCEKTEN dogru olmali ve BOYLE KALMALI. Hook'un tum
// degeri tek bir satirda: isi effect flush'indan SONRAKI mikro-goreve erteleyen
// `await Promise.resolve()`. O satir silinirse:
//
//   * cagiran callback'lerin ilk `setLoading(true)`'su yine effect govdesinde
//     SENKRON calisir (cascading render geri gelir),
//   * ve lint bunu ARTIK GOREMEZ — yani sessizce geri gelir.
//
// Bu bekci o sessizligi imkansiz kilar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const HOOK = path.join(ROOT, 'src', 'hooks', 'useAsyncEffect.ts');

const codeOnly = (src) =>
  src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

test('AM1 ERTELEME duruyor ve `run`dan ONCE geliyor', () => {
  const src = codeOnly(fs.readFileSync(HOOK, 'utf8'));
  const ertele = src.indexOf('await Promise.resolve()');
  const cagri = src.indexOf('run(');
  assert.ok(
    ertele > 0,
    'erteleme (`await Promise.resolve()`) SILINMIS — hook artik hicbir sey cozmuyor',
  );
  assert.ok(cagri > 0, 'callback hic cagrilmiyor');
  assert.ok(
    ertele < cagri,
    'erteleme `run` cagrisindan SONRA — is yine effect govdesinde senkron baslar',
  );
});

test('AM2 IPTAL mekanizmasi duruyor', () => {
  const src = codeOnly(fs.readFileSync(HOOK, 'utf8'));
  assert.match(src, /return \(\) => \{\s*live = false;/, 'temizleme fonksiyonu yok');
  assert.match(src, /run\(\(\) => live\)/, '`alive()` gercek bayragi dondurmuyor (hep true?)');
  assert.match(src, /if \(!live\) return;/, 'erteleme penceresinde sokulma kontrolu yok');
});

test('AM3 hook DAVRANIS testleriyle korunuyor (yalnizca kaynak taramasiyla degil)', () => {
  // Kaynak taramak yetmez: bu bekci "satir duruyor mu" der, davranis testi
  // "gercekten erteliyor mu" der. Ikisi birden olmali.
  const t = path.join(ROOT, 'src', 'hooks', '__tests__', 'useAsyncEffect.test.tsx');
  assert.ok(fs.existsSync(t), 'hook davranis testi YOK');
  const src = fs.readFileSync(t, 'utf8');
  for (const ad of ['AE1', 'AE2', 'AE3', 'AE4']) {
    assert.match(src, new RegExp(ad), `${ad} testi kaldirilmis`);
  }
});

test('AM4 cagri yerleri GERCEKTEN hook kullaniyor (goc geri alinmadi)', () => {
  // Uyari sayaci dustugu icin "is bitti" saniliyor olabilir; goc geri alinirsa
  // sayac yine yukselir ama SEBEBI gorunmez. Alt sinir bunu yakalar.
  const say = (dir) => {
    let n = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.tsx?$/.test(e.name) && !f.includes('__tests__')) {
          n += (fs.readFileSync(f, 'utf8').match(/useAsyncEffect\(/g) || []).length;
        }
      }
    };
    walk(dir);
    return n;
  };
  const kullanim = say(path.join(ROOT, 'src'));
  // Hook tanimi da sayilir (+1 export satiri degil, cagri yok) — 19 goc beklenir.
  assert.ok(
    kullanim >= 19,
    `yalnizca ${kullanim} yerde useAsyncEffect kullaniliyor (>=19 bekleniyor) — goc geri mi alindi?`,
  );
});
