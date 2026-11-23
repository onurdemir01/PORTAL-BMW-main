// src/components/__tests__/IntranetPaketKurulum.test.tsx — Intranet SPA > paket kurulumu (2026-11-23).
//
// Kullanici: PROD intranet Nginx'e gelmeyen paketleri gecisleri beklemeden Artifactory'den cekmek.
//   PK1 Admin olmayan kullanici bolumu gormez (uc da cagrilmaz)
//   PK2 kurulabilir olmayan satirin kutusu pasif; engel uyarisi metniyle gorunur
//   PK3 en cok 10 secim: 10. secimden sonra secilmemis kutular pasif
//   PK4 planla -> paketKur apply:false; is izlenir (5 sn'de bir), bitince sonuc haplari
//   PK2b ayni kodlu iki uyari ikisi de cizilir (anahtar kod+indeks, React anahtar uyarisi yok)
//   PK5 Uygula: 'PROD' yazilmadan / 'prod' ile pasif, 'PROD' ile aktif; apply:true + onayMetni + plan
//   PK5b onay listesi yalniz PLAN_OK sunucusu olan kalemler; digeri gonderilmez
//   PK6 FAIL satirinda adim + mesaj; OCP hatasi kalem satirinda
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ContextType, ReactElement } from 'react';
import { render } from '@/test/test-utils';
import { zamanlayiciKuruluncaIlerlet } from '@/test/zamanlayici';
import { AuthContext } from '@/contexts/AuthContext';
import IntranetPaketKurulum, { PAKET_YOKLAMA_MS } from '@/components/IntranetPaketKurulum';
import type { PaketAday, PaketIsYanit, PaketSonuc } from '@/api/arkSpaApi';

const api = vi.hoisted(() => ({ adaylar: vi.fn(), kur: vi.fn(), is: vi.fn() }));
vi.mock('@/api/arkSpaApi', () => ({
  arkSpaApi: { paketAdaylari: api.adaylar, paketKur: api.kur, paketIs: api.is },
}));

const A = (application: string, o: Partial<PaketAday> = {}): PaketAday => ({
  namespace: 'kart-prod',
  application,
  env: 'PROD',
  surum: '0.0.32-391-prod',
  imaj: `registry.invalid/kart-prod/${application}:0.0.32-391-prod`,
  cluster: 'orocpp1',
  clusters: ['orocpp1'],
  alinma: new Date().toISOString(),
  hedefler: ['NGINXP01', 'NGINXP02'],
  taranmayan: [],
  uyarilar: [],
  kurulabilir: true,
  sonDeneme: null,
  ...o,
});

const yanit = (adaylar: PaketAday[]) => ({
  ok: true,
  hesaplandi: new Date().toISOString(),
  dizinTarihi: '2026-11-22',
  ozet: { toplam: adaylar.length, kurulabilir: adaylar.filter((a) => a.kurulabilir).length },
  adaylar,
});

const SONUC_PLAN: PaketSonuc = {
  mode: 'plan',
  overall: 'partial',
  items: [
    {
      id: 'kart-prod/kart-app-v0',
      namespace: 'kart-prod',
      application: 'kart-app-v0',
      version: '0.0.32-391-prod',
      cluster: 'orocpp1',
      ocp: { ok: true, image: 'x', tag: '0.0.32-391-prod', configmap: 'cm', error: null },
      hosts: [
        { host: 'NGINXP01', status: 'PLAN_OK', step: 'check', message: 'hazir' },
        { host: 'NGINXP02', status: 'FAIL', step: 'check', message: 'paket bulunamadi (404)' },
      ],
    },
  ],
};

const KALEM = {
  id: 'kart-prod/kart-app-v0',
  namespace: 'kart-prod',
  application: 'kart-app-v0',
  version: '0.0.32-391-prod',
  cluster: 'orocpp1',
  hosts: ['NGINXP01', 'NGINXP02'],
};

function cizAdmin(ui: ReactElement, role = 'Admin') {
  const deger = { user: { username: 'onur', role } } as unknown as ContextType<typeof AuthContext>;
  return render(<AuthContext.Provider value={deger}>{ui}</AuthContext.Provider>);
}

