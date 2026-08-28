// src/components/admin/tabs/LogXv2AdminTab.tsx — LogX v2'nin 4 admin-yönetimli veri
// kaynağı için tek sekme: OCP cluster hiyerarşisi, terminal/bastion host eşlemesi, Legacy
// ortam-etiketi son-ek eşlemesi ve varsayılan-açık yetkilendirme kısıtlamaları.
import React, { useEffect, useState } from "react";
import {
  ServerStackIcon, CommandLineIcon, TagIcon, LockClosedIcon, WrenchScrewdriverIcon, KeyIcon,
  SignalIcon, CubeIcon,
} from "@heroicons/react/24/outline";
import {
  logxV2Api,
  type OcpClusterIndexRow, type OcpTerminalHostRow, type EnvSuffixRow, type RestrictionRow,
  type OcpVaultKeyRow, type PlaybookReadinessRow,
} from "@/api/logxV2Api";
import SimpleCrudTable, { type ColumnDef } from "./logxv2/SimpleCrudTable";
import { useToast } from "@/hooks/useToast";
import OcpRuntimeSettings from "./logxv2/OcpRuntimeSettings";
import { Select } from "@/components/ui/Form";

const SUB_TABS = [
  { id: "clusters", label: "OCP Cluster Hiyerarşisi", icon: ServerStackIcon },
  { id: "vaultkeys", label: "Vault Anahtarları", icon: KeyIcon },
  { id: "terminals", label: "Terminal/Bastion Host", icon: CommandLineIcon },
  { id: "ocpruntime", label: "OCP Çalıştırma Ayarları", icon: WrenchScrewdriverIcon },
  { id: "envsuffix", label: "Legacy Ortam Son-Eki", icon: TagIcon },
  { id: "restrictions", label: "Kısıtlamalar", icon: LockClosedIcon },
] as const;
type SubTabId = (typeof SUB_TABS)[number]["id"];

