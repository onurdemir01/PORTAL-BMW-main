// src/components/__tests__/IntranetSpaPage.test.tsx — Nginx ARK SPA > Intranet SPA (2026-10-19).
//
// Kullanıcı: intranet SPA'lar yük alıyor mu / kullanılıyor mu raporu + ekiplerden kullanım beyanı.
//   IU1 varsayılan ortam PROD; ortam düğmesiyle diğer ortamlar; özet kutuları seçili ortamdan
//   IU2 ölçüm üç durum: yük alıyor / yük almıyor / ölçülemedi (kısa pencere) / ölçüm yok AYRI
//   IU3 beyan: seçim uygulama + namespace ile gider, satır (ve aynı uygulamanın diğer ortam satırı)
//       güncellenir, beyan eden yazılır; hata toast'a çıkar
//   IU4 özet kutusu süzgeç gibi çalışır (kapatma adayı), ikinci tıklama kaldırır
//   IU5 sunucu ayrıntısı: sunucu başına kurulum + yük nedeni, ortamın eksik sunucusu
//   IU6 ölçüm tablosu okunamadıysa bant söyler; CSV ölçülemeyene 0 yazmaz
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import IntranetSpaPage from '@/components/IntranetSpaPage';
import { intranetCsvSatirlari, INTRANET_CSV_BASLIK } from '@/components/intranetSpa';
import type { IntranetRapor, IntranetSatir } from '@/api/arkSpaApi';
import { toast } from '@/hooks/useToast';

const mockRapor = vi.hoisted(() => vi.fn());
const mockBeyan = vi.hoisted(() => vi.fn());
vi.mock('@/api/arkSpaApi', () => ({ arkSpaApi: { intranet: mockRapor, intranetBeyan: mockBeyan } }));

const S = (host: string, o: Partial<IntranetSatir['sunucular'][number]> = {}) => ({
  host, site: 'Pendik', hys: true, app: true, conf: true, status: 'OK', confName: '', trafik: null, ...o,
});
const R = (application: string, o: Partial<IntranetSatir> = {}): IntranetSatir => ({
  env: 'PROD', namespace: 'kart-prod', application, ekip: ['GT-Kart'], ekipEposta: ['kart@banka.com'],
  sunucular: [S('GBNGXP50'), S('GBNGXP51')], eksikSunucular: [], beklenen: 2, tamSunucu: 2, sunulan: 2,
  kurulum: 'tam', ocpVar: true, yuk: null, inUse: null, inUseBy: null, inUseAt: null, note: '', degerlendirme: [], ...o,
});
const yuk = (state: 'active' | 'idle' | 'unknown', o = {}) => ({
  state, req7: state === 'active' ? 42 : 0, req24: 3, hc24: 10, lastSeen: '2026-10-18 09:00:00', firstSeen: null,
  pencereSaat: 200, sampled: false, hosts: 2, unknownHosts: 0, missingHosts: 0, ...o,
});
function rapor(o: Partial<IntranetRapor> = {}): IntranetRapor {
  return {
    ok: true, trafikTablo: 'var', hostKipi: true, dizinTarihi: '2026-10-18', trafikTarihi: '2026-10-18', taranmayan: [],
    rows: [
      R('aktif-app-v1', { yuk: yuk('active') }),
      R('atil-app-v1', { yuk: yuk('idle'), inUse: 'no', inUseBy: 'ayse', degerlendirme: ['kapatma-adayi'] }),
      R('kisa-app-v1', { yuk: yuk('unknown', { pencereSaat: 72, kismi: ['pencere'] }),
        sunucular: [S('GBNGXP50', { trafik: { durum: 'sifir-kismi', req7: 0, pencereSa: 72, kismi: ['pencere'] } }),
          S('GBNGXP51', { trafik: { durum: 'olculemedi', neden: 'log', hata: 'log dosyasi yok: /web_log/x.log' } })],
        eksikSunucular: ['GBNGXP52'], tamSunucu: 2, beklenen: 3, kurulum: 'kismi', degerlendirme: ['kurulum-eksik'] }),
      R('olcumsuz-app-v1'),
      R('aktif-app-v1', { env: 'TEST', namespace: 'kart-prod', yuk: yuk('active') }),
    ],
    envs: [
      { env: 'TEST', sunucular: ['GBNGXT50'], taranan: ['GBNGXT50'], uygulama: 1, active: 1, idle: 0, unknown: 0, olcumYok: 0, beyanli: 0, kapatmaAdayi: 0, celiski: 0 },
      { env: 'PROD', sunucular: ['GBNGXP50'], taranan: ['GBNGXP50'], uygulama: 4, active: 1, idle: 1, unknown: 1, olcumYok: 1, beyanli: 1, kapatmaAdayi: 1, celiski: 0 },
    ],
    ...o,
  };
}
const govdeSatirlari = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const satirMetni = (app: string) => govdeSatirlari().find((r) => r.textContent?.includes(app))?.textContent || '';

beforeEach(() => {
  mockRapor.mockReset();
  mockBeyan.mockReset();
});

