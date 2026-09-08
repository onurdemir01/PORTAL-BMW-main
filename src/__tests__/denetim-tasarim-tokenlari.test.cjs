// src/__tests__/denetim-tasarim-tokenlari.test.cjs
//
// NEDEN VAR: Denetim sayfası portalın PF6 tasarım token'larını HİÇ kullanmıyordu —
// 288 yerde sabit Tailwind grisi (`bg-gray-100`, `text-gray-500`, `border-gray-200`)
// vardı. Sonuç: sayfa portalın geri kalanından kopuk duruyordu ve sabit griler tema
// değiştiğinde yerinde kalıyordu.
//
// 2026-09-08'de tamamı token'a çevrildi. Bu test o düzenin geri kaymasını engeller:
// yeni bir bölüm eklerken alışkanlıkla `text-gray-500` yazmak en kolay şey.
//
// ANLAM TAŞIYAN RENKLER KAPSAM DIŞI: emerald/red/amber/sky sınıfları durum anlatır
// (hücre rengi, uyarı şeridi) — onlar tasarım değil VERİ, dokunulmaz.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'components');
const FILES = [
  path.join(DIR, 'DenetimPage.tsx'),
  ...fs.readdirSync(path.join(DIR, 'denetim'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join(DIR, 'denetim', f)),
];

// `bg-white/70` gibi YARI SAYDAM kullanımlar hariç: renkli bir şeridin üstünde
// bilinçli olarak beyaz bir katman koyuyorlar, token karşılıkları yok.
const BANNED = /\b(?:bg|text|border|divide)-gray-\d+\b|\bbg-white\b(?!\/)|\btext-black\b/g;

test('Denetim dosyalarinda SABIT gri/beyaz Tailwind sinifi kalmadi', () => {
  const bulunan = [];
  for (const f of FILES) {
    const src = fs.readFileSync(f, 'utf8');
    // ui.tsx'in DOSYA BASI YORUMU eski sinif adlarini ORNEK olarak aniyor; kod degil.
    const kod = src.replace(/^\/\/.*$/gm, '');
    for (const m of kod.match(BANNED) || []) {
      bulunan.push(`${path.basename(f)}: ${m}`);
    }
  }
  assert.deepStrictEqual(
    bulunan, [],
    'Sabit renk yerine token kullanin (--text-muted, --border-subtle, --bg-elevated ...):\n  ' +
      bulunan.join('\n  '),
  );
});

test('ortak gorsel primitifler VAR ve token kullaniyor', () => {
  const ui = fs.readFileSync(path.join(DIR, 'denetim', 'ui.tsx'), 'utf8');
  for (const parca of ['Panel', 'StatTile', 'Pill', 'TableShell', 'Code', 'Note']) {
    assert.ok(new RegExp(`export function ${parca}\\b`).test(ui), `eksik primitif: ${parca}`);
  }
  assert.ok(ui.includes('var(--status-success)'), 'tonlar PF6 durum token-larindan gelmeli');
});

test('Tailwind sinif adlari calisma aninda KURULMUYOR', () => {
  // `text-${align}` gibi bir ad kaynakta metin olarak gecmedigi icin uretim
  // derlemesinde HIC olusmaz; sinif sessizce kaybolur. Bu tuzaga ui.tsx yazilirken
  // dusuldu ve duzeltildi — tekrar dusulmesin.
  for (const f of FILES) {
    // Yorumlar ayiklanir: ui.tsx'in dosya basi notu bu tuzagi ORNEK olarak aniyor.
    const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/`[^`]*\b(?:text|bg|border|p|m|w|h)-\$\{/.test(src),
      `${path.basename(f)}: Tailwind sinifi sablon degiskeniyle kuruluyor — uretimde olusmaz`,
    );
  }
});
