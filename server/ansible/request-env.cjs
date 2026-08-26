// server/ansible/request-env.cjs — bir Self Service talebinin HANGI ORTAMA gittigini
// extra_vars'tan cikaran TEK kaynak.
//
// KURAL (kullanici, 2026-08-26 — "her zaman ve her zaman"):
//   extra_vars icinde `env` ya da `ortam` anahtari; degeri ortam adi.
// Anahtar ve deger HARF DUYARSIZ okunur: AWX survey'leri "ENV"/"Env" ya da
// "PROD"/"Production" gonderebiliyor.
//
// NEDEN AYRI DOSYA: bu kurali IKI ayri kapi kullaniyor — OCO kontrolu (yalniz
// production) ve ortam bazli Smart onayi. Iki yerde ayri ayri yazilsaydi zamanla
// birbirinden ayrisirlardi; ayrisma da "onay istenmesi gerekirken istenmedi" gibi
// SESSIZ bir guvenlik bosluguna donusurdu.
//
// NEDEN YAPILANDIRILABILIR DEGIL: bu bir guvenlik kapisinin girdisi. Admin ekranindan
// degistirilebilir olsaydi, DB'de kalmis bayat bir ayar ortam tespitini sessizce
// bozabilirdi (portal yapilandirmasinda ayni tuzaga daha once dusuldu).
'use strict';

const ENV_KEYS = ['env', 'ortam'];

// Kanonik ortam adlari ve kabul edilen yazimlari. "production" -> "prod" gibi.
const ENV_ALIASES = {
  dev: ['dev', 'development'],
  test: ['test'],
  qa: ['qa'],
  prod: ['prod', 'production'],
};

const ALL_ENVS = Object.keys(ENV_ALIASES);

function canonicalEnv(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  for (const [canon, aliases] of Object.entries(ENV_ALIASES)) {
    if (aliases.includes(v)) return canon;
  }
  return null;
}

// extra_vars icindeki env/ortam alanindan kanonik ortami dondurur.
// Alan yoksa ya da degeri taninmiyorsa null doner - CAGIRAN TARAF bu durumda
// GUVENLI tarafa dusmelidir (bkz. smart-gate.cjs).
function detectEnvironment(extraVars) {
  if (!extraVars || typeof extraVars !== 'object') return null;
  for (const [k, v] of Object.entries(extraVars)) {
    if (!ENV_KEYS.includes(String(k).trim().toLowerCase())) continue;
    const canon = canonicalEnv(v);
    if (canon) return canon;
  }
  return null;
}

module.exports = { detectEnvironment, canonicalEnv, ENV_KEYS, ENV_ALIASES, ALL_ENVS };
