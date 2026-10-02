// src/components/opsx/steps/wasLabels.ts — WAS adımlarının ortak etiketleri.
//
// "Ölçülemedi" AYRI bir durumdur ve AYRI (sarı) renkle gösterilir: durmuş (gri) ile
// karışırsa kullanıcı "zaten durmuş" diye başlatmaya, ya da durdurduğunu sandığı JVM'i
// çalışır bırakmaya yönelebilir.
import type { WasOperation, WasState, WasOpResultCode } from "@/api/opsxApi";

export const WAS_OP_LABELS: Record<WasOperation, string> = {
  restart: "Restart Et",
  stop: "Durdur",
  start: "Başlat",
};

export const WAS_OP_NOUNS: Record<WasOperation, string> = {
  restart: "Yeniden başlatma",
  stop: "Durdurma",
  start: "Başlatma",
};

export interface WasStateInfo {
  label: string;
  cls: string;
  hint: string;
}

export const WAS_STATE_INFO: Record<WasState, WasStateInfo> = {
  RUNNING: {
    label: "Çalışıyor",
    cls: "bg-green-50 text-green-700 border-green-100",
    hint: "Tek süreç var ve sunucu yanıt veriyor.",
  },
  STOPPED: {
    label: "Durmuş",
    cls: "bg-gray-50 text-gray-500 border-gray-200",
    hint: "Süreç yok ve sunucu yanıt vermiyor (ikisi de ölçüldü).",
  },
  ASKIDA: {
    label: "Askıda",
    cls: "bg-orange-50 text-orange-700 border-orange-100",
    hint: "Süreç var ama sunucu yanıt vermiyor.",
  },
  COKLU_SUREC: {
    label: "Çoklu süreç",
    cls: "bg-red-50 text-red-700 border-red-100",
    hint: "Birden fazla süreç eşleşti; hangisine dokunulacağı belirsiz — işlem yapılmaz.",
  },
  OLCULEMEDI: {
    label: "Ölçülemedi",
    cls: "bg-yellow-50 text-yellow-800 border-yellow-200",
    hint: "Gerçek durum bilinmiyor — durmuş SAYILMAZ, işlem yapılmaz.",
  },
};

// Bilinmeyen bir değer gelirse (yeni durum adı, boş alan) "ölçülemedi" gösterilir.
export function wasStateInfo(state: string): WasStateInfo {
  return WAS_STATE_INFO[state as WasState] || WAS_STATE_INFO.OLCULEMEDI;
}

export const WAS_RESULT_INFO: Record<WasOpResultCode, { label: string; cls: string }> = {
  OK: { label: "Başarılı", cls: "bg-green-50 text-green-700 border-green-100" },
  SKIP: { label: "Atlandı", cls: "bg-gray-50 text-gray-500 border-gray-200" },
  FAIL: { label: "Başarısız", cls: "bg-red-50 text-red-700 border-red-100" },
  OLCULEMEDI: { label: "Ölçülemedi", cls: "bg-yellow-50 text-yellow-800 border-yellow-200" },
};

export function wasResultInfo(code: string): { label: string; cls: string } {
  return WAS_RESULT_INFO[code as WasOpResultCode] || WAS_RESULT_INFO.OLCULEMEDI;
}

// Adım etiketi: OK ama "UYARI:" ile başlayan adım (nodeagent yok, JVM kendiliğinden geri geldi…)
// yeşil "Başarılı" DEĞİL, sarı "Uyarı" gösterilir.
export const WAS_STEP_WARNING = { label: "Uyarı", cls: "bg-yellow-50 text-yellow-800 border-yellow-200" };

export function wasStepInfo(s: { status: string; warning?: boolean }): { label: string; cls: string } {
  if (s.status === "OK" && s.warning) return WAS_STEP_WARNING;
  return wasResultInfo(s.status);
}

// Küme: "" = üye değil, "?" = küme bilgisi ÖLÇÜLEMEDİ (küme adı değil), aksi halde ad(lar).
export function wasClusterLabel(cluster: string): string {
  const c = (cluster || "").trim();
  if (!c) return "";
  if (c.split(",").some((x) => x.trim() === "?")) return "küme bilgisi ölçülemedi";
  return `küme ${c}`;
}

// Ortam rozeti — Production her zaman kırmızı (K4-a: ek kapı yok, ama görünür olmalı).
export function envBadgeClass(env: string): string {
  if (env === "Production") return "bg-red-50 text-red-700 border-red-100";
  if (env === "Test" || env === "QA") return "bg-amber-50 text-amber-800 border-amber-100";
  if (env === "Alpha") return "bg-blue-50 text-blue-700 border-blue-100";
  return "bg-gray-50 text-gray-500 border-gray-200";
}

export function wasTargetKey(t: { host: string; profile: string; cell: string; node: string; server: string }): string {
  return [t.host, t.profile, t.cell, t.node, t.server].join("|");
}
