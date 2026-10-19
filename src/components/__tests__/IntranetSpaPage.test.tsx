// src/components/__tests__/IntranetSpaPage.test.tsx — Nginx ARK SPA > Intranet SPA (2026-10-19).
//
// Kullanıcı: intranet SPA'lar kullanılıyor mu raporu + ekiplerden kullanım beyanı. Düzeltme (aynı
// gün): yük Dynatrace'ten (BMW_Application_Usage), liste OpenShift'teki intranet SPA'lar.
//   IU1 varsayılan ortam PROD; ortam düğmesiyle diğer ortamlar; özet kutuları seçili ortamdan
//   IU2 Dynatrace beş durum ayrı: istek alıyor (sayı + pencere) / almıyor / servis yok / ölçülemedi /
//       ölçüm yok — son üçü "istek almıyor" YAZMAZ
//   IU3 beyan uygulama + namespace ile gider, aynı uygulamanın diğer satırı da güncellenir, beyan
//       eden yazılır; hata toast'a çıkar
//   IU4 özet kutuları süzgeç gibi çalışır (kapatma adayı, beyan bekleyen), ikinci tıklama kaldırır
//   IU5 satır ayrıntısı: route adresleri, cluster'lar, Dynatrace penceresi / servis / not
//   IU6 Dynatrace okunamadı ve sorunlu cluster bantları; CSV ölçülemeyene sayı yazmaz
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

