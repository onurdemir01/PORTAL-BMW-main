// server/server-hub/__tests__/assess.test.cjs — SH1..SH8 (2026-09-21).
// Server Hub degerlendirmesi: JVM<->vhost eslemesi (proxy hedefi kesin, ad tahmini yedek),
// bulgu kodlari ve siddetleri, duzeltme eylemi parametreleri, ozet sayilari.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assess, parseTargets } = require('../assess.cjs');

const D = '2026-09-21';
const base = () => ({
  hosts: [
    { host: 'DACRAAP01', scan_date: D, products: 'JBOSS7 RHA', wall_s: 4.2, cpu_s: 1.1 },
    { host: 'DACRWAP01', scan_date: D, products: 'RHA', wall_s: 2, cpu_s: 0.5 },
  ],
  init: [
    { host: 'DACRAAP01', root: 'vhosting', file: 'start.sh', status: 'OK' },
    { host: 'DACRAAP01', root: 'vhosting', file: 'functions.sh', status: 'DIFF' },
  ],
  jboss: [
    { host: 'DACRAAP01', gen: 7, host_name: 'master', host_state: 'running', cli: 'OK', note: '' },
  ],
  jvms: [
    {
      host: 'DACRAAP01',
      gen: 7,
      jvm: 'crm',
      grp: 'g',
      running: 1,
      auto_start: 'false',
      server_state: 'running',
      ports: '8080,9990',
    },
    {
      host: 'DACRAAP01',
      gen: 7,
      jvm: 'oldapp',
      grp: 'g',
      running: 0,
      auto_start: 'false',
      server_state: 'stopped',
      ports: '',
    },
    {
      host: 'DACRAAP01',
      gen: 7,
      jvm: 'batch',
      grp: 'g',
      running: 1,
      auto_start: 'true',
      server_state: 'restart-required',
      ports: '8180',
    },
  ],
  web: [{ host: 'DACRWAP01', product: 'RHA', running: 1, syntax: 'OK', detail: '2 vhost' }],
  vhosts: [
    {
      host: 'DACRWAP01',
      product: 'RHA',
      listen: '10.1.1.13:443',
      server_name: 'crm.fw.local',
      aliases: '',
      access_log: '/l/crm',
      proxy_targets: 'dacraap01.fw.local:8080',
      req_24h: 50,
      req_7d: 900,
      hc_24h: 5,
      shared: 0,
      sampled: 0,
      conf_file: '/usr/apache/conf/vhosts.conf',
    },
    {
      host: 'DACRWAP01',
      product: 'RHA',
      listen: '10.1.1.14:443',
      server_name: 'oldapp.fw.local',
      aliases: '',
      access_log: '/l/old',
      proxy_targets: 'dacraap01:8280',
      req_24h: 0,
      req_7d: 0,
      hc_24h: 40,
      shared: 0,
      sampled: 0,
      conf_file: '/usr/apache/conf/old.conf',
    },
  ],
  ips: [
    { host: 'DACRWAP01', ip: '10.1.1.13', iface: 'eth0', used_by: 'RHA', is_primary: 0 },
    { host: 'DACRWAP01', ip: '10.1.1.99', iface: 'eth0', used_by: 'none', is_primary: 0 },
    { host: 'DACRWAP01', ip: '10.1.1.10', iface: 'eth0', used_by: 'other', is_primary: 1 },
  ],
});

test("SH1: proxy hedefi (host:port) ile JVM<->vhost kesin eslesir; trafik JVM'e yazilir", () => {
  const r = assess(base());
  const app = r.hosts.find((h) => h.host === 'DACRAAP01');
  const crm = app.jvms.find((j) => j.name === 'crm');
  assert.equal(crm.matchKind, 'proxy');
  assert.equal(crm.req7d, 900);
  assert.equal(crm.vhosts[0].v.serverName, 'crm.fw.local');
});

// 2026-09-24 (kullanici): ad tahmini yerine Denetim > Web-App iliskisi kullanilir - ayni
// fonksiyon (audit/web-app.cjs matchWebForApp): tier domain'den, web sunucusu adayi 3-tier'da
// 5. harf A->W, eslesme server_name icinde uygulama adi. matchKind bu yuzden 'web-app'.
test('SH2: proxy hedefi tutmazsa Web-App iliskisi devreye girer (5. harf A->W web sunucusu)', () => {
  const r = assess(base());
  const app = r.hosts.find((h) => h.host === 'DACRAAP01');
  const old = app.jvms.find((j) => j.name === 'oldapp');
  assert.equal(old.matchKind, 'web-app'); // port 8280 JVM'de yok (kapali, port yok) -> Web-App ile DACRWAP01
  assert.equal(old.req7d, 0);
  assert.equal(old.vhosts[0].host, 'DACRWAP01');
  assert.match(old.webMatch.how, /server_name/);
  // kanit bulgu metninde: web sunucusu / vhost / access log
  const f = app.findings.find((x) => x.code === 'RETIRE_CANDIDATE');
  assert.match(f.text, /hc\.jsp\/hc\.html hariç/i);
  assert.match(f.text, /DACRWAP01\/oldapp\.fw\.local/);
  assert.match(f.text, /\/l\/old/);
});

