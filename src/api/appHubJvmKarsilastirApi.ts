// src/api/appHubJvmKarsilastirApi.ts — Application Hub: toplu JBoss JVM argümanı karşılaştırması (2026-11-16).
// Sunucu karşılığı: server/app-hub/jvm-karsilastir.cjs (POST /api/app-hub/jvm-karsilastir, yalnız Admin, salt okunur).
import { okJson } from './http';

export type KarsilastirmaDurumu = 'ESIT' | 'FARKLI' | 'TEK_SUNUCU' | 'OLCULEMEDI' | 'BULUNAMADI';
export type NesilSecimi = 7 | 8 | 'hepsi';

export interface KarsilastirilanJvm {
  etiket: string;
  host: string;
  jvm: string;
  kaynak: 'CALISAN' | 'YAPILANDIRILAN' | null;
  calisiyor: boolean | null;
  taze: boolean;
  taramaTarihi: string | null;
  olculdu: boolean;
  /** Tarayıcı argüman metnini kesmiş ('...+N'); kesilen kısımdaki argümanlar karşılaştırılamadı. */
  kesik: boolean;
}

export interface DegerFarki {
  anahtar: string;
  cogunluk: string | null;
  cogunlukUyeler: string[];
  degerler: { deger: string; uyeler: string[] }[];
  sapanlar: { uye: string; deger: string; normal: string }[];
  /** Ham ve normalleştirilmiş çoğunluk farklı JVM'leri gösteriyor: hangisinin sapan olduğu belirsiz. */
  belirsiz: boolean;
}

export interface EksikFazla {
  anahtar: string;
  olan: string[];
  olmayan: string[];
  /** Argüman metni kesik olduğu için bilinmeyen JVM'ler. */
  kesikte: string[];
  degerler: { uye: string; deger: string }[];
  cogunlukta: boolean;
}

export interface KarsilastirmaGrubu {
  ortam: string;
  nesil: number | null;
  durum: KarsilastirmaDurumu;
  neden: string | null;
  uyarilar: string[];
  sunucuSayisi: number;
  jvmSayisi: number;
  olculenJvm: number;
  jvmler: KarsilastirilanJvm[];
  degerFarklari: DegerFarki[];
  eksikFazla: EksikFazla[];
  /** Kesik JVM'lerde bulunmayan, bu yüzden karşılaştırılamayan argümanlar. */
  karsilastirilamadi: { anahtar: string; kesik: string[] }[];
  sunucuyaOzgu: {
    anahtar: string;
    degerler: { uye: string; deger: string }[];
    normal: string | null;
  }[];
  maskeli: string[];
  esitSayisi: number;
  farkSayisi: number;
}

export interface UygulamaKarsilastirmasi {
  ad: string;
  tabanAd: string | null;
  durum: KarsilastirmaDurumu;
  neden: string | null;
  sunucuSayisi: number;
  jvmSayisi: number;
  farkSayisi: number;
  gruplar: KarsilastirmaGrubu[];
  uyarilar: string[];
}

export interface JvmKarsilastirmaYaniti {
  ortam: string;
  nesil: NesilSecimi;
  ozet: Record<KarsilastirmaDurumu, number> & { toplam: number };
  uygulamalar: UygulamaKarsilastirmasi[];
  okundu: string;
}

export const UYGULAMA_TAVANI = 20;

export const jvmKarsilastirApi = {
  async karsilastir(
    g: { uygulamalar: string[]; ortam: string; nesil: NesilSecimi; fresh?: boolean },
    signal?: AbortSignal,
  ): Promise<JvmKarsilastirmaYaniti> {
    return okJson(
      await fetch('/api/app-hub/jvm-karsilastir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(g),
        signal,
      }),
    );
  },
};
