// @vitest-environment jsdom
// Nginx Hub › Konfigurasyon sekmesi (2026-11-27, kapsam PR-2; NginxConsolePage ConfigTab dal dusuk).
//   NK1 sunucu listesi: servis gruplari, arama, secim, envanter uyarisi; liste okunamadi
//   NK2 dokum yenileme: secili, tum filo onayi, 20 ustu onay; is bitince liste ve agac BIR KEZ yenilenir
//   NK3 agac: dokum bilgisi, klasor ac / kapa, dokumsuz sunucu; okunamayan agac onceki sunucunun agacini gostermez
//   NK4 publish: onay penceresinde hedefler ve fark, iki sunucuya yayin, is bitince dosya yeniden okunur
//   NK5 publish hatalari: on kontrol cakismasi (force), baslatilamadi, ag hatasi, buyuk dosya farki
//   NK6 yeni dosya: yol dogrulama, baska sunucudan kopya, create publish
//   NK7 diger sunucularda: karsilastirma penceresi; okunamazsa bildirilir
//   NK8 gecmis: surumler, fark, su ankiyle, bu surume don; okunamayan gecmis "kayit yok" demez
//   NK9 salt okunur kullanici: yenileme, yeni dosya, yayin ve geri donus yok
//   NK10 Instances'tan acilan sunucu Konfigurasyon'da secili gelir
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import NginxConsolePage from '@/components/nginx_console/NginxConsolePage';
import type { NcChange, NcFile, NcHost, NcTree } from '@/api/nginxConsoleApi';

const api = vi.hoisted(() => ({
  hosts: vi.fn(),
  tree: vi.fn(),
  file: vi.fn(),
  compare: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  jobStatus: vi.fn(),
  history: vi.fn(),
  blob: vi.fn(),
  addJob: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  rol: 'Admin',
}));
vi.mock('@/api/nginxConsoleApi', async (orig) => {
  const gercek = await orig<typeof import('@/api/nginxConsoleApi')>();
  return {
    ...gercek,
    nginxConsoleApi: {
      ...gercek.nginxConsoleApi,
      hosts: api.hosts,
      tree: api.tree,
      file: api.file,
      compare: api.compare,
      push: api.push,
      refresh: api.refresh,
      jobStatus: api.jobStatus,
      history: api.history,
      blob: api.blob,
    },
  };
});
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'yonetici', role: api.rol }, canSee: () => true }),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: api.addJob }) }));
vi.mock('@/hooks/useToast', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useToast')>()),
  toast: api.toast,
}));

const IKI_SAAT_ONCE = new Date(Date.now() - 2 * 3600000).toISOString();
const sunucu = (host: string, o: Partial<NcHost> = {}): NcHost => ({
  host,
  env: 'prod',
  location: null,
  service: 'WEBFORMS',
  services: ['WEBFORMS'],
  nginxVersion: '1.24.0',
  prefix: '/usr/nginx',
  configCount: 3,
  ip: null,
  dumpedAt: IKI_SAAT_ONCE,
  seenAt: IKI_SAAT_ONCE,
  nginxT: 'ok',
  fileCount: 2,
  certCount: 0,
  certMinDays: null,
  ...o,
});
const SUNUCULAR: NcHost[] = [
  sunucu('ORNGXP01', {
    ip: '192.0.2.11',
    certMinDays: 20,
    services: ['WEBFORMS', 'ODEME', 'too_many'],
    etiket: { mod: 'ekle', etiketler: ['ODEME'], oto: ['WEBFORMS'] },
  }),
  sunucu('ORNGXP02', { nginxT: 'fail' }),
  sunucu('ORNGXP03', { dumpedAt: null, seenAt: null, nginxT: null }),
  sunucu('ORNGXP04'),
  sunucu('ORNGXP06'),
  sunucu('ORNGXT05', { env: 'test', service: 'API', services: ['API'] }),
];
// 20 ustu secim onayi icin dokumsuz bir grup (yayin hedeflerine girmez)
const YUK = Array.from({ length: 21 }, (_, i) =>
  sunucu(`ORYUKT${String(i + 10)}`, { service: 'YUK', services: ['YUK'], dumpedAt: null }),
);

const DOSYA = '/usr/nginx/conf.d/application-confs/odeme.conf';
const SHA = 'aaaaaaaaaa111111';
const SHA_ESKI = 'bbbbbbbbbb222222';
const SHA_ILK = 'cccccccccc333333';
const ICERIK = 'server {\n  listen 80;\n}\n';
const ICERIK2 = 'server {\n  listen 8080;\n}\n';

const agac = (host = 'ORNGXP01', o: Partial<NcTree> = {}): NcTree => ({
  ok: true,
  host,
  dumped: true,
  dumpedAt: IKI_SAAT_ONCE,
  prefix: '/usr/nginx',
  nginxT: { status: 'ok', output: 'syntax is ok' },
  fileCount: 2,
  certs: [],
  tree: {
    name: 'nginx',
    path: '/usr/nginx',
    dirs: [
      {
        name: 'conf.d',
        path: '/usr/nginx/conf.d',
        files: [],
        dirs: [
          {
            name: 'application-confs',
            path: '/usr/nginx/conf.d/application-confs',
            dirs: [],
            files: [
              { name: 'odeme.conf', path: DOSYA, size: 2048, mtime: '2026-11-20', sha256: SHA },
            ],
          },
        ],
      },
    ],
    files: [
      {
        name: 'nginx.conf',
        path: '/usr/nginx/conf/nginx.conf',
        size: 512,
        mtime: '2026-11-01',
        sha256: 'dddddddddd444444',
      },
    ],
  },
  ...o,
});
const dosya = (o: Partial<NcFile> = {}): NcFile => ({
  ok: true,
  host: 'ORNGXP01',
  path: DOSYA,
  sha256: SHA,
  size: 2048,
  mtime: '2026-11-20 10:00',
  content: ICERIK,
  tooLarge: false,
  ...o,
});
const surum = (o: Partial<NcChange>): NcChange => ({
  id: 1,
  host: 'ORNGXP01',
  path: DOSYA,
  oldSha256: null,
  newSha256: null,
  size: 1024,
  fileMtime: null,
  fileOwner: null,
  source: 'server',
  requester: null,
  jobId: null,
  seenAt: IKI_SAAT_ONCE,
  dumpTime: IKI_SAAT_ONCE,
  pending: false,
  hasOld: false,
  hasNew: false,
  ...o,
});

