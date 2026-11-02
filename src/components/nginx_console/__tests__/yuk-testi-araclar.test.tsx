// src/components/nginx_console/__tests__/yuk-testi-araclar.test.tsx — Yük Testi > "Araçlar" (tur 4, 2026-11-02).
//
// Sozlesme arac_sozlesme.md §4.3 / §4.4 / §5.4 (YT44 ve YT45 yuk-testi-tab.test.tsx'te):
// YT40 Araçlar sekmesi Admin disina gorunur (etkin set karti okunur); "Araçları hazırla", "Geri çek" ve vekil sunucu
//      satiri Admin disina CIZILMEZ.
// YT41 Hazirlama: pencere metni (host, k6 surumu), "İptal" kapatir ve cagri yok, "Hazırla" araclariHazirla({derlemeHost})
//      (secilen makine), toast "Araç hazırlama işi AWX #N başlatıldı."; hata toast'u sunucu mesaji; suren is varken dugme
//      kapali + title, "Hazırlanıyor — AWX iş #N" ve 10 sn'de bir yeniden okuma; vekil hatasinda dugme kapali.
// YT42 Geri cekme (D2): etkin kartta ve gecmisin geri cekilebilir (DONE, geri cekilmemis) satirinda dugme; onay penceresi
//      metni, "İptal" cagri yapmaz, "Geri çek" aracGeriCek(id) + toast (yeni etkin set / set yok); sunucu reddi pencerede;
//      geri cekilmis / FAILED satirda dugme yok; "geri çekildi" / "özet farklı" cipleri. Onay toreni (12 hane) YOK.
// YT42b Ozet sabit degil (D1): kirmizi kutu eksik env adlarini listeler, "Araçları hazırla" kapali + title (Admin disina da
//      kutu gorunur); etkin set yoksa sunucunun kapi metni; suren is sure sinirini astiysa "durumu okunamıyor" (PU2).
// YT43 glibc uyarisi wrkGlibcGerekli 2.34'te var; 2.17 / 2.28 / null'da yok.
// YT46 aracSetiNormalle toleransli (snake/camel, eksik alan null, id'siz null) ve onKontrolNormalle dort yeni alan;
//      araclarNormalle / hedeflerNormalle araclar alani (yoksa fail-closed).
// YT47 Bos gecmis TableEmptyRow metni; hata hucresi ilk 80 karakter + title.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { aracSetiNormalle, araclarNormalle, hedeflerNormalle, onKontrolNormalle } from '@/api/nginxLoadtestApi';

const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryo: vi.fn(), senaryoKaydet: vi.fn(), senaryoSil: vi.fn(), onKontrol: vi.fn(),
  baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), durum: vi.fn(), durdur: vi.fn(), yenidenOku: vi.fn(), karsilastir: vi.fn(), ipSinifi: vi.fn(),
  araclar: vi.fn(), araclariHazirla: vi.fn(), aracGeriCek: vi.fn(),
}));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { YukTestiTab } from '../YukTestiTab';
import Araclar, { OZET_EKSIK_METNI, SET_YOK_METNI, geriCekmeMetni, glibcUyariMetni, hazirlamaMetni, okunamiyorMetni } from '../yukTesti/Araclar';

