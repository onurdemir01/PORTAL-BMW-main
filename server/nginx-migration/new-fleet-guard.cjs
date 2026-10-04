// server/nginx-migration/new-fleet-guard.cjs - "Eski tanimi kaldir" YENI filoyu silmesin.
//
// URETIM TUZAGI (2026-10-03): nginx_ops.yml'in GBLABT02 play'i ("Yeni PROD SPA sunuculari -
// tasima isini tetikle") env=prod + action create/delete/update icin, new_fleet ACIKCA
// 'false' / 'no' / '0' DEGILSE yeni PROD SPA filosu icin tasima isini (nginx_prod_migration)
// HEMEN tetikler. Portal'in silme istegi new_fleet GONDERMIYORDU: "eski sunucudan kaldir"
// dugmesi, tasinmis uygulamanin yeni filodaki tanimini da siliyordu (kesinti).
//
// new_fleet='false' GONDERMEK TEK BASINA YETMEZ. nginx_ops template'i survey'li; survey
// varken AWX, survey'de OLMAYAN bir degiskeni "Prompt on launch" (ask_variables_on_launch)
// kapaliysa SESSIZCE yok sayar: launch 201 doner, degisken yanittaki ignored_fields'a
// duser ve playbook new_fleet'i hic gormez -> yeni filo yine silinir. Bu yuzden iki kapi:
//
//   ON KONTROL  (launch'tan ONCE): template HAM okunur (runner.getTemplateLaunchSettingsOnServer;
//               liste ucundaki `|| false` "alan yok"u "kapali" yapardi). new_fleet ya survey'de
//               'false' degerini kabul eden bir soru olmali ya da Prompt on launch acik olmali.
//               Degilse is BASLATILMAZ (409). Okunamazsa da BASLATILMAZ: FAIL-CLOSED.
//               "Olculemedi" "yok" demek degildir (measured:false), ama burada yanlis tahminin
//               bedeli prod kesintisi. (template-preflight.cjs bilerek fail-open'dir; bu kapi
//               onun TERSI.)
//   SONRA KONTROL (launch yaniti): runner.launchJobOnServer AWX'in ignored_fields'ini ADLAR
//               olarak dondurur (degerler sir tasiyabilir). new_fleet yok sayildiysa Portal
//               kendi baslattigi isi HEMEN iptal eder ve hata doner. Yanit ignored_fields
//               tasimiyorsa sonuc "olculemedi"dir - "temiz" DENMEZ.
//
// AWX kurallari (awx/main/models/mixins.py SurveyJobTemplateMixin._survey_element_validation):
//   text/textarea/password: deger dizgi; min/max uzunluk siniri varsa uygulanir.
//   multiplechoice: choices (liste ya da satir satir dizgi) icinde BIREBIR olmali.
//   multiselect: deger LISTE olmali - dizgi 'false' 400 alir; liste gonderilse bile
//                playbook `new_fleet | string` ile "['false']" gorur ve yeni filoyu ATLAMAZ.
//   integer/float: 'false' sayi degil -> 400.
// Prompt on launch ACIKKEN survey okunamasa da is guvenlidir: AWX ya new_fleet'i playbook'a
// gecirir ya da survey dogrulamasinda launch'i 400 ile reddeder (hicbir sey silinmez).
'use strict';

const NEW_FLEET_VAR = 'new_fleet';
const NEW_FLEET_OFF = 'false';
// Yonetici icin TEK yol gosterici budur (ekran + 409 mesaji). Survey sorusu eklenirken
// varsayilan/zorunluluk tuzagi da burada soylenir: AWX survey VARSAYILANINI new_fleet
// gondermeyen HER launch'in extra_vars'ina koyar (Ansible nginx_ops README 6c, job 3343114).
// Varsayilan 'false' olursa Self Servis / AWX arayuzundeki diger tum prod create/update/delete
// isleri yeni filoyu SESSIZCE atlar (filolar ayrisir); zorunlu + varsayilansiz soru ise o
// isleri 400 'value missing' ile durdurur.
const NEW_FLEET_BLOCK_MESSAGE =
  "Silme işi yeni filoyu koruyamıyor: nginx_ops template'inde new_fleet survey sorusu (false seçeneğiyle) ya da Prompt on launch gerekli. " +
  "Soru eklenirse ZORUNLU olmamalı ve varsayılanı boş ya da true olmalı: false varsayılanı, new_fleet göndermeyen diğer tüm prod nginx_ops işlerinde yeni filoyu atlatır.";
