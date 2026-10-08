// src/components/server_hub/__tests__/retirement-vhost-plan.test.ts — VP1..VP3 (2026-10-08).
import { describe, expect, test } from 'vitest';
import { blokAyristir, bloklaraBol, degisimTuru, jkAyristir, jkDegAyristir, kipAyristir, sonraMetni, sonucAyristir } from '../retirementVhostPlan';

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

  test('VP5 once/sonra: islem KIP satirindan, iki blok ayri grup, tasima satiri dosyada birakmaz', () => {
    expect(kipAyristir('KIP\tyorumla')).toEqual({ kip: 'yorumla' });
    expect(kipAyristir('KIP\ttasi\t/a/.retired/x.conf.1')).toEqual({ kip: 'tasi', hedef: '/a/.retired/x.conf.1' });
    expect(kipAyristir('KIP\tyok')).toEqual({ kip: 'yok' });
    expect(kipAyristir(undefined).kip).toBe('bilinmiyor');
    expect(kipAyristir('KIP\tuydurma').kip).toBe('bilinmiyor');
    const g = bloklaraBol([{ no: 10, metin: 'a' }, { no: 11, metin: 'b' }, { no: 30, metin: 'c' }, { no: 31, metin: 'd' }]);
    expect(g.map((x) => [x.bas, x.son, x.satirlar.length])).toEqual([[10, 11, 2], [30, 31, 2]]);
    expect(sonraMetni('  ServerName x', 'yorumla')).toBe('# [server-hub <zaman>]   ServerName x');
    expect(sonraMetni('x', 'yok')).toBe('x');
    expect(sonraMetni('x', 'tasi')).toBeNull();
    expect(sonraMetni('x', 'bilinmiyor')).toBeNull();
  });

  test('VP6 mod_jk degisiklikleri: once/sonra, eklenen satir once BOS; bicimsiz satir atilir', () => {
    expect(jkDegAyristir([
      'JKDEG\t/c/workers.properties\t3\tworker.list=a,vo,b\t# [server-hub 1 jk-list] worker.list=a,vo,b',
      'JKDEG\t/c/workers.properties\t3\t\tworker.list=a,b',
      'cop',
    ])).toEqual([
      { dosya: '/c/workers.properties', no: 3, once: 'worker.list=a,vo,b', sonra: '# [server-hub 1 jk-list] worker.list=a,vo,b' },
      { dosya: '/c/workers.properties', no: 3, once: '', sonra: 'worker.list=a,b' },
    ]);
    expect(jkDegAyristir(undefined)).toEqual([]);
  });

  test('VP7 renk turu: eklenen yesil, yorumlanan sari, geri almada acilan yesil, kalkan', () => {
    expect(degisimTuru('', 'worker.list=a,b')).toBe('eklenen');
    expect(degisimTuru('worker.list=a,vo,b', '# [server-hub 1 jk-list] worker.list=a,vo,b')).toBe('yorumlanan');
    expect(degisimTuru('# [server-hub 1 jk] worker.vo.port=1', 'worker.vo.port=1')).toBe('acilan');
    expect(degisimTuru('# [server-hub 1 jk-list] worker.list=a,vo', '')).toBe('kalkan');
    expect(degisimTuru('x', 'x')).toBe('ayni');
  });
});
