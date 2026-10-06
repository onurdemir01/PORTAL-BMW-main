// server/nginx-console/__tests__/nginx-console.test.cjs — Nginx Hub (2026-09-19).
// NH1-NH4: dokum ayristirma (files/nginx_console_dump.sh sozlesmesi), agac, sertifika
// birlestirme (ayni parmak izi = tek satir, host/kullanim listesi), kalan gun.
// NH5-NH7: yol beyaz listesi, kayitlar (paths/seed/nav/route), push betigi sozlesmesi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDump, buildTree, aggregateCerts, daysLeft, cnOf } = require('../dump-parse.cjs');
const { ALLOWED_PATH_RE, HOST_RE, REGISTRY_KEYS } = require('../index.cjs');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SAMPLE = [
  '@@HOST GBNGXP40',
  '@@TIME 2026-09-19T10:00:00Z',
  '@@PREFIX /usr/nginx',
  '@@NGINX_T ok',
  'nginx: the configuration file /usr/nginx/nginx.conf syntax is ok',
  '@@END',
  '@@TREE',
  '181\t2026-09-19 12:00:00\taaa111\t/usr/nginx/conf.d/GLOMO-PROD.conf',
  '20\t2026-09-19 12:00:00\tbbb222\t/usr/nginx/conf.d/application-confs/glomo-x-y.conf',
  '999\t2026-09-19 12:00:00\tccc333\t/usr/nginx/conf/bmw_defaults.conf',
  '@@END',
  '@@FILE /usr/nginx/conf.d/GLOMO-PROD.conf aaa111 181',
  'server {',
  '  server_name glomo.garanti.com.tr;',
  '  ssl_certificate certs/glomo.crt;',
  '}',
  '@@END',
  '@@FILE /usr/nginx/conf.d/application-confs/glomo-x-y.conf bbb222 20',
  'proxy_pass http://x;',
  '@@END',
  '@@CERTUSE /usr/nginx/conf.d/GLOMO-PROD.conf\tglomo.garanti.com.tr\t/usr/nginx/certs/glomo.crt\t/usr/nginx/certs/glomo.key\tpresent',
  '@@CERT /usr/nginx/certs/glomo.crt',
  'exists=1',
  'sha256=deadbeef',
  'size=1200',
  'mtime=2026-01-01 00:00:00',
  'subject=CN=glomo.garanti.com.tr, O=GT',
  'issuer=CN=Garanti Internal CA, O=GT',
  'serial=01AB',
  'notBefore=Jan  1 00:00:00 2026 GMT',
  'notAfter=Oct 19 00:00:00 2026 GMT',
  'fingerprint=AA:BB:CC',
  'sigalg=sha256WithRSAEncryption',
  'keybits=2048',
  'san=glomo.garanti.com.tr,www.glomo.garanti.com.tr',
  'chain=2',
  'chain2=CN=Garanti Internal CA, O=GT',
  '@@END',
  '@@CERT /usr/nginx/certs/missing.crt',
  'exists=0',
  '@@END',
].join('\n');

test('NH1 parseDump: baslik, nginx -t, agac, dosya icerigi, sertifika kullanimi ve alanlari', () => {
  const d = parseDump(SAMPLE);
  assert.equal(d.host, 'GBNGXP40');
  assert.equal(d.nginxT.status, 'ok');
  assert.match(d.nginxT.output, /syntax is ok/);
  assert.equal(d.tree.length, 3);
  assert.equal(d.tree[0].sha256, 'aaa111');
  assert.equal(d.files.get('/usr/nginx/conf.d/GLOMO-PROD.conf').content.split('\n').length, 4);
  assert.equal(d.files.get('/usr/nginx/conf.d/application-confs/glomo-x-y.conf').size, 20);
  assert.equal(d.certUses.length, 1);
  assert.equal(d.certUses[0].keyState, 'present');
  const c = d.certs.get('/usr/nginx/certs/glomo.crt');
  assert.equal(c.cn, 'glomo.garanti.com.tr');
  assert.equal(c.issuerCn, 'Garanti Internal CA');
  assert.equal(c.notAfter, '2026-10-19T00:00:00.000Z');
  assert.deepEqual(c.san, ['glomo.garanti.com.tr', 'www.glomo.garanti.com.tr']);
  assert.equal(c.chain, 2);
  assert.deepEqual(c.chainSubjects, ['CN=Garanti Internal CA, O=GT']);
  assert.equal(c.selfSigned, false);
  assert.equal(d.certs.get('/usr/nginx/certs/missing.crt').exists, false);
});

test('NH2 buildTree: prefix altinda ic ice dizinler, dosyalar sirali', () => {
  const d = parseDump(SAMPLE);
  const t = buildTree(d.tree, d.prefix);
  assert.equal(t.path, '/usr/nginx');
  const names = t.dirs.map((x) => x.name);
  assert.deepEqual(names, ['conf', 'conf.d']);
  const confd = t.dirs.find((x) => x.name === 'conf.d');
  assert.deepEqual(
    confd.files.map((f) => f.name),
    ['GLOMO-PROD.conf'],
  );
  assert.equal(confd.dirs[0].name, 'application-confs');
  assert.equal(confd.dirs[0].files[0].path, '/usr/nginx/conf.d/application-confs/glomo-x-y.conf');
});

test('NH3 aggregateCerts: ayni parmak izi iki sunucuda TEK satir; hostCount/useCount; en yakin bitis once', () => {
  const d1 = parseDump(SAMPLE);
  const d2 = parseDump(SAMPLE.replace('@@HOST GBNGXP40', '@@HOST GBNGXP41'));
  const now = Date.parse('2026-09-19T00:00:00Z');
  const list = aggregateCerts([d1, d2], now);
  const glomo = list.find((c) => c.cn === 'glomo.garanti.com.tr');
  assert.ok(glomo);
  assert.equal(glomo.hostCount, 2);
  assert.equal(glomo.useCount, 2);
  assert.equal(glomo.daysLeft, 30);
  assert.deepEqual(
    glomo.hosts.map((h) => h.host),
    ['GBNGXP40', 'GBNGXP41'],
  );
  assert.equal(glomo.hosts[0].uses[0].serverName, 'glomo.garanti.com.tr');
  // eksik dosya host basina ayri (parmak izi yok)
  assert.equal(list.filter((c) => !c.exists).length, 2);
  // siralama: daysLeft null'lar sona
  assert.equal(list[0].cn, 'glomo.garanti.com.tr');
});

test('NH4 daysLeft / cnOf', () => {
  assert.equal(daysLeft('2026-09-21T00:00:00.000Z', Date.parse('2026-09-19T00:00:00Z')), 2);
  assert.equal(daysLeft('2026-09-17T00:00:00.000Z', Date.parse('2026-09-19T00:00:00Z')), -2);
  assert.equal(daysLeft(null), null);
  assert.equal(cnOf('C=TR, O=GT, CN=a.b.c'), 'a.b.c');
  assert.equal(cnOf('CN = x.y, O=GT'), 'x.y');
  assert.equal(cnOf(''), null);
});

test('NH5 yol beyaz listesi ve sunucu adi', () => {
  assert.ok(ALLOWED_PATH_RE.test('/usr/nginx/conf.d/application-confs/glomo-a-b.conf'));
  assert.ok(ALLOWED_PATH_RE.test('/usr/nginx/conf/bmw_defaults.conf'));
  assert.ok(!ALLOWED_PATH_RE.test('/usr/nginx/nginx.conf'));
  assert.ok(!ALLOWED_PATH_RE.test('/etc/passwd'));
  assert.ok(!ALLOWED_PATH_RE.test('/usr/nginx/conf.dx/a.conf'));
  assert.ok(HOST_RE.test('GBNGXP40') && !HOST_RE.test('a b') && !HOST_RE.test('../x'));
});

