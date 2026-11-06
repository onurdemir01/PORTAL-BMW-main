// src/components/server_hub/__tests__/ear-tablo.test.tsx — Uygulama Envanteri ortak tablosu (EarTablo).
//
//   ET1 sıralama: artan → azalan → kapalı; aria-sort; sunucuya s gider
//   ET2 seçim süzgeci: değer listesi ÖTEKİ süzgeçlerle istenir (kendisi hariç); çoklu seçim + "(boş)" → f; çip ve
//       tek tıkla kaldırma; süzgeç değişince sayfa başa döner; açılır listede kolonun kendi süzgeci yok
//   ET3 sayı süzgecinde en az ve en çok birlikte; metin içerir; evet / hayır
//   ET4 kolon seçici: gizle / göster / varsayılana dön; localStorage'da kalır; depolama atarsa yine çalışır
//   ET5 sayfalama: kesin sayaç, sonraki / son sayfa, sayfa boyu değişince başa döner ve kalır
//   ET6 satır seçimi: eylem seçili satırları alır; CSV hücresi formül enjeksiyonuna kapalı
//   ET7 yerel süzgeç anlamı sunucudakiyle aynı (in + boş, içerir büyük/küçük harf, gün, eksik, min/max boşta yok)
//   ET8 yerel kip: arama anında; değer listesi satırlardan, öteki süzgeçlere göre
//   ET9 okunamadı → tekrar dene (boş liste gösterilmez)
//   ET10 çok değerli kolon (dizi): öğelerden biri uyarsa satır uyar, boş dizi boş değerdir; düz hâl " + "
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import {
  EarTablo,
  duzDeger,
  formulGuvenli,
  yerelUyar,
  suzgecMetni,
  type EarKolon,
  type GetirParam,
} from '@/components/server_hub/EarTablo';

interface Satir {
  id: number;
  ad: string | null;
  sayi: number | null;
  durum: string;
  tarih: string | null;
  bayrak: boolean;
}
const KOLONLAR: EarKolon<Satir>[] = [
  {
    anahtar: 'ad',
    baslik: 'Ad',
    aciklama: 'Satırın adı.',
    suzgec: 'secim',
    sirala: true,
    hucre: (r) => r.ad ?? '—',
    deger: (r) => r.ad,
  },
  {
    anahtar: 'sayi',
    baslik: 'Sayı',
    aciklama: 'Bir sayı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (r) => r.sayi ?? '—',
    deger: (r) => r.sayi,
  },
  {
    anahtar: 'durum',
    baslik: 'Durum',
    aciklama: 'Durum kodu.',
    suzgec: 'secim',
    secenekler: [
      { deger: 'TAM', etiket: 'tam' },
      { deger: 'KISMI', etiket: 'kısmi' },
    ],
    hucre: (r) => r.durum,
    deger: (r) => r.durum,
  },
  {
    anahtar: 'not',
    baslik: 'Not',
    aciklama: 'Serbest metin.',
    suzgec: 'metin',
    varsayilan: false,
    hucre: (r) => r.ad,
    deger: (r) => r.ad,
  },
  {
    anahtar: 'bayrak',
    baslik: 'Bayrak',
    aciklama: 'Evet / hayır.',
    suzgec: 'bit',
    varsayilan: false,
    hucre: (r) => String(r.bayrak),
    deger: (r) => r.bayrak,
  },
];
const satir = (id: number, o: Partial<Satir> = {}): Satir => ({
  id,
  ad: `A${id}`,
  sayi: id,
  durum: 'TAM',
  tarih: null,
  bayrak: false,
  ...o,
});

let istekler: GetirParam[] = [];
const getir = vi.fn(async (p: GetirParam) => {
  istekler.push(p);
  return {
    satirlar: Array.from({ length: Math.min(p.limit, 3) }, (_, i) => satir(p.offset + i + 1)),
    toplam: 48213,
  };
});

beforeEach(() => {
  istekler = [];
  getir.mockClear();
  window.localStorage.clear();
});

