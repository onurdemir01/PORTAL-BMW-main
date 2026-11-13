// BMW Hub sekmeleri (2026-11-11): Reboot Kontrolü ve Retirement Server Hub'dan BMW Hub'a taşındı.
//   BS1 varsayılan sekme Açık İşler; ?sekme=reboot / ?sekme=retirement doğrudan açar (derin link)
//   BS2 sekme tıklanınca URL değişir; ziyaret edilen sekme sökülmez, gizlenir
//   BS3 Server Hub'dan gelen retirement önerisi (location.state) kayıt formuna bir kez iletilir
//   BS4 Server Hub'da bu iki sekme yok; "Retirement kaydı aç" BMW Hub'a yönlendirir
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const oneriler: unknown[] = [];
vi.mock('@/components/server_hub/RebootKontroluTab', () => ({ default: () => <div>REBOOT_GOVDE</div> }));
vi.mock('@/components/server_hub/RetirementTab', () => ({
  default: ({ oneri }: { oneri: { uygulama: string; not: string; no: number } | null }) => {
    oneriler.push(oneri);
    return <div>RETIREMENT_GOVDE {oneri ? `${oneri.uygulama}#${oneri.no}` : 'yok'}</div>;
  },
}));
vi.mock('@/api/bmwHubApi', () => ({
  bmwHubApi: {
    liste: vi.fn(async () => ({
      isler: [],
      ozet: { acik: 0, gecikmis: 0, buHafta: 0, sahipsiz: 0, tamamlanan30: 0 },
      bugun: '2026-11-11',
      tavan: null,
    })),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: 'admin', displayName: 'Admin' } }) }));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import BmwHubPage from '@/components/bmw_hub/BmwHubPage';

function Konum() {
  const l = useLocation();
  return <div data-testid="konum">{l.search}|{l.state ? 'state' : 'bos'}</div>;
}

function kur(giris: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[giris]}>
      <Routes>
        <Route
          path="/bmw-hub"
          element={
            <>
              <BmwHubPage />
              <Konum />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  oneriler.length = 0;
});

