// server/audit/nginx-inventory-summary.cjs - dbo.nginx_inventory ozetleme (SAF).
//
// Kaynak: bmw_nginx/nginx_metadata playbook'u. Her sunucuda .metadata dosyasi uretilip
// toplaniyor; tablo her kosuda TRUNCATE edilip yeniden yaziliyor (yani GECMIS YOK,
// tablo her zaman "su anki hal").
//
// Ortam bilgisi BU TABLODA VAR (`env` kolonu) - NginxRateLimitInventory'den farkli
// olarak sunucu adindan turetmeye gerek yok. Yine de degerler serbest metin oldugu icin
// normalize edilir (bosluk/harf) ve BOS olanlar '(bilinmiyor)' kovasina duser: sessizce
// atmak sunucu sayilarini oldugundan kucuk gosterirdi.
'use strict';

const UNKNOWN = '(bilinmiyor)';

function norm(v) {
  const s = String(v == null ? '' : v).trim();
  return s || UNKNOWN;
}

/** Bir alanin deger dagilimi: [{ value, count }] - cok gorulen once. */
function distribution(rows, field, mapper) {
  const m = new Map();
  for (const r of rows) {
    const v = mapper ? mapper(r) : norm(r[field]);
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * "16G" / "512M" gibi degerleri GiB'e cevirir. Cozulemezse null doner - uydurulmus bir
 * sayi toplamlari sessizce bozardi, bu yuzden toplam yalnizca COZULEBILEN satirlardan
 * hesaplanir ve kac satirin disarida kaldigi ayrica bildirilir.
 */
function toGiB(v) {
  const m = /^([\d.]+)\s*([KMGT])i?B?$/i.exec(String(v || '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const mult = { k: 1 / 1048576, m: 1 / 1024, g: 1, t: 1024 }[m[2].toLowerCase()];
  return n * mult;
}

function sumGiB(rows, field) {
  let total = 0;
  let parsed = 0;
  for (const r of rows) {
    const g = toGiB(r[field]);
    if (g !== null) {
      total += g;
      parsed += 1;
    }
  }
  return { totalGiB: Math.round(total), parsed, unparsed: rows.length - parsed };
}

/** Bosluk/virgul ile ayrilmis service listesini tekil adlara boler. */
function splitServices(v) {
  return String(v || '')
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function summarizeNginxInventory(recordset) {
  const rows = (recordset || []).map((r) => ({
    ...r,
    hostname: norm(r.hostname),
    env: norm(r.env),
    location: norm(r.location),
  }));

  // -- ORTAM: env x location kirilimi ---------------------------------------
  const envMap = new Map();
  for (const r of rows) {
    if (!envMap.has(r.env)) envMap.set(r.env, { env: r.env, hosts: 0, locations: new Map() });
    const e = envMap.get(r.env);
    e.hosts += 1;
    e.locations.set(r.location, (e.locations.get(r.location) || 0) + 1);
  }
  const byEnv = [...envMap.values()]
    .map((e) => ({
      env: e.env,
      hosts: e.hosts,
      locations: [...e.locations.entries()]
        .map(([location, hosts]) => ({ location, hosts }))
        .sort((a, b) => b.hosts - a.hosts || a.location.localeCompare(b.location)),
    }))
    .sort((a, b) => b.hosts - a.hosts || a.env.localeCompare(b.env));

  // -- SERVICE: hangi service kac sunucuda ----------------------------------
  // `services` bir sunucudaki TUM service'leri tasir; tekil adlara bolunup sayilir.
  const svcMap = new Map();
  for (const r of rows) {
    for (const s of new Set(splitServices(r.services))) {
      if (!svcMap.has(s)) svcMap.set(s, { service: s, hosts: new Set(), envs: new Set() });
      svcMap.get(s).hosts.add(r.hostname);
      svcMap.get(s).envs.add(r.env);
    }
  }
  const byService = [...svcMap.values()]
    .map((s) => ({ service: s.service, hosts: s.hosts.size, envs: [...s.envs].sort() }))
    .sort((a, b) => b.hosts - a.hosts || a.service.localeCompare(b.service));

  return {
    totals: {
      hosts: rows.length,
      envs: envMap.size,
      services: svcMap.size,
      nginxVersions: new Set(rows.map((r) => norm(r.nginx_version))).size,
      osVersions: new Set(rows.map((r) => norm(r.os))).size,
      cpuTotal: rows.reduce((a, r) => a + (parseInt(r.cpu, 10) || 0), 0),
      memory: sumGiB(rows, 'memory'),
      diskNginx: sumGiB(rows, 'disk_usr_nginx'),
      diskWebLog: sumGiB(rows, 'disk_web_log'),
    },
    byEnv,
    byService,
    versions: {
      nginx: distribution(rows, 'nginx_version'),
      os: distribution(rows, 'os'),
      kernel: distribution(rows, 'kernel'),
      architecture: distribution(rows, 'architecture'),
      metadata: distribution(rows, 'metadata_version'),
    },
    resources: {
      cpu: distribution(rows, 'cpu'),
      memory: distribution(rows, 'memory'),
      diskNginx: distribution(rows, 'disk_usr_nginx'),
      diskWebLog: distribution(rows, 'disk_web_log'),
      configCount: distribution(rows, 'config_count'),
      serviceCount: distribution(rows, 'service_count'),
    },
    other: {
      domain: distribution(rows, 'domain'),
      subnet: distribution(rows, 'subnet'),
      nginxUser: distribution(rows, 'nginx_user'),
    },
  };
}

module.exports = {
  summarizeNginxInventory,
  _distribution: distribution,
  _toGiB: toGiB,
  _splitServices: splitServices,
  _UNKNOWN: UNKNOWN,
};
