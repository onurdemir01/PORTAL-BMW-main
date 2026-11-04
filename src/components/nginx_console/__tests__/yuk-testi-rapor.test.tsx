// src/components/nginx_console/__tests__/yuk-testi-rapor.test.tsx — Yük Testi › Toplu rapor (2026-11-04).
//
// TR1 kolon sirasi: kullanicinin ornegi once, sonra ayrinti; temel kume ilk 18
// TR2 CSV: BOM, ';', ondalik virgul, bant Mbps, olculmeyen bos, '-' korunmadan, formul enjeksiyonu korumasi, yalniz verilen kolonlar
// TR3 bicim: bant ekranda kbps / Mbps / Gbps, eski kosu '-', gecerlilik ve neden cumleleri
// TR4 sutun secimi: localStorage'a yazilir, bilinmeyen kolon atilir, bozuk / kapali depolamada hepsi
// TR5 URL: oku / yaz (100 siniri, tekil, kuyruk onceligi), ekran adresten acilir
// TR6 ekran: tablo, hiz suzgeci veriden, sutun secici gizler ve hatirlar, atlananlar listelenir, hata metni
// TR7 giris: gece kuyrugundan ve Koşular secimiyle Toplu rapor; adres yazilir
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { render } from '@/test/test-utils';
import type { NlKosu, NlKuyruk, NlKuyrukOge, NlRapor, NlRaporSatir } from '@/api/nginxLoadtestApi';
import {
  KOLON_ANAHTARI, RAPOR_KOLONLARI, TEMEL_KOLONLAR, bellekNedenCumleleri, csvMetni, gecerlilikEtiketi, kolonSecimiOku, kolonSecimiYaz, nedenCumleleri, raporHizlari, urlDurumuOku, urlDurumuYaz,
} from '../yukTesti/topluRaporOrtak';

const api = vi.hoisted(() => ({ rapor: vi.fn(), kosular: vi.fn(), kuyruklar: vi.fn(), kuyruk: vi.fn() }));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));

import { YukTestiTab } from '../YukTestiTab';
import TopluRapor from '../yukTesti/TopluRapor';

function satir(o: Partial<NlRaporSatir> = {}): NlRaporSatir {
  return {
    kosuNo: 12, etiket: '[K3] A1', hiz: 100, protokol: 'h2', kip: 'ka', ae: 'br', brotliSeviye: 4, gzipSeviye: '-', gzipStatikSeviye: '-', gzipStatik: false,
    brotliStatikSeviye: '-', brotliStatik: false, toplamIstek: 3000, p50: 5.25, p95: 20.5, p99: 40, hostCpu: 31.25, bantBps: 12_400_000, tarih: '2026-11-03T20:00:00.000Z', sureSn: 330,
    durum: 'DONE', gecerlilik: 'GECERLI', tekrar: 1, gecerliTekrar: 1, gercekRps: 99.9, nedenler: [], uyarilar: [], kosuNedenleri: [], kipDogrulama: 'tamam', ttfbP95: 12, tlsP95: 3,
    connectP95: 1, sunucuP95: 9, hataOrani: 0.0012, n429: 0, n5xx: 2, atilan: 0, cpuMsIstek: 1.2345, kapasite: 8000, bellekMb: 50, bellekKaynak: 'pss', bellekArtisiMb: 2.5, bellekNedenleri: ['artis_yok'],
    bellekSizinti: null, testGonderilenBps: 850_000, nicOrtBps: 13_000_000, nicMaxBps: 1_230_000_000, baytIstek: 5000, yukCpuBosta: 70.5, yukBellekYuzde: 40, yukDoydu: false,
    gzUretilen: 0, brUretilen: 0, diskKanit: null, ...o,
  };
}
const eski = (o: Partial<NlRaporSatir> = {}) => satir({
  brotliSeviye: '-', gzipStatik: '-', brotliStatik: '-', bantBps: null, testGonderilenBps: null, nicOrtBps: null, nicMaxBps: null, bellekMb: null, bellekKaynak: null, bellekArtisiMb: null,
  bellekNedenleri: [], yukCpuBosta: null, yukBellekYuzde: null, gzUretilen: null, brUretilen: null, kipDogrulama: 'olculmedi', ...o,
});
const yanit = (satirlar: NlRaporSatir[], atlananlar: NlRapor['atlananlar'] = []): NlRapor => ({ ok: true, satirlar, atlananlar });
const kolon = (id: string) => {
  const k = RAPOR_KOLONLARI.find((x) => x.id === id);
  if (!k) throw new Error(id);
  return k;
};
const satirlariBol = (csv: string) => csv.slice(1).trimEnd().split('\r\n').map((x) => x.split(';'));

