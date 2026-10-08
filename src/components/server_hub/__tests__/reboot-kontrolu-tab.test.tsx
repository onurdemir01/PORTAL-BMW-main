// src/components/server_hub/__tests__/reboot-kontrolu-tab.test.tsx — RT1..RT2 (2026-10-08).
// Sekme sahte API ile render edilir: kayıt listesi, önce görüntüsü, sonra sonucu (sorunsuz / fark kaldı)
// ve onay penceresi. Onaysız "sonra" isteği GİTMEZ.
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';

const sonraMock = vi.fn(async () => ({ ok: true, jobId: 9, awxServerId: 1, hedef: ['GBJBOP18'], disarida: [] }));
const O18 = ['BOOT|b1||', 'URUN|JBOSS8||', 'URUN|RHA||', 'JVM|JBOSS8|appA|x'];
const O19 = ['BOOT|c1||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appB|x'];
const KAYIT = {
  id: 3, hosts: ['GBJBOP18', 'GBJBOAP18'], not: 'Ekim patch', durum: 'sorunlu', olusturan: 'onur', olusturuldu: '2026-10-08T10:00:00Z',
  once: { jobId: 1, serverId: 1, at: '2026-10-08T10:01:00Z', sonuc: { faz: 'once', sunucular: {
    GBJBOP18: { goruntu_ok: true, goruntu: O18 },
    GBJBOAP18: { goruntu_ok: true, goruntu: O19 },
  } } },
  sonra: { jobId: 2, serverId: 1, at: '2026-10-08T11:00:00Z', sonuc: { faz: 'sonra', sunucular: {
    GBJBOP18: { once_var: true, son_olculdu: true, son_fark: [], goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|RHA||'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|RHA||', 'JVM|JBOSS8|appA|x'], islemler: ['SONUC|baslat|JBOSS8|appA|OK|/host=primary/server-config=appA:start -> STARTED'] },
    GBJBOAP18: { once_var: true, son_olculdu: true, son_fark: ['FARK|DOWN|JVM|JBOSS8|appB|x'], goruntu: ['BOOT|c1||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|c1||', 'URUN|JBOSS8||'], islemler: ['SONUC|baslat|JBOSS8|appB|FAIL|start sonrasi durum=FAILED'] },
  } } },
  ozet: { once: { alinan: 2, toplam: 2, job: 'successful' }, sonra: { sorunsuz: 1, toplam: 2, job: 'successful', sunucu: {
    GBJBOP18: { durum: 'sorunsuz', kalan: 0, islem: 1, hatali: 0 },
    GBJBOAP18: { durum: 'sorunlu', kalan: 1, islem: 1, hatali: 1 },
  } } },
};

vi.mock('@/api/rebootCheckApi', () => ({
  rebootCheckApi: {
    list: vi.fn(async () => ({ ok: true, kayitlar: [KAYIT] })),
    get: vi.fn(async () => ({ ok: true, kayit: KAYIT })),
    once: vi.fn(),
    sonra: (...a: unknown[]) => sonraMock(...(a as [])),
  },
}));
vi.mock('@/api/serverHubApi', () => ({
  serverHubApi: { overview: vi.fn(async () => ({ ok: true, hosts: [{ host: 'GBJBOP18' }] })), jobStatus: vi.fn() },
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

import RebootKontroluTab from '../RebootKontroluTab';

describe('Reboot Kontrolü sekmesi', () => {
  it('RT1 kayıt açılır: önce ürünleri, sorunsuz/fark kaldı rozetleri, JVM satırı ve reboot doğrulaması görünür', async () => {
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    expect(await screen.findByText('2 ürün kaydedildi')).toBeTruthy();
    expect(screen.getByText('Sorunsuz')).toBeTruthy();
    expect(screen.getByText('1 fark kaldı')).toBeTruthy();
    expect(screen.getByText('1 / 2 sunucu sorunsuz')).toBeTruthy();
    expect(screen.getByText('reboot olmamış görünüyor')).toBeTruthy();
    expect(screen.getByText('çalışıyordu, hâlâ KAPALI')).toBeTruthy();
    expect(screen.getByText(/açma BAŞARISIZ/)).toBeTruthy();
  });

  it('RT2 "sonra" yalnız onay penceresinden gider', async () => {
    sonraMock.mockClear();
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    fireEvent.click(await screen.findByRole('button', { name: /Reboot sonrası kontrol et ve düzelt/ }));
    expect(sonraMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Onayla ve başlat' }));
    await waitFor(() => expect(sonraMock).toHaveBeenCalledWith(3));
  });
});
