// src/components/server_hub/__tests__/retirement-vhost-plan.test.ts — VP1..VP3 (2026-10-08).
import { describe, expect, test } from 'vitest';
import { blokAyristir, jkAyristir, sonucAyristir } from '../retirementVhostPlan';

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

  test('VP4 mod_jk baglantilari: turler ayrisir, bozuk satir DUSMEZ', () => {
    expect(jkAyristir(['JK\tGLOBAL\t/usr/IBMIHS/conf/mod-jk.conf\t12\tJkMount /v/* voice_w'])).toEqual([
      { tur: 'GLOBAL', dosya: '/usr/IBMIHS/conf/mod-jk.conf', no: 12, metin: 'JkMount /v/* voice_w' }]);
    expect(jkAyristir(['JK\tNOT\t-\t0\thedef blokta JkMount yok'])[0]).toEqual({ tur: 'NOT', dosya: '', no: 0, metin: 'hedef blokta JkMount yok' });
    expect(jkAyristir(['JK\tUYDURMA\tx\t1\ty'])[0].tur).toBe('BILINMIYOR');
    expect(jkAyristir(['garip'])[0]).toEqual({ tur: 'BILINMIYOR', dosya: '', no: 0, metin: 'garip' });
    expect(jkAyristir(undefined)).toEqual([]);
  });
});
