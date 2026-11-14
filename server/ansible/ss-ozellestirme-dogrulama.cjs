// server/ansible/ss-ozellestirme-dogrulama.cjs - Self Servis ayar (customization) dogrulamasi.
//
// 2026-11-10 (Self Servis Tasima, maestro2 -> maestro3): bu kurallar eskiden yalniz
// POST /api/ansible/ss/custom/:serverId/:templateId icinde satir-ici yaziliydi. Tasima ekrani
// AYNI kurallari hedef template'in survey spec'ine karsi "kuru" calistirmak zorunda (ayar
// kopyasi /ss/custom'un dogrulamasini atlamasin). Ikinci bir kopya yazmak yerine kurallar
// buraya cikarildi; route ve tasima ayni fonksiyonu cagirir.
//
// Sozlesme:
//   dogrula(specFields, data) -> string[]   (bos dizi = gecerli)
//   - Ilk eleman, route'un eskiden dondugu 400 mesajinin AYNISIDIR (sira korunur).
//   - Eski davranis geregi `choicesSource.source` bos olan girdiler YERINDE silinir
//     (data mutasyona ugrar). Tasima kopyasini bozmamak icin cagiran gerekirse klonlar.
'use strict';

const choiceSources = require('./choice-sources.cjs');
const surveyConditions = require('../../shared/surveyConditions.cjs');

const LAUNCH_OPTION_LABELS = {
  limit: 'Limit',
  forks: 'Forks',
  jobTags: 'Job Tags',
  skipTags: 'Skip Tags',
  verbosity: 'Verbosity',
  jobType: 'Job Type',
};

function dogrula(specFieldsGirdi, dataGirdi) {
  const hatalar = [];
  const specFields = Array.isArray(specFieldsGirdi) ? specFieldsGirdi : [];
  const data = dataGirdi && typeof dataGirdi === 'object' ? dataGirdi : {};
  const overrides = Array.isArray(data.fieldOverrides) ? data.fieldOverrides : [];

  // Secenek kaynagi: yalnizca metin tipli survey alanlari kaynaga baglanabilir.
  const specNames = specFields.map((f) => f.variable);
  for (const ov of overrides) {
    if (!ov?.choicesSource) continue;
    if (!ov.choicesSource.source) {
      delete ov.choicesSource;
      continue;
    }
    const field = specFields.find((f) => f.variable === ov.fieldName);
    if (field && !['text', 'textarea', 'multiselect'].includes(field.type)) {
      hatalar.push(
        `"${field.question_name || field.variable}" metin/çoklu seçim alanı değil (${field.type}); seçenek kaynağı yalnızca bunlara bağlanabilir.`,
      );
      continue;
    }
    const problem = choiceSources.validateChoicesSource(ov.choicesSource, specNames);
    if (problem) hatalar.push(`"${(field?.question_name) || ov.fieldName}" seçenek kaynağı: ${problem}`);
  }

  // Gizlenen alanin cozumlenen varsayilani bos olamaz.
  for (const ov of overrides) {
    if (!ov?.hidden) continue;
    const field = specFields.find((f) => f.variable === ov.fieldName);
    if (!field) continue; // survey'de olmayan (extra_vars fallback) pseudo-alan - serbest
    const resolvedDefault = ov.defaultValue !== undefined ? ov.defaultValue : field.default || '';
    if (!resolvedDefault) {
      hatalar.push(
        `"${field.question_name || field.variable}" alanının varsayılan değeri yok — gizlemeden önce bir varsayılan değer belirleyin.`,
      );
    }
  }

  // Gizli built-in launch seceneginin bos olmayan bir varsayilani olmali.
  for (const [key, ov] of Object.entries(data.launchOptionOverrides || {})) {
    if (!ov?.hidden) continue;
    if (ov.default === undefined || ov.default === null || String(ov.default).trim() === '') {
      hatalar.push(
        `"${LAUNCH_OPTION_LABELS[key] || key}" gizli ama varsayılan değeri yok — gizlemeden önce bir varsayılan değer belirleyin.`,
      );
    }
  }

  const outputFilter = data.outputFilter;
  if (outputFilter?.enabled && !String(outputFilter.contains || '').trim()) {
    hatalar.push('Çıktı filtresi etkin ama aranacak metin boş — bir metin girin veya filtreyi kapatın.');
  }

  // Survey Tasarimcisi (customSurveyFields).
  const customSurveyFields = Array.isArray(data.customSurveyFields) ? data.customSurveyFields : [];
  const seenNames = new Set();
  for (const f of customSurveyFields) {
    const name = String((f?.name) || '').trim();
    if (!name) {
      hatalar.push('Her özel alanın bir değişken adı olmalı.');
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      hatalar.push(
        `Geçersiz değişken adı: "${name}" — yalnızca harf, rakam, alt çizgi içerebilir ve rakamla başlayamaz.`,
      );
      continue;
    }
    if (seenNames.has(name)) {
      hatalar.push(`Değişken adı tekrar ediyor: "${name}"`);
      continue;
    }
    seenNames.add(name);
    if (!String((f?.label) || '').trim()) {
      hatalar.push(`"${name}" alanının bir görünen adı (label) olmalı.`);
      continue;
    }
    if (f.hidden && !String(f.defaultValue || '').trim()) {
      hatalar.push(`"${f.label}" gizli ama varsayılan değeri yok — gizlemeden önce bir varsayılan değer belirleyin.`);
      continue;
    }
    if (!f.choicesSource?.source) delete f.choicesSource;
    if (f.choicesSource) {
      const problem = choiceSources.validateChoicesSource(
        f.choicesSource,
        customSurveyFields.map((o) => String((o?.name) || '').trim()),
      );
      if (problem) {
        hatalar.push(`"${f.label}" seçenek kaynağı: ${problem}`);
        continue;
      }
    }
    if (
      (f.type === 'multiplechoice' || f.type === 'multiselect') &&
      !f.choicesSource &&
      (!Array.isArray(f.choices) || f.choices.filter((c) => String(c || '').trim()).length === 0)
    ) {
      hatalar.push(`"${f.label}" bir seçim alanı ama hiç seçeneği yok.`);
      continue;
    }
    if (f.dependsOn) {
      const conditions = surveyConditions.allConditions(f.dependsOn);
      if (conditions.length === 0) {
        hatalar.push(`"${f.label}" koşullu işaretli ama hiç koşulu yok.`);
        continue;
      }
      for (const c of conditions) {
        const condField = String((c?.field) || '').trim();
        if (!condField) {
          hatalar.push(`"${f.label}" için bir koşul alanı seçilmemiş.`);
          break;
        }
        if (condField === name) {
          hatalar.push(`"${f.label}" kendi kendine bağlı olamaz.`);
          break;
        }
        if (!customSurveyFields.some((other) => String((other?.name) || '').trim() === condField)) {
          hatalar.push(`"${f.label}" tanımsız bir alana bağlı: "${condField}"`);
          break;
        }
      }
    }
  }

  return hatalar;
}

module.exports = { dogrula, LAUNCH_OPTION_LABELS };
