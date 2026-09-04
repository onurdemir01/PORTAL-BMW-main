// server/logx/__tests__/masker.test.cjs — PII maskeleme: maskString + maskLines.
//
// NEDEN KRITIK: log satirlari harici AI API'larina gonderilmeden once TCKN, IBAN, kart
// numarasi, e-posta, telefon, bearer token gibi PII verileri MASKELENMELI. Kurallar
// DB'den yuklenir ama DB erisilemezse sabit set kullanilir — maskeleme HICBIR kosulda
// tamamen devre disi kalmaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskString, maskLines } = require('../masker.cjs');

// ── maskString: TCKN ──────────────────────────────────────────────────────────
test('maskString: TCKN (11 haneli, sifir disinda baslayan) maskelenir', () => {
  const { masked } = maskString('Kullanici TCKN: 12345678901 ile giris yapti');
  assert.ok(!masked.includes('12345678901'), 'TCKN acik kalmamali');
  assert.match(masked, /\[TCKN\]/);
});

test('maskString: sifirla baslayan 11 hane TCKN sayilmaz', () => {
  const { masked, counts } = maskString('Referans: 01234567890');
  // Sifirla baslayan TCKN degil — PHONE_GEN'e dusebilir ama TCKN degil.
  assert.ok(!counts.TCKN, 'sifirla baslayan TCKN sayilmamali');
});

// ── maskString: E-posta ───────────────────────────────────────────────────────
test('maskString: e-posta adresleri maskelenir', () => {
  const { masked } = maskString('Iletisim: ali.veli@example.com.tr');
  assert.ok(!masked.includes('ali.veli@example.com.tr'));
  assert.match(masked, /\[EMAIL\]/);
});

// ── maskString: Bearer token / JWT ────────────────────────────────────────────
test('maskString: Bearer token maskelenir', () => {
  // "Authorization:" on eki olmadan Bearer token (AUTH_HDR kurali tetiklenmez).
  const { masked } = maskString('token=Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
  assert.ok(!masked.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.match(masked, /Bearer \[TOKEN\]/);
});

test("maskString: Authorization header Bearer token'i AUTH_HDR olarak maskelenir", () => {
  // "Authorization:" on ekiyle gelince AUTH_HDR kurali ONCE devreye girer.
  const { masked } = maskString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig');
  assert.match(masked, /Authorization: \[REDACTED\]/);
});

test('maskString: bagimsiz JWT maskelenir', () => {
  const { masked } = maskString('token=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.abc123_def');
  assert.match(masked, /\[JWT\]/);
});

// ── maskString: Sifre kaliplari ───────────────────────────────────────────────
test('maskString: JSON password alani maskelenir', () => {
  const { masked } = maskString('{"username":"ali","password":"gizli123","role":"admin"}');
  assert.ok(!masked.includes('gizli123'), 'sifre acik kalmamali');
  assert.match(masked, /\[REDACTED\]/);
});

test('maskString: query-string password maskelenir', () => {
  const { masked } = maskString('login?user=ali&password=super_secret&next=/home');
  assert.ok(!masked.includes('super_secret'));
  assert.match(masked, /password=\[REDACTED\]/);
});

// ── maskString: Telefon ───────────────────────────────────────────────────────
test('maskString: TR telefon numarasi maskelenir', () => {
  const { masked } = maskString('Aranan numara: +90 532 123 45 67');
  assert.ok(!masked.includes('532'));
  assert.match(masked, /\[PHONE\]/);
});

test('maskString: 05xx ile baslayan TR telefon maskelenir', () => {
  const { masked } = maskString('Tel: 0532-123-45-67');
  assert.match(masked, /\[PHONE\]/);
});

// ── maskString: Kart numarasi ─────────────────────────────────────────────────
test('maskString: kredi karti numarasi maskelenir', () => {
  const { masked } = maskString('Kart: 4111 1111 1111 1111');
  assert.ok(!masked.includes('4111'));
  assert.match(masked, /\[CARD\]/);
});

// ── maskString: Authorization header ──────────────────────────────────────────
test('maskString: Authorization header degeri tamamen maskelenir', () => {
  const { masked } = maskString('Authorization: Basic dXNlcjpwYXNz');
  assert.match(masked, /Authorization: \[REDACTED\]/);
});

// ── maskString: genel davranislar ─────────────────────────────────────────────
test('maskString: PII icermeyen metin DEGISMEZ', () => {
  const input = 'Sunucu baslatildi, port 8080 dinleniyor.';
  const { masked, counts } = maskString(input);
  assert.equal(masked, input);
  assert.deepEqual(counts, {}, 'maskeleme olmadiysa counts bos olmali');
});

test("maskString: non-string girdi String'e cevrilir, hata atmaz", () => {
  const { masked } = maskString(42);
  assert.equal(masked, '42');
  const { masked: m2 } = maskString(null);
  assert.equal(m2, 'null');
});

test('maskString: counts her kural icin ayri sayim yapar', () => {
  const input = 'TCKN: 12345678901, e-posta: a@b.com, diger: 98765432109';
  const { counts } = maskString(input);
  assert.ok(counts.TCKN >= 1, 'TCKN sayilmali');
  assert.ok(counts.EMAIL >= 1, 'EMAIL sayilmali');
});

// ── maskLines ─────────────────────────────────────────────────────────────────
test('maskLines: satir dizisi maskeleme sayimlarini toplayarak doner', () => {
  const lines = [
    'Kullanici ali@test.com giris yapti',
    'TCKN: 12345678901 ile islem yapildi',
    'Normal log satiri',
  ];
  const { maskedLines, totalMasked, countsByRule } = maskLines(lines);
  assert.equal(maskedLines.length, 3);
  assert.ok(totalMasked >= 2, 'en az 2 maskeleme olmali');
  assert.ok(countsByRule.EMAIL >= 1);
  assert.ok(countsByRule.TCKN >= 1);
});

test('maskLines: bos dizi guvenli sonuc doner', () => {
  const { maskedLines, totalMasked, countsByRule } = maskLines([]);
  assert.deepEqual(maskedLines, []);
  assert.equal(totalMasked, 0);
  assert.deepEqual(countsByRule, {});
});

test('maskLines: dizi olmayan girdi bos sonuc doner (patlamaz)', () => {
  const { maskedLines, totalMasked } = maskLines(null);
  assert.deepEqual(maskedLines, []);
  assert.equal(totalMasked, 0);
  const r2 = maskLines('not-an-array');
  assert.deepEqual(r2.maskedLines, []);
});

test('maskLines: coklu PII ayni satirda hepsi maskelenir', () => {
  const { maskedLines, totalMasked } = maskLines([
    'TCKN: 12345678901, e-posta: ali@test.com, tel: +90 532 123 45 67',
  ]);
  assert.ok(totalMasked >= 3, 'ayni satirdaki tum PII maskelenmeli');
  assert.ok(!maskedLines[0].includes('12345678901'));
  assert.ok(!maskedLines[0].includes('ali@test.com'));
});

test('maskLines: countsByRule kurallar arasi TOPLAM dogrular', () => {
  const lines = [
    'Kullanici 1: ali@a.com, TCKN 12345678901',
    'Kullanici 2: veli@b.com, TCKN 98765432109',
  ];
  const { countsByRule, totalMasked } = maskLines(lines);
  const sum = Object.values(countsByRule).reduce((a, b) => a + b, 0);
  assert.equal(sum, totalMasked, "countsByRule toplami totalMasked'a esit olmali");
});
