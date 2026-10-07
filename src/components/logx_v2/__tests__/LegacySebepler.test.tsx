// src/components/logx_v2/__tests__/LegacySebepler.test.tsx
//
// LogX LEGACY: "NEDEN OLMADI" VE "ARŞİV EKSİK" EKRANDA (2026-10-07).
//
// Playbook'lar sunucu ve dosya başına sebep yayınlıyor ama ekran bunları yalnızca kısmi
// keşifte gösteriyordu:
//   - keşif tüm sunucularda düşünce  -> yalnızca "Tüm sunucularda keşif başarısız oldu."
//   - aktarım düşünce               -> yalnızca "Transfer başarısız oldu."
//   - aktarım KISMİ bitince         -> hiçbir şey; eksik arşiv "Log dosyanız hazır" diye sunuluyordu
//
// GİRDİLER UYDURMA DEĞİL: `fixtures/legacy-sonuc-ornekleri.json` gerçek playbook çıktısıdır
// ve `server/ansible/__tests__/logx-legacy-gercek-kosum.test.cjs` (LG5) her örneği gerçek
// Ansible koşumuyla karşılaştırır. Playbook biçimi değişirse önce o test kızarır.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/test-utils';
import {
  aktarimSorunlari,
  kesifSorunlari,
  sorunVar,
  eksikOzeti,
  type LegacySorunlar as Sorunlar,
} from '@/components/logx_v2/shared/legacySonuc';
import { legacySebep } from '@/utils/legacySebep';
import LegacySorunlar from '@/components/logx_v2/shared/LegacySorunlar';
import FailedStep from '@/components/logx_v2/shared/FailedStep';
import DownloadStep from '@/components/logx_v2/shared/DownloadStep';
import LogXWizardPage from '@/components/logx_v2/LogXWizardPage';

const m = vi.hoisted(() => ({
  getRequest: vi.fn(),
  jobOutput: vi.fn(),
  resources: vi.fn(),
  playbookReadiness: vi.fn(),
}));
vi.mock('@/api/logxV2Api', () => ({
  logxV2Api: {
    getRequest: m.getRequest,
    jobOutput: m.jobOutput,
    playbookReadiness: m.playbookReadiness,
    downloadUrl: (t: string) => `/indir/${t}`,
    manage: { resources: m.resources },
  },
}));

type Ornek = { ne: string; is_basarili: boolean; sonuc: Record<string, unknown> };
const ORNEKLER = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'src/components/logx_v2/__tests__/fixtures/legacy-sonuc-ornekleri.json'),
    'utf8',
  ),
) as Record<string, Ornek>;
const ornek = (ad: string) => {
  const o = ORNEKLER[ad];
  if (!o) throw new Error(`ornek yok: ${ad}`);
  return o.sonuc;
};

// Gerçek koşumdan alınmış ama makineye bağlı (SSH sürümü, port) olduğu için örnek dosyasına
// konmayan metinler.
const SSH_DOSYA =
  'Dosya was ile denetlenemedi: Task failed: Failed to connect to the host via ssh: ssh: connect to host 127.0.0.1 port 1: Connection refused';
const SSH_KESIF =
  "Önce app'a ait EAR klasörlerini bul (daraltılmış keşif): Task failed: Failed to connect to the host via ssh: ssh: connect to host 127.0.0.1 port 1: Connection refused (kosan: was)";

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.resources.mockResolvedValue({ ok: true, isAdmin: true, resources: [] });
  m.playbookReadiness.mockResolvedValue({ ok: true, rows: [] });
});

