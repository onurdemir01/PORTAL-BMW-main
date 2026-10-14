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

// ── 2026-10-14 (kullanici: "yazdigim kullanici adinin gercekten secildigini anlayamiyorum ...
// sorgu biraz gec calisiyor") ────────────────────────────────────────────────────────────────
const bekle = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe('LdapUserPicker · secim gorunur, arama durumu, sira korumasi', () => {
  it('listeden secilen kisi kutunun altinda adi ve e-postasiyla yazar; yeniden yazinca kalkar', async () => {
    kur();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'osman' } });
    await bekle(400);
    fireEvent.click(await screen.findByText('Osman Koz'));
    const kart = await screen.findByTestId('ldap-secili');
    expect(kart.textContent).toContain('Seçildi');
    expect(kart.textContent).toContain('Osman Koz');
    expect(kart.textContent).toContain('osmankoz@garantibbva.com.tr');
    expect(screen.queryByTestId('ldap-elle')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'osmankozz' } });
    expect(screen.queryByTestId('ldap-secili')).toBeNull();
  });

  it('listeden secilmeden yazilan deger "dizinde dogrulanmadi" diye soylenir', async () => {
    kur(vi.fn(), []);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'yokkisi' } });
    await bekle(400);
    expect(await screen.findByTestId('ldap-elle')).toBeTruthy();
    expect(screen.queryByTestId('ldap-secili')).toBeNull();
  });

  it('arama surerken "Dizinde araniyor" gorunur', async () => {
    let coz: (v: { users: LdapUser[] }) => void = () => {};
    const search = vi.fn(() => new Promise<{ users: LdapUser[] }>((r) => (coz = r)));
    render(<LdapUserPicker value="" onChange={() => {}} search={search} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'osman' } });
    await bekle(400);
    expect(screen.getByTestId('ldap-ariyor').textContent).toContain('aranıyor');
    await act(async () => coz({ users: [KULLANICI] }));
    expect(screen.queryByTestId('ldap-ariyor')).toBeNull();
    expect(screen.getByText('Osman Koz')).toBeTruthy();
  });

  it('gec gelen ESKI yanit yeni sonucun ustune yazmaz', async () => {
    const cozum: Record<string, (v: { users: LdapUser[] }) => void> = {};
    const search = vi.fn((q: string) => new Promise<{ users: LdapUser[] }>((r) => (cozum[q] = r)));
    function Sarmal() {
      const [v, setV] = useState('');
      return <LdapUserPicker value={v} onChange={setV} search={search} />;
    }
    render(<Sarmal />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'osm' } });
    await bekle(400);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ayse' } });
    await bekle(400);
    const AYSE: LdapUser = { ...KULLANICI, username: 'aysekaya', displayName: 'Ayşe Kaya' };
    await act(async () => cozum.ayse({ users: [AYSE] }));
    await act(async () => cozum.osm({ users: [KULLANICI] }));
    expect(screen.getByText('Ayşe Kaya')).toBeTruthy();
    expect(screen.queryByText('Osman Koz')).toBeNull();
  });
});
