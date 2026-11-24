// @vitest-environment jsdom
// Crypto Hub on onay penceresi (2026-11-24, kapsam PR-2; %0): surum gerektirmeyen islemde dogrudan plan; surumlu islemde
// hedef surum adimi (bilinen surumler tekillesir ve siralanir, kosan isaretli, listede olmayan surum dogrulamasi), values
// adimi (onay kutusu olmadan ilerlemez), plan (adim turleri, yazan / dogrulanmali isaretleri, uyarilar, kopyalama,
// onay dugmesi KAPALI), plan hatasi, rollout uygulamasi yalniz plan runnable iken.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoActionDef, CryptoPlan } from '@/api/cryptoHubApi';

const api = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock('@/api/cryptoHubApi', () => ({ cryptoHubApi: api }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));
vi.mock('@/components/crypto_hub/ValuesEditor', () => ({
  ValuesEditor: (p: { release: string }) => <div>values editoru {p.release}</div>,
}));
vi.mock('@/components/crypto_hub/RolloutApply', () => ({
  RolloutApply: (p: { onApplied: () => void; release: string }) => (
    <button type="button" onClick={p.onApplied}>
      rollout uygula {p.release}
    </button>
  ),
}));

import PlanModal from '../PlanModal';

const islem = (ek: Partial<CryptoActionDef> = {}): CryptoActionDef => ({
  key: 'restart',
  label: 'Yeniden başlat',
  hint: '',
  writes: true,
  params: [],
  ...ek,
});
const plan = (ek: Partial<CryptoPlan> = {}): CryptoPlan =>
  ({
    action: 'upgrade',
    label: 'Yükselt',
    tenantKey: 't1',
    params: {},
    scannedAt: '2026-11-24T08:00:00Z',
    steps: [
      { n: 1, kind: 'check', title: 'Pod durumu', command: 'oc get pods -n ns', writes: false },
      {
        n: 2,
        kind: 'command',
        title: 'Helm upgrade',
        command: 'helm upgrade x',
        writes: true,
        note: 'dikkat',
        source: 'chart',
      },
      { n: 3, kind: 'manual', title: 'Jenkins isi', writes: false, unknown: true },
    ],
    writeCount: 1,
    unknownCount: 1,
    warnings: ['Bakim penceresi disinda'],
    runnable: false,
    runnableNote: 'Yazan playbook bagli degil; yalniz gosterir.',
    ...ek,
  }) as CryptoPlan;

beforeEach(() => {
  api.plan.mockReset();
  toast.error.mockReset();
});

