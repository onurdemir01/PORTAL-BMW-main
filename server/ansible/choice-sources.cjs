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

// ORTAM -> OpenShift cluster adlari: LogX/OpsX'in kullandigi AYNI katalog
// (ocp_cluster_index; tree[env][tenant] = [cluster...]). nginx_ops'ta tenant secimi
// yoktur; ortamin TUM tenant'larindaki cluster'lar birlestirilir. Katalogda o ortam
// yoksa bos doner; cagiran namespace son-eki (`-test`) ile geri duser.
// `tenant` verilirse (or. 'ark' — RVP tanimlari YALNIZCA ARK cluster'i icin yapilir,
// 2026-09-15 kullanici kurali) yalniz o tenant'in cluster'lari; yoksa ortamin tumu.
async function clustersForEnv(env, tenant) {
  const key = String(env || '').trim().toLowerCase();
  const ten = String(tenant || '').trim().toLowerCase();
  if (!key) return [];
  try {
    const tree = await require('../logx/v2/admin.cjs').getClusterTree();
    const byEnv = Object.entries(tree || {}).find(([k]) => String(k).toLowerCase() === key);
    if (!byEnv) return [];
    const groups = Object.entries(byEnv[1]).filter(([t]) => !ten || String(t).toLowerCase() === ten);
    return [...new Set(groups.map(([, cs]) => cs).flat().map((c) => String(c || '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

// SPA uygulamasi: Nginx SPA tanimi yalnizca bu ada sahip uygulamalar icin yapilir
// (Denetim > Nginx SPA ile AYNI kural — nginx-migration.cjs SPA_RE).
const SPA_RE = /-app(-emb)?-v/i;

// dbo.Openshift_Inventory: ortamin cluster'larindaki (namespace, application) ciftleri.
// Cluster katalogu bos ise namespace son-eki ile daralir (digital-ch-test -> test).
async function ocpPairsForEnv(env, tenant) {
  const { query, sql } = require('../inventory/mssql.cjs');
  const clusters = await clustersForEnv(env, tenant);
  let rows;
  if (clusters.length) {
    const params = clusters.map((c, i) => ({ name: `c${i}`, type: sql.NVarChar(128), value: c }));
    const ph = clusters.map((_, i) => `@c${i}`).join(', ');
    rows = (
      await query(
        `SELECT DISTINCT namespace, application FROM dbo.Openshift_Inventory WHERE cluster IN (${ph})`,
        params,
      )
    ).recordset;
  } else {
    // Katalogda o ortam/tenant yoksa: tenant verilmisse BOS doner (yanlis cluster'in
    // namespace'lerini listelemektense hic listelememek yegdir); tenant yoksa son-ek.
    if (String(tenant || '').trim()) return [];
    const suffix = '%-' + String(env || '').trim().toLowerCase();
    rows = (
      await query(
        `SELECT DISTINCT namespace, application FROM dbo.Openshift_Inventory WHERE LOWER(namespace) LIKE @s`,
        [{ name: 's', type: sql.NVarChar(64), value: suffix }],
      )
    ).recordset;
  }
  return (rows || []).map((r) => ({
    namespace: String(r.namespace || '').trim(),
    application: String(r.application || '').trim(),
  }));
}

// dbo.Nginx_Config_Audit (nginx_config_audit job'i): son taramadaki SPA location'lari.
async function nginxAuditRows(env, service) {
  const { query, sql } = require('../inventory/mssql.cjs');
  const params = [{ name: 'e', type: sql.NVarChar(16), value: normEnv(env) }];
  let where = `scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Config_Audit) AND UPPER(env) = @e`;
  const svc = String(service || '').trim().toUpperCase();
  if (svc) {
    where += ` AND UPPER(service) = @svc`;
    params.push({ name: 'svc', type: sql.NVarChar(64), value: svc });
  }
  const r = await query(
    `SELECT DISTINCT service, location_path, application, namespace, host
       FROM dbo.Nginx_Config_Audit WHERE ${where}`,
    params,
  );
  return r.recordset || [];
}

const SOURCES = {
  // Self Servis > Nginx - RVP Operations (nginx_ops): OpenShift namespace'leri. LogX/OpsX
  // ile AYNI envanter tablosu (Openshift_Inventory), ortam cluster katalogundan.
  'ocp-namespaces': {
    label: 'OpenShift namespace listesi (Openshift Uygulama Envanteri, ortam + cluster grubu)',
    params: [{ name: 'env', label: 'Ortam alanı (dev/test/qa/prod)', required: true }],
    // SABIT secenekler (form alanina bagli degil; admin ekraninda metin olarak girilir).
    // tenant: ocp_cluster_index.tenant (LogX/OpsX ile ayni katalog) — RVP icin 'ark'.
    options: [{ name: 'tenant', label: 'Cluster grubu (tenant, ör. ark)', default: 'ark' }],
    async load({ env, tenant }) {
      const pairs = await ocpPairsForEnv(env, tenant);
      const count = new Map();
      for (const p of pairs) {
        if (!p.namespace) continue;
        if (!count.has(p.namespace)) count.set(p.namespace, 0);
        if (SPA_RE.test(p.application)) count.set(p.namespace, count.get(p.namespace) + 1);
      }
      // SPA'si olan namespace'ler once — nginx_ops SPA tanimi icin anlamli olanlar onlar.
      return [...count.entries()]
        .sort((a, b) => (b[1] > 0) - (a[1] > 0) || a[0].localeCompare(b[0]))
        .map(([ns, n]) => ({
          value: ns,
          label: n ? `${ns}  (${n} SPA)` : ns,
          group: n ? 'SPA uygulaması olan' : 'SPA uygulaması yok',
        }));
    },
  },

  // Secilen namespace'teki YALNIZCA SPA uygulamalari (-app-v / -app-emb-v adli).
  'ocp-spa-applications': {
    label: 'OpenShift SPA uygulamaları (seçilen namespace, yalnızca *-app-v* adlılar)',
    params: [
      { name: 'env', label: 'Ortam alanı', required: true },
      { name: 'namespace', label: 'Namespace alanı', required: true },
    ],
    options: [{ name: 'tenant', label: 'Cluster grubu (tenant, ör. ark)', default: 'ark' }],
    async load({ env, namespace, tenant }) {
      const ns = String(namespace || '').trim();
      const pairs = await ocpPairsForEnv(env, tenant);
      const apps = [...new Set(pairs.filter((p) => p.namespace === ns && SPA_RE.test(p.application)).map((p) => p.application))];
      return apps.sort().map((a) => ({ value: a, label: a }));
    },
  },

  // Reverse proxy servisleri (GLOMO, WEBFORMS, ...): son nginx_config_audit taramasinda
  // o ortamda gorulen vhost servisleri.
  'nginx-services': {
    label: 'Nginx reverse proxy servisleri (GLOMO, WEBFORMS… — Nginx SPA denetimi)',
    params: [{ name: 'env', label: 'Ortam alanı', required: true }],
    async load({ env }) {
      const rows = await nginxAuditRows(env, '');
      const svcs = [...new Set(rows.map((r) => String(r.service || '').trim().toUpperCase()).filter(Boolean))];
      return svcs.sort().map((s) => ({ value: s, label: s }));
    },
  },

  // Mevcut location tanimlari (update/delete icin "eski" path): ortam + servis; namespace
  // ve uygulama verilirse o uygulamanin location'larina daralir (opsiyonel).
  'nginx-locations': {
    label: 'Mevcut Nginx location tanımları (ortam + servis; update/delete için)',
    params: [
      { name: 'env', label: 'Ortam alanı', required: true },
      { name: 'service', label: 'Servis alanı', required: true },
      { name: 'namespace', label: 'Namespace alanı (opsiyonel daraltma)', required: false },
      { name: 'application', label: 'Uygulama alanı (opsiyonel daraltma)', required: false },
    ],
    async load({ env, service, namespace, application }) {
      const rows = await nginxAuditRows(env, service);
      const ns = String(namespace || '').trim();
      const app = String(application || '').trim();
      const byPath = new Map();
      for (const r of rows) {
        const path = String(r.location_path || '').trim();
        if (!path) continue;
        if (ns && String(r.namespace || '').trim() !== ns) continue;
        if (app && String(r.application || '').trim() !== app) continue;
        const who = [r.application, r.namespace].filter(Boolean).join(' / ');
        if (!byPath.has(path)) byPath.set(path, who);
      }
      return [...byPath.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([path, who]) => ({ value: path, label: who ? `${path}  —  ${who}` : path }));
    },
  },

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
  return Object.entries(SOURCES).map(([name, s]) => ({
    name,
    label: s.label,
    params: s.params,
    options: s.options || [],
  }));
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
  // Sabit secenekler: istekte varsa o, yoksa kaynak varsayilani.
  for (const def of src.options || []) {
    const v = String((params || {})[def.name] ?? '').trim();
    p[def.name] = v || String(def.default ?? '');
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
  // Sabit secenekler (admin ekraninda girilen; or. tenant=ark) parametrelere eklenir.
  for (const [k, v] of Object.entries((choicesSource && choicesSource.options) || {})) {
    if (String(v ?? '').trim()) out[k] = String(v).trim();
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
  SPA_RE,
  clustersForEnv,
  listSources,
  getSource,
  loadChoices,
  paramsFromValues,
  assertValueInSource,
  validateChoicesSource,
  normEnv,
  clearCache,
};
