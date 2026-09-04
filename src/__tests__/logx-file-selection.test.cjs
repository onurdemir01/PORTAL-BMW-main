// src/__tests__/logx-file-selection.test.cjs — D2/D4: sanallastirma ve arama.
//
// D2 · Aramaya yazinca `filtering` TUM gruplari ZORLA aciyordu: 30 sunucu x ~500 dosya
//      = ~15.000 satir tek seferde DOM'a. FileX AYNI sorunu uretimde yasayip cozmus
//      (FileListResultStep.tsx: "tarayici sekmesini kilitleyip beyaz ekrana yol acti —
//      uretimde gozlemlendi"). Ayni desen buraya da uygulandi.
//
// D4 · Her tus vurusunda tum agac yeniden suzuluyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'logx_v2', 'steps', 'legacy', 'FileSelectionStep.tsx'),
  'utf8',
);
const DOWNLOAD = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'logx_v2', 'shared', 'DownloadStep.tsx'),
  'utf8',
);

// ── BICIM DUYARSIZ OKUMA ────────────────────────────────────────────────────
// Bu bekciler bir KURALI kilitler (sanallastirma var mi), tirnak bicimini degil.
// Depoya prettier girince `from "@tanstack/react-virtual"` tek tirnaga dondu ve
// bekci kural aynen dururken KIRMIZI oldu. `norm()` yalnizca bosluk ve tirnak
// bicimini esitler; anlam tasiyan hicbir sey silinmez.
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

test('D2: liste sanallastirilmis (FileX ile AYNI kutuphane)', () => {
  assert.match(
    norm(SRC),
    /from "@tanstack\/react-virtual"/,
    'sanallastirma yok — 15.000 satir DOM’a basilir',
  );
  assert.match(norm(SRC), /useVirtualizer\(\{/);
  assert.match(norm(SRC), /getScrollElement: \(\) => scrollRef\.current/);
});

test('D2: agac TEK duz satir listesine cevriliyor', () => {
  // Ic ice kaydirma alanlari (host basina bir sanallastirici) olcum ve klavye
  // gezinmesi acisindan kirilgan olurdu; tek duz liste secildi.
  assert.match(SRC, /const rows = useMemo<Row\[\]>/);
  assert.match(SRC, /count: rows\.length/);
});

test('D2: DOM boyutu dosya sayisindan bagimsiz — sabit yukseklikli kap', () => {
  assert.match(SRC, /style=\{\{ height: LIST_HEIGHT \}\}/);
  assert.ok(!/max-h-96 overflow-y-auto space-y-2/.test(SRC), 'eski sanallastirmasiz kap duruyor');
});

test('D4: arama dogrudan degil, ERTELENMIS degerle suzuyor', () => {
  assert.match(SRC, /useDeferredValue/, 'her tus vurusunda tum agac yeniden suzuluyor');
  assert.match(
    SRC,
    /const searchPending = rawQuery !== query;/,
    'kullanici suzmenin surdugunu gormeli',
  );
});

test('D1: siralama her duzeyde EN YENI USTTE, tarihsizler ALTTA', () => {
  assert.match(SRC, /const byNewestDesc = /);
  // null'lar sona: "bilinmiyor"u ust sira yapmak siralamanin amacini yok ederdi.
  assert.match(SRC, /if \(a\.newest === null\) return 1;/);
  assert.match(SRC, /if \(b\.newest === null\) return -1;/);
  assert.match(SRC, /\.sort\(byNewestDesc\)/);
});

test('D3: gonderilecek GOVDE olculuyor ve sinir asilirsa buton kapali', () => {
  assert.match(SRC, /selectionPayloadBytes\(chosen\)/, 'olcum secimin kendisi uzerinden yapilmali');
  assert.match(
    SRC,
    /disabled=\{selected\.size === 0 \|\| busy \|\| overLimit\}/,
    'sinir asildiginda gonderim engellenmiyor — istek sunucuya HIC ulasmaz',
  );
});

test('EK: log tipi rozeti, son-24-saat suzgeci ve grup toplami var', () => {
  assert.match(SRC, /KIND_LABEL\[f\.kind\]/, 'log tipi rozeti yok');
  assert.match(SRC, /Son 24 saat/, 'son 24 saat suzgeci yok');
  assert.match(
    SRC,
    /row\.bytes > 0 && ` · \$\{fmtSize\(row\.bytes\)\}`/,
    'dizin/host grup toplami gosterilmiyor',
  );
});

test('EK: indirme ekraninda sizeBytes GOSTERILIYOR', () => {
  // Alan API'de vardi ama hicbir yerde gosterilmiyordu; indirme res.blob() ile
  // TAMAMEN bellege alindigi icin kullanici boyutu ONCEDEN bilmeli.
  assert.match(DOWNLOAD, /item\.sizeBytes \? \(/);
  assert.match(
    DOWNLOAD,
    /items\.reduce\(\(n, it\) => n \+ \(it\.sizeBytes \|\| 0\), 0\)/,
    'coklu arsivde toplam boyut gosterilmiyor',
  );
});

test('mtime tipi duzeltilmis (number | string)', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'logxV2Api.ts'), 'utf8');
  assert.match(
    api,
    /mtime\?: number \| string;/,
    'tip hala yalniz `string` — ansible.builtin.find epoch SAYI dondurur',
  );
});
