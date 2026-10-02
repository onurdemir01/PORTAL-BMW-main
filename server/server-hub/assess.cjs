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
//
// SOZLESME v3 (2026-10-01, dalga 1 - uretim guvenligi) - bu dosyada uygulanan kapilar:
//   runningKnown  : JVM.running_src !== 'UNMEASURED' (hidepid'de "kapali" sanilan JVM yok)
//   fresh         : sunucu taramasi taze mi (latestScan'e 1 gun, duvar saatine FRESH_MAX_DAYS)
//                   ve son yukleme disarida birakmadi mi (LoadIssues). Taze degilse TUM
//                   eylemler fix=null ve metin "(bayat kanit: <tarih>)".
//   gateHosts     : JVM'in kendi sunucusu + esli vhost sunuculari + webHostOf + webMatch
//   tierMeasured  : JVM'in ortam+sitesindeki TUM web sunuculari olculmus olmali (S3)
//   UNATTRIBUTED  : portu bilinmeyen JVM'in sunucusuna atfedilemeyen proxy trafigi (EK-3);
//                   hedef IP/localhost ile de sunucuya cozulur, cozulemeyen ya da kesik
//                   hedef listesi katmandaki DURMUS JVM'lerin retire'ini engeller (cfg_ports
//                   bilinse de: cozulemeyen hedefte port esitligi atif degildir)
//   SEMA          : sys.columns okunamadiysa (data.schemaUnknown) hicbir eylem yok
//   Olculemedi != yok: -1 / UNREADABLE / UNVERIFIED trafik "0 istek" SAYILMAZ.
'use strict';

const { webHostOf, matchWebForApp } = require('../audit/web-app.cjs');
const { siteOf } = require('../retirement/discover.cjs');
const { maskText, maskJvmArgs, maskJvmArgDiff } = require('./mask.cjs');

const SEV = { ok: 0, info: 1, warning: 2, danger: 3 };

/**
 * TAZELIK (sozlesme v3 P1 + EK-2). fresh(h) =
 *   gun(latestScan) - gun(h.scanDate) <= 1            (tek sunucu "simdi tara" toleransi)
 *   VE gun(now) - gun(h.scanDate) <= FRESH_MAX_DAYS   (gece taramasi + bir gun tolerans)
 *   VE son yukleme bu sunucuyu disarida birakmadi (LOAD_EXCLUDED).
 * Duvar saati sarti olmadan, yukleyici gunlerce dusse bile en son yuklenen gun "en yeni"
 * kalir ve bayat kanit bugunun eylemini besler.
 */
const FRESH_MAX_DAYS = 2;
const GUN_MS = 86400000;
const nz = (x) => (x == null || x === '' ? null : x);
const zamanMs = (x) => {
  if (x == null || x === '') return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const t = x instanceof Date ? x.getTime() : Date.parse(String(x));
  return Number.isFinite(t) ? t : null;
};
const tarihStr = (x) => {
  const t = zamanMs(x);
  return t == null ? null : new Date(t).toISOString().slice(0, 10);
};
const gunNo = (d) => {
  if (!d) return null;
  const t = Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / GUN_MS) : null;
};
/** '2.1' -> 2001; tanimsiz -> null (eski tarayici). */
const surumNo = (v) => {
  const m = /^(\d+)\.(\d+)/.exec(String(v == null ? '' : v));
  return m ? Number(m[1]) * 1000 + Number(m[2]) : null;
};
/** Trafik sayisi ancak bu durumlarda OLCULMUS sayilir (eski satirda durum NULL). */
const TRAFIK_OLCULDU = new Set(['ACTIVE', 'NO_RECENT_TRAFFIC']);
/** Sunucunun web olcumunu bozan tarama jetonlari (HOST.scan_errors). */
const TRUST_KOTU_JETON = /^(web_presence_unknown:|fuse:VHOST|deadline:(IHS|RHA|NGINX)\b)/;
/** Esleme turleri zayiftan gucluye; JVM'in genel eslemesi EN ZAYIF olanidir. */
const MAPPING_SIRASI = ['ALIAS', 'PROXY_HOST_ONLY', 'WEB_APP', 'EXACT_JVM'];
const WEB_URUN = new Set(['IHS', 'RHA', 'NGINX']);

/**
 * GENEL ENVANTER DISI SUNUCULAR (kullanici, 2026-09-24): GBEVM* ve GBPRV* filo
 * ortalamalarini bozuyor (farkli kurulum, farkli omur). Taranmaya devam ederler ve
 * bulgulari durur; yalnizca OZET/ORTAM kirilimi ve varsayilan liste GENEL envanteri
 * gosterir, bunlar AYRI listelenir. Ayni ayrim Denetim > Init Scripts icin de gecerli.
 */
const SPECIAL_HOST_RE = /^(GBEVM|GBPRV)/i;
const hostClassOf = (host) => (SPECIAL_HOST_RE.test(String(host || '').trim()) ? 'ozel' : 'genel');
const L = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();
const U = (s) =>
  String(s || '')
    .trim()
    .toUpperCase();
// IP'ler kisaltilmaz (10.1.1.5 -> '10' olurdu); yalniz ad ise ilk etiket
const shortHost = (s) =>
  /^\d+\.\d+\.\d+\.\d+$/.test(String(s || '').trim()) ? String(s).trim() : U(s).split('.')[0];

/**
 * Tek hedef "host[:port]" -> {host, port}; ayristirilamazsa null.
 * Koseli IPv6 ('[::1]:8080') literal olarak (kucuk harf) tutulur; eskiden dusuyordu.
 */
function hedefAyristir(t) {
  const s = String(t == null ? '' : t).trim();
  // '~' gecerli bir hostta yoktur: kesme eki ya da tasma jetonu ('~TRUNC' host[:port]
  // desenine UYAR ve portsuz bir "hedef" sanilirdi). Hedef DEGIL.
  if (!s || s.includes('~')) return null;
  const m6 = /^\[([0-9A-Fa-f:.]+)\](?::(\d+))?$/.exec(s);
  if (m6) return { host: m6[1].toLowerCase(), port: m6[2] ? Number(m6[2]) : null };
  const m = s.match(/^\[?([^\]:]+)\]?(?::(\d+))?$/);
  return m ? { host: shortHost(m[1]), port: m[2] ? Number(m[2]) : null } : null;
}

/** "host:port,host2:port2" -> [{host, port}] */
function parseTargets(text) {
  return String(text || '')
    .split(',')
    .map(hedefAyristir)
    .filter(Boolean);
}

/**
 * proxy_targets USERINFO TEMIZLIGI (sozlesme K9, C5): her virgullu hedeften 'kullanici:parola@'
 * oneki YAPISAL olarak silinir (maske degil: host:port korunur, parseTargets bozulmaz).
 * v3 tarayicisi bunu kendisi yapar ('^[^@,]*@'); ESKI tarayicinin DB'de kalan satirlari
 * 'svc:S3cr@backend:8080' tasiyabilir. Burada parca icindeki SON '@'a kadar silinir:
 * kodlanmamis '@' iceren parolanin kuyrugu da kalmasin.
 */
function hedefUserinfoSil(text) {
  if (text == null) return text;
  return String(text)
    .split(',')
    .map((t) => t.replace(/^[^,]*@/, ''))
    .join(',');
}

/**
 * Hedef listesi + KESME (C4). Yukleyici serbest metin kolonunu ' ~' ekiyle keser; tasma
 * jetonu ('~TRUNC') da '~' tasir. Gecerli bir host:port '~' ICERMEZ: '~' iceren parca ya
 * kesilmis bir hedefin yarisidir ya da jetondur - AYRISTIRILMAZ (yarim port yanlis JVM'e
 * eslenirdi) ve liste "eksik" sayilir. Gosterimde kesik parcanin icerigi yerine yalniz '~'
 * kalir (userinfo ortasindan kesilmis bir parca '@' tasimadigi icin temizlenemezdi).
 * @returns {{ parcalar: string[], eksik: boolean, gosterim: string }}
 */
function hedefListesi(raw) {
  const temiz = hedefUserinfoSil(raw == null ? '' : String(raw));
  const hepsi = temiz.split(',');
  const parcalar = hepsi.map((p) => p.trim()).filter((p) => p && !p.includes('~'));
  const eksik = hepsi.some((p) => p.includes('~'));
  return { parcalar, eksik, gosterim: eksik ? [...parcalar, '~'].join(',') : temiz };
}

/**
 * Web sunucusu `-t` ciktisi bir DOSYA ERISIMI sorununu mu anlatiyor?
 *
 * IHS/RHA'da yetki reddi de "Syntax error on line N of F" bicimiyle gelir (dosyayi acamayan
 * direktif satir numarasiyla raporlanir). Bu desenler sozdizimini DEGIL, taramanin dosyaya
 * ulasip ulasamadigini anlatir. Desen listesi bilerek GENIS: yanlislikla "dogrulanamadi"
 * demek yalniz bir uyari dusurur; yanlislikla "sozdizimi hatali" demek uretimde satir
 * yorumlatir.
 */
const ERISIM_DESENI =
  /permission denied|operation not permitted|\(13\)|does not exist or is empty|could not open|cannot open|can't open|unable to open|cannot load|bio_new_file|memmanagerfile|can't create directory|read-only file system|key database|\bgsk|\bssl0\d{3}e|no such file or directory/i;
const erisimKaynakli = (detail) => ERISIM_DESENI.test(String(detail || ''));

/**
 * @param {object} data  { hosts, init, jboss, jvms, web, vhosts, ips, sshd, loadIssues, mwApps, invEnv }
 *                       her sunucu icin SON taramanin satirlari (yeni kolonlar eski semada yok = null)
 * @param {{ now?: number|string|Date }} [opts]  duvar saati (test edilebilirlik; varsayilan Date.now())
 * @returns {{ hosts: object[], summary: object, latestScan: string|null, staleFleet: object|null }}
 */
