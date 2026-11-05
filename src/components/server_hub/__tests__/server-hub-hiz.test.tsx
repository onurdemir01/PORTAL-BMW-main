// src/components/server_hub/__tests__/server-hub-hiz.test.tsx — Server Hub hızı (2026-11-05).
//
// Kullanıcı: "server hub çok yavaş her tıkladığımda bir şeyler yüklüyor".
//   SH1 sekmeler açık kalır: gidip dönünce /overview YENİDEN istenmez, sekme içeriği yerinde (gizli)
//   SH2 sayfaya dönüşte son yanıt hemen görünür (yükleme logosu yok, istek yok); 60 sn'den eskiyse sessizce tazelenir
//   SH3 çizim sınırı: 300 satır, "300 daha", "tümü"; arama değişince yine 300 (sayaç TÜM kümeyi sayar)
//   SH4 gizli sekmede yoklama yok: Uygulama Envanteri çalışan koşuyu gizliyken yoklamaz, görünür olunca yoklar
//   SH5 karttan Bulgular'a geçiş: sekme açık kalsa da hazır süzgeç yeni bir kurulumla uygulanır (key);
//       gizli sekmede yoklama / kendiliğinden pencere kapıları yerinde (kaynak)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import fs from 'node:fs';
import path from 'node:path';

const m = vi.hoisted(() => ({
  overview: vi.fn(),
  findings: vi.fn(),
  limitler: vi.fn(),
  hostAdlari: vi.fn(),
  jobStatus: vi.fn(),
  ozet: vi.fn(),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: {
    overview: m.overview,
    findings: m.findings,
    limitler: m.limitler,
    hostAdlari: m.hostAdlari,
    jobStatus: m.jobStatus,
  },
}));
vi.mock('@/api/earEnvanterApi', async (orig) => ({
  ...(await orig<typeof import('@/api/earEnvanterApi')>()),
  earApi: { ozet: m.ozet, uygulamalar: vi.fn(async () => ({ ok: true, satirlar: [], toplam: 0 })) },
}));

import ServerHubPage from '@/components/server_hub/ServerHubPage';
import EarEnvanterTab from '@/components/server_hub/EarEnvanterTab';
import { SekmeKabi } from '@/components/server_hub/sekmeGorunurlugu';
import * as shOnbellek from '@/components/server_hub/shOnbellek';

const sunucu = (i: number) => ({
  host: `APPSRV${String(i).padStart(4, '0')}`,
  status: 'ok',
  counts: { danger: 0, warning: 0, info: 0 },
  products: ['JBOSS'],
  jvms: 0,
  jvmsRunning: 0,
  vhosts: 0,
  unusedIps: 0,
  topFinding: '',
  scanDate: '2026-11-05',
  cpuS: null,
  hostClass: 'genel',
});
const overview = (n: number) => ({
  ok: true,
  tableMissing: false,
  latestScan: '2026-11-05',
  summary: null,
  hosts: Array.from({ length: n }, (_, i) => sunucu(i)),
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  shOnbellek._sifirlaForTest();
  m.overview.mockResolvedValue(overview(3));
  m.findings.mockResolvedValue({ ok: true, findings: [], latestScan: null });
  m.limitler.mockResolvedValue({ ok: true, limitler: [] });
});

