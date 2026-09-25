// server/server-hub/assess.cjs - Server Hub degerlendirmesi (saf; birim testli).
//
// Kullanici (2026-09-21): "sunucu reboot oldugunda her sey dogru acilacak mi ve sunucularda
// atil bir sey var mi". Kaynak: dbo.Server_Hub_* (bmw_automation_folder/server_hub, gunluk +
// istege bagli tek sunucu). Bu modul ham satirlari sunucu basina BULGULARA ve genel ozete cevirir.
//
// JVM <-> vhost eslemesi (retire karari) BURADA yapilir, tarayicida degil (iki farkli
// sunucunun verisi gerekir):
//   1) vhost.proxy_targets icindeki "host:port" -> JVM'in host'u + dinledigi port (kesin)
//   2) tutmazsa: web sunucu adaylari = ayni host + 5. harf A->W (Denetim > Web-App kurali,
//      audit/web-app.cjs webHostOf) uzerindeki vhost'larin server_name/alias'inda JVM adi (tahmin)
// Bulgu siddeti: danger > warning > info; sunucu durumu = en kotu bulgu.
'use strict';

const { webHostOf, matchWebForApp } = require('../audit/web-app.cjs');

const SEV = { ok: 0, info: 1, warning: 2, danger: 3 };

/**
 * GENEL ENVANTER DISI SUNUCULAR (kullanici, 2026-09-24): GBEVM* ve GBPRV* filo
 * ortalamalarini bozuyor (farkli kurulum, farkli omur). Taranmaya devam ederler ve
 * bulgulari durur; yalnizca OZET/ORTAM kirilimi ve varsayilan liste GENEL envanteri
 * gosterir, bunlar AYRI listelenir. Ayni ayrim Denetim > Init Scripts icin de gecerli.
 */
const SPECIAL_HOST_RE = /^(GBEVM|GBPRV)/i;
const hostClassOf = (host) => (SPECIAL_HOST_RE.test(String(host || '').trim()) ? 'ozel' : 'genel');
const L = (s) => String(s || '').trim().toLowerCase();
const U = (s) => String(s || '').trim().toUpperCase();
// IP'ler kisaltilmaz (10.1.1.5 -> '10' olurdu); yalniz ad ise ilk etiket
const shortHost = (s) => (/^\d+\.\d+\.\d+\.\d+$/.test(String(s || '').trim()) ? String(s).trim() : U(s).split('.')[0]);

/** "host:port,host2:port2" -> [{host, port}] */
function parseTargets(text) {
  return String(text || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^\[?([^\]:]+)\]?(?::(\d+))?$/);
    return m ? { host: shortHost(m[1]), port: m[2] ? Number(m[2]) : null } : null;
  }).filter(Boolean);
}

/**
 * @param {object} data  { hosts, init, jboss, jvms, web, vhosts, ips }  — her sunucu icin SON taramanin satirlari
 * @returns {{ hosts: object[], summary: object, latestScan: string|null }}
 */