describe('legacySonuc: gerçek playbook çıktılarından özet', () => {
  it('LS1 tek sunucu KISMİ: arşive girmeyen iki dosya sebepleriyle; sayılar doğru', () => {
    const s = aktarimSorunlari(ornek('aktarim_tek_kismi'));
    expect(s.sunucular).toEqual([]);
    expect(s.dosyalar).toEqual([
      { host: 'localhost', path: '/vhosting8/APPX-T.ear/log9/yok.log', sebep: 'Dosya bulunamadi' },
      {
        host: 'localhost',
        path: '/vhosting8/APPX-T.ear/log2/server.log',
        sebep: 'Dosya okunamiyor',
      },
    ]);
    expect([s.istenen, s.alinan]).toEqual([3, 1]);
    expect(sorunVar(s)).toBe(true);
    expect(eksikOzeti(s)).toBe('Arşiv eksik — seçilen dosya: 3, arşive giren: 1, alınamayan: 2.');
  });

  it('LS2 tek sunucu BAŞARISIZ: dosya dökümü yok, sebep sunucu satırında', () => {
    const s = aktarimSorunlari(ornek('aktarim_tek_basarisiz'));
    expect(s.sunucular).toHaveLength(1);
    expect(s.sunucular[0]).toMatchObject({ host: 'localhost', durum: 'error', dosyaSayisi: 0 });
    expect(s.sunucular[0].sebep).toMatch(/Dosya basina sebep: \['Dosya bulunamadi'\]/);
    expect([s.istenen, s.alinan]).toEqual([null, null]);
    expect(eksikOzeti(s)).toBe('Arşiv eksik: bazı sunucu ya da dosyalar alınamadı.');
  });

  it('LS3 çok sunucu KISMİ: düşen sunucu tek satır, dosyaları ayrıca sayılmaz', () => {
    const s = aktarimSorunlari(ornek('aktarim_cok_kismi'));
    expect(s.sunucular.map((h) => [h.host, h.durum, h.dosyaSayisi])).toEqual([
      ['SUNUCU-B', 'error', 1],
    ]);
    expect(s.dosyalar).toEqual([]);
    expect([s.istenen, s.alinan]).toEqual([2, 1]);
  });

  it('LS4 çok sunucu BAŞARISIZ: genel sebep + her sunucu', () => {
    const s = aktarimSorunlari(ornek('aktarim_cok_basarisiz'));
    expect(s.genel).toMatch(/hicbir kaynak hosttan parca ZIP gelmedi/);
    expect(s.sunucular.map((h) => h.host)).toEqual(['SUNUCU-A', 'SUNUCU-B']);
    expect([s.istenen, s.alinan]).toEqual([2, 0]);
  });

  it('LS5 sunucusu başarılı ama dosyası düşen çok-sunucu sonucu: dosya SUNUCU ADIYLA listelenir', () => {
    const sonuc = structuredClone(ornek('aktarim_cok_kismi')) as {
      hosts: { per_file_status: Record<string, string>[] }[];
    };
    sonuc.hosts[0].per_file_status.push({
      host: 'sunucu-a',
      path: '/vhosting8/APPX-T.ear/log2/gitti.log',
      status: 'error',
      error: 'Dosya bulunamadi',
    });
    const s = aktarimSorunlari(sonuc);
    expect(s.dosyalar).toEqual([
      { host: 'SUNUCU-A', path: '/vhosting8/APPX-T.ear/log2/gitti.log', sebep: 'Dosya bulunamadi' },
    ]);
    expect([s.istenen, s.alinan]).toEqual([3, 1]);
  });

  it('LS6 keşif: erişilemeyen ve hata veren sunucular durumlarıyla', () => {
    expect(kesifSorunlari(ornek('kesif_envanterde_yok')).sunucular).toEqual([
      {
        host: 'OLMAYAN-SUNUCU',
        durum: 'unreachable',
        sebep: 'sonuc bildirmedi (AWX envanterinde eslesmedi)',
        dosyaSayisi: 0,
      },
    ]);
    const s = kesifSorunlari(ornek('kesif_okunamayan'));
    expect(s.sunucular[0]).toMatchObject({ host: 'LOCALHOST', durum: 'error' });
    expect(s.sunucular[0].sebep).toMatch(/okunamayan 1 yol: \/vhosting8\/APPX-T\.ear\/log1/);
  });

  it('LS7 sorunsuz ya da bozuk sonuç: sorun UYDURULMAZ', () => {
    const tam = {
      overall_status: 'success',
      error: '',
      per_file_status: [{ host: 'h', path: '/a', status: 'ok', error: '' }],
    };
    expect(sorunVar(aktarimSorunlari(tam))).toBe(false);
    for (const bozuk of [null, undefined, 'metin', 7, [], { hosts: 'x' }, { hosts: [null, 3] }]) {
      expect(sorunVar(aktarimSorunlari(bozuk))).toBe(false);
      expect(sorunVar(kesifSorunlari(bozuk))).toBe(false);
    }
    expect(sorunVar(null)).toBe(false);
    expect(sorunVar(kesifSorunlari({ hosts: [{ host: 'OK1', status: 'ok', files: [] }] }))).toBe(
      false,
    );
  });
});

