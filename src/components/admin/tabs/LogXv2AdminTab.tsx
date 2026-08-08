// src/components/admin/tabs/LogXv2AdminTab.tsx — LogX v2'nin 4 admin-yönetimli veri
// kaynağı için tek sekme: OCP cluster hiyerarşisi, terminal/bastion host eşlemesi, Legacy
// ortam-etiketi son-ek eşlemesi ve varsayılan-açık yetkilendirme kısıtlamaları.
import React, { useEffect, useState } from "react";
import { ServerStackIcon, CommandLineIcon, TagIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import {
  logxV2Api,
  type OcpClusterIndexRow, type OcpTerminalHostRow, type EnvSuffixRow, type RestrictionRow,
} from "@/api/logxV2Api";
import SimpleCrudTable, { type ColumnDef } from "./logxv2/SimpleCrudTable";
import { Select } from "@/components/ui/Form";

const SUB_TABS = [
  { id: "clusters", label: "OCP Cluster Hiyerarşisi", icon: ServerStackIcon },
  { id: "terminals", label: "Terminal/Bastion Host", icon: CommandLineIcon },
  { id: "envsuffix", label: "Legacy Ortam Son-Eki", icon: TagIcon },
  { id: "restrictions", label: "Kısıtlamalar", icon: LockClosedIcon },
] as const;
type SubTabId = (typeof SUB_TABS)[number]["id"];

const CLUSTER_COLUMNS: ColumnDef<OcpClusterIndexRow>[] = [
  { key: "env", label: "Ortam (env)", placeholder: "dev" },
  { key: "tenant", label: "Tenant", placeholder: "ark" },
  { key: "cluster_name", label: "Cluster Adı", placeholder: "gbocptest1" },
  { key: "terminal_host", label: "Jump Server (opsiyonel)", placeholder: "boş = tenant/env eşlemesi" },
  { key: "is_active", label: "Aktif", type: "checkbox" },
];
const CLUSTER_EMPTY: Partial<OcpClusterIndexRow> = { env: "", tenant: "", cluster_name: "", terminal_host: "", is_active: true };

const TERMINAL_COLUMNS: ColumnDef<OcpTerminalHostRow>[] = [
  { key: "tenant", label: "Tenant", placeholder: "ark" },
  { key: "env", label: "Ortam (env)", placeholder: "dev" },
  { key: "terminal_host", label: "Terminal/Bastion Host", placeholder: "gbaocp01" },
  { key: "is_active", label: "Aktif", type: "checkbox" },
];
const TERMINAL_EMPTY: Partial<OcpTerminalHostRow> = { tenant: "", env: "", terminal_host: "", is_active: true };

const ENVSUFFIX_COLUMNS: ColumnDef<EnvSuffixRow>[] = [
  { key: "suffix", label: "EAR Klasör Son-Eki", placeholder: "-T (boş = son-ek yok)" },
  { key: "env_label", label: "Ortam Etiketi", placeholder: "TEST" },
  { key: "sort_order", label: "Sıra", type: "number" },
  { key: "is_active", label: "Aktif", type: "checkbox" },
];
const ENVSUFFIX_EMPTY: Partial<EnvSuffixRow> = { suffix: "", env_label: "", sort_order: 0, is_active: true };

function useCrudSection<T extends { id: number }>(
  list: () => Promise<{ ok: boolean; rows: T[] }>,
  create: (data: Partial<T>) => Promise<{ ok: boolean; row: T }>,
  update: (id: number, data: Partial<T>) => Promise<{ ok: boolean; row: T }>,
  remove: (id: number) => Promise<{ ok: boolean }>
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await list();
      setRows(r.rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rows, loading, error, reload: load,
    onCreate: async (data: Partial<T>) => { const r = await create(data); setRows((prev) => [...prev, r.row]); },
    onUpdate: async (id: number, data: Partial<T>) => { const r = await update(id, data); setRows((prev) => prev.map((x) => (x.id === id ? r.row : x))); },
    onDelete: async (id: number) => { await remove(id); setRows((prev) => prev.filter((x) => x.id !== id)); },
  };
}

const RestrictionsSection: React.FC = () => {
  const [restrictions, setRestrictions] = useState<RestrictionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resourceType, setResourceType] = useState<"legacy_app" | "ocp_namespace">("legacy_app");
  const [resourceKey, setResourceKey] = useState("");
  const [description, setDescription] = useState("");
  const [grantInputs, setGrantInputs] = useState<Record<number, string>>({});
  const [editingDescId, setEditingDescId] = useState<number | null>(null);
  const [editDescValue, setEditDescValue] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await logxV2Api.admin.listRestrictions();
      setRestrictions(r.restrictions);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!resourceKey.trim()) return;
    try {
      await logxV2Api.admin.createRestriction({ resourceType, resourceKey: resourceKey.trim(), description });
      setResourceKey("");
      setDescription("");
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveDescription(id: number) {
    try {
      await logxV2Api.admin.updateRestriction(id, { description: editDescValue });
      setEditingDescId(null);
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function addGrant(id: number) {
    const username = (grantInputs[id] || "").trim();
    if (!username) return;
    try {
      await logxV2Api.admin.addGrant(id, username);
      setGrantInputs((prev) => ({ ...prev, [id]: "" }));
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div>;
  if (error) return <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
        Varsayılan olarak TÜM uygulama/namespace'ler HERKESE AÇIKTIR. Burada bir kayıt
        oluşturmak, o kaynağı yalnızca aşağıya eklenen kullanıcılara (+ her zaman Admin'lere)
        KISITLAR — kayıt eklemek erişimi AÇMAZ, DARALTIR.
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-gray-800">Yeni Kısıtlama</p>
        <div className="grid grid-cols-3 gap-2">
          <Select
            sizeVariant="sm"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value as "legacy_app" | "ocp_namespace")}
          >
            <option value="legacy_app">Legacy Uygulama</option>
            <option value="ocp_namespace">OCP Namespace</option>
          </Select>
          <input
            value={resourceKey}
            onChange={(e) => setResourceKey(e.target.value)}
            placeholder={resourceType === "legacy_app" ? "GBCEPPOSDASHBOARD" : "tenant/env/cluster/namespace"}
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-black focus:ring-1 focus:ring-black"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Açıklama (opsiyonel)"
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-black focus:ring-1 focus:ring-black"
          />
        </div>
        <button onClick={create} className="px-3 py-1.5 bg-black text-white text-xs rounded-lg hover:bg-gray-800 transition-colors">
          Kısıtlama Ekle
        </button>
      </div>

      <div className="space-y-2">
        {restrictions.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Hiç kısıtlama yok — her şey herkese açık.</p>}
        {restrictions.map((r) => (
          <div key={r.id} className="border border-gray-100 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 mr-2">
                  {r.resourceType === "legacy_app" ? "Legacy" : "OCP"}
                </span>
                <span className="text-sm font-semibold text-gray-800">{r.resourceKey}</span>
                {editingDescId !== r.id && (
                  <button
                    onClick={() => { setEditingDescId(r.id); setEditDescValue(r.description || ""); }}
                    className="text-xs text-gray-400 hover:text-gray-700 ml-2 underline decoration-dotted"
                  >
                    {r.description || "açıklama ekle"}
                  </button>
                )}
              </div>
              <button
                onClick={async () => { await logxV2Api.admin.deleteRestriction(r.id); await load(); }}
                className="text-xs text-red-500 hover:underline"
              >
                Kısıtlamayı Kaldır
              </button>
            </div>
            {editingDescId === r.id && (
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  value={editDescValue}
                  onChange={(e) => setEditDescValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveDescription(r.id); if (e.key === "Escape") setEditingDescId(null); }}
                  placeholder="Açıklama"
                  autoFocus
                  className="px-2 py-1 text-xs border border-gray-200 rounded-lg outline-none focus:border-black flex-1"
                />
                <button onClick={() => saveDescription(r.id)} className="text-xs text-black hover:underline">Kaydet</button>
                <button onClick={() => setEditingDescId(null)} className="text-xs text-gray-400 hover:underline">Vazgeç</button>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {r.grants.map((g) => (
                <span key={g} className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                  {g}
                  <button
                    onClick={async () => { await logxV2Api.admin.removeGrant(r.id, g); await load(); }}
                    className="text-emerald-500 hover:text-emerald-800"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={grantInputs[r.id] || ""}
                onChange={(e) => setGrantInputs((prev) => ({ ...prev, [r.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") addGrant(r.id); }}
                placeholder="kullanıcı adı ekle..."
                className="px-2 py-1 text-xs border border-gray-200 rounded-full outline-none focus:border-black w-32"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const LogXv2AdminTab: React.FC = () => {
  const [subTab, setSubTab] = useState<SubTabId>("clusters");

  const clusters = useCrudSection(
    logxV2Api.admin.listClusterIndex, logxV2Api.admin.createClusterIndex, logxV2Api.admin.updateClusterIndex, logxV2Api.admin.deleteClusterIndex
  );
  const terminals = useCrudSection(
    logxV2Api.admin.listTerminalHostMap, logxV2Api.admin.createTerminalHost, logxV2Api.admin.updateTerminalHost, logxV2Api.admin.deleteTerminalHost
  );
  const envSuffix = useCrudSection(
    logxV2Api.admin.listEnvSuffixMap, logxV2Api.admin.createEnvSuffix, logxV2Api.admin.updateEnvSuffix, logxV2Api.admin.deleteEnvSuffix
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg p-1 bg-gray-50 flex-wrap">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                active ? "bg-white text-black shadow-sm" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === "clusters" && (
        clusters.loading ? <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div> :
        clusters.error ? <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{clusters.error}</div> :
        <SimpleCrudTable columns={CLUSTER_COLUMNS} rows={clusters.rows} emptyRow={CLUSTER_EMPTY}
          onCreate={clusters.onCreate} onUpdate={clusters.onUpdate} onDelete={clusters.onDelete} />
      )}
      {subTab === "terminals" && (
        terminals.loading ? <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div> :
        terminals.error ? <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{terminals.error}</div> :
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
            Bu tablo artık <strong>yedek (fallback)</strong> eşlemedir: bir cluster'ın kendi satırında
            (OCP Cluster Hiyerarşisi sekmesi) Jump Server doluysa <strong>o kazanır</strong>; boşsa buradaki
            tenant/env eşlemesi kullanılır.
          </div>
          <SimpleCrudTable columns={TERMINAL_COLUMNS} rows={terminals.rows} emptyRow={TERMINAL_EMPTY}
            onCreate={terminals.onCreate} onUpdate={terminals.onUpdate} onDelete={terminals.onDelete} />
        </div>
      )}
      {subTab === "envsuffix" && (
        envSuffix.loading ? <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div> :
        envSuffix.error ? <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{envSuffix.error}</div> :
        <SimpleCrudTable columns={ENVSUFFIX_COLUMNS} rows={envSuffix.rows} emptyRow={ENVSUFFIX_EMPTY}
          onCreate={envSuffix.onCreate} onUpdate={envSuffix.onUpdate} onDelete={envSuffix.onDelete} />
      )}
      {subTab === "restrictions" && <RestrictionsSection />}
    </div>
  );
};

export default LogXv2AdminTab;
