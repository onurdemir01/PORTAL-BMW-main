// src/components/app_hub/__tests__/jboss-gorunum.test.tsx — Application Hub JBoss görünümü (2026-11-12).
// Kullanıcı: sunucu satırları ya açılmıyor ya kapanmıyor; "1 çalışıyor 1 kapalı" nasıl doğrulanır;
// JVM parametrelerinde kategori istemiyorum; özet kartları yerine ortam başına sürümler.
//   JG1 aynı host + uygulama iki kez gelse de her satır kendi başına açılır / kapanır
//   JG2 ortam özeti: ortam başına ayrı satır, sürümler ayrı rozet; satıra tıklamak tabloyu süzer
//   JG3 JVM parametreleri kategorisiz, yazıldığı sırada; durum kanıtı (kaynak + envanter) görünür
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import JbossGorunum from '@/components/app_hub/JbossGorunum';
import type { JbossDetay, JbossJvm, JbossSunucu } from '@/api/appHubApi';

vi.mock('@/components/app_hub/JvmParamDuzenle', () => ({ default: () => null }));

const jvm = (o: Partial<JbossJvm>): JbossJvm => ({
  host: 'H1', ad: 'MUSTERI', nesil: 8, grup: null, calisiyor: true, autoStart: 'true', durum: 'running', portlar: [],
  jvmArgs: '-Xmx4g -Dapp.ortam=prod -Ddb.password=*** -XX:+UseG1GC', yapilandirilanJvmArgs: null, jvmArgFarki: null,
  jvmArgDurumu: null, jvmArgKaynagi: null, istek24s: null, istek7g: null, taze: true, taramaTarihi: '2026-11-11', ...o,
});
const sunucu = (o: Partial<JbossSunucu>): JbossSunucu => ({
  host: 'H1', uygulama: 'MUSTERI', ortam: 'PROD', site: null, jbossSurum: 'EAP 7.4', nesil: 7, jdk: null, jre: '11',
  envanterDurumu: null, uygulamaYolu: null, tier: null, jvmSayisi: 1, minHeap: null, maxHeap: null, jvmler: [], web: [],
  webUyari: null, kapasite: { cpu: 4, bellekGb: 16, os: null, osSurum: null } as JbossSunucu['kapasite'], ...o,
});
function detay(sunucular: JbossSunucu[]): JbossDetay {
  return {
    tip: 'jboss', ad: 'MUSTERI', varyantlar: ['MUSTERI'],
    ozet: { sunucuSayisi: 3, ortamlar: ['PROD', 'TEST'], surumler: ['EAP 7.4', 'EAP 8.0'], jvmSayisi: 2, calisanJvm: 1, webSunucuSayisi: 2, toplamCpu: 12, toplamBellekGb: 48, yuk: null },
    sunucular, webSunuculari: [], kaynaklar: {},
  } as JbossDetay;
}
const satirlar = () => screen.getAllByTestId('sunucu-satiri');
const acikMi = (tr: HTMLElement) => tr.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded') === 'true';

describe('Application Hub — JBoss görünümü', () => {
  it('JG1 aynı host + uygulama iki satırda bile her satır bağımsız açılır / kapanır', () => {
    const d = detay([
      sunucu({ host: 'H1' }),
      sunucu({ host: 'H1' }),
      sunucu({ host: 'H2', ortam: 'TEST', jbossSurum: 'EAP 8.0' }),
    ]);
    render(<JbossGorunum d={d} />);
    const [a, b] = satirlar();
    expect(acikMi(a)).toBe(false);
    fireEvent.click(a);
    expect(acikMi(satirlar()[0])).toBe(true);
    expect(acikMi(satirlar()[1])).toBe(false);
    fireEvent.click(satirlar()[0]);
    expect(acikMi(satirlar()[0])).toBe(false);
    fireEvent.click(within(b).getByRole('button'));
    expect(acikMi(satirlar()[1])).toBe(true);
    expect(acikMi(satirlar()[0])).toBe(false);
  });

  it('JG2 ortam özeti: ortam başına satır, sürümler ayrı; tıklayınca tablo süzülür', () => {
    const d = detay([
      sunucu({ host: 'P1', jbossSurum: 'EAP 7.4' }),
      sunucu({ host: 'P2', jbossSurum: 'EAP 8.0' }),
      sunucu({ host: 'T1', ortam: 'TEST', jbossSurum: 'EAP 8.0' }),
    ]);
    render(<JbossGorunum d={d} />);
    const ortamlar = screen.getAllByTestId('ortam-satiri');
    expect(ortamlar.map((r) => r.querySelector('td')!.textContent)).toEqual(['PROD', 'TEST']);
    expect(within(ortamlar[0]).getAllByTestId('surum').map((s) => s.textContent)).toEqual(['EAP 8.01 sunucu', 'EAP 7.41 sunucu']);
    expect(within(ortamlar[1]).getAllByTestId('surum').map((s) => s.textContent)).toEqual(['EAP 8.0']);
    fireEvent.click(ortamlar[1]);
    expect(satirlar().map((r) => r.textContent)).toEqual([expect.stringContaining('T1')]);
    fireEvent.click(screen.getAllByTestId('ortam-satiri')[1]);
    expect(satirlar().length).toBe(3);
  });

  it('JG3 parametreler kategorisiz ve sırasıyla; durum kanıtı kaynak + envanter çelişkisini söyler', () => {
    const d = detay([
      sunucu({
        jvmler: [
          jvm({ durumKaynagi: 'PS', envanterDurumu: 'running' }),
          jvm({ ad: 'MUSTERI2', calisiyor: false, durumKaynagi: 'ENVANTER', envanterDurumu: 'stopped', uyumsuzluk: ['durum: envanter stopped, tarama çalışıyor'] }),
        ],
      }),
    ]);
    render(<JbossGorunum d={d} />);
    const params = screen.getAllByTestId('jvm-arglari')[0];
    expect([...params.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['-Xmx4g', '-Dapp.ortam=prod', '-Ddb.password=***', '-XX:+UseG1GC']);
    expect(screen.queryByText('Bellek')).toBeNull();
    expect(screen.getAllByText(/1 parola değeri gizli/).length).toBeGreaterThan(0);
    const kanit = screen.getAllByTestId('durum-kaniti');
    expect(kanit[0].textContent).toMatch(/süreç listesinde \(ps\) JVM süreci görüldü/);
    expect(kanit[0].textContent).toMatch(/Envanterde: running \(tarama ile aynı\)/);
    expect(kanit[1].textContent).toMatch(/yalnız JBoss uygulama envanterinden/);
    expect(kanit[1].textContent).toMatch(/tarama ile çelişiyor/);
  });
});
