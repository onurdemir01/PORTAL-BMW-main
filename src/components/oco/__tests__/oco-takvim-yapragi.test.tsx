// src/components/oco/__tests__/oco-takvim-yapragi.test.tsx — OCO Takvimi "takvim yaprağı" görünümü.
// Kullanıcı (2026-11-13): "OCO Takvimi sayfasını mevcut halinin dışında istek halinde gerçek bir
// takvim yaprağı şeklinde gösterebilir miyiz? bazı arkadaşlar o şekilde görmek istiyor".
//   TY1 ızgara matematiği (Pazartesi başlangıcı, Pazar/Pazartesi ile başlayan ay, artık Şubat, 6 satır)
//   TY2 çok günlü OCO yayılımı (gece yarısı bitişi, ters/bozuk bitiş, üst sınır)
//   TY3 yerel gün anahtarı (UTC gününe kaymaz)
//   TY4 hücre taşması "+N daha" ve günün tam listesi
//   TY5 görünüm URL'den (?gorunum=takvim), seçim URL'e ve localStorage'a yazılır; liste varsayılan
//   TY6 süzgeç (arama, ilişki) takvime de uygulanır
//   TY7 öğe tıklanınca listedeki ayrıntının aynısı; tarihsiz kutu; hafta görünümü saatleri
//   TY8 servisin en eski kaydından önceki ay: not gösterilir
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import OcoTakvimiPage, { GORUNUM_ANAHTARI } from '@/components/OcoTakvimiPage';
import {
  ayIzgarasi,
  gunAnahtari,
  gunlereYay,
  haftaGunleri,
  ocoGunleri,
  ocoYayilimi,
  tarihAnahtari,
  tasmaBol,
  YAYILIM_SINIRI,
} from '@/components/oco/takvimIzgara';
import { saatEtiketi } from '@/components/oco/OcoTakvimYapragi';

const yerel = (y: number, m: number, d: number, h = 0, dk = 0) => new Date(y, m - 1, d, h, dk).toISOString();
const gunEkleIso = (iso: string, n: number) => {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).toISOString();
};

describe('TY1 ay ızgarası', () => {
  it('her zaman 6x7, Pazartesi başlar', () => {
    for (let ay = 0; ay < 12; ay++) {
      const g = ayIzgarasi(2026, ay);
      expect(g.length).toBe(42);
      expect(g[0].tarih.getDay()).toBe(1); // Pazartesi
      expect(g.filter((h) => h.ayIci).length).toBe(new Date(2026, ay + 1, 0).getDate());
    }
  });
  it('Pazartesi ile başlayan ay: ilk hücre ayın 1i', () => {
    // 1 Haziran 2026 Pazartesi
    const g = ayIzgarasi(2026, 5);
    expect(g[0].gun).toBe('2026-06-01');
    expect(g[0].ayIci).toBe(true);
  });
  it('Pazar ile başlayan ay: ayın 1i ilk satırın SON hücresi', () => {
    // 1 Kasım 2026 Pazar
    const g = ayIzgarasi(2026, 10);
    expect(g[6].gun).toBe('2026-11-01');
    expect(g.slice(0, 6).every((h) => !h.ayIci)).toBe(true);
    expect(g[0].gun).toBe('2026-10-26');
    expect(g[41].gun).toBe('2026-12-06');
  });
  it('artık Şubat 29 gün, artık olmayan 28', () => {
    expect(ayIzgarasi(2028, 1).filter((h) => h.ayIci).map((h) => h.gun).pop()).toBe('2028-02-29');
    expect(ayIzgarasi(2027, 1).filter((h) => h.ayIci).map((h) => h.gun).pop()).toBe('2027-02-28');
  });
  it('hafta Pazartesi-Pazar; Pazar gününden hesaplanınca önceki Pazartesi', () => {
    const h = haftaGunleri(new Date(2026, 10, 15)); // Pazar
    expect(h.map((x) => x.gun)).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
  });
});

