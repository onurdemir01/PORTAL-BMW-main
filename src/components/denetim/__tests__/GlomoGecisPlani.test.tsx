// src/components/denetim/__tests__/GlomoGecisPlani.test.tsx — Glomo Gecis Plani ekrani (2026-10-13).
// 2026-10-16: ustte yalniz Set 7 (Set 1-6 katlanir "Tamamlanan calismalar"); butun tablolar ayni
// 7 kolon (Uygulama | Ekip / e-posta | Location | Yuk | Kullanimda mi? | Calismaya katilacak kisi |
// Kontrol); "Kontrol Ettim" dugmesi (aciklama yok) + geri al; satirda set / gecti / gecis tarihi ve
// set basliginda "Setin tumu gecti" YOK; Set 7 talebinde planda bulunamayanlar yalniz Admin'e.
// Denetim (2026-10-16): Kontrol kolonu saga yapisik (dar ekranda kirpilmaz), odak korunur, ag
// hatasi toast'a cikar, girisler birbirini ezmez, basliklar h2, goc durumu Admin'e uyari.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import GlomoGecisPlani from '@/components/GlomoGecisPlani';
import type { GecisPlani, GecisUygulama } from '@/api/arkSpaApi';
import { fmtDateTime } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';

const mockGecis = vi.hoisted(() => vi.fn());
const mockApp = vi.hoisted(() => vi.fn());
const mockKontrol = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn());
vi.mock('@/api/arkSpaApi', () => ({
  arkSpaApi: { gecis: mockGecis, gecisApp: mockApp, gecisKontrol: mockKontrol, gecisSet: mockSet },
}));

const KOLONLAR = ['Uygulama', 'Ekip / e-posta', 'Location', 'Yük', 'Kullanımda mı?', 'Çalışmaya katılacak kişi', 'Kontrol'];
const KONTROL_AN = '2026-10-16T08:30:00.000Z';
const ETTIM = 'yedi-app (ns-prod) kontrol ettim';
const GERI_AL = 'yedi-app (ns-prod) kontrol işaretini geri al';
const KISI = 'yedi-app (ns-prod) çalışmaya katılacak kişi';

const app = (application: string, o: Partial<GecisUygulama> = {}): GecisUygulama => ({
  namespace: 'ns-prod', application, setNo: 6, kaynak: 'excel', kullanimda: null, katilimci: '', gecti: false,
  gecisTarihi: null, kontrolAt: null, ekip: ['GT-Ekip'], locations: [`/${application}/`], yuk: null, taramadaYok: false, ...o,
});
const plan = (admin: boolean): GecisPlani => ({
  ok: true, raporVar: true, admin,
  sets: [1, 2, 3, 4, 5, 6, 7].map((no) => ({ no, calismaAt: no === 7 ? '2026-10-22T23:00' : null, ocoNo: no === 7 ? 'OCO-777' : '' })),
  apps: [
    app('alti-app'),
    app('yedi-app', { setNo: 7, kaynak: 'portal' }),
    app('gecen-app', { setNo: 3, gecti: true, gecisTarihi: '2026-10-01', katilimci: 'Veli' }),
  ],
  talepEslesmeyen: [{ namespace: 'fund-management-ch-prod', application: 'smart-saving-app-v0' }],
  goc: { ad: 'set7-talep-2026-10-16', uygulandi: true, hata: null },
});
const tamamlananAc = () => fireEvent.click(screen.getByRole('button', { name: /Tamamlanan çalışmalar \(Set 1–6\)/ }));

