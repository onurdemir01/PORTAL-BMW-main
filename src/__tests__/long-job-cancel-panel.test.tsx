// src/__tests__/long-job-cancel-panel.test.tsx — "Uzun süren işleri otomatik iptal" ekranı.
//
// Üretim olayı (2026-10-03): iptal AWX'te 403 alıyordu ve bunu yalnızca sunucu logu
// biliyordu. Ekran artık başarısızlığı GÖSTERMELİ. Bu dosya DAVRANIŞ ölçer (fetch sahte):
//   P1 İPTAL EDİLEMEDİ / iptal sonrası hâlâ çalışıyor satırları KIRMIZI; özet bandı söyler
//   P2 yetki rozeti: no_admin → "Admin YOK"; unknown → "ölçülemedi" (YOK DEĞİL)
//   P3 "Şimdi kontrol et (kuru)" POST /dry-run çağırır, sonucu ayrı başlıkla gösterir
//   P4 workflow template seçilebilir; PUT gövdesinde kind:'workflow' + kuyruk seçeneği;
//      kaydetme uyarısı gösterilir (engelleme değil)
//   P5 yapılandırma okunamadı bandı; izleyici başlatılmamışsa kırmızı bant
// Doğrulayıcı turu (2026-10-03):
//   P6 workflow seçilince "alt işlerini de keser" uyarısı; metin "hiçbir zaman" demez
//   P7 "Admin ✓" rozeti token kapsamını ölçemiyorsa "token kapsamı ölçülemedi" der
//   P8 tarama sağlığı bandı (OTOMATİK İPTAL ÇALIŞMIYOR); işsiz deneme satırı "#undefined" yazmaz;
//      "kendiliğinden bitti" etiketi; doğrulanamayan kayıt notu
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LongJobCancelPanel from '@/components/admin/tabs/LongJobCancelPanel';

type Route = (url: string, init?: RequestInit) => unknown;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CFG = {
  enabled: true,
  thresholdMinutes: 60,
  cancelQueued: false,
  templates: [
    { serverId: 1, templateId: 42, kind: 'job', name: 'nginx_config_audit' },
    { serverId: 1, templateId: 43, kind: 'job', name: 'olculemeyen' },
  ],
};
const TEMPLATES = {
  ok: true,
  servers: [
    {
      serverId: 1,
      serverName: 'maestro2',
      ok: true,
      templates: [
        { id: 42, name: 'nginx_config_audit', kind: 'job' },
        { id: 43, name: 'olculemeyen', kind: 'job' },
        { id: 55, name: 'gece_bakim_wf', kind: 'workflow' },
      ],
    },
  ],
};
const job = (over: Record<string, unknown>) => ({
  serverId: 1,
  serverName: 'maestro2',
  kind: 'job',
  jobId: 700,
  jobName: 'nginx_config_audit',
  templateId: 42,
  status: 'running',
  started: '2026-10-03T08:00:00Z',
  created: '2026-10-03T08:00:00Z',
  executer: 'ayse',
  url: null,
  ageMinutes: 120,
  decision: 'cancel_failed',
  reason: 'İPTAL EDİLEMEDİ (AWX 403): yetki yok — tekrar denenmiyor',
  problem: true,
  ...over,
});
const tick = (over: Record<string, unknown> = {}) => ({
  at: '2026-10-03T10:00:00Z',
  durationMs: 120,
  dryRun: false,
  config: { enabled: true, thresholdMinutes: 60, cancelQueued: false, templateCount: 2 },
  configError: null,
  usingLastGoodConfig: false,
  servers: [{ serverId: 1, serverName: 'maestro2', ok: true, error: null, running: 3, queued: 0, truncated: false }],
  jobsTotal: 3,
  jobs: [
    job({}),
    job({ jobId: 701, decision: 'still_running', reason: 'İPTAL İSTENDİ AMA DURMADI', problem: true }),
    job({ jobId: 702, templateId: 99, jobName: 'envanter', decision: 'not_listed', reason: 'İzin listesinde değil', problem: false }),
  ],
  attempts: [],
  ...over,
});
const STATUS = {
  ok: true,
  instance: 'portal01:1234',
  configError: null,
  usingLastGoodConfig: false,
  lastTick: tick(),
  lastDryRun: null,
  attempts: [
    { at: '2026-10-03T10:00:00Z', serverName: 'maestro2', kind: 'job', jobId: 700, jobName: 'nginx_config_audit', outcome: 'failed', ok: false, message: 'AWX 403', teams: 'gonderildi' },
    { at: '2026-10-03T09:00:00Z', serverName: 'maestro2', kind: 'job', jobId: 650, jobName: 'nginx_config_audit', outcome: 'stopped', ok: true, message: 'doğrulandı', teams: null },
  ],
  open: { awaitingVerify: 0, stillRunning: 1, failed: 1 },
  watcher: { started: true, pollIntervalSeconds: 300, inFlight: false, lastTickStartedAt: null, lastTickFinishedAt: null, lastTickError: null },
  teamsConfigured: true,
};
const PERMS = {
  ok: true,
  permissions: [
    { serverId: 1, templateId: 42, kind: 'job', name: 'nginx_config_audit', state: 'no_admin', message: 'EDEMEZ' },
    { serverId: 1, templateId: 43, kind: 'job', name: 'olculemeyen', state: 'unknown', message: 'Ölçülemedi' },
  ],
};

