// src/components/nginx_console/__tests__/yuk-testi-sil.test.tsx — Yük Testi › koşu sonucu silme (2026-11-04).
//
// SI1 saf: onay metni (tekli numara / "#numara", toplu sayi) ve sahiplik (Admin ya da baslatan kisi)
// SI2 ayrinti: "Sil" (tehlike tonu) Admin'e ve baslatana; baskasina yok; suren iste kapali; onay metni yazilmadan gonderilmez;
//     yapistirma kapali; İptal (Vazgeç yok); ham dosya notu; silinince onSilindi
// SI3 ayrinti: sunucu 409 (silinemeyenler) -> pencere acik kalir, nedenler listelenir, onSilindi yok; bulunamayan kayit
//     "silinmiş olabilir"
// SI4 liste: coklu secim + "Seçilenleri sil" (secilen sayi yazilir) -> satirlar listeden kalkar, basari bildirimi; suren ve
//     baskasinin satiri secilemez; Admin olmayan ve kendi kaydi yoksa secim kutusu yok
// SI5 liste: toplu 409 (hepsi ya da hic) -> nedenler, "Silinemeyenleri seçimden çıkar", liste degismez
// SI6 liste: "hepsini seç" en cok 50; 50'de diger kutular kapali
// SI7 coklu karsilastirma: adreste silinmis kosu -> secimden ve adresten cikar, "Silinmiş koşu çıkarıldı" bilgisi
// SI8 gece kuyrugu: silinmis kosu "(silindi)" baglantisiz; "Hepsini karşılaştır" onu gondermez
// SI10 toplu: secilen kayitlarin HEPSI silinemezse "Silinemeyenleri seçimden çıkar" gorunmez (secim bosalirdi)
// SI9 API (gercek istemci, fetch sahte): DELETE /kosular/:id ve POST /kosular/sil govdesi; 409 govdesi doner; nginxRed 403
//     firlatilir; coklu karsilastirmanin 409 kosu_yok `eksik` alani hataya tasinir
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { render } from '@/test/test-utils';
import type { NlKosu, NlKuyruk, NlKuyrukOge } from '@/api/nginxLoadtestApi';
import { onayUyar } from '../yukTesti/KosuSilOnayi';
import { kosuSahibiMi } from '../yukTesti/yukTestiOrtak';

const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryo: vi.fn(), senaryoKaydet: vi.fn(), senaryoSil: vi.fn(), onKontrol: vi.fn(),
  baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), durum: vi.fn(), durdur: vi.fn(), yenidenOku: vi.fn(), karsilastir: vi.fn(), ipSinifi: vi.fn(),
  araclar: vi.fn(), araclariHazirla: vi.fn(), aracGeriCek: vi.fn(),
  kuyruklar: vi.fn(), kuyruk: vi.fn(), kuyrukOlustur: vi.fn(), kuyrukIptal: vi.fn(), kuyrukSira: vi.fn(), kuyrukOgeCikar: vi.fn(),
  karsilastirCoklu: vi.fn(), etiketDegistir: vi.fn(), kosuSil: vi.fn(), kosulariSil: vi.fn(),
}));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { YukTestiTab } from '../YukTestiTab';
import KosuAyrinti from '../yukTesti/KosuAyrinti';

