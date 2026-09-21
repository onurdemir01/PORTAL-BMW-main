// server/scalex/cluster-caps.cjs — CLUSTER YETENEK ENVANTERI.
//
// NEDEN VAR
// ─────────
// ScaleX keşfinin ölçülen maliyeti (cluster başına ~110 `oc` çağrısı, ~30 sn):
//
//   ≈ 14  login/project/hpa/pdb/configmap/api-resources
//   + G   API grubu başına 1 × `oc get --raw /apis/<gv>`    G ≈ 40-60  ← %45
//   + 2E  ekstra CRD tipi başına probe + jsonpath           E ≈ 20     ← %35
//
// `G` ve `2E`'nin ikisi de NAMESPACE'TEN, UYGULAMADAN ve KULLANICIDAN BAĞIMSIZ.
// Cluster'a bir operator kurulmadıkça aylarca değişmezler. Yani her keşifte
// yeniden hesaplamak saf israf.
//
// Kullanıcının direktifi: *"alabildiğin her bilgiyi DB'ye al, alamadıklarını
// runtime'da ara; yetki testini ScaleX yapmasın, ayrı bir playbook olsun, admin
// toplu koştursun, Denetim gibi ekran versin."*
//
// ÜÇ DURUM AYRI TUTULUR — ikisini birleştirmek bu depoda iki ayrı arıza üretti
// (`ocp-cache.cjs:241-262`'deki aynı ayrım):
//
//   yok        → `null`                  → keşif ESKİ yolu koşar, önbellek dolar
//   boş        → `{ kinds: [] }`         → cluster'da ekstra CRD YOK, doğrulanmış
//   okunamadı  → `{ unreadable: true }`  → keşif ESKİ yolu koşar; "okunamadı"yı
//                                          "CRD yok" saymak, ölçeklenebilir
//                                          operator nesnelerini SESSİZCE listeden
//                                          düşürmek olurdu
'use strict';

const db = require('../db/index.cjs');

/**
 * Önbellek ömrü. CRD listesi aylarca değişmez ama bir operator kurulumu onu
 * değiştirir; 30 gün, "hiç tazelenmesin" ile "her gün tazelensin" arasında
 * makul bir orta yol. Süresi dolan satır SİLİNMEZ — `stale: true` ile döner ve
 * ekran "N gün önce" yazar. Bayat liste, hiç liste olmamasından iyidir; keşif
 * yine de fail-safe yolu koşabilir.
 */
const CAPS_TTL_DAYS = 30;

/** Tek bir cluster için saklanacak en fazla tip — bozuk bir tarama şişirmesin. */
const MAX_KINDS = 500;

function satiriCevir(r) {
  if (!r) return null;
  const kindsCsv = r.kinds_csv;
  return {
    env: r.env,
    tenant: r.tenant,
    clusterName: r.cluster_name,
    // `null` (hiç taranmadı) ile `''` (tarandı, boş) AYRI. `String.split` boş
    // string'te `['']` döndürdüğü için açıkça ayırmak ŞART.
    kinds: kindsCsv === null || kindsCsv === undefined
      ? null
      : String(kindsCsv).split(',').map((k) => k.trim()).filter(Boolean),
    rbac: (() => {
      if (!r.rbac_json) return null;
      try {
        const v = JSON.parse(r.rbac_json);
        return v && typeof v === 'object' ? v : null;
      } catch {
        return null;
      }
    })(),
    resourcesReadable: r.resources_readable !== 0 && r.resources_readable !== false,
    scannedBy: r.scanned_by ?? null,
    awxJobId: r.awx_job_id ?? null,
    fetchedAt: r.fetched_at,
    expiresAt: r.expires_at ?? null,
    stale: r.expires_at ? new Date(r.expires_at).getTime() < Date.now() : false,
  };
}

/** Kapsam içindeki cluster'ların yetenek kayıtları. Okuma SINIRLI. */
async function list({ env, tenant, clusterNames } = {}) {
  const kosullar = [];
  const params = [];
  if (env) {
    params.push(env);
    kosullar.push(`env = $${params.length}`);
  }
  if (tenant) {
    params.push(tenant);
    kosullar.push(`tenant = $${params.length}`);
  }
  const where = kosullar.length ? `WHERE ${kosullar.join(' AND ')}` : '';
  // `TOP` SART: bu tablo cluster sayisiyla buyur ve sinirsiz okuma bu depoda
  // yedi OOM'un sinifiydi.
  const { rows } = await db.query(
    `SELECT TOP 500 * FROM scalex_cluster_caps ${where} ORDER BY cluster_name`,
    params,
  );
  const hepsi = rows.map(satiriCevir);
  if (!Array.isArray(clusterNames) || !clusterNames.length) return hepsi;
  const istenen = new Set(clusterNames.map((c) => String(c).trim().toLowerCase()));
  return hepsi.filter((r) => istenen.has(String(r.clusterName).trim().toLowerCase()));
}

