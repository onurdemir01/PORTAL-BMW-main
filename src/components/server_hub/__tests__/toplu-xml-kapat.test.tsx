// src/components/server_hub/__tests__/toplu-xml-kapat.test.tsx — Toplu Auto-Start › "Domain kapalı — auto-start host XML
// üzerinden kapat" (2026-11-15, kullanıcı: "olur ekle lütfen").
//   TX-U1 bölüm: başlık + açıklama, domain başına satır (JVM sayısı, açılır JVM listesi), prod rozeti; varsayılan seçim yok;
//         "Prod dışı tümünü seç" yalnız non-prod domain'leri seçer; Planla seçili domain'lerin TÜM JVM'lerini gönderir
//         (eylem xml_kapat), CLI seçimi karışmaz
//   TX-U2 prod domain seçiliyse plan penceresi prod işaretini ister; işaretsiz düğme kilitli; işaretle → prodOnay: true
//   TX-U3 iş görünümü: host XML öğesi "host XML" etiketi; onay penceresi kapsamı (sunucu / JVM) ve prod işareti;
//         onay prodOnay ile gider; düğme metni "İptal" (Vazgeç değil)
//   TX-U4 saf yardımcılar: xmlSecimi, prodDisiAnahtarlar, prodOgesiMi, xmlKapsami
//   TX-U5 inceleme #2: sunucu oluşturmada prod_onay 400 döndü (ekran non-prod sandı) → pencere TÜM kapsam prod işaretli
//         ve sunucu mesajıyla yeniden açılır; işaretle → prodOnay: true (toast yerine)
//   TX-U6 inceleme #2: onayda prod_onay 400 (ekran tahmini yanıldı) → uygulama penceresi prod işaretiyle yeniden açılır
//   TX-U7 inceleme #4/#5: rozet etiketi sunucu prodMu ile aynı; bölüm adı sınıflama metninde birebir
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';

const m = vi.hoisted(() => ({
  topluAutoStartAdaylar: vi.fn(),
  topluAutoStartListe: vi.fn(),
  topluAutoStartDurum: vi.fn(),
  topluAutoStartOlustur: vi.fn(),
  topluAutoStartOnayla: vi.fn(),
  topluAutoStartIptal: vi.fn(),
}));
const toastM = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));

import TopluAutoStartTab from '@/components/server_hub/TopluAutoStartTab';
import {
  PROD_ONAY_METNI,
  prodDisiAnahtarlar,
  prodOgesiMi,
  xmlKapsami,
  xmlSecimi,
  prodOnayRedMi,
  prodRozetEtiketi,
} from '@/components/server_hub/TopluXmlKapat';
import { KATEGORI } from '@/components/server_hub/topluSiniflama';

const grup = (host: string, gen: number, jvms: string[], prod = false) => ({
  host,
  gen,
  env: prod ? 'PROD' : 'TEST',
  envGroup: prod ? 'Production' : 'Non-Production',
  prod,
  scanDate: '2026-11-15',
  jvms: jvms.map((jvm) => ({ jvm, autoStart: 'true', running: false })),
});
const GRUPLAR = [grup('GBNP01', 7, ['n1', 'n2']), grup('GBNP02', 8, ['m1']), grup('GBPR01', 8, ['p1', 'p2', 'p3'], true)];
const isSatiri = (durum: string, ek = {}) => ({
  id: 9,
  durum,
  olusturan: 'ayse',
  onaylayan: null,
  iptalEden: null,
  ustSinir: 500,
  aday: 2,
  planGecti: 2,
  dusen: 0,
  ok: 0,
  skip: 0,
  fail: 0,
  hata: null,
  createdAt: '2026-11-15T10:00:00Z',
  planBitisAt: new Date().toISOString(),
  onayAt: null,
  bitisAt: null,
  ...ek,
});
const xoge = (id: number, host: string, jvm: string, durum: string, env = 'TEST') => ({
  id,
  sira: id,
  host,
  env,
  gen: 8,
  jvm,
  eylem: 'jboss_autostart_xml_off',
  hedef: 'false',
  taramaDegeri: 'true',
  calisiyor: false,
  taramaScanDate: '2026-11-15',
  durum,
  neden: 'true -> false',
  planJobId: 100 + id,
  awxServerId: 1,
  awxJobId: null,
  sonucSatiri: null,
  dogrulandi: false,
  hostXml: true,
  baslamaAt: null,
  bitisAt: null,
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  Object.values(toastM).forEach((f) => f.mockReset());
  m.topluAutoStartAdaylar.mockResolvedValue({
    ok: true,
    adaylar: [
      {
        host: 'APP01',
        env: 'TEST',
        envGroup: 'Non-Production',
        gen: 7,
        jvm: 'a1',
        eylem: 'ac',
        action: 'jboss_autostart_on',
        running: true,
        autoStart: 'false',
        scanDate: '2026-11-15',
      },
    ],
    dislananlar: [],
    adaylarXml: GRUPLAR,
    limit: 500,
    isBasinaJvm: 10,
    aktif: null,
  });
  m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: null, son: [] });
});

