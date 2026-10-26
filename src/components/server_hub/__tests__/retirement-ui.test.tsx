// Retirement ortak ogeleri (2026-10-26, tablo yeniden tasarimi).
//   RUI1 Hap: ton metni TON[ton].metin (uyari/hata -text tokeni), etiket kesilirse title'da, ikon verilince nokta yok
//   RUI2 Cip KIRILMAZ (whitespace-nowrap: 'in-/place' kirilmasi) ve title tasir
//   RUI3 UyariKutusu: rol ve baslik/govde/eylem; bilgi tonu aksan (PF6 info mor)
//   RUI4 TabloIskelet: colgroup genislikleri, sec basligi, sag etiket; kolon sayisi = th sayisi
//   RUI5 smBtn(true) metni --text-on-accent (eski tanimsiz --accent-fg -> #fff koyu temada 1.45:1)
//   RUI6 SonucMetni: bas etiketi cipe ayrilir, tam metin title'da, "Is ciktisinda gor" yalniz onCikti ile
//   RS3  sonucAyir: 'FAIL — x' -> { FAIL, x }; on ek yoksa etiket null; govde AYNI kelimeyle basliyorsa atilir
//        (sunucu "PLAN — PLAN (HENUZ ...)" yaziyor: ekranda "PLAN PLAN" tekrari, ana ajan olcumu V2)
// Korluk: line-clamp tasma olcumu (ResizeObserver) jsdom'da olculmez.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { Cip, Hap, SonucMetni, TabloIskelet, UyariKutusu } from '@/components/server_hub/RetirementUi';
import { TON, smBtn } from '@/components/server_hub/retirementStil';
import { sonucAyir } from '@/components/server_hub/retirementSatir';

