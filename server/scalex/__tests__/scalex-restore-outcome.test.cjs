// server/scalex/__tests__/scalex-restore-outcome.test.cjs — geri alma DENEMESININ sonucu.
//
// KULLANICI SENARYOSU (2026-09-07): "stop ettim, 4 cluster'da 0 oldu; sonra geri al
// dedim, ikisinde olmadi." O iki kayit ekranda duruyordu ama HIC DENENMEMIS olanlardan
// AYIRT EDILEMIYORDU ve NEDEN olmadigi hicbir yerde yazmiyordu.
//
// SEBEP: basarili geri alma satiri SILIYOR (`clearRestored`), basarisiz olan ise
// yalnizca KILIDI birakiyordu — deneme sayisi da sebep de kaydedilmiyordu. Yani
// "durdurulmus" listesi iki farkli gercegi ayni sekilde gosteriyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|--|\{\/\*)/.test(l))
    .join('\n');

const STATE = codeOnly(read('server/scalex/state.cjs'));
const INDEX = codeOnly(read('server/scalex/index.cjs'));
const SETUP = codeOnly(read('server/db/mssql-setup.cjs'));
const PANEL = read('src/components/scalex/StoppedPanel.tsx');
const flat = (s) => s.replace(/\s+/g, ' ');

// FONKSIYON GOVDESINI SUSLU PARANTEZ ESLESTIREREK cikarir.
//
// Ilk halinde `slice(idx, idx + 1400)` kullaniyordum ve pencere fonksiyonun DISINA
// tasip SONRAKI fonksiyonlarin `db.query` cagrilarini da sayiyordu (3 gorunuyordu,
// gercekte 1 var). Sabit pencere, olctugunu sandigin seyi olcmez.
function fnBody(src, header) {
  const at = src.indexOf(header);
  if (at < 0) return '';
  // PARAMETRE LISTESINI ATLA. Bu fonksiyon parametrelerini YIKIYOR
  // (`recordRestoreFailure({ env, tenant, ... })`), yani basliktan sonraki ILK `{`
  // govde degil YIKIM parantezidir — ilk denemede onu alip parametre listesini
  // "govde" sanmistim ve uc kontrol bos metin uzerinde kirmizi dondu.
  // Once parantez listesinin KAPANISINI bul, govde ondan sonra baslar.
  let i = src.indexOf('(', at);
  let paren = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') paren++;
    else if (src[i] === ')' && --paren === 0) break;
  }
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i);
  }
  return '';
}

