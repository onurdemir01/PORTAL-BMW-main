// src/__tests__/inline-color-leaks.test.cjs — uyum katmaninin ULASAMADIGI renkler.
//
// Tailwind uyum katmani (index.css) SADECE SINIF ADLARINI yakalar; `style={{}}` icinde
// yazilmis sabit hex'lere ULASAMAZ. Bu yuzden 11 dosyada 70 sabit renk vardi ve bir
// kismi koyu temada gercekten patliyordu:
//   * AnsiblePage: #fef3c7 / #fee2e2 — acik sari/kirmizi uyari kartlari
//   * DynamicTable: rgba(242,246,255,.95) — yapiskan tablo basligi acik mavi bant
//   * ImportantLinksPage / AnsiblePage sayfalama: `background: var(--accent)` uzerine
//     SABIT beyaz metin — koyu temada aksan artik ACIK MAVI oldugu icin (PF6) metin
//     GORUNMEZ olurdu. btn-primary'de duzeltilen hatanin aynisi.
//
// AMA HER RENK TOKEN'A CEVRILMEZ. Iki bilincli istisna var; bu test onlari da korur
// ki sonradan "eksik kalmis" diye yanlislikla cevrilmesinler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}
const TSX = walk(ROOT);

// BILINCLI ISTISNALAR:
//  - LoginPage: temayi IZLEMEYEN ayri bir marka ekrani. Her zaman koyu zemin uzerinde
//    BEYAZ bir kart; token'a baglamak koyu temada karti da koyulastirir, okunmaz olurdu.
//  - MissionOrbit: `${item.color}1a` ile HEX-ALFA birlestirmesi yapiyor.
//    `var(--accent)1a` gecersiz CSS'tir; tarayici kurali tumden atar ve HATA DA VERMEZ.
const ALLOWED = new Set(['LoginPage.tsx', 'MissionOrbit.tsx']);

test('style={{}} icinde sabit hex renk kalmadi (istisnalar haric)', () => {
  const offenders = [];
  for (const f of TSX) {
    if (ALLOWED.has(path.basename(f))) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(background|backgroundColor|color|borderColor)\s*:\s*"#[0-9a-fA-F]{3,8}"/g)) {
      offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `uyum katmani bunlara ULASAMAZ:\n${offenders.join('\n')}`);
});

test('aksan zemini uzerinde SABIT beyaz metin kalmadi', () => {
  // Koyu temada `--accent` artik acik mavi (#b9dafc); beyaz metin GORUNMEZ olur.
  const offenders = [];
  for (const f of TSX) {
    const src = fs.readFileSync(f, 'utf8');
    if (/background: "var\(--accent\)", color: "#fff"/.test(src)) offenders.push(path.relative(ROOT, f));
  }
  assert.deepEqual(offenders, [], `aksan ustunde sabit beyaz metin: ${offenders.join(', ')}`);
});

test('terminal renkleri TOKEN’DA ama TEMADAN BAGIMSIZ (bilincli)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');
  for (const t of ['--term-bg', '--term-fg', '--term-success', '--term-danger', '--term-warning', '--term-info', '--term-muted']) {
    assert.ok(css.includes(`${t}:`), `terminal token eksik: ${t}`);
  }
  // Koyu tema blogunda YENIDEN TANIMLANMAMALI: bir terminal acik temada da koyudur.
  const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"] {'));
  const end = darkBlock.indexOf('\n}');
  assert.ok(!/--term-/.test(darkBlock.slice(0, end)),
    'terminal renkleri koyu temada yeniden tanimlanmis — terminal her temada koyu kalmali');
});

test('terminal saydamliklari HEX-ALFA birlestirmesiyle URETILMIYOR', () => {
  // `${meta.color}55` kalibi token'a gecerken SESSIZCE bozulurdu:
  // `var(--term-success)55` gecerli CSS degildir, tarayici kurali tumden atar
  // (kenarlik ve parilti kaybolur, konsolda hata gorunmez).
  const src = fs.readFileSync(path.join(ROOT, 'components/common/AnsibleLogTerminal.tsx'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\$\{meta\.color\}[0-9a-fA-F]{2}/.test(src), 'hex-alfa birlestirmesi duruyor');
  assert.match(src, /rgb\(\$\{meta\.rgb\} \/ 0\.\d+\)/, 'saydamlik icin rgb(R G B / A) kullanilmali');
});

test('yapiskan tablo basligi ORTAK siniftan, sabit renksiz', () => {
  const css = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');
  assert.match(css, /\.pf-table-sticky thead th \{/);
  // Yorumlar KALDIRILAN degeri ANLATMAK icin ondan alinti yapiyor — gercek KODA bak.
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/rgba\(242,\s*246,\s*255/.test(cssCode), 'eski acik mavi yapiskan zemin duruyor');

  const dyn = fs.readFileSync(path.join(ROOT, 'components/envanter/DynamicTable.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.ok(!/backdropFilter: "blur\(8px\)"/.test(dyn), 'yari saydam+bulanik baslik duruyor');
  assert.match(dyn, /pf-table-sticky/);

  // Uzun tablosu olan ekranlarin hepsinde olmali.
  for (const f of ['DenetimPage.tsx', 'DutyRosterPage.tsx',
                   'admin/tabs/SmartTicketsTab.tsx', 'admin/tabs/OcoSchedulesPanel.tsx']) {
    const src = fs.readFileSync(path.join(ROOT, 'components', f), 'utf8');
    assert.match(src, /pf-table-sticky/, `${f}: yapiskan baslik yok, 50+ satirda baslik kayboluyor`);
  }
});

test('tablo bos-durum satiri ORTAK bilesenden', () => {
  const es = fs.readFileSync(path.join(ROOT, 'components/common/EmptyState.tsx'), 'utf8');
  assert.match(es, /export function TableEmptyRow/);
  assert.match(es, /colSpan: number/, 'colSpan zorunlu olmali — eksikse hucre tek kolona sikisir');

  for (const f of ['DenetimPage.tsx', 'envanter/DynamicTable.tsx', 'admin/tabs/SmartTicketsTab.tsx']) {
    const src = fs.readFileSync(path.join(ROOT, 'components', f), 'utf8');
    assert.match(src, /<TableEmptyRow colSpan=/, `${f}: hala elle yazilmis bos-durum satiri`);
  }
});
