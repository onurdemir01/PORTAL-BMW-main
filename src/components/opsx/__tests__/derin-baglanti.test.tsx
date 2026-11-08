// src/components/opsx/__tests__/derin-baglanti.test.tsx — Application Hub'dan ön-seçimli OpsX (2026-11-08).
//
// Kullanıcı: "Tıkladığı an OpsX'e yönlendiresin ve otomatik olarak OpsX JBoss sayfasında
// uygulaması girili halde işlemler başlasın." Sözleşme: src/utils/derinBaglanti.ts.
//   DB1 JBoss tek TAM eşleşme: uygulama seçili, "JBoss Sürümü" adımına gelinir; URL temizlenir
//   DB2 JBoss taban ad + varyantlar: otomatik seçim YOK, arama dolu, not görünür; Geri çalışır
//   DB3 JBoss otomatik seçimden sonra Geri: aynı otomatik seçim kullanıcıyı tekrar ileri itmez
//   DB4 WAS: uygulama seçili gelir, sunucu listesi (WasHostPicker) açık
//   DB5 OCP: env/tenant/namespace seçili, uygulama listedeyse çift eklenmiş; Devam Et açık
//   DB6 OCP: uygulama listede yoksa sessizce düşmez, uyarı görünür
//   DB7 OCP: bilinmeyen ortam -> uyarı + normal akış (hiçbir şey seçili değil)
//   DB8 tanınmayan platform -> uyarı + platform adımı
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  searchApps: vi.fn(),
  getHosts: vi.fn(),
  getClusters: vi.fn(),
  getOcpNamespaces: vi.fn(),
  getOcpApps: vi.fn(),
  wasSearchApps: vi.fn(),
  wasGetHosts: vi.fn(),
}));

vi.mock('@/api/opsxApi', async (orijinal) => ({
  ...((await orijinal()) as object),
  opsxApi: {
    searchApps: m.searchApps,
    getHosts: m.getHosts,
    getClusters: m.getClusters,
    getOcpNamespaces: m.getOcpNamespaces,
    getOcpApps: m.getOcpApps,
  },
  opsxWasApi: { searchApps: m.wasSearchApps, getHosts: m.wasGetHosts },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'User' } }) }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn(), jobs: [] }) }));

import OpsXWizardPage from '../OpsXWizardPage';

function ac(url: string) {
  window.history.replaceState({ usr: null, key: 'k1', idx: 0 }, '', url);
  return render(<OpsXWizardPage />);
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getHosts.mockResolvedValue({ ok: true, hosts: [{ host: 'GBCJAP01', jbossVersion: '7.4', env: 'TEST' }] });
  m.wasSearchApps.mockResolvedValue({ ok: true, apps: [] });
  m.getClusters.mockResolvedValue({ ok: true, tree: { PROD: { ark: ['gbocpprod1', 'gbocpprod2'] } } });
  m.getOcpNamespaces.mockResolvedValue({ ok: true, namespaces: ['ns-a', 'ns-b'] });
  m.getOcpApps.mockResolvedValue({ ok: true, apps: ['app-1', 'app-2'] });
});

