// shared/surveyConditions.cjs - Survey Tasarimcisi "kosullu goster" mantiginin TEK
// dogruluk kaynagi.
//
// NEDEN PAYLASILAN DOSYA: bu mantik hem ISTEMCIDE (alani gosterip gizlemek icin) hem
// SUNUCUDA (kosulu saglanmayan alani dogrulamamak ve extra_vars'a EKLEMEMEK icin)
// calisir. Iki kopya birbirinden ayrisirsa alan istemcide gizli gorunurken sunucu onu
// yine de gonderir (ya da tersi) - sessiz ve teshisi zor bir hata. Bu yuzden iki taraf
// da AYNI fonksiyonu cagirir.
//
// YETKI: sunucu tarafi baglayicidir. Istemci yalnizca UX icin ayni sonucu onceden
// hesaplar; gercek karar launch sirasinda sunucuda verilir.
//
// -- VERI MODELI --------------------------------------------------------------
//   dependsOn = {
//     mode: 'all' | 'any',                 // GRUPLAR arasi baglac (varsayilan 'all')
//     groups?: [ { mode, conditions[] } ], // YENI: iki duzeyli VE/VEYA
//     conditions?: [ ... ],                // ESKI: tek duz liste (geriye donuk uyum)
//   }
//
// Ornek - "ortam X VEYA Y VEYA Z" VE "operasyon P":
//   { mode: 'all', groups: [
//       { mode: 'any', conditions: [ {field:'env',equals:'X'}, {field:'env',equals:'Y'},
//                                    {field:'env',equals:'Z'} ] },
//       { mode: 'all', conditions: [ {field:'op',equals:'P'} ] } ] }
//
// GERIYE DONUK UYUM: `groups` yoksa (ya da hepsi bossa) eski `conditions` listesi
// `mode` ile degerlendirilir - kayitli mevcut survey'lerin davranisi DEGISMEZ.
'use strict';

/** Tek bir kosul. values: { alanAdi: deger } */
function evaluateCondition(cond, values) {
  if (!cond || !cond.field) return false;
  const raw = values ? values[cond.field] : undefined;
  const val = raw === undefined || raw === null ? '' : String(raw).trim();
  return cond.operator === 'notEmpty' ? val !== '' : val === (cond.equals ?? '');
}

/** Bir kosul listesini kendi baglaciyla degerlendirir. mode='any' -> VEYA, aksi halde VE. */
function evaluateList(conditions, mode, values) {
  const list = Array.isArray(conditions) ? conditions : [];
  if (list.length === 0) return true;
  const results = list.map((c) => evaluateCondition(c, values));
  return mode === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** dependsOn icindeki DOLU gruplar (bos gruplar YOK SAYILIR - yarim kalmis bir grup
 *  alani sessizce gizlememeli). */
function nonEmptyGroups(dependsOn) {
  if (!dependsOn || !Array.isArray(dependsOn.groups)) return [];
  return dependsOn.groups.filter(
    (g) => g && Array.isArray(g.conditions) && g.conditions.length > 0,
  );
}

/**
 * Alan gosterilmeli mi?  Kosul YOKSA her zaman true (bugunku davranis).
 * @param {object|undefined} dependsOn
 * @param {Record<string, unknown>} values
 */
function isFieldActive(dependsOn, values) {
  if (!dependsOn) return true;
  const groups = nonEmptyGroups(dependsOn);
  if (groups.length > 0) {
    const results = groups.map((g) => evaluateList(g.conditions, g.mode, values));
    return dependsOn.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
  }
  return evaluateList(dependsOn.conditions, dependsOn.mode, values);
}

/** Kayit dogrulamasi ve "kendine bagli olma" kontrolu icin: TUM kosullar tek listede. */
function allConditions(dependsOn) {
  if (!dependsOn) return [];
  const flat = Array.isArray(dependsOn.conditions) ? dependsOn.conditions : [];
  const grouped = Array.isArray(dependsOn.groups)
    ? dependsOn.groups.flatMap((g) => (g && Array.isArray(g.conditions) ? g.conditions : []))
    : [];
  return [...flat, ...grouped];
}

/** dependsOn hic kosul tasimiyor mu? (kayitta reddedilir) */
function hasNoConditions(dependsOn) {
  return allConditions(dependsOn).length === 0;
}

module.exports = {
  evaluateCondition,
  evaluateList,
  nonEmptyGroups,
  isFieldActive,
  allConditions,
  hasNoConditions,
};