const K6 = 'a1'.repeat(32);
const WRK = 'b2'.repeat(32);
const KAYNAK = '0123456789abcdef'.repeat(4);
/** Sunucunun aracApi(r) sekli (camelCase). */
const SET = (o: Record<string, unknown> = {}) => ({
  id: 5, durum: 'DONE', derlemeHost: 'GBLABT02', k6Surum: 'v0.49.0', wrkSurum: '4.2.0', k6Sha256: K6, wrkSha256: WRK,
  k6ArsivSha256: 'c3'.repeat(32), wrkKaynakSha256: KAYNAK, ozetlerGuncel: true, geriCekildi: false, geriCeken: null, geriCekmeAt: null, calismaYasSn: 600,
  swDizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/5', derlemeRhel: '8', derlemeGlibc: '2.28', wrkGlibcGerekli: '2.17', wrkOpenssl: 'OpenSSL 1.1.1i  8 Dec 2020',
  wrkLuajit: 'LuaJIT 2.1.0-beta3', hata: null, awxServerId: 1, awxJobId: 7001, awxUrl: 'https://awx.example/#/jobs/playbook/7001/output',
  createdBy: 'onur', createdAt: '2026-11-02T08:50:00Z', startedAt: '2026-11-02T08:50:05Z', finishedAt: '2026-11-02T08:58:00Z', ...o,
});
const AYAR = (o: Record<string, unknown> = {}) => ({
  derlemeHostlari: ['GBLABT02', 'GBNGXT51'], varsayilanDerlemeHost: 'GBLABT02', k6Surum: 'v0.49.0', wrkSurum: '4.2.0',
  proxyTanimli: true, proxy: 'http://vekil.example:80', proxyHatasi: null, k6ArsivSha256: 'c3'.repeat(32), wrkKaynakSha256: KAYNAK, ozetEksikleri: [],
  isSuresiSn: 2400, ...o,
});
const yanit = (o: Record<string, unknown> = {}) => ({ ok: true, etkin: SET(), calisan: null, gecmis: [SET()], ayar: AYAR(), kapi: { kod: null, mesaj: null }, ...o });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  api.kosular.mockResolvedValue({ ok: true, kosular: [], dahaVar: false });
  api.araclar.mockResolvedValue(araclarNormalle(yanit()));
});
afterEach(() => { vi.useRealTimers(); });

