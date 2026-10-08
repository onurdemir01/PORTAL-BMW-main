// src/components/server_hub/__tests__/reboot-kontrolu.test.ts — RK1..RK3 (2026-10-08).
import { describe, expect, test } from 'vitest';
import { bilgiAyristir, farkAyristir, goruntuAyristir, islemAyristir, sunucuListesi } from '../rebootKontrolu';

describe('Reboot Kontrolü satırları', () => {
  test('RK1 görüntü / fark / işlem / bilgi ayrışır; yorum satırı atlanır', () => {
    expect(goruntuAyristir(['# format', 'JBOSS8_JVM|appA|2|1,2|was|d'])).toEqual([{ tip: 'JBOSS8_JVM', ad: 'appA', adet: 2, kullanicilar: 'was' }]);
    expect(farkAyristir(['FARK|DOWN|JBOSS8_JVM|appA|d', 'ISLEM|was|2|baslat|JBOSS8_JVM|appA|d', 'FARK|NEW|WEB_NGINX|NGINX|d'])).toEqual([
      { tur: 'DOWN', tip: 'JBOSS8_JVM', ad: 'appA' }, { tur: 'NEW', tip: 'WEB_NGINX', ad: 'NGINX' },
    ]);
    expect(islemAyristir(['SONUC|baslat|JBOSS8_JVM|appA|OK|/host=h/server-config=appA:start|x'])).toEqual([
      { islem: 'baslat', tip: 'JBOSS8_JVM', ad: 'appA', sonuc: 'OK', mesaj: '/host=h/server-config=appA:start|x' },
    ]);
    expect(bilgiAyristir(['BILGI|NEW|JBOSS8_CTRL|HOST_CONTROLLER|domain yeni acilmis'])[0]).toEqual({ tur: 'NEW', tip: 'JBOSS8_CTRL', ad: 'HOST_CONTROLLER', mesaj: 'domain yeni acilmis' });
  });

  test('RK2 bilinmeyen sonuç "?" olarak taşınır, girdi dizi değilse boş', () => {
    expect(islemAyristir(['SONUC|baslat|X|y|UYDURMA|m'])[0].sonuc).toBe('?');
    expect(farkAyristir(undefined)).toEqual([]);
    expect(goruntuAyristir('x')).toEqual([]);
  });

  test('RK3 sunucu listesi: virgül/boşluk/satır, büyük harf, tekil', () => {
    expect(sunucuListesi('gbjbop18, GBJBOP18\nGBJBOAP18;  x1 ')).toEqual(['GBJBOP18', 'GBJBOAP18', 'X1']);
  });
});
