// server/nginx-console/__tests__/orphans.test.cjs — "Kullanilmayan" (2026-09-22).
//
// Kullanici: "sertifika hicbir konfigurasyonda kullanilmiyor ama listede." Dokum conf.d/conf
// altindaki HER dosyayi alir; nginx'in yukledigi (nginx -T) ayri. Dump @@LOADED + @@SSLDIR yazar,
// orphansOf yuklenmeyen conf / yedek / kullanilmayan sertifika / referanssiz ssl dosyasi cikarir.
// OR5: dump betigi sahte nginx + sahte dzdo ile Git Bash'te GERCEKTEN kosturulur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseDump, aggregateCerts, orphansOf, BACKUP_RE } = require('../dump-parse.cjs');

const DUMP = [
  '@@HOST GBNGXT01', '@@TIME 2026-09-22T10:00:00Z', '@@PREFIX /usr/nginx',
  '@@NGINX_T ok', 'syntax is ok', '@@END',
  '@@LOADED', '/usr/nginx/nginx.conf', '/usr/nginx/conf.d/A-TEST.conf', '/usr/nginx/conf/bmw_defaults.conf', '@@END',
  '@@SSLDIR',
  '100\t2026-01-01 00:00:00\t/usr/nginx/ssl/a.crt',
  '100\t2026-01-01 00:00:00\t/usr/nginx/ssl/a.key',
  '100\t2026-01-01 00:00:00\t/usr/nginx/ssl/old.crt',
  '100\t2026-01-01 00:00:00\t/usr/nginx/ssl/old.key',
  '@@END',
  '@@TREE',
  '10\t2026-01-01 00:00:00\tsha1\twww\t/usr/nginx/conf.d/A-TEST.conf',
  '10\t2026-01-01 00:00:00\tsha2\twww\t/usr/nginx/conf.d/A-TEST.conf_1234',
  '10\t2026-01-01 00:00:00\tsha3\twww\t/usr/nginx/conf.d/B-OLD.conf',
  '10\t2026-01-01 00:00:00\tsha4\twww\t/usr/nginx/conf.d/.console_backup/A-TEST.conf.20260901',
  '10\t2026-01-01 00:00:00\tsha5\twww\t/usr/nginx/conf/bmw_defaults.conf',
  '10\t2026-01-01 00:00:00\tsha6\twww\t/usr/nginx/conf/unused.conf.bak',
  '@@END',
  '@@CERTUSE /usr/nginx/conf.d/A-TEST.conf\ta.test\t/usr/nginx/ssl/a.crt\t/usr/nginx/ssl/a.key\tpresent',
  '@@CERTUSE /usr/nginx/conf.d/B-OLD.conf\tb.old\t/usr/nginx/ssl/b.crt\t/usr/nginx/ssl/b.key\tmissing',
  '@@CERT /usr/nginx/ssl/a.crt', 'exists=1', 'subject=CN=a.test', 'issuer=CN=CA', 'notAfter=Sep 19 18:46:18 2027 GMT', 'fingerprint=AA', '@@END',
  '@@CERT /usr/nginx/ssl/b.crt', 'exists=0', '@@END',
  '@@CERT /usr/nginx/ssl/old.crt', 'exists=1', 'subject=CN=old', 'issuer=CN=CA', 'notAfter=Sep 19 18:46:18 2025 GMT', 'fingerprint=OO', '@@END',
].join('\n');

function summaryOf(text) {
  const p = parseDump(text);
  return { host: p.host, nginxT: p.nginxT, tree: p.tree, certUses: p.certUses, certs: [...p.certs.values()], loaded: p.loaded, sslFiles: p.sslFiles };
}

test('OR1 parseDump: @@LOADED ve @@SSLDIR okunur; bolum yoksa loaded null', () => {
  const p = parseDump(DUMP);
  assert.deepEqual(p.loaded, ['/usr/nginx/nginx.conf', '/usr/nginx/conf.d/A-TEST.conf', '/usr/nginx/conf/bmw_defaults.conf']);
  assert.equal(p.sslFiles.length, 4);
  assert.equal(p.sslFiles[0].path, '/usr/nginx/ssl/a.crt');
  assert.equal(parseDump('@@HOST X\n@@NGINX_T ok\n@@END\n').loaded, null, 'eski dokum: loaded null');
});

