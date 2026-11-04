// src/components/nginx_console/__tests__/yuk-testi-duzenle.test.tsx — Yük Testi: duraklat, düzenle, kayıtlı test, toplu ekleme (2026-11-04).
//
// DU  Duraklat: duraklatmaDurumu turetimi; iki secenekli pencere; durdurma hatasi; Devam et; Admin olmayana eylem yok.
// DZ  Duzenle: taslak ogesi yerinde (sira korunur), bekleyen kuyruk ogesi PUT + uyari_onayi, donus ayni ayrintiya; senaryo
//     adi / aciklama / vhost penceresi.
// SB  Kayitli test: formGovdeden gidis-donus; Yükle / Farklı kaydet / Güncelle / Sil; 409 sablon_var; senaryosu silinmis kayit.
// MX  Toplu ekleme: 30 oge, sira ve etiket; her oge GERCEK sunucu dogrulamasindan gecer; kapali kosullar nedeniyle yazilir.
import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { NlKuyruk, NlKuyrukGovde, NlKuyrukOge, NlSinirlar, NlVarsayilanlar } from '@/api/nginxLoadtestApi';
import { DURAKLATMA_METNI, MAX_OGE, TASLAK_ANAHTARI, duraklatmaDurumu, ogeDuzenlenir, ogeGovdesi, taslakGuncelle, type TaslakOge } from '../yukTesti/kuyrukTaslak';
import { etiketsizGovde, formBaslangic, formGovdeden } from '../yukTesti/formGovde';
import MatrisEkle from '../yukTesti/MatrisEkle';
import { MATRIS_VARSAYILAN, matrisKapaliNedeni, matrisUret, ogeOzeti, seviyeleriAyristir } from '../yukTesti/matris';
import { sablonAdiHatasi } from '../yukTesti/KayitliTest';

const SINIR: NlSinirlar = {
  maxHiz: 5000, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 1000, maxButceSn: 2700,
  baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50, maxTavanRps: 5000,
};
const VARSAYILAN: NlVarsayilanlar = {
  motor: 'k6', hizlar: [100, 250, 400], maxvu: 150, baglantilar: [2, 4, 8], is_parcacigi: 2, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60,
  kip: 'yeni', ae: 'br', serbest: { hizlar: [50, 100, 200], maxvu: 50 },
};
const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryoGuncelle: vi.fn(), onKontrol: vi.fn(), baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), ipSinifi: vi.fn(),
  kuyruklar: vi.fn(), kuyruk: vi.fn(), kuyrukOlustur: vi.fn(), kuyrukIptal: vi.fn(), kuyrukSira: vi.fn(), kuyrukOgeCikar: vi.fn(), kuyrukOgeGuncelle: vi.fn(),
  kuyrukDuraklat: vi.fn(), kuyrukDevam: vi.fn(), sablonlar: vi.fn(), sablonEkle: vi.fn(), sablonGuncelle: vi.fn(), sablonSil: vi.fn(),
}));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { YukTestiTab } from '../YukTestiTab';
import GeceKuyrugu from '../yukTesti/GeceKuyrugu';
import Senaryolar from '../yukTesti/Senaryolar';

const VHOST = 'glomo-test.garantibbva.com.tr';
const DIZIN = '/usr/nginx/applications/glomo';
const HEDEFLER = {
  ok: true,
  hedefler: [{ host: 'GBNGXT33', env: 'TEST', ipler: ['192.168.133.27'], vhostlar: [VHOST], vhostVerisi: true, uygun: true, neden: null }],
  yukHostlari: [{ host: 'GBNGXT34', env: 'TEST', uygun: true, neden: null }],
  sinirlar: SINIR, varsayilan: VARSAYILAN, serbest: { acik: true, aglar: [] }, motorlar: ['k6', 'wrk'],
  araclar: { hazir: true, aracId: 5, k6Surum: 'v0.49.0', wrkSurum: '4.2.0', kod: null, mesaj: null },
};
const SENARYO = { id: 3, ad: 'GLOMO', aciklama: 'giriş', vhost: VHOST, senaryoTur: 'K', yolSayisi: 264, sha256: 'b'.repeat(64), kaynak: 'har', createdBy: 'onur', createdAt: '2026-10-26T10:00:00Z' };
const GOVDE: NlKuyrukGovde = {
  senaryoId: 3, hedefHost: 'GBNGXT33', hedefIp: '192.168.133.27', vhost: VHOST, yukHost: 'GBNGXT34', sni: true,
  parametreler: { motor: 'k6', hizlar: [45, 90], maxvu: 150, tekrar: 1, isinma: 10, sure: 40, bosluk: 10, bosta: 30, kip: 'ka', ae: 'br', protokol: 'h2', sunucuAyar: { seviye: 6, static: true, dizin: DIZIN } },
};
const taslakOge = (yerelId: string, etiket: string): TaslakOge => ({ yerelId, etiket, govde: GOVDE, onKontrolKosuId: 77, hedef: 'GBNGXT33', ozet: 'o', butceSn: 300 });

