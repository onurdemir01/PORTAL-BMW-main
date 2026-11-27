// @vitest-environment jsdom
// Retirement KAYIT PENCERESI EYLEMLERI (2026-11-27, kapsam PR-2; RetirementTab dal %35): onceki testler dugmelerin
// VAR / YOK oldugunu sinar; burada her dugme gercekten tiklanir ve sonucu sinanir. API sahte; is izleyicisine verilen
// `fetchStatus` islevleri testte elle cagrilir (AWX isinin bitisi).
//   RE1  on kontrol: trafik / vhost plani / ana is izlenir; bitince STOP onayi KENDILIGINDEN acilir; trafik olcumu
//        surerken onay kilitli; onay -> STOP isi, SCC uyarisi
//   RE2  toplu on kontrol: tek is, her hedef kendi sonucu; dusen hedef soylenir, pencere yalniz hazir olana acilir
//   RE3  PROD: OCO penceresine zamanlama, "Şimdi çalıştır", red ve istisna
//   RE4  geri al: on kontrol -> onay penceresi kendiliginden; onay listenin is numarasiyla gider; vhost geri acma
//   RE5  geri al on kontrolu basarisiz / hedef artik geri alinamaz / red; vhost geri acilamadi
//   RE6  kaydi iptal: yalniz iptal ve iptal + geri al (hepsi / bir kismi / hicbiri basladi)
//   RE7  beklemeyi atla: toplu ve hedef basina; uygulama adi yazilmadan dugme kapali
//   RE8  web adimini yeniden dene: onizleme plani, onay; is basladi / kuyrukta / baslatilamadi
//   RE9  durumu tazele: degisti / degismedi / red; job ID yok -> uzlastirma penceresi
//   RE10 silme on kontrolu: is bitince liste penceresi; red ve istisna
//   RE11 not ekle, kayittan cikar, ESC yalniz ustteki katmani kapatir
//   RE12 web kesfini yenile: onizleme, kayda yazma, red ve istisna
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RtOnKontrolKaydi, RtRecord, RtTarget } from '@/api/retirementApi';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  config: vi.fn(),
  get: vi.fn(),
  canli: vi.fn(),
  discover: vi.fn(),
  dnsIp: vi.fn(),
  isCiktisi: vi.fn(),
  apps: vi.fn(),
  stop: vi.fn(),
  stopToplu: vi.fn(),
  jobStatus: vi.fn(),
  rollback: vi.fn(),
  cancel: vi.fn(),
  deleteNow: vi.fn(),
  deleteNowTarget: vi.fn(),
  webRetryPlan: vi.fn(),
  webRetry: vi.fn(),
  refreshStatus: vi.fn(),
  reconcileJob: vi.fn(),
  deletePlan: vi.fn(),
  note: vi.fn(),
  cikar: vi.fn(),
  webKesif: vi.fn(),
}));
const izle = vi.hoisted(() => ({ addJob: vi.fn() }));
const toastM = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/api/retirementApi', () => ({ retirementApi: api }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => izle }));
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));
import RetirementTab from '@/components/server_hub/RetirementTab';

const WEB = {
  host: 'ORJEXW01',
  serverName: 'pos.ornek.invalid',
  product: 'IHS',
  port: '443',
  confFile: 'mod-jk.conf',
};
const hedef = (id: number, o: Partial<RtTarget> = {}): RtTarget => ({
  id,
  recordId: 37,
  host: `ORJEXP0${id}`,
  site: 'Pendik',
  env: 'TEST',
  appName: 'ORPOSWEBAPI',
  gen: 7,
  appPath: '/vhosting/ORPOSWEBAPI.ear',
  web: [],
  status: 'pending',
  planText: null,
  resultText: null,
  lastJobId: null,
  deleteJobId: null,
  stoppedAt: null,
  updatedAt: '2026-11-26T10:00:00Z',
  deletedAt: null,
  rolledBackAt: null,
  rollbackJobId: null,
  scheduledAt: null,
  windowEnd: null,
  webSonuc: null,
  detail: null,
  awxIsleri: [],
  inPlace: false,
  digerSurumler: [],
  ...o,
});
const kayit = (targets: RtTarget[], o: Partial<RtRecord> = {}): RtRecord => ({
  id: 37,
  app: 'ORPOSWEBAPI',
  smartNo: '364244',
  ocoNo: null,
  ownerEmail: null,
  requestedBy: 'onur',
  status: 'open',
  deleteAfterDays: 45,
  plannedDeleteAt: null,
  stopAt: null,
  dnsReuse: false,
  lbReuse: false,
  sccNotifiedAt: null,
  notes: null,
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-26T10:00:00Z',
  effectiveDeleteAt: '2027-01-10',
  targets,
  events: [],
  ...o,
});
const izin = { jobId: 700, at: null, izinler: ['onay:stop'] };
const durdu = { status: 'stopped', stoppedAt: '2026-11-26T09:00:00Z' } as const;
const ok = (o: Partial<RtOnKontrolKaydi> = {}): RtOnKontrolKaydi => ({
  jobId: 1000,
  at: new Date().toISOString(),
  durum: 'ok',
  mesaj: 'geri alma hazır',
  onkontrol: [],
  kisaltildi: false,
  kaynak: 'awx',
  kullanici: 'onur',
  kullanildi: false,
  hazir: true,
  izinler: ['onay:geri-al:1000'],
  ...o,
});
const wsOk = (status: string, jobId: number | null) => ({
  host: 'ORJEXW01',
  serverName: 'pos.ornek.invalid',
  product: 'IHS',
  confFile: 'mod-jk.conf',
  status,
  jobId,
  message: null,
});
const KESIF = { ok: true, base: 'ORPOSWEBAPI', summary: {}, targets: [] };

// Sunucunun bugunku kaydi: her `get` / yeniden yukleme bunu okur (testler eylemler arasinda degistirir).
let hedefler: RtTarget[] = [];
let kayitEk: Partial<RtRecord> = {};

async function ac(ts: RtTarget[], ek: Partial<RtRecord> = {}) {
  hedefler = ts;
  kayitEk = ek;
  render(<RetirementTab />);
  fireEvent.click(await screen.findByText('ORPOSWEBAPI'));
  return screen.findByRole('table', { name: 'Retirement hedefleri' });
}
const satir = (tablo: HTMLElement, id: number) =>
  tablo.querySelector(`tr[data-tid="${id}"]`) as HTMLTableRowElement;
const dugme = (el: HTMLElement, ad: RegExp | string) =>
  within(el).getByRole('button', { name: ad });
