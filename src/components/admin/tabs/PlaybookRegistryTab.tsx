import React, { useEffect, useState } from "react";
import { PlusIcon, PencilSquareIcon, TrashIcon, CommandLineIcon } from "@heroicons/react/24/outline";
import { playbookRegistryApi, type PlaybookRegistryEntry } from "@/api/playbookRegistryApi";
import { ansibleApi, type AwxServer } from "@/api/ansibleApi";
import { toast } from "@/hooks/useToast";
import Card from "@/components/common/Card";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import EmptyState from "@/components/common/EmptyState";
import { Select } from "@/components/ui/Form";

const CATEGORIES = ["genel", "jvm", "network", "system", "openshift", "logx"];
const SOURCE_TYPES = ["awx_template", "repo_file", "external_script"];

type FormState = {
  keyName: string; displayName: string; description: string; category: string;
  awxTemplateId: string; awxServerId: string; enabled: boolean;
  sourceType: string; isReadonly: boolean; visibility: string; sortOrder: string;
};
const EMPTY_FORM: FormState = {
  keyName: "", displayName: "", description: "", category: "genel", awxTemplateId: "", awxServerId: "", enabled: true,
  sourceType: "awx_template", isReadonly: true, visibility: "User,Admin", sortOrder: "0",
};

// Bir kaydın template ID'sinin nereden geldiğini gösterir — admin'in "neden bu araç
// sohbette görünmüyor" sorusuna anında yanıt vermesi için (bkz. getEffectiveTemplateId).
function SourceBadge({ row }: { row: PlaybookRegistryEntry }) {
  if (row.awxTemplateId) return <Badge className="bg-emerald-50 text-emerald-700">DB: #{row.awxTemplateId}</Badge>;
  if (row.effectiveTemplateId) return <Badge className="bg-blue-50 text-blue-700">.env: {row.envVarName}</Badge>;
  return <Badge weight="normal" className="bg-gray-50 text-gray-400">Tanımsız</Badge>;
}

