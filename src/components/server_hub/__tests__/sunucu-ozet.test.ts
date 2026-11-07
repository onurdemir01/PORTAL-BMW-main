// src/components/server_hub/__tests__/sunucu-ozet.test.ts — sunucu panelinin özet kartları ve zincir rozetleri (2026-11-07).
//
//   SO1 özet kartları: bulgu tonu (kritik > uyarı > yok), etiket (yükleniyor / yok / şüpheli / kesin), trafik
//       (eşlenmeyen JVM ölçülemedi sayılır), Uygulama Envanteri (bugün / gün / eski / yok / okunamadı),
//       auto-start uyumsuzluğu (ölçülemeyen çalışma sayılmaz); her kartın açtığı bölüm
//   SO2 zincir rozetleri: çalışma, auto-start uyumu, EAR (yok ≠ bilinmiyor), web katmanı, trafik, parametre,
//       yalnız kötü deployment
import { describe, it, expect } from 'vitest';
import type { ShHostDetail, ShJvm, ShRetireEtiketHer } from '@/api/serverHubApi';
import {
  autostartUyumsuz,
  jvmTrafik,
  ozetKartlari,
  zincirRozetleri,
} from '@/components/server_hub/sunucuOzet';

const J = (o: Partial<ShJvm> & { runningKnown?: boolean } = {}) =>
  ({
    gen: 7,
    name: 'app',
    group: 'g',
    running: true,
    autoStart: 'true',
    serverState: 'running',
    ports: [],
    vhosts: [],
    ...o,
  }) as ShJvm & {
    runningKnown?: boolean;
  };
const V = (trafficState: string | null) => ({ host: 'W', serverName: 's', trafficState }) as never;
const D = (o: Partial<ShHostDetail> = {}) =>
  ({
    host: 'H1',
    findings: [],
    jvms: [],
    ear: { durum: 'VAR', yasGun: 0 },
    ...o,
  }) as unknown as ShHostDetail;
const E = (seviye: 'KESIN' | 'SUPHELI') => ({ seviye }) as ShRetireEtiketHer;
const kart = (d: ShHostDetail, e: ShRetireEtiketHer[] | null, id: string) =>
  ozetKartlari(d, e).find((k) => k.id === id)!;

