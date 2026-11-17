// src/components/oco/__tests__/oco-manuel.test.tsx — OCO Takvimi: elle eklenen olaylar (2026-11-17).
// Kullanıcı: "OCO Takvimi'ne manuel ekleme olayı da ekler misin?"
//   OM-U1 elle olay listede "manuel" rozetiyle, servis OCO'larıyla birlikte; Manuel süzgeci ve sayısı
//   OM-U2 Olay ekle: zorunlu alan önce istemcide denetlenir, geçerli form ISO tarihle POST edilir,
//         ardından liste yeniden okunur; serviste olan OCO no için çakışma uyarısı
//   OM-U3 elle olaylar okunamazsa uyarı; OCO listesi yine görünür (boş "olay yok" sanılmaz)
//   OM-U4 Düzenle/Sil yalnız duzenleyebilir olayda; Sil onay penceresinden DELETE gider
//   OM-U5 takvim görünümünde OCO'suz olay "manuel" diye yazılır (iç kimlik "#-1" asla görünmez)
//   OM-U6 saf yardımcılar: ocoEtiket/ocoKopya, formHatasi, isoYerel<->yerelIso gidiş-dönüş
//   OM-U7 Düzenle: alanlar dolu, Kaydet tek PUT   OM-U8 sunucu reddi pencereyi kapatmaz
//   OM-U9 çift gönderim kilidi   OM-U10 boşalan Manuel süzgeci Tümü'ye düşer
//   OM-U11 OCO no araması, Yenile, kırpma uyarısı   OM-U12 takvim paneli iç kimlik göstermez
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import OcoTakvimiPage from '@/components/OcoTakvimiPage';
import {
  formHatasi,
  isoYerel,
  manueldenSatira,
  ocoEtiket,
  ocoKopya,
  yerelIso,
  type ManuelOlay,
} from '@/components/oco/manuelOlay';

/** Yarın (yerel) belirtilen saatte, ISO. */
const yarin = (saat: number) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(saat, 0, 0, 0);
  return d.toISOString();
};
const bugunOgle = () => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

const servis = (oco: number, plannedStart = yarin(10)) => ({
  oco,
  subject: `servis ${oco}`,
  explanation: '',
  statusText: '',
  statusCode: 0,
  impactText: '',
  processText: '',
  pcabRequired: false,
  plannedStart,
  plannedEnd: null,
  actualStart: null,
  actualEnd: null,
  openedAt: null,
  iliski: ['acan'],
});
const olay = (id: number, ek: Partial<ManuelOlay> = {}): ManuelOlay => ({
  id,
  ocoNo: null,
  baslik: `elle ${id}`,
  aciklama: '',
  baslangic: yarin(14),
  bitis: yarin(16),
  olusturan: 'ayse',
  olusturmaAt: '2026-11-17T09:00:00.000Z',
  guncelleyen: 'ayse',
  guncellemeAt: '2026-11-17T09:00:00.000Z',
  duzenleyebilir: true,
  ...ek,
});