describe('GlomoGecisPlani', () => {
  beforeEach(() => { mockGecis.mockReset(); mockApp.mockReset(); mockKontrol.mockReset(); mockSet.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('ustte yalniz Set 7 (calisma zamani + OCO); Set 6 katlanir "Tamamlanan calismalar (Set 1–6)" bolumunde; gecen en altta', async () => {
    mockGecis.mockResolvedValue(plan(false));
    render(<GlomoGecisPlani />);
    expect(await screen.findByText('22.10.2026 23:00')).toBeInTheDocument();
    expect(screen.getByText('OCO-777')).toBeInTheDocument();
    const setBasliklari = () => screen.getAllByRole('heading', { name: /^Set \d$/ }).map((h) => h.textContent);
    expect(setBasliklari()).toEqual(['Set 7']);
    expect(screen.queryByText('alti-app')).not.toBeInTheDocument();
    expect(screen.getByText('Excel’de yoktu → eklendi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tamamlanan çalışmalar \(Set 1–6\) — 1 uygulama/ })).toBeInTheDocument();
    tamamlananAc();
    expect(setBasliklari()).toEqual(['Set 7', 'Set 6']);
    expect(screen.getByText('alti-app')).toBeInTheDocument();
    const metin = document.body.textContent || '';
    expect(metin.indexOf('yedi-app')).toBeLessThan(metin.indexOf('alti-app'));
    expect(metin.indexOf('alti-app')).toBeLessThan(metin.indexOf('gecen-app'));
    expect(metin.indexOf('Geçen uygulamalar')).toBeLessThan(metin.indexOf('gecen-app'));
  });

  it('ust aciklama guncel: Set 1–6 tamamlandi, kalan Set 7', async () => {
    mockGecis.mockResolvedValue(plan(false));
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    const metin = document.body.textContent || '';
    expect(metin).toContain('Set 1–6 tamamlandı');
    expect(metin).toMatch(/kalan çalışma Set 7/);
    expect(metin).not.toMatch(/6 ve 7/);
  });

  it('basliklar: set basliklari ve "Gecen uygulamalar" h2 (h1 sayfada); set basligi kalin ve govde yazi tipinde', async () => {
    mockGecis.mockResolvedValue(plan(false));
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    tamamlananAc();
    const setler = screen.getAllByRole('heading', { level: 2, name: /^Set \d$/ });
    expect(setler.map((h) => h.textContent)).toEqual(['Set 7', 'Set 6']);
    expect(screen.getByRole('heading', { level: 2, name: /Geçen uygulamalar/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    // index.css'teki katmansiz h1..h6 kurali (500, display yazi tipi) font-bold'u ezer: satir ici stil sart.
    for (const h of setler) {
      expect(h.style.fontWeight).toBe('700');
      expect(h.style.fontFamily).toBe('inherit');
    }
  });

  it.each([false, true])('butun tablolar TAM 7 kolon, bu sirayla (admin=%s)', async (admin) => {
    mockGecis.mockResolvedValue(plan(admin));
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    tamamlananAc();
    const tablolar = screen.getAllByRole('table');
    expect(tablolar).toHaveLength(3); // Set 7, Set 6 (tamamlanan), Gecen uygulamalar
    for (const t of tablolar) {
      expect(within(t).getAllByRole('columnheader').map((h) => (h.textContent || '').trim())).toEqual(KOLONLAR);
      for (const satir of within(t).getAllByRole('row').slice(1)) expect(within(satir).getAllByRole('cell')).toHaveLength(KOLONLAR.length);
    }
  });

  it('Kontrol kolonu dar ekranda kirpilmaz: saga yapisik (th + td) ve tablo en az genisligi <= 64rem', async () => {
    mockGecis.mockResolvedValue(plan(false));
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    for (const t of screen.getAllByRole('table')) {
      const minW = /min-w-\[(\d+(?:\.\d+)?)rem\]/.exec(t.className);
      expect(minW, 'tablonun min-w siniri yok').not.toBeNull();
      expect(Number(minW![1])).toBeLessThanOrEqual(64);
      const sonlar = [within(t).getAllByRole('columnheader').at(-1)!, ...within(t).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').at(-1)!)];
      for (const h of sonlar) {
        expect(h.className).toMatch(/\bsticky\b/);
        expect(h.className).toMatch(/\bright-0\b/);
        // Zemin opak bir tema rengi (seffaf olsa alttan kayan hucreler gorunur).
        expect(h.style.background).toMatch(/^var\(--bg-/);
        // Ayrac hucreyle birlikte kaymali: border-collapse tabloda yapisik hucrenin border-l'i
        // kayarken cizilmiyor (2026-10-16 denetim), ayrac ic golge.
        expect(h.className).not.toMatch(/\bborder-l\b/);
        expect(h.style.boxShadow).toMatch(/^inset 1px 0 0 var\(--border/);
      }
    }
  });

  it('Kontrol Ettim -> API cagrisi + "Kontrol edildi" ve an; geri al -> isaret kalkar; odak karsi dugmeye gecer', async () => {
    mockGecis.mockResolvedValue(plan(false));
    mockKontrol.mockResolvedValueOnce({ ok: true, kontrolAt: KONTROL_AN }).mockResolvedValueOnce({ ok: true, kontrolAt: null });
    render(<GlomoGecisPlani />);
    const ettim = await screen.findByRole('button', { name: ETTIM });
    ettim.focus();
    fireEvent.click(ettim);
    await waitFor(() => expect(mockKontrol).toHaveBeenCalledWith({ namespace: 'ns-prod', application: 'yedi-app', kontrol: true }));
    expect(await screen.findByText('Kontrol edildi')).toBeInTheDocument();
    expect(screen.getByText(fmtDateTime(KONTROL_AN))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ETTIM })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /açıklama/i })).not.toBeInTheDocument();
    const geri = screen.getByRole('button', { name: GERI_AL });
    await waitFor(() => expect(document.activeElement).toBe(geri));
    // Dokunmatik hedef: en az 24px yukseklik.
    expect(geri.className).toMatch(/\bmin-h-6\b/);
    fireEvent.click(geri);
    await waitFor(() => expect(mockKontrol).toHaveBeenLastCalledWith({ namespace: 'ns-prod', application: 'yedi-app', kontrol: false }));
    const yeniden = await screen.findByRole('button', { name: ETTIM });
    expect(screen.queryByText('Kontrol edildi')).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(yeniden));
  });

  // Odak yarisi (2026-10-16 denetim tur 2): dugme DOM'a girdigi gorevde (React'in pasif effect'leri
  // kosmadan) tiklaninca odak istegi bayat mount effect'ince tuketiliyor, basari sonrasi odak
  // BODY'ye dusuyordu. MutationObserver tiklamayi tam o ana koyar; uc tekrar.
  it.each([1, 2, 3])('dugme gorundugu gorevde tiklansa da odak "geri al"a gecer (%i)', async () => {
    mockGecis.mockResolvedValue(plan(false));
    mockKontrol.mockResolvedValue({ ok: true, kontrolAt: KONTROL_AN });
    const tiklandi = new Promise<void>((coz) => {
      const mo = new MutationObserver(() => {
        const b = document.querySelector<HTMLButtonElement>(`button[aria-label="${ETTIM}"]`);
        if (!b) return;
        mo.disconnect();
        b.focus();
        b.click();
        coz();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
    render(<GlomoGecisPlani />);
    await tiklandi;
    const geri = await screen.findByRole('button', { name: GERI_AL });
    await waitFor(() => expect(document.activeElement).toBe(geri));
  });

  it('kontrol edilmis uygulama yuklenince "Kontrol edildi" + an gorunur; API hatasinda isaret konmaz, odak dugmede kalir', async () => {
    const p = plan(false);
    p.apps![1].kontrolAt = KONTROL_AN;
    p.apps!.push(app('yedi-iki', { setNo: 7 }));
    mockGecis.mockResolvedValue(p);
    mockKontrol.mockResolvedValue({ ok: false, message: 'Uygulama planda yok.' });
    render(<GlomoGecisPlani />);
    expect(await screen.findByText('Kontrol edildi')).toBeInTheDocument();
    const d = screen.getByRole('button', { name: 'yedi-iki (ns-prod) kontrol ettim' });
    d.focus();
    fireEvent.click(d);
    await waitFor(() => expect(mockKontrol).toHaveBeenCalled());
    expect(screen.getAllByText('Kontrol edildi')).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'yedi-iki (ns-prod) kontrol ettim' })));
  });

  it('ag hatasi (fetch reddi) sessiz kalmaz: Kontrol ve kullanimda icin toast.error', async () => {
    const hata = vi.spyOn(toast, 'error');
    mockGecis.mockResolvedValue(plan(false));
    mockKontrol.mockRejectedValue(new TypeError('Failed to fetch'));
    mockApp.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<GlomoGecisPlani />);
    fireEvent.click(await screen.findByRole('button', { name: ETTIM }));
    await waitFor(() => expect(hata).toHaveBeenCalledWith(expect.stringMatching(/bağlantı hatası/)));
    expect(screen.queryByText('Kontrol edildi')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: ETTIM })).not.toBeDisabled();
    hata.mockClear();
    fireEvent.click(within(screen.getByRole('group', { name: 'yedi-app (ns-prod) kullanımda mı?' })).getByRole('button', { name: 'Evet' }));
    await waitFor(() => expect(hata).toHaveBeenCalledWith(expect.stringMatching(/bağlantı hatası/)));
  });

  it('ag hatasi: Admin set basligi "Kaydet" de sessiz kalmaz (toast.error, basari mesaji yok)', async () => {
    const hata = vi.spyOn(toast, 'error');
    const basari = vi.spyOn(toast, 'success');
    mockGecis.mockResolvedValue(plan(true));
    mockSet.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<GlomoGecisPlani />);
    const oco = await screen.findByDisplayValue('OCO-777');
    fireEvent.change(oco, { target: { value: 'OCO-778' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Kaydet' })[0]);
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith({ no: 7, calismaAt: '2026-10-22T23:00', ocoNo: 'OCO-778' }));
    await waitFor(() => expect(hata).toHaveBeenCalledWith(expect.stringMatching(/bağlantı hatası/)));
    expect(basari).not.toHaveBeenCalled();
  });

  it('Kontrol Ettim diger girisleri (kullanimda / katilimci) degistirmez', async () => {
    const p = plan(false);
    p.apps![1] = { ...p.apps![1], kullanimda: 'yes', katilimci: 'Ayşe Yılmaz' };
    mockGecis.mockResolvedValue(p);
    mockKontrol.mockResolvedValue({ ok: true, kontrolAt: KONTROL_AN });
    render(<GlomoGecisPlani />);
    fireEvent.click(await screen.findByRole('button', { name: ETTIM }));
    expect(await screen.findByText('Kontrol edildi')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'yedi-app (ns-prod) kullanımda mı?' })).getByRole('button', { name: 'Evet' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(KISI)).toHaveValue('Ayşe Yılmaz');
  });

  it('kullanimda secimi kontrol isaretini silmez', async () => {
    const p = plan(false);
    p.apps![1] = { ...p.apps![1], kontrolAt: KONTROL_AN };
    mockGecis.mockResolvedValue(p);
    mockApp.mockResolvedValue({ ok: true });
    render(<GlomoGecisPlani />);
    expect(await screen.findByText('Kontrol edildi')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'yedi-app (ns-prod) kullanımda mı?' })).getByRole('button', { name: 'Evet' }));
    await waitFor(() => expect(mockApp).toHaveBeenCalled());
    await screen.findByLabelText(KISI);
    expect(screen.getByText('Kontrol edildi')).toBeInTheDocument();
  });

  it('Evet secilince katilimci kutusu acilir ve kaydedilir', async () => {
    mockGecis.mockResolvedValue(plan(false));
    mockApp.mockResolvedValue({ ok: true });
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    fireEvent.click(screen.getAllByRole('button', { name: 'Evet' })[0]);
    await waitFor(() => expect(mockApp).toHaveBeenCalledWith(expect.objectContaining({ application: 'yedi-app', kullanimda: 'yes' })));
    const kutu = await screen.findByLabelText(KISI);
    fireEvent.change(kutu, { target: { value: 'Ayşe Yılmaz' } });
    fireEvent.blur(kutu);
    await waitFor(() => expect(mockApp).toHaveBeenLastCalledWith(expect.objectContaining({ katilimci: 'Ayşe Yılmaz' })));
  });

  it('ayni uygulama adi iki namespace\'te: dugme / grup / kutu adlari namespace ile ayrisir', async () => {
    const p = plan(false);
    p.apps = [app('web', { setNo: 7, namespace: 'a-prod', kullanimda: 'yes' }), app('web', { setNo: 7, namespace: 'b-prod', kullanimda: 'yes' })];
    mockGecis.mockResolvedValue(p);
    render(<GlomoGecisPlani />);
    expect(await screen.findByRole('button', { name: 'web (a-prod) kontrol ettim' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'web (b-prod) kontrol ettim' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'web (a-prod) kullanımda mı?' })).toBeInTheDocument();
    expect(screen.getByLabelText('web (b-prod) çalışmaya katılacak kişi')).toBeInTheDocument();
  });

  it('ekip e-postasi mailto ile gorunur; set basliginda toplu kopyalama dugmesi var', async () => {
    const p = plan(false);
    p.apps![1].ekipEposta = ['gt-ekip@banka.com'];
    mockGecis.mockResolvedValue(p);
    render(<GlomoGecisPlani />);
    const link = await screen.findByRole('link', { name: /gt-ekip@banka.com/ });
    expect(link.getAttribute('href')).toBe('mailto:gt-ekip@banka.com');
    expect(screen.getByRole('button', { name: /Ekip e-postaları \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Görünen ekiplerin e-postaları \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText('/yedi-app/').tagName).toBe('CODE');
  });

  it('"Gorunen ekiplerin e-postalari" katlanmis Tamamlanan bolumunu saymaz; acilinca sayar', async () => {
    const p = plan(false);
    p.apps![0].ekipEposta = ['alti@banka.com'];
    p.apps![1].ekipEposta = ['yedi@banka.com'];
    mockGecis.mockResolvedValue(p);
    render(<GlomoGecisPlani />);
    expect(await screen.findByRole('button', { name: /Görünen ekiplerin e-postaları \(1\)/ })).toBeInTheDocument();
    tamamlananAc();
    expect(screen.getByRole('button', { name: /Görünen ekiplerin e-postaları \(2\)/ })).toBeInTheDocument();
  });

  it('gecti=1 olan Set 7 uygulamasi YALNIZ "Gecen uygulamalar"da (Set 7 tablosunda ikinci kez degil)', async () => {
    const p = plan(false);
    p.apps!.push(app('yedi-gecen', { setNo: 7, gecti: true, gecisTarihi: '2026-10-02' }));
    mockGecis.mockResolvedValue(p);
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    expect(screen.getAllByText('yedi-gecen')).toHaveLength(1);
    const metin = document.body.textContent || '';
    expect(metin.indexOf('Geçen uygulamalar')).toBeLessThan(metin.indexOf('yedi-gecen'));
  });

  it('gecen uygulama yoksa bos metin isaretleme cagrisi yapmaz', async () => {
    const p = plan(false);
    p.apps = p.apps!.filter((a) => !a.gecti);
    mockGecis.mockResolvedValue(p);
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    expect(screen.getByText('Geçti olarak kayıtlı uygulama yok.')).toBeInTheDocument();
    expect(screen.queryByText(/işaretlenmiş/)).not.toBeInTheDocument();
  });

  it('Admin: calisma zamani / OCO girisi duruyor; set secimi / gecti / gecis tarihi / "Setin tumu gecti" YOK', async () => {
    mockGecis.mockResolvedValue(plan(true));
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    tamamlananAc();
    expect(screen.getAllByPlaceholderText('OCO numarası').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Çalışma zamanı').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Set \/ geçiş \(Admin\)/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Set')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Set/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /geçti/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Geçiş tarihi')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Toplu geçiş tarihi')).not.toBeInTheDocument();
    expect(screen.queryByText('Setin tümü geçti')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Geçti işaretini geri al')).not.toBeInTheDocument();
    // Etiketten bagimsiz: hicbir tabloda secim / onay kutusu / tarih girdisi yok.
    for (const t of screen.getAllByRole('table')) {
      expect(t.querySelectorAll('select, input[type="checkbox"], input[type="date"], input[type="datetime-local"]')).toHaveLength(0);
      expect(within(t).queryAllByRole('combobox')).toHaveLength(0);
      expect(within(t).queryAllByRole('checkbox')).toHaveLength(0);
    }
  });

  it('Set 7 listesinde planda bulunamayanlar yalniz Admin\'e uyari olarak gorunur', async () => {
    mockGecis.mockResolvedValue(plan(true));
    const { unmount } = render(<GlomoGecisPlani />);
    expect(await screen.findByText(/Set 7 listesindeki/)).toHaveTextContent('Set 7 listesindeki 1 uygulama planda bulunamadı: fund-management-ch-prod/smart-saving-app-v0');
    unmount();
    mockGecis.mockResolvedValue(plan(false));
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    expect(screen.queryByText(/Set 7 listesindeki/)).not.toBeInTheDocument();
    expect(screen.queryByText(/smart-saving-app-v0/)).not.toBeInTheDocument();
  });

  it('Set 7 tasimasi uygulanamadiysa Admin uyari gorur (hata metniyle); uygulandiysa ya da Admin degilse uyari yok', async () => {
    const p = plan(true);
    p.goc = { ad: 'set7-talep-2026-10-16', uygulandi: false, hata: 'spa_gecis_goc tablosu yok' };
    mockGecis.mockResolvedValue(p);
    const { unmount } = render(<GlomoGecisPlani />);
    const uyari = await screen.findByText(/Set 7 taşıması uygulanamadı/);
    expect(uyari.closest('[role="alert"]')).toHaveTextContent('spa_gecis_goc tablosu yok');
    unmount();
    const u = plan(false);
    u.goc = { ad: 'set7-talep-2026-10-16', uygulandi: false };
    mockGecis.mockResolvedValue(u);
    const r2 = render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    expect(screen.queryByText(/Set 7 taşıması uygulanamadı/)).not.toBeInTheDocument();
    r2.unmount();
    mockGecis.mockResolvedValue(plan(true));
    render(<GlomoGecisPlani />);
    await screen.findByText('yedi-app');
    expect(screen.queryByText(/Set 7 taşıması uygulanamadı/)).not.toBeInTheDocument();
  });
});
