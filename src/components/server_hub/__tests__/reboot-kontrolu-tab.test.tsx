// src/components/server_hub/__tests__/reboot-kontrolu-tab.test.tsx — RT1..RT2 (2026-10-08).
// Sekme sahte API ile render edilir: kayıt listesi, önce görüntüsü, sonra sonucu (sorunsuz / fark kaldı)
// ve onay penceresi. Onaysız "sonra" isteği GİTMEZ.
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    GBBOS01: { durum: 'kontrol', kalan: 0, islem: 0, hatali: 0, neden: ['Reboot öncesi görüntüde izlenen ürün/JVM yoktu; yalnız web ürünleri (Nginx/Apache/IHS) reboot öncesi haline (kapalı) döndürülür, diğerlerine dokunulmadı (uygulamalar zaten kapalıyken mi alındı?).'], sebep: 'x',
      otomasyon: { sinif: 'dokunmadi', teknoloji: [{ urun: 'JBOSS8', ad: 'JBoss 8', calistirildi: false, ozet: 'önce görüntüsü boş — dokunulmadı', sonuc: 'yok' }] } },
    GBJBOP18: { durum: 'sorunsuz', kalan: 0, islem: 1, hatali: 0,
      otomasyon: { sinif: 'basarili', teknoloji: [{ urun: 'RHA', ad: 'Apache HTTP Server', calistirildi: false, ozet: 'değişiklik yok', sonuc: 'yok' }, { urun: 'JBOSS8', ad: 'JBoss 8', calistirildi: true, ozet: '1 JVM açıldı ✓', sonuc: 'ok' }] } },
  } } },
};
// v3 (2026-11-15 akşam): otomasyon sınıfı + teknoloji listesi sunucudan; AWX betik sürümü.
const OTO_KAYIT = {
  ...KAYIT, id: 6, hosts: ['GBA01', 'GBB02', 'GBC03'], durum: 'sorunlu',
  once: { jobId: 1, serverId: 1, at: '2026-11-15T10:00:00Z', sonuc: { faz: 'once', sunucular: {
    GBA01: { goruntu_ok: true, goruntu: ['BOOT|a1||', 'SURUM|2||', 'URUN|RHA||'] },
    GBB02: { goruntu_ok: true, goruntu: ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||'] },
    GBC03: { goruntu_ok: true, goruntu: ['BOOT|c1||', 'SURUM|2||', 'URUN|IHS||'] },
  } } },
  sonra: { jobId: 2, serverId: 1, at: '2026-11-15T12:00:00Z', sonuc: { faz: 'sonra', sunucular: {
    GBA01: { once_var: true, son_olculdu: true, son_fark: [], betik_surum: 3, goruntu: ['BOOT|a2||', 'URUN|RHA||', 'URUN|NGINX||'], son_goruntu: ['BOOT|a2||', 'URUN|RHA||'], islemler: ['SONUC|durdur|NGINX||OK|x'] },
    GBB02: { once_var: true, son_olculdu: true, son_fark: [], betik_surum: 3, goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'], son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|CTG||'], islemler: [] },
    GBC03: { once_var: true, son_olculdu: true, son_fark: [], betik_surum: 2, goruntu: ['BOOT|c2||', 'URUN|IHS||'], son_goruntu: ['BOOT|c2||', 'URUN|IHS||'], islemler: [] },
  } } },
  ozet: { once: { alinan: 3, toplam: 3, job: 'successful' }, sonra: { sorunsuz: 1, kontrol: 1, toplam: 3, job: 'successful', sunucu: {
    GBA01: { durum: 'kontrol', kalan: 0, islem: 1, hatali: 0, neden: ['Nginx reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI; beklenen durum mu kontrol edin.'], sebep: 'x',
      otomasyon: { sinif: 'basarili', teknoloji: [{ urun: 'NGINX', ad: 'Nginx', calistirildi: true, ozet: 'kapatıldı ✓', sonuc: 'ok' }, { urun: 'RHA', ad: 'Apache HTTP Server', calistirildi: false, ozet: 'değişiklik yok', sonuc: 'yok' }] } },
    GBB02: { durum: 'sorunlu', kalan: 1, islem: 4, hatali: 1,
      otomasyon: { sinif: 'basarisiz', teknoloji: [{ urun: 'JBOSS8', ad: 'JBoss 8', calistirildi: true, ozet: '3 JVM açıldı ✓, 1 JVM açılamadı ✗', sonuc: 'hata' }] } },
    GBC03: { durum: 'sorunsuz', kalan: 0, islem: 0, hatali: 0,
      otomasyon: { sinif: 'dokunmadi', teknoloji: [{ urun: 'IHS', ad: 'IBM HTTP Server (IHS)', calistirildi: false, ozet: 'değişiklik yok', sonuc: 'yok' }] } },
  } } },
};
let AKTIF: typeof KAYIT | typeof BOS_KAYIT | typeof OTO_KAYIT = KAYIT;

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
    // v3: "Sorunsuz" artık özet kutusu ve filtre düğmesinde de var; sunucu rozeti başlıkta aranır
    const b18 = screen.getByRole('button', { name: /^GBJBOP18/ });
    expect(within(b18).getByText('Sorunsuz')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /^GBJBOAP18/ })).getByText('1 fark kaldı')).toBeTruthy();
    // otomasyon alanı olmayan eski API cevabı: istemci hesaplamaz, "—" gösterir; eski "N işlem" metni yok
    expect(within(b18).getByText('—')).toBeTruthy();
    expect(screen.queryByText(/\d işlem/)).toBeNull();
    // betik_surum yok -> kayıt düzeyinde TEK bant
    const bant = screen.getAllByRole('alert').filter((x) => /reboot_check betiği eski/.test(x.textContent || ''));
    expect(bant).toHaveLength(1);
    expect(bant[0].textContent).toMatch(/\(sürüm yok, gerekli 3\): bu koşuda ürün kapatma ve yeniden deneme YOKTU.*\(2 sunucu\)/);
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
    expect(screen.getAllByText('Kontrol gerekli')).toHaveLength(5); // liste + ayrinti basligi + sunucu karti + ozet kutusu + filtre dugmesi
    // OTOMASYON OZETI + FILTRE (2026-11-15): sayilar sunucu; komut kosmayan sunucu "dokunmadi", filtre listeyi daraltir.
    expect(screen.getByText(/Sayılar/).textContent).toMatch(/sunucu sayısıdır/);
    const oto = screen.getByRole('group', { name: 'Otomasyon filtresi' });
    const son = screen.getByRole('group', { name: 'Son durum filtresi' });
    expect(within(oto).getByRole('button', { name: /^Dokunmadı \(1\)/ })).toBeTruthy();
    expect(within(oto).getByRole('button', { name: /^Başarılı \(1\)/ })).toBeTruthy();
    fireEvent.click(within(oto).getByRole('button', { name: /^Başarısız \(0\)/ }));
    expect(screen.getByText('Bu filtrede sunucu yok.')).toBeTruthy();
    // iki grup AND: otomasyon "Başarısız" seçiliyken son durum sayıları 0
    expect(within(son).getByRole('button', { name: /^Kontrol gerekli \(0\)/ })).toBeTruthy();
    fireEvent.click(within(oto).getByRole('button', { name: /^Tümü/ }));
    fireEvent.click(within(son).getByRole('button', { name: /^Kontrol gerekli \(1\)/ }));
    expect(screen.queryByText('Bu filtrede sunucu yok.')).toBeNull();
    expect(screen.queryByRole('button', { name: /^GBJBOP18/ })).toBeNull();
    expect(screen.getByText('JBoss 8 (önce görüntüsü boş — dokunulmadı)', { exact: false })).toBeTruthy();
    expect(screen.getByText('1 sunucuda kontrol gerekli')).toBeTruthy();
    expect(screen.getByText(/yalnız web ürünleri \(Nginx\/Apache\/IHS\) reboot öncesi haline \(kapalı\) döndürülür, diğerlerine dokunulmadı \(uygulamalar/)).toBeTruthy();
    expect(screen.queryByText(/hiçbir şey açılıp kapatılmadı/)).toBeNull();
    expect(screen.getByText('Plan notları — neden dokunulmadı / nasıl sayıldı')).toBeTruthy();
    // inceleme B6: bos-once nedeni uyari satirinda yaziliyken plan notlarinda TEKRAR edilmez
    expect(screen.queryByText('Reboot öncesi görüntüde izlenen ürün/JVM yoktu — yalnız web ürünleri (Nginx/Apache/IHS) reboot öncesi haline (kapalı) döndürülür, diğerlerine dokunulmadı.')).toBeNull();
    // inceleme B6: sorunsuz + kontrol = toplam -> kirmizi degil uyari rengi
    expect((screen.getByText('1 / 2 sunucu sorunsuz') as HTMLElement).style.color).toBe('var(--status-warning)');
    expect(screen.getByText(/^JBoss 8 \/ appX: ürün reboot öncesi görüntüde yoktu/)).toBeTruthy();
    // bos once = kapatma kapisi: urun ve JVM'i KAPATILMADI, gercekten dokunulmadi (2026-11-15)
    expect(screen.getByText('şimdi çalışıyor — ürün reboot öncesi görüntüde yoktu, kapatma kapısı gereği dokunulmadı')).toBeTruthy();
    expect(screen.getByText('reboot öncesi çalışmıyordu, şimdi çalışıyor — önce görüntüsü boş / eski sürüm, kapatılmadı (dokunulmadı)')).toBeTruthy();
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
    expect(screen.getByText(/Ürünü reboot öncesi çalışmayanın JVM'leri ürünle birlikte kapanır/)).toBeTruthy();
    // 2026-11-15 "nasil bulduysan oyle birak": once calismayan urun KAPATILIR - kalin uyari, domain/WAS/CTG her seyi kapatir
    expect(screen.getByText(/önce çalışmayan ürün çalışıyorsa kapatılır|çalışmayan ürün şimdi çalışıyorsa/)).toBeTruthy();
    const uyari = screen.getByText('Dikkat: reboot öncesi çalışmayan ürün KAPATILIR.');
    expect(uyari.tagName).toBe('B');
    expect(uyari.parentElement?.textContent).toMatch(/JBoss domain'i .*WAS .*CTG kapatılınca üzerindeki her şey kapanır/);
    expect(screen.getByText(/süreç listesinin durulması beklenir/)).toBeTruthy();
    // v3: boş önce görüntüsünde yalnız web ürünleri kapatılır; kapatılan ürün "kontrol edilecek"
    expect(uyari.parentElement?.textContent).toMatch(/Önce görüntüsü boş olan sunucularda yalnız web ürünleri \(Nginx\/Apache\/IHS\) kapatılır, CTG\/JBoss\/WAS kapatılmaz/);
    expect(uyari.parentElement?.textContent).toMatch(/Otomasyonun kapattığı her ürün sonuçta kontrol edilecek/);
    // önce kartı + onay penceresindeki boş-önce uyarısı
    expect(screen.getAllByText(/yalnız web ürünlerini \(Nginx\/Apache\/IHS\) çalışıyorsa kapatır; CTG, JBoss ve WAS'a dokunmaz/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve başlat' }));
    await waitFor(() => expect(sonraMock).toHaveBeenCalledWith(4));
  });

  it('RT5 durulma=error notu görünür; tümü sorunlu iken özet kırmızı', async () => {
    const s18 = { ...KAYIT.sonra.sonuc.sunucular.GBJBOP18, durulma: 'error' };
    AKTIF = { ...KAYIT, id: 5, sonra: { ...KAYIT.sonra, sonuc: { faz: 'sonra', sunucular: { ...KAYIT.sonra.sonuc.sunucular, GBJBOP18: s18 } } } } as typeof KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#5'));
    fireEvent.click(await screen.findByRole('button', { name: /^GBJBOP18/ }));
    expect(await screen.findByText(/JVM planı çalışmadı — JVM'ler açılıp kapatılmadı/)).toBeTruthy();
    expect((screen.getByText('1 / 2 sunucu sorunsuz') as HTMLElement).style.color).toBe('var(--status-danger)');
  });
});

describe('Reboot Kontrolü sekmesi — v3 otomasyon filtresi, teknoloji çipleri, sürüm bandı', () => {
  it('RT6 özet kutuları (otomasyon 3 sınıf + son durum), iki grup AND filtre, teknoloji çipleri, eski betik bandı', async () => {
    AKTIF = OTO_KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#6'));
    await screen.findByRole('button', { name: /^GBA01/ });
    const kutu = (etiket: string) => screen.getByText(etiket, { selector: 'div' }).previousElementSibling?.textContent;
    expect([kutu('Otomasyon başarılı'), kutu('Otomasyon başarısız'), kutu('Otomasyon dokunmadı')]).toEqual(['1', '1', '1']);
    expect([kutu('Sorunsuz'), kutu('Kontrol gerekli'), kutu('Sorun kaldı')]).toEqual(['1', '1', '1']);
    // teknoloji çipleri: çalıştırılan (yeşil ✓ / kırmızı ✗) ve çalıştırılmayan (neden)
    const a = screen.getByRole('button', { name: /^GBA01/ });
    expect(within(a).getByText('Otomasyon başarılı')).toBeTruthy();
    expect((within(a).getByText('Nginx: kapatıldı ✓') as HTMLElement).style.color).toBe('var(--status-success)');
    expect(within(a).getByText('çalıştırılmadı: Red Hat Apache (değişiklik yok)')).toBeTruthy();
    const b = screen.getByRole('button', { name: /^GBB02/ });
    expect((within(b).getByText('JBoss 8: 3 JVM açıldı ✓, 1 JVM açılamadı ✗') as HTMLElement).style.color).toBe('var(--status-danger)');
    expect(within(screen.getByRole('button', { name: /^GBC03/ })).getByText('çalıştırılmadı: IBM Apache (IHS) (değişiklik yok)')).toBeTruthy();
    // sürüm bandı: yalnız betik_surum < 3 olan sunucu sayılır, tek bant
    const bant = screen.getAllByRole('alert').filter((x) => /reboot_check betiği eski/.test(x.textContent || ''));
    expect(bant).toHaveLength(1);
    expect(bant[0].textContent).toMatch(/\(sürüm 2, gerekli 3\).*\(1 sunucu\)/);
    // ürün tablosu sunucu sürümünü kullanır: betik_surum 3 iken "eski betik olabilir" DENMEZ, kesin konuşulur
    expect(screen.getByText('reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — otomasyon kapatma komutu çalıştırmadı (plandan sonra kalkmış olabilir; yeniden çalıştırın)')).toBeTruthy();
    expect(screen.queryByText(/eski betik sürümü olabilir/)).toBeNull();
    // filtre: otomasyon Başarısız -> yalnız GBB02; son durum sayıları AND ile daralır
    const oto = screen.getByRole('group', { name: 'Otomasyon filtresi' });
    const son = screen.getByRole('group', { name: 'Son durum filtresi' });
    expect(within(oto).getAllByRole('button').map((x) => x.textContent)).toEqual(['Tümü (3)', 'Başarılı (1)', 'Başarısız (1)', 'Dokunmadı (1)']);
    expect(within(son).getAllByRole('button').map((x) => x.textContent)).toEqual(['Tümü (3)', 'Sorunsuz (1)', 'Kontrol gerekli (1)', 'Sorun kaldı (1)']);
    fireEvent.click(within(oto).getByRole('button', { name: /^Başarısız/ }));
    expect(screen.getByRole('button', { name: /^GBB02/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^GBA01/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^GBC03/ })).toBeNull();
    expect(within(son).getAllByRole('button').map((x) => x.textContent)).toEqual(['Tümü (1)', 'Sorunsuz (0)', 'Kontrol gerekli (0)', 'Sorun kaldı (1)']);
    fireEvent.click(within(son).getByRole('button', { name: /^Sorun kaldı/ }));
    expect(screen.getByRole('button', { name: /^GBB02/ })).toBeTruthy();
    fireEvent.click(within(oto).getByRole('button', { name: /^Başarılı/ }));
    expect(screen.getByText('Bu filtrede sunucu yok.')).toBeTruthy();
    // eski filtreler kalktı
    expect(screen.queryByRole('button', { name: /Otomasyon işlem yaptı|Komutu başarısız/ })).toBeNull();
  });

  it('RT7 sonuç gelmeyen sunucu: otomasyon "başarısız" + kırmızı neden notu ("dokunmadı" denmez)', async () => {
    const k = structuredClone(OTO_KAYIT);
    const not = 'sunucudan sonuç gelmedi — otomasyonun ne yaptığı bilinmiyor (doğrulanamadı)';
    k.ozet.sonra.sunucu.GBC03 = { durum: 'olculemedi', kalan: 0, islem: 0, hatali: 0, otomasyon: { sinif: 'basarisiz', teknoloji: [], not } } as typeof k.ozet.sonra.sunucu.GBC03;
    AKTIF = k;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#6'));
    const c = await screen.findByRole('button', { name: /^GBC03/ });
    expect(within(c).getByText('Otomasyon başarısız')).toBeTruthy();
    expect((within(c).getByText(not) as HTMLElement).style.color).toBe('var(--status-danger)');
    expect(within(c).queryByText('Otomasyon dokunmadı')).toBeNull();
  });
});
