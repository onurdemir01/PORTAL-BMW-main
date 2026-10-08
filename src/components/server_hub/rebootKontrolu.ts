// src/components/server_hub/rebootKontrolu.ts — Reboot Kontrolü satır ayrıştırıcıları (2026-10-08).
//
// Kullanıcı kuralı ("mesele çok basit"): Nginx / Red Hat Apache / IBM Apache / CTG / JBoss 7 / JBoss 8 / WAS
// reboot öncesi çalışıyorduysa sonra da çalışmalı; JBoss ve WAS JVM'lerinde önce çalışıp kapanan açılır,
// önce yokken çalışan kapatılır. Python ve diğer her şey izlenmez.
//
// Playbook (patch_remediation/reboot_check.yml) sunucu başına düz metin satırları döndürür:
//   görüntü : BOOT|<boot_id>|| · URUN|<ürün>|| · JVM|<ürün>|<jvm>|<detay>
//   plan    : ISLEM|kullanıcı|baslat/durdur|ürün|jvm|detay · BILGI|tür|ürün|jvm|mesaj
//   işlemler: SONUC|baslat/durdur|ürün|jvm|OK/FAIL/SKIP|mesaj   (ürün işleminde jvm boş)
//   son_fark: FARK|DOWN/NEW|URUN/JVM|ürün|jvm|detay — kurala göre HÂLÂ düzelmemiş olanlar

export const URUNLER = ['NGINX', 'RHA', 'IHS', 'CTG', 'JBOSS7', 'JBOSS8', 'WAS'] as const;
export const URUN_ADI: Record<string, string> = {
  NGINX: 'Nginx', RHA: 'Red Hat Apache', IHS: 'IBM Apache (IHS)', CTG: 'CTG', JBOSS7: 'JBoss 7', JBOSS8: 'JBoss 8', WAS: 'WebSphere (WAS)',
};
export const JVM_URUNLERI = new Set(['JBOSS7', 'JBOSS8', 'WAS']);

export interface Goruntu { boot: string | null; urunler: Set<string>; jvmler: Map<string, Set<string>>; bicimTamam: boolean }
export interface IslemSatiri { islem: string; urun: string; ad: string; sonuc: 'OK' | 'FAIL' | 'SKIP' | '?'; mesaj: string }
export interface BilgiSatiri { tur: string; urun: string; ad: string; mesaj: string }

const satirlar = (x: unknown): string[] => (Array.isArray(x) ? x.map((s) => String(s ?? '')).filter(Boolean) : []);

/** Görüntü satırları → ürün kümesi + ürün başına JVM kümesi. BOOT satırı yoksa eski biçim (bicimTamam=false). */
export function goruntuAyristir(x: unknown): Goruntu {
  const g: Goruntu = { boot: null, urunler: new Set(), jvmler: new Map(), bicimTamam: false };
  for (const l of satirlar(x)) {
    const p = l.split('|');
    if (p[0] === 'BOOT') { g.boot = p[1] || null; g.bicimTamam = true; }
    else if (p[0] === 'URUN' && p[1]) g.urunler.add(p[1]);
    else if (p[0] === 'JVM' && p[1] && p[2]) {
      if (!g.jvmler.has(p[1])) g.jvmler.set(p[1], new Set());
      g.jvmler.get(p[1])!.add(p[2]);
    }
  }
  return g;
}

export function islemAyristir(x: unknown): IslemSatiri[] {
  return satirlar(x).filter((l) => l.startsWith('SONUC|')).map((l) => {
    const p = l.split('|');
    const s = p[4] === 'OK' || p[4] === 'FAIL' || p[4] === 'SKIP' ? p[4] : '?';
    return { islem: p[1] || '?', urun: p[2] || '?', ad: p[3] || '', sonuc: s, mesaj: p.slice(5).join('|') };
  });
}

export function bilgiAyristir(x: unknown): BilgiSatiri[] {
  return satirlar(x).filter((l) => l.startsWith('BILGI|')).map((l) => {
    const p = l.split('|');
    return { tur: p[1] || '?', urun: p[2] || '', ad: p[3] || '', mesaj: p.slice(4).join('|') };
  });
}

