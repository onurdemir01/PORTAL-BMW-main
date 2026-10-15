// src/components/common/__tests__/SmartBeklemeSayaci.test.tsx — Smart onayi zaman asimi sayaci.
//
// Kullanici (2026-10-15): "Smart onayinda beklerken bir zaman asimi sayaci olsun ... cita figuru
// sayacin basinda yurusun sonuna dogru kosmaya baslasin."
//   SB1  sayacDurumu: yuru / kos (yalniz %25 kurali; OpsX 15 dk'da son 3:45) / bitti / sinirsizda bekle, oran
//   SB2  bicimleyiciler: "2 sa 14 dk", "09:41", gecen sure, ekran okuyucu ozeti
//   SB3  geri sayim ekrani: buyuk metin, "Zaman aşımına kalan", son tarih, role=timer
//   SB4  sinirsiz kip: gecen sure + aciklama, hedef bayragi YOK, cita devriyede
//   SB5  kompakt: tek satir metin, parkur yok, canli bolge yok (liste gurultusu)
//   SB6  1 sn ilerleyince metin degisir; canli bolge her dakika KONUSMAZ
//   SB7  serverNow kaymasi (istemci saati 10 dk geride olsa da kalan dogru); gec gelen serverNow
//   SB8  createdAt yok/gecersiz -> hic cizim yok, sayac kurulmaz
//   SB9  unmount -> interval temizlenir
//   SB10 kos evresi: data-evre, hiz cizgileri, kosma CSS'i; hareket azaltma kurali
//   SB11 canli bolge yalniz esiklerde konusur (2026-10-15 denetim): sinirsizda 60 dk boyunca HIC,
//        4 saatlik geri sayimda en fazla 5 kez (kos, 10 / 5 / 1 dk, doldu)
//   SB12 saat kaymasi yanitin GELDIGI anda olculur (alindiMs): bayat yanitla kurulan sayac dogru
//   SB13 alindiMs verilmezse taze serverNow gelince kayma duzelir; 2 sn alti titreme yok sayilir
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Varsayilan, {
  SmartBeklemeSayaci,
  sayacDurumu,
  sureMetni,
  gecenMetni,
  ozetMetni,
  KOS_ORANI,
} from '../SmartBeklemeSayaci';

const SN = 1000;
const DK = 60 * SN;
const SA = 60 * DK;
// Istanbul UTC+3 (yaz saati yok) -> fmtDateShort "18 Eki 18:30" belirlenimci.
const T0 = Date.parse('2026-10-18T18:00:00+03:00');
const iso = (ms: number) => new Date(ms).toISOString();

describe('SB1 sayacDurumu', () => {
  const D = T0 + 4 * SA; // toplam 4 saat -> %25 = 1 saat

  it('yuru: kalan cok, oran gecen/toplam', () => {
    const d = sayacDurumu(T0 + SA, T0, D);
    expect(d).toEqual({ kip: 'geri', kalanMs: 3 * SA, gecenMs: SA, oran: 0.25, evre: 'yuru' });
  });

  it('kalan %37.5 iken hala yuru (esik %25, %50 degil)', () => {
    expect(sayacDurumu(T0 + 2.5 * SA, T0, D).evre).toBe('yuru');
  });

  it('%25 esigi: tam %25 yuru, altina dusunce kos', () => {
    expect(sayacDurumu(T0 + 3 * SA, T0, D).evre).toBe('yuru');
    expect(sayacDurumu(T0 + 3 * SA + SN, T0, D).evre).toBe('kos');
  });

  it('kisa sure (OpsX production 15 dk): cita yalniz son ceyrekte (3:45) kosar', () => {
    // 2026-10-15: eski "ya da kalan < 10 dk" kurali 15 dk'lik onayda citayi 5. dakikada
    // kosturuyordu (surenin ucte ikisi). Tek kural %25.
    expect(KOS_ORANI).toBe(0.25);
    const D15 = T0 + 15 * DK;
    expect(sayacDurumu(T0 + 5 * DK + SN, T0, D15).evre).toBe('yuru'); // kalan 09:59
    expect(sayacDurumu(T0 + 11 * DK + 15 * SN, T0, D15).evre).toBe('yuru'); // kalan tam 03:45
    const d = sayacDurumu(T0 + 11 * DK + 16 * SN, T0, D15); // kalan 03:44
    expect(d.evre).toBe('kos');
    expect(d.kalanMs).toBe(3 * DK + 44 * SN);
  });

  it('bitti: son tarihte ve sonrasinda; 1 ms once degil', () => {
    expect(sayacDurumu(D - 1, T0, D).evre).toBe('kos');
    const tam = sayacDurumu(D, T0, D);
    expect(tam).toMatchObject({ evre: 'bitti', kalanMs: 0, oran: 1 });
    expect(sayacDurumu(D + 5 * DK, T0, D)).toMatchObject({ evre: 'bitti', kalanMs: 0, oran: 1 });
  });

  it('sinirsiz: deadline null -> bekle, oran ve kalan null', () => {
    expect(sayacDurumu(T0 + 12 * DK, T0, null)).toEqual({
      kip: 'sinirsiz',
      kalanMs: null,
      gecenMs: 12 * DK,
      oran: null,
      evre: 'bekle',
    });
  });

  it('istemci saati talepten geride: gecen 0, oran 0 (negatif olmaz)', () => {
    expect(sayacDurumu(T0 - DK, T0, D)).toMatchObject({ gecenMs: 0, oran: 0, evre: 'yuru' });
  });
});