test('SH3: bulgu kodlari ve siddet: REBOOT_RISK danger, RETIRE_CANDIDATE warning, RESTART_REQUIRED warning, INIT_DIFF warning', () => {
  const r = assess(base());
  const app = r.hosts.find((h) => h.host === 'DACRAAP01');
  const codes = Object.fromEntries(app.findings.map((f) => [f.code, f]));
  assert.equal(codes.REBOOT_RISK.severity, 'danger');
  assert.deepEqual(codes.REBOOT_RISK.fix, { action: 'jboss_autostart_on', gen: 7, jvm: 'crm' });
  assert.equal(codes.RETIRE_CANDIDATE.severity, 'warning');
  assert.deepEqual(codes.RETIRE_CANDIDATE.fix, { action: 'jboss_retire', gen: 7, jvm: 'oldapp' });
  assert.equal(codes.RESTART_REQUIRED.severity, 'warning');
  assert.equal(codes.INIT_DIFF.severity, 'warning');
  assert.equal(app.status, 'danger');
});

test('SH4: web sunucusu: bosta IP warning, JVM\'e esli vhost "idle" sayilmaz, esli olmayan idle vhost info + retire eylemi', () => {
  const d = base();
  d.vhosts.push({
    host: 'DACRWAP01',
    product: 'RHA',
    listen: '*:80',
    server_name: 'lonely.fw.local',
    aliases: '',
    access_log: '/l/lonely',
    proxy_targets: '',
    req_24h: 0,
    req_7d: 0,
    hc_24h: 0,
    shared: 0,
    sampled: 0,
    conf_file: '/usr/apache/conf/lonely.conf',
  });
  const r = assess(d);
  const web = r.hosts.find((h) => h.host === 'DACRWAP01');
  const codes = web.findings.map((f) => f.code);
  assert.ok(codes.includes('IP_UNUSED'));
  const idle = web.findings.filter((f) => f.code === 'VHOST_IDLE');
  assert.equal(idle.length, 1, "oldapp vhost JVM'e esli, idle bulgusu vermez; lonely verir");
  assert.deepEqual(idle[0].fix, {
    action: 'apache_retire_vhost',
    product: 'RHA',
    file: '/usr/apache/conf/lonely.conf',
    server_name: 'lonely.fw.local',
  });
  assert.equal(web.status, 'warning');
});

test('SH5: apache sozdizimi hatasi -> danger + satir yorumlama eylemi (dosya:satir ayristirilir); nginx icin eylem yok', () => {
  const d = base();
  d.web.push({
    host: 'DACRWAP01',
    product: 'IHS',
    running: 0,
    syntax: 'FAIL',
    detail: "Syntax error on line 12 of /usr/IBMIHS/conf/httpd.conf: Invalid command 'Foo'",
  });
  d.web.push({
    host: 'DACRWAP01',
    product: 'NGINX',
    running: 1,
    syntax: 'FAIL',
    detail: 'nginx: [emerg] unknown directive',
  });
  const r = assess(d);
  const web = r.hosts.find((h) => h.host === 'DACRWAP01');
  const fails = web.findings.filter((f) => f.code === 'SYNTAX_FAIL');
  assert.equal(fails.length, 2);
  const ihs = fails.find((f) => f.text.startsWith('IHS'));
  assert.deepEqual(ihs.fix, {
    action: 'apache_comment_line',
    product: 'IHS',
    file: '/usr/IBMIHS/conf/httpd.conf',
    line: 12,
  });
  assert.equal(fails.find((f) => f.text.startsWith('NGINX')).fix, null);
  assert.equal(web.status, 'danger');
});

test('SH6: ozet sayilari', () => {
  const r = assess(base());
  assert.equal(r.summary.hosts.total, 2);
  assert.equal(r.summary.jvm.total, 3);
  assert.equal(r.summary.jvm.running, 2);
  assert.equal(r.summary.jvm.autoOff, 2);
  assert.equal(r.summary.jvm.rebootRisk, 1);
  assert.equal(r.summary.jvm.retireCandidates, 1);
  assert.equal(r.summary.jvm.restartRequired, 1);
  assert.equal(r.summary.init.compliant, 0);
  assert.equal(r.summary.init.diffFiles, 1);
  assert.equal(r.summary.web.RHA.vhosts, 2);
  assert.equal(r.summary.ips.unused, 1);
  assert.equal(r.summary.scan.maxCpuHost, 'DACRAAP01');
  assert.equal(r.latestScan, D);
});

test('SH7: kapali JVM web katmanina eslenemezse retire adayi DENMEZ (kanit yok)', () => {
  const d = base();
  d.vhosts = [];
  const r = assess(d);
  const app = r.hosts.find((h) => h.host === 'DACRAAP01');
  assert.ok(!app.findings.some((f) => f.code === 'RETIRE_CANDIDATE'));
  assert.ok(app.findings.some((f) => f.code === 'STOPPED'));
});

test('SH8: parseTargets host:port / ajp / IPv6 / bos', () => {
  assert.deepEqual(parseTargets('dacraap01.fw.local:8080, 10.1.1.5:8180'), [
    { host: 'DACRAAP01', port: 8080 },
    { host: '10.1.1.5', port: 8180 },
  ]);
  assert.deepEqual(parseTargets('app1_up'), [{ host: 'APP1_UP', port: null }]);
  assert.deepEqual(parseTargets(''), []);
});