test('OR2 orphansOf: yuklenmeyen conf, yedek kalibi, kullanilmayan sertifika, referanssiz ssl dosyasi', () => {
  const o = orphansOf(summaryOf(DUMP), new Date('2026-09-22T00:00:00Z').getTime());
  assert.equal(o.known, true);
  assert.deepEqual(o.unloaded.map((f) => f.path), ['/usr/nginx/conf.d/B-OLD.conf'], 'yuklenmeyen ve yedek olmayan tek dosya');
  // 2026-09-22 (kullanici: "yedek dosyalara bakma, cikti sisiyor"): yalniz *.conf degerlendirilir;
  // .console_backup/ altindaki .conf.<tarih> ve .conf_<job> / .conf.bak artik hic gelmez.
  assert.deepEqual(o.backups.map((f) => f.path).sort(), []);
  // a.crt yuklu conf'ta -> yok; b.crt yalniz B-OLD (yuklenmeyen) -> var; old.crt hic referanssiz -> var
  assert.deepEqual(o.certs.map((c) => c.path).sort(), ['/usr/nginx/ssl/b.crt', '/usr/nginx/ssl/old.crt']);
  const b = o.certs.find((c) => c.path.endsWith('b.crt'));
  assert.deepEqual(b.usedBy, ['/usr/nginx/conf.d/B-OLD.conf']);
  assert.equal(b.exists, false);
  const old = o.certs.find((c) => c.path.endsWith('old.crt'));
  assert.equal(old.cn, 'old'); assert.ok(old.daysLeft < 0, 'suresi dolmus'); assert.deepEqual(old.usedBy, []);
  // ssl: a.crt/a.key referansli (A-TEST yuklu), old.crt/old.key referanssiz
  assert.deepEqual(o.ssl.map((f) => f.path).sort(), ['/usr/nginx/ssl/old.crt', '/usr/nginx/ssl/old.key']);
  assert.equal(o.ssl.find((f) => f.path.endsWith('.key')).isKey, true);
});

test('OR3 orphansOf: eski dokum (loaded yok) ve nginx -T dusen sunucu "belirlenemedi"', () => {
  const s = summaryOf(DUMP);
  s.loaded = null;
  assert.equal(orphansOf(s).known, false);
  assert.match(orphansOf(s).reason, /eski dokum/);
  s.loaded = []; s.nginxT = { status: 'fail', output: '' };
  assert.equal(orphansOf(s).known, false);
  assert.match(orphansOf(s).reason, /nginx -T/);
});

test('OR4 aggregateCerts loadedUseCount: yalniz yuklu conf kullanimi; loaded bilinmiyorsa = useCount', () => {
  const p = parseDump(DUMP);
  const certs = aggregateCerts([{ host: 'GBNGXT01', certUses: p.certUses, certs: p.certs, loaded: p.loaded }]);
  const a = certs.find((c) => c.fingerprint === 'AA'); assert.equal(a.useCount, 1); assert.equal(a.loadedUseCount, 1);
  const b = certs.find((c) => !c.exists); assert.equal(b.useCount, 1); assert.equal(b.loadedUseCount, 0, 'yalniz yuklenmeyen dosyada');
  const o = certs.find((c) => c.fingerprint === 'OO'); assert.equal(o.useCount, 0); assert.equal(o.loadedUseCount, 0);
  const noInfo = aggregateCerts([{ host: 'X', certUses: p.certUses, certs: p.certs, loaded: null }]);
  assert.equal(noInfo.find((c) => !c.exists).loadedUseCount, 1, 'loaded bilinmiyorsa kullanim yuklu sayilir');
  assert.ok(BACKUP_RE.test('/usr/nginx/conf.d/X.conf_945') && BACKUP_RE.test('/x/y.conf.bak') && !BACKUP_RE.test('/usr/nginx/conf.d/A-TEST.conf'));
});

