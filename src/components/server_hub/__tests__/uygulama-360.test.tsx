// src/components/server_hub/__tests__/uygulama-360.test.tsx — Server Hub > Uygulama 360 (2026-11-07).
//
//   UA1 basit başlar (6 kolon); "Ayrıntılı kolonlar" bütün ölçümleri açar, tercih kalır
//   UA2 hızlı çipler sayılı ve süzer
//   UA3 Ortamlar kolonu çok değerli: tek ortama göre süzülür
//   UA4 satır açılınca ortam × sunucu matrisi (rozetler, Retirement); sunucuya tıklayınca panel; 409 listeyi tazeler
//   UA5 okunamayan kaynak bandı; OpenShift "okunamadı" ("yok" değil)
//   UA6 liste okunamazsa LoadError + yeniden dene
//   UA7 saf yardımcılar: ortam rozeti tonu, kopya rozetleri, matris sırası, çip sayıları
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { Sh360Kopya, Sh360Ozet, Sh360Sonuc } from '@/api/serverHubApi';

const m = vi.hoisted(() => ({
  uygulamalar360: vi.fn(),
  uygulama360: vi.fn(),
  retireEtiketleri: vi.fn(),
  iliskiKarar: vi.fn(),
}));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/server_hub/SunucuPaneli', () => ({
  default: ({ host }: { host: string }) => <div data-testid="panel-taklit">panel {host}</div>,
}));

import Uygulama360Tab from '@/components/server_hub/Uygulama360Tab';
import {
  kopyaRozetleri,
  matris,
  ocpMetni,
  ortamRozeti,
  u360Say,
  u360Suz,
} from '@/components/server_hub/uygulama360';

const oz = (ad: string, o: Partial<Sh360Ozet> = {}): Sh360Ozet => ({
  anahtar: ad.toUpperCase(),
  ad,
  ortamlar: [{ ortam: 'PROD', toplam: 2, acik: 2, kapali: 0, olculemedi: 0 }],
  kopyaSayisi: 2,
  sunucuSayisi: 2,
  nesiller: [7],
  tier: ['2'],
  calisan: 2,
  kapali: 0,
  olculemeyen: 0,
  autostartUyumsuz: 0,
  kopyaTutarsiz: 0,
  kalinti: 0,
  celiski: 0,
  riskliKopya: 0,
  trafik: 'ACTIVE',
  istek7g: 120,
  ear: { sayi: 1, war: 2, olculmeyenKopya: 0 },
  deployment: null,
  ocp: null,
  retirement: [],
  etiket: null,
  sonTarama: '2026-11-07',
  bayatKopya: 0,
  ...o,
});
const kop = (host: string, o: Partial<Sh360Kopya> = {}): Sh360Kopya => ({
  host,
  ortam: 'PROD',
  gen: 7,
  ad: 'pay',
  calisiyor: true,
  autoStart: 'true',
  autostartUyumsuz: null,
  trafik: 'ACTIVE',
  istek7g: 10,
  tier: '2',
  taze: true,
  taramaTarihi: '2026-11-07',
  hostClass: 'genel',
  retirement: [],
  capraz: null,
  ear: [],
  deployment: null,
  ...o,
});
const PAY = oz('pay', {
  ortamlar: [
    { ortam: 'PROD', toplam: 2, acik: 1, kapali: 1, olculemedi: 0 },
    { ortam: 'TEST', toplam: 1, acik: 1, kapali: 0, olculemedi: 0 },
  ],
  kopyaSayisi: 3,
  autostartUyumsuz: 1,
  kopyaTutarsiz: 1,
  celiski: 1,
  riskliKopya: 1,
  ocp: {
    yerler: [{ namespace: 'pay-prod', cluster: 'c1' }],
    yerSayisi: 2,
    istek: 150,
    tasinmisOlabilir: true,
  },
  retirement: [{ kayit: 4, hedef: 9, durum: 'stopped', host: 'P2' }],
  etiket: { seviye: 'SUPHELI', kurallar: ['R8', 'R9', 'R12'], sayi: 1, bekleyen: 1, hazir: 0 },
});
const LEGACY = oz('legacy', {
  ortamlar: [{ ortam: 'TEST', toplam: 1, acik: 1, kapali: 0, olculemedi: 0 }],
  kalinti: 1,
  riskliKopya: 1,
  etiket: { seviye: 'SUPHELI', kurallar: ['R10'], sayi: 1, bekleyen: 1, hazir: 0 },
});
const SAKIN = oz('sakin');
const sonuc = (o: Partial<Sh360Sonuc> = {}): Sh360Sonuc => ({
  ok: true,
  latestScan: '2026-11-07',
  capraz: {
    ocp: { okunamadi: false, uygulama: 3 },
    kullanim: { okunamadi: false, olcum: 3 },
    retirement: { okunamadi: false, hedef: 1 },
  },
  ear: { okunamadi: false, hostSayisi: 3 },
  uygulamalar: [PAY, LEGACY, SAKIN],
  ...o,
});
const btn = (ad: string | RegExp) => screen.getByRole('button', { name: ad });

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  m.uygulamalar360.mockResolvedValue(sonuc());
  m.retireEtiketleri.mockResolvedValue({ ok: true, kurallar: [], etiketler: [], ozet: {} });
  m.iliskiKarar.mockRejectedValue(
    Object.assign(new Error('Uygulama artık grafikte yok ya da kopyası yok.'), { status: 409 }),
  );
});