function kosu(id: number, o: Partial<NlKosu> = {}): NlKosu {
  return {
    id, islem: 'kosu', etiket: `[K3] A${id}`, adim: `R${id}`, hedefHost: 'GBNGXT33', hedefIp: '10.0.0.9', vhost: 'app', yukHost: 'GBNGXT34', senaryoId: 1, senaryoAd: 'S',
    durum: 'DONE', gecerlilik: 'GECERLI', createdBy: 'onur', createdAt: `2026-11-0${(id % 3) + 1}T10:00:00Z`, startedAt: null, finishedAt: null, awxJobId: 1,
    hedefTuru: 'sunucu', motor: 'k6', protokol: 'h1', ...o,
  };
}
function ayrinti(id: number, o: Partial<NlKosu> = {}) {
  return {
    ...kosu(id, o), parametreler: { motor: 'k6', hizlar: [100], maxvu: 150, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'ka', ae: 'br' },
    onKontrol: null, gecersizNedenleri: [], sonucOzet: null, onKontrolKosuId: 1, sunucuDegerlendirmesi: null, onKontrolYasSn: null, isDurumu: 'OK', isHatasi: null,
    analiz: { nproc: 8, cpuTlsliPay: null, uyarilar: [], okumaHatasi: null }, durdurIsi: null, sonuclandirmaDenemesi: 0, aracId: null, aracSeti: null, sonucOzeti: null, serbestAg: null, planUyarilari: [],
  };
}
function Konum() {
  const l = useLocation();
  return <output data-testid="konum">{l.search}</output>;
}
const konum = () => new URLSearchParams(screen.getByTestId('konum').textContent || '');
const onayGirdisi = () => screen.getByRole('textbox', { name: /Onaylamak için/ });

beforeEach(() => {
  for (const x of Object.values(api)) x.mockReset();
  for (const x of Object.values(toast)) x.mockReset();
  api.kosular.mockResolvedValue({ ok: true, kosular: [1, 2, 3, 4].map((i) => kosu(i)), dahaVar: false });
  api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [] });
});