describe('Toplu Auto-Start › host XML bölümü', () => {
  it('TX-U1 bölüm, domain seçimi, "Prod dışı tümünü seç", Planla tüm domain JVM’lerini gönderir', async () => {
    m.topluAutoStartOlustur.mockResolvedValue({ ok: true, id: 9, adet: 3, hostSayisi: 2 });
    m.topluAutoStartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLANLANIYOR'), ogeler: [] });
    render(<TopluAutoStartTab />);
    const bolum = await screen.findByRole('region', { name: 'Domain kapalı — auto-start host XML üzerinden kapat' });
    expect(within(bolum).getByRole('heading', { name: 'Domain kapalı — auto-start host XML üzerinden kapat' })).toBeTruthy();
    expect(bolum.textContent).toMatch(/canlı CLI yok/);
    expect(bolum.textContent).toMatch(/yalnız kapatma/);
    expect(bolum.textContent).toMatch(/Dosya önce yedeklenir/);
    expect(bolum.textContent).toMatch(/host controller’ın o an hâlâ kapalı olduğunu/);
    // domain satiri: JVM sayisi + acilir JVM listesi; prod rozeti
    const pr = within(bolum).getByTestId('xml-domain-GBPR01|8');
    expect(pr.textContent).toMatch(/3 JVM/);
    expect(pr.textContent).toMatch(/p1, p2, p3/);
    expect(within(pr).getByTitle(/Production ya da ortamı bilinmeyen sunucu/).textContent).toBe('PROD');
    expect(within(within(bolum).getByTestId('xml-domain-GBNP01|7')).queryByTitle(/Production ya da ortamı bilinmeyen sunucu/)).toBeNull();
    // varsayilan secim yok
    const planla = within(bolum).getByRole('button', { name: /^Planla — host XML/ }) as HTMLButtonElement;
    expect(planla.textContent).toBe('Planla — host XML (0 JVM, 0 domain)');
    expect(planla.disabled).toBe(true);
    fireEvent.click(within(bolum).getByRole('button', { name: 'Prod dışı tümünü seç' }));
    expect(planla.textContent).toBe('Planla — host XML (3 JVM, 2 domain)');
    expect((within(bolum).getByLabelText('GBPR01 JBoss 8 domain seç') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(planla);
    // non-prod: pencere kapsami gosterir, prod isareti yok
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).getByTestId('xml-onay-kapsam').textContent).toMatch(/GBNP01.*n1, n2/);
    expect(within(pencere).queryByText(PROD_ONAY_METNI)).toBeNull();
    expect(within(pencere).getByRole('button', { name: 'İptal' })).toBeTruthy();
    fireEvent.click(within(pencere).getByRole('button', { name: 'Planla' }));
    await waitFor(() => expect(m.topluAutoStartOlustur).toHaveBeenCalledTimes(1));
    expect(m.topluAutoStartOlustur.mock.calls[0]).toEqual([
      [
        { host: 'GBNP01', gen: 7, jvm: 'n1', eylem: 'xml_kapat' },
        { host: 'GBNP01', gen: 7, jvm: 'n2', eylem: 'xml_kapat' },
        { host: 'GBNP02', gen: 8, jvm: 'm1', eylem: 'xml_kapat' },
      ],
    ]);
  });

  it('TX-U2 prod domain seçiliyse plan penceresi prod işaretini ister; işaretle → prodOnay: true', async () => {
    m.topluAutoStartOlustur.mockResolvedValue({ ok: true, id: 9, adet: 3, hostSayisi: 1 });
    m.topluAutoStartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLANLANIYOR'), ogeler: [] });
    render(<TopluAutoStartTab />);
    const bolum = await screen.findByRole('region', { name: 'Domain kapalı — auto-start host XML üzerinden kapat' });
    fireEvent.click(within(bolum).getByLabelText('GBPR01 JBoss 8 domain seç'));
    expect(bolum.textContent).toMatch(/Production \/ ortamı bilinmeyen sunucu var — ayrıca onay istenecek/);
    fireEvent.click(within(bolum).getByRole('button', { name: 'Planla — host XML (3 JVM, 1 domain)' }));
    const pencere = await screen.findByRole('dialog');
    const dugme = within(pencere).getByRole('button', { name: 'Planla' }) as HTMLButtonElement;
    expect(dugme.disabled).toBe(true);
    // isaretleyip Iptal ile kapatmak hicbir sey gondermez; isaret sonraki acilisa tasinmaz
    fireEvent.click(within(pencere).getByLabelText(PROD_ONAY_METNI));
    expect(dugme.disabled).toBe(false);
    fireEvent.click(within(pencere).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.topluAutoStartOlustur).not.toHaveBeenCalled();
    fireEvent.click(within(bolum).getByRole('button', { name: 'Planla — host XML (3 JVM, 1 domain)' }));
    const p2 = await screen.findByRole('dialog');
    const d2 = within(p2).getByRole('button', { name: 'Planla' }) as HTMLButtonElement;
    // yeniden acilan pencerede isaret sifirlanmali
    expect(d2.disabled).toBe(true);
    fireEvent.click(within(p2).getByLabelText(PROD_ONAY_METNI));
    expect(d2.disabled).toBe(false);
    fireEvent.click(d2);
    await waitFor(() => expect(m.topluAutoStartOlustur).toHaveBeenCalledTimes(1));
    expect(m.topluAutoStartOlustur.mock.calls[0][1]).toEqual({ prodOnay: true });
    expect(m.topluAutoStartOlustur.mock.calls[0][0]).toHaveLength(3);
  });

  it('TX-U3 iş görünümü: "host XML" etiketi; onay penceresi kapsam + prod işareti; prodOnay ile onay', async () => {
    const ogeler = [xoge(1, 'GBPR01', 'p1', 'PLAN_GECTI', 'PROD'), xoge(2, 'GBPR01', 'p2', 'PLAN_GECTI', 'PROD'), xoge(3, 'GBNP02', 'm1', 'DUSTU')];
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: isSatiri('PLAN_HAZIR'), son: [] });
    m.topluAutoStartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLAN_HAZIR', { kip: 'xml' }), ogeler });
    m.topluAutoStartOnayla.mockResolvedValue({ ok: true, id: 9, adet: 2 });
    render(<TopluAutoStartTab />);
    const onay = await screen.findByRole('button', { name: 'Onayla ve uygula (2 JVM)' });
    expect(screen.getAllByText('host XML')).toHaveLength(3);
    expect(screen.getByText(/Host XML: uygulamada betik dosyayı yeniden okur, önce yedek alır; host controller o an kapalı olmalı/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'İptal' })).toBeTruthy();
    expect(screen.queryByText(/Vazgeç/)).toBeNull();
    // aktif is varken host XML bolumu kilitli
    expect((screen.getByRole('button', { name: /^Planla — host XML/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(onay);
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/2 JVM, 1 sunucu: auto-start host XML dosyasında KAPATILACAK \(domain kapalı\)/);
    expect(within(pencere).getByTestId('xml-onay-kapsam').textContent).toMatch(/GBPR01.*JBoss 8.*PROD.*p1, p2/);
    expect(within(pencere).getByTestId('xml-onay-kapsam').textContent).not.toMatch(/m1/);
    const uygula = within(pencere).getByRole('button', { name: 'Onayla ve uygula' }) as HTMLButtonElement;
    expect(uygula.disabled).toBe(true);
    fireEvent.click(uygula);
    expect(m.topluAutoStartOnayla).not.toHaveBeenCalled();
    fireEvent.click(within(pencere).getByLabelText(PROD_ONAY_METNI));
    fireEvent.click(uygula);
    await waitFor(() => expect(m.topluAutoStartOnayla).toHaveBeenCalledWith(9, { prodOnay: true }));
  });

  it('TX-U3b non-prod host XML işi: onay penceresinde işaret yok, prodOnay gönderilmez', async () => {
    const ogeler = [xoge(1, 'GBNP02', 'm1', 'PLAN_GECTI')];
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: isSatiri('PLAN_HAZIR'), son: [] });
    m.topluAutoStartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLAN_HAZIR'), ogeler });
    m.topluAutoStartOnayla.mockResolvedValue({ ok: true, id: 9, adet: 1 });
    render(<TopluAutoStartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Onayla ve uygula (1 JVM)' }));
    const pencere = await screen.findByRole('dialog');
    expect(within(pencere).queryByText(PROD_ONAY_METNI)).toBeNull();
    fireEvent.click(within(pencere).getByRole('button', { name: 'Onayla ve uygula' }));
    await waitFor(() => expect(m.topluAutoStartOnayla).toHaveBeenCalledTimes(1));
    expect(m.topluAutoStartOnayla.mock.calls[0]).toEqual([9]);
  });

  it('TX-U4 saf yardımcılar', () => {
    expect(xmlSecimi(GRUPLAR, new Set(['GBPR01|8'])).map((x) => `${x.host}/${x.gen}/${x.jvm}/${x.eylem}`)).toEqual([
      'GBPR01/8/p1/xml_kapat',
      'GBPR01/8/p2/xml_kapat',
      'GBPR01/8/p3/xml_kapat',
    ]);
    expect(prodDisiAnahtarlar(GRUPLAR)).toEqual(['GBNP01|7', 'GBNP02|8']);
    // gruptaki bayrak; grup yoksa ortam adı (bilinmeyen = prod)
    expect(prodOgesiMi({ host: 'GBPR01', env: 'TEST' }, GRUPLAR)).toBe(true);
    expect(prodOgesiMi({ host: 'YOK01', env: 'QA' }, GRUPLAR)).toBe(false);
    expect(prodOgesiMi({ host: 'YOK01', env: 'BILINMIYOR' }, GRUPLAR)).toBe(true);
    expect(prodOgesiMi({ host: 'YOK01', env: null }, undefined)).toBe(true);
    expect(
      xmlKapsami([
        { host: 'H', gen: 7, jvm: 'a', prod: false },
        { host: 'H', gen: 8, jvm: 'b', prod: true },
        { host: 'H', gen: 7, jvm: 'c', prod: true },
      ]),
    ).toEqual([
      { host: 'H', gen: 7, prod: true, jvms: ['a', 'c'] },
      { host: 'H', gen: 8, prod: true, jvms: ['b'] },
    ]);
  });

  it('TX-U5 oluşturmada prod_onay 400: pencere prod işaretli yeniden açılır, işaretle → prodOnay: true', async () => {
    m.topluAutoStartOlustur
      .mockResolvedValueOnce({ ok: false, code: 'prod_onay', message: 'Production / ortamı bilinmeyen 1 sunucu seçimde (GBNP02) — host XML ile kapatma için açık prod onayı gerekli (prodOnay).' })
      .mockResolvedValueOnce({ ok: true, id: 9, adet: 1, hostSayisi: 1 });
    m.topluAutoStartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLANLANIYOR'), ogeler: [] });
    render(<TopluAutoStartTab />);
    const bolum = await screen.findByRole('region', { name: 'Domain kapalı — auto-start host XML üzerinden kapat' });
    fireEvent.click(within(bolum).getByLabelText('GBNP02 JBoss 8 domain seç'));
    fireEvent.click(within(bolum).getByRole('button', { name: 'Planla — host XML (1 JVM, 1 domain)' }));
    const p1 = await screen.findByRole('dialog');
    expect(within(p1).queryByText(PROD_ONAY_METNI)).toBeNull();
    fireEvent.click(within(p1).getByRole('button', { name: 'Planla' }));
    await waitFor(() => expect(m.topluAutoStartOlustur).toHaveBeenCalledTimes(1));
    expect(m.topluAutoStartOlustur.mock.calls[0]).toHaveLength(1);
    const p2 = await screen.findByRole('dialog');
    await waitFor(() => expect(within(p2).getByRole('alert').textContent).toMatch(/Sunucu prod onayı istedi: .*GBNP02/));
    expect(within(p2).getByTestId('xml-onay-kapsam').textContent).toMatch(/GBNP02.*PROD.*m1/);
    const d = within(p2).getByRole('button', { name: 'Planla' }) as HTMLButtonElement;
    expect(d.disabled).toBe(true);
    expect(toastM.error).not.toHaveBeenCalled();
    fireEvent.click(within(p2).getByLabelText(PROD_ONAY_METNI));
    fireEvent.click(d);
    await waitFor(() => expect(m.topluAutoStartOlustur).toHaveBeenCalledTimes(2));
    expect(m.topluAutoStartOlustur.mock.calls[1]).toEqual([[{ host: 'GBNP02', gen: 8, jvm: 'm1', eylem: 'xml_kapat' }], { prodOnay: true }]);
  });

  it('TX-U6 onayda prod_onay 400: uygulama penceresi prod işaretiyle yeniden açılır', async () => {
    const ogeler = [xoge(1, 'GBXX09', 'z1', 'PLAN_GECTI')];
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: isSatiri('PLAN_HAZIR'), son: [] });
    m.topluAutoStartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLAN_HAZIR'), ogeler });
    m.topluAutoStartOnayla
      .mockResolvedValueOnce({ ok: false, code: 'prod_onay', message: 'Production / ortamı bilinmeyen 1 sunucu seçimde (GBXX09)' })
      .mockResolvedValueOnce({ ok: true, id: 9, adet: 1 });
    render(<TopluAutoStartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Onayla ve uygula (1 JVM)' }));
    const p1 = await screen.findByRole('dialog');
    expect(within(p1).queryByText(PROD_ONAY_METNI)).toBeNull();
    fireEvent.click(within(p1).getByRole('button', { name: 'Onayla ve uygula' }));
    await waitFor(() => expect(m.topluAutoStartOnayla).toHaveBeenCalledTimes(1));
    const p2 = await screen.findByRole('dialog');
    await waitFor(() => expect(within(p2).getByRole('alert').textContent).toMatch(/GBXX09/));
    const u = within(p2).getByRole('button', { name: 'Onayla ve uygula' }) as HTMLButtonElement;
    expect(u.disabled).toBe(true);
    fireEvent.click(within(p2).getByLabelText(PROD_ONAY_METNI));
    fireEvent.click(u);
    await waitFor(() => expect(m.topluAutoStartOnayla).toHaveBeenCalledTimes(2));
    expect(m.topluAutoStartOnayla.mock.calls[1]).toEqual([9, { prodOnay: true }]);
  });

  it('TX-U7 rozet etiketi ve bölüm adı', () => {
    expect(prodRozetEtiketi({ env: 'PROD', envGroup: 'Production' })).toBe('PROD');
    expect(prodRozetEtiketi({ env: 'PROD', envGroup: 'Non-Production' })).toBe('PROD');
    expect(prodRozetEtiketi({ env: 'prod', envGroup: 'Bilinmiyor' })).toBe('PROD');
    expect(prodRozetEtiketi({ env: 'TEST', envGroup: 'Bilinmiyor' })).toBe('ORTAM BİLİNMİYOR');
    expect(prodRozetEtiketi({ env: null, envGroup: null })).toBe('ORTAM BİLİNMİYOR');
    expect(KATEGORI.hc_kapali.ne).toContain('“Domain kapalı — auto-start host XML üzerinden kapat” bölümünden');
    expect(prodOnayRedMi({ code: 'prod_onay' })).toBe(true);
    expect(prodOnayRedMi(Object.assign(new Error('x'), { code: 'prod_onay' }))).toBe(true);
    expect(prodOnayRedMi({ code: 'karisik_secim' })).toBe(false);
    expect(prodOnayRedMi(null)).toBe(false);
  });
});
