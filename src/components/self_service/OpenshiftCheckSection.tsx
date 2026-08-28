// src/components/self_service/OpenshiftCheckSection.tsx — Self Servis "Check" sekmesi:
// yapıştırılan namespace/uygulama listesini dbo.Openshift_Inventory'de arar (bkz.
// server/selfservice/index.cjs POST /openshift-check). IpCheckSection.tsx ile AYNI
// desen — girdi ayrıştırma, kart düzeni, "kontrol ediliyor" akışı hepsi bilerek aynı.
import { useState } from "react";
import { selfServiceApi, type OpenshiftCheckRow } from "@/api/selfServiceApi";
import { Field, Textarea } from "@/components/ui/Form";
import { MagnifyingGlassIcon, XCircleIcon } from "@heroicons/react/24/outline";

function parseItems(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function OpenshiftCheckSection() {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<OpenshiftCheckRow[] | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ totalChecked: number; totalMatchedRows: number ; truncated?: number; maxItems?: number } | null>(null);

  const items = parseItems(raw);

  async function runCheck() {
    if (items.length === 0) {
      setError("En az bir namespace veya uygulama adı girmelisiniz.");
      return;
    }
    setLoading(true);
    setError("");
    setRows(null);
    setNotFound([]);
    try {
      const r = await selfServiceApi.openshiftCheck(items);
      setRows(r.rows);
      setNotFound(r.notFound);
      setSummary({ totalChecked: r.totalChecked, totalMatchedRows: r.totalMatchedRows, truncated: r.truncated, maxItems: r.maxItems });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[--text-muted]">
        Bir veya birden fazla namespace ya da uygulama adını (her satıra bir tane veya virgülle
        ayırarak) yapıştırın; OpenShift envanterinde eşleşen namespace/uygulama çiftlerini ve
        sahip bilgilerini benzersiz şekilde listeler.
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 shadow-[var(--shadow-md)]">
        <Field label="Namespace / Uygulama Listesi" hint="Örn: authentication-prod, fund-coach-app-v0 veya her satıra bir tane">
          <Textarea
            rows={6}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"authentication-prod\nfund-coach-app-v0\nges-pension-digital-ch-prod"}
          />
        </Field>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</div>}

        <div className="flex items-center justify-between">
          <span className="text-xs text-[--text-muted]">{items.length > 0 ? `${items.length} girdi tespit edildi` : ""}</span>
          <button
            onClick={runCheck}
            disabled={loading || items.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#060C17] text-white rounded-xl hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            {loading ? "Kontrol ediliyor..." : "Kontrol Et"}
          </button>
        </div>
      </div>

      {rows && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 shadow-[var(--shadow-md)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Sonuçlar</h3>
            {summary && (
              <span className="text-xs text-[--text-muted]">
                {summary.totalChecked} girdi kontrol edildi, {summary.totalMatchedRows} benzersiz satır bulundu
                {/* Bkz. IpCheckSection'daki aynı not — sessiz kesme artık görünür. */}
                {summary.truncated ? (
                  <span className="text-[var(--status-danger)] font-semibold">
                    {" "}— son {summary.truncated} girdi DEĞERLENDİRİLMEDİ (tek seferde en fazla {summary.maxItems})
                  </span>
                ) : null}
              </span>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-[--text-muted]">Eşleşen namespace/uygulama bulunamadı.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[--text-muted]">
                    <th className="font-semibold pr-4 py-1.5">Namespace</th>
                    <th className="font-semibold pr-4 py-1.5">Uygulama</th>
                    <th className="font-semibold pr-4 py-1.5">Sahip Grup</th>
                    <th className="font-semibold pr-4 py-1.5">Sahip E-posta</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.namespace}-${r.application}-${i}`} className="border-t border-gray-100">
                      <td className="pr-4 py-1.5 font-medium text-gray-800">{r.namespace}</td>
                      <td className="pr-4 py-1.5 text-gray-800">{r.application}</td>
                      <td className="pr-4 py-1.5 text-gray-600">{r.owner_group_name || "-"}</td>
                      <td className="pr-4 py-1.5 text-gray-600">{r.owner_email || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {notFound.length > 0 && (
            <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <XCircleIcon className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span className="text-xs font-semibold text-amber-800">
                  {notFound.length} girdi envanterde bulunamadı (ne namespace ne uygulama olarak)
                </span>
              </div>
              <p className="text-xs text-amber-700 break-words">{notFound.join(", ")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
