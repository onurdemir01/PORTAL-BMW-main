// src/components/admin/tabs/sistem/__tests__/sistem-tasarim.test.cjs — Admin > Sistem
// YERLESIM / STIL bekcileri (2026-10-15 denetimi, gercek AppLayout + AdminPage icinde olculdu).
//
// jsdom yerlesim YAPMAZ: bu bekciler kaynak METNINI okur. Kor noktalari: sablon birlestirmesiyle
// uretilen sinif adlari ve calisma aninda hesaplanan stiller. Her bekci mutasyonla dogrulandi;
// yine de gercek tarayicida bir kez olcmek (1366x900, Taleplerim acik/kapali) yerini tutmaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SISTEM = path.join(__dirname, '..');
const TAB = path.join(SISTEM, '..', 'SystemConfigTab.tsx');
const SRC = path.join(SISTEM, '..', '..', '..', '..');
const oku = (p) => fs.readFileSync(p, 'utf8');
const ad = (p) => path.basename(p);

const TSX = [TAB, ...fs.readdirSync(SISTEM).filter((f) => f.endsWith('.tsx')).map((f) => path.join(SISTEM, f))];
const KAYNAK = [...TSX, ...fs.readdirSync(SISTEM).filter((f) => f.endsWith('.ts')).map((f) => path.join(SISTEM, f))];

/** Yorum satirlari atilmis kaynak. */
function kod(src) {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\s*\/\*)/.test(l))
    .join('\n');
}

/** Dosyadaki butun dize sabitleri (tek, cift tirnak ve ters tirnak). */
function dizeler(src) {
  return [...src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** `a:b-[x:y]:c` -> ['a', 'b-[x:y]', 'c'] (koseli parantez icindeki ':' bolmez). */
function varyantlar(token) {
  const parca = [];
  let d = 0;
  let bas = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === '[') d++;
    else if (c === ']') d--;
    else if (c === ':' && d === 0) {
      parca.push(token.slice(bas, i));
      bas = i + 1;
    }
  }
  parca.push(token.slice(bas));
  return parca;
}

const onemli = (cekirdek) => cekirdek.startsWith('!') || cekirdek.endsWith('!');
const yalin = (cekirdek) => cekirdek.replace(/^!|!$/g, '');

// ── SD1 — kok kap konumlandirilmis ─────────────────────────────────────────────────────────
// AppLayout'ta `main` (overflow-y-auto) konumlandirilmamis; ilk konumlandirilmis ata onun
// DISINDAKI `relative` kap. sr-only/absolute ogeler (radyo input'lari, duyuru, "Gizli deger
// tanimli") main'in kaydirma alaninin disina yerlesti: kok `h-screen overflow-hidden` kabin
// scrollHeight'i 1366'da 7092 oldu, odak/scrollIntoView koku kaydirdi (bos ekran, geri
// kaydirilamaz). Ekranin kok kabi `relative` olunca hepsi main'in icinde kalir.
test('SD1 ekranin kok kabi ve radyo etiketi konumlandirilmis (relative)', () => {
  const tab = oku(TAB);
  const kok = dizeler(tab).find((s) => s.split(/\s+/).includes('@container/sistem'));
  assert.ok(kok, 'SystemConfigTab kok kabi (@container/sistem) bulunamadi');
  assert.ok(kok.split(/\s+/).includes('relative'), `kok kap 'relative' degil: "${kok}"`);

  const duz = oku(path.join(SISTEM, 'AyarDuzenleyici.tsx'));
  const segment = dizeler(duz).find((s) => /(^|\s)pf-segment(\s|$)/.test(s));
  assert.ok(segment, 'AyarDuzenleyici pf-segment etiketi bulunamadi');
  assert.ok(segment.split(/\s+/).includes('relative'), `pf-segment etiketi 'relative' degil: "${segment}"`);
});