function kuyruk(o: Partial<NlKuyruk> = {}): NlKuyruk {
  return {
    id: 7, ad: null, durum: 'CALISIYOR', beklemeDk: 5, baslangicAt: '2026-11-03T21:00:00Z', enGecBitis: null, onayHedefi: 'GBNGXT33', hedefTuru: 'sunucu',
    onaylananTurler: [], createdBy: 'onur', createdAt: '2026-11-03T20:55:00Z', iptalEden: null, iptalAt: null, bitisAt: null, sonHata: null,
    dinlenmeKosuId: null, dinlenmeBitis: null, ogeSayisi: 2, bitenSayisi: 0, tahminiBitis: '2026-11-03T23:30:00Z', siradakiKalanSn: null, duraklatAt: null, duraklatan: null, ...o,
  };
}
function oge(o: Partial<NlKuyrukOge>): NlKuyrukOge {
  return {
    id: 1, sira: 1, etiket: 'A1', durum: 'BEKLIYOR', asama: null, onKontrolKosuId: null, kosuId: null, neden: null, butceSn: 600, uyariTurleri: [], baslamaAt: null, bitisAt: null,
    ayar: { senaryoId: 3, hedefIp: GOVDE.hedefIp, hedefHost: GOVDE.hedefHost, vhost: VHOST, yukHost: GOVDE.yukHost, sni: true, parametreler: GOVDE.parametreler }, ...o,
  };
}
const CALISAN = oge({ id: 1, etiket: 'A1 süren', durum: 'CALISIYOR', asama: 'kosu', onKontrolKosuId: 109, kosuId: 110 });
const BEKLEYEN = oge({ id: 2, sira: 2, etiket: 'A2 bekleyen' });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  window.localStorage.removeItem(TASLAK_ANAHTARI);
  api.kosular.mockResolvedValue({ ok: true, kosular: [], dahaVar: false });
  api.senaryolar.mockResolvedValue({ ok: true, senaryolar: [SENARYO] });
  api.hedefler.mockResolvedValue(HEDEFLER);
  api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [] });
  api.sablonlar.mockResolvedValue({ ok: true, sablonlar: [] });
  api.ipSinifi.mockImplementation(async (ip: string) => ({
    ok: true, tur: 'sunucu', ip, host: 'GBNGXT33', env: 'TEST', vhostlar: [VHOST], vhostVerisi: true, hizSiniri: null, vuSiniri: null, uygun: true, neden: null, kod: null, kaynaklar: [],
  }));
});