/** Is izleyicisine verilen isin `fetchStatus`'u (basliga gore; ayni baslik birden fazlaysa sonuncusu). */
const isDurumu = (baslik: string) => {
  const c = izle.addJob.mock.calls.filter((x) => String(x[0].title).startsWith(baslik)).pop();
  if (!c) throw new Error(`is yok: ${baslik}`);
  return c[0].fetchStatus as () => Promise<unknown>;
};
/** ESC yalniz ustteki onay katmanini kapatir; kayit penceresi (hedef tablosu) acik kalir. */
const escIleKapanir = (ad: string) => {
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: ad })).toBeNull();
  expect(screen.getByRole('table', { name: 'Retirement hedefleri' })).toBeTruthy();
};
const basliklar = () => izle.addJob.mock.calls.map((c) => c[0].title as string);
const bitir = async (baslik: string, s: Record<string, unknown> = {}) => {
  api.jobStatus.mockResolvedValueOnce({
    ok: true,
    status: 'successful',
    output: 'PLAY RECAP',
    ...s,
  });
  let r: unknown;
  await act(async () => {
    r = await isDurumu(baslik)();
  });
  return r;
};

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({
    ok: true,
    records: [{ ...kayit([]), targets: 1, stopped: 0, envs: [] }],
  });
  api.config.mockResolvedValue({
    ok: true,
    defaultDays: 45,
    sccMailConfigured: false,
    sccMailTo: null,
    smartFlows: {},
    pollSeconds: 300,
  });
  api.get.mockImplementation(async () => ({ ok: true, record: kayit(hedefler, kayitEk) }));
  api.canli.mockResolvedValue({ ok: false });
  api.dnsIp.mockResolvedValue({ ok: true, dns: [], vip: [], vhostIp: [] });
  api.discover.mockResolvedValue(KESIF);
  api.isCiktisi.mockResolvedValue({ ok: false, message: 'iş yok' });
});
afterEach(cleanup);