// ── 2026-09-22 (job 3339002 sonrasi) ─────────────────────────────────────────────
test('SH9: init uyumu FILO COGUNLUGUNA gore (Denetim ile ayni): repo referansindan farkli ama cogunlukla ayni dosya bulgu DEGIL', () => {
  const d = base();
  d.hosts.push(
    { host: 'H2', scan_date: D, products: 'JBOSS7' },
    { host: 'H3', scan_date: D, products: 'JBOSS7' },
  );
  // start.sh: 3 sunucuda ayni sha 'A' ama repo referansi baska (hepsi DIFF geldi) -> cogunluk A, hepsi OK
  d.init = [
    { host: 'DACRAAP01', root: 'vhosting', file: 'start.sh', status: 'DIFF', sha512: 'A' },
    { host: 'H2', root: 'vhosting', file: 'start.sh', status: 'DIFF', sha512: 'A' },
    { host: 'H3', root: 'vhosting', file: 'start.sh', status: 'DIFF', sha512: 'A' },
    // functions.sh: 2 sunucu B (repo ile ayni), 1 sunucu C -> C cogunluktan farkli (DIFF), digerleri OK
    { host: 'DACRAAP01', root: 'vhosting', file: 'functions.sh', status: 'OK', sha512: 'B' },
    { host: 'H2', root: 'vhosting', file: 'functions.sh', status: 'OK', sha512: 'B' },
    { host: 'H3', root: 'vhosting', file: 'functions.sh', status: 'DIFF', sha512: 'C' },
    { host: 'H3', root: 'vhosting', file: 'startNginx.sh', status: 'MISSING', sha512: null },
  ];
  const r = assess(d);
  const h1 = r.hosts.find((h) => h.host === 'DACRAAP01'),
    h3 = r.hosts.find((h) => h.host === 'H3');
  assert.ok(
    !h1.findings.some((f) => f.code === 'INIT_DIFF'),
    'repo referansindan farkli ama cogunlukla ayni -> bulgu yok',
  );
  assert.equal(h1.init.find((i) => i.file === 'start.sh').status, 'OK');
  const f = h3.findings.find((x) => x.code === 'INIT_DIFF');
  assert.ok(f && /functions\.sh/.test(f.text) && /çoğunluk 2\/3/.test(f.text), f && f.text);
  assert.ok(h3.findings.some((x) => x.code === 'INIT_MISSING'));
  assert.equal(r.summary.init.compliant, 2, 'H1 ve H2 cogunlukla ayni');
  assert.equal(r.summary.init.diffFiles, 1);
  assert.equal(r.summary.init.missingFiles, 1);
  assert.deepEqual(
    r.summary.init.refDiffFiles,
    [{ file: 'vhosting/start.sh', hosts: 3 }],
    'cogunluk repo referansindan farkli -> bilgi',
  );
});

test('SH9b: appdomain.service sunucuya OZELDIR - warning degil, metrikleri bozmaz', () => {
  // Kullanici (2026-09-28): "sadece appdomain.service'in farkli olmasini warning olarak
  // algilamasin; standarta aykiri bir durummus gibi metrikleri bozsun istemiyorum.
  // Denetim kismindan bu konuyu ayrica inceleyecegim. Server Hub'i bozma."
  //
  // Dosya sunucunun KENDI JBoss kurulumunu tarif eder; farkli olmasi normaldir. Bilgi
  // GIZLENMEZ (info olarak durur) ama uyum sayimina girmez.
  const d = base();
  d.hosts.push({ host: 'H2', scan_date: D, products: 'JBOSS7' });
  d.init = [
    { host: 'DACRAAP01', root: 'systemd', file: 'appdomain.service', status: 'DIFF', sha512: 'X' },
    { host: 'H2', root: 'systemd', file: 'appdomain.service', status: 'DIFF', sha512: 'Y' },
    { host: 'DACRAAP01', root: 'vhosting', file: 'start.sh', status: 'OK', sha512: 'B' },
    { host: 'H2', root: 'vhosting', file: 'start.sh', status: 'OK', sha512: 'B' },
  ];
  const r = assess(d);
  const azinlik = r.hosts.find((h) =>
    h.init.some((i) => i.file === 'appdomain.service' && i.status === 'DIFF'),
  );
  assert.ok(azinlik, 'cogunluk disinda kalan sunucu yok - senaryo kurulamadi');
  assert.ok(
    !azinlik.findings.some((f) => f.code === 'INIT_DIFF'),
    'appdomain.service hala warning uretiyor',
  );
  const bilgi = azinlik.findings.find((f) => f.code === 'INIT_HOST_SPECIFIC');
  assert.ok(bilgi, 'fark tamamen GIZLENMIS - Denetim tarafinda bakilacak konu gorunmez oldu');
  assert.equal(bilgi.severity, 'info');
  // Metrikler: sunucuya ozel dosya uyumsuzluk saymaz.
  assert.equal(r.summary.init.diffFiles, 0, 'appdomain.service fark sayimina girmis');
  assert.equal(r.summary.initDiff === undefined || r.summary.initDiff === 0, true);
  assert.equal(
    r.summary.init.compliant,
    2,
    'appdomain.service yuzunden sunucular uyumsuz sayilmis',
  );
});

