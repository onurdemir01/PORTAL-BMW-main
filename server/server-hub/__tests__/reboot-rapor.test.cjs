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
  const d = sunucuDegerlendir(ONCE, { once_var: true, son_olculdu: true, betik_surum: 4, goruntu: ['BOOT|b2||', ...ONCE.slice(1)], son_goruntu: ['BOOT|b2||', ...ONCE.slice(1)] });
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
      GBX01: { once_var: true, betik_surum: 4, son_olculdu: true, goruntu: ['BOOT|b2||', ...ONCE.slice(1)], son_goruntu: ['BOOT|b2||', ...ONCE.slice(1)], islemler: [] },
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
  // v4 ("Her yerde kapat"): bos once JBoss'u korumaz -> hala calisan JBoss 8 KRITIK (NEW_URUN_KALAN), "dokunulmadi" uyarisi degil
  const bos = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'] });
  assert.equal(bos.sonuc, 'PROBLEM');
  assert.ok(bos.bulgu.some((b) => b.durum === 'ONCE_BOS'));
  assert.ok(bos.bulgu.some((b) => b.durum === 'NEW_URUN_KALAN'), 'once bos iken hala calisan urun kritik sayilmadi');
  assert.ok(!bos.bulgu.some((b) => b.durum === 'NEW_URUN'), 'bos once kapisi urunu korudu (v4: korumaz)');
  // kapatildiysa: uyari (KAPATILDI_URUN, kontrol edilecek), kritik degil
  const kap = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, betik_surum: 4, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|b2||'], islemler: ['SONUC|durdur|JBOSS8||OK|x'] });
  assert.equal(kap.sonuc, 'WARNING');
  assert.deepEqual(kap.bulgu.map((b) => b.durum).sort(), ['KAPATILDI_URUN', 'ONCE_BOS']);
  const jvmli = sunucuDegerlendir(['BOOT|b1||', 'JVM|JBOSS8|appA|x'], { son_olculdu: true, betik_surum: 4, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'] });
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
  const d = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 4, goruntu: son, son_goruntu: son });
  assert.deepEqual(d.bulgu.map((b) => b.durum), ['ESKI_SURUM']);
  assert.equal(d.sonuc, 'WARNING');
  const eskiSon = ['BOOT|b2||', ...once.slice(1)];
  const ayni = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 4, goruntu: eskiSon, son_goruntu: eskiSon });
  assert.equal(ayni.sonuc, 'OK', 'iki taraf da eski surumken ESKI_SURUM denildi');
});

