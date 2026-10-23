// Denetim > Web-App (2026-10-16). Kullanıcı: (1) "Eşleşme nasıl kuruldu yazımını her bir uygulama için
// kendi satırına yaz", (2) 3-tier topolojisi "bilinmiyor", (3) "uygulama sunucularını ve eşleşen web
// sunucularını tek sıraya işleyemez miyiz? aynı web sunucular tekrar tekrar yazılmış", (4) "Ankara
// IP'lerinin hiçbiri çözülememiş".
//   WG1 aynı uygulama + ortam -> TEK satır; web sunucuları tekil; her uygulama sunucusu satırda
//   WG2 açıklama satırın içinde, uygulama sunucusu başına (sunucunun `nasil` cümleleri)
//   WG3 aynı ad, farklı ortam -> ayrı satır (prod ile QA karışmaz)
//   WG4 DNS bölgesi vhost'tan: uygulama domain'i boşken Ankara üyesi Ankara DNS'iyle çözülür
//   WG5 topoloji rozeti kaynağını söyler (domain yok -> eşleşme kanıtı)
//   WG6 grupla(): tekilleştirme + hangi uygulama sunucusundan geldiği
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import WebApp from '@/components/denetim/WebApp';
import { grupla } from '@/components/denetim/webAppGrup';
import type { WebAppResult, WebAppRow } from '@/api/denetimApi';

const mockWebApp = vi.hoisted(() => vi.fn());
const mockDns = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', () => ({ denetimApi: { webApp: mockWebApp, webAppDns: mockDns } }));

const vh = (host: string, ip: string, site: string, ek: Record<string, unknown> = {}) =>
  ({ host, ip, port: '443', serverName: 'crm.gtdmz.com.tr', confFile: '/c', product: 'IHS', site, ...ek });
const satir = (appHost: string, ek: Partial<WebAppRow> = {}): WebAppRow => ({
  app: 'crm', appHost, env: 'Production', domain: 'gtdmz.com.tr', dnsBolge: 'gtdmz', tier: '3-tier', tierKaynak: 'domain',
  how: 'harf-dönüşümü + server_name (tam ad) + mod_cluster', matched: true,
  nasil: [`Topoloji 3-tier: envanterdeki domain gtdmz.com.tr`, `${appHost} → GBCRWP01: 5. harf A→W — server_name'de "crm" geçiyor`],
  web: [vh('GBCRWP01', '10.0.0.1', 'Pendik'), vh('GBCRWP02', '10.0.0.2', 'Pendik', { kaynak: 'mc', mcBalancer: 'crm' })],
  webHostCandidate: 'GBCRWP01', vhostCountOnHost: 2, ...ek,
});
const veri = (rows: WebAppRow[]): WebAppResult => ({
  ok: true, source: 'mw', label: 'JBoss', sources: [{ key: 'mw', label: 'JBoss' }], certMissing: false,
  total: rows.length, shown: rows.length, capped: false, matchedTotal: rows.length,
  matchSummary: [{ how: 'harf-dönüşümü + server_name (tam ad)', count: rows.length }], tierSummary: [{ tier: '3-tier', count: rows.length }], rows,
});

