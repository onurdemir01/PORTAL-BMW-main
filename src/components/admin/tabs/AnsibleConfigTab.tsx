import React, { useState, useEffect } from "react";
import {
  CheckCircleIcon, XCircleIcon, ArrowPathIcon,
  ServerStackIcon, PlusIcon, PencilSquareIcon, TrashIcon,
} from "@heroicons/react/24/outline";
import { ansibleApi, type AwxTemplate, type OcpCluster } from "@/api/ansibleApi";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Form";

interface ServerHealth {
  id: number; name: string; url: string; configured: boolean;
  reachable: boolean; authOk: boolean; checkedAt: string;
  responseTimeMs: number | null; awxVersion: string | null; error: string | null;
  connectionType?: "token" | "user_pass";
}
interface HealthStatus { ok: boolean; url?: string; version?: string; message?: string; servers?: ServerHealth[]; }

const ENV_COLORS: Record<string, string> = {
  prod: "bg-red-50 text-red-700 border-red-100",
  test: "bg-yellow-50 text-yellow-700 border-yellow-100",
  qa:   "bg-blue-50 text-blue-700 border-blue-100",
  dev:  "bg-green-50 text-green-700 border-green-100",
};

type ClusterForm = { name: string; display: string; env: OcpCluster["env"]; apiUrl: string; consoleUrl: string; token: string; description: string; namespace: string; jumpHost: string };
const EMPTY_FORM: ClusterForm = { name: "", display: "", env: "prod", apiUrl: "", consoleUrl: "", token: "", description: "", namespace: "", jumpHost: "" };

type TemplateSummary = { serverId: number; serverName: string; ok: boolean; templates: AwxTemplate[]; error?: string };

