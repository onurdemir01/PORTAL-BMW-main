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

// ONCE / SONRA (2026-10-08, kullanici: "solda yorum satirina alinmadan once dosyalarin icinde tespit
// edilen satirlar, sagda ise yorum satirina alindiktan sonra ... bu sekilde yapilacak islemi onaylamak
// cok kolay olur"). "Sonra" METINDEN TAHMIN EDILMEZ: betik islemi `KIP\t<yorumla|tasi|yok>[\t<hedef>]`
// ile acikca bildirir. Bilinmiyorsa sag sutun "bilinmiyor" der, uydurmaz.
export type Kip = 'yorumla' | 'tasi' | 'yok' | 'bilinmiyor';
export function kipAyristir(kip: unknown): { kip: Kip; hedef?: string } {
  const p = String(kip ?? '').split('\t');
  if (p[0] !== 'KIP') return { kip: 'bilinmiyor' };
  if (p[1] === 'yorumla' || p[1] === 'yok') return { kip: p[1] };
  if (p[1] === 'tasi') return { kip: 'tasi', hedef: p[2] || undefined };
  return { kip: 'bilinmiyor' };
}

/** Ayni ServerName'li birden cok blok (ornegin :80 ve :443) ayri gruplar olur: satir numarasi ardisik
 *  degilse yeni blok. Boylece iki blok "ayni sey iki kez yazilmis" gibi gorunmez. */
export interface BlokGrubu { bas: number; son: number; satirlar: BlokSatiri[] }
export function bloklaraBol(satirlar: BlokSatiri[]): BlokGrubu[] {
  const out: BlokGrubu[] = [];
  for (const s of satirlar) {
    const g = out[out.length - 1];
    if (g && s.no > 0 && g.son > 0 && s.no === g.son + 1) { g.satirlar.push(s); g.son = s.no; }
    else if (g && (s.no === 0 || g.son === 0)) { g.satirlar.push(s); }
    else out.push({ bas: s.no, son: s.no, satirlar: [s] });
  }
  return out;
}

/** Onaydan SONRA satirin dosyadaki hali; 'tasi'da satir dosyada kalmaz (null). */
export const YORUM_ONEKI = '# [server-hub <zaman>] ';
export function sonraMetni(metin: string, kip: Kip): string | null {
  if (kip === 'yorumla') return YORUM_ONEKI + metin;
  if (kip === 'yok') return metin;
  return null;
}

// MOD_JK DEGISIKLIKLERI (2026-10-08, kullanici: "STOP adiminda direkt yine yorum satirina alalim").
// Betik planda, gercekte yazacagi AYNI awk'tan `JKDEG\t<dosya>\t<no>\t<once>\t<sonra>` basar:
// once bos = EKLENEN satir (worker.list'in yeni hali), sonra bos = KALKAN satir (geri almada).
export interface JkDeg { dosya: string; no: number; once: string; sonra: string }
export function jkDegAyristir(x: unknown): JkDeg[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((y) => {
    const p = String(y ?? '').split('\t');
    if (p[0] !== 'JKDEG' || p.length < 5) return [];
    return [{ dosya: p[1] || '', no: Number(p[2]) || 0, once: p[3] || '', sonra: p.slice(4).join('\t') }];
  });
}

// RENK (2026-10-08, kullanici: "eklenecek satirlari yesil ile, comment'lenecek satirlari sari ile").
// Tur, satirin KENDISINDEN cikarilir: onek "# [server-hub " eklenmisse yorumlanan, kalkmissa acilan
// (geri almada); once bos = eklenen (worker.list'in worker'siz kopyasi), sonra bos = kalkan.
export type DegisimTuru = 'eklenen' | 'yorumlanan' | 'acilan' | 'kalkan' | 'ayni';
const ONEK = /^# \[server-hub /;
export function degisimTuru(once: string, sonra: string): DegisimTuru {
  if (!sonra) return 'kalkan';
  if (!once) return 'eklenen';
  const o = ONEK.test(once);
  const z = ONEK.test(sonra);
  if (z && !o) return 'yorumlanan';
  if (o && !z) return 'acilan';
  return once === sonra ? 'ayni' : 'yorumlanan';
}
