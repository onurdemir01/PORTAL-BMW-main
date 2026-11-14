// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SelfServicePage, { ssSlug } from '../../SelfServicePage';
import DynatracePage from '../../dynatrace/DynatracePage';
import { selfServiceApi } from '@/api/selfServiceApi';
import { ansibleApi } from '@/api/ansibleApi';
import { dynatraceApi } from '@/api/dynatraceApi';
import { instanaApi } from '@/api/instanaApi';
import { splunkApi } from '@/api/splunkApi';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { username: 'admin', role: 'Admin' },
    canViewPage: () => true,
    canSee: () => true,
  }),
}));

vi.mock('@/contexts/JobTrackerContext', () => ({
  useJobTracker: () => ({
    addJob: vi.fn(() => 'tracker-1'),
    jobs: [
      {
        id: 'tracker-1',
        title: 'Nginx RVP',
        status: 'running',
        output: 'PLAY [all] ***\n',
        minimized: false,
        done: false,
      },
    ],
  }),
}));

vi.mock('@/api/selfServiceApi', () => ({
  selfServiceApi: {
    get: vi.fn(),
  },
}));

vi.mock('@/api/ansibleApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/ansibleApi')>('@/api/ansibleApi');
  return {
    ...actual,
    ansibleApi: {
      ...actual.ansibleApi,
      ssItems: vi.fn(),
      surveySpec: vi.fn(),
      launchSs: vi.fn(),
      ssJobStatus: vi.fn(),
      smartTicketStatus: vi.fn(),
      ocoValidate: vi.fn(),
      saveSsItem: vi.fn(),
      deleteSsItem: vi.fn(),
      ssHistory: vi.fn(),
    },
  };
});

vi.mock('@/api/dynatraceApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/dynatraceApi')>('@/api/dynatraceApi');
  return {
    ...actual,
    dynatraceApi: {
      ...actual.dynatraceApi,
      health: vi.fn(),
      environments: vi.fn(),
      problems: vi.fn(),
      problemDetails: vi.fn(),
      events: vi.fn(),
      entities: vi.fn(),
      metrics: vi.fn(),
      queryMetrics: vi.fn(),
    },
  };
});

vi.mock('@/api/instanaApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/instanaApi')>('@/api/instanaApi');
  return {
    ...actual,
    instanaApi: {
      ...actual.instanaApi,
      health: vi.fn(),
      events: vi.fn(),
      applications: vi.fn(),
      services: vi.fn(),
    },
  };
});

vi.mock('@/api/splunkApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/splunkApi')>('@/api/splunkApi');
  return {
    ...actual,
    splunkApi: {
      ...actual.splunkApi,
      health: vi.fn(),
      search: vi.fn(),
    },
  };
});

