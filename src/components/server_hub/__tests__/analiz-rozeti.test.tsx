// Retirement Analizi rozeti (2026-11-07): Uygulama 360 ve sunucu paneli analiz sekmesiyle AYNI kararı
// gösterir (tek kaynak /iliski/karar). Kilitlenenler:
//   - 409 "grafikte yok" ile "okunamadı" ayrı; okunamayan hiçbir şey yeşil değil, düğme yok
//   - sunucu: kopya kararları KARAR_SIRA ile sayılır
//   - "Analizde aç" yalnız ServerHubPage context'i verildiyse; sekme o kaydı seçer
//   - anahtar kuralı sunucunun grafik anahtarlarıyla (iliski-grafigi.cjs `A`) birebir
import React from 'react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { ShKararAyrinti, ShKopyaKarar, ShNot } from '@/api/serverHubApi';

const m = vi.hoisted(() => ({
  iliskiKarar: vi.fn(),
  iliskiKararlar: vi.fn(),
  iliskiAra: vi.fn(),
  iliskiVarlik: vi.fn(),
  notEkle: vi.fn(),
  notGuncelle: vi.fn(),
  notArsivle: vi.fn(),
}));
vi.mock('@/api/serverHubApi', async (orig) => ({
  ...(await orig<typeof import('@/api/serverHubApi')>()),
  serverHubApi: m,
}));
vi.mock('@/hooks/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AnalizRozeti, {
  AnalizAcContext,
  sunucuAnahtari,
  uygulamaAnahtari,
} from '@/components/server_hub/AnalizRozeti';
import RetirementAnaliziTab from '@/components/server_hub/RetirementAnaliziTab';
import { DURUM_TON } from '@/components/server_hub/DurumRozeti';

const not = (id: number, ek: Partial<ShNot> = {}): ShNot => ({
  id,
  konu: 'app:APP1',
  konu_tur: 'app',
  supheli_kod: null,
  sinif: 'DUZELTILECEK',
  etiketler: [],
  metin: `not ${id}`,
  yayilim: 'YALNIZ',
  durum: 'AKTIF',
  surum: 1,
  olusturan: 'ayse',
  olusturuldu: null,
  guncelleyen: null,
  guncellendi: null,
  dogrudan: true,
  ...ek,
});
const kopya = (ad: string, karar: ShKopyaKarar['karar']): ShKopyaKarar => ({
  anahtar: `jvm:APPSRV01|8|${ad}`,
  tur: 'jvm',
  ad,
  host: 'APPSRV01',
  env: 'PROD',
  calisiyor: true,
  karar,
  kararMetni: karar,
  maddeler: [],
  eksikler: [],
  celiskiler: [],
});
const uygulamaYaniti = (): ShKararAyrinti => ({
  ok: true,
  tur: 'app',
  siniflar: [],
  notOkunamadi: false,
  uygulama: {
    anahtar: 'app:APP1',
    ad: 'APP1',
    karar: 'RETIRE_ADAYI',
    kararMetni: 'Retire adayı — son kontroller kaldı',
    ozet: '1 kopya: 1 kopya retire adayı',
    sayilar: { RETIRE_ADAYI: 1, SUPHELI: 0, KARAR_VERILEMEZ: 0, KULLANIMDA: 0, SORUN_YOK: 0 },
    kopyalar: [],
    yapilabilecekler: [],
    notlar: [not(1, { veriDegisti: true }), not(2)],
    bilinen: { id: 2, sinif: 'BILINEN', metin: 'planlı', konu: 'app:APP1', dogrudan: true },
  },
  kopyalar: [],
});
const hata = (status: number, mesaj: string) => Object.assign(new Error(mesaj), { status });
const rozet = () => screen.findByTestId('analiz-rozeti');
const tonu = (el: HTMLElement) => el.style.color;

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
});