type Cevap = { body: unknown };
interface SunucuSecenek {
  servis?: unknown[];
  olaylar?: ManuelOlay[] | null;
  manuelHata?: string;
  kirpildi?: boolean;
  /** POST/PUT/DELETE reddi: gövde { ok:false, message }. */
  yazmaRet?: string;
  /** POST yanıtı bu söz çözülene kadar bekler (çift gönderim sınaması). */
  postBekle?: Promise<void>;
}
function sunucu(opts: SunucuSecenek = {}) {
  const cagrilar: { url: string; method: string; body: unknown }[] = [];
  let olaylar = opts.olaylar ?? [];
  const takvim = {
    ok: true,
    rows: opts.servis ?? [servis(101)],
    total: 1,
    fetched: 1,
    truncated: false,
    eksik: [],
  };
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    cagrilar.push({ url, method, body });
    let c: Cevap;
    const ret = opts.yazmaRet && method !== 'GET' ? { ok: false, message: opts.yazmaRet } : null;
    if (url.startsWith('/api/oco/calendar')) c = { body: takvim };
    else if (url === '/api/oco/manuel' && method === 'GET')
      c = {
        body: opts.manuelHata
          ? { ok: false, message: opts.manuelHata }
          : { ok: true, olaylar, kirpildi: !!opts.kirpildi },
      };
    else if (ret) c = { body: ret };
    else if (url === '/api/oco/manuel' && method === 'POST') {
      if (opts.postBekle) await opts.postBekle;
      const yeni = olay(99, {
        baslik: body.baslik,
        ocoNo: body.ocoNo || null,
        aciklama: body.aciklama,
        baslangic: body.baslangic,
        bitis: body.bitis || null,
      });
      olaylar = [...(olaylar || []), yeni];
      c = { body: { ok: true, olay: yeni } };
    } else if (url.startsWith('/api/oco/manuel/') && method === 'PUT') {
      const id = Number(url.split('/').pop());
      olaylar = (olaylar || []).map((o) =>
        o.id === id
          ? {
              ...o,
              baslik: body.baslik,
              ocoNo: body.ocoNo || null,
              aciklama: body.aciklama,
              baslangic: body.baslangic,
              bitis: body.bitis || null,
            }
          : o,
      );
      c = { body: { ok: true, olay: olaylar.find((o) => o.id === id) } };
    } else if (url.startsWith('/api/oco/manuel/') && method === 'DELETE') {
      const id = Number(url.split('/').pop());
      olaylar = (olaylar || []).filter((o) => o.id !== id);
      c = { body: { ok: true, id } };
    } else c = { body: { ok: false, message: `beklenmeyen ${method} ${url}` } };
    return { ok: true, status: 200, json: async () => c.body };
  });
  vi.stubGlobal('fetch', f);
  return { cagrilar };
}
const yazmalar = <T extends { method: string }>(c: T[]) => c.filter((x) => x.method !== 'GET');
const manuelOkumalari = (c: { url: string; method: string }[]) =>
  c.filter((x) => x.url === '/api/oco/manuel' && x.method === 'GET').length;
afterEach(() => vi.unstubAllGlobals());