describe('Uygulama 360', () => {
  it('UA1 basit başlar; "Ayrıntılı kolonlar" ölçümleri açar ve tercih kalır', async () => {
    const { unmount } = render(<Uygulama360Tab />);
    await screen.findByText('1–3 / 3');
    const basliklar = () =>
      screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/ⓘ/g, '').trim());
    for (const b of ['Uygulama', 'Ortamlar', 'Etiket', 'Risk', 'OpenShift', 'Retirement'])
      expect(basliklar().some((x) => x?.startsWith(b))).toBe(true);
    expect(basliklar().some((x) => x?.startsWith('Deployment'))).toBe(false);
    expect(screen.getByText('PROD 1/2')).toBeInTheDocument();
    expect(screen.getByText('taşınmış olabilir')).toBeInTheDocument();
    expect(screen.getByText('#4 · DURDURULDU')).toBeInTheDocument();
    fireEvent.click(btn('Ayrıntılı kolonlar'));
    expect(btn('Ayrıntılı kolonlar')).toHaveAttribute('aria-pressed', 'true');
    for (const b of ['Deployment', 'JBoss trafik', 'Auto-start uyumsuz', 'OpenShift istek'])
      expect(basliklar().some((x) => x?.startsWith(b))).toBe(true);
    unmount();
    render(<Uygulama360Tab />);
    await screen.findByText('1–3 / 3');
    expect(btn('Ayrıntılı kolonlar')).toHaveAttribute('aria-pressed', 'true');
  });

  it('UA2 hızlı çipler sayılı ve süzer', async () => {
    render(<Uygulama360Tab />);
    await screen.findByText('1–3 / 3');
    fireEvent.click(btn(/^retire adayı 2/));
    expect(screen.getByText('1–2 / 2')).toBeInTheDocument();
    fireEvent.click(btn(/^auto-start uyumsuz 1/));
    expect(screen.getByText('1–1 / 1')).toBeInTheDocument();
    expect(screen.getByText('pay')).toBeInTheDocument();
    fireEvent.click(btn(/^prod’da yok, test yaşıyor 1/));
    expect(screen.getByText('legacy')).toBeInTheDocument();
    fireEvent.click(btn(/^OpenShift’te de var 1/));
    fireEvent.click(btn(/^Retirement’ta \/ çelişkili 1/));
    expect(screen.getByText('pay')).toBeInTheDocument();
    fireEvent.click(btn(/^hepsi 3/));
    expect(screen.getByText('1–3 / 3')).toBeInTheDocument();
  });

  it('UA3 Ortamlar kolonu çok değerli: tek ortama göre süzülür', async () => {
    render(<Uygulama360Tab />);
    await screen.findByText('1–3 / 3');
    fireEvent.click(btn('Ortamlar süz'));
    const d = await screen.findByRole('dialog', { name: 'Ortamlar süzgeci' });
    fireEvent.click(await within(d).findByLabelText('Ortamlar: TEST'));
    fireEvent.click(within(d).getByRole('button', { name: 'Uygula' }));
    expect(screen.getByText('1–2 / 2')).toBeInTheDocument();
    expect(screen.queryByText('sakin')).toBeNull();
  });

  it('UA4 satır açılınca matris; sunucuya tıklayınca panel; 409 listeyi tazeler', async () => {
    m.uygulama360.mockResolvedValue({
      ok: true,
      uygulama: {
        ...PAY,
        kopyalar: [
          kop('P1', { capraz: { kopya: null, kalinti: null, ocp: null, celiski: [] } }),
          kop('P2', {
            calisiyor: false,
            autostartUyumsuz: 'STOPPED_AUTOSTART_ON',
            retirement: [{ kayit: 4, hedef: 9, durum: 'stopped' }],
            capraz: {
              kopya: { nedenler: ['calisma'], digerleri: [], kopyaSayisi: 2 },
              kalinti: null,
              ocp: null,
              celiski: [{ kayit: 4, hedef: 9, durum: 'stopped', nedenler: ['autostart'] }],
            },
          }),
          kop('T1', { ortam: 'TEST', ad: 'pay-T', taze: false, taramaTarihi: '2026-11-01' }),
        ],
        etiketler: [],
      },
    });
    render(<Uygulama360Tab />);
    await screen.findByText('1–3 / 3');
    fireEvent.click(screen.getByText('pay'));
    const a = await screen.findByTestId('uygulama-360-ayrinti');
    expect(m.uygulama360).toHaveBeenCalledWith('PAY');
    // Retirement Analizi rozeti: ayni taban ad anahtari; 409 "yok" diye yazilir (okunamadi degil)
    expect(
      await within(a).findByText('Uygulama artık grafikte yok ya da kopyası yok.'),
    ).toBeInTheDocument();
    expect(m.iliskiKarar).toHaveBeenCalledWith('app:PAY');
    const p2 = within(a).getByRole('button', { name: 'P2 sunucu paneli' });
    for (const t of [
      'kapalı',
      'auto-start açık',
      'kopyalardan farklı',
      'Retirement ile çelişiyor',
      '#4 · DURDURULDU',
    ])
      expect(within(p2).getByText(t)).toBeInTheDocument();
    expect(within(a).getByText('bayat (2026-11-01)')).toBeInTheDocument();
    expect(within(a).getByText(/P2: #4 STOP edildi ama auto-start açık/)).toBeInTheDocument();
    // Etiket verisi yalnız sunucu paneli açılınca iner.
    expect(m.retireEtiketleri).not.toHaveBeenCalled();
    fireEvent.click(p2);
    expect(p2).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTestId('panel-taklit')).toHaveTextContent('panel P2');
    await waitFor(() => expect(m.retireEtiketleri).toHaveBeenCalledTimes(1));
    fireEvent.click(p2);
    expect(screen.queryByTestId('panel-taklit')).toBeNull();

    // 409: uygulama artık listede yok -> mesaj + liste tazelenir.
    m.uygulama360.mockResolvedValue({
      ok: false,
      message: 'legacy artık listede yok',
      _httpStatus: 409,
    });
    fireEvent.click(screen.getByText('legacy'));
    expect(await screen.findByText('legacy artık listede yok')).toBeInTheDocument();
    await waitFor(() => expect(m.uygulamalar360).toHaveBeenLastCalledWith(true));
  });

  it('UA5 okunamayan kaynak bandı; OpenShift "okunamadı" yazar', async () => {
    m.uygulamalar360.mockResolvedValue(
      sonuc({
        capraz: {
          ocp: { okunamadi: true, hata: 'x', uygulama: 0 },
          kullanim: { okunamadi: false, olcum: 0 },
          retirement: { okunamadi: true, hata: 'y', hedef: 0 },
        },
        uygulamalar: [SAKIN],
      }),
    );
    render(<Uygulama360Tab />);
    expect(
      await screen.findByText(/Okunamayan kaynak: OpenShift envanteri .*Retirement kayıtları/),
    ).toBeInTheDocument();
    expect(screen.getByText('okunamadı')).toBeInTheDocument();
  });

  it('UA6 liste okunamazsa LoadError ve yeniden dene', async () => {
    m.uygulamalar360.mockResolvedValueOnce({
      ok: false,
      message: 'Server Hub okunamadı',
      uygulamalar: [],
    });
    render(<Uygulama360Tab />);
    expect(await screen.findByText('Server Hub okunamadı')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene|Yeniden dene/ }));
    expect(await screen.findByText('1–3 / 3')).toBeInTheDocument();
  });
});

