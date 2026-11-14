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

// 2026-11-14: önce görüntüsü boş sunucu + "kontrol gerekli" sonucu
const BOS_KAYIT = {
  ...KAYIT, id: 4, hosts: ['GBBOS01', 'GBJBOP18'], durum: 'kontrol',
  once: { jobId: 1, serverId: 1, at: '2026-11-13T22:00:00Z', sonuc: { faz: 'once', sunucular: {
    GBBOS01: { goruntu_ok: true, goruntu: ['BOOT|z1||'] },
    GBJBOP18: { goruntu_ok: true, goruntu: O18 },
  } } },
  sonra: { jobId: 2, serverId: 1, at: '2026-11-14T06:00:00Z', sonuc: { faz: 'sonra', sunucular: {
    GBBOS01: { once_var: true, son_olculdu: true, son_fark: [], goruntu: ['BOOT|z2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appX|x'], son_goruntu: ['BOOT|z2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appX|x'],
      plan: ['BILGI|BOS|||bos', 'BILGI|NEW|JBOSS8||reboot oncesi calismiyordu, simdi calisiyor - dokunulmadi', 'BILGI|NEW|JBOSS8|appX|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine dokunulmadi'], islemler: [] },
    GBJBOP18: KAYIT.sonra.sonuc.sunucular.GBJBOP18,
  } } },
  ozet: { once: { alinan: 2, toplam: 2, job: 'successful', once_bos: ['GBBOS01'] }, sonra: { sorunsuz: 1, kontrol: 1, toplam: 2, job: 'successful', sunucu: {
    GBBOS01: { durum: 'kontrol', kalan: 0, islem: 0, hatali: 0, neden: ['Reboot öncesi görüntüde izlenen ürün/JVM yoktu; bu sunucuda hiçbir şey açılıp kapatılmadı (uygulamalar zaten kapalıyken mi alındı?).'], sebep: 'x' },
    GBJBOP18: { durum: 'sorunsuz', kalan: 0, islem: 1, hatali: 0 },
  } } },
};
let AKTIF: typeof KAYIT | typeof BOS_KAYIT = KAYIT;

