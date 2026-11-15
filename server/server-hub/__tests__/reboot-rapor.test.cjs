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
  const d = sunucuDegerlendir(ONCE, { once_var: true, son_olculdu: true, betik_surum: 3, goruntu: ['BOOT|b2||', ...ONCE.slice(1)], son_goruntu: ['BOOT|b2||', ...ONCE.slice(1)] });
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
      GBX01: { once_var: true, betik_surum: 3, son_olculdu: true, goruntu: ['BOOT|b2||', ...ONCE.slice(1)], son_goruntu: ['BOOT|b2||', ...ONCE.slice(1)], islemler: [] },
      GBY02: { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'], islemler: ['SONUC|baslat|NGINX||FAIL|<img src=x onerror=1>', 'SONUC|baslat|JBOSS8|appA|OK|ok'] },
    } } },
  };
  const h = raporHtml(k);
  for (const parca of ['Patch Reboot | Durum Raporu', 'Otomatik düzeltme sonrası • Son kontrol', '<h2>Bulgular', '<h2>Otomatik Düzeltme', 'Normal Sunucular', 'Kritik', 'Uyarı', 'Bilgi', 'Normal', '<h2>Otomasyon Özeti', 'Kutular <b>sunucu</b> sayısıdır', '<h2>Sunucu bazında otomasyon'])
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
  assert.equal(by['IBM HTTP Server (IHS)'], 'KENDILIGINDEN_KAPANDI', 'SONUC|durdur|IHS||OK yokken "otomatik kapatildi" yazilamaz');
  const ac = sunucuDegerlendir(once, { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: son, islemler: ['SONUC|baslat|JBOSS8|appA|SKIP|kendiliginden kalkti'] });
  assert.equal(ac.bulgu.find((b) => b.servis === 'JBoss 8 JVM — appA')?.durum, 'KENDILIGINDEN_ACILDI');
});

test('RR7 once goruntusu bos -> UYARI (ONCE_BOS); JVM satiri urunun calistigini kanitlar', () => {
  const bos = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'] });
  assert.equal(bos.sonuc, 'WARNING');
  assert.ok(bos.bulgu.some((b) => b.durum === 'ONCE_BOS'));
  assert.ok(bos.bulgu.some((b) => b.durum === 'NEW_URUN'), 'once calismayan ama simdi calisan urun kontrol uyarisi degil');
  const jvmli = sunucuDegerlendir(['BOOT|b1||', 'JVM|JBOSS8|appA|x'], { son_olculdu: true, betik_surum: 3, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'] });
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

test('RR10 eski surum once goruntusu (SURUM yok): JBoss satirlari cevrilir, sahte DOWN/NEW yok; JVM\'siz JBoss 7 urunu belirsiz (ESKI_SURUM)', () => {
  const once = ['BOOT|b1||', 'URUN|JBOSS7||', 'URUN|NGINX||', 'JVM|JBOSS7|app1|jboss_home=/vhosting8/jboss/AppServer'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'URUN|NGINX||', 'JVM|JBOSS8|app1|jboss_home=/vhosting8/jboss/AppServer'];
  const d = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 3, goruntu: son, son_goruntu: son });
  assert.deepEqual(d.bulgu.map((b) => b.durum), ['ESKI_SURUM']);
  assert.equal(d.sonuc, 'WARNING');
  const eskiSon = ['BOOT|b2||', ...once.slice(1)];
  const ayni = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 3, goruntu: eskiSon, son_goruntu: eskiSon });
  assert.equal(ayni.sonuc, 'OK', 'iki taraf da eski surumken ESKI_SURUM denildi');
});

test('RR11 eski surum once: cevrilen JBoss JVM\'leri GERCEKTEN karsilastirilir (2026-11-15 gece kosusu: kapali JVM gozden kaciyordu)', () => {
  const once = ['BOOT|b1||', 'URUN|JBOSS7||', 'JVM|JBOSS7|app1|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS7|app2|jboss_home=/usr/jboss/AppServer'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS7||', 'JVM|JBOSS7|app1|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS7|yeni|jboss_home=/usr/jboss/AppServer'];
  const d = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 3, goruntu: son, son_goruntu: son, islemler: [] });
  assert.deepEqual(d.bulgu.map((b) => [b.durum, b.servis]).sort(), [['DOWN', 'JBoss 7 JVM — app2'], ['NEW_KALAN', 'JBoss 7 JVM — yeni']]);
  assert.equal(d.sonuc, 'PROBLEM');
});

