// src/components/self_service/FieldOverridesModal.tsx — Admin: bir self-service Ansible
// item'ının AWX survey alanlarını inceleme/gizleme paneli. Hem `SelfServicePage.tsx`'in
// "Servis Ekle" akışından hem `AnsiblePage.tsx`'in "Self Service Olarak Ekle" akışından
// paylaşılan, tek bir bileşen olarak kullanılır — bir template self-service'e KAYDEDİLİR
// KAYDEDİLMEZ bu panel otomatik açılır (ayrı, sonradan erişilen bir aksiyon DEĞİL).
//
// Ayrıca launch anında ihtiyaç duyulan HER ŞEYİ burada, add-time'da soracak şekilde
// genişletildi: survey alanları (var olan davranış) + built-in launch seçenekleri
// (limit/forks/job_tags/skip_tags/verbosity/job_type — önceden yalnızca bilgi amaçlı
// salt-okunurdu, artık hidden/default admin tarafından ayarlanabiliyor) + serbest
// "Ek Değişkenler" bloğu (survey'de karşılığı olmayan, AWX'in ask_variables_on_launch
// desteklediği ama hiçbir yerde free-form giriş noktası olmayan boşluğu kapatır).
import React, { useEffect, useState } from "react";
import { LockClosedIcon, ShieldExclamationIcon, InformationCircleIcon, AdjustmentsHorizontalIcon, PlusIcon, TrashIcon, SparklesIcon, ArrowUpIcon, ArrowDownIcon } from "@heroicons/react/24/outline";
import { Modal } from "@/components/common/Modal";
import { TextInput, Textarea, Select } from "@/components/ui/Form";
import { ansibleApi, type LaunchOptions, type FieldOverride, type LaunchOptionOverride, type OutputFilter, type SurveyField, type FieldCustomization } from "@/api/ansibleApi";

interface FieldOverridesModalItem {
  awxServerId: number;
  awxTemplateId: number;
  title: string;
}

interface LocalFieldState {
  name: string;
  label: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue: string;
  hidden: boolean;
}

// Survey Tasarımcısı'nda seçilebilecek alan tipleri — SurveyModal'ın (SelfServicePage.tsx)
// mevcut render anahtarıyla BİREBİR aynı: multiplechoice/multiselect → Select,
// textarea → Textarea, integer/float → number input, password → password input, diğer → text.
const CUSTOM_FIELD_TYPES: { value: string; label: string }[] = [
  { value: "text", label: "Metin" },
  { value: "textarea", label: "Uzun Metin" },
  { value: "integer", label: "Tam Sayı" },
  { value: "float", label: "Ondalıklı Sayı" },
  { value: "password", label: "Şifre/Gizli" },
  { value: "multiplechoice", label: "Tekli Seçim (liste)" },
  { value: "multiselect", label: "Çoklu Seçim (liste)" },
];

const EMPTY_CUSTOM_FIELD: SurveyField = {
  name: "", label: "", type: "text", required: false, defaultValue: "",
  choices: [], hidden: false, description: "",
};

// Kaydedilmis customSurveyFields'i GUVENLI bir sekle sokar — eski (tek {field,equals})
// bicimden gecis sirasinda kaydedilmis satirlar olabilir; conditions dizisi eksik/bozuksa
// TypeError firlatmak (ve tum React agacini cokertip beyaz ekrana dusurmek) yerine
// sessizce ya yeni sekle tasir ya da kosulu tamamen kaldirir.
function normalizeCustomField(f: SurveyField): SurveyField {
  const raw = f.dependsOn as unknown;
  if (!raw || typeof raw !== "object") return { ...f, dependsOn: undefined };
  const dep = raw as { mode?: string; conditions?: unknown; field?: string; equals?: string };
  if (Array.isArray(dep.conditions)) {
    const conditions = dep.conditions
      .filter((c): c is { field: string; equals: string; operator?: string } => !!c && typeof c === "object")
      .map((c) => ({
        field: String((c as { field?: unknown }).field ?? ""),
        equals: String((c as { equals?: unknown }).equals ?? ""),
        operator: (c as { operator?: unknown }).operator === "notEmpty" ? "notEmpty" as const : "equals" as const,
      }));
    return { ...f, dependsOn: { mode: dep.mode === "all" ? "all" : "any", conditions } };
  }
  // Eski tek-kosul bicimi ({field, equals}) — yeni {mode, conditions[]} bicimine tasi.
  if (typeof dep.field === "string" && dep.field) {
    return { ...f, dependsOn: { mode: "any", conditions: [{ field: dep.field, equals: String(dep.equals ?? "") }] } };
  }
  return { ...f, dependsOn: undefined };
}

const LAUNCH_OPTION_KEYS = ["limit", "forks", "jobTags", "skipTags", "verbosity", "jobType"] as const;
type LaunchOptionKey = (typeof LAUNCH_OPTION_KEYS)[number];
const LAUNCH_OPTION_LABELS: Record<LaunchOptionKey, string> = {
  limit: "Limit", forks: "Forks", jobTags: "Job Tags", skipTags: "Skip Tags", verbosity: "Verbosity", jobType: "Job Type",
};

