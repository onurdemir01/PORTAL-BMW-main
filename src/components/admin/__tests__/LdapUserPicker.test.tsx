// src/components/admin/__tests__/LdapUserPicker.test.tsx
//
// URETIM (kullanici, 2026-10-01): "LDAP'tan tum kullanicilari getiriyorsun ama ben o
// kullaniciya tikladigimda herhangi bir islem yapmiyor."
//
// Bu dosya GERCEK bileseni kosturur (arama enjekte edilir, ag yok): listeyi ac, bir
// sonuca TIKLA, `onChange` kullanici adiyla cagrildi mi?
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { LdapUserPicker, type LdapUser } from '@/components/admin/LdapUserPicker';

const KULLANICI: LdapUser = {
  username: 'osmankoz',
  displayName: 'Osman Koz',
  mail: 'osmankoz@garantibbva.com.tr',
  department: 'Middleware',
  title: null,
};

function kur(onChange = vi.fn(), users: LdapUser[] = [KULLANICI]) {
  const search = vi.fn().mockResolvedValue({ users });
  // Kontrollu bileşen: degeri testin kendisi tutar, aksi halde yazilan metin geri gelmez.
  function Sarmal() {
    const [v, setV] = useState('');
    return (
      <LdapUserPicker
        value={v}
        onChange={(u) => {
          setV(u);
          onChange(u);
        }}
        search={search}
      />
    );
  }
  return { onChange, search, ...render(<Sarmal />) };
}

describe('LdapUserPicker', () => {
  it('listeden secilen kullanici onChange ile GERI DONER (uretimdeki sikayet)', async () => {
    const { onChange, search } = kur();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'osman' } });
    // Arama 300 ms geciktirilir.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await waitFor(() => expect(search).toHaveBeenCalled());

    const secenek = await screen.findByText('Osman Koz');
    fireEvent.click(secenek);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('osmankoz'));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('osmankoz');
  });

  it('elle yazim KUCUK HARFE cevrilir (buyuk/kucuk harf sorunu)', async () => {
    const { onChange } = kur();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  OsmanKoz  ' } });
    expect(onChange).toHaveBeenCalledWith('osmankoz');
  });
});

describe('LdapUserPicker · field="mail" (Crypto Hub)', () => {
  it('E-POSTA kipinde secilen kisiden E-POSTA yazilir (kullanici adi DEGIL)', async () => {
    const onChange = vi.fn();
    const search = vi.fn().mockResolvedValue({ users: [KULLANICI] });
    function Sarmal() {
      const [v, setV] = useState('');
      return (
        <LdapUserPicker
          value={v}
          onChange={(u) => {
            setV(u);
            onChange(u);
          }}
          search={search}
          field="mail"
        />
      );
    }
    render(<Sarmal />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'osman' } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    fireEvent.click(await screen.findByText('Osman Koz'));

    // ASIL IDDIA: e-posta kuralina kullanici adi yazilirsa motor ASLA eslestiremez.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('osmankoz@garantibbva.com.tr'),
    );
    expect(onChange).not.toHaveBeenCalledWith('osmankoz');
  });

  it('e-postasi OLMAYAN kayit sessizce gecilmez (asla eslesmeyecek kural uretilmez)', async () => {
    const onChange = vi.fn();
    const search = vi
      .fn()
      .mockResolvedValue({ users: [{ ...KULLANICI, mail: '' }] });
    render(<LdapUserPicker value="" onChange={onChange} search={search} field="mail" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'osman' } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    fireEvent.click(await screen.findByText('Osman Koz'));

    expect(onChange).not.toHaveBeenCalledWith('osmankoz');
    expect(await screen.findByText(/dizinde e-posta yok/i)).toBeTruthy();
  });
});