test('RR11 eski surum once: cevrilen JBoss JVM\'leri GERCEKTEN karsilastirilir (2026-11-15 gece kosusu: kapali JVM gozden kaciyordu)', () => {
  const once = ['BOOT|b1||', 'URUN|JBOSS7||', 'JVM|JBOSS7|app1|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS7|app2|jboss_home=/usr/jboss/AppServer'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS7||', 'JVM|JBOSS7|app1|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS7|yeni|jboss_home=/usr/jboss/AppServer'];
  const d = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 4, goruntu: son, son_goruntu: son, islemler: [] });
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
      A1: { once_var: true, betik_surum: 4, son_olculdu: true, goruntu: ['BOOT|b2||', 'SURUM|2||'], son_goruntu: son, islemler: ['SONUC|baslat|NGINX||OK|ok'] },
      B2: { once_var: true, betik_surum: 4, son_olculdu: true, goruntu: son, son_goruntu: son, islemler: ['SONUC|baslat|NGINX||SKIP|zaten'] },
      C3: { once_var: true, betik_surum: 4, son_olculdu: true, goruntu: ['BOOT|b2||', 'SURUM|2||'], son_goruntu: ['BOOT|b2||', 'SURUM|2||'], islemler: ['SONUC|baslat|NGINX||FAIL|hata'] },
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
  assert.match(h, /<div class='filtre'><label for='f-tum'>Tümü<\/label><label for='f-obasarili'>Otomasyon başarılı<\/label><label for='f-obasarisiz'>Otomasyon başarısız<\/label><label for='f-dokunmadi'>Otomasyon dokunmadı<\/label><label for='f-sorunsuz'>Sorunsuz<\/label><label for='f-kritik'>Sorun kaldı \/ ölçülemedi<\/label><label for='f-uyari'>Kontrol gerekli<\/label><label for='f-kapsamdisi'>Karşılaştırma dışı<\/label><label for='f-bilgi'>Bilgi<\/label><\/div>/);
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
  // kapi (v4, "Her yerde kapat"): bos once -> HER urun (RHA/IHS/CTG/WAS) KAPATILIR, hala calisiyorsa kritik
  const bos = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, betik_surum: 4, goruntu: son, son_goruntu: son });
  assert.equal(bos.sonuc, 'PROBLEM');
  const bosBy = Object.fromEntries(bos.bulgu.map((b) => [b.servis, b.durum]));
  assert.deepEqual([bosBy['Apache HTTP Server'], bosBy['IBM HTTP Server (IHS)'], bosBy.CTG, bosBy.WebSphere], ['NEW_URUN_KALAN', 'NEW_URUN_KALAN', 'NEW_URUN_KALAN', 'NEW_URUN_KALAN']);
  const bosDis = ['BOOT|b2||', 'SURUM|2||', 'URUN|CTG||', 'URUN|WAS||'];
  const bos2 = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, betik_surum: 4, goruntu: bosDis, son_goruntu: bosDis });
  assert.equal(bos2.sonuc, 'PROBLEM');
  assert.ok(!bos2.bulgu.some((b) => b.durum === 'NEW_URUN'), 'bos once CTG/WAS korundu (v4: korumaz)');
  // kapatilan CTG/WAS: uyari (kontrol edilecek), kritik degil
  const bos3 = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, betik_surum: 4, goruntu: bosDis, son_goruntu: ['BOOT|b2||', 'SURUM|2||'], islemler: ['SONUC|durdur|CTG||OK|x', 'SONUC|durdur|WAS||OK|x'] });
  assert.equal(bos3.sonuc, 'WARNING');
  assert.ok(!bos3.bulgu.some((b) => b.durum === 'NEW_URUN_KALAN'));
  assert.deepEqual(bos3.bulgu.filter((b) => b.durum === 'KAPATILDI_URUN').map((b) => b.servis).sort(), ['CTG', 'WebSphere']);
  const eskiOnce = ['BOOT|b1||', 'URUN|JBOSS7||', 'URUN|NGINX||'];
  const s2 = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'URUN|NGINX||'];
  const bel = sunucuDegerlendir(eskiOnce, { son_olculdu: true, betik_surum: 4, goruntu: s2, son_goruntu: s2 });
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
  const d = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 4, goruntu: ilk, son_goruntu: son, islemler: ['SONUC|durdur|NGINX||OK|x'] });
  assert.deepEqual(d.bulgu.map((b) => b.durum), ['KAPATILDI_URUN']);
  assert.equal(d.sonuc, 'WARNING', 'otomasyonun kapattigi urun bilgi (normal) sayildi');
  const h0 = raporHtml({ id: 1, hosts: ['A'], once: { sonuc: { sunucular: { A: { goruntu_ok: true, goruntu: once } } } }, sonra: { sonuc: { sunucular: { A: { once_var: true, son_olculdu: true, betik_surum: 4, goruntu: ilk, son_goruntu: son, islemler: ['SONUC|durdur|NGINX||OK|x'] } } } } });
  assert.match(h0, /Otomatik kapatıldı — kontrol edilecek/);
  // eski betik (v4): surum yok / 2 / 3 -> uyari bulgusu; 4 -> yok
  for (const [surum, var_] of [[undefined, true], [2, true], ['3', true], [3, true], ['4', false], [4, false]]) {
    const x = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: surum, goruntu: son, son_goruntu: son });
    assert.equal(x.bulgu.some((b) => b.durum === 'BETIK_ESKI'), var_, `betik_surum=${surum}`);
  }
  assert.match(sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 2, goruntu: son, son_goruntu: son }).bulgu[0].aciklama, /\(sürüm 2, gerekli 4\): bu koşuda ürün kapatma ve yeniden deneme YOKTU/);
  // inceleme B1: surum 3 betikte urun kapatma ve yeniden deneme VARDI; eksigi yalniz bos once'de CTG/JBoss/WAS
  const uc = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 3, goruntu: son, son_goruntu: son }).bulgu[0].aciklama;
  assert.match(uc, /\(sürüm 3, gerekli 4\): bu koşudaki betik \(sürüm 3\) ürün kapatıp yeniden deniyordu, ancak reboot öncesi görüntüsü boş sunucuda yalnız web ürünlerini \(Nginx\/Apache\/IHS\) kapatırdı, CTG\/JBoss\/WAS'a dokunmazdı; sürüm 4 reboot sonrası çalışan her ürünü kapatır\. ZIP'i AWX'e yükleyip/);
  assert.doesNotMatch(uc, /YOKTU/);
  // komutsuz kalan yeni urun: surum guncelken "eski betik" denmez
  const kal = sunucuDegerlendir(once, { son_olculdu: true, betik_surum: 4, goruntu: ilk, son_goruntu: ilk, islemler: [] });
  assert.doesNotMatch(kal.bulgu.find((b) => b.servis === 'Nginx').aciklama, /eski/);
  const kalEski = sunucuDegerlendir(once, { son_olculdu: true, goruntu: ilk, son_goruntu: ilk, islemler: [] });
  assert.match(kalEski.bulgu.find((b) => b.servis === 'Nginx').aciklama, /AWX'teki betik eski \(sürüm yok\)/);
  assert.doesNotMatch(kalEski.bulgu.find((b) => b.servis === 'Nginx').aciklama, /olabilir/);
  // ONCE_BOS metni v4: calisan her urun kapatilir; "yalniz web" / "hicbir sey acilip kapatilmadi" denmez
  const bos = sunucuDegerlendir(['BOOT|b1||'], { son_olculdu: true, betik_surum: 4, goruntu: ['BOOT|b2||'], son_goruntu: ['BOOT|b2||'] });
  assert.match(bos.bulgu[0].aciklama, /reboot sonrası çalışan her ürün \(Nginx\/Apache\/IHS\/CTG\/JBoss\/WAS\) reboot öncesi haline \(kapalı\) döndürülür, kapatılan ürün kontrol edilecek/);
  assert.doesNotMatch(bos.bulgu[0].aciklama, /yalnız web|dokunulmaz/);
  assert.doesNotMatch(bos.bulgu[0].aciklama, /hiçbir şey açılıp kapatılmadı/);
  // tek kaynak: raporun otomasyon sinifi reboot-check.cjs sonraDegerlendir ile ayni
  const { sonraDegerlendir } = require('../reboot-check.cjs');
  const sonraS = { A: { once_var: true, son_olculdu: true, betik_surum: 4, goruntu: ilk, son_goruntu: ilk, islemler: ['SONUC|durdur|NGINX||OK|x'] } };
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
    sonra: { sonuc: { sunucular: { A: { once_var: true, son_olculdu: true, betik_surum: 4, goruntu: ayni, son_goruntu: ayni, islemler: [] }, G: { sonuc_yok: true } } } },
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

// ---- v4 (2026-11-16): karsilastirma disi (notr), komut koprusu, Yonetici Ozeti ----
const kayitYap = (onceSat, sonraS) => ({
  id: 11, hosts: Object.keys(onceSat), olusturan: 'x',
  once: { sonuc: { sunucular: Object.fromEntries(Object.entries(onceSat).map(([h, g]) => [h, { goruntu_ok: true, goruntu: g }])) } },
  sonra: { sonuc: { sunucular: sonraS } },
});
const rr = (goruntu, sonGoruntu, islemler) => ({ once_var: true, son_olculdu: true, son_fark: [], betik_surum: 4, goruntu, son_goruntu: sonGoruntu, islemler, plan: [] });
const kutuSay = (h, ad) => Number((new RegExp(`>(\\d+)</span><span[^>]*>${ad}<`).exec(h) || [])[1]);

test('RR17 v4 once-bos UYARI DEGIL: notr "Karsilastirma disi" bulgu / sunucu sonucu / son durum / filtre; uyarili kutusuna girmez', () => {
  const temiz = sunucuDegerlendir(['BOOT|b1||'], rr(['BOOT|b2||'], ['BOOT|b2||'], []));
  assert.equal(temiz.sonuc, 'KAPSAM_DISI');
  assert.deepEqual(temiz.bulgu.map((b) => b.durum), ['ONCE_BOS']);
  assert.match(temiz.bulgu[0].aciklama, /karşılaştırılacak bir şey yoktu\. Bu bir uyarı değildir/);
  // baska bulgu varsa o kazanir: web urunu kapatildi -> WARNING; kendiliginden kapanan (bilgi) -> INFO
  assert.equal(sunucuDegerlendir(['BOOT|b1||'], rr(['BOOT|b2||', 'URUN|NGINX||'], ['BOOT|b2||'], ['SONUC|durdur|NGINX||OK|x'])).sonuc, 'WARNING');
  assert.equal(sunucuDegerlendir(['BOOT|b1||'], rr(['BOOT|b2||', 'URUN|NGINX||'], ['BOOT|b2||'], [])).sonuc, 'INFO');
  const onceR = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const v = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||'];
  const h = raporHtml(kayitYap({ C: ['BOOT|b1||'], N: onceR, W: onceR }, {
    C: rr(['BOOT|b2||'], ['BOOT|b2||'], []),
    N: rr(v, v, []),
    W: rr([...v, 'URUN|NGINX||'], v, ['SONUC|durdur|NGINX||OK|x']),
  }));
  assert.deepEqual(['Kritik sunucu', 'Uyarılı sunucu', 'Bilgili sunucu', 'Karşılaştırma dışı', 'Normal sunucu'].map((a) => kutuSay(h, a)), [0, 1, 0, 1, 1]);
  assert.match(h, /<tr class='r s-KAPSAM_DISI o-dokunmadi d-kapsam_disi'><td class='host'>C<\/td>.*<span class='pill neutral' style='background:#f1f3f6;color:#475467[^>]*>Karşılaştırma dışı<\/span><\/td><\/tr>/);
  assert.match(h, /<span class='pill neutral'[^>]*>Karşılaştırma dışı \(önce çalışan uygulama yoktu\)<\/span>/);
  assert.doesNotMatch(h, /Önce görüntüsü boş<\/span>/, 'eski uyari etiketi kaldi');
  assert.match(h, /#f-kapsamdisi:checked ~ table\.fl tr\.r:not\(\.d-kapsam_disi\)\{display:none\}/);
  // Otomasyon Ozeti son durum satirinda ayri kutu
  assert.equal((h.match(/>1<\/span><span[^>]*>Karşılaştırma dışı</g) || []).length, 2);
  // yalniz kapsam disi: baslik uyari demez
  const yalniz = raporHtml(kayitYap({ C: ['BOOT|b1||'] }, { C: rr(['BOOT|b2||'], ['BOOT|b2||'], []) }));
  assert.match(yalniz, /Kritik sorun ve uyarı yok; 1 sunucu karşılaştırma dışı \(reboot öncesi çalışan uygulama yoktu\)\./);
  assert.doesNotMatch(yalniz, /sunucuda uyarı var/);
});

test('RR18 v4 sayi koprusu: Otomatik Duzeltme "N komut · M sunucu" + OK-ama-hedefte-degil; Otomasyon Ozeti ayni sayilari soyler', () => {
  const onceR = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const v = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||'];
  const h = raporHtml(kayitYap({ A: onceR, F: onceR }, {
    // A: NGINX fazladan, kapatildi (OK, hedefte) + bir SKIP; F: kapatma OK dondu ama NGINX hala calisiyor
    A: rr([...v, 'URUN|NGINX||'], v, ['SONUC|durdur|NGINX||OK|x', 'SONUC|baslat|RHA||SKIP|zaten']),
    F: rr([...v, 'URUN|NGINX||'], [...v, 'URUN|NGINX||'], ['SONUC|durdur|NGINX||OK|x']),
  }));
  assert.equal(kutuSay(h, 'Otomasyon başarılı'), 1);
  assert.equal(kutuSay(h, 'Otomasyon başarısız'), 1);
  assert.match(h, /<h2>Otomatik Düzeltme <span class='muted'>\(3 komut · 2 sunucu\)<\/span><\/h2>/);
  assert.match(h, /Başarılı komut: <b>2<\/b> &nbsp;·&nbsp; Başarısız komut: <b>0<\/b> &nbsp;·&nbsp; Gerek kalmadı \(komut çalışmadı\): <b>1<\/b>/);
  assert.match(h, /Yukarıdaki Otomasyon Özeti <b>sunucu<\/b> sayar: bir sunucuda birden çok komut olabilir; "gerek kalmadı" satırları otomasyonun dokunduğu sayılmaz; komutu başarılı dönüp son kontrolde hedefte olmayan öğe sunucuyu "otomasyon başarısız" yapar\. Komut OK ama son kontrolde hedefte değil: <b>1<\/b>; komut OK ama son durum ölçülemedi \(doğrulanamadı\): <b>0<\/b>\./);
  assert.match(h, /<b>Komut bazında<\/b> \(aşağıda Otomatik Düzeltme\): başarılı <b>2<\/b> · başarısız <b>0<\/b> · gerek kalmadı <b>1<\/b>\..*hedefte olmayan: <b>1<\/b>; son durumu ölçülemediği için doğrulanamayan: <b>0<\/b>\./);
  // kopru Otomasyon Ozeti'nin altinda, Otomatik Duzeltme'den once
  assert.ok(h.indexOf('<b>Komut bazında</b>') > h.indexOf('<h2>Otomasyon Özeti') && h.indexOf('<b>Komut bazında</b>') < h.indexOf('<h2>Otomatik Düzeltme'));
});

test('RR19 v4 Yonetici Ozeti raporun EN USTUNDE; sayilar reboot-check.cjs yoneticiOzeti ile ayni (tek kaynak); payda yaninda, 0 -> "—"', () => {
  const { yoneticiOzeti, onceGirdisi, sonraDegerlendir } = require('../reboot-check.cjs');
  const onceR = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const v = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||'];
  const k = kayitYap({ A: onceR, B: onceR, C: ['BOOT|b1||'] }, {
    A: rr(['BOOT|b2||', 'SURUM|2||'], v, ['SONUC|baslat|RHA||OK|x']),
    B: rr([...v, 'URUN|IHS||'], [...v, 'URUN|IHS||'], ['SONUC|durdur|IHS||FAIL|x']),
    C: rr(['BOOT|b2||'], ['BOOT|b2||'], []),
  });
  const h = raporHtml(k);
  const onceSat = onceGirdisi(k.once.sonuc.sunucular);
  const y = yoneticiOzeti(k.sonra.sonuc.sunucular, k.hosts, onceSat, sonraDegerlendir(k.sonra.sonuc.sunucular, k.hosts, onceSat));
  assert.deepEqual([y.oran.birakildi.metin, y.oran.donus.metin, y.oran.otomasyon.metin, y.oran.kapanan.metin], ['%50', '%66,7', '%50', '%50']);
  const ust = h.indexOf('<h2 style=\'margin-top:18px\'>Yönetici Özeti</h2>');
  assert.ok(ust > 0 && ust < h.indexOf('sunucuda kritik durum') && ust < h.indexOf('<h2>Otomasyon Özeti') && ust < h.indexOf('<h2>Bulgular'), 'yonetici ozeti en ustte degil');
  // ana metrik buyuk (34px), payda yaninda; tabular-nums
  // inceleme Y7: ana metrigin altinda kontrol notlu / kontrol bekleyen / sorun kalan
  assert.match(h, /font-size:34px;font-weight:bold;color:#202938;font-variant-numeric:tabular-nums'>%50<\/span><span[^>]*>1 \/ 2 sunucu<\/span><span[^>]*>Bulunduğu gibi bırakıldı<\/span><span class='ana-ek'[^>]*>kontrol notlu 0 · kontrol bekleyen 0 · sorun kalan 1<\/span><\/td>/);
  // Y7 yeni tanim: otomasyonun fazladan IHS'i kapatip fark birakmadigi sunucu (kontrol notlu) BIRAKILAN sayilir
  const k7 = kayitYap({ A: onceR, B: onceR, E: onceR }, {
    A: rr(['BOOT|b2||', 'SURUM|2||'], v, ['SONUC|baslat|RHA||OK|x']),
    B: rr([...v, 'URUN|IHS||'], [...v, 'URUN|IHS||'], ['SONUC|durdur|IHS||FAIL|x']),
    E: rr([...v, 'URUN|IHS||'], v, ['SONUC|durdur|IHS||OK|x']),
  });
  const h7 = raporHtml(k7);
  assert.match(h7, /font-size:34px;font-weight:bold;color:#202938;font-variant-numeric:tabular-nums'>%66,7<\/span><span[^>]*>2 \/ 3 sunucu<\/span><span[^>]*>Bulunduğu gibi bırakıldı<\/span><span class='ana-ek'[^>]*>kontrol notlu 1 · kontrol bekleyen 0 · sorun kalan 1<\/span><\/td>/);
  assert.match(h7, /Karşılaştırılabilen <b>3<\/b> sunucudan bulunduğu gibi bırakılan <b>2<\/b> \(sorunsuz <b>1<\/b>, kontrol notlu <b>1<\/b>\), kontrol bekleyen <b>0<\/b>, sorun kalan <b>1<\/b>;/);
  assert.match(h7, /tek kontrol notu otomasyonun fazladan çalışan ürünü kapatması olan \(eski haline döndürülmüş\) sunucu da bırakılmış sayılır \(kontrol notu ayrıca yazılır\)\. Kontrol bekleyen \(başka bir kontrol notu olan: korunan öğe, eski betik vb\.\) bırakılmış sayılmaz ama bırakıldı oranının paydasındadır; bırakılan \+ kontrol bekleyen \+ sorun kalan = karşılaştırılabilen\./);
  // inceleme B5: notta eski (paydayla celisen) "ne basari ne basarisizlik" cumlesi kalmadi
  assert.doesNotMatch(h7, /ne başarı ne başarısızlık/);
  assert.match(h7, /2 tanesi reboot öncesi haliyle bırakıldı \(%66,7\) \(bunlardan 1 tanesinde otomasyon fazladan çalışan ürünü kapattı; kontrol notu var\); 1 sunucuda sorun kaldı\./);
  assert.match(h, />%66,7<\/span><span[^>]*>2 \/ 3 öğe<\/span><span[^>]*>Reboot öncesi hale dönüş<\/span><\/td>/);
  // inceleme Y10: otomasyon oraninin birimi komut; "Ilk sapmalardan kapatilan"
  assert.match(h, />%50<\/span><span[^>]*>1 \/ 2 komut<\/span><span[^>]*>Otomasyon başarı oranı</);
  assert.match(h, />%50<\/span><span[^>]*>1 \/ 2 öğe<\/span><span[^>]*>İlk sapmalardan kapatılan</);
  assert.match(h, /Kapsam: toplam <b>3<\/b> sunucu · son durumu ölçülen <b>3<\/b> · karşılaştırma dışı \(önce boş\) <b>1<\/b> · ölçülemeyen <b>0<\/b>/);
  assert.ok(h.includes(y.metin), 'paragraf yoneticiOzeti metni degil');
  // payda 0 -> '—' ve "0 / 0"
  const bos = raporHtml(kayitYap({ C: ['BOOT|b1||'] }, { C: rr(['BOOT|b2||'], ['BOOT|b2||'], []) }));
  assert.match(bos, /font-size:34px[^>]*>—<\/span><span[^>]*>0 \/ 0 sunucu<\/span>/);
  // yalniz once kaydi: yonetici ozeti yok
  assert.doesNotMatch(raporHtml({ id: 1, hosts: ['A'], once: { sonuc: { sunucular: { A: { goruntu_ok: true, goruntu: onceR } } } }, sonra: {} }), /Yönetici Özeti/);
});

test('RR20 v4 inceleme Y2/Y5/Y6/Y11: urunle kalkan JVM otomatik; karsilastirma disi kutusu tek kaynak; sorun kaldi / olculemedi ayri; once-bos etiketi', () => {
  // Y2: urun baslat OK, JVM komutsuz / SKIP kalkti -> "Otomatik acildi" (urunle birlikte); JVM'in kendi komutu FAIL ise KOMUT_HATALI_ACILDI kalir
  const onceJ = ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|j1|x', 'JVM|JBOSS8|j2|x'];
  const sonJ = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|j1|x', 'JVM|JBOSS8|j2|x'];
  const d = sunucuDegerlendir(onceJ, rr(['BOOT|b2||', 'SURUM|2||'], sonJ, ['SONUC|baslat|JBOSS8||OK|x', 'SONUC|baslat|JBOSS8|j2|FAIL|x']));
  const by = Object.fromEntries(d.bulgu.map((b) => [b.servis, b]));
  assert.equal(by['JBoss 8 JVM — j1'].durum, 'DUZELTILDI');
  assert.match(by['JBoss 8 JVM — j1'].aciklama, /ürünü otomatik açılınca onunla birlikte kalktı/);
  assert.equal(by['JBoss 8 JVM — j2'].durum, 'KOMUT_HATALI_ACILDI');
  const kendi = sunucuDegerlendir(onceJ, rr(['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||'], sonJ, []));
  assert.equal(kendi.bulgu.find((b) => b.servis === 'JBoss 8 JVM — j1').durum, 'KENDILIGINDEN_ACILDI');
  // Y5: once-bos, NGINX ilkte calisiyor sonra kendiliginden kapandi (bilgi bulgusu) -> son durum kapsam_disi; Ayrinti kutusu da
  const kd = raporHtml(kayitYap({ C: ['BOOT|b1||'] }, { C: rr(['BOOT|b2||', 'URUN|NGINX||'], ['BOOT|b2||'], []) }));
  assert.deepEqual(['Bilgili sunucu', 'Karşılaştırma dışı'].map((a) => kutuSay(kd, a)), [0, 1]);
  assert.equal((kd.match(/>1<\/span><span[^>]*>Karşılaştırma dışı</g) || []).length, 2, 'iki kutu ayni sayiyi gostermiyor');
  assert.match(kd, /Kritik sorun ve uyarı yok; 1 sunucu karşılaştırma dışı/);
  assert.match(kd, /<tr class='r s-KAPSAM_DISI o-dokunmadi d-kapsam_disi'><td class='host'>C<\/td>/);
  // Y11: once-bos ama otomasyon web urununu kapatti (kontrol) -> bulgu "Karsilastirma disi" denmez
  const kt = raporHtml(kayitYap({ W: ['BOOT|b1||'] }, { W: rr(['BOOT|b2||', 'URUN|NGINX||'], ['BOOT|b2||'], ['SONUC|durdur|NGINX||OK|x']) }));
  assert.match(kt, /<span class='pill neutral'[^>]*>Önce görüntüsü boş \(bilgi\)<\/span>/);
  assert.doesNotMatch(kt, />Karşılaştırma dışı \(önce çalışan uygulama yoktu\)</);
  assert.equal(kutuSay(kt, 'Karşılaştırma dışı'), 0);
  // Y6: "Sorun kaldi" yalniz sorunlu; olculemeyen ayri kutu (paragrafla ayni tanim)
  const onceR = ['BOOT|b1||', 'SURUM|2||', 'URUN|RHA||'];
  const v = ['BOOT|b2||', 'SURUM|2||', 'URUN|RHA||'];
  const s6 = raporHtml(kayitYap({ B: onceR, D: onceR }, { B: rr([...v, 'URUN|IHS||'], [...v, 'URUN|IHS||'], ['SONUC|durdur|IHS||FAIL|x']), D: { sonuc_yok: true } }));
  assert.deepEqual(['Sorun kaldı', 'Ölçülemedi'].map((a) => kutuSay(s6, a)), [1, 1]);
  assert.match(s6, /1 sunucuda sorun kaldı/);
  assert.match(s6, /<tr class='r s-PROBLEM o-basarisiz d-sorunlu'><td class='host'>D<\/td>/, 'olculemeyen satir "Sorun kaldi / olculemedi" filtresinde degil');
  // Y3: komut OK ama son goruntu alinamadi -> "hedefte degil" DEGIL, "dogrulanamadi" (iki kopruda da), otomasyon orani disinda
  const u = raporHtml(kayitYap({ A: onceR, U: onceR }, {
    A: rr(['BOOT|b2||', 'SURUM|2||'], v, ['SONUC|baslat|RHA||OK|x']),
    U: { ...rr(['BOOT|b2||', 'SURUM|2||'], [], ['SONUC|baslat|RHA||OK|x']), son_olculdu: false },
  }));
  assert.match(u, /Komut OK ama son kontrolde hedefte değil: <b>0<\/b>; komut OK ama son durum ölçülemedi \(doğrulanamadı\): <b>1<\/b>\./);
  assert.match(u, /hedefte olmayan: <b>0<\/b>; son durumu ölçülemediği için doğrulanamayan: <b>1<\/b>\./);
  assert.match(u, />%100<\/span><span[^>]*>1 \/ 1 komut<\/span><span[^>]*>Otomasyon başarı oranı</);
  assert.match(u, /ölçülemeyen sunucularda sonucu doğrulanamayan komut <b>1<\/b>/);
});