describe('Yük Testi — Araçlar görünümü', () => {
  it('YT40 Admin dışı: sekme görünür, etkin set okunur; hazırla / geri çek düğmeleri ve vekil satırı YOK', async () => {
    api.araclar.mockResolvedValue(araclarNormalle(yanit({
      gecmis: [SET({ id: 6, ozetlerGuncel: false }), SET()], ayar: AYAR({ proxy: null }),
    })));
    render(<YukTestiTab isAdmin={false} />);
    fireEvent.click(await screen.findByRole('tab', { name: /Araçlar/ }));
    expect(await screen.findByRole('heading', { name: 'Etkin araç seti #5' })).toBeTruthy();
    expect(screen.getByText('özet farklı')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Araçları hazırla/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /geri çek/i })).toBeNull();
    expect(screen.queryByText(/onayla/i)).toBeNull();
    expect(screen.queryByLabelText('Derleme makinesi')).toBeNull();
    expect(screen.queryByText(/^Vekil sunucu/)).toBeNull();
    expect(api.araclariHazirla).not.toHaveBeenCalled();
  });

  it('YT40b Admin: hazırla ve geri çek düğmeleri çizilir; etkin kart satırları (kesik sha + title, AWX bağlantısı, arşiv özetleri)', async () => {
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ gecmis: [SET({ id: 6, ozetlerGuncel: false }), SET()] })));
    render(<Araclar isAdmin />);
    const kart = await screen.findByRole('region', { name: 'Etkin araç seti #5' });
    expect(within(kart).getByText(`${K6.slice(0, 16)}…`)).toHaveAttribute('title', K6);
    const awx = within(kart).getByRole('link', { name: 'AWX iş #7001' });
    expect(awx).toHaveAttribute('target', '_blank');
    expect(awx).toHaveAttribute('rel', 'noreferrer');
    expect(within(kart).getByText('GBLABT02').closest('dd')?.textContent).toBe('GBLABT02 · RHEL 8 · glibc 2.28');
    expect(within(kart).getByText(`${KAYNAK.slice(0, 16)}…`).closest('dd')?.textContent).toBe(`k6 ${'c3'.repeat(8)}… · wrk ${KAYNAK.slice(0, 16)}… · sabit değerle doğrulandı`);
    expect(screen.getByRole('button', { name: /Araçları hazırla/ })).toBeEnabled();
    expect(within(kart).getByRole('button', { name: 'Araç seti #5’i geri çek' })).toBeEnabled();
    // Gecmiste etkin setin satirinda ikinci dugme yok; DONE #6 (ozet farkli) geri cekilebilir.
    expect(screen.getAllByRole('button', { name: /geri çek$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Araç seti #5’i geri çek', 'Araç seti #6’i geri çek']);
    expect(screen.queryByText(/onayla/i)).toBeNull();
    expect(screen.getByText('Vekil sunucu: http://vekil.example:80')).toBeTruthy();
  });

  it('YT41 hazırlama: pencere metni, İptal kapatır, Hazırla seçilen makineyle çağırır + toast; hata toast’u sunucu mesajı', async () => {
    api.araclariHazirla.mockResolvedValueOnce({ ok: true, aracId: 7, jobId: 7002, awxServerId: 1 })
      .mockResolvedValueOnce({ ok: false, code: 'kilit_dolu', message: 'Başka bir araç hazırlama işi sürüyor (onur).', _httpStatus: 409 });
    render(<Araclar isAdmin />);
    fireEvent.change(await screen.findByLabelText('Derleme makinesi'), { target: { value: 'GBNGXT51' } });
    fireEvent.click(screen.getByRole('button', { name: /Araçları hazırla/ }));
    let pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText('Araçlar hazırlansın mı?')).toBeTruthy();
    expect(within(pencere).getByText(hazirlamaMetni('GBNGXT51', 'v0.49.0', '4.2.0'))).toBeTruthy();
    expect(hazirlamaMetni('GBNGXT51', 'v0.49.0', '4.2.0')).toBe('GBNGXT51 üzerinde, kurumsal vekil sunucu üzerinden k6 v0.49.0 sürüm arşivi ve wrk 4.2.0 kaynağı indirilir; ikisi de Portal’da sabitlenen sha256 özetleriyle doğrulanmadan hiçbir şey açılmaz ya da derlenmez. wrk derlenir (paketli OpenSSL ve LuaJIT; birkaç dakika sürer) ve ikisi /sw’de yeni bir dizine yazılır. Süren koşular etkilenmez; yeni set yalnız iş başarıyla bitince etkin olur.');
    // Pencere sabit ozetleri gosterir (kesik + title).
    expect(within(pencere).getByText(`${KAYNAK.slice(0, 16)}…`)).toHaveAttribute('title', KAYNAK);
    expect(within(pencere).getByText(`${'c3'.repeat(8)}…`)).toHaveAttribute('title', 'c3'.repeat(32));
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.araclariHazirla).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Araçları hazırla/ }));
    pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: /Hazırla$/ }));
    await waitFor(() => expect(api.araclariHazirla).toHaveBeenCalledWith({ derlemeHost: 'GBNGXT51' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Araç hazırlama işi AWX #7002 başlatıldı.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Araçları hazırla/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Hazırla$/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Başka bir araç hazırlama işi sürüyor (onur).'));
  });

  it('YT41b süren iş: düğme kapalı + title, “Hazırlanıyor — AWX iş #N”, 10 sn’de bir yeniden okuma; vekil hatasında düğme kapalı', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ calisan: SET({ id: 7, durum: 'RUNNING', awxJobId: 7002, k6Sha256: null, wrkSha256: null }) })));
    const r = render(<Araclar isAdmin />);
    expect(await screen.findByText('Hazırlanıyor — AWX iş #7002')).toBeTruthy();
    const dugme = screen.getByRole('button', { name: /Araçları hazırla/ });
    expect(dugme).toBeDisabled();
    expect(dugme).toHaveAttribute('title', 'Bir araç hazırlama işi sürüyor.');
    const once = api.araclar.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10500); });
    expect(api.araclar.mock.calls.length).toBeGreaterThan(once);
    r.unmount();
    // Gorunum kapaninca yoklama durur.
    const sonra = api.araclar.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(api.araclar.mock.calls.length).toBe(sonra);
    vi.useRealTimers();
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ ayar: AYAR({ proxyHatasi: 'NGINX_LOADTEST_ARAC_PROXY geçersiz', proxyTanimli: false, proxy: null }) })));
    render(<Araclar isAdmin />);
    expect(await screen.findByText('NGINX_LOADTEST_ARAC_PROXY geçersiz')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Araçları hazırla/ })).toBeDisabled();
  });

  it('YT41c vekil tanımlı değil: “Vekil sunucu: yok (doğrudan bağlantı)”', async () => {
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ ayar: AYAR({ proxyTanimli: false, proxy: null }) })));
    render(<Araclar isAdmin />);
    expect(await screen.findByText('Vekil sunucu: yok (doğrudan bağlantı)')).toBeTruthy();
  });

  it('YT42 geri çekme: onay penceresi, İptal çağrı yapmaz, Geri çek çağrı + toast; sunucu reddi pencerede; çipler', async () => {
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ gecmis: [
      SET({ id: 8, durum: 'FAILED', k6Sha256: null, wrkSha256: null, hata: 'x' }),
      SET({ id: 7, geriCekildi: true, geriCeken: 'ali', geriCekmeAt: '2026-11-02T10:00:00Z' }),
      SET({ id: 6, ozetlerGuncel: false }),
      SET(),
    ] })));
    api.aracGeriCek.mockResolvedValueOnce({ ok: false, code: 'zaten_geri_cekildi', message: 'Bu araç seti zaten geri çekildi.', _httpStatus: 409 })
      .mockResolvedValueOnce({ ok: true, arac: SET({ geriCekildi: true }), kapi: { hazir: true, aracId: 4, kod: null, mesaj: null } })
      .mockResolvedValueOnce({ ok: true, arac: SET({ id: 6, geriCekildi: true }), kapi: { hazir: false, aracId: null, kod: 'araclar_geri_cekildi', mesaj: 'm' } });
    render(<Araclar isAdmin />);
    const kart = await screen.findByRole('region', { name: 'Etkin araç seti #5' });
    // Geri cekilmis #7 ve FAILED #8'de dugme yok; cipler.
    expect(screen.queryByRole('button', { name: 'Araç seti #7’i geri çek' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Araç seti #8’i geri çek' })).toBeNull();
    expect(screen.getByText('geri çekildi')).toHaveAttribute('title', expect.stringContaining('ali'));
    expect(screen.getByText('özet farklı')).toBeTruthy();
    // Pencere ve İptal.
    fireEvent.click(within(kart).getByRole('button', { name: 'Araç seti #5’i geri çek' }));
    let pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByText('Araç seti geri çekilsin mi?')).toBeTruthy();
    expect(within(pencere).getByText(geriCekmeMetni(5))).toBeTruthy();
    expect(geriCekmeMetni(5)).toBe('Araç seti #5 bir daha kullanılmaz (geri alınamaz; kayıt silinmez, işlem denetime yazılır). Etkin set buysa yeni ön kontroller, sabitlenen özetlerle hazırlanmış bir önceki sete geçer; öyle bir set yoksa araçlar yeniden hazırlanana dek ön kontrol ve koşu başlatılamaz. Süren koşular durdurulmaz; bu setle yapılmış ön kontroller koşuya izin vermez.');
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.aracGeriCek).not.toHaveBeenCalled();
    // Sunucu reddi pencerede kalir; ikinci deneme basarili.
    fireEvent.click(within(kart).getByRole('button', { name: 'Araç seti #5’i geri çek' }));
    pencere = await screen.findByRole('dialog');
    fireEvent.click(within(pencere).getByRole('button', { name: /^Geri çek$/ }));
    await waitFor(() => expect(api.aracGeriCek).toHaveBeenCalledWith(5));
    expect(await within(pencere).findByText('Bu araç seti zaten geri çekildi.')).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    const okumaOnce = api.araclar.mock.calls.length;
    fireEvent.click(within(pencere).getByRole('button', { name: /^Geri çek$/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Araç seti #5 geri çekildi; etkin set artık #4.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(api.araclar.mock.calls.length).toBeGreaterThan(okumaOnce));
    // Gecmis satirindan: set kalmadi metni.
    fireEvent.click(await screen.findByRole('button', { name: 'Araç seti #6’i geri çek' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Geri çek$/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Araç seti #6 geri çekildi; kullanılabilir araç seti yok.'));
    expect(api.aracGeriCek).toHaveBeenLastCalledWith(6);
  });

  it('YT42b özet sabit değil: kırmızı kutu, hazırla kapalı + title; etkin yoksa kapı metni; süre aşıldıysa okunamıyor uyarısı', async () => {
    const eksik = ['NGINX_LOADTEST_K6_ARSIV_SHA256 tanımlı değil', 'NGINX_LOADTEST_WRK_KAYNAK_SHA256 64 hex değil'];
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ etkin: null, ayar: AYAR({ ozetEksikleri: eksik, k6ArsivSha256: null, wrkKaynakSha256: null }), kapi: { kod: 'araclar_ozet_sabit_yok', mesaj: 'sunucu metni' } })));
    let r = render(<Araclar isAdmin />);
    const kutu = (await screen.findByText('Arşiv özetleri sabitlenmemiş')).closest('div[role="alert"]') as HTMLElement;
    expect(within(kutu).getAllByRole('listitem').map((x) => x.textContent)).toEqual(eksik);
    expect(within(kutu).getByText(OZET_EKSIK_METNI)).toBeTruthy();
    const dugme = screen.getByRole('button', { name: /Araçları hazırla/ });
    expect(dugme).toBeDisabled();
    expect(dugme).toHaveAttribute('title', 'Arşiv özetleri sabitlenmeden araçlar hazırlanamaz.');
    // Ayni bilgi ikinci kez (kapi metni) cizilmez.
    expect(screen.queryByText('Kullanılabilir araç seti yok')).toBeNull();
    r.unmount();
    // Admin disina da kutu gorunur.
    r = render(<Araclar isAdmin={false} />);
    expect(await screen.findByText('Arşiv özetleri sabitlenmemiş')).toBeTruthy();
    r.unmount();
    // Ozet tamam, etkin set yok: sunucunun kapi metni.
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ etkin: null, kapi: { kod: 'araclar_ozet_degisti', mesaj: 'Sabitlenen arşiv özetleriyle hazırlanmış bir araç seti yok.' } })));
    r = render(<Araclar isAdmin />);
    expect(await screen.findByText('Kullanılabilir araç seti yok')).toBeTruthy();
    expect(screen.getByText('Sabitlenen arşiv özetleriyle hazırlanmış bir araç seti yok.')).toBeTruthy();
    expect(screen.queryByText('Arşiv özetleri sabitlenmemiş')).toBeNull();
    r.unmount();
    // PU2: suren is sure sinirini (2400 sn) asti -> uyari; sinirda yok.
    for (const [yas, var_] of [[2400, false], [2401, true]] as const) {
      api.araclar.mockResolvedValue(araclarNormalle(yanit({ calisan: SET({ id: 9, durum: 'RUNNING', awxJobId: 7009, calismaYasSn: yas }) })));
      r = render(<Araclar isAdmin />);
      await screen.findByText('Hazırlanıyor — AWX iş #7009');
      if (var_) {
        expect(screen.getByText('Hazırlama işinin durumu okunamıyor')).toBeTruthy();
        expect(screen.getByText(okunamiyorMetni(7009, 40))).toBeTruthy();
      } else expect(screen.queryByText('Hazırlama işinin durumu okunamıyor')).toBeNull();
      r.unmount();
    }
    expect(okunamiyorMetni(7009, 40)).toBe('AWX iş #7009 40 dakikalık süre sınırını aştı ve durumu okunamıyor. Portal okumayı 12 saat daha dener, sonra kaydı “okunamadı” olarak kapatır ve yeni hazırlama açılır. İşi AWX’ten kontrol edin.');
  });

  it('YT43 glibc uyarısı yalnız RHEL 8 glibc’sinden yeni gereksinimde (2.34 var; 2.17 / 2.28 / null yok)', async () => {
    const baslik = 'wrk RHEL 8’de çalışmayabilir';
    for (const [g, var_] of [['2.34', true], ['2.17', false], ['2.28', false], [null, false]] as const) {
      api.araclar.mockResolvedValue(araclarNormalle(yanit({ etkin: SET({ wrkGlibcGerekli: g }), gecmis: [SET({ wrkGlibcGerekli: g })] })));
      const r = render(<Araclar isAdmin={false} />);
      await screen.findByRole('heading', { name: 'Etkin araç seti #5' });
      if (var_) {
        expect(screen.getByText(baslik)).toBeTruthy();
        expect(screen.getByText(glibcUyariMetni('2.34'))).toBeTruthy();
        expect(screen.getByText(/· glibc ≥ 2\.34/)).toBeTruthy();
      } else expect(screen.queryByText(baslik)).toBeNull();
      r.unmount();
    }
  });

  it('YT47 boş geçmiş TableEmptyRow; etkin yok + kapı metni yok -> varsayılan metin; hata hücresi ilk 80 karakter + title', async () => {
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ etkin: null, gecmis: [] })));
    const r = render(<Araclar isAdmin />);
    const tablo = await screen.findByRole('table', { name: 'Araç hazırlama geçmişi' });
    expect(within(tablo).getByText('Henüz araç hazırlama işi yok.')).toBeTruthy();
    expect(within(tablo).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['#', 'Durum', 'Derleme', 'k6', 'wrk', 'Hazırlayan', 'Tarih', 'Hata']);
    expect(screen.getByText('Kullanılabilir araç seti yok')).toBeTruthy();
    expect(screen.getByText(SET_YOK_METNI)).toBeTruthy();
    expect(SET_YOK_METNI).toBe('Henüz hazırlanmış bir araç seti yok. Araçlar hazırlanana dek ön kontrol ve koşu başlatılamaz.');
    r.unmount();
    const uzun = `derleme makinesi GBLABT02: indirme basarisiz (k6 arsivi): Request failed: <urlopen error Tunnel connection failed: 407 Proxy Authentication Required>`;
    api.araclar.mockResolvedValue(araclarNormalle(yanit({ etkin: null, gecmis: [SET({ id: 4, durum: 'FAILED', hata: uzun, k6Sha256: null, wrkSha256: null })] })));
    render(<Araclar isAdmin />);
    const hucre = await screen.findByTitle(uzun);
    expect(hucre.textContent).toBe(`${uzun.slice(0, 80)}…`);
  });
});

