// src/components/admin/tabs/OpsxConfigTab.tsx — Admin > OpsX Yapılandırma.
//
// Burada YÖNETİLEN: OpsX'in AWX job'ına gönderdiği extra_vars anahtar adları, sunucu
// listesi ayıracı ve her çalıştırmaya eklenecek sabit değişkenler. Openshift bölümündeki
// terminalHost*/namespaceKey/appNameKey/clustersKey/clusterListStyle alanları artık OpsX
// tarafından KULLANILMIYOR (OpsX kendi çalıştırmasında sadece env/oc_cluster/oc_input
// gönderir) — ama aynı blob'u Telnet modülü paylaştığı için burada düzenlenebilir kalır.
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
  // Openshift — OpsX'in KENDI /api/opsx/run yolu
  envKey?: string;
  ocClusterKey?: string;
  ocInputKey?: string;
  // Openshift — SADECE Telnet icin paylasilan alanlar (bkz. dosya basi notu)
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
    { field: "envKey", label: "Ortam değişkeni" },
    { field: "ocClusterKey", label: "Cluster (tenant) değişkeni" },
    { field: "ocInputKey", label: "Namespace/uygulama girdisi değişkeni" },
  ],
};

// Telnet paylaşımlı alanları — OpsX bunları göstermez/kullanmaz ama Telnet'in OpenShift
// akışı hâlâ bu blob'dan okuduğu için burada ayrı bir grupta düzenlenebilir kalır.
const TELNET_SHARED_FIELDS: { field: keyof PlatformConfig; label: string }[] = [
  { field: "terminalHostKey", label: "Jump server (bastion) değişkeni" },
  { field: "terminalHostsKey", label: "Jump server listesi değişkeni" },
  { field: "namespaceKey", label: "Namespace değişkeni" },
  { field: "appNameKey", label: "Uygulama adı değişkeni" },
  { field: "clustersKey", label: "Cluster listesi değişkeni" },
];

const SEPARATOR_HELP: Record<Platform, string> = {
  legacy: "Birden fazla sunucu seçildiğinde AWX'in limit alanında aralarına konur.",
  openshift: "OpsX'in oc_input çiftleri her zaman \";\" ile ayrılır (bu ayıraç kullanılmaz); Telnet'in cluster_name listesinde kullanılır.",
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

            {plat === "legacy" && (
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
            )}

            {plat === "openshift" && (
              <details className="border border-[var(--border)] rounded-lg p-3">
                <summary className="text-xs font-medium cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
                  Telnet ile paylaşılan alanlar (OpsX bunları kullanmaz)
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="text-xs px-2 py-1.5 rounded-lg bg-amber-50 text-amber-800">
                    ⚠ Bu alanlar <strong>OpsX'te artık kullanılmıyor</strong> — OpsX her zaman
                    env/oc_cluster/oc_input gönderir. Aynı yapılandırma blob'unu{" "}
                    <strong>Telnet</strong> modülü de paylaştığı için burada kalır; değiştirmeden
                    önce Telnet'in OpenShift akışının aynı sözleşmeyi beklediğinden emin olun.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {TELNET_SHARED_FIELDS.map(({ field, label }) => (
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
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                      Cluster listesi biçimi (Telnet)
                    </label>
                    <select
                      value={c.clusterListStyle ?? "joined"}
                      onChange={(e) => update(plat, "clusterListStyle", e.target.value)}
                      className="px-2.5 py-1.5 text-sm border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
                    >
                      <option value="joined">Birleşik (tek öğe, cluster adları ayıraçla)</option>
                      <option value="perCluster">Cluster başına (her cluster kendi jump server'ı ile)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                      Cluster listesi ayıracı (Telnet)
                    </label>
                    <input
                      value={c.separator}
                      onChange={(e) => update(plat, "separator", e.target.value)}
                      className="w-24 px-2.5 py-1.5 text-sm font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
              </details>
            )}

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
                Yukarıdaki değişkenlerle aynı adı taşıyan satırlar ezilir.
              </p>
            </div>

            {/* AWX'e gidecek gövdenin canlı önizlemesi — admin ne göndereceğini
                tahmin etmek zorunda kalmasın. Legacy'de sunucu listesi ÜST SEVİYEDE
                `limit` alanında, Openshift'te ise her şey extra_vars içinde. */}
            <div className="bg-[var(--bg-elevated)] rounded-lg p-3">
              <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                OpsX'in AWX'e gidecek gövdesi (örnek):
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
      extra_vars: {
        [c.envKey || "env"]: "qa",
        [c.ocClusterKey || "oc_cluster"]: "ark",
        [c.ocInputKey || "oc_input"]: "das-trading-management-qa,dropcopy-integration-v0;another-ns,another-app",
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