describe('legacySebep: gerçek metinler -> bir cümlelik özet', () => {
  const ozet = (ham: string) => legacySebep(ham).ozet;

  it('SB1 örnek dosyasındaki HER sebep bir özete çevrilir (çevrilmeyen kalmaz)', () => {
    const sebepler = new Set<string>();
    for (const [ad, o] of Object.entries(ORNEKLER)) {
      if (ad.startsWith('_')) continue;
      const s = ad.startsWith('kesif') ? kesifSorunlari(o.sonuc) : aktarimSorunlari(o.sonuc);
      [s.genel, ...s.sunucular.map((h) => h.sebep), ...s.dosyalar.map((f) => f.sebep)]
        .filter(Boolean)
        .forEach((x) => sebepler.add(x));
    }
    expect(sebepler.size).toBeGreaterThanOrEqual(6);
    for (const ham of sebepler) {
      const s = legacySebep(ham);
      expect(s.cevrildi, `cevrilmedi: ${ham}`).toBe(true);
      expect(s.ham).toBe(ham);
    }
  });

  it('SB2 her metin DOĞRU özete gider (sıra: bağlantı > yetki > dizin > dosya)', () => {
    expect(ozet('sonuc bildirmedi (AWX envanterinde eslesmedi)')).toMatch(/AWX envanterinde yok/);
    expect(ozet('sonuc bildirmedi')).toMatch(/sonuç bildirmedi/);
    // "Dosya ... denetlenemedi" ile başlasa da asıl sorun bağlantıdır.
    expect(ozet(SSH_DOSYA)).toBe('Sunucuya bağlanılamadı.');
    expect(ozet(SSH_KESIF)).toBe('Sunucuya bağlanılamadı.');
    // "Permission denied" içerse de bu bir DİZİN tarama sorunudur, dosya değil.
    expect(ozet(kesifSorunlari(ornek('kesif_okunamayan')).sunucular[0].sebep)).toMatch(
      /okunamayan bir dizin/,
    );
    expect(ozet('Dosya bulunamadi')).toMatch(/artık yerinde değil/);
    expect(ozet('Dosya okunamiyor')).toBe('Dosya okunamıyor (yetki).');
    expect(ozet('Path normal dosya degil')).toMatch(/normal bir dosya değil/);
    expect(ozet('Dosya was ile denetlenemedi: Missing sudo password')).toMatch(
      /kullanıcıya geçilemedi/,
    );
    expect(ozet('dzdo: a password is required')).toMatch(/kullanıcıya geçilemedi/);
    expect(ozet('awxsvc is not in the sudoers file. This incident will be reported.')).toMatch(
      /kullanıcıya geçilemedi/,
    );
    expect(ozet(aktarimSorunlari(ornek('aktarim_cok_kismi')).sunucular[0].sebep)).toBe(
      'Bu sunucuda seçilen dosyaların hiçbiri alınamadı.',
    );
    expect(ozet(aktarimSorunlari(ornek('aktarim_cok_basarisiz')).genel)).toBe(
      'Hiçbir sunucudan arşivlenecek dosya alınamadı.',
    );
  });

  it('SB3 tanınmayan metin AYNEN geçer (uydurma özet yok); boş metin söylenir', () => {
    expect(legacySebep('bilinmeyen bir sey oldu')).toMatchObject({
      ozet: 'bilinmeyen bir sey oldu',
      ham: 'bilinmeyen bir sey oldu',
      cevrildi: false,
    });
    expect(legacySebep('')).toMatchObject({
      ozet: 'Sebep bildirilmedi.',
      ham: '',
      cevrildi: false,
    });
    expect(legacySebep(undefined).ozet).toBe('Sebep bildirilmedi.');
  });

  it('SB4 ham metin yalnızca EK BİLGİ taşıyorsa ayrıca gösterilir (yol, asıl hata)', () => {
    // Sabit ifadeler: özet aynısını söyler, ham satır tekrar olur.
    for (const sabit of [
      'Dosya bulunamadi',
      'Dosya okunamiyor',
      'Path normal dosya degil',
      'sonuc bildirmedi',
      'sonuc bildirmedi (AWX envanterinde eslesmedi)',
    ]) {
      expect(legacySebep(sabit), sabit).toMatchObject({ cevrildi: true, hamEkBilgi: false });
    }
    // Yol, asıl hata ya da kullanıcı taşıyanlar gösterilir.
    for (const bilgili of [
      SSH_DOSYA,
      SSH_KESIF,
      kesifSorunlari(ornek('kesif_okunamayan')).sunucular[0].sebep,
      aktarimSorunlari(ornek('aktarim_tek_basarisiz')).sunucular[0].sebep,
      aktarimSorunlari(ornek('aktarim_cok_kismi')).sunucular[0].sebep,
      aktarimSorunlari(ornek('aktarim_cok_basarisiz')).genel,
    ]) {
      expect(legacySebep(bilgili), bilgili).toMatchObject({ cevrildi: true, hamEkBilgi: true });
    }
  });
});

