// src/components/server_hub/rebootKontrolu.ts — Reboot Kontrolü satır ayrıştırıcıları (2026-10-08).
//
// Playbook (patch_remediation/reboot_check.yml) sunucu başına düz metin satırları döndürür:
//   görüntü : TYPE|NAME|COUNT|PIDS|USERS|DETAIL
//   plan    : FARK|DOWN|NEW|tip|ad|detay · ISLEM|kullanıcı|sıra|işlem|tip|ad|detay · BILGI|DOWN|NEW|tip|ad|mesaj
//   işlemler: SONUC|işlem|tip|ad|OK|FAIL|SKIP|mesaj
// Biçimi bozuk satır ATLANMAZ; ham metniyle taşınır (ekranda görünür, sessizce kaybolmaz).

export interface GoruntuSatiri { tip: string; ad: string; adet: number; kullanicilar: string }
export interface FarkSatiri { tur: 'DOWN' | 'NEW' | '?'; tip: string; ad: string }
export interface IslemSatiri { islem: string; tip: string; ad: string; sonuc: 'OK' | 'FAIL' | 'SKIP' | '?'; mesaj: string }
export interface BilgiSatiri { tur: string; tip: string; ad: string; mesaj: string }

export function goruntuAyristir(satirlar: unknown): GoruntuSatiri[] {
  if (!Array.isArray(satirlar)) return [];
  return satirlar
    .map((x) => String(x ?? ''))
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const p = l.split('|');
      return { tip: p[0] || '?', ad: p[1] || l, adet: Number(p[2]) || 0, kullanicilar: p[4] || '' };
    });
}

export function farkAyristir(satirlar: unknown): FarkSatiri[] {
  if (!Array.isArray(satirlar)) return [];
  return satirlar
    .map((x) => String(x ?? ''))
    .filter((l) => l.startsWith('FARK|'))
    .map((l) => {
      const p = l.split('|');
      const tur = p[1] === 'DOWN' || p[1] === 'NEW' ? p[1] : '?';
      return { tur, tip: p[2] || '?', ad: p[3] || l };
    });
}

export function islemAyristir(satirlar: unknown): IslemSatiri[] {
  if (!Array.isArray(satirlar)) return [];
  return satirlar
    .map((x) => String(x ?? ''))
    .filter((l) => l.startsWith('SONUC|'))
    .map((l) => {
      const p = l.split('|');
      const s = p[4] === 'OK' || p[4] === 'FAIL' || p[4] === 'SKIP' ? p[4] : '?';
      return { islem: p[1] || '?', tip: p[2] || '?', ad: p[3] || '?', sonuc: s, mesaj: p.slice(5).join('|') };
    });
}

export function bilgiAyristir(satirlar: unknown): BilgiSatiri[] {
  if (!Array.isArray(satirlar)) return [];
  return satirlar
    .map((x) => String(x ?? ''))
    .filter((l) => l.startsWith('BILGI|'))
    .map((l) => {
      const p = l.split('|');
      return { tur: p[1] || '?', tip: p[2] || '?', ad: p[3] || '?', mesaj: p.slice(4).join('|') };
    });
}

/** Kullanıcının yazdığı sunucu listesi: virgül / boşluk / satır; büyük harf, tekil. */
export function sunucuListesi(metin: string): string[] {
  return [...new Set(String(metin || '').split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

export const DURUM: Record<string, { etiket: string; ton: 'ok' | 'warning' | 'danger' | 'info' | 'muted' }> = {
  once_kosuyor: { etiket: 'Önce görüntüsü alınıyor', ton: 'info' },
  once_hazir: { etiket: 'Önce kaydedildi — reboot bekleniyor', ton: 'info' },
  once_hata: { etiket: 'Önce görüntüsü alınamadı', ton: 'danger' },
  sonra_kosuyor: { etiket: 'Reboot sonrası kontrol/düzeltme sürüyor', ton: 'info' },
  tamam: { etiket: 'Sorunsuz', ton: 'ok' },
  sorunlu: { etiket: 'Sorun kaldı', ton: 'danger' },
  sonra_hata: { etiket: 'Reboot sonrası iş sonuç vermedi', ton: 'danger' },
};