/**
 * Keşfe geçirilecek CRD listesi. Kapsamdaki TÜM cluster'lar için GÜVENİLİR bir
 * kayıt yoksa `null` döner ve keşif eski yolu koşar.
 *
 * NEDEN "HEPSİ" ŞARTI: keşif tek bir `SCALEX_EXTRA_KINDS` değeriyle koşuyor ve
 * o değer HER cluster'a gidiyor. Bir cluster'ın kaydı varken diğerininki yoksa,
 * eksik cluster o listeyle sınırlanır ve KENDİ CRD'leri sessizce kaybolur.
 * Kısmi önbellek, önbellek olmamasından TEHLİKELİDİR.
 */
async function kindsForScope({ env, tenant, clusterNames }) {
  if (!Array.isArray(clusterNames) || !clusterNames.length) return null;
  const kayitlar = await list({ env, tenant, clusterNames });
  if (kayitlar.length !== clusterNames.length) return null;

  const birlesim = new Set();
  for (const k of kayitlar) {
    // OKUNAMAMIS tarama kullanilmaz — o satir "CRD yok" demek DEGIL.
    if (!k.resourcesReadable) return null;
    if (k.kinds === null) return null; // hic taranmamis
    for (const t of k.kinds) birlesim.add(t);
  }
  // BOS KUME DE GECERLI BIR CEVAPTIR: "tarandi, ekstra CRD yok". Ama bunu
  // `SCALEX_EXTRA_KINDS=''` olarak gondermek betikte "onbellek yok" ile AYNI
  // anlama gelirdi (eski yol kosar). Bu yuzden bos kumede `null` donup eski
  // yolu BILEREK kosturuyoruz — yanlis hizlanma yerine dogru sonuc.
  if (!birlesim.size) return null;
  return [...birlesim].slice(0, MAX_KINDS);
}

/**
 * Bir cluster'ın tarama sonucunu yazar (upsert).
 *
 * `resourcesReadable === false` ise kayıt YİNE yazılır ama `kinds_csv` NULL
 * kalır: "okunamadı" bilgisi ekranda görünmeli, ama o satır keşfi
 * hızlandırmak için KULLANILMAMALI.
 */
async function save({ env, tenant, clusterName, kinds, rbac, resourcesReadable, scannedBy, awxJobId }) {
  const okunabilir = resourcesReadable !== false;
  const kindsCsv = okunabilir
    ? (Array.isArray(kinds) ? kinds : []).slice(0, MAX_KINDS).join(',')
    : null;
  const params = [
    String(env),
    String(tenant),
    String(clusterName),
    kindsCsv,
    rbac ? JSON.stringify(rbac) : null,
    okunabilir ? 1 : 0,
    scannedBy || null,
    Number.isFinite(Number(awxJobId)) ? Number(awxJobId) : null,
    CAPS_TTL_DAYS,
  ];
  // UPDATE-once-INSERT: `portal_settings`/`ocp_app_cache` ile ayni upsert deseni.
  const upd = await db.query(
    `UPDATE scalex_cluster_caps
        SET kinds_csv = $4, rbac_json = $5, resources_readable = $6,
            scanned_by = $7, awx_job_id = $8,
            fetched_at = GETUTCDATE(), expires_at = DATEADD(DAY, $9, GETUTCDATE())
      WHERE env = $1 AND tenant = $2 AND cluster_name = $3`,
    params,
  );
  if (!upd.rowCount) {
    await db.query(
      `INSERT INTO scalex_cluster_caps
         (env, tenant, cluster_name, kinds_csv, rbac_json, resources_readable,
          scanned_by, awx_job_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, DATEADD(DAY, $9, GETUTCDATE()))`,
      params,
    );
  }
  return { written: true, kinds: kindsCsv === null ? null : kindsCsv.split(',').filter(Boolean) };
}

module.exports = { list, kindsForScope, save, CAPS_TTL_DAYS, MAX_KINDS };