describe('sunucu özeti', () => {
  it('SO1 özet kartları', () => {
    const F = (severity: string) => ({ severity }) as never;
    expect(
      kart(D({ findings: [F('danger'), F('warning'), F('warning')] }), [], 'bulgular'),
    ).toMatchObject({
      deger: '1 kritik · 2 uyarı',
      ton: 'kotu',
      bolum: 'bulgular',
    });
    expect(kart(D({ findings: [F('warning')] }), [], 'bulgular').ton).toBe('uyari');
    expect(kart(D({ findings: [F('info')] }), [], 'bulgular').ton).toBe('iyi');
    expect(kart(D(), null, 'etiketler')).toMatchObject({
      deger: 'yükleniyor',
      ton: 'notr',
      bolum: 'etiketler',
    });
    expect(kart(D(), [], 'etiketler')).toMatchObject({ deger: 'yok', ton: 'notr' });
    expect(kart(D(), [E('SUPHELI'), E('SUPHELI')], 'etiketler')).toMatchObject({
      deger: 'şüpheli · 2',
      ton: 'uyari',
    });
    expect(kart(D(), [E('SUPHELI'), E('KESIN')], 'etiketler')).toMatchObject({
      deger: 'kesin · 2',
      ton: 'kotu',
    });
    const jvms = [
      J({ vhosts: [V('ACTIVE'), V('NO_RECENT_TRAFFIC')] }),
      J({ vhosts: [V('NO_RECENT_TRAFFIC')] }),
      J({ vhosts: [] }),
      J({ vhosts: [V('UNREADABLE')] }),
    ];
    expect(kart(D({ jvms }), [], 'trafik')).toMatchObject({
      deger: '1 aktif · 1 boşta · 2 ölçülemedi',
      bolum: 'uygulamalar',
    });
    expect(kart(D({ jvms: [J({ vhosts: [V('ACTIVE')] })] }), [], 'trafik').deger).toBe(
      '1 aktif · 0 boşta',
    );
    expect(kart(D(), [], 'trafik').deger).toBe('JVM yok');
    const env = (ear: unknown) => kart(D({ ear } as never), [], 'envanter');
    expect(env({ durum: 'VAR', yasGun: 0 })).toMatchObject({
      deger: 'bugün tarandı',
      ton: 'iyi',
      bolum: 'uygulamalar',
    });
    expect(env({ durum: 'VAR', yasGun: 3 })).toMatchObject({ deger: '3 gün önce', ton: 'iyi' });
    expect(env({ durum: 'VAR', yasGun: 12 })).toMatchObject({ deger: '12 gün önce', ton: 'uyari' });
    expect(env({ durum: 'ESKI', yasGun: 50 })).toMatchObject({
      deger: 'eski (50 gün)',
      ton: 'uyari',
    });
    expect(env({ durum: 'YOK' })).toMatchObject({ deger: 'veri yok', ton: 'notr' });
    expect(env(null)).toMatchObject({ deger: 'veri yok', ton: 'notr' });
    expect(env({ durum: 'OKUNAMADI' })).toMatchObject({ deger: 'okunamadı', ton: 'uyari' });
    const as = [
      J({ running: true, autoStart: 'false' }),
      J({ running: false, autoStart: 'true' }),
      J({ running: false, autoStart: 'true', runningKnown: false }),
      J({ running: false, autoStart: 'false' }),
    ];
    expect(kart(D({ jvms: as }), [], 'autostart')).toMatchObject({
      deger: '2 JVM',
      ton: 'kotu',
      bolum: 'uygulamalar',
    });
    expect(kart(D(), [], 'autostart')).toMatchObject({ deger: 'yok', ton: 'iyi' });
    expect(ozetKartlari(D(), []).map((k) => k.id)).toEqual([
      'bulgular',
      'etiketler',
      'trafik',
      'envanter',
      'autostart',
    ]);
  });

  it('SO2 zincir rozetleri', () => {
    const r = (d: ShHostDetail, j: ReturnType<typeof J>, ear = 0, katman = 'ayri-web') =>
      zincirRozetleri(d, j, ear, katman).map((x) => `${x.metin}|${x.ton}`);
    expect(r(D(), J({ vhosts: [V('ACTIVE')] }), 1, 'ayni-sunucu')).toEqual([
      'çalışıyor|iyi',
      'auto-start açık|notr',
      'EAR 1|notr',
      'web: aynı sunucu|notr',
      'trafik var|iyi',
    ]);
    expect(
      r(D(), J({ running: false, vhosts: [V('NO_RECENT_TRAFFIC')], argFark: 1 } as never)),
    ).toEqual([
      'kapalı|uyari',
      'auto-start açık|kotu',
      'EAR yok|uyari',
      'web: ayrı sunucu|notr',
      'trafik yok (7 gün)|uyari',
      'parametre farkı var|kotu',
    ]);
    expect(
      r(
        D({ ear: { durum: 'YOK' } } as never),
        J({ runningKnown: false, autoStart: 'unknown' } as never),
        0,
        'esle',
      ),
    ).toEqual([
      'ölçülemedi|notr',
      'auto-start ?|notr',
      'EAR ?|notr',
      'web eşlenemedi|notr',
      'trafik ölçülemedi|notr',
    ]);
    expect(r(D(), J({ argFark: 2 } as never))).toContain('parametre farkı ölçülemedi|notr');
    // Kötü deployment rozet olur; iyi / ölçülmemiş olmaz.
    const dep = (jvmler: unknown[]) =>
      D({ ear: { durum: 'VAR', yasGun: 0, deployment: { kesik: false, jvmler } } } as never);
    expect(
      r(dep([{ nesil: 7, ad: 'app', durum: 'OK', deploymentlar: [] }]), J()).some((x) =>
        x.startsWith('deployment: '),
      ),
    ).toBe(true);
    expect(
      r(
        dep([
          {
            nesil: 7,
            ad: 'app',
            durum: 'OK',
            deploymentlar: [{ ad: 'A.ear', durum: 'OK', etkin: true }],
          },
        ]),
        J(),
      ).some((x) => x.startsWith('deployment: ')),
    ).toBe(false);
    expect(jvmTrafik(J({ vhosts: [] }))).toBe('OLCULEMEDI');
    expect(autostartUyumsuz(J({ running: true, autoStart: 'unknown' }))).toBe(false);
  });
});
