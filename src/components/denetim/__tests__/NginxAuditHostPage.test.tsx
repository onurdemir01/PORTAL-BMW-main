// @vitest-environment jsdom
// Denetim > Nginx Audit > sunucu sayfasi (2026-11-25, kapsam PR-2; %0): yukleme / hata / son taramada olmayan sunucu,
// baslik rozetleri (ortam kaynagi, intranet / internet, nginx -T), istisna ve nginx -T hata notlari, sayac kutulari,
// server / location / upstream tablolari (bos durumlar), ayar karsilastirmasi (uyumlu / eksik / sapma, override'lar),
// kurulum dosyasi uyumu (DDL yok / veri yok / birebir / farkli / yok / hukum yok) ve yenile.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NginxAuditHost } from '@/api/denetimApi';

const api = vi.hoisted(() => ({ nginxAuditHost: vi.fn() }));
vi.mock('@/api/denetimApi', () => ({ denetimApi: api }));

import NginxAuditHostPage from '../NginxAuditHostPage';

const host = (ek: Partial<NginxAuditHost> = {}): NginxAuditHost =>
  ({
    host: 'ORNGXP01',
    env: 'PROD',
    envSource: 'name',
    site: 'Pendik',
    tier: 'intranet',
    status: 'ok',
    statusMsg: '',
    files: 3,
    serverBlocks: 2,
    locations: 10,
    locationsProxy: 8,
    upstreams: 2,
    upsNoResolve: 1,
    upsNoKeepalive: 0,
    upsNoZone: 0,
    unusedUpstreams: 1,
    proxyFqdn: 1,
    proxyUndefined: 1,
    settingsMismatch: 2,
    issues: 4,
    servers: [
      {
        file: 'a.conf',
        filePath: '/etc/nginx/conf.d/a.conf',
        seq: 1,
        listen: '443 ssl',
        serverName: 'kart.ornek.invalid',
        ssl: true,
        cert: 'kart.crt',
        certPath: '/ssl/kart.crt',
        locations: 6,
      },
      {
        file: 'a.conf',
        filePath: '/etc/nginx/conf.d/a.conf',
        seq: 2,
        listen: '',
        serverName: '',
        ssl: true,
        cert: '',
        certPath: '',
        locations: 0,
      },
      {
        file: 'b.conf',
        filePath: '/etc/nginx/conf.d/b.conf',
        seq: 3,
        listen: '80',
        serverName: 'eski',
        ssl: false,
        cert: '',
        certPath: '',
        locations: 4,
      },
    ],
    locationsByFile: [
      {
        file: 'a.conf',
        filePath: '/etc/nginx/conf.d/a.conf',
        total: 6,
        proxy: 5,
        toUpstream: 3,
        toFqdn: 1,
        undefined: 1,
        other: 1,
        fqdnList: [{ location: '/dis/', target: 'dis.ornek.invalid' }],
        undefinedList: [{ location: '/kayip/', target: 'kayip_ups' }],
      },
      {
        file: 'b.conf',
        filePath: '/etc/nginx/conf.d/b.conf',
        total: 4,
        proxy: 0,
        toUpstream: 0,
        toFqdn: 0,
        undefined: 0,
        other: 4,
        fqdnList: [],
        undefinedList: [],
      },
    ],
    upstreamList: [
      {
        name: 'kart_ups',
        server: '10.0.0.1:8443',
        file: 'a.conf',
        resolve: true,
        keepalive: false,
        zone: true,
        used: true,
      },
      {
        name: 'bos_ups',
        server: '',
        file: 'a.conf',
        resolve: false,
        keepalive: false,
        zone: false,
        used: false,
      },
    ],
    settingsMismatched: [
      { directive: 'client_max_body_size', context: 'http', value: '50m', reference: '10m' },
    ],
    settingsOverrides: [
      {
        directive: 'proxy_read_timeout',
        value: '600s',
        context: 'location',
        reference: '60s',
        count: 3,
      },
    ],
    settingsAll: [
      {
        directive: 'server_tokens',
        context: 'http',
        value: 'off',
        reference: 'off',
        matches: true,
        file: 'bmw_defaults.conf',
      },
      {
        directive: 'client_max_body_size',
        context: 'http',
        value: '50m',
        reference: '10m',
        matches: false,
        file: '',
      },
      {
        directive: 'gzip',
        context: 'http',
        value: null,
        reference: 'off',
        matches: false,
        file: null,
      },
    ],
    refFiles: [
      {
        refFile: 'nginx.conf',
        path: '/etc/nginx/nginx.conf',
        exists: true,
        identical: true,
        missing: 0,
        changed: 0,
        extra: 0,
        details: [],
      },
      {
        refFile: 'proxy_settings.conf',
        path: '/etc/nginx/proxy_settings.conf',
        exists: true,
        identical: false,
        missing: 1,
        changed: 1,
        extra: 1,
        details: [
          { kind: 'missing', key: 'proxy_buffering', ref: 'on', server: null },
          { kind: 'changed', key: 'proxy_read_timeout', ref: '60s', server: '600s' },
          { kind: 'extra', key: 'proxy_hide_header', ref: null, server: 'X-Powered-By' },
          { kind: 'garip', key: 'x', ref: 'a', server: 'b' },
        ],
      },
      {
        refFile: 'rate_limits.conf',
        path: '/etc/nginx/rate_limits.conf',
        exists: false,
        identical: null,
        missing: 0,
        changed: 0,
        extra: 0,
        details: [],
      },
      {
        refFile: 'eski.conf',
        path: '/etc/nginx/eski.conf',
        exists: true,
        identical: null,
        missing: 0,
        changed: 0,
        extra: 0,
        details: [],
      },
    ],
    exception: null,
    refFilesDiff: 1,
    refFilesMissing: 1,
    ...ek,
  }) as unknown as NginxAuditHost;

