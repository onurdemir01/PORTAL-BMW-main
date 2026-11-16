// src/components/app_hub/__tests__/retirement-hap.test.tsx — Application Hub: Retirement ile durdurulmuş JVM (2026-11-16).
// Kullanıcı: "Retirement job'ına girmiş JBoss uygulamaları neden kritik durumda görünüyor?"
// Karar sunucuda (veri.cjs): `kapatildi` (STOP / silme yapıldı) ve `celiski` (Server Hub'ın STOP SONRASI
// taramayla kanıtladığı neden). Ekran tarih karşılaştırmaz; JVM hapı, sunucu satırı ve ortam özeti TEK
// kuralı (retireDurumu) kullanır.
//   RH1 kapalı + kapatılmış hedef: gri "Retire edildi"; STOP günü kurum saat diliminde (gece STOP'u kaymaz)
//   RH2 Server Hub kanıtlı çelişki kırmızı (çalışan ya da kapalı + auto-start açık); STOP tarihi bilinmese de
//   RH2b kanıtsız çalışan (STOP günü / öncesi tarama, gece STOP'u) sarı "doğrulama bekliyor"
//   RH3 retirement yok ya da hedef kapatılmamış (pending / active / failed / rolling_back / rollback_failed /
//       deleting): kapalı JVM kırmızı "Kapalı", çalışan yeşil (eski davranış)
//   RH4 sunucu satırı: retire edilmiş JVM "N kapalı"ya girmez, ayrı nötr "N retire"; çelişki kırmızı
//   RH4b sunucu satırı JVM hapıyla aynı kural: kanıtsız çalışan satırda da sarı, kırmızı yok
//   RH5 ortam özeti: aynı ayrım; çelişki kırmızı, doğrulama sarı
//   RH6 retirement okunamadı: kaynak uyarısı görünür, kapalı JVM kırmızı kalır ve "bilinmiyor" der
import { describe, it, expect, vi } from 'vitest';
import { screen, within, render as rtlRender } from '@testing-library/react';
import { render } from '@/test/test-utils';
import JbossGorunum from '@/components/app_hub/JbossGorunum';
import { CalismaHap } from '@/components/app_hub/ortak';
import { ortamGruplari } from '@/components/app_hub/OrtamOzeti';
import type { JbossDetay, JbossJvm, JbossRetirement, JbossSunucu } from '@/api/appHubApi';

vi.mock('@/components/app_hub/JvmParamDuzenle', () => ({ default: () => null }));

// Gece STOP'u: 2026-10-13T22:30Z = yerel 14.10.2026 01:30 (UTC günü bir gün geride).
const STOP: JbossRetirement = {
  kayit: 24,
  hedef: 71,
  durum: 'stopped',
  kapatildi: true,
  durduruldu: '2026-10-13T22:30:00.000Z',
  celiski: [],
};
const CELISKI: JbossRetirement = { ...STOP, celiski: ['calisiyor'] };
const jvm = (o: Partial<JbossJvm>): JbossJvm => ({
  host: 'H1',
  ad: 'MUSTERI',
  nesil: 8,
  grup: null,
  calisiyor: true,
  autoStart: 'false',
  durum: null,
  portlar: [],
  jvmArgs: null,
  yapilandirilanJvmArgs: null,
  jvmArgFarki: null,
  jvmArgDurumu: null,
  jvmArgKaynagi: null,
  istek24s: null,
  istek7g: null,
  taze: true,
  taramaTarihi: '2026-11-15',
  retirement: null,
  ...o,
});
const sunucu = (o: Partial<JbossSunucu>): JbossSunucu => ({
  host: 'H1',
  uygulama: 'MUSTERI',
  ortam: 'PROD',
  site: null,
  jbossSurum: 'EAP 8.0',
  nesil: 8,
  jdk: null,
  jre: '17',
  envanterDurumu: null,
  uygulamaYolu: null,
  tier: null,
  jvmSayisi: 1,
  minHeap: null,
  maxHeap: null,
  jvmler: [],
  web: [],
  webUyari: null,
  kapasite: null,
  ...o,
});
function detay(sunucular: JbossSunucu[], kaynaklar: JbossDetay['kaynaklar'] = {}): JbossDetay {
  return {
    tip: 'jboss',
    ad: 'MUSTERI',
    varyantlar: ['MUSTERI'],
    ozet: {
      sunucuSayisi: 1,
      ortamlar: ['PROD'],
      surumler: ['EAP 8.0'],
      jvmSayisi: 1,
      calisanJvm: 0,
      webSunucuSayisi: 0,
      toplamCpu: null,
      toplamBellekGb: null,
      yuk: null,
    },
    sunucular,
    webSunuculari: [],
    kaynaklar,
  } as JbossDetay;
}
const hap = (metin: string | RegExp) => screen.getByText(metin);
const renk = (el: HTMLElement) => el.style.color;
const hucre = (tr: HTMLElement) => tr.querySelectorAll('td')[5] as HTMLElement;
const spanlar = (el: HTMLElement) => [...el.querySelectorAll('span')] as HTMLElement[];
const metinli = (el: HTMLElement, m: string) => spanlar(el).find((s) => s.textContent === m)!;