describe('OCO Takvimi — elle eklenen olaylar', () => {
  it('OM-U1 elle olay listede manuel rozetiyle; Manuel süzgeci', async () => {
    sunucu({ olaylar: [olay(1), olay(2, { ocoNo: '777', duzenleyebilir: false })] });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    expect(await screen.findByText('elle 1')).toBeTruthy();
    expect(screen.getByText('servis 101')).toBeTruthy();
    expect(screen.getAllByText('manuel').length).toBe(2);
    // OCO no'lu olay kopyalanabilir #777; OCO'suzda numara yok, iç kimlik (#-1) hiç görünmez.
    expect(screen.getByText('#777')).toBeTruthy();
    expect(screen.queryByText('#-1')).toBeNull();
    expect(screen.queryByText('#-2')).toBeNull();
    const dugmeler = [...document.querySelectorAll('[data-testid="oco-iliski"] button')];
    expect(dugmeler.map((b) => b.textContent)).toEqual([
      'Tümü3',
      'Açtığımız1',
      'Bize açılan0',
      'Manuel2',
    ]);
    fireEvent.click(dugmeler[3]);
    expect(screen.queryByText('servis 101')).toBeNull();
    expect(screen.getByText('elle 2')).toBeTruthy();
    expect(screen.getByText(/2 elle eklenen olay dahil/)).toBeTruthy();
  });

  it('OM-U1b elle olay yoksa Manuel seçeneği görünmez', async () => {
    sunucu({ olaylar: [] });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    expect(await screen.findByText('servis 101')).toBeTruthy();
    const dugmeler = [...document.querySelectorAll('[data-testid="oco-iliski"] button')];
    expect(dugmeler.map((b) => b.textContent)).toEqual(['Tümü1', 'Açtığımız1', 'Bize açılan0']);
  });

  it('OM-U2 Olay ekle: istemci denetimi, ISO POST, yeniden okuma, çakışma uyarısı', async () => {
    const { cagrilar } = sunucu();
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    await screen.findByText('servis 101');
    fireEvent.click(screen.getByTestId('oco-manuel-ekle'));
    const form = await screen.findByTestId('oco-manuel-form');
    // Boş başlık: sunucuya gitmeden hata.
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Başlık zorunlu/);
    expect(cagrilar.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(within(form).getByLabelText('Başlık'), { target: { value: 'Gece bakımı' } });
    fireEvent.change(within(form).getByLabelText('Başlangıç'), {
      target: { value: '2099-03-04T22:30' },
    });
    fireEvent.change(within(form).getByLabelText('OCO no'), { target: { value: '101' } });
    expect(screen.getByTestId('oco-manuel-cakisma').textContent).toMatch(
      /OCO 101 zaten servisten listeleniyor/,
    );
    fireEvent.change(within(form).getByLabelText('OCO no'), { target: { value: '' } });
    expect(screen.queryByTestId('oco-manuel-cakisma')).toBeNull();

    const okumaOnce = cagrilar.filter(
      (c) => c.url === '/api/oco/manuel' && c.method === 'GET',
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await waitFor(() => expect(screen.queryByTestId('oco-manuel-form')).toBeNull());
    const post = cagrilar.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/oco/manuel');
    expect(post.body).toEqual({
      baslik: 'Gece bakımı',
      ocoNo: '',
      aciklama: '',
      baslangic: new Date('2099-03-04T22:30').toISOString(),
      bitis: '',
    });
    await waitFor(() =>
      expect(cagrilar.filter((c) => c.url === '/api/oco/manuel' && c.method === 'GET').length).toBe(
        okumaOnce + 1,
      ),
    );
    expect(await screen.findByText('Gece bakımı')).toBeTruthy();
  });

  it('OM-U3 elle olaylar okunamazsa uyarı, OCO listesi yine görünür', async () => {
    sunucu({ manuelHata: 'Elle eklenen olaylar okunamadı: baglanti yok' });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    expect((await screen.findByTestId('oco-manuel-hata')).textContent).toMatch(
      /gösterilemiyor.*baglanti yok/,
    );
    expect(screen.getByText('servis 101')).toBeTruthy();
  });

  it('OM-U3b beklenmeyen yanıt biçimi "olay yok" sayılmaz', async () => {
    // Eski davranışta tek fetch taklidi her uca takvim gövdesini döndürüyordu: olaylar dizisi yok.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, rows: [servis(5)], total: 1 }),
      })),
    );
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    expect((await screen.findByTestId('oco-manuel-hata')).textContent).toMatch(/beklenmeyen yanıt/);
  });

  it('OM-U4 Düzenle/Sil yalnız yetkili olayda; Sil onayla DELETE', async () => {
    const { cagrilar } = sunucu({
      olaylar: [olay(1), olay(2, { duzenleyebilir: false, olusturan: 'mehmet' })],
    });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    fireEvent.click(await screen.findByText('elle 2'));
    expect(screen.getByTestId('oco-manuel-bilgi').textContent).toMatch(/Elle ekleyen mehmet/);
    expect(screen.queryByRole('button', { name: /Düzenle/ })).toBeNull();
    fireEvent.click(screen.getByText('elle 2'));

    fireEvent.click(screen.getByText('elle 1'));
    fireEvent.click(screen.getByRole('button', { name: /Düzenle/ }));
    const form = await screen.findByTestId('oco-manuel-form');
    expect((within(form).getByLabelText('Başlık') as HTMLInputElement).value).toBe('elle 1');
    expect((within(form).getByLabelText('Başlangıç') as HTMLInputElement).value).toBe(
      isoYerel(yarin(14)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByTestId('oco-manuel-form')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Sil/ }));
    expect((await screen.findByTestId('oco-manuel-sil')).textContent).toMatch(
      /elle 1.*kalıcı olarak silinecek/,
    );
    expect(cagrilar.some((c) => c.method === 'DELETE')).toBe(false);
    const pencere = screen.getByTestId('oco-manuel-sil').closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(pencere).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(screen.queryByText('elle 1')).toBeNull());
    expect(cagrilar.find((c) => c.method === 'DELETE')!.url).toBe('/api/oco/manuel/1');
  });

  it('OM-U5 takvim görünümünde OCO’suz olay "manuel" yazılır', async () => {
    sunucu({ olaylar: [olay(1, { baslangic: bugunOgle(), bitis: null })] });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    const ogeler = await screen.findAllByTestId('oco-takvim-oge');
    const elle = ogeler.find((o) => o.textContent?.includes('elle 1'))!;
    expect(elle).toBeTruthy();
    expect(elle.textContent).toMatch(/manuel/);
    expect(elle.textContent).not.toMatch(/#-1/);
    expect(elle.getAttribute('aria-label')).toMatch(/^Elle eklenen olay,/);
  });

  it('OM-U6 saf yardımcılar', () => {
    const r1 = manueldenSatira(olay(3));
    expect(r1.oco).toBe(-3);
    expect(ocoEtiket(r1)).toBe('manuel');
    expect(ocoKopya(r1)).toBeNull();
    const r2 = manueldenSatira(olay(4, { ocoNo: '123' }));
    expect(ocoEtiket(r2)).toBe('#123');
    expect(ocoKopya(r2)).toBe('123');
    expect(ocoEtiket(servis(55) as never)).toBe('#55');
    expect(ocoKopya(servis(55) as never)).toBe('55');

    expect(formHatasi({ baslik: ' ', ocoNo: '', baslangic: 'x', bitis: '' })).toMatch(/Başlık/);
    expect(formHatasi({ baslik: 'a', ocoNo: '1a', baslangic: 'x', bitis: '' })).toMatch(/rakam/);
    expect(formHatasi({ baslik: 'a', ocoNo: '', baslangic: '', bitis: '' })).toMatch(/Başlangıç/);
    expect(
      formHatasi({
        baslik: 'a',
        ocoNo: '',
        baslangic: '2099-01-02T10:00',
        bitis: '2099-01-02T09:00',
      }),
    ).toMatch(/önce/);
    expect(
      formHatasi({
        baslik: 'a',
        ocoNo: '12',
        baslangic: '2099-01-02T10:00',
        bitis: '2099-01-02T10:00',
      }),
    ).toBeNull();

    expect(isoYerel(null)).toBe('');
    expect(isoYerel('bozuk')).toBe('');
    expect(yerelIso('')).toBe('');
    const yerel = '2099-05-06T07:08';
    expect(isoYerel(yerelIso(yerel))).toBe(yerel);
  });

  it('OM-U7 Düzenle: alanlar dolu gelir, Kaydet tek PUT gönderir (POST yok)', async () => {
    const { cagrilar } = sunucu({
      olaylar: [olay(1, { ocoNo: '777', aciklama: 'eski not', bitis: yarin(16) })],
    });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    fireEvent.click(await screen.findByText('elle 1'));
    fireEvent.click(screen.getByRole('button', { name: /Düzenle/ }));
    const form = await screen.findByTestId('oco-manuel-form');
    const alan = (ad: string) => within(form).getByLabelText(ad) as HTMLInputElement;
    expect(alan('OCO no').value).toBe('777');
    expect(alan('Bitiş').value).toBe(isoYerel(yarin(16)));
    expect(alan('Açıklama').value).toBe('eski not');
    fireEvent.change(alan('Başlık'), { target: { value: 'elle 1 yeni' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(screen.queryByTestId('oco-manuel-form')).toBeNull());
    expect(yazmalar(cagrilar).map((c) => `${c.method} ${c.url}`)).toEqual([
      'PUT /api/oco/manuel/1',
    ]);
    expect(yazmalar(cagrilar)[0].body).toEqual({
      baslik: 'elle 1 yeni',
      ocoNo: '777',
      aciklama: 'eski not',
      baslangic: yerelIso(isoYerel(yarin(14))),
      bitis: yerelIso(isoYerel(yarin(16))),
    });
    expect(await screen.findByText('elle 1 yeni')).toBeTruthy();
  });

  it('OM-U8 sunucu reddi: form ve silme penceresi açık kalır, mesaj görünür', async () => {
    const red = 'Bu olayı yalnız ekleyen kişi ya da yönetici değiştirebilir.';
    sunucu({ olaylar: [olay(1)], yazmaRet: red });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    fireEvent.click(await screen.findByText('elle 1'));
    fireEvent.click(screen.getByRole('button', { name: /Düzenle/ }));
    await screen.findByTestId('oco-manuel-form');
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect((await screen.findByRole('alert')).textContent).toBe(red);
    expect(screen.getByTestId('oco-manuel-form')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByTestId('oco-manuel-form')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Sil/ }));
    const pencere = (await screen.findByTestId('oco-manuel-sil')).closest(
      '[role="dialog"]',
    ) as HTMLElement;
    fireEvent.click(within(pencere).getByRole('button', { name: 'Sil' }));
    expect((await within(pencere).findByRole('alert')).textContent).toBe(red);
    expect(screen.getByTestId('oco-manuel-sil')).toBeTruthy();
    // Satir listede kalir (bir kez listede, bir kez onay metninde).
    expect(screen.getAllByText('elle 1').length).toBe(2);
  });

  it('OM-U9 kayıt sürerken ikinci gönderim yeni POST açmaz', async () => {
    let birak: () => void = () => {};
    const postBekle = new Promise<void>((r) => {
      birak = r;
    });
    const { cagrilar } = sunucu({ postBekle });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    await screen.findByText('servis 101');
    fireEvent.click(screen.getByTestId('oco-manuel-ekle'));
    const form = await screen.findByTestId('oco-manuel-form');
    fireEvent.change(within(form).getByLabelText('Başlık'), { target: { value: 'tek' } });
    fireEvent.change(within(form).getByLabelText('Başlangıç'), {
      target: { value: '2099-03-04T22:30' },
    });
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(cagrilar.filter((c) => c.method === 'POST').length).toBe(1));
    birak();
    await waitFor(() => expect(screen.queryByTestId('oco-manuel-form')).toBeNull());
    expect(cagrilar.filter((c) => c.method === 'POST').length).toBe(1);
  });

  it('OM-U10 Manuel süzgecinde son olay silinince Tümü geçerli olur, OCO listesi görünür', async () => {
    sunucu({ olaylar: [olay(1)] });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    await screen.findByText('elle 1');
    const manuelDugme = () =>
      [...document.querySelectorAll('[data-testid="oco-iliski"] button')].find((b) =>
        b.textContent?.startsWith('Manuel'),
      ) as HTMLElement | undefined;
    fireEvent.click(manuelDugme()!);
    expect(screen.queryByText('servis 101')).toBeNull();
    fireEvent.click(screen.getByText('elle 1'));
    fireEvent.click(screen.getByRole('button', { name: /Sil/ }));
    const pencere = (await screen.findByTestId('oco-manuel-sil')).closest(
      '[role="dialog"]',
    ) as HTMLElement;
    fireEvent.click(within(pencere).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(screen.queryByText('elle 1')).toBeNull());
    expect(manuelDugme()).toBeUndefined();
    expect(screen.getByText('servis 101')).toBeTruthy();
    const tumu = [...document.querySelectorAll('[data-testid="oco-iliski"] button')][0];
    expect(tumu.getAttribute('aria-checked')).toBe('true');
  });

  it('OM-U11 arama elle olayın OCO no’sunu bulur; Yenile elle olayları da yeniden okur; kırpma uyarısı', async () => {
    const { cagrilar } = sunucu({
      olaylar: [olay(1), olay(2, { ocoNo: '777' })],
      kirpildi: true,
    });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    await screen.findByText('elle 1');
    expect(screen.getByText(/Elle eklenen olaylar/).textContent).toMatch(/eksik.*en yeni 2 olay/);
    fireEvent.change(screen.getByLabelText('OCO takviminde ara'), { target: { value: '777' } });
    expect(screen.getByText('elle 2')).toBeTruthy();
    expect(screen.queryByText('elle 1')).toBeNull();
    expect(screen.queryByText('servis 101')).toBeNull();
    const once = manuelOkumalari(cagrilar);
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(manuelOkumalari(cagrilar)).toBe(once + 1));
  });

  it('OM-U12 takvim ayrıntı panelinde elle olay: iç kimlik yok; OCO no’lu öğe "#777" + manuel', async () => {
    sunucu({
      olaylar: [
        olay(1, { baslangic: bugunOgle(), bitis: null }),
        olay(2, { ocoNo: '777', baslangic: bugunOgle(), bitis: null }),
      ],
    });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    const ogeler = await screen.findAllByTestId('oco-takvim-oge');
    const ocolu = ogeler.find((o) => o.textContent?.includes('elle 2'))!;
    expect(ocolu.textContent).toMatch(/#777/);
    expect(ocolu.textContent).toMatch(/manuel/);
    fireEvent.click(ogeler.find((o) => o.textContent?.includes('elle 1'))!);
    const panel = await screen.findByTestId('oco-takvim-panel');
    expect(panel.textContent).not.toMatch(/#-1|-1/);
    expect(within(panel).queryByRole('button', { name: /kopyala/i })).toBeNull();
    expect(within(panel).getByTestId('oco-manuel-bilgi').textContent).toMatch(/Elle ekleyen ayse/);
    // OCO no'lu elle olayin panelinde kopyalanan/gorunen numara OCO no'dur, ic kimlik (#-2) degil.
    fireEvent.click(ocolu);
    const panel2 = await screen.findByTestId('oco-takvim-panel');
    await waitFor(() => expect(panel2.textContent).toMatch(/elle 2/));
    expect(panel2.textContent).toMatch(/#777/);
    expect(panel2.textContent).not.toMatch(/#-2/);
  });
});
