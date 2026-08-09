import React, { useState, useEffect } from "react";
import {
  CheckCircleIcon, XCircleIcon, ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { ansibleApi, type AwxTemplate } from "@/api/ansibleApi";

interface ServerHealth {
  id: number; name: string; url: string; configured: boolean;
  reachable: boolean; authOk: boolean; checkedAt: string;
  responseTimeMs: number | null; awxVersion: string | null; error: string | null;
  connectionType?: "token" | "user_pass";
}
interface HealthStatus { ok: boolean; url?: string; version?: string; message?: string; servers?: ServerHealth[]; }

type TemplateSummary = { serverId: number; serverName: string; ok: boolean; templates: AwxTemplate[]; error?: string };

export default function AnsibleConfigTab() {
  const [health, setHealth]           = useState<HealthStatus | null>(null);
  const [templateSummary, setSummary] = useState<TemplateSummary[]>([]);
  const [totalTemplates, setTotal]    = useState(0);
  const [loading, setLoading]         = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [h, t] = await Promise.allSettled([
        ansibleApi.health(),
        ansibleApi.awxTemplatesAll(),
      ]);
      if (h.status === "fulfilled") setHealth(h.value as HealthStatus);
      else setHealth({ ok: false, message: "Bağlanamadı" });
      if (t.status === "fulfilled") {
        const r = t.value as ReturnType<typeof ansibleApi.awxTemplatesAll> extends Promise<infer U> ? U : never;
        setSummary(r.summary || []);
        setTotal(r.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // Periyodik kontrol (actions.md #8) — 5 dk'da bir otomatik yenile, backend'e ek
    // yuk bindirmez (yalniz bu sekme acikken calisir, kisa TTL'li tek bir ping/sunucu).
    const timer = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-8">
      {/* AWX Health */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">AWX Bağlantı Durumu</h3>
          <button onClick={reload} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${health?.ok ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}`}>
          {health?.ok
            ? <CheckCircleIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
            : <XCircleIcon className="w-5 h-5 text-red-400 flex-shrink-0" />}
          <div>
            <p className={`text-sm font-medium ${health?.ok ? "text-green-800" : "text-red-700"}`}>
              {health?.ok ? "AWX Bağlı" : "AWX Erişilemiyor"}
            </p>
            {health?.message && !health?.ok && <p className="text-xs text-red-500 mt-0.5">{health.message}</p>}
          </div>
        </div>
        {health?.servers && health.servers.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {health.servers.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 text-xs">
                {s.reachable && s.authOk
                  ? <CheckCircleIcon className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  : <XCircleIcon className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                <span className="font-medium text-gray-700">{s.name}</span>
                <span className="text-gray-400 font-mono">{s.url}</span>
                {s.awxVersion && <span className="text-gray-400">v{s.awxVersion}</span>}
                {s.responseTimeMs != null && <span className="text-gray-400">{s.responseTimeMs}ms</span>}
                {s.error && <span className="text-red-500 ml-auto">{s.error}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* AWX Template Özeti — Çoklu Sunucu */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">
          AWX Şablonları
          {totalTemplates > 0 && <span className="ml-2 text-xs font-normal text-gray-400">({totalTemplates} toplam)</span>}
        </h3>
        <p className="text-xs text-gray-400 mb-3">Tüm AWX sunucularındaki read-only iş şablonları.</p>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : templateSummary.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">AWX sunucusu bulunamadı.</p>
        ) : (
          <div className="space-y-4">
            {templateSummary.map((srv) => (
              <div key={srv.serverId}>
                <div className="flex items-center gap-2 mb-2">
                  {srv.ok
                    ? <CheckCircleIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                    : <XCircleIcon className="w-4 h-4 text-red-400 flex-shrink-0" />}
                  <span className="text-xs font-semibold text-gray-700">{srv.serverName}</span>
                  <span className="text-xs text-gray-400">({srv.templates.length} şablon)</span>
                  {srv.error && <span className="text-xs text-red-400 ml-1">{srv.error}</span>}
                </div>
                {srv.templates.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-gray-100 mb-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100 text-left">
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">ID</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Şablon Adı</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Playbook</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Proje</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Tip</th>
                          <th className="px-4 py-2 text-xs font-semibold text-gray-500">Değiştirilme</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {srv.templates.map((t) => (
                          <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-2 text-xs font-mono text-gray-500">{t.id}</td>
                            <td className="px-4 py-2 font-medium text-gray-800 text-xs">
                              {t.name}
                              {t.hasInventory === false && <span className="ml-1.5 text-[10px] text-amber-600" title="Envanter atanmamış — launch edilemeyebilir">⚠</span>}
                            </td>
                            <td className="px-4 py-2 text-xs font-mono text-[#1A56DB]">{t.playbook}</td>
                            <td className="px-4 py-2 text-xs text-gray-500">{t.project || "—"}</td>
                            <td className="px-4 py-2 text-xs text-gray-500">{t.jobType || "—"}</td>
                            <td className="px-4 py-2 text-xs text-gray-400">{t.modified ? new Date(t.modified).toLocaleDateString("tr-TR") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* OCP Cluster Yönetimi buradan KALDIRILDI (2026-08-09).
          Portalda IKI ayri OCP katalogu vardi: burasi (ansible_ocp_clusters) ve
          LogX'in ocp_cluster_index'i. Ortak anahtarlari yoktu; sihirbazlar yalnizca
          ikincisini okudugu icin bu ekran uretimde BOS duruyor ama "tek gercek katalog"
          izlenimi veriyordu. Tek katalog artik:
            Admin > LogX Yapilandirma > OCP Cluster Hiyerarsisi
          "Baglanti Testi" ve "Pod Durumu" aksiyonlari da oradaki satirlara tasindi
          (bkz. server/logx/v2/ocp-health.cjs). Eski /api/ansible/clusters* uclari ve
          ansible_ocp_clusters tablosu VERI KAYBI OLMASIN diye silinmedi; artik hicbir
          ekran onlari cagirmiyor. */}

      {/* Ortam Değişkenleri Notu — actions.md #10: her değişkenin (i) ikonunda açıklama/örnek/kullanım yeri */}
      <section className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
        <p className="font-semibold mb-1">Gerekli Env Değişkenleri</p>
        <ul className="space-y-1 font-mono">
          {[
            { key: "AWX_URL", desc: "Varsayılan (legacy tek-sunucu) AWX/Tower adresi." },
            { key: "AWX_USER + AWX_PASSWORD", desc: "AWX_TOKEN tanımlı değilse, token almak için kullanılan servis hesabı — şifre DB'de şifreli saklanır." },
            { key: "AWX_READ_ONLY_TEMPLATE_IDS", desc: "Virgülle ayrılmış template ID listesi — boşsa TÜM template'ler izinli sayılır." },
            { key: "AWX_LOG_FETCH_TEMPLATE_ID", desc: "AI Analist'in uzak log dosyası çekmek için kullandığı template ID'si." },
          ].map((v) => (
            <li key={v.key} className="flex items-center gap-1.5">
              <span>{v.key}</span>
              <span className="text-amber-400 cursor-help font-sans" title={v.desc}>ⓘ</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-amber-500 font-sans">Tüm değerler Admin &gt; Sistem sekmesinden de kalıcı olarak (DB'de) ayarlanabilir.</p>
      </section>
    </div>
  );
}