test('SH9c: NO_LOAD bulgusu HANGI LOGA dayandigini tasir; okunamayan log KANIT DEGIL', () => {
  // Kullanici (2026-09-28): "NO_LOAD bulgulari icin en son hangi log dosyasinin
  // okundugunu da gormek istiyorum." Bulgu metni en fazla iki vhost gosterip gerisini
  // "+3" diye kisiyordu; eksik kalan tam da bakilmasi gereken satir olabilirdi.
  const d = base();
  // crm CALISIYOR; iki vhost ona proxy'liyor. Biri okundu (7g=0), oteki OKUNAMADI.
  d.vhosts = [
    {
      host: 'DACRWAP01',
      product: 'RHA',
      listen: '10.1.1.13:443',
      server_name: 'crm.fw.local',
      aliases: '',
      access_log: '/l/crm',
      proxy_targets: 'dacraap01.fw.local:8080',
      req_24h: 0,
      req_7d: 0,
      hc_24h: 0,
      shared: 0,
      sampled: 0,
      conf_file: '/usr/apache/conf/vhosts.conf',
    },
    {
      host: 'DACRWAP01',
      product: 'RHA',
      listen: '10.1.1.15:443',
      server_name: 'crm2.fw.local',
      aliases: '',
      access_log: '/l/crm2',
      proxy_targets: 'dacraap01.fw.local:8080',
      req_24h: null,
      req_7d: null,
      hc_24h: null,
      shared: 0,
      sampled: 0,
      conf_file: '/usr/apache/conf/vhosts.conf',
    },
  ];
  const r = assess(d);
  const h = r.hosts.find((x) => x.host === 'DACRAAP01');
  const f = h.findings.find((x) => x.code === 'NO_LOAD');
  assert.ok(f, 'NO_LOAD bulgusu uretilmedi - senaryo kurulamadi');
  assert.ok(
    Array.isArray(f.logs) && f.logs.length === 2,
    'bulgu hangi loglara dayandigini tasimiyor',
  );
  assert.deepEqual(f.logs.map((l) => l.path).sort(), ['/l/crm', '/l/crm2']);
  const a = f.logs.find((l) => l.path === '/l/crm');
  const b = f.logs.find((l) => l.path === '/l/crm2');
  assert.equal(a.read, true);
  assert.equal(a.req7d, 0);
  // OKUNAMAYAN LOG "0 ISTEK" SAYILMAZ: aksi halde olculemeyen bir dosya, "yuk yok"
  // iddiasinin kaniti gibi gorunurdu.
  assert.equal(b.read, false, 'okunamayan log okunmus gibi isaretlenmis');
  assert.equal(b.req7d, null, 'okunamayan log 0 istek gibi yazilmis');
  assert.equal(f.scanDate, D, 'loglarin NE ZAMAN okundugu tasinmiyor');
});

test('SH9d: auto-start "bilinmiyor" SEBEBIYLE gelir; ucu ayri sayilir', () => {
  // Kullanici (2026-09-28): "JVM Auto-Start durumu icinde 1930 bilinmiyor durumunda
  // raporlamissin, nedir bunlar? neyi bilinmiyor olarak algiliyorsun". Uc apayri durum
  // tek kelimeye cikiyordu. "Bilinmiyor" hicbirinde "KAPALI" demek DEGILDIR.
  const d = base();
  d.jvms = [
    // CLI auto-start'i okuyamadi, envanterde de kayit yok.
    {
      host: 'DACRAAP01',
      gen: 7,
      jvm: 'cliyok',
      grp: 'g',
      running: 1,
      auto_start: '',
      server_state: 'running',
      ports: '8080',
    },
    // Envanterde kayit VAR ama autostarts alani celiskili.
    {
      host: 'DACRAAP01',
      gen: 7,
      jvm: 'celiskili',
      grp: 'g',
      running: 1,
      auto_start: '',
      server_state: 'running',
      ports: '8081',
    },
  ];
  d.mwApps = [
    {
      host: 'DACRAAP01',
      app: 'celiskili',
      domain: 'd1',
      status: 'running',
      autostarts: 'true false',
      jvm_count: 2,
    },
  ];
  const r = assess(d);
  const h = r.hosts.find((x) => x.host === 'DACRAAP01');
  const bulgular = h.findings.filter((f) => f.code === 'AUTOSTART_UNKNOWN');
  assert.equal(bulgular.length, 2, 'iki JVM de bilinmiyor olmali');
  const sebepler = bulgular.map((f) => f.autoStartReason).sort();
  assert.deepEqual(sebepler, ['cli-okunamadi', 'envanter-celiskili'], 'sebep tasinmiyor');
  // Metin de sebebi SOYLEMELI: "okunamadi" tek basina neyin okunamadigini anlatmiyor.
  assert.ok(
    bulgular.some((f) => /çelişkili/.test(f.text)),
    'bulgu metni sebebi anlatmiyor',
  );
  // Ozet kirilimi: tek sayi "neyi bilmiyoruz" sorusunu cevapsiz birakiyordu.
  assert.equal(r.summary.jvm.autoUnknown, 2);
  assert.equal(r.summary.jvm.autoUnknownBy['envanter-celiskili'], 1);
  assert.equal(r.summary.jvm.autoUnknownBy['cli-okunamadi'], 1);
  // "bilinmiyor" KAPALI sayilmamali - reboot riski uretmemeli.
  assert.ok(!h.findings.some((f) => f.code === 'REBOOT_RISK'), 'bilinmiyor, KAPALI gibi islenmis');
});

test('SH10: flattenFindings tum sunuculari tek listede, en agirdan hafife', () => {
  const { flattenFindings } = require('../assess.cjs');
  const r = assess(base());
  const rows = flattenFindings(r.hosts);
  assert.ok(rows.length > 3);
  assert.equal(rows[0].severity, 'danger');
  assert.ok(rows.every((x) => x.host && x.code && x.text && Array.isArray(x.products)));
  const sevOrder = rows.map((x) => ({ danger: 3, warning: 2, info: 1 })[x.severity]);
  assert.deepEqual(
    sevOrder,
    [...sevOrder].sort((a, b) => b - a),
  );
  assert.ok(rows.some((x) => x.code === 'SYNTAX_FAIL' || x.code === 'REBOOT_RISK'));
});