test('RR12 otomasyon ozeti ve filtre (v3): basarili / basarisiz / dokunmadi + son durum; sunucu bazinda tablo; satir siniflari', () => {
  const ONCE2 = ['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|NGINX||'];
  const k = {
    id: 9, hosts: ['A1', 'B2', 'C3'], olusturan: 'x',
    once: { sonuc: { sunucular: { A1: { goruntu_ok: true, goruntu: ONCE2 }, B2: { goruntu_ok: true, goruntu: ONCE2 }, C3: { goruntu_ok: true, goruntu: ONCE2 } } } },
    sonra: { sonuc: { sunucular: {
      A1: { once_var: true, betik_surum: 3, son_olculdu: true, goruntu: ['BOOT|b2||', 'SURUM|2||'], son_goruntu: son, islemler: ['SONUC|baslat|NGINX||OK|ok'] },
      B2: { once_var: true, betik_surum: 3, son_olculdu: true, goruntu: son, son_goruntu: son, islemler: ['SONUC|baslat|NGINX||SKIP|zaten'] },
      C3: { once_var: true, betik_surum: 3, son_olculdu: true, goruntu: ['BOOT|b2||', 'SURUM|2||'], son_goruntu: ['BOOT|b2||', 'SURUM|2||'], islemler: ['SONUC|baslat|NGINX||FAIL|hata'] },
    } } },
  };
  const h = raporHtml(k);
  const kutu = (ad) => Number((new RegExp(`>(\\d+)</span><span[^>]*>${ad}<`).exec(h) || [])[1]);
  assert.equal(kutu('Otomasyon başarılı'), 1);
  assert.equal(kutu('Otomasyon başarısız'), 1);
  assert.equal(kutu('Otomasyon dokunmadı'), 1, 'yalniz SKIP olan sunucu dokunulmadi sayilmali');
  assert.equal(kutu('Sorunsuz'), 2);
  assert.equal(kutu('Kontrol gerekli'), 0);
  assert.equal(kutu('Sorun kaldı'), 1);
  // sunucu bazinda tablo: HER sunucu bir satir (normal B2 dahil), calistirilan / calistirilmayan teknoloji nedeniyle
  assert.match(h, /<tr class='r s-PROBLEM o-basarisiz d-sorunlu'><td class='host'>C3<\/td><td><span class='pill problem'[^>]*>Otomasyon başarısız<\/span><\/td><td class='minor'><span style='color:#a12631'>Nginx: açılamadı ✗<\/span>/);
  assert.match(h, /<tr class='r s-INFO o-basarili d-sorunsuz'><td class='host'>A1<\/td><td><span class='pill ok'[^>]*>Otomasyon başarılı<\/span><\/td><td class='minor'><span style='color:#20633f'>Nginx: açıldı ✓<\/span>/);
  assert.match(h, /<tr class='r s-OK o-dokunmadi d-sorunsuz'><td class='host'>B2<\/td>.*Nginx \(zaten doğru durumdaydı \(komut gerekmedi\)\).*Sorunsuz<\/span><\/td><\/tr>/);
  assert.match(h, /#f-dokunmadi:checked ~ table\.fl tr\.r:not\(\.o-dokunmadi\)\{display:none\}/);
  assert.match(h, /#f-obasarisiz:checked ~ table\.fl tr\.r:not\(\.o-basarisiz\)\{display:none\}/);
  assert.match(h, /<div class='filtre'><label for='f-tum'>Tümü<\/label><label for='f-obasarili'>Otomasyon başarılı<\/label><label for='f-obasarisiz'>Otomasyon başarısız<\/label><label for='f-dokunmadi'>Otomasyon dokunmadı<\/label><label for='f-sorunsuz'>Sorunsuz<\/label><label for='f-kritik'>Sorun kaldı \(kritik\)<\/label><label for='f-uyari'>Kontrol gerekli<\/label><label for='f-bilgi'>Bilgi<\/label><\/div>/);
  // radyolar filtreli tablolarin hepsinden once (CSS ~ yalniz sonraki kardesleri secer)
  assert.ok(h.indexOf("id='f-tum'") < h.indexOf('<h2>Sunucu bazında otomasyon'));
  // yeni tablo da filtrelenir (table.fl)
  assert.match(h, /<h2>Sunucu bazında otomasyon <span class='muted'>\(3 sunucu\)<\/span><\/h2>\n<table class='fl'/);
  assert.doesNotMatch(h, /o-islem|o-yok|o-hata/, 'eski filtre siniflari kaldi');
  assert.match(h, /\(2 kayıt · 2 sunucu\)/);
});

test('RR13 2026-11-15 "nasil bulduysan oyle birak": once calismayan URUN kapatildiysa KAPATILDI, hala calisiyorsa KRITIK; kapi korursa uyari', () => {
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const ilk = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||', 'URUN|NGINX||', 'URUN|IHS||', 'URUN|CTG||', 'URUN|JBOSS8||', 'JVM|JBOSS8|j1|x', 'URUN|WAS||'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||', 'URUN|IHS||', 'URUN|CTG||', 'URUN|WAS||'];
  const d = sunucuDegerlendir(once, {
    son_olculdu: true, goruntu: ilk, son_goruntu: son,
    islemler: ['SONUC|durdur|NGINX||OK|x', 'SONUC|durdur|JBOSS8||OK|x', 'SONUC|durdur|IHS||FAIL|x', 'SONUC|durdur|CTG||OK|x'],
  });
  const by = Object.fromEntries(d.bulgu.map((b) => [b.servis, b]));
  // v3 B2: otomasyonun kapattigi URUN uyari ("kontrol edilecek"); urunle kapanan JVM bilgi kalir
  assert.equal(by.Nginx?.durum, 'KAPATILDI_URUN', JSON.stringify(d.bulgu));
  assert.match(by.Nginx.aciklama, /otomatik kapatıldı\. Beklenen durum mu kontrol edin\./);
  assert.equal(by['JBoss 8 JVM — j1']?.durum, 'KAPATILDI', 'urunle kapanan JVM "kendiliginden" sayildi');
  assert.match(by['JBoss 8 JVM — j1'].aciklama, /ürünle birlikte otomatik kapatıldı/);
  assert.equal(by['IBM HTTP Server (IHS)']?.durum, 'NEW_URUN_KALAN');
  assert.match(by['IBM HTTP Server (IHS)'].aciklama, /kapatma komutu BAŞARISIZ/);
  assert.match(by.CTG.aciklama, /başarılı döndü ama süreç hâlâ çalışıyor/);
  assert.match(by.WebSphere.aciklama, /kapatma komutu çalışmadı .*güncel betikle/);
  assert.equal(by['Apache HTTP Server'], undefined, 'once calisan RHA bulgu uretti');
  assert.equal(d.sonuc, 'PROBLEM');
  // kapi (v3): bos once -> web urunu (RHA/IHS) KAPATILIR, hala calisiyorsa kritik; CTG/WAS dokunulmadi (uyari)
  const bos = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, betik_surum: 3, goruntu: son, son_goruntu: son });
  assert.equal(bos.sonuc, 'PROBLEM');
  const bosBy = Object.fromEntries(bos.bulgu.map((b) => [b.servis, b.durum]));
  assert.deepEqual([bosBy['Apache HTTP Server'], bosBy['IBM HTTP Server (IHS)'], bosBy.CTG, bosBy.WebSphere], ['NEW_URUN_KALAN', 'NEW_URUN_KALAN', 'NEW_URUN', 'NEW_URUN']);
  const bosDis = ['BOOT|b2||', 'SURUM|2||', 'URUN|CTG||', 'URUN|WAS||'];
  const bos2 = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, betik_surum: 3, goruntu: bosDis, son_goruntu: bosDis });
  assert.equal(bos2.sonuc, 'WARNING');
  assert.ok(!bos2.bulgu.some((b) => b.durum === 'NEW_URUN_KALAN'));
  const eskiOnce = ['BOOT|b1||', 'URUN|JBOSS7||', 'URUN|NGINX||'];
  const s2 = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'URUN|NGINX||'];
  const bel = sunucuDegerlendir(eskiOnce, { son_olculdu: true, betik_surum: 3, goruntu: s2, son_goruntu: s2 });
  assert.deepEqual(bel.bulgu.map((b) => b.durum).sort(), ['ESKI_SURUM', 'NEW_URUN']);
  assert.equal(bel.sonuc, 'WARNING');
});

