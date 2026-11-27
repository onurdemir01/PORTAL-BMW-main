// @vitest-environment jsdom
// Server Hub SUNUCU AYRINTI PENCERESI (2026-11-27, kapsam PR-2): Bulgular / JVM / Web / Init / IP sekmeleri gercek
// ayrinti yanitiyla. "Olculemedi" ile "yok / kapali / 0" ayrimi (sozlesme v3) her sekmede hucre hucre sinanir.
//   SP1 baslik (tarayici surumu, kosan kullanici, gecis fazlari); bulgular: log kaniti, atfedilemeyen proxy, kod etiketi
//   SP2 duzelt akisi: plan -> plan sonucu -> onay (reload) -> basarisiz / basarili; red ve istisna; ESC
//   SP3 JVM sekmesi: calisma durumu (bilinmiyor), auto-start dugmesi ve engelleri, trafik "?", host controller
//   SP4 Web / Init / IP sekmeleri: urun durumu, vhost satirlari (rozetler, alt sinir, paylasimli log), init durumlari,
//       IP kullanan etiketleri, sshd; bos listeler; ayrinti okunamadi
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';

const m = vi.hoisted(() => ({
  overview: vi.fn(),
  findings: vi.fn(),
  limitler: vi.fn(),
  hostAdlari: vi.fn(),
  jobStatus: vi.fn(),
  scan: vi.fn(),
  host: vi.fn(),
  fix: vi.fn(),
  retireEtiketleri: vi.fn(),
  gorunumler: vi.fn(),
  gorunumKaydet: vi.fn(),
  gorunumSil: vi.fn(),
}));
const izle = vi.hoisted(() => ({ addJob: vi.fn() }));
const toastM = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => izle }));
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

