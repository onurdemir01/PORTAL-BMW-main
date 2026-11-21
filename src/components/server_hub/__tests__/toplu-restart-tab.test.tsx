// src/components/server_hub/__tests__/toplu-restart-tab.test.tsx — Server Hub › Toplu Restart (2026-11-14).
//
// Kullanıcı: "JVM parametreleri calisan surectekinden FARKLI uyarilari ... bunlar icin de toplu restart et sayfasi".
//   TRT1 aday listesi farklı parametreleri (maskeli) gösterir, varsayılan hepsi seçili; TEK düğme
//        "Önizle ve restart et (N JVM)" seçimi gönderir (önizleme açılır, onay/restart yok); prod notu görünür
//   TRT1b limit aşılınca düğme kilitli ve neden yazılı
//   TRT2 önizleme hazır: onay penceresi tek tek / kopyalar / Teams kartı / prod dışı der; onaysız restart yok;
//        iptal düğmesi "İptal" (Vazgeç değil)
//   TRT3 gizli sekmede istek ve yoklama yok; görünür olunca okur ve yürüyen işi yoklar
//   TRT4 sonuç tablosu: fark kapanmadı nedeni (yanlış uyarı notu), iş numaraları, özet kırmızı (başarısız var)
//   TRT5 sekme kaydı: ServerHubPage listesinde 'toplurestart', görünürlük anahtarı, SekmeKabi; seed default_visible 0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { zamanlayiciKuruluncaIlerlet } from '@/test/zamanlayici';

const m = vi.hoisted(() => ({
  topluRestartAdaylar: vi.fn(),
  topluRestartListe: vi.fn(),
  topluRestartDurum: vi.fn(),
  topluRestartOlustur: vi.fn(),
  topluRestartOnayla: vi.fn(),
  topluRestartIptal: vi.fn(),
}));
const toastM = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));

import TopluRestartTab, {
  YOKLAMA_MS,
  PLAN_YOKLAMA_MS,
  onayMetni,
} from '@/components/server_hub/TopluRestartTab';
import { SekmeKabi } from '@/components/server_hub/sekmeGorunurlugu';

const aday = (host: string, jvm: string, ek = {}) => ({
  host,
  env: 'TEST',
  envGroup: 'Non-Production',
  gen: 8,
  jvm,
  grp: `${jvm}_Group`,
  scanDate: '2026-11-14',
  fark: '-Xmx running=2g configured=4g; -Ddb.password running=*** configured=*** (farklı)',
  anahtarlar: ['-Xmx', '-Ddb.password'],
  ...ek,
});
const isSatiri = (durum: string, ek = {}) => ({
  id: 9,
  durum,
  olusturan: 'ayse',
  onaylayan: null,
  iptalEden: null,
  ustSinir: 50,
  aday: 3,
  planGecti: 2,
  dusen: 1,
  kapandi: 0,
  kapanmadi: 0,
  fail: 0,
  hata: null,
  createdAt: '2026-11-14T10:00:00Z',
  planBitisAt: '2026-11-14T10:01:00Z',
  onayAt: null,
  bitisAt: null,
  ...ek,
});
const oge = (id: number, host: string, jvm: string, durum: string, ek = {}) => ({
  id,
  sira: id,
  host,
  env: 'TEST',
  gen: 8,
  jvm,
  grp: `${jvm}_Group`,
  uygulama: jvm,
  fark: '-Xmx running=2g configured=4g',
  farkSonra: null,
  durum,
  neden: null,
  planJobId: 100,
  awxServerId: 2,
  restartJobId: null,
  taramaJobId: null,
  startState: null,
  baslamaAt: null,
  bitisAt: null,
  ...ek,
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.topluRestartAdaylar.mockResolvedValue({
    ok: true,
    adaylar: [aday('APP01', 'crm'), aday('APP02', 'crm'), aday('APP02', 'pay')],
    dislananlar: [
      {
        ...aday('PRD01', 'prod1'),
        neden: "prod — OpsX'ten tek tek (Smart onayı; toplu restart prod'a dokunmaz).",
      },
      {
        ...aday('BAYAT01', 'x'),
        neden: 'tarama bayat (2026-11-01) — önce sunucuyu yeniden tarayın.',
      },
    ],
    limit: 50,
    aktif: null,
    latestScan: '2026-11-14',
  });
  m.topluRestartListe.mockResolvedValue({ ok: true, aktif: null, son: [] });
});

