// src/__tests__/first-paint.test.cjs — FOUC kaskadinin BES ASAMASI icin bekci.
//
// Kullanici sikayeti: "yukleme yapsam da arada cok hizli DEFAULT gozukuyor". Kok neden
// tek degil, BES asamali bir kaskatti; hepsi ayni sinifta: DOGRU degeri ancak ilk
// boyamadan SONRA ogrenip ekrani DEGISTIRMEK.
//
//   C1 · Logo: PortalLogo once gomulu kirmizi BMW SVG'sini cizip /api/branding/meta
//        yaniti gelince yuklenen logoyla degistiriyordu.
//   C2 · Font: fonts.googleapis.com'a gidiliyordu. Kurumsal ag kapaliysa Red Hat
//        tipografisi HIC yuklenmiyor; yuklendigi durumda ise metin once sistem
//        fontuyla cizilip sonra degisiyor ve SATIRLAR KAYIYORDU.
//   C3 · Zemin: uygulama CSS'i gelene kadar tarayici kendi BEYAZini boyuyordu —
//        koyu temada tam ekran beyaz flas.
//   C4 · Suspense: sinir TUM <Routes>'u sariyordu; lazy sayfaya hard reload'da
//        masthead ve menu de dahil hicbir sey cizilmiyordu.
//   C5 · Tema: sunucudaki tercih /api/auth/prefs yaniti ile geliyordu; baska bir
//        tarayicidan giren kullanici ekranin TEMA DEGISTIRDIGINI goruyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const INDEX_HTML = read('index.html');
const FONTS_CSS = read('src/fonts.css');
const INDEX_CSS = read('src/index.css');
const LOGO_TSX = read('src/components/common/PortalLogo.tsx');
const LAYOUT_TSX = read('src/layouts/AppLayout.tsx');
const SERVER = read('server/index.cjs');

// ── C1: logo ────────────────────────────────────────────────────────────────
test('C1: logo durumu ILK HTML’e gomulur, istek beklenmez', () => {
  assert.match(INDEX_HTML, /window\.__BMW_BOOT__ = \{\};/, 'sunucunun dolduracagi yer tutucu yok');
  assert.match(SERVER, /boot\.logoUrl = `\/api\/branding\/logo\?v=\$\{encodeURIComponent\(logo\.version\)\}`/,
    'logo adresi surumlenmiyor — tarayici her acilista yeniden ister, eski goruntu bir an cikar');
  assert.match(LOGO_TSX, /const BOOT_LOGO/, 'istemci gomulu durumu okumuyor');
  assert.match(LOGO_TSX, /if \(BOOT_KNOWS\) return;/, 'sunucu soyledigi halde yine istek atiliyor');
});

test('C1: baslangic durumu SENKRON belirlenir (ilk render dogru gorseli cizer)', () => {
  assert.match(LOGO_TSX, /useState<string \| null>\(BOOT_KNOWS \? \(BOOT_LOGO \?\? null\) : null\)/);
});

// ── C2: font ────────────────────────────────────────────────────────────────
test('C2: disariya font istegi YOK', () => {
  assert.ok(!/<link[^>]*fonts\.googleapis\.com/.test(INDEX_HTML), 'hala Google Fonts <link> var');
  assert.ok(!/<link[^>]*fonts\.gstatic\.com/.test(INDEX_HTML), 'hala gstatic <link> var');
});

test('C2: font dosyalari repoda ve @font-face onlari gosteriyor', () => {
  for (const f of [
    'red-hat-text-latin.woff2', 'red-hat-text-latin-ext.woff2',
    'red-hat-display-latin.woff2', 'red-hat-display-latin-ext.woff2',
    'red-hat-mono-latin.woff2', 'red-hat-mono-latin-ext.woff2',
  ]) {
    const p = path.join(ROOT, 'public', 'fonts', f);
    assert.ok(fs.existsSync(p), `eksik font dosyasi: ${f}`);
    assert.ok(fs.statSync(p).size > 5000, `${f} suphesiz kucuk — indirme bozulmus olabilir`);
    assert.ok(FONTS_CSS.includes(f), `${f} @font-face'te gecmiyor`);
  }
});

test('C2: Turkce icin latin-ext ZORUNLU olarak taniml', () => {
  // s/g/i harfleri latin-ext alt kumesinde. Yalnizca latin yuklenirse bu harfler
  // fallback fonttan cizilir ve metin ORTASINDA font degisir.
  const extRanges = FONTS_CSS.match(/U\+0100-02BA/g) || [];
  assert.equal(extRanges.length, 3, 'uc aile icin de latin-ext unicode-range olmali');
});

