// src/components/server_hub/__tests__/toplu-autostart-tab.test.tsx — Server Hub › Toplu Auto-Start (2026-11-14).
//
// Kullanıcı: "auto-start'lari toplu duzeltebilmek icin bir sayfa ve tek bir buton hazirlayabilir misin?"
//   TT1 aday listesi AÇ / KAPAT grupları, varsayılan hepsi seçili; TEK düğme "Planla (N JVM)" seçimi gönderir;
//       limit aşılınca düğme kilitli ve neden yazılı
//   TT2 plan hazır: onay penceresi kapsamı ve sırayı söyler ("her sunucu için tek iş", "sırayla"); onaysız uygulama
//       yok; iptal düğmesi "İptal" (Vazgeç değil)
//   TT3 gizli sekmede istek ve yoklama yok; görünür olunca okur ve yürüyen işi yoklar
//   TT4 doğrulanan öğe (ilk kez görülen) autoStartIsi yoluna yayılır (açık panel / Bulgular güncellenir); ilk
//       okumada zaten doğrulanmış olanlar yayılmaz
//   TT5 sekme kaydı: ServerHubPage listesinde 'topluautostart', görünürlük anahtarı, SekmeKabi; seed default_visible 0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { zamanlayiciKuruluncaIlerlet } from '@/test/zamanlayici';

const m = vi.hoisted(() => ({
  topluAutoStartAdaylar: vi.fn(),
  topluAutoStartListe: vi.fn(),
  topluAutoStartDurum: vi.fn(),
  topluAutoStartOlustur: vi.fn(),
  topluAutoStartOnayla: vi.fn(),
  topluAutoStartIptal: vi.fn(),
}));
const toastM = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
const yay = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/components/server_hub/autoStartIsi', async (orig) => ({
  ...(await orig<typeof import('@/components/server_hub/autoStartIsi')>()),
  autoStartSonucYay: yay,
}));

import TopluAutoStartTab, {
  YOKLAMA_MS,
  PLAN_YOKLAMA_MS,
  onayMetni,
  awxIsSayisi,
  isOzeti,
  belirsizMi,
  acilanIsSayisi,
} from '@/components/server_hub/TopluAutoStartTab';
import { SekmeKabi } from '@/components/server_hub/sekmeGorunurlugu';

const aday = (host: string, jvm: string, eylem: 'ac' | 'kapat') => ({
  host,
  env: 'Test',
  envGroup: 'Non-Production',
  gen: 7,
  jvm,
  eylem,
  action: eylem === 'ac' ? 'jboss_autostart_on' : 'jboss_autostart_off',
  running: eylem === 'ac',
  autoStart: eylem === 'ac' ? 'false' : 'true',
  scanDate: '2026-11-14',
});
const isSatiri = (durum: string, ek = {}) => ({
  id: 7,
  durum,
  olusturan: 'ayse',
  onaylayan: null,
  iptalEden: null,
  ustSinir: 50,
  aday: 3,
  planGecti: 2,
  dusen: 1,
  ok: 0,
  skip: 0,
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
  env: 'Test',
  gen: 7,
  jvm,
  eylem: 'jboss_autostart_on',
  hedef: 'true',
  taramaDegeri: 'false',
  calisiyor: true,
  taramaScanDate: '2026-11-14',
  durum,
  neden: null,
  planJobId: 100 + id,
  awxServerId: 1,
  awxJobId: null,
  sonucSatiri: null,
  dogrulandi: false,
  baslamaAt: null,
  bitisAt: null,
  ...ek,
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  yay.mockReset();
  m.topluAutoStartAdaylar.mockResolvedValue({
    ok: true,
    adaylar: [aday('APP01', 'a1', 'ac'), aday('APP01', 'k1', 'kapat'), aday('APP02', 'a2', 'ac')],
    dislananlar: [{ ...aday('BAYAT01', 'x', 'ac'), neden: 'BAYAT01 taraması bayat' }],
    limit: 50,
    aktif: null,
    latestScan: '2026-11-14',
  });
  m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: null, son: [] });
});