const SATIR = {
  host: 'ORCJAP01',
  env: 'PROD',
  envGroup: 'Production',
  hostClass: 'genel',
  status: 'danger',
  counts: { danger: 1, warning: 1, info: 0 },
  products: ['JBOSS7', 'IHS'],
  jvms: 7,
  jvmsRunning: 2,
  vhosts: 3,
  unusedIps: 1,
  topFinding: 'reboot riski',
  scanDate: '2026-11-26',
  cpuS: 2.34,
  fresh: true,
};
const VH = (o: Record<string, unknown>) => ({
  host: 'ORCWAP01',
  product: 'IHS',
  serverName: 'pos.ornek.invalid',
  req24h: 10,
  req7d: 100,
  hc24h: 3,
  sampled: false,
  ...o,
});
const J = (o: Record<string, unknown>) => ({
  gen: 7,
  name: 'jvm',
  group: 'grp',
  running: false,
  autoStart: 'false',
  serverState: 'STOPPED',
  ports: [],
  req24h: null,
  req7d: null,
  matchKind: null,
  vhosts: [],
  ...o,
});
const BULGU_DUZELT = {
  severity: 'danger',
  defaultSeverity: 'warning',
  area: 'web',
  code: 'REBOOT_RISK',
  text: 'pos vhost kapatılmalı',
  fix: { action: 'apache_comment_vhost', file: '/etc/httpd/pos.conf', line: 12 },
  scanDate: '2026-11-26',
  logs: [
    {
      host: 'ORCWAP01',
      serverName: 'pos.ornek.invalid',
      path: '/logs/pos.log',
      confFile: 'pos.conf',
      req7d: 5,
      req24h: 1,
      sampled: true,
      shared: true,
      read: true,
    },
    {
      host: 'ORCWAP02',
      serverName: '',
      path: '',
      confFile: 'x.conf',
      req7d: null,
      req24h: null,
      sampled: false,
      shared: false,
      read: false,
    },
  ],
  unattributed: [
    { host: 'ORCWAP01', serverName: 'pos.ornek.invalid', port: 8443, kind: 'PORT', req7d: 5 },
    {
      host: 'ORCWAP02',
      serverName: 'lb',
      port: 443,
      target: 'lb.ornek.invalid',
      kind: 'HEDEF',
      reason: 'DINAMIK',
      trafficState: 'istek var',
    },
    { target: 'vip.ornek.invalid:443', port: 443, kind: 'HEDEF', reason: 'YENI' },
    { host: 'ORCWAP03', serverName: 'k', kind: 'EKSIK', req7d: 0 },
    { kind: '', target: null },
  ],
};
const DETAY = {
  ...SATIR,
  wallS: 30,
  scanVer: '3.4',
  note: 'kosan: was (was); faz=www; faz=was',
  findings: [
    BULGU_DUZELT,
    { severity: 'info', area: 'yeni-alan', code: 'YENI_KOD', text: 'bilgi bulgusu', fix: null },
  ],
  init: [
    { root: '/vhosting', file: 'start.sh', status: 'OK' },
    { root: '/vhosting', file: 'stop.sh', status: 'DIFF' },
    { root: '/vhosting8', file: 'start.sh', status: 'MISSING' },
    { root: '/vhosting8', file: 'stop.sh', status: 'UNREADABLE' },
    { root: '/vhosting8', file: 'env.sh', status: '' },
  ],
  jboss: [{ gen: 7, hostName: 'master', hostState: 'running', cli: 'OK', note: '' }],
  jvms: [
    J({
      name: 'odeme',
      running: true,
      runningSrc: 'PS',
      autoStart: 'true',
      serverState: 'STARTED',
      ports: [8080, 8443],
      req24h: 10,
      req7d: 100,
      matchKind: 'proxy',
      vhosts: [VH({})],
    }),
    J({
      name: 'rapor',
      group: '',
      serverState: 'restart-required',
      vhosts: [VH({ serverName: 'rapor.ornek.invalid', req24h: null, req7d: null })],
    }),
    J({ name: 'gizli', runningKnown: false, autoStart: 'unknown', req7d: 0, ports: [9090] }),
    J({
      gen: 0,
      name: 'envanterde',
      yalnizEnvanter: true,
      source: 'envanter',
      autoStart: 'unknown',
    }),
    J({ gen: 8, name: 'domainsiz', domainKapali: true, autoStart: 'true' }),
    J({ name: 'tanimsiz', source: 'cli', cfgSrc: 'UNAVAILABLE', running: true }),
    J({
      name: 'dogrulandi',
      autoStart: 'true',
      autoStartDogrulama: { jobId: 55, at: '2026-11-26T10:00:00Z' },
      autoStartTarama: 'false',
    }),
  ],
  web: [
    { product: 'IHS', running: true, runningSrc: 'PS', syntax: 'OK', detail: 'httpd -t OK' },
    { product: 'NGINX', running: false, syntax: 'FAIL', detail: 'nginx -t: hata' },
    { product: 'RHA', running: false, runningSrc: 'UNMEASURED', syntax: 'UNKNOWN', detail: '' },
  ],
  vhosts: [
    {
      product: 'IHS',
      listen: '443',
      serverName: 'pos.ornek.invalid',
      aliases: 'a.ornek.invalid  b.ornek.invalid',
      accessLog: '/logs/pos.log',
      proxyTargets: 'ORCJAP01:8080',
      req24h: 10,
      req7d: 100,
      hc24h: 3,
      shared: true,
      sampled: true,
      confFile: 'pos.conf',
      jvm: 'odeme',
      trafficState: 'ACTIVE',
      trafficReason: 'WINDOW_NOT_COVERED',
      targetsTruncated: true,
    },
    {
      product: 'NGINX',
      listen: '80',
      serverName: 'eski.ornek.invalid',
      aliases: '',
      accessLog: '',
      proxyTargets: '',
      req24h: -1,
      req7d: 0,
      hc24h: null,
      shared: false,
      sampled: false,
      confFile: 'eski.conf',
      jvm: null,
      trafficState: 'NO_RECENT_TRAFFIC',
      trafficReason: 'OK',
      targetsDynamic: true,
    },
    {
      product: 'NGINX',
      listen: '80',
      serverName: 'kayip.ornek.invalid',
      aliases: '',
      accessLog: '/logs/kayip.log',
      proxyTargets: 'ORCJAP01:9090',
      req24h: null,
      req7d: null,
      hc24h: 0,
      shared: false,
      sampled: false,
      confFile: 'kayip.conf',
      jvm: null,
      trafficState: 'YENI_DURUM',
      trafficReason: 'YENI_SEBEP',
    },
  ],
  ips: [
    { ip: '192.0.2.10', iface: 'eth0', usedBy: 'ihs', primary: true },
    { ip: '192.0.2.11', iface: 'eth0:1', usedBy: 'none', primary: false },
    { ip: '192.0.2.12', iface: 'eth0:2', usedBy: 'unverified', primary: false },
    { ip: '192.0.2.13', iface: 'eth0:3', usedBy: 'wildcard', primary: false },
    { ip: '192.0.2.14', iface: 'eth0:4', usedBy: 'other', primary: false },
  ],
  sshd: { maxSessions: 10, maxStartups: '', activeSessions: null },
};

