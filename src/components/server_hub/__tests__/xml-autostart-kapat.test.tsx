// src/components/server_hub/__tests__/xml-autostart-kapat.test.tsx — domain kapalıyken host XML ile auto-start KAPAT (2026-11-15).
//
// Kullanıcı: "biz 'Tek tek, bilinçli kullanım için XML yolu ekleyebilirim' opsiyonunu devreye alalım ben bunları görmek
// istemiyorum. bunlar yanlış retire edilmiş uygulamalar o yüzden auto-start'ları kapatılmalı".
//   XU1 yardımcılar: yalnız domainKapali + durmuş (ölçülmüş) + auto-start true; sonuç ayrıştırma (items / xmlplan / line)
//   XU2 JVM satırı: düğme YALNIZ domainKapali adayda; çalışan domain'de normal Kapat, XML düğmesi yok; zaten kapalı /
//       bayat sunucuda düğme yok
//   XU3 JBOSS_DOMAIN_DOWN bulgusu: "… açık N durmuş JVM'in auto-start'ını kapat (host XML)"; aday yoksa düğme yok
//   XU4 pencere: İptal iş açmaz; Planı göster -> plan işi -> dosya / host / öğeler; Production: ek uyarı + işaret
//       olmadan "Onayla ve uygula" kapalı; uygula -> sonuç + ayrıntı tazelenir; Non-Production'da işaret yok
//   XU5 (inceleme F5) iş başladıktan sonra pencere X ile kapatılabilir (iş sürer); istek yanıtlanmadan kapanmaz;
//       "İptal" koşan işte kapalı
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { render } from '@/test/test-utils';

const m = vi.hoisted(() => ({
  overview: vi.fn(),
  findings: vi.fn(),
  limitler: vi.fn(),
  hostAdlari: vi.fn(),
  jobStatus: vi.fn(),
  scan: vi.fn(),
  host: vi.fn(),
  retireEtiketleri: vi.fn(),
  gorunumler: vi.fn(),
  jvmAutoStart: vi.fn(),
  jvmAutoStartXml: vi.fn(),
}));
const addJob = vi.hoisted(() => vi.fn());
const toastM = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob }) }));
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/components/server_hub/SunucuPaneli', () => ({
  default: ({ host }: { host: string }) => <div data-testid="panel-taklit">panel {host}</div>,
}));

import ServerHubPage from '@/components/server_hub/ServerHubPage';
import * as shOnbellek from '@/components/server_hub/shOnbellek';
import { _sifirlaForTest } from '@/components/server_hub/autoStartIsi';
import {
  xmlKapatilabilir,
  xmlKapatAdaylari,
  xmlSonucunuAyristir,
  xmlKapatSunucuEngeli,
} from '@/components/server_hub/XmlAutoStartKapat';

