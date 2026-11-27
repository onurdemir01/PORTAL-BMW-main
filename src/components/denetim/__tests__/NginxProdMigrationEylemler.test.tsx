// @vitest-environment jsdom
// Nginx PROD tasimasi EYLEMLERI (2026-11-27, kapsam PR-2; NginxProdMigration dal dusuk): tanim olustur (tek ve toplu),
// taramayi tazele, yenile, CSV, gecis takibi (tek ve toplu). Silme penceresi NginxProdMigrationSilme'de.
//   NM1 tanim olustur: onay penceresi (bayat tarama uyarisi), is izlenir; red, istisna, is numarasiz basari
//   NM2 toplu tanim: hazir olmayan ve tanimli olan atlanir (nedeniyle); isler sirayla, sonuc satirlari
//   NM3 taramayi tazele / yenile / veri okunamadi
//   NM4 CSV: basliklar yeni sunucularla, satirda takip ve yeni sunucu durumu
//   NM5 gecis takibi: tek kayit (red, istisna) ve toplu kayit (zorunlu tarih, kismi basari, secim temizlenir)
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import NginxProdMigration from '@/components/denetim/NginxProdMigration';
import type { NginxMigrationApp, NginxMigrationResult } from '@/api/denetimApi';

const api = vi.hoisted(() => ({
  nginxMigration: vi.fn(),
  config: vi.fn(),
  create: vi.fn(),
  jobStatus: vi.fn(),
  trackingList: vi.fn(),
  save: vi.fn(),
  saveBulk: vi.fn(),
  rescan: vi.fn(),
  addJob: vi.fn(),
  csv: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  saveConfig: vi.fn(),
  servers: vi.fn(),
  rol: 'User',
}));
vi.mock('@/api/denetimApi', () => ({ denetimApi: { nginxMigration: api.nginxMigration } }));
vi.mock('@/api/nginxMigrationApi', () => ({
  nginxMigrationApi: {
    config: api.config,
    deleteGuard: vi.fn(),
    remove: vi.fn(),
    create: api.create,
    jobStatus: api.jobStatus,
    saveConfig: api.saveConfig,
  },
  nginxMigrationTrackingApi: { list: api.trackingList, save: api.save, saveBulk: api.saveBulk },
  nginxMigrationScanApi: { rescan: api.rescan },
}));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: { servers: api.servers } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'odemir', role: api.rol } }),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: api.addJob }) }));
vi.mock('@/utils/csv', async (orig) => ({
  ...(await orig<typeof import('@/utils/csv')>()),
  downloadCsv: api.csv,
}));
vi.mock('@/hooks/useToast', () => ({ toast: api.toast }));

