// src/api/kurumAyariApi.ts — Admin > Kurum Ayarı (KURUM_AYAR_DOSYASI'nı Portal'dan düzenleme).
// Sunucu: server/admin/kurum-ayari-duzenle.cjs. Hepsi Admin.
//
// Okuma uçları `okJson` (KATI): okunamayan dosya "boş" diye gösterilmesin.
// Kayıt `safeJson`: 409 / 428 / 400 gövdesi (`code`, `silinenBolumler`, `ihlaller`) ekrana lazım.
// Kayıttaki 5xx sunucuda 424 + `nginxRed` olur (kurumsal nginx 5xx gövdesini HTML ile değiştirir);
// `safeJson` onu sunucunun mesajıyla fırlatır, ekran mesajı gösterir.
import { okJson, safeJson } from './http';

const BASE = '/api/admin/kurum-ayari';

export interface KurumAyariDurumu {
  ok: boolean;
  envAdi: string;
  envTanimli: boolean;
  /** Yalnız dosya adı; dizin yanıtta yok. */
  dosyaAdi: string | null;
  okunabilir: boolean;
  gecerli: boolean;
  hata: string | null;
  icerik: string | null;
  sha: string | null;
  boyut?: number;
  mtime?: string;
  dosyaYazilabilir?: boolean;
  dizinYazilabilir?: boolean;
  /** Dosya repo çalışma ağacında (yerel geliştirmede izlenen örnek): Portal'dan kaydedilmez. */
  repoIci?: boolean;
  bolumler: string[];
  sinirlar: { maksBayt: number; maksYedek: number; maksDerinlik?: number };
}

export interface KurumAyariYedegi {
  ad: string;
  zaman: string | null;
  boyut: number;
  shaKisa: string;
}

export interface KurumAyariYedekIcerigi {
  ad: string;
  zaman: string | null;
  icerik: string;
  sha: string;
}

export interface KaydetGovdesi {
  icerik: string;
  oncekiSha: string;
  bolumSilmeOnayi?: boolean;
  geriYuklenenYedek?: string;
}

export interface KaydetYaniti {
  ok: boolean;
  _httpStatus?: number;
  code?: string;
  error?: string;
  sha?: string;
  yedek?: string;
  degisiklikYok?: boolean;
  silinenBolumler?: string[];
  silinenSunucuAlanlari?: string[];
  ihlaller?: { yol: string; neden: string }[];
  yollar?: { eklenen: string[]; silinen: string[]; degisen: string[] };
}

export const kurumAyariApi = {
  durum: (): Promise<KurumAyariDurumu> => fetch(BASE).then(okJson<KurumAyariDurumu>),
  yedekler: (): Promise<{ ok: boolean; yedekler: KurumAyariYedegi[] }> =>
    fetch(`${BASE}/yedekler`).then(okJson),
  yedek: (ad: string): Promise<KurumAyariYedekIcerigi & { ok: boolean }> =>
    fetch(`${BASE}/yedekler/${encodeURIComponent(ad)}`).then(okJson),
  kaydet: (govde: KaydetGovdesi): Promise<KaydetYaniti> =>
    fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(govde),
    }).then(safeJson),
};
