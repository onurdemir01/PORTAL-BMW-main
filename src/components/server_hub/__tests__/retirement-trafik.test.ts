// src/components/server_hub/__tests__/retirement-trafik.test.ts — RT1..RT5 (2026-10-08).
// On kontrolde taze vhost trafigi + STOP onay kapisi. Ayrinti: ../retirementTrafik.ts.
import { describe, expect, test } from 'vitest';
import { stopTrafikOzeti, stopOnayAcikMi } from '../retirementTrafik';
import type { RtDiscovery, RtWeb } from '@/api/retirementApi';

const W = (host: string, serverName: string, port = '443'): RtWeb => ({ host, serverName, product: 'IHS', port, confFile: '/c' });
const hedef = { host: 'GBJBOT07', appName: 'GBSVCVOICEORDER-D', web: [W('GBJBOT07', 'gbsvcvoiceorder-d.fw', '443'), W('GBJBOT07', 'gbsvcvoiceorder-d.fw', '80')] };
const kesif = (trafik: RtWeb['trafik']): RtDiscovery => ({
  ok: true, base: 'GBSVCVOICEORDER',
  targets: [{ host: 'gbjbot07', appName: 'GBSVCVOICEORDER-D', site: 'Pendik', env: 'DEV', gen: 7, appPath: '', inventoryStatus: '', domain: '', tier: '', webHow: '', hub: null,
    web: [{ ...W('GBJBOT07', 'GBSVCVOICEORDER-D.fw'), trafik }] }],
  summary: { total: 1, bySite: { Pendik: 1, Ankara: 0 }, byEnv: {}, webMatched: 1, prod: false },
});

describe('STOP onayinda vhost trafigi', () => {
  test('RT1 ayni vhost (:80 + :443) TEK satir; eslesme host/ad kasasina duyarsiz', () => {
    const o = stopTrafikOzeti(hedef, kesif({ durum: 'var', req7: 12 }));
    expect(o.satirlar).toHaveLength(1);
    expect(o.var).toBe(1);
  });

  test('RT2 kesif YOK ya da vhost eslesmedi -> OLCULEMEDI ("yok" DEGIL)', () => {
    expect(stopTrafikOzeti(hedef, null).olculemedi).toBe(1);
    expect(stopTrafikOzeti(hedef, null).yok).toBe(0);
    const baska = { ...hedef, web: [W('GBJBOT07', 'baska.fw')] };
    expect(stopTrafikOzeti(baska, kesif({ durum: 'yok', req7: 0 })).olculemedi).toBe(1);
  });

  test('RT3 istek VARSA onay kutusu olmadan STOP ACILMAZ', () => {
    const o = stopTrafikOzeti(hedef, kesif({ durum: 'var', req7: 3 }));
    expect(stopOnayAcikMi(o, 'bitti', false, false)).toBe(false);
    expect(stopOnayAcikMi(o, 'bitti', true, false)).toBe(true);
  });

  test('RT4 tarama SURERKEN kilitli; "olcumu bekleme" bilerek secilirse acilir', () => {
    const o = stopTrafikOzeti(hedef, kesif({ durum: 'yok', req7: 0 }));
    expect(stopOnayAcikMi(o, 'suruyor', false, false)).toBe(false);
    expect(stopOnayAcikMi(o, 'suruyor', false, true)).toBe(true);
    // beklemeyi atlamak istek-var kapisini ATLATMAZ
    const v = stopTrafikOzeti(hedef, kesif({ durum: 'var', req7: 1 }));
    expect(stopOnayAcikMi(v, 'suruyor', false, true)).toBe(false);
  });

  test('RT5 olculemedi ya da tarama hatasi STOP\'u KILITLEMEZ (uyari ekranda); web yoksa kapi yok', () => {
    expect(stopOnayAcikMi(stopTrafikOzeti(hedef, null), 'hata', false, false)).toBe(true);
    const websiz = stopTrafikOzeti({ ...hedef, web: [] }, null);
    expect(websiz.satirlar).toHaveLength(0);
    expect(stopOnayAcikMi(websiz, undefined, false, false)).toBe(true);
  });
});
