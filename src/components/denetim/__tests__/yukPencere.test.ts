// src/components/denetim/__tests__/yukPencere.test.ts
//
// "İstek yok ama 7 gün ölçülemedi" etiketi (2026-10-02). Üç ekran (Denetim > Nginx SPA,
// ARK SPA Raporu, Production Taşımaları) bu metni kullanır. Kilitlenen iddialar:
//   - kısa pencerede etiket ölçülen süreyi söyler ve "7 gün ölçülemedi" der
//   - süre AŞAĞI yuvarlanır (pencere bir alt sınır: "3 günde yok" en az 3 gün bakıldı)
//   - pencere bilinmiyorsa süre UYDURULMAZ
//   - 'idle' / 'active' / hiç okunamamış ölçüme bu etiket verilmez
//   - Taşımalar uygulama özeti: hiç ölçülmemiş yol "yük almıyor"u engeller (yolYukOzeti)
import { describe, it, expect } from 'vitest';
import {
  kismiEtiket,
  kismiAciklama,
  pencereIstekYok,
  yolYukOzeti,
} from '@/components/denetim/yukPencere';
import type { SpaYukOlcumu } from '@/api/denetimApi';

const olcum = (o: Partial<SpaYukOlcumu>): SpaYukOlcumu => ({
  state: 'unknown',
  req24: 0,
  req7: 0,
  hc24: 0,
  lastSeen: null,
  firstSeen: '20260929031500',
  pencereSaat: 68,
  sampled: false,
  hosts: 2,
  unknownHosts: 0,
  missingHosts: 0,
  kismi: ['pencere'],
  ...o,
});

describe('kismiEtiket', () => {
  it('kısa pencere: "son N günde istek yok (7 gün ölçülemedi)"', () => {
    expect(kismiEtiket(olcum({}))).toBe('son 2 günde istek yok (7 gün ölçülemedi)');
    expect(kismiEtiket(olcum({ pencereSaat: 167 }))).toBe('son 6 günde istek yok (7 gün ölçülemedi)');
    expect(kismiEtiket(olcum({ pencereSaat: 5 }))).toBe('son 5 saatte istek yok (7 gün ölçülemedi)');
    expect(kismiEtiket(olcum({ pencereSaat: 0 }))).toBe('bugünkü kayıtta istek yok (7 gün ölçülemedi)');
  });

  it('pencere bilinmiyorsa süre UYDURULMAZ', () => {
    const t = olcum({ pencereSaat: null, firstSeen: null, kismi: ['pencere-bilinmiyor'] });
    expect(kismiEtiket(t)).toBe('istek yok (ölçülen süre bilinmiyor)');
    expect(kismiEtiket(t)).not.toMatch(/\d/);
  });

  it('diğer nedenler: okunamayan / satırsız sunucu, sampled', () => {
    expect(kismiEtiket(olcum({ pencereSaat: 192, kismi: ['okunamayan-sunucu'], unknownHosts: 1 }))).toBe(
      'istek yok (1 sunucu ölçülemedi)',
    );
    expect(
      kismiEtiket(olcum({ pencereSaat: 192, kismi: ['satirsiz-sunucu', 'okunamayan-sunucu'], unknownHosts: 1, missingHosts: 2 })),
    ).toBe('istek yok (3 sunucu ölçülemedi)');
    expect(kismiEtiket(olcum({ pencereSaat: 192, kismi: ['sampled'], sampled: true }))).toBe(
      'istek yok (7 günün tamamı okunamadı)',
    );
    // Hem kısa pencere hem sampled: süre söylenir.
    expect(kismiEtiket(olcum({ kismi: ['sampled', 'pencere'], sampled: true }))).toBe(
      'son 2 günde istek yok (7 gün ölçülemedi)',
    );
  });

  it('idle / active / hiç okunamamış ölçüme bu etiket VERİLMEZ', () => {
    expect(kismiEtiket(olcum({ state: 'idle', kismi: undefined, pencereSaat: 192 }))).toBeNull();
    expect(kismiEtiket(olcum({ state: 'active', req7: 4 }))).toBeNull();
    expect(kismiEtiket(olcum({ hosts: 0, req7: null, unknownHosts: 2 }))).toBeNull();
  });
});

describe('kismiAciklama', () => {
  it('her zaman "yük almıyor DENMEZ" der ve süreyi açıklar', () => {
    const a = kismiAciklama(olcum({}));
    expect(a).toContain('son 2 günü kapsıyor');
    expect(a).toContain('68 saat');
    expect(a).toContain('“yük almıyor” DENMEZ');
    const b = kismiAciklama(olcum({ pencereSaat: null, kismi: ['pencere-bilinmiyor'] }));
    expect(b).toContain('kaç gün bakıldığı bilinmiyor');
    expect(b).toContain('“yük almıyor” DENMEZ');
  });
});

describe('yolYukOzeti (Production Taşımaları uygulama özeti)', () => {
  // Doğrulama bulgusu (2026-10-02): hiç ölçülmemiş yol (traffic null) ATILIYORDU; öteki yol
  // 7 gün ölçülmüş 0 ise uygulama "yük almıyor" bandına düşüyordu.
  const idle = olcum({ state: 'idle', kismi: undefined, pencereSaat: 192, hosts: 1 });
  const aktif = olcum({ state: 'active', req7: 9, kismi: undefined, pencereSaat: 192, hosts: 1 });

  it('ölçülmeyen yol + idle yol -> unknown (satirsiz-sunucu), "yük almıyor" denmez', () => {
    for (const sira of [
      [{ traffic: null, hosts: ['GBRVPP08', 'GBRVPP09'] }, { traffic: idle, hosts: ['GBRVPP07'] }],
      [{ traffic: idle, hosts: ['GBRVPP07'] }, { traffic: null, hosts: ['GBRVPP08', 'GBRVPP09'] }],
    ]) {
      const t = yolYukOzeti(sira)!;
      expect(t.state).toBe('unknown');
      expect(t.kismi).toEqual(['satirsiz-sunucu']);
      expect(t.missingHosts).toBe(2);
      expect(kismiEtiket(t)).toBe('istek yok (2 sunucu ölçülemedi)');
    }
    expect(idle.state).toBe('idle'); // girdi değiştirilmez
  });

  it('bir yol yük alıyorsa aktif; hepsi ölçülmüşse aynen; hiç ölçüm yoksa null', () => {
    expect(yolYukOzeti([{ traffic: null }, { traffic: aktif }])).toBe(aktif);
    expect(yolYukOzeti([{ traffic: idle }, { traffic: idle }])).toBe(idle);
    expect(yolYukOzeti([{ traffic: null }, { traffic: null }])).toBeNull();
    const k = yolYukOzeti([{ traffic: olcum({}) }, { traffic: null }])!;
    expect(k.state).toBe('unknown');
    expect(new Set(k.kismi)).toEqual(new Set(['pencere', 'satirsiz-sunucu']));
    expect(k.missingHosts).toBe(1);
  });
});

describe('pencereIstekYok', () => {
  it('aşağı yuvarlar (alt sınır)', () => {
    expect(pencereIstekYok(47)).toBe('son 1 günde istek yok');
    expect(pencereIstekYok(48)).toBe('son 2 günde istek yok');
    expect(pencereIstekYok(23.9)).toBe('son 23 saatte istek yok');
  });
});
