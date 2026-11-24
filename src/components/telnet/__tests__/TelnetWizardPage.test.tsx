// @vitest-environment jsdom
// Telnet sihirbazi (2026-11-24, kapsam PR-2): Legacy ve Openshift akislari, geri adimlari, istek govdesi, basarisiz
// baslatma, is takibi (calisiyor / bitti ama sonuc yok / yapilandirilmis sonuc), satir suzgeci, iptal, ayni
// hedeflerle tekrar ve yeni test. Adimlar kendi testlerinde; burada yalniz sayfanin akisi.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/contexts/AuthContext';

const api = vi.hoisted(() => ({ run: vi.fn(), jobStatus: vi.fn(), cancel: vi.fn() }));
vi.mock('@/api/telnetApi', () => ({ telnetApi: api }));

type Is = {
  id: string;
  title: string;
  output: string;
  status?: string;
  done?: boolean;
  startedAt?: number;
  result?: unknown;
  pollErr?: string;
};
const takip = vi.hoisted(() => ({ jobs: [] as Is[], addJob: vi.fn() }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => takip }));

vi.mock('../steps/PlatformStep', () => ({
  default: (p: { onSelect: (x: string) => void }) => (
    <div>
      <button type="button" onClick={() => p.onSelect('legacy')}>
        legacy sec
      </button>
      <button type="button" onClick={() => p.onSelect('openshift')}>
        ocp sec
      </button>
    </div>
  ),
}));
vi.mock('../steps/AppSearchStep', () => ({
  default: (p: { onSelect: (x: string) => void }) => (
    <button type="button" onClick={() => p.onSelect('pay-api')}>
      uygulama sec
    </button>
  ),
}));
vi.mock('../steps/JbossVersionStep', () => ({
  default: (p: { app: string; onSubmit: (v: string[]) => void }) => (
    <button type="button" onClick={() => p.onSubmit(['8'])}>
      surum sec {p.app}
    </button>
  ),
}));
vi.mock('../steps/HostSelectStep', () => ({
  default: (p: { jbossVersions: string[]; onSubmit: (v: string[]) => void }) => (
    <button type="button" onClick={() => p.onSubmit(['APP01', 'APP02'])}>
      sunucu sec {p.jbossVersions.join(',')}
    </button>
  ),
}));
vi.mock('../steps/OcpTargetStep', () => ({
  default: (p: {
    onSubmit: (v: { env: string; tenant: string; namespaces: string[] }) => void;
  }) => (
    <button
      type="button"
      onClick={() => p.onSubmit({ env: 'PROD', tenant: 'odeme', namespaces: ['ns1', 'ns2'] })}
    >
      ocp hedef sec
    </button>
  ),
}));
vi.mock('../steps/OcpClusterPickStep', () => ({
  default: (p: { env: string; tenant: string; onSubmit: (c: string) => void }) => (
    <div>
      <button type="button" onClick={() => p.onSubmit('')}>
        tum clusterlar {p.env}/{p.tenant}
      </button>
      <button type="button" onClick={() => p.onSubmit('ocp-prod-1')}>
        tek cluster
      </button>
    </div>
  ),
}));
vi.mock('../steps/TelnetInputStep', () => ({
  default: (p: {
    summary: React.ReactNode;
    initial: { ip: string; port: string } | null;
    onSubmit: (v: { ip: string; port: string }) => void;
  }) => (
    <div>
      <div data-testid="ozet">{p.summary}</div>
      <span>ilk:{p.initial ? `${p.initial.ip}:${p.initial.port}` : '-'}</span>
      <button type="button" onClick={() => p.onSubmit({ ip: '10.0.0.5', port: '443' })}>
        test et
      </button>
    </div>
  ),
}));
vi.mock('../steps/TelnetResultPanel', () => ({
  default: (p: { result: { ozet: string } }) => <p>SONUC PANELI {p.result.ozet}</p>,
}));

import TelnetWizardPage from '../TelnetWizardPage';

