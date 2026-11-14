// src/components/server_hub/__tests__/kopya-durumu-tab.test.tsx — Server Hub › Kopya Durumu (2026-11-14).
//
// Kullanıcı: "Bazı JBoss uygulamaları production'da toplam 5 makinede sadece birinde açık."
//   KDT1 varsayılan yalnız tutarsız gruplar; "çalışan 1 / 5", kopya başına bir parça (durum tokenı), kapalı
//        sunucular, auto-start çipi, eşleşme sınırı (farklı JVM adı) ve aktif / pasif notu yazılı
//   KDT2 süzgeçler: Hepsi, ortam, nesil, arama (uygulama ya da sunucu); bilinmiyor kapalı sayılmaz
//   KDT3 bağlantılar: Bulgular KOPYA_TUTARSIZ + uygulama adı, Retirement, sunucu paneli
//   KDT4 CSV: grup başına satır, kopyalar ve bayat işareti; saf süzgeç / CSV fonksiyonları
//   KDT5 gizli sekmede istek yok
//   KDT6 sekme kaydı: liste, görünürlük anahtarı, SekmeKabi, seed default_visible 1, Bulgular q süzgeci
//   KDT7 yenileme hatası eski verinin üstünde görünür; Yenile istek sürerken kapalı
//   KDT8 çubuk duruma göre sıralı ve biçimle ayrılır; PROD düğmesi; ortam sırası; taramadan düşen; panel aç / kapa
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { ShKopyaGrubu, ShKopya } from '@/api/serverHubApi';

const m = vi.hoisted(() => ({ kopyaDurumu: vi.fn() }));
const csvM = vi.hoisted(() => ({ downloadCsv: vi.fn() }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/utils/csv', async (orig) => ({
  ...(await orig<typeof import('@/utils/csv')>()),
  downloadCsv: csvM.downloadCsv,
}));
vi.mock('@/components/server_hub/SunucuPaneli', () => ({
  default: ({ host }: { host: string }) => <div data-testid="sunucu-paneli">{host}</div>,
}));

import KopyaDurumuTab, { kdSuz, kdCsv } from '@/components/server_hub/KopyaDurumuTab';
import { SekmeKabi } from '@/components/server_hub/sekmeGorunurlugu';

const kopya = (host: string, durum: ShKopya['durum'], ek: Partial<ShKopya> = {}): ShKopya => ({
  host,
  running: durum === 'bilinmiyor' ? null : durum === 'calisiyor',
  durum,
  autoStart: 'true',
  serverState: durum === 'calisiyor' ? 'running' : 'stopped',
  fresh: true,
  scanDate: '2026-11-14',
  sapma: durum === 'kapali' ? ['calisma'] : [],
  retirement: [],
  ocp: [],
  ...ek,
});
const grup = (
  app: string,
  env: string,
  copies: ShKopya[],
  ek: Partial<ShKopyaGrubu> = {},
): ShKopyaGrubu => {
  const running = copies.filter((k) => k.durum === 'calisiyor').length;
  const stopped = copies.filter((k) => k.durum === 'kapali').length;
  return {
    anahtar: `${env}|7|${app.toLowerCase()}`,
    app,
    env,
    gen: 7,
    total: copies.length,
    running,
    stopped,
    unknown: copies.length - running - stopped,
    calismaTutarsiz: running > 0 && stopped > 0,
    autoStartTutarsiz: false,
    tutarsiz: running > 0 && stopped > 0,
    autoStartUyumsuz: 0,
    autoStartAcik: copies.length,
    autoStartKapali: 0,
    stoppedHosts: copies.filter((k) => k.durum === 'kapali').map((k) => k.host),
    retirement: [],
    ocp: [],
    copies,
    ...ek,
  };
};
const PAY = grup(
  'PAY',
  'PROD',
  [
    kopya('P1', 'calisiyor'),
    kopya('P2', 'kapali'),
    kopya('P3', 'kapali'),
    kopya('P4', 'kapali', { autoStart: 'false', sapma: ['calisma', 'autostart'] }),
    kopya('P5', 'kapali', { retirement: [{ kayit: 12, hedef: 7, durum: 'stopped' }] }),
  ],
  {
    autoStartUyumsuz: 1,
    autoStartAcik: 4,
    autoStartKapali: 1,
    retirement: [{ kayit: 12, hedef: 7, durum: 'stopped' }],
  },
);
const CRM = grup('CRM', 'QA', [
  kopya('Q1', 'calisiyor'),
  kopya('Q2', 'bilinmiyor', { fresh: false, running: false }),
]);
const ESKI = grup('ESKI', 'PROD', [kopya('P8', 'kapali'), kopya('P9', 'calisiyor')], {
  gen: 8,
  anahtar: 'PROD|8|eski',
  ocp: [{ namespace: 'eski-prod', cluster: 'c1' }],
});
const yanit = () => ({
  ok: true,
  tableMissing: false,
  latestScan: '2026-11-14',
  eslesme: {
    kural: 'Aynı ortam + aynı JBoss nesli + aynı JVM adı.',
    kacirabilir: 'Farklı JVM adıyla kurulmuş kopyalar aynı grup sayılmaz.',
    aktifPasif: 'Aktif / pasif (DR) kurgusunda bir kopyanın kapalı durması beklenen olabilir.',
    bayat: 'Bayat kopya bilinmiyor sayılır.',
  },
  gruplar: [PAY, ESKI, CRM],
  ozet: { grup: 3, tutarsiz: 2, prodTutarsiz: 2, calismaTutarsiz: 2, autoStartTutarsiz: 1 },
});

