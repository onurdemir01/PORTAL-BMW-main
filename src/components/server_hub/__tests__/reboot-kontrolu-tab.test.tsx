// src/components/server_hub/__tests__/reboot-kontrolu-tab.test.tsx — RT1..RT2 (2026-10-08).
// Sekme sahte API ile render edilir: kayıt listesi, önce görüntüsü, sonra sonucu (sorunsuz / fark kaldı)
// ve onay penceresi. Onaysız "sonra" isteği GİTMEZ.
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';

const sonraMock = vi.fn(async () => ({
  ok: true,
  jobId: 9,
  awxServerId: 1,
  hedef: ['ORJBOP18'],
  disarida: [],
}));
const O18 = ['BOOT|b1||', 'URUN|JBOSS8||', 'URUN|RHA||', 'JVM|JBOSS8|appA|x'];
const O19 = ['BOOT|c1||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appB|x'];
const KAYIT = {
  id: 3,
  hosts: ['ORJBOP18', 'ORJBOAP18'],
  not: 'Ekim patch',
  durum: 'sorunlu',
  olusturan: 'onur',
  olusturuldu: '2026-10-08T10:00:00Z',
  once: {
    jobId: 1,
    serverId: 1,
    at: '2026-10-08T10:01:00Z',
    sonuc: {
      faz: 'once',
      sunucular: {
        ORJBOP18: { goruntu_ok: true, goruntu: O18 },
        ORJBOAP18: { goruntu_ok: true, goruntu: O19 },
      },
    },
  },
  sonra: {
    jobId: 2,
    serverId: 1,
    at: '2026-10-08T11:00:00Z',
    sonuc: {
      faz: 'sonra',
      sunucular: {
        ORJBOP18: {
          once_var: true,
          son_olculdu: true,
          son_fark: [],
          goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|RHA||'],
          son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|RHA||', 'JVM|JBOSS8|appA|x'],
          islemler: [
            'SONUC|baslat|JBOSS8|appA|OK|/host=primary/server-config=appA:start -> STARTED',
          ],
        },
        ORJBOAP18: {
          once_var: true,
          son_olculdu: true,
          son_fark: ['FARK|DOWN|JVM|JBOSS8|appB|x'],
          goruntu: ['BOOT|c1||', 'URUN|JBOSS8||'],
          son_goruntu: ['BOOT|c1||', 'URUN|JBOSS8||'],
          islemler: ['SONUC|baslat|JBOSS8|appB|FAIL|start sonrasi durum=FAILED'],
        },
      },
    },
  },
  ozet: {
    once: { alinan: 2, toplam: 2, job: 'successful' },
    sonra: {
      sorunsuz: 1,
      toplam: 2,
      job: 'successful',
      sunucu: {
        ORJBOP18: { durum: 'sorunsuz', kalan: 0, islem: 1, hatali: 0 },
        ORJBOAP18: { durum: 'sorunlu', kalan: 1, islem: 1, hatali: 1 },
      },
    },
  },
};

