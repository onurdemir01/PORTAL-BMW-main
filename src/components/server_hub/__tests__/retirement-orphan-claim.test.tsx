// Retirement gecis claim'i var ama job kimligi yoksa is "calisiyor" diye sunulamaz.
import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { RtTarget } from '@/api/retirementApi';
import RetirementCanli from '../RetirementCanli';

const hedef = (
  status: RtTarget['status'],
  jobs: Partial<Pick<RtTarget, 'lastJobId' | 'deleteJobId' | 'rollbackJobId'>> = {},
): RtTarget => ({
  id: 7,
  recordId: 3,
  host: 'GBJBOP01',
  site: 'Pendik',
  env: 'PROD',
  appName: 'CRM',
  gen: 7,
  appPath: '/hysdeploy/CRM.ear',
  web: [],
  status,
  planText: null,
  resultText: null,
  lastJobId: null,
  deleteJobId: null,
  rollbackJobId: null,
  stoppedAt: null,
  updatedAt: '2026-10-10T10:00:00Z',
  deletedAt: null,
  rolledBackAt: null,
  scheduledAt: null,
  windowEnd: null,
  webSonuc: null,
  detail: null,
  ...jobs,
});

describe('Retirement orphan claim gorunurlugu', () => {
  test('RO1 DELETE claim var ama job ID yoksa calisiyor denmez; belirsizlik aciklanir', () => {
    render(<RetirementCanli targets={[hedef('deleting')]} />);
    expect(screen.getByRole('alert').textContent).toMatch(/başlangıç sonucu doğrulanamıyor/i);
    expect(screen.queryByText(/Silme.*çalışıyor/)).toBeNull();
  });

  test('RO2 DELETE job ID varsa gercek is numarasiyla calisiyor gosterilir', () => {
    render(<RetirementCanli targets={[hedef('deleting', { deleteJobId: 77 })]} />);
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'SPAN' && /Silme.*çalışıyor.*iş #77/.test(el.textContent || ''),
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('RO3 STOP claim var ama job ID yoksa ayni fail-closed uyari kullanilir', () => {
    render(<RetirementCanli targets={[hedef('stopping')]} />);
    expect(screen.getByRole('alert').textContent).toMatch(/otomatik yeniden başlatılmaz/i);
    expect(screen.queryByText(/JBoss STOP.*çalışıyor/)).toBeNull();
  });
});