describe('Yük Testi — araç normalleştirme', () => {
  it('YT46 aracSetiNormalle snake/camel, eksik alan null, id’siz null; onKontrolNormalle dört alan; hedefler araclar', () => {
    const snake = aracSetiNormalle({
      id: '9', durum: 'DONE', derleme_host: 'GBLABT02', k6_surum: 'v0.49.0', wrk_surum: '4.2.0', k6_sha256: K6, wrk_sha256: WRK, wrk_kaynak_sha256: KAYNAK,
      ozetler_guncel: 'true', geri_cekildi: 1, geri_ceken: 'ali', calisma_yas_sn: '61', sw_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/9', derleme_rhel: 9, wrk_glibc_gerekli: '2.34', awx_job_id: '71', created_by: 'onur',
    });
    expect(snake).toMatchObject({ id: 9, durum: 'DONE', derlemeHost: 'GBLABT02', k6Sha256: K6, wrkKaynakSha256: KAYNAK, ozetlerGuncel: true, geriCekildi: true, geriCeken: 'ali', calismaYasSn: 61, derlemeRhel: '9', wrkGlibcGerekli: '2.34', awxJobId: 71, createdBy: 'onur' });
    expect(snake).toMatchObject({ k6ArsivSha256: null, geriCekmeAt: null, derlemeGlibc: null, wrkOpenssl: null, wrkLuajit: null, hata: null, awxUrl: null, awxServerId: null, finishedAt: null });
    expect(aracSetiNormalle(SET())).toEqual(SET());
    const eksik = aracSetiNormalle({ id: 3 });
    expect(eksik).toMatchObject({ id: 3, derlemeHost: '', k6Surum: '', k6Sha256: null, wrkSha256: null, ozetlerGuncel: false, geriCekildi: false, geriCeken: null, calismaYasSn: null, swDizin: null });
    expect(eksik).not.toHaveProperty('kaynakOnay');
    for (const x of [null, undefined, {}, { durum: 'DONE' }, 'x', []]) expect(aracSetiNormalle(x)).toBeNull();
    const a = araclarNormalle({ ok: true, etkin: null, calisan: {}, gecmis: [SET(), { id: null }, 'x'], ayar: { derlemeHostlari: [], varsayilanDerlemeHost: 'GBLABT02' } });
    expect(a.calisan).toBeNull();
    expect(a.gecmis).toHaveLength(1);
    expect(a.ayar).toMatchObject({ derlemeHostlari: ['GBLABT02'], varsayilanDerlemeHost: 'GBLABT02', proxyTanimli: false, proxy: null, wrkSurum: '4.2.0', k6ArsivSha256: null, wrkKaynakSha256: null, ozetEksikleri: [], isSuresiSn: 2400 });
    expect(a.kapi).toEqual({ kod: null, mesaj: null });
    const b = araclarNormalle({ ayar: { ozet_eksikleri: ['X tanımlı değil', ''], is_suresi_sn: '3000', k6_arsiv_sha256: 'c3'.repeat(32) }, kapi: { kod: 'araclar_geri_cekildi', mesaj: 'm' } });
    expect([b.ayar.ozetEksikleri, b.ayar.isSuresiSn, b.ayar.k6ArsivSha256, b.kapi]).toEqual([['X tanımlı değil'], 3000, 'c3'.repeat(32), { kod: 'araclar_geri_cekildi', mesaj: 'm' }]);
    expect(araclarNormalle({ ayar: { isSuresiSn: -1 } }).ayar.isSuresiSn).toBe(2400);
    // On kontrol: dort yeni alan (snake / camel), bos metin null (olculmedi), 'True' metni true.
    expect(onKontrolNormalle({ k6_var: true, arac_dogrulandi: 'True', arac_sha256: K6, arac_glibc: '2.28', arac_hata: '' })).toMatchObject({ aracDogrulandi: true, aracSha256: K6, aracGlibc: '2.28', aracHata: null });
    expect(onKontrolNormalle({ k6Var: true, aracDogrulandi: false, aracHata: 'sha256 farkli' })).toMatchObject({ aracDogrulandi: false, aracSha256: null, aracGlibc: null, aracHata: 'sha256 farkli' });
    expect(onKontrolNormalle({ k6_var: true })).toMatchObject({ aracDogrulandi: null, aracSha256: null, aracGlibc: null, aracHata: null });
    // /hedefler: alan yoksa / bozuksa fail-closed; hazir yalniz boolean true.
    const bos = { hedefler: [], yukHostlari: [], sinirlar: {}, varsayilan: {} };
    for (const araclar of [undefined, null, 'x', []]) {
      expect(hedeflerNormalle({ ...bos, araclar }).araclar).toEqual({ hazir: false, aracId: null, k6Surum: null, wrkSurum: null, kod: 'bilinmiyor', mesaj: 'Sunucu araç durumunu bildirmedi.' });
    }
    expect(hedeflerNormalle({ ...bos, araclar: { hazir: 'true', aracId: 5 } }).araclar.hazir).toBe(false);
    expect(hedeflerNormalle({ ...bos, araclar: { hazir: true, aracId: '5', k6Surum: 'v0.49.0', wrkSurum: '4.2.0', kod: null, mesaj: null } }).araclar)
      .toEqual({ hazir: true, aracId: 5, k6Surum: 'v0.49.0', wrkSurum: '4.2.0', kod: null, mesaj: null });
  });
});
