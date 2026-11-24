// @vitest-environment jsdom
// Crypto Hub islemleri (2026-11-24, kapsam PR-2): onayda gosterilen komut (opsCommand), AWX is yoklamasi (useOps:
// baslatma / sonuc / basarisiz is / zaman asimi / hata), pod listesi, log penceresi, secilen pod silme (onay
// komutu, sunucuya onayli istek, sonuc listesi), rollout ve replika (0-50 dogrulamasi, 0 = kapatma uyarisi).
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoOpsAction } from '@/api/cryptoHubApi';

const api = vi.hoisted(() => ({ run: vi.fn(), result: vi.fn() }));
vi.mock('@/api/cryptoHubApi', () => ({ cryptoOpsApi: api }));
const tost = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useToast', () => tost);
vi.mock('../ResourcesModal', () => ({
  ResourcesModal: (p: { name: string; onClose: () => void }) => (
    <div>
      kaynak penceresi {p.name}
      <button type="button" onClick={p.onClose}>
        kaynak kapat
      </button>
    </div>
  ),
}));

import { ComponentOps, OpsConfirm, PodsTab, opsCommand, type OpsRequest } from '../OpsPanel';

const sonuc = (ek: Record<string, unknown> = {}) => ({
  pods: [],
  logs: [],
  results: [],
  errors: [],
  ...ek,
});
/** Is hemen baslar ve ilk yoklamada sonuc doner. */
function isDoner(result: Record<string, unknown>) {
  api.run.mockResolvedValueOnce({ ok: true, jobId: 9, awxServerId: 1 });
  api.result.mockResolvedValueOnce({ ok: true, status: 'successful', result: sonuc(result) });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('opsCommand', () => {
  const ns = 'kripto';
  const k = (r: Partial<OpsRequest> & { action: CryptoOpsAction }) =>
    opsCommand({ targets: [], ...r } as OpsRequest, ns);
  it('her islem icin kosacak komut', () => {
    expect(k({ action: 'pods' })).toBe('oc get pods -n kripto');
    expect(k({ action: 'values_files', valuesPaths: ['/a.yaml', '/b.yaml'] })).toBe(
      'cat /a.yaml\ncat /b.yaml',
    );
    expect(k({ action: 'configmaps' })).toBe('oc get configmap -n kripto');
    expect(k({ action: 'configmap_get', cmName: 'cm1' })).toBe(
      'oc get configmap cm1 -n kripto -o json',
    );
    expect(k({ action: 'configmap_put', cmName: 'cm1' })).toContain(
      'oc patch configmap cm1 -n kripto --type=merge',
    );
    expect(k({ action: 'values_backups', valuesPath: '/v.yaml' })).toBe('ls -l /v.yaml.*.bak');
    expect(k({ action: 'values_restore', valuesPath: '/v.yaml', backupPath: '/v.1.bak' })).toBe(
      'cp -p /v.yaml /v.yaml.<tarih>.bak\ncp -p /v.1.bak /v.yaml',
    );
    expect(k({ action: 'values_diff', release: 'r1', valuesPath: '/v' })).toContain(
      'helm get values r1 -n kripto',
    );
    expect(k({ action: 'helm_template', release: 'r1', valuesPath: '/v' })).toBe(
      'helm template r1 <chart> -n kripto -f /v',
    );
    expect(k({ action: 'helm_upgrade', release: 'r1', valuesPath: '/v' })).toContain('--atomic');
    expect(k({ action: 'values_get', release: 'r1' })).toBe('helm get values r1 -n kripto');
    expect(k({ action: 'values_get', release: 'r1', valuesAll: true })).toBe(
      'helm get values r1 -n kripto --all',
    );
    expect(k({ action: 'values_put', valuesPath: '/v' })).toContain('cp -p /v /v.<tarih>.bak');
    expect(k({ action: 'logs', targets: ['p1', 'p2'], container: 'c', previous: true })).toBe(
      'oc logs p1 -n kripto --tail=200 -c c --previous\noc logs p2 -n kripto --tail=200 -c c --previous',
    );
    expect(k({ action: 'logs', targets: ['p1'], tail: 50 })).toBe('oc logs p1 -n kripto --tail=50');
    expect(k({ action: 'pod_delete', targets: ['p1'] })).toBe(
      'oc delete pod p1 -n kripto --force --grace-period=0 --timeout=60s',
    );
    expect(k({ action: 'rollout', targets: ['deployment/a'] })).toBe(
      'oc rollout restart deployment/a -n kripto',
    );
    expect(k({ action: 'scale', targets: ['deployment/a'], replicas: 3 })).toBe(
      'oc scale deployment/a -n kripto --replicas=3',
    );
    expect(k({ action: 'resources_get' })).toContain('oc get deploy,sts,limitrange,resourcequota');
    expect(k({ action: 'resources_plan' })).toContain('helm template');
    expect(k({ action: 'resources_apply' })).toContain('helm upgrade --atomic');
    expect(k({ action: 'bilinmeyen' as CryptoOpsAction })).toBe('');
  });
});

describe('OpsConfirm', () => {
  it.each([
    ['pod_delete', 'Pod silme — onay'],
    ['rollout', 'Rollout restart — onay'],
    ['helm_upgrade', 'Values yeniden uygulanacak (helm upgrade) — onay'],
    ['values_put', 'values.yaml yazma — onay'],
    ['values_restore', 'Eski values sürümüne dönme — onay'],
    ['configmap_put', "Config map değişikliği (pod'lar yeniden başlatılmaz) — onay"],
    ['scale', 'Replika değişikliği — onay'],
  ])('%s basligi ve hedefler', (action, baslik) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <OpsConfirm
        req={{ action: action as CryptoOpsAction, targets: ['h1', 'h2'], replicas: 0 }}
        namespace="ns"
        tenantLabel="Kiraci"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(baslik)).toBeTruthy();
    expect(screen.getByText('Hedefler (2)')).toBeTruthy();
    if (action === 'scale') expect(screen.getByText(/bileşenin KAPATILMASI/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve çalıştır' }));
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('komut kopyalanir; panoya yazilamazsa tost', async () => {
    const yaz = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('izin'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: yaz },
      configurable: true,
    });
    render(
      <OpsConfirm
        req={{ action: 'rollout', targets: ['deployment/a'] }}
        namespace="ns"
        tenantLabel="K"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Kopyala/ }));
    expect(await screen.findByText(/kopyalandı/)).toBeTruthy();
    expect(yaz).toHaveBeenCalledWith('oc rollout restart deployment/a -n ns');
    await waitFor(() => expect(screen.queryByText(/kopyalandı/)).toBeNull(), { timeout: 2500 });
    fireEvent.click(screen.getByRole('button', { name: /Kopyala/ }));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Kopyalanamadı.'));
  });
});

