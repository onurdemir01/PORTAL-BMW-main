// src/components/denetim/__tests__/NginxProdMigrationSilme.test.tsx
//
// "Eski tanımı kaldır" onay penceresi (2026-10-04). Eski metin "Yeni sunuculara dokunulmaz"
// KOŞULSUZ bir vaatti ve YANLIŞTI: nginx_ops new_fleet'i görmezse silmeyi yeni PROD filosuna da
// götürür. Ekran artık sunucunun ön kontrolünü (/delete-guard) okur:
//   - kontrol geçerse "Yalnız ESKİ sunuculardan kaldırır; yeni filo korunur." gösterilir
//   - geçmezse vaat GÖSTERİLMEZ; NEDEN (ve ölçülemediyse bu) yazılır, onay düğmesi kapanır
//   - sunucu reddederse (409) neden ekrana gelir; sonra kontrol ölçülemediyse başarı metni söyler
//   - iş başlatılıp new_fleet yok sayıldıysa (new_fleet_ignored) sunucu mesajı AYNEN gelir
//     ("silme BAŞLATILMAZ" denmez: iş başlatılmıştı); survey uyarısı (warning) gösterilir
// Davranış olarak ölçülür (kaynak metni değil): bileşen gerçek DOM'da çizilir, API'ler taklit.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import NginxProdMigration from '@/components/denetim/NginxProdMigration';
import type { NginxMigrationResult } from '@/api/denetimApi';

const api = vi.hoisted(() => ({
  nginxMigration: vi.fn(),
  config: vi.fn(),
  deleteGuard: vi.fn(),
  remove: vi.fn(),
  trackingList: vi.fn(),
}));

vi.mock('@/api/denetimApi', () => ({ denetimApi: { nginxMigration: api.nginxMigration } }));
vi.mock('@/api/nginxMigrationApi', () => ({
  nginxMigrationApi: {
    config: api.config,
    deleteGuard: api.deleteGuard,
    remove: api.remove,
    create: vi.fn(),
    jobStatus: vi.fn(),
    saveConfig: vi.fn(),
  },
  nginxMigrationTrackingApi: { list: api.trackingList, save: vi.fn(), saveBulk: vi.fn() },
  nginxMigrationScanApi: { rescan: vi.fn() },
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: { servers: vi.fn().mockResolvedValue({ servers: [] }) } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: 'odemir', role: 'User' } }) }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

const KEPT = 'Yalnız ESKİ sunuculardan kaldırır; yeni filo korunur.';
const BLOCKED = 'Yeni filo korunamıyor — silme BAŞLATILMAZ';

function veri(): NginxMigrationResult {
  return {
    ok: true,
    proxyReady: true,
    dirsReady: true,
    proxyScanDate: '2026-10-03',
    dirScanDate: '2026-10-03',
    ownersReady: true,
    groups: [
      {
        id: 'glomo',
        label: 'GLOMO',
        oldHosts: ['GBRVPP07'],
        newHosts: ['GBNGXP40'],
        newHostsScanned: ['GBNGXP40'],
        oldHostsSeen: ['GBRVPP07'],
        serviceLocations: [{ service: 'GLOMO', locations: 1, defined: 1, partial: 0, none: 0, notScanned: 0 }],
        apps: [
          {
            namespace: 'digital-banking-ch-prod',
            application: 'base-app-v0',
            how: 'route',
            target: 'base-app-v0.apps',
            targetSource: 'proxy_pass',
            suffixAdded: false,
            forms: ['upstream'],
            written: ['base_up'],
            services: ['GLOMO'],
            oldHosts: ['GBRVPP07'],
            locations: ['/base/'],
            locationCount: 1,
            paths: [{ service: 'GLOMO', location: '/base/', hosts: ['GBRVPP07'], newHosts: ['GBNGXP40'], newStatus: 'defined', traffic: null }],
            perHost: { GBNGXP40: { hys: true, app: true, conf: true } },
            readyHosts: 1,
            scannedHosts: 1,
            status: 'ready',
          },
        ],
        nonSpa: [],
        unresolved: [],
        totals: {
          apps: 1,
          ready: 1,
          partial: 0,
          missing: 0,
          notScanned: 0,
          nonSpa: 0,
          unresolved: 0,
          locations: { total: 1, defined: 1, partial: 0, none: 0, notScanned: 0 },
        },
      },
    ],
  };
}

