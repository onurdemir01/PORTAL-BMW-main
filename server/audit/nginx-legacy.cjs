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

// Her bulgu tipi icin: kisa etiket (ciplerde), baslik, NE DEMEK, NE YAPMALI ve grup.
//
// NEDEN BU KADAR METIN: kullanici ilk okuyusta "upstream: zone yok: 202" gibi bir cipin
// ne anlama geldigini cikaramadi. Tip kodu ve sayi yetmiyor; okuyanin sormasi gereken
// iki soru var - "bu ne demek?" ve "ne yapayim?" - ikisi de burada cevaplaniyor.
//
// 'severity' SIRALAMA icindir (0 en agir). 'group' EKRANDAKI KUME:
//   critical -> servis calismaz / reload yapilamaz
//   peer     -> eslenik sunucular birbirinden farkli
//   hygiene  -> calisir ama upstream katmaninin faydalari devre disi
//   info     -> temizlik adayi, servisi etkilemez
const GROUP_META = {
  critical: {
    title: 'Servisi bozar',
    blurb: 'Bu bulgularla nginx başlamaz ya da reload edilemez. Önce bunlar.',
    tone: 'danger',
  },
  peer: {
    title: 'Eşlenikler arasında fark',
    blurb:
      'Aynı grubun sunucuları aynı konfigürasyonu taşımalı. Referans, grubun çoğunluğudur — ilk sunucu doğru varsayılmaz.',
    tone: 'warning',
  },
  hygiene: {
    title: 'Upstream hijyeni',
    blurb:
      'Servis çalışır ama resolve / keepalive / zone avantajlarının bir kısmı devre dışı.',
    tone: 'neutral',
  },
  info: {
    title: 'Temizlik adayı',
    blurb: 'Servisi etkilemez; kaldırılabilir tanımlar.',
    tone: 'muted',
  },
};

