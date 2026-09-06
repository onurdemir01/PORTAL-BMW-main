// src/components/scalex/__tests__/WorkloadStep.test.tsx
//
// Vitest + RTL tests for WorkloadStep:
//   D3 - Successful discovery, same-name-two-kind, 403 polling, package version banner
//   D4 - Accessibility: roles, aria-labels, heading hierarchy

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import WorkloadStep from '@/components/scalex/steps/WorkloadStep';
import type { ScaleXWorkload, ScaleXScope } from '@/api/scalexApi';

// ── Hoisted mocks (must be declared before vi.mock) ─────────────────────────
const mockApps = vi.hoisted(() => vi.fn());
const mockDiscover = vi.hoisted(() => vi.fn());
const mockDiscoverStatus = vi.hoisted(() => vi.fn());

vi.mock('@/api/scalexApi', () => ({
  scalexApi: {
    apps: mockApps,
    discover: mockDiscover,
    discoverStatus: mockDiscoverStatus,
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeWorkload(overrides: Partial<ScaleXWorkload> = {}): ScaleXWorkload {
  return {
    cluster: 'cluster-a',
    name: 'test-app',
    kind: 'Deployment',
    resource: 'deployments',
    specReplicas: 3,
    statusReplicas: 3,
    readyReplicas: 3,
    hasHpa: false,
    image: 'registry/test-app:v1',
    statePhase: 'Running',
    previousReplicas: null,
    restorable: false,
    gitops: null,
    source: 'discovery',
    ...overrides,
  };
}

function makeStatusResponse(workloads: ScaleXWorkload[], extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 'successful',
    finished: true,
    failed: false,
    output: '',
    result: {
      overallStatus: 'ok',
      mode: 'workloads',
      namespace: 'ns-test',
      clusters: ['cluster-a'],
      failedClusters: [],
      counts: { ok: workloads.length, warn: 0, fail: 0 },
      problems: [],
      pdbWarning: null,
      workloads,
      kindReports: [],
      ...extra,
    },
    message: undefined,
  };
}

const defaultScope: ScaleXScope = {
  env: 'dev',
  tenant: 't1',
  namespace: 'ns-test',
  clusters: ['cluster-a'],
};

const defaultProps = {
  scope: defaultScope,
  busy: false,
  onSubmit: vi.fn(),
  onBack: vi.fn(),
};

const POLL_MS = 3000;

/** Render the component and advance past the first poll cycle. */
async function renderAndPoll(ui: React.ReactElement) {
  const result = render(ui);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
  });
  return result;
}

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();

  // Clipboard mock (jsdom does not implement navigator.clipboard)
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });

  // Default: apps() is best-effort, doesn't affect the flow
  mockApps.mockResolvedValue({
    ok: false,
    items: [],
    clusters: {},
    sources: {},
    hiddenCount: 0,
  });

  // Default: discover() succeeds (launches the AWX job)
  mockDiscover.mockResolvedValue({
    ok: true,
    serverId: 1,
    templateId: 1,
    jobId: 42,
    status: 'pending',
    mode: 'workloads',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// -- Sanallastirma (150+ uygulamali namespace) --------------------------------
//
// jsdom her ogeye 0 yukseklik verir; sanallastirici o zaman HIC satir cizmez ve
// test "az satir var" diye YANLIS YERE yesile doner. Olculeri once sabitliyoruz.
function stubLayout(viewport = 600, row = 64) {
  const origRect = Element.prototype.getBoundingClientRect;
  const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const isScroller = (el: Element) =>
    typeof el.className === 'string' && el.className.includes('overflow-y-auto');

  // Sanallastirici GORUS ALANINI `offsetHeight`ten okur (getBoundingClientRect'ten
  // degil); jsdom ikisini de 0 dondurur. Yalnizca birini sabitlemek, hic satir
  // cizilmemesine ve testin bos DOM uzerinde YANLIS YERE yesile donmesine yol acar.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return isScroller(this) ? viewport : row;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });

  // `measureElement` gercek yuksekligi buradan alir.
  Element.prototype.getBoundingClientRect = function () {
    const height = isScroller(this) ? viewport : row;
    return {
      width: 800,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };

  return () => {
    Element.prototype.getBoundingClientRect = origRect;
    if (origH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origH);
    if (origW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origW);
  };
}

describe('WorkloadStep - 150+ uygulama', () => {
  it('esik ustunde listeyi sanallastirir ama SECIM tum satirlari kapsar', async () => {
    const restore = stubLayout();
    try {
      const many = Array.from({ length: 200 }, (_, i) =>
        makeWorkload({ name: `app-${String(i).padStart(3, '0')}` }),
      );
      mockDiscoverStatus.mockResolvedValue(makeStatusResponse(many));
      const onSubmit = vi.fn();
      await renderAndPoll(<WorkloadStep {...defaultProps} onSubmit={onSubmit} />);

      // 1) DOM'a 200 satir CIZILMEDI — sanallastirma gercekten devrede.
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
      expect(checkboxes.length).toBeLessThan(200);

      // 2) Ama SAYAC 200 diyor: secim DOM'dan degil, suzulmus diziden geliyor.
      expect(screen.getByText('Görünenlerin hepsini seç (200)')).toBeInTheDocument();

      // 3) Ve "hepsini sec" GERCEKTEN 200'unu birden gonderiyor. Sanallastirmanin
      //    en sinsi hatasi tam burada olurdu: yalnizca cizilmis satirlar secilir,
      //    kullanici 200 sanir, 12 uygulama olceklenir.
      fireEvent.click(screen.getByText('Görünenlerin hepsini seç (200)'));
      fireEvent.click(screen.getByText('Devam'));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0].apps).toHaveLength(200);
    } finally {
      restore();
    }
  });

  it('esik ALTINDA duz DOM korunur (sanallastirma bedava degil)', async () => {
    const restore = stubLayout();
    try {
      const few = Array.from({ length: 12 }, (_, i) => makeWorkload({ name: `app-${i}` }));
      mockDiscoverStatus.mockResolvedValue(makeStatusResponse(few));
      await renderAndPoll(<WorkloadStep {...defaultProps} />);
      // 12 satirin HEPSI cizilmis olmali — esik altinda davranis degismedi.
      expect(screen.getAllByRole('checkbox')).toHaveLength(12);
      expect(screen.getByText('app-11')).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

// ── D3: Functional tests ────────────────────────────────────────────────────

describe('WorkloadStep - discovery', () => {
  it('successful discovery renders workload list with name, kind, and replica info', async () => {
    const w1 = makeWorkload({
      name: 'app-one',
      kind: 'Deployment',
      specReplicas: 3,
      readyReplicas: 3,
      statusReplicas: 3,
      image: 'registry/app-one:v1.2',
    });
    const w2 = makeWorkload({
      name: 'app-two',
      kind: 'StatefulSet',
      specReplicas: 2,
      readyReplicas: 1,
      statusReplicas: 2,
      hasHpa: true,
      image: 'registry/app-two:v3',
    });

    mockDiscoverStatus.mockResolvedValue(makeStatusResponse([w1, w2]));

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // Workload names are visible
    expect(screen.getByText('app-one')).toBeInTheDocument();
    expect(screen.getByText('app-two')).toBeInTheDocument();

    // Kind labels
    expect(screen.getByText('Deployment')).toBeInTheDocument();
    expect(screen.getByText('StatefulSet')).toBeInTheDocument();

    // Replica info — text is split across nodes by JSX interpolation,
    // so use regex to match the parent span's full textContent
    expect(screen.getByText(/replica 3.*hazır 3\/3/)).toBeInTheDocument();
    expect(screen.getByText(/replica 2.*hazır 1\/2/)).toBeInTheDocument();

    // HPA label for app-two
    expect(screen.getByText('HPA var')).toBeInTheDocument();

    // Search input is present
    expect(screen.getByLabelText('Uygulama ara')).toBeInTheDocument();

    // "Devam" button exists but is disabled (nothing selected)
    const devamBtn = screen.getByText('Devam');
    expect(devamBtn).toBeDisabled();
  });

  it('same-name-different-kind in the same cluster renders one row and shows the kind summary', async () => {
    const w1 = makeWorkload({
      name: 'my-app',
      kind: 'Deployment',
      cluster: 'cluster-a',
      specReplicas: 3,
      readyReplicas: 3,
      statusReplicas: 3,
    });
    const w2 = makeWorkload({
      name: 'my-app',
      kind: 'DeploymentConfig',
      cluster: 'cluster-a',
      specReplicas: 1,
      readyReplicas: 1,
      statusReplicas: 1,
    });

    mockDiscoverStatus.mockResolvedValue(makeStatusResponse([w1, w2]));

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // A single row represents the shared app name.
    expect(screen.getAllByText('my-app')).toHaveLength(1);

    // Both kinds are summarized on the single row.
    expect(screen.getByText('Deployment / DeploymentConfig')).toBeInTheDocument();
    expect(screen.getByText('cluster’a göre değişir')).toBeInTheDocument();

    // One checkbox, initially unchecked and enabled.
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toBeDisabled();
  });

  it('same-name-different-kind across clusters selects once and sends per-cluster workload kinds', async () => {
    const w1 = makeWorkload({
      name: 'my-app',
      kind: 'Deployment',
      cluster: 'cluster-a',
    });
    const w2 = makeWorkload({
      name: 'my-app',
      kind: 'StatefulSet',
      cluster: 'cluster-b',
    });
    const crossScope: ScaleXScope = {
      ...defaultScope,
      clusters: ['cluster-a', 'cluster-b'],
    };

    mockDiscoverStatus.mockResolvedValue(
      makeStatusResponse([w1, w2], { clusters: ['cluster-a', 'cluster-b'] }),
    );

    await renderAndPoll(<WorkloadStep {...defaultProps} scope={crossScope} />);

    // One row for the shared name, with a cross-cluster kind summary.
    expect(screen.getAllByText('my-app')).toHaveLength(1);
    expect(screen.getByText('Deployment / StatefulSet')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkbox);
    });

    const devamBtn = screen.getByText('Devam');
    await act(async () => {
      fireEvent.click(devamBtn);
    });

    expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);
    const args = defaultProps.onSubmit.mock.calls[0][0];
    expect(args.apps).toEqual(['my-app']);
    expect(args.selectedKeys).toEqual(['my-app']);
    expect(args.clusterWorkloadKinds).toHaveLength(2);
    expect(args.clusterWorkloadKinds).toContainEqual({
      cluster: 'cluster-a',
      name: 'my-app',
      kind: 'Deployment',
    });
    expect(args.clusterWorkloadKinds).toContainEqual({
      cluster: 'cluster-b',
      name: 'my-app',
      kind: 'StatefulSet',
    });
  });

  // ── 150 UYGULAMALIK LISTE: DAVRANIS TESTLERI ──────────────────────────────
  // Kaynak tarayan bekciler (scalex-ui-validation L1-L6) kurallarin KODDA durdugunu
  // dogruluyor; buradakiler gercekten CALISTIGINI dogrular.

  it('quick filter narrows the list and the chip shows how many remain', async () => {
    const running = makeWorkload({ name: 'calisan-app', specReplicas: 2 });
    const zero = makeWorkload({
      name: 'sifir-app',
      specReplicas: 0,
      readyReplicas: 0,
      statusReplicas: 0,
    });
    mockDiscoverStatus.mockResolvedValue(makeStatusResponse([running, zero]));

    await renderAndPoll(<WorkloadStep {...defaultProps} />);
    expect(screen.getByText('calisan-app')).toBeInTheDocument();
    expect(screen.getByText('sifir-app')).toBeInTheDocument();

    // Cip sayaci: yalnizca BIR uygulama replica 0.
    const chip = screen.getByRole('button', { name: /replica 0 \(1\)/ });
    await act(async () => {
      fireEvent.click(chip);
    });

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('sifir-app')).toBeInTheDocument();
    expect(screen.queryByText('calisan-app')).not.toBeInTheDocument();
  });

  it('select-all only picks visible rows, never hidden or unscalable ones', async () => {
    const a = makeWorkload({ name: 'app-a' });
    const b = makeWorkload({ name: 'app-b' });
    const ds = makeWorkload({ name: 'log-agent', kind: 'DaemonSet', scalable: false });
    mockDiscoverStatus.mockResolvedValue(makeStatusResponse([a, b, ds]));

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // Aramayla daralt: yalnizca app-a gorunur kalsin.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Uygulama ara'), { target: { value: 'app-a' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Görünenlerin hepsini seç \(1\)/ }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Devam'));
    });

    // Gizli satirlar SECILMEZ: patlama yaricapi kullanicinin GORMEDIGI kadar buyuyemez.
    expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSubmit.mock.calls[0][0].apps).toEqual(['app-a']);
  });

  it('grouping is off by default and shows section headers once enabled', async () => {
    const running = makeWorkload({ name: 'calisan-app', specReplicas: 2 });
    const zero = makeWorkload({
      name: 'sifir-app',
      specReplicas: 0,
      readyReplicas: 0,
      statusReplicas: 0,
    });
    mockDiscoverStatus.mockResolvedValue(makeStatusResponse([running, zero]));

    await renderAndPoll(<WorkloadStep {...defaultProps} />);
    // VARSAYILAN KAPALI: grup basligi yok, bugunku duz liste.
    expect(screen.queryByText('Replica 0 (1)')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Listeyi grupla'), { target: { value: 'status' } });
    });
    expect(screen.getByText('Replica 0 (1)')).toBeInTheDocument();
    expect(screen.getByText('Çalışıyor (1)')).toBeInTheDocument();
  });

  it('an app scalable in one cluster stays selectable even if unscalable in another', async () => {
    // Temsilci satira bakmak, satir sirasina gore KEYFI bir kilit uretirdi.
    //
    // BU DAVRANIS IKI MEKANIZMAYLA BIRDEN saglaniyor (bilincli yedeklilik):
    //   1) temsilci satir olceklenebilir olani TERCIH eder,
    //   2) `isLockedName` ad duzeyinde "HICBIR cluster'da olceklenemiyor" sorar.
    // Mutasyonla dogrulandi: ikisinden BIRI geri alindiginda test yesil kalir,
    // IKISI BIRDEN geri alindiginda kirmizi doner. Yani bu test bir uygulamayi
    // degil DAVRANISI kilitliyor; kaynak duzeyindeki karsiligi Y3 bekcisidir.
    const unscalable = makeWorkload({
      name: 'karma-app',
      cluster: 'cluster-a',
      kind: 'DaemonSet',
      scalable: false,
    });
    const scalable = makeWorkload({ name: 'karma-app', cluster: 'cluster-b', kind: 'Deployment' });
    mockDiscoverStatus.mockResolvedValue(
      makeStatusResponse([unscalable, scalable], { clusters: ['cluster-a', 'cluster-b'] }),
    );

    await renderAndPoll(
      <WorkloadStep
        {...defaultProps}
        scope={{ ...defaultScope, clusters: ['cluster-a', 'cluster-b'] }}
      />,
    );
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
  });

  it('403 polling stops immediately without waiting for MAX_POLL_ERRORS', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    mockDiscoverStatus.mockRejectedValue(err);

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // The error phase is reached after a SINGLE poll iteration, not after
    // MAX_POLL_ERRORS (5) iterations. The error message is the 403-specific one.
    expect(
      screen.getByText('Bu keşif için yetkiniz yok — yöneticinize başvurun.'),
    ).toBeInTheDocument();

    // discoverStatus was called exactly once (not retried)
    expect(mockDiscoverStatus).toHaveBeenCalledTimes(1);

    // Error div has role="alert" for accessibility
    const alertDiv = screen.getByRole('alert');
    expect(alertDiv).toBeInTheDocument();
  });

  it('package version mismatch shows warning banner with monospace versions and copy button', async () => {
    const workloads = [makeWorkload({ name: 'some-app' })];
    mockDiscoverStatus.mockResolvedValue(
      makeStatusResponse(workloads, {
        packageVersion: '2',
        expectedPackageVersion: '3',
      }),
    );

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // The banner text mentions the running and expected versions
    expect(screen.getByText(/2 numaralı paket/)).toBeInTheDocument();

    // Monospace version display: "running: 2 → expected: 3"
    // The <code> element uses &nbsp; for spaces around the colon
    const versionCode = screen.getByText(/running:\s*2/);
    expect(versionCode).toBeInTheDocument();
    expect(versionCode.tagName).toBe('CODE');
    expect(versionCode).toHaveTextContent('expected:');
    expect(versionCode).toHaveTextContent('3');

    // Copy button is present
    const copyBtn = screen.getByTestId('pkg-copy-btn');
    expect(copyBtn).toHaveTextContent('Komutu kopyala');

    // Clicking the copy button calls clipboard.writeText with the AWX command
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'cp -r server/ansible/scalex_file/scalex_app/ <AWX_PROJECT_DIR>/',
    );
  });
});