// Cluster satirinin Jump Server hucresi BOSSA, devreye girecek yedek (tenant/env) degeri
// okuma modunda soluk gosterilir — admin hangi cluster'in FIILEN hangi bastion'a gidecegini
// sekme degistirmeden gorur. Yedek de yoksa kirmizi uyari (o cluster secilirse akis 400 verir).
function clusterColumns(
  terminalRows: OcpTerminalHostRow[],
  clusterRows: OcpClusterIndexRow[],
  vaultRows: OcpVaultKeyRow[],
): ColumnDef<OcpClusterIndexRow>[] {
  // Öneriler artık "Vault Anahtarları" sekmesindeki KATALOGDAN gelir. Eskiden mevcut
  // cluster satırlarından türetiliyordu; bu yüzden henüz hiçbir cluster'da kullanılmamış
  // bir anahtar (ör. uxmid_gohas) hiçbir zaman önerilmiyordu. Katalog okunamazsa
  // kullanımdaki değerlere düşülür — öneri listesi boş kalmasın.
  const fromCatalog = vaultRows.filter((r) => r.is_active !== false).map((r) => r.key_name);
  // Sunucudaki `assertVaultKeysKnownOrThrow` ile AYNI küme: yalnızca AKTİF anahtarlar.
  const catalogNames = new Set(fromCatalog.map((k) => String(k || "").trim()).filter(Boolean));
  const inUse = clusterRows.map((r) => r.vault_credential_key).filter(Boolean) as string[];
  const vaultKeys = [...new Set([...fromCatalog, ...inUse])].sort();
  return [
    { key: "env", label: "Ortam (env)", placeholder: "dev" },
    { key: "tenant", label: "Tenant", placeholder: "ark" },
    { key: "cluster_name", label: "Cluster Adı", placeholder: "gbocptest1" },
    {
      key: "terminal_host",
      label: "Jump Server (bastion)",
      placeholder: "boş = tenant/env yedek eşlemesi",
      emptyHint: (row) => {
        const fb = terminalRows.find(
          (t) => t.is_active && t.tenant === row.tenant && t.env === row.env
        );
        return fb ? `yedek: ${fb.terminal_host}` : "⚠ eşleme yok";
      },
    },
    {
      key: "api_url",
      label: "API Adresi",
      placeholder: "https://api.gbocptest1...:6443",
      truncate: true,
      // Boşsa playbook eski AWX envanter dosyasına düşer — çalışır ama portalın
      // "her şey DB'de" ilkesinin dışında kalır, bunu görünür kılıyoruz.
      emptyHint: () => "envanter dosyasından",
    },
    {
      key: "vault_credential_key",
      label: "Vault Anahtarı (parola değil)",
      placeholder: "uxmid_gar",
      suggestions: vaultKeys,
      // PAROLA DEĞİL: credentials.yaml içindeki değişkenin ADI. Parola hiçbir zaman
      // portal veritabanına yazılmaz.
      emptyHint: () => "envanter dosyasından",
      // 2026-08-28 üretim arızası: bu alanda katalogda kayıtlı olmayan bir ad vardı;
      // portal işi başlattı, AWX 12 saniye sonra "vault parolası çözülemedi" ile düştü.
      // Artık çalıştırma sunucu tarafında 400 ile kesiliyor — bu rozet de sorunun
      // KAYNAĞINI, yani hangi satırın düzeltilmesi gerektiğini gösterir.
      // Katalog boşsa (istek düştü / henüz hiç anahtar tanımlanmadı) UYARI VERİLMEZ:
      // yoksa yüklenememiş bir liste yüzünden her satır yanlışlıkla kırmızıya boyanırdı.
      valueWarning: (row) =>
        catalogNames.size > 0 && !catalogNames.has(String(row.vault_credential_key || "").trim())
          ? "katalogda yok"
          : null,
    },
    {
      key: "ocp_username",
      label: "OCP Kullanıcı Adı",
      placeholder: "uxmid",
      suggestions: [...new Set(vaultRows.map((r) => r.default_username).filter(Boolean) as string[])].sort(),
      // `oc login --username`. Bu alan YOKKEN playbook değeri yalnızca AWX'teki
      // openshift_inventory_vars.yaml'dan okuyabiliyordu; o dosya AWX'te olmadığı için
      // 2026-08-09'da tüm cluster'lar "'username' is undefined" ile düştü.
      emptyHint: () => "genel varsayılandan",
    },
    { key: "is_active", label: "Aktif", type: "checkbox" },
  ];
}
const CLUSTER_EMPTY: Partial<OcpClusterIndexRow> = {
  env: "", tenant: "", cluster_name: "", terminal_host: "", api_url: "",
  vault_credential_key: "", ocp_username: "", is_active: true,
};

const VAULT_KEY_COLUMNS: ColumnDef<OcpVaultKeyRow>[] = [
  { key: "key_name", label: "Vault Anahtarı (parola değil)", placeholder: "uxmid_gar" },
  { key: "default_username", label: "Varsayılan Kullanıcı", placeholder: "uxmid" },
  { key: "description", label: "Açıklama", placeholder: "Garanti BBVA cluster'ları", truncate: true },
  { key: "is_active", label: "Aktif", type: "checkbox" },
];
const VAULT_KEY_EMPTY: Partial<OcpVaultKeyRow> = {
  key_name: "", default_username: "", description: "", is_active: true,
};

