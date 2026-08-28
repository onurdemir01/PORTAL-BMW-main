import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon, PlayIcon, ArrowPathIcon, CheckCircleIcon, XCircleIcon, ClockIcon, InformationCircleIcon, PlusIcon } from "@heroicons/react/24/outline";
import { ansibleApi, type AwxServer, type AwxTemplate, type AwxTemplateDetail, type JobStatus, type AnsibleSsItem } from "@/api/ansibleApi";
import { toast } from "@/hooks/useToast";
import FieldOverridesModal from "@/components/self_service/FieldOverridesModal";
import CodeChip from "@/components/common/CodeChip";
import { fmtDateTime, fmtDateTimeSeconds } from "@/utils/datetime";

// ── Simple YAML key:value parser (no external deps) ──────────────────────────
function parseSimpleYaml(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t === "---") continue;
    const i = t.indexOf(":");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

// Bir nesneyi basit YAML (key: value) satırlarına çevirir — nesne/dizi değerler JSON
// olarak yazılır. Launch payload'ında extra_vars zaten JSON.stringify edildiği için
// tip bilgisi korunur (bkz. server/ansible/runner.cjs launchJob).
function objToYaml(obj: Record<string, unknown>): string {
  const lines = Object.entries(obj).map(([k, v]) =>
    `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`
  );
  return lines.join("\n");
}