test('NH6 kayitlar: PLAYBOOKS, registry seed, sayfa elementi (Admin), nav, route, modul init', () => {
  const { PLAYBOOKS } = require('../../ansible/paths.cjs');
  assert.equal(PLAYBOOKS.nginxConsoleFetch, 'nginx_console/nginx_console_fetch.yml');
  assert.equal(PLAYBOOKS.nginxConsolePush, 'nginx_console/nginx_console_push.yml');
  for (const k of Object.values(REGISTRY_KEYS)) {
    assert.ok(
      fs.existsSync(
        path.join(
          ROOT,
          'server/ansible/bmw_portal',
          PLAYBOOKS[k === 'nginx_console_fetch' ? 'nginxConsoleFetch' : 'nginxConsolePush'],
        ),
      ),
      `${k} playbook dosyasi yok`,
    );
  }
  const setup = read('server/db/mssql-setup.cjs');
  assert.match(setup, /key_name: 'nginx_console_fetch'/);
  assert.match(setup, /key_name: 'nginx_console_push'/);
  assert.match(setup, /element_key: 'NginxConsole'[\s\S]{0,400}roles: \['Admin'\]/);
  assert.match(setup, /page_name: 'NginxConsole', roles: 'Admin'/);
  assert.match(
    read('src/config/elements.ts'),
    /id: 'NginxConsole', label: 'Nginx Hub', route: '\/nginx-console'/,
  );
  // 2026-09-19: kendi nav grubu (Envanter'den ayri) + nginx yesili lazer cerceve / parlayan Hub
  assert.match(
    read('src/config/elements.ts'),
    /id: 'nginxhub', label: 'Nginx Hub', itemIds: \['NginxConsole'\]/,
  );
  assert.match(setup, /element_key: 'navgroup:nginxhub'/);
  assert.match(setup, /parent_key = 'navgroup:nginxhub' WHERE element_key = 'NginxConsole'/);
  assert.match(read('src/components/layout/PageNav.tsx'), /nginx-hub-link/);
  const css = read('src/index.css');
  assert.match(css, /\.nginx-hub-link::before[\s\S]{0,600}conic-gradient\(from var\(--nh-angle\)/);
  assert.match(css, /--nginx-green:\s*#009639/); // marka rengi TOKEN (nav blogunda sabit hex yasak, bkz. pf6-palette D)
  assert.match(
    css,
    /prefers-reduced-motion: reduce\) \{\s*\.nginx-hub-link::before, \.nginx-hub-word \{ animation: none; \}/,
  );
  assert.match(read('src/App.tsx'), /PageVisibilityRoute pageId="NginxConsole"/);
  assert.match(read('server/index.cjs'), /nginx-console\/index\.cjs'\)\.initNginxConsole\(app\)/);
  // sunucu tarafi Admin kapisi
  assert.match(
    read('server/nginx-console/index.cjs'),
    /isAdmin\(req\) \? next\(\) : res\.status\(403\)/,
  );
});

test('NH7 push betigi sozlesmesi: beyaz liste, kilit, yedek, nginx -t geri alma, reload, RESULT satiri', () => {
  const sh = read('server/ansible/bmw_portal/nginx_console/files/nginx_console_push.sh');
  assert.match(sh, /"\$PREFIX\/conf\.d\/"\*\|"\$PREFIX\/conf\/"\*\)/);
  assert.match(sh, /deploy_lock_acquire/);
  assert.match(sh, /\.console_backup/);
  assert.match(sh, /-t 2>&1\)"; then/);
  assert.match(sh, /cp -p "\$bak" "\$CS_PATH"/); // geri alma
  assert.match(sh, /-s reload/);
  assert.match(sh, /echo "RESULT\|ok\|/);
  // dump betigi anahtar dosyalarini okumaz
  const dump = read('server/ansible/bmw_portal/nginx_console/files/nginx_console_dump.sh');
  assert.match(dump, /\*\.key\|\*\.pem_key\|\*private\*\) continue/);
  // playbook'lar: add_host ile hedef (AWX limit'e guvenilmez), www ile dzdo, GBLABT02 uzerinden /sw
  for (const f of ['nginx_console_fetch.yml', 'nginx_console_push.yml']) {
    const y = read('server/ansible/bmw_portal/nginx_console/' + f);
    assert.match(y, /ansible\.builtin\.add_host/);
    assert.match(y, /become_user: www/);
    assert.match(y, /delegate_to: GBLABT02/);
  }
});

// ── Gecmis (Git benzeri, 2026-09-19) ──────────────────────────────────────────────────
const os = require('node:os');
const history = require('../history.cjs');

test('NH8 blob deposu: icerik adresli, ayni sha bir kez yazilir, gecersiz sha reddedilir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-'));
  history.init({ consoleDir: () => dir, loadDump: () => null, listDumpedHosts: () => [] });
  const sha = 'a'.repeat(64);
  assert.equal(history.putBlob(sha, 'server {}'), true);
  assert.equal(history.putBlob(sha, 'server {}'), false, 'ikinci yazim atlanmali (dedup)');
  assert.equal(history.getBlob(sha), 'server {}');
  assert.equal(history.hasBlob(sha), true);
  assert.equal(history.putBlob('../etc/passwd', 'x'), false);
  assert.equal(history.getBlob('zz'), null);
  assert.ok(fs.existsSync(path.join(dir, 'objects', 'aa', sha)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('NH9 diffState: eklenen / degisen / silinen; degismeyen dosya HIC olay uretmez', () => {
  const prev = new Map([
    ['/usr/nginx/conf.d/a.conf', { sha256: '1', size: 1, mtime: 't' }],
    ['/usr/nginx/conf.d/b.conf', { sha256: '2', size: 1, mtime: 't' }],
    ['/usr/nginx/conf.d/gone.conf', { sha256: '3', size: 1, mtime: 't' }],
  ]);
  const tree = [
    { path: '/usr/nginx/conf.d/a.conf', sha256: '1', size: 1, mtime: 't' },
    { path: '/usr/nginx/conf.d/b.conf', sha256: '22', size: 2, mtime: 't2' },
    { path: '/usr/nginx/conf.d/new.conf', sha256: '9', size: 1, mtime: 't' },
  ];
  const d = history.diffState(prev, tree);
  assert.deepEqual(
    d.added.map((f) => f.path),
    ['/usr/nginx/conf.d/new.conf'],
  );
  assert.deepEqual(
    d.changed.map((f) => [f.path, f.oldSha, f.sha256]),
    [['/usr/nginx/conf.d/b.conf', '2', '22']],
  );
  assert.deepEqual(d.deleted, [{ path: '/usr/nginx/conf.d/gone.conf', oldSha: '3' }]);
});

test('NH10 agac satiri 5 alan (sahip) ve eski 4 alan ikisi de okunur', () => {
  const d5 = parseDump(
    '@@TREE\n10\t2026-01-01 00:00:00\tabc\twww\t/usr/nginx/conf.d/x y.conf\n@@END',
  );
  assert.deepEqual(d5.tree[0], {
    size: 10,
    mtime: '2026-01-01 00:00:00',
    sha256: 'abc',
    owner: 'www',
    path: '/usr/nginx/conf.d/x y.conf',
  });
  const d4 = parseDump('@@TREE\n10\t2026-01-01 00:00:00\tabc\t/usr/nginx/conf.d/x.conf\n@@END');
  assert.equal(d4.tree[0].owner, null);
  assert.equal(d4.tree[0].path, '/usr/nginx/conf.d/x.conf');
});

test("NH11 gecmis tablolari + indeksler seed'de; publish niyeti + ingest kaynak eslestirme sozlesmesi", () => {
  const setup = read('server/db/mssql-setup.cjs');
  assert.match(setup, /CREATE TABLE nginx_hub_file_state/);
  assert.match(setup, /CREATE TABLE nginx_hub_file_history/);
  assert.match(setup, /IX_nhh_host_path/);
  const idx = read('server/nginx-console/index.cjs');
  assert.match(idx, /history\.recordPublishIntent\(/);
  assert.match(idx, /history\.ingestDump\(parsed\)/);
  assert.match(idx, /router\.get\('\/history\/:host'/);
  assert.match(idx, /router\.get\('\/changes'/);
  assert.match(idx, /router\.get\('\/blob\/:sha'/);
  const h = read('server/nginx-console/history.cjs');
  // degismeyen dosya icin satir yazilmaz: yalniz added/changed/deleted olaylari INSERT eder
  assert.match(
    h,
    /for \(const f of added\)[\s\S]*for \(const f of changed\)[\s\S]*for \(const d of deleted\)/,
  );
  assert.match(h, /pending = 1 AND seen_at > DATEADD\(day, -7, GETUTCDATE\(\)\)/);
  const ui = read('src/components/nginx_console/NginxConsolePage.tsx');
  assert.match(ui, /function FileHistory\(/);
  assert.match(ui, /function ChangesTab\(/);
  assert.match(ui, /bu sürüme dön/);
});

// ── GERCEK SPA KESFI (GS1..GS6, 2026-10-01) ─────────────────────────────────────────
//
// Kullanici: "gercekten SPA olan tum uygulamalarin cekilmesi, route envanterinin
// karsilastirilmasi ve route'larinin yazilmasi, uygulama trafiginin de yanlarina
// islenmesi."
//
// EKRANIN SEBEBI: SPA'yi ADINDAN tanimak bir TAHMINDI (`-app-v`). Bu sayfa canli duruma
// bakar ve ad kalibinin KACIRDIKLARINI one cikarir.
const { buildSpaDiscovery } = require('../spa-discovery.cjs');

const D = (o) => ({
  cluster: 'gbocpprod1',
  namespace: 'sube-prod',
  route: 'r',
  host: 'h.apps',
  termination: '',
  workload_kind: 'Deployment',
  workload: 'app',
  is_spa: 0,
  signal: '',
  image: '',
  note: '',
  ...o,
});
const GS_DISC = [
  D({
    route: 'r1',
    host: 'a.apps',
    workload: 'sube-portali-app-v1',
    is_spa: 1,
    signal: 'nginx-start.sh',
  }),
  D({ route: 'r2', host: 'b.apps', workload: 'eski-portal', is_spa: 1, signal: 'image' }),
  D({ route: 'r3', host: 'c.apps', workload: 'java-app-v2', is_spa: 0 }),
  D({ route: 'r4', host: 'd.apps', workload_kind: '', workload: '', note: 'servis bulunamadi: x' }),
];
const GS_INV = [
  {
    cluster_name: 'gbocpprod1',
    namespace_name: 'sube-prod',
    route_name: 'r1',
    route_address: 'a.apps',
  },
];
const GS_USE = [
  {
    namespace: 'sube-prod',
    app: 'eski-portal',
    scan_date: '2026-10-01',
    window_days: 7,
    req_total: 1500,
    services_total: 2,
    measured: 1,
    note: '',
  },
];
const GS = () => buildSpaDiscovery(GS_DISC, GS_INV, GS_USE);

test('GS1 ad kalibinin KACIRDIGI gercek SPA isaretlenir ve EN USTE gelir', () => {
  const r = GS();
  assert.equal(r.summary.patternMiss, 1);
  assert.equal(r.rows[0].application, 'eski-portal', 'kacan uygulama listenin basinda degil');
  assert.equal(r.rows[0].patternMiss, true);
});

test('GS2 ada gore SPA ama kabinde nginx YOK ayri sayilir (yanlis pozitif)', () => {
  const r = GS();
  assert.equal(r.summary.patternFalse, 1);
  const j = r.rows.find((x) => x.application === 'java-app-v2');
  assert.equal(j.patternFalse, true);
  assert.equal(j.isSpa, false);
});

test('GS3 ROUTE ENVANTERI karsilastirilir (ad ya da adres uzerinden)', () => {
  const r = GS();
  const by = Object.fromEntries(r.rows.map((x) => [x.application, x]));
  assert.equal(by['sube-portali-app-v1'].inInventory, true, 'envanterdeki route bulunamadi');
  assert.equal(by['eski-portal'].inInventory, false);
  assert.equal(r.summary.spaNotInInventory, 1, 'envanterde olmayan SPA sayilmiyor');
});

test('GS4 TRAFIK yanina islenir; UC DURUM ayri kalir', () => {
  const r = GS();
  const by = Object.fromEntries(r.rows.map((x) => [x.application, x]));
  assert.equal(by['eski-portal'].reqShown, 1500);
  // Olcumu olmayan satira 0 YAZILMAZ - "istek yok" ile "olcum yok" ayri.
  assert.equal(by['sube-portali-app-v1'].reqShown, null);
  assert.equal(by['sube-portali-app-v1'].usage, null);
  assert.equal(r.summary.trafficActive, 1);
  assert.equal(r.summary.trafficNone, 1);
});

test('GS5 ESLESMEYEN route LISTEDE KALIR ve sebebi tasinir', () => {
  const r = GS();
  const e = r.rows.find((x) => x.note);
  assert.ok(e, 'eslesmeyen satir listeden dusmus - aranan uygulama o olabilir');
  assert.match(e.note, /servis bulunamadi/);
  assert.equal(r.summary.unmatched, 1);
  // "SPA degil" kovasina DA girmemeli: olculemeyeni olculmus gibi saymak yanlis olurdu.
  assert.equal(r.summary.notSpa, 1, 'eslesmeyen satir "SPA degil" diye sayilmis');
});

test('GS6 IKI SINYAL AYRI sayilir (biri otekinden zayif)', () => {
  const r = GS();
  assert.deepEqual(r.summary.bySignal, { 'nginx-start.sh': 1, image: 1 });
});

// ── SPA KESFI: ILK URETIM KOSUSUNUN DERSLERI (GS7..GS13, 2026-10-01) ─────────────────
//
// Job 3367728: yukleyici 4532 satir yazdi, ekran BOS gorundu. Uc sebep ust uste bindi:
//   - servis listesi cluster kapsaminda Forbidden -> 4532 route'un tamami "eslesmedi",
//   - 43 cluster'in 27'si hic veri uretmedi (login / Python 3.6) ama is yesildi,
//   - sayfa varsayilan "kacanlar" gorunumuyle aciliyor, SPA=0 iken o gorunum bos.
// Bu bekciler ekranin "olculemedi" ile "yok"u bir daha karistirmamasini kilitler.
const { normalize: gsNorm } = require('../../util/guard-text.cjs');

const GS_RUNS = [
  {
    cluster: 'gbocpprod1',
    durum: 'ok',
    routes: 4,
    svc_kip: 'namespace',
    svc_okunamayan_ns: 0,
    spa: 2,
    eslesmeyen: 1,
    sebep: '',
    scan_date: '2026-10-01',
  },
  {
    cluster: 'giocp3rdprod1',
    durum: 'login',
    routes: null,
    svc_kip: '',
    svc_okunamayan_ns: null,
    spa: null,
    eslesmeyen: null,
    sebep: 'oc login rc=1: Login failed',
    scan_date: '2026-10-01',
  },
  {
    cluster: 'gbocpqa1',
    durum: 'hata',
    routes: null,
    svc_kip: '',
    svc_okunamayan_ns: null,
    spa: null,
    eslesmeyen: null,
    sebep: 'kesif dustu: TypeError',
    scan_date: '2026-10-01',
  },
];
const GS_DISC2 = [
  ...GS_DISC.map((d) => ({
    ...d,
    scan_date: '2026-10-01',
    match_by: d.is_spa || d.workload === 'java-app-v2' ? 'selector' : '',
  })),
  // Dun taranmis, bugun taranamamis cluster: verisi DURUR ama ESKI diye isaretlenir.
  D({
    cluster: 'gbocpqa1',
    route: 'q1',
    workload: 'qa-portal',
    is_spa: 1,
    signal: 'image',
    scan_date: '2026-09-30',
    match_by: 'ad',
  }),
  D({
    cluster: 'gbocpqa1',
    route: 'q2',
    workload: '',
    workload_kind: '',
    note: 'servis okunamadi (yetki yok), ayni adli is yuku de yok: q2-svc',
    scan_date: '2026-09-30',
  }),
  // Durum kaydi OLMAYAN cluster (yukleyicinin eski surumu).
  D({ cluster: 'daocpprod1', route: 'z1', workload: 'z', is_spa: 0, scan_date: '2026-10-01' }),
];
const GS2 = () => buildSpaDiscovery(GS_DISC2, GS_INV, GS_USE, GS_RUNS);

test('GS7 TARANAMAYAN cluster "SPA yok" diye gorunmez; sebebi kapsamda yazar', () => {
  const k = GS2().coverage;
  assert.equal(k.measured, true);
  const by = Object.fromEntries(k.clusters.map((c) => [c.cluster, c]));
  assert.equal(by.giocp3rdprod1.status, 'login');
  assert.equal(by.giocp3rdprod1.noData, true, 'verisi olmayan cluster isaretlenmiyor');
  assert.match(by.giocp3rdprod1.reason, /Login failed/);
  assert.equal(k.failed, 2, 'login + hata taranamayan sayilmali');
  assert.equal(
    k.clusters[0].status === 'login' || k.clusters[0].status === 'hata',
    true,
    'sorunlu cluster en ustte degil',
  );
});

test('GS8 bugun taranamayan cluster DUNKU verisini korur ama ESKI diye isaretlenir', () => {
  const r = GS2();
  const q = r.rows.filter((x) => x.cluster === 'gbocpqa1');
  assert.equal(q.length, 2, 'taranamayan cluster in onceki verisi kayboldu');
  assert.equal(q[0].scanDate, '2026-09-30');
  const k = Object.fromEntries(r.coverage.clusters.map((c) => [c.cluster, c]));
  assert.equal(k.gbocpqa1.stale, true, 'eski veri ESKI diye isaretlenmiyor');
  assert.equal(k.gbocpqa1.dataDate, '2026-09-30');
});

test('GS9 durum kaydi olmayan cluster "ok" diye BOYANMAZ', () => {
  const k = Object.fromEntries(GS2().coverage.clusters.map((c) => [c.cluster, c]));
  assert.equal(k.daocpprod1.status, 'bilinmiyor');
  // Durum tablosu hic yoksa kapsam OLCULMEMISTIR - "0 taranamayan" demek yalan olurdu.
  assert.equal(buildSpaDiscovery(GS_DISC2, GS_INV, GS_USE, []).coverage.measured, false);
  assert.equal(buildSpaDiscovery(GS_DISC2, GS_INV, GS_USE).coverage.measured, false);
});

test('GS10 eslesmeme SEBEP KOVALARI ayri: "okunamadi" (yetki) != "bulunamadi" (bulgu)', () => {
  const s = GS2().summary;
  assert.equal(s.unmatchedReasons['servis bulunamadi'], 1);
  assert.equal(s.unmatchedReasons['servis okunamadi (yetki yok), ayni adli is yuku de yok'], 1);
});

test('GS11 eslesme KANITI satira ve ozete tasinir (ad eslesmesi daha zayif)', () => {
  const r = GS2();
  const q1 = r.rows.find((x) => x.route === 'q1');
  assert.equal(q1.matchBy, 'ad');
  assert.equal(r.summary.byMatch.ad, 1);
  assert.equal(r.summary.byMatch.selector, 3);
});

test('GS12 uc nokta CLUSTER BASINA en yeni taramayi okur; match_by yoksa da calisir', () => {
  const src = gsNorm(read('server/nginx-console/index.cjs'));
  // Tek MAX(scan_date) bugun login'i dusen cluster'in dunku verisini ekrandan siliyordu.
  assert.doesNotMatch(
    src,
    /FROM dbo\.BMW_Spa_Discovery WHERE scan_date = \(SELECT MAX\(scan_date\) FROM dbo\.BMW_Spa_Discovery\)/,
    'tek global MAX(scan_date) geri gelmis',
  );
  assert.match(
    src,
    /SELECT cluster, MAX\(scan_date\) AS sd FROM dbo\.BMW_Spa_Discovery GROUP BY cluster/,
  );
  assert.match(src, /COL_LENGTH\('dbo\.BMW_Spa_Discovery', 'match_by'\)/);
  assert.match(src, /CAST\(NULL AS NVARCHAR\(16\)\) AS match_by/, 'sutun yokken sorgu patlar');
  assert.match(src, /dbo\.BMW_Spa_Discovery_Run/);
  // 2026-10-01: besinci arguman RP kaynaklari (Nginx_Config_Audit/Intranet/Traffic/Upstreams);
  // durum tablosu (runs) yine dorduncu arguman olarak gecmeli.
  // 2026-10-06: ALTINCI arguman cluster katalogu (ocp_cluster_index) - uygulama basina
  // "4/4 Tam / 3/4 Kismi" oraninin PAYDASI. Elle cluster listesi olmasin diye katalogdan
  // okunur; gecilmezse oran "olculemedi" olur.
  assert.match(src, /buildSpaDiscovery\(disc, inv, usage, runs, rpKaynak, katalog\)/);
  // KATALOG DOGRU VERITABANINDAN: `ocp_cluster_index` PORTAL'IN kendi DB'sinde, bu
  // dosyadaki `query` ise ENVANTER (TBMWANS) baglantisi. Ilk yazimda katalog o sorguyla
  // okunuyordu, "invalid object name" ile dusuyor ve kapsam HER SATIRDA sessizce
  // "olculemedi" cikiyordu. Kanitlanmis erisimci (getClusterTree) kullanilmali.
  assert.match(
    src,
    /getClusterTree\(\)/,
    'kapsam paydasi katalogdan okunmuyor - elle cluster listesi uydurma olur',
  );
  assert.ok(
    !/FROM dbo\.ocp_cluster_index/.test(src),
    'katalog ENVANTER sorgusuyla okunuyor - o tablo Portal DB"sinde, sorgu sessizce duser',
  );
});

test('GS13 ekran bos gorunumun SEBEBINI soyler ve kapsami gosterir', () => {
  const ui = gsNorm(read('src/components/nginx_console/NginxSpaDiscovery.tsx'));
  assert.match(ui, /Hiçbir route bir iş yüküne eşlenemedi/, '"hepsi eslesmesiz" uyarisi yok');
  assert.match(ui, /Bu süzgeçlerle uygulama yok; toplam/, 'bos gorunum sebebini soylemiyor');
  assert.match(ui, /<Kapsam k=\{data\.coverage\} \/>/, 'kapsam paneli yok');
  assert.match(ui, /a\.weakEvidence &&/, 'ad eslesmesi (zayif kanit) satirda isaretlenmiyor');
});

test('GS14 kisitli kosu OTEKI cluster lari kirmiziya boyamaz; hedeflenip sonuc vermeyen ise TARANAMADI', () => {
  // Dusmanca dogrulama: "son kosuda yok" sezgisi, tek cluster a kosulan bir isten sonra
  // denenmemis 42 cluster i "erisilememis olabilir" diye kirmiziya boyuyordu. Artik
  // hedeflenip sonuc vermeyen cluster i YUKLEYICI 'erisilemedi' diye yazar; tahmin yok.
  const runs = [
    ...GS_RUNS,
    {
      cluster: 'gbocpdrcprod1',
      durum: 'ok',
      routes: 1,
      svc_kip: 'namespace',
      svc_okunamayan_ns: 0,
      spa: 1,
      eslesmeyen: 0,
      sebep: '',
      scan_date: '2026-09-30',
    },
    {
      cluster: 'gbocpprod2',
      durum: 'erisilemedi',
      routes: null,
      svc_kip: '',
      svc_okunamayan_ns: null,
      spa: null,
      eslesmeyen: null,
      sebep: "sonuc gelmedi: jump server'a erisilemedi ya da gorev kosmadi",
      scan_date: '2026-10-01',
    },
  ];
  const disc = [
    ...GS_DISC2,
    D({
      cluster: 'gbocpdrcprod1',
      route: 'x1',
      workload: 'x',
      is_spa: 1,
      signal: 'image',
      scan_date: '2026-09-30',
    }),
    D({
      cluster: 'gbocpprod2',
      route: 'y1',
      workload: 'y',
      is_spa: 1,
      signal: 'image',
      scan_date: '2026-09-29',
    }),
  ];
  const k = buildSpaDiscovery(disc, GS_INV, GS_USE, runs).coverage;
  const by = Object.fromEntries(k.clusters.map((c) => [c.cluster, c]));
  assert.equal(by.gbocpdrcprod1.bucket, 'onceki', 'kosuya girmeyen cluster yanlis kovada');
  assert.equal(by.gbocpdrcprod1.notInLastRun, true);
  assert.doesNotMatch(
    by.gbocpdrcprod1.reason,
    /erişilememiş|erisilememis/,
    'hedeflenmeyen cluster icin erisim tahmini yapiliyor',
  );
  assert.equal(
    by.gbocpprod2.bucket,
    'taranamadi',
    "yukleyicinin 'erisilemedi' kaydi taranamadi sayilmiyor",
  );
  assert.equal(by.gbocpprod2.stale, true);
  assert.equal(k.older, 1);
  assert.equal(k.failed, 3, 'login + hata + erisilemedi');
  // AYRIK KOVALAR: her cluster tek sayida.
  assert.equal(k.ok + k.older + k.partial + k.failed + k.unknown, k.total, 'kovalar ayrik degil');
  assert.equal(k.total, k.clusters.length);
});

test('GS15 basarisiz son kosu VERI YAZMAZ: ayni gunun satirlari da ESKI sayilir', () => {
  // Dusmanca dogrulama: ilk (hatali) kosuyla ayni gun yeniden kosulup login dusen cluster in
  // satirlari tarih esit oldugu icin "guncel" gorunuyordu.
  const runs = [
    { cluster: 'gbocpprod1', durum: 'login', sebep: 'Login failed', scan_date: '2026-10-01' },
  ];
  const disc = [D({ route: 'z', workload: 'z', scan_date: '2026-10-01' })];
  const c = buildSpaDiscovery(disc, GS_INV, GS_USE, runs).coverage.clusters[0];
  assert.equal(c.stale, true, 'ayni gun basarisiz kosunun gosterdigi veri guncel saniliyor');
  // VERI DURUMDAN YENI: yarim yukleme ya da durum yazilamamis -> bilinmiyor, 'guncel' DEGIL.
  const c2 = buildSpaDiscovery(
    [D({ route: 'z', workload: 'z', scan_date: '2026-10-02' })],
    GS_INV,
    GS_USE,
    [{ cluster: 'gbocpprod1', durum: 'ok', scan_date: '2026-10-01' }],
  ).coverage.clusters[0];
  assert.equal(c2.bucket, 'bilinmiyor', 'durum kaydindan yeni veri tam tarama sayiliyor');
  assert.match(c2.reason, /yarım kalmış olabilir/);
});

test('GS16 durum tablosu OKUNAMAZSA kapsam "bilinmiyor" der, uc nokta 500 e dusmez', () => {
  const k = buildSpaDiscovery(GS_DISC2, GS_INV, GS_USE, null).coverage;
  assert.equal(k.measured, false);
  assert.match(k.error, /okunamadı/);
  const src = gsNorm(read('server/nginx-console/index.cjs'));
  const i = src.indexOf('FROM dbo.BMW_Spa_Discovery_Run');
  assert.ok(i > 0, 'durum sorgusu bulunamadi');
  assert.ok(
    src.slice(i, i + 400).includes('.catch(() => null)'),
    'durum sorgusu hatasi tum uc noktayi dusuruyor',
  );
});

test('GS17 ekran: API hatasi "satir yok" gibi gorunmez; eksik taramada "kacirilan yok" NITELENIR', () => {
  const ui = gsNorm(read('src/components/nginx_console/NginxSpaDiscovery.tsx'));
  const var_ = (parca, mesaj) => assert.ok(ui.includes(parca), mesaj + ' :: ' + parca);
  var_('if (d && d.ok === false) { setHata(', 'ok:false cevabi veri gibi isleniyor');
  var_('SPA keşfi okunamadı: {hata}', 'hata ekranda gosterilmiyor');
  var_(') : eksikTarama ? (', '"kacirilan yok" cumlesi nitelenmiyor');
  var_('Taranabilen kısımda adı kurala uymayan SPA yok', 'nitelenmis cumle yok');
  var_("c.bucket !== 'guncel'", 'kapsam paneli ayrik kovaya gore listelemiyor');
});

// ── IKINCI DOGRULAMA TURU (GS18..GS21) ───────────────────────────────────────────────
test('GS18 route u SIFIRA inen ok cluster in eski satirlari GOSTERILMEZ', () => {
  const runs = [{ cluster: 'gbocpprod1', durum: 'ok', routes: 0, scan_date: '2026-10-02' }];
  const disc = [
    D({ route: 'eski', workload: 'eski-app', is_spa: 1, signal: 'image', scan_date: '2026-10-01' }),
  ];
  const r = buildSpaDiscovery(disc, GS_INV, GS_USE, runs);
  assert.equal(r.rows.length, 0, 'artik var olmayan route lar gosteriliyor');
  assert.equal(r.summary.spa, 0, 'olmayan uygulamalar ozete sayiliyor');
  // Ayni gunun (bugunku) satirlari ETKILENMEZ.
  const r2 = buildSpaDiscovery(
    [D({ route: 'yeni', scan_date: '2026-10-02' })],
    GS_INV,
    GS_USE,
    runs,
  );
  assert.equal(r2.rows.length, 1);
});

test('GS19-21 ekran: eski veri isareti kapsamdan; veri yokken "yok" denmez; hata tabloda da yazar', () => {
  const ui = gsNorm(read('src/components/nginx_console/NginxSpaDiscovery.tsx'));
  const var_ = (parca, mesaj) => assert.ok(ui.includes(parca), mesaj + ' :: ' + parca);
  var_('a.staleClusters.includes(c)', 'satir isareti kapsamdan (staleClusters) turetilmiyor');
  assert.ok(
    !ui.includes('scanDate < data.scanDate'),
    'satir isareti yine global en yeni tarihle karsilastiriyor',
  );
  var_('s.apps === 0 ? (', 'veri yokken "kacirilan yok" deniyor');
  var_('Keşif verisi yok.', 'veri yok cumlesi yok');
  var_('{hata ? (', 'hata varken tablo "satir yok" diyor');
  var_('Veri okunamadı — sebep yukarıda.', 'tablo hata metni yok');
});

// ── UYGULAMA BASINA TEK SATIR (GS22..GS27, 2026-10-01) ────────────────────────────────
//
// Kullanici: "her uygulama icin tek satir olsun; route adresleri ve cluster isimleri ayni
// satira yazilsin; is yuku kolonuna gerek yok; SPA, ad kalibi ve istek kolonlari onemli;
// 'kalip kacirdi' ne demek anlamadim; namespace okunamadi hatalari OpenShift'in default
// namespace'leri mi?"
const { uygulamalar: gsUyg, platformNamespace } = require('../spa-discovery.cjs');

test('GS22 ayni uygulama iki cluster da iki route la TEK satir; adresler ve cluster lar birlesik', () => {
  const disc = [
    D({
      cluster: 'gbocpprod1',
      route: 'web',
      host: 'web-p1.apps',
      workload: 'web-ui',
      is_spa: 1,
      signal: 'image',
    }),
    D({ cluster: 'gbocpprod2', route: 'web', host: 'web-p2.apps', workload: 'web-ui', is_spa: 0 }),
  ];
  const r = buildSpaDiscovery(disc, GS_INV, GS_USE, []);
  const a = r.apps.filter((x) => x.application === 'web-ui');
  assert.equal(a.length, 1, 'ayni uygulama birden cok satira bolunmus');
  assert.deepEqual(a[0].hosts, ['web-p1.apps', 'web-p2.apps']);
  assert.deepEqual(a[0].clusters, ['gbocpprod1', 'gbocpprod2']);
  assert.equal(a[0].spa, 'evet', 'bir route da bile nginx varsa uygulama SPA');
  assert.equal(r.appSummary.apps, r.apps.length);
});

test('GS23 SPA karari UC DURUMLU: hicbir route eslesmediyse "bilinmiyor", "hayir" DEGIL', () => {
  const r = buildSpaDiscovery(
    [
      D({
        route: 'x1',
        workload: '',
        workload_kind: '',
        note: 'servis okunamadi (yetki yok), ayni adli is yuku de yok: x1',
      }),
      D({ route: 'y1', workload: 'java-svc', is_spa: 0 }),
    ],
    GS_INV,
    GS_USE,
    [],
  );
  const by = Object.fromEntries(r.apps.map((a) => [a.application, a]));
  assert.equal(by.x1.spa, 'bilinmiyor', 'olculemeyen uygulama "SPA degil" diye gosteriliyor');
  assert.equal(by['java-svc'].spa, 'hayir');
  assert.equal(r.appSummary.unknown, 1);
});

test('GS24 OpenShift platform namespace leri kapsam disi ama SAYILIR', () => {
  for (const ns of [
    'openshift',
    'openshift-console',
    'openshift-monitoring',
    'kube-system',
    'default',
  ])
    assert.equal(platformNamespace(ns), true, ns);
  for (const ns of ['sube-prod', 'openshiftapp-prod', 'kubernetes-dash', 'mydefault'])
    assert.equal(platformNamespace(ns), false, `uygulama namespace i platform sayildi: ${ns}`);
  const r = buildSpaDiscovery(
    [
      D({
        namespace: 'openshift-console',
        route: 'console',
        workload: '',
        note: 'servis okunamadi (yetki yok), ayni adli is yuku de yok: console',
      }),
      D({
        namespace: 'openshift-monitoring',
        route: 'grafana',
        workload: '',
        note: 'servis okunamadi (yetki yok), ayni adli is yuku de yok: grafana',
      }),
      D({ route: 'r1', workload: 'app-1', is_spa: 1, signal: 'image' }),
    ],
    GS_INV,
    GS_USE,
    [],
  );
  assert.equal(r.apps.length, 1, 'platform route lari uygulama sayiliyor');
  assert.deepEqual(
    r.platformHidden,
    { routes: 2, namespaces: 2 },
    'atlanan platform route lari sayilmiyor',
  );
  assert.equal(r.summary.unmatched, 0, 'platform namespace lerinin "okunamadi" notu ozete giriyor');
});

test('GS25 istek DORT durumlu; envanter "kismen" route sayisiyla', () => {
  const use = [
    {
      namespace: 'sube-prod',
      app: 'a-var',
      scan_date: '2026-10-01',
      window_days: 7,
      req_total: 10,
      services_total: 1,
      measured: 1,
    },
    {
      namespace: 'sube-prod',
      app: 'a-yok',
      scan_date: '2026-10-01',
      window_days: 7,
      req_total: 0,
      services_total: 1,
      measured: 1,
    },
    {
      namespace: 'sube-prod',
      app: 'a-olcu',
      scan_date: '2026-10-01',
      window_days: 7,
      req_total: 0,
      services_total: 0,
      measured: 0,
      note: 'zaman asimi',
    },
  ];
  const inv = [
    {
      cluster_name: 'gbocpprod1',
      namespace_name: 'sube-prod',
      route_name: 'k1',
      route_address: 'k1.apps',
    },
  ];
  const r = buildSpaDiscovery(
    [
      D({ route: 'v', workload: 'a-var', is_spa: 1, signal: 'image' }),
      D({ route: 'y', workload: 'a-yok', is_spa: 1, signal: 'image' }),
      D({ route: 'o', workload: 'a-olcu', is_spa: 1, signal: 'image' }),
      D({ route: 'n', workload: 'a-none', is_spa: 1, signal: 'image' }),
      D({ route: 'k1', host: 'k1.apps', workload: 'a-kis', is_spa: 1, signal: 'image' }),
      D({ route: 'k2', host: 'k2.apps', workload: 'a-kis', is_spa: 1, signal: 'image' }),
    ],
    inv,
    use,
    [],
  );
  const by = Object.fromEntries(r.apps.map((a) => [a.application, a]));
  assert.equal(by['a-var'].istek, 'var');
  assert.equal(by['a-yok'].istek, 'yok');
  assert.equal(by['a-olcu'].istek, 'olculemedi', 'olculemedi "istek yok" sayiliyor');
  assert.equal(by['a-none'].istek, 'olcum-yok');
  assert.equal(by['a-kis'].inventory, 'kismen');
  assert.equal(by['a-kis'].invRoutes, 1);
  assert.equal(by['a-kis'].routeCount, 2);
});

test('GS26 uc nokta route satirlarini yalniz ?satir=1 ile gonderir (yanit boyutu)', () => {
  // 2026-10-01: govde spaYanitGovdesi ile kurulur (paylasilan hesap nesnesi DEGISTIRILMEZ;
  // eskiden `delete sonuc.rows` ayni anda ?satir=1 isteyen cagrinin satirlarini da siliyordu).
  const src = gsNorm(read('server/nginx-console/index.cjs'));
  assert.ok(
    src.includes(
      "res.json(spaYanitGovdesi(sonuc, { satir: String(req.query.satir || '') === '1' }));",
    ),
    'route satirlari her zaman gonderiliyor',
  );
  assert.ok(!src.includes('delete sonuc.rows'), 'paylasilan hesap nesnesi yerinde degistiriliyor');
  const { spaYanitGovdesi } = require('../spa-discovery.cjs');
  const sonuc = { ok: true, rows: [{ route: 'r' }], apps: [] };
  assert.ok(!('rows' in spaYanitGovdesi(sonuc)), '?satir=1 olmadan route satirlari govdede');
  assert.deepEqual(spaYanitGovdesi(sonuc, { satir: true }).rows, sonuc.rows);
  assert.deepEqual(sonuc.rows, [{ route: 'r' }], 'hesap nesnesi degisti');
});

test('GS27 ekran: tek satir duzeni (KOLONLAR), is yuku kolonu yok, "KALIP KACIRDI" rozeti yok, suzgecler bagli', () => {
  const ui = gsNorm(read('src/components/nginx_console/NginxSpaDiscovery.tsx'));
  const var_ = (parca, mesaj) => assert.ok(ui.includes(parca), mesaj + ' :: ' + parca);
  // KOLON SIRASI bicimden bagimsiz: prettier diziyi cok satira bolup sonuna virgul ekliyor
  // (ilk yazimda bu yuzden kirmiziya dondu); bosluk ve sondaki virgul yok sayilir.
  // 2026-10-01 (kullanici): 'Istek' -> 'Uygulama istegi' (Dynatrace oldugu ipucunda) ve
  // ayni tabloya Ag / Reverse proxy / RP istegi kolonlari eklendi. Bilerek degisen duzen.
  // 2026-10-03 (kullanici: "kolonlar cok genis gorunuyor, okumakta cok zorlaniyorum"):
  // duzen KOLONLAR tablosundan cizilir (baslik VE satir ayni gorunur listeden). Uygulama +
  // Namespace tek hucre, SPA + Ad kalibi tek hucre, 'Reverse proxy' ust basligi altinda
  // Ag / Tanim / Istek; Route envanteri, Adresler ve Cluster'lar gizlenebilir (varsayilan
  // gorunur). Bilerek degisen duzen. Ayni guvencenin DAVRANIS hali vitest'te
  // (NginxSpaDiscovery.test.tsx "kolon duzeni": baslik sirasi = her satirin hucre sirasi).
  const bas = ui.indexOf('const KOLONLAR: readonly KolonTanim[] = [');
  const son = ui.indexOf('];', bas);
  assert.ok(bas >= 0 && son > bas, 'KOLONLAR tablosu yok');
  // Her kolon nesnesi: id, baslik, grup, gizlenebilir. Deger tirnak icinde kesme isareti
  // tasiyabilir ("Cluster'lar" normalize sonrasi 'Cluster'lar'): tembel eslesme + virgul/son.
  const alan = (s, ad) => {
    const m = s.match(new RegExp(`(?:^|[\\s,])${ad}: '(.*?)'\\s*(?:,|$)`));
    return m ? m[1] : '';
  };
  const kolonlar = [...ui.slice(bas, son).matchAll(/\{([^{}]*)\}/g)].map((m) => [
    alan(m[1].trim(), 'id'),
    alan(m[1].trim(), 'baslik'),
    alan(m[1].trim(), 'grup'),
    /(?:^|[\s,])gizlenebilir: true/.test(m[1]),
  ]);
  assert.deepEqual(
    kolonlar,
    [
      ['uygulama', 'Uygulama', '', false],
      ['spa', 'SPA', '', false],
      ['istek', 'Uygulama isteği', '', false],
      ['ag', 'Ağ', 'rp', false],
      ['rp', 'Tanım', 'rp', false],
      ['rpIstek', 'İstek', 'rp', false],
      ['envanter', 'Route envanteri', '', true],
      ['adresler', 'Adresler', '', true],
      ['clusterlar', "Cluster'lar", '', true],
    ],
    'kolon duzeni beklenen sade duzende degil',
  );
  var_("const RP_GRUP_BASLIGI = 'Reverse proxy';", 'Reverse proxy ust basligi yok');
  // Baslik ve satir AYNI gorunur listeden; ayrinti ve bos sonuc satiri colSpan'i da oradan.
  // Sabit kolon sayisi geri gelirse gizli kolonda colSpan kayar.
  var_('<TabloBasligi gorunur={gorunur} />', 'baslik gorunur kolon listesinden cizilmiyor');
  var_(
    '{gorunur.map((id) => ( <td key={id} data-kolon={id}',
    'satir hucreleri gorunur kolon listesinden cizilmiyor',
  );
  assert.ok(
    ui.split('colSpan={gorunur.length}').length - 1 >= 2,
    'ayrinti / bos sonuc satiri colSpan gorunur kolon sayisindan degil',
  );
  assert.ok(!ui.includes('KOLON_SAYISI'), 'sabit kolon sayisi geri geldi');
  assert.ok(!ui.includes("'İş yükü'"), 'is yuku kolonu hala var');
  assert.ok(!ui.includes('KALIP KAÇIRDI'), 'anlasilmayan "KALIP KACIRDI" rozeti hala var');
  // HER SUZGEC: kutusu degiskene BAGLI (value + onChange) VE suzme mantiginda UYGULANIYOR.
  // Yalniz `setX(` aramak kordu: "suzgecleri temizle" de ayni setter'i cagiriyor, kutu
  // silinse bile test yesil kaliyordu (mutasyon T7).
  for (const [deg, set, kosul, ad] of [
    ['ns', 'setNs', "if (ns !== 'tumu' && a.namespace !== ns) return false;", 'namespace'],
    ['spa', 'setSpa', "if (spa !== 'tumu' && a.spa !== spa) return false;", 'SPA'],
    [
      'kalip',
      'setKalip',
      "if (kalip !== 'tumu' && a.pattern !== kalip) return false;",
      'ad kalibi',
    ],
    ['istek', 'setIstek', "if (istek !== 'tumu' && a.istek !== istek) return false;", 'istek'],
    ['ag', 'setAg', "if (ag !== 'tumu' && a.ag !== ag) return false;", 'ag'],
    ['rp', 'setRp', "if (rp !== 'tumu' && a.rp !== rp) return false;", 'reverse proxy'],
    [
      'rpIstek',
      'setRpIstek',
      "if (rpIstek !== 'tumu' && a.rpIstek !== rpIstek) return false;",
      'RP istegi',
    ],
    [
      'cluster',
      'setCluster',
      "if (cluster !== 'tumu' && !a.clusters.includes(cluster)) return false;",
      'cluster',
    ],
  ]) {
    var_(`value={${deg}} onChange={(e) => ${set}(`, `${ad} suzgec kutusu yok/bagli degil`);
    var_(kosul, `${ad} suzgeci satirlara uygulanmiyor`);
  }
  // ADRESLER VE CLUSTER'LAR AYNI SATIRDA (2026-10-03): ilk oge + '+N', tamami ipucunda ve
  // ayrinti panelinde (davranis: vitest '+N' testi).
  var_('const liste = a.hosts.length ? a.hosts : a.routes;', 'adresler (yoksa route) satirda yok');
  var_('<CokluDeger liste={liste}', 'adresler ayni satirda gosterilmiyor');
  var_('<CokluDeger liste={a.clusters}', 'cluster lar ayni satirda gosterilmiyor');
  var_('Bilinmiyor', 'olculemeyen SPA "bilinmiyor" diye gosterilmiyor');
});

// ── GS28 EKRAN CSS (dogrulama bulgulari, 2026-10-03) ─────────────────────────────────
// Gorsel olculer (yapisma, kirpma, kontrast) jsdom'da yok; tarayicida olculdu. Bu bekci,
// o olcumleri saglayan KURALLARIN index.css'te durdugunu ve token'lardan hesaplanan
// kontrastin AA'yi (4.5) gectigini soyler. Bicimden bagimsiz: yorumlar atilir, bosluklar
// tek bosluga iner; kural govdesi secici adiyla bulunur.
//   - kap yuksekligi sinirsizken yapiskan baslik HIC yapismiyordu (K11: max-height silinir);
//   - scroll-padding yokken Shift+Tab ile odaklanan satir dugmesi basligin ALTINDA kaliyordu
//     (WCAG 2.4.11; baslik Siki 48 px / Rahat 52 px olculdu);
//   - ikinci satir 11rem'de "..." ile kesilince ardindaki rozet HIC cizilmiyordu: satir
//     artik SARAR, yalniz .ng-kisa duz metni kisalir;
//   - adresin alan adi soneki kisalmaz (once uygulama-namespace oneki kisalir);
//   - ikincil metin --text-muted iken koyu temada 4.33 / zebra 3.92 / secili 3.11 idi.
test('GS28 ekran CSS: yapiskan baslik ve ilk kolon, kap siniri + klavye odagi, ikinci satir kirpmaz, ikincil metin kontrasti', () => {
  const css = read('src/index.css')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ');
  const govdeler = (sec) => {
    const l = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    // Secici, govdeden onceki son ';'ten sonrasidir (@import satiri ilk kurala yapismasin).
    while ((m = re.exec(css)))
      if (m[1].split(';').pop().split(',').some((s) => s.trim() === sec)) l.push(m[2]);
    return l;
  };
  const kural = (sec) => {
    const l = govdeler(sec);
    assert.ok(l.length, `kural yok: ${sec}`);
    return l.join(';');
  };
  // Ayni ozellik birden cok kez yazilmissa SONUNCUSU gecerli (cascade).
  const oz = (govde, ad) => {
    const l = [...govde.matchAll(new RegExp(`(?:^|;)\\s*${ad}\\s*:\\s*([^;]+)`, 'g'))];
    return l.length ? l[l.length - 1][1].trim() : null;
  };
  const px = (v) => {
    const m = String(v || '').match(/^([\d.]+)(rem|px)$/);
    return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : NaN;
  };

  // YAPISKAN BASLIK + ILK KOLON, KAP SINIRI, KLAVYE ODAGI
  const thead = kural('.ng-spa-tablo > thead');
  assert.equal(oz(thead, 'position'), 'sticky', 'baslik yapiskan degil');
  assert.equal(oz(thead, 'top'), '0', 'baslik ustte yapismiyor');
  const ilk = kural('.ng-spa-tablo .ng-yapiskan');
  assert.equal(oz(ilk, 'position'), 'sticky', 'ilk kolon yapiskan degil');
  assert.equal(oz(ilk, 'left'), '0', 'ilk kolon solda yapismiyor');
  const kap = kural('.ng-spa-kap');
  const mh = oz(kap, 'max-height');
  assert.ok(mh && mh !== 'none', 'kaydirma kabinin yuksekligi sinirsiz: baslik yapismaz');
  assert.ok(
    px(oz(kap, 'scroll-padding-top')) >= 52,
    'scroll-padding-top yapiskan basligin yuksekligini (Rahat 52 px) kapsamiyor: odak basligin altinda kalir',
  );

  // IKINCI SATIR: sarar, kirpmaz; yalniz duz metin kisalir
  const ik = kural('.ng-spa-tablo .ng-ikinci');
  assert.equal(oz(ik, 'flex-wrap'), 'wrap', 'ikinci satir sarmiyor: sigmayan rozet kaybolur');
  assert.equal(oz(ik, 'min-width'), 'min-content', 'genis tek rozet yan hucreye tasar');
  for (const yasak of ['overflow', 'overflow-x', 'text-overflow'])
    assert.equal(oz(ik, yasak), null, `ikinci satir yine kirpiyor (${yasak}): rozet "..." arkasinda kalir`);
  const kisa = kural('.ng-spa-tablo .ng-kisa');
  assert.equal(oz(kisa, 'text-overflow'), 'ellipsis', 'duz metin kisalmiyor');
  assert.equal(oz(kisa, 'overflow'), 'hidden', 'duz metin kisalmiyor');

  // ADRES: alan adi soneki kisalmaz; esneyen kolonun icerigi tabloyu genisletmez
  const son = kural('.ng-spa-tablo .ng-adres-son');
  assert.match(oz(son, 'flex') || '', /^0 0 /, 'alan adi soneki kisaliyor (flex-shrink 0 degil)');
  assert.equal(oz(kural('.ng-spa-tablo .ng-adresler'), 'contain'), 'inline-size', 'adres kolonu tabloyu genisletir');

  // KONTRAST: ikincil metin her satir zemininde (iki tema) >= 4.5
  const tokenlar = (sec) => {
    const t = {};
    for (const g of govdeler(sec))
      for (const m of g.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) t[m[1]] = m[2].trim();
    return t;
  };
  const ACIK = tokenlar(':root');
  const KOYU = { ...ACIK, ...tokenlar(':root[data-theme="dark"]') };
  const hex = (h) => {
    const s = h.replace('#', '');
    const t = s.length === 3 ? [...s].map((c) => c + c).join('') : s;
    assert.match(t, /^[0-9a-f]{6}$/i, `hex degil: ${h}`);
    return [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16));
  };
  const renk = (deger, tok) => {
    const v = deger.trim();
    const t = v.match(/^var\(--([\w-]+)\)$/);
    if (t) return renk(tok[t[1]] || assert.fail(`token yok: ${t[1]}`), tok);
    const c = v.match(/^color-mix\(in srgb, (.+?) ([\d.]+)%, (.+)\)$/);
    if (c) {
      const [a, b, p] = [renk(c[1], tok), renk(c[3], tok), Number(c[2]) / 100];
      return a.map((x, i) => x * p + b[i] * (1 - p));
    }
    return hex(v);
  };
  const L = (rgb) => {
    const [r, g, b] = rgb.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const oran = (a, b) => {
    const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const zemin = (sec) => oz(kural(sec), '--ng-zemin');
  const ZEMINLER = {
    normal: zemin('.ng-spa-tablo > tbody > tr.ng-satir'),
    zebra: zemin('.ng-spa-tablo > tbody > tr.ng-satir.ng-cizgili'),
    hover: zemin('.ng-spa-tablo > tbody > tr.ng-satir:hover'),
    secili: zemin('.ng-spa-tablo > tbody > tr.ng-satir.ng-secili'),
  };
  const baslikZemin = oz(kural('.ng-spa-tablo > thead > tr > th'), 'background');
  const olc = [
    ['.ng-spa-tablo .ng-ikinci', ZEMINLER],
    ['.ng-spa-tablo .ng-baslik-alt', { baslik: baslikZemin }],
  ];
  // Namespace satiri bilesende SOLUK; SOLUK'un token'i da ayni olcuye girer.
  const ui = gsNorm(read('src/components/nginx_console/NginxSpaDiscovery.tsx'));
  const soluk = ui.match(/const SOLUK = '([^']+)';/);
  assert.ok(soluk, 'SOLUK sabiti yok');
  for (const [tema, tok] of [
    ['acik', ACIK],
    ['koyu', KOYU],
  ]) {
    for (const [sec, zeminler] of olc) {
      const on = renk(oz(kural(sec), 'color'), tok);
      for (const [ad, z] of Object.entries(zeminler)) {
        const r = oran(on, renk(z, tok));
        assert.ok(r >= 4.5, `${tema} tema ${sec} / ${ad} zemin: kontrast ${r.toFixed(2)} < 4.5`);
      }
    }
    for (const [ad, z] of Object.entries(ZEMINLER)) {
      const r = oran(renk(soluk[1], tok), renk(z, tok));
      assert.ok(r >= 4.5, `${tema} tema SOLUK (namespace) / ${ad} zemin: kontrast ${r.toFixed(2)} < 4.5`);
    }
  }
});
