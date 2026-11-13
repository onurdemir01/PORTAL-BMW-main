// src/components/nginx_console/__tests__/yuk-testi-tek-hedef.test.tsx — TEK HEDEF MODELI (2026-11-13).
//
// Kullanici: "hedef makine ile yuk makinemin ne oldugunun teknik olarak ne onemi var?" Hedef = dbo.Inventory'deki her
// DEV / TEST / QA makine; nginx on kontrolde OLCULUR (set_stats on_kontrol.hedef_nginx true / false / null).
// TH1 Normallestirme: hedef_nginx alani yoksa anahtar YOK (eski playbook), true / false, baska deger null; hedef_nproc;
//     /hedefler ipucu alanlari; /ip-sinifi ipler + ipuclari; kosu satiri hedefNginx; coklu meta nginx yalniz false iken.
// TH2 onKontrolDegerlendir aynasi: nginx'siz hedefte server_name / master / web_log / log_format kurallari yok, sunucu ayari
//     ENGEL, NGINX_YOK_UYARISI wrk uyarisindan once; null belirsiz ENGEL; alan yoksa cikti BIREBIR eskisi; metinler sunucuyla.
// TH3 Hedef secici aranabilir (ad / ortam / IP), secili host listede kalir, sayi metni; secenekte ortam, IP ve nginx ipucu.
// TH4 Sunucu ayari kutusu: son on kontrol nginx bulamadiysa kapali + not (govdede sunucuAyar yok); envanterde nginx yoksa
//     acik + not; nginx hedefte not yok. Siniflandirma kutusu nginx'siz hedefte genel CPU der.
// TH5 Bu formun on kontrolu nginx bulamadi: panelde "Nginx" satiri, NGINX_YOK_UYARISI, kutu kapanir.
// TH6 OnKontrolPaneli satirlari: false -> nginx satirlari yok; null -> "belirlenemedi" kaldi; alan yok -> eskisi.
// TH7 BaslatOnayi "Nginx" satiri yalniz nginx'siz on kontrolde.
// TH8 KosuAyrinti: nginx'siz kosuda cip, ust bilgi kutusu, CPU-ms / kapasite "—" (ipucu), host CPU dolu; eski satir eskisi.
// TH8c KosuAyrinti: kosunun kendi tespiti (hedefNginx boolean) on kontrolunkinden oncelikli; on kontrol "yok" + kosu
//      "var" iken olculmus CPU-ms / kapasite gorunur (mutasyon: eski `||` ifadesi TH2 + TH8c'yi kirmizi yapar).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import {
  adimNormalle, cokluNormalle, hedeflerNormalle, kosuNormalle, kosuSatiriNormalle, onKontrolNormalle, type NlKosuAyrinti, type NlParametreler, type NlSinirlar, type NlVarsayilanlar,
} from '@/api/nginxLoadtestApi';
import {
  HOST_LISTEDE_YOK_UYARISI, NGINX_BELIRSIZ_ENGELI, NGINX_YOK_AYAR_ENGELI, NGINX_YOK_CPU_IPUCU, NGINX_YOK_UYARISI, SRV_AYAR_ENVANTER_NOTU, SRV_AYAR_NGINX_YOK_NOTU,
  WRK_UYARISI, hedefNginxsiz, nginxIpucu, onKontrolDegerlendir,
} from '../yukTesti/yukTestiOrtak';

const api = vi.hoisted(() => ({
  hedefler: vi.fn(), senaryolar: vi.fn(), senaryo: vi.fn(), senaryoKaydet: vi.fn(), senaryoSil: vi.fn(), onKontrol: vi.fn(),
  baslat: vi.fn(), kosular: vi.fn(), kosu: vi.fn(), durum: vi.fn(), durdur: vi.fn(), yenidenOku: vi.fn(), karsilastir: vi.fn(), ipSinifi: vi.fn(),
  araclar: vi.fn(), araclariHazirla: vi.fn(), aracGeriCek: vi.fn(),
}));
vi.mock('@/api/nginxLoadtestApi', async (orijinal) => ({ ...(await orijinal<typeof import('@/api/nginxLoadtestApi')>()), nginxLoadtestApi: api }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));

