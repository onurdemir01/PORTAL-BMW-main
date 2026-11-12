// Bulgular kodları ve kod rehberi (2026-11-11).
//   KR1 varsayılan: ham kod gizli, okunur ad görünür; "Kodları göster" açınca ham kod + ad; seçim saklanır
//   KR2 kodlar kapalıyken çipler okunur adı yazar; çipe tıklamak yine o koda süzer
//   KR3 kod rehberi: ilk açılışta kuralları indirir, "bu listedekiler" yalnız listedeki kodları gösterir,
//       "tüm kodlar" hepsini; koda tıklayınca liste süzülür ve panel kapanır
//   KR4 R1–R12 bölümü bulgu olmadıklarını ve nerede göründüklerini söyler
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { ShKurallar } from '@/api/serverHubApi';

const m = vi.hoisted(() => ({
  findings: vi.fn(),
  host: vi.fn(),
  retireEtiketleri: vi.fn(),
  kurallar: vi.fn(),
  jvmAutoStart: vi.fn(),
}));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

import { FindingsTab } from '@/components/server_hub/ServerHubPage';

const bulgu = (host: string, code: string, text: string) => ({
  host,
  products: ['JBOSS7'],
  env: 'PROD',
  envGroup: 'Production',
  scanDate: '2026-11-11',
  severity: 'danger' as const,
  area: 'jvm',
  code,
  text,
  fixable: false,
});

const KURALLAR: ShKurallar = {
  ok: true,
  okunamadi: false,
  taramaTarihi: '2026-11-11',
  sayimOlculdu: true,
  alanlar: { jvm: 'JVM' },
  maddeler: [
    {
      id: 'jvm_durum',
      alan: 'jvm',
      alanAd: 'JVM',
      ad: 'JVM durumu',
      neTaranir: 'x',
      ciktilar: [
        { kod: 'REBOOT_RISK', kosul: 'JVM çalışıyor ama auto-start kapalı', varsayilan: 'danger', gecerli: 'danger' },
        { kod: 'STOPPED_AUTOSTART_ON', kosul: 'JVM kapalı ama auto-start açık', varsayilan: 'danger', gecerli: 'warning' },
        { kod: 'KOPYA_TUTARSIZ', kosul: 'eşlenik kopyalar tutarsız', varsayilan: 'warning', gecerli: 'warning' },
        { kod: null, kosul: 'sorun yok', varsayilan: 'ok', gecerli: 'ok' },
      ],
    },
  ],
  limitler: [],
  etiketKurallari: [
    { kural: 'R1', tur: 'JVM', ad: 'Kapalı + auto-start açık + trafik yok', kosul: 'k', varsayilan: 'KESIN', gecerli: 'KESIN', degistiren: null, zaman: null, aciklama: '', dogrulama: null },
  ],
  gecmis: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* yok */
  }
  m.findings.mockResolvedValue({
    ok: true,
    tableMissing: false,
    latestScan: '2026-11-11',
    findings: [bulgu('GBAPP01', 'REBOOT_RISK', 'app1 auto-start kapalı'), bulgu('GBAPP02', 'STOPPED_AUTOSTART_ON', 'app2 kapalı')],
  });
  m.kurallar.mockResolvedValue(KURALLAR);
});

describe('Bulgular kodları', () => {
  it('KR1 varsayılan gizli; anahtar açar ve saklanır', async () => {
    render(<FindingsTab />);
    await screen.findByText('app1 auto-start kapalı');
    const kutu = screen.getByRole('checkbox', { name: 'Kodları göster' });
    expect(kutu).not.toBeChecked();
    const tablo = screen.getByRole('table');
    expect(within(tablo).queryByText('REBOOT_RISK')).toBeNull();
    fireEvent.click(kutu);
    expect(within(screen.getByRole('table')).getByText('REBOOT_RISK')).toBeInTheDocument();
    expect(window.localStorage.getItem('server-hub:bulgu-kodlari-goster')).toBe('1');
  });

  it('KR2 kodlar kapalıyken çipler okunur ad; tıklama süzer', async () => {
    render(<FindingsTab />);
    await screen.findByText('app1 auto-start kapalı');
    const cipler = screen.getAllByRole('button', { pressed: false }).filter((b) => /\d$/.test(b.textContent || ''));
    expect(cipler.length).toBe(2);
    expect(cipler.every((b) => !/[A-Z]{3,}_[A-Z]/.test(b.textContent || ''))).toBe(true);
    fireEvent.click(cipler.find((b) => b.getAttribute('title') === 'REBOOT_RISK')!);
    await waitFor(() => expect(screen.queryByText('app2 kapalı')).toBeNull());
    expect(screen.getByText('app1 auto-start kapalı')).toBeInTheDocument();
  });

  it('KR3 kod rehberi: listedekiler / tümü, seçim süzer ve kapanır', async () => {
    render(<FindingsTab />);
    await screen.findByText('app1 auto-start kapalı');
    expect(m.kurallar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Kod rehberi/ }));
    const panel = await screen.findByRole('dialog', { name: 'Kod rehberi' });
    await within(panel).findByText('JVM kapalı ama auto-start açık');
    expect(m.kurallar).toHaveBeenCalledTimes(1);
    // Bu listedekiler: KOPYA_TUTARSIZ listede yok.
    expect(within(panel).queryByText('KOPYA_TUTARSIZ')).toBeNull();
    expect(within(panel).getByText('varsayılan kritik')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Tüm kodlar' }));
    expect(within(panel).getByText('KOPYA_TUTARSIZ')).toBeInTheDocument();
    fireEvent.click(within(panel).getByText('JVM kapalı ama auto-start açık').closest('button')!);
    expect(screen.queryByRole('dialog', { name: 'Kod rehberi' })).toBeNull();
    await waitFor(() => expect(screen.queryByText('app1 auto-start kapalı')).toBeNull());
    expect(screen.getByText('app2 kapalı')).toBeInTheDocument();
  });

  it('KR4 R kodları bulgu değil diye ayrı anlatılır', async () => {
    render(<FindingsTab />);
    await screen.findByText('app1 auto-start kapalı');
    fireEvent.click(screen.getByRole('button', { name: /Kod rehberi/ }));
    const panel = await screen.findByRole('dialog', { name: 'Kod rehberi' });
    expect(await within(panel).findByText(/R1–R1 kodları nedir/)).toBeInTheDocument();
    expect(within(panel).getByText(/Retirement Analizi › Retirement etiketleri/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Kod rehberi' })).toBeNull();
  });
});