// Cluster satırlarındaki vault anahtarı katalogda yoksa, o cluster'ı seçen HER çalıştırma
// (LogX OCP ve Telnet) sunucuda 400 ile reddedilir. Rozet tek satırı işaretler; bu bant
// toplamı ve ne yapılacağını söyler — rozeti fark etmeyen admin de görsün.
const UnknownVaultKeyBanner: React.FC<{
  clusterRows: OcpClusterIndexRow[];
  vaultRows: OcpVaultKeyRow[];
}> = ({ clusterRows, vaultRows }) => {
  const known = new Set(
    vaultRows.filter((r) => r.is_active !== false).map((r) => String(r.key_name || "").trim()).filter(Boolean)
  );
  // Katalog yüklenemediyse sessiz kal (bkz. valueWarning'deki aynı gerekçe).
  if (known.size === 0) return null;
  const bad = clusterRows.filter((r) => {
    const key = String(r.vault_credential_key || "").trim();
    return key !== "" && !known.has(key);
  });
  if (bad.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
      <strong>{bad.length} cluster satırında katalogda olmayan vault anahtarı var:</strong>{" "}
      {bad.map((r) => `${r.cluster_name} → "${r.vault_credential_key}"`).join(", ")}.
      Bu cluster'lar seçildiğinde işlem <strong>başlatılmadan</strong> reddedilir. Anahtarı
      <strong> Vault Anahtarları</strong> sekmesinden ekleyin — ve AWX'teki
      <code className="mx-1 px-1 rounded bg-amber-100">credentials.yaml</code>
      içinde de tanımlı olduğundan emin olun (portal AWX vault'unun gerçeğini göremez).
    </div>
  );
};

// Hem cluster hem de vault sekmesinde gösterilir: "Vault Anahtarı" başlığını gören bir
// admin oraya gerçek parolayı yapıştırırsa portal veritabanına düz metin yazılırdı.
const VaultKeyWarning: React.FC = () => (
  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
    <strong>Vault Anahtarı bir parola DEĞİLDİR.</strong> Buraya AWX'teki
    <code className="mx-1 px-1 rounded bg-amber-100">credentials.yaml</code>
    dosyasında tanımlı <strong>değişkenin adını</strong> yazın (ör.
    <code className="mx-1 px-1 rounded bg-amber-100">uxmid_gar</code>). Parolalar portal
    veritabanında tutulmaz; playbook değeri doğrudan vault'tan okur.
    <strong className="ml-1">Buraya asla gerçek parola yazmayın.</strong>
  </div>
);

const TERMINAL_COLUMNS: ColumnDef<OcpTerminalHostRow>[] = [
  { key: "tenant", label: "Tenant", placeholder: "ark" },
  { key: "env", label: "Ortam (env)", placeholder: "dev" },
  { key: "terminal_host", label: "Jump Server (bastion)", placeholder: "gbaocp01" },
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

// Envanter tohumlaması (bootstrap seed) durumu. Portal ilk açılışta ~60 cluster'ı DB'ye
// PASİF olarak ekler; bu panel onun çalışıp çalışmadığını gösterir ve gerekirse yeniden
// çalıştırır. Yeniden çalıştırma var olan satırlara DOKUNMAZ — admin'in sildiği bir cluster
// geri gelmez, yalnızca hiç olmayanlar eklenir.
const BootstrapSeedPanel: React.FC<{ onSeeded: () => void }> = ({ onSeeded }) => {
  const [seeded, setSeeded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    logxV2Api.admin.getBootstrapSeed()
      .then((r) => setSeeded(r.seeded))
      .catch(() => setSeeded(null));
  }, []);

  async function rerun() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await logxV2Api.admin.rerunBootstrapSeed();
      const { inserted = 0, skipped = 0, failed = 0 } = r.result || {};
      setNote(`${inserted} yeni cluster eklendi (pasif), ${skipped} zaten vardı${failed ? `, ${failed} eklenemedi` : ""}.`);
      setSeeded(true);
      onSeeded();
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Durum okunamasa bile paneli GİZLEME: eskiden 500 alınca panel yok oluyordu ve admin
  // böyle bir düğmenin varlığından haberdar olmuyordu.
  const durum = seeded === null ? "okunamadı" : seeded ? "yapıldı" : "henüz yapılmadı";

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 text-xs text-gray-600">
      <div className="min-w-0">
        <span className="font-medium text-gray-700">Envanter tohumlaması:</span>{" "}
        {durum}. Yeniden çalıştırmak mevcut satırlara dokunmaz,
        yalnızca eksik cluster'ları <strong>pasif</strong> olarak ekler.
        {note && <div className="mt-1 text-gray-500">{note}</div>}
      </div>
      <button
        onClick={rerun}
        disabled={busy}
        className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-medium hover:border-black transition-colors active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
      >
        {busy ? "Çalışıyor…" : "Yeniden çalıştır"}
      </button>
    </div>
  );
};

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
                <button onClick={() => setEditingDescId(null)} className="text-xs text-gray-400 hover:underline">İptal</button>
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

