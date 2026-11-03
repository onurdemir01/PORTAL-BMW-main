// src/components/nginx_console/__tests__/yuk-testi-kuyruk.test.tsx — Yük Testi › Gece kuyruğu (2026-11-03).
//
// KU1 Yeni koşu formu: "Kuyruğa ekle" etiketsiz kapali; etiketle taslaga ekler (govde etiketsiz, "Başlat" aynen yerinde);
//     Gece kuyruğu taslagi gosterir; olusturma onay metni yazilmadan kapali; 409 uyari_onayi turleri tek tek onaylatir,
//     ikinci istek onaylananTurler tasir; basarida ayrinti acilir, taslak temizlenir.
// KU2 Kuyruk ayrintisi: dinlenme sayaci ("Sıradaki 4 dk 12 sn sonra"), ATLANDI nedeni, kosu baglantisi, "İptal" (Vazgeç
//     yok) suren kosunun durmadigini ve Durdur'u soyler; "Hepsini karşılaştır" yalniz prop verilince ve biten kosu
//     numaralarini sirayla verir; Admin olmayana eylem yok.
// KU3 Saf yardimcilar: sonrakiSaat (gece yarisi), baslangicSecimi (10 dk tolerans), gunSaatMetni, tasi, kalanMetni.
// KU4 Baslangic "00:00" gece yarisindan az sonra secilirse hemen baslar (24 sa sonra degil); yarina kayan baslangic
//     "yarın" ve kalan sureyle yazilir, 12 saatten uzaksa uyari.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { NlKuyruk, NlKuyrukOge, NlSinirlar, NlVarsayilanlar } from '@/api/nginxLoadtestApi';
import { baslangicSecimi, gunSaatMetni, kalanMetni, sonrakiSaat, tasi, TASLAK_ANAHTARI, type TaslakOge } from '../yukTesti/kuyrukTaslak';

const SINIR: NlSinirlar = {
  maxHiz: 5000, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 1000, maxButceSn: 2700,
  baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50,
  maxTavanRps: 5000,
};
const VARSAYILAN: NlVarsayilanlar = {
  motor: 'k6', hizlar: [100, 250, 400], maxvu: 150, baglantilar: [2, 4, 8], is_parcacigi: 2, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60,
  kip: 'yeni', ae: 'br', serbest: { hizlar: [50, 100, 200], maxvu: 50 },
};
const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryo: vi.fn(), senaryoKaydet: vi.fn(), senaryoSil: vi.fn(), onKontrol: vi.fn(),
  baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), durum: vi.fn(), durdur: vi.fn(), yenidenOku: vi.fn(), karsilastir: vi.fn(), ipSinifi: vi.fn(),
  araclar: vi.fn(), araclariHazirla: vi.fn(), aracGeriCek: vi.fn(),
  kuyruklar: vi.fn(), kuyruk: vi.fn(), kuyrukOlustur: vi.fn(), kuyrukIptal: vi.fn(), kuyrukSira: vi.fn(), kuyrukOgeCikar: vi.fn(),
}));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { YukTestiTab } from '../YukTestiTab';
import GeceKuyrugu from '../yukTesti/GeceKuyrugu';

const HEDEFLER = {
  ok: true,
  hedefler: [{ host: 'GBNGXT33', env: 'TEST', ipler: ['192.168.133.27'], vhostlar: ['glomo-test.garantibbva.com.tr'], vhostVerisi: true, uygun: true, neden: null }],
  yukHostlari: [{ host: 'GBNGXT34', env: 'TEST', uygun: true, neden: null }],
  sinirlar: SINIR, varsayilan: VARSAYILAN, serbest: { acik: true, aglar: [] }, motorlar: ['k6', 'wrk'],
  araclar: { hazir: true, aracId: 5, k6Surum: 'v0.49.0', wrkSurum: '4.2.0', kod: null, mesaj: null },
};
const SENARYO = { id: 3, ad: 'GLOMO', aciklama: null, vhost: 'glomo-test.garantibbva.com.tr', senaryoTur: 'K', yolSayisi: 264, sha256: 'b'.repeat(64), kaynak: 'har', createdBy: 'onur', createdAt: '2026-10-26T10:00:00Z' };

