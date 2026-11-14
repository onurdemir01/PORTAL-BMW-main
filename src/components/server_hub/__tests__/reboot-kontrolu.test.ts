// src/components/server_hub/__tests__/reboot-kontrolu.test.ts — RK1..RK4 (2026-10-08).
import { describe, expect, test } from 'vitest';
import { DURUM, SONRA_ACIK, bilgiAyristir, goruntuAyristir, islemAyristir, nedenListesi, nesilKarsilastirilamaz, onceBos, onceOzeti, rebootOldu, sunucuListesi, urunTablosu } from '../rebootKontrolu';

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

  test('RK2 ürün tablosu: açılan ürün ok, hâlâ kapalı sorun, yeni ürün bilgi; JVM değişimleri', () => {
    const isl = islemAyristir(['SONUC|baslat|NGINX||OK|startNginx.sh', 'SONUC|baslat|JBOSS8|appA|OK|start', 'SONUC|durdur|JBOSS8|appC|FAIL|hata', 'SONUC|baslat|WAS||FAIL|yok']);
    const t = urunTablosu(goruntuAyristir(ONCE), goruntuAyristir(ILK), goruntuAyristir(SON), isl);
    const by = Object.fromEntries(t.map((u) => [u.urun, u]));
    expect(t.map((u) => u.urun)).toEqual(['NGINX', 'IHS', 'JBOSS8', 'WAS']);
    expect([by.NGINX.durum, by.NGINX.metin, by.NGINX.islem?.sonuc]).toEqual(['ok', 'reboot sonrası kapalıydı, açıldı', 'OK']);
    expect(by.IHS.durum).toBe('bilgi');
    expect([by.WAS.durum, by.WAS.metin]).toEqual(['sorun', 'çalışıyordu, hâlâ KAPALI']);
    expect(by.JBOSS8.jvmAyni).toBe(1);
    expect(by.JBOSS8.jvmDegisim.map((j) => [j.ad, j.durum, j.metin])).toEqual([
      ['appA', 'ok', 'kapalıydı, açıldı'], ['appC', 'sorun', 'önce çalışmıyordu, hâlâ ÇALIŞIYOR'],
    ]);
    expect(by.WAS.jvmDegisim.map((j) => [j.ad, j.durum])).toEqual([['srv1', 'sorun']]);
    const yeni = urunTablosu(goruntuAyristir(['BOOT|a||']), goruntuAyristir(['BOOT|b||', 'URUN|JBOSS7||', 'JVM|JBOSS7|z|x']), goruntuAyristir(['BOOT|b||', 'URUN|JBOSS7||', 'JVM|JBOSS7|z|x']), []);
    expect(yeni[0].jvmDegisim.map((j) => [j.ad, j.durum])).toEqual([['z', 'bilgi']]);
    expect(by.IHS.metin).toBe('reboot öncesi çalışmıyordu, şimdi çalışıyor — kurala göre dokunulmadı');
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
  test('RK5 "dokunulmadı" etiketleri SON durumu söyler; JVM etiketi nedenini yazar', () => {
    const once = goruntuAyristir(['BOOT|a||']);
    const ilk = goruntuAyristir(['BOOT|b||', 'URUN|IHS||', 'URUN|JBOSS7||', 'JVM|JBOSS7|z|x', 'JVM|JBOSS7|y|x']);
    const son = goruntuAyristir(['BOOT|b||', 'URUN|JBOSS7||', 'JVM|JBOSS7|z|x']);
    const t = urunTablosu(once, ilk, son, []);
    const by = Object.fromEntries(t.map((u) => [u.urun, u]));
    expect([by.IHS.durum, by.IHS.metin]).toEqual(['bilgi', 'reboot öncesi çalışmıyordu, şu an KAPALI — dokunulmadı']);
    expect(by.JBOSS7.metin).toBe('reboot öncesi çalışmıyordu, şimdi çalışıyor — kurala göre dokunulmadı');
    expect(by.JBOSS7.jvmDegisim.map((j) => [j.ad, j.metin])).toEqual([
      ['y', 'şu an KAPALI — ürün reboot öncesi görüntüde yoktu, dokunulmadı'],
      ['z', 'şimdi çalışıyor — ürün reboot öncesi görüntüde yoktu, kurala göre dokunulmadı'],
    ]);
    expect(urunTablosu(once, ilk, null, [])[0].metin).toMatch(/son durum ölçülemedi/);
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
    expect(n[0]).toMatch(/izlenen ürün\/JVM yoktu/);
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
});