beforeEach(() => {
  m.kopyaDurumu.mockReset().mockResolvedValue(yanit());
  csvM.downloadCsv.mockReset();
});

describe('Kopya Durumu', () => {
  it('KDT1 varsayılan tutarsız; çalışan x / y, parça çubuğu, kapalı sunucular, notlar', async () => {
    render(<KopyaDurumuTab />);
    const satirlar = await screen.findAllByTestId('kopya-satiri');
    expect(satirlar.map((s) => within(s).getAllByRole('button')[0].textContent)).toEqual([
      'PAY',
      'ESKI',
    ]);
    const pay = satirlar[0];
    expect(within(pay).getByText('çalışan 1 / 5')).toBeTruthy();
    const parcalar = pay.querySelectorAll('[data-durum]');
    expect([...parcalar].map((p) => p.getAttribute('data-durum'))).toEqual([
      'calisiyor',
      'kapali',
      'kapali',
      'kapali',
      'kapali',
    ]);
    expect((parcalar[0] as HTMLElement).style.background).toBe('var(--status-success)');
    expect((parcalar[1] as HTMLElement).style.borderColor).toBe('var(--status-danger)');
    expect(within(pay).getByText('P2')).toBeTruthy();
    expect(within(pay).getByText('1 kopya farklı')).toBeTruthy();
    expect(screen.getByText(/Farklı JVM adıyla kurulmuş kopyalar/)).toBeTruthy();
    expect(screen.getByText(/Aktif \/ pasif \(DR\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /PROD’da 2 tutarsız grup/ })).toBeTruthy();
    expect(screen.getByText(/yalnız envanterden/)).toBeTruthy();
  });

  it('KDT2 süzgeçler: Hepsi, ortam, nesil, arama; bilinmiyor kapalı sayılmaz', async () => {
    render(<KopyaDurumuTab />);
    await screen.findAllByTestId('kopya-satiri');
    fireEvent.click(screen.getByRole('button', { name: /^Hepsi/ }));
    expect(screen.getAllByTestId('kopya-satiri')).toHaveLength(3);
    const crm = screen.getAllByTestId('kopya-satiri')[2];
    expect(within(crm).getByText('çalışan 1 / 2')).toBeTruthy();
    expect(within(crm).getByText(/1 bilinmiyor/)).toBeTruthy();
    expect(crm.querySelector('[data-durum="kapali"]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Ortam'), { target: { value: 'QA' } });
    expect(screen.getAllByTestId('kopya-satiri')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Ortam'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('JBoss nesli'), { target: { value: '8' } });
    expect(screen.getAllByTestId('kopya-satiri')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('JBoss nesli'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Uygulama ya da sunucu ara'), {
      target: { value: 'p9' },
    });
    const s = screen.getAllByTestId('kopya-satiri');
    expect(s).toHaveLength(1);
    expect(within(s[0]).getByText('ESKI')).toBeTruthy();
  });

  it('KDT3 bağlantılar: Bulgular, Retirement, sunucu paneli', async () => {
    const onGoFindings = vi.fn();
    const onRetirement = vi.fn();
    render(<KopyaDurumuTab onGoFindings={onGoFindings} onRetirement={onRetirement} />);
    const pay = (await screen.findAllByTestId('kopya-satiri'))[0];
    fireEvent.click(within(pay).getByRole('button', { name: 'Bulgular' }));
    expect(onGoFindings).toHaveBeenCalledWith({
      code: 'KOPYA_TUTARSIZ',
      q: 'JBoss7 PAY:',
      envGroup: 'Production',
    });
    fireEvent.click(within(pay).getByRole('button', { name: 'Retirement #12' }));
    expect(onRetirement).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('kopya-satiri')[1].textContent).toMatch(/OpenShift: eski-prod/);
    fireEvent.click(within(pay).getByRole('button', { name: 'P3' }));
    expect(screen.getByTestId('sunucu-paneli').textContent).toBe('P3');
    // satir acilimi: butun kopyalar
    fireEvent.click(within(pay).getByRole('button', { name: 'PAY' }));
    expect(screen.getByRole('button', { name: 'P1' })).toBeTruthy();
    expect(
      screen.getAllByText(/auto-start kapalı · stopped · auto-start öteki kopyalardan farklı/),
    ).toHaveLength(1);
  });

  it('KDT4 CSV: grup başına satır; saf süzgeç ve CSV', async () => {
    render(<KopyaDurumuTab />);
    await screen.findAllByTestId('kopya-satiri');
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(csvM.downloadCsv).toHaveBeenCalledTimes(1);
    const [ad, baslik, satirlar] = csvM.downloadCsv.mock.calls[0];
    expect(ad).toBe('server-hub_kopya-durumu');
    expect(baslik[3]).toBe('Çalışan');
    expect(satirlar.map((r: unknown[]) => r[0])).toEqual(['PAY', 'ESKI']);
    const c = kdCsv([CRM]);
    expect(c.satirlar[0].slice(3, 8)).toEqual([1, 0, 1, 2, 'hayır']);
    expect(c.satirlar[0][10]).toBe(
      'Q1:çalışıyor/auto-start açık Q2:bilinmiyor/auto-start açık/bayat',
    );
    expect(
      kdSuz([PAY, ESKI, CRM], { yalnizTutarsiz: false, env: 'all', gen: 'all', q: 'q2' }),
    ).toEqual([CRM]);
  });

  it('KDT5 gizli sekmede istek yok', async () => {
    render(
      <SekmeKabi id="kopyadurumu" etkin="findings">
        <KopyaDurumuTab />
      </SekmeKabi>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(m.kopyaDurumu).not.toHaveBeenCalled();
  });

  it('KDT6 sekme kaydı: liste, görünürlük anahtarı, SekmeKabi, seed, Bulgular q süzgeci', () => {
    const kok = path.resolve(__dirname, '..', '..', '..', '..');
    const sh = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'ServerHubPage.tsx'),
      'utf8',
    );
    expect(sh).toMatch(/\{ id: 'kopyadurumu', label: 'Kopya Durumu' \}/);
    expect(sh).toMatch(/canSee\('tab:serverhub:kopyadurumu'\)/);
    expect(sh).toMatch(/\(t\.id !== 'kopyadurumu' \|\| kopyaDurumuGorur\)/);
    expect(sh).toMatch(
      /kopyaDurumuGorur && acilan\.has\('kopyadurumu'\) && \(\s*<SekmeKabi id="kopyadurumu" etkin=\{tab\}>\s*<KopyaDurumuTab\s/,
    );
    expect(sh).toMatch(/useState\(initial\?\.q \|\| ''\)/);
    const seed = fs.readFileSync(path.join(kok, 'server', 'db', 'mssql-setup.cjs'), 'utf8');
    expect(sh).toMatch(/onGoFindings=\{goFindings\}\s+onRetirement=/);
    expect(seed).toMatch(
      /element_key: 'tab:serverhub:kopyadurumu',\s*element_type: 'tab',\s*parent_key: 'ServerHub',[\s\S]{0,80}default_visible: 1/,
    );
    const tab = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'KopyaDurumuTab.tsx'),
      'utf8',
    );
    expect(tab).not.toMatch(/Vazge/);
  });

  it('KDT7 yenileme hatası eski verinin üstünde görünür; Yenile istek sürerken kapalı', async () => {
    render(<KopyaDurumuTab />);
    await screen.findAllByTestId('kopya-satiri');
    let coz: (v: unknown) => void = () => undefined;
    m.kopyaDurumu.mockReturnValueOnce(new Promise((r) => (coz = r)));
    const yenile = screen.getByRole('button', { name: /Yenile/ });
    fireEvent.click(yenile);
    expect((yenile as HTMLButtonElement).disabled).toBe(true);
    coz({ ok: false, message: 'Server Hub okunamadı', gruplar: [] });
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Yenileme başarısız: Server Hub okunamadı/,
    );
    expect(screen.getAllByTestId('kopya-satiri')).toHaveLength(2);
    expect((yenile as HTMLButtonElement).disabled).toBe(false);
  });

  it('KDT8 çubuk sırası ve biçimi, PROD düğmesi, ortam sırası, taramadan düşen, panel aç / kapa', async () => {
    const KARISIK = grup(
      'KAR',
      'PROD',
      [
        kopya('A1', 'kapali'),
        kopya('A2', 'bilinmiyor', { fresh: false }),
        kopya('A3', 'calisiyor'),
      ],
      { anahtar: 'PROD|7|kar', dusen: [{ host: 'A9', scanDate: '2026-11-10' }] },
    );
    const DEV = grup('DV', 'DEV', [kopya('D1', 'calisiyor'), kopya('D2', 'kapali')], {
      anahtar: 'DEV|7|dv',
    });
    m.kopyaDurumu.mockReset().mockResolvedValue({
      ...yanit(),
      capraz: {
        ocp: { okunamadi: true, uygulama: 0 },
        kullanim: { okunamadi: false, olcum: 0 },
        retirement: { okunamadi: false, hedef: 0 },
      },
      gruplar: [KARISIK, DEV, PAY, ESKI, CRM],
    });
    render(<KopyaDurumuTab />);
    const kar = (await screen.findAllByTestId('kopya-satiri'))[0];
    const p = [...kar.querySelectorAll('[role="img"] [data-durum]')] as HTMLElement[];
    expect(p.map((x) => x.getAttribute('data-durum'))).toEqual([
      'calisiyor',
      'kapali',
      'bilinmiyor',
    ]);
    // çalışıyor dolu; kapalı içi boş kalın kenar; bilinmiyor kesik kenar (renk körlüğünde biçimle ayrılır)
    expect(
      p.map((x) => [x.style.background.includes('var('), x.style.borderStyle, x.style.borderColor]),
    ).toEqual([
      [true, 'solid', 'var(--status-success)'],
      [false, 'solid', 'var(--status-danger)'],
      [false, 'dashed', 'var(--status-neutral)'],
    ]);
    expect(within(kar).getByText(/\+1 taramadan düştü/)).toBeTruthy();
    expect(screen.getByTestId('kopya-kaynak-notu').textContent).toMatch(
      /^OpenShift kaynağı okunamadı/,
    );
    const ortam = screen.getByLabelText('Ortam') as HTMLSelectElement;
    expect([...ortam.options].map((o) => o.value)).toEqual(['all', 'PROD', 'QA', 'DEV']);
    fireEvent.click(screen.getByRole('button', { name: /PROD’da 2 tutarsız grup/ }));
    expect(ortam.value).toBe('PROD');
    expect(
      screen
        .getAllByTestId('kopya-satiri')
        .map((s) => within(s).getAllByRole('button')[0].textContent),
    ).toEqual(['KAR', 'PAY', 'ESKI']);
    fireEvent.click(within(kar).getByRole('button', { name: 'A1' }));
    expect(screen.getByTestId('sunucu-paneli').textContent).toBe('A1');
    fireEvent.click(within(kar).getByRole('button', { name: 'A1' }));
    expect(screen.queryByTestId('sunucu-paneli')).toBeNull();
  });
});