const editor = () => document.querySelector('section textarea') as HTMLTextAreaElement;
const dugme = (ad: string | RegExp) => screen.getByRole('button', { name: ad });
const dugmeYok = (ad: string | RegExp) =>
  expect(screen.queryByRole('button', { name: ad })).toBeNull();
const pencere = (ad: string | RegExp) => screen.getByRole('dialog', { name: ad });
const sonIs = () =>
  api.addJob.mock.calls.at(-1)![0] as { title: string; fetchStatus: () => Promise<unknown> };
const satirKutusu = (host: string) =>
  dugme(new RegExp(`^${host}`)).parentElement!.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement;

async function ac(giris = '/nginx-console?tab=config') {
  render(<NginxConsolePage />, { initialEntries: [giris] });
  await screen.findByRole('button', { name: /^WEBFORMS\d+$/ });
}
const grupAc = (ad: string) => fireEvent.click(dugme(new RegExp(`^${ad}\\d+$`)));
async function sunucuSec(host: string) {
  fireEvent.click(dugme(new RegExp(`^${host}`)));
  await waitFor(() => expect(api.tree).toHaveBeenCalledWith(host));
}
async function dosyaAc() {
  fireEvent.click(await screen.findByRole('button', { name: /^application-confs/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^odeme\.conf/ }));
  await waitFor(() => expect(editor().value).toBe(ICERIK));
}
const yaz = (deger: string) => fireEvent.change(editor(), { target: { value: deger } });

beforeEach(() => {
  vi.clearAllMocks();
  api.rol = 'Admin';
  api.hosts.mockResolvedValue({
    ok: true,
    hosts: SUNUCULAR,
    consoleDir: '/sw',
    inventoryError: '',
  });
  api.tree.mockImplementation(async (h: string) => agac(h));
  api.file.mockResolvedValue(dosya());
  api.compare.mockResolvedValue({ ok: true, path: DOSYA, rows: [], variants: 1 });
  api.jobStatus.mockResolvedValue({ ok: true, status: 'successful', output: '' });
  api.history.mockResolvedValue({ ok: true, versions: [] });
});

