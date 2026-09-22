// server/nginx-console/drift.cjs — "Tutarlılık" (2026-09-22): aynı servisin (ör. GLOMO) sunucuları
// arasında konfigürasyon dosyaları birebir aynı mı? (SAF, test edilir.)
//
// Kullanici: "eski tip reverse proxy sunucularinda (GLOMO'nun eski sunuculari) konfigurasyonlarin
// esit olup olmadigini gormek istiyorum." Eski Nginx Legacy sekmesi 2026-09-17'de kaldirilmisti;
// Nginx Hub dokumlari (agac: yol + sha256) zaten her dosyanin parmak izini tasiyor. Burada
// sunucular servis+ortam gruplarina ayrilir (dbo.nginx_inventory services/env), her grupta her
// dosya icin sha'lar karsilastirilir:
//   same     : gruptaki her sunucuda var ve sha ayni
//   differ   : birden fazla sha (k surum) — hangi sunucu hangi surumde, cogunluk isaretli
//   missing  : bazi sunucularda yok
// Yalniz conf.d/conf altindaki dosyalar (dokum kapsami); sunucuya ozel oldugu bilinen dosyalar
// (host adi iceren yollar, .console_backup/, yedek kalibi) ayri "beklenen fark" sayilir.
'use strict';

const { BACKUP_RE } = require('./dump-parse.cjs');

const norm = (s) => String(s || '').trim().toUpperCase();

/** Sunucuya ozel oldugu bilinen dosya: yolunda kendi host adi geciyor ya da yedek kalibi. */
function expectedLocal(path, host) {
  const p = String(path || '');
  if (BACKUP_RE.test(p)) return true;
  const h = norm(host);
  return !!h && p.toUpperCase().includes(h);
}

/**
 * hosts: [{host, env, services:[], service}] (envanter), dumps: Map(HOST -> {tree:[{path,sha256,size,mtime}]})
 * Donus: { groups: [{ key, service, env, hosts:[...], dumped:[...], files:[...], counts:{same,differ,missing,local} }] }
 * Yalniz dokumu olan sunucular karsilastirilir; dokumsuzlar grupta "dumpMissing" olarak listelenir.
 */
function computeDrift(hosts, dumps, opts = {}) {
  const minHosts = opts.minHosts || 2;
  const byGroup = new Map();
  for (const h of hosts) {
    const svcs = (h.services && h.services.length ? h.services : [h.service]).map(norm).filter(Boolean);
    const env = String(h.env || '—').toLowerCase();
    for (const s of (svcs.length ? svcs : ['—'])) {
      const key = `${s}|${env}`;
      if (!byGroup.has(key)) byGroup.set(key, { key, service: s, env, hosts: [], dumped: [], dumpMissing: [], files: [], counts: { same: 0, differ: 0, missing: 0, local: 0 } });
      const g = byGroup.get(key);
      const H = norm(h.host);
      if (!g.hosts.includes(H)) g.hosts.push(H);
    }
  }
  const groups = [];
  for (const g of byGroup.values()) {
    g.hosts.sort();
    for (const H of g.hosts) (dumps.get(H) ? g.dumped : g.dumpMissing).push(H);
    if (g.dumped.length < minHosts) { groups.push(g); continue; }
    // yol -> host -> sha
    const byPath = new Map();
    for (const H of g.dumped) {
      for (const f of dumps.get(H).tree || []) {
        if (!byPath.has(f.path)) byPath.set(f.path, new Map());
        byPath.get(f.path).set(H, { sha: f.sha256 || '', size: f.size, mtime: f.mtime });
      }
    }
    for (const [path, m] of byPath) {
      const present = [...m.keys()].sort();
      const missing = g.dumped.filter((H) => !m.has(H));
      const variants = new Map();
      for (const [H, v] of m) { if (!variants.has(v.sha)) variants.set(v.sha, []); variants.get(v.sha).push(H); }
      const vlist = [...variants.entries()].map(([sha, hs]) => ({ sha, hosts: hs.sort(), size: m.get(hs[0]).size, mtime: hs.map((x) => m.get(x).mtime).sort().pop() || null })).sort((a, b) => b.hosts.length - a.hosts.length || a.sha.localeCompare(b.sha));
      const local = present.every((H) => expectedLocal(path, H)) || (missing.length > 0 && present.length === 1 && expectedLocal(path, present[0]));
      let status;
      if (local) status = 'local';
      else if (vlist.length > 1) status = 'differ';
      else if (missing.length > 0) status = 'missing';
      else status = 'same';
      g.counts[status] += 1;
      if (status !== 'same') g.files.push({ path, status, variants: vlist, missing, majority: vlist[0] ? vlist[0].sha : null });
    }
    g.files.sort((a, b) => ({ differ: 0, missing: 1, local: 2 }[a.status] - { differ: 0, missing: 1, local: 2 }[b.status]) || a.path.localeCompare(b.path));
    groups.push(g);
  }
  groups.sort((a, b) => (b.counts.differ + b.counts.missing) - (a.counts.differ + a.counts.missing) || a.service.localeCompare(b.service) || a.env.localeCompare(b.env));
  return { groups };
}

module.exports = { computeDrift, expectedLocal };
