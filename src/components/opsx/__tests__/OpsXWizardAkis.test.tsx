// @vitest-environment jsdom
// OpsX sihirbazi akislari (2026-11-24, kapsam PR-2; dal %20). Adimlar sahte (kendi testleri ayri); burada sayfanin
// akisi: Legacy JBoss (restart -> serverconfig, thread dump -> JVM + dump sonucu), Openshift (restart -> cluster,
// heap dump -> pod, pod silme -> sonuc), WAS (JVM -> onay -> sonuc paneli), geri adimlari, baslatma reddi / hatasi,
// Smart onayi (bekleniyor, reddedildi, onay sonrasi is takibi), Admin'e Smart ayar dugmesi, Yeni Islem.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  run: vi.fn(),
  dumpLegacy: vi.fn(),
  dumpOpenshift: vi.fn(),
  podDeleteOpenshift: vi.fn(),
  jobStatus: vi.fn(),
  dumpStatus: vi.fn(),
  podDeleteStatus: vi.fn(),
  dumpDownloadUrl: (t: string) => `/indir/${t}`,
}));
const wasApi = vi.hoisted(() => ({ run: vi.fn(), runStatus: vi.fn() }));
vi.mock('@/api/opsxApi', () => ({ opsxApi: api, opsxWasApi: wasApi }));

type Is = {
  id: string;
  title: string;
  output: string;
  status?: string;
  pollErr?: string;
  result?: unknown;
};
const takip = vi.hoisted(() => ({ jobs: [] as Is[], addJob: vi.fn() }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => takip }));
const kim = vi.hoisted(() => ({
  user: { username: 'ornekkisi', role: 'User' } as { username: string; role: string },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => kim }));
