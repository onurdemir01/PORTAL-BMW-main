// Retirement web satiri (2026-10-23, Retirement #27 GBCEPPOSDASHBOARD): "Web sunucusu kolonundaki duplike
// satirlar niye duplike?" Ayni host + ServerName'in satirlari port / conf / urunle ayirt edilir.
//   RWS1 port, conf dosya adi ve urun yazilir; tam conf yolu ipucunda
//   RWS2 bilgi yoksa hicbir sey basilmaz
//   RWS3 ayni host + ServerName'in satirlari farkli React anahtari alir (port / conf / sira)
// Tablo yeniden tasarimi (2026-10-26): vhost ve sag deger AYNI izgara satirinda, host grup basina bir kez.
//   RWS4 portlar verilince ':80 :443 · conf · urun'
//   RWS5 host / ServerName buyuk-kucuk harf farki + :80/:443 -> 1 grup, 1 satir, 1 bag
//   RWS6 farkli conf -> ayni satirda 2 bag
//   RWS7 ilk gorulme sirasi korunur (siralama yok)
//   RWS8 trafikBirlestir bilinmeyeni ASLA "yok"a dusurmez
//   RWS9 (render) sag deger vhost'la ayni izgara satirinda; host grup basina bir kez
//   RWS10 kaynak belirtecleri birlesir (ad + ajp: "ad eslesmesiyle BULUNAMAZDI" denmez); cipler kirilmaz
//   RWS11 WebAyrinti tasmaz (max-w-full truncate); RWS12 sag deger 20px kutuda dikey ortali
// Korluk: CSS hizasi olculmez (jsdom yerlesim yapmaz); gorsel olcut sartname §11.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebAyrinti, WebKaynak, WebVhostListesi, trafikBirlestir, webGrupla, webKey } from '@/components/server_hub/RetirementWebSatir';
import type { RtVhostTrafik, RtWeb } from '@/api/retirementApi';

const w = (ek: Partial<RtWeb> = {}): RtWeb => ({ host: 'GBJBOAP13', serverName: 'gbcepposdashboard.fw.garantibbva.com.tr', product: 'IHS', port: '80', confFile: '/usr/IBMIHS/conf/mod-jk.conf', ...ek });

