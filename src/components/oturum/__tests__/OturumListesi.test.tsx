// src/components/oturum/__tests__/OturumListesi.test.tsx — aktif oturumlar ekrani (Faz D).
//
//   OL1 "Bu oturum" isaretli ve KAPATILAMAZ; digerleri tek tek kapatilir, liste tazelenir
//   OL2 "Diger tum oturumlardan cik" yalnizca baska oturum varsa gorunur
//   OL3 admin modu admin uclarini kullanir; tumunu sonlandirir
//   OL4 hata anlasilir gosterilir
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OturumListesi from '../OturumListesi';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  revoke: vi.fn(),
  revokeOthers: vi.fn(),
  admin: { list: vi.fn(), revoke: vi.fn() },
}));
vi.mock('@/api/sessionsApi', () => ({ sessionsApi: api }));

const satir = (id: string, current: boolean, device = 'Chrome · Windows') => ({
  id,
  current,
  device,
  createdAt: Date.now() - 3600_000,
  lastSeenAt: Date.now() - 60_000,
  idleExpiresAt: Date.now() + 3600_000,
  absoluteExpiresAt: Date.now() + 7200_000,
  remember: false,
  ip: '127.0.0.1',
  ua: 'x',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OturumListesi', () => {
  it('OL1 bu oturum kapatilamaz; digeri kapatilir ve liste tazelenir', async () => {
    api.list
      .mockResolvedValueOnce([satir('aaaa0001', true), satir('bbbb0002', false, 'Safari · macOS')])
      .mockResolvedValueOnce([satir('aaaa0001', true)]);
    api.revoke.mockResolvedValue(1);
    render(<OturumListesi />);
    expect(await screen.findByText('Bu oturum')).toBeInTheDocument();
    const kapat = screen.getAllByRole('button', { name: 'Kapat' });
    expect(kapat).toHaveLength(1);
    fireEvent.click(kapat[0]);
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith('bbbb0002'));
    expect(await screen.findByText(/1 oturum kapatıldı/)).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Safari · macOS')).not.toBeInTheDocument();
  });

  it('OL2 toplu cikis yalnizca baska oturum varken', async () => {
    api.list.mockResolvedValueOnce([satir('aaaa0001', true)]);
    const { unmount } = render(<OturumListesi />);
    await screen.findByText('Bu oturum');
    expect(screen.queryByText(/Diğer tüm oturumlardan çık/)).not.toBeInTheDocument();
    unmount();
    api.list.mockResolvedValueOnce([satir('a', true), satir('b', false), satir('c', false)]).mockResolvedValueOnce([satir('a', true)]);
    api.revokeOthers.mockResolvedValue(2);
    render(<OturumListesi />);
    fireEvent.click(await screen.findByText('Diğer tüm oturumlardan çık (2)'));
    await waitFor(() => expect(api.revokeOthers).toHaveBeenCalledTimes(1));
  });

  it('OL3 admin modu admin uclarini kullanir', async () => {
    api.admin.list.mockResolvedValueOnce([satir('a', false), satir('b', false)]).mockResolvedValueOnce([]);
    api.admin.revoke.mockResolvedValue(2);
    render(<OturumListesi adminKullanici="ayse" />);
    fireEvent.click(await screen.findByText('Tüm oturumlarını sonlandır (2)'));
    await waitFor(() => expect(api.admin.revoke).toHaveBeenCalledWith('ayse', undefined));
    expect(api.list).not.toHaveBeenCalled();
    expect(await screen.findByText('Açık oturum yok.')).toBeInTheDocument();
  });

  it('OL4 hata gosterilir', async () => {
    api.list.mockRejectedValueOnce(new Error('Oturumlar okunamadı: x'));
    render(<OturumListesi />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Oturumlar okunamadı');
  });
});
