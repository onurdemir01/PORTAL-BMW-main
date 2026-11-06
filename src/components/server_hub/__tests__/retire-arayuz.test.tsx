// src/components/server_hub/__tests__/retire-arayuz.test.tsx — Retirement etiketleri arayüzü (2026-11-06).
//
// Kullanıcı: "bulgular ekranında bir sunucuya tıklanırsa da ui simple aksiyona yönelik ve açılır kapanır
// şekilde detay gösteren gerçek sonuç gösteren şekilde olsun"; "retiere etiketi ayrı olsun bulgular ayrı
// olsun ... admin tarafından editlenebilir olsun"; "Manuel kontrol de gerekecek".
//   RA1 yardımcılar: süzgeç (yanlış alarm varsayılan gizli), komut yer tutucusu, Retirement uygulama adı,
//       doğrulama adımları (tekil, dolu), zincir katmanı, EAR durumu "temiz" demez, yeşil yalnız doğrulandı
//   RA2 etiket listesi: satır açılır, düşme nedenleri, komutlar konuyla dolu; Retirement düğmesi yalnız
//       KESİN + DOĞRULANDI; kök girdisi Retirement konusu değil; Uygulama Envanteri okunamadı bandı
//   RA3 manuel kontrol: not zorunlu, imza gider, 409 listeyi yeniler, kayıtlar okunamazken form yok, geri al
//   RA4 sunucu paneli: yalnız "Ne yapmalı" açık; zincir kartı (parametre farkı, EAR, web katmanı, trafik);
//       bağsız EAR; doğrulama adımları dolu; auto-start düğmesi; okunamadı -> LoadError
//   RA5 Bulgular: sunucuya tıklayınca panel satırın altında açılır / kapanır; Retirement etiketleri görünümü
//   RA6 Kurallar: etiket seviyesi gerekçesiz kaydedilmez; yok sayma listesi kaydı
//   RA7 Retirement: etiketten gelen öneri kayıt formunu uygulama adı ve notla açar, keşif başlar
//   RA8 Faz 2: zincir kartında deployment satırı (kontrol kapalı / JVM kapalı / yok / FAILED / ölçülemedi)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { ShHostDetail, ShRetireEtiket, ShRetireSonuc, ShKurallar } from '@/api/serverHubApi';

// Liste ucu OZET doner (kopyalar yok); ayrinti ucu tam etiketi buradan verir.
const TAM = new Map<string, ShRetireEtiket>();

const m = vi.hoisted(() => ({
  findings: vi.fn(),
  host: vi.fn(),
  retireEtiketleri: vi.fn(),
  retireEtiketAyrinti: vi.fn(),
  retireKontrol: vi.fn(),
  jvmAutoStart: vi.fn(),
  kurallar: vi.fn(),
  etiketSeviyesi: vi.fn(),
  kokYoksay: vi.fn(),
  seviyeDegistir: vi.fn(),
  limitDegistir: vi.fn(),
}));
const rt = vi.hoisted(() => ({ list: vi.fn(), config: vi.fn(), discover: vi.fn(), apps: vi.fn() }));
const toastM = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/api/retirementApi', async (orig) => ({
  ...(await orig<typeof import('@/api/retirementApi')>()),
  retirementApi: rt,
}));
vi.mock('@/hooks/useToast', () => ({ toast: toastM }));
vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

import RetireEtiketleriGorunum, { KontrolFormu } from '@/components/server_hub/RetireEtiketleri';
import SunucuPaneli from '@/components/server_hub/SunucuPaneli';
import { FindingsTab } from '@/components/server_hub/ServerHubPage';
import KurallarTab from '@/components/server_hub/KurallarTab';
import RetirementTab from '@/components/server_hub/RetirementTab';
import * as shOnbellek from '@/components/server_hub/shOnbellek';
import {
  KONTROL_DURUM,
  ETIKET_SEVIYE,
  BOS_SUZGEC,
  etiketSuz,
  komutDoldur,
  retirementUygulamasi,
  dogrulamaAdimlari,
  zincirKartlari,
  earDurumMetni,
  bulgudanJvm,
  deploymentMetni,
} from '@/components/server_hub/retireEtiket';

