// src/components/server_hub/__tests__/retirement-adim.test.ts — RA1..RA6 (2026-10-08).
//
// Kullanici: "plan ve akis butonlari bir garip gozukuyor" -> tek dugmeli akis: once ON
// KONTROL (hicbir sey degismez), sonra ONAY. Ayrinti: ../retirementAdim.ts basligi.
//
// EN PAHALI UC YANLIS:
//   1. Geri alinamaz adimi (STOP) on kontrol bitmeden sunmak.
//   2. OCO'ya ZAMANLANMIS hedefte on kontrol sunmak: sunucu hedefi 'planning'e cekiyor ve
//      zamanlanmis STOP sessizce dusuyordu.
//   3. Iptal edilmis kayitta eylem sunmak.
import { describe, expect, test } from 'vitest';
import { retirementAdimi } from '../retirementAdim';
import type { RtTargetStatus } from '@/api/retirementApi';

const HEPSI: RtTargetStatus[] = [
  'pending', 'planning', 'planned', 'stop_scheduled', 'stopping', 'stopped',
  'deleting', 'deleted', 'rolling_back', 'active', 'rollback_failed', 'failed', 'skipped',
];

describe('retirement satir adimi', () => {
  test('RA1 bekleyen hedef: tek giris "Retirement\'i baslat" = ON KONTROL, hicbir sey degismez', () => {
    const a = retirementAdimi('pending', false);
    expect(a.tur).toBe('baslat');
    expect(a.etiket).toBe("Retirement'ı başlat");
    expect(a.ipucu).toMatch(/HİÇBİR ŞEY DEĞİŞMEZ/);
  });

  test('RA2 onay (STOP kapisi) YALNIZ on kontrol hazirken', () => {
    const onaylar = HEPSI.filter((s) => retirementAdimi(s, false).tur === 'onayla');
    expect(onaylar).toEqual(['planned']);
    expect(retirementAdimi('planned', false).yenile).toBe(true);
  });

  test('RA3 OCO\'ya ZAMANLANMIS hedefte on kontrol SUNULMAZ (zamanlamayi dusururdu)', () => {
    expect(retirementAdimi('stop_scheduled', false).tur).toBe('yok');
  });

  test('RA4 gecis ve son durumlarda birincil dugme yok', () => {
    for (const s of ['stopping', 'stopped', 'deleting', 'deleted', 'rolling_back', 'rollback_failed'] as RtTargetStatus[])
      expect(retirementAdimi(s, false).tur, s).toBe('yok');
    expect(retirementAdimi('planning', false).tur).toBe('suruyor');
  });

  test('RA5 basarisiz hedef yeniden baslatilir - yine ON KONTROLDEN (dogrudan STOP degil)', () => {
    const a = retirementAdimi('failed', false);
    expect(a.tur).toBe('baslat');
    expect(a.etiket).toMatch(/yeniden/);
    // Geri alinmis (active) uygulama tekrar retire edilebilir
    expect(retirementAdimi('active', false).tur).toBe('baslat');
  });

  test('RA6 kapali (iptal/silinmis) kayitta HICBIR durumda eylem yok', () => {
    for (const s of HEPSI) expect(retirementAdimi(s, true).tur, s).toBe('yok');
  });
});