vi.mock('@/api/rebootCheckApi', () => ({
  rebootCheckApi: {
    list: vi.fn(async () => ({ ok: true, kayitlar: [AKTIF] })),
    get: vi.fn(async () => ({ ok: true, kayit: AKTIF })),
    once: vi.fn(),
    sonra: (...a: unknown[]) => sonraMock(...(a as [])),
  },
}));
vi.mock('@/api/serverHubApi', () => ({
  // Sekme yalniz sunucu adlarini ister (2026-11-05 hiz): tum filo degerlendirmesini (/overview) indirmez.
  serverHubApi: {
    hostAdlari: vi.fn(async () => ({ ok: true, hosts: ['GBJBOP18'] })),
    overview: vi.fn(async () => {
      throw new Error('Reboot Kontrolu /overview istememeli');
    }),
    jobStatus: vi.fn(),
  },
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

import RebootKontroluTab from '../RebootKontroluTab';
import { serverHubApi } from '@/api/serverHubApi';

describe('Reboot Kontrolü sekmesi', () => {
  it('RT1 kayıt açılır: önce ürünleri, sorunsuz/fark kaldı rozetleri, JVM satırı ve reboot doğrulaması görünür', async () => {
    AKTIF = KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    expect(await screen.findByText('2 ürün kaydedildi')).toBeTruthy();
    expect(serverHubApi.hostAdlari).toHaveBeenCalled();
    expect(serverHubApi.overview).not.toHaveBeenCalled();
    expect(screen.getByText('Sorunsuz')).toBeTruthy();
    expect(screen.getByText('1 fark kaldı')).toBeTruthy();
    expect(screen.getByText('1 / 2 sunucu sorunsuz')).toBeTruthy();
    expect(screen.getByText('reboot olmamış görünüyor')).toBeTruthy();
    expect(screen.getByText('çalışıyordu, hâlâ KAPALI')).toBeTruthy();
    expect(screen.getByText(/açma BAŞARISIZ/)).toBeTruthy();
  });

  it('RT2 "sonra" yalnız onay penceresinden gider', async () => {
    AKTIF = KAYIT;
    sonraMock.mockClear();
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    fireEvent.click(await screen.findByRole('button', { name: /Reboot sonrası kontrol et ve düzelt/ }));
    expect(sonraMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Onayla ve başlat' }));
    await waitFor(() => expect(sonraMock).toHaveBeenCalledWith(3));
  });
});

describe('Reboot Kontrolü sekmesi — boş önce görüntüsü (2026-11-14)', () => {
  it('RT3 boş önce yeşil DEĞİL uyarı; sonuç "Kontrol gerekli" + nedenler + "Neden dokunulmadı" listesi', async () => {
    AKTIF = BOS_KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#4'));
    expect(await screen.findByText(/Önce görüntüsünde izlenen ürün yok — uygulamalar zaten kapalıyken mi alındı\?/)).toBeTruthy();
    expect(screen.getByText('izlenen ürün yok')).toBeTruthy();
    expect(screen.getAllByText('Kontrol gerekli')).toHaveLength(3); // liste + ayrinti basligi + sunucu karti
    expect(screen.getByText('1 sunucuda kontrol gerekli')).toBeTruthy();
    expect(screen.getByText(/bu sunucuda hiçbir şey açılıp kapatılmadı \(uygulamalar/)).toBeTruthy();
    expect(screen.getByText('Plan notları — neden dokunulmadı / nasıl sayıldı')).toBeTruthy();
    // inceleme B6: bos-once nedeni uyari satirinda yaziliyken plan notlarinda TEKRAR edilmez
    expect(screen.queryByText('Reboot öncesi görüntüde izlenen ürün/JVM yoktu — hiçbir şey açılıp kapatılmadı.')).toBeNull();
    // inceleme B6: sorunsuz + kontrol = toplam -> kirmizi degil uyari rengi
    expect((screen.getByText('1 / 2 sunucu sorunsuz') as HTMLElement).style.color).toBe('var(--status-warning)');
    expect(screen.getByText(/^JBoss 8 \/ appX: ürün reboot öncesi görüntüde yoktu/)).toBeTruthy();
    expect(screen.getByText('şimdi çalışıyor — ürün reboot öncesi görüntüde yoktu, kurala göre dokunulmadı')).toBeTruthy();
  });

  it('RT4 onay penceresi önce görüntüsü boş sunucuları listeler; "kontrol" kaydında yeniden çalıştırılabilir', async () => {
    AKTIF = BOS_KAYIT;
    sonraMock.mockClear();
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#4'));
    const dugme = await screen.findByRole('button', { name: /Reboot sonrası kontrol et ve düzelt/ });
    expect((dugme as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dugme);
    expect(await screen.findByText('Önce görüntüsü boş sunucular (1)')).toBeTruthy();
    expect(screen.getByText('GBBOS01', { selector: 'div.font-mono' })).toBeTruthy();
    // inceleme B8: JVM kurali yalniz urunu reboot oncesi calisanlar icin; durulma beklemesi soylenir
    expect(screen.getByText(/Ürünü reboot öncesi çalışmayanın JVM'lerine dokunulmaz/)).toBeTruthy();
    expect(screen.getByText(/süreç listesinin durulması beklenir/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve başlat' }));
    await waitFor(() => expect(sonraMock).toHaveBeenCalledWith(4));
  });

  it('RT5 durulma=error notu görünür; tümü sorunlu iken özet kırmızı', async () => {
    const s18 = { ...KAYIT.sonra.sonuc.sunucular.GBJBOP18, durulma: 'error' };
    AKTIF = { ...KAYIT, id: 5, sonra: { ...KAYIT.sonra, sonuc: { faz: 'sonra', sunucular: { ...KAYIT.sonra.sonuc.sunucular, GBJBOP18: s18 } } } } as typeof KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#5'));
    fireEvent.click(await screen.findByText('Sorunsuz'));
    expect(await screen.findByText(/JVM planı çalışmadı — JVM'ler açılıp kapatılmadı/)).toBeTruthy();
    expect((screen.getByText('1 / 2 sunucu sorunsuz') as HTMLElement).style.color).toBe('var(--status-danger)');
  });
});
