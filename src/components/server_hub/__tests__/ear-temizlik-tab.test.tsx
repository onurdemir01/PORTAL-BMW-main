// src/components/server_hub/__tests__/ear-temizlik-tab.test.tsx — Server Hub › EAR Temizliği (2026-11-16).
//
// Kullanıcı: "EAR içinde WAR yok uyarılarını temizlemek için bir sayfa; ön kontrolde dizine ls -ltr ile bakılmalı ve
// silinmeden önce benim tarafımdan teyit edilmeli."
//   ET1 aday listesi: sunucu, yol, JBoss, PROD rozeti; engel olan satırda "Ön kontrol" pasif ve engel yazılı
//   ET2 "Ön kontrol" isteği gövdesi yalnız {host,kok,ad}; dönen PLANLANIYOR kaydı satıra yazılır
//   ET3 PLAN_HAZIR: pencerede ls -ltr çıktısı ve info satırları; kutu + ad yazılmadan "Yedekle ve sil" pasif
//   ET4 sil isteği gövdesi {confirmed:true, onayMetni (=ad), planJobId (=kaydın planJobId'si)}
//   ET5 hata gösterimi: liste okunamadı, ön kontrol reddi (409), silme reddi pencerede
//   ET6 süre dolunca düğme pasif; HATA/SILINDI satırları sonuç / yedek / envanter notu
//   ET7 gizli sekmede istek yok; sekme kaydı (liste, görünürlük anahtarı, SekmeKabi), "Vazgeç" yok
//   ET9 yoklama: süren kayıt görünürken okunur ve geçiş ekrana yansır; gizliyken hiç istek yok
//   ET10 pencere açıkken yoklama IPTAL getirirse "Yedekle ve sil" kapanır ("Plan artık teyit beklemiyor")
//   ET11 yoklama hatası yutulmaz: eşikte satırda uyarı, başarıda kalkar; 404'te (JSON ya da HTML) yoklama durur
//   ET12 PLAN_HAZIR satırında engel çıkarsa teyit düğmesi ve penceredeki silme kapalı; süre bilinmiyorsa kapalı
// TOPLU (kullanıcı: "toplu halde temizlik için gerekli düzenlemeyi yap"; şart: her EAR'ın ls -ltr çıktısı görülür):
//   ETT1 seçim kutuları; engelli / aktif kayıtlı / silinmiş satır seçilemez; "hepsini seç" yalnız süzülmüş seçilebilirler
//   ETT2 toplu ön kontrol gövdesi {adaylar:[{host,kok,ad}]}; özet "N başladı, M başarısız" + nedenler; başlayanlar okunur
//   ETT3 toplu teyit: her kaydın ls satırları, uzun ls ilk 8 satır + "Tamamını göster"; "<n> EAR SIL" olmadan pasif;
//        hariç tutunca n değişir; süresi dolan otomatik hariç ve pasif; gövde {confirmed, onayMetni, kayitlar:[{id,planJobId}]}
//   ETT4 409 reddedilenler pencerede listelenir, pencere açık kalır
//   ETT5 sırada rozeti; "Sıradan çıkar" tekli iptal; toplu "Sıradakileri iptal et" onay penceresiyle çağrılır
//   ETT6 tekli silme sırada dönerse satır "Silme sırada" ve bilgi bildirimi
//   ETT7 "Vazgeç" metni toplu pencerede de yok; özet PROD sayısı ve toplam boyut
// İNCELEME DÜZELTMELERİ:
//   ETT3 kısaltma baştaki 2 satır + EN YENİ 6 satır (ls -ltr'de son deploy izi sondadır); ETT5b "Sıradan çıkar" onaylı
//   ETT8 boş ls -ltr çıktısı: toplu hariç, tekli silme kapalı (kullanıcı şartı)
//   ETT9 taze taramada aday olmayan / engelli kayıt toplu teyitte otomatik hariç
//   ETT10/10b toplu silme sonucu kayıtların topluId'sinden okunur; CAS kaybeden / kaybedenler adıyla raporlanır
//   ETT11 üst sınır 50; ETT12 seçim süzülmüş satırlar, seçilemez olan seçimden düşer
//   ETT13 toplu grup yalnız sırada kaydı olan işlem; BELIRSIZ toplu seçilemez, tekli ön kontrol açık
//   ETT14/ETT15 pencere açıkken kayıt sıraya girerse toplu hariç / tekli silme kapalı
//   ETT16 sıradaki kayıt sık yoklanır; ETT17 çok kayıtta tek liste okuması, hata yutulmaz
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { zamanlayiciKuruluncaIlerlet } from '@/test/zamanlayici';

const toastM = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));

import EarTemizlikTab, {
  bilgiSatirlari,
  kbMetin,
  sureMetni,
  yoklamaHatalariniIsle,
  PLAN_YOKLAMA_MS,
  TEK_TEK_YOKLAMA_SINIRI,
  YOKLAMA_HATA_ESIGI,
  YOKLAMA_MS,
} from '@/components/server_hub/EarTemizlikTab';
import { SekmeKabi } from '@/components/server_hub/sekmeGorunurlugu';
import type { EtAday, EtDurum, EtKayit } from '@/api/serverHubApi';

const yanit = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const kayit = (durum: EtDurum, ek: Partial<EtKayit> = {}): EtKayit => ({
  id: 11,
  host: 'hosta01',
  kok: '/vhosting',
  ad: 'ORSTPCOMPLIANCE.ear',
  jboss: 7,
  prod: false,
  durum,
  olusturan: 'ayse',
  onaylayan: null,
  createdAt: '2026-11-16T10:00:00Z',
  updatedAt: '2026-11-16T10:01:00Z',
  planBitisAt: durum === 'PLAN_HAZIR' ? '2026-11-16T10:01:00Z' : null,
  kalanSn: durum === 'PLAN_HAZIR' ? 1500 : null,
  planJobId: 501,
  silJobId: null,
  plan:
    durum === 'PLAN_HAZIR'
      ? {
          fp: 'abcdef0123456789'.repeat(4),
          ls: [
            'drwxr-x--- 3 was was 4096 Nov 10 09:00 /vhosting/ORSTPCOMPLIANCE.ear',
            'total 8',
            '-rw-r----- 1 was was 812 Nov 10 09:00 META-INF',
          ],
          info: [
            { anahtar: 'bicim', deger: 'ACIK' },
            { anahtar: 'war', deger: '0' },
            { anahtar: 'domain_xml', deger: 'referans yok' },
            { anahtar: 'surec', deger: 'yok' },
            { anahtar: 'boyut_kb', deger: '2048' },
            { anahtar: 'sahip', deger: 'was:was' },
            { anahtar: 'yedek_dizin', deger: '/var/tmp/server_hub_backup' },
            { anahtar: 'yedek_bos_kb', deger: '1048576' },
          ],
        }
      : null,
  sonuc: null,
  yedek: null,
  envanter: { kosuId: null, not: null },
  sirada: false,
  topluId: null,
  ...ek,
});

const aday = (ek: Partial<EtAday> = {}): EtAday => ({
  host: 'hosta01',
  ortam: 'Test',
  prod: false,
  kok: '/vhosting',
  ad: 'ORSTPCOMPLIANCE.ear',
  jboss: 7,
  envanterTarihi: '2026-11-15T03:00:00Z',
  engel: null,
  kayit: null,
  ...ek,
});

type Cagri = { url: string; method: string; body: unknown };
let cagrilar: Cagri[] = [];
let yonlendir: (url: string, method: string, body: unknown) => Response;

