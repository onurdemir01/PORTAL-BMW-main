// server/server-hub/__tests__/reboot-rapor.test.cjs — RR1..RR5 (2026-10-09).
//
// Kullanici: "ekip arkadasimin emeklerinin kaybolmasini istemiyorum; HTML raporunu Portal'da bir
// butona tiklaninca goruntulenebilir yap." Tasarim patch-aggregate-report.py ile ayni, veri Portal'in.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { raporHtml, sunucuDegerlendir } = require('../reboot-rapor.cjs');

const ONCE = ['BOOT|b1||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x', 'JVM|JBOSS8|appB|x'];

test('RR1 sorunsuz sunucu OK; surec sayisi zaten tasinmiyor (fark sayilmaz)', () => {
  const d = sunucuDegerlendir(ONCE, { once_var: true, son_olculdu: true, goruntu: ['BOOT|b2||', ...ONCE.slice(1)], son_goruntu: ['BOOT|b2||', ...ONCE.slice(1)] });
  assert.equal(d.sonuc, 'OK');
  assert.deepEqual(d.bulgu, []);
});

test('RR2 duzeltilen bilgi; duzeltmeye ragmen kapali kritik; fazladan calisan JVM kritik', () => {
  const ilk = ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appB|x', 'JVM|JBOSS8|appC|x'];
  const son = ['BOOT|b2||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appB|x', 'JVM|JBOSS8|appC|x'];
  const d = sunucuDegerlendir(ONCE, { once_var: true, son_olculdu: true, goruntu: ilk, son_goruntu: son });
  const by = Object.fromEntries(d.bulgu.map((b) => [b.servis, b.durum]));
  assert.equal(by.Nginx, 'DUZELTILDI');
  assert.equal(by['JBoss 8 JVM — appA'], 'DOWN');
  assert.equal(by['JBoss 8 JVM — appC'], 'NEW_KALAN');
  assert.equal(d.sonuc, 'PROBLEM');
});

test('RR3 reboot dogrulanamadi uyari; sonuc yok / son goruntu yok KRITIK (sorunsuz sayilmaz)', () => {
  const ayni = ['BOOT|b1||', ...ONCE.slice(1)];
  assert.equal(sunucuDegerlendir(ONCE, { son_olculdu: true, goruntu: ayni, son_goruntu: ayni }).sonuc, 'WARNING');
  assert.equal(sunucuDegerlendir(ONCE, { sonuc_yok: true }).sonuc, 'PROBLEM');
  assert.equal(sunucuDegerlendir(ONCE, undefined).sonuc, 'PROBLEM');
  assert.equal(sunucuDegerlendir(ONCE, { son_olculdu: false, goruntu: ONCE }).sonuc, 'PROBLEM');
});

test('RR4 rapor ekip arkadasinin tasarimini tasir ve tum veriyi KACISLAR', () => {
  const k = {
    id: 7, hosts: ['GBX01', 'GBY02'], not: '<script>alert(1)</script>', olusturan: 'onur',
    once: { sonuc: { sunucular: { GBX01: { goruntu_ok: true, goruntu: ONCE }, GBY02: { goruntu_ok: true, goruntu: ONCE } } } },
    sonra: { sonuc: { sunucular: {
      GBX01: { son_olculdu: true, goruntu: ['BOOT|b2||', ...ONCE.slice(1)], son_goruntu: ['BOOT|b2||', ...ONCE.slice(1)], islemler: [] },
      GBY02: { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'], islemler: ['SONUC|baslat|NGINX||FAIL|<img src=x onerror=1>', 'SONUC|baslat|JBOSS8|appA|OK|ok'] },
    } } },
  };
  const h = raporHtml(k);
  for (const parca of ['Patch Reboot | Durum Raporu', 'Otomatik düzeltme sonrası • Son kontrol', '<h2>Bulgular', '<h2>Otomatik Düzeltme', '<h2>Normal Sunucular', 'Kritik', 'Uyarı', 'Bilgi', 'Normal'])
    assert.ok(h.includes(parca), `rapor bolumu yok: ${parca}`);
  assert.ok(!h.includes('<script>alert'), 'not alani kacislanmadi');
  assert.ok(!h.includes('<img src=x'), 'islem mesaji kacislanmadi');
  assert.match(h, /1 sunucuda kritik durum tespit edildi/);
  assert.match(h, /GBX01<\/td>/, 'normal sunucu izgarada yok');
});

test('RR5 yalniz once kaydi varsa "Reboot oncesi kayit" raporu (alinamayan kirmizi)', () => {
  const h = raporHtml({ id: 3, hosts: ['A', 'B'], once: { sonuc: { sunucular: { A: { goruntu_ok: true, goruntu: ONCE }, B: { goruntu_ok: false } } } }, sonra: {} });
  assert.match(h, /Reboot öncesi kayıt/);
  assert.match(h, /1 \/ 2 sunucunun reboot öncesi görüntüsü kaydedildi/);
  assert.match(h, /Görüntü alınamadı/);
});