const APP = 'GBCJAP01';
const WEB = 'GBCJWP01';
const KURALLAR: ShRetireSonuc['kurallar'] = [
  {
    kural: 'R1',
    tur: 'JVM',
    ad: 'Kapalı + auto-start açık + trafik yok',
    kosul: 'k1',
    varsayilan: 'KESIN',
    gecerli: 'KESIN',
    degistiren: null,
    zaman: null,
    aciklama: '',
    dogrulama: {
      neden: 'N-R1',
      eksik: 'E-R1',
      kontrol: [
        'jboss-cli.sh --command="ls host=master/server-config=<JVM>"',
        'zgrep x <ACCESS_LOG>*',
      ],
    },
  },
  {
    kural: 'R4',
    tur: 'GIRDI',
    ad: 'Kökte .ear ile bitmeyen girdi',
    kosul: 'k4',
    varsayilan: 'SUPHELI',
    gecerli: 'SUPHELI',
    degistiren: null,
    zaman: null,
    aciklama: '',
    dogrulama: { neden: 'N-R4', eksik: 'E-R4', kontrol: ['ls -la /vhosting/<GIRDI>'] },
  },
];
const etiket = (o: Partial<ShRetireEtiket> = {}): ShRetireEtiket => ({
  anahtar: 'JVM|OLDAPP|PROD|7',
  tur: 'JVM',
  ad: 'oldapp',
  ortam: 'PROD',
  gen: 7,
  nesil: null,
  kok: null,
  seviye: 'KESIN',
  hamSeviye: 'KESIN',
  kurallar: ['R1'],
  nedenler: [],
  notlar: [],
  tier: ['3'],
  hostlar: [APP],
  kopyalar: [
    {
      host: APP,
      kurallar: ['R1'],
      gen: 7,
      calisiyor: false,
      autoStart: 'true',
      trafik: 'NO_RECENT_TRAFFIC',
      esleme: 'WEB_APP',
      tier: '3',
      taze: true,
      web: [
        {
          host: WEB,
          vhost: 'oldapp.bmw.local',
          trafik: 'NO_RECENT_TRAFFIC',
          istek7g: 0,
          log: '/l/oldapp',
          tur: 'WEB_APP',
        },
      ],
      engel: null,
    },
  ],
  imza: 'a'.repeat(32),
  kontrol: null,
  durum: 'BEKLIYOR',
  retirementHazir: false,
  ...o,
});
const GIRDI = etiket({
  anahtar: 'GIRDI|ESKI.war|PROD|/vhosting',
  tur: 'GIRDI',
  ad: 'ESKI.war',
  gen: null,
  kok: '/vhosting',
  seviye: 'SUPHELI',
  hamSeviye: 'SUPHELI',
  kurallar: ['R4'],
  tier: [],
  kopyalar: [
    {
      host: APP,
      kurallar: ['R4'],
      kok: '/vhosting',
      tip: 'F',
      hedef: null,
      taranma: '2026-11-06T02:00:00Z',
    },
  ],
  imza: 'b'.repeat(32),
});
const sonuc = (etiketler: ShRetireEtiket[], o: Partial<ShRetireSonuc> = {}): ShRetireSonuc => ({
  ok: true,
  kurallar: KURALLAR,
  etiketler: etiketler.map((e) => {
    TAM.set(e.anahtar, e);
    const { kopyalar, ...oz } = e;
    return { ...oz, kopyaSayisi: kopyalar.length };
  }),
  ozet: {
    toplam: etiketler.length,
    kesin: 1,
    supheli: 1,
    dusurulen: 0,
    bekliyor: 1,
    dogrulandi: 0,
    yanlisAlarm: 0,
    retirementHazir: 0,
  },
  ear: { okunamadi: false, hostSayisi: 1 },
  kontrolOkunamadi: false,
  ...o,
});
const HOST = (o: Partial<ShHostDetail> = {}): ShHostDetail =>
  ({
    host: APP,
    scanDate: '2026-11-06',
    fresh: true,
    products: ['JBOSS7'],
    status: 'danger',
    counts: { danger: 1, warning: 1, info: 0 },
    wallS: 1,
    cpuS: 0.1,
    vhosts: [],
    unusedIps: 0,
    topFinding: null,
    findings: [
      {
        severity: 'danger',
        area: 'jvm',
        code: 'STOPPED_AUTOSTART_ON',
        text: "JBoss7 oldapp kapalı ama auto-start AÇIK — reboot'ta açılacak",
        fix: { action: 'jboss_autostart_off', gen: 7, jvm: 'oldapp' },
        dogrulama: {
          neden: 'N-SA',
          eksik: 'E-SA',
          kontrol: ['jboss-cli.sh --command="ls host=master/server-config=<JVM>"'],
        },
      },
      {
        severity: 'warning',
        area: 'ear',
        code: 'EAR_WAR_YOK',
        text: '/vhosting/BOS.ear: EAR içinde WAR yok',
        fix: null,
        ear: { kok: '/vhosting', ad: 'BOS.ear' },
        dogrulama: { neden: 'N-EW', eksik: 'E-EW', kontrol: ['ls -la /vhosting/<EAR>'] },
      },
    ],
    jvms: [
      {
        gen: 7,
        name: 'oldapp',
        group: 'g',
        running: false,
        autoStart: 'true',
        serverState: 'stopped',
        ports: [],
        argFark: 1,
        tier: '3',
        req24h: null,
        req7d: null,
        matchKind: null,
        vhosts: [
          {
            host: WEB,
            product: 'IHS',
            serverName: 'oldapp.bmw.local',
            req24h: 0,
            req7d: 0,
            hc24h: 1,
            sampled: false,
            trafficState: 'NO_RECENT_TRAFFIC',
          },
        ],
      },
      {
        gen: 7,
        name: 'yerel',
        group: 'g',
        running: true,
        autoStart: 'true',
        serverState: 'running',
        ports: [],
        req24h: null,
        req7d: null,
        matchKind: null,
        vhosts: [
          {
            host: APP,
            product: 'IHS',
            serverName: 'yerel.local',
            req24h: 1,
            req7d: 12,
            hc24h: 1,
            sampled: false,
            trafficState: 'ACTIVE',
          },
        ],
      },
    ],
    ear: {
      durum: 'VAR',
      taranma: '2026-11-06T02:00:00Z',
      yasGun: 0,
      uygulamalar: [
        {
          kok: '/vhosting',
          ad: 'ODEME.ear',
          jboss: '7',
          durum: 'TAM',
          warSayisi: 2,
          xml: { durum: 'VAR', jvmler: [{ ad: 'oldapp' }] },
        },
        {
          kok: '/vhosting',
          ad: 'BOS.ear',
          jboss: '7',
          durum: 'TAM',
          warSayisi: 0,
          xml: { durum: 'JVM_YOK', neden: 'TANIM_YOK' },
        },
      ],
    },
    retireAdaylari: [],
    init: [],
    jboss: [],
    web: [],
    ips: [],
    sshd: null,
    ...o,
  }) as unknown as ShHostDetail;

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  Object.values(rt).forEach((f) => f.mockReset());
  toastM.success.mockReset();
  toastM.error.mockReset();
  shOnbellek._sifirlaForTest();
  TAM.clear();
  m.retireEtiketAyrinti.mockImplementation(async (anahtar: string) =>
    TAM.has(anahtar)
      ? { ok: true, etiket: TAM.get(anahtar) }
      : { ok: false, message: 'etiket yok', _httpStatus: 409 },
  );
});

