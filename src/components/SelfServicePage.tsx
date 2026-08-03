import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { selfServiceApi, type SelfServiceGroup } from "@/api/selfServiceApi";
import { ansibleApi } from "@/api/ansibleApi";
import type { AnsibleSsItem, SurveyField, JobHistoryRecord, LaunchOptions } from "@/api/ansibleApi";
import type { SelfServiceStore, SelfServiceTab, SelfServiceSubTab, SelfServiceItem } from "@/types";
import { normalizeExternalUrl, openExternalUrl } from "@/utils/url";
import SelfServiceItemModal from "@/components/self_service/SelfServiceItemModal";
import SimpleNameModal from "@/components/self_service/SimpleNameModal";
import FieldOverridesModal from "@/components/self_service/FieldOverridesModal";
import Collapse from "@/components/common/Collapse";
import AnsibleLogTerminal from "@/components/common/AnsibleLogTerminal";
import { useJobTracker } from "@/contexts/JobTrackerContext";
import { Field, TextInput, Textarea, Select } from "@/components/ui/Form";
import {
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  DocumentTextIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CommandLineIcon,
  SparklesIcon,
  EllipsisHorizontalIcon,
  XMarkIcon,
  PlayIcon,
  ClockIcon,
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  QuestionMarkCircleIcon,
  ShieldCheckIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/react/24/outline";
import HelpModal, { type HelpSection } from "@/components/common/HelpModal";

const SELF_SERVICE_HELP_SECTIONS: HelpSection[] = [
  {
    icon: SparklesIcon,
    title: "Smart, Ansible ve Diğerleri Sekmeleri",
    body: "\"Smart\" öne çıkan/önerilen servisleri, \"Ansible\" AWX üzerinden başlatılabilen otomasyon servislerini, \"Diğerleri\" ise kurumsal servis rehberini (dokümantasyon/bağlantı kataloğu) listeler.",
  },
  {
    icon: PlayIcon,
    title: "Bir Servisi Başlatmak",
    body: "Ansible sekmesinde bir servise tıklayıp gerekli alanları (varsa) doldurduktan sonra başlat butonuna basmak, AWX üzerinde bir iş (job) tetikler; sonucu ve geçmiş çalıştırmaları aynı ekrandan takip edebilirsiniz.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Katalog Yönetimi (Ekle/Düzenle/Sil)",
    body: "Ansible servislerini AWX şablonlarından kayıt olarak eklemek/düzenlemek/silmek ve \"Diğerleri\" rehberindeki grup/servis kayıtlarını yönetmek yalnızca Admin rolüne açıktır — normal kullanıcılar yalnızca görüntüleyip başlatabilir.",
    adminOnly: true,
  },
];

const emptyStore: SelfServiceStore = { version: 1, tabs: [] };

function sortByOrder<T extends { order: number }>(arr: T[]) {
  return [...arr].sort((a, b) => (a.order || 0) - (b.order || 0));
}

type TopTab = "smart" | "ansible" | "others";

// ── Survey Form Modal ─────────────────────────────────────────────────────────

interface SurveyModalProps {
  item: AnsibleSsItem;
  onClose: () => void;
}

function SurveyModal({ item, onClose }: SurveyModalProps) {
  const [fields, setFields] = useState<SurveyField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [launchOptions, setLaunchOptions] = useState<LaunchOptions | null>(null);
  const [limit, setLimit] = useState("");
  const [forks, setForks] = useState("");
  const [jobTags, setJobTags] = useState("");
  const [skipTags, setSkipTags] = useState("");
  const [verbosity, setVerbosity] = useState("0");
  const [jobType, setJobType] = useState("run");
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const { addJob } = useJobTracker();
  // Satır-içi doğrulama (Faz 5): alan dokunulunca veya submit denenince hata gösterilir.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);

  function normalizeChoices(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);
    }
    return [];
  }

  useEffect(() => {
    ansibleApi.surveySpec(item.awxServerId, item.awxTemplateId)
      .then((r) => {
        const normalizedFields = (r.fields || []).map((f) => ({
          ...f,
          choices: normalizeChoices((f as { choices?: unknown }).choices),
        }));
        setFields(normalizedFields);
        const defaults: Record<string, string> = {};
        for (const f of normalizedFields) {
          if (f.defaultValue) defaults[f.name] = f.defaultValue;
        }
        setValues(defaults);
        if (r.launchOptions) {
          setLaunchOptions(r.launchOptions);
          setLimit(String(r.launchOptions.limit?.current ?? ""));
          setForks(r.launchOptions.forks?.current ? String(r.launchOptions.forks.current) : "");
          setJobTags(String(r.launchOptions.jobTags?.current ?? ""));
          setSkipTags(String(r.launchOptions.skipTags?.current ?? ""));
          setVerbosity(String(r.launchOptions.verbosity?.current ?? "0"));
          setJobType(String(r.launchOptions.jobType?.current || "run"));
        }
        if (!r.ok && r.message) setErr(r.message);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [item]);

  // Görünür ve dolu olması gereken zorunlu alanlar — submit'i istemci tarafında da
  // engeller (önceden yalnızca kozmetik bir `*` işareti vardı, hiçbir şeyi engellemiyordu).
  const missingRequiredLabels = fields
    .filter((f) => f.required && !(values[f.name] ?? "").trim())
    .map((f) => f.label);

  // Alan-bazlı canlı doğrulama (Faz 5): zorunlu boş / sayısal tip / choices whitelist.
  function fieldError(f: SurveyField): string | null {
    const v = String(values[f.name] ?? "").trim();
    if (f.required && !v) return `${f.label} zorunlu.`;
    if (!v) return null;
    if (f.type === "integer" && !/^-?\d+$/.test(v)) return "Tam sayı girin.";
    if (f.type === "float" && !/^-?\d*\.?\d+$/.test(v)) return "Geçerli bir sayı girin.";
    if ((f.type === "multiplechoice") && Array.isArray(f.choices) && f.choices.length > 0 && !f.choices.includes(v)) {
      return "Listeden geçerli bir seçenek seçin.";
    }
    return null;
  }
  const hasAnyFieldError = fields.some((f) => fieldError(f) !== null);

  // Canlı log takibi artık bu modala bağlı değil — job başarıyla tetiklenince
  // uygulama-geneli JobTrackerContext'e kaydedilir (bkz. OpsXWizardPage.tsx'teki
  // aynı desen). Kullanıcı modalı kapatıp başka bir sayfaya geçse bile polling
  // devam eder, JobTrackerBar sağ-alt panelinde/alt çubukta takip edilebilir.
  function trackJob(id: number) {
    addJob({
      title: item.title,
      fetchStatus: async () => {
        const r = await ansibleApi.ssJobStatus(item.awxServerId, id);
        // Parse/erken hatada AWX stdout'u BOŞ döner; hata result_traceback/job_explanation'dadır.
        // Log önceliği: stdout > traceback > explanation.
        const log = r.output || r.resultTraceback || r.jobExplanation || "";
        return { status: r.status, output: log };
      },
    });
  }

  async function launch() {
    setSubmitAttempted(true); // tüm alan hatalarını göster
    if (hasAnyFieldError) {
      setErr(missingRequiredLabels.length > 0
        ? `Zorunlu alan(lar) eksik: ${missingRequiredLabels.join(", ")}`
        : "Bazı alanlar geçersiz — lütfen kırmızı uyarıları düzeltin.");
      return;
    }
    setLaunching(true);
    setErr("");
    try {
      const extraVars: Record<string, string> = {};
      for (const f of fields) {
        const val = (values[f.name] ?? "").trim();
        if (!val) continue;
        extraVars[f.name] = val;
      }

      const r = await ansibleApi.launchSs(item.awxServerId, item.awxTemplateId, extraVars, item.title, {
        limit: launchOptions?.limit.enabled ? limit : undefined,
        forks: launchOptions?.forks.enabled && forks ? Number(forks) : undefined,
        jobTags: launchOptions?.jobTags.enabled ? jobTags : undefined,
        skipTags: launchOptions?.skipTags.enabled ? skipTags : undefined,
        verbosity: launchOptions?.verbosity.enabled ? Number(verbosity) : undefined,
        jobType: launchOptions?.jobType.enabled ? jobType : undefined,
      });
      if (r.ok) {
        setJobId(r.jobId);
        trackJob(r.jobId);
      } else {
        setErr(r.field ? `${r.field}: ${r.message}` : (r.message || "İş başlatılamadı."));
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="min-h-full flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[calc(100dvh-2rem)] my-4 animate-modal-pop">
        {/* Temiz başlık — ikon + başlık + alt-metin + kapat (süsleme Mac-bar kaldırıldı) */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent-glow)" }}>
            <PlayIcon className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-[var(--text-primary)] truncate">{item.title}</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Parametreleri doldurup işi başlatın.</p>
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors flex-shrink-0" aria-label="Kapat">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>}

          {loading && (
            <div className="flex items-center justify-center h-20">
              <div className="w-5 h-5 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && !jobId && (
            <>
              {fields.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-4">Bu template için ek parametre gerekmez.</p>
              ) : (
                <div className="space-y-4">
                  {fields.map((f) => {
                    const id = `f-${f.name}`;
                    const err = (submitAttempted || touched.has(f.name)) ? fieldError(f) : null;
                    const val = values[f.name] || "";
                    const set = (v: string) => setValues((s) => ({ ...s, [f.name]: v }));
                    const onBlur = () => setTouched((t) => new Set(t).add(f.name));
                    return (
                      <Field key={f.name} label={f.label} htmlFor={id} required={f.required} hint={f.description} error={err}>
                        {f.type === "multiplechoice" || f.type === "multiselect" ? (
                          <Select id={id} error={!!err} value={val} onChange={(e) => set(e.target.value)} onBlur={onBlur}>
                            <option value="">Seçin…</option>
                            {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                          </Select>
                        ) : f.type === "textarea" ? (
                          <Textarea id={id} rows={3} error={!!err} className="font-mono" value={val} onChange={(e) => set(e.target.value)} onBlur={onBlur} />
                        ) : (
                          <TextInput
                            id={id}
                            error={!!err}
                            type={f.type === "integer" || f.type === "float" ? "number" : (f.type === "password" ? "password" : "text")}
                            value={val}
                            onChange={(e) => set(e.target.value)}
                            onBlur={onBlur}
                            min={f.min}
                            max={f.max}
                          />
                        )}
                      </Field>
                    );
                  })}
                </div>
              )}

              {/* Built-in AWX "prompt on launch" seçenekleri — yalnızca AWX'in ilgili
                  ask_*_on_launch bayrağını gerçekten açtığı alanlar gösterilir. */}
              {launchOptions && (launchOptions.limit.enabled || launchOptions.forks.enabled || launchOptions.jobTags.enabled || launchOptions.skipTags.enabled || launchOptions.verbosity.enabled || launchOptions.jobType.enabled) && (
                <div className="space-y-4 pt-3 border-t border-[var(--border)]">
                  <p className="section-label">Çalışma Zamanı Seçenekleri</p>
                  {launchOptions.limit.enabled && (
                    <Field label="Limit" htmlFor="lo-limit" hint="host_pattern veya boş bırak">
                      <TextInput id="lo-limit" type="text" placeholder="host_pattern" value={limit} onChange={(e) => setLimit(e.target.value)} />
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {launchOptions.forks.enabled && (
                      <Field label="Forks" htmlFor="lo-forks">
                        <TextInput id="lo-forks" type="number" min={0} placeholder="varsayılan" value={forks} onChange={(e) => setForks(e.target.value)} />
                      </Field>
                    )}
                    {launchOptions.verbosity.enabled && (
                      <Field label="Verbosity" htmlFor="lo-verb">
                        <Select id="lo-verb" value={verbosity} onChange={(e) => setVerbosity(e.target.value)}>
                          {[0, 1, 2, 3, 4].map((v) => <option key={v} value={v}>{v}</option>)}
                        </Select>
                      </Field>
                    )}
                  </div>
                  {launchOptions.jobTags.enabled && (
                    <Field label="Job Tags" htmlFor="lo-jt" hint="virgülle ayır — ör: deploy,restart">
                      <TextInput id="lo-jt" type="text" placeholder="deploy,restart" value={jobTags} onChange={(e) => setJobTags(e.target.value)} />
                    </Field>
                  )}
                  {launchOptions.skipTags.enabled && (
                    <Field label="Skip Tags" htmlFor="lo-st" hint="virgülle ayır — ör: slow">
                      <TextInput id="lo-st" type="text" placeholder="slow" value={skipTags} onChange={(e) => setSkipTags(e.target.value)} />
                    </Field>
                  )}
                  {launchOptions.jobType.enabled && (
                    <Field label="Job Type" htmlFor="lo-type" required>
                      <Select id="lo-type" value={jobType} onChange={(e) => setJobType(e.target.value)}>
                        <option value="run">Run</option>
                        <option value="check">Check</option>
                      </Select>
                    </Field>
                  )}
                </div>
              )}
            </>
          )}

          {jobId && (
            <div className="space-y-1.5 animate-fade-in text-center py-4">
              <p className="text-sm font-medium text-[var(--text-primary)]">İş başlatıldı — AWX Job #{jobId}</p>
            </div>
          )}
        </div>

          <div className="px-5 py-4 border-t border-[var(--border)] flex items-center justify-between gap-3 flex-shrink-0">
            <button onClick={onClose} className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
              {jobId ? "Kapat" : "İptal"}
            </button>
            {!jobId && (
              <button
                onClick={launch}
                disabled={launching || loading || hasAnyFieldError}
                title={
                  missingRequiredLabels.length > 0
                    ? `Zorunlu alan(lar) eksik: ${missingRequiredLabels.join(", ")}`
                    : hasAnyFieldError ? "Bazı alanlar geçersiz — kırmızı uyarıları düzeltin." : undefined
                }
                className="btn-primary px-5 py-2 text-sm flex items-center gap-2"
              >
                {launching ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PlayIcon className="w-4 h-4" />}
                İş Başlat
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── History Modal ─────────────────────────────────────────────────────────────

function HistoryModal({ onClose }: { onClose: () => void }) {
  const [history, setHistory] = useState<JobHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // Geçmişteki bir job'a tıklayınca logu aynı modalda gösterilir (master-detail).
  const [selected, setSelected] = useState<JobHistoryRecord | null>(null);
  const [logOutput, setLogOutput] = useState("");
  const [logStatus, setLogStatus] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logErr, setLogErr] = useState("");

  useEffect(() => {
    ansibleApi.history(30).then((r) => setHistory(r.history || [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected || !selected.job_id) return;
    let alive = true;
    setLogLoading(true);
    setLogErr("");
    setLogOutput("");
    ansibleApi.ssJobStatus(selected.awx_server_id, selected.job_id)
      .then((r) => {
        if (!alive) return;
        setLogStatus(r.status || selected.status);
        setLogOutput(r.output || r.resultTraceback || r.jobExplanation || "");
      })
      .catch((e) => { if (alive) setLogErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLogLoading(false); });
    return () => { alive = false; };
  }, [selected]);

  const statusBadge: Record<string, string> = {
    successful: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    error: "bg-red-100 text-red-700",
    canceled: "bg-amber-100 text-amber-700",
    running: "bg-blue-100 text-blue-700",
    pending: "bg-gray-100 text-gray-600",
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm overflow-y-auto p-4">
      <div className="min-h-full flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[calc(100dvh-2rem)] my-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            {selected ? (
              <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-[#0066CC] hover:text-[#3a75e0]">
                <ArrowLeftIcon className="w-4 h-4" /> Geçmiş
              </button>
            ) : (
              <><ClockIcon className="w-5 h-5 text-[#0066CC]" /> İş Geçmişi (Son 30 Gün)</>
            )}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            // ── Detay: seçilen geçmiş job'ın logu (canlı terminal) ──
            <div className="p-5 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selected.template_name}</p>
                  <p className="text-xs text-gray-500">{selected.username} · {new Date(selected.started_at).toLocaleString("tr-TR")} · job #{selected.job_id}</p>
                </div>
                {/* CANLI durum (kayıttaki stale 'pending' değil) — AWX'ten çekilen gerçek durum. */}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[logStatus || selected.status] || "bg-gray-100 text-gray-600"}`}>{logStatus || selected.status}</span>
              </div>
              {logErr && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{logErr}</div>}
              {logLoading ? (
                <div className="flex items-center justify-center h-20">
                  <div className="w-5 h-5 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <AnsibleLogTerminal
                  output={logOutput}
                  status={logStatus || selected.status}
                  title={`${selected.template_name} — job #${selected.job_id}`}
                  placeholder={
                    ["pending", "waiting", "running", ""].includes(logStatus)
                      ? "Job hâlâ çalışıyor — konsol çıktısı henüz oluşmadı."
                      : "Bu job için AWX'te log/traceback bulunamadı (job eskimiş/temizlenmiş olabilir)."
                  }
                />
              )}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-20">
              <div className="w-5 h-5 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">Son 30 günde iş yok.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Template</th>
                  <th className="px-4 py-3 text-left font-semibold">Kullanıcı</th>
                  <th className="px-4 py-3 text-left font-semibold">Durum</th>
                  <th className="px-4 py-3 text-left font-semibold">Tarih</th>
                  <th className="px-4 py-3 text-left font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((h) => (
                  <tr
                    key={h.id}
                    onClick={() => h.job_id && setSelected(h)}
                    className={`hover:bg-blue-50/40 transition-colors ${h.job_id ? "cursor-pointer" : "opacity-70"}`}
                    title={h.job_id ? "Logu görüntüle" : "Bu kayıt için job ID yok"}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{h.template_name}</td>
                    <td className="px-4 py-3 text-gray-500">{h.username}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[h.status] || "bg-gray-100 text-gray-600"}`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(h.started_at).toLocaleString("tr-TR")}</td>
                    <td className="px-4 py-3 text-right">
                      {h.job_id ? <span className="text-xs text-[#0066CC] font-medium">Log →</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Ansible Tab ───────────────────────────────────────────────────────────────

function AnsibleSection({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<AnsibleSsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchItem, setLaunchItem] = useState<AnsibleSsItem | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [addForm, setAddForm] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "", awxServerId: 1, awxTemplateId: 0 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [fieldsItem, setFieldsItem] = useState<AnsibleSsItem | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    ansibleApi.ssItems().then((r) => setItems(r.items || [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function deleteItem(id: string) {
    if (!confirm("Bu servisi kaldır?")) return;
    await ansibleApi.deleteSsItem(id);
    reload();
  }

  async function saveItem() {
    if (!draft.title.trim() || !draft.awxTemplateId) return;
    setSaving(true);
    setSaveError("");
    try {
      // Backend artık AWX'e karşı GERÇEKTEN doğruluyor (var mı, allowlist'te mi,
      // aynı sunucu+template zaten kayıtlı mı) — bu yüzden hata burada mutlaka
      // gösterilmeli, aksi halde admin sessizce geçersiz bir kayıt oluşturduğunu sanır.
      const r = await ansibleApi.saveSsItem({ ...draft, enabled: true, order: items.length + 1 });
      if (!r.ok) {
        setSaveError(r.message || "Kaydedilemedi.");
        return;
      }
      setDraft({ title: "", description: "", awxServerId: 1, awxTemplateId: 0 });
      setAddForm(false);
      reload();
      // Template otomatik çekilip kaydedildiği için, kullanıcı launch ekranında
      // göreceği TÜM alanlarla eksiksiz karşılaşsın diye alan incelemesi/gizleme
      // kararı SONRADAN erişilen ayrı bir aksiyon değil, kayıt anının doğal bir
      // devamı olarak HEMEN açılır.
      if (r.item) setFieldsItem(r.item);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-32"><div className="w-5 h-5 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" /></div>;

  // enabled=false yalnizca NORMAL kullanicilardan gizlenir (Admin > Self Service'teki
  // gorunurluk anahtari) — admin her zaman TUM kayitlari gorur ve calistirabilir,
  // aksi halde bir servisi kapatan admin onu bir daha o ekrandan yonetemezdi.
  const visibleItems = isAdmin ? items : items.filter((i) => i.enabled);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[--text-muted]">AWX üzerinden job başlatın</p>
        <div className="flex gap-2">
          <button onClick={() => setShowHistory(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 transition">
            <ClockIcon className="w-4 h-4" />
            Geçmiş
          </button>
          {isAdmin && (
            <button onClick={() => { setAddForm(!addForm); setSaveError(""); }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#060C17] text-white rounded-xl hover:bg-gray-800 transition">
              <PlusIcon className="w-4 h-4" />
              Servis Ekle
            </button>
          )}
        </div>
      </div>

      {isAdmin && addForm && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3 shadow-[var(--shadow-md)]">
          <h3 className="text-sm font-bold text-gray-900">Yeni Ansible Servisi</h3>
          {saveError && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{saveError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-500 block mb-1">Servis Adı</label>
              <input className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0066CC]"
                value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Ör: Sunucu Yeniden Başlatma" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-500 block mb-1">Açıklama</label>
              <input className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0066CC]"
                value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Kısa açıklama" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">AWX Sunucu ID</label>
              <input type="number" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0066CC]"
                value={draft.awxServerId} onChange={(e) => setDraft((d) => ({ ...d, awxServerId: Number(e.target.value) }))} min={1} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Template ID</label>
              <input type="number" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0066CC]"
                value={draft.awxTemplateId || ""} onChange={(e) => setDraft((d) => ({ ...d, awxTemplateId: Number(e.target.value) }))} placeholder="AWX template ID" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAddForm(false); setSaveError(""); }} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">İptal</button>
            <button onClick={saveItem} disabled={saving || !draft.title.trim() || !draft.awxTemplateId} className="btn-primary px-4 py-1.5 text-sm">
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </div>
      )}

      {visibleItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 flex items-center justify-center h-40">
          <p className="text-sm text-gray-400">{isAdmin ? "Henüz Ansible servisi yok. Servis Ekle butonunu kullanın." : "Henüz Ansible servisi tanımlanmamış."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleItems.sort((a, b) => a.order - b.order).map((item) => (
            <div key={item.id} className={`bg-white rounded-2xl border p-5 shadow-[var(--shadow-sm)] card-hover group relative ${item.enabled ? "border-gray-100" : "border-amber-200"}`}>
              <div className="mb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-gray-900 text-base">{item.title}</h3>
                    {/* enabled=false SADECE normal kullanicilardan gizler — admin her zaman
                        gorur ve calistirabilir; bu rozet admin'e bunu hatirlatir. */}
                    {isAdmin && !item.enabled && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                        kullanıcılara kapalı
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                      <button onClick={() => setFieldsItem(item)} title="Alanları Yönet" className="p-1 text-gray-300 hover:text-[#0066CC] rounded">
                        <AdjustmentsHorizontalIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteItem(item.id)} title="Sil" className="p-1 text-gray-300 hover:text-red-500 rounded">
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                {item.description && <p className="text-sm text-gray-500 mt-1">{item.description}</p>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Template #{item.awxTemplateId} · Server {item.awxServerId}</span>
                <button
                  onClick={() => setLaunchItem(item)}
                  className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5"
                >
                  <PlayIcon className="w-4 h-4" />
                  Başlat
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {launchItem && <SurveyModal item={launchItem} onClose={() => setLaunchItem(null)} />}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {fieldsItem && <FieldOverridesModal item={fieldsItem} onClose={() => setFieldsItem(null)} />}
    </div>
  );
}

// ── Smart / Others Item Detail ────────────────────────────────────────────────

function GuideItemDetail({ item, selectedTab, selectedSub, isAdmin, onEdit, onDelete }: {
  item: SelfServiceItem;
  selectedTab?: SelfServiceTab;
  selectedSub?: SelfServiceSubTab;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const normalizedGo = normalizeExternalUrl(item.goUrl || "");

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-[var(--shadow-md)]">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 bg-gradient-to-r from-[#0066CC]/[0.03] to-transparent">
        <div className="min-w-0">
          <h2 className="font-black text-gray-900 text-xl truncate">{item.title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {selectedTab?.name}{selectedSub ? ` › ${selectedSub.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => openExternalUrl(normalizedGo)}
            disabled={!normalizedGo}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            Kayıt Aç
          </button>
          {isAdmin && (
            <>
              <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-[#0066CC] border border-gray-200 rounded-xl transition">
                <PencilIcon className="w-4 h-4" />
              </button>
              <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 border border-gray-200 rounded-xl transition">
                <TrashIcon className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {item.info && (
          <div className="bg-[#0066CC]/[0.06] border border-[#0066CC]/20 rounded-xl p-4">
            <p className="text-[11px] font-bold text-[#0066CC] uppercase tracking-widest mb-2">Amaç / Açıklama</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{item.info}</p>
          </div>
        )}

        {item.details && (
          <div className="border border-gray-100 rounded-xl p-4">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Nasıl Kullanılır / Neden</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{item.details}</p>
          </div>
        )}

        {item.requestExample && (
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Örnek Parametreler</span>
              <button onClick={() => navigator.clipboard.writeText(item.requestExample)} className="text-xs text-gray-400 hover:text-gray-600 transition">
                Kopyala
              </button>
            </div>
            <pre className="text-xs p-4 overflow-auto text-gray-800 bg-white leading-relaxed font-mono">
              <code>{item.requestExample}</code>
            </pre>
          </div>
        )}

        {(item.sample?.type === "text" || item.sample?.type === "link") && item.sample.value && (
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Örnek Kayıt</span>
            </div>
            <div className="p-4">
              {item.sample.type === "link" ? (
                <button className="text-sm text-[#0066CC] hover:underline break-all" onClick={() => openExternalUrl(item.sample.value)}>
                  {item.sample.value}
                </button>
              ) : (
                <pre className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto text-gray-800 font-mono">
                  <code>{item.sample.value}</code>
                </pre>
              )}
            </div>
          </div>
        )}

        {item.extra && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-widest mb-2">⚠ Dikkat / Notlar</p>
            <p className="text-sm text-amber-800 whitespace-pre-wrap leading-relaxed">{item.extra}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Smart / Others Navigation + Detail ───────────────────────────────────────

function GuideSection({
  section,
  store,
  isAdmin,
  onStoreChange,
}: {
  section: "smart" | "others";
  store: SelfServiceStore;
  isAdmin: boolean;
  onStoreChange: (next: SelfServiceStore) => void;
}) {
  const [params, setParams] = useSearchParams();
  const [tabId, setTabId] = useState(params.get("tab") || "");
  const [subTabId, setSubTabId] = useState(params.get("subtab") || "");
  const [itemId, setItemId] = useState(params.get("item") || "");
  const [openTabs, setOpenTabs] = useState<Set<string>>(new Set());
  const [openSubTabs, setOpenSubTabs] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");

  const [nameModal, setNameModal] = useState<{ open: boolean; kind: "tab" | "subtab"; mode: "create" | "edit"; title: string; value: string; }>({ open: false, kind: "tab", mode: "create", title: "", value: "" });
  const [itemModal, setItemModal] = useState<{ open: boolean; mode: "create" | "edit"; draft: SelfServiceItem; }>({
    open: false, mode: "create",
    draft: { id: "", title: "", order: 0, tabId: "", subTabId: "", info: "", goUrl: "", requestExample: "", details: "", sample: { type: "link", value: "" }, extra: "" },
  });

  const tabs = useMemo(() => sortByOrder(store.tabs.filter((t) => (t.section || "smart") === section)), [store.tabs, section]);

  const selectedTab = useMemo(() => tabs.find((t) => t.id === tabId) || tabs[0], [tabs, tabId]);
  const subTabs = useMemo(() => sortByOrder(selectedTab?.subTabs || []), [selectedTab?.subTabs]);
  const selectedSub = useMemo(() => subTabs.find((s) => s.id === subTabId) || subTabs[0], [subTabs, subTabId]);
  const items = useMemo(() => sortByOrder(selectedSub?.items || []), [selectedSub?.items]);
  const selectedItem = useMemo(() => items.find((it) => it.id === itemId) || items[0], [items, itemId]);

  function maxOrder<T extends { order: number }>(list: T[]) {
    return list.reduce((m, x) => Math.max(m, x.order || 0), 0);
  }

  const applyStore = (next: SelfServiceStore, keep?: { tabId?: string; subTabId?: string; itemId?: string }) => {
    onStoreChange(next);
    const kt = keep?.tabId || tabId;
    const ks = keep?.subTabId || subTabId;
    const ki = keep?.itemId || itemId;
    const t = next.tabs.find((x) => x.id === kt) || sortByOrder(next.tabs.filter((x) => (x.section || "smart") === section))[0];
    setTabId(t?.id || "");
    const s = t?.subTabs.find((x) => x.id === ks) || sortByOrder(t?.subTabs || [])[0];
    setSubTabId(s?.id || "");
    const it = s?.items.find((x) => x.id === ki) || sortByOrder(s?.items || [])[0];
    setItemId(it?.id || "");
  };

  const moveUpDown = async (kind: "tab" | "subTab" | "item", id: string, dir: -1 | 1) => {
    try {
      if (kind === "tab") {
        const list = [...tabs]; const idx = list.findIndex((x) => x.id === id); const sw = idx + dir;
        if (sw < 0 || sw >= list.length) return;
        [list[idx], list[sw]] = [list[sw], list[idx]];
        const r = await selfServiceApi.reorder({ kind: "tab", orderedIds: list.map((x) => x.id) });
        applyStore(r.store, { tabId });
      } else if (kind === "subTab" && selectedTab) {
        const list = [...subTabs]; const idx = list.findIndex((x) => x.id === id); const sw = idx + dir;
        if (sw < 0 || sw >= list.length) return;
        [list[idx], list[sw]] = [list[sw], list[idx]];
        const r = await selfServiceApi.reorder({ kind: "subTab", scope: { tabId: selectedTab.id }, orderedIds: list.map((x) => x.id) });
        applyStore(r.store, { tabId: selectedTab.id, subTabId });
      } else if (kind === "item" && selectedTab && selectedSub) {
        const list = [...items]; const idx = list.findIndex((x) => x.id === id); const sw = idx + dir;
        if (sw < 0 || sw >= list.length) return;
        [list[idx], list[sw]] = [list[sw], list[idx]];
        const r = await selfServiceApi.reorder({ kind: "item", scope: { tabId: selectedTab.id, subTabId: selectedSub.id }, orderedIds: list.map((x) => x.id) });
        applyStore(r.store, { tabId: selectedTab.id, subTabId: selectedSub.id, itemId });
      }
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const saveNameModal = async (name: string) => {
    try {
      setErr("");
      if (nameModal.kind === "tab") {
        if (nameModal.mode === "create") {
          const r = await selfServiceApi.createTab({ name, section });
          applyStore(r.store, { tabId: r.tab.id });
          setOpenTabs((s) => new Set([...s, r.tab.id]));
        } else if (selectedTab) {
          const r = await selfServiceApi.updateTab(selectedTab.id, { name });
          applyStore(r.store, { tabId: selectedTab.id });
        }
      } else if (selectedTab) {
        if (nameModal.mode === "create") {
          const r = await selfServiceApi.createSubTab(selectedTab.id, { name });
          applyStore(r.store, { tabId: selectedTab.id, subTabId: r.subTab.id });
          setOpenSubTabs((s) => new Set([...s, r.subTab.id]));
        } else if (selectedSub) {
          const r = await selfServiceApi.updateSubTab(selectedTab.id, selectedSub.id, { name });
          applyStore(r.store, { tabId: selectedTab.id, subTabId: selectedSub.id });
        }
      }
      setNameModal((m) => ({ ...m, open: false }));
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const deleteTab = async () => {
    if (!isAdmin || !selectedTab) return;
    if (!confirm(`"${selectedTab.name}" tabını sil?`)) return;
    const r = await selfServiceApi.deleteTab(selectedTab.id).catch((e) => { setErr(e.message); return null; });
    if (r) applyStore(r.store);
  };

  const deleteSubTab = async () => {
    if (!isAdmin || !selectedTab || !selectedSub) return;
    if (!confirm(`"${selectedSub.name}" alt-tabını sil?`)) return;
    const r = await selfServiceApi.deleteSubTab(selectedTab.id, selectedSub.id).catch((e) => { setErr(e.message); return null; });
    if (r) applyStore(r.store, { tabId: selectedTab.id });
  };

  const saveItem = async (draft: SelfServiceItem) => {
    if (!isAdmin || !selectedTab || !selectedSub) return;
    const payload = { title: draft.title, info: draft.info, goUrl: draft.goUrl, requestExample: draft.requestExample, details: draft.details, sample: draft.sample, extra: draft.extra };
    try {
      if (itemModal.mode === "create") {
        const r = await selfServiceApi.createItem(selectedTab.id, selectedSub.id, payload);
        applyStore(r.store, { tabId: selectedTab.id, subTabId: selectedSub.id, itemId: r.item.id });
      } else {
        const r = await selfServiceApi.updateItem(selectedTab.id, selectedSub.id, draft.id, payload);
        applyStore(r.store, { tabId: selectedTab.id, subTabId: selectedSub.id, itemId: r.item.id });
      }
      setItemModal((m) => ({ ...m, open: false }));
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const deleteItem = async () => {
    if (!isAdmin || !selectedTab || !selectedSub || !selectedItem) return;
    if (!confirm(`"${selectedItem.title}" öğesini sil?`)) return;
    const r = await selfServiceApi.deleteItem(selectedTab.id, selectedSub.id, selectedItem.id).catch((e) => { setErr(e.message); return null; });
    if (r) applyStore(r.store, { tabId: selectedTab.id, subTabId: selectedSub.id });
  };

  const sectionLabel = section === "smart" ? "Servis" : "Diğer";

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setNameModal({ open: true, kind: "tab", mode: "create", title: `Yeni ${sectionLabel} Grubu`, value: "" })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#060C17] text-white rounded-xl hover:bg-gray-800 transition">
            <PlusIcon className="w-4 h-4" /> Grup Ekle
          </button>
          {selectedTab && (
            <button onClick={() => setNameModal({ open: true, kind: "subtab", mode: "create", title: "Yeni Alt-Grup", value: "" })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-700 transition">
              <PlusIcon className="w-4 h-4" /> Alt-Grup Ekle
            </button>
          )}
          {selectedTab && selectedSub && (
            <button
              onClick={() => setItemModal({ open: true, mode: "create", draft: { id: "", title: "", order: maxOrder(items) + 1, tabId: selectedTab.id, subTabId: selectedSub.id, info: "", goUrl: "", requestExample: "", details: "", sample: { type: "link", value: "" }, extra: "" } })}
              className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm">
              <PlusIcon className="w-4 h-4" /> Servis Ekle
            </button>
          )}
        </div>
      )}

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left nav */}
        <div className="lg:col-span-4 space-y-2">
          {tabs.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 px-6 py-10 text-center text-sm text-gray-400">
              {isAdmin ? `${sectionLabel} grubu yok. Ekle butonunu kullanın.` : "Henüz içerik tanımlanmamış."}
            </div>
          )}
          {tabs.map((tab) => {
            const tabOpen = openTabs.has(tab.id);
            const sortedSubs = sortByOrder(tab.subTabs);
            return (
              <div key={tab.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-[var(--shadow-sm)]">
                <div className="flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors">
                  <button className="flex items-center gap-2 flex-1 text-left min-w-0" onClick={() => setOpenTabs((s) => { const n = new Set(s); n.has(tab.id) ? n.delete(tab.id) : n.add(tab.id); return n; })}>
                    <ChevronDownIcon className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${tabOpen ? "rotate-0" : "-rotate-90"}`} />
                    {tabOpen ? <FolderOpenIcon className="w-4 h-4 text-[#0066CC] flex-shrink-0" /> : <FolderIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                    <span className={`text-sm font-semibold truncate ${tabOpen ? "text-gray-900" : "text-gray-600"}`}>{tab.name}</span>
                    <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{sortedSubs.length}</span>
                  </button>
                  {isAdmin && (
                    <div className="flex gap-0.5 flex-shrink-0">
                      <button onClick={() => moveUpDown("tab", tab.id, -1)} className="p-1 text-gray-300 hover:text-gray-600 rounded"><ArrowUpIcon className="w-3 h-3" /></button>
                      <button onClick={() => moveUpDown("tab", tab.id, 1)} className="p-1 text-gray-300 hover:text-gray-600 rounded"><ArrowDownIcon className="w-3 h-3" /></button>
                      <button onClick={() => setNameModal({ open: true, kind: "tab", mode: "edit", title: "Grubu Düzenle", value: tab.name })} className="p-1 text-gray-300 hover:text-[#0066CC] rounded"><PencilIcon className="w-3 h-3" /></button>
                      <button onClick={deleteTab} className="p-1 text-gray-300 hover:text-red-500 rounded"><TrashIcon className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
                <Collapse open={tabOpen}>
                  <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 space-y-1">
                    {sortedSubs.map((sub) => {
                      const subOpen = openSubTabs.has(sub.id);
                      const sortedItems = sortByOrder(sub.items);
                      if (!isAdmin && sortedItems.length === 0) return null;
                      return (
                        <div key={sub.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors">
                            <button className="flex items-center gap-2 flex-1 text-left min-w-0" onClick={() => setOpenSubTabs((s) => { const n = new Set(s); n.has(sub.id) ? n.delete(sub.id) : n.add(sub.id); return n; })}>
                              <ChevronDownIcon className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${subOpen ? "rotate-0" : "-rotate-90"}`} />
                              <span className={`text-sm truncate ${subOpen ? "font-medium text-gray-800" : "text-gray-600"}`}>{sub.name}</span>
                              <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{sortedItems.length}</span>
                            </button>
                            {isAdmin && (
                              <div className="flex gap-0.5 flex-shrink-0">
                                <button onClick={() => moveUpDown("subTab", sub.id, -1)} className="p-1 text-gray-300 hover:text-gray-600 rounded"><ArrowUpIcon className="w-2.5 h-2.5" /></button>
                                <button onClick={() => moveUpDown("subTab", sub.id, 1)} className="p-1 text-gray-300 hover:text-gray-600 rounded"><ArrowDownIcon className="w-2.5 h-2.5" /></button>
                                <button onClick={() => setNameModal({ open: true, kind: "subtab", mode: "edit", title: "Alt-Grubu Düzenle", value: sub.name })} className="p-1 text-gray-300 hover:text-[#0066CC] rounded"><PencilIcon className="w-2.5 h-2.5" /></button>
                                <button onClick={deleteSubTab} className="p-1 text-gray-300 hover:text-red-500 rounded"><TrashIcon className="w-2.5 h-2.5" /></button>
                              </div>
                            )}
                          </div>
                          <Collapse open={subOpen}>
                            <div className="border-t border-gray-100 py-1">
                              {sortedItems.map((it) => {
                                const active = it.id === selectedItem?.id;
                                return (
                                  <div key={it.id} className={`flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors group ${active ? "bg-[#0066CC]/[0.06]" : "hover:bg-gray-50"}`}
                                    onClick={() => { setTabId(tab.id); setSubTabId(sub.id); setItemId(it.id); setOpenTabs((s) => new Set([...s, tab.id])); setOpenSubTabs((s) => new Set([...s, sub.id])); }}>
                                    <DocumentTextIcon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? "text-[#0066CC]" : "text-gray-300"}`} />
                                    <span className={`flex-1 text-sm truncate ${active ? "text-[#0066CC] font-medium" : "text-gray-700"}`}>{it.title}</span>
                                    {isAdmin && (
                                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                                        <button onClick={(e) => { e.stopPropagation(); moveUpDown("item", it.id, -1); }} className="p-0.5 text-gray-300 hover:text-gray-600 rounded"><ArrowUpIcon className="w-2.5 h-2.5" /></button>
                                        <button onClick={(e) => { e.stopPropagation(); moveUpDown("item", it.id, 1); }} className="p-0.5 text-gray-300 hover:text-gray-600 rounded"><ArrowDownIcon className="w-2.5 h-2.5" /></button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {sortedItems.length === 0 && isAdmin && <p className="px-4 py-2 text-xs italic text-gray-400">İçerik yok — sağdan öğe ekleyin.</p>}
                            </div>
                          </Collapse>
                        </div>
                      );
                    })}
                    {sortedSubs.length === 0 && <p className="text-xs text-gray-400 px-2 py-1">Alt-grup yok.</p>}
                  </div>
                </Collapse>
              </div>
            );
          })}
        </div>

        {/* Right detail */}
        <div className="lg:col-span-8">
          {!selectedItem ? (
            <div className="bg-white rounded-2xl border border-gray-100 flex items-center justify-center h-48">
              <p className="text-sm text-gray-400">Soldaki listeden bir servis seçin.</p>
            </div>
          ) : (
            <GuideItemDetail
              item={selectedItem}
              selectedTab={selectedTab}
              selectedSub={selectedSub}
              isAdmin={isAdmin}
              onEdit={() => setItemModal({ open: true, mode: "edit", draft: { ...selectedItem } })}
              onDelete={deleteItem}
            />
          )}
        </div>
      </div>

      <SimpleNameModal open={nameModal.open} title={nameModal.title} initialValue={nameModal.value} onClose={() => setNameModal((m) => ({ ...m, open: false }))} onSave={saveNameModal} />
      <SelfServiceItemModal open={itemModal.open} mode={itemModal.mode} draft={itemModal.draft} onClose={() => setItemModal((m) => ({ ...m, open: false }))} onSave={saveItem} />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SelfServicePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "Admin";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [store, setStore] = useState<SelfServiceStore>(emptyStore);
  const [groups, setGroups] = useState<SelfServiceGroup[]>([]);
  const [activeTop, setActiveTop] = useState<TopTab>("ansible");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const r = await selfServiceApi.get();
        if (alive) {
          setStore(r.store);
          setGroups(r.groups || []);
          if (r.groups?.length && !r.groups.some((g) => g.groupKey === activeTop)) {
            setActiveTop(r.groups[0].groupKey);
          }
        }
      } catch (e: unknown) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // actions.md #5 (Bolum D) — eskiden burada sabit bir TOP_TABS dizisi vardi (statik frontend
  // kodu). Artik grup listesi (etiket/ikon/sira/aktiflik) DB'den (/api/selfservice yaniti)
  // gelir; yalnizca ikon-adi -> component eslemesi (GROUP_ICONS) frontend'de sabit kalir —
  // cunku React component referanslarini DB'de saklamak mumkun degildir.
  const GROUP_ICONS: Record<string, React.ElementType> = {
    SparklesIcon, CommandLineIcon, EllipsisHorizontalIcon,
  };
  const TOP_TABS: { id: TopTab; label: string; icon: React.ElementType }[] = groups.length
    ? groups.map((g) => ({ id: g.groupKey, label: g.label, icon: GROUP_ICONS[g.icon] || SparklesIcon }))
    : [
        { id: "smart",   label: "Smart",     icon: SparklesIcon },
        { id: "ansible", label: "Ansible",   icon: CommandLineIcon },
        { id: "others",  label: "Diğerleri", icon: EllipsisHorizontalIcon },
      ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-[#0066CC] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-spring-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Self Service</h1>
          <p className="mt-1 text-sm font-medium" style={{ color: "var(--text-muted)" }}>Servis kataloğu, Ansible otomasyonu ve kurumsal servisler</p>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex-shrink-0"
        >
          <QuestionMarkCircleIcon className="w-4 h-4" />
          Yardım
        </button>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{err}</div>}

      {/* Top 3 fixed tabs */}
      <div className="flex items-center gap-1 bg-[#EEF2FF] p-1 rounded-xl w-fit">
        {TOP_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTop(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              activeTop === id
                ? "bg-white text-[#0066CC] shadow-[var(--shadow-sm)]"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTop === "smart" && (
        <GuideSection section="smart" store={store} isAdmin={isAdmin} onStoreChange={setStore} />
      )}
      {activeTop === "ansible" && (
        <AnsibleSection isAdmin={isAdmin} />
      )}
      {activeTop === "others" && (
        <GuideSection section="others" store={store} isAdmin={isAdmin} onStoreChange={setStore} />
      )}

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title="Self Service — Nasıl Kullanılır?"
        sections={SELF_SERVICE_HELP_SECTIONS}
      />
    </div>
  );
}
