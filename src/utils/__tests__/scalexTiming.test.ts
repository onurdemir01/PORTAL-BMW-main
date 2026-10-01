// src/utils/__tests__/scalexTiming.test.ts — keşif iş kırılımı (PR-O).
import { describe, expect, it } from 'vitest';
import type { ScaleXDiscoveryTiming } from '@/api/scalexApi';
import { jobBreakdowns } from '../scalexTiming';

const satir = (o: Partial<ScaleXDiscoveryTiming>): ScaleXDiscoveryTiming => ({
  id: 1,
  env: 'lab',
  tenant: 't',
  clusterName: 'c1',
  namespace: 'ns1',
  mode: 'workloads',
  kinds: 6,
  cached: true,
  setupMs: 500,
  discoverMs: 1000,
  elapsedMs: 1500,
  awxJobId: 7,
  createdAt: '2026-10-01T10:00:00Z',
  queueMs: 2000,
  bootMs: 8000,
  prepMs: 3000,
  transportMs: 4000,
  publishMs: 1000,
  jobMs: 17000,
  ...o,
});

describe('jobBreakdowns', () => {
  it('iş başına tek satır; runner cluster maksimumu, kalan = toplam - paylar', () => {
    const r = jobBreakdowns([
      satir({ clusterName: 'c1', elapsedMs: 1500 }),
      satir({ id: 2, clusterName: 'c2', elapsedMs: 3200 }),
      satir({ id: 3, clusterName: 'c3', elapsedMs: 900 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].clusters).toBe(3);
    expect(r[0].runnerMaxMs).toBe(3200);
    // 17000 - (8000 + 3000 + 4000 + 1000)
    expect(r[0].restMs).toBe(1000);
    expect(r[0].queueMs).toBe(2000);
  });

  it('ölçülmeyen pay varsa kalan NULL (sıfır sayılıp şişirilmez)', () => {
    const [j] = jobBreakdowns([satir({ bootMs: null })]);
    expect(j.restMs).toBeNull();
    expect(j.bootMs).toBeNull();
  });

  it('saat kayması negatif kalan üretirse NULL', () => {
    const [j] = jobBreakdowns([satir({ jobMs: 10000 })]);
    expect(j.restMs).toBeNull();
  });

  it('kırılımı olmayan eski satırlar ve işsiz satırlar listelenmez', () => {
    const r = jobBreakdowns([
      satir({ awxJobId: 8, queueMs: null, transportMs: null, jobMs: null }),
      satir({ awxJobId: null }),
    ]);
    expect(r).toEqual([]);
  });

  it('farklı işler ayrı, sıra korunur (yeniden eskiye)', () => {
    const r = jobBreakdowns([satir({ awxJobId: 9 }), satir({ awxJobId: 7 })]);
    expect(r.map((x) => x.awxJobId)).toEqual([9, 7]);
  });
});
