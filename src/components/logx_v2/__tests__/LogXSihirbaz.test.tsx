// src/components/logx_v2/__tests__/LogXSihirbaz.test.tsx
//
// LogX SİHİRBAZI ÇIKMAZ SOKAKLAR (2026-10-02, kullanıcı şikâyeti): "Legacy'de elle
// giriş yapınca sunucuları tek tek istiyor ama ilerletmiyor." Kök neden: tarama
// düğmesi yalnızca envanterden işaretlenenleri sayıyordu; elle girilen bir
// uygulamanın envanterde sunucusu olmadığı için düğme HİÇ açılmıyordu. Eski bekçi
// (ME9) kaynağa regex ile bakıyordu ve bunu göremedi — bunlar RENDER eder.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import HostSelectStep from '@/components/logx_v2/steps/legacy/HostSelectStep';
import AppSearchStep from '@/components/logx_v2/steps/legacy/AppSearchStep';
import FileSelectionStep from '@/components/logx_v2/steps/legacy/FileSelectionStep';
import AppNameStep from '@/components/logx_v2/steps/ocp/AppNameStep';
import ClusterSelectStep from '@/components/logx_v2/steps/ocp/ClusterSelectStep';
import JobProgress from '@/components/logx_v2/shared/JobProgress';

const m = vi.hoisted(() => ({
  legacyHosts: vi.fn(),
  searchLegacyApps: vi.fn(),
  inventoryApps: vi.fn(),
  playbookReadiness: vi.fn(),
  getClusterTree: vi.fn(),
  jobStatus: vi.fn(),
  cancelJob: vi.fn(),
  jobOutput: vi.fn(),
}));
vi.mock('@/api/logxV2Api', () => ({ logxV2Api: m }));

const host = (h: string) => ({ host: h, env: 'PROD', jbossVersion: '7.3', status: 'running' });
const taraDugmesi = () => screen.getByRole('button', { name: /Seçilenleri Tara/ });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.playbookReadiness.mockResolvedValue({ ok: true, rows: [] });
});

