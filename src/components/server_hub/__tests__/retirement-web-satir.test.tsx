// Retirement web satiri (2026-10-23, Retirement #27 GBCEPPOSDASHBOARD): "Web sunucusu kolonundaki duplike
// satirlar niye duplike?" Ayni host + ServerName'in satirlari port / conf / urunle ayirt edilir.
//   RWS1 port, conf dosya adi ve urun yazilir; tam conf yolu ipucunda
//   RWS2 bilgi yoksa hicbir sey basilmaz
//   RWS3 ayni host + ServerName'in satirlari farkli React anahtari alir (port / conf / sira)
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebAyrinti, webKey } from '@/components/server_hub/RetirementWebSatir';
import type { RtWeb } from '@/api/retirementApi';

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
});
