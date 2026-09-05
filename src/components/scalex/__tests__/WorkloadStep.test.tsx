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