const onay = vi.hoisted(() => ({
  talepSonu: null as null | { status: string; errorMessage?: string },
  cb: null as null | ((v: { jobId: number; awxServerId: number }) => void),
  sifirla: vi.fn(),
}));
vi.mock('../useOnaySonrasiTakip', () => ({
  useOnaySonrasiTakip: (
    _id: number | null,
    cb: (v: { jobId: number; awxServerId: number }) => void,
  ) => {
    onay.cb = cb;
    return {
      talepSonu: onay.talepSonu,
      sifirla: onay.sifirla,
      sonDurum: null,
      sonDurumAlindiMs: null,
    };
  },
}));
vi.mock('@/components/common/SmartTalepSayaci', () => ({ default: () => <div>talep sayaci</div> }));
vi.mock('@/components/self_service/KapamaOnayiUyarisi', () => ({
  default: () => <div>kapama uyarisi</div>,
}));
vi.mock('@/components/common/AnsibleLogTerminal', () => ({
  default: (p: { output: string; status: string }) => (
    <div>
      terminal {p.status}: {p.output}
    </div>
  ),
}));
vi.mock('../OpsXSmartConfigModal', () => ({
  default: (p: { open: boolean; onClose: () => void }) =>
    p.open ? (
      <button type="button" onClick={p.onClose}>
        smart ayari kapat
      </button>
    ) : null,
}));
const dugme = (etiket: string, fn: () => void) => (
  <button type="button" onClick={fn}>
    {etiket}
  </button>
);
vi.mock('../steps/PlatformStep', () => ({
  default: (p: { onSelect: (x: string) => void }) => (
    <div>
      {dugme('legacy sec', () => p.onSelect('legacy'))}
      {dugme('ocp sec', () => p.onSelect('openshift'))}
    </div>
  ),
}));
vi.mock('../steps/LegacyProductStep', () => ({
  default: (p: { onSelect: (x: string) => void }) => (
    <div>
      {dugme('jboss sec', () => p.onSelect('jboss'))}
      {dugme('was sec', () => p.onSelect('was'))}
    </div>
  ),
}));
vi.mock('../steps/AppSearchStep', () => ({
  default: (p: { onSelect: (x: string) => void }) =>
    dugme('uygulama sec', () => p.onSelect('pay-api')),
}));
vi.mock('../steps/JbossVersionStep', () => ({
  default: (p: { onSubmit: (v: string[]) => void }) =>
    dugme('surum sec', () => p.onSubmit(['7', ''])),
}));
vi.mock('../steps/HostSelectStep', () => ({
  default: (p: { onSubmit: (v: { hosts: string[]; hostMajors: string[] }) => void }) =>
    dugme('sunucu sec', () => p.onSubmit({ hosts: ['APP01', 'APP02'], hostMajors: ['7', '7'] })),
}));
vi.mock('../steps/OperationStep', () => ({
  default: (p: { onSelect: (x: string) => void; summary: React.ReactNode }) => (
    <div>
      <div data-testid="ozet">{p.summary}</div>
      {dugme('restart sec', () => p.onSelect('restart'))}
      {dugme('threaddump sec', () => p.onSelect('threaddump'))}
    </div>
  ),
}));
vi.mock('../steps/ServerConfigSelectStep', () => ({
  default: (p: { onSubmit: (v: { serverConfigMap: Record<string, unknown[]> }) => void }) =>
    dugme('serverconfig onayla', () =>
      p.onSubmit({ serverConfigMap: { APP01: [{ name: 'sc1' }] } }),
    ),
}));
vi.mock('../steps/LegacyJvmSelectStep', () => ({
  default: (p: { onSubmit: (v: { pidMap: Record<string, unknown[]> }) => void }) =>
    dugme('jvm onayla', () => p.onSubmit({ pidMap: { APP01: [{ pid: 4242 }] } })),
}));
vi.mock('../steps/OcpTargetStep', () => ({
  default: (p: { onSubmit: (v: unknown) => void }) =>
    dugme('hedef onayla', () =>
      p.onSubmit({
        env: 'prod',
        tenant: 'kart',
        pairs: [{ namespace: 'kart-prod', application: 'pay' }],
      }),
    ),
}));
vi.mock('../steps/OcpOperationStep', () => ({
  default: (p: { onSelect: (x: string) => void }) => (
    <div>
      {dugme('ocp restart', () => p.onSelect('restart'))}
      {dugme('ocp heapdump', () => p.onSelect('heapdump'))}
      {dugme('ocp poddelete', () => p.onSelect('poddelete'))}
    </div>
  ),
}));
vi.mock('../steps/OcpClusterPickStep', () => ({
  default: (p: { onSubmit: (c: string) => void }) =>
    dugme('cluster sec', () => p.onSubmit('ocp-a')),
}));
vi.mock('../steps/OcpPodSelectStep', () => ({
  default: (p: { mode: string; onSubmit: (v: unknown) => void }) =>
    dugme(`pod onayla ${p.mode}`, () =>
      p.onSubmit({
        pods: [{ cluster: 'ocp-a', namespace: 'kart-prod', pod: 'pay-1' }],
        consent: true,
        threadDumpCount: 3,
        threadDumpInterval: 5,
      }),
    ),
}));
vi.mock('../steps/WasAppSearchStep', () => ({
  default: (p: { onSubmit: (v: unknown) => void }) =>
    dugme('was uygulama', () =>
      p.onSubmit({ app: 'odeme', hosts: ['WAS01'], hostInfo: [{ host: 'WAS01', env: 'PROD' }] }),
    ),
}));
vi.mock('../steps/WasJvmSelectStep', () => ({
  default: (p: { onSubmit: (v: unknown) => void }) =>
    dugme('was jvm', () =>
      p.onSubmit({
        target: { host: 'WAS01', profile: 'AppSrv01', cell: 'c1', node: 'n1', server: 'srv1' },
        operation: 'restart',
        discovery: { jobId: 300, awxServerId: 2 },
      }),
    ),
}));
vi.mock('../steps/WasConfirmStep', () => ({
  default: (p: { env: string; onConfirm: (v: unknown) => void }) =>
    dugme(`was onayla ${p.env}`, () =>
      p.onConfirm({ confirmed: true, confirmText: 'srv1', ackWarnings: true }),
    ),
}));
vi.mock('../steps/WasResultPanel', () => ({
  default: (p: { jobId: number; awxStatus: string; launchWarning?: string; onNew: () => void }) => (
    <div>
      was sonucu #{p.jobId} {p.awxStatus} {p.launchWarning || ''}
      {dugme('was yeni', p.onNew)}
    </div>
  ),
}));

import OpsXWizardPage from '../OpsXWizardPage';

const tikla = (ad: string) => fireEvent.click(screen.getByRole('button', { name: ad }));

