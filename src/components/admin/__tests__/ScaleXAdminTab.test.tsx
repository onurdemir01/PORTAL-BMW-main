// @vitest-environment jsdom
// Admin > ScaleX sekmesi (2026-11-24, kapsam PR-2): AWX baglantisi (DB / .env / tanimsiz / pasif), onay kapilari
// dugmesi ve SMART / OCO penceresi, cluster yetenekleri (kapsam suzgeci, tarama baslatma, okunamadi / hic
// taranmadi / bayat), OCO tanisi (yapilandirilmamis / okunamadi / simulasyon, ic nesneler), kesif suresi ozeti
// ve RBAC bulgulari (talep metni, dusurme). Is gecmisi paneli KapiKurali testinde.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sx = vi.hoisted(() => ({
  rbacFindings: vi.fn(),
  clearRbacFinding: vi.fn(),
  discoveryTiming: vi.fn(),
  ocoDiagnose: vi.fn(),
  history: vi.fn(),
  clusterCaps: vi.fn(),
  clusters: vi.fn(),
  discover: vi.fn(),
}));
vi.mock('@/api/scalexApi', () => ({ scalexApi: sx }));
const pr = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/api/playbookRegistryApi', () => ({ playbookRegistryApi: pr }));
const kapi = vi.hoisted(() => ({ ornek: { 'scalex.ortam': 'prod' } as Record<string, string> }));
vi.mock('../tabs/ScaleXKapiDurumu', () => ({
  default: (p: { reloadKey: number; onOrnekBaglam: (d: Record<string, string>) => void }) => (
    <div>
      kapi durumu {p.reloadKey}
      <button type="button" onClick={() => p.onOrnekBaglam(kapi.ornek)}>
        ornek bagla
      </button>
    </div>
  ),
}));
vi.mock('@/components/self_service/FieldOverridesModal', () => ({
  default: (p: {
    item: { awxServerId: number; awxTemplateId: number; title: string };
    smartBaglami?: { ad: string };
    onClose: () => void;
  }) => (
    <div>
      kapi penceresi {p.item.awxServerId}/{p.item.awxTemplateId} {p.smartBaglami?.ad ?? 'baglamsiz'}
      <button type="button" onClick={p.onClose}>
        pencereyi kapat
      </button>
    </div>
  ),
}));

import ScaleXAdminTab from '../tabs/ScaleXAdminTab';

const kayit = (ek: Record<string, unknown>) => ({
  keyName: 'scalex_run',
  awxTemplateId: null,
  effectiveTemplateId: null,
  envVarName: 'SCALEX_RUN_TEMPLATE_ID',
  awxServerId: null,
  enabled: true,
  ...ek,
});

beforeEach(() => {
  for (const f of [...Object.values(sx), pr.list]) f.mockReset();
  pr.list.mockResolvedValue({
    ok: true,
    playbooks: [
      kayit({ awxTemplateId: 41, awxServerId: 2 }),
      kayit({
        keyName: 'scalex_discovery',
        effectiveTemplateId: 42,
        envVarName: 'SCALEX_DISC',
        enabled: false,
      }),
      kayit({ keyName: 'baska_is', awxTemplateId: 99 }),
    ],
  });
  sx.history.mockResolvedValue({ ok: true, rows: [] });
  sx.rbacFindings.mockResolvedValue({ ok: true, findings: [] });
  sx.discoveryTiming.mockResolvedValue({ ok: true, timings: [] });
  sx.clusterCaps.mockResolvedValue({ ok: true, items: [], ttlDays: 7 });
  sx.clusters.mockResolvedValue({ ok: true, tree: { prod: { kart: ['ocp-a', 'ocp-b'] } } });
});

const bolum = (baslik: string) => screen.getByText(baslik).closest('section, .card') as HTMLElement;

