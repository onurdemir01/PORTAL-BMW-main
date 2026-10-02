// src/components/__tests__/LoginPageOturum.test.tsx — giris ekrani (Faz B).
//
//   LP1 "Beni hatirla" GERCEKTEN gonderilir (eskiden kutu vardi, hicbir sey yapmiyordu)
//   LP2 Admin kapattiysa kutu gosterilmez ve remember gonderilmez
//   LP3 donus adresi yol + sorgu + hash korur
//   LP4 cift gonderim tek giris istegi
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from '../LoginPage';
import { AuthContext } from '@/contexts/AuthContext';

function Konum() {
  const l = useLocation();
  return <p data-testid="konum">{l.pathname + l.search + l.hash}</p>;
}

function kur({ rememberEnabled = true, login = vi.fn(async () => {}), from }: any = {}) {
  window.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, rememberEnabled, rememberDays: 7 }), { status: 200 }),
  ) as unknown as typeof fetch;
  render(
    <AuthContext.Provider value={{ login } as any}>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: from ? { from } : undefined }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Konum />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return login;
}

function doldur() {
  fireEvent.change(screen.getByLabelText('Kullanıcı adı'), { target: { value: 'ayse' } });
  fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 's3cret' } });
}

describe('LoginPage oturum', () => {
  it('LP1 beni hatirla gonderilir', async () => {
    const login = kur();
    const kutu = await screen.findByLabelText('Beni hatırla (7 gün)');
    doldur();
    fireEvent.click(kutu);
    fireEvent.click(screen.getByRole('button', { name: 'Oturum aç' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('ayse', 's3cret', true));
  });

  it('LP2 Admin kapattiysa kutu yok ve remember gonderilmez', async () => {
    const login = kur({ rememberEnabled: false });
    await waitFor(() => expect(window.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText(/Beni hatırla/)).not.toBeInTheDocument();
    doldur();
    fireEvent.click(screen.getByRole('button', { name: 'Oturum aç' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('ayse', 's3cret', false));
  });

  it('LP3 donus adresi sorgu ve hash ile korunur', async () => {
    kur({ from: { pathname: '/inventory', search: '?q=abc', hash: '#satir-3' } });
    doldur();
    fireEvent.click(screen.getByRole('button', { name: 'Oturum aç' }));
    expect(await screen.findByTestId('konum')).toHaveTextContent('/inventory?q=abc#satir-3');
  });

  it('LP4 cift gonderim tek giris istegi', async () => {
    let bitir!: () => void;
    const login = kur({ login: vi.fn(() => new Promise<void>((r) => (bitir = r))) });
    doldur();
    const form = screen.getByRole('button', { name: 'Oturum aç' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(login).toHaveBeenCalledTimes(1);
    bitir();
  });
});