describe('Retirement kayıt penceresi: STOP akışı', () => {
  it('RE1 ön kontrol izlenir, bitince onay penceresi kendiliğinden açılır; trafik ölçülürken onay kilitli', async () => {
    const tablo = await ac([hedef(1, { web: [WEB] })]);
    api.stop.mockResolvedValueOnce({
      ok: true,
      jobId: 700,
      status: 'pending',
      awxServerId: 3,
      trafikTarama: { ok: true, jobId: 701, awxServerId: 3, hosts: ['ORJEXW01'] },
      vhostPlan: [
        { ...WEB, ok: true, jobId: 702, awxServerId: 3 },
        {
          host: 'ORJEXW02',
          serverName: 'elle.ornek.invalid',
          confFile: '',
          ok: false,
          elle: true,
          message: 'NGINX: otomatik kapatma yok',
        },
      ],
    });
    // Sunucu on kontrolu baslatinca hedef 'planning' olur.
    hedefler = [hedef(1, { web: [WEB], status: 'planning' })];
    fireEvent.click(dugme(satir(tablo, 1), /Retirement'ı başlat/));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'Ön kontrol başladı (#700) — bitince onay penceresi açılacak.',
      ),
    );
    expect(api.stop).toHaveBeenCalledWith(37, 1, false, false);
    expect(basliklar()).toEqual([
      'Retirement: trafik ölçümü ORPOSWEBAPI (ORJEXW01)',
      'Retirement: vhost planı pos.ornek.invalid @ ORJEXW01',
      'Retirement: ön kontrol ORPOSWEBAPI @ ORJEXP01',
    ]);
    expect(screen.queryByRole('dialog', { name: 'STOP onayı' })).toBeNull();

    // Durum okunamadi: is izleyicisine hata; surmekte olan is: yalniz durum doner.
    api.jobStatus.mockResolvedValueOnce({
      ok: false,
      status: '',
      output: '',
      message: 'AWX kapalı',
    });
    await expect(isDurumu('Retirement: ön kontrol')()).rejects.toThrow('AWX kapalı');
    api.jobStatus.mockResolvedValueOnce({ ok: true, status: 'running', output: 'TASK' });
    expect(await isDurumu('Retirement: ön kontrol')()).toEqual({
      status: 'running',
      output: 'TASK',
      result: undefined,
    });
    expect(screen.queryByRole('dialog', { name: 'STOP onayı' })).toBeNull();

    // On kontrol bitti: kayit yeniden okunur, hedef hazir -> pencere kendiliginden.
    hedefler = [hedef(1, { web: [WEB], status: 'planned', planText: 'PLAN', stopIzin: izin })];
    await bitir('Retirement: ön kontrol');
    expect(api.jobStatus).toHaveBeenLastCalledWith(37, 1, 3, 700);
    const pencere = await screen.findByRole('dialog', { name: 'STOP onayı' });
    expect(pencere).toHaveTextContent('plan okunuyor… (server_hub_fix #702)');
    // Otomatik kapatilamayan (NGINX) vhost ayri listede: is baslatilmadi, sebep yazili.
    expect(pencere).toHaveTextContent(
      'Otomatik kapatılmayacak — dokunulmaz, gerekirse elle kontrol edinelle.ornek.invalid @ ORJEXW02 · ?NGINX: otomatik kapatma yok',
    );
    expect(pencere).toHaveTextContent('ölçülüyor… (Server Hub taraması #701)');
    const onay = dugme(pencere, 'Onayla ve durdur');
    expect(onay).toBeDisabled();

    // Vhost plani bitti: kapatilacak blogun sonucu pencerede.
    await bitir('Retirement: vhost planı', {
      fixResult: { line: 'RESULT\tORJEXW01\tPLAN\t1 blok kapatılacak', blok: [] },
    });
    expect(api.jobStatus).toHaveBeenLastCalledWith(37, 1, 3, 702);
    expect(pencere).toHaveTextContent('1 blok kapatılacak');
    expect(pencere).not.toHaveTextContent('plan okunuyor');
    // PLAN sonucu hazir blok sayilir, "başarısız" DEGIL.
    expect(pencere).not.toHaveTextContent('PLAN BAŞARISIZ');

    // Trafik taramasi dustu: son tarama verisiyle devam; kesif yeniden okunur ve onay acilir.
    const kesifOnce = api.discover.mock.calls.length;
    await bitir('Retirement: trafik ölçümü', { status: 'failed' });
    expect(pencere).toHaveTextContent('TAZELENEMEDİ, son tarama verisi');
    expect(pencere).toHaveTextContent('Server Hub taraması failed');
    await waitFor(() => expect(api.discover.mock.calls.length).toBe(kesifOnce + 1));
    expect(onay).toBeEnabled();

    api.stop.mockResolvedValueOnce({
      ok: true,
      jobId: 800,
      status: 'pending',
      awxServerId: 3,
      sccWarning: 'SCC e-postası gönderilemedi',
    });
    fireEvent.click(onay);
    await waitFor(() => expect(toastM.success).toHaveBeenCalledWith('STOP işi başladı (#800).'));
    expect(api.stop).toHaveBeenLastCalledWith(37, 1, true, false);
    expect(toastM.error).toHaveBeenCalledWith('SCC e-postası gönderilemedi');
    expect(basliklar().at(-1)).toBe('Retirement: STOP ORPOSWEBAPI @ ORJEXP01');
    expect(screen.queryByRole('dialog', { name: 'STOP onayı' })).toBeNull();
  });

  it('RE2 toplu ön kontrol tek işte; düşen hedef söylenir, pencere yalnız hazır olana açılır', async () => {
    const tablo = await ac([hedef(1, { web: [WEB] }), hedef(2)]);
    fireEvent.click(screen.getByRole('button', { name: 'tüm TEST hedeflerini seç' }));
    api.stopToplu.mockResolvedValueOnce({
      ok: true,
      jobId: 900,
      status: 'pending',
      awxServerId: 3,
      trafikTarama: { ok: false, hosts: [], message: 'Server Hub şablonu yok' },
      vhostPlanlar: {
        1: null,
        2: [{ ...WEB, host: 'ORJEXW02', ok: false, message: 'conf okunamadı' }],
      },
    });
    hedefler = [hedef(1, { web: [WEB], status: 'planning' }), hedef(2, { status: 'planning' })];
    fireEvent.click(screen.getByRole('button', { name: /Seçilenlerde Retirement’ı başlat \(2\)/ }));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'Ön kontrol başladı (#900) — 2 sunucu tek işte — bitince onay penceresi açılacak.',
      ),
    );
    expect(api.stopToplu).toHaveBeenCalledWith(37, [1, 2], false, false);
    // Plani dusen vhost'un isi yok; trafik taramasi baslamadi: yalniz ana is izlenir.
    expect(basliklar()).toEqual(['Retirement: ön kontrol ORPOSWEBAPI @ ORJEXP01, ORJEXP02']);
    expect(satir(tablo, 1)).toBeTruthy();

    hedefler = [
      hedef(1, { web: [WEB], status: 'planned', stopIzin: izin }),
      hedef(2, { status: 'failed', resultText: 'FAIL — paket kilitli' }),
    ];
    // Ikinci hedefin kendi sonucu (ayni is) varsayilan yanittan okunur.
    api.jobStatus.mockResolvedValue({ ok: true, status: 'successful', output: '' });
    await bitir('Retirement: ön kontrol');
    // Ayni is, her hedef kendi sonucuyla: ikinci hedefin durumu da okunur.
    expect(api.jobStatus.mock.calls).toEqual([
      [37, 1, 3, 900],
      [37, 2, 3, 900],
    ]);
    const pencere = await screen.findByRole('dialog', { name: 'STOP onayı' });
    expect(toastM.error).toHaveBeenCalledWith(
      'ORPOSWEBAPI @ ORJEXP02: ön kontrol başarısız — FAIL — paket kilitli',
    );
    expect(pencere).toHaveTextContent('ORJEXP01');
    expect(pencere).not.toHaveTextContent('ORJEXP02');
    // Trafik taramasi baslatilamadi: sebep pencerede, onay kilitli DEGIL (on kontrol dusmez).
    expect(pencere).toHaveTextContent('Server Hub şablonu yok');
    expect(dugme(pencere, 'Onayla ve durdur')).toBeEnabled();
  });

  it('RE3 PROD: OCO penceresine zamanlama, şimdi çalıştır, red ve istisna', async () => {
    const tablo = await ac([hedef(1, { env: 'PROD', status: 'planned', stopIzin: izin })], {
      ocoNo: 'CHG-1',
    });
    const pencereyiAc = () => {
      fireEvent.click(dugme(satir(tablo, 1), /Sonucu gör ve onayla/));
      return screen.findByRole('dialog', { name: 'STOP onayı' });
    };
    await pencereyiAc();
    escIleKapanir('STOP onayı');
    expect(api.stop).not.toHaveBeenCalled();
    let pencere = await pencereyiAc();
    api.stop.mockResolvedValueOnce({
      ok: true,
      scheduled: true,
      runAtText: '28.11.2026 22:00',
      jobId: null,
      status: null,
      awxServerId: 3,
    });
    fireEvent.click(dugme(pencere, 'Onayla ve OCO penceresine zamanla'));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'STOP OCO penceresine zamanlandı: 28.11.2026 22:00.',
      ),
    );
    expect(api.stop).toHaveBeenLastCalledWith(37, 1, true, false);
    // Zamanlandi: is BASLAMADI, izlenecek is yok.
    expect(izle.addJob).not.toHaveBeenCalled();

    pencere = await pencereyiAc();
    fireEvent.click(within(pencere).getByRole('radio', { name: /Şimdi çalıştır/ }));
    api.stop.mockResolvedValueOnce({ ok: false, message: 'OCO penceresi kapandı' });
    fireEvent.click(dugme(pencere, 'Onayla ve durdur'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('OCO penceresi kapandı'));
    expect(api.stop).toHaveBeenLastCalledWith(37, 1, true, true);

    // Pencere her acilista varsayilana (OCO) doner.
    pencere = await pencereyiAc();
    expect(within(pencere).getByRole('radio', { name: /OCO penceresine zamanla/ })).toBeChecked();
    api.stop.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(dugme(pencere, 'Onayla ve OCO penceresine zamanla'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Failed to fetch'));
    // Hata sonrasi eylemler yeniden acik.
    expect(dugme(satir(tablo, 1), /Sonucu gör ve onayla/)).toBeEnabled();
  });
});

