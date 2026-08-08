// src/components/admin/tabs/OpsxConfigTab.tsx — Admin > OpsX Yapılandırma.
//
// Burada YÖNETİLEN: OpsX'in AWX job'ına gönderdiği extra_vars anahtar adları, sunucu
// listesi ayıracı ve her çalıştırmaya eklenecek sabit değişkenler.
//
// Burada YÖNETİLMEYEN: hangi AWX sunucusu / hangi job template'i. Onlar
// Admin > Playbook Kayıtları ekranında (opsx_legacy_operation ve
// opsx_openshift_operation satırları) tanımlanır — LogX ile aynı desen. Bu ekran
// o değerleri yalnızca SALT-OKUNUR özet olarak gösterir ki "template tanımlı mı?"
// sorusu tek bakışta cevaplanabilsin.
import React, { useEffect, useState } from "react";
import { CheckCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { toast } from "@/hooks/useToast";

type Platform = "legacy" | "openshift";

interface PlatformConfig {
  // Legacy
  applicationKey?: string;
  operationKey?: string;
  // Openshift
  terminalHostKey?: string;
  terminalHostsKey?: string;
  namespaceKey?: string;
  appNameKey?: string;
  clustersKey?: string;
  clusterListStyle?: "joined" | "perCluster";
  // Ortak
  extraVars: string;
  separator: string;
}

// Platform başına düzenlenebilir anahtar alanları + etiketleri. Legacy ve Openshift
// gövdeleri YAPISAL OLARAK farklı olduğu için alan setleri de farklı.
const KEY_FIELDS: Record<Platform, { field: keyof PlatformConfig; label: string }[]> = {
  legacy: [
    { field: "applicationKey", label: "Uygulama adı değişkeni" },
    { field: "operationKey", label: "İşlem değişkeni" },
  ],
  openshift: [
    { field: "terminalHostKey", label: "Jump server (bastion) değişkeni" },
    { field: "terminalHostsKey", label: "Jump server listesi değişkeni" },
    { field: "namespaceKey", label: "Namespace değişkeni" },
    { field: "appNameKey", label: "Uygulama adı değişkeni" },
    { field: "clustersKey", label: "Cluster listesi değişkeni" },
  ],
};

const SEPARATOR_HELP: Record<Platform, string> = {
  legacy: "Birden fazla sunucu seçildiğinde AWX'in limit alanında aralarına konur.",
  openshift: "Birden fazla cluster seçildiğinde cluster_name içinde aralarına konur.",
};

interface TargetInfo {
  registryKey: string;
  templateId: number | null;
  awxServerId: number | null;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  legacy: "Legacy (JBoss/WAS)",
  openshift: "Openshift (ARK/Non-ARK)",
};

export default function OpsxConfigTab() {
  const [config, setConfig] = useState<Record<Platform, PlatformConfig> | null>(null);
  const [targets, setTargets] = useState<Record<Platform, TargetInfo> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/opsx/config");
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Yüklenemedi.");
      setConfig(data.config);
      setTargets(data.targets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function update(plat: Platform, field: keyof PlatformConfig, value: string) {
    setConfig((prev) => (prev ? { ...prev, [plat]: { ...prev[plat], [field]: value } } : prev));
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/opsx/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Kaydedilemedi.");
      setConfig(data.config);
      if (data.warnings?.length) {
        toast.warning(`Bazı satırlar geçersiz olduğu için atlandı: ${data.warnings.join(" — ")}`);
      } else {
        toast.success("OpsX parametre yapılandırması kaydedildi.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (error && !config) {
    return <div className="pf-alert pf-alert--danger p-3 text-sm">{error}</div>;
  }
  if (!config || !targets) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">OpsX Yapılandırma</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          OpsX'in AWX job'ına gönderdiği parametrelerin adlarını ve biçimini belirler.
          Hangi AWX sunucusu ve job template'inin tetiklendiği <strong>Playbook Kayıtları</strong>{" "}
          sekmesinden yönetilir.
        </p>
      </div>

      {error && <div className="pf-alert pf-alert--danger p-3 text-sm">{error}</div>}

      {(["legacy", "openshift"] as Platform[]).map((plat) => {
        const t = targets[plat];
        const c = config[plat];
        return (
          <div key={plat} className="border border-[var(--border)] rounded-xl p-4 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-semibold">{PLATFORM_LABELS[plat]}</h3>
              {/* Playbook Kayıtları'ndaki hedef — salt okunur durum göstergesi */}
              <div className="text-xs flex items-center gap-1.5">
                {t.templateId ? (
                  <>
                    <CheckCircleIcon className="w-4 h-4 text-green-600" />
                    <span style={{ color: "var(--text-muted)" }}>
                      Template <span className="font-mono">{t.templateId}</span>
                      {" · "}AWX sunucu <span className="font-mono">{t.awxServerId ?? 0}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <ExclamationTriangleIcon className="w-4 h-4 text-amber-600" />
                    <span className="text-amber-700">
                      Template tanımsız — Playbook Kayıtları →{" "}
                      <span className="font-mono">{t.registryKey}</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {KEY_FIELDS[plat].map(({ field, label }) => (
                <div key={String(field)}>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    {label}
                  </label>
                  <input
                    value={String(c[field] ?? "")}
                    onChange={(e) => update(plat, field, e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
                  />
                </div>
              ))}
            </div>

            {plat === "openshift" && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                  Cluster listesi biçimi
                </label>
                <select
                  value={c.clusterListStyle ?? "joined"}
                  onChange={(e) => update(plat, "clusterListStyle", e.target.value)}
                  className="px-2.5 py-1.5 text-sm border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
                >
                  <option value="joined">Birleşik (tek öğe, cluster adları ayıraçla)</option>
                  <option value="perCluster">Cluster başına (her cluster kendi jump server'ı ile)</option>
                </select>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  <strong>Birleşik</strong> bugünkü davranıştır ve tek jump server varsayar; seçilen
                  cluster'lar farklı jump server'lara düşerse işlem hata verir. <strong>Cluster başına</strong>
                  seçeneği her cluster'ı kendi jump server'ıyla gönderir (LogX ile aynı sözleşme) —
                  yalnızca playbook çoklu bastion destekliyorsa seçin.
                </p>
                <p className="mt-1 text-xs px-2 py-1.5 rounded-lg bg-amber-50 text-amber-800">
                  ⚠ Bu Openshift ayarları (değişken adları, ayıraç ve liste biçimi) <strong>Telnet</strong>
                  modülünün OpenShift akışında da kullanılır. Değiştirmeden önce Telnet playbook'unun
                  (<span className="font-mono">telnet_openshift_operation</span>) aynı sözleşmeyi
                  beklediğinden emin olun.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                Sunucu listesi ayıracı
              </label>
              <input
                value={c.separator}
                onChange={(e) => update(plat, "separator", e.target.value)}
                className="w-24 px-2.5 py-1.5 text-sm font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
              />
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {SEPARATOR_HELP[plat]} Varsayılan virgül.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                Ek sabit değişkenler (opsiyonel)
              </label>
              <textarea
                rows={3}
                value={c.extraVars}
                onChange={(e) => update(plat, "extraVars", e.target.value)}
                placeholder={"ortam: prod\ntimeout: 300"}
                className="w-full px-2.5 py-1.5 text-sm font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
              />
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                Her satır <span className="font-mono">anahtar: değer</span> biçiminde. Her
                çalıştırmaya otomatik eklenir; kullanıcı bunları görmez ve değiştiremez.
                Yukarıdaki üç değişkenle aynı adı taşıyan satırlar ezilir.
              </p>
            </div>

            {/* Kaydedilecek biçimin canlı önizlemesi — admin ne göndereceğini
                tahmin etmek zorunda kalmasın. */}
            {/* AWX'e gidecek gövdenin canlı önizlemesi — admin ne göndereceğini
                tahmin etmek zorunda kalmasın. Legacy'de sunucu listesi ÜST SEVİYEDE
                `limit` alanında, Openshift'te ise her şey extra_vars içinde. */}
            <div className="bg-[var(--bg-elevated)] rounded-lg p-3">
              <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                AWX'e gidecek gövde (örnek):
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
{plat === "legacy"
  ? JSON.stringify({
      limit: `GBCJAP01${c.separator}GBCJAP03`,
      extra_vars: {
        [c.applicationKey || "application"]: "GBGARANTICEPSERVICES",
        [c.operationKey || "operation"]: "restart",
      },
    }, null, 2)
  : JSON.stringify({
      extra_vars: (c.clusterListStyle ?? "joined") === "perCluster"
        ? {
            [c.terminalHostKey || "terminal_host"]: "GBAOCP01",
            [c.terminalHostsKey || "terminal_hosts"]: ["GBAOCP01", "GBAOCP02"],
            [c.namespaceKey || "namespace"]: "das-trading-management-qa",
            [c.appNameKey || "app_name"]: "dropcopy-integration-v0",
            [c.clustersKey || "ocp_clusters"]: [
              { env: "qa", tenant: "ark", cluster_name: "gbocpqa1", terminal_host: "GBAOCP01" },
              { env: "qa", tenant: "ark", cluster_name: "gbocpqa2", terminal_host: "GBAOCP02" },
            ],
          }
        : {
            [c.terminalHostKey || "terminal_host"]: "GBAOCP01",
            [c.namespaceKey || "namespace"]: "das-trading-management-qa",
            [c.appNameKey || "app_name"]: "dropcopy-integration-v0",
            [c.clustersKey || "ocp_clusters"]: [
              { env: "qa", tenant: "ark", cluster_name: `gbocpqa1${c.separator}gbocpqa2` },
            ],
          },
    }, null, 2)}
              </pre>
            </div>
          </div>
        );
      })}

      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <button onClick={load} disabled={saving} className="btn-secondary flex items-center gap-1.5">
          <ArrowPathIcon className="w-4 h-4" />
          Yenile
        </button>
      </div>
    </div>
  );
}