describe('OpsX derin bağlantı (Application Hub ön-seçimi)', () => {
  it('DB1 JBoss tek tam eşleşme: JBoss Sürümü adımına gelinir, URL temizlenir', async () => {
    m.searchApps.mockResolvedValue({ apps: ['FOO-APP'], fallbackMode: false });
    ac('/opsx?platform=jboss&app=foo-app');
    expect(await screen.findByText('JBoss Sürümü')).toBeTruthy();
    expect(m.searchApps).toHaveBeenCalledWith('foo-app');
    // Envanterdeki yazımı taşınır; sunucu bunu /api/opsx/hosts?app= ile yeniden doğrular.
    await waitFor(() => expect(m.getHosts).toHaveBeenCalledWith('FOO-APP'));
    expect(window.location.search).toBe('');
    // Router'ın geçmiş anahtarı korunur.
    expect((window.history.state as { key?: string }).key).toBe('k1');
  });

  it('DB2 JBoss taban ad + -D/-T varyantları: otomatik seçim yok, arama dolu, not görünür', async () => {
    m.searchApps.mockResolvedValue({ apps: ['FOO-D', 'FOO-T'], fallbackMode: false });
    ac('/opsx?platform=jboss&app=FOO');
    expect(await screen.findByTestId('opsx-app-ondolum-notu')).toBeTruthy();
    expect(screen.getByText('Uygulama Seçimi')).toBeTruthy();
    expect((screen.getByPlaceholderText('Uygulama adı ara...') as HTMLInputElement).value).toBe('FOO');
    expect(m.getHosts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('FOO-T'));
    expect(await screen.findByText('JBoss Sürümü')).toBeTruthy();
    await waitFor(() => expect(m.getHosts).toHaveBeenCalledWith('FOO-T'));
  });

  it('DB3 otomatik seçimden sonra Geri: uygulama listesinde kalınır (tekrar ileri itilmez)', async () => {
    m.searchApps.mockResolvedValue({ apps: ['FOO-APP'], fallbackMode: false });
    ac('/opsx?platform=jboss&app=FOO-APP');
    expect(await screen.findByText('JBoss Sürümü')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Önceki adıma dön'));
    expect(await screen.findByText('Uygulama Seçimi')).toBeTruthy();
    await screen.findByRole('button', { name: 'FOO-APP' });
    await new Promise((r) => setTimeout(r, 350));
    expect(screen.getByText('Uygulama Seçimi')).toBeTruthy();
    expect(screen.queryByText('JBoss Sürümü')).toBeNull();
    // Geri zinciri bozulmadı: ürün seçimine ve oradan platforma dönülebilir.
    fireEvent.click(screen.getByTitle('Önceki adıma dön'));
    expect(await screen.findByText('Uygulama Sunucusu')).toBeTruthy();
  });

  it('DB4 WAS: uygulama seçili gelir, sunucu listesi açık', async () => {
    m.wasGetHosts.mockResolvedValue({
      ok: true,
      hosts: [{ host: 'GBWAS01', env: 'TEST', os: 'Linux', selectable: true }],
      maxDiscoverHosts: 10,
    });
    ac('/opsx?platform=was&app=WASAPP01');
    expect(await screen.findByText('WAS Uygulama Seçimi')).toBeTruthy();
    expect(await screen.findByText('GBWAS01')).toBeTruthy();
    expect(screen.getByText('WASAPP01')).toBeTruthy();
    expect(m.wasGetHosts).toHaveBeenCalledWith('WASAPP01');
    expect(screen.getByRole('button', { name: 'Canlı keşfi başlat' })).toBeTruthy();
  });

  it('DB5 OCP: hedef önceden seçili ve uygulama eklenmiş; Devam Et açık', async () => {
    ac('/opsx?platform=ocp&app=app-2&env=prod&tenant=ark&namespace=ns-b&cluster=gbocpprod2');
    expect(await screen.findByText('ns-b / app-2')).toBeTruthy();
    expect(m.getOcpNamespaces).toHaveBeenCalledWith('PROD', 'ark');
    expect(m.getOcpApps).toHaveBeenCalledWith('PROD', 'ark', 'ns-b');
    const devam = screen.getByRole('button', { name: 'Devam Et' }) as HTMLButtonElement;
    await waitFor(() => expect(devam.disabled).toBe(false));
    expect(screen.queryByTestId('opsx-ocp-ondolum-uyari')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('DB6 OCP: uygulama listede yoksa uyarı görünür, çift eklenmez', async () => {
    ac('/opsx?platform=ocp&app=olmayan&env=PROD&tenant=ark&namespace=ns-a');
    const uyari = await screen.findByTestId('opsx-ocp-ondolum-uyari');
    expect(uyari.textContent).toMatch(/olmayan/);
    expect(uyari.textContent).toMatch(/uygulama listesinde yok/);
    expect(screen.queryByText(/Eklenen İşlemler/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Devam Et' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('DB7 OCP: bilinmeyen ortam -> uyarı, normal akış', async () => {
    ac('/opsx?platform=ocp&app=app-1&env=MARS&tenant=ark&namespace=ns-a');
    const uyari = await screen.findByTestId('opsx-ocp-ondolum-uyari');
    expect(uyari.textContent).toMatch(/MARS/);
    expect(m.getOcpNamespaces).not.toHaveBeenCalled();
    expect(screen.queryByText('Cluster')).toBeNull();
  });

  it('DB8 tanınmayan platform -> uyarı, platform adımı', async () => {
    ac('/opsx?platform=mainframe&app=X');
    expect((await screen.findByTestId('opsx-ondolum-uyari')).textContent).toMatch(/mainframe/);
    expect(screen.queryByText('Uygulama Seçimi')).toBeNull();
    expect(window.location.search).toBe('');
  });
});
