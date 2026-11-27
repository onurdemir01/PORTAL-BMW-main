// @vitest-environment jsdom
// Self Servis survey formu AKISLARI (2026-11-27, kapsam PR-2; SelfServicePage SurveyModal dal dusuk).
//   SA1 form: varsayilanlar, kosullu alan, alan dogrulamasi, gonderilen degerler, baslatma hatalari, is izleme
//   SA2 cift tik ayni anda iki is acmaz; calisma zamani secenekleri gonderilir
//   SA3 Smart onayi: bekleyen talep yoklanir (gecici hata, sayac, LAUNCHED -> is izleme); sonuc durumlari
//   SA4 OCO: numara sorulur, pencere secimi (otomatik / kendim), zamanlama turleri, kacirilmis OCO
//   SA5 OCO on uyarisi: ortam secimine gore ton, admin ortam listesi, Smart notu
//   SA6 yerel okuma (nginx read), parametresiz sablon, survey okunamadi; satir ici form temizleme
//   SA7 katalogdan acilan pencere: Iptal / Kapat / X
//   SA8 gecmis penceresi: servise suzulur, log ayrintisi; okunamayan gecmis "is yok" demez
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { render } from '@/test/test-utils';
import SelfServicePage from '@/components/SelfServicePage';
import type { AnsibleSsItem, LaunchOptions, OcoWindowInfo, SurveyField } from '@/api/ansibleApi';

const api = vi.hoisted(() => ({
  groups: vi.fn(),
  ssItems: vi.fn(),
  surveySpec: vi.fn(),
  launchSs: vi.fn(),
  ssJobStatus: vi.fn(),
  smartTicketStatus: vi.fn(),
  ocoValidate: vi.fn(),
  history: vi.fn(),
  nobetci: vi.fn(),
  addJob: vi.fn(),
  jobs: [] as { id: string; status: string; output: string; pollErr?: string }[],
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { username: 'yonetici', role: 'Admin' },
    canViewPage: () => true,
    canSee: () => true,
  }),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({
  useJobTracker: () => ({ addJob: api.addJob, jobs: api.jobs }),
}));
vi.mock('@/api/selfServiceApi', () => ({ selfServiceApi: { get: api.groups } }));
vi.mock('@/api/nobetciApi', () => ({ nobetciApi: { today: api.nobetci } }));
vi.mock('@/api/ansibleApi', async (orig) => {
  const gercek = await orig<typeof import('@/api/ansibleApi')>();
  return {
    ...gercek,
    ansibleApi: {
      ...gercek.ansibleApi,
      ssItems: api.ssItems,
      surveySpec: api.surveySpec,
      launchSs: api.launchSs,
      ssJobStatus: api.ssJobStatus,
      smartTicketStatus: api.smartTicketStatus,
      ocoValidate: api.ocoValidate,
      history: api.history,
    },
  };
});
vi.mock('@/components/self_service/NginxTanimOkuma', () => ({
  default: (p: Record<string, unknown>) => <div data-testid="tanim-okuma">{JSON.stringify(p)}</div>,
}));

const SERVIS: AnsibleSsItem = {
  id: 's1',
  title: 'Servis Başlat',
  description: 'AWX servisi',
  awxServerId: 2,
  awxTemplateId: 42,
  enabled: true,
  order: 1,
};
const alan = (
  o: Partial<SurveyField> & Pick<SurveyField, 'name' | 'label' | 'type'>,
): SurveyField => ({
  required: false,
  defaultValue: '',
  choices: [],
  hidden: false,
  description: '',
  ...o,
});
const ALANLAR: SurveyField[] = [
  alan({
    name: 'env',
    label: 'Ortam',
    type: 'multiplechoice',
    required: true,
    choices: ['test', 'prod'],
  }),
  alan({
    name: 'port',
    label: 'Port',
    type: 'integer',
    defaultValue: '8080',
    description: 'dinlenen port',
  }),
  alan({ name: 'oran', label: 'Oran', type: 'float' }),
  // AWX choices'i metin olarak da verebiliyor (satir sonu / virgul)
  alan({
    name: 'dosyalar',
    label: 'Dosyalar',
    type: 'multiselect',
    choices: 'a.conf, b.conf\nc.conf' as unknown as string[],
    choiceLabels: { 'a.conf': 'A dosyası' },
  }),
  alan({ name: 'not', label: 'Not', type: 'textarea' }),
  alan({ name: 'parola', label: 'Parola', type: 'password' }),
  alan({
    name: 'onay',
    label: 'Prod onayı',
    type: 'text',
    dependsOn: { mode: 'all', conditions: [{ field: 'env', equals: 'prod' }] },
  }),
  alan({ name: 'serbest', label: 'Serbest', type: 'text', choices: 42 as unknown as string[] }),
];
const bayrak = (enabled: boolean, current: unknown = '') => ({ enabled, current }) as never;
const SECENEKLER = (acik: boolean): LaunchOptions => ({
  limit: bayrak(acik, 'web*'),
  forks: bayrak(acik, 5),
  jobTags: bayrak(acik, 'deploy'),
  skipTags: bayrak(acik, ''),
  verbosity: bayrak(acik, 1),
  jobType: bayrak(acik, 'check'),
});
const spec = (o: Record<string, unknown> = {}) => ({
  ok: true,
  fields: ALANLAR,
  surveyEnabled: true,
  launchOptions: SECENEKLER(false),
  askVariables: false,
  gates: { oco: false, ocoEnvironments: null, smart: false },
  yerelOkuma: null,
  ...o,
});
const OCO: OcoWindowInfo = {
  ocoNumber: '22502813',
  subject: 'Gece bakımı',
  startText: '27.11 23:00',
  endText: '28.11 01:00',
  windowStartText: '27.11 22:00',
  windowEndText: '28.11 02:00',
  equal: false,
  phase: 'before',
};