async function ayrintiAc(k: NlKuyruk, ogeler: NlKuyrukOge[], props: Partial<React.ComponentProps<typeof GeceKuyrugu>> = {}) {
  api.kuyruk.mockResolvedValue({ ok: true, kuyruk: k, ogeler });
  api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [k] });
  render(<GeceKuyrugu isAdmin taslak={[]} setTaslak={() => {}} onKosuAc={() => {}} {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
  await screen.findByText('Gece kuyruğu #7');
}

describe('Yük Testi — duraklat', () => {
  it('DU1 duraklatmaDurumu: bayrak yoksa ya da kuyruk bittiyse null; iş ya da kilit varsa bekliyor; değilse duraklatıldı', () => {
    const at = '2026-11-04T01:00:00Z';
    const bos = [{ durum: 'BEKLIYOR' as const }];
    const calisan = [{ durum: 'CALISIYOR' as const }];
    expect(duraklatmaDurumu({ durum: 'CALISIYOR', duraklatAt: null, dinlenmeBitis: null }, calisan)).toBeNull();
    expect(duraklatmaDurumu({ durum: 'BITTI', duraklatAt: at, dinlenmeBitis: null }, bos)).toBeNull();
    expect(duraklatmaDurumu({ durum: 'CALISIYOR', duraklatAt: at, dinlenmeBitis: null }, calisan)).toBe('bekliyor');
    expect(duraklatmaDurumu({ durum: 'DINLENME', duraklatAt: at, dinlenmeBitis: null }, bos)).toBe('bekliyor');
    expect(duraklatmaDurumu({ durum: 'DINLENME', duraklatAt: at, dinlenmeBitis: at }, bos)).toBe('duraklatildi');
    expect(duraklatmaDurumu({ durum: 'CALISIYOR', duraklatAt: at, dinlenmeBitis: null }, bos)).toBe('duraklatildi');
    expect(duraklatmaDurumu({ durum: 'BEKLIYOR', duraklatAt: at, dinlenmeBitis: null }, bos)).toBe('duraklatildi');
    // Sunucu bilgisi: hedef mesgul ya da (listede) calisan oge varsa bekliyor; geri alma sorunu "dokunabilirsiniz" dedirtmez.
    const k = { durum: 'CALISIYOR' as const, duraklatAt: at, dinlenmeBitis: null };
    expect(duraklatmaDurumu({ ...k, hedefMesgul: true }, bos)).toBe('bekliyor');
    expect(duraklatmaDurumu({ ...k, calisanVar: true }, [])).toBe('bekliyor');
    expect(duraklatmaDurumu({ ...k, geriAlmaSorunu: { kosuId: 5, metin: null } }, bos)).toBe('geri_alma');
    expect(duraklatmaDurumu({ ...k, hedefMesgul: true, geriAlmaSorunu: { kosuId: 5, metin: null } }, bos)).toBe('bekliyor');
    expect(duraklatmaDurumu({ ...k, geriAlmaSorunu: { kosuId: 5, metin: null } }, calisan)).toBe('bekliyor');
  });

  it('DU2 süren koşu varken iki seçenek; varsayılan "bitsin" surenDurdur false gönderir', async () => {
    await ayrintiAc(kuyruk(), [CALISAN, BEKLEYEN]);
    fireEvent.click(screen.getByRole('button', { name: 'Duraklat' }));
    const p = await screen.findByRole('dialog');
    expect(within(p).getByRole('radio', { name: /Süren koşu bitsin, sonra dur/ })).toBeChecked();
    expect(within(p).getByText(/Durdurulan koşu devamda baştan koşulur; sonucu kullanılmaz\./)).toBeTruthy();
    expect(within(p).queryByRole('button', { name: /Vazgeç/ })).toBeNull();
    api.kuyrukDuraklat.mockResolvedValue({ ok: true, suren: { ogeId: 1, etiket: 'A1 süren', kosuId: 110, onKontrolKosuId: 109 }, durduruldu: false, durdurHatasi: null });
    fireEvent.click(within(p).getByRole('button', { name: 'Duraklat' }));
    await waitFor(() => expect(api.kuyrukDuraklat).toHaveBeenCalledWith(7, false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('DU3 "şimdi durdur" true gönderir; durdurma hatası kutu + Koşuyu aç, duraklatma geri alınmaz', async () => {
    const ac = vi.fn();
    await ayrintiAc(kuyruk(), [CALISAN, BEKLEYEN], { onKosuAc: ac });
    fireEvent.click(screen.getByRole('button', { name: 'Duraklat' }));
    const p = await screen.findByRole('dialog');
    fireEvent.click(within(p).getByRole('radio', { name: /Süren koşuyu şimdi durdur/ }));
    api.kuyrukDuraklat.mockResolvedValue({ ok: true, suren: { ogeId: 1, etiket: 'A1 süren', kosuId: 110, onKontrolKosuId: 109 }, durduruldu: false, durdurHatasi: 'AWX yok' });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: kuyruk({ duraklatAt: '2026-11-04T01:00:00Z', duraklatan: 'onur' }), ogeler: [CALISAN, BEKLEYEN] });
    fireEvent.click(within(p).getByRole('button', { name: 'Duraklat' }));
    await waitFor(() => expect(api.kuyrukDuraklat).toHaveBeenCalledWith(7, true));
    expect(await screen.findByText('Süren iş durdurulamadı; kuyruk yine duraklatıldı.')).toBeTruthy();
    expect(screen.getByText('AWX yok')).toBeTruthy();
    expect(await screen.findByText(DURAKLATMA_METNI.bekliyor)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Koşuyu aç' }));
    expect(ac).toHaveBeenCalledWith(110);
    // Is surerken hap "Duraklatıldı" demez: sunucuya dokunma uyarisiyla celismesin.
    expect(screen.getByText('Duraklatılıyor')).toBeTruthy();
    expect(screen.queryByText('Duraklatıldı')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duraklat' })).toBeNull();
  });

  it('DU4 çalışan öğe yoksa tek onay; duraklatılmışken metin, Devam et, 409 duraklatma_suruyor', async () => {
    const k = kuyruk({ durum: 'DINLENME', dinlenmeBitis: '2026-11-04T01:10:00Z', dinlenmeKosuId: 110, siradakiKalanSn: 200 });
    await ayrintiAc(k, [BEKLEYEN]);
    fireEvent.click(screen.getByRole('button', { name: 'Duraklat' }));
    const p = await screen.findByRole('dialog');
    expect(within(p).queryByRole('radio')).toBeNull();
    api.kuyrukDuraklat.mockResolvedValue({ ok: true, suren: null, durduruldu: false, durdurHatasi: null });
    const dur = { ...k, duraklatAt: '2026-11-04T01:00:00Z', duraklatan: 'onur' };
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: dur, ogeler: [BEKLEYEN] });
    fireEvent.click(within(p).getByRole('button', { name: 'Duraklat' }));
    await waitFor(() => expect(api.kuyrukDuraklat).toHaveBeenCalledWith(7, false));
    expect(await screen.findByText(DURAKLATMA_METNI.duraklatildi)).toBeTruthy();
    expect(screen.queryByText(/Sıradaki .* sonra\./)).toBeNull();
    expect(screen.getByText('Duraklatıldı')).toBeTruthy();
    const devam = screen.getByRole('button', { name: 'Devam et' });
    api.kuyrukDevam.mockResolvedValueOnce({ ok: false, code: 'duraklatma_suruyor', message: 'Koşu durduruluyor; durunca yeniden deneyin', _httpStatus: 409 });
    fireEvent.click(devam);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Koşu durduruluyor; durunca yeniden deneyin'));
    api.kuyrukDevam.mockResolvedValueOnce({ ok: true });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: k, ogeler: [BEKLEYEN] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Devam et' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Devam et' }));
    await waitFor(() => expect(api.kuyrukDevam).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Duraklat' })).toBeTruthy();
  });

  it('DU5 liste hapı, duraklatılmışken İptal açık; Admin olmayana Duraklat / Devam yok', async () => {
    const dur = kuyruk({ duraklatAt: '2026-11-04T01:00:00Z' });
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [dur] });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: dur, ogeler: [BEKLEYEN] });
    const { unmount } = render(<GeceKuyrugu isAdmin taslak={[]} setTaslak={() => {}} onKosuAc={() => {}} />);
    expect(await screen.findByText('Duraklatıldı')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
    await screen.findByText('Gece kuyruğu #7');
    expect(screen.getByRole('button', { name: 'İptal' })).toBeEnabled();
    unmount();
    render(<GeceKuyrugu isAdmin={false} taslak={[]} setTaslak={() => {}} onKosuAc={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
    await screen.findByText('Gece kuyruğu #7');
    expect(screen.queryByRole('button', { name: 'Devam et' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duraklat' })).toBeNull();
    expect(screen.getByText(DURAKLATMA_METNI.duraklatildi)).toBeTruthy();
  });

  it('DU6 geri alma sorunu: "işlem yapabilirsiniz" denmez, hata kutusu ve Koşuyu aç; liste aynı hapı gösterir', async () => {
    const ac = vi.fn();
    const k = kuyruk({ duraklatAt: '2026-11-04T01:00:00Z', calisanVar: false, hedefMesgul: false, geriAlmaSorunu: { kosuId: 110, metin: 'nginx -t kaldı' } });
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [k] });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: k, ogeler: [BEKLEYEN] });
    render(<GeceKuyrugu isAdmin taslak={[]} setTaslak={() => {}} onKosuAc={ac} />);
    expect(await screen.findByText('Geri alma gerekli')).toBeTruthy();
    expect(screen.queryByText('Duraklatıldı')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
    expect(await screen.findByText(DURAKLATMA_METNI.geri_alma)).toBeTruthy();
    expect(screen.getByText('nginx -t kaldı')).toBeTruthy();
    expect(screen.queryByText(DURAKLATMA_METNI.duraklatildi)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Koşuyu aç (#110)' }));
    expect(ac).toHaveBeenCalledWith(110);
  });

  it('DU7 liste: iş sürerken "Duraklatıldı" yazmaz, ayrıntıyla aynı "Duraklatılıyor"', async () => {
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [kuyruk({ duraklatAt: '2026-11-04T01:00:00Z', calisanVar: true, hedefMesgul: false, geriAlmaSorunu: null })] });
    render(<GeceKuyrugu isAdmin taslak={[]} setTaslak={() => {}} onKosuAc={() => {}} />);
    expect(await screen.findByText('Duraklatılıyor')).toBeTruthy();
    expect(screen.queryByText('Duraklatıldı')).toBeNull();
  });
});

