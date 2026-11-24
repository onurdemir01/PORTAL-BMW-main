// @vitest-environment jsdom
// Nginx Hub > CIS (2026-11-24, kapsam PR-2): tarama yok, ozet, sunucu / madde gorunumleri (arama, suzgec,
// siralama), yeniden tarama + is takibi, sunucu detayi (istisna / referans), madde detayi (olculen degerden
// referans, istisna), kural penceresi (dogrulama, kaydet sonucu), kural listeleri, CSV ve hata yollari.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NcCisHostDetail, NcCisHostRow, NcCisItemRow, NcCisOverview } from '@/api/nginxCisApi';

const api = vi.hoisted(() => ({
  overview: vi.fn(),
  rescan: vi.fn(),
  jobStatus: vi.fn(),
  host: vi.fn(),
  setException: vi.fn(),
  setOverride: vi.fn(),
  clearException: vi.fn(),
  clearOverride: vi.fn(),
}));
vi.mock('@/api/nginxCisApi', async (asil) => ({
  ...(await asil<typeof import('@/api/nginxCisApi')>()),
  nginxCisApi: api,
}));
const is = vi.hoisted(() => ({ addJob: vi.fn() }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => is }));
const tost = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useToast', () => tost);

import { CisTab } from '../CisTab';

const hostRow = (ek: Partial<NcCisHostRow>): NcCisHostRow => ({
  host: 'NGXA',
  nginxVersion: '1.24',
  tState: 'ok',
  scanDate: '2026-11-20',
  scannedAt: null,
  score: 95,
  passed: 19,
  failed: 1,
  excepted: 0,
  skipped: 0,
  ...ek,
});
const madde = (ek: Partial<NcCisItemRow>): NcCisItemRow => ({
  id: '2.4.1',
  title: 'server_tokens off',
  section: 'Bilgi sizintisi',
  level: 1,
  scored: true,
  pass: 3,
  fail: 1,
  excepted: 0,
  other: 0,
  fix: 'server_tokens off;',
  expected: 'off',
  expectedSource: 'CIS',
  exception: null,
  observedValues: [],
  hosts: [],
  ...ek,
});

const OZET: NcCisOverview = {
  ok: true,
  tableMissing: false,
  summary: {
    hosts: 3,
    scanDate: '2026-11-20',
    scannedAt: null,
    avgScore: 82,
    under80: 1,
    perfect: 1,
    failCells: 4,
    exceptedCells: 2,
    exceptedHosts: 1,
    items: 3,
    tFail: 1,
  },
  hosts: [
    hostRow({ host: 'NGXA', score: 100, failed: 0, passed: 20 }),
    hostRow({ host: 'NGXB', score: 60, failed: 8, tState: 'fail', nginxVersion: null }),
    hostRow({ host: 'NGXC', score: null, failed: 0, tState: null, scanDate: null }),
  ],
  perItem: [
    madde({
      id: '2.10.1',
      title: 'client_max_body_size',
      section: 'A',
      pass: 1,
      fail: 3,
      expected: '1m',
      expectedSource: 'kurum',
      observedValues: [{ value: '10m', count: 2, hosts: ['NGXA', 'NGXB'] }],
      rationale: 'buyuk istekler',
      check: 'nginx -T | grep client_max_body_size',
      hosts: [
        { host: 'NGXA', status: 'PASS', observed: '1m', detail: '', exceptionNote: null },
        { host: 'NGXB', status: 'FAIL', observed: '10m', detail: 'buyuk', exceptionNote: null },
        { host: 'NGXC', status: 'EXCEPTED', observed: '', detail: '', exceptionNote: 'eski' },
      ],
    }),
    madde({ id: '2.4.1', section: 'B', exception: { scope: 'all', note: 'kurum karari' } }),
    madde({ id: '2.9', title: 'manuel madde', section: 'C', scored: false, pass: 0, fail: 0 }),
  ],
  catalog: [],
  exceptions: [
    { id: 11, item_id: '2.4.1', host: null, note: 'kurum karari', created_by: 'ali' },
    { id: 12, item_id: '*', host: 'NGXC', note: 'emekli', created_by: 'ali' },
    { id: 13, item_id: '2.9', host: 'NGXB', note: 'gecici' },
  ],
  overrides: [{ id: 21, item_id: '2.10.1', expected: '1m', note: 'kurum', created_by: 'veli' }],
};