const el = <T extends HTMLElement = HTMLInputElement>(id: string) =>
  document.getElementById(id) as T;
const dugme = (ad: string | RegExp) => screen.getByRole('button', { name: ad });
const baslat = () => dugme(/İş Başlat/) as HTMLButtonElement;
const sonIs = () =>
  api.addJob.mock.calls.at(-1)![0] as { title: string; fetchStatus: () => Promise<unknown> };
let araliklar: ReturnType<typeof vi.spyOn>;
async function yoklamaTik() {
  const cb = araliklar.mock.calls
    .filter((c: unknown[]) => c[1] === 4000)
    .at(-1)![0] as () => Promise<void>;
  await act(async () => {
    await cb();
  });
}

async function ac(yol = '/self-service/servis-baslat') {
  render(
    <Routes>
      <Route path="/self-service/:slug?" element={<SelfServicePage />} />
    </Routes>,
    { initialEntries: [yol] },
  );
}
async function formAc(o: Record<string, unknown> = {}) {
  api.surveySpec.mockResolvedValue(spec(o));
  await ac();
  await waitFor(() => expect(api.surveySpec).toHaveBeenCalledWith(2, 42));
  await screen.findAllByRole('button', { name: /İş Başlat|Formu Temizle/ });
}
const ortamSec = (v: string) =>
  fireEvent.change(el<HTMLSelectElement>('f-env'), { target: { value: v } });

beforeEach(() => {
  // resetAllMocks: tek seferlik yanit kuyruklari da bosalir (bir testin artan yaniti digerine sizmaz)
  vi.resetAllMocks();
  api.jobs.length = 0;
  araliklar = vi.spyOn(window, 'setInterval');
  api.groups.mockResolvedValue({
    ok: true,
    groups: [
      {
        id: 'g1',
        groupKey: 'ansible',
        label: 'Ansible',
        icon: 'cmd',
        sortOrder: 1,
        isActive: true,
      },
    ],
  });
  api.ssItems.mockResolvedValue({ ok: true, items: [SERVIS] });
  api.addJob.mockReturnValue('iz-1');
  api.nobetci.mockResolvedValue({ ok: true, name: 'Nöbetçi Kişi', intercom: '4321', phone: '555' });
  api.history.mockResolvedValue({ ok: true, history: [] });
});