test('RR14 inceleme 2026-11-15: SKIP "eski betik" denmez; otomasyon ozeti durdur komutlarini sayar; eski surum JBoss korunur; JVM\'den urun cikarimi', () => {
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||', 'URUN|CTG||'];
  // R2 #1: kapatma aninda kapaliydi (SKIP), sonra kalkti -> eski betik DEGIL
  const sk = sunucuDegerlendir(once, { son_olculdu: true, goruntu: son, son_goruntu: son, islemler: ['SONUC|durdur|CTG||SKIP|zaten kapali'] });
  const ctg = sk.bulgu.find((b) => b.servis === 'CTG');
  assert.equal(ctg?.durum, 'NEW_URUN_KALAN');
  assert.match(ctg.aciklama, /kapatma anında zaten kapalıydı .*sonra yeniden kalktı/);
  assert.doesNotMatch(ctg.aciklama, /eski betik/);
  // R2 #6: otomasyon ozeti - durdur OK / FAIL komut sayilir, SKIP sayilmaz
  const oz = sunucuDegerlendir(once, {
    son_olculdu: true, goruntu: son, son_goruntu: once,
    islemler: ['SONUC|durdur|CTG||OK|x', 'SONUC|durdur|IHS||FAIL|x', 'SONUC|durdur|NGINX||SKIP|zaten kapali', 'SONUC|baslat|RHA||OK|x'],
  });
  assert.deepEqual([oz.komut, oz.komutHata], [3, 1]);
  // R1 B1: eski surum once + ilk/son goruntude yalniz HC -> JBOSS8 NEW_URUN (uyari, dokunulmadi), kritik degil
  const eski = ['BOOT|b1||', 'URUN|JBOSS7||', 'JVM|JBOSS7|srv1|jboss_home=/usr/jboss/AppServer'];
  const hc = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||'];
  const e = sunucuDegerlendir(eski, { son_olculdu: true, goruntu: hc, son_goruntu: hc });
  const j8 = e.bulgu.find((b) => b.servis === 'JBoss 8');
  assert.equal(j8?.durum, 'NEW_URUN', JSON.stringify(e.bulgu));
  // R2 #2: URUN satiri olmayip JVM'i calisan yeni urun -> urun NEW_URUN_KALAN (kritik)
  const jv = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||', 'JVM|JBOSS8|app1|jboss_home=/usr/jboss8/AppServer'];
  const c = sunucuDegerlendir(once, { son_olculdu: true, goruntu: jv, son_goruntu: jv });
  assert.equal(c.bulgu.find((b) => b.servis === 'JBoss 8')?.durum, 'NEW_URUN_KALAN', JSON.stringify(c.bulgu));
  assert.equal(c.sonuc, 'PROBLEM');
});