test("SH11: JVM gercegi dbo.MWAppsInventory ile birlesir - CLI auto-start bilmiyorsa envanter kazanir, CLI'da olmayan uygulama envanterden eklenir, celiski bulgusu", () => {
  const d = {
    hosts: [{ host: 'GBCJAP01', scan_date: D, products: 'JBOSS7' }],
    jvms: [
      {
        host: 'GBCJAP01',
        gen: 7,
        jvm: 'crm',
        grp: 'g',
        running: 1,
        auto_start: 'unknown',
        server_state: 'running',
        ports: '8080',
      },
      {
        host: 'GBCJAP01',
        gen: 7,
        jvm: 'odeme',
        grp: 'g',
        running: 1,
        auto_start: 'true',
        server_state: 'running',
        ports: '8180',
      },
    ],
    mwApps: [
      {
        host: 'GBCJAP01',
        app: 'crm',
        env: 'Production',
        status: 'running',
        jvm_count: 2,
        autostarts: 'true true',
      },
      {
        host: 'GBCJAP01',
        app: 'odeme',
        env: 'Production',
        status: 'stopped',
        jvm_count: 1,
        autostarts: 'false',
      },
      {
        host: 'GBCJAP01',
        app: 'batch',
        env: 'Production',
        status: 'stopped',
        jvm_count: 1,
        autostarts: 'false',
      },
    ],
    invEnv: [{ host: 'GBCJAP01', env: 'Production' }],
  };
  const h = assess(d).hosts[0];
  const crm = h.jvms.find((j) => j.name === 'crm');
  assert.equal(crm.autoStart, 'true', 'CLI bilmiyordu -> envanterden');
  assert.equal(crm.autoStartSource, 'envanter');
  assert.equal(crm.source, 'cli');
  const odeme = h.jvms.find((j) => j.name === 'odeme');
  assert.deepEqual(odeme.mismatch, [
    'durum: envanter stopped, tarama çalışıyor',
    'auto-start: envanter false, tarama true',
  ]);
  assert.ok(
    h.findings.some((f) => f.code === 'INV_MISMATCH' && /odeme/.test(f.text)),
    'celiski bulgusu',
  );
  const batch = h.jvms.find((j) => j.name === 'batch');
  assert.equal(batch.source, 'envanter');
  assert.equal(batch.running, false);
  assert.equal(batch.autoStart, 'false');
  assert.equal(h.invApps, 3);
});

test('SH12: ortam kirilimi (Production / Non-Production) ve kart -> bulgu gecisi sozlesmesi', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const d = {
    hosts: [
      { host: 'GBCJAP01', scan_date: D, products: 'JBOSS7' },
      { host: 'GBCJAT01', scan_date: D, products: 'JBOSS7' },
      { host: 'XX99', scan_date: D, products: 'NONE' },
    ],
    jvms: [
      {
        host: 'GBCJAP01',
        gen: 7,
        jvm: 'crm',
        grp: 'g',
        running: 1,
        auto_start: 'false',
        server_state: 'running',
        ports: '',
      },
    ],
    invEnv: [
      { host: 'GBCJAP01', env: 'Production' },
      { host: 'GBCJAT01', env: 'Test' },
    ],
  };
  const r = assess(d);
  assert.equal(r.hosts.find((h) => h.host === 'GBCJAP01').envGroup, 'Production');
  assert.equal(r.hosts.find((h) => h.host === 'GBCJAT01').envGroup, 'Non-Production');
  assert.equal(
    r.hosts.find((h) => h.host === 'XX99').envGroup,
    'Bilinmiyor',
    'envanterde ve ad kalibinda yoksa bilinmiyor',
  );
  assert.equal(r.summary.byEnv.Production.hosts, 1);
  assert.equal(r.summary.byEnv.Production.rebootRisk, 1);
  assert.equal(r.summary.byEnv['Non-Production'].hosts, 1);
  const { flattenFindings } = require('../assess.cjs');
  const rows = flattenFindings(r.hosts);
  assert.ok(rows.every((x) => x.envGroup));
  const page = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'ServerHubPage.tsx'),
    'utf8',
  );
  assert.ok(
    /onGoFindings\(\{ area: 'init' \}\)/.test(page) &&
      /onGoFindings\(\{ area: 'web', code: 'SYNTAX_FAIL', product: p \}\)/.test(page),
    'kartlar bulgu detayina gitmeli',
  );
  assert.ok(
    /Ortam kırılımı/.test(page) && /onGoFindings\(\{ envGroup: g \}\)/.test(page),
    'ortam kirilimi paneli',
  );
  // BICIMLENDIRICIDEN BAGIMSIZ: prettier imzayi cok satira bolunce bu iddia, kod
  // degismedigi halde kirmiziya donuyordu (bkz. server/util/guard-text.cjs).
  assert.ok(
    /function FindingsTab\(\s*\{\s*initial\b/.test(
      require('../../util/guard-text.cjs').flatten(page),
    ),
    'Bulgular sekmesi disaridan suzgec almali',
  );
});

