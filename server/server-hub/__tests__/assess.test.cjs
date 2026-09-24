// server/server-hub/__tests__/assess.test.cjs — SH1..SH8 (2026-09-21).
// Server Hub degerlendirmesi: JVM<->vhost eslemesi (proxy hedefi kesin, ad tahmini yedek),
// bulgu kodlari ve siddetleri, duzeltme eylemi parametreleri, ozet sayilari.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assess, parseTargets } = require('../assess.cjs');

const D = '2026-09-21';
const base = () => ({
  hosts: [{ host: 'DACRAAP01', scan_date: D, products: 'JBOSS7 RHA', wall_s: 4.2, cpu_s: 1.1 }, { host: 'DACRWAP01', scan_date: D, products: 'RHA', wall_s: 2, cpu_s: 0.5 }],
  init: [{ host: 'DACRAAP01', root: 'vhosting', file: 'start.sh', status: 'OK' }, { host: 'DACRAAP01', root: 'vhosting', file: 'functions.sh', status: 'DIFF' }],
  jboss: [{ host: 'DACRAAP01', gen: 7, host_name: 'master', host_state: 'running', cli: 'OK', note: '' }],
  jvms: [
    { host: 'DACRAAP01', gen: 7, jvm: 'crm', grp: 'g', running: 1, auto_start: 'false', server_state: 'running', ports: '8080,9990' },
    { host: 'DACRAAP01', gen: 7, jvm: 'oldapp', grp: 'g', running: 0, auto_start: 'false', server_state: 'stopped', ports: '' },
    { host: 'DACRAAP01', gen: 7, jvm: 'batch', grp: 'g', running: 1, auto_start: 'true', server_state: 'restart-required', ports: '8180' },
  ],
  web: [{ host: 'DACRWAP01', product: 'RHA', running: 1, syntax: 'OK', detail: '2 vhost' }],
  vhosts: [
    { host: 'DACRWAP01', product: 'RHA', listen: '10.1.1.13:443', server_name: 'crm.fw.local', aliases: '', access_log: '/l/crm', proxy_targets: 'dacraap01.fw.local:8080', req_24h: 50, req_7d: 900, hc_24h: 5, shared: 0, sampled: 0, conf_file: '/usr/apache/conf/vhosts.conf' },
    { host: 'DACRWAP01', product: 'RHA', listen: '10.1.1.14:443', server_name: 'oldapp.fw.local', aliases: '', access_log: '/l/old', proxy_targets: 'dacraap01:8280', req_24h: 0, req_7d: 0, hc_24h: 40, shared: 0, sampled: 0, conf_file: '/usr/apache/conf/old.conf' },
  ],
  ips: [{ host: 'DACRWAP01', ip: '10.1.1.13', iface: 'eth0', used_by: 'RHA', is_primary: 0 }, { host: 'DACRWAP01', ip: '10.1.1.99', iface: 'eth0', used_by: 'none', is_primary: 0 }, { host: 'DACRWAP01', ip: '10.1.1.10', iface: 'eth0', used_by: 'other', is_primary: 1 }],
});

test('SH1: proxy hedefi (host:port) ile JVM<->vhost kesin eslesir; trafik JVM\'e yazilir', () => {
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
  d.vhosts.push({ host: 'DACRWAP01', product: 'RHA', listen: '*:80', server_name: 'lonely.fw.local', aliases: '', access_log: '/l/lonely', proxy_targets: '', req_24h: 0, req_7d: 0, hc_24h: 0, shared: 0, sampled: 0, conf_file: '/usr/apache/conf/lonely.conf' });
  const r = assess(d);
  const web = r.hosts.find((h) => h.host === 'DACRWAP01');
  const codes = web.findings.map((f) => f.code);
  assert.ok(codes.includes('IP_UNUSED'));
  const idle = web.findings.filter((f) => f.code === 'VHOST_IDLE');
  assert.equal(idle.length, 1, 'oldapp vhost JVM\'e esli, idle bulgusu vermez; lonely verir');
  assert.deepEqual(idle[0].fix, { action: 'apache_retire_vhost', product: 'RHA', file: '/usr/apache/conf/lonely.conf', server_name: 'lonely.fw.local' });
  assert.equal(web.status, 'warning');
});