// ── D4: Accessibility tests ─────────────────────────────────────────────────

describe('WorkloadStep - accessibility', () => {
  it('workload checkboxes have proper role attributes', async () => {
    const workloads = [
      makeWorkload({ name: 'alpha-app', kind: 'Deployment' }),
      makeWorkload({ name: 'beta-app', kind: 'StatefulSet' }),
    ];
    mockDiscoverStatus.mockResolvedValue(makeStatusResponse(workloads));

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // Each workload row has a checkbox with implicit role="checkbox"
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  it('search input has aria-label', async () => {
    const workloads = [makeWorkload({ name: 'some-app' })];
    mockDiscoverStatus.mockResolvedValue(makeStatusResponse(workloads));

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    const searchInput = screen.getByLabelText('Uygulama ara');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('aria-label', 'Uygulama ara');
  });

  it("error alerts use role='alert'", async () => {
    // Trigger a generic error (discover fails)
    mockDiscover.mockResolvedValue({
      ok: false,
      serverId: 0,
      templateId: 0,
      jobId: 0,
      status: 'error',
      mode: 'workloads',
      message: 'Test hatası: keşif başlatılamadı',
    });

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // The error div should have role="alert"
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Test hatası: keşif başlatılamadı');
  });

  it("package version warning banner has role='alert'", async () => {
    const workloads = [makeWorkload({ name: 'some-app' })];
    mockDiscoverStatus.mockResolvedValue(
      makeStatusResponse(workloads, {
        packageVersion: '1',
        expectedPackageVersion: '5',
      }),
    );

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // The banner should have role="alert"
    const alerts = screen.getAllByRole('alert');
    const versionAlert = alerts.find((el) => el.textContent?.includes('running'));
    expect(versionAlert).toBeDefined();
  });

  it('component does not render h1 elements (heading hierarchy)', async () => {
    const workloads = [makeWorkload({ name: 'some-app' })];
    mockDiscoverStatus.mockResolvedValue(makeStatusResponse(workloads));

    const { container } = await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // WorkloadStep should not render any <h1> to avoid breaking heading hierarchy
    const h1Elements = container.querySelectorAll('h1');
    expect(h1Elements).toHaveLength(0);

    // Also check for h2 — the component shouldn't impose heading levels
    const h2Elements = container.querySelectorAll('h2');
    expect(h2Elements).toHaveLength(0);
  });

  it("all-clusters-failed alert has role='alert'", async () => {
    mockDiscoverStatus.mockResolvedValue(
      makeStatusResponse([], {
        failedClusters: ['cluster-a'],
        overallStatus: 'error',
      }),
    );

    await renderAndPoll(<WorkloadStep {...defaultProps} />);

    // When all clusters fail, the "hiçbiri taranamadı" alert should have role="alert"
    const alerts = screen.getAllByRole('alert');
    const clusterAlert = alerts.find((el) => el.textContent?.includes('hiçbiri'));
    expect(clusterAlert).toBeDefined();
  });
});
