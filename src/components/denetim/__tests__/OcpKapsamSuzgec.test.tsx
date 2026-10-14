// src/components/denetim/__tests__/OcpKapsamSuzgec.test.tsx
//
// Denetim > OpenShift (2026-10-14, kullanici: "production'da 5/5 olmayanlari nasil hizlica
// gorebilirim? ... cluster sayilari arasindaki farkin ne oldugunu nasil anlayabilirim? ... bu
// yuzde neyin yuzdesi?"). Kilitlenen davranis:
//   - ortam sutununun suzgeci: Tam / Kismi / var / yok / "<cluster>'de yok"
//   - suzgec secilince "Sadece eksigi olanlar" kapanir (tum ortamlarda bulunan uygulama gizlenmesin)
//   - cluster cipi "−N" farkini gosterir; tiklayinca o cluster'da olmayanlar suzulur
//   - yuzdenin paydasi ekranda yazar
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import DenetimPage from '@/components/DenetimPage';
import type { OcpCoverageResult, OcpCoverageRow } from '@/api/denetimApi';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ canSee: () => true }) }));
const mockOcp = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', async (orijinal) => {
  const gercek = (await orijinal()) as Record<string, unknown>;
  return { ...gercek, denetimApi: { ...(gercek.denetimApi as object), ocpCoverage: mockOcp } };
});

const PROD = ['gbocpprod1', 'gbocpprod2', 'gbocpprod4', 'gbocpankprod2', 'gbocpdrcprod1'];
const satir = (application: string, prod: string[], digerleri = true): OcpCoverageRow => {
  const envs: OcpCoverageRow['envs'] = {};
  if (digerleri) for (const e of ['dev', 'test', 'qa']) envs[e] = [{ cluster: 'gbocptest1', namespace: `${application}-${e}` }];
  if (prod.length) envs.prod = prod.map((cluster) => ({ cluster, namespace: `${application}-prod` }));
  const present = Object.keys(envs);
  const missing = ['dev', 'test', 'qa', 'edu', 'prod'].filter((e) => !present.includes(e));
  return { application, envs, present, missing, missingCount: missing.length };
};

// tam-app: 5/5; drc-yok: DR haric 4/5; tek-app: 1/5; yalniz-dev: prod'da yok
const ROWS = [
  satir('tam-app', PROD),
  satir('drc-yok', PROD.slice(0, 4)),
  satir('tek-app', ['gbocpprod1']),
  satir('yalniz-dev', [], true),
];
const VERI: OcpCoverageResult = {
  ok: true,
  platform: 'ark',
  platforms: ['ark'],
  clusters: PROD,
  envs: ['dev', 'test', 'qa', 'edu', 'prod'],
  totalApplications: ROWS.length,
  completeCount: 0,
  skippedNoEnv: 0,
  patterns: [],
  envClusters: {
    dev: [{ cluster: 'gbocptest1', apps: 4 }],
    prod: [
      { cluster: 'gbocpprod1', apps: 3 },
      { cluster: 'gbocpprod2', apps: 2 },
      { cluster: 'gbocpprod4', apps: 2 },
      { cluster: 'gbocpankprod2', apps: 2 },
      { cluster: 'gbocpdrcprod1', apps: 1 },
    ],
  },
  envClusterKaynagi: { prod: 'resmi', dev: 'veri' },
  rows: ROWS,
};

const tabloUygulamalari = () =>
  screen
    .getAllByRole('row')
    .map((tr) => tr.querySelector('td')?.textContent?.trim())
    .filter((x): x is string => !!x && ROWS.some((r) => r.application === x));

describe('Denetim > OpenShift — sütun süzgeci ve cluster farkı', () => {
  beforeEach(() => {
    mockOcp.mockReset();
    mockOcp.mockResolvedValue(VERI);
  });

  it('prod "Kısmi" süzgeci 5/5 olmayanları gösterir ve "Sadece eksiği olanlar"ı kapatır', async () => {
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=ocp'] });
    await screen.findByText('Ortama göre uygulama sayısı');
    const eksik = screen.getByLabelText('Sadece eksiği olanlar') as HTMLInputElement;
    expect(eksik.checked).toBe(true);
    fireEvent.change(screen.getByLabelText('prod sütununa göre süz'), { target: { value: 'kismi' } });
    expect(eksik.checked).toBe(false);
    expect(tabloUygulamalari().sort()).toEqual(['drc-yok', 'tek-app']);
    fireEvent.change(screen.getByLabelText('prod sütununa göre süz'), { target: { value: 'tam' } });
    expect(tabloUygulamalari()).toEqual(['tam-app']);
    fireEvent.change(screen.getByLabelText('prod sütununa göre süz'), { target: { value: 'yok' } });
    expect(tabloUygulamalari()).toEqual(['yalniz-dev']);
    fireEvent.change(screen.getByLabelText('prod sütununa göre süz'), { target: { value: 'yok:gbocpdrcprod1' } });
    expect(tabloUygulamalari().sort()).toEqual(['drc-yok', 'tek-app']);
  });

  it('cluster çipi farkı (−N) gösterir; tıklayınca o cluster\'da olmayanlar süzülür', async () => {
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=ocp'] });
    await screen.findByText('Ortama göre uygulama sayısı');
    // prod'da 3 uygulama var; drcprod1'de 1 -> −2; prod1'de 3 -> fark yok, tiklanamaz.
    const drc = screen.getByRole('button', { name: /gbocpdrcprod1/ });
    expect(drc.textContent).toContain('−2');
    const p1 = screen.getByRole('button', { name: /gbocpprod1/ }) as HTMLButtonElement;
    expect(p1.disabled).toBe(true);
    fireEvent.click(drc);
    expect(drc.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('prod sütununa göre süz') as HTMLSelectElement).value).toBe('yok:gbocpdrcprod1');
    expect(tabloUygulamalari().sort()).toEqual(['drc-yok', 'tek-app']);
    fireEvent.click(screen.getByText('Sütun süzgeçlerini temizle'));
    expect((screen.getByLabelText('prod sütununa göre süz') as HTMLSelectElement).value).toBe('');
  });

  it('yüzdenin paydası yazıyor: uygulamaların yüzde kaçı bu ortamda da var', async () => {
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=ocp'] });
    const panel = (await screen.findByText('Ortama göre uygulama sayısı')).closest('div.rounded-xl') as HTMLElement;
    expect(panel.textContent).toContain('herhangi bir ortamda görülen');
    // prod: 3 / 4 = %75, ipucunda pay/payda
    const yuzde = within(panel).getByText('%75');
    expect(yuzde.getAttribute('title')).toBe('3 / 4 uygulama');
  });
});
