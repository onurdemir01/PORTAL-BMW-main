// SPA Uygulamalari ozet matrisi (2026-11-12): alti sorunun sayimi ve RP eslenik karari.
import { describe, it, expect } from 'vitest';
import { eslenikDurumu, spaOzeti } from '@/components/nginx_console/SpaOzetMatrisi';
import type { NgSpaApp } from '@/api/nginxConsoleApi';

const app = (o: Partial<NgSpaApp>): NgSpaApp =>
  ({ application: 'a', namespace: 'n-prod', env: 'prod', spa: 'evet', ag: 'internet', pattern: 'uyuyor', rp: 'tanimli', rpIstek: 'var', rpHost: '4/4', ...o }) as NgSpaApp;

describe('SPA özet matrisi', () => {
  it('RP eşlenik: sunucunun servis bazlı kararı (rpEslenik); sorun kodu = hatalı; rpHost paydası kullanılmaz', () => {
    expect(eslenikDurumu(app({}))).toBe('tam');
    // 2026-11-12: rpHost '1/2' (ortamin TUM RP'leri) artik eksik DEMEK DEGIL (QA Q01/Q02 farkli servis)
    expect(eslenikDurumu(app({ rpHost: '1/2' }))).toBe('tam');
    expect(eslenikDurumu(app({ rpEslenik: 'eksik', rpEslenikEksik: ['GBNGXAP34'] }))).toBe('eksik');
    expect(eslenikDurumu(app({ rpSorun: ['NOT_DEPLOYED'] }))).toBe('hatali');
    expect(eslenikDurumu(app({ rpSorun: ['ORTAM_DISI'] }))).toBe('tam');
    expect(eslenikDurumu(app({ rp: 'tanimsiz' }))).toBeNull();
  });

  it('sayım yalnız SPA olanlardan; ortam başına ayrı; toplam; ölçülemeyen SPA ayrı', () => {
    const { satirlar, toplam } = spaOzeti([
      app({}),
      app({ ag: 'intranet', rp: 'kapsam-disi', rpIstek: 'uygulanamaz', pattern: 'uymuyor' }),
      app({ env: 'test', rp: 'tanimli', rpIstek: 'yok', rpEslenik: 'eksik' }),
      app({ env: 'test', spa: 'hayir' }),
      app({ env: 'test', spa: 'bilinmiyor' }),
    ]);
    expect(satirlar.map((s) => s.ortam)).toEqual(['prod', 'test']);
    const [p, t] = satirlar;
    expect([p.spa, p.internet, p.intranet, p.kalipUymuyor, p.rpTanimli, p.yukVar, p.esTam]).toEqual([2, 1, 1, 1, 1, 1, 1]);
    expect([t.spa, t.bilinmiyor, t.yukYok, t.esEksik]).toEqual([1, 1, 1, 1]);
    expect(toplam.spa).toBe(3);
  });
});