export type Durum = 'ok' | 'sorun' | 'bilgi';
export interface JvmDegisimi { ad: string; durum: Durum; metin: string; islem?: IslemSatiri }
export interface UrunSatiri {
  urun: string; ad: string; durum: Durum; metin: string; islem?: IslemSatiri;
  jvmAyni: number; jvmDegisim: JvmDegisimi[];
}

/**
 * Sunucu başına ürün tablosu. once: reboot öncesi; ilk: reboot sonrası düzeltmeden önce; son: düzeltmeden sonra
 * (null = ölçülemedi). Yalnız önce ya da sonra görülen ürünler listelenir.
 */
export function urunTablosu(once: Goruntu, ilk: Goruntu, son: Goruntu | null, islemler: IslemSatiri[]): UrunSatiri[] {
  const out: UrunSatiri[] = [];
  const bul = (u: string, ad: string) => islemler.find((x) => x.urun === u && x.ad === ad);
  for (const u of URUNLER) {
    const o = once.urunler.has(u);
    const i = ilk.urunler.has(u);
    const s = son ? son.urunler.has(u) : null;
    if (!o && !i && !s) continue;
    const islem = bul(u, '');
    let durum: Durum; let metin: string;
    if (o) {
      if (s === null) { durum = 'sorun'; metin = 'son durum ölçülemedi'; }
      else if (s) { durum = 'ok'; metin = i ? 'çalışıyordu, çalışıyor' : 'reboot sonrası kapalıydı, açıldı'; }
      else { durum = 'sorun'; metin = 'çalışıyordu, hâlâ KAPALI'; }
    } else { durum = 'bilgi'; metin = 'reboot öncesi çalışmıyordu, şimdi çalışıyor — dokunulmadı'; }

    let jvmAyni = 0;
    const jvmDegisim: JvmDegisimi[] = [];
    if (JVM_URUNLERI.has(u)) {
      const oj = once.jvmler.get(u) || new Set<string>();
      const ij = ilk.jvmler.get(u) || new Set<string>();
      const sj = son ? son.jvmler.get(u) || new Set<string>() : null;
      const adlar = [...new Set([...oj, ...ij, ...(sj || [])])].sort((a, b) => a.localeCompare(b));
      for (const ad of adlar) {
        const jo = oj.has(ad); const ji = ij.has(ad); const js = sj ? sj.has(ad) : null;
        const jx = bul(u, ad);
        if (jo && ji && js && !jx) { jvmAyni++; continue; }
        let d: Durum; let m: string;
        if (js === null) { d = 'sorun'; m = 'son durum ölçülemedi'; }
        else if (jo) { d = js ? 'ok' : 'sorun'; m = js ? (ji ? 'çalışıyordu, çalışıyor' : 'kapalıydı, açıldı') : 'çalışıyordu, hâlâ KAPALI'; }
        else if (!o) { d = 'bilgi'; m = 'ürün reboot öncesi çalışmıyordu — dokunulmadı'; }
        else { d = js ? 'sorun' : 'ok'; m = js ? 'önce çalışmıyordu, hâlâ ÇALIŞIYOR' : 'önce çalışmıyordu, kapatıldı'; }
        jvmDegisim.push({ ad, durum: d, metin: m, islem: jx });
      }
    }
    out.push({ urun: u, ad: URUN_ADI[u] || u, durum, metin, islem, jvmAyni, jvmDegisim });
  }
  return out;
}

/** Reboot gerçekten oldu mu: boot id önce ve reboot sonrası farklıysa evet; aynıysa hayır; bilinmiyorsa null. */
export function rebootOldu(once: Goruntu, ilk: Goruntu): boolean | null {
  if (!once.boot || !ilk.boot || once.boot === 'bilinmiyor' || ilk.boot === 'bilinmiyor') return null;
  return once.boot !== ilk.boot;
}

/** Önce görüntüsünün kısa özeti: çalışan ürünler ve JVM sayıları. */
export function onceOzeti(g: Goruntu): { urun: string; ad: string; jvm: number | null }[] {
  return URUNLER.filter((u) => g.urunler.has(u)).map((u) => ({
    urun: u, ad: URUN_ADI[u] || u, jvm: JVM_URUNLERI.has(u) ? (g.jvmler.get(u)?.size || 0) : null,
  }));
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
