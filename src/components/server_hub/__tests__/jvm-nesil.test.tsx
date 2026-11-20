// src/components/server_hub/__tests__/jvm-nesil.test.tsx — "yalnız envanterde" etiketi (2026-11-14).
// Üretim (GBJIST02): taramada JVM'i bulunamayan MWAppsInventory uygulaması gen 0 satır olarak geliyor ve
// ekran "JBoss 0" yazıyordu.
//   JN1 yardımcı: yalnız envanterdeki / gen 0 satır "yalnız envanterde"; 7 / 8 "JBoss 7/8"; bilinmeyen "JBoss ?"
//   JN2 Application Hub JVM kartı: yalnız envanterdeki satırda etiket var, "JBoss 0" yok
//   JN3 bekçi: Server Hub / Application Hub JVM satırları nesli yardımcıdan basar (çıplak "JBoss {j.gen" yok)
//   JN4 sunucu paneli: yalnız envanterdeki satır auto-start uyumsuzluğu / trafik / JVM sayısına girmez; zincir
//       kartında çalışma / auto-start rozeti yerine "yalnız envanterde"
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import JbossGorunum from '@/components/app_hub/JbossGorunum';
import type { JbossDetay, JbossJvm, JbossSunucu } from '@/api/appHubApi';
import {
  jvmNesilEtiketi,
  jvmSayisiMetni,
  yalnizEnvanterMi,
  YALNIZ_ENVANTER_ETIKETI,
} from '../jvmNesil';
import { autostartUyumsuz, ozetKartlari, zincirRozetleri } from '../sunucuOzet';
import type { ShHostDetail, ShJvm } from '@/api/serverHubApi';

vi.mock('@/components/app_hub/JvmParamDuzenle', () => ({ default: () => null }));