const DETAY: NcCisHostDetail = {
  ...hostRow({ host: 'NGXB', score: 60, failed: 2, passed: 1, excepted: 1, skipped: 1 }),
  items: [
    {
      id: '2.10.1',
      title: 'client_max_body_size',
      section: 'A',
      level: 1,
      scored: true,
      status: 'FAIL',
      source: 'T',
      observed: '10m',
      detail: 'buyuk',
      expected: '1m',
      expectedSource: 'kurum',
      exceptionNote: null,
      counts: true,
      fix: 'f',
    },
    {
      id: '2.4.1',
      title: 'server_tokens off',
      section: 'B',
      level: 1,
      scored: true,
      status: 'EXCEPTED',
      source: 'T',
      observed: 'on',
      detail: '',
      expected: 'off',
      expectedSource: 'CIS',
      exceptionNote: 'kurum karari',
      counts: false,
      fix: 'f',
    },
    {
      id: '2.9',
      title: 'manuel madde',
      section: 'C',
      level: 1,
      scored: false,
      status: 'FAIL',
      source: 'T',
      observed: '',
      detail: '',
      expected: null,
      expectedSource: null,
      exceptionNote: null,
      counts: false,
      fix: 'f',
    },
    {
      id: '3.1',
      title: 'yeni madde',
      section: 'D',
      level: 2,
      scored: true,
      status: 'FAIL',
      source: 'T',
      observed: 'x',
      detail: '',
      expected: 'y',
      expectedSource: 'CIS',
      exceptionNote: null,
      counts: true,
      fix: 'f',
    },
    {
      id: '3.2',
      title: 'olcum maddesi',
      section: 'D',
      level: 2,
      scored: true,
      status: 'NODATA',
      source: 'T',
      observed: '',
      detail: '',
      expected: null,
      expectedSource: null,
      exceptionNote: null,
      counts: false,
      fix: 'f',
    },
  ],
};

const sunucular = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.querySelector('td')?.firstChild?.textContent);

function goster(isAdmin = true, onOpenHost = vi.fn()) {
  render(<CisTab isAdmin={isAdmin} onOpenHost={onOpenHost} />);
  return onOpenHost;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.overview.mockResolvedValue(OZET);
  api.host.mockResolvedValue({ ok: true, host: DETAY });
  api.rescan.mockResolvedValue({ ok: true, jobId: 501, awxServerId: 2 });
  api.setException.mockResolvedValue({ ok: true });
  api.setOverride.mockResolvedValue({ ok: true });
  api.clearException.mockResolvedValue({ ok: true });
  api.clearOverride.mockResolvedValue({ ok: true });
});

