import React, { useState, useEffect } from "react";
import {
  PlayIcon,
  TrashIcon,
  BookmarkIcon,
  ArrowUpCircleIcon,
  StarIcon,
  CheckCircleIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import { inventoryApi, type SavedQuery, type QueryResult } from "@/api/inventoryApi";
import DynamicTable from "./DynamicTable";
import QueryHelpPanel from "./QueryHelpPanel";

interface Props {
  onClose: () => void;
  isAdmin?: boolean;
  onQueriesChange?: () => void;
}

const QueryPanel: React.FC<Props> = ({ onClose, isAdmin = false, onQueriesChange }) => {
  const [sql, setSql] = useState("SELECT TOP 100 * FROM Inventory");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    inventoryApi.savedQueries().then((r) => setSavedQueries(r.queries || []));
  }, []);

  function flash(msg: string) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 2500);
  }

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    setFilters({});
    try {
      const r = await inventoryApi.runQuery(sql);
      if (!r.ok) throw new Error((r as unknown as { error: string }).error || "Sorgu hatası");
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!saveName.trim()) return;
    await inventoryApi.runQuery(sql, { save: true, queryName: saveName.trim(), description: saveDesc.trim() });
    const r = await inventoryApi.savedQueries();
    setSavedQueries(r.queries || []);
    setSaveName("");
    setSaveDesc("");
    flash("Sorgu kaydedildi.");
    onQueriesChange?.();
  }

  async function deleteSaved(name: string) {
    await inventoryApi.deleteSavedQuery(name);
    setSavedQueries((q) => q.filter((x) => x.name !== name));
    flash("Sorgu silindi.");
    onQueriesChange?.();
  }

  async function publish(name: string) {
    const r = await inventoryApi.publishQuery(name);
    if (r.ok) {
      setSavedQueries((prev) =>
        prev.map((q) => q.name === name ? { ...q, isPublished: !q.isPublished } : q)
      );
      flash("Sorgu durumu güncellendi.");
      onQueriesChange?.();
    }
  }

  async function setDefault(name: string) {
    const r = await inventoryApi.setDefaultQuery(name);
    if (r.ok) {
      setSavedQueries((prev) =>
        prev.map((q) => ({ ...q, isDefault: q.name === name }))
      );
      flash(`"${name}" varsayılan sorgu yapıldı.`);
      onQueriesChange?.();
    }
  }

  const visibleCols = result?.columns || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Custom SQL Sorgusu</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#1C69D4]"
          >
            <QuestionMarkCircleIcon className="w-4 h-4" /> Yardım
          </button>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-700">
            Kapat
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-700">
        Sadece SELECT sorguları çalıştırılabilir. Limit varsayılan 200, maksimum 10.000 satır.
      </div>

      {showHelp && <QueryHelpPanel onInsertExample={(s) => setSql(s)} />}

      {/* Saved queries list */}
      {savedQueries.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Kayıtlı Sorgular</p>
          <div className="space-y-1.5">
            {savedQueries.map((q) => (
              <div
                key={q.name}
                className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2"
              >
                {/* Name + click to load */}
                <button
                  className="text-xs text-gray-800 font-medium hover:text-[#1C69D4] transition text-left flex-1 min-w-0"
                  onClick={() => setSql(q.sql)}
                  title={q.description || "Yükle"}
                >
                  {q.isDefault && <StarIcon className="w-3 h-3 inline mr-1 text-amber-500" />}
                  {q.name}
                  {q.description && (
                    <span className="ml-1.5 text-gray-400 font-normal">— {q.description}</span>
                  )}
                </button>

                {/* Badges */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {q.isPublished && (
                    <span className="px-1.5 py-0.5 text-xs bg-green-50 text-green-700 border border-green-100 rounded-full">
                      Canlı
                    </span>
                  )}
                  {q.isDefault && (
                    <span className="px-1.5 py-0.5 text-xs bg-amber-50 text-amber-700 border border-amber-100 rounded-full">
                      Varsayılan
                    </span>
                  )}
                  {q.publishedBy && (
                    <span className="text-xs text-gray-400">{q.publishedBy}</span>
                  )}
                </div>

                {/* Admin actions */}
                {isAdmin && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => publish(q.name)}
                      title={q.isPublished ? "Canlıdan Kaldır" : "Canlıya At"}
                      className={`p-1 rounded-lg transition ${
                        q.isPublished
                          ? "text-green-600 hover:bg-green-50"
                          : "text-gray-400 hover:text-green-600 hover:bg-green-50"
                      }`}
                    >
                      <ArrowUpCircleIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDefault(q.name)}
                      title="Varsayılan Yap"
                      className={`p-1 rounded-lg transition ${
                        q.isDefault
                          ? "text-amber-500 hover:bg-amber-50"
                          : "text-gray-400 hover:text-amber-500 hover:bg-amber-50"
                      }`}
                    >
                      <StarIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteSaved(q.name)}
                      title="Sil"
                      className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {!isAdmin && (
                  <button
                    onClick={() => deleteSaved(q.name)}
                    title="Sil"
                    className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flash message */}
      {actionMsg && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2 text-xs text-green-700">
          <CheckCircleIcon className="w-4 h-4" />
          {actionMsg}
        </div>
      )}

      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        rows={4}
        className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-xl outline-none focus:border-[#1C69D4] resize-none transition"
        placeholder="SELECT * FROM Inventory WHERE env = 'Production'"
        spellCheck={false}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#1C69D4] text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition"
        >
          <PlayIcon className="w-4 h-4" />
          {loading ? "Çalışıyor..." : "Çalıştır"}
        </button>

        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Sorgu adı..."
          className="flex-1 min-w-[120px] px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#1C69D4] transition"
        />
        <input
          type="text"
          value={saveDesc}
          onChange={(e) => setSaveDesc(e.target.value)}
          placeholder="Açıklama (opsiyonel)"
          className="flex-1 min-w-[120px] px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#1C69D4] transition"
        />
        <button
          onClick={save}
          disabled={!saveName.trim()}
          className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 transition"
          title="Kaydet"
        >
          <BookmarkIcon className="w-4 h-4" />
        </button>

        <button
          onClick={() => { setSql(""); setResult(null); setError(null); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition"
        >
          Temizle
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div>
          <p className="text-xs text-gray-500 mb-2">{result.rowCount} kayıt döndü.</p>
          <DynamicTable
            table=""
            columns={visibleCols}
            rows={result.rows}
            visibleCols={visibleCols}
            multiFilters={{}}
            onApplyColumnFilter={() => {}}
          />
        </div>
      )}
    </div>
  );
};

export default QueryPanel;
