// src/components/__tests__/KlavyeErisim.test.tsx
//
// KLAVYE, ERISILEBILIRLIK VE ETIKETLER (2026-10-07, gercek tarayici taramasi).
//
//   * Kullanici menusu Esc ile KAPANMIYORDU (yalnizca disari tiklaninca).
//   * Komut paleti rolsuz bir div idi; arama kutusu yalnizca placeholder ile etiketliydi.
//   * Basarisiz giristen sonra odak <body>'ye dusuyordu.
//   * 403 sayfasindaki dugmenin metni gorunmuyordu (`a { color }` kurali `text-white`i eziyor).
//   * Bazi etiketler Turkce karaktersiz yazilmisti ("Nobet listesi", "Navigasyonu ac/kapat").
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import Masthead from '@/components/layout/Masthead';
import { CommandPalette } from '@/components/common/CommandPalette';
import LoginPage from '@/components/LoginPage';
import ForbiddenPage from '@/components/ForbiddenPage';
import { titleForPath } from '@/hooks/useDocumentTitle';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, prefs: {}, rememberEnabled: true, rememberDays: 7 }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

const oturum = (ek: Record<string, unknown> = {}) =>
  ({
    user: { username: 'ayse', displayName: 'Ayşe Yılmaz', role: 'Admin' },
    logout: vi.fn(),
    canViewPage: () => true,
    ...ek,
  }) as never;

describe('Ust bant: kullanici menusu', () => {
  const ac = () =>
    render(
      <AuthContext.Provider value={oturum()}>
        <ThemeProvider>
          <MemoryRouter>
            <Masthead onToggleNav={() => {}} />
          </MemoryRouter>
        </ThemeProvider>
      </AuthContext.Provider>,
    );
  const dugme = () => screen.getByRole('button', { name: /Ayşe Yılmaz/ });

  it('KE1 Esc menuyu kapatir ve odagi dugmeye geri verir', () => {
    ac();
    fireEvent.click(dugme());
    expect(dugme().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Oturumu kapat')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Oturumu kapat')).toBeNull();
    expect(dugme().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(dugme());
  });

  it('KE2 menu kapaliyken Esc bir sey yapmaz; baska tus menuyu kapatmaz', () => {
    ac();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Oturumu kapat')).toBeNull();
    fireEvent.click(dugme());
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByText('Oturumu kapat')).toBeTruthy();
  });

  it('KE3 dugme actigi paneli tanimlar; etiketler Turkce karakterli', () => {
    ac();
    expect(dugme().getAttribute('aria-controls')).toBe('kullanici-menusu');
    expect(screen.getByRole('button', { name: 'Navigasyonu aç/kapat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /temaya geç/ })).toBeTruthy();
    fireEvent.click(dugme());
    expect(document.getElementById('kullanici-menusu')).toBeTruthy();
    expect(screen.getByText('Nöbet listesi')).toBeTruthy();
    expect(screen.getByLabelText('CSV ayırıcı')).toBeTruthy();
  });
});

describe('Komut paleti', () => {
  it('KE4 acildiginda bir iletisim kutusudur ve arama kutusu adla etiketlidir', async () => {
    render(
      <AuthContext.Provider value={oturum()}>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const kutu = await screen.findByRole('dialog', { name: 'Sayfa ara' });
    expect(kutu.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Sayfa ara' })).toBeTruthy();
  });
});

describe('Giris ekrani', () => {
  it('KE5 basarisiz giristen sonra odak SIFRE alanina doner', async () => {
    const login = vi.fn(async () => {
      throw new Error('Kullanıcı adı veya şifre hatalı.');
    });
    render(
      <AuthContext.Provider value={{ login, isAuthenticated: false } as never}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText('Kullanıcı adı'), { target: { value: 'ayse' } });
    fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'yanlis' } });
    const gonder = screen.getByRole('button', { name: 'Oturum aç' });
    gonder.focus();
    fireEvent.click(gonder);
    expect(await screen.findByText('Kullanıcı adı veya şifre hatalı.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Şifre')));
  });
});

describe('403 sayfasi', () => {
  it('KE6 donus baglantisi `btn-primary`dir; `text-white` tasimaz (a{color} onu ezerdi)', () => {
    render(
      <MemoryRouter>
        <ForbiddenPage />
      </MemoryRouter>,
    );
    const bag = screen.getByRole('link', { name: 'Dashboard’a Dön' });
    expect(bag.className).toContain('btn-primary');
    expect(bag.className).not.toMatch(/text-white|bg-blue-/);
    expect(bag.getAttribute('href')).toBe('/dashboard');
  });

  it('KE7 sekme basligi sayfayi adlandirir; bilinmeyen yol yalnizca uygulama adini alir', () => {
    expect(titleForPath('/403')).toBe('Yetkisiz Erişim · BMW Portal');
    expect(titleForPath('/boyle-bir-yol-yok')).toBe('BMW Portal');
  });
});