function kuyruk(o: Partial<NlKuyruk> = {}): NlKuyruk {
  return {
    id: 7, ad: null, durum: 'DINLENME', beklemeDk: 5, baslangicAt: '2026-11-03T21:00:00Z', enGecBitis: null, onayHedefi: 'GBNGXT33', hedefTuru: 'sunucu',
    onaylananTurler: [], createdBy: 'onur', createdAt: '2026-11-03T20:55:00Z', iptalEden: null, iptalAt: null, bitisAt: null, sonHata: null,
    dinlenmeKosuId: 102, dinlenmeBitis: '2026-11-03T22:00:00Z', ogeSayisi: 3, bitenSayisi: 2, tahminiBitis: '2026-11-03T23:30:00Z', siradakiKalanSn: 252, ...o,
  };
}
function oge(o: Partial<NlKuyrukOge>): NlKuyrukOge {
  return {
    id: 1, sira: 1, etiket: 'A1', durum: 'BITTI', asama: 'kosu', onKontrolKosuId: 101, kosuId: 102, neden: null, butceSn: 600, uyariTurleri: [],
    baslamaAt: null, bitisAt: null, ayar: { senaryoId: 3, hedefIp: '192.168.133.27', hedefHost: 'GBNGXT33', vhost: 'glomo-test.garantibbva.com.tr', yukHost: 'GBNGXT34', parametreler: null }, ...o,
  };
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  window.localStorage.removeItem(TASLAK_ANAHTARI);
  api.kosular.mockResolvedValue({ ok: true, kosular: [], dahaVar: false });
  api.senaryolar.mockResolvedValue({ ok: true, senaryolar: [SENARYO] });
  api.hedefler.mockResolvedValue(HEDEFLER);
  api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [] });
  api.ipSinifi.mockImplementation(async (ip: string) => ({
    ok: true, tur: 'sunucu', ip, host: 'GBNGXT33', env: 'TEST', vhostlar: ['glomo-test.garantibbva.com.tr'], vhostVerisi: true, hizSiniri: null, vuSiniri: null, uygun: true, neden: null, kod: null, kaynaklar: [],
  }));
});

