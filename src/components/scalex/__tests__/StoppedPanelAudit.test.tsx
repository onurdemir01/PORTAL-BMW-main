// src/components/scalex/__tests__/StoppedPanelAudit.test.tsx
//
// "Durumu tazele" SAPMA TARAMASI — DAVRANIS testleri (kaynak taramasi DEGIL).
//
// Uretimde yasanan (2026-09-17): kullanici ortam/platform SECMEDEN "Durumu tazele"ye
// basiyor, hicbir sey taranmiyor ve ekran yine de "Cluster'lar tarandi, sapma durumu
// guncellendi." yaziyor. Sebep: gruplar yalnizca `cluster|namespace` ile kuruluyor ve
// `discover`a BILESENE GECILEN (bos) `env`/`tenant` yollaniyordu; sunucu 400 donuyor,
// dongu `continue` ile sessizce yutuyordu.
//
// Bu testler `scalexApi.discover`in NE ILE cagrildigina ve ekranin NE YAZDIGINA bakar.
// Kaynak metnine bakan bir bekci, ayni hatanin baska bir yazimla geri gelmesini
// kaciracakti.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import StoppedPanel from '@/components/scalex/StoppedPanel';
import type { ScaleXStoppedItem } from '@/api/scalexApi';

const mockStopped = vi.hoisted(() => vi.fn());
const mockDiscover = vi.hoisted(() => vi.fn());
const mockDiscoverStatus = vi.hoisted(() => vi.fn());

vi.mock('@/api/scalexApi', () => ({
  scalexApi: {
    stopped: mockStopped,
    discover: mockDiscover,
    discoverStatus: mockDiscoverStatus,
    restoreAll: vi.fn(),
  },
}));

vi.mock('@/contexts/JobTrackerContext', () => ({
  useJobTracker: () => ({ addJob: vi.fn() }),
}));

function makeItem(over: Partial<ScaleXStoppedItem> = {}): ScaleXStoppedItem {
  return {
    id: 1,
    env: 'test',
    tenant: 'ark',
    clusterName: 'gbocptest1',
    namespace: 'ark-server-push-test',
    appName: 'server-push-reg-ch-v0',
    workloadKind: 'DeploymentConfig',
    previousReplicas: 1,
    phase: 'scaled_down',
    stoppedBy: 'uxmid',
    stoppedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    driftStatus: 'in_sync',
    ...over,
  } as ScaleXStoppedItem;
}

function listOf(items: ScaleXStoppedItem[]) {
  return { ok: true, items, hiddenCount: 0, hiddenByOwnership: 0, truncated: false };
}

async function clickRefresh() {
  const btn = await screen.findByRole('button', { name: /Durumu tazele/i });
  await act(async () => {
    fireEvent.click(btn);
  });
}

