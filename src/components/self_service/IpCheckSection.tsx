// src/components/self_service/IpCheckSection.tsx — Self Servis "Check" sekmesi: yapıştırılan
// IP'leri dbo.IPInventory'de arar (POST /ip-check), sunucu adlarından LB IP'lerini çıkarır
// (POST /server-ip-check; kurallar server/selfservice/lb-ip-kurallari.cjs).
import { useState } from "react";
import { selfServiceApi, type IpCheckResult, type LbIpKayit, type ServerIpCheckResult } from "@/api/selfServiceApi";
import { Field, Textarea } from "@/components/ui/Form";
import { MagnifyingGlassIcon, CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { fmtNumber, fmtDateTime } from "@/utils/datetime";

function parseGirdi(raw: string): { ips: string[]; servers: string[] } {
  const parcalar = raw.split(/[\s,;]+/).filter(Boolean);
  const ipMi = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(":");
  return { ips: parcalar.filter(ipMi), servers: parcalar.filter((s) => !ipMi(s)) };
}

const NEDEN_ETIKET: Record<LbIpKayit["neden"], string> = {
  sunucu: "Sunucu",
  u_eslenigi: "U eşleniği",
  web_eslenigi: "Web eşleniği",
  dijital_kanal_web: "Dijital kanal web",
};

// Gozden kacmis YEDINCI kopya bicimlendirici (onceki turda alti tanesi bulunmustu).
// Kendi bos-deger isareti ("-") ve kendi gecersiz-tarih davranisi (ham metni geri ver)
// vardi — ikisi de ortak moduldekinden farkliydi.
const formatTs = fmtDateTime;

export default function IpCheckSection() {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<IpCheckResult[] | null>(null);
  const [summary, setSummary] = useState<{ totalChecked: number; totalFound: number ; truncated?: number; maxItems?: number } | null>(null);
  const [lb, setLb] = useState<ServerIpCheckResult | null>(null);
  const [kopyalandi, setKopyalandi] = useState(false);

  const { ips, servers } = parseGirdi(raw);
  const girdiVar = ips.length + servers.length > 0;

  async function runCheck() {
    if (!girdiVar) {
      setError("En az bir IP ya da sunucu adı girmelisiniz.");
      return;
    }
    setLoading(true);
    setError("");
    setResults(null);
    setLb(null);
    setKopyalandi(false);
    try {
      const [ipSonuc, lbSonuc] = await Promise.all([
        ips.length > 0 ? selfServiceApi.ipCheck(ips) : null,
        servers.length > 0 ? selfServiceApi.serverIpCheck(servers) : null,
      ]);
      if (ipSonuc) {
        setResults(ipSonuc.results);
        setSummary({ totalChecked: ipSonuc.totalChecked, totalFound: ipSonuc.totalFound, truncated: ipSonuc.truncated, maxItems: ipSonuc.maxItems });
      }
      setLb(lbSonuc);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function ipleriKopyala() {
    if (!lb) return;
    try {
      await navigator.clipboard.writeText(lb.ipler.join("\n"));
      setKopyalandi(true);
    } catch {
      setError("IP'ler panoya kopyalanamadı.");
    }
  }

  const bulunamayan = lb ? lb.sonuclar.filter((s) => !s.bulundu) : [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[--text-muted]">
        IP adresi yapıştırırsanız hangi sunucuya ait olduğunu, sunucu adı yapıştırırsanız LB için kullanılacak
        IP'leri gösterir. İkisini aynı listede kullanabilirsiniz.
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 shadow-[var(--shadow-md)]">
        <Field label="IP veya Sunucu Listesi" hint="Her satıra bir tane ya da virgül veya boşlukla ayırarak">
          <Textarea
            rows={6}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"10.1.2.3\nGBAPPP01\nGBAPPP02"}
          />
        </Field>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</div>}

        <div className="flex items-center justify-between">
          <span className="text-xs text-[--text-muted]">{girdiVar ? `${ips.length} IP, ${servers.length} sunucu tespit edildi` : ""}</span>
          <button
            onClick={runCheck}
            disabled={loading || !girdiVar}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#060C17] text-white rounded-xl hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            {loading ? "Kontrol ediliyor..." : "Kontrol Et"}
          </button>
        </div>
      </div>

      {lb && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 shadow-[var(--shadow-md)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900">LB IP'leri</h3>
              <p className="text-xs text-[--text-muted]">
                {lb.sonuclar.length} sunucu için {lb.ipler.length} IP · Veri tarihi: {formatTs(lb.veriTarihi)}
                {lb.truncated ? (
                  <span className="text-[var(--status-danger)] font-semibold">
                    {" "}— son {lb.truncated} girdi DEĞERLENDİRİLMEDİ (tek seferde en fazla {lb.maxItems})
                  </span>
                ) : null}
              </p>
            </div>
            <button
              onClick={ipleriKopyala}
              disabled={lb.ipler.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ClipboardDocumentIcon className="w-4 h-4" />
              {kopyalandi ? "Kopyalandı" : "IP'leri Kopyala"}
            </button>
          </div>

          {lb.veriBayat && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              IP envanteri güncel değil. Sonuçlar son taramadaki durumu gösterir.
            </div>
          )}
          {!lb.dijitalKanalOkundu && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              Dijital kanal sunucu listesi okunamadı. CTG sunucularının web eşlenikleri eksik olabilir.
            </div>
          )}

          {lb.uyarilar.length > 0 && (
            <div className="rounded-xl border border-red-100 bg-red-50/40 px-4 py-3 space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
                Çalışma öncesi aksiyon gerekli
              </div>
              {lb.uyarilar.map((u) => (
                <p key={u.sunucu} className="text-xs text-red-700">
                  {u.sunucu} ({u.uygulama}): {u.aciklama}
                </p>
              ))}
            </div>
          )}

          {(bulunamayan.length > 0 || lb.gecersiz.length > 0) && (
            <div className="rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-3 space-y-1 text-xs text-amber-800">
              {bulunamayan.length > 0 && (
                <p>
                  <span className="font-semibold">Listede bulunamadı:</span> {bulunamayan.map((s) => s.sunucu).join(", ")}.
                  Sunucuda IHS kurulu olmadığı için veri gelmemiş olabilir; sunucu üzerinden kontrol edin.
                </p>
              )}
              {lb.gecersiz.length > 0 && (
                <p><span className="font-semibold">Geçersiz girdi:</span> {lb.gecersiz.join(", ")}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            {lb.sonuclar.filter((s) => s.kayitlar.length > 0).map((s) => (
              <div key={s.sunucu} className="rounded-xl border border-gray-100 px-4 py-3">
                <div className="text-sm font-semibold text-gray-900">{s.sunucu}</div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[--text-muted]">
                        <th className="font-semibold pr-4 py-1">Host</th>
                        <th className="font-semibold pr-4 py-1">IP</th>
                        <th className="font-semibold pr-4 py-1">Kaynak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.kayitlar.map((k) => (
                        <tr key={`${k.host}-${k.ip}`} className="border-t border-gray-100">
                          <td className="pr-4 py-1 font-medium text-gray-800">{k.host}</td>
                          <td className="pr-4 py-1 text-gray-800">{k.ip}</td>
                          <td className="pr-4 py-1 text-gray-600">{NEDEN_ETIKET[k.neden]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 shadow-[var(--shadow-md)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Sonuçlar</h3>
            {summary && (
              <span className="text-xs text-[--text-muted]">
                {summary.totalChecked} IP kontrol edildi, {summary.totalFound} tanesi bulundu
                {/* SESSIZ KESME ARTIK GORUNUR: sunucu girdiyi bir ust sinirda kesiyor;
                    eskiden fazlasi ne sonucta ne "bulunamadi" listesinde yer aliyordu ve
                    kullanici bunu HICBIR yerde goremiyordu. */}
                {summary.truncated ? (
                  <span className="text-[var(--status-danger)] font-semibold">
                    {" "}— son {summary.truncated} girdi DEĞERLENDİRİLMEDİ (tek seferde en fazla {summary.maxItems})
                  </span>
                ) : null}
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