const ESKI = 'ORRVPP01';
const YENI = 'ORNGXP44';
const yol = (location: string, newStatus: NginxMigrationApp['paths'][number]['newStatus']) => ({
  service: 'WEBFORMS',
  location,
  hosts: [ESKI],
  newHosts: [YENI],
  newStatus,
  traffic: null,
});
const uyg = (application: string, o: Partial<NginxMigrationApp> = {}): NginxMigrationApp => ({
  namespace: 'odeme-prod',
  application,
  how: 'route',
  target: `${application}.apps`,
  targetSource: 'proxy_pass',
  suffixAdded: false,
  forms: ['upstream'],
  written: [`${application}_up`],
  services: ['WEBFORMS'],
  oldHosts: [ESKI],
  locations: ['/a/'],
  locationCount: 1,
  paths: [yol(`/${application}/`, 'none')],
  perHost: { [YENI]: { hys: true, app: true, conf: false } },
  readyHosts: 1,
  scannedHosts: 1,
  status: 'ready',
  ...o,
});
const APPS = [
  uyg('hazir', { paths: [yol('/hazir/', 'none'), yol('/hazir/api/', 'none')], locationCount: 2 }),
  uyg('dagitilmamis', { status: 'missing', readyHosts: 0, perHost: { [YENI]: null } }),
  uyg('taranmamis', { status: 'not-scanned', scannedHosts: 0 }),
  uyg('tanimli', { paths: [yol('/tanimli/', 'defined')], suffixAdded: true }),
];
function veri(): NginxMigrationResult {
  return {
    ok: true,
    proxyReady: true,
    dirsReady: true,
    proxyScanDate: '2026-11-26',
    dirScanDate: '2026-11-26',
    ownersReady: true,
    groups: [
      {
        id: 'other',
        label: 'WEBFORMS',
        oldHosts: [ESKI],
        newHosts: [YENI],
        newHostsScanned: [YENI],
        oldHostsSeen: [ESKI],
        serviceLocations: [
          { service: 'WEBFORMS', locations: 5, defined: 1, partial: 0, none: 4, notScanned: 0 },
        ],
        apps: APPS,
        nonSpa: [],
        unresolved: [],
        totals: {
          apps: 4,
          ready: 2,
          partial: 0,
          missing: 1,
          notScanned: 1,
          nonSpa: 0,
          unresolved: 0,
          locations: { total: 5, defined: 1, partial: 0, none: 4, notScanned: 0 },
        },
      },
    ],
  } as unknown as NginxMigrationResult;
}
const TAKIP = {
  group: 'other',
  namespace: 'odeme-prod',
  application: 'tanimli',
  state: 'planned',
  plannedDate: '2026-12-01',
  migratedDate: null,
  note: 'OCO-1',
  inUse: null,
  updatedBy: 'odemir',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.rol = 'User';
  api.servers.mockResolvedValue({ ok: true, servers: [] });
  api.nginxMigration.mockResolvedValue(veri());
  api.config.mockResolvedValue({
    ok: true,
    config: { awxServerId: 1, templateId: 10, deleteTemplateId: 20 },
  });
  api.trackingList.mockResolvedValue({ ok: true, rows: [TAKIP], pathJobs: [] });
});

const metin = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
async function ac() {
  render(<NginxProdMigration />);
  await screen.findByRole('checkbox', { name: 'hazir seç' });
  // Yapilandirma okununca tanim dugmeleri acilir.
  await waitFor(() =>
    expect(within(satir('hazir')).getByRole('button', { name: 'Tanım oluştur' })).toBeEnabled(),
  );
}
const satir = (app: string) =>
  screen.getByRole('checkbox', { name: `${app} seç` }).closest('tr') as HTMLElement;
const isDurumu = () => api.addJob.mock.calls.at(-1)![0].fetchStatus as () => Promise<unknown>;

