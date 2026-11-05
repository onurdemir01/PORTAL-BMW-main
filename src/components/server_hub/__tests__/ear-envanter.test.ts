// src/components/server_hub/__tests__/ear-envanter.test.ts — Uygulama Envanteri saf yardımcıları.
//
//   EE1 KABUL ÖLÇÜTÜ: yeşil ("iyi") yalnız TAM / TAMAMLANDI / AYNI / BITTI; kısmi, okunamadı, sonuç yok,
//       karşılaştırılamadı ASLA yeşil değil; bilinmeyen durum nötr
//   EE2 elle sunucu listesi: ayraçlar, tekil, BÜYÜK harf, geçersiz ad ayrı
//   EE3 veri yaşı: 'Z'li ve 'Z'siz UTC aynı sonucu verir; tarih yoksa null
//   EE4 ağaç süzgeci, parti ilerlemesi, boyut metni, sorgu dizgisi (boş alan gitmez)
import { describe, it, expect } from 'vitest';
import {
  DURUM_TABLOLARI,
  uygulamaDurumu,
  hostDurumu,
  kosuDurumu,
  kararDurumu,
  hostListesiAyristir,
  veriYasiGun,
  agacSuz,
  partiIlerleme,
  boyutMetni,
  kisaIz,
  kaynakEtiketi,
} from '@/components/server_hub/earEnvanter';
import { sorguDizgisi, earIndir, type EarAgacSatiri, type EarParti } from '@/api/earEnvanterApi';

describe('EE1 durum dili', () => {
  it('yeşil yalnız eksiksiz durumlar', () => {
    const yesil: string[] = [];
    for (const [tablo, harita] of Object.entries(DURUM_TABLOLARI))
      for (const [d, b] of Object.entries(harita)) if (b.ton === 'iyi') yesil.push(`${tablo}.${d}`);
    expect(yesil.sort()).toEqual([
      'HOST.TAM',
      'KARAR.AYNI',
      'KOSU.TAMAMLANDI',
      'PARTI.BITTI',
      'UYGULAMA.TAM',
    ]);
  });
  it('eksik ve ölçülemeyen yeşil değil', () => {
    for (const d of [
      'KISMI_SINIR',
      'KISMI_ZAMAN',
      'KISMI_IZIN',
      'ARSIV_ACILMADI',
      'ATLANDI_ZAMAN',
      'HATA',
    ])
      expect(uygulamaDurumu(d).ton).not.toBe('iyi');
    for (const d of ['KISMI', 'SONUC_YOK', 'OKUNAMADI', 'ULASILAMADI', 'ZAMAN_ASIMI'])
      expect(hostDurumu(d).ton).not.toBe('iyi');
    expect(hostDurumu('SONUC_YOK').ton).toBe('kotu');
    expect(kosuDurumu('KISMI').ton).toBe('uyari');
    expect(kararDurumu('EKSIK_TARAMA').ton).not.toBe('iyi');
    // Ayni surum, farkli dosya: yesil degil (fark var), kirmizi degil (surum ayni).
    expect(kararDurumu('AYNI_SURUM_FARKLI_DOSYA').ton).toBe('uyari');
    expect(kararDurumu('FARKLI_KUTUPHANE').ton).toBe('kotu');
  });
  it('bilinmeyen durum nötr', () => {
    expect(uygulamaDurumu('YENI_BIR_DURUM')).toMatchObject({
      ton: 'notr',
      etiket: 'yeni_bir_durum',
    });
    expect(hostDurumu(null)).toMatchObject({ ton: 'notr', etiket: '—' });
  });
});

describe('EE2 elle sunucu listesi', () => {
  it('ayrıştırır', () => {
    expect(hostListesiAyristir('appsrv01\nAPPSRV02, appsrv01;  appsrv03  kotu/ad')).toEqual({
      hostlar: ['APPSRV01', 'APPSRV02', 'APPSRV03'],
      gecersiz: ['KOTU/AD'],
    });
    expect(hostListesiAyristir('   ')).toEqual({ hostlar: [], gecersiz: [] });
  });
});

describe('EE3 veri yaşı', () => {
  const simdi = Date.parse('2026-11-04T12:00:00Z');
  it('Z bağımsız', () => {
    expect(veriYasiGun('2026-11-01T12:00:00', simdi)).toBe(3);
    expect(veriYasiGun('2026-11-01T12:00:00.000Z', simdi)).toBe(3);
    expect(veriYasiGun(null, simdi)).toBeNull();
    expect(veriYasiGun('bozuk', simdi)).toBeNull();
  });
});

describe('EE4 yardımcılar', () => {
  it('ağaç süzgeci', () => {
    const s: EarAgacSatiri[] = [
      ['A.war/WEB-INF/lib/a.jar', 'F', '-rw-r--r--', 1, 1, 10, 1, 2, ''],
      ['A.war/index.jsp', 'F', '-rw-r--r--', 1, 1, 10, 1, 3, ''],
    ];
    expect(agacSuz(s, 'web-inf/LIB')).toHaveLength(1);
    expect(agacSuz(s, '')).toHaveLength(2);
  });
  it('parti ilerlemesi', () => {
    const p = (parti_no: number, durum: EarParti['durum'], host_sayisi: number) =>
      ({ parti_no, durum, host_sayisi }) as EarParti;
    const r = partiIlerleme([
      p(1, 'BITTI', 100),
      p(2, 'HATA', 100),
      p(3, 'CALISIYOR', 100),
      p(4, 'BEKLIYOR', 30),
    ]);
    expect([r.bitenHost, r.toplamHost, r.calisan?.parti_no]).toEqual([200, 330, 3]);
  });
  it('boyut, iz, sorgu dizgisi, indirme adresleri', () => {
    expect(boyutMetni(1536)).toBe('1.5 KB');
    expect(boyutMetni('')).toBe('—');
    expect(kisaIz('0123456789abcdef  ')).toBe('01234567');
    expect(sorguDizgisi({ q: '', ortam: 'PROD', kosu: undefined, tumu: false, limit: 100 })).toBe(
      '?ortam=PROD&limit=100',
    );
    expect(earIndir.zip(5, 'APPSRV01')).toBe(
      '/api/server-hub/ear/disa-aktar-zip?kosu=5&host=APPSRV01',
    );
    expect(earIndir.csv('warlar')).toBe('/api/server-hub/ear/disa-aktar/warlar.csv');
    expect(earIndir.agacTxt(5, 'A B', 2)).toBe('/api/server-hub/ear/agac/5/A%20B/2?bicim=txt');
  });

  it('koşu kaynağı: AWX\'ten Limit ile başlatılan iş ayrı görünür', () => {
    expect(kaynakEtiketi('ZAMANLAYICI')).toBe('haftalık');
    expect(kaynakEtiketi('AWX')).toBe('AWX (Limit)');
    expect(kaynakEtiketi('ELLE')).toBe('elle');
    expect(kaynakEtiketi(undefined)).toBe('elle');
  });
});
