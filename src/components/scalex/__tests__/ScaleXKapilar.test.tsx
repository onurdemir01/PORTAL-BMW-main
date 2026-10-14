// src/components/scalex/__tests__/ScaleXKapilar.test.tsx
//
// ScaleX ONAY KAPILARI — EKRAN DAVRANIŞI (kaynak taraması DEĞİL).
//
// ÜRETİM OLAYI (2026-10-13). Prod'da doğru OCO numarası giren kullanıcı, numarayı
// girdikten SONRA reddedildi; ekran "portal yeniden başlatılıyor" yazdı. Ekranın iki ayrı
// kusuru vardı ve ikisi de yeşil bekçilerin arkasındaydı:
//   * önizleme "SMART kaydı açılacak" diyordu — SMART hiç tanımlı değildi;
//   * SMART kaydı açılsa bile ekran onu "İşlem başlatılmadı — tekrar deneyin" diye
//     gösterecekti (`pendingApproval` dalı, iş numarası kontrolünün ARKASINDAYDI). Bunu
//     kilitleyen bekçi (`U16`) kaynakta "pendingApproval geçiyor mu" diye bakıyordu.
//
// GİRDİLER UYDURMA DEĞİL: `fixtures/kapi-yanitlari.json` sunucunun gerçek `/preview`,
// `/run`, durum ve durum-kartı yanıtlarıdır; sunucu simülatöründen üretilir ve sunucu
// yanıtı değişirse sunucu testi (scalex-kapi-matrisi KM19) kırmızı olur.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, act, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { render as yalinCiz } from '@testing-library/react';
import { SCALEX_FALLBACK_LIMITS } from '@/hooks/useScaleXLimits';
import type { ScaleXPreview, ScaleXStoppedItem, ScaleXGateStatus } from '@/api/scalexApi';

type Kurgu = {
  onizleme: ScaleXPreview;
  calistirma: { status: number; govde: Record<string, unknown> };
};
const ORNEK = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'src/components/scalex/__tests__/fixtures/kapi-yanitlari.json'),
    'utf8',
  ),
) as {
  kurgular: Record<string, Kurgu>;
  bitenIs: { yoklama: Record<string, unknown>; tamCikti: Record<string, unknown> };
  kart: Record<'tanimsiz' | 'hazir' | 'kapali', ScaleXGateStatus>;
};
const K = ORNEK.kurgular;

const api = vi.hoisted(() => ({
  clusters: vi.fn(),
  namespaces: vi.fn(),
  apps: vi.fn(),
  config: vi.fn(),
  stopped: vi.fn(),
  ocoSchedules: vi.fn(),
  preview: vi.fn(),
  run: vi.fn(),
  runStatus: vi.fn(),
  discover: vi.fn(),
  discoverStatus: vi.fn(),
  cancel: vi.fn(),
  gateStatus: vi.fn(),
  setSmartMode: vi.fn(),
}));
vi.mock('@/api/scalexApi', () => ({ scalexApi: api }));

// İş izleyici: sayfa işi ona teslim eder ve sonucu ondan okur. Sahte izleyici, "iş bitti,
// sonuç geldi" anını testin elle kurmasına izin verir.
const izleyici = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  addJob: vi.fn((_g: { title: string; fetchStatus: () => Promise<unknown> }) => 'is-1'),
}));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => izleyici }));

import ScaleXPage from '@/components/scalex/ScaleXPage';
import PreviewStep from '@/components/scalex/steps/PreviewStep';
import OperationStep from '@/components/scalex/steps/OperationStep';
import IslemOnayStep from '@/components/scalex/steps/IslemOnayStep';
import ScaleXKapiDurumu from '@/components/admin/tabs/ScaleXKapiDurumu';
import NamespaceStep from '@/components/scalex/steps/NamespaceStep';
import WorkloadStep from '@/components/scalex/steps/WorkloadStep';

const DURDURULMUS: ScaleXStoppedItem = {
  id: 7,
  env: 'prod',
  tenant: 't1',
  clusterName: 'c1',
  namespace: 'odeme',
  appName: 'api',
  workloadKind: 'Deployment',
  previousReplicas: 3,
  phase: 'scaled_down',
  stoppedBy: 'ayse',
  stoppedAt: '2026-10-13T18:00:00Z',
  lastSeenAt: '2026-10-13T18:00:00Z',
  driftStatus: 'in_sync',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  izleyici.jobs = [];
  api.clusters.mockResolvedValue({ ok: true, tree: {} });
  api.config.mockResolvedValue({ ok: false });
  api.stopped.mockResolvedValue({ ok: true, items: [DURDURULMUS], hiddenCount: 0 });
  api.ocoSchedules.mockResolvedValue({ ok: true, items: [], scope: 'own' });
  api.discover.mockResolvedValue({ ok: false });
  api.runStatus.mockResolvedValue(ORNEK.bitenIs.tamCikti);
});

const SCOPE = { env: 'prod', tenant: 't1', namespace: 'odeme', clusters: ['c1'], apps: ['api'] };
const SATIR = {
  cluster: 'c1',
  name: 'api',
  kind: 'Deployment',
  resource: 'deployments',
  specReplicas: 3,
  statusReplicas: 3,
  readyReplicas: 3,
  hasHpa: false,
  image: null,
  statePhase: 'Running',
  previousReplicas: 3,
  restorable: true,
  gitops: null,
  source: 'discovery' as const,
};

function onizlemeCiz(kurgu: string, ek: Partial<React.ComponentProps<typeof PreviewStep>> = {}) {
  api.preview.mockResolvedValue(K[kurgu].onizleme);
  const onConfirm = vi.fn();
  const sonuc = render(
    <PreviewStep
      scope={SCOPE}
      action="stop"
      executionMode="apply"
      verificationTimeout="300"
      workloads={[SATIR]}
      hpaPin={false}
      allowPartial
      mailCc=""
      fetchedAt={null}
      busy={false}
      onConfirm={onConfirm}
      {...ek}
    />,
  );
  return { ...sonuc, onConfirm };
}

