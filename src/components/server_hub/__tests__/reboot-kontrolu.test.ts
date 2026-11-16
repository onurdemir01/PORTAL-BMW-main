// src/components/server_hub/__tests__/reboot-kontrolu.test.ts — RK1..RK4 (2026-10-08).
import { describe, expect, test } from 'vitest';
import { BETIK_SURUM_GEREKLI, BOS_KORUNAN, DURUM, SONRA_ACIK, betikEskiBandi, betikEskiMetni, betikEtkisi, betikSurumu, eskiSurumNedeni, onceTamamGoruntu, bilgiAyristir, goruntuAyristir, islemAyristir, kapatmaKorunan, nedenListesi, nesilKarsilastirilamaz, onceBos, onceNesilCevir, onceOzeti, rebootOldu, sunucuListesi, urunTablosu } from '../rebootKontrolu';

const ONCE = ['BOOT|b1||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'URUN|WAS||', 'JVM|JBOSS8|appA|jboss_home=/usr/jboss8/AppServer', 'JVM|JBOSS8|appB|x', 'JVM|WAS|srv1|profil=p'];
const ILK = ['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|IHS||', 'JVM|JBOSS8|appB|x', 'JVM|JBOSS8|appC|x'];
const SON = ['BOOT|b2||', 'URUN|NGINX||', 'URUN|JBOSS8||', 'URUN|IHS||', 'JVM|JBOSS8|appA|x', 'JVM|JBOSS8|appB|x', 'JVM|JBOSS8|appC|x'];

describe('Reboot Kontrolü satırları', () => {
  test('RK1 görüntü: ürünler, JVM\'ler, boot; BOOT yoksa eski biçim', () => {
    const g = goruntuAyristir(ONCE);
    expect([...g.urunler]).toEqual(['NGINX', 'JBOSS8', 'WAS']);
    expect([...(g.jvmler.get('JBOSS8') || [])]).toEqual(['appA', 'appB']);
    expect(g.boot).toBe('b1');
    expect(g.bicimTamam).toBe(true);
    expect(goruntuAyristir(['JBOSS8_JVM|appA|1|1|was|d']).bicimTamam).toBe(false);
    expect(goruntuAyristir('x').urunler.size).toBe(0);
    expect(onceOzeti(g)).toEqual([{ urun: 'NGINX', ad: 'Nginx', jvm: null }, { urun: 'JBOSS8', ad: 'JBoss 8', jvm: 2 }, { urun: 'WAS', ad: 'WebSphere (WAS)', jvm: 1 }]);
  });

  test('RK2 ürün tablosu: açılan ürün ok, hâlâ kapalı sorun, kapatılmamış yeni ürün sorun (2026-11-15); JVM değişimleri', () => {
    const isl = islemAyristir(['SONUC|baslat|NGINX||OK|startNginx.sh', 'SONUC|baslat|JBOSS8|appA|OK|start', 'SONUC|durdur|JBOSS8|appC|FAIL|hata', 'SONUC|baslat|WAS||FAIL|yok']);
    const t = urunTablosu(goruntuAyristir(ONCE), goruntuAyristir(ILK), goruntuAyristir(SON), isl);
    const by = Object.fromEntries(t.map((u) => [u.urun, u]));
    expect(t.map((u) => u.urun)).toEqual(['NGINX', 'IHS', 'JBOSS8', 'WAS']);
    expect([by.NGINX.durum, by.NGINX.metin, by.NGINX.islem?.sonuc]).toEqual(['ok', 'reboot sonrası kapalıydı, açıldı', 'OK']);
    expect(by.IHS.durum).toBe('sorun');
    expect([by.WAS.durum, by.WAS.metin]).toEqual(['sorun', 'çalışıyordu, hâlâ KAPALI']);
    expect(by.JBOSS8.jvmAyni).toBe(1);
    expect(by.JBOSS8.jvmDegisim.map((j) => [j.ad, j.durum, j.metin])).toEqual([
      ['appA', 'ok', 'kapalıydı, açıldı'], ['appC', 'sorun', 'önce çalışmıyordu, hâlâ ÇALIŞIYOR'],
    ]);
    expect(by.WAS.jvmDegisim.map((j) => [j.ad, j.durum])).toEqual([['srv1', 'sorun']]);
    const yeni = urunTablosu(goruntuAyristir(['BOOT|a||']), goruntuAyristir(['BOOT|b||', 'URUN|JBOSS7||', 'JVM|JBOSS7|z|x']), goruntuAyristir(['BOOT|b||', 'URUN|JBOSS7||', 'JVM|JBOSS7|z|x']), []);
    // Kapının korumadığı ürünün hâlâ çalışan JVM'i 'sorun' (sunucu kontrol / rapor uyarı ile aynı yön; inceleme R2 #3).
    expect(yeni[0].jvmDegisim.map((j) => [j.ad, j.durum])).toEqual([['z', 'sorun']]);
    expect(by.IHS.metin).toBe('reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — otomasyon kapatmadı (eski betik sürümü olabilir; güncel betikle yeniden çalıştırın)');
  });

  test('RK3 son ölçülemediyse önce çalışan her şey sorun; reboot doğrulaması boot id ile', () => {
    const t = urunTablosu(goruntuAyristir(ONCE), goruntuAyristir(ILK), null, []);
    expect(t.filter((u) => u.durum === 'ok')).toEqual([]);
    expect(rebootOldu(goruntuAyristir(ONCE), goruntuAyristir(ILK))).toBe(true);
    expect(rebootOldu(goruntuAyristir(ONCE), goruntuAyristir(ONCE))).toBe(false);
    expect(rebootOldu(goruntuAyristir(['BOOT|bilinmiyor||']), goruntuAyristir(ILK))).toBe(null);
  });

  test('RK4 işlem/bilgi ayrışır; bilinmeyen sonuç "?"; sunucu listesi', () => {
    expect(islemAyristir(['SONUC|baslat|JBOSS8|appA|OK|/host=h/server-config=appA:start|x'])[0]).toEqual({ islem: 'baslat', urun: 'JBOSS8', ad: 'appA', sonuc: 'OK', mesaj: '/host=h/server-config=appA:start|x' });
    expect(islemAyristir(['SONUC|baslat|X|y|UYDURMA|m'])[0].sonuc).toBe('?');
    expect(bilgiAyristir(['BILGI|HATA|||eski bicim'])[0]).toEqual({ tur: 'HATA', urun: '', ad: '', mesaj: 'eski bicim' });
    expect(sunucuListesi('gbjbop18, GBJBOP18\nGBJBOAP18;  x1 ')).toEqual(['GBJBOP18', 'GBJBOAP18', 'X1']);
  });
});

describe('Reboot Kontrolü 2026-11-14 (ilk gerçek koşu: "dokunulmadı")', () => {
  test('RK5 "dokunulmadı" etiketleri (yalnız kapatma kapısında: BOOT\'suz / eski sürüm önce) SON durumu söyler; JVM etiketi nedenini yazar', () => {
    const once = goruntuAyristir(['BOOT|a||']);
    const ilk = goruntuAyristir(['BOOT|b||', 'URUN|IHS||', 'URUN|CTG||', 'URUN|JBOSS7||', 'JVM|JBOSS7|z|x', 'JVM|JBOSS7|y|x']);
    const son = goruntuAyristir(['BOOT|b||', 'URUN|JBOSS7||', 'JVM|JBOSS7|z|x']);
    // v4 ("Her yerde kapat"): boş önce HİÇBİR ürünü korumaz — "dokunulmadı" denmez; hâlâ çalışan JBoss 7 ve JVM'i sorun
    const bosKor = kapatmaKorunan(['BOOT|a||']);
    expect(bosKor.size).toBe(0);
    const tb = urunTablosu(once, ilk, son, [], new Set(), bosKor);
    const bb = Object.fromEntries(tb.map((u) => [u.urun, u]));
    expect([bb.CTG.durum, bb.CTG.metin]).toEqual(['ok', 'reboot öncesi çalışmıyordu, kendiliğinden kapandı']);
    expect([bb.IHS.durum, bb.IHS.metin]).toEqual(['ok', 'reboot öncesi çalışmıyordu, kendiliğinden kapandı']);
    expect(bb.JBOSS7.durum).toBe('sorun');
    expect(bb.JBOSS7.jvmDegisim.map((j) => [j.ad, j.durum, j.metin])).toEqual([
      ['y', 'ok', 'ürün reboot öncesi çalışmıyordu — şu an KAPALI'],
      ['z', 'sorun', 'şimdi çalışıyor — ürün reboot öncesi çalışmıyordu, ürünle birlikte kapanması gerekiyordu'],
    ]);
    expect(tb.some((u) => /dokunulmadı/.test(u.metin) || u.jvmDegisim.some((j) => /dokunulmadı/.test(j.metin)))).toBe(false);
    // kapı korursa (BOOT'suz önce: hepsi korunur) etiketler SON durumu ve nedeni söyler
    const kor = kapatmaKorunan(['URUN|RHA||']);
    const t = urunTablosu(once, ilk, son, [], new Set(), kor);
    const by = Object.fromEntries(t.map((u) => [u.urun, u]));
    expect([by.CTG.durum, by.CTG.metin]).toEqual(['bilgi', 'reboot öncesi çalışmıyordu, şu an KAPALI — dokunulmadı']);
    expect([by.IHS.durum, by.IHS.metin]).toEqual(['bilgi', 'reboot öncesi çalışmıyordu, şu an KAPALI — dokunulmadı']);
    expect(by.JBOSS7.metin).toBe('reboot öncesi çalışmıyordu, şimdi çalışıyor — önce görüntüsü eski sürüm / BOOT yok, kapatılmadı (dokunulmadı)');
    expect(by.JBOSS7.jvmDegisim.map((j) => [j.ad, j.metin])).toEqual([
      ['y', 'şu an KAPALI — ürün reboot öncesi görüntüde yoktu, dokunulmadı'],
      ['z', 'şimdi çalışıyor — ürün reboot öncesi görüntüde yoktu, kapatma kapısı gereği dokunulmadı'],
    ]);
    expect(urunTablosu(once, ilk, null, [], new Set(), kor).find((u) => u.urun === 'CTG')!.metin).toMatch(/son durum ölçülemedi, dokunulmadı/);
  });

  test('RK6 JVM satırı ürünün çalıştığını kanıtlar: ürün satırı olmayan ürün "dokunulmadı" sayılmaz, işaretlenir', () => {
    const once = goruntuAyristir(['BOOT|a||', 'JVM|JBOSS8|appA|x']);
    const son = goruntuAyristir(['BOOT|b||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x']);
    const t = urunTablosu(once, son, son, []);
    expect([t[0].urun, t[0].durum, t[0].metin, t[0].onceCikarim]).toEqual(['JBOSS8', 'ok', 'çalışıyordu, çalışıyor', true]);
    expect(t[0].jvmAyni).toBe(1);
    expect(onceOzeti(once)).toEqual([{ urun: 'JBOSS8', ad: 'JBoss 8', jvm: 1, urunSatiriYok: true }]);
    expect(onceOzeti(goruntuAyristir(['BOOT|a||', 'URUN|JBOSS8||']))[0].urunSatiriYok).toBeUndefined();
  });

  test('RK7 boş önce görüntüsü, neden listesi, kontrol durumu', () => {
    expect(onceBos(goruntuAyristir(['BOOT|a||']))).toBe(true);
    expect(onceBos(goruntuAyristir(['BOOT|a||', 'JVM|WAS|s|p']))).toBe(false);
    expect(onceBos(goruntuAyristir([]))).toBe(false);
    const n = nedenListesi([
      'ISLEM|was|baslat|JBOSS8||', 'BILGI|HATA|||eski', 'BILGI|BOS|||bos', 'BILGI|NEW|IHS||reboot oncesi calismiyordu, simdi calisiyor - dokunulmadi',
      'BILGI|NEW|JBOSS7|z|reboot oncesi JBOSS7 hic calismiyordu - JVMlerine dokunulmadi', 'BILGI|CIKARIM|JBOSS8||x',
    ]);
    expect(n).toHaveLength(4);
    expect(n[0]).toMatch(/izlenen ürün\/JVM yoktu — reboot sonrası çalışan her ürün \(Nginx\/Apache\/IHS\/CTG\/JBoss\/WAS\) reboot öncesi haline \(kapalı\) döndürülür ve kontrol edilecek/);
    expect(n[0]).not.toMatch(/yalnız web|dokunulmadı/);
    expect(n[0]).not.toMatch(/hiçbir şey açılıp kapatılmadı/);
    expect(n[1]).toMatch(/^IBM Apache \(IHS\): reboot öncesi çalışmıyordu/);
    expect(n[2]).toMatch(/^JBoss 7 \/ z: ürün reboot öncesi görüntüde yoktu/);
    expect(n[3]).toMatch(/^JBoss 8: önce görüntüsünde ürün satırı yoktu/);
    expect(DURUM.kontrol).toEqual({ etiket: 'Kontrol gerekli', ton: 'warning' });
    expect(SONRA_ACIK).toContain('kontrol');
  });
});

describe('Reboot Kontrolü — inceleme 2026-11-14 (etiket dürüstlüğü, SONUC-only JVM, eski sürüm)', () => {
  const g = goruntuAyristir;
  test('RK8 "açıldı"/"kapatıldı" yalnız komut OK ise; komutsuz "kendiliğinden", FAIL "komut başarısız"', () => {
    const once = g(['BOOT|b1||', 'URUN|JBOSS8||', 'URUN|NGINX||', 'JVM|JBOSS8|a1|x', 'JVM|JBOSS8|a2|x']);
    const ilk = g(['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|y1|x']);
    const son = g(['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|NGINX||', 'JVM|JBOSS8|a1|x', 'JVM|JBOSS8|a2|x']);
    const t = urunTablosu(once, ilk, son, islemAyristir(['SONUC|baslat|JBOSS8|a2|FAIL|zaman asimi']));
    const by = Object.fromEntries(t.map((u) => [u.urun, u]));
    expect(by.NGINX.metin).toBe('reboot sonrası kapalıydı, kendiliğinden kalktı');
    const j = Object.fromEntries(by.JBOSS8.jvmDegisim.map((x) => [x.ad, x.metin]));
    expect(j).toEqual({
      a1: 'kapalıydı, kendiliğinden kalktı',
      a2: 'kapalıydı — açma komutu başarısız döndü, sonra kalktı',
      y1: 'önce çalışmıyordu, kendiliğinden kapandı',
    });
  });

  test('RK9 yalnız SONUC satırında görülen JVM (durulmada açılıp kapatılan) tabloda görünür', () => {
    const once = g(['BOOT|b1||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x']);
    const ilk = g(['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x']);
    const t = urunTablosu(once, ilk, ilk, islemAyristir(['SONUC|durdur|JBOSS8|app2|OK|stop', 'SONUC|durdur|JBOSS8|app3|FAIL|x']));
    const j = t[0].jvmDegisim.map((x) => [x.ad, x.durum, x.metin, x.islem?.sonuc]);
    expect(t[0].jvmAyni).toBe(1);
    expect(j).toEqual([
      ['app2', 'ok', 'önce çalışmıyordu, durulma beklemesinde kalkmıştı — kapatıldı', 'OK'],
      ['app3', 'ok', 'önce çalışmıyordu — kapatma komutu başarısız döndü, sonra kapandı', 'FAIL'],
    ]);
  });

  test('RK10 eski sürüm önce görüntüsü: JBoss karşılaştırılmaz; ESKI notu; tekrar eden türler süzülür', () => {
    const once = ['BOOT|b1||', 'URUN|JBOSS7||', 'URUN|NGINX||', 'JVM|JBOSS7|app1|x'];
    const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'URUN|NGINX||', 'JVM|JBOSS8|app1|x'];
    expect(nesilKarsilastirilamaz(once, son)).toBe(true);
    expect(nesilKarsilastirilamaz(['SURUM|2||', ...once], son)).toBe(false);
    expect(nesilKarsilastirilamaz(once, once)).toBe(false);
    const t = urunTablosu(g(once), g(son), g(son), [], new Set(['JBOSS7', 'JBOSS8']));
    expect(t.map((u) => [u.urun, u.durum])).toEqual([['NGINX', 'ok']]);
    expect(nedenListesi(['BILGI|ESKI|||x', 'BILGI|BOS|||y'])[0]).toMatch(/eski betik sürümüyle/);
    expect(nedenListesi(['BILGI|ESKI|||x', 'BILGI|BOS|||y', 'BILGI|CIKARIM|JBOSS8||z'], ['BOS', 'ESKI'])).toHaveLength(1);
  });

  test('RK11 eski sürüm önce görüntüsü yeni kurala çevrilir (sunucu onceNesilCevir ile aynı): JVM farkı tabloda', () => {
    const once = ['BOOT|b1||', 'URUN|JBOSS7||', 'JVM|JBOSS7|app1|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS7|app2|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS7|v8|jboss_home=/vhosting8/jboss/AppServer'];
    const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS7||', 'URUN|JBOSS8||', 'JVM|JBOSS7|app1|jboss_home=/usr/jboss/AppServer', 'JVM|JBOSS8|v8|jboss_home=/vhosting8/jboss/AppServer'];
    const c = onceNesilCevir(once, son);
    expect(c.belirsiz).toEqual([]);
    expect(c.satirlar).toContain('JVM|JBOSS8|v8|jboss_home=/vhosting8/jboss/AppServer');
    const t = urunTablosu(g(c.satirlar), g(son), g(son), []);
    const jb7 = t.find((u) => u.urun === 'JBOSS7')!;
    expect(jb7.jvmDegisim.map((x) => [x.ad, x.durum])).toEqual([['app2', 'sorun']]);
    expect(t.find((u) => u.urun === 'JBOSS8')!.durum).toBe('ok');
    expect(onceNesilCevir(['BOOT|b1||', 'URUN|JBOSS7||'], ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||']).belirsiz).toEqual(['JBOSS7']);
    expect(nedenListesi(['BILGI|NESIL|||x', 'BILGI|BELIRSIZ|JBOSS7||y'])).toEqual([
      "Önce görüntüsü eski betik sürümüyle alınmış — JBoss satırları jboss_home ile yeni nesil kuralına çevrilerek karşılaştırıldı.",
      "JBoss 7: önce görüntüsü eski sürüm, ürün satırının nesli belirlenemedi (JBoss 8 olabilir) — dokunulmadı, elle kontrol edin.",
    ]);
  });
});

describe('Reboot Kontrolü 2026-11-15 ("nasıl bulduysan öyle bırak": önce çalışmayan ürün kapatılır)', () => {
  test('RK11 kapatılan ürün ok "kapatıldı", JVM "ürünle birlikte kapatıldı"; kapanmayan sorun; kapı korursa dokunulmadı', () => {
    const onceL = ['BOOT|a||', 'SURUM|2||', 'URUN|RHA||'];
    const ilk = goruntuAyristir(['BOOT|b||', 'URUN|RHA||', 'URUN|NGINX||', 'URUN|IHS||', 'URUN|CTG||', 'URUN|JBOSS8||', 'JVM|JBOSS8|j1|x']);
    const son = goruntuAyristir(['BOOT|b||', 'URUN|RHA||', 'URUN|IHS||', 'URUN|CTG||']);
    const isl = islemAyristir(['SONUC|durdur|NGINX||OK|x', 'SONUC|durdur|JBOSS8||OK|x', 'SONUC|durdur|IHS||FAIL|x', 'SONUC|durdur|CTG||OK|x']);
    const t = urunTablosu(goruntuAyristir(onceL), ilk, son, isl, new Set(), kapatmaKorunan(onceL));
    const by = Object.fromEntries(t.map((u) => [u.urun, u]));
    expect([by.RHA.durum, by.RHA.metin]).toEqual(['ok', 'çalışıyordu, çalışıyor']);
    // v3 B2: otomasyonun kapattığı ürün sarı (bilgi) + "kontrol edilecek"
    expect([by.NGINX.durum, by.NGINX.metin]).toEqual(['bilgi', 'reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyonla kapatıldı — kontrol edilecek']);
    expect([by.IHS.durum, by.IHS.metin]).toEqual(['sorun', 'reboot öncesi çalışmıyordu — kapatma komutu başarısız, hâlâ ÇALIŞIYOR']);
    expect([by.CTG.durum, by.CTG.metin]).toEqual(['sorun', 'reboot öncesi çalışmıyordu — kapatma komutu başarılı döndü ama hâlâ ÇALIŞIYOR']);
    expect(by.JBOSS8.jvmDegisim.map((j) => [j.ad, j.durum, j.metin])).toEqual([['j1', 'ok', 'ürün reboot öncesi çalışmıyordu — ürünle birlikte kapatıldı']]);
    expect(t.some((u) => /dokunulmadı/.test(u.metin))).toBe(false);
    // kapı: eski sürüm (belirsiz JBoss 7) -> yalnız JBoss
    // v3: boş önce → web (NGINX/RHA/IHS) korunmaz; v4 ("Her yerde kapat"): boş önce HİÇBİR ürünü korumaz
    expect([...kapatmaKorunan(['BOOT|a||'])].sort()).toEqual([]);
    expect([...kapatmaKorunan(['BOOT|a||', 'URUN|JBOSS7||'])].sort()).toEqual(['JBOSS7', 'JBOSS8']);
    expect(kapatmaKorunan(onceL).size).toBe(0);
    const n = nedenListesi(['BILGI|NEW|JBOSS8||reboot oncesi goruntu eski surum, JBoss nesli belirsiz - kapatilmadi, dokunulmadi', 'BILGI|NEW|WAS|s1|reboot oncesi WAS hic calismiyordu - JVMlerine tek tek dokunulmadi (urun, urun asamasinda kapatilir)']);
    expect(n[0]).toMatch(/^JBoss 8: .*kapatılmadı \(dokunulmadı\)/);
    expect(n[1]).toMatch(/^WebSphere \(WAS\) \/ s1: .*ürünle birlikte kapatılır/);
  });
});

describe('Reboot Kontrolü 2026-11-15 inceleme düzeltmeleri', () => {
  test('RK12 kapı yalnız ham önce: eski sürüm (SURUM yok, JBoss satırı) → JBoss korunur; BOOT yok → hepsi; SKIP metni; JVM çıkarımı ve önem', () => {
    expect([...kapatmaKorunan(['BOOT|a||', 'URUN|JBOSS7||', 'JVM|JBOSS7|s1|jboss_home=/usr/jboss/AppServer'])].sort()).toEqual(['JBOSS7', 'JBOSS8']);
    expect(kapatmaKorunan(['URUN|RHA||']).size).toBe(7);
    expect(kapatmaKorunan(['BOOT|a||', 'SURUM|2||', 'URUN|JBOSS7||']).size).toBe(0);
    const once = goruntuAyristir(['BOOT|a||', 'SURUM|2||', 'URUN|RHA||']);
    const son = goruntuAyristir(['BOOT|b||', 'URUN|RHA||', 'URUN|CTG||', 'JVM|JBOSS8|app1|x']);
    const t = urunTablosu(once, son, son, islemAyristir(['SONUC|durdur|CTG||SKIP|zaten kapali']), new Set(), new Set());
    const by = Object.fromEntries(t.map((u) => [u.urun, u]));
    expect([by.CTG.durum, by.CTG.metin]).toEqual(['sorun', 'reboot öncesi çalışmıyordu — kapatma anında kapalıydı, sonra yeniden kalktı; hâlâ ÇALIŞIYOR']);
    // ürün satırı olmayan, JVM'i çalışan yeni ürün: satır görünür, ürün de JVM de 'sorun'
    expect(by.JBOSS8?.durum).toBe('sorun');
    expect(by.JBOSS8.jvmDegisim.map((j) => [j.ad, j.durum])).toEqual([['app1', 'sorun']]);
    const n = nedenListesi([
      'BILGI|YENI_CIKARIM|JBOSS8||x',
      'BILGI|NEW|JBOSS8|app1|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine tek tek dokunulmadi (urun kapatilmadi: once goruntusu bos / eski surum)',
      'BILGI|NEW|JBOSS8|app2|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine dokunulmadi',
      'BILGI|NEW|CTG||reboot oncesi goruntu bos - calisan urun kapatilmadi, dokunulmadi',
      // v4 betiğin kapı notları (yalnız eski sürüm önce görüntüsü korur)
      'BILGI|NEW|JBOSS8|app3|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine tek tek dokunulmadi (urun kapatilmadi: once goruntusu eski surum)',
      'BILGI|NEW|JBOSS7||reboot oncesi goruntu eski surum (JBoss nesli belirsiz olabilir) - kapatilmadi, dokunulmadi',
    ]);
    expect(n[0]).toMatch(/^JBoss 8: şimdiki görüntüde ürün satırı yok/);
    // İnceleme B3: sürüm 3 notu ("goruntusu bos / eski surum", "goruntu bos") "eski sürüm olduğu için" diye gösterilmez
    expect(n[1]).toBe("JBoss 8 / app1: ürün reboot öncesi görüntüde yoktu — o koşudaki betik (sürüm 3) önce görüntüsü boş ya da eski sürüm olduğu için ürünü kapatmadı, JVM'ine dokunmadı; sürüm 4 boş önce görüntüsünde ürünü kapatır.");
    expect(n[2]).toMatch(/eski betik sürümü JVM'ine dokunmadı/);
    expect(n[3]).toBe('CTG: reboot öncesi çalışmıyordu — önce görüntüsü boştu; o koşudaki betik (sürüm 3) bu durumda yalnız web ürünlerini kapatırdı, bu ürüne dokunmadı. Sürüm 4 kapatır; "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.');
    expect(n[3]).not.toMatch(/eski sürüm/);
    expect(n[4]).toBe("JBoss 8 / app3: ürün reboot öncesi görüntüde yoktu — önce görüntüsü eski sürüm olduğu için ürün kapatılmadı, JVM'ine dokunulmadı.");
    expect(n[5]).toBe('JBoss 7: reboot öncesi çalışmıyordu — önce görüntüsü eski sürüm olduğu için kapatılmadı (dokunulmadı).');
  });
});

describe('Reboot Kontrolü v3 (2026-11-15 akşam: web kapatılır + kontrol edilecek, sürüm işareti)', () => {
  test('RK13 kapı (v4): boş önce HİÇBİR ürünü korumaz (web + CTG/JBoss/WAS); BOOT yoksa hepsi (sunucu kapiKorur ile aynı)', () => {
    expect([...BOS_KORUNAN]).toEqual([]);
    const kor = kapatmaKorunan(['BOOT|a||']);
    for (const u of ['NGINX', 'RHA', 'IHS', 'CTG', 'JBOSS7', 'JBOSS8', 'WAS']) expect(kor.has(u)).toBe(false);
    expect(kapatmaKorunan(['URUN|RHA||']).size).toBe(7);
    // boş önce + web ve CTG hâlâ çalışıyor -> ikisi de 'sorun' (kapatılması gerekirdi; "dokunulmadı" denmez)
    const son = goruntuAyristir(['BOOT|b||', 'URUN|NGINX||', 'URUN|CTG||']);
    const t = urunTablosu(goruntuAyristir(['BOOT|a||']), son, son, [], new Set(), kor, { guncel: true, etiket: 'sürüm 4' });
    const by = Object.fromEntries(t.map((u) => [u.urun, u]));
    expect(by.NGINX.durum).toBe('sorun');
    expect(by.CTG.durum).toBe('sorun');
    expect(by.CTG.metin).not.toMatch(/dokunulmadı/);
    // boş önce + CTG otomasyonla kapatıldı -> sarı "kontrol edilecek"
    const ctg = urunTablosu(goruntuAyristir(['BOOT|a||']), goruntuAyristir(['BOOT|b||', 'URUN|CTG||']), goruntuAyristir(['BOOT|b||']), islemAyristir(['SONUC|durdur|CTG||OK|x']), new Set(), kor);
    expect([ctg[0].urun, ctg[0].durum, ctg[0].metin]).toEqual(['CTG', 'bilgi', 'reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyonla kapatıldı — kontrol edilecek']);
    // boş önce + web otomasyonla kapatıldı -> sarı "kontrol edilecek"
    const ilk = goruntuAyristir(['BOOT|b||', 'URUN|NGINX||']);
    const k2 = urunTablosu(goruntuAyristir(['BOOT|a||']), ilk, goruntuAyristir(['BOOT|b||']), islemAyristir(['SONUC|durdur|NGINX||OK|x']), new Set(), kor);
    expect([k2[0].urun, k2[0].durum, k2[0].metin]).toEqual(['NGINX', 'bilgi', 'reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyonla kapatıldı — kontrol edilecek']);
    // durulma beklemesinde kalkıp kapatılan ürün de sarı
    const k3 = urunTablosu(goruntuAyristir(['BOOT|a||', 'SURUM|2||', 'URUN|RHA||']), goruntuAyristir(['BOOT|b||', 'URUN|RHA||']), goruntuAyristir(['BOOT|b||', 'URUN|RHA||']), islemAyristir(['SONUC|durdur|IHS||OK|x']));
    expect(k3.find((u) => u.urun === 'IHS')!.metin).toBe('reboot öncesi çalışmıyordu, durulma beklemesinde kalkmıştı — otomasyonla kapatıldı — kontrol edilecek');
    // kapatma FAIL ama kapandı -> yeşil kalır (otomasyon kapatmadı)
    const k4 = urunTablosu(goruntuAyristir(['BOOT|a||', 'SURUM|2||', 'URUN|RHA||']), goruntuAyristir(['BOOT|b||', 'URUN|RHA||', 'URUN|IHS||']), goruntuAyristir(['BOOT|b||', 'URUN|RHA||']), islemAyristir(['SONUC|durdur|IHS||FAIL|x']));
    expect(k4.find((u) => u.urun === 'IHS')!.durum).toBe('ok');
  });

  test('RK14 sürüm işareti (v4): yok / <4 eski, >=4 güncel; sürüm bilinince "olabilir" denmez', () => {
    expect(BETIK_SURUM_GEREKLI).toBe(4);
    expect(betikSurumu(undefined)).toEqual({ guncel: false, etiket: 'sürüm yok' });
    expect(betikSurumu({})).toEqual({ guncel: false, etiket: 'sürüm yok' });
    expect(betikSurumu({ betik_surum: 2 })).toEqual({ guncel: false, etiket: 'sürüm 2' });
    // v4: sürüm 3 betik boş önce'de CTG/JBoss/WAS'ı korurdu -> artık eski
    expect(betikSurumu({ betik_surum: '3' })).toEqual({ guncel: false, etiket: 'sürüm 3' });
    expect(betikSurumu({ betik_surum: 3 })).toEqual({ guncel: false, etiket: 'sürüm 3' });
    expect(betikSurumu({ betik_surum: '4' })).toEqual({ guncel: true, etiket: 'sürüm 4' });
    expect(betikSurumu({ betik_surum: 5 })).toEqual({ guncel: true, etiket: 'sürüm 5' });
    expect(betikSurumu({ betik_surum: 'abc' }).guncel).toBe(false);
    expect(betikEskiMetni(['sürüm yok', 'sürüm 2'])).toBe("AWX'teki reboot_check betiği eski (sürüm yok / sürüm 2, gerekli 4): bu koşuda ürün kapatma ve yeniden deneme YOKTU. ZIP'i AWX'e yükleyip projeyi Sync edin, sonra \"Reboot sonrası kontrol et ve düzelt\"i yeniden çalıştırın.");
    // İnceleme B1: sürüm 3'te ürün kapatma ve yeniden deneme VARDI -> "YOKTU" denmez; gerçek eksiği yazılır (sunucu ile birebir)
    expect(betikEskiMetni(['sürüm 3'])).toBe("AWX'teki reboot_check betiği eski (sürüm 3, gerekli 4): bu koşudaki betik (sürüm 3) ürün kapatıp yeniden deniyordu, ancak reboot öncesi görüntüsü boş sunucuda yalnız web ürünlerini (Nginx/Apache/IHS) kapatırdı, CTG/JBoss/WAS'a dokunmazdı; sürüm 4 reboot sonrası çalışan her ürünü kapatır. ZIP'i AWX'e yükleyip projeyi Sync edin, sonra \"Reboot sonrası kontrol et ve düzelt\"i yeniden çalıştırın.");
    // karışık sürüm: her sürümün nedeni ayrı
    expect(betikEskiMetni(['sürüm 2', 'sürüm 3'])).toMatch(/\(sürüm 2 \/ sürüm 3, gerekli 4\): sürüm 2: bu koşuda ürün kapatma ve yeniden deneme YOKTU; sürüm 3: bu koşudaki betik \(sürüm 3\) ürün kapatıp yeniden deniyordu/);
    const once = goruntuAyristir(['BOOT|a||', 'SURUM|2||', 'URUN|RHA||']);
    const son = goruntuAyristir(['BOOT|b||', 'URUN|RHA||', 'URUN|IHS||']);
    const metin = (b?: { guncel: boolean; etiket: string }) => urunTablosu(once, son, son, [], new Set(), new Set(), b).find((u) => u.urun === 'IHS')!.metin;
    expect(metin({ guncel: true, etiket: 'sürüm 4' })).not.toMatch(/eski|olabilir \(/);
    expect(metin({ guncel: true, etiket: 'sürüm 4' })).toMatch(/otomasyon kapatma komutu çalıştırmadı/);
    expect(metin({ guncel: false, etiket: 'sürüm 2' })).toBe("reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — otomasyon kapatmadı — AWX'teki betik eski (sürüm 2); güncel betikle yeniden çalıştırın");
    expect(metin({ guncel: false, etiket: 'sürüm 2' })).not.toMatch(/olabilir/);
    // eski çağıran (sürüm verilmedi): belirsiz dil korunur
    expect(metin()).toMatch(/eski betik sürümü olabilir/);
  });

  test('RK15 betik etkisi (2026-11-16): sürüm 3 yalnız boş önce + çalışan CTG/JBoss/WAS; < 3 her yerde; 4 hiçbir yerde; sunucu metniyle birebir', () => {
    const v = ['BOOT|b||', 'SURUM|2||'];
    const dolu = ['BOOT|a||', 'SURUM|2||', 'URUN|RHA||'];
    const bos = ['BOOT|a||'];
    const r = (goruntu: string[], son: string[], betik_surum?: number | string, plan: string[] = []) => ({ goruntu, son_goruntu: son, betik_surum, plan });
    // sürüm 3 + dolu önce -> yok
    expect(betikEtkisi(dolu, r([...v, 'URUN|RHA||', 'URUN|JBOSS8||'], [...v, 'URUN|RHA||', 'URUN|JBOSS8||'], 3)).eski).toBe(false);
    // sürüm 3 + boş önce + yalnız web -> yok
    expect(betikEtkisi(bos, r([...v, 'URUN|NGINX||', 'URUN|IHS||'], [...v, 'URUN|IHS||'], 3)).eski).toBe(false);
    // sürüm 3 + boş önce + çalışan JBoss (JVM'inden çıkarım) -> var, ürün adıyla; sunucu reboot-check.cjs betikEtkisi ile birebir metin
    const jb = betikEtkisi(bos, r([...v, 'JVM|JBOSS8|app|x', 'URUN|WAS||'], [...v, 'JVM|JBOSS8|app|x'], '3'));
    // İnceleme B2: yalnız ilk görüntüde çalışan WAS "betik eski" metnine girmez; ayrı nötr not (sunucu gectiNotu ile birebir)
    expect([jb.eski, jb.urunler, jb.gecti, jb.kapatmaz.has('JBOSS8'), jb.kapatmaz.has('NGINX')]).toEqual([true, ['JBOSS8'], ['WAS'], true, false]);
    expect(jb.metin).toBe("AWX'teki reboot_check betiği eski (sürüm 3, gerekli 4): JBoss 8 reboot öncesi çalışmıyordu ve hâlâ çalışıyor; reboot öncesi görüntüsü boş sunucuda AWX'teki betik sürüm 3 bunları kapatmaz (sürüm 4 kapatır). ZIP'i AWX'e yükleyip projeyi Sync edin, sonra \"Reboot sonrası kontrol et ve düzelt\"i yeniden çalıştırın.");
    expect(jb.gectiNotu).toBe('WebSphere reboot öncesi çalışmıyordu, reboot sonrası çalıştı ve son kontrolde kendiliğinden kapanmıştı; sürüm 3 betik reboot öncesi görüntüsü boş sunucuda bunlara dokunmaz. Son durum reboot öncesiyle aynı (yeniden çalıştırmak bir şey değiştirmez) — beklenen durum mu kontrol edin.');
    // önce verilmedi: boşluk plandaki BILGI|BOS'tan
    expect(betikEtkisi(undefined, r(v, [...v, 'URUN|CTG||'], 3, ['BILGI|BOS|||x'])).eski).toBe(true);
    expect(betikEtkisi(undefined, r(v, [...v, 'URUN|CTG||'], 3)).eski).toBe(false);
    // sürüm 2 / yok -> dolu önce'de bile var, her ürünü kapsar
    for (const s of [2, undefined, '']) {
      const e = betikEtkisi(dolu, r(dolu, dolu, s));
      expect(e.eski).toBe(true);
      expect(e.kapatmaz.has('NGINX')).toBe(true);
    }
    expect(betikEtkisi(dolu, r(dolu, dolu, 2)).metin).toMatch(/\(sürüm 2, gerekli 4\): bu koşuda ürün kapatma ve yeniden deneme YOKTU/);
    // sürüm 4 -> yok
    expect(betikEtkisi(bos, r([...v, 'URUN|CTG||'], [...v, 'URUN|CTG||'], 4)).eski).toBe(false);
    // ürün tablosu ürün bazında: sürüm 3 boş önce -> CTG "betik eski", IHS güncel dil
    const e3 = betikEtkisi(bos, r([...v, 'URUN|CTG||', 'URUN|IHS||'], [...v, 'URUN|CTG||', 'URUN|IHS||'], 3));
    const g = goruntuAyristir([...v, 'URUN|CTG||', 'URUN|IHS||']);
    const t = urunTablosu(goruntuAyristir(bos), g, g, [], new Set(), new Set(), e3);
    expect(t.find((u) => u.urun === 'CTG')!.metin).toMatch(/AWX'teki betik eski \(sürüm 3\)/);
    expect(t.find((u) => u.urun === 'IHS')!.metin).toMatch(/otomasyon kapatma komutu çalıştırmadı/);
    expect(betikEskiBandi(['sürüm 3'], 7)).toMatch(/\(sürüm 3, gerekli 4\): .*yeniden çalıştırın\. \(7 sunucuda etkili\)$/);
  });

  test('RK16 inceleme 2026-11-16: B1 önce kaynağı onceTamamGoruntu; B2 yalnız ilk görüntüde çalışan eski sayılmaz; B5 "3.0"', () => {
    const v = ['BOOT|b||', 'SURUM|2||'];
    const r = (goruntu: string[], son: string[], betik_surum?: number | string, plan: string[] = []) => ({ goruntu, son_goruntu: son, betik_surum, plan });
    // B1: goruntu_ok=false ya da BOOT'suz önce -> undefined; tamam ise satırlar
    expect(onceTamamGoruntu({ goruntu_ok: false, goruntu: ['BOOT|a||'] })).toBeUndefined();
    expect(onceTamamGoruntu({ goruntu_ok: true, goruntu: ['URUN|RHA||'] })).toBeUndefined();
    expect(onceTamamGoruntu(undefined)).toBeUndefined();
    expect(onceTamamGoruntu({ goruntu_ok: true, goruntu: ['BOOT|a||'] })).toEqual(['BOOT|a||']);
    const x = r([...v, 'URUN|CTG||'], [...v, 'URUN|CTG||'], 3, ['BILGI|HATA|||once yok']);
    expect(betikEtkisi(onceTamamGoruntu({ goruntu_ok: false, goruntu: ['BOOT|a||'] }), x).eski).toBe(false);
    expect(betikEtkisi(onceTamamGoruntu({ goruntu_ok: true, goruntu: ['BOOT|a||'] }), x).eski).toBe(true);
    // B2: yalnız ilk görüntüde CTG -> eski değil, metin boş, nötr not var
    const g = betikEtkisi(['BOOT|a||'], r([...v, 'URUN|CTG||'], v, 3));
    expect([g.eski, g.metin, g.urunler, g.gecti]).toEqual([false, '', [], ['CTG']]);
    expect(g.gectiNotu).toMatch(/^CTG reboot öncesi çalışmıyordu, reboot sonrası çalıştı ve son kontrolde kendiliğinden kapanmıştı; /);
    expect(g.gectiNotu).not.toMatch(/ZIP|betiği eski/);
    // B5: "3.0" sürüm 3 sayılır; neden metni de sürüm 3 metni
    expect(betikEtkisi(['BOOT|a||'], r([...v, 'URUN|CTG||'], [...v, 'URUN|CTG||'], '3.0')).metin).toMatch(/\(sürüm 3\.0, gerekli 4\): CTG reboot öncesi/);
    expect(eskiSurumNedeni('sürüm 3.0')).toBe(eskiSurumNedeni('sürüm 3'));
    expect(eskiSurumNedeni('sürüm 2')).toMatch(/YOKTU/);
    expect(eskiSurumNedeni('sürüm yok')).toMatch(/YOKTU/);
  });
});