describe('Retirement kayıt penceresi: geri al ve iptal', () => {
  it('RE4 geri al: ön kontrol bitince onay penceresi açılır; onay listenin iş numarasıyla gider', async () => {
    const tablo = await ac([hedef(1, { ...durdu, webSonuc: [wsOk('ok', 510)] })]);
    api.rollback.mockResolvedValueOnce({
      ok: true,
      jobId: 1000,
      status: 'pending',
      awxServerId: 3,
    });
    hedefler = [
      hedef(1, {
        ...durdu,
        webSonuc: [wsOk('ok', 510)],
        geriAlOnKontrol: ok({ durum: 'running', hazir: false, izinler: [] }),
      }),
    ];
    fireEvent.click(dugme(satir(tablo, 1), /Geri aktif et/));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'ORPOSWEBAPI @ ORJEXP01: geri alma ön kontrolü başladı (#1000) — bitince onay penceresi açılacak.',
      ),
    );
    expect(api.rollback).toHaveBeenCalledWith(37, 1, false, null);
    expect(basliklar()).toEqual(['Retirement: geri alma ön kontrolü ORPOSWEBAPI @ ORJEXP01']);
    await waitFor(() =>
      expect(satir(tablo, 1)).toHaveTextContent('geri alma ön kontrolü sürüyor…'),
    );
    expect(screen.queryByRole('dialog', { name: 'Geri aktif et' })).toBeNull();

    hedefler = [hedef(1, { ...durdu, webSonuc: [wsOk('ok', 510)], geriAlOnKontrol: ok() })];
    await bitir('Retirement: geri alma ön kontrolü');
    const pencere = await screen.findByRole('dialog', { name: 'Geri aktif et' });
    expect(pencere).toHaveTextContent('Ön kontrol sonucu: geri alma hazır');
    expect(pencere).toHaveTextContent('iş #1000');
    expect(pencere).toHaveTextContent("STOP'ta kaldırılan 1 vhost geri açılır");

    api.rollback.mockResolvedValueOnce({
      ok: true,
      jobId: 1001,
      status: 'pending',
      awxServerId: 3,
      web: { denendi: 1, atlanan: 0, hata: 0, notlar: [] },
    });
    fireEvent.click(dugme(pencere, 'Onayla ve geri aktif et'));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith('1 vhost geri açma işi başlatıldı.'),
    );
    expect(api.rollback).toHaveBeenLastCalledWith(37, 1, true, 1000);
    expect(toastM.success).toHaveBeenCalledWith('Geri alma işi başladı (#1001).');
    expect(basliklar().at(-1)).toBe('Retirement: GERİ AL ORPOSWEBAPI @ ORJEXP01');
    expect(screen.queryByRole('dialog', { name: 'Geri aktif et' })).toBeNull();
    const getOnce = api.get.mock.calls.length;
    await bitir('Retirement: GERİ AL');
    expect(api.get.mock.calls.length).toBe(getOnce + 1);
  });

  it('RE5 geri alma ön kontrolü başarısız, hedef artık geri alınamaz, red; vhost geri açılamadı', async () => {
    const tablo = await ac([
      hedef(1, durdu),
      hedef(2, durdu),
      hedef(3, { ...durdu, geriAlOnKontrol: ok({ jobId: 1003, izinler: ['onay:geri-al:1003'] }) }),
    ]);
    const hedef3 = hedefler[2];
    // 1: on kontrol basarisiz biter -> sebep, pencere YOK.
    api.rollback.mockResolvedValueOnce({
      ok: true,
      jobId: 1000,
      status: 'pending',
      awxServerId: 3,
    });
    fireEvent.click(dugme(satir(tablo, 1), /Geri aktif et/));
    await waitFor(() => expect(api.rollback).toHaveBeenCalledTimes(1));
    // 2: on kontrolu bitmeden hedef silindi -> "artik geri alinamaz".
    api.rollback.mockResolvedValueOnce({
      ok: true,
      jobId: 1002,
      status: 'pending',
      awxServerId: 3,
    });
    await waitFor(() => expect(dugme(satir(tablo, 2), /Geri aktif et/)).toBeEnabled());
    fireEvent.click(dugme(satir(tablo, 2), /Geri aktif et/));
    await waitFor(() => expect(api.rollback).toHaveBeenCalledTimes(2));
    hedefler = [
      hedef(1, {
        ...durdu,
        geriAlOnKontrol: ok({ durum: 'failed', hazir: false, izinler: [], mesaj: 'paket yok' }),
      }),
      hedef(2, {
        status: 'deleted',
        deletedAt: '2026-11-26T11:00:00Z',
        geriAlOnKontrol: ok({ jobId: 1002 }),
      }),
      hedef3,
    ];
    await bitir('Retirement: geri alma ön kontrolü ORPOSWEBAPI @ ORJEXP01');
    await waitFor(() =>
      expect(toastM.error).toHaveBeenCalledWith(
        'ORPOSWEBAPI @ ORJEXP01: geri alma ön kontrolü başarısız — paket yok',
      ),
    );
    expect(toastM.error).toHaveBeenCalledWith(
      'ORPOSWEBAPI @ ORJEXP02: hedef artık geri alınabilir durumda değil (deleted) — onay penceresi açılmadı.',
    );
    expect(screen.queryByRole('dialog', { name: 'Geri aktif et' })).toBeNull();

    // Red ve istisna: is izlenmez.
    const isSayisi = izle.addJob.mock.calls.length;
    api.rollback.mockResolvedValueOnce({ ok: false, message: 'Hedef kilitli' });
    fireEvent.click(dugme(satir(tablo, 1), /Geri aktif et/));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Hedef kilitli'));
    api.rollback.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(dugme(satir(tablo, 1), /Geri aktif et/));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('ağ yok'));
    expect(izle.addJob.mock.calls.length).toBe(isSayisi);

    // 3: hazir on kontrolun penceresi elle acilir; vhost'lar geri acilamazsa soylenir.
    fireEvent.click(dugme(satir(tablo, 3), 'onay penceresini aç'));
    await screen.findByRole('dialog', { name: 'Geri aktif et' });
    escIleKapanir('Geri aktif et');
    fireEvent.click(dugme(satir(tablo, 3), 'onay penceresini aç'));
    const pencere = await screen.findByRole('dialog', { name: 'Geri aktif et' });
    api.rollback.mockResolvedValueOnce({
      ok: true,
      jobId: 1004,
      status: 'pending',
      awxServerId: 3,
      web: { denendi: 0, atlanan: 0, hata: 2, notlar: [] },
    });
    fireEvent.click(dugme(pencere, 'Onayla ve geri aktif et'));
    await waitFor(() =>
      expect(toastM.error).toHaveBeenCalledWith(
        '2 vhost geri açılamadı — Olaylar listesine bakın.',
      ),
    );
    expect(api.rollback).toHaveBeenLastCalledWith(37, 3, true, 1003);
  });

  it('RE6 kaydı iptal: yalnız iptal; iptal + geri al hepsi / bir kısmı / hiçbiri başladı', async () => {
    const durdurulmuslar = () => [
      hedef(1, durdu),
      hedef(2, { status: 'rollback_failed' }),
      hedef(3),
    ];
    const iptalAc = async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Kaydı iptal et/ }));
      return screen.findByRole('dialog', { name: 'Kaydı iptal et' });
    };
    api.cancel.mockImplementation(async () => ({
      ok: true,
      record: kayit(hedefler, { status: 'cancelled' }),
    }));

    await ac(durdurulmuslar());
    fireEvent.click(dugme(await iptalAc(), 'Yalnız kaydı iptal et'));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'Kayıt iptal edildi. 2 uygulama DURDURULMUŞ halde kaldı — geri getirmek için "Geri aktif et".',
      ),
    );
    expect(api.cancel).toHaveBeenCalledWith(37, 'kullanıcı iptal etti');
    expect(api.rollback).not.toHaveBeenCalled();
    // Iptal edilmis kayitta iptal dugmesi yok.
    expect(screen.queryByRole('button', { name: /Kaydı iptal et/ })).toBeNull();

    const durumlar: [boolean[], 'success' | 'error', string][] = [
      [
        [true, true],
        'success',
        'Kayıt iptal edildi. 2 hedef için geri alma ön kontrolü başladı — her biri bitince onay penceresi açılır.',
      ],
      [
        [true, false],
        'error',
        'Kayıt iptal edildi. 1/2 hedef için geri alma ön kontrolü başladı; diğerleri başlatılamadı (yukarıdaki hatalar) — onlar DURDURULMUŞ kaldı.',
      ],
      [
        [false, false],
        'error',
        'Kayıt iptal edildi ama hiçbir hedef için geri alma ön kontrolü başlatılamadı — uygulamalar DURDURULMUŞ kaldı.',
      ],
    ];
    for (const [sonuclar, tur, metin] of durumlar) {
      cleanup();
      vi.clearAllMocks();
      for (const [i, b] of sonuclar.entries())
        api.rollback.mockResolvedValueOnce(
          b
            ? { ok: true, jobId: 1100 + i, status: 'pending', awxServerId: 3 }
            : { ok: false, message: `hedef ${i + 1} kilitli` },
        );
      await ac(durdurulmuslar());
      fireEvent.click(dugme(await iptalAc(), 'İptal et ve 2 uygulamayı geri aktif et'));
      await waitFor(() => expect(toastM[tur]).toHaveBeenCalledWith(metin));
      // Durdurulmus hedefler sirayla, geri alma ON KONTROLU olarak (onaysiz).
      expect(api.rollback.mock.calls).toEqual([
        [37, 1, false, null],
        [37, 2, false, null],
      ]);
    }

    // Iptal reddedildi: geri alma baslamaz.
    cleanup();
    vi.clearAllMocks();
    api.cancel.mockResolvedValueOnce({ ok: false, message: 'Kayıt kilitli' });
    await ac([hedef(3)]);
    await iptalAc();
    escIleKapanir('Kaydı iptal et');
    expect(api.cancel).not.toHaveBeenCalled();
    const pencere = await iptalAc();
    expect(within(pencere).queryByRole('button', { name: /geri aktif et/ })).toBeNull();
    fireEvent.click(dugme(pencere, 'Yalnız kaydı iptal et'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Kayıt kilitli'));
    api.cancel.mockResolvedValueOnce({
      ok: true,
      record: kayit([hedef(3)], { status: 'cancelled' }),
    });
    fireEvent.click(dugme(await iptalAc(), 'Yalnız kaydı iptal et'));
    await waitFor(() => expect(toastM.success).toHaveBeenCalledWith('Kayıt iptal edildi.'));
  });
});

