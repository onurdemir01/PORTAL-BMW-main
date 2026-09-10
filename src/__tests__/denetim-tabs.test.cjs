// src/__tests__/denetim-tabs.test.cjs
//
// NEDEN VAR: Denetim sayfasında bir sekme ÜÇ ayrı yerde tanımlı — sekme çubuğu listesi,
// `tab === "..."` render satırı ve yardım (HELP) bölümü. Üçü elle senkron tutuluyor.
// 2026-09-08'de "Envanter Değişim" sekmesi eklenirken tam bu ayrışma yaşandı: sekme
// çubuğa ve render satırına eklendi ama BİLEŞEN İMPORT EDİLMEDİ. Vite typecheck
// yapmadığı için `npm run build` sorunsuz geçti; hata yalnızca `tsc` ile yakalandı ve
// üretime gitseydi sekmeye tıklayınca sayfa çökerdi.
//
// Bu test o üçlüyü kaynak düzeyinde kilitler.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'components', 'DenetimPage.tsx'), 'utf8');

/** Sekme çubuğundaki `{ id: "x", label: "...", icon: ... }` girdileri. */
function tabIds() {
  // TIRNAK CINSINDEN BAGIMSIZ: prettier bu dosyayi ilk kez bicimlendirdiginde
  // (2026-09-10) JS dizeleri TEK tirnaga dondu ve bu toplayici SIFIR sekme
  // dondurdu. Kotusu: bos liste, ALTTAKI "her sekmenin render satiri var"
  // testini de SESSIZCE gecirdi — dongu hic donmedi. Olcut BICIM degil KURAL.
  const bas = SRC.search(/\{\s*id:\s*["']nginx["']/);
  // BITIS ISARETI DE BICIMDEN BAGIMSIZ: `] as const).map` tek parca yazilmisti;
  // prettier diziyi cok satira boldugunde `]` ile `as const` arasina satir sonu
  // girdi ve isaret KAYBOLDU.
  const kalan = bas >= 0 ? SRC.slice(bas) : '';
  const son = kalan.search(/\]\s*as const\s*\)?\s*[\n.]/);
  const bar = bas >= 0 && son > 0 ? kalan.slice(0, son) : '';
  const ids = [...bar.matchAll(/\{\s*id:\s*["']([a-z]+)["']/g)].map((m) => m[1]);
  // ALT SINIR — TOPLAYICI SESSIZCE BOSALMASIN.
  //
  // 2026-09-10: prettier bu dosyayi ilk kez bicimlendirdiginde toplayici SIFIR
  // sekme dondurdu ve alttaki UC test birden `for (const id of [])` ile SESSIZCE
  // GECTI. Yani sekme cubugu tamamen bozulsa bile bekciler yesil kalirdi.
  if (ids.length < 6) {
    throw new Error(
      `sekme toplayici bozuk: yalnizca ${ids.length} sekme okundu. ` +
        'DenetimPage.tsx bicimlendirilmis olabilir; tabIds() desenini gozden gecirin.',
    );
  }
  return ids;
}

test('sekme listesi okunabiliyor (regex bozulmadi)', () => {
  const ids = tabIds();
  assert.ok(ids.length >= 6, `sekme bulunamadi (${ids.length})`);
  assert.ok(ids.includes('nginx') && ids.includes('degisim'), ids.join(','));
});

test('HER sekmenin bir render satiri var', () => {
  for (const id of tabIds()) {
    assert.ok(
      new RegExp(`\\{\\s*tab === ["']${id}["']\\s*&&`).test(SRC),
      `"${id}" sekmesi cubukta var ama render edilmiyor — tiklayinca bos ekran gelir`,
    );
  }
});

test('HER sekmenin render ettigi bilesen IMPORT EDILMIS', () => {
  // Asil yakalanmak istenen hata bu: import unutulunca Vite build gecer, sekmeye
  // tiklandiginda uygulama coker.
  for (const id of tabIds()) {
    const m = SRC.match(new RegExp(`\\{\\s*tab === ["']${id}["']\\s*&& <([A-Za-z0-9_]+)`));
    assert.ok(m, `"${id}" icin render satiri cozulemedi`);
    const comp = m[1];
    // Varsayilan (`import X from`) VE adlandirilmis (`import { X } from`) import'un
    // ikisi de gecerlidir; guard onceden yalnizca ilkini taniyordu ve adlandirilmis
    // import eden YENI bir sekmeyi yanlislikla "import edilmemis" sayiyordu.
    const imported =
      new RegExp(`import ${comp} from`).test(SRC) ||
      new RegExp(`import\\s*\\{[^}]*\\b${comp}\\b[^}]*\\}\\s*from`).test(SRC) ||
      new RegExp(`function ${comp}\\b`).test(SRC) ||
      new RegExp(`const ${comp}\\b`).test(SRC);
    assert.ok(
      imported,
      `<${comp}/> render ediliyor ama ne import edilmis ne de bu dosyada tanimli`,
    );
  }
});

test('sekme tipi (union) cubuktaki TUM id-leri iceriyor', () => {
  // Tip listesi eksik kalirsa tsc hata verir; burada da kilitlenir ki hata mesaji
  // "neden" sorusunu dogrudan yanitlasin.
  const m = SRC.match(/useState<([^>]*)>\(["']nginx["']\)/);
  assert.ok(m, 'sekme durumu (useState) bulunamadi');
  for (const id of tabIds()) {
    assert.ok(new RegExp(`["']${id}["']`).test(m[1]), `sekme tipinde eksik: ${id}`);
  }
});

test('yardim bolumleri sekme sayisiyla uyumlu', () => {
  // Birebir esitlik ARANMIYOR: yardim baslikları sekme adlarindan farkli yazilabilir
  // (or. "Envanter Audit" sekmesi "Envanter Audit" basligiyla anlatiliyor). Kontrol,
  // yeni bir sekme eklenip yardimin HIC guncellenmemesini yakalamak icin.
  const helpCount = (SRC.match(/^\s{4,}title: ["']/gm) || []).length;
  assert.ok(
    helpCount >= tabIds().length,
    `${tabIds().length} sekme var ama yalnizca ${helpCount} yardim bolumu — yeni sekme anlatilmamis olabilir`,
  );
});