const APP = 'GBCJAP01';
const XA = 'jboss_autostart_xml_off';
const JVM = (name: string, o: Record<string, unknown> = {}) => ({
  gen: 8,
  name,
  group: 'g',
  running: false,
  runningKnown: true,
  runningSrc: 'PS_ABSENT',
  autoStart: 'true',
  serverState: 'stopped',
  ports: [],
  source: 'cli',
  cfgSrc: 'XML',
  domainKapali: true,
  req24h: null,
  req7d: null,
  matchKind: null,
  vhosts: [],
  ...o,
});
const DOMAIN_BULGU = {
  severity: 'warning',
  area: 'jboss',
  code: 'JBOSS_DOMAIN_DOWN',
  text: "JBoss 8 domain kapalı (host controller çalışmıyor) — 3 JVM durmuş (2 tanesinde host XML'de auto-start açık: reboot'ta açılabilir); JVM bazında auto-start bulgusu üretilmedi",
  fix: null,
  gen: 8,
  jvmSayisi: 3,
  autoStartAcik: 2,
};
const DETAY = (o: Record<string, unknown> = {}) => ({
  host: APP,
  envGroup: 'Production',
  scanDate: '2026-11-15',
  products: ['JBOSS7', 'JBOSS8'],
  cpuS: null,
  fresh: true,
  schemaUnknown: false,
  findings: [DOMAIN_BULGU],
  jvms: [
    JVM('yanlis1'),
    JVM('yanlis2'),
    JVM('zatenkapali', { autoStart: 'false' }),
    JVM('acikdomain', { gen: 7, domainKapali: undefined, cfgSrc: 'CLI_WILDCARD' }),
  ],
  vhosts: [],
  init: [],
  ips: [],
  web: [],
  jboss: [],
  ...o,
});
const planSonucu = () => ({
  line: `RESULT\t${XA}\tPLAN\t2 JVM auto-start true -> false`,
  plan_only: true,
  xmlplan: [
    'PLAN\tdosya\t/usr/jboss8/AppServer/domain/configuration/host.xml',
    'PLAN\thost\tgbcjap01',
    'PLAN\tyedek\t/var/tmp/server_hub_backup/<zaman damgasi>/host.xml',
  ],
  items: [
    { gen: '8', jvm: 'yanlis1', action: XA, line: `RESULT\t${XA}\tPLAN\ttrue -> false` },
    {
      gen: '8',
      jvm: 'yanlis2',
      action: XA,
      line: `RESULT\t${XA}\tPLAN\ttrue (oznitelik yok, JBoss varsayilani) -> false`,
    },
  ],
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  Object.values(toastM).forEach((f) => f.mockReset());
  addJob.mockReset();
  shOnbellek._sifirlaForTest();
  _sifirlaForTest();
  m.overview.mockResolvedValue({
    ok: true,
    tableMissing: false,
    latestScan: '2026-11-15',
    summary: null,
    hosts: [
      {
        host: APP,
        env: 'PROD',
        envGroup: 'Production',
        hostClass: 'genel',
        status: 'warning',
        counts: { danger: 0, warning: 1, info: 0 },
        products: ['JBOSS8'],
        jvms: 4,
        jvmsRunning: 0,
        vhosts: 0,
        unusedIps: 0,
        topFinding: null,
        scanDate: '2026-11-15',
        cpuS: 0.4,
        fresh: true,
      },
    ],
  });
  m.limitler.mockResolvedValue({ ok: true, limitler: [] });
  m.findings.mockResolvedValue({ ok: true, findings: [] });
  m.host.mockResolvedValue({ ok: true, host: DETAY() });
  m.retireEtiketleri.mockResolvedValue({ ok: true, kurallar: [], etiketler: [], ozet: {} });
  m.gorunumler.mockResolvedValue({ ok: true, okunamadi: false, gorunumler: [] });
});

async function pencere(sekme: RegExp) {
  render(<ServerHubPage />);
  const satirEl = (await screen.findByRole('button', { name: `${APP} ayrıntısı` })).closest('tr')!;
  fireEvent.click(within(satirEl).getByRole('button', { name: 'Ayrıntı' }));
  await screen.findByTestId('panel-taklit');
  fireEvent.click(screen.getByRole('button', { name: sekme }));
}
const isBitir = async (i: number, status: string, result: unknown) => {
  m.jobStatus.mockResolvedValueOnce({ ok: true, status, output: '', result });
  await act(async () => {
    await addJob.mock.calls[i][0].fetchStatus();
  });
};

describe('XU1 yardımcılar', () => {
  it('yalnız domain kapalı + durmuş + auto-start açık; ayrıştırma', () => {
    expect(xmlKapatilabilir(JVM('a'))).toBe(true);
    expect(xmlKapatilabilir(JVM('a', { domainKapali: undefined }))).toBe(false);
    expect(xmlKapatilabilir(JVM('a', { running: true }))).toBe(false);
    expect(xmlKapatilabilir(JVM('a', { runningKnown: false }))).toBe(false);
    expect(xmlKapatilabilir(JVM('a', { autoStart: 'false' }))).toBe(false);
    expect(xmlKapatilabilir(JVM('a', { autoStart: 'unknown' }))).toBe(false);
    expect(xmlKapatilabilir(JVM('a', { cfgSrc: 'UNAVAILABLE' }))).toBe(false);
    expect(xmlKapatAdaylari(DETAY().jvms, 8)).toEqual(['yanlis1', 'yanlis2']);
    expect(xmlKapatAdaylari(DETAY().jvms, 7)).toEqual([]);
    expect(xmlKapatSunucuEngeli({ fresh: false })).toMatch(/bayat/);
    expect(xmlKapatSunucuEngeli({ fresh: true })).toBe('');
    const s = xmlSonucunuAyristir(planSonucu());
    expect(s.genel).toEqual({ durum: 'PLAN', mesaj: '2 JVM auto-start true -> false' });
    expect(s.plan.host).toBe('gbcjap01');
    expect(s.ogeler.map((o) => `${o.jvm}:${o.durum}`)).toEqual(['yanlis1:PLAN', 'yanlis2:PLAN']);
    expect(xmlSonucunuAyristir(null)).toEqual({ genel: null, ogeler: [], plan: {} });
  });
});

