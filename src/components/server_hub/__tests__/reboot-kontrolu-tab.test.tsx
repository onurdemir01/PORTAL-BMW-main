// src/components/server_hub/__tests__/reboot-kontrolu-tab.test.tsx — RT1..RT2 (2026-10-08).
// Sekme sahte API ile render edilir: kayıt listesi, önce görüntüsü, sonra sonucu (sorunsuz / fark kaldı)
// ve onay penceresi. Onaysız "sonra" isteği GİTMEZ.
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';

const sonraMock = vi.fn(async () => ({ ok: true, jobId: 9, awxServerId: 1, hedef: ['GBJBOP18'], disarida: [] }));
const KAYIT = {
  id: 3, hosts: ['GBJBOP18', 'GBJBOAP18'], not: 'Ekim patch', durum: 'sorunlu', olusturan: 'onur', olusturuldu: '2026-10-08T10:00:00Z',
  once: { jobId: 1, serverId: 1, at: '2026-10-08T10:01:00Z', sonuc: { faz: 'once', sunucular: {
    GBJBOP18: { goruntu_ok: true, goruntu: ['JBOSS8_JVM|appA|1|1|was|d', 'WEB_APACHE|REDHAT_APACHE_HTTPD|4|2|www|d'] },
    GBJBOAP18: { goruntu_ok: true, goruntu: ['JBOSS8_JVM|appB|1|1|was|d'] },
  } } },
  sonra: { jobId: 2, serverId: 1, at: '2026-10-08T11:00:00Z', sonuc: { faz: 'sonra', sunucular: {
    GBJBOP18: { once_var: true, son_olculdu: true, son_fark: [], plan: ['FARK|DOWN|JBOSS8_JVM|appA|d', 'ISLEM|was|2|baslat|JBOSS8_JVM|appA|d'], islemler: ['SONUC|baslat|JBOSS8_JVM|appA|OK|/host=primary/server-config=appA:start -> STARTED'] },
    GBJBOAP18: { once_var: true, son_olculdu: true, son_fark: ['FARK|DOWN|JBOSS8_JVM|appB|d'], plan: ['FARK|DOWN|JBOSS8_JVM|appB|d', 'BILGI|NEW|JBOSS8_CTRL|HOST_CONTROLLER|domain yeni acilmis'], islemler: ['SONUC|baslat|JBOSS8_JVM|appB|FAIL|domain calismiyor'] },
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
  it('RT1 kayıt açılır: önce görüntüsü, sorunsuz/fark kaldı rozetleri, işlem ve elle bakılacaklar görünür', async () => {
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    expect(await screen.findByText('2 süreç kaydedildi')).toBeTruthy();
    expect(screen.getByText('Sorunsuz')).toBeTruthy();
    expect(screen.getByText('1 fark kaldı')).toBeTruthy();
    expect(screen.getByText('1 / 2 sunucu sorunsuz')).toBeTruthy();
    expect(screen.getByText(/domain yeni acilmis/)).toBeTruthy();
    expect(screen.getByText(/hâlâ KAPALI JBOSS8_JVM · appB/)).toBeTruthy();
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