describe('Self Servis survey formu', () => {
  it('SA1 form: varsayılanlar, koşullu alan, doğrulama, gönderilen değerler, başlatma hataları, iş izleme', async () => {
    await formAc();
    expect(el('f-port').value).toBe('8080');
    expect(screen.getByText('dinlenen port')).toBeTruthy();
    expect(el('f-parola').type).toBe('password');
    expect(el('f-not').tagName).toBe('TEXTAREA');
    expect(el('f-serbest').type).toBe('text');
    expect(screen.queryByText('Çalışma Zamanı Seçenekleri')).toBeNull();
    // zorunlu alan bos: dugme kapali, hata ancak dokununca
    expect(baslat().disabled).toBe(true);
    expect(baslat().title).toBe('Zorunlu alan(lar) eksik: Ortam');
    expect(screen.queryByText('Ortam zorunlu.')).toBeNull();
    fireEvent.blur(el('f-env'));
    expect(screen.getByText('Ortam zorunlu.')).toBeTruthy();
    // kosullu alan
    expect(el('f-onay')).toBeNull();
    ortamSec('prod');
    expect(el('f-onay')).toBeTruthy();
    ortamSec('test');
    expect(el('f-onay')).toBeNull();
    expect(baslat().disabled).toBe(false);
    // sayi alanlari
    fireEvent.change(el('f-port'), { target: { value: '12.5' } });
    fireEvent.blur(el('f-port'));
    expect(screen.getByText('Tam sayı girin.')).toBeTruthy();
    expect(baslat().title).toBe('Bazı alanlar geçersiz — kırmızı uyarıları düzeltin.');
    fireEvent.change(el('f-port'), { target: { value: '8443' } });
    fireEvent.change(el('f-oran'), { target: { value: '1e5' } });
    fireEvent.blur(el('f-oran'));
    expect(screen.getByText('Geçerli bir sayı girin.')).toBeTruthy();
    fireEvent.change(el('f-oran'), { target: { value: '0.5' } });
    expect(screen.queryByRole('alert')).toBeNull();
    // coklu secim: metin olarak gelen secenekler, etiket
    const kutular = within(el<HTMLDivElement>('f-dosyalar')).getAllByRole('checkbox');
    expect(kutular).toHaveLength(3);
    expect(screen.getByText('A dosyası')).toBeTruthy();
    // deger secenek SIRASIYLA birlesir (tiklama sirasi degil)
    fireEvent.click(kutular[2]);
    fireEvent.click(kutular[0]);
    expect(screen.getByText('2 / 3 seçili')).toBeTruthy();
    fireEvent.click(kutular[1]);
    expect(screen.getByText('3 / 3 seçili')).toBeTruthy();
    fireEvent.click(kutular[1]);
    fireEvent.change(el('f-not'), { target: { value: '  ' } }); // bos deger gonderilmez

    api.launchSs
      .mockResolvedValueOnce({ ok: false, field: 'port', message: 'aralık dışı' })
      .mockResolvedValueOnce({ ok: false, message: 'AWX kapalı' })
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error('ağ yok'))
      .mockResolvedValueOnce({ ok: true, jobId: 777, status: 'pending' });
    fireEvent.click(baslat());
    expect(await screen.findByText('port: aralık dışı')).toBeTruthy();
    expect(api.launchSs).toHaveBeenCalledWith(
      2,
      42,
      { env: 'test', port: '8443', oran: '0.5', dosyalar: 'a.conf\nc.conf' },
      'Servis Başlat',
      {
        limit: undefined,
        forks: undefined,
        jobTags: undefined,
        skipTags: undefined,
        verbosity: undefined,
        jobType: undefined,
      },
      { ocoNumber: undefined, ocoAction: undefined },
    );
    fireEvent.click(baslat());
    expect(await screen.findByText('AWX kapalı')).toBeTruthy();
    fireEvent.click(baslat());
    expect(await screen.findByText('İş başlatılamadı.')).toBeTruthy();
    fireEvent.click(baslat());
    expect(await screen.findByText('ağ yok')).toBeTruthy();

    api.jobs.push({
      id: 'iz-1',
      status: 'running',
      output: 'PLAY [nginx] ***',
      pollErr: 'AWX yavaş yanıt veriyor',
    });
    fireEvent.click(baslat());
    expect(await screen.findByText('İş başlatıldı — AWX Job #777')).toBeTruthy();
    expect(screen.queryByText('ağ yok')).toBeNull();
    expect(sonIs().title).toBe('Servis Başlat');
    expect(screen.getByText('AWX yavaş yanıt veriyor')).toBeTruthy();
    const temizle = dugme(/İş çalışıyor…/) as HTMLButtonElement;
    expect(temizle.disabled).toBe(true);
    expect(temizle.title).toMatch(/^İş çalışıyor — Ansible çıktısı bu ekranda akıyor/);
    dugmeYok(/İş Başlat/);
    // log onceligi: stdout > traceback > aciklama
    api.ssJobStatus
      .mockResolvedValueOnce({
        ok: true,
        status: 'failed',
        output: '',
        resultTraceback: '',
        jobExplanation: 'şablon yok',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'failed',
        output: '',
        resultTraceback: 'Traceback',
        jobExplanation: 'x',
      })
      .mockResolvedValueOnce({ ok: true, status: 'successful', output: 'ok=3' })
      .mockResolvedValueOnce({ ok: true, status: 'running', output: '' });
    await expect(sonIs().fetchStatus()).resolves.toEqual({
      status: 'failed',
      output: 'şablon yok',
    });
    await expect(sonIs().fetchStatus()).resolves.toEqual({ status: 'failed', output: 'Traceback' });
    await expect(sonIs().fetchStatus()).resolves.toEqual({ status: 'successful', output: 'ok=3' });
    await expect(sonIs().fetchStatus()).resolves.toEqual({ status: 'running', output: '' });
    expect(api.ssJobStatus).toHaveBeenCalledWith(2, 777);
  });

  it('SA1b biten işte "Yeni Talep" formu sıfırlar', async () => {
    api.jobs.push({ id: 'iz-1', status: 'successful', output: 'ok=1' });
    api.launchSs.mockResolvedValue({ ok: true, jobId: 5, status: 'pending' });
    await formAc();
    ortamSec('test');
    fireEvent.click(baslat());
    await screen.findByText('İş başlatıldı — AWX Job #5');
    const yeni = dugme(/Yeni Talep/) as HTMLButtonElement;
    expect(yeni.disabled).toBe(false);
    expect(yeni.title).toBe('Formu sıfırlayıp yeni bir talep oluşturun');
    fireEvent.click(yeni);
    expect(await screen.findByTestId('ss-form-reset-note')).toBeTruthy();
    await waitFor(() => expect(el<HTMLSelectElement>('f-env').value).toBe(''));
  });

  it('SA2 çift tık aynı anda iki iş açmaz; çalışma zamanı seçenekleri gönderilir', async () => {
    let bitir!: (v: unknown) => void;
    api.launchSs.mockReturnValueOnce(new Promise((r) => (bitir = r)));
    await formAc({ launchOptions: SECENEKLER(true) });
    expect(screen.getByText('Çalışma Zamanı Seçenekleri')).toBeTruthy();
    expect(el('lo-limit').value).toBe('web*');
    expect(el('lo-forks').value).toBe('5');
    expect(el('lo-jt').value).toBe('deploy');
    expect(el('lo-st').value).toBe('');
    expect(el<HTMLSelectElement>('lo-verb').value).toBe('1');
    expect(el<HTMLSelectElement>('lo-type').value).toBe('check');
    ortamSec('test');
    fireEvent.change(el('lo-st'), { target: { value: 'slow' } });
    fireEvent.change(el<HTMLSelectElement>('lo-verb'), { target: { value: '3' } });
    fireEvent.change(el<HTMLSelectElement>('lo-type'), { target: { value: 'run' } });
    fireEvent.change(el('lo-limit'), { target: { value: 'web01' } });
    fireEvent.change(el('lo-jt'), { target: { value: 'restart' } });
    fireEvent.change(el('lo-forks'), { target: { value: '' } });
    const b = baslat();
    act(() => {
      b.click();
      b.click();
    });
    expect(api.launchSs).toHaveBeenCalledTimes(1);
    expect(api.launchSs.mock.calls[0][4]).toEqual({
      limit: 'web01',
      forks: undefined,
      jobTags: 'restart',
      skipTags: 'slow',
      verbosity: 3,
      jobType: 'run',
    });
    await act(async () => {
      bitir({ ok: false, message: 'reddedildi' });
    });
    expect(await screen.findByText('reddedildi')).toBeTruthy();
    fireEvent.change(el('lo-forks'), { target: { value: '7' } });
    api.launchSs.mockResolvedValueOnce({ ok: false, message: 'yine' });
    fireEvent.click(baslat());
    await screen.findByText('yine');
    expect(api.launchSs.mock.calls[1][4]).toMatchObject({ forks: 7 });
  });

  it('SA3 Smart onayı: bekleyen talep yoklanır, LAUNCHED olunca iş izlenir', async () => {
    const olay = vi.fn();
    window.addEventListener('portal:smart-ticket-created', olay);
    api.launchSs.mockResolvedValue({
      ok: true,
      pendingApproval: true,
      ticketId: 55,
      externalTicketId: 'SM-901',
    });
    await formAc({ gates: { oco: false, ocoEnvironments: null, smart: true } });
    ortamSec('test');
    fireEvent.click(baslat());
    expect(await screen.findByText('Smart üzerinde onay bekleniyor…')).toBeTruthy();
    expect(olay).toHaveBeenCalledTimes(1);
    window.removeEventListener('portal:smart-ticket-created', olay);
    expect(screen.getByText('SM-901')).toBeTruthy();
    expect(screen.getByText(/Tamamla’ya basıldığında iş otomatik başlar/)).toBeTruthy();
    expect(await screen.findByText('Nöbetçi Kişi')).toBeTruthy();
    expect(screen.getByText(/\(dahili: 4321\)/)).toBeTruthy();
    expect((dugme(/Yeni Talep/) as HTMLButtonElement).disabled).toBe(false);
    // gecici hata ve ok:false yoklamayi durdurmaz
    api.smartTicketStatus.mockRejectedValueOnce(new Error('ağ'));
    await yoklamaTik();
    api.smartTicketStatus.mockResolvedValueOnce({ ok: false, status: '' });
    await yoklamaTik();
    expect(screen.getByText('Smart üzerinde onay bekleniyor…')).toBeTruthy();
    const simdi = new Date().toISOString();
    api.smartTicketStatus.mockResolvedValueOnce({
      ok: true,
      status: 'PENDING',
      createdAt: simdi,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      deadlineKaynak: 'sabit',
      serverNow: simdi,
    });
    await yoklamaTik();
    expect(api.smartTicketStatus).toHaveBeenLastCalledWith(55);
    api.smartTicketStatus.mockResolvedValueOnce({ ok: true, status: 'LAUNCHED', jobId: 900 });
    await yoklamaTik();
    expect(await screen.findByText('İş başlatıldı — AWX Job #900')).toBeTruthy();
    expect(screen.queryByText('Smart üzerinde onay bekleniyor…')).toBeNull();
    expect(api.addJob).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'REJECTED',
      { externalTicketId: 'SM-7' },
      ['Smart talebi reddedildi.', /Smart talep #SM-7'e bakın/],
    ],
    [
      'REJECTED',
      { externalTicketId: null },
      ['Smart talebi reddedildi.', /Smart talep #55'e bakın/],
    ],
    [
      'TIMEOUT',
      { errorMessage: 'onaycı yanıt vermedi' },
      ['Smart onayı zaman aşımına uğradı.', 'onaycı yanıt vermedi'],
    ],
    ['TIMEOUT', {}, ['Smart onayı zaman aşımına uğradı.', 'İş başlatılmadı.']],
    ['ERROR', { errorMessage: 'AWX 500' }, ['Talep onaylandı ama iş başlatılamadı.', 'AWX 500']],
    [
      'ERROR',
      {},
      ['Talep onaylandı ama iş başlatılamadı.', 'Lütfen sistem yöneticinize başvurun.'],
    ],
    [
      'SCHEDULED',
      {},
      ['Onay alındı — iş kesinti penceresine zamanlandı.', /kendiliğinden çalışacak/],
    ],
    [
      'SCHEDULED',
      { errorMessage: 'pencere 22:00' },
      ['Onay alındı — iş kesinti penceresine zamanlandı.', 'pencere 22:00'],
    ],
    ['ARSIVDE', { externalTicketId: 'SM-8' }, [/Smart talebi durumu:/, 'ARSIVDE', 'SM-8']],
    ['ARSIVDE', { externalTicketId: null }, [/Smart talebi durumu:/, 'ARSIVDE']],
    // is numarasiz LAUNCHED is izlemeye gecmez; durum yazilir
    ['LAUNCHED', { jobId: null }, [/Smart talebi durumu:/, 'LAUNCHED']],
  ])('SA3b Smart talebi %s sonucu ekrana yazılır (%#)', async (durum, ek, metinler) => {
    api.nobetci.mockResolvedValueOnce({
      ok: true,
      name: 'Nöbetçi Kişi',
      intercom: null,
      phone: '555 01',
    });
    api.launchSs.mockResolvedValue({ ok: true, pendingApproval: true, ticketId: 55 });
    await formAc();
    ortamSec('test');
    fireEvent.click(baslat());
    await screen.findByText('Smart üzerinde onay bekleniyor…');
    expect(await screen.findByText(/\(555 01\)/)).toBeTruthy();
    api.smartTicketStatus.mockResolvedValueOnce({ ok: true, status: durum, ...ek });
    await yoklamaTik();
    for (const m of metinler) expect(screen.getAllByText(m).length).toBeGreaterThan(0);
    expect(screen.queryByText('Smart üzerinde onay bekleniyor…')).toBeNull();
    expect(api.addJob).not.toHaveBeenCalled();
  });

  it('SA3c nöbetçi okunamazsa genel yönlendirme yazılır', async () => {
    api.nobetci.mockRejectedValueOnce(new Error('yok'));
    api.launchSs.mockResolvedValue({ ok: true, pendingApproval: true, ticketId: 56 });
    await formAc();
    ortamSec('test');
    fireEvent.click(baslat());
    expect(await screen.findByText(/günün nöbetçisiyle iletişime geçin\./)).toBeTruthy();
  });

  it('SA4 OCO: numara sorulur, pencere öncesi otomatik tetikleme AWX zamanlaması olur', async () => {
    api.launchSs
      .mockResolvedValueOnce({
        ok: false,
        ocoRequired: true,
        message: 'PRODUCTION için OCO gerekli.',
      })
      .mockResolvedValueOnce({ ok: true, ocoScheduled: true, oco: OCO, awxScheduleId: 12 });
    api.ocoValidate
      .mockResolvedValueOnce({ ok: false, message: 'OCO bulunamadı' })
      .mockRejectedValueOnce(new Error('OCO servisi düştü'))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, oco: { ...OCO, equal: true } });
    await formAc({ gates: { oco: true, ocoEnvironments: null, smart: false } });
    ortamSec('prod');
    fireEvent.change(el('f-onay'), { target: { value: 'evet' } });
    fireEvent.click(baslat());
    expect(await screen.findByText('PRODUCTION için OCO gerekli.')).toBeTruthy();
    expect(screen.getByText('Production talebi — OCO kontrolü')).toBeTruthy();
    expect(el('f-env')).toBeNull(); // alanlar gizlenir
    dugmeYok(/İş Başlat/);
    const sorgula = dugme('Sorgula') as HTMLButtonElement;
    expect(sorgula.disabled).toBe(true);
    const no = screen.getByLabelText('OCO Numarası');
    fireEvent.change(no, { target: { value: '  ' } });
    expect(sorgula.disabled).toBe(true);
    fireEvent.change(no, { target: { value: ' 22502813 ' } });
    fireEvent.click(sorgula);
    expect(await screen.findByText('OCO bulunamadı')).toBeTruthy();
    expect(api.ocoValidate).toHaveBeenCalledWith('22502813');
    fireEvent.click(dugme('Sorgula'));
    expect(await screen.findByText('OCO servisi düştü')).toBeTruthy();
    fireEvent.click(dugme('Sorgula'));
    expect(await screen.findByText('OCO sorgulanamadı.')).toBeTruthy();
    fireEvent.click(dugme('Sorgula'));
    expect(await screen.findByText('Gece bakımı')).toBeTruthy();
    expect(screen.queryByText('OCO sorgulanamadı.')).toBeNull();
    expect(screen.getAllByText('27.11 22:00 — 28.11 02:00')).toHaveLength(2); // aralik + "kendim" karti
    expect(screen.getByText(/pencere 2 saat olarak uygulandı/)).toBeTruthy();
    expect(screen.getByText('Nasıl ilerlemek istersiniz?')).toBeTruthy();
    fireEvent.click(dugme(/Otomatik tetikle/));
    const sonuc = await screen.findByTestId('oco-done');
    expect(api.launchSs.mock.calls[1][2]).toEqual({ env: 'prod', port: '8080', onay: 'evet' });
    expect(api.launchSs.mock.calls[1][5]).toEqual({ ocoNumber: '22502813', ocoAction: 'schedule' });
    expect(within(sonuc).getByText('İş kesinti penceresine zamanlandı')).toBeTruthy();
    expect(within(sonuc).getByText('#12')).toBeTruthy();
    expect(within(sonuc).getByText('22502813')).toBeTruthy();
    expect(within(sonuc).getByText(/İş AWX'te zamanlandı; 27.11 22:00 saatinde/)).toBeTruthy();
    expect(screen.queryByText('Production talebi — OCO kontrolü')).toBeNull();
    expect(within(sonuc).queryByTestId('oco-smart-no')).toBeNull();
    expect((dugme(/Yeni Talep/) as HTMLButtonElement).disabled).toBe(false);
  });

  it('SA4b OCO: Smart önce açılır (kayıt no kopyalanır), Portal zamanlaması, kendim çalıştıracağım', async () => {
    const kopya = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: kopya },
      configurable: true,
    });
    const olay = vi.fn();
    window.addEventListener('portal:smart-ticket-created', olay);
    api.launchSs.mockResolvedValueOnce({
      ok: false,
      ocoDecisionRequired: true,
      oco: OCO,
      message: 'Pencere ileride.',
    });
    await formAc({ gates: { oco: true, ocoEnvironments: null, smart: true } });
    ortamSec('prod');
    fireEvent.click(baslat());
    expect(await screen.findByText('Pencere ileride.')).toBeTruthy();
    api.launchSs.mockResolvedValueOnce({
      ok: true,
      ocoScheduled: true,
      smartFirst: true,
      smartTicketId: 70,
      externalTicketId: 'SM-70',
      oco: OCO,
    });
    fireEvent.click(dugme(/Otomatik tetikle/));
    const sonuc = await screen.findByTestId('oco-done');
    expect(within(sonuc).getByText('Smart onay talebi açıldı')).toBeTruthy();
    expect(within(screen.getByTestId('oco-smart-no')).getByText('SM-70')).toBeTruthy();
    fireEvent.click(dugme('Kopyala'));
    expect(kopya).toHaveBeenCalledWith('SM-70');
    expect(olay).toHaveBeenCalledTimes(1);
    window.removeEventListener('portal:smart-ticket-created', olay);
    expect(
      within(sonuc).getByText(/Onay verildiği anda iş 27.11 22:00 kesinti penceresine zamanlanır/),
    ).toBeTruthy();
    // bekleyen talep de gosterilir; metin "hemen degil"
    expect(screen.getByText('Smart üzerinde onay bekleniyor…')).toBeTruthy();
    expect(screen.getByText(/kesinti penceresinde çalışacak\./)).toBeTruthy();
    expect(screen.getByText('hemen değil')).toBeTruthy();
  });

  it('SA4c OCO: Portal zamanlaması, kendim çalıştıracağım, kaçırılmış OCO, pencere içi başlatma', async () => {
    api.launchSs.mockResolvedValueOnce({ ok: false, ocoDecisionRequired: true, oco: OCO });
    await formAc({ gates: { oco: true, ocoEnvironments: null, smart: false } });
    ortamSec('prod');
    fireEvent.click(baslat());
    expect(
      await screen.findByText(
        'Bu iş PRODUCTION ortamına yöneliktir; devam etmek için OCO kaydı gerekir.',
      ),
    ).toBeTruthy();
    // Portal tetikler (AWX zamanlamasi yok, Smart once degil)
    api.launchSs.mockResolvedValueOnce({ ok: true, ocoScheduled: true, oco: OCO });
    fireEvent.click(dugme(/Otomatik tetikle/));
    const sonuc = await screen.findByTestId('oco-done');
    expect(
      within(sonuc).getByText(/İş 27.11 22:00 saatine zamanlandı\. Bu serviste Smart onayı da/),
    ).toBeTruthy();
    expect(within(sonuc).queryByText('AWX zamanlaması')).toBeNull();
    fireEvent.click(dugme(/Yeni Talep/));
    await screen.findByTestId('ss-form-reset-note');

    // kendim calistiracagim
    await waitFor(() => expect(el('f-env')).toBeTruthy());
    ortamSec('prod');
    api.launchSs.mockResolvedValueOnce({ ok: false, ocoDecisionRequired: true, oco: OCO });
    fireEvent.click(baslat());
    await screen.findByText('Nasıl ilerlemek istersiniz?');
    api.launchSs.mockResolvedValueOnce({ ok: true, ocoDeferred: true, oco: OCO });
    fireEvent.click(dugme(/Kendim çalıştıracağım/));
    const ertele = await screen.findByTestId('oco-done');
    expect(api.launchSs.mock.calls.at(-1)![5]).toEqual({
      ocoNumber: undefined,
      ocoAction: 'later',
    });
    expect(within(ertele).getByText('İş başlatılmadı')).toBeTruthy();
    expect(
      within(ertele).getByText(
        'İş başlatılmadı. 27.11 22:00 — 28.11 02:00 aralığında tekrar gelip çalıştırabilirsiniz.',
      ),
    ).toBeTruthy();
    fireEvent.click(dugme(/Yeni Talep/));
    await waitFor(() => expect(el('f-env')).toBeTruthy());

    // pencere kacirildi: karar ekraninda uyari, baska numara girilebilir
    ortamSec('prod');
    api.launchSs.mockResolvedValueOnce({
      ok: false,
      ocoDecisionRequired: true,
      oco: { ...OCO, phase: 'expired', subject: undefined },
    });
    fireEvent.click(baslat());
    expect(await screen.findByText(/OCO kaydınızı kaçırdınız\. Lütfen yeni bir OCO/)).toBeTruthy();
    expect(screen.queryByText('Konu')).toBeNull();
    dugmeYok(/Otomatik tetikle/);
    fireEvent.click(dugme('← Başka bir OCO numarası gir'));
    expect(screen.getByLabelText('OCO Numarası')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('OCO Numarası'), { target: { value: '33' } });
    api.ocoValidate.mockResolvedValueOnce({
      ok: true,
      oco: { ...OCO, ocoNumber: '33', phase: 'inside' },
    });
    fireEvent.click(dugme('Sorgula'));
    // pencere icinde: is simdi baslatilir; sunucu bu kez kacirildi derse form geri gelir
    api.launchSs.mockResolvedValueOnce({ ok: false, ocoExpired: true });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Kesinti penceresi açık — işi şimdi başlat' }),
    );
    expect(await screen.findByText('OCO kaydınızı kaçırdınız.')).toBeTruthy();
    expect(api.launchSs.mock.calls.at(-1)![5]).toEqual({ ocoNumber: '33', ocoAction: undefined });
    expect(el('f-env')).toBeTruthy();
    api.launchSs.mockResolvedValueOnce({
      ok: false,
      ocoExpired: true,
      message: 'Pencere 02:00 kapandı.',
    });
    fireEvent.click(baslat());
    expect(await screen.findByText('Pencere 02:00 kapandı.')).toBeTruthy();
  });

  it('SA5 OCO ön uyarısı: ortam seçimine göre ton, admin ortam listesi, Smart notu', async () => {
    await formAc({ gates: { oco: true, ocoEnvironments: null, smart: true } });
    const uyari = screen.getByTestId('oco-prewarn');
    expect(uyari.getAttribute('data-tone')).toBe('info');
    expect(uyari.textContent).toContain('Bu serviste PRODUCTION seçilirse OCO sorulur.');
    expect(uyari.textContent).toContain('Smart onayı');
    ortamSec('prod');
    expect(screen.getByTestId('oco-prewarn').getAttribute('data-tone')).toBe('warning');
    expect(screen.getByTestId('oco-prewarn').textContent).toContain('Bu seçim için OCO gerekecek');
    ortamSec('test');
    expect(screen.getByTestId('oco-prewarn').getAttribute('data-tone')).toBe('info');
  });

  it('SA5b admin ortam listesi verdiyse uyarı o listeye göre; OCO kapalıysa uyarı yok', async () => {
    const env = alan({ name: 'ORTAM', label: 'Ortam adı', type: 'text' });
    await formAc({
      fields: [env],
      gates: { oco: true, ocoEnvironments: ['uat', 'prod'], smart: false },
    });
    const u = screen.getByTestId('oco-prewarn');
    expect(u.textContent).toContain('Bu serviste UAT, PROD seçilirse OCO sorulur.');
    expect(u.textContent).not.toContain('Smart onayı');
    fireEvent.change(el('f-ORTAM'), { target: { value: ' UAT ' } });
    expect(screen.getByTestId('oco-prewarn').getAttribute('data-tone')).toBe('warning');
    fireEvent.change(el('f-ORTAM'), { target: { value: 'production' } });
    expect(screen.getByTestId('oco-prewarn').getAttribute('data-tone')).toBe('info');
  });

  it('SA6 yerel okuma (nginx read) iş başlatmaz; parametresiz şablon; survey okunamadı; form temizleme', async () => {
    const alanlar = [
      alan({ name: 'action', label: 'Eylem', type: 'multiplechoice', choices: ['read', 'apply'] }),
      alan({ name: 'env', label: 'Ortam', type: 'text' }),
      alan({ name: 'servis', label: 'Servis', type: 'text' }),
      alan({ name: 'app', label: 'Uygulama', type: 'text' }),
    ];
    await formAc({
      fields: alanlar,
      yerelOkuma: { tur: 'nginx-tanimlar', eylemAlanlari: ['action'], deger: 'read' },
    });
    // bos formda "Formu Temizle" kapali
    const temizle = dugme(/Formu Temizle/) as HTMLButtonElement;
    expect(temizle.disabled).toBe(true);
    expect(temizle.title).toBe('Temizlenecek bir şey yok — form zaten boş.');
    fireEvent.change(el<HTMLSelectElement>('f-action'), { target: { value: 'read' } });
    fireEvent.change(el('f-env'), { target: { value: 'prod' } });
    fireEvent.change(el('f-servis'), { target: { value: 'WEBFORMS' } });
    fireEvent.change(el('f-app'), { target: { value: 'odeme' } });
    expect(JSON.parse(screen.getByTestId('tanim-okuma').textContent!)).toEqual({
      env: 'prod',
      service: 'WEBFORMS',
      application: 'odeme',
    });
    expect(screen.getByText('Read için iş başlatılmaz — tanımlar yukarıda.')).toBeTruthy();
    dugmeYok(/İş Başlat/);
    fireEvent.change(el<HTMLSelectElement>('f-action'), { target: { value: 'apply' } });
    expect(screen.queryByTestId('tanim-okuma')).toBeNull();
    expect(baslat()).toBeTruthy();
    expect((dugme(/Formu Temizle/) as HTMLButtonElement).title).toBe(
      'Girdiğiniz değerleri temizler',
    );
    fireEvent.click(dugme(/Formu Temizle/));
    expect(await screen.findByTestId('ss-form-reset-note')).toBeTruthy();
    await waitFor(() => expect(el<HTMLSelectElement>('f-action').value).toBe(''));
  });

  it('SA6d varsayılan değerli form: dokunulmamışken "Formu Temizle" kapalı, değişince açık', async () => {
    await formAc({ launchOptions: SECENEKLER(true) }); // port varsayilani 8080, verbosity 1, job type check
    const temizle = () => dugme(/Formu Temizle/) as HTMLButtonElement;
    expect(temizle().disabled).toBe(true);
    fireEvent.change(el('f-port'), { target: { value: '9090' } });
    expect(temizle().disabled).toBe(false);
    fireEvent.change(el('f-port'), { target: { value: '8080' } });
    expect(temizle().disabled).toBe(true);
    fireEvent.change(el<HTMLSelectElement>('lo-verb'), { target: { value: '0' } });
    expect(temizle().disabled).toBe(false);
    fireEvent.change(el<HTMLSelectElement>('lo-verb'), { target: { value: '1' } });
    ortamSec('test');
    expect(temizle().disabled).toBe(false);
    ortamSec('');
    expect(temizle().disabled).toBe(true);
    fireEvent.change(el('f-serbest'), { target: { value: '   ' } }); // yalniz bosluk "dolu" degil
    expect(temizle().disabled).toBe(true);
    fireEvent.change(el('lo-limit'), { target: { value: 'web01' } });
    expect(temizle().disabled).toBe(false);
  });

  it('SA6b parametresiz şablon ve survey okunamadı', async () => {
    api.surveySpec.mockResolvedValueOnce(
      spec({ fields: [], ok: false, message: 'Survey okunamadı: 403' }),
    );
    await ac();
    expect(await screen.findByText('Bu template için ek parametre gerekmez.')).toBeTruthy();
    expect(screen.getByText('Survey okunamadı: 403')).toBeTruthy();
  });

  it('SA6c survey isteği düşerse hata yazılır', async () => {
    api.surveySpec.mockRejectedValueOnce(new Error('AWX erişilemedi'));
    await ac();
    expect(await screen.findByText('AWX erişilemedi')).toBeTruthy();
  });

  it('SA7 katalogdan açılan pencere: İptal, iş sonrası Kapat, X', async () => {
    api.surveySpec.mockResolvedValue(spec({ fields: [] }));
    api.launchSs.mockResolvedValue({ ok: true, jobId: 31, status: 'pending' });
    await ac('/self-service');
    fireEvent.click((await screen.findAllByRole('button', { name: /^Başlat$/ }))[0]);
    expect(await screen.findByText('Parametreleri doldurup işi başlatın.')).toBeTruthy();
    fireEvent.click(dugme('İptal'));
    expect(screen.queryByText('Parametreleri doldurup işi başlatın.')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Başlat$/ })[0]);
    await screen.findByText('Bu template için ek parametre gerekmez.');
    fireEvent.click(baslat());
    expect(await screen.findByText('İş başlatıldı — AWX Job #31')).toBeTruthy();
    // iki "Kapat": baslikta X (aria-label), altta sonuc ekraninin dugmesi
    const kapatlar = screen.getAllByRole('button', { name: 'Kapat' });
    expect(kapatlar).toHaveLength(2);
    fireEvent.click(kapatlar[1]);
    expect(screen.queryByText('Parametreleri doldurup işi başlatın.')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Başlat$/ })[0]);
    await screen.findByText('Parametreleri doldurup işi başlatın.');
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByText('Parametreleri doldurup işi başlatın.')).toBeNull();
  });

  it('SA8 geçmiş penceresi: servise süzülür, log ayrıntısı', async () => {
    api.history.mockResolvedValue({
      ok: true,
      history: [
        {
          id: 1,
          username: 'yonetici',
          awx_server_id: 2,
          template_id: 42,
          template_name: 'Servis Başlat',
          job_id: 501,
          status: 'successful',
          started_at: '2026-11-26T10:00:00Z',
        },
        {
          id: 2,
          username: 'ali',
          awx_server_id: 2,
          template_id: 42,
          template_name: 'Servis Başlat',
          job_id: 0,
          status: 'pending',
          started_at: '2026-11-26T11:00:00Z',
        },
        {
          id: 3,
          username: 'veli',
          awx_server_id: 2,
          template_id: 99,
          template_name: 'Başka iş',
          job_id: 600,
          status: 'failed',
          started_at: '2026-11-26T12:00:00Z',
        },
        {
          id: 4,
          username: 'ayse',
          awx_server_id: 2,
          template_id: 42,
          template_name: 'Servis Başlat',
          job_id: 502,
          status: 'tuhaf',
          started_at: '2026-11-26T13:00:00Z',
        },
      ],
    });
    api.ssJobStatus
      .mockResolvedValueOnce({
        ok: true,
        status: 'failed',
        output: '',
        resultTraceback: 'Traceback (most recent call last)',
      })
      .mockRejectedValueOnce(new Error('AWX job silinmiş'))
      .mockResolvedValueOnce({ ok: true, status: 'running', output: '' })
      .mockResolvedValueOnce({ ok: true, status: '', output: '' });
    await formAc();
    fireEvent.click(dugme(/Geçmiş/));
    expect(await screen.findByText('Servis Başlat — geçmiş (son 30 gün)')).toBeTruthy();
    expect(api.history).toHaveBeenCalledWith(30);
    const satirlar = (await screen.findAllByRole('row')).slice(1);
    expect(satirlar).toHaveLength(3); // baska servisin isi suzulur
    expect(screen.queryByText('Başka iş')).toBeNull();
    expect(satirlar[1].getAttribute('title')).toBe('Bu kayıt için job ID yok');
    fireEvent.click(satirlar[1]);
    expect(api.ssJobStatus).not.toHaveBeenCalled();
    fireEvent.click(satirlar[0]);
    expect((await screen.findAllByText(/job #\s*501/)).length).toBeGreaterThan(0);
    expect(api.ssJobStatus).toHaveBeenCalledWith(2, 501);
    await waitFor(() => expect(screen.getAllByText('failed').length).toBeGreaterThan(0));
    const geri = () => screen.getAllByRole('button', { name: /Geçmiş/ }).at(-1)!; // pencere: "← Geçmiş"
    fireEvent.click(geri());
    fireEvent.click((await screen.findAllByRole('row'))[3]);
    expect(await screen.findByText('AWX job silinmiş')).toBeTruthy();
    fireEvent.click(geri());
    fireEvent.click((await screen.findAllByRole('row'))[1]);
    await waitFor(() => expect(api.ssJobStatus).toHaveBeenCalledTimes(3));
    expect(
      await screen.findByText('Job hâlâ çalışıyor — konsol çıktısı henüz oluşmadı.'),
    ).toBeTruthy();
    // AWX durum vermezse kayittaki durum yazilir; log yoksa "bulunamadi"
    fireEvent.click(geri());
    fireEvent.click((await screen.findAllByRole('row'))[3]);
    await waitFor(() => expect(api.ssJobStatus).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/Bu job için AWX'te log\/traceback bulunamadı/)).toBeTruthy();
    expect(screen.getAllByText('tuhaf').length).toBeGreaterThan(0);
  });

  it('SA8b geçmiş boş; okunamayan geçmiş "iş yok" demez, yeniden denenir', async () => {
    await formAc();
    fireEvent.click(dugme(/Geçmiş/));
    expect(await screen.findByText('Son 30 günde iş yok.')).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole('button').find((b) => b.closest('.max-w-2xl') && !b.textContent)!,
    );
    expect(screen.queryByText('Son 30 günde iş yok.')).toBeNull();

    api.history.mockResolvedValueOnce({
      ok: false,
      message: 'Geçmiş okunamadı: veritabanı yanıt vermedi',
    });
    fireEvent.click(dugme(/Geçmiş/));
    const hata = await screen.findByTestId('ss-gecmis-hata');
    expect(hata.textContent).toBe(
      'İş geçmişi okunamadıGeçmiş okunamadı: veritabanı yanıt vermediTekrar dene',
    );
    expect(screen.queryByText('Son 30 günde iş yok.')).toBeNull();
    api.history.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(within(hata).getByRole('button', { name: 'Tekrar dene' }));
    await waitFor(() =>
      expect(screen.getByTestId('ss-gecmis-hata').textContent).toBe(
        'İş geçmişi okunamadıağ yokTekrar dene',
      ),
    );
    fireEvent.click(
      within(screen.getByTestId('ss-gecmis-hata')).getByRole('button', { name: 'Tekrar dene' }),
    );
    expect(await screen.findByText('Son 30 günde iş yok.')).toBeTruthy();
    expect(screen.queryByTestId('ss-gecmis-hata')).toBeNull();
  });
});

function dugmeYok(ad: string | RegExp) {
  expect(screen.queryByRole('button', { name: ad })).toBeNull();
}
