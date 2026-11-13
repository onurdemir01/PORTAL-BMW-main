// BMW Hub sayfaları. 2026-11-11: Reboot Kontrolü ve Retirement Server Hub'dan BMW Hub sayfasına SEKME olarak taşındı;
// 2026-11-13 (kullanıcı: "Reboot Kontrolü ile Retirement'ı Açık İşlerin içine koydun, BMW Hub'a eklemeni istemiştim")
// sol menüde BMW Hub grubunda AYRI sayfalar oldu (/reboot-kontrolu, /retirement).
//   BS1 /bmw-hub yalnız Açık İşler: sekme şeridi yok, Reboot / Retirement gövdesi kurulmaz
//   BS1b /reboot-kontrolu ve /retirement kendi başlığıyla kendi gövdesini kurar
//   BS2 eski /bmw-hub?sekme=reboot|retirement adresi yeni sayfaya gider, diğer parametreler kalır
//   BS3 Server Hub önerisi (location.state) Retirement formuna bir kez iletilir, state temizlenir;
//   BS3b eski adrese state ile gelen öneri yönlendirmede KAYBOLMAZ (TasinanSekme state'i taşır)
//   BS4 Server Hub'da bu iki sekme yok; "Retirement kaydı aç" ve App Hub "BMW Hub'da aç" doğrudan /retirement'a gider
//   BS5 IP/OCP sorgu sekmeleri ayrı sayfa; eski ?sekme=ip|ocp yönlenir
//   BS6 menü kaydı, rotalar, sunucu tohumu, sıra taşıması ve sunucu kapıları
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
vi.mock('@/components/self_service/IpCheckSection', () => ({ default: () => <div>IP_GOVDE</div> }));
vi.mock('@/components/self_service/OpenshiftCheckSection', () => ({ default: () => <div>OCP_GOVDE</div> }));

import BmwHubPage from '@/components/bmw_hub/BmwHubPage';
import RebootKontroluPage from '@/components/bmw_hub/RebootKontroluPage';
import RetirementPage from '@/components/bmw_hub/RetirementPage';
import { IpSorguPage, OcpSorguPage } from '@/components/bmw_hub/BmwHubSayfalari';
import TasinanSekme from '@/routes/TasinanSekme';

const KOK = path.join(__dirname, '..', '..', '..', '..');
const oku = (rel: string) => fs.readFileSync(path.join(KOK, rel), 'utf8');

function Konum() {
  const l = useLocation();
  return (
    <div data-testid="konum">
      {l.pathname}
      {l.search}|{l.state ? 'state' : 'bos'}
    </div>
  );
}

// App.tsx'teki /bmw-hub yönlendirmesiyle BİREBİR aynı değerler (BS6 App.tsx'te bu metni arar).
const ESKI_SEKMELER = ['ip', 'ocp', 'reboot', 'retirement'];
const YENI_YOLLAR: Record<string, string> = { ip: '/ip-sorgu', ocp: '/ocp-sorgu', reboot: '/reboot-kontrolu', retirement: '/retirement' };

function kur(giris: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[giris]}>
      <Routes>
        <Route
          path="/bmw-hub"
          element={
            <TasinanSekme param="sekme" deger={ESKI_SEKMELER} hedef={YENI_YOLLAR}>
              <>
                <BmwHubPage />
                <Konum />
              </>
            </TasinanSekme>
          }
        />
        <Route path="/reboot-kontrolu" element={<><RebootKontroluPage /><Konum /></>} />
        <Route path="/retirement" element={<><RetirementPage /><Konum /></>} />
        <Route path="/ip-sorgu" element={<><IpSorguPage /><Konum /></>} />
        <Route path="/ocp-sorgu" element={<><OcpSorguPage /><Konum /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  oneriler.length = 0;
});