export default function PlaybookRegistryTab() {
  const [rows, setRows] = useState<PlaybookRegistryEntry[]>([]);
  const [servers, setServers] = useState<AwxServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = await playbookRegistryApi.list();
      setRows(r.playbooks || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // AWX sunucu listesi — "hangi AWX'te" seçici için (yapılandırılmış olanlar).
    ansibleApi.servers().then((r) => { if (r.ok) setServers(r.servers.filter((s) => s.configured)); }).catch(() => {});
  }, []);

  function serverName(id: number | null): string {
    if (!id) return "";
    return servers.find((s) => s.id === id)?.name || `#${id}`;
  }

  function openAdd() {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(row: PlaybookRegistryEntry) {
    setEditId(row.id);
    setForm({
      keyName: row.keyName, displayName: row.displayName, description: row.description,
      category: row.category, awxTemplateId: row.awxTemplateId ? String(row.awxTemplateId) : "",
      awxServerId: row.awxServerId ? String(row.awxServerId) : "", enabled: row.enabled,
      sourceType: row.sourceType || "awx_template", isReadonly: row.isReadonly !== false,
      visibility: row.visibility || "User,Admin", sortOrder: String(row.sortOrder ?? 0),
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!editId && !/^[a-z0-9_]+$/.test(form.keyName.trim())) {
      toast.error("Anahtar adı yalnızca küçük harf, rakam ve alt çizgi içerebilir.");
      return;
    }
    if (!form.displayName.trim()) { toast.error("Görünen ad zorunlu."); return; }
    setSaving(true);
    try {
      const payload = {
        displayName: form.displayName.trim(),
        description: form.description.trim(),
        category: form.category,
        awxTemplateId: form.awxTemplateId.trim() ? Number(form.awxTemplateId.trim()) : null,
        awxServerId: form.awxServerId ? Number(form.awxServerId) : null,
        enabled: form.enabled,
        sourceType: form.sourceType,
        isReadonly: form.isReadonly,
        visibility: form.visibility.trim() || "User,Admin",
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editId) {
        const r = await playbookRegistryApi.update(editId, payload);
        if (r.ok && r.playbook) { setRows((prev) => prev.map((x) => (x.id === editId ? r.playbook! : x))); toast.success("Kayıt güncellendi."); }
        else toast.error(r.message || "Güncellenemedi.");
      } else {
        const r = await playbookRegistryApi.create({ keyName: form.keyName.trim(), ...payload });
        if (r.ok && r.playbook) { setRows((prev) => [...prev, r.playbook!]); toast.success("Kayıt eklendi."); }
        else toast.error(r.message || "Eklenemedi.");
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: PlaybookRegistryEntry) {
    if (!window.confirm(`"${row.displayName}" kaydını silmek istediğinize emin misiniz?`)) return;
    const r = await playbookRegistryApi.remove(row.id);
    if (r.ok) { setRows((prev) => prev.filter((x) => x.id !== row.id)); toast.success("Kayıt silindi."); }
    else toast.error(r.message || "Silinemedi.");
  }

  if (loading) return <div className="py-8 text-center text-sm text-gray-400">Yükleniyor...</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 max-w-xl">
          AI Analist'in sohbette kendi kararıyla çağırabildiği salt-okunur tanılama playbook'ları
          (JVM, network, disk, sistem sağlığı, vb.). Template ID admin ekranından (DB) VEYA
          <code className="mx-1 px-1 bg-gray-100 rounded font-mono text-xs">.env</code>'deki
          ilgili değişkenden alınabilir — hiçbiri tanımlı değilse araç sohbette hiç görünmez
          (hata gösterilmez).
        </p>
        <Button variant="primary" onClick={openAdd} icon={<PlusIcon className="w-4 h-4" />}>
          Yeni Kayıt
        </Button>
      </div>

      {showForm && (
        <Card padding="md" className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Anahtar Adı (key_name) *</label>
              <input
                value={form.keyName}
                onChange={(e) => setForm((f) => ({ ...f, keyName: e.target.value }))}
                disabled={!!editId}
                placeholder="ör. dns_lookup_check"
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400 font-mono disabled:bg-gray-100 disabled:text-gray-400"
              />
              {editId && <p className="text-[11px] text-gray-400 mt-0.5">Oluşturulduktan sonra değiştirilemez.</p>}
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Görünen Ad *</label>
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="ör. DNS Çözümleme Kontrolü"
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Açıklama (AI'a ne yaptığını anlatır)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Bu playbook ne yapar, ne zaman kullanılmalı..."
              className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Kategori</label>
              <Select
                sizeVariant="sm"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">AWX Template ID (opsiyonel — boşsa .env'e bakılır)</label>
              <input
                type="number"
                value={form.awxTemplateId}
                onChange={(e) => setForm((f) => ({ ...f, awxTemplateId: e.target.value }))}
                placeholder="ör. 47"
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">
              AWX Sunucusu (template bu sunucuda aranır — yanlışsa "AWX HTTP 404")
            </label>
            <Select
              sizeVariant="sm"
              value={form.awxServerId}
              onChange={(e) => setForm((f) => ({ ...f, awxServerId: e.target.value }))}
            >
              <option value="">Varsayılan (.env / ilk sunucu)</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name} (#{s.id})</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Kaynak Tipi</label>
              <Select
                sizeVariant="sm"
                value={form.sourceType}
                onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value }))}
              >
                {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Görünürlük (CSV rol listesi)</label>
              <input
                value={form.visibility}
                onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}
                placeholder="User,Admin"
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Sıra</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
              Etkin (kapatılırsa sohbette hiç görünmez)
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={form.isReadonly} onChange={(e) => setForm((f) => ({ ...f, isReadonly: e.target.checked }))} />
              Salt-okunur (yalnızca tanılama, sistemi değiştirmez)
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">İptal</button>
            <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40">
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<CommandLineIcon className="w-6 h-6" />} title="Henüz playbook kaydı yok." />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.id} padding="sm" className="flex flex-wrap items-center gap-3">
              <Badge className="bg-slate-100 text-slate-600">{row.category}</Badge>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-slate-800">
                  {row.displayName}
                  {!row.enabled && <span className="ml-2 text-xs text-gray-400">(devre dışı)</span>}
                </div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">{row.keyName} · {row.handler}</div>
                {row.description && <div className="text-xs text-slate-500 mt-0.5">{row.description}</div>}
              </div>
              {row.awxServerId && (
                <Badge className="bg-violet-50 text-violet-700">AWX: {serverName(row.awxServerId)}</Badge>
              )}
              {!row.isReadonly && <Badge className="bg-red-50 text-red-600">değiştirici</Badge>}
              <SourceBadge row={row} />
              <button onClick={() => openEdit(row)} className="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors">
                <PencilSquareIcon className="w-4 h-4" />
              </button>
              {row.handler !== "ocp_cluster" && (
                <button onClick={() => handleDelete(row)} className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors">
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