describe('SelfServicePage and DynatracePage Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(selfServiceApi.get).mockResolvedValue({
      ok: true,
      groups: [
        {
          id: 'g1',
          groupKey: 'ansible',
          label: 'Ansible',
          icon: 'cmd',
          sortOrder: 1,
          isActive: true,
        },
      ],
    });
    vi.mocked(ansibleApi.ssItems).mockResolvedValue({
      ok: true,
      items: [
        {
          id: 'item-1',
          title: 'Nginx RVP Operations',
          description: 'Manage Nginx RVP configs',
          awxServerId: 1,
          awxTemplateId: 42,
          enabled: true,
          order: 1,
        },
        {
          id: 'item-2',
          title: 'Disabled Service',
          description: 'Admin only',
          awxServerId: 1,
          awxTemplateId: 43,
          enabled: false,
          order: 2,
        },
      ],
    });
    vi.mocked(ansibleApi.surveySpec).mockResolvedValue({
      ok: true,
      surveyEnabled: true,
      askVariables: false,
      gates: { oco: true, ocoEnvironments: null, smart: true },
      launchOptions: {
        limit: { enabled: true, current: '' },
        forks: { enabled: true, current: 5 },
        jobTags: { enabled: false, current: '' },
        skipTags: { enabled: false, current: '' },
        verbosity: { enabled: true, current: 0 },
        jobType: { enabled: true, current: 'run' },
      },
      fields: [
        {
          name: 'env',
          label: 'Ortam',
          type: 'multiplechoice',
          required: true,
          hidden: false,
          defaultValue: 'prod',
          choices: ['prod', 'test'],
          description: 'Target environment',
        },
        {
          name: 'port',
          label: 'Port',
          type: 'integer',
          required: true,
          hidden: false,
          defaultValue: '8080',
          choices: [],
          description: 'Listen port',
        },
        {
          name: 'tags',
          label: 'Etiketler',
          type: 'multiselect',
          required: false,
          hidden: false,
          defaultValue: '',
          choices: ['web', 'api'],
          description: 'Tags',
        },
        {
          name: 'notes',
          label: 'Notlar',
          type: 'textarea',
          required: false,
          hidden: false,
          defaultValue: '',
          choices: [],
          description: 'Extra notes',
        },
      ],
    });
  });

  it('normalizes Turkish characters in ssSlug', () => {
    expect(ssSlug('Şifreli Çağrı & İzin Yönetimi')).toBe('sifreli-cagri-izin-yonetimi');
    expect(ssSlug('   ')).toBe('servis');
  });

  it('renders SelfServicePage catalog, opens SurveyModal, validates fields, and handles OCO/launch flow', async () => {
    vi.mocked(ansibleApi.launchSs)
      .mockResolvedValueOnce({
        ok: true,
        ocoRequired: true,
        message: 'Production ortaminda OCO gerekli.',
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        jobId: 777,
        status: 'running',
      } as never);
    vi.mocked(ansibleApi.ocoValidate).mockResolvedValue({
      ok: true,
      oco: {
        ocoNumber: '22502813',
        startText: '10:00',
        endText: '12:00',
        windowStartText: '08:00',
        windowEndText: '14:00',
        equal: false,
        phase: 'inside',
        canRunNow: true,
      },
    });

    render(
      <MemoryRouter initialEntries={['/self-service']}>
        <Routes>
          <Route path="/self-service/:slug?" element={<SelfServicePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByText('Başlat').length).toBeGreaterThan(0));

    // Click Baslat on first card to open SurveyModal
    const startButtons = screen.getAllByText('Başlat');
    fireEvent.click(startButtons[0]);

    await waitFor(() => expect(screen.getByTestId('oco-prewarn')).toBeTruthy());

    // Enter non-integer float value first to trigger integer field validation
    const portInput = document.getElementById('f-port') as HTMLInputElement;
    fireEvent.change(portInput, { target: { value: '12.5' } });
    fireEvent.blur(portInput);
    expect(screen.getByText('Tam sayı girin.')).toBeTruthy();

    // Fix integer value and toggle multiselect choice
    fireEvent.change(portInput, { target: { value: '8443' } });
    fireEvent.click(screen.getByText('web'));

    // Launch -> first call returns ocoRequired -> shows OCO ask panel
    fireEvent.click(screen.getByText('İş Başlat'));

    await waitFor(() => expect(screen.getByPlaceholderText('ör. 22502813')).toBeTruthy());

    // Enter OCO number and lookup
    fireEvent.change(screen.getByPlaceholderText('ör. 22502813'), {
      target: { value: '22502813' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sorgula' }));

    await waitFor(() => expect(ansibleApi.ocoValidate).toHaveBeenCalledWith('22502813'));
  });

  it('renders DynatracePage in connected state and switches tabs (Problems, Events, Entities, Instana, Splunk)', async () => {
    vi.mocked(dynatraceApi.health).mockResolvedValue({
      ok: true,
      configured: true,
      mcpConnected: true,
      environment: 'prod',
    });
    vi.mocked(dynatraceApi.environments).mockResolvedValue({
      ok: true,
      aliases: ['prod', 'test'],
      defaultAlias: 'prod',
    });
    vi.mocked(dynatraceApi.problems).mockResolvedValue({
      ok: true,
      problems: [
        {
          problemId: 'P-101',
          displayId: 'P-101',
          title: 'High CPU on host1',
          status: 'OPEN',
          severityLevel: 'PERFORMANCE',
          impactLevel: 'INFRASTRUCTURE',
          startTime: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(dynatraceApi.problemDetails).mockResolvedValue({
      ok: true,
      text: 'Details in json:\n{"displayId":"P-101","title":"High CPU","status":"OPEN","severityLevel":"PERFORMANCE","impactLevel":"INFRASTRUCTURE","startTime":1700000000000,"endTime":-1,"affectedEntities":[{"name":"host1"}],"evidenceDetails":{"details":[{"evidenceType":"METRIC","displayName":"CPU usage","valueBeforeChangePoint":12.5,"valueAfterChangePoint":95.2,"unit":"Percent"}]}}\nhttps://dt.example.test/#problemdetails;pid=<problemId>',
    });
    vi.mocked(dynatraceApi.events).mockResolvedValue({
      ok: true,
      events: [
        {
          eventId: 'E-1',
          eventType: 'CUSTOM_INFO',
          status: 'OPEN',
          title: 'Deployment event',
          startTime: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(dynatraceApi.entities).mockResolvedValue({
      ok: true,
      entities: [
        {
          entityId: 'HOST-1',
          displayName: 'srv01.corp',
          type: 'HOST',
          tags: 'env:prod',
        },
      ],
    });
    vi.mocked(instanaApi.health).mockResolvedValue({
      ok: true,
      configured: true,
      env: 'prod',
      mcpUrl: 'https://instana-mcp.example',
    });
    vi.mocked(splunkApi.health).mockResolvedValue({
      ok: true,
      configured: false,
      reachable: false,
      message: 'Splunk not configured',
    });

    render(
      <MemoryRouter>
        <DynatracePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('High CPU on host1')).toBeTruthy());

    // Open problem detail modal
    fireEvent.click(screen.getByText('High CPU on host1'));
    await waitFor(() => expect(screen.getByText(/CPU usage: 12.5% → 95.2%/i)).toBeTruthy());

    // Switch to Events tab
    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    await waitFor(() => expect(screen.getByText('Deployment event')).toBeTruthy());

    // Switch to Instana tab
    fireEvent.click(screen.getByRole('tab', { name: 'Instana' }));
    await waitFor(() => expect(instanaApi.health).toHaveBeenCalled());

    // Switch to Splunk tab
    fireEvent.click(screen.getByRole('tab', { name: 'Splunk' }));
    await waitFor(() => expect(splunkApi.health).toHaveBeenCalled());
  });
});
