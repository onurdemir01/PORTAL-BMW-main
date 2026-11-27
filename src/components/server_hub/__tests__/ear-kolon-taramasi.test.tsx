// @vitest-environment jsdom
// Uygulama Envanteri tabloları, bütün kolonlar açık (2026-11-26, kapsam PR-2; dal %47): kolon seçicide her kolon
// açılınca başlık sayısı seçiciyle aynı olur ve dolu bir satırın her hücresi çizilir. Boole kolonlar evet / hayır /
// ölçülmedi ayrımını, sürüm kolonları değeri, eşlenik kararları okunur etiketi taşır; boş değerler "—" olur.
import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/test-utils';

const m = vi.hoisted(() => ({ uygulamalar: vi.fn(), warlar: vi.fn(), degerler: vi.fn() }));
vi.mock('@/api/earEnvanterApi', async (orig) => ({
  ...(await orig<typeof import('@/api/earEnvanterApi')>()),
  earApi: m,
}));

import { UygulamalarGorunum, WarlarGorunum } from '@/components/server_hub/EarEnvanterGorunumler';

const UYGULAMA = {
  kosu_id: 7,
  host: 'APPSRV01',
  ortam: 'PROD',
  uyg_no: 1,
  kip: 'TAM',
  kok: '/vhosting/apps',
  jboss: '7',
  ad: 'odeme.ear',
  bicim: 'ACIK',
  durum: 'TAM',
  bag_hedefi: '/opt/gercek/odeme.ear',
  war_sayisi: 3,
  giris: 1200,
  jsp: 40,
  tld: 2,
  jar: 55,
  class_sayisi: 900,
  application_xml: true,
  ear_kutuphane_sayisi: 12,
  spring_boot: '2.7.18',
  spring_framework: '5.3.31',
  log4j: '2.17.1',
  servlet: '4.0',
  yapi_izi: 'abc123',
  kutuphane_izi: 'def456',
  uyari_sayisi: 2,
  uyarilar: JSON.stringify(['bozuk jar', 'okunamayan dosya']),
  xml_eslesme: null,
  taranma_utc: '2026-11-25T10:00:00Z',
  war_adlari: 'odeme-web.war + odeme-api.war',
  spring_security: '5.8.0',
  logback: '1.2.12',
  jackson: '2.15.2',
  thymeleaf: '3.1.2',
  struts: null,
  eslenik_ortam_ici: 'AYNI',
  eslenik_ortamlar_arasi: 'FARKLI_KUTUPHANE',
  eslenik_nesil: 'EKSIK_TARAMA',
};
const WAR = {
  kosu_id: 7,
  host: 'APPSRV01',
  ortam: 'PROD',
  jboss: '8',
  kok: '/vhosting8/apps',
  uygulama: 'odeme.ear',
  uyg_no: 1,
  war_no: 2,
  yol: 'odeme.ear/odeme-web.war',
  ad: 'odeme-web.war',
  bicim: 'ARSIV',
  durum: 'TAM',
  jsp: 12,
  tld: 1,
  tld_dizini: false,
  jar: 30,
  class_sayisi: 410,
  web_xml: true,
  web_varyantlari: 'web.xml + web-prod.xml',
  jboss_web_xml: null,
  jboss_deployment_structure: true,
  spring_boot: null,
  spring_framework: '5.3.31',
  spring_security: '5.8.0',
  log4j: '2.17.1',
  logback: null,
  jackson: '2.15.2',
  thymeleaf: null,
  struts: '2.5.33',
  servlet: '4.0',
  kutuphane_sayisi: 30,
};

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  window.localStorage.clear();
  m.degerler.mockResolvedValue({ ok: true, degerler: [], farkli: 0 });
});

/** Kolon seçicide kapalı her kolonu açar; seçicideki kolon sayısını döner. */
function hepsiniAc(): number {
  fireEvent.click(screen.getByRole('button', { name: /Kolonlar \(/ }));
  const secici = screen.getByLabelText('Kolon seçimi');
  const kutular = within(secici).getAllByRole('checkbox') as HTMLInputElement[];
  for (const k of kutular) if (!k.checked) fireEvent.click(k);
  expect(kutular.every((k) => k.checked)).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  return kutular.length;
}
const hucreler = (satirMetni: string) => {
  const satir = screen.getByText(satirMetni).closest('tr') as HTMLElement;
  return within(satir)
    .getAllByRole('cell')
    .map((c) => c.textContent || '');
};

describe('Uygulama Envanteri: bütün kolonlar', () => {
  it('Uygulamalar: her kolon başlıkta ve satırda; sürümler, sayılar, kararlar, boş değer', async () => {
    m.uygulamalar.mockResolvedValue({ ok: true, satirlar: [UYGULAMA], toplam: 1 });
    render(<UygulamalarGorunum onAc={vi.fn()} />);
    expect(await screen.findByText('odeme.ear')).toBeTruthy();
    const n = hepsiniAc();
    const tablo = screen.getByRole('table');
    expect(within(tablo).getAllByRole('columnheader').length).toBeGreaterThanOrEqual(n);
    const satir = hucreler('odeme.ear');
    // Ilk hucre secim kutusu, son hucre bagil tarama zamani (simdiye gore degisir).
    expect(satir.at(-1)).toMatch(/önce$/);
    expect(satir.slice(1, -1)).toEqual([
      'APPSRV01',
      'PROD',
      '7',
      '/vhosting/apps',
      'odeme.ear',
      'tam',
      'ACIK',
      '/opt/gercek/odeme.ear',
      'TAM',
      '3',
      '2.7.18',
      '5.3.31',
      '5.8.0',
      '4.0',
      '2.17.1',
      '1.2.12',
      '2.15.2',
      '3.1.2',
      '—', // struts yok
      '40',
      '2',
      '55',
      '900',
      '12',
      'evet',
      '1.200',
      '2',
      'odeme-web.war + odeme-api.war',
      'aynı',
      'kütüphane farklı',
      'karşılaştırılamadı',
    ]);
  });

  it('WAR’lar: tanımlayıcılar evet / hayır / ölçülmedi; varyantlar; sürümler', async () => {
    m.warlar.mockResolvedValue({ ok: true, satirlar: [WAR], toplam: 1 });
    render(<WarlarGorunum onAc={vi.fn()} />);
    expect(await screen.findByText('odeme-web.war')).toBeTruthy();
    const n = hepsiniAc();
    expect(
      within(screen.getByRole('table')).getAllByRole('columnheader').length,
    ).toBeGreaterThanOrEqual(n);
    expect(hucreler('odeme-web.war').slice(1)).toEqual([
      'APPSRV01',
      'PROD',
      '8',
      'odeme.ear',
      'odeme-web.war',
      'odeme.ear/odeme-web.war',
      'ARSIV',
      'tam',
      '—', // spring_boot yok
      '5.3.31',
      '5.8.0',
      '2.17.1',
      '—', // logback yok
      '2.15.2',
      '—', // thymeleaf yok
      '2.5.33',
      '4.0',
      '12',
      '1',
      'hayır', // tld dizini yok
      '30',
      '410',
      '30',
      'evet', // web.xml var
      'web.xml + web-prod.xml',
      '—', // jboss-web.xml olculmedi
      'evet', // jboss-deployment-structure var
    ]);
  });
});