describe('XU2 JVM satırı', () => {
  it('düğme yalnız domain kapalı adayda', async () => {
    await pencere(/^JVM · /);
    const tr = (ad: string) => screen.getByText(ad).closest('tr')!;
    expect(
      within(tr('yanlis1')).getByRole('button', { name: "Auto-start'ı kapat (host XML)" }),
    ).toBeInTheDocument();
    expect(within(tr('zatenkapali')).queryByRole('button', { name: /host XML/ })).toBeNull();
    expect(within(tr('zatenkapali')).getByText('değiştirilemez')).toBeInTheDocument();
    // çalışan domain: normal tek-JVM Kapat (CLI), XML düğmesi YOK
    expect(within(tr('acikdomain')).getByRole('button', { name: 'Kapat' })).toBeInTheDocument();
    expect(within(tr('acikdomain')).queryByRole('button', { name: /host XML/ })).toBeNull();
  });
  it('bayat sunucuda düğme yok', async () => {
    m.host.mockResolvedValue({ ok: true, host: DETAY({ fresh: false }) });
    await pencere(/^JVM · /);
    expect(screen.queryByRole('button', { name: /host XML/ })).toBeNull();
  });
});

describe('XU3 JBOSS_DOMAIN_DOWN bulgusu', () => {
  it('aday sayısıyla düğme; aday yoksa yok', async () => {
    await pencere(/^Bulgular · /);
    expect(
      screen.getByRole('button', {
        name: "Bu domain'deki auto-start'ı açık 2 durmuş JVM'in auto-start'ını kapat (host XML)",
      }),
    ).toBeInTheDocument();
  });
  it('bayat sunucuda bulgu düğmesi yok', async () => {
    m.host.mockResolvedValue({ ok: true, host: DETAY({ fresh: false }) });
    await pencere(/^Bulgular · /);
    expect(screen.getByText(DOMAIN_BULGU.text)).toBeInTheDocument();
    expect(screen.queryByTestId('xml-kapat-domain')).toBeNull();
  });
  it('aday yok', async () => {
    m.host.mockResolvedValue({
      ok: true,
      host: DETAY({
        jvms: [JVM('zatenkapali', { autoStart: 'false' })],
        findings: [{ ...DOMAIN_BULGU, autoStartAcik: 0 }],
      }),
    });
    await pencere(/^Bulgular · /);
    expect(screen.queryByTestId('xml-kapat-domain')).toBeNull();
  });
});

