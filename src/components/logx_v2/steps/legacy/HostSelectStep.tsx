// src/components/logx_v2/steps/legacy/HostSelectStep.tsx — uygulama seçildikten SONRA,
// log taraması başlamadan ÖNCE gelen sunucu seçimi.
//
// NEDEN VAR: bir uygulamanın 30 sunucusu olabiliyor ve keşif bugüne kadar HEPSİNİ
// tarıyordu. Kullanıcı çoğu zaman tek bir sunucunun logunu istiyor; 30 sunucu taramak hem
// dakikalar sürüyor hem de sonuç ekranını (30 × ~300 dosya) kullanılamaz hale getiriyordu.
//
// VARSAYILAN HİÇBİRİ SEÇİLİ DEĞİL: tarama ancak kullanıcı bilinçli seçim yapınca başlar.
//
// Durum bilgisi CANLI SORGULANMAZ — envanterdeki `status` okunur (bkz. legacy.cjs
// listHostsForApp). Durmuş bir sunucuda log aramak yine de mümkündür (eski loglar orada
// durur), bu yüzden seçim ENGELLENMEZ, yalnızca rozetle gösterilir.
import React, { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon, ServerIcon } from "@heroicons/react/24/outline";
import { logxV2Api, type LegacyHost } from "@/api/logxV2Api";

interface Props {
  app: string;
  busy?: boolean;
  onSubmit: (hosts: string[]) => void;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  running: { label: "ÇALIŞIYOR", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  stopped: { label: "DURMUŞ", className: "bg-red-50 text-red-700 border-red-100" },
};

const HostSelectStep: React.FC<Props> = ({ app, busy, onSubmit }) => {
  const [hosts, setHosts] = useState<LegacyHost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Aktif hızlı filtreler (ortam veya JBoss sürümü). Boşsa filtre yok.
  const [facet, setFacet] = useState<string | null>(null);

  useEffect(() => {
    logxV2Api.legacyHosts(app)
      .then((r) => setHosts(r.hosts))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [app]);

  const envs = useMemo(
    () => [...new Set((hosts || []).map((h) => h.env).filter(Boolean))].sort(),
    [hosts],
  );
  const versions = useMemo(
    () => [...new Set((hosts || []).map((h) => h.jbossVersion).filter(Boolean))].sort(),
    [hosts],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (hosts || []).filter((h) => {
      if (facet && h.env !== facet && h.jbossVersion !== facet) return false;
      if (!q) return true;
      return `${h.host} ${h.env} ${h.jbossVersion}`.toLowerCase().includes(q);
    });
  }, [hosts, search, facet]);

  function toggle(host: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host); else next.add(host);
      return next;
    });
  }

  // "Tümünü seç" GÖRÜNEN listeye uygulanır: arama/filtre varken beklenmedik şekilde
  // gizli sunucuları da seçmek kullanıcıyı şaşırtırdı.
  function toggleAllVisible() {
    const allVisibleSelected = visible.length > 0 && visible.every((h) => selected.has(h.host));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const h of visible) {
        if (allVisibleSelected) next.delete(h.host); else next.add(h.host);
      }
      return next;
    });
  }

  if (error) {
    return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;
  }
  if (!hosts) {
    return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Sunucular yükleniyor…</div>;
  }
  if (hosts.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <span className="font-mono">{app}</span> için envanterde sunucu bulunamadı.
      </div>
    );
  }

  const allVisibleSelected = visible.length > 0 && visible.every((h) => selected.has(h.host));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">
          Hangi sunucularda log aranacak?
        </p>
        <span className="text-xs text-[var(--text-muted)]">
          {selected.size} / {hosts.length} seçili
        </span>
      </div>

      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sunucu ara… (ör. GBCJAP01)"
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={toggleAllVisible}
          disabled={busy || visible.length === 0}
          className="px-3 py-1 text-xs rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
        >
          {allVisibleSelected ? "Görünenlerin seçimini kaldır" : `Görünenleri seç (${visible.length})`}
        </button>
        {[...envs, ...versions].map((f) => (
          <button
            key={f}
            onClick={() => setFacet((cur) => (cur === f ? null : f))}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              facet === f
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="max-h-72 overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {visible.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Eşleşen sunucu yok.</p>
        ) : (
          visible.map((h) => {
            const meta = STATUS_META[h.status];
            return (
              <label
                key={h.host}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(h.host)}
                  onChange={() => toggle(h.host)}
                  className="rounded"
                />
                <ServerIcon aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                <span className="text-sm font-mono text-[var(--text-primary)] flex-1 truncate">{h.host}</span>
                {h.env && <span className="text-xs text-[var(--text-muted)]">{h.env}</span>}
                {h.jbossVersion && <span className="text-xs text-[var(--text-muted)]">{h.jbossVersion}</span>}
                {meta ? (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${meta.className}`}>
                    {meta.label}
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border)]">
                    BİLİNMİYOR
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Yalnızca seçtiğiniz sunucular taranır — az sunucu, hızlı sonuç ve daha kısa liste.
      </p>

      <button
        onClick={() => onSubmit([...selected])}
        disabled={busy || selected.size === 0}
        className="btn-primary w-full"
      >
        {busy ? "Başlatılıyor…" : `Seçilenleri Tara (${selected.size})`}
      </button>
    </div>
  );
};

export default HostSelectStep;
