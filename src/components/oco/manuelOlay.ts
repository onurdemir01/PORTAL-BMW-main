// src/components/oco/manuelOlay.ts — OCO Takvimi: elle eklenen olaylar (2026-11-17).
//
// Kullanıcı: "OCO Takvimi'ne manuel ekleme olayı da ekler misin?"
//
// Elle olay OCO DEĞİLDİR: sunucuda ayrı tabloda (oco_manuel_olaylar) yaşar, ekranda "manuel"
// rozetiyle görünür. Liste ve takvim aynı OcoRow tipini kullandığı için olay OcoRow'a çevrilir;
// İÇ KİMLİK negatif (`-id`): servis OCO numaraları pozitif, iki kaynak hiç çakışmaz. Ekranda
// görünen numara `ocoEtiket` ile üretilir (iç kimlik asla "#-5" diye yazılmaz).
import type { OcoRow } from '@/components/oco/OcoOrtak';

export interface ManuelOlay {
  id: number;
  ocoNo: string | null;
  baslik: string;
  aciklama: string;
  baslangic: string | null;
  bitis: string | null;
  olusturan: string | null;
  olusturmaAt: string | null;
  guncelleyen: string | null;
  guncellemeAt: string | null;
  /** Sunucunun kararı: ekleyen ya da Admin. */
  duzenleyebilir?: boolean;
}

export interface ManuelYanit {
  ok: boolean;
  olaylar?: ManuelOlay[];
  kirpildi?: boolean;
  message?: string;
}

/** Formun gönderdiği gövde (tarihler ISO). */
export interface ManuelGovde {
  baslik: string;
  ocoNo: string;
  aciklama: string;
  baslangic: string;
  bitis: string;
}

export function manueldenSatira(o: ManuelOlay): OcoRow {
  return {
    oco: -o.id,
    subject: o.baslik,
    explanation: o.aciklama || '',
    statusText: '',
    statusCode: 0,
    impactText: '',
    processText: '',
    pcabRequired: false,
    plannedStart: o.baslangic,
    plannedEnd: o.bitis,
    actualStart: null,
    actualEnd: null,
    openedAt: null,
    manuel: o,
  };
}

/** Ekranda görünen numara: servis OCO'su "#123", elle olay OCO no'luysa "#123", değilse "manuel". */
export function ocoEtiket(r: OcoRow): string {
  if (r.manuel) return r.manuel.ocoNo ? `#${r.manuel.ocoNo}` : 'manuel';
  return `#${r.oco}`;
}

/** Kopyalanacak OCO numarası (yoksa null: OCO'suz elle olayda kopyalanacak numara yok). */
export function ocoKopya(r: OcoRow): string | null {
  if (r.manuel) return r.manuel.ocoNo || null;
  return String(r.oco);
}

/** Ekran okuyucu ve başlık için: "OCO 123" ya da "Elle eklenen olay". */
export function ocoSesli(r: OcoRow): string {
  if (r.manuel)
    return r.manuel.ocoNo ? `Elle eklenen olay, OCO ${r.manuel.ocoNo}` : 'Elle eklenen olay';
  return `OCO ${r.oco}`;
}

/** ISO -> <input type="datetime-local"> değeri (yerel saat, dakika hassasiyeti). */
export function isoYerel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** <input type="datetime-local"> değeri (yerel) -> ISO; boş/geçersizse ''. */
export function yerelIso(v: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** İstemci tarafı ön doğrulama (sunucu yine doğrular). Hata metni ya da null. */
export function formHatasi(g: {
  baslik: string;
  ocoNo: string;
  baslangic: string;
  bitis: string;
}): string | null {
  if (!g.baslik.trim()) return 'Başlık zorunlu.';
  if (g.ocoNo.trim() && !/^\d{1,20}$/.test(g.ocoNo.trim()))
    return 'OCO no yalnız rakamlardan oluşmalı.';
  if (!g.baslangic) return 'Başlangıç tarihi zorunlu.';
  if (g.bitis && new Date(g.bitis).getTime() < new Date(g.baslangic).getTime())
    return 'Bitiş, başlangıçtan önce olamaz.';
  return null;
}

async function jsonOku(
  r: Response,
): Promise<{ ok: boolean; message?: string; [k: string]: unknown }> {
  const b = await r.json().catch(() => null);
  if (b && typeof b === 'object') return b as { ok: boolean; message?: string };
  return { ok: false, message: `Yanıt okunamadı (HTTP ${r.status}).` };
}

export async function manuelListele(): Promise<ManuelYanit> {
  const r = await fetch('/api/oco/manuel');
  const b = await jsonOku(r);
  // Beklenmeyen biçim (örn. başka uçtan gelen gövde) "olay yok" sayılmaz: hata olarak döner.
  if (b.ok && !Array.isArray((b as ManuelYanit).olaylar))
    return { ok: false, message: 'Elle eklenen olaylar okunamadı (beklenmeyen yanıt).' };
  return b as ManuelYanit;
}

export async function manuelKaydet(
  id: number | null,
  govde: ManuelGovde,
): Promise<{ ok: boolean; message?: string; olay?: ManuelOlay }> {
  const r = await fetch(id ? `/api/oco/manuel/${id}` : '/api/oco/manuel', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(govde),
  });
  return jsonOku(r) as Promise<{ ok: boolean; message?: string; olay?: ManuelOlay }>;
}

export async function manuelSil(id: number): Promise<{ ok: boolean; message?: string }> {
  const r = await fetch(`/api/oco/manuel/${id}`, { method: 'DELETE' });
  return jsonOku(r);
}
