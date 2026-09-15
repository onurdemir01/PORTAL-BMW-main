// server/ansible/choice-sources.cjs — Self Servis survey alanlari icin VERITABANINDAN
// beslenen secenek listeleri ("secenek kaynagi").
//
// NEDEN VAR (kullanici bildirimi, 2026-09-15): api_generator > rate_limit_change isinde
// `chosen_api` serbest metindi; kullanici "/x/y/v0/" yazdi, sunucudaki zone "/x/y/v0"
// idi ve is durdu. Serbest metin yerine envanterdeki GERCEK degerlerden secim yapilirsa
// bu sinif hata dogmadan onlenir. Playbook tarafindaki cozumleme (resolve_zone_base.sh)
// yine kalir — AWX'ten dogrudan calistirma icin.
//
// TASARIM:
//  * Bir alan (AWX survey alani override'i YA DA Survey Tasarimcisi ozel alani) `choicesSource`
//    tasiyabilir: { source: '<kaynak adi>', params: { <kaynak parametresi>: '<alan adi>' } }.
//    params, kaynagin istedigi parametreyi formdaki HANGI alandan alacagini soyler
//    (or. { env: 'env' } -> formdaki `env` alaninin degeri kaynaga env olarak gider).
//  * Istemci secenekleri /api/ansible/ss/choices/:source?env=... ile ceker; bagimli alan
//    degisince yeniden ceker. Alan <select> olur; serbest metin girilemez.
//  * Sunucu launch'ta AYNI kaynagi yeniden sorar ve gonderilen degeri listeye karsi
//    dogrular (istemciye guvenilmez). Kaynak cevap veremezse is BASLAMAZ (fail-closed):
//    dogrulanamayan bir degerle prod'a gitmektense kullaniciya "biraz sonra" demek yegdir.
//  * Kaynaklar burada KAYITLIDIR; admin ekrani listeyi /api/ansible/ss/choice-sources'tan
//    alir. Yeni kaynak = bu dosyaya bir kayit + (gerekirse) SQL.
'use strict';

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // key -> { at, choices }

function cacheKey(source, params) {
  return source + '|' + JSON.stringify(params || {});
}

// Ortam adlari: survey'de kucuk harf (dev/test/qa/prod), nginx-hosts.cjs'te buyuk
// (DEV/TEST/QA/PROD). Kaynak ikisini de kabul eder.
function normEnv(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  if (s === 'PRODUCTION') return 'PROD';
  return s;
}

const SOURCES = {
  // Denetim > Nginx API envanteri: dbo.NginxRateLimitInventory (nginx_ratelimit_inventory
  // job'i doldurur). Bir satir = (host, config_file, api_location). Ortam SUNUCU ADINDAN
  // turetilir (tabloda ortam kolonu yok, bkz. nginx-hosts.cjs). Kanal bilgisi tabloda
  // YOK (config_file yalnizca dosya adi) — bu yuzden kanal parametresi alinmaz.
  //
  // Iki tur deger doner: location yolu ("/das-.../v0") ve konfigurasyon dosya adi
  // (".conf" atilmis, "ORT.CST.REST...V1") — rate_limit_change ikisini de kabul eder.
  'nginx-api-locations': {
    label: 'Nginx API envanteri — API yolu / konfigürasyon adı (Denetim > Nginx API)',
    params: [{ name: 'env', label: 'Ortam alanı (dev/test/qa/prod)', required: true }],
    async load({ env }) {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { envOfHost } = require('../audit/nginx-hosts.cjs');
      const wantEnv = normEnv(env);
      if (!wantEnv) return [];
      const dateRes = await query(
        `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.NginxRateLimitInventory`,
      );
      const d = dateRes.recordset?.[0]?.d;
      if (!d) return [];
      const r = await query(
        `SELECT DISTINCT host, config_file, api_location
           FROM dbo.NginxRateLimitInventory
          WHERE scan_date = @d`,
        [{ name: 'd', type: sql.NVarChar(10), value: d }],
      );
      const locs = new Set();
      const confs = new Set();
      for (const row of r.recordset || []) {
        if (envOfHost(row.host) !== wantEnv) continue;
        const loc = String(row.api_location || '').trim();
        const conf = String(row.config_file || '').trim().replace(/\.conf$/i, '');
        if (loc) locs.add(loc);
        if (conf) confs.add(conf);
      }
      const out = [];
      for (const v of [...locs].sort()) out.push({ value: v, label: v, group: 'API yolu' });
      for (const v of [...confs].sort()) out.push({ value: v, label: v, group: 'Konfigürasyon dosyası' });
      return out;
    },
  },
};