describe('XU4 pencere', () => {
  it('İptal iş açmaz', async () => {
    await pencere(/^Bulgular · /);
    fireEvent.click(screen.getByTestId('xml-kapat-domain'));
    const dlg = screen.getByRole('dialog', { name: "Auto-start'ı kapat (host XML)" });
    expect(within(dlg).getByTestId('xml-kapat-jvmler')).toHaveTextContent('yanlis1, yanlis2');
    expect(within(dlg).getByTestId('xml-kapat-prod-uyari')).toHaveTextContent(
      'PRODUCTION sunucusu.',
    );
    expect(within(dlg).queryByText(/Vazgeç/)).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: 'İptal' }));
    expect(screen.queryByRole('dialog', { name: "Auto-start'ı kapat (host XML)" })).toBeNull();
    expect(m.jvmAutoStartXml).not.toHaveBeenCalled();
  });

  it('plan -> Production onayı -> uygula -> sonuç + ayrıntı tazelenir', async () => {
    m.jvmAutoStartXml.mockResolvedValueOnce({
      ok: true,
      jobId: 701,
      awxServerId: 1,
      planOnly: true,
    });
    await pencere(/^Bulgular · /);
    fireEvent.click(screen.getByTestId('xml-kapat-domain'));
    const dlg = screen.getByRole('dialog', { name: "Auto-start'ı kapat (host XML)" });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() =>
      expect(m.jvmAutoStartXml).toHaveBeenCalledWith({
        host: APP,
        gen: 8,
        jvms: ['yanlis1', 'yanlis2'],
        asama: 'plan',
      }),
    );
    await waitFor(() => expect(addJob).toHaveBeenCalledTimes(1));
    expect(within(dlg).getByRole('button', { name: 'İptal' })).toBeDisabled();
    await isBitir(0, 'successful', planSonucu());
    const sonuc = within(dlg).getByTestId('xml-kapat-sonuc');
    expect(sonuc).toHaveTextContent('/usr/jboss8/AppServer/domain/configuration/host.xml');
    expect(sonuc).toHaveTextContent('gbcjap01');
    expect(sonuc).toHaveTextContent('true (oznitelik yok, JBoss varsayilani) -> false');
    const uygula = within(dlg).getByRole('button', { name: 'Onayla ve uygula' });
    expect(uygula).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('checkbox'));
    expect(uygula).toBeEnabled();
    m.jvmAutoStartXml.mockResolvedValueOnce({
      ok: true,
      jobId: 702,
      awxServerId: 1,
      planOnly: false,
    });
    fireEvent.click(uygula);
    await waitFor(() =>
      expect(m.jvmAutoStartXml).toHaveBeenLastCalledWith({
        host: APP,
        gen: 8,
        jvms: ['yanlis1', 'yanlis2'],
        asama: 'uygula',
      }),
    );
    await waitFor(() => expect(addJob).toHaveBeenCalledTimes(2));
    const hostOnce = m.host.mock.calls.length;
    await isBitir(1, 'successful', {
      line: `RESULT\t${XA}\tOK\t2 JVM auto-start=false (host XML ...)`,
      plan_only: false,
      items: ['yanlis1', 'yanlis2'].map((jvm) => ({
        gen: '8',
        jvm,
        action: XA,
        line: `RESULT\t${XA}\tOK\tauto-start=false (host XML host.xml, geri okundu)`,
      })),
    });
    expect(within(dlg).getAllByText('OK').length).toBeGreaterThanOrEqual(2);
    expect(toastM.success).toHaveBeenCalledWith(
      expect.stringMatching(/^Auto-start kapatıldı \(host XML\)/),
    );
    await waitFor(() => expect(m.host.mock.calls.length).toBeGreaterThan(hostOnce));
    expect(m.host).toHaveBeenLastCalledWith(APP, true);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog', { name: "Auto-start'ı kapat (host XML)" })).toBeNull();
  });

  it('Non-Production: ek uyarı / işaret yok; plan FAIL ise uygula düğmesi yok', async () => {
    m.host.mockResolvedValue({ ok: true, host: DETAY({ envGroup: 'Non-Production' }) });
    m.jvmAutoStartXml.mockResolvedValueOnce({ ok: true, jobId: 703, awxServerId: 1 });
    await pencere(/^JVM · /);
    fireEvent.click(
      within(screen.getByText('yanlis1').closest('tr')!).getByRole('button', {
        name: "Auto-start'ı kapat (host XML)",
      }),
    );
    const dlg = screen.getByRole('dialog', { name: "Auto-start'ı kapat (host XML)" });
    expect(within(dlg).queryByTestId('xml-kapat-prod-uyari')).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() =>
      expect(m.jvmAutoStartXml).toHaveBeenCalledWith({
        host: APP,
        gen: 8,
        jvms: ['yanlis1'],
        asama: 'plan',
      }),
    );
    await waitFor(() => expect(addJob).toHaveBeenCalledTimes(1));
    await isBitir(0, 'failed', {
      line: `RESULT\t${XA}\tFAIL\tJBoss 8 host controller / process controller CALISIYOR`,
      items: [],
    });
    expect(within(dlg).queryByRole('button', { name: 'Onayla ve uygula' })).toBeNull();
    expect(within(dlg).getByTestId('xml-kapat-plan-sorunu')).toHaveTextContent(/CALISIYOR/);
  });

  it('sunucu reddederse (400) pencere plan öncesine döner', async () => {
    m.jvmAutoStartXml.mockResolvedValueOnce({
      ok: false,
      message: "yanlis1 (JBoss 8) domain'i kapalı görünmüyor",
    });
    await pencere(/^Bulgular · /);
    fireEvent.click(screen.getByTestId('xml-kapat-domain'));
    const dlg = screen.getByRole('dialog', { name: "Auto-start'ı kapat (host XML)" });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() =>
      expect(toastM.error).toHaveBeenCalledWith("yanlis1 (JBoss 8) domain'i kapalı görünmüyor"),
    );
    expect(within(dlg).getByRole('button', { name: 'Planı göster' })).toBeInTheDocument();
    expect(addJob).not.toHaveBeenCalled();
  });
});