describe('ScaleXAdminTab', () => {
  it('AWX baglantisi: DB, .env yedegi, pasif; onay kapilari penceresi', async () => {
    render(<ScaleXAdminTab />);
    expect(await screen.findByText('DB: #41')).toBeTruthy();
    expect(screen.getByText('.env: SCALEX_DISC')).toBeTruthy();
    expect(screen.getByText('AWX sunucusu: 2')).toBeTruthy();
    expect(screen.getByText('AWX sunucusu: varsayılan (1)')).toBeTruthy();
    expect(screen.getByText('pasif')).toBeTruthy();
    expect(screen.queryByText('baska_is')).toBeNull();
    expect(screen.getByText('kapi durumu 0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'SMART / OCO ayarlarını düzenle' }));
    expect(screen.getByText('kapi penceresi 2/41 baglamsiz')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'pencereyi kapat' }));
    // Pencere kapaninca durum karti yeniden okunur.
    expect(screen.getByText('kapi durumu 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ornek bagla' }));
    fireEvent.click(screen.getByRole('button', { name: 'SMART / OCO ayarlarını düzenle' }));
    expect(screen.getByText('kapi penceresi 2/41 scalex')).toBeTruthy();
  });

  it('template tanimsizsa duzenleme yerine yonlendirme; okuma hatasi gosterilir ve yenilenir', async () => {
    pr.list.mockResolvedValueOnce({ ok: true, playbooks: [] });
    render(<ScaleXAdminTab />);
    expect((await screen.findAllByText('Tanımsız')).length).toBe(2);
    expect(screen.queryByRole('button', { name: 'SMART / OCO ayarlarını düzenle' })).toBeNull();
    expect(screen.getByText(/satırına AWX Template ID girin/)).toBeTruthy();
    pr.list.mockResolvedValueOnce({ ok: false, message: 'Kayitlar okunamadi' });
    fireEvent.click(within(bolum('AWX bağlantısı')).getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('Kayitlar okunamadi')).toBeTruthy();
    pr.list.mockRejectedValueOnce(new Error('ag koptu'));
    fireEvent.click(screen.getAllByRole('button', { name: /Yenile/ })[0]);
    expect(await screen.findByText('ag koptu')).toBeTruthy();
  });

  it('cluster yetenekleri: satir durumlari, kapsam suzgeci, tarama', async () => {
    sx.clusterCaps.mockResolvedValue({
      ok: true,
      ttlDays: 7,
      items: [
        {
          env: 'prod',
          tenant: 'kart',
          clusterName: 'ocp-a',
          resourcesReadable: true,
          kinds: ['KafkaConnect', 'Redis'],
          rbac: { deployments: true, statefulsets: false },
          stale: true,
          fetchedAt: '2026-11-20T10:00:00Z',
          scannedBy: 'adm1',
          awxJobId: 700,
          expiresAt: '2026-11-27T10:00:00Z',
        },
        {
          env: 'prod',
          tenant: 'kart',
          clusterName: 'ocp-b',
          resourcesReadable: false,
          kinds: [],
          rbac: {},
          fetchedAt: '2026-11-21T10:00:00Z',
        },
        {
          env: 'prod',
          tenant: 'kart',
          clusterName: 'ocp-c',
          resourcesReadable: true,
          kinds: null,
          rbac: {},
          fetchedAt: '2026-11-19T10:00:00Z',
        },
      ],
    });
    render(<ScaleXAdminTab />);
    expect(await screen.findByText('2 ölçeklenebilir CRD')).toBeTruthy();
    expect(screen.getByText('KafkaConnect, Redis')).toBeTruthy();
    expect(screen.getByText('bayat')).toBeTruthy();
    expect(screen.getByText(/OKUNAMADI/)).toBeTruthy();
    expect(screen.getByText('hiç taranmadı')).toBeTruthy();
    expect(screen.getByText('statefulsets')).toBeTruthy();
    expect(screen.getByText(/AWX #700/)).toBeTruthy();
    expect(screen.getByText(/Kayıt 7 gün geçerli sayılır/)).toBeTruthy();

    const panel = bolum('Cluster yetenekleri');
    const tara = within(panel).getByRole('button', { name: /^Tara/ }) as HTMLButtonElement;
    expect(tara.disabled).toBe(true);
    await waitFor(() => expect(within(panel).getByRole('option', { name: 'prod' })).toBeTruthy());
    fireEvent.change(within(panel).getByLabelText('Ortam'), { target: { value: 'prod' } });
    fireEvent.change(within(panel).getByLabelText('Tenant'), { target: { value: 'kart' } });
    expect(within(panel).getByRole('button', { name: 'Tara (2 cluster)' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'bu kapsamı listele' }));
    await waitFor(() =>
      expect(sx.clusterCaps).toHaveBeenLastCalledWith({ env: 'prod', tenant: 'kart' }),
    );

    sx.discover.mockResolvedValueOnce({ ok: false, message: 'AWX kayit yok' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Tara (2 cluster)' }));
    expect(await within(panel).findByText('AWX kayit yok')).toBeTruthy();
    sx.discover.mockResolvedValueOnce({ ok: true, jobId: 812 });
    fireEvent.click(within(panel).getByRole('button', { name: 'Tara (2 cluster)' }));
    expect(await within(panel).findByText(/AWX işi #812 \(2 cluster\)/)).toBeTruthy();
    expect(sx.discover).toHaveBeenLastCalledWith(
      { env: 'prod', tenant: 'kart', namespace: '', clusters: ['ocp-a', 'ocp-b'], apps: [] },
      'capabilities',
    );
    // Ortam degisince tenant ve not sifirlanir.
    fireEvent.change(within(panel).getByLabelText('Ortam'), { target: { value: '' } });
    expect(within(panel).queryByText(/AWX işi #812/)).toBeNull();
    sx.discover.mockRejectedValueOnce(new Error('x'));
  });

  it('cluster yetenekleri bos ya da okunamaz', async () => {
    sx.clusterCaps.mockResolvedValueOnce({ ok: false, message: 'Envanter yok' });
    sx.clusters.mockRejectedValueOnce(new Error('agac yok'));
    render(<ScaleXAdminTab />);
    expect(await screen.findByText('Envanter yok')).toBeTruthy();
    sx.clusterCaps.mockResolvedValueOnce({ ok: true, items: [] });
    fireEvent.click(within(bolum('Cluster yetenekleri')).getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText(/Bu kapsamda taranmış cluster yok/)).toBeTruthy();
  });

  it('OCO tanisi: yapilandirilmamis, okunamadi, hata ve simulasyon', async () => {
    render(<ScaleXAdminTab />);
    const panel = await waitFor(() => bolum('OCO Tanı'));
    const sorgula = within(panel).getByRole('button', { name: 'Sorgula' }) as HTMLButtonElement;
    expect(sorgula.disabled).toBe(true);
    fireEvent.change(within(panel).getByPlaceholderText('22502813'), {
      target: { value: ' 22502813 ' },
    });

    sx.ocoDiagnose.mockResolvedValueOnce({ ok: false, notConfigured: true });
    fireEvent.click(sorgula);
    expect(await within(panel).findByText(/yapılandırılmamış/)).toBeTruthy();
    expect(sx.ocoDiagnose).toHaveBeenCalledWith({ number: '22502813', env: 'prod' });

    sx.ocoDiagnose.mockResolvedValueOnce({
      ok: false,
      lookupFailed: true,
      message: 'Kayit bulunamadi',
    });
    fireEvent.click(sorgula);
    expect(await within(panel).findByText('Kayit bulunamadi')).toBeTruthy();

    sx.ocoDiagnose.mockResolvedValueOnce({ ok: false, message: 'Servis 500' });
    fireEvent.click(sorgula);
    expect(await within(panel).findByText('Servis 500')).toBeTruthy();
    sx.ocoDiagnose.mockRejectedValueOnce(new Error('ag koptu'));
    fireEvent.click(sorgula);
    expect(await within(panel).findByText('ag koptu')).toBeTruthy();

    fireEvent.change(within(panel).getByDisplayValue('prod'), { target: { value: 'test' } });
    sx.ocoDiagnose.mockResolvedValueOnce({
      ok: true,
      scope: { env: 'test', action: 'stop' },
      simulation: { outcome: 'ALLOW', message: 'Pencere icinde' },
      window: { windowStartText: '01.12 22:00', windowEndText: '01.12 22:00', equal: true },
      plannedSource: 'interruption',
      gatePolicy: { ocoGateDisabled: true },
      missing: [{ path: 'Result.PlannedEndDate', why: 'pencere bitisi' }],
      fields: [
        {
          path: 'GetChangeOrderByWfInstanceIdResult.Result.Subject',
          type: 'string',
          read: true,
          value: 'Node gecisi',
        },
        {
          path: 'GetChangeOrderByWfInstanceIdResult.Result',
          type: 'object',
          read: false,
          value: null,
        },
      ],
      ignoredCount: 1,
      fieldsTruncated: true,
    });
    fireEvent.click(sorgula);
    expect(await within(panel).findByText('Kapı simülasyonu (test · stop · apply)')).toBeTruthy();
    expect(within(panel).getByText('ALLOW')).toBeTruthy();
    expect(within(panel).getByText(/başlangıç = bitiş verilmiş/)).toBeTruthy();
    expect(within(panel).getByText(/kaynak: PlannedInterruption/)).toBeTruthy();
    expect(within(panel).getByText(/OCO kapısı admin tarafından KAPATILMIŞ/)).toBeTruthy();
    expect(within(panel).getByText('PlannedEndDate')).toBeTruthy();
    expect(within(panel).getByText(/liste kırpıldı/)).toBeTruthy();
    expect(within(panel).getByText('Result.Subject')).toBeTruthy();
    expect(within(panel).getByText('OKUNUYOR')).toBeTruthy();
    expect(within(panel).queryByText('Result')).toBeNull();
    // "yok sayılıyor" ozet cumlesinde de geciyor: rozet ic nesneler acilinca eklenir.
    expect(within(panel).getAllByText('yok sayılıyor')).toHaveLength(1);
    fireEvent.click(within(panel).getByLabelText('iç nesneleri de göster'));
    expect(within(panel).getByText('Result')).toBeTruthy();
    expect(within(panel).getAllByText('yok sayılıyor')).toHaveLength(2);
    expect(within(panel).getByText('—')).toBeTruthy();
  });

  it('kesif suresi: ozet ve is kirilimi; olculmeyen "—"', async () => {
    const t = (ek: Record<string, unknown>) => ({
      id: 1,
      env: 'prod',
      tenant: 'kart',
      clusterName: 'ocp-a',
      namespace: 'kart-prod',
      mode: 'workloads',
      kinds: 12,
      cached: true,
      setupMs: 800,
      discoverMs: 300,
      elapsedMs: 1200,
      awxJobId: 900,
      createdAt: '2026-11-20T10:00:00Z',
      queueMs: 2000,
      jobMs: 9000,
      ...ek,
    });
    sx.discoveryTiming.mockResolvedValue({
      ok: true,
      timings: [
        t({}),
        t({ id: 2, clusterName: 'ocp-b', cached: false, elapsedMs: 3000, setupMs: null }),
        t({ id: 3, elapsedMs: null, awxJobId: 901, queueMs: null }),
      ],
    });
    render(<ScaleXAdminTab />);
    expect(await screen.findByText('Sıcak (önbellek tuttu)')).toBeTruthy();
    const panel = bolum('Keşif süresi (son 50)');
    const kutu = (ad: string) => within(panel).getByText(ad).parentElement as HTMLElement;
    expect(within(kutu('Sıcak (önbellek tuttu)')).getByText('1.2 sn')).toBeTruthy();
    expect(within(kutu('Soğuk (önbellek yok)')).getByText('3.0 sn')).toBeTruthy();
    expect(within(kutu('Ortalama setup')).getByText('800 ms')).toBeTruthy();
    expect(within(panel).getByText('İş kırılımı')).toBeTruthy();
    expect(within(panel).getAllByText('—').length).toBeGreaterThan(0);
    sx.discoveryTiming.mockResolvedValueOnce({ ok: false, message: 'Olcum tablosu yok' });
    fireEvent.click(within(panel).getByRole('button', { name: /Yenile/ }));
    expect(await within(panel).findByText('Olcum tablosu yok')).toBeTruthy();
  });

  it('RBAC bulgulari: istenebilir / kurulu degil ayrimi, talep metni, dusurme', async () => {
    const f = (ek: Record<string, unknown>) => ({
      id: 1,
      env: 'prod',
      tenant: 'kart',
      cluster: 'ocp-a',
      namespace: 'kart-prod',
      kind: 'KafkaConnect',
      resource: 'kafkaconnects',
      reason: 'no_permission',
      verb: 'list',
      firstSeenAt: '2026-11-20T10:00:00Z',
      ...ek,
    });
    sx.rbacFindings.mockResolvedValue({
      ok: true,
      findings: [
        f({}),
        f({ id: 2, kind: 'Redis', resource: null, verb: null }),
        f({ id: 3, reason: 'api_absent', kind: 'Mongo' }),
      ],
    });
    const yaz = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: yaz } });
    render(<ScaleXAdminTab />);
    expect(await screen.findByText('Platformdan istenebilir (2)')).toBeTruthy();
    expect(screen.getByText("Bu cluster'da kurulu değil (1)")).toBeTruthy();
    expect(screen.getByText('list kafkaconnects')).toBeTruthy();
    expect(screen.getByText('list Redis')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Talep metnini kopyala' }));
    await waitFor(() => expect(yaz).toHaveBeenCalled());
    const metin = yaz.mock.calls[0][0] as string;
    expect(metin).toContain('- ocp-a / kart-prod\n    list kafkaconnects\n    list Redis');
    expect(metin).not.toContain('Mongo');
    expect(await screen.findByRole('button', { name: 'Kopyalandı' })).toBeTruthy();

    sx.clearRbacFinding.mockRejectedValueOnce(new Error('silinemedi'));
    sx.rbacFindings.mockResolvedValueOnce({ ok: true, findings: [] });
    fireEvent.click(screen.getAllByTitle('Çözüldü — listeden düşür')[0]);
    expect(
      await screen.findByText(/Kayıt yok — keşiflerde okunamayan bir tip görülmedi/),
    ).toBeTruthy();
    expect(sx.clearRbacFinding).toHaveBeenCalledWith(1);
    sx.rbacFindings.mockResolvedValueOnce({ ok: false, message: 'Bulgu tablosu yok' });
    fireEvent.click(screen.getByRole('button', { name: 'RBAC bulgularını yenile' }));
    expect(await screen.findByText('Bulgu tablosu yok')).toBeTruthy();
  });
});