describe('Nginx PROD taşıması: tanım oluştur', () => {
  it('NM1 onay penceresi, iş izlenir; red, istisna, iş numarasız başarı; bayat tarama uyarısı', async () => {
    await ac();
    expect(within(satir('tanimli')).getByRole('button', { name: 'Tanımlı' })).toBeDisabled();
    const pencereAc = (app: string) => {
      fireEvent.click(within(satir(app)).getByRole('button', { name: 'Tanım oluştur' }));
      return screen.getByRole('dialog', { name: 'Yeni sunucularda tanım oluştur' });
    };
    let p = pencereAc('hazir');
    expect(p).toHaveTextContent('hazir · odeme-prod');
    expect(p).not.toHaveTextContent('Son tarama');
    api.create.mockResolvedValueOnce({ ok: true, job: { id: 77 }, targetHosts: [YENI] });
    fireEvent.click(within(p).getByRole('button', { name: 'Evet, tanımı oluştur' }));
    const sonuc = await screen.findByText(/hazir için tanım işi başlatıldı \(job 77\)/);
    expect(api.create).toHaveBeenCalledWith({
      group: 'other',
      namespace: 'odeme-prod',
      application: 'hazir',
      service: 'WEBFORMS',
      inputPath: '/hazir/',
    });
    expect(metin(sonuc)).toContain(
      'WEBFORMS-PROD.conf içinde /hazir/ → application-confs/webforms-hazir-odeme-prod.conf · hedef: ORNGXP44. Canlı log sağ alttaki iş penceresinde',
    );
    expect(screen.queryByRole('dialog', { name: 'Yeni sunucularda tanım oluştur' })).toBeNull();
    expect(api.addJob.mock.calls.at(-1)![0].title).toBe('Tanım oluştur · hazir #77');
    // Is durumu okunamadi: hata; bitince takip tablosu yeniden okunur (bir kez).
    api.jobStatus.mockResolvedValueOnce({ ok: false, status: '', message: 'AWX yok' });
    await expect(isDurumu()()).rejects.toThrow('AWX yok');
    const once = api.trackingList.mock.calls.length;
    api.jobStatus.mockResolvedValue({ ok: true, status: 'successful', output: 'ok' });
    await act(async () => {
      expect(await isDurumu()()).toEqual({ status: 'successful', output: 'ok' });
      await isDurumu()();
    });
    expect(api.jobStatus).toHaveBeenCalledWith(77);
    expect(api.trackingList.mock.calls.length).toBe(once + 1);

    // Deploy edilmemis / taranmamis: uyari, ama dugme engellenmez.
    p = pencereAc('dagitilmamis');
    expect(p).toHaveTextContent(
      'Son tarama bu uygulamanın dizinini yeni sunucuların hiçbirinde görmedi.',
    );
    api.create.mockResolvedValueOnce({ ok: false, message: 'şablon yok' });
    fireEvent.click(within(p).getByRole('button', { name: 'Evet, tanımı oluştur' }));
    expect(await screen.findByText('şablon yok')).toBeTruthy();
    expect(screen.getByText('İş başlatılamadı')).toBeTruthy();
    p = pencereAc('taranmamis');
    expect(p).toHaveTextContent('Yeni sunucular henüz taranmadı.');
    api.create.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(within(p).getByRole('button', { name: 'Evet, tanımı oluştur' }));
    expect(await screen.findByText('ağ yok')).toBeTruthy();
    // Is numarasi gelmezse izlenecek is yok; sonuc Teams / AWX'ten.
    const isSayisi = api.addJob.mock.calls.length;
    p = pencereAc('hazir');
    api.create.mockResolvedValueOnce({ ok: true });
    fireEvent.click(within(p).getByRole('button', { name: 'Evet, tanımı oluştur' }));
    expect(await screen.findByText(/Sonucu Teams \/ AWX'ten izleyin\./)).toHaveTextContent(
      'hazir için tanım işi başlatıldı:',
    );
    expect(api.addJob.mock.calls.length).toBe(isSayisi);
    // Iptal: istek gitmez.
    p = pencereAc('hazir');
    fireEvent.click(within(p).getByRole('button', { name: 'İptal' }));
    expect(screen.queryByRole('dialog', { name: 'Yeni sunucularda tanım oluştur' })).toBeNull();
    expect(api.create).toHaveBeenCalledTimes(4);
  });

  it('NM2 toplu tanım: hazır olmayan ve tanımlı atlanır; işler sırayla, sonuç satırları', async () => {
    await ac();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tümünü seç' }));
    expect(screen.getByText('4 uygulama seçildi')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Seçilenler için tanım oluştur/ }));
    const p = screen.getByRole('dialog', { name: 'Seçilenler için tanım oluştur' });
    expect(p).toHaveTextContent('2 tanım işi · 3 uygulama atlanacak');
    expect(p).toHaveTextContent('hazir · WEBFORMS-PROD.conf /hazir/');
    expect(p).toHaveTextContent('hazir · WEBFORMS-PROD.conf /hazir/api/');
    expect(p).toHaveTextContent('dagitilmamis — uygulama yeni sunuculara deploy edilmemiş');
    expect(p).toHaveTextContent('taranmamis — yeni sunucular henüz taranmadı');
    expect(p).toHaveTextContent('tanimli — tüm tanımları zaten oluşturulmuş');
    api.create
      .mockResolvedValueOnce({ ok: true, job: { id: 81 } })
      .mockResolvedValueOnce({ ok: false, message: 'nginx -t düştü' });
    fireEvent.click(within(p).getByRole('button', { name: '2 işi başlat' }));
    await waitFor(() =>
      expect(p).toHaveTextContent('hazir · WEBFORMS /hazir/api/: nginx -t düştü'),
    );
    const satirlar = [...p.querySelectorAll('div[style]')]
      .map((d) => metin(d))
      .filter((t) => /atlandı|→ iş|düştü/.test(t) && !t.includes('\n'));
    expect(satirlar).toEqual(
      expect.arrayContaining([
        'dagitilmamis: atlandı — uygulama yeni sunuculara deploy edilmemiş',
        'hazir · WEBFORMS /hazir/ → iş 81',
        'hazir · WEBFORMS /hazir/api/: nginx -t düştü',
      ]),
    );
    expect(api.create.mock.calls.map((c) => c[0].inputPath)).toEqual(['/hazir/', '/hazir/api/']);
    expect(api.addJob.mock.calls.map((c) => c[0].title)).toEqual(['Tanım oluştur · hazir #81']);
    // Bitince alt dugme "Kapat" olur (ust kosedeki kapatma dugmesi de ayni adi tasir).
    const kapat = (el: HTMLElement) => within(el).getAllByRole('button', { name: 'Kapat' }).at(-1)!;
    expect(within(p).queryByRole('button', { name: /işi başlat/ })).toBeNull();
    fireEvent.click(kapat(p));

    // Istisna da satir olur; yalniz hazir secilince atlanan yok.
    fireEvent.click(screen.getByRole('button', { name: 'Seçimi temizle' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'hazir seç' }));
    fireEvent.click(screen.getByRole('button', { name: /Seçilenler için tanım oluştur/ }));
    const p2 = screen.getByRole('dialog', { name: 'Seçilenler için tanım oluştur' });
    expect(p2).toHaveTextContent('2 tanım işi · 0 uygulama atlanacak');
    api.create.mockRejectedValue(new Error('ağ yok'));
    fireEvent.click(within(p2).getByRole('button', { name: '2 işi başlat' }));
    await waitFor(() => expect(p2).toHaveTextContent('hazir · WEBFORMS /hazir/api/: ağ yok'));
    fireEvent.click(kapat(p2));

    // Yalniz tanimli secilince baslatilacak is yok.
    fireEvent.click(screen.getByRole('button', { name: 'Seçimi temizle' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'tanimli seç' }));
    fireEvent.click(screen.getByRole('button', { name: /Seçilenler için tanım oluştur/ }));
    const p3 = screen.getByRole('dialog', { name: 'Seçilenler için tanım oluştur' });
    expect(within(p3).getByRole('button', { name: '0 işi başlat' })).toBeDisabled();
  });
});

