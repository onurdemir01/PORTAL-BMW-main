// @vitest-environment jsdom
// Server Hub › Sunucular OZETI (2026-11-27, kapsam PR-2; ServerHubPage dal %35): ozet yaniti (sozlesme v3) ekranda.
// Yardimci metinler (init uyumu, sozdizimi olculemedi, JBoss CLI, urun init bari, bantlar) onceden yalniz kaynaktan
// derlenen bekcide (ui-v2) sinaniyordu; burada gercek bilesen gercek yanitla cizilir.
//   SO1 v3 ozet: kapsama paneli (envanter sutunu yok, erisilemeyen, JVM fazlasi), kartlar (auto-start bilinmiyor
//       kirilimi, olculemeyen dilimleri), urun kartlari (sozdizimi olculemedi, CLI, init bari), ortusme, ortam kirilimi
//   SO2 bantlar: bayat filo, taramadan dusen (acilir liste), cift satir, sema, geri alma, seviye ayari
//   SO3 eski sunucu yaniti: productInit yok -> tek "Init script uyumu" karti; olculemeyen alanlari yoksa 0 uydurulmaz
//   SO4 kartlar Bulgular'a goturur (tik ve klavye); ortam satiri ortam suzgeciyle
//   SO5 tarama bitince yukleyici sonucu bandi: yazilamayan / denenmeyen / okunamayan sonuc
//   SO6 Acilis Hazirligi: ozet cumleleri, kovalar, sebepler (aciklama / kod etiketi / ham kod), red ve istisna
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';

const m = vi.hoisted(() => ({
  overview: vi.fn(),
  findings: vi.fn(),
  limitler: vi.fn(),
  hostAdlari: vi.fn(),
  jobStatus: vi.fn(),
  scan: vi.fn(),
  host: vi.fn(),
  retireEtiketleri: vi.fn(),
  gorunumler: vi.fn(),
  gorunumKaydet: vi.fn(),
  gorunumSil: vi.fn(),
  rebootReadiness: vi.fn(),
}));
const izle = vi.hoisted(() => ({ addJob: vi.fn() }));
const toastM = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => izle }));
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));

import ServerHubPage from '@/components/server_hub/ServerHubPage';
import * as shOnbellek from '@/components/server_hub/shOnbellek';

