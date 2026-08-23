// Sadece DOGRULAMA icin: gercek DB olmadan Denetim > Envanter Metrikleri ekranini
// tarayicida gorebilmek icin sahte veri sunan gecici sunucu. Repoya girmez.
const express = require('express');
const path = require('path');

const REPO = process.env.REPO;
const app = express();
app.use(express.json());

// ── Gercekci sahte veri ──────────────────────────────────────────────────────────────
const DOMAINS = ['fw.garanti.com.tr', 'dmz.garanti.com.tr', 'test.garanti.com.tr', 'qa.garanti.com.tr'];
const SUBNETS = ['10.20.30.0/24', '10.20.31.0/24', '10.40.12.0/24', '172.16.8.0/22', '10.55.1.0/24'];

const rnd = (n) => Math.floor(Math.random() * n);
function dist(values, total) {
  let left = total;
  return values.map((v, i) => {
    const n = i === values.length - 1 ? left : Math.max(1, Math.floor(left / (values.length - i) * (0.6 + Math.random())));
    left -= n;
    return { value: v, count: n, hosts: n };
  }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

const SUM = {
  hosts: {
    ok: true, source: 'hosts', label: 'Sunucular', unit: 'sunucu',
    totals: { rows: 1637, hosts: 1637, apps: 0, numerics: [
      { key: 'memory', label: 'toplam bellek (GB)', value: 42188 },
      { key: 'cpu', label: 'toplam vCPU', value: 9744 },
      { key: 'jvm_count', label: 'toplam JVM', value: 3120 },
    ] },
    dims: [
      { key: 'env', label: 'Ortam' }, { key: 'domain', label: 'Domain' }, { key: 'subnet', label: 'Subnet' },
      { key: 'os', label: 'İşletim sistemi' }, { key: 'os_version', label: 'OS sürümü' },
      { key: 'jboss_version', label: 'JBoss sürümü' }, { key: 'was_version', label: 'WAS sürümü' },
      { key: 'ihs_version', label: 'IHS sürümü' }, { key: 'rha_version', label: 'RHA sürümü' },
      { key: 'ctg_version', label: 'CTG sürümü' }, { key: 'nginx_version', label: 'Nginx sürümü' },
    ],
    products: [
      { key: 'jboss_version', label: 'JBoss', installed: 812, versionCount: 6,
        versions: dist(['7.4.14', '7.4.10', '8.0.2', '7.2.0', '6.4.22', '8.0.0'], 812) },
      { key: 'was_version', label: 'WAS', installed: 431, versionCount: 4,
        versions: dist(['9.0.5.14', '9.0.5.12', '8.5.5.24', '9.0.5.8'], 431) },
      { key: 'ihs_version', label: 'IHS', installed: 288, versionCount: 3,
        versions: dist(['9.0.5.14', '8.5.5.24', '9.0.5.10'], 288) },
      { key: 'nginx_version', label: 'Nginx', installed: 122, versionCount: 3,
        versions: dist(['1.24.0', '1.22.1', '1.20.2'], 122) },
      { key: 'ctg_version', label: 'CTG', installed: 64, versionCount: 2, versions: dist(['9.2.1', '9.1.0'], 64) },
      { key: 'rha_version', label: 'RHA', installed: 19, versionCount: 1, versions: dist(['2.4.6'], 19) },
    ],
    distributions: {
      env: dist(['Production', 'Test', 'QA', 'Development'], 1637),
      domain: dist(DOMAINS, 1637),
      subnet: dist(SUBNETS, 1637),
      os: dist(['Red Hat Enterprise Linux', 'SUSE Linux Enterprise'], 1637),
      os_version: dist(['8.9', '8.6', '9.2', '7.9', '15 SP4'], 1637),
      jboss_version: [...dist(['7.4.14', '7.4.10', '8.0.2', '7.2.0', '6.4.22', '8.0.0'], 812), { value: '(boş)', count: 825, hosts: 825 }].sort((a, b) => b.count - a.count),
      was_version: [...dist(['9.0.5.14', '9.0.5.12', '8.5.5.24', '9.0.5.8'], 431), { value: '(boş)', count: 1206, hosts: 1206 }].sort((a, b) => b.count - a.count),
      ihs_version: [...dist(['9.0.5.14', '8.5.5.24', '9.0.5.10'], 288), { value: '(boş)', count: 1349, hosts: 1349 }].sort((a, b) => b.count - a.count),
      rha_version: [{ value: '(boş)', count: 1618, hosts: 1618 }, { value: '2.4.6', count: 19, hosts: 19 }],
      ctg_version: [...dist(['9.2.1', '9.1.0'], 64), { value: '(boş)', count: 1573, hosts: 1573 }].sort((a, b) => b.count - a.count),
      nginx_version: [...dist(['1.24.0', '1.22.1', '1.20.2'], 122), { value: '(boş)', count: 1515, hosts: 1515 }].sort((a, b) => b.count - a.count),
    },
  },
  mw: {
    ok: true, source: 'mw', label: 'JBoss uygulamaları', unit: 'uygulama',
    totals: { rows: 4820, hosts: 812, apps: 1344, numerics: [{ key: 'jvm_count', label: 'toplam JVM', value: 2210 }] },
    dims: [
      { key: 'env', label: 'Ortam' }, { key: 'domain', label: 'Domain' },
      { key: 'jboss_version', label: 'JBoss sürümü' }, { key: 'jre_version', label: 'JRE sürümü' },
      { key: 'jdk_type', label: 'JDK türü' }, { key: 'os', label: 'İşletim sistemi' },
      { key: 'os_version', label: 'OS sürümü' }, { key: 'status', label: 'Durum' },
      { key: 'tier', label: 'Katman' }, { key: 'autostarts', label: 'Otomatik başlatma' },
      { key: 'deployed', label: 'Dağıtılmış' },
    ],
    products: [],
    distributions: {
      env: dist(['Production', 'Test', 'QA', 'Development'], 4820),
      domain: dist(DOMAINS, 4820),
      jboss_version: dist(['7.4.14', '7.4.10', '8.0.2', '7.2.0', '6.4.22'], 4820),
      jre_version: dist(['17.0.9', '11.0.21', '1.8.0_392', '21.0.1', '11.0.18'], 4820),
      jdk_type: dist(['OpenJDK', 'IBM Semeru', 'Oracle JDK'], 4820),
      os: dist(['Red Hat Enterprise Linux'], 4820),
      os_version: dist(['8.9', '8.6', '9.2', '7.9'], 4820),
      status: dist(['RUNNING', 'STOPPED', 'UNKNOWN'], 4820),
      tier: dist(['frontend', 'backend', 'batch'], 4820),
      autostarts: dist(['true', 'false'], 4820),
      deployed: dist(['true', 'false'], 4820),
    },
  },
  was: {
    ok: true, source: 'was', label: 'WAS uygulamaları', unit: 'uygulama',
    totals: { rows: 2140, hosts: 431, apps: 690, numerics: [] },
    dims: [
      { key: 'env', label: 'Ortam' }, { key: 'domain', label: 'Domain' },
      { key: 'was_version', label: 'WAS sürümü' }, { key: 'jre_version', label: 'JRE sürümü' },
      { key: 'jdk_type', label: 'JDK türü' }, { key: 'os', label: 'İşletim sistemi' },
      { key: 'os_version', label: 'OS sürümü' }, { key: 'status', label: 'Durum' },
    ],
    products: [],
    distributions: {
      env: dist(['Production', 'Test', 'QA'], 2140),
      domain: dist(DOMAINS, 2140),
      was_version: dist(['9.0.5.14', '9.0.5.12', '8.5.5.24'], 2140),
      jre_version: dist(['8.0.7.20', '8.0.8.5', '11.0.21'], 2140),
      jdk_type: dist(['IBM J9', 'IBM Semeru'], 2140),
      os: dist(['Red Hat Enterprise Linux'], 2140),
      os_version: dist(['8.9', '7.9'], 2140),
      status: dist(['STARTED', 'STOPPED'], 2140),
    },
  },
};

app.get('/api/denetim/envanter/summary', (req, res) => {
  res.json(SUM[req.query.source] || SUM.hosts);
});

app.get('/api/denetim/envanter/pivot', (req, res) => {
  const src = SUM[req.query.source] || SUM.hosts;
  const xk = req.query.x, yk = req.query.y;
  const label = (k) => (src.dims.find((d) => d.key === k) || {}).label || k;
  let xv = (src.distributions[xk] || []).map((r) => ({ value: r.value, count: r.count }));
  let yv = (src.distributions[yk] || []).map((r) => ({ value: r.value, count: r.count }));
  if (req.query.hideEmpty === '1') yv = yv.filter((r) => r.value !== '(boş)');
  const cells = {};
  let total = 0;
  for (const c of xv) for (const r of yv) {
    const n = rnd(Math.max(2, Math.floor(Math.min(c.count, r.count) / 3)));
    if (n) { cells[c.value + '\u0001' + r.value] = n; total += n; }
  }
  res.json({ ok: true, source: req.query.source, metric: req.query.metric,
    x: { key: xk, label: label(xk), values: xv }, y: { key: yk, label: label(yk), values: yv }, cells, total });
});

const cell=(st,extra)=>Object.assign({present:true,status:st,namespace:'digital-banking-ch-test',
  deployMode: st==='NOT_DEPLOYED'?'none':'namespaced',includeExists:st!=='BROKEN_INCLUDE',
  appDeployed:st!=='NOT_DEPLOYED',inOcpInventory:true,locationPath:'/base',
  hosts:['GBNGXT33','GBNGXT34']}, extra||{});
app.get('/api/denetim/nginx-spa', (_q, r) => r.json({ok:true,scanDate:'2026-08-23',availableDates:['2026-08-23'],
  services:['GLOMO'],envs:['DEV','TEST','QA','PROD'],
  envStats:[{env:'DEV',rows:2,hosts:['GBNGXD01'],vhosts:['GLOMO-DEV']},{env:'TEST',rows:4,hosts:['GBNGXT33'],vhosts:['GLOMO-TEST']},{env:'QA',rows:1,hosts:['GBNGXQ01'],vhosts:['GLOMO-QA']},{env:'PROD',rows:0,hosts:[],vhosts:[]}],
  rows:[
   {service:'GLOMO',application:'base-app-v0',envs:{DEV:cell('NOT_DEPLOYED'),TEST:cell('OK')}},
   {service:'GLOMO',application:'products-app-v0',envs:{TEST:cell('BROKEN_INCLUDE')}},
   {service:'GLOMO',application:'cso-react-app-v0',envs:{QA:cell('NOT_IN_INVENTORY',{inOcpInventory:false})}}]}));
app.get('/api/denetim/nginx-spa-coverage', (_q, r) => r.json({ok:true,platform:'ark',platforms:['ark'],
  clusters:['gbocptest1'],scanDate:'2026-08-23',spaPatternLabel:'-app-v / -app-emb-v',routeTableMissing:false,
  routeMatch:{address:700,name:20,ns:15,conflict:3,none:8},ocpNonSpaExcluded:1244,nginxOutsidePattern:[],ocpSkippedNoEnv:0,
  rows:[{env:'TEST',measured:true,internetTotal:100,internetInNginx:92,internetMissingCount:8,internetMissing:[],
    intranetTotal:40,intranetInNginx:0,intranetInNginxList:[],otherTotal:2,otherInNginx:0,unknownTotal:3,unknownInNginx:0,
    onlyNginxCount:1,onlyNginx:['x-app-v0'],coverage:92.0}]}));
app.get('/api/denetim/ocp-coverage', (_q, r) => r.json({ok:true,platform:'ark',platforms:['ark'],clusters:[],envs:['dev'],totalApplications:0,completeCount:0,skippedNoEnv:0,patterns:[],rows:[]}));
app.get('/api/denetim/init-scripts', (_q, r) => r.json({ok:true,root:'vhosting',roots:['vhosting'],hosts:0,scriptCount:0,identicalHosts:0,totalVariants:0,customHosts:0,missingColumns:[],scripts:[],hostRows:[]}));
app.get('/api/visibility/resolved', (_q, r) => { const v={}; for (const k of ['Dashboard','Envanter','Denetim','Admin']) v[k]=true; r.json({ok:true,ok_engine:true,version:1,visibility:v}); });
app.get('/api/visibility/version', (_q, r) => r.json({ok:true,version:1}));
app.get('/api/visibility/nav-groups', (_q, r) => r.json({ok:true,groups:[]}));
// Kimlik/gorunurluk: ekrani acabilmek icin yeterli asgari cevaplar
app.get('/api/auth/me', (_q, r) => r.json({ ok: true, authenticated: true, user: { username: 'demo', displayName: 'Demo', role: 'Admin', roles: ['Admin'] } }));
app.use('/api', (_q, r) => r.json({ ok: true, items: [], data: [], rows: [] }));

app.use(express.static(path.join(REPO, 'dist')));
app.use((_q, r) => r.sendFile(path.join(REPO, 'dist', 'index.html')));

app.listen(4599, () => console.log('mock http://localhost:4599'));