describe('RA1 yardımcılar', () => {
  it('süzgeç: yanlış alarm varsayılan gizli; seviye / tür / arama', () => {
    const ya = etiket({ anahtar: 'x', durum: 'YANLIS_ALARM' });
    const l = [etiket(), GIRDI, ya];
    expect(etiketSuz(l, BOS_SUZGEC).map((e) => e.anahtar)).toEqual([
      etiket().anahtar,
      GIRDI.anahtar,
    ]);
    expect(etiketSuz(l, { ...BOS_SUZGEC, durum: 'YANLIS_ALARM' })).toEqual([ya]);
    expect(etiketSuz(l, { ...BOS_SUZGEC, seviye: 'SUPHELI' })).toEqual([GIRDI]);
    expect(etiketSuz(l, { ...BOS_SUZGEC, tur: 'JVM', durum: 'all' })).toHaveLength(2);
    expect(etiketSuz(l, { ...BOS_SUZGEC, q: 'esk' })).toEqual([GIRDI]);
  });
  it('komut yer tutucusu, Retirement adı, JVM adı', () => {
    expect(komutDoldur('a <JVM> b <EAR> c <X>', { JVM: 'j1' })).toBe('a j1 b <EAR> c <X>');
    expect(retirementUygulamasi({ tur: 'EAR', ad: 'ODEME.EAR' })).toBe('ODEME');
    expect(retirementUygulamasi({ tur: 'JVM', ad: 'oldapp' })).toBe('oldapp');
    expect(retirementUygulamasi({ tur: 'GIRDI', ad: 'x.bak' })).toBeNull();
    expect(bulgudanJvm('JBoss8 odeme çalışıyor')).toBe('odeme');
    expect(bulgudanJvm('/vhosting/X.ear: ...')).toBeNull();
  });
  it('doğrulama adımları tekil ve konuyla dolu', () => {
    const h = HOST();
    // Ayni bulgu iki kez gelse de komut bir kez yazilir.
    const a = dogrulamaAdimlari([...h.findings, h.findings[0]], [etiket()], KURALLAR, bulgudanJvm);
    expect(a.map((x) => x.baslik)).toEqual([
      'STOPPED_AUTOSTART_ON',
      'EAR_WAR_YOK',
      'R1 · Kapalı + auto-start açık + trafik yok',
    ]);
    expect(a[0].komutlar).toEqual(['jboss-cli.sh --command="ls host=master/server-config=oldapp"']);
    expect(a[1].komutlar).toEqual(['ls -la /vhosting/BOS.ear']);
    expect(a[2].komutlar).toEqual([
      'jboss-cli.sh --command="ls host=master/server-config=oldapp"',
      'zgrep x /l/oldapp*',
    ]);
  });
  it('zincir: ayrı web / aynı sunucu / eşlenemedi; bağsız EAR', () => {
    const z = zincirKartlari(HOST());
    expect(z.kartlar.map((k) => [k.jvm.name, k.katman, k.earlar.map((u) => u.ad)])).toEqual([
      ['oldapp', 'ayri-web', ['ODEME.ear']],
      ['yerel', 'ayni-sunucu', []],
    ]);
    expect(z.bagsizEarlar.map((u) => u.ad)).toEqual(['BOS.ear']);
    const es = zincirKartlari(
      HOST({ jvms: [{ ...HOST().jvms[0], vhosts: [] }], ear: { durum: 'ESKI', yasGun: 50 } }),
    );
    expect(es.kartlar[0].katman).toBe('eslenemedi');
    expect(es.bagsizEarlar).toEqual([]); // eski EAR verisi zincire girmez
  });
  it('EAR durumu "temiz" demez; yeşil yalnız doğrulandı', () => {
    for (const e of [null, { durum: 'YOK' as const }, { durum: 'OKUNAMADI' as const }])
      expect(earDurumMetni(e)).toMatch(/“temiz” demek değil/);
    expect(earDurumMetni({ durum: 'ESKI', yasGun: 40 })).toMatch(/eski \(40 gün\)/);
    const yesil = [...Object.entries(KONTROL_DURUM), ...Object.entries(ETIKET_SEVIYE)]
      .filter(([, b]) => b.ton === 'iyi')
      .map(([k]) => k);
    expect(yesil).toEqual(['DOGRULANDI']);
  });
});

