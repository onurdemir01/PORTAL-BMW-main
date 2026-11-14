// server/scalex/cluster-caps.cjs — CLUSTER YETENEK ENVANTERI.
//
// NEDEN VAR
// ─────────
// ScaleX kesfinin olculen maliyeti (cluster basina ~110 `oc` cagrisi, ~30 sn):
//
//   ≈ 14  login/project/hpa/pdb/configmap/api-resources
//   + G   API grubu basina 1 × `oc get --raw /apis/<gv>`    G ≈ 40-60  ← %45
//   + 2E  ekstra CRD tipi basina probe + jsonpath           E ≈ 20     ← %35
//
// `G` ve `2E`'nin ikisi de NAMESPACE'TEN, UYGULAMADAN ve KULLANICIDAN BAGIMSIZ.
// Cluster'a bir operator kurulmadikca aylarca degismezler. Yani her kesifte
// yeniden hesaplamak saf israf.
//
// Kullanicinin direktifi: *"alabildigin her bilgiyi DB'ye al, alamadiklarini
// runtime'da ara; yetki testini ScaleX yapmasin, ayri bir playbook olsun, admin
// toplu kostursun, Denetim gibi ekran versin."*
//
// UC DURUM AYRI TUTULUR — ikisini birlestirmek bu depoda iki ayri ariza uretti
// (`ocp-cache.cjs:241-262`'deki ayni ayrim):
//
//   yok        → `null`                  → kesif ESKI yolu kosar, onbellek dolar
//   bos        → `{ kinds: [] }`         → cluster'da ekstra CRD YOK, dogrulanmis
//   okunamadi  → `{ unreadable: true }`  → kesif ESKI yolu kosar; "okunamadi"yi
//                                          "CRD yok" saymak, olceklenebilir
//                                          operator nesnelerini SESSIZCE listeden
//                                          dusurmek olurdu
'use strict';

const db = require('../db/index.cjs');

/**
 * Onbellek omru. CRD listesi aylarca degismez ama bir operator kurulumu onu
 * degistirir; 30 gun, "hic tazelenmesin" ile "her gun tazelensin" arasinda
 * makul bir orta yol. Suresi dolan satir SILINMEZ — `stale: true` ile doner ve
 * ekran "N gun once" yazar. Bayat liste, hic liste olmamasindan iyidir; kesif
 * yine de fail-safe yolu kosabilir.
 */
const CAPS_TTL_DAYS = 30;

/** Tek bir cluster icin saklanacak en fazla tip — bozuk bir tarama sisirmesin. */
const MAX_KINDS = 500;

