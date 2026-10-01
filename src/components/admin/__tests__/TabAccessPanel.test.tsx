// src/components/admin/__tests__/TabAccessPanel.test.tsx
//
// URETIM (kullanici, 2026-10-01): "admin merkezinde kripto app erisimine LDAP'tan tum
// kullanicilari getiriyorsun ama ben o kullaniciya tikladigimda herhangi bir islem
// yapmiyor. Yani sectigim kisiye islemiyor."
//
// Panel Denetim ve Nginx'te de kullaniliyor; Crypto Hub'da FARKLI olan tek sey
// `principalTypes={['email','user','group']}` (2026-10-01'de eklendi). Bu dosya secimin
// GERCEKTEN alana islediğini DAVRANIS olarak olcer - kaynak taramasi degil.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { TabAccessPanel } from '@/components/admin/tabs/TabAccessPanel';

const mockSet = vi.hoisted(() => vi.fn());
const mockList = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());

vi.mock('@/components/admin/LdapUserPicker', async () => {
  const React = await import('react');
  return {
    // GERCEK bilesenin sozlesmesi: `value` + `onChange(username)`. Sahte surum, listeden
    // secmeyi tek bir dugmeyle temsil eder.
    LdapUserPicker: ({
      value,
      onChange,
      className,
    }: {
      value: string;
      onChange: (u: string) => void;
      className?: string;
    }) =>
      React.createElement(React.Fragment, null, [
        React.createElement('input', {
          key: 'i',
          'data-testid': 'ldap-input',
          value,
          className,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        }),
        React.createElement(
          'button',
          { key: 'b', type: 'button', onClick: () => onChange('osmankoz') },
          'osmankoz secenegi',
        ),
      ]),
    default: () => null,
    ldapUserSearch: vi.fn(),
  };
});

const api = { list: mockList, set: mockSet, remove: mockRemove };

function kur(principalTypes?: ('user' | 'group' | 'email')[]) {
  return render(
    <TabAccessPanel
      api={api}
      labels={{ metaco: 'Metaco', wyden: 'Wyden' }}
      title="Crypto Hub uygulama erişimi"
      intro={<span>intro</span>}
      emptyText="yok"
      subject="Crypto Hub"
      principalTypes={principalTypes}
    />,
  );
}

beforeEach(() => {
  mockSet.mockReset().mockResolvedValue(undefined);
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockList.mockReset().mockResolvedValue({ tabs: ['metaco', 'wyden'], grants: [] });
});

describe('TabAccessPanel', () => {
  it('LDAP listesinden secilen kullanici ALANA islenir ve KAYDA gider', async () => {
    kur(['email', 'user', 'group']);
    await screen.findByText('Crypto Hub uygulama erişimi');

    // Crypto Hub'da varsayilan e-posta; kullanici "Kullanıcı"ya gecer.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user' } });
    fireEvent.click(screen.getByText('osmankoz secenegi'));

    // ASIL IDDIA: secim alana islendi.
    await waitFor(() =>
      expect((screen.getByTestId('ldap-input') as HTMLInputElement).value).toBe('osmankoz'),
    );

    fireEvent.click(screen.getByLabelText('Metaco'));
    fireEvent.click(screen.getByRole('button', { name: /Kaydet/i }));

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1));
    expect(mockSet.mock.calls[0][0]).toMatchObject({
      principalType: 'user',
      principalId: 'osmankoz',
      tabs: ['metaco'],
    });
  });

  it('varsayilan principal listenin ILKI (Crypto Hub e-postayla acilir)', async () => {
    kur(['email', 'user', 'group']);
    await screen.findByText('Crypto Hub uygulama erişimi');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('email');
  });

  it('principalTypes verilmezse eski davranis: kullanici + grup', async () => {
    kur();
    await screen.findByText('Crypto Hub uygulama erişimi');
    const sec = screen.getByRole('combobox') as HTMLSelectElement;
    expect(sec.value).toBe('user');
    expect([...sec.options].map((o) => o.value)).toEqual(['user', 'group']);
  });
});