describe('XU5 koşan işte pencere', () => {
  it('istek yanıtlanmadan kapanmaz; iş başladıktan sonra X ile kapanır, İptal kapalı kalır', async () => {
    let yanit: (v: unknown) => void = () => {};
    m.jvmAutoStartXml.mockReturnValueOnce(
      new Promise((r) => {
        yanit = r;
      }),
    );
    await pencere(/^Bulgular · /);
    fireEvent.click(screen.getByTestId('xml-kapat-domain'));
    const dlg = screen.getByRole('dialog', { name: "Auto-start'ı kapat (host XML)" });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() => expect(m.jvmAutoStartXml).toHaveBeenCalledTimes(1));
    const x = within(dlg).getByRole('button', { name: 'Pencereyi kapat' });
    expect(x).toBeDisabled();
    expect(within(dlg).queryByTestId('xml-kapat-arka-plan')).toBeNull();
    await act(async () => {
      yanit({ ok: true, jobId: 705, awxServerId: 1, planOnly: true });
    });
    await waitFor(() => expect(addJob).toHaveBeenCalledTimes(1));
    expect(within(dlg).getByTestId('xml-kapat-arka-plan')).toHaveTextContent(
      'iş arka planda sürer',
    );
    expect(within(dlg).getByRole('button', { name: 'İptal' })).toBeDisabled();
    expect(x).toBeEnabled();
    fireEvent.click(x);
    expect(screen.queryByRole('dialog', { name: "Auto-start'ı kapat (host XML)" })).toBeNull();
  });
});

describe('XU5b uygulama isteği', () => {
  it('plan işi bittikten sonra uygulama isteği yanıtlanana kadar pencere kapanmaz (eski iş no sayılmaz)', async () => {
    m.host.mockResolvedValue({ ok: true, host: DETAY({ envGroup: 'Non-Production' }) });
    m.jvmAutoStartXml.mockResolvedValueOnce({
      ok: true,
      jobId: 706,
      awxServerId: 1,
      planOnly: true,
    });
    await pencere(/^Bulgular · /);
    fireEvent.click(screen.getByTestId('xml-kapat-domain'));
    const dlg = screen.getByRole('dialog', { name: "Auto-start'ı kapat (host XML)" });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() => expect(addJob).toHaveBeenCalledTimes(1));
    await isBitir(0, 'successful', planSonucu());
    let yanit: (v: unknown) => void = () => {};
    m.jvmAutoStartXml.mockReturnValueOnce(
      new Promise((r) => {
        yanit = r;
      }),
    );
    fireEvent.click(within(dlg).getByRole('button', { name: 'Onayla ve uygula' }));
    await waitFor(() => expect(m.jvmAutoStartXml).toHaveBeenCalledTimes(2));
    expect(within(dlg).getByRole('button', { name: 'Pencereyi kapat' })).toBeDisabled();
    await act(async () => {
      yanit({ ok: true, jobId: 707, awxServerId: 1, planOnly: false });
    });
    await waitFor(() => expect(addJob).toHaveBeenCalledTimes(2));
    expect(within(dlg).getByRole('button', { name: 'Pencereyi kapat' })).toBeEnabled();
  });
});