function listSources() {
  return Object.entries(SOURCES).map(([name, s]) => ({ name, label: s.label, params: s.params }));
}

function getSource(name) {
  return SOURCES[String(name || '').trim()] || null;
}

/** Kaynak secenekleri (60 sn onbellek). Kaynak yoksa 404 tasiyan hata. */
async function loadChoices(sourceName, params) {
  const src = getSource(sourceName);
  if (!src) {
    throw Object.assign(new Error(`Bilinmeyen seçenek kaynağı: ${sourceName}`), { status: 404 });
  }
  const p = {};
  for (const def of src.params) {
    const v = String((params || {})[def.name] ?? '').trim();
    if (def.required && !v) return [];
    p[def.name] = v;
  }
  const key = cacheKey(sourceName, p);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.choices;
  const choices = await src.load(p);
  cache.set(key, { at: Date.now(), choices });
  return choices;
}

/**
 * Bir alanin choicesSource tanimindan, formdaki degerlere bakarak kaynak parametrelerini
 * kurar. `values` = kullanicinin gonderdigi (ya da gizli alanlar icin etkin) degerler.
 */
function paramsFromValues(choicesSource, values) {
  const out = {};
  const map = (choicesSource && choicesSource.params) || {};
  for (const [param, fieldName] of Object.entries(map)) {
    out[param] = values ? values[String(fieldName)] : undefined;
  }
  return out;
}

/**
 * Launch'ta dogrulama: deger kaynaktaki listede mi? Degilse {status:400}; kaynak
 * cevap vermezse {status:503} (fail-closed). Bos choicesSource -> dogrulama yok.
 */
async function assertValueInSource(choicesSource, value, values, label) {
  if (!choicesSource || !choicesSource.source) return;
  let choices;
  try {
    choices = await loadChoices(choicesSource.source, paramsFromValues(choicesSource, values));
  } catch (e) {
    throw Object.assign(
      new Error(
        `${label}: seçenek listesi doğrulanamadı (${e.message}). İş başlatılmadı — biraz sonra tekrar deneyin.`,
      ),
      { status: e.status === 404 ? 500 : 503 },
    );
  }
  if (!choices.some((c) => c.value === value)) {
    throw Object.assign(
      new Error(
        `Geçersiz seçim (${label}): "${value}" envanter listesinde yok. Listeden seçin; ` +
          `değer envantere yeni girdiyse bir sonraki taramayı bekleyin.`,
      ),
      { status: 400 },
    );
  }
}

/** Kayit zamani dogrulamasi: kaynak var mi, zorunlu parametreleri bir alana bagli mi. */
function validateChoicesSource(choicesSource, knownFieldNames) {
  if (!choicesSource) return null;
  const src = getSource(choicesSource.source);
  if (!src) return `Bilinmeyen seçenek kaynağı: "${choicesSource.source}"`;
  const map = choicesSource.params || {};
  for (const def of src.params) {
    const fieldName = String(map[def.name] || '').trim();
    if (def.required && !fieldName) return `"${def.label}" için bir form alanı seçilmemiş.`;
    if (fieldName && !knownFieldNames.includes(fieldName)) {
      return `Seçenek kaynağı tanımsız bir alana bağlı: "${fieldName}"`;
    }
  }
  return null;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  SOURCES,
  listSources,
  getSource,
  loadChoices,
  paramsFromValues,
  assertValueInSource,
  validateChoicesSource,
  normEnv,
  clearCache,
};
