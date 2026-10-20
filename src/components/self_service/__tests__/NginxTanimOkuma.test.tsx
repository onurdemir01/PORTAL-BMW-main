// src/components/self_service/__tests__/NginxTanimOkuma.test.tsx — Nginx - RVP Operations "read"
// (2026-10-20). Kullanıcı: "Read isteyen kişiye mevcut tanımlar / tanımlardan hangi location'a hangi
// uygulama cevap veriyor bunu gösterelim", "Ansible job'ını tetiklememize gerek yok".
//   NO1 ortam / servis yoksa sorgu yapılmaz, ne seçileceği söylenir
//   NO2 tablo: location, cevap veren uygulama, namespace, sunucular + filo; tutarsızlık; proxy
//       tahmini; tarama tarihi ve "iş başlatılmaz"; arama (Türkçe ı/i)
//   NO3 ölçülemedi ("tanım yok" DEĞİL) ve tanım yok ayrı; hata mesajı
//   NO4 GLOMO prod: yalnız yeni filo notu + listelenmeyen eski filo satırı
//   NO5 form: read seçilince tablo, "İş Başlat" yok ve launch() iş başlatmaz (kaynak bekçisi)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import fs from 'node:fs';
import path from 'node:path';
import NginxTanimOkuma from '@/components/self_service/NginxTanimOkuma';
import type { NginxTanimlar } from '@/api/selfServiceApi';

const mockOku = vi.hoisted(() => vi.fn());
vi.mock('@/api/selfServiceApi', () => ({ selfServiceApi: { nginxTanimlari: mockOku } }));

const VAR: NginxTanimlar = {
  ok: true,
  durum: 'var',
  env: 'PROD',
  service: 'WEBFORMS',
  taramaTarihi: '2026-10-19',
  glomoProd: false,
  eskiFiloGizli: 0,
  satirlar: [
    {
      location: '/ob/',
      tutarsiz: true,
      cevaplar: [
        { application: 'ob-app-v1', namespace: 'ob-prod', tahmin: false, hedef: null, sunucular: [{ host: 'GBNGXP44', filo: 'yeni' }] },
        { application: 'ob-app-v1', namespace: null, tahmin: true, hedef: 'https://ob-app-v1-ob-prod.apps.fw', sunucular: [{ host: 'GBRVPP01', filo: 'eski' }] },
      ],
    },
    {
      location: '/sigorta/',
      tutarsiz: false,
      cevaplar: [{ application: 'sigorta-app-v2', namespace: 'sigorta-prod', tahmin: false, hedef: null, sunucular: [{ host: 'GBNGXP45', filo: 'yeni' }] }],
    },
  ],
};