describe('Retirement kayıt penceresi: silme, web ve bakım eylemleri', () => {
  it('RE7 beklemeyi atla: toplu ve hedef başına; uygulama adı yazılmadan düğme kapalı', async () => {
    const tablo = await ac([hedef(1, durdu), hedef(2, durdu)]);
    fireEvent.click(screen.getByRole('button', { name: 'beklemeyi atla — tümü (admin)' }));
    await screen.findByRole('dialog', { name: 'Beklemeyi atla (tüm hedefler)' });
    escIleKapanir('Beklemeyi atla (tüm hedefler)');
    fireEvent.click(screen.getByRole('button', { name: 'beklemeyi atla — tümü (admin)' }));
    let pencere = await screen.findByRole('dialog', { name: 'Beklemeyi atla (tüm hedefler)' });
    const toplu = dugme(pencere, 'Tüm hedeflerin beklemesini atla');
    expect(toplu).toBeDisabled();
    fireEvent.change(within(pencere).getByRole('textbox'), { target: { value: 'ORPOSWEB' } });
    expect(toplu).toBeDisabled();
    fireEvent.change(within(pencere).getByRole('textbox'), { target: { value: ' ORPOSWEBAPI ' } });
    expect(toplu).toBeEnabled();
    api.deleteNow.mockResolvedValueOnce({ ok: false, message: 'Admin değil' });
    fireEvent.click(toplu);
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Admin değil'));
    // Red: pencere acik kalir.
    expect(screen.getByRole('dialog', { name: 'Beklemeyi atla (tüm hedefler)' })).toBeTruthy();
    api.deleteNow.mockResolvedValueOnce({ ok: true, hedefSayisi: 2, pollSaniye: 90 });
    fireEvent.click(toplu);
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'Silme tarihi bugüne çekildi. Zamanlayıcı en geç ~2 dk içinde 2 hedefi silecek — Olaylar ve hedef durumunu izleyin.',
      ),
    );
    expect(api.deleteNow).toHaveBeenLastCalledWith(37, ' ORPOSWEBAPI ');
    expect(screen.queryByRole('dialog', { name: 'Beklemeyi atla (tüm hedefler)' })).toBeNull();

    fireEvent.click(dugme(satir(tablo, 2), 'beklemeyi atla (admin)'));
    await screen.findByRole('dialog', { name: 'Beklemeyi atla' });
    escIleKapanir('Beklemeyi atla');
    fireEvent.click(dugme(satir(tablo, 2), 'beklemeyi atla (admin)'));
    pencere = await screen.findByRole('dialog', { name: 'Beklemeyi atla' });
    // Onceki pencerenin yazdigi ad tasinmaz.
    expect(within(pencere).getByRole('textbox')).toHaveValue('');
    fireEvent.change(within(pencere).getByRole('textbox'), { target: { value: 'ORPOSWEBAPI' } });
    api.deleteNowTarget.mockResolvedValueOnce({ ok: false });
    fireEvent.click(dugme(pencere, 'Bu sunucunun beklemesini atla'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Bekleme atlanamadı.'));
    api.deleteNowTarget.mockResolvedValueOnce({
      ok: true,
      record: kayit([hedef(1, durdu), hedef(2, { ...durdu, deleteNowAt: '2026-11-27T08:00:00Z' })]),
    });
    fireEvent.click(dugme(pencere, 'Bu sunucunun beklemesini atla'));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'ORPOSWEBAPI @ ORJEXP02: zamanlayıcı en geç ~5 dk içinde YALNIZ bu hedefi silecek — diğer hedefler kendi tarihini bekler.',
      ),
    );
    expect(api.deleteNowTarget).toHaveBeenLastCalledWith(37, 2, 'ORPOSWEBAPI');
    // Kayit yaniti yazildi: bu hedefte artik "silme sirada".
    expect(satir(tablo, 2)).toHaveTextContent('silme sırada');
    expect(
      within(satir(tablo, 1)).getByRole('button', { name: 'beklemeyi atla (admin)' }),
    ).toBeTruthy();
  });

  it('RE8 web adımını yeniden dene: önizleme planı, onay; iş başladı / kuyrukta / başlatılamadı', async () => {
    const t = (o: Partial<RtTarget> = {}) =>
      hedef(1, { ...durdu, web: [WEB], webSonuc: [wsOk('failed', 509)], ...o });
    const tablo = await ac([t()]);
    const onizle = () => fireEvent.click(dugme(satir(tablo, 1), /Web adımını yeniden dene/));

    api.webRetryPlan.mockResolvedValueOnce({ ok: false, message: 'plan şablonu yok' });
    onizle();
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('plan şablonu yok'));
    expect(screen.queryByRole('dialog', { name: 'Web adımını yeniden dene' })).toBeNull();

    api.webRetryPlan.mockResolvedValueOnce({
      ok: true,
      vhostPlan: [{ ...WEB, ok: true, jobId: 1200, awxServerId: 3 }],
    });
    onizle();
    let pencere = await screen.findByRole('dialog', { name: 'Web adımını yeniden dene' });
    expect(api.webRetryPlan).toHaveBeenLastCalledWith(37, 1);
    expect(pencere).toHaveTextContent('Plan işleri bitince onay açılır.');
    const onay = dugme(pencere, 'Onayla ve yeniden dene');
    expect(onay).toBeDisabled();
    // Plan basarisiz biterse de bekleme biter; blok hatasi pencerede.
    await bitir('Retirement: vhost planı', {
      fixResult: { line: 'RESULT\tORJEXW01\tFAIL\tconf kilitli' },
    });
    expect(pencere).toHaveTextContent('PLAN BAŞARISIZ — web adımı da düşecek: conf kilitli');
    expect(onay).toBeEnabled();

    api.webRetry.mockResolvedValueOnce({
      ok: true,
      adet: 1,
      basladi: 1,
      record: kayit([t({ webSonuc: [{ ...wsOk('running', 1300), awxServerId: 3 }] })]),
    });
    fireEvent.click(onay);
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        '1 vhost işi başladı (#1300) — satırdaki ‘İş çıktısı’ndan izleyebilirsiniz.',
      ),
    );
    expect(api.webRetry).toHaveBeenLastCalledWith(37, 1);
    expect(screen.queryByRole('dialog', { name: 'Web adımını yeniden dene' })).toBeNull();
    expect(basliklar().at(-1)).toBe('Retirement: web adımı pos.ornek.invalid @ ORJEXW01');
    // Web isi bitince kayit kisa bir gecikmeyle yeniden okunur.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const once = api.get.mock.calls.length;
      await bitir('Retirement: web adımı');
      expect(api.jobStatus).toHaveBeenLastCalledWith(37, 1, 3, 1300);
      expect(api.get.mock.calls.length).toBe(once);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(api.get.mock.calls.length).toBe(once + 1);
    } finally {
      vi.useRealTimers();
    }

    // Kuyrukta (zamanlayici kosuyor) ve baslatilamadi: ne kadar beklenecegi yazilir.
    for (const [yanit, tur, metin] of [
      [
        { ok: true, adet: 2, basladi: 0, kilitli: true, pollSaniye: 60 },
        'success',
        '2 vhost kuyrukta: zamanlayıcı şu an çalışıyor, iş bu turda başlar (en geç ~1 dk).',
      ],
      [
        { ok: true, adet: 2, basladi: 0, kilitli: false, baslatmaHatasi: 'AWX 503' },
        'error',
        '2 vhost kuyrukta ama iş HENÜZ BAŞLATILAMADI: AWX 503 — zamanlayıcı en geç ~5 dk içinde yeniden dener; Olaylar listesine bakın.',
      ],
      [{ ok: false, message: 'vhost yok' }, 'error', 'vhost yok'],
    ] as const) {
      hedefler = [t()];
      api.webRetryPlan.mockResolvedValueOnce({ ok: true, vhostPlan: [] });
      await waitFor(() => expect(dugme(satir(tablo, 1), /Web adımını yeniden dene/)).toBeEnabled());
      onizle();
      pencere = await screen.findByRole('dialog', { name: 'Web adımını yeniden dene' });
      // Bos plan: yeniden denenecek vhost yok, onay kapali; kapat.
      expect(pencere).toHaveTextContent('Yeniden denenecek vhost yok.');
      expect(dugme(pencere, 'Onayla ve yeniden dene')).toBeDisabled();
      escIleKapanir('Web adımını yeniden dene');
      // Onay dugmesine dogrudan yol: plan isi bitmis bir onizleme.
      api.webRetryPlan.mockResolvedValueOnce({
        ok: true,
        vhostPlan: [{ ...WEB, ok: false, message: 'conf yok' }],
      });
      onizle();
      pencere = await screen.findByRole('dialog', { name: 'Web adımını yeniden dene' });
      api.webRetry.mockResolvedValueOnce(yanit);
      fireEvent.click(dugme(pencere, 'Onayla ve yeniden dene'));
      await waitFor(() => expect(toastM[tur]).toHaveBeenCalledWith(metin));
    }
  });

  it('RE9 durumu tazele: değişti / değişmedi / red; job ID yoksa uzlaştırma penceresi', async () => {
    const aralik = vi.spyOn(window, 'setInterval');
    const takili = hedef(1, { status: 'stopping', lastJobId: 1400 });
    const tablo = await ac([takili]);
    // Gecis durumunda 4 sn'de bir /canli: kayit yaniti yazilir; red ve ag hatasi ekrani bozmaz.
    const canliCagri = aralik.mock.calls.find((c) => c[1] === 4000);
    aralik.mockRestore();
    expect(canliCagri).toBeTruthy();
    const tik = (canliCagri as unknown as [() => void, number])[0];
    api.canli.mockResolvedValueOnce({ ok: false });
    api.canli.mockRejectedValueOnce(new Error('ağ yok'));
    await act(async () => {
      tik();
      tik();
    });
    expect(api.canli).toHaveBeenCalledWith(37);
    expect(satir(tablo, 1)).toHaveTextContent('Durumu tazele');
    api.canli.mockResolvedValueOnce({
      ok: true,
      record: kayit([
        hedef(1, { status: 'stopping', lastJobId: 1400, resultText: 'canlı: JVM duruyor' }),
      ]),
    });
    await act(async () => {
      tik();
    });
    await waitFor(() => expect(satir(tablo, 1)).toHaveTextContent('canlı: JVM duruyor'));
    const tazele = async () => {
      await waitFor(() => expect(dugme(satir(tablo, 1), /Durumu tazele/)).toBeEnabled());
      fireEvent.click(dugme(satir(tablo, 1), /Durumu tazele/));
    };

    api.refreshStatus.mockResolvedValueOnce({ ok: true, degisti: false });
    await tazele();
    await waitFor(() => expect(toastM.success).toHaveBeenCalledWith('Durum değişmedi.'));
    expect(api.refreshStatus).toHaveBeenLastCalledWith(37, 1);
    api.refreshStatus.mockResolvedValueOnce({ ok: false, message: 'AWX okunamadı' });
    await tazele();
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('AWX okunamadı'));
    api.refreshStatus.mockRejectedValueOnce(new Error('zaman aşımı'));
    await tazele();
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('zaman aşımı'));

    // Job ID yazilamamis claim: uzlastirma penceresi.
    api.refreshStatus.mockResolvedValueOnce({ ok: false, jobMissing: true, message: 'job yok' });
    await tazele();
    const pencere = await screen.findByRole('dialog', { name: 'Mevcut AWX işini uzlaştır' });
    expect(pencere).toHaveTextContent('ORPOSWEBAPI @ ORJEXP01 · STOP');
    expect(toastM.error).not.toHaveBeenCalledWith('job yok');
    const alan = within(pencere).getByRole('spinbutton', { name: 'AWX job ID' });
    fireEvent.change(alan, { target: { value: '0' } });
    fireEvent.click(dugme(pencere, 'Doğrula ve bağla'));
    expect(toastM.error).toHaveBeenCalledWith('Geçerli bir AWX job ID girin.');
    expect(api.reconcileJob).not.toHaveBeenCalled();
    fireEvent.change(alan, { target: { value: '1401' } });
    api.reconcileJob.mockResolvedValueOnce({ ok: false, message: 'şablon eşleşmedi' });
    fireEvent.click(dugme(pencere, 'Doğrula ve bağla'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('şablon eşleşmedi'));
    expect(api.reconcileJob).toHaveBeenLastCalledWith(37, 1, 1401);
    api.reconcileJob.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(dugme(pencere, 'Doğrula ve bağla'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('ağ yok'));
    hedefler = [hedef(1, { status: 'stopping', lastJobId: 1401 })];
    api.reconcileJob.mockResolvedValueOnce({ ok: true, jobId: 1401 });
    fireEvent.click(dugme(pencere, 'Doğrula ve bağla'));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith('AWX işi #1401 hedefe bağlandı.'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Mevcut AWX işini uzlaştır' })).toBeNull(),
    );

    // Durum degisti: kayit yaniti yoksa yeniden okunur; varsa dogrudan yazilir.
    hedefler = [hedef(1, durdu)];
    const once = api.get.mock.calls.length;
    api.refreshStatus.mockResolvedValueOnce({
      ok: true,
      degisti: true,
      from: 'stopping',
      to: 'stopped',
    });
    await tazele();
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith('ORPOSWEBAPI @ ORJEXP01: stopping → stopped'),
    );
    await waitFor(() => expect(api.get.mock.calls.length).toBe(once + 1));
    await waitFor(() =>
      expect(within(satir(tablo, 1)).queryByRole('button', { name: /Durumu tazele/ })).toBeNull(),
    );
  });

  it('RE10 silme ön kontrolü: iş bitince liste penceresi; red ve istisna', async () => {
    const tablo = await ac([hedef(1, durdu)]);
    api.deletePlan.mockResolvedValueOnce({ ok: false, message: 'silme şablonu yok' });
    fireEvent.click(dugme(satir(tablo, 1), 'silme ön kontrolü'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('silme şablonu yok'));
    api.deletePlan.mockRejectedValueOnce(new Error('ağ yok'));
    await waitFor(() => expect(dugme(satir(tablo, 1), 'silme ön kontrolü')).toBeEnabled());
    fireEvent.click(dugme(satir(tablo, 1), 'silme ön kontrolü'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('ağ yok'));
    expect(izle.addJob).not.toHaveBeenCalled();

    api.deletePlan.mockResolvedValueOnce({
      ok: true,
      jobId: 1500,
      status: 'pending',
      awxServerId: 3,
    });
    await waitFor(() => expect(dugme(satir(tablo, 1), 'silme ön kontrolü')).toBeEnabled());
    fireEvent.click(dugme(satir(tablo, 1), 'silme ön kontrolü'));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith(
        'ORPOSWEBAPI @ ORJEXP01: silme ön kontrolü başladı (#1500) — hiçbir şey silinmez, liste bitince görünür.',
      ),
    );
    expect(api.deletePlan).toHaveBeenLastCalledWith(37, 1);
    expect(basliklar()).toEqual(['Retirement: silme ön kontrolü ORPOSWEBAPI @ ORJEXP01']);
    api.jobStatus.mockResolvedValueOnce({ ok: false, status: '', output: '' });
    await expect(isDurumu('Retirement: silme ön kontrolü')()).rejects.toThrow('Durum okunamadı.');
    expect(screen.queryByRole('dialog', { name: 'Silme ön kontrolü' })).toBeNull();
    hedefler = [
      hedef(1, {
        ...durdu,
        silmeOnKontrol: ok({
          jobId: 1500,
          mesaj: 'silinecekler okundu',
          izinler: ['onay:sil:1500'],
        }),
      }),
    ];
    await bitir('Retirement: silme ön kontrolü');
    await screen.findByRole('dialog', { name: 'Silme ön kontrolü' });
    escIleKapanir('Silme ön kontrolü');
    fireEvent.click(dugme(satir(tablo, 1), /^silme listesi: 0 dosya/));
    const pencere = await screen.findByRole('dialog', { name: 'Silme ön kontrolü' });
    // Liste penceresinden on kontrol yeniden kosulabilir.
    api.deletePlan.mockResolvedValueOnce({
      ok: true,
      jobId: 1501,
      status: 'pending',
      awxServerId: 3,
    });
    fireEvent.click(dugme(pencere, 'Ön kontrolü yeniden çalıştır'));
    await waitFor(() => expect(api.deletePlan).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole('dialog', { name: 'Silme ön kontrolü' })).toBeNull();
  });

  it('RE11 not ekle, kayıttan çıkar; ESC yalnız üstteki katmanı kapatır', async () => {
    const tablo = await ac([hedef(1), hedef(2)]);
    const notAlani = screen.getByPlaceholderText(/not ekle/);
    // Bos not gonderilmez.
    fireEvent.change(notAlani, { target: { value: '   ' } });
    fireEvent.keyDown(notAlani, { key: 'Enter' });
    expect(api.note).not.toHaveBeenCalled();
    api.note.mockResolvedValueOnce({ ok: false, message: 'yazılamadı' });
    fireEvent.change(notAlani, { target: { value: ' LB üyesi çıkarıldı ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await waitFor(() => expect(api.note).toHaveBeenCalledWith(37, 'LB üyesi çıkarıldı'));
    // Red: yazilan not silinmez.
    expect(notAlani).toHaveValue(' LB üyesi çıkarıldı ');
    api.note.mockResolvedValueOnce({
      ok: true,
      record: kayit(hedefler, {
        events: [
          {
            id: 1,
            at: '2026-11-27T08:00:00Z',
            kind: 'NOT',
            text: 'LB üyesi çıkarıldı',
            username: 'onur',
          },
        ],
      } as Partial<RtRecord>),
    });
    fireEvent.keyDown(notAlani, { key: 'Enter' });
    await waitFor(() => expect(notAlani).toHaveValue(''));
    expect(screen.getByText(/— LB üyesi çıkarıldı/)).toBeTruthy();

    fireEvent.click(dugme(satir(tablo, 2), 'kayıttan çıkar'));
    let pencere = await screen.findByRole('dialog', { name: 'Hedefi kayıttan çıkar' });
    expect(pencere).toHaveTextContent('ORPOSWEBAPI @ ORJEXP02 · JBoss 7 · TEST');
    escIleKapanir('Hedefi kayıttan çıkar');

    fireEvent.click(dugme(satir(tablo, 2), 'kayıttan çıkar'));
    pencere = await screen.findByRole('dialog', { name: 'Hedefi kayıttan çıkar' });
    fireEvent.change(within(pencere).getByRole('textbox'), {
      target: { value: '  yalnız JBoss 8  ' },
    });
    api.cikar.mockResolvedValueOnce({ ok: false });
    fireEvent.click(dugme(pencere, 'Kayıttan çıkar'));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Hedef çıkarılamadı.'));
    expect(api.cikar).toHaveBeenLastCalledWith(37, 2, 'yalnız JBoss 8');
    api.cikar.mockResolvedValueOnce({
      ok: true,
      record: kayit([hedef(1), hedef(2, { status: 'skipped' })]),
    });
    fireEvent.click(dugme(pencere, 'Kayıttan çıkar'));
    await waitFor(() =>
      expect(toastM.success).toHaveBeenCalledWith('ORJEXP02 kayıttan çıkarıldı.'),
    );
    expect(screen.queryByRole('dialog', { name: 'Hedefi kayıttan çıkar' })).toBeNull();
    expect(within(satir(tablo, 2)).queryByRole('button', { name: 'kayıttan çıkar' })).toBeNull();
    // Yeniden acilinca sebep bos baslar.
    fireEvent.click(dugme(satir(tablo, 1), 'kayıttan çıkar'));
    pencere = await screen.findByRole('dialog', { name: 'Hedefi kayıttan çıkar' });
    expect(within(pencere).getByRole('textbox')).toHaveValue('');
  });

  it('RE12 web keşfini yenile: önizleme, kayda yazma, red ve istisna', async () => {
    await ac([hedef(1), hedef(2, durdu)]);
    const yenile = () =>
      fireEvent.click(screen.getByRole('button', { name: /Web keşfini yenile/ }));
    const onizleme = {
      ok: true,
      hedefler: [
        {
          tid: 1,
          host: 'ORJEXP01',
          appName: 'ORPOSWEBAPI',
          env: 'TEST',
          status: 'pending',
          eski: 0,
          eklenen: [
            WEB,
            { ...WEB, host: 'ORJEXW09', serverName: 'yan.ornek.invalid', product: undefined },
          ],
          webHow: '3-tier aday: Server Hub',
          webUyari: null,
          islem: 'eklenecek (2)',
        },
        {
          tid: 2,
          host: 'ORJEXP02',
          appName: 'ORPOSWEBAPI',
          env: 'TEST',
          status: 'stopped',
          eski: 0,
          eklenen: [],
          webHow: 'kural yok',
          webUyari: 'web katmanı bulunamadı',
          islem: 'değişiklik yok',
        },
      ],
    };

    api.webKesif.mockResolvedValueOnce({ ok: false, message: 'Server Hub okunamadı' });
    yenile();
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Server Hub okunamadı'));
    api.webKesif.mockRejectedValueOnce(new Error('ağ yok'));
    yenile();
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('ağ yok'));

    api.webKesif.mockResolvedValueOnce(onizleme);
    yenile();
    let pencere = await screen.findByRole('dialog', { name: 'Web keşfi (önizleme)' });
    expect(api.webKesif).toHaveBeenLastCalledWith(37, false);
    expect(pencere).toHaveTextContent('+ ORJEXW01 · pos.ornek.invalid (IHS)');
    expect(pencere).toHaveTextContent('+ ORJEXW09 · yan.ornek.invalid');
    expect(pencere).not.toHaveTextContent('yan.ornek.invalid (');
    expect(pencere).toHaveTextContent('web katmanı bulunamadı');
    expect(pencere).toHaveTextContent('eklenecek (2)');
    escIleKapanir('Web keşfi (önizleme)');

    // Eklenecek bir sey yoksa yazma dugmesi kapali.
    api.webKesif.mockResolvedValueOnce({ ...onizleme, hedefler: [onizleme.hedefler[1]] });
    yenile();
    pencere = await screen.findByRole('dialog', { name: 'Web keşfi (önizleme)' });
    expect(dugme(pencere, 'Eklenenleri kayda yaz')).toBeDisabled();
    fireEvent.click(dugme(pencere, 'Kapat'));

    for (const [yanit, metin] of [
      [
        { ok: true, eklenenToplam: 2, record: kayit([hedef(1, { web: [WEB] }), hedef(2, durdu)]) },
        '2 vhost kayda eklendi.',
      ],
      [{ ok: true, eklenenToplam: 0 }, 'Eklenecek yeni vhost yoktu.'],
    ] as const) {
      api.webKesif.mockResolvedValueOnce(onizleme);
      yenile();
      pencere = await screen.findByRole('dialog', { name: 'Web keşfi (önizleme)' });
      api.webKesif.mockResolvedValueOnce(yanit);
      fireEvent.click(dugme(pencere, 'Eklenenleri kayda yaz'));
      await waitFor(() => expect(toastM.success).toHaveBeenCalledWith(metin));
      expect(api.webKesif).toHaveBeenLastCalledWith(37, true);
      expect(screen.queryByRole('dialog', { name: 'Web keşfi (önizleme)' })).toBeNull();
    }
  });
});
