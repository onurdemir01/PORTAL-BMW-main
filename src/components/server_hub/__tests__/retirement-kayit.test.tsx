// Retirement KAYIT AYRINTISI davranisi (2026-10-26): RetirementTab gercek bilesenleriyle, API sahte.
//   RK1 ayrinti satiri TIKLANAN satirin hemen ALTINDA, colSpan = baslik kolon sayisi; tek acik satir
//   RK2 in-place cipi: kayittaki isaret; eski kayitta (inPlace null) bugunku kesiften BIR kez, tembel; in-place olmayan cipsiz
//   RK3 kesif duserse ekran calisir: eski kayit cipsiz ("bilinmiyor"), kayitli isaret yine gorunur
//   RK4 durdurulmus in-place hedefte satir notu + "kontrol listesi" -> Akis panelinde liste (/vhosting8)
//   RK5 STOP onayi: in-place uyarisi ("STOP bittikten sonra kontrol edin"), son onay dugmesi ACIK (engellemez)
//   RK6 "İş çıktısı" dugmesi yalniz is listesi varsa; acinca sekme ve is listesi; is ciktisi ucu hedef/adimla cagrilir
//   RK7 web adimi cipi o vhost girdisinin isini acar
// Dusmanca denetim tur 2 (eylem kosullari bekcisi yoktu: 16 mutasyon yesil kaliyordu):
//   RK8  EYLEM MATRISI: durum / kayit durumu -> hangi dugme var, hangisi yok (beklemeyi atla, kayittan cikar, web yeniden dene,
//        silme on kontrolu, silme sirada yazisi); RK9 "ön kontrolü yenile" STOP penceresini ACMAZ, on kontrolu yeniden kosar
//   RK10 busy kapisi: is baslatilirken satirlardaki eylemler (Durumu tazele dahil) kapali
//   RK11 iptal penceresinde "geri aktif et" secenegi; toplu onayda karisik ortam kapisi
//   RK12 web adimi cipi EN KOTU girdiyi gosterir
//   RK13 #is no ve "Canlı çıktıyı izle" KENDI isini secer (varsayilan secimden farkli veriyle); istenen is listede
//        yoksa (siniflandirilamadi) "Canlı çıktıyı izle" ve #is bagi YOK (denetim D1-1: baska isin ciktisini aciyordu)
//   RK14 (V1) in-place cipi UST satirda (ortam / JB yaninda), uygulama adi satiri tam genislik; diger kurulum da
//        kayittaysa satir notu "bu kayıtta hedef" (denetim B1); silinen in-place hedefte de not (denetim B9)
//   RK15 erisilebilirlik: "Olaylar" baslik; #is bagi eylemi soyler; Akis oku okunmaz
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RtRecord, RtTarget } from '@/api/retirementApi';

const api = vi.hoisted(() => ({
  list: vi.fn(), config: vi.fn(), get: vi.fn(), canli: vi.fn(), discover: vi.fn(), dnsIp: vi.fn(), isCiktisi: vi.fn(), apps: vi.fn(),
  stop: vi.fn(), stopToplu: vi.fn(), refreshStatus: vi.fn(),
}));
vi.mock('@/api/retirementApi', () => ({ retirementApi: api }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));
import RetirementTab from '@/components/server_hub/RetirementTab';