describe('TY2 çok günlü OCO', () => {
  it('bitişi sonraki günlerde olan OCO her güne yayılır', () => {
    expect(ocoGunleri(yerel(2026, 11, 13, 22), yerel(2026, 11, 15, 3))).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
  });
  it('tam gece yarısı biten pencere ertesi güne yayılmaz', () => {
    expect(ocoGunleri(yerel(2026, 11, 13, 20), yerel(2026, 11, 14, 0))).toEqual(['2026-11-13']);
  });
  it('bitiş yok / bozuk / başlangıçtan önce: yalnız başlangıç günü; başlangıç yok: boş', () => {
    expect(ocoGunleri(yerel(2026, 11, 13, 10), null)).toEqual(['2026-11-13']);
    expect(ocoGunleri(yerel(2026, 11, 13, 10), 'bozuk')).toEqual(['2026-11-13']);
    expect(ocoGunleri(yerel(2026, 11, 13, 10), yerel(2026, 11, 12, 10))).toEqual(['2026-11-13']);
    expect(ocoGunleri(null, yerel(2026, 11, 12, 10))).toEqual([]);
  });
  it('yayılım üst sınırı', () => {
    expect(ocoGunleri(yerel(2026, 1, 1, 10), yerel(2030, 1, 1, 10)).length).toBe(YAYILIM_SINIRI);
  });
  it('sınırda kırpılan yayılım: kirpildi bildirilir, son parça SÜRER ve sınırda işaretli', () => {
    expect(ocoYayilimi(yerel(2026, 11, 1, 10), yerel(2027, 6, 1, 10)).kirpildi).toBe(true);
    expect(ocoYayilimi(yerel(2026, 11, 1, 10), yerel(2026, 11, 3, 10)).kirpildi).toBe(false);
    // Tam sınır kadar süren pencere kırpılmış sayılmaz.
    const tam = gunEkleIso(yerel(2026, 11, 1, 10), YAYILIM_SINIRI - 1);
    expect(ocoYayilimi(yerel(2026, 11, 1, 10), tam)).toMatchObject({ kirpildi: false });
    const r = { oco: 9, plannedStart: yerel(2026, 11, 1, 10), plannedEnd: yerel(2027, 6, 1, 10) };
    const { gunler } = gunlereYay([r]);
    const parcalar = [...gunler.values()].flat();
    expect(parcalar.length).toBe(YAYILIM_SINIRI);
    const son = parcalar[parcalar.length - 1];
    expect([son.devam, son.surer, son.sinirda]).toEqual([true, true, true]);
    expect(parcalar.filter((o) => o.sinirda).length).toBe(1);
    expect(saatEtiketi(son as never)).toMatch(/sınırının ötesinde/);
  });
  it('gece yarısı biten çok günlü OCO: son gün etiketi "→ 24:00" (00:00 değil)', () => {
    const r = { oco: 4, plannedStart: yerel(2026, 11, 12, 22), plannedEnd: yerel(2026, 11, 14, 0) };
    const { gunler } = gunlereYay([r]);
    expect([...gunler.keys()]).toEqual(['2026-11-12', '2026-11-13']);
    expect(saatEtiketi(gunler.get('2026-11-12')![0] as never)).toBe('22:00 →');
    expect(saatEtiketi(gunler.get('2026-11-13')![0] as never)).toBe('→ 24:00');
    // Tek günlük, ertesi gece yarısı biten: 20:00–24:00.
    const t = gunlereYay([{ oco: 5, plannedStart: yerel(2026, 11, 13, 20), plannedEnd: yerel(2026, 11, 14, 0) }]);
    expect(saatEtiketi(t.gunler.get('2026-11-13')![0] as never)).toBe('20:00–24:00');
    // Gece yarısı olmayan bitiş değişmez.
    const u = gunlereYay([{ oco: 6, plannedStart: yerel(2026, 11, 12, 22), plannedEnd: yerel(2026, 11, 13, 4) }]);
    expect(saatEtiketi(u.gunler.get('2026-11-13')![0] as never)).toBe('→ 04:00');
  });
  it('gunlereYay: devam/sürer işaretleri, sürenler önce, tarihsizler ayrı', () => {
    const r = (oco: number, s: string | null, e: string | null) => ({ oco, plannedStart: s, plannedEnd: e });
    const { gunler, tarihsiz } = gunlereYay([
      r(1, yerel(2026, 11, 14, 9), null),
      r(2, yerel(2026, 11, 13, 22), yerel(2026, 11, 14, 2)),
      r(3, null, null),
    ]);
    expect(gunler.get('2026-11-13')!.map((o) => [o.row.oco, o.devam, o.surer])).toEqual([[2, false, true]]);
    expect(gunler.get('2026-11-14')!.map((o) => [o.row.oco, o.devam, o.surer])).toEqual([
      [2, true, false],
      [1, false, false],
    ]);
    expect(tarihsiz.map((x) => x.oco)).toEqual([3]);
  });
});

