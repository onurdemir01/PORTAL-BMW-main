import React, { useState, useEffect, useContext } from "react";
import {
  ArrowTopRightOnSquareIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import { linksApi, type PortalLink } from "@/api/linksApi";
import { AuthContext } from "@/contexts/AuthContext";
import { Modal } from "@/components/common/Modal";
import { toast } from "@/hooks/useToast";

const CATEGORIES_ALL = "Tümü";

function LinkForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<PortalLink>;
  onSave: (data: Omit<PortalLink, "id" | "order">) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [category, setCategory] = useState(initial?.category || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [isActive, setIsActive] = useState(initial?.isActive !== false);
  const [openInNewTab, setOpenInNewTab] = useState(initial?.openInNewTab !== false);
  const [visibleTo, setVisibleTo] = useState<("Admin" | "User")[]>(initial?.visibleTo ?? ["Admin", "User"]);
  const [isFavorite, setIsFavorite] = useState(initial?.isFavorite ?? false);
  const [loading, setLoading] = useState(false);

  function toggleRole(role: "Admin" | "User") {
    setVisibleTo((prev) => {
      const has = prev.includes(role);
      const next = has ? prev.filter((r) => r !== role) : [...prev, role];
      // En az bir rol açık kalmalı — aksi halde link kimseye görünmez hale gelir.
      return next.length > 0 ? next : prev;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !url.trim() || !category.trim()) return;
    setLoading(true);
    try {
      await onSave({ label: label.trim(), url: url.trim(), category: category.trim(), description: description.trim(), isActive, openInNewTab, visibleTo, isFavorite });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>Başlık *</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required
            className="input-modern" />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>Kategori *</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} required
            placeholder="Monitoring, DevOps, Portal..."
            className="input-modern" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>URL *</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} required type="url"
          placeholder="https://..."
          className="input-modern font-mono" />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>Açıklama</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          className="input-modern" />
      </div>
      <div className="flex items-center gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
            className="rounded border-gray-300" />
          Aktif
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={openInNewTab} onChange={(e) => setOpenInNewTab(e.target.checked)}
            className="rounded border-gray-300" />
          Yeni sekmede aç
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)}
            className="rounded border-gray-300" />
          <StarIconSolid className={`w-4 h-4 ${isFavorite ? "text-amber-400" : "text-gray-300"}`} />
          Favori (Dashboard'da göster)
        </label>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>Kimler görebilir</label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" checked={visibleTo.includes("Admin")} onChange={() => toggleRole("Admin")}
              className="rounded border-gray-300" />
            Admin
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" checked={visibleTo.includes("User")} onChange={() => toggleRole("User")}
              className="rounded border-gray-300" />
            Kullanıcı
          </label>
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">İptal</button>
        <button type="submit" disabled={loading || !label.trim() || !url.trim() || !category.trim()} className="btn-primary">
          <CheckIcon className="w-4 h-4" />
          {loading ? "Kaydediliyor..." : "Kaydet"}
        </button>
      </div>
    </form>
  );
}

const ImportantLinksPage: React.FC = () => {
  const { user } = useContext(AuthContext);
  const isAdmin = user?.role === "Admin";

  const [links, setLinks] = useState<PortalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(CATEGORIES_ALL);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editLink, setEditLink] = useState<PortalLink | null>(null);

  async function reload() {
    try {
      const r = await linksApi.list();
      if (r.ok) setLinks(r.links);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, []);

  const categories = [CATEGORIES_ALL, ...Array.from(new Set(links.map((l) => l.category))).sort()];

  const filtered = links.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.label.toLowerCase().includes(q) || l.description.toLowerCase().includes(q) || l.category.toLowerCase().includes(q);
    const matchCat = activeCategory === CATEGORIES_ALL || l.category === activeCategory;
    return matchSearch && matchCat;
  });

  async function handleDelete(id: string) {
    if (!confirm("Bu linki silmek istediğinizden emin misiniz?")) return;
    const r = await linksApi.delete(id);
    if (r.ok) { setLinks((prev) => prev.filter((l) => l.id !== id)); toast.success("Link silindi."); }
    else toast.error(r.error || "Silinemedi.");
  }

  async function handleCreate(data: Omit<PortalLink, "id" | "order">) {
    const r = await linksApi.create(data);
    if (r.ok) { await reload(); setShowAddModal(false); toast.success("Link eklendi."); }
    else toast.error(r.error || "Eklenemedi.");
  }

  async function handleUpdate(data: Omit<PortalLink, "id" | "order">) {
    if (!editLink) return;
    const r = await linksApi.update(editLink.id, data);
    if (r.ok) { await reload(); setEditLink(null); toast.success("Link güncellendi."); }
    else toast.error(r.error || "Güncellenemedi.");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Önemli Linkler</h1>
          <p className="text-sm font-medium mt-1" style={{ color: "var(--text-muted)" }}>Sık kullanılan sistem bağlantıları</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowAddModal(true)} className="btn-primary">
            <PlusIcon className="w-4 h-4" />
            Link Ekle
          </button>
        )}
      </div>

      {/* Search + category filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Link ara..."
            className="input-modern pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="px-3 py-1.5 text-xs font-semibold rounded-full border transition-all"
              style={
                activeCategory === cat
                  ? { background: "var(--accent)", color: "var(--text-on-accent)", borderColor: "var(--accent)" }
                  : { background: "var(--bg-surface)", color: "var(--text-secondary)", borderColor: "var(--border)" }
              }
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Link grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 skeleton rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>
          <LinkIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sonuç bulunamadı.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          {filtered.map((link) => (
            <div
              key={link.id}
              className={`group relative card card-hover p-5 flex flex-col gap-3 animate-spring-in ${!link.isActive ? "opacity-60" : ""}`}
            >
              {/* Category badge */}
              <div className="flex items-center justify-between">
                <span
                  className="px-2.5 py-0.5 text-xs font-semibold rounded-full border flex items-center gap-1"
                  style={{ background: "rgba(79,142,255,0.08)", color: "var(--accent)", borderColor: "rgba(79,142,255,0.15)" }}
                >
                  {link.category}
                </span>
                <div className="flex items-center gap-1.5">
                  {link.isFavorite && (
                    <span title="Dashboard'da gösteriliyor">
                      <StarIconSolid className="w-3.5 h-3.5 text-amber-400" />
                    </span>
                  )}
                  {isAdmin && !link.visibleTo.includes("User") && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                      Yalnızca Admin
                    </span>
                  )}
                  {!link.isActive && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                      Pasif
                    </span>
                  )}
                </div>
              </div>

              {/* Label + description */}
              <div>
                <h3 className="font-semibold text-sm transition-colors" style={{ color: "var(--text-primary)" }}>
                  {link.label}
                </h3>
                {link.description && (
                  <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>{link.description}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between mt-auto pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <a
                  href={link.url}
                  target={link.openInNewTab ? "_blank" : "_self"}
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                  style={{ color: "var(--accent)" }}
                >
                  <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                  Aç
                </a>
                {isAdmin && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditLink(link)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: "var(--text-muted)" }}
                      title="Düzenle"
                    >
                      <PencilSquareIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(link.id)}
                      className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                      title="Sil"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add modal */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Yeni Link Ekle" size="lg">
        <LinkForm onSave={handleCreate} onCancel={() => setShowAddModal(false)} />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editLink} onClose={() => setEditLink(null)} title="Link Düzenle" size="lg">
        {editLink && (
          <LinkForm initial={editLink} onSave={handleUpdate} onCancel={() => setEditLink(null)} />
        )}
      </Modal>
    </div>
  );
};

export default ImportantLinksPage;
