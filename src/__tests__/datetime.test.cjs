// src/__tests__/datetime.test.cjs — D5/D8/D3.
//
// D8 · Repoda ALTI ayri `formatDate`/`fmt` kopyasi ve 33 ciplak
//      `toLocaleString("tr-TR")` cagrisi vardi. Kopyalar birbirinden SESSIZCE
//      ayrilmisti: bos deger kimi "-" kimi "—", gecersiz tarih kimi ham ISO kimi
//      "Invalid Date", ve en onemlisi SAAT DILIMI — `AuditLogTab` Europe/Istanbul'a
//      SABITLIYOR, digerleri tarayicinin yerel dilimini kullaniyordu. Bu yalnizca
//      tutarsizlik degil DOGRULUK sorunu: baska bir dilimde duran bir makineden
//      bakildiginda AYNI OLAY, denetim kaydinda bir saat, is gecmisinde baska bir
//      saat gosteriyordu.
//
// D5 · `document.title` SIFIR kullanimdaydi: 15+ sayfanin hepsi "BMW Portal".
//      Birden fazla sekme acan kullanici (bu portalda normal) hangisinin hangisi
//      oldugunu anlayamiyordu.
//
// D3 · Iskeletler. NOT: `animate-spin` kullanimlarinin buyuk cogunlugu (50 kadari)
//      BUTON ICI spinner'dir ve orada DOGRU olan spinner'dir; onlara dokunulmadi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Gercek kaynagi derleyip CALISTIRIR — kopyasini degil.
function load(rel, extraShim = (x) => x) {
  const out = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', extraShim(out))(m, m.exports, require);
  return m.exports;
}

const DT = load('utils/datetime.ts');

// ── D8: tarih bicimlendirme ─────────────────────────────────────────────────
test('D8: saat dilimi SABIT — ekrandan ekrana kaymaz', () => {
  assert.equal(DT.PORTAL_TZ, 'Europe/Istanbul');
  // Ayni an, makinenin dilimi ne olursa olsun AYNI metni uretmeli.
  const iso = '2026-08-27T09:00:00Z';   // 12:00 Istanbul (UTC+3)
  assert.match(DT.fmtDateTime(iso), /27\.08\.2026 12:00/);
});

test('D8: bos ve gecersiz degerler TEK bir isaretle', () => {
  for (const v of [null, undefined, '', 'gecersiz', NaN]) {
    assert.equal(DT.fmtDateTime(v), DT.EMPTY_MARK, `bos/gecersiz deger isareti tutarsiz: ${String(v)}`);
    assert.equal(DT.fmtDate(v), DT.EMPTY_MARK);
  }
  // Eski kopyalarin bir kismi gecersiz tarihte HAM ISO metnini geri veriyordu;
  // kullanici tabloda "2026-08-27T09:00:00Z" gibi bir sey goruyordu.
  assert.ok(!DT.fmtDateTime('gecersiz').includes('gecersiz'));
});

test('D8: Date, epoch ve ISO — ucu de kabul edilir', () => {
  const ms = Date.UTC(2026, 7, 27, 9, 0, 0);
  const expected = DT.fmtDateTime(new Date(ms));
  assert.equal(DT.fmtDateTime(ms), expected);
  assert.equal(DT.fmtDateTime('2026-08-27T09:00:00Z'), expected);
});

test('D8: saniyeli surum yalnizca denetim/teshis icin ayri', () => {
  // Liste ekranlarinda saniye gurultu yapiyor ve kolon genisligini sisiriyordu.
  assert.ok(!/second/.test(DT.fmtDateTime.toString()));
  assert.match(DT.fmtDateTimeSeconds('2026-08-27T09:00:05Z'), /12:00:05/);
});

test('D8: goreli zaman (LogX’ten ORTAK module tasindi)', () => {
  const now = Date.now();
  assert.equal(DT.fmtRelative(now - 30 * 1000), 'az önce');
  assert.equal(DT.fmtRelative(now - 5 * 60000), '5 dk önce');
  assert.equal(DT.fmtRelative(now - 2 * 3600000), '2 saat önce');
  assert.equal(DT.fmtRelative(now - 3 * 86400000), '3 gün önce');
  assert.equal(DT.fmtRelative(null), '');
});

