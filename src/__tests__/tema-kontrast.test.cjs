// src/__tests__/tema-kontrast.test.cjs — METIN OKUNUR MU? (2026-10-07)
//
// Gercek tarayici taramasinda dort ayri "gorunmeyen / okunmayan metin" sinifi cikti; hepsi
// tema token'larinin YANLIS CIFTLENMESINDEN geliyordu ve hicbir test olcmuyordu:
//
//   1. Acik temada butun sari uyari metinleri 2.0-2.2:1 (`--status-warning` hem ikon hem METIN
//      rengiydi; `text-amber-*` siniflari ona esliydi).
//   2. Acik temada `bg-black text-white` dugmeler 1.12:1 (`.bg-black -> --masthead-bg`,
//      masthead PF6'da acik temada #f2f2f2 oldu).
//   3. Koyu temada aksan zemini ustunde sabit beyaz metin 1.45:1 (koyuda aksan ACIK mavi).
//   4. 403 sayfasinda dugme metni 1.0:1 (`a { color }` kurali `text-white`i eziyordu).
//
// Bu bekci ORANI HESAPLAR (WCAG 2.x goreli parlaklik); token degerlerini `index.css`ten okur.
// Bir token degisir ve metin esigin altina duserse kizarir. Esik: normal metin icin AA = 4.5.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');

