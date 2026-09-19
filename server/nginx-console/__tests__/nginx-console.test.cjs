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
  '@@HOST GBNGXP40', '@@TIME 2026-09-19T10:00:00Z', '@@PREFIX /usr/nginx',
  '@@NGINX_T ok', 'nginx: the configuration file /usr/nginx/nginx.conf syntax is ok', '@@END',
  '@@TREE',
  '181\t2026-09-19 12:00:00\taaa111\t/usr/nginx/conf.d/GLOMO-PROD.conf',
  '20\t2026-09-19 12:00:00\tbbb222\t/usr/nginx/conf.d/application-confs/glomo-x-y.conf',
  '999\t2026-09-19 12:00:00\tccc333\t/usr/nginx/conf/bmw_defaults.conf',
  '@@END',
  '@@FILE /usr/nginx/conf.d/GLOMO-PROD.conf aaa111 181',
  'server {', '  server_name glomo.garanti.com.tr;', '  ssl_certificate certs/glomo.crt;', '}', '@@END',
  '@@FILE /usr/nginx/conf.d/application-confs/glomo-x-y.conf bbb222 20', 'proxy_pass http://x;', '@@END',
  '@@CERTUSE /usr/nginx/conf.d/GLOMO-PROD.conf\tglomo.garanti.com.tr\t/usr/nginx/certs/glomo.crt\t/usr/nginx/certs/glomo.key\tpresent',
  '@@CERT /usr/nginx/certs/glomo.crt',
  'exists=1', 'sha256=deadbeef', 'size=1200', 'mtime=2026-01-01 00:00:00',
  'subject=CN=glomo.garanti.com.tr, O=GT', 'issuer=CN=Garanti Internal CA, O=GT', 'serial=01AB',
  'notBefore=Jan  1 00:00:00 2026 GMT', 'notAfter=Oct 19 00:00:00 2026 GMT',
  'fingerprint=AA:BB:CC', 'sigalg=sha256WithRSAEncryption', 'keybits=2048', 'san=glomo.garanti.com.tr,www.glomo.garanti.com.tr', 'chain=2', 'chain2=CN=Garanti Internal CA, O=GT',
  '@@END',
  '@@CERT /usr/nginx/certs/missing.crt', 'exists=0', '@@END',
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
  assert.deepEqual(confd.files.map((f) => f.name), ['GLOMO-PROD.conf']);
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
  assert.deepEqual(glomo.hosts.map((h) => h.host), ['GBNGXP40', 'GBNGXP41']);
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
    assert.ok(fs.existsSync(path.join(ROOT, 'server/ansible/bmw_portal', PLAYBOOKS[k === 'nginx_console_fetch' ? 'nginxConsoleFetch' : 'nginxConsolePush'])), `${k} playbook dosyasi yok`);
  }
  const setup = read('server/db/mssql-setup.cjs');
  assert.match(setup, /key_name: 'nginx_console_fetch'/);
  assert.match(setup, /key_name: 'nginx_console_push'/);
  assert.match(setup, /element_key: 'NginxConsole'[\s\S]{0,400}roles: \['Admin'\]/);
  assert.match(setup, /page_name: 'NginxConsole', roles: 'Admin'/);
  assert.match(read('src/config/elements.ts'), /id: 'NginxConsole', label: 'Nginx Hub', route: '\/nginx-console'/);
  // 2026-09-19: kendi nav grubu (Envanter'den ayri) + nginx yesili lazer cerceve / parlayan Hub
  assert.match(read('src/config/elements.ts'), /id: 'nginxhub', label: 'Nginx Hub', itemIds: \['NginxConsole'\]/);
  assert.match(setup, /element_key: 'navgroup:nginxhub'/);
  assert.match(setup, /parent_key = 'navgroup:nginxhub' WHERE element_key = 'NginxConsole'/);
  assert.match(read('src/components/layout/PageNav.tsx'), /nginx-hub-link/);
  const css = read('src/index.css');
  assert.match(css, /\.nginx-hub-link::before[\s\S]{0,600}conic-gradient\(from var\(--nh-angle\)/);
  assert.match(css, /--nginx-green:\s*#009639/); // marka rengi TOKEN (nav blogunda sabit hex yasak, bkz. pf6-palette D)
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.nginx-hub-link::before, \.nginx-hub-word \{ animation: none; \}/);
  assert.match(read('src/App.tsx'), /PageVisibilityRoute pageId="NginxConsole"/);
  assert.match(read('server/index.cjs'), /nginx-console\/index\.cjs'\)\.initNginxConsole\(app\)/);
  // sunucu tarafi Admin kapisi
  assert.match(read('server/nginx-console/index.cjs'), /isAdmin\(req\) \? next\(\) : res\.status\(403\)/);
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
  assert.deepEqual(d.added.map((f) => f.path), ['/usr/nginx/conf.d/new.conf']);
  assert.deepEqual(d.changed.map((f) => [f.path, f.oldSha, f.sha256]), [['/usr/nginx/conf.d/b.conf', '2', '22']]);
  assert.deepEqual(d.deleted, [{ path: '/usr/nginx/conf.d/gone.conf', oldSha: '3' }]);
});

test('NH10 agac satiri 5 alan (sahip) ve eski 4 alan ikisi de okunur', () => {
  const d5 = parseDump('@@TREE\n10\t2026-01-01 00:00:00\tabc\twww\t/usr/nginx/conf.d/x y.conf\n@@END');
  assert.deepEqual(d5.tree[0], { size: 10, mtime: '2026-01-01 00:00:00', sha256: 'abc', owner: 'www', path: '/usr/nginx/conf.d/x y.conf' });
  const d4 = parseDump('@@TREE\n10\t2026-01-01 00:00:00\tabc\t/usr/nginx/conf.d/x.conf\n@@END');
  assert.equal(d4.tree[0].owner, null);
  assert.equal(d4.tree[0].path, '/usr/nginx/conf.d/x.conf');
});

test('NH11 gecmis tablolari + indeksler seed\'de; publish niyeti + ingest kaynak eslestirme sozlesmesi', () => {
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
  assert.match(h, /for \(const f of added\)[\s\S]*for \(const f of changed\)[\s\S]*for \(const d of deleted\)/);
  assert.match(h, /pending = 1 AND seen_at > DATEADD\(day, -7, GETUTCDATE\(\)\)/);
  const ui = read('src/components/nginx_console/NginxConsolePage.tsx');
  assert.match(ui, /function FileHistory\(/);
  assert.match(ui, /function ChangesTab\(/);
  assert.match(ui, /bu sürüme dön/);
});