test('D8: kopya bicimlendiriciler KALMADI', () => {
  const copies = [
    'DutyRosterPage.tsx', 'admin/tabs/AuditLogTab.tsx', 'admin/tabs/SmartTicketsTab.tsx',
    'admin/tabs/OcoSchedulesPanel.tsx', 'admin/tabs/DbBackupTab.tsx',
    'self_service/RequestsSidePanel.tsx',
  ];
  const offenders = [];
  for (const f of copies) {
    const src = read(`components/${f}`);
    if (/^function (formatDate|fmt)\s*\(/m.test(src)) offenders.push(f);
    if (!/from "@\/utils\/datetime"/.test(src)) offenders.push(`${f} (ortak modulu kullanmiyor)`);
  }
  assert.deepEqual(offenders, [], `kopya bicimlendirici:\n${offenders.join('\n')}`);
});

test('D8: sabitlenen saat dilimi TEK yerde', () => {
  // Yorumlar KARARI anlatmak icin dilimden bahsediyor — gercek KODA bak.
  const src = read('utils/datetime.ts')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal((src.match(/Europe\/Istanbul/g) || []).length, 1,
    'saat dilimi birden fazla yerde yazili — degistirmek icin tek satir olmali');
  // Baska hicbir dosyada elle yazilmamis olmali.
  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const leaks = walk(ROOT)
    .filter((f) => !f.endsWith('utils/datetime.ts'))
    .filter((f) => /Europe\/Istanbul/.test(
      fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    ))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(leaks, [], `saat dilimi elle yazilmis: ${leaks.join(', ')}`);
});

// ── D5: sekme basligi ───────────────────────────────────────────────────────
test('D5: baslik menuyle AYNI kaynaktan turetilir (liste kopyalanmaz)', () => {
  const src = read('hooks/useDocumentTitle.ts');
  assert.match(src, /from "@\/config\/elements"/,
    'ayri bir yol->baslik eslemesi tutulursa yeni sayfa eklendiginde guncellemek unutulur');
});

test('D5: yol -> baslik esleme davranisi', () => {
  const title = load('hooks/useDocumentTitle.ts', (out) =>
    out.replace('require("@/config/elements")',
      `({ PAGES: [
        { id: 'Dashboard', label: 'Dashboard', route: '/dashboard' },
        { id: 'Admin', label: 'Yönetim', route: '/admin' },
      ] })`)
    .replace('require("react")', '({ useEffect: () => {} })')
    .replace('require("react-router-dom")', '({ useLocation: () => ({ pathname: "/" }) })')
  ).titleForPath;

  assert.equal(title('/dashboard'), 'Dashboard · BMW Portal');
  // Alt yollar da dogru sayfaya baglanmali.
  assert.equal(title('/admin/users'), 'Yönetim · BMW Portal');
  // Bilinmeyen yol uygulama adina duser — bos ya da "undefined" gostermez.
  assert.equal(title('/bilinmeyen'), 'BMW Portal');
});

// ── D3: iskeletler ──────────────────────────────────────────────────────────
test('D3: iskelet bileseni var ve ekran okuyucuya durum bildiriyor', () => {
  const src = read('components/common/Skeleton.tsx');
  assert.match(src, /export function SkeletonList/);
  assert.match(src, /aria-busy="true"/);
  assert.match(src, /role="status"/);
});

test('D3: BUTON ICI spinner’lara DOKUNULMADI (orada dogru olan spinner)', () => {
  // Bu test bir REGRESYON bekcisi degil, bir KARARIN kaydi: buton spinner'larini
  // iskelete cevirmek yanlis olurdu ve sonradan "eksik kalmis" diye yapilmasin.
  const denetim = read('components/DenetimPage.tsx');
  assert.match(denetim, /ArrowPathIcon className=\{`w-3\.5 h-3\.5 \$\{loading \? "animate-spin" : ""\}`\} \/> Yenile/);
});

test('D3: bolum duzeyi yuklemeler iskelete gecti', () => {
  for (const f of ['SelfServicePage.tsx', 'self_service/RequestsSidePanel.tsx']) {
    const src = read(`components/${f}`);
    assert.match(src, /<SkeletonList rows=\{\d+\} \/>/, `${f}: bolum yuklemesi hala bos spinner`);
  }
});