const kutu = (app: string) => screen.getByRole('checkbox', { name: new RegExp(`^${app} `) });

async function planlaVeBitir(isYanitlari: PaketIsYanit[]) {
  api.adaylar.mockResolvedValue(yanit([A('kart-app-v0')]));
  api.kur.mockResolvedValue({ ok: true, serverId: 1, jobId: 777, mod: 'plan', items: [KALEM] });
  for (const r of isYanitlari) api.is.mockResolvedValueOnce(r);
  cizAdmin(<IntranetPaketKurulum />);
  fireEvent.click(await screen.findByRole('checkbox', { name: /^kart-app-v0 / }));
  fireEvent.click(screen.getByRole('button', { name: 'Seçilenleri planla' }));
}

beforeEach(() => {
  api.adaylar.mockReset();
  api.kur.mockReset();
  api.is.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('IntranetPaketKurulum', () => {
  it('PK1 Admin olmayan bolumu gormez', () => {
    api.adaylar.mockResolvedValue(yanit([A('kart-app-v0')]));
    cizAdmin(<IntranetPaketKurulum />, 'User');
    expect(screen.queryByText(/paket kurulumu/)).toBeNull();
    expect(api.adaylar).not.toHaveBeenCalled();
  });

  it('PK1b saglayicisiz render da bolumu cizmez (sayfa testleri kirilmaz)', () => {
    render(<IntranetPaketKurulum />);
    expect(screen.queryByText(/paket kurulumu/)).toBeNull();
  });

  it('PK2 kurulabilir olmayan satirin kutusu pasif ve engel metni gorunur', async () => {
    api.adaylar.mockResolvedValue(
      yanit([
        A('kart-app-v0'),
        A('kart-ui-v0', {
          kurulabilir: false,
          surum: null,
          uyarilar: [
            { kod: 'surum-farkli', metin: 'PROD cluster’larında farklı sürümler', engel: true },
            { kod: 'bayat', metin: 'okuma 7 saat önce', engel: false },
          ],
        }),
      ]),
    );
    cizAdmin(<IntranetPaketKurulum />);
    await screen.findByText('kart-ui-v0');
    expect(kutu('kart-app-v0')).not.toBeDisabled();
    expect(kutu('kart-ui-v0')).toBeDisabled();
    expect(screen.getByText('PROD cluster’larında farklı sürümler')).toBeInTheDocument();
    expect(screen.getByText('okuma 7 saat önce')).toBeInTheDocument();
    expect(screen.getByText(/kurulabilir/)).toHaveTextContent('Toplam 2 · kurulabilir 1');
  });

  it("PK3 10'dan fazla secilemez", async () => {
    const adlar = Array.from({ length: 12 }, (_, i) => `app-${String(i).padStart(2, '0')}-v0`);
    api.adaylar.mockResolvedValue(yanit(adlar.map((n) => A(n))));
    cizAdmin(<IntranetPaketKurulum />);
    await screen.findByText(adlar[0]);
    adlar.slice(0, 10).forEach((n) => fireEvent.click(kutu(n)));
    expect(screen.getByText(/10 seçili/)).toBeInTheDocument();
    expect(kutu(adlar[10])).toBeDisabled();
    expect(kutu(adlar[11])).toBeDisabled();
    expect(kutu(adlar[0])).not.toBeDisabled();
    fireEvent.click(kutu(adlar[0]));
    expect(kutu(adlar[10])).not.toBeDisabled();
  });

  it('PK4 planla -> apply:false, is 5 sn arayla izlenir, bitince sonuc haplari', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await planlaVeBitir([
      { ok: true, status: 'running', finished: false },
      { ok: true, status: 'successful', finished: true, sonuc: SONUC_PLAN },
    ]);
    await waitFor(() =>
      expect(api.kur).toHaveBeenCalledWith({
        secim: [{ namespace: 'kart-prod', application: 'kart-app-v0' }],
        apply: false,
      }),
    );
    expect(await screen.findByText(/İş #777 \(plan\): running/)).toBeInTheDocument();
    expect(api.is).toHaveBeenCalledWith(1, 777);
    expect(screen.queryByRole('button', { name: 'Uygula' })).toBeNull();
    await zamanlayiciKuruluncaIlerlet(PAKET_YOKLAMA_MS);
    const tablo = await screen.findByRole('table', { name: 'Kurulum sonucu' });
    expect(api.is).toHaveBeenCalledTimes(2);
    expect(within(tablo).getByText('PLAN_OK')).toBeInTheDocument();
    expect(within(tablo).getByText('FAIL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uygula' })).toBeInTheDocument();
  });

  it("PK5 Uygula: PROD yazilmadan ve 'prod' ile pasif, 'PROD' ile apply:true + ayni secim", async () => {
    await planlaVeBitir([{ ok: true, status: 'successful', finished: true, sonuc: SONUC_PLAN }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Uygula' }));
    const liste = screen.getByRole('list', { name: 'Kurulacaklar' });
    expect(liste).toHaveTextContent('kart-app-v0');
    expect(liste).toHaveTextContent('0.0.32-391-prod');
    expect(liste).toHaveTextContent('NGINXP01');
    expect(liste).not.toHaveTextContent('NGINXP02');
    const onay = screen.getByRole('button', { name: 'Onayla ve kur' });
    expect(onay).toBeDisabled();
    const giris = screen.getByLabelText('Onay metni');
    fireEvent.change(giris, { target: { value: 'prod' } });
    expect(onay).toBeDisabled();
    fireEvent.change(giris, { target: { value: 'PROD' } });
    expect(onay).not.toBeDisabled();

    api.kur.mockResolvedValueOnce({
      ok: true,
      serverId: 1,
      jobId: 778,
      mod: 'apply',
      items: [KALEM],
    });
    api.is.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      finished: true,
      sonuc: {
        ...SONUC_PLAN,
        mode: 'apply',
        items: [
          {
            ...SONUC_PLAN.items[0],
            hosts: [{ host: 'NGINXP01', status: 'OK', step: 'cleanup', message: 'kuruldu' }],
          },
        ],
      },
    });
    fireEvent.click(onay);
    await waitFor(() => expect(api.kur).toHaveBeenCalledTimes(2));
    expect(api.kur).toHaveBeenLastCalledWith({
      secim: [{ namespace: 'kart-prod', application: 'kart-app-v0' }],
      apply: true,
      onayMetni: 'PROD',
      plan: { serverId: 1, jobId: 777 },
    });
    expect(await screen.findByText(/sonraki dizin taramasında/)).toBeInTheDocument();
    expect(api.is).toHaveBeenLastCalledWith(1, 778);
  });

  it('PK5b onay listesi sunucunun kuracagi kalemler: PLAN_OK sunucusu olmayan kalem gonderilmez', async () => {
    const ikinci = { ...KALEM, id: 'kart-prod/kart-ui-v0', application: 'kart-ui-v0' };
    api.adaylar.mockResolvedValue(yanit([A('kart-app-v0'), A('kart-ui-v0')]));
    api.kur.mockResolvedValue({
      ok: true,
      serverId: 1,
      jobId: 777,
      mod: 'plan',
      items: [KALEM, ikinci],
    });
    api.is.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      finished: true,
      sonuc: {
        ...SONUC_PLAN,
        items: [
          SONUC_PLAN.items[0],
          {
            ...SONUC_PLAN.items[0],
            id: ikinci.id,
            application: ikinci.application,
            hosts: [{ host: 'NGINXP01', status: 'SKIP', step: 'check', message: 'zaten kurulu' }],
          },
        ],
      },
    });
    cizAdmin(<IntranetPaketKurulum />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /^kart-app-v0 / }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^kart-ui-v0 / }));
    fireEvent.click(screen.getByRole('button', { name: 'Seçilenleri planla' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Uygula' }));
    const liste = screen.getByRole('list', { name: 'Kurulacaklar' });
    expect(within(liste).getAllByRole('listitem')).toHaveLength(1);
    expect(liste).toHaveTextContent('kart-app-v0');
    expect(liste).not.toHaveTextContent('kart-ui-v0');
    expect(screen.getByLabelText('Kurulmayacaklar')).toHaveTextContent('kart-ui-v0');
    expect(screen.getByText(/Yalnız planda PLAN_OK olan sunucular kurulur/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Onay metni'), { target: { value: 'PROD' } });
    api.kur.mockResolvedValueOnce({ ok: true, serverId: 1, jobId: 778, mod: 'apply', items: [] });
    api.is.mockResolvedValue({ ok: true, status: 'running', finished: false });
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve kur' }));
    await waitFor(() => expect(api.kur).toHaveBeenCalledTimes(2));
    expect(api.kur).toHaveBeenLastCalledWith({
      secim: [{ namespace: 'kart-prod', application: 'kart-app-v0' }],
      apply: true,
      onayMetni: 'PROD',
      plan: { serverId: 1, jobId: 777 },
    });
  });

  it('PK2b ayni kodlu iki uyari ikisi de cizilir (anahtar kod+indeks)', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.adaylar.mockResolvedValue(
      yanit([
        A('kart-ui-v0', {
          kurulabilir: false,
          uyarilar: [
            { kod: 'etiketsiz', metin: 'c1: digest', engel: true },
            { kod: 'etiketsiz', metin: 'c2: digest', engel: true },
          ],
        }),
      ]),
    );
    cizAdmin(<IntranetPaketKurulum />);
    expect(await screen.findByText('c1: digest')).toBeInTheDocument();
    expect(screen.getByText('c2: digest')).toBeInTheDocument();
    const anahtarUyarisi = hata.mock.calls.some((c) => /same key/.test(String(c[0])));
    hata.mockRestore();
    expect(anahtarUyarisi).toBe(false);
  });

  it('PK6 FAIL satirinda adim + mesaj; OCP hatasi kalem satirinda', async () => {
    const sonuc: PaketSonuc = {
      mode: 'plan',
      overall: 'failed',
      items: [
        SONUC_PLAN.items[0],
        {
          ...SONUC_PLAN.items[0],
          id: 'kart-prod/kart-ui-v0',
          application: 'kart-ui-v0',
          ocp: {
            ok: false,
            image: null,
            tag: null,
            configmap: null,
            error: 'OCP’de koşan sürüm 0.0.33, planlanan 0.0.32',
          },
          hosts: [{ host: 'NGINXP03', status: 'FAIL', step: 'ocp', message: 'OCP okunamadi' }],
        },
      ],
    };
    await planlaVeBitir([{ ok: true, status: 'successful', finished: true, sonuc }]);
    const tablo = await screen.findByRole('table', { name: 'Kurulum sonucu' });
    const satir = within(tablo).getByText('NGINXP02').closest('tr') as HTMLElement;
    expect(within(satir).getByText('FAIL')).toBeInTheDocument();
    expect(within(satir).getByText('check')).toBeInTheDocument();
    expect(within(satir).getByText('paket bulunamadi (404)')).toBeInTheDocument();
    expect(within(tablo).getByText(/OCP: OCP’de koşan sürüm 0.0.33/)).toBeInTheDocument();
    const ocpSatir = within(tablo).getByText('NGINXP03').closest('tr') as HTMLElement;
    expect(within(ocpSatir).getByText('ocp')).toBeInTheDocument();
  });

  it('PK7 sunucunun hata mesaji gosterilir', async () => {
    api.adaylar.mockResolvedValue(yanit([A('kart-app-v0')]));
    api.kur.mockResolvedValue({ ok: false, error: 'Secim artik kurulabilir degil: kart-app-v0' });
    cizAdmin(<IntranetPaketKurulum />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /^kart-app-v0 / }));
    fireEvent.click(screen.getByRole('button', { name: 'Seçilenleri planla' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Secim artik kurulabilir degil: kart-app-v0',
    );
  });
});
