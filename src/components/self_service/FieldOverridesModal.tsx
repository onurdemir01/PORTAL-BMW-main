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
import { LockClosedIcon, ShieldExclamationIcon, InformationCircleIcon, AdjustmentsHorizontalIcon } from "@heroicons/react/24/outline";
import { Modal } from "@/components/common/Modal";
import { TextInput, Textarea } from "@/components/ui/Form";
import { ansibleApi, type LaunchOptions, type FieldOverride, type LaunchOptionOverride, type OutputFilter } from "@/api/ansibleApi";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      ansibleApi.surveySpecAdmin(item.awxServerId, item.awxTemplateId),
      ansibleApi.getCustomization(item.awxServerId, item.awxTemplateId).catch(() => ({ ok: false, customization: { fieldOverrides: [], rawExtraVars: "", launchOptionOverrides: {} } })),
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

  // Backend kuralıyla birebir aynı client-side ön-doğrulama: HANGİ ALAN OLURSA OLSUN
  // (zorunlu dahil) gizlenebilir, YETER Kİ çözümlenebilir (boş olmayan) bir varsayılan
  // değeri olsun. Aynı kural built-in launch seçenekleri için de geçerli.
  const invalidHidden = fields.find((f) => f.hidden && !f.defaultValue.trim());
  const invalidLaunchOption = LAUNCH_OPTION_KEYS.find((k) => {
    const ov = launchOptionOverrides[k];
    return ov?.hidden && !(ov.default || "").trim();
  });
  const invalidOutputFilter = outputFilter.enabled && !outputFilter.contains.trim();

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
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-800">
                <ShieldExclamationIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Bu template'te AWX survey <strong>kapalı</strong> — launch'ta kullanıcıya sorulacak bir alan yok.
                  (Template detayında görünen survey soruları AWX'te tanımlı olsa da survey kapalı olduğu için sorulmaz.)
                  Yine de aşağıdaki <strong>Ek Değişkenler</strong> alanından her launch'a otomatik eklenecek statik
                  değişkenler tanımlayabilirsiniz.
                </span>
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