function assess(data) {
  const byHost = new Map();
  const H = (h) => {
    const k = shortHost(h);
    if (!byHost.has(k)) byHost.set(k, { host: k, scanDate: null, products: [], wallS: null, cpuS: null, init: [], jboss: [], jvms: [], web: [], vhosts: [], ips: [], sshd: null, findings: [] });
    return byHost.get(k);
  };
  for (const r of data.hosts || []) {
    const h = H(r.host);
    h.scanDate = r.scan_date ? new Date(r.scan_date).toISOString().slice(0, 10) : null;
    h.products = String(r.products || '').split(/\s+/).filter((p) => p && p !== 'NONE');
    h.wallS = r.wall_s == null ? null : Number(r.wall_s);
    h.cpuS = r.cpu_s == null ? null : Number(r.cpu_s);
  }
  for (const r of data.init || []) H(r.host).init.push({ root: r.root, file: r.file, refStatus: U(r.status), sha: r.sha512 || null, status: U(r.status), majority: null, majorityCount: 0, variantCount: 0 });
  for (const r of data.jboss || []) H(r.host).jboss.push({ gen: Number(r.gen), hostName: r.host_name || '', hostState: L(r.host_state), cli: U(r.cli), note: r.note || '' });
  for (const r of data.jvms || []) H(r.host).jvms.push({
    gen: Number(r.gen), name: String(r.jvm || '').trim(), group: r.grp || '', running: Number(r.running) === 1,
    autoStart: L(r.auto_start) || 'unknown', serverState: L(r.server_state) || 'unknown',
    ports: String(r.ports || '').split(',').map((p) => Number(p)).filter((p) => p > 0),
    vhosts: [], req24h: null, req7d: null, matchKind: null,
  });
  for (const r of data.web || []) H(r.host).web.push({ product: U(r.product), running: Number(r.running) === 1, syntax: U(r.syntax), detail: r.detail || '' });
  for (const r of data.vhosts || []) H(r.host).vhosts.push({
    product: U(r.product), listen: r.listen || '', serverName: r.server_name || '', aliases: r.aliases || '',
    accessLog: r.access_log || '', proxyTargets: parseTargets(r.proxy_targets), proxyTargetsRaw: r.proxy_targets || '',
    req24h: r.req_24h == null ? null : Number(r.req_24h), req7d: r.req_7d == null ? null : Number(r.req_7d),
    hc24h: r.hc_24h == null ? null : Number(r.hc_24h), shared: Number(r.shared) === 1, sampled: Number(r.sampled) === 1,
    confFile: r.conf_file || '', jvm: null,
  });
  // ── Ortam (2026-09-22): dbo.Inventory.env; yoksa sunucu adindan (…P\d = prod). Non-Prod/Prod kirilimi.
  const ENV_TR = { PRODUCTION: 'PROD', PROD: 'PROD', TEST: 'TEST', QA: 'QA', ALPHA: 'ALPHA', ODM: 'ODM', DEV: 'DEV', EDU: 'EDU' };
  const envByHost = new Map();
  for (const r of data.invEnv || []) {
    const k = shortHost(r.host);
    const v = ENV_TR[U(r.env)] || null;
    if (k && v) envByHost.set(k, v);
  }
  const envOf = (host) => {
    if (envByHost.has(host)) return envByHost.get(host);
    const m = /^[A-Z]{4,6}?(A?)([DTQPO])\d+$/.exec(host);
    if (m) return { D: 'DEV', T: 'TEST', Q: 'QA', P: 'PROD', O: 'ODM' }[m[2]] || 'BILINMIYOR';
    return 'BILINMIYOR';
  };

  // ── JVM: envanter (MWAppsInventory) ile birlestir ──────────────────────────────
  const appsByHost = new Map();
  for (const r of data.mwApps || []) {
    const k = shortHost(r.host);
    if (!k) continue;
    if (!appsByHost.has(k)) appsByHost.set(k, []);
    appsByHost.get(k).push({
      app: String(r.app || '').trim(),
      status: L(r.status),
      jvmCount: Number(r.jvm_count) || 0,
      autoStarts: String(r.autostarts || '').trim().split(/\s+/).filter(Boolean).map((x) => L(x)),
      domain: String(r.domain || '').trim(),
      tier: r.tier == null ? null : String(r.tier),
      env: ENV_TR[U(r.env)] || null,
    });
  }

  for (const r of data.sshd || []) H(r.host).sshd = { maxSessions: r.max_sessions == null ? null : Number(r.max_sessions), maxStartups: r.max_startups || '', activeSessions: r.active_sessions == null ? null : Number(r.active_sessions) };
  for (const r of data.ips || []) H(r.host).ips.push({ ip: r.ip, iface: r.iface || '', usedBy: L(r.used_by) || 'none', primary: Number(r.is_primary) === 1 });

  // Envanter <-> CLI birlestirme: CLI'da olmayan uygulamalar envanterden eklenir (kaynak isaretli),
  // ikisinde de varsa celiski (calisiyor/kapali ya da auto-start) BULGU olarak isaretlenir.
  // Envanterdeki urunler (dbo.Inventory) - tarama sonucundan AYRI tutulur (kullanici, 2026-09-24)
  const invProductsByHost = new Map();
  for (const r of (data.invEnv || [])) {
    if (!r || !r.host) continue;
    const k = U(shortHost(r.host));
    if ((r.invProducts || []).length) invProductsByHost.set(k, r.invProducts);
  }
  for (const h of byHost.values()) {
    h.invProducts = invProductsByHost.get(U(h.host)) || [];
    h.env = envOf(h.host);
    h.envGroup = h.env === 'PROD' ? 'Production' : (h.env === 'BILINMIYOR' ? 'Bilinmiyor' : 'Non-Production');
    // JBOSS OLMAYAN SUNUCU (kullanici, 2026-09-24): "JBoss olmayan sunuculara bakmani istemiyorum".
    // Eskiden dbo.MWAppsInventory'deki her uygulama icin JVM satiri uretiliyordu; JBoss kurulu
    // OLMAYAN sunucularda bunlarin auto-start'i dogal olarak okunamiyor ve ekran "bilinmiyor"
    // doluyordu. Artik envanter JVM'leri yalnizca sunucuda JBoss VARSA eklenir.
    const hasJboss = h.jboss.length > 0
      || h.jvms.some((j) => j.source === 'cli' || j.gen > 0)
      || (h.products || []).some((x) => /^JBOSS/i.test(x))
      || (h.invProducts || []).includes('JBOSS');
    const apps = hasJboss ? (appsByHost.get(h.host) || []) : [];
    h.hasJboss = hasJboss;
    h.invApps = apps.length;
    h.invAppsSkipped = hasJboss ? 0 : (appsByHost.get(h.host) || []).length;
    for (const a of apps) {
      const hit = h.jvms.find((j) => L(j.name) === L(a.app));
      const invRunning = a.status === 'running';
      const invAuto = a.autoStarts.length ? (a.autoStarts.every((x) => x === 'true') ? 'true' : (a.autoStarts.every((x) => x === 'false') ? 'false' : 'karisik')) : 'unknown';
      if (hit) {
        hit.domain = a.domain || hit.domain || '';
        hit.invStatus = a.status || null;
        hit.invAutoStart = invAuto;
        hit.invJvmCount = a.jvmCount;
        hit.mismatch = [];
        if (a.status && hit.running !== invRunning) hit.mismatch.push(`durum: envanter ${a.status}, tarama ${hit.running ? 'çalışıyor' : 'kapalı'}`);
        if (invAuto !== 'unknown' && invAuto !== 'karisik' && hit.autoStart !== 'unknown' && hit.autoStart !== invAuto) hit.mismatch.push(`auto-start: envanter ${invAuto}, tarama ${hit.autoStart}`);
        // CLI auto-start okuyamadiysa ENVANTER kazanir (kullanici: "JVM bilgisi envanterden gelsin")
        if (hit.autoStart === 'unknown' && invAuto !== 'unknown') { hit.autoStart = invAuto === 'karisik' ? 'unknown' : invAuto; hit.autoStartSource = 'envanter'; }
        else hit.autoStartSource = hit.autoStartSource || 'cli';
      } else {
        h.jvms.push({
          gen: 0, name: a.app, group: '', domain: a.domain || '', running: invRunning, autoStart: invAuto === 'karisik' ? 'unknown' : invAuto,
          serverState: a.status || 'unknown', ports: [], vhosts: [], req24h: null, req7d: null, matchKind: null,
          source: 'envanter', invStatus: a.status || null, invAutoStart: invAuto, invJvmCount: a.jvmCount, mismatch: [],
          autoStartSource: 'envanter',
        });
      }
    }
    for (const j of h.jvms) if (!j.source) j.source = 'cli';
  }

  // ── JVM <-> vhost eslemesi ──────────────────────────────────────────────────────
  // KAYNAK (kullanici, 2026-09-24): "JVM'in web host'unu bulacaksin, web host'unda uygulamaya ait
  // VirtualHost blogunu bulacaksin, o blokta access log'un yazdigi lokasyonu bulacaksin ve oradan
  // hc.jsp/hc.html haric istek var mi diye bakacaksin."
  //   1) proxy hedefi (host:port) - kesin kanit, once bu denenir
  //   2) Denetim > Web-App iliskisi - AYNI fonksiyon (audit/web-app.cjs matchWebForApp): tier
  //      domain'den, web sunucusu adayi 3-tier'da 5. harf A->W, server_name'de uygulama adi
  //   3) ayni aday sunucuda alias eslesmesi (server_name tutmadiginda)
  // Istek sayilari taramadan gelir ve hc.jsp/hc.html ZATEN haric tutulur (count_log: hc ayri
  // sayilir, r24/r7'ye girmez); access log yolu VHOST kaydinda accessLog alanindadir.
  const allVhosts = [];
  for (const h of byHost.values()) for (const v of h.vhosts) allVhosts.push({ host: h.host, v });
  // Web-App kuralinin bekledigi indeks: SUNUCU -> vhost listesi (buyuk harf anahtar).
  // Sertifika envanteri yerine BU TARAMANIN vhost'lari kullanilir; trafik sayilari da ayni
  // kayittan gelsin diye her girdi kendi vhost'una geri referans tasir.
  const vhostIndex = new Map();
  for (const { host, v } of allVhosts) {
    const k = U(host);
    if (!vhostIndex.has(k)) vhostIndex.set(k, []);
    const [vip, vport] = String(v.listen || '').split(':');
    vhostIndex.get(k).push({ host, ip: vip || '', port: vport || '', serverName: v.serverName || '', confFile: v.confFile || '', product: v.product || '', __host: host, __v: v });
  }
  for (const h of byHost.values()) {
    for (const j of h.jvms) {
      // 1) proxy hedefi kesin eslesme
      for (const { host, v } of allVhosts) {
        if (v.proxyTargets.some((t) => t.host === h.host && (t.port == null || j.ports.includes(t.port)))) {
          j.vhosts.push({ host, v }); j.matchKind = j.matchKind || 'proxy';
        }
      }
      // 2) Denetim > Web-App iliskisi (yalniz kesin eslesme yoksa)
      if (!j.vhosts.length && j.name) {
        const rel = matchWebForApp({ app: j.name, appHost: h.host, domain: j.domain || '' }, vhostIndex);
        j.webMatch = { tier: rel.tier, how: rel.how, webHost: rel.webHostCandidate, vhostsOnWebHost: rel.vhostCountOnHost };
        if (rel.matched) {
          for (const e of rel.web) { j.vhosts.push({ host: e.__host, v: e.__v }); j.matchKind = 'web-app'; }
        } else {
          // 3) server_name tutmadi: ayni aday sunucuda ALIAS'ta ad geciyor mu
          const needle = L(j.name);
          const cands = new Set([U(h.host), U(rel.webHostCandidate || '')].filter(Boolean));
          for (const { host, v } of allVhosts) {
            if (!cands.has(U(host))) continue;
            if (L(v.aliases).includes(needle)) { j.vhosts.push({ host, v }); j.matchKind = 'alias'; }
          }
        }
      }
      for (const m of j.vhosts) m.v.jvm = `${h.host}/${j.name}`;
      const known = j.vhosts.filter((m) => m.v.req7d != null && m.v.req7d >= 0);
      if (known.length) {
        j.req24h = known.reduce((a, m) => a + Math.max(0, m.v.req24h || 0), 0);
        j.req7d = known.reduce((a, m) => a + Math.max(0, m.v.req7d || 0), 0);
      }
    }
  }

  // ── Init: FILO COGUNLUGU (Denetim > Init Script ile ayni olcut; 2026-09-22) ──────
  // Kullanici: "Denetim'e gore cogu sunucu referansla uyumlu ama Server Hub 85/1114 diyor."
  // Repo referansi (INIT.status) ile sunuculardaki dosya mesru olarak farkli olabilir (repo
  // guncel degil / satir sonu). Olcut: dosya basina en kalabalik sha = cogunluk; ona uyan OK,
  // uymayan DIFF (bulgu), yok MISSING. Repo referansiyla fark yalniz bilgi olarak tasinir.
  const shaCounts = new Map(); // "root/file" -> Map(sha -> n)
  for (const h of byHost.values()) for (const i of h.init) {
    if (!i.sha) continue;
    const k = `${i.root}/${i.file}`;
    if (!shaCounts.has(k)) shaCounts.set(k, new Map());
    shaCounts.get(k).set(i.sha, (shaCounts.get(k).get(i.sha) || 0) + 1);
  }
  const majorityOf = new Map();
  for (const [k, m] of shaCounts) {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    majorityOf.set(k, { sha: sorted[0][0], count: sorted[0][1], variants: sorted.length, total: sorted.reduce((a, x) => a + x[1], 0) });
  }
  for (const h of byHost.values()) for (const i of h.init) {
    const mj = majorityOf.get(`${i.root}/${i.file}`);
    if (!mj) continue;
    i.majority = mj.sha; i.majorityCount = mj.count; i.variantCount = mj.variants; i.majorityTotal = mj.total;
    if (i.refStatus === 'MISSING') i.status = 'MISSING';
    else if (i.sha && i.sha === mj.sha) i.status = 'OK';
    else if (i.sha) i.status = 'DIFF';
  }

  // ── Bulgular ───────────────────────────────────────────────────────────────────
  const hosts = [];
  for (const h of byHost.values()) {
    const F = h.findings;
    const add = (severity, area, code, text, fix) => F.push({ severity, area, code, text, fix: fix || null });
    // init
    for (const i of h.init) {
      if (i.status === 'DIFF') add('warning', 'init', 'INIT_DIFF', `${i.root}/${i.file} filo çoğunluğundan farklı (çoğunluk ${i.majorityCount}/${i.majorityTotal || '?'} sunucu, ${i.variantCount} sürüm)${i.refStatus === 'OK' ? ' — repo referansıyla AYNI' : ''}`);
      else if (i.status === 'MISSING') add('info', 'init', 'INIT_MISSING', `${i.root}/${i.file} yok`);
    }
    // jboss host
    for (const b of h.jboss) {
      if (b.cli === 'FAIL') add('info', 'jboss', 'CLI_FAIL', `JBoss ${b.gen} CLI erişilemedi: ${b.note}`.trim());
      if (b.hostState === 'restart-required' || b.hostState === 'reload-required') add('warning', 'jboss', 'HOST_RESTART', `JBoss ${b.gen} host controller ${b.hostState}`);
    }
    // jvm
    for (const j of h.jvms) {
      const id = `JBoss${j.gen} ${j.name}`;
      const fixOn = { action: 'jboss_autostart_on', gen: j.gen, jvm: j.name };
      const fixOff = { action: 'jboss_autostart_off', gen: j.gen, jvm: j.name };
      if (j.running && j.autoStart === 'false') add('danger', 'jvm', 'REBOOT_RISK', `${id} çalışıyor ama auto-start KAPALI — reboot sonrası açılmaz`, fixOn);
      if (j.running && j.autoStart === 'unknown' && h.hasJboss) add('info', 'jvm', 'AUTOSTART_UNKNOWN', `${id} auto-start okunamadı (CLI ve envanter)`);
      if ((j.mismatch || []).length) add('info', 'jvm', 'INV_MISMATCH', `${id}: ${j.mismatch.join('; ')}`);
      if (!j.running && j.autoStart === 'true') add('warning', 'jvm', 'STOPPED_AUTOSTART_ON', `${id} kapalı ama auto-start AÇIK — reboot'ta açılacak`, fixOff);
      if (j.running && (j.serverState === 'restart-required' || j.serverState === 'reload-required')) add('warning', 'jvm', 'RESTART_REQUIRED', `${id} ${j.serverState}: runtime'da etkin olmayan değişiklik var`);
      const hasTraffic = j.req7d != null;
      // Kanit: hangi web sunucusu, hangi vhost, hangi access log (kullanici istegi)
      const kanit = j.vhosts.length
        ? ` [${j.matchKind === 'proxy' ? 'proxy hedefi' : j.matchKind === 'web-app' ? 'Web-App ilişkisi' : j.matchKind}: ${j.vhosts.map((m) => `${m.host}/${m.v.serverName || '?'}${m.v.accessLog ? ' → ' + m.v.accessLog : ''}`).slice(0, 2).join(', ')}${j.vhosts.length > 2 ? ' +' + (j.vhosts.length - 2) : ''}]`
        : '';
      if (!j.running && hasTraffic && j.req7d === 0) add('warning', 'jvm', 'RETIRE_CANDIDATE', `${id} kapalı ve web katmanında 7 gündür istek yok (hc.jsp/hc.html hariç) — retire adayı${kanit}`, { action: 'jboss_retire', gen: j.gen, jvm: j.name });
      else if (!j.running && !hasTraffic && j.autoStart === 'false') add('info', 'jvm', 'STOPPED', `${id} kapalı (web katmanı eşlenemedi${j.webMatch ? ': ' + j.webMatch.how : ''})`);
      if (j.running && hasTraffic && j.req7d === 0) add('warning', 'jvm', 'NO_LOAD', `${id} çalışıyor ama 7 gündür istek yok (hc.jsp/hc.html hariç)${kanit}`);
    }
    // URUN KAPSAMI (kullanici, 2026-09-24): envanter (dbo.Inventory) ne diyor, tarama ne gordu.
    // Tarama bir urunu goremediyse bu "urun yok" demek DEGILDIR - yetki/yol sorunu olabilir ve
    // sayfa "300 sunucuda 127 nginx" gibi eksik bir tablo gosterir. Fark acikca bulgu olur.
    for (const ip of (h.invProducts || [])) {
      const gorundu = (h.products || []).some((x) => U(x).startsWith(ip));
      if (!gorundu) add('warning', 'scan', 'PRODUCT_NOT_SCANNED', `Envanterde ${ip} var ama tarama bu sunucuda göremedi (yetki ya da yol farkı olabilir)`);
    }
    for (const sp of (h.products || [])) {
      if (sp === 'NONE') continue;
      const base = U(sp).replace(/[0-9]+$/, '');
      if ((h.invProducts || []).length && !(h.invProducts || []).some((x) => base.startsWith(x) || x.startsWith(base))) {
        add('info', 'scan', 'PRODUCT_NOT_IN_INVENTORY', `Taramada ${sp} bulundu ama envanterde (dbo.Inventory) yok`);
      }
    }
    // web
    for (const w of h.web) {
      if (w.syntax === 'FAIL') {
        const m = w.detail.match(/line (\d+) of (\S+?):?(\s|$)/i);
        add('danger', 'web', 'SYNTAX_FAIL', `${w.product} sözdizimi hatalı: ${w.detail}`.trim(),
          m && w.product !== 'NGINX' ? { action: 'apache_comment_line', product: w.product, file: m[2].replace(/:$/, ''), line: Number(m[1]) } : null);
      }
      // OLCULEMEDI SESSIZ KALMAZ (2026-09-26): tarama www ile kosuyor; sertifika anahtari
      // okunamadiginda nginx -t duser. Bunu "sozdizimi hatali" saymak yanlis alarm, hic
      // gostermemek ise sunucuyu "sorunsuz" gibi gostermek olurdu.
      if (w.syntax === 'UNKNOWN') {
        add('info', 'web', 'SYNTAX_UNKNOWN', `${w.product} sözdizimi ölçülemedi: ${w.detail}`.trim());
      }
      if (!w.running && h.vhosts.some((v) => v.product === w.product)) add('warning', 'web', 'NOT_RUNNING', `${w.product} çalışmıyor ama vhost tanımları var`);
    }
    for (const v of h.vhosts) {
      if (!v.jvm && v.req7d != null && v.req7d === 0 && v.serverName && v.serverName !== '_') {
        add('info', 'web', 'VHOST_IDLE', `${v.product} ${v.serverName}: 7 gündür istek yok`,
          v.product !== 'NGINX' && v.confFile ? { action: 'apache_retire_vhost', product: v.product, file: v.confFile, server_name: v.serverName } : null);
      }
    }
    // ip
    for (const ip of h.ips) if (ip.usedBy === 'none' && !ip.primary) add('warning', 'ip', 'IP_UNUSED', `${ip.ip} (${ip.iface}) hiçbir vhost/soket kullanmıyor — boşta IP`);
    // sshd: MaxSessions dusuk (varsayilan 10) -> Ansible delegate/forks ile "mux_client_request_session"
    if (h.sshd && h.sshd.maxSessions != null) {
      const near = h.sshd.activeSessions != null && h.sshd.activeSessions >= Math.max(1, Math.floor(h.sshd.maxSessions * 0.8));
      if (near) add('warning', 'ssh', 'SSH_SESSIONS_NEAR', `sshd MaxSessions ${h.sshd.maxSessions}, açık oturum ${h.sshd.activeSessions} — sınıra yakın (mux_client_request_session riski)`);
      else if (h.sshd.maxSessions <= 10) add('info', 'ssh', 'SSH_MAXSESSIONS_LOW', `sshd MaxSessions ${h.sshd.maxSessions} (varsayılan) — Ansible delegate/forks ile tıkanabilir; öneri 64`);
    }
    // scan cost
    if (h.cpuS != null && h.cpuS > 10) add('info', 'scan', 'SCAN_COST', `tarama ${h.cpuS.toFixed(1)} sn CPU harcadı`);

    h.hostClass = hostClassOf(h.host);
    const worst = F.reduce((a, f) => Math.max(a, SEV[f.severity]), 0);
    h.status = Object.keys(SEV).find((k) => SEV[k] === worst);
    h.counts = { danger: F.filter((f) => f.severity === 'danger').length, warning: F.filter((f) => f.severity === 'warning').length, info: F.filter((f) => f.severity === 'info').length };
    hosts.push(h);
  }
  hosts.sort((a, b) => SEV[b.status] - SEV[a.status] || a.host.localeCompare(b.host));

  // ── Ozet ───────────────────────────────────────────────────────────────────────
  // Ozet ve ortam kirilimi GENEL envanter uzerinden hesaplanir; GBEVM*/GBPRV* ayri blokta
  // (kullanici, 2026-09-24). `hosts` yine HEPSINI tasir - ekran sinifa gore suzer, sunucu
  // ayrinti sayfasi ve "simdi tara" ozel sunucularda da calisir.
  const special = hosts.filter((h) => h.hostClass === 'ozel');
  const genel = hosts.filter((h) => h.hostClass !== 'ozel');
  const jvms = genel.flatMap((h) => h.jvms);
  const web = genel.flatMap((h) => h.web);
  const envGroups = ['Production', 'Non-Production', 'Bilinmiyor'];
  const byEnv = {};
  for (const g of envGroups) {
    const hs = genel.filter((h) => h.envGroup === g);
    if (!hs.length) continue;
    const js = hs.flatMap((h) => h.jvms);
    byEnv[g] = {
      hosts: hs.length,
      danger: hs.filter((h) => h.status === 'danger').length,
      warning: hs.filter((h) => h.status === 'warning').length,
      ok: hs.filter((h) => h.status === 'ok').length,
      jvms: js.length, jvmRunning: js.filter((j) => j.running).length,
      autoOff: js.filter((j) => j.autoStart === 'false').length,
      rebootRisk: hs.reduce((a, h) => a + h.findings.filter((f) => f.code === 'REBOOT_RISK').length, 0),
      initDiff: hs.reduce((a, h) => a + h.init.filter((i) => i.status === 'DIFF').length, 0),
      web: Object.fromEntries(['IHS', 'RHA', 'NGINX'].map((p) => {
        const rows = hs.flatMap((h) => h.web).filter((w) => w.product === p);
        return [p, { hosts: rows.length, syntaxFail: rows.filter((w) => w.syntax === 'FAIL').length, notRunning: rows.filter((w) => !w.running).length }];
      })),
    };
  }
  const summary = {
    byEnv,
    hosts: { total: genel.length, ok: 0, info: 0, warning: 0, danger: 0 },
    init: {
      hosts: genel.filter((h) => h.init.length).length,
      compliant: genel.filter((h) => h.init.length && h.init.every((i) => i.status === 'OK')).length,
      diffFiles: genel.reduce((a, h) => a + h.init.filter((i) => i.status === 'DIFF').length, 0),
      missingFiles: genel.reduce((a, h) => a + h.init.filter((i) => i.status === 'MISSING').length, 0),
      // repo referansi ile filo cogunlugu ayrisan dosyalar (repo guncel degil ya da dagitim eksik)
      refDiffFiles: [...majorityOf.entries()].filter(([, m]) => { const any = [...byHost.values()].flatMap((h) => h.init).find((i) => i.sha === m.sha); return any && any.refStatus !== 'OK'; }).map(([k, m]) => ({ file: k, hosts: m.count })),
    },
    jvm: {
      total: jvms.length, running: jvms.filter((j) => j.running).length, stopped: jvms.filter((j) => !j.running).length,
      autoOn: jvms.filter((j) => j.autoStart === 'true').length, autoOff: jvms.filter((j) => j.autoStart === 'false').length, autoUnknown: jvms.filter((j) => j.autoStart === 'unknown').length,
      restartRequired: jvms.filter((j) => j.running && /required/.test(j.serverState)).length,
      rebootRisk: genel.reduce((a, h) => a + h.findings.filter((f) => f.code === 'REBOOT_RISK').length, 0),
      retireCandidates: genel.reduce((a, h) => a + h.findings.filter((f) => f.code === 'RETIRE_CANDIDATE').length, 0),
      noLoad: genel.reduce((a, h) => a + h.findings.filter((f) => f.code === 'NO_LOAD').length, 0),
      mapped: jvms.filter((j) => j.req7d != null).length,
      fromInventory: jvms.filter((j) => j.source === 'envanter').length,
      autoStartFromInventory: jvms.filter((j) => j.autoStartSource === 'envanter').length,
      mismatched: jvms.filter((j) => (j.mismatch || []).length > 0).length,
      invApps: genel.reduce((a, h) => a + (h.invApps || 0), 0),
    },
    web: {},
    ips: { total: genel.reduce((a, h) => a + h.ips.length, 0), unused: genel.reduce((a, h) => a + h.ips.filter((i) => i.usedBy === 'none' && !i.primary).length, 0) },
    ssh: { hosts: genel.filter((h) => h.sshd).length, lowMaxSessions: genel.filter((h) => h.sshd && h.sshd.maxSessions != null && h.sshd.maxSessions <= 10).length, near: genel.reduce((a, h) => a + h.findings.filter((f) => f.code === 'SSH_SESSIONS_NEAR').length, 0) },
    // Urun kapsami: envanterde KAC sunucuda var, tarama KACINDA gordu (kullanici, 2026-09-24)
    coverage: ['NGINX', 'IHS', 'RHA', 'JBOSS'].reduce((a, prod) => {
      const inv = genel.filter((h) => (h.invProducts || []).includes(prod));
      a[prod] = {
        inventory: inv.length,
        scanned: inv.filter((h) => (h.products || []).some((x) => U(x).startsWith(prod))).length,
        scannedNotInInventory: genel.filter((h) => (h.products || []).some((x) => U(x).startsWith(prod)) && !(h.invProducts || []).includes(prod)).length,
      };
      return a;
    }, {}),
    scan: { avgCpuS: null, maxCpuS: null, maxCpuHost: null },
    // Genel envanter DISI sunucular (GBEVM*/GBPRV*) - ayri listelenir, ozete karismaz
    special: {
      hosts: special.length,
      danger: special.filter((h) => h.status === 'danger').length,
      warning: special.filter((h) => h.status === 'warning').length,
      info: special.filter((h) => h.status === 'info').length,
      ok: special.filter((h) => h.status === 'ok').length,
      byPrefix: ['GBEVM', 'GBPRV'].reduce((a, pfx) => { a[pfx] = special.filter((h) => U(h.host).startsWith(pfx)).length; return a; }, {}),
      jvms: special.reduce((a, h) => a + h.jvms.length, 0),
    },
  };
  for (const h of genel) summary.hosts[h.status] += 1;
  for (const p of ['IHS', 'RHA', 'NGINX']) {
    const rows = web.filter((w) => w.product === p);
    summary.web[p] = { hosts: rows.length, syntaxOk: rows.filter((w) => w.syntax === 'OK').length, syntaxFail: rows.filter((w) => w.syntax === 'FAIL').length, syntaxUnknown: rows.filter((w) => w.syntax === 'UNKNOWN').length, notRunning: rows.filter((w) => !w.running).length,
      vhosts: genel.reduce((a, h) => a + h.vhosts.filter((v) => v.product === p).length, 0),
      idleVhosts: genel.reduce((a, h) => a + h.vhosts.filter((v) => v.product === p && v.req7d === 0).length, 0) };
  }
  const cpu = genel.filter((h) => h.cpuS != null);
  if (cpu.length) {
    summary.scan.avgCpuS = Math.round((cpu.reduce((a, h) => a + h.cpuS, 0) / cpu.length) * 10) / 10;
    const mx = cpu.reduce((a, h) => (h.cpuS > a.cpuS ? h : a), cpu[0]);
    summary.scan.maxCpuS = mx.cpuS; summary.scan.maxCpuHost = mx.host;
  }
  const latestScan = hosts.reduce((a, h) => (h.scanDate && (!a || h.scanDate > a) ? h.scanDate : a), null);
  return { hosts, summary, latestScan };
}

/** Tum bulgular tek listede (Bulgular sekmesi / CSV): host + urunler + bulgu. */
function flattenFindings(hosts) {
  const out = [];
  for (const h of hosts) for (const f of h.findings) out.push({ host: h.host, hostClass: h.hostClass || 'genel', products: h.products, env: h.env, envGroup: h.envGroup, scanDate: h.scanDate, severity: f.severity, area: f.area, code: f.code, text: f.text, fixable: !!f.fix });
  out.sort((a, b) => SEV[b.severity] - SEV[a.severity] || a.area.localeCompare(b.area) || a.host.localeCompare(b.host));
  return out;
}

module.exports = { assess, parseTargets, SEV, flattenFindings, hostClassOf, SPECIAL_HOST_RE };