import { YukTestiTab } from '../YukTestiTab';
import KosuAyrinti from '../yukTesti/KosuAyrinti';
import OnKontrolPaneli from '../yukTesti/OnKontrolPaneli';
import BaslatOnayi, { NGINX_YOK_SATIRI } from '../yukTesti/BaslatOnayi';
import { TurMotorCipleri } from '../yukTesti/YukUi';

const sunucuDogrula = createRequire(import.meta.url)('../../../../server/nginx-loadtest/dogrula.cjs') as {
  NGINX_YOK_UYARISI: string; NGINX_YOK_AYAR_ENGELI: string; NGINX_BELIRSIZ_ENGELI: string;
  onKontrolDegerlendir: (ok: unknown, s?: unknown) => { engeller: string[]; uyarilar: string[] };
};

const SINIR: NlSinirlar = {
  maxHiz: 5000, maxTekrar: 3, sureMin: 40, sureMax: 300, isinmaMax: 60, maxVu: 1000, maxButceSn: 2700,
  baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50, maxTavanRps: 5000,
};
const VARSAYILAN: NlVarsayilanlar = {
  motor: 'k6', hizlar: [100, 250, 400], maxvu: 150, baglantilar: [2, 4, 8], is_parcacigi: 2, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60,
  kip: 'yeni', ae: 'br', serbest: { hizlar: [50, 100, 200], maxvu: 50 }, protokol: 'h1',
};
const VHOST = 'glomo-test.garantibbva.com.tr';
// Gercek durum: GBJWLT01 (Inventory Test, nginx yok - son on kontrol), GBJALT02 (envanterde nginx yok, olculmedi), GBNGXT33 (nginx).
const HEDEFLER = {
  ok: true,
  hedefler: [
    { host: 'GBJALT02', env: 'TEST', ipler: ['10.151.166.150'], vhostlar: [], vhostVerisi: false, uygun: true, neden: null, nginxEnvanter: false, urunler: ['RHA'], nginxSon: null, nginxSonAt: null },
    { host: 'GBJWLT01', env: 'TEST', ipler: ['10.151.166.144', '10.151.166.145', '10.151.166.146', '10.151.166.147'], vhostlar: [], vhostVerisi: false, uygun: true, neden: null, nginxEnvanter: false, urunler: [], nginxSon: false, nginxSonAt: '2026-11-13T09:00:00Z' },
    { host: 'GBNGXT33', env: 'QA/TEST', ipler: ['192.168.133.27'], vhostlar: [VHOST], vhostVerisi: true, uygun: true, neden: null, nginxEnvanter: true, urunler: ['NGINX'], nginxSon: true, nginxSonAt: '2026-11-12T09:00:00Z' },
    { host: 'GBNGXP40', env: 'PROD', ipler: [], vhostlar: [], vhostVerisi: false, uygun: false, neden: 'üretim', kod: 'hedef_uretim', nginxEnvanter: true, urunler: ['NGINX'], nginxSon: null, nginxSonAt: null },
  ],
  hedefSayisi: 3,
  yukHostlari: [{ host: 'GBNGXT14', env: 'TEST', uygun: true, neden: null }],
  sinirlar: SINIR, varsayilan: VARSAYILAN, serbest: { acik: true, aglar: [] }, motorlar: ['k6', 'wrk'], protokoller: ['h1', 'h2'],
  araclar: { hazir: true, aracId: 5, k6Surum: 'v0.49.0', wrkSurum: '4.2.0', kod: null, mesaj: null },
};
const SENARYO = { id: 3, ad: 'GLOMO', aciklama: null, vhost: VHOST, senaryoTur: 'K', yolSayisi: 264, sha256: 'b'.repeat(64), kaynak: 'har', createdBy: 'onur', createdAt: '2026-10-26T10:00:00Z' };
const sinifOf = (ip: string, host: string, o: Record<string, unknown> = {}) => {
  const h = HEDEFLER.hedefler.find((x) => x.host === host)!;
  return {
    ok: true, tur: 'sunucu', ip, host, env: h.env, ipler: h.ipler, vhostlar: h.vhostlar, vhostVerisi: h.vhostVerisi, hizSiniri: null, vuSiniri: null, limitReq: null, limitConn: null,
    uygun: true, neden: null, kod: null, kaynaklar: ['dbo.Inventory'], nginxEnvanter: h.nginxEnvanter, urunler: h.urunler, nginxSon: h.nginxSon, ...o,
  };
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  window.localStorage.clear();
  api.kosular.mockResolvedValue({ ok: true, kosular: [], dahaVar: false });
  api.senaryolar.mockResolvedValue({ ok: true, senaryolar: [SENARYO] });
  api.hedefler.mockResolvedValue(HEDEFLER);
  api.durum.mockResolvedValue({ ok: true, status: 'running', finished: false, output: '', result: null, kosuDurum: 'RUNNING' });
  api.onKontrol.mockResolvedValue({ ok: false, code: 'kilit_dolu', message: 'Başka bir yük testi sürüyor.', _httpStatus: 409 });
  api.ipSinifi.mockImplementation(async (ip: string, o: { hedefHost?: string | null }) => sinifOf(ip, o?.hedefHost || 'GBNGXT33'));
});