// ══ A. ÖNİZLEME: KAPI SATIRI GERÇEĞİ SÖYLER ═════════════════════════════════
describe('önizleme kapı durumunu sunucunun kararıyla gösterir', () => {
  it('SMART gerekli ama tanımlı değil: engel BAŞTAN söylenir, OCO numarası İSTENMEZ, çalıştırma kapalı', async () => {
    onizlemeCiz('engel_smart_tanimsiz');
    const engel = await screen.findByTestId('scalex-engel');
    // Metin sunucununkiyle AYNI (ekran kendi cümlesini uydurmaz).
    expect(engel).toHaveTextContent(K.engel_smart_tanimsiz.onizleme.gatePolicy.blocked!.message);
    for (const eksik of K.engel_smart_tanimsiz.onizleme.gatePolicy.smartMissing!) {
      expect(within(engel).getByText(eksik)).toBeInTheDocument();
    }
    // Üretimdeki olayın özü: kullanıcı numarayı girdi, SONRA reddedildi.
    expect(screen.queryByLabelText('OCO numarası')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Çalıştır' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Bu işlem şu an başlatılamaz');
    expect(screen.getByTestId('scalex-kapi-rozetleri')).toHaveTextContent('SMART: tanımlı değil');
    // Eski yalan cümle ekranda YOK.
    expect(screen.queryByText('SMART kaydı açılacak ve onay beklenecek.')).not.toBeInTheDocument();
  });

  it('ScaleX şablonu tanımsız: ön kontrol dahil hiçbir iş başlatılamaz ve neden yazılır', async () => {
    // Ön kontrol yanıtı: politika hiçbir kapı istemiyor (OCO yok, SMART yok, yazılı onay yok).
    // Düğmeyi kapatan TEK şey engelin kendisi — başka bir eksik alan onu kapalı tutamaz.
    // (Mutasyon turunda "engelliyken Çalıştır açık" değişikliğini ilk yazımda yalnız bir
    // kaynak bekçisi yakaladı: eski kurguda düğme zaten OCO numarası boş diye kapalıydı.)
    const kurgu = K.sablon_tanimsiz_on_kontrol.onizleme;
    expect([
      kurgu.gatePolicy.oco,
      kurgu.gatePolicy.smart,
      kurgu.blastRadius.requiresWrittenConfirm,
    ]).toEqual(['skip', 'skip', false]);
    onizlemeCiz('sablon_tanimsiz_on_kontrol', { executionMode: 'dry_run' });
    expect(await screen.findByTestId('scalex-engel')).toHaveTextContent(kurgu.configError!.message);
    expect(screen.getByRole('button', { name: 'Kontrolü başlat' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Bu işlem şu an başlatılamaz');
  });

  it.each([
    ['onay_bekliyor', 'SMART kaydı açılacak ve onay beklenecek.', 'SMART: onay beklenecek', false],
    [
      'basladi_smart_kapali',
      'SMART onayı bu ortamda KAPALI (yönetici ayarı)',
      'SMART: kapalı',
      true,
    ],
    [
      'basladi_admin_atladi',
      'Yönetici tercihiniz gereği SMART onayı atlanacak',
      'SMART: atlanıyor',
      true,
    ],
  ])('%s: SMART satırı ve rozeti durumu söyler', async (kurgu, cumle, rozet, denetimNotu) => {
    onizlemeCiz(kurgu);
    expect(await screen.findByText(new RegExp(cumle.replace(/[()]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.getByTestId('scalex-kapi-rozetleri')).toHaveTextContent(rozet);
    expect(screen.getByTestId('scalex-kapi-rozetleri')).toHaveTextContent('OCO: numara istenecek');
    // SMART'sız geçecek prod işlemi kullanıcıya da söylenir.
    expect(!!screen.queryByText(/İşlem denetime ayrıca yazılır/)).toBe(denetimNotu);
    // Bu durumlarda iş BAŞLATILABİLİR: engel kutusu yok, OCO alanı var.
    expect(screen.queryByTestId('scalex-engel')).not.toBeInTheDocument();
    expect(screen.getByLabelText('OCO numarası')).toBeInTheDocument();
    // Numara boşken çalıştırma kapalı; girilince açılır.
    const calistir = screen.getByRole('button', { name: 'Çalıştır' });
    expect(calistir).toBeDisabled();
    fireEvent.change(screen.getByLabelText('OCO numarası'), { target: { value: '1234567' } });
    expect(calistir).toBeEnabled();
  });

  it('istisna kuralı: hangi kuralın eşleştiği yazılır; geri almada gerekçe istenir, OCO istenmez', async () => {
    const { onConfirm } = onizlemeCiz('basladi_istisna_kurali', { action: 'restore' });
    expect(await screen.findByText(/SMART istisna kuralı tanımlı/)).toBeInTheDocument();
    expect(screen.getByText('action: restore')).toBeInTheDocument();
    expect(screen.queryByLabelText('OCO numarası')).not.toBeInTheDocument();
    // SMART devrede değil: gerekçe SMART talebine yazılmaz — metin bunu söylemez.
    expect(screen.queryByText(/SMART talebine yazılır/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Gerekçe (zorunlu)'), { target: { value: 'INC-7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(onConfirm).toHaveBeenCalledWith({ reason: 'INC-7' });
  });

  it('değişiklik yapmayan çalışma ve prod dışı ortam: kapı rozeti/uyarısı yok, tek tıkla başlar', async () => {
    const { unmount } = onizlemeCiz('basladi_on_kontrol', { executionMode: 'dry_run' });
    expect(await screen.findByText('SMART kaydı açılmayacak.')).toBeInTheDocument();
    expect(screen.queryByTestId('scalex-kapi-rozetleri')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kontrolü başlat' })).toBeEnabled();
    unmount();

    onizlemeCiz('basladi_test_ortami', { scope: { ...SCOPE, env: 'test' } });
    expect(await screen.findByText('SMART kaydı açılmayacak.')).toBeInTheDocument();
    expect(screen.getByTestId('scalex-kapi-rozetleri')).toHaveTextContent('OCO: yok');
    expect(screen.getByTestId('scalex-kapi-rozetleri')).toHaveTextContent('SMART: yok');
    expect(screen.queryByText(/denetime ayrıca yazılır/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Çalıştır' })).toBeEnabled();
  });

  it('OCO kapısı admin tarafından kapalı: kırmızı uyarı ve rozet', async () => {
    onizlemeCiz('oco_kapisi_kapali');
    expect(await screen.findByText(/OCO kapısı bu ortamda KAPALI/)).toBeInTheDocument();
    expect(screen.getByTestId('scalex-kapi-rozetleri')).toHaveTextContent('OCO: kapalı');
  });

  it('seçim değişince ESKİ önizlemeyle onay verilemez; yeni önizleme gelince düğme açılır', async () => {
    // İlk seçim: değişiklik yapmayan çalışma (kapı yok, düğme açık).
    api.preview.mockResolvedValue(K.basladi_on_kontrol.onizleme);
    const props = {
      scope: SCOPE,
      action: 'stop' as const,
      verificationTimeout: '300',
      workloads: [SATIR],
      hpaPin: false,
      allowPartial: true,
      mailCc: '',
      fetchedAt: null,
      busy: false,
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<PreviewStep {...props} executionMode="dry_run" />);
    expect(await screen.findByRole('button', { name: 'Kontrolü başlat' })).toBeEnabled();

    // Kullanıcı "Uygula"ya geçti; sunucu henüz yanıtlamadı.
    let coz: (v: ScaleXPreview) => void = () => {};
    api.preview.mockReturnValue(new Promise<ScaleXPreview>((r) => (coz = r)));
    rerender(<PreviewStep {...props} executionMode="apply" />);
    // Ekranda hâlâ ÖNCEKİ seçimin kapıları duruyor ("OCO yok") — onay KAPALI.
    const dugme = screen.getByRole('button', { name: 'Çalıştır' });
    expect(dugme).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Önizleme güncelleniyor');
    expect(props.onConfirm).not.toHaveBeenCalled();

    await act(async () => coz(K.engel_smart_tanimsiz.onizleme));
    expect(await screen.findByTestId('scalex-engel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Çalıştır' })).toBeDisabled();
  });

  it('önceki isteğin hatası yeni seçimin ekranında asılı kalmaz', async () => {
    api.preview.mockRejectedValueOnce(new Error('ağ hatası'));
    const props = {
      scope: SCOPE,
      action: 'stop' as const,
      verificationTimeout: '300',
      workloads: [SATIR],
      hpaPin: false,
      allowPartial: true,
      mailCc: '',
      fetchedAt: null,
      busy: false,
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<PreviewStep {...props} executionMode="dry_run" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('ağ hatası');
    api.preview.mockResolvedValue(K.basladi_on_kontrol.onizleme);
    rerender(<PreviewStep {...props} executionMode="dry_run" reloadKey={1} />);
    expect(await screen.findByRole('button', { name: 'Kontrolü başlat' })).toBeEnabled();
    expect(screen.queryByText('ağ hatası')).not.toBeInTheDocument();
  });

  // SAYILAR SUNUCUDAN (2026-10-14). Kapatmada "şu süre geçilirse başarısız" ekranda `× 2`
  // diye hesaplanıyordu; admin çarpanı değiştirince AWX'e giden eşik başka, ekran başka
  // bir süre söylüyordu. Hedef tavanı ve yazılı onay eşiği ise ekrana hiç gelmiyordu.
  const ayarli = (kurgu: string, ek: { b?: Partial<ScaleXPreview['blastRadius']>; v?: ScaleXPreview['verification'] }) => {
    const o = K[kurgu].onizleme;
    K.__ayarli = {
      ...K[kurgu],
      onizleme: { ...o, blastRadius: { ...o.blastRadius, ...ek.b }, ...(ek.v ? { verification: ek.v } : {}) },
    };
    return '__ayarli';
  };

  it('kapatmada başarısız sayılma süresi sunucunun eşiğidir (admin çarpanı), ekranın `× 2` hesabı değil', async () => {
    // Gerçek yanıt (fabrika çarpanı 2): 300 sn → 10 dk.
    const { unmount } = onizlemeCiz('basladi_smart_kapali');
    expect(await screen.findByTestId('scalex-fail-esigi')).toHaveTextContent('10 dk içinde 0 olmazsa başarısız sayılır');
    unmount();
    // Admin çarpanı 3: sunucu 900 sn diyor; ekran 10 dk DEMEZ.
    onizlemeCiz(ayarli('basladi_smart_kapali', { v: { warnSeconds: 300, failSeconds: 900 } }));
    const esik = await screen.findByTestId('scalex-fail-esigi');
    expect(esik).toHaveTextContent('15 dk içinde 0 olmazsa başarısız sayılır');
    expect(esik).not.toHaveTextContent('10 dk');
  });

  it('başarısız sayılma süresi yalnız kapatmada (hedef 0) söylenir; eski sunucu eşik göndermezse süre uydurulmaz', async () => {
    const { unmount } = onizlemeCiz('basladi_smart_kapali', { action: 'restore' });
    expect(await screen.findByRole('button', { name: 'Çalıştır' })).toBeInTheDocument();
    expect(screen.queryByTestId('scalex-fail-esigi')).not.toBeInTheDocument();
    unmount();
    const ikinci = onizlemeCiz('basladi_smart_kapali', { action: 'scale', targetReplicas: '3' });
    expect(await screen.findByRole('button', { name: 'Çalıştır' })).toBeInTheDocument();
    expect(screen.queryByTestId('scalex-fail-esigi')).not.toBeInTheDocument();
    ikinci.unmount();
    const sifir = onizlemeCiz('basladi_smart_kapali', { action: 'scale', targetReplicas: '0' });
    expect(await screen.findByTestId('scalex-fail-esigi')).toHaveTextContent('10 dk');
    sifir.unmount();
    const { verification: _yok, ...eski } = K.basladi_smart_kapali.onizleme;
    K.__eski = { ...K.basladi_smart_kapali, onizleme: eski as ScaleXPreview };
    onizlemeCiz('__eski');
    expect(await screen.findByRole('button', { name: 'Çalıştır' })).toBeInTheDocument();
    expect(screen.queryByTestId('scalex-fail-esigi')).not.toBeInTheDocument();
  });

  it('hedef tavanı aşılınca sınırın kendisi yazılır (Admin > Sistem değeri)', async () => {
    onizlemeCiz(ayarli('basladi_smart_kapali', { b: { targets: 60, exceedsMaxTargets: true, maxTargets: 40 } }));
    const uyari = await screen.findByText(/tek işlemde izin verilen sınırın/);
    expect(uyari).toHaveTextContent('Bu seçim 60 hedef üretiyor ve tek işlemde izin verilen sınırın (40 hedef) üzerinde.');
    expect(screen.getByRole('button', { name: 'Çalıştır' })).toBeDisabled();
  });

  it('yazılı onay istenirken eşik yazılır (Admin > Sistem değeri)', async () => {
    onizlemeCiz(ayarli('basladi_smart_kapali', { b: { targets: 8, requiresWrittenConfirm: true, writtenConfirmThreshold: 7 } }));
    await screen.findByLabelText(/Onaylamak için namespace adını yaz:/);
    const etiket = document.querySelector('label[for="scalex-written"]');
    expect(etiket).toHaveTextContent("Bu işlem 8 hedefi etkiliyor ve ortam prod (prod'da 7 hedefin üstü yazılı onay ister).");
  });
});

// ══ B. SAYFA: SUNUCUNUN HER YANITINDA DOĞRU EKRAN ═══════════════════════════
//
// Sayfa, "Şu an durdurulmuş" panelindeki "Geri Al" kısayoluyla doğrudan "İşlem ve onay"
// adımına taşınır (gerçek kullanıcı yolu); kapsam ve keşif adımları burada konu değil.
async function onayAdiminaGel(kurgu: string) {
  api.preview.mockResolvedValue(K[kurgu].onizleme);
  api.run.mockResolvedValue(K[kurgu].calistirma.govde);
  const cizim = render(<ScaleXPage />);
  // Panel varsayılan KAPALI ve sayaçlı.
  const baslik = await screen.findByRole('button', { name: /Şu an durdurulmuş/ });
  await waitFor(() =>
    expect(screen.getByTestId('scalex-panel-sayac-durdurulmus')).toHaveTextContent('1'),
  );
  expect(baslik).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(baslik);
  fireEvent.click(await screen.findByRole('button', { name: /Geri Al/ }));
  // Adım şeridi: tek adımda işlem + onay.
  expect(await screen.findByText('İşlem ve onay')).toHaveAttribute('aria-current', 'step');
  return cizim;
}

async function calistir() {
  const oco = screen.queryByLabelText('OCO numarası');
  if (oco) fireEvent.change(oco, { target: { value: '1234567' } });
  const gerekce = screen.queryByLabelText('Gerekçe (zorunlu)');
  if (gerekce) fireEvent.change(gerekce, { target: { value: 'INC-42' } });
  const dugme = await screen.findByRole('button', { name: 'Çalıştır' });
  await waitFor(() => expect(dugme).toBeEnabled());
  await act(async () => {
    fireEvent.click(dugme);
  });
}

describe('sayfa sunucunun her yanıt biçimini doğru ekrana çevirir', () => {
  it('SMART kaydı açıldı: "onay bekleniyor" yazar — "işlem başlatılmadı, tekrar deneyin" DEĞİL', async () => {
    await onayAdiminaGel('onay_bekliyor');
    await screen.findByLabelText('OCO numarası');
    await calistir();
    expect(await screen.findByText(/SMART kaydı açıldı \(SMT-1\)/)).toBeInTheDocument();
    // Eski ekran bu yanıtı böyle okuyordu ve kullanıcı ikinci bir kayıt açıyordu:
    expect(screen.queryByText(/İşlem başlatılmadı/)).not.toBeInTheDocument();
    expect(screen.queryByText('İşlem çalışıyor…')).not.toBeInTheDocument();
    expect(izleyici.addJob).not.toHaveBeenCalled();
    expect(screen.getByText('Sonuç')).toHaveAttribute('aria-current', 'step');
  });

  it('pencere açılmadı + zamanlanabilir: seçim sunulur; "otomatik başlat" AYNI isteği zamanlar', async () => {
    await onayAdiminaGel('ertelendi_zamanlanabilir');
    await screen.findByLabelText('OCO numarası');
    await calistir();
    expect(await screen.findByText(/OCO penceresi henüz açılmadı/)).toBeInTheDocument();
    expect(screen.queryByText('İşlem çalışıyor…')).not.toBeInTheDocument();

    api.run.mockResolvedValue(K.zamanlandi.calistirma.govde);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pencere açılınca otomatik başlat' }));
    });
    expect(api.run).toHaveBeenCalledTimes(2);
    const [ilk, ikinci] = api.run.mock.calls.map((c) => c[0]);
    // Zamanlanan istek, onaylanan istekle AYNI: yalnız `ocoAction` eklenir.
    expect(ikinci).toEqual({ ...ilk, ocoAction: 'schedule' });
    expect(ikinci.ocoNumber).toBe('1234567');
    expect(await screen.findByText(/İşlem zamanlandı/)).toBeInTheDocument();
    // Yeni kayıt görünsün diye panel açılır ve liste yeniden okunur.
    expect(screen.getByRole('button', { name: /Zamanlanmış işlemler/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await waitFor(() => expect(api.ocoSchedules).toHaveBeenCalledTimes(2));
    // Otomatik açılma kullanıcının TERCİHİ değildir: saklanmaz.
    expect(window.localStorage.getItem('scalex.panel.zamanlanan')).toBeNull();
  });

  it('pencere açılmadı + SMART devrede: zamanlama düğmesi YOK, neden yazılır', async () => {
    await onayAdiminaGel('ertelendi_zamanlanamaz');
    await screen.findByLabelText('OCO numarası');
    await calistir();
    expect(await screen.findByText(/OCO penceresi henüz açılmadı/)).toBeInTheDocument();
    expect(screen.getByTestId('scalex-zamanlanamaz')).toHaveTextContent('önceden zamanlanamıyor');
    expect(
      screen.queryByRole('button', { name: 'Pencere açılınca otomatik başlat' }),
    ).not.toBeInTheDocument();
    // Eski metin var olmayan bir davranışı vaat ediyordu.
    expect(screen.queryByText(/SMART gerekiyorsa kayıt o saatte açılır/)).not.toBeInTheDocument();
  });

  it.each([
    ['oco_numarasi_gerekli', /OCO numarası gerekli/],
    ['oco_bulunamadi', /bulunamadı/],
    ['oco_penceresi_gecti', /Yeni bir OCO kaydı girin/],
    ['gerekce_gerekli', /gerekçe zorunlu/i],
    ['awx_yanit_vermiyor', /./],
    ['smart_talebi_acilamadi', /Smart talebi açılamadı/],
  ])('%s: ret mesajı ekranda, kullanıcı işlem adımında kalır', async (kurgu, desen) => {
    await onayAdiminaGel('basladi_smart_kapali');
    await screen.findByLabelText('OCO numarası');
    api.run.mockResolvedValue(K[kurgu].calistirma.govde);
    await calistir();
    const uyari = await screen.findByRole('alert');
    expect(uyari).toHaveTextContent(desen);
    expect(uyari).toHaveTextContent(String(K[kurgu].calistirma.govde.message));
    expect(screen.getByText('İşlem ve onay')).toHaveAttribute('aria-current', 'step');
    expect(izleyici.addJob).not.toHaveBeenCalled();
  });

  it('önizlemeden SONRA SMART kapandıysa: ret gelir, önizleme TAZELENİR ve engel görünür', async () => {
    await onayAdiminaGel('basladi_smart_kapali');
    await screen.findByLabelText('OCO numarası');
    const onceki = api.preview.mock.calls.length;
    // Admin o arada anahtarı "gerekli"ye çevirdi: çalıştırma 409, yeni önizleme engelli.
    api.run.mockResolvedValue(K.engel_smart_tanimsiz.calistirma.govde);
    api.preview.mockResolvedValue(K.engel_smart_tanimsiz.onizleme);
    await calistir();
    expect(await screen.findByTestId('scalex-engel')).toBeInTheDocument();
    expect(api.preview.mock.calls.length).toBeGreaterThan(onceki);
    expect(screen.queryByLabelText('OCO numarası')).not.toBeInTheDocument();
    expect(screen.getByText('İşlem ve onay')).toHaveAttribute('aria-current', 'step');
  });

  it('iş başladı ve bitti: sonuç izleyiciden HEMEN gelir; tam çıktı tek bir ayrı istekle', async () => {
    const { rerender } = await onayAdiminaGel('basladi_smart_kapali');
    await screen.findByLabelText('OCO numarası');
    await calistir();
    expect(await screen.findByText('İşlem çalışıyor…')).toBeInTheDocument();
    expect(izleyici.addJob).toHaveBeenCalledTimes(1);
    expect(api.runStatus).not.toHaveBeenCalled();

    // İzleyicinin yoklaması VARSAYILAN ucu kullanır (artımlı çıktı).
    await izleyici.addJob.mock.calls[0][0].fetchStatus();
    expect(api.runStatus).toHaveBeenLastCalledWith(1, 9001);

    // Tam çıktı isteği YANITLAMIYOR olsa da sonuç görünür: sonuç onu beklemez.
    api.runStatus.mockClear();
    let tamCoz: (v: unknown) => void = () => {};
    api.runStatus.mockReturnValue(new Promise((r) => (tamCoz = r)));
    const y = ORNEK.bitenIs.yoklama;
    izleyici.jobs = [
      {
        id: 'is-1',
        title: 'ScaleX',
        status: y.status,
        output: y.output,
        result: y.result,
        done: true,
        pollErr: '',
        startedAt: Date.now() - 4000,
      },
    ];
    rerender(<ScaleXPage />);
    expect(await screen.findByText(/1 başarılı · 0 uyarı · 0 başarısız/)).toBeInTheDocument();
    // Tam çıktı: BİR kez, `tamCikti` ile (sonuç için ikinci bir istek YOK).
    await waitFor(() => expect(api.runStatus).toHaveBeenCalledTimes(1));
    expect(api.runStatus).toHaveBeenCalledWith(1, 9001, { tamCikti: true });
    await act(async () => tamCoz({ ...ORNEK.bitenIs.tamCikti, output: 'TAM METIN\nPLAY RECAP' }));
    expect(await screen.findByText(/TAM METIN/)).toBeInTheDocument();
    expect(api.runStatus).toHaveBeenCalledTimes(1);
  });
});

// ══ C. ALT PANELLER: KATLANIR, SAYAÇLI ══════════════════════════════════════
describe('alt paneller katlanır ve sayaçlıdır', () => {
  it('"Durumu tazele" namespace tavanı sunucunun /config değeridir (Admin > Sistem), sabit 60 değil', async () => {
    api.config.mockResolvedValue({
      ok: true,
      prodSmartMode: 'required',
      verificationTimeout: { default: 300, min: 30, max: 3600, failMultiplier: 2 },
      maxTargets: 200,
      prodConfirmThreshold: 5,
      maxAuditGroups: 12,
      maxAuditNamespaces: 2,
      problems: [],
    });
    api.stopped.mockResolvedValue({
      ok: true,
      hiddenCount: 0,
      items: ['ns-a', 'ns-b', 'ns-c'].map((ns, i) => ({ ...DURDURULMUS, id: 100 + i, namespace: ns, appName: `app-${i}` })),
    });
    render(<ScaleXPage />);
    await waitFor(() => expect(api.config).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Şu an durdurulmuş/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Durumu tazele/ }));
    expect(await screen.findByText(/Bu listede 3 namespace var \(sınır 2\)/)).toBeInTheDocument();
    expect(api.discover).not.toHaveBeenCalled();
  });

  it('varsayılan kapalı; sayaç panelin yüklemesinden gelir; açma tercihi saklanır', async () => {
    api.ocoSchedules.mockResolvedValue({
      ok: true,
      scope: 'own',
      items: [
        {
          id: 1,
          status: 'SCHEDULED',
          ocoNumber: '111',
          username: 'ayse',
          runAt: '2026-10-14T20:00:00Z',
        },
        {
          id: 2,
          status: 'CANCELLED',
          ocoNumber: '222',
          username: 'ayse',
          runAt: '2026-10-12T20:00:00Z',
        },
      ],
    });
    const { unmount } = render(<ScaleXPage />);
    // Sayaç BEKLEYEN kayıtları sayar (iptal edilmiş kayıt "bekleyen" değildir).
    await waitFor(() =>
      expect(screen.getByTestId('scalex-panel-sayac-zamanlanan')).toHaveTextContent('1 bekliyor'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('scalex-panel-sayac-durdurulmus')).toHaveTextContent('1'),
    );
    const zam = screen.getByRole('button', { name: /Zamanlanmış işlemler/ });
    expect(zam).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('scalex-panel-zamanlanan')).toHaveAttribute('inert');

    fireEvent.click(zam);
    expect(zam).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('scalex-panel-zamanlanan')).not.toHaveAttribute('inert');
    expect(window.localStorage.getItem('scalex.panel.zamanlanan')).toBe('1');
    unmount();

    // Sonraki ziyaret: tercih hatırlanır.
    render(<ScaleXPage />);
    expect(await screen.findByRole('button', { name: /Zamanlanmış işlemler/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /Şu an durdurulmuş/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('liste okunamadıysa sayaç SIFIR yazmaz', async () => {
    api.stopped.mockResolvedValue({ ok: false, message: 'sunucu hatası' });
    api.ocoSchedules.mockRejectedValue(new Error('ağ'));
    render(<ScaleXPage />);
    await waitFor(() => expect(api.stopped).toHaveBeenCalled());
    await waitFor(() => expect(api.ocoSchedules).toHaveBeenCalled());
    expect(screen.getByTestId('scalex-panel-sayac-durdurulmus')).toHaveTextContent('…');
    expect(screen.getByTestId('scalex-panel-sayac-zamanlanan')).toHaveTextContent('…');
    expect(screen.getByTestId('scalex-panel-sayac-durdurulmus')).not.toHaveTextContent('0');
  });

  // 2026-10-14 ÜRETİM OLAYI: sunucu Admin'e listeyi `{ items, total }` NESNESİ olarak
  // gönderiyordu; panel `items.map` ile çöktü ve ScaleX ekranının TAMAMI düştü
  // ("l.map is not a function"). Beklenmeyen biçim "okunamadı"dır, çökme ya da "yok" değil.
  it('liste dizi değilse sayfa çökmez; panel "okunamadı" der, sayaç sıfır yazmaz', async () => {
    api.ocoSchedules.mockResolvedValue({
      ok: true,
      scope: 'all',
      items: {
        items: [{ id: 1, status: 'SCHEDULED', ocoNumber: '111', username: 'ayse', runAt: '2026-10-14T20:00:00Z' }],
        total: 1,
      },
    });
    render(<ScaleXPage />);
    await waitFor(() => expect(api.ocoSchedules).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('scalex-panel-sayac-zamanlanan')).toHaveTextContent('…'),
    );
    expect(screen.getByTestId('scalex-panel-sayac-zamanlanan')).not.toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: /Zamanlanmış işlemler/ }));
    expect(
      await screen.findByText(/Zamanlanmış işlemler okunamadı: sunucu beklenmeyen biçimde/),
    ).toBeInTheDocument();
    // Sihirbaz ayakta: ilk adım hâlâ çizili.
    expect(screen.getByRole('button', { name: /Zamanlanmış işlemler/ })).toBeInTheDocument();
  });

  it('zamanlanan kaydın NE olduğu görünür: işlem adı, cluster, namespace, uygulamalar', async () => {
    api.ocoSchedules.mockResolvedValue({
      ok: true,
      scope: 'mine+groups',
      items: [
        {
          id: 7,
          status: 'SCHEDULED',
          ocoNumber: '1234567',
          username: 'ayse',
          runAt: '2026-10-14T20:00:00Z',
          // Sunucunun ürettiği biçim (server/scalex/index.cjs `zamanlamaGorunumu`).
          kapsam: {
            env: 'prod',
            tenant: 't1',
            clusters: ['c1', 'c2'],
            namespace: 'odeme',
            apps: ['api', 'worker'],
            action: 'scale',
            executionMode: 'apply',
            targetReplicas: 3,
          },
        },
      ],
    });
    render(<ScaleXPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Zamanlanmış işlemler/ }));
    const satir = await screen.findByTestId('scalex-zamanlama-kapsam');
    expect(satir).toHaveTextContent('Ölçekle → 3 replica');
    expect(satir).toHaveTextContent('c1, c2 / odeme · 2 uygulama · t1/prod');
    expect(satir).toHaveTextContent('api, worker');
  });

  it('bir panel çizilirken patlarsa yalnız o panel hata der; sihirbaz ve öbür panel ayakta', async () => {
    // Dizi ama öğesi `null`: render sırasında `it.status` patlar (biçim denetimini geçen
    // ama bozuk bir kayıt). Sınır olmasaydı sayfanın tamamı düşerdi.
    api.ocoSchedules.mockResolvedValue({ ok: true, scope: 'all', items: [null] });
    const hatalar = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ScaleXPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Zamanlanmış işlemler/ }));
    expect(await screen.findByText(/Bu panel çizilemedi/)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Adımlar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Şu an durdurulmuş/ })).toBeInTheDocument();
    expect(hatalar.mock.calls.some((c) => String(c[0]).includes('paneli çizilemedi'))).toBe(true);
    hatalar.mockRestore();
  });
});

// ══ D. İŞLEM ADIMI: GÖMÜLÜ KİP ══════════════════════════════════════════════
describe('işlem seçimi ile önizleme tek adımda', () => {
  const ortak = { apps: ['api'], workloads: [SATIR], clusterCount: 2, busy: false };

  it('gömülü kipte "Önizle" düğmesi yok; seçim tamamlanınca bildirilir, eksilince geri alınır', async () => {
    const onChange = vi.fn();
    render(<OperationStep {...ortak} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'Önizle' })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: /^Ölçekle/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Uygula/ }));
    // Ölçeklemede hedef sayı girilene kadar seçim EKSİK.
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(screen.getByLabelText('Hedef replica sayısı'), { target: { value: '4' } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        action: 'scale',
        executionMode: 'apply',
        targetReplicas: '4',
        verificationTimeout: '300',
        allowPartial: true,
        mailCc: '',
        hpaPin: false,
      }),
    );
    fireEvent.change(screen.getByLabelText('Hedef replica sayısı'), { target: { value: '0' } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(null));
  });

  it('bekleme süresi ADMIN varsayılanını izler: sınırlar adım açıldıktan sonra gelse de (2026-10-14)', async () => {
    // Eskiden ilk render'daki değer donuyordu: `/config` geç gelirse iş fabrika değeri (300)
    // ile çalışırdı, admin'in varsayılanıyla değil.
    const onChange = vi.fn();
    const fabrika = { ...SCALEX_FALLBACK_LIMITS };
    const admin = { ...SCALEX_FALLBACK_LIMITS, timeoutDefault: '600', timeoutMax: 3600 };
    const { rerender } = render(<OperationStep {...ortak} limits={fabrika} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^Durdur/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Uygula/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ verificationTimeout: '300' })),
    );
    rerender(<OperationStep {...ortak} limits={admin} onChange={onChange} />);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ verificationTimeout: '600' })),
    );
  });

  it('kullanıcının yazdığı bekleme süresi admin varsayılanı değişse de KORUNUR', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<OperationStep {...ortak} limits={SCALEX_FALLBACK_LIMITS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^Durdur/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Uygula/ }));
    fireEvent.click(screen.getByRole('button', { name: /Gelişmiş/ }));
    fireEvent.change(screen.getByLabelText(/Sonucu ne kadar bekleyelim/), { target: { value: '120' } });
    rerender(
      <OperationStep {...ortak} limits={{ ...SCALEX_FALLBACK_LIMITS, timeoutDefault: '600' }} onChange={onChange} />,
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ verificationTimeout: '120' })),
    );
  });

  // KAPATMA EŞİĞİ ADMIN ÇARPANINDAN (2026-10-14). Eskiden `× 2` sabitti.
  const yardim = () => document.getElementById('scalex-timeout-help')?.textContent ?? '';
  it('kapatmada başarısız sayılma süresi admin çarpanıyla hesaplanır', () => {
    const { rerender } = render(<OperationStep {...ortak} limits={SCALEX_FALLBACK_LIMITS} onChange={vi.fn()} />);
    expect(yardim()).toContain('10 dk geçilirse başarısız sayılır');
    rerender(<OperationStep {...ortak} limits={{ ...SCALEX_FALLBACK_LIMITS, failMultiplier: 3 }} onChange={vi.fn()} />);
    expect(yardim()).toContain('15 dk geçilirse başarısız sayılır');
    expect(yardim()).not.toContain('10 dk');
  });

  it('çarpan 1 ise "uyar ama bekle" denmez; ayar okunamadıysa süre vaat edilmez', () => {
    const { rerender } = render(
      <OperationStep {...ortak} limits={{ ...SCALEX_FALLBACK_LIMITS, failMultiplier: 1 }} onChange={vi.fn()} />,
    );
    expect(yardim()).toContain('Kapatırken bu süre içinde 0 olmazsa başarısız sayılır.');
    expect(yardim()).not.toContain('0 olana kadar beklenir');
    rerender(<OperationStep {...ortak} limits={{ ...SCALEX_FALLBACK_LIMITS, stale: true }} onChange={vi.fn()} />);
    expect(yardim()).toContain('şu an okunamadı');
    expect(yardim()).not.toMatch(/dk geçilirse/);
  });

  it('nadir ayarlar "Gelişmiş" altında: kapalı başlar, değiştirilen ayar kapalıyken de söylenir', async () => {
    render(<OperationStep {...ortak} onChange={vi.fn()} />);
    const gelismis = screen.getByRole('button', { name: /Gelişmiş/ });
    expect(gelismis).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('scalex-gelismis')).toHaveAttribute('inert');

    fireEvent.click(gelismis);
    expect(document.getElementById('scalex-gelismis')).not.toHaveAttribute('inert');
    fireEvent.change(screen.getByLabelText(/Sonucu ne kadar bekleyelim/), {
      target: { value: '600' },
    });
    fireEvent.click(screen.getByLabelText(/Bir hedef başarısız olursa diğerlerine devam et/));
    fireEvent.click(gelismis);
    // Kapalıyken sessiz ayar yok.
    expect(gelismis).toHaveTextContent('bekleme 10 dk');
    expect(gelismis).toHaveTextContent('hepsi ya da hiçbiri');

    // Geçersiz değer gizli KALAMAZ: bölüm kendiliğinden açık çizilir.
    fireEvent.click(gelismis);
    fireEvent.change(screen.getByLabelText(/Sonucu ne kadar bekleyelim/), {
      target: { value: '5' },
    });
    fireEvent.click(gelismis);
    expect(gelismis).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/arası bir saniye değeri girin/)).toBeInTheDocument();
  });

  it('ayrı adım kipinde (gömülü değil) davranış aynı: "Önizle" düğmesi ve açık ayarlar', () => {
    const onSubmit = vi.fn();
    render(<OperationStep {...ortak} onSubmit={onSubmit} />);
    expect(screen.queryByRole('button', { name: /Gelişmiş/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Sonucu ne kadar bekleyelim/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Durdur/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Önce kontrol et/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stop', executionMode: 'dry_run' }),
    );
  });

  it('seçim tamamlanınca önizleme KENDİLİĞİNDEN gelir; onay GÖSTERİLEN seçimi taşır', async () => {
    api.preview.mockResolvedValue(K.basladi_on_kontrol.onizleme);
    const onConfirm = vi.fn();
    const onSecim = vi.fn();
    render(
      <IslemOnayStep
        scope={SCOPE}
        workloads={[SATIR]}
        clusterCount={1}
        busy={false}
        fetchedAt={null}
        onSecim={onSecim}
        onConfirm={onConfirm}
      />,
    );
    // Nötr başlangıç: hiçbir şey seçili değil, önizleme istenmedi.
    expect(screen.getByTestId('scalex-onizleme-bekliyor')).toBeInTheDocument();
    expect(api.preview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Durdur/ }));
    expect(api.preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Önce kontrol et/ }));
    const dugme = await screen.findByRole('button', { name: 'Kontrolü başlat' });
    expect(api.preview).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stop', executionMode: 'dry_run' }),
    );
    expect(onSecim).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'stop', executionMode: 'dry_run' }),
    );

    // Kipi değiştir: yeni önizleme istenir; gelene kadar onay kapalıdır.
    api.preview.mockResolvedValue(K.basladi_smart_kapali.onizleme);
    fireEvent.click(screen.getByRole('button', { name: /^Uygula/ }));
    expect(dugme).toBeDisabled();
    const oco = await screen.findByLabelText('OCO numarası');
    expect(api.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'stop', executionMode: 'apply' }),
    );
    fireEvent.change(oco, { target: { value: '7654321' } });
    const calistirDugmesi = screen.getByRole('button', { name: 'Çalıştır' });
    await waitFor(() => expect(calistirDugmesi).toBeEnabled());
    fireEvent.click(calistirDugmesi);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stop', executionMode: 'apply' }),
      { ocoNumber: '7654321' },
    );
  });
});

