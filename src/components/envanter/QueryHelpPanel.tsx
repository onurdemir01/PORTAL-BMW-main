// src/components/envanter/QueryHelpPanel.tsx — actions.md #20 (Bölüm P): Custom SQL için
// tablo/şema yardım paneli. Backend değişikliği GEREKMEZ — zaten var olan
// GET /api/inventory/tables, /columns/:table, /table-aliases uçlarını birleştirip
// kullanıcıya schema/tablo/alias/kolon/tip listesini, örnek sorguları ve salt-okunur
// güvenlik açıklamasını gösteren salt-okunur bir panel.
import React, { useEffect, useState } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { inventoryApi, type ColumnMeta } from "@/api/inventoryApi";

const EXAMPLES = [
  { label: "Basit SELECT + LIMIT", sql: "SELECT TOP 100 * FROM Inventory" },
  { label: "WHERE filtresi", sql: "SELECT * FROM Inventory WHERE env = 'Production'" },
  { label: "JOIN", sql: "SELECT i.*, a.env FROM Inventory i JOIN MWAppsInventory a ON a.hostId = i.id" },
  { label: "Sayım (GROUP BY)", sql: "SELECT env, COUNT(*) AS adet FROM Inventory GROUP BY env" },
];

export default function QueryHelpPanel({ onInsertExample }: { onInsertExample: (sql: string) => void }) {
  const [tables, setTables] = useState<string[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [columnsByTable, setColumnsByTable] = useState<Record<string, ColumnMeta[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([inventoryApi.tables(), inventoryApi.tableAliases()])
      .then(([tr, ar]) => {
        setTables(tr.tables || []);
        setAliases(ar.aliases || {});
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleTable(table: string) {
    if (expanded === table) { setExpanded(null); return; }
    setExpanded(table);
    if (!columnsByTable[table]) {
      const r = await inventoryApi.columns(table);
      setColumnsByTable((prev) => ({ ...prev, [table]: r.columns || [] }));
    }
  }

  return (
    <div className="border border-gray-100 rounded-xl p-4 space-y-4 bg-gray-50/60">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Güvenlik</p>
        <p className="text-xs text-gray-600 leading-relaxed">
          Yalnızca <code>SELECT</code> ifadeleri çalıştırılabilir (INSERT/UPDATE/DELETE/DDL ve
          çoklu-ifade her zaman reddedilir). Sorgu, yalnızca yetkiniz dahilindeki tablolara
          erişebilir; sonuç satır sayısı en fazla 10.000 ile sınırlıdır. Her çalıştırma
          (başarılı veya başarısız) Denetim Kaydı'na yazılır.
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Örnek Sorgular</p>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => onInsertExample(ex.sql)}
              title={ex.sql}
              className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-full hover:border-[#1C69D4] hover:text-[#1C69D4] transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Tablolar {loading && <span className="font-normal normal-case text-gray-400">(yükleniyor…)</span>}
        </p>
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {tables.map((t) => (
            <div key={t}>
              <button
                onClick={() => toggleTable(t)}
                className="w-full flex items-center gap-1.5 text-left px-2 py-1 text-xs hover:bg-white rounded-lg transition-colors"
              >
                <ChevronRightIcon className={`w-3 h-3 text-gray-400 transition-transform ${expanded === t ? "rotate-90" : ""}`} />
                <span className="font-mono text-gray-700">{t}</span>
                {aliases[t] && <span className="text-gray-400">— {aliases[t]}</span>}
              </button>
              {expanded === t && (
                <div className="ml-6 mb-1 flex flex-wrap gap-1">
                  {(columnsByTable[t] || []).map((c) => (
                    <span key={c.COLUMN_NAME} className="text-[10px] font-mono px-1.5 py-0.5 bg-white border border-gray-100 rounded text-gray-500">
                      {c.COLUMN_NAME} <span className="text-gray-300">{c.DATA_TYPE}</span>
                    </span>
                  ))}
                  {!columnsByTable[t] && <span className="text-[10px] text-gray-400">yükleniyor…</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
