// src/components/self_service/__tests__/ip-check.test.tsx — Check > IP Sorgu ekranı.
//   IC1 yalnız IP: yalnız /ip-check çağrılır
//   IC2 sunucu: yalnız /server-ip-check; IP'ler, kaynak, kopyalama
//   IC3 karışık liste iki ucu da çağırır
//   IC4 uyarılar: aksiyon, bulunamayan, geçersiz, bayat veri, dijital kanal, kesme
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import IpCheckSection from '@/components/self_service/IpCheckSection';
import type { ServerIpCheckResult } from '@/api/selfServiceApi';

const { mockIp, mockSunucu } = vi.hoisted(() => ({ mockIp: vi.fn(), mockSunucu: vi.fn() }));
vi.mock('@/api/selfServiceApi', () => ({ selfServiceApi: { ipCheck: mockIp, serverIpCheck: mockSunucu } }));

const LB: ServerIpCheckResult = {
  ok: true,
  sonuclar: [
    {
      sunucu: 'GBAPAP01',
      bulundu: true,
      eslenikler: ['GBAPWP01'],
      kayitlar: [
        { host: 'GBAPAP01', ip: '10.0.0.1', neden: 'sunucu' },
        { host: 'GBAPWP01', ip: '10.0.0.2', neden: 'web_eslenigi' },
      ],
    },
  ],
  ipler: ['10.0.0.1', '10.0.0.2'],
  uyarilar: [],
  veriTarihi: '2026-11-05T08:00:00.000Z',
  veriBayat: false,
  dijitalKanalOkundu: true,
  gecersiz: [],
  truncated: 0,
  maxItems: 1000,
};

function sorgula(metin: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: metin } });
  fireEvent.click(screen.getByRole('button', { name: /Kontrol Et/ }));
}

describe('IpCheckSection', () => {
  beforeEach(() => {
    mockIp.mockReset().mockResolvedValue({ ok: true, results: [{ ip: '10.0.0.1', found: false, matches: [] }], totalChecked: 1, totalFound: 0, truncated: 0, maxItems: 1000 });
    mockSunucu.mockReset().mockResolvedValue(LB);
  });

  it('IC1 yalnız IP', async () => {
    render(<IpCheckSection />);
    sorgula('10.0.0.1');
    expect(await screen.findByText('Envanterde bulunamadı')).toBeInTheDocument();
    expect(mockIp).toHaveBeenCalledWith(['10.0.0.1']);
    expect(mockSunucu).not.toHaveBeenCalled();
  });

  it('IC2 sunucu listesi', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<IpCheckSection />);
    sorgula('GBAPAP01 gbapap02');
    expect(await screen.findByText("LB IP'leri")).toBeInTheDocument();
    expect(mockSunucu).toHaveBeenCalledWith(['GBAPAP01', 'gbapap02']);
    expect(mockIp).not.toHaveBeenCalled();
    expect(screen.getByText('10.0.0.2')).toBeInTheDocument();
    expect(screen.getByText('Web eşleniği')).toBeInTheDocument();
    expect(screen.queryByText(/güncel değil/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /IP'leri Kopyala/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('10.0.0.1\n10.0.0.2'));
    expect(await screen.findByRole('button', { name: /Kopyalandı/ })).toBeInTheDocument();
  });

  it('IC3 karışık liste', async () => {
    render(<IpCheckSection />);
    sorgula('10.0.0.1, GBAPAP01');
    expect(await screen.findByText("LB IP'leri")).toBeInTheDocument();
    expect(await screen.findByText('Envanterde bulunamadı')).toBeInTheDocument();
    expect(mockIp).toHaveBeenCalledWith(['10.0.0.1']);
    expect(mockSunucu).toHaveBeenCalledWith(['GBAPAP01']);
  });

  it('IC4 uyarılar görünür', async () => {
    mockSunucu.mockResolvedValue({
      ...LB,
      sonuclar: [...LB.sonuclar, { sunucu: 'GBYOKP01', bulundu: false, eslenikler: [], kayitlar: [] }],
      uyarilar: [{ sunucu: 'GBJBOP07', uygulama: '-', aciklama: 'batch kontrol edilmeli' }],
      gecersiz: ['A;B'],
      veriBayat: true,
      dijitalKanalOkundu: false,
      truncated: 3,
    });
    render(<IpCheckSection />);
    sorgula('GBAPAP01');
    expect(await screen.findByText('Çalışma öncesi aksiyon gerekli')).toBeInTheDocument();
    expect(screen.getByText(/batch kontrol edilmeli/)).toBeInTheDocument();
    expect(screen.getByText(/GBYOKP01/)).toBeInTheDocument();
    expect(screen.getByText(/A;B/)).toBeInTheDocument();
    expect(screen.getByText(/güncel değil/)).toBeInTheDocument();
    expect(screen.getByText(/Dijital kanal sunucu listesi okunamadı/)).toBeInTheDocument();
    expect(screen.getByText(/son 3 girdi DEĞERLENDİRİLMEDİ/)).toBeInTheDocument();
  });
});