// Birleşik (unify) değişken editörü: metni seçilen formata (JSON/YAML) göre nesneye
// çevirir. Hata varsa {error} döner.
function parseVarsText(text: string, format: "yaml" | "json"): { obj: Record<string, unknown>; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { obj: {}, error: null };
  if (format === "json") {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { obj: {}, error: "JSON bir nesne (obje) olmalı — {\"anahtar\": \"değer\"}" };
      }
      return { obj: parsed, error: null };
    } catch (e) {
      return { obj: {}, error: `Geçersiz JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  // YAML (basit key: value). JSON değerleri de otomatik çözülür (sayı/bool/nesne).
  const flat = parseSimpleYaml(trimmed);
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    try { obj[k] = JSON.parse(v); } catch { obj[k] = v; }
  }
  return { obj, error: null };
}

// ── Job status helpers ────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  successful: "#22c55e", failed: "#ef4444", error: "#ef4444",
  canceled: "#f97316", running: "var(--accent)", waiting: "#94a3b8", pending: "#94a3b8",
};
const STATUS_LABEL: Record<string, string> = {
  successful: "Başarılı", failed: "Başarısız", error: "Hata",
  canceled: "İptal", running: "Çalışıyor", waiting: "Bekliyor", pending: "Kuyrukta",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "successful") return <CheckCircleIcon className="w-5 h-5" style={{ color: STATUS_COLOR[status] }} />;
  if (status === "failed" || status === "error") return <XCircleIcon className="w-5 h-5" style={{ color: STATUS_COLOR[status] }} />;
  return <ClockIcon className="w-5 h-5 animate-spin" style={{ color: STATUS_COLOR[status] ?? "#94a3b8" }} />;
}

// ── Job Output Modal (F-06) ───────────────────────────────────────────────────
interface JobOutputModalProps { jobId: number; templateName: string; onClose: () => void; }

function JobOutputModal({ jobId, templateName, onClose }: JobOutputModalProps) {
  const [status, setStatus]   = useState<JobStatus | null>(null);
  const [output, setOutput]   = useState<string>("");
  const [changed, setChanged] = useState(false);
  const pollRef = useRef<number | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  const poll = useCallback(() => {
    ansibleApi.jobStatus(jobId)
      .then((s) => {
        setStatus(s);
        ansibleApi.jobOutput(jobId)
          .then((o) => { setOutput(o.output ?? ""); setChanged(o.changedWarning); })
          .catch(() => {});
        const done = ["successful", "failed", "error", "canceled"].includes(s.status ?? "");
        if (!done) {
          pollRef.current = window.setTimeout(poll, 3000);
        }
      })
      .catch(() => { pollRef.current = window.setTimeout(poll, 5000); });
  }, [jobId]);

  useEffect(() => {
    poll();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [poll]);

  // Auto-scroll output to bottom
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  const isRunning = !["successful", "failed", "error", "canceled"].includes(status?.status ?? "");

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto p-4" style={{ background: "rgba(3,9,18,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="min-h-full flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="rounded-2xl w-full max-w-3xl flex flex-col max-h-[calc(100dvh-2rem)] my-4" style={{ background: "var(--bg-surface)", boxShadow: "var(--shadow-lg)" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
            <div>
              <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                Job #{jobId} — {templateName}
              </h2>
              {status && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <StatusIcon status={status.status} />
                  <span className="text-sm font-medium" style={{ color: STATUS_COLOR[status.status] ?? "#94a3b8" }}>
                    {STATUS_LABEL[status.status] ?? status.status}
                  </span>
                  {isRunning && <span className="text-xs" style={{ color: "var(--text-muted)" }}>— güncelleniyor…</span>}
                </div>
              )}
            </div>
            <button onClick={onClose} className="rounded-xl p-2 hover:bg-gray-100 transition-colors">
              <XMarkIcon className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
            </button>
          </div>

          {/* Changed warning */}
          {changed && (
            <div className="mx-6 mt-3 px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0" style={{ background: "var(--status-warning-bg)", color: "var(--status-warning)" }}>
              ⚠ Playbook'ta değişiklik (changed) tespit edildi — üretim ortamında onaylayın.
            </div>
          )}

          {/* Output */}
          <pre
            ref={outputRef}
            className="flex-1 overflow-auto px-6 py-4 text-xs leading-relaxed font-mono"
            style={{ background: "var(--term-bg)", color: "var(--term-fg)", minHeight: "200px" }}
          >
            {output || (isRunning ? "Çıktı bekleniyor…" : "Çıktı yok.")}
          </pre>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t gap-3 flex-shrink-0">
            {status?.elapsed != null && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Süre: {status.elapsed.toFixed(1)}s
              </span>
            )}
            <button
              onClick={onClose}
              className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold border transition-all"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              Kapat
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Launch Modal (F-04 / F-05) ───────────────────────────────────────────────
interface LaunchModalProps {
  template: AwxTemplate;
  onClose: () => void;
  onLaunched: (jobId: number) => void;
}

function LaunchModal({ template, onClose, onLaunched }: LaunchModalProps) {
  // Template'in statik extra_vars'ından başlangıç değerleri (YAML olarak gösterilir).
  // Template ask_variables_on_launch kullanıp statik var tanımlamamışsa editör boş
  // başlar ama kullanıcı istediği değişkeni serbestçe ekleyebilir (opsiyonel olanlar dahil).
  const defaults = parseSimpleYaml(template.variables ?? "");
  const [format, setFormat]   = useState<"yaml" | "json">("yaml");
  const [varsText, setVarsText] = useState<string>(objToYaml(defaults));
  const [limit, setLimit]     = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Anlık ayrıştırma — geçersiz JSON/YAML'ı launch'tan ÖNCE gösterir.
  const parsed = parseVarsText(varsText, format);
  const varCount = Object.keys(parsed.obj).length;

  // Format değiştir: mevcut metni bir formattan diğerine çevir (best-effort).
  function switchFormat(next: "yaml" | "json") {
    if (next === format) return;
    const { obj, error: perr } = parseVarsText(varsText, format);
    if (perr) { setFormat(next); return; } // ayrıştırılamıyorsa metni olduğu gibi bırak
    setVarsText(next === "json" ? JSON.stringify(obj, null, 2) : objToYaml(obj));
    setFormat(next);
  }

  const handleLaunch = async () => {
    const { obj, error: perr } = parseVarsText(varsText, format);
    if (perr) { setError(perr); return; }
    setLaunching(true);
    setError(null);
    try {
      // extraVars nesnesi doğrudan geçilir — launchJob backend'de JSON.stringify eder,
      // böylece string olmayan (sayı/bool/nesne) değerler de korunur.
      const r = await ansibleApi.run(template.id, obj as Record<string, string>, limit);
      if (!r.ok) throw new Error(r.message || "Job başlatılamadı");
      onLaunched(r.jobId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto p-4" style={{ background: "rgba(3,9,18,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="min-h-full flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl w-full max-w-lg flex flex-col max-h-[calc(100dvh-2rem)] my-4" style={{ background: "var(--bg-surface)", boxShadow: "var(--shadow-lg)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {template.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{template.playbook}</p>
            <p className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>ID: {template.id}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 hover:bg-gray-100 transition-colors">
            <XMarkIcon className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
          {/* Birleşik değişken editörü — tüm extra_vars, JSON veya YAML */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Değişkenler (extra_vars)
              </p>
              <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--bg-elevated)" }}>
                {(["yaml", "json"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => switchFormat(f)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${format === f ? "bg-white shadow-sm" : ""}`}
                    style={{ color: format === f ? "var(--accent)" : "var(--text-muted)" }}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="w-full rounded-xl border px-3 py-2 text-xs font-mono outline-none transition-colors resize-y"
              style={{ borderColor: parsed.error ? "#fca5a5" : "var(--border)", minHeight: "140px", background: "var(--term-bg)", color: "var(--term-fg)" }}
              value={varsText}
              onChange={(e) => setVarsText(e.target.value)}
              spellCheck={false}
              placeholder={format === "yaml" ? "anahtar: değer\nbaska_anahtar: 5" : '{\n  "anahtar": "değer",\n  "sayi": 5\n}'}
            />
            <div className="flex items-center justify-between text-[11px]">
              {parsed.error
                ? <span className="text-red-500">⚠ {parsed.error}</span>
                : <span style={{ color: "var(--text-muted)" }}>{varCount} değişken · geçerli {format.toUpperCase()}</span>}
              <span style={{ color: "var(--text-muted)" }}>Opsiyonel alanlar da eklenebilir</span>
            </div>
          </div>

          {/* Limit */}
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--text-secondary)" }}>
              Limit (opsiyonel)
            </label>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors"
              style={{ borderColor: "var(--border)" }}
              placeholder="host_pattern veya boş bırak"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>

          {error && (
            <div className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--status-danger-bg)", color: "var(--status-danger)" }}>
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold border transition-all"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            İptal
          </button>
          <button
            onClick={handleLaunch}
            disabled={launching || !!parsed.error}
            className="btn-primary px-5 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
          >
            {launching ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <PlayIcon className="w-4 h-4" />
            )}
            {launching ? "Başlatılıyor…" : "İş Başlat"}
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
}