describe('HostSelectStep: elle giriş ilerliyor', () => {
  it('H1 envanter BOŞ + virgülle iki sunucu tek seferde → tara açık, ikisi gönderiliyor, odak kutuda', async () => {
    m.legacyHosts.mockResolvedValue({ ok: true, hosts: [] });
    const onSubmit = vi.fn();
    render(<HostSelectStep app="ELLE-APP" onSubmit={onSubmit} />);
    const kutu = await screen.findByLabelText('Sunucu adını elle girin');
    expect((taraDugmesi() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('logx-tara-sebep').textContent).toMatch(/en az bir sunucu adı/);
    fireEvent.change(kutu, { target: { value: 'gbcjap07, gbcjap08' } });
    fireEvent.click(screen.getByRole('button', { name: '2 sunucu ekle' }));
    expect(document.activeElement).toBe(kutu);
    expect((taraDugmesi() as HTMLButtonElement).disabled).toBe(false);
    expect(taraDugmesi().textContent).toMatch(/\(2\)/);
    fireEvent.click(taraDugmesi());
    expect(onSubmit).toHaveBeenCalledWith(['GBCJAP07', 'GBCJAP08'], {
      manual: ['GBCJAP07', 'GBCJAP08'],
    });
  });

  it('H2 envanter VAR ama yalnızca elle sunucu → tara açık; Enter ile ekleme', async () => {
    m.legacyHosts.mockResolvedValue({ ok: true, hosts: [host('GBCJAP01')] });
    const onSubmit = vi.fn();
    render(<HostSelectStep app="APP" onSubmit={onSubmit} />);
    const kutu = await screen.findByLabelText('Sunucu adını elle girin');
    fireEvent.change(kutu, { target: { value: 'GBCJAP09' } });
    fireEvent.keyDown(kutu, { key: 'Enter' });
    fireEvent.click(taraDugmesi());
    expect(onSubmit).toHaveBeenCalledWith(['GBCJAP09'], { manual: ['GBCJAP09'] });
  });

  it('H3 sunucu listesi OKUNAMAZSA da elle ekleyip devam edilebilir', async () => {
    m.legacyHosts.mockRejectedValue(new Error('Envanter DB bağlantısı yok.'));
    const onSubmit = vi.fn();
    render(<HostSelectStep app="APP" onSubmit={onSubmit} />);
    await screen.findByText(/Sunucu listesi okunamadı/);
    fireEvent.change(screen.getByLabelText('Sunucu adını elle girin'), {
      target: { value: 'H1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    fireEvent.click(taraDugmesi());
    expect(onSubmit).toHaveBeenCalledWith(['H1'], { manual: ['H1'] });
  });

  it('H4 geçersiz parça tüm eklemeyi durdurur ve hangisi olduğu söylenir', async () => {
    m.legacyHosts.mockResolvedValue({ ok: true, hosts: [] });
    render(<HostSelectStep app="APP" onSubmit={() => {}} />);
    const kutu = await screen.findByLabelText('Sunucu adını elle girin');
    fireEvent.change(kutu, { target: { value: 'IYI1, kötü$' } });
    expect(screen.getByText(/Geçersiz karakter/).textContent).toMatch(/KÖTÜ\$/);
    expect((screen.getByRole('button', { name: /Ekle/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('H5 geri dönüşte önceki elle sunucular korunur (initialManual)', async () => {
    m.legacyHosts.mockResolvedValue({ ok: true, hosts: [] });
    render(<HostSelectStep app="APP" onSubmit={() => {}} initialManual={['ESKI1']} />);
    await screen.findByLabelText('Sunucu adını elle girin');
    expect(screen.getByText('ESKI1')).toBeTruthy();
    expect(taraDugmesi().textContent).toMatch(/\(1\)/);
  });
});

describe('AppSearchStep', () => {
  it('A1 geçersiz ad anında söylenir ve serbest metin yolu çıkmaz; geçerli adda Enter ilerler', async () => {
    m.searchLegacyApps.mockResolvedValue({ ok: true, apps: [], fallbackMode: false });
    const onSelect = vi.fn();
    render(<AppSearchStep onSelect={onSelect} />);
    const kutu = screen.getByPlaceholderText(/Uygulama adı ara/);
    fireEvent.change(kutu, { target: { value: 'kötü ad' } });
    expect(screen.getByTestId('logx-app-bicim')).toBeTruthy();
    fireEvent.change(kutu, { target: { value: 'yeni-app' } });
    await waitFor(() => expect(m.searchLegacyApps).toHaveBeenCalledWith('yeni-app'));
    await waitFor(() => expect(screen.getByText(/adıyla devam et/)).toBeTruthy());
    fireEvent.keyDown(kutu, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('YENI-APP');
  });
});

describe('FileSelectionStep', () => {
  it('F1 taranamayan sunucu SEBEBİYLE; elle eklenen işaretli; sunucu seçimine dön', () => {
    const geri = vi.fn();
    render(
      <FileSelectionStep
        result={
          {
            overall_status: 'partial',
            hosts: [
              { host: 'OK1', status: 'ok', files: [] },
              { host: 'YANLIS1', status: 'failed', error: 'UNREACHABLE: ssh', files: [] },
            ],
          } as never
        }
        manualHosts={['YANLIS1']}
        onBackToHosts={geri}
        onSubmit={() => {}}
      />,
    );
    const t = screen.getByTestId('logx-taranamayan').textContent || '';
    expect(t).toMatch(/YANLIS1/);
    expect(t).toMatch(/envanterde yok — adı doğru mu\?/);
    expect(t).toMatch(/UNREACHABLE: ssh/);
    fireEvent.click(screen.getByRole('button', { name: 'Sunucu seçimine dön' }));
    expect(geri).toHaveBeenCalled();
  });

  // 2026-10-07: numarali log dizinleri (log1, logs2...) artik taranir. Keşif playbook'u AWX'e
  // ELLE kopyalanir; kopyalanmazsa AWX eski surumu kosar ve numarali dizinler SESSIZCE
  // taranmaz. Yeni playbook taradigi deseni artifact'a yazar; alan yoksa ekran soyler.
  it('F2 eski playbook kopyasi: numarali dizinlerin TARANMADIGI soylenir', () => {
    render(
      <FileSelectionStep
        result={{ overall_status: 'success', hosts: [{ host: 'OK1', status: 'ok', files: [] }] } as never}
        onSubmit={() => {}}
      />,
    );
    const t = screen.getByTestId('logx-eski-kesif').textContent || '';
    expect(t).toMatch(/eski keşif playbook/);
    expect(t).toMatch(/log1, logs2 gibi numaralı log dizinleri taranmadı/);
    expect(t).toMatch(/logx_legacy_discovery\.yml/);
    // Kapsam bilinmiyorken "su dizinlere bakildi" DENMEZ.
    expect(screen.queryByTestId('logx-tarama-kapsami')).not.toBeInTheDocument();
  });

  it('F3 guncel playbook: uyari yok; bos sonucta NEREYE bakildigi soylenir', () => {
    render(
      <FileSelectionStep
        result={
          {
            overall_status: 'success',
            log_dir_regex: 'logs?[0-9]*',
            hosts: [{ host: 'OK1', status: 'ok', files: [] }],
          } as never
        }
        onSubmit={() => {}}
      />,
    );
    expect(screen.queryByTestId('logx-eski-kesif')).not.toBeInTheDocument();
    expect(screen.getByText('Taranan sunucularda dosya bulunamadı.')).toBeInTheDocument();
    expect(screen.getByTestId('logx-tarama-kapsami').textContent).toMatch(/log, logs ve numaralı \(log1, logs2…\) dizinlere bakıldı/);
  });
});

describe('AppNameStep: elle uygulama adı görünür ve kaldırılabilir', () => {
  it('N1 Enter ile eklenen ad chip olarak görünür; ✕ kaldırır', async () => {
    m.inventoryApps.mockResolvedValue({
      ok: true,
      items: [{ name: 'listede-app', kind: 'Deployment' }],
      cached: true,
      fetchedAt: null,
      stale: false,
      source: 'x',
    });
    render(
      <AppNameStep
        env="prod"
        tenant="ark"
        clusters={['c1']}
        namespace="ns"
        onSubmit={() => {}}
        autoScanMemo={new Map()}
      />,
    );
    await screen.findByText('listede-app');
    const kutu = screen.getByPlaceholderText(/listede olmayan/);
    fireEvent.change(kutu, { target: { value: 'yeni-app' } });
    fireEvent.keyDown(kutu, { key: 'Enter' });
    const chip = screen.getByTestId('logx-elle-uygulamalar');
    expect(chip.textContent).toMatch(/yeni-app/);
    fireEvent.click(screen.getByRole('button', { name: 'yeni-app kaldır' }));
    expect(screen.queryByTestId('logx-elle-uygulamalar')).toBeNull();
    fireEvent.change(kutu, { target: { value: 'kötü ad' } });
    expect(screen.getByTestId('logx-ocp-app-bicim')).toBeTruthy();
  });
});

describe('ClusterSelectStep', () => {
  it('C1 yükleme hatasında Tekrar dene çalışır; kapalı Devam sebebini söyler', async () => {
    m.getClusterTree.mockRejectedValueOnce(new Error('503'));
    m.getClusterTree.mockResolvedValueOnce({ ok: true, tree: { prod: { ark: ['c1'] } } });
    render(<ClusterSelectStep onSubmit={() => {}} />);
    await screen.findByTestId('logx-cluster-hata');
    fireEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    await screen.findByText('prod');
    expect(screen.getByTestId('logx-cluster-sebep').textContent).toMatch(/ortam seçin/);
  });
});

describe('JobProgress', () => {
  it('J1 iptal başarısız olursa söylenir', async () => {
    m.jobStatus.mockResolvedValue({ status: 'running', elapsedSec: 1 });
    m.cancelJob.mockRejectedValue(new Error('AWX 500'));
    render(<JobProgress jobId={1} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /İşlemi İptal Et/ }));
    await waitFor(() =>
      expect(screen.getByTestId('logx-iptal-hata').textContent).toMatch(/AWX 500/),
    );
  });
});