describe('PodsTab ve useOps', () => {
  const POD = {
    name: 'kripto-api-1',
    phase: 'Running',
    ready: true,
    containers: 2,
    restarts: 0,
    startedAt: '2026-11-20T10:00:00Z',
    node: 'node1',
  };

  it('pod listesi, hata satirlari, log penceresi ve yeniden getirme', async () => {
    isDoner({
      pods: [
        POD,
        {
          ...POD,
          name: 'kripto-job-1',
          phase: 'Succeeded',
          ready: false,
          restarts: 3,
          startedAt: null,
          node: null,
        },
      ],
      errors: [{ stage: 'login', message: 'bir cluster atlandi' }],
    });
    render(<PodsTab tenantKey="k1" tenantLabel="Kiraci" namespace="ns" />);
    expect(await screen.findByText('kripto-api-1')).toBeTruthy();
    expect(api.run).toHaveBeenCalledWith({
      tenant: 'k1',
      action: 'pods',
      targets: [],
      confirmed: undefined,
    });
    expect(screen.getByText(/bir cluster atlandi/)).toBeTruthy();
    expect(screen.getByText('hazır değil')).toBeTruthy();

    // Tek pod logu: pencere acilir acilmaz getirir.
    isDoner({ logs: [{ target: 'kripto-api-1', line: 'BASLADI' }] });
    const satir = screen.getByText('kripto-api-1').closest('tr') as HTMLElement;
    fireEvent.click(within(satir).getByRole('button', { name: /Log/ }));
    expect(await screen.findByText('BASLADI')).toBeTruthy();
    // Parametrelerle yeniden getir: bos log "hata degil" notu ve hata satiri.
    fireEvent.change(screen.getByDisplayValue('200'), { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('önceki koşu (--previous)'));
    fireEvent.change(screen.getByPlaceholderText('kap adı (isteğe bağlı)'), {
      target: { value: 'app' },
    });
    isDoner({ logs: [], errors: [] });
    fireEvent.click(screen.getByRole('button', { name: /Yeniden getir/ }));
    expect(await screen.findByText(/Log boş döndü/)).toBeTruthy();
    expect(api.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'logs', tail: 500, previous: true, container: 'app' }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Kapat' }).at(-1) as HTMLElement);
    expect(screen.queryByText('Pod logu')).toBeNull();
  });

  it('coklu secim logu hedef onekli; tumunu sec / birak', async () => {
    isDoner({ pods: [POD, { ...POD, name: 'kripto-api-2' }] });
    render(<PodsTab tenantKey="k1" tenantLabel="K" namespace="ns" />);
    await screen.findByText('kripto-api-1');
    const kutular = screen.getAllByRole('checkbox');
    fireEvent.click(kutular[0]);
    expect(screen.getByRole('button', { name: /Log göster \(2\)/ })).toBeTruthy();
    fireEvent.click(kutular[0]);
    expect(screen.getByRole('button', { name: /Log göster \(0\)/ })).toBeTruthy();
    fireEvent.click(kutular[0]);
    isDoner({
      logs: [
        { target: 'kripto-api-1', line: 'a' },
        { target: 'kripto-api-2', line: 'b' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: /Log göster \(2\)/ }));
    expect(await screen.findByText(/\[kripto-api-1\] a\s+\[kripto-api-2\] b/)).toBeTruthy();
  });

  it('secilen pod silme: onayda komut, onayli istek, sonuc listesi ve yeniden listeleme', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    isDoner({ pods: [POD, { ...POD, name: 'kripto-api-2' }] });
    render(<PodsTab tenantKey="k1" tenantLabel="K" namespace="ns" />);
    await screen.findByText('kripto-api-1');
    const kutu = within(screen.getByText('kripto-api-1').closest('tr') as HTMLElement).getByRole(
      'checkbox',
    );
    fireEvent.click(kutu);
    fireEvent.click(screen.getByRole('button', { name: /Seçilenleri sil \(1\)/ }));
    expect(screen.getByText('Pod silme — onay')).toBeTruthy();
    expect(
      screen.getByText('oc delete pod kripto-api-1 -n ns --force --grace-period=0 --timeout=60s'),
    ).toBeTruthy();
    isDoner({ results: [{ target: 'kripto-api-1', ok: true, message: 'silindi' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve çalıştır' }));
    expect(await screen.findByText(/— silindi/)).toBeTruthy();
    expect(api.run).toHaveBeenLastCalledWith({
      tenant: 'k1',
      action: 'pod_delete',
      targets: ['kripto-api-1'],
      confirmed: true,
    });
    expect(tost.toast.success).toHaveBeenCalledWith(
      '1/1 pod silindi. OpenShift yerine yenisini açar.',
    );
    isDoner({ pods: [] });
    await act(async () => {
      vi.advanceTimersByTime(4100);
    });
    expect(await screen.findByText('Pod bulunamadı')).toBeTruthy();
  });

  it('useOps: baslatilamazsa, sonuc okunamazsa, is basarisizsa ve hata firlarsa tost; yoklama 3 sn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.run.mockResolvedValueOnce({ ok: false, message: 'Yetki yok (ornek)' });
    render(<PodsTab tenantKey="k1" tenantLabel="K" namespace="ns" />);
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Yetki yok (ornek)'));
    expect(screen.getByText('Pod listesi getiriliyor')).toBeTruthy();

    api.run.mockResolvedValueOnce({ ok: true, jobId: 5, awxServerId: 1 });
    api.result
      .mockResolvedValueOnce({ ok: true, status: 'running', result: null })
      .mockResolvedValueOnce({ ok: true, status: 'failed', result: null });
    fireEvent.click(screen.getByRole('button', { name: /Listeyi yenile/ }));
    await waitFor(() => expect(api.result).toHaveBeenCalledTimes(1));
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    await waitFor(() =>
      expect(tost.toast.error).toHaveBeenCalledWith('İş failed durumunda bitti (#5).'),
    );

    api.run.mockResolvedValueOnce({ ok: true, jobId: 6, awxServerId: 1 });
    api.result.mockResolvedValueOnce({ ok: false, message: 'Sonuç yok (ornek)' });
    fireEvent.click(screen.getByRole('button', { name: /Listeyi yenile/ }));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Sonuç yok (ornek)'));

    api.run.mockRejectedValueOnce(new Error('ag'));
    fireEvent.click(screen.getByRole('button', { name: /Listeyi yenile/ }));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('ag'));
  });

  it('useOps: okuma isi 5 dakikada vazgecer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now();
    let simdi = t0;
    vi.spyOn(Date, 'now').mockImplementation(() => simdi);
    api.run.mockResolvedValueOnce({ ok: true, jobId: 7, awxServerId: 1 });
    api.result.mockImplementation(async () => {
      simdi += 6 * 60 * 1000;
      return { ok: true, status: 'running', result: null };
    });
    render(<PodsTab tenantKey="k1" tenantLabel="K" namespace="ns" />);
    await waitFor(() =>
      expect(tost.toast.error).toHaveBeenCalledWith(
        'İş hâlâ sürüyor (#7); Ansible ekranından izleyebilirsiniz.',
      ),
    );
    vi.mocked(Date.now).mockRestore();
    api.result.mockReset();
  });
});

describe('ComponentOps', () => {
  const goster = (ek: Partial<React.ComponentProps<typeof ComponentOps>> = {}) => {
    const onDone = vi.fn();
    render(
      <ComponentOps
        tenantKey="k1"
        tenantLabel="K"
        namespace="ns"
        kind="StatefulSet"
        name="vault"
        want={2}
        onDone={onDone}
        {...ek}
      />,
    );
    return onDone;
  };

  it('rollout: onayla, hepsi tamamsa basari, degilse hata tostu', async () => {
    const onDone = goster();
    fireEvent.click(screen.getByRole('button', { name: /Rollout/ }));
    expect(screen.getByText('oc rollout restart statefulset/vault -n ns')).toBeTruthy();
    isDoner({ results: [{ target: 'statefulset/vault', ok: true, message: 'ok' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve çalıştır' }));
    await waitFor(() =>
      expect(tost.toast.success).toHaveBeenCalledWith('statefulset/vault: tamam.'),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Rollout/ }));
    isDoner({ results: [{ target: 'statefulset/vault', ok: false, message: 'yetki yok' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve çalıştır' }));
    await waitFor(() =>
      expect(tost.toast.error).toHaveBeenCalledWith('statefulset/vault: yetki yok'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Rollout/ }));
    isDoner({ results: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve çalıştır' }));
    await waitFor(() => expect(tost.toast.error).toHaveBeenCalledWith('Sonuç boş döndü.'));
  });

  it('replika: 0-50 disi kapali, 0 kapatma uyarisi, iptal', async () => {
    goster({ kind: 'Deployment', want: null });
    fireEvent.click(screen.getByRole('button', { name: /Replika/ }));
    expect(screen.getByText('deployment/vault')).toBeTruthy();
    const kutu = screen.getByDisplayValue('1');
    fireEvent.change(kutu, { target: { value: '7x1' } });
    expect((kutu as HTMLInputElement).value).toBe('71');
    expect((screen.getByRole('button', { name: 'Devam' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(kutu, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Devam' }));
    expect(screen.getByText(/bileşenin KAPATILMASI/)).toBeTruthy();
    expect(screen.getByText('oc scale deployment/vault -n ns --replicas=0')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'İptal' }).at(-1) as HTMLElement);
    expect(screen.queryByText(/bileşenin KAPATILMASI/)).toBeNull();
  });

  it('Kaynak dugmesi yalniz katalog kaydi varsa; kapaninca onDone', () => {
    const onDone = goster({ tenant: { key: 'k1' } as never });
    fireEvent.click(screen.getByRole('button', { name: /Kaynak/ }));
    expect(screen.getByText('kaynak penceresi vault')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'kaynak kapat' }));
    expect(onDone).toHaveBeenCalled();
  });
});