let calls: { url: string; method: string; body?: string }[] = [];
function mockFetch(over: Partial<Record<string, Route>> = {}) {
  const routes: Record<string, Route> = {
    'GET /api/ansible/longjob-cancel': () => json({ ok: true, config: CFG, configError: null, usingLastGoodConfig: false, teamsConfigured: true }),
    'GET /api/ansible/longjob-cancel/templates': () => json(TEMPLATES),
    'GET /api/ansible/longjob-cancel/status': () => json(STATUS),
    'GET /api/ansible/longjob-cancel/permissions': () => json(PERMS),
    'POST /api/ansible/longjob-cancel/dry-run': () =>
      json({
        ok: true,
        result: tick({
          dryRun: true,
          jobs: [job({ jobId: 900, decision: 'would_cancel', reason: 'gerçek taramada İPTAL EDİLİR', problem: false })],
        }),
      }),
    'PUT /api/ansible/longjob-cancel': (_u, init) =>
      json({
        ok: true,
        config: JSON.parse(String(init?.body)),
        permissions: PERMS.permissions,
        warnings: ["1 template'te Portal BAŞKALARININ başlattığı işleri iptal EDEMEZ"],
      }),
    ...over,
  };
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      calls.push({ url, method, body: init?.body ? String(init.body) : undefined });
      const r = routes[`${method} ${url.split('?')[0]}`];
      if (!r) return json({ ok: false, message: `rota yok: ${method} ${url}` }, 404);
      return r(url, init) as Response;
    }),
  );
}

beforeEach(() => mockFetch());
afterEach(() => vi.unstubAllGlobals());