describe('UA7 saf yardımcılar', () => {
  it('ortam rozeti, kopya rozetleri, matris, çip sayıları', () => {
    expect(ortamRozeti({ ortam: 'PROD', toplam: 2, acik: 2, kapali: 0, olculemedi: 0 }).ton).toBe(
      'iyi',
    );
    expect(ortamRozeti({ ortam: 'PROD', toplam: 2, acik: 0, kapali: 2, olculemedi: 0 }).ton).toBe(
      'kotu',
    );
    expect(ortamRozeti({ ortam: 'PROD', toplam: 2, acik: 1, kapali: 1, olculemedi: 0 }).ton).toBe(
      'uyari',
    );
    expect(ortamRozeti({ ortam: 'PROD', toplam: 2, acik: 2, kapali: 0, olculemedi: 1 }).ton).toBe(
      'notr',
    );
    const r = kopyaRozetleri(kop('P1', { calisiyor: null, autoStart: 'false' }));
    expect(r.map((x) => x.metin)).toEqual(['ölçülemedi', 'auto-start kapalı', 'trafik var']);
    expect(r[1].ton).toBe('notr');
    expect(
      kopyaRozetleri(kop('P1', { autostartUyumsuz: 'REBOOT_RISK', autoStart: 'false' }))[1].ton,
    ).toBe('kotu');
    expect(
      matris([kop('P1'), kop('T1', { ortam: 'TEST' }), kop('P1', { gen: 8 }), kop('P2')]).map(
        (s) => `${s.ortam}:${s.hucreler.map((h) => `${h.host}x${h.kopyalar.length}`).join(',')}`,
      ),
    ).toEqual(['PROD:P1x2,P2x1', 'TEST:T1x1']);
    // Retirement çipi: kaydı olmasa da kayıtla çelişen uygulama.
    expect(u360Suz([oz('c', { celiski: 1 }), SAKIN], 'retirement').map((u) => u.ad)).toEqual(['c']);
    // OpenShift süzgeç değeri: okunamadıysa "okunamadı", "yok" değil.
    expect([ocpMetni(SAKIN, true), ocpMetni(SAKIN, false), ocpMetni(PAY, true)]).toEqual([
      'okunamadı',
      'yok',
      'taşınmış olabilir',
    ]);
    expect(u360Say([PAY, LEGACY, SAKIN])).toEqual({
      hepsi: 3,
      retire: 2,
      autostart: 1,
      kopya: 1,
      kalinti: 1,
      ocp: 1,
      retirement: 1,
    });
  });
});