describe('Application Hub — Retirement ile durdurulmuş JVM', () => {
  it('RH1 kapalı + kapatılmış hedef: gri "Retire edildi"; STOP günü kurum gününde (gece STOP\'u 14.10)', () => {
    rtlRender(<CalismaHap calisiyor={false} retirement={STOP} />);
    const h = hap('Retire edildi');
    expect(renk(h)).toBe('var(--status-neutral)');
    expect(h.getAttribute('title')).toMatch(/^Retirement #24 · STOP 14\.10\.2026: /);
    expect(screen.queryByText('Kapalı')).toBeNull();
  });

  it('RH1b silinmiş hedef de "Retire edildi" (title "silindi" der)', () => {
    rtlRender(<CalismaHap calisiyor={false} retirement={{ ...STOP, durum: 'deleted' }} />);
    expect(hap('Retire edildi').getAttribute('title')).toMatch(
      /Retirement #24 · STOP 14\.10\.2026 · silindi/,
    );
  });

  it('RH2 Server Hub kanıtlı çelişki kırmızı: çalışan JVM, STOP tarihi bilinmese de; kapalı + auto-start açık', () => {
    const u1 = rtlRender(<CalismaHap calisiyor retirement={CELISKI} />);
    const h = hap('Çalışıyor · Retirement ile çelişki');
    expect(renk(h)).toBe('var(--status-danger)');
    expect(h.getAttribute('title')).toMatch(
      /Retirement #24 · STOP 14\.10\.2026 ama STOP sonrası Server Hub taramasında: JVM çalışıyor/,
    );
    u1.unmount();
    // Canlı okuma düştü (durduruldu null): Server Hub kararı yine kırmızı.
    const u2 = rtlRender(<CalismaHap calisiyor retirement={{ ...CELISKI, durduruldu: null }} />);
    expect(renk(hap('Çalışıyor · Retirement ile çelişki'))).toBe('var(--status-danger)');
    u2.unmount();
    rtlRender(<CalismaHap calisiyor={false} retirement={{ ...STOP, celiski: ['autostart'] }} />);
    const k = hap('Kapalı · Retirement ile çelişki');
    expect(renk(k)).toBe('var(--status-danger)');
    expect(k.getAttribute('title')).toMatch(/auto-start AÇIK/);
    expect(screen.queryByText('Retire edildi')).toBeNull();
  });

  it('RH2b kanıtsız çalışan (Server Hub doğrulamadı: STOP günü / öncesi tarama) sarı, kırmızı değil', () => {
    rtlRender(<CalismaHap calisiyor retirement={STOP} />);
    const h = hap('Çalışıyor · doğrulama bekliyor');
    expect(renk(h)).toBe('var(--status-warning-text)');
    expect(h.getAttribute('title')).toMatch(/STOP sonrası taramayla doğrulamadı/);
    expect(screen.queryByText(/Retirement ile çelişki/)).toBeNull();
  });

  it('RH3 retirement yok ya da hedef kapatılmamış: kapalı JVM kırmızı "Kapalı"; çalışan yeşil (eski davranış)', () => {
    const { unmount } = rtlRender(<CalismaHap calisiyor={false} />);
    expect(renk(hap('Kapalı'))).toBe('var(--status-danger)');
    expect(hap('Kapalı').getAttribute('title')).toBeNull();
    unmount();
    for (const durum of [
      'pending',
      'active',
      'failed',
      'rolling_back',
      'rollback_failed',
      'deleting',
    ]) {
      const r: JbossRetirement = { ...STOP, durum, kapatildi: false, celiski: [] };
      const u = rtlRender(<CalismaHap calisiyor={false} retirement={r} />);
      expect(renk(hap('Kapalı')), durum).toBe('var(--status-danger)');
      u.unmount();
    }
    // Ekran durumu yeniden yorumlamaz: kapatildi false ise 'stopped' yazsa da gri olmaz.
    const u3 = rtlRender(
      <CalismaHap calisiyor={false} retirement={{ ...STOP, kapatildi: false }} />,
    );
    expect(renk(hap('Kapalı'))).toBe('var(--status-danger)');
    u3.unmount();
    rtlRender(
      <CalismaHap calisiyor retirement={{ ...STOP, durum: 'pending', kapatildi: false }} />,
    );
    expect(renk(hap('Çalışıyor'))).toBe('var(--status-success)');
  });

  it('RH4 sunucu satırı: retire edilmiş kapalı JVM "kapalı" sayılmaz, ayrı nötr "N retire"; çelişki kırmızı', () => {
    const d = detay([
      sunucu({
        host: 'H1',
        jvmler: [
          jvm({ calisiyor: false, retirement: STOP }),
          jvm({ ad: 'MUSTERI2', calisiyor: false, retirement: STOP }),
        ],
      }),
      sunucu({
        host: 'H2',
        jvmler: [
          jvm({ host: 'H2', calisiyor: false, retirement: STOP }),
          jvm({ host: 'H2', ad: 'MUSTERI2', calisiyor: false }),
        ],
      }),
      sunucu({ host: 'H3', jvmler: [jvm({ host: 'H3', calisiyor: true, retirement: CELISKI })] }),
    ]);
    render(<JbossGorunum d={d} />);
    const [h1, h2, h3] = screen.getAllByTestId('sunucu-satiri');
    expect(hucre(h1).textContent).toContain('2 retire');
    expect(hucre(h1).textContent).not.toMatch(/kapalı/);
    expect(spanlar(hucre(h1)).some((s) => s.style.color === 'var(--status-danger)')).toBe(false);
    expect(renk(metinli(hucre(h2), '1 kapalı'))).toBe('var(--status-danger)');
    expect(renk(metinli(hucre(h2), '1 retire'))).toBe('var(--status-neutral)');
    expect(hucre(h3).textContent).toContain('1 çalışıyor');
    expect(renk(metinli(hucre(h3), '1 Retirement çelişkisi'))).toBe('var(--status-danger)');
    // Çalışan JVM "retire" sayılmaz, kapalı sayısı negatife düşmez.
    expect(hucre(h3).textContent).not.toMatch(/retire\b|kapalı/);
  });

  it('RH4b sunucu satırı JVM hapıyla aynı kural: kanıtsız çalışan satırda da sarı, kırmızı yok', () => {
    render(
      <JbossGorunum
        d={detay([sunucu({ jvmler: [jvm({ calisiyor: true, retirement: STOP })] })])}
      />,
    );
    const satir = screen.getByTestId('sunucu-satiri');
    expect(renk(metinli(hucre(satir), '1 doğrulama bekliyor'))).toBe('var(--status-warning-text)');
    expect(spanlar(hucre(satir)).some((s) => s.style.color === 'var(--status-danger)')).toBe(false);
    // Tek sunucu: satır açık, JVM hapı da sarı.
    expect(renk(screen.getByText('Çalışıyor · doğrulama bekliyor'))).toBe(
      'var(--status-warning-text)',
    );
    expect(screen.queryByText(/Retirement ile çelişki|Retirement çelişkisi/)).toBeNull();
  });

  it('RH5 ortam özeti: retire edilmiş kapalı JVM kırmızı "kapalı"ya girmez; çelişki kırmızı, doğrulama sarı', () => {
    const g = ortamGruplari([
      {
        host: 'H1',
        ortam: 'PROD',
        surum: null,
        java: null,
        kapasite: null,
        jvmler: [
          { calisiyor: false, retirement: STOP },
          { calisiyor: false, retirement: { ...STOP, durum: 'deleted' } },
        ],
      },
      {
        host: 'H2',
        ortam: 'PROD',
        surum: null,
        java: null,
        kapasite: null,
        jvmler: [
          { calisiyor: false },
          { calisiyor: true, retirement: STOP },
          { calisiyor: true, retirement: CELISKI },
          { calisiyor: null },
          // Çalışması ölçülemeyen JVM retire edilmiş hedefe bağlı olsa da "ölçülemedi" (retire değil).
          { calisiyor: null, retirement: STOP },
        ],
      },
    ]);
    expect(g).toHaveLength(1);
    expect({
      calisan: g[0].calisan,
      kapali: g[0].kapali,
      retire: g[0].retire,
      celiski: g[0].celiski,
      dogrulama: g[0].dogrulama,
      olculemedi: g[0].olculemedi,
    }).toEqual({ calisan: 2, kapali: 1, retire: 2, celiski: 1, dogrulama: 1, olculemedi: 2 });

    render(
      <JbossGorunum
        d={detay([
          sunucu({
            jvmler: [
              jvm({ calisiyor: false, retirement: STOP }),
              jvm({ ad: 'B', calisiyor: false, retirement: STOP }),
              jvm({ ad: 'C', calisiyor: true, retirement: CELISKI }),
              jvm({ ad: 'D', calisiyor: true, retirement: STOP }),
            ],
          }),
        ])}
      />,
    );
    const satir = screen.getByTestId('ortam-satiri');
    expect(satir.textContent).toContain('2 / 4 çalışıyor');
    expect(screen.getByTestId('ortam-retire').textContent).toBe('2 retire');
    expect(renk(screen.getByTestId('ortam-retire'))).toBe('var(--text-muted)');
    expect(screen.queryByTestId('ortam-kapali')).toBeNull();
    expect(screen.getByTestId('ortam-celiski').textContent).toBe('1 Retirement çelişkisi');
    expect(renk(screen.getByTestId('ortam-celiski'))).toBe('var(--status-danger)');
    expect(screen.getByTestId('ortam-dogrulama').textContent).toBe('1 doğrulama bekliyor');
    expect(renk(screen.getByTestId('ortam-dogrulama'))).toBe('var(--status-warning-text)');
  });

  it('RH5b ortam özeti: retire edilmemiş kapalı JVM kırmızı "kapalı" olarak kalır', () => {
    render(
      <JbossGorunum
        d={detay([
          sunucu({
            jvmler: [
              jvm({ calisiyor: false }),
              jvm({ ad: 'B', calisiyor: false, retirement: STOP }),
            ],
          }),
        ])}
      />,
    );
    expect(screen.getByTestId('ortam-kapali').textContent).toBe('1 kapalı');
    expect(renk(screen.getByTestId('ortam-kapali'))).toBe('var(--status-danger)');
    expect(screen.getByTestId('ortam-retire').textContent).toBe('1 retire');
  });

  it('RH6 retirement okunamadı: kaynak uyarısı görünür; kapalı JVM kırmızı kalır ve "bilinmiyor" der', () => {
    const d = detay([sunucu({ jvmler: [jvm({ calisiyor: false, retirement: null })] })], {
      retirement: { hata: 'Portal DB bağlantısı yok', okunamadi: true },
    });
    render(<JbossGorunum d={d} />);
    expect(screen.getByRole('alert').textContent).toMatch(
      /Retirement kayıtları okunamadı\..*Portal DB bağlantısı yok/,
    );
    const kapali = screen.getAllByText('Kapalı')[0];
    expect(renk(kapali)).toBe('var(--status-danger)');
    expect(kapali.getAttribute('title')).toMatch(
      /Retirement kayıtları okunamadı: bu JVM Retirement ile durdurulmuş olabilir \(bilinmiyor\)/,
    );
    const satirKapali = within(screen.getByTestId('sunucu-satiri')).getByText('1 kapalı');
    expect(satirKapali.getAttribute('title')).toMatch(/Retirement kayıtları okunamadı/);
  });
});
