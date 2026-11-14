// src/components/server_hub/__tests__/autostart-isi.test.tsx — Ayrıntı > JVM > Auto-start (2026-11-14).
//
// Kullanıcı: "Ayrıntı -> JVM -> Auto-Start Kapat/Aç tuşları çok yavaş çalışıyor, çalışıp çalışmadıklarından da
// emin olamıyorum".
//   AI1 sonuç satırı: OK / SKIP doğrulanan değeri verir; FAIL ve sonuçsuz iş betiğin mesajıyla FAIL; çalışan JVM
//       Kapat engeli (ölçülemeyen JVM'de engel yok)
//   AI2 autoStartBaslat: iş terminal olana kadar aynı JVM'e ikinci iş AÇILMAZ (çift tık); satır "#iş · durum";
//       başlatmada bildirim; bitince betik mesajı (OK yeşil, FAIL kırmızı) ve kayıt temizlenir
//   AI3 Ayrıntı penceresi: Aç -> düğme "#901 · kuyrukta" (yeniden tıklanamaz) -> iş OK -> hücre "açık" +
//       "✓ iş #901 · tarama bekleniyor"; liste (overview) YENİDEN istenmez; çalışan JVM'de Kapat yok
//   AI4 Özet sekmesi yalnız bu sunucunun etiketlerini ister (?host=)
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
}));
const addJob = vi.hoisted(() => vi.fn());
const toastM = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
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
import {
  autoStartBaslat,
  autoStartSonucu,
  kapatEngeli,
  sonucSatiri,
  isMetni,
  autoStartIsVar,
  _sifirlaForTest,
} from '@/components/server_hub/autoStartIsi';

