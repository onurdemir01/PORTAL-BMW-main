// @vitest-environment jsdom
// Performance (Dynatrace) sayfası (2026-11-26, kapsam PR-2; dal %44): bağlantı yok / görünür sekme yok, ortam seçimi,
// Problemler (durum, host araması, yenile, detay penceresi: gömülü JSON özeti, kanıtlar, DT bağlantısı, düz metin,
// hata), Events (zaman / tip / host / tag / bölge, gruplama, boş, hata),
// Entities (arama zorunlu, ekip süzgeci, atanmamış ekip, boş sonuç, hata), Metrikler (liste, sorgu, ağ hatası dili),
// Instana (yapılandırılmamış, alt sekmeler, ortam, arama, ekip süzgeci, detay, hata, AI analist yönlendirmesi) ve
// Splunk (yapılandırılmamış, ürün / zaman aralığı, örnek satırlar, boş sonuç, hata).
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dt = vi.hoisted(() => ({
  health: vi.fn(),
  environments: vi.fn(),
  problems: vi.fn(),
  events: vi.fn(),
  entities: vi.fn(),
  metrics: vi.fn(),
  metricsQuery: vi.fn(),
  problemDetails: vi.fn(),
}));
vi.mock('@/api/dynatraceApi', async (orijinal) => ({
  ...(await orijinal<typeof import('@/api/dynatraceApi')>()),
  dynatraceApi: dt,
}));
const ins = vi.hoisted(() => ({
  health: vi.fn(),
  problems: vi.fn(),
  events: vi.fn(),
  services: vi.fn(),
}));
vi.mock('@/api/instanaApi', async (orijinal) => ({
  ...(await orijinal<typeof import('@/api/instanaApi')>()),
  instanaApi: ins,
}));
const spl = vi.hoisted(() => ({ health: vi.fn(), products: vi.fn(), search: vi.fn() }));
vi.mock('@/api/splunkApi', async (orijinal) => ({
  ...(await orijinal<typeof import('@/api/splunkApi')>()),
  splunkApi: spl,
}));
const gorunur = vi.hoisted(() => ({ sekmeler: null as string[] | null }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    canViewPage: (k: string) =>
      gorunur.sekmeler === null || gorunur.sekmeler.includes(k.replace('Perf:', '')),
  }),
}));

import DynatracePage from '../DynatracePage';

const ciz = () =>
  render(
    <MemoryRouter initialEntries={['/performance']}>
      <Routes>
        <Route path="/performance" element={<DynatracePage />} />
        <Route path="/ai-analyst" element={<div>AI ANALIST</div>} />
      </Routes>
    </MemoryRouter>,
  );
const sekme = (ad: string) => fireEvent.click(screen.getByRole('tab', { name: ad }));

beforeEach(() => {
  [dt, ins, spl].forEach((a) => Object.values(a).forEach((f) => f.mockReset()));
  gorunur.sekmeler = null;
  sessionStorage.clear();
  dt.health.mockResolvedValue({ mcpConnected: true });
  dt.environments.mockResolvedValue({
    ok: true,
    aliases: ['prod-a', 'test-a'],
    defaultAlias: 'prod-a',
  });
  dt.problems.mockResolvedValue({ ok: true, problems: [], text: '' });
  dt.events.mockResolvedValue({ ok: true, events: [], text: '' });
});