const DT = { scanDate: '2026-10-18', windowDays: 35, services: 2, note: '', olcum: '' };
const R = (application: string, o: Partial<IntranetSatir> = {}): IntranetSatir => ({
  env: 'PROD', namespace: 'kart-prod', application, ag: 'intranet',
  adresler: [`${application}-kart-prod.apps.fw.garanti.com.tr`], clusters: ['gbocpp1', 'gbocpp2'], eskiCluster: [],
  kapsam: { durum: 'tam', var: 2, toplam: 2 }, zayifKanit: false, adKalibi: true,
  istek: 'var', req: 1234, dynatrace: DT, ekip: ['GT-Kart'], ekipEposta: ['kart@banka.com'],
  inUse: null, inUseBy: null, inUseAt: null, note: '', degerlendirme: [], ...o,
});
function rapor(o: Partial<IntranetRapor> = {}): IntranetRapor {
  return {
    ok: true, kesifTarihi: '2026-10-18', dynatraceTarihi: '2026-10-18', dynatraceOkunamadi: false, sorunluCluster: [],
    rows: [
      R('aktif-ui'),
      R('atil-ui', { istek: 'yok', req: 0, inUse: 'no', inUseBy: 'ayse', degerlendirme: ['kapatma-adayi'] }),
      R('servissiz-ui', { istek: 'servis-yok', req: 0, dynatrace: { ...DT, services: 0 } }),
      R('yarim-ui', { istek: 'olculemedi', req: null, dynatrace: { ...DT, services: 3, note: 'servis okunamadi: 403', olcum: '1/2' } }),
      R('olcumsuz-ui', { istek: 'olcum-yok', req: null, dynatrace: null }),
      R('aktif-ui', { env: 'TEST', namespace: 'kart-prod', istek: 'var', req: 9 }),
    ],
    envs: [
      { env: 'TEST', uygulama: 1, var: 1, yok: 0, servisYok: 0, olculemedi: 0, olcumYok: 0, beyanli: 0, kapatmaAdayi: 0, celiski: 0 },
      { env: 'PROD', uygulama: 5, var: 1, yok: 1, servisYok: 1, olculemedi: 1, olcumYok: 1, beyanli: 1, kapatmaAdayi: 1, celiski: 0 },
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
    await screen.findByText('atil-ui');
    expect(govdeSatirlari()).toHaveLength(5);
    const ozet = screen.getByTestId('intranet-ozet');
    expect(within(ozet).getByRole('button', { name: /uygulama\s*5/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /TEST/ }));
    expect(govdeSatirlari()).toHaveLength(1);
    expect(within(ozet).getByRole('button', { name: /uygulama\s*1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /tüm ortamlar/ }));
    expect(govdeSatirlari()).toHaveLength(6);
  });

  it('IU2 Dynatrace beş durum ayrı', async () => {
    mockRapor.mockResolvedValue(rapor());
    render(<IntranetSpaPage />);
    await screen.findByText('atil-ui');
    expect(satirMetni('aktif-ui')).toMatch(/istek alıyor · 1\.234\s*\/ 35 gün/);
    expect(satirMetni('atil-ui')).toMatch(/istek almıyor/);
    for (const [app, metin] of [['servissiz-ui', /Dynatrace servisi yok/], ['yarim-ui', /ölçülemedi/], ['olcumsuz-ui', /ölçüm yok/]] as const) {
      expect(satirMetni(app)).toMatch(metin);
      expect(satirMetni(app)).not.toMatch(/istek almıyor/);
    }
    // ipucu Dynatrace'in notunu, kısmi ölçümü ve pencereyi söyler
    const yarim = govdeSatirlari().find((r) => r.textContent?.includes('yarim-ui'))!;
    const ipucu = within(yarim).getByText('ölçülemedi').getAttribute('title') || '';
    expect(ipucu).toMatch(/Not: servis okunamadi: 403/);
    expect(ipucu).toMatch(/Ölçülen cluster: 1\/2/);
    const aktif = govdeSatirlari().find((r) => r.textContent?.includes('aktif-ui'))!;
    expect(within(aktif).getByText(/istek alıyor/).getAttribute('title')).toMatch(/Son 35 günde 1\.234 istek/);
  });

  it('IU3 beyan uygulama seviyesinde yazılır; aynı uygulamanın diğer satırı da güncellenir; hata toast', async () => {
    mockRapor.mockResolvedValue(rapor());
    mockBeyan.mockResolvedValue({ ok: true, inUseBy: 'veli', inUseAt: '2026-10-19T08:00:00.000Z' });
    render(<IntranetSpaPage />);
    await screen.findByText('atil-ui');
    fireEvent.change(screen.getByLabelText('aktif-ui ekip beyanı'), { target: { value: 'yes' } });
    await waitFor(() => expect(mockBeyan).toHaveBeenCalledWith({ namespace: 'kart-prod', application: 'aktif-ui', inUse: 'yes', note: '' }));
    await waitFor(() => expect(satirMetni('aktif-ui')).toMatch(/veli/));
    fireEvent.click(screen.getByRole('button', { name: /tüm ortamlar/ }));
    const ikiSatir = govdeSatirlari().filter((r) => r.textContent?.includes('aktif-ui'));
    expect(ikiSatir).toHaveLength(2);
    for (const r of ikiSatir) expect(r.textContent).toMatch(/veli/);
    const hata = vi.spyOn(toast, 'error');
    mockBeyan.mockResolvedValue({ ok: false, message: 'Geçersiz beyan.' });
    fireEvent.change(screen.getByLabelText('olcumsuz-ui ekip beyanı'), { target: { value: 'no' } });
    await waitFor(() => expect(hata).toHaveBeenCalledWith('Geçersiz beyan.'));
    expect(satirMetni('olcumsuz-ui')).not.toMatch(/veli/);
    hata.mockRestore();
  });

  it('IU4 özet kutuları süzgeç gibi çalışır', async () => {
    mockRapor.mockResolvedValue(rapor());
    render(<IntranetSpaPage />);
    await screen.findByText('atil-ui');
    const ozet = screen.getByTestId('intranet-ozet');
    const kutu = within(ozet).getByRole('button', { name: /kapatma adayı/ });
    fireEvent.click(kutu);
    expect(kutu.getAttribute('aria-pressed')).toBe('true');
    expect(govdeSatirlari().map((r) => r.textContent)).toEqual([expect.stringContaining('atil-ui')]);
    fireEvent.click(kutu);
    expect(govdeSatirlari()).toHaveLength(5);
    fireEvent.click(within(ozet).getByRole('button', { name: /servis yok/ }));
    expect(govdeSatirlari().map((r) => r.textContent)).toEqual([expect.stringContaining('servissiz-ui')]);
    fireEvent.click(within(ozet).getByRole('button', { name: /servis yok/ }));
    fireEvent.click(within(ozet).getByRole('button', { name: /beyan bekleyen/ }));
    const kalan = govdeSatirlari().map((r) => r.textContent || '');
    expect(kalan).toHaveLength(4);
    expect(kalan.some((t) => t.includes('atil-ui'))).toBe(false);
  });

  it('IU5 satır ayrıntısı: route, cluster, Dynatrace ayrıntısı', async () => {
    mockRapor.mockResolvedValue(rapor());
    render(<IntranetSpaPage />);
    await screen.findByText('atil-ui');
    const satir = govdeSatirlari().find((r) => r.textContent?.includes('yarim-ui'))!;
    const dugme = within(satir).getByRole('button', { name: /yarim-ui-kart-prod\.apps\.fw\.garanti\.com\.tr/ });
    fireEvent.click(dugme);
    expect(dugme.getAttribute('aria-expanded')).toBe('true');
    const metin = document.body.textContent || '';
    expect(metin).toMatch(/gbocpp1, gbocpp2/);
    expect(metin).toMatch(/ölçülen cluster: 1\/2/);
    expect(metin).toMatch(/not: servis okunamadi: 403/);
    expect(metin).toMatch(/3 servis/);
  });

  it('IU6 Dynatrace okunamadı ve sorunlu cluster bantları; CSV ölçülemeyene sayı yazmaz', async () => {
    mockRapor.mockResolvedValue(rapor({ dynatraceOkunamadi: true, sorunluCluster: [{ cluster: 'gbocpp2', durum: 'login', sebep: 'login basarisiz' }] }));
    render(<IntranetSpaPage />);
    await screen.findByText('atil-ui');
    expect(screen.getByText(/Dynatrace kullanım verisi \(BMW_Application_Usage\) okunamadı/)).toBeTruthy();
    expect(screen.getByText(/gbocpp2 \(login: login basarisiz\)/)).toBeTruthy();
    const rows = intranetCsvSatirlari(rapor().rows!, (v) => v);
    const i = (k: (typeof INTRANET_CSV_BASLIK)[number]) => INTRANET_CSV_BASLIK.indexOf(k);
    const yarim = rows.find((r) => r[i('uygulama')] === 'yarim-ui')!;
    expect([yarim[i('dynatrace_durumu')], yarim[i('dynatrace_istek')]]).toEqual(['ölçülemedi', '']);
    const aktif = rows.find((r) => r[i('uygulama')] === 'aktif-ui')!;
    expect([aktif[i('dynatrace_istek')], aktif[i('dynatrace_gun')]]).toEqual(['1234', '35']);
    expect(rows[0]).toHaveLength(INTRANET_CSV_BASLIK.length);
  });
});