async function formAc() {
  render(<YukTestiTab isAdmin />);
  fireEvent.click(await screen.findByRole('tab', { name: /Yeni koşu/ }));
  fireEvent.change(await screen.findByLabelText('Senaryo'), { target: { value: '3' } });
}
const secici = () => screen.getByLabelText('Hedef sunucu (isteğe bağlı)') as HTMLSelectElement;
const secenekler = () => [...secici().querySelectorAll('option')].map((o) => o.textContent ?? '');
const kutu = () => screen.getByLabelText(/Sunucuyu koşu öncesi ayarla/) as HTMLInputElement;
const okDugmesi = () => screen.getByRole('button', { name: /Ön kontrolü (başlat|yeniden çalıştır)/ });

describe('TEK HEDEF — normallestirme (TH1)', () => {
  it('TH1 on kontrol hedef_nginx üç durum + yok; /hedefler ve /ip-sinifi ipuçları; koşu satırı; çoklu meta', () => {
    expect('hedefNginx' in (onKontrolNormalle({ k6_var: true }) ?? {})).toBe(false);
    expect(onKontrolNormalle({ k6_var: true, hedef_nginx: false })?.hedefNginx).toBe(false);
    expect(onKontrolNormalle({ k6_var: true, hedef_nginx: true, hedef_nproc: '8' })).toMatchObject({ hedefNginx: true, hedefNproc: 8 });
    expect(onKontrolNormalle({ k6_var: true, hedef_nginx: 'False' })?.hedefNginx).toBe(false);
    for (const v of [null, '-', 1, 0, 'evet']) expect(onKontrolNormalle({ k6_var: true, hedef_nginx: v })?.hedefNginx).toBeNull();
    const h = hedeflerNormalle({ ...HEDEFLER, hedefler: [...HEDEFLER.hedefler, { host: 'GBESKI01', env: 'TEST', ipler: ['1.2.3.4'], vhostlar: [], uygun: true, neden: null }, { env: 'TEST' }] });
    expect(h.hedefSayisi).toBe(3);
    expect(h.hedefler.map((x) => x.host)).toEqual(['GBJALT02', 'GBJWLT01', 'GBNGXT33', 'GBNGXP40', 'GBESKI01']);
    expect(h.hedefler[1]).toMatchObject({ nginxSon: false, nginxEnvanter: false, nginxSonAt: '2026-11-13T09:00:00Z', urunler: [] });
    expect(h.hedefler[4]).toMatchObject({ nginxSon: null, nginxEnvanter: null, nginxSonAt: null, urunler: [] });
    expect(kosuSatiriNormalle({ id: 1, hedef_nginx: false }).hedefNginx).toBe(false);
    expect(kosuSatiriNormalle({ id: 1 }).hedefNginx).toBeNull();
    expect(kosuNormalle({ id: 2, hedefNginx: true }).hedefNginx).toBe(true);
    const c = cokluNormalle({ ref: { id: 1, hizlar: [] }, adaylar: [{ id: 2, nginx: false, hizlar: [] }, { id: 3, nginx: true, hizlar: [] }], karsilastirilamaz: [] });
    expect([c.ref.nginx, c.adaylar[0].nginx, 'nginx' in c.adaylar[1]]).toEqual([undefined, false, false]);
    expect([nginxIpucu(HEDEFLER.hedefler[0]), nginxIpucu(HEDEFLER.hedefler[1]), nginxIpucu(HEDEFLER.hedefler[2]), nginxIpucu({ nginxEnvanter: true }), nginxIpucu(null)])
      .toEqual(['nginx yok (envanter)', 'nginx yok', 'nginx', 'nginx (envanter)', 'nginx ?']);
  });
});