describe('Nginx tanım okuma (read)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('NO1 ortam / servis yoksa sorgu yok', () => {
    render(<NginxTanimOkuma env="" service="WEBFORMS" />);
    expect(screen.getByText('Tanımları görmek için ortam ve servis seçin.')).toBeTruthy();
    expect(mockOku).not.toHaveBeenCalled();
  });

  it('NO2 tablo, filo, tutarsızlık, tahmin, tarih, arama', async () => {
    mockOku.mockResolvedValue(VAR);
    render(<NginxTanimOkuma env="prod" service="webforms" namespace="ob-prod" />);
    expect(await screen.findByText('/ob/')).toBeTruthy();
    expect(mockOku).toHaveBeenCalledWith({ env: 'prod', service: 'webforms', namespace: 'ob-prod', application: undefined });
    expect(screen.getByText(/Read için iş başlatılmaz/).textContent).toMatch(/son tarama 2026-10-19; bugün yapılan değişiklik yarınki taramada görünür/);
    const ob = screen.getByText('/ob/').closest('tr') as HTMLElement;
    expect(within(ob).getByText('sunucular arasında farklı')).toBeTruthy();
    expect(within(ob).getByText('ob-prod')).toBeTruthy();
    expect(within(ob).getByText(/GBNGXP44/).textContent).toMatch(/yeni filo/);
    const eski = screen.getByText(/GBRVPP01/);
    expect(eski.textContent).toMatch(/eski filo/);
    expect(screen.getByText('(tahmin: proxy hedefinden)').getAttribute('title')).toBe('proxy hedefi: https://ob-app-v1-ob-prod.apps.fw');
    expect(screen.getByText(/location’da sunucular arasında farklı uygulama var/)).toBeTruthy();
    // arama: Türkçe büyük I → ı tuzağı
    fireEvent.change(screen.getByLabelText('Location, uygulama ya da namespace ara'), { target: { value: 'SIGORTA-APP' } });
    expect(screen.queryByText('/ob/')).toBeNull();
    expect(screen.getByText('/sigorta/')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Location, uygulama ya da namespace ara'), { target: { value: 'yok-boyle' } });
    expect(screen.getByText('Aramaya uyan location yok.')).toBeTruthy();
  });

  it('NO3 ölçülemedi ile tanım yok ayrı; hata', async () => {
    mockOku.mockResolvedValue({ ok: true, durum: 'olculemedi', sebep: 'Tanım taraması okunamadı: zaman aşımı', env: 'TEST', service: 'GLOMO', satirlar: [] });
    const { unmount } = render(<NginxTanimOkuma env="test" service="glomo" />);
    expect(await screen.findByText(/Tanım taraması okunamadı: zaman aşımı Bu “tanım yok” demek değildir\./)).toBeTruthy();
    unmount();
    mockOku.mockResolvedValue({ ok: true, durum: 'yok', env: 'TEST', service: 'GLOMO', taramaTarihi: '2026-10-19', satirlar: [] });
    const u2 = render(<NginxTanimOkuma env="test" service="glomo" />);
    expect(await screen.findByText(/Son taramada bu ortam \/ servis için tanım yok/)).toBeTruthy();
    expect(screen.queryByText(/tanım yok” demek değildir/)).toBeNull();
    u2.unmount();
    mockOku.mockResolvedValue({ ok: false, message: 'Ortam ve servis seçilmeli.', satirlar: [] });
    render(<NginxTanimOkuma env="x" service="y" />);
    expect(await screen.findByText('Ortam ve servis seçilmeli.')).toBeTruthy();
  });

  it('NO4 GLOMO prod: yalnız yeni filo notu', async () => {
    mockOku.mockResolvedValue({ ...VAR, env: 'PROD', service: 'GLOMO', glomoProd: true, eskiFiloGizli: 7 });
    render(<NginxTanimOkuma env="prod" service="glomo" />);
    expect(await screen.findByText(/GLOMO production: yalnız/)).toBeTruthy();
    expect(screen.getByText(/GLOMO production: yalnız/).textContent).toMatch(/eski filoya hiçbir işte gidilmez \(7 eski filo satırı listelenmedi\)/);
  });

  it('NO5 form: read seçilince tablo, İş Başlat yok, launch iş başlatmaz', () => {
    const sp = fs.readFileSync(path.resolve(__dirname, '..', '..', 'SelfServicePage.tsx'), 'utf8');
    expect(sp).toMatch(/setYerelOkuma\(r\.yerelOkuma \|\| null\);/);
    expect(sp).toMatch(/const yerelOkumaAktif =\s*!!yerelOkuma && alanDegeri\(yerelOkuma\.eylemAlanlari\)\.toLowerCase\(\) === yerelOkuma\.deger;/);
    expect(sp).toMatch(/async function launch\(ocoAction\?: 'schedule' \| 'later'\) \{\s*if \(yerelOkumaAktif\) return;/);
    expect(sp).toMatch(/\{!jobId && !pendingTicket && !ocoState && !yerelOkumaAktif && \(/);
    expect(sp).toMatch(/env=\{alanDegeri\(\['env', 'ortam'\]\)\}/);
    expect(sp).toMatch(/service=\{alanDegeri\(\['service', 'servis'\]\)\}/);
    expect(sp).toMatch(/\{yerelOkumaAktif && !resultView && \(\s*<NginxTanimOkuma/);
    expect(sp).toMatch(/if \(adlar\.includes\(k\.toLowerCase\(\)\)\) return String\(v \?\? ''\)\.trim\(\);/);
  });
});
