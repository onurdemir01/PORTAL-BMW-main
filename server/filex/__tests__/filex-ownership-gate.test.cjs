// server/filex/__tests__/filex-ownership-gate.test.cjs — is sahipligi FAIL-CLOSED mi.
//
// BULGU (2026-09-07): FileX'in `/job-status/:serverId/:jobId` ucu sahiplik kapisini
// IKI yerde fail-open kuruyordu ve ikisi de sessizdi:
//
//   1) `rows.length &&`  — is `ansible_job_history`de YOKSA kontrol ATLANIP erisim
//      veriliyordu.
//   2) `catch { /* DB hiccup -> fail-open */ }` — DB hatasinda da veriliyordu.
//
// Sonuc: giris yapmis bir kullanici serverId/jobId (kucuk, sirali tamsayilar)
// deneyerek BASKASININ FileX sonucunu okuyabilirdi — o sonuc sunuculardaki
// dizin/dosya listeleridir.
//
// ScaleX'in `denyIfNotOwner`i ayni kapiyi ZATEN fail-closed kuruyordu: iki modul
// ayni soruyu FARKLI katilikta yanitliyordu. Bu bekci ikisini hizada tutar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(SERVER, p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

const FILEX = codeOnly(read('filex/index.cjs'));
const flat = FILEX.replace(/\s+/g, ' ');

test('FO1 SAHIPLIK SORGUSUNUN KENDI catch`i erisimi REDDEDER', () => {
  // BU BEKCI ILK HALINDE KORDU. `erisim reddedildi` ve `status(503)` metinlerini
  // DOSYANIN TAMAMINDA ariyordu; disaridaki genel `catch` de ayni metinleri
  // tasidigi icin, IC catch'teki reddi silen mutasyon YESIL kaldi — yani acik
  // yeniden acilirken bekci hicbir sey demedi.
  //
  // Artik `SELECT TOP 1 username` sorgusunu iceren `try`in KENDI `catch` blogu
  // cikarilip orada reddetme araniyor.
  const at = FILEX.indexOf('SELECT TOP 1 username');
  assert.ok(at > 0, 'sahiplik sorgusu bulunamadi');
  const catchAt = FILEX.indexOf('} catch', at);
  assert.ok(catchAt > at, 'sahiplik sorgusunun catch blogu yok');
  const open = FILEX.indexOf('{', catchAt + 2);
  let depth = 0;
  let block = '';
  for (let i = open; i < FILEX.length; i++) {
    if (FILEX[i] === '{') depth++;
    else if (FILEX[i] === '}' && --depth === 0) {
      block = FILEX.slice(open, i);
      break;
    }
  }
  assert.ok(block.length > 0, 'catch blogu ayristirilamadi');
  assert.match(
    block.replace(/\s+/g, ' '),
    /return res[\s\S]*503/,
    'DB hatasinda erisim REDDEDILMIYOR — bilinmezlikte kapi aciliyor',
  );
});

test('FO2 sahibi BILINMEYEN is icin erisim VERILMEZ', () => {
  // `rows.length &&` deseni: kayit yoksa kontrol atlanir. Olcut, sahip
  // cozulemediginde de REDDEDILMESI.
  assert.match(flat, /if \(!owner \|\| owner !== /, 'sahip bilinmiyorken erisim veriliyor');
});

test('FO3 reddedilen erisim DENETIME yazilir', () => {
  // 403 donmek tek basina hicbir iz birakmiyor: baskasinin isini gormeye calismak,
  // denetim kaydinda gorunmesi gereken tam olarak bu tur bir olay (ScaleX ile ayni).
  assert.match(FILEX, /filex_access_denied/, 'reddedilen erisim denetime yazilmiyor');
});

test('FO4 admin muafiyeti KORUNUYOR', () => {
  assert.match(flat, /reqUser\.role !== 'Admin'/, 'admin muafiyeti dusmus');
});

test('FO5 ScaleX ile AYNI katilikta (iki modul ayrismasin)', () => {
  const scalex = codeOnly(read('scalex/index.cjs'));
  // Ikisi de: DB hatasinda 503, sahip yoksa reddet, reddi denetle.
  for (const [name, src, denied] of [
    ['scalex', scalex, /scalex_access_denied/],
    ['filex', FILEX, /filex_access_denied/],
  ]) {
    assert.match(src, /erisim reddedildi/i, `${name}: DB hatasinda reddetme yok`);
    assert.match(src, denied, `${name}: reddedilen erisim denetlenmiyor`);
  }
});