describe('Server Hub hızı', () => {
  it('SH1 sekmeler açık kalır', async () => {
    render(<ServerHubPage />);
    expect(await screen.findByText('APPSRV0001')).toBeInTheDocument();
    expect(m.overview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Bulgular' }));
    await waitFor(() => expect(m.findings).toHaveBeenCalledTimes(1));
    expect(screen.getByText('APPSRV0001')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Sunucular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulgular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sunucular' }));
    expect(screen.getByText('APPSRV0001')).toBeVisible();
    expect(m.overview).toHaveBeenCalledTimes(1);
    expect(m.findings).toHaveBeenCalledTimes(1);
  });

  it('SH2 sayfaya dönüş anında; eskiyse sessizce tazelenir', async () => {
    const { unmount } = render(<ServerHubPage />);
    await screen.findByText('APPSRV0001');
    unmount();
    const ikinci = render(<ServerHubPage />);
    expect(screen.getByText('APPSRV0001')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /yükleniyor/i })).toBeNull();
    expect(m.overview).toHaveBeenCalledTimes(1);
    ikinci.unmount();
    const asil = Date.now;
    Date.now = () => asil() + 61 * 1000;
    try {
      render(<ServerHubPage />);
      expect(screen.getAllByText('APPSRV0001').length).toBeGreaterThan(0);
      await waitFor(() => expect(m.overview).toHaveBeenCalledTimes(2));
    } finally {
      Date.now = asil;
    }
  });

  it('SH3 çizim sınırı', async () => {
    m.overview.mockResolvedValue(overview(700));
    render(<ServerHubPage />);
    await screen.findByText('APPSRV0000');
    expect(screen.queryByText('APPSRV0300')).toBeNull();
    expect(screen.getByText(/300 \/ 700 gösteriliyor/)).toBeInTheDocument();
    expect(screen.getByText(/700 \/ 700 sunucu/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '300 daha' }));
    expect(screen.getByText('APPSRV0599')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByText(/600 \/ 700 gösteriliyor/)).getByRole('button', { name: 'tümü' }),
    );
    expect(screen.getByText('APPSRV0699')).toBeInTheDocument();
    expect(screen.queryByText(/gösteriliyor/)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/sunucu/i), { target: { value: 'APPSRV0' } });
    await waitFor(() => expect(screen.getByText(/300 \/ 700 gösteriliyor/)).toBeInTheDocument());
  });
});

describe('SH4 gizli sekmede yoklama yok', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());
  it('Uygulama Envanteri', async () => {
    m.ozet.mockResolvedValue({
      ok: true,
      ayarlar: { deger: {}, kayitlar: {}, okunamadi: false, hata: '', tanimlar: [] },
      zamanlayici: { acik: false, metin: '', sonraki: null },
      planlar: [],
      template: { anahtar: 'x', tanimli: true },
      dizin: '/x',
      aktif: {
        id: 3,
        kip: 'OZET',
        kaynak: 'ELLE',
        kapsam: 'FILO',
        durum: 'CALISIYOR',
        beklenen: 1,
        tam: 0,
        kismi: 0,
        kok_yok: 0,
        basarisiz: 0,
        parti_sayisi: 1,
        baslatan: 'a',
        hata: null,
        created_at: '2026-11-05T10:00:00Z',
        finished_at: null,
        alinan: 0,
        partiler: [],
      },
      son: null,
      sayilar: null,
    });
    const { rerender } = render(
      <SekmeKabi id="envanter" etkin="hosts">
        <EarEnvanterTab />
      </SekmeKabi>,
    );
    await waitFor(() => expect(m.ozet).toHaveBeenCalledTimes(1));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(m.ozet).toHaveBeenCalledTimes(1);
    rerender(
      <SekmeKabi id="envanter" etkin="envanter">
        <EarEnvanterTab />
      </SekmeKabi>,
    );
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await waitFor(() => expect(m.ozet).toHaveBeenCalledTimes(2));
  });
});

describe('SH5 kaynak kapıları', () => {
  const oku = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  it('Bulgular key ile yeniden kurulur; gizli sekme kapıları yerinde', () => {
    const sh = oku('ServerHubPage.tsx');
    expect(sh).toMatch(/<FindingsTab key=\{bulguNo\} initial=\{findingsFilter\} \/>/);
    expect(sh).toMatch(/setBulguNo\(\(n\) => n \+ 1\);\s*sekmeAc\('findings'\);/);
    const rt = oku('RetirementTab.tsx');
    expect(rt).toMatch(/if \(!canliGerek \|\| !gorunur\) return;/);
    expect(rt).toMatch(/if \(!rec \|\| !tids \|\| !gorunur\) return;/);
    expect(rt).toMatch(/\}, \[rec, gorunur\]\);/);
    const rk = oku('RebootKontroluTab.tsx');
    expect(rk).toMatch(/!\/_kosuyor\$\/\.test\(secili\.durum\) \|\| !gorunur\) return;/);
    expect(rk).not.toMatch(/serverHubApi\.overview\(/);
  });
});
