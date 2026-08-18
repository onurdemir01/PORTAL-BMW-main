// src/components/self_service/IpCheckSection.tsx — Self Servis "Check" sekmesi: yapıştırılan
// IP listesini dbo.IPInventory'de arar (bkz. server/selfservice/index.cjs POST /ip-check).
import { useState } from "react";
import { selfServiceApi, type IpCheckResult } from "@/api/selfServiceApi";
import { Field, Textarea } from "@/components/ui/Form";
import { MagnifyingGlassIcon, CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";

function parseIps(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatTs(v: string | null): string {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("tr-TR");
}

export default function IpCheckSection() {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<IpCheckResult[] | null>(null);
  const [summary, setSummary] = useState<{ totalChecked: number; totalFound: number } | null>(null);

  const ips = parseIps(raw);

  async function runCheck() {
    if (ips.length === 0) {
      setError("En az bir IP girmelisiniz.");
      return;
    }
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const r = await selfServiceApi.ipCheck(ips);
      setResults(r.results);
      setSummary({ totalChecked: r.totalChecked, totalFound: r.totalFound });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[--text-muted]">
        Bir veya birden fazla IP adresini (her satıra bir tane veya virgülle ayırarak) yapıştırın, envanterde
        kayıtlı olup olmadığını kontrol edin.
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 shadow-[var(--shadow-md)]">
        <Field label="IP Listesi" hint="Örn: 10.1.2.3, 10.1.2.4 veya her satıra bir IP">
          <Textarea
            rows={6}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"10.1.2.3\n10.1.2.4\n10.1.2.5"}
          />
        </Field>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</div>}

        <div className="flex items-center justify-between">
          <span className="text-xs text-[--text-muted]">{ips.length > 0 ? `${ips.length} IP tespit edildi` : ""}</span>
          <button
            onClick={runCheck}
            disabled={loading || ips.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#060C17] text-white rounded-xl hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            {loading ? "Kontrol ediliyor..." : "Kontrol Et"}
          </button>
        </div>
      </div>

      {results && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 shadow-[var(--shadow-md)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Sonuçlar</h3>
            {summary && (
              <span className="text-xs text-[--text-muted]">
                {summary.totalChecked} IP kontrol edildi, {summary.totalFound} tanesi bulundu
              </span>
            )}
          </div>

          <div className="space-y-2">
            {results.map((r) => (
              <div
                key={r.ip}
                className={`rounded-xl border px-4 py-3 ${
                  r.found ? "border-green-100 bg-green-50/40" : "border-red-100 bg-red-50/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  {r.found ? (
                    <CheckCircleIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircleIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-gray-900">{r.ip}</span>
                  <span className={`text-xs ${r.found ? "text-green-700" : "text-red-600"}`}>
                    {r.found ? "Envanterde bulundu" : "Envanterde bulunamadı"}
                  </span>
                </div>

                {r.found && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[--text-muted]">
                          <th className="font-semibold pr-4 py-1">Host</th>
                          <th className="font-semibold pr-4 py-1">İlk Görülme</th>
                          <th className="font-semibold pr-4 py-1">Son Güncelleme</th>
                          <th className="font-semibold pr-4 py-1">Son Görülme</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.matches.map((m, i) => (
                          <tr key={`${m.host}-${i}`} className="border-t border-gray-100">
                            <td className="pr-4 py-1 font-medium text-gray-800">{m.host}</td>
                            <td className="pr-4 py-1 text-gray-600">{formatTs(m.created_at)}</td>
                            <td className="pr-4 py-1 text-gray-600">{formatTs(m.updated_at)}</td>
                            <td className="pr-4 py-1 text-gray-600">{formatTs(m.last_seen_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