describe('Retirement web satiri', () => {
  it('RWS1 port, conf dosya adi ve urun; tam yol ipucunda', () => {
    render(<WebAyrinti w={w()} />);
    const el = screen.getByTestId('rt-web-ayrinti');
    expect(el).toHaveTextContent(':80 · mod-jk.conf · IHS');
    expect(el).toHaveAttribute('title', 'conf: /usr/IBMIHS/conf/mod-jk.conf');
  });

  it('RWS2 bilgi yoksa bos', () => {
    const { container } = render(<WebAyrinti w={w({ port: '', confFile: '', product: '' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('RWS3 ayni host + ServerName satirlari farkli anahtar alir', () => {
    const satirlar = [w(), w({ port: '443' }), w({ confFile: 'mod-jk.conf' }), w()];
    const anahtarlar = satirlar.map((x, i) => webKey(x, i));
    expect(new Set(anahtarlar).size).toBe(satirlar.length);
  });

  it('RWS4 portlar verilince hepsi yazilir', () => {
    render(<WebAyrinti w={w()} portlar={['80', '443']} />);
    expect(screen.getByTestId('rt-web-ayrinti')).toHaveTextContent(':80 :443 · mod-jk.conf · IHS');
  });

  it('RWS5 buyuk/kucuk harf farki ve :80/:443 -> 1 grup, 1 satir, 1 bag', () => {
    const g = webGrupla([w({ host: 'GBJBOWP13' }), w({ host: 'gbjbowp13', serverName: 'GBCEPPOSDASHBOARD.fw.garantibbva.com.tr', port: '443' })]);
    expect(g).toHaveLength(1);
    expect(g[0].host).toBe('GBJBOWP13');
    expect(g[0].satirlar).toHaveLength(1);
    const s = g[0].satirlar[0];
    expect(s.serverName).toBe('gbcepposdashboard.fw.garantibbva.com.tr');
    expect(s.baglar).toHaveLength(1);
    expect(s.baglar[0].portlar).toEqual(['80', '443']);
    expect(s.indeksler).toEqual([0, 1]);
  });

  it('RWS6 farkli conf -> 1 satir, 2 bag', () => {
    const g = webGrupla([w(), w({ confFile: '/usr/IBMIHS/conf/httpd.conf', port: '443' })]);
    expect(g[0].satirlar).toHaveLength(1);
    expect(g[0].satirlar[0].baglar.map((b) => b.portlar)).toEqual([['80'], ['443']]);
  });

  it('RWS7 iki host; ilk gorulme sirasi korunur', () => {
    const g = webGrupla([w({ host: 'ZZWEB01', serverName: 'b.ornek' }), w({ host: 'AAWEB01', serverName: 'a.ornek' }), w({ host: 'ZZWEB01', serverName: 'a.ornek' })]);
    expect(g.map((x) => x.host)).toEqual(['ZZWEB01', 'AAWEB01']);
    expect(g[0].satirlar.map((s) => s.serverName)).toEqual(['b.ornek', 'a.ornek']);
    expect(g[0].satirlar[1].indeksler).toEqual([2]);
  });

  it('RWS8 trafikBirlestir: var > bilinmiyor > olculemedi > yok', () => {
    const yok: RtVhostTrafik = { durum: 'yok' };
    const olc: RtVhostTrafik = { durum: 'olculemedi', sebep: 'log okunamadi' };
    const v5: RtVhostTrafik = { durum: 'var', req7: 5 };
    const v9: RtVhostTrafik = { durum: 'var', req7: 9, sampled: true };
    expect(trafikBirlestir([yok, olc])).toBe(olc);
    expect(trafikBirlestir([olc, yok])).toBe(olc);
    expect(trafikBirlestir([yok, v5])).toBe(v5);
    expect(trafikBirlestir([undefined, yok])).toBeUndefined();
    expect(trafikBirlestir([yok, undefined])).toBeUndefined();
    expect(trafikBirlestir([])).toBeUndefined();
    expect(trafikBirlestir([yok, yok])).toBe(yok);
    const b = trafikBirlestir([v5, v9]);
    expect(b?.req7).toBe(9);
    expect(b?.sampled).toBe(true);
    // Kucuk sayi alt sinirsa birlesik deger de alt sinir.
    const c = trafikBirlestir([{ durum: 'var', req7: 12 }, { durum: 'var', req7: 3, sampled: true }]);
    expect(c?.req7).toBe(12);
    expect(c?.sampled).toBe(true);
    // Satirin trafigi birlestirilmis deger.
    expect(webGrupla([w({ trafik: yok }), w({ port: '443', trafik: v5 })])[0].satirlar[0].trafik).toBe(v5);
  });

  it('RWS9 sag deger ayni izgara satirinda; host grup basina bir kez', () => {
    const web = [
      w({ host: 'GBJBOWP13', serverName: 'a.ornek' }), w({ host: 'GBJBOWP13', serverName: 'a.ornek', port: '443' }),
      w({ host: 'GBJBOWP13', serverName: 'b.ornek' }), w({ host: 'GBJBOWP14', serverName: 'a.ornek' }),
    ];
    const { container } = render(<WebVhostListesi web={web} sag={(s) => <span>sag:{s.serverName}</span>} />);
    const sag = [...container.querySelectorAll('[data-rt-vhost-sag]')];
    expect(sag).toHaveLength(3);
    for (const el of sag) {
      const vhost = el.previousElementSibling?.querySelector('[data-rt-vhost]');
      expect(vhost, 'sag degerin onceki kardesinde vhost yok').toBeTruthy();
      expect(el.textContent).toBe(`sag:${vhost?.textContent}`);
    }
    expect(screen.getAllByText('GBJBOWP13')).toHaveLength(1);
    expect(screen.getAllByText('GBJBOWP14')).toHaveLength(1);
    expect(screen.getAllByTestId('rt-web-ayrinti').map((x) => x.textContent)).toEqual([':80 :443 · mod-jk.conf · IHS', ':80 · mod-jk.conf · IHS', ':80 · mod-jk.conf · IHS']);
  });

  it('RWS10 kaynak belirtecleri birlesir; elle ilk dolu olandan; cipler kirilmaz', () => {
    const s = webGrupla([w({ kaynak: 'ad' }), w({ port: '443', kaynak: 'ajp', ajpHedef: 'gbjexp05:8009', elle: 'in-place: elle kontrol' })])[0].satirlar[0];
    expect(s.kaynak.kaynak).toBe('ad+ajp');
    expect(s.kaynak.ajpHedef).toBe('gbjexp05:8009');
    expect(s.kaynak.elle).toBe('in-place: elle kontrol');
    render(<WebKaynak w={s.kaynak} />);
    const ajp = screen.getByText('AJP');
    expect(ajp.getAttribute('title')).not.toMatch(/BULUNAMAZDI/);
    expect(ajp.className).toMatch(/whitespace-nowrap/);
    expect(screen.getByText('elle')).toHaveAttribute('title', 'in-place: elle kontrol');
    // Yalniz AJP ile bulunan: ad eslesmesiyle bulunamazdi.
    const y = webGrupla([w({ kaynak: 'ajp' })])[0].satirlar[0];
    expect(y.kaynak.kaynak).toBe('ajp');
  });
  it('RWS11 (denetim B5) WebAyrinti kolondan tasmaz: max-w-full truncate, tam yol ipucunda', () => {
    render(<WebAyrinti w={w({ confFile: '/usr/IBMIHS/conf/GBCORPORATEBANKINGSERVICE-T.conf' })} portlar={['8543']} />);
    const el = screen.getByTestId('rt-web-ayrinti');
    expect(el.className).toMatch(/\bmax-w-full\b/);
    expect(el.className).toMatch(/\btruncate\b/);
    expect(el).toHaveAttribute('title', 'conf: /usr/IBMIHS/conf/GBCORPORATEBANKINGSERVICE-T.conf');
  });

  it('RWS12 sag deger 20px kutuda dikey ortali (taban cizgisine oturan 16px cip 1px asagida kaliyordu)', () => {
    const { container } = render(<WebVhostListesi web={[w()]} sag={() => <span data-cip>istek yok (7g)</span>} />);
    const ic = container.querySelector('[data-rt-vhost-sag] > div') as HTMLElement;
    expect(ic.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'h-5', 'items-center']));
    expect(ic).toContainElement(container.querySelector('[data-cip]') as HTMLElement);
  });
});