describe('RA2 etiket listesi', () => {
  it('satır açılır: komutlar dolu; Retirement düğmesi yalnız KESİN + DOĞRULANDI', async () => {
    const onR = vi.fn();
    const hazir = etiket({
      durum: 'DOGRULANDI',
      retirementHazir: true,
      kontrol: {
        sonuc: 'DOGRULANDI',
        aciklama: 'CMDB kapalı',
        isaretleyen: 'ayse',
        zaman: '2026-11-06T09:00:00Z',
      },
    });
    const { rerender } = render(
      <RetireEtiketleriGorunum
        veri={sonuc([etiket(), GIRDI])}
        yukleniyor={false}
        onYenile={vi.fn()}
        onRetirementAc={onR}
      />,
    );
    const liste = screen.getByTestId('retire-etiketleri');
    expect(within(liste).getAllByRole('row')).toHaveLength(3);
    fireEvent.click(within(liste).getByText('oldapp (JBoss 7)'));
    const d = await screen.findByTestId('etiket-ayrinti');
    expect(
      within(d).getByText('jboss-cli.sh --command="ls host=master/server-config=oldapp"'),
    ).toBeInTheDocument();
    expect(within(d).getByText('zgrep x /l/oldapp*')).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: /Retirement kaydı aç/ })).toBeNull();
    expect(within(d).getByText(/elle “doğrulandı” işaretlenince açılabilir/)).toBeInTheDocument();
    rerender(
      <RetireEtiketleriGorunum
        veri={sonuc([hazir, GIRDI])}
        yukleniyor={false}
        onYenile={vi.fn()}
        onRetirementAc={onR}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retirement kaydı aç (oldapp)' }));
    expect(onR).toHaveBeenCalledWith(
      'oldapp',
      expect.stringContaining('ayse doğruladı — CMDB kapalı'),
    );
  });
  it('düşme nedenleri; kök girdisi Retirement konusu değil; envanter okunamadı bandı', async () => {
    const dusen = etiket({ seviye: 'SUPHELI', nedenler: ['GBCJAP02: eşlenik kopya çalışıyor'] });
    const kesinGirdi = {
      ...GIRDI,
      seviye: 'KESIN' as const,
      durum: 'DOGRULANDI' as const,
      retirementHazir: true,
    };
    render(
      <RetireEtiketleriGorunum
        veri={sonuc([dusen, kesinGirdi], {
          ear: { okunamadi: true, hata: 'kolon yok', hostSayisi: 0 },
        })}
        yukleniyor={false}
        onYenile={vi.fn()}
        onRetirementAc={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Uygulama Envanteri okunamadı: EAR ve kök girdisi etiketleri listede YOK/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('oldapp (JBoss 7)'));
    expect(await screen.findByText('Kural “kesin” diyor ama şüpheliye indi:')).toBeInTheDocument();
    fireEvent.click(screen.getByText('/vhosting/ESKI.war'));
    expect(
      await screen.findByText('Kök girdisi Retirement akışının konusu değil; elle temizlenir.'),
    ).toBeInTheDocument();
  });
});

