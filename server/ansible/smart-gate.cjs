// server/ansible/smart-gate.cjs — "bu TALEP icin Smart onayi gerekli mi?"
//
// 2026-08-27 (kullanici talebi): Smart onayi artik servis duzeyinde ac/kapa olmaktan
// cikti; TALEBIN ALAN DEGERLERINE gore atlanabiliyor. Ornek: "Nginx - RVP Operations"
// servisinde op_selection=read yalnizca OKUMA yapar, hicbir sey degistirmez - onay
// beklemesi gereksiz. Ayni servisin create/update/delete talepleri onaya tabi kalir.
//
// ── YON: "ISTISNA LISTESI", "IZIN LISTESI" DEGIL ────────────────────────────────
// Kural "su durumlarda onay ISTENMESIN" seklinde yazilir; varsayilan HER ZAMAN
// "onay gerekli"dir. Ters tasarim ("yalnizca su durumlarda istensin") daha esnek
// gorunur ama HATAYA ACIK YONDE bozulur: kuraldaki bir yazim hatasi, prod'u degistiren
// bir talebin onaysiz gecmesi demek olurdu. Bu yonde ise ayni yazim hatasi yalnizca
// gereksiz bir onay istegine yol acar - gurultu, guvenlik acigi degil.
//
// ── KURAL BICIMI ────────────────────────────────────────────────────────────────
//   <alan>: <deger>[, <deger2> ...]      -> her satir BIR kural
// Satirlar arasinda VEYA: HERHANGI biri tutarsa onay atlanir.
// Bir satirdaki virgullu degerler de VEYA.
//   op_selection: read
//   op_selection: read, list
//   action: read
// "#" ile baslayan ve bos satirlar yok sayilir.
//
// Alan adi ve deger BUYUK/KUCUK HARF DUYARSIZ, bastaki/sondaki bosluklar atilir:
// AWX survey'leri ayni alani "READ"/"Read" diye gonderebiliyor ve harf farki yuzunden
// onayin ISTENMESI (guvenli taraf) sasirtici olurdu.
//
// Kuralda gecen alan talepte HIC YOKSA kural TUTMAZ -> onay istenir (guvenli taraf).
'use strict';

// Ham metni kural listesine cevirir. Gecersiz satirlar AYRICA dondurulur ki admin
// arayuzu/loglar "yazdim ama calismiyor" durumunu gosterebilsin - sessizce yutmak,
// atlanmasi beklenen bir talebin onaya takilmasini aciklanamaz kilardi.
function parseSkipRules(raw) {
  const rules = [];
  const invalid = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf(':');
    if (i <= 0) { invalid.push(s); continue; }
    const field = s.slice(0, i).trim().toLowerCase();
    const values = s.slice(i + 1).split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (!field || values.length === 0) { invalid.push(s); continue; }
    rules.push({ field, values });
  }
  return { rules, invalid };
}

// extraVars'ta alanı HARF DUYARSIZ arar (AWX survey adlari tutarsiz olabiliyor).
function lookupField(extraVars, field) {
  if (!extraVars || typeof extraVars !== 'object') return undefined;
  for (const [k, v] of Object.entries(extraVars)) {
    if (String(k).trim().toLowerCase() === field) return v;
  }
  return undefined;
}

// Onay atlanmali mi? Atlaniyorsa hangi kural yuzunden atlandigi da doner (audit/log icin).
function matchSkip(smartApproval, extraVars) {
  const { rules } = parseSkipRules(smartApproval && smartApproval.skipWhen);
  for (const r of rules) {
    const actual = lookupField(extraVars, r.field);
    if (actual === undefined || actual === null) continue;
    const a = String(actual).trim().toLowerCase();
    if (a && r.values.includes(a)) return { skip: true, field: r.field, value: a };
  }
  return { skip: false };
}

function isSmartRequired(smartApproval, extraVars) {
  if (!smartApproval || !smartApproval.enabled) return false;
  return !matchSkip(smartApproval, extraVars).skip;
}

module.exports = { isSmartRequired, matchSkip, parseSkipRules };