describe('StoppedPanel sapma taramasi', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockStopped.mockReset();
    mockDiscover.mockReset();
    mockDiscoverStatus.mockReset();
    mockDiscoverStatus.mockResolvedValue({ ok: true, finished: true, failed: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // SA1 — ASIL HATA. Panel `env`/`tenant` PROP'U BOS (kapsam secilmemis) iken
  // acilir; tarama yine de satirin KENDI kapsamiyla kosmali.
  it('SA1 kapsam secilmeden de satirin kendi env/tenant degeriyle tarar', async () => {
    mockStopped.mockResolvedValue(listOf([makeItem()]));
    mockDiscover.mockResolvedValue({ ok: true, serverId: 1, jobId: 42, status: 'pending' });

    render(<StoppedPanel env="" tenant="" />);
    await screen.findByText(/server-push-reg-ch-v0/);
    await clickRefresh();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(mockDiscover).toHaveBeenCalledTimes(1);
    const [scope, mode] = mockDiscover.mock.calls[0];
    expect(mode).toBe('state');
    // Bos string GECMEMELI — sunucu `resolveScope` ile 400 doner.
    expect(scope.env).toBe('test');
    expect(scope.tenant).toBe('ark');
    expect(scope.namespace).toBe('ark-server-push-test');
    expect(scope.clusters).toEqual(['gbocptest1']);
  });

  // SA2 — AYNI cluster/namespace, FARKLI kapsam IKI AYRI IS olmali. Eski anahtar
  // (`cluster|namespace`) bunlari tek gruba katlar ve birinin kapsami otekine
  // uygulanirdi.
  it('SA2 ayni cluster/namespace farkli env/tenant ise iki ayri kesif kosar', async () => {
    mockStopped.mockResolvedValue(
      listOf([
        makeItem({ id: 1, env: 'test', tenant: 'ark' }),
        makeItem({ id: 2, env: 'prod', tenant: 'ark', appName: 'baska-app' }),
      ]),
    );
    mockDiscover.mockResolvedValue({ ok: true, serverId: 1, jobId: 42, status: 'pending' });

    render(<StoppedPanel env="" tenant="" />);
    await screen.findByText(/baska-app/);
    await clickRefresh();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(mockDiscover).toHaveBeenCalledTimes(2);
    const envs = mockDiscover.mock.calls.map((c) => c[0].env).sort();
    expect(envs).toEqual(['prod', 'test']);
  });

  // SA3 — HICBIR SEY TARANMADIYSA "tarandi" DEME. Bugunku yalanin yerine gecen satir.
  it('SA3 tum kesifler basarisizsa hata yazar, "tarandi" DEMEZ', async () => {
    mockStopped.mockResolvedValue(listOf([makeItem()]));
    mockDiscover.mockResolvedValue({ ok: false, message: 'env ve tenant zorunlu.' });

    render(<StoppedPanel env="" tenant="" />);
    await screen.findByText(/server-push-reg-ch-v0/);
    await clickRefresh();

    await waitFor(() => {
      expect(screen.getByText(/Hiçbir kapsam taranamadı/)).toBeTruthy();
    });
    expect(screen.queryByText(/tarandı, sapma durumu güncellendi/)).toBeNull();
  });

  // SA4 — KISMI BASARI ADIYLA SOYLENIR. Sessizce yutmak bu ekranin gizlememesi
  // gereken seyi gizlemekti.
  it('SA4 bir kapsam taranamazsa adiyla birlikte bildirilir', async () => {
    mockStopped.mockResolvedValue(
      listOf([
        makeItem({ id: 1, env: 'test', tenant: 'ark' }),
        makeItem({ id: 2, env: 'prod', tenant: 'ark', appName: 'baska-app' }),
      ]),
    );
    mockDiscover
      .mockResolvedValueOnce({ ok: true, serverId: 1, jobId: 42, status: 'pending' })
      .mockResolvedValueOnce({ ok: false, message: 'yetkiniz yok' });

    render(<StoppedPanel env="" tenant="" />);
    await screen.findByText(/baska-app/);
    await clickRefresh();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    await waitFor(() => {
      expect(screen.getByText(/Taranamayanlar:.*yetkiniz yok/)).toBeTruthy();
    });
  });

  // SA5 — TAVAN. Her grup bir AWX isi; kapsamsiz liste 500 satira kadar gelebilir.
  // Tavan asilinca tarama HIC baslamamali (sessizce kirpmak yalani geri getirirdi).
  it('SA5 kapsam sayisi tavani asarsa HIC kesif baslatmaz', async () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      makeItem({ id: i + 1, namespace: `ns-${i}`, appName: `app-${i}` }),
    );
    mockStopped.mockResolvedValue(listOf(many));
    mockDiscover.mockResolvedValue({ ok: true, serverId: 1, jobId: 42, status: 'pending' });

    render(<StoppedPanel env="" tenant="" />);
    await screen.findByText(/app-0/);
    await clickRefresh();

    await waitFor(() => {
      expect(screen.getByText(/Tarama başlatılmadı/)).toBeTruthy();
    });
    expect(mockDiscover).not.toHaveBeenCalled();
  });
});