describe('SB2 bicimleyiciler', () => {
  it('geri sayim: 1 saat ve ustu "sa dk", altinda "mm:ss"', () => {
    expect(sureMetni(2 * SA + 14 * DK + 30 * SN)).toBe('2 sa 14 dk');
    expect(sureMetni(2 * SA + 4 * DK)).toBe('2 sa 04 dk');
    expect(sureMetni(SA)).toBe('1 sa 00 dk');
    expect(sureMetni(59 * DK + 59 * SN)).toBe('59:59');
    expect(sureMetni(9 * DK + 41 * SN)).toBe('09:41');
    expect(sureMetni(400)).toBe('00:01'); // dolmadan 00:00 gorunmez
    expect(sureMetni(0)).toBe('00:00');
  });

  it('gecen sure: sn / dk / sa dk', () => {
    expect(gecenMetni(45 * SN)).toBe('45 sn');
    expect(gecenMetni(12 * DK + 59 * SN)).toBe('12 dk');
    expect(gecenMetni(SA + 5 * DK)).toBe('1 sa 05 dk');
  });

  it('ekran okuyucu ozeti dakika cozunurlugunde', () => {
    const geri = (kalanMs: number) => ozetMetni({ kip: 'geri', kalanMs, gecenMs: 0, oran: 0.5, evre: 'kos' });
    expect(geri(9 * DK + 41 * SN)).toBe('Zaman aşımına 9 dakika kaldı');
    expect(geri(2 * SA + 14 * DK)).toBe('Zaman aşımına 2 saat 14 dakika kaldı');
    expect(geri(2 * SA)).toBe('Zaman aşımına 2 saat kaldı');
    expect(geri(30 * SN)).toBe('Zaman aşımına 1 dakikadan az kaldı');
    expect(ozetMetni({ kip: 'geri', kalanMs: 0, gecenMs: 0, oran: 1, evre: 'bitti' })).toBe('Smart onayı için süre doldu');
    const sinirsiz = (gecenMs: number) => ozetMetni({ kip: 'sinirsiz', kalanMs: null, gecenMs, oran: null, evre: 'bekle' });
    expect(sinirsiz(12 * DK)).toBe('Smart onayı 12 dakikadır bekleniyor, süre sınırı yok');
    expect(sinirsiz(SA + 5 * DK)).toBe('Smart onayı 1 saat 5 dakikadır bekleniyor, süre sınırı yok');
    expect(sinirsiz(2 * SA)).toBe('Smart onayı 2 saattir bekleniyor, süre sınırı yok');
    expect(sinirsiz(20 * SN)).toBe('Smart onayı 1 dakikadan kısa süredir bekleniyor, süre sınırı yok');
  });
});

