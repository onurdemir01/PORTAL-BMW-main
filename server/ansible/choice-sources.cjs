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
// ── ONBELLEK SINIRLARI ──────────────────────────────────────────────────────
//
// Anahtar KULLANICI GIRDISINI tasiyor: `cacheKey` survey form degerlerini
// (`paramsFromValues`) JSON'a ceviriyor. TTL ise yalnizca OKUMADA kontrol
// ediliyordu; suresi dolan giris HIC SILINMIYORDU. Yani her yeni parametre
// bilesimi KALICI bir giris birakiyor ve her giris tam bir secenek listesi
// (on binlerce cift olabilir) tutuyordu.
//
// Portal 2026-09'da yedi kez OOM ile coktu; kullanici anahtarli budanmayan
// Map'ler o taramada ayri bir risk kalemiydi (`server/dynatrace/cache.cjs` ile
// ayni sinif, PR #109'da kapatilmisti).
//
// Desen `server/audit/response-cache.cjs`ten: MAX_ENTRIES + FIFO + TTL'de silme.
const CACHE_MAX_ENTRIES = 64;
const cache = new Map(); // key -> { at, choices }

function cacheKey(source, params) {
  return source + '|' + JSON.stringify(params || {});
}

// Ortam adlari: survey'de kucuk harf (dev/test/qa/prod), nginx-hosts.cjs'te buyuk
// (DEV/TEST/QA/PROD). Kaynak ikisini de kabul eder.
function normEnv(v) {
  const s = String(v || '')
    .trim()
    .toUpperCase();
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
  const key = String(env || '')
    .trim()
    .toLowerCase();
  const ten = String(tenant || '')
    .trim()
    .toLowerCase();
  if (!key) return [];
  try {
    const tree = await require('../logx/v2/admin.cjs').getClusterTree();
    const byEnv = Object.entries(tree || {}).find(([k]) => String(k).toLowerCase() === key);
    if (!byEnv) return [];
    const groups = Object.entries(byEnv[1]).filter(
      ([t]) => !ten || String(t).toLowerCase() === ten,
    );
    return [
      ...new Set(
        groups
          .map(([, cs]) => cs)
          .flat()
          .map((c) => String(c || '').trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

// SPA uygulamasi: Nginx SPA tanimi yalnizca bu ada sahip uygulamalar icin yapilir.
// Kural TEK KAYNAKTA (Denetim ekranlariyla ayni): server/audit/spa-pattern.cjs.
const { SPA_RE, isSpaApp } = require('../audit/spa-pattern.cjs');

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
    const suffix =
      '%-' +
      String(env || '')
        .trim()
        .toLowerCase();
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
  const svc = String(service || '')
    .trim()
    .toUpperCase();
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
        if (isSpaApp(p.application)) count.set(p.namespace, count.get(p.namespace) + 1);
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
      const apps = [
        ...new Set(
          pairs
            .filter((p) => p.namespace === ns && isSpaApp(p.application))
            .map((p) => p.application),
        ),
      ];
      return apps.sort().map((a) => ({ value: a, label: a }));
    },
  },

  // ── (namespace, uygulama) -> ROUTE ADRESI (kullanici, 2026-10-06) ────────────────────
  //
  // "Artik Nginx Reverse Proxy tanimlari yeni yapiya uygun yapilmali. Ancak halen eski
  //  sunuculara deployment gidecek... Reverse Proxy Production isteklerini namespace'e
  //  uygulama ismi alarak yaptirtmak istiyorum. Eski sunuculara da sanki input URL gelmis
  //  gibi davranilmasi lazim: ilgili namespace'e uygulamaya tanimli root'u bulup ona gore
  //  tanim yapilmasi gerekiyor."
  //
  // BU KAYNAK `input_url` ALANINA BAGLANIR. Isteyen namespace ve uygulamayi secer, URL'i
  // ELLE YAZMAZ: liste envanterden gelir. Boylece
  //   * eski GBRVP* akisi (prod_create.yaml) HIC DEGISMEZ - ona yine gercek bir input_url
  //     gider, "sanki URL girilmis gibi" davranir,
  //   * yeni filo akisinin ileri cozumlemesi (nginx_url_resolve.py) BIREBIR FQDN
  //     eslesmesiyle ilk adimda tutar, "birden fazla aday" (rc 91) durumuna girmez,
  //   * elle yazilmis yanlis URL sisteme HIC giremez: Self Servis launch aninda kaynagi
  //     yeniden sorup degeri listeye karsi dogruluyor (assertValueInSource) - fail-closed.
  //
  // COKLU ROUTE: otomatik secim YAPILMAZ, hepsi listelenir ve isteyen secer (kullanici
  // karari 2026-10-06). Termination tipi etikete yazilir, cunku uygulamanin AGINI o
  // belirliyor (passthrough=internet, reencrypt=intranet) - yanlisini secmek proxy_pass'i
  // yanlis uca yazar. ROUTE YOKSA: liste BOS doner ve is baslatilamaz; URL uydurulmaz.
  'ocp-app-routes': {
    label: 'OpenShift route adresleri (seçilen namespace + uygulama; input_url için)',
    params: [
      { name: 'env', label: 'Ortam alanı', required: true },
      { name: 'namespace', label: 'Namespace alanı', required: true },
      { name: 'application', label: 'Uygulama alanı', required: true },
    ],
    options: [{ name: 'tenant', label: 'Cluster grubu (tenant, ör. ark)', default: 'ark' }],
    async load({ env, namespace, application, tenant }) {
      const ns = String(namespace || '').trim();
      const app = String(application || '').trim();
      if (!ns || !app) return [];
      const { query, sql } = require('../inventory/mssql.cjs');
      const clusters = await clustersForEnv(env, tenant);
      // CLUSTER KATALOGU BOSSA BOS DONER: ortamin cluster'lari bilinmeden TUM envanteri
      // taramak, baska bir ortamin route'unu prod tanimina aday gostermek olurdu.
      if (!clusters.length) return [];
      const params = clusters.map((c, i) => ({
        name: `c${i}`,
        type: sql.NVarChar(200),
        value: c,
      }));
      const ph = clusters.map((_, i) => `@c${i}`).join(', ');
      const r = await query(
        `SELECT DISTINCT cluster_name, namespace_name, route_name, route_address, termination_type
           FROM dbo.BMW_Openshift_Route_Inventory WHERE cluster_name IN (${ph})`,
        params,
      );
      const { routesForApp } = require('../audit/nginx-app-routes.cjs');
      const { adaylar, suffixAdded, atfedilmeyen } = routesForApp(
        r.recordset || [],
        ns,
        app,
      );
      // ATFEDILEMEYEN ROUTE: envanterde route -> service bagi YOK; adresi kurumsal kaliba
      // uymayan ve adi uygulamadan farkli bir route hangi uygulamaya ait, OLCULEMEZ.
      // Liste "bu uygulamanin TUM route'lari" degil "atfedebildiklerimiz"dir; fark
      // SOYLENIR, yoksa tek satir gorunce "baska route yok" sanilir.
      const uyari = atfedilmeyen
        ? `  ·  bu namespace'te atfedilemeyen ${atfedilmeyen} route daha var`
        : '';
      return adaylar.map((a) => ({
        value: a.url,
        // ETIKET KANITI TASIR: eslesme adresten mi route adindan mi kuruldu, namespace'e
        // '-prod' eklenerek mi tutturuldu. Gizlenirse zayif bir eslesme guclu gorunur.
        label:
          `${a.url}  ·  ${a.termination}` +
          (a.clusters.length ? `  ·  ${a.clusters.join(', ')}` : '') +
          (a.how === 'name' ? '  ·  route adından eşleşti' : '') +
          (suffixAdded ? "  ·  namespace '-prod' ekiyle eşleşti" : '') +
          uyari,
        group: adaylar.length > 1 ? 'Birden fazla route — hangisi olduğunu seçin' : undefined,
      }));
    },
  },

  // Nginx sunuculari (Denetim > Nginx Envanteri, dbo.nginx_inventory; nginx_metadata job'i).
  // Ortam opsiyonel daraltma; configuration_delivery gibi "su sunuculara dagit" isleri icin
  // COKLU SECIM alanina baglanir.
  'nginx-hosts': {
    label: 'Nginx sunucuları (Nginx Envanteri; çoklu seçim için)',
    params: [{ name: 'env', label: 'Ortam alanı (opsiyonel daraltma)', required: false }],
    async load({ env }) {
      const { query } = require('../inventory/mssql.cjs');
      const { envOfHost } = require('../audit/nginx-hosts.cjs');
      const wantEnv = normEnv(env);
      const r = await query(`SELECT hostname, env, location, service FROM dbo.nginx_inventory`);
      const out = [];
      for (const row of r.recordset || []) {
        const host = String(row.hostname || '')
          .trim()
          .toUpperCase();
        if (!host) continue;
        const e = normEnv(row.env) || envOfHost(host);
        if (wantEnv && e !== wantEnv) continue;
        const svc = String(row.service || '').trim();
        out.push({
          value: host,
          label: `${host}${svc ? '  ·  ' + svc : ''}${row.location ? '  ·  ' + row.location : ''}`,
          group: e || 'BILINMIYOR',
        });
      }
      out.sort((a, b) => a.group.localeCompare(b.group) || a.value.localeCompare(b.value));
      return out;
    },
  },

  // Reverse proxy servisleri (GLOMO, WEBFORMS, ...): son nginx_config_audit taramasinda
  // o ortamda gorulen vhost servisleri.
  'nginx-services': {
    label: 'Nginx reverse proxy servisleri (GLOMO, WEBFORMS… — Nginx SPA denetimi)',
    params: [{ name: 'env', label: 'Ortam alanı', required: true }],
    async load({ env }) {
      const rows = await nginxAuditRows(env, '');
      const svcs = [
        ...new Set(
          rows
            .map((r) =>
              String(r.service || '')
                .trim()
                .toUpperCase(),
            )
            .filter(Boolean),
        ),
      ];
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
        const conf = String(row.config_file || '')
          .trim()
          .replace(/\.conf$/i, '');
        if (loc) locs.add(loc);
        if (conf) confs.add(conf);
      }
      const out = [];
      for (const v of [...locs].sort()) out.push({ value: v, label: v, group: 'API yolu' });
      for (const v of [...confs].sort())
        out.push({ value: v, label: v, group: 'Konfigürasyon dosyası' });
      return out;
    },
  },

  // ── API GENERATOR > RATE LIMIT: SECILEBILIR API LISTESI (kullanici, 2026-10-22) ─────────────
  //
  // "rate limit degistirmeye tikladiklarinda ilgili API'yi elle degil oradan drop down menuden
  //  secerek girmelerini rica ediyorum."
  //
  // Self Servis'te api_generator sablonunun `chosen_api` alani bu kaynaga KODLA baglanir
  // (selfservice/api-generator-secim.cjs). 'nginx-api-locations'tan farki: yalnizca rate_limit_change'in
  // GERCEKTEN isleyebildigi degerler sunulur:
  //   * deger = konfigurasyon dosya adi ('.conf' atilmis). Playbook adi izinli domain onekini
  //     (GAR, ORT, DAS ...) iceriyorsa KONFIGURASYON kabul eder ve zone'lari dosyadan okur; envanterdeki
  //     uc nokta yollari (/x/y/v0/ornek/uc) zone govdesine cozulemiyordu. Onek tasimayan ad playbook'ta
  //     yol sanilir -> listeye girmez.
  //   * yalnizca job'in o ortamda (ve production'da `site`ta) calistigi sunuculardaki dosyalar
  //     (shared/nginxApiClusters.cjs apiGeneratorHosts).
  //   * production'da kanal (mblcustomers / customers / mcustomers) verilirse yalniz o kanalin kumesi;
  //     kapsam o kumeye gore sayilir (kullanici 2026-10-22: "Prod ve customers secince ... o sunuculara
  //     bakmaliydi").
  // Etiket acik Turkce kanit tasir: ornek uc + dosyadaki uc sayisi, mevcut IP / location limiti (farkliysa
  // hepsi, "tanimsiz" = envanterde limit yok) ve kac sunucuda var. Gruplar: limiti tanimli + her yerde /
  // limiti tanimli + bazi sunucularda yok (job o sunucularda "bulunamadi" ile durur) / limit tanimi yok.
  'nginx-api-gateway-confs': {
    label: 'Nginx API Generator — rate limit değiştirilebilir API konfigürasyonları (API envanteri)',
    params: [
      { name: 'env', label: 'Ortam alanı (dev/test/qa/prod)', required: true },
      { name: 'site', label: 'Lokasyon alanı (all/pendik/ankara; opsiyonel)', required: false },
      { name: 'channel', label: 'Kanal alanı (mblcustomers/customers/mcustomers; production rate limit için zorunlu)', required: false },
      { name: 'islem', label: 'İşlem alanı (op_selection; read ise kanal zorunlu değil)', required: false },
    ],
    async load({ env, site, channel, islem }) {
      const kume = apiGatewayKumesi(env, channel, islem);
      const { query, sql } = require('../inventory/mssql.cjs');
      const { apiGeneratorHosts } = require('../../shared/nginxApiClusters.cjs');
      const hosts = new Set(apiGeneratorHosts(env, site, channel));
      if (!hosts.size) return [];
      const dateRes = await query(
        `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.NginxRateLimitInventory`,
      );
      const d = dateRes.recordset?.[0]?.d;
      if (!d) return [];
      const r = await query(
        `SELECT host, config_file, api_location, ip_rate_limit, server_rate_limit
           FROM dbo.NginxRateLimitInventory
          WHERE scan_date = @d`,
        [{ name: 'd', type: sql.NVarChar(10), value: d }],
      );
      return apiGatewayConfChoices(r.recordset || [], hosts, kume ? kume.key : '');
    },
    // Secilen konfigurasyonun AYRINTISI (formda secimin saginda): ayni rate limit zone'unu
    // paylasan API uclari. Kullanici (2026-10-22): "secilen kok API'yle beraber etkilenecek diger
    // children API'ler sagda liste halinde gozuksun kullanici bunun bilincinde olsun". Rate limit
    // limit-zones.conf'taki ZONE'a yazilir; zone'u kullanan her uc birlikte degisir.
    async details({ env, site, channel, islem }, conf) {
      const kume = apiGatewayKumesi(env, channel, islem);
      const { query, sql } = require('../inventory/mssql.cjs');
      const { apiGeneratorHosts } = require('../../shared/nginxApiClusters.cjs');
      const hosts = new Set(apiGeneratorHosts(env, site, channel));
      // ip_zone / server_zone kolonlarini yeni envanter yukleyicisi ekler (metadata-only ALTER);
      // eski kurulumda yoksa sorgu patlamasin diye once varliklari sorulur.
      const meta = await query(
        `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d,
                COL_LENGTH('dbo.NginxRateLimitInventory', 'ip_zone') AS iz,
                COL_LENGTH('dbo.NginxRateLimitInventory', 'server_zone') AS sz
           FROM dbo.NginxRateLimitInventory`,
      );
      const m = meta.recordset?.[0] || {};
      const zoneVar = m.iz != null && m.sz != null;
      const opts = { kume: kume ? kume.key : '', taramaTarihi: m.d || '', zoneVar, mod: saltOkuma(islem) ? 'bilgi' : 'degisiklik' };
      if (!m.d || !hosts.size) return apiGatewayConfDetay([], hosts, conf, opts);
      const kol = zoneVar ? ', ip_zone, server_zone' : '';
      const d = [{ name: 'd', type: sql.NVarChar(10), value: m.d }];
      const kendi = await query(
        `SELECT host, config_file, api_location, ip_rate_limit, server_rate_limit${kol}
           FROM dbo.NginxRateLimitInventory
          WHERE scan_date = @d AND config_file IN (@c1, @c2)`,
        [...d, { name: 'c1', type: sql.NVarChar(255), value: conf }, { name: 'c2', type: sql.NVarChar(255), value: `${conf}.conf` }],
      );
      const rows = (kendi.recordset || []).slice();
      const zonelar = zoneVar ? confZonelari(rows, hosts, conf) : [];
      if (zonelar.length > ZONE_SORGU_SINIRI) opts.zoneKirpildi = true;
      if (zonelar.length && !opts.zoneKirpildi) {
        const zp = zonelar.map((z, i) => ({ name: `z${i}`, type: sql.NVarChar(512), value: z }));
        const ad = zp.map((p) => `@${p.name}`).join(', ');
        const ortak = await query(
          `SELECT host, config_file, api_location, ip_rate_limit, server_rate_limit, ip_zone, server_zone
             FROM dbo.NginxRateLimitInventory
            WHERE scan_date = @d AND (ip_zone IN (${ad}) OR server_zone IN (${ad}))`,
          [...d, ...zp],
        );
        rows.push(...(ortak.recordset || []));
      }
      return apiGatewayConfDetay(rows, hosts, conf, opts);
    },
  },
};

// Production'da API listesi ve ayrinti KANALIN sunucu kumesine gore gelir: api_generator'in
// rate_limit_change'i prod'da yalniz o kumede calisir (operations/vars/main.yaml, kume disi
// sunucu isten cikar) ve kanal bos / taninmiyorsa HICBIR sey yapmadan durur. Liste de ayni kurali
// uygular: 54 sunucunun listesini gosterip isin durmasini beklemek yerine kullaniciya simdi soyler.
// `read` hicbir sey degistirmez ve job'u kanal bilinmiyorsa eskisi gibi tum sunucularda okur: orada
// kanal ZORUNLU DEGIL (yanlis yazilmis kanalla okuma engellenmez; liste daralmaz).
const saltOkuma = (islem) => T(islem).toLowerCase() === 'read';

function apiGatewayKumesi(env, channel, islem) {
  if (normEnv(env) !== 'PROD') return null;
  const { API_CLUSTERS, apiCluster } = require('../../shared/nginxApiClusters.cjs');
  const kume = apiCluster(channel);
  if (kume) return kume;
  if (saltOkuma(islem)) return null;
  const ad = String(channel || '').trim();
  const gecerli = API_CLUSTERS.map((k) => k.key).join(' / ');
  throw Object.assign(
    new Error(
      ad
        ? `Kanal "${ad}" için production sunucu kümesi tanımlı değil (geçerli: ${gecerli}); iş de bu kanalla çalışmaz.`
        : `Production'da liste kanalın sunucu kümesinden gelir — önce Kanal alanını doldurun (${gecerli}).`,
    ),
    { status: 400 },
  );
}

// Ikinci sorgunun parametre sayisi sinirli; bir konfigurasyon pratikte 1-4 zone kullanir.
// Asilirsa ortak kullanicilar ARANMAZ ve panel bunu acikca yazar (sessiz kirpma yok).
const ZONE_SORGU_SINIRI = 50;

// rate_limit_change.yaml 'Granted Domains for APIs' listesiyle AYNI: chosen_api bunlardan birini
// (harf duyarli alt dizgi, Jinja `in` gibi) iceriyorsa konfigurasyon dosyasi kabul edilir.
const API_GENERATOR_GRANTED_DOMAINS = ['GAR', 'GLS', 'GES', 'GFY', 'ORT', 'GSG', 'DAS', 'GYB'];

const GRUP_TAM = 'Rate limit tanımlı — tüm sunucularda var';
const GRUP_EKSIK = 'Rate limit tanımlı — bazı sunucularda yok (iş o sunucularda "bulunamadı" ile durur)';
// "Tanimi yok" degil "gorunmuyor": envanter ayristiricisi 2026-09-24 - 10-22 arasi '/' iceren zone
// adlarini (/x/y/v0_rate_limit) OKUYAMIYORDU; olcemedigimizi "yok" diye yazmayiz.
const GRUP_LIMITSIZ = 'Envanterde rate limit görünmüyor — iş limit zone bulamazsa durur';

/**
 * SAF: envanter satirlari -> secenekler (DB'siz test edilir).
 * @param {object[]} rows {host, config_file, api_location, ip_rate_limit, server_rate_limit}
 * @param {Set<string>} hosts job'in calistigi sunucular (BUYUK harf)
 * @param {string} [kume] kanal kumesi adi (kapsam metni icin; bos = ortamin tum sunuculari)
 */
function apiGatewayConfChoices(rows, hosts, kume = '') {
  const byConf = new Map();
  for (const row of rows || []) {
    const host = String(row.host || '').trim().toUpperCase();
    if (!hosts.has(host)) continue;
    const conf = String(row.config_file || '').trim().replace(/\.conf$/i, '');
    if (!conf || !API_GENERATOR_GRANTED_DOMAINS.some((g) => conf.includes(g))) continue;
    if (!byConf.has(conf)) byConf.set(conf, { hosts: new Set(), locs: new Set(), ip: new Set(), loc: new Set() });
    const c = byConf.get(conf);
    c.hosts.add(host);
    const yol = String(row.api_location || '').trim();
    if (yol && !yol.startsWith('@')) c.locs.add(yol);
    const ip = String(row.ip_rate_limit || '').trim();
    if (ip) c.ip.add(ip);
    const lc = String(row.server_rate_limit || '').trim();
    if (lc) c.loc.add(lc);
  }
  const toplam = hosts.size;
  const limit = (set) =>
    set.size === 0 ? 'tanımsız' : set.size === 1 ? [...set][0] : `${[...set].sort().join(' / ')} (sunucular arasında farklı)`;
  const sira = [GRUP_TAM, GRUP_EKSIK, GRUP_LIMITSIZ];
  return [...byConf.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([conf, c]) => {
      const yollar = [...c.locs].sort((a, b) => a.length - b.length || a.localeCompare(b));
      const ornek = yollar.length
        ? `örnek uç ${yollar[0]}` + (yollar.length > 1 ? ` (dosyada ${yollar.length} uç)` : '')
        : 'uç bulunamadı';
      const limitli = c.ip.size > 0 || c.loc.size > 0;
      const tam = c.hosts.size === toplam;
      return {
        value: conf,
        label:
          `${conf}  ·  ${ornek}  ·  IP limiti ${limit(c.ip)}  ·  location limiti ${limit(c.loc)}  ·  ` +
          `${c.hosts.size}/${toplam} sunucuda var${kume ? ` (${kume})` : ''}`,
        group: !limitli ? GRUP_LIMITSIZ : tam ? GRUP_TAM : GRUP_EKSIK,
      };
    })
    .sort((a, b) => sira.indexOf(a.group) - sira.indexOf(b.group));
}

const T = (s) => String(s == null ? '' : s).trim();
const confAdi = (row) => T(row.config_file).replace(/\.conf$/i, '');

/** SAF: secilen konfigurasyonun (job sunucularindaki) zone adlari; NULL (eski yukleyici) / bos atlanir. */
function confZonelari(rows, hosts, conf) {
  const hedef = T(conf).toLowerCase();
  const out = new Set();
  for (const r of rows || []) {
    if (!hosts.has(T(r.host).toUpperCase()) || confAdi(r).toLowerCase() !== hedef) continue;
    if (T(r.ip_zone)) out.add(T(r.ip_zone));
    if (T(r.server_zone)) out.add(T(r.server_zone));
  }
  return [...out].sort();
}

/**
 * SAF: secilen konfigurasyon icin "birlikte etkilenecek API uclari" (DB'siz test edilir).
 *
 * Zone bilgisi VARSA (envanter ip_zone / server_zone yaziyorsa): konfigurasyonun zone'larini kullanan
 * TUM uclar - baska konfigurasyondakiler dahil (zone http seviyesinde ortaktir; rate_limit_change o
 * zone'un hizini limit-zones.conf'ta degistirir). Zone bilgisi YOKSA (eski yukleyici, kolon NULL):
 * yalniz bu konfigurasyondaki uclar ve limitleri; panel bunu acikca yazar.
 * `@ad` (named location) API ucu degildir, listelenmez.
 * @param {object[]} rows {host, config_file, api_location, ip_rate_limit, server_rate_limit, ip_zone?, server_zone?}
 * @param {Set<string>} hosts job'in calistigi sunucular (BUYUK harf)
 */
function apiGatewayConfDetay(rows, hosts, conf, opts = {}) {
  const hedef = T(conf).toLowerCase();
  const icinde = (rows || []).filter((r) => hosts.has(T(r.host).toUpperCase()));
  const kendiMi = (r) => confAdi(r).toLowerCase() === hedef;
  const kendiSatirlar = icinde.filter(kendiMi);
  const zoneBilgisi = !!opts.zoneVar && kendiSatirlar.some((r) => r.ip_zone != null || r.server_zone != null);
  // SUNUCU BAZINDA (2026-10-22 inceleme): rate_limit_change bir sunucuda yalniz O SUNUCUDAKI
  // konfigurasyonun zone'larini degistirir; konfigurasyonun olmadigi sunucu "bulunamadi" ile durur ve
  // oradaki ortak zone'a dokunmaz. Zone'lar '@ad' location'lardan da toplanir (playbook dosyadaki TUM
  // limit_req satirlarini alir) ama '@ad' API ucu olarak listelenmez.
  const ipZ = new Map(); // host -> Set(zone)
  const locZ = new Map();
  const ekle = (m, h, z) => {
    if (!z) return;
    if (!m.has(h)) m.set(h, new Set());
    m.get(h).add(z);
  };
  const varMi = (m, h, z) => !!z && m.has(h) && m.get(h).has(z);
  if (zoneBilgisi) {
    for (const r of kendiSatirlar) {
      ekle(ipZ, T(r.host).toUpperCase(), T(r.ip_zone));
      ekle(locZ, T(r.host).toUpperCase(), T(r.server_zone));
    }
  }
  // Ayni satir iki sorgudan da gelebilir (kendi konfigurasyonu + zone eslesmesi); asagidaki
  // birikimler Set / OR oldugu icin tekrar sayilmaz.
  const uc = new Map();
  for (const r of icinde) {
    if (T(r.api_location).startsWith('@')) continue;
    const h = T(r.host).toUpperCase();
    const kendi = kendiMi(r);
    const ipEt = zoneBilgisi ? varMi(ipZ, h, T(r.ip_zone)) : kendi && !!T(r.ip_rate_limit);
    const locEt = zoneBilgisi ? varMi(locZ, h, T(r.server_zone)) : kendi && !!T(r.server_rate_limit);
    if (!kendi && !ipEt && !locEt) continue;
    const c = confAdi(r);
    const anahtar = `${c.toLowerCase()} ${T(r.api_location)}`;
    if (!uc.has(anahtar)) {
      uc.set(anahtar, { conf: c, yol: T(r.api_location), kendi, hosts: new Set(), ip: new Set(), loc: new Set(), ipEt: false, locEt: false, ipZone: new Set(), locZone: new Set() });
    }
    const e = uc.get(anahtar);
    e.hosts.add(T(r.host).toUpperCase());
    if (T(r.ip_rate_limit)) e.ip.add(T(r.ip_rate_limit));
    if (T(r.server_rate_limit)) e.loc.add(T(r.server_rate_limit));
    if (zoneBilgisi && T(r.ip_zone)) e.ipZone.add(T(r.ip_zone));
    if (zoneBilgisi && T(r.server_zone)) e.locZone.add(T(r.server_zone));
    e.ipEt = e.ipEt || ipEt;
    e.locEt = e.locEt || locEt;
  }
  const kendiYollar = [...uc.values()].filter((e) => e.kendi).map((e) => e.yol);
  // Kok: konfigurasyondaki diger TUM yollarin onu oldugu en kisa yol (/x/v0 -> /x/v0/a, /x/v0/b).
  const aday = kendiYollar.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || '';
  const kok = aday && kendiYollar.every((y) => y === aday || y.startsWith(aday.endsWith('/') ? aday : `${aday}/`)) ? aday : '';
  const deger = (set) => [...set].sort().join(' / ');
  const uclar = [...uc.values()]
    .map((e) => ({
      yol: e.yol,
      conf: e.conf,
      kok: e.kendi && e.yol === kok,
      baskaConf: !e.kendi,
      sunucu: e.hosts.size,
      ip: deger(e.ip),
      loc: deger(e.loc),
      ipFarkli: e.ip.size > 1,
      locFarkli: e.loc.size > 1,
      ipZone: deger(e.ipZone),
      locZone: deger(e.locZone),
      etkiler: { ip: e.ipEt, location: e.locEt },
    }))
    .sort(
      (a, b) =>
        Number(a.baskaConf) - Number(b.baskaConf) ||
        Number(b.kok) - Number(a.kok) ||
        a.conf.localeCompare(b.conf) ||
        a.yol.localeCompare(b.yol),
    );
  return {
    conf: T(conf),
    kume: opts.kume || '',
    toplamSunucu: hosts.size,
    taramaTarihi: opts.taramaTarihi || '',
    zoneBilgisi,
    zoneKirpildi: !!opts.zoneKirpildi,
    zonelar: {
      ip: [...new Set([...ipZ.values()].flatMap((s) => [...s]))].sort(),
      location: [...new Set([...locZ.values()].flatMap((s) => [...s]))].sort(),
    },
    // 'degisiklik' (rate_limit_change) | 'bilgi' (read: hicbir sey degismez, panel dili buna gore)
    mod: opts.mod === 'bilgi' ? 'bilgi' : 'degisiklik',
    etkilenen: uclar.filter((u) => u.etkiler.ip || u.etkiler.location).length,
    uclar,
  };
}

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
  if (hit) {
    if (Date.now() - hit.at < CACHE_TTL_MS) return hit.choices;
    // SURESI DOLAN GIRIS SILINIR. Eskiden yalnizca "taze degil" deyip geciliyor
    // ve giris sonsuza dek heap'te kaliyordu: TTL bellegi degil, yalnizca
    // tazeligi koruyordu.
    cache.delete(key);
  }
  const choices = await src.load(p);
  // Ayni anahtar yeniden yazilirken once silinir ki FIFO sirasi TAZELENSIN;
  // `Map.set` mevcut anahtarin sirasini degistirmez ve sicak bir giris haksiz
  // yere "en eski" sayilirdi.
  cache.delete(key);
  while (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), choices });
  return choices;
}

