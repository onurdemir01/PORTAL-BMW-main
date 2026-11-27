// src/components/__tests__/IntranetSpaPage.test.tsx — Nginx ARK SPA > Intranet SPA geçiş takvimi (2026-11-27).
//
// Kullanıcı: "tek görmek istediğim şey şu: set, gecis_tarihi, sira, ekip, ekip_eposta, namespace,
// uygulama, route_adresleri, dynatrace_durumu, dynatrace_istek, aciklama. Ayrıca geçiş tarihini bu
// sayfadan admin olarak düzeltebilmek istiyorum." İkinci istek: her uygulama DC başına bir satır; set
// planı (tarih, DC, eski / yeni IP) Admin tarafından düzenlenir; set ilerlemesi DC başına hesaplanır.
//   IT1 uygulama listesi yalnız 11 sütun, bu sırayla; Pilot, Set 1..N ve set içinde sıra; tarih
//       "gg.aa.yyyy Gün"; set kartı yok, tek set görünümü (Set ilerlemesi)
//   IT2 süzgeç: set ilerlemesi satırına tıklama / set seçimi, ekip, metin arama; CSV aynı 11 sütun
//   IT3 Admin olmayan salt okur: düzenleme / yükleme düğmesi ve açıklama kutusu yok
//   IT3b Admin açıklama: yalnız canlı satırda; kutu canlı notu taşır, liste açıklaması yer tutucu;
//       canlı ns / app yazımıyla ve uygulama beyanı (inUse) değişmeden gider; not silinebilir;
//       uygulamanın iki DC satırı birlikte güncellenir
//   IT4 Admin tek satır tarih: anahtar (set, ns, app), beklenenSurum ile gider; yanıt yalnız o satırı
//       günceller (aynı uygulamanın diğer DC satırı değişmez); 409 listeyi tazeler
//   IT5 Admin set tarihi (set planından): onay adımı "Set N: X uygulamanın geçiş tarihi ... olacak";
//       setin her satırının sürümü gider; yanıt planı ve satırları günceller
//   IT5b farklı tarihli uygulamalar "bu tarihe al" ile toplanır; yalnız DC / IP değişikliği onaysız
//       gider; 409 listeyi tazeler
//   IT6 Admin takvim CSV yükleme: önizleme (set özeti, fark, elle düzeltme kaybı, uyarılar, hatalar);
//       hatalıysa onay pasif; onay yükleme kilidiyle gider; sınır üstü dosya gönderilmez
//   IT6b Admin set planı CSV yükleme: önizleme (setler, fark, "Set N: X uygulamanın tarihi
//       değişecek", elle kaybı), onay kilitle gider, liste tazelenir
//   IT7 bantlar: yükleniyor, canlı rapor alınamadı, takvim boş (Admin / değil), takvimde yok sayacı
//   IT10 paket kurulumu bölümü bağlı (bileşen kendi testinde), listenin altında
//   IT8 yardımcılar: tarihGoster, takvimSirala (Set 10 > Set 2), satirAnahtari, suzTakvim,
//       takvimCsvSatirlari (formül etkisizleştirme)
//   IT9 set ilerlemesi hesabı: DC başına pay ve kümülatif (bir ondalık, Türkçe virgül), plan sırası,
//       plan yok / DC belirtilmemiş, uygulaması 0 olan set, farklı tarih, durum sınırı bugün
//       (PORTAL_TZ), CSV (formülsüz)
//   IT9b ekranda set ilerlemesi: DC grupları, sütunlar, durum bugüne göre, CSV indirme
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ContextType, ReactElement } from 'react';
import { render } from '@/test/test-utils';
import { AuthContext } from '@/contexts/AuthContext';
import IntranetSpaPage from '@/components/IntranetSpaPage';
import {
  ILERLEME_CSV_BASLIK,
  TAKVIM_CSV_BASLIK,
  ilerlemeCsvSatirlari,
  satirAnahtari,
  setIlerlemesi,
  suzTakvim,
  takvimCsvSatirlari,
  takvimSirala,
  tarihGoster,
} from '@/components/intranetSpa';
import type { TakvimPlanSatir, TakvimSatir, TakvimYanit } from '@/api/arkSpaApi';
import { toast } from '@/hooks/useToast';
import { downloadCsv } from '@/utils/csv';
import { fmtOran, fmtYuzde, portalGunu } from '@/utils/datetime';

const api = vi.hoisted(() => ({
  takvim: vi.fn(),
  onizle: vi.fn(),
  yukle: vi.fn(),
  tarih: vi.fn(),
  set: vi.fn(),
  planOnizle: vi.fn(),
  planYukle: vi.fn(),
  beyan: vi.fn(),
}));
vi.mock('@/api/arkSpaApi', () => ({
  arkSpaApi: {
    takvim: api.takvim,
    takvimOnizle: api.onizle,
    takvimYukle: api.yukle,
    takvimTarih: api.tarih,
    takvimSet: api.set,
    planOnizle: api.planOnizle,
    planYukle: api.planYukle,
    intranetBeyan: api.beyan,
  },
}));
vi.mock('@/utils/csv', () => ({ downloadCsv: vi.fn() }));
// Paket kurulumu kendi testinde (IntranetPaketKurulum.test.tsx, Admin kapısı dahil); burada yalnız
// sayfaya bağlı olduğu ve takvim listesinin altında durduğu sınanır (IT10).
vi.mock('@/components/IntranetPaketKurulum', () => ({
  default: () => <section aria-label="Paket kurulumu (sahte)" />,
}));