describe('Intranet SPA', () => {
  it('IU1 varsayılan ortam PROD; ortam düğmesi; özet seçili ortamdan', async () => {
    mockRapor.mockResolvedValue(rapor());
    render(<IntranetSpaPage />);
    await screen.findByText('atil-app-v1');
    expect(govdeSatirlari()).toHaveLength(4);
    const ozet = screen.getByTestId('intranet-ozet');
    expect(within(ozet).getByRole('button', { name: /uygulama\s*4/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /TEST/ }));
    expect(govdeSatirlari()).toHaveLength(1);
    expect(within(ozet).getByRole('button', { name: /uygulama\s*1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /tüm ortamlar/ }));
    expect(govdeSatirlari()).toHaveLength(5);
  });

  it('IU2 ölçüm üç durum ayrı', async () => {
    mockRapor.mockResolvedValue(rapor());
    render(<IntranetSpaPage />);
    await screen.findByText('atil-app-v1');
    expect(satirMetni('aktif-app-v1')).toMatch(/yük alıyor · 42/);
    expect(satirMetni('atil-app-v1')).toMatch(/yük almıyor/);
    expect(satirMetni('kisa-app-v1')).toMatch(/son 3 günde istek yok \(7 gün ölçülemedi\)/);
    expect(satirMetni('kisa-app-v1')).not.toMatch(/yük almıyor/);
    expect(satirMetni('olcumsuz-app-v1')).toMatch(/ölçüm yok/);
  });

  it('IU3 beyan uygulama seviyesinde yazılır; aynı uygulamanın diğer ortam satırı da güncellenir; hata toast', async () => {
    mockRapor.mockResolvedValue(rapor());
    mockBeyan.mockResolvedValue({ ok: true, inUseBy: 'veli', inUseAt: '2026-10-19T08:00:00.000Z' });
    render(<IntranetSpaPage />);
    await screen.findByText('atil-app-v1');
    fireEvent.change(screen.getByLabelText('aktif-app-v1 ekip beyanı'), { target: { value: 'yes' } });
    await waitFor(() => expect(mockBeyan).toHaveBeenCalledWith({ namespace: 'kart-prod', application: 'aktif-app-v1', inUse: 'yes', note: '' }));
    await waitFor(() => expect(satirMetni('aktif-app-v1')).toMatch(/veli/));
    fireEvent.click(screen.getByRole('button', { name: /tüm ortamlar/ }));
    const ikiSatir = govdeSatirlari().filter((r) => r.textContent?.includes('aktif-app-v1'));
    expect(ikiSatir).toHaveLength(2);
    for (const r of ikiSatir) expect(r.textContent).toMatch(/veli/);
    const hata = vi.spyOn(toast, 'error');
    mockBeyan.mockResolvedValue({ ok: false, message: 'Geçersiz beyan.' });
    fireEvent.change(screen.getAllByLabelText('olcumsuz-app-v1 ekip beyanı')[0], { target: { value: 'no' } });
    await waitFor(() => expect(hata).toHaveBeenCalledWith('Geçersiz beyan.'));
    expect(satirMetni('olcumsuz-app-v1')).not.toMatch(/veli/);
    hata.mockRestore();
  });

  it('IU4 özet kutusu süzgeç gibi çalışır', async () => {
    mockRapor.mockResolvedValue(rapor());
    render(<IntranetSpaPage />);
    await screen.findByText('atil-app-v1');
    const kutu = within(screen.getByTestId('intranet-ozet')).getByRole('button', { name: /kapatma adayı/ });
    fireEvent.click(kutu);
    expect(kutu.getAttribute('aria-pressed')).toBe('true');
    expect(govdeSatirlari().map((r) => r.textContent)).toEqual([expect.stringContaining('atil-app-v1')]);
    fireEvent.click(kutu);
    expect(govdeSatirlari()).toHaveLength(4);
    // beyan bekleyen: yalniz beyani OLMAYAN satirlar
    fireEvent.click(within(screen.getByTestId('intranet-ozet')).getByRole('button', { name: /beyan bekleyen/ }));
    const kalan = govdeSatirlari().map((r) => r.textContent || '');
    expect(kalan).toHaveLength(3);
    expect(kalan.some((t) => t.includes('atil-app-v1'))).toBe(false);
  });

  it('IU5 sunucu ayrıntısı: kurulum, yük nedeni, eksik sunucu', async () => {
    mockRapor.mockResolvedValue(rapor());
    render(<IntranetSpaPage />);
    await screen.findByText('atil-app-v1');
    const satir = govdeSatirlari().find((r) => r.textContent?.includes('kisa-app-v1'))!;
    const dugme = within(satir).getByRole('button', { name: /2\/3\s*tam kurulu/ });
    fireEvent.click(dugme);
    expect(dugme.getAttribute('aria-expanded')).toBe('true');
    const metin = document.body.textContent || '';
    expect(metin).toMatch(/log okunamadı: log dosyasi yok/);
    expect(metin).toMatch(/GBNGXP52\s*bu sunucuda uygulama yok/);
  });

  it('IU6 ölçüm okunamadı bandı; CSV ölçülemeyene sayı yazmaz', async () => {
    mockRapor.mockResolvedValue(rapor({ trafikTablo: 'okunamadi' }));
    render(<IntranetSpaPage />);
    await screen.findByText('atil-app-v1');
    expect(screen.getByText(/Yük ölçümü okunamadı/)).toBeTruthy();
    const rows = intranetCsvSatirlari(rapor().rows!, (v) => v);
    const i = (k: (typeof INTRANET_CSV_BASLIK)[number]) => INTRANET_CSV_BASLIK.indexOf(k);
    const olcumsuz = rows.find((r) => r[i('uygulama')] === 'olcumsuz-app-v1')!;
    expect([olcumsuz[i('yuk_durumu')], olcumsuz[i('istek_7g')]]).toEqual(['ölçüm yok', '']);
    const kisa = rows.find((r) => r[i('uygulama')] === 'kisa-app-v1')!;
    expect(kisa[i('eksik_sunucular')]).toBe('GBNGXP52');
    expect(rows[0]).toHaveLength(INTRANET_CSV_BASLIK.length);
  });
});