describe('RA2b özet liste + ayrıntı', () => {
  it('liste kopya taşımaz; açılan satır ayrıntıyı çeker; etiket yoksa (409) liste yenilenir', async () => {
    const onY = vi.fn();
    const v = sonuc([etiket()]);
    expect(v.etiketler[0]).not.toHaveProperty('kopyalar');
    expect(v.etiketler[0].kopyaSayisi).toBe(1);
    const { unmount } = render(
      <RetireEtiketleriGorunum veri={v} yukleniyor={false} onYenile={onY} />,
    );
    fireEvent.click(screen.getByText('oldapp (JBoss 7)'));
    const d = await screen.findByTestId('etiket-ayrinti');
    expect(await within(d).findByText(/oldapp\.bmw\.local/)).toBeInTheDocument();
    expect(m.retireEtiketAyrinti).toHaveBeenCalledWith('JVM|OLDAPP|PROD|7');
    unmount();
    TAM.clear();
    render(<RetireEtiketleriGorunum veri={v} yukleniyor={false} onYenile={onY} />);
    fireEvent.click(screen.getByText('oldapp (JBoss 7)'));
    expect(await screen.findByText('Eşlenik kopyalar okunamadı')).toBeInTheDocument();
    expect(onY).toHaveBeenCalledWith(false);
  });
});

describe('RA3 manuel kontrol', () => {
  it('not zorunlu; imza gider; başarıda yenilenir', async () => {
    const onD = vi.fn();
    m.retireKontrol.mockResolvedValue({ ok: true, etiket: null });
    render(<KontrolFormu e={etiket()} onDegisti={onD} />);
    const kaydet = screen.getByRole('button', { name: 'Kaydet' });
    fireEvent.change(screen.getByLabelText('Kontrol notu'), { target: { value: 'kısa' } });
    expect(kaydet).toBeDisabled();
    fireEvent.click(screen.getByLabelText('yanlış alarm'));
    fireEvent.change(screen.getByLabelText('Kontrol notu'), {
      target: { value: 'MQ ile tetikleniyor' },
    });
    fireEvent.click(kaydet);
    await waitFor(() => expect(onD).toHaveBeenCalled());
    expect(m.retireKontrol).toHaveBeenCalledWith({
      anahtar: 'JVM|OLDAPP|PROD|7',
      sonuc: 'YANLIS_ALARM',
      aciklama: 'MQ ile tetikleniyor',
      imza: 'a'.repeat(32),
    });
  });
  it('409: hata gösterilir ve liste yenilenir; başka hata yenilemez', async () => {
    const onD = vi.fn();
    m.retireKontrol.mockResolvedValueOnce({
      ok: false,
      message: 'kanıt değişti',
      _httpStatus: 409,
    });
    render(<KontrolFormu e={etiket()} onDegisti={onD} />);
    fireEvent.change(screen.getByLabelText('Kontrol notu'), { target: { value: 'CMDB kapalı' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('kanıt değişti'));
    expect(onD).toHaveBeenCalledTimes(1);
    m.retireKontrol.mockResolvedValueOnce({ ok: false, message: 'kısa not', _httpStatus: 400 });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(toastM.error).toHaveBeenCalledWith('kısa not'));
    expect(onD).toHaveBeenCalledTimes(1);
  });
  it('kayıtlar okunamazken form yok; mevcut karar geri alınır', async () => {
    const { unmount } = render(
      <KontrolFormu e={etiket({ durum: 'BILINMIYOR' })} onDegisti={vi.fn()} />,
    );
    expect(screen.queryByLabelText('Kontrol notu')).toBeNull();
    expect(screen.getByText(/Şimdi kayıt yazılamaz/)).toBeInTheDocument();
    unmount();
    m.retireKontrol.mockResolvedValue({ ok: true });
    const e = etiket({
      durum: 'VERI_DEGISTI',
      kontrol: { sonuc: 'DOGRULANDI', aciklama: 'eski not', isaretleyen: 'ayse', zaman: null },
    });
    render(<KontrolFormu e={e} onDegisti={vi.fn()} />);
    expect(screen.getByText(/önceki karar:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'geri al' }));
    await waitFor(() =>
      expect(m.retireKontrol).toHaveBeenCalledWith(
        expect.objectContaining({ sonuc: 'GERI_AL', aciklama: '' }),
      ),
    );
  });
});