const FINDING_META = {
  CONFIG_INVALID: {
    label: 'konfigürasyon geçersiz — reload edilemez',
    title: 'Konfigürasyon geçersiz',
    meaning:
      '`nginx -T` bu sunucuda hata verdi: diskteki konfigürasyon ayrıştırılamıyor (eksik include, sözdizimi hatası…).',
    action:
      'nginx şu an çalışıyor olabilir ama bir sonraki reload BAŞARISIZ olur. Sunucuda `nginx -t` çıktısına bakılmalı.',
    group: 'critical',
    severity: 0,
  },
  PROXY_UNDEFINED_TARGET: {
    label: 'hedef tanımsız — nginx başlamaz',
    title: 'Hedef tanımsız',
    meaning:
      "proxy_pass bir ada gidiyor ama o ad ne tanımlı bir upstream ne de DNS'te çözülebilir bir adres.",
    action: 'nginx bu konfigürasyonla başlamaz. Upstream tanımlanmalı ya da hedef düzeltilmeli.',
    group: 'critical',
    severity: 0,
  },
  MISSING_INCLUDE: {
    label: 'include edilen dosya yok',
    title: 'Include edilen dosya yok',
    meaning: 'Konfigürasyon bir dosyayı include ediyor ama o dosya diskte yok.',
    action: '`nginx -t` düşer, reload yapılamaz. Dosya geri konmalı ya da include satırı kaldırılmalı.',
    group: 'critical',
    severity: 1,
  },
  PEER_MISSING_FILE: {
    label: 'eşlenikte var, bu sunucuda yok (dosya)',
    title: 'Servis dosyası bu sunucuda yok',
    meaning: 'Grubun çoğunluğunda bu servisin conf dosyası var, bu sunucuda yok.',
    action: 'Sunucu bu servisi hiç sunmuyor olabilir. Dosya eşlenikten alınmalı.',
    group: 'peer',
    severity: 1,
  },
  PEER_MISSING_LOCATION: {
    label: 'eşlenikte var, bu sunucuda yok (location)',
    title: 'Location bu sunucuda eksik',
    meaning: "Grubun çoğunluğunda olan bir location tanımı bu sunucuda yok.",
    action: 'Bu sunucuya gelen istek 404 dönebilir. Tanım eşlenikten kopyalanmalı.',
    group: 'peer',
    severity: 1,
  },
  PEER_MISSING_UPSTREAM: {
    label: 'eşlenikte var, bu sunucuda yok (upstream)',
    title: 'Upstream bu sunucuda eksik',
    meaning: 'Grubun çoğunluğunda tanımlı bir upstream bu sunucuda yok.',
    action: 'Onu kullanan location varsa nginx başlamaz. Tanım eşlenikten kopyalanmalı.',
    group: 'peer',
    severity: 1,
  },
  PEER_EXTRA_LOCATION: {
    label: 'yalnızca bu sunucuda (location)',
    title: 'Location yalnızca bu sunucuda',
    meaning: 'Bu location tanımı eşleniklerde yok, sadece burada var.',
    action: 'Ya diğerlerine dağıtılmamış ya da burada unutulmuş. Hangisi olduğuna bakılmalı.',
    group: 'peer',
    severity: 2,
  },
  PEER_EXTRA_UPSTREAM: {
    label: 'yalnızca bu sunucuda (upstream)',
    title: 'Upstream yalnızca bu sunucuda',
    meaning: 'Bu upstream tanımı eşleniklerde yok, sadece burada var.',
    action: 'Ya diğerlerine dağıtılmamış ya da burada unutulmuş.',
    group: 'peer',
    severity: 2,
  },
  PROXY_NO_UPSTREAM: {
    label: 'upstream katmanını atlıyor',
    title: 'Upstream katmanını atlıyor',
    meaning:
      "proxy_pass doğrudan DNS adına gidiyor (…apps.fw.garanti.com.tr), tanımlı bir upstream'e değil.",
    action:
      'Çalışır ama resolve / keepalive / zone devre dışı. Bir upstream tanımlanıp proxy_pass ona yönlendirilmeli.',
    group: 'hygiene',
    severity: 2,
  },
  UPS_NO_RESOLVE: {
    label: 'upstream: resolve yok',
    title: "Upstream'de resolve yok",
    meaning:
      'Arka uç adresi yalnızca nginx başlarken çözülür. OpenShift tarafında IP değişirse nginx eskisine gitmeye devam eder.',
    action: "server satırının sonuna `resolve` eklenmeli (zone ile birlikte çalışır).",
    group: 'hygiene',
    severity: 3,
  },
  UPS_NO_KEEPALIVE: {
    label: 'upstream: keepalive yok',
    title: "Upstream'de keepalive yok",
    meaning: 'Arka uca her istekte yeni TLS bağlantısı açılır.',
    action: '`keepalive 10;` eklenmeli.',
    group: 'hygiene',
    severity: 3,
  },
  UPS_NO_ZONE: {
    label: 'upstream: zone yok',
    title: "Upstream'de zone yok",
    meaning:
      "Paylaşımlı bellek alanı tanımlı değil. `resolve` bu alan olmadan çalışmaz; worker'lar çözümü paylaşamaz.",
    action: '`zone upstream_dynamic 4m;` eklenmeli.',
    group: 'hygiene',
    severity: 3,
  },
  UNUSED_UPSTREAM: {
    label: 'kullanılmayan upstream',
    title: 'Kullanılmayan upstream',
    meaning: "Tanımlı ama hiçbir location ona proxy_pass yapmıyor.",
    action: 'Servisi etkilemez. Kaldırılabilir.',
    group: 'info',
    severity: 4,
  },
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
      // `?? 9`, `|| 9` DEGIL: en agir tipin severity'si 0 ve `0 || 9` => 9 olurdu,
      // yani "nginx baslamaz" bulgusu listenin EN SONUNA duserdi.
      severity: (FINDING_META[type] || {}).severity ?? 9,
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

  // Bilinmeyen bir tip GIZLENMEZ: kodu baslik olur, aciklamasi bos kalir, 'info'
  // grubuna duser. Yeni bir tip eklenip burasi unutulursa ekranda yine gorunur.
  const byType = [...typeCounts.entries()]
    .map(([type, count]) => {
      const m = FINDING_META[type] || {};
      return {
        type,
        count,
        label: m.label || type,
        title: m.title || type,
        meaning: m.meaning || '',
        action: m.action || '',
        group: m.group || 'info',
        severity: m.severity ?? 9,
      };
    })
    .sort((a, b) => a.severity - b.severity || b.count - a.count);

  // Ekran icin gruplu gorunum: yalnizca bulgusu OLAN gruplar.
  const groups = Object.keys(GROUP_META)
    .map((g) => ({
      id: g,
      ...GROUP_META[g],
      types: byType.filter((t) => t.group === g),
      count: byType.filter((t) => t.group === g).reduce((a, t) => a + t.count, 0),
    }))
    .filter((g) => g.types.length > 0);

  return { services, totals, byType, groups };
}

module.exports = { summarizeLegacy, FINDING_META, GROUP_META };