describe('Retirement Analizi rozeti', () => {
  it('AR1 uygulama: karar, metin, not sayısı, veri değişti, Bilinen; düğme context ile', async () => {
    m.iliskiKarar.mockResolvedValue(uygulamaYaniti());
    const ac = vi.fn();
    render(
      <AnalizAcContext.Provider value={ac}>
        <AnalizRozeti anahtar="app:APP1" />
      </AnalizAcContext.Provider>,
    );
    const r = await rozet();
    // Tek rozet: karar cümlesi kararın tonunda; kısa ad ayrıca tekrar edilmez.
    const k = await within(r).findByText('Retire adayı — son kontroller kaldı');
    expect(tonu(k)).toBe(DURUM_TON.kotu.color);
    expect(within(r).queryByText('Retire adayı')).toBeNull();
    expect(m.iliskiKarar).toHaveBeenCalledWith('app:APP1');
    expect(within(r).getByText('2 not')).toBeInTheDocument();
    expect(within(r).getByText('veri değişti')).toBeInTheDocument();
    expect(within(r).getByText('Bilinen')).toHaveAttribute('title', 'planlı');
    fireEvent.click(within(r).getByRole('button', { name: 'Analizde aç' }));
    expect(ac).toHaveBeenCalledWith('app:APP1');
  });

  it('AR2 context yoksa düğme yok (yalnız gösterir)', async () => {
    m.iliskiKarar.mockResolvedValue(uygulamaYaniti());
    render(<AnalizRozeti anahtar="app:APP1" />);
    const r = await rozet();
    await within(r).findByText('Retire adayı — son kontroller kaldı');
    expect(within(r).queryByRole('button')).toBeNull();
  });

  it('AR3 sunucu: kopya kararları KARAR_SIRA ile sayılır; kopya yoksa açık metin', async () => {
    m.iliskiKarar.mockResolvedValue({
      ok: true,
      tur: 'sunucu',
      siniflar: [],
      notOkunamadi: false,
      sunucu: { anahtar: 'sunucu:APPSRV01', ad: 'APPSRV01', veri: {} },
      kopyalar: [kopya('A', 'KULLANIMDA'), kopya('B', 'RETIRE_ADAYI'), kopya('C', 'KULLANIMDA')],
      notlar: [not(3, { konu: 'sunucu:APPSRV01' })],
    });
    const { unmount } = render(<AnalizRozeti anahtar="sunucu:APPSRV01" />);
    const r = await rozet();
    await within(r).findByText('1 kopya retire adayı');
    const metinler = [...r.querySelectorAll('span')].map((s) => s.textContent);
    expect(metinler.indexOf('1 kopya retire adayı')).toBeLessThan(
      metinler.indexOf('2 kopya kullanımda'),
    );
    expect(within(r).getByText('1 not')).toBeInTheDocument();
    unmount();
    m.iliskiKarar.mockResolvedValue({
      ok: true,
      tur: 'sunucu',
      siniflar: [],
      notOkunamadi: false,
      kopyalar: [],
      notlar: [],
    });
    render(<AnalizRozeti anahtar="sunucu:WEBSRV01" />);
    expect(
      await screen.findByText('Bu sunucuda karar verilecek uygulama kopyası yok.'),
    ).toBeInTheDocument();
  });

  it('AR4 409 "grafikte yok" ile okunamadı ayrı; ikisinde de yeşil ve düğme yok', async () => {
    const ac = vi.fn();
    m.iliskiKarar.mockRejectedValue(hata(409, 'Sunucu artık grafikte yok.'));
    const { unmount } = render(
      <AnalizAcContext.Provider value={ac}>
        <AnalizRozeti anahtar="sunucu:ESKI" />
      </AnalizAcContext.Provider>,
    );
    let r = await rozet();
    await within(r).findByText('Sunucu artık grafikte yok.');
    expect(within(r).queryByText('okunamadı')).toBeNull();
    expect(within(r).queryByRole('button')).toBeNull();
    unmount();
    for (const sebep of [hata(424, 'tablolar okunamadı'), null]) {
      cleanup();
      if (sebep) m.iliskiKarar.mockRejectedValue(sebep);
      else m.iliskiKarar.mockResolvedValue(null); // JSON olmayan 200
      render(
        <AnalizAcContext.Provider value={ac}>
          <AnalizRozeti anahtar="app:APP1" />
        </AnalizAcContext.Provider>,
      );
      r = await rozet();
      const ok = await within(r).findByText('okunamadı');
      expect(tonu(ok)).toBe(DURUM_TON.uyari.color);
      expect(within(r).queryByRole('button')).toBeNull();
    }
    expect(ac).not.toHaveBeenCalled();
  });

  it('AR5 anahtar kuralı sunucunun grafik anahtarıyla birebir', () => {
    const req = createRequire(import.meta.url);
    const { A } = req('../../../../server/server-hub/iliski-grafigi.cjs');
    for (const h of ['appsrv01.ornek.local', 'AppSrv01', ' appsrv01 '])
      expect(sunucuAnahtari(h)).toBe(A.sunucu(h));
    for (const a of ['pay', ' Pay ', 'PAY']) expect(uygulamaAnahtari(a)).toBe(A.app(a));
  });

  it('AR6 analiz sekmesi: her yeni istek kaydı seçer; aynı istek kapatılan kartı geri açmaz', async () => {
    m.iliskiKararlar.mockResolvedValue({
      ok: true,
      sayilar: { RETIRE_ADAYI: 0, SUPHELI: 0, KARAR_VERILEMEZ: 0, KULLANIMDA: 0, SORUN_YOK: 0 },
      bilinenSayisi: 0,
      yetimNotSayisi: 0,
      notOkunamadi: false,
      siniflar: [],
      uygulamalar: [],
    });
    m.iliskiKarar.mockResolvedValue(uygulamaYaniti());
    const b1 = { anahtar: 'app:APP1', no: 1 };
    const { rerender } = render(<RetirementAnaliziTab baslangic={b1} />);
    expect(await screen.findByTestId('karar-karti')).toBeInTheDocument();
    expect(m.iliskiKarar).toHaveBeenCalledWith('app:APP1');
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    await waitFor(() => expect(screen.queryByTestId('karar-karti')).toBeNull());
    rerender(<RetirementAnaliziTab baslangic={b1} />);
    expect(screen.queryByTestId('karar-karti')).toBeNull();
    rerender(<RetirementAnaliziTab baslangic={{ anahtar: 'app:APP1', no: 2 }} />);
    expect(await screen.findByTestId('karar-karti')).toBeInTheDocument();
  });

  it('AR7 bağlantılar: panel, Uygulama 360 ve sayfa aynı rozet / context', () => {
    const oku = (p: string) =>
      fs.readFileSync(path.join(process.cwd(), 'src/components/server_hub', p), 'utf8');
    expect(oku('SunucuPaneli.tsx')).toMatch(/<AnalizRozeti anahtar=\{sunucuAnahtari\(host\)\} \/>/);
    expect(oku('Uygulama360Tab.tsx')).toMatch(
      /data-testid="uygulama-360-ayrinti">\s*<AnalizRozeti anahtar=\{uygulamaAnahtari\(anahtar\)\} \/>/,
    );
    const sayfa = oku('ServerHubPage.tsx');
    // Sağlayıcı bütün sekme gövdelerini sarar (Sunucular / Bulgular / Uygulama 360 panelleri içinde).
    expect(sayfa).toMatch(
      /<AnalizAcContext\.Provider value=\{analizAc\}>\s*\{acilan\.has\('hosts'\)[\s\S]*<KurallarTab \/>[\s\S]*?<\/AnalizAcContext\.Provider>/,
    );
    expect(sayfa).toMatch(/setTab\('analiz'\)/);
  });
});