// SH13 (2026-09-24, kullanici): GBEVM* / GBPRV* genel envanterden AYRI. Bu sunucular filo
// ortalamasini bozuyordu; taranmaya devam ederler, bulgulari durur, ama ozet ve ortam
// kirilimi onlari SAYMAZ ve ekranda ayri listelenirler.
test('SH13: GBEVM/GBPRV genel envanterden ayri - ozete girmez, bulgusu ve sunucusu durur', () => {
  const d = base();
  d.hosts.push({ host: 'GBEVM01', scan_date: D, products: 'RHA', wall_s: 1, cpu_s: 0.2 });
  d.hosts.push({ host: 'GBPRV77', scan_date: D, products: 'NGINX', wall_s: 1, cpu_s: 0.2 });
  d.ips.push({ host: 'GBEVM01', ip: '10.9.9.9', iface: 'eth0', used_by: 'none', is_primary: 0 });
  const r = assess(d);

  const genelSayisi = r.hosts.filter((h) => h.hostClass !== 'ozel').length;
  assert.equal(r.summary.hosts.total, genelSayisi, 'ozet yalniz genel envanteri saymali');
  assert.equal(r.summary.special.hosts, 2);
  assert.deepEqual(r.summary.special.byPrefix, { GBEVM: 1, GBPRV: 1 });

  // sunucular listede DURUR (ayrinti/tarama calissin diye), sinifi isaretli
  const ozel = r.hosts.find((h) => h.host === 'GBEVM01');
  assert.equal(ozel.hostClass, 'ozel');
  assert.ok(
    ozel.findings.some((f) => f.code === 'IP_UNUSED'),
    'ozel sunucunun bulgusu uretilmeli',
  );

  // ozet sayaclari ozel sunucunun bulgusunu SAYMAZ
  assert.equal(r.summary.ips.unused, 1, 'bosta IP sayisi yalniz genel envanterden');

  // ortam kirilimi de saymaz
  const toplamEnv = Object.values(r.summary.byEnv).reduce((a, b) => a + b.hosts, 0);
  assert.equal(toplamEnv, genelSayisi);
});

test('SH10: nginx sozdizimi OLCULEMEDI ile HATALI ayri raporlanir', () => {
  // Kullanici (2026-09-26): "nginx sozdizimi kismi halen hatali gozukuyor; www ile
  // yapiyorsun degil mi?" Tarama www ile kosuyor; sertifika ANAHTARLARI cogu sunucuda
  // 0400 root oldugu icin `nginx -t` yetki hatasiyla dusebiliyor. Bunu "sozdizimi hatali"
  // saymak YANLIS ALARM, hic gostermemek ise sunucuyu sorunsuz gibi gostermek olurdu.
  const d = base();
  d.web = [
    {
      host: 'DACRWAP01',
      product: 'NGINX',
      running: 1,
      syntax: 'UNKNOWN',
      detail: 'yetki (kosan: www) - dosya okunamadi, sozdizimi OLCULEMEDI',
    },
  ];
  const r = assess(d);
  const host = r.hosts.find((h) => h.host === 'DACRWAP01');
  const bulgular = (host.findings || []).filter((f) => f.code === 'SYNTAX_UNKNOWN');
  assert.equal(bulgular.length, 1, 'olculemedi bir bulgu uretmeli');
  assert.equal(bulgular[0].severity, 'info', 'olculemedi bir HATA degil, bilgidir');
  assert.ok(
    !(host.findings || []).some((f) => f.code === 'SYNTAX_FAIL'),
    'yetki hatasi FAIL sayilmamali',
  );
  assert.equal(r.summary.web.NGINX.syntaxUnknown, 1);
  assert.equal(r.summary.web.NGINX.syntaxFail, 0);
});

// ── KAPSAMA: ENVANTER vs TARAMA (KP1..KP5, 2026-10-01) ──────────────────────────────
//
// Kullanici: "envanterde kac JBoss oldugunu, ancak Server Hub'in kacina erisip veri
// cekebildigini; kac JVM oldugunu, Server Hub'in kac JVM'in bilgisini cekebildigini...
// aynisini Red Hat Apache, IBM Apache ve Nginx icin de. Inventory tablosunda 1800-1900
// kusur sunucu var, Server Hub playbook'undan su kadarina erisebildik gibi bir sey."
//
// NEDEN: bu ekranin butun sayilari TARANAN sunuculardan hesaplanir. Erisilemeyen sunucu
// hicbir bulgu uretmez - kapsama gorunmezse "sorun yok" ile "bakamadik" ayni okunur.
const KP_INV = [
  { host: 'GBAPP01', env: 'PROD', invProducts: ['JBOSS', 'NGINX'] },
  { host: 'GBAPP02', env: 'PROD', invProducts: ['JBOSS'] },
  { host: 'GBWEB01', env: 'PROD', invProducts: ['RHA'] },
  { host: 'GBWEB02', env: 'PROD', invProducts: ['IHS'] },
];
const KP_DATA = {
  hosts: [
    { host: 'GBAPP01', scan_date: '2026-10-01', products: 'JBOSS7 NGINX' },
    { host: 'GBWEB01', scan_date: '2026-10-01', products: 'RHA' },
    { host: 'GBEKSTRA', scan_date: '2026-10-01', products: 'NGINX' },
  ],
  init: [],
  jboss: [],
  jvms: [
    { host: 'GBAPP01', gen: 7, jvm: 'app1', running: 1, auto_start: 'true', server_state: 'running', ports: '' },
  ],
  web: [
    { host: 'GBAPP01', product: 'NGINX', running: 1, syntax: 'OK', detail: '' },
    { host: 'GBWEB01', product: 'RHA', running: 1, syntax: 'OK', detail: '' },
    { host: 'GBEKSTRA', product: 'NGINX', running: 1, syntax: 'OK', detail: '' },
  ],
  vhosts: [],
  ips: [],
  sshd: [],
  mwApps: [
    { host: 'GBAPP01', app: 'app1', env: 'PROD', status: 'running', jvm_count: 1, autostarts: 'true' },
    { host: 'GBAPP02', app: 'app2', env: 'PROD', status: 'running', jvm_count: 3, autostarts: 'true true false' },
  ],
  invEnv: KP_INV,
};