const KAYNAK = {
  ekip: 'liste',
  ekipEposta: 'liste',
  routeAdresleri: 'liste',
  dynatrace: 'liste',
  aciklama: 'liste',
} as const;
const S = (uygulama: string, o: Partial<TakvimSatir> = {}): TakvimSatir => ({
  set: 'Set 1',
  setSira: 1,
  gecisTarihi: '2026-12-03',
  sira: 1,
  ekip: 'ornek-ekip',
  ekipEposta: 'ekip@ornek.example',
  namespace: 'ns-a-prod',
  uygulama,
  routeAdresleri: `${uygulama}.ornek.example`,
  dynatraceDurumu: 'istek alıyor',
  dynatraceIstek: '120',
  aciklama: '',
  kaynak: { ...KAYNAK },
  canli: false,
  canliNot: null,
  listeAciklama: '',
  canliNamespace: null,
  canliUygulama: null,
  inUse: null,
  surum: 1,
  guncelleyen: null,
  guncelleme: null,
  ...o,
});
const P = (
  set: string,
  setSira: number,
  gecisTarihi: string,
  dc: string,
  o: Partial<TakvimPlanSatir> = {},
): TakvimPlanSatir => ({
  set,
  setSira,
  gecisTarihi,
  dc,
  eskiIp: '192.0.2.41',
  yeniIp: '192.0.2.42',
  surum: 1,
  guncelleyen: null,
  guncelleme: null,
  ...o,
});
const yanit = (rows: TakvimSatir[], o: Partial<TakvimYanit> = {}): TakvimYanit => ({
  ok: true,
  yukleme: { id: 'yk-1', yukleyen: 'admin', zaman: '2026-11-27T10:00:00', kilit: 'yk-1:4:4' },
  rows,
  plan: [],
  takvimdeYok: [],
  canli: { durum: 'var', message: '', kesifTarihi: null, dynatraceOkunamadi: false },
  ...o,
});
const ORNEK = [
  S('app-3', { set: 'Set 2', setSira: 2, gecisTarihi: '2026-12-08', sira: 1, ekip: 'ekip-b' }),
  S('app-2', { sira: 2 }),
  S('app-1', { sira: 1 }),
  S('app-p', { set: 'Pilot', setSira: 0, gecisTarihi: '2026-12-01', sira: 1, ekip: 'ekip-b' }),
];

function ciz(ui: ReactElement, role?: string) {
  if (!role) return render(ui);
  const deger = { user: { username: 'onur', role } } as unknown as ContextType<typeof AuthContext>;
  return render(<AuthContext.Provider value={deger}>{ui}</AuthContext.Provider>);
}
const liste = () => screen.getByRole('table', { name: 'Uygulama listesi' });
const ilerleme = () => screen.getByRole('table', { name: 'Set ilerlemesi tablosu' });
const govdeSatirlari = () => within(liste()).getAllByRole('row').slice(1);
const uygulamaSirasi = () =>
  govdeSatirlari().map((tr) => within(tr).getAllByRole('cell')[6].textContent);
/** Set ilerlemesi tablosunda setin satırı (set adı düğmesinden). */
const ilerlemeSatiri = (set: string) =>
  within(ilerleme()).getByRole('button', { name: set }).closest('tr') as HTMLElement;
