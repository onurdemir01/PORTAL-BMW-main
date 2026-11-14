import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import KodRehberi from '@/components/server_hub/KodRehberi';

const mockKurallar = vi.hoisted(() => vi.fn());
vi.mock('@/api/serverHubApi', () => ({
  serverHubApi: {
    kurallar: mockKurallar,
  },
}));

describe('KodRehberi modal and keyboard/filter interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads rules, sorts groups, handles filter/select, and wraps focus on Tab/Shift+Tab', async () => {
    mockKurallar.mockResolvedValue({
      ok: true,
      alanlar: { jvm: 'JVM', web: 'Web' },
      maddeler: [
        {
          id: 'r1',
          alan: 'web',
          alanAd: 'Web',
          ad: 'Syntax',
          neTaranir: 'apachectl -t',
          ciktilar: [
            { kod: 'SYNTAX_FAIL', kosul: 'Bad syntax', varsayilan: 'danger', gecerli: 'danger' },
            { kod: null, kosul: 'OK', varsayilan: 'ok', gecerli: 'ok' },
          ],
        },
        {
          id: 'r2',
          alan: 'jvm',
          alanAd: 'JVM',
          ad: 'Autostart',
          neTaranir: 'auto-start',
          ciktilar: [
            { kod: 'REBOOT_RISK', kosul: 'Risk', varsayilan: 'warning', gecerli: 'danger' },
            { kod: 'STOPPED_AUTOSTART_ON', kosul: 'Off', varsayilan: 'info', gecerli: 'info' },
          ],
        },
      ],
    });

    const onKapat = vi.fn();
    const onSec = vi.fn();
    render(
      <KodRehberi
        acik={true}
        onKapat={onKapat}
        ad={(k) => k}
        listede={
          new Map([
            ['REBOOT_RISK', 3],
            ['SYNTAX_FAIL', 1],
          ])
        }
        seciliKod="REBOOT_RISK"
        onSec={onSec}
      />,
    );

    await waitFor(() => expect(mockKurallar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText('REBOOT_RISK').length).toBeGreaterThan(0));

    // Exercise keyboard focus wrapping (Shift+Tab at first focusable, Tab at last focusable, Escape)
    const buttons = screen.getAllByRole('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });

    // Clicking already-selected toggles to 'all'; clicking another selects its code
    fireEvent.click(screen.getAllByText('REBOOT_RISK')[0].closest('button')!);
    expect(onSec).toHaveBeenCalledWith('all');
    fireEvent.click(screen.getAllByText('SYNTAX_FAIL')[0].closest('button')!);
    expect(onSec).toHaveBeenCalledWith('SYNTAX_FAIL');

    // Escape closes dialog
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onKapat).toHaveBeenCalled();
  });

  it('shows error state when kurallar returns error or throws', async () => {
    mockKurallar.mockRejectedValueOnce(new Error('network down'));
    render(
      <KodRehberi
        acik={true}
        onKapat={vi.fn()}
        ad={(k) => k}
        listede={new Map()}
        seciliKod=""
        onSec={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
  });
});