const hedef = (id: number, o: Partial<RtTarget> = {}): RtTarget => ({
  id, recordId: 37, host: `GBJEXP0${id}`, site: 'Pendik', env: 'TEST', appName: 'GBPOSWEBAPI', gen: 7, appPath: '/vhosting/GBPOSWEBAPI.ear',
  web: [], status: 'pending', planText: null, resultText: null, lastJobId: null, deleteJobId: null, stoppedAt: null, updatedAt: '2026-10-26T10:00:00Z',
  deletedAt: null, rolledBackAt: null, rollbackJobId: null, scheduledAt: null, windowEnd: null, webSonuc: null, detail: null, awxIsleri: [], ...o,
});
const kayit = (targets: RtTarget[]): RtRecord => ({
  id: 37, app: 'GBPOSWEBAPI', smartNo: '364244', ocoNo: null, ownerEmail: null, requestedBy: 'onur', status: 'open', deleteAfterDays: 45, plannedDeleteAt: null,
  stopAt: null, dnsReuse: false, lbReuse: false, sccNotifiedAt: null, notes: null, createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-26T10:00:00Z',
  effectiveDeleteAt: '2026-12-10', targets, events: [],
});
const T1 = hedef(1, {
  status: 'stopped', inPlace: true, digerSurumler: [8], lastJobId: 500, stoppedAt: '2026-10-26T09:00:00Z', resultText: 'OK — durduruldu',
  awxIsleri: [{ adim: 'onkontrol', jobId: 400, durum: 'basarili', basladi: null, bitti: null }, { adim: 'stop', jobId: 500, durum: 'basarili', basladi: null, bitti: null }],
});
const T2 = hedef(2, { status: 'planned', inPlace: null, digerSurumler: null, lastJobId: 600, planText: 'PLAN — 1 paket', stopIzin: { jobId: 600, at: null, izinler: ['onay:stop'] },
  awxIsleri: [{ adim: 'onkontrol', jobId: 600, durum: 'basarili', basladi: null, bitti: null }] });
const T3 = hedef(3, { inPlace: false, digerSurumler: [], awxIsleri: undefined });
const T4 = hedef(4, { status: 'stopped', inPlace: false, digerSurumler: [], stoppedAt: '2026-10-26T09:00:00Z' });
const ws = (host: string, serverName: string, status: string, jobId: number) => ({ host, serverName, product: 'IHS', confFile: 'mod-jk.conf', status, jobId, message: null });
const T5 = hedef(5, {
  status: 'stopped', inPlace: false, digerSurumler: [], stoppedAt: '2026-10-26T09:00:00Z',
  web: [{ host: 'GBJEXW05', serverName: 'pos.bmw.de', product: 'IHS', port: '443', confFile: 'mod-jk.conf' }],
  webSonuc: [ws('GBJEXW09', 'diger.bmw.de', 'failed', 509), ws('gbjexw05', 'POS.bmw.de', 'ok', 510)],
  awxIsleri: [{ adim: 'web', web: 0, jobId: 509, durum: 'basarisiz', basladi: null, bitti: null }, { adim: 'web', web: 1, jobId: 510, durum: 'basarili', basladi: null, bitti: null }],
});
const KESIF = { ok: true, base: 'GBPOSWEBAPI', summary: {}, targets: [{ host: 'GBJEXP02', appName: 'GBPOSWEBAPI', gen: 7, inPlace: true, digerSurumler: [8], web: [] }] };

async function ac(targets = [T1, T2, T3]) {
  api.get.mockResolvedValue({ ok: true, record: kayit(targets) });
  render(<RetirementTab />);
  fireEvent.click(await screen.findByText('GBPOSWEBAPI'));
  await screen.findByRole('table', { name: 'Retirement hedefleri' });
  return screen.getByRole('table', { name: 'Retirement hedefleri' });
}
const satir = (tablo: HTMLElement, id: number) => tablo.querySelector(`tr[data-tid="${id}"]`) as HTMLTableRowElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({ ok: true, records: [{ ...kayit([]), targets: 3, stopped: 1, envs: [] }] });
  api.config.mockResolvedValue({ ok: true, defaultDays: 45, sccMailConfigured: false, sccMailTo: null, smartFlows: {}, pollSeconds: 300 });
  api.canli.mockResolvedValue({ ok: false });
  api.dnsIp.mockResolvedValue({ ok: true, dns: [], vip: [], vhostIp: [] });
  api.discover.mockResolvedValue(KESIF);
  api.isCiktisi.mockResolvedValue({ ok: true, kaynak: 'awx', adim: 'stop', jobId: 500, awxServerId: 1, sunucuAdi: 'maestro', status: 'successful', bitti: true, output: 'PLAY RECAP', kirpildi: false, started: null, finished: null, elapsed: 4 });
});

