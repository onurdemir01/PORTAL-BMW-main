// src/api/rebootCheckApi.ts — Server Hub > Reboot Kontrolü (server/server-hub/reboot-check.cjs).
import { safeJson } from './http';

const BASE = '/api/server-hub/reboot-check';
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface RcSunucuSonuc {
  faz?: string;
  goruntu_ok?: boolean;
  goruntu_hata?: string;
  goruntu?: string[];
  once_var?: boolean;
  plan?: string[];
  islemler?: string[];
  son_goruntu?: string[];
  son_fark?: string[];
  son_olculdu?: boolean;
  sonuc_yok?: boolean;
  /** JVM planı öncesi görüntü durulması: settled | timeout | error ('' = koşmadı). */
  durulma?: string;
  durulma_satir?: string;
  /** Playbook betik sürümü. Yoksa ya da 3'ten küçükse her sunucuda eski; 3 ise yalnız boş önce + çalışan CTG/JBoss/WAS'ta (betikEtkisi); 4+ güncel. */
  betik_surum?: number | string;
}
/** Bir teknolojinin (ürün) otomasyon özeti — sunucu otomasyonOzeti (tek kaynak). */
export interface RcTeknoloji {
  urun: string; ad: string;
  /** En az bir açma/kapatma komutu çalıştı (SKIP sayılmaz). */
  calistirildi: boolean;
  /** Çalıştırıldıysa sonuç ("açıldı ✓ (2. denemede)"), değilse neden ("değişiklik yok"). */
  ozet: string;
  sonuc: 'ok' | 'hata' | 'yok';
}
export interface RcOtomasyon {
  sinif: 'basarili' | 'basarisiz' | 'dokunmadi'; teknoloji: RcTeknoloji[];
  /** Teknoloji listesi çıkarılamadıysa nedeni (sunucudan sonuç gelmedi → otomasyon doğrulanamadı, başarısız). */
  not?: string;
}
export interface RcDegerlendirme {
  /** v4: kapsam_disi = reboot öncesi izlenen uygulama çalışmıyordu (tek neden önce-boş) — uyarı değil, nötr. */
  durum: 'sorunsuz' | 'sorunlu' | 'olculemedi' | 'kontrol' | 'kapsam_disi';
  sebep?: string; kalan?: number; islem?: number; hatali?: number;
  /** Kontrol nedenleri (eski sürüm, dokunulmayan öğe şimdi çalışıyor, otomasyon kapattı …); fark kalsa da yazılır. */
  neden?: string[];
  /** Bilgi notları (v4: önce görüntüsü boş) — uyarı değil. */
  bilgi?: string[];
  durulma?: string;
  /** Otomasyon sınıfı + teknoloji listesi (v3); eski API cevabında yok → ekran "—" gösterir. */
  otomasyon?: RcOtomasyon;
}
/** Oran: pay / payda; metin Türkçe yüzde ("%92,6"), payda 0 ise "—". */
export interface RcOran { pay: number; payda: number; metin: string }
/** 2026-11-17 sunucu seviyesi yonetici ozeti (reboot-check.cjs sunucuSeviyesi; Durum Raporu ayni kaynak). */
export type RcKova = 'mudahalesiz' | 'duzeltildi' | 'kontrol' | 'yapilamadi' | 'hatali';
export interface RcSeviye {
  toplam: number;
  sayi: Record<RcKova, number>;
  kova: Record<RcKova, string[]>;
  basari: RcOran;
  islemYapilan: number;
  geriGetirilen: RcOran;
  islemler: { anahtar: string; islem: string; urun: string; jvm: boolean; komut: number; ok: number; fail: number; hedefte: number; sunucular: string[] }[];
  sunucu: Record<string, { kova: RcKova; etiket: string[]; neden: string[]; bilinmiyor?: boolean; komutlar: { islem: string; urun: string; ad: string; sonuc: string; hedefte: boolean }[] }>;
  etiketSay?: { izlenenYok: number };
  yapilamadiNeden?: { ulasilamadi: number; once_yok: number; olculemedi: number; komutsuz: number };
  otomasyon?: RcOran;
}
export interface RcKomutKoprusu { ok: number; fail: number; skip: number; okHedefteDegil: number; okOlculemedi?: number; sunucu: number; komut: number; basarili: number }
/** Yönetici özeti (v4) — sunucu yoneticiOzeti (tek kaynak; rapor aynı sayıları kullanır). */
export interface RcYonetici {
  /** onceYok: önce görüntüsü alınamayan (karşılaştırma yapılmadı); onceBosKontrol/onceBosSorunlu: karşılaştırma dışı olup kontrol bekleyen / sorun kalan. */
  sunucu: { toplam: number; olculen: number; olculemeyen: number; onceYok?: number; onceBos: number; onceBosDiger: number; onceBosKontrol?: number; onceBosSorunlu?: number; karsilastirilabilir: number; sorunsuz: number; kontrol: number; sorunlu: number;
    /**
     * İnceleme Y7: birakilan = son durumu ölçülen, kalan farkı 0 ve korunan (kapatılmadan bırakılan) çalışan öğesi olmayan
     * karşılaştırılabilir sunucu (oran.birakildi'nin payı); birakilanKontrolNotlu: bunlardan durumu 'kontrol' olup TEK kontrol
     * notu "otomasyon fazladan çalışan ürünü kapattı" olan (inceleme B2; eski betik vb. başka notu olan bırakılmış sayılmaz);
     * kontrolBekleyen = kontrol − birakilanKontrolNotlu; birakilan + kontrolBekleyen + sorunlu = karsilastirilabilir. Eski kayıtta yok olabilir.
     */
    birakilan?: number; birakilanKontrolNotlu?: number; kontrolBekleyen?: number };
  /** korunan: reboot öncesi çalışmayan, kapatma güvenli olmadığı için dokunulmayan öğe (hedef kümesine girmez). */
  oge: { once: number; hedef: number; dogru: number; ilkSapan: number; ilkDown: number; ilkNew: number; otomatik: number; kendiliginden: number; halaSapan: number; korunan?: number };
  /** Tüm kayıt (Otomatik Düzeltme tablosuyla aynı); okOlculemedi: komut OK ama son durum ölçülemedi (doğrulanamadı). */
  komut: RcKomutKoprusu;
  /** Otomasyon oranının kümesi: yalnız son durumu ölçülen sunucuların komutları. */
  komutOlculen?: RcKomutKoprusu;
  oran: { birakildi: RcOran; donus: RcOran; otomasyon: RcOran; komut: RcOran; kapanan: RcOran };
  metin: string;
}
export interface RcKayit {
  id: number;
  hosts: string[];
  not: string;
  durum: string;
  olusturan: string;
  olusturuldu: string;
  /** 2026-11-17: 'AWX' = AWX'te (workflow ya da elle) kosan isten alindi (reboot-check-awx.cjs); null/yok = Portal. */
  kaynak?: 'AWX' | null;
  /** AWX kaynakli kaydin workflow is numarasi (workflow disi: null). */
  awxWorkflowId?: number | null;
  once: { jobId: number | null; serverId: number | null; at: string | null; sonuc?: { faz?: string; sunucular?: Record<string, RcSunucuSonuc> } | null };
  sonra: { jobId: number | null; serverId: number | null; at: string | null; sonuc?: { faz?: string; sunucular?: Record<string, RcSunucuSonuc> } | null };
  ozet: {
    once?: { alinan: number; toplam: number; job: string; once_bos?: string[] };
    sonra?: { sorunsuz: number; kontrol?: number; kapsamDisi?: number; toplam: number; job: string; sunucu: Record<string, RcDegerlendirme>; yonetici?: RcYonetici; seviye?: RcSeviye };
  } | null;
  /** Kosan fazda AWX'in anlik is durumu (pending / waiting / running / okunamadi); yalniz ayrintida. */
  awxDurum?: string | null;
  /** Kosan fazin baslatildigi an (ISO). */
  fazBasladi?: string | null;
}
export interface RcLaunch { ok: boolean; message?: string; id?: number | null; jobId?: number | null; awxServerId?: number; hedef?: string[]; disarida?: string[] }

