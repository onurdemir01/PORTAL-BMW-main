// src/components/admin/tabs/TestScenariosTab.tsx — Admin > Test Senaryoları.
//
// Her Self Service otomasyonu için, o otomasyonun KENDİ survey alanlarından (choices/
// default/required) mekanik olarak 3-4 senaryo üretilir (bkz. src/utils/ssTestScenarios.ts)
// — gerçek bir prod değeri (doğru host grubu, doğru uygulama adı vb.) UYDURULMAZ, çünkü
// bu bilgi portaldan bilinemez ve yanlış tahmin gerçek sunuculara yanlış komut gönderme
// riski taşır.
//
// "Doğrula" HER ZAMAN güvenlidir: hiçbir job/Smart bileti tetiklemez, sadece sunucunun
// gerçek launch yolunun (survey/custom-survey doğrulaması + AWX template-preflight)
// bu senaryoyu kabul edip etmeyeceğini gösterir.
//
// "Gerçekten Çalıştır" GERÇEK bir AWX job'ı (ya da Smart onayı açıksa gerçek bir Smart
// talebi) oluşturur — yıkıcı otomasyonlar (disk temizleme, uygulama durdurma/başlatma,
// pod restart vb.) için bu GERÇEKTEN prod'a dokunur. Bu yüzden ayrı bir onay adımı olmadan
// asla tetiklenmez; admin her seferinde ne çalışacağını (hedef + çözümlenmiş extra_vars)
// görüp açıkça onaylamalı.
import React, { useEffect, useState } from "react";
import {
  BeakerIcon, ChevronDownIcon, CheckCircleIcon, XCircleIcon,
  PlayIcon, ShieldCheckIcon, ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { ansibleApi, type AnsibleSsItem, type SurveyField } from "@/api/ansibleApi";
import { generateScenarios, type SsTestScenario } from "@/utils/ssTestScenarios";
import { toast } from "@/hooks/useToast";
import Collapse from "@/components/common/Collapse";
import { useJobTracker } from "@/contexts/JobTrackerContext";

type ScenarioState = {
  status: "idle" | "validating" | "valid" | "invalid" | "running" | "ran" | "run-error";
  message?: string;
  resolvedExtraVars?: Record<string, string>;
  jobId?: number;
  ticketId?: number;
};

function keyOf(itemId: string, scenarioName: string) {
  return `${itemId}::${scenarioName}`;
}

export default function TestScenariosTab() {
  const [items, setItems] = useState<AnsibleSsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [surveyCache, setSurveyCache] = useState<Record<string, { fields: SurveyField[]; surveyEnabled: boolean } | "loading" | "error">>({});
  const [scenarioStates, setScenarioStates] = useState<Record<string, ScenarioState>>({});
  // Otomatik üretilen değerler çoğunlukla boş çıkar (AWX survey alanlarının çoğunda gerçek
  // bir varsayılan yoktur — host adı, uygulama adı gibi alanlar normalde kullanıcı tarafından
  // elle girilir). Bu yüzden değerler SALT-OKUNUR değil: admin burada gerçek bir örnek değeri
  // (ör. gerçek bir host adı) yazıp Doğrula/Gerçekten Çalıştır ile deneyebilir.
  const [editedVars, setEditedVars] = useState<Record<string, Record<string, string>>>({});
  const { addJob } = useJobTracker();

  useEffect(() => {
    ansibleApi.ssItems().then((r) => {
      if (r.ok) setItems(r.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function toggleExpand(item: AnsibleSsItem) {
    const willOpen = !expanded[item.id];
    setExpanded((prev) => ({ ...prev, [item.id]: willOpen }));
    if (willOpen && !surveyCache[item.id]) {
      setSurveyCache((prev) => ({ ...prev, [item.id]: "loading" }));
      try {
        const r = await ansibleApi.surveySpecAdmin(item.awxServerId, item.awxTemplateId);
        if (r.ok) {
          setSurveyCache((prev) => ({ ...prev, [item.id]: { fields: r.fields, surveyEnabled: r.surveyEnabled } }));
        } else {
          setSurveyCache((prev) => ({ ...prev, [item.id]: "error" }));
        }
      } catch {
        setSurveyCache((prev) => ({ ...prev, [item.id]: "error" }));
      }
    }
  }

  function setState(item: AnsibleSsItem, scenario: SsTestScenario, patch: Partial<ScenarioState>) {
    setScenarioStates((prev) => ({
      ...prev,
      [keyOf(item.id, scenario.name)]: { ...(prev[keyOf(item.id, scenario.name)] || { status: "idle" }), ...patch },
    }));
  }

  // Bu senaryo için o an ekranda gösterilecek değerler: admin bir alanı elle değiştirdiyse
  // o değer, aksi halde otomatik üretilen değer.
  function currentVars(item: AnsibleSsItem, scenario: SsTestScenario): Record<string, string> {
    return { ...scenario.extraVars, ...(editedVars[keyOf(item.id, scenario.name)] || {}) };
  }

  function editVar(item: AnsibleSsItem, scenario: SsTestScenario, field: string, value: string) {
    const k = keyOf(item.id, scenario.name);
    setEditedVars((prev) => ({ ...prev, [k]: { ...(prev[k] || {}), [field]: value } }));
  }

  async function validate(item: AnsibleSsItem, scenario: SsTestScenario) {
    setState(item, scenario, { status: "validating", message: undefined });
    try {
      const r = await ansibleApi.ssTestValidate(item.awxServerId, item.awxTemplateId, currentVars(item, scenario), item.title);
      if (r.ok && r.valid) {
        setState(item, scenario, { status: "valid", resolvedExtraVars: r.resolvedExtraVars, message: undefined });
      } else {
        setState(item, scenario, { status: "invalid", message: r.message || "Geçersiz." });
      }
    } catch (e: unknown) {
      setState(item, scenario, { status: "invalid", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function runForReal(item: AnsibleSsItem, scenario: SsTestScenario) {
    const vars = currentVars(item, scenario);
    const varsPreview = Object.entries(vars).map(([k, v]) => `${k}=${v || "(boş)"}`).join("\n") || "(parametre yok)";
    const ok = window.confirm(
      `"${item.title}" GERÇEKTEN tetiklenecek (senaryo: ${scenario.name}).\n\n` +
      `Bu gerçek bir AWX job'ı başlatır — geri alınamaz olabilir. Devam edilsin mi?\n\n${varsPreview}`
    );
    if (!ok) return;

    setState(item, scenario, { status: "running", message: undefined });
    try {
      const r = await ansibleApi.ssTestRun(item.awxServerId, item.awxTemplateId, vars, item.title, scenario.name);
      if (r.ok && r.jobId) {
        setState(item, scenario, { status: "ran", jobId: r.jobId });
        addJob({
          title: `${item.title} (test: ${scenario.name})`,
          fetchStatus: async () => {
            const s = await ansibleApi.ssJobStatus(item.awxServerId, r.jobId as number);
            return { status: s.status, output: s.output || s.resultTraceback || s.jobExplanation || "" };
          },
        });
        toast.success(`Job #${r.jobId} tetiklendi.`);
      } else if (r.ok && r.pendingApproval) {
        setState(item, scenario, { status: "ran", ticketId: r.ticketId });
        toast.success(`Smart talebi açıldı (#${r.ticketId}) — "Taleplerim" panelinden takip edebilirsiniz.`);
      } else {
        setState(item, scenario, { status: "run-error", message: r.message || "Tetiklenemedi." });
        toast.error(r.message || "Tetiklenemedi.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setState(item, scenario, { status: "run-error", message: msg });
      toast.error(msg);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50">
        <ShieldCheckIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <div className="font-semibold">Senaryolar bu otomasyonların KENDİ survey alanlarından otomatik türetilir.</div>
          <div className="mt-0.5">
            Çoğu alanın AWX'te gerçek bir varsayılanı olmadığı için (host adı, uygulama adı vb.) değerler boş
            gelebilir — alanlar DÜZENLENEBİLİR, gerçek bir örnek değeri elle yazıp deneyebilirsiniz.
            "Doğrula" hiçbir job tetiklemez, sadece geçerliliği kontrol eder. "Gerçekten Çalıştır" ise GERÇEK bir AWX job'ı
            başlatır (yıkıcı otomasyonlarda geri alınamaz olabilir) — her seferinde ayrıca onay ister.
          </div>
        </div>
      </div>

      {items.length === 0 && (
        <div className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>Self Service kataloğunda henüz kayıtlı otomasyon yok.</div>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const isOpen = !!expanded[item.id];
          const survey = surveyCache[item.id];
          const scenarios = survey && survey !== "loading" && survey !== "error"
            ? generateScenarios(survey.fields, survey.surveyEnabled)
            : [];

          return (
            <div key={item.id} className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => toggleExpand(item)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <BeakerIcon className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
                  <span className="font-semibold text-sm truncate">{item.title}</span>
                  <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                    (server #{item.awxServerId} · template #{item.awxTemplateId}{!item.enabled ? " · pasif" : ""})
                  </span>
                </div>
                <ChevronDownIcon className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>

              <Collapse open={isOpen}>
                <div className="p-4 border-t border-gray-100 bg-gray-50/50 space-y-3">
                  {survey === "loading" && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                      Survey alanları yükleniyor...
                    </div>
                  )}
                  {survey === "error" && (
                    <div className="text-sm text-red-600">Survey/template bilgisi alınamadı.</div>
                  )}
                  {scenarios.map((scenario) => {
                    const st = scenarioStates[keyOf(item.id, scenario.name)] || { status: "idle" as const };
                    const vars = currentVars(item, scenario);
                    return (
                      <div key={scenario.name} className="p-3 border border-gray-200 rounded-lg bg-white">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm">{scenario.name}</div>
                            <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{scenario.note}</div>
                            {Object.keys(vars).length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                {Object.keys(vars).map((field) => (
                                  <div key={field} className="flex items-center gap-2">
                                    <label className="text-[11px] font-mono text-gray-500 w-40 flex-shrink-0 truncate" title={field}>{field}</label>
                                    <input
                                      value={vars[field]}
                                      onChange={(e) => editVar(item, scenario, field, e.target.value)}
                                      placeholder="(boş — gerçek bir değer yazın)"
                                      className="flex-1 min-w-0 text-xs font-mono border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => validate(item, scenario)}
                              disabled={st.status === "validating"}
                              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                              {st.status === "validating"
                                ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                                : <ShieldCheckIcon className="w-3.5 h-3.5" />}
                              Doğrula
                            </button>
                            <button
                              onClick={() => runForReal(item, scenario)}
                              disabled={st.status === "running"}
                              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
                              {st.status === "running"
                                ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                                : <PlayIcon className="w-3.5 h-3.5" />}
                              Gerçekten Çalıştır
                            </button>
                          </div>
                        </div>

                        {st.status === "valid" && (
                          <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-green-700">
                            <CheckCircleIcon className="w-4 h-4" /> Geçerli — AWX bu parametreleri kabul eder.
                          </div>
                        )}
                        {st.status === "invalid" && (
                          <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-red-600">
                            <XCircleIcon className="w-4 h-4" /> Geçersiz: {st.message}
                          </div>
                        )}
                        {st.status === "ran" && st.jobId && (
                          <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-green-700">
                            <CheckCircleIcon className="w-4 h-4" /> Tetiklendi — Job #{st.jobId} (alt çubuktan takip edin).
                          </div>
                        )}
                        {st.status === "ran" && st.ticketId && (
                          <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-amber-700">
                            <CheckCircleIcon className="w-4 h-4" /> Smart talebi açıldı — #{st.ticketId} ("Taleplerim" panelinden takip edin).
                          </div>
                        )}
                        {st.status === "run-error" && (
                          <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-red-600">
                            <XCircleIcon className="w-4 h-4" /> Tetiklenemedi: {st.message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Collapse>
            </div>
          );
        })}
      </div>
    </div>
  );
}
