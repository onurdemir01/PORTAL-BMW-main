// src/components/server_hub/retirementVhostPlan.ts — kapatilacak vhost bloklari (2026-10-08).
//
// Kullanici: "tetiklemeden once disabled edilecek virtualhost blogunu gormek istiyorum."
// On kontrol, web adimiyla AYNI eylemi (server_hub_fix / apache_retire_vhost) plan_only=true
// kosturur. Betik kapatacagi blogu `BLOK\t<satir no>\t<metin>` satirlariyla, sonucu
// `RESULT\t<eylem>\t<PLAN|FAIL|...>\t<mesaj>` ile bildirir (server_hub_fix_result.blok/.line).
// Ekranda gorulen blok, gercekte yorumlanacak blogun ta kendisidir (tek awk, VHOST_AWK).

export interface BlokSatiri { no: number; metin: string }
export type PlanSonucu = 'PLAN' | 'OK' | 'SKIP' | 'FAIL' | 'BILINMIYOR';

/** `BLOK\t<no>\t<metin>` listesi -> satirlar. Bicimi bozuk satir ATLANMAZ, metin olarak tasinir. */
export function blokAyristir(blok: unknown): BlokSatiri[] {
  if (!Array.isArray(blok)) return [];
  return blok.map((x) => {
    const p = String(x ?? '').split('\t');
    const no = Number(p[1]);
    return p[0] === 'BLOK' && Number.isInteger(no) ? { no, metin: p.slice(2).join('\t') } : { no: 0, metin: String(x ?? '') };
  });
}

/** `RESULT\t<eylem>\t<DURUM>\t<mesaj>` -> { durum, mesaj }. Satir yoksa BILINMIYOR - basari SAYILMAZ. */
export function sonucAyristir(line: unknown): { durum: PlanSonucu; mesaj: string } {
  const p = String(line ?? '').split('\t');
  const d = p[0] === 'RESULT' ? String(p[2] || '').toUpperCase() : '';
  const durum: PlanSonucu = d === 'PLAN' || d === 'OK' || d === 'SKIP' || d === 'FAIL' ? d : 'BILINMIYOR';
  return { durum, mesaj: p[0] === 'RESULT' ? p.slice(3).join(' ') : 'plan sonucu okunamadı' };
}

// MOD_JK BAGLANTILARI (2026-10-08, SALT OKUNUR). IHS'te vhost mod-jk.conf ya da httpd.conf'ta, worker'lar
// conf/worker.properties'te. Blok kapatilinca blogun DISINDAKI JkMount'lar ve worker tanimlari aktif kalir;
// web adimi onlara DOKUNMAZ - burada yalniz gorunur. Satir: `JK\t<tur>\t<dosya>\t<no>\t<metin>`.
export type JkTur = 'GLOBAL' | 'PAYLASILAN' | 'WORKER' | 'LIST' | 'LB' | 'OKUNAMADI' | 'NOT' | 'BILINMIYOR';
export interface JkSatiri { tur: JkTur; dosya: string; no: number; metin: string }
const JK_TUR = new Set(['GLOBAL', 'PAYLASILAN', 'WORKER', 'LIST', 'LB', 'OKUNAMADI', 'NOT']);

/** Bicimi bozuk satir ATLANMAZ: tur BILINMIYOR olarak metniyle tasinir. */
export function jkAyristir(jk: unknown): JkSatiri[] {
  if (!Array.isArray(jk)) return [];
  return jk.map((x) => {
    const p = String(x ?? '').split('\t');
    if (p[0] !== 'JK' || !JK_TUR.has(p[1])) return { tur: 'BILINMIYOR' as JkTur, dosya: '', no: 0, metin: String(x ?? '') };
    return { tur: p[1] as JkTur, dosya: p[2] === '-' ? '' : p[2] || '', no: Number(p[3]) || 0, metin: p.slice(4).join('\t') };
  });
}

export const JK_ETIKET: Record<JkTur, string> = {
  GLOBAL: 'blok dışı JkMount — blok kapanınca da AKTİF',
  PAYLASILAN: 'başka vhost aynı worker\'ı kullanıyor — worker silinemez',
  WORKER: 'worker tanımı',
  LIST: 'worker.list',
  LB: 'load balancer üyeliği',
  OKUNAMADI: 'okunamadı — ölçülemedi, yok değil',
  NOT: 'bilgi',
  BILINMIYOR: 'tanınmayan satır',
};