// ══ E. ADMIN DURUM KARTI ════════════════════════════════════════════════════
// "Gerekli" düğmesi ("Gerekli değil — yalnız OCO" DEĞİL).
const GEREKLI = /^Gerekli(?! değil)/;
describe('admin durum kartı', () => {
  it('SMART tanımlı değil: kullanıcıların durumu ve eksikler yazılır; anahtar TEK tıkla değişir', async () => {
    api.gateStatus.mockResolvedValue(ORNEK.kart.tanimsiz);
    api.setSmartMode.mockResolvedValue({ ok: true, smartMode: 'oco_only' });
    const onOrnekBaglam = vi.fn();
    render(<ScaleXKapiDurumu onOrnekBaglam={onOrnekBaglam} />);

    const durum = await screen.findByTestId('scalex-kullanici-karari');
    expect(durum).toHaveTextContent('Prod değişiklikleri BAŞLAMIYOR');
    expect(screen.getByText(/Flow Key — eksik/)).toBeInTheDocument();
    expect(screen.getByText(/Alan eşlemesi \(metadata\) — eksik/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: GEREKLI })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/hiç ayarlanmamış: varsayılan/)).toBeInTheDocument();
    // Ayar penceresi için şablon değişkenleri üst bileşene verilir.
    expect(onOrnekBaglam).toHaveBeenCalledWith(ORNEK.kart.tanimsiz.ornekBaglam);

    api.gateStatus.mockResolvedValue(ORNEK.kart.kapali);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Gerekli değil — yalnız OCO/ }));
    });
    expect(api.setSmartMode).toHaveBeenCalledTimes(1);
    expect(api.setSmartMode).toHaveBeenCalledWith('oco_only');
    // Kart yeni durumu SUNUCUDAN okur (iyimser güncelleme yok).
    await waitFor(() =>
      expect(screen.getByTestId('scalex-kullanici-karari')).toHaveTextContent(
        'SMART onayı OLMADAN başlar',
      ),
    );
    expect(screen.getByRole('button', { name: /Gerekli değil — yalnız OCO/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Seçili kipe tekrar tıklamak istek ATMAZ.
    fireEvent.click(screen.getByRole('button', { name: /Gerekli değil — yalnız OCO/ }));
    expect(api.setSmartMode).toHaveBeenCalledTimes(1);
  });

  it("SMART hazır: SMART'a gidecek alanlar, istisna kuralı ve okunamayan kural satırı görünür", async () => {
    api.gateStatus.mockResolvedValue(ORNEK.kart.hazir);
    render(<ScaleXKapiDurumu />);
    expect(await screen.findByTestId('scalex-kullanici-karari')).toHaveTextContent(
      'SMART kaydı açılır ve onay beklenir',
    );
    for (const [k, v] of Object.entries(ORNEK.kart.hazir.smart.onizleme!)) {
      expect(screen.getByText(k)).toBeInTheDocument();
      expect(screen.getByText(v)).toBeInTheDocument();
    }
    expect(screen.getByText('action: restore')).toBeInTheDocument();
    expect(screen.getByText('bozuk satir')).toBeInTheDocument();
    expect(screen.queryByText(/— eksik/)).not.toBeInTheDocument();
  });

  it('kayıt reddedilirse hata yazılır ve kart ESKİ durumda kalır; durum okunamazsa "eksik" DENMEZ', async () => {
    api.gateStatus.mockResolvedValue(ORNEK.kart.tanimsiz);
    api.setSmartMode.mockResolvedValue({
      ok: false,
      message: 'Bu ayar yalnizca yoneticilere acik.',
    });
    const { unmount } = render(<ScaleXKapiDurumu />);
    await screen.findByTestId('scalex-kullanici-karari');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Gerekli değil — yalnız OCO/ }));
    });
    expect(await screen.findByText('Bu ayar yalnizca yoneticilere acik.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: GEREKLI })).toHaveAttribute('aria-pressed', 'true');
    expect(api.gateStatus).toHaveBeenCalledTimes(1);
    unmount();

    api.gateStatus.mockResolvedValue({ ok: false, message: 'yetki yok' });
    render(<ScaleXKapiDurumu />);
    expect(await screen.findByText('Onay kapılarının durumu okunamadı')).toBeInTheDocument();
    expect(screen.queryByText(/— eksik/)).not.toBeInTheDocument();
    expect(screen.queryByText(/BAŞLAMIYOR/)).not.toBeInTheDocument();
  });
});

