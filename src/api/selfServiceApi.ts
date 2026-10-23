// src/api/selfServiceApi.ts
import { okJson } from "./http";

const BASE = "/api/selfservice";

// Eskiden basarisiz yanitta govdenin HAM METNI firlatiliyordu; Otomasyon sayfasi hata
// olarak `{"ok":false,"message":"..."}` gosteriyordu. okJson sunucunun mesajini cikarir.
const json = <T>(r: Response): Promise<T> => okJson<T>(r);

export interface SelfServiceGroup {
  id: string; groupKey: "ansible"; label: string;
  icon: string; sortOrder: number; isActive: boolean;
}

export interface IpCheckMatch {
  host: string;
  ip: string;
  created_at: string | null;
  updated_at: string | null;
  last_seen_at: string | null;
}

export interface IpCheckResult {
  ip: string;
  found: boolean;
  matches: IpCheckMatch[];
}

export interface OpenshiftCheckRow {
  namespace: string;
  application: string;
  owner_group_name: string | null;
  owner_email: string | null;
}

// Nginx - RVP Operations "read" (2026-10-20): AWX job'i baslatilmaz; tanimlar silme akisinin
// okudugu tarama verisinden (bkz. server/selfservice/nginx-tanim-okuma.cjs).
export interface NginxTanimSunucu {
  host: string;
  /** PROD'da 'yeni' | 'eski' | 'bilinmiyor'; non-prod'da null */
  filo: string | null;
}
export interface NginxTanimCevap {
  application: string | null;
  namespace: string | null;
  /** eski filo proxy satiri: uygulama adi hedef adresten TAHMIN */
  tahmin: boolean;
  hedef: string | null;
  sunucular: NginxTanimSunucu[];
}
export interface NginxTanimSatir {
  location: string;
  cevaplar: NginxTanimCevap[];
  /** sunucular arasinda ayni location'a FARKLI uygulama cevap veriyor */
  tutarsiz: boolean;
}
export interface NginxTanimlar {
  ok: boolean;
  message?: string;
  /** 'var' tanim bulundu | 'yok' taramada tanim yok | 'olculemedi' tarama okunamadi / hic kosmadi */
  durum?: 'var' | 'yok' | 'olculemedi';
  sebep?: string;
  env?: string;
  service?: string;
  taramaTarihi?: string | null;
  satirlar: NginxTanimSatir[];
  /** GLOMO prod: listelenmeyen eski filo satiri sayisi (eski filoya gidilmez) */
  eskiFiloGizli?: number;
  glomoProd?: boolean;
}

export const selfServiceApi = {
  // "Ansible" sekmesinin DB'deki etiket/sira bilgisini dondurur (Smart/Diğerleri katalogu
  // kaldirildigi icin store artik yok — bkz. server/selfservice/store.cjs readGroups).
  async get(): Promise<{ ok: true; groups: SelfServiceGroup[] }> {
    const r = await fetch(`${BASE}`, { method: "GET" });
    return json(r);
  },

  // "Check" sekmesi — yapistirilan IP listesini dbo.IPInventory'de arar (bkz.
  // server/selfservice/index.cjs POST /ip-check).
  async ipCheck(ips: string[]): Promise<{
    ok: true; results: IpCheckResult[]; totalChecked: number; totalFound: number;
    /** Sunucunun DEGERLENDIRMEDIGI girdi sayisi. Eskiden fazlasi sessizce dusuyordu
     *  ve kullanici bunu hicbir yerde goremiyordu (bkz. server/selfservice/index.cjs). */
    truncated?: number; maxItems?: number;
  }> {
    const r = await fetch(`${BASE}/ip-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ips }),
    });
    return json(r);
  },

  // "Check" sekmesi — yapistirilan namespace/uygulama listesini dbo.Openshift_Inventory'de
  // arar, benzersiz (namespace, application, owner_group_name, owner_email) satirlarini
  // doner (bkz. server/selfservice/index.cjs POST /openshift-check).
  async openshiftCheck(items: string[]): Promise<{
    ok: true; rows: OpenshiftCheckRow[]; notFound: string[];
    totalChecked: number; totalMatchedRows: number; truncated?: number; maxItems?: number;
  }> {
    const r = await fetch(`${BASE}/openshift-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    return json(r);
  },

  async nginxTanimlari(p: { env: string; service: string; namespace?: string; application?: string }): Promise<NginxTanimlar> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
    const r = await fetch(`${BASE}/nginx-tanimlar?${q.toString()}`);
    return r.json().catch(() => ({ ok: false, message: "Yanıt okunamadı.", satirlar: [] }));
  },
};