test('RS1 basarisiz geri alma KAYDEDILIYOR (deneme + zaman + sebep)', () => {
  assert.match(STATE, /async function recordRestoreFailure\(/, 'sonuc kaydeden fonksiyon yok');
  const body = fnBody(STATE, 'async function recordRestoreFailure(');
  assert.ok(body.length > 0, 'fonksiyon govdesi ayristirilamadi');
  assert.match(
    body,
    /restore_attempts\s*=\s*ISNULL\(restore_attempts, 0\) \+ 1/,
    'deneme sayaci artmiyor',
  );
  assert.match(body, /last_restore_at\s*=\s*GETUTCDATE\(\)/, 'deneme zamani yazilmiyor');
  assert.match(body, /last_restore_error\s*=/, 'sebep yazilmiyor');
});

test('RS2 kilit birakma ile sonuc yazma TEK UPDATE (yarim durum olusmasin)', () => {
  // Iki ayri sorgu olsaydi, arada bir cokme "kilit birakildi ama sonuc yazilmadi"
  // (ya da tersi) gibi yarim bir durum uretirdi.
  const body = fnBody(STATE, 'async function recordRestoreFailure(');
  assert.equal((body.match(/db\.query\(/g) || []).length, 1, 'birden fazla sorgu var');
  assert.match(
    body,
    /phase = CASE WHEN phase = 'restoring' THEN 'scaled_down'/,
    'kilit birakilmiyor',
  );
});

test('RS3 basarisiz hedefte GERCEKTEN cagriliyor (olu kod degil)', () => {
  // Bu repoda "yazildi ve hicbir yerden cagrilmadi" sinifi var (bkz. refreshDrift).
  assert.match(INDEX, /recordRestoreFailure\(/, 'fonksiyon hicbir yerden cagrilmiyor');
  // Ve `restore` eyleminin BASARISIZ dalinda olmali.
  const i = INDEX.indexOf("if (parsed.action === 'restore')");
  assert.ok(i > 0, 'restore dali bulunamadi');
  assert.match(
    INDEX.slice(i, i + 900),
    /recordRestoreFailure\(/,
    'sonuc, basarisiz restore dalinda yazilmiyor',
  );
});

test('RS4 sebep KIRPILIYOR (DB sessizce kesmesin)', () => {
  assert.match(
    fnBody(STATE, 'async function recordRestoreFailure('),
    /slice\(0, 1000\)/,
    'uzun hata metni kirpilmiyor',
  );
});

test('RS5 kolonlar MEVCUT kurulumlara da gidiyor (ALTER var)', () => {
  for (const col of ['restore_attempts', 'last_restore_at', 'last_restore_error']) {
    assert.match(
      SETUP,
      new RegExp(`ALTER TABLE scalex_state_mirror ADD ${col}`),
      `${col} icin ALTER yok — mevcut kurulumda kolon olusmaz, her yazim patlar`,
    );
  }
});

test('RS6 ekran UC DURUMU ayirt ediyor (gri / kirmizi / suren)', () => {
  const f = flat(PANEL);
  // KARAR NOKTASINDA olculur, VARLIKTA degil.
  //
  // Ilk halinde yalnizca `/pf-label--red/` ariyordu ve o sinif ekranin BASKA bir
  // yerinde de geciyor (`prod` rozeti) — kirmizi/gri ayrimini tamamen kaldirdigim
  // mutasyonda bekci YESIL kaldi. Olcut artik renk SECIMININ kendisi: deneme sayisi
  // sifirdan buyukse kirmizi, degilse gri.
  assert.match(
    f,
    /attempts > 0 \? 'pf-label--red' : 'pf-label--grey'/,
    'renk secimi deneme sayisina bagli degil — "denendi olmadi" ile "hic denenmedi" ayni gorunur',
  );
  assert.match(f, /r\.phase === 'restoring'/, 'suren islem ayirt edilmiyor');
  // SAHTE YESIL OLMAMALI: basarili geri alma satiri SILER, yani "yesil" kalici bir
  // durum degildir. Uydurulmus bir yesil, olmayan bir bilgiyi varmis gibi sunardi.
  assert.doesNotMatch(f, /pf-label--green/, 'kalici olmayan bir "basarili" durumu uyduruluyor');
});

test('RS7 basarisiz denemenin SEBEBI ekranda yaziyor (ipucunda saklanmiyor)', () => {
  assert.match(flat(PANEL), /lastRestoreError/, 'sebep ekranda hic kullanilmiyor');
  assert.match(flat(PANEL), /geri alınamadı:/, 'sebep gorunur bir satirda yazilmiyor');
});

test('RS8 kunye CLUSTER BAZINDA — gruplama cluster ayrimini YUTMUYOR', () => {
  // Ayna satirlari cluster bazindadir ve oyle kalmali: her cluster ayri geri alinir,
  // ayri basarisiz olabilir. Gruplama yalnizca GORSELDIR.
  const f = flat(PANEL);
  assert.match(f, /g\.rows\.map\(\(r\)/, 'grup icindeki cluster satirlari cizilmiyor');
  assert.match(f, /\{r\.clusterName\}/, 'kunyede cluster adi yazmiyor');
  // Geri al dugmesi SATIR bazinda olmali (grup bazinda degil): iki cluster basarisiz
  // olduysa yalnizca onlar icin cikmali.
  assert.match(f, /onRestore\(r\)/, 'geri al dugmesi cluster satirina bagli degil');
});