test('C2: metrik eslenmis fallback yuzleri var (swap layout KAYDIRMASIN)', () => {
  for (const fam of ['Red Hat Text Fallback', 'Red Hat Display Fallback', 'Red Hat Mono Fallback']) {
    assert.ok(FONTS_CSS.includes(fam), `${fam} tanimli degil`);
  }
  assert.match(FONTS_CSS, /size-adjust: 94\.11%/,  'Red Hat Text -> Arial olcegi degismis');
  assert.match(FONTS_CSS, /ascent-override: 108\.17%/);
  // Fallback yuzu gercek aileden HEMEN SONRA gelmeli; arada eslenmemis bir ad
  // olursa tarayici ona duser ve kayma geri gelir.
  assert.match(INDEX_CSS, /"Red Hat Text", "RedHatText", "Red Hat Text Fallback"/);
});

test('C2: preload crossorigin tasir (yoksa dosya IKI KEZ inilir)', () => {
  const preloads = INDEX_HTML.match(/<link rel="preload"[^>]*woff2[^>]*>/g) || [];
  assert.ok(preloads.length >= 2, 'ilk ekran fontlari preload edilmiyor');
  for (const p of preloads) {
    assert.match(p, /crossorigin/, `preload’da crossorigin yok: ${p}`);
    assert.match(p, /as="font"/);
  }
});

// ── C3: ilk boyama zemini ───────────────────────────────────────────────────
test('C3: ilk boyama zemini HTML’de, iki tema icin de', () => {
  // Degerler PF6 gecisinde guncellendi (gray-10 / gray-95). Asagidaki "token ile
  // ayni mi" testi zaten kendi kendini ayarliyor; burasi ise gomulu stilin HIC
  // kaybolmadigini kilitler.
  assert.match(INDEX_HTML, /html \{ background-color: #f2f2f2; color-scheme: light; \}/);
  assert.match(INDEX_HTML, /html\[data-theme="dark"\] \{ background-color: #151515; color-scheme: dark; \}/);
});

test('C3: gomulu zemin degerleri --bg-base token’lariyla AYNI', () => {
  // Ayrisirlarsa CSS yuklendigi anda gorunur bir zemin sicramasi olur.
  const light = INDEX_CSS.match(/--bg-base:\s*(#[0-9a-fA-F]{6});/);
  const darkBlock = INDEX_CSS.slice(INDEX_CSS.indexOf(':root[data-theme="dark"]'));
  const dark = darkBlock.match(/--bg-base:\s*(#[0-9a-fA-F]{6});/);
  assert.ok(light && dark, '--bg-base token’lari okunamadi');
  assert.ok(INDEX_HTML.includes(light[1]), `acik tema zemini HTML ile uyusmuyor (${light[1]})`);
  assert.ok(INDEX_HTML.includes(dark[1]), `koyu tema zemini HTML ile uyusmuyor (${dark[1]})`);
});

// ── C4: Suspense siniri ─────────────────────────────────────────────────────
test('C4: sayfa Suspense siniri kabugun ICINDE (Outlet etrafinda)', () => {
  assert.match(LAYOUT_TSX, /<Suspense fallback=\{<PageSkeleton \/>\}>\s*\n\s*<Outlet \/>/,
    'sinir Outlet etrafinda degil — lazy sayfada masthead+menu de kaybolur');
  assert.match(LAYOUT_TSX, /function PageSkeleton/);
});

// ── C5: tema ────────────────────────────────────────────────────────────────
test('C5: tema tercihi ilk boyamadan ONCE uygulanir ve sunucu tercihi ONCELIKLI', () => {
  const script = INDEX_HTML.slice(INDEX_HTML.indexOf('var boot = window.__BMW_BOOT__'));
  const bootIdx = script.indexOf('boot.theme === "light"');
  const storedIdx = script.indexOf('stored === "light"');
  assert.ok(bootIdx >= 0 && storedIdx >= 0, 'oncelik zinciri bulunamadi');
  assert.ok(bootIdx < storedIdx, 'sunucu tercihi localStorage’dan SONRA degerlendiriliyor');
  assert.match(SERVER, /if \(t === "light" \|\| t === "dark"\) boot\.theme = t;/,
    'sunucu tema tercihini HTML’e gomuyor');
});

test('C5: kullaniciya ozel HTML paylasimli onbellege dusmez', () => {
  assert.match(SERVER, /res\.setHeader\("Cache-Control", "no-store"\)/);
  assert.match(SERVER, /res\.setHeader\("Vary", "Cookie"\)/);
});

test('C5: gomulen JSON script blogunu erken kapatamaz', () => {
  assert.match(SERVER, /const escapeForScript = /);
  assert.match(SERVER, /replace\(\/<\/g, "\\\\u003c"\)/);
});
