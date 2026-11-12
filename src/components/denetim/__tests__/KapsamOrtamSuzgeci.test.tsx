// src/components/denetim/__tests__/KapsamOrtamSuzgeci.test.tsx
//
// Nginx Hub › SPA Uygulamaları › Ortamlar ve Taşıma — ORTAM SÜZGECİ (kullanıcı, 2026-11-11:
// "Ortamlar ve Taşıma sekmesine de ortam filtresi ekle").
//   KS1 düğmeler sabit sırada, EDU dahil (matrisin env listesinde EDU olmasa da: özet EDU satırı gösterir)
//   KS2 ortam seçilince matris yalnız o sütun + o ortamda hücresi olan satırlar; servis sayısı ve
//       yük özeti o ortamın hücrelerinden; ortam farkı süzgeci gizli; seçim hatırlanır
//   KS3 Production Taşımaları katmanında süzgeç yok
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { NginxSpaAudit } from '@/components/DenetimPage';
import type { NginxSpaResult, NginxSpaEnvCell } from '@/api/denetimApi';

const mockSpa = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', async (orijinal) => ({
  ...(await orijinal<typeof import('@/api/denetimApi')>()),
  denetimApi: {
    nginxSpa: mockSpa,
    spaCoverage: () => Promise.resolve({ ok: false, message: 'yok' }),
    routeStats: () => Promise.resolve({ ok: false }),
    nginxMigration: () => Promise.resolve({ ok: false }),
  },
}));
vi.mock('@/components/denetim/NginxProdMigration', () => ({ default: () => <div>tasima-ekrani</div> }));

const hucre = (state: 'active' | 'idle' | 'unknown', hosts = 1): NginxSpaEnvCell =>
  ({
    present: true, status: 'OK', locationPath: '/x/', hosts: ['GBNGXT33'], dirs: [],
    traffic: { state, req24: null, req7: null, lastSeen: null, sampled: false, hosts, unknownHosts: 0 },
  }) as unknown as NginxSpaEnvCell;

function veri(): NginxSpaResult {
  return {
    ok: true, scanDate: '2026-11-11', availableDates: ['2026-11-11'], services: ['GLOMO'],
    envs: ['DEV', 'TEST', 'QA', 'PROD'],
    trafficStats: { ready: true, active: 3, idle: 1, unknown: 0, kismi: 0 },
    serviceStats: [{ service: 'GLOMO', envs: { TEST: 2, PROD: 5 } }],
    rows: [
      { service: 'GLOMO', application: 'kart-ui', envs: { TEST: hucre('active'), PROD: hucre('active') } },
      { service: 'GLOMO', application: 'pos-ui', envs: { PROD: hucre('idle') } },
      { service: 'GLOMO', application: 'test-ui', envs: { TEST: hucre('active') } },
    ],
  } as NginxSpaResult;
}
const dugme = (ad: string) =>
  [...document.querySelectorAll('[data-testid="kapsam-ortam-secimi"] button')].find((b) => b.textContent === ad) as HTMLButtonElement;
const uygulamalar = () => [...document.querySelectorAll('table.pf-table-sticky tbody tr td:first-child')].map((td) => td.textContent?.replace(/yalnız PROD|PROD'da yok/, '').trim());
const basliklar = () => [...document.querySelectorAll('table.pf-table-sticky thead th')].map((th) => th.textContent);

describe('Ortamlar ve Taşıma — ortam süzgeci', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSpa.mockResolvedValue(veri());
  });

  it('KS1 düğmeler sabit sırada, EDU dahil', async () => {
    render(<NginxSpaAudit />);
    await screen.findByText('kart-ui');
    const etiketler = [...document.querySelectorAll('[data-testid="kapsam-ortam-secimi"] button')].map((b) => b.textContent);
    expect(etiketler).toEqual(['Tüm ortamlar', 'Prod', 'QA', 'Test', 'Dev', 'Edu']);
    expect(dugme('Tüm ortamlar').getAttribute('aria-checked')).toBe('true');
  });

  it('KS2 PROD: yalnız PROD sütunu ve PROD satırları; servis sayısı ve yük özeti PROD; ortam farkı gizli; hatırlanır', async () => {
    const { unmount } = render(<NginxSpaAudit />);
    await screen.findByText('kart-ui');
    expect(uygulamalar()).toEqual(['kart-ui', 'pos-ui', 'test-ui']);
    expect(screen.getByText('yük var: 3')).toBeTruthy();
    expect(screen.getByTitle(/Ortam farkı/)).toBeTruthy();

    fireEvent.click(dugme('Prod'));
    expect(dugme('Prod').getAttribute('aria-checked')).toBe('true');
    expect(uygulamalar()).toEqual(['kart-ui', 'pos-ui']);
    expect(basliklar()).toEqual(['Uygulama', 'Ekip', 'PROD']);
    expect(screen.getByText('yük var: 1')).toBeTruthy();
    expect(screen.getByText('yük yok: 1')).toBeTruthy();
    expect(screen.getByText(/Yük \(access log, son 7 gün\) · PROD/)).toBeTruthy();
    expect(screen.queryByTitle(/Ortam farkı/)).toBeNull();
    // servis sekmesindeki sayi yalniz PROD location'lari (5), tum ortamlarin toplami (7) DEGIL
    const servis = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('GLOMO')) as HTMLButtonElement;
    expect(servis.textContent).toBe('GLOMO5');
    expect(localStorage.getItem('nginx-hub:spa-kapsam:ortam')).toBe('PROD');
    unmount();

    render(<NginxSpaAudit />);
    await screen.findByText('kart-ui');
    expect(dugme('Prod').getAttribute('aria-checked')).toBe('true');
    expect(uygulamalar()).toEqual(['kart-ui', 'pos-ui']);
  });

  it('KS3 Production Taşımaları katmanında ortam süzgeci yok', async () => {
    render(<NginxSpaAudit />);
    await screen.findByText('kart-ui');
    fireEvent.click(screen.getByText('Production Taşımaları'));
    await waitFor(() => expect(screen.getByText('tasima-ekrani')).toBeTruthy());
    expect(document.querySelector('[data-testid="kapsam-ortam-secimi"]')).toBeNull();
  });
});
