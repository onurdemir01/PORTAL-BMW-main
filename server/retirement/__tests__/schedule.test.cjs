// server/retirement/__tests__/schedule.test.cjs — RZ1..RZ8 (2026-10-06).
//
// Retirement zamanlama kurallari. Kullanici karari: "Production icin OCO talebi girisi
// zorunlu olacak, OCO'daki tarih ve saate gore uygulama stop adimi baslar. Delete kismi
// icin ekstra talep olmaz, otomatik olarak is scheduled edilir ve tarih geldiginde is
// yapilir."
//
// EN PAHALI UC YANLIS, bu bekcilerin kilitledigi sey:
//   1. STOP'u OCO penceresi DISINDA kosturmak -> onaylanmamis bir saatte uretim durur
//   2. Penceresi KACIRILMIS bir STOP'u sessizce kosturmak -> ayni sey
//   3. STOP HIC yapilmamisken silmeye zamanlamak -> hic durdurulmamis uygulama silinir
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { etkinSilmeGunu, silmeZamaniGeldi, stopZamani } = require('../schedule.cjs');

const N = new Date('2026-10-06T12:00:00Z');

test('RZ1 kesin tarih verilmisse gun sayisini EZER (acanin bilincli karari)', () => {
  assert.equal(
    etkinSilmeGunu({ plannedDeleteAt: '2026-12-01', stopAt: '2026-10-01', deleteAfterDays: 45 }),
    '2026-12-01',
    'ekranda ayrica doldurulan kesin tarih yok sayilmis',
  );
});

test('RZ2 kesin tarih yoksa stop + gun', () => {
  assert.equal(
    etkinSilmeGunu({ plannedDeleteAt: null, stopAt: '2026-10-01T00:00:00Z', deleteAfterDays: 45 }),
    '2026-11-15',
  );
  assert.equal(
    etkinSilmeGunu({ plannedDeleteAt: null, stopAt: '2026-10-01T00:00:00Z', deleteAfterDays: 0 }),
    '2026-10-01',
    'gun 0 gecerli bir degerdir (ayni gun)',
  );
});

test('RZ3 STOP YAPILMADIYSA silme gunu YOKTUR (null)', () => {
  // "stop + 45 gun" bir tarih vermez. Bugunu baslangic saymak, hic durdurulmamis bir
  // uygulamayi 45 gun sonra silmeye zamanlamak olurdu - en pahali yanlis.
  assert.equal(
    etkinSilmeGunu({ plannedDeleteAt: null, stopAt: null, deleteAfterDays: 45 }),
    null,
  );
  assert.equal(
    silmeZamaniGeldi({ plannedDeleteAt: null, stopAt: null, deleteAfterDays: 45 }, N),
    false,
    'durdurulmamis uygulama silmeye zamanlanmis',
  );
});

test('RZ4 bozuk/EKSIK gun degeri silmeye yol acmaz', () => {
  // `Number(null)` ve `Number('')` SIFIR doner: eksik bir deger "stop + 0 gun" = BUGUN
  // silme anlamina geliyordu. Sema NOT NULL DEFAULT 45 ama tek bir bozuk satir hic
  // beklemeden silme tetiklerdi. 0 mesru (ayni gun), null DEGIL.
  for (const g of [NaN, -1, 'abc', null, undefined, ''])
    assert.equal(
      etkinSilmeGunu({ plannedDeleteAt: null, stopAt: '2026-10-01', deleteAfterDays: g }),
      null,
      `bozuk gun degeri (${String(g)}) tarih uretti`,
    );
  // 0 ACIK bir sayi olarak mesrudur
  assert.equal(
    etkinSilmeGunu({ plannedDeleteAt: null, stopAt: '2026-10-01T00:00:00Z', deleteAfterDays: 0 }),
    '2026-10-01',
  );
});

test('RZ5 silme zamani GUN bazinda karsilastirilir', () => {
  const r = (g) => silmeZamaniGeldi({ plannedDeleteAt: g, stopAt: null, deleteAfterDays: 45 }, N);
  assert.equal(r('2026-10-05'), true, 'gecmis tarih');
  assert.equal(r('2026-10-06'), true, 'BUGUN - is o gun icinde kosar');
  assert.equal(r('2026-10-07'), false, 'gelecek tarih');
});

test('RZ6 STOP: pencere acilmadan KOSMAZ', () => {
  const r = stopZamani({ scheduledAt: '2026-10-06T22:00:00Z', windowEnd: '2026-10-07T00:00:00Z' }, N);
  assert.equal(r.durum, 'wait');
  assert.match(r.sebep, /acilmadi/);
});

test('RZ7 STOP: pencere ACIKSA kosar', () => {
  const r = stopZamani({ scheduledAt: '2026-10-06T10:00:00Z', windowEnd: '2026-10-06T14:00:00Z' }, N);
  assert.equal(r.durum, 'run');
});

test('RZ8 STOP: pencere KAPANDIYSA baslatilmaz ve sebebi NE YAPILACAGINI soyler', () => {
  // Sessizce kosturmak, onaylanmamis bir saatte uretimi durdurmak olurdu.
  const r = stopZamani({ scheduledAt: '2026-10-05T10:00:00Z', windowEnd: '2026-10-05T12:00:00Z' }, N);
  assert.equal(r.durum, 'expired');
  assert.match(r.sebep, /yeni bir OCO/i);
  // Pencere SONU bilinmiyorsa (eski kayit) sure asimi IDDIA EDILMEZ; zamani gelmisse kosar
  assert.equal(stopZamani({ scheduledAt: '2026-10-05T10:00:00Z', windowEnd: null }, N).durum, 'run');
  // Zamanlama hic yoksa bekler - "simdi kos" demek, onay akisini atlamak olurdu
  assert.equal(stopZamani({ scheduledAt: null, windowEnd: null }, N).durum, 'wait');
});