const tablo = (ek: Partial<React.ComponentProps<typeof EarTablo<Satir>>> = {}) =>
  render(
    <EarTablo<Satir>
      kimlik="test"
      kolonlar={KOLONLAR}
      getir={getir}
      satirAnahtari={(r) => String(r.id)}
      {...ek}
    />,
  );

describe('EarTablo', () => {
  it('ET1 sıralama', async () => {
    tablo();
    await screen.findByText('A1');
    const ad = screen.getByRole('button', { name: 'Ad' });
    fireEvent.click(ad);
    await waitFor(() => expect(istekler.at(-1)!.s).toBe('ad:asc'));
    expect(ad.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Ad' }));
    await waitFor(() => expect(istekler.at(-1)!.s).toBe('ad:desc'));
    fireEvent.click(screen.getByRole('button', { name: 'Ad' }));
    await waitFor(() => expect(istekler.at(-1)!.s).toBe(''));
    expect(screen.queryByRole('button', { name: 'Durum' })).toBeNull();
  });

  it('ET2 seçim süzgeci', async () => {
    const degerler = vi.fn(async () => ({
      degerler: [
        { deger: 'A1', sayi: 5 },
        { deger: null, sayi: 2 },
      ],
      farkli: 900,
    }));
    tablo({ degerler });
    await screen.findByText('A1');
    // Süzgeç değişince sayfa başa döner (2. sayfadan başlanır).
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    await waitFor(() => expect(istekler.at(-1)!.offset).toBe(100));
    fireEvent.click(screen.getByRole('button', { name: 'Sayı süz' }));
    fireEvent.change(screen.getByLabelText('Sayı en az'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ad süz' }));
    const p = await screen.findByRole('dialog', { name: 'Ad süzgeci' });
    await within(p).findByText('900 farklı değerden en sık 2 tanesi; aradığınızı yazın.', {
      exact: false,
    });
    expect(degerler).toHaveBeenLastCalledWith('ad', '', [{ k: 'sayi', op: 'min', v: 3 }], '');
    fireEvent.click(within(p).getByLabelText('Ad: A1'));
    fireEvent.click(within(p).getByLabelText('Ad: (boş)'));
    fireEvent.click(within(p).getByRole('button', { name: 'Uygula' }));
    await waitFor(() =>
      expect(istekler.at(-1)!.f).toEqual([
        { k: 'sayi', op: 'min', v: 3 },
        { k: 'ad', op: 'in', v: ['A1', null] },
      ]),
    );
    expect(istekler.at(-1)!.offset).toBe(0);
    expect(screen.getByText('A1, (boş)')).toBeInTheDocument();
    // Değer listesi kolonun KENDİ süzgecini taşımaz (seçili değerler listede kalsın).
    fireEvent.click(screen.getByRole('button', { name: 'Ad süz' }));
    const p2 = await screen.findByRole('dialog', { name: 'Ad süzgeci' });
    await waitFor(() =>
      expect(degerler).toHaveBeenLastCalledWith('ad', '', [{ k: 'sayi', op: 'min', v: 3 }], ''),
    );
    expect(within(p2).getByLabelText('Ad: A1')).toBeChecked();
    fireEvent.click(within(p2).getByRole('button', { name: 'Uygula' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ad süzgecini kaldır' }));
    await waitFor(() => expect(istekler.at(-1)!.f).toEqual([{ k: 'sayi', op: 'min', v: 3 }]));
    fireEvent.click(screen.getByText('tümünü temizle'));
    await waitFor(() => expect(istekler.at(-1)!.f).toEqual([]));
  });

  it('ET3 sayı aralığı, metin, evet/hayır, sabit seçenekler', async () => {
    tablo();
    await screen.findByText('A1');
    fireEvent.click(screen.getByRole('button', { name: 'Sayı süz' }));
    fireEvent.change(screen.getByLabelText('Sayı en az'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Sayı en çok'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    await waitFor(() =>
      expect(istekler.at(-1)!.f).toEqual([
        { k: 'sayi', op: 'min', v: 2 },
        { k: 'sayi', op: 'max', v: 9 },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Durum süz' }));
    const p = await screen.findByRole('dialog', { name: 'Durum süzgeci' });
    fireEvent.click(await within(p).findByLabelText('Durum: kısmi'));
    fireEvent.click(within(p).getByRole('button', { name: 'Uygula' }));
    await waitFor(() =>
      expect(istekler.at(-1)!.f).toContainEqual({ k: 'durum', op: 'in', v: ['KISMI'] }),
    );
    expect(screen.getByText('kısmi')).toBeInTheDocument();
    expect(suzgecMetni({ k: 'x', op: 'icerir', v: 'abc' })).toBe('içerir "abc"');
    expect(suzgecMetni({ k: 'x', op: 'in', v: ['a', 'b', 'c', 'd', 'e'] })).toBe('a, b, c +2');
  });

  it('ET4 kolon seçici kalıcı; depolama atarsa yine çalışır', async () => {
    const { unmount } = tablo();
    await screen.findByText('A1');
    expect(screen.queryByRole('columnheader', { name: /Not/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Kolonlar \(3\/5\)/ }));
    const p = screen.getByRole('dialog', { name: 'Kolon seçimi' });
    fireEvent.click(within(p).getByLabelText('kolon: Not'));
    fireEvent.click(within(p).getByLabelText('kolon: Sayı'));
    expect(screen.getByRole('columnheader', { name: /Not/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Sayı/ })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('ear-tablo:test')!).gorunur).toEqual([
      'ad',
      'durum',
      'not',
    ]);
    unmount();
    tablo();
    await screen.findAllByText('A1');
    expect(screen.getByRole('columnheader', { name: /Not/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Kolonlar/ }));
    fireEvent.click(screen.getByText('varsayılana dön'));
    expect(screen.getByRole('columnheader', { name: /Sayı/ })).toBeInTheDocument();
    const asil = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('engelli');
    };
    try {
      tablo({ kimlik: 'baska' });
      expect(await screen.findAllByText('A1')).not.toHaveLength(0);
    } finally {
      Storage.prototype.getItem = asil;
    }
  });

  it('ET5 sayfalama', async () => {
    tablo();
    expect(await screen.findByText('1–100 / 48.213')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    await waitFor(() => expect(istekler.at(-1)!.offset).toBe(100));
    expect(await screen.findByText('101–200 / 48.213')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'son sayfa' }));
    await waitFor(() => expect(istekler.at(-1)!.offset).toBe(48200));
    fireEvent.change(screen.getByLabelText('sayfa boyu'), { target: { value: '250' } });
    await waitFor(() => expect(istekler.at(-1)).toMatchObject({ limit: 250, offset: 0 }));
    expect(JSON.parse(window.localStorage.getItem('ear-tablo:test')!).sayfaBoyu).toBe(250);
  });

  it('ET6 satır seçimi ve formül güvenliği', async () => {
    const eylem = vi.fn(() => null);
    tablo({ secimEylemleri: eylem });
    await screen.findByText('A1');
    fireEvent.click(screen.getByLabelText('seç: 1'));
    fireEvent.click(screen.getByLabelText('seç: 3'));
    expect(screen.getByText('2 satır seçili')).toBeInTheDocument();
    expect(eylem).toHaveBeenLastCalledWith([satir(1), satir(3)], expect.any(Function));
    fireEvent.click(screen.getByLabelText('sayfadakilerin hepsini seç'));
    expect(screen.getByText('3 satır seçili')).toBeInTheDocument();
    for (const [g, c] of [
      ['=1+1', "'=1+1"],
      ['+cmd', "'+cmd"],
      ['-x', "'-x"],
      ['@SUM', "'@SUM"],
      ['\tx', "'\tx"],
      ['ORNEK.ear', 'ORNEK.ear'],
      [null, ''],
    ] as const)
      expect(formulGuvenli(g)).toBe(c);
  });

  it('ET7 yerel süzgeç anlamı', () => {
    expect(yerelUyar(null, { k: 'x', op: 'in', v: [null] })).toBe(true);
    expect(yerelUyar('', { k: 'x', op: 'in', v: [null] })).toBe(true);
    expect(yerelUyar('PROD', { k: 'x', op: 'in', v: ['PREPROD'] })).toBe(false);
    expect(yerelUyar('PROD', { k: 'x', op: 'in', v: [null, 'PROD'] })).toBe(true);
    expect(yerelUyar('Log4J-Core', { k: 'x', op: 'icerir', v: 'log4j' })).toBe(true);
    expect(yerelUyar(null, { k: 'x', op: 'min', v: 0 })).toBe(false);
    expect(yerelUyar(5, { k: 'x', op: 'max', v: 5 })).toBe(true);
    expect(yerelUyar('KISMI_SINIR', { k: 'x', op: 'eksik' })).toBe(true);
    expect(yerelUyar('TAM', { k: 'x', op: 'eksik' })).toBe(false);
    const simdi = Date.parse('2026-11-05T12:00:00Z');
    expect(yerelUyar('2026-11-01T00:00:00', { k: 'x', op: 'gun', v: 7 }, simdi)).toBe(true);
    expect(yerelUyar('2026-10-01T00:00:00', { k: 'x', op: 'gun', v: 7 }, simdi)).toBe(false);
    expect(yerelUyar(null, { k: 'x', op: 'gun', v: 7 }, simdi)).toBe(false);
    expect(yerelUyar(1, { k: 'x', op: 'evet' })).toBe(true);
    expect(yerelUyar(null, { k: 'x', op: 'hayir' })).toBe(true);
  });

  it('ET10 çok değerli kolon: öğelerden biri uyarsa satır uyar; boş dizi boş değerdir', () => {
    const l = ['R1 · a', 'R8 · b'];
    expect(yerelUyar(l, { k: 'x', op: 'in', v: ['R8 · b'] })).toBe(true);
    expect(yerelUyar(l, { k: 'x', op: 'in', v: ['R9 · c'] })).toBe(false);
    expect(yerelUyar(l, { k: 'x', op: 'in', v: [null] })).toBe(false);
    expect(yerelUyar([], { k: 'x', op: 'in', v: [null] })).toBe(true);
    expect(yerelUyar(l, { k: 'x', op: 'icerir', v: 'r8' })).toBe(true);
    expect(yerelUyar(l, { k: 'x', op: 'bos' })).toBe(false);
    expect(yerelUyar([], { k: 'x', op: 'bos' })).toBe(true);
    expect(yerelUyar(l, { k: 'x', op: 'dolu' })).toBe(true);
    expect(yerelUyar([], { k: 'x', op: 'dolu' })).toBe(false);
    expect(duzDeger(l)).toBe('R1 · a + R8 · b');
    expect(duzDeger([])).toBe(null);
    expect(duzDeger('tek')).toBe('tek');
  });

  it('ET8 yerel kip', async () => {
    render(
      <EarTablo<Satir>
        kimlik="yerel"
        kolonlar={KOLONLAR}
        satirlar={[satir(1, { durum: 'KISMI' }), satir(2), satir(3, { ad: null })]}
        satirAnahtari={(r) => String(r.id)}
      />,
    );
    expect(screen.getByText('1–3 / 3')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ara'), { target: { value: 'a2' } });
    expect(screen.getByText('1–1 / 1')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ara'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Durum süz' }));
    fireEvent.click(await screen.findByLabelText('Durum: tam'));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(screen.getByText('1–2 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ad süz' }));
    const p = await screen.findByRole('dialog', { name: 'Ad süzgeci' });
    expect(await within(p).findByLabelText('Ad: A2')).toBeInTheDocument();
    expect(within(p).queryByLabelText('Ad: A1')).toBeNull();
    fireEvent.click(within(p).getByLabelText('Ad: (boş)'));
    fireEvent.click(within(p).getByRole('button', { name: 'Uygula' }));
    expect(screen.getByText('1–1 / 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sayı' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sayı' }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('ET9 okunamadı ve tekrar dene', async () => {
    let n = 0;
    const kotu = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('sunucu yok');
      return { satirlar: [satir(1)], toplam: 1 };
    });
    tablo({ getir: kotu });
    expect(await screen.findByText('Liste okunamadı')).toBeInTheDocument();
    expect(screen.queryByText('Kayıt bulunamadı.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tekrar|Yeniden/ }));
    expect(await screen.findByText('A1')).toBeInTheDocument();
  });
});