export default function AnsibleConfigTab() {
  const [health, setHealth]           = useState<HealthStatus | null>(null);
  const [templateSummary, setSummary] = useState<TemplateSummary[]>([]);
  const [totalTemplates, setTotal]    = useState(0);
  const [clusters, setClusters]       = useState<OcpCluster[]>([]);
  const [loading, setLoading]         = useState(true);

  // Cluster form state
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [form, setForm]           = useState<ClusterForm>({ ...EMPTY_FORM });
  const [saving, setSaving]       = useState(false);

  // Canlı pod/node durumu — cluster.id bazlı (birden fazla cluster aynı anda sorgulanabilsin)
  const [podStatus, setPodStatus] = useState<Record<string, { loading: boolean; output?: string; error?: string }>>({});
  // Hafif "Bağlantıyı Test Et" sonucu — jump-host gerektirmeyen ayrı kontrol (actions.md #9)
  const [connTest, setConnTest] = useState<Record<string, { loading: boolean; ok?: boolean; message?: string; responseTimeMs?: number }>>({});

  async function handleTestConnection(cluster: OcpCluster) {
    setConnTest((s) => ({ ...s, [cluster.id]: { loading: true } }));
    try {
      const r = await ansibleApi.testClusterConnection(cluster.id);
      setConnTest((s) => ({ ...s, [cluster.id]: { loading: false, ok: r.ok, message: r.message, responseTimeMs: r.responseTimeMs } }));
    } catch (err) {
      setConnTest((s) => ({ ...s, [cluster.id]: { loading: false, ok: false, message: err instanceof Error ? err.message : "Bağlantı hatası." } }));
    }
  }

  async function handleToggleActive(cluster: OcpCluster) {
    const r = await ansibleApi.updateCluster(cluster.id, { isActive: !cluster.isActive });
    if (r.ok) setClusters((prev) => prev.map((c) => (c.id === cluster.id ? r.cluster : c)));
    else toast.error(r.message || "Güncellenemedi.");
  }

  async function handlePodStatus(cluster: OcpCluster) {
    setPodStatus((s) => ({ ...s, [cluster.id]: { loading: true } }));
    try {
      const r = await ansibleApi.clusterPodStatus(cluster.id);
      if (r.ok) setPodStatus((s) => ({ ...s, [cluster.id]: { loading: false, output: r.output || "" } }));
      else setPodStatus((s) => ({ ...s, [cluster.id]: { loading: false, error: r.message || "Pod durumu alınamadı." } }));
    } catch (err) {
      setPodStatus((s) => ({ ...s, [cluster.id]: { loading: false, error: err instanceof Error ? err.message : "Bağlantı hatası." } }));
    }
  }

  async function reload() {
    setLoading(true);
    try {
      const [h, t, c] = await Promise.allSettled([
        ansibleApi.health(),
        ansibleApi.awxTemplatesAll(),
        ansibleApi.clusters(),
      ]);
      if (h.status === "fulfilled") setHealth(h.value as HealthStatus);
      else setHealth({ ok: false, message: "Bağlanamadı" });
      if (t.status === "fulfilled") {
        const r = t.value as ReturnType<typeof ansibleApi.awxTemplatesAll> extends Promise<infer U> ? U : never;
        setSummary(r.summary || []);
        setTotal(r.total || 0);
      }
      if (c.status === "fulfilled") {
        const r = c.value as { ok?: boolean; clusters?: OcpCluster[] };
        setClusters(Array.isArray(r) ? r : r.clusters || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // Periyodik kontrol (actions.md #8) — 5 dk'da bir otomatik yenile, backend'e ek
    // yuk bindirmez (yalniz bu sekme acikken calisir, kisa TTL'li tek bir ping/sunucu).
    const timer = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  function openAdd() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(c: OcpCluster) {
    setEditId(c.id);
    setForm({ name: c.name, display: c.display, env: c.env, apiUrl: c.apiUrl, consoleUrl: c.consoleUrl || "", token: c.token || "", description: c.description, namespace: c.namespace, jumpHost: c.jumpHost || "" });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Cluster adı zorunlu."); return; }
    setSaving(true);
    try {
      if (editId) {
        const r = await ansibleApi.updateCluster(editId, form);
        if (r.ok) { setClusters((prev) => prev.map((c) => c.id === editId ? r.cluster : c)); toast.success("Cluster güncellendi."); }
        else toast.error(r.message || "Güncellenemedi.");
      } else {
        const r = await ansibleApi.addCluster(form);
        if (r.ok) { setClusters((prev) => [...prev, r.cluster]); toast.success("Cluster eklendi."); }
        else toast.error(r.message || "Eklenemedi.");
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`"${name}" cluster'ını silmek istediğinize emin misiniz?`)) return;
    const r = await ansibleApi.deleteCluster(id);
    if (r.ok) { setClusters(r.clusters || []); toast.success("Cluster silindi."); }
    else toast.error(r.message || "Silinemedi.");
  }

  return (
    <div className="space-y-8">
      {/* AWX Health */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">AWX Bağlantı Durumu</h3>
          <button onClick={reload} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${health?.ok ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}`}>
          {health?.ok
            ? <CheckCircleIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
            : <XCircleIcon className="w-5 h-5 text-red-400 flex-shrink-0" />}
          <div>
            <p className={`text-sm font-medium ${health?.ok ? "text-green-800" : "text-red-700"}`}>
              {health?.ok ? "AWX Bağlı" : "AWX Erişilemiyor"}
            </p>
            {health?.message && !health?.ok && <p className="text-xs text-red-500 mt-0.5">{health.message}</p>}
          </div>
        </div>
        {health?.servers && health.servers.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {health.servers.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 text-xs">
                {s.reachable && s.authOk
                  ? <CheckCircleIcon className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  : <XCircleIcon className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                <span className="font-medium text-gray-700">{s.name}</span>
                <span className="text-gray-400 font-mono">{s.url}</span>
                {s.awxVersion && <span className="text-gray-400">v{s.awxVersion}</span>}
                {s.responseTimeMs != null && <span className="text-gray-400">{s.responseTimeMs}ms</span>}
                {s.error && <span className="text-red-500 ml-auto">{s.error}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* AWX Template Özeti — Çoklu Sunucu */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">
          AWX Şablonları
          {totalTemplates > 0 && <span className="ml-2 text-xs font-normal text-gray-400">({totalTemplates} toplam)</span>}
        </h3>
        <p className="text-xs text-gray-400 mb-3">Tüm AWX sunucularındaki read-only iş şablonları.</p>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : templateSummary.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">AWX sunucusu bulunamadı.</p>
        ) : (
          <div className="space-y-4">
            {templateSummary.map((srv) => (
              <div key={srv.serverId}>
                <div className="flex items-center gap-2 mb-2">
                  {srv.ok
                    ? <CheckCircleIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                    : <XCircleIcon className="w-4 h-4 text-red-400 flex-shrink-0" />}
                  <span className="text-xs font-semibold text-gray-700">{srv.serverName}</span>
                  <span className="text-xs text-gray-400">({srv.templates.length} şablon)</span>
                  {srv.error && <span className="text-xs text-red-400 ml-1">{srv.error}</span>}
                </div>
                {srv.templates.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-gray-100 mb-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100 text-left">
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">ID</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Şablon Adı</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Playbook</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Proje</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Tip</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Değiştirilme</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {srv.templates.map((t) => (
                          <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-2 text-xs font-mono text-gray-500">{t.id}</td>
                            <td className="px-4 py-2 font-medium text-gray-800 text-xs">
                              {t.name}
                              {t.hasInventory === false && <span className="ml-1.5 text-[10px] text-amber-600" title="Envanter atanmamış — launch edilemeyebilir">⚠</span>}
                            </td>
                            <td className="px-4 py-2 text-xs font-mono text-[#1A56DB]">{t.playbook}</td>
                            <td className="px-4 py-2 text-xs text-gray-500">{t.project || "—"}</td>
                            <td className="px-4 py-2 text-xs text-gray-500">{t.jobType || "—"}</td>
                            <td className="px-4 py-2 text-xs text-gray-400">{t.modified ? new Date(t.modified).toLocaleDateString("tr-TR") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* OCP Cluster Yönetimi */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <ServerStackIcon className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-700">OCP Cluster Yönetimi</h3>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#1A56DB] text-white rounded-lg hover:bg-blue-700">
            <PlusIcon className="w-3.5 h-3.5" /> Cluster Ekle
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Portal genelinde referans alınan OpenShift cluster'larını yönet.
          Her cluster; ortam, API URL ve namespace bilgisi içerir.
        </p>

        {/* Add/Edit Form */}
        {showForm && (
          <div className="mb-4 p-4 border border-[#1A56DB]/20 bg-blue-50/30 rounded-xl space-y-3">
            <p className="text-xs font-semibold text-gray-700">{editId ? "Cluster Düzenle" : "Yeni Cluster"}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Kod Adı *</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="ocp-prod-01"
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] font-mono" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Görünen Ad</label>
                <input value={form.display} onChange={(e) => setForm((f) => ({ ...f, display: e.target.value }))}
                  placeholder="OCP Production 1"
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB]" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Ortam</label>
                <Select sizeVariant="sm" value={form.env} onChange={(e) => setForm((f) => ({ ...f, env: e.target.value as OcpCluster["env"] }))}>
                  <option value="prod">Production</option>
                  <option value="test">Test</option>
                  <option value="qa">QA</option>
                  <option value="dev">Dev</option>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">API URL</label>
                <input value={form.apiUrl} onChange={(e) => setForm((f) => ({ ...f, apiUrl: e.target.value }))}
                  placeholder="https://api.cluster.example.com:6443"
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] font-mono" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Console URL</label>
                <input value={form.consoleUrl} onChange={(e) => setForm((f) => ({ ...f, consoleUrl: e.target.value }))}
                  placeholder="https://console-openshift-console.apps.cluster.example.com"
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] font-mono" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-1">Service Account Token (opsiyonel)</label>
                <input type="password" value={form.token} onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                  placeholder="eyJhbGci..."
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] font-mono" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Namespace (opsiyonel)</label>
                <input value={form.namespace} onChange={(e) => setForm((f) => ({ ...f, namespace: e.target.value }))}
                  placeholder="bmw-apps"
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] font-mono" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Jump/Bastion Host (opsiyonel)</label>
                <input value={form.jumpHost} onChange={(e) => setForm((f) => ({ ...f, jumpHost: e.target.value }))}
                  placeholder="oc login yapılmış bastion hostname"
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] font-mono" />
                <p className="text-[11px] text-gray-400 mt-0.5">Canlı pod/node durumu sorguları (AWX) bu host üzerinden çalışır.</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Açıklama</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="..."
                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB]" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
                İptal
              </button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="px-3 py-1.5 text-xs bg-[#1A56DB] text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
                {saving ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        )}

        {clusters.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
            Henüz cluster tanımlı değil. "Cluster Ekle" ile başlayın.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {clusters.map((c) => (
              <div key={c.id} className={`relative px-4 py-3 border border-gray-100 rounded-xl bg-white hover:shadow-sm transition-shadow ${c.isActive === false ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${ENV_COLORS[c.env] || "bg-gray-50 text-gray-600 border-gray-100"}`}>
                        {c.env.toUpperCase()}
                      </span>
                      <span className="font-medium text-gray-800 text-sm truncate">{c.display || c.name}</span>
                      {c.isActive === false && <span className="text-xs text-gray-400">(pasif)</span>}
                    </div>
                    <p className="text-xs font-mono text-gray-400 truncate">{c.name}</p>
                    {c.apiUrl && <p className="text-xs font-mono text-[#1A56DB] truncate mt-1">{c.apiUrl}</p>}
                    {c.consoleUrl && (
                      <a href={c.consoleUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-mono text-emerald-600 hover:underline truncate mt-0.5 block">
                        {c.consoleUrl}
                      </a>
                    )}
                    {c.namespace && <p className="text-xs text-gray-400 mt-0.5">ns: <span className="font-mono">{c.namespace}</span></p>}
                    {c.jumpHost && <p className="text-xs text-gray-400 mt-0.5">jump host: <span className="font-mono">{c.jumpHost}</span></p>}
                    {c.token && <p className="text-xs text-gray-300 mt-0.5 font-mono">token: ••••••••</p>}
                    {c.description && <p className="text-xs text-gray-400 mt-1 truncate">{c.description}</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => handleToggleActive(c)}
                      title={c.isActive === false ? "Aktif yap" : "Pasif yap"}
                      className="p-1 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors">
                      {c.isActive === false ? <XCircleIcon className="w-4 h-4" /> : <CheckCircleIcon className="w-4 h-4" />}
                    </button>
                    <button onClick={() => openEdit(c)}
                      className="p-1 text-gray-400 hover:text-[#1A56DB] hover:bg-blue-50 rounded-lg transition-colors">
                      <PencilSquareIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(c.id, c.display || c.name)}
                      className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {c.apiUrl && (
                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleTestConnection(c)}
                      disabled={connTest[c.id]?.loading}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    >
                      <ArrowPathIcon className={`w-3 h-3 ${connTest[c.id]?.loading ? "animate-spin" : ""}`} />
                      Bağlantıyı Test Et
                    </button>
                    {connTest[c.id] && !connTest[c.id].loading && (
                      <span className={`text-xs ${connTest[c.id].ok ? "text-emerald-600" : "text-red-500"}`}>
                        {connTest[c.id].ok ? `Erişilebilir (${connTest[c.id].responseTimeMs}ms)` : connTest[c.id].message}
                      </span>
                    )}
                    {!connTest[c.id] && c.connectionStatus && (
                      <span className={`text-xs ${c.connectionStatus === "ok" ? "text-emerald-500" : "text-red-400"}`}>
                        Son kontrol: {c.connectionStatus === "ok" ? "erişilebilir" : "erişilemedi"}
                        {c.lastCheckedAt && ` · ${new Date(c.lastCheckedAt).toLocaleString("tr-TR")}`}
                      </span>
                    )}
                  </div>
                )}

                {c.jumpHost && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => handlePodStatus(c)}
                      disabled={podStatus[c.id]?.loading}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    >
                      <ArrowPathIcon className={`w-3 h-3 ${podStatus[c.id]?.loading ? "animate-spin" : ""}`} />
                      Pod Durumu
                    </button>
                    {podStatus[c.id]?.error && (
                      <p className="mt-1.5 text-xs text-red-600">{podStatus[c.id].error}</p>
                    )}
                    {podStatus[c.id]?.output !== undefined && (
                      <pre className="mt-1.5 bg-gray-950 text-green-400 text-[11px] font-mono rounded-lg p-3 overflow-auto max-h-56 whitespace-pre-wrap break-words">
                        {podStatus[c.id].output || "(çıktı yok)"}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Ortam Değişkenleri Notu — actions.md #10: her değişkenin (i) ikonunda açıklama/örnek/kullanım yeri */}
      <section className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
        <p className="font-semibold mb-1">Gerekli Env Değişkenleri</p>
        <ul className="space-y-1 font-mono">
          {[
            { key: "AWX_URL", desc: "Varsayılan (legacy tek-sunucu) AWX/Tower adresi." },
            { key: "AWX_USER + AWX_PASSWORD", desc: "AWX_TOKEN tanımlı değilse, token almak için kullanılan servis hesabı — şifre DB'de şifreli saklanır." },
            { key: "AWX_READ_ONLY_TEMPLATE_IDS", desc: "Virgülle ayrılmış template ID listesi — boşsa TÜM template'ler izinli sayılır." },
            { key: "AWX_LOG_FETCH_TEMPLATE_ID", desc: "AI Analist'in uzak log dosyası çekmek için kullandığı template ID'si." },
          ].map((v) => (
            <li key={v.key} className="flex items-center gap-1.5">
              <span>{v.key}</span>
              <span className="text-amber-400 cursor-help font-sans" title={v.desc}>ⓘ</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-amber-500 font-sans">Tüm değerler Admin &gt; Sistem sekmesinden de kalıcı olarak (DB'de) ayarlanabilir.</p>
      </section>
    </div>
  );
}