function assess(data, opts = {}) {
  const now = (opts && zamanMs(opts.now)) ?? Date.now();
  // SEMA BILINMIYOR (C3): index.cjs loadLatest sys.columns'u okuyamadiysa (gecici DB hatasi)
  // yalniz eski semanin kolonlari secilir; running_src / scan_ver / vhost_trust / traffic_state
  // GELMEZ. Bu durumda KAPALI kalinir: running=0 "kapali" kaniti degildir, hicbir eylem
  // onerilmez, geri alma "serbest" denmez, hazirlik "unknown"dur.
  const semaBilinmiyor = !!(data && data.schemaUnknown === true);
  const byHost = new Map();
  const H = (h) => {
    const k = shortHost(h);
    if (!byHost.has(k))
      byHost.set(k, {
        host: k,
        scanned: true,
        scanDate: null,
        products: [],
        wallS: null,
        cpuS: null,
        note: '',
        scanVer: null,
        recCounts: null,
        scanErrors: [],
        procVisibility: null,
        sockVisibility: null,
        loadedAt: null,
        loadIssues: [],
        init: [],
        jboss: [],
        jvms: [],
        web: [],
        vhosts: [],
        ips: [],
        sshd: null,
        findings: [],
      });
    return byHost.get(k);
  };
  for (const r of data.hosts || []) {
    const h = H(r.host);
    h.scanDate = r.scan_date ? new Date(r.scan_date).toISOString().slice(0, 10) : null;
    h.products = String(r.products || '')
      .split(/\s+/)
      .filter((p) => p && p !== 'NONE');
    h.wallS = r.wall_s == null ? null : Number(r.wall_s);
    h.cpuS = r.cpu_s == null ? null : Number(r.cpu_s);
    // v3 kolonlari (eski semada / eski satirda yok -> null; "toplanmadi" demektir)
    h.note = maskText(r.note || '');
    h.scanVer = nz(r.scan_ver);
    h.recCounts = nz(r.rec_counts);
    h.scanErrors = String(r.scan_errors || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    h.procVisibility = nz(r.proc_visibility) ? U(r.proc_visibility) : null;
    h.sockVisibility = nz(r.sock_visibility) ? U(r.sock_visibility) : null;
    h.loadedAt = zamanMs(r.loaded_at);
  }
  for (const r of data.init || [])
    H(r.host).init.push({
      root: r.root,
      file: r.file,
      refStatus: U(r.status),
      sha: r.sha512 || null,
      status: U(r.status),
      majority: null,
      majorityCount: 0,
      variantCount: 0,
    });
  for (const r of data.jboss || [])
    H(r.host).jboss.push({
      gen: Number(r.gen),
      hostName: r.host_name || '',
      hostState: L(r.host_state),
      cli: U(r.cli),
      // serbest metin alanlari maskeli (kural 9, ucuncu katman)
      note: maskText(r.note || ''),
      cliRunAs: nz(r.cli_run_as),
      cliRescue: nz(r.cli_rescue) == null ? null : maskText(r.cli_rescue),
    });
  const portListesi = (s) =>
    String(s || '')
      .split(',')
      .map((p) => Number(p))
      .filter((p) => p > 0);
  for (const r of data.jvms || []) {
    const runningSrc = nz(r.running_src) ? U(r.running_src) : null;
    const cfgPortsSrc = nz(r.cfg_ports_src) ? U(r.cfg_ports_src) : null;
    const running = Number(r.running) === 1;
    // Sema bilinmiyorsa running_src okunamadi: running=0 kanit degil (running=1 PS/CLI
    // pozitif kanitidir, bilinen kalir).
    const semaKor = semaBilinmiyor && !running;
    const j = {
      gen: Number(r.gen),
      name: String(r.jvm || '').trim(),
      group: r.grp || '',
      running,
      // running=0 TEK BASINA "kapali" DEGILDIR; anlami running_src'dedir. NULL (eski satir)
      // bilinen sayilir; BLIND'da PS kaynakli pozitif kanit da bilinendir.
      runningSrc,
      runningKnown: runningSrc !== 'UNMEASURED' && !semaKor,
      semaBilinmiyor: semaKor,
      cfgSrc: nz(r.cfg_src) ? U(r.cfg_src) : null,
      autoStart: L(r.auto_start) || 'unknown',
      serverState: L(r.server_state) || 'unknown',
      ports: portListesi(r.ports),
      // otoriter cfg_ports yalniz CLI ya da (otoriter host_config'li) MASTER yerel XML'den
      cfgPorts: portListesi(r.cfg_ports),
      cfgPortsSrc,
      cfgPortsAuth: cfgPortsSrc === 'CLI' || cfgPortsSrc === 'XML_LOCAL_MASTER',
      vhosts: [],
      req24h: null,
      req7d: null,
      matchKind: null,
    };
    if (r.jvm_arg_status !== undefined) j.jvmArgStatus = nz(r.jvm_arg_status);
    if (r.jvm_args_src !== undefined) j.jvmArgsSrc = nz(r.jvm_args_src);
    // AGIR KOLONLAR yalniz tek sunucu ayrintisinda gelir; geldiyse beyaz liste maskesi.
    if (r.jvm_args !== undefined) j.jvmArgs = maskJvmArgs(nz(r.jvm_args));
    if (r.configured_jvm_args !== undefined)
      j.configuredJvmArgs = maskJvmArgs(nz(r.configured_jvm_args));
    if (r.jvm_arg_diff !== undefined) j.jvmArgDiff = maskJvmArgDiff(nz(r.jvm_arg_diff));
    H(r.host).jvms.push(j);
  }
  // HAM detail yalniz siniflandirma ve "line N of F" ayristirmasi icin tutulur; disariya
  // (bulgu metni, ayrinti) hep MASKELI hali gider.
  const webHam = new WeakMap();
  for (const r of data.web || []) {
    const wRunning = Number(r.running) === 1;
    const wSrc = nz(r.running_src) ? U(r.running_src) : null;
    const w = {
      product: U(r.product),
      running: wRunning,
      // webRunningKnown (v3): BLIND'da ps'te gorulmeyen web "calismiyor" DEGIL; sema
      // bilinmiyorsa (C3) running_src okunamadi, ayni kural.
      runningKnown: wSrc !== 'UNMEASURED' && !(semaBilinmiyor && !wRunning),
      syntax: U(r.syntax),
      detail: maskText(r.detail || ''),
      checkClass: nz(r.check_class) ? U(r.check_class) : null,
      syntaxVerification: nz(r.syntax_verification) ? U(r.syntax_verification) : null,
      runAs: nz(r.run_as) ? L(r.run_as) : null,
      checkRc: r.check_rc == null || r.check_rc === '' ? null : Number(r.check_rc),
      vhostTrust: nz(r.vhost_trust) ? U(r.vhost_trust) : null,
      runningSrc: wSrc,
    };
    webHam.set(w, String(r.detail || ''));
    H(r.host).web.push(w);
  }
  const epoch = (x) => (x == null || x === '' ? null : Number(x));
  // Hedef parcalari (userinfo silinmis, kesik parca atilmis) yalniz cozumleme icin; disari
  // (hostDetail spread) tasinmasin diye nesneye degil WeakMap'e konur.
  const vhostHedef = new WeakMap();
  for (const r of data.vhosts || []) {
    const hl = hedefListesi(r.proxy_targets);
    const v = {
      product: U(r.product),
      listen: r.listen || '',
      serverName: r.server_name || '',
      aliases: r.aliases || '',
      accessLog: r.access_log || '',
      proxyTargets: parseTargets(hl.parcalar.join(',')),
      // GOSTERIM: userinfo yapisal silinmis, kesik parca yerine '~' (C4/C5). Ham deger disari
      // HIC cikmaz.
      proxyTargetsRaw: hl.gosterim,
      // hedef listesi yukleyicide kesildi: EK-3 icin bu vhost'un hedefleri bilinmiyor
      targetsTruncated: hl.eksik,
      req24h: r.req_24h == null ? null : Number(r.req_24h),
      req7d: r.req_7d == null ? null : Number(r.req_7d),
      hc24h: r.hc_24h == null ? null : Number(r.hc_24h),
      shared: Number(r.shared) === 1,
      sampled: Number(r.sampled) === 1,
      confFile: r.conf_file || '',
      // v3 trafik alanlari; eski satirda null (o zaman yalniz req_7d >= 0 olculmus sayilir)
      trafficState: nz(r.traffic_state) ? U(r.traffic_state) : null,
      trafficReason: nz(r.traffic_reason) ? U(r.traffic_reason) : null,
      coverFromEpoch: epoch(r.cover_from_epoch),
      lastReqEpoch: epoch(r.last_req_epoch),
      lastLineEpoch: epoch(r.last_line_epoch),
      logReadAs: nz(r.log_read_as),
      jvm: null,
    };
    vhostHedef.set(v, hl.parcalar);
    H(r.host).vhosts.push(v);
  }
  // YUKLEME IZI (dbo.Server_Hub_LoadIssues): yalniz taramasi olan sunuculara baglanir;
  // hic yazilamamis sunucu "taramada yok" olarak kalir (hazirlikta notScanned).
  for (const r of data.loadIssues || []) {
    const k = shortHost(r.host);
    if (!k || !byHost.has(k)) continue;
    byHost.get(k).loadIssues.push({
      scanDate: tarihStr(r.scan_date),
      issue: U(r.issue),
      detail: maskText(r.detail || ''),
      runAt: zamanMs(r.run_at),
    });
  }
  // Sunucu basina yalniz EN YENI kosunun (en buyuk run_at) satirlari gecerlidir.
  for (const h of byHost.values()) {
    const enYeni = h.loadIssues.reduce((a, x) => (x.runAt != null && x.runAt > a ? x.runAt : a), -1);
    if (enYeni >= 0) h.loadIssues = h.loadIssues.filter((x) => x.runAt === enYeni);
  }
  // ── Ortam (2026-09-22): dbo.Inventory.env; yoksa sunucu adindan (…P\d = prod). Non-Prod/Prod kirilimi.
  const ENV_TR = {
    PRODUCTION: 'PROD',
    PROD: 'PROD',
    TEST: 'TEST',
    QA: 'QA',
    ALPHA: 'ALPHA',
    ODM: 'ODM',
    DEV: 'DEV',
    EDU: 'EDU',
  };
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
      autoStarts: String(r.autostarts || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((x) => L(x)),
      domain: String(r.domain || '').trim(),
      tier: r.tier == null ? null : String(r.tier),
      env: ENV_TR[U(r.env)] || null,
    });
  }

  for (const r of data.sshd || [])
    H(r.host).sshd = {
      maxSessions: r.max_sessions == null ? null : Number(r.max_sessions),
      maxStartups: r.max_startups || '',
      activeSessions: r.active_sessions == null ? null : Number(r.active_sessions),
    };
  for (const r of data.ips || [])
    H(r.host).ips.push({
      ip: r.ip,
      iface: r.iface || '',
      usedBy: L(r.used_by) || 'none',
      primary: Number(r.is_primary) === 1,
    });

  // Envanter <-> CLI birlestirme: CLI'da olmayan uygulamalar envanterden eklenir (kaynak isaretli),
  // ikisinde de varsa celiski (calisiyor/kapali ya da auto-start) BULGU olarak isaretlenir.
  // Envanterdeki urunler (dbo.Inventory) - tarama sonucundan AYRI tutulur (kullanici, 2026-09-24)
  const invProductsByHost = new Map();
  for (const r of data.invEnv || []) {
    if (!r || !r.host) continue;
    const k = U(shortHost(r.host));
    if ((r.invProducts || []).length) invProductsByHost.set(k, r.invProducts);
  }
  for (const h of byHost.values()) {
    h.invProducts = invProductsByHost.get(U(h.host)) || [];
    h.env = envOf(h.host);
    h.envGroup =
      h.env === 'PROD' ? 'Production' : h.env === 'BILINMIYOR' ? 'Bilinmiyor' : 'Non-Production';
    // JBOSS OLMAYAN SUNUCU (kullanici, 2026-09-24): "JBoss olmayan sunuculara bakmani istemiyorum".
    // Eskiden dbo.MWAppsInventory'deki her uygulama icin JVM satiri uretiliyordu; JBoss kurulu
    // OLMAYAN sunucularda bunlarin auto-start'i dogal olarak okunamiyor ve ekran "bilinmiyor"
    // doluyordu. Artik envanter JVM'leri yalnizca sunucuda JBoss VARSA eklenir.
    const hasJboss =
      h.jboss.length > 0 ||
      h.jvms.some((j) => j.source === 'cli' || j.gen > 0) ||
      (h.products || []).some((x) => /^JBOSS/i.test(x)) ||
      (h.invProducts || []).includes('JBOSS');
    const apps = hasJboss ? appsByHost.get(h.host) || [] : [];
    h.hasJboss = hasJboss;
    h.invApps = apps.length;
    h.invAppsSkipped = hasJboss ? 0 : (appsByHost.get(h.host) || []).length;
    for (const a of apps) {
      const hit = h.jvms.find((j) => L(j.name) === L(a.app));
      const invRunning = a.status === 'running';
      const invAuto = a.autoStarts.length
        ? a.autoStarts.every((x) => x === 'true')
          ? 'true'
          : a.autoStarts.every((x) => x === 'false')
            ? 'false'
            : 'karisik'
        : 'unknown';
      if (hit) {
        hit.domain = a.domain || hit.domain || '';
        hit.invStatus = a.status || null;
        hit.invAutoStart = invAuto;
        hit.invJvmCount = a.jvmCount;
        hit.mismatch = [];
        // OLCULEMEYEN calisma durumu envanterle "celisemez" (v3): running=0 + UNMEASURED
        // "kapali" demek degil.
        if (a.status && hit.runningKnown !== false && hit.running !== invRunning)
          hit.mismatch.push(
            `durum: envanter ${a.status}, tarama ${hit.running ? 'çalışıyor' : 'kapalı'}`,
          );
        if (
          invAuto !== 'unknown' &&
          invAuto !== 'karisik' &&
          hit.autoStart !== 'unknown' &&
          hit.autoStart !== invAuto
        )
          hit.mismatch.push(`auto-start: envanter ${invAuto}, tarama ${hit.autoStart}`);
        // CLI auto-start okuyamadiysa ENVANTER kazanir (kullanici: "JVM bilgisi envanterden gelsin")
        if (hit.autoStart === 'unknown' && invAuto !== 'unknown') {
          hit.autoStart = invAuto === 'karisik' ? 'unknown' : invAuto;
          hit.autoStartSource = 'envanter';
          // Envanter de cevap veremediyse SEBEBI yaz: "karisik" demek, ayni uygulamanin
          // JVM'lerinden bazisi true bazisi false demektir - tek bir cevap UYDURULMAZ.
          if (invAuto === 'karisik') hit.autoStartReason = 'envanter-celiskili';
        } else hit.autoStartSource = hit.autoStartSource || 'cli';
        // Ne CLI ne envanter: sebep "ikisi de okunamadi".
        if (hit.autoStart === 'unknown' && !hit.autoStartReason)
          hit.autoStartReason = invAuto === 'unknown' ? 'envanterde-yok' : 'cli-okunamadi';
      } else {
        h.jvms.push({
          gen: 0,
          name: a.app,
          group: '',
          domain: a.domain || '',
          running: invRunning,
          runningSrc: null,
          runningKnown: true,
          cfgSrc: null,
          cfgPorts: [],
          cfgPortsSrc: null,
          cfgPortsAuth: false,
          autoStart: invAuto === 'karisik' ? 'unknown' : invAuto,
          serverState: a.status || 'unknown',
          ports: [],
          vhosts: [],
          req24h: null,
          req7d: null,
          matchKind: null,
          source: 'envanter',
          invStatus: a.status || null,
          invAutoStart: invAuto,
          invJvmCount: a.jvmCount,
          mismatch: [],
          autoStartSource: 'envanter',
          autoStartReason:
            invAuto === 'karisik'
              ? 'envanter-celiskili'
              : invAuto === 'unknown'
                ? 'envanterde-yok'
                : null,
        });
      }
    }
    for (const j of h.jvms) if (!j.source) j.source = 'cli';
    // TANIMSIZ SUREC (T2-C2): cfg_src=UNAVAILABLE = tanim kaynagi (CLI listesi ya da host XML)
    // OKUNDU ama ps'te calisan bu JVM orada tanimli degil. auto-start'in bilinmemesinin sebebi
    // "CLI cevap vermedi" DEGIL, tanimin olmamasidir; envanter sebepleri de bunu ortmez.
    for (const j of h.jvms)
      if (j.source === 'cli' && j.cfgSrc === 'UNAVAILABLE' && j.autoStart === 'unknown')
        j.autoStartReason = 'tanimsiz-surec';
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
    vhostIndex.get(k).push({
      host,
      ip: vip || '',
      port: vport || '',
      serverName: v.serverName || '',
      confFile: v.confFile || '',
      product: v.product || '',
      __host: host,
      __v: v,
    });
  }
  // ── Envanter sunuculari (v3) ─────────────────────────────────────────────────────
  // Envanterde olup taramada OLMAYAN sunucu web katmaninda "olculmemis"tir; adi kuraldan
  // turemis ama hic var olmayan sunucu (envanterde de yok) yok sayilir. Proxy hedefi
  // cozumlemesi de bu kumeyi kullanir (asagida).
  const envanterHostlari = new Set();
  for (const r of data.invEnv || []) {
    const k = U(shortHost(r.host));
    if (k) envanterHostlari.add(k);
  }

  // ── PROXY HEDEFI COZUMLEMESI (C1, EK-3 kapsami) ──────────────────────────────────
  // Hedef bir SUNUCUYA cozulur:
  //   - localhost / 127.x / ::1 / 0.0.0.0 -> vhost'un KENDI sunucusu (2 katmanli kurulum)
  //   - IP -> dbo.Server_Hub_Ips'te o IP'yi tasiyan TEK sunucu (iki sunucuda varsa VIP/kayan
  //     IP: hangisine gittigi bilinmez -> cozulemedi)
  //   - ad -> kisa adi taranmis ya da envanterdeki bir sunucu
  // Hicbirine cozulemeyen hedef (balancer:// adi, upstream adi, VIP, ayristirilamayan parca)
  // "HEDEFI BILINMEYEN proxy"dir: o vhost'un trafigi hangi JVM'e gittigi bilinmeden
  // atfedilemez; ayni katmandaki durmus JVM'ler icin (port bilgisinden bagimsiz) retire
  // onerilmez. Eskiden
  // yalniz kisa adla eslesme vardi; IP / localhost / balancer hedefli proxy EK-3'u deliyordu.
  const YEREL_HEDEF = new Set(['localhost', 'ip6-localhost', '::1', '0:0:0:0:0:0:0:1', '0.0.0.0']);
  const ipSahipleri = new Map();
  for (const h of byHost.values())
    for (const x of h.ips) {
      const ip = String(x.ip || '')
        .trim()
        .toLowerCase();
      if (!ip) continue;
      if (!ipSahipleri.has(ip)) ipSahipleri.set(ip, new Set());
      ipSahipleri.get(ip).add(h.host);
    }
  const ipMi = (s) => /^\d+\.\d+\.\d+\.\d+$/.test(s) || s.includes(':');
  const hedefSunucu = (webHost, hedefHost) => {
    const s = String(hedefHost || '')
      .trim()
      .toLowerCase();
    if (!s) return null;
    if (YEREL_HEDEF.has(s) || /^127\./.test(s)) return webHost;
    if (ipMi(s)) {
      const k = ipSahipleri.get(s);
      return k && k.size === 1 ? [...k][0] : null;
    }
    const k = U(shortHost(s));
    return byHost.has(k) || envanterHostlari.has(k) ? k : null;
  };
  // Proxy hedefi indeksi: hedef SUNUCU -> [{ host (vhost'un sunucusu), v, ports }]. Her vhost
  // bir hedef sunucu icin bir kez yer alir (ayni vhost'ta iki hedef ayni sunucuya gidebilir).
  // Hedefi bilinmeyenler web sunucusunun bilinmeyenHedef listesine (EK-3, C1/C4).
  const proxyIdx = new Map();
  for (const h of byHost.values()) h.bilinmeyenHedef = [];
  for (const { host, v } of allVhosts) {
    const w = byHost.get(host);
    const perHost = new Map();
    for (const parca of vhostHedef.get(v) || []) {
      // unix soketi web sunucusunun kendi yerel surecidir (JBoss unix soketi dinlemez)
      if (/^unix:/i.test(parca)) continue;
      const t = hedefAyristir(parca);
      const th = t ? hedefSunucu(host, t.host) : null;
      if (!th) {
        w.bilinmeyenHedef.push({ v, target: parca, port: t ? t.port : null, tur: 'HEDEF' });
        continue;
      }
      if (!perHost.has(th)) perHost.set(th, []);
      perHost.get(th).push(t.port);
    }
    // KESIK liste (C4): kesilen kisimda hangi sunucu:port oldugu bilinmez
    if (v.targetsTruncated) w.bilinmeyenHedef.push({ v, target: '~', port: null, tur: 'EKSIK' });
    for (const [th, ports] of perHost) {
      if (!proxyIdx.has(th)) proxyIdx.set(th, []);
      proxyIdx.get(th).push({ host, v, ports });
    }
  }

  // ── TAZELIK (v3) ─────────────────────────────────────────────────────────────────
  const latestScan = [...byHost.values()].reduce(
    (a, h) => (h.scanDate && (!a || h.scanDate > a) ? h.scanDate : a),
    null,
  );
  const latestGun = gunNo(latestScan);
  const nowGun = Math.floor(now / GUN_MS);
  for (const h of byHost.values()) {
    // LOAD_EXCLUDED: son yukleme bu sunucuyu yazmadi (dislama satiri, run_at > loaded_at).
    // loaded_at NULL (eski satir) -> scan_date karsilastirmasi. Ayni makine iki adla
    // (HOST_DUPLICATE_SAME_MACHINE) dislama DEGIL, bilgidir.
    h.loadExcludedIssues = h.loadIssues.filter(
      (x) =>
        x.issue &&
        x.issue !== 'HOST_DUPLICATE_SAME_MACHINE' &&
        (h.loadedAt != null
          ? x.runAt != null && x.runAt > h.loadedAt
          : !!(x.scanDate && h.scanDate && x.scanDate > h.scanDate)),
    );
    h.loadExcluded = h.loadExcludedIssues.length > 0;
    h.loadDuplicate = h.loadIssues.filter(
      (x) => x.issue === 'HOST_DUPLICATE_SAME_MACHINE' && x.scanDate === h.scanDate,
    );
    const g = gunNo(h.scanDate);
    h.fresh =
      g != null &&
      latestGun != null &&
      latestGun - g <= 1 &&
      nowGun - g <= FRESH_MAX_DAYS &&
      !h.loadExcluded;
    // WEB OLCUMU. trustOk: trafik turetimi icin (eski satir - vhost_trust NULL - bugunku gibi
    // guvenilir sayilir). measured: EYLEM icin (taze + v3 satiri + FULL/VERIFIED + jetonsuz).
    const kotu = h.scanErrors.filter((t) => TRUST_KOTU_JETON.test(t));
    h.fuseVhost = h.scanErrors.some((t) => /^fuse:VHOST/.test(t));
    h.webLegacy = surumNo(h.scanVer) == null || h.web.some((w) => w.vhostTrust == null);
    h.trustOk =
      kotu.length === 0 &&
      h.web.every(
        (w) =>
          w.vhostTrust == null ||
          (w.vhostTrust === 'FULL' &&
            (w.syntaxVerification == null || w.syntaxVerification === 'VERIFIED')),
      );
    // ENVANTERDEKI WEB URUNU TARAMADA YOK (C2; PRODUCT_NOT_SCANNED ile AYNI kosul): urun
    // standart disi yolda kurulu ya da yetki yuzunden gorulemedi. WEB satiri hic yoksa
    // every([]) true donerdi ve ayni Portal "olculemedi" dedigi sunucuyu katman kapisinda
    // "olculmus" sayardi.
    h.webUrunGorulmedi = (h.invProducts || []).filter(
      (ip) => WEB_URUN.has(U(ip)) && !(h.products || []).some((x) => U(x).startsWith(U(ip))),
    );
    h.measured =
      h.fresh &&
      !h.webLegacy &&
      kotu.length === 0 &&
      h.webUrunGorulmedi.length === 0 &&
      h.web.every((w) => w.vhostTrust === 'FULL' && w.syntaxVerification === 'VERIFIED');
  }
  /** Taranmis sunucu nesnesi; envanterde olup taranmamissa olculmemis yer tutucu; yoksa null. */
  const hostBilgi = (name) => {
    const k = U(shortHost(name));
    if (!k) return null;
    if (byHost.has(k)) return byHost.get(k);
    if (!envanterHostlari.has(k)) return null;
    return {
      host: k,
      scanned: false,
      scanDate: null,
      fresh: false,
      trustOk: false,
      measured: false,
      webLegacy: false,
      loadExcluded: false,
    };
  };
  const olculmus = (v) =>
    v.req7d != null &&
    v.req7d >= 0 &&
    (v.trafficState == null || TRAFIK_OLCULDU.has(v.trafficState));

  for (const h of byHost.values()) {
    for (const j of h.jvms) {
      // 1) proxy hedefi: port JVM'in olculmus portlarinda ya da OTORITER cfg_ports'ta ise
      //    EXACT_JVM; hedef portsuzsa PROXY_HOST_ONLY (sunucudaki her JVM'e eslenir).
      const cfgYetkili = j.cfgPortsAuth ? j.cfgPorts : [];
      for (const { host, v, ports } of proxyIdx.get(h.host) || []) {
        let kind = null;
        for (const p of ports) {
          if (p == null) kind = kind || 'PROXY_HOST_ONLY';
          else if (j.ports.includes(p) || cfgYetkili.includes(p)) kind = 'EXACT_JVM';
        }
        if (kind) {
          j.vhosts.push({ host, v, kind });
          j.matchKind = j.matchKind || 'proxy';
        }
      }
      // 2) Denetim > Web-App iliskisi. v3: aday web sunucusu (webMatch) HER JVM icin
      //    hesaplanir - guvenlik kapisi (gateHosts) onu ister; ESLEME ise yalniz kesin
      //    eslesme yoksa yapilir.
      if (j.name) {
        const rel = matchWebForApp(
          { app: j.name, appHost: h.host, domain: j.domain || '' },
          vhostIndex,
        );
        j.webMatch = {
          tier: rel.tier,
          how: rel.how,
          webHost: rel.webHostCandidate,
          vhostsOnWebHost: rel.vhostCountOnHost,
        };
        if (!j.vhosts.length) {
          if (rel.matched) {
            for (const e of rel.web) {
              j.vhosts.push({ host: e.__host, v: e.__v, kind: 'WEB_APP' });
              j.matchKind = 'web-app';
            }
          } else {
            // 3) server_name tutmadi: ayni aday sunucuda ALIAS'ta ad geciyor mu
            const needle = L(j.name);
            const cands = new Set([U(h.host), U(rel.webHostCandidate || '')].filter(Boolean));
            for (const { host, v } of allVhosts) {
              if (!cands.has(U(host))) continue;
              if (L(v.aliases).includes(needle)) {
                j.vhosts.push({ host, v, kind: 'ALIAS' });
                j.matchKind = 'alias';
              }
            }
          }
        }
      }
      for (const m of j.vhosts) m.v.jvm = `${h.host}/${j.name}`;
      j.mapping = j.vhosts.length
        ? MAPPING_SIRASI.find((k) => j.vhosts.some((m) => m.kind === k)) || 'NOT_MAPPED'
        : 'NOT_MAPPED';

      // gateHosts (v3): eslemeden BAGIMSIZ aday kumesi. P1b yalniz esli vhost'larin
      // sunucularina bakiyordu; proxy eslesmesinde asil web sunucusu (webHostOf) hic
      // incelenmiyordu (NONE guvenli sunucu kanitsiz "7 gundur istek yok" uretebilirdi).
      const gate = new Set([U(h.host)]);
      for (const m of j.vhosts) gate.add(U(shortHost(m.host)));
      const wh = webHostOf(h.host);
      if (wh) gate.add(U(shortHost(wh)));
      if (j.webMatch && j.webMatch.webHost) gate.add(U(shortHost(j.webMatch.webHost)));
      j.gateHosts = [...gate];
      j.trustBad = j.gateHosts.some((n) => {
        const b = hostBilgi(n);
        return !!b && !b.trustOk;
      });

      // TRAFIK DURUMU (P1). OLCULMEYEN (-1 / UNREADABLE / UNVERIFIED / eski NULL) vhost
      // "0 istek" SAYILMAZ: esli vhost'lardan biri bile olculmemisse "7 gundur istek yok"
      // iddiasi kurulamaz (eskiden yalniz okunabilenler toplaniyordu - K0#0).
      const mapped = j.vhosts;
      const olc = mapped.filter((m) => olculmus(m.v));
      let ts;
      if (olc.some((m) => m.v.req7d > 0)) ts = 'ACTIVE';
      else if (mapped.length && olc.length === mapped.length && !j.trustBad)
        ts = 'NO_RECENT_TRAFFIC';
      else if (!mapped.length) ts = j.trustBad ? 'UNVERIFIED' : 'NOT_MAPPED';
      else if (
        mapped.some(
          (m) =>
            m.v.trafficState === 'UNREADABLE' ||
            (m.v.trafficState == null && (m.v.req7d == null || m.v.req7d < 0)),
        )
      )
        ts = 'UNREADABLE';
      else ts = 'UNVERIFIED';
      j.trafficState = ts;
      if (ts === 'ACTIVE' || ts === 'NO_RECENT_TRAFFIC') {
        j.req24h = olc.reduce((a, m) => a + Math.max(0, m.v.req24h || 0), 0);
        j.req7d = olc.reduce((a, m) => a + Math.max(0, m.v.req7d || 0), 0);
      } else {
        j.req24h = null;
        j.req7d = null;
      }
    }
  }

  // ── ATFEDILEMEYEN PROXY (EK-3) ───────────────────────────────────────────────────
  // Portu olculemeyen JVM (durmus ya da sock_visibility != PID): TAZE bir sunucudaki vhost'un
  // bu sunucuya giden proxy portu, burada CALISAN JVM'lerin olculmus portlarina ya da otoriter
  // cfg_ports'a AIT DEGILSE o trafik hicbir JVM'e atfedilemez. Trafigi varsa (req7d > 0) ya da
  // trafigi OLCULEMEDIYSE, portu bilinmeyen JVM'ler icin retire onerilmez.
  for (const h of byHost.values()) {
    const sahipli = new Set();
    for (const j of h.jvms) {
      if (j.running && j.runningKnown !== false) for (const p of j.ports) sahipli.add(p);
      if (j.cfgPortsAuth) for (const p of j.cfgPorts) sahipli.add(p);
    }
    const liste = [];
    for (const { host, v, ports } of proxyIdx.get(h.host) || []) {
      const w = byHost.get(host);
      if (!w || !w.fresh) continue;
      for (const p of ports) {
        if (p == null || sahipli.has(p)) continue;
        liste.push({
          host,
          serverName: v.serverName || '',
          port: p,
          target: null,
          tur: 'PORT',
          req7d: v.req7d,
          trafficState: v.trafficState,
          trafik: !olculmus(v) || v.req7d > 0,
          v,
        });
      }
    }
    h.unattributedProxy = liste;
  }
  const portBilinmiyor = (h, j) =>
    (j.runningKnown === false ||
      !j.running ||
      (h.sockVisibility != null && h.sockVisibility !== 'PID')) &&
    !(j.cfgPortsAuth && j.cfgPorts.length);
  /** j'ye ATFEDILEMEYEN ve trafigi olan (ya da olculemeyen) proxy'ler; j'nin kendi esli
   * vhost'lari haric (onlar j'nin trafik durumunda zaten degerlendirildi). */
  const atfedilemeyenTrafik = (h, j) =>
    portBilinmiyor(h, j)
      ? h.unattributedProxy.filter((x) => x.trafik && !j.vhosts.some((m) => m.v === x.v))
      : [];
  /**
   * HEDEFI BILINMEYEN proxy trafigi (C1/C4): JVM'in KATMANINDAKI (ortam+site; tierOf) ya da
   * gateHosts'undaki TAZE bir web sunucusunda, hedefi hicbir sunucuya cozulemeyen (balancer,
   * VIP, upstream adi) ya da hedef listesi KESIK vhost. Trafigi varsa (req7d > 0) ya da
   * olculemediyse o trafik bu JVM'e gidiyor olabilir. Kesik liste her zaman sayilir: o web
   * sunucusu EK-3 icin olculmemistir (hangi hedefin kesildigi bilinmez).
   *
   * KAPI (T2-C1): yalniz CALISTIGI BILINEN ve portu olculmus JVM atlanir. Durmus ya da calismasi
   * olculemeyen JVM'de otoriter cfg_ports bilinse de HEDEF/EKSIK trafigi engeller: hedef hicbir
   * sunucuya cozulmediyse JVM'in portunu bilmek trafigin ona gitmedigini KANITLAMAZ (VIP/LB
   * port cevirisi: VIP:443 -> JVM:8180; kesik listede kesilen kisim hic bilinmez). Eski kapi
   * ('portBilinmiyor degilse atla') cfg_ports dolu durmus JVM'de bu iki turu tamamen susturuyordu.
   * PORT turundaki kapi (atfedilemeyenTrafik) degismedi: orada port sahipligi gercek bir atiftir.
   */
  const hedefiBilinmeyenTrafik = (h, j) => {
    if (j.running && j.runningKnown !== false && !portBilinmiyor(h, j)) return [];
    const adaylar = new Map();
    for (const b of tierOf(h.host)) adaylar.set(b.host, b);
    for (const n of j.gateHosts || []) if (byHost.has(n)) adaylar.set(n, byHost.get(n));
    adaylar.set(h.host, h);
    const out = [];
    for (const w of adaylar.values()) {
      if (!w.scanned || !w.fresh || !w.bilinmeyenHedef) continue;
      for (const e of w.bilinmeyenHedef) {
        if (j.vhosts.some((m) => m.v === e.v)) continue;
        if (!(e.tur === 'EKSIK' || !olculmus(e.v) || e.v.req7d > 0)) continue;
        out.push({
          host: w.host,
          serverName: e.v.serverName || '',
          port: e.port,
          target: e.target,
          tur: e.tur,
          req7d: e.v.req7d,
          trafficState: e.v.trafficState,
          trafik: true,
          v: e.v,
        });
      }
    }
    return out;
  };
  const atfDisa = (x) => ({
    host: x.host,
    serverName: x.serverName,
    port: x.port,
    target: x.target,
    kind: x.tur,
    req7d: x.req7d,
    trafficState: x.trafficState,
  });
  /** Bulgu metni parcasi: hangi web sunucusu/vhost, nereye. */
  const atfMetni = (x) =>
    x.tur === 'EKSIK'
      ? `${x.host}/${x.serverName || '?'} → hedef listesi kesik`
      : x.tur === 'HEDEF'
        ? `${x.host}/${x.serverName || '?'} → ${x.target} (hedefi bilinmiyor)`
        : `${x.host}/${x.serverName || '?'} → :${x.port}`;

  // ── WEB KATMANI (S3: tierMeasured) ───────────────────────────────────────────────
  // JVM'in ortam+sitesindeki WEB satiri olan, envanterde web urunu tasiyan ya da web urunu
  // varligi OLCULEMEYEN (web_presence_unknown, EK-5) her sunucu. Portal'in goremedigi HA
  // ikinci web sunucusu NONE guvenle taranirsa VHOST satiri yoktur; kapsam bilinemedigi
  // icin yikici eylem yalniz katmanin TAMAMI olculmusken onerilir.
  const webEnvanter = (urunler) => (urunler || []).some((p) => WEB_URUN.has(U(p)));
  const tierCache = new Map();
  const tierOf = (jvmHost) => {
    const env = envOf(jvmHost);
    const site = siteOf(jvmHost);
    const key = `${env}|${site}`;
    if (!tierCache.has(key)) {
      const uyeler = [];
      for (const w of byHost.values()) {
        if (envOf(w.host) !== env || siteOf(w.host) !== site) continue;
        if (
          w.web.length ||
          webEnvanter(w.invProducts) ||
          w.scanErrors.some((t) => t.startsWith('web_presence_unknown:'))
        )
          uyeler.push(w);
      }
      for (const [k, urunler] of invProductsByHost) {
        if (byHost.has(k) || !webEnvanter(urunler)) continue;
        if (envOf(k) !== env || siteOf(k) !== site) continue;
        uyeler.push(hostBilgi(k));
      }
      tierCache.set(key, uyeler.filter(Boolean));
    }
    return tierCache.get(key);
  };

  /**
   * jboss_retire icin v2 kaniti (v3). Engel yoksa null; varsa ILK engel:
   *   STALE        'bayat kanit: <host> <tarih>'   (JVM sunucusu ya da gateHosts taze degil)
   *   LEGACY       eski tarama satiri (v2 kolonlari yok) - eylem icin olculmus sayilmaz
   *   WEB_TIER     'web katmaninda olculemeyen host var: <ilk 5>' (gateHosts + tierHosts)
   *   MAPPING      'esleme turu <mapping>' (yalniz EXACT_JVM ve WEB_APP kanittir)
   *   NO_V2        her esli vhost NO_RECENT_TRAFFIC + OK degil
   *   UNATTRIBUTED atfedilemeyen proxy trafigi (EK-3)
   */
  const retireEngeli = (h, j) => {
    const gate = j.gateHosts.map(hostBilgi).filter(Boolean);
    const bayat = [h, ...gate].filter((b) => b.scanned && !b.fresh);
    if (bayat.length)
      return {
        kod: 'STALE',
        metin: `bayat kanıt: ${bayat[0].host} ${bayat[0].scanDate || '?'}${bayat[0].loadExcluded ? ' (son yükleme dışlandı)' : ''}`,
      };
    const tier = tierOf(h.host);
    const ilgili = new Map();
    for (const b of [...gate, ...tier]) ilgili.set(b.host, b);
    const eski = [...ilgili.values()].filter((b) => b.scanned && b.webLegacy);
    if (eski.length || j.vhosts.some((m) => m.v.trafficState == null))
      return {
        kod: 'LEGACY',
        metin: `v2 trafik kanıtı yok (eski tarama satırı${eski.length ? ': ' + eski.slice(0, 5).map((b) => b.host).join(', ') : ''})`,
      };
    const olcmeyen = [...ilgili.values()].filter((b) => !b.measured);
    if (olcmeyen.length)
      return {
        kod: 'WEB_TIER',
        metin: `web katmanında ölçülemeyen host var: ${olcmeyen
          .slice(0, 5)
          .map((b) => b.host)
          .join(', ')}${olcmeyen.length > 5 ? ' +' + (olcmeyen.length - 5) : ''}`,
      };
    if (j.vhosts.some((m) => m.kind !== 'EXACT_JVM' && m.kind !== 'WEB_APP'))
      return { kod: 'MAPPING', metin: `eşleme türü ${j.mapping}` };
    if (
      !j.vhosts.every(
        (m) => m.v.trafficState === 'NO_RECENT_TRAFFIC' && m.v.trafficReason === 'OK',
      )
    )
      return { kod: 'NO_V2', metin: 'v2 trafik kanıtı yok' };
    const atf = [...atfedilemeyenTrafik(h, j), ...hedefiBilinmeyenTrafik(h, j)];
    if (atf.length)
      return {
        kod: 'UNATTRIBUTED',
        metin: `atfedilemeyen proxy trafiği var: ${atf.slice(0, 3).map(atfMetni).join(', ')}${atf.length > 3 ? ' +' + (atf.length - 3) : ''}`,
      };
    return null;
  };

  // SUNUCUYA OZEL INIT DOSYALARI (kullanici, 2026-09-28): "sadece appdomain.service'in
  // farkli olmasini warning olarak algilamasin; standarta aykiri bir durummus gibi
  // metrikleri bozsun istemiyorum. Denetim kismindan bu konuyu ayrica inceleyecegim."
  //
  // appdomain.service sunucunun KENDI JBoss kurulumunu tarif eder (ExecStart yollari,
  // domain/host adlari). Sunucudan sunucuya farkli olmasi normaldir; "filo cogunlugundan
  // farkli" olcutu burada yanlis soruyu soruyor ve her sunucuyu uyumsuz gosteriyordu.
  //
  // BILGI KAYBOLMUYOR, SINIFI DEGISIYOR: fark yine listeleniyor ama `warning` degil `info`
  // ve uyum metriklerine (initDiff / diffFiles / compliant) GIRMIYOR. Sessizce gizlemek,
  // kullanicinin Denetim'den bakacagi konuyu Server Hub'da gorunmez kilardi.
  const SUNUCUYA_OZEL_INIT = new Set(['appdomain.service']);

  // AUTO-START "BILINMIYOR" SEBEPLERI (kullanici, 2026-09-28): "1930 bilinmiyor durumunda
  // raporlamissin, nedir bunlar? neyi bilinmiyor olarak algiliyorsun". Uc apayri durum tek
  // kelimeye cikiyordu; hangisinin agir bastigi gorunmedigi icin sayinin ne anlama geldigi
  // de belirsizdi. "Bilinmiyor" hicbirinde "KAPALI" demek DEGILDIR.
  const AUTOSTART_SEBEP = {
    'cli-okunamadi': 'JBoss CLI cevap vermedi (envanterde de kayıt yok)',
    'envanterde-yok': 'CLI okunamadı, envanterde de auto-start alanı boş',
    'envanter-celiskili':
      'envanterde çelişkili: aynı uygulamanın JVM’lerinden bazısı açık, bazısı kapalı',
    // T2-C2: kaynak OKUNDU; sorun erisim degil tanim. "CLI cevap vermedi" yanlis yere baktirir.
    'tanimsiz-surec':
      "JVM tanım kaynağında yok (ps'te tanımsız süreç) — tanım listesi alındı, bu JVM orada tanımlı değil",
  };
  /** AUTOSTART_UNKNOWN onu: tanimsiz surecte deger OKUNAMAMIS degil, hic TANIMLANMAMISTIR. */
  const autoStartOnek = (sebep) =>
    sebep === 'tanimsiz-surec' ? 'auto-start bilinmiyor' : 'auto-start okunamadı';

  // ── Init: FILO COGUNLUGU (Denetim > Init Script ile ayni olcut; 2026-09-22) ──────
  // Kullanici: "Denetim'e gore cogu sunucu referansla uyumlu ama Server Hub 85/1114 diyor."
  // Repo referansi (INIT.status) ile sunuculardaki dosya mesru olarak farkli olabilir (repo
  // guncel degil / satir sonu). Olcut: dosya basina en kalabalik sha = cogunluk; ona uyan OK,
  // uymayan DIFF (bulgu), yok MISSING. Repo referansiyla fark yalniz bilgi olarak tasinir.
  // OKUNAMAYAN (UNREADABLE, v3) dosya cogunluk hesabina GIRMEZ: cok sayida okunamayan
  // sunucunun ortak bos sha'si filo cogunlugu olur ve gercek dosyalari DIFF gosterirdi.
  const shaCounts = new Map(); // "root/file" -> Map(sha -> n)
  for (const h of byHost.values())
    for (const i of h.init) {
      if (!i.sha || i.refStatus === 'UNREADABLE') continue;
      const k = `${i.root}/${i.file}`;
      if (!shaCounts.has(k)) shaCounts.set(k, new Map());
      shaCounts.get(k).set(i.sha, (shaCounts.get(k).get(i.sha) || 0) + 1);
    }
  const majorityOf = new Map();
  for (const [k, m] of shaCounts) {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    majorityOf.set(k, {
      sha: sorted[0][0],
      count: sorted[0][1],
      variants: sorted.length,
      total: sorted.reduce((a, x) => a + x[1], 0),
    });
  }
  for (const h of byHost.values())
    for (const i of h.init) {
      const mj = majorityOf.get(`${i.root}/${i.file}`);
      if (!mj) continue;
      i.majority = mj.sha;
      i.majorityCount = mj.count;
      i.variantCount = mj.variants;
      i.majorityTotal = mj.total;
      i.hostSpecific = SUNUCUYA_OZEL_INIT.has(String(i.file || '').toLowerCase());
      if (i.refStatus === 'UNREADABLE') i.status = 'UNREADABLE';
      else if (i.refStatus === 'MISSING') i.status = 'MISSING';
      else if (i.sha && i.sha === mj.sha) i.status = 'OK';
      else if (i.sha) i.status = 'DIFF';
    }

  // ── Bulgular ───────────────────────────────────────────────────────────────────
  const hosts = [];
  for (const h of byHost.values()) {
    const F = h.findings;
    const add = (severity, area, code, text, fix, ek) =>
      F.push({ severity, area, code, text, fix: fix || null, ...(ek || {}) });
    // ── yukleme ve tarama kapsami (v3) ──
    if (h.loadExcluded) {
      const ilk = h.loadExcludedIssues[0];
      add(
        'warning',
        'scan',
        'LOAD_EXCLUDED',
        `Son tarama yüklenemedi (${[...new Set(h.loadExcludedIssues.map((x) => x.issue))].join(', ')}${ilk.detail ? ': ' + ilk.detail : ''}) — gösterilen veri önceki yükleme (${h.scanDate || '?'}); eylem önerilmez`,
      );
    }
    if (h.loadDuplicate.length)
      add(
        'info',
        'scan',
        'LOAD_DUPLICATE',
        `AWX envanterinde aynı makine iki adla: ${h.loadDuplicate
          .map((x) => x.detail)
          .filter(Boolean)
          .join('; ') || '?'}`,
      );
    const kismi = h.scanErrors.filter((t) => /^(deadline:|fuse:)/.test(t));
    if (kismi.length)
      add('info', 'scan', 'SCAN_PARTIAL', `tarama kısmi: ${kismi.join(', ')}`, null, {
        // hazirlik: yalniz zaman butcesi (deadline) faz atlatti ise "olculemedi"
        deadline: kismi.some((t) => t.startsWith('deadline:')),
      });
    // EK-5: varligi OLCULEMEYEN web urunu "yok" degildir
    for (const t of h.scanErrors) {
      if (!t.startsWith('web_presence_unknown:')) continue;
      const urun = t.slice('web_presence_unknown:'.length) || '?';
      add(
        'info',
        'scan',
        'WEB_PRESENCE_UNKNOWN',
        `${urun} kurulu mu ÖLÇÜLEMEDİ (yetki/dzdo reddi) — "yok" sayılmaz`,
        null,
        { product: urun },
      );
    }
    // init
    for (const i of h.init) {
      if (i.status === 'UNREADABLE') {
        // OLCULEMEDI: dosya var/yok/farkli bilinmiyor; MISSING (engel) ya da DIFF DEGIL.
        add(
          'info',
          'init',
          'INIT_UNREADABLE',
          `${i.root}/${i.file} OKUNAMADI (yetki ya da dzdo reddi) — var/yok/farklı olduğu bilinmiyor`,
        );
        continue;
      }
      if (i.status === 'DIFF' && i.hostSpecific) {
        // Sunucuya ozel dosya: fark BEKLENEN durumdur, uyumsuzluk degil.
        add(
          'info',
          'init',
          'INIT_HOST_SPECIFIC',
          `${i.root}/${i.file} filo çoğunluğundan farklı — bu dosya sunucuya özeldir (JBoss kurulumunu tarif eder), farklı olması beklenir; uyum sayımına katılmaz`,
        );
      } else if (i.status === 'DIFF')
        add(
          'warning',
          'init',
          'INIT_DIFF',
          `${i.root}/${i.file} filo çoğunluğundan farklı (çoğunluk ${i.majorityCount}/${i.majorityTotal || '?'} sunucu, ${i.variantCount} sürüm)${i.refStatus === 'OK' ? ' — repo referansıyla AYNI' : ''}`,
        );
      else if (i.status === 'MISSING')
        add('info', 'init', 'INIT_MISSING', `${i.root}/${i.file} yok`);
    }
    // jboss host
    for (const b of h.jboss) {
      if (b.cli === 'FAIL')
        add('info', 'jboss', 'CLI_FAIL', `JBoss ${b.gen} CLI erişilemedi: ${b.note}`.trim());
      // CLI HIC DENENMEDI (2026-10-01). Tarama UC durum uretiyor - OK / FAIL / SKIP - ama
      // burada yalnizca FAIL raporlaniyordu. SKIP sebebi (jboss-cli yok, host controller
      // calismiyor) veritabanina YAZILIYOR ama ekranda GORUNMUYORDU; sonucta "1748 JVM'de
      // auto-start okunamadi" deniyor ve NEDEN sorusu cevapsiz kaliyordu.
      //
      // AYRI KOD: "denendi ve dustu" ile "hic denenmedi" ayri tesihslerdir - birincisi
      // CLI/baglanti sorunu, ikincisi kurulum/surec sorunudur.
      // DZDO REDDI AYRI BULGU (2026-10-01 uretim bulgusu): 809 sunucuda CLI "cevap
      // vermedi" sanilan sey aslinda yetki reddiydi - "Sorry, user www is not allowed to
      // execute '/bin/bash -lc ...'". Bu bir kurulum ya da baglanti sorunu DEGIL; dzdo
      // kural listesine jboss-cli eklenmesi gerekiyor. Ayri kod olmazsa yanlis yerde
      // aranir (nitekim arandi).
      if (b.cli === 'DENIED')
        add('warning', 'jboss', 'CLI_DENIED', `JBoss ${b.gen} CLI yetki reddi: ${b.note}`.trim());
      if (b.cli === 'SKIP' && b.note)
        add('info', 'jboss', 'CLI_SKIP', `JBoss ${b.gen} CLI çalıştırılamadı: ${b.note}`.trim());
      if (b.hostState === 'restart-required' || b.hostState === 'reload-required')
        add('warning', 'jboss', 'HOST_RESTART', `JBoss ${b.gen} host controller ${b.hostState}`);
    }
    // jvm
    // TANIM KAYNAGI (v3, scan_ver >= 2.1) - iki AYRI durum, iki ayri metin (T2-C2):
    //   PS_ONLY     : CLI de host XML de okunamadi; satirlar yalniz ps'ten. Durmus JVM'ler
    //                 listede OLMAYABILIR - "yok" demek degil. (JVM_INVENTORY_UNMEASURED)
    //   UNAVAILABLE : tanim kaynagi OKUNDU (CLI listesi ya da host XML) ama ps'te calisan JVM
    //                 orada tanimli degil (elle baslatilmis / baska domain / yanlis nesil).
    //                 "CLI ve host XML okunamadi" ve "durmus JVM'ler listede olmayabilir"
    //                 burada YANLISTIR: operatoru dzdo/CLI erisimine baktirir. Ayri kod:
    //                 JVM_UNDEFINED_PROCESS. Hazirlik etkisi ikisinde de 'unknown'.
    if ((surumNo(h.scanVer) || 0) >= 2001) {
      const cliJ = h.jvms.filter((j) => j.source === 'cli');
      const nesiller = (src) =>
        [...new Set(cliJ.filter((j) => j.cfgSrc === src).map((j) => j.gen))].sort();
      for (const g of nesiller('PS_ONLY'))
        add(
          'warning',
          'jvm',
          'JVM_INVENTORY_UNMEASURED',
          `JBoss ${g} tanımlı JVM envanteri ölçülemedi (CLI ve host XML okunamadı) - durmuş JVM'ler listede olmayabilir`,
        );
      for (const g of nesiller('UNAVAILABLE')) {
        const adlar = cliJ
          .filter((j) => j.gen === g && j.cfgSrc === 'UNAVAILABLE')
          .map((j) => j.name)
          .sort();
        // Hangi kaynak okundu: ayni nesildeki TANIMLI satirlarin cfg_src'si; tanimli satir
        // yoksa (liste bos dondu) JBOSS satirinin cli durumu.
        const kaynaklar = new Set();
        for (const j of cliJ) {
          if (j.gen !== g) continue;
          if (/^CLI/.test(j.cfgSrc || '')) kaynaklar.add('CLI');
          else if (j.cfgSrc === 'XML') kaynaklar.add('host XML');
        }
        if (!kaynaklar.size && h.jboss.some((b) => b.gen === g && b.cli === 'OK'))
          kaynaklar.add('CLI');
        const ad = `${adlar.slice(0, 5).join(', ')}${adlar.length > 5 ? ' +' + (adlar.length - 5) : ''}`;
        add(
          'warning',
          'jvm',
          'JVM_UNDEFINED_PROCESS',
          `JBoss ${g}: tanım kaynağı okundu${kaynaklar.size ? ` (${[...kaynaklar].join(', ')})` : ''}, çalışan ${ad} tanımda yok (ps'te tanımsız süreç)`,
          null,
          { undefinedJvms: adlar.slice(0, 50) },
        );
      }
    }
    // JBoss URUNU VAR AMA JVM VERISI YOK: tarama kaynakli tek JVM satiri yoksa bu sunucunun
    // JVM'leri hakkinda hicbir sey bilmiyoruz ("JVM yok" DEGIL).
    if (
      (h.products || []).some((x) => /^JBOSS/i.test(x)) &&
      !h.jvms.some((j) => j.source === 'cli')
    )
      add(
        'warning',
        'jvm',
        'JVM_DATA_MISSING',
        `Taramada JBoss var (${h.products.filter((x) => /^JBOSS/i.test(x)).join(', ')}) ama JVM satırı gelmedi — JVM durumu ölçülemedi`,
      );
    for (const j of h.jvms) {
      const id = `JBoss${j.gen} ${j.name}`;
      const fixOn = { action: 'jboss_autostart_on', gen: j.gen, jvm: j.name };
      const fixOff = { action: 'jboss_autostart_off', gen: j.gen, jvm: j.name };
      // runningKnown (v3): hidepid/ps korlugunde (running_src=UNMEASURED) running=0
      // "kapali" DEGILDIR. Bu JVM icin calisma durumuna dayanan HICBIR bulgu/eylem uretilmez.
      const rk = j.runningKnown !== false;
      if (!rk)
        add(
          'info',
          'jvm',
          'RUNNING_UNMEASURED',
          j.semaBilinmiyor
            ? `${id} çalışma durumu ÖLÇÜLEMEDİ (Server Hub şeması okunamadı: running_src seçilemedi) — kapalı sayılmaz, eylem önerilmez`
            : `${id} çalışma durumu ÖLÇÜLEMEDİ (süreç görünmüyor: hidepid / ps körlüğü) — kapalı sayılmaz, eylem önerilmez`,
        );
      if (rk && j.running && j.autoStart === 'false')
        add(
          'danger',
          'jvm',
          'REBOOT_RISK',
          `${id} çalışıyor ama auto-start KAPALI — reboot sonrası açılmaz`,
          fixOn,
        );
      // NEDEN BILINMIYOR (kullanici, 2026-09-28: "1930 bilinmiyor durumunda raporlamissin,
      // nedir bunlar? neyi bilinmiyor olarak algiliyorsun"). Uc ayri durum ayni kelimeyle
      // gosteriliyordu; hangisinin agir bastigi rapordan okunamiyordu.
      if (j.running && j.autoStart === 'unknown' && h.hasJboss)
        add(
          'info',
          'jvm',
          'AUTOSTART_UNKNOWN',
          `${id} ${autoStartOnek(j.autoStartReason)} — ${AUTOSTART_SEBEP[j.autoStartReason] || AUTOSTART_SEBEP['cli-okunamadi']}`,
          null,
          { autoStartReason: j.autoStartReason || 'cli-okunamadi' },
        );
      if ((j.mismatch || []).length)
        add('info', 'jvm', 'INV_MISMATCH', `${id}: ${j.mismatch.join('; ')}`);
      if (rk && !j.running && j.autoStart === 'true')
        add(
          'warning',
          'jvm',
          'STOPPED_AUTOSTART_ON',
          `${id} kapalı ama auto-start AÇIK — reboot'ta açılacak`,
          fixOff,
        );
      if (
        j.running &&
        (j.serverState === 'restart-required' || j.serverState === 'reload-required')
      )
        add(
          'warning',
          'jvm',
          'RESTART_REQUIRED',
          `${id} ${j.serverState}: runtime'da etkin olmayan değişiklik var`,
        );
      const ts = j.trafficState;
      // HANGI LOG OKUNDU (kullanici, 2026-09-28): "NO_LOAD bulgulari icin en son hangi
      // log dosyasinin okundugunu da gormek istiyorum."
      //
      // "7 gundur istek yok" iddiasinin DAYANAGI bir dosyadir; dosya adi gorunmezse iddia
      // denetlenemez. Metindeki kanit en fazla iki vhost gosterip gerisini "+3" diye
      // kisiyordu - eksik kalan tam da bakilmasi gereken satir olabilirdi.
      //
      // OKUNAN ile OKUNAMAYAN AYRI: req7d null ise o log HIC okunamamistir; onu "0 istek"
      // sayip listeye katmak, olculemeyen bir dosyayi kanit diye gostermek olurdu.
      const loglar = j.vhosts.map((m) => ({
        host: m.host,
        serverName: m.v.serverName || '',
        path: m.v.accessLog || '',
        confFile: m.v.confFile || '',
        req7d: m.v.req7d,
        req24h: m.v.req24h,
        // KISMI OKUMA: log kuyrugundan okunduysa sayi ALT SINIRDIR, "0" kesin degildir.
        sampled: m.v.sampled === true,
        shared: m.v.shared === true,
        // v3: -1 "okunamadi"dir (eskiden req7d != null idi ve -1 "okundu" sayiliyordu).
        read: m.v.req7d != null && m.v.req7d >= 0,
        trafficState: m.v.trafficState || null,
        trafficReason: m.v.trafficReason || null,
        kind: m.kind || null,
      }));
      const logKanit = {
        logs: loglar,
        scanDate: h.scanDate || null,
        matchKind: j.matchKind || null,
        mapping: j.mapping || 'NOT_MAPPED',
        trafficState: ts || null,
      };
      // Kanit: hangi web sunucusu, hangi vhost, hangi access log (kullanici istegi)
      const kanit = j.vhosts.length
        ? ` [${j.matchKind === 'proxy' ? 'proxy hedefi' : j.matchKind === 'web-app' ? 'Web-App ilişkisi' : j.matchKind}: ${j.vhosts
            .map(
              (m) =>
                `${m.host}/${m.v.serverName || '?'}${m.v.accessLog ? ' → ' + m.v.accessLog : ''}`,
            )
            .slice(0, 2)
            .join(', ')}${j.vhosts.length > 2 ? ' +' + (j.vhosts.length - 2) : ''}]`
        : '';
      const durmus = rk && !j.running;
      if (durmus && ts === 'NO_RECENT_TRAFFIC') {
        // jboss_retire YALNIZ v2 kaniti tamken (tazelik + gateHosts + tierMeasured + esleme
        // turu + v2 trafik + atfedilemeyen proxy yok). Aksi halde bulgu KALIR, eylem
        // onerilmez ve metin ILK engeli soyler.
        const engel = retireEngeli(h, j);
        add(
          'warning',
          'jvm',
          'RETIRE_CANDIDATE',
          `${id} kapalı ve web katmanında 7 gündür istek yok (hc.jsp/hc.html hariç) — retire adayı${kanit}${engel ? ` — eylem önerilmez: ${engel.metin}` : ''}`,
          engel ? null : { action: 'jboss_retire', gen: j.gen, jvm: j.name },
          { ...logKanit, retireBlock: engel ? engel.kod : null },
        );
      } else if (durmus && (ts === 'UNREADABLE' || ts === 'UNVERIFIED'))
        // OLCULEMEDI != YOK: esli loglardan biri okunamadi ya da web katmani dogrulanamadi;
        // "7 gundur istek yok" iddiasi KURULMAZ.
        add(
          'info',
          'jvm',
          'TRAFFIC_UNVERIFIED',
          `${id} kapalı ama web katmanı trafiği DOĞRULANAMADI (${ts === 'UNREADABLE' ? 'log okunamadı' : 'web sunucusu ölçülemedi'}) — retire önerilmez${kanit}`,
          null,
          logKanit,
        );
      else if (durmus && ts === 'NOT_MAPPED' && j.autoStart === 'false')
        add(
          'info',
          'jvm',
          'STOPPED',
          `${id} kapalı (web katmanı eşlenemedi${j.webMatch ? ': ' + j.webMatch.how : ''})`,
        );
      if (rk && j.running && ts === 'NO_RECENT_TRAFFIC')
        add(
          'warning',
          'jvm',
          'NO_LOAD',
          `${id} çalışıyor ama 7 gündür istek yok (hc.jsp/hc.html hariç)${kanit}`,
          null,
          logKanit,
        );
      // EK-3: bu sunucuya giden ve hicbir JVM'e atfedilemeyen proxy trafigi varken portu
      // bilinmeyen (durmus / olculemeyen) JVM'in trafigi bilinemez. Calistigi BILINEN JVM'e
      // eklenmez (retire konusu degildir; NO_PID sunucularda gurultu olurdu).
      // C1/C4: katmandaki HEDEFI BILINMEYEN (cozulemeyen / kesik liste) proxy trafigi yalniz
      // retire adayinda (durmus + NO_RECENT_TRAFFIC) yazilir: kararin gerekcesidir; diger
      // JVM'lerde katman genisliginde gurultu olurdu.
      if (!(rk && j.running)) {
        const atf = [
          ...atfedilemeyenTrafik(h, j),
          ...(durmus && ts === 'NO_RECENT_TRAFFIC' ? hedefiBilinmeyenTrafik(h, j) : []),
        ];
        // Metin olculeni anlatir: portu otoriter cfg_ports ile BILINEN JVM'de engel yalniz
        // hedefi bilinmeyen/kesik proxy'dir; orada "portu olculemedi" denmez (T2-C1).
        if (atf.length)
          add(
            'warning',
            'jvm',
            'TRAFFIC_UNATTRIBUTED',
            `${id} ${portBilinmiyor(h, j) ? 'portu ölçülemedi ve ' : ''}hiçbir JVM'e atfedilemeyen proxy trafiği var (${atf
              .slice(0, 3)
              .map(
                (x) =>
                  `${atfMetni(x)} ${x.trafficState || (x.req7d > 0 ? 'ACTIVE' : 'ölçülemedi')}`,
              )
              .join(', ')}${atf.length > 3 ? ' +' + (atf.length - 3) : ''}) — retire önerilmez`,
            null,
            { unattributed: atf.slice(0, 20).map(atfDisa) },
          );
      }
    }
    // URUN KAPSAMI (kullanici, 2026-09-24): envanter (dbo.Inventory) ne diyor, tarama ne gordu.
    // Tarama bir urunu goremediyse bu "urun yok" demek DEGILDIR - yetki/yol sorunu olabilir ve
    // sayfa "300 sunucuda 127 nginx" gibi eksik bir tablo gosterir. Fark acikca bulgu olur.
    for (const ip of h.invProducts || []) {
      const gorundu = (h.products || []).some((x) => U(x).startsWith(ip));
      if (!gorundu)
        add(
          'warning',
          'scan',
          'PRODUCT_NOT_SCANNED',
          `Envanterde ${ip} var ama tarama bu sunucuda göremedi (yetki ya da yol farkı olabilir)`,
        );
    }
    for (const sp of h.products || []) {
      if (sp === 'NONE') continue;
      const base = U(sp).replace(/[0-9]+$/, '');
      if (
        (h.invProducts || []).length &&
        !(h.invProducts || []).some((x) => base.startsWith(x) || x.startsWith(base))
      ) {
        add(
          'info',
          'scan',
          'PRODUCT_NOT_IN_INVENTORY',
          `Taramada ${sp} bulundu ama envanterde (dbo.Inventory) yok`,
        );
      }
    }
    // web
    for (const w of h.web) {
      // ERISIM KAYNAKLI "SOZDIZIMI HATASI" (2026-10-01, sartname tasarim incelemesi):
      // tarama www ile kosar; www bir sertifikayi / anahtari / log dosyasini okuyamazsa
      // `apachectl -t` "Syntax error on line N of F: SSLCertificateFile: file ... does not
      // exist or is empty" der. Bu bir SOZDIZIMI hatasi DEGIL, bir ERISIM sonucudur. Eskiden
      // bunun icin "satiri yorumla" duzeltmesi oneriliyordu: SSLCertificateFile satirini
      // yorumlamak uretimde SSL'i kirar. Erisim kaynakli cikti "dogrulanamadi"dir ve ona
      // config degistiren HICBIR eylem onerilmez.
      //
      // v3 SATIRI (check_class dolu): sinif tarayicidan gelir (web_classify; erisim deseni
      // parser deseninden ONCE). Eski satirda (check_class NULL) 9675be9 kurali aynen:
      // syntax FAIL + erisim deseni -> dogrulanamadi.
      const ham = webHam.get(w) || w.detail;
      const erisim = erisimKaynakli(ham);
      let sinif;
      if (w.checkClass != null) {
        if (w.checkClass === 'SYNTAX_ERROR' && w.syntaxVerification === 'VERIFIED') sinif = 'FAIL';
        else if (w.checkClass === 'ACCESS_DENIED' || w.checkClass === 'SYNTAX_ERROR')
          sinif = 'UNVERIFIED';
        else if (w.checkClass === 'OK') sinif = 'OK';
        else sinif = 'UNKNOWN';
      } else if (w.syntax === 'FAIL') sinif = erisim ? 'UNVERIFIED' : 'FAIL';
      else if (w.syntax === 'UNKNOWN') sinif = 'UNKNOWN';
      else sinif = 'OK';
      if (sinif === 'UNVERIFIED') {
        add(
          'warning',
          'web',
          'SYNTAX_UNVERIFIED',
          `${w.product} sözdizimi DOĞRULANAMADI — hata bir dosyaya erişimden kaynaklanıyor ` +
            `(yetki ya da eksik dosya); config satırını yorumlamak çözüm değildir: ${w.detail}`.trim(),
        );
        continue;
      }
      if (sinif === 'FAIL') {
        // apache_comment_line YALNIZ: NGINX degil, erisim deseni yok, detail kesilmemis
        // (loader ' ~' eki), v3 satirinda komut www ile KOSMUS (run_as=www), dosya:satir
        // ayristi. Tazelik kapisi asagida tum bulgulara uygulanir.
        const m = ham.match(/line (\d+) of (\S+?):?(\s|$)/i);
        const eylemOk =
          !!m &&
          w.product !== 'NGINX' &&
          !erisim &&
          !/~\s*$/.test(ham) &&
          (w.checkClass == null || w.runAs === 'www');
        add(
          'danger',
          'web',
          'SYNTAX_FAIL',
          `${w.product} sözdizimi hatalı: ${w.detail}`.trim(),
          eylemOk
            ? {
                action: 'apache_comment_line',
                product: w.product,
                file: m[2].replace(/:$/, ''),
                line: Number(m[1]),
              }
            : null,
        );
      }
      // OLCULEMEDI SESSIZ KALMAZ (2026-09-26): tarama www ile kosuyor; sertifika anahtari
      // okunamadiginda nginx -t duser. Bunu "sozdizimi hatali" saymak yanlis alarm, hic
      // gostermemek ise sunucuyu "sorunsuz" gibi gostermek olurdu.
      if (sinif === 'UNKNOWN') {
        add(
          'info',
          'web',
          'SYNTAX_UNKNOWN',
          `${w.product} sözdizimi ölçülemedi: ${w.detail}`.trim(),
        );
      }
      // webRunningKnown (v3): BLIND'da ps'te gorulmeyen web "calismiyor" DEGILDIR.
      if (
        w.runningKnown !== false &&
        !w.running &&
        h.vhosts.some((v) => v.product === w.product)
      )
        add('warning', 'web', 'NOT_RUNNING', `${w.product} çalışmıyor ama vhost tanımları var`);
    }
    for (const v of h.vhosts) {
      if (v.jvm || !v.serverName || v.serverName === '_') continue;
      if (v.trafficState != null) {
        // v3 satiri: yalniz NO_RECENT_TRAFFIC + OK + urunun vhost_trust=FULL. UNVERIFIED /
        // UNREADABLE (-1) "bosta" DEGILDIR -> bulgu yok.
        if (v.trafficState !== 'NO_RECENT_TRAFFIC' || v.trafficReason !== 'OK') continue;
        const wr = h.web.find((w) => w.product === v.product);
        if (!wr || wr.vhostTrust !== 'FULL') continue;
        // Sigorta (fuse:VHOST) bu sunucunun vhost envanterini kestiyse eylem onerilmez.
        const eylemOk = !h.fuseVhost && v.product !== 'NGINX' && !!v.confFile;
        add(
          'info',
          'web',
          'VHOST_IDLE',
          `${v.product} ${v.serverName}: 7 gündür istek yok${h.fuseVhost ? ' (vhost envanteri sigortayla kesildi — eylem önerilmez)' : ''}`,
          eylemOk
            ? {
                action: 'apache_retire_vhost',
                product: v.product,
                file: v.confFile,
                server_name: v.serverName,
              }
            : null,
        );
      } else if (v.req7d === 0) {
        // ESKI SATIR: bilgi kalir, yazma eylemi YOK (v2 kaniti - durum/sebep/guven - yok).
        add(
          'info',
          'web',
          'VHOST_IDLE',
          `${v.product} ${v.serverName}: 7 gündür istek yok (eski tarama satırı — eylem önerilmez)`,
        );
      }
    }
    // ip
    for (const ip of h.ips)
      if (ip.usedBy === 'none' && !ip.primary)
        add(
          'warning',
          'ip',
          'IP_UNUSED',
          `${ip.ip} (${ip.iface}) hiçbir vhost/soket kullanmıyor — boşta IP`,
        );
    // sshd: MaxSessions dusuk (varsayilan 10) -> Ansible delegate/forks ile "mux_client_request_session"
    if (h.sshd && h.sshd.maxSessions != null) {
      const near =
        h.sshd.activeSessions != null &&
        h.sshd.activeSessions >= Math.max(1, Math.floor(h.sshd.maxSessions * 0.8));
      if (near)
        add(
          'warning',
          'ssh',
          'SSH_SESSIONS_NEAR',
          `sshd MaxSessions ${h.sshd.maxSessions}, açık oturum ${h.sshd.activeSessions} — sınıra yakın (mux_client_request_session riski)`,
        );
      else if (h.sshd.maxSessions <= 10)
        add(
          'info',
          'ssh',
          'SSH_MAXSESSIONS_LOW',
          `sshd MaxSessions ${h.sshd.maxSessions} (varsayılan) — Ansible delegate/forks ile tıkanabilir; öneri 64`,
        );
    }
    // scan cost
    if (h.cpuS != null && h.cpuS > 10)
      add('info', 'scan', 'SCAN_COST', `tarama ${h.cpuS.toFixed(1)} sn CPU harcadı`);

    // EYLEM TAZELIK KAPISI (v3, TUM eylemler): bayat ya da son yuklemede disarida kalan
    // sunucunun kaniti bugunun eylemini BESLEMEZ. Bulgu kalir; eylem kalkar. Gerekce: bayat
    // sozdizimi hatasi duzeltilmisse apache_comment_line gecerli bir satiri yorumlar ve -t
    // gectigi icin geri alinmaz; bayat trafik "7 gundur istek yok"u bugune tasir.
    if (!h.fresh)
      for (const f of F) {
        f.fix = null;
        f.stale = true;
        f.text = `${f.text} (bayat kanıt: ${h.scanDate || '?'})`;
      }
    // SEMA KAPISI (C3): kolon listesi okunamadiysa v3 kanitlari (running_src, vhost_trust,
    // traffic_state, scan_errors, LoadIssues izi) hic secilmedi; HICBIR eylem onerilmez.
    h.schemaUnknown = semaBilinmiyor;
    if (semaBilinmiyor)
      for (const f of F) {
        if (f.fix) f.text = `${f.text} (Server Hub şeması okunamadı — eylem önerilmez)`;
        f.fix = null;
        f.schemaUnknown = true;
      }

    h.hostClass = hostClassOf(h.host);
    const worst = F.reduce((a, f) => Math.max(a, SEV[f.severity]), 0);
    h.status = Object.keys(SEV).find((k) => SEV[k] === worst);
    h.counts = {
      danger: F.filter((f) => f.severity === 'danger').length,
      warning: F.filter((f) => f.severity === 'warning').length,
      info: F.filter((f) => f.severity === 'info').length,
    };
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
      jvms: js.length,
      // v3: olculemeyen (UNMEASURED) JVM ne "calisiyor" ne "kapali" sayilir
      jvmRunning: js.filter((j) => j.runningKnown !== false && j.running).length,
      jvmUnmeasured: js.filter((j) => j.runningKnown === false).length,
      autoOff: js.filter((j) => j.autoStart === 'false').length,
      rebootRisk: hs.reduce(
        (a, h) => a + h.findings.filter((f) => f.code === 'REBOOT_RISK').length,
        0,
      ),
      initDiff: hs.reduce(
        (a, h) => a + h.init.filter((i) => i.status === 'DIFF' && !i.hostSpecific).length,
        0,
      ),
      web: Object.fromEntries(
        ['IHS', 'RHA', 'NGINX'].map((p) => {
          const rows = hs.flatMap((h) => h.web).filter((w) => w.product === p);
          return [
            p,
            {
              hosts: rows.length,
              syntaxFail: rows.filter((w) => w.syntax === 'FAIL').length,
              notRunning: rows.filter((w) => w.runningKnown !== false && !w.running).length,
              notRunningUnmeasured: rows.filter((w) => w.runningKnown === false && !w.running)
                .length,
            },
          ];
        }),
      ),
    };
  }
  const bulguSay = (hs, code, kosul) =>
    hs.reduce(
      (a, h) => a + h.findings.filter((f) => f.code === code && (!kosul || kosul(f))).length,
      0,
    );
  const summary = {
    byEnv,
    hosts: { total: genel.length, ok: 0, info: 0, warning: 0, danger: 0 },
    init: {
      hosts: genel.filter((h) => h.init.length).length,
      // OKUNAMAYAN dosya uyumlu SAYILMAZ (sunucuya ozel olsa bile; olculemedi)
      compliant: genel.filter(
        (h) =>
          h.init.length &&
          h.init.every((i) => i.status !== 'UNREADABLE' && (i.status === 'OK' || i.hostSpecific)),
      ).length,
      unreadableFiles: genel.reduce(
        (a, h) => a + h.init.filter((i) => i.status === 'UNREADABLE').length,
        0,
      ),
      diffFiles: genel.reduce(
        (a, h) => a + h.init.filter((i) => i.status === 'DIFF' && !i.hostSpecific).length,
        0,
      ),
      missingFiles: genel.reduce(
        (a, h) => a + h.init.filter((i) => i.status === 'MISSING').length,
        0,
      ),
      // repo referansi ile filo cogunlugu ayrisan dosyalar (repo guncel degil ya da dagitim eksik)
      refDiffFiles: [...majorityOf.entries()]
        .filter(([, m]) => {
          const any = [...byHost.values()].flatMap((h) => h.init).find((i) => i.sha === m.sha);
          return any && any.refStatus !== 'OK';
        })
        .map(([k, m]) => ({ file: k, hosts: m.count })),
    },
    jvm: {
      total: jvms.length,
      // v3 SAYACLAR: running/stopped yalniz calisma durumu BILINENLERI sayar; olculemeyen
      // (hidepid / ps korlugu) ayri sayacta. Eskiden UNMEASURED "kapali" sayiliyordu.
      running: jvms.filter((j) => j.runningKnown !== false && j.running).length,
      stopped: jvms.filter((j) => j.runningKnown !== false && !j.running).length,
      unmeasured: jvms.filter((j) => j.runningKnown === false).length,
      // S3 bedeli: RETIRE_CANDIDATE bulgusu var ama eylem web katmani kapisi yuzunden yok
      retireBlockedByWebTier: bulguSay(
        genel,
        'RETIRE_CANDIDATE',
        (f) => !f.fix && f.retireBlock === 'WEB_TIER',
      ),
      trafficUnverified: bulguSay(genel, 'TRAFFIC_UNVERIFIED'),
      autoOn: jvms.filter((j) => j.autoStart === 'true').length,
      autoOff: jvms.filter((j) => j.autoStart === 'false').length,
      autoUnknown: jvms.filter((j) => j.autoStart === 'unknown').length,
      // BILINMIYOR'UN KIRILIMI: tek sayi "neyi bilmiyoruz" sorusunu cevapsiz birakiyordu.
      autoUnknownBy: ['cli-okunamadi', 'envanterde-yok', 'envanter-celiskili', 'tanimsiz-surec'].reduce((m, k) => {
        m[k] = jvms.filter(
          (j) => j.autoStart === 'unknown' && (j.autoStartReason || 'cli-okunamadi') === k,
        ).length;
        return m;
      }, {}),
      restartRequired: jvms.filter((j) => j.running && /required/.test(j.serverState)).length,
      rebootRisk: genel.reduce(
        (a, h) => a + h.findings.filter((f) => f.code === 'REBOOT_RISK').length,
        0,
      ),
      retireCandidates: genel.reduce(
        (a, h) => a + h.findings.filter((f) => f.code === 'RETIRE_CANDIDATE').length,
        0,
      ),
      noLoad: genel.reduce((a, h) => a + h.findings.filter((f) => f.code === 'NO_LOAD').length, 0),
      mapped: jvms.filter((j) => j.req7d != null).length,
      fromInventory: jvms.filter((j) => j.source === 'envanter').length,
      autoStartFromInventory: jvms.filter((j) => j.autoStartSource === 'envanter').length,
      mismatched: jvms.filter((j) => (j.mismatch || []).length > 0).length,
      invApps: genel.reduce((a, h) => a + (h.invApps || 0), 0),
    },
    web: {},
    ips: {
      total: genel.reduce((a, h) => a + h.ips.length, 0),
      // yalniz 'none' atil; 'unverified' (web katmani ya da soket olculemedi) ASLA atil degil
      unused: genel.reduce(
        (a, h) => a + h.ips.filter((i) => i.usedBy === 'none' && !i.primary).length,
        0,
      ),
      unverified: genel.reduce(
        (a, h) => a + h.ips.filter((i) => i.usedBy === 'unverified').length,
        0,
      ),
    },
    // YUKLEME / TAZELIK (v3): eylemleri kapatan sunucular gorunur olsun
    load: {
      excluded: genel.filter((h) => h.loadExcluded).length,
      duplicate: genel.filter((h) => h.loadDuplicate.length > 0).length,
      stale: genel.filter((h) => !h.fresh).length,
    },
    ssh: {
      hosts: genel.filter((h) => h.sshd).length,
      lowMaxSessions: genel.filter(
        (h) => h.sshd && h.sshd.maxSessions != null && h.sshd.maxSessions <= 10,
      ).length,
      near: genel.reduce(
        (a, h) => a + h.findings.filter((f) => f.code === 'SSH_SESSIONS_NEAR').length,
        0,
      ),
    },
    // Urun kapsami: envanterde KAC sunucuda var, tarama KACINDA gordu (kullanici, 2026-09-24)
    coverage: ['NGINX', 'IHS', 'RHA', 'JBOSS'].reduce((a, prod) => {
      const inv = genel.filter((h) => (h.invProducts || []).includes(prod));
      a[prod] = {
        inventory: inv.length,
        scanned: inv.filter((h) => (h.products || []).some((x) => U(x).startsWith(prod))).length,
        scannedNotInInventory: genel.filter(
          (h) =>
            (h.products || []).some((x) => U(x).startsWith(prod)) &&
            !(h.invProducts || []).includes(prod),
        ).length,
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
      byPrefix: ['GBEVM', 'GBPRV'].reduce((a, pfx) => {
        a[pfx] = special.filter((h) => U(h.host).startsWith(pfx)).length;
        return a;
      }, {}),
      jvms: special.reduce((a, h) => a + h.jvms.length, 0),
    },
  };
  for (const h of genel) summary.hosts[h.status] += 1;
  for (const p of ['IHS', 'RHA', 'NGINX']) {
    const rows = web.filter((w) => w.product === p);
    summary.web[p] = {
      hosts: rows.length,
      syntaxOk: rows.filter((w) => w.syntax === 'OK').length,
      syntaxFail: rows.filter((w) => w.syntax === 'FAIL').length,
      syntaxUnknown: rows.filter((w) => w.syntax === 'UNKNOWN').length,
      // webRunningKnown (v3): BLIND'da gorulmeyen web "calismiyor" sayilmaz
      notRunning: rows.filter((w) => w.runningKnown !== false && !w.running).length,
      notRunningUnmeasured: rows.filter((w) => w.runningKnown === false && !w.running).length,
      vhosts: genel.reduce((a, h) => a + h.vhosts.filter((v) => v.product === p).length, 0),
      idleVhosts: genel.reduce(
        (a, h) => a + h.vhosts.filter((v) => v.product === p && v.req7d === 0).length,
        0,
      ),
    };
  }
  // ── KAPSAMA: ENVANTERDE KAC VAR, TARAMA KACINA ERISEBILDI (kullanici, 2026-10-01) ──
  //
  // "Envanterde kac JBoss oldugunu, ancak Server Hub'in kacina erisip veri cekebildigini;
  //  kac JVM oldugunu, Server Hub'in kac JVM'in bilgisini cekebildigini... aynisini Red Hat
  //  Apache, IBM Apache ve Nginx'ler icin de. Inventory tablosunda 1800-1900 kusur sunucu
  //  var, Server Hub playbook'undan su kadarina erisebildik gibi bir sey yapabilir miyiz?"
  //
  // NEDEN ONEMLI: bu ekranin butun sayilari TARANAN sunuculardan hesaplaniyor. Erisilemeyen
  // bir sunucu hicbir bulgu uretmez - yani kapsama yazilmazsa "sorun yok" ile "bakamadik"
  // ayni gorunur. Bu blok farki ACIKCA sayiya dokuyor.
  //
  // IKI KAYNAK AYRI: envanter dbo.Inventory (urun sutunlari) ve dbo.MWAppsInventory (JVM
  // sayisi); tarama ise Server_Hub_* tablolari. Biri otekini DUZELTMEZ - fark bilgidir.
  // (envanterHostlari yukarida, tazelik/web katmani kapilarindan once kuruldu)
  const tarananlar = new Set(genel.map((h) => U(h.host)));
  /** Envanterde bu urunu tasiyan host'lar. */
  const envanterUrun = (p) => {
    const out = new Set();
    for (const [host, urunler] of invProductsByHost) if (urunler.includes(p)) out.add(host);
    return out;
  };
  /** Taramada bu urun icin GERCEKTEN veri gelen host'lar. */
  const taranmisUrun = (p) => {
    const out = new Set();
    if (p === 'JBOSS') {
      // JBoss icin olcut: JVM satiri geldi mi. "urun kurulu" demek yetmez - veri cekemediysek
      // o sunucu hakkinda hicbir sey bilmiyoruz.
      for (const h of genel) if ((h.jvms || []).length) out.add(U(h.host));
      return out;
    }
    // `web` host basina GOMULU satirlardan geliyor (genel.flatMap) ve `host` alani
    // TASIMIYOR - w.host kullanmak hepsini bos anahtara toplar (ilk surumde oldu, smoke
    // testte RHA/NGINX kapsamasi 0 cikti).
    for (const h of genel) if ((h.web || []).some((w) => w.product === p)) out.add(U(h.host));
    return out;
  };
  // ENVANTER SUTUNU YOK MU: dbo.Inventory'de o urunun surum sutunu hic yoksa envanter
  // sayisi 0 DEGIL, BILINMIYOR'dur. Uretimde RHA tam olarak boyle okundu (`apache_version`
  // da `httpd_version` da yok) ve panel "envanterde 0 RHA" dedi.
  const invUnknown = data.invProductUnknown || {};
  const kapsamaSatiri = (p) => {
    const env = envanterUrun(p);
    const tar = taranmisUrun(p);
    const eslesen = [...env].filter((h) => tar.has(h));
    return {
      inventoryUnknown: !!invUnknown[p],
      inventory: env.size,
      scanned: eslesen.length,
      // ENVANTERDE OLMAYAN AMA TARAMADA CIKAN: envanter eksik demektir, gizlenmemeli.
      scannedNotInInventory: [...tar].filter((h) => !env.has(h)).length,
      missing: env.size - eslesen.length,
      // Erisilemeyen ILK 50 sunucu: ekran "kimler" sorusunu da cevaplayabilsin.
      missingHosts: [...env]
        .filter((h) => !tar.has(h))
        .sort()
        .slice(0, 50),
    };
  };

  // JVM SAYISI: envanter tarafi MWAppsInventory'nin jvm_count toplamidir; yalniz ENVANTERDE
  // JBoss tasiyan sunucular sayilir (JBoss olmayan sunucunun uygulamasi JVM degildir).
  const jbossEnvHosts = envanterUrun('JBOSS');
  let envJvm = 0;
  for (const [host, apps] of appsByHost) {
    if (!jbossEnvHosts.has(U(host))) continue;
    for (const a of apps) envJvm += a.jvmCount || (a.autoStarts || []).length || 0;
  }
  // AD `scanCoverage` - yukaridaki `summary.coverage` ILE KARISTIRILMAMALI (2026-09-24).
  // O, yalniz TARANAN sunucular icinde "envanter bu urunu diyor mu" diye bakar; yani
  // taramanin hic ulasamadigi sunucular ORADA GORUNMEZ. Kullanicinin sordugu sey tam
  // olarak o eksik: "Inventory tablosunda 1800-1900 kusur sunucu var, playbook'tan su
  // kadarina erisebildik". Bu blok envanterin TAMAMINI payda alir.
  summary.scanCoverage = {
    // SUNUCU: envanterdeki toplam ve taramanin erisebildigi.
    hosts: {
      inventory: envanterHostlari.size,
      scanned: [...envanterHostlari].filter((h) => tarananlar.has(h)).length,
      scannedNotInInventory: [...tarananlar].filter((h) => !envanterHostlari.has(h)).length,
      missing:
        envanterHostlari.size - [...envanterHostlari].filter((h) => tarananlar.has(h)).length,
    },
    products: {
      JBOSS: kapsamaSatiri('JBOSS'),
      RHA: kapsamaSatiri('RHA'),
      IHS: kapsamaSatiri('IHS'),
      NGINX: kapsamaSatiri('NGINX'),
    },
    jvm: {
      // Envanter (MWAppsInventory) ne diyor, tarama kac JVM satiri getirdi.
      inventory: envJvm,
      scanned: jvms.filter((j) => j.source !== 'envanter').length,
      // CLI'dan okunamayip ENVANTERDEN tamamlanan satirlar ayri durur: bunlar "bilgisini
      // cektik" sayilmaz, envanterden odunc alindi.
      fromInventory: jvms.filter((j) => j.source === 'envanter').length,
    },
  };

  const cpu = genel.filter((h) => h.cpuS != null);
  if (cpu.length) {
    summary.scan.avgCpuS = Math.round((cpu.reduce((a, h) => a + h.cpuS, 0) / cpu.length) * 10) / 10;
    const mx = cpu.reduce((a, h) => (h.cpuS > a.cpuS ? h : a), cpu[0]);
    summary.scan.maxCpuS = mx.cpuS;
    summary.scan.maxCpuHost = mx.host;
  }
  // GERI ALMA KAPISI (EK-1): son taramasi v3 tarayicidan (scan_ver dolu) gelen sunucu
  // varken Portal eski surume geri ALINMAZ - eski Portal yeni verideki -1 / UNMEASURED /
  // NONE degerlerinden sahte retire/stopped uretir. Sayim README'deki SQL ile aynidir
  // (her sunucunun en son scan_date satiri, scan_ver IS NOT NULL); tum sunucular sayilir.
  // SEMA BILINMIYORSA (C3) scan_ver hic secilmedi: v3Hosts SAYILAMAZ (0 degil, bilinmiyor)
  // ve geri alma serbest DENMEZ - aksi halde EK-1'in koruma sinyali tersine donerdi.
  const v3Hosts = semaBilinmiyor ? null : hosts.filter((h) => h.scanVer != null).length;
  summary.scanVersion = {
    v3Hosts,
    legacyHosts: semaBilinmiyor ? null : hosts.length - v3Hosts,
    rollbackAllowed: !semaBilinmiyor && v3Hosts === 0,
    schemaUnknown: semaBilinmiyor,
  };
  summary.schemaUnknown = semaBilinmiyor;
  // FILO BAYAT (EK-2): en son basarili yukleme FRESH_MAX_DAYS'ten eskiyse hicbir sunucu
  // taze degildir; ekran kirmizi bant gosterir ("Son basarili yukleme N gun once").
  const ageDays = latestGun == null ? null : nowGun - latestGun;
  const staleFleet =
    ageDays != null && ageDays > FRESH_MAX_DAYS ? { lastLoad: latestScan, ageDays } : null;
  return { hosts, summary, latestScan, staleFleet, schemaUnknown: semaBilinmiyor };
}

/** Tum bulgular tek listede (Bulgular sekmesi / CSV): host + urunler + bulgu. */
function flattenFindings(hosts) {
  const out = [];
  for (const h of hosts)
    for (const f of h.findings)
      out.push({
        host: h.host,
        hostClass: h.hostClass || 'genel',
        products: h.products,
        env: h.env,
        envGroup: h.envGroup,
        scanDate: h.scanDate,
        severity: f.severity,
        area: f.area,
        code: f.code,
        text: f.text,
        fixable: !!f.fix,
        // DUZELTME AYRINTISI DA TASINIR (2026-10-01): Bulgular sekmesinde satir bazinda
        // islem yapabilmek icin hedefin (gen, jvm) bilinmesi gerekiyor. `fixable`
        // yalnizca "duzeltilebilir mi" diyordu, NEYIN duzeltilecegini soylemiyordu.
        fix: f.fix || null,
        // bayat / disarida kalan sunucu: eylem tazelik kapisinda kalkti
        stale: f.stale === true,
      });
  out.sort(
    (a, b) =>
      SEV[b.severity] - SEV[a.severity] ||
      a.area.localeCompare(b.area) ||
      a.host.localeCompare(b.host),
  );
  return out;
}

module.exports = {
  assess,
  parseTargets,
  hedefUserinfoSil,
  hedefListesi,
  SEV,
  flattenFindings,
  hostClassOf,
  SPECIAL_HOST_RE,
  FRESH_MAX_DAYS,
  erisimKaynakli,
};