describe('Yük Testi — gece kuyruğu', () => {
  it('KU1 kuyruğa ekle, taslak, oluşturma: onay metni, uyarı türü onayı, ayrıntıya geçiş', async () => {
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Hedef sunucu (isteğe bağlı)'), { target: { value: 'GBNGXT33' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Hazır ayar' })).getByRole('button', { name: /^Hızlı deneme/ }));
    const ekle = screen.getByRole('button', { name: /^Kuyruğa ekle/ });
    expect(screen.getByRole('button', { name: /Koşuyu başlat/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /Ön kontrolü başlat/ })).toBeEnabled(), { timeout: 3000 });
    expect(ekle).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Kuyruk etiketi (zorunlu)'), { target: { value: 'A3 brotli seviye 4' } });
    expect(ekle).toBeEnabled();
    fireEvent.click(ekle);
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Kuyruğa eklendi: A3 brotli seviye 4/));
    expect(screen.getByLabelText('Kuyruk etiketi (zorunlu)')).toHaveValue('');
    const kayit = JSON.parse(window.localStorage.getItem(TASLAK_ANAHTARI) || '[]');
    expect(kayit).toHaveLength(1);
    expect(kayit[0]).toMatchObject({ etiket: 'A3 brotli seviye 4', hedef: 'GBNGXT33', onKontrolKosuId: null });
    expect(kayit[0].govde).toEqual({
      senaryoId: 3, hedefHost: 'GBNGXT33', hedefIp: '192.168.133.27', vhost: 'glomo-test.garantibbva.com.tr', yukHost: 'GBNGXT34', sni: false,
      parametreler: { motor: 'k6', hizlar: [45, 90], maxvu: 150, tekrar: 1, isinma: 10, sure: 40, bosluk: 10, bosta: 30, kip: 'yeni', ae: 'br', protokol: 'h1' },
    });
    // Gece kuyrugu: taslak ve olusturma.
    fireEvent.click(screen.getByRole('tab', { name: /Gece kuyruğu/ }));
    const liste = await screen.findByRole('list', { name: 'Taslak öğeleri' });
    expect(within(liste).getByText('A3 brotli seviye 4')).toBeTruthy();
    const olustur = screen.getByRole('button', { name: /Kuyruğu oluştur/ });
    expect(olustur).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Vazgeç/ })).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Onay: hedef sunucu adını birebir yazın \(GBNGXT33\)/), { target: { value: 'GBNGXT33' } });
    expect(olustur).toBeEnabled();
    api.kuyrukOlustur.mockResolvedValueOnce({ ok: false, code: 'uyari_onayi', message: 'onay', _httpStatus: 409, uyariTurleri: [{ kod: 'U0123456789', ornek: '/web_log %70 dolu', ogeler: [1] }] });
    fireEvent.click(olustur);
    await waitFor(() => expect(api.kuyrukOlustur).toHaveBeenCalledTimes(1));
    expect(api.kuyrukOlustur.mock.calls[0][0]).toMatchObject({ beklemeDk: 5, baslangic: null, enGecBitis: null, confirmText: 'GBNGXT33', onaylananTurler: [], ogeler: [{ etiket: 'A3 brotli seviye 4', govde: kayit[0].govde, onKontrolKosuId: null }] });
    const tur = await screen.findByLabelText(/U0123456789 \/web_log %70 dolu/);
    expect(tur.closest('label')?.textContent).toBe('U0123456789 /web_log %70 dolu (öğe 1)');
    expect(screen.getByRole('button', { name: /Kuyruğu oluştur/ })).toBeDisabled();
    fireEvent.click(tur);
    api.kuyrukOlustur.mockResolvedValueOnce({ ok: true, id: 7 });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: kuyruk({ durum: 'BEKLIYOR', siradakiKalanSn: null }), ogeler: [oge({ durum: 'BEKLIYOR', kosuId: null, onKontrolKosuId: null, asama: null })] });
    fireEvent.click(screen.getByRole('button', { name: /Kuyruğu oluştur/ }));
    await waitFor(() => expect(api.kuyrukOlustur).toHaveBeenCalledTimes(2));
    expect(api.kuyrukOlustur.mock.calls[1][0].onaylananTurler).toEqual(['U0123456789']);
    expect(await screen.findByText('Gece kuyruğu #7')).toBeTruthy();
    expect(window.localStorage.getItem(TASLAK_ANAHTARI)).toBeNull();
  });

  it('KU2 ayrıntı: sayaç, ATLANDI nedeni, koşu bağlantısı, İptal ve Durdur notu, karşılaştır callback', async () => {
    const ogeler = [
      oge({ id: 1, etiket: 'A1 temel', durum: 'BITTI', kosuId: 102 }),
      oge({ id: 2, sira: 2, etiket: 'A2 brotli 4', durum: 'ATLANDI', kosuId: null, onKontrolKosuId: 103, neden: 'yeni uyarı: U80abab4984 etkin log_format’ta user-agent= yok' }),
      oge({ id: 4, sira: 3, etiket: 'A4 gzip 6', durum: 'BITTI', kosuId: 106 }),
      oge({ id: 3, sira: 4, etiket: 'A3 brotli 6', durum: 'BEKLIYOR', kosuId: null, onKontrolKosuId: null, asama: null, tahminiBaslangic: '2026-11-03T22:04:12Z', tahminiBitis: '2026-11-03T22:19:12Z' }),
      oge({ id: 5, sira: 5, etiket: 'A5 brotli 8', durum: 'BEKLIYOR', kosuId: null, onKontrolKosuId: null, asama: null }),
    ];
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: kuyruk(), ogeler });
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [kuyruk()] });
    const ac = vi.fn();
    const karsilastir = vi.fn();
    render(<GeceKuyrugu isAdmin taslak={[]} setTaslak={() => {}} onKosuAc={ac} onKarsilastir={karsilastir} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
    expect(await screen.findByText(/Sıradaki 4 dk 1[12] sn sonra\./)).toBeTruthy();
    expect(screen.getByText(/yeni uyarı: U80abab4984/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '#102' }));
    expect(ac).toHaveBeenCalledWith(102);
    fireEvent.click(screen.getByRole('button', { name: 'Hepsini karşılaştır' }));
    expect(karsilastir).toHaveBeenCalledWith([102, 106]);
    expect(screen.getByText(/süren koşu durmaz — onu koşu ayrıntısındaki Durdur ile ayrıca durdurun/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Vazgeç/ })).toBeNull();
    api.kuyrukIptal.mockResolvedValue({ ok: true, suren: { ogeId: 3, etiket: 'A3 brotli 6', kosuId: 110, onKontrolKosuId: 109 } });
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(api.kuyrukIptal).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/“A3 brotli 6” sürüyor ve durdurulmadı \(koşu #110\)\. Durdurmak için koşu ayrıntısındaki Durdur’u kullanın\./)).toBeTruthy();
    // Bekleyen ogeyi cikarma.
    fireEvent.click(screen.getAllByRole('button', { name: 'Çıkar' })[0]);
    await waitFor(() => expect(api.kuyrukOgeCikar).toHaveBeenCalledWith(7, 3));
    // Sira: yalniz bekleyenler; ilk bekleyen yukari, son bekleyen asagi gidemez; "aşağı" yeni tam sirayi gonderir.
    await waitFor(() => expect(screen.getByRole('button', { name: 'A3 brotli 6 aşağı' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'A3 brotli 6 yukarı' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'A5 brotli 8 aşağı' })).toBeDisabled();
    api.kuyrukSira.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'A3 brotli 6 aşağı' }));
    await waitFor(() => expect(api.kuyrukSira).toHaveBeenCalledWith(7, [5, 3]));
  });

  it('KU2b Admin olmayana eylem yok; prop yoksa karşılaştır düğmesi yok', async () => {
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: kuyruk(), ogeler: [oge({ id: 3, durum: 'BEKLIYOR', kosuId: null })] });
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [kuyruk()] });
    render(<GeceKuyrugu isAdmin={false} taslak={[]} setTaslak={() => {}} onKosuAc={() => {}} />);
    expect(screen.queryByText('Yeni gece kuyruğu')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
    await screen.findByText('Gece kuyruğu #7');
    expect(screen.queryByRole('button', { name: 'İptal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Çıkar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hepsini karşılaştır' })).toBeNull();
  });

  it('KU3 saf yardımcılar', () => {
    const ref = new Date(2026, 10, 3, 23, 30);
    expect(sonrakiSaat('00:00', ref)?.getDate()).toBe(4);
    expect(sonrakiSaat('23:45', ref)?.getDate()).toBe(3);
    expect(sonrakiSaat('25:00', ref)).toBeNull();
    expect(tasi([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(tasi([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(kalanMetni(252)).toBe('4 dk 12 sn');
    expect(kalanMetni(3900)).toBe('1 sa 5 dk');
    // 00:00 secildi, saat 00:03: hemen (yarin 00:00 degil); 00:15'te yarina kayar; 23:30'da gece yarisi bugun sayilmaz.
    expect(baslangicSecimi('00:00', new Date(2026, 10, 4, 0, 3))).toEqual({ tur: 'gecti', dkOnce: 3 });
    expect(baslangicSecimi('00:00', new Date(2026, 10, 4, 0, 10))).toEqual({ tur: 'gecti', dkOnce: 10 });
    const yarin = baslangicSecimi('00:00', new Date(2026, 10, 4, 0, 11));
    expect(yarin?.tur === 'saat' && yarin.an.getDate()).toBe(5);
    const bu = baslangicSecimi('00:00', ref);
    expect(bu?.tur === 'saat' && bu.an.getDate()).toBe(4);
    expect(baslangicSecimi('ab', ref)).toBeNull();
    expect(gunSaatMetni(new Date(2026, 10, 4, 0, 0).toISOString(), ref)).toBe('yarın 00:00');
    expect(gunSaatMetni(new Date(2026, 10, 3, 23, 45).toISOString(), ref)).toBe('23:45');
  });

  it('KU4 başlangıç gece yarısından az sonra: hemen başlar; yarına kayarsa "yarın" + kalan süre + uyarı', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 10, 4, 0, 3));
      const t: TaslakOge[] = [{ yerelId: 'x1', etiket: 'A1', govde: { senaryoId: 3, hedefHost: 'GBNGXT33', hedefIp: '192.168.133.27', vhost: 'v', yukHost: 'GBNGXT34', sni: false, parametreler: {} } as never, onKontrolKosuId: null, hedef: 'GBNGXT33', ozet: 'o', butceSn: 600 }];
      const { rerender } = render(<GeceKuyrugu isAdmin taslak={t} setTaslak={() => {}} onKosuAc={() => {}} />);
      fireEvent.click(await screen.findByRole('radio', { name: 'Saat' }));
      expect(screen.getByLabelText('Başlangıç saati')).toHaveValue('00:00');
      expect(screen.getByText(/Başlangıç hemen \(00:00 3 dk önce geçti\)\./)).toBeTruthy();
      expect(screen.queryByText(/^Kuyruk yarın/)).toBeNull();
      fireEvent.change(screen.getByLabelText(/^Onay: hedef sunucu adını/), { target: { value: 'GBNGXT33' } });
      api.kuyrukOlustur.mockResolvedValue({ ok: false, code: 'x', message: 'dur' });
      fireEvent.click(screen.getByRole('button', { name: /Kuyruğu oluştur/ }));
      await waitFor(() => expect(api.kuyrukOlustur).toHaveBeenCalledTimes(1));
      expect(api.kuyrukOlustur.mock.calls[0][0].baslangic).toBeNull();
      // 00:15: secilen 00:00 yarina kayar - acikca "yarın" ve kalan sure, uyari.
      vi.setSystemTime(new Date(2026, 10, 4, 0, 15));
      rerender(<GeceKuyrugu isAdmin taslak={[...t]} setTaslak={() => {}} onKosuAc={() => {}} />);
      expect(await screen.findByText(/Başlangıç yarın 00:00 \(23 sa 45 dk sonra\)/)).toBeTruthy();
      expect(screen.getByText(/^Kuyruk yarın 00:00 \(23 sa 45 dk sonra\) başlar\./)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
