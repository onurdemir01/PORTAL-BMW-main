// @vitest-environment jsdom
// Denetim › Init / Deployment script sapmasi (2026-11-27, kapsam PR-2; DenetimPage ScriptsAudit dal dusuk).
// Sunucu geneli bolum (appdomain.service) InitSunucuGeneli testinde.
//   DS1 script bazli: ozet, referans cipi, surum rozetleri, sapan / yok sutunlari, acilan satir (surumler,
//       bayt bicimleri, CRLF, okunamayan, "dosya yok" listesi)
//   DS2 sunucu bazli: siralama, rozetler, startCustom sutunu, 500 satir siniri; arama ve "sadece farki olanlar"
//   DS3 CSV: script ve sunucu gorunumu, init ve deployment basliklari
//   DS4 kok secimi, Yenile, genel / ozel envanter, bicim / CRLF ozeti, eksik sutun, bos tarama mesaji
//   DS5 okunamadi: kok degisince veri gelmezse kok secimi ve Yenile ekranda kalir, geri donulur
//   DS6 verinin yasi: taze, saatler, eski, bilinmiyor; referans kaynagi ve ayrinti tablosu
//   DS7 deployment: tarama gunu, kaynak job, startCustom sutunu yok, "Cogunluk" basligi
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import DenetimPage from '@/components/DenetimPage';
import type { InitScriptHostRow, InitScriptsResult, InitScriptStat } from '@/api/denetimApi';

const api = vi.hoisted(() => ({ init: vi.fn(), deploy: vi.fn(), csv: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ canSee: () => true }) }));
vi.mock('@/api/denetimApi', async (orig) => {
  const gercek = (await orig()) as Record<string, unknown>;
  return {
    ...gercek,
    denetimApi: {
      ...(gercek.denetimApi as object),
      initScripts: api.init,
      deployScripts: api.deploy,
    },
  };
});
vi.mock('@/utils/csv', async (orig) => ({
  ...((await orig()) as object),
  downloadCsv: api.csv,
}));

