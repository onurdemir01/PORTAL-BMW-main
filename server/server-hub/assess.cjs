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

const { webHostOf } = require('../audit/web-app.cjs');

const SEV = { ok: 0, info: 1, warning: 2, danger: 3 };
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
  for (const r of data.init || []) H(r.host).init.push({ root: r.root, file: r.file, status: U(r.status) });
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
  for (const r of data.sshd || []) H(r.host).sshd = { maxSessions: r.max_sessions == null ? null : Number(r.max_sessions), maxStartups: r.max_startups || '', activeSessions: r.active_sessions == null ? null : Number(r.active_sessions) };
  for (const r of data.ips || []) H(r.host).ips.push({ ip: r.ip, iface: r.iface || '', usedBy: L(r.used_by) || 'none', primary: Number(r.is_primary) === 1 });

  // ── JVM <-> vhost eslemesi ──────────────────────────────────────────────────────
  const allVhosts = [];
  for (const h of byHost.values()) for (const v of h.vhosts) allVhosts.push({ host: h.host, v });
  for (const h of byHost.values()) {
    for (const j of h.jvms) {
      // 1) proxy hedefi kesin eslesme
      for (const { host, v } of allVhosts) {
        if (v.proxyTargets.some((t) => t.host === h.host && (t.port == null || j.ports.includes(t.port)))) {
          j.vhosts.push({ host, v }); j.matchKind = j.matchKind || 'proxy';
        }
      }
      // 2) ad tahmini (yalniz kesin eslesme yoksa)
      if (!j.vhosts.length && j.name) {
        const cands = new Set([h.host, shortHost(webHostOf(h.host) || '')].filter(Boolean));
        const needle = L(j.name);
        for (const { host, v } of allVhosts) {
          if (!cands.has(host)) continue;
          if (L(v.serverName).includes(needle) || L(v.aliases).includes(needle)) { j.vhosts.push({ host, v }); j.matchKind = 'name'; }
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

  // ── Bulgular ───────────────────────────────────────────────────────────────────
  const hosts = [];
  for (const h of byHost.values()) {
    const F = h.findings;
    const add = (severity, area, code, text, fix) => F.push({ severity, area, code, text, fix: fix || null });
    // init
    for (const i of h.init) {
      if (i.status === 'DIFF') add('warning', 'init', 'INIT_DIFF', `${i.root}/${i.file} referanstan farklı`);
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
      if (j.running && j.autoStart === 'unknown') add('info', 'jvm', 'AUTOSTART_UNKNOWN', `${id} auto-start okunamadı`);
      if (!j.running && j.autoStart === 'true') add('warning', 'jvm', 'STOPPED_AUTOSTART_ON', `${id} kapalı ama auto-start AÇIK — reboot'ta açılacak`, fixOff);
      if (j.running && (j.serverState === 'restart-required' || j.serverState === 'reload-required')) add('warning', 'jvm', 'RESTART_REQUIRED', `${id} ${j.serverState}: runtime'da etkin olmayan değişiklik var`);
      const hasTraffic = j.req7d != null;
      if (!j.running && hasTraffic && j.req7d === 0) add('warning', 'jvm', 'RETIRE_CANDIDATE', `${id} kapalı ve web katmanında 7 gündür istek yok — retire adayı`, { action: 'jboss_retire', gen: j.gen, jvm: j.name });
      else if (!j.running && !hasTraffic && j.autoStart === 'false') add('info', 'jvm', 'STOPPED', `${id} kapalı (web katmanı eşlenemedi)`);
      if (j.running && hasTraffic && j.req7d === 0) add('warning', 'jvm', 'NO_LOAD', `${id} çalışıyor ama 7 gündür istek yok (hc hariç)`);
    }
    // web
    for (const w of h.web) {
      if (w.syntax === 'FAIL') {
        const m = w.detail.match(/line (\d+) of (\S+?):?(\s|$)/i);
        add('danger', 'web', 'SYNTAX_FAIL', `${w.product} sözdizimi hatalı: ${w.detail}`.trim(),
          m && w.product !== 'NGINX' ? { action: 'apache_comment_line', product: w.product, file: m[2].replace(/:$/, ''), line: Number(m[1]) } : null);
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

    const worst = F.reduce((a, f) => Math.max(a, SEV[f.severity]), 0);
    h.status = Object.keys(SEV).find((k) => SEV[k] === worst);
    h.counts = { danger: F.filter((f) => f.severity === 'danger').length, warning: F.filter((f) => f.severity === 'warning').length, info: F.filter((f) => f.severity === 'info').length };
    hosts.push(h);
  }
  hosts.sort((a, b) => SEV[b.status] - SEV[a.status] || a.host.localeCompare(b.host));

  // ── Ozet ───────────────────────────────────────────────────────────────────────
  const jvms = hosts.flatMap((h) => h.jvms);
  const web = hosts.flatMap((h) => h.web);
  const summary = {
    hosts: { total: hosts.length, ok: 0, info: 0, warning: 0, danger: 0 },
    init: { hosts: hosts.filter((h) => h.init.length).length, compliant: hosts.filter((h) => h.init.length && h.init.every((i) => i.status === 'OK')).length, diffFiles: hosts.reduce((a, h) => a + h.init.filter((i) => i.status === 'DIFF').length, 0) },
    jvm: {
      total: jvms.length, running: jvms.filter((j) => j.running).length, stopped: jvms.filter((j) => !j.running).length,
      autoOn: jvms.filter((j) => j.autoStart === 'true').length, autoOff: jvms.filter((j) => j.autoStart === 'false').length, autoUnknown: jvms.filter((j) => j.autoStart === 'unknown').length,
      restartRequired: jvms.filter((j) => j.running && /required/.test(j.serverState)).length,
      rebootRisk: hosts.reduce((a, h) => a + h.findings.filter((f) => f.code === 'REBOOT_RISK').length, 0),
      retireCandidates: hosts.reduce((a, h) => a + h.findings.filter((f) => f.code === 'RETIRE_CANDIDATE').length, 0),
      noLoad: hosts.reduce((a, h) => a + h.findings.filter((f) => f.code === 'NO_LOAD').length, 0),
      mapped: jvms.filter((j) => j.req7d != null).length,
    },
    web: {},
    ips: { total: hosts.reduce((a, h) => a + h.ips.length, 0), unused: hosts.reduce((a, h) => a + h.ips.filter((i) => i.usedBy === 'none' && !i.primary).length, 0) },
    ssh: { hosts: hosts.filter((h) => h.sshd).length, lowMaxSessions: hosts.filter((h) => h.sshd && h.sshd.maxSessions != null && h.sshd.maxSessions <= 10).length, near: hosts.reduce((a, h) => a + h.findings.filter((f) => f.code === 'SSH_SESSIONS_NEAR').length, 0) },
    scan: { avgCpuS: null, maxCpuS: null, maxCpuHost: null },
  };
  for (const h of hosts) summary.hosts[h.status] += 1;
  for (const p of ['IHS', 'RHA', 'NGINX']) {
    const rows = web.filter((w) => w.product === p);
    summary.web[p] = { hosts: rows.length, syntaxOk: rows.filter((w) => w.syntax === 'OK').length, syntaxFail: rows.filter((w) => w.syntax === 'FAIL').length, notRunning: rows.filter((w) => !w.running).length,
      vhosts: hosts.reduce((a, h) => a + h.vhosts.filter((v) => v.product === p).length, 0),
      idleVhosts: hosts.reduce((a, h) => a + h.vhosts.filter((v) => v.product === p && v.req7d === 0).length, 0) };
  }
  const cpu = hosts.filter((h) => h.cpuS != null);
  if (cpu.length) {
    summary.scan.avgCpuS = Math.round((cpu.reduce((a, h) => a + h.cpuS, 0) / cpu.length) * 10) / 10;
    const mx = cpu.reduce((a, h) => (h.cpuS > a.cpuS ? h : a), cpu[0]);
    summary.scan.maxCpuS = mx.cpuS; summary.scan.maxCpuHost = mx.host;
  }
  const latestScan = hosts.reduce((a, h) => (h.scanDate && (!a || h.scanDate > a) ? h.scanDate : a), null);
  return { hosts, summary, latestScan };
}

module.exports = { assess, parseTargets, SEV };