describe('Toplu Auto-Start sekmesi', () => {
  it('TT1 adaylar seçili, tek düğme seçimi gönderir; limit aşılınca kilitli', async () => {
    m.topluAutoStartOlustur.mockResolvedValue({ ok: true, id: 7, adet: 3, hostSayisi: 2 });
    m.topluAutoStartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLANLANIYOR'), ogeler: [] });
    render(<TopluAutoStartTab />);
    const dugme = await screen.findByRole('button', { name: 'Planla (3 JVM)' });
    expect(screen.getByText(/AÇ — çalışıyor ama auto-start kapalı/)).toBeTruthy();
    expect(screen.getByText(/KAPAT — durmuş ama auto-start açık/)).toBeTruthy();
    expect(screen.getByText(/BAYAT01 taraması bayat/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('APP02 a2 seç'));
    expect(screen.getByRole('button', { name: 'Planla (2 JVM)' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('APP02 a2 seç'));
    fireEvent.click(dugme);
    await waitFor(() => expect(m.topluAutoStartOlustur).toHaveBeenCalledTimes(1));
    expect(m.topluAutoStartOlustur.mock.calls[0][0]).toEqual([
      { host: 'APP01', gen: 7, jvm: 'a1', eylem: 'ac' },
      { host: 'APP01', gen: 7, jvm: 'k1', eylem: 'kapat' },
      { host: 'APP02', gen: 7, jvm: 'a2', eylem: 'ac' },
    ]);
    await screen.findByText('Plan okunuyor (salt okunur)');
    expect(m.topluAutoStartOnayla).not.toHaveBeenCalled();
  });

  it('TT1c oluşturma 5xx ile dönerse iş yeniden okunur ve izlenir (kör yeniden deneme yok)', async () => {
    m.topluAutoStartOlustur.mockRejectedValue(Object.assign(new Error('Sunucu isteği işlerken hata verdi (HTTP 500).'), { status: 500 }));
    m.topluAutoStartListe.mockResolvedValueOnce({ ok: true, aktif: null, son: [] }).mockResolvedValueOnce({ ok: true, aktif: isSatiri('PLANLANIYOR'), son: [] });
    m.topluAutoStartDurum.mockResolvedValue({ ok: true, is: isSatiri('PLANLANIYOR'), ogeler: [] });
    render(<TopluAutoStartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Planla (3 JVM)' }));
    await waitFor(() => expect(m.topluAutoStartDurum).toHaveBeenCalledWith(7));
    expect(String(toastM.error.mock.calls.at(-1)?.[0])).toMatch(/Toplu auto-start işi #7 kayıtlı \(PLANLANIYOR\) — aşağıda izleniyor; yeniden göndermeyin/);
    await screen.findByText('Plan okunuyor (salt okunur)');
  });

  it('TT1b limit aşılınca Planla kilitli ve neden yazılı', async () => {
    m.topluAutoStartAdaylar.mockResolvedValue({
      ok: true,
      adaylar: [aday('APP01', 'a1', 'ac'), aday('APP02', 'a2', 'ac')],
      dislananlar: [],
      limit: 1,
      aktif: null,
    });
    render(<TopluAutoStartTab />);
    const dugme = (await screen.findByRole('button', {
      name: 'Planla (2 JVM)',
    })) as HTMLButtonElement;
    expect(dugme.disabled).toBe(true);
    expect(screen.getByText(/sınır aşıldı/)).toBeTruthy();
  });

  it('TT2 plan hazır: onay penceresi kapsamı söyler, onaydan sonra uygular; iptal düğmesi "İptal"', async () => {
    m.topluAutoStartListe.mockResolvedValue({
      ok: true,
      aktif: isSatiri('PLAN_HAZIR', { planBitisAt: new Date().toISOString() }),
      son: [],
    });
    const ogeler = [
      oge(1, 'APP01', 'a1', 'PLAN_GECTI'),
      oge(2, 'APP01', 'k1', 'PLAN_GECTI', { hedef: 'false', eylem: 'jboss_autostart_off' }),
      oge(3, 'APP02', 'a2', 'DUSTU', { neden: 'canlı değer zaten true — tarama eski' }),
    ];
    m.topluAutoStartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('PLAN_HAZIR', { planBitisAt: new Date().toISOString() }),
      ogeler,
    });
    m.topluAutoStartOnayla.mockResolvedValue({ ok: true, id: 7, adet: 2 });
    render(<TopluAutoStartTab />);
    const onay = await screen.findByRole('button', { name: 'Onayla ve uygula (2 JVM)' });
    expect(screen.getByText(/canlı değer zaten true — tarama eski/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'İptal' })).toBeTruthy();
    expect(screen.queryByText(/Vazgeç/)).toBeNull();
    // aktif is varken yeni plan acilmaz
    expect((screen.getByRole('button', { name: /^Planla/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(onay);
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(
      /2 JVM, 1 sunucu: 1 JVM'de auto-start AÇILACAK, 1 JVM'de KAPATILACAK/,
    );
    expect(pencere.textContent).toMatch(/Her sunucu için ayrı AWX işi açılır, işler sırayla çalışır/);
    expect(pencere.textContent).toMatch(/sonucu belirsiz iş \(AWX’te sürüyor olabilir\) toplu işi durdurur/);
    // 15 dk onay suresi planlama BITTIGINDE baslar (kullanicilar planlama suresini de sayiyordu)
    expect(screen.getByText(/15 dakikalık onay süresi planlama BİTTİĞİNDE başladı \(planlamanın kendi süresi buna dahil değil\)/)).toBeTruthy();
    expect(m.topluAutoStartOnayla).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla ve uygula' }));
    await waitFor(() => expect(m.topluAutoStartOnayla).toHaveBeenCalledWith(7));
  });

  it('TT2b onay metni saf fonksiyon', () => {
    const t = onayMetni([
      oge(1, 'H1', 'a', 'PLAN_GECTI'),
      oge(2, 'H2', 'b', 'PLAN_GECTI'),
      oge(3, 'H2', 'c', 'DUSTU'),
    ] as never);
    expect(t).toMatch(/^2 JVM, 2 sunucu: 2 JVM'de auto-start AÇILACAK, 0 JVM'de KAPATILACAK/);
  });

  it('TT6 parçalama (2026-11-15): AWX işi sayısı seçimde, onayda ve işte görünür', async () => {
    // 35 JVM tek sunucu + 1 JVM baska sunucu, is basina 10 -> 4 + 1 = 5 AWX isi
    const cok = Array.from({ length: 35 }, (_, i) => aday('BUYUK01', `j${i}`, 'ac'));
    expect(awxIsSayisi([...cok, aday('APP02', 'a2', 'ac')], 10)).toBe(5);
    expect(awxIsSayisi(cok, 50)).toBe(1);
    expect(awxIsSayisi([], 10)).toBe(0);
    expect(isOzeti(cok, 10)).toBe('4 AWX işi, iş başına en çok 10 JVM');
    const ogeler = Array.from({ length: 12 }, (_, i) => oge(i + 1, 'BUYUK01', `j${i}`, 'PLAN_GECTI'));
    expect(onayMetni(ogeler as never, 5)).toMatch(/iş başına en çok 5 JVM'lik AWX işlerine bölünür \(3 AWX işi, iş başına en çok 5 JVM\); işler tek tek, sırayla/);
    m.topluAutoStartAdaylar.mockResolvedValue({
      ok: true,
      adaylar: [...cok, aday('APP02', 'a2', 'ac')],
      dislananlar: [],
      limit: 500,
      isBasinaJvm: 10,
      aktif: null,
    });
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: isSatiri('CALISIYOR'), son: [] });
    m.topluAutoStartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('CALISIYOR'),
      ogeler: [
        oge(1, 'BUYUK01', 'j0', 'OK', { planJobId: 11, awxJobId: 21 }),
        oge(2, 'BUYUK01', 'j1', 'CALISIYOR', { planJobId: 11, awxJobId: 22 }),
        oge(3, 'BUYUK01', 'j2', 'BEKLIYOR', { planJobId: 12 }),
      ],
    });
    render(<TopluAutoStartTab />);
    expect((await screen.findByTestId('toplu-is-ozeti')).textContent).toBe('· 5 AWX işi, iş başına en çok 10 JVM');
    expect((await screen.findByTestId('toplu-awx-isleri')).textContent).toBe('AWX işi: plan 2 · uygulama 2 (iş başına en çok 10 JVM)');
    // satir basina is baglantisi kalir
    expect(screen.getByText('#22')).toBeTruthy();
    expect(screen.getByText('plan #12')).toBeTruthy();
  });

  describe('TT3 gizli sekmede istek / yoklama yok', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());
    it('görünür olunca okur ve yürüyen işi yoklar; gizliyken durur', async () => {
      m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: isSatiri('CALISIYOR'), son: [] });
      m.topluAutoStartDurum.mockResolvedValue({
        ok: true,
        is: isSatiri('CALISIYOR'),
        ogeler: [oge(1, 'APP01', 'a1', 'CALISIYOR')],
      });
      const { rerender } = render(
        <SekmeKabi id="topluautostart" etkin="hosts">
          <TopluAutoStartTab />
        </SekmeKabi>,
      );
      await act(async () => {
        vi.advanceTimersByTime(YOKLAMA_MS * 5);
      });
      expect(m.topluAutoStartAdaylar).not.toHaveBeenCalled();
      expect(m.topluAutoStartDurum).not.toHaveBeenCalled();
      rerender(
        <SekmeKabi id="topluautostart" etkin="topluautostart">
          <TopluAutoStartTab />
        </SekmeKabi>,
      );
      await waitFor(() => expect(m.topluAutoStartDurum).toHaveBeenCalledTimes(1));
      await zamanlayiciKuruluncaIlerlet(YOKLAMA_MS);
      await waitFor(() => expect(m.topluAutoStartDurum).toHaveBeenCalledTimes(2));
      rerender(
        <SekmeKabi id="topluautostart" etkin="hosts">
          <TopluAutoStartTab />
        </SekmeKabi>,
      );
      await act(async () => {
        vi.advanceTimersByTime(YOKLAMA_MS * 5);
      });
      expect(m.topluAutoStartDurum).toHaveBeenCalledTimes(2);
    });
  });

  it('TT4 yeni doğrulanan öğe bir kez yayılır; ilk okumada doğrulanmış olan yayılmaz', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: isSatiri('CALISIYOR'), son: [] });
      m.topluAutoStartDurum.mockResolvedValueOnce({
        ok: true,
        is: isSatiri('CALISIYOR'),
        ogeler: [
          oge(1, 'APP01', 'eski', 'OK', { dogrulandi: true, awxJobId: 900 }),
          oge(2, 'APP02', 'a2', 'CALISIYOR', { awxJobId: 901 }),
        ],
      });
      m.topluAutoStartDurum.mockResolvedValue({
        ok: true,
        is: isSatiri('BITTI'),
        ogeler: [
          oge(1, 'APP01', 'eski', 'OK', { dogrulandi: true, awxJobId: 900 }),
          oge(2, 'APP02', 'a2', 'SKIP', { dogrulandi: true, awxJobId: 901, neden: 'zaten true' }),
        ],
      });
      render(<TopluAutoStartTab />);
      await waitFor(() => expect(m.topluAutoStartDurum).toHaveBeenCalledTimes(1));
      await act(async () => {
        vi.advanceTimersByTime(YOKLAMA_MS);
      });
      await waitFor(() => expect(yay).toHaveBeenCalledTimes(1));
      expect(yay).toHaveBeenCalledWith('APP02', 7, 'a2', {
        tur: 'skip',
        mesaj: 'zaten true',
        deger: 'true',
        jobId: 901,
      });
      await screen.findByText(/Tamamlandı: 1 JVM değişti, 1 zaten hedefteydi/);
      await act(async () => {
        vi.advanceTimersByTime(YOKLAMA_MS * 3);
      });
      expect(yay).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('TT5 sekme kaydı: liste, görünürlük anahtarı, SekmeKabi, seed', () => {
    const kok = path.resolve(__dirname, '..', '..', '..', '..');
    const sh = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'ServerHubPage.tsx'),
      'utf8',
    );
    expect(sh).toMatch(/\{ id: 'topluautostart', label: 'Toplu Auto-Start' \}/);
    expect(sh).toMatch(/canSee\('tab:serverhub:topluautostart'\)/);
    // 2026-11-14: suzgec Toplu Restart sekmesiyle birlikte tek .filter icinde (toplu-restart-tab.test.tsx TRT5).
    expect(sh).toMatch(
      /\.filter\(\s*\(t\) =>\s*\(?t\.id !== 'topluautostart' \|\| topluAutoStartGorur\)?/,
    );
    expect(sh).toMatch(
      /topluAutoStartGorur && acilan\.has\('topluautostart'\) && \(\s*<SekmeKabi id="topluautostart" etkin=\{tab\}>\s*<TopluAutoStartTab \/>/,
    );
    const seed = fs.readFileSync(path.join(kok, 'server', 'db', 'mssql-setup.cjs'), 'utf8');
    expect(seed).toMatch(
      /element_key: 'tab:serverhub:topluautostart',\s*element_type: 'tab',\s*parent_key: 'ServerHub',[\s\S]{0,80}default_visible: 0/,
    );
    const tab = fs.readFileSync(
      path.join(kok, 'src', 'components', 'server_hub', 'TopluAutoStartTab.tsx'),
      'utf8',
    );
    expect(tab).not.toMatch(/Vazge/);
  });

  it('TT6 süre dolunca onay kilitli; plan iptal metni; YARIM_KALDI kırmızı; hiç uygulanmadıysa nötr', async () => {
    const eski = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    m.topluAutoStartListe.mockResolvedValue({
      ok: true,
      aktif: isSatiri('PLAN_HAZIR', { planBitisAt: eski }),
      son: [],
    });
    m.topluAutoStartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('PLAN_HAZIR', { planBitisAt: eski }),
      ogeler: [oge(1, 'APP01', 'a1', 'PLAN_GECTI')],
    });
    const r1 = render(<TopluAutoStartTab />);
    const onay = (await screen.findByRole('button', {
      name: 'Onayla ve uygula (1 JVM)',
    })) as HTMLButtonElement;
    expect(onay.disabled).toBe(true);
    expect(screen.getByText(/Süre doldu — onaylanamaz/)).toBeTruthy();
    r1.unmount();
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: isSatiri('PLANLANIYOR'), son: [] });
    m.topluAutoStartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('PLANLANIYOR'),
      ogeler: [oge(1, 'APP01', 'a1', 'PLANLANIYOR')],
    });
    const r2 = render(<TopluAutoStartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));
    const pencere = await screen.findByRole('dialog');
    expect(pencere.textContent).toMatch(
      /salt okunur plan işi .* bitince iş durur; hiçbir JVM’e dokunulmaz/,
    );
    expect(pencere.textContent).not.toMatch(/Yeni sunucu başlatılmaz/);
    r2.unmount();
    // YARIM_KALDI oge: is BITTI gelse bile ozet yesil degil
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: null, son: [isSatiri('BITTI')] });
    m.topluAutoStartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('BITTI'),
      ogeler: [
        oge(1, 'APP01', 'a1', 'OK', { dogrulandi: true }),
        oge(2, 'APP02', 'a2', 'YARIM_KALDI', { neden: 'AWX e gitmis olabilir' }),
      ],
    });
    const r3 = render(<TopluAutoStartTab />);
    const ozet = await screen.findByText(/^Özet: 1 OK, 0 başarısız, 1 yarım kaldı/);
    expect(ozet.getAttribute('style') || '').toMatch(/status-danger/);
    expect(screen.queryByText(/^Tamamlandı/)).toBeNull();
    r3.unmount();
    // hepsi planda dustu: notr
    m.topluAutoStartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('BITTI'),
      ogeler: [oge(1, 'APP01', 'a1', 'DUSTU', { neden: 'canlı değer zaten true' })],
    });
    render(<TopluAutoStartTab />);
    const notr = await screen.findByText(/^Uygulanan JVM yok: 1 düştü/);
    expect(notr.getAttribute('style') || '').not.toMatch(/status-success/);
  });

  describe('TT7 onay bekleyen iş seyrek yoklanır', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
    afterEach(() => vi.useRealTimers());
    it('PLAN_HAZIR: PLAN_YOKLAMA_MS aralığıyla okunur', async () => {
      const taze = new Date().toISOString();
      m.topluAutoStartListe.mockResolvedValue({
        ok: true,
        aktif: isSatiri('PLAN_HAZIR', { planBitisAt: taze }),
        son: [],
      });
      m.topluAutoStartDurum.mockResolvedValue({
        ok: true,
        is: isSatiri('PLAN_HAZIR', { planBitisAt: taze }),
        ogeler: [oge(1, 'APP01', 'a1', 'PLAN_GECTI')],
      });
      render(<TopluAutoStartTab />);
      await waitFor(() => expect(m.topluAutoStartDurum).toHaveBeenCalledTimes(1));
      await act(async () => {
        vi.advanceTimersByTime(YOKLAMA_MS);
      });
      expect(m.topluAutoStartDurum).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(PLAN_YOKLAMA_MS);
      });
      await waitFor(() => expect(m.topluAutoStartDurum).toHaveBeenCalledTimes(2));
    });
  });

  it('TT8 başarısız öğeler kümelenir: sayım çipleri, satır etiketi, süzme ve "ne yapılır"', async () => {
    const HC =
      "canlı okumada: host controller'a baglanilamadi ya da adi okunamadi (controller gbbfaa01:9990, :read-attribute(name=local-host-name)): Connection refused - HICBIR SEY DEGISMEDI";
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: null, son: [isSatiri('BITTI_HATALI')] });
    m.topluAutoStartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('BITTI_HATALI'),
      ogeler: [
        oge(1, 'APP01', 'a1', 'OK', { dogrulandi: true, neden: 'a1 auto-start=true (host=m, CLI ile dogrulandi)' }),
        oge(2, 'GBBFAA01', 'h1', 'DUSTU', { neden: HC }),
        oge(3, 'GBBFAA01', 'h2', 'DUSTU', { neden: HC }),
        oge(4, 'APP02', 'z1', 'DUSTU', { neden: 'canlı değer zaten true — tarama eski (z1 auto-start zaten true)' }),
      ],
    });
    render(<TopluAutoStartTab />);
    const grup = await screen.findByRole('group', { name: 'Başarısız öğe kategorileri' });
    expect(grup.textContent).toMatch(/Başarısız \/ düşen \/ atlanan 3:/);
    const hc = screen.getByRole('button', { name: 'JBoss domain kapalı 2' });
    expect(screen.getByRole('button', { name: 'Tarama eski / zaten hedefte 1' })).toBeTruthy();
    // sifir kumeler gosterilmez
    expect(screen.queryByRole('button', { name: /^İptal \/ durduruldu/ })).toBeNull();
    const satirSay = () => screen.getByLabelText('Toplu iş #7').querySelectorAll('tbody tr').length;
    expect(satirSay()).toBe(4);
    // satir etiketi yalniz basarisiz ogede
    expect(document.querySelectorAll('[data-kategori="hc_kapali"]').length).toBe(2);
    expect(document.querySelectorAll('[data-kategori]').length).toBe(3);
    expect(screen.queryByTestId('kategori-ne-yapilir')).toBeNull();
    fireEvent.click(hc);
    expect(satirSay()).toBe(2);
    expect(hc.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('kategori-ne-yapilir').textContent).toMatch(
      /JBoss bilerek kapatılmış olabilir; domain açılınca sunucuyu yeniden tarayıp yeniden planlayın/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tümü' }));
    expect(satirSay()).toBe(4);
    expect(screen.queryByTestId('kategori-ne-yapilir')).toBeNull();
  });

  it('TT9 kategori seçimi işe bağlı: başka iş gelince seçim düşer, yeni işte kendiliğinden açılmaz', async () => {
    const HC = "canlı okumada: host controller'a baglanilamadi (controller gbbfaa01:9990) - HICBIR SEY DEGISMEDI";
    const ogeleri = () => [
      oge(1, 'APP01', 'a1', 'OK', { neden: 'a1 auto-start=true' }),
      oge(2, 'GBBFAA01', 'h1', 'DUSTU', { neden: HC }),
    ];
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: null, son: [isSatiri('BITTI_HATALI')] });
    m.topluAutoStartDurum.mockImplementation(async (id: number) => ({ ok: true, is: isSatiri('BITTI_HATALI', { id }), ogeler: ogeleri() }));
    render(<TopluAutoStartTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'JBoss domain kapalı 1' }));
    expect(screen.getByLabelText('Toplu iş #7').querySelectorAll('tbody tr').length).toBe(1);
    // listeyi yenile: en son is artik #8 (ayni kume var) -> secim dusmeli, tum satirlar
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: null, son: [isSatiri('BITTI_HATALI', { id: 8 })] });
    fireEvent.click(screen.getByRole('button', { name: 'Listeyi yenile' }));
    await waitFor(() => expect(screen.getByLabelText('Toplu iş #8').querySelectorAll('tbody tr').length).toBe(2));
    expect(screen.getByRole('button', { name: 'Tümü' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('kategori-ne-yapilir')).toBeNull();
  });

  it('TT10 sonucu belirsiz öğe ayrı sayılır (çalıştırılmayan değil); iş sayısı (sunucu, iş) çiftiyle', async () => {
    // inceleme 2026-11-15 B5: "yarım kaldı" iki ayrı şey
    const BEL = "iş isteği belirsiz hatayla döndü (AWX'e gitmiş olabilir, sonucu belirsiz): socket hang up";
    const CAL =
      "çalıştırılmadı: toplu iş durduruldu — BUYUK01 parçasının iş isteği belirsiz hatayla döndü. Sonucu bilinmeyen iş AWX'te sürüyor olabilir; AWX'ten kontrol edin";
    expect(belirsizMi({ durum: 'YARIM_KALDI', neden: BEL })).toBe(true);
    expect(belirsizMi({ durum: 'FAIL', neden: 'iş #9 3 saatte bitmedi (sonucu belirsiz) — x' })).toBe(true);
    expect(belirsizMi({ durum: 'YARIM_KALDI', neden: "AWX'e gitmiş olabilir — AWX'ten kontrol edin" })).toBe(true);
    expect(belirsizMi({ durum: 'YARIM_KALDI', neden: CAL })).toBe(false);
    expect(belirsizMi({ durum: 'YARIM_KALDI', neden: 'Portal yeniden başladı — çalıştırılmadı' })).toBe(false);
    expect(belirsizMi({ durum: 'OK', neden: BEL })).toBe(false);
    const iki = [
      oge(1, 'A', 'a', 'OK', { awxServerId: 1, awxJobId: 5, planJobId: 9 }),
      oge(2, 'A', 'b', 'OK', { awxServerId: 2, awxJobId: 5, planJobId: 9 }),
    ];
    expect(acilanIsSayisi(iki as never, 'uygulama')).toBe(2);
    expect(acilanIsSayisi(iki as never, 'plan')).toBe(1);
    m.topluAutoStartListe.mockResolvedValue({ ok: true, aktif: null, son: [isSatiri('BITTI_HATALI')] });
    m.topluAutoStartDurum.mockResolvedValue({
      ok: true,
      is: isSatiri('BITTI_HATALI'),
      ogeler: [
        oge(1, 'BUYUK01', 'j0', 'OK', { awxJobId: 21 }),
        oge(2, 'BUYUK01', 'j1', 'YARIM_KALDI', { neden: BEL }),
        oge(3, 'BUYUK01', 'j2', 'YARIM_KALDI', { neden: BEL }),
        oge(4, 'BUYUK01', 'j3', 'YARIM_KALDI', { neden: CAL }),
      ],
    });
    render(<TopluAutoStartTab />);
    expect((await screen.findByTestId('toplu-belirsiz')).textContent).toBe('sonucu belirsiz 2');
    expect(screen.getByTestId('toplu-calistirilmadi').textContent).toBe('yarım kaldı (çalıştırılmadı) 1');
  });
});