describe('RA4 sunucu paneli', () => {
  it('yalnız "Ne yapmalı" açık; zincir, bağsız EAR, doğrulama, auto-start', async () => {
    m.host.mockResolvedValue({ ok: true, host: HOST() });
    const onAS = vi.fn();
    render(
      <SunucuPaneli
        host={APP}
        retire={sonuc([etiket()])}
        onEtiketDegisti={vi.fn()}
        onAutoStart={onAS}
      />,
    );
    const p = await screen.findByTestId('sunucu-paneli');
    expect(m.host).toHaveBeenCalledWith(APP);
    expect(screen.getByTestId('bolum-ne-yapmali')).toHaveAttribute('open');
    for (const id of ['bolum-uygulamalar', 'bolum-bulgular', 'bolum-etiketler', 'bolum-dogrulama'])
      expect(screen.getByTestId(id)).not.toHaveAttribute('open');
    const ne = screen.getByTestId('bolum-ne-yapmali');
    expect(within(ne).getByText(/Uygulama Envanteri: bugün tarandı/)).toBeInTheDocument();
    fireEvent.click(within(ne).getByRole('button', { name: 'oldapp: auto-start KAPAT' }));
    expect(onAS).toHaveBeenCalledWith({
      host: APP,
      code: 'STOPPED_AUTOSTART_ON',
      fix: { action: 'jboss_autostart_off', gen: 7, jvm: 'oldapp' },
    });
    const kartlar = within(p).getAllByTestId('zincir-karti');
    expect(within(kartlar[0]).getByText('parametre farkı var')).toBeInTheDocument();
    expect(
      within(kartlar[0]).getByText(/\/vhosting\/ODEME\.ear \(2 WAR, TAM\)/),
    ).toBeInTheDocument();
    expect(within(kartlar[0]).getByText(/Web \(ayrı web sunucusu\)/)).toBeInTheDocument();
    expect(kartlar[0].textContent).toContain(
      `${WEB}/oldapp.bmw.local → NO_RECENT_TRAFFIC (0 / 7 gün)`,
    );
    expect(within(kartlar[1]).getByText(/Web \(aynı sunucu\)/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId('bolum-uygulamalar')).getByText(
        /\/vhosting\/BOS\.ear — 0 WAR · JVM yok \(TANIM_YOK\)/,
      ),
    ).toBeInTheDocument();
    const dg = screen.getByTestId('bolum-dogrulama');
    expect(
      within(dg).getAllByText('jboss-cli.sh --command="ls host=master/server-config=oldapp"')
        .length,
    ).toBeGreaterThan(0);
    expect(within(dg).getByText('ls -la /vhosting/BOS.ear')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('bolum-etiketler')).getByText('oldapp (JBoss 7)'),
    ).toBeInTheDocument();
    // Kapali etiket ayrinti indirmez; acilinca bir kez indirir.
    expect(m.retireEtiketAyrinti).not.toHaveBeenCalled();
    const et = screen
      .getByTestId('bolum-etiketler')
      .querySelector('details details') as HTMLDetailsElement;
    et.open = true;
    fireEvent(et, new Event('toggle'));
    await waitFor(() => expect(m.retireEtiketAyrinti).toHaveBeenCalledTimes(1));
    expect(await within(et).findByTestId('etiket-ayrinti')).toBeInTheDocument();
  });
  it('eski EAR verisi söylenir; okunamazsa LoadError', async () => {
    m.host.mockResolvedValueOnce({
      ok: true,
      host: HOST({ ear: { durum: 'ESKI', yasGun: 50 }, findings: [] }),
    });
    const { unmount } = render(
      <SunucuPaneli host={APP} retire={sonuc([])} onEtiketDegisti={vi.fn()} />,
    );
    expect(await screen.findByText(/taraması eski \(50 gün\)/)).toBeInTheDocument();
    unmount();
    m.host.mockResolvedValueOnce({ ok: false, message: 'tarama verisi yok' });
    render(<SunucuPaneli host={APP} retire={null} onEtiketDegisti={vi.fn()} />);
    expect(await screen.findByText(`${APP} ayrıntısı okunamadı`)).toBeInTheDocument();
  });
});

