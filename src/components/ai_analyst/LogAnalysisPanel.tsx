// src/components/ai_analyst/LogAnalysisPanel.tsx — AI Analist "Log Analizi" modu
//
// LogX'teki AIPanel buraya taşındı (birleşik AI merkezi): yapıştır → PII maskele →
// yapılandırılmış rapor. LogX viewer'dan "Logları AI'a Gönder" handoff'u
// (sessionStorage 'aiAnalystPrefill' + ?mode=logs&autorun=1) bu paneli doldurur.
import React, { useState, useEffect, useRef } from "react";
import {
  SparklesIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ClipboardDocumentIcon,
  ArrowPathIcon,
  ShieldCheckIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import { aiAnalystApi, type LogAnalysisResult } from "@/api/aiAnalystApi";

const SEVERITY_STYLE: Record<string, { label: string; cls: string }> = {
  info:     { label: "Bilgi",  cls: "bg-blue-50 text-blue-700 border-blue-100"    },
  warning:  { label: "Uyarı",  cls: "bg-amber-50 text-amber-700 border-amber-100" },
  error:    { label: "Hata",   cls: "bg-red-50 text-red-700 border-red-100"       },
  critical: { label: "Kritik", cls: "bg-red-100 text-red-800 border-red-200"      },
};

interface LogAnalysisPanelProps {
  initialText?: string;
  autorun?: boolean;
  disabled?: boolean;
  // LogX handoff'undan gelen host adı (biliniyorsa) — deep-dive mesajına eklenir,
  // AI Analist'in DT/Instana araçlarını host bazlı çağırmasını kolaylaştırır.
  hostHint?: string;
  // Rapor bulgularını Kaynak Analizi sohbetine taşır (aynı sayfada mod geçişi)
  onDeepDive?: (summary: string) => void;
}

export default function LogAnalysisPanel({ initialText, autorun, disabled, hostHint, onDeepDive }: LogAnalysisPanelProps) {
  const [text, setText] = useState(initialText ?? "");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LogAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const autoranRef = useRef(false);

  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);

  async function analyze(input?: string) {
    const lines = (input ?? text).split("\n").filter((l) => l.trim());
    if (lines.length === 0 || loading) return;

    setLoading(true);
    setResult(null);
    setError("");
    try {
      const data = await aiAnalystApi.analyzeLogs(lines, context.trim());
      if (!data.ok) setError(data.message || "Analiz başarısız.");
      else setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Bağlantı hatası.");
    } finally {
      setLoading(false);
    }
  }

  // Handoff autorun: prefill geldiyse analizi otomatik başlat (bir kez)
  useEffect(() => {
    if (autorun && initialText && !autoranRef.current && !disabled) {
      autoranRef.current = true;
      analyze(initialText);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, initialText, disabled]);

  const lineCount = text.split("\n").filter((l) => l.trim()).length;
  const severityStyle = result ? (SEVERITY_STYLE[result.severity] || SEVERITY_STYLE.info) : null;

  return (
    <div className="space-y-4">
      {/* Güvenlik notu */}
      <div className="flex items-start gap-3 rounded-xl px-4 py-3 border" style={{ background: "#5752d114", borderColor: "#5752d133" }}>
        <ShieldCheckIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#3c3d99" }} />
        <p className="text-xs" style={{ color: "#5b4a9e" }}>
          <strong>AI yalnızca öneri verir, hiçbir değişiklik yapmaz.</strong>{" "}
          Log satırları gönderilmeden önce otomatik olarak PII maskeleme uygulanır
          (TCKN, kart no, IBAN, e-posta, telefon, token).
        </p>
      </div>

      {/* Girdi */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">
            Log Satırları <span className="font-normal text-gray-400">(yapıştırın veya LogX'ten gönderin)</span>
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"2024-01-01 12:00:00 ERROR [jboss] Connection refused...\n2024-01-01 12:00:01 WARN [nginx] upstream timeout..."}
            className="w-full px-3 py-2.5 text-xs font-mono border border-gray-200 rounded-xl outline-none focus:border-[#5752d1] transition resize-none"
            spellCheck={false}
            disabled={loading || disabled}
          />
          <p className="text-xs text-gray-400 mt-1">{lineCount} satır seçili (maks 500)</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">
            Ek Bağlam <span className="font-normal text-gray-400">(opsiyonel — ortam, servis adı, vs.)</span>
          </label>
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Örn: Production JBoss sunucusu, deploy sonrası hata..."
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#5752d1] transition"
            disabled={loading || disabled}
          />
        </div>
      </div>

      <button
        onClick={() => analyze()}
        disabled={loading || lineCount === 0 || disabled}
        className="flex items-center gap-2 px-4 py-2 text-sm text-white rounded-xl disabled:opacity-40 transition font-medium"
        style={{ background: "#3c3d99" }}
      >
        {loading ? (
          <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Analiz ediliyor...</>
        ) : (
          <><SparklesIcon className="w-4 h-4" /> Analiz Et</>
        )}
      </button>

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <ExclamationTriangleIcon className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Rapor */}
      {result && (
        <div className="space-y-3" style={{ animation: "fadeIn 0.2s ease" }}>
          {result.maskedCount > 0 && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-2.5">
              <ShieldCheckIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
              <span className="text-xs text-green-700">
                <strong>{result.maskedCount}</strong> adet kişisel veri maskelendi ve AI'a gönderilmedi.{" "}
                <span className="text-green-600 opacity-80">
                  ({Object.entries(result.maskingDetail).map(([k, v]) => `${k}: ${v}`).join(", ")})
                </span>
              </span>
            </div>
          )}

          <div className={`border rounded-2xl p-4 ${severityStyle?.cls}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <InformationCircleIcon className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Özet</span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${severityStyle?.cls}`}>
                {severityStyle?.label}
              </span>
            </div>
            <p className="text-sm leading-relaxed">{result.summary}</p>
          </div>

          {result.possibleCauses?.length > 0 && (
            <div className="border border-gray-100 rounded-2xl p-4 bg-white">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Olası Nedenler</p>
              <ul className="space-y-1.5">
                {result.possibleCauses.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.recommendations?.length > 0 && (
            <div className="border border-gray-100 rounded-2xl p-4 bg-white">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Öneriler</p>
              <ul className="space-y-1.5">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "#5752d122", color: "#3c3d99" }}>
                      {i + 1}
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.patterns?.length > 0 && (
            <div className="border border-gray-100 rounded-2xl p-4 bg-white">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tespit Edilen Örüntüler</p>
              <div className="flex flex-wrap gap-2">
                {result.patterns.map((p, i) => (
                  <span key={i} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg">{p}</span>
                ))}
              </div>
            </div>
          )}

          {/* Alt bilgi + aksiyonlar */}
          <div className="flex items-center justify-between text-xs text-gray-400 px-1 flex-wrap gap-2">
            <span className="flex items-center gap-2">
              {result.inputLines} satır analiz edildi · {result.model}
              {result.provider && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  result.provider === "openai"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                    : "bg-violet-50 text-violet-700 border border-violet-100"
                }`}>
                  {result.provider === "openai" ? "OpenAI" : "Anthropic"}
                </span>
              )}
            </span>
            <div className="flex items-center gap-3">
              {onDeepDive && (
                <button
                  onClick={() => {
                    const parts = [
                      hostHint
                        ? `Az önce "${hostHint}" hostundan çektiğim log için şu AI analiz bulgularını aldım — bunu Dynatrace/Instana verileriyle (bu host/ilgili servis için event, metrik, açık problem) korele edip derinleştirir misin?`
                        : `Az önce şu log analiz bulgularını aldım, Dynatrace/Instana verileriyle derinleştirir misin?`,
                      `\nÖZET: ${result.summary}`,
                      `SEVİYE: ${result.severity}`,
                      result.possibleCauses?.length ? `OLASI NEDENLER: ${result.possibleCauses.join("; ")}` : "",
                      context.trim() ? `EK BAĞLAM: ${context.trim()}` : "",
                    ].filter(Boolean);
                    onDeepDive(parts.join("\n"));
                  }}
                  className="flex items-center gap-1 font-medium transition"
                  style={{ color: "#3c3d99" }}
                >
                  <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
                  Bu bulguları sohbette derinleştir
                </button>
              )}
              <button
                onClick={() => {
                  const txt = [
                    `ÖZET: ${result.summary}`,
                    `SEVİYE: ${result.severity}`,
                    result.possibleCauses?.length ? `NEDENLER:\n${result.possibleCauses.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}` : "",
                    result.recommendations?.length ? `ÖNERİLER:\n${result.recommendations.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}` : "",
                  ].filter(Boolean).join("\n\n");
                  navigator.clipboard.writeText(txt);
                }}
                className="flex items-center gap-1 hover:text-gray-600 transition"
              >
                <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                Kopyala
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