describe('Performance sayfası', () => {
  it('bağlantı yoksa Dynatrace sekmeleri yapılandırma uyarısı gösterir; görünür sekme yoksa boş durum', async () => {
    dt.health.mockResolvedValueOnce({ mcpConnected: false, lastError: { message: 'MCP kapalı' } });
    const a = ciz();
    expect(await screen.findByText('Bağlantı yok')).toBeTruthy();
    expect(await screen.findByText(/MCP kapalı/)).toBeTruthy();
    a.unmount();
    gorunur.sekmeler = [];
    ciz();
    expect(await screen.findByText('Bu sayfada size görünür bir sekme yok.')).toBeTruthy();
  });

  it('Entities: arama zorunlu, ekip süzgeci, atanmamış ekip, AI analist, boş sonuç ve hata', async () => {
    ciz();
    expect(await screen.findByText('Bağlı')).toBeTruthy();
    await waitFor(() => expect(screen.getByDisplayValue('prod-a')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('prod-a'), { target: { value: 'test-a' } });
    sekme('Entities');
    const ara = screen.getByRole('button', { name: 'Ara' }) as HTMLButtonElement;
    expect(ara.disabled).toBe(true);
    const ad = screen.getByPlaceholderText('Entity/host adı ara (örn: payment)');
    fireEvent.change(ad, { target: { value: ' odeme ' } });
    fireEvent.change(screen.getByPlaceholderText('Tag'), { target: { value: ' kart ' } });
    fireEvent.change(screen.getByPlaceholderText('Mgmt Zone'), { target: { value: ' bolge-1 ' } });
    dt.entities.mockResolvedValueOnce({
      ok: true,
      entities: [
        {
          entityId: 'SERVICE-1',
          displayName: 'odeme-api',
          type: 'SERVICE',
          owningTeam: 'Ekip-Kart',
        },
        {
          entityId: 'SERVICE-2',
          displayName: 'odeme-ui',
          type: 'SERVICE',
          owningTeam: 'Ekip-Mobil',
        },
        { entityId: 'SERVICE-3', displayName: 'odeme-batch', type: 'SERVICE' },
      ],
      text: 'ham',
    });
    fireEvent.keyDown(ad, { key: 'Enter' });
    expect(await screen.findByText('odeme-api')).toBeTruthy();
    expect(dt.entities).toHaveBeenCalledWith({
      name: 'odeme',
      type: 'SERVICE',
      env: 'test-a',
      tag: 'kart',
      managementZone: 'bolge-1',
    });
    expect(screen.getByText('Atanmamış ekip')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ekip-Mobil' }));
    expect(screen.queryByText('odeme-api')).toBeNull();
    expect(screen.getByText('odeme-ui')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tümü' }));
    expect(screen.getByText('odeme-api')).toBeTruthy();

    dt.entities.mockResolvedValueOnce({ ok: true, entities: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Ara' }));
    await waitFor(() => expect(screen.queryByText('odeme-api')).toBeNull());
    dt.entities.mockResolvedValueOnce({ ok: false, message: 'ECONNREFUSED 10.0.0.1:443' });
    fireEvent.click(screen.getByRole('button', { name: 'Ara' }));
    expect(await screen.findByText(/MCP sunucusuna ulaşılamıyor/)).toBeTruthy();
    dt.entities.mockRejectedValueOnce(new Error('beklenmeyen'));
    fireEvent.click(screen.getByRole('button', { name: 'Ara' }));
    expect(await screen.findByText('beklenmeyen')).toBeTruthy();
  });

  it('Metrikler: liste, sorgu (boş seçici gönderilmez), hata', async () => {
    ciz();
    await screen.findByText('Bağlı');
    sekme('Metrikler');
    dt.metrics.mockResolvedValueOnce({ ok: true, text: 'builtin:host.cpu.usage' });
    fireEvent.click(screen.getByRole('button', { name: 'Metrikleri Listele' }));
    expect(await screen.findByText('builtin:host.cpu.usage')).toBeTruthy();
    expect(dt.metrics).toHaveBeenCalledWith({ search: 'cpu.usage', env: 'prod-a' });
    const secici = screen.getByPlaceholderText(/Metric selector/);
    fireEvent.keyDown(secici, { key: 'Enter' });
    expect(dt.metricsQuery).not.toHaveBeenCalled();
    fireEvent.change(secici, { target: { value: 'builtin:host.cpu.usage:avg' } });
    dt.metricsQuery.mockResolvedValueOnce({ ok: true, text: 'avg=42' });
    fireEvent.click(screen.getByRole('button', { name: 'Sorgula' }));
    expect(await screen.findByText('avg=42')).toBeTruthy();
    dt.metricsQuery.mockResolvedValueOnce({ ok: false });
    fireEvent.keyDown(secici, { key: 'Enter' });
    expect(await screen.findByText('Dynatrace sunucusuna ulaşılamadı.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Metrik ara/), { target: { value: '  ' } });
    dt.metrics.mockRejectedValueOnce(new Error('zaman asimi'));
    fireEvent.keyDown(screen.getByPlaceholderText(/Metrik ara/), { key: 'Enter' });
    expect(await screen.findByText('zaman asimi')).toBeTruthy();
    expect(dt.metrics).toHaveBeenLastCalledWith({ search: undefined, env: 'prod-a' });
  });
});

describe('Problemler ve Events', () => {
  const DETAY_JSON = {
    problemId: 'P-1',
    displayId: 'P-2611',
    status: 'OPEN',
    severityLevel: 'PERFORMANCE',
    impactLevel: 'SERVICES',
    startTime: 1764150000000,
    endTime: 1764153600000,
    // Kacisli tirnak ve suslu parantez iceren metin: gomulu JSON ayiklayicisi dizgi icini saymamali.
    not: 'tirnak " ve { parantez',
    rootCauseEntity: { name: 'odeme-db' },
    affectedEntities: [{ name: 'odeme-api' }, { name: 'odeme-ui' }],
    managementZones: [{ name: 'kart' }],
    evidenceDetails: {
      details: [
        {
          evidenceType: 'EVENT',
          displayName: 'olay',
          data: { properties: [{ key: 'dt.event.description', value: 'Disk dolu' }] },
        },
        { evidenceType: 'EVENT', displayName: 'Yeniden baslama' },
        {
          evidenceType: 'METRIC',
          displayName: 'CPU',
          unit: 'Percent',
          valueBeforeChangePoint: 20,
          valueAfterChangePoint: 95.55,
        },
        { evidenceType: 'METRIC', displayName: 'Yanit suresi' },
        { evidenceType: 'TRANSACTIONAL', displayName: 'Islem yavas' },
        { evidenceType: 'BILINMEYEN' },
      ],
    },
  };
  const detayMetni = `Problem in the following json:\n${JSON.stringify(DETAY_JSON)}\nAc: https://dt.ornek.invalid/#problems/problemdetails;pid=<problemId>.`;

  it('Problemler: liste, durum, host araması, yenile, detay penceresi', async () => {
    dt.problems.mockResolvedValue({
      ok: true,
      problems: [
        {
          problemId: 'P-1',
          displayId: 'P-2611',
          title: 'Yanit suresi artti',
          status: 'OPEN',
          severityLevel: 'PERFORMANCE',
          impactLevel: 'SERVICES',
          startTime: '10:00',
        },
        {
          problemId: 'P-2',
          displayId: 'P-2612',
          title: 'Duz metin problem',
          status: 'OPEN',
          severityLevel: 'ERROR',
        },
      ],
      text: 'ham problem',
    });
    ciz();
    expect(await screen.findByText('Yanit suresi artti')).toBeTruthy();
    await waitFor(() =>
      expect(dt.problems).toHaveBeenLastCalledWith({
        env: 'prod-a',
        status: 'OPEN',
        host: undefined,
        refresh: false,
      }),
    );
    expect(screen.getByText(/P-2611 · OPEN · SERVICES/)).toBeTruthy();
    const host = screen.getByPlaceholderText('Başlıkta host/servis ara…');
    fireEvent.change(host, { target: { value: ' odeme ' } });
    fireEvent.keyDown(host, { key: 'Enter' });
    await waitFor(() =>
      expect(dt.problems).toHaveBeenLastCalledWith({
        env: 'prod-a',
        status: 'OPEN',
        host: 'odeme',
        refresh: false,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() =>
      expect(dt.problems).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true })),
    );

    // Detay: gomulu JSON ozeti.
    dt.problemDetails.mockResolvedValueOnce({ ok: true, text: detayMetni });
    fireEvent.click(screen.getByText('Yanit suresi artti').closest('button') as HTMLElement);
    const p = await screen.findByRole('dialog', { name: 'Problem Detayı' });
    expect(await within(p).findByText('odeme-db')).toBeTruthy();
    expect(dt.problemDetails).toHaveBeenCalledWith('P-1', 'prod-a');
    expect(within(p).getByText('P-2611')).toBeTruthy();
    expect(within(p).getByText('kart')).toBeTruthy();
    expect(within(p).getByText('Etkilenen Sistemler (2)')).toBeTruthy();
    for (const k of [
      'Disk dolu',
      'Yeniden baslama',
      'CPU: 20.0% → 95.5%',
      'Yanit suresi',
      'Islem yavas',
    ])
      expect(within(p).getByText(k)).toBeTruthy();
    // Adsiz ve turu bilinmeyen kanit listeye dusmez.
    expect(within(p).queryByText('undefined')).toBeNull();
    expect(within(p).getByText('Bitiş')).toBeTruthy();
    expect((within(p).getByRole('link') as HTMLAnchorElement).href).toBe(
      'https://dt.ornek.invalid/#problems/problemdetails;pid=P-1',
    );
    fireEvent.click(within(p).getByRole('button', { name: '×' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Problem Detayı' })).toBeNull(),
    );

    // Duz metin (JSON yok) ve hata.
    dt.problemDetails.mockResolvedValueOnce({ ok: true, text: 'yalniz metin' });
    fireEvent.click(screen.getByText('Duz metin problem').closest('button') as HTMLElement);
    expect(await screen.findByText('yalniz metin')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Problem Detayı' })).toBeNull(),
    );
    dt.problemDetails.mockRejectedValueOnce(new Error('detay yok'));
    fireEvent.click(screen.getByText('Duz metin problem').closest('button') as HTMLElement);
    expect(await screen.findByText(/detay yok/)).toBeTruthy();
    // AI analist: problem kimligiyle istem.
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Problem Detayı' })).getAllByRole('button')[0],
    );
    expect(await screen.findByText('AI ANALIST')).toBeTruthy();
    expect(sessionStorage.getItem('aiAnalystChatPrefill')).toContain('P-2');
  });

  it('Problemler: kapalı durum boş, hata', async () => {
    ciz();
    expect(await screen.findByText('Açık problem yok. Sistem normal çalışıyor.')).toBeTruthy();
    dt.problems.mockResolvedValueOnce({ ok: true, problems: [] });
    fireEvent.change(screen.getByDisplayValue('Açık'), { target: { value: 'CLOSED' } });
    expect(await screen.findByText('Kayıt bulunamadı.')).toBeTruthy();
    dt.problems.mockResolvedValueOnce({ ok: false, message: 'yetki yok' });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('yetki yok')).toBeTruthy();
    dt.problems.mockRejectedValueOnce(new Error('ag'));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('ag')).toBeTruthy();
  });

  it('Events: süzgeçler sorguya gider, aynı tip + başlık gruplanır, boş, hata', async () => {
    dt.events.mockResolvedValue({
      ok: true,
      events: [
        {
          eventId: 'e1',
          eventType: 'CONTAINER_RESTART',
          status: 'OPEN',
          title: 'Pod yeniden basladi',
          startTime: '10:00',
        },
        {
          eventId: 'e2',
          eventType: 'CONTAINER_RESTART',
          status: 'OPEN',
          title: 'Pod yeniden basladi',
        },
        { eventId: 'e3', eventType: 'OZEL_TIP', status: 'CLOSED', title: 'Ozel olay' },
      ],
      text: '',
    });
    ciz();
    await screen.findByText('Bağlı');
    sekme('Events');
    expect(await screen.findByText('2 benzersiz event (3 toplam)')).toBeTruthy();
    expect(screen.getByText('×2')).toBeTruthy();
    expect(screen.getByText('OZEL_TIP')).toBeTruthy();
    expect(screen.getByText(/CLOSED/)).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('Son 1 saat'), { target: { value: 'now-24h' } });
    fireEvent.change(screen.getByDisplayValue('Tüm event tipleri'), {
      target: { value: 'CONTAINER_RESTART' },
    });
    fireEvent.change(screen.getByPlaceholderText('Host'), { target: { value: ' h1 ' } });
    fireEvent.change(screen.getByPlaceholderText('Tag (k:v, virgüllü)'), {
      target: { value: ' a:b ' },
    });
    const bolge = screen.getByPlaceholderText('Management Zone');
    fireEvent.change(bolge, { target: { value: ' kart ' } });
    fireEvent.keyDown(bolge, { key: 'Enter' });
    await waitFor(() =>
      expect(dt.events).toHaveBeenLastCalledWith({
        env: 'prod-a',
        from: 'now-24h',
        eventType: 'CONTAINER_RESTART',
        refresh: false,
        host: 'h1',
        tag: 'a:b',
        managementZone: 'kart',
      }),
    );
    dt.events.mockResolvedValueOnce({ ok: true, events: [] });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('Seçilen aralıkta event bulunamadı.')).toBeTruthy();
    expect(dt.events).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    dt.events.mockResolvedValueOnce({ ok: false, message: 'events kapali' });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('events kapali')).toBeTruthy();
    dt.events.mockRejectedValueOnce(new Error('zaman asimi'));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('zaman asimi')).toBeTruthy();
  });
});

describe('Instana ve Splunk', () => {
  it('Instana: alt sekmeler, ortam, arama, ekip süzgeci, detay, hata, AI analist', async () => {
    dt.health.mockResolvedValue({ mcpConnected: false });
    ins.health.mockResolvedValue({ configured: true });
    ins.problems.mockResolvedValue({
      ok: true,
      items: [
        { title: 'Yuksek gecikme', state: 'OPEN', owningTeam: 'Ekip-Kart' },
        { name: 'Hata orani', owningTeam: 'Ekip-Mobil' },
        { foo: 1 },
      ],
    });
    ciz();
    await screen.findByText('Bağlantı yok');
    sekme('Instana');
    expect(await screen.findByText('Yuksek gecikme')).toBeTruthy();
    expect(screen.getByText('(başlıksız kayıt)')).toBeTruthy();
    expect(ins.problems).toHaveBeenCalledWith('nonprod', false, undefined);
    // Issues sekmesinde "Yenile" onbellegi atlar.
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(ins.problems).toHaveBeenLastCalledWith('nonprod', true, undefined));
    expect(await screen.findByText('Yuksek gecikme')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ekip-Mobil' }));
    expect(screen.queryByText('Yuksek gecikme')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tümü' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'detay' })[0]);
    expect(screen.getByText(/"state": "OPEN"/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'detayı gizle' }));

    ins.events.mockResolvedValueOnce({ ok: false, message: 'events kapali' });
    // Ust sekmelerde de "Events" var: Instana alt sekmesi ikincisi.
    fireEvent.click(screen.getAllByRole('tab', { name: 'Events' })[1]);
    expect(await screen.findByText('events kapali')).toBeTruthy();
    ins.services.mockResolvedValueOnce({ ok: true, services: [] });
    sekme('Services');
    expect(await screen.findByText('Kayıt bulunamadı.')).toBeTruthy();
    ins.services.mockRejectedValueOnce(new Error('ag'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'prod' } });
    expect(await screen.findByText('ag')).toBeTruthy();
    ins.services.mockResolvedValueOnce({ ok: true, services: [{ serviceName: 'odeme-svc' }] });
    const arama = screen.getByPlaceholderText('Servis/host ara…');
    fireEvent.change(arama, { target: { value: ' odeme ' } });
    fireEvent.keyDown(arama, { key: 'Enter' });
    expect(await screen.findByText('odeme-svc')).toBeTruthy();
    expect(ins.services).toHaveBeenLastCalledWith('prod', false, 'odeme');
    ins.services.mockResolvedValueOnce({ ok: true, services: [{ serviceName: 'odeme-svc' }] });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(ins.services).toHaveBeenLastCalledWith('prod', true, 'odeme'));
    // AI analist: kart düğmesi istemi yazıp yönlendirir.
    fireEvent.click(
      within(
        screen.getByText('odeme-svc').closest('div')?.parentElement as HTMLElement,
      ).getAllByRole('button')[0],
    );
    expect(await screen.findByText('AI ANALIST')).toBeTruthy();
    expect(sessionStorage.getItem('aiAnalystChatPrefill')).toContain('"odeme-svc"');
  });

  it('Instana yapılandırılmamış / sağlık hatası', async () => {
    dt.health.mockResolvedValue({ mcpConnected: false });
    ins.health.mockResolvedValueOnce({ configured: false });
    const a = ciz();
    await screen.findByText('Bağlantı yok');
    sekme('Instana');
    expect(await screen.findByText(/Instana ortam token\/URL/)).toBeTruthy();
    a.unmount();
    ins.health.mockRejectedValueOnce(new Error('instana yok'));
    ciz();
    await screen.findByText('Bağlantı yok');
    sekme('Instana');
    expect(await screen.findByText('instana yok')).toBeTruthy();
  });

  it('Splunk: ürün ve zaman aralığı, örnek satırlar, boş sonuç, hata, yapılandırılmamış', async () => {
    gorunur.sekmeler = ['splunk'];
    dt.health.mockResolvedValue({ mcpConnected: false });
    spl.health.mockResolvedValue({ configured: true });
    spl.products.mockResolvedValue({ products: ['kart', 'mobil'] });
    spl.search.mockResolvedValueOnce({
      ok: true,
      eventCount: 2,
      sample: ['ERROR satir 1', 'WARN satir 2'],
      query: 'search index=kart',
    });
    const a = ciz();
    expect(await screen.findByText('ERROR satir 1')).toBeTruthy();
    expect(spl.search).toHaveBeenCalledWith({ product: 'kart', windowMinutes: 15, refresh: false });
    // Sorgu metni katlanir: once gizli.
    expect(screen.queryByText('search index=kart')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ham çıktıyı göster' }));
    expect(screen.getByText('search index=kart')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ham çıktıyı gizle' }));
    spl.search.mockResolvedValueOnce({ ok: true, eventCount: 0, sample: [] });
    fireEvent.change(screen.getByDisplayValue('Son 15 dk'), { target: { value: '60' } });
    expect(await screen.findByText('Seçilen ürün/zaman aralığında kayıt bulunamadı.')).toBeTruthy();
    expect(spl.search).toHaveBeenLastCalledWith({
      product: 'kart',
      windowMinutes: 60,
      refresh: false,
    });
    spl.search.mockResolvedValueOnce({ ok: false, message: 'connect ECONNREFUSED' });
    fireEvent.change(screen.getByDisplayValue('kart'), { target: { value: 'mobil' } });
    expect(await screen.findByText(/port 8089/)).toBeTruthy();
    spl.search.mockRejectedValueOnce(new Error('beklenmeyen'));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('beklenmeyen')).toBeTruthy();
    expect(spl.search).toHaveBeenLastCalledWith({
      product: 'mobil',
      windowMinutes: 60,
      refresh: true,
    });
    a.unmount();
    spl.health.mockResolvedValueOnce({ configured: false });
    ciz();
    expect(await screen.findByText(/Splunk|yapılandır/i)).toBeTruthy();
    expect(spl.products).toHaveBeenCalledTimes(1);
  });
});