describe('Toplu Restart sekmesi', () => {
  it('TRT1 farklı parametreler görünür, hepsi seçili; tek düğme önizleme açar (restart yok); prod notu', async () => {
    m.topluRestartOlustur.mockResolvedValue({ ok: true, id: 9, adet: 3, hostSayisi: 2 });
    m.topluRestartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLANLANIYOR'), ogeler: [] });
    render(<TopluRestartTab />);
    const dugme = await screen.findByRole('button', { name: 'Önizle ve restart et (3 JVM)' });
    expect(screen.getAllByText('-Xmx running=2g configured=4g').length).toBe(3);
    expect(screen.getAllByText(/-Ddb\.password running=\*\*\* configured=\*\*\*/).length).toBe(3);
    expect(
      screen.getByText(/1 JVM prod \/ ortamı bilinmeyen ya da standalone sunucuda/),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText('APP02 pay seç'));
    expect(screen.getByRole('button', { name: 'Önizle ve restart et (2 JVM)' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('APP02 pay seç'));
    fireEvent.click(dugme);
    await waitFor(() => expect(m.topluRestartOlustur).toHaveBeenCalledTimes(1));
    expect(m.topluRestartOlustur.mock.calls[0][0]).toEqual([
      { host: 'APP01', gen: 8, jvm: 'crm' },
      { host: 'APP02', gen: 8, jvm: 'crm' },
      { host: 'APP02', gen: 8, jvm: 'pay' },
    ]);
    await screen.findByText('Önizleme taraması (salt okunur)');
    expect(m.topluRestartOnayla).not.toHaveBeenCalled();
  });

  it('TRT1b limit aşılınca düğme kilitli ve neden yazılı', async () => {
    m.topluRestartAdaylar.mockResolvedValue({
      ok: true,
      adaylar: [aday('APP01', 'crm'), aday('APP02', 'crm')],
      dislananlar: [],
      limit: 1,
      aktif: null,
    });
    render(<TopluRestartTab />);
    const dugme = (await screen.findByRole('button', {
      name: 'Önizle ve restart et (2 JVM)',
    })) as HTMLButtonElement;
    expect(dugme.disabled).toBe(true);
    expect(screen.getByText(/sınır aşıldı/)).toBeTruthy();
  });

  it('TRT2 önizleme hazır: onay penceresi sırayı ve yan etkileri söyler; onaydan sonra; "İptal"', async () => {
    m.topluRestartListe.mockResolvedValue({
      ok: true,
      aktif: isSatiri('PLAN_HAZIR', { planBitisAt: new Date().toISOString() }),
      son: [],
    });
    const ogeler = [
      oge(1, 'APP01', 'crm', 'PLAN_GECTI'),
      oge(2, 'APP02', 'pay', 'PLAN_GECTI'),
      oge(3, 'APP02', 'crm', 'DUSTU', { neden: 'önizlemede düştü: JVM artık çalışmıyor' }),
    ];
    m.topluRestartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('PLAN_HAZIR', { planBitisAt: new Date().toISOString() }),
      ogeler,
    });
    m.topluRestartOnayla.mockResolvedValue({ ok: true, id: 9, adet: 2 });
    render(<TopluRestartTab />);
    const onay = await screen.findByRole('button', { name: 'Onayla ve restart et (2 JVM)' });
    expect(screen.getByText(/önizlemede düştü: JVM artık çalışmıyor/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'İptal' })).toBeTruthy();
    expect(screen.queryByText(/Vazgeç/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: /^Önizle ve restart et/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(onay);
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(/2 JVM, 2 sunucu RESTART edilecek/);
    expect(pencere.textContent).toMatch(/TEK TEK restart edilir/);
    expect(pencere.textContent).toMatch(/kopyaları asla aynı anda/);
    expect(pencere.textContent).toMatch(/Teams’e bir bildirim kartı gönderir \(2 kart\)/);
    expect(pencere.textContent).toMatch(/Prod sunucular bu listede yoktur/);
    expect(m.topluRestartOnayla).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve restart et' }));
    await waitFor(() => expect(m.topluRestartOnayla).toHaveBeenCalledWith(9));
  });

  it('TRT2b onay metni saf fonksiyon', () => {
    const t = onayMetni([
      oge(1, 'H1', 'a', 'PLAN_GECTI'),
      oge(2, 'H1', 'b', 'PLAN_GECTI'),
      oge(3, 'H2', 'c', 'DUSTU'),
    ] as never);
    expect(t).toMatch(/^2 JVM, 1 sunucu RESTART edilecek/);
  });

  describe('TRT3 gizli sekmede istek / yoklama yok', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());
    it('görünür olunca okur ve yürüyen işi yoklar; gizliyken durur', async () => {
      m.topluRestartListe.mockResolvedValue({ ok: true, aktif: isSatiri('CALISIYOR'), son: [] });
      m.topluRestartDurum.mockResolvedValue({
        ok: true,
        is: isSatiri('CALISIYOR'),
        ogeler: [oge(1, 'APP01', 'crm', 'CALISIYOR', { restartJobId: 900 })],
      });
      const { rerender } = render(
        <SekmeKabi id="toplurestart" etkin="hosts">
          <TopluRestartTab />
        </SekmeKabi>,
      );
      await act(async () => {
        vi.advanceTimersByTime(YOKLAMA_MS * 5);
      });
      expect(m.topluRestartAdaylar).not.toHaveBeenCalled();
      expect(m.topluRestartDurum).not.toHaveBeenCalled();
      rerender(
        <SekmeKabi id="toplurestart" etkin="toplurestart">
          <TopluRestartTab />
        </SekmeKabi>,
      );
      await waitFor(() => expect(m.topluRestartDurum).toHaveBeenCalledTimes(1));
      await screen.findByText(/Şu an: APP01\/crm — restart ediliyor \(restart #900\)/);
      await zamanlayiciKuruluncaIlerlet(YOKLAMA_MS);
      await waitFor(() => expect(m.topluRestartDurum).toHaveBeenCalledTimes(2));
      rerender(
        <SekmeKabi id="toplurestart" etkin="hosts">
          <TopluRestartTab />
        </SekmeKabi>,
      );
      await act(async () => {
        vi.advanceTimersByTime(YOKLAMA_MS * 5);
      });
      expect(m.topluRestartDurum).toHaveBeenCalledTimes(2);
    });
  });

  it('TRT4 sonuç: kapanmadı nedeni, iş numaraları, kırmızı özet', async () => {
    m.topluRestartListe.mockResolvedValue({
      ok: true,
      aktif: null,
      son: [isSatiri('BITTI_HATALI')],
    });
    m.topluRestartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('BITTI_HATALI'),
      ogeler: [
        oge(1, 'APP01', 'crm', 'KAPANDI', {
          restartJobId: 900,
          taramaJobId: 501,
          startState: 'STARTED',
          neden: 'restart edildi, fark kapandı',
        }),
        oge(2, 'APP02', 'pay', 'KAPANMADI', {
          restartJobId: 901,
          taramaJobId: 502,
          startState: 'STARTED',
          neden:
            "restart edildi ama fark kapanmadı — tarama yanlış uyarı veriyor olabilir (server-group jvm ayarı domain.xml'de olabilir ya da host XML diskte değişmiş ama host controller yeniden yüklenmemiş olabilir)",
        }),
        oge(3, 'APP03', 'crm', 'FAIL', {
          restartJobId: 902,
          startState: 'NOT_STARTED',
          neden: 'restart işi #902 bitti ama JVM STARTED olmadı',
        }),
        oge(4, 'APP04', 'crm', 'ATLANDI', {
          neden: 'aynı uygulamanın kopyası APP03/crm restart’ta ayağa kalkmadı',
        }),
      ],
    });
    render(<TopluRestartTab />);
    await screen.findByText(
      /tarama yanlış uyarı veriyor olabilir \(server-group jvm ayarı domain\.xml'de olabilir/,
    );
    expect(screen.getByText(/önizleme #100 · restart #901 · tarama #502/)).toBeTruthy();
    const ozet = screen.getByText(/^Özet: 1 kapandı, 1 kapanmadı, 1 başarısız, 1 atlandı/);
    expect(ozet.getAttribute('style') || '').toMatch(/status-danger/);
    expect(screen.getByText('Bitti — başarısız öğe var')).toBeTruthy();
  });

  it('TRT5 sekme kaydı: liste, görünürlük anahtarı, SekmeKabi, seed, limit', () => {
    const kok = path.resolve(__dirname, '..', '..', '..', '..');
    const sh = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'ServerHubPage.tsx'),
      'utf8',
    );
    expect(sh).toMatch(/\{ id: 'toplurestart', label: 'Toplu Restart' \}/);
    expect(sh).toMatch(/canSee\('tab:serverhub:toplurestart'\)/);
    expect(sh).toMatch(/\(t\.id !== 'toplurestart' \|\| topluRestartGorur\)/);
    expect(sh).toMatch(
      /topluRestartGorur && acilan\.has\('toplurestart'\) && \(\s*<SekmeKabi id="toplurestart" etkin=\{tab\}>\s*<TopluRestartTab \/>/,
    );
    const seed = fs.readFileSync(path.join(kok, 'server', 'db', 'mssql-setup.cjs'), 'utf8');
    expect(seed).toMatch(
      /element_key: 'tab:serverhub:toplurestart',\s*element_type: 'tab',\s*parent_key: 'ServerHub',[\s\S]{0,80}default_visible: 0/,
    );
    const ay = fs.readFileSync(path.join(kok, 'server', 'server-hub', 'ayarlar.cjs'), 'utf8');
    expect(ay).toMatch(/toplu_restart: \{\s*ad: 'Toplu Restart',\s*varsayilan: 200,/);
    const tab = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'TopluRestartTab.tsx'),
      'utf8',
    );
    expect(tab).not.toMatch(/Vazge/);
  });

  it('TRT6 onay bekleyen iş: süre dolunca onay kilitli; seyrek yoklama; önizlemede iptal metni; hiç restart yoksa nötr özet', async () => {
    const eski = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    m.topluRestartListe.mockResolvedValue({
      ok: true,
      aktif: isSatiri('PLAN_HAZIR', { planBitisAt: eski }),
      son: [],
    });
    m.topluRestartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('PLAN_HAZIR', { planBitisAt: eski }),
      ogeler: [oge(1, 'APP01', 'crm', 'PLAN_GECTI')],
    });
    const { unmount } = render(<TopluRestartTab />);
    const onay = (await screen.findByRole('button', {
      name: 'Onayla ve restart et (1 JVM)',
    })) as HTMLButtonElement;
    expect(onay.disabled).toBe(true);
    expect(screen.getByText(/Süre doldu — onaylanamaz/)).toBeTruthy();
    unmount();
    // onizleme (PLANLANIYOR) iptali: restart iptali metni DEGIL
    m.topluRestartListe.mockResolvedValue({ ok: true, aktif: isSatiri('PLANLANIYOR'), son: [] });
    m.topluRestartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('PLANLANIYOR'),
      ogeler: [oge(1, 'APP01', 'crm', 'PLANLANIYOR')],
    });
    const r2 = render(<TopluRestartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(
      /salt okunur önizleme taraması bitince iş durur; hiçbir JVM’e dokunulmaz/,
    );
    expect(pencere.textContent).not.toMatch(/süren restart/);
    r2.unmount();
    // hepsi onizlemede dustu: yesil 'Tamamlandi' degil
    m.topluRestartListe.mockResolvedValue({ ok: true, aktif: null, son: [isSatiri('BITTI')] });
    m.topluRestartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('BITTI'),
      ogeler: [oge(1, 'APP01', 'crm', 'DUSTU', { neden: 'fark kalmadı' })],
    });
    render(<TopluRestartTab />);
    const ozet = await screen.findByText(/^Restart edilen JVM yok: 1 düştü/);
    expect(ozet.getAttribute('style') || '').not.toMatch(/status-success/);
    expect(screen.queryByText(/^Tamamlandı/)).toBeNull();
  });

  it('TRT8 oluşturma 5xx / HTML ile dönerse kör yeniden deneme yok: iş yeniden okunur ve izlenir', async () => {
    const hata5 = Object.assign(
      new Error(
        'Sunucu isteği işlerken hata verdi (HTTP 500); ağ geçidi asıl hata mesajını bir HTML sayfasıyla değiştirdi.',
      ),
      {
        status: 500,
        htmlGovde: true,
      },
    );
    m.topluRestartOlustur.mockRejectedValue(hata5);
    // ilk okuma (sekme açılışı) iş yok; hatadan sonraki okuma iş #9'u (PLANLANIYOR) bulur
    m.topluRestartListe
      .mockResolvedValueOnce({ ok: true, aktif: null, son: [] })
      .mockResolvedValueOnce({ ok: true, aktif: isSatiri('PLANLANIYOR'), son: [] });
    m.topluRestartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('PLANLANIYOR'),
      ogeler: [oge(1, 'APP01', 'crm', 'SECIM', { planJobId: null })],
    });
    const { unmount } = render(<TopluRestartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Önizle ve restart et (3 JVM)' }));
    await waitFor(() => expect(m.topluRestartDurum).toHaveBeenCalledWith(9));
    expect(m.topluRestartListe).toHaveBeenCalledTimes(2);
    const mesaj = String(toastM.error.mock.calls.at(-1)?.[0]);
    expect(mesaj).toMatch(
      /işi #9 kayıtlı \(PLANLANIYOR\) — aşağıda izleniyor; yeniden göndermeyin/,
    );
    expect(mesaj).not.toMatch(/<html|<!doctype/i);
    await screen.findByText('seçim doğrulanıyor (taze tarama)');
    unmount();
    // iş açılmamış (doğrulandı) ve liste okunamadı durumları
    toastM.error.mockReset();
    m.topluRestartListe.mockReset();
    m.topluRestartListe.mockResolvedValue({
      ok: true,
      aktif: null,
      son: [isSatiri('BITTI', { createdAt: '2020-01-01T00:00:00Z' })],
    });
    m.topluRestartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('BITTI', { createdAt: '2020-01-01T00:00:00Z' }),
      ogeler: [],
    });
    const r2 = render(<TopluRestartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Önizle ve restart et (3 JVM)' }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledTimes(1));
    expect(String(toastM.error.mock.calls[0][0])).toMatch(/İş kaydı açılmadı \(doğrulandı/);
    r2.unmount();
    toastM.error.mockReset();
    m.topluRestartListe.mockReset();
    m.topluRestartListe
      .mockResolvedValueOnce({ ok: true, aktif: null, son: [] })
      .mockRejectedValueOnce(new Error('ağ yok'));
    render(<TopluRestartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Önizle ve restart et (3 JVM)' }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledTimes(1));
    expect(String(toastM.error.mock.calls[0][0])).toMatch(
      /açılıp açılmadığı okunamadı — yeniden göndermeden önce/,
    );
  });

  it('TRT8b istekten önce bilinen son iş (az önceki başarısız deneme, PLAN_HATA) "kayıtlı" sayılmaz', async () => {
    m.topluRestartOlustur.mockRejectedValue(
      Object.assign(new Error('Sunucu isteği işlerken hata verdi (HTTP 500).'), { status: 500 }),
    );
    const onceki = isSatiri('PLAN_HATA', { createdAt: new Date().toISOString() });
    m.topluRestartListe.mockResolvedValue({ ok: true, aktif: null, son: [onceki] });
    m.topluRestartDurum.mockResolvedValue({ ok: true, is: onceki, ogeler: [] });
    render(<TopluRestartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Önizle ve restart et (3 JVM)' }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledTimes(1));
    const mesaj = String(toastM.error.mock.calls[0][0]);
    expect(mesaj).not.toMatch(/#9 kayıtlı/);
    expect(mesaj).toMatch(/İş kaydı açılmadı \(doğrulandı/);
  });

  it('TRT9 kesin ret (4xx, örn. nginxRed 409) durumu yeniden okumaz; sunucunun mesajı gösterilir', async () => {
    m.topluRestartOlustur.mockRejectedValue(
      Object.assign(new Error('Bu kaynağa erişiminiz kapalı.'), { status: 403, nginxRed: true }),
    );
    render(<TopluRestartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Önizle ve restart et (3 JVM)' }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Bu kaynağa erişiminiz kapalı.'));
    expect(m.topluRestartListe).toHaveBeenCalledTimes(1);
  });

  describe('TRT7 onay bekleyen iş seyrek yoklanır (başka admin onaylar / iptal eder)', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());
    it('PLAN_HAZIR: PLAN_YOKLAMA_MS aralığıyla okunur', async () => {
      const taze = new Date().toISOString();
      m.topluRestartListe.mockResolvedValue({
        ok: true,
        aktif: isSatiri('PLAN_HAZIR', { planBitisAt: taze }),
        son: [],
      });
      m.topluRestartDurum.mockResolvedValue({
        ok: true,
        is: isSatiri('PLAN_HAZIR', { planBitisAt: taze }),
        ogeler: [oge(1, 'APP01', 'crm', 'PLAN_GECTI')],
      });
      render(<TopluRestartTab />);
      await waitFor(() => expect(m.topluRestartDurum).toHaveBeenCalledTimes(1));
      await screen.findByText(/Kalan süre: ~15 dk/);
      // 15 dk onizleme BITTIGINDE baslar (2026-11-15: kullanicilar onizleme suresini de sayiyordu)
      expect(screen.getByText(/15 dakikalık onay süresi önizleme BİTTİĞİNDE başladı/)).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(YOKLAMA_MS);
      });
      expect(m.topluRestartDurum).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(PLAN_YOKLAMA_MS);
      });
      await waitFor(() => expect(m.topluRestartDurum).toHaveBeenCalledTimes(2));
    });
  });

  it('TRT10 başarısız öğeler kümelenir: kapanmadı / atlandı / başarısız sayılır, süzülür', async () => {
    m.topluRestartListe.mockResolvedValue({
      ok: true,
      aktif: null,
      son: [isSatiri('BITTI_HATALI')],
    });
    m.topluRestartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('BITTI_HATALI'),
      ogeler: [
        oge(1, 'APP01', 'crm', 'KAPANDI', { neden: 'restart edildi, fark kapandı' }),
        oge(2, 'APP02', 'pay', 'FAIL', {
          neden:
            "restart isteği belirsiz hatayla döndü (AWX'te sürüyor olabilir): socket hang up — AWX'ten kontrol edin",
        }),
        oge(3, 'APP03', 'crm', 'IPTAL', { neden: 'iptal edildi (çalıştırılmadı)' }),
        oge(4, 'APP04', 'crm', 'DUSTU', { neden: 'önizlemede düştü: fark kalmadı' }),
        oge(5, 'APP05', 'crm', 'ATLANDI', { neden: "atlandı: prod — OpsX'ten tek tek" }),
      ],
    });
    render(<TopluRestartTab />);
    await screen.findByRole('group', { name: 'Başarısız öğe kategorileri' });
    expect(screen.getByRole('button', { name: 'Bağlantı / süre / AWX 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tarama eski / zaten hedefte 1' })).toBeTruthy();
    // ATLANDI restart'ta basarisiz sayilir
    expect(screen.getByRole('button', { name: 'Diğer 1' })).toBeTruthy();
    const iptal = screen.getByRole('button', { name: 'İptal / durduruldu / yarım kaldı 1' });
    fireEvent.click(iptal);
    const satirlar = screen.getByLabelText('Toplu restart #9').querySelectorAll('tbody tr');
    expect(satirlar.length).toBe(1);
    expect(satirlar[0].textContent).toMatch(/APP03/);
    expect(screen.getByTestId('kategori-ne-yapilir').textContent).toMatch(
      /Ne yapılır: İş iptal edildi/,
    );
    // ayni cipe ikinci tik secimi kaldirir
    fireEvent.click(iptal);
    expect(screen.getByLabelText('Toplu restart #9').querySelectorAll('tbody tr').length).toBe(5);
  });

  it('TRT11 kategori seçimi işe bağlı: Listeyi yenile başka işi getirince seçim düşer', async () => {
    const ogeleri = () => [
      oge(1, 'APP01', 'crm', 'KAPANDI', { neden: 'restart edildi, fark kapandı' }),
      oge(3, 'APP03', 'crm', 'IPTAL', { neden: 'iptal edildi (çalıştırılmadı)' }),
    ];
    m.topluRestartListe.mockResolvedValue({
      ok: true,
      aktif: null,
      son: [isSatiri('BITTI_HATALI')],
    });
    m.topluRestartDurum.mockImplementation(async (id: number) => ({
      ok: true,
      is: isSatiri('BITTI_HATALI', { id }),
      ogeler: ogeleri(),
    }));
    render(<TopluRestartTab />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'İptal / durduruldu / yarım kaldı 1' }),
    );
    expect(screen.getByLabelText('Toplu restart #9').querySelectorAll('tbody tr').length).toBe(1);
    m.topluRestartListe.mockResolvedValue({
      ok: true,
      aktif: null,
      son: [isSatiri('BITTI_HATALI', { id: 10 })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Listeyi yenile' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Toplu restart #10').querySelectorAll('tbody tr').length).toBe(
        2,
      ),
    );
    expect(screen.getByRole('button', { name: 'Tümü' }).getAttribute('aria-pressed')).toBe('true');
  });
});