// ══ F. GELİŞTİRME KİPİ (React.StrictMode) ═══════════════════════════════════
//
// Gerçek tarayıcı taraması (scripts/ui-tarama/scalex-akis.mjs) buldu: `npm run dev`de
// sihirbaz Namespace adımında sonsuza dek "yükleniyor" gösteriyordu. StrictMode efektleri
// bağla → sök → bağla diye iki kez koşturur; adımlar "söküldüm" işaretini temizlikte
// `false` yapıp ikinci bağlamada geri AÇMIYORDU ve gelen yanıtı hiç işlemiyordu. jsdom
// testleri StrictMode'suz koştuğu için bunu görmüyordu; bu testler bilerek onunla sarar.
//
// YALIN `render` ŞART: ortak test sarmalayıcısıyla (`@/test/test-utils`) çift bağlama
// OLUŞMUYOR ve bu testlerin ilk hâli düzeltme geri alındığında da yeşil kalıyordu (kör
// bekçi). Çift bağlamanın gerçekten yaşandığı ayrıca ölçülür: liste İKİ kez istenir.
describe('geliştirme kipinde (StrictMode) adımlar yanıtı işler', () => {
  it('Namespace adımı listeyi gösterir', async () => {
    api.namespaces.mockResolvedValue({
      ok: true,
      items: ['odeme', 'kredi'],
      counts: {},
      sources: {},
      clusters: {},
      cached: true,
      fetchedAt: '2026-10-14T08:00:00Z',
      stale: false,
      source: 'inventory',
      hiddenCount: 0,
      unreadable: [],
    });
    yalinCiz(
      <React.StrictMode>
        <NamespaceStep
          env="prod"
          tenant="t1"
          clusters={['c1']}
          busy={false}
          initial=""
          onSubmit={vi.fn()}
        />
      </React.StrictMode>,
    );
    expect(await screen.findByText('odeme')).toBeInTheDocument();
    expect(screen.queryByText(/Namespace listesi yükleniyor/)).not.toBeInTheDocument();
    // Kurgu gerçekten çift bağlamayı üretti mi? (Üretmediyse bu test hiçbir şey ölçmez.)
    expect(api.namespaces).toHaveBeenCalledTimes(2);
  });

  it('Uygulamalar adımı kataloğu gösterir', async () => {
    api.apps.mockResolvedValue({
      ok: true,
      items: [{ name: 'api', kind: 'Deployment' }],
      clusters: {},
      sources: {},
      cached: true,
      fetchedAt: '2026-10-14T08:00:00Z',
      stale: false,
      scannedAt: '2026-10-14T08:00:00Z',
    });
    yalinCiz(
      <React.StrictMode>
        <WorkloadStep
          scope={{ env: 'prod', tenant: 't1', namespace: 'odeme', clusters: ['c1'] }}
          busy={false}
          initial={[]}
          initialWorkloads={[]}
          initialFetchedAt={null}
          autoScanMemo={new Map()}
          onBack={vi.fn()}
          onSubmit={vi.fn()}
        />
      </React.StrictMode>,
    );
    expect(await screen.findByText('api')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kontrol et' })).toBeInTheDocument();
    expect(api.apps).toHaveBeenCalledTimes(2);
  });
});
