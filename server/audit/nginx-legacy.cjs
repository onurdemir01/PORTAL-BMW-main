// server/audit/nginx-legacy.cjs - ESKI TIP (proxy_pass + upstream) prod nginx denetimi.
//
// VERI KAYNAGI: dbo.Nginx_Legacy_Audit (servis basina sayilar) ve
// dbo.Nginx_Legacy_Findings (bulgu basina satir). Ikisini de
// bmw_nginx/nginx_legacy_audit isi uretiyor.
//
// NEDEN AYRI EKRAN: Nginx SPA denetimi include desenine gore kurulu; bu sunucularda o
// desen YOK. Buradaki tane SERVIS'tir (GLOMO, WEBFORMS...), location degil - cunku
// sorulan sorular servis duzeyinde: "kac location var, kaci upstream kullaniyor,
// upstream'lerin kacinda resolve yok, eslenik sunucuyla farki ne".
'use strict';

// Bulgu tiplerinin TURKCE karsiligi ve agirligi. 'severity' SIRALAMA icindir:
// once nginx davranisini gercekten degistirenler, sonra hijyen/bilgi.
const FINDING_META = {
  PEER_MISSING_FILE: { label: 'eşlenikte var, bu sunucuda yok (dosya)', severity: 1 },
  PEER_MISSING_LOCATION: { label: 'eşlenikte var, bu sunucuda yok (location)', severity: 1 },
  PEER_MISSING_UPSTREAM: { label: 'eşlenikte var, bu sunucuda yok (upstream)', severity: 1 },
  MISSING_INCLUDE: { label: 'include edilen dosya yok', severity: 1 },
  PROXY_NO_UPSTREAM: { label: 'upstream katmanını atlıyor', severity: 2 },
  PEER_EXTRA_LOCATION: { label: 'yalnızca bu sunucuda (location)', severity: 2 },
  PEER_EXTRA_UPSTREAM: { label: 'yalnızca bu sunucuda (upstream)', severity: 2 },
  UPS_NO_RESOLVE: { label: 'upstream: resolve yok', severity: 3 },
  UPS_NO_KEEPALIVE: { label: 'upstream: keepalive yok', severity: 3 },
  UPS_NO_ZONE: { label: 'upstream: zone yok', severity: 3 },
  UNUSED_UPSTREAM: { label: 'kullanılmayan upstream', severity: 4 },
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Ozet satirlarini SERVIS bazinda toplar ve sunucular arasi tutarliligi cikarir.
 *
 * @param {Array} rows dbo.Nginx_Legacy_Audit satirlari
 * @param {Array} findings dbo.Nginx_Legacy_Findings satirlari
 */
function summarizeLegacy(rows, findings) {
  const byService = new Map();

  for (const r of rows || []) {
    const service = String(r.service || '').trim();
    const host = String(r.host || '').trim().toUpperCase();
    if (!service || !host) continue;

    if (!byService.has(service)) {
      byService.set(service, {
        service,
        peerGroup: String(r.peer_group || '?'),
        hosts: [],
        findings: 0,
      });
    }
    const s = byService.get(service);
    s.hosts.push({
      host,
      vhostFiles: String(r.vhost_files || ''),
      upstreamFiles: String(r.upstream_files || ''),
      serverBlocks: num(r.server_blocks),
      locationsTotal: num(r.locations_total),
      locationsProxy: num(r.locations_proxy),
      locationsOther: num(r.locations_other),
      upstreamsTotal: num(r.upstreams_total),
      upstreamsInVhost: num(r.upstreams_in_vhost),
      upstreamsInFile: num(r.upstreams_in_file),
      proxyWithoutUpstream: num(r.proxy_without_upstream),
      unusedUpstreams: num(r.unused_upstreams),
      upsNoResolve: num(r.ups_no_resolve),
      upsNoKeepalive: num(r.ups_no_keepalive),
      upsNoZone: num(r.ups_no_zone),
    });
  }

  // Bulgular servise VE sunucuya dagitilir.
  const byKey = new Map(); // "service|host" -> [finding]
  const typeCounts = new Map();
  for (const f of findings || []) {
    const service = String(f.service || '').trim();
    const host = String(f.host || '').trim().toUpperCase();
    const type = String(f.finding_type || '').trim();
    const k = service + '|' + host;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({
      type,
      label: (FINDING_META[type] || {}).label || type,
      severity: (FINDING_META[type] || {}).severity || 9,
      item: String(f.item || ''),
      detail: String(f.detail || ''),
    });
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    const s = byService.get(service);
    if (s) s.findings += 1;
  }

  const services = [];
  for (const s of byService.values()) {
    s.hosts.sort((a, b) => a.host.localeCompare(b.host));
    for (const h of s.hosts) {
      h.findings = (byKey.get(s.service + '|' + h.host) || []).sort(
        (a, b) => a.severity - b.severity || a.item.localeCompare(b.item, 'tr'),
      );
    }

    // TUTARLILIK: eslenik sunucularin sayilari AYNI MI? Farkli olmasi tek basina
    // hata degil (yeni bir tanim heniz her sunucuya gitmemis olabilir) ama GORUNMESI
    // gerekir - zaten kullanicinin sordugu sey bu.
    const sig = (h) =>
      [h.locationsTotal, h.locationsProxy, h.upstreamsTotal, h.upstreamsInVhost].join('/');
    const sigs = new Set(s.hosts.map(sig));
    s.consistent = sigs.size <= 1;
    s.signatures = [...sigs];

    // Servis toplamlari EN YUKSEK sunucudan alinir, toplanmaz: ayni tanim her
    // sunucuda tekrar ettigi icin toplamak sayiyi sunucu adedi kadar sisirirdi.
    const max = (f) => s.hosts.reduce((a, h) => Math.max(a, f(h)), 0);
    s.locationsTotal = max((h) => h.locationsTotal);
    s.locationsProxy = max((h) => h.locationsProxy);
    s.upstreamsTotal = max((h) => h.upstreamsTotal);
    s.upstreamsInVhost = max((h) => h.upstreamsInVhost);
    s.proxyWithoutUpstream = max((h) => h.proxyWithoutUpstream);
    s.unusedUpstreams = max((h) => h.unusedUpstreams);
    s.upsNoResolve = max((h) => h.upsNoResolve);
    s.upsNoKeepalive = max((h) => h.upsNoKeepalive);
    s.upsNoZone = max((h) => h.upsNoZone);
    s.hostCount = s.hosts.length;
    services.push(s);
  }

  services.sort(
    (a, b) => b.findings - a.findings || a.service.localeCompare(b.service, 'tr'),
  );

  const totals = {
    services: services.length,
    hosts: new Set((rows || []).map((r) => String(r.host || '').toUpperCase())).size,
    locations: services.reduce((a, s) => a + s.locationsTotal, 0),
    upstreams: services.reduce((a, s) => a + s.upstreamsTotal, 0),
    proxyWithoutUpstream: services.reduce((a, s) => a + s.proxyWithoutUpstream, 0),
    unusedUpstreams: services.reduce((a, s) => a + s.unusedUpstreams, 0),
    inconsistent: services.filter((s) => !s.consistent).length,
    findings: (findings || []).length,
  };

  const byType = [...typeCounts.entries()]
    .map(([type, count]) => ({
      type,
      count,
      label: (FINDING_META[type] || {}).label || type,
      severity: (FINDING_META[type] || {}).severity || 9,
    }))
    .sort((a, b) => a.severity - b.severity || b.count - a.count);

  return { services, totals, byType };
}

module.exports = { summarizeLegacy, FINDING_META };
