// server/scalex/config.cjs — ScaleX'in AYARLANABILIR sinirlari.
//
// KULLANICI ISTEGI (2026-09-17): "scalex deki timeout vb yapilari da admin ekranindan
// verebilecek ve bu degiskenleri de degistirince dinamik calisacak algilayacak yapida
// olmali."
//
// ── NEDEN AYRI BIR MODUL VE NEDEN HER CAGRIDA OKUYOR ────────────────────────
//
// Admin > Sistem ekrani `portal_env_overrides` tablosuna yazar ve `setEnvOverride`
// AYNI ANDA `process.env`i de gunceller (server/db/env-overrides.cjs). Yani deger
// zaten ANINDA hazir. Portalin geri kalaninda ayarlar DINAMIK DEGIL, cunku moduller
// env'i BOOT'TA bir kez okuyup sabite donduruyor:
//
//     const X = Number(process.env.X) || 300;   // <- bir daha ASLA okunmaz
//
// Bu dosyada ONE SABIT YOK. Her `readTunables()` cagrisi `process.env`i YENIDEN
// okur; admin degeri degistirdiginde SONRAKI ISTEK yeni degerle calisir, restart
// GEREKMEZ. Bekci (scalex-dinamik-ayarlar.test.cjs) bunu ayni proses icinde
// `process.env`i degistirip KANITLAR — kaynak taramasiyla degil.
//
// ── TUTARSIZ AYAR SESSIZCE UYGULANMAZ ───────────────────────────────────────
//
// Admin `MIN`i `MAX`tan buyuk yazabilir ya da `DEFAULT`i araligin disina koyabilir.
// Boyle bir uclu SESSIZCE kabul edilirse ekran "30-10 arasi bir deger girin" gibi
// anlamsiz bir sey yazar ve her istek reddedilir. Tutarsiz uclu TAMAMEN yok sayilir
// (fabrika degerlerine dusulur) ve sebep `problems` ile ADMIN EKRANINA tasinir.
'use strict';

/**
 * Ayarlanabilir anahtarlar. `fallback` = kod icindeki fabrika degeri; admin hicbir
 * sey yazmadiysa (ya da yazdigi sey gecersizse) bu gecerlidir.
 *
 * `hard` sinirlari ADMIN DE ASAMAZ: bunlar guvenlik/kaynak korumasi. Ornegin
 * `SCALEX_MAX_TARGETS`i 100000 yapmak tek isle butun ortami durdurabilmek demekti.
 */
const TUNABLES = Object.freeze({
  SCALEX_VERIFY_TIMEOUT_DEFAULT: { fallback: 300, hardMin: 5, hardMax: 86400 },
  SCALEX_VERIFY_TIMEOUT_MIN: { fallback: 30, hardMin: 1, hardMax: 86400 },
  SCALEX_VERIFY_TIMEOUT_MAX: { fallback: 3600, hardMin: 5, hardMax: 86400 },
  // Kapatmada FAIL esigi = uyari esigi x bu carpan (kullanici karari: 5 dk uyar,
  // 10 dk fail). Acmada FAIL YOK — carpan orada kullanilmaz.
  SCALEX_VERIFY_FAIL_MULTIPLIER: { fallback: 2, hardMin: 1, hardMax: 20 },
  SCALEX_MAX_TARGETS: { fallback: 200, hardMin: 1, hardMax: 2000 },
  SCALEX_PROD_CONFIRM_THRESHOLD: { fallback: 5, hardMin: 1, hardMax: 1000 },
  // Sapma taramasinda es zamanli AWX isi tavani (StoppedPanel).
  SCALEX_MAX_AUDIT_GROUPS: { fallback: 12, hardMin: 1, hardMax: 200 },
});

/** Tek anahtari okur; gecersizse `null` + sebep. Fabrika degerine DUSURMEZ. */
function readOne(key) {
  const spec = TUNABLES[key];
  const raw = String(process.env[key] ?? '').trim();
  if (!raw) return { value: spec.fallback, source: 'default', problem: null };
  if (!/^[0-9]{1,7}$/.test(raw)) {
    return { value: spec.fallback, source: 'default', problem: `${key}: "${raw}" bir tam sayı değil — fabrika değeri (${spec.fallback}) kullanılıyor.` };
  }
  const n = Number(raw);
  if (n < spec.hardMin || n > spec.hardMax) {
    return { value: spec.fallback, source: 'default', problem: `${key}: ${n} izin verilen aralığın (${spec.hardMin}–${spec.hardMax}) dışında — fabrika değeri (${spec.fallback}) kullanılıyor.` };
  }
  return { value: n, source: 'admin', problem: null };
}

/**
 * TUM ayarlari OKUMA ANINDA uretir. Sonuc ONBELLEGE ALINMAZ — dinamiklik bu.
 *
 * @returns {{values: Object, sources: Object, problems: string[]}}
 */
function readTunables() {
  const values = {};
  const sources = {};
  const problems = [];
  for (const key of Object.keys(TUNABLES)) {
    const r = readOne(key);
    values[key] = r.value;
    sources[key] = r.source;
    if (r.problem) problems.push(r.problem);
  }

  // ── TUTARLILIK: min <= default <= max ──────────────────────────────────────
  // Uclu tutarsizsa UCUNU BIRDEN fabrika degerine dondururuz. Yalnizca birini
  // duzeltmek, admin'in yazmadigi bir kombinasyonu uydurmak olurdu.
  const min = values.SCALEX_VERIFY_TIMEOUT_MIN;
  const max = values.SCALEX_VERIFY_TIMEOUT_MAX;
  const def = values.SCALEX_VERIFY_TIMEOUT_DEFAULT;
  if (!(min <= def && def <= max && min < max)) {
    problems.push(
      `Doğrulama bütçesi üçlüsü tutarsız (min=${min}, varsayılan=${def}, max=${max}). ` +
        'Üçü birden fabrika değerlerine (30 / 300 / 3600) döndürüldü; ' +
        'min ≤ varsayılan ≤ max olacak şekilde düzeltin.',
    );
    for (const k of ['SCALEX_VERIFY_TIMEOUT_MIN', 'SCALEX_VERIFY_TIMEOUT_DEFAULT', 'SCALEX_VERIFY_TIMEOUT_MAX']) {
      values[k] = TUNABLES[k].fallback;
      sources[k] = 'default';
    }
  }
  return { values, sources, problems };
}

/** Kisayol: tek bir ayarin GUNCEL degeri. */
function tunable(key) {
  return readTunables().values[key];
}

/** Ekranin ihtiyaci olan sekil — `GET /api/scalex/config` bunu doner. */
function publicConfig() {
  const { values, sources, problems } = readTunables();
  return {
    verificationTimeout: {
      default: values.SCALEX_VERIFY_TIMEOUT_DEFAULT,
      min: values.SCALEX_VERIFY_TIMEOUT_MIN,
      max: values.SCALEX_VERIFY_TIMEOUT_MAX,
      failMultiplier: values.SCALEX_VERIFY_FAIL_MULTIPLIER,
    },
    maxTargets: values.SCALEX_MAX_TARGETS,
    prodConfirmThreshold: values.SCALEX_PROD_CONFIRM_THRESHOLD,
    maxAuditGroups: values.SCALEX_MAX_AUDIT_GROUPS,
    sources,
    problems,
  };
}

module.exports = { TUNABLES, readTunables, tunable, publicConfig };
