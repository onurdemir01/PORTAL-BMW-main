// src/components/nginx_console/yukTesti/kuyrukTaslak.ts — Gece kuyrugu taslagi ve saf yardimcilar (2026-11-03).
//
// Taslak (henuz olusturulmamis kuyruk) yalniz bu tarayicida: "Yeni koşu" formundan "Kuyruğa ekle" ile birikir,
// "Gece kuyruğu" bolumunde siralanir ve "Kuyruğu oluştur" ile sunucuya gider. localStorage yalniz kolaylik:
// okunamazsa / yazilamazsa taslak bellekte kalir (sunucuya giden her sey olusturma isteginde).
// 2026-11-04: duzenleme (taslak ya da bekleyen kuyruk ogesi "Yeni koşu" formunda acilir) ve duraklatma turetimi.
import type { NlKuyruk, NlKuyrukDurum, NlKuyrukGovde, NlKuyrukOge, NlKuyrukOgeDurum } from '@/api/nginxLoadtestApi';
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
/** Kuyruktaki en cok oge (kuyruk.cjs MAX_OGE ile ayni). */
export const MAX_OGE = 30;
/** Oge basina on kontrol payi (sn; tahmin icin). */
export const ON_KONTROL_PAY_SN = 300;
export const KUYRUK_AKTIF: ReadonlySet<string> = new Set(['BEKLIYOR', 'CALISIYOR', 'DINLENME']);

/** "Yeni koşu" formunda duzenlenen oge. Taslakta yerinde degisir; kuyrukta PUT gider. */
export type DuzenlenenOge =
  | { tur: 'taslak'; yerelId: string; etiket: string; govde: NlKuyrukGovde }
  | { tur: 'kuyruk'; kuyrukId: number; ogeId: number; etiket: string; govde: NlKuyrukGovde };

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

/** Taslak ogesini yerinde degistirir (sira korunur). Bitmis on kontrol eski ayarlara aitti: numarasi dusar. */
export function taslakGuncelle(t: TaslakOge[], yerelId: string, d: Pick<TaslakOge, 'etiket' | 'govde' | 'hedef' | 'ozet' | 'butceSn'>): TaslakOge[] {
  return t.map((o) => (o.yerelId === yerelId ? { ...o, ...d, onKontrolKosuId: null } : o));
}

/** Tahmini toplam sure (sn): her oge on kontrol + kosu ust siniri, aralarda bekleme. */
export function taslakToplamSn(ogeler: Pick<TaslakOge, 'butceSn'>[], beklemeDk: number): number {
  return ogeler.reduce((t, o) => t + ON_KONTROL_PAY_SN + (o.butceSn || 0), 0) + Math.max(0, ogeler.length - 1) * beklemeDk * 60;
}

/** Bekleyen kuyruk ogesinin govdesi (`ayar`dan); eksik alan varsa null (duzenleme acilmaz). */
export function ogeGovdesi(o: Pick<NlKuyrukOge, 'ayar'>): NlKuyrukGovde | null {
  const a = o.ayar;
  if (a?.senaryoId == null || !a.hedefIp || !a.vhost || !a.yukHost || !a.parametreler) return null;
  return { senaryoId: a.senaryoId, hedefHost: a.hedefHost ?? null, hedefIp: a.hedefIp, vhost: a.vhost, yukHost: a.yukHost, sni: a.sni === true, parametreler: a.parametreler };
}

/** Sunucunun ogeGuncelle kosulu: bekliyor ve hic baslamamis. */
export const ogeDuzenlenir = (o: Pick<NlKuyrukOge, 'durum' | 'onKontrolKosuId' | 'kosuId'>) => o.durum === 'BEKLIYOR' && o.onKontrolKosuId == null && o.kosuId == null;

export type DuraklatmaDurumu = null | 'bekliyor' | 'geri_alma' | 'duraklatildi';
/**
 * Aktif ve duraklatilmis kuyrugun gercek hali. 'bekliyor': oge calisiyor, dinlenme kilidin birakilmasini bekliyor ya da sunucu
 * hedefi mesgul diyor (hedefteki gecici ayar henuz geri alinmamis olabilir; sunucuya dokunulmaz). 'geri_alma': is bitti ama
 * sunucu ayari geri alinamadi (kilit yine de birakilir). 'duraklatildi': sunucu bos. Listede `ogeler` bos, `calisanVar` sunucudan.
 */
export function duraklatmaDurumu(k: Pick<NlKuyruk, 'durum' | 'duraklatAt' | 'dinlenmeBitis' | 'calisanVar' | 'hedefMesgul' | 'geriAlmaSorunu'>, ogeler: Pick<NlKuyrukOge, 'durum'>[]): DuraklatmaDurumu {
  if (!k.duraklatAt || !KUYRUK_AKTIF.has(k.durum)) return null;
  if (k.calisanVar || k.hedefMesgul || ogeler.some((o) => o.durum === 'CALISIYOR') || (k.durum === 'DINLENME' && k.dinlenmeBitis == null)) return 'bekliyor';
  return k.geriAlmaSorunu ? 'geri_alma' : 'duraklatildi';
}
export const DURAKLATMA_METNI: Record<NonNullable<DuraklatmaDurumu>, string> = {
  bekliyor: 'Duraklatılıyor: süren iş bitip sunucu ayarları geri alınınca durur; sunucuya henüz dokunmayın.',
  geri_alma: 'Sunucu ayarı geri alınamadı: hedefteki nginx ayarı değişmiş kalmış olabilir. Koşuyu açıp “Sunucu ayarını geri al”ı çalıştırın.',
  duraklatildi: 'Duraklatıldı: sunucuda işlem yapabilirsiniz. Devam edince sıradaki öğe ön kontrolden başlar.',
};
export const DURAKLATMA_HAPI: Record<NonNullable<DuraklatmaDurumu>, { etiket: string; ton: Ton }> = {
  bekliyor: { etiket: 'Duraklatılıyor', ton: 'uyari' },
  geri_alma: { etiket: 'Geri alma gerekli', ton: 'hata' },
  duraklatildi: { etiket: 'Duraklatıldı', ton: 'uyari' },
};

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