const H = (host: string, o: Record<string, unknown> = {}) => ({
  host,
  env: 'PROD',
  envGroup: 'Production',
  hostClass: 'genel',
  status: 'warning',
  counts: { danger: 0, warning: 1, info: 0 },
  products: ['JBOSS7'],
  jvms: 2,
  jvmsRunning: 2,
  vhosts: 1,
  unusedIps: 0,
  topFinding: 'bir uyarı',
  scanDate: '2026-11-26',
  cpuS: 0.4,
  fresh: true,
  ...o,
});
const OZET_V3 = {
  hosts: { total: 12, ok: 6, info: 1, warning: 3, danger: 2 },
  init: { hosts: 10, compliant: 7, diffFiles: 2 },
  jvm: {
    total: 40,
    running: 30,
    stopped: 6,
    autoOn: 31,
    autoOff: 5,
    autoUnknown: 4,
    restartRequired: 2,
    rebootRisk: 3,
    retireCandidates: 1,
    noLoad: 4,
    mapped: 35,
    autoUnknownBy: {
      'yeni-sebep': 1,
      'tanimsiz-surec': 1,
      'cli-okunamadi': 2,
      'envanterde-yok': 0,
    },
    fromInventory: 2,
    mismatched: 1,
    unmeasured: 4,
    retireBlockedByWebTier: 1,
  },
  web: {
    NGINX: {
      hosts: 5,
      syntaxOk: 3,
      syntaxFail: 1,
      notRunning: 1,
      vhosts: 20,
      idleVhosts: 4,
      syntaxUnknown: 1,
      notRunningUnmeasured: 2,
    },
    RHA: { hosts: 4, syntaxOk: 4, syntaxFail: 0, notRunning: 0, vhosts: 10, idleVhosts: 1 },
    IHS: {
      hosts: 2,
      syntaxOk: 1,
      syntaxFail: 0,
      notRunning: 0,
      vhosts: 3,
      idleVhosts: 0,
      syntaxUnknown: 1,
    },
  },
  ips: { total: 30, unused: 3, unverified: 2 },
  ssh: { hosts: 12, lowMaxSessions: 2, near: 1 },
  scan: { avgCpuS: 1.2, maxCpuS: 4, maxCpuHost: 'ORCJAP01' },
  jbossCli: { hosts: 8, ok: 4, fail: 1, denied: 1, skip: 1, noRow: 1, kalinti: 2 },
  productInit: {
    NGINX: {
      hosts: 5,
      compliant: 0,
      diffFiles: 0,
      olcutHosts: 3,
      noOlcutHosts: 2,
      unreadableFiles: 2,
    },
    JBOSS: { hosts: 8, compliant: 7, diffFiles: 1, olcutHosts: 8, otherDiffFiles: 3 },
    RHA: { hosts: 4, compliant: 4, diffFiles: 0 },
  },
  productOverlap: {
    multi: 3,
    combos: [
      { combo: 'RHA+JBOSS', hosts: 2 },
      { combo: 'IHS+YENI', hosts: 1 },
    ],
  },
  byEnv: {
    Production: {
      hosts: 8,
      danger: 2,
      warning: 1,
      ok: 5,
      jvms: 30,
      jvmRunning: 25,
      jvmUnmeasured: 2,
      autoOff: 3,
      rebootRisk: 2,
      initDiff: 1,
      web: { NGINX: { hosts: 3, syntaxFail: 1, notRunning: 0 } },
    },
    'Non-Production': {
      hosts: 4,
      danger: 0,
      warning: 2,
      ok: 2,
      jvms: 10,
      jvmRunning: 5,
      autoOff: 2,
      rebootRisk: 1,
      initDiff: 0,
      web: {},
    },
  },
  scanCoverage: {
    hosts: { inventory: 14, scanned: 12, scannedNotInInventory: 1, missing: 2 },
    products: {
      JBOSS: { inventory: 8, scanned: 8, scannedNotInInventory: 0, missing: 0, missingHosts: [] },
      RHA: {
        inventory: 10,
        scanned: 9,
        scannedNotInInventory: 0,
        missing: 1,
        missingHosts: ['ORCWAP09'],
      },
      IHS: {
        inventoryUnknown: true,
        inventory: 0,
        scanned: 2,
        scannedNotInInventory: 2,
        missing: 0,
        missingHosts: [],
      },
      NGINX: { inventory: 0, scanned: 0, scannedNotInInventory: 0, missing: 0, missingHosts: [] },
    },
    jvm: {
      inventory: 42,
      scanned: 38,
      fromInventory: 2,
      scannedTotal: 41,
      scannedOverInventory: 1,
      scannedNotInInventory: 2,
      scannedNotInInventoryHosts: 1,
    },
  },
  taramadanDusen: {
    sayi: 2,
    sunucular: [
      { host: 'ORCJAP77', scanDate: '2026-10-01', env: 'PROD', products: ['JBOSS7'] },
      { host: 'ORCJAP78', scanDate: null, env: null, products: [] },
    ],
  },
  ciftSatir: { toplam: 3, tablolar: { Server_Hub_Jvm: 2, Server_Hub_Web: 1 } },
};
const yanit = (o: Record<string, unknown> = {}) => ({
  ok: true,
  tableMissing: false,
  latestScan: '2026-11-26',
  summary: OZET_V3,
  hosts: [H('ORCJAP01'), H('ORCJAP02')],
  ...o,
});

beforeEach(() => {
  window.localStorage.clear();
  Object.values(m).forEach((f) => f.mockReset());
  izle.addJob.mockReset();
  Object.values(toastM).forEach((f) => f.mockReset());
  shOnbellek._sifirlaForTest();
  m.overview.mockResolvedValue(yanit());
  m.limitler.mockResolvedValue({ ok: true, limitler: [] });
  m.findings.mockResolvedValue({ ok: true, findings: [] });
  m.host.mockResolvedValue({ ok: false, message: 'yok' });
  m.retireEtiketleri.mockResolvedValue({ ok: true, kurallar: [], etiketler: [], ozet: {} });
  m.gorunumler.mockResolvedValue({ ok: true, okunamadi: false, gorunumler: [] });
});