// ── SECIMIN AYRINTISI (kaynakta `details` varsa) ─────────────────────────────
// Ayni sinirlar: anahtar KULLANICI GIRDISI (parametreler + secilen deger) tasir; MAX + FIFO +
// TTL'de silme (yukaridaki onbellekle ayni gerekce, Portal 2026-09 OOM'lari).
const DETAIL_TTL_MS = 60 * 1000;
const DETAIL_MAX_ENTRIES = 64;
const detailCache = new Map(); // key -> { at, detay }

/**
 * Secilen degerin ayrintisi. Deger kaynaktaki LISTEDE degilse ayrinti verilmez (404): rota,
 * listede olmayan rastgele adlarla envanteri yoklamak icin kullanilamaz.
 */
async function loadChoiceDetails(sourceName, params, value) {
  const src = getSource(sourceName);
  if (!src || typeof src.details !== 'function') {
    throw Object.assign(new Error(`Bu seçenek kaynağının ayrıntı görünümü yok: ${sourceName}`), { status: 404 });
  }
  const secilen = String(value ?? '').trim();
  if (!secilen) throw Object.assign(new Error('Ayrıntı için bir seçim gerekli.'), { status: 400 });
  const liste = await loadChoices(sourceName, params);
  if (!liste.some((c) => c.value === secilen)) {
    throw Object.assign(new Error(`"${secilen}" bu listede yok; ayrıntı gösterilemez.`), { status: 404 });
  }
  const p = {};
  for (const def of src.params) p[def.name] = String((params || {})[def.name] ?? '').trim();
  for (const def of src.options || []) {
    p[def.name] = String((params || {})[def.name] ?? '').trim() || String(def.default ?? '');
  }
  const key = `${cacheKey(sourceName, p)}|${secilen}`;
  const varolan = detailCache.get(key);
  if (varolan) {
    if (Date.now() - varolan.at < DETAIL_TTL_MS) return varolan.detay;
    detailCache.delete(key);
  }
  const detay = await src.details(p, secilen);
  detailCache.delete(key);
  while (detailCache.size >= DETAIL_MAX_ENTRIES) detailCache.delete(detailCache.keys().next().value);
  detailCache.set(key, { at: Date.now(), detay });
  return detay;
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
    // 400 = kaynak GIRDIYI reddetti (or. prod'da taninmayan kanal): kesinti degil, kullanici duzeltir.
    if (e.status === 400) {
      throw Object.assign(new Error(`${label}: ${e.message} İş başlatılmadı.`), { status: 400 });
    }
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
  detailCache.clear();
}

module.exports = {
  SOURCES,
  SPA_RE,
  API_GENERATOR_GRANTED_DOMAINS,
  apiGatewayConfChoices,
  apiGatewayConfDetay,
  apiGatewayKumesi,
  confZonelari,
  loadChoiceDetails,
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
