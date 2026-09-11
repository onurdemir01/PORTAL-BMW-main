// server/audit/nginx-audit.cjs - "Nginx Audit": TUM nginx sunucularinin -T tabanli denetimi.
//
// VERI: dbo.Nginx_Audit_Hosts / Servers / Locations / Upstreams / Settings.
// Ureten is: bmw_nginx/nginx_audit. Bes tablo, bes tane; burada bir HOST icin
// birlestirilir ki ekran "sunucuyu ac -> server bloklari -> location'lar ->
// upstream'ler -> ayarlar" seklinde akabilsin.
//
// Legacy denetiminden (nginx-legacy.cjs) AYRIDIR: o, 12 prod sunucusunu servis
// tanesinde ve eslenik karsilastirmasiyla olcer. Bu, tum filoyu sunucu tanesinde.
'use strict';

const { envOfHost, siteOfHost, tierOfHost } = require('./nginx-hosts.cjs');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const bit = (v) => v === true || v === 1 || v === '1';

/** Yol yerine dosya adi: ekranda "/usr/nginx/conf.d/GLOMO-PROD.conf" yerine
 *  "GLOMO-PROD.conf". Tam yol ipucunda durur. */
function baseName(p) {
  const s = String(p || '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Bes tablonun satirlarini host bazinda birlestirir.
 * @returns {{hosts: Array, totals: Object}}
 */
function summarizeAudit({ hosts, servers, locations, upstreams, settings }) {
  const byHost = new Map();
  const H = (h) => String(h || '').trim().toUpperCase();

  for (const r of hosts || []) {
    const host = H(r.host);
    if (!host) continue;
    byHost.set(host, {
      host,
      env: envOfHost(host),
      site: siteOfHost(host),
      tier: tierOfHost(host),
      status: String(r.status || '?'),
      statusMsg: String(r.status_msg || ''),
      files: num(r.files),
      serverBlocks: num(r.server_blocks),
      locations: num(r.locations),
      locationsProxy: num(r.locations_proxy),
      upstreams: num(r.upstreams),
      upsNoResolve: num(r.ups_no_resolve),
      upsNoKeepalive: num(r.ups_no_keepalive),
      upsNoZone: num(r.ups_no_zone),
      unusedUpstreams: num(r.unused_upstreams),
      proxyFqdn: num(r.proxy_fqdn),
      proxyUndefined: num(r.proxy_undefined),
      settingsMismatch: num(r.settings_mismatch),
      servers: [],
      locationsByFile: [],
      upstreamList: [],
      settingsMismatched: [],
      settingsOverrides: [],
    });
  }

  for (const r of servers || []) {
    const h = byHost.get(H(r.host));
    if (!h) continue;
    h.servers.push({
      file: baseName(r.conf_file),
      filePath: String(r.conf_file || ''),
      seq: num(r.seq),
      listen: String(r.listen || ''),
      serverName: String(r.server_name || ''),
      ssl: bit(r.ssl),
      cert: baseName(r.cert_file),
      certPath: String(r.cert_file || ''),
      locations: num(r.locations),
    });
  }

  // "Hangi dosyada kac location" + her location'in hedef turu; dosya bazinda toplanir.
  const locAgg = new Map(); // host|file -> agg
  for (const r of locations || []) {
    const host = H(r.host);
    const h = byHost.get(host);
    if (!h) continue;
    const k = host + '|' + String(r.conf_file || '');
    if (!locAgg.has(k)) {
      locAgg.set(k, {
        file: baseName(r.conf_file),
        filePath: String(r.conf_file || ''),
        total: 0,
        proxy: 0,
        toUpstream: 0,
        toFqdn: 0,
        undefined: 0,
        other: 0,
        // Bulgu olan location'lar ADIYLA listelenir; "3 tane var" demek yetmez.
        fqdnList: [],
        undefinedList: [],
      });
    }
    const a = locAgg.get(k);
    a.total += 1;
    const beh = String(r.behaviour || '');
    const kind = String(r.target_kind || 'none');
    if (beh === 'proxy') a.proxy += 1;
    else a.other += 1;
    if (kind === 'upstream') a.toUpstream += 1;
    else if (kind === 'fqdn') {
      a.toFqdn += 1;
      a.fqdnList.push({ location: String(r.location || ''), target: String(r.proxy_target || '') });
    } else if (kind === 'undefined') {
      a.undefined += 1;
      a.undefinedList.push({
        location: String(r.location || ''),
        target: String(r.proxy_target || ''),
      });
    }
  }
  for (const [k, a] of locAgg) {
    byHost.get(k.split('|')[0]).locationsByFile.push(a);
  }

  for (const r of upstreams || []) {
    const h = byHost.get(H(r.host));
    if (!h) continue;
    h.upstreamList.push({
      file: baseName(r.conf_file),
      name: String(r.name || ''),
      server: String(r.server || ''),
      resolve: bit(r.resolve),
      keepalive: bit(r.keepalive),
      zone: bit(r.zone),
      used: bit(r.used),
    });
  }

  // Ayarlar: global uyumsuzluk (bulgu) ile yerel override (bilgi) AYRI listelenir.
  // Override'lar direktif+deger bazinda SAYILIR: 241 location ayni 60s'i tekrar
  // ediyorsa 241 satir degil "proxy_read_timeout 60s x241" gorunmeli.
  const overAgg = new Map(); // host|ctx|directive|value -> count
  for (const r of settings || []) {
    const host = H(r.host);
    const h = byHost.get(host);
    if (!h) continue;
    const ctx = String(r.context || '');
    const directive = String(r.directive || '');
    const value = String(r.value || '');
    const ref = r.reference_value == null ? null : String(r.reference_value);
    const matches = r.matches == null ? null : bit(r.matches);
    const isGlobal = ctx === 'main' || ctx === 'http' || ctx === 'events' || ctx === 'global';
    if (isGlobal) {
      if (matches === false) {
        h.settingsMismatched.push({
          directive,
          value,
          reference: ref,
          file: baseName(r.conf_file),
          missing: !String(r.conf_file || ''),
        });
      }
    } else if (matches === false) {
      const k = [host, ctx, directive, value].join('|');
      if (!overAgg.has(k)) overAgg.set(k, { context: ctx, directive, value, reference: ref, count: 0 });
      overAgg.get(k).count += 1;
    }
  }
  for (const [k, o] of overAgg) {
    byHost.get(k.split('|')[0]).settingsOverrides.push(o);
  }

  const list = [...byHost.values()];
  for (const h of list) {
    h.servers.sort((a, b) => a.seq - b.seq);
    h.locationsByFile.sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
    h.upstreamList.sort((a, b) => a.name.localeCompare(b.name));
    h.settingsMismatched.sort((a, b) => a.directive.localeCompare(b.directive));
    h.settingsOverrides.sort((a, b) => b.count - a.count || a.directive.localeCompare(b.directive));
    // Sunucunun "sorun puani": once nginx davranisini bozanlar.
    h.issues =
      (h.status === 'fail' ? 1000 : 0) +
      h.proxyUndefined * 100 +
      h.settingsMismatch * 10 +
      h.proxyFqdn +
      h.unusedUpstreams +
      h.upsNoResolve;
  }
  list.sort((a, b) => b.issues - a.issues || a.host.localeCompare(b.host));

  const sum = (f) => list.reduce((a, h) => a + f(h), 0);
  const totals = {
    hosts: list.length,
    configInvalid: list.filter((h) => h.status === 'fail').length,
    serverBlocks: sum((h) => h.serverBlocks),
    locations: sum((h) => h.locations),
    upstreams: sum((h) => h.upstreams),
    proxyUndefined: sum((h) => h.proxyUndefined),
    proxyFqdn: sum((h) => h.proxyFqdn),
    unusedUpstreams: sum((h) => h.unusedUpstreams),
    upsNoResolve: sum((h) => h.upsNoResolve),
    upsNoKeepalive: sum((h) => h.upsNoKeepalive),
    settingsMismatch: sum((h) => h.settingsMismatch),
    hostsWithMismatch: list.filter((h) => h.settingsMismatch > 0).length,
  };

  return { hosts: list, totals };
}

module.exports = { summarizeAudit, _baseName: baseName };
