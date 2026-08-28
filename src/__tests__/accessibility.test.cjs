// src/__tests__/accessibility.test.cjs — D2/D6/D7.
//
// Bu portal ISLERI TETIKLEYEN bir arac; ekrani goremeyen bir kullanici icin
// "isim bitti mi" sorusunun cevabi hicbir yerde yoktu.
//
// D2 · `aria-live` repoda SIFIR kullanimda. Bir isin bitmesi TAMAMEN gorsel bir
//      olaydi: alt cubuktaki nokta renk degistiriyordu, baska hicbir sey olmuyordu.
//      Toast'ta `role="alert"` vardi ama KAP, mesaj gelmeden once DOM'da YOKTU
//      (`toasts.length === 0` iken `null`) — ekran okuyucular bir bolgeyi izlemeye
//      BASLAMAK icin onun ONCEDEN var olmasini bekler, bu yuzden bildirimlerin cogu
//      hic duyurulmuyordu. Klasik canli-bolge hatasi.
//
// D6 · "Icerige atla" YOKTU. Klavye kullanicisi HER sayfada masthead'i + sol menudeki
//      ~15 baglantiyi geciyordu; asil icerige ulasmak 20'ye yakin Tab demekti.
//
// D7 · 65 `truncate` kullanimindan yalnizca 14'unde `title` vardi. Kesilen hostname,
//      namespace, e-posta ve dosya yolu okunamiyor ve kopyalanamiyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── D2: canli bolgeler ──────────────────────────────────────────────────────
test('D2: Toast kabi mesaj OLMADAN da DOM’da (canli bolge onceden var)', () => {
  const src = read('components/common/Toast.tsx');
  assert.ok(!/if \(toasts\.length === 0\) return null;/.test(src),
    'kap bos iken null donuyor — bolge mesajla AYNI ANDA olusur ve duyurulmaz');
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /aria-atomic="false"/, 'bildirimler tek tek okunmali, kap topluca degil');
});

test('D2: hatalar KESER, digerleri sirasini bekler', () => {
  // Her bildirimi kesici yapmak, kullanicinin okudugu cumleyi "kaydedildi" gibi
  // onemsiz bir mesaj icin yarida birakmasi demektir.
  const src = read('components/common/Toast.tsx');
  assert.match(src, /role=\{item\.type === "error" \? "alert" : "status"\}/);
});

test('D2: bos kap tiklamayi ENGELLEMIYOR', () => {
  // Kap artik her zaman DOM'da; `pointer-events-none` olmasaydi ekranin sag ust
  // koseSINDE gorunmez ama TIKLAMA YUTAN bir dikdortgen olurdu.
  const src = read('components/common/Toast.tsx');
  assert.match(src, /pointer-events-none/);
  assert.match(src, /pointer-events-auto/, 'kartlarin kendisi yine tiklanabilir olmali');
});

test('D2: is SONUCU duyuruluyor, her yoklama degil', () => {
  const src = read('components/common/JobTrackerBar.tsx');
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /const announcedRef = useRef<Set<string>>\(new Set\(\)\)/,
    'ayni is birden fazla kez okunmamali');
  assert.match(src, /jobs\.filter\(\(j\) => j\.done && !announcedRef\.current\.has\(j\.id\)\)/,
    'yalnizca SONUCLANAN isler duyurulmali — her yoklamada "calisiyor" demek gurultu');
  assert.match(src, /STATUS_LABEL/, 'durum renkli nokta yerine ADIYLA soylenmeli');
});

test('D2: canli bolge erken donusten ETKILENMIYOR', () => {
  // `jobs.length === 0` iken de bolge render edilmeli; aksi halde ILK isin sonucu
  // hic duyurulmaz (bolge o anda olusur).
  const src = read('components/common/JobTrackerBar.tsx');
  assert.match(src, /if \(jobs\.length === 0\) return liveRegion;/);
});

// ── D6: icerige atla ────────────────────────────────────────────────────────
test('D6: skip-link var ve ODAKLANINCA gorunuyor', () => {
  const src = read('layouts/AppLayout.tsx');
  assert.match(src, /href="#main-content"/);
  assert.match(src, /sr-only focus:not-sr-only/, 'gizli kalirsa klavye kullanicisi bulamaz');
  assert.match(src, /İçeriğe atla/);
});

test('D6: hedef GERCEKTEN odaklanabilir', () => {
  // `tabIndex={-1}` olmadan bazi tarayicilar odagi tasimaz: baglanti gorsel olarak
  // calisir ama bir sonraki Tab yine masthead'e doner — yani klavye icin CALISMAZ.
  const src = read('layouts/AppLayout.tsx');
  assert.match(src, /<main id="main-content" tabIndex=\{-1\}/);
});

test('D6: skip-link masthead’den ONCE geliyor', () => {
  const src = read('layouts/AppLayout.tsx');
  assert.ok(src.indexOf('href="#main-content"') < src.indexOf('<Masthead'),
    'skip-link masthead’den sonra ise ilk Tab onu bulmaz — amaci kalmaz');
});

// ── D7: kesilen metin ipucu ─────────────────────────────────────────────────
test('D7: tek-ifadeli truncate ogelerinde title var', () => {
  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const pat = /<(span|div|p|td|h1|h2|h3|h4)\b([^>]*className="[^"]*\btruncate\b[^"]*")([^>]*)>\{([^{}]+)\}<\/\1>/g;
  const offenders = [];
  for (const f of walk(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(pat)) {
      if (m[0].includes('title=')) continue;
      const expr = m[4].trim();
      // JSX iceren ifadeler BILEREK haric: `title` METIN bekler, JSX verilirse
      // tarayici "[object Object]" gosterir — ipucu olmaktan cikar.
      if (expr.includes('<') || expr.includes('>')) continue;
      offenders.push(`${path.relative(ROOT, f)}: ${expr.slice(0, 40)}`);
    }
  }
  assert.deepEqual(offenders, [], `kesilen deger okunamiyor/kopyalanamiyor:\n${offenders.join('\n')}`);
});