test('SH5: apache sozdizimi hatasi -> danger + satir yorumlama eylemi (dosya:satir ayristirilir); nginx icin eylem yok', () => {
  const d = base();
  d.web.push({ host: 'DACRWAP01', product: 'IHS', running: 0, syntax: 'FAIL', detail: "Syntax error on line 12 of /usr/IBMIHS/conf/httpd.conf: Invalid command 'Foo'" });
  d.web.push({ host: 'DACRWAP01', product: 'NGINX', running: 1, syntax: 'FAIL', detail: 'nginx: [emerg] unknown directive' });
  const r = assess(d);
  const web = r.hosts.find((h) => h.host === 'DACRWAP01');
  const fails = web.findings.filter((f) => f.code === 'SYNTAX_FAIL');
  assert.equal(fails.length, 2);
  const ihs = fails.find((f) => f.text.startsWith('IHS'));
  assert.deepEqual(ihs.fix, { action: 'apache_comment_line', product: 'IHS', file: '/usr/IBMIHS/conf/httpd.conf', line: 12 });
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
  assert.deepEqual(parseTargets('dacraap01.fw.local:8080, 10.1.1.5:8180'), [{ host: 'DACRAAP01', port: 8080 }, { host: '10.1.1.5', port: 8180 }]);
  assert.deepEqual(parseTargets('app1_up'), [{ host: 'APP1_UP', port: null }]);
  assert.deepEqual(parseTargets(''), []);
});

// ── 2026-09-22 (job 3339002 sonrasi) ─────────────────────────────────────────────
test('SH9: init uyumu FILO COGUNLUGUNA gore (Denetim ile ayni): repo referansindan farkli ama cogunlukla ayni dosya bulgu DEGIL', () => {
  const d = base();
  d.hosts.push({ host: 'H2', scan_date: D, products: 'JBOSS7' }, { host: 'H3', scan_date: D, products: 'JBOSS7' });
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
  const h1 = r.hosts.find((h) => h.host === 'DACRAAP01'), h3 = r.hosts.find((h) => h.host === 'H3');
  assert.ok(!h1.findings.some((f) => f.code === 'INIT_DIFF'), 'repo referansindan farkli ama cogunlukla ayni -> bulgu yok');
  assert.equal(h1.init.find((i) => i.file === 'start.sh').status, 'OK');
  const f = h3.findings.find((x) => x.code === 'INIT_DIFF');
  assert.ok(f && /functions\.sh/.test(f.text) && /çoğunluk 2\/3/.test(f.text), f && f.text);
  assert.ok(h3.findings.some((x) => x.code === 'INIT_MISSING'));
  assert.equal(r.summary.init.compliant, 2, 'H1 ve H2 cogunlukla ayni');
  assert.equal(r.summary.init.diffFiles, 1);
  assert.equal(r.summary.init.missingFiles, 1);
  assert.deepEqual(r.summary.init.refDiffFiles, [{ file: 'vhosting/start.sh', hosts: 3 }], 'cogunluk repo referansindan farkli -> bilgi');
});

test('SH10: flattenFindings tum sunuculari tek listede, en agirdan hafife', () => {
  const { flattenFindings } = require('../assess.cjs');
  const r = assess(base());
  const rows = flattenFindings(r.hosts);
  assert.ok(rows.length > 3);
  assert.equal(rows[0].severity, 'danger');
  assert.ok(rows.every((x) => x.host && x.code && x.text && Array.isArray(x.products)));
  const sevOrder = rows.map((x) => ({ danger: 3, warning: 2, info: 1 }[x.severity]));
  assert.deepEqual(sevOrder, [...sevOrder].sort((a, b) => b - a));
  assert.ok(rows.some((x) => x.code === 'SYNTAX_FAIL' || x.code === 'REBOOT_RISK'));
});

