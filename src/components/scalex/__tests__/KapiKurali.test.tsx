// src/components/scalex/__tests__/KapiKurali.test.tsx
//
// EKRAN ADMIN AYARINI SÖYLER, SABİT CÜMLE DEĞİL (2026-10-14).
//
// Kullanıcı: "Admin ekranında yalnız OCO dedim ama prod seçince yine 'SMART kaydı açılacak,
// ikinci kişi onayı istenir' yazıyor; her şey admin ekranıyla dinamik olmalı." Kapsam
// adımındaki uyarı ve toplu geri alma kutusu sabit cümlelerdi; "ikinci kişi onayı" sunucuda
// hiç uygulanmıyordu.
//
// GİRDİLER UYDURMA DEĞİL: `fixtures/kapi-yanitlari.json` içindeki `ozet` bölümü sunucunun
// gerçek `/gate-summary` yanıtlarıdır (simülatör, KM19 üretir ve karşılaştırır). API
// taklit edilmez: gerçek `scalexApi` + `okJson` çalışır, yalnız `fetch` sahtedir.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { render } from '@/test/test-utils';
import type { ScaleXGateStatus, ScaleXGateSummary, ScaleXStoppedItem } from '@/api/scalexApi';
import { degisiklikKurali, geriAlmaKurali } from '@/components/scalex/kapiMetni';

vi.mock('@/contexts/JobTrackerContext', () => ({ useJobTracker: () => ({ addJob: vi.fn() }) }));

import ScopeStep from '@/components/scalex/steps/ScopeStep';
import StoppedPanel from '@/components/scalex/StoppedPanel';
import ScaleXKapiDurumu from '@/components/admin/tabs/ScaleXKapiDurumu';

type OzetAdi =
  | 'gerekli_tanimsiz'
  | 'gerekli_hazir'
  | 'yalniz_oco'
  | 'yonetici_atlar'
  | 'istisna_namespace'
  | 'oco_kapali_yalniz_oco'
  | 'prod_disi_oco_listesinde'
  | 'prod_disi';
const ORNEK = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'src/components/scalex/__tests__/fixtures/kapi-yanitlari.json'),
    'utf8',
  ),
) as {
  ozet: Record<OzetAdi, ScaleXGateSummary>;
  kart: Record<'tanimsiz' | 'hazir' | 'kapali', ScaleXGateStatus>;
};
const OZET = ORNEK.ozet;
let kartYaniti: () => Response = () => json(200, ORNEK.kart.kapali);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let ozetYaniti: () => Response;
let ozetIstekleri: string[];

