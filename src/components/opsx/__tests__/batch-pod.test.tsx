// src/components/opsx/__tests__/batch-pod.test.tsx — Batch / job pod'lari (2026-10-14).
//
// Kullanici: "OpenShift cluster'larinda bazen batch pod'lari olusuyor ve insanlar bunlari silmek
// istiyor. Biz OpsX'te yalniz envanterdeki uygulamayi secip pod'larini getiriyoruz."
//   BP1 hedef adiminda namespace'in "tum pod'lari" eklenir (envanterde uygulama olmasa da)
//   BP2 "tum pod'lar" seciliyken restart kapali, pod silme acik
//   BP3 pod adiminda arama bos baslar, batch suzgeci ve rozeti; batch secilince silme uyarisi
//   BP4 uygulama secilmisse arama dolu baslar ama gizlenen pod sayisi ve "aramayi temizle" gorunur
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';

const api = vi.hoisted(() => ({
  getClusters: vi.fn(),
  getOcpNamespaces: vi.fn(),
  getOcpApps: vi.fn(),
  getOcpOperations: vi.fn(),
  discoverOcpPods: vi.fn(),
  ocpPodsStatus: vi.fn(),
}));
vi.mock('@/api/opsxApi', async (orijinal) => ({ ...((await orijinal()) as object), opsxApi: api }));

import OcpTargetStep from '../steps/OcpTargetStep';
import OcpOperationStep from '../steps/OcpOperationStep';
import OcpPodSelectStep, { batchPodMu } from '../steps/OcpPodSelectStep';

const POD = (name: string, status = 'Running') => ({ name, ready: '1/1', status, restarts: '0', age: '1h', cluster: 'gbocpprod1', namespace: 'kart-prod' });
const PODLAR = [
  POD('kart-ui-7d8f9c5b4-x2k9p'),
  POD('rapor-uret-28394829-ab12c', 'Completed'),
  POD('gece-temizlik-28394830-zz9yy', 'Running'),
  POD('tek-sefer-job-q8w7e', 'Error'),
];

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.getClusters.mockResolvedValue({ tree: { PROD: { ark: ['gbocpprod1'] } } });
  api.getOcpNamespaces.mockResolvedValue({ namespaces: ['kart-batch-prod'] });
  api.getOcpApps.mockResolvedValue({ apps: [] });
  api.getOcpOperations.mockResolvedValue({
    operations: [
      { key: 'restart', label: 'Restart', enabled: true },
      { key: 'poddelete', label: 'Pod sil', enabled: true },
      { key: 'threaddump', label: 'Thread dump', enabled: true },
    ],
  });
  api.discoverOcpPods.mockResolvedValue({ jobId: 1, awxServerId: 1 });
  api.ocpPodsStatus.mockResolvedValue({ status: 'successful', pods: PODLAR });
});

describe('Batch / job pod\'lari', () => {
  it('BP1 envanterde uygulamasi olmayan namespace\'te "tum pod\'lar" eklenir ve gonderilir', async () => {
    let gonderilen: unknown = null;
    render(<OcpTargetStep onSubmit={(v) => { gonderilen = v; }} />);
    fireEvent.click(await screen.findByText('PROD'));
    fireEvent.click(await screen.findByText('ark'));
    fireEvent.click(await screen.findByText('kart-batch-prod'));
    expect(await screen.findByText(/yalnız batch \/ job çalışıyor olabilir/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /tüm pod'ları/ }));
    expect(await screen.findByText("kart-batch-prod / tüm pod'lar (batch / job dahil)")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Devam Et' }));
    expect(gonderilen).toEqual({ env: 'PROD', tenant: 'ark', pairs: [{ namespace: 'kart-batch-prod', application: '*' }] });
  });

  it('BP2 "tum pod\'lar" seciliyken restart kapali, pod islemleri acik', async () => {
    render(<OcpOperationStep env="PROD" tenant="ark" pairs={[{ namespace: 'kart-batch-prod', application: '*' }]} onSelect={() => {}} />);
    const restart = (await screen.findByText('Restart')).closest('button') as HTMLButtonElement;
    expect(restart.disabled).toBe(true);
    expect((screen.getByText('Pod sil').closest('button') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText('Thread dump').closest('button') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/kart-batch-prod \/ tüm pod'lar/)).toBeTruthy();
  });

  it('BP3 tum pod\'larda arama bos; batch suzgeci, rozet ve silme uyarisi', async () => {
    render(
      <OcpPodSelectStep env="PROD" tenant="ark" pairs={[{ namespace: 'kart-prod', application: '*' }]} dumpType="threaddump" mode="poddelete" onSubmit={() => {}} />,
    );
    expect(await screen.findByText('kart-ui-7d8f9c5b4-x2k9p')).toBeTruthy();
    expect((screen.getByLabelText('Pod adında ara') as HTMLInputElement).value).toBe('');
    expect(screen.getAllByText('batch').length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Batch / job (3)' }));
    expect(screen.queryByText('kart-ui-7d8f9c5b4-x2k9p')).toBeNull();
    expect(screen.getByText('tek-sefer-job-q8w7e')).toBeTruthy();
    expect(screen.queryByTestId('batch-uyari')).toBeNull();
    fireEvent.click(screen.getByText('rapor-uret-28394829-ab12c'));
    expect(screen.getByTestId('batch-uyari').textContent).toContain('yeniden oluşturulmaz');
  });

  it('BP4 uygulama seciliyse arama dolu; gizli pod sayisi ve aramayi temizle', async () => {
    render(
      <OcpPodSelectStep env="PROD" tenant="ark" pairs={[{ namespace: 'kart-prod', application: 'kart-ui' }]} dumpType="threaddump" mode="poddelete" onSubmit={() => {}} />,
    );
    expect(await screen.findByText('kart-ui-7d8f9c5b4-x2k9p')).toBeTruthy();
    expect(screen.queryByText('rapor-uret-28394829-ab12c')).toBeNull();
    expect(screen.getByTestId('gizli-pod').textContent).toContain('3 pod gizli');
    fireEvent.click(screen.getByText('aramayı temizle'));
    await waitFor(() => expect(screen.getByText('rapor-uret-28394829-ab12c')).toBeTruthy());
  });

  it('batch tahmini: CronJob adi ya da bitmis is durumu', () => {
    expect(batchPodMu({ name: 'rapor-28394829-ab12c', status: 'Running' })).toBe(true);
    expect(batchPodMu({ name: 'is-q8w7e', status: 'Completed' })).toBe(true);
    expect(batchPodMu({ name: 'kart-ui-7d8f9c5b4-x2k9p', status: 'Running' })).toBe(false);
    expect(batchPodMu({ name: 'kart-ui-7d8f9c5b4-x2k9p', status: 'CrashLoopBackOff' })).toBe(false);
  });
});
