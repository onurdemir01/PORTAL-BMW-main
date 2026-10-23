// server/selfservice/api-generator-secim.cjs - Self Servis > Nginx API Generator: rate limit icin API
// SECIMI (2026-10-22).
//
// Kullanici: "rate limit degistirmeye tikladiklarinda ilgili API'yi elle degil oradan drop down menuden
// secerek girmelerini rica ediyorum." API kapatma / acma (selected_api, active_api, deactive_api)
// kullanicinin AWX survey'ine elle ekledigi statik listedir: bu modul onlara DOKUNMAZ.
//
// NE YAPAR: sablonun playbook'u bmw_nginx/api_generator/api_generator.yaml ise `chosen_api` alani
// KODLA envanter listesine (choice-sources 'nginx-api-gateway-confs') baglanir ve yalnizca
// op_selection rate_limit_change ya da read iken gosterilir (ikisi de chosen_api'yi konfigurasyon adi
// olarak kullanir; activate / deactivate / create / delete'te alan sorulmaz ve gonderilmez).
//
// NEDEN KOD (DB ayari degil): alan ayarlari ansible_ss_customizations'ta durur ve bayat bir DB satiri
// kod varsayilanini ezer (2026-09-16 "ayar kayboldu" olayi). Bagi bir yoneticinin hatirlamasina
// birakmak yerine KOD KAZANIR: DB'deki eksik / bos / farkli choicesSource yok sayilir; DB'deki etiket
// ve varsayilan deger korunur.
//
// SABLON TANIMA: playbook yolu (baslik / ad / ID degil), nginx-tanim-okuma.cjs ile ayni desen.
// GIRDI ASLA DEGISTIRILMEZ: readCustom onbellekteki nesneyi referansla dondurur; yerinde degisiklik
// admin kaydiyla DB'ye sizardi.
'use strict';

const T = (s) => String(s == null ? '' : s).trim();
const PLAYBOOK_RE = /(^|\/)api_generator\/api_generator\.ya?ml$/i;
const ALAN = 'chosen_api';
const ISLEM_ALANI = 'op_selection';
const ISLEMLER = ['rate_limit_change', 'read'];
const KAYNAK = 'nginx-api-gateway-confs';

function apiGeneratorMi(detail) {
  return PLAYBOOK_RE.test(T(detail && detail.playbook));
}

// Kaynak parametreleri: ortam zorunlu; site (production'da Pendik / Ankara) listeyi daraltir. Kanal
// production'da mblcustomers / customers / mcustomers kumesini secer ve rate_limit_change icin orada
// ZORUNLUDUR (job da kanalsiz durur; kaynak acik mesajla reddeder); `islem` (op_selection) read ise
// zorunlu degil (okuma bir sey degistirmez, job tum sunucularda okur). Non-prod'da kanal yok sayilir.
// `details`: secilen konfigurasyonla ayni zone'u paylasan, birlikte etkilenecek API uclari formda
// secimin saginda gosterilir (kullanici, 2026-10-22).
const kaynakTanimi = () => ({
  source: KAYNAK,
  params: { env: 'env', site: 'site', channel: 'channel', islem: ISLEM_ALANI },
  optional: ['site', 'channel', 'islem'],
  details: true,
});
const kosul = () => ({
  mode: 'any',
  conditions: ISLEMLER.map((v) => ({ field: ISLEM_ALANI, equals: v })),
});

/** chosen_api icin kodla verilen AWX alan ayari (DB'deki etiket / varsayilan korunur). */
function kodBaglama(eski) {
  const o = eski || {};
  return {
    fieldName: ALAN,
    ...(o.label ? { label: o.label } : {}),
    ...(o.defaultValue !== undefined ? { defaultValue: o.defaultValue } : {}),
    hidden: false,
    choicesSource: kaynakTanimi(),
    dependsOn: kosul(),
    requiredWhenActive: true,
    kodlaBagli: true,
  };
}

/**
 * Survey Tasarimcisi (AWX survey kapali) alani icin AYNI bag: kaynak + kosul kodla verilir, alan
 * yalniz kosul saglanirken sorulur ve o zaman zorunludur (resolveCustomSurveyExtraVars kosulu
 * saglanmayan alani dogrulamaz / gondermez). Etiket, aciklama ve tip yoneticide kalir.
 */
function kodTasarimciAlani(alan) {
  return {
    ...alan,
    hidden: false,
    required: true,
    choicesSource: kaynakTanimi(),
    dependsOn: kosul(),
    kodlaBagli: true,
  };
}

/**
 * Etkin alan ayarlari: api_generator sablonunda chosen_api kodla baglanir (AWX alan ayari VE varsa
 * Survey Tasarimcisi alani); diger sablonlarda girdi AYNEN (ayni nesne) doner.
 */
function etkinOverrides(detail, overrides) {
  if (!apiGeneratorMi(detail)) return overrides;
  const base = overrides || {};
  const liste = Array.isArray(base.fieldOverrides) ? base.fieldOverrides : [];
  const eski = liste.find((o) => o && o.fieldName === ALAN);
  const out = {
    ...base,
    fieldOverrides: [...liste.filter((o) => !o || o.fieldName !== ALAN), kodBaglama(eski)],
  };
  if (Array.isArray(base.customSurveyFields)) {
    out.customSurveyFields = base.customSurveyFields.map((f) =>
      f && String(f.name || '').trim() === ALAN ? kodTasarimciAlani(f) : f,
    );
  }
  return out;
}

module.exports = { PLAYBOOK_RE, ALAN, ISLEM_ALANI, ISLEMLER, KAYNAK, apiGeneratorMi, kodBaglama, kodTasarimciAlani, etkinOverrides };