beforeEach(() => {
  window.localStorage.clear();
  Object.values(m).forEach((f) => f.mockReset());
  izle.addJob.mockReset();
  Object.values(toastM).forEach((f) => f.mockReset());
  shOnbellek._sifirlaForTest();
  m.overview.mockResolvedValue({
    ok: true,
    tableMissing: false,
    latestScan: '2026-11-26',
    summary: null,
    hosts: [SATIR],
  });
  m.limitler.mockResolvedValue({ ok: true, limitler: [] });
  m.findings.mockResolvedValue({ ok: true, findings: [] });
  m.host.mockResolvedValue({ ok: true, host: DETAY });
  m.retireEtiketleri.mockResolvedValue({ ok: true, kurallar: [], etiketler: [], ozet: {} });
  m.gorunumler.mockResolvedValue({ ok: true, okunamadi: false, gorunumler: [] });
});

const metin = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
async function pencere(): Promise<HTMLElement> {
  render(<ServerHubPage />);
  const satir = (await screen.findByRole('button', { name: 'ORCJAP01 ayrıntısı' })).closest('tr')!;
  fireEvent.click(within(satir).getByRole('button', { name: 'Ayrıntı' }));
  const p = await screen.findByRole('dialog', { name: 'ORCJAP01' });
  await within(p).findByTestId('panel-taklit');
  return p;
}
const sekmeAc = (p: HTMLElement, ad: RegExp) =>
  fireEvent.click(within(p).getByRole('button', { name: ad }));
const satirHucreleri = (tablo: HTMLElement, ilk: string) =>
  [...(within(tablo).getByText(ilk).closest('tr') as HTMLElement).querySelectorAll('td')].map(
    (td) => metin(td),
  );