describe('LongJobCancelPanel', () => {
  it('P1 İPTAL EDİLEMEDİ ve iptal sonrası hâlâ çalışıyor satırları kırmızı; ilgisiz satır kırmızı değil', async () => {
    render(<LongJobCancelPanel summary={[]} />);
    const son = await screen.findByTestId('ljc-tick');
    const kirmizi = son.querySelectorAll('tr[data-problem="1"]');
    expect(kirmizi.length).toBe(2);
    for (const tr of Array.from(kirmizi)) expect(tr.className).toMatch(/bg-red-50/);
    expect(within(son).getByText('İPTAL EDİLEMEDİ')).toBeInTheDocument();
    expect(within(son).getByText('iptal sonrası hâlâ çalışıyor')).toBeInTheDocument();
    // izin listesinde olmayan iş varsayılan gizli; açılınca kırmızı DEĞİL
    fireEvent.click(within(son).getByText(/işi de göster/));
    const normal = son.querySelector('tr[data-problem="0"]');
    expect(normal?.className || '').not.toMatch(/bg-red/);
    // son denemeler: başarısız satır kırmızı
    const den = screen.getByTestId('ljc-attempts');
    expect(den.querySelector('tr[data-problem="1"]')?.className).toMatch(/bg-red-50/);
    expect(den.querySelector('tr[data-problem="0"]')?.className).not.toMatch(/bg-red/);
    // özet bandı
    expect(screen.getByText(/1 iş İPTAL EDİLEMEDİ ve AWX'te çalışmaya devam ediyor/)).toBeInTheDocument();
  });

  it('P2 yetki rozeti: no_admin → "Admin YOK", unknown → "yetki ölçülemedi" (YOK değil)', async () => {
    render(<LongJobCancelPanel summary={[]} />);
    const c42 = await screen.findByTestId('ljc-chip-1:job:42');
    await waitFor(() => expect(within(c42).getByText(/Admin YOK/)).toBeInTheDocument(), { timeout: 3000 });
    const c43 = screen.getByTestId('ljc-chip-1:job:43');
    expect(within(c43).getByText('yetki ölçülemedi')).toBeInTheDocument();
    expect(within(c43).queryByText(/Admin YOK/)).toBeNull();
    expect(calls.some((c) => c.url.includes('/permissions?t=') && decodeURIComponent(c.url).includes('1:42:job'))).toBe(true);
  });

  it('P3 "Şimdi kontrol et (kuru)" POST /dry-run çağırır ve sonucu ayrı başlıkla gösterir', async () => {
    render(<LongJobCancelPanel summary={[]} />);
    await screen.findByTestId('ljc-tick');
    fireEvent.click(screen.getByText('Şimdi kontrol et (kuru)'));
    const kuru = await screen.findByTestId('ljc-dry');
    expect(within(kuru).getByText(/hiçbir iş iptal EDİLMEDİ/)).toBeInTheDocument();
    expect(within(kuru).getByText('iptal edilirdi (kuru)')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/ansible/longjob-cancel/dry-run']);
  });

  it('P4 workflow template seçilir; PUT kind:workflow + cancelQueued taşır; yetki uyarısı gösterilir ama kayıt yapılır', async () => {
    render(<LongJobCancelPanel summary={[]} />);
    const wf = await screen.findByLabelText('workflow gece_bakim_wf');
    fireEvent.click(wf);
    fireEvent.click(screen.getByLabelText(/Kuyrukta takılı işler/));
    await waitFor(() => expect((screen.getByText('Kaydet') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Kaydet'));
    const m = await screen.findByTestId('ljc-msg');
    expect(m.textContent).toMatch(/Kaydedildi/);
    expect(m.textContent).toMatch(/EDEMEZ/);
    const put = calls.find((c) => c.method === 'PUT');
    const body = JSON.parse(put?.body || '{}');
    expect(body.cancelQueued).toBe(true);
    expect(body.templates).toContainEqual({ serverId: 1, templateId: 55, kind: 'workflow', name: 'gece_bakim_wf' });
  });

  it('P5 yapılandırma okunamadı bandı; izleyici başlatılmamışsa kırmızı bant; config alınamazsa Kaydet kapalı', async () => {
    mockFetch({
      'GET /api/ansible/longjob-cancel': () =>
        json({ ok: true, config: CFG, configError: { at: 'x', message: 'Failed to connect' }, usingLastGoodConfig: true }),
      'GET /api/ansible/longjob-cancel/status': () => json({ ...STATUS, watcher: { ...STATUS.watcher, started: false } }),
    });
    const { unmount } = render(<LongJobCancelPanel summary={[]} />);
    expect(await screen.findByText(/Yapılandırma okunamadı \(DB\): Failed to connect/)).toBeInTheDocument();
    expect(await screen.findByText(/İzleyici BAŞLATILMAMIŞ/)).toBeInTheDocument();
    unmount();

    mockFetch({ 'GET /api/ansible/longjob-cancel': () => json({ ok: false, message: 'DB yok' }, 503) });
    render(<LongJobCancelPanel summary={[]} />);
    expect(await screen.findByText(/Yapılandırma alınamadı: DB yok/)).toBeInTheDocument();
    expect((screen.getByText('Kaydet') as HTMLButtonElement).disabled).toBe(true);
  });

  it('P6 workflow seçilince alt işleri de keser uyarısı çıkar; açıklama "hiçbir zaman" demez', async () => {
    render(<LongJobCancelPanel summary={[]} />);
    const wf = await screen.findByLabelText('workflow gece_bakim_wf');
    expect(screen.queryByTestId('ljc-wf-warning')).toBeNull();
    fireEvent.click(wf);
    const uyari = await screen.findByTestId('ljc-wf-warning');
    expect(uyari.textContent).toMatch(/gece_bakim_wf/);
    expect(uyari.textContent).toMatch(/tüm alt işlerini de keser/);
    expect(document.body.textContent || '').not.toMatch(/hiçbir zaman/);
  });

  it('P7 Admin ✓ rozeti: token kapsamı ölçülemiyorsa bunu söyler; write ise söylemez', async () => {
    mockFetch({
      'GET /api/ansible/longjob-cancel/permissions': () =>
        json({
          ok: true,
          permissions: [
            { serverId: 1, templateId: 42, kind: 'job', name: 'nginx_config_audit', state: 'admin', tokenScope: 'unknown', message: 'x' },
            { serverId: 1, templateId: 43, kind: 'job', name: 'olculemeyen', state: 'admin', tokenScope: 'write', message: 'y' },
          ],
        }),
    });
    render(<LongJobCancelPanel summary={[]} />);
    const c42 = await screen.findByTestId('ljc-chip-1:job:42');
    await waitFor(() => expect(within(c42).getByText('Admin ✓')).toBeInTheDocument(), { timeout: 3000 });
    expect(within(c42).getByText('token kapsamı ölçülemedi')).toBeInTheDocument();
    const c43 = screen.getByTestId('ljc-chip-1:job:43');
    expect(within(c43).getByText('Admin ✓')).toBeInTheDocument();
    expect(within(c43).queryByText('token kapsamı ölçülemedi')).toBeNull();
  });

  it('P8 tarama sağlığı bandı; işsiz deneme satırı "#undefined" yazmaz; kendiliğinden bitti etiketi; doğrulanamayan kayıt notu', async () => {
    mockFetch({
      'GET /api/ansible/longjob-cancel/status': () =>
        json({
          ...STATUS,
          lastTick: tick({ verify: { asked: 1, measured: 0, unmeasured: 1 } }),
          scanHealth: [
            { serverId: 1, serverName: 'maestro2', kind: 'workflow', fails: 3, since: 'x', alerted: true, lastError: 'AWX HTTP 401: Invalid token.', threshold: 3 },
          ],
          open: { ...STATUS.open, scanFailing: 1 },
          attempts: [
            { at: '2026-10-03T10:05:00Z', serverName: 'maestro2', kind: 'workflow', outcome: 'scan_failed', ok: false, message: 'OTOMATİK İPTAL ÇALIŞMIYOR', teams: 'gonderildi' },
            { at: '2026-10-03T10:00:00Z', serverName: 'maestro2', kind: 'job', jobId: 650, jobName: 'nginx_config_audit', outcome: 'finished', ok: true, message: 'kendiliğinden bitti', teams: null },
          ],
        }),
    });
    render(<LongJobCancelPanel summary={[]} />);
    const band = await screen.findByTestId('ljc-scan-failing');
    expect(band.textContent).toMatch(/OTOMATİK İPTAL ÇALIŞMIYOR/);
    expect(band.textContent).toMatch(/maestro2 workflow job listesi 3 taramadır okunamıyor/);
    expect(band.textContent).toMatch(/401/);
    const den = screen.getByTestId('ljc-attempts');
    expect(den.textContent).not.toMatch(/#undefined/);
    expect(den.textContent).toMatch(/workflow job listesi/);
    expect(within(den).getByText('TARANAMIYOR — otomatik iptal çalışmıyor')).toBeInTheDocument();
    expect(within(den).getByText('kendiliğinden bitti (iptal doğrulanamadı)')).toBeInTheDocument();
    expect(den.querySelector('tr[data-problem="1"]')?.className).toMatch(/bg-red-50/);
    expect(screen.getByTestId('ljc-unverified').textContent).toMatch(/1 iptal kaydı doğrulanamadı/);
  });
});