function Konum() {
  const l = useLocation();
  return <output data-testid="konum">{l.search}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Toplu rapor saf', () => {
  it('TR1 kolon sirasi: kullanicinin ornegi once', () => {
    expect(RAPOR_KOLONLARI.map((k) => k.ad).slice(0, 18)).toEqual(['Koşu no', 'Etiket', 'Hız', 'Protokol', 'Keepalive', 'Accept-Encoding', 'Brotli seviye', 'Gzip seviye', 'Gzip static seviye',
      'Gzip static', 'Brotli static seviye', 'Brotli static', 'Toplam istek', 'Medyan (p50)', 'p95', 'p99', 'CPU %', 'Bant']);
    expect(TEMEL_KOLONLAR).toEqual(RAPOR_KOLONLARI.slice(0, 18).map((k) => k.id));
    expect(RAPOR_KOLONLARI.map((k) => k.id).slice(18)).toEqual(['tarih', 'sure', 'durum', 'gecerlilik', 'tekrar', 'gercekRps', 'nedenler', 'kipDogrulama', 'ttfbP95', 'tlsP95', 'connectP95', 'sunucuP95',
      'hataOrani', 'n429', 'n5xx', 'atilan', 'cpuMsIstek', 'kapasite', 'bellekMb', 'bellekArtisiMb', 'olasiNeden', 'testGonderilenBps', 'nicOrtBps', 'nicMaxBps', 'baytIstek', 'yukCpuBosta',
      'yukBellekYuzde', 'yukDoydu', 'gzUretilen', 'brUretilen', 'diskKanit']);
    expect(new Set(RAPOR_KOLONLARI.map((k) => k.id)).size).toBe(RAPOR_KOLONLARI.length);
  });

  it('TR2 CSV: BOM, ayirici, virgul, Mbps, bos, tire, formul', () => {
    const csv = csvMetni([satir({ etiket: '=HYPERLINK("x")', diskKanit: '@cmd', nedenler: ['-bilinmeyen;neden'] }), eski({ kosuNo: 3, etiket: null, kipDogrulama: 'olculmedi' })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const b = csv.slice(1).split('\r\n')[0].split(';');
    expect(b.slice(0, 3)).toEqual(['Koşu no', 'Etiket', 'Hız']);
    expect(b).toContain('Bant (Mbps)');
    expect(b).toContain('p95 (ms)');
    expect(b.length).toBe(RAPOR_KOLONLARI.length);
    const sutun = (ad: string) => b.indexOf(ad);
    const ilk = csv.split('\r\n')[1];
    expect(ilk).toContain(`"'=HYPERLINK(""x"")"`);
    expect(ilk).toContain(`'@cmd`);
    expect(ilk).toContain(`"'-bilinmeyen;neden"`);
    // Duz satir (tirnak icinde ';' yok): sayi bicimleri.
    const [, s, e] = satirlariBol(csvMetni([satir(), eski({ kosuNo: 3 })]));
    expect(s[sutun('Bant (Mbps)')]).toBe('12,4');
    expect(s[sutun('p95 (ms)')]).toBe('20,5');
    expect(s[sutun('CPU %')]).toBe('31,3');
    expect(s[sutun('Hata oranı %')]).toBe('0,12');
    expect(s[sutun('NIC en yüksek (Mbps)')]).toBe('1230');
    expect(s[sutun('Süre (sn)')]).toBe('330');
    expect(s[sutun('Gzip static')]).toBe('kapalı');
    expect(s[sutun('Protokol')]).toBe('HTTP/2');
    expect(s[sutun('Keepalive')]).toBe('keep-alive');
    // Eski kosu: ayarsiz '-' (formul korumasi ' eklemez), olculmeyen bos.
    expect(e[sutun('Brotli seviye')]).toBe('-');
    expect(e[sutun('Brotli static')]).toBe('-');
    expect(e[sutun('Bant (Mbps)')]).toBe('');
    expect(e[sutun('Nginx bellek (MB)')]).toBe('');
    expect(e[sutun('Diskten sunulma kanıtı')]).toBe('');
    // Secili kolonlar.
    const az = satirlariBol(csvMetni([satir()], [kolon('hiz'), kolon('p95')]));
    expect(az).toEqual([['Hız', 'p95 (ms)'], ['100', '20,5']]);
  });

  it('TR3 bicim: bant, eski kosu, gecerlilik, cumleler', () => {
    const bant = kolon('bantBps').metin;
    expect(bant(satir({ bantBps: 850_000 }))).toBe('850 kbps');
    expect(bant(satir({ bantBps: 12_400_000 }))).toBe('12,4 Mbps');
    expect(bant(satir({ bantBps: 1_230_000_000 }))).toBe('1,23 Gbps');
    expect(bant(eski())).toBe('—');
    expect(kolon('brotliStatik').metin(eski())).toBe('-');
    expect(kolon('brotliSeviye').metin(satir())).toBe('4');
    expect(kolon('gzipStatik').metin(satir({ gzipStatik: true }))).toBe('açık');
    expect(kolon('tekrar').metin(satir({ tekrar: 3, gecerliTekrar: 2 }))).toBe('2/3');
    expect(kolon('bellekMb').metin(satir({ bellekKaynak: 'rss' }))).toBe('50 MB (RSS)');
    expect(gecerlilikEtiketi('KISMI')).toBe('kısmen geçerli');
    expect(gecerlilikEtiketi(null)).toBe('—');
    expect(nedenCumleleri({ nedenler: ['x_y'], uyarilar: ['x_y'], kosuNedenleri: [] })).toEqual(['x_y']);
    expect(bellekNedenCumleleri({ bellekNedenleri: ['artis_yok'], bellekSizinti: null })).toEqual(['Belirgin artış yok.']);
    expect(raporHizlari([{ hiz: 400 }, { hiz: 100 }, { hiz: 400 }])).toEqual([100, 400]);
  });

  it('TR4 sutun secimi: yazar, ayiklar, bozuk ve kapali depolamada hepsi', () => {
    const hepsi = RAPOR_KOLONLARI.map((k) => k.id);
    expect(kolonSecimiOku()).toEqual(hepsi);
    kolonSecimiYaz(['p95', 'kosuNo', 'yok_boyle']);
    expect(kolonSecimiOku()).toEqual(['kosuNo', 'p95']);
    window.localStorage.setItem(KOLON_ANAHTARI, '{bozuk');
    expect(kolonSecimiOku()).toEqual(hepsi);
    window.localStorage.setItem(KOLON_ANAHTARI, '["yok_boyle"]');
    expect(kolonSecimiOku()).toEqual(hepsi);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('kapali'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('kapali'); });
    expect(kolonSecimiOku()).toEqual(hepsi);
    expect(() => kolonSecimiYaz(['p95'])).not.toThrow();
  });

  it('TR5 URL: 100 siniri, tekil, kuyruk onceligi', () => {
    const sp = (s: string) => new URLSearchParams(s);
    expect(urlDurumuOku(sp('kuyruk=7&kosular=1,2'))).toEqual({ kuyruk: 7, kosular: [] });
    expect(urlDurumuOku(sp('kosular=3,3,x,0,5'))).toEqual({ kuyruk: null, kosular: [3, 5] });
    expect(urlDurumuOku(sp(`kosular=${Array.from({ length: 120 }, (_, i) => i + 1).join(',')}`)).kosular).toHaveLength(100);
    expect(urlDurumuOku(sp('kuyruk=2147483648')).kuyruk).toBeNull();
    expect(urlDurumuYaz(sp('tab=x&kosular=9'), { kuyruk: 4, kosular: [] }).toString()).toBe('tab=yuktesti&yt=rapor&kuyruk=4');
    expect(urlDurumuYaz(sp('kuyruk=9&olcu=p95'), { kuyruk: null, kosular: [1, 2] }).toString()).toBe('olcu=p95&tab=yuktesti&yt=rapor&kosular=1%2C2');
  });
});