// Cluster satırının canlı kontrolleri. Bu iki aksiyon eskiden Admin > Ansible
// Yapılandırma altındaki AYRI OCP kataloğundaydı; o katalog bu kataloğdan bağımsızdı ve
// üretimde boştu, dolayısıyla aksiyonlar hiç kullanılamıyordu. Tek katalog, tek yer.
const ClusterRowActions: React.FC<{ row: OcpClusterIndexRow }> = ({ row }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"conn" | "pods" | null>(null);
  const [podOutput, setPodOutput] = useState<string | null>(null);

  async function run(kind: "conn" | "pods") {
    setBusy(kind);
    try {
      if (kind === "conn") {
        const r = await logxV2Api.admin.testClusterConnection(row.id);
        if (r.ok) toast.success(`${row.cluster_name}: erişilebilir${r.responseTimeMs != null ? ` (${r.responseTimeMs} ms)` : ""}${r.message ? ` — ${r.message}` : ""}`);
        else toast.error(`${row.cluster_name}: ${r.message || "erişilemedi"}`);
      } else {
        const r = await logxV2Api.admin.clusterPodStatus(row.id);
        setPodOutput(r.output || "(çıktı boş)");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button onClick={() => run("conn")} disabled={busy !== null}
        aria-label={`${row.cluster_name} bağlantısını test et`} title="Bağlantı Testi (API /version)"
        className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition disabled:opacity-40">
        <SignalIcon className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => run("pods")} disabled={busy !== null}
        aria-label={`${row.cluster_name} pod durumunu getir`} title="Pod Durumu (jump server üzerinden)"
        className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition disabled:opacity-40">
        <CubeIcon className="w-3.5 h-3.5" />
      </button>
      {podOutput !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog" aria-modal="true" aria-label={`${row.cluster_name} pod durumu`}
          onClick={() => setPodOutput(null)}>
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[80vh] overflow-auto p-4 text-left"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700">{row.cluster_name} — pod durumu</h4>
              <button onClick={() => setPodOutput(null)} className="text-xs text-gray-500 hover:text-gray-800">Kapat</button>
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap text-gray-700">{podOutput}</pre>
          </div>
        </div>
      )}
    </>
  );
};