describe('LegacySorunlar bileşeni', () => {
  const bos: Sorunlar = { genel: '', sunucular: [], dosyalar: [], istenen: null, alinan: null };

  it('LC1 özet VE ham sebep birlikte; elle eklenen sunucu işaretli; alınamayan dosya sayısı', () => {
    render(
      <LegacySorunlar
        testId="liste"
        sunucuBasligi="Dosya alınamayan sunucular"
        manualHosts={['sunucu-b']}
        sorunlar={aktarimSorunlari(ornek('aktarim_cok_kismi'))}
      />,
    );
    const t = screen.getByTestId('liste').textContent || '';
    expect(t).toMatch(/Dosya alınamayan sunucular:/);
    expect(t).toMatch(/SUNUCU-B \(hata\)/);
    expect(t).toMatch(/envanterde yok — adı doğru mu\?/);
    expect(t).toMatch(/1 dosya alınamadı/);
    expect(t).toMatch(/Bu sunucuda seçilen dosyaların hiçbiri alınamadı\./);
    // Ham sebep kaybolmaz.
    expect(screen.getByTestId('logx-ham-sebep').textContent).toBe(
      'Bu hostta arsivlenecek okunabilir dosya yok; dosya basina sebep: Dosya bulunamadi',
    );
  });

  it('LC2 yüzlerce dosya düşerse liste SINIRLI çizilir ve kalanı sayıyla söylenir', () => {
    const dosyalar = Array.from({ length: 53 }, (_, i) => ({
      host: 'H1',
      path: `/vhosting8/A.ear/log1/f${i}.log`,
      sebep: 'Dosya bulunamadi',
    }));
    render(<LegacySorunlar testId="liste" sunucuBasligi="x" sorunlar={{ ...bos, dosyalar }} />);
    expect(screen.getAllByText(/f\d+\.log/)).toHaveLength(20);
    expect(screen.getByTestId('liste').textContent).toMatch(/… ve 33 dosya daha/);
  });

  it('LC3 çok uzun ham sebep kısaltılır; tamamı ipucunda durur', () => {
    const uzun = `okunamayan 9 yol: ${'/vhosting8/cok/uzun/yol/'.repeat(40)}`;
    render(
      <LegacySorunlar
        sunucuBasligi="x"
        sorunlar={{
          ...bos,
          sunucular: [{ host: 'H1', durum: 'error', sebep: uzun, dosyaSayisi: 0 }],
        }}
      />,
    );
    const ham = screen.getByTestId('logx-ham-sebep');
    expect((ham.textContent || '').length).toBe(401);
    expect(ham.getAttribute('title')).toBe(uzun);
  });
});

