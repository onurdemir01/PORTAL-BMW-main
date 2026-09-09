// src/__tests__/nobet-kisi-nobetleri.test.cjs
//
// "Nöbet Çizelgesi > bir kişinin tüm nöbetleri" görünümünün SESSİZCE bozulabilecek
// kararlarını kilitler. vitest kurulu olmadığı için (bkz. diğer src/__tests__ dosyaları)
// kontrol KAYNAK metni üzerinden yapılır — bileşen render edilmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'DutyRosterPage.tsx'),
  'utf8',
);

test('kişi listesi AY FİLTRESİNDEN etkilenmez (en sinsi hata)', () => {
  // `filtered` seçili aya göre süzülmüş listedir. Modala onu vermek "tüm nöbetleri"
  // sorusunu sessizce "bu ayki nöbetleri"ne çevirirdi: ekran dolu görünür, sayı yanlış olur.
  const m = SRC.match(/<PersonDutiesModal[\s\S]{0,240}?\/>/);
  assert.ok(m, 'PersonDutiesModal render satırı bulunamadı');
  assert.ok(/list=\{nobetList\}/.test(m[0]), 'modala TÜM liste (nobetList) verilmeli');
  assert.ok(!/list=\{filtered\}/.test(m[0]), 'modala ay-filtreli liste VERİLMEMELİ');
});

test('kişi eşleştirmesi E-POSTA önceliklidir', () => {
  const fn = SRC.match(/function personKey\([\s\S]*?\n\}/);
  assert.ok(fn, 'personKey bulunamadı');
  const body = fn[0];
  // E-posta dolu ise ondan türeyen anahtar döner; ada DÜŞÜŞ ondan SONRA gelir.
  assert.ok(body.indexOf('email') < body.indexOf('name'), 'önce e-posta denenmeli');
  assert.ok(/toLowerCase\(\)/.test(body), 'karşılaştırma küçük harfe normalize edilmeli');
});

test('hem ASIL hem YEDEK nöbetler toplanır', () => {
  const fn = SRC.match(/function dutiesOfPerson\([\s\S]*?\n\}/);
  assert.ok(fn, 'dutiesOfPerson bulunamadı');
  assert.ok(/asNobetci/.test(fn[0]), 'asıl nöbetçi kayıtları');
  assert.ok(/yedekNobetci/.test(fn[0]), 'yedek nöbetçi kayıtları');
  assert.ok(/sort\(/.test(fn[0]), 'tarihe göre sıralanmalı');
});

test('kişi adı <button> — klavyeyle erişilebilir olmalı', () => {
  // TS yıkım imzasındaki `}: {` satırı da `}` ile başlar; naif bir kapanış deseni
  // fonksiyonu ORADA keser ve gövde hiç incelenmemiş olur. Kapanış olarak TEK BAŞINA
  // `}` satırı aranır.
  const fn = SRC.match(/function PersonButton\([\s\S]*?\n\}\n/);
  assert.ok(fn, 'PersonButton bulunamadı');
  assert.ok(/<button/.test(fn[0]), '<div onClick> değil <button> kullanılmalı');
  assert.ok(/type="button"/.test(fn[0]), 'form içinde istenmeyen submit olmasın');
  assert.ok(/title=/.test(fn[0]), 'ne işe yaradığı fare üstüne gelince anlaşılmalı');
});

test('bugün YEREL saate göre hesaplanır (toISOString UTC olurdu)', () => {
  const fn = SRC.match(/function todayLocalIso\([\s\S]*?\n\}/);
  assert.ok(fn, 'todayLocalIso bulunamadı');
  assert.ok(
    !/toISOString/.test(fn[0]),
    'toISOString UTC döner; gün sınırında "bugün" satırı yanlış işaretlenirdi',
  );
  assert.ok(/getFullYear|getMonth|getDate/.test(fn[0]), 'yerel tarih bileşenleri kullanılmalı');
});

test('tabloda hem nöbetçi hem yedek adı tıklanabilir', () => {
  const hits = SRC.match(/<PersonButton\s/g) || [];
  assert.ok(hits.length >= 2, `en az 2 PersonButton bekleniyordu, ${hits.length} bulundu`);
});

test('yardım bölümü bu özelliği anlatıyor', () => {
  assert.ok(
    /Bir Kişinin Tüm Nöbetleri/.test(SRC),
    'yeni özellik yardım metnine eklenmemiş',
  );
});