async function pencereyiAc() {
  render(<NginxProdMigration />);
  const btn = await screen.findByRole('button', { name: /Eski tanımı kaldır/ });
  await waitFor(() => expect(btn).not.toBeDisabled());
  fireEvent.click(btn);
  return screen.findByRole('button', { name: /Evet, kaldırmayı zamanla/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.nginxMigration.mockResolvedValue(veri());
  api.config.mockResolvedValue({ ok: true, config: { awxServerId: 1, templateId: 10, deleteTemplateId: 20 } });
  api.trackingList.mockResolvedValue({ ok: true, rows: [], pathJobs: [] });
});

describe('Eski tanımı kaldır — yeni filo vaadi KOŞULLU', () => {
  it('ön kontrol geçerse vaat görünür, onay açık; eski koşulsuz vaat YOK', async () => {
    api.deleteGuard.mockResolvedValue({ ok: true, guard: { ok: true, via: 'survey' } });
    const onay = await pencereyiAc();
    expect(await screen.findByText(KEPT)).toBeInTheDocument();
    expect(screen.getByText(/survey sorusundan/)).toBeInTheDocument();
    expect(onay).not.toBeDisabled();
    expect(screen.queryByText(/Yeni sunuculara dokunulmaz/)).toBeNull();
    expect(api.deleteGuard).toHaveBeenCalledTimes(1);
    // Satir dugmesinin ipucu: vaat + kosulu (dogrulanamazsa is baslamaz) birlikte.
    const ipucu = screen.getByRole('button', { name: /Eski tanımı kaldır/ }).getAttribute('title') || '';
    expect(ipucu).toContain(KEPT);
    expect(ipucu).toContain('doğrulayamazsa işi başlatmaz');
  });

  it('ön kontrol geçmezse vaat YOK; neden + ÖLÇÜLEMEDİ yazılır; onay kapalı; yeniden kontrol edilebilir', async () => {
    api.deleteGuard.mockResolvedValue({
      ok: true,
      guard: { ok: false, code: 'template_unreadable', measured: false, message: 'NEDEN-template-okunamadi' },
    });
    const onay = await pencereyiAc();
    expect(await screen.findByText(BLOCKED)).toBeInTheDocument();
    expect(screen.getByText(/NEDEN-template-okunamadi/)).toBeInTheDocument();
    expect(screen.getByText(/Durum ÖLÇÜLEMEDİ \(yok demek değil\)/)).toBeInTheDocument();
    expect(screen.queryByText(KEPT)).toBeNull();
    expect(onay).toBeDisabled();
    fireEvent.click(onay);
    expect(api.remove).not.toHaveBeenCalled();
    api.deleteGuard.mockResolvedValue({ ok: true, guard: { ok: true, via: 'prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden kontrol et' }));
    expect(await screen.findByText(KEPT)).toBeInTheDocument();
    expect(onay).not.toBeDisabled();
    expect(api.deleteGuard).toHaveBeenCalledTimes(2);
  });

  it('ön kontrol okunamazsa (ağ hatası) vaat YOK, uyarı var; sunucu yine karar verir', async () => {
    api.deleteGuard.mockRejectedValue(new Error('ag-hatasi-x'));
    await pencereyiAc();
    expect(await screen.findByText('Yeni filo koruması kontrol edilemedi')).toBeInTheDocument();
    expect(screen.getByText(/ag-hatasi-x/)).toBeInTheDocument();
    expect(screen.queryByText(KEPT)).toBeNull();
  });

  it('sunucu 409 ile reddederse NEDEN ekrana gelir (yeni filo korunamıyor + ölçülemedi)', async () => {
    api.deleteGuard.mockResolvedValue({ ok: true, guard: { ok: true, via: 'prompt' } });
    api.remove.mockResolvedValue({ ok: false, code: 'survey_unreadable', measured: false, message: 'SUNUCU-NEDENI-42' });
    const onay = await pencereyiAc();
    await screen.findByText(KEPT);
    fireEvent.click(onay);
    const sonuc = await screen.findByText(/SUNUCU-NEDENI-42/);
    expect(sonuc.textContent).toContain(BLOCKED);
    expect(sonuc.textContent).toContain('Durum ÖLÇÜLEMEDİ (yok demek değil).');
  });

  it('iş BAŞLATILIP new_fleet yok sayıldıysa sunucunun mesajı AYNEN gelir; "silme BAŞLATILMAZ" DENMEZ', async () => {
    // new_fleet_ignored: iş başlatıldı, iptal edildi (ya da edilemedi). "Başlatılmaz" demek
    // yanlış olur ve kullanıcı AWX'e bakması gerektiğini kaçırır.
    api.deleteGuard.mockResolvedValue({ ok: true, guard: { ok: true, via: 'prompt' } });
    api.remove.mockResolvedValue({
      ok: false,
      code: 'new_fleet_ignored',
      canceled: true,
      cancelOutcome: 'canceled',
      message: 'IGNORED-MSG-77',
    });
    const onay = await pencereyiAc();
    await screen.findByText(KEPT);
    fireEvent.click(onay);
    const sonuc = await screen.findByText(/IGNORED-MSG-77/);
    expect(sonuc.textContent).toContain('IGNORED-MSG-77');
    expect(sonuc.textContent).not.toContain(BLOCKED);
    expect(sonuc.textContent).not.toContain('ÖLÇÜLEMEDİ (yok demek değil)');
  });

  it('survey sorusu DİĞER işleri bozuyorsa (ör. varsayılan false) uyarı görünür; silme yine açık', async () => {
    api.deleteGuard.mockResolvedValue({ ok: true, guard: { ok: true, via: 'survey', warning: 'UYARI-VARSAYILAN-88' } });
    const onay = await pencereyiAc();
    expect(await screen.findByText(KEPT)).toBeInTheDocument();
    expect(screen.getByText('UYARI-VARSAYILAN-88')).toBeInTheDocument();
    expect(screen.getByText("nginx_ops survey'i diğer işleri etkiliyor")).toBeInTheDocument();
    expect(onay).not.toBeDisabled();
  });

  it('uyarı yoksa uyarı notu da YOK', async () => {
    api.deleteGuard.mockResolvedValue({ ok: true, guard: { ok: true, via: 'survey' } });
    await pencereyiAc();
    expect(await screen.findByText(KEPT)).toBeInTheDocument();
    expect(screen.queryByText("nginx_ops survey'i diğer işleri etkiliyor")).toBeNull();
  });

  it('başarıda vaat yazılır; sonra kontrol ÖLÇÜLEMEDİYSE bu da söylenir', async () => {
    api.deleteGuard.mockResolvedValue({ ok: true, guard: { ok: true, via: 'prompt' } });
    api.remove.mockResolvedValue({
      ok: true,
      job: { id: null },
      oldHosts: ['GBRVPP07'],
      scheduled: true,
      newFleetGuard: { via: 'prompt', postCheck: 'olculemedi' },
    });
    const onay = await pencereyiAc();
    await screen.findByText(KEPT);
    fireEvent.click(onay);
    const sonuc = await screen.findByText(/kaldırma işi başlatıldı/);
    expect(sonuc.textContent).toContain(KEPT);
    expect(sonuc.textContent).toContain('AWX launch yanıtı bunu ayrıca doğrulayamadı');
  });
});