describe('RA5 Bulgular', () => {
  it('sunucuya tıklayınca panel açılır / kapanır; etiket görünümü ayrı', async () => {
    m.findings.mockResolvedValue({
      ok: true,
      tableMissing: false,
      latestScan: '2026-11-06',
      findings: [
        {
          host: APP,
          products: ['JBOSS7'],
          env: 'PROD',
          envGroup: 'Production',
          scanDate: '2026-11-06',
          severity: 'danger',
          area: 'jvm',
          code: 'STOPPED_AUTOSTART_ON',
          text: 'JBoss7 oldapp kapalı',
          fixable: true,
          fix: { action: 'jboss_autostart_off', gen: 7, jvm: 'oldapp' },
        },
      ],
    });
    m.host.mockResolvedValue({ ok: true, host: HOST() });
    m.retireEtiketleri.mockResolvedValue(sonuc([etiket(), GIRDI]));
    render(<FindingsTab />);
    const dugme = await screen.findByRole('button', { name: `▸ ${APP}` });
    fireEvent.click(dugme);
    expect(await screen.findByTestId('sunucu-paneli')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `▾ ${APP}` })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await waitFor(() => expect(m.retireEtiketleri).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: `▾ ${APP}` }));
    expect(screen.queryByTestId('sunucu-paneli')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Retirement etiketleri \(2\)/ }));
    expect(await screen.findByTestId('retire-etiketleri')).toBeInTheDocument();
    expect(screen.queryByText('JBoss7 oldapp kapalı')).toBeNull();
    expect(m.retireEtiketleri).toHaveBeenCalledTimes(1);
  });
});

describe('RA6 Kurallar', () => {
  const kv = (): ShKurallar => ({
    ok: true,
    okunamadi: false,
    taramaTarihi: '2026-11-06',
    sayimOlculdu: true,
    alanlar: { ear: 'Uygulama (EAR)' },
    maddeler: [
      {
        id: 'ear-war',
        alan: 'ear',
        alanAd: 'Uygulama (EAR)',
        ad: 'EAR içeriği (WAR)',
        neTaranir: 'x',
        ciktilar: [
          {
            kod: 'EAR_WAR_YOK',
            kosul: 'WAR yok',
            varsayilan: 'warning',
            gecerli: 'warning',
            bulgu: 1,
            sunucu: 1,
            dogrulama: { neden: 'N-EW', eksik: 'E-EW', kontrol: ['ls -la /vhosting/<EAR>'] },
          },
          { kod: null, kosul: 'ok', varsayilan: 'ok', gecerli: 'ok' },
        ],
      },
    ],
    limitler: [],
    etiketKurallari: [
      { ...KURALLAR[1], kural: 'R2', ad: 'Kapalı + auto-start kapalı + trafik var', tur: 'JVM' },
    ],
    kokYoksay: {
      gecerli: ['scripts', 'tmp'],
      varsayilan: ['scripts', 'tmp'],
      degistiren: null,
      zaman: null,
      not: '',
    },
    gecmis: [],
  });
  it('etiket seviyesi gerekçesiz kaydedilmez; yok sayma listesi kaydedilir; doğrulama görünür', async () => {
    m.kurallar.mockResolvedValue(kv());
    m.etiketSeviyesi.mockResolvedValue({ ok: true });
    m.kokYoksay.mockResolvedValue({ ok: true });
    render(<KurallarTab />);
    const b = await screen.findByLabelText('Retirement etiket kuralları');
    fireEvent.change(within(b).getByLabelText('R2 etiketi'), { target: { value: 'KESIN' } });
    const kaydet = within(b).getByRole('button', { name: 'Kaydet' });
    expect(kaydet).toBeDisabled();
    fireEvent.change(within(b).getByLabelText('R2 değişiklik gerekçesi'), {
      target: { value: 'PROD trafik testi' },
    });
    fireEvent.click(kaydet);
    await waitFor(() =>
      expect(m.etiketSeviyesi).toHaveBeenCalledWith('R2', 'KESIN', 'PROD trafik testi'),
    );
    const y = screen.getByLabelText('Kökte yok sayılan girdiler');
    fireEvent.change(within(y).getByLabelText('Yok sayılan girdi adları (virgülle)'), {
      target: { value: 'scripts, tmp\nyedek' },
    });
    const yk = within(y).getByRole('button', { name: 'Kaydet (3 ad)' });
    expect(yk).toBeDisabled();
    fireEvent.change(within(y).getByLabelText('Yok sayma listesi gerekçesi'), {
      target: { value: 'yedek klasörü' },
    });
    fireEvent.click(yk);
    await waitFor(() =>
      expect(m.kokYoksay).toHaveBeenCalledWith(['scripts', 'tmp', 'yedek'], 'yedek klasörü'),
    );
    expect(screen.getByText('nasıl doğrulanır?')).toBeInTheDocument();
  });
});