// ── SD2 — scrollIntoView yok ───────────────────────────────────────────────────────────────
// scrollIntoView BUTUN kaydirma atalarini hizalar: overflow-hidden kok kap da kayar ve
// masthead'in altinda 64px bosluk acilir ("Gruba git" olcumu). Yalniz en yakin kaydirma kabi
// kaydirilir (sistem/kaydir.ts, SA22).
test('SD2 Sistem ekraninda scrollIntoView cagrisi yok (yalniz en yakin kaydirma kabi kayar)', () => {
  const bulunan = KAYNAK.filter((p) => /\.scrollIntoView\s*\(/.test(kod(oku(p)))).map(ad);
  assert.deepEqual(bulunan, [], `scrollIntoView kullanan dosyalar: ${bulunan.join(', ')}`);
});

// ── SD3 — katmansiz PF siniflari Tailwind utility'lerini ezer ──────────────────────────────
// index.css'teki `.pf-btn-link`, `.btn-secondary`, `.pf-segment` ve `h1..h6` kurallari
// KATMANSIZ; Tailwind 4 utility'leri `@layer utilities` icinde oldugu icin onlara yenilir.
// Olculen: "Ayrintilar" text-xs yerine 14px, Duzenle cercevesi saydam, bolum basligi
// --text-muted/600 yerine --text-primary/500. Ayni ozelligi ezen utility `!` tasimali.
const PF_SINIFLARI = ['pf-btn-link', 'btn-secondary', 'pf-segment'];
const PF_EZILEN = /^(text-(?!left$|right$|center$)|border|p[xytblr]?-|rounded|gap-|whitespace-|justify-|font-|leading-|tracking-)/;
const BASLIK_EZILEN = /^(text-\[var\(|font-|leading-|tracking-)/;

function ezilenler(siniflar, desen) {
  const kotu = [];
  for (const t of siniflar.split(/\s+/).filter(Boolean)) {
    if (t.includes('${') || t.includes('}') || t.includes('?')) continue;
    const cekirdek = varyantlar(t).pop();
    if (desen.test(yalin(cekirdek)) && !onemli(cekirdek)) kotu.push(t);
  }
  return kotu;
}

test('SD3 PF sinifi tasiyan ogelerde ve basliklarda ayni ozelligi ezen utility `!` tasir', () => {
  const kotu = [];
  for (const p of TSX) {
    const src = kod(oku(p));
    for (const s of dizeler(src)) {
      const tokenlar = s.split(/\s+/);
      if (!PF_SINIFLARI.some((c) => tokenlar.includes(c))) continue;
      for (const t of ezilenler(s, PF_EZILEN)) kotu.push(`${ad(p)}: ${t}  (${s.trim().slice(0, 60)}…)`);
    }
    for (const m of src.matchAll(/<h[1-6]\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const t of ezilenler(m[1] ?? m[2], BASLIK_EZILEN)) kotu.push(`${ad(p)}: baslik ${t}`);
    }
  }
  assert.deepEqual(kotu, [], `katmansiz CSS'in ezdigi utility'ler:\n  ${kotu.join('\n  ')}`);
});

// ── SD4 — radyo odagi gorunur ──────────────────────────────────────────────────────────────
// `.pf-segment.is-active { box-shadow }` katmansiz: `has-[:focus-visible]:ring-*` (box-shadow)
// ezildi; input sr-only oldugu icin kendi outline'i da gorunmez -> odak hic gorunmuyordu
// (WCAG 2.4.7). outline'i pf-segment ezmez.
test('SD4 pf-segment odak gostergesi outline ile verilir (ring ezilir)', () => {
  const segment = dizeler(oku(path.join(SISTEM, 'AyarDuzenleyici.tsx'))).find((s) => /(^|\s)pf-segment(\s|$)/.test(s));
  const t = segment.split(/\s+/);
  assert.ok(
    t.some((x) => x.startsWith('has-[:focus-visible]:outline')),
    `pf-segment etiketinde has-[:focus-visible]:outline yok: "${segment}"`,
  );
  assert.ok(!t.some((x) => /^has-\[:focus-visible\]:ring/.test(x)), 'pf-segment odagi ring ile veriliyor (ezilir)');
});

// ── SD5 — kirilimlar gercek kabuga gore ────────────────────────────────────────────────────
// 1366x900'de (sol menu acik) sekme kabi 640px, Taleplerim acikken 344px. 42rem (@2xl, 672px)
// kirilimi yaygin masaustunde HIC devreye girmiyordu: satirlar tek sutun, Duzenle tam genislik.
test('SD5 Sistem ekraninda @2xl/sistem ve uzeri kirilim yok (1366 masaustunde kap 640px)', () => {
  const kotu = [];
  for (const p of TSX) {
    for (const m of kod(oku(p)).matchAll(/@([2-7]xl)\/sistem:/g)) kotu.push(`${ad(p)}: @${m[1]}/sistem`);
  }
  assert.deepEqual(kotu, [], `640px kapta hic acilmayan kirilimlar:\n  ${kotu.join('\n  ')}`);
  assert.match(oku(path.join(SISTEM, 'AyarSatiri.tsx')), /@xl\/sistem:grid(\s|`)/, 'satir izgarasi @xl/sistem kiriliminda acilmali');
});

// ── SD6 — rozet kontrasti iki temada ───────────────────────────────────────────────────────
// Koyu temada `.pf-label--green` (#5ba352) acik grup basliginda 2.75:1, `--red` 3.70:1 olculdu
// (11px metin, AA 4.5). Rozet.tsx yesil/kirmizi metni token karisimiyla verir; karisim burada
// en kotu zeminlerde hesaplanir: acik grup basligi (--bg-elevated), satir (--bg-surface) ve
// "Kaydedildi" satir parlamasi (basari zemini satirin ustune bir kez daha biner).
const CSS = oku(path.join(SRC, 'index.css'));
function blok(baslangic) {
  const i = CSS.indexOf(baslangic);
  assert.ok(i >= 0, `index.css icinde blok yok: ${baslangic}`);
  return CSS.slice(i, CSS.indexOf('\n}', i));
}
const tokenlar = (b) => Object.fromEntries([...b.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const ACIK = tokenlar(blok(':root {'));
const KOYU = { ...ACIK, ...tokenlar(blok(':root[data-theme="dark"] {')) };

function rgba(deger) {
  const c = String(deger).trim();
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [...[0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)), 1];
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
  }
  throw new Error(`renk cozulemedi: ${deger}`);
}
const ust = (renk, alt) => renk.slice(0, 3).map((v, i) => v * renk[3] + alt[i] * (1 - renk[3]));
function parlaklik([r, g, b]) {
  const k = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
}
const oran = (a, b) => {
  const x = parlaklik(a);
  const y = parlaklik(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('SD6 yesil ve kirmizi rozet metni iki temada en kotu zeminde AA (4.5) gecer', () => {
  const rozet = oku(path.join(SISTEM, 'Rozet.tsx'));
  const karisimlar = Object.fromEntries(
    [...rozet.matchAll(/(green|red):\s*'color-mix\(in srgb, var\((--[a-z-]+)\) (\d+)%, var\((--[a-z-]+)\)\)'/g)].map((m) => [
      m[1],
      { a: m[2], yuzde: Number(m[3]) / 100, b: m[4] },
    ]),
  );
  assert.deepEqual(Object.keys(karisimlar).sort(), ['green', 'red'], 'Rozet.tsx yesil/kirmizi metin karisimi bulunamadi');
  const zemin = { green: '--status-success-bg', red: '--status-danger-bg' };
  for (const [tema, t] of [['acik', ACIK], ['koyu', KOYU]]) {
    for (const ton of ['green', 'red']) {
      const k = karisimlar[ton];
      const a = rgba(t[k.a]);
      const b = rgba(t[k.b]);
      const metin = a.slice(0, 3).map((v, i) => v * k.yuzde + b[i] * (1 - k.yuzde));
      const etiket = rgba(t[zemin[ton]]);
      const yuzey = rgba(t['--bg-surface']).slice(0, 3);
      const zeminler = {
        'acik grup basligi': ust(etiket, rgba(t['--bg-elevated']).slice(0, 3)),
        satir: ust(etiket, yuzey),
        'Kaydedildi parlamasi': ust(etiket, ust(rgba(t['--status-success-bg']), yuzey)),
      };
      for (const [yer, z] of Object.entries(zeminler)) {
        const o = oran(metin, z);
        assert.ok(o >= 4.5, `${tema} tema ${ton} rozet / ${yer}: ${o.toFixed(2)} (esik 4.5)`);
      }
    }
  }
});

// ── SD7 — dar kapta bant tasmaz ────────────────────────────────────────────────────────────
// 375px'te bandin icerik sutunu 115px'e sikisti; `.pf-btn-link` nowrap oldugu icin uzun ayar
// adlari bandin kenarini asip kirpildi.
test('SD7 restart bandi: ayar adlari sarar, "Listeyi temizle" icerik sutununu sikistirmaz', () => {
  const bant = kod(oku(path.join(SISTEM, 'YenidenBaslatmaBandi.tsx')));
  const etiket = dizeler(bant).find((s) => s.split(/\s+/).includes('pf-btn-link'));
  assert.ok(etiket && etiket.split(/\s+/).includes('!whitespace-normal'), `bant etiket dugmesi sarmiyor: "${etiket}"`);
  const temizle = dizeler(bant).find((s) => s.split(/\s+/).includes('btn-secondary'));
  assert.ok(temizle && !/flex-shrink-0|shrink-0/.test(temizle), `"Listeyi temizle" yan sutunda: "${temizle}"`);
});

// ── SD8 — acma/kapama oku sabit yerde ──────────────────────────────────────────────────────
// Ok baslik dugmesinin icinde, rozetler disindaydi: ok kartlar arasinda 1344-1599px arasinda
// geziyordu. Rozetler dugmenin icinde, ok dugmenin SON ogesi; baslik satirinda dugmeden
// sonra baska oge yok.
// KORLUK DUZELTILDI (yeniden denetim 2026-10-15): eskiden yalniz `</h4>`..`<Collapse` araligi
// taraniyordu; rozet ya da baglanti `</button>` ile `</h4>` arasina (h4'un icine, dugmenin
// disina — okun SAGINA) konunca bekci yesil kaliyordu. Artik `</button>`dan `<Collapse`a kadar
// `</h4>` disinda HICBIR sey (oge, ifade, metin) olmamali.
test('SD8 grup basliginda ok dugmenin son ogesi; dugmeden sonra rozet/baglanti yok', () => {
  const g = kod(oku(path.join(SISTEM, 'AyarGrubu.tsx')));
  const dugmeSonu = g.indexOf('</button>');
  const baslikSonu = g.indexOf('</h4>');
  const icerik = g.indexOf('<Collapse');
  assert.ok(
    dugmeSonu > 0 && dugmeSonu < baslikSonu && baslikSonu < icerik,
    'baslik yapisi bulunamadi (</button> -> </h4> -> <Collapse sirasi bekleniyor)',
  );
  const dugme = g.slice(g.indexOf('<button'), dugmeSonu);
  const ok = dugme.lastIndexOf('<ChevronDownIcon');
  assert.ok(ok > 0, 'ChevronDownIcon baslik dugmesinin icinde degil');
  assert.ok(dugme.lastIndexOf('<Rozet') < ok, 'Rozet okun sagina dusuyor');
  // Iki aralik birden: </button>..</h4> (baslik satirinda dugmenin sagi) ve </h4>..<Collapse.
  const sonrasi = g.slice(dugmeSonu + '</button>'.length, icerik);
  const kalan = sonrasi.replace('</h4>', '').trim();
  assert.equal(kalan, '', `baslik satirinda dugmeden sonra oge var:\n${sonrasi}`);
});