// ── Template Info Modal ───────────────────────────────────────────────────────
interface TemplateInfoModalProps {
  serverId: number;
  template: AwxTemplate;
  onClose: () => void;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === "" || value === null || value === undefined) return null;
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="w-32 flex-shrink-0 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="min-w-0 break-words" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function TemplateInfoModal({ serverId, template, onClose }: TemplateInfoModalProps) {
  const [detail, setDetail]   = useState<AwxTemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // "Self Service olarak ekle" mini formu
  const [ssFormOpen, setSsFormOpen] = useState(false);
  const [ssTitle, setSsTitle]       = useState(template.name);
  const [ssDesc, setSsDesc]         = useState(template.description || "");
  const [ssSaving, setSsSaving]     = useState(false);
  // Kaydedilen item'ın alan incelemesi (bkz. addToSelfService) — kayıt anının
  // doğal bir devamı olarak HEMEN açılır, sonradan erişilen ayrı bir aksiyon değil.
  const [fieldsReviewItem, setFieldsReviewItem] = useState<AnsibleSsItem | null>(null);

  useEffect(() => {
    ansibleApi.templateDetail(serverId, template.id)
      .then((r) => {
        if (!r.ok || !r.template) setError(r.message || "Detay alınamadı");
        else setDetail(r.template);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [serverId, template.id]);

  async function addToSelfService() {
    if (!ssTitle.trim()) return;
    setSsSaving(true);
    try {
      const r = await ansibleApi.saveSsItem({
        title: ssTitle.trim(),
        description: ssDesc.trim(),
        awxServerId: serverId,
        awxTemplateId: template.id,
        // Yeni eklenen Self Service otomasyonlari varsayilan olarak kullanicilara KAPALI
        // baslar — admin, "Self Service Yonetimi" ekranindaki gorunurluk anahtariyla
        // bilinclii sekilde acmadan hicbir kullanici gormez.
        enabled: false,
        // Date.now() (ms) MSSQL'deki sort_order INT (32-bit, maks ~2.14 milyar) sinirini
        // asiyordu — HER kayitta "Validation failed for parameter" ile 500 donduruyordu.
        // Saniye cinsinden epoch de sirlama amaci icin yeterli ve int32'ye sigar (2038'e kadar).
        order: Math.floor(Date.now() / 1000),
      });
      if (!r.ok) throw new Error(r.message || "Self service kaydı başarısız");
      toast.success(`"${ssTitle.trim()}" self service kataloğuna eklendi.`);
      setSsFormOpen(false);
      // Template otomatik çekilip kaydedildiği için, launch ekranında kullanıcının
      // göreceği TÜM alanlarla eksiksiz karşılaşılması için alan incelemesi HEMEN açılır.
      if (r.item) setFieldsReviewItem(r.item);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSsSaving(false);
    }
  }

  const surveyFields = detail?.surveyFields ?? [];
  const extraVarKeys = Object.keys(detail?.extraVarsParsed ?? {});

  if (typeof document === "undefined") return null;

  // Alan incelemesi kaydın hemen ardından açılır — arkadaki template detay modalının
  // yerini alır (kayıt anının doğal, atlanamaz bir devamı olarak).
  if (fieldsReviewItem) {
    return <FieldOverridesModal item={fieldsReviewItem} onClose={() => { setFieldsReviewItem(null); onClose(); }} />;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto p-4" style={{ background: "rgba(3,9,18,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="min-h-full flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl w-full max-w-2xl flex flex-col max-h-[calc(100dvh-2rem)] my-4" style={{ background: "var(--bg-surface)", boxShadow: "var(--shadow-lg)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{template.name}</h2>
            <p className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>Template ID: {template.id} · Server {serverId}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 hover:bg-gray-100 transition-colors">
            <XMarkIcon className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-24">
              <ArrowPathIcon className="w-6 h-6 animate-spin" style={{ color: "var(--accent)" }} />
            </div>
          )}
          {error && (
            <div className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--status-danger-bg)", color: "var(--status-danger)" }}>{error}</div>
          )}

          {detail && (
            <>
              {/* Genel */}
              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Genel</p>
                {detail.description && <InfoRow label="Açıklama" value={detail.description} />}
                <InfoRow label="Job Type" value={detail.jobType} />
                <InfoRow label="Playbook" value={<code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{detail.playbook}</code>} />
                <InfoRow label="Inventory" value={detail.inventory} />
                <InfoRow label="Project" value={detail.project} />
                <InfoRow label="Limit" value={detail.limit} />
                <InfoRow label="Verbosity" value={detail.verbosity > 0 ? String(detail.verbosity) : ""} />
                <InfoRow
                  label="Launch Ayarları"
                  value={[
                    detail.askVariables && "Değişken sorar",
                    detail.askLimit && "Limit sorar",
                    detail.askInventory && "Inventory sorar",
                  ].filter(Boolean).join(" · ") || "Sormadan çalışır"}
                />
                {detail.modified && <InfoRow label="Son Değişiklik" value={fmtDateTime(detail.modified)} />}
              </section>

              {/* Survey soruları */}
              {surveyFields.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Survey Soruları ({surveyFields.length})</p>
                    {detail.surveyEnabled ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">AWX'te AÇIK — launch'ta sorulur</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">AWX'te KAPALI — launch'ta sorulmaz</span>
                    )}
                  </div>
                  {!detail.surveyEnabled && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Bu sorular AWX'te tanımlı ama survey <strong>kapalı</strong> — launch sırasında kullanıcıya sorulmaz;
                      template statik extra_vars ile çalışır. "Alanları Yönet" ekranında da bu yüzden alan görünmez.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {surveyFields.map((f) => (
                      <div key={f.name} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                        {(() => {
                          const rawChoices = (f as { choices?: unknown }).choices;
                          const choices = Array.isArray(rawChoices)
                            ? rawChoices.map((c) => String(c).trim()).filter(Boolean)
                            : (typeof rawChoices === "string"
                              ? rawChoices.split(/\r?\n|,/).map((c) => c.trim()).filter(Boolean)
                              : []);
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-800">{f.label}</span>
                                <code className="text-[10px] text-slate-400">{f.name}</code>
                                <span className="text-[10px] px-1.5 rounded bg-slate-100 text-slate-500">{f.type}</span>
                                {f.required && <span className="text-[10px] text-red-500">zorunlu</span>}
                              </div>
                              {f.default && <p className="text-xs text-slate-400 mt-0.5">Varsayılan: {f.default}</p>}
                              {choices.length > 0 && <p className="text-xs text-slate-400 mt-0.5">Seçenekler: {choices.join(", ")}</p>}
                            </>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Extra vars */}
              {detail.extraVars && (
                <section className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Extra Vars {extraVarKeys.length > 0 ? `(${extraVarKeys.length} değişken)` : ""}</p>
                  <pre className="text-xs font-mono rounded-xl p-3 overflow-auto max-h-48" style={{ background: "var(--term-bg)", color: "var(--term-fg)" }}>
                    {detail.extraVars}
                  </pre>
                </section>
              )}

              {/* Credentials */}
              {detail.credentials.length > 0 && (
                <section className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Credentials</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.credentials.map((c, i) => (
                      <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full">
                        {c.name}{c.kind ? ` (${c.kind})` : ""}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Son çalıştırmalar */}
              {detail.recentJobs.length > 0 && (
                <section className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Son Çalıştırmalar</p>
                  <div className="space-y-1">
                    {detail.recentJobs.map((j) => (
                      <div key={j.id} className="flex items-center gap-2 text-sm">
                        <StatusIcon status={j.status} />
                        <span className="text-slate-600">Job #{j.id}</span>
                        <span className="text-xs font-medium" style={{ color: STATUS_COLOR[j.status] ?? "#94a3b8" }}>
                          {STATUS_LABEL[j.status] ?? j.status}
                        </span>
                        {j.finished && <span className="text-xs text-slate-400">{fmtDateTime(j.finished)}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Self service mini form */}
              {ssFormOpen && (
                <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#1C69D4]">Self Service Kaydı</p>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--text-secondary)" }}>İsim</label>
                    <input
                      className="w-full rounded-xl border px-3 py-2 text-sm outline-none bg-white"
                      style={{ borderColor: "var(--border)" }}
                      value={ssTitle}
                      onChange={(e) => setSsTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--text-secondary)" }}>Açıklama</label>
                    <input
                      className="w-full rounded-xl border px-3 py-2 text-sm outline-none bg-white"
                      style={{ borderColor: "var(--border)" }}
                      value={ssDesc}
                      onChange={(e) => setSsDesc(e.target.value)}
                      placeholder="Kısa açıklama (opsiyonel)"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Server ID ({serverId}), Template ID ({template.id}) ve değişken şeması otomatik doldurulur.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setSsFormOpen(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">İptal</button>
                    <button
                      onClick={addToSelfService}
                      disabled={ssSaving || !ssTitle.trim()}
                      className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {ssSaving ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PlusIcon className="w-4 h-4" />}
                      Kaydet
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t flex-shrink-0 gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold border transition-all"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Kapat
          </button>
          {detail && !ssFormOpen && (
            <button
              onClick={() => setSsFormOpen(true)}
              className="btn-primary px-4 py-2 text-sm font-semibold flex items-center gap-2"
            >
              <PlusIcon className="w-4 h-4" />
              Self Service Olarak Ekle
            </button>
          )}
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
}

// ── Template card ─────────────────────────────────────────────────────────────
interface TemplateCardProps {
  t: AwxTemplate;
  onLaunch: (t: AwxTemplate) => void;
  onInfo: (t: AwxTemplate) => void;
}

function TemplateCard({ t, onLaunch, onInfo }: TemplateCardProps) {
  return (
    // `h-full` + `flex-col`: karti izgara hucresinin TAMAMINA yay. Onceden kartlar
    // icerige gore buyuyordu ve ayni satirdaki kartlarin footer'lari FARKLI
    // yuksekliklerde duruyordu (uretim ekran goruntusu). Artik footer `mt-auto` ile
    // her kartta AYNI hizada.
    <div className="rounded-xl border bg-white p-4 h-full flex flex-col gap-2 hover:shadow-sm transition-shadow">
      {/* `min-w-0` SART: bu bir flex cocugu ve icindeki uzun yol/ad token'lari
          varsayilan `min-width:auto` yuzunden karti disariya dogru sisiriyordu. */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          {/* Baslik IKI SATIRA sabit: 1↔2 satir arasi degisince altindaki her sey
              kayiyor ve izgara raggedlesiyordu. `line-clamp-2` + `min-h` ile ayni yer
              her kartta ayrilir; tam ad `title`da kalir. */}
          <div
            className="font-semibold text-slate-800 text-sm leading-snug line-clamp-2 min-h-[2.5rem]"
            title={t.name}
          >
            {t.name}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">ID: {t.id}</div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {t.ask_variables && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
              Vars
            </span>
          )}
          {t.isReadOnly && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
              Read-only
            </span>
          )}
        </div>
      </div>

      {t.description && (
        <p className="text-xs text-slate-500 leading-snug line-clamp-2" title={t.description}>
          {t.description}
        </p>
      )}

      {/* TASMA DUZELTMESI: playbook yolu tek parca bir token ve `flex-wrap` kelimenin
          ICINDEN kiramaz — kart disina tasiyordu. `CodeChip` `min-w-0 + break-all`
          tasir ve tam degeri `title`da tutar. */}
      <div className="flex flex-wrap gap-1.5 min-w-0">
        {t.playbook && <CodeChip value={t.playbook} />}
        {t.inventory && <CodeChip value={t.inventory} tone="accent" />}
        {t.labels?.map((l) => (
          <CodeChip key={l} value={l} tone="muted" />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-slate-50">
        {t.lastLaunch ? (
          <p className="text-[10px] text-slate-400 tabular-nums min-w-0 truncate" title={fmtDateTimeSeconds(t.lastLaunch)}>
            Son: {fmtDateTime(t.lastLaunch)}
          </p>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 inline-block flex-shrink-0">
            Hiç çalıştırılmadı
          </span>
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* EYLEM HIYERARSISI: "Bilgi" ikincil bir bakis, "Başlat" ise GERCEK bir
              altyapi isi tetikliyor. Ikisi de cerceveli/tint gorunumdeydi ve ayni
              agirliktaydi. Artik Bilgi sade metin, Başlat DOLU birincil. */}
          <button
            onClick={() => onInfo(t)}
            title="Template detayları"
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-colors hover:bg-[var(--bg-elevated)]"
            style={{ color: "var(--text-secondary)" }}
          >
            <InformationCircleIcon aria-hidden="true" className="w-3.5 h-3.5" />
            Bilgi
          </button>
          <button
            onClick={() => onLaunch(t)}
            className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
          >
            <PlayIcon aria-hidden="true" className="w-3 h-3" />
            Başlat
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Server panel ──────────────────────────────────────────────────────────────
interface ServerPanelProps {
  server: AwxServer;
  onLaunch: (t: AwxTemplate) => void;
  onInfo: (t: AwxTemplate) => void;
}

const PAGE_SIZE = 24;

function ServerPanel({ server, onLaunch, onInfo }: ServerPanelProps) {
  const [templates, setTemplates] = useState<AwxTemplate[] | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [page, setPage]           = useState(1);
  const fetchedRef = useRef<number | null>(null);

  useEffect(() => {
    if (fetchedRef.current === server.id) return;
    fetchedRef.current = server.id;
    setLoading(true);
    setError(null);
    ansibleApi
      .templates(server.id)
      .then((r) => {
        if (!r.ok) setError(r.message || "Şablonlar alınamadı");
        else setTemplates(r.templates);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [server.id]);

  // Arama, tüm çekilen listeyi filtreler (sayfa bazlı değil) — arama değişince sayfa 1'e dön
  useEffect(() => { setPage(1); }, [search, server.id]);

  const filtered = search
    ? (templates ?? []).filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.description.toLowerCase().includes(search.toLowerCase())
      )
    : templates ?? [];

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!server.configured) {
    return (
      <div className="py-12 text-center text-sm text-slate-400">
        {server.name} için kimlik bilgisi yapılandırılmamış.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="skeleton rounded-xl h-24" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="py-12 text-center text-sm text-red-400">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-slate-400">{filtered.length} şablon</div>
        <input
          type="search"
          placeholder="Ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-200 w-48"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">
          {search ? "Eşleşen şablon bulunamadı." : "Bu sunucuda yetkili şablon yok."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {paged.map((t) => <TemplateCard key={t.id} t={t} onLaunch={onLaunch} onInfo={onInfo} />)}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1.5 pt-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border disabled:opacity-40 transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors"
                  style={
                    p === safePage
                      ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                      : { border: "1px solid var(--border)", color: "var(--text-secondary)" }
                  }
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border disabled:opacity-40 transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const AnsiblePage: React.FC = () => {
  const [servers, setServers]           = useState<AwxServer[]>([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [activeServerId, setActiveServerId] = useState<number | null>(null);

  const [launchTemplate, setLaunchTemplate] = useState<AwxTemplate | null>(null);
  const [infoTemplate, setInfoTemplate]     = useState<{ template: AwxTemplate; serverId: number } | null>(null);
  const [activeJobId, setActiveJobId]       = useState<number | null>(null);
  const [activeJobName, setActiveJobName]   = useState<string>("");

  useEffect(() => {
    ansibleApi.servers()
      .then((r) => {
        const list = r.servers ?? [];
        setServers(list);
        if (list.length > 0) setActiveServerId(list[0].id);
      })
      .catch(() => setServers([]))
      .finally(() => setLoadingServers(false));
  }, []);

  const activeServer = servers.find((s) => s.id === activeServerId) ?? null;

  const handleLaunch = (t: AwxTemplate) => setLaunchTemplate(t);

  const handleInfo = (t: AwxTemplate) => {
    if (activeServerId !== null) setInfoTemplate({ template: t, serverId: activeServerId });
  };

  const handleLaunched = (jobId: number) => {
    setActiveJobName(launchTemplate?.name ?? `Job #${jobId}`);
    setLaunchTemplate(null);
    setActiveJobId(jobId);
  };

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="page-title">Ansible</h1>
        <p className="mt-1 text-sm font-medium" style={{ color: "var(--text-muted)" }}>AWX sunucularındaki yetkili şablon kataloğu</p>
      </div>

      {/* Server tabs */}
      {loadingServers ? (
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-9 w-28 skeleton rounded-xl" />)}
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-2xl border bg-white p-8 text-center text-sm text-slate-400">
          Yapılandırılmış AWX sunucusu bulunamadı.
          <br />
          <span className="text-xs">.env dosyasına AWX_1_URL, AWX_1_NAME, AWX_1_TOKEN ekleyin.</span>
        </div>
      ) : (
        <>
          <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: "var(--bg-elevated)" }}>
            {servers.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveServerId(s.id)}
                /* Ortak `.pf-segment` (bkz. index.css): aktif segment artik kenarlik
                   da tasiyor — eskiden yalnizca `bg-white` + golgeydi ve hangi
                   segmentin secili oldugu zor seciliyordu. */
                className={`relative pf-segment ${activeServerId === s.id ? "is-active" : ""}`}
              >
                {s.name}
                {!s.configured && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" title="Kimlik bilgisi eksik" />
                )}
              </button>
            ))}
          </div>

          {activeServer && (
            <div className="card p-5">
              <ServerPanel key={activeServer.id} server={activeServer} onLaunch={handleLaunch} onInfo={handleInfo} />
            </div>
          )}
        </>
      )}

      {/* Template Info Modal */}
      {infoTemplate && (
        <TemplateInfoModal
          serverId={infoTemplate.serverId}
          template={infoTemplate.template}
          onClose={() => setInfoTemplate(null)}
        />
      )}

      {/* Launch Modal (F-04/F-05) */}
      {launchTemplate && (
        <LaunchModal
          template={launchTemplate}
          onClose={() => setLaunchTemplate(null)}
          onLaunched={handleLaunched}
        />
      )}

      {/* Job Output Modal (F-06) */}
      {activeJobId !== null && (
        <JobOutputModal
          jobId={activeJobId}
          templateName={activeJobName}
          onClose={() => setActiveJobId(null)}
        />
      )}
    </div>
  );
};

export default AnsiblePage;
