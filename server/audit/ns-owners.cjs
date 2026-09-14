// server/audit/ns-owners.cjs - namespace -> sorumlu ekip (dbo.Openshift_Namespace_Owners).
//
// Kaynak: bmw_inventory/openshift_inventory namespace_owners akisi - CMDB'deki
// ResponsibleType=1 kaydi -> Smart getgroupbyid -> AD grup adi + e-posta. Sahiplik
// NAMESPACE basina bir bilgidir; bir uygulamanin ekibi = namespace'inin sahibi.
//
// Kullanici talebi (2026-09-14): Denetim > Nginx SPA'da uygulamanin yaninda ekip.
// Ayni harita Prod Tasima'da da kullanilir.
//
// Tablo YOKSA ya da sorgu duserse: bos harita + ready=false. Ekran "ekip bilinmiyor"
// yerine "ekip verisi yok" der - ikisi farkli sey. lookup_status 'OK' olmayan
// (CMDB_KAYIT_YOK, SORUMLU_YOK...) satirlar da haritaya girer ama grup adi bos oldugu
// icin "bilinmiyor" olarak gorunur; durum ipucunda gosterilir.
'use strict';

const TTL_MS = 5 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;

const L = (s) => String(s || '').trim().toLowerCase();

/** Ham satirlardan harita: ns(lower) -> {group, email, status}. */
function indexOwners(rows) {
  const byNs = new Map();
  for (const r of rows || []) {
    const ns = L(r.namespace);
    if (!ns) continue;
    byNs.set(ns, {
      group: String(r.owner_group_name || '').trim() || null,
      email: String(r.owner_email || '').trim() || null,
      status: String(r.lookup_status || '').trim() || 'BILINMIYOR',
    });
  }
  return byNs;
}

/** DB'den (onbellekli) yukler. query: mssql query(text). */
async function loadNamespaceOwners(query) {
  if (_cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  let out;
  try {
    const r = await query(
      `SELECT namespace, owner_group_name, owner_email, lookup_status
         FROM dbo.Openshift_Namespace_Owners`,
    );
    out = { ready: true, byNs: indexOwners(r.recordset || []) };
  } catch {
    out = { ready: false, byNs: new Map() };
  }
  _cache = out;
  _cacheAt = Date.now();
  return out;
}

/**
 * Bir uygulamanin (birden fazla ortamda birden fazla namespace'i olabilir) ekip ozeti.
 * @returns {{groups:string[], emails:string[], unknownNs:string[]}}
 *   groups   : benzersiz AD grup adlari (bos = hicbir namespace icin sahip cozulmemis)
 *   unknownNs: haritada olmayan ya da grubu bos olan namespace'ler (gorunur kalsin)
 */
function ownersFor(byNs, namespaces) {
  const groups = [];
  const emails = [];
  const unknownNs = [];
  for (const ns0 of namespaces || []) {
    const ns = L(ns0);
    if (!ns) continue;
    const o = byNs.get(ns);
    if (!o || !o.group) {
      if (!unknownNs.includes(ns)) unknownNs.push(ns);
      continue;
    }
    if (!groups.includes(o.group)) groups.push(o.group);
    if (o.email && !emails.includes(o.email)) emails.push(o.email);
  }
  return { groups, emails, unknownNs };
}

function _resetCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = { loadNamespaceOwners, indexOwners, ownersFor, _resetCache };
