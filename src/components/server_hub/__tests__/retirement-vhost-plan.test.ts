// src/components/server_hub/__tests__/retirement-vhost-plan.test.ts — VP1..VP3 (2026-10-08).
import { describe, expect, test } from 'vitest';
import { blokAyristir, sonucAyristir } from '../retirementVhostPlan';

describe('kapatilacak vhost blogu', () => {
  test('VP1 BLOK satirlari satir no + metin; metindeki sekme korunur', () => {
    expect(blokAyristir(['BLOK\t4\t<VirtualHost *:443>', 'BLOK\t5\t  JkMount /x\tw1'])).toEqual([
      { no: 4, metin: '<VirtualHost *:443>' },
      { no: 5, metin: '  JkMount /x\tw1' },
    ]);
  });

  test('VP2 bozuk ya da eksik girdi sessizce DUSMEZ / bos liste olur', () => {
    expect(blokAyristir(['garip satir'])).toEqual([{ no: 0, metin: 'garip satir' }]);
    expect(blokAyristir(undefined)).toEqual([]);
    expect(blokAyristir('BLOK\t1\tx')).toEqual([]);
  });

  test('VP3 RESULT satiri: PLAN/FAIL ayrisir; satir YOKSA basari DEGIL "bilinmiyor"', () => {
    expect(sonucAyristir('RESULT\tapache_retire_vhost\tPLAN\tx.conf icinde 3 vhost var')).toEqual({ durum: 'PLAN', mesaj: 'x.conf icinde 3 vhost var' });
    expect(sonucAyristir('RESULT\tapache_retire_vhost\tFAIL\tblogu bulunamadi').durum).toBe('FAIL');
    expect(sonucAyristir(null).durum).toBe('BILINMIYOR');
    expect(sonucAyristir('cop').durum).toBe('BILINMIYOR');
  });
});