test('KP1 SUNUCU kapsamasi envanterin TAMAMINI payda alir', () => {
  const c = assess(KP_DATA).summary.scanCoverage;
  assert.equal(c.hosts.inventory, 4, 'envanterdeki tum sunucular sayilmiyor');
  assert.equal(c.hosts.scanned, 2, 'erisilen sunucu sayisi yanlis');
  assert.equal(c.hosts.missing, 2, 'erisilemeyen sayisi yanlis');
  // Envanterde olmayip taramada cikan GIZLENMEZ: envanterin eksik oldugunu gosterir.
  assert.equal(c.hosts.scannedNotInInventory, 1, 'envanter disi taranan sunucu sayilmiyor');
});

test('KP2 JBOSS kapsamasi JVM VERISI GELDI MI diye bakar ("urun kurulu" yetmez)', () => {
  const c = assess(KP_DATA).summary.scanCoverage;
  assert.equal(c.products.JBOSS.inventory, 2);
  assert.equal(c.products.JBOSS.scanned, 1, 'JVM verisi gelmeyen sunucu "cekildi" sayilmis');
  assert.deepEqual(c.products.JBOSS.missingHosts, ['GBAPP02'], 'erisilemeyen host listelenmiyor');
});

test('KP3 RHA / IHS / NGINX ayri ayri sayiliyor', () => {
  const c = assess(KP_DATA).summary.scanCoverage;
  assert.equal(c.products.RHA.inventory, 1);
  assert.equal(c.products.RHA.scanned, 1);
  assert.equal(c.products.IHS.inventory, 1);
  assert.equal(c.products.IHS.scanned, 0, 'hic taranmamis IHS "cekildi" sayilmis');
  assert.equal(c.products.NGINX.inventory, 1);
  assert.equal(c.products.NGINX.scanned, 1);
  assert.equal(c.products.NGINX.scannedNotInInventory, 1, 'envanter disi NGINX sayilmiyor');
});

test('KP4 JVM: envanter (MWAppsInventory) vs taramadan GELEN', () => {
  const c = assess(KP_DATA).summary.scanCoverage;
  assert.equal(c.jvm.inventory, 4, 'envanter JVM toplami yanlis (1 + 3)');
  assert.equal(c.jvm.scanned, 1, 'taramadan gelen JVM sayisi yanlis');
  // Envanterden TAMAMLANAN satirlar "cekildi" sayilmaz - odunc alinmis bilgidir.
  assert.equal(typeof c.jvm.fromInventory, 'number');
});

test('KP5 ESKI `coverage` alani EZILMEDI (ekranin urun kartlari ona bagli)', () => {
  const sm = assess(KP_DATA).summary;
  assert.ok(sm.coverage, 'eski coverage alani kaybolmus');
  assert.ok(sm.coverage.JBOSS, 'eski coverage urun kirilimi kaybolmus');
  // Iki alan FARKLI seyi olcer: eski yalniz TARANAN sunucular icinde bakar.
  assert.equal(sm.coverage.JBOSS.inventory, 1, 'eski coverage anlami degismis');
  assert.equal(sm.scanCoverage.products.JBOSS.inventory, 2, 'yeni kapsama envanterin tamamini almiyor');
});

test('KP6 ENVANTER SUTUNU YOKSA 0 degil BILINMIYOR (uretimde RHA boyle okundu)', () => {
  // dbo.Inventory'de `apache_version` da `httpd_version` da YOK. Kod olmayan sutunu
  // sessizce atiyordu, panel "envanterde 0 RHA var" diyordu ve tablo tutarsiz gorundu.
  // "Sutun yok" ile "envanterde yok" AYRI seylerdir.
  const c = assess({ ...KP_DATA, invProductUnknown: { RHA: true } }).summary.scanCoverage;
  assert.equal(c.products.RHA.inventoryUnknown, true, 'eksik sutun yukari tasinmiyor');
  // Olculebilen urunler ETKILENMEZ.
  assert.ok(!c.products.NGINX.inventoryUnknown);
  assert.ok(!c.products.JBOSS.inventoryUnknown);
});

test('KP7 envanter urun sutunlari GERCEK tablo sutunlariyla ayni', () => {
  // 2026-10-01'de uretimde olculdu: dbo.Inventory'de `apache_version` da `httpd_version`
  // da YOK, RHA sutunu `rha_version`. Yanlis sutun adi sessiz 0 uretir - bu bekci ad
  // degisirse yakalar.
  const idx = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'index.cjs'),
    'utf8',
  );
  const i = idx.indexOf('const PRODUCT_COLS = [');
  assert.ok(i > 0, 'PRODUCT_COLS bulunamadi');
  const blok = idx.slice(i, idx.indexOf('];', i));
  for (const [col, prod] of [
    ['nginx_version', 'NGINX'],
    ['ihs_version', 'IHS'],
    ['rha_version', 'RHA'],
    ['jboss_version', 'JBOSS'],
    ['was_version', 'WAS'],
  ]) {
    assert.ok(
      new RegExp(`col: '${col}', product: '${prod}'`).test(blok),
      `envanter sutun eslemesi eksik/yanlis: ${col} -> ${prod}`,
    );
  }
  // Var OLMAYAN sutunlar geri gelmesin: sessiz 0'in kaynagi buydu.
  for (const yok of ['apache_version', 'httpd_version']) {
    assert.ok(
      !new RegExp(`col: '${yok}'`).test(blok),
      `dbo.Inventory'de olmayan sutun geri gelmis: ${yok}`,
    );
  }
});