export default function FieldOverridesModal({ item, onClose }: { item: FieldOverridesModalItem; onClose: () => void }) {
  const [fields, setFields] = useState<LocalFieldState[]>([]);
  const [surveyEnabled, setSurveyEnabled] = useState(true);
  const [launchOptions, setLaunchOptions] = useState<LaunchOptions | null>(null);
  const [launchOptionOverrides, setLaunchOptionOverrides] = useState<Partial<Record<LaunchOptionKey, LaunchOptionOverride>>>({});
  const [askVariables, setAskVariables] = useState(false);
  const [rawExtraVars, setRawExtraVars] = useState("");
  const [outputFilter, setOutputFilter] = useState<OutputFilter>({ enabled: false, contains: "" });
  // Survey Tasarımcısı — yalnızca AWX'te survey KAPALIYKEN (!surveyEnabled) gösterilir.
  const [customFields, setCustomFields] = useState<SurveyField[]>([]);
  const [injectUserInfo, setInjectUserInfo] = useState({ enabled: false, emailKey: "email", usernameKey: "username" });
  // Etkinse: bu servis çalıştırıldığında AWX job'ı HEMEN tetiklenmez — önce Smart'ta bir
  // talep açılır, onaylanana kadar kullanıcı "onay bekleniyor" ekranını görür (bkz.
  // server/ansible/runner.cjs POST /launch-ss ve server/smart/poller.cjs).
  const [smartApproval, setSmartApproval] = useState({ enabled: false, flowKey: "", metadataFields: "", integrationKey: "" });
  const [smartMetaLoading, setSmartMetaLoading] = useState(false);
  const [smartMetaFields, setSmartMetaFields] = useState<Array<Record<string, unknown>> | null>(null);
  const [smartMetaErr, setSmartMetaErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      ansibleApi.surveySpecAdmin(item.awxServerId, item.awxTemplateId),
      ansibleApi.getCustomization(item.awxServerId, item.awxTemplateId).catch(() => ({
        ok: false,
        customization: { fieldOverrides: [], rawExtraVars: "", launchOptionOverrides: {} } as FieldCustomization,
      })),
    ])
      .then(([specRes, customRes]) => {
        if (!specRes.ok) { setErr(specRes.message || "Alanlar yüklenemedi."); return; }
        setSurveyEnabled(specRes.surveyEnabled);
        setLaunchOptions(specRes.launchOptions);
        setAskVariables(specRes.askVariables);
        const existingOverrides = customRes.ok ? (customRes.customization?.fieldOverrides || []) : [];
        setFields((specRes.fields || []).map((f) => {
          const hasExistingOverride = existingOverrides.some((o) => o.fieldName === f.name);
          // Hassas (password-type) bir alan İLK KEZ yapılandırılıyorsa (henüz kayıtlı
          // override'ı yoksa) gizlemeyi ÖNERİRİZ (zorunlu kılmadan) — diğer tipler ve
          // zaten yapılandırılmış alanlar mevcut/varsayılan durumunu korur.
          const suggestHidden = f.type === "password" && !hasExistingOverride;
          return {
            name: f.name, label: f.label, type: f.type, required: f.required,
            description: f.description, defaultValue: f.defaultValue || "",
            hidden: suggestHidden ? true : f.hidden,
          };
        }));
        if (customRes.ok) {
          setRawExtraVars(customRes.customization?.rawExtraVars || "");
          setLaunchOptionOverrides(customRes.customization?.launchOptionOverrides || {});
          setOutputFilter(customRes.customization?.outputFilter || { enabled: false, contains: "" });
          setCustomFields((customRes.customization?.customSurveyFields || []).map(normalizeCustomField));
          const inj = customRes.customization?.injectUserInfo;
          setInjectUserInfo({
            enabled: !!inj?.enabled,
            emailKey: inj?.emailKey || "email",
            usernameKey: inj?.usernameKey || "username",
          });
          const smartOv = customRes.customization?.smartApproval;
          setSmartApproval({
            enabled: !!smartOv?.enabled,
            flowKey: smartOv?.flowKey || "",
            metadataFields: smartOv?.metadataFields || "",
            integrationKey: smartOv?.integrationKey || "",
          });
        }
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [item]);

  function updateField(name: string, patch: Partial<LocalFieldState>) {
    setFields((prev) => prev.map((f) => (f.name === name ? { ...f, ...patch } : f)));
  }

  function updateLaunchOption(key: LaunchOptionKey, patch: Partial<LaunchOptionOverride>) {
    setLaunchOptionOverrides((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function addCustomField() {
    setCustomFields((prev) => [...prev, { ...EMPTY_CUSTOM_FIELD }]);
  }
  function updateCustomField(index: number, patch: Partial<SurveyField>) {
    setCustomFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function removeCustomField(index: number) {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
  }
  // Alan sırası aynen render sırası (customFields dizisinin sırası) — sürükle-bırak yerine
  // basit yukarı/aşağı taşıma, komşu iki elemanı yer değiştirir.
  function moveCustomField(index: number, direction: -1 | 1) {
    setCustomFields((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addChoice(fieldIndex: number) {
    setCustomFields((prev) => prev.map((f, i) => (i === fieldIndex ? { ...f, choices: [...f.choices, ""] } : f)));
  }
  // Secenegin DEGERI degisirse, o degere bagli gorunen-ad kaydı da (choiceLabels'ta)
  // eski anahtardan yeni anahtara TASINIR — aksi halde kullanici deger'i duzeltince
  // girdigi gorunen ad sessizce kaybolurdu (choiceLabels degeri anahtar olarak kullanir).
  function updateChoiceValue(fieldIndex: number, choiceIndex: number, newValue: string) {
    setCustomFields((prev) => prev.map((f, i) => {
      if (i !== fieldIndex) return f;
      const oldValue = f.choices[choiceIndex];
      const choices = f.choices.map((c, ci) => (ci === choiceIndex ? newValue : c));
      const choiceLabels = { ...(f.choiceLabels || {}) };
      if (oldValue in choiceLabels) {
        choiceLabels[newValue] = choiceLabels[oldValue];
        delete choiceLabels[oldValue];
      }
      return { ...f, choices, choiceLabels };
    }));
  }
  function updateChoiceLabel(fieldIndex: number, choiceIndex: number, newLabel: string) {
    setCustomFields((prev) => prev.map((f, i) => {
      if (i !== fieldIndex) return f;
      const value = f.choices[choiceIndex];
      return { ...f, choiceLabels: { ...(f.choiceLabels || {}), [value]: newLabel } };
    }));
  }
  function removeChoice(fieldIndex: number, choiceIndex: number) {
    setCustomFields((prev) => prev.map((f, i) => {
      if (i !== fieldIndex) return f;
      const value = f.choices[choiceIndex];
      const choiceLabels = { ...(f.choiceLabels || {}) };
      delete choiceLabels[value];
      return { ...f, choices: f.choices.filter((_, ci) => ci !== choiceIndex), choiceLabels };
    }));
  }

  // Backend'deki (POST /ss/custom) kurallarla BİREBİR aynı ön-doğrulama.
  const customFieldNames = customFields.map((f) => f.name.trim());
  const invalidCustomField = customFields.find((f) => !f.name.trim() || !f.label.trim());
  const invalidCustomName = customFields.find((f) => f.name.trim() && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name.trim()));
  const duplicateCustomName = customFieldNames.find((n, i) => n && customFieldNames.indexOf(n) !== i);
  const invalidCustomHidden = customFields.find((f) => f.hidden && !f.defaultValue.trim());
  const invalidCustomChoices = customFields.find(
    (f) => (f.type === "multiplechoice" || f.type === "multiselect") && f.choices.filter((c) => c.trim()).length === 0
  );
  const invalidDependsOn = customFields.find((f) => {
    if (f.dependsOn === undefined) return false;
    const conditions = Array.isArray(f.dependsOn.conditions) ? f.dependsOn.conditions : [];
    if (conditions.length === 0) return true;
    return conditions.some((c) => {
      const parentName = (c.field || "").trim();
      if (!parentName || parentName === f.name.trim()) return true;
      return !customFields.some((o) => o !== f && o.name.trim() === parentName);
    });
  });

  function addCondition(fieldIndex: number) {
    setCustomFields((prev) => prev.map((f, i) => {
      if (i !== fieldIndex || !f.dependsOn) return f;
      return { ...f, dependsOn: { ...f.dependsOn, conditions: [...f.dependsOn.conditions, { field: "", equals: "", operator: "equals" as const }] } };
    }));
  }
  function updateCondition(fieldIndex: number, condIndex: number, patch: Partial<{ field: string; equals: string; operator: "equals" | "notEmpty" }>) {
    setCustomFields((prev) => prev.map((f, i) => {
      if (i !== fieldIndex || !f.dependsOn) return f;
      const conditions = f.dependsOn.conditions.map((c, ci) => (ci === condIndex ? { ...c, ...patch } : c));
      return { ...f, dependsOn: { ...f.dependsOn, conditions } };
    }));
  }
  function removeCondition(fieldIndex: number, condIndex: number) {
    setCustomFields((prev) => prev.map((f, i) => {
      if (i !== fieldIndex || !f.dependsOn) return f;
      return { ...f, dependsOn: { ...f.dependsOn, conditions: f.dependsOn.conditions.filter((_, ci) => ci !== condIndex) } };
    }));
  }

  // Smart'ın hemen hemen tüm RFF flow'larında tekrar eden bir ElementName seti var (KONU,
  // ACIKLAMA, SERVERNAME, APPLICATIONURL, IMPORTANCE, ENVIRONMENT, OPERATION, ...) — bu
  // yüzden "Alanları Getir" sonucundan GENEL, tekrar kullanılabilir bir Metadata Eşlemesi
  // taslağı üretilebilir. TEXTBOX/EDITOR/ALERT gibi serbest metin tipleri için makul bir
  // yer tutucu değer YAZILIR; PARAMETER_DROPDOWN/CONFIGURATION_SELECT_CMS gibi Smart'ta
  // ÖNCEDEN TANIMLI bir seçenek/kayıt adı bekleyen tipler için değer TAHMİN EDİLMEZ (yanlış
  // bir tahmin, boş bırakmaktan daha kötü bir "400 Invalid Request" yerine SESSİZCE yanlış
  // bir talep açabilir) — bunun yerine satır "#" ile YORUMA alınır, admin gerçek Smart
  // değerini yazıp yorumdan çıkarana kadar gönderilmez (parseSimpleYaml "#" satırlarını atlar).
  function buildMetadataTemplate(fields: Array<Record<string, unknown>>): string {
    const lines: string[] = [];
    for (const f of fields) {
      const name = String(f.ElementName ?? f.elementName ?? "").trim();
      if (!name) continue;
      const type = String(f.ComponentType ?? f.componentType ?? "").toUpperCase();
      const requiredRaw = String(f.IsRequired ?? f.isRequired ?? "").toLowerCase();
      const isRequired = ["true", "evet", "1", "yes"].includes(requiredRaw);
      const needsRealValue = /DROPDOWN|SELECT|CMS/.test(type);
      const reqTag = isRequired ? "ZORUNLU" : "opsiyonel";

      if (needsRealValue) {
        lines.push(`# ${name}: <${reqTag} — Smart'ta tanımlı GERÇEK bir seçenek/kayıt adı YA DA {{extraVars.ALAN_ADI}} (survey'deki değişken adı) yazıp bu satırı yorumdan çıkarın>`);
        continue;
      }

      let value = "";
      if (/KONU|SUBJECT|TITLE|ACIKLAMA_1|SHORTDEF/i.test(name)) value = "{{templateName}} talebi";
      else if (/^ACIKLAMA$|DESCRIPTION|EXPLAIN|DETAY/i.test(name)) value = "{{username}} tarafından Portal üzerinden açıldı";
      else if (/URL/i.test(name)) value = "{{templateName}}";
      else if (/SERVER|HOST/i.test(name)) value = "{{templateName}}";
      else if (isRequired) value = "{{templateName}}";

      if (value) lines.push(`${name}: ${value}`);
      else lines.push(`# ${name}: <${reqTag} — uygun bir değer girin>`);
    }
    return lines.join("\n");
  }

  function applyMetadataTemplate() {
    if (!smartMetaFields || smartMetaFields.length === 0) return;
    setSmartApproval((s) => ({ ...s, metadataFields: buildMetadataTemplate(smartMetaFields) }));
  }

  async function fetchSmartMetadata() {
    const flowKey = smartApproval.flowKey.trim();
    if (!flowKey) return;
    setSmartMetaLoading(true);
    setSmartMetaErr("");
    setSmartMetaFields(null);
    try {
      const res = await ansibleApi.smartFlowMetadata(flowKey);
      if (res.ok) setSmartMetaFields(res.fields || []);
      else setSmartMetaErr(res.message || "Metadata alınamadı.");
    } catch (e) {
      setSmartMetaErr(e instanceof Error ? e.message : "Metadata alınamadı.");
    } finally {
      setSmartMetaLoading(false);
    }
  }

  // Backend kuralıyla birebir aynı client-side ön-doğrulama: HANGİ ALAN OLURSA OLSUN
  // (zorunlu dahil) gizlenebilir, YETER Kİ çözümlenebilir (boş olmayan) bir varsayılan
  // değeri olsun. Aynı kural built-in launch seçenekleri için de geçerli.
  const invalidHidden = fields.find((f) => f.hidden && !f.defaultValue.trim());
  const invalidLaunchOption = LAUNCH_OPTION_KEYS.find((k) => {
    const ov = launchOptionOverrides[k];
    return ov?.hidden && !(ov.default || "").trim();
  });
  const invalidOutputFilter = outputFilter.enabled && !outputFilter.contains.trim();
  const invalidSmartApproval = smartApproval.enabled && !smartApproval.flowKey.trim();

  async function save() {
    if (invalidHidden) {
      setErr(`"${invalidHidden.label}" gizli ama varsayılan değeri yok — önce bir varsayılan değer girin.`);
      return;
    }
    if (invalidLaunchOption) {
      setErr(`"${LAUNCH_OPTION_LABELS[invalidLaunchOption]}" gizli ama varsayılan değeri yok — önce bir varsayılan değer girin.`);
      return;
    }
    if (invalidOutputFilter) {
      setErr("Çıktı filtresi etkin ama aranacak metin boş — bir metin girin veya filtreyi kapatın.");
      return;
    }
    if (invalidSmartApproval) {
      setErr("Smart onayı etkin ama Flow Key boş — bir Flow Key girin veya Smart onayını kapatın.");
      return;
    }
    if (invalidCustomField) {
      setErr("Her özel survey alanının bir değişken adı ve görünen adı olmalı.");
      return;
    }
    if (invalidCustomName) {
      setErr(`Geçersiz değişken adı: "${invalidCustomName.name}" — yalnızca harf, rakam, alt çizgi içerebilir ve rakamla başlayamaz.`);
      return;
    }
    if (duplicateCustomName) {
      setErr(`Değişken adı tekrar ediyor: "${duplicateCustomName}"`);
      return;
    }
    if (invalidCustomHidden) {
      setErr(`"${invalidCustomHidden.label}" gizli ama varsayılan değeri yok — önce bir varsayılan değer girin.`);
      return;
    }
    if (invalidCustomChoices) {
      setErr(`"${invalidCustomChoices.label}" bir seçim alanı ama hiç seçeneği yok.`);
      return;
    }
    if (invalidDependsOn) {
      setErr(`"${invalidDependsOn.label || invalidDependsOn.name}" için geçerli bir koşul alanı seçin.`);
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const fieldOverrides: FieldOverride[] = fields
        .map((f) => ({ fieldName: f.name, label: f.label, defaultValue: f.defaultValue, hidden: f.hidden }));
      const r = await ansibleApi.saveCustomization(item.awxServerId, item.awxTemplateId, {
        fieldOverrides,
        rawExtraVars: rawExtraVars.trim() || undefined,
        launchOptionOverrides,
        outputFilter: outputFilter.enabled ? outputFilter : { enabled: false, contains: "" },
        customSurveyFields: customFields.map((f) => ({ ...f, name: f.name.trim(), label: f.label.trim() })),
        injectUserInfo: {
          enabled: injectUserInfo.enabled,
          emailKey: injectUserInfo.emailKey.trim() || "email",
          usernameKey: injectUserInfo.usernameKey.trim() || "username",
        },
        smartApproval: {
          enabled: smartApproval.enabled,
          flowKey: smartApproval.flowKey.trim(),
          metadataFields: smartApproval.metadataFields.trim() || undefined,
          integrationKey: smartApproval.integrationKey.trim() || undefined,
        },
      });
      if (!r.ok) { setErr(r.message || "Kaydedilemedi."); return; }
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const enabledLaunchOptionKeys = launchOptions ? LAUNCH_OPTION_KEYS.filter((k) => launchOptions[k].enabled) : [];

  return (
    <Modal
      open
      onClose={onClose}
      title="Alanları Yönet"
      subtitle={item.title}
      icon={AdjustmentsHorizontalIcon}
      size="xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Kapat</button>
          {!loading && (
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{err}</div>}

            {loading ? (
              <div className="flex items-center justify-center h-20">
                <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !surveyEnabled ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-800">
                  <ShieldExclamationIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    Bu template'te AWX survey <strong>kapalı</strong> — AWX'in kendi soruları
                    launch'ta sorulmaz. Aşağıda kendi survey'inizi tasarlayıp değerleri
                    extra_vars üzerinden AWX'e iletebilirsiniz; hiçbir alan eklemezseniz
                    (mevcut davranış) kullanıcıya hiçbir şey sorulmaz.
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                    <SparklesIcon className="w-3.5 h-3.5" /> Survey Tasarımcısı
                  </p>
                  <button
                    onClick={addCustomField}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                  >
                    <PlusIcon className="w-3.5 h-3.5" /> Alan Ekle
                  </button>
                </div>

                {customFields.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] text-center py-3 border border-dashed border-[var(--border)] rounded-xl">
                    Henüz özel alan yok — "Alan Ekle" ile başlayın.
                  </p>
                ) : (
                  customFields.map((f, i) => {
                    const isChoiceType = f.type === "multiplechoice" || f.type === "multiselect";
                    return (
                      <div key={i} className="border border-[var(--border)] rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-[var(--text-muted)]">Alan {i + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => moveCustomField(i, -1)}
                              disabled={i === 0}
                              className="p-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Yukarı taşı"
                            >
                              <ArrowUpIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => moveCustomField(i, 1)}
                              disabled={i === customFields.length - 1}
                              className="p-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Aşağı taşı"
                            >
                              <ArrowDownIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Görünen Ad (label)</label>
                            <TextInput
                              value={f.label}
                              error={!f.label.trim()}
                              placeholder="ör. Hedef Ortam"
                              onChange={(e) => updateCustomField(i, { label: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                              Değişken Adı (extra_vars key)
                            </label>
                            <TextInput
                              value={f.name}
                              error={!f.name.trim() || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name.trim() || "x")}
                              placeholder="ör. target_env"
                              className="font-mono"
                              onChange={(e) => updateCustomField(i, { name: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Tip</label>
                            <Select value={f.type} onChange={(e) => updateCustomField(i, { type: e.target.value })}>
                              {CUSTOM_FIELD_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </Select>
                          </div>
                          <div className="flex items-end gap-4 pb-1.5">
                            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                              <input type="checkbox" checked={f.required} onChange={(e) => updateCustomField(i, { required: e.target.checked })} />
                              Zorunlu
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                              <input type="checkbox" checked={f.hidden} onChange={(e) => updateCustomField(i, { hidden: e.target.checked })} />
                              Kullanıcıdan gizle
                            </label>
                          </div>
                        </div>

                        {isChoiceType && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                                Seçenekler — değer (extra_vars'a giden) + görünen ad
                              </label>
                              <button
                                onClick={() => addChoice(i)}
                                className="flex items-center gap-0.5 text-[11px] font-medium text-[var(--accent)] hover:underline"
                              >
                                <PlusIcon className="w-3 h-3" /> Seçenek Ekle
                              </button>
                            </div>
                            {f.choices.length === 0 && (
                              <p className="text-[11px] text-[var(--text-muted)]">Henüz seçenek yok.</p>
                            )}
                            {f.choices.map((c, ci) => (
                              <div key={ci} className="flex items-center gap-1.5">
                                <TextInput
                                  value={c}
                                  placeholder="değer"
                                  className="font-mono text-xs"
                                  onChange={(e) => updateChoiceValue(i, ci, e.target.value)}
                                />
                                <TextInput
                                  value={f.choiceLabels?.[c] ?? ""}
                                  placeholder="görünen ad (opsiyonel)"
                                  onChange={(e) => updateChoiceLabel(i, ci, e.target.value)}
                                />
                                <button
                                  onClick={() => removeChoice(i, ci)}
                                  className="text-red-400 hover:text-red-600 flex-shrink-0"
                                  title="Seçeneği kaldır"
                                >
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div>
                          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                            {f.hidden ? "Varsayılan Değer (zorunlu — kullanıcı görmeyecek)" : "Varsayılan Değer (opsiyonel)"}
                          </label>
                          <TextInput
                            type={f.type === "password" ? "password" : "text"}
                            error={f.hidden && !f.defaultValue.trim()}
                            value={f.defaultValue}
                            onChange={(e) => updateCustomField(i, { defaultValue: e.target.value })}
                            autoComplete="off"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Açıklama (opsiyonel)</label>
                          <TextInput
                            value={f.description}
                            onChange={(e) => updateCustomField(i, { description: e.target.value })}
                            placeholder="Kullanıcıya gösterilecek kısa ipucu"
                          />
                        </div>

                        <div className="border-t border-[var(--border)] pt-2">
                          <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer mb-1.5">
                            <input
                              type="checkbox"
                              checked={f.dependsOn !== undefined}
                              onChange={(e) => updateCustomField(i, {
                                dependsOn: e.target.checked ? { mode: "any", conditions: [{ field: "", equals: "", operator: "equals" as const }] } : undefined,
                              })}
                            />
                            Koşullu göster (başka alan(lar)ın değerine bağlı)
                          </label>
                          {f.dependsOn !== undefined && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`depends-mode-${i}`}
                                    checked={f.dependsOn.mode === "any"}
                                    onChange={() => updateCustomField(i, { dependsOn: { ...f.dependsOn!, mode: "any" } })}
                                  />
                                  Herhangi biri yeterli (VEYA)
                                </label>
                                <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`depends-mode-${i}`}
                                    checked={f.dependsOn.mode === "all"}
                                    onChange={() => updateCustomField(i, { dependsOn: { ...f.dependsOn!, mode: "all" } })}
                                  />
                                  Hepsi sağlanmalı (VE)
                                </label>
                              </div>

                              {(Array.isArray(f.dependsOn.conditions) ? f.dependsOn.conditions : []).map((c, ci) => {
                                const operator = c.operator === "notEmpty" ? "notEmpty" : "equals";
                                return (
                                  <div key={ci} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                                    <Select
                                      value={c.field}
                                      onChange={(e) => updateCondition(i, ci, { field: e.target.value })}
                                    >
                                      <option value="">Alan seçin…</option>
                                      {customFields.filter((_, oi) => oi !== i).map((other, oi) => (
                                        <option key={oi} value={other.name}>{other.label || other.name || `Alan ${oi + 1}`}</option>
                                      ))}
                                    </Select>
                                    <Select
                                      value={operator}
                                      onChange={(e) => updateCondition(i, ci, { operator: e.target.value === "notEmpty" ? "notEmpty" : "equals" })}
                                    >
                                      <option value="equals">şu değere eşitse</option>
                                      <option value="notEmpty">herhangi bir değer seçilirse</option>
                                    </Select>
                                    {operator === "equals" ? (
                                      <TextInput
                                        value={c.equals}
                                        placeholder="ör. deactive"
                                        onChange={(e) => updateCondition(i, ci, { equals: e.target.value })}
                                      />
                                    ) : (
                                      <span className="text-[11px] text-[var(--text-muted)] italic px-1">boş bırakılmadıkça</span>
                                    )}
                                    <button
                                      onClick={() => removeCondition(i, ci)}
                                      className="text-red-400 hover:text-red-600 flex-shrink-0"
                                      title="Koşulu kaldır"
                                    >
                                      <TrashIcon className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                );
                              })}

                              <button
                                onClick={() => addCondition(i)}
                                className="flex items-center gap-0.5 text-[11px] font-medium text-[var(--accent)] hover:underline"
                              >
                                <PlusIcon className="w-3 h-3" /> Koşul Ekle
                              </button>
                            </div>
                          )}
                          <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            "VEYA" seçiliyse koşullardan herhangi biri sağlanınca (ör. op_selection=deactive VEYA
                            op_selection=activate), "VE" seçiliyse hepsi birden sağlanınca bu alan kullanıcıya
                            gösterilir; aksi halde hiç sorulmaz ve extra_vars'a eklenmez.
                          </p>
                        </div>

                        <div className="flex justify-end">
                          <button
                            onClick={() => removeCustomField(i)}
                            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                          >
                            <TrashIcon className="w-3.5 h-3.5" /> Alanı Kaldır
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : fields.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)] text-center py-4">Bu template için tanımlı bir alan yok.</p>
            ) : (
              <div className="space-y-3">
                {fields.map((f) => (
                  <div key={f.name} className="border border-[var(--border)] rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                        {f.label}
                        {f.required && <span className="text-[10px] text-red-500 font-normal">zorunlu</span>}
                        {f.type === "password" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                            <ShieldExclamationIcon className="w-3 h-3" /> Hassas
                          </span>
                        )}
                      </span>
                      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer flex-shrink-0">
                        Kullanıcıya göster
                        <input
                          type="checkbox"
                          checked={!f.hidden}
                          onChange={(e) => updateField(f.name, { hidden: !e.target.checked })}
                        />
                      </label>
                    </div>
                    {f.description && <p className="text-xs text-[var(--text-muted)] mb-1.5">{f.description}</p>}
                    {f.hidden ? (
                      <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1 flex items-center gap-1">
                          <LockClosedIcon className="w-3 h-3" />
                          Varsayılan Değer (zorunlu — kullanıcı bu alanı görmeyecek)
                        </label>
                        <TextInput
                          type={f.type === "password" ? "password" : "text"}
                          error={!f.defaultValue.trim()}
                          value={f.defaultValue}
                          onChange={(e) => updateField(f.name, { defaultValue: e.target.value })}
                          autoComplete="off"
                        />
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          {f.required
                            ? "Bu alan AWX'te zorunlu — kullanıcı görmeyecek, launch bu değerle yapılacak."
                            : "Kullanıcı bu alanı görmeyecek, launch bu değerle yapılacak."}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-600">
                        {f.required
                          ? "Zorunlu bir alan — kullanıcıya gösterilecek, değer girmesi istenecek."
                          : "Bu alan kullanıcıya opsiyonel olarak gösterilecek."}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!loading && enabledLaunchOptionKeys.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--text-secondary)]">AWX'te açık built-in launch seçenekleri</p>
                {enabledLaunchOptionKeys.map((key) => {
                  const ov = launchOptionOverrides[key] || {};
                  return (
                    <div key={key} className="border border-[var(--border)] rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{LAUNCH_OPTION_LABELS[key]}</span>
                        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer flex-shrink-0">
                          Kullanıcıya göster
                          <input
                            type="checkbox"
                            checked={!ov.hidden}
                            onChange={(e) => updateLaunchOption(key, { hidden: !e.target.checked })}
                          />
                        </label>
                      </div>
                      <TextInput
                        type="text"
                        placeholder={ov.hidden ? "Varsayılan değer (zorunlu)" : "Varsayılan değer (opsiyonel ön-doldurma)"}
                        error={!!ov.hidden && !(ov.default || "").trim()}
                        value={ov.default || ""}
                        onChange={(e) => updateLaunchOption(key, { default: e.target.value })}
                      />
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        {ov.hidden
                          ? "Kullanıcı bu seçeneği görmeyecek, launch bu değerle yapılacak."
                          : "Kullanıcıya gösterilecek; burada girilen değer yalnızca ön-doldurma, kullanıcı değiştirebilir."}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {!loading && (
              <div className="border border-[var(--border)] rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">Çıktı Görünümü (opsiyonel)</p>
                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer flex-shrink-0">
                    Yalnızca belirli satırları göster
                    <input
                      type="checkbox"
                      checked={outputFilter.enabled}
                      onChange={(e) => setOutputFilter((f) => ({ ...f, enabled: e.target.checked }))}
                    />
                  </label>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  Kapalıyken (varsayılan) kullanıcı, çalıştırma ve geçmiş ekranlarında AWX'in
                  ürettiği stdout'u <strong>olduğu gibi</strong> görür. Açılırsa yalnızca
                  aşağıdaki metni <strong>içeren</strong> satırlar alt alta gösterilir, geri kalan
                  satırlar ekrandan gizlenir — örneğin bir playbook özet satırlarını
                  "——" ile işaretliyorsa, yalnızca o özet satırları göstermek için kullanılır.
                  Gösterilen satırların baştaki/sondaki boşlukları da otomatik kırpılır
                  (playbook girintisi filtrelenmiş görünümde anlamsız kaldığı için). Bu yalnızca{" "}
                  <strong>görünümü</strong> değiştirir: AWX'e giden iş ve denetim
                  kayıtlarındaki tam çıktı etkilenmez.
                </p>
                {outputFilter.enabled && (
                  <TextInput
                    type="text"
                    placeholder="Aranacak metin (ör. ——)"
                    error={invalidOutputFilter}
                    value={outputFilter.contains}
                    onChange={(e) => setOutputFilter((f) => ({ ...f, contains: e.target.value }))}
                  />
                )}
              </div>
            )}

            {!loading && (
              <div className="border border-[var(--border)] rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">Kullanıcı Bilgisi Ekle (opsiyonel)</p>
                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer flex-shrink-0">
                    Etkin
                    <input
                      type="checkbox"
                      checked={injectUserInfo.enabled}
                      onChange={(e) => setInjectUserInfo((s) => ({ ...s, enabled: e.target.checked }))}
                    />
                  </label>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  İşi başlatan kullanıcının oturumdaki e-posta ve kullanıcı adını aşağıdaki
                  anahtarlarla extra_vars'a ekler. Kullanıcıya hiçbir zaman gösterilmez ve
                  kullanıcının gönderdiği hiçbir değer bu iki anahtarın üzerine yazamaz —
                  sunucu bunu launch'ın EN SON adımında oturumdan okuyarak enjekte eder.
                </p>
                {injectUserInfo.enabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">E-posta anahtarı</label>
                      <TextInput
                        className="font-mono text-xs"
                        value={injectUserInfo.emailKey}
                        placeholder="email"
                        onChange={(e) => setInjectUserInfo((s) => ({ ...s, emailKey: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Kullanıcı adı anahtarı</label>
                      <TextInput
                        className="font-mono text-xs"
                        value={injectUserInfo.usernameKey}
                        placeholder="username"
                        onChange={(e) => setInjectUserInfo((s) => ({ ...s, usernameKey: e.target.value }))}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {!loading && (
              <div className="border border-[var(--border)] rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">Smart Onayı Gerekli (opsiyonel)</p>
                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer flex-shrink-0">
                    Etkin
                    <input
                      type="checkbox"
                      checked={smartApproval.enabled}
                      onChange={(e) => setSmartApproval((s) => ({ ...s, enabled: e.target.checked }))}
                    />
                  </label>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  Etkinse bu servis çalıştırıldığında AWX job'ı hemen tetiklenmez — önce
                  Smart'ta bu Flow Key ile bir talep açılır. Kullanıcı talep onaylanana kadar
                  "onay bekleniyor" ekranını görür; talep reddedilirse iş hiç başlatılmaz.
                </p>
                {smartApproval.enabled && (
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Smart Flow Key</label>
                    <div className="flex items-center gap-2">
                      <TextInput
                        className="font-mono text-xs flex-1"
                        error={invalidSmartApproval}
                        value={smartApproval.flowKey}
                        placeholder="ör. VIRTUAL_SERVER_TICKET_FLOW"
                        onChange={(e) => setSmartApproval((s) => ({ ...s, flowKey: e.target.value }))}
                      />
                      <button
                        type="button"
                        disabled={!smartApproval.flowKey.trim() || smartMetaLoading}
                        onClick={fetchSmartMetadata}
                        className="text-xs px-2 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 flex-shrink-0"
                        title="Smart'ın bu flow için beklediği metadata alanlarını sorgula"
                      >
                        {smartMetaLoading ? "Sorgulanıyor…" : "Alanları Getir"}
                      </button>
                    </div>

                    <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mt-3 mb-1">Integration Key (opsiyonel)</label>
                    <TextInput
                      className="font-mono text-xs"
                      type="password"
                      value={smartApproval.integrationKey}
                      placeholder="Boşsa sistem geneli varsayılan (Admin › Sistem › Smart) kullanılır"
                      onChange={(e) => setSmartApproval((s) => ({ ...s, integrationKey: e.target.value }))}
                    />
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">
                      Smart Designer'da her flow ayrı bir "Integration Information" anahtarıyla
                      (rff-request-token) yayınlanmış olabilir. Bu servisin flow'u sistem geneli
                      anahtardan FARKLIYSA burayı doldurun — boş bırakılırsa mevcut davranış
                      (tek, genel anahtar) aynen sürer.
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">
                      Talep açma şu an sabit <code className="font-mono">application</code>/
                      <code className="font-mono">requestedBy</code> metadata'sı gönderir. "400
                      Invalid Request" alırsanız aşağıdaki listeyle flow'un GERÇEKTEN beklediği
                      alanları karşılaştırın.
                    </p>
                    {smartMetaErr && (
                      <p className="text-[11px] text-red-500 mt-1">{smartMetaErr}</p>
                    )}
                    {smartMetaFields && (
                      <div className="mt-2 border border-[var(--border)] rounded-lg overflow-x-auto">
                        {smartMetaFields.length === 0 ? (
                          <p className="text-[11px] text-[var(--text-muted)] p-2">Smart bu flow için hiçbir alan döndürmedi.</p>
                        ) : (
                          <table className="text-[11px] w-full">
                            <thead>
                              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                                <th className="p-1.5">ElementName (gönderilecek "key" budur)</th>
                                <th className="p-1.5">ComponentType (alan tipi — dropdown/select ise değer Smart'ta tanımlı bir seçenek olmalı)</th>
                                <th className="p-1.5">Zorunlu</th>
                                <th className="p-1.5">Tip</th>
                              </tr>
                            </thead>
                            <tbody>
                              {smartMetaFields.map((f, i) => (
                                <tr key={i} className="border-b border-[var(--border)] last:border-0">
                                  <td className="p-1.5 font-mono">{String(f.ElementName ?? f.elementName ?? "-")}</td>
                                  <td className="p-1.5 font-mono">{String(f.ComponentType ?? f.componentType ?? "-")}</td>
                                  <td className="p-1.5">{String(f.IsRequired ?? f.isRequired ?? "-")}</td>
                                  <td className="p-1.5">{String(f.DataType ?? f.dataType ?? "-")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-3 mb-1">
                      <label className="block text-[11px] font-semibold text-[var(--text-secondary)]">Metadata Eşlemesi</label>
                      <button
                        type="button"
                        disabled={!smartMetaFields || smartMetaFields.length === 0}
                        onClick={applyMetadataTemplate}
                        className="text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 flex-shrink-0"
                        title="Yukarıdaki alan listesinden genel bir taslak oluştur (serbest metin alanları doldurulur, Smart-tanımlı seçenek gerektiren alanlar yorum satırı olarak bırakılır)"
                      >
                        Otomatik Doldur
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mb-1">
                      Her satıra bir tane, <code className="font-mono">ElementName: değer</code>{" "}
                      (yukarıdaki tablonun İLK sütunu — ComponentType TEKİL değil, aynı tipten
                      birden çok alan olabilir, bu yüzden eşleme ElementName'e göre yapılır).
                      Değer içinde <code className="font-mono">{"{{username}}"}</code>,{" "}
                      <code className="font-mono">{"{{email}}"}</code>, <code className="font-mono">{"{{templateName}}"}</code>{" "}
                      yer tutucuları kullanılabilir — bunlar talebi açan kişiye/servise göre
                      sabittir. Kullanıcının o launch'ta survey'e girdiği/seçtiği DEĞERİ istiyorsanız{" "}
                      <code className="font-mono">{"{{extraVars.ALAN_ADI}}"}</code> kullanın
                      (<code className="font-mono">ALAN_ADI</code>, survey'deki değişken adı —
                      "Ek Değişkenler" bölümündeki survey alan adlarıyla aynı). Eşleşmeyen bir yer
                      tutucu boş geçilmez, olduğu gibi (<code className="font-mono">{"{{...}}"}</code>)
                      Smart talebine gider — yanlış yapılandırma sessizce kaybolmaz.{" "}
                      <code className="font-mono">#</code> ile başlayan
                      satırlar YOK SAYILIR — "Otomatik Doldur" gerçek bir değer TAHMİN EDEMEDİĞİ
                      satırları (aşağıya bakın) bilerek yorum satırı bırakır, siz gerçek değeri
                      yazıp <code className="font-mono">#</code>'i silmeden gönderilmez.{" "}
                      <strong>PARAMETER_DROPDOWN / CONFIGURATION_SELECT_CMS</strong>{" "}
                      tipindeki alanlar muhtemelen Smart'ta önceden tanımlı bir seçenek/kayıt adı
                      bekler, serbest metin kabul etmeyebilir. Boş bırakılırsa eski sabit
                      (<code className="font-mono">application</code>/<code className="font-mono">requestedBy</code>) gövde gönderilir.
                    </p>
                    <Textarea
                      rows={4}
                      className="text-xs font-mono"
                      value={smartApproval.metadataFields}
                      placeholder={"KONU: {{templateName}} - Portal talebi\nAPPLICATIONURL: {{templateName}}\nACIKLAMA: {{username}} tarafından Portal üzerinden açıldı"}
                      onChange={(e) => setSmartApproval((s) => ({ ...s, metadataFields: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            )}

            {!loading && (
              <div className="border border-[var(--border)] rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">Ek Değişkenler (opsiyonel)</p>
                  {askVariables && (
                    <span title="Bu template AWX'te 'Prompt on Launch → Variables' bayrağını açık tutuyor.">
                      <InformationCircleIcon className="w-3.5 h-3.5 text-blue-400" />
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  Survey'de karşılığı olmayan ek anahtar:değer çiftleri — her satıra bir tane
                  ("host_group: web"). Kullanıcıya ASLA gösterilmez, her launch'a otomatik eklenir.
                </p>
                <Textarea
                  rows={3}
                  className="text-xs font-mono"
                  placeholder={"anahtar: değer\nbaska_anahtar: baska_deger"}
                  value={rawExtraVars}
                  onChange={(e) => setRawExtraVars(e.target.value)}
                />
              </div>
            )}
      </div>
    </Modal>
  );
}