describe('Nginx Hub › Konfigürasyon', () => {
  it('NK1 sunucu listesi: servis grupları, arama, seçim, envanter uyarısı', async () => {
    api.hosts.mockResolvedValue({
      ok: true,
      hosts: SUNUCULAR,
      consoleDir: '/sw',
      inventoryError: 'zaman aşımı',
    });
    await ac();
    expect(
      screen.getByText(
        'Envanter okunamadı (zaman aşımı); yalnız dokumu olan sunucular listelendi.',
      ),
    ).toBeTruthy();
    // gruplar ada gore sirali, kapali gelir
    const api_ = dugme(/^API\d+$/);
    const web = dugme(/^WEBFORMS\d+$/);
    expect(api_.compareDocumentPosition(web) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(web.textContent).toBe('WEBFORMS5');
    dugmeYok(/^ORNGXP01/);
    grupAc('WEBFORMS');
    expect(dugme(/^ORNGXP01/)).toBeTruthy();
    expect(screen.getByTitle('ORNGXP01 · 192.0.2.11 · nginx 1.24.0')).toBeTruthy();
    expect(
      screen.getByTitle(/^dokum 2 sa önce · nginx -t ok · en yakın sertifika 20 gün$/),
    ).toBeTruthy();
    expect(screen.getByTitle(/^dokum 2 sa önce · nginx -t fail$/)).toBeTruthy();
    expect(screen.getByTitle('dokum yok — Yenile')).toBeTruthy();
    grupAc('WEBFORMS');
    dugmeYok(/^ORNGXP01/);

    // arama: ortam, servis, sunucu adi (aramada gruplar acik gelir)
    const ara = screen.getByRole('textbox', { name: 'Sunucu ara' });
    fireEvent.change(ara, { target: { value: 'tes' } }); // ortamin bir parcasi
    expect(dugme(/^ORNGXT05/)).toBeTruthy();
    dugmeYok(/^WEBFORMS\d+$/);
    fireEvent.change(ara, { target: { value: 'WebForms' } });
    expect(dugme(/^ORNGXP02/)).toBeTruthy();
    dugmeYok(/^API\d+$/);
    fireEvent.change(ara, { target: { value: 'p04' } });
    expect(dugme(/^ORNGXP04/)).toBeTruthy();
    dugmeYok(/^ORNGXP02/);
    fireEvent.change(ara, { target: { value: 'boyle-biri-yok' } });
    expect(screen.getByText('Sunucu yok.')).toBeTruthy();
    fireEvent.change(ara, { target: { value: '' } });

    // secim: grup kutusu tumunu secer / birakir; satir kutusu tek tek; Temizle
    const grupKutulari = screen.getAllByRole('checkbox', { name: 'servisin tüm sunucularını seç' });
    fireEvent.click(grupKutulari[1]);
    expect(dugme('Seçilileri yenile (5)')).toBeTruthy();
    expect((grupKutulari[1] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(grupKutulari[1]);
    expect((dugme('Seçilileri yenile') as HTMLButtonElement).disabled).toBe(true);
    dugmeYok('Temizle');
    grupAc('WEBFORMS');
    fireEvent.click(satirKutusu('ORNGXP01'));
    expect(dugme('Seçilileri yenile (1)')).toBeTruthy();
    fireEvent.click(satirKutusu('ORNGXP01'));
    expect((dugme('Seçilileri yenile') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(satirKutusu('ORNGXP02'));
    fireEvent.click(dugme('Temizle'));
    expect((dugme('Seçilileri yenile') as HTMLButtonElement).disabled).toBe(true);
    expect(api.tree).not.toHaveBeenCalled(); // kutu isaretlemek sunucuyu acmaz
  });

  it('NK1b sunucu listesi okunamadı: hata yazılır', async () => {
    api.hosts.mockResolvedValueOnce({ ok: false, message: 'liste ucu 500' });
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=config'] });
    expect(await screen.findByText('liste ucu 500')).toBeTruthy();
    expect(screen.getByText('Sunucu yok.')).toBeTruthy();
  });

  it('NK1c sunucu listesi ağ hatası ve mesajsız red', async () => {
    api.hosts.mockRejectedValueOnce(new Error('ağ yok'));
    const { unmount } = render(<NginxConsolePage />, {
      initialEntries: ['/nginx-console?tab=config'],
    });
    expect(await screen.findByText('ağ yok')).toBeTruthy();
    unmount();
    api.hosts.mockResolvedValueOnce({ ok: false });
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=config'] });
    expect(await screen.findByText('Sunucu listesi alınamadı.')).toBeTruthy();
  });

  it('NK2 döküm yenileme: seçili, tüm filo onayı, 20 üstü onay; iş bitince liste ve ağaç bir kez yenilenir', async () => {
    api.hosts.mockResolvedValue({ ok: true, hosts: [...SUNUCULAR, ...YUK], inventoryError: '' });
    api.refresh.mockResolvedValue({
      ok: true,
      jobId: 41,
      status: 'pending',
      awxServerId: 3,
      hosts: [],
    });
    await ac();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    fireEvent.click(satirKutusu('ORNGXP01'));
    fireEvent.click(satirKutusu('ORNGXP02'));
    fireEvent.click(dugme('Seçilileri yenile (2)'));
    await waitFor(() => expect(api.refresh).toHaveBeenCalledWith(['ORNGXP01', 'ORNGXP02'], false));
    expect(api.toast.success).toHaveBeenCalledWith(
      'Dokum başlatıldı (job 41) — bitince liste kendini yeniler.',
    );
    await waitFor(() => expect(api.addJob).toHaveBeenCalledTimes(1));
    expect(sonIs().title).toBe('Nginx dokum · 2 sunucu #41');
    const listeOnce = api.hosts.mock.calls.length;
    const agacOnce = api.tree.mock.calls.length;
    api.jobStatus.mockResolvedValueOnce({ ok: true, status: 'running', output: 'TASK' });
    await expect(sonIs().fetchStatus()).resolves.toEqual({
      status: 'running',
      output: 'TASK',
      result: undefined,
    });
    expect(api.hosts.mock.calls.length).toBe(listeOnce);
    await act(async () => {
      await sonIs().fetchStatus();
      await sonIs().fetchStatus();
    });
    expect(api.jobStatus).toHaveBeenCalledWith(3, 41);
    await waitFor(() => expect(api.hosts.mock.calls.length).toBe(listeOnce + 1));
    expect(api.tree.mock.calls.length).toBe(agacOnce + 1);
    api.jobStatus.mockResolvedValueOnce({ ok: false, message: 'AWX yanıt vermedi' });
    await expect(sonIs().fetchStatus()).rejects.toThrow('AWX yanıt vermedi');
    api.jobStatus.mockResolvedValueOnce({ ok: false });
    await expect(sonIs().fetchStatus()).rejects.toThrow('Durum okunamadı.');

    // tum filo: Portal ici onay; Iptal hicbir sey baslatmaz
    fireEvent.click(dugme('Tüm filo'));
    const onay = pencere('Tüm filoyu yenile');
    expect(within(onay).getByText('27').tagName).toBe('B');
    fireEvent.click(within(onay).getByRole('button', { name: 'İptal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.refresh).toHaveBeenCalledTimes(1);
    api.refresh.mockResolvedValueOnce({ ok: true, jobId: 42, status: 'pending', awxServerId: 3 });
    fireEvent.click(dugme('Tüm filo'));
    fireEvent.click(within(pencere('Tüm filoyu yenile')).getByRole('button', { name: 'Başlat' }));
    await waitFor(() => expect(api.refresh).toHaveBeenLastCalledWith([], true));
    await waitFor(() => expect(sonIs().title).toBe('Nginx dokum · TÜM filo #42'));
    const agacTum = api.tree.mock.calls.length;
    await act(async () => {
      await sonIs().fetchStatus();
    });
    await waitFor(() => expect(api.tree.mock.calls.length).toBe(agacTum + 1));

    // 20 ustu secim onay ister
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'servisin tüm sunucularını seç' })[2]);
    fireEvent.click(dugme('Seçilileri yenile (23)'));
    const yirmi = pencere('23 sunucuyu yenile');
    expect(within(yirmi).getByText('23 sunucunun dokumu alınacak. Devam edilsin mi?')).toBeTruthy();
    fireEvent.click(within(yirmi).getByRole('button', { name: 'Başlat' }));
    await waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(3));
    expect(api.refresh.mock.calls[2][0]).toHaveLength(23);
    expect(api.refresh.mock.calls[2][1]).toBe(false);
    // acik sunucu listede degilse is bitince agac yenilenmez
    const agac23 = api.tree.mock.calls.length;
    fireEvent.click(dugme('Temizle'));
    fireEvent.click(satirKutusu('ORNGXP02'));
    api.refresh.mockResolvedValueOnce({ ok: true, jobId: 44, status: 'pending', awxServerId: 3 });
    fireEvent.click(dugme('Seçilileri yenile (1)'));
    await waitFor(() => expect(sonIs().title).toBe('Nginx dokum · 1 sunucu #44'));
    await act(async () => {
      await sonIs().fetchStatus();
    });
    expect(api.tree.mock.calls.length).toBe(agac23);

    // tek sunucu Yenile (agac paneli); baslatilamadi / ag hatasi / is numarasiz
    api.refresh.mockResolvedValueOnce({ ok: false, message: 'AWX şablonu yok' });
    fireEvent.click(dugme('Yenile'));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('AWX şablonu yok'));
    expect(api.refresh).toHaveBeenLastCalledWith(['ORNGXP01'], false);
    api.refresh.mockResolvedValueOnce({ ok: false });
    fireEvent.click(dugme('Yenile'));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('Başlatılamadı.'));
    api.refresh.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(dugme('Yenile'));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('ağ yok'));
    const isSayisi = api.addJob.mock.calls.length;
    api.refresh.mockResolvedValueOnce({ ok: true, jobId: null, status: null, awxServerId: 3 });
    fireEvent.click(dugme('Yenile'));
    await waitFor(() =>
      expect(api.toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/job null/)),
    );
    expect(api.addJob.mock.calls.length).toBe(isSayisi);
  });

  it('NK3 ağaç: döküm bilgisi, klasör aç / kapa, dökümsüz sunucu; okunamayan ağaç önceki sunucunun ağacını göstermez', async () => {
    let p04Duzeldi = false;
    api.tree.mockImplementation(async (h: string) => {
      if (h === 'ORNGXP02')
        return agac(h, { nginxT: { status: 'fail', output: 'emerg: unknown directive' } });
      if (h === 'ORNGXP03')
        return { ok: true, host: h, dumped: false, message: 'Bu sunucunun dokumu yok — Yenile.' };
      if (h === 'ORNGXP04' && !p04Duzeldi) throw new Error('HTTP 502');
      return agac(h);
    });
    await ac();
    expect(screen.getByText('Soldan bir sunucu seçin.')).toBeTruthy();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    expect(await screen.findByText(/\(2 sa önce\)/)).toBeTruthy();
    const pill = screen.getByText('nginx -t ok');
    expect(pill.closest('[title]')?.getAttribute('title')).toBe('syntax is ok');
    expect(screen.getByText('2 dosya · 0 sertifika')).toBeTruthy();
    const servis = screen.getByText(/^servis WEBFORMS, ODEME \(elle\)$/);
    expect(servis.getAttribute('title')).toBe('Elle etiket (Envanter) · conf.d: WEBFORMS');
    expect(dugme(/^ORNGXP01/).getAttribute('aria-current')).toBe('true');
    // derinlik 2 klasor kapali gelir; acilip kapanir
    expect(dugme(/^nginx\.conf/)).toBeTruthy();
    dugmeYok(/^odeme\.conf/);
    fireEvent.click(dugme(/^application-confs/));
    expect(dugme(/^odeme\.conf/).getAttribute('title')).toBe(
      '2.0 KB · 2026-11-20 · sha aaaaaaaaaa',
    );
    fireEvent.click(dugme(/^application-confs/));
    dugmeYok(/^odeme\.conf/);
    fireEvent.click(dugme(/^conf\.d/));
    dugmeYok(/^application-confs/);

    await sunucuSec('ORNGXP02');
    expect(await screen.findByText('nginx -t fail')).toBeTruthy();
    await sunucuSec('ORNGXP03');
    expect(await screen.findByText('Bu sunucunun dokumu yok — Yenile.')).toBeTruthy();
    expect((dugme('Yeni dosya') as HTMLButtonElement).disabled).toBe(true);

    await sunucuSec('ORNGXP01');
    await screen.findByRole('button', { name: /^nginx\.conf/ });
    await sunucuSec('ORNGXP04');
    const hata = await screen.findByTestId('nc-agac-hata');
    expect(hata.textContent).toBe('Konfigürasyon ağacı okunamadıHTTP 502Tekrar dene');
    dugmeYok(/^nginx\.conf/);
    expect((dugme('Yeni dosya') as HTMLButtonElement).disabled).toBe(true);
    p04Duzeldi = true;
    fireEvent.click(within(hata).getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByRole('button', { name: /^nginx\.conf/ })).toBeTruthy();
    expect(screen.queryByTestId('nc-agac-hata')).toBeNull();
  });

  it('NK4 publish: onay penceresinde hedefler ve fark, iki sunucuya yayın, iş bitince dosya yeniden okunur', async () => {
    api.compare.mockResolvedValue({
      ok: true,
      path: DOSYA,
      variants: 2,
      rows: [
        { host: 'ORNGXP01', exists: true, sha256: SHA, size: 2048, mtime: null },
        { host: 'ORNGXP02', exists: true, sha256: SHA_ESKI, size: 2000, mtime: null },
        { host: 'ORNGXP04', exists: true, sha256: SHA, size: 2048, mtime: null },
        { host: 'ORNGXP06', exists: false, sha256: null, size: null, mtime: null },
      ],
    });
    api.push.mockResolvedValue({ ok: true, jobId: 77, status: 'pending', awxServerId: 3 });
    await ac();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    expect(screen.getByText('Ağaçtan bir dosya seçin ya da "Yeni dosya" oluşturun.')).toBeTruthy();
    await dosyaAc();
    expect(api.file).toHaveBeenCalledWith('ORNGXP01', DOSYA);
    expect(screen.getAllByText('odeme.conf').length).toBeGreaterThan(0);
    expect(screen.getByText('sha aaaaaaaaaa').parentElement!.textContent).toBe(
      `${DOSYA}sha aaaaaaaaaa2.0 KBdeğişim 2026-11-20 10:00`,
    );
    expect((dugme('Yayınla (Publish)') as HTMLButtonElement).disabled).toBe(true);
    expect((dugme('Geri al') as HTMLButtonElement).disabled).toBe(true);

    yaz(ICERIK2);
    expect(screen.getByText("değişti — push'lanmadı")).toBeTruthy();
    fireEvent.click(dugme('Geri al'));
    expect(editor().value).toBe(ICERIK);
    expect(screen.queryByText("değişti — push'lanmadı")).toBeNull();
    yaz(ICERIK2);

    fireEvent.click(dugme('Yayınla (Publish)'));
    const onay = await screen.findByRole('dialog', { name: 'Publish · değişiklik' });
    expect(api.compare).toHaveBeenCalledWith(DOSYA, [
      'ORNGXP01',
      'ORNGXP02',
      'ORNGXP04',
      'ORNGXP06',
    ]);
    expect(within(onay).getByText('— WEBFORMS grubu')).toBeTruthy();
    const kutu = (h: string) =>
      within(onay).getByRole('checkbox', { name: new RegExp(`^${h}`) }) as HTMLInputElement;
    expect(kutu('ORNGXP01').checked).toBe(true);
    expect(kutu('ORNGXP02').checked).toBe(false);
    expect(within(onay).queryByRole('checkbox', { name: /ORNGXP03/ })).toBeNull(); // dokumsuz
    expect(kutu('ORNGXP02').closest('label')!.textContent).toBe('ORNGXP02farklı');
    expect(kutu('ORNGXP02').closest('label')!.getAttribute('title')).toBe(
      'sha bbbbbbbbbb (FARKLI sürüm)',
    );
    expect(kutu('ORNGXP04').closest('label')!.textContent).toBe('ORNGXP04aynı');
    expect(kutu('ORNGXP04').closest('label')!.getAttribute('title')).toBe('sha aaaaaaaaaa (aynı)');
    expect(kutu('ORNGXP06').closest('label')!.textContent).toBe('ORNGXP06yok');
    expect(kutu('ORNGXP06').closest('label')!.getAttribute('title')).toBe('dosya bu sunucuda yok');
    expect(kutu('ORNGXP01').closest('label')!.textContent).toBe('ORNGXP01');
    expect(within(onay).getByText(/"farklı": o sunucudaki dosya/)).toBeTruthy();
    expect(within(onay).getByText('+1')).toBeTruthy();
    expect(within(onay).getByText('−1')).toBeTruthy();
    expect(within(onay).getByText('- listen 80;').getAttribute('style')).toContain(
      '--status-danger',
    );
    expect(within(onay).getByText('+ listen 8080;').getAttribute('style')).toContain(
      '--status-success',
    );
    expect(within(onay).getByText('server {').getAttribute('style')).toBeNull();

    fireEvent.click(kutu('ORNGXP01'));
    expect(
      (within(onay).getByRole('button', { name: 'Yayınla (0 sunucu)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(kutu('ORNGXP01'));
    fireEvent.click(kutu('ORNGXP02'));
    fireEvent.click(within(onay).getByRole('button', { name: 'Yayınla (2 sunucu)' }));
    await waitFor(() =>
      expect(api.push).toHaveBeenCalledWith({
        hosts: ['ORNGXP01', 'ORNGXP02'],
        path: DOSYA,
        mode: 'update',
        content: ICERIK2,
        expectedSha: { ORNGXP01: SHA, ORNGXP02: SHA_ESKI },
        force: false,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.toast.success).toHaveBeenCalledWith(
      'Publish başlatıldı (job 77, 2 sunucu) — sonuç iş penceresinde; bitince dosya yeniden okunur.',
    );
    expect(sonIs().title).toBe('Nginx publish · odeme.conf → 2 sunucu #77');
    const [agac0, dosya0, liste0] = [api.tree, api.file, api.hosts].map((f) => f.mock.calls.length);
    api.file.mockResolvedValue(dosya({ content: ICERIK2, sha256: 'eeeeeeeeee555555' }));
    await act(async () => {
      await sonIs().fetchStatus();
    });
    await waitFor(() => expect(api.hosts.mock.calls.length).toBe(liste0 + 1));
    expect(api.tree.mock.calls.length).toBe(agac0 + 1);
    expect(api.file.mock.calls.length).toBe(dosya0 + 1);
    await waitFor(() => expect(screen.getByText('sha eeeeeeeeee')).toBeTruthy());
    expect(screen.queryByText("değişti — push'lanmadı")).toBeNull();
  });

  it('NK5 publish hataları: ön kontrol çakışması (force), başlatılamadı, ağ hatası, büyük dosya farkı', async () => {
    api.compare.mockRejectedValueOnce(new Error('karşılaştırma ucu düştü'));
    await ac();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    await dosyaAc();
    yaz(ICERIK2);
    fireEvent.click(dugme('Yayınla (Publish)'));
    const onay = await screen.findByRole('dialog', { name: 'Publish · değişiklik' });
    // karsilastirma okunamadi: pencere yine acilir, diger sunucularda durum yazmaz
    expect(
      within(onay)
        .getByRole('checkbox', { name: /^ORNGXP02/ })
        .closest('label')!.textContent,
    ).toBe('ORNGXP02');

    api.push
      .mockResolvedValueOnce({
        ok: false,
        jobId: null,
        status: null,
        awxServerId: 3,
        message: 'ORNGXP01: sunucudaki sürüm değişti',
        conflicts: [{ host: 'ORNGXP01', reason: 'sha' }],
      })
      .mockResolvedValueOnce({ ok: true, jobId: 78, status: 'pending', awxServerId: 3 });
    fireEvent.click(within(onay).getByRole('button', { name: 'Yayınla (1 sunucu)' }));
    const uyari = await screen.findByRole('dialog', { name: 'Ön kontrol uyarısı' });
    expect(within(uyari).getByText('ORNGXP01: sunucudaki sürüm değişti')).toBeTruthy();
    expect(within(uyari).getByText(/Force ile sunucudaki mevcut hal üzerine yazılır/)).toBeTruthy();
    fireEvent.click(within(uyari).getByRole('button', { name: 'Yine de yayınla (force)' }));
    await waitFor(() => expect(api.push).toHaveBeenCalledTimes(2));
    expect(api.push.mock.calls[1][0]).toMatchObject({
      force: true,
      expectedSha: { ORNGXP01: SHA },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sonIs().title).toBe('Nginx publish · odeme.conf → ORNGXP01 #78');

    // baslatilamadi (cakismasiz) ve ag hatasi: pencere acik kalir, hata bildirilir
    fireEvent.click(dugme('Yayınla (Publish)'));
    const onay2 = await screen.findByRole('dialog', { name: 'Publish · değişiklik' });
    api.push.mockResolvedValueOnce({
      ok: false,
      jobId: null,
      status: null,
      awxServerId: 3,
      message: 'kilit alınamadı',
    });
    fireEvent.click(within(onay2).getByRole('button', { name: 'Yayınla (1 sunucu)' }));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('kilit alınamadı'));
    api.push.mockResolvedValueOnce({
      ok: false,
      jobId: null,
      status: null,
      awxServerId: 3,
      conflicts: [],
    });
    fireEvent.click(within(onay2).getByRole('button', { name: 'Yayınla (1 sunucu)' }));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('Publish başlatılamadı.'));
    api.push.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(within(onay2).getByRole('button', { name: 'Yayınla (1 sunucu)' }));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('ağ yok'));
    expect(pencere('Publish · değişiklik')).toBeTruthy();
    fireEvent.click(within(onay2).getByRole('button', { name: 'İptal' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // birbirinden uzak iki degisiklik: aralar "…" ile kisalir
    const uzun = Array.from({ length: 12 }, (_, i) => `satir ${i}`).join('\n');
    api.file.mockResolvedValueOnce(dosya({ content: uzun }));
    fireEvent.click(dugme(/^odeme\.conf/));
    await waitFor(() => expect(editor().value).toBe(uzun));
    yaz(uzun.replace('satir 0', 'SATIR 0').replace('satir 11', 'SATIR 11'));
    fireEvent.click(dugme('Yayınla (Publish)'));
    const onay3 = await screen.findByRole('dialog', { name: 'Publish · değişiklik' });
    expect(within(onay3).getByText('…')).toBeTruthy();
    expect(within(onay3).getByText('+2')).toBeTruthy();
    expect(within(onay3).queryByText('satir 5')).toBeNull();
    fireEvent.click(within(onay3).getByRole('button', { name: 'İptal' }));

    // buyuk dosya: satir satir fark yerine yalniz sayilar
    const buyuk = Array.from({ length: 3001 }, (_, i) => `b${i}`).join('\n');
    api.file.mockResolvedValueOnce(dosya({ content: buyuk }));
    fireEvent.click(dugme(/^odeme\.conf/));
    await waitFor(() => expect(editor().value).toBe(buyuk));
    yaz(buyuk.replace('b7\n', 'X7\n'));
    fireEvent.click(dugme('Yayınla (Publish)'));
    const onay4 = await screen.findByRole('dialog', { name: 'Publish · değişiklik' });
    expect(within(onay4).getByText('(dosya büyük — satır satır fark gösterilmiyor)')).toBeTruthy();
    expect(within(onay4).getByText('+1')).toBeTruthy();
    expect(within(onay4).getByText('−1')).toBeTruthy();
  });

  it('NK6 yeni dosya: yol doğrulama, başka sunucudan kopya, create publish', async () => {
    api.file.mockImplementation(async (h: string, p: string) =>
      h === 'ORNGXT05'
        ? dosya({ host: h, path: p, content: 'upstream api {}\n' })
        : dosya({ host: h, path: p, content: '' }),
    );
    api.compare.mockResolvedValue({
      ok: true,
      path: '',
      variants: 0,
      rows: [{ host: 'ORNGXP02', exists: false, sha256: null, size: null, mtime: null }],
    });
    api.push.mockResolvedValue({ ok: true, jobId: 90, status: 'pending', awxServerId: 3 });
    await ac();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    await screen.findByRole('button', { name: /^nginx\.conf/ });
    fireEvent.click(dugme('Yeni dosya'));
    const p = pencere('ORNGXP01 · yeni konfigürasyon dosyası');
    const yol = within(p).getByDisplayValue(
      '/usr/nginx/conf.d/application-confs/',
    ) as HTMLInputElement;
    const al = within(p).getByRole('button', { name: 'Editöre al' }) as HTMLButtonElement;
    expect(al.disabled).toBe(true); // "/" ile biten yol
    const [kaynak, kaynakDosya] = within(p).getAllByRole('combobox') as HTMLSelectElement[];
    expect([...kaynak.options].map((o) => o.textContent)).toEqual([
      '— sunucu —',
      'ORNGXP01 (WEBFORMS)',
      'ORNGXP02 (WEBFORMS)',
      'ORNGXP04 (WEBFORMS)',
      'ORNGXP06 (WEBFORMS)',
      'ORNGXT05 (API)',
    ]);
    expect(kaynakDosya.disabled).toBe(true);
    await act(async () => {
      fireEvent.change(kaynak, { target: { value: 'ORNGXT05' } });
    });
    await waitFor(() => expect(kaynakDosya.disabled).toBe(false));
    expect(api.tree).toHaveBeenLastCalledWith('ORNGXT05');
    expect([...kaynakDosya.options].map((o) => o.textContent)).toEqual([
      '— dosya —',
      'conf/nginx.conf',
      'conf.d/application-confs/odeme.conf',
    ]);
    await act(async () => {
      fireEvent.change(kaynakDosya, { target: { value: DOSYA } });
    });
    await waitFor(() => expect(yol.value).toBe(DOSYA));
    expect(api.file).toHaveBeenLastCalledWith('ORNGXT05', DOSYA);
    expect((within(p).getByPlaceholderText(/içerik/) as HTMLTextAreaElement).value).toBe(
      'upstream api {}\n',
    );
    expect(al.disabled).toBe(false);
    // okunamayan kaynak dosya icerigi ve yolu degistirmez
    api.file.mockResolvedValueOnce({ ...dosya(), ok: false, message: 'yok' });
    await act(async () => {
      fireEvent.change(kaynakDosya, { target: { value: '/usr/nginx/conf/nginx.conf' } });
    });
    expect((within(p).getByPlaceholderText(/içerik/) as HTMLTextAreaElement).value).toBe(
      'upstream api {}\n',
    );
    expect(yol.value).toBe(DOSYA);
    // kaynak sunucu birakilinca dosya listesi kapanir
    await act(async () => {
      fireEvent.change(kaynak, { target: { value: '' } });
    });
    expect(kaynakDosya.disabled).toBe(true);
    // yol kurallari: yalniz /usr/nginx/conf(.d) alti, ".." yok
    for (const kotu of [
      '/usr/nginx/conf.d/../gizli.conf',
      '/etc/nginx/x.conf',
      '/usr/nginx/html/x.conf',
    ]) {
      fireEvent.change(yol, { target: { value: kotu } });
      expect(al.disabled).toBe(true);
    }
    fireEvent.change(yol, { target: { value: '/usr/nginx/conf.d/application-confs/yeni.conf' } });
    expect(al.disabled).toBe(false);
    fireEvent.click(al);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTitle('/usr/nginx/conf.d/application-confs/yeni.conf').textContent).toBe(
      'Yeni dosya · yeni.conf',
    );
    expect(editor().value).toBe('upstream api {}\n');
    dugmeYok('Geçmiş');

    fireEvent.click(dugme('Yayınla (Publish)'));
    const onay = await screen.findByRole('dialog', { name: 'Publish · yeni dosya' });
    expect(
      within(onay)
        .getByRole('checkbox', { name: /^ORNGXP02/ })
        .closest('label')!.textContent,
    ).toBe('ORNGXP02yeni');
    expect(within(onay).getByText('+1')).toBeTruthy();
    expect(within(onay).getByText('−0')).toBeTruthy();
    expect(within(onay).getByText('+ upstream api {}')).toBeTruthy();
    fireEvent.click(within(onay).getByRole('button', { name: 'Yayınla (1 sunucu)' }));
    await waitFor(() =>
      expect(api.push).toHaveBeenCalledWith({
        hosts: ['ORNGXP01'],
        path: '/usr/nginx/conf.d/application-confs/yeni.conf',
        mode: 'create',
        content: 'upstream api {}\n',
        expectedSha: {},
        force: false,
      }),
    );
    expect(sonIs().title).toBe('Nginx publish · yeni.conf → ORNGXP01 #90');
    await act(async () => {
      await sonIs().fetchStatus();
    });
    await waitFor(() =>
      expect(api.file).toHaveBeenLastCalledWith(
        'ORNGXP01',
        '/usr/nginx/conf.d/application-confs/yeni.conf',
      ),
    );
    expect(dugme('Geçmiş')).toBeTruthy(); // update kipine dondu

    // create kipinde Geri al: editor bosalir, update kipine doner
    fireEvent.click(dugme('Yeni dosya'));
    fireEvent.change(
      within(pencere(/yeni konfigürasyon dosyası/)).getByRole('textbox', { name: /Dosya yolu/ }),
      {
        target: { value: '/usr/nginx/conf/ek.conf' },
      },
    );
    fireEvent.change(within(pencere(/yeni konfigürasyon dosyası/)).getByPlaceholderText(/içerik/), {
      target: { value: '  \n' },
    });
    fireEvent.click(
      within(pencere(/yeni konfigürasyon dosyası/)).getByRole('button', { name: 'Editöre al' }),
    );
    expect(screen.getByTitle('/usr/nginx/conf/ek.conf')).toBeTruthy();
    // yalniz bosluk iceren yeni dosya yayinlanamaz
    expect((dugme('Yayınla (Publish)') as HTMLButtonElement).disabled).toBe(true);
    expect((dugme('Geri al') as HTMLButtonElement).disabled).toBe(true);
    yaz('x');
    expect((dugme('Yayınla (Publish)') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dugme('Geri al'));
    expect(screen.queryByTitle('/usr/nginx/conf/ek.conf')).toBeNull();
    expect(screen.getByText('Ağaçtan bir dosya seçin ya da "Yeni dosya" oluşturun.')).toBeTruthy();
    // Iptal pencereyi kapatir
    fireEvent.click(dugme('Yeni dosya'));
    fireEvent.click(
      within(pencere(/yeni konfigürasyon dosyası/)).getByRole('button', { name: 'İptal' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('NK7 diğer sunucularda: karşılaştırma penceresi; okunamazsa bildirilir', async () => {
    await ac();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    await dosyaAc();
    api.compare.mockResolvedValueOnce({
      ok: true,
      path: DOSYA,
      variants: 1,
      rows: [
        { host: 'ORNGXP01', exists: true, sha256: SHA, size: 2048, mtime: '2026-11-20 10:00' },
        { host: 'ORNGXP02', exists: false, sha256: null, size: null, mtime: null },
      ],
    });
    fireEvent.click(dugme('Diğer sunucularda'));
    const p = await screen.findByRole('dialog', { name: 'Diğer sunucularda' });
    expect(api.compare).toHaveBeenLastCalledWith(DOSYA);
    expect(within(p).getByText('1 sunucuda var · 1 farklı sürüm')).toBeTruthy();
    const satirlar = within(p).getAllByRole('row').slice(1);
    expect(satirlar.map((r) => r.textContent)).toEqual([
      'ORNGXP01aaaaaaaaaa2026-11-20 10:00',
      'ORNGXP02yok',
    ]);
    fireEvent.click(within(p).getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    api.compare.mockResolvedValueOnce({ ok: false, message: 'karşılaştırma okunamadı: HTTP 403' });
    fireEvent.click(dugme('Diğer sunucularda'));
    await waitFor(() =>
      expect(api.toast.error).toHaveBeenCalledWith('karşılaştırma okunamadı: HTTP 403'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    api.compare.mockResolvedValueOnce({ ok: false });
    fireEvent.click(dugme('Diğer sunucularda'));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('Karşılaştırma okunamadı.'));
    api.compare.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(dugme('Diğer sunucularda'));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('ağ yok'));

    // dosya okunamadi: editor degismez, hata bildirilir
    api.file.mockResolvedValueOnce({ ...dosya(), ok: false, message: 'izin yok' });
    fireEvent.click(dugme(/^nginx\.conf/));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('izin yok'));
    api.file.mockResolvedValueOnce({ ...dosya(), ok: false });
    fireEvent.click(dugme(/^nginx\.conf/));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('Dosya okunamadı.'));
    expect(editor().value).toBe(ICERIK);
  });

  it('NK8 geçmiş: sürümler, fark, şu ankiyle, bu sürüme dön; okunamayan geçmiş "kayıt yok" demez', async () => {
    api.history.mockResolvedValue({
      ok: true,
      versions: [
        surum({
          id: 3,
          source: 'portal-publish',
          requester: 'yonetici',
          jobId: 77,
          oldSha256: SHA_ESKI,
          newSha256: SHA,
          hasOld: true,
          hasNew: true,
          pending: true,
          size: 2048,
        }),
        surum({
          id: 2,
          fileOwner: 'nginx',
          oldSha256: SHA_ILK,
          newSha256: SHA_ESKI,
          hasOld: true,
          hasNew: true,
        }),
        surum({ id: 1, source: 'first-seen', newSha256: SHA_ILK, hasNew: false, size: null }),
        surum({ id: 0, source: 'deleted' as NcChange['source'], newSha256: null }),
      ],
    });
    const icerik: Record<string, string> = {
      [SHA]: ICERIK,
      [SHA_ESKI]: ICERIK2,
      [SHA_ILK]: ICERIK,
    };
    api.blob.mockImplementation(async (sha: string) => ({
      ok: true,
      sha256: sha,
      content: icerik[sha],
    }));
    await ac();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    await dosyaAc();
    fireEvent.click(dugme('Geçmiş'));
    await screen.findByText('Portal publish');
    expect(api.history).toHaveBeenCalledWith('ORNGXP01', DOSYA);
    const satirlar = screen.getAllByRole('row').slice(1);
    expect(satirlar).toHaveLength(4);
    expect(within(satirlar[0]).getByText('yonetici')).toBeTruthy();
    expect(within(satirlar[0]).getByText('· job 77')).toBeTruthy();
    expect(within(satirlar[0]).getByText('şu anki')).toBeTruthy();
    expect(within(satirlar[0]).getByTitle('dokum henüz doğrulamadı')).toBeTruthy();
    expect(within(satirlar[1]).getByText('sunucuda değişti')).toBeTruthy();
    expect(within(satirlar[1]).getByText('nginx')).toBeTruthy();
    expect(within(satirlar[2]).getByText('ilk görülme')).toBeTruthy();
    expect(within(satirlar[2]).getAllByText('—')).toHaveLength(2); // kim ve boyut bilinmiyor
    expect(within(satirlar[3]).getByText('silindi')).toBeTruthy();
    // dugmeler: guncel surume "su ankiyle" / "bu surume don" yok; icerigi saklanmayana don yok
    expect(within(satirlar[0]).queryByRole('button', { name: 'şu ankiyle' })).toBeNull();
    expect(within(satirlar[0]).queryByRole('button', { name: 'bu sürüme dön' })).toBeNull();
    expect(within(satirlar[2]).queryByRole('button', { name: 'fark' })).toBeNull();
    expect(within(satirlar[2]).queryByRole('button', { name: 'bu sürüme dön' })).toBeNull();
    expect(within(satirlar[3]).queryAllByRole('button')).toHaveLength(0);

    fireEvent.click(within(satirlar[0]).getByRole('button', { name: 'fark' }));
    expect(await screen.findByText(/^önceki → /)).toBeTruthy();
    expect(api.blob).toHaveBeenCalledWith(SHA_ESKI);
    expect(api.blob).toHaveBeenCalledWith(SHA);
    expect(screen.getByText('+ listen 80;')).toBeTruthy();
    fireEvent.click(within(satirlar[2]).getByRole('button', { name: 'şu ankiyle' }));
    expect(await screen.findByText(/ → şu anki$/)).toBeTruthy();
    expect(await screen.findByText('içerik aynı')).toBeTruthy();

    // fark okunamadi
    api.blob.mockResolvedValueOnce({
      ok: false,
      sha256: SHA_ESKI,
      content: '',
      message: 'blob silinmiş',
    });
    fireEvent.click(within(satirlar[1]).getByRole('button', { name: 'şu ankiyle' }));
    expect(await screen.findByText('blob silinmiş')).toBeTruthy();
    api.blob.mockRejectedValueOnce(new Error('blob ucu düştü'));
    fireEvent.click(within(satirlar[1]).getByRole('button', { name: 'fark' }));
    expect(await screen.findByText('blob ucu düştü')).toBeTruthy();

    // bu surume don: okunamazsa bildirilir; okunursa editore alinir, gecmis kapanir
    api.blob.mockResolvedValueOnce({ ok: false, sha256: SHA_ESKI, content: '' });
    fireEvent.click(within(satirlar[1]).getByRole('button', { name: 'bu sürüme dön' }));
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('İçerik yok.'));
    fireEvent.click(within(satirlar[1]).getByRole('button', { name: 'bu sürüme dön' }));
    await waitFor(() => expect(editor().value).toBe(ICERIK2));
    expect(api.toast.success).toHaveBeenCalledWith(
      'Sürüm editöre alındı — yayınlamak için "Yayınla (Publish)".',
    );
    expect(screen.queryByText('Portal publish')).toBeNull();
    expect(screen.getByText("değişti — push'lanmadı")).toBeTruthy();
  });

  it('NK8b geçmiş boş, okunamadı (yetki / sunucu) ve ağ hatası', async () => {
    await ac();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    await dosyaAc();
    fireEvent.click(dugme('Geçmiş'));
    expect(await screen.findByText('Henüz kayıt yok — ilk dokumdan sonra oluşur.')).toBeTruthy();
    fireEvent.click(dugme('Geçmiş'));
    expect(screen.queryByText(/Henüz kayıt yok/)).toBeNull();

    // Degisiklikler sekmesi kapali kullanici: /history 403; "kayit yok" DEGIL
    api.history.mockResolvedValueOnce({
      ok: false,
      versions: [],
      message: 'Bu bölüme erişiminiz yok.',
    });
    fireEvent.click(dugme('Geçmiş'));
    const hata = await screen.findByTestId('nc-gecmis-hata');
    expect(hata.textContent).toBe('Sürüm geçmişi okunamadıBu bölüme erişiminiz yok.Tekrar dene');
    expect(screen.queryByText(/Henüz kayıt yok/)).toBeNull();
    fireEvent.click(dugme('Geçmiş'));
    api.history.mockResolvedValueOnce({ ok: false });
    fireEvent.click(dugme('Geçmiş'));
    expect((await screen.findByTestId('nc-gecmis-hata')).textContent).toBe(
      'Sürüm geçmişi okunamadıTekrar dene',
    );
    fireEvent.click(dugme('Geçmiş'));
    api.history.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(dugme('Geçmiş'));
    expect((await screen.findByTestId('nc-gecmis-hata')).textContent).toBe(
      'Sürüm geçmişi okunamadıağ yokTekrar dene',
    );
    expect(screen.queryByText(/Henüz kayıt yok/)).toBeNull();
    // Tekrar dene yeniden okur
    fireEvent.click(
      within(screen.getByTestId('nc-gecmis-hata')).getByRole('button', { name: 'Tekrar dene' }),
    );
    expect(await screen.findByText('Henüz kayıt yok — ilk dokumdan sonra oluşur.')).toBeTruthy();
    expect(screen.queryByTestId('nc-gecmis-hata')).toBeNull();
  });

  it('NK9 salt okunur kullanıcı: yenileme, yeni dosya, yayın ve geri dönüş yok', async () => {
    api.rol = 'User';
    api.history.mockResolvedValue({
      ok: true,
      versions: [
        surum({ id: 2, oldSha256: SHA_ILK, newSha256: SHA_ESKI, hasOld: true, hasNew: true }),
      ],
    });
    await ac();
    dugmeYok(/Seçilileri yenile/);
    dugmeYok('Tüm filo');
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    await screen.findByRole('button', { name: /^nginx\.conf/ });
    // dokum yenileme yalniz Admin (sunucu /refresh'i Admin disina 403 ile kapatir)
    dugmeYok('Yenile');
    dugmeYok('Yeni dosya');
    expect(screen.getByText('Ağaçtan bir dosya seçin.')).toBeTruthy();
    await dosyaAc();
    expect(editor().readOnly).toBe(true);
    expect(screen.getByText('Salt okunur — değişiklik yalnız Admin.')).toBeTruthy();
    dugmeYok('Yayınla (Publish)');
    fireEvent.click(dugme('Geçmiş'));
    await screen.findByText('sunucuda değişti');
    expect(dugme('şu ankiyle')).toBeTruthy();
    dugmeYok('bu sürüme dön');
  });

  it('NK9b 512 KB üstü dosya: içerik yok, editör Admin için de salt okunur', async () => {
    api.file.mockResolvedValue(dosya({ content: null, tooLarge: true, size: 600000 }));
    await ac();
    grupAc('WEBFORMS');
    await sunucuSec('ORNGXP01');
    fireEvent.click(await screen.findByRole('button', { name: /^application-confs/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^odeme\.conf/ }));
    expect(await screen.findByText('512 KB üstü — içerik dokumde yok')).toBeTruthy();
    expect(screen.getByText('585.9 KB')).toBeTruthy();
    expect(editor().value).toBe('');
    expect(editor().readOnly).toBe(true);
  });

  it("NK10 Instances'tan açılan sunucu Konfigürasyon'da seçili gelir", async () => {
    render(<NginxConsolePage />, { initialEntries: ['/nginx-console?tab=instances'] });
    fireEvent.click(await screen.findByRole('button', { name: 'orngxp04' }));
    await waitFor(() => expect(api.tree).toHaveBeenCalledWith('ORNGXP04'));
    expect(await screen.findByText('ORNGXP04', { selector: 'span.font-mono' })).toBeTruthy();
  });
});