test('SH11: JVM gercegi dbo.MWAppsInventory ile birlesir - CLI auto-start bilmiyorsa envanter kazanir, CLI\'da olmayan uygulama envanterden eklenir, celiski bulgusu', () => {
  const d = {
    hosts: [{ host: 'GBCJAP01', scan_date: D, products: 'JBOSS7' }],
    jvms: [
      { host: 'GBCJAP01', gen: 7, jvm: 'crm', grp: 'g', running: 1, auto_start: 'unknown', server_state: 'running', ports: '8080' },
      { host: 'GBCJAP01', gen: 7, jvm: 'odeme', grp: 'g', running: 1, auto_start: 'true', server_state: 'running', ports: '8180' },
    ],
    mwApps: [
      { host: 'GBCJAP01', app: 'crm', env: 'Production', status: 'running', jvm_count: 2, autostarts: 'true true' },
      { host: 'GBCJAP01', app: 'odeme', env: 'Production', status: 'stopped', jvm_count: 1, autostarts: 'false' },
      { host: 'GBCJAP01', app: 'batch', env: 'Production', status: 'stopped', jvm_count: 1, autostarts: 'false' },
    ],
    invEnv: [{ host: 'GBCJAP01', env: 'Production' }],
  };
  const h = assess(d).hosts[0];
  const crm = h.jvms.find((j) => j.name === 'crm');
  assert.equal(crm.autoStart, 'true', 'CLI bilmiyordu -> envanterden');
  assert.equal(crm.autoStartSource, 'envanter');
  assert.equal(crm.source, 'cli');
  const odeme = h.jvms.find((j) => j.name === 'odeme');
  assert.deepEqual(odeme.mismatch, ['durum: envanter stopped, tarama çalışıyor', 'auto-start: envanter false, tarama true']);
  assert.ok(h.findings.some((f) => f.code === 'INV_MISMATCH' && /odeme/.test(f.text)), 'celiski bulgusu');
  const batch = h.jvms.find((j) => j.name === 'batch');
  assert.equal(batch.source, 'envanter'); assert.equal(batch.running, false); assert.equal(batch.autoStart, 'false');
  assert.equal(h.invApps, 3);
});

test('SH12: ortam kirilimi (Production / Non-Production) ve kart -> bulgu gecisi sozlesmesi', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const d = {
    hosts: [{ host: 'GBCJAP01', scan_date: D, products: 'JBOSS7' }, { host: 'GBCJAT01', scan_date: D, products: 'JBOSS7' }, { host: 'XX99', scan_date: D, products: 'NONE' }],
    jvms: [{ host: 'GBCJAP01', gen: 7, jvm: 'crm', grp: 'g', running: 1, auto_start: 'false', server_state: 'running', ports: '' }],
    invEnv: [{ host: 'GBCJAP01', env: 'Production' }, { host: 'GBCJAT01', env: 'Test' }],
  };
  const r = assess(d);
  assert.equal(r.hosts.find((h) => h.host === 'GBCJAP01').envGroup, 'Production');
  assert.equal(r.hosts.find((h) => h.host === 'GBCJAT01').envGroup, 'Non-Production');
  assert.equal(r.hosts.find((h) => h.host === 'XX99').envGroup, 'Bilinmiyor', 'envanterde ve ad kalibinda yoksa bilinmiyor');
  assert.equal(r.summary.byEnv.Production.hosts, 1);
  assert.equal(r.summary.byEnv.Production.rebootRisk, 1);
  assert.equal(r.summary.byEnv['Non-Production'].hosts, 1);
  const { flattenFindings } = require('../assess.cjs');
  const rows = flattenFindings(r.hosts);
  assert.ok(rows.every((x) => x.envGroup));
  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'ServerHubPage.tsx'), 'utf8');
  assert.ok(/onGoFindings\(\{ area: 'init' \}\)/.test(page) && /onGoFindings\(\{ area: 'web', code: 'SYNTAX_FAIL', product: p \}\)/.test(page), 'kartlar bulgu detayina gitmeli');
  assert.ok(/Ortam kırılımı/.test(page) && /onGoFindings\(\{ envGroup: g \}\)/.test(page), 'ortam kirilimi paneli');
  assert.ok(/function FindingsTab\(\{ initial \}/.test(page), 'Bulgular sekmesi disaridan suzgec almali');
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
  assert.ok(ozel.findings.some((f) => f.code === 'IP_UNUSED'), 'ozel sunucunun bulgusu uretilmeli');

  // ozet sayaclari ozel sunucunun bulgusunu SAYMAZ
  assert.equal(r.summary.ips.unused, 1, 'bosta IP sayisi yalniz genel envanterden');

  // ortam kirilimi de saymaz
  const toplamEnv = Object.values(r.summary.byEnv).reduce((a, b) => a + b.hosts, 0);
  assert.equal(toplamEnv, genelSayisi);
});
