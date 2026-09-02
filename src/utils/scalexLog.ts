// src/utils/scalexLog.ts — playbook'un adım satırlarını okunur bir günlüğe çevirir.
//
// Playbook her adım için `cluster;jump;app;kind;step;status;detail` biçiminde bir satır
// üretir ve portal bunları `scalex_result.rows` içinde alıp `scalex_operations.result_json`'a
// yazar. Ama EKRANDA HİÇ GÖSTERİLMİYORDU: kullanıcı "ne oldu?" sorusunun cevabını ancak
// AWX job log'unun 360 satırını açarak bulabiliyordu.
//
// ÇEVİRİ NEDEN BURADA: AWX job log'unu operasyon ekibi okuyor, orada İngilizce ve teknik
// kalması DOĞRU. Ayrıca playbook AWX'e elle kopyalanıyor — her metin değişikliği için
// yeniden deploy istemek anlamsız. Çeviri tek yerde, saf bir fonksiyonda, test edilebilir.

export interface ScaleXLogEntry {
  cluster: string;
  app: string;
  step: string;
  status: string;
  /** Kullanıcıya gösterilecek Türkçe cümle. */
  text: string;
  /** Ham `detail` — "teknik ayrıntı" olarak açılır kalır. */
  raw: string;
  tone: "ok" | "warn" | "fail" | "info";
}

const STEP_TR: Record<string, string> = {
  INPUT: "Girdi",
  WORKDIR: "Çalışma dizini",
  CLIENT: "oc istemcisi",
  API: "API erişimi",
  LOGIN: "Oturum",
  NAMESPACE: "Namespace",
  RBAC: "Yetki kontrolü",
  DISCOVERY: "Tespit",
  OBJECT: "Nesne",
  HPA: "HPA",
  PDB: "PodDisruptionBudget",
  PRECHECK: "Ön kontrol",
  RECHECK: "Son kontrol",
  STATE: "Durum kaydı",
  KAPAT: "Durdurma",
  GERI_AL: "Geri alma",
  SCALE: "Ölçekleme",
  VERIFY: "Doğrulama",
  READINESS: "Hazırlık",
  PODS: "Pod'lar",
  EVENTS: "Olaylar",
  RUNNER: "Çalıştırıcı",
  DRY_RUN: "Ön kontrol modu",
  BLOCKED: "Engellendi",
  WORKLOAD: "Uygulama",
};

function pairs(detail: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(detail || "").split(" ")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

function toneOf(status: string): ScaleXLogEntry["tone"] {
  const s = String(status || "").toUpperCase();
  if (s === "OK") return "ok";
  if (s === "WARN") return "warn";
  if (s === "FAIL") return "fail";
  return "info";
}

// Bilinen adımlar için kısa, olguya dayalı bir cümle. Bilinmeyen adımda ham metin
// gösterilir — sessizce atmak, kullanıcıyı yine AWX log'una gönderirdi.
function sentence(step: string, status: string, detail: string): string {
  const p = pairs(detail);
  const st = String(status || "").toUpperCase();

  switch (step) {
    case "LOGIN":
      return st === "OK" ? "Cluster'a bağlanıldı." : "Cluster'a bağlanılamadı.";
    case "API":
      return st === "OK" ? "API adresine erişildi." : "API adresine erişilemedi.";
    case "NAMESPACE":
      return st === "OK" ? "Namespace bulundu." : "Namespace bulunamadı ya da erişilemedi.";
    case "RBAC":
      return st === "OK" ? "Gerekli yetkiler var." : "Yetki eksik.";
    case "DISCOVERY":
      return p.current_spec_replicas != null
        ? `Uygulama bulundu — şu anki replica: ${p.current_spec_replicas}.`
        : "Uygulama bulundu.";
    case "HPA":
      return detail.startsWith("HPA_PRESENT")
        ? "HPA var; üzerinde değişiklik yapılmadı."
        : "HPA yok.";
    case "STATE":
      if (p.previous_replicas != null) {
        return `Geri alınabilir durum kaydedildi (önceki replica: ${p.previous_replicas}).`;
      }
      return st === "OK" ? "Durum kaydı güncellendi." : "Durum kaydı işlenemedi.";
    case "KAPAT":
    case "GERI_AL":
    case "SCALE": {
      const verb = step === "KAPAT" ? "Durdurma" : step === "GERI_AL" ? "Geri alma" : "Ölçekleme";
      if (st === "OK") return `${verb} uygulandı.`;
      if (st === "FAIL") return `${verb} uygulanamadı.`;
      return `${verb} hazırlanıyor.`;
    }
    case "VERIFY":
      if (st === "OK") {
        return p.target != null
          ? `Sonuç doğrulandı — replica ${p.target} oldu.`
          : "Sonuç doğrulandı.";
      }
      return "Sonuç doğrulanamadı: beklenen replica sayısına ulaşılmadı.";
    case "READINESS":
      // ASIL DEGERLI SATIR: replica geldi ama pod'lar henuz hazir degil. Playbook'un
      // basari olcutu bunu "basarili" sayiyor.
      return `Replica değişti ama pod'lar henüz hazır değil (hazır ${p.ready ?? "?"}/${p.target ?? "?"}).`;
    case "BLOCKED":
      return "Ön kontrol düştüğü ve “hepsi ya da hiçbiri” seçili olduğu için hiçbir değişiklik uygulanmadı.";
    case "DRY_RUN":
      return st === "OK"
        ? "Ön kontroller geçti; hiçbir şey değiştirilmedi."
        : "Ön kontrol hata verdi; hiçbir şey değiştirilmedi.";
    case "RUNNER":
      return "Cluster'a bağlanılamadı ya da çalıştırıcı sonuç üretemedi.";
    case "PRECHECK":
      return st === "OK" ? "Ön kontrol geçti." : "Ön kontrol düştü.";
    case "RECHECK":
      return st === "OK" ? "Son kontrol geçti." : "Son kontrol düştü — işlem uygulanmadı.";
    default:
      return "";
  }
}

/**
 * Playbook satırlarını okunur girdilere çevirir.
 *
 * GÜRÜLTÜ ELENİR: `WORKDIR`, `CLIENT`, `OBJECT` ve `INPUT` satırları altyapı
 * ayrıntısıdır — kullanıcıya "hangi dizine yazdım" ya da ham `oc get` çıktısı
 * göstermek, asıl olayları görünmez kılar. Ham hâlleri AWX log'unda duruyor.
 */
export function humanizeRunLog(rows: string[] | null | undefined): ScaleXLogEntry[] {
  const HIDDEN = new Set(["WORKDIR", "CLIENT", "OBJECT", "INPUT"]);
  const out: ScaleXLogEntry[] = [];

  for (const line of rows || []) {
    const p = String(line || "").split(";");
    if (p.length < 7) continue;
    const [cluster, , app, , step, status] = p;
    const detail = p.slice(6).join(";");
    if (HIDDEN.has(step)) continue;

    const text = sentence(step, status, detail);
    out.push({
      cluster,
      app: app && app !== "-" ? app : "",
      step: STEP_TR[step] || step,
      status: String(status || "").toUpperCase(),
      // Bilinmeyen adimda ham metin: sessizce atmak kullaniciyi yine AWX log'una
      // gonderirdi.
      text: text || detail,
      raw: detail,
      tone: toneOf(status),
    });
  }
  return out;
}