describe('RA7 Retirement öneri', () => {
  it('etiketten gelen öneri formu uygulama adı ve notla açar, keşif başlar', async () => {
    rt.list.mockResolvedValue({ ok: true, records: [] });
    rt.config.mockResolvedValue({ ok: false });
    rt.discover.mockResolvedValue({
      ok: true,
      base: 'oldapp',
      targets: [],
      summary: {
        total: 0,
        bySite: { Pendik: 0, Ankara: 0 },
        byEnv: {},
        webMatched: 0,
        prod: false,
      },
    });
    rt.apps.mockResolvedValue({ ok: true, apps: [] });
    render(
      <RetirementTab
        oneri={{ uygulama: 'oldapp', not: 'Server Hub etiketi: ayse doğruladı', no: 1 }}
      />,
    );
    await waitFor(() => expect(rt.discover).toHaveBeenCalledWith('oldapp'));
    expect(screen.getByLabelText('Not')).toHaveValue('Server Hub etiketi: ayse doğruladı');
  });
});

describe('RA8 Faz 2 deployment satırı', () => {
  const dep = (jvmler: unknown[]) =>
    HOST({ ear: { ...HOST().ear!, deployment: { kesik: false, jvmler } } as ShHostDetail['ear'] });
  const J = (o: object = {}) => ({
    name: 'yerel',
    gen: 7,
    running: true,
    runningKnown: true,
    ...o,
  });
  const D = (ad: string, durum: string, deploymentlar: unknown = null) => ({
    nesil: '7',
    ad,
    durum,
    rc: 0,
    hata: null,
    deploymentlar,
  });
  it('durumlar ve tonlar; yeşil yok', () => {
    expect(deploymentMetni(HOST(), J())).toEqual({
      metin: expect.stringMatching(/kontrol kapalı/),
      ton: 'notr',
    });
    expect(deploymentMetni(dep([]), J({ running: false })).metin).toMatch(/JVM kapalı/);
    expect(deploymentMetni(dep([]), J()).metin).toMatch(/ölçülmedi/);
    expect(deploymentMetni(dep([D('yerel', 'OK', [])]), J())).toEqual({
      metin: 'hiçbir deployment yok',
      ton: 'kotu',
    });
    expect(
      deploymentMetni(
        dep([
          D('yerel', 'OK', [
            { ad: 'A.ear', calisma_adi: 'A.ear', etkin: true, durum: 'OK' },
            { ad: 'B.ear', calisma_adi: null, etkin: false, durum: 'FAILED' },
          ]),
        ]),
        J(),
      ),
    ).toEqual({ metin: 'A.ear OK · B.ear FAILED (devre dışı)', ton: 'kotu' });
    expect(deploymentMetni(dep([D('yerel', 'CLI_YOK')]), J())).toEqual({
      metin: 'ölçülemedi (CLI_YOK)',
      ton: 'uyari',
    });
    expect(
      deploymentMetni(dep([{ ...D('yerel', 'OK', []), nesil: '8' }]), J()).metin,
      'nesil ayrimi',
    ).toMatch(/ölçülmedi/);
  });
  it('panelde JVM kartında görünür', async () => {
    m.host.mockResolvedValue({
      ok: true,
      host: dep([
        D('yerel', 'OK', [{ ad: 'YEREL.ear', calisma_adi: 'YEREL.ear', etkin: true, durum: 'OK' }]),
      ]),
    });
    render(<SunucuPaneli host={APP} retire={sonuc([])} onEtiketDegisti={vi.fn()} />);
    const satirlar = await screen.findAllByTestId('deployment-satiri');
    expect(satirlar.map((x) => x.textContent)).toEqual([
      'Deployment (JBoss CLI): JVM kapalı — deployment okunmaz',
      'Deployment (JBoss CLI): YEREL.ear OK',
    ]);
  });
});