const kart = (baslik: string) =>
  screen.getByRole('heading', { name: baslik, level: 3 }).closest('section') as HTMLElement;
/** Sekme dugmesi (ayni adli kart bolumu de rol=button tasir; sekme gercek <button>). */
const sekme = (ad: string) =>
  screen.getAllByRole('button', { name: ad }).find((b) => b.tagName === 'BUTTON') as HTMLElement;
const etkinSekme = () =>
  document.querySelector('[data-sekme]:not([hidden])')?.getAttribute('data-sekme');
const metin = (el: HTMLElement) => (el.textContent || '').replace(/\s+/g, ' ').trim();

describe('Server Hub özeti (sözleşme v3)', () => {
  it('SO1 kapsama paneli, kartlar, ürün kartları, örtüşme ve ortam kırılımı', async () => {
    render(<ServerHubPage />);
    await screen.findByText(/Kapsama — envanterde ne var/);

    // Kapsama: satir basina envanter / veri cekilen / yuzde / erisilemeyen.
    const kapsama = screen.getByText(/Kapsama — envanterde ne var/).closest('div')!
      .parentElement as HTMLElement;
    const satir = (ad: string) =>
      within(kapsama).getByText(ad, { selector: 'td' }).closest('tr') as HTMLTableRowElement;
    const hucreler = (ad: string) =>
      [...satir(ad).querySelectorAll('td')].map((td) => metin(td as HTMLElement));
    expect(hucreler('Sunucu (tümü)')).toEqual(['Sunucu (tümü)', '14', '12', '%86', '2 sunucu']);
    expect(hucreler('JBoss')).toEqual(['JBoss', '8', '8', '%100', '—']);
    expect(hucreler('JVM')).toEqual(['JVM', '42', '38', '%90', '4 JVM']);
    expect(hucreler('Red Hat Apache')).toEqual(['Red Hat Apache', '10', '9', '%90', '1 sunucu']);
    expect(satir('Red Hat Apache').querySelectorAll('td')[4]).toHaveAttribute(
      'title',
      'Erişilemeyen (ilk 1): ORCWAP09',
    );
    // Envanterde sutun yok: sayi 0 DEGIL, bilinmiyor.
    expect(hucreler('IBM HTTP Server')).toEqual([
      'IBM HTTP Server',
      'envanter sütunu yok',
      '—',
      'taramada 2',
    ]);
    // Envanter 0: yuzde uydurulmaz.
    expect(hucreler('Nginx')).toEqual(['Nginx', '0', '0', '%0', '—']);
    expect(metin(kapsama)).toContain('1 sunucu taramada çıktı ama envanterde yok');
    expect(metin(kapsama)).toContain(
      'Taramada toplam 41 JVM çıktı; 1’i envanterin o sunucu için yazdığı sayıdan fazla, 2’i envanterde JBoss olarak görünmeyen 1 sunucuda — “veri çekilen”e sayılmadı',
    );
    expect(metin(kapsama)).toContain('2 uygulama yalnız envanterde');

    // Auto-start: bilinmiyor kirilimi bilinen sirayla, etiketsiz yeni anahtar ham adiyla, 0 olan yok.
    const auto = kart('JBoss JVM auto-start');
    expect(metin(auto)).toContain(
      "bilinmiyor — CLI cevap vermedi: 2 · JVM tanımda yok (ps'te tanımsız süreç): 1 · yeni-sebep: 1",
    );
    expect(metin(auto)).not.toContain('envanterde alan boş');
    expect(metin(auto)).toContain(
      '3 reboot riski · 2 restart gerekli · 2 uygulama yalnız envanterde · 1 envanterle çelişiyor',
    );
    const durum = kart('JVM durumu / trafik');
    expect(metin(durum)).toContain('bilinmiyor (süreç görünmüyor)');
    expect(metin(durum)).toContain("4 JVM'in çalışma durumu ölçülemedi");
    expect(metin(durum)).toContain(
      '1 retire adayı eylemsiz (web katmanında ölçülemeyen sunucu var)',
    );
    const olculemeyen = durum.querySelector('b[title^="Süreç listesi"]') as HTMLElement;
    expect(olculemeyen).toHaveTextContent('4');
    expect(olculemeyen).toHaveAttribute(
      'title',
      "Süreç listesi kısıtlı (hidepid) ve CLI durum vermedi: bu JVM'ler ne çalışan ne kapalı sayıldı.",
    );
    const ip = kart('Boşta IP');
    // Dogrulanamayan IP ayri dilim: kullanimda = toplam - bosta - dogrulanamadi.
    expect(metin(ip)).toContain('kullanımda');
    expect(metin(ip)).toContain('doğrulanamadı');
    expect(within(ip).getByText('kullanımda: 25', { selector: 'title' })).toBeTruthy();
    expect(metin(ip)).toContain('SSH: 1 sınıra yakın · 2/12 MaxSessions ≤ 10');

    // Urun kartlari: Nginx sozdizimi hatali + olculemedi + durumu olculemedi; init bari olcut paydasi.
    const nginx = kart('Nginx');
    expect(metin(nginx)).toContain('Sözdizimi uyumu3 / 5 sunucu');
    expect(metin(nginx)).toContain(
      '1 hatalı · 1 sözdizimi ölçülemedi · 1 çalışmıyor · 2 durumu ölçülemedi · 20 vhost, 4 yüksüz',
    );
    expect(metin(nginx)).toContain('0 / 3 sunucu çoğunlukla aynı');
    expect(metin(nginx)).toContain(
      '2 dosya OKUNAMADI — çoğunluk kurulamadı · 0 farklı · 2 sunucuda ölçüt dosyası yok (ölçülemedi)',
    );
    expect(nginx.style.borderColor).toBe('var(--status-danger)');
    // JBoss: sozdizimi degil "yapilandirma okundu (CLI)".
    const jboss = kart('JBoss');
    expect(metin(jboss)).toContain('Yapılandırma okundu (CLI)4 / 8 sunucu');
    expect(metin(jboss)).toContain(
      '1 yetki reddi · 1 erişilemedi · 1 hiç denenmedi · 1 sunucuda CLI satırı gelmedi · 2 sunucuda kalıntı JBoss dizini (sayılmadı)',
    );
    expect(metin(jboss)).toContain('1 farklı · 3 fark ölçüt dışı dosyada');
    expect(jboss.style.borderColor).toBe('var(--status-warning)');
    // Red Hat Apache: sorunsuz (cerceve notr), olcut paydasi yoksa hosts.
    const rha = kart('Red Hat Apache');
    expect(metin(rha)).toContain('4 / 4 sunucu çoğunlukla aynı');
    expect(rha.style.borderColor).toBe('var(--border-subtle)');
    // IHS: hatasiz ama olculemeyen -> uyari tonu; init bari yok.
    const ihs = kart('IBM HTTP Server');
    expect(ihs.style.borderColor).toBe('var(--status-warning)');
    expect(metin(ihs)).not.toContain('Init script uyumu');
    // productInit varken eski tek kart yok.
    expect(screen.queryByRole('heading', { name: 'Init script uyumu', level: 3 })).toBeNull();

    // Ortusme: urun adlari okunur, bilinmeyen urun ham adiyla.
    expect(
      screen.getByText(/sunucu birden fazla ürün taşıyor/).closest('div')!.textContent,
    ).toContain('En sık birliktelikler: Red Hat Apache + JBoss (2) · IBM HTTP Server + YENI (1).');

    // Ortam kirilimi: olculemeyen JVM alani yoksa "—", sozdizimi hatasi urun adiyla.
    const ortam = screen.getByRole('heading', { name: 'Ortam kırılımı' }).closest('div')!;
    const prod = within(ortam).getByText('Production', { selector: 'td' }).closest('tr')!;
    const nonprod = within(ortam).getByText('Non-Production', { selector: 'td' }).closest('tr')!;
    expect(metin(prod)).toContain('NGINX');
    expect(within(prod).getAllByRole('cell')[6]).toHaveTextContent('2');
    expect(within(nonprod).getAllByRole('cell')[6]).toHaveTextContent('—');
  });

  it('SO2 bantlar: bayat filo, taramadan düşen, çift satır, şema, geri alma, seviye ayarı', async () => {
    m.overview.mockResolvedValue(
      yanit({
        staleFleet: { ageDays: 3, lastLoad: '2026-11-23T08:00:00Z' },
        schemaUnknown: true,
        rollback: { allowed: false, message: '', schemaUnknown: true },
        ayar: { okunamadi: false, seviyeDegisen: 4 },
      }),
    );
    render(<ServerHubPage />);
    const bayat = await screen.findByText(/Son başarılı yükleme 3 gün önce — eylemler kapalı/);
    expect(bayat.closest('[role="alert"]')).toHaveTextContent('(son yükleme 23.11.2026)');
    expect(screen.getByText('Tarayıcı şema sürümü bilinmiyor; eylemler kapalı')).toBeTruthy();
    // Sema okunamadiysa olculemeyenin sebebi sema; geri alma metni de bunu soyler.
    expect(metin(kart('JVM durumu / trafik'))).toContain('bilinmiyor (şema okunamadı)');
    expect(
      screen.getByText(/Portal'ı geri almadan önce: Server Hub şeması okunamadı/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Bu raporda 4 bulgu kodunun seviyesi Admin tarafından değiştirildi/),
    ).toBeTruthy();
    expect(screen.getByText('3 çift tarama satırı ayıklandı').parentElement).toHaveTextContent(
      '(en son yükleme kullanıldı; Jvm 2, Web 1)',
    );
    // Taramadan dusen: liste kapali baslar, acilir, kapanir.
    const dusen = screen.getByRole('button', { name: /2 sunucu son taramada yok/ });
    expect(screen.queryByText('ORCJAP77')).toBeNull();
    fireEvent.click(dusen);
    expect(screen.getByText('ORCJAP77').parentElement).toHaveTextContent(
      'ORCJAP77 · 01.10.2026 · PROD',
    );
    expect(screen.getByText('ORCJAP78').parentElement).toHaveTextContent('ORCJAP78 · ?');
    fireEvent.click(dusen);
    expect(screen.queryByText('ORCJAP77')).toBeNull();
  });

  it('SO3 eski sunucu yanıtı: tek init kartı, ölçülemeyen alanlar yoksa 0 uydurulmaz', async () => {
    const eski = {
      ...OZET_V3,
      init: {
        hosts: 10,
        compliant: 0,
        diffFiles: 0,
        unreadableFiles: 10,
        missingFiles: 1,
        refDiffFiles: [{ file: 'start.sh', hosts: 3 }],
        olcutDosyasi: 'start.sh',
        otherDiffFiles: 2,
      },
      jvm: { ...OZET_V3.jvm, unmeasured: undefined, retireBlockedByWebTier: undefined },
      ips: { total: 30, unused: 0 },
      ssh: { hosts: 0, lowMaxSessions: 0, near: 0 },
      productInit: undefined,
      jbossCli: undefined,
      productOverlap: { multi: 0, combos: [] },
      byEnv: {},
      scanCoverage: undefined,
      taramadanDusen: undefined,
      ciftSatir: { toplam: 0, tablolar: {} },
    };
    m.overview.mockResolvedValue(
      yanit({
        summary: eski,
        staleFleet: { ageDays: null },
        rollback: { allowed: false, message: '', v3Hosts: 5 },
        ayar: { okunamadi: true, seviyeDegisen: 0 },
      }),
    );
    render(<ServerHubPage />);
    const init = await screen.findByRole('heading', { name: 'Init script uyumu', level: 3 });
    expect(metin(init.closest('section') as HTMLElement)).toContain(
      '10 dosya OKUNAMADI — çoğunluk kurulamadı, aşağıdaki sayılar ölçüm değil · 0 dosya çoğunluktan farklı · 1 eksik · 1 dosyada çoğunluk repo referansından farklı · ölçüt: start.sh · 2 fark ölçüt dışı dosyada (sayıma katılmaz)',
    );
    expect(
      screen.getByText('Son başarılı yükleme zamanı bilinmiyor — eylemler kapalı'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Portal'ı geri almadan önce: 5 sunucunun son taraması yeni tarayıcıdan (scan_ver dolu) — Portal eski sürüme geri alınmamalı",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Server Hub ayarları okunamadı: bu raporda varsayılan seviyeler uygulandı.'),
    ).toBeTruthy();
    const durum = metin(kart('JVM durumu / trafik'));
    expect(durum).not.toContain('ölçülemedi');
    expect(durum).not.toContain('eylemsiz');
    // Dogrulanamayan IP alani yok: "bosta degil" dilimi onu da icerdigini soyler.
    expect(metin(kart('Boşta IP'))).toContain('boşta değil (doğrulanamayan dahil)');
    expect(metin(kart('Boşta IP'))).not.toContain('SSH:');
    // JBoss karti CLI ozeti ve init bari olmadan cizilmez; bant / panel / kirilim yok.
    expect(screen.queryByRole('heading', { name: 'JBoss', level: 3 })).toBeNull();
    expect(screen.queryByText(/Kapsama — envanterde ne var/)).toBeNull();
    expect(screen.queryByText(/çift tarama satırı/)).toBeNull();
    expect(screen.queryByText(/sunucu birden fazla ürün taşıyor/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Ortam kırılımı' })).toBeNull();
  });

  it('SO4 kartlar Bulgular sekmesine süzgeciyle götürür (tık ve klavye); ortam satırı', async () => {
    render(<ServerHubPage />);
    await screen.findByText(/Kapsama — envanterde ne var/);
    expect(etkinSekme()).toBe('hosts');
    const bulgulardaAlan = async (alan: string) => {
      await waitFor(() => expect(etkinSekme()).toBe('findings'));
      const sec = await screen.findByRole('combobox', { name: 'alan' });
      expect(sec).toHaveValue(alan);
      fireEvent.click(sekme('Sunucular'));
      expect(etkinSekme()).toBe('hosts');
    };
    fireEvent.keyDown(kart('JBoss JVM auto-start'), { key: 'Enter' });
    await bulgulardaAlan('jvm');
    // Baska tus kart eylemi degildir.
    fireEvent.keyDown(kart('Boşta IP'), { key: 'Escape' });
    expect(etkinSekme()).toBe('hosts');
    fireEvent.keyDown(kart('Boşta IP'), { key: ' ' });
    await bulgulardaAlan('ip');
    fireEvent.click(kart('Nginx'));
    await bulgulardaAlan('web');
    fireEvent.click(kart('JBoss'));
    await bulgulardaAlan('jboss');
    fireEvent.click(kart('Sunucular'));
    await bulgulardaAlan('all');
    const ortam = screen.getByRole('heading', { name: 'Ortam kırılımı' }).closest('div')!;
    fireEvent.click(within(ortam).getByText('Non-Production', { selector: 'td' }));
    await waitFor(() => expect(etkinSekme()).toBe('findings'));
    expect(await screen.findByRole('combobox', { name: 'ortam' })).toHaveValue('Non-Production');
    expect(screen.getByRole('combobox', { name: 'alan' })).toHaveValue('all');
  });

  it('SO5 tarama bitince yükleyici sonucu bandı', async () => {
    m.scan.mockResolvedValue({ ok: true, jobId: 77, awxServerId: 2 });
    render(<ServerHubPage />);
    const tara = async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Listedekileri tara/ }));
      await waitFor(() => expect(izle.addJob).toHaveBeenCalled());
      const is = izle.addJob.mock.calls.at(-1)![0];
      izle.addJob.mockClear();
      return is as { title: string; fetchStatus: () => Promise<unknown> };
    };
    let is = await tara();
    expect(m.scan).toHaveBeenCalledWith(['ORCJAP01', 'ORCJAP02']);
    expect(is.title).toBe('Server Hub: tara 2 sunucu');
    expect(toastM.success).toHaveBeenCalledWith(
      'Tarama başladı (iş #77). Bitince liste yenilenir.',
    );
    m.jobStatus.mockResolvedValueOnce({ ok: false, status: '', output: '', message: 'AWX yok' });
    await expect(is.fetchStatus()).rejects.toThrow('AWX yok');
    m.jobStatus.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      output: '',
      result: {
        loader: JSON.stringify({
          hosts_total: 9,
          hosts_written: 1,
          hosts_excluded: 7,
          hosts_not_attempted: 1,
          excluded: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ host: `ORCJAP1${i}`, issue: 'kilit' })),
        }),
      },
    });
    const yuklemeOnce = m.overview.mock.calls.length;
    await act(async () => {
      await is.fetchStatus();
    });
    expect(m.jobStatus).toHaveBeenLastCalledWith(2, 77);
    const bant = await screen.findByText('Tarama #77 (2 sunucu): successful');
    expect(metin(bant.parentElement as HTMLElement)).toContain(
      '1/9 sunucu yazıldı7 sunucu yazılamadı (ORCJAP11: kilit, ORCJAP12: kilit, ORCJAP13: kilit, ORCJAP14: kilit, ORCJAP15: kilit +2) — bu sunucularda önceki tarama gösterilir1 sunucu denenmedi (NOT_ATTEMPTED — yükleyici veritabanı hatasında durdu)',
    );
    expect(toastM.warning).toHaveBeenCalledWith(
      expect.stringMatching(/^Tarama #77 \(2 sunucu\): 1\/9 sunucu yazıldı · 7 sunucu yazılamadı/),
    );
    await waitFor(() => expect(m.overview.mock.calls.length).toBe(yuklemeOnce + 1));
    // Ayni is ikinci kez terminal donerse sonuc yeniden islenmez.
    m.jobStatus.mockResolvedValueOnce({ ok: true, status: 'successful', output: '', result: null });
    await act(async () => {
      await is.fetchStatus();
    });
    expect(screen.getByText('Tarama #77 (2 sunucu): successful')).toBeTruthy();

    // Sonuc okunamadi: "hepsi yazildi" denmez; sebepsiz dislanan.
    is = await tara();
    m.jobStatus.mockResolvedValueOnce({
      ok: true,
      status: 'failed',
      output: '',
      result: { loader: '{bozuk' },
    });
    await act(async () => {
      await is.fetchStatus();
    });
    expect(
      await screen.findByText(
        'Yükleyici sonucu okunamadı — kaç sunucunun veritabanına yazıldığı bilinmiyor.',
      ),
    ).toBeTruthy();
    is = await tara();
    m.jobStatus.mockResolvedValueOnce({
      ok: true,
      status: 'successful',
      output: '',
      result: { loader: { hosts_total: 2, hosts_written: 2 } },
    });
    toastM.warning.mockClear();
    await act(async () => {
      await is.fetchStatus();
    });
    expect(await screen.findByText('2/2 sunucu yazıldı')).toBeTruthy();
    expect(toastM.warning).not.toHaveBeenCalled();

    // Red ve istisna: is izlenmez.
    m.scan.mockResolvedValueOnce({ ok: false, message: 'Tarama kilitli' });
    fireEvent.click(screen.getByRole('button', { name: /Listedekileri tara/ }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('Tarama kilitli'));
    m.scan.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(screen.getByRole('button', { name: /Listedekileri tara/ }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('ağ yok'));
    expect(izle.addJob).not.toHaveBeenCalled();
  });
});