const yanit = (h: NginxAuditHost | null, ek: Record<string, unknown> = {}) => ({
  ok: true,
  host: h,
  scanDate: '2026-11-24',
  filesReady: true,
  schemaReady: true,
  ...ek,
});

function ciz(yol = '/denetim/nginx-audit/orngxp01') {
  return render(
    <MemoryRouter initialEntries={[yol]}>
      <Routes>
        <Route path="/denetim/nginx-audit/:host" element={<NginxAuditHostPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => api.nginxAuditHost.mockReset());

describe('NginxAuditHostPage', () => {
  it('hata, yenile ve son taramada olmayan sunucu', async () => {
    api.nginxAuditHost.mockRejectedValueOnce(new Error('ag koptu'));
    ciz();
    expect(await screen.findByText('ag koptu')).toBeTruthy();
    expect(api.nginxAuditHost).toHaveBeenCalledWith('ORNGXP01');
    api.nginxAuditHost.mockResolvedValueOnce({ ok: false, message: 'Tablo yok' });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('Tablo yok')).toBeTruthy();
    api.nginxAuditHost.mockResolvedValueOnce(yanit(null));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    expect(await screen.findByText('Bu sunucu son taramada yok')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Listeye dön' }).getAttribute('href')).toBe(
      '/nginx-console?tab=audit',
    );
  });

  it('dolu sayfa: rozetler, sayaclar, tablolar, ayarlar ve dosya uyumu', async () => {
    api.nginxAuditHost.mockResolvedValueOnce(yanit(host()));
    ciz();
    expect(await screen.findByText('nginx -T geçerli')).toBeTruthy();
    expect(screen.getByText('PROD').getAttribute('title')).toBe(
      'Ortam sunucu adı kalıbından türetildi',
    );
    expect(screen.getByText('Intranet')).toBeTruthy();
    expect(screen.getByText(/Tarama: 2026-11-24/)).toBeTruthy();
    expect(screen.getByTitle('3 konfigürasyon dosyası')).toBeTruthy();
    expect(screen.getByTitle('1 resolve yok · 0 keepalive yok · 1 kullanılmıyor')).toBeTruthy();
    expect(screen.getByTitle('4 dosya kontrol edildi · 1 sunucuda yok')).toBeTruthy();
    // server bloklari: sertifikasiz ssl "yok!", bos alanlar "—"
    expect(screen.getByText('yok!')).toBeTruthy();
    expect(screen.getByText('kart.crt')).toBeTruthy();
    // location: liste rozetleri
    expect(screen.getByText('/kayip/ → kayip_ups').getAttribute('title')).toMatch(
      /ne upstream ne çözümlenebilir/,
    );
    expect(screen.getByText('/dis/ → dis.ornek.invalid')).toBeTruthy();
    expect(screen.getByText("Upstream'ler (2)")).toBeTruthy();
    // ayarlar
    expect(screen.getByText('1 / 3 direktif referanstan sapıyor.')).toBeTruthy();
    expect(screen.getByText('✓ uyumlu')).toBeTruthy();
    expect(screen.getByText('✗ sapma')).toBeTruthy();
    expect(screen.getByText('✗ eksik')).toBeTruthy();
    expect(screen.getByText('tanımlı değil')).toBeTruthy();
    expect(screen.getByText(/Yerel override'lar \(1\)/)).toBeTruthy();
    expect(screen.getByText('proxy_read_timeout 600s', { exact: false })).toBeTruthy();
    // dosya uyumu
    expect(screen.getByText('birebir')).toBeTruthy();
    expect(screen.getByText('1 eksik · 1 değişmiş · 1 fazla')).toBeTruthy();
    expect(screen.getByText('sunucuda YOK')).toBeTruthy();
    expect(screen.getByText('hüküm yok')).toBeTruthy();
    expect(screen.getByText('X-Powered-By')).toBeTruthy();
    expect(screen.getByText('garip')).toBeTruthy();
    expect(screen.queryByText('Bu sunucu denetim istisnası')).toBeNull();
  });

  it('istisna, nginx -T hatasi, internet, bos tablolar, uyumlu ayarlar, dosya tablosu yok', async () => {
    api.nginxAuditHost.mockResolvedValueOnce(
      yanit(
        host({
          envSource: 'inventory-unknown',
          site: '',
          tier: 'internet',
          status: 'fail',
          statusMsg: 'unknown directive "foo"',
          exception: { note: 'Devreden cikiyor', by: 'adm1', at: '2026-11-20T10:00:00Z' },
          servers: [],
          locationsByFile: [],
          upstreamList: [],
          settingsMismatched: [],
          settingsAll: [
            {
              directive: 'server_tokens',
              context: 'http',
              value: 'off',
              reference: 'off',
              matches: true,
              file: 'x',
            },
          ],
          settingsOverrides: [],
          proxyUndefined: 0,
          proxyFqdn: 0,
          settingsMismatch: 0,
          refFilesDiff: 0,
        } as Partial<NginxAuditHost>),
        { filesReady: false },
      ),
    );
    ciz();
    expect(await screen.findByText('nginx -T HATA')).toBeTruthy();
    expect(screen.getByText('PROD').getAttribute('title')).toBe(
      'Envanter kaydı var ama ortam değeri tanınmıyor',
    );
    expect(screen.getByText('Internet')).toBeTruthy();
    expect(screen.queryByText('Pendik')).toBeNull();
    expect(screen.getByText('Devreden cikiyor')).toBeTruthy();
    expect(screen.getByText(/adm1 ·/)).toBeTruthy();
    expect(screen.getByText('unknown directive "foo"')).toBeTruthy();
    expect(screen.getByText('server bloğu yok')).toBeTruthy();
    expect(screen.getByText('location yok')).toBeTruthy();
    expect(screen.getByText('Bu sunucuda upstream tanımı yok.')).toBeTruthy();
    expect(
      screen.getByText('Global ayarların tamamı referansla uyumlu (1 direktif).'),
    ).toBeTruthy();
    expect(screen.getByTitle('DDL henüz uygulanmadı')).toBeTruthy();
    expect(screen.getByText('Henüz açık değil')).toBeTruthy();
  });

  it('ortam kaynagi envanter / bilinmiyor; referans karsilastirmasi ve dosya verisi yok', async () => {
    api.nginxAuditHost.mockResolvedValueOnce(
      yanit(
        host({
          envSource: 'inventory',
          settingsAll: [],
          settingsMismatched: [],
          refFiles: [],
        } as Partial<NginxAuditHost>),
      ),
    );
    const { unmount } = ciz();
    expect(await screen.findByText('PROD')).toBeTruthy();
    expect(screen.getByText('PROD').getAttribute('title')).toMatch(/dbo.Inventory/);
    expect(screen.getByText('Bu taramada referans karşılaştırması yok.')).toBeTruthy();
    expect(screen.getByText(/dosya uyumu verisi taşımıyor/)).toBeTruthy();
    unmount();
    api.nginxAuditHost.mockResolvedValueOnce(
      yanit(host({ envSource: 'none' } as Partial<NginxAuditHost>)),
    );
    ciz();
    await waitFor(() =>
      expect(screen.getByText('PROD').getAttribute('title')).toBe(
        'Ne ad kalıbı ne envanter ortamı biliyor',
      ),
    );
    expect(screen.getByText('kart_ups')).toBeTruthy();
  });
});