beforeEach(() => {
  for (const f of [
    api.run,
    api.dumpLegacy,
    api.dumpOpenshift,
    api.podDeleteOpenshift,
    api.jobStatus,
    api.dumpStatus,
    api.podDeleteStatus,
    wasApi.run,
    wasApi.runStatus,
  ])
    f.mockReset();
  takip.jobs = [];
  takip.addJob.mockReset();
  takip.addJob.mockReturnValue('is-1');
  kim.user = { username: 'ornekkisi', role: 'User' };
  onay.talepSonu = null;
  onay.sifirla.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('OpsXWizardPage akislar', () => {
  it('Legacy JBoss restart: adimlar, ozet, geri, red ve basari + canli cikti', async () => {
    api.run.mockResolvedValueOnce({ ok: false, message: 'Yetki yok' }).mockResolvedValueOnce({
      ok: true,
      jobId: 501,
      awxServerId: 1,
      status: 'pending',
      sentBody: { operation: 'restart' },
    });
    render(<OpsXWizardPage />);
    expect(screen.queryByRole('button', { name: /Geri/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Smart Onayı/ })).toBeNull();
    tikla('legacy sec');
    expect(screen.getByText('Uygulama Sunucusu')).toBeTruthy();
    tikla('jboss sec');
    tikla('uygulama sec');
    tikla('surum sec');
    tikla('sunucu sec');
    expect(screen.getByTestId('ozet').textContent).toContain('pay-api');
    expect(screen.getByTestId('ozet').textContent).toContain('JBoss 7, Bilinmiyor');
    expect(screen.getByTestId('ozet').textContent).toContain('2 sunucu: APP01, APP02');
    tikla('restart sec');
    // Geri: serverconfig -> islem secimi
    fireEvent.click(screen.getByRole('button', { name: /Geri/ }));
    expect(screen.getByText('İşlem Seçimi')).toBeTruthy();
    tikla('restart sec');
    tikla('serverconfig onayla');
    expect(await screen.findByText('Yetki yok')).toBeTruthy();
    takip.jobs = [
      {
        id: 'is-1',
        title: 'OpsX #501',
        output: 'TASK [restart]',
        status: 'running',
        pollErr: 'yoklama gecikti',
      },
    ];
    tikla('serverconfig onayla');
    expect(await screen.findByText('İşlem başlatıldı.')).toBeTruthy();
    expect(api.run).toHaveBeenLastCalledWith({
      platform: 'legacy',
      application: 'pay-api',
      operation: 'restart',
      hosts: ['APP01', 'APP02'],
      hostMajors: ['7', '7'],
      serverConfigMap: { APP01: [{ name: 'sc1' }] },
    });
    expect(takip.addJob).toHaveBeenCalledWith(expect.objectContaining({ title: 'OpsX #501' }));
    expect(screen.getByText('terminal running: TASK [restart]')).toBeTruthy();
    expect(screen.getByText(/yoklama gecikti/)).toBeTruthy();
    expect(screen.getByText(/"operation": "restart"/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Yeni İşlem/ }));
    expect(screen.getByRole('button', { name: 'legacy sec' })).toBeTruthy();
    expect(onay.sifirla).toHaveBeenCalled();
  });

  it('Legacy thread dump: JVM secimi, dump sonucu yoklanir ve indirme baglantisi', async () => {
    api.dumpLegacy.mockResolvedValueOnce({
      ok: true,
      jobId: 600,
      awxServerId: 1,
      status: 'pending',
      sentBody: { operation: 'threaddump' },
    });
    api.dumpStatus
      .mockResolvedValueOnce({ ok: true, status: 'running', results: [] })
      .mockResolvedValueOnce({
        ok: true,
        status: 'successful',
        results: [
          { ok: true, host: 'APP01', pid: 4242, downloadToken: 'tok1' },
          { ok: false, host: 'APP02', error: 'jstack yok' },
        ],
      });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<OpsXWizardPage />);
    tikla('legacy sec');
    tikla('jboss sec');
    tikla('uygulama sec');
    tikla('surum sec');
    tikla('sunucu sec');
    tikla('threaddump sec');
    expect(screen.getByText('JVM Seçimi')).toBeTruthy();
    tikla('jvm onayla');
    await waitFor(() =>
      expect(api.dumpLegacy).toHaveBeenCalledWith(
        'pay-api',
        ['APP01', 'APP02'],
        'threaddump',
        { APP01: [{ pid: 4242 }] },
        ['7', '7'],
      ),
    );
    expect(await screen.findByText('Dump alınıyor, lütfen bekleyin…')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    const indir = await screen.findByRole('link', { name: 'İndir' });
    expect(indir.getAttribute('href')).toBe('/indir/tok1');
    expect(screen.getByText('APP01 · PID 4242')).toBeTruthy();
    expect(screen.getByText(/jstack yok/)).toBeTruthy();
    expect(screen.queryByText(/"operation"/), 'dump akisinda ham govde gosterildi').toBeNull();
  });

  it('Openshift restart -> cluster; heap dump -> pod; reddedilen dump', async () => {
    api.run.mockResolvedValueOnce({
      ok: true,
      jobId: 701,
      awxServerId: 2,
      status: 'pending',
      sentBody: {},
    });
    render(<OpsXWizardPage />);
    tikla('ocp sec');
    expect(screen.getByText('Openshift Hedefi')).toBeTruthy();
    tikla('hedef onayla');
    tikla('ocp restart');
    expect(screen.getByText('Cluster Seçimi')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Geri/ }));
    tikla('ocp restart');
    tikla('cluster sec');
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith({
        platform: 'openshift',
        env: 'prod',
        tenant: 'kart',
        pairs: [{ namespace: 'kart-prod', application: 'pay' }],
        ocOperation: 'restart',
        cluster: 'ocp-a',
      }),
    );
    expect(await screen.findByText('İşlem başlatıldı.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Yeni İşlem/ }));

    api.dumpOpenshift.mockResolvedValueOnce({ ok: false, message: 'Pod yok' });
    tikla('ocp sec');
    tikla('hedef onayla');
    tikla('ocp heapdump');
    tikla('pod onayla dump');
    expect(await screen.findByText('Pod yok')).toBeTruthy();
    expect(api.dumpOpenshift).toHaveBeenCalledWith(
      'prod',
      'kart',
      [{ namespace: 'kart-prod', application: 'pay' }],
      [{ cluster: 'ocp-a', namespace: 'kart-prod', pod: 'pay-1' }],
      'heapdump',
      undefined,
      undefined,
    );
    // Geri: pod secimi -> islem secimi -> hedef -> platform
    fireEvent.click(screen.getByRole('button', { name: /Geri/ }));
    fireEvent.click(screen.getByRole('button', { name: /Geri/ }));
    fireEvent.click(screen.getByRole('button', { name: /Geri/ }));
    expect(screen.getByRole('button', { name: 'ocp sec' })).toBeTruthy();
  });

  it('Openshift pod silme: sonuclar yoklanir', async () => {
    api.podDeleteOpenshift.mockResolvedValueOnce({
      ok: true,
      jobId: 801,
      awxServerId: 2,
      status: 'pending',
      sentBody: {},
    });
    api.podDeleteStatus.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      overallStatus: 'partial',
      results: [
        { ok: true, pod: 'pay-1', namespace: 'kart-prod', cluster: 'ocp-a' },
        {
          ok: false,
          pod: 'pay-2',
          namespace: 'kart-prod',
          cluster: 'ocp-a',
          existence: 'Not Exist',
          error: 'yok',
        },
      ],
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<OpsXWizardPage />);
    tikla('ocp sec');
    tikla('hedef onayla');
    tikla('ocp poddelete');
    tikla('pod onayla poddelete');
    await waitFor(() =>
      expect(api.podDeleteOpenshift).toHaveBeenCalledWith(
        'prod',
        'kart',
        [{ namespace: 'kart-prod', application: 'pay' }],
        [{ cluster: 'ocp-a', namespace: 'kart-prod', pod: 'pay-1' }],
        true,
      ),
    );
    expect(await screen.findByText(/Pod'lar siliniyor/)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(await screen.findByText('kısmen')).toBeTruthy();
    expect(screen.getByText(/Silindi · yeni pod ayağa kalkıyor/)).toBeTruthy();
    expect(screen.getByText(/Bulunamadı — yok/)).toBeTruthy();
  });

  it('WAS: JVM -> onay -> sonuc paneli; baslatma reddi', async () => {
    wasApi.run.mockResolvedValueOnce({ ok: false, message: 'Kesif eski' }).mockResolvedValueOnce({
      ok: true,
      jobId: 900,
      awxServerId: 2,
      status: 'pending',
      historyWritten: false,
      warning: 'gecmis yazilamadi',
    });
    render(<OpsXWizardPage />);
    tikla('legacy sec');
    tikla('was sec');
    tikla('was uygulama');
    tikla('was jvm');
    tikla('was onayla PROD');
    expect(await screen.findByText('Kesif eski')).toBeTruthy();
    tikla('was onayla PROD');
    expect(await screen.findByText(/was sonucu #900 pending gecmis yazilamadi/)).toBeTruthy();
    expect(wasApi.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        app: 'odeme',
        host: 'WAS01',
        server: 'srv1',
        operation: 'restart',
        confirmed: true,
        discoverJobId: 300,
        discoverServerId: 2,
        ackWarnings: true,
      }),
    );
    const isTanimi = takip.addJob.mock.calls.at(-1)![0];
    expect(isTanimi.title).toBe('OpsX WAS restart srv1@WAS01 #900');
    wasApi.runStatus.mockResolvedValueOnce({ ok: false, message: 'durum yok' });
    await expect(isTanimi.fetchStatus()).rejects.toThrow('durum yok');
    wasApi.runStatus.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      output: 'tamam',
      result: { durum: 'OK' },
    });
    expect(await isTanimi.fetchStatus()).toMatchObject({ status: 'successful', output: 'tamam' });
    tikla('was yeni');
    expect(screen.getByRole('button', { name: 'legacy sec' })).toBeTruthy();
  });

  it('Smart onayi: bekleniyor, onay sonrasi is takibi; reddedilen talep; Admin ayar dugmesi', async () => {
    kim.user = { username: 'adm1', role: 'Admin' };
    const olay = vi.fn();
    window.addEventListener('portal:smart-ticket-created', olay);
    api.run.mockResolvedValue({
      ok: true,
      pendingApproval: true,
      ticketId: 77,
      externalTicketId: 'SM-9',
      staleWarning: 'katalog eski',
      awxServerId: 2,
      jobId: null,
      sentBody: {},
    });
    const { rerender } = render(<OpsXWizardPage />);
    tikla('Smart Onayı');
    tikla('smart ayari kapat');
    tikla('ocp sec');
    tikla('hedef onayla');
    tikla('ocp restart');
    tikla('cluster sec');
    expect(await screen.findByText('Onay bekleniyor — iş henüz başlamadı.')).toBeTruthy();
    expect(screen.getByText(/SM-9/)).toBeTruthy();
    expect(screen.getByText(/katalog eski/)).toBeTruthy();
    expect(screen.getByText('talep sayaci')).toBeTruthy();
    expect(screen.getByText('kapama uyarisi')).toBeTruthy();
    // Olay sonucu ciziminden SONRA pasif efektte yayilir; findByText DOM'u gorunce doner. Yuk
    // altinda (CI) efekt henuz kosmamis olabilir: olay bekleyerek dogrulanir.
    await waitFor(() => expect(olay).toHaveBeenCalled());
    act(() => onay.cb!({ jobId: 1234, awxServerId: 2 }));
    expect(await screen.findByText('İşlem başlatıldı.')).toBeTruthy();
    expect(takip.addJob).toHaveBeenCalledWith(expect.objectContaining({ title: 'OpsX #1234' }));
    window.removeEventListener('portal:smart-ticket-created', olay);

    fireEvent.click(screen.getByRole('button', { name: /Yeni İşlem/ }));
    onay.talepSonu = { status: 'REJECTED', errorMessage: 'Onaylayan reddetti' };
    rerender(<OpsXWizardPage />);
    tikla('ocp sec');
    tikla('hedef onayla');
    tikla('ocp restart');
    tikla('cluster sec');
    expect(await screen.findByTestId('opsx-talep-sonu')).toBeTruthy();
    expect(screen.getByText('Smart talebi reddedildi — iş başlatılmadı.')).toBeTruthy();
    expect(screen.getByText(/Onaylayan reddetti/)).toBeTruthy();
  });

  it('pod silme Smart onayindan sonra baslarsa sonuc yoklamasi baslar', async () => {
    api.podDeleteOpenshift.mockResolvedValueOnce({
      ok: true,
      pendingApproval: true,
      ticketId: 88,
      awxServerId: 2,
      jobId: null,
      sentBody: {},
    });
    api.podDeleteStatus.mockResolvedValue({
      ok: true,
      status: 'successful',
      overallStatus: 'ok',
      results: [],
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<OpsXWizardPage />);
    tikla('ocp sec');
    tikla('hedef onayla');
    tikla('ocp poddelete');
    tikla('pod onayla poddelete');
    expect(await screen.findByText('Onay bekleniyor — iş henüz başlamadı.')).toBeTruthy();
    expect(screen.queryByText('Pod Silme Sonuçları')).toBeNull();
    act(() => onay.cb!({ jobId: 4321, awxServerId: 2 }));
    expect(await screen.findByText('Pod Silme Sonuçları')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await waitFor(() => expect(api.podDeleteStatus).toHaveBeenCalledWith(2, 4321));
    expect(await screen.findByText('hepsi silindi')).toBeTruthy();
  });

  it('istek hatasi ekranda; is numarasi yoksa takip edilmez', async () => {
    api.run.mockRejectedValueOnce(new Error('ag koptu')).mockResolvedValueOnce({
      ok: true,
      jobId: null,
      awxServerId: 2,
      status: 'pending',
      sentBody: {},
    });
    render(<OpsXWizardPage />);
    tikla('ocp sec');
    tikla('hedef onayla');
    tikla('ocp restart');
    tikla('cluster sec');
    expect(await screen.findByText('ag koptu')).toBeTruthy();
    tikla('cluster sec');
    expect(await screen.findByText('İşlem başlatıldı.')).toBeTruthy();
    expect(takip.addJob).not.toHaveBeenCalled();
  });
});