const APP = 'GBCJAP01';
const satir = (action: string, durum: string, mesaj: string) => ({ line: `RESULT\t${action}\t${durum}\t${mesaj}` });
const JVM = (name: string, o: Record<string, unknown> = {}) => ({
  gen: 7,
  name,
  group: 'g',
  running: false,
  runningKnown: true,
  runningSrc: 'PS_ABSENT',
  autoStart: 'false',
  serverState: 'stopped',
  ports: [],
  source: 'cli',
  cfgSrc: 'CLI_WILDCARD',
  req24h: null,
  req7d: null,
  matchKind: null,
  vhosts: [],
  ...o,
});
const DETAY = () => ({
  host: APP,
  scanDate: '2026-11-14',
  products: ['JBOSS7'],
  cpuS: null,
  fresh: true,
  schemaUnknown: false,
  findings: [],
  jvms: [
    JVM('durmus'),
    JVM('kosan', { running: true, runningSrc: 'PS', autoStart: 'true', serverState: 'running', ports: [8080] }),
  ],
  vhosts: [],
  init: [],
  ips: [],
  web: [],
  jboss: [],
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
    latestScan: '2026-11-14',
    summary: null,
    hosts: [
      {
        host: APP,
        env: 'PROD',
        envGroup: 'Production',
        hostClass: 'genel',
        status: 'ok',
        counts: { danger: 0, warning: 0, info: 0 },
        products: ['JBOSS7'],
        jvms: 2,
        jvmsRunning: 1,
        vhosts: 0,
        unusedIps: 0,
        topFinding: null,
        scanDate: '2026-11-14',
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

describe('AI1 sonuç satırı ve Kapat engeli', () => {
  it('OK / SKIP / FAIL', () => {
    expect(sonucSatiri(satir('jboss_autostart_on', 'OK', 'pay auto-start=true'))).toEqual({ durum: 'OK', mesaj: 'pay auto-start=true' });
    expect(sonucSatiri({ line: 'cikti yok' })).toBeNull();
    expect(autoStartSonucu('successful', satir('jboss_autostart_on', 'OK', 'dogrulandi'), true, 5)).toEqual({ tur: 'ok', mesaj: 'dogrulandi', deger: 'true', jobId: 5 });
    expect(autoStartSonucu('successful', satir('jboss_autostart_off', 'SKIP', 'zaten false'), false, 5).tur).toBe('skip');
    expect(autoStartSonucu('successful', satir('jboss_autostart_off', 'SKIP', 'zaten false'), false, 5).deger).toBe('false');
    const f = autoStartSonucu('failed', satir('jboss_autostart_off', 'FAIL', 'pay su an CALISIYOR'), false, 5);
    expect(f).toEqual({ tur: 'fail', mesaj: 'pay su an CALISIYOR', deger: null, jobId: 5 });
    expect(autoStartSonucu('successful', null, true, 5).tur).toBe('fail');
    expect(autoStartSonucu('error', null, true, 5).mesaj).toMatch(/iş error/);
  });
  it('çalışan JVM Kapat engeli; ölçülemeyen JVM engel değil', () => {
    expect(kapatEngeli({ running: true, runningKnown: true, runningSrc: 'PS' })).toMatch(/çalışıyor/);
    expect(kapatEngeli({ running: false, runningKnown: true })).toBe('');
    expect(kapatEngeli({ running: true, runningKnown: false })).toBe('');
    expect(kapatEngeli({ running: true, runningSrc: 'UNMEASURED' })).toBe('');
  });
});

describe('AI2 autoStartBaslat', () => {
  it('çift tık tek iş; bitene kadar meşgul; sonuç mesajı', async () => {
    let coz: (v: unknown) => void = () => {};
    m.jvmAutoStart.mockImplementation(() => new Promise((r) => (coz = r)));
    const onBitti = vi.fn();
    const p1 = autoStartBaslat({ host: APP, gen: 7, jvm: 'pay', ac: true, addJob, onBitti });
    const p2 = autoStartBaslat({ host: APP, gen: 7, jvm: 'pay', ac: true, addJob, onBitti });
    expect(await p2).toBe(false);
    expect(m.jvmAutoStart).toHaveBeenCalledTimes(1);
    expect(autoStartIsVar(`${APP}|7|pay`)).toBe(true);
    coz({ ok: true, jobId: 901, awxServerId: 1 });
    expect(await p1).toBe(true);
    expect(toastM.success).toHaveBeenCalledWith(expect.stringMatching(/işi başladı \(#901\)/));
    // iş sürerken yine ikinci iş yok
    expect(await autoStartBaslat({ host: APP, gen: 7, jvm: 'pay', ac: true, addJob })).toBe(false);
    expect(m.jvmAutoStart).toHaveBeenCalledTimes(1);
    const { fetchStatus } = addJob.mock.calls[0][0];
    m.jobStatus.mockResolvedValueOnce({ ok: true, status: 'running', output: 'x' });
    await fetchStatus();
    expect(autoStartIsVar(`${APP}|7|pay`)).toBe(true);
    m.jobStatus.mockResolvedValueOnce({ ok: true, status: 'failed', output: '', result: satir('jboss_autostart_on', 'FAIL', "host controller'a baglanilamadi - HICBIR SEY DEGISMEDI") });
    await fetchStatus();
    expect(autoStartIsVar(`${APP}|7|pay`)).toBe(false);
    expect(toastM.error).toHaveBeenCalledWith(expect.stringContaining("host controller'a baglanilamadi"), expect.any(Number));
    expect(onBitti).toHaveBeenCalledWith(expect.objectContaining({ tur: 'fail', deger: null }));
    expect(isMetni({ jobId: 901, durum: 'running', baslangic: 0 })).toBe('#901 · koşuyor');
  });
  it('başlatma reddedilince kayıt temizlenir (yeniden denenebilir)', async () => {
    m.jvmAutoStart.mockResolvedValue({ ok: false, message: 'kosan son taramada ÇALIŞIYOR' });
    expect(await autoStartBaslat({ host: APP, gen: 7, jvm: 'kosan', ac: false, addJob })).toBe(false);
    expect(toastM.error).toHaveBeenCalledWith('kosan son taramada ÇALIŞIYOR');
    expect(autoStartIsVar(`${APP}|7|kosan`)).toBe(false);
    expect(addJob).not.toHaveBeenCalled();
  });
});

async function jvmSekmesi() {
  render(<ServerHubPage />);
  const satirEl = (await screen.findByRole('button', { name: `${APP} ayrıntısı` })).closest('tr')!;
  fireEvent.click(within(satirEl).getByRole('button', { name: 'Ayrıntı' }));
  await screen.findByTestId('panel-taklit');
  fireEvent.click(screen.getByRole('button', { name: 'JVM · 2' }));
  return screen.getByText('durmus').closest('tr')!;
}

describe('AI3 Ayrıntı penceresi', () => {
  it('Aç -> meşgul -> OK -> doğrulanan değer; liste yeniden okunmaz; çalışan JVM de Kapat yok', async () => {
    m.jvmAutoStart.mockResolvedValue({ ok: true, jobId: 901, awxServerId: 1 });
    const tr = await jvmSekmesi();
    // çalışan + auto-start açık JVM: Kapat düğmesi YOK, sebep yazılı
    const kosan = screen.getByText('kosan').closest('tr')!;
    expect(within(kosan).queryByRole('button', { name: 'Kapat' })).toBeNull();
    expect(within(kosan).getByText('çalışıyor — kapatılamaz')).toBeInTheDocument();
    expect(within(tr).queryByText('açık')).toBeNull();
    fireEvent.click(within(tr).getByRole('button', { name: 'Aç' }));
    expect(await screen.findByText(/durmus \(JBoss 7\) için auto-start AÇILACAK/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Auto-start aç' }));
    await waitFor(() => expect(within(tr).getByRole('status')).toHaveTextContent('#901 · kuyrukta'));
    expect(within(tr).queryByRole('button', { name: 'Aç' })).toBeNull();
    const { fetchStatus } = addJob.mock.calls[0][0];
    // sunucu da doğrulanan değeri taşır
    const sonra = DETAY();
    sonra.jvms[0] = JVM('durmus', { autoStart: 'true', autoStartTarama: 'false', autoStartDogrulama: { jobId: 901, at: '2026-11-14T10:00:00Z' } });
    m.host.mockResolvedValue({ ok: true, host: sonra });
    m.jobStatus.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      output: '',
      result: satir('jboss_autostart_on', 'OK', 'durmus auto-start=true (host=m, CLI ile dogrulandi)'),
      autoStart: { dogrulandi: true, deger: 'true' },
    });
    await act(async () => {
      await fetchStatus();
    });
    expect(await within(tr).findByText('açık')).toBeInTheDocument();
    expect(within(tr).getByTestId('autostart-dogrulandi')).toHaveTextContent('iş #901 · tarama bekleniyor');
    expect(within(tr).getByRole('button', { name: 'Kapat' })).toBeInTheDocument();
    expect(toastM.success).toHaveBeenCalledWith(expect.stringContaining('AÇILDI (CLI ile doğrulandı, iş #901)'), expect.any(Number));
    expect(m.overview).toHaveBeenCalledTimes(1);
    // tam filo taze okuması (fresh) yok
    expect(m.host.mock.calls.every((c) => c[1] !== true)).toBe(true);
  });
});

describe('AI4 Özet yalnız bu sunucunun etiketleri', () => {
  it('retireEtiketleri host ile', async () => {
    render(<ServerHubPage />);
    const satirEl = (await screen.findByRole('button', { name: `${APP} ayrıntısı` })).closest('tr')!;
    fireEvent.click(within(satirEl).getByRole('button', { name: 'Ayrıntı' }));
    await waitFor(() => expect(m.retireEtiketleri).toHaveBeenCalledWith(false, APP));
  });
});

// ── İnceleme turu (2026-11-14) ─────────────────────────────────────────────────────────────
//   AI5 iş çubuğundaki sekme kapatılınca (izleyici fetchStatus'u bir daha çağırmaz) yedek yoklama işi izler:
//       kilit kalkar, sonuç gelir; izleyici yoklarken AWX'e EK istek atılmaz (tek uçuş)
//   AI6 pencere iş sürerken kapatılıp yeniden açılırsa sonuç YENİ pencereye yansır (bitiş her pencereye)
//   AI7 FAIL sonucu satırda kalır (bildirim kaybolsa da)
//   AI8 önbellekteki ayrıntı gösterilirken tazeleme düşerse uyarı görünür (sessiz değil)
describe('AI5 iş çubuğundan kaldırılan iş', () => {
  it('yedek yoklama kilidi bırakır ve sonucu verir', async () => {
    vi.useFakeTimers();
    try {
      m.jvmAutoStart.mockResolvedValue({ ok: true, jobId: 902, awxServerId: 1 });
      const onBitti = vi.fn();
      expect(await autoStartBaslat({ host: APP, gen: 7, jvm: 'pay', ac: true, addJob, onBitti })).toBe(true);
      const { fetchStatus } = addJob.mock.calls[0][0];
      // izleyici bir kez yokladı (koşuyor), sonra kullanıcı sekmeyi kapattı: fetchStatus bir daha çağrılmaz
      // izleyici yedek döngünün ilk turundan hemen önce yokladı (9. sn)
      await vi.advanceTimersByTimeAsync(9_000);
      m.jobStatus.mockResolvedValueOnce({ ok: true, status: 'running', output: '' });
      await fetchStatus();
      expect(m.jobStatus).toHaveBeenCalledTimes(1);
      // yedek döngü 10. sn'de döner: izleyici yakın zamanda yokladığı için EK istek atmaz
      await vi.advanceTimersByTimeAsync(2_000);
      expect(m.jobStatus).toHaveBeenCalledTimes(1);
      m.jobStatus.mockResolvedValue({ ok: true, status: 'successful', output: '', result: satir('jboss_autostart_on', 'OK', 'pay auto-start=true') });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(autoStartIsVar(`${APP}|7|pay`)).toBe(false);
      expect(onBitti).toHaveBeenCalledWith(expect.objectContaining({ tur: 'ok', deger: 'true', jobId: 902 }));
      const n = m.jobStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(m.jobStatus.mock.calls.length).toBe(n);
    } finally {
      vi.useRealTimers();
    }
  });
  it('izleyici ve yedek aynı anda isterse tek AWX isteği', async () => {
    m.jvmAutoStart.mockResolvedValue({ ok: true, jobId: 903, awxServerId: 1 });
    await autoStartBaslat({ host: APP, gen: 7, jvm: 'tek', ac: true, addJob });
    const { fetchStatus } = addJob.mock.calls[0][0];
    let coz: (v: unknown) => void = () => {};
    m.jobStatus.mockImplementation(() => new Promise((r) => (coz = r)));
    const a = fetchStatus();
    const b = fetchStatus();
    coz({ ok: true, status: 'running', output: '' });
    await Promise.all([a, b]);
    expect(m.jobStatus).toHaveBeenCalledTimes(1);
  });
});

function pencereKapat() {
  const b = screen.getAllByRole('button', { name: 'Kapat' }).find((x) => !x.closest('tr'));
  fireEvent.click(b!);
}

describe('AI6 pencere kapanıp açılınca sonuç yeni pencereye', () => {
  it('bitiş yeni HostModal örneğine yansır', async () => {
    m.jvmAutoStart.mockResolvedValue({ ok: true, jobId: 904, awxServerId: 1 });
    const tr = await jvmSekmesi();
    fireEvent.click(within(tr).getByRole('button', { name: 'Aç' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Auto-start aç' }));
    await waitFor(() => expect(within(tr).getByRole('status')).toHaveTextContent('#904'));
    const { fetchStatus } = addJob.mock.calls[0][0];
    pencereKapat();
    await waitFor(() => expect(screen.queryByText('durmus')).toBeNull());
    // yeniden aç
    const satirEl = screen.getByRole('button', { name: `${APP} ayrıntısı` }).closest('tr')!;
    fireEvent.click(within(satirEl).getByRole('button', { name: 'Ayrıntı' }));
    await screen.findByTestId('panel-taklit');
    fireEvent.click(screen.getByRole('button', { name: 'JVM · 2' }));
    const tr2 = screen.getByText('durmus').closest('tr')!;
    expect(within(tr2).getByRole('status')).toHaveTextContent('#904 · kuyrukta');
    const hostOnce = m.host.mock.calls.length;
    // sunucu doğrulanan değeri /host'ta taşır (AS4)
    const sonra = DETAY();
    sonra.jvms[0] = JVM('durmus', { autoStart: 'true', autoStartTarama: 'false', autoStartDogrulama: { jobId: 904, at: '2026-11-14T10:00:00Z' } });
    m.host.mockResolvedValue({ ok: true, host: sonra });
    m.jobStatus.mockResolvedValueOnce({ ok: true, status: 'successful', output: '', result: satir('jboss_autostart_on', 'OK', 'ok') });
    await act(async () => {
      await fetchStatus();
    });
    expect(await within(tr2).findByText('açık')).toBeInTheDocument();
    expect(within(tr2).getByTestId('autostart-dogrulandi')).toHaveTextContent('iş #904');
    await waitFor(() => expect(m.host.mock.calls.length).toBe(hostOnce + 1));
  });
});

describe('AI7 FAIL satırda kalır', () => {
  it('başarısız iş sebebi satırda', async () => {
    m.jvmAutoStart.mockResolvedValue({ ok: true, jobId: 905, awxServerId: 1 });
    const tr = await jvmSekmesi();
    fireEvent.click(within(tr).getByRole('button', { name: 'Aç' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Auto-start aç' }));
    await waitFor(() => expect(within(tr).getByRole('status')).toHaveTextContent('#905'));
    const { fetchStatus } = addJob.mock.calls[0][0];
    m.jobStatus.mockResolvedValueOnce({ ok: true, status: 'failed', output: '', result: satir('jboss_autostart_on', 'FAIL', "host controller'a baglanilamadi") });
    await act(async () => {
      await fetchStatus();
    });
    expect(await within(tr).findByTestId('autostart-basarisiz')).toHaveTextContent("iş #905 başarısız: host controller'a baglanilamadi");
    expect(within(tr).getByRole('button', { name: 'Aç' })).toBeInTheDocument();
  });
});

describe('AI8 tazeleme düşerse uyarı', () => {
  it('önbellekteki ayrıntı + /host hatası -> uyarı', async () => {
    shOnbellek.yaz(`host:${APP}`, DETAY());
    m.host.mockRejectedValue(new Error('ag yok'));
    render(<ServerHubPage />);
    const satirEl = (await screen.findByRole('button', { name: `${APP} ayrıntısı` })).closest('tr')!;
    fireEvent.click(within(satirEl).getByRole('button', { name: 'Ayrıntı' }));
    expect(await screen.findByTestId('ayrinti-tazelenemedi')).toHaveTextContent('ag yok');
  });
});