describe('TY3 yerel gün anahtarı', () => {
  it('yerel gece yarısından hemen sonra = o yerel gün (UTC gününe kaymaz)', () => {
    const iso = yerel(2026, 11, 13, 0, 30);
    expect(gunAnahtari(iso)).toBe('2026-11-13');
    expect(tarihAnahtari(new Date(2026, 10, 13, 23, 59))).toBe('2026-11-13');
    expect(ocoGunleri(iso, null)).toEqual(['2026-11-13']);
  });
  it('tasmaBol', () => {
    expect(tasmaBol([1, 2, 3])).toEqual({ gorunen: [1, 2, 3], fazla: 0 });
    expect(tasmaBol([1, 2, 3, 4, 5])).toEqual({ gorunen: [1, 2, 3], fazla: 2 });
  });
});

// ---- Sayfa düzeyi ----
const bugunSaat = (h: number, gunFark = 0, dk = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + gunFark);
  d.setHours(h, dk, 0, 0);
  return d.toISOString();
};
const satir = (oco: number, ek: Record<string, unknown> = {}) => ({
  oco, subject: `konu ${oco}`, explanation: '', statusText: '', statusCode: 0, impactText: '', processText: '',
  pcabRequired: false, plannedStart: bugunSaat(10), plannedEnd: null, actualStart: null, actualEnd: null,
  openedAt: null, iliski: ['sorumlu'], ...ek,
});
const yanit = (rows: unknown[], ek: Record<string, unknown> = {}) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, rows, total: rows.length, fetched: rows.length, truncated: false, eksik: [], ...ek }) })));
};
const hucre = (gun: string) => document.querySelector(`[data-testid="oco-takvim-hucre"][data-gun="${gun}"]`) as HTMLElement;
const bugunKey = () => tarihAnahtari(new Date());

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* yok */ }
});
afterEach(() => vi.unstubAllGlobals());