function satiriCevir(r) {
  if (!r) return null;
  const kindsCsv = r.kinds_csv;
  return {
    env: r.env,
    tenant: r.tenant,
    clusterName: r.cluster_name,
    // `null` (hic taranmadi) ile `''` (tarandi, bos) AYRI. `String.split` bos
    // string'te `['']` dondurdugu icin acikca ayirmak SART.
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

/** Kapsam icindeki cluster'larin yetenek kayitlari. Okuma SINIRLI. */
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
 * Kesfe gecirilecek CRD listesi. Kapsamdaki TUM cluster'lar icin GUVENILIR bir
 * kayit yoksa `null` doner ve kesif eski yolu kosar.
 *
 * NEDEN "HEPSI" SARTI: kesif tek bir `SCALEX_EXTRA_KINDS` degeriyle kosuyor ve
 * o deger HER cluster'a gidiyor. Bir cluster'in kaydi varken digerininki yoksa,
 * eksik cluster o listeyle sinirlanir ve KENDI CRD'leri sessizce kaybolur.
 * Kismi onbellek, onbellek olmamasindan TEHLIKELIDIR.
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
 * CLUSTER BASINA yetenek haritasi: `{ [clusterName]: string[] }`.
 *
 * ── `kindsForScope` DURUYOR, BU ONUN YERINE GECMIYOR ────────────────────────
 * O fonksiyon TEK bir birlesik liste dondurur ve kesif onu HER cluster'a
 * gonderir. Eski AWX paketleri yalnizca o bicimi (`scalex_extra_kinds`)
 * okuyabildigi icin geriye uyumluluk adina korunuyor.
 *
 * ── "KISMI ONBELLEK TEHLIKELIDIR" NOTU NEDEN ARTIK GECERLI DEGIL ────────────
 * Tehlike kismi olmasindan degil, **tek bir degerin her cluster'a gitmesinden**
 * geliyordu: bir cluster'in kaydi yokken digerininkiyle sinirlanmak, eksik
 * cluster'in KENDI CRD'lerini sessizce dusururdu. Cluster basina harita o
 * mekanizmayi ortadan kaldirir — sozlukte OLMAYAN cluster hicbir liste almaz ve
 * **yalnizca kendisi** eski (soguk) yolu kosar. Tek eksik cluster artik tum
 * kapsami soguk yola dusurmuyor.
 *
 * ── SOZLUGE GIRMEYEN UC DURUM ──────────────────────────────────────────────
 *   hic taranmamis (`kinds === null`) → kayit yok, tahmin de yok
 *   okunamamis tarama               → "okunamadi" ≠ "CRD yok"
 *
 * "Tarandi ama BOS" (`kinds === []`) ARTIK SOZLUGE GIRER ve bos bir liste olarak
 * gider. Degerin kendisi bos oldugu icin betik onu "onbellek yok"tan ayiramaz;
 * ayrimi **anahtarin varligi** tasir (`SCALEX_EXTRA_KINDS_SCANNED`). Bu ayrim
 * olmadan ekstra CRD'si olmayan bir cluster her kesifte ~50 `oc get --raw`
 * oduyordu — ve sonuc her seferinde ayni: bos.
 */
async function kindsPerCluster({ env, tenant, clusterNames }) {
  if (!Array.isArray(clusterNames) || !clusterNames.length) return {};
  const kayitlar = await list({ env, tenant, clusterNames });
  const harita = {};
  for (const k of kayitlar) {
    if (!k.resourcesReadable) continue;
    if (k.kinds === null) continue;
    if (!k.clusterName) continue;
    harita[String(k.clusterName)] = k.kinds.slice(0, MAX_KINDS);
  }
  return harita;
}

/**
 * Bir cluster'in tarama sonucunu yazar (upsert).
 *
 * `resourcesReadable === false` ise kayit YINE yazilir ama `kinds_csv` NULL
 * kalir: "okunamadi" bilgisi ekranda gorunmeli, ama o satir kesfi
 * hizlandirmak icin KULLANILMAMALI.
 */
async function save({ env, tenant, clusterName, kinds, rbac, resourcesReadable, scannedBy, awxJobId }) {
  const okunabilir = resourcesReadable !== false;
  const kindsCsv = (() => { if (okunabilir) return (Array.isArray(kinds) ? kinds : []).slice(0, MAX_KINDS).join(','); return null; })();
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
  // ── `rbac_json` EZILMEZ ─────────────────────────────────────────────────
  //
  // Yetki taramasi YALNIZCA `capabilities` modunda yapiliyor. Kesfin yan urunu
  // olarak gelen kayitta `rbac` TANIMSIZ gelir ve kosulsuz bir `rbac_json = $5`
  // onu NULL'a EZERDI: Admin'deki yetki tablosu, kesif kostukca KENDILIGINDEN
  // bosalirdi. "Veri yok" ile "bu yazim o alani tasimiyor" ayri seyler.
  const rbacYazilsin = rbac !== undefined && rbac !== null;
  const setler = [
    'kinds_csv = $4',
    ...(rbacYazilsin ? ['rbac_json = $5'] : []),
    'resources_readable = $6',
    'scanned_by = $7',
    'awx_job_id = $8',
    'fetched_at = GETUTCDATE()',
    'expires_at = DATEADD(DAY, $9, GETUTCDATE())',
  ];
  // UPDATE-once-INSERT: `portal_settings`/`ocp_app_cache` ile ayni upsert deseni.
  const upd = await db.query(
    `UPDATE scalex_cluster_caps
        SET ${setler.join(', ')}
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

module.exports = { list, kindsForScope, kindsPerCluster, save, CAPS_TTL_DAYS, MAX_KINDS };
