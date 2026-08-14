// src/utils/ssTestScenarios.ts — Admin > Test Senaryoları için OTOMATİK senaryo üretimi.
// Domain bilgisi (hangi host grubu, hangi uygulama adı doğru) portaldan bilinemez; bu yüzden
// senaryolar HER item için o item'ın KENDİ survey alanlarından (choices/default/required)
// mekanik olarak türetilir — tahmine dayalı bir prod değeri UYDURULMAZ. Her item için aynı
// 3-4 senaryo şablonu üretilir, böylece hangi otomasyon olursa olsun tutarlı bir kapsama sağlanır.
import type { SurveyField } from "@/api/ansibleApi";

export interface SsTestScenario {
  name: string;
  note: string;
  extraVars: Record<string, string>;
}

function fieldDefault(f: SurveyField): string {
  if (f.defaultValue) return f.defaultValue;
  if (f.choices && f.choices.length > 0) return f.choices[0];
  return "";
}

function fieldAlt(f: SurveyField): string {
  if (f.choices && f.choices.length > 1) return f.choices[1];
  return fieldDefault(f);
}

// Hidden alanlar sunucu tarafında (resolveLaunchExtraVars) otomatik dolduruluyor — kullanıcı
// formunda da hiç gösterilmiyor, dolayısıyla senaryo üretiminde de atlanır (SurveyModal ile aynı davranış).
export function generateScenarios(fields: SurveyField[], surveyEnabled: boolean): SsTestScenario[] {
  const visible = (fields || []).filter((f) => !f.hidden);

  if (!surveyEnabled && visible.length === 0) {
    return [{ name: "Statik (Survey Yok)", note: "Template'in kendi statik extra_vars'ıyla çalışır, ek parametre gönderilmez.", extraVars: {} }];
  }

  if (visible.length === 0) {
    return [{ name: "Parametresiz", note: "Bu otomasyonun kullanıcıdan istediği bir alan yok.", extraVars: {} }];
  }

  const scenarios: SsTestScenario[] = [];

  const defaults: Record<string, string> = {};
  for (const f of visible) defaults[f.name] = fieldDefault(f);
  scenarios.push({ name: "Varsayılan Değerler", note: "Her alan kendi varsayılanıyla (yoksa ilk seçenekle) doldurulur.", extraVars: defaults });

  const alt: Record<string, string> = {};
  let altDiffers = false;
  for (const f of visible) {
    alt[f.name] = fieldAlt(f);
    if (alt[f.name] !== defaults[f.name]) altDiffers = true;
  }
  if (altDiffers) {
    scenarios.push({ name: "Alternatif Seçenekler", note: "Seçim (choice) alanları için ikinci seçenek denenir.", extraVars: alt });
  }

  const requiredOnly: Record<string, string> = {};
  for (const f of visible) {
    if (f.required) requiredOnly[f.name] = fieldDefault(f);
  }
  if (Object.keys(requiredOnly).length > 0 && Object.keys(requiredOnly).length < visible.length) {
    scenarios.push({ name: "Sadece Zorunlu Alanlar", note: "Opsiyonel alanlar boş bırakılır, AWX'in kendi survey varsayılanına bırakılır.", extraVars: requiredOnly });
  }

  const firstRequired = visible.find((f) => f.required);
  if (firstRequired) {
    const emptied: Record<string, string> = { ...defaults, [firstRequired.name]: "" };
    scenarios.push({
      name: `Zorunlu Alan Boş: "${firstRequired.label}"`,
      note: "Doğrulamanın zorunlu-alan hatasını doğru yakalayıp yakalamadığını test eder — normalde geçersiz çıkması beklenir.",
      extraVars: emptied,
    });
  }

  return scenarios.slice(0, 4);
}
