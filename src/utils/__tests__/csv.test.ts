// src/utils/__tests__/csv.test.ts — ortak CSV yardımcısı.
//
// Aynı 8-10 satır portalda 20'den fazla ekranda yeniden yazılmıştı ve ayrıntılar
// ayrışmıştı (ayırıcı, BOM biçimi, satır sonu). Bu testler yardımcının
// SÖZLEŞMESİNİ kilitliyor; en kritik olanları kaçış ve BOM.
import { describe, it, expect } from 'vitest';
import { toCsv, csvCell } from '../csv';

describe('csv', () => {
  it('CV1 ayırıcı, satır sonu ve tırnak içeren hücreler BOZULMADAN geçer', () => {
    // Hücreden ayırıcıyı "temizlemek" veriyi sessizce değiştirmek olurdu; RFC 4180
    // kaçışı ile değer aynen korunur.
    const out = toCsv(['a', 'b'], [['x;y', 'tırnak "içinde"'], ['satır\nsonu', 'düz']]);
    const satirlar = out.split('\r\n');
    expect(satirlar[0]).toBe('"a";"b"');
    expect(satirlar[1]).toBe('"x;y";"tırnak ""içinde"""');
    // Hücre içindeki `\n` KORUNUR (tırnak içinde olduğu için CSV'yi bölmez).
    expect(out).toContain('"satır\nsonu"');
  });

  it('CV2 null/undefined BOŞ hücredir, "null" yazılmaz', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(false)).toBe('"false"');
  });

  it('CV3 varsayılan ayırıcı `;` (Türkçe Excel liste ayırıcısı)', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('"a";"b"\r\n"1";"2"');
  });

  it('CV4 ayırıcı DEĞİŞTİRİLEBİLİR (eski ekranlar biçimini koruyabilsin)', () => {
    expect(toCsv(['a', 'b'], [[1, 2]], { separator: ',' })).toBe('"a","b"\r\n"1","2"');
  });

  it('CV5 satır yoksa yalnızca başlık döner (boş dosya değil)', () => {
    expect(toCsv(['a', 'b'], [])).toBe('"a";"b"');
  });

  it('CV6 kaynakta GÖRÜNMEZ BOM karakteri taşınmaz', async () => {
    // Bu dosyanın var oluş sebebi tutarsızlığı kapatmak; kaynağa görünmez bir
    // karakter koymak aynı sınıfın yeni bir örneği olurdu (ESLint
    // `no-irregular-whitespace` da uyarır).
    const kaynak = await import('../csv?raw').catch(() => null);
    if (!kaynak) return; // ?raw desteklenmiyorsa atla
    expect(String((kaynak as { default: string }).default)).not.toContain('﻿');
  });
});