describe('Yük Testi — koşu silme', () => {
  it('SI1 onay metni ve sahiplik', () => {
    expect(onayUyar('12', '12', false)).toBe(true);
    expect(onayUyar(' #12 ', '12', false)).toBe(true);
    expect(onayUyar('#3', '3', true)).toBe(false);
    expect(onayUyar('3', '3', true)).toBe(true);
    expect(onayUyar('13', '12', false)).toBe(false);
    expect(onayUyar('', '12', false)).toBe(false);
    expect(kosuSahibiMi({ createdBy: 'ali' }, true, null)).toBe(true);
    expect(kosuSahibiMi({ createdBy: 'Veli ' }, false, 'veli')).toBe(true);
    expect(kosuSahibiMi({ createdBy: 'ali' }, false, 'veli')).toBe(false);
    expect(kosuSahibiMi({ createdBy: null }, false, '')).toBe(false);
  });

  it('SI2 ayrıntıda Sil: yetki, süren iş, onay metni, İptal, ham dosya notu', async () => {
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti(12), adimlar: [] });
    api.kosuSil.mockResolvedValue({ ok: true, sayi: 1, silinen: [{ id: 12, islem: 'kosu', etiket: '[K3] A12', hedefHost: 'GBNGXT33', hedefIp: '10.0.0.9', hedefTuru: 'sunucu' }] });
    const onSilindi = vi.fn();
    const { unmount } = render(<KosuAyrinti kosuId={12} isAdmin onGeri={vi.fn()} onSilindi={onSilindi} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sil' }));
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText('Koşu #12 silinsin mi?')).toBeTruthy();
    expect(within(pencere).getByText(/ham ölçüm dosyaları .* silinmez/)).toBeTruthy();
    expect(within(pencere).getByRole('button', { name: 'İptal' })).toBeTruthy();
    expect(within(pencere).queryByRole('button', { name: /Vazgeç/ })).toBeNull();
    const silDugmesi = within(pencere).getByRole('button', { name: 'Sil' });
    expect(silDugmesi).toBeDisabled();
    fireEvent.change(onayGirdisi(), { target: { value: '13' } });
    expect(silDugmesi).toBeDisabled();
    // Yapistirma kapali.
    const yapistir = new Event('paste', { bubbles: true, cancelable: true });
    onayGirdisi().dispatchEvent(yapistir);
    expect(yapistir.defaultPrevented).toBe(true);
    fireEvent.change(onayGirdisi(), { target: { value: '12' } });
    fireEvent.click(silDugmesi);
    await waitFor(() => expect(api.kosuSil).toHaveBeenCalledWith(12, '12'));
    await waitFor(() => expect(onSilindi).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Koşu #12 silindi.*ham ölçüm dosyaları durur/));
    unmount();
    // İptal: istek gitmez, pencere kapanir.
    api.kosuSil.mockReset();
    const r2 = render(<KosuAyrinti kosuId={12} isAdmin onGeri={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sil' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.kosuSil).not.toHaveBeenCalled();
    r2.unmount();
    // Admin olmayan: baskasinin kaydinda Sil yok; kendi kaydinda var.
    const r3 = render(<KosuAyrinti kosuId={12} isAdmin={false} kullaniciAdi="veli" onGeri={vi.fn()} />);
    await screen.findByText(/Koşu #12|#12/);
    expect(screen.queryByRole('button', { name: 'Sil' })).toBeNull();
    r3.unmount();
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti(12, { createdBy: 'Veli' }), adimlar: [] });
    const r4 = render(<KosuAyrinti kosuId={12} isAdmin={false} kullaniciAdi="veli" onGeri={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Sil' })).toBeEnabled();
    r4.unmount();
    // Suren is: Sil kapali.
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti(12, { durum: 'RUNNING' }), adimlar: [] });
    render(<KosuAyrinti kosuId={12} isAdmin onGeri={vi.fn()} />);
    const s = await screen.findByRole('button', { name: 'Sil' });
    expect(s).toBeDisabled();
    expect(s.getAttribute('title')).toMatch(/Süren iş silinemez/);
  });

  it('SI3 ayrıntı: sunucu reddi nedenleriyle; bulunamayan kayıt "silinmiş olabilir"', async () => {
    api.kosu.mockResolvedValue({ ok: true, kosu: ayrinti(12), adimlar: [] });
    api.kosuSil.mockResolvedValue({ ok: false, code: 'kuyruga_bagli', message: 'x', silinemeyenler: [{ id: 12, kod: 'kuyruga_bagli', metin: 'Koşu #12 gece kuyruğu K3 içinde bekleyen / çalışan bir öğeye bağlı; önce kuyruktan çıkarın (ya da kuyruğu İptal edin).' }] });
    const onSilindi = vi.fn();
    const { unmount } = render(<KosuAyrinti kosuId={12} isAdmin onGeri={vi.fn()} onSilindi={onSilindi} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sil' }));
    fireEvent.change(onayGirdisi(), { target: { value: '#12' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sil' }));
    const uyari = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(uyari.textContent).toMatch(/hiçbir kayıt silinmedi/);
    expect(uyari.textContent).toMatch(/önce kuyruktan çıkarın/);
    expect(api.kosuSil).toHaveBeenCalledWith(12, '#12');
    expect(onSilindi).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // 403 (nginxRed ile firlatilan) mesaj da pencerede.
    api.kosuSil.mockRejectedValue(Object.assign(new Error('Yalnız koşuyu başlatan kişi ya da Admin silebilir: #12 (ali). Hiçbir kayıt silinmedi.'), { status: 403, code: 'yetki_yok' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sil' }));
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toMatch(/Yalnız koşuyu başlatan kişi/);
    unmount();
    api.kosu.mockRejectedValue(Object.assign(new Error('Koşu bulunamadı.'), { status: 409, code: 'kosu_yok' }));
    render(<KosuAyrinti kosuId={44} isAdmin onGeri={vi.fn()} />);
    expect(await screen.findByText('Koşu #44 bulunamadı')).toBeTruthy();
    expect(screen.getByText(/silinmiş olabilir/)).toBeTruthy();
  });

  it('SI4 liste: çoklu seçim, Seçilenleri sil, satırlar kalkar; süren ve başkasının satırı seçilemez', async () => {
    api.kosular.mockResolvedValue({ ok: true, kosular: [kosu(1), kosu(2), kosu(3, { durum: 'RUNNING' }), kosu(4, { islem: 'on_kontrol' })], dahaVar: false });
    api.kosulariSil.mockResolvedValue({ ok: true, sayi: 2, silinen: [{ id: 1 }, { id: 4 }] });
    const { unmount } = render(<YukTestiTab isAdmin />);
    const sil = await screen.findByRole('button', { name: /Seçilenleri sil/ });
    expect(sil).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Kayıt 3 seç' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kayıt 1 seç' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kayıt 4 seç' }));
    expect(api.kosu).not.toHaveBeenCalled();
    expect(screen.getByText('2 seçili')).toBeTruthy();
    fireEvent.click(sil);
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText('2 kayıt silinsin mi?')).toBeTruthy();
    expect(within(pencere).getAllByRole('listitem').map((li) => li.textContent?.slice(0, 3))).toEqual(['#1K', '#4Ö']);
    const onay = within(pencere).getByRole('button', { name: '2 kaydı sil' });
    fireEvent.change(onayGirdisi(), { target: { value: '#2' } });
    expect(onay).toBeDisabled();
    fireEvent.change(onayGirdisi(), { target: { value: '2' } });
    fireEvent.click(onay);
    await waitFor(() => expect(api.kosulariSil).toHaveBeenCalledWith([1, 4], '2'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Koşu 1 ayrıntısı' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Koşu 4 ayrıntısı' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Koşu 2 ayrıntısı' })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/2 kayıt silindi/));
    expect(screen.queryByText(/seçili/)).toBeNull();
    unmount();
    // Admin olmayan: yalniz kendi (bitmis) satiri secilebilir.
    api.kosular.mockResolvedValue({ ok: true, kosular: [kosu(1, { createdBy: 'veli' }), kosu(2)], dahaVar: false });
    const r2 = render(<YukTestiTab isAdmin={false} kullaniciAdi="veli" />);
    expect(await screen.findByRole('checkbox', { name: 'Kayıt 1 seç' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Kayıt 2 seç' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Kayıt 2 seç' }).getAttribute('title')).toMatch(/Yalnız kaydı başlatan kişi ya da Admin/);
    r2.unmount();
    // Admin olmayan ve kendi kaydi yok: secim kutusu ve dugme hic yok.
    render(<YukTestiTab isAdmin={false} kullaniciAdi="ayse" />);
    await screen.findByRole('button', { name: 'Koşu 2 ayrıntısı' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Seçilenleri sil/ })).toBeNull();
  });

  it('SI5 liste: toplu ret (hepsi ya da hiç) nedenleriyle; silinemeyenleri seçimden çıkar', async () => {
    api.kosulariSil.mockResolvedValue({
      ok: false, code: 'silinemez', message: '1 kayıt silinemiyor; hiçbir kayıt silinmedi',
      silinemeyenler: [{ id: 2, kod: 'kosu_kilitli', metin: 'Koşu #2: kilitleri henüz bırakılmadı (uzaktaki yük sürüyor olabilir); kilit bırakılınca silinebilir.' }],
    });
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Kayıt 1 seç' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kayıt 2 seç' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kayıt 3 seç' }));
    fireEvent.click(screen.getByRole('button', { name: /Seçilenleri sil/ }));
    fireEvent.change(onayGirdisi(), { target: { value: '3' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '3 kaydı sil' }));
    const uyari = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(uyari.textContent).toMatch(/1 kayıt silinemiyor; hiçbir kayıt silinmedi/);
    expect(uyari.textContent).toMatch(/kilitleri henüz bırakılmadı/);
    expect(screen.getAllByRole('button', { name: /Koşu \d ayrıntısı/ })).toHaveLength(4);
    fireEvent.click(within(uyari).getByRole('button', { name: 'Silinemeyenleri seçimden çıkar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Kayıt 2 seç' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Kayıt 1 seç' })).toBeChecked();
    expect(screen.getByText('2 seçili')).toBeTruthy();
  });

  it('SI6 liste: görünenleri seç en çok 50', async () => {
    api.kosular.mockResolvedValue({ ok: true, kosular: Array.from({ length: 52 }, (_, i) => kosu(i + 1)), dahaVar: false });
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Görünen silinebilir kayıtların hepsini seç' }));
    expect(screen.getByText('50 seçili (en çok 50)')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Kayıt 51 seç' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Kayıt 52 seç' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Kayıt 1 seç' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Seçimi temizle' }));
    expect(screen.getByRole('checkbox', { name: 'Kayıt 51 seç' })).toBeEnabled();
  });

  it('SI7 çoklu karşılaştırma: adresteki silinmiş koşu çıkarılır, bilgi gösterilir', async () => {
    api.kosular.mockResolvedValue({ ok: true, kosular: [1, 3, 4].map((i) => kosu(i)), dahaVar: false });
    api.karsilastirCoklu.mockImplementation(async (o: { ref: number; kosular: number[] }) => {
      if (o.ref === 2 || o.kosular.includes(2)) throw Object.assign(new Error('Koşu bulunamadı: #2.'), { status: 409, code: 'kosu_yok', eksik: [2] });
      throw Object.assign(new Error('durdur'), { status: 424 });
    });
    render(<><YukTestiTab isAdmin={false} /><Konum /></>, { initialEntries: ['/nginx?tab=yuktesti&yt=coklu&ref=2&kosular=2,3,4'] });
    await waitFor(() => expect(konum().get('kosular')).toBe('3,4'));
    // Referans silindi: kalanlarin en eskisi (kosu 3: 2026-11-01).
    expect(konum().get('ref')).toBe('3');
    expect(await screen.findByText('Silinmiş koşu çıkarıldı: #2')).toBeTruthy();
    await waitFor(() => expect(api.karsilastirCoklu).toHaveBeenLastCalledWith({ ref: 3, kosular: [4] }));
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByText(/Silinmiş koşu çıkarıldı/)).toBeNull();
  });

  it('SI8 gece kuyruğu: silinmiş koşu "(silindi)", karşılaştırmaya gitmez', async () => {
    const kuyruk = { id: 7, ad: null, durum: 'BITTI', beklemeDk: 5, baslangicAt: null, enGecBitis: null, onayHedefi: 'GBNGXT33', hedefTuru: 'sunucu', onaylananTurler: [], createdBy: 'onur', createdAt: null, iptalEden: null, iptalAt: null, bitisAt: null, sonHata: null, dinlenmeKosuId: null, dinlenmeBitis: null, ogeSayisi: 3, bitenSayisi: 3 } as NlKuyruk;
    const oge = (id: number, kosuId: number, o: Partial<NlKuyrukOge> = {}) => ({ id, sira: id, etiket: `A${id}`, durum: 'BITTI', asama: 'kosu', onKontrolKosuId: kosuId - 1, kosuId, neden: null, butceSn: 600, uyariTurleri: [], baslamaAt: null, bitisAt: null, ayar: { senaryoId: 1, hedefIp: null, hedefHost: null, vhost: null, yukHost: null, parametreler: null }, kosuSilindi: false, onKontrolSilindi: false, ...o }) as NlKuyrukOge;
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [kuyruk] });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk, ogeler: [oge(1, 11, { kosuSilindi: true, onKontrolSilindi: true }), oge(2, 21), oge(3, 31)] });
    api.karsilastirCoklu.mockReturnValue(new Promise(() => {}));
    render(<><YukTestiTab isAdmin /><Konum /></>, { initialEntries: ['/nginx?tab=yuktesti'] });
    fireEvent.click(await screen.findByRole('tab', { name: /Gece kuyruğu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
    expect(await screen.findByText('#11 (silindi)')).toBeTruthy();
    expect(screen.getByText('ön kontrol #10 (silindi)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '#11' })).toBeNull();
    expect(screen.getByRole('button', { name: '#21' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hepsini karşılaştır' }));
    await waitFor(() => expect(konum().get('kosular')).toBe('21,31'));
    expect(konum().get('ref')).toBe('21');
  });

  it('SI9 API: silme istekleri, 409 gövdesi, 403 fırlatılır, çoklu karşılaştırmada eksik', async () => {
    const gercek = (await vi.importActual<typeof import('@/api/nginxLoadtestApi')>('@/api/nginxLoadtestApi')).nginxLoadtestApi;
    const yanit = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    try {
      f.mockResolvedValueOnce(yanit(200, { ok: true, sayi: 1, silinen: [{ id: 12 }] }));
      expect((await gercek.kosuSil(12, '12')).sayi).toBe(1);
      expect(f.mock.calls[0][0]).toBe('/api/nginx-loadtest/kosular/12');
      expect(f.mock.calls[0][1]).toMatchObject({ method: 'DELETE', body: JSON.stringify({ confirmText: '12' }) });
      f.mockResolvedValueOnce(yanit(409, { ok: false, code: 'silinemez', message: 'm', silinemeyenler: [{ id: 2, kod: 'kosu_suruyor', metin: 't' }] }));
      const r = await gercek.kosulariSil([1, 2], '2');
      expect(f.mock.calls[1][0]).toBe('/api/nginx-loadtest/kosular/sil');
      expect(f.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ kosular: [1, 2], confirmText: '2' }) });
      expect([r.ok, r.code, r.silinemeyenler?.[0].kod]).toEqual([false, 'silinemez', 'kosu_suruyor']);
      f.mockResolvedValueOnce(yanit(409, { ok: false, code: 'yetki_yok', message: 'Yalnız koşuyu başlatan kişi ya da Admin silebilir.', upstreamStatus: 403, nginxRed: true }));
      await expect(gercek.kosuSil(3, '3')).rejects.toMatchObject({ status: 403, code: 'yetki_yok' });
      f.mockResolvedValueOnce(yanit(409, { ok: false, code: 'kosu_yok', message: 'Koşu bulunamadı.', eksik: [2, 'x', 5] }));
      await expect(gercek.karsilastirCoklu({ ref: 1, kosular: [2, 5] })).rejects.toMatchObject({ code: 'kosu_yok', eksik: [2, 5] });
      f.mockResolvedValueOnce(yanit(400, { ok: false, code: 'gecersiz_istek', message: 'x' }));
      const e = await gercek.karsilastirCoklu({ ref: 1, kosular: [2] }).catch((x) => x);
      expect(e.eksik).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('SI10 toplu: seçilenlerin hepsi silinemezse "Silinemeyenleri seçimden çıkar" görünmez', async () => {
    api.kosulariSil.mockResolvedValue({
      ok: false, code: 'silinemez', message: '2 kayıt silinemiyor; hiçbir kayıt silinmedi',
      silinemeyenler: [{ id: 1, kod: 'kosu_kilitli', metin: 'Koşu #1: kilitleri henüz bırakılmadı.' }, { id: 2, kod: 'kuyruga_bagli', metin: 'Koşu #2 gece kuyruğu K3 içinde.' }],
    });
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Kayıt 1 seç' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kayıt 2 seç' }));
    fireEvent.click(screen.getByRole('button', { name: /Seçilenleri sil/ }));
    fireEvent.change(onayGirdisi(), { target: { value: '2' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '2 kaydı sil' }));
    const uyari = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(uyari.textContent).toMatch(/2 kayıt silinemiyor; hiçbir kayıt silinmedi/);
    expect(within(uyari).getAllByRole('listitem')).toHaveLength(2);
    expect(within(uyari).queryByRole('button', { name: 'Silinemeyenleri seçimden çıkar' })).toBeNull();
  });
});