describe('FailedStep ve DownloadStep yuvaları', () => {
  it('LC4 FailedStep: sebepler mesajın altında, düğmelerden ÖNCE; sebep yoksa kutu yok', () => {
    const { unmount } = render(
      <FailedStep message="Transfer başarısız oldu." onRestart={() => {}}>
        <span data-testid="sebep">neden</span>
      </FailedStep>,
    );
    const sebep = screen.getByTestId('sebep');
    const dugme = screen.getByRole('button', { name: /Yeniden Başla/ });
    expect(sebep.compareDocumentPosition(dugme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('logx-hata-sebep-kutusu').contains(sebep)).toBe(true);
    unmount();
    render(<FailedStep message="x" onRestart={() => {}} />);
    expect(screen.queryByTestId('logx-hata-sebep-kutusu')).toBeNull();
  });

  it('LC5 DownloadStep: eksik arşiv "hazır" diye SUNULMAZ; uyarı indirme düğmesinden önce', () => {
    const indirme = { token: 't1', filename: 'a.zip', sizeBytes: 10, isFallback: false } as never;
    const { unmount } = render(
      <DownloadStep download={indirme} onRestart={() => {}} eksik={<span>2 dosya yok</span>} />,
    );
    expect(screen.getByText('Log dosyanız hazır — ama EKSİK')).toBeTruthy();
    const uyari = screen.getByTestId('logx-arsiv-eksik');
    expect(uyari.textContent).toBe('2 dosya yok');
    const indir = screen.getByRole('button', { name: /İndir/ });
    expect(uyari.compareDocumentPosition(indir) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(<DownloadStep download={indirme} onRestart={() => {}} />);
    expect(screen.getByText('Log dosyanız hazır')).toBeTruthy();
    expect(screen.queryByTestId('logx-arsiv-eksik')).toBeNull();
  });
});

describe('Sihirbaz: sebepler doğru ekrana, doğru kaynaktan', () => {
  const istek = (ek: Record<string, unknown>) => ({
    id: 'r1',
    platform: 'legacy',
    state: 'failed',
    input: { app: 'APPX', hosts: ['H1'] },
    discoveryResult: null,
    selectedFiles: null,
    errorMessage: null,
    createdAt: '2026-10-07T10:00:00Z',
    updatedAt: '2026-10-07T10:00:00Z',
    expiresAt: '2026-10-08T10:00:00Z',
    ...ek,
  });
  const is = (id: number, jobType: string, artifacts: unknown, status = 'failed') => ({
    id,
    requestId: 'r1',
    jobType,
    status,
    artifacts,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  });
  const SAGLAM_KESIF = {
    overall_status: 'success',
    log_dir_regex: 'logs?[0-9]*',
    hosts: [{ host: 'H1', status: 'ok', error: '', files: [] }],
  };
  const indirme = { token: 't1', filename: 'a.zip', sizeBytes: 10, isFallback: false };

  function ac(yanit: Record<string, unknown>) {
    window.history.replaceState({}, '', '/?logxRequest=r1');
    m.getRequest.mockResolvedValue({ ok: true, download: null, downloads: [], ...yanit });
    return render(<LogXWizardPage />);
  }

  it('LW1 keşif TÜM sunucularda düştü: sunucu, sebep ve "adı doğru mu?" ipucu görünür', async () => {
    const sonuc = ornek('kesif_envanterde_yok');
    ac({
      request: istek({
        input: { app: 'APPX', hosts: ['OLMAYAN-SUNUCU'], manualHosts: ['OLMAYAN-SUNUCU'] },
        discoveryResult: sonuc,
        errorMessage: 'Tüm sunucularda keşif başarısız oldu.',
      }),
      jobs: [is(1, 'legacy_discovery', sonuc)],
    });
    const kutu = await screen.findByTestId('logx-basarisizlik-sebepleri');
    const t = kutu.textContent || '';
    expect(screen.getByText('Tüm sunucularda keşif başarısız oldu.')).toBeTruthy();
    expect(t).toMatch(/Taranamayan sunucular:/);
    expect(t).toMatch(/OLMAYAN-SUNUCU \(erişilemedi\)/);
    expect(t).toMatch(/envanterde yok — adı doğru mu\?/);
    expect(t).toMatch(/Bu ad AWX envanterinde yok/);
  });

  it('LW2 aktarım düştü: sebep SON İŞTEN gelir, istekte duran başarılı keşiften DEĞİL', async () => {
    ac({
      request: istek({ discoveryResult: SAGLAM_KESIF, errorMessage: 'Transfer başarısız oldu.' }),
      jobs: [
        is(1, 'legacy_discovery', SAGLAM_KESIF, 'successful'),
        is(2, 'legacy_transfer', ornek('aktarim_tek_basarisiz')),
      ],
    });
    const t = (await screen.findByTestId('logx-basarisizlik-sebepleri')).textContent || '';
    expect(t).toMatch(/Dosya alınamayan sunucular:/);
    expect(t).not.toMatch(/Taranamayan sunucular/);
    expect(t).toMatch(/Bu sunucuda seçilen dosyaların hiçbiri alınamadı\./);
    expect(t).toMatch(/\/vhosting8\/APPX-T\.ear\/log9\/yok\.log/);
  });

  it('LW3 aktarım KISMİ: indirme ekranı eksikleri sayıyla ve dosya dosya söyler', async () => {
    ac({
      request: istek({ state: 'ready', discoveryResult: SAGLAM_KESIF }),
      jobs: [
        is(1, 'legacy_discovery', SAGLAM_KESIF, 'successful'),
        is(2, 'legacy_transfer', ornek('aktarim_tek_kismi'), 'successful'),
      ],
      download: indirme,
      downloads: [indirme],
    });
    const t = (await screen.findByTestId('logx-arsiv-eksik')).textContent || '';
    expect(screen.getByText('Log dosyanız hazır — ama EKSİK')).toBeTruthy();
    expect(t).toMatch(/seçilen dosya: 3, arşive giren: 1, alınamayan: 2\./);
    expect(t).toMatch(/log9\/yok\.log: Dosya artık yerinde değil/);
    expect(t).toMatch(/log2\/server\.log: Dosya okunamıyor \(yetki\)\./);
    // "Dosya bulunamadi" gibi sabit ham ifadeler özetin altında tekrar edilmez.
    expect(screen.queryAllByTestId('logx-ham-sebep')).toHaveLength(0);
    // Eksik olsa da elde edilen arşiv indirilebilir.
    expect(screen.getByRole('button', { name: /İndir/ })).toBeTruthy();
  });

  it('LW4 aktarım TAM: uyarı yok, başlık yeşil hâliyle', async () => {
    ac({
      request: istek({ state: 'ready', discoveryResult: SAGLAM_KESIF }),
      jobs: [
        is(
          2,
          'legacy_transfer',
          {
            overall_status: 'success',
            error: '',
            per_file_status: [{ host: 'h1', path: '/a.log', status: 'ok', error: '' }],
          },
          'successful',
        ),
      ],
      download: indirme,
      downloads: [indirme],
    });
    expect(await screen.findByText('Log dosyanız hazır')).toBeTruthy();
    expect(screen.queryByTestId('logx-arsiv-eksik')).toBeNull();
  });

  it('LW5 iş sonuç yayınlamadıysa (iptal, AWX hatası) sebep kutusu UYDURULMAZ', async () => {
    ac({
      request: istek({
        discoveryResult: ornek('kesif_envanterde_yok'),
        errorMessage: 'Kullanıcı tarafından iptal edildi.',
      }),
      jobs: [is(1, 'legacy_discovery', null, 'canceled')],
    });
    expect(await screen.findByText('Kullanıcı tarafından iptal edildi.')).toBeTruthy();
    await waitFor(() => expect(m.getRequest).toHaveBeenCalled());
    expect(screen.queryByTestId('logx-basarisizlik-sebepleri')).toBeNull();
  });
});