describe('JVM nesil etiketi', () => {
  it('JN1 yalnız envanterde / JBoss 7 / JBoss ?', () => {
    expect(YALNIZ_ENVANTER_ETIKETI).toBe('yalnız envanterde');
    expect(jvmNesilEtiketi({ gen: 0, source: 'envanter', yalnizEnvanter: true })).toBe(
      'yalnız envanterde',
    );
    expect(jvmNesilEtiketi({ gen: 0, source: 'envanter' })).toBe('yalnız envanterde');
    expect(jvmNesilEtiketi({ gen: 0 })).toBe('yalnız envanterde');
    expect(jvmNesilEtiketi({ gen: 7, source: 'cli' })).toBe('JBoss 7');
    expect(jvmNesilEtiketi({ gen: 8 })).toBe('JBoss 8');
    expect(jvmNesilEtiketi({ gen: null })).toBe('JBoss ?');
    expect(jvmNesilEtiketi(null)).toBe('JBoss ?');
    expect(yalnizEnvanterMi({ source: 'cli' })).toBe(false);
    expect(yalnizEnvanterMi({ yalnizEnvanter: true })).toBe(true);
  });

  it('JN2 Application Hub: yalnız envanterdeki JVM kartında etiket var, "JBoss 0" yok', () => {
    const jvm = (o: Partial<JbossJvm>): JbossJvm => ({
      host: 'GBJIST02',
      ad: 'GBFACELIFTSUBE-T',
      nesil: null,
      grup: null,
      calisiyor: true,
      autoStart: 'true',
      durum: 'running',
      portlar: [],
      jvmArgs: null,
      yapilandirilanJvmArgs: null,
      jvmArgFarki: null,
      jvmArgDurumu: null,
      jvmArgKaynagi: null,
      istek24s: null,
      istek7g: null,
      taze: true,
      taramaTarihi: '2026-11-14',
      ...o,
    });
    const s: JbossSunucu = {
      host: 'GBJIST02',
      uygulama: 'GBFACELIFTSUBE-T',
      ortam: 'TEST',
      site: null,
      jbossSurum: 'EAP 7.4',
      nesil: 7,
      jdk: null,
      jre: '11',
      envanterDurumu: 'running',
      uygulamaYolu: null,
      tier: null,
      jvmSayisi: 1,
      minHeap: null,
      maxHeap: null,
      jvmler: [
        jvm({ yalnizEnvanter: true, durumKaynagi: 'ENVANTER', envanterDurumu: 'running' }),
        jvm({
          ad: 'GBFACELIFTSUBE-T1',
          nesil: 7,
          envanterUygulamasi: 'GBFACELIFTSUBE-T',
          envanterEslesmesi: 'ad-sayi',
        }),
      ],
      web: [],
      webUyari: null,
      kapasite: { cpu: 4, bellekGb: 16, os: null, osSurum: null } as JbossSunucu['kapasite'],
    } as JbossSunucu;
    const d = {
      tip: 'jboss',
      ad: 'GBFACELIFTSUBE',
      varyantlar: ['GBFACELIFTSUBE-T'],
      ozet: {
        sunucuSayisi: 1,
        ortamlar: ['TEST'],
        surumler: ['EAP 7.4'],
        jvmSayisi: 1,
        calisanJvm: 1,
        webSunucuSayisi: 0,
        toplamCpu: 4,
        toplamBellekGb: 16,
        yuk: null,
      },
      sunucular: [s],
      webSunuculari: [],
      kaynaklar: {},
    } as JbossDetay;
    render(<JbossGorunum d={d} />);
    expect(screen.getAllByText('yalnız envanterde').length).toBe(1);
    expect(screen.queryByText(/JBoss 0\b/)).toBeNull();
    expect(screen.getAllByText('JBoss 7').length).toBeGreaterThan(0);
    expect(screen.getByText('envanter: GBFACELIFTSUBE-T')).toBeTruthy();
  });

  it('JN3 bekçi: JVM satırları nesli jvmNesilEtiketi ile basar', () => {
    const oku = (p: string) =>
      fs.readFileSync(path.join(process.cwd(), 'src/components', p), 'utf8');
    for (const p of [
      'server_hub/ServerHubPage.tsx',
      'server_hub/SunucuPaneli.tsx',
      'server_hub/Uygulama360Tab.tsx',
    ]) {
      const src = oku(p);
      expect(src, p).not.toMatch(/JBoss \{j\.gen/);
      expect(src, p).not.toMatch(/JBoss \{k\.gen/);
      expect(src, p).not.toMatch(/\(JBoss \$\{j\.gen\}\)/);
      expect(src, p).toMatch(/jvmNesilEtiketi\(/);
    }
    expect(oku('app_hub/JbossGorunum.tsx')).toMatch(/YALNIZ_ENVANTER_ETIKETI/);
  });

  it('JN4 sunucu paneli: yalnız envanterdeki satır uyumsuzluk / sayı üretmez, zincirde tek rozet', () => {
    const J = (o: Record<string, unknown>) =>
      ({
        gen: 7,
        name: 'APP1',
        group: 'g',
        running: true,
        autoStart: 'true',
        serverState: 'running',
        ports: [],
        vhosts: [],
        source: 'cli',
        ...o,
      }) as unknown as ShJvm;
    // envanter: çalışıyor + auto-start kapalı (taranmış JVM olsa REBOOT_RISK koşulu)
    const env = J({
      gen: 0,
      name: 'APP',
      source: 'envanter',
      yalnizEnvanter: true,
      autoStart: 'false',
    });
    const tarama = J({});
    expect(autostartUyumsuz(env as never)).toBe(false);
    expect(autostartUyumsuz({ ...tarama, autoStart: 'false' } as never)).toBe(true);
    const d = {
      host: 'H1',
      findings: [],
      jvms: [env, tarama],
      ear: { durum: 'VAR', yasGun: 0 },
    } as unknown as ShHostDetail;
    const k = ozetKartlari(d, []);
    expect(k.find((x) => x.id === 'autostart')!.deger).toBe('yok');
    expect(k.find((x) => x.id === 'trafik')!.deger).toBe('0 aktif · 0 boşta · 1 ölçülemedi');
    expect(jvmSayisiMetni([env, tarama])).toBe('1 JVM + 1 yalnız envanterde');
    expect(jvmSayisiMetni([tarama])).toBe('1 JVM');
    const r = zincirRozetleri(d, env as never, 0, 'eslenemedi').map((x) => x.metin);
    expect(r).toEqual(['yalnız envanterde']);
    // kontrol: taranmış JVM'de çalışma rozeti basılır
    expect(zincirRozetleri(d, tarama as never, 0, 'eslenemedi').map((x) => x.metin)).toContain(
      'çalışıyor',
    );
    // bekçi: panel başlığı ve JVM sekmesi sayıyı yardımcıdan basar (çıplak kartlar.length / d.jvms.length yok)
    const oku = (f: string) =>
      fs.readFileSync(path.join(process.cwd(), 'src/components/server_hub', f), 'utf8');
    expect(oku('SunucuPaneli.tsx')).toMatch(/Uygulamalar \(\$\{jvmSayisiMetni\(/);
    expect(oku('ServerHubPage.tsx')).toMatch(/JVM · \$\{jvmSayisiMetni\(d\.jvms\)/);
  });
});