describe('Nginx PROD taşıması: tarama, CSV, takip', () => {
  it('NM3 taramayı tazele, yenile, veri okunamadı', async () => {
    await ac();
    const tazele = () => fireEvent.click(screen.getByRole('button', { name: /Taramayı tazele/ }));
    api.rescan.mockResolvedValueOnce({ ok: true, jobId: 5 });
    tazele();
    await waitFor(() =>
      expect(api.toast.success).toHaveBeenCalledWith(
        'Tarama başladı (iş #5). Bitince "Yenile" ile liste güncellenir.',
      ),
    );
    // Grup sekmesi secilmeden: tum gruplar (sunucu listesi bos).
    expect(api.rescan).toHaveBeenCalledWith([], 'tüm gruplar');
    // Sekme secilince yalniz o grubun eski + yeni sunuculari, grup adiyla.
    fireEvent.click(screen.getByRole('button', { name: /^WEBFORMS/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Taramayı tazele/ })).toBeEnabled(),
    );
    api.rescan.mockResolvedValueOnce({ ok: true, jobId: 6 });
    tazele();
    await waitFor(() => expect(api.rescan).toHaveBeenLastCalledWith([ESKI, YENI], 'WEBFORMS'));
    api.rescan.mockResolvedValueOnce({ ok: false, message: 'tarama kilitli' });
    tazele();
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('tarama kilitli'));
    api.rescan.mockRejectedValueOnce(new Error('ağ yok'));
    tazele();
    await waitFor(() => expect(api.toast.error).toHaveBeenCalledWith('ağ yok'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Taramayı tazele/ })).toBeEnabled(),
    );

    // Yenile: onbellegi atlar; okunamazsa hata metni.
    expect(api.nginxMigration).toHaveBeenLastCalledWith(false);
    api.nginxMigration.mockResolvedValueOnce({ ok: false, message: 'tablo yok' });
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(await screen.findByText('tablo yok')).toBeTruthy();
    expect(api.nginxMigration).toHaveBeenLastCalledWith(true);
  });

  it('NM3b ilk okuma istisna; takip tablosu okunamazsa takip hücresi kapalı', async () => {
    api.nginxMigration.mockRejectedValueOnce(new Error('bağlantı yok'));
    render(<NginxProdMigration />);
    expect(await screen.findByText('bağlantı yok')).toBeTruthy();
  });

  it('NM4 CSV: başlıklar yeni sunucularla, satırda takip ve yeni sunucu durumu', async () => {
    await ac();
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(api.csv).toHaveBeenCalledTimes(1);
    const [ad, basliklar, satirlar] = api.csv.mock.calls[0] as [string, string[], unknown[][]];
    expect(ad).toBe('nginx_prod_tasima');
    expect(basliklar.slice(0, 4)).toEqual(['grup', 'namespace', 'prod_eki_eklendi', 'uygulama']);
    expect(basliklar.at(-1)).toBe(YENI);
    expect(basliklar).toHaveLength(26);
    const sutun = (s: unknown[], b: string) => s[basliklar.indexOf(b)];
    const tanimli = satirlar.find((s) => s[3] === 'tanimli')!;
    expect(sutun(tanimli, 'grup')).toBe('WEBFORMS');
    expect(sutun(tanimli, 'prod_eki_eklendi')).toBe('evet');
    expect(sutun(tanimli, 'gecis_durumu')).toBe('planlandı');
    expect(sutun(tanimli, 'planlanan_tarih')).toBe('2026-12-01');
    expect(sutun(tanimli, 'gecis_notu')).toBe('OCO-1');
    expect(sutun(tanimli, 'eski_locationlar')).toBe('WEBFORMS /tanimli/');
    const hazir = satirlar.find((s) => s[3] === 'hazir')!;
    expect(sutun(hazir, 'prod_eki_eklendi')).toBe('');
    expect(sutun(hazir, 'gecis_durumu')).toBe('geçmedi');
    expect(sutun(hazir, 'planlanan_tarih')).toBe('');
    expect(sutun(hazir, 'eski_locationlar')).toBe('WEBFORMS /hazir/ | WEBFORMS /hazir/api/');
    expect(sutun(hazir, 'hazir_sunucu')).toBe(1);
    // Deploy edilmemis uygulamanin yeni sunucu hucresi bos degil, okunur.
    const dagitilmamis = satirlar.find((s) => s[3] === 'dagitilmamis')!;
    expect(typeof dagitilmamis.at(-1)).toBe('string');
  });

  it('NM5 geçiş takibi: tek kayıt (red, istisna) ve toplu kayıt (zorunlu tarih, kısmi başarı)', async () => {
    await ac();
    const hucre = within(satir('tanimli')).getByRole('button', { name: /planlandı 01\.12\.2026/ });
    expect(hucre.getAttribute('title')).toContain('planlanan: 01.12.2026\nnot: OCO-1');
    fireEvent.click(hucre);
    let p = screen.getByRole('dialog', { name: 'Geçiş takibi' });
    expect(p).toHaveTextContent('tanimli · odeme-prod · WEBFORMS');
    // Mevcut kayit pencereye dolu gelir.
    expect(within(p).getByRole('radio', { name: 'planlandı' })).toBeChecked();
    expect(within(p).getByRole('textbox')).toHaveValue('OCO-1');
    fireEvent.click(within(p).getByRole('radio', { name: 'geçti' }));
    const tarihler = p.querySelectorAll('input[type="date"]');
    fireEvent.change(tarihler[1], { target: { value: '2026-11-27' } });
    api.save.mockResolvedValueOnce({ ok: false });
    fireEvent.click(within(p).getByRole('button', { name: 'Kaydet' }));
    expect(await within(p).findByText('Kaydedilemedi.')).toBeTruthy();
    api.save.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(within(p).getByRole('button', { name: 'Kaydet' }));
    expect(await within(p).findByText('ağ yok')).toBeTruthy();
    api.save.mockResolvedValueOnce({
      ok: true,
      row: { ...TAKIP, state: 'migrated', migratedDate: '2026-11-27' },
    });
    fireEvent.click(within(p).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Geçiş takibi' })).toBeNull());
    expect(api.save).toHaveBeenLastCalledWith({
      group: 'other',
      namespace: 'odeme-prod',
      application: 'tanimli',
      state: 'migrated',
      plannedDate: '2026-12-01',
      migratedDate: '2026-11-27',
      note: 'OCO-1',
    });
    expect(
      within(satir('tanimli')).getByRole('button', { name: /geçti 27\.11\.2026/ }),
    ).toBeTruthy();

    // Toplu: planlandi icin tarih zorunlu, gecti icin gecis tarihi; kismi basari secimi korur.
    fireEvent.click(screen.getByRole('checkbox', { name: 'hazir seç' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'taranmamis seç' }));
    fireEvent.click(screen.getByRole('button', { name: /Toplu geçiş takibi gir/ }));
    p = screen.getByRole('dialog', { name: 'Toplu geçiş takibi' });
    const yaz = within(p).getByRole('button', { name: '2 uygulamaya yaz' });
    expect(yaz).toBeDisabled();
    expect(p).toHaveTextContent('“Planlandı” için planlanan tarih zorunlu.');
    fireEvent.click(within(p).getByRole('radio', { name: 'geçti' }));
    expect(p).toHaveTextContent('“Geçti” için geçiş tarihi zorunlu.');
    fireEvent.change(p.querySelectorAll('input[type="date"]')[1], {
      target: { value: '2026-11-28' },
    });
    fireEvent.change(within(p).getByRole('textbox'), { target: { value: 'toplu' } });
    expect(yaz).toBeEnabled();
    api.saveBulk.mockResolvedValueOnce({
      ok: false,
      rows: [{ ...TAKIP, application: 'hazir', state: 'migrated', migratedDate: '2026-11-28' }],
      failed: [{ namespace: 'odeme-prod', application: 'taranmamis', message: 'kilitli' }],
    });
    fireEvent.click(yaz);
    expect(await within(p).findByText('1 uygulama yazılamadı.')).toBeTruthy();
    expect(p).toHaveTextContent('taranmamis · odeme-prod: kilitli');
    expect(api.saveBulk).toHaveBeenLastCalledWith({
      items: [
        { group: 'other', namespace: 'odeme-prod', application: 'hazir' },
        { group: 'other', namespace: 'odeme-prod', application: 'taranmamis' },
      ],
      state: 'migrated',
      plannedDate: null,
      migratedDate: '2026-11-28',
      note: 'toplu',
    });
    // Yazilan satir tabloya islendi; secim korunur (kismi basari).
    expect(within(satir('hazir')).getByRole('button', { name: /geçti 28\.11\.2026/ })).toBeTruthy();
    expect(screen.getByText('2 uygulama seçildi')).toBeTruthy();
    api.saveBulk.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(yaz);
    expect(await within(p).findByText('ağ yok')).toBeTruthy();
    api.saveBulk.mockResolvedValueOnce({
      ok: true,
      rows: [
        { ...TAKIP, application: 'taranmamis', state: 'migrated', migratedDate: '2026-11-28' },
      ],
    });
    fireEvent.click(yaz);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Toplu geçiş takibi' })).toBeNull(),
    );
    expect(screen.queryByText(/uygulama seçildi/)).toBeNull();
  });

  it('NM5b takip tablosu okunamazsa takip hücresi kapalı', async () => {
    api.trackingList.mockResolvedValue({ ok: false });
    render(<NginxProdMigration />);
    await screen.findByRole('checkbox', { name: 'hazir seç' });
    const hucre = within(satir('hazir')).getByRole('button', { name: /geçmedi/ });
    await waitFor(() => expect(hucre).toBeDisabled());
    expect(hucre).toHaveAttribute('title', 'takip tablosu okunamadı');
  });
});