describe('Sunucu ayrıntı penceresi', () => {
  it('SP1 başlık, bulgular: log kanıtı, atfedilemeyen proxy, kod etiketi', async () => {
    const p = await pencere();
    expect(m.host).toHaveBeenCalledWith('ORCJAP01');
    expect(metin(p)).toContain(
      'JBOSS7 · IHS · son tarama 26.11.2026 · tarama 2.3 sn CPU · tarayıcı v3.4 · koşan: was (was) · geçiş: www+was',
    );
    // Sekme etiketleri ayrintidaki sayilarla.
    // JVM sekmesi yalniz envanterdeki uygulamayi ayri sayar.
    for (const ad of [
      /^Bulgular · 2$/,
      /^JVM · 6 \+ 1 /,
      /^Web \/ vhost · 3$/,
      /^Init · 5$/,
      /^IP · 5$/,
    ])
      expect(within(p).getByRole('button', { name: ad })).toBeTruthy();
    sekmeAc(p, /^Bulgular/);
    const liste = within(p).getAllByRole('listitem');
    const ilk = liste.find((li) =>
      li.textContent?.includes('pos vhost kapatılmalı'),
    ) as HTMLElement;
    expect(metin(ilk)).toContain(
      'Web sunucu · REBOOT_RISK — JVM çalışıyor ama auto-start kapalı — reboot sonrası açılmaz',
    );
    // Log kaniti: okunan / okunamayan ayri; alt sinir ve paylasimli log.
    const log = within(ilk).getByText(/^Okunan log: 1/);
    expect(log).toHaveTextContent('Okunan log: 1 · okunamayan: 1 · tarama 2026-11-26');
    fireEvent.click(log);
    expect(metin(ilk)).toContain(
      '/logs/pos.log — ORCWAP01/pos.ornek.invalid · 7g 5 (alt sınır: kuyruk 7 günü kapsamadı ya da trafiğin bir kısmı bu logda yok) · paylaşımlı log',
    );
    expect(metin(ilk)).toContain(
      '(access_log tanımsız) — ORCWAP02/? · OKUNAMADI — bu dosya kanıt sayılmaz',
    );
    // Atfedilemeyen proxy: tur, neden, hedef ve trafik bicimleri.
    fireEvent.click(within(ilk).getByText('Atfedilemeyen proxy: 5'));
    const atf = [...ilk.querySelectorAll('details')[1].querySelectorAll('li')].map((li) =>
      metin(li),
    );
    expect(atf).toEqual([
      "ORCWAP01/pos.ornek.invalid → :8443 · port hiçbir JVM'e ait değil · 7g 5",
      'ORCWAP02/lb → lb.ornek.invalid (:443) · hedefi bilinmeyen proxy (dinamik proxy — hedef kaydı yok) · istek var',
      '?/? → vip.ornek.invalid:443 · hedefi bilinmeyen proxy (neden: YENI) · trafik ölçülemedi',
      'ORCWAP03/k → ~ (kesilen kısım bilinmiyor) · hedef listesi kesik · trafik ölçülemedi',
      '?/? → ? · tür: — · trafik ölçülemedi',
    ]);
    // Bilinmeyen alan ve kod ham adiyla; duzeltmesiz bulguda dugme yok.
    const ikinci = liste.find((li) => li.textContent?.includes('bilgi bulgusu')) as HTMLElement;
    expect(metin(ikinci)).toContain('yeni-alan · YENI_KOD');
    expect(within(ikinci).queryByRole('button', { name: /Düzelt/ })).toBeNull();
  });

  it('SP2 düzelt: plan, onay (reload), başarısız ve başarılı; red ve istisna; ESC', async () => {
    const p = await pencere();
    sekmeAc(p, /^Bulgular/);
    const duzeltAc = () => {
      fireEvent.click(within(p).getByRole('button', { name: /Düzelt/ }));
      return screen.getByRole('dialog', { name: 'Düzelt — apache_comment_vhost' });
    };
    let k = duzeltAc();
    expect(metin(k)).toContain('/etc/httpd/pos.conf');
    expect(metin(k)).toContain('ORCJAP01');
    // ESC yalniz katmani kapatir; sunucu penceresi acik.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Düzelt — apache_comment_vhost' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'ORCJAP01' })).toBeTruthy();

    // Red: plan asamasina geri doner.
    k = duzeltAc();
    m.fix.mockResolvedValueOnce({ ok: false, message: 'eylemler kapalı' });
    fireEvent.click(within(k).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('eylemler kapalı'));
    expect(within(k).getByRole('button', { name: 'Planı göster' })).toBeTruthy();
    m.fix.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(within(k).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('ağ yok'));

    // Plan: is izlenir, plan sonucu pencerede.
    m.fix.mockResolvedValueOnce({ ok: true, jobId: 900, awxServerId: 2 });
    fireEvent.click(within(k).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'Plan işi başladı (#900). Sonuç bu pencerede görünecek.',
      ),
    );
    expect(m.fix).toHaveBeenLastCalledWith({
      host: 'ORCJAP01',
      code: 'REBOOT_RISK',
      fix: BULGU_DUZELT.fix,
      confirmed: false,
      reload: false,
    });
    expect(metin(k)).toContain('Plan koşuyor…');
    // Plan surerken iptal kapali, reload kutusu kilitli.
    expect(within(k).getByRole('button', { name: 'İptal' })).toBeDisabled();
    expect(within(k).getByRole('checkbox')).toBeDisabled();
    const is = () =>
      izle.addJob.mock.calls.at(-1)![0] as { title: string; fetchStatus: () => Promise<unknown> };
    expect(is().title).toBe('Server Hub: plan apache_comment_vhost @ ORCJAP01');
    m.jobStatus.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      output: '',
      result: { line: 'RESULT\tpos.conf\tPLAN\t2 satır yorumlanacak' },
    });
    await act(async () => {
      await is().fetchStatus();
    });
    expect(m.jobStatus).toHaveBeenLastCalledWith(2, 900);
    expect(metin(k)).toContain('Plan: PLAN — 2 satır yorumlanacak');

    // Onay: reload secili; is basarisiz biter -> sebep, onay dugmesi FAIL planda yok.
    fireEvent.click(within(k).getByRole('checkbox'));
    m.fix.mockResolvedValueOnce({ ok: true, jobId: 901, awxServerId: 2 });
    fireEvent.click(within(k).getByRole('button', { name: 'Onayla ve uygula' }));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'Düzeltme işi başladı (#901). Sonuç bu pencerede görünecek.',
      ),
    );
    expect(m.fix).toHaveBeenLastCalledWith(
      expect.objectContaining({ confirmed: true, reload: true }),
    );
    expect(metin(k)).toContain('Uygulanıyor…');
    expect(is().title).toBe('Server Hub: düzelt apache_comment_vhost @ ORCJAP01');
    m.jobStatus.mockResolvedValueOnce({
      ok: true,
      status: 'failed',
      output: '',
      result: { line: 'RESULT\tpos.conf\tFAIL\tsözdizimi hatası' },
    });
    await act(async () => {
      await is().fetchStatus();
    });
    expect(toastM.error).toHaveBeenCalledWith('Düzeltme başarısız: FAIL — sözdizimi hatası');
    expect(metin(k)).toContain('Plan: FAIL — sözdizimi hatası');
    expect(within(k).queryByRole('button', { name: 'Onayla ve uygula' })).toBeNull();
    fireEvent.click(within(k).getByRole('button', { name: 'İptal' }));

    // Yeniden: plan (sonuc satiri yok -> durum), onay, basarili -> pencere kapanir, liste ve ayrinti tazelenir.
    k = duzeltAc();
    m.fix.mockResolvedValueOnce({ ok: true, jobId: 902, awxServerId: 2 });
    fireEvent.click(within(k).getByRole('button', { name: 'Planı göster' }));
    await waitFor(() => expect(izle.addJob).toHaveBeenCalledTimes(3));
    m.jobStatus.mockResolvedValueOnce({ ok: true, status: 'successful', output: '', result: null });
    await act(async () => {
      await is().fetchStatus();
    });
    expect(metin(k)).toContain('Plan: successful');
    m.fix.mockResolvedValueOnce({ ok: true, jobId: 903, awxServerId: 2 });
    fireEvent.click(within(k).getByRole('button', { name: 'Onayla ve uygula' }));
    await waitFor(() => expect(izle.addJob).toHaveBeenCalledTimes(4));
    const listeOnce = m.overview.mock.calls.length;
    m.jobStatus.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      output: '',
      result: { line: 'RESULT\tpos.conf\tOK\tuygulandı' },
    });
    await act(async () => {
      await is().fetchStatus();
    });
    expect(toastM.success).toHaveBeenCalledWith('Uygulandı: OK — uygulandı');
    expect(screen.queryByRole('dialog', { name: 'Düzelt — apache_comment_vhost' })).toBeNull();
    await waitFor(() => expect(m.overview.mock.calls.length).toBe(listeOnce + 1));
    expect(m.host).toHaveBeenLastCalledWith('ORCJAP01', true);
  });

  it('SP3 JVM sekmesi: çalışma durumu, auto-start düğmesi ve engelleri, trafik, host controller', async () => {
    const p = await pencere();
    sekmeAc(p, /^JVM/);
    const tablo = within(p).getByRole('table');
    expect(satirHucreleri(tablo, 'odeme')).toEqual([
      'JBoss 7',
      'odeme',
      'grp',
      'çalışıyor',
      'açıkçalışıyor — kapatılamaz',
      'STARTED',
      '8080, 8443',
      'pos.ornek.invalid @ORCWAP01',
      '10',
      '100',
    ]);
    const durum = within(tablo).getByText('odeme').closest('tr')!.querySelectorAll('td')[3];
    expect(durum.querySelector('span')).toHaveAttribute('title', 'kaynak: PS');
    // Web katmani var ama trafik olculemedi: "?" ve sebep; auto-start kapali -> "Ac".
    const rapor = satirHucreleri(tablo, 'rapor');
    expect(rapor.slice(2, 10)).toEqual([
      '—',
      'kapalı',
      'kapalıAç',
      'restart-required',
      '—',
      'rapor.ornek.invalid @ORCWAP01',
      '?',
      '?',
    ]);
    const raporSatir = within(tablo).getByText('rapor').closest('tr')!;
    expect(raporSatir.querySelectorAll('td')[8]).toHaveAttribute(
      'title',
      'trafik doğrulanamadı (log okunamadı ya da web katmanı ölçülemedi)',
    );
    expect(within(raporSatir).getByRole('button', { name: 'Aç' })).toHaveAttribute(
      'title',
      "rapor için auto-start'ı AÇ (yalnız bu JVM)",
    );
    // Calisma durumu olculemedi: "kapali" denmez; auto-start "?"; dugme acar ve uyarir; 7 gun 0 vurgulu.
    const gizli = within(tablo).getByText('gizli').closest('tr')!;
    expect(metin(gizli.querySelectorAll('td')[3])).toBe('bilinmiyor (süreç görünmüyor)');
    expect(gizli.querySelectorAll('td')[3].querySelector('span')!.getAttribute('title')).toMatch(
      /^Çalışma durumu ölçülemedi: sunucuda süreç listesi kısıtlı \(hidepid\)/,
    );
    expect(within(gizli).getByRole('button', { name: 'Aç' })).toHaveAttribute(
      'title',
      "gizli için auto-start ölçülemedi — AÇ'a basarsanız açıkça açılır · çalışma durumu ölçülemedi",
    );
    expect(metin(gizli.querySelectorAll('td')[4])).toContain('?');
    expect(metin(gizli.querySelectorAll('td')[9])).toBe('0');
    // Web katmani eslenmemis JVM: trafik sayisi da yok.
    expect(metin(gizli.querySelectorAll('td')[7])).toBe('eşlenemedi');
    // Yalniz envanterde / tanimsiz surec: degistirilemez ve sebebi.
    const envanter = within(tablo).getByText('envanterde').closest('tr')!;
    expect(within(envanter).getByText('değiştirilemez')).toHaveAttribute(
      'title',
      "yalnız envanterde — taramada JVM'i yok, auto-start değiştirilemez",
    );
    const tanimsiz = within(tablo).getByText('tanimsiz').closest('tr')!;
    expect(within(tanimsiz).getByText('değiştirilemez')).toHaveAttribute(
      'title',
      "tanım kaynağında yok (ps'te tanımsız süreç) — auto-start değiştirilemez",
    );
    // Domain kapali: host XML ile kapatma.
    const domainsiz = within(tablo).getByText('domainsiz').closest('tr')!;
    expect(
      within(domainsiz).getByRole('button', { name: "Auto-start'ı kapat (host XML)" }),
    ).toHaveAttribute(
      'title',
      "domainsiz: JBoss 8 domain kapalı — auto-start host XML'de false yapılır (önce plan, sonra onay)",
    );
    // CLI'dan dogrulanmis auto-start: tarama bekleniyor.
    const dogru = within(tablo).getByText('dogrulandi').closest('tr')!;
    expect(within(dogru).getByTestId('autostart-dogrulandi')).toHaveTextContent(
      '✓ iş #55 · tarama bekleniyor',
    );
    expect(within(dogru).getByText('açık')).toHaveAttribute(
      'title',
      "İş #55 ile CLI'dan doğrulandı (26.11.2026); son tarama kapalı gösteriyor — bir sonraki taramada güncellenir.",
    );
    expect(metin(p)).toContain('JBoss 7 host controller "master": running · CLI OK');
  });

  it('SP4 Web, Init ve IP sekmeleri; boş listeler; ayrıntı okunamadı', async () => {
    const p = await pencere();
    sekmeAc(p, /^Web \/ vhost/);
    const urun = (ad: string) =>
      [...within(p).getByText(ad, { selector: 'b' }).parentElement!.querySelectorAll('span')].map(
        (x) => metin(x),
      );
    expect(urun('IHS')).toEqual(['çalışıyor', 'syntax OK', 'httpd -t OK']);
    expect(urun('NGINX')).toEqual(['çalışmıyor', 'syntax FAIL', 'nginx -t: hata']);
    // Olculemeyen web sureci "calismiyor" sayilmaz.
    expect(urun('RHA')).toEqual(['bilinmiyor (süreç görünmüyor)', 'syntax UNKNOWN', '']);
    const tablo = within(p).getByRole('table');
    expect(satirHucreleri(tablo, 'pos.ornek.invalid')).toEqual([
      'IHS',
      '443',
      'pos.ornek.invalid +2',
      'ORCJAP01:8080hedef listesi kesik',
      'odeme',
      '10',
      '100~',
      '3',
      '/logs/pos.log (paylaşımlı)',
    ]);
    const pos = within(tablo).getByText('pos.ornek.invalid').closest('tr')!;
    expect(pos.querySelectorAll('td')[6]).toHaveAttribute(
      'title',
      expect.stringMatching(
        /^istek var · sebep: log okundu ama 7 günü kapsamıyor · sayı alt sınır: log kuyruğu/,
      ),
    );
    expect(satirHucreleri(tablo, 'eski.ornek.invalid')).toEqual([
      'NGINX',
      '80',
      'eski.ornek.invalid',
      '—dinamik proxy',
      '—',
      '?',
      '0',
      '?',
      '—',
    ]);
    const eski = within(tablo).getByText('eski.ornek.invalid').closest('tr')!;
    expect(eski.querySelectorAll('td')[6]).toHaveAttribute(
      'title',
      '7 gündür istek yok (log okundu)',
    );
    const kayip = within(tablo).getByText('kayip.ornek.invalid').closest('tr')!;
    expect(kayip.querySelectorAll('td')[6]).toHaveAttribute(
      'title',
      'YENI_DURUM · sebep: YENI_SEBEP',
    );
    expect(metin(kayip.querySelectorAll('td')[6])).toBe('?');

    sekmeAc(p, /^Init/);
    const init = [...within(p).getByRole('table').querySelectorAll('tbody tr')].map((tr) =>
      metin(tr.querySelectorAll('td')[2]),
    );
    expect(init).toEqual([
      'referansla aynı',
      'FARKLI',
      'yok',
      'okunamadı (ölçülemedi)',
      'bilinmiyor (—)',
    ]);

    sekmeAc(p, /^IP/);
    const ipler = [...within(p).getByRole('table').querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => metin(td)),
    );
    expect(ipler).toEqual([
      ['192.0.2.10', 'eth0', 'IHS', 'birincil'],
      ['192.0.2.11', 'eth0:1', 'BOŞTA', ''],
      ['192.0.2.12', 'eth0:2', 'DOĞRULANAMADI', ''],
      ['192.0.2.13', 'eth0:3', 'joker dinleyici (*)', ''],
      ['192.0.2.14', 'eth0:4', 'web dışı soket', ''],
    ]);
    expect(metin(p)).toContain('sshd: MaxSessions 10 · MaxStartups ? · açık ssh oturumu ?');
  });

  it('SP5 boş ayrıntı: sorun yok, tanımsız listeler; ayrıntı okunamadı', async () => {
    m.host.mockResolvedValueOnce({
      ok: true,
      host: {
        ...DETAY,
        cpuS: null,
        scanVer: null,
        note: null,
        products: [],
        scanDate: null,
        findings: [],
        jvms: [],
        jboss: [],
        web: [],
        vhosts: [],
        init: [],
        ips: [],
        sshd: null,
      },
    });
    let p = await pencere();
    expect(metin(p)).toContain('ürün yok · son tarama —');
    expect(metin(p)).not.toContain('sn CPU');
    sekmeAc(p, /^Bulgular/);
    expect(metin(p)).toContain('Sorun yok. Reboot için engel görünmüyor.');
    sekmeAc(p, /^JVM/);
    expect(metin(p)).toContain('Bu sunucuda JBoss JVM tanımı yok.');
    sekmeAc(p, /^Web/);
    expect(metin(p)).toContain('vhost tanımı yok.');
    sekmeAc(p, /^Init/);
    expect(metin(p)).toContain('Init script dizini yok ya da referans verilmedi.');
    sekmeAc(p, /^IP/);
    expect(metin(p)).toContain('IP bilgisi yok.');
    expect(metin(p)).not.toContain('sshd:');
    fireEvent.click(within(p).getAllByRole('button', { name: 'Kapat' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ORCJAP01' })).toBeNull());

    // Onbellekte ayrinti yokken okunamadi: hata metni.
    shOnbellek._sifirlaForTest();
    m.host.mockResolvedValueOnce({ ok: false });
    const satir = screen.getByRole('button', { name: 'ORCJAP01 ayrıntısı' }).closest('tr')!;
    fireEvent.click(within(satir).getByRole('button', { name: 'Ayrıntı' }));
    p = await screen.findByRole('dialog', { name: 'ORCJAP01' });
    expect(await within(p).findByText('Sunucu verisi alınamadı.')).toBeTruthy();
  });
});