describe('Web-App: uygulama başına tek satır', () => {
  beforeEach(() => { mockWebApp.mockReset(); mockDns.mockReset(); mockDns.mockResolvedValue({ ok: true, sonuc: {} }); });

  it('WG1 aynı uygulama + ortamın iki sunucusu tek satır; aynı web sunucuları bir kez', async () => {
    mockWebApp.mockResolvedValue(veri([satir('GBCRAP01'), satir('GBCRAP02')]));
    render(<WebApp />);
    const satirlar = await screen.findAllByTestId('webapp-satir');
    expect(satirlar).toHaveLength(1);
    const tr = satirlar[0];
    expect(within(tr).getAllByText('GBCRWP01')).toHaveLength(1);
    expect(within(tr).getAllByText('GBCRWP02')).toHaveLength(1);
    expect(within(tr).getAllByText('GBCRAP01').length).toBeGreaterThanOrEqual(1);
    expect(within(tr).getAllByText('GBCRAP02').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1 uygulama · 2 \/ 2 uygulama sunucusu/)).toBeInTheDocument();
  });

  it('WG2 eşleşme açıklaması satırda, her uygulama sunucusu için kendi cümleleriyle', async () => {
    mockWebApp.mockResolvedValue(veri([satir('GBCRAP01'), satir('GBCRAP02')]));
    render(<WebApp />);
    const bloklar = await screen.findAllByTestId('webapp-nasil');
    expect(bloklar).toHaveLength(2);
    expect(within(bloklar[0]).getByText('GBCRAP01 → GBCRWP01: 5. harf A→W — server_name\'de "crm" geçiyor')).toBeInTheDocument();
    expect(within(bloklar[1]).getByText('GBCRAP02 → GBCRWP01: 5. harf A→W — server_name\'de "crm" geçiyor')).toBeInTheDocument();
    expect(within(bloklar[0]).getByText('eşleşti')).toBeInTheDocument();
  });

  it('WG3 aynı ad farklı ortam ayrı satır', async () => {
    mockWebApp.mockResolvedValue(veri([satir('GBCRAP01'), satir('GBCRAQ01', { env: 'QA' })]));
    render(<WebApp />);
    expect(await screen.findAllByTestId('webapp-satir')).toHaveLength(2);
  });

  it('WG4 domain boş: Ankara üyesi server_name bölgesiyle Ankara DNS\'ine sorulur, Pendik cevabı gösterilmez', async () => {
    const r = satir('DACRAAB01', {
      domain: '', dnsBolge: null, tierKaynak: 'eşleşme',
      web: [vh('DACRWAP01', '20.0.0.1', 'Ankara', { dnsBolge: 'gtdmz' })],
    });
    mockWebApp.mockResolvedValue(veri([r]));
    mockDns.mockResolvedValue({ ok: true, sonuc: { 'gtdmz|crm.gtdmz.com.tr': { Pendik: { ips: ['10.9.9.9'] }, Ankara: { ips: ['20.9.9.9'], dnsSunucusu: '10.236.238.22' } } } });
    render(<WebApp />);
    expect(await screen.findByText('20.9.9.9')).toBeInTheDocument();
    expect(screen.queryByText('10.9.9.9')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ankara VIP'i farklı olabilir/)).not.toBeInTheDocument();
    expect(mockDns).toHaveBeenCalledWith([{ ad: 'crm.gtdmz.com.tr', bolge: 'gtdmz' }]);
  });

  it('WG5 topoloji rozeti domain yoksa kanıtı söyler', async () => {
    mockWebApp.mockResolvedValue(veri([satir('GBCRAP01', { domain: '', tierKaynak: 'eşleşme' })]));
    render(<WebApp />);
    const tr = (await screen.findAllByTestId('webapp-satir'))[0];
    expect(within(tr).getByText('3-tier')).toHaveAttribute('title', 'Envanterde domain yok — eşleşme kanıtından');
  });

  // WG7 (2026-10-23, kullanıcı: "Eşleşme yolları ... aşırı kalabalık gözü yoruyor ... sadece satırların
  // en sonunda nasıl eşleştirildiğine dair bilgi kalsa"): özet kutusu YOK, yol satırda; Server Hub hatası
  // kutuyla birlikte kaybolmaz, tek başına uyarı olarak kalır.
  it('WG7 "Eşleşme yolları" özet kutusu yok; açıklama satırda; Server Hub hatası uyarı olarak kalır', async () => {
    mockWebApp.mockResolvedValue({ ...veri([satir('GBCRAP01')]), hubHata: 'vhost: zaman aşımı' });
    render(<WebApp />);
    expect(await screen.findAllByTestId('webapp-nasil')).toHaveLength(1);
    expect(screen.queryByText(/Eşleşme yolları/)).not.toBeInTheDocument();
    expect(screen.queryByText('Eşleştirme kuralları')).not.toBeInTheDocument();
    expect(screen.queryByText(/harf-dönüşümü \+ server_name \(tam ad\) · 1/)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Server Hub okunamadı (vhost: zaman aşımı)');
  });

  // WG8-WG9 (2026-10-23, kullanıcı: "sorgulama yaparken bir türlü getirmedi ... 'Yenile' butonu dönüp
  // duruyor"): Yenile sunucu önbelleğini atlar; yeni arama eskisini iptal eder, geç gelen eski cevap
  // yeni sonucu ezmez.
  it('WG8 Yenile fresh ile ister; arama ve ilk yükleme önbellekten', async () => {
    mockWebApp.mockResolvedValue(veri([satir('GBCRAP01')]));
    render(<WebApp />);
    await screen.findAllByTestId('webapp-satir');
    expect(mockWebApp.mock.calls[0][3]).toMatchObject({ fresh: false });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(mockWebApp).toHaveBeenCalledTimes(2));
    expect(mockWebApp.mock.calls[1][3]).toMatchObject({ fresh: true });
  });

  it('WG9 geç gelen eski cevap yeni arama sonucunu ezmez; eski istek iptal edilir', async () => {
    let eskiCoz: (v: WebAppResult) => void = () => {};
    mockWebApp
      .mockResolvedValueOnce(veri([satir('GBCRAP01')]))
      .mockImplementationOnce(() => new Promise<WebAppResult>((ok) => { eskiCoz = ok; }))
      .mockResolvedValueOnce(veri([satir('GBYENI01', { app: 'yeni' })]));
    render(<WebApp />);
    await screen.findAllByTestId('webapp-satir');
    const kutu = screen.getByPlaceholderText('uygulama ya da sunucu ara');
    fireEvent.change(kutu, { target: { value: 'e' } });
    await waitFor(() => expect(mockWebApp).toHaveBeenCalledTimes(2));
    const eskiSinyal = (mockWebApp.mock.calls[1][3] as { signal: AbortSignal }).signal;
    fireEvent.change(kutu, { target: { value: 'yeni' } });
    expect(await screen.findByText('yeni')).toBeInTheDocument();
    expect(eskiSinyal.aborted).toBe(true);
    eskiCoz(veri([satir('GBESKI01', { app: 'eski' })]));
    await new Promise((ok) => setTimeout(ok, 20));
    expect(screen.queryByText('eski')).not.toBeInTheDocument();
    expect(screen.getByText('yeni')).toBeInTheDocument();
  });

  it('WG6 grupla: vhost tekil, bulan uygulama sunucuları birikir; eşleşmeyen sunucu da satırda', () => {
    const g = grupla([satir('GBCRAP01'), satir('GBCRAP02'), satir('GBCRAP03', { matched: false, web: [], how: 'eşleşmedi' })]);
    expect(g).toHaveLength(1);
    expect(g[0].satirlar.map((r) => r.appHost)).toEqual(['GBCRAP01', 'GBCRAP02', 'GBCRAP03']);
    expect(g[0].web.map((w) => w.host)).toEqual(['GBCRWP01', 'GBCRWP02']);
    expect(g[0].web[0].uygulamaSunuculari).toEqual(['GBCRAP01', 'GBCRAP02']);
  });
});