test('RR15 v3: kapatilan urun WARNING (kontrol edilecek), AWX betigi eskiyse BETIK_ESKI; surum biliniyorken "olabilir" denmez; rapor otomasyonu sunucu ile ayni', () => {
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const ilk = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||', 'URUN|NGINX||'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||'];
  const d = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 3, goruntu: ilk, son_goruntu: son, islemler: ['SONUC|durdur|NGINX||OK|x'] });
  assert.deepEqual(d.bulgu.map((b) => b.durum), ['KAPATILDI_URUN']);
  assert.equal(d.sonuc, 'WARNING', 'otomasyonun kapattigi urun bilgi (normal) sayildi');
  const h0 = raporHtml({ id: 1, hosts: ['A'], once: { sonuc: { sunucular: { A: { goruntu_ok: true, goruntu: once } } } }, sonra: { sonuc: { sunucular: { A: { once_var: true, son_olculdu: true, betik_surum: 3, goruntu: ilk, son_goruntu: son, islemler: ['SONUC|durdur|NGINX||OK|x'] } } } } });
  assert.match(h0, /Otomatik kapatıldı — kontrol edilecek/);
  // eski betik: surum yok / 2 -> uyari bulgusu; 3 -> yok
  for (const [surum, var_] of [[undefined, true], [2, true], ['3', false]]) {
    const x = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: surum, goruntu: son, son_goruntu: son });
    assert.equal(x.bulgu.some((b) => b.durum === 'BETIK_ESKI'), var_, `betik_surum=${surum}`);
  }
  assert.match(sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 2, goruntu: son, son_goruntu: son }).bulgu[0].aciklama, /\(sürüm 2, gerekli 3\): bu koşuda ürün kapatma ve yeniden deneme YOKTU/);
  // komutsuz kalan yeni urun: surum guncelken "eski betik" denmez
  const kal = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 3, goruntu: ilk, son_goruntu: ilk, islemler: [] });
  assert.doesNotMatch(kal.bulgu.find((b) => b.servis === 'Nginx').aciklama, /eski/);
  const kalEski = sunucuDegerlendir(once, { son_olculdu: true, goruntu: ilk, son_goruntu: ilk, islemler: [] });
  assert.match(kalEski.bulgu.find((b) => b.servis === 'Nginx').aciklama, /AWX'teki betik eski \(sürüm yok\)/);
  assert.doesNotMatch(kalEski.bulgu.find((b) => b.servis === 'Nginx').aciklama, /olabilir/);
  // ONCE_BOS metni v3: web urunleri kapatilir; "hicbir sey acilip kapatilmadi" denmez
  const bos = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, betik_surum: 3, goruntu: ['BOOT|b2||'], son_goruntu: ['BOOT|b2||'] });
  assert.match(bos.bulgu[0].aciklama, /yalnız web ürünleri \(Nginx\/Apache\/IHS\)/);
  assert.doesNotMatch(bos.bulgu[0].aciklama, /hiçbir şey açılıp kapatılmadı/);
  // tek kaynak: raporun otomasyon sinifi reboot-check.cjs sonraDegerlendir ile ayni
  const { sonraDegerlendir } = require('../reboot-check.cjs');
  const sonraS = { A: { once_var: true, son_olculdu: true, betik_surum: 3, goruntu: ilk, son_goruntu: ilk, islemler: ['SONUC|durdur|NGINX||OK|x'] } };
  const beklenen = sonraDegerlendir(sonraS, ['A'], { A: once }).A.otomasyon.sinif;
  assert.equal(beklenen, 'basarisiz');
  const h = raporHtml({ id: 2, hosts: ['A'], once: { sonuc: { sunucular: { A: { goruntu_ok: true, goruntu: once } } } }, sonra: { sonuc: { sunucular: sonraS } } });
  assert.match(h, new RegExp(`<tr class='r s-PROBLEM o-${beklenen} d-sorunlu'><td class='host'>A</td>`));
  assert.match(h, /Nginx: kapatılamadı ✗/);
});