describe('BMW Hub sayfaları', () => {
  it('BS1 /bmw-hub yalnız Açık İşler; sekme şeridi yok', async () => {
    kur('/bmw-hub');
    expect(await screen.findByText('Yeni iş')).toBeInTheDocument();
    // Acik Isler'in kendi Gorunum secicisi kalir; sayfa sekme seridi ("BMW Hub sekmeleri") yok.
    expect(screen.queryByRole('tablist', { name: 'BMW Hub sekmeleri' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Reboot Kontrolü' })).toBeNull();
    expect(screen.queryByText('REBOOT_GOVDE')).toBeNull();
    expect(screen.queryByText(/RETIREMENT_GOVDE/)).toBeNull();
  });

  it('BS1b /reboot-kontrolu ve /retirement kendi başlığıyla açılır', () => {
    const r = kur('/reboot-kontrolu');
    expect(screen.getByRole('heading', { name: 'Reboot Kontrolü' })).toBeInTheDocument();
    expect(screen.getByText('REBOOT_GOVDE')).toBeVisible();
    expect(screen.queryByText('Yeni iş')).toBeNull();
    r.unmount();
    kur('/retirement');
    expect(screen.getByRole('heading', { name: 'Retirement' })).toBeInTheDocument();
    expect(screen.getByText('RETIREMENT_GOVDE yok')).toBeVisible();
  });

  it('BS2 eski ?sekme=reboot|retirement adresi yeni sayfaya gider, diğer parametreler kalır', async () => {
    for (const [eski, govde, konum] of [
      ['/bmw-hub?sekme=reboot', 'REBOOT_GOVDE', '/reboot-kontrolu|bos'],
      ['/bmw-hub?sekme=retirement&kayit=7', 'RETIREMENT_GOVDE yok', '/retirement?kayit=7|bos'],
      ['/bmw-hub?gorunum=pano', 'Yeni iş', '/bmw-hub?gorunum=pano|bos'],
    ] as const) {
      const r = kur(eski);
      expect(await r.findByText(govde)).toBeTruthy();
      expect(r.getByTestId('konum').textContent).toBe(konum);
      r.unmount();
    }
  });

  it('BS3 Server Hub önerisi forma bir kez gider, state temizlenir', async () => {
    kur({ pathname: '/retirement', state: { retireOneri: { uygulama: 'APP1', not: 'etiket' } } });
    expect(await screen.findByText('RETIREMENT_GOVDE APP1#1')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('konum').textContent).toBe('/retirement|bos'));
    expect(screen.getByText('RETIREMENT_GOVDE APP1#1')).toBeInTheDocument();
    const dolu = oneriler.filter(Boolean) as { no: number }[];
    expect(new Set(dolu.map((o) => o.no))).toEqual(new Set([1]));
  });

  it('BS3b eski adrese state ile gelen öneri yönlendirmede kaybolmaz', async () => {
    kur({ pathname: '/bmw-hub', search: '?sekme=retirement', state: { retireOneri: { uygulama: 'APP2', not: '' } } });
    expect(await screen.findByText('RETIREMENT_GOVDE APP2#1')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('konum').textContent).toBe('/retirement|bos'));
  });
});

describe('BS4 Server Hub / App Hub kaynak kapıları', () => {
  const sh = oku('src/components/server_hub/ServerHubPage.tsx');
  it("Reboot Kontrolü / Retirement sekmesi Server Hub'da yok", () => {
    expect(sh).not.toMatch(/<RebootKontroluTab\b/);
    expect(sh).not.toMatch(/<RetirementTab\b/);
    expect(sh).not.toMatch(/id: 'reboot'|id: 'retirement'/);
  });
  it("retirementAc ve App Hub doğrudan /retirement'a gider; eski sekme adresine kimse gitmez", () => {
    expect(sh).toMatch(/navigate\('\/retirement', \{ state: \{ retireOneri: \{ uygulama, not \} \} \}\)/);
    expect(oku('src/components/app_hub/AppHubPage.tsx')).toMatch(/navigate\('\/retirement'\)/);
    for (const rel of ['src/components/server_hub/ServerHubPage.tsx', 'src/components/app_hub/AppHubPage.tsx']) {
      expect(oku(rel)).not.toMatch(/sekme=(reboot|retirement)/);
    }
  });
  it('BmwHubPage artık Reboot / Retirement gövdesi ya da sekme şeridi kurmaz', () => {
    expect(oku('src/components/bmw_hub/BmwHubPage.tsx')).not.toMatch(/RebootKontroluTab|RetirementTab|BMW Hub sekmeleri|SekmeKabi/);
  });
});

// BS5 (kullanici, 2026-11-13): IP/Sunucu Sorgu, OCP Uygulama Sorgu ve Yuk Testi sol menude BMW Hub grubunda AYRI
// sayfa (2026-11-12'de BMW Hub sayfasinda sekmeydi; kullanici menude goremedi). Eski adresler yonlenir.
describe('BMW Hub — menüdeki sorgu ve yük testi sayfaları', () => {
  it('BS5 BMW Hub sayfasında sorgu sekmesi yok; eski ?sekme=ip|ocp adresi yeni sayfaya yönlenir', async () => {
    const r0 = kur('/bmw-hub');
    expect(await r0.findByText('Yeni iş')).toBeInTheDocument();
    expect(r0.queryByRole('tab', { name: 'IP/Sunucu Sorgu' })).toBeNull();
    r0.unmount();
    for (const [eski, govde, konum] of [
      ['/bmw-hub?sekme=ip&x=1', 'IP_GOVDE', '/ip-sorgu?x=1|bos'],
      ['/bmw-hub?sekme=ocp', 'OCP_GOVDE', '/ocp-sorgu|bos'],
    ] as const) {
      const r = kur(eski);
      expect(await r.findByText(govde)).toBeTruthy();
      expect(r.getByTestId('konum').textContent).toBe(konum);
      r.unmount();
    }
  });

  it('BS6 menü kaydı, rotalar, sunucu tohumu ve eski yer imleri', () => {
    // Reboot Kontrolu ve Retirement Acik Isler'in hemen altinda (kullanici, 2026-11-13).
    expect(oku('src/config/elements.ts')).toMatch(
      /itemIds: \['BmwHub', 'RebootKontrolu', 'Retirement', 'Envanter', 'Denetim', 'Nöbet', 'OcoTakvimi', 'IpSorgu', 'OcpSorgu', 'YukTesti'\]/,
    );
    const app = oku('src/App.tsx');
    const setup = oku('server/db/mssql-setup.cjs');
    for (const [id, yol] of [
      ['IpSorgu', '/ip-sorgu'],
      ['OcpSorgu', '/ocp-sorgu'],
      ['YukTesti', '/yuk-testi'],
      ['RebootKontrolu', '/reboot-kontrolu'],
      ['Retirement', '/retirement'],
    ]) {
      expect(app).toContain(`<PageVisibilityRoute pageId="${id}" />`);
      expect(app).toContain(`path="${yol}"`);
      expect(setup).toMatch(new RegExp(String.raw`element_key: '${id}',\s*element_type: 'page',\s*parent_key: 'navgroup:bmwhub'`));
    }
    expect(app).toMatch(/<TasinanSekme param="tab" deger="yuktesti" hedef="\/yuk-testi"><NginxConsolePage \/><\/TasinanSekme>/);
    // /bmw-hub yonlendirmesi bu testteki ESKI_SEKMELER / YENI_YOLLAR ile birebir.
    expect(app).toContain(
      `<TasinanSekme param="sekme" deger={['ip', 'ocp', 'reboot', 'retirement']} hedef={{ ip: '/ip-sorgu', ocp: '/ocp-sorgu', reboot: '/reboot-kontrolu', retirement: '/retirement' }}><BmwHubPage /></TasinanSekme>`,
    );
    expect(ESKI_SEKMELER).toEqual(Object.keys(YENI_YOLLAR));
    // Yeni sayfalarin kitlesi BmwHub ile ayni (yalniz Admin); sira tasimasi acilista BMW Hub grubundan sonra calisir.
    for (const [id, etiket, yol] of [
      ['RebootKontrolu', 'Reboot Kontrolü', '/reboot-kontrolu'],
      ['Retirement', 'Retirement', '/retirement'],
    ]) {
      expect(setup).toMatch(
        new RegExp(
          String.raw`element_key: '${id}',\s*element_type: 'page',\s*parent_key: 'navgroup:bmwhub',\s*label: '${etiket}',\s*route: '${yol}',\s*sort_order: \d+,\s*roles: \['Admin'\],\s*\}`,
        ),
      );
    }
    expect(setup).toMatch(/element_key: 'BmwHub',[\s\S]{0,200}roles: \['Admin'\],/);
    expect(setup).toMatch(/await moveToBmwHub\(pool\);\s*await placeBmwHubFlowPages\(pool\);/);
    const ss = oku('src/components/SelfServicePage.tsx');
    expect(ss).not.toMatch(/<IpCheckSection|<OpenshiftCheckSection/);
    expect(ss).toMatch(/'ip-sorgu': '\/ip-sorgu'/);
    expect(ss).toMatch(/'openshift-sorgu': '\/ocp-sorgu'/);
    // Sunucu: sorgu uclari yeni sayfa izniyle, yuk testi uclari YukTesti ya da eski sekme izniyle acilir.
    expect(oku('server/selfservice/index.cjs')).toMatch(/\["IpSorgu", "OcpSorgu", "BmwHub", "Self Service"\]/);
    const yt = oku('server/nginx-loadtest/index.cjs');
    expect(yt).toMatch(/if \(await canSee\(user, 'YukTesti'\)\) return next\(\);/);
    expect(yt).toMatch(/\(await canSee\(user, 'NginxConsole'\)\) && \(await canSee\(user, 'tab:nginx:yuktesti'\)\)/);
    // Reboot Kontrolu / Retirement uclari: eski ServerHub kapisi + yeni sayfa anahtari (davranis: ek-sayfa-kapisi.test.cjs).
    expect(oku('server/retirement/index.cjs')).toMatch(
      /const ana = gor\.requireVisiblePrefix\('ServerHub'\);\s*router\.use\(require\('\.\.\/auth\/ek-sayfa-kapisi\.cjs'\)\.ekSayfaKapisi\(\{ anahtar: 'Retirement', ana, canSee: gor\.canSee \}\)\);/,
    );
    expect(oku('server/server-hub/index.cjs')).toMatch(
      /const ana = gor\.requireVisiblePrefix\('ServerHub'\);\s*router\.use\(\s*require\('\.\.\/auth\/ek-sayfa-kapisi\.cjs'\)\.ekSayfaKapisi\(\{\s*anahtar: 'RebootKontrolu',\s*ana,\s*canSee: gor\.canSee,\s*eslesir: rebootKontroluUcu,/,
    );
  });
});