describe('TY5 görünüm seçimi', () => {
  it('varsayılan LİSTE; takvim yaprağı yok', async () => {
    yanit([satir(1)]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    expect(await screen.findByText('konu 1')).toBeTruthy();
    expect(screen.queryByTestId('oco-takvim')).toBeNull();
    const radyo = within(screen.getByTestId('oco-gorunum')).getByRole('radio', { name: 'Liste' });
    expect(radyo.getAttribute('aria-checked')).toBe('true');
  });
  it('?gorunum=takvim takvim yaprağını açar; Liste düğmesi geri döndürür ve seçim hatırlanır', async () => {
    yanit([satir(1)]);
    const { unmount } = render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    expect(await screen.findByTestId('oco-takvim')).toBeTruthy();
    expect(screen.queryByTestId('oco-gecmis')).toBeNull();
    fireEvent.click(within(screen.getByTestId('oco-gorunum')).getByRole('radio', { name: 'Liste' }));
    expect(screen.queryByTestId('oco-takvim')).toBeNull();
    expect(window.localStorage.getItem(GORUNUM_ANAHTARI)).toBe('liste');
    fireEvent.click(within(screen.getByTestId('oco-gorunum')).getByRole('radio', { name: 'Takvim' }));
    expect(screen.getByTestId('oco-takvim')).toBeTruthy();
    expect(window.localStorage.getItem(GORUNUM_ANAHTARI)).toBe('takvim');
    unmount();
    // Parametresiz yeni ziyaret: son seçim (takvim).
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi'] });
    expect(await screen.findByTestId('oco-takvim')).toBeTruthy();
  });
  it('URL parametresi localStorage seçimini ezer', async () => {
    window.localStorage.setItem(GORUNUM_ANAHTARI, 'takvim');
    yanit([satir(1)]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=liste'] });
    expect(await screen.findByText('konu 1')).toBeTruthy();
    expect(screen.queryByTestId('oco-takvim')).toBeNull();
  });
});

describe('TY4/TY7 takvim yaprağı', () => {
  it('bugün vurgulu; taşma "+N daha" ve günün tam listesi; öğe ayrıntısı listedekiyle aynı', async () => {
    yanit([
      satir(1, { plannedStart: bugunSaat(8), statusText: 'Yönetici Onayı', explanation: 'ayrıntı metni 1', pcabRequired: true }),
      satir(2, { plannedStart: bugunSaat(9) }),
      satir(3, { plannedStart: bugunSaat(10) }),
      satir(4, { plannedStart: bugunSaat(11) }),
      satir(5, { plannedStart: bugunSaat(12) }),
    ]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    await screen.findAllByTestId('oco-takvim-oge');
    const h = hucre(bugunKey());
    expect(h.getAttribute('data-bugun')).toBe('1');
    expect(within(h).getAllByTestId('oco-takvim-oge').length).toBe(3);
    fireEvent.click(within(h).getByText('+2 daha'));
    const panel = screen.getByTestId('oco-takvim-panel');
    expect(within(panel).getAllByTestId('oco-takvim-oge').length).toBe(5);
    fireEvent.click(within(panel).getByRole('button', { name: /OCO 1,/ }));
    const ayrinti = screen.getByTestId('oco-takvim-panel');
    expect(within(ayrinti).getByText('ayrıntı metni 1')).toBeTruthy();
    expect(within(ayrinti).getByText('Yönetici Onayı')).toBeTruthy();
    expect(within(ayrinti).getByText('PCAB')).toBeTruthy();
    expect(within(ayrinti).getByText(/Planlanan:/)).toBeTruthy();
    fireEvent.click(within(ayrinti).getByRole('button', { name: /Kapat/ }));
    expect(screen.queryByTestId('oco-takvim-panel')).toBeNull();
  });

  it('çok günlü OCO her günde, devam parçaları işaretli; tarihsiz kutusu', async () => {
    // Ay sınırına takılmasın diye hafta görünümünde sınanır (bugünün haftası içinde 3 gün).
    const pzt = (() => {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return d;
    })();
    const s = new Date(pzt.getFullYear(), pzt.getMonth(), pzt.getDate() + 1, 22).toISOString();
    const e = new Date(pzt.getFullYear(), pzt.getMonth(), pzt.getDate() + 3, 4).toISOString();
    yanit([satir(7, { plannedStart: s, plannedEnd: e }), satir(8, { plannedStart: null })]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    fireEvent.click(screen.getByRole('radio', { name: 'Hafta' }));
    const ogeler = screen.getAllByRole('button', { name: /^OCO 7,/ });
    expect(ogeler.length).toBe(3);
    expect(ogeler.filter((o) => o.getAttribute('data-devam') === '1').length).toBe(2);
    expect(ogeler[0].textContent).toMatch(/22:00 →/);
    expect(ogeler[2].textContent).toMatch(/→ 04:00/);
    const tarihsiz = screen.getByTestId('oco-takvim-tarihsiz');
    expect(within(tarihsiz).getByText(/konu 8/)).toBeTruthy();
  });

  it('hafta görünümü başlangıç-bitiş saatlerini gösterir', async () => {
    yanit([satir(1, { plannedStart: bugunSaat(10), plannedEnd: bugunSaat(12, 0, 30) })]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    fireEvent.click(screen.getByRole('radio', { name: 'Hafta' }));
    expect(screen.getAllByTestId('oco-takvim-gun').length).toBe(7);
    expect(screen.getByRole('button', { name: /^OCO 1,/ }).textContent).toMatch(/10:00–12:30/);
  });
});

describe('TY9 klavye: odak geri dönüşü, Escape, seçili işareti, +N adı', () => {
  it('öğe -> Kapat: odak tetikleyen öğeye döner; seçili öğe aria-pressed', async () => {
    yanit([satir(1, { plannedStart: bugunSaat(8) }), satir(2, { plannedStart: bugunSaat(9) })]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    await screen.findAllByTestId('oco-takvim-oge');
    const oge = within(hucre(bugunKey())).getByRole('button', { name: /^OCO 2,/ });
    oge.focus();
    fireEvent.click(oge);
    const panel = screen.getByTestId('oco-takvim-panel');
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(oge.getAttribute('aria-pressed')).toBe('true');
    expect(within(hucre(bugunKey())).getByRole('button', { name: /^OCO 1,/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(panel).getByRole('button', { name: /Kapat/ }));
    expect(screen.queryByTestId('oco-takvim-panel')).toBeNull();
    expect(document.activeElement).toBe(oge);
    expect(oge.getAttribute('aria-pressed')).toBe('false');
  });
  it('+N -> günün listesi -> öğe -> Escape: odak ilk tetikleyiciye (+N) döner', async () => {
    yanit([1, 2, 3, 4, 5].map((n) => satir(n, { plannedStart: bugunSaat(7 + n) })));
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    await screen.findAllByTestId('oco-takvim-oge');
    const h = hucre(bugunKey());
    const fazla = within(h).getByText('+2 daha');
    // Erişilebilir ad gün numarası düğmesinden FARKLI ve gizli sayıyı söyler.
    expect(fazla.getAttribute('aria-label')).toMatch(/2 OCO daha gizli, günün tüm 5 OCO'sunu aç/);
    const gunNo = within(h).getAllByRole('button').find((b) => /günün tüm listesini aç/.test(b.getAttribute('aria-label') || ''))!;
    expect(gunNo.getAttribute('aria-label')).not.toBe(fazla.getAttribute('aria-label'));
    fazla.focus();
    fireEvent.click(fazla);
    const panel = screen.getByTestId('oco-takvim-panel');
    const ic = within(panel).getByRole('button', { name: /^OCO 5,/ });
    ic.focus();
    fireEvent.click(ic);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('oco-takvim-panel')).toBeNull();
    expect(document.activeElement).toBe(fazla);
  });
  it('tetikleyici DOM\'dan kalkmışsa odak takvim başlığına', async () => {
    yanit([satir(1, { plannedStart: null })]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim-tarihsiz');
    const oge = within(screen.getByTestId('oco-takvim-tarihsiz')).getByRole('button');
    oge.focus();
    fireEvent.click(oge);
    // Tetikleyiciyi kaldır (ör. veri yenilendi ve öğe kalktı).
    oge.remove();
    fireEvent.click(within(screen.getByTestId('oco-takvim-panel')).getByRole('button', { name: /Kapat/ }));
    expect(document.activeElement).toBe(screen.getByTestId('oco-takvim-baslik'));
  });
});

describe('TY10 dar ekran ajandası boş metni', () => {
  const darEkran = () =>
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  it('süzgeç ayın OCO\'larını gizliyorsa "süzgece uyan OCO yok"', async () => {
    darEkran();
    yanit([satir(1, { subject: 'nginx yenileme' })]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim-ajanda');
    await screen.findAllByTestId('oco-takvim-oge');
    fireEvent.change(screen.getByLabelText('OCO takviminde ara'), { target: { value: 'yokboylebirsey' } });
    expect(screen.getByTestId('oco-takvim-ajanda-bos').textContent).toBe('Bu ayda süzgece uyan OCO yok.');
  });
  it('servisin en eski kaydından önceki ay: kesin "OCO yok" demez', async () => {
    darEkran();
    yanit([satir(1)]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim-ajanda');
    await screen.findAllByTestId('oco-takvim-oge');
    fireEvent.click(screen.getByRole('button', { name: 'Önceki ay' }));
    expect(screen.getByTestId('oco-takvim-gecmis-notu')).toBeTruthy();
    expect(screen.getByTestId('oco-takvim-ajanda-bos').textContent).toBe('Bu ay için servis veri döndürmedi.');
  });
  it('liste eksikse "görünen OCO yok (liste eksik olabilir)"', async () => {
    darEkran();
    yanit([satir(1)], { truncated: true });
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim-ajanda');
    await screen.findAllByTestId('oco-takvim-oge');
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }));
    expect(screen.getByTestId('oco-takvim-ajanda-bos').textContent).toBe('Bu ayda görünen OCO yok (liste eksik olabilir).');
  });
  it('gerçekten boş ay (servis kapsıyor, süzgeç yok, eksik değil): "Bu ayda OCO yok."', async () => {
    darEkran();
    yanit([satir(1)]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim-ajanda');
    await screen.findAllByTestId('oco-takvim-oge');
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }));
    expect(screen.getByTestId('oco-takvim-ajanda-bos').textContent).toBe('Bu ayda OCO yok.');
  });
});

describe('TY6 süzgeçler takvime de uygulanır', () => {
  it('arama ve ilişki', async () => {
    yanit([
      satir(1, { subject: 'nginx yenileme', iliski: ['acan'] }),
      satir(2, { subject: 'jboss yaması', iliski: ['sorumlu'] }),
    ]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    await screen.findAllByTestId('oco-takvim-oge');
    expect(screen.getAllByTestId('oco-takvim-oge').length).toBe(2);
    fireEvent.change(screen.getByLabelText('OCO takviminde ara'), { target: { value: 'nginx' } });
    expect(screen.getAllByTestId('oco-takvim-oge').length).toBe(1);
    expect(screen.getByRole('button', { name: /^OCO 1,/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('OCO takviminde ara'), { target: { value: '' } });
    fireEvent.click(within(screen.getByTestId('oco-iliski')).getByRole('radio', { name: /Bize açılan/ }));
    expect(screen.getAllByTestId('oco-takvim-oge').length).toBe(1);
    expect(screen.getByRole('button', { name: /^OCO 2,/ })).toBeTruthy();
  });
});

describe('TY8 geçmiş', () => {
  it('servisin en eski kaydından önceki ay boş değil "kayıt yok" notu gösterir; Bugün geri getirir', async () => {
    // En eski kayit 40 gun once: bu ay ve gecen ay notsuz (40 gun > bir ay), iki ay oncesi notlu.
    yanit([satir(1), satir(2, { plannedStart: bugunSaat(10, -40) })]);
    render(<OcoTakvimiPage />, { initialEntries: ['/oco-takvimi?gorunum=takvim'] });
    await screen.findByTestId('oco-takvim');
    await screen.findAllByTestId('oco-takvim-oge');
    const baslik = screen.getByTestId('oco-takvim-baslik').textContent;
    expect(screen.queryByTestId('oco-takvim-gecmis-notu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Önceki ay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Önceki ay' }));
    expect(screen.getByTestId('oco-takvim-baslik').textContent).not.toBe(baslik);
    expect(screen.getByTestId('oco-takvim-gecmis-notu').textContent).toMatch(/en eski OCO/);
    fireEvent.click(screen.getByRole('button', { name: 'Bugün' }));
    expect(screen.getByTestId('oco-takvim-baslik').textContent).toBe(baslik);
  });
});
