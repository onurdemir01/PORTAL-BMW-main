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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';

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
  ad: 'GBSTPCOMPLIANCE.ear',
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
            'drwxr-x--- 3 was was 4096 Nov 10 09:00 /vhosting/GBSTPCOMPLIANCE.ear',
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
  ...ek,
});

const aday = (ek: Partial<EtAday> = {}): EtAday => ({
  host: 'hosta01',
  ortam: 'Test',
  prod: false,
  kok: '/vhosting',
  ad: 'GBSTPCOMPLIANCE.ear',
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

describe('EarTemizlikTab', () => {
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
    expect(within(satirlar[0]).getByText('/vhosting/GBSTPCOMPLIANCE.ear')).toBeInTheDocument();
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
      'drwxr-x--- 3 was was 4096 Nov 10 09:00 /vhosting/GBSTPCOMPLIANCE.ear',
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
    fireEvent.click(screen.getByRole('checkbox'));
    expect(sil).toBeDisabled();
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'gbstpcompliance.ear' },
    });
    expect(sil).toBeDisabled();
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'GBSTPCOMPLIANCE.ear' },
    });
    expect(sil).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox'));
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
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'GBSTPCOMPLIANCE.ear' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yedekle ve sil' }));
    await waitFor(() => expect(cagrilar.some((c) => c.method === 'POST')).toBe(true));
    const post = cagrilar.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/server-hub/ear-temizlik/11/sil');
    expect(post.body).toEqual({
      confirmed: true,
      onayMetni: 'GBSTPCOMPLIANCE.ear',
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
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'GBSTPCOMPLIANCE.ear' },
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
              yedek: '/var/tmp/server_hub_backup/ear-GBSTPCOMPLIANCE.ear-20261116.tgz',
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
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'GBSTPCOMPLIANCE.ear' },
    });
    expect(screen.getByRole('button', { name: 'Yedekle ve sil' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByTestId('et-teyit')).toBeNull());
    expect(within(satirlar[1]).getByText(/parmak izi değişti/)).toBeInTheDocument();
    expect(
      within(satirlar[2]).getByText(/ear-GBSTPCOMPLIANCE\.ear-20261116\.tgz/),
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

  const ilerlet = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };
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
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'GBSTPCOMPLIANCE.ear' },
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
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'GBSTPCOMPLIANCE.ear' },
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
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('EAR adı'), {
      target: { value: 'GBSTPCOMPLIANCE.ear' },
    });
    expect(screen.getByTestId('et-kalan')).toHaveTextContent('bilinmiyor');
    const sil2 = screen.getByRole('button', { name: 'Yedekle ve sil' });
    expect(sil2).toBeDisabled();
    expect(sil2).toHaveAttribute('title', expect.stringMatching(/bilinmiyor/));
  });
});