// ── ACILIS HAZIRLIGI (AH1..AH5, 2026-10-01) ─────────────────────────────────────────
//
// Kullanici: "Ben sana sunucu listesi verdigimde o sunucularin sorunsuz acilip
// acilmayacagini bana bir executive summary gibi vermeni istiyorum."
const { rebootReadiness, KOD_ANLAMI } = require('../reboot-readiness.cjs');

const AH_HOSTS = [
  { host: 'GBAPP01', scanDate: '2026-10-01', findings: [{ code: 'SYNTAX_FAIL', area: 'web', text: 'nginx -t FAIL' }] },
  { host: 'GBAPP02', scanDate: '2026-10-01', findings: [{ code: 'REBOOT_RISK', area: 'jvm', text: 'kosuyor, auto-start kapali' }] },
  { host: 'GBAPP03', scanDate: '2026-10-01', findings: [{ code: 'STOPPED_AUTOSTART_ON', area: 'jvm', text: 'kapali, auto-start acik' }] },
  { host: 'GBAPP04', scanDate: '2026-10-01', findings: [{ code: 'SYNTAX_UNKNOWN', area: 'web', text: 'yetki' }] },
  { host: 'GBAPP05', scanDate: '2026-10-01', findings: [{ code: 'VHOST_IDLE', area: 'web', text: 'atil vhost' }] },
];
const AH = () =>
  rebootReadiness(AH_HOSTS, ['gbapp01', 'GBAPP02', 'gbapp03', 'gbapp04', 'gbapp05', 'GBYOK99'], '2026-10-01');

test('AH1 TARANMAMIS sunucu "hazir" SAYILMAZ (en pahali yanlis)', () => {
  const r = AH();
  const yok = r.rows.find((x) => x.host === 'GBYOK99');
  assert.equal(yok.verdict, 'notScanned', 'taranmamis sunucu baska bir kovaya girmis');
  assert.equal(r.summary.ok, 1, 'taranmamis sunucu "hazir" sayilmis');
  assert.equal(r.summary.notScanned, 1);
  assert.match(yok.note, /taramada yok/i, 'sebep yazilmiyor');
});

test('AH2 ACILISI ENGELLEYEN bulgular "blocked" (sozdizimi / auto-start kapali)', () => {
  const r = AH();
  const by = Object.fromEntries(r.rows.map((x) => [x.host, x]));
  assert.equal(by.GBAPP01.verdict, 'blocked', 'sozdizimi hatasi acilisi engellemiyor sayilmis');
  assert.equal(by.GBAPP02.verdict, 'blocked', 'auto-start kapali kosan JVM engel sayilmamis');
  assert.equal(r.summary.blocked, 2);
});

test('AH3 OLCULEMEYEN, RISKTEN DAHA AGIR siralanir', () => {
  // Bilmedigimiz bir seyi, bildigimiz bir surprizden daha masum gostermek yanlis olurdu.
  const r = AH();
  const by = Object.fromEntries(r.rows.map((x) => [x.host, x]));
  assert.equal(by.GBAPP04.verdict, 'unknown');
  assert.equal(by.GBAPP03.verdict, 'risk');
  const sira = r.rows.map((x) => x.verdict);
  assert.ok(sira.indexOf('unknown') < sira.indexOf('risk'), 'olculemeyen riskin altina dusmus');
  assert.ok(sira.indexOf('blocked') < sira.indexOf('unknown'), 'engel en uste gelmemis');
});

test('AH4 ILGISIZ bulgular ozete GIRMEZ (atil vhost acilisi etkilemez)', () => {
  const r = AH();
  const by = Object.fromEntries(r.rows.map((x) => [x.host, x]));
  assert.equal(by.GBAPP05.verdict, 'ok', 'acilisla ilgisiz bulgu sunucuyu kirmizi yapmis');
  assert.equal(by.GBAPP05.reasons.length, 0);
  assert.ok(!KOD_ANLAMI.VHOST_IDLE, 'ilgisiz kod haritaya girmis');
  assert.ok(!KOD_ANLAMI.SSH_SESSIONS_NEAR, 'ilgisiz kod haritaya girmis');
});

test('AH5 sebepler sunucu adlariyla toplanir; uc SALT OKUNUR', () => {
  const r = AH();
  const sf = r.topReasons.find((t) => t.code === 'SYNTAX_FAIL');
  assert.ok(sf, 'sebep listesi uretilmiyor');
  assert.equal(sf.hostCount, 1);
  assert.deepEqual(sf.hosts, ['GBAPP01']);
  // Engeller once gelmeli: ozet okunurken ilk goze carpan sey en agir olani olsun.
  assert.equal(r.topReasons[0].tip, 'blocker');
  const idx = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'index.cjs'),
    'utf8',
  );
  const i = idx.indexOf("router.post('/reboot-readiness'");
  assert.ok(i > 0, 'uc yok');
  const blok = idx.slice(i, i + 1600);
  assert.ok(!/launch\(/.test(blok), 'SALT OKUNUR olmasi gereken uc is baslatiyor');
  assert.match(blok, /getAssessment\(false\)/, 'her istekte yeniden tarama tetikleniyor');
});