const PARAM: NlParametreler = { motor: 'k6', hizlar: [100], maxvu: 150, tekrar: 1, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni', ae: 'br', protokol: 'h1' };
const OK_HAM = { ip_yerel: true, server_name_var: false, master_sayisi: 0, web_log_df: 80, log_dizini_okunur: false, log_format_ua: false, k6_var: true, yollar_toplam: 5, yollar_200: 5 };
const deger = (ham: Record<string, unknown>, o: Partial<NlKosuAyrinti> = {}) => onKontrolDegerlendir({
  durum: 'DONE', onKontrol: onKontrolNormalle(ham), hedefTuru: 'sunucu', motor: 'k6', parametreler: PARAM, ...o,
});

describe('TEK HEDEF — ön kontrol değerlendirmesi (TH2)', () => {
  it('TH2 nginx’siz / belirsiz / alan yok; metinler sunucuyla aynı', () => {
    expect(NGINX_YOK_UYARISI).toBe(sunucuDogrula.NGINX_YOK_UYARISI);
    const buyuk = (x: string) => x.charAt(0).toLocaleUpperCase('tr-TR') + x.slice(1);
    expect(NGINX_YOK_AYAR_ENGELI).toBe(buyuk(sunucuDogrula.NGINX_YOK_AYAR_ENGELI));
    expect(NGINX_BELIRSIZ_ENGELI).toBe(buyuk(sunucuDogrula.NGINX_BELIRSIZ_ENGELI));

    const yok = deger({ ...OK_HAM, hedef_nginx: false });
    expect(yok.engeller).toEqual([]);
    expect(yok.uyarilar).toEqual([NGINX_YOK_UYARISI]);
    const wrk = onKontrolDegerlendir({ durum: 'DONE', onKontrol: onKontrolNormalle({ ...OK_HAM, k6_var: null, wrk_var: true, hedef_nginx: false }), hedefTuru: 'sunucu', motor: 'wrk', parametreler: { ...PARAM, motor: 'wrk' } });
    expect(wrk.uyarilar.slice(-2)).toEqual([NGINX_YOK_UYARISI, WRK_UYARISI]);
    // Sunucu ayari nginx'siz hedefte ENGEL (sunucu NGINX_YOK_AYAR_ENGELI).
    expect(deger({ ...OK_HAM, hedef_nginx: false }, { parametreler: { ...PARAM, sunucuAyar: { seviye: 6, static: false, dizin: '/usr/nginx/applications/x' } } }).engeller).toEqual([NGINX_YOK_AYAR_ENGELI]);
    // Sunucu da ayni kurali verir (kucuk harfli metin).
    const s = sunucuDogrula.onKontrolDegerlendir({ ...OK_HAM, hedef_nginx: false }, { hedefTuru: 'sunucu', motor: 'k6', parametreler: PARAM });
    expect(s).toEqual({ engeller: [], uyarilar: [sunucuDogrula.NGINX_YOK_UYARISI] });

    const belirsiz = deger({ ...OK_HAM, master_sayisi: 1, web_log_df: 10, log_dizini_okunur: true, log_format_ua: true, server_name_var: true, hedef_nginx: null });
    expect(belirsiz.engeller).toEqual([NGINX_BELIRSIZ_ENGELI]);
    // Alan yok (eski playbook): nginx kurallari BIREBIR eskisi.
    const eski = deger(OK_HAM);
    expect(eski.uyarilar[0]).toBe(HOST_LISTEDE_YOK_UYARISI);
    expect(eski.engeller).toEqual(expect.arrayContaining([expect.stringMatching(/nginx master/), expect.stringMatching(/Log dizini \/web_log okunamıyor/)]));
    expect(eski.uyarilar).not.toContain(NGINX_YOK_UYARISI);
    // nginx true: eski kurallarla ayni engeller (alan yokken ile birebir).
    expect(deger({ ...OK_HAM, hedef_nginx: true })).toEqual(eski);
    // Serbestte alan yok sayilir.
    expect(hedefNginxsiz({ hedefTuru: 'serbest', hedefNginx: false })).toBe(false);
    expect(hedefNginxsiz({ hedefTuru: 'sunucu', hedefNginx: null, onKontrol: { hedefNginx: false } })).toBe(true);
    expect(hedefNginxsiz({ hedefTuru: 'sunucu', hedefNginx: null })).toBe(false);
    // Kosunun kendi tespiti oncelikli: on kontrol "yok", kosu basinda nginx bulundu -> nginx'li (ve tersi).
    expect(hedefNginxsiz({ hedefTuru: 'sunucu', hedefNginx: true, onKontrol: { hedefNginx: false } })).toBe(false);
    expect(hedefNginxsiz({ hedefTuru: 'sunucu', hedefNginx: false, onKontrol: { hedefNginx: true } })).toBe(true);
  });
});

describe('TEK HEDEF — hedef seçici (TH3, TH4)', () => {
  it('TH3 arama ad / ortam / IP ile süzer, seçili host kalır; seçenek metni ortam + IP + nginx ipucu', async () => {
    await formAc();
    expect(secenekler()).toEqual([
      '— IP’yi elle yazacağım —',
      'GBJALT02 · TEST · 10.151.166.150 · nginx yok (envanter)',
      'GBJWLT01 · TEST · 10.151.166.144, 10.151.166.145, 10.151.166.146 +1 · nginx yok',
      'GBNGXT33 · QA/TEST · 192.168.133.27 · nginx',
      'GBNGXP40 · PROD · nginx (envanter) — üretim',
    ]);
    expect(screen.getByText('4 / 4 sunucu')).toBeInTheDocument();
    const ara = screen.getByRole('searchbox', { name: 'Hedef sunucu ara' });
    fireEvent.change(ara, { target: { value: '10.151.166.144' } });
    expect(secenekler()).toEqual(['— IP’yi elle yazacağım —', 'GBJWLT01 · TEST · 10.151.166.144, 10.151.166.145, 10.151.166.146 +1 · nginx yok']);
    expect(screen.getByText('1 / 4 sunucu')).toBeInTheDocument();
    fireEvent.change(secici(), { target: { value: 'GBJWLT01' } });
    fireEvent.change(ara, { target: { value: 'qa' } });
    // Secili host aramaya uymasa da listede kalir (secim gorunmez olmaz).
    expect(secenekler().map((x) => x.split(' · ')[0])).toEqual(['— IP’yi elle yazacağım —', 'GBJWLT01', 'GBNGXT33']);
    fireEvent.change(ara, { target: { value: 'gbja' } });
    expect(secenekler().map((x) => x.split(' · ')[0])).toEqual(['— IP’yi elle yazacağım —', 'GBJALT02', 'GBJWLT01']);
    expect(secici().value).toBe('GBJWLT01');
  });

  it('TH4 son ön kontrol nginx bulamadıysa sunucu ayarı kapalı + not, gövdede yok; envanter notu; nginx hedefte not yok', async () => {
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 16, jobId: 1 });
    api.kosu.mockResolvedValue({ ok: true, kosu: kosuNormalle({ id: 16, islem: 'on_kontrol', durum: 'RUNNING', hedefTuru: 'sunucu', hedefHost: 'GBJWLT01' }), adimlar: [] });
    await formAc();
    fireEvent.change(secici(), { target: { value: 'GBNGXT33' } });
    await waitFor(() => expect(kutu()).toBeEnabled());
    fireEvent.click(kutu());
    expect(kutu()).toBeChecked();
    expect(screen.queryByText(SRV_AYAR_NGINX_YOK_NOTU)).toBeNull();
    expect(screen.queryByText(SRV_AYAR_ENVANTER_NOTU)).toBeNull();
    expect(await screen.findByText(/^Sunucu hedefi: GBNGXT33 \(QA\/TEST\) — CPU kaydedici ve nginx logu ölçülür/, {}, { timeout: 3000 })).toBeTruthy();

    fireEvent.change(secici(), { target: { value: 'GBJALT02' } });
    expect(kutu()).toBeEnabled();
    expect(screen.getByText(SRV_AYAR_ENVANTER_NOTU)).toBeInTheDocument();
    expect(await screen.findByText(/^Sunucu hedefi: GBJALT02 \(TEST\) — envanterde nginx görünmüyor: ön kontrol tespit eder/, {}, { timeout: 3000 })).toBeTruthy();

    fireEvent.change(secici(), { target: { value: 'GBJWLT01' } });
    // Dort aday IP: IP elle secilir (aday dugmesi ya da yazarak).
    fireEvent.change(screen.getByLabelText('Hedef IP'), { target: { value: '10.151.166.144' } });
    expect(kutu()).toBeDisabled();
    expect(kutu()).not.toBeChecked();
    expect(screen.getByText(SRV_AYAR_NGINX_YOK_NOTU)).toBeInTheDocument();
    expect(screen.queryByLabelText('Uygulama dizini')).toBeNull();
    expect(await screen.findByText(/^Sunucu hedefi: GBJWLT01 \(TEST\) — son ön kontrol nginx bulamadı: genel CPU ve istemci metrikleri ölçülür/, {}, { timeout: 3000 })).toBeTruthy();
    // Tum yuk parametreleri acik: motor, hiz, sure, gelismis alanlar.
    for (const l of ['Hızlar (istek/sn)', 'Ölçüm süresi (sn)', 'Tekrar', 'Isınma (sn)', 'Adımlar arası bekleme (sn)', 'En çok VU', 'Protokol', 'Bağlantı', 'Sıkıştırma (Accept-Encoding)']) {
      expect(screen.getByLabelText(l)).toBeEnabled();
    }
    // wrk ile baglanti alani da acik (HTTP/1.1).
    fireEvent.click(screen.getByLabelText(/^wrk —/));
    expect(screen.getByLabelText('Bağlantılar')).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/^k6 —/));
    await waitFor(() => expect(okDugmesi()).toBeEnabled(), { timeout: 3000 });
    fireEvent.click(okDugmesi());
    await waitFor(() => expect(api.onKontrol).toHaveBeenCalledTimes(1));
    const g = api.onKontrol.mock.calls[0][0];
    expect([g.hedefHost, g.hedefIp, 'sunucuAyar' in g.parametreler]).toEqual(['GBJWLT01', '10.151.166.144', false]);
  });

  it('TH5 bu formun ön kontrolü nginx bulamadı: Nginx satırı, uyarı, sunucu ayarı kutusu kapanır', async () => {
    const okHam = { ...OK_HAM, hedef_nginx: false, hedef_nproc: 4 };
    api.onKontrol.mockResolvedValue({ ok: true, kosuId: 16, jobId: 1 });
    api.kosu.mockResolvedValue({
      ok: true, adimlar: [],
      kosu: kosuNormalle({
        id: 16, islem: 'on_kontrol', durum: 'DONE', hedefTuru: 'sunucu', hedefHost: 'GBJALT02', hedefIp: '10.151.166.150', vhost: VHOST, yukHost: 'GBNGXT14', motor: 'k6',
        parametreler: PARAM, on_kontrol_ozet: okHam, finishedAt: new Date().toISOString(), onKontrolYasSn: 5,
      }),
    });
    await formAc();
    fireEvent.change(secici(), { target: { value: 'GBJALT02' } });
    await waitFor(() => expect(okDugmesi()).toBeEnabled(), { timeout: 3000 });
    expect(kutu()).toBeEnabled();
    fireEvent.click(okDugmesi());
    const panel = await screen.findByRole('list', { name: 'Ön kontrol maddeleri' });
    expect(within(panel).getByText('Nginx')).toBeInTheDocument();
    expect(within(panel).getByTitle('bulunamadı — genel CPU ölçülür · uyarı')).toBeInTheDocument();
    expect(within(panel).queryByText('Tek nginx master')).toBeNull();
    expect(screen.getByText(NGINX_YOK_UYARISI)).toBeInTheDocument();
    expect(screen.getByText(/hedef 4 çekirdek/)).toBeInTheDocument();
    await waitFor(() => expect(kutu()).toBeDisabled());
    expect(screen.getByText(SRV_AYAR_NGINX_YOK_NOTU)).toBeInTheDocument();
  });
});

