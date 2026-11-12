// SPA ozet matrisi - Reverse proxy sutunu okunur akis (kullanici, 2026-11-12: "RP uzerinden, RP'de yok,
// yuk var/yok, RP eslenik sunucular hicbir seyi anlamiyorum").
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SpaOzetMatrisi from '@/components/nginx_console/SpaOzetMatrisi';
import type { NgSpaApp } from '@/api/nginxConsoleApi';

const app = (o: Partial<NgSpaApp>): NgSpaApp =>
  ({ application: 'a', namespace: 'n-prod', env: 'prod', spa: 'evet', ag: 'internet', pattern: 'uyuyor', rp: 'tanimli', rpIstek: 'var', rpHost: '4/4', ...o }) as NgSpaApp;

describe('SPA özet — reverse proxy akışı', () => {
  it('tek sütunda sırayla: yayında → trafik aldı / almadı → eksik sunucu; tanımı yok; sözlük; tıklama süzer', () => {
    const onSuz = vi.fn();
    render(
      <SpaOzetMatrisi
        onSuz={onSuz}
        apps={[app({ rpServis: ['GLOMO'] }), app({ rpIstek: 'yok', rpEslenik: 'eksik', rpServis: ['SAKLAMA'] }), app({ rpIstek: 'var', rpSorun: ['NOT_DEPLOYED'], rpServis: ['GLOMO'] }), app({ rp: 'tanimsiz', rpIstek: 'uygulanamaz' }), app({ ag: 'intranet', rp: 'kapsam-disi', rpIstek: 'uygulanamaz' })]}
      />,
    );
    const akis = screen.getByTestId('rp-akisi');
    const metin = (id: string) => within(akis).getByTestId(id).textContent;
    expect(metin('rp-yayinda')).toBe("3RP'de yayında");
    expect(metin('rp-trafik-var')).toBe('└2son 7 günde trafik aldı');
    expect(metin('rp-trafik-yok')).toBe('└1trafik almadı');
    expect(metin('rp-eksik-sunucu')).toBe('└1aynı servisin bazı RP sunucularında tanımı yok');
    expect(metin('rp-hatali')).toBe('└1bir RP sunucusunda tanım hatalı');
    expect(metin('rp-tanimsiz')).toBe("1RP'de tanımı yok");
    expect(screen.queryByText(/RP eşlenik sunucular/)).toBeNull();
    expect(screen.getByTestId('rp-sozluk').textContent).toMatch(/birbirinin kopyasıdır/);
    fireEvent.click(within(within(akis).getByTestId('rp-tanimsiz')).getByRole('button'));
    expect(onSuz).toHaveBeenCalledWith({ ortam: 'prod', rp: 'tanimsiz' });
    // hangi RP servisi: GLOMO / SAKLAMA ayri, tiklamak servise suzer
    const sv = within(akis).getByTestId('rp-servisler');
    expect([...sv.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['GLOMO2', 'SAKLAMA1']);
    fireEvent.click(within(sv).getByText('GLOMO'));
    expect(onSuz).toHaveBeenLastCalledWith({ ortam: 'prod', rp: 'tanimli', servis: 'GLOMO' });
  });

  it('internet SPA yoksa açıklama yazar', () => {
    render(<SpaOzetMatrisi onSuz={() => {}} apps={[app({ ag: 'intranet', rp: 'kapsam-disi', rpIstek: 'uygulanamaz' })]} />);
    expect(screen.getByText(/intranet SPA'lar reverse proxy kullanmaz/)).toBeTruthy();
  });
});