// LogX'in kullandigi playbook kayitlarinin hazirlik durumu. Uretimde "Bu namespace'i tara"
// 503 dondu ve sebebi (template ID tanimsiz ya da AWX'te "Prompt on launch" KAPALI —
// bu durumda AWX gonderilen extra_vars'i sessizce yok sayar) hicbir ekranda gorunmuyordu.
const PlaybookReadinessPanel: React.FC = () => {
  const [rows, setRows] = useState<PlaybookReadinessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await logxV2Api.admin.getPlaybookReadiness();
      setRows(r.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const problems = (rows || []).filter(
    (r) => !r.templateId || r.foundOnAwx === false || r.promptOnLaunch === false || !r.enabled
  );

  return (
    <div className="border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-700">Playbook hazırlık durumu</h4>
        <button onClick={load} disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50">
          {loading ? "Kontrol ediliyor…" : "Yenile"}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {rows && problems.length === 0 && (
        <p className="text-xs text-emerald-700">Tüm LogX playbook kayıtları hazır.</p>
      )}
      {rows && problems.length > 0 && (
        <ul className="space-y-1.5">
          {problems.map((r) => (
            <li key={r.keyName} className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
              <span className="font-mono font-medium">{r.keyName}</span>
              {" — "}
              {!r.enabled && "kayıt devre dışı. "}
              {!r.templateId && "AWX template ID tanımlı değil (Admin > Playbook Kayıtları). "}
              {r.foundOnAwx === false && `Template ${r.templateId}, AWX ${r.awxServerId} üzerinde bulunamadı. `}
              {r.promptOnLaunch === false && (
                <>
                  AWX'te <strong>"Prompt on launch" (Variables) KAPALI</strong> — bu durumda AWX,
                  portalın gönderdiği değişkenleri sessizce yok sayar ve playbook boş girdiyle
                  hata verir. AWX &gt; Job Templates &gt; {r.templateName || r.templateId} &gt;
                  Variables bölümünde kutuyu işaretleyin.
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && rows.some((r) => r.foundOnAwx === null && r.templateId) && (
        <p className="text-xs text-gray-400">
          Bazı template'lerin durumu AWX'ten okunamadı (ağ/yetki) — "kapalı" anlamına gelmez.
        </p>
      )}
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
  const vaultKeys = useCrudSection(
    logxV2Api.admin.listVaultKeys, logxV2Api.admin.createVaultKey, logxV2Api.admin.updateVaultKey, logxV2Api.admin.deleteVaultKey
  );
  // Cluster tablosundaki "boş Jump Server" hücrelerinde yedek eşlemeyi gösterebilmek için
  // terminal-host satırlarına ihtiyaç var (iki sekme de aynı sayfada yüklüdür).
  const clusterCols = React.useMemo(
    () => clusterColumns(terminals.rows, clusters.rows, vaultKeys.rows),
    [terminals.rows, clusters.rows, vaultKeys.rows],
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
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
            Her cluster kendi <strong>Jump Server</strong>'ını kullanabilir; aynı işlemde farklı cluster'lar
            farklı jump server'lara gidebilir. Alan boş bırakılırsa <strong>Terminal/Bastion Host</strong>
            sekmesindeki tenant/env yedek eşlemesi kullanılır. Her ikisi de yoksa o cluster seçildiğinde
            işlem başlatılamaz.
          </div>
          <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
            <strong>OCP Kullanıcı Adı</strong>, playbook'un <code className="px-1 rounded bg-blue-100">oc login --username</code>
            değeridir. Boş bırakılırsa <strong>OCP Çalıştırma Ayarları</strong> sekmesindeki genel
            varsayılan kullanılır. İkisi de boşsa o cluster keşifte anlaşılır bir hatayla elenir —
            diğer cluster'lar çalışmaya devam eder.
          </div>
          <VaultKeyWarning />
          <UnknownVaultKeyBanner clusterRows={clusters.rows} vaultRows={vaultKeys.rows} />
          <PlaybookReadinessPanel />
          <BootstrapSeedPanel onSeeded={clusters.reload} />
          <SimpleCrudTable columns={clusterCols} rows={clusters.rows} emptyRow={CLUSTER_EMPTY}
            onCreate={clusters.onCreate} onUpdate={clusters.onUpdate} onDelete={clusters.onDelete}
            rowActions={(row) => <ClusterRowActions row={row} />} />
        </div>
      )}
      {subTab === "vaultkeys" && (
        vaultKeys.loading ? <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div> :
        vaultKeys.error ? <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{vaultKeys.error}</div> :
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
            AWX'teki <code className="px-1 rounded bg-blue-100">credentials.yaml</code> dosyasında tanımlı
            vault değişkenlerinin <strong>adları</strong>. <strong>OCP Cluster Hiyerarşisi</strong> sekmesindeki
            "Vault Anahtarı" alanı önerilerini buradan alır. Kullanımda olan bir anahtar silinemez —
            önce onu kullanan cluster satırlarını güncelleyin.
          </div>
          <VaultKeyWarning />
          <SimpleCrudTable columns={VAULT_KEY_COLUMNS} rows={vaultKeys.rows} emptyRow={VAULT_KEY_EMPTY}
            onCreate={vaultKeys.onCreate} onUpdate={vaultKeys.onUpdate} onDelete={vaultKeys.onDelete} />
        </div>
      )}
      {subTab === "terminals" && (
        terminals.loading ? <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div> :
        terminals.error ? <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{terminals.error}</div> :
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-800">
            Bu tablo <strong>yedek (fallback)</strong> eşlemedir: bir cluster'ın kendi satırında
            (OCP Cluster Hiyerarşisi sekmesi) Jump Server doluysa <strong>o kazanır</strong>; boşsa buradaki
            tenant/env eşlemesi kullanılır. Tek bir tenant/env için birden fazla satır tanımlanamaz —
            cluster'lara ayrı jump server vermek için diğer sekmeyi kullanın.
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
      {subTab === "ocpruntime" && <OcpRuntimeSettings />}
      {subTab === "restrictions" && <RestrictionsSection />}
    </div>
  );
};

export default LogXv2AdminTab;
