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
  const d = sunucuDegerlendir(ONCE, { once_var: true, son_olculdu: true, goruntu: ilk, son_goruntu: son, islemler: ['SONUC|baslat|NGINX||OK|ok'] });
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

test('RR6 durustluk: "otomatik kapatildi" YALNIZ SONUC|durdur|..|OK ile; komutsuz kalkan/kapanan "kendiliginden"', () => {
  // Uretim 2026-11-14: rapor betigin hic durdurmadigi urunler icin "otomatik kapatildi" yaziyordu.
  const once = ['BOOT|b1||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'];
  const ilk = ['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|IHS||', 'JVM|JBOSS8|appA|x', 'JVM|JBOSS8|yeni|x', 'JVM|JBOSS8|yeni2|x'];
  const son = ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'];
  const d = sunucuDegerlendir(once, { son_olculdu: true, goruntu: ilk, son_goruntu: son, islemler: ['SONUC|durdur|JBOSS8|yeni|OK|stop', 'SONUC|durdur|JBOSS8|yeni2|FAIL|x'] });
  const by = Object.fromEntries(d.bulgu.map((b) => [b.servis, b.durum]));
  assert.equal(by['JBoss 8 JVM — yeni'], 'KAPATILDI');
  assert.equal(by['JBoss 8 JVM — yeni2'], 'KOMUT_HATALI_KAPANDI', 'FAIL donen durdurma "otomatik kapatildi" ya da "komut calistirmadi" sayildi');
  assert.equal(by['IBM HTTP Server (IHS)'], 'KENDILIGINDEN_KAPANDI', 'betik urunu hic durdurmaz; "otomatik kapatildi" yazilamaz');
  const ac = sunucuDegerlendir(once, { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: son, islemler: ['SONUC|baslat|JBOSS8|appA|SKIP|kendiliginden kalkti'] });
  assert.equal(ac.bulgu.find((b) => b.servis === 'JBoss 8 JVM — appA')?.durum, 'KENDILIGINDEN_ACILDI');
});

test('RR7 once goruntusu bos -> UYARI (ONCE_BOS); JVM satiri urunun calistigini kanitlar', () => {
  const bos = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'] });
  assert.equal(bos.sonuc, 'WARNING');
  assert.ok(bos.bulgu.some((b) => b.durum === 'ONCE_BOS'));
  assert.ok(bos.bulgu.some((b) => b.durum === 'NEW_URUN'), 'once calismayan ama simdi calisan urun kontrol uyarisi degil');
  const jvmli = sunucuDegerlendir(['BOOT|b1||', 'JVM|JBOSS8|appA|x'], { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'] });
  assert.equal(jvmli.sonuc, 'OK', `JVM'i calisan urun "yeni" sayildi: ${JSON.stringify(jvmli.bulgu)}`);
  const h = raporHtml({ id: 4, hosts: ['A'], once: { sonuc: { sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b1||'] } } } }, sonra: {} });
  assert.match(h, /izlenen ürün yok — uygulamalar kapalıyken mi alındı\?/);
});

test('RR8 yalniz SONUC satirinda gorulen (durulma goruntusunde acilip JVM planiyla kapatilan) JVM raporda gorunur', () => {
  // Inceleme 2026-11-14 (B2): app2 ilk ve son goruntude yok, yalniz durul.psv'de vardi; JVM plani durdurdu.
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x'];
  const ilk = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x'];
  const d = sunucuDegerlendir(once, { son_olculdu: true, goruntu: ilk, son_goruntu: ilk, islemler: ['SONUC|durdur|JBOSS8|app2|OK|stop'] });
  const b = d.bulgu.find((x) => x.servis === 'JBoss 8 JVM — app2');
  assert.equal(b?.durum, 'KAPATILDI', JSON.stringify(d.bulgu));
  assert.match(b.aciklama, /durulma beklemesinde görüldü/);
});

test('RR9 komut FAIL donup oge yine de kalktiysa "komut calistirmadi" denmez (KOMUT_HATALI_ACILDI)', () => {
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x'];
  const d = sunucuDegerlendir(once, { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x'], islemler: ['SONUC|baslat|JBOSS8|app1|FAIL|cli zaman asimi'] });
  const b = d.bulgu.find((x) => x.servis === 'JBoss 8 JVM — app1');
  assert.equal(b?.durum, 'KOMUT_HATALI_ACILDI');
  assert.doesNotMatch(b.aciklama, /çalıştırmadan/);
});

test('RR10 eski surum once goruntusu (SURUM yok) JBoss bazinda karsilastirilmaz: ESKI_SURUM uyarisi, sahte DOWN/NEW yok', () => {
  const once = ['BOOT|b1||', 'URUN|JBOSS7||', 'URUN|NGINX||', 'JVM|JBOSS7|app1|jboss_home=/vhosting8/jboss/AppServer'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'URUN|NGINX||', 'JVM|JBOSS8|app1|jboss_home=/vhosting8/jboss/AppServer'];
  const d = sunucuDegerlendir(once, { son_olculdu: true, goruntu: son, son_goruntu: son });
  assert.deepEqual(d.bulgu.map((b) => b.durum), ['ESKI_SURUM']);
  assert.equal(d.sonuc, 'WARNING');
  const eskiSon = ['BOOT|b2||', ...once.slice(1)];
  const ayni = sunucuDegerlendir(once, { son_olculdu: true, goruntu: eskiSon, son_goruntu: eskiSon });
  assert.equal(ayni.sonuc, 'OK', 'iki taraf da eski surumken ESKI_SURUM denildi');
});