beforeEach(() => {
  ozetIstekleri = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/scalex/clusters'))
        return json(200, { ok: true, tree: { prod: { t1: ['c1'] }, test: { t1: ['c1'] } } });
      if (u.includes('/api/scalex/admin/gate-status')) return kartYaniti();
      if (u.includes('/api/scalex/gate-summary')) {
        ozetIstekleri.push(u);
        return ozetYaniti();
      }
      if (u.includes('/api/scalex/stopped')) {
        const it: ScaleXStoppedItem = {
          id: 1,
          env: 'prod',
          tenant: 't1',
          clusterName: 'c1',
          namespace: 'odeme',
          appName: 'api',
          workloadKind: 'Deployment',
          previousReplicas: 2,
          phase: 'scaled_down',
          stoppedBy: 'ayse',
          stoppedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          driftStatus: 'in_sync',
        } as ScaleXStoppedItem;
        return json(200, {
          ok: true,
          items: [it],
          hiddenCount: 0,
          hiddenByOwnership: 0,
          truncated: false,
          limit: 500,
        });
      }
      throw new Error(`beklenmeyen istek: ${u}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const metin = (k: ReturnType<typeof degisiklikKurali>) => (k ? k.satirlar.join(' ') : '');

describe('Kapı metni: sunucunun kararından üretilir', () => {
  it('KK1 her durumda doğru cümle; "ikinci kişi" vaadi hiçbir durumda yok', () => {
    expect(degisiklikKurali(OZET.gerekli_tanimsiz.change)?.ton).toBe('engel');
    expect(metin(degisiklikKurali(OZET.gerekli_tanimsiz.change))).toMatch(/SMART onayı/);

    const hazir = metin(degisiklikKurali(OZET.gerekli_hazir.change));
    expect(hazir).toMatch(/OCO numarası istenecek/);
    expect(hazir).toMatch(/SMART kaydı açılacak/);

    const ocoOnly = metin(degisiklikKurali(OZET.yalniz_oco.change));
    expect(ocoOnly).toMatch(/OCO numarası istenecek/);
    expect(ocoOnly).toMatch(/yalnız OCO/);
    expect(ocoOnly).not.toMatch(/SMART kaydı açılacak/);

    expect(metin(degisiklikKurali(OZET.yonetici_atlar.change))).toMatch(/Yönetici tercihiniz/);
    expect(
      metin(
        degisiklikKurali(OZET.istisna_namespace.change, {
          secimeBagli: OZET.istisna_namespace.secimeBagliKural,
        }),
      ),
    ).toMatch(/Kesin karar/);
    expect(metin(degisiklikKurali(OZET.oco_kapali_yalniz_oco.change))).toMatch(
      /OCO kapısı yönetici tarafından kapatıldı/,
    );

    const listede = metin(degisiklikKurali(OZET.prod_disi_oco_listesinde.change));
    expect(listede).toMatch(/OCO numarası istenecek/);
    expect(listede).not.toMatch(/SMART/);
    expect(degisiklikKurali(OZET.prod_disi.change)).toBeNull();

    for (const o of Object.values(OZET)) {
      expect(metin(degisiklikKurali(o.change))).not.toMatch(/ikinci kişi/i);
      expect(geriAlmaKurali(o.restore).satirlar.join(' ')).not.toMatch(/ikinci kişi/i);
    }
  });

  it('KK2 geri alma cümlesi: yalnız OCO iken SMART kaydı vaat edilmez', () => {
    expect(geriAlmaKurali(OZET.yalniz_oco.restore).satirlar[0]).toMatch(
      /SMART kaydı açılmaz \(yönetici ayarı: yalnız OCO\)/,
    );
    expect(geriAlmaKurali(OZET.gerekli_hazir.restore).satirlar[0]).toMatch(/SMART talebi açılır/);
    expect(geriAlmaKurali(OZET.gerekli_tanimsiz.restore).ton).toBe('engel');
    expect(geriAlmaKurali(OZET.prod_disi.restore).satirlar[0]).toBe('gerekçe zorunludur.');
  });
});

async function kapsamSec(env: string) {
  render(<ScopeStep busy={false} onSubmit={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: env }));
  fireEvent.click(screen.getByRole('button', { name: 't1' }));
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('Kapsam adımı: prod uyarısı admin ayarını izler', () => {
  it('KK3 yalnız OCO: "SMART kaydı açılacak" ve "ikinci kişi" YAZMAZ, yalnız OCO yazar', async () => {
    ozetYaniti = () => json(200, OZET.yalniz_oco);
    await kapsamSec('prod');
    const kutu = await screen.findByTestId('scalex-kapsam-kurali');
    expect(kutu.textContent).toMatch(/Prod ortamı\./);
    expect(kutu.textContent).toMatch(/OCO numarası istenecek/);
    expect(kutu.textContent).toMatch(/yalnız OCO/);
    expect(kutu.textContent).not.toMatch(/SMART kaydı açılacak/);
    expect(kutu.textContent).not.toMatch(/ikinci kişi/i);
    // Sunucuya seçilen kapsam gider (istisna kuralı tenant / cluster sayısına bakabilir).
    await waitFor(() =>
      expect(ozetIstekleri.some((u) => /env=prod&tenant=t1&clusters=c1/.test(u))).toBe(true),
    );
  });

  it('KK4 SMART gerekli ve tanımlı: OCO + SMART söylenir', async () => {
    ozetYaniti = () => json(200, OZET.gerekli_hazir);
    await kapsamSec('prod');
    const kutu = await screen.findByTestId('scalex-kapsam-kurali');
    expect(kutu.textContent).toMatch(/SMART kaydı açılacak/);
    expect(kutu.getAttribute('role')).toBeNull();
  });

  it('KK5 SMART gerekli ama tanımsız: engel, sunucunun metni (role=alert)', async () => {
    ozetYaniti = () => json(200, OZET.gerekli_tanimsiz);
    await kapsamSec('prod');
    const kutu = await screen.findByTestId('scalex-kapsam-kurali');
    expect(kutu.getAttribute('role')).toBe('alert');
    expect(kutu.textContent).toContain(OZET.gerekli_tanimsiz.change.blocked!.message);
  });

  it('KK6 prod dışı ama OCO listesinde: OCO söylenir; listede değilse uyarı YOK', async () => {
    ozetYaniti = () => json(200, OZET.prod_disi_oco_listesinde);
    await kapsamSec('test');
    const kutu = await screen.findByTestId('scalex-kapsam-kurali');
    expect(kutu.textContent).toMatch(/test ortamı\./);
    expect(kutu.textContent).toMatch(/OCO numarası istenecek/);
  });

  it('KK7 prod dışı, kapı yok: uyarı görünmez', async () => {
    ozetYaniti = () => json(200, OZET.prod_disi);
    await kapsamSec('test');
    await waitFor(() => expect(ozetIstekleri.length).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(screen.queryByTestId('scalex-kapsam-kurali')).toBeNull();
  });

  it('KK8 kural okunamazsa VAAT YOK: yalnız prod vurgusu ve önizlemeye yönlendirme', async () => {
    ozetYaniti = () => json(500, { ok: false, message: 'DB yok' });
    await kapsamSec('prod');
    const kutu = await screen.findByTestId('scalex-kapsam-kurali');
    expect(kutu.textContent).toMatch(/okunamadı/);
    expect(kutu.textContent).not.toMatch(
      /SMART kaydı açılacak|OCO numarası istenecek|ikinci kişi/i,
    );
  });
});

describe('Toplu geri alma kutusu: kural admin ayarından', () => {
  async function kutuyuAc() {
    render(<StoppedPanel env="prod" tenant="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Tümünü geri al/ }));
  }

  it('KK9 yalnız OCO: "SMART kaydına da yazılır" YAZMAZ', async () => {
    ozetYaniti = () => json(200, OZET.yalniz_oco);
    await kutuyuAc();
    await waitFor(() =>
      expect(screen.getByTestId('scalex-geri-alma-kurali').textContent).toMatch(/yalnız OCO/),
    );
    expect(screen.getByTestId('scalex-geri-alma-kurali').textContent).not.toMatch(
      /SMART kaydına da yazılır/,
    );
  });

  it('KK10 SMART gerekli ama tanımsız: engel metni görünür, onay düğmesi kapalı', async () => {
    ozetYaniti = () => json(200, OZET.gerekli_tanimsiz);
    await kutuyuAc();
    fireEvent.change(screen.getByLabelText('Toplu geri alma gerekçesi'), {
      target: { value: 'INC-1' },
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/SMART onayı/));
    const dugmeler = screen.getAllByRole('button', { name: /Tümünü geri al/ });
    expect(dugmeler[dugmeler.length - 1]).toBeDisabled();
  });
});

describe('Admin kartı: OCO kapsamı ayardan', () => {
  it('KK11 OCO istenen ortamlar gerçek ayarı söyler (liste yok / liste / kapalı)', async () => {
    const { unmount } = render(<ScaleXKapiDurumu />);
    expect((await screen.findByTestId('scalex-oco-kapsami')).textContent).toMatch(
      /yalnız production/,
    );
    unmount();

    kartYaniti = () =>
      json(200, { ...ORNEK.kart.kapali, oco: { enabled: true, environments: ['prod', 'test'] } });
    const ikinci = render(<ScaleXKapiDurumu />);
    expect((await screen.findByTestId('scalex-oco-kapsami')).textContent).toMatch(/prod, test/);
    ikinci.unmount();

    kartYaniti = () =>
      json(200, { ...ORNEK.kart.kapali, oco: { enabled: false, environments: null } });
    render(<ScaleXKapiDurumu />);
    expect((await screen.findByTestId('scalex-oco-kapsami')).textContent).toMatch(
      /OCO kapısı kapalı/,
    );
    kartYaniti = () => json(200, ORNEK.kart.kapali);
  });
});