describe('Toplu rapor ekran', () => {
  it('TR6 tablo, hiz suzgeci, sutun secici, atlananlar', async () => {
    api.rapor.mockResolvedValue(yanit([satir(), satir({ hiz: 250 }), satir({ kosuNo: 13, hiz: 100 }), eski({ kosuNo: 14, hiz: 400 })], [{ kosuId: 15, etiket: 'A5', neden: 'bitmemis', durum: 'RUNNING' }, { kosuId: null, etiket: 'A6', neden: 'kosu_baslamadi', durum: 'ATLANDI' }]));
    render(<TopluRapor />, { initialEntries: ['/?tab=yuktesti&yt=rapor&kuyruk=3'] });
    const tablo = await screen.findByRole('table', { name: 'Toplu rapor' });
    expect(api.rapor).toHaveBeenCalledWith({ kuyruk: 3 });
    expect(within(tablo).getAllByRole('row')).toHaveLength(5);
    const suzgec = screen.getByRole('combobox', { name: 'Hız süzgeci' });
    expect(within(suzgec).getAllByRole('option').map((o) => o.textContent)).toEqual(['Tüm hızlar', '100', '250', '400']);
    fireEvent.change(suzgec, { target: { value: '100' } });
    expect(within(tablo).getAllByRole('row')).toHaveLength(3);
    expect(within(tablo).getByRole('columnheader', { name: 'p99' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'p99' }));
    expect(within(tablo).queryByRole('columnheader', { name: 'p99' })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(KOLON_ANAHTARI) as string)).not.toContain('p99');
    fireEvent.click(screen.getByRole('button', { name: 'Temel' }));
    expect(within(tablo).getAllByRole('columnheader')).toHaveLength(18);
    expect((screen.getByRole('checkbox', { name: 'Koşu no' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('#15 A5: henüz bitmedi')).toBeTruthy();
    expect(screen.getByText('Kuyruk öğesi A6: koşu başlamadı')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Vazgeç');
  });

  it('TR6b hata metni ve bos secim', async () => {
    api.rapor.mockRejectedValue(new Error('Kuyruk bulunamadı.'));
    render(<TopluRapor />, { initialEntries: ['/?kosular=1,2'] });
    expect((await screen.findByRole('alert')).textContent).toContain('Kuyruk bulunamadı.');
    expect(api.rapor).toHaveBeenCalledWith({ kosular: [1, 2] });
  });

  it('TR7 giris: kuyruk ayrintisi ve Koşular secimi adrese yazar', async () => {
    api.rapor.mockResolvedValue(yanit([satir()]));
    const kuyruk = { id: 3, ad: null, durum: 'BITTI', beklemeDk: 5, baslangicAt: null, enGecBitis: null, onayHedefi: 'GBNGXT33', hedefTuru: 'sunucu', onaylananTurler: [], createdBy: 'onur', createdAt: null, iptalEden: null, iptalAt: null, bitisAt: null, sonHata: null, dinlenmeKosuId: null, dinlenmeBitis: null, ogeSayisi: 1, sayac: {} } as unknown as NlKuyruk;
    const oge = { id: 1, sira: 1, etiket: 'A1', durum: 'BITTI', asama: 'kosu', onKontrolKosuId: null, kosuId: 12, neden: null, butceSn: 600, uyariTurleri: [], baslamaAt: null, bitisAt: null, ayar: { senaryoId: 1, hedefIp: '1.1.1.1' } } as unknown as NlKuyrukOge;
    api.kuyruklar.mockResolvedValue({ ok: true, kuyruklar: [kuyruk] });
    api.kuyruk.mockResolvedValue({ ok: true, kuyruk, ogeler: [oge] });
    api.kosular.mockResolvedValue({ kosular: [{ id: 12, islem: 'kosu', durum: 'DONE', etiket: 'A1', hedefHost: 'H', hedefIp: '1.1.1.1', vhost: 'v', createdAt: '2026-11-03T20:00:00Z', createdBy: 'onur' } as unknown as NlKosu, { id: 9, islem: 'kosu', durum: 'DONE', etiket: 'A0', hedefHost: 'H', hedefIp: '1.1.1.1', vhost: 'v', createdAt: '2026-11-03T19:00:00Z', createdBy: 'onur' } as unknown as NlKosu], dahaVar: false });
    render(<><YukTestiTab isAdmin /><Konum /></>);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Kayıt 12 seç' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kayıt 9 seç' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toplu rapor' }));
    await screen.findByRole('table', { name: 'Toplu rapor' });
    expect(screen.getByTestId('konum').textContent).toContain('yt=rapor');
    expect(api.rapor).toHaveBeenCalledWith({ kosular: [9, 12] });
    fireEvent.click(screen.getByRole('tab', { name: 'Gece kuyruğu' }));
    expect(screen.getByTestId('konum').textContent).not.toContain('yt=');
    fireEvent.click(await screen.findByRole('button', { name: 'Kuyruk #3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Toplu rapor' }));
    await waitFor(() => expect(api.rapor).toHaveBeenCalledWith({ kuyruk: 3 }));
    expect(screen.getByTestId('konum').textContent).toContain('kuyruk=3');
    expect(screen.getByTestId('konum').textContent).not.toContain('kosular=');
  });
});