describe('Yük Testi — düzenle', () => {
  const kaydet = () => screen.getByRole('button', { name: 'Değişikliği kaydet' });

  it('DZ0 saf yardımcılar: taslakGuncelle sırayı korur ve ön kontrolü düşürür; ogeGovdesi; ogeDuzenlenir', () => {
    const t = [taslakOge('a', 'A'), taslakOge('b', 'B')];
    const y = taslakGuncelle(t, 'a', { etiket: 'A2', govde: GOVDE, hedef: 'H', ozet: 'z', butceSn: 1 });
    expect(y.map((o) => o.etiket)).toEqual(['A2', 'B']);
    expect(y[0]).toMatchObject({ yerelId: 'a', onKontrolKosuId: null, hedef: 'H' });
    expect(y[1].onKontrolKosuId).toBe(77);
    expect(ogeGovdesi(oge({}))).toEqual(GOVDE);
    expect(ogeGovdesi(oge({ ayar: { ...oge({}).ayar, parametreler: null } }))).toBeNull();
    expect(ogeDuzenlenir({ durum: 'BEKLIYOR', onKontrolKosuId: null, kosuId: null })).toBe(true);
    expect(ogeDuzenlenir({ durum: 'BEKLIYOR', onKontrolKosuId: 5, kosuId: null })).toBe(false);
    expect(ogeDuzenlenir({ durum: 'CALISIYOR', onKontrolKosuId: null, kosuId: null })).toBe(false);
  });

  it('DZ1 taslak ogesi: form dolar, gövde bozulmaz, yerinde değişir, Gece kuyruğuna döner', async () => {
    window.localStorage.setItem(TASLAK_ANAHTARI, JSON.stringify([taslakOge('a', 'A1'), taslakOge('b', 'A2')]));
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Gece kuyruğu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'A1 düzenle' }));
    expect(await screen.findByText('“A1” düzenleniyor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Kuyruğa ekle/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Taslağa toplu ekle' })).toBeNull();
    expect(await screen.findByLabelText('Kuyruk etiketi (zorunlu)')).toHaveValue('A1');
    await waitFor(() => expect(kaydet()).toBeEnabled(), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText('Kuyruk etiketi (zorunlu)'), { target: { value: 'A1 yeni' } });
    fireEvent.click(kaydet());
    const liste = await screen.findByRole('list', { name: 'Taslak öğeleri' });
    expect(within(liste).getByText('A1 yeni')).toBeTruthy();
    const kayit = JSON.parse(window.localStorage.getItem(TASLAK_ANAHTARI) || '[]');
    expect(kayit.map((o: TaslakOge) => o.etiket)).toEqual(['A1 yeni', 'A2']);
    expect(kayit[0].onKontrolKosuId).toBeNull();
    expect(kayit[0].govde).toEqual(GOVDE);
    expect(kayit[0].ozet).toMatch(/brotli 6 · static/);
  });

  it('DZ2 İptal değişiklik yazmaz; alt sekme düzenlemeyi bırakır', async () => {
    window.localStorage.setItem(TASLAK_ANAHTARI, JSON.stringify([taslakOge('a', 'A1')]));
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Gece kuyruğu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'A1 düzenle' }));
    fireEvent.change(await screen.findByLabelText('Kuyruk etiketi (zorunlu)'), { target: { value: 'değişti' } });
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    const liste = await screen.findByRole('list', { name: 'Taslak öğeleri' });
    expect(within(liste).getByText('A1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'A1 düzenle' }));
    await screen.findByText('“A1” düzenleniyor');
    fireEvent.click(screen.getByRole('tab', { name: /Koşular/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Yeni koşu/ }));
    await screen.findByLabelText('Senaryo');
    expect(screen.queryByText('“A1” düzenleniyor')).toBeNull();
    expect(screen.getByRole('button', { name: /^Kuyruğa ekle/ })).toBeTruthy();
  });

  it('DZ3 kuyruk ogesi: PUT, uyari_onayi onay kutuları, ikinci istek türleri taşır, aynı kuyruğa döner', async () => {
    const k = kuyruk({ durum: 'DINLENME', dinlenmeBitis: '2026-11-04T01:10:00Z' });
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [k] });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk: k, ogeler: [oge({ id: 1, durum: 'BITTI', kosuId: 102, onKontrolKosuId: 101 }), BEKLEYEN] });
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Gece kuyruğu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #7' }));
    expect(screen.queryByRole('button', { name: 'A1 düzenle' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'A2 bekleyen düzenle' }));
    await screen.findByText('“A2 bekleyen” düzenleniyor');
    await screen.findByLabelText('Kuyruk etiketi (zorunlu)');
    await waitFor(() => expect(kaydet()).toBeEnabled(), { timeout: 3000 });
    api.kuyrukOgeGuncelle.mockResolvedValueOnce({ ok: false, code: 'uyari_onayi', message: 'onay', _httpStatus: 409, uyariTurleri: [{ kod: 'U1', ornek: 'limit aşımı' }] });
    fireEvent.click(kaydet());
    await waitFor(() => expect(api.kuyrukOgeGuncelle).toHaveBeenCalledTimes(1));
    expect(api.kuyrukOgeGuncelle.mock.calls[0]).toEqual([7, 2, { etiket: 'A2 bekleyen', govde: GOVDE }]);
    const tur = await screen.findByLabelText(/U1 limit aşımı/);
    expect(kaydet()).toBeDisabled();
    fireEvent.click(tur);
    expect(kaydet()).toBeEnabled();
    api.kuyrukOgeGuncelle.mockResolvedValueOnce({ ok: false, code: 'hedef_farkli', message: 'hedef farklı', _httpStatus: 409 });
    fireEvent.click(kaydet());
    await waitFor(() => expect(api.kuyrukOgeGuncelle).toHaveBeenCalledTimes(2));
    expect(api.kuyrukOgeGuncelle.mock.calls[1][2].onaylananTurler).toEqual(['U1']);
    expect(await screen.findByText('hedef farklı')).toBeTruthy();
    api.kuyrukOgeGuncelle.mockResolvedValueOnce({ ok: true });
    await waitFor(() => expect(kaydet()).toBeEnabled());
    fireEvent.click(kaydet());
    expect(await screen.findByText('Gece kuyruğu #7')).toBeTruthy();
  });

  it('DZ4 senaryo: yalnız Admin; ad, açıklama, vhost; içerik notu; 409 senaryo_yok görünür', async () => {
    const { unmount } = render(<Senaryolar isAdmin={false} />);
    await screen.findByText('GLOMO');
    expect(screen.queryByRole('button', { name: 'GLOMO düzenle' })).toBeNull();
    unmount();
    const degisti = vi.fn();
    render(<Senaryolar isAdmin onDegisti={degisti} />);
    fireEvent.click(await screen.findByRole('button', { name: 'GLOMO düzenle' }));
    const p = await screen.findByRole('dialog');
    expect(within(p).getByText(/geçmiş koşular bu içeriğe bağlıdır/)).toBeTruthy();
    const ad = within(p).getByLabelText('Ad');
    expect(ad).toHaveValue('GLOMO');
    fireEvent.change(ad, { target: { value: '  ' } });
    expect(within(p).getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    fireEvent.change(ad, { target: { value: ' GLOMO 2 ' } });
    fireEvent.change(within(p).getByLabelText('Açıklama (isteğe bağlı)'), { target: { value: '' } });
    fireEvent.change(within(p).getByLabelText('Vhost (isteğe bağlı)'), { target: { value: 'Yanlis:443' } });
    expect(within(p).getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    fireEvent.change(within(p).getByLabelText('Vhost (isteğe bağlı)'), { target: { value: '' } });
    api.senaryoGuncelle.mockResolvedValueOnce({ ok: false, code: 'senaryo_yok', _httpStatus: 409 });
    fireEvent.click(within(p).getByRole('button', { name: 'Kaydet' }));
    expect(await within(p).findByText('senaryo bulunamadı')).toBeTruthy();
    expect(api.senaryoGuncelle).toHaveBeenCalledWith(3, { ad: 'GLOMO 2', aciklama: '', vhost: '' });
    api.senaryoGuncelle.mockResolvedValueOnce({ ok: true });
    fireEvent.click(within(p).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(degisti).toHaveBeenCalledTimes(1);
    expect(api.senaryolar).toHaveBeenCalledTimes(3);
  });
});

describe('Yük Testi — kayıtlı test', () => {
  const SABLON = { id: 9, ad: 'GLOMO h2', govde: GOVDE, createdBy: 'onur', createdAt: null, updatedBy: null, updatedAt: null };
  async function acSec(sablon = SABLON) {
    api.sablonlar.mockResolvedValue({ ok: true, sablonlar: [sablon] });
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    const sec = await screen.findByLabelText('Kayıtlı test');
    await within(sec).findByRole('option', { name: sablon.ad });
    fireEvent.change(sec, { target: { value: String(sablon.id) } });
    fireEvent.click(screen.getByRole('button', { name: 'Yükle' }));
  }

  it('SB0 formGovdeden: k6 ve wrk gövdesi formu doldurur; etiket boş; sunucu ayarsızsa kapalı, son dizin kalır', () => {
    const bos = { ...formBaslangic(VARSAYILAN, 'X'), etiket: 'eski', srvDizin: '/son', srvAyar: true };
    const f = formGovdeden(bos, GOVDE);
    expect(f).toMatchObject({
      senaryoId: '3', hedefHost: 'GBNGXT33', hedefIp: GOVDE.hedefIp, vhost: VHOST, yukHost: 'GBNGXT34', sni: true, motor: 'k6', hizlar: '45 90', maxvu: '150', tekrar: '1', isinma: '10', sure: '40',
      bosluk: '10', bosta: '30', kip: 'ka', ae: 'br', protokol: 'h2', srvAyar: true, srvSeviye: '6', srvStatic: true, srvDizin: DIZIN, etiket: '', baglantilar: '2 4 8',
    });
    const w = formGovdeden(bos, { ...GOVDE, hedefHost: null, sni: false, parametreler: { motor: 'wrk', baglantilar: [4, 8], is_parcacigi: 4, tekrar: 2, isinma: 5, sure: 40, bosluk: 0, bosta: 30, kip: 'yeni', ae: 'identity' } });
    expect(w).toMatchObject({ hedefHost: '', motor: 'wrk', baglantilar: '4 8', is_parcacigi: '4', hizlar: null, ae: 'identity', protokol: 'h1', srvAyar: false, srvSeviye: '', srvStatic: false, srvDizin: '/son' });
    expect(etiketsizGovde({ ...GOVDE, etiket: 'x' })).toEqual(GOVDE);
    expect(sablonAdiHatasi('a'.repeat(121))).toMatch(/120/);
    expect(sablonAdiHatasi('a\tb')).toMatch(/Kontrol/);
    expect(sablonAdiHatasi('  iyi ad ')).toBeNull();
  });

  it('SB1 Yükle formu doldurur; Farklı kaydet aynı gövdeyi etiketsiz gönderir; 409 sablon_var; başarıda seçili olur', async () => {
    await acSec();
    expect(screen.getByLabelText('Hedef IP')).toHaveValue(GOVDE.hedefIp);
    expect(screen.getByLabelText('Senaryo')).toHaveValue('3');
    expect(screen.getByLabelText('Uygulama dizini')).toHaveValue(DIZIN);
    const ad = screen.getByLabelText('Yeni kayıt adı');
    fireEvent.change(ad, { target: { value: ' Yeni ad ' } });
    const fk = screen.getByRole('button', { name: 'Farklı kaydet' });
    await waitFor(() => expect(fk).toBeEnabled(), { timeout: 3000 });
    api.sablonEkle.mockResolvedValueOnce({ ok: false, code: 'sablon_var', _httpStatus: 409 });
    fireEvent.click(fk);
    expect(await screen.findByText('bu adla kayıtlı bir test var')).toBeTruthy();
    expect(api.sablonEkle).toHaveBeenCalledWith({ ad: 'Yeni ad', govde: GOVDE });
    api.sablonEkle.mockResolvedValueOnce({ ok: true, id: 10 });
    api.sablonlar.mockResolvedValue({ ok: true, sablonlar: [SABLON, { ...SABLON, id: 10, ad: 'Yeni ad' }] });
    await waitFor(() => expect(fk).toBeEnabled());
    fireEvent.click(fk);
    await waitFor(() => expect(screen.getByLabelText('Kayıtlı test')).toHaveValue('10'));
    expect(ad).toHaveValue('');
  });

  it('SB1b elle IP sınıflandırılamazken (424) kayıt kapalı: sunucu ayarı sessizce silinmez; neden yazılır', async () => {
    const elle = { ...GOVDE, hedefHost: null };
    api.sablonlar.mockResolvedValue({ ok: true, sablonlar: [{ ...SABLON, govde: elle }] });
    api.ipSinifi.mockImplementation(async () => ({ ok: false, code: 'envanter_bayat', message: 'envanter bayat', _httpStatus: 424 }));
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    fireEvent.change(await screen.findByLabelText('Kayıtlı test'), { target: { value: String(SABLON.id) } });
    fireEvent.click(screen.getByRole('button', { name: 'Yükle' }));
    await waitFor(() => expect(api.ipSinifi).toHaveBeenCalled(), { timeout: 3000 });
    expect(await screen.findByText(/Hedef türü belirlenmeden kaydedilemez/, undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Güncelle' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Yeni kayıt adı'), { target: { value: 'kopya' } });
    expect(screen.getByRole('button', { name: 'Farklı kaydet' })).toBeDisabled();
    expect(api.sablonGuncelle).not.toHaveBeenCalled();
  });

  it('SB2 Güncelle ve Sil onaylı; Sil seçimi boşaltır', async () => {
    await acSec();
    const guncelle = screen.getByRole('button', { name: 'Güncelle' });
    await waitFor(() => expect(guncelle).toBeEnabled(), { timeout: 3000 });
    fireEvent.click(guncelle);
    let p = await screen.findByRole('dialog');
    expect(api.sablonGuncelle).not.toHaveBeenCalled();
    api.sablonGuncelle.mockResolvedValue({ ok: true });
    fireEvent.click(within(p).getByRole('button', { name: 'Güncelle' }));
    await waitFor(() => expect(api.sablonGuncelle).toHaveBeenCalledWith(9, { ad: 'GLOMO h2', govde: GOVDE }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Sil' }));
    p = await screen.findByRole('dialog');
    expect(api.sablonSil).not.toHaveBeenCalled();
    api.sablonSil.mockResolvedValue({ ok: true });
    api.sablonlar.mockResolvedValue({ ok: true, sablonlar: [] });
    fireEvent.click(within(p).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(api.sablonSil).toHaveBeenCalledWith(9));
    await waitFor(() => expect(screen.getByLabelText('Kayıtlı test')).toHaveValue(''));
  });

  it('SB3 senaryosu silinmiş kayıt uyarır, form geçersiz kalır', async () => {
    await acSec({ ...SABLON, govde: { ...GOVDE, senaryoId: 99 } });
    expect(await screen.findByText(/Kayıtlı ayarların senaryosu \(#99\) listede yok/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Farklı kaydet' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ön kontrolü başlat/ })).toBeDisabled();
  });

  it('SB4 liste okunamazsa form yine çalışır', async () => {
    api.sablonlar.mockRejectedValue(new Error('okunamadı'));
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    expect(await screen.findByText(/Kayıtlı testler okunamadı: okunamadı/)).toBeTruthy();
    expect(screen.getByLabelText('Senaryo')).toBeTruthy();
  });
});

describe('Yük Testi — toplu ekleme', () => {
  const dogrula = createRequire(import.meta.url)('../../../../server/nginx-loadtest/dogrula.cjs') as { parametreler: (p: unknown, o: { sni: boolean; hedefTuru: string }) => { ok: boolean; message?: string } };

  it('MX1 30 öğe, sıra protokol > sıkıştırma > static, etiketler, yalnız dört alan değişir', () => {
    const { ogeler, hatalar } = matrisUret(GOVDE, MATRIS_VARSAYILAN);
    expect(hatalar).toEqual({});
    expect(ogeler).toHaveLength(MAX_OGE);
    expect(ogeler.slice(0, 3).map((o) => o.etiket)).toEqual(['HTTP/2 · Brotli 6 · static açık', 'HTTP/2 · Brotli 6 · static kapalı', 'HTTP/2 · Brotli 4 · static açık']);
    expect(ogeler.map((o) => o.etiket)).toContain('HTTP/1.1 yeni bağlantı · Gzip 4 · static kapalı');
    expect(ogeler.map((o) => o.etiket)).toContain('HTTP/1.1 keep-alive · Sıkıştırmasız · static açık');
    expect(new Set(ogeler.map((o) => o.etiket)).size).toBe(30);
    expect(ogeler.every((o) => o.etiket.length <= 100)).toBe(true);
    const son = ogeler[29];
    expect(son.etiket).toBe('HTTP/1.1 yeni bağlantı · Sıkıştırmasız · static kapalı');
    expect(son.govde).toEqual({ ...GOVDE, parametreler: { ...GOVDE.parametreler, protokol: 'h1', kip: 'yeni', ae: 'identity', sunucuAyar: { seviye: null, static: false, dizin: DIZIN } } });
    expect(ogeler[0].govde.parametreler).toMatchObject({ protokol: 'h2', kip: 'ka', ae: 'br', sunucuAyar: { seviye: 6, static: true, dizin: DIZIN } });
  });

  it('MX2 her öğe gerçek sunucu doğrulamasından geçer (dogrula.cjs parametreler), en yüksek seviyeler dahil', () => {
    const { ogeler } = matrisUret(GOVDE, { ...MATRIS_VARSAYILAN, brSeviyeler: '1 11', gzipSeviyeler: '1 9' });
    expect(ogeler).toHaveLength(30);
    for (const o of ogeler) {
      const r = dogrula.parametreler(o.govde.parametreler, { sni: o.govde.sni, hedefTuru: 'sunucu' });
      expect([o.etiket, r.ok, r.message]).toEqual([o.etiket, true, undefined]);
    }
  });

  it('MX3 seviye denetimi, boş seçimler, ogeOzeti formülü', () => {
    expect(seviyeleriAyristir('6, 4', 'br')).toEqual({ seviyeler: [6, 4], hata: null });
    expect(seviyeleriAyristir('', 'gzip')).toEqual({ seviyeler: [], hata: null });
    expect(seviyeleriAyristir('12', 'br').hata).toMatch(/1–11/);
    expect(seviyeleriAyristir('10', 'gzip').hata).toMatch(/1–9/);
    expect(seviyeleriAyristir('4 4', 'br').hata).toMatch(/iki kez/);
    expect(seviyeleriAyristir('a', 'br').hata).toBeTruthy();
    expect(matrisUret(GOVDE, { ...MATRIS_VARSAYILAN, gzipSeviyeler: '10' })).toMatchObject({ ogeler: [], hatalar: { gzip: expect.stringMatching(/1–9/) } });
    expect(matrisUret(null, MATRIS_VARSAYILAN).ogeler).toEqual([]);
    expect(matrisUret({ ...GOVDE, parametreler: { ...GOVDE.parametreler, sunucuAyar: null } }, MATRIS_VARSAYILAN).ogeler).toEqual([]);
    expect(matrisUret(GOVDE, { protokoller: ['h2'], brSeviyeler: '', gzipSeviyeler: '', sikistirmasiz: true, staticler: [false] }).ogeler.map((o) => o.etiket)).toEqual(['HTTP/2 · Sıkıştırmasız · static kapalı']);
    // Bütce: 30 + 2*1*(10+40+10+20) + 120 = 310; static acikta 180 sn hazirlik payi.
    expect(ogeOzeti(GOVDE.parametreler).butceSn).toBe(490);
    expect(ogeOzeti({ ...GOVDE.parametreler, sunucuAyar: { seviye: 6, static: false, dizin: DIZIN } }).butceSn).toBe(310);
    const k = { motor: 'k6' as const, hedefTuru: 'sunucu' as const, srvAyarli: true, formHazir: true, taslakSayisi: 0, ogeSayisi: 30 };
    expect(matrisKapaliNedeni(k)).toBeNull();
    expect(matrisKapaliNedeni({ ...k, motor: 'wrk' })).toMatch(/k6/);
    expect(matrisKapaliNedeni({ ...k, srvAyarli: false })).toMatch(/Sunucuyu koşu öncesi ayarla/);
    // Serbest / bilinmeyen hedefte kutu cizilmez: olmayan secenek aratilmaz.
    for (const hedefTuru of ['serbest', null] as const) {
      expect(matrisKapaliNedeni({ ...k, hedefTuru, srvAyarli: false })).toMatch(/yalnız sunucu hedefinde/);
      expect(matrisKapaliNedeni({ ...k, hedefTuru, srvAyarli: false })).not.toMatch(/koşu öncesi ayarla/);
    }
    expect(matrisKapaliNedeni({ ...k, formHazir: false })).toMatch(/eksikleri/);
    expect(matrisKapaliNedeni({ ...k, taslakSayisi: 1 })).toMatch(/30 sınırı aşılır/);
  });

  it('MX4 ekran: kapalı neden yazılır; açınca 30 öğe tek seferde taslağa; taslak doluysa sınır nedeni', async () => {
    render(<YukTestiTab isAdmin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
    fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Hedef sunucu (isteğe bağlı)'), { target: { value: 'GBNGXT33' } });
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: GOVDE.hedefIp } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Hazır ayar' })).getByRole('button', { name: /^Hızlı deneme/ }));
    const ekle = screen.getByRole('button', { name: 'Taslağa toplu ekle' });
    expect(ekle).toBeDisabled();
    fireEvent.click(await screen.findByLabelText(/Sunucuyu koşu öncesi ayarla/));
    expect(ekle).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/seviyesi \(1–/), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Uygulama dizini'), { target: { value: DIZIN } });
    await waitFor(() => expect(ekle).toBeEnabled(), { timeout: 3000 });
    expect(screen.getByText(/^30 öğe · ≈ \d+ sa/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Gzip seviyeleri'), { target: { value: '20' } });
    expect(screen.getByText(/Gzip seviyeleri 1–9 arası olmalı/)).toBeTruthy();
    expect(ekle).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Gzip seviyeleri'), { target: { value: '6 4' } });
    fireEvent.click(ekle);
    const kayit = JSON.parse(window.localStorage.getItem(TASLAK_ANAHTARI) || '[]');
    expect(kayit).toHaveLength(30);
    expect(kayit[0]).toMatchObject({ etiket: 'HTTP/2 · Brotli 6 · static açık', hedef: 'GBNGXT33', onKontrolKosuId: null });
    expect(kayit[0].ozet).toMatch(/sunucu ayarı: HTTP\/2 açık · brotli 6 · static/);
    expect(new Set(kayit.map((o: TaslakOge) => o.yerelId)).size).toBe(30);
    expect(toast.success).toHaveBeenCalledWith('Taslağa 30 öğe eklendi (taslakta 30 öğe).');
    expect(await screen.findByText(/30 sınırı aşılır/)).toBeTruthy();
    expect(ekle).toBeDisabled();
  });

  it('MX5 bitmiş ön kontrol her öğeye bağlanır; yoksa ekran uyarır, ekleme kapanmaz', () => {
    const ekle = vi.fn();
    const ortak = { govde: GOVDE, motor: 'k6' as const, hedefTuru: 'sunucu' as const, srvAyarli: true, hedef: 'GBNGXT33', taslakSayisi: 0, onEkle: ekle };
    const { unmount } = render(<MatrisEkle {...ortak} onKontrolKosuId={55} />);
    expect(screen.queryByText('Bu ayarlarla bitmiş ön kontrol yok.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Taslağa toplu ekle' }));
    expect(ekle.mock.calls[0][0]).toHaveLength(30);
    expect(ekle.mock.calls[0][0].every((o: TaslakOge) => o.onKontrolKosuId === 55)).toBe(true);
    unmount();
    render(<MatrisEkle {...ortak} onKontrolKosuId={null} />);
    expect(screen.getByText('Bu ayarlarla bitmiş ön kontrol yok.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Taslağa toplu ekle' })).toBeEnabled();
  });
});