describe('Retirement kayit ayrintisi', () => {
  it('RK1 ayrinti satiri tiklanan satirin altinda, tam genislikte; tek acik satir', async () => {
    const tablo = await ac();
    const thSayisi = tablo.querySelectorAll('thead th').length;
    fireEvent.click(within(satir(tablo, 2)).getByRole('button', { name: /Akış/ }));
    let ay = tablo.querySelector('tr[data-rt-ayrinti]') as HTMLTableRowElement;
    expect(ay.previousElementSibling).toBe(satir(tablo, 2));
    expect((ay.firstElementChild as HTMLTableCellElement).colSpan).toBe(thSayisi);
    for (const tr of tablo.querySelectorAll('tbody tr[data-tid]')) expect(tr.children).toHaveLength(thSayisi);
    fireEvent.click(within(satir(tablo, 1)).getByRole('button', { name: /Akış/ }));
    expect(tablo.querySelectorAll('tr[data-rt-ayrinti]')).toHaveLength(1);
    ay = tablo.querySelector('tr[data-rt-ayrinti]') as HTMLTableRowElement;
    expect(ay.previousElementSibling).toBe(satir(tablo, 1));
    // Ayni bag ikinci kez: kapanir.
    fireEvent.click(within(satir(tablo, 1)).getByRole('button', { name: /Akış/ }));
    expect(tablo.querySelector('tr[data-rt-ayrinti]')).toBeNull();
  });

  it('RK2 in-place cipi: kayit isareti; eski kayitta tembel kesif BIR kez', async () => {
    const tablo = await ac();
    expect(within(satir(tablo, 1)).getByText('in-place')).toHaveAttribute('title', expect.stringMatching(/JBoss 8 kurulumunda da var/));
    expect(await within(satir(tablo, 2)).findByText('in-place')).toBeTruthy();
    expect(within(satir(tablo, 3)).queryByText('in-place')).toBeNull();
    expect(api.discover).toHaveBeenCalledTimes(1);
    expect(api.discover).toHaveBeenCalledWith('GBPOSWEBAPI');
  });

  it('RK2b isaret kayitta varsa kesif istenmez', async () => {
    await ac([T1, T3]);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.discover).not.toHaveBeenCalled();
  });

  it('RK3 kesif duserse ekran calisir', async () => {
    api.discover.mockRejectedValue(new TypeError('Failed to fetch'));
    const tablo = await ac();
    await waitFor(() => expect(api.discover).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(satir(tablo, 2)).queryByText('in-place')).toBeNull();
    expect(within(satir(tablo, 1)).getByText('in-place')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Hedefler/ })).toBeTruthy();
  });

  it('RK4 durdurulmus in-place hedef: satir notu ve kontrol listesi', async () => {
    const tablo = await ac([T1, T2, T3, T4]);
    const not = satir(tablo, 1).querySelector('[data-rt-inplace-not]') as HTMLElement;
    expect(not).toHaveTextContent('in-place: diğer kurulumu (JBoss 8) kontrol edin');
    expect(satir(tablo, 3).querySelector('[data-rt-inplace-not]')).toBeNull();
    // Durdurulmus ama in-place OLMAYAN hedefte not yok.
    expect(satir(tablo, 4).querySelector('[data-rt-inplace-not]')).toBeNull();
    fireEvent.click(within(not).getByRole('button', { name: 'kontrol listesi' }));
    const ay = tablo.querySelector('tr[data-rt-ayrinti]') as HTMLElement;
    expect(within(ay).getByRole('tab', { name: 'Akış' })).toHaveAttribute('aria-selected', 'true');
    const liste = ay.querySelector('[data-rt-inplace-kontrol]') as HTMLElement;
    expect(liste.querySelectorAll('li')).toHaveLength(4);
    expect(liste).toHaveTextContent('/vhosting8 altında');
    expect(liste).toHaveTextContent('Server Hub');
  });

  it('RK5 STOP onayinda in-place uyarisi; son onay ACIK', async () => {
    const tablo = await ac();
    fireEvent.click(within(satir(tablo, 2)).getByRole('button', { name: /Sonucu gör ve onayla/ }));
    await waitFor(() => expect(screen.getByText(/STOP bittikten sonra kontrol edin/)).toBeTruthy());
    expect(screen.getByText(/Dikkatli olun: seçili 1 hedef/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Onayla ve durdur' })).toBeEnabled();
  });

  it('RK6 İş çıktısı: yalniz is listesi varsa; sekme, liste ve uc', async () => {
    const tablo = await ac();
    expect(within(satir(tablo, 3)).queryByRole('button', { name: /İş çıktısı/ })).toBeNull();
    fireEvent.click(within(satir(tablo, 1)).getByRole('button', { name: /İş çıktısı/ }));
    const ay = tablo.querySelector('tr[data-rt-ayrinti]') as HTMLElement;
    expect(within(ay).getByRole('tab', { name: 'İş çıktısı' })).toHaveAttribute('aria-selected', 'true');
    const nav = within(ay).getByRole('navigation', { name: 'Bu hedefin AWX işleri' });
    expect(within(nav).getAllByRole('button').map((b) => b.querySelector('span span')?.textContent)).toEqual(['Ön kontrol', 'JBoss STOP']);
    await waitFor(() => expect(api.isCiktisi).toHaveBeenCalledWith(37, 1, 'stop', undefined, expect.any(AbortSignal)));
    expect(await within(ay).findByText('PLAY RECAP')).toBeTruthy();
    // #is no bagi o isi secer.
    fireEvent.click(within(satir(tablo, 2)).getByRole('button', { name: 'AWX iş #600 çıktısını aç' }));
    await waitFor(() => expect(api.isCiktisi).toHaveBeenCalledWith(37, 2, 'onkontrol', undefined, expect.any(AbortSignal)));
  });

  it('RK7 web adimi cipi: o vhost girdisinin isini (webSonuc OZGUN sirasi) acar', async () => {
    const tablo = await ac([T5]);
    const cip = within(satir(tablo, 5)).getByRole('button', { name: /kaldırıldı/ });
    expect(cip).toHaveAttribute('title', expect.stringMatching(/mod-jk\.conf: kaldırıldı · iş #510[\s\S]*iş çıktısını aç/));
    fireEvent.click(cip);
    await waitFor(() => expect(api.isCiktisi).toHaveBeenCalledWith(37, 5, 'web', 1, expect.any(AbortSignal)));
    const nav = within(tablo.querySelector('tr[data-rt-ayrinti]') as HTMLElement).getByRole('navigation', { name: 'Bu hedefin AWX işleri' });
    const secili = within(nav).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'true') as HTMLElement;
    expect(secili).toHaveTextContent('Web: POS.bmw.de');
  });
});

// ── DUSMANCA DENETIM TUR 2: eylem kosullari, is secimi, in-place yerlesimi ─────────────────────────
type Kontrol = NonNullable<RtTarget['silmeOnKontrol']>;
const kontrol = (o: Partial<Kontrol> = {}): Kontrol => ({
  jobId: 900, at: new Date().toISOString(), durum: 'ok', mesaj: 'OK — liste', onkontrol: ['ONKONTROL\tdosya\t/vhosting/A.ear'], kisaltildi: false,
  kaynak: 'elle', kullanici: 'onur', kullanildi: false, hazir: true, izinler: ['onay:sil:x'], ...o,
});
const ws2 = (status: string, jobId: number | null, o: Record<string, unknown> = {}) => ({ host: 'GBJEXW05', serverName: 'pos.bmw.de', product: 'IHS', confFile: 'mod-jk.conf', status, jobId, message: null, ...o });
const isx = (adim: 'onkontrol' | 'stop' | 'web' | 'delete' | 'rollback', jobId: number, durum: 'suruyor' | 'basarili' | 'basarisiz', web?: number) => ({ adim, jobId, durum, basladi: null, bitti: null, ...(web != null ? { web } : {}) });
const WEB5 = [{ host: 'GBJEXW05', serverName: 'pos.bmw.de', product: 'IHS', port: '443', confFile: 'mod-jk.conf' }];
const dugmeler = (el: HTMLElement) => within(el).queryAllByRole('button').map((b) => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim());

describe('Retirement kayit — eylem kosullari (denetim tur 2)', () => {
  it('RK8 eylem matrisi: beklemeyi atla, kayittan cikar, web yeniden dene, silme on kontrolu, silme sirada', async () => {
    const ts = [
      hedef(11, { status: 'stopped', stoppedAt: '2026-10-26T09:00:00Z', deleteNowAt: '2026-10-26T10:00:00Z', silmeOnKontrol: kontrol() }),
      hedef(12, { status: 'stopped', stoppedAt: '2026-10-26T09:00:00Z', silmeOnKontrol: kontrol({ durum: 'running' }), webSonuc: [ws2('failed', 501)] }),
      hedef(13, { status: 'failed', webSonuc: [ws2('failed', 502)] }),
      hedef(14, { status: 'stopped', stoppedAt: '2026-10-26T09:00:00Z', silmeOnKontrol: kontrol() }),
      hedef(15, { status: 'pending' }),
    ];
    const tablo = await ac(ts);
    // Bekleme zaten atlanmis: "beklemeyi atla (admin)" YOK, yerine "silme sırada" yazisi; atlanmamista VAR.
    expect(dugmeler(satir(tablo, 11))).not.toContain('beklemeyi atla (admin)');
    expect(satir(tablo, 11)).toHaveTextContent('silme sırada — yukarıdaki panelde geri sayım');
    expect(dugmeler(satir(tablo, 14))).toContain('beklemeyi atla (admin)');
    expect(satir(tablo, 14)).not.toHaveTextContent('silme sırada — yukarıdaki panelde geri sayım');
    // Silme on kontrolu surerken bag YOK; bitmisse VAR.
    expect(dugmeler(satir(tablo, 12))).not.toContain('silme ön kontrolü');
    expect(dugmeler(satir(tablo, 14))).toContain('silme ön kontrolü');
    // Web adimini yeniden dene yalniz DURDURULMUS hedefte (basarisiz STOP'ta web failed olsa da yok).
    expect(dugmeler(satir(tablo, 12))).toContain('Web adımını yeniden dene');
    expect(dugmeler(satir(tablo, 13))).not.toContain('Web adımını yeniden dene');
    // Kayittan cikar: acik kayitta bekleyen hedefte VAR.
    expect(dugmeler(satir(tablo, 15))).toContain('kayıttan çıkar');
  });

  it('RK8b iptal edilmis kayitta "kayıttan çıkar" ve baslat / onayla yok', async () => {
    api.get.mockResolvedValue({ ok: true, record: { ...kayit([hedef(15, { status: 'pending' }), hedef(16, { status: 'failed' })]), status: 'cancelled' } });
    render(<RetirementTab />);
    fireEvent.click(await screen.findByText('GBPOSWEBAPI'));
    const tablo = await screen.findByRole('table', { name: 'Retirement hedefleri' });
    for (const id of [15, 16]) {
      expect(dugmeler(satir(tablo, id))).not.toContain('kayıttan çıkar');
      expect(dugmeler(satir(tablo, id)).some((x) => /Retirement'ı (yeniden )?başlat/.test(x))).toBe(false);
    }
  });

  it('RK9 "ön kontrolü yenile" STOP penceresini acmaz, on kontrolu yeniden kosar', async () => {
    api.stop.mockResolvedValue({ ok: true, jobId: 777, awxServerId: 1 });
    const tablo = await ac([T2]);
    fireEvent.click(within(satir(tablo, 2)).getByRole('button', { name: 'ön kontrolü yenile' }));
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith(37, 2, false, false));
    expect(screen.queryByRole('button', { name: 'Onayla ve durdur' })).toBeNull();
  });

  it('RK10 is baslatilirken satir eylemleri (Durumu tazele dahil) kapali', async () => {
    api.stop.mockReturnValue(new Promise(() => {}));
    const tablo = await ac([hedef(15, { status: 'pending' }), hedef(17, { status: 'stopping', lastJobId: 520 })]);
    const tazele = within(satir(tablo, 17)).getByRole('button', { name: 'Durumu tazele' });
    expect(tazele).toBeEnabled();
    fireEvent.click(within(satir(tablo, 15)).getByRole('button', { name: /Retirement'ı başlat/ }));
    await waitFor(() => expect(tazele).toBeDisabled());
  });

  it('RK11 iptal penceresinde "geri aktif et" secenegi; toplu onayda karisik ortam kapisi', async () => {
    const p1 = hedef(21, { status: 'planned', env: 'TEST', stopIzin: { jobId: 601, at: null, izinler: ['onay:stop'] } });
    const p2 = hedef(22, { status: 'planned', env: 'QA', stopIzin: { jobId: 602, at: null, izinler: ['onay:stop'] } });
    const p3 = hedef(23, { status: 'planned', env: 'TEST', stopIzin: { jobId: 603, at: null, izinler: ['onay:stop'] } });
    const tablo = await ac([p1, p2, p3, T1]);
    const sec = (id: number) => fireEvent.click(within(satir(tablo, id)).getByRole('checkbox'));
    sec(21); sec(22);
    expect(screen.getByRole('button', { name: /Seçilenleri gör ve onayla \(2\)/ })).toBeDisabled();
    expect(screen.getByText(/Farklı ortamlar birlikte çalıştırılamaz/)).toBeTruthy();
    sec(22); sec(23);
    expect(screen.getByRole('button', { name: /Seçilenleri gör ve onayla \(2\)/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Kaydı iptal et/ }));
    expect(await screen.findByRole('button', { name: 'İptal et ve 1 uygulamayı geri aktif et' })).toBeTruthy();
  });

  it('RK12 web adimi cipi en KOTU girdiyi gosterir (×n)', async () => {
    const t = hedef(31, { status: 'stopped', stoppedAt: '2026-10-26T09:00:00Z', web: WEB5, webSonuc: [ws2('ok', 510), ws2('failed', 511, { confFile: 'httpd.conf' })],
      awxIsleri: [isx('web', 510, 'basarili', 0), isx('web', 511, 'basarisiz', 1)] });
    const tablo = await ac([t]);
    const cip = within(satir(tablo, 31)).getByRole('button', { name: /Web adımı: BAŞARISIZ ×2 — iş çıktısını aç/ });
    fireEvent.click(cip);
    await waitFor(() => expect(api.isCiktisi).toHaveBeenCalledWith(37, 31, 'web', 1, expect.any(AbortSignal)));
  });

  it('RK13 #is no ve "Canlı çıktıyı izle" KENDI isini secer; liste disi iste giris yok', async () => {
    // Varsayilan secim (suren ilk is) web isi olurdu: ipucu kaybolursa yanlis is acilir.
    const durmus = hedef(41, { status: 'stopped', stoppedAt: '2026-10-26T09:00:00Z', lastJobId: 500, web: WEB5, webSonuc: [ws2('running', 510)],
      awxIsleri: [isx('onkontrol', 400, 'basarili'), isx('stop', 500, 'basarili'), isx('web', 510, 'suruyor', 0)] });
    const geri = hedef(42, { status: 'rolling_back', rollbackJobId: 700, lastJobId: 500, web: WEB5, webSonuc: [ws2('restoring', 900)],
      awxIsleri: [isx('stop', 500, 'basarili'), isx('web', 900, 'suruyor', 0), isx('rollback', 700, 'suruyor')] });
    // STOP suruyor ama STOP isi listede yok (siniflandirilamadi): bitmis on kontrol acilmamali.
    const kayip = hedef(43, { status: 'stopping', lastJobId: 530, awxIsleri: [isx('onkontrol', 430, 'basarili')], awxIsleriEksik: true });
    const tablo = await ac([durmus, geri, kayip]);
    fireEvent.click(within(satir(tablo, 41)).getByRole('button', { name: 'AWX iş #500 çıktısını aç' }));
    await waitFor(() => expect(api.isCiktisi).toHaveBeenLastCalledWith(37, 41, 'stop', undefined, expect.any(AbortSignal)));
    fireEvent.click(within(satir(tablo, 42)).getByRole('button', { name: /Canlı çıktıyı izle/ }));
    await waitFor(() => expect(api.isCiktisi).toHaveBeenLastCalledWith(37, 42, 'rollback', undefined, expect.any(AbortSignal)));
    expect(within(satir(tablo, 43)).queryByRole('button', { name: /Canlı çıktıyı izle/ })).toBeNull();
    expect(within(satir(tablo, 43)).queryByRole('button', { name: /#530/ })).toBeNull();
    expect(satir(tablo, 43)).toHaveTextContent('#530');
    // Liste yine acilabilir (genel "İş çıktısı" dugmesi).
    expect(within(satir(tablo, 43)).getByRole('button', { name: /İş çıktısı/ })).toBeTruthy();
  });

  it('RK14 in-place cipi ust satirda; uygulama adi tam genislik; diger kurulum kayittaysa / silindiyse not', async () => {
    const j7 = hedef(51, { host: 'GBJBAT03', gen: 7, status: 'stopped', stoppedAt: '2026-10-26T09:00:00Z', inPlace: true, digerSurumler: [8] });
    const j8 = hedef(52, { host: 'GBJBAT03', gen: 8, status: 'stopping', lastJobId: 560, inPlace: true, digerSurumler: [7] });
    const sil = hedef(53, { host: 'GBJBAT04', status: 'deleted', deletedAt: '2026-10-25T10:00:00Z', inPlace: true, digerSurumler: [8] });
    const tablo = await ac([j7, j8, sil]);
    const cip = within(satir(tablo, 51)).getByText('in-place');
    const ortam = satir(tablo, 51).querySelector('[data-rt-ortam]') as HTMLElement;
    expect(cip.parentElement).toBe(ortam.parentElement);
    const ad = satir(tablo, 51).querySelector('[data-rt-uygulama]') as HTMLElement;
    expect(ad).toHaveTextContent('GBPOSWEBAPI');
    expect(ad).not.toContainElement(cip);
    expect(satir(tablo, 51).querySelector('[data-rt-inplace-not]')).toHaveTextContent('in-place: diğer kurulum (JBoss 8) da bu kayıtta hedef — onun satırını izleyin');
    expect(satir(tablo, 52).querySelector('[data-rt-inplace-not]')).toHaveTextContent('diğer kurulum (JBoss 7) da bu kayıtta hedef');
    expect(satir(tablo, 53).querySelector('[data-rt-inplace-not]')).toHaveTextContent('in-place: silindi — diğer kurulumu (JBoss 8) kontrol edin');
  });

  it('RK15 erisilebilirlik: Olaylar baslik, Akis oku okunmaz, yukleniyor metni', async () => {
    api.get.mockReturnValueOnce(new Promise(() => {}));
    render(<RetirementTab />);
    fireEvent.click(await screen.findByText('GBPOSWEBAPI'));
    expect(await screen.findByText('Kayıt yükleniyor…')).toHaveClass('sr-only');
    cleanup();
    const tablo = await ac([T1]);
    expect(screen.getByRole('heading', { name: 'Olaylar' })).toBeTruthy();
    const akis = within(satir(tablo, 1)).getByRole('button', { name: /Akış/ });
    expect(akis.querySelector('[aria-hidden]')?.textContent).toBe('▾');
  });
});
