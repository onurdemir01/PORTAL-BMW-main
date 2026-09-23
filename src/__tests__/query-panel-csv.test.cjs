// src/__tests__/query-panel-csv.test.cjs — Custom SQL sonucu CSV indirilebilir (2026-09-14).
//
// ── KURAL AYNI, VARSAYIM DEGISTI (2026-09-23) ────────────────────────────────
// Bu bekci eskiden `.join(";")`, BOM kacisi ve `"\r\n"`i QueryPanel'in KENDI
// icinde ariyordu — yani UYGULAMA AYRINTISINI kilitlemisti, KURALI degil.
// CSV uretimi ortak `src/utils/csv.ts`e tasininca o uc ifade panelden cikti.
//
// Dahasi: ayirici artik KULLANICI TERCIHI (`csv_separator`) — Turkce Excel `;`
// bekler ama dosyayi bir script'e besleyen RFC 4180 virgulunu ister. Panelde
// `;` sabitlemek bugun YANLIS olurdu: kullanicinin secimi o ekranda etkisiz
// kalirdi.
//
// Korunan kurallar:
//   1. Dugme sonucun TAMAMINI verir (sayfalanmis degil),
//   2. Bos sonucta pasif,
//   3. Cikti Excel'de dogru acilir (BOM + CRLF) — bu kurallar ORTAK yardimcida.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Custom SQL panelinde sorgu sonucu icin CSV dugmesi var ve tum satirlari verir', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components/envanter/QueryPanel.tsx'), 'utf8');
  assert.ok(
    src.includes('downloadResultCsv(visibleCols, result.rows'),
    'CSV dugmesi sonucun tamamini vermeli',
  );
  assert.ok(/disabled=\{result\.rows\.length === 0\}/.test(src), 'bos sonucta dugme pasif');
  // Uretim ORTAK yardimciya devredilmis olmali; yerel bir kopya geri gelmemeli.
  assert.match(src, /from '@\/utils\/csv'/, 'ortak CSV yardimcisi kullanilmiyor');
  assert.doesNotMatch(src, /text\/csv/, 'panel yine kendi CSV metnini uretiyor');
  assert.doesNotMatch(
    src,
    /separator\s*:\s*['"]/,
    'ayirici sabitlenmis — kullanicinin tercihi bu ekranda etkisiz kalir',
  );
});

test('Ortak yardimci Excel sozlesmesini tasiyor: BOM + CRLF', () => {
  // Bu iki kural ayirici tercihinden BAGIMSIZ ve mutlak: BOM olmadan Excel
  // dosyayi Windows-1252 sanir ve Turkce karakterler bozulur.
  const u = fs.readFileSync(path.join(__dirname, '..', 'utils/csv.ts'), 'utf8');
  // TANIMIN VARLIGI YETMEZ, KULLANILMALI: ilk yazimda yalnizca `\\uFEFF` gecip
  // gecmedigine bakiliyordu ve bekci KORDU — sabit tanimda dururken `Blob`tan
  // cikarildiginda test geciyordu. Bu oturumda besinci kez ayni desen.
  assert.match(u, /const BOM = '\\uFEFF';/, 'BOM kacis ile tanimlanmamis');
  assert.match(u, /new Blob\(\[BOM \+ body\]/, 'BOM uretilen dosyaya EKLENMIYOR');
  assert.match(u, /join\('\\r\\n'\)/, 'satir sonu CRLF degil');
  assert.ok(!u.includes(String.fromCharCode(0xfeff)), 'kaynakta GORUNMEZ BOM karakteri var');
});