test('OR5 dump betigi (sahte nginx + dzdo): @@NGINX_T ok, @@LOADED nginx -T listesinden, @@SSLDIR, ssl/ sertifikasi @@CERT ile', () => {
  const r0 = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
  if (r0.status !== 0) { console.log('ATLANDI: bash yok'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncdump-')).replace(/\\/g, '/');
  const pfx = `${tmp}/nginx`;
  // Git Bash: betik icinde yollar POSIX (/c/Users/...) olmali; "C:/..." '/' ile baslamadigi icin
  // betik onu PREFIX'e gore goreli sayardi. fs cagrilari Windows yolunu kullanir.
  const pp = pfx.replace(/^([A-Za-z]):/, (_m, d) => '/' + d.toLowerCase());
  fs.mkdirSync(`${pfx}/sbin`, { recursive: true }); fs.mkdirSync(`${pfx}/conf.d`); fs.mkdirSync(`${pfx}/conf`); fs.mkdirSync(`${pfx}/ssl`); fs.mkdirSync(`${tmp}/bin`);
  fs.writeFileSync(`${pfx}/nginx.conf`, 'include conf.d/*.conf;\n');
  fs.writeFileSync(`${pfx}/conf.d/A.conf`, `server {\n  server_name a.test;\n  ssl_certificate ${pp}/ssl/a.crt;\n  ssl_certificate_key ${pp}/ssl/a.key;\n}\n`);
  fs.writeFileSync(`${pfx}/conf.d/B.conf_77`, 'server { server_name old; }\n');
  fs.writeFileSync(`${pfx}/ssl/a.crt`, 'X'); fs.writeFileSync(`${pfx}/ssl/a.key`, 'K'); fs.writeFileSync(`${pfx}/ssl/orphan.crt`, 'Y');
  // sahte nginx: -t -> ok; -T -> "# configuration file" satirlari; -e ve dzdo zorunlu
  fs.writeFileSync(`${pfx}/sbin/nginx`, `#!/bin/bash\ncase " $* " in *" -e "*) ;; *) echo "-e yok" >&2; exit 1;; esac\ncase " $* " in *" -T "*) echo "# configuration file ${pp}/nginx.conf:"; echo "x"; echo "# configuration file ${pp}/conf.d/A.conf:"; exit 0;; esac\necho "syntax is ok"; exit 0\n`);
  fs.writeFileSync(`${tmp}/bin/dzdo`, '#!/bin/bash\n[ "$1" = "-n" ] && shift\necho "DZDO" >> "$DZDO_LOG"\nexec "$@"\n');
  fs.writeFileSync(`${tmp}/bin/openssl`, '#!/bin/bash\necho "subject=CN=fake"; echo "issuer=CN=fake"; echo "notAfter=Sep 19 18:46:18 2027 GMT"; exit 0\n');
  fs.chmodSync(`${pfx}/sbin/nginx`, 0o755); fs.chmodSync(`${tmp}/bin/dzdo`, 0o755); fs.chmodSync(`${tmp}/bin/openssl`, 0o755);
  const script = path.join(__dirname, '..', '..', 'ansible', 'bmw_portal', 'nginx_console', 'files', 'nginx_console_dump.sh');
  const r = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${tmp}/bin:${process.env.PATH}`, NGINX_PREFIX: pp, NGINX_ERRLOG: `${tmp}/error.log`, DZDO_LOG: `${tmp}/dzdo.log` } });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.ok(out.includes('@@NGINX_T ok'), 'nginx -t ok olmali:\n' + out.slice(0, 400));
  assert.ok(fs.existsSync(`${tmp}/dzdo.log`), 'nginx dzdo ile kosmali');
  const p = parseDump(out);
  assert.deepEqual(p.loaded, [`${pp}/conf.d/A.conf`, `${pp}/nginx.conf`], 'yuklenen liste nginx -T ciktisindan');
  assert.deepEqual(p.sslFiles.map((f) => f.path).sort(), [`${pp}/ssl/a.crt`, `${pp}/ssl/a.key`, `${pp}/ssl/orphan.crt`], 'ssl/ dizini ayri bolum: .conf filtresi burada uygulanmaz');
  assert.ok(!p.tree.some((f) => /\.conf_77$/.test(f.path)), 'yedek dosya agacta yok (*.conf filtresi)');
  assert.ok(p.certs.has(`${pp}/ssl/orphan.crt`), 'ssl/ altindaki referanssiz sertifika da @@CERT ile gelmeli');
  assert.ok(!p.certs.has(`${pp}/ssl/a.key`), 'anahtar asla sertifika gibi okunmaz');
  const o = orphansOf({ host: 'T', nginxT: p.nginxT, tree: p.tree, certUses: p.certUses, certs: [...p.certs.values()], loaded: p.loaded, sslFiles: p.sslFiles });
  assert.deepEqual(o.backups.map((f) => f.path), [], 'yedek dosya (.conf degil) dokuma girmez');
  assert.deepEqual(o.certs.map((c) => c.path), [`${pp}/ssl/orphan.crt`]);
  assert.deepEqual(o.ssl.map((f) => f.path), [`${pp}/ssl/orphan.crt`]);
});

test('OR6 UI/uc sozlesmesi: /orphans ucu, Kullanilmayan sekmesi, Sertifikalar "kullanilmayan" filtresi', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.ok(idx.includes("router.get('/orphans'") && idx.includes('orphansOf(sm, now)'), '/orphans ucu');
  assert.ok(/unused: certs\.filter\(\(c\) => c\.loadedUseCount === 0\)/.test(idx), '/certs summary.unused');
  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'NginxConsolePage.tsx'), 'utf8');
  assert.ok(/\{tab === 'orphans' && <OrphansTab/.test(page) && page.includes("label: 'Kullanılmayan'"), 'Kullanilmayan sekmesi');
  assert.ok(page.includes("['unused', 'Kullanılmayan']") && /only === 'unused'/.test(page), 'Sertifikalar kullanilmayan filtresi');
  const tab = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'OrphansTab.tsx'), 'utf8');
  assert.ok(!/confirm\(|alert\(/.test(tab), 'tarayici popup yok');
  assert.ok(/title=\{path\}/.test(tab) && /title=\{c\.path\}/.test(tab), 'kirpilan yollarda title');
});