const hucreler = (tr: HTMLElement) =>
  within(tr)
    .getAllByRole('cell')
    .map((c) => c.textContent);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(toast, 'error').mockImplementation(() => '');
  vi.spyOn(toast, 'success').mockImplementation(() => '');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('IntranetSpaPage — geçiş takvimi', () => {
  it('IT1 yalnız 11 sütun bu sırayla; Pilot, Set 1..N, set içinde sıra; tarih gün adıyla', async () => {
    api.takvim.mockResolvedValue(yanit(ORNEK));
    ciz(<IntranetSpaPage />);
    await screen.findByText('app-p');
    const basliklar = within(liste())
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(basliklar).toEqual([...TAKVIM_CSV_BASLIK]);
    expect(basliklar).toEqual([
      'set',
      'gecis_tarihi',
      'sira',
      'ekip',
      'ekip_eposta',
      'namespace',
      'uygulama',
      'route_adresleri',
      'dynatrace_durumu',
      'dynatrace_istek',
      'aciklama',
    ]);
    expect(uygulamaSirasi()).toEqual(['app-p', 'app-1', 'app-2', 'app-3']);
    const ilk = within(govdeSatirlari()[0]).getAllByRole('cell');
    expect(ilk[0]).toHaveTextContent('Pilot');
    expect(ilk[1]).toHaveTextContent('01.12.2026 Salı');
    expect(ilk[8]).toHaveTextContent('istek alıyor');
    expect(ilk[9]).toHaveTextContent('120');
    // Kaynak ipucu: değerin nereden geldiği hücrede görünür.
    expect(ilk[3]).toHaveAttribute('title', 'yüklenen listeden');
    // Eski bölümler yok: set kartları da yok (tek set görünümü: Set ilerlemesi).
    for (const eski of [
      /kurulum/i,
      /Ekip Beyanı/i,
      /Değerlendirme/i,
      /Eksik sunucu/i,
      /Paket/i,
      /Kapatma adayı/i,
    ])
      expect(screen.queryByText(eski)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Setler' })).toBeNull();
    expect(screen.queryByText('Setin tarihini değiştir')).toBeNull();
    expect(screen.queryByRole('button', { name: /PROD|TEST|Tümü/ })).toBeNull();
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('IT2 süzgeç (ilerleme satırı, ekip, arama) ve CSV aynı 11 sütun', async () => {
    api.takvim.mockResolvedValue(yanit(ORNEK));
    ciz(<IntranetSpaPage />);
    await screen.findByText('app-p');
    // satırın herhangi bir hücresine tıklamak seti seçer, ikinci tıklama kaldırır
    fireEvent.click(within(ilerlemeSatiri('Set 1')).getAllByRole('cell')[5]);
    expect(uygulamaSirasi()).toEqual(['app-1', 'app-2']);
    expect(ilerlemeSatiri('Set 1')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Set')).toHaveValue('Set 1');
    fireEvent.click(within(ilerleme()).getByRole('button', { name: 'Set 1' }));
    expect(uygulamaSirasi()).toHaveLength(4);
    expect(screen.getByLabelText('Set')).toHaveValue('all');
    fireEvent.change(screen.getByLabelText('Set'), { target: { value: 'Set 2' } });
    expect(uygulamaSirasi()).toEqual(['app-3']);
    fireEvent.change(screen.getByLabelText('Set'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Ekip'), { target: { value: 'ekip-b' } });
    expect(uygulamaSirasi()).toEqual(['app-p', 'app-3']);
    fireEvent.change(screen.getByLabelText('Ara'), { target: { value: 'APP-3' } });
    expect(uygulamaSirasi()).toEqual(['app-3']);
    fireEvent.click(screen.getByRole('button', { name: /^CSV \(1\)/ }));
    expect(downloadCsv).toHaveBeenCalledWith('intranet_spa_gecis_takvimi', TAKVIM_CSV_BASLIK, [
      [
        'Set 2',
        '08.12.2026 Salı',
        '1',
        'ekip-b',
        'ekip@ornek.example',
        'ns-a-prod',
        'app-3',
        'app-3.ornek.example',
        'istek alıyor',
        '120',
        '',
      ],
    ]);
  });

  it('IT3 Admin olmayan salt okur: düzenleme, yükleme ve açıklama kutusu yok', async () => {
    api.takvim.mockResolvedValue(
      yanit(
        [S('app-1', { canli: true, inUse: 'yes', aciklama: 'eski not', canliNot: 'eski not' })],
        { plan: [P('Set 1', 1, '2026-12-03', 'DC-A')] },
      ),
    );
    ciz(<IntranetSpaPage />, 'User');
    await screen.findByText('app-1');
    expect(screen.queryByRole('button', { name: /Takvim yükle/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Set planı yükle/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /geçiş tarihini düzenle/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /planını düzenle/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /açıklama/ })).toBeNull();
    expect(screen.getByText('eski not')).toBeInTheDocument();
  });

  it('IT3b Admin açıklama: canlı not, liste yer tutucu, canlı yazım, inUse değişmez', async () => {
    const canli = {
      canli: true,
      inUse: 'yes',
      aciklama: 'liste notu',
      canliNot: '',
      listeAciklama: 'liste notu',
      canliNamespace: 'ns-a-prod',
      canliUygulama: 'app-1',
    };
    api.takvim.mockResolvedValue(
      yanit([
        S('APP-1', canli),
        S('APP-1', { ...canli, set: 'Set 8', setSira: 8, gecisTarihi: '2026-12-19' }),
        S('app-2', { aciklama: 'yalniz liste', listeAciklama: 'yalniz liste' }),
      ]),
    );
    api.beyan.mockResolvedValue({ ok: true });
    ciz(<IntranetSpaPage />, 'Admin');
    await screen.findByText('app-2');
    // canlıda olmayan satır düz metin
    expect(screen.queryByLabelText('Set 1 app-2 açıklama')).toBeNull();
    const kutu = screen.getByLabelText('Set 1 APP-1 açıklama') as HTMLInputElement;
    // liste metni kutunun DEĞERİ değil: odaklanıp çıkmak liste metnini nota çevirmez
    expect(kutu.value).toBe('');
    expect(kutu).toHaveAttribute('placeholder', 'liste notu');
    fireEvent.blur(kutu, { target: { value: '' } });
    expect(api.beyan).not.toHaveBeenCalled();
    fireEvent.blur(kutu, { target: { value: 'yeni not' } });
    await waitFor(() =>
      expect(api.beyan).toHaveBeenCalledWith({
        namespace: 'ns-a-prod',
        application: 'app-1',
        inUse: 'yes',
        note: 'yeni not',
      }),
    );
    // Aynı uygulamanın diğer DC satırı da aynı notu gösterir (tek uygulama notu).
    await waitFor(() =>
      expect(screen.getByLabelText('Set 8 APP-1 açıklama')).toHaveValue('yeni not'),
    );
    // Değişmeyen değer gönderilmez.
    fireEvent.blur(screen.getByLabelText('Set 1 APP-1 açıklama'), {
      target: { value: 'yeni not' },
    });
    expect(api.beyan).toHaveBeenCalledTimes(1);
    // Not silinebilir: boş not gider, hücre listedeki açıklamaya döner.
    fireEvent.blur(screen.getByLabelText('Set 1 APP-1 açıklama'), { target: { value: '' } });
    await waitFor(() => expect(api.beyan).toHaveBeenCalledTimes(2));
    expect(api.beyan.mock.calls[1][0]).toMatchObject({ note: '' });
    await waitFor(() =>
      expect(screen.getByLabelText('Set 1 APP-1 açıklama').closest('td')).toHaveAttribute(
        'title',
        'yüklenen listeden',
      ),
    );
  });

  it('IT4 Admin tek satır tarih: anahtar set dahil; diğer DC satırı değişmez; 409 tazeler', async () => {
    api.takvim.mockResolvedValue(
      yanit([
        S('app-1', { surum: 4 }),
        S('app-1', { set: 'Set 8', setSira: 8, gecisTarihi: '2026-12-19', surum: 2 }),
      ]),
    );
    api.tarih.mockResolvedValueOnce({
      ok: true,
      rows: [
        {
          set: 'Set 1',
          setSira: 1,
          gecisTarihi: '2026-12-04',
          sira: 1,
          namespace: 'ns-a-prod',
          uygulama: 'app-1',
          surum: 5,
          guncelleyen: 'onur',
          guncelleme: null,
        },
      ],
    });
    ciz(<IntranetSpaPage />, 'Admin');
    await screen.findAllByText('app-1');
    fireEvent.click(screen.getByRole('button', { name: 'Set 1 app-1 geçiş tarihini düzenle' }));
    expect(within(liste()).getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Set 1 app-1 geçiş tarihi'), {
      target: { value: '2026-12-04' },
    });
    fireEvent.click(within(liste()).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() =>
      expect(api.tarih).toHaveBeenCalledWith({
        set: 'Set 1',
        namespace: 'ns-a-prod',
        uygulama: 'app-1',
        tarih: '2026-12-04',
        beklenenSurum: 4,
      }),
    );
    // satır + set ilerlemesi (plansız set: satırların tarihi)
    expect(await screen.findAllByText('04.12.2026 Cuma')).toHaveLength(2);
    // aynı uygulamanın diğer DC satırı değişmedi
    expect(hucreler(govdeSatirlari()[1]).slice(0, 2)).toEqual(['Set 8', '19.12.2026 Cumartesi']);

    api.tarih.mockResolvedValueOnce({ ok: false, code: 'takvim_cakisma', message: 'değişti' });
    fireEvent.click(screen.getByRole('button', { name: 'Set 1 app-1 geçiş tarihini düzenle' }));
    fireEvent.change(screen.getByLabelText('Set 1 app-1 geçiş tarihi'), {
      target: { value: '2026-12-05' },
    });
    fireEvent.click(within(liste()).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('değişti'));
    await waitFor(() => expect(api.takvim).toHaveBeenCalledTimes(2));
    // ikinci istek ekrandaki yeni sürümle gitti
    expect(api.tarih.mock.calls[1][0]).toMatchObject({ beklenenSurum: 5 });
  });

  it('IT5 Admin set tarihi set planından: onay adımı, setin her satırının sürümü, yanıt işlenir', async () => {
    api.takvim.mockResolvedValue(
      yanit(
        [
          S('app-1', { surum: 2 }),
          S('app-2', { sira: 2, surum: 7 }),
          S('app-p', { set: 'Pilot', setSira: 0, gecisTarihi: '2026-12-01' }),
        ],
        { plan: [P('Set 1', 1, '2026-12-03', 'DC-A', { surum: 3 })] },
      ),
    );
    const uyari = vi.spyOn(toast, 'warning').mockImplementation(() => '');
    api.set.mockResolvedValue({
      ok: true,
      tasinan: 2,
      uyarilar: ['Aynı DC’de (DC-A) 1 uygulama birden fazla sette: Set 1, Set 7.'],
      plan: P('Set 1', 1, '2026-12-10', 'DC-A', { surum: 4 }),
      rows: [
        {
          set: 'Set 1',
          setSira: 1,
          gecisTarihi: '2026-12-10',
          sira: 1,
          namespace: 'ns-a-prod',
          uygulama: 'app-1',
          surum: 3,
          guncelleyen: 'onur',
          guncelleme: null,
        },
        {
          set: 'Set 1',
          setSira: 1,
          gecisTarihi: '2026-12-10',
          sira: 2,
          namespace: 'ns-a-prod',
          uygulama: 'app-2',
          surum: 8,
          guncelleyen: 'onur',
          guncelleme: null,
        },
      ],
    });
    ciz(<IntranetSpaPage />, 'Admin');
    await screen.findByText('app-1');
    // B5 (inceleme): arama süzgeci açıkken de setin TÜM satırlarının sürümü gider (süzülmüş liste
    // değil); yoksa sunucu her kayıtta 409 verirdi.
    fireEvent.change(screen.getByLabelText('Ara'), { target: { value: 'app-1' } });
    expect(uygulamaSirasi()).toEqual(['app-1']);
    fireEvent.click(screen.getByRole('button', { name: 'Set 1 planını düzenle' }));
    // düzenleme satırı satır tıklamasını tetiklemez (süzgeç değişmez)
    expect(screen.getByLabelText('Set')).toHaveValue('all');
    expect(screen.getByLabelText('Set 1 geçiş tarihi')).toHaveValue('2026-12-03');
    expect(screen.getByLabelText('Set 1 DC')).toHaveValue('DC-A');
    fireEvent.change(screen.getByLabelText('Set 1 geçiş tarihi'), {
      target: { value: '2026-12-10' },
    });
    fireEvent.click(within(ilerleme()).getByRole('button', { name: 'Kaydet' }));
    // Onay adımı: kaç uygulamanın hangi tarihe gideceği söylenir, onaysız istek gitmez.
    expect(within(ilerleme()).getByRole('alert')).toHaveTextContent(
      'Set 1: 2 uygulamanın geçiş tarihi 10.12.2026 Perşembe olacak.',
    );
    expect(api.set).not.toHaveBeenCalled();
    fireEvent.click(within(ilerleme()).getByRole('button', { name: 'Onayla' }));
    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith({
        set: 'Set 1',
        gecisTarihi: '2026-12-10',
        dc: 'DC-A',
        eskiIp: '192.0.2.41',
        yeniIp: '192.0.2.42',
        beklenenSurum: 3,
        beklenen: { 'ns-a-prod/app-1': 2, 'ns-a-prod/app-2': 7 },
        topla: false,
      }),
    );
    // yanıt: plan ve setin satırları güncellendi, düzenleme kapandı
    await waitFor(() => expect(hucreler(ilerlemeSatiri('Set 1'))[1]).toBe('10.12.2026 Perşembe'));
    expect(screen.queryByLabelText('Set 1 geçiş tarihi')).toBeNull();
    expect(hucreler(govdeSatirlari()[0]).slice(0, 2)).toEqual(['Set 1', '10.12.2026 Perşembe']);
    expect(toast.success).toHaveBeenCalledWith(
      'Set 1 planı güncellendi (2 uygulamanın tarihi değişti).',
    );
    // aynı DC uyarısı yazımı engellemez, ayrıca söylenir
    expect(uyari).toHaveBeenCalledWith(
      'Aynı DC’de (DC-A) 1 uygulama birden fazla sette: Set 1, Set 7.',
    );
  });

  it('IT5b farklı tarihliler toplanır; yalnız DC / IP onaysız; plansız set 0 sürümle; 409 tazeler', async () => {
    api.takvim.mockResolvedValue(
      yanit(
        [
          S('app-1'),
          S('app-2', { sira: 2, gecisTarihi: '2026-12-05' }),
          S('app-p', { set: 'Pilot', setSira: 0, gecisTarihi: '2026-12-01' }),
        ],
        { plan: [P('Set 1', 1, '2026-12-03', 'DC-A', { surum: 2 })] },
      ),
    );
    api.set.mockResolvedValue({ ok: false, code: 'takvim_cakisma', message: 'değişti' });
    ciz(<IntranetSpaPage />, 'Admin');
    await screen.findByText('app-1');
    expect(hucreler(ilerlemeSatiri('Set 1'))[9]).toContain('1 uygulama farklı tarihte');
    fireEvent.click(screen.getByRole('button', { name: 'Set 1 planını düzenle' }));
    // yalnız IP: tarih aynı, topla yok -> onaysız gider
    fireEvent.change(screen.getByLabelText('Set 1 Yeni IP'), { target: { value: '192.0.2.200' } });
    fireEvent.click(within(ilerleme()).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.set).toHaveBeenCalledTimes(1));
    expect(api.set.mock.calls[0][0]).toMatchObject({
      gecisTarihi: '2026-12-03',
      yeniIp: '192.0.2.200',
      topla: false,
    });
    // 409: liste tazelenir, düzenleme kapanır
    await waitFor(() => expect(api.takvim).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Set 1 Yeni IP')).toBeNull();

    api.set.mockResolvedValue({ ok: true, tasinan: 1, plan: null, rows: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Set 1 planını düzenle' }));
    fireEvent.click(screen.getByLabelText(/Farklı tarihteki 1 uygulamayı da bu tarihe al/));
    fireEvent.click(within(ilerleme()).getByRole('button', { name: 'Kaydet' }));
    expect(within(ilerleme()).getByRole('alert')).toHaveTextContent(
      'Set 1: 1 uygulamanın geçiş tarihi 03.12.2026 Perşembe olacak.',
    );
    fireEvent.click(within(ilerleme()).getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.set).toHaveBeenCalledTimes(2));
    expect(api.set.mock.calls[1][0]).toMatchObject({ topla: true, beklenenSurum: 2 });

    // plansız set (Pilot): sürüm 0, DC boş, tarih satırlardan; tarihi değişmeden plan oluşur
    fireEvent.click(screen.getByRole('button', { name: 'Pilot planını düzenle' }));
    expect(screen.getByLabelText('Pilot geçiş tarihi')).toHaveValue('2026-12-01');
    fireEvent.change(screen.getByLabelText('Pilot DC'), { target: { value: 'DC-A' } });
    fireEvent.click(within(ilerleme()).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.set).toHaveBeenCalledTimes(3));
    expect(api.set.mock.calls[2][0]).toEqual({
      set: 'Pilot',
      gecisTarihi: '2026-12-01',
      dc: 'DC-A',
      eskiIp: '',
      yeniIp: '',
      beklenenSurum: 0,
      beklenen: { 'ns-a-prod/app-p': 1 },
      topla: false,
    });
  });

  it('IT6 Admin takvim CSV: önizleme, uyarı, hatalıysa onay pasif, onay yükleme kilidiyle', async () => {
    api.takvim.mockResolvedValue(yanit([S('app-1')]));
    api.onizle.mockResolvedValueOnce({
      ok: true,
      gecerli: false,
      satir: 1,
      setler: [{ set: 'Pilot', satir: 1, tarihler: ['2026-12-01'] }],
      hatalar: [{ satir: 3, mesaj: 'sira geçersiz ("x").' }],
      hataSayisi: 1,
      yoksayilanSutun: ['dikkat'],
      uyarilar: [],
      uyariSayisi: 0,
      fark: { mevcut: 1, yeni: 1, kalkan: 1, tarihDegisen: 0, elleKaybolan: 0 },
      yukleme: { id: 'yk-1', yukleyen: null, zaman: null, kilit: 'yk-1:1:1' },
    });
    ciz(<IntranetSpaPage />, 'Admin');
    await screen.findByText('app-1');
    const girdi = screen.getByLabelText('Geçiş takvimi CSV dosyası');
    const dosya = new File(['set;gecis_tarihi\n'], 'takvim.csv', { type: 'text/csv' });
    fireEvent.change(girdi, { target: { files: [dosya] } });
    const oniz = await screen.findByRole('region', { name: 'Takvim önizlemesi' });
    expect(api.onizle).toHaveBeenCalledWith('set;gecis_tarihi\n');
    expect(within(oniz).getByText(/Satır 3: sira geçersiz/)).toBeInTheDocument();
    expect(within(oniz).getByText(/Pilot: 1 \(01\.12\.2026 Salı\)/)).toBeInTheDocument();
    expect(within(oniz).getByText(/1 yeni, 1 çıkacak/)).toBeInTheDocument();
    expect(within(oniz).getByText(/dikkat/)).toBeInTheDocument();
    expect(within(oniz).getByRole('button', { name: 'Onayla ve yükle' })).toBeDisabled();
    expect(within(oniz).queryByText(/Elle düzeltilmiş/)).toBeNull();

    // aynı DC'de iki set: UYARI, onay açık kalır
    api.onizle.mockResolvedValueOnce({
      ok: true,
      gecerli: true,
      satir: 1,
      setler: [],
      hatalar: [],
      hataSayisi: 0,
      uyarilar: ['ns-a-prod/app-1 aynı DC’de (DC-A) 2 sette: Set 1, Set 2.'],
      uyariSayisi: 3,
      fark: { mevcut: 1, yeni: 0, kalkan: 0, tarihDegisen: 1, elleKaybolan: 1 },
      yukleme: { id: 'yk-1', yukleyen: null, zaman: null, kilit: 'yk-1:1:2' },
    });
    api.yukle.mockResolvedValue({ ok: true, satir: 1, yukleme: 'yk-2' });
    fireEvent.change(girdi, { target: { files: [new File(['ok'], 'b.csv')] } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Onayla ve yükle' })).toBeEnabled(),
    );
    expect(screen.getByText(/aynı DC’de \(DC-A\) 2 sette: Set 1, Set 2/)).toBeInTheDocument();
    expect(screen.getByText('Toplam 3 uyarı; ilk 1 gösteriliyor.')).toBeInTheDocument();
    expect(screen.getByText(/Elle düzeltilmiş 1 geçiş tarihi bu listeyle/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve yükle' }));
    await waitFor(() => expect(api.yukle).toHaveBeenCalledWith('ok', 'yk-1:1:2'));
    await waitFor(() => expect(api.takvim).toHaveBeenLastCalledWith(true));
    expect(screen.queryByRole('region', { name: 'Takvim önizlemesi' })).toBeNull();

    // Sunucu sınırının üstündeki metin gönderilmez.
    api.onizle.mockClear();
    fireEvent.change(girdi, { target: { files: [new File(['x'.repeat(600001)], 'buyuk.csv')] } });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/çok büyük/)),
    );
    expect(api.onizle).not.toHaveBeenCalled();
  });

  it('IT6b Admin set planı CSV: önizleme, tarihi değişecek uygulama sayısı, onay kilitle', async () => {
    api.takvim.mockResolvedValue(yanit([S('app-1')]));
    api.planOnizle.mockResolvedValueOnce({
      ok: true,
      gecerli: true,
      satir: 2,
      setler: [
        {
          set: 'Pilot',
          setSira: 0,
          gecisTarihi: '2026-12-03',
          dc: 'DC-A',
          eskiIp: '192.0.2.41',
          yeniIp: '192.0.2.42',
        },
        { set: 'Set 1', setSira: 1, gecisTarihi: '2026-12-08', dc: '', eskiIp: '', yeniIp: '' },
      ],
      hatalar: [],
      hataSayisi: 0,
      fark: { mevcut: 1, yeni: 1, kalkan: 0, degisen: 1 },
      tasima: [
        {
          set: 'Set 1',
          eskiTarih: '2026-12-03',
          yeniTarih: '2026-12-08',
          uygulama: 2,
          elle: 1,
        },
      ],
      uyarilar: ['Takvimde uygulaması olmayan set: Pilot.'],
      kilit: 'plan 1:1:1 | takvim 1:1:1',
    });
    api.planYukle.mockResolvedValueOnce({
      ok: false,
      code: 'takvim_cakisma',
      message: 'değişti',
    });
    ciz(<IntranetSpaPage />, 'Admin');
    await screen.findByText('app-1');
    const girdi = screen.getByLabelText('Set planı CSV dosyası');
    fireEvent.change(girdi, { target: { files: [new File(['plan'], 'plan.csv')] } });
    const oniz = await screen.findByRole('region', { name: 'Set planı önizlemesi' });
    expect(api.planOnizle).toHaveBeenCalledWith('plan');
    expect(within(oniz).getByText(/plan\.csv · 2 set/)).toBeInTheDocument();
    expect(
      within(oniz).getByText('Pilot: 03.12.2026 Perşembe · DC-A · 192.0.2.41 → 192.0.2.42'),
    ).toBeInTheDocument();
    expect(within(oniz).getByText('Set 1: 08.12.2026 Salı · DC belirtilmemiş')).toBeInTheDocument();
    expect(within(oniz).getByText(/1 yeni, 0 çıkacak, 1 değişen/)).toBeInTheDocument();
    expect(within(oniz).getByRole('alert')).toHaveTextContent(
      'Set 1: 2 uygulamanın tarihi değişecek (08.12.2026 Salı); elle düzeltilmiş 1 tarih kaybolacak.',
    );
    expect(within(oniz).getByText(/Takvimde uygulaması olmayan set: Pilot/)).toBeInTheDocument();
    // çakışma: önizleme tazelenir
    api.planOnizle.mockResolvedValueOnce({
      ok: true,
      gecerli: true,
      satir: 2,
      setler: [],
      hatalar: [],
      hataSayisi: 0,
      fark: { mevcut: 1, yeni: 1, kalkan: 0, degisen: 1 },
      tasima: [],
      uyarilar: [],
      kilit: 'plan 1:1:1 | takvim 1:2:2',
    });
    fireEvent.click(within(oniz).getByRole('button', { name: 'Onayla ve yükle' }));
    await waitFor(() =>
      expect(api.planYukle).toHaveBeenCalledWith('plan', 'plan 1:1:1 | takvim 1:1:1'),
    );
    await waitFor(() => expect(api.planOnizle).toHaveBeenCalledTimes(2));
    api.planYukle.mockResolvedValueOnce({ ok: true, satir: 2, tasinan: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve yükle' }));
    await waitFor(() =>
      expect(api.planYukle).toHaveBeenLastCalledWith('plan', 'plan 1:1:1 | takvim 1:2:2'),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Set planı yüklendi: 2 set.'));
    await waitFor(() => expect(api.takvim).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Set planı önizlemesi' })).toBeNull();
  });

  it('IT7 bantlar: yükleniyor, canlı rapor alınamadı, takvim boş, takvimde yok sayacı', async () => {
    let bitir: (v: TakvimYanit) => void = () => undefined;
    api.takvim.mockReturnValueOnce(
      new Promise<TakvimYanit>((r) => {
        bitir = r;
      }),
    );
    const bekle = ciz(<IntranetSpaPage />);
    expect(screen.getByText('Geçiş takvimi yükleniyor…')).toBeInTheDocument();
    bitir(yanit([], { yukleme: null }));
    expect(await screen.findByText(/Geçiş takvimi henüz yüklenmedi/)).toHaveTextContent(
      'Yöneticinin yüklemesi bekleniyor.',
    );
    expect(screen.queryByText('Geçiş takvimi yükleniyor…')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Set ilerlemesi' })).toBeNull();
    bekle.unmount();

    api.takvim.mockResolvedValue(
      yanit([S('app-1')], {
        canli: {
          durum: 'okunamadi',
          message: 'zaman aşımı',
          kesifTarihi: null,
          dynatraceOkunamadi: false,
        },
        takvimdeYok: [{ namespace: 'ns-b-prod', uygulama: 'app-x', ekip: 'ekip-c' }],
      }),
    );
    const { unmount } = ciz(<IntranetSpaPage />);
    expect(
      await screen.findByText(/Canlı Intranet SPA raporu alınamadı \(zaman aşımı\)/),
    ).toBeInTheDocument();
    expect(screen.getByText('Takvimde yok: 1 canlı PROD intranet SPA')).toBeInTheDocument();
    expect(screen.getByText(/ns-b-prod \/ app-x · ekip-c/)).toBeInTheDocument();
    unmount();

    api.takvim.mockResolvedValue(yanit([], { yukleme: null }));
    ciz(<IntranetSpaPage />, 'Admin');
    expect(await screen.findByText(/Geçiş takvimi henüz yüklenmedi/)).toHaveTextContent(
      /Takvim yükle/,
    );
  });

  it('IT10 paket kurulumu bölümü sayfada, uygulama listesinin altında', async () => {
    api.takvim.mockResolvedValue(
      yanit([S('app-1')], { plan: [P('Set 1', 1, '2026-12-03', 'DC-A')] }),
    );
    ciz(<IntranetSpaPage />, 'Admin');
    await screen.findByText('app-1');
    const paket = screen.getByRole('region', { name: 'Paket kurulumu (sahte)' });
    expect(liste().compareDocumentPosition(paket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('IT7b takvim okunamadı: hata bandı', async () => {
    api.takvim.mockResolvedValue({ ok: false, message: 'Geçiş takvimi okunamadı.' });
    ciz(<IntranetSpaPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Geçiş takvimi okunamadı.');
  });

  it('IT9b set ilerlemesi ekranda: DC grupları, sütunlar, durum bugüne göre, CSV', async () => {
    // Bugün (PORTAL_TZ) 09.12.2026: UTC 21:30 08.12 = İstanbul 00:30 09.12.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-08T21:30:00Z'));
    const dcA = [
      ...Array.from({ length: 2 }, (_, i) =>
        S(`p${i}`, { set: 'Pilot', setSira: 0, gecisTarihi: '2026-12-03' }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        S(`a${i}`, { set: 'Set 1', setSira: 1, gecisTarihi: '2026-12-09', sira: i + 1 }),
      ),
    ];
    const dcB = Array.from({ length: 2 }, (_, i) =>
      S(`p${i}`, { set: 'Set 7', setSira: 7, gecisTarihi: '2026-12-17' }),
    );
    api.takvim.mockResolvedValue(
      yanit([...dcA, ...dcB, S('x1', { set: 'Set 14', setSira: 14, gecisTarihi: '2027-01-05' })], {
        plan: [
          P('Pilot', 0, '2026-12-03', 'DC-A'),
          P('Set 1', 1, '2026-12-09', 'DC-A'),
          P('Set 7', 7, '2026-12-17', 'DC-B', {
            eskiIp: '198.51.100.41',
            yeniIp: '198.51.100.42',
          }),
          P('Set 8', 8, '2026-12-19', 'DC-B'),
        ],
      }),
    );
    ciz(<IntranetSpaPage />);
    await screen.findByText('x1');
    const tablo = ilerleme();
    expect(
      within(tablo)
        .getAllByRole('columnheader')
        .slice(0, 10)
        .map((h) => h.textContent),
    ).toEqual([...ILERLEME_CSV_BASLIK]);
    // DC grup başlıkları plan sırasıyla, DC belirtilmemiş en sonda
    expect(within(tablo).getByText('DC-A · 5 uygulama')).toBeInTheDocument();
    expect(within(tablo).getByText('DC-B · 2 uygulama')).toBeInTheDocument();
    expect(within(tablo).getByText('DC belirtilmemiş · 1 uygulama')).toBeInTheDocument();
    expect(hucreler(ilerlemeSatiri('Pilot'))).toEqual([
      'Pilot',
      '03.12.2026 Perşembe',
      'DC-A',
      '192.0.2.41',
      '192.0.2.42',
      '2',
      '0,400',
      '2',
      '%40,0',
      'Geçti',
    ]);
    expect(hucreler(ilerlemeSatiri('Set 1')).slice(5)).toEqual([
      '3',
      '0,600',
      '5',
      '%100,0',
      'Bugün',
    ]);
    // DC-B kendi paydasıyla yeniden başlar; uygulaması 0 olan plan seti de görünür
    expect(hucreler(ilerlemeSatiri('Set 7')).slice(2)).toEqual([
      'DC-B',
      '198.51.100.41',
      '198.51.100.42',
      '2',
      '1,000',
      '2',
      '%100,0',
      'Planlı',
    ]);
    expect(hucreler(ilerlemeSatiri('Set 8')).slice(5)).toEqual([
      '0',
      '0,000',
      '2',
      '%100,0',
      'Planlı',
    ]);
    expect(hucreler(ilerlemeSatiri('Set 14'))).toEqual([
      'Set 14',
      '05.01.2027 Salı',
      '—',
      '',
      '',
      '1',
      '1,000',
      '1',
      '%100,0',
      'Planlı · plan yok',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Set ilerlemesi CSV/ }));
    expect(downloadCsv).toHaveBeenCalledWith(
      'intranet_spa_set_ilerlemesi',
      ILERLEME_CSV_BASLIK,
      expect.arrayContaining([
        [
          'Set 14',
          '05.01.2027 Salı',
          'DC belirtilmemiş',
          '',
          '',
          '1',
          '1,000',
          '1',
          '%100,0',
          'Planlı · plan yok',
        ],
      ]),
    );
  });
});

describe('intranetSpa yardımcıları', () => {
  it('IT8 tarih, sıralama, anahtar, süzgeç, CSV', () => {
    expect(tarihGoster('2026-12-01')).toBe('01.12.2026 Salı');
    expect(tarihGoster('2026-12-06')).toBe('06.12.2026 Pazar');
    expect(tarihGoster('bozuk')).toBe('bozuk');
    const sirali = takvimSirala(ORNEK);
    expect(sirali.map((r) => r.uygulama)).toEqual(['app-p', 'app-1', 'app-2', 'app-3']);
    // Set 10, Set 2'den sonra (sayısal)
    expect(
      takvimSirala([
        S('on', { set: 'Set 10', setSira: 10 }),
        S('iki', { set: 'Set 2', setSira: 2 }),
      ]).map((r) => r.set),
    ).toEqual(['Set 2', 'Set 10']);
    // anahtar set dahil: aynı uygulamanın iki DC satırı ayrı
    expect(satirAnahtari(S('app-1'))).not.toBe(
      satirAnahtari(S('app-1', { set: 'Set 8', setSira: 8 })),
    );
    expect(
      suzTakvim(sirali, { set: 'all', ekip: 'all', q: '08.12' }).map((r) => r.uygulama),
    ).toEqual(['app-3']);
    expect(takvimCsvSatirlari([S('app-1', { aciklama: 'not' })])[0]).toHaveLength(
      TAKVIM_CSV_BASLIK.length,
    );
    // Formül enjeksiyonu: =, +, -, @ ile başlayan hücre etkisizleşir; düz metin aynen kalır.
    const f = takvimCsvSatirlari([
      S('app-1', {
        aciklama: '=HYPERLINK("http://kotu.example")',
        ekip: '+ekip',
        ekipEposta: '@x',
        routeAdresleri: '-r',
        dynatraceDurumu: 'istek alıyor',
      }),
    ])[0];
    expect([f[3], f[4], f[7], f[8], f[10]]).toEqual([
      "'+ekip",
      "'@x",
      "'-r",
      'istek alıyor',
      '\'=HYPERLINK("http://kotu.example")',
    ]);
  });

  it('IT9 set ilerlemesi: DC başına pay / kümülatif, plan yok, farklı tarih, durum sınırı', () => {
    // Kullanıcının takvim deseni: DC başına 7 / 57 / 60 / 61 / 60 / 60 / 60 = 365 uygulama.
    const adet = [7, 57, 60, 61, 60, 60, 60];
    const setAdi = (i: number) => (i === 0 ? 'Pilot' : `Set ${i}`);
    const rows: TakvimSatir[] = [];
    const plan: TakvimPlanSatir[] = [];
    for (let dc = 0; dc < 2; dc++)
      adet.forEach((n, i) => {
        const sira = dc * 7 + i;
        const tarih = `2026-12-${String(3 + sira).padStart(2, '0')}`;
        plan.push(P(setAdi(sira), sira, tarih, dc ? 'DC-B' : 'DC-A'));
        for (let k = 0; k < n; k++)
          rows.push(S(`app-${i}-${k}`, { set: setAdi(sira), setSira: sira, gecisTarihi: tarih }));
      });
    const g = setIlerlemesi(rows, plan, '2026-12-10');
    expect(g.map((x) => [x.dc, x.toplam])).toEqual([
      ['DC-A', 365],
      ['DC-B', 365],
    ]);
    const ozet = (x: (typeof g)[number]) =>
      x.setler.map((s) => [s.set, s.uygulama, fmtOran(s.pay), s.kumulatif, fmtYuzde(s.yuzde)]);
    expect(ozet(g[0])).toEqual([
      ['Pilot', 7, '0,019', 7, '%1,9'],
      ['Set 1', 57, '0,156', 64, '%17,5'],
      ['Set 2', 60, '0,164', 124, '%34,0'],
      ['Set 3', 61, '0,167', 185, '%50,7'],
      ['Set 4', 60, '0,164', 245, '%67,1'],
      ['Set 5', 60, '0,164', 305, '%83,6'],
      ['Set 6', 60, '0,164', 365, '%100,0'],
    ]);
    // ikinci DC yüzdeyi yeniden 1,9'dan başlatır; Set 10 > Set 2 sırası korunur
    expect(ozet(g[1]).map((x) => [x[0], x[4]])).toEqual([
      ['Set 7', '%1,9'],
      ['Set 8', '%17,5'],
      ['Set 9', '%34,0'],
      ['Set 10', '%50,7'],
      ['Set 11', '%67,1'],
      ['Set 12', '%83,6'],
      ['Set 13', '%100,0'],
    ]);
    // durum sınırı: tarihi bugün olan set "bugun", dünkü "gecti", yarınki "planli"
    expect(g[0].setler.slice(5, 7).map((s) => [s.tarih, s.durum])).toEqual([
      ['2026-12-08', 'gecti'],
      ['2026-12-09', 'gecti'],
    ]);
    expect(g[1].setler.slice(0, 2).map((s) => [s.tarih, s.durum])).toEqual([
      ['2026-12-10', 'bugun'],
      ['2026-12-11', 'planli'],
    ]);

    // plan yok + farklı tarih + uygulaması 0 olan plan seti + DC'si boş plan
    const k = setIlerlemesi(
      [
        S('a', { set: 'Set 3', setSira: 3, gecisTarihi: '2026-12-10' }),
        S('b', { set: 'Set 3', setSira: 3, gecisTarihi: '2026-12-10' }),
        S('c', { set: 'Set 3', setSira: 3, gecisTarihi: '2026-12-08' }),
        S('d', { set: 'Set 1', setSira: 1, gecisTarihi: '2026-12-06' }),
        S('e', { set: 'Set 2', setSira: 2, gecisTarihi: '2026-12-07' }),
      ],
      [
        P('Set 1', 1, '2026-12-05', 'DC-A'),
        P('Set 2', 2, '2026-12-07', ''),
        P('Set 9', 9, '2026-12-20', 'DC-A'),
      ],
      '2026-12-07',
    );
    expect(
      k.map((x) => [x.dc, x.toplam, x.setler.map((s) => [s.set, s.uygulama, s.farkliTarih])]),
    ).toEqual([
      [
        'DC-A',
        1,
        [
          ['Set 1', 1, 1],
          ['Set 9', 0, 0],
        ],
      ],
      [
        '',
        4,
        [
          ['Set 2', 1, 0],
          ['Set 3', 3, 1],
        ],
      ],
    ]);
    // DC adı kırpılmış ve harf duyarsız gruplanır (sunucunun aynı DC uyarısıyla aynı); görünen ad
    // grubun ilk setinin yazımı
    const h = setIlerlemesi(
      [
        S('a', { set: 'Set 1', setSira: 1 }),
        S('b', { set: 'Set 2', setSira: 2 }),
        S('c', { set: 'Set 2', setSira: 2 }),
      ],
      [P('Set 1', 1, '2026-12-03', 'DC-A'), P('Set 2', 2, '2026-12-03', ' dc-a ')],
      '2026-12-01',
    );
    expect(h.map((x) => [x.dc, x.toplam, x.setler.map((s) => fmtOran(s.pay))])).toEqual([
      ['DC-A', 3, ['0,333', '0,667']],
    ]);
    const set3 = k[1].setler[1];
    // plansız set: tarih satırların en sık tarihi
    expect([set3.plan, set3.tarih, set3.durum]).toEqual([null, '2026-12-10', 'planli']);
    expect(k[0].setler[0].durum).toBe('gecti');
    // CSV: DC belirtilmemiş, durum notları, formül etkisizleştirme
    const csv = ilerlemeCsvSatirlari(k);
    expect(csv[0]).toEqual([
      'Set 1',
      '05.12.2026 Cumartesi',
      'DC-A',
      '192.0.2.41',
      '192.0.2.42',
      '1',
      '1,000',
      '1',
      '%100,0',
      'Geçti · 1 uygulama farklı tarihte',
    ]);
    expect(csv[3][2]).toBe('DC belirtilmemiş');
    expect(csv[3][9]).toBe('Planlı · 1 uygulama farklı tarihte · plan yok');
    expect(
      ilerlemeCsvSatirlari(setIlerlemesi([], [P('Set 1', 1, '2026-12-05', '=X')], ''))[0][2],
    ).toBe("'=X");
    // boş DC payda 0: pay / yüzde boş işaret
    expect(
      fmtOran(setIlerlemesi([], [P('Set 1', 1, '2026-12-05', 'DC-A')], '')[0].setler[0].pay),
    ).toBe('—');
  });

  it('IT9c portalGunu PORTAL_TZ takvim günü; fmtYuzde bir ondalık, fmtOran üç ondalık, Türkçe virgül', () => {
    expect(portalGunu(new Date('2026-12-08T21:30:00Z'))).toBe('2026-12-09');
    expect(portalGunu(new Date('2026-12-08T20:59:00Z'))).toBe('2026-12-08');
    expect(fmtYuzde(1.917808)).toBe('%1,9');
    expect(fmtYuzde(100)).toBe('%100,0');
    expect(fmtYuzde(null)).toBe('—');
    expect(fmtYuzde(Number.NaN)).toBe('—');
    // Setin payı kullanıcının tablosundaki gibi oran, üç ondalık
    expect(fmtOran(7 / 365)).toBe('0,019');
    expect(fmtOran(57 / 365)).toBe('0,156');
    expect(fmtOran(1)).toBe('1,000');
    expect(fmtOran(null)).toBe('—');
    expect(fmtOran(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