describe('SmartBeklemeSayaci bileseni', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const D30 = T0 + 30 * DK; // son tarih 18 Eki 18:30
  const anda = (ms: number) => vi.setSystemTime(new Date(ms));

  it('varsayilan ve adlandirilmis disa aktarim ayni bilesen', () => {
    expect(Varsayilan).toBe(SmartBeklemeSayaci);
  });

  it('SB3 geri sayim: mm:ss, etiket, son tarih, role=timer + aria-label', () => {
    anda(T0 + 20 * DK + 19 * SN); // kalan 09:41
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} />);
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('09:41');
    expect(screen.getByText('Zaman aşımına kalan')).toBeInTheDocument();
    expect(screen.getByText('18 Eki 18:30')).toBeInTheDocument();
    const kok = screen.getByRole('timer', { name: 'Zaman aşımına 9 dakika kaldı' });
    expect(kok).toHaveAttribute('data-kip', 'geri');
    const canli = screen.getByTestId('sbs-canli');
    expect(canli).toHaveAttribute('aria-live', 'polite');
    // Kurulusta duyuru yok: guncel ozet role=timer'in aria-label'inda (istenince okunur).
    expect(canli).toHaveTextContent('');
    // figur ve bayrak ekran okuyucudan gizli
    for (const svg of kok.querySelectorAll('svg')) {
      expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(kok.querySelector('.sbs-bayrak')).not.toBeNull();
  });

  it('SB3 1 saatten uzun kalan: "2 sa 14 dk", yuru, figur orana gore konumlu', () => {
    const D3 = T0 + 3 * SA;
    anda(T0 + 45 * DK + 30 * SN); // kalan 2:14:30, oran 0.2527...
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D3)} />);
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('2 sa 14 dk');
    const kok = screen.getByRole('timer', { name: 'Zaman aşımına 2 saat 14 dakika kaldı' });
    expect(kok).toHaveAttribute('data-evre', 'yuru');
    const sol = parseFloat(screen.getByTestId('sbs-konum').style.left);
    expect(sol).toBeCloseTo(((45 * DK + 30 * SN) / (3 * SA)) * 100, 3);
  });

  it('SB3 bitti: "Süre doldu", figur bitis cizgisinde', () => {
    anda(D30 + 5 * SN);
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} />);
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('Süre doldu');
    expect(screen.getByText('Talep zaman aşımına uğruyor')).toBeInTheDocument();
    expect(screen.queryByText('Zaman aşımına kalan')).toBeNull();
    expect(screen.getByRole('timer',{ name: 'Smart onayı için süre doldu' })).toHaveAttribute('data-evre', 'bitti');
    expect(screen.getByTestId('sbs-konum').style.left).toBe('100%');
  });

  it('SB4 sinirsiz: gecen sure + aciklama, bayrak yok, cita devriyede', () => {
    anda(T0 + 12 * DK + 7 * SN);
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={null} />);
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('12 dk');
    expect(screen.getByText('Bekleme süresi')).toBeInTheDocument();
    expect(
      screen.getByText("Süre sınırı yok — talep onaylanana ya da Smart'ta reddedilene kadar bekler."),
    ).toBeInTheDocument();
    const kok = screen.getByRole('timer', { name: 'Smart onayı 12 dakikadır bekleniyor, süre sınırı yok' });
    expect(kok).toHaveAttribute('data-kip', 'sinirsiz');
    expect(kok).toHaveAttribute('data-evre', 'bekle');
    expect(kok.querySelector('.sbs-bayrak')).toBeNull();
    expect(kok.querySelector('.sbs-serit--devriye')).not.toBeNull();
    expect(screen.queryByText('Zaman aşımına kalan')).toBeNull();
  });

  it('SB5 kompakt: tek satir metin, parkur yok', () => {
    anda(T0 + 20 * DK + 19 * SN);
    const { rerender } = render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} kompakt />);
    const kok = screen.getByRole('timer');
    expect(screen.getByTestId('sbs-metin').textContent).toBe('Kalan 09:41');
    expect(kok).toHaveAttribute('title', 'Son tarih 18 Eki 18:30');
    expect(kok.querySelector('.sbs-parkur')).toBeNull();
    expect(kok.querySelector('svg')).not.toBeNull();
    // Listede satir basina canli bolge olmaz (dakikada N duyuru); ozet aria-label'da.
    expect(screen.queryByTestId('sbs-canli')).toBeNull();
    expect(kok).toHaveAttribute('aria-label', 'Zaman aşımına 9 dakika kaldı');

    rerender(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={null} kompakt />);
    expect(screen.getByTestId('sbs-metin').textContent).toBe('Bekliyor 20 dk');

    rerender(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(T0 + 10 * DK)} kompakt />);
    expect(screen.getByTestId('sbs-metin').textContent).toBe('Süre doldu');
  });

  it('SB6 1 sn ilerleyince metin degisir; canli bolge dakika degisince KONUSMAZ', () => {
    anda(T0 + 20 * DK + 19 * SN); // 09:41
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} />);
    const deger = screen.getByTestId('sbs-deger');
    const canli = screen.getByTestId('sbs-canli');
    expect(deger).toHaveTextContent('09:41');
    act(() => {
      vi.advanceTimersByTime(SN);
    });
    expect(deger).toHaveTextContent('09:40');
    act(() => {
      vi.advanceTimersByTime(40 * SN);
    });
    expect(deger).toHaveTextContent('09:00');
    act(() => {
      vi.advanceTimersByTime(SN);
    });
    expect(deger).toHaveTextContent('08:59');
    // Dakika degisti ama esik (5 dk) gelmedi: canli bolge sessiz; ozet aria-label'da guncel.
    expect(canli).toHaveTextContent('');
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', 'Zaman aşımına 8 dakika kaldı');
  });

  // Canli bolgenin her degisimini kaydeder (dakikalik adimlarla; act basina bir commit).
  function duyurulariTopla(adimMs: number, adimSayisi: number): string[] {
    const canli = screen.getByTestId('sbs-canli');
    const duyurular: string[] = [];
    let onceki = canli.textContent ?? '';
    for (let i = 0; i < adimSayisi; i++) {
      act(() => {
        vi.advanceTimersByTime(adimMs);
      });
      const simdiki = canli.textContent ?? '';
      if (simdiki !== onceki) duyurular.push(simdiki);
      onceki = simdiki;
    }
    return duyurular;
  }

  it('SB11 sinirsiz kipte 60 dk boyunca canli bolge HIC konusmaz', () => {
    anda(T0);
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={null} />);
    expect(screen.getByTestId('sbs-canli')).toHaveTextContent('');
    expect(duyurulariTopla(DK, 60)).toEqual([]);
    // Ozet yine erisilebilir: role=timer aria-label'i guncel.
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', 'Smart onayı 1 saattir bekleniyor, süre sınırı yok');
  });

  it('SB11 4 saatlik geri sayimda canli bolge yalniz esiklerde konusur (en fazla 5)', () => {
    // 30 sn kaydirilmis baslangic: dakikalik adimlar "1 dakikadan az" penceresine de dusur.
    anda(T0 + 30 * SN);
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(T0 + 4 * SA)} />);
    const duyurular = duyurulariTopla(DK, 4 * 60 + 2);
    expect(duyurular.length).toBeLessThanOrEqual(5);
    expect(duyurular).toEqual([
      'Zaman aşımına 59 dakika kaldı', // %25 esigi: cita kosmaya basladi
      'Zaman aşımına 10 dakikadan az kaldı',
      'Zaman aşımına 5 dakikadan az kaldı',
      'Zaman aşımına 1 dakikadan az kaldı',
      'Smart onayı için süre doldu',
    ]);
  });

  it('SB12 bayat yanitla kurulan sayac: kayma yanitin GELDIGI andan olculur (alindiMs)', () => {
    // Yanit 5 dk once geldi (or. Admin'de OCO paneline gidip donuldu, liste yeniden cekilmedi).
    // Istemci saati sunucudan 10 dk geride. Gercek kalan: 09:41.
    const yanitSunucu = T0 + 15 * DK + 19 * SN;
    const yanitYerel = yanitSunucu - 10 * DK;
    anda(yanitYerel + 5 * DK);
    render(
      <SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} serverNow={iso(yanitSunucu)} alindiMs={yanitYerel} />,
    );
    // Kayma kurulus aninda olculseydi "14:41" gorunurdu (yanitin yasi kadar fazla).
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('09:41');
    act(() => {
      vi.advanceTimersByTime(SN);
    });
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('09:40');
  });

  it('SB13 alindiMs yoksa: taze serverNow gelince kayma duzelir; 2 sn alti titreme yok sayilir', () => {
    const yanitSunucu = T0 + 15 * DK + 19 * SN;
    anda(yanitSunucu - 10 * DK + 5 * DK); // bayat yanit, istemci 10 dk geride
    const { rerender } = render(
      <SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} serverNow={iso(yanitSunucu)} />,
    );
    // Gelis ani bilinmiyor: ilk olcum kurulus aninda (bayat) - bu kadari kacinilmaz.
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('14:41');
    // Taze yanit: sunucu saati simdi T0 + 20:19 -> gercek kalan 09:41.
    rerender(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} serverNow={iso(T0 + 20 * DK + 19 * SN)} />);
    act(() => {
      vi.advanceTimersByTime(SN);
    });
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('09:40');
    // Sonraki yoklama ag gecikmesi kadar (1.5 sn) farkli kayma verir: uygulanmaz, sayi zipliamaz.
    rerender(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} serverNow={iso(T0 + 20 * DK + 21.5 * SN)} />);
    act(() => {
      vi.advanceTimersByTime(SN);
    });
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('09:39');
  });

  it('SB7 serverNow: istemci saati 10 dk geride olsa da kalan sunucu saatine gore', () => {
    const sunucu = T0 + 20 * DK + 19 * SN; // sunucuya gore kalan 09:41
    anda(sunucu - 10 * DK); // istemci 10 dk geride -> kaymasiz 19:41 gorunurdu
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} serverNow={iso(sunucu)} />);
    const deger = screen.getByTestId('sbs-deger');
    expect(deger).toHaveTextContent('09:41');
    act(() => {
      vi.advanceTimersByTime(SN);
    });
    expect(deger).toHaveTextContent('09:40'); // tik de kaymayi kullanir
    // 30 dk'lik surede %25 = 7:30; kalan 09:40 hala yuruyus (kaymasiz saatte de ayni).
    expect(screen.getByRole('timer')).toHaveAttribute('data-evre', 'yuru');
  });

  it('SB7 yanit gelmeden kurulan sayac: serverNow gec gelince kayma yine uygulanir', () => {
    const sunucu = T0 + 20 * DK + 19 * SN;
    anda(sunucu - 10 * DK);
    const { container, rerender } = render(
      <SmartBeklemeSayaci createdAt={null} deadline={null} serverNow={null} />,
    );
    expect(container.firstChild).toBeNull();
    rerender(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} serverNow={iso(sunucu)} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('sbs-deger')).toHaveTextContent('09:41');
  });

  it('SB8 createdAt yok ya da gecersiz: hicbir sey cizilmez, sayac kurulmaz', () => {
    const kur = vi.spyOn(globalThis, 'setInterval');
    anda(T0);
    const { container, rerender } = render(<SmartBeklemeSayaci createdAt={null} deadline={iso(D30)} />);
    expect(container.firstChild).toBeNull();
    rerender(<SmartBeklemeSayaci createdAt={undefined} deadline={null} kompakt />);
    expect(container.firstChild).toBeNull();
    rerender(<SmartBeklemeSayaci createdAt="gecersiz" deadline={null} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(kur).not.toHaveBeenCalled();
  });

  it('SB9 unmount sonrasi interval temizlenir', () => {
    anda(T0 + 5 * DK);
    const kur = vi.spyOn(globalThis, 'setInterval');
    const temizle = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} />);
    expect(kur).toHaveBeenCalledTimes(1);
    expect(kur.mock.calls[0][1]).toBe(SN);
    const id = kur.mock.results[0].value;
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(temizle).toHaveBeenCalledWith(id);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('SB10 kos evresi: data-evre, hiz cizgileri ve kosma CSS kurallari', () => {
    anda(T0 + 25 * DK); // kalan 5 dk
    render(<SmartBeklemeSayaci createdAt={iso(T0)} deadline={iso(D30)} />);
    const kok = screen.getByRole('timer');
    expect(kok).toHaveAttribute('data-evre', 'kos');
    expect(kok.querySelectorAll('.sbs-hiz > span')).toHaveLength(3);
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    expect(css).toContain('.sbs[data-evre="kos"] .sbs-bacak{animation-name:sbs-adim-kos;animation-duration:.175s}');
    expect(css).toContain('.sbs[data-evre="kos"] .sbs-hiz{display:block}');
    expect(css).toContain('--sbs-renk:var(--status-warning-text)');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\.sbs \*[^}]*animation:none!important/);
    expect(css).not.toMatch(/var\(--status-warning\)/); // TK8: metin icin -text tonu
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i); // sabit hex renk yok
  });
});