function goster(role = 'User') {
  return render(
    <AuthContext.Provider value={{ user: { username: 'u', role } } as never}>
      <TelnetWizardPage />
    </AuthContext.Provider>,
  );
}
const tikla = (ad: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: ad }));
const legacyTesteKadar = () => {
  tikla('legacy sec');
  tikla('uygulama sec');
  tikla('surum sec pay-api');
  tikla('sunucu sec 8');
};

beforeEach(() => {
  vi.clearAllMocks();
  takip.jobs = [];
  takip.addJob.mockImplementation(() => 'is-1');
  api.run.mockResolvedValue({
    ok: true,
    jobId: 77,
    awxServerId: 2,
    status: 'pending',
    sentBody: { extra_vars: { ip: '10.0.0.5' } },
  });
  api.cancel.mockResolvedValue({ ok: true });
});

describe('TelnetWizardPage', () => {
  it('Legacy akisi: ozet, istek govdesi, is takibi ve calisiyor durumu', async () => {
    goster();
    legacyTesteKadar();
    const ozet = screen.getByTestId('ozet');
    expect(ozet.textContent).toContain('pay-api');
    expect(ozet.textContent).toContain('2 sunucu');
    tikla('test et');
    expect(await screen.findByText('Test çalışıyor…')).toBeTruthy();
    expect(api.run).toHaveBeenCalledWith({
      platform: 'legacy',
      application: 'pay-api',
      hosts: ['APP01', 'APP02'],
      ip: '10.0.0.5',
      port: '443',
    });
    const isTanimi = takip.addJob.mock.calls[0][0];
    expect(isTanimi.title).toBe('Telnet #77');
    isTanimi.fetchStatus();
    expect(api.jobStatus).toHaveBeenCalledWith(2, 77);
    expect(screen.getByText('#77')).toBeTruthy();
    // Admin olmayana AWX govdesi gosterilmez.
    expect(screen.queryByText(/AWX'e gönderilen gövde/)).toBeNull();
  });

  it('Openshift akisi: tum clusterlar "tumu" olarak gorunur ve istekte bos cluster', async () => {
    goster('Admin');
    tikla('ocp sec');
    tikla('ocp hedef sec');
    tikla('tum clusterlar PROD/odeme');
    expect(screen.getByTestId('ozet').textContent).toContain('tümü');
    expect(screen.getByTestId('ozet').textContent).toContain('ns1, ns2');
    tikla('test et');
    await screen.findByText('Test çalışıyor…');
    expect(api.run).toHaveBeenCalledWith({
      platform: 'openshift',
      env: 'PROD',
      tenant: 'odeme',
      namespaces: ['ns1', 'ns2'],
      cluster: '',
      ip: '10.0.0.5',
      port: '443',
    });
    expect(screen.getByText(/AWX'e gönderilen gövde/)).toBeTruthy();
  });

  it('geri dugmesi adim adim doner; platforma donus her seyi sifirlar', () => {
    goster();
    tikla('ocp sec');
    tikla('ocp hedef sec');
    tikla('tek cluster');
    expect(screen.getByText('Telnet Hedefi')).toBeTruthy();
    tikla(/Geri/);
    expect(screen.getByText('Cluster Seçimi')).toBeTruthy();
    tikla(/Geri/);
    expect(screen.getByText('Openshift Hedefi')).toBeTruthy();
    tikla(/Geri/);
    expect(screen.getByRole('button', { name: 'legacy sec' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Geri/ })).toBeNull();
    legacyTesteKadar();
    tikla(/Geri/);
    expect(screen.getByText('Sunucu Seçimi')).toBeTruthy();
    tikla(/Geri/);
    expect(screen.getByText('JBoss Sürümü')).toBeTruthy();
    tikla(/Geri/);
    expect(screen.getByText('Uygulama Seçimi')).toBeTruthy();
  });

  it('baslatma reddi ve hatasi ekranda; adim degismez', async () => {
    api.run.mockResolvedValueOnce({ ok: false, message: 'Uygulama-host eslesmedi (ornek)' });
    api.run.mockRejectedValueOnce(new Error('ag yok'));
    api.run.mockResolvedValueOnce({ ok: false });
    goster();
    legacyTesteKadar();
    tikla('test et');
    expect(await screen.findByText('Uygulama-host eslesmedi (ornek)')).toBeTruthy();
    tikla('test et');
    expect(await screen.findByText('ag yok')).toBeTruthy();
    tikla('test et');
    expect(await screen.findByText('İşlem başlatılamadı.')).toBeTruthy();
    expect(screen.getByText('Telnet Hedefi')).toBeTruthy();
    expect(takip.addJob).not.toHaveBeenCalled();
  });

  it('is takibi: sure, log suzgeci, iptal; bitince sonuc paneli ve ayni hedeflerle tekrar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now() - 125000;
    const { rerender } = goster();
    legacyTesteKadar();
    tikla('test et');
    await screen.findByText('Test çalışıyor…');
    takip.jobs = [
      {
        id: 'is-1',
        title: 'Telnet #77',
        output: '> acik 443\nbaska satir\n> kapali 80',
        status: 'running',
        startedAt: t0,
        pollErr: 'yoklama gecikti',
      },
    ];
    rerender(
      <AuthContext.Provider value={{ user: { username: 'u', role: 'User' } } as never}>
        <TelnetWizardPage />
      </AuthContext.Provider>,
    );
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByText(/2:0\d · running/)).toBeTruthy();
    expect(screen.getByText('yoklama gecikti')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Sadece şu karakterle başlayan/));
    fireEvent.change(screen.getByPlaceholderText('ör: >'), { target: { value: '>' } });

    // Iptal: hata mesaji gosterilir.
    api.cancel.mockResolvedValueOnce({ ok: false, message: 'Iptal edilemedi (ornek)' });
    tikla(/Testi durdur/);
    expect(await screen.findByText('Iptal edilemedi (ornek)')).toBeTruthy();
    expect(api.cancel).toHaveBeenCalledWith(2, 77);
    api.cancel.mockRejectedValueOnce(new Error('iptal agi'));
    tikla(/Testi durdur/);
    expect(await screen.findByText('iptal agi')).toBeTruthy();

    // Is bitti, yapilandirilmis sonuc yok.
    takip.jobs = [{ ...takip.jobs[0], done: true, status: 'successful' }];
    rerender(
      <AuthContext.Provider value={{ user: { username: 'u', role: 'User' } } as never}>
        <TelnetWizardPage />
      </AuthContext.Provider>,
    );
    expect(screen.getByText('İş bitti ama yapılandırılmış sonuç gelmedi.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Testi durdur/ })).toBeNull();
    // Sonuc geldi.
    takip.jobs = [{ ...takip.jobs[0], result: { ozet: '2 acik' } }];
    rerender(
      <AuthContext.Provider value={{ user: { username: 'u', role: 'User' } } as never}>
        <TelnetWizardPage />
      </AuthContext.Provider>,
    );
    expect(screen.getByText('SONUC PANELI 2 acik')).toBeTruthy();
    // Ayni hedeflerle tekrar: girdi adimi son hedefle acilir.
    tikla(/Aynı hedeflerle tekrar/);
    expect(screen.getByText('ilk:10.0.0.5:443')).toBeTruthy();
    vi.useRealTimers();
  });

  it('Yeni Test bastan baslatir', async () => {
    goster();
    legacyTesteKadar();
    tikla('test et');
    await screen.findByText('Test çalışıyor…');
    tikla(/Yeni Test/);
    expect(screen.getByRole('button', { name: 'legacy sec' })).toBeTruthy();
  });

  it('is numarasi yoksa takip edilmez ve iptal dugmesi yok', async () => {
    api.run.mockResolvedValueOnce({ ok: true, jobId: null, awxServerId: 2, status: 'pending' });
    goster();
    legacyTesteKadar();
    tikla('test et');
    await screen.findByText('Test çalışıyor…');
    expect(takip.addJob).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Testi durdur/ })).toBeNull();
    await waitFor(() => expect(screen.getByText(/0:00/)).toBeTruthy());
  });
});