describe('Açılış Hazırlığı', () => {
  const ac = async () => {
    render(<ServerHubPage />);
    await screen.findByText(/Kapsama — envanterde ne var/);
    fireEvent.click(sekme('Açılış Hazırlığı'));
    return screen.findByPlaceholderText(/SUNUCU01, SUNUCU02/);
  };

  it('SO6 özet cümleleri, kovalar, sebepler; red ve istisna', async () => {
    const alan = await ac();
    const dugme = screen.getByRole('button', { name: 'Açılır mı?' });
    expect(dugme).toBeDisabled();
    fireEvent.change(alan, { target: { value: 'ORCJAP01, ORCJAP02 ORCJAP03' } });
    m.rebootReadiness.mockResolvedValueOnce({
      ok: true,
      latestScan: '2026-11-26',
      summary: { requested: 3, scanned: 2, notScanned: 1, ok: 0, risk: 1, blocked: 1, unknown: 1 },
      topReasons: [
        { code: 'REBOOT_RISK', tip: 'blocker', aciklama: '', hostCount: 1, hosts: ['ORCJAP01'] },
        {
          code: 'SCHEMA_UNKNOWN',
          tip: 'unknown',
          aciklama: 'şema okunamadı',
          hostCount: 10,
          hosts: Array.from({ length: 10 }, (_, i) => `ORCJAP${String(i + 10)}`),
        },
        { code: 'YENI_KOD', tip: 'risk', aciklama: '', hostCount: 1, hosts: ['ORCJAP02'] },
      ],
      rows: [
        {
          host: 'ORCJAP01',
          verdict: 'blocked',
          scanDate: '2026-11-26',
          reasons: [
            { code: 'REBOOT_RISK', tip: 'blocker', aciklama: '', text: '', area: 'jvm' },
            { code: 'YENI_KOD', tip: 'risk', aciklama: '', text: '', area: null },
          ],
          note: '',
        },
        { host: 'ORCJAP02', verdict: 'risk', scanDate: null, reasons: [], note: '' },
        {
          host: 'ORCJAP03',
          verdict: 'notScanned',
          scanDate: null,
          reasons: [],
          note: 'bu sunucu taramada yok',
        },
      ],
    });
    fireEvent.click(dugme);
    await waitFor(() =>
      expect(m.rebootReadiness).toHaveBeenCalledWith('ORCJAP01, ORCJAP02 ORCJAP03'),
    );
    const ozet = await screen.findByText(/sunucu soruldu/);
    expect(metin(ozet as HTMLElement)).toBe(
      '3 sunucu soruldu. 1 tanesi şu an yeniden başlatılırsa sorunsuz açılmaz. 1 sunucuda ölçüm yapılamadı — bunlar için güvence verilemez. 1 sunucu hiç taranmamış; listede duruyor ama hakkında bir şey söylenemez. 1 sunucuda açılışta sürpriz var (durdurulmuş JVM kalkar gibi).',
    );
    for (const k of ['AÇILMAZ 1', 'BİLİNMİYOR 1', 'DİKKAT 1', 'HAZIR 0', 'TARANMADI 1'])
      expect(screen.getByText(k)).toBeTruthy();
    expect(screen.getByText(/Son taramanın verisine bakar \(2026-11-26\)/)).toBeTruthy();
    // Sebepler: aciklama bossa kod etiketi, etiket de yoksa ham kod; 8'den fazla sunucu "+N".
    // (Sunucu listesi ayri, kenar bosluklu bir span: metinde aradaki bosluk yok.)
    const sebepler = screen.getByText('Sebepler').parentElement as HTMLElement;
    const satirlar = [...sebepler.querySelectorAll(':scope > div[title]')].map((d) =>
      metin(d as HTMLElement),
    );
    expect(satirlar).toEqual([
      '● JVM çalışıyor ama auto-start kapalı — reboot sonrası açılmaz — 1 sunucuORCJAP01',
      '● şema okunamadı — 10 sunucuORCJAP10, ORCJAP11, ORCJAP12, ORCJAP13, ORCJAP14, ORCJAP15, ORCJAP16, ORCJAP17 +2',
      '● YENI_KOD — 1 sunucuORCJAP02',
    ]);
    // Tablo: sebepler, bos sebep, not.
    const tablo = screen.getByRole('table');
    const satir = (h: string) => within(tablo).getByText(h).closest('tr')!.querySelectorAll('td');
    expect(metin(satir('ORCJAP01')[1] as HTMLElement)).toBe('AÇILMAZ');
    expect(metin(satir('ORCJAP01')[2] as HTMLElement)).toBe(
      'JVM çalışıyor ama auto-start kapalı — reboot sonrası açılmaz · YENI_KOD',
    );
    expect(metin(satir('ORCJAP02')[2] as HTMLElement)).toBe('bilinen engel yok');
    expect(metin(satir('ORCJAP03')[2] as HTMLElement)).toBe('bu sunucu taramada yok');

    // Engel yok cumlesi; red rapor alanini temizler; istisna.
    m.rebootReadiness.mockResolvedValueOnce({
      ok: true,
      summary: { requested: 1, scanned: 1, notScanned: 0, ok: 1, risk: 0, blocked: 0, unknown: 0 },
      rows: [],
      topReasons: [],
    });
    fireEvent.click(dugme);
    await waitFor(() =>
      expect(metin(screen.getByText(/sunucu soruldu/) as HTMLElement)).toBe(
        '1 sunucu soruldu. Bilinen bir açılış engeli yok.',
      ),
    );
    expect(screen.queryByText('Sebepler')).toBeNull();
    m.rebootReadiness.mockResolvedValueOnce({ ok: false, message: 'liste çok uzun' });
    fireEvent.click(dugme);
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('liste çok uzun'));
    expect(screen.queryByText(/sunucu soruldu/)).toBeNull();
    m.rebootReadiness.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(dugme);
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('ağ yok'));
    expect(dugme).toHaveTextContent('Açılır mı?');
  });
});
