// src/components/nginx_console/yukTesti/kuyrukTaslak.ts — Gece kuyrugu taslagi ve saf yardimcilar (2026-11-03).
//
// Taslak (henuz olusturulmamis kuyruk) yalniz bu tarayicida: "Yeni koşu" formundan "Kuyruğa ekle" ile birikir,
// "Gece kuyruğu" bolumunde siralanir ve "Kuyruğu oluştur" ile sunucuya gider. localStorage yalniz kolaylik:
// okunamazsa / yazilamazsa taslak bellekte kalir (sunucuya giden her sey olusturma isteginde).
import type { NlKuyrukDurum, NlKuyrukGovde, NlKuyrukOgeDurum } from '@/api/nginxLoadtestApi';
import type { Ton } from '@/components/server_hub/retirementStil';
import { fmtTime } from '@/utils/datetime';

export interface TaslakOge {
  yerelId: string;
  /** Zorunlu: kullanicinin bu kosuda ne degistirdigi (ör. "A3 brotli seviye 4"); kosu etiketine yazilir. */
  etiket: string;
  govde: NlKuyrukGovde;
  /** Formda bu ayarlarla bitmis on kontrol varsa (uyari turleri olusturmada onaya gelir). */
  onKontrolKosuId: number | null;
  /** Onay icin hedef: sunucu adi ya da serbestte IP (sunucu yine kendisi hesaplar). */
  hedef: string;
  ozet: string;
  butceSn: number | null;
}

export const TASLAK_ANAHTARI = 'nginx-yuk-testi:kuyruk-taslagi';
export const ETIKET_MAX = 100;
export const BEKLEME_VARSAYILAN_DK = 5;

let _sayac = 0;
/** Taslak ogesinin yerel kimligi (yalniz liste anahtari). */
export function yeniYerelId(): string {
  _sayac += 1;
  return `${Date.now().toString(36)}-${_sayac}`;
}

export function taslakOku(): TaslakOge[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(TASLAK_ANAHTARI) || '[]');
    return Array.isArray(v) ? v.filter((o) => o && typeof o.etiket === 'string' && o.govde && typeof o.yerelId === 'string') : [];
  } catch {
    return [];
  }
}

export function taslakYaz(t: TaslakOge[]) {
  try {
    if (t.length) window.localStorage.setItem(TASLAK_ANAHTARI, JSON.stringify(t));
    else window.localStorage.removeItem(TASLAK_ANAHTARI);
  } catch {
    /* kolaylik: yazilamazsa bellekte kalir */
  }
}

/** Dizide bir ogeyi yukari / asagi tasir (sinirda degismez). */
export function tasi<T>(dizi: T[], i: number, yon: -1 | 1): T[] {
  const j = i + yon;
  if (i < 0 || i >= dizi.length || j < 0 || j >= dizi.length) return dizi;
  const d = dizi.slice();
  [d[i], d[j]] = [d[j], d[i]];
  return d;
}

/** "HH:MM" -> `referans`tan sonraki (ya da esit) ilk yerel an. Gecersizse null. */
export function sonrakiSaat(hhmm: string, referans: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const sa = Number(m[1]);
  const dk = Number(m[2]);
  if (sa > 23 || dk > 59) return null;
  const t = new Date(referans);
  t.setHours(sa, dk, 0, 0);
  if (t.getTime() < referans.getTime()) t.setDate(t.getDate() + 1);
  return t;
}

/** Secilen baslangic saati bu kadar dk once gectiyse "hemen" sayilir (00:00 secip 00:03'te olusturma: 24 sa sonra degil). */
export const GECMIS_TOLERANS_DK = 10;

export type BaslangicSecimi = { tur: 'saat'; an: Date } | { tur: 'gecti'; dkOnce: number } | null;

/**
 * Baslangic saati secimi: son GECMIS_TOLERANS_DK icinde gecmisse 'gecti' (hemen baslar, sunucuya baslangic gitmez),
 * degilse sonraki ilk an (bugun ya da yarin). Gecersizse null.
 */
export function baslangicSecimi(hhmm: string, referans: Date): BaslangicSecimi {
  const an = sonrakiSaat(hhmm, referans);
  if (!an) return null;
  const bugun = new Date(an);
  bugun.setDate(bugun.getDate() - 1);
  const gecenMs = referans.getTime() - bugun.getTime();
  if (an.getTime() !== referans.getTime() && gecenMs >= 0 && gecenMs <= GECMIS_TOLERANS_DK * 60000) {
    return { tur: 'gecti', dkOnce: Math.floor(gecenMs / 60000) };
  }
  return { tur: 'saat', an };
}

/** Yerel takvim gunu farki (an - referans): 0 bugun, 1 yarin. */
export function gunFarki(an: Date, referans: Date): number {
  const a = new Date(an.getFullYear(), an.getMonth(), an.getDate()).getTime();
  const b = new Date(referans.getFullYear(), referans.getMonth(), referans.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}

/** "00:00" / "yarın 00:00" / "05.11 00:00" (referans gunune gore). */
export function gunSaatMetni(iso: string | null | undefined, referans: Date = new Date()): string {
  const s = saatMetni(iso);
  if (!iso || s === '—') return s;
  const t = new Date(iso);
  const f = gunFarki(t, referans);
  if (f === 0) return s;
  if (f === 1) return `yarın ${s}`;
  if (f === -1) return `dün ${s}`;
  return `${String(t.getDate()).padStart(2, '0')}.${String(t.getMonth() + 1).padStart(2, '0')} ${s}`;
}

export const KUYRUK_DURUMU: Record<NlKuyrukDurum, { etiket: string; ton: Ton; canli?: boolean }> = {
  BEKLIYOR: { etiket: 'Bekliyor', ton: 'notr' },
  CALISIYOR: { etiket: 'Çalışıyor', ton: 'aksan', canli: true },
  DINLENME: { etiket: 'Dinlenme', ton: 'bilgi', canli: true },
  BITTI: { etiket: 'Bitti', ton: 'basari' },
  IPTAL: { etiket: 'İptal edildi', ton: 'uyari' },
  HATALI: { etiket: 'Hatalı', ton: 'hata' },
};
export const OGE_DURUMU: Record<NlKuyrukOgeDurum, { etiket: string; ton: Ton; canli?: boolean }> = {
  BEKLIYOR: { etiket: 'Bekliyor', ton: 'notr' },
  CALISIYOR: { etiket: 'Çalışıyor', ton: 'aksan', canli: true },
  BITTI: { etiket: 'Bitti', ton: 'basari' },
  ATLANDI: { etiket: 'Atlandı', ton: 'uyari' },
  HATALI: { etiket: 'Hatalı', ton: 'hata' },
  IPTAL: { etiket: 'İptal', ton: 'notr' },
};

/** Saniye -> "4 dk 12 sn" / "1 sa 5 dk" / "35 sn". */
export function kalanMetni(sn: number): string {
  const s = Math.max(0, Math.round(sn));
  if (s >= 3600) return `${Math.floor(s / 3600)} sa ${Math.floor((s % 3600) / 60)} dk`;
  if (s >= 60) return `${Math.floor(s / 60)} dk ${s % 60} sn`;
  return `${s} sn`;
}

// Ortak bicimlendirici (G19): bos / gecersiz deger "—", saat dilimi Portal'inki.
export function saatMetni(iso: string | null | undefined): string {
  return fmtTime(iso);
}