describe('BMW Hub sekmeleri', () => {
  it('BS1 varsayılan Açık İşler; ?sekme= doğrudan açar', async () => {
    kur('/bmw-hub');
    expect(screen.getByRole('tab', { name: 'Açık İşler' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('REBOOT_GOVDE')).toBeNull();
    expect(await screen.findByText('Yeni iş')).toBeInTheDocument();
  });

  it('BS1b ?sekme=reboot yalnız Reboot Kontrolü\'nü kurar', () => {
    kur('/bmw-hub?sekme=reboot');
    expect(screen.getByRole('tab', { name: 'Reboot Kontrolü' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('REBOOT_GOVDE')).toBeVisible();
    expect(screen.queryByText('Yeni iş')).toBeNull();
  });

  it('BS2 sekme URL\'e yazılır; ziyaret edilen sekme gizlenir, sökülmez', () => {
    kur('/bmw-hub');
    fireEvent.click(screen.getByRole('tab', { name: 'Reboot Kontrolü' }));
    expect(screen.getByTestId('konum').textContent).toContain('?sekme=reboot');
    expect(screen.getByText('REBOOT_GOVDE')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Retirement' }));
    expect(screen.getByTestId('konum').textContent).toContain('?sekme=retirement');
    expect(screen.getByText('REBOOT_GOVDE')).not.toBeVisible();
    expect(screen.getByText(/RETIREMENT_GOVDE/)).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Açık İşler' }));
    expect(screen.getByTestId('konum').textContent?.startsWith('|')).toBe(true);
    expect(screen.getByText('Yeni iş')).toBeVisible();
  });

  it('BS3 Server Hub önerisi forma bir kez gider, state temizlenir', async () => {
    kur({ pathname: '/bmw-hub', search: '?sekme=retirement', state: { retireOneri: { uygulama: 'APP1', not: 'etiket' } } });
    expect(await screen.findByText('RETIREMENT_GOVDE APP1#1')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('konum').textContent).toBe('?sekme=retirement|bos'));
    expect(screen.getByText('RETIREMENT_GOVDE APP1#1')).toBeInTheDocument();
    const dolu = oneriler.filter(Boolean) as { no: number }[];
    expect(new Set(dolu.map((o) => o.no))).toEqual(new Set([1]));
  });
});

describe('BS4 Server Hub kaynak kapıları', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'server_hub', 'ServerHubPage.tsx'), 'utf8');
  it('Reboot Kontrolü / Retirement sekmesi Server Hub\'da yok', () => {
    expect(sh).not.toMatch(/<RebootKontroluTab\b/);
    expect(sh).not.toMatch(/<RetirementTab\b/);
    expect(sh).not.toMatch(/id: 'reboot'|id: 'retirement'/);
  });
  it('retirementAc BMW Hub\'ın retirement sekmesine state ile yönlendirir', () => {
    expect(sh).toMatch(
      /navigate\('\/bmw-hub\?sekme=retirement', \{ state: \{ retireOneri: \{ uygulama, not \} \} \}\)/,
    );
  });
});

// BS5 (kullanici, 2026-11-13): IP/Sunucu Sorgu, OCP Uygulama Sorgu ve Yuk Testi sol menude BMW Hub grubunda AYRI
// sayfa (2026-11-12'de BMW Hub sayfasinda sekmeydi; kullanici menude goremedi). Eski adresler yonlenir.
vi.mock('@/components/self_service/IpCheckSection', () => ({ default: () => <div>IP_GOVDE</div> }));
vi.mock('@/components/self_service/OpenshiftCheckSection', () => ({ default: () => <div>OCP_GOVDE</div> }));
describe('BMW Hub — menüdeki sorgu ve yük testi sayfaları', () => {
  it('BS5 BMW Hub sayfasında artık sorgu sekmesi yok; eski ?sekme=ip|ocp adresi yeni sayfaya yönlenir', async () => {
    kur('/bmw-hub');
    const sekmeler = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    expect(sekmeler).not.toEqual(expect.arrayContaining(['IP/Sunucu Sorgu']));
    const { default: TasinanSekme } = await import('@/routes/TasinanSekme');
    const { IpSorguPage, OcpSorguPage } = await import('@/components/bmw_hub/BmwHubSayfalari');
    for (const [eski, govde, arama] of [['/bmw-hub?sekme=ip&x=1', 'IP_GOVDE', '?x=1|bos'], ['/bmw-hub?sekme=ocp', 'OCP_GOVDE', '|bos']] as const) {
      const r = render(
        <MemoryRouter initialEntries={[eski]}>
          <Routes>
            <Route path="/bmw-hub" element={<TasinanSekme param="sekme" deger={['ip', 'ocp']} hedef={{ ip: '/ip-sorgu', ocp: '/ocp-sorgu' }}><div>ESKI</div></TasinanSekme>} />
            <Route path="/ip-sorgu" element={<><IpSorguPage /><Konum /></>} />
            <Route path="/ocp-sorgu" element={<><OcpSorguPage /><Konum /></>} />
          </Routes>
        </MemoryRouter>,
      );
      expect(await r.findByText(govde)).toBeTruthy();
      expect(r.getAllByTestId('konum').at(-1)!.textContent).toBe(arama);
      r.unmount();
    }
  });
  it('BS6 menü kaydı, rotalar, sunucu tohumu ve eski yer imleri', () => {
    const kok = path.join(__dirname, '..', '..', '..', '..');
    const oku = (rel: string) => fs.readFileSync(path.join(kok, rel), 'utf8');
    expect(oku('src/config/elements.ts')).toMatch(/itemIds: \['BmwHub', 'Envanter', 'Denetim', 'Nöbet', 'OcoTakvimi', 'IpSorgu', 'OcpSorgu', 'YukTesti'\]/);
    const app = oku('src/App.tsx');
    for (const [id, yol] of [['IpSorgu', '/ip-sorgu'], ['OcpSorgu', '/ocp-sorgu'], ['YukTesti', '/yuk-testi']]) {
      expect(app).toContain(`<PageVisibilityRoute pageId="${id}" />`);
      expect(app).toContain(`path="${yol}"`);
      expect(oku('server/db/mssql-setup.cjs')).toMatch(new RegExp(String.raw`element_key: '${id}',\s*element_type: 'page',\s*parent_key: 'navgroup:bmwhub'`));
    }
    expect(app).toMatch(/<TasinanSekme param="tab" deger="yuktesti" hedef="\/yuk-testi"><NginxConsolePage \/><\/TasinanSekme>/);
    const ss = oku('src/components/SelfServicePage.tsx');
    expect(ss).not.toMatch(/<IpCheckSection|<OpenshiftCheckSection/);
    expect(ss).toMatch(/'ip-sorgu': '\/ip-sorgu'/);
    expect(ss).toMatch(/'openshift-sorgu': '\/ocp-sorgu'/);
    // Sunucu: sorgu uclari yeni sayfa izniyle, yuk testi uclari YukTesti ya da eski sekme izniyle acilir.
    expect(oku('server/selfservice/index.cjs')).toMatch(/\["IpSorgu", "OcpSorgu", "BmwHub", "Self Service"\]/);
    const yt = oku('server/nginx-loadtest/index.cjs');
    expect(yt).toMatch(/if \(await canSee\(user, 'YukTesti'\)\) return next\(\);/);
    expect(yt).toMatch(/\(await canSee\(user, 'NginxConsole'\)\) && \(await canSee\(user, 'tab:nginx:yuktesti'\)\)/);
  });
});