// Playbook'un "kapali" saydigi degerler: nginx_ops.yml `(new_fleet | default('') | string | trim | lower) not in ['false','no','0']`.
const NEW_FLEET_OFF_VALUES = ['false', 'no', '0'];
// Sonra kontrolde new_fleet yok sayildiysa HER DURUMDA verilen uyari: GBLABT02 play'i
// iptalden once ya da is bittiyse coktan tasima isini tetiklemis olabilir.
const MIGRATION_JOB_WARNING =
  "Yeni filo taşıma işi TETİKLENMİŞ OLABİLİR - AWX'te 'Nginx - Production Migration' işlerini kontrol edin (yeni filodaki tanım da silinmiş olabilir).";

/** Survey sorusunun secenek listesi (AWX: liste ya da satir satir dizgi; bos satirlar atilir). */
function choiceList(q) {
  const c = q ? q.choices : null;
  if (Array.isArray(c)) return c.map((x) => String(x));
  if (typeof c === 'string') return c.split(/\r\n|\r|\n/).filter((x) => x.trim() !== '');
  return [];
}

const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Survey'deki new_fleet sorusu 'false' degerini AWX dogrulamasindan gecirir mi?
 * @returns {{ok: boolean, reason: string}}
 */
function surveyQuestionAcceptsFalse(q) {
  const type = String((q && q.type) || '').toLowerCase();
  if (type === 'multiplechoice') {
    const ch = choiceList(q);
    if (ch.includes(NEW_FLEET_OFF)) return { ok: true, reason: '' };
    return { ok: false, reason: `soru seçenekli ve 'false' seçeneklerde yok (seçenekler: ${ch.length ? ch.join(', ') : 'boş'})` };
  }
  if (type === 'text' || type === 'textarea' || type === 'password') {
    const len = NEW_FLEET_OFF.length;
    const min = numOrNull(q.min);
    const max = numOrNull(q.max);
    if (min != null && len < min) return { ok: false, reason: `soru en az ${min} karakter istiyor` };
    if (max != null && len > max) return { ok: false, reason: `soru en çok ${max} karakter kabul ediyor` };
    return { ok: true, reason: '' };
  }
  if (type === 'multiselect') {
    return { ok: false, reason: "soru çoklu seçim (multiselect): AWX liste ister, playbook listeyi 'false' olarak okumaz" };
  }
  return { ok: false, reason: `soru tipi '${type || 'bilinmiyor'}' 'false' metnini kabul etmez` };
}

/**
 * Survey'deki new_fleet sorusu Portal'in silmesini korur ama DIGER isleri bozuyor mu? (saf)
 * Silmeyi BLOKLAMAZ - Portal'in kendi istegi new_fleet='false'u acikca gonderir; uyari
 * yoneticinin template'i duzeltmesi icindir.
 *   varsayilan false/no/0 (playbook gibi trim+lower) -> new_fleet gondermeyen diger tum prod
 *       nginx_ops isleri survey varsayilanini alir ve yeni filoyu ATLAR (sessiz ayrisma)
 *   zorunlu + varsayilan bos -> new_fleet gondermeyen diger isler 400 'value missing' alir
 *       (AWX kaynagina dayali; gercek AWX'te kosturulmadi - MAKUL)
 * @returns {string} bos = uyari yok
 */
function surveyQuestionSideEffects(q) {
  const raw = q ? q.default : undefined;
  const def = raw == null ? '' : String(raw).trim().toLowerCase();
  const out = [];
  if (NEW_FLEET_OFF_VALUES.includes(def)) {
    out.push(
      `UYARI: nginx_ops survey'indeki new_fleet sorusunun varsayılanı '${String(raw).trim()}'. new_fleet göndermeyen diğer tüm prod nginx_ops işleri (Self Servis, AWX arayüzü) bu varsayılanı alır ve yeni filoyu ATLAR: yeni tanımlar yeni filoya yazılmaz, silinenler orada kalır. Varsayılan boş ya da true olmalı.`,
    );
  } else if (q && q.required === true && def === '') {
    out.push(
      "UYARI: nginx_ops survey'indeki new_fleet sorusu ZORUNLU ve varsayılanı yok. new_fleet göndermeyen diğer nginx_ops işleri (Self Servis, AWX arayüzü) AWX'te 400 (value missing) ile reddedilebilir. Soru zorunlu olmamalı (varsayılan boş ya da true).",
    );
  }
  return out.join(' ');
}

