// src/utils/__tests__/csv.test.ts — ortak CSV yardımcısı.
//
// Aynı 8-10 satır portalda 20'den fazla ekranda yeniden yazılmıştı ve ayrıntılar
// ayrışmıştı (ayırıcı, BOM biçimi, satır sonu). Bu testler yardımcının
// SÖZLEŞMESİNİ kilitliyor; en kritik olanları kaçış ve BOM.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toCsv, csvCell, csvSeparator, CSV_SEPARATORS, CSV_SEPARATOR_PREF } from '../csv';
import { prefsApi } from '@/api/prefsApi';

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

  it('CV7 ayırıcı KULLANICI TERCİHİNDEN okunur', () => {
    // Ayırıcı portalda ikiye bölünmüştü; sabitlemek yerine kullanıcı başına
    // tercih yapıldı. Çağıran taraf açıkça bir değer vermedikçe tercih kazanır.
    vi.spyOn(prefsApi, 'get').mockReturnValue(',');
    expect(csvSeparator()).toBe(',');
    expect(toCsv(['a'], [[1]])).toBe('"a"\r\n"1"'); // tek sütunda fark görünmez
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('"a","b"\r\n"1","2"');
    vi.restoreAllMocks();
  });

  it('CV8 GEÇERSİZ tercih varsayılana düşer (dosya sessizce bozulmaz)', () => {
    // Serbest metin kabul edilseydi bir harf ya da tırnak ayırıcı olarak
    // yazılabilir ve üretilen dosya SESSİZCE bozulurdu.
    for (const kotu of ['x', '"', '', '\t', ';;']) {
      vi.spyOn(prefsApi, 'get').mockReturnValue(kotu);
      expect(CSV_SEPARATORS).toContain(csvSeparator());
      vi.restoreAllMocks();
    }
  });

  it('CV9 tercih OKUNAMAZSA indirme yine çalışır', () => {
    // CSV indirmek bir tercih okumasına BAĞIMLI olmamalı.
    vi.spyOn(prefsApi, 'get').mockImplementation(() => {
      throw new Error('prefs yok');
    });
    expect(CSV_SEPARATORS).toContain(csvSeparator());
    expect(() => toCsv(['a'], [[1]])).not.toThrow();
    vi.restoreAllMocks();
  });

  it('CV10 tercih anahtarı sabit (menü ile yardımcı ayrışmasın)', () => {
    expect(CSV_SEPARATOR_PREF).toBe('csv_separator');
  });

  it('CV4 ayırıcı DEĞİŞTİRİLEBİLİR (eski ekranlar biçimini koruyabilsin)', () => {
    expect(toCsv(['a', 'b'], [[1, 2]], { separator: ',' })).toBe('"a","b"\r\n"1","2"');
  });

  it('CV5 satır yoksa yalnızca başlık döner (boş dosya değil)', () => {
    expect(toCsv(['a', 'b'], [])).toBe('"a";"b"');
  });

  it('CV6 kaynakta GÖRÜNMEZ BOM karakteri taşınmaz', () => {
    // Bu dosyanın var oluş sebebi tutarsızlığı kapatmak; kaynağa görünmez bir
    // karakter koymak aynı sınıfın yeni bir örneği olurdu (ESLint
    // `no-irregular-whitespace` da uyarır).
    //
    // Kaynağı `fs` ile okuruz: ilk yazımda `import('../csv?raw')` kullanılmıştı
    // ve Vite bunu çözse de `tsc` "Cannot find module" diyordu — tip denetimi
    // D1'in SON doğrulamasında koşturulmadığı için o kırmızı sessizce geçmişti.
    const BOM = String.fromCharCode(0xfeff);
    const kaynak = readFileSync(resolve(process.cwd(), 'src/utils/csv.ts'), 'utf8');
    expect(kaynak).not.toContain(BOM);
    // Kaçış dizisi DURMALI — BOM'un kendisi gerekli, yalnızca YAZIMI önemli.
    expect(kaynak).toContain('\\uFEFF');
  });
});