// ── token okuma ────────────────────────────────────────────────────────────────────────────
function blok(baslangic) {
  const i = CSS.indexOf(baslangic);
  assert.ok(i >= 0, `index.css icinde blok yok: ${baslangic}`);
  return CSS.slice(i, CSS.indexOf('\n}', i));
}
const tokenlar = (b) =>
  Object.fromEntries(
    [...b.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
const ACIK = tokenlar(blok(':root {'));
const KOYU = { ...ACIK, ...tokenlar(blok(':root[data-theme="dark"] {')) };

// ── renk matematigi ────────────────────────────────────────────────────────────────────────
function rgb(deger, zemin) {
  const c = String(deger).trim();
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((x) => parseInt(x + x, 16));
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    const a = p[3] === undefined ? 1 : p[3];
    // Yari saydam zemin, altindaki yuzeyle karisir.
    return p.slice(0, 3).map((v, i) => Math.round(v * a + (zemin ? zemin[i] : 255) * (1 - a)));
  }
  throw new Error(`renk cozulemedi: ${deger}`);
}
function parlaklik([r, g, b]) {
  const k = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
}
function oran(a, b) {
  const x = parlaklik(a);
  const y = parlaklik(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** `metin` token'i `zemin` token'i uzerinde (zemin yari saydamsa yuzeyin ustunde). */
function kontrast(t, metin, zemin) {
  const yuzey = rgb(t['--bg-surface']);
  const z = rgb(t[zemin] ?? zemin, yuzey);
  return oran(rgb(t[metin] ?? metin, z), z);
}

const AA = 4.5;
const TEMALAR = [
  ['acik', ACIK],
  ['koyu', KOYU],
];
// [metin token'i, zemin token'i, neden]
const METIN_CIFTLERI = [
  ['--status-warning-text', '--bg-surface', 'uyari metni kart ustunde'],
  ['--status-warning-text', '--status-warning-bg', 'uyari metni kendi zemininde (uyari kutusu)'],
  ['--status-danger-text', '--bg-surface', 'hata metni kart ustunde'],
  ['--status-danger-text', '--status-danger-bg', 'hata metni kendi zemininde (hata kutusu)'],
  ['--status-success', '--bg-surface', 'basari metni kart ustunde'],
  ['--status-success', '--status-success-bg', 'basari metni kendi zemininde'],
  ['--status-info', '--status-info-bg', 'bilgi metni kendi zemininde'],
  ['--text-on-accent', '--accent', 'dolu dugme metni (btn-primary ve dolu siniflar)'],
  ['--text-muted', '--bg-surface', 'soluk metin kart ustunde'],
  ['--text-secondary', '--bg-surface', 'ikincil metin kart ustunde'],
  ['--accent', '--bg-surface', 'baglanti metni kart ustunde'],
];

test('TK0 matematik dogru: siyah/beyaz 21:1, ayni renk 1:1, bilinen cift', () => {
  assert.equal(oran([0, 0, 0], [255, 255, 255]).toFixed(1), '21.0');
  assert.equal(oran([10, 20, 30], [10, 20, 30]), 1);
  // #767676 beyaz ustunde AA sinirindadir (4.54).
  assert.equal(oran(rgb('#767676'), rgb('#ffffff')).toFixed(2), '4.54');
  // Yari saydam zemin yuzeyle karisir: %50 siyah, beyaz yuzeyde orta gri.
  assert.deepEqual(rgb('rgba(0, 0, 0, 0.5)', [255, 255, 255]), [128, 128, 128]);
});

for (const [ad, t] of TEMALAR) {
  for (const [metin, zemin, neden] of METIN_CIFTLERI) {
    test(`TK1 ${ad} tema: ${metin} / ${zemin} >= ${AA} (${neden})`, () => {
      assert.ok(t[metin], `${metin} ${ad} temada tanimli degil`);
      const o = kontrast(t, metin, zemin);
      assert.ok(
        o >= AA,
        `${ad} temada ${neden}: ${t[metin]} / ${t[zemin]} = ${o.toFixed(2)} (esik ${AA})`,
      );
    });
  }
}

test('TK2 gecmisteki hatalar OLCULEBILIR: eski ciftler esigin altindaydi', () => {
  // Bu test bekcinin kor olmadigini gosterir: duzeltmeden onceki ciftler gercekten dusuktu.
  assert.ok(kontrast(ACIK, '--status-warning', '--bg-surface') < 3, 'sari METIN beyazda okunmaz');
  assert.ok(kontrast(ACIK, '--status-warning', '--status-warning-bg') < 3);
  assert.ok(kontrast(ACIK, '#ffffff', '--masthead-bg') < 1.5, 'beyaz metin acik masthead griside');
  assert.ok(kontrast(KOYU, '#ffffff', '--accent') < 2, 'beyaz metin koyu temanin acik aksaninda');
});

// ── uyum katmani: siniflar dogru token'a esli mi ───────────────────────────────────────────
/** `:root .sinif` (svg OLMAYAN) seciciyi iceren kuralin `ozellik` degeri. */
function eslenen(sinif, ozellik) {
  const kacis = sinif.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`:root \\.${kacis}(?![\\w.\\\\-])[^{]*\\{([^}]*)\\}`, 'g');
  const degerler = [];
  for (const m of CSS.matchAll(re)) {
    const d = m[1].match(new RegExp(`(?:^|[\\s;])${ozellik}:\\s*([^;]+)`));
    if (d) degerler.push(d[1].trim());
  }
  return degerler;
}

test('TK3 sari ve kirmizi METIN siniflari metin token`ina esli (ikon tonuna degil)', () => {
  const sari = [
    ...[300, 400, 500, 600, 700, 800, 900].map((n) => `text-amber-${n}`),
    ...[500, 600, 700, 800].map((n) => `text-yellow-${n}`),
    ...[500, 600, 700, 800].map((n) => `text-orange-${n}`),
  ];
  for (const s of sari) {
    const d = eslenen(s, 'color');
    assert.ok(d.length > 0, `${s} uyum katmaninda esli degil`);
    assert.ok(
      d.every((x) => x === 'var(--status-warning-text)'),
      `${s} -> ${d} (beklenen: --status-warning-text)`,
    );
  }
  const kirmizi = [
    ...[300, 400, 500, 600, 700, 800, 900].map((n) => `text-red-${n}`),
    ...[400, 500, 600, 700, 800].map((n) => `text-rose-${n}`),
  ];
  for (const s of kirmizi) {
    const d = eslenen(s, 'color');
    assert.ok(d.length > 0, `${s} uyum katmaninda esli degil`);
    assert.ok(
      d.every((x) => x === 'var(--status-danger-text)'),
      `${s} -> ${d} (beklenen: --status-danger-text)`,
    );
  }
});

test('TK4 ikonlar ikon tonunda kalir: <svg> uzerindeki ayni siniflar temel durum rengine esli', () => {
  for (const [sinif, renk] of [
    ['text-amber-500', '--status-warning'],
    ['text-amber-800', '--status-warning'],
    ['text-yellow-600', '--status-warning'],
    ['text-red-500', '--status-danger'],
    ['text-red-700', '--status-danger'],
  ]) {
    const re = new RegExp(`:root svg\\.${sinif}(?![\\w-])[^{]*\\{\\s*color:\\s*var\\(${renk}\\)`);
    assert.match(CSS, re, `svg.${sinif} ikon tonuna esli degil`);
  }
  // `[class*=...]` secicisi `hover:text-red-600` tasiyan gri ikonlari da boyardi.
  assert.ok(!/svg\[class\*="text-/.test(CSS), 'ikon kurali genis `[class*=]` secicisiyle yazilmis');
});

test('TK5 dolu dugmeler: `bg-black` aksana esli; aksan zemini + `text-white` metni --text-on-accent', () => {
  assert.deepEqual(eslenen('bg-black', 'background-color'), ['var(--accent)']);
  for (const zemin of [
    'bg-black',
    'bg-blue-500',
    'bg-blue-600',
    'bg-indigo-500',
    'bg-indigo-600',
  ]) {
    assert.match(
      CSS,
      new RegExp(`:root \\.${zemin}\\.text-white[^{]*\\{\\s*color:\\s*var\\(--text-on-accent\\)`),
      `${zemin}.text-white metni --text-on-accent degil`,
    );
  }
  assert.match(
    CSS,
    /:root \.bg-\\\[var\\\(--accent\\\)\\\]\.text-white[^{]*\{\s*color:\s*var\(--text-on-accent\)/,
    '`bg-[var(--accent)] text-white` metni --text-on-accent degil',
  );
  // Hover: dolu dugme acik temada acik griye donmez.
  assert.match(
    CSS,
    /:root \.bg-black\.hover\\:bg-gray-800:hover[^{]*\{\s*background-color:\s*var\(--accent-dark\)/,
  );
});

// ── kaynak taramasi: CSS'in ULASAMADIGI yerler ─────────────────────────────────────────────
function tsxDosyalari(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsxDosyalari(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const DOSYALAR = tsxDosyalari(SRC).map((p) => [
  path.relative(SRC, p).split(path.sep).join('/'),
  fs.readFileSync(p, 'utf8'),
]);
const acilisEtiketleri = (kaynak) => [...kaynak.matchAll(/<[A-Za-z][A-Za-z0-9.]*\b[^<>]*?>/gs)];
const satirNo = (kaynak, i) => kaynak.slice(0, i).split('\n').length;

test('TK6 baglanti (<a>, <Link>) uzerinde `text-white` yok: `a { color }` kurali onu ezer', () => {
  const ihlal = [];
  for (const [f, s] of DOSYALAR) {
    for (const m of acilisEtiketleri(s)) {
      if (/^<(a|Link|NavLink)\b/.test(m[0]) && /\btext-white\b/.test(m[0]))
        ihlal.push(`${f}:${satirNo(s, m.index)}`);
    }
  }
  assert.deepEqual(ihlal, [], 'dugme gorunumlu baglanti icin `btn-primary` kullanin');
});

// Zemin satir-ici `style` ile aksan yapilmis, metin SABIT beyaz: CSS katmani bu ogeye ulasamaz
// ve koyu temada metin 1.45:1 kalir. Asagidakiler bu turun KAPSAMI DISINDAKI agaclardir
// (sahiplerine bildirildi); sayilar ARTAMAZ, listeye yeni dosya eklenemez.
const AKSAN_BEYAZ_IZINLI = {
  'components/denetim/NginxAudit.tsx': 1,
  'components/denetim/NginxInternetExpose.tsx': 1,
  'components/denetim/NginxProdMigration.tsx': 7,
  'components/denetim/NginxSpaSummary.tsx': 1,
  'components/nginx_console/RvpSecimTab.tsx': 1,
};
test('TK7 aksan zemini (satir-ici) ustunde sabit beyaz metin eklenmiyor', () => {
  const say = {};
  for (const [f, s] of DOSYALAR) {
    for (const m of acilisEtiketleri(s)) {
      const t = m[0];
      if (!/background(Color)?: ?['"]var\(--accent\)['"]/.test(t)) continue;
      if (/\btext-white\b/.test(t) || /color: ?['"](#fff|#ffffff|white)['"]/i.test(t))
        say[f] = (say[f] || 0) + 1;
    }
  }
  for (const [f, n] of Object.entries(say)) {
    assert.ok(
      n <= (AKSAN_BEYAZ_IZINLI[f] || 0),
      `${f}: aksan zemini ustunde ${n} sabit beyaz metin (izinli ${AKSAN_BEYAZ_IZINLI[f] || 0}). ` +
        '`text-[var(--text-on-accent)]` ya da `btn-primary` kullanin.',
    );
  }
});

// `--status-warning` IKON ve DOLGU tonudur. METIN icin `--status-warning-text` kullanilir.
// Asagidaki sayilar bugunku kullanimlardir: kapsam ici olanlar IKONDUR; kapsam disi agaclardaki
// metin kullanimlari sahiplerine bildirildi. Sayilar ARTAMAZ, yeni dosya eklenemez.
const UYARI_TONU_IZINLI = {
  'components/ArkSpaRaporuPage.tsx': 3,
  'components/DashboardPage.tsx': 1,
  'components/admin/tabs/ScaleXAdminTab.tsx': 1,
  'components/crypto_hub/ConfigMapsPanel.tsx': 2,
  'components/crypto_hub/CryptoHubPage.tsx': 6,
  'components/crypto_hub/OpsPanel.tsx': 1,
  'components/crypto_hub/PlanModal.tsx': 4,
  'components/crypto_hub/ResourcesModal.tsx': 5,
  'components/crypto_hub/RolloutApply.tsx': 2,
  'components/crypto_hub/ValuesCompare.tsx': 1,
  'components/crypto_hub/ValuesEditor.tsx': 1,
  'components/denetim/NginxProdMigration.tsx': 5,
  'components/denetim/NginxSpaSummary.tsx': 8,
  'components/logx_v2/LogXWizardPage.tsx': 3,
  'components/logx_v2/shared/DownloadStep.tsx': 1,
  'components/nginx_console/DriftTab.tsx': 1,
  'components/nginx_console/NginxSpaDiscovery.tsx': 2,
  'components/nginx_console/NimTabs.tsx': 4,
  'components/nginx_console/RateLimitTab.tsx': 6,
  'components/nginx_console/RvpSecimTab.tsx': 2,
  'components/nginx_console/SourceNote.tsx': 1,
  'components/opsx/steps/OcpOperationStep.tsx': 1,
  'components/scalex/ScaleXPage.tsx': 1,
  'components/server_hub/RetirementTab.tsx': 11,
  'components/server_hub/ServerHubPage.tsx': 1,
  'components/telnet/TelnetWizardPage.tsx': 1,
};
test('TK8 `--status-warning` yeni bir METIN rengi olarak eklenmiyor (metin: --status-warning-text)', () => {
  const RE = /text-\[var\(--status-warning\)\]|color: ?['"]var\(--status-warning\)['"]/g;
  for (const [f, s] of DOSYALAR) {
    const n = (s.match(RE) || []).length;
    if (!n) continue;
    assert.ok(
      n <= (UYARI_TONU_IZINLI[f] || 0),
      `${f}: --status-warning ${n} yerde renk olarak kullaniliyor (izinli ${UYARI_TONU_IZINLI[f] || 0}). ` +
        'Metin ise `--status-warning-text` kullanin; ikon ise izin listesini bilerek guncelleyin.',
    );
  }
});
