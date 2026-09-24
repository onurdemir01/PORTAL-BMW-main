// server/audit/__tests__/init-scripts-special.test.cjs — IS1..IS3 (2026-09-24).
//
// Kullanici: "Denetim > Init Scripts'de GBEVM* ve GBPRV* sunucularini genel envanterden
// exclude et ve bunlari ayri olarak listele. Ayni durumu Server Hub'da da uygula."
//
// Kilitlenen iddialar:
//   IS1  Cogunluk YALNIZCA genel envanterden hesaplanir; ozel sunucular AYNI cogunluga gore
//        olculur (kendi aralarinda yeni bir cogunluk uydurulmaz) ve ayri blokta doner.
//   IS2  Olcut iki ekranda AYNI regex'tir (Denetim ve Server Hub ayrisirsa sayilar tutmaz).
//   IS3  Ekran secim dugmesini yalnizca ozel sunucu VARSA gosterir ve tum sayaclari secilen
//        kumeden okur (ozet "genel" derken tablo "hepsi" gostermesin).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('IS1 sunucu: cogunluk genel envanterden, GBEVM/GBPRV ayni cogunluga gore ayri raporlanir', () => {
  const src = read('server/audit/denetim.cjs');
  assert.match(src, /const isSpecialHost = \(h\) => SPECIAL_HOST_RE\.test/);
  assert.match(src, /const genelRaw = raw\.filter\(\(r\) => !isSpecialHost\(r\.host\)\)/);
  assert.match(src, /const ozelRaw = raw\.filter\(\(r\) => isSpecialHost\(r\.host\)\)/);
  // ana rapor GENEL kumeden
  assert.match(src, /scriptDeviationReport\(genelRaw, scripts\)/);
  // ozel sunucular GENEL cogunlukla olculur: ucuncu parametre verilir
  assert.match(src, /scriptDeviationReport\(ozelRaw, scripts, majorityOf\)/);
  assert.match(src, /special = scriptReportSummary\(scripts, ozel\.scriptStats, ozel\.hostRows\)/);
  // yanitta ayri alan olarak doner (dosya CRLF olabilir)
  assert.match(src, /\r?\n\s*special,\r?\n/);
});

test('IS2 olcut Denetim ve Server Hub icinde AYNI', () => {
  const denetim = read('server/audit/denetim.cjs');
  const hub = read('server/server-hub/assess.cjs');
  const re = /const SPECIAL_HOST_RE = (\/\^\([^\n]*?\/i);/;
  const a = denetim.match(re);
  const b = hub.match(re);
  assert.ok(a, 'denetim.cjs SPECIAL_HOST_RE tanimlamiyor');
  assert.ok(b, 'server-hub/assess.cjs SPECIAL_HOST_RE tanimlamiyor');
  assert.equal(a[1], b[1], 'iki ekran farkli olcut kullaniyor - sayilar tutmaz');
  assert.equal(a[1], '/^(GBEVM|GBPRV)/i');
});

test('IS3 istemci: secim yalniz ozel sunucu varsa gorunur, sayaclar secilen kumeden', () => {
  const page = read('src/components/DenetimPage.tsx');
  assert.match(page, /const \[cls, setCls\] = useState<'genel' \| 'ozel'>\('genel'\)/);
  assert.match(page, /cls === 'ozel' && data\?\.special \? \(\{ \.\.\.data, \.\.\.data\.special \}/);
  assert.ok(page.includes('{data?.special && ('), 'secim dugmeleri ozel sunucu yoksa cizilmemeli');
  // ozet sayaclari secilen kumeden (shown), ham yanittan degil
  for (const alan of ['hosts', 'identicalHosts', 'totalVariants']) {
    assert.ok(page.includes(`shown!.${alan}`), `${alan} sayaci secilen kumeden okunmuyor`);
  }
  // liste ve script tablosu da secilen kumeden turer
  assert.match(page, /return shown\.scripts\.filter/);
  assert.match(page, /return shown\.hostRows/);
});