/**
 * @typedef {{ok: boolean, via?: ('prompt' | 'survey'), status?: number, measured?: boolean, code?: string, message?: string, warning?: string}} NewFleetVerdict
 *   ok=true  -> via dolu (AWX new_fleet'i nereden alacak); warning varsa survey sorusu DIGER
 *               isleri bozuyor (silme yine guvenli, bloklanmaz)
 *   ok=false -> status 409, code, message; measured=false ise AWX ayari OLCULEMEDI (yok DEGIL)
 */

/** @returns {NewFleetVerdict} */
const block = (measured, code, detail) => ({
  ok: false,
  status: 409,
  measured,
  code,
  message: `${NEW_FLEET_BLOCK_MESSAGE} ${detail}`,
});

/**
 * ON KONTROL - saf, test edilebilir.
 *
 * @param {{
 *   template: ({askVariablesOnLaunch?: (boolean|undefined), surveyEnabled?: (boolean|undefined), name?: string} | null),
 *   templateError?: (string | null),
 *   survey?: ({measured: boolean, spec?: Array<any>, error?: string} | null),
 * }} m
 * @returns {NewFleetVerdict}
 */
function assessNewFleetGuard({ template, templateError = null, survey = null }) {
  if (!template) {
    return block(
      false,
      'template_unreadable',
      `Durum ÖLÇÜLEMEDİ: nginx_ops template'i AWX'ten okunamadı (${templateError || 'bilinmiyor'}). ` +
        'Yeni filonun korunduğu doğrulanamadığı için iş BAŞLATILMADI.',
    );
  }
  const ask = template.askVariablesOnLaunch;
  const surveyOn = template.surveyEnabled;
  // HAM bayraklar: AWX yaniti alani tasimiyorsa "kapali" DEGIL, OLCULEMEDI.
  const missing = [
    typeof ask === 'boolean' ? null : 'ask_variables_on_launch',
    typeof surveyOn === 'boolean' ? null : 'survey_enabled',
  ].filter(Boolean);
  if (missing.length) {
    return block(
      false,
      'template_flags_unmeasured',
      `Durum ÖLÇÜLEMEDİ: AWX template yanıtında ${missing.join(' ve ')} alanı yok (Prompt on launch / survey ayarı bilinmiyor). İş BAŞLATILMADI.`,
    );
  }
  const spec = surveyOn && survey && survey.measured === true && Array.isArray(survey.spec) ? survey.spec : null;
  const q = spec ? spec.find((x) => x && x.variable === NEW_FLEET_VAR) : null;
  // Soru VARSA Prompt on launch acik olsa bile AWX survey dogrulamasini uygular: 'false'
  // kabul edilmiyorsa launch 400 alir. Acik mesaj burada verilir.
  if (q) {
    const acc = surveyQuestionAcceptsFalse(q);
    if (!acc.ok) return block(true, 'survey_rejects_false', `Survey'deki new_fleet sorusu 'false' değerini kabul etmiyor: ${acc.reason}.`);
    const warning = surveyQuestionSideEffects(q);
    return warning ? { ok: true, via: 'survey', warning } : { ok: true, via: 'survey' };
  }
  if (ask === true) return { ok: true, via: 'prompt' };
  if (!surveyOn) {
    return block(true, 'no_survey_no_prompt', "Template'te survey kapalı ve Prompt on launch kapalı: AWX gönderilen değişkenlerin hiçbirini almaz.");
  }
  if (!spec) {
    return block(
      false,
      'survey_unreadable',
      `Durum ÖLÇÜLEMEDİ: Prompt on launch kapalı ve survey okunamadı (${(survey && survey.error) || 'bilinmiyor'}). İş BAŞLATILMADI.`,
    );
  }
  return block(true, 'survey_missing_new_fleet', "Survey'de new_fleet sorusu yok ve Prompt on launch kapalı: AWX new_fleet'i sessizce yok sayardı.");
}

/**
 * SONRA KONTROL - runner.launchJobOnServer'in dondurdugu ignoredFields (yalniz ADLAR:
 * ['extra_vars.new_fleet', 'limit', ...]) new_fleet'i iceriyor mu?
 * @returns {true | false | null} null = OLCULEMEDI (alan yok, beklenmeyen bicim ya da adi
 *   cikarilamayan yok sayilmis degisken var)
 */
function ignoredFieldsHasNewFleet(names) {
  if (!Array.isArray(names)) return null;
  if (names.includes(`extra_vars.${NEW_FLEET_VAR}`)) return true;
  if (names.includes('?') || names.includes('extra_vars.?')) return null;
  return false;
}