// 2026-11-14: önce görüntüsü boş sunucu + "kontrol gerekli" sonucu
const BOS_KAYIT = {
  ...KAYIT,
  id: 4,
  hosts: ['ORBOS01', 'ORJBOP18'],
  durum: 'kontrol',
  once: {
    jobId: 1,
    serverId: 1,
    at: '2026-11-13T22:00:00Z',
    sonuc: {
      faz: 'once',
      sunucular: {
        ORBOS01: { goruntu_ok: true, goruntu: ['BOOT|z1||'] },
        ORJBOP18: { goruntu_ok: true, goruntu: O18 },
      },
    },
  },
  sonra: {
    jobId: 2,
    serverId: 1,
    at: '2026-11-14T06:00:00Z',
    sonuc: {
      faz: 'sonra',
      sunucular: {
        ORBOS01: {
          once_var: true,
          son_olculdu: true,
          son_fark: [],
          goruntu: ['BOOT|z2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appX|x'],
          son_goruntu: ['BOOT|z2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appX|x'],
          plan: [
            'BILGI|BOS|||bos',
            'BILGI|NEW|JBOSS8||reboot oncesi calismiyordu, simdi calisiyor - dokunulmadi',
            'BILGI|NEW|JBOSS8|appX|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine dokunulmadi',
          ],
          islemler: [],
        },
        ORJBOP18: KAYIT.sonra.sonuc.sunucular.ORJBOP18,
      },
    },
  },
  ozet: {
    once: { alinan: 2, toplam: 2, job: 'successful', once_bos: ['ORBOS01'] },
    sonra: {
      sorunsuz: 1,
      kontrol: 1,
      toplam: 2,
      job: 'successful',
      sunucu: {
        ORBOS01: {
          durum: 'kontrol',
          kalan: 0,
          islem: 0,
          hatali: 0,
          neden: [
            'Reboot öncesi görüntüde izlenen ürün/JVM yoktu; reboot sonrası çalışan her ürün (Nginx/Apache/IHS/CTG/JBoss/WAS) reboot öncesi haline (kapalı) döndürülür ve kontrol edilecek (uygulamalar zaten kapalıyken mi alındı?).',
          ],
          sebep: 'x',
          otomasyon: {
            sinif: 'dokunmadi',
            teknoloji: [
              {
                urun: 'JBOSS8',
                ad: 'JBoss 8',
                calistirildi: false,
                ozet: "AWX'teki betik eski — işlem yapılmadı",
                sonuc: 'yok',
              },
            ],
          },
        },
        ORJBOP18: {
          durum: 'sorunsuz',
          kalan: 0,
          islem: 1,
          hatali: 0,
          otomasyon: {
            sinif: 'basarili',
            teknoloji: [
              {
                urun: 'RHA',
                ad: 'Apache HTTP Server',
                calistirildi: false,
                ozet: 'değişiklik yok',
                sonuc: 'yok',
              },
              {
                urun: 'JBOSS8',
                ad: 'JBoss 8',
                calistirildi: true,
                ozet: '1 JVM açıldı ✓',
                sonuc: 'ok',
              },
            ],
          },
        },
      },
    },
  },
};
// v3 (2026-11-15 akşam): otomasyon sınıfı + teknoloji listesi sunucudan; AWX betik sürümü.
const OTO_KAYIT = {
  ...KAYIT,
  id: 6,
  hosts: ['ORA01', 'ORB02', 'ORC03'],
  durum: 'sorunlu',
  once: {
    jobId: 1,
    serverId: 1,
    at: '2026-11-15T10:00:00Z',
    sonuc: {
      faz: 'once',
      sunucular: {
        ORA01: { goruntu_ok: true, goruntu: ['BOOT|a1||', 'SURUM|2||', 'URUN|RHA||'] },
        ORB02: { goruntu_ok: true, goruntu: ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||'] },
        ORC03: { goruntu_ok: true, goruntu: ['BOOT|c1||', 'SURUM|2||', 'URUN|IHS||'] },
      },
    },
  },
  sonra: {
    jobId: 2,
    serverId: 1,
    at: '2026-11-15T12:00:00Z',
    sonuc: {
      faz: 'sonra',
      sunucular: {
        ORA01: {
          once_var: true,
          son_olculdu: true,
          son_fark: [],
          betik_surum: 4,
          goruntu: ['BOOT|a2||', 'URUN|RHA||', 'URUN|NGINX||'],
          son_goruntu: ['BOOT|a2||', 'URUN|RHA||'],
          islemler: ['SONUC|durdur|NGINX||OK|x'],
        },
        ORB02: {
          once_var: true,
          son_olculdu: true,
          son_fark: [],
          betik_surum: 4,
          goruntu: ['BOOT|b2||', 'URUN|JBOSS8||'],
          son_goruntu: ['BOOT|b2||', 'URUN|JBOSS8||', 'URUN|CTG||'],
          islemler: [],
        },
        ORC03: {
          once_var: true,
          son_olculdu: true,
          son_fark: [],
          betik_surum: 2,
          goruntu: ['BOOT|c2||', 'URUN|IHS||'],
          son_goruntu: ['BOOT|c2||', 'URUN|IHS||'],
          islemler: [],
        },
      },
    },
  },
  ozet: {
    once: { alinan: 3, toplam: 3, job: 'successful' },
    sonra: {
      sorunsuz: 1,
      kontrol: 1,
      toplam: 3,
      job: 'successful',
      sunucu: {
        ORA01: {
          durum: 'kontrol',
          kalan: 0,
          islem: 1,
          hatali: 0,
          neden: [
            'Nginx reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyon KAPATTI; beklenen durum mu kontrol edin.',
          ],
          sebep: 'x',
          otomasyon: {
            sinif: 'basarili',
            teknoloji: [
              { urun: 'NGINX', ad: 'Nginx', calistirildi: true, ozet: 'kapatıldı ✓', sonuc: 'ok' },
              {
                urun: 'RHA',
                ad: 'Apache HTTP Server',
                calistirildi: false,
                ozet: 'değişiklik yok',
                sonuc: 'yok',
              },
            ],
          },
        },
        ORB02: {
          durum: 'sorunlu',
          kalan: 1,
          islem: 4,
          hatali: 1,
          otomasyon: {
            sinif: 'basarisiz',
            teknoloji: [
              {
                urun: 'JBOSS8',
                ad: 'JBoss 8',
                calistirildi: true,
                ozet: '3 JVM açıldı ✓, 1 JVM açılamadı ✗',
                sonuc: 'hata',
              },
            ],
          },
        },
        ORC03: {
          durum: 'sorunsuz',
          kalan: 0,
          islem: 0,
          hatali: 0,
          otomasyon: {
            sinif: 'dokunmadi',
            teknoloji: [
              {
                urun: 'IHS',
                ad: 'IBM HTTP Server (IHS)',
                calistirildi: false,
                ozet: 'değişiklik yok',
                sonuc: 'yok',
              },
            ],
          },
        },
      },
    },
  },
};
// v4 (2026-11-16): önce görüntüsü boş, başka nedeni olmayan sunucu "Karşılaştırma dışı" (nötr) + yönetici özeti + komut köprüsü.
const KD_BILGI =
  'Reboot öncesi görüntüde izlenen ürün/JVM yoktu; reboot sonrası çalışan her ürün (Nginx/Apache/IHS/CTG/JBoss/WAS) reboot öncesi haline (kapalı) döndürülür ve kontrol edilecek (uygulamalar zaten kapalıyken mi alındı?).';
const KD_KAYIT = {
  ...KAYIT,
  id: 8,
  hosts: ['ORBOS02', 'ORJBOP18'],
  durum: 'tamam',
  once: {
    jobId: 1,
    serverId: 1,
    at: '2026-11-16T01:00:00Z',
    sonuc: {
      faz: 'once',
      sunucular: {
        ORBOS02: { goruntu_ok: true, goruntu: ['BOOT|k1||'] },
        ORJBOP18: { goruntu_ok: true, goruntu: O18 },
      },
    },
  },
  sonra: {
    jobId: 2,
    serverId: 1,
    at: '2026-11-16T03:00:00Z',
    sonuc: {
      faz: 'sonra',
      sunucular: {
        ORBOS02: {
          once_var: true,
          son_olculdu: true,
          son_fark: [],
          betik_surum: 4,
          goruntu: ['BOOT|k2||'],
          son_goruntu: ['BOOT|k2||'],
          plan: ['BILGI|BOS|||bos'],
          islemler: [],
        },
        ORJBOP18: { ...KAYIT.sonra.sonuc.sunucular.ORJBOP18, betik_surum: 4 },
      },
    },
  },
  ozet: {
    once: { alinan: 2, toplam: 2, job: 'successful', once_bos: ['ORBOS02'] },
    sonra: {
      sorunsuz: 1,
      kontrol: 0,
      kapsamDisi: 1,
      toplam: 2,
      job: 'successful',
      sunucu: {
        ORBOS02: {
          durum: 'kapsam_disi',
          kalan: 0,
          islem: 0,
          hatali: 0,
          bilgi: [KD_BILGI],
          sebep:
            'Reboot öncesi bu sunucuda izlenen uygulama (Nginx/Apache/IHS/CTG/JBoss/WAS) çalışmıyordu; karşılaştırılacak bir şey yoktu.',
          otomasyon: { sinif: 'dokunmadi', teknoloji: [] },
        },
        ORJBOP18: {
          durum: 'sorunsuz',
          kalan: 0,
          islem: 1,
          hatali: 0,
          otomasyon: {
            sinif: 'basarili',
            teknoloji: [
              {
                urun: 'JBOSS8',
                ad: 'JBoss 8',
                calistirildi: true,
                ozet: '1 JVM açıldı ✓',
                sonuc: 'ok',
              },
            ],
          },
        },
      },
      yonetici: {
        sunucu: {
          toplam: 2,
          olculen: 2,
          onceBos: 1,
          onceBosDiger: 0,
          olculemeyen: 0,
          karsilastirilabilir: 1,
          sorunsuz: 1,
          kontrol: 0,
          sorunlu: 0,
          birakilan: 1,
          birakilanKontrolNotlu: 0,
          kontrolBekleyen: 0,
        },
        oge: {
          once: 4,
          hedef: 4,
          dogru: 4,
          ilkSapan: 1,
          ilkDown: 1,
          ilkNew: 0,
          otomatik: 1,
          kendiliginden: 0,
          halaSapan: 0,
        },
        komut: { ok: 1, fail: 0, skip: 2, okHedefteDegil: 0, sunucu: 1, komut: 3, basarili: 1 },
        oran: {
          birakildi: { pay: 1, payda: 1, metin: '%100' },
          donus: { pay: 4, payda: 4, metin: '%100' },
          otomasyon: { pay: 1, payda: 1, metin: '%100' },
          komut: { pay: 1, payda: 1, metin: '%100' },
          kapanan: { pay: 0, payda: 0, metin: '—' },
        },
        metin: 'Kayıttaki 2 sunucunun 2 tanesinde reboot sonrası son durum ölçüldü.',
      },
    },
  },
};
let AKTIF: typeof KAYIT | typeof BOS_KAYIT | typeof OTO_KAYIT | typeof KD_KAYIT = KAYIT;

const alimMock = vi.fn(async (_tara?: boolean): Promise<{ ok: boolean; durum?: unknown }> => ({
  ok: true,
  durum: ALIM,
}));
let getBekle: Promise<void> | null = null;
// AWX alimi (2026-11-21): son tarama ozeti; varsayilan "alinan + Portal'dan baslatilmis" iki is.
let ALIM: unknown = {
  aralikSn: 120,
  geriGun: 7,
  sonTarama: '2026-11-21T09:00:00Z',
  sablon: { templateId: 77, serverId: 1, sunucuAdi: 'Maestro2' },
  neden: null,
  hata: null,
  bulunan: 2,
  isler: [
    { jobId: 502, sonuc: 'atlandi', neden: 'portal_gecmisi', zaman: '2026-11-21T09:00:00Z' },
    { jobId: 501, sonuc: 'alindi', kayitId: 3, faz: 'once', zaman: '2026-11-21T09:00:00Z' },
  ],
};
vi.mock('@/api/rebootCheckApi', () => ({
  rebootCheckApi: {
    awxAlim: (t?: boolean) => alimMock(t),
    list: vi.fn(async () => ({ ok: true, kayitlar: [AKTIF] })),
    get: vi.fn(async () => {
      if (getBekle) await getBekle;
      return { ok: true, kayit: AKTIF };
    }),
    once: vi.fn(),
    sonra: (...a: unknown[]) => sonraMock(...(a as [])),
  },
}));
vi.mock('@/api/serverHubApi', () => ({
  // Sekme yalniz sunucu adlarini ister (2026-11-05 hiz): tum filo degerlendirmesini (/overview) indirmez.
  serverHubApi: {
    hostAdlari: vi.fn(async () => ({ ok: true, hosts: ['ORJBOP18'] })),
    overview: vi.fn(async () => {
      throw new Error('Reboot Kontrolu /overview istememeli');
    }),
    jobStatus: vi.fn(),
  },
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

import RebootKontroluTab from '../RebootKontroluTab';
import { serverHubApi } from '@/api/serverHubApi';
import { rebootCheckApi } from '@/api/rebootCheckApi';

describe('Reboot Kontrolü sekmesi', () => {
  it('RT1 kayıt açılır: önce ürünleri, sorunsuz/fark kaldı rozetleri, JVM satırı ve reboot doğrulaması görünür', async () => {
    AKTIF = KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    expect(await screen.findByText('2 ürün kaydedildi')).toBeTruthy();
    expect(serverHubApi.hostAdlari).toHaveBeenCalled();
    expect(serverHubApi.overview).not.toHaveBeenCalled();
    // v3: "Sorunsuz" artık özet kutusu ve filtre düğmesinde de var; sunucu rozeti başlıkta aranır
    const b18 = screen.getByRole('button', { name: /^ORJBOP18/ });
    expect(within(b18).getByText('Sorunsuz')).toBeTruthy();
    expect(
      within(screen.getByRole('button', { name: /^ORJBOAP18/ })).getByText('1 fark kaldı'),
    ).toBeTruthy();
    // otomasyon alanı olmayan eski API cevabı: istemci hesaplamaz, "—" gösterir; eski "N işlem" metni yok
    expect(within(b18).getByText('—')).toBeTruthy();
    expect(screen.queryByText(/\d işlem/)).toBeNull();
    // betik_surum yok -> kayıt düzeyinde TEK bant
    const bant = screen
      .getAllByRole('alert')
      .filter((x) => /reboot_check betiği eski/.test(x.textContent || ''));
    expect(bant).toHaveLength(1);
    expect(bant[0].textContent).toMatch(
      /\(sürüm yok, gerekli 4\): bu koşuda ürün kapatma ve yeniden deneme YOKTU.*\(2 sunucuda etkili\)/,
    );
    expect(screen.getByText('1 / 2 sunucu sorunsuz')).toBeTruthy();
    expect(screen.getByText('reboot olmamış görünüyor')).toBeTruthy();
    expect(screen.getByText('çalışıyordu, hâlâ KAPALI')).toBeTruthy();
    expect(screen.getByText(/açma BAŞARISIZ/)).toBeTruthy();
  });

  it('RT1b AWX’ten alınan kayıt: listede ve başlıkta AWX · WF rozeti; Portal kaydında rozet yok', async () => {
    AKTIF = {
      ...KAYIT,
      kaynak: 'AWX',
      awxWorkflowId: 7000,
      olusturan: 'awx:unix-ekip',
      not: 'AWX’ten alındı: iş #501, workflow #7000',
    } as unknown as typeof AKTIF;
    const { unmount } = render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    await screen.findByText('2 ürün kaydedildi');
    expect(screen.getAllByText('AWX · WF #7000')).toHaveLength(2);
    unmount();
    AKTIF = KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    await screen.findByText('2 ürün kaydedildi');
    expect(screen.queryByText(/^AWX( · WF #\d+)?$/)).toBeNull();
  });

  it('RT1c sunucu seviyesi özet: başarı oranı, gruplar; sayıya tıklayınca sunucular, işlemler ve neden açılır; 0 grubu tıklanmaz', async () => {
    const seviye = {
      toplam: 2,
      sayi: { mudahalesiz: 0, duzeltildi: 1, kontrol: 0, yapilamadi: 0, hatali: 1 },
      kova: {
        mudahalesiz: [],
        duzeltildi: ['ORJBOP18'],
        kontrol: [],
        yapilamadi: [],
        hatali: ['ORJBOAP18'],
      },
      basari: { pay: 1, payda: 2, metin: '%50' },
      islemYapilan: 2,
      geriGetirilen: { pay: 1, payda: 2, metin: '%50' },
      islemler: [],
      sunucu: {
        ORJBOP18: {
          kova: 'duzeltildi',
          etiket: [],
          neden: [],
          komutlar: [{ islem: 'baslat', urun: 'JBOSS8', ad: 'appA', sonuc: 'OK', hedefte: true }],
        },
        ORJBOAP18: {
          kova: 'hatali',
          etiket: [],
          neden: ['1 öğe reboot öncesinden farklı kaldı', '1 komut hata döndü'],
          komutlar: [
            { islem: 'baslat', urun: 'JBOSS8', ad: 'appB', sonuc: 'FAIL', hedefte: false },
          ],
        },
      },
      etiketSay: { izlenenYok: 0 },
      yapilamadiNeden: { ulasilamadi: 0, once_yok: 0, olculemedi: 0, komutsuz: 0 },
    };
    AKTIF = {
      ...KAYIT,
      ozet: { ...KAYIT.ozet, sonra: { ...KAYIT.ozet.sonra, seviye } },
    } as unknown as typeof AKTIF;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    const y = await screen.findByRole('group', { name: 'Yönetici özeti' });
    expect(within(y).getByTestId('seviye-basari').textContent).toBe('%50');
    expect(y.textContent).toMatch(/1 \/ 2 sunucu reboot öncesi haliyle çalışıyor/);
    expect(y.textContent).toMatch(/2 sunucuda işlem yapıldı · 1 tanesi eski haline getirildi/);
    expect((within(y).getByTestId('seviye-mudahalesiz') as HTMLButtonElement).disabled).toBe(true);
    // v2: ayni dalin iki sonucu ayni kartta (Otomasyon devreye girdi -> getirildi / getirilemedi); kontrol yoksa serit yok
    const oto = within(y).getByText('Otomasyon devreye girdi').parentElement as HTMLElement;
    expect(within(oto).getByTestId('seviye-duzeltildi').textContent).toBe(
      '1✓ Eski haline getirildi',
    );
    expect(within(oto).getByTestId('seviye-hatali').textContent).toBe(
      '1✗ Eski haline getirilemedi',
    );
    expect(within(y).queryByTestId('seviye-kontrol')).toBeNull();
    expect(within(y).queryByTestId('seviye-ayrinti')).toBeNull();
    fireEvent.click(within(y).getByTestId('seviye-hatali'));
    const ay = within(y).getByTestId('seviye-ayrinti');
    expect(ay.textContent).toMatch(/ORJBOAP18/);
    expect(ay.textContent).toMatch(/JBoss 8 JVM appB açma — hata/);
    expect(ay.textContent).toMatch(/1 öğe reboot öncesinden farklı kaldı · 1 komut hata döndü/);
    expect(ay.textContent).not.toMatch(/ORJBOP18/);
    expect(within(y).getByTestId('seviye-hatali').getAttribute('aria-expanded')).toBe('true');
    // eski 4 oran ve paragraf yok
    expect(within(y).queryByText('Reboot öncesi hale dönüş')).toBeNull();
    fireEvent.click(within(y).getByTestId('seviye-hatali'));
    expect(within(y).queryByTestId('seviye-ayrinti')).toBeNull();
  });

  it('RT2 "sonra" yalnız onay penceresinden gider', async () => {
    AKTIF = KAYIT;
    sonraMock.mockClear();
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    fireEvent.click(
      await screen.findByRole('button', { name: /Reboot sonrası kontrol et ve düzelt/ }),
    );
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
    // 2026-11-22: boş önce sunucusu kart kart sarı uyarı DEĞİL; 1. bölümün en altında tek, kapalı, gri grup
    const grup = await screen.findByTestId('rc-once-bos-grup');
    expect((grup as HTMLDetailsElement).open).toBe(false);
    expect(grup.style.borderColor).toBe('var(--border)');
    expect(within(grup).getByText('ORBOS01')).toBeTruthy();
    expect(
      within(grup).getByText(/Reboot öncesi çalışan izlenen ürünü olmayan sunucular/).parentElement
        ?.textContent,
    ).toMatch(/1$/);
    // reboot sonrası kontrol koştu: geçmiş zaman, "yeniden alın" denmez
    expect(
      within(grup).getByText(/çalışır bulduğu her ürünü \(prod dahil\) kapattı; sonuç aşağıda/),
    ).toBeTruthy();
    expect(within(grup).queryByText(/yeniden alın|bu tek başına bir hata değil/)).toBeNull();
    expect(within(grup).queryByText(/zaten kapalıyken mi alındı/)).toBeNull();
    // grup, önce kartlarından SONRA gelir; boş sunucunun ayrıca kartı yok
    const kart = screen.getByText('ORJBOP18', { selector: 'summary span' });
    expect(kart.compareDocumentPosition(grup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('ORBOS01', { selector: 'summary span' })).toBeNull();
    expect(screen.queryByText('izlenen ürün yok')).toBeNull();
    expect(screen.queryByText(/Önce görüntüsünde izlenen ürün yok/)).toBeNull();
    expect(screen.getAllByText('Kontrol gerekli')).toHaveLength(5); // liste + ayrinti basligi + sunucu karti + ozet kutusu + filtre dugmesi
    // OTOMASYON OZETI + FILTRE (2026-11-15): sayilar sunucu; komut kosmayan sunucu "dokunmadi", filtre listeyi daraltir.
    // 2026-11-17: uzun tanım paragrafı kaldırıldı ("uzun paragrafları kaldır")
    expect(screen.queryByText(/Sayılar/)).toBeNull();
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
    expect(screen.queryByRole('button', { name: /^ORJBOP18/ })).toBeNull();
    // v4: boş önce JBoss'u korumaz; sunucu "dokunulmadı" demez (bu eski kayıtta betik eski olduğu için işlem yoktu)
    expect(
      screen.getByText("JBoss 8 (AWX'teki betik eski — işlem yapılmadı)", { exact: false }),
    ).toBeTruthy();
    expect(screen.queryByText(/önce görüntüsü boş — dokunulmadı/)).toBeNull();
    expect(screen.getByText('1 sunucuda kontrol gerekli')).toBeTruthy();
    expect(
      screen.getByText(
        /reboot sonrası çalışan her ürün \(Nginx\/Apache\/IHS\/CTG\/JBoss\/WAS\) reboot öncesi haline \(kapalı\) döndürülür ve kontrol edilecek \(uygulamalar/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/yalnız web ürünleri/)).toBeNull();
    expect(screen.queryByText(/hiçbir şey açılıp kapatılmadı/)).toBeNull();
    expect(screen.getByText('Plan notları — neden dokunulmadı / nasıl sayıldı')).toBeTruthy();
    // inceleme B6: bos-once nedeni uyari satirinda yaziliyken plan notlarinda TEKRAR edilmez
    expect(
      screen.queryByText(
        'Reboot öncesi görüntüde izlenen ürün/JVM yoktu — reboot sonrası çalışan her ürün (Nginx/Apache/IHS/CTG/JBoss/WAS) reboot öncesi haline (kapalı) döndürülür ve kontrol edilecek.',
      ),
    ).toBeNull();
    // inceleme B6: sorunsuz + kontrol = toplam -> kirmizi degil uyari rengi
    expect((screen.getByText('1 / 2 sunucu sorunsuz') as HTMLElement).style.color).toBe(
      'var(--status-warning)',
    );
    expect(screen.getByText(/^JBoss 8 \/ appX: ürün reboot öncesi görüntüde yoktu/)).toBeTruthy();
    // v4 ("Her yerde kapat"): boş önce kapatma kapısı DEĞİL — hâlâ çalışan ürün ve JVM'i kapatılması gerekirdi (sorun);
    // "kapatma kapısı gereği dokunulmadı" denmez. Bu kayıtta betik sürümü yok -> neden kesin: AWX'teki betik eski.
    expect(
      screen.getByText(
        'şimdi çalışıyor — ürün reboot öncesi çalışmıyordu, ürünle birlikte kapanması gerekiyordu',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /^reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — .*AWX'teki betik eski \(sürüm yok\)/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        /kapatma kapısı gereği dokunulmadı|önce görüntüsü boş \/ eski sürüm, kapatılmadı/,
      ),
    ).toBeNull();
  });

  it('RT4 onay penceresi önce görüntüsü boş sunucuları listeler; "kontrol" kaydında yeniden çalıştırılabilir', async () => {
    AKTIF = BOS_KAYIT;
    sonraMock.mockClear();
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#4'));
    const dugme = await screen.findByRole('button', {
      name: /Reboot sonrası kontrol et ve düzelt/,
    });
    expect((dugme as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dugme);
    expect(await screen.findByText('Önce görüntüsü boş sunucular (1)')).toBeTruthy();
    expect(screen.getByText('ORBOS01', { selector: 'div.font-mono' })).toBeTruthy();
    // inceleme B8: JVM kurali yalniz urunu reboot oncesi calisanlar icin; durulma beklemesi soylenir
    expect(
      screen.getByText(/Ürünü reboot öncesi çalışmayanın JVM'leri ürünle birlikte kapanır/),
    ).toBeTruthy();
    // 2026-11-15 "nasil bulduysan oyle birak": once calismayan urun KAPATILIR - kalin uyari, domain/WAS/CTG her seyi kapatir
    expect(
      screen.getByText(
        /önce çalışmayan ürün çalışıyorsa kapatılır|çalışmayan ürün şimdi çalışıyorsa/,
      ),
    ).toBeTruthy();
    const uyari = screen.getByText('Dikkat: reboot öncesi çalışmayan ürün KAPATILIR.');
    expect(uyari.tagName).toBe('B');
    expect(uyari.parentElement?.textContent).toMatch(
      /JBoss domain'i .*WAS .*CTG kapatılınca üzerindeki her şey kapanır/,
    );
    expect(screen.getByText(/süreç listesinin durulması beklenir/)).toBeTruthy();
    // v4: boş önce görüntüsünde çalışan her ürün (prod dahil) kapatılır; kapatılan ürün "kontrol edilecek"
    expect(uyari.parentElement?.textContent).toMatch(
      /Önce görüntüsü boş olan sunucularda çalışan her ürün \(Nginx\/Apache\/IHS\/CTG\/JBoss\/WAS, prod dahil\) kapatılır;/,
    );
    expect(uyari.parentElement?.textContent).not.toMatch(/yalnız web|CTG\/JBoss\/WAS kapatılmaz/);
    expect(uyari.parentElement?.textContent).toMatch(
      /Otomasyonun kapattığı her ürün sonuçta kontrol edilecek/,
    );
    // 2026-11-22: tam uyarı yalnız onay penceresinde (önce bölümünde gri grup notu)
    expect(
      screen.getAllByText(
        /çalışan her ürünü \(Nginx\/Apache\/IHS\/CTG\/JBoss\/WAS, prod dahil\) kapatır; kapatılan her ürün kontrol edilecek/,
      ),
    ).toHaveLength(1);
    expect(
      screen.getByText(
        /Önce görüntüsünde izlenen ürün yok — uygulamalar zaten kapalıyken mi alındı\?/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/CTG, JBoss ve WAS'a dokunmaz/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve başlat' }));
    await waitFor(() => expect(sonraMock).toHaveBeenCalledWith(4));
  });

  it('RT5 durulma=error notu görünür; tümü sorunlu iken özet kırmızı', async () => {
    const s18 = { ...KAYIT.sonra.sonuc.sunucular.ORJBOP18, durulma: 'error' };
    AKTIF = {
      ...KAYIT,
      id: 5,
      sonra: {
        ...KAYIT.sonra,
        sonuc: { faz: 'sonra', sunucular: { ...KAYIT.sonra.sonuc.sunucular, ORJBOP18: s18 } },
      },
    } as typeof KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#5'));
    fireEvent.click(await screen.findByRole('button', { name: /^ORJBOP18/ }));
    expect(
      await screen.findByText(/JVM planı çalışmadı — JVM'ler açılıp kapatılmadı/),
    ).toBeTruthy();
    expect((screen.getByText('1 / 2 sunucu sorunsuz') as HTMLElement).style.color).toBe(
      'var(--status-danger)',
    );
  });
});

describe('Reboot Kontrolü sekmesi — v3 otomasyon filtresi, teknoloji çipleri, sürüm bandı', () => {
  it('RT6 özet kutuları (otomasyon 3 sınıf + son durum), iki grup AND filtre, teknoloji çipleri, eski betik bandı', async () => {
    AKTIF = OTO_KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#6'));
    await screen.findByRole('button', { name: /^ORA01/ });
    const kutu = (etiket: string) =>
      screen.getByText(etiket, { selector: 'div' }).previousElementSibling?.textContent;
    expect([
      kutu('Otomasyon başarılı'),
      kutu('Otomasyon başarısız'),
      kutu('Otomasyon dokunmadı'),
    ]).toEqual(['1', '1', '1']);
    expect([
      kutu('Sorunsuz'),
      kutu('Kontrol gerekli'),
      kutu('Sorun kaldı'),
      kutu('Karşılaştırma dışı'),
    ]).toEqual(['1', '1', '1', '0']);
    // teknoloji çipleri: çalıştırılan (yeşil ✓ / kırmızı ✗) ve çalıştırılmayan (neden)
    const a = screen.getByRole('button', { name: /^ORA01/ });
    expect(within(a).getByText('Otomasyon başarılı')).toBeTruthy();
    expect((within(a).getByText('Nginx: kapatıldı ✓') as HTMLElement).style.color).toBe(
      'var(--status-success)',
    );
    expect(within(a).getByText('çalıştırılmadı: Red Hat Apache (değişiklik yok)')).toBeTruthy();
    const b = screen.getByRole('button', { name: /^ORB02/ });
    expect(
      (within(b).getByText('JBoss 8: 3 JVM açıldı ✓, 1 JVM açılamadı ✗') as HTMLElement).style
        .color,
    ).toBe('var(--status-danger)');
    expect(
      within(screen.getByRole('button', { name: /^ORC03/ })).getByText(
        'çalıştırılmadı: IBM Apache (IHS) (değişiklik yok)',
      ),
    ).toBeTruthy();
    // sürüm bandı: yalnız betik_surum < 4 olan sunucu sayılır, tek bant
    const bant = screen
      .getAllByRole('alert')
      .filter((x) => /reboot_check betiği eski/.test(x.textContent || ''));
    expect(bant).toHaveLength(1);
    expect(bant[0].textContent).toMatch(/\(sürüm 2, gerekli 4\).*\(1 sunucuda etkili\)/);
    // ürün tablosu sunucu sürümünü kullanır: betik_surum 4 iken "eski betik olabilir" DENMEZ, kesin konuşulur
    expect(
      screen.getByText(
        'reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — otomasyon kapatma komutu çalıştırmadı (plandan sonra kalkmış olabilir; yeniden çalıştırın)',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/eski betik sürümü olabilir/)).toBeNull();
    // filtre: otomasyon Başarısız -> yalnız ORB02; son durum sayıları AND ile daralır
    const oto = screen.getByRole('group', { name: 'Otomasyon filtresi' });
    const son = screen.getByRole('group', { name: 'Son durum filtresi' });
    expect(
      within(oto)
        .getAllByRole('button')
        .map((x) => x.textContent),
    ).toEqual(['Tümü (3)', 'Başarılı (1)', 'Başarısız (1)', 'Dokunmadı (1)']);
    expect(
      within(son)
        .getAllByRole('button')
        .map((x) => x.textContent),
    ).toEqual([
      'Tümü (3)',
      'Sorunsuz (1)',
      'Kontrol gerekli (1)',
      'Sorun kaldı (1)',
      'Karşılaştırma dışı (0)',
    ]);
    fireEvent.click(within(oto).getByRole('button', { name: /^Başarısız/ }));
    expect(screen.getByRole('button', { name: /^ORB02/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^ORA01/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^ORC03/ })).toBeNull();
    expect(
      within(son)
        .getAllByRole('button')
        .map((x) => x.textContent),
    ).toEqual([
      'Tümü (1)',
      'Sorunsuz (0)',
      'Kontrol gerekli (0)',
      'Sorun kaldı (1)',
      'Karşılaştırma dışı (0)',
    ]);
    fireEvent.click(within(son).getByRole('button', { name: /^Sorun kaldı/ }));
    expect(screen.getByRole('button', { name: /^ORB02/ })).toBeTruthy();
    fireEvent.click(within(oto).getByRole('button', { name: /^Başarılı/ }));
    expect(screen.getByText('Bu filtrede sunucu yok.')).toBeTruthy();
    // eski filtreler kalktı
    expect(
      screen.queryByRole('button', { name: /Otomasyon işlem yaptı|Komutu başarısız/ }),
    ).toBeNull();
  });

  it('RT7 sonuç gelmeyen sunucu: otomasyon "başarısız" + kırmızı neden notu ("dokunmadı" denmez)', async () => {
    const k = structuredClone(OTO_KAYIT);
    const not = 'sunucudan sonuç gelmedi — otomasyonun ne yaptığı bilinmiyor (doğrulanamadı)';
    k.ozet.sonra.sunucu.ORC03 = {
      durum: 'olculemedi',
      kalan: 0,
      islem: 0,
      hatali: 0,
      otomasyon: { sinif: 'basarisiz', teknoloji: [], not },
    } as typeof k.ozet.sonra.sunucu.ORC03;
    AKTIF = k;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#6'));
    const c = await screen.findByRole('button', { name: /^ORC03/ });
    expect(within(c).getByText('Otomasyon başarısız')).toBeTruthy();
    expect((within(c).getByText(not) as HTMLElement).style.color).toBe('var(--status-danger)');
    expect(within(c).queryByText('Otomasyon dokunmadı')).toBeNull();
  });
});

describe('Reboot Kontrolü sekmesi — v4 karşılaştırma dışı, yönetici özeti, komut köprüsü', () => {
  it('RT8 önce görüntüsü boş (tek neden) uyarı DEĞİL: nötr "Karşılaştırma dışı" rozet/kutu/filtre; paydadan çıkar; bilgi notu uyarı ikonsuz', async () => {
    AKTIF = KD_KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#8'));
    const b = await screen.findByRole('button', { name: /^ORBOS02/ });
    const rozet = within(b).getByText('Karşılaştırma dışı');
    expect((rozet as HTMLElement).style.color).toBe('var(--text-muted)');
    expect(within(b).queryByText('Kontrol gerekli')).toBeNull();
    expect(within(b).getByText(/karşılaştırılacak bir şey yoktu/)).toBeTruthy();
    // üst özet: karşılaştırma dışı paydadan çıkar, ayrıca yazılır; yeşil
    expect((screen.getByText('1 / 1 sunucu sorunsuz') as HTMLElement).style.color).toBe(
      'var(--status-success)',
    );
    expect(screen.getByText('1 sunucu karşılaştırma dışı')).toBeTruthy();
    const kutu = (etiket: string) =>
      screen.getByText(etiket, { selector: 'div' }).previousElementSibling?.textContent;
    expect([kutu('Sorunsuz'), kutu('Kontrol gerekli'), kutu('Karşılaştırma dışı')]).toEqual([
      '1',
      '0',
      '1',
    ]);
    const son = screen.getByRole('group', { name: 'Son durum filtresi' });
    fireEvent.click(within(son).getByRole('button', { name: /^Karşılaştırma dışı \(1\)/ }));
    expect(screen.queryByRole('button', { name: /^ORJBOP18/ })).toBeNull();
    // kart kapalı açılır; önce-boş metni bilgi notu (gri), uyarı rengi değil
    fireEvent.click(screen.getByRole('button', { name: /^ORBOS02/ }));
    const not = screen.getByText(KD_BILGI);
    expect((not.parentElement as HTMLElement).style.color).toBe('var(--text-muted)');
    // plan notlarında BOS tekrar edilmez
    expect(screen.queryByText(/^Reboot öncesi görüntüde izlenen ürün\/JVM yoktu — /)).toBeNull();
  });

  it('RT9 yönetici özeti (sunucudan gelen oranlar, payda yanında, "—") ve sunucu↔komut köprüsü', async () => {
    AKTIF = KD_KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#8'));
    const y = await screen.findByRole('group', { name: 'Yönetici özeti' });
    const kart = (etiket: string) => within(y).getByText(etiket).parentElement?.textContent;
    // inceleme Y7: ana metriğin altında kontrol notlu / kontrol bekleyen / sorun kalan (Durum Raporu ile aynı)
    expect(kart('Bulunduğu gibi bırakıldı')).toBe(
      '%1001 / 1 sunucuBulunduğu gibi bırakıldıkontrol notlu 0 · kontrol bekleyen 0 · sorun kalan 0',
    );
    expect(kart('İlk sapmalardan kapatılan')).toBe('—0 / 0 öğeİlk sapmalardan kapatılan');
    // inceleme Y10: otomasyon oranının birimi komut
    expect(kart('Otomasyon başarı oranı')).toBe('%1001 / 1 komutOtomasyon başarı oranı');
    // 2026-11-17: yönetici paragrafı gösterilmez; köprü yalnız sayılar
    expect(
      within(y).queryByText('Kayıttaki 2 sunucunun 2 tanesinde reboot sonrası son durum ölçüldü.'),
    ).toBeNull();
    const kopru = screen.getByText(/^Komut bazında:/);
    expect(kopru.textContent).toBe(
      'Komut bazında: 1 başarılı · 0 başarısız · 2 gerek kalmadı · 0 başarılı ama hedefte değil (1 sunucuda 3 komut)',
    );
  });

  it('RT10 eski kayıt (yönetici özeti yok): kutu ve köprü gösterilmez; tümü karşılaştırma dışı iken özet gri', async () => {
    const k = structuredClone(KD_KAYIT) as typeof KD_KAYIT;
    delete (k.ozet.sonra as Partial<typeof k.ozet.sonra>).yonetici;
    k.ozet.sonra.sorunsuz = 0;
    k.ozet.sonra.toplam = 1;
    k.ozet.sonra.kapsamDisi = 1;
    k.durum = 'kontrol';
    AKTIF = k;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#8'));
    await screen.findByRole('button', { name: /^ORBOS02/ });
    expect(screen.queryByRole('group', { name: 'Yönetici özeti' })).toBeNull();
    expect(screen.queryByText(/^Komut bazında:/)).toBeNull();
    expect((screen.getByText('0 / 0 sunucu sorunsuz') as HTMLElement).style.color).toBe(
      'var(--text-muted)',
    );
  });

  it('RT11 inceleme Y3: komutu OK dönüp son durumu ölçülemeyen sayı köprüde ayrı yazılır', async () => {
    const k = structuredClone(KD_KAYIT) as typeof KD_KAYIT;
    (k.ozet.sonra.yonetici.komut as { okOlculemedi?: number }).okOlculemedi = 2;
    AKTIF = k;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#8'));
    const kopru = await screen.findByText(/^Komut bazında:/);
    expect(kopru.textContent).toMatch(/· 2 başarılı ama doğrulanamadı \(/);
  });

  it('RT12 inceleme Y7: kontrol notlu ama eski haline dönen sunucu "bırakıldı" sayılır; ana metrik altında kontrol notlu / bekleyen; eski kayıtta satır yok', async () => {
    const k = structuredClone(KD_KAYIT) as typeof KD_KAYIT;
    const yon = k.ozet.sonra.yonetici;
    Object.assign(yon.sunucu, {
      karsilastirilabilir: 3,
      sorunsuz: 1,
      kontrol: 1,
      sorunlu: 1,
      birakilan: 2,
      birakilanKontrolNotlu: 1,
      kontrolBekleyen: 0,
    });
    yon.oran.birakildi = { pay: 2, payda: 3, metin: '%66,7' };
    yon.metin =
      'Karşılaştırılabilen 3 sunucudan 2 tanesi reboot öncesi haliyle bırakıldı (%66,7) (bunlardan 1 tanesinde otomasyon fazladan çalışan ürünü kapattı; kontrol notu var); 1 sunucuda sorun kaldı.';
    AKTIF = k;
    const { unmount } = render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#8'));
    const y = await screen.findByRole('group', { name: 'Yönetici özeti' });
    const kart = (etiket: string) => within(y).getByText(etiket).parentElement?.textContent;
    expect(kart('Bulunduğu gibi bırakıldı')).toBe(
      '%66,72 / 3 sunucuBulunduğu gibi bırakıldıkontrol notlu 1 · kontrol bekleyen 0 · sorun kalan 1',
    );
    expect(within(y).queryByText(yon.metin)).toBeNull();
    unmount();
    // eski kayıt (Y7 alanları yok): ana metrik altı satır yazılmaz, kutu yine görünür
    const e = structuredClone(KD_KAYIT) as typeof KD_KAYIT;
    const es = e.ozet.sonra.yonetici.sunucu as Partial<typeof e.ozet.sonra.yonetici.sunucu>;
    delete es.birakilan;
    delete es.birakilanKontrolNotlu;
    delete es.kontrolBekleyen;
    AKTIF = e;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#8'));
    const y2 = await screen.findByRole('group', { name: 'Yönetici özeti' });
    expect(within(y2).getByText('Bulunduğu gibi bırakıldı').parentElement?.textContent).toBe(
      '%1001 / 1 sunucuBulunduğu gibi bırakıldı',
    );
    expect(within(y2).queryByText(/kontrol notlu/)).toBeNull();
  });
});

describe('Reboot Kontrolü sekmesi — betik eski etkiye göre (2026-11-16)', () => {
  it('RT13 sürüm 3: bant yalnız boş önce + çalışan CTG/JBoss/WAS sunucusu sayısıyla; dolu önce sunucusunda "betik eski" yok', async () => {
    const v = ['BOOT|x2||', 'SURUM|2||'];
    const k = {
      ...KAYIT,
      id: 13,
      hosts: ['ORD01', 'ORW02', 'ORJ03'],
      durum: 'sorunlu',
      once: {
        jobId: 1,
        serverId: 1,
        at: '2026-11-16T01:00:00Z',
        sonuc: {
          faz: 'once',
          sunucular: {
            ORD01: { goruntu_ok: true, goruntu: ['BOOT|d1||', 'SURUM|2||', 'URUN|RHA||'] },
            ORW02: { goruntu_ok: true, goruntu: ['BOOT|w1||'] },
            ORJ03: { goruntu_ok: true, goruntu: ['BOOT|j1||'] },
          },
        },
      },
      sonra: {
        jobId: 2,
        serverId: 1,
        at: '2026-11-16T03:00:00Z',
        sonuc: {
          faz: 'sonra',
          sunucular: {
            // dolu önce: IHS yeni ve hâlâ çalışıyor -> sürüm 3 bunu kapatırdı; "betik eski" DENMEZ
            ORD01: {
              once_var: true,
              son_olculdu: true,
              son_fark: [],
              betik_surum: 3,
              goruntu: [...v, 'URUN|RHA||', 'URUN|IHS||'],
              son_goruntu: [...v, 'URUN|RHA||', 'URUN|IHS||'],
              islemler: [],
            },
            ORW02: {
              once_var: true,
              son_olculdu: true,
              son_fark: [],
              betik_surum: 3,
              goruntu: [...v, 'URUN|NGINX||'],
              son_goruntu: v,
              islemler: ['SONUC|durdur|NGINX||OK|x'],
            },
            ORJ03: {
              once_var: true,
              son_olculdu: true,
              son_fark: [],
              betik_surum: 3,
              goruntu: [...v, 'URUN|JBOSS8||'],
              son_goruntu: [...v, 'URUN|JBOSS8||'],
              islemler: [],
            },
          },
        },
      },
      ozet: {
        once: { alinan: 3, toplam: 3, job: 'successful' },
        sonra: {
          sorunsuz: 0,
          kontrol: 1,
          toplam: 3,
          job: 'successful',
          sunucu: {
            ORD01: { durum: 'sorunlu', kalan: 1, islem: 0, hatali: 0 },
            ORW02: { durum: 'kontrol', kalan: 0, islem: 1, hatali: 0 },
            ORJ03: { durum: 'sorunlu', kalan: 1, islem: 0, hatali: 0 },
          },
        },
      },
    };
    AKTIF = k as unknown as typeof KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#13'));
    await screen.findByRole('button', { name: /^ORJ03/ });
    const bant = screen
      .getAllByRole('alert')
      .filter((x) => /reboot_check betiği eski/.test(x.textContent || ''));
    expect(bant).toHaveLength(1);
    expect(bant[0].textContent).toMatch(
      /\(sürüm 3, gerekli 4\): bu koşudaki betik \(sürüm 3\).*\(1 sunucuda etkili\)$/,
    );
    // ürün tablosu ürün bazında: JBoss 8 (boş önce, sürüm 3 kapatmaz) "betik eski"; IHS (dolu önce) güncel dil
    expect(
      screen.getByText(
        "reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — otomasyon kapatmadı — AWX'teki betik eski (sürüm 3); güncel betikle yeniden çalıştırın",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — otomasyon kapatma komutu çalıştırmadı (plandan sonra kalkmış olabilir; yeniden çalıştırın)',
      ),
    ).toBeTruthy();
  });
  it('RT14 inceleme B1/B2: önce görüntüsü alınamamış (goruntu_ok=false) ve yalnız ilk görüntüde çalışan sunucu bantta sayılmaz', async () => {
    const v = ['BOOT|x2||', 'SURUM|2||'];
    const k = {
      ...KAYIT,
      id: 14,
      hosts: ['ORX01', 'ORY02', 'ORJ03'],
      durum: 'sorunlu',
      once: {
        jobId: 1,
        serverId: 1,
        at: '2026-11-16T01:00:00Z',
        sonuc: {
          faz: 'once',
          sunucular: {
            ORX01: { goruntu_ok: false, goruntu: ['BOOT|x1||'] },
            ORY02: { goruntu_ok: true, goruntu: ['BOOT|y1||'] },
            ORJ03: { goruntu_ok: true, goruntu: ['BOOT|j1||'] },
          },
        },
      },
      sonra: {
        jobId: 2,
        serverId: 1,
        at: '2026-11-16T03:00:00Z',
        sonuc: {
          faz: 'sonra',
          sunucular: {
            ORX01: {
              once_var: true,
              son_olculdu: true,
              son_fark: [],
              betik_surum: 3,
              goruntu: [...v, 'URUN|CTG||'],
              son_goruntu: [...v, 'URUN|CTG||'],
              islemler: [],
              plan: ['BILGI|HATA|||once yok'],
            },
            ORY02: {
              once_var: true,
              son_olculdu: true,
              son_fark: [],
              betik_surum: 3,
              goruntu: [...v, 'URUN|WAS||'],
              son_goruntu: v,
              islemler: [],
            },
            ORJ03: {
              once_var: true,
              son_olculdu: true,
              son_fark: [],
              betik_surum: 3,
              goruntu: [...v, 'URUN|JBOSS8||'],
              son_goruntu: [...v, 'URUN|JBOSS8||'],
              islemler: [],
            },
          },
        },
      },
      ozet: {
        once: { alinan: 2, toplam: 3, job: 'successful' },
        sonra: {
          sorunsuz: 0,
          kontrol: 2,
          toplam: 3,
          job: 'successful',
          sunucu: {
            ORX01: { durum: 'kontrol', kalan: 0, islem: 0, hatali: 0 },
            ORY02: { durum: 'kontrol', kalan: 0, islem: 0, hatali: 0 },
            ORJ03: { durum: 'sorunlu', kalan: 1, islem: 0, hatali: 0 },
          },
        },
      },
    };
    AKTIF = k as unknown as typeof KAYIT;
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#14'));
    await screen.findByRole('button', { name: /^ORJ03/ });
    const bant = screen
      .getAllByRole('alert')
      .filter((x) => /reboot_check betiği eski/.test(x.textContent || ''));
    expect(bant).toHaveLength(1);
    expect(bant[0].textContent).toMatch(
      /\(sürüm 3, gerekli 4\): bu koşudaki betik \(sürüm 3\).*\(1 sunucuda etkili\)$/,
    );
    // ürün tablosu da aynı önce kaynağından: ORX01'in CTG satırı "betik eski" demez, yalnız ORJ03'ün JBoss 8 satırı der
    expect(
      screen.getAllByText(
        "reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — otomasyon kapatmadı — AWX'teki betik eski (sürüm 3); güncel betikle yeniden çalıştırın",
      ),
    ).toHaveLength(1);
    expect(
      screen.getByText(
        'reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — otomasyon kapatma komutu çalıştırmadı (plandan sonra kalkmış olabilir; yeniden çalıştırın)',
      ),
    ).toBeTruthy();
  });
});

describe('Reboot Kontrolü sekmesi — AWX alımı, Yenile, yükleniyor (2026-11-21)', () => {
  it('RT15 alım notu: şablon, son tarama, alınan iş ve alınmama nedeni görünür; şablon yoksa uyarı', async () => {
    alimMock.mockClear();
    const { unmount } = render(<RebootKontroluTab />);
    const not = await screen.findByTestId('rc-awx-alim');
    expect(not.textContent).toMatch(/Maestro2 · şablon #77/);
    expect(not.textContent).toMatch(/son 7 günde 2 biten iş/);
    expect(not.textContent).toMatch(/iş #501: kayıt #3 \(önce\) olarak alındı/);
    expect(not.textContent).toMatch(/iş #502: alınmadı — Portal'dan başlatılmış/);
    expect(alimMock).toHaveBeenCalledWith(undefined);
    unmount();
    const eski = ALIM;
    ALIM = {
      aralikSn: 120,
      geriGun: 7,
      sonTarama: '2026-11-21T09:00:00Z',
      sablon: null,
      neden: 'template_yok',
      hata: null,
      bulunan: null,
      isler: [],
    };
    render(<RebootKontroluTab />);
    expect((await screen.findByTestId('rc-awx-alim')).textContent).toMatch(
      /reboot_check şablonu tanımlı değil/,
    );
    ALIM = eski;
  });

  it('RT16 Yenile AWX’i hemen taratır (tara=1), beklerken döner ve devre dışı; kayıtlar tazelenir', async () => {
    alimMock.mockClear();
    render(<RebootKontroluTab />);
    await screen.findByTestId('rc-awx-alim');
    const listeOnce = vi.mocked(rebootCheckApi.list).mock.calls.length;
    let birak: () => void = () => {};
    alimMock.mockImplementationOnce(async () => {
      await new Promise<void>((r) => {
        birak = r;
      });
      return {
        ok: true,
        durum: {
          ...(ALIM as object),
          isler: [{ jobId: 600, sonuc: 'atlandi', neden: 'set_stats_yok', zaman: 'x' }],
        },
      };
    });
    const dugme = screen.getByRole('button', { name: /Yenile/ });
    fireEvent.click(dugme);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Yenileniyor/ })).toHaveProperty('disabled', true),
    );
    expect(alimMock).toHaveBeenLastCalledWith(true);
    birak();
    await waitFor(() =>
      expect(screen.getByTestId('rc-awx-alim').textContent).toMatch(
        /iş #600: alınmadı — İşte reboot_check_result yok/,
      ),
    );
    await waitFor(() =>
      expect(vi.mocked(rebootCheckApi.list).mock.calls.length).toBeGreaterThan(listeOnce),
    );
    expect(screen.getByRole('button', { name: /^.*Yenile$/ })).toHaveProperty('disabled', false);
  });

  it('RT17 kayda tıklanınca yüklenirken satırda döner ve ayrıntıda "yükleniyor" yazar', async () => {
    AKTIF = KAYIT;
    let birak: () => void = () => {};
    getBekle = new Promise<void>((r) => {
      birak = r;
    });
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#3'));
    expect((await screen.findByTestId('rc-kayit-yukleniyor')).textContent).toMatch(
      /Kayıt #3 yükleniyor/,
    );
    expect(screen.getByText('#3').closest('button')?.getAttribute('aria-busy')).toBe('true');
    birak();
    getBekle = null;
    await screen.findByText('2 ürün kaydedildi');
    expect(screen.queryByTestId('rc-kayit-yukleniyor')).toBeNull();
    expect(screen.getByText('#3').closest('button')?.getAttribute('aria-busy')).toBe('false');
  });

  it('RT18 inceleme: Yenile AWX alımı düşse de kayıtları tazeler; tarama sürerken not "taranıyor" der', async () => {
    alimMock.mockClear();
    alimMock.mockImplementationOnce(async () => ({
      ok: true,
      durum: { ...(ALIM as object), tariyor: true },
    }));
    render(<RebootKontroluTab />);
    expect((await screen.findByTestId('rc-awx-alim')).textContent).toMatch(/taranıyor/);
    const listeOnce = vi.mocked(rebootCheckApi.list).mock.calls.length;
    alimMock.mockImplementationOnce(async () => {
      throw new Error('AWX zaman asimi');
    });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() =>
      expect(vi.mocked(rebootCheckApi.list).mock.calls.length).toBeGreaterThan(listeOnce),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Yenile/ })).toHaveProperty('disabled', false),
    );
  });

  it('RT19 inceleme: koşan kaydın sessiz yoklaması, yeni tıklanan kaydı geri almaz', async () => {
    const KOSAN = { ...KAYIT, id: 11, durum: 'sonra_kosuyor' };
    const DIGER = { ...KAYIT, id: 12, durum: 'tamam', not: 'diger kayit' };
    vi.mocked(rebootCheckApi.list).mockImplementation(
      async () => ({ ok: true, kayitlar: [KOSAN, DIGER] }) as never,
    );
    let digerBirak: () => void = () => {};
    vi.mocked(rebootCheckApi.get).mockImplementation(async (id: number) => {
      if (id === 12)
        await new Promise<void>((r) => {
          digerBirak = r;
        });
      return { ok: true, kayit: id === 11 ? KOSAN : DIGER } as never;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<RebootKontroluTab />);
      fireEvent.click(await screen.findByText('#11'));
      await waitFor(() => expect(vi.mocked(rebootCheckApi.get)).toHaveBeenCalledWith(11));
      fireEvent.click(screen.getByText('#12'));
      // #12 yanıtı gelmeden 5 sn yoklaması çalışır: #11'i sessizce okumaya çalışmamalı, seçimi geri almamalı.
      const getOnce = vi.mocked(rebootCheckApi.get).mock.calls.length;
      await vi.advanceTimersByTimeAsync(5200);
      expect(
        vi
          .mocked(rebootCheckApi.get)
          .mock.calls.slice(getOnce)
          .some((c) => c[0] === 11),
      ).toBe(false);
      digerBirak();
      await waitFor(() =>
        expect(screen.getByText('#12').closest('button')?.getAttribute('aria-busy')).toBe('false'),
      );
      await waitFor(() => expect(screen.queryByTestId('rc-kayit-yukleniyor')).toBeNull());
      expect(screen.getAllByText(/diger kayit/).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
      vi.mocked(rebootCheckApi.list).mockImplementation(
        async () => ({ ok: true, kayitlar: [AKTIF] }) as never,
      );
      vi.mocked(rebootCheckApi.get).mockImplementation(async () => {
        if (getBekle) await getBekle;
        return { ok: true, kayit: AKTIF } as never;
      });
    }
  });
});

describe('Reboot Kontrolü sekmesi — boş önce grubu (2026-11-22)', () => {
  it('RT20 grup duruma göre: sonra öncesi gelecek zaman + yeniden al; hepsi boşsa açık uyarı; görüntü alınırken gruplanmaz', async () => {
    const kayit = (id: number, durum: string, sunucular: Record<string, unknown>) =>
      ({
        ...BOS_KAYIT,
        id,
        durum,
        hosts: Object.keys(sunucular),
        once: { ...BOS_KAYIT.once, sonuc: { faz: 'once', sunucular } },
        sonra: { jobId: null, serverId: null, at: null, sonuc: null },
        ozet: null,
      }) as never;
    const BOS = { goruntu_ok: true, goruntu: ['BOOT|z1||'] };
    // A) karışık kayıt (2 boş + 1 dolu), reboot sonrası kontrol henüz koşmadı: kapalı, gri, gelecek zaman + yeniden al
    AKTIF = kayit(20, 'once_hazir', {
      ORBOS01: BOS,
      ORBOS03: BOS,
      ORJBOP18: { goruntu_ok: true, goruntu: O18 },
    });
    let r = render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#20'));
    let grup = await screen.findByTestId('rc-once-bos-grup');
    expect((grup as HTMLDetailsElement).open).toBe(false);
    expect(
      within(grup).getByText(/kapatıp reboot öncesi haline döndürür ve "Kontrol gerekli" diye/),
    ).toBeTruthy();
    expect(
      within(grup).getByText(/reboot sonrası kontrolden önce görüntüyü yeniden alın/),
    ).toBeTruthy();
    expect(within(grup).queryByText(/"kontrol edilecek"/)).toBeNull();
    r.unmount();
    // B) kayıttaki TÜM sunucular boş: kart ızgarası yok, grup açık ve uyarı renginde, tam uyarı metni
    AKTIF = kayit(21, 'once_hazir', { ORBOS01: BOS, ORBOS03: BOS });
    r = render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#21'));
    grup = await screen.findByTestId('rc-once-bos-grup');
    expect((grup as HTMLDetailsElement).open).toBe(true);
    expect(grup.style.borderColor).toBe('var(--status-warning)');
    expect(
      within(grup).getByText(
        /Kayıttaki sunucuların hiçbirinde izlenen ürün çalışmıyordu\. Önce görüntüsünde izlenen ürün yok — uygulamalar zaten kapalıyken mi alındı\?/,
      ),
    ).toBeTruthy();
    expect(within(grup).getByText('ORBOS01')).toBeTruthy();
    expect(within(grup).getByText('ORBOS03')).toBeTruthy();
    expect(screen.queryByText('ORBOS01', { selector: 'summary span' })).toBeNull();
    expect(screen.queryByText('ORBOS03', { selector: 'summary span' })).toBeNull();
    r.unmount();
    // C) tek sunuculu boş kayıt "hepsi boş" uyarısına girmez (tek sunucu ayırt edici değil)
    AKTIF = kayit(22, 'once_hazir', { ORBOS01: BOS });
    r = render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#22'));
    grup = await screen.findByTestId('rc-once-bos-grup');
    expect((grup as HTMLDetailsElement).open).toBe(false);
    r.unmount();
    // D) önce koşarken: grup yok, her sunucunun kendi "alınıyor" kartı var
    AKTIF = kayit(23, 'once_kosuyor', { ORBOS01: BOS, ORBOS03: BOS });
    render(<RebootKontroluTab />);
    fireEvent.click(await screen.findByText('#23'));
    expect(await screen.findByText('ORBOS03', { selector: 'summary span' })).toBeTruthy();
    expect(screen.queryByTestId('rc-once-bos-grup')).toBeNull();
    AKTIF = KAYIT;
  });
});