describe('PlanModal', () => {
  it('surum istemeyen islem: dogrudan plan, adim turleri, kopyalama, onay kapali', async () => {
    api.plan.mockResolvedValue({ ok: true, plan: plan() });
    const yaz = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: yaz } });
    const kapat = vi.fn();
    render(<PlanModal tenantKey="t1" tenantLabel="Kart" action={islem()} onClose={kapat} />);
    expect(await screen.findByText('Helm upgrade')).toBeTruthy();
    expect(api.plan).toHaveBeenCalledWith('t1', 'restart', '');
    expect(screen.getByText('Kart · uygulanacak adımlar')).toBeTruthy();
    expect(screen.getByText('3 adım')).toBeTruthy();
    expect(screen.getByText('1 adım ortamda değişiklik yapar')).toBeTruthy();
    expect(screen.getByText('1 adım doğrulanmalı')).toBeTruthy();
    expect(screen.getByText(/son taramadaki bileşenlerden/)).toBeTruthy();
    expect(screen.getByText('değişiklik yapar')).toBeTruthy();
    expect(screen.getByText('doğrulanmalı')).toBeTruthy();
    expect(screen.getByText('Portal dışı')).toBeTruthy();
    expect(screen.getByText('kaynak: chart')).toBeTruthy();
    expect(screen.getByText('Bakim penceresi disinda')).toBeTruthy();
    expect(screen.getByText('Yazan playbook bagli degil; yalniz gosterir.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Onayla ve çalıştır' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByText(/Hedef sürüm/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Tüm komutları kopyala/ }));
    await waitFor(() =>
      expect(yaz).toHaveBeenCalledWith(
        '# 1. Pod durumu\noc get pods -n ns\n\n# 2. Helm upgrade\nhelm upgrade x',
      ),
    );
    expect(await screen.findByText('kopyalandı')).toBeTruthy();
    yaz.mockRejectedValueOnce(new Error('izin yok'));
    fireEvent.click(screen.getAllByRole('button', { name: /^Kopyala$/ })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Panoya kopyalanamadı.'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Kapat' }).at(-1)!);
    expect(kapat).toHaveBeenCalled();
  });

  it('plan uretilemez ya da istek duserse hata gosterilir', async () => {
    api.plan.mockResolvedValueOnce({ ok: false, message: 'Tarama yok' });
    const { unmount } = render(
      <PlanModal tenantKey="t1" tenantLabel="Kart" action={islem()} onClose={vi.fn()} />,
    );
    expect(await screen.findByText('Tarama yok')).toBeTruthy();
    expect(screen.getByText(/hiçbir şey çalıştırmaz/)).toBeTruthy();
    unmount();
    api.plan.mockRejectedValueOnce(new Error('ag koptu'));
    render(<PlanModal tenantKey="t1" tenantLabel="Kart" action={islem()} onClose={vi.fn()} />);
    expect(await screen.findByText('ag koptu')).toBeTruthy();
  });

  it('surum adimi: bilinen surumler, kosan isareti, listede olmayan surum ve values adimi', async () => {
    api.plan.mockResolvedValue({ ok: true, plan: plan() });
    render(
      <PlanModal
        tenantKey="t1"
        tenantLabel="Kart"
        action={islem({
          key: 'upgrade',
          label: 'Yükselt',
          params: [{ key: 'version', label: 'Sürüm' }],
        })}
        running="1.2.0"
        release="metaco"
        known={[
          { version: '1.10.0', source: 'depo' },
          { version: '1.2.0', source: 'arsiv' },
          { version: '1.10.0', source: 'arsiv' },
          { version: '', source: 'depo' },
        ]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('1. Hedef sürüm')).toBeTruthy();
    expect(api.plan).not.toHaveBeenCalled();
    const surumler = screen.getAllByRole('button').filter((b) => /^\d/.test(b.textContent || ''));
    expect(surumler.map((b) => b.textContent)).toEqual(['1.10.0', '1.2.0koşan']);
    expect(surumler[0].getAttribute('title')).toBe('Chart deposunda mevcut');
    expect(surumler[1].getAttribute('title')).toBe("Bastion'da indirilmiş");
    const ileri = () =>
      screen.getByRole('button', { name: /Komutları göster/ }) as HTMLButtonElement;
    expect(ileri().disabled).toBe(true);
    fireEvent.click(surumler[0]);
    expect(screen.getByText('Kart · 1.2.0 → 1.10.0')).toBeTruthy();
    expect(ileri().disabled).toBe(false);

    fireEvent.click(screen.getByLabelText('Listede olmayan bir sürüme geçeceğim'));
    // Elle kip secilince onceki surum temizlenir.
    expect(ileri().disabled).toBe(true);
    expect(screen.getByText(/Deponun listelemediği yeni bir sürüm/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('örn. 1.35.0'), { target: { value: 'v1.3' } });
    expect(screen.getByText(/Sürüm rakamla başlamalı/)).toBeTruthy();
    expect(ileri().disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('örn. 1.35.0'), {
      target: { value: '1.11.0-rc1' },
    });
    fireEvent.click(ileri());

    expect(screen.getByText('values editoru metaco')).toBeTruthy();
    const valuesIleri = screen.getByRole('button', {
      name: /Komutları göster/,
    }) as HTMLButtonElement;
    expect(valuesIleri.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Sürüm seçimi/ }));
    expect(screen.getByText('1. Hedef sürüm')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Komutları göster/ }));
    fireEvent.click(screen.getByLabelText(/Değerleri gördüm/));
    fireEvent.click(screen.getByRole('button', { name: /Komutları göster/ }));
    await waitFor(() => expect(api.plan).toHaveBeenCalledWith('t1', 'upgrade', '1.11.0-rc1'));
    fireEvent.click(await screen.findByRole('button', { name: /Values adımına dön/ }));
    expect(screen.getByText('values editoru metaco')).toBeTruthy();
  });

  it('surum listesi bosken elle giris ipucu; release yoksa values adimi atlanir', async () => {
    api.plan.mockResolvedValue({
      ok: true,
      plan: plan({ warnings: [], unknownCount: 0, scannedAt: null }),
    });
    render(
      <PlanModal
        tenantKey="t1"
        tenantLabel="Kart"
        action={islem({ key: 'upgrade', params: [{ key: 'version', label: 'Sürüm' }] })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('seçilmedi')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Listede olmayan bir sürüme geçeceğim'));
    expect(screen.getByText(/Chart deposu sorgulanamadığı için liste boş/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('örn. 1.35.0'), { target: { value: '2.0.0' } });
    fireEvent.click(screen.getByRole('button', { name: /Komutları göster/ }));
    expect(await screen.findByText('Helm upgrade')).toBeTruthy();
    expect(screen.queryByText(/adım doğrulanmalı/)).toBeNull();
    expect(screen.queryByText(/son taramadaki bileşenlerden/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Sürüm seçimine dön/ }));
    expect(screen.getByText('1. Hedef sürüm')).toBeTruthy();
  });

  it('values rollout: release varken values adimiyla baslar; rollout yalniz runnable planda, uygulayinca plan tazelenir', async () => {
    api.plan.mockResolvedValue({
      ok: true,
      plan: plan({ runnable: true, runnableNote: 'Portaldan uygulanabilir.' }),
    });
    render(
      <PlanModal
        tenantKey="t1"
        tenantLabel="Kart"
        action={islem({ key: 'values_rollout', label: 'Values uygula' })}
        release="metaco"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('1. Mevcut values')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Değerleri gördüm/));
    fireEvent.click(screen.getByRole('button', { name: /Komutları göster/ }));
    const uygula = await screen.findByRole('button', { name: 'rollout uygula metaco' });
    expect(api.plan).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(uygula);
    });
    await waitFor(() => expect(api.plan).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Portaldan uygulanabilir.')).toBeTruthy();
  });

  it('runnable olmayan rollout planinda uygulama dugmesi cizilmez', async () => {
    api.plan.mockResolvedValue({ ok: true, plan: plan() });
    render(
      <PlanModal
        tenantKey="t1"
        tenantLabel="Kart"
        action={islem({ key: 'values_rollout' })}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('Helm upgrade')).toBeTruthy();
    expect(screen.queryByText(/rollout uygula/)).toBeNull();
  });
});