/** AWX'te (Portal dışında) koşan reboot_check işlerinin alımı: son tarama özeti (reboot-check-awx.cjs alimDurumu). */
export interface RcAlimIs {
  jobId: number;
  sonuc: 'alindi' | 'atlandi' | 'hata';
  /** atlandi: portal_bilinen | portal_gecmisi | gecmis_okunamadi | baska_sablon | set_stats_yok | host_yok | zaten_alindi */
  neden?: string | null;
  mesaj?: string;
  kayitId?: number;
  faz?: string | null;
  awxDurum?: string | null;
  zaman: string;
}
export interface RcAlimDurumu {
  aralikSn: number;
  geriGun: number;
  sonTarama: string | null;
  /** tarama şu an sürüyor (ekran bitince yeniden sorar) */
  tariyor?: boolean;
  /** sunucuAdi: taranan AWX (Portal yalnız bu AWX'teki bu şablonu görür) */
  sablon: { templateId: number; serverId: number; sunucuAdi?: string | null } | null;
  /** template_yok: Playbook Kayıtları'nda reboot_check tanımsız / kapalı */
  neden: string | null;
  hata: string | null;
  /** son taramada şablonun pencere içinde biten iş sayısı (null = okunamadı / taranmadı) */
  bulunan: number | null;
  isler: RcAlimIs[];
}

export const rebootCheckApi = {
  /** tara: 2 dk sınırını atlayıp AWX'i şimdi tarar ve bitmesini bekler (Yenile). */
  awxAlim: (tara = false): Promise<{ ok: boolean; message?: string; durum?: RcAlimDurumu }> =>
    fetch(`${BASE}/awx-alim${tara ? '?tara=1' : ''}`).then(safeJson),
  list: (): Promise<{ ok: boolean; message?: string; kayitlar?: RcKayit[] }> => fetch(BASE).then(safeJson),
  get: (id: number): Promise<{ ok: boolean; message?: string; kayit?: RcKayit }> => fetch(`${BASE}/${id}`).then(safeJson),
  once: (hosts: string[], not: string): Promise<RcLaunch> => fetch(BASE, json({ hosts, not })).then(safeJson),
  sonra: (id: number): Promise<RcLaunch> => fetch(`${BASE}/${id}/sonra`, json({ onay: true })).then(safeJson),
};