const H = (c: string) => c.repeat(128);
const sunucular = (onek: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${onek}${String(i + 1).padStart(2, '0')}`);
const betik = (
  o: Partial<InitScriptStat> & Pick<InitScriptStat, 'key' | 'label'>,
): InitScriptStat => ({
  perServer: false,
  present: 10,
  missing: 0,
  missingHosts: [],
  variantCount: 1,
  majorityHash: H('a'),
  majorityCount: 10,
  deviatingCount: 0,
  variants: [{ hash: H('a'), count: 10, hosts: sunucular('ORWASP', 10) }],
  ...o,
});
const satir = (host: string, o: Partial<InitScriptHostRow> = {}): InitScriptHostRow => ({
  host,
  deviations: [],
  deviationCount: 0,
  missing: [],
  missingCount: 0,
  hasCustom: false,
  customHash: null,
  ...o,
});

const BETIKLER: InitScriptStat[] = [
  // ekip surumu referans; iki icerik surumu, referansin iki bayt bicimi; CRLF ve okunamayan
  betik({
    key: 'start_sh',
    label: 'start.sh',
    variantCount: 2,
    referenceSource: 'ekip',
    referenceHash: H('e'),
    referenceCount: 41,
    deviatingCount: 3,
    formatOnlyCount: 2,
    crlfCount: 1,
    crlfHosts: ['ORWASP07'],
    unreadable: 1,
    unreadableHosts: ['ORWASP09'],
    missing: 45,
    missingHosts: sunucular('ORWAST', 45),
    variants: [
      {
        hash: H('e'),
        count: 41,
        hosts: sunucular('ORWASP', 41),
        isReference: true,
        rawVariants: [
          { hash: H('1'), count: 39, hosts: sunucular('ORWASP', 13) },
          { hash: H('2'), count: 2, hosts: ['ORWASP40', 'ORWASP41'] },
        ],
      },
      {
        hash: H('f'),
        count: 3,
        hosts: ['ORWASP42', 'ORWASP43', 'ORWASP44'],
        isReference: false,
        rawVariants: [
          { hash: H('3'), count: 2, hosts: ['ORWASP42', 'ORWASP43'] },
          { hash: H('4'), count: 1, hosts: ['ORWASP44'] },
        ],
      },
    ],
  }),
  // tek surum ama referans degil: tum filo sapiyor
  betik({ key: 'stop_sh', label: 'stop.sh', referenceSource: 'cogunluk', deviatingCount: 10 }),
  // farkla ilgisi olmayan, referans kaynagi bilinmeyen betik ("sadece farki olanlar"da gizlenir)
  betik({ key: 'env_sh', label: 'env.sh', majorityCount: 10 }),
  // 5 surum (kirmizi), eski yanit: isReference yok, ilk surum cogunluk
  betik({
    key: 'jvm_sh',
    label: 'jvm.sh',
    variantCount: 5,
    deviatingCount: 4,
    variants: [
      { hash: H('a'), count: 6, hosts: ['ORWASP01'] },
      { hash: H('b'), count: 4, hosts: ['ORWASP02'] },
    ],
  }),
  // sunucuya ozel
  betik({
    key: 'startCustom_sh',
    label: 'startCustom.sh',
    perServer: true,
    variantCount: 3,
    majorityHash: null,
    referenceSource: 'ekip',
    referenceHash: H('9'),
    formatOnlyCount: 5,
    variants: [
      {
        hash: H('c'),
        count: 1,
        hosts: ['ORWASP01'],
        rawVariants: [
          { hash: H('5'), count: 1, hosts: ['ORWASP01'] },
          { hash: H('6'), count: 1, hosts: ['ORWASP03'] },
        ],
      },
      { hash: H('d'), count: 1, hosts: ['ORWASP02'] },
    ],
  }),
  // tek surumlu sunucuya ozel ve yalniz CRLF'li betik: "sadece farki olanlar"da GORUNUR
  betik({ key: 'ozel_tek', label: 'ozel_tek.sh', perServer: true }),
  betik({ key: 'satir_sh', label: 'satir.sh', crlfCount: 1, crlfHosts: ['ORWASP05'] }),
  // hic yok
  betik({
    key: 'yeni_sh',
    label: 'yeni.sh',
    variantCount: 0,
    majorityHash: null,
    majorityCount: 0,
    present: 0,
    missing: 2,
    missingHosts: ['ORWASP01', 'ORWASP02'],
    variants: [],
  }),
];
const SATIRLAR: InitScriptHostRow[] = [
  satir('ORWASP03', { hasCustom: true, customHash: H('c') }),
  satir('ORWASP02', {
    deviations: ['start.sh', 'jvm.sh'],
    deviationCount: 2,
    crlf: ['start.sh'],
    crlfCount: 1,
    hasCustom: true,
    customHash: H('d'),
  }),
  satir('ORWASP01', {
    deviations: ['jvm.sh'],
    deviationCount: 1,
    missing: ['yeni.sh'],
    missingCount: 1,
    unreadable: ['env.sh'],
    unreadableCount: 1,
    formatOnly: ['stop.sh'],
    formatOnlyCount: 1,
  }),
  satir('ORWASP00', { deviations: ['stop.sh'], deviationCount: 1 }),
  satir('ORWASP05', { crlf: ['start.sh'], crlfCount: 1 }),
];
const yanit = (o: Partial<InitScriptsResult> = {}): InitScriptsResult => ({
  ok: true,
  root: 'vhosting',
  roots: ['vhosting', 'vhosting8'],
  hosts: 50,
  scriptCount: BETIKLER.length,
  identicalHosts: 38,
  totalVariants: 12,
  customHosts: 2,
  missingColumns: [],
  scripts: BETIKLER,
  hostRows: SATIRLAR,
  referenceSource: 'karma',
  detailAvailable: true,
  loadedAt: '2026-11-27 09:00:00',
  ageMinutes: 30,
  ageDays: 0,
  ageSource: 'load_date',
  ...o,
});

const satirlar = () => screen.getAllByRole('row').slice(1) as HTMLTableRowElement[];
const betikSatiri = (ad: string) =>
  screen.getByText(ad, { selector: 'span.font-mono' }).closest('tr')!;
const ara = () => screen.getByPlaceholderText(/script ara|sunucu ara/);
const kok = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement;

async function ac(sekme = 'init') {
  render(<DenetimPage />, { initialEntries: [`/denetim?tab=${sekme}`] });
  await screen.findByRole('button', { name: /Yenile/ });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.init.mockResolvedValue(yanit());
  api.deploy.mockResolvedValue(yanit());
});

describe('Denetim › script sapması', () => {
  it('DS1 script bazlı: özet, referans, sürüm rozetleri, sapan / yok, açılan satır', async () => {
    await ac();
    expect(api.init).toHaveBeenCalledWith('vhosting');
    expect(
      screen.getByText(/İnit script'leri \(\/vhosting\[8\]\/scripts\/initialize\)/),
    ).toBeTruthy();
    expect(screen.getByText('check_initialize', { selector: 'code' })).toBeTruthy();
    // ozet kutulari (karma referans)
    expect(screen.getByText('referansla uyumlu').previousSibling!.textContent).toBe('38');
    expect(screen.getByText("en az bir script'te farklı").previousSibling!.textContent).toBe('12');
    expect(screen.getByText('toplam farklı sürüm').previousSibling!.textContent).toBe('12');
    expect(screen.getByText('8 script')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Referans' })).toBeTruthy();

    // start.sh: ekip cipi, kirpilmis hash (tam deger title'da), referans adedi, bicim / CRLF / okunamayan
    const start = betikSatiri('start.sh');
    expect(within(start).getByText('ekip sürümü (depo)')).toBeTruthy();
    expect(within(start).getByText('eeeeeeeeee…').closest('[title]')!.getAttribute('title')).toBe(
      `${H('e')}\n(kopyalamak için tıklayın)`,
    );
    expect(within(start).getByText('· 41')).toBeTruthy();
    expect(within(start).getByText('2 sürüm')).toBeTruthy();
    expect(within(start).getByText('3').className).toContain('text-amber-700');
    expect(within(start).getByText('+2 biçim')).toBeTruthy();
    expect(within(start).getByText('1 CRLF')).toBeTruthy();
    expect(within(start).getByText('45')).toBeTruthy();
    expect(within(start).getByText('+1 okunamıyor')).toBeTruthy();
    // stop.sh: tek surum ama referans degil; cogunluk cipi
    const stop = betikSatiri('stop.sh');
    expect(within(stop).getByText('1 sürüm · referans değil').className).toContain('amber');
    expect(within(stop).getByText('çoğunluk')).toBeTruthy();
    expect(within(stop).getByText('· 10')).toBeTruthy();
    // env.sh: tek surum yesil, cip yok (referans kaynagi bilinmiyor)
    const env = betikSatiri('env.sh');
    expect(within(env).getByText('1 sürüm').className).toContain('emerald');
    expect(within(env).queryByText('çoğunluk')).toBeNull();
    expect(within(env).getAllByText('0')).toHaveLength(2);
    expect(within(betikSatiri('jvm.sh')).getByText('5 sürüm').className).toContain('red');
    // sunucuya ozel: sapan "—", cip yok, bicim farki sayilmaz
    const ozel = betikSatiri('startCustom.sh');
    expect(within(ozel).getByText('sunucuya özel')).toBeTruthy();
    expect(within(ozel).getByText('3 sürüm').className).toContain('violet');
    expect(within(ozel).getAllByText('—')).toHaveLength(1); // sapan; referans hash'i var ama cip yok
    expect(within(ozel).queryByText('ekip sürümü (depo)')).toBeNull();
    expect(within(ozel).queryByText(/biçim/)).toBeNull();
    expect(within(betikSatiri('yeni.sh')).getByText('hiç yok')).toBeTruthy();

    // satir acilir: referans + farkli surum, bayt bicimleri, CRLF, okunamayan, dosya yok
    fireEvent.click(start);
    const ayrinti = start.nextElementSibling as HTMLElement;
    expect(within(ayrinti).getByText('ekip sürümü').className).toContain('emerald');
    expect(within(ayrinti).getByText('farklı sürüm 1').className).toContain('amber');
    expect(within(ayrinti).getByText(`${'e'.repeat(32)}…`)).toBeTruthy();
    expect(within(ayrinti).getByText('41 sunucu')).toBeTruthy();
    expect(within(ayrinti).getByText(/ORWASP40 … \(\+1\)$/)).toBeTruthy(); // ilk 40 sunucu
    expect(within(ayrinti).getByText(/— referansla aynı içerik, sapma sayılmaz:/)).toBeTruthy();
    expect(
      within(ayrinti).getByText(/— içerik referanstan farklı, bu sunucular sapan sayılır:/),
    ).toBeTruthy();
    expect(within(ayrinti).getByText(/ORWASP12 … \(\+1\)$/)).toBeTruthy(); // bayt bicimi: ilk 12
    expect(within(ayrinti).getByText('39 sunucu')).toBeTruthy();
    expect(within(ayrinti).getByText('ORWASP07')).toBeTruthy();
    expect(within(ayrinti).getByText('ORWASP09')).toBeTruthy();
    expect(within(ayrinti).getByText('45 sunucu')).toBeTruthy();
    expect(within(ayrinti).queryByText(/ORWAST01/)).toBeNull();
    fireEvent.click(within(ayrinti).getByRole('button', { name: 'sunucuları göster' }));
    expect(within(ayrinti).getByText(/^ORWAST01, .*ORWAST40 … \(\+5\)$/)).toBeTruthy();
    expect(start.nextElementSibling).toBe(ayrinti); // tik satiri kapatmadi
    fireEvent.click(within(ayrinti).getByRole('button', { name: 'sunucuları gizle' }));
    expect(within(ayrinti).queryByText(/ORWAST01/)).toBeNull();
    fireEvent.click(start);
    expect(start.nextElementSibling).not.toBe(ayrinti);

    // eski yanit (isReference yok): ilk surum cogunluk
    fireEvent.click(betikSatiri('jvm.sh'));
    const jvm = betikSatiri('jvm.sh').nextElementSibling as HTMLElement;
    expect(within(jvm).getByText('çoğunluk')).toBeTruthy();
    expect(within(jvm).getByText('farklı sürüm 1')).toBeTruthy();
    // sunucuya ozel: "surum N", bayt bicimleri iki nokta ile
    fireEvent.click(betikSatiri('startCustom.sh'));
    const oz = betikSatiri('startCustom.sh').nextElementSibling as HTMLElement;
    expect(within(oz).getByText('sürüm 1').className).toContain('violet');
    expect(within(oz).getByText('sürüm 2')).toBeTruthy();
    expect(within(oz).getByText(/farklı bayt biçimi \(satır sonu \/ boşluk\):$/)).toBeTruthy();
  });

  it('DS2 sunucu bazlı: sıralama, rozetler, startCustom; arama ve "sadece farkı olanlar"', async () => {
    await ac();
    // script gorunumunde suzgecler
    fireEvent.change(ara(), { target: { value: 'ST' } });
    expect(screen.getByText('3 script')).toBeTruthy(); // start, stop, startCustom
    fireEvent.change(ara(), { target: { value: 'yok-boyle' } });
    expect(screen.getByText('Kayıt bulunamadı.')).toBeTruthy();
    fireEvent.change(ara(), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Sadece farkı olanlar'));
    expect(screen.getByText('7 script')).toBeTruthy();
    expect(screen.queryByText('env.sh', { selector: 'span.font-mono' })).toBeNull();
    expect(screen.getByText('ozel_tek.sh', { selector: 'span.font-mono' })).toBeTruthy();
    expect(screen.getByText('satir.sh', { selector: 'span.font-mono' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Sadece farkı olanlar'));

    fireEvent.click(screen.getByRole('button', { name: 'Sunucu bazlı' }));
    expect(ara().getAttribute('placeholder')).toBe('sunucu ara');
    expect(screen.getByText('5 sunucu')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Referanstan sapan' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'startCustom.sh' })).toBeTruthy();
    // sapma sayisi azalan, esitse ada gore
    expect(satirlar().map((r) => r.cells[0].textContent)).toEqual([
      'ORWASP02',
      'ORWASP00',
      'ORWASP01',
      'ORWASP03',
      'ORWASP05',
    ]);
    const [p02, , p01, p03, p05] = satirlar();
    expect(within(p02).getByText('start.sh · CRLF')).toBeTruthy();
    expect(
      within(p02)
        .getByText(`${'d'.repeat(10)}…`)
        .getAttribute('title'),
    ).toBe(H('d'));
    expect(within(p02).queryByText('aynı')).toBeNull();
    expect(within(p01).getByText('stop.sh · biçim')).toBeTruthy();
    expect(within(p01).getByText('yeni.sh')).toBeTruthy();
    expect(within(p01).getByText('env.sh · okunamıyor')).toBeTruthy();
    expect(within(p01).getByText('yok')).toBeTruthy();
    expect(within(p03).getByText('aynı')).toBeTruthy();
    expect(within(p03).getByText('—')).toBeTruthy();
    expect(within(p05).queryByText('aynı')).toBeNull(); // CRLF'li sunucu "ayni" degil
    fireEvent.click(screen.getByLabelText('Sadece farkı olanlar'));
    expect(screen.getByText('4 sunucu')).toBeTruthy();
    expect(screen.queryByText('ORWASP03')).toBeNull();
    fireEvent.change(ara(), { target: { value: 'p0' } });
    expect(screen.getByText('4 sunucu')).toBeTruthy();
    fireEvent.change(ara(), { target: { value: 'wasp05' } });
    expect(satirlar().map((r) => r.cells[0].textContent)).toEqual(['ORWASP05']);
  });

  it('DS2b sunucu bazlı 500 satır sınırı; startCustom yoksa sütun yok', async () => {
    api.init.mockResolvedValue(
      yanit({
        scripts: [betik({ key: 'a', label: 'a.sh' })],
        hostRows: sunucular('ORWASQ', 99)
          .concat(
            sunucular('ORWASR', 99),
            sunucular('ORWASS', 99),
            sunucular('ORWAST', 99),
            sunucular('ORWASU', 99),
            sunucular('ORWASV', 9),
          )
          .map((h) => satir(h)),
        referenceSource: 'cogunluk',
      }),
    );
    await ac();
    fireEvent.click(screen.getByRole('button', { name: 'Sunucu bazlı' }));
    expect(screen.getByText('504 sunucu')).toBeTruthy();
    expect(satirlar()).toHaveLength(500);
    expect(screen.getByText(/İlk 500 satır gösteriliyor/)).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'startCustom.sh' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Çoğunluktan sapan' })).toBeTruthy();
    fireEvent.change(ara(), { target: { value: 'ORWASV' } });
    expect(screen.queryByText(/İlk 500 satır/)).toBeNull();
  });

  it('DS3 CSV: script ve sunucu görünümü', async () => {
    await ac();
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    const [ad, basliklar, satirlar_] = api.csv.mock.calls[0];
    expect(ad).toBe('init_script_sapma_vhosting');
    expect(basliklar).toEqual([
      'script',
      'sunucuya_ozel',
      'surum_sayisi',
      'cogunluk_hash',
      'cogunluk_adet',
      'sapan_adet',
      'eksik_adet',
      'referans_kaynak',
      'referans_hash',
      'bicim_farki_adet',
      'crlf_adet',
      'okunamayan_adet',
    ]);
    expect(satirlar_[0]).toEqual([
      'start.sh',
      'HAYIR',
      2,
      'a'.repeat(16),
      10,
      3,
      45,
      'ekip',
      'e'.repeat(16),
      2,
      1,
      1,
    ]);
    expect(satirlar_[4]).toEqual([
      'startCustom.sh',
      'EVET',
      3,
      '',
      10,
      0,
      0,
      'ekip',
      '9'.repeat(16),
      5,
      0,
      0,
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Sunucu bazlı' }));
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    const [ad2, b2, s2] = api.csv.mock.calls[1];
    expect(ad2).toBe('init_sunucu_sapma_vhosting');
    expect(b2).toEqual([
      'host',
      'sapma_adedi',
      'sapan_scriptler',
      'eksik_adedi',
      'eksik_scriptler',
      'startCustom_var',
      'bicim_farki',
      'crlf',
      'okunamayan',
    ]);
    expect(s2[0]).toEqual(['ORWASP02', 2, 'start.sh jvm.sh', 0, '', 'EVET', '', 'start.sh', '']);
    expect(s2[2]).toEqual([
      'ORWASP01',
      1,
      'jvm.sh',
      1,
      'yeni.sh',
      'HAYIR',
      'stop.sh',
      '',
      'env.sh',
    ]);
  });

  it('DS4 kök seçimi, Yenile, genel / özel envanter, biçim özeti, eksik sütun', async () => {
    api.init.mockResolvedValue(
      yanit({
        formatOnlyHosts: 1234,
        crlfHosts: 2,
        missingColumns: ['jvm.sh', 'yeni.sh'],
        special: {
          hosts: 4,
          scriptCount: 1,
          identicalHosts: 1,
          totalVariants: 2,
          customHosts: 0,
          formatOnlyHosts: 0,
          crlfHosts: 0,
          scripts: [betik({ key: 'o', label: 'ozel.sh' })],
          hostRows: [satir('OREVMP01')],
          referenceSource: 'ekip',
        },
      }),
    );
    await ac();
    expect(screen.getByText('1.234 sunucuda yalnız biçim farkı (sapma sayılmaz)')).toBeTruthy();
    expect(screen.getByText("2 sunucuda CRLF'li betik")).toBeTruthy();
    expect(screen.getByText('jvm.sh, yeni.sh')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '…EVM / …PRV · 4' }));
    expect(screen.getByText('ekip sürümüyle uyumlu').previousSibling!.textContent).toBe('1');
    expect(screen.getByText("en az bir script'te farklı").previousSibling!.textContent).toBe('3');
    expect(screen.getByText('1 script')).toBeTruthy();
    expect(screen.queryByText(/sunucuda yalnız biçim farkı/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Genel envanter · 50' }));
    expect(screen.getByText('8 script')).toBeTruthy();
    // kok degisimi ve Yenile ayni ucu yeniden cagirir
    expect([...kok().options].map((o) => o.textContent)).toEqual(['/vhosting', '/vhosting8']);
    fireEvent.change(kok(), { target: { value: 'vhosting8' } });
    await waitFor(() => expect(api.init).toHaveBeenLastCalledWith('vhosting8'));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    await waitFor(() => expect(api.init).toHaveBeenCalledTimes(3));
    expect(api.init).toHaveBeenLastCalledWith('vhosting8');
  });

  it('DS4b boş tarama mesajı ve çoğunluk referansı', async () => {
    api.init.mockResolvedValue(
      yanit({
        hosts: 0,
        identicalHosts: 0,
        scripts: [],
        hostRows: [],
        message: 'Tablo boş: job henüz çalışmadı.',
        referenceSource: 'cogunluk',
      }),
    );
    await ac();
    expect(screen.getByText('Tablo boş: job henüz çalışmadı.')).toBeTruthy();
    expect(screen.getByText('çoğunlukla birebir aynı')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Çoğunluk' })).toBeTruthy();
  });

  it('DS5 okunamadı: kök seçimi ve Yenile ekranda kalır, önceki köke dönülür', async () => {
    await ac();
    api.init.mockResolvedValueOnce({ ok: false, message: '/vhosting8 tablosu okunamadı' } as never);
    fireEvent.change(kok(), { target: { value: 'vhosting8' } });
    const hata = await screen.findByTestId('script-sapma-hata');
    expect(hata.textContent).toContain('/vhosting8 tablosu okunamadı');
    // onceki kokun tablosu yeni kokun altinda gosterilmez
    expect(screen.queryByText('start.sh', { selector: 'span.font-mono' })).toBeNull();
    expect(screen.queryByText('referansla uyumlu')).toBeNull();
    expect(kok().value).toBe('vhosting8');
    // Tekrar dene SECILI koku okur; yine duserse hata kalir
    api.init.mockRejectedValueOnce(new Error('hala okunamadı'));
    fireEvent.click(within(hata).getByRole('button', { name: 'Tekrar dene' }));
    await waitFor(() =>
      expect(screen.getByTestId('script-sapma-hata').textContent).toContain('hala okunamadı'),
    );
    expect(api.init).toHaveBeenLastCalledWith('vhosting8');
    fireEvent.change(kok(), { target: { value: 'vhosting' } });
    expect(await screen.findByText('start.sh', { selector: 'span.font-mono' })).toBeTruthy();
    expect(screen.queryByTestId('script-sapma-hata')).toBeNull();
    // Yenile duserse: Tekrar dene ayni koku okur
    api.init.mockRejectedValueOnce(new Error('ağ yok'));
    fireEvent.click(screen.getByRole('button', { name: /Yenile/ }));
    const h2 = await screen.findByTestId('script-sapma-hata');
    expect(h2.textContent).toContain('ağ yok');
    fireEvent.click(within(h2).getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('start.sh', { selector: 'span.font-mono' })).toBeTruthy();
    expect(api.init).toHaveBeenLastCalledWith('vhosting');
  });

  it('DS5b ilk okuma düşerse hata ve Tekrar dene; mesajsız red', async () => {
    api.init.mockResolvedValueOnce({ ok: false } as never);
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    const hata = await screen.findByTestId('script-sapma-hata');
    expect(hata.textContent).toContain('Veri alınamadı.');
    expect([...kok().options].map((o) => o.textContent)).toEqual(['/vhosting']);
    fireEvent.click(within(hata).getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByText('start.sh', { selector: 'span.font-mono' })).toBeTruthy();
  });

  it.each([
    [{ ageDays: 0, ageMinutes: 30 }, /Veri az önce yüklendi/, false],
    [{ ageDays: 0, ageMinutes: 300 }, /Veri 5 saat önce yüklendi/, false],
    [{ ageDays: 1, ageMinutes: 1500 }, /Veri 1 gün önce yüklendi/, false],
    [
      { ageDays: 3, ageMinutes: 4400 },
      /Veri 3 gün önce yüklendi — check_initialize işi çalışmıyor olabilir\./,
      true,
    ],
    [{ ageDays: 3, ageMinutes: null }, /Veri 3 gün önce yüklendi — /, true],
    // gun 2 ama dakika esigi asildi (48 saatten eski): eski
    [{ ageDays: 2, ageMinutes: 2900 }, /Veri 2 gün önce yüklendi — /, true],
    [{ ageDays: 2, ageMinutes: 2800 }, /Veri 2 gün önce yüklendi \(/, false],
    // yukleme zamani yoksa yas bilinmiyor sayilir
    [{ loadedAt: null, ageDays: 1, ageMinutes: 1500 }, /Verinin yaşı bilinmiyor/, true],
    [
      { loadedAt: null, ageDays: null, ageMinutes: null, ageSource: null },
      /Verinin yaşı bilinmiyor/,
      true,
    ],
  ])('DS6 verinin yaşı %o', async (ek, metin, eski) => {
    api.init.mockResolvedValue(yanit(ek as Partial<InitScriptsResult>));
    await ac();
    // metin <b> / <code> ile bolunmus: kutuyu "Referans:" satirindan bul, metni kutunun tamamindan oku
    const kutu = screen.getByText(/^Referans:/).closest('div.rounded-xl') as HTMLElement;
    expect(kutu.textContent).toMatch(metin);
    expect(kutu.className.includes('amber')).toBe(eski);
  });

  it('DS6b referans kaynağı, ayrıntı tablosu yok, ayrıntı okunamadı; eski sunucuda yaş kutusu yok', async () => {
    api.init.mockResolvedValueOnce(
      yanit({
        referenceSource: 'ekip',
        detailAvailable: false,
        extrasError: 'InitScriptsDetail yok',
      }),
    );
    const { unmount } = render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    expect(await screen.findByText(/Referans: ekip sürümü \(depo\)\./)).toBeTruthy();
    expect(screen.getByText(/Ayrıntı tablosu yok: ham sha512 karşılaştırılıyor/)).toBeTruthy();
    expect(screen.getByText(/Ayrıntı tabloları okunamadı \(InitScriptsDetail yok\)/)).toBeTruthy();
    expect(screen.getByText('ekip sürümüyle uyumlu')).toBeTruthy();
    unmount();
    api.init.mockResolvedValueOnce(yanit({ referenceSource: 'karma' }));
    const r2 = render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    expect(
      await screen.findByText(
        /Referans: ekip sürümü \(depoda olan dosyalar\), diğerlerinde çoğunluk\./,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Yalnız boşluk\/satır sonu farkı olan kopyalar sapma sayılmaz\./),
    ).toBeTruthy();
    r2.unmount();
    api.init.mockResolvedValueOnce(yanit({ referenceSource: 'cogunluk' }));
    const r3 = render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    expect(
      await screen.findByText(/Referans: çoğunluk \(ekip sürümü henüz yüklenmedi\)\./),
    ).toBeTruthy();
    r3.unmount();
    const eski = yanit({ referenceSource: undefined });
    delete eski.ageSource;
    api.init.mockResolvedValueOnce(eski);
    render(<DenetimPage />, { initialEntries: ['/denetim?tab=init'] });
    await screen.findByText('start.sh', { selector: 'span.font-mono' });
    expect(screen.queryByText(/yüklendi|Verinin yaşı/)).toBeNull();
    expect(screen.getByText('çoğunlukla birebir aynı')).toBeTruthy();
  });

  it('DS7 deployment: tarama günü, kaynak job, startCustom yok, CSV başlıkları', async () => {
    const d = yanit({
      scanDate: '2026-11-26',
      referenceSource: undefined,
      scripts: [betik({ key: 'w', label: 'was_startstop.sh', variantCount: 2, deviatingCount: 1 })],
      hostRows: [satir('ORWASP01', { deviations: ['was_startstop.sh'], deviationCount: 1 })],
    });
    delete d.ageSource;
    api.deploy.mockResolvedValue(d);
    await ac('deploy');
    expect(api.deploy).toHaveBeenCalledWith('vhosting');
    expect(api.init).not.toHaveBeenCalled();
    expect(screen.getByText(/Deployment script'leri/)).toBeTruthy();
    expect(screen.getByText('check_deployment_scripts', { selector: 'code' })).toBeTruthy();
    expect(screen.getByText(/· son tarama 26\.11\.2026/)).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Çoğunluk' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(api.csv.mock.calls[0][0]).toBe('deployment_script_sapma_vhosting');
    expect(api.csv.mock.calls[0][1]).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Sunucu bazlı' }));
    expect(screen.queryByRole('columnheader', { name: 'startCustom.sh' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Çoğunluktan sapan' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(api.csv.mock.calls[1][1]).toEqual([
      'host',
      'sapma_adedi',
      'sapan_scriptler',
      'eksik_adedi',
      'eksik_scriptler',
      'startCustom_var',
    ]);
  });
});