const yuk = (state: 'active' | 'idle' | 'unknown', req7: number | null) => ({
  state,
  req24: req7,
  req7,
  lastSeen: null,
  sampled: false,
  hosts: 1,
  unknownHosts: state === 'unknown' ? 1 : 0,
});
const sahip = (ekip: string) => ({ groups: [ekip], emails: [], unknownNs: [] });

describe('Nginx PROD taşıması: sıralama, süzgeçler, yönetici ayarı', () => {
  it('NM6 sıralama (ad, yük, ekip, geçiş tarihi) ve süzgeçler', async () => {
    const d = veri();
    d.groups[0].apps = [
      uyg('d-yuksuz', { owner: sahip('ekip-y') }),
      uyg('c-olculmedi', {
        paths: [{ ...yol('/c/', 'defined'), traffic: yuk('unknown', null) }],
      }),
      uyg('b-aktif', {
        owner: sahip('ekip-x'),
        paths: [{ ...yol('/b/', 'none'), traffic: yuk('active', 50) }],
      }),
      uyg('a-bosta', {
        owner: sahip('ekip-x'),
        status: 'partial',
        paths: [{ ...yol('/a/', 'none'), traffic: yuk('idle', 0) }],
      }),
    ];
    api.nginxMigration.mockResolvedValue(d);
    api.trackingList.mockResolvedValue({
      ok: true,
      rows: [
        // Gecti kaydinda planlanan tarih yok: siralama gecis tarihini okumali.
        {
          ...TAKIP,
          application: 'a-bosta',
          state: 'migrated',
          plannedDate: null,
          migratedDate: '2026-11-20',
        },
        { ...TAKIP, application: 'd-yuksuz', state: 'planned', plannedDate: '2026-12-05' },
      ],
      pathJobs: [],
    });
    render(<NginxProdMigration />);
    await screen.findByRole('checkbox', { name: 'a-bosta seç' });
    await waitFor(() =>
      expect(within(satir('d-yuksuz')).getByRole('button', { name: /planlandı/ })).toBeTruthy(),
    );
    const sira = () =>
      [...document.querySelectorAll('input[type="checkbox"][aria-label$=" seç"]')]
        .map((x) => (x.getAttribute('aria-label') || '').replace(/ seç$/, ''))
        .filter((x) => x !== 'Tümünü');
    const secim = (secenek: string) =>
      screen
        .getAllByRole('combobox')
        .find((el) =>
          [...(el as HTMLSelectElement).options].some((o) => o.textContent === secenek),
        ) as HTMLSelectElement;
    const sirala = (deger: string) =>
      fireEvent.change(secim('sırala: uygulama adı'), { target: { value: deger } });
    sirala('app');
    expect(sira()).toEqual(['a-bosta', 'b-aktif', 'c-olculmedi', 'd-yuksuz']);
    // Yuk: istek alan, olculemeyen, olcumsuz, bosta.
    sirala('load');
    expect(sira()).toEqual(['b-aktif', 'c-olculmedi', 'd-yuksuz', 'a-bosta']);
    // Ekip: cok uygulamasi olan ekip ustte, ekipsiz en altta.
    sirala('team');
    expect(sira()).toEqual(['a-bosta', 'b-aktif', 'd-yuksuz', 'c-olculmedi']);
    // Gecis tarihi: tarihi olan ustte (eskiden yeniye), sonra ad.
    sirala('plan');
    expect(sira()).toEqual(['a-bosta', 'd-yuksuz', 'b-aktif', 'c-olculmedi']);

    const gecis = secim('geçiş: hepsi');
    fireEvent.change(gecis, { target: { value: 'migrated' } });
    expect(sira()).toEqual(['a-bosta']);
    fireEvent.change(gecis, { target: { value: 'planned' } });
    expect(sira()).toEqual(['d-yuksuz']);
    fireEvent.change(gecis, { target: { value: 'open' } });
    expect(sira()).toEqual(['d-yuksuz', 'b-aktif', 'c-olculmedi']);
    fireEvent.change(gecis, { target: { value: 'all' } });
    const yeni = secim('yeni sunucularda: hepsi');
    fireEvent.change(yeni, { target: { value: 'defined' } });
    expect(sira()).toEqual(['c-olculmedi']);
    fireEvent.change(yeni, { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sadece hazır olmayanlar' }));
    expect(sira()).toEqual(['a-bosta']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sadece hazır olmayanlar' }));
    // Arama: uygulama, namespace ya da ekip.
    const ara = screen.getByPlaceholderText('uygulama, namespace ya da ekip ara');
    fireEvent.change(ara, { target: { value: 'EKIP-Y' } });
    expect(sira()).toEqual(['d-yuksuz']);
    fireEvent.change(ara, { target: { value: 'aktif' } });
    expect(sira()).toEqual(['b-aktif']);
  });

  it('NM7 yönetici ayarı: zorunlu alanlar, kayıt, red ve istisna; yapılandırılmamışta düğmeler kapalı', async () => {
    api.rol = 'Admin';
    api.config.mockResolvedValue({
      ok: true,
      config: { awxServerId: 0, templateId: 0, deleteTemplateId: 0 },
    });
    api.servers.mockResolvedValue({
      ok: true,
      servers: [
        { id: 1, name: 'maestro', configured: true },
        { id: 2, name: 'yedek', configured: false },
      ],
    });
    render(<NginxProdMigration />);
    await screen.findByRole('checkbox', { name: 'hazir seç' });
    const olustur = within(satir('hazir')).getByRole('button', { name: 'Tanım oluştur' });
    expect(olustur).toBeDisabled();
    expect(olustur).toHaveAttribute('title', 'Job yapılandırılmamış (yönetici paneli)');
    fireEvent.click(screen.getByRole('checkbox', { name: 'hazir seç' }));
    expect(screen.queryByRole('button', { name: /Seçilenler için tanım oluştur/ })).toBeNull();
    const panel = screen
      .getByText('Job yapılandırması (yönetici)')
      .closest('section') as HTMLElement;
    const sunucu = await within(panel).findByRole('combobox');
    expect([...(sunucu as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      'seçiniz…',
      'maestro',
      'yedek (yapılandırılmamış)',
    ]);
    const kaydet = within(panel).getByRole('button', { name: 'Kaydet' });
    fireEvent.click(kaydet);
    expect(panel).toHaveTextContent('AWX sunucusu ve job template ID zorunlu.');
    expect(api.saveConfig).not.toHaveBeenCalled();
    fireEvent.change(sunucu, { target: { value: '1' } });
    const sablon = within(panel).getByPlaceholderText('örn. 412');
    fireEvent.change(sablon, { target: { value: 'a4b12' } });
    expect(sablon).toHaveValue('412');
    fireEvent.change(within(panel).getByPlaceholderText('isteğe bağlı'), {
      target: { value: '9x' },
    });
    api.saveConfig.mockResolvedValueOnce({ ok: false, message: 'şablon yok' });
    fireEvent.click(kaydet);
    expect(await within(panel).findByText('şablon yok')).toBeTruthy();
    api.saveConfig.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(kaydet);
    expect(await within(panel).findByText('ağ yok')).toBeTruthy();
    // Kayit: yapilandirma yeniden okunur, tanim dugmeleri acilir.
    api.config.mockResolvedValue({
      ok: true,
      config: { awxServerId: 1, templateId: 412, deleteTemplateId: 9 },
    });
    api.saveConfig.mockResolvedValueOnce({ ok: true });
    fireEvent.click(kaydet);
    expect(await within(panel).findByText('Kaydedildi. Düğme artık çalışır.')).toBeTruthy();
    expect(api.saveConfig).toHaveBeenLastCalledWith({
      awxServerId: 1,
      templateId: 412,
      deleteTemplateId: 9,
    });
    await waitFor(() => expect(olustur).toBeEnabled());
    expect(screen.getByRole('button', { name: /Seçilenler için tanım oluştur/ })).toBeTruthy();
  });

  it('NM7b AWX sunucu listesi alınamazsa ID elle girilir', async () => {
    api.rol = 'Admin';
    api.servers.mockRejectedValue(new Error('awx yok'));
    render(<NginxProdMigration />);
    expect(
      await screen.findByText('AWX sunucu listesi alınamadı; ID elle girilebilir.'),
    ).toBeTruthy();
  });
});
