// src/utils/scalexHealth.ts — playbook'un sağlık satırlarını okunur cümleye çevirir.
//
// NEDEN PORTAL TARAFINDA: playbook AWX'te ayrı yaşıyor ve her metin değişikliği yeniden
// deploy gerektirir. Ayrıca AWX job log'unu operasyon ekibi okuyor — orada İngilizce ve
// teknik kalması DOĞRU. Çeviri tek yerde, saf bir fonksiyonda ve test edilebilir.
//
// SÖZLEŞME: `detail` alanı `anahtar=deger` çiftleri taşır (bkz. scalex_runner.sh
// `disc_val`). Eski biçim — ham `oc get` satırı — hâlâ gelebilir: playbook AWX'e elle
// kopyalanıyor ve portal güncellendiğinde eski sürüm bir süre çalışmaya devam eder.
// Bu yüzden ayrıştırılamayan her satır OLDUĞU GİBİ gösterilir; boş ekran yerine ham
// metin, kullanıcının en azından bir şey görmesini sağlar.

export interface ScaleXHealthRow {
  cluster?: string;
  app: string;
  step: string;
  status: string;
  detail: string;
}

export type HealthTone = "ok" | "warn" | "info";

export interface HealthLine {
  app: string;
  cluster?: string;
  tone: HealthTone;
  text: string;
}

export interface HealthSummary {
  lines: HealthLine[];
  /** Eksik yetkiler için kullanıcının platformdan isteyeceği somut cümleler. */
  asks: string[];
  /** Yetki uyarıları dışında gösterilecek bir şey var mı? Yoksa blok hiç açılmamalı. */
  hasContent: boolean;
}

function pairs(detail: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(detail || "").split(" ")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

// "1/1" → tamamen hazır. Eşit değilse uygulama henüz ayağa kalkıyor demektir ve bu,
// `spec.replicas` eşitliğine bakan playbook'un GÖREMEDİĞİ tek şey.
function readyIsComplete(ready: string): boolean {
  const m = /^(\d+)\/(\d+)$/.exec(ready || "");
  return !!m && m[1] === m[2] && m[2] !== "0";
}

const RESOURCE_TR: Record<string, string> = {
  pods: "pod",
  events: "olay (event)",
  poddisruptionbudgets: "PodDisruptionBudget",
  configmaps: "ConfigMap",
};

export function humanizeHealth(rows: ScaleXHealthRow[], namespace?: string): HealthSummary {
  const lines: HealthLine[] = [];
  const asks = new Set<string>();

  for (const r of rows || []) {
    const p = pairs(r.detail);
    const base = { app: r.app, cluster: r.cluster };

    // ── YETKİ YOKLUĞU: bir hata değil, bir eksik. Kullanıcıya NE İSTEYECEĞİNİ söyler.
    if (p.permission_missing === "yes") {
      const res = RESOURCE_TR[p.resource] || p.resource || "kaynak";
      lines.push({
        ...base, tone: "info",
        text: `${res} bilgisi okunamadı — portalın OCP kullanıcısının bu namespace'te yetkisi yok.`,
      });
      asks.add(
        `Platform ekibinden isteyin: ${namespace ? `\`${namespace}\` namespace'inde ` : ""}`
        + `portalın OCP kullanıcısına \`${p.verb || "list"} ${p.resource || "?"}\` yetkisi `
        + "(genellikle `view` ClusterRole binding'i yeterli)."
      );
      continue;
    }

    if (r.step === "PODS") {
      if (p.pods === "0") {
        lines.push({ ...base, tone: "warn", text: "Hiç pod görünmüyor." });
        continue;
      }
      if (p.pod) {
        const complete = readyIsComplete(p.ready || "");
        const restarts = Number(p.restarts || 0);
        const bits = [`hazır ${p.ready || "?"}`, p.status || "?"];
        if (restarts > 0) bits.push(`${restarts} yeniden başlatma`);
        if (p.age) bits.push(p.age);
        lines.push({
          ...base,
          // Hazır olmayan pod bir UYARI: "replica geldi ama uygulama ayağa kalkmadı"
          // durumu playbook'un başarı ölçütünden kaçıyor.
          tone: complete && restarts === 0 ? "ok" : "warn",
          text: `${p.pod} · ${bits.join(" · ")}`,
        });
        continue;
      }
    }

    if (r.step === "EVENTS") {
      if (p.events === "0") {
        lines.push({ ...base, tone: "ok", text: "Uyarı olayı yok." });
        continue;
      }
      if (p.reason) {
        lines.push({
          ...base, tone: "warn",
          text: `Uyarı olayı: ${p.reason}${p.object ? ` (${p.object})` : ""}${p.age ? ` · ${p.age}` : ""}`,
        });
        continue;
      }
    }

    // ESKI BICIM ya da tanınmayan satır: ham metni göster. Sessizce atmak, playbook'un
    // eski sürümü çalışırken sağlık bloğunu BOŞ bırakırdı.
    const raw = String(r.detail || "").trim();
    if (raw) {
      lines.push({
        ...base,
        tone: r.status === "OK" ? "ok" : r.status === "FAIL" ? "warn" : "info",
        text: raw,
      });
    }
  }

  // Blok YALNIZCA yetki uyarılarından ibaretse hiç açılmamalı: kullanıcıya iki satır
  // "okuyamadım" göstermek, ekranı doldurup hiçbir şey söylememek olurdu. İstenecek
  // yetkiler yine de döndürülür — çağıran onları ayrı ve sakin bir yerde gösterir.
  const hasContent = lines.some((l) => l.tone !== "info");

  return { lines, asks: [...asks], hasContent };
}
