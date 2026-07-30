// src/components/logx_v2/steps/ocp/NamespacePickerStep.tsx — Discovery job'ından dönen
// namespace listesini (cluster'lar arasında tekilleştirilmiş) aranabilir şekilde gösterir.
import React, { useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { OcpNamespaceDiscoveryResult } from "@/api/logxV2Api";

const NamespacePickerStep: React.FC<{ result: OcpNamespaceDiscoveryResult; onSelect: (ns: string) => void }> = ({ result, onSelect }) => {
  const [search, setSearch] = useState("");

  // Savunma amaçlı: backend normalize etmiş olsa da, `project.project.openshift.io/<ad>`
  // gibi API-group önekli değerler gelirse son `/`'ten sonrasını al (namespace adı).
  const cleanNs = (ns: string) => String(ns || "").replace(/^.*\//, "").trim();

  // OCP platform/sistem namespace'leri (openshift-*, kube-*, default...) genellikle aranmaz —
  // listede EN SONA sıralanır ki kullanıcının uygulama namespace'leri üste gelsin.
  const isSystemNs = (ns: string) =>
    /^(openshift|kube)(-|$)/.test(ns) || ["default", "default-broker"].includes(ns);

  const allNamespaces = useMemo(() => {
    const set = new Set<string>();
    for (const c of result.clusters || []) {
      for (const ns of c.namespaces || []) {
        const clean = cleanNs(ns);
        if (clean) set.add(clean);
      }
    }
    return [...set].sort((a, b) => {
      const sa = isSystemNs(a), sb = isSystemNs(b);
      if (sa !== sb) return sa ? 1 : -1; // sistem namespace'leri sona
      return a.localeCompare(b);
    });
  }, [result]);

  const filtered = allNamespaces.filter((ns) => ns.toLowerCase().includes(search.toLowerCase()));
  const failedClusters = (result.clusters || []).filter((c) => c.status !== "ok");

  return (
    <div className="space-y-3">
      {failedClusters.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
          Bazı cluster'lara erişilemedi: {failedClusters.map((c) => c.cluster_name).join(", ")}
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-secondary)]">Log çekmek istediğiniz namespace'i seçin</p>
        <span className="text-xs text-[var(--text-muted)]">
          {search ? `${filtered.length} / ${allNamespaces.length}` : `${allNamespaces.length} namespace`}
        </span>
      </div>
      <div className="relative">
        <MagnifyingGlassIcon className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Namespace ara... (ör. uygulama adı)"
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-[var(--border)] rounded-xl outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition"
        />
      </div>
      <div className="max-h-72 overflow-y-auto border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {filtered.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">Sonuç yok.</p>
        ) : (
          filtered.map((ns) => (
            <button
              key={ns}
              onClick={() => onSelect(ns)}
              className="w-full text-left px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors font-mono"
            >
              {ns}
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default NamespacePickerStep;