/**
 * @typedef {'canceled' | 'terminal' | 'unverified' | 'cancel_failed' | 'no_job_id' | 'unknown'} CancelOutcome
 *   terminal   = iptal reddedildi ve isin BITTIGI AWX'ten OKUNDU (stateVerified)
 *   unverified = iptal 405/409 ile reddedildi ve isin durumu OKUNAMADI: "bitti" DENMEZ
 *                (runner: 405 tek basina bitti demek degil; araya giren vekil POST'u reddedebilir)
 */

/**
 * new_fleet yok sayildiginda kullaniciya giden mesaj - saf. Tasima isi uyarisi HER
 * DURUMDA vardir; "isi iptal edin" yalniz nginx_ops isi hala calisiyor olabilirken eklenir
 * (bitmis bir isi iptal etmesi istenmez).
 * @param {{jobId: (number|null), outcome: CancelOutcome, awxStatus?: (string|null), error?: string}} o
 */
function ignoredMessage({ jobId, outcome, awxStatus = null, error = '' }) {
  const job = jobId == null ? '?' : String(jobId);
  let what;
  if (outcome === 'canceled') what = `nginx_ops işi (job ${job}) iptal edildi.`;
  else if (outcome === 'terminal') what = `nginx_ops işi (job ${job}) iptal edilemedi: iş zaten bitmiş (AWX durumu: ${awxStatus || 'ölçülemedi'}).`;
  else if (outcome === 'unverified') {
    what =
      `nginx_ops işi (job ${job}) için iptal isteği AWX'te reddedildi ve işin durumu ÖLÇÜLEMEDİ${error ? ` (${error})` : ''}: ` +
      "işin bittiği DOĞRULANMADI, HÂLÂ ÇALIŞIYOR olabilir. İşi AWX'te bulup HEMEN iptal edin.";
  } else if (outcome === 'no_job_id') what = "AWX job numarası dönmedi; iptal isteği gönderilemedi. İşi AWX'te bulup HEMEN iptal edin.";
  else if (outcome === 'cancel_failed') what = `nginx_ops işi (job ${job}) İPTAL EDİLEMEDİ: ${error}. İşi AWX'ten HEMEN iptal edin.`;
  else what = `nginx_ops işinin (job ${job}) iptal sonucu belirsiz. İşi AWX'te kontrol edip gerekirse HEMEN iptal edin.`;
  return (
    'AWX new_fleet değişkenini YOK SAYDI (launch yanıtı: ignored_fields); bu iş yeni filodaki tanımı da silerdi. ' +
    `${what} ${MIGRATION_JOB_WARNING} ${NEW_FLEET_BLOCK_MESSAGE}`
  );
}

/**
 * Template + (gerekirse) survey okunur. FIRLATMAZ: okunamayan her sey "olculemedi" olarak
 * assessNewFleetGuard'a gider ve orada fail-closed karar verilir. Hata metinleri
 * runner.redactSecrets'tan gecer.
 */
async function readNewFleetContract(serverId, templateId, { runner }) {
  const redact = (s) => (runner && typeof runner.redactSecrets === 'function' ? runner.redactSecrets(s) : String(s));
  const why = (e) => redact((e && e.message) || String(e));
  let template = null;
  let templateError = null;
  try {
    template = await runner.getTemplateLaunchSettingsOnServer(serverId, templateId);
    if (!template || typeof template !== 'object') {
      template = null;
      templateError = 'AWX template yanıtı boş';
    }
  } catch (e) {
    templateError = why(e);
  }
  let survey = null;
  if (template && template.surveyEnabled === true) {
    try {
      const s = await runner.getSurveySpecOnServer(serverId, templateId);
      survey = s && Array.isArray(s.spec) ? { measured: true, spec: s.spec } : { measured: false, error: 'survey yanıtı beklenmeyen biçimde' };
    } catch (e) {
      survey = { measured: false, error: why(e) };
    }
  }
  return { template, templateError, survey };
}

module.exports = {
  NEW_FLEET_VAR,
  NEW_FLEET_OFF,
  NEW_FLEET_BLOCK_MESSAGE,
  NEW_FLEET_OFF_VALUES,
  MIGRATION_JOB_WARNING,
  assessNewFleetGuard,
  surveyQuestionAcceptsFalse,
  surveyQuestionSideEffects,
  ignoredFieldsHasNewFleet,
  ignoredMessage,
  readNewFleetContract,
};