test('RR16 inceleme F1/F3: Sorunsuz / Kontrol gerekli / Sorun kaldi filtreleri SON DURUM\'a bagli (pill + kutu + ekran ile ayni); sonuc gelmeyen sunucu "dokunmadi" degil', () => {
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||'];
  const ayni = ['BOOT|b1||', 'SURUM|2||', 'URUN|NGINX||'];
  const k = {
    id: 3, hosts: ['A', 'G'], olusturan: 'x',
    once: { sonuc: { sunucular: { A: { goruntu_ok: true, goruntu: once }, G: { goruntu_ok: true, goruntu: once } } } },
    // A: boot kimligi degismemis (rapor WARNING) ama sonraDegerlendir 'sorunsuz'; G: sonuc gelmedi
    sonra: { sonuc: { sunucular: { A: { once_var: true, son_olculdu: true, betik_surum: 3, goruntu: ayni, son_goruntu: ayni, islemler: [] }, G: { sonuc_yok: true } } } },
  };
  const h = raporHtml(k);
  assert.match(h, /<tr class='r s-WARNING o-dokunmadi d-sorunsuz'><td class='host'>A<\/td>.*Sorunsuz<\/span><\/td><\/tr>/);
  assert.match(h, /#f-uyari:checked ~ table\.fl tr\.r:not\(\.d-kontrol\)\{display:none\}/);
  assert.match(h, /#f-kritik:checked ~ table\.fl tr\.r:not\(\.d-sorunlu\)\{display:none\}/);
  assert.match(h, /#f-sorunsuz:checked ~ table\.fl tr\.r:not\(\.d-sorunsuz\)\{display:none\}/);
  assert.doesNotMatch(h, /:not\(\.s-(WARNING|PROBLEM)\)/, '"Kontrol gerekli" / "Sorun kaldi" rapor bulgu sinifina bagli kaldi');
  // G: olculemedi -> Sorun kaldi grubu; otomasyon basarisiz (dogrulanamadi), nedeni yazili
  assert.match(h, /<tr class='r s-PROBLEM o-basarisiz d-sorunlu'><td class='host'>G<\/td><td><span class='pill problem'[^>]*>Otomasyon başarısız<\/span><\/td><td class='minor'><span style='color:#a12631'>sunucudan sonuç gelmedi — otomasyonun ne yaptığı bilinmiyor/);
  const kutu = (ad) => Number((new RegExp(`>(\\d+)</span><span[^>]*>${ad}<`).exec(h) || [])[1]);
  assert.deepEqual([kutu('Otomasyon dokunmadı'), kutu('Otomasyon başarısız'), kutu('Kontrol gerekli'), kutu('Sorunsuz')], [1, 1, 0, 1]);
});
