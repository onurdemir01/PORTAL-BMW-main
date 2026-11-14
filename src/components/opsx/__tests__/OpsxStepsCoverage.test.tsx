// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { opsxApi } from '@/api/opsxApi';
import LegacyJvmSelectStep from '../steps/LegacyJvmSelectStep';
import ServerConfigSelectStep from '../steps/ServerConfigSelectStep';
import OperationStep from '../steps/OperationStep';
import OcpClusterPickStep from '../steps/OcpClusterPickStep';

vi.mock('@/api/opsxApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/opsxApi')>('@/api/opsxApi');
  return {
    ...actual,
    opsxApi: {
      ...actual.opsxApi,
      discoverLegacyJvms: vi.fn(),
      legacyJvmStatus: vi.fn(),
      discoverLegacyServerConfigs: vi.fn(),
      legacyServerConfigStatus: vi.fn(),
      getOperations: vi.fn(),
      getHosts: vi.fn(),
      getClusters: vi.fn(),
    },
  };
});

describe('OpsX Steps Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('LegacyJvmSelectStep', () => {
    it('shows error when discoverLegacyJvms fails and retries on button click', async () => {
      vi.mocked(opsxApi.discoverLegacyJvms)
        .mockResolvedValueOnce({
          ok: false,
          jobId: null,
          status: null,
          awxServerId: 1,
          message: 'Discovery error',
        })
        .mockResolvedValueOnce({ ok: true, jobId: 10, status: 'pending', awxServerId: 1 });
      vi.mocked(opsxApi.legacyJvmStatus).mockResolvedValue({
        ok: true,
        status: 'successful',
        jvms: [],
      });

      const onSubmit = vi.fn();
      render(
        <LegacyJvmSelectStep
          application="app1"
          hosts={['HOST1']}
          hostMajors={['7']}
          busy={false}
          onSubmit={onSubmit}
        />,
      );

      await waitFor(() => expect(screen.getByText('Discovery error')).toBeTruthy());
      fireEvent.click(screen.getByText('Tekrar dene'));
      await waitFor(() =>
        expect(screen.getByText(/adına çalışan bir JVM bulunamadı/i)).toBeTruthy(),
      );
    });

    it('renders JVMs, handles preselection, unknown jbossMajor, toggle, and submit', async () => {
      vi.mocked(opsxApi.discoverLegacyJvms).mockResolvedValue({
        ok: true,
        jobId: 11,
        status: 'running',
        awxServerId: 1,
      });
      vi.mocked(opsxApi.legacyJvmStatus).mockResolvedValue({
        ok: true,
        status: 'successful',
        jvms: [
          { host: 'HOST1', pid: '1001', cmd: '/usr/jboss/bin/java app1', jbossMajor: '7' },
          { host: 'HOST2', pid: '2001', cmd: '/usr/jboss8/bin/java app1-a', jbossMajor: '8' },
          { host: 'HOST2', pid: '2002', cmd: '/opt/custom/java app1-b', jbossMajor: '' },
        ],
      });

      const onSubmit = vi.fn();
      render(
        <LegacyJvmSelectStep
          application="app1"
          hosts={['HOST1', 'HOST2', 'HOST3']}
          hostMajors={['7', '8']}
          busy={false}
          onSubmit={onSubmit}
        />,
      );

      // HOST1 has 1 known JVM -> preselected; HOST3 has no matching JVM -> warning shown
      await waitFor(() => expect(screen.getByText('PID 1001')).toBeTruthy());
      expect(screen.getByText(/HOST3/)).toBeTruthy();
      expect(screen.getByText('Sürüm belirlenemedi')).toBeTruthy();
      expect(screen.getByText('1 JVM seçildi')).toBeTruthy();

      // Toggle HOST2:2001 on, then submit both HOST1:1001 and HOST2:2001
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[1]);
      expect(screen.getByText('2 JVM seçildi')).toBeTruthy();

      fireEvent.click(screen.getByText('Dump Al'));
      expect(onSubmit).toHaveBeenCalledWith({
        pidMap: {
          HOST1: [{ pid: '1001', jbossMajor: '7' }],
          HOST2: [{ pid: '2001', jbossMajor: '8' }],
        },
      });
    });
  });

  describe('ServerConfigSelectStep', () => {
    it('handles error state and empty configs state', async () => {
      vi.mocked(opsxApi.discoverLegacyServerConfigs)
        .mockRejectedValueOnce(new Error('Network fail'))
        .mockResolvedValueOnce({ ok: true, jobId: 20, status: 'pending', awxServerId: 1 });
      vi.mocked(opsxApi.legacyServerConfigStatus).mockResolvedValue({
        ok: true,
        status: 'successful',
        serverConfigs: [],
      });

      render(
        <ServerConfigSelectStep
          application="app1"
          hosts={['HOST1']}
          operation="restart"
          busy={false}
          onSubmit={vi.fn()}
        />,
      );

      await waitFor(() => expect(screen.getByText('Network fail')).toBeTruthy());
      fireEvent.click(screen.getByText('Tekrar dene'));
      await waitFor(() =>
        expect(screen.getByText(/adına uyan bir JVM \(server-config\) bulunamadı/i)).toBeTruthy(),
      );
    });

    it('filters eligible configs by operation (stop vs start vs restart) and submits serverConfigMap', async () => {
      vi.mocked(opsxApi.discoverLegacyServerConfigs).mockResolvedValue({
        ok: true,
        jobId: 21,
        status: 'pending',
        awxServerId: 1,
      });
      vi.mocked(opsxApi.legacyServerConfigStatus).mockResolvedValue({
        ok: true,
        status: 'successful',
        serverConfigs: [
          { host: 'HOST1', serverConfig: 'app1-srv1', status: 'running', jbossMajor: '7' },
          { host: 'HOST2', serverConfig: 'app1-srv2', status: 'running', jbossMajor: '8' },
          { host: 'HOST2', serverConfig: 'app1-srv3', status: 'stopped', jbossMajor: '8' },
        ],
      });

      const onSubmit = vi.fn();
      render(
        <ServerConfigSelectStep
          application="app1"
          hosts={['HOST1', 'HOST2', 'HOST_MISSING']}
          hostMajors={['7', '8']}
          operation="stop"
          busy={false}
          onSubmit={onSubmit}
        />,
      );

      await waitFor(() => expect(screen.getByText('app1-srv1')).toBeTruthy());
      expect(screen.getByText(/HOST_MISSING/)).toBeTruthy();
      expect(screen.getByText('zaten durmuş')).toBeTruthy();

      fireEvent.click(screen.getByText('Tümünü Seç'));
      expect(screen.getByText('2 JVM seçildi')).toBeTruthy();

      fireEvent.click(screen.getByText('Temizle'));
      expect(screen.getByText('0 JVM seçildi')).toBeTruthy();

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(screen.getByText('Durdur'));
      expect(onSubmit).toHaveBeenCalledWith({
        serverConfigMap: {
          HOST1: [{ name: 'app1-srv1', jbossMajor: '7' }],
        },
      });
    });
  });

  describe('OperationStep', () => {
    it('loads operations and host statuses, renders badges, and invokes onSelect', async () => {
      vi.mocked(opsxApi.getOperations).mockResolvedValue({
        ok: true,
        operations: [
          { key: 'restart', label: 'Restart' },
          { key: 'stop', label: 'Stop' },
          { key: 'start', label: 'Start' },
          { key: 'threaddump', label: 'Thread Dump' },
        ],
      });
      vi.mocked(opsxApi.getHosts).mockResolvedValue({
        ok: true,
        hosts: [
          { host: 'H1', env: 'Prod', jbossVersion: '7.4', status: 'running' },
          { host: 'H2', env: 'Prod', jbossVersion: '7.4', status: 'running' },
        ],
      });

      const onSelect = vi.fn();
      render(
        <OperationStep
          summary={<span>Uygulama: app1</span>}
          application="app1"
          hosts={['H1', 'H2']}
          busy={false}
          onSelect={onSelect}
        />,
      );

      await waitFor(() => expect(screen.getAllByText('ÇALIŞIYOR').length).toBe(2));

      fireEvent.click(screen.getByText('Restart'));
      expect(onSelect).toHaveBeenCalledWith('restart');
    });

    it('handles statusError and retry button when getHosts fails', async () => {
      vi.mocked(opsxApi.getOperations).mockResolvedValue({
        ok: true,
        operations: [{ key: 'restart', label: 'Restart' }],
      });
      vi.mocked(opsxApi.getHosts)
        .mockRejectedValueOnce(new Error('Host status failed'))
        .mockResolvedValueOnce({
          ok: true,
          hosts: [{ host: 'H1', env: 'Test', jbossVersion: '7', status: 'running' }],
        });

      render(
        <OperationStep
          summary={<span>Uygulama: app1</span>}
          application="app1"
          hosts={['H1']}
          busy={false}
          onSelect={vi.fn()}
        />,
      );

      await waitFor(() => expect(screen.getByText('Host status failed')).toBeTruthy());
      expect(screen.getByText('BİLİNMİYOR')).toBeTruthy();
      fireEvent.click(screen.getByText('Tekrar dene'));
      await waitFor(() => expect(screen.getByText('ÇALIŞIYOR')).toBeTruthy());
    });
  });

  describe('OcpClusterPickStep', () => {
    it('renders multiple clusters, allows selecting ALL or single cluster, and submits', async () => {
      vi.mocked(opsxApi.getClusters).mockResolvedValue({
        ok: true,
        tree: {
          prod: {
            t1: ['ocp-prod-1', 'ocp-prod-2'],
          },
        },
      });

      const onSubmit = vi.fn();
      render(
        <OcpClusterPickStep
          env="prod"
          tenant="t1"
          busy={false}
          initialCluster="ocp-prod-2"
          onSubmit={onSubmit}
        />,
      );

      await waitFor(() => expect(screen.getByText('ocp-prod-1')).toBeTruthy());
      fireEvent.click(screen.getByText('Devam Et'));
      expect(onSubmit).toHaveBeenCalledWith('ocp-prod-2');

      // Select ALL clusters
      fireEvent.click(screen.getByText(/Tüm cluster'lar/i));
      expect(screen.getByText(/TÜM cluster'larında/i)).toBeTruthy();
      fireEvent.click(screen.getByText('Devam Et'));
      expect(onSubmit).toHaveBeenCalledWith('');
    });

    it('handles single cluster preselection and empty cluster warning', async () => {
      vi.mocked(opsxApi.getClusters).mockResolvedValueOnce({
        ok: true,
        tree: { test: { t1: ['ocp-test-only'] } },
      });

      const onSubmit = vi.fn();
      const { unmount } = render(
        <OcpClusterPickStep env="test" tenant="t1" busy={false} onSubmit={onSubmit} />,
      );

      await waitFor(() => expect(screen.getByText('ocp-test-only')).toBeTruthy());
      fireEvent.click(screen.getByText('Devam Et'));
      expect(onSubmit).toHaveBeenCalledWith('ocp-test-only');
      unmount();

      vi.mocked(opsxApi.getClusters).mockResolvedValueOnce({
        ok: true,
        tree: {},
      });
      render(<OcpClusterPickStep env="test" tenant="missing" busy={false} onSubmit={onSubmit} />);
      await waitFor(() =>
        expect(screen.getByText(/envanterde tanımlı gerçek cluster bulunamadı/i)).toBeTruthy(),
      );
    });
  });
});
