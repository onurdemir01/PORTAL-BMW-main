// src/components/server_hub/__tests__/reboot-kontrolu.test.ts — RK1..RK4 (2026-10-08).
import { describe, expect, test } from 'vitest';
import { bilgiAyristir, goruntuAyristir, islemAyristir, onceOzeti, rebootOldu, sunucuListesi, urunTablosu } from '../rebootKontrolu';

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