beforeEach(() => {
  cagrilar = [];
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      cagrilar.push({ url, method, body });
      return yonlendir(url, method, body);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const liste = (adaylar: EtAday[], kayitlar: EtKayit[] = []) => ({
  ok: true,
  planGecerlilikDk: 30,
  adaylar,
  kayitlar,
});
// Aday tablosunda seçim kutuları da var: tekli penceredeki onay kutusu adıyla bulunur.
const INCELEDIM = { name: /Bu çıktıyı inceledim/ };

describe('EarTemizlikTab', () => {
  it('ET1b kullanımı ölçülmemiş JVM’siz EAR: engel değil ama satırda uyarı (inceleme B12)', async () => {
    yonlendir = () =>
      yanit(
        liste([
          aday({ kullanimUyarisi: 'dizin kullanımı ölçülemedi (surec siniri)' }),
          aday({ host: 'hostb02' }),
        ]),
      );
    render(<EarTemizlikTab />);
    const satirlar = await screen.findAllByTestId('et-aday');
    expect(within(satirlar[0]).getByTestId('et-kullanim-uyarisi')).toHaveTextContent(
      'uyarı: dizin kullanımı ölçülemedi (surec siniri)',
    );
    expect(within(satirlar[0]).getByRole('button', { name: /Ön kontrol/ })).toBeEnabled();
    expect(within(satirlar[1]).queryByTestId('et-kullanim-uyarisi')).toBeNull();
  });
  it('ET1 liste: yol, JBoss, PROD rozeti; engel olan satırda düğme pasif', async () => {
    yonlendir = () =>
      yanit(
        liste([
          aday({ host: 'hostp01', ortam: 'Production', prod: true }),
          aday({
            host: 'hostb02',
            ad: 'BAGLI.ear',
            engel: 'domain.xml’de deployment tanımlı — JBoss’a bağlı',
          }),
        ]),
      );
    render(<EarTemizlikTab />);
    const satirlar = await screen.findAllByTestId('et-aday');
    expect(satirlar).toHaveLength(2);
    expect(within(satirlar[0]).getByText('/vhosting/ORSTPCOMPLIANCE.ear')).toBeInTheDocument();
    expect(within(satirlar[0]).getByTestId('et-prod')).toHaveTextContent('PROD');
    expect(within(satirlar[0]).getByRole('button', { name: /Ön kontrol/ })).toBeEnabled();
    expect(within(satirlar[1]).queryByTestId('et-prod')).toBeNull();
    const pasif = within(satirlar[1]).getByRole('button', { name: /Ön kontrol/ });
    expect(pasif).toBeDisabled();
    expect(pasif).toHaveAttribute('title', expect.stringMatching(/domain\.xml/));
    expect(within(satirlar[1]).getByText(/JBoss’a bağlı/)).toBeInTheDocument();
    expect(cagrilar[0]).toMatchObject({ url: '/api/server-hub/ear-temizlik', method: 'GET' });
  });

  it('ET2 ön kontrol isteği gövdesi yalnız {host,kok,ad}; kayıt satıra yazılır', async () => {
    yonlendir = (url, method) =>
      method === 'POST' && url.endsWith('/ear-temizlik/on-kontrol')
        ? yanit({
            ok: true,
            kayit: kayit('PLANLANIYOR', { kok: '/vhosting8', jboss: 8, ad: 'X.ear', plan: null }),
          })
        : yanit(liste([aday({ host: 'hosta01', kok: '/vhosting8', jboss: 8, ad: 'X.ear' })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Ön kontrol hosta01/ }));
    await waitFor(() => expect(cagrilar.some((c) => c.method === 'POST')).toBe(true));
    const post = cagrilar.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/server-hub/ear-temizlik/on-kontrol');
    expect(post.body).toEqual({ host: 'hosta01', kok: '/vhosting8', ad: 'X.ear' });
    const satir = (await screen.findAllByTestId('et-aday'))[0];
    await waitFor(() =>
      expect(within(satir).getByText('Ön kontrol sürüyor (salt okunur)')).toBeInTheDocument(),
    );
    expect(within(satir).getByRole('button', { name: /Ön kontrol/ })).toBeDisabled();
    expect(screen.getByTestId('et-kayitlar')).toHaveTextContent('/vhosting8/X.ear');
  });

  it('ET3 PLAN_HAZIR: pencerede ls -ltr çıktısı ve bilgi satırları; kutu + ad olmadan düğme pasif', async () => {
    yonlendir = () => yanit(liste([aday({ kayit: kayit('PLAN_HAZIR') })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    const ls = await screen.findByTestId('et-ls');
    expect(ls.tagName).toBe('PRE');
    expect(ls).toHaveTextContent(
      'drwxr-x--- 3 was was 4096 Nov 10 09:00 /vhosting/ORSTPCOMPLIANCE.ear',
    );
    expect(ls).toHaveTextContent('META-INF');
    const bilgi = screen.getByTestId('et-bilgi');
    expect(bilgi).toHaveTextContent('0 (WAR yok)');
    expect(bilgi).toHaveTextContent('referans yok');
    expect(bilgi).toHaveTextContent('2 MB');
    expect(bilgi).toHaveTextContent('/var/tmp/server_hub_backup (boş alan 1 GB)');
    expect(bilgi).toHaveTextContent('abcdef012345…');
    expect(screen.getByTestId('et-kalan')).toHaveTextContent(/Kalan süre: 2\d:\d\d/);
    const sil = screen.getByRole('button', { name: 'Yedekle ve sil' });
    expect(sil).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', INCELEDIM));
    expect(sil).toBeDisabled();
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'orstpcompliance.ear' },
    });
    expect(sil).toBeDisabled();
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    expect(sil).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', INCELEDIM));
    expect(sil).toBeDisabled();
    expect(screen.getByRole('button', { name: 'İptal' })).toBeInTheDocument();
    expect(cagrilar.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('ET4 sil isteği gövdesi: confirmed, onayMetni = ad, planJobId = kaydın işi', async () => {
    yonlendir = (url, method) =>
      method === 'POST' && url.endsWith('/ear-temizlik/11/sil')
        ? yanit({ ok: true, kayit: kayit('SILINIYOR', { plan: null, silJobId: 777 }) })
        : yanit(liste([aday({ kayit: kayit('PLAN_HAZIR', { planJobId: 4242 }) })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    fireEvent.click(await screen.findByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yedekle ve sil' }));
    await waitFor(() => expect(cagrilar.some((c) => c.method === 'POST')).toBe(true));
    const post = cagrilar.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/server-hub/ear-temizlik/11/sil');
    expect(post.body).toEqual({
      confirmed: true,
      onayMetni: 'ORSTPCOMPLIANCE.ear',
      planJobId: 4242,
    });
    await waitFor(() => expect(screen.queryByTestId('et-teyit')).toBeNull());
    expect(screen.getByRole('button', { name: /Siliniyor/ })).toBeDisabled();
  });

  it('ET5 hatalar: liste okunamadı; ön kontrol reddi; silme reddi pencerede kalır', async () => {
    yonlendir = () => yanit({ ok: false, message: 'Yetkiniz yok' }, 403);
    const { unmount } = render(<EarTemizlikTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Yetkiniz yok');
    unmount();

    yonlendir = (url, method) =>
      method === 'POST'
        ? yanit({ ok: false, message: 'Bu EAR için süren bir kayıt var' }, 409)
        : yanit(liste([aday()]));
    const r2 = render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Ön kontrol hosta01/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bu EAR için süren bir kayıt var');
    expect(toastM.error).toHaveBeenCalled();
    r2.unmount();

    yonlendir = (url, method) =>
      method === 'POST'
        ? yanit({ ok: false, message: 'Bulgu artık taze taramada yok' }, 409)
        : yanit(liste([aday({ kayit: kayit('PLAN_HAZIR') })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    fireEvent.click(await screen.findByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yedekle ve sil' }));
    const teyit = await screen.findByTestId('et-teyit');
    expect(await within(teyit).findByRole('alert')).toHaveTextContent(
      'Bulgu artık taze taramada yok',
    );
  });

  it('ET6 süre dolunca pasif; HATA sonucu kırmızı; SILINDI yedek ve envanter notu', async () => {
    yonlendir = () =>
      yanit(
        liste([
          aday({ kayit: kayit('PLAN_HAZIR', { kalanSn: 0 }) }),
          aday({
            host: 'hostb02',
            kayit: kayit('HATA', {
              id: 12,
              host: 'hostb02',
              sonuc: 'parmak izi değişti; hiçbir şey silinmedi',
              plan: null,
            }),
          }),
          aday({
            host: 'hostc03',
            kayit: kayit('SILINDI', {
              id: 13,
              host: 'hostc03',
              yedek: '/var/tmp/server_hub_backup/ear-ORSTPCOMPLIANCE.ear-20261116.tgz',
              envanter: {
                kosuId: null,
                not: 'Başka Uygulama Envanteri koşusu sürüyor; uyarı bir sonraki taramada kalkar',
              },
              plan: null,
            }),
          }),
        ]),
      );
    render(<EarTemizlikTab />);
    const satirlar = await screen.findAllByTestId('et-aday');
    expect(within(satirlar[0]).getByText('süre doldu')).toBeInTheDocument();
    fireEvent.click(within(satirlar[0]).getByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    expect(await screen.findByTestId('et-kalan')).toHaveTextContent('Plan süresi doldu');
    fireEvent.click(screen.getByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    expect(screen.getByRole('button', { name: 'Yedekle ve sil' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByTestId('et-teyit')).toBeNull());
    expect(within(satirlar[1]).getByText(/parmak izi değişti/)).toBeInTheDocument();
    expect(
      within(satirlar[2]).getByText(/ear-ORSTPCOMPLIANCE\.ear-20261116\.tgz/),
    ).toBeInTheDocument();
    expect(
      within(satirlar[2]).getByText(/Başka Uygulama Envanteri koşusu sürüyor/),
    ).toBeInTheDocument();
    expect(within(satirlar[2]).getByRole('button', { name: /Ön kontrol/ })).toBeDisabled();
  });

  it('ET7 gizli sekmede istek yok; sekme kaydı; "Vazgeç" yok', async () => {
    yonlendir = () => yanit(liste([]));
    const { rerender } = render(
      <SekmeKabi id="eartemizlik" etkin="hosts">
        <EarTemizlikTab />
      </SekmeKabi>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(cagrilar).toHaveLength(0);
    rerender(
      <SekmeKabi id="eartemizlik" etkin="eartemizlik">
        <EarTemizlikTab />
      </SekmeKabi>,
    );
    expect(await screen.findByText(/uyarısı yok/)).toBeInTheDocument();
    expect(cagrilar).toHaveLength(1);

    const kok = path.resolve(__dirname, '..', '..', '..', '..');
    const sh = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'ServerHubPage.tsx'),
      'utf8',
    );
    expect(sh).toMatch(/\{ id: 'eartemizlik', label: 'EAR Temizliği' \}/);
    expect(sh).toMatch(/canSee\('tab:serverhub:eartemizlik'\)/);
    expect(sh).toMatch(/\(t\.id !== 'eartemizlik' \|\| earTemizlikGorur\)/);
    expect(sh).toMatch(
      /earTemizlikGorur && acilan\.has\('eartemizlik'\) && \(\s*<SekmeKabi id="eartemizlik" etkin=\{tab\}>\s*<EarTemizlikTab \/>/,
    );
    const tab = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'EarTemizlikTab.tsx'),
      'utf8',
    );
    expect(tab).not.toMatch(/Vazge/);
  });

  it('ET8 yardımcılar: kbMetin, sureMetni, bilgiSatirlari', () => {
    expect(kbMetin(812)).toBe('812 KB');
    expect(kbMetin('3584')).toBe('3,5 MB');
    expect(kbMetin(null)).toBe('—');
    expect(sureMetni(125)).toBe('02:05');
    expect(sureMetni(-3)).toBe('00:00');
    const s = bilgiSatirlari({ fp: '', ls: [], info: [{ anahtar: 'yeni_alan', deger: 'x' }] });
    expect(s).toEqual([
      { etiket: 'yeni_alan', deger: 'x' },
      { etiket: 'Parmak izi', deger: '—' },
    ]);
    const k = kayit('PLANLANIYOR');
    let m = yoklamaHatalariniIsle(new Map(), [{ id: 11, hata: 'x', kalici: false }]);
    m = yoklamaHatalariniIsle(m, [{ id: 11, hata: 'y', kalici: false }]);
    expect(m.get(11)).toEqual({ sayi: 2, mesaj: 'y', kalici: false });
    expect(yoklamaHatalariniIsle(m, [{ id: 11, kayit: k }]).has(11)).toBe(false);
  });
});

describe('EarTemizlikTab yoklama', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  const ilerlet = zamanlayiciKuruluncaIlerlet;
  const kayitCagrisi = (id = 11) =>
    cagrilar.filter((c) => c.method === 'GET' && c.url === `/api/server-hub/ear-temizlik/${id}`)
      .length;

  it('ET9 süren kayıt görünürken yoklanır ve geçiş yansır; gizliyken istek yok', async () => {
    let tek: EtKayit = kayit('PLANLANIYOR', { plan: null });
    yonlendir = (url) =>
      url.endsWith('/ear-temizlik/11')
        ? yanit({ ok: true, kayit: tek })
        : yanit(liste([aday({ kayit: kayit('PLANLANIYOR', { plan: null }) })]));
    const sekme = (etkin: string) => (
      <SekmeKabi id="eartemizlik" etkin={etkin}>
        <EarTemizlikTab />
      </SekmeKabi>
    );
    const { rerender } = render(sekme('eartemizlik'));
    const satir = (await screen.findAllByTestId('et-aday'))[0];
    expect(within(satir).getByText('Ön kontrol sürüyor (salt okunur)')).toBeInTheDocument();

    rerender(sekme('hosts'));
    await ilerlet(YOKLAMA_MS * 5);
    expect(kayitCagrisi()).toBe(0);

    rerender(sekme('eartemizlik'));
    await ilerlet(YOKLAMA_MS);
    await waitFor(() => expect(kayitCagrisi()).toBe(1));
    expect(within(satir).getByText('Ön kontrol sürüyor (salt okunur)')).toBeInTheDocument();

    tek = kayit('PLAN_HAZIR');
    await ilerlet(YOKLAMA_MS);
    await waitFor(() =>
      expect(within(satir).getByText('Çıktı hazır — teyit bekliyor')).toBeInTheDocument(),
    );
    expect(kayitCagrisi()).toBe(2);
  });

  it('ET10 pencere açıkken yoklama IPTAL getirirse silme kapanır', async () => {
    let tek: EtKayit = kayit('PLAN_HAZIR');
    yonlendir = (url) =>
      url.endsWith('/ear-temizlik/11')
        ? yanit({ ok: true, kayit: tek })
        : yanit(liste([aday({ kayit: kayit('PLAN_HAZIR') })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    fireEvent.click(await screen.findByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    const sil = screen.getByRole('button', { name: 'Yedekle ve sil' });
    expect(sil).toBeEnabled();
    tek = kayit('IPTAL', { plan: kayit('PLAN_HAZIR').plan, kalanSn: 1200 });
    await ilerlet(PLAN_YOKLAMA_MS);
    await waitFor(() => expect(sil).toBeDisabled());
    expect(sil).toHaveAttribute('title', 'Plan artık teyit beklemiyor');
    expect(cagrilar.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('ET11 yoklama hatası: eşikte uyarı, başarıda kalkar; 404 yoklamayı durdurur', async () => {
    let tekYanit = () => yanit({ ok: false, message: 'Oturum düştü' }, 403);
    yonlendir = (url) =>
      url.endsWith('/ear-temizlik/11')
        ? tekYanit()
        : yanit(liste([aday({ kayit: kayit('SILINIYOR', { plan: null }) })]));
    const r1 = render(<EarTemizlikTab />);
    const satir = (await screen.findAllByTestId('et-aday'))[0];
    for (let i = 1; i < YOKLAMA_HATA_ESIGI; i++) {
      await ilerlet(YOKLAMA_MS);
      await waitFor(() => expect(kayitCagrisi()).toBe(i));
    }
    expect(within(satir).queryByTestId('et-yoklama-hata')).toBeNull();
    await ilerlet(YOKLAMA_MS);
    const uyari = await within(satir).findByTestId('et-yoklama-hata');
    expect(uyari).toHaveAttribute('role', 'alert');
    expect(uyari).toHaveTextContent(
      `Durum okunamıyor (${YOKLAMA_HATA_ESIGI} deneme): Oturum düştü`,
    );
    tekYanit = () => yanit({ ok: true, kayit: kayit('SILINIYOR', { plan: null }) });
    await ilerlet(YOKLAMA_MS);
    await waitFor(() => expect(within(satir).queryByTestId('et-yoklama-hata')).toBeNull());
    r1.unmount();

    // 404 iki biçimde: düz JSON gövde ve nginx'in HTML sayfası (safeJson fırlatır, status 404).
    for (const yoksa of [
      () => yanit({ ok: false, message: 'Kayıt #11 yok.' }, 404),
      () =>
        new Response('<!doctype html><html><body>404</body></html>', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }),
    ]) {
      cagrilar = [];
      tekYanit = yoksa;
      const r = render(<EarTemizlikTab />);
      const s = (await screen.findAllByTestId('et-aday'))[0];
      await ilerlet(YOKLAMA_MS);
      expect(await within(s).findByTestId('et-yoklama-hata')).toHaveTextContent('yoklama durdu');
      await ilerlet(YOKLAMA_MS * 5);
      expect(kayitCagrisi()).toBe(1);
      r.unmount();
    }
  });
});

describe('EarTemizlikTab teyit kapıları', () => {
  it('ET12 PLAN_HAZIR + engel: teyit düğmesi ve penceredeki silme kapalı; süre bilinmiyorsa kapalı', async () => {
    const engel = 'domain.xml’de deployment tanımlı — JBoss’a bağlı';
    let engelli = false;
    yonlendir = () =>
      yanit(liste([aday({ engel: engelli ? engel : null, kayit: kayit('PLAN_HAZIR') })]));
    const r1 = render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    fireEvent.click(await screen.findByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    const sil = screen.getByRole('button', { name: 'Yedekle ve sil' });
    expect(sil).toBeEnabled();
    engelli = true;
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(sil).toBeDisabled());
    expect(sil).toHaveAttribute('title', engel);
    expect(screen.getByTestId('et-engel')).toHaveTextContent('JBoss’a bağlı');
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    const teyit = await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ });
    expect(teyit).toBeDisabled();
    expect(teyit).toHaveAttribute('title', engel);
    expect(screen.getByRole('button', { name: 'Planı iptal et' })).toBeEnabled();
    r1.unmount();

    yonlendir = () => yanit(liste([aday({ kayit: kayit('PLAN_HAZIR', { kalanSn: null }) })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    fireEvent.click(await screen.findByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    expect(screen.getByTestId('et-kalan')).toHaveTextContent('bilinmiyor');
    const sil2 = screen.getByRole('button', { name: 'Yedekle ve sil' });
    expect(sil2).toBeDisabled();
    expect(sil2).toHaveAttribute('title', expect.stringMatching(/bilinmiyor/));
  });
});

describe('EarTemizlikTab toplu', () => {
  const lsSatirlari = (n: number) =>
    Array.from({ length: n }, (_, i) => `-rw-r----- 1 was was 10 Nov 10 09:00 dosya-${i + 1}`);
  const hazir = (id: number, host: string, ek: Partial<EtKayit> = {}): EtKayit =>
    kayit('PLAN_HAZIR', { id, host, planJobId: 600 + id, ...ek });

  it('ETT1 seçim: engelli / aktif / silinmiş satır seçilemez; hepsini seç yalnız süzülmüş seçilebilirler', async () => {
    yonlendir = () =>
      yanit(
        liste([
          aday({ host: 'hostp01', prod: true, ortam: 'Production' }),
          aday({ host: 'hostb02', engel: 'domain.xml’de deployment tanımlı' }),
          aday({ host: 'hostc03', kayit: kayit('PLANLANIYOR', { id: 3, host: 'hostc03' }) }),
          aday({ host: 'hostd04' }),
          aday({ host: 'hoste05', kayit: kayit('SILINDI', { id: 5, host: 'hoste05' }) }),
        ]),
      );
    render(<EarTemizlikTab />);
    await screen.findAllByTestId('et-aday');
    const kutu = (h: string) =>
      screen.getByRole('checkbox', { name: `Seç ${h} /vhosting/ORSTPCOMPLIANCE.ear` });
    expect(kutu('hostp01')).toBeEnabled();
    expect(kutu('hostd04')).toBeEnabled();
    expect(kutu('hostb02')).toBeDisabled();
    expect(kutu('hostb02')).toHaveAttribute('title', expect.stringMatching(/domain\.xml/));
    expect(kutu('hostc03')).toBeDisabled();
    expect(kutu('hoste05')).toBeDisabled();
    const dugme = () => screen.getByRole('button', { name: /Seçilenlere ön kontrol/ });
    expect(dugme()).toHaveTextContent('(0)');
    expect(dugme()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Sunucu ya da EAR adı süz'), {
      target: { value: 'HOSTD' },
    });
    expect(screen.getAllByTestId('et-aday')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: /hepsini seç/ }));
    expect(kutu('hostd04')).toBeChecked();
    expect(dugme()).toHaveTextContent('(1)');
    expect(dugme()).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Sunucu ya da EAR adı süz'), { target: { value: '' } });
    expect(screen.getAllByTestId('et-aday')).toHaveLength(5);
    expect(kutu('hostp01')).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /hepsini seç/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /hepsini seç/ }));
    expect(kutu('hostp01')).toBeChecked();
    expect(kutu('hostb02')).not.toBeChecked();
    expect(kutu('hostc03')).not.toBeChecked();
    expect(kutu('hoste05')).not.toBeChecked();
    expect(dugme()).toHaveTextContent('(2)');
    fireEvent.click(screen.getByRole('checkbox', { name: /hepsini seç/ }));
    expect(dugme()).toHaveTextContent('(0)');
    expect(cagrilar.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('ETT2 toplu ön kontrol gövdesi ve sonuç özeti; başlayan kayıtlar okunur', async () => {
    yonlendir = (url, method) => {
      if (method === 'POST' && url.endsWith('/ear-temizlik/toplu/on-kontrol'))
        return yanit({
          ok: true,
          sonuclar: [
            { host: 'hostp01', kok: '/vhosting', ad: 'ORSTPCOMPLIANCE.ear', ok: true, id: 21 },
            {
              host: 'hostd04',
              kok: '/vhosting8',
              ad: 'Y.ear',
              ok: false,
              message: 'Bu EAR için süren bir kayıt var',
            },
          ],
          basarili: 1,
          basarisiz: 1,
        });
      if (url.endsWith('/ear-temizlik/21'))
        return yanit({
          ok: true,
          kayit: kayit('PLANLANIYOR', { id: 21, host: 'hostp01', plan: null }),
        });
      return yanit(
        liste([
          aday({ host: 'hostp01' }),
          aday({ host: 'hostd04', kok: '/vhosting8', ad: 'Y.ear', jboss: 8 }),
        ]),
      );
    };
    render(<EarTemizlikTab />);
    await screen.findAllByTestId('et-aday');
    fireEvent.click(screen.getByRole('checkbox', { name: /hepsini seç/ }));
    fireEvent.click(screen.getByRole('button', { name: /Seçilenlere ön kontrol \(2\)/ }));
    const ozet = await screen.findByTestId('et-toplu-sonuc');
    const post = cagrilar.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/server-hub/ear-temizlik/toplu/on-kontrol');
    expect(post.body).toEqual({
      adaylar: [
        { host: 'hostp01', kok: '/vhosting', ad: 'ORSTPCOMPLIANCE.ear' },
        { host: 'hostd04', kok: '/vhosting8', ad: 'Y.ear' },
      ],
    });
    expect(ozet).toHaveTextContent('1 başladı, 1 başarısız');
    expect(ozet).toHaveTextContent('hostd04 /vhosting8/Y.ear: Bu EAR için süren bir kayıt var');
    await waitFor(() =>
      expect(
        cagrilar.some((c) => c.method === 'GET' && c.url === '/api/server-hub/ear-temizlik/21'),
      ).toBe(true),
    );
    const satir = screen.getAllByTestId('et-aday')[0];
    await waitFor(() =>
      expect(within(satir).getByText('Ön kontrol sürüyor (salt okunur)')).toBeInTheDocument(),
    );
    // Başarısız olan seçili kalır (yeniden denenebilir).
    expect(screen.getByRole('checkbox', { name: 'Seç hostd04 /vhosting8/Y.ear' })).toBeChecked();
  });

  const topluListe = () =>
    liste([
      aday({
        host: 'hostp01',
        prod: true,
        kayit: hazir(31, 'hostp01', {
          prod: true,
          plan: {
            fp: 'f'.repeat(64),
            ls: lsSatirlari(12),
            info: [
              { anahtar: 'war', deger: '0' },
              { anahtar: 'boyut_kb', deger: '1024' },
              { anahtar: 'dosya_sayisi', deger: '12' },
              { anahtar: 'domain_xml', deger: 'referans yok' },
              { anahtar: 'surec', deger: 'yok' },
            ],
          },
        }),
      }),
      aday({ host: 'hostq02', kayit: hazir(32, 'hostq02') }),
      aday({ host: 'hostr03', kayit: hazir(33, 'hostr03', { kalanSn: 0 }) }),
    ]);

  it('ETT3 toplu teyit: her kaydın ls çıktısı; onay metni; hariç tutma; süresi dolan; gövde', async () => {
    const topluId = '0f0e0d0c-1111-2222-3333-444455556666';
    yonlendir = (url, method) =>
      method === 'POST' && url.endsWith('/ear-temizlik/toplu/sil')
        ? yanit({ ok: true, topluId, sirada: 0, baslatilan: 1 })
        : url.endsWith('/ear-temizlik/31')
          ? yanit({
              ok: true,
              kayit: kayit('SILINIYOR', { id: 31, host: 'hostp01', topluId, plan: null }),
            })
          : yanit(topluListe());
    render(<EarTemizlikTab />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Hazır olanları toplu teyit et \(3\)/ }),
    );
    const pencere = await screen.findByTestId('et-toplu-teyit');
    const ogeler = within(pencere).getAllByTestId('et-toplu-oge');
    expect(ogeler).toHaveLength(3);
    const ls = within(pencere).getAllByTestId('et-toplu-ls');
    expect(ls).toHaveLength(3);
    // ls -ltr eskiden yeniye: kısaltmada baştaki 2 satır + EN YENİ 6 satır görünür, aradakiler gizli.
    expect(ls[0]).toHaveTextContent(/dosya-1(?!\d)/);
    expect(ls[0]).toHaveTextContent(/dosya-2(?!\d)/);
    expect(ls[0]).not.toHaveTextContent(/dosya-3(?!\d)/);
    expect(ls[0]).not.toHaveTextContent(/dosya-6(?!\d)/);
    expect(ls[0]).toHaveTextContent('… 4 satır gizli');
    expect(ls[0]).toHaveTextContent(/dosya-7(?!\d)/);
    expect(ls[0]).toHaveTextContent('dosya-12');
    expect(ls[1]).toHaveTextContent(
      'drwxr-x--- 3 was was 4096 Nov 10 09:00 /vhosting/ORSTPCOMPLIANCE.ear',
    );
    expect(ls[2]).toHaveTextContent('META-INF');
    fireEvent.click(within(ogeler[0]).getByRole('button', { name: 'Tamamını göster (12 satır)' }));
    expect(within(pencere).getAllByTestId('et-toplu-ls')[0]).toHaveTextContent(/dosya-4(?!\d)/);
    expect(within(pencere).getAllByTestId('et-toplu-ls')[0]).not.toHaveTextContent('gizli');
    expect(ogeler[0]).toHaveTextContent('1 MB');
    expect(ogeler[0]).toHaveTextContent('0 (WAR yok)');
    expect(within(ogeler[0]).getByTestId('et-prod')).toBeInTheDocument();
    const dolan = within(ogeler[2]).getByRole('checkbox');
    expect(dolan).toBeDisabled();
    expect(dolan).not.toBeChecked();
    expect(within(ogeler[2]).getByTestId('et-toplu-haric')).toHaveTextContent('süresi doldu');
    const ozet = within(pencere).getByTestId('et-toplu-ozet');
    expect(ozet).toHaveTextContent('Dahil: 2 / 3 EAR');
    expect(ozet).toHaveTextContent('PROD: 1');

    const sil = () => screen.getByRole('button', { name: /^Sil \(/ });
    expect(sil()).toHaveTextContent('Sil (2)');
    expect(sil()).toBeDisabled();
    const giris = within(pencere).getByLabelText('Toplu onay metni');
    fireEvent.change(giris, { target: { value: '2 ear sil' } });
    expect(sil()).toBeDisabled();
    fireEvent.change(giris, { target: { value: '3 EAR SIL' } });
    expect(sil()).toBeDisabled();
    fireEvent.change(giris, { target: { value: '2 EAR SIL' } });
    expect(sil()).toBeEnabled();
    fireEvent.click(within(ogeler[1]).getByRole('checkbox'));
    expect(sil()).toHaveTextContent('Sil (1)');
    expect(sil()).toBeDisabled();
    expect(ozet).toHaveTextContent('Dahil: 1 / 3 EAR');
    fireEvent.change(giris, { target: { value: '1 EAR SIL' } });
    expect(sil()).toBeEnabled();
    expect(cagrilar.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.click(sil());
    await waitFor(() => expect(cagrilar.some((c) => c.method === 'POST')).toBe(true));
    const post = cagrilar.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/server-hub/ear-temizlik/toplu/sil');
    expect(post.body).toEqual({
      confirmed: true,
      onayMetni: '1 EAR SIL',
      kayitlar: [{ id: 31, planJobId: 631 }],
    });
    await waitFor(() => expect(screen.queryByTestId('et-toplu-teyit')).toBeNull());
    expect(toastM.success).toHaveBeenCalledWith(expect.stringMatching(/1 başladı, 0 sırada/));
  });

  it('ETT4 409: reddedilenler pencerede görünür, pencere açık kalır', async () => {
    yonlendir = (url, method) =>
      method === 'POST'
        ? yanit(
            {
              ok: false,
              message: 'Toplu silme doğrulamasından geçmeyen kayıt var; hiçbir kayıt değişmedi.',
              reddedilenler: [{ id: 32, message: 'Bulgu artık taze taramada yok' }],
            },
            409,
          )
        : yanit(topluListe());
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Hazır olanları toplu teyit et/ }));
    const pencere = await screen.findByTestId('et-toplu-teyit');
    fireEvent.change(within(pencere).getByLabelText('Toplu onay metni'), {
      target: { value: '2 EAR SIL' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sil (2)' }));
    const red = await within(pencere).findByTestId('et-toplu-red');
    expect(red).toHaveTextContent(
      'hostq02 /vhosting/ORSTPCOMPLIANCE.ear: Bulgu artık taze taramada yok',
    );
    expect(within(pencere).getByRole('alert')).toHaveTextContent('hiçbir kayıt değişmedi');
    expect(screen.getByTestId('et-toplu-teyit')).toBeInTheDocument();
  });

  it('ETT5 sırada rozeti; toplu "Sıradakileri iptal et" onay penceresiyle çağrılır', async () => {
    const topluId = 'abcd1234-0000-1111-2222-333344445555';
    yonlendir = (url, method) => {
      if (method === 'POST' && url.endsWith(`/toplu/${topluId}/iptal`))
        return yanit({ ok: true, iptal: 1, suren: 1 });
      if (method === 'GET' && /\/ear-temizlik\/\d+$/.test(url))
        return yanit({ ok: true, kayit: kayit('IPTAL', { id: 41, host: 'hosts01', topluId }) });
      return yanit(
        liste(
          [aday({ host: 'hosts01', kayit: hazir(41, 'hosts01', { sirada: true, topluId }) })],
          [kayit('SILINIYOR', { id: 42, host: 'hosts01', ad: 'B.ear', topluId, plan: null })],
        ),
      );
    };
    render(<EarTemizlikTab />);
    const satir = (await screen.findAllByTestId('et-aday'))[0];
    expect(
      within(satir).getByText(/Sırada — aynı sunucudaki silme bitince başlar/),
    ).toBeInTheDocument();
    expect(within(satir).queryByRole('button', { name: /Çıktıyı gör ve teyit et/ })).toBeNull();
    expect(within(satir).getByRole('checkbox')).toBeDisabled();
    expect(within(screen.getByTestId('et-kayitlar')).getByTestId('et-sirada')).toHaveTextContent(
      'sırada',
    );
    expect(screen.queryByRole('button', { name: /Hazır olanları toplu teyit et/ })).toBeNull();
    const grup = screen.getByTestId('et-toplu-grup');
    expect(grup).toHaveTextContent('abcd1234');
    expect(grup).toHaveTextContent('1 silme sırada, 1 siliniyor');
    fireEvent.click(within(grup).getByRole('button', { name: 'Sıradakileri iptal et' }));
    const onay = await screen.findByTestId('et-toplu-iptal');
    expect(onay).toHaveTextContent('dokunulmaz');
    expect(cagrilar.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sıradakileri iptal et (1)' }));
    await waitFor(() => expect(screen.queryByTestId('et-toplu-iptal')).toBeNull());
    const post = cagrilar.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`/api/server-hub/ear-temizlik/toplu/${topluId}/iptal`);
    expect(post.body).toEqual({});
    expect(toastM.info).toHaveBeenCalledWith(
      expect.stringMatching(/1 sıradaki silme iptal edildi; 1 silme sürüyor/),
    );
  });

  it('ETT5b tekli "Sıradan çıkar" kaydın iptal ucunu çağırır', async () => {
    yonlendir = (url, method) =>
      method === 'POST'
        ? yanit({ ok: true, kayit: kayit('IPTAL', { id: 41, host: 'hosts01' }) })
        : yanit(liste([aday({ host: 'hosts01', kayit: hazir(41, 'hosts01', { sirada: true }) })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Sıradan çıkar hosts01/ }));
    // Onaysız iptal yok: önce onay penceresi, "Kapat" hiçbir şey göndermez.
    expect(await screen.findByTestId('et-siradan-cikar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Kapat', { selector: 'button' }));
    expect(screen.queryByTestId('et-siradan-cikar')).toBeNull();
    expect(cagrilar.filter((c) => c.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Sıradan çıkar hosts01/ }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sıradan çıkar' }),
    );
    await waitFor(() => expect(cagrilar.some((c) => c.method === 'POST')).toBe(true));
    expect(cagrilar.find((c) => c.method === 'POST')!.url).toBe(
      '/api/server-hub/ear-temizlik/41/iptal',
    );
    const satir = screen.getAllByTestId('et-aday')[0];
    await waitFor(() => expect(within(satir).getByText('İptal edildi')).toBeInTheDocument());
  });

  it('ETT6 tekli silme sırada dönerse satır "Silme sırada" ve bilgi bildirimi', async () => {
    yonlendir = (url, method) =>
      method === 'POST' && url.endsWith('/ear-temizlik/11/sil')
        ? yanit({ ok: true, sirada: true, kayit: kayit('PLAN_HAZIR', { sirada: true }) })
        : yanit(liste([aday({ kayit: kayit('PLAN_HAZIR') })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    fireEvent.click(await screen.findByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yedekle ve sil' }));
    await waitFor(() => expect(screen.queryByTestId('et-teyit')).toBeNull());
    const satir = screen.getAllByTestId('et-aday')[0];
    expect(within(satir).getByText(/Silme sırada/)).toBeInTheDocument();
    expect(toastM.info).toHaveBeenCalledWith(expect.stringMatching(/sırada/));
    expect(toastM.success).not.toHaveBeenCalled();
  });

  it('ETT7 "Vazgeç" toplu dosyada yok; özet toplam boyut', async () => {
    const kok = path.resolve(__dirname, '..', '..', '..', '..');
    const src = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'EarTemizlikToplu.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/Vazge/);
    yonlendir = () => yanit(topluListe());
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Hazır olanları toplu teyit et/ }));
    const pencere = await screen.findByTestId('et-toplu-teyit');
    expect(pencere).not.toHaveTextContent(/Vazge/);
    expect(screen.getByRole('button', { name: 'İptal' })).toBeInTheDocument();
    // hostp01 1024 KB + hostq02 2048 KB = 3 MB (süresi dolan hostr03 sayılmaz).
    expect(within(pencere).getByTestId('et-toplu-ozet')).toHaveTextContent('Toplam boyut: 3 MB');
  });

  it('ETT8 ls -ltr çıktısı boş plan: toplu teyitte otomatik hariç, tekli pencerede silme kapalı', async () => {
    const bosLs = (id: number, host: string) =>
      hazir(id, host, { plan: { fp: 'e'.repeat(64), ls: [], info: [] } });
    yonlendir = () =>
      yanit(
        liste([
          aday({ host: 'hostp01', kayit: hazir(31, 'hostp01') }),
          aday({ host: 'hostq02', kayit: bosLs(32, 'hostq02') }),
        ]),
      );
    const r1 = render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Hazır olanları toplu teyit et/ }));
    const pencere = await screen.findByTestId('et-toplu-teyit');
    const ogeler = within(pencere).getAllByTestId('et-toplu-oge');
    expect(within(ogeler[1]).getByTestId('et-toplu-ls')).toHaveTextContent('(çıktı yok)');
    expect(within(ogeler[1]).getByRole('checkbox')).toBeDisabled();
    expect(within(ogeler[1]).getByRole('checkbox')).not.toBeChecked();
    expect(within(ogeler[1]).getByTestId('et-toplu-haric')).toHaveTextContent(
      'ls -ltr çıktısı yok',
    );
    expect(screen.getByRole('button', { name: /^Sil \(/ })).toHaveTextContent('Sil (1)');
    r1.unmount();

    yonlendir = () => yanit(liste([aday({ kayit: bosLs(11, 'hosta01') })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    fireEvent.click(await screen.findByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    const sil = screen.getByRole('button', { name: 'Yedekle ve sil' });
    expect(sil).toBeDisabled();
    expect(sil).toHaveAttribute('title', expect.stringMatching(/ls -ltr çıktısı yok/));
  });

  it('ETT9 toplu teyit: taze taramada artık aday olmayan ve engelli kayıt otomatik hariç', async () => {
    const engel = 'domain.xml’de deployment tanımlı';
    yonlendir = () =>
      yanit(
        liste(
          [
            aday({ host: 'hostp01', kayit: hazir(31, 'hostp01') }),
            aday({ host: 'hostb02', engel, kayit: hazir(32, 'hostb02') }),
          ],
          [hazir(33, 'hostz09')],
        ),
      );
    render(<EarTemizlikTab />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Hazır olanları toplu teyit et \(3\)/ }),
    );
    const pencere = await screen.findByTestId('et-toplu-teyit');
    const ogeler = within(pencere).getAllByTestId('et-toplu-oge');
    expect(within(ogeler[0]).queryByTestId('et-toplu-haric')).toBeNull();
    expect(within(ogeler[1]).getByTestId('et-toplu-haric')).toHaveTextContent(engel);
    expect(within(ogeler[1]).getByRole('checkbox')).toBeDisabled();
    expect(within(ogeler[2]).getByTestId('et-toplu-haric')).toHaveTextContent('artık aday değil');
    expect(within(ogeler[2]).getByRole('checkbox')).toBeDisabled();
    expect(within(pencere).getByTestId('et-toplu-ozet')).toHaveTextContent('Dahil: 1 / 3 EAR');
  });

  it('ETT10 toplu silme sonucu kayıtlardan okunur: topluId taşımayan (CAS kaybeden) adıyla raporlanır', async () => {
    const topluId = '0f0e0d0c-1111-2222-3333-444455556666';
    yonlendir = (url, method) => {
      // Belirsiz sayılar (sirada "işaretlenen toplam" anlamında): arayüz bunlara güvenmez.
      if (method === 'POST') return yanit({ ok: true, topluId, sirada: 2, baslatilan: 1 });
      if (url.endsWith('/ear-temizlik/31'))
        return yanit({
          ok: true,
          kayit: kayit('SILINIYOR', { id: 31, host: 'hostp01', topluId, plan: null }),
        });
      if (url.endsWith('/ear-temizlik/32'))
        return yanit({ ok: true, kayit: kayit('IPTAL', { id: 32, host: 'hostq02' }) });
      return yanit(topluListe());
    };
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Hazır olanları toplu teyit et/ }));
    const pencere = await screen.findByTestId('et-toplu-teyit');
    fireEvent.change(within(pencere).getByLabelText('Toplu onay metni'), {
      target: { value: '2 EAR SIL' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sil (2)' }));
    await waitFor(() => expect(toastM.success).toHaveBeenCalled());
    expect(toastM.success).toHaveBeenCalledWith('1 EAR için silme istendi: 1 başladı, 0 sırada.');
    const uyari = screen
      .getAllByRole('alert')
      .find((x) => /işaretlenemedi/.test(x.textContent || ''));
    expect(uyari).toBeDefined();
    expect(uyari).toHaveTextContent('1 kayıt işaretlenemedi');
    expect(uyari).toHaveTextContent('hostq02 /vhosting/ORSTPCOMPLIANCE.ear');
    expect(uyari).not.toHaveTextContent('hostp01');
  });

  it('ETT10b sunucunun kaybedenler listesi de raporlanır; sıradaki kayıt "sırada" sayılır', async () => {
    const topluId = '0f0e0d0c-1111-2222-3333-444455556666';
    yonlendir = (url, method) => {
      if (method === 'POST')
        return yanit({ ok: true, topluId, sirada: 1, baslatilan: 0, kaybedenler: [32] });
      if (url.endsWith('/ear-temizlik/31'))
        return yanit({ ok: true, kayit: hazir(31, 'hostp01', { sirada: true, topluId }) });
      if (url.endsWith('/ear-temizlik/32')) return yanit({ ok: false, message: 'yok' }, 500);
      return yanit(topluListe());
    };
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Hazır olanları toplu teyit et/ }));
    const pencere = await screen.findByTestId('et-toplu-teyit');
    fireEvent.change(within(pencere).getByLabelText('Toplu onay metni'), {
      target: { value: '2 EAR SIL' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sil (2)' }));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith('1 EAR için silme istendi: 0 başladı, 1 sırada.'),
    );
    expect(
      screen
        .getAllByRole('alert')
        .some((x) => /hostq02.*işaretlen|işaretlenemedi.*hostq02/.test(x.textContent || '')),
    ).toBe(true);
  });

  it('ETT11 üst sınır 50: 51 seçimde ön kontrol düğmesi pasif ve nedenli', async () => {
    yonlendir = () =>
      yanit(liste(Array.from({ length: 51 }, (_, i) => aday({ host: `hostn${100 + i}` }))));
    render(<EarTemizlikTab />);
    await screen.findAllByTestId('et-aday');
    fireEvent.click(screen.getByRole('checkbox', { name: /hepsini seç/ }));
    const dugme = screen.getByRole('button', { name: /Seçilenlere ön kontrol/ });
    expect(dugme).toHaveTextContent('(51)');
    expect(dugme).toBeDisabled();
    expect(dugme).toHaveAttribute('title', expect.stringMatching(/En çok 50/));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seç hostn100 /vhosting/ORSTPCOMPLIANCE.ear' }),
    );
    expect(dugme).toHaveTextContent('(50)');
    expect(dugme).toBeEnabled();
  });

  it('ETT12 seçim yalnız süzülmüş satırlar; seçilemez olan seçimden düşer, sonra seçili geri gelmez', async () => {
    let ikinciDurum: EtKayit | null = null;
    yonlendir = (url, method) =>
      method === 'POST' && url.endsWith('/ear-temizlik/on-kontrol')
        ? yanit({
            ok: true,
            kayit: kayit('PLANLANIYOR', { id: 51, host: 'hostd04', plan: null }),
          })
        : yanit(liste([aday({ host: 'hostp01' }), aday({ host: 'hostd04', kayit: ikinciDurum })]));
    render(<EarTemizlikTab />);
    await screen.findAllByTestId('et-aday');
    const kutu = (h: string) =>
      screen.getByRole('checkbox', { name: `Seç ${h} /vhosting/ORSTPCOMPLIANCE.ear` });
    const dugme = () => screen.getByRole('button', { name: /Seçilenlere ön kontrol/ });
    fireEvent.click(screen.getByRole('checkbox', { name: /hepsini seç/ }));
    expect(dugme()).toHaveTextContent('(2)');
    fireEvent.change(screen.getByLabelText('Sunucu ya da EAR adı süz'), {
      target: { value: 'hostd' },
    });
    expect(dugme()).toHaveTextContent('(1)');
    fireEvent.change(screen.getByLabelText('Sunucu ya da EAR adı süz'), { target: { value: '' } });
    expect(dugme()).toHaveTextContent('(2)');

    // Tekli ön kontrol: satır seçilemez olur ve seçimden düşer.
    fireEvent.click(screen.getByRole('button', { name: /Ön kontrol hostd04/ }));
    await waitFor(() => expect(kutu('hostd04')).toBeDisabled());
    expect(dugme()).toHaveTextContent('(1)');
    // Ön kontrol başarısız bitti: satır yeniden seçilebilir ama seçili GERİ GELMEZ.
    ikinciDurum = kayit('PLAN_HATA', { id: 51, host: 'hostd04', plan: null });
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(kutu('hostd04')).toBeEnabled());
    expect(kutu('hostd04')).not.toBeChecked();
    expect(dugme()).toHaveTextContent('(1)');
  });

  it('ETT13 toplu grup yalnız sırada kaydı olan toplu işlem için; BELIRSIZ toplu seçilemez, tekli açık', async () => {
    const topluId = 'abcd1234-0000-1111-2222-333344445555';
    yonlendir = () =>
      yanit(
        liste(
          [
            aday({
              host: 'hostu01',
              kayit: kayit('BELIRSIZ', { id: 61, host: 'hostu01', plan: null }),
            }),
          ],
          [kayit('SILINIYOR', { id: 42, host: 'hosts01', topluId, plan: null })],
        ),
      );
    render(<EarTemizlikTab />);
    await screen.findAllByTestId('et-aday');
    expect(screen.queryByTestId('et-toplu-grup')).toBeNull();
    const k = screen.getByRole('checkbox', { name: 'Seç hostu01 /vhosting/ORSTPCOMPLIANCE.ear' });
    expect(k).toBeDisabled();
    expect(k).toHaveAttribute('title', expect.stringMatching(/belirsiz/));
    expect(screen.getByRole('button', { name: /Ön kontrol hostu01/ })).toBeEnabled();
  });
});

describe('EarTemizlikTab toplu yoklama', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());
  const ilerlet = zamanlayiciKuruluncaIlerlet;
  const hazir = (id: number, host: string, ek: Partial<EtKayit> = {}): EtKayit =>
    kayit('PLAN_HAZIR', { id, host, planJobId: 600 + id, ...ek });
  const getSayisi = (re: RegExp) =>
    cagrilar.filter((c) => c.method === 'GET' && re.test(c.url)).length;

  it('ETT14 toplu pencere açıkken kayıt sıraya girerse otomatik hariç olur', async () => {
    let k32: EtKayit = hazir(32, 'hostq02');
    yonlendir = (url) =>
      url.endsWith('/ear-temizlik/32')
        ? yanit({ ok: true, kayit: k32 })
        : url.endsWith('/ear-temizlik/31')
          ? yanit({ ok: true, kayit: hazir(31, 'hostp01') })
          : yanit(
              liste([
                aday({ host: 'hostp01', kayit: hazir(31, 'hostp01') }),
                aday({ host: 'hostq02', kayit: hazir(32, 'hostq02') }),
              ]),
            );
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Hazır olanları toplu teyit et/ }));
    const pencere = await screen.findByTestId('et-toplu-teyit');
    expect(screen.getByRole('button', { name: /^Sil \(/ })).toHaveTextContent('Sil (2)');
    k32 = hazir(32, 'hostq02', { sirada: true, topluId: 'baska-0000' });
    await ilerlet(PLAN_YOKLAMA_MS);
    const oge = within(pencere).getAllByTestId('et-toplu-oge')[1];
    await waitFor(() =>
      expect(within(oge).getByTestId('et-toplu-haric')).toHaveTextContent(
        'Plan artık teyit beklemiyor',
      ),
    );
    expect(within(oge).getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Sil \(/ })).toHaveTextContent('Sil (1)');
  });

  it('ETT15 tekli pencere açıkken kayıt sıraya girerse "Yedekle ve sil" kapanır', async () => {
    let tek: EtKayit = kayit('PLAN_HAZIR');
    yonlendir = (url) =>
      url.endsWith('/ear-temizlik/11')
        ? yanit({ ok: true, kayit: tek })
        : yanit(liste([aday({ kayit: kayit('PLAN_HAZIR') })]));
    render(<EarTemizlikTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Çıktıyı gör ve teyit et/ }));
    fireEvent.click(await screen.findByRole('checkbox', INCELEDIM));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'ORSTPCOMPLIANCE.ear' },
    });
    const sil = screen.getByRole('button', { name: 'Yedekle ve sil' });
    expect(sil).toBeEnabled();
    tek = kayit('PLAN_HAZIR', { sirada: true, topluId: 'baska-0000' });
    await ilerlet(PLAN_YOKLAMA_MS);
    await waitFor(() => expect(sil).toBeDisabled());
    expect(sil).toHaveAttribute('title', 'Plan artık teyit beklemiyor');
  });

  it('ETT16 sıradaki kayıt sık yoklanır; sırada → siliniyor geçişi ekrana yansır', async () => {
    let tek: EtKayit = hazir(41, 'hosts01', { sirada: true, topluId: 't-1' });
    yonlendir = (url) =>
      url.endsWith('/ear-temizlik/41')
        ? yanit({ ok: true, kayit: tek })
        : yanit(liste([aday({ host: 'hosts01', kayit: hazir(41, 'hosts01', { sirada: true }) })]));
    render(<EarTemizlikTab />);
    const satir = (await screen.findAllByTestId('et-aday'))[0];
    expect(within(satir).getByText(/Sırada —/)).toBeInTheDocument();
    tek = kayit('SILINIYOR', { id: 41, host: 'hosts01', topluId: 't-1', plan: null });
    await ilerlet(YOKLAMA_MS);
    await waitFor(() => expect(getSayisi(/\/ear-temizlik\/41$/)).toBe(1));
    await waitFor(() =>
      expect(within(satir).getByText('Yedekleniyor ve siliniyor')).toBeInTheDocument(),
    );
  });

  it('ETT17 çok kayıt yoklanırken kayıt başına GET yerine tek liste okunur', async () => {
    const n = TEK_TEK_YOKLAMA_SINIRI + 2;
    const adaylar = Array.from({ length: n }, (_, i) =>
      aday({
        host: `hostk${10 + i}`,
        kayit: hazir(100 + i, `hostk${10 + i}`, { sirada: true, topluId: 't-2' }),
      }),
    );
    let listeHata = false;
    yonlendir = () =>
      listeHata ? yanit({ ok: false, message: 'Sunucu meşgul' }, 503) : yanit(liste(adaylar));
    render(<EarTemizlikTab />);
    await screen.findAllByTestId('et-aday');
    const liste0 = getSayisi(/\/ear-temizlik$/);
    await ilerlet(YOKLAMA_MS);
    await waitFor(() => expect(getSayisi(/\/ear-temizlik$/)).toBe(liste0 + 1));
    expect(getSayisi(/\/ear-temizlik\/\d+$/)).toBe(0);
    // Liste okunamazsa hata yutulmaz: eşikte satırlarda uyarı.
    listeHata = true;
    for (let i = 0; i < YOKLAMA_HATA_ESIGI; i++) await ilerlet(YOKLAMA_MS);
    await waitFor(() => expect(screen.getAllByTestId('et-yoklama-hata').length).toBe(n));
    expect(screen.getAllByTestId('et-yoklama-hata')[0]).toHaveTextContent('Sunucu meşgul');
    expect(getSayisi(/\/ear-temizlik\/\d+$/)).toBe(0);
  });
});