describe('Retirement ortak ogeleri', () => {
  it('RUI1 Hap metni tonun metin tokeni; ikonlu hapta nokta yok', () => {
    const { container, rerender } = render(<Hap label="durduruluyor" ton="uyari" nabiz />);
    const kok = container.firstElementChild as HTMLElement;
    expect(kok.style.color).toBe('var(--status-warning-text)');
    expect(screen.getByText('durduruluyor')).toHaveAttribute('title', 'durduruluyor');
    expect(kok.querySelector('.animate-status-pulse')).toBeTruthy();
    rerender(<Hap label="GERİ AKTİF" ton="basari" ikon={ArrowUturnLeftIcon} />);
    expect((container.firstElementChild as HTMLElement).querySelector('svg')).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).querySelector('.rounded-full')).toBeNull();
    for (const t of ['uyari', 'hata'] as const) expect(TON[t].metin).toMatch(/-text\)$/);
  });

  it('RUI2 Cip kirilmaz ve title tasir', () => {
    render(<Cip ton="uyari" title="aciklama">in-place</Cip>);
    const c = screen.getByText('in-place');
    expect(c.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(c.className).toMatch(/\bshrink-0\b/);
    expect(c).toHaveAttribute('title', 'aciklama');
  });

  it('RUI3 UyariKutusu rol, baslik, govde, eylem', () => {
    render(<UyariKutusu ton="uyari" rol="status" baslik="Baslik" eylem={<button type="button">Eylem</button>}>Govde</UyariKutusu>);
    expect(screen.getByRole('status')).toHaveTextContent('BaslikGovdeEylem');
    expect(screen.getByText('Baslik').style.color).toBe('var(--status-warning-text)');
    const { container } = render(<UyariKutusu ton="bilgi" baslik="Bilgi" />);
    expect((container.firstElementChild as HTMLElement).getAttribute('role')).toBeNull();
    expect(screen.getByText('Bilgi').style.color).toBe('var(--accent)');
  });

  it('RUI4 TabloIskelet colgroup ve baslik', () => {
    const { container } = render(
      <table>
        <TabloIskelet secimBasligi={<input type="checkbox" aria-label="Tumu" />} kolonlar={[
          { anahtar: 'sec', baslik: '', genislik: '2.25rem' },
          { anahtar: 'hedef', baslik: 'Hedef', genislik: '16rem', ipucu: 'ipucu' },
          { anahtar: 'web', baslik: 'Web', sag: 'Trafik' },
        ]} />
      </table>,
    );
    const cols = [...container.querySelectorAll('col')];
    expect(cols.map((c) => c.style.width)).toEqual(['2.25rem', '16rem', '']);
    expect(container.querySelectorAll('th')).toHaveLength(3);
    expect(screen.getByLabelText('Tumu')).toBeTruthy();
    expect(screen.getByText('Hedef').closest('th')).toHaveAttribute('title', 'ipucu');
    expect(screen.getByText('Trafik')).toBeTruthy();
  });

  it('RUI5 smBtn birincil metni --text-on-accent', () => {
    expect(smBtn(true).color).toBe('var(--text-on-accent)');
    expect(JSON.stringify(smBtn(true))).not.toMatch(/accent-fg|#fff/);
  });

  it('RUI6 SonucMetni etiketi ayirir, tam metin title, Is ciktisi baglantisi yalniz onCikti ile', () => {
    const onCikti = vi.fn();
    const { container, rerender } = render(<SonucMetni metin="FAIL — JBoss durmadi" hata />);
    const p = container.querySelector('p') as HTMLElement;
    expect(p).toHaveAttribute('title', 'FAIL — JBoss durmadi');
    expect(p.className).toMatch(/line-clamp-2/);
    expect(p.style.color).toBe('var(--status-danger-text)');
    expect(screen.getByText('FAIL')).toBeTruthy();
    expect(screen.queryByText('İş çıktısında gör')).toBeNull();
    rerender(<SonucMetni metin="FAIL — JBoss durmadi" hata onCikti={onCikti} />);
    fireEvent.click(screen.getByText('İş çıktısında gör'));
    expect(onCikti).toHaveBeenCalledTimes(1);
  });

  it('RS3 sonucAyir', () => {
    expect(sonucAyir('FAIL — x')).toEqual({ etiket: 'FAIL', govde: 'x' });
    expect(sonucAyir('OK - tamam')).toEqual({ etiket: 'OK', govde: 'tamam' });
    expect(sonucAyir('PLAN—2 paket')).toEqual({ etiket: 'PLAN', govde: '2 paket' });
    expect(sonucAyir('OKUNAMADI: x')).toEqual({ etiket: null, govde: 'OKUNAMADI: x' });
    expect(sonucAyir('')).toEqual({ etiket: null, govde: '' });
    expect(sonucAyir('PLAN — PLAN (HENUZ HICBIR SEY YAPILMADI): 2 paket')).toEqual({ etiket: 'PLAN', govde: '(HENUZ HICBIR SEY YAPILMADI): 2 paket' });
    expect(sonucAyir('OK — OK - 3 hedef')).toEqual({ etiket: 'OK', govde: '3 hedef' });
    expect(sonucAyir('SKIP — SKIP: y')).toEqual({ etiket: 'SKIP', govde: 'y' });
    // Ayni kelime DEGIL (FAILED / OKUNDU) ya da farkli etiket: dokunulmaz; govde bos kalmaz.
    expect(sonucAyir('FAIL — FAILED x')).toEqual({ etiket: 'FAIL', govde: 'FAILED x' });
    expect(sonucAyir('OK - OKUNDU')).toEqual({ etiket: 'OK', govde: 'OKUNDU' });
    expect(sonucAyir('FAIL — PLAN (x)')).toEqual({ etiket: 'FAIL', govde: 'PLAN (x)' });
    expect(sonucAyir('OK — OK')).toEqual({ etiket: 'OK', govde: 'OK' });
    const { container } = render(<SonucMetni metin="PLAN — PLAN (HENUZ HICBIR SEY YAPILMADI): 2 paket" hata={false} />);
    expect((container.querySelector('p') as HTMLElement).textContent).toBe('PLAN (HENUZ HICBIR SEY YAPILMADI): 2 paket');
  });
});
