// src/__tests__/csv-birlestirme.test.cjs
//
// CSV URETIMI TEK YERDEN GECSIN.
//
// Ayni 8-10 satir portalda 20'den fazla ekranda yeniden yazilmisti ve
// ayrintilar ayrismisti: `denetim/` icinde BILE 6 ekran virgul, 5 ekran
// noktali virgul kullaniyordu; kimi dosya gorunmez literal BOM, kimi kacis;
// satir sonu `\n` ile `\r\n` arasinda bolunmustu.
//
// Ayiriciyi sabitlemek yerine KULLANICI TERCIHI yapildi — iki mesru ihtiyac
// var (Turkce Excel `;` bekler, bir script'e besleyen RFC 4180 virgulunu
// ister) ve birini secmek digerinin dosyasini bozardi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

/** `src/` altindaki tum .ts/.tsx dosyalari (testler haric). */
function dosyalar(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') dosyalar(p, out);
      continue;
    }
    // `.cjs` TEST dosyalari da taranir: gorunmez BOM tam BURADA sizdi —
    // BOM'u yasaklayan bekcinin KENDISINE (heredoc kacisi bozmustu).
    if (/\.(tsx?|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const goreli = (p) => path.relative(ROOT, p);

// KAPSAM DISI (kullanici karari): Onur'un aktif alani. Bu iki agactaki kopyalar
// bilerek birakildi; listeyi DARALTMAK icin degil, kapsami BELGELEMEK icin var.
const KAPSAM_DISI = /^src\/components\/(nginx_console|server_hub)\//;

/**
 * Gorunmez BOM — KACIS ILE yazilir. Kaynaga literal olarak komak, bu bekcinin
 * yasakladigi seyin ta kendisi olurdu (ve bir kez oldu: bekci KENDINI yakaladi).
 */
const BOM_KARAKTERI = String.fromCharCode(0xfeff);

/** Testler CSV URETMEZ ama BOM taramasina dahildir (CB3). */
const TEST_DOSYASI = /__tests__/;

test('CB1 kapsamdaki HICBIR ekran kendi CSV`sini uretmiyor', () => {
  const suclular = [];
  for (const p of dosyalar()) {
    const rel = goreli(p);
    if (rel === 'src/utils/csv.ts' || KAPSAM_DISI.test(rel) || TEST_DOSYASI.test(rel)) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (/text\/csv/.test(src)) suclular.push(rel);
  }
  assert.deepEqual(
    suclular,
    [],
    `kendi CSV metnini ureten dosya(lar):\n${suclular.join('\n')}`,
  );
});

test('CB2 ayirici HICBIR YERDE sabitlenmemis (tercih islevsiz kalmasin)', () => {
  // Bir cagiran `separator` gecerse kullanicinin tercihi o ekranda ETKISIZ olur.
  const suclular = [];
  for (const p of dosyalar()) {
    const rel = goreli(p);
    if (rel === 'src/utils/csv.ts' || KAPSAM_DISI.test(rel) || TEST_DOSYASI.test(rel)) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (/separator\s*:\s*['"]/.test(src)) suclular.push(rel);
  }
  assert.deepEqual(suclular, [], `ayiriciyi sabitleyen dosya(lar): ${suclular.join(', ')}`);
});

test('CB3 gorunmez BOM karakteri hicbir kaynakta tasinmiyor', () => {
  const suclular = [];
  for (const p of dosyalar()) {
    if (KAPSAM_DISI.test(goreli(p))) continue;
    if (fs.readFileSync(p, 'utf8').includes(BOM_KARAKTERI)) suclular.push(goreli(p));
  }
  assert.deepEqual(suclular, [], `gorunmez BOM tasiyan dosya(lar): ${suclular.join(', ')}`);
});

test('CB4 ayirici tercihi EKRANDAN degistirilebiliyor', () => {
  const m = fs.readFileSync(path.join(SRC, 'components/layout/Masthead.tsx'), 'utf8');
  assert.match(m, /CSV_SEPARATOR_PREF/, 'tercih anahtari menude kullanilmiyor');
  assert.match(m, /prefsApi\.set\(/, 'secim kaydedilmiyor — sayfa yenilenince kaybolur');
  // Asenkron yuklenen tercih menude TAZELENMELI, yoksa hep varsayilan gorunur.
  assert.match(m, /prefsApi\s*\n?\s*\.getAll\(\)/, 'tercih yuklendikten sonra tazelenmiyor');
});

test('CB5 taşınan ekranlar ortak yardimciyi GERCEKTEN cagiriyor', () => {
  // Yerel tanim silinip import eklenmemis olsaydi ekran derlenmezdi; yine de
  // ornek bir kume uzerinde acikca dogrulanir.
  for (const rel of [
    'src/components/denetim/NginxAudit.tsx',
    'src/components/DenetimPage.tsx',
    'src/components/EnvanterPage.tsx',
    'src/components/admin/tabs/AuditLogTab.tsx',
    'src/components/admin/tabs/SmartTicketsTab.tsx',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /from '@\/utils\/csv'/, `${rel}: ortak yardimci import edilmemis`);
    assert.doesNotMatch(src, /function csvDownload\(/, `${rel}: yerel kopya duruyor`);
  }
});