const okKosu = (onKontrol: Record<string, unknown> | null): NlKosuAyrinti => kosuNormalle({
  id: 16, islem: 'on_kontrol', durum: 'DONE', hedefTuru: 'sunucu', hedefHost: 'GBJWLT01', hedefIp: '10.151.166.144', vhost: VHOST, yukHost: 'GBNGXT14', motor: 'k6',
  parametreler: PARAM, on_kontrol_ozet: onKontrol, senaryoAd: 'GLOMO',
});

describe('TEK HEDEF — panel, onay, ayrıntı (TH6-TH8)', () => {
  it('TH6 OnKontrolPaneli: false / null / true / alan yok', () => {
    const satirlar = () => within(screen.getByRole('list', { name: 'Ön kontrol maddeleri' })).getAllByRole('listitem').map((l) => l.firstElementChild?.nextElementSibling?.textContent);
    const r1 = render(<OnKontrolPaneli kosu={okKosu({ ...OK_HAM, hedef_nginx: false })} />);
    expect(satirlar()).toEqual(['IP hedefte yerel', 'Nginx', 'Yük sunucusunda k6', 'Senaryo yolları 200']);
    r1.unmount();
    const r2 = render(<OnKontrolPaneli kosu={okKosu({ ...OK_HAM, hedef_nginx: null })} />);
    expect(satirlar().slice(0, 3)).toEqual(['IP hedefte yerel', 'Nginx', 'server_name nginx -T’de']);
    expect(screen.getByTitle('belirlenemedi · kaldı')).toBeInTheDocument();
    expect(screen.getByText(NGINX_BELIRSIZ_ENGELI)).toBeInTheDocument();
    r2.unmount();
    const r3 = render(<OnKontrolPaneli kosu={okKosu({ ...OK_HAM, hedef_nginx: true })} />);
    expect(satirlar().slice(0, 3)).toEqual(['IP hedefte yerel', 'Nginx', 'server_name nginx -T’de']);
    r3.unmount();
    render(<OnKontrolPaneli kosu={okKosu(OK_HAM)} />);
    expect(satirlar()).toEqual(['IP hedefte yerel', 'server_name nginx -T’de', 'Tek nginx master', '/web_log doluluğu < %65', 'Log dizini okunur', 'log_format “user-agent=” yazıyor', 'Yük sunucusunda k6', 'Senaryo yolları 200']);
  });

  it('TH7 BaslatOnayi Nginx satırı yalnız nginx’siz ön kontrolde', () => {
    const p = { senaryo: null, uyarilar: [], sunucuUyarilari: null, busy: false, hata: null, onOnay: vi.fn(), onKapat: vi.fn() };
    const r = render(<BaslatOnayi onKontrol={okKosu({ ...OK_HAM, hedef_nginx: false })} {...p} />);
    expect(screen.getByText(NGINX_YOK_SATIRI)).toBeInTheDocument();
    expect(screen.getByText(NGINX_YOK_SATIRI).previousElementSibling?.textContent).toBe('Nginx');
    r.unmount();
    render(<BaslatOnayi onKontrol={okKosu({ ...OK_HAM, hedef_nginx: true })} {...p} />);
    expect(screen.queryByText(NGINX_YOK_SATIRI)).toBeNull();
  });

  it('TH8 KosuAyrinti nginx’siz koşu: çip, bilgi kutusu, CPU-ms / kapasite “—”, host CPU dolu; eski satırda yok', async () => {
    const adim = adimNormalle({ tur: 'R18_K_yeni_br_100_r1', senaryo: 'K', kip: 'yeni', ae: 'br', hiz: 100, gecerlilik: 'GECERLI', p95: 12.5, hata_orani: 0, gercek_rps: 100, host_cpu_ort: 45.2, cpu_ms_istek: null, kapasite_rps: null });
    const kosu = (o: Record<string, unknown>) => kosuNormalle({
      id: 18, islem: 'kosu', durum: 'DONE', gecerlilik: 'GECERLI', hedefTuru: 'sunucu', hedefHost: 'GBJWLT01', hedefIp: '10.151.166.144', vhost: VHOST, yukHost: 'GBNGXT14',
      motor: 'k6', parametreler: PARAM, createdAt: '2026-11-13T10:00:00Z', startedAt: '2026-11-13T10:00:00Z', finishedAt: '2026-11-13T10:10:00Z', ...o,
    });
    api.kosu.mockResolvedValue({ ok: true, kosu: kosu({ hedefNginx: false }), adimlar: [adim] });
    const r = render(<KosuAyrinti kosuId={18} isAdmin={false} onGeri={vi.fn()} />);
    expect(await screen.findByText(NGINX_YOK_UYARISI)).toBeInTheDocument();
    expect(screen.getByTitle(NGINX_YOK_UYARISI).textContent).toBe('nginx yok');
    fireEvent.click(screen.getByRole('button', { name: /^Ayrıntı/ }));
    const tablo = screen.getByRole('table', { name: 'Adım sonuçları' });
    expect(within(tablo).getAllByTitle(NGINX_YOK_CPU_IPUCU).filter((x) => x.tagName === 'TD').map((x) => x.textContent)).toEqual(['—', '—']);
    expect(within(tablo).getByText('%45')).toBeInTheDocument();
    expect(screen.getAllByText(NGINX_YOK_CPU_IPUCU).length).toBeGreaterThanOrEqual(2);
    r.unmount();
    // Eski satir (hedefNginx null): cip ve kutu yok.
    api.kosu.mockResolvedValue({ ok: true, kosu: kosu({}), adimlar: [adim] });
    render(<KosuAyrinti kosuId={18} isAdmin={false} onGeri={vi.fn()} />);
    expect(await screen.findByText(/Koşu #18|Yük testi #18|#18/)).toBeTruthy();
    expect(screen.queryByText(NGINX_YOK_UYARISI)).toBeNull();
    expect(screen.queryByTitle(NGINX_YOK_UYARISI)).toBeNull();
  });

  it('TH8c KosuAyrinti: ön kontrol nginx bulamadı ama koşu başında bulundu → koşunun tespiti geçerli, ölçülmüş CPU-ms / kapasite görünür', async () => {
    const adim = adimNormalle({ tur: 'R19_K_yeni_br_100_r1', senaryo: 'K', kip: 'yeni', ae: 'br', hiz: 100, gecerlilik: 'GECERLI', p95: 12.5, hata_orani: 0, gercek_rps: 100, host_cpu_ort: 45.2, cpu_ms_istek: 3.92, kapasite_rps: 1234 });
    const kosu = kosuNormalle({
      id: 19, islem: 'kosu', durum: 'DONE', gecerlilik: 'KISMI', hedefTuru: 'sunucu', hedefHost: 'GBJWLT01', hedefIp: '10.151.166.144', vhost: VHOST, yukHost: 'GBNGXT14',
      motor: 'k6', parametreler: PARAM, createdAt: '2026-11-13T10:00:00Z', startedAt: '2026-11-13T10:00:00Z', finishedAt: '2026-11-13T10:10:00Z',
      hedefNginx: true, on_kontrol_ozet: { ...OK_HAM, hedef_nginx: false },
    });
    expect([kosu.hedefNginx, kosu.onKontrol?.hedefNginx]).toEqual([true, false]);
    api.kosu.mockResolvedValue({ ok: true, kosu, adimlar: [adim] });
    render(<KosuAyrinti kosuId={19} isAdmin={false} onGeri={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Ayrıntı/ }));
    const tablo = screen.getByRole('table', { name: 'Adım sonuçları' });
    expect(within(tablo).queryAllByTitle(NGINX_YOK_CPU_IPUCU)).toEqual([]);
    expect(within(tablo).getByText('~1.234')).toBeInTheDocument();
    expect(screen.queryByText(NGINX_YOK_UYARISI)).toBeNull();
    expect(screen.queryByTitle(NGINX_YOK_UYARISI)).toBeNull();
  });

  it('TH8b TurMotorCipleri: nginx yok çipi yalnız sunucu hedefinde', () => {
    const r = render(<TurMotorCipleri hedefTuru="sunucu" motor="k6" protokol="h1" nginxsiz />);
    expect(screen.getByTitle(NGINX_YOK_UYARISI).textContent).toBe('nginx yok');
    r.unmount();
    const { container } = render(<TurMotorCipleri hedefTuru="sunucu" motor="k6" protokol="h1" />);
    expect(container.textContent).toBe('');
    render(<TurMotorCipleri hedefTuru="serbest" motor="k6" protokol="h1" nginxsiz />);
    expect(screen.queryByTitle(NGINX_YOK_UYARISI)).toBeNull();
  });
});