describe('CisTab', () => {
  it('tarama hic kosmadiysa uyari; Admin tum filoyu tarayabilir', async () => {
    api.overview.mockResolvedValue({ ...OZET, tableMissing: true, message: 'Tablo yok (ornek)' });
    goster();
    expect(await screen.findByText('CIS taraması henüz koşmadı.')).toBeTruthy();
    expect(screen.getByText('Tablo yok (ornek)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tüm filoyu tara/ }));
    await waitFor(() => expect(api.rescan).toHaveBeenCalledWith([]));
  });

  it('ozet yukleme hatasi tostla bildirilir', async () => {
    api.overview.mockResolvedValueOnce({ ok: false, message: 'CIS okunamadi (ornek)' });
    goster();
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('CIS okunamadi (ornek)'));
    api.overview.mockRejectedValueOnce(new Error('ag yok'));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('ag yok'));
  });

  it('ozet kutulari; sunucular skora gore, suzgec / arama / siralama', async () => {
    goster();
    expect(await screen.findByText('%82')).toBeTruthy();
    expect(screen.getByText('komple istisna sunucu')).toBeTruthy();
    expect(sunucular()).toEqual(['ngxb', 'ngxa', 'ngxc']);
    expect(screen.getByText('komple istisna')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kalan maddesi olan' }));
    expect(sunucular()).toEqual(['ngxb']);
    fireEvent.click(screen.getByRole('button', { name: 'Skor < %80' }));
    expect(sunucular()).toEqual(['ngxb']);
    fireEvent.click(screen.getByRole('button', { name: 'Hepsi' }));
    fireEvent.change(screen.getByLabelText('sıralama'), { target: { value: 'host' } });
    expect(sunucular()).toEqual(['ngxa', 'ngxb', 'ngxc']);
    fireEvent.change(screen.getByLabelText('sıralama'), { target: { value: 'failed' } });
    expect(sunucular()[0]).toBe('ngxb');
    fireEvent.change(screen.getByLabelText('Sunucu ara'), { target: { value: 'yok' } });
    expect(screen.getByText('Eşleşen sunucu yok.')).toBeTruthy();
  });

  it('maddeler: dogal numara sirasi, arama ve siralamalar; rozetler', async () => {
    goster();
    await screen.findByText('%82');
    fireEvent.click(screen.getByRole('button', { name: 'Maddeler' }));
    const ilkHucreler = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelector('td')?.textContent?.trim());
    expect(ilkHucreler()).toEqual(['2.4.1', '2.9 ·m', '2.10.1']);
    expect(screen.getByText('kurum referansı')).toBeTruthy();
    expect(screen.getByText('tüm filo istisna')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('sıralama'), { target: { value: 'fail' } });
    expect(ilkHucreler()[0]).toBe('2.10.1');
    fireEvent.change(screen.getByLabelText('sıralama'), { target: { value: 'pass' } });
    expect(ilkHucreler()[0]).toBe('2.9 ·m');
    fireEvent.change(screen.getByLabelText('sıralama'), { target: { value: 'section' } });
    expect(ilkHucreler()).toEqual(['2.10.1', '2.4.1', '2.9 ·m']);
    fireEvent.change(screen.getByLabelText('Madde ara'), { target: { value: 'manuel' } });
    expect(ilkHucreler()).toEqual(['2.9 ·m']);
    fireEvent.change(screen.getByLabelText('Madde ara'), { target: { value: 'zzz' } });
    expect(screen.getByText('Eşleşen madde yok.')).toBeTruthy();
  });

  it('yeniden tarama is takibine eklenir; is bitince ozet tazelenir; hata yollari', async () => {
    goster();
    await screen.findByText('%82');
    fireEvent.click(screen.getByRole('button', { name: /Skoru tazele/ }));
    await waitFor(() => expect(is.addJob).toHaveBeenCalled());
    expect(tost.toast.success).toHaveBeenCalledWith('CIS taraması başladı (iş #501).');
    const isTanimi = is.addJob.mock.calls[0][0];
    expect(isTanimi.title).toBe('Nginx CIS · tüm filo #501');
    api.jobStatus.mockResolvedValueOnce({ ok: true, status: 'running', output: 'a' });
    expect(await isTanimi.fetchStatus()).toEqual({ status: 'running', output: 'a' });
    api.jobStatus.mockResolvedValueOnce({ ok: true, status: 'successful' });
    await act(async () => {
      expect(await isTanimi.fetchStatus()).toEqual({ status: 'successful', output: '' });
    });
    expect(api.overview).toHaveBeenLastCalledWith(true);
    api.jobStatus.mockResolvedValueOnce({ ok: false, message: 'durum yok (ornek)' });
    await expect(isTanimi.fetchStatus()).rejects.toThrow('durum yok (ornek)');

    // Tek sunucu tazeleme; reddedilen ve firlatan baslatma.
    api.rescan.mockResolvedValueOnce({ ok: false, message: 'Kilitli (ornek)' });
    const satir = screen.getByText('ngxa').closest('tr') as HTMLElement;
    fireEvent.click(within(satir).getByRole('button', { name: 'tazele' }));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Kilitli (ornek)'));
    expect(api.rescan).toHaveBeenLastCalledWith(['NGXA']);
    api.rescan.mockRejectedValueOnce(new Error('ag'));
    fireEvent.click(within(satir).getByRole('button', { name: 'tazele' }));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('ag'));
  });

  it('sunucu detayi: hucre durumlari, konfigurasyon, istisna ve referans dugmeleri', async () => {
    const onOpenHost = goster();
    await screen.findByText('%82');
    fireEvent.click(screen.getByText('ngxb'));
    expect(await screen.findByText('NGXB · CIS skoru %60')).toBeTruthy();
    const pencere = screen.getByRole('dialog');
    expect(within(pencere).getByText('kurum karari')).toBeTruthy();
    expect(within(pencere).getByText('tüm filo istisnası')).toBeTruthy();
    expect(within(pencere).getByText('veri yok')).toBeTruthy();
    // 2.9 bu sunucuda istisna: "istisnadan cikar" kaydi siler ve detayi yeniden okur.
    const s29 = within(pencere).getByText('2.9').closest('tr') as HTMLElement;
    fireEvent.click(within(s29).getByRole('button', { name: 'istisnadan çıkar' }));
    await waitFor(() => expect(api.clearException).toHaveBeenCalledWith(13));
    await waitFor(() => expect(api.host).toHaveBeenCalledTimes(2));
    // 2.10.1 kalan: zaten kurum referansi var -> "referans ekle".
    const s210 = within(pencere).getByText('2.10.1').closest('tr') as HTMLElement;
    fireEvent.click(within(s210).getByRole('button', { name: 'referans ekle' }));
    expect(await screen.findByText('Kabul edilen değer · 2.10.1')).toBeTruthy();
    expect((screen.getByPlaceholderText('ör. 10m') as HTMLInputElement).value).toBe('10m');
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    // 3.1 kalan: sunucuya ozel istisna.
    const s31 = within(screen.getByRole('dialog')).getByText('3.1').closest('tr') as HTMLElement;
    expect(within(s31).getByRole('button', { name: 'referansım' })).toBeTruthy();
    fireEvent.click(within(s31).getByRole('button', { name: 'istisna' }));
    expect(await screen.findByText('İstisna · 3.1')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('neden?'), { target: { value: 'gecici' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.setException).toHaveBeenCalledWith('3.1', 'NGXB', 'gecici'));
    expect(tost.toast.success).toHaveBeenCalledWith('İstisna kaydedildi; madde skordan düştü.');
    // Konfigurasyonu ac: ust bilesene haber verir, pencere kapanir.
    fireEvent.click(await screen.findByRole('button', { name: 'Konfigürasyonu aç' }));
    expect(onOpenHost).toHaveBeenCalledWith('NGXB');
    fireEvent.click(screen.getByText('ngxb'));
    fireEvent.click(await screen.findByRole('button', { name: /Bu sunucuyu yeniden tara/ }));
    await waitFor(() => expect(api.rescan).toHaveBeenCalledWith(['NGXB']));
  });

  it('sunucu detayi okunamazsa tost', async () => {
    api.host.mockResolvedValueOnce({ ok: false, message: 'Sunucu yok (ornek)' });
    api.host.mockRejectedValueOnce(new Error('ag'));
    goster();
    await screen.findByText('%82');
    fireEvent.click(screen.getByText('ngxa'));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Sunucu yok (ornek)'));
    fireEvent.click(screen.getByText('ngxa'));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('ag'));
  });

  it('sunucuyu komple istisnaya al ve cikar', async () => {
    goster();
    await screen.findByText('%82');
    const a = screen.getByText('ngxa').closest('tr') as HTMLElement;
    fireEvent.click(within(a).getByRole('button', { name: 'komple istisnaya al' }));
    expect(await screen.findByText('İstisna · *')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByPlaceholderText('neden?'), { target: { value: 'emekli' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.setException).toHaveBeenCalledWith('*', 'NGXA', 'emekli'));
    const c = screen.getByText('ngxc').closest('tr') as HTMLElement;
    fireEvent.click(within(c).getByRole('button', { name: 'istisnadan çıkar' }));
    await waitFor(() => expect(api.clearException).toHaveBeenCalledWith(12));
  });

  it('madde detayi: kurum referansi, olculen deger, sunucular; referans yap ve istisna', async () => {
    const onOpenHost = goster();
    await screen.findByText('%82');
    fireEvent.click(screen.getByRole('button', { name: 'Maddeler' }));
    fireEvent.click(screen.getByText('client_max_body_size'));
    expect(await screen.findByText('CIS 2.10.1 · client_max_body_size')).toBeTruthy();
    const pencere = screen.getByRole('dialog');
    expect(within(pencere).getByText('buyuk istekler')).toBeTruthy();
    expect(within(pencere).getByText('nginx -T | grep client_max_body_size')).toBeTruthy();
    expect(within(pencere).getByText('Sunucular (3)')).toBeTruthy();
    // Kalan sunucu once siralanir.
    const sunucuDugmeleri = within(pencere)
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => /^ngx/.test(t || ''));
    expect(sunucuDugmeleri).toEqual(['ngxb', 'ngxa', 'ngxc']);
    // Olculen degeri referans yap: kural penceresi o degerle acilir.
    fireEvent.click(within(pencere).getByRole('button', { name: 'referans yap' }));
    expect(await screen.findByText('Kabul edilen değer · 2.10.1')).toBeTruthy();
    expect((screen.getByPlaceholderText('ör. 10m') as HTMLInputElement).value).toBe('10m');
    expect(screen.getByText(/Bu maddede kabul edilen değer\(ler\) zaten var/)).toBeTruthy();
    api.overview.mockResolvedValueOnce({
      ...OZET,
      perItem: OZET.perItem.map((p) => (p.id === '2.10.1' ? { ...p, pass: 3, fail: 1 } : p)),
    });
    fireEvent.change(screen.getByPlaceholderText('neden?'), { target: { value: 'gelistirme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(api.setOverride).toHaveBeenCalledWith('2.10.1', '10m', 'gelistirme'),
    );
    await waitFor(() =>
      expect(tost.toast.success).toHaveBeenCalledWith(
        'Kurum referansı kaydedildi — 2.10.1: 3 sunucu geçiyor, 1 sunucu kalıyor.',
      ),
    );
    // Madde penceresinden sunucuya gecis.
    fireEvent.click(screen.getByText('client_max_body_size'));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'ngxb' }),
    );
    expect(await screen.findByText('NGXB · CIS skoru %60')).toBeTruthy();
    expect(onOpenHost).not.toHaveBeenCalled();
  });

  it('madde penceresinden istisna ve kurum referansi kaldirma', async () => {
    goster();
    await screen.findByText('%82');
    fireEvent.click(screen.getByRole('button', { name: 'Maddeler' }));
    fireEvent.click(screen.getByText('server_tokens off'));
    expect(await screen.findByText('tüm filo için istisna — kurum karari')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'İstisnadan çıkar (madde yeniden sayılsın)' }),
    );
    await waitFor(() => expect(api.clearException).toHaveBeenCalledWith(11));
    fireEvent.click(screen.getByText('client_max_body_size'));
    const pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: 'kaldır' }));
    await waitFor(() => expect(api.clearOverride).toHaveBeenCalledWith(21));
    // Istisnasiz madde: tum filoda istisnaya al -> kural penceresi.
    fireEvent.click(screen.getByText('manuel madde'));
    fireEvent.click(await screen.findByRole('button', { name: 'Tüm filoda istisnaya al' }));
    expect(await screen.findByText('İstisna · 2.9')).toBeTruthy();
    expect(screen.getByText(/Tüm filo için istisna/)).toBeTruthy();
  });

  it('madde satiri dugmeleri: kendi referansim (deger zorunlu), istisnaya al, istisnadan cikar', async () => {
    api.setOverride.mockResolvedValueOnce({ ok: false, message: 'Gecersiz (ornek)' });
    goster();
    await screen.findByText('%82');
    fireEvent.click(screen.getByRole('button', { name: 'Maddeler' }));
    const s29 = screen.getByText('manuel madde').closest('tr') as HTMLElement;
    fireEvent.click(within(s29).getByRole('button', { name: 'kendi referansım' }));
    expect(await screen.findByText(/henüz ölçülen bir değer yok/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('neden?'), { target: { value: 'not' } });
    const kaydet = screen.getByRole('button', { name: 'Kaydet' }) as HTMLButtonElement;
    expect(kaydet.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('ör. 10m'), { target: { value: 'on' } });
    fireEvent.click(kaydet);
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Gecersiz (ornek)'));
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    const s210 = screen.getByText('client_max_body_size').closest('tr') as HTMLElement;
    expect(within(s210).getByRole('button', { name: 'referans ekle (1)' })).toBeTruthy();
    fireEvent.click(within(s210).getByRole('button', { name: 'istisnaya al' }));
    expect(await screen.findByText('İstisna · 2.10.1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    const s241 = screen.getByText('server_tokens off').closest('tr') as HTMLElement;
    api.clearException.mockResolvedValueOnce({ ok: false, message: 'Silinemedi (ornek)' });
    fireEvent.click(within(s241).getByRole('button', { name: 'istisnadan çıkar' }));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Silinemedi (ornek)'));
  });

  it('kural listeleri kaldirma; Admin olmayan duzenleme dugmesi gormez', async () => {
    goster();
    await screen.findByText('%82');
    expect(screen.getByText('İstisnalar (3)')).toBeTruthy();
    expect(screen.getByText('Kabul edilen değerler (1)')).toBeTruthy();
    expect(screen.getByText('tüm maddeler')).toBeTruthy();
  });

  it('Admin olmayan: tarama / istisna / referans dugmeleri yok', async () => {
    goster(false);
    await screen.findByText('%82');
    expect(screen.queryByRole('button', { name: /Skoru tazele/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'komple istisnaya al' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Maddeler' }));
    expect(screen.queryByRole('button', { name: 'istisnaya al' })).toBeNull();
  });

  it('CSV dosyasi sunucu satirlarini tasir', async () => {
    const urlOlustur = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: urlOlustur });
    const tikla = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    goster();
    await screen.findByText('%82');
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(tikla).toHaveBeenCalled();
    const blob = urlOlustur.mock.calls[0][0] as unknown as Blob;
    const metin = await blob.text();
    expect(metin).toContain('"sunucu";"skor"');
    expect(metin).toContain('"NGXB";"60";"19";"8"');
    tikla.mockRestore();
  });
});
