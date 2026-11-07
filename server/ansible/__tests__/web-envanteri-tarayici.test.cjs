// server/ansible/__tests__/web-envanteri-tarayici.test.cjs — Uygulama Envanteri FAZ W: web katmani tarayicisi.
//
// files/web_tara.py GERCEK python3 ile gecici agaclarda kosar (hedefteki gibi `python3 -B -`, STDIN).
// /proc, `ip -o addr show` ve "simdi" test icin ortam degiskeniyle verilir (EAR_WEB_PROC, EAR_WEB_IP_DOSYA,
// EAR_WEB_SIMDI). Olculenler:
//   WT1  IHS + mod_jk: Include conf.d/*.conf, VirtualHost, ServerName / Alias, JkMount + workers.properties
//        (ajp13 host:port, lb balance_workers, reference), JkMountFile; ps'ten ServerRoot / -D tanimlari
//   WT2  RHA + mod_proxy / mod_cluster: ProxyPass balancer:// + <Proxy> BalancerMember; Location icindeki
//        ProxyPass; RewriteRule [P]; tanimsiz balancer + mod_cluster yuklu -> 'mc'; MCMP vhost'u; Define
//   WT3  WAS eklentisi: WebSpherePluginConfig -> plugin-cfg.xml (cluster / server / transport, UriGroup,
//        VirtualHostGroup, Route, Log); DOCTYPE / ENTITY reddedilir
//   WT4  config hatalari: eksik Include (joker / jokersiz), IncludeOptional sessiz, dongu, IfModule karari,
//        IfDefine: ps gorunur + tanim yok -> blok atlanir; ps gorunmez -> islenir ama BELIRSIZ
//   WT5  soketler (/proc/net/tcp{,6} LISTEN) ve IP'ler (`ip -o addr show`); ip yoksa OLCULEMEDI
//   WT6  access log: gercek / hc / statik, 24s / 7g, durum siniflari, son gercek, kapsama, hc istemcileri,
//        donmus .gz, rotatelogs borusu, paylasilan / miras log; kisa log penceresi -> KISMI; butce -> KISMI;
//        LogFormat farkli -> OLCULEMEDI (asla "0 istek" degil)
//   WT7  error_log / JkLogFile / WAS eklenti logu: arka uca baglanamama sayilari, pencere disi sayilmaz
//   WT8  SALT OKUNUR: tarama oncesi/sonrasi agac (mod, boyut, mtime, icerik) ayni; yeni dosya yok
//   WT9  kaynak: Python 3.6 sozdizimi; Jinja isareti / heredoc sonu / ters tirnakli komut / $( yok
//   WT10 kaynak AST: tek alt surec `ip -o addr show` (sabit argv), os.open yalniz O_RDONLY, fdopen 'rb',
//        GzipFile 'rb', ag / yazma modulleri yok, yazma yalniz stdout
//   WT11 web yok: ps gorunur + kurulum yok -> WEB_YOK; ps gorunmez -> OLCULEMEDI (yok denmez)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { adaylar } = require('./fixtures/python-bul.cjs');

const BETIK = path.join(__dirname, '..', 'bmw_portal', 'ear_envanter', 'files', 'web_tara.py');
const KAYNAK = fs.readFileSync(BETIK, 'utf8');

function pythonuBul() {
  for (const [komut, on] of adaylar()) {
    if (spawnSync(komut, [...on, '-c', 'import gzip, zlib'], { stdio: 'ignore' }).status === 0)
      return { komut, on };
  }
  return null;
}
const PY = pythonuBul();
const SKIP = PY ? false : 'python3 bulunamadi - web tarayici bekcileri KOSMADI';

// 2026-11-07 12:00:00 UTC
const SIMDI = Date.UTC(2026, 10, 7, 12, 0, 0) / 1000;

function yaz(p, icerik, mtime) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, icerik);
  if (mtime) fs.utimesSync(p, mtime, mtime);
}

const AY = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Access log satiri (combined), t epoch saniye, saat dilimi +0300. */
function erisim(ip, t, yol, durum = 200) {
  const d = new Date((t + 3 * 3600) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const z = `${p(d.getUTCDate())}/${AY[d.getUTCMonth()]}/${d.getUTCFullYear()}:${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0300`;
  return `${ip} - - [${z}] "GET ${yol} HTTP/1.1" ${durum} 512 "-" "agent"\n`;
}
const GUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function hataSatiri(t, govde) {
  const d = new Date(t * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `[${GUN[d.getUTCDay()]} ${AY[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.123456 ${d.getUTCFullYear()}] ${govde}\n`;
}

/** Sahte /proc: httpd surecleri (argv dizisi listesi), tcp satirlari. pid 1 gorunurluk icin. */
function sahteProc(kok, { surecler = [], gorunur = true, tcp = '', tcp6 = '' } = {}) {
  const proc = path.join(kok, 'proc');
  fs.mkdirSync(proc, { recursive: true });
  if (gorunur) yaz(path.join(proc, '1', 'cmdline'), 'init\0');
  surecler.forEach((argv, i) =>
    yaz(path.join(proc, String(100 + i), 'cmdline'), argv.join('\0') + '\0'),
  );
  const bas =
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';
  yaz(path.join(proc, 'net', 'tcp'), bas + tcp);
  yaz(path.join(proc, 'net', 'tcp6'), bas + tcp6);
  return proc;
}

function kos(kok, env = {}) {
  const r = spawnSync(PY.komut, [...PY.on, '-B', '-'], {
    input: KAYNAK,
    env: {
      PATH: process.env.PATH,
      LC_ALL: 'C',
      EAR_WEB_SIMDI: String(SIMDI),
      EAR_WEB_KOKLER: '',
      EAR_WEB_PROC: path.join(kok, 'proc'),
      ...env,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0, String(r.stderr));
  const out = String(r.stdout);
  const a = out.indexOf('@@EAR_WEB_BASLA@@');
  const b = out.indexOf('@@EAR_WEB_BITTI@@');
  assert.ok(a >= 0 && b > a, `paket yok: ${out.slice(0, 300)}`);
  const ham = zlib.inflateSync(Buffer.from(out.slice(a + 17, b), 'base64'));
  return JSON.parse(ham.toString('utf8'));
}

function geciciKok() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'web-tara-'));
}

// ── WT1 IHS + mod_jk ───────────────────────────────────────────────────────────────────────────
function ihsAgaci(kok) {
  const ihs = path.join(kok, 'IBMIHS');
  yaz(
    path.join(ihs, 'conf', 'httpd.conf'),
    [
      'ServerRoot "' + ihs + '"',
      'Listen 80',
      'Listen 10.0.0.5:443',
      'LoadModule jk_module modules/mod_jk.so',
      'LoadModule ssl_module modules/mod_ssl.so',
      'CustomLog logs/access_log combined',
      'ErrorLog logs/error_log',
      '<IfModule mod_jk.c>',
      '  JkWorkersFile conf/workers.properties',
      '  JkLogFile logs/mod_jk.log',
      '</IfModule>',
      'Include conf.d/*.conf',
      '',
    ].join('\n'),
  );
  yaz(
    path.join(ihs, 'conf.d', 'app1.conf'),
    [
      '<VirtualHost 10.0.0.5:443>',
      '  ServerName app1.ornek.local',
      '  ServerAlias app1 \\',
      '     app1-eski.ornek.local',
      '  SSLCertificateFile conf/ssl/app1.crt',
      '  JkMount /app1/* app1lb',
      '  JkMountFile conf/uriworkermap.properties',
      '  CustomLog logs/app1_access_log combined',
      '</VirtualHost>',
      '',
    ].join('\n'),
  );
  yaz(path.join(ihs, 'conf', 'ssl', 'app1.crt'), 'SERTIFIKA');
  yaz(
    path.join(ihs, 'conf', 'uriworkermap.properties'),
    '# yorum\n/servis/*=app1lb\n!/servis/statik/*=app1lb\n',
  );
  yaz(
    path.join(ihs, 'conf', 'workers.properties'),
    [
      'worker.list=app1lb,durum',
      'worker.app1lb.type=lb',
      'worker.app1lb.balance_workers=app1a,app1b',
      'worker.sablon.type=ajp13',
      'worker.sablon.port=8009',
      'worker.app1a.reference=worker.sablon',
      'worker.app1a.host=appsrv01',
      'worker.app1b.type=ajp13',
      'worker.app1b.host=10.0.1.7',
      'worker.app1b.port=8109',
      'worker.durum.type=status',
      '',
    ].join('\n'),
  );
  return ihs;
}

test(
  'WT1 IHS + mod_jk: Include, vhost, JkMount + workers.properties, ps tanimlari',
  { skip: SKIP },
  () => {
    const kok = geciciKok();
    const ihs = ihsAgaci(kok);
    sahteProc(kok, {
      surecler: [
        [`${ihs}/bin/httpd`, '-d', ihs, '-k', 'start', '-DSSL'],
        [`${ihs}/bin/httpd`, '-d', ihs],
      ],
    });
    const y = kos(kok);
    assert.equal(y.sema, 1);
    assert.equal(y.durum, 'TAM');
    assert.equal(y.kurulumlar.length, 1);
    const k = y.kurulumlar[0];
    assert.equal(k.urun, 'IHS');
    assert.equal(k.kaynak, 'ps');
    assert.equal(k.calisiyor, true);
    assert.equal(k.surec_sayisi, 2);
    assert.deepEqual(k.tanimlar, ['SSL']);
    assert.deepEqual(
      k.dinle.map((d) => [d.adres, d.port]),
      [
        ['*', 80],
        ['10.0.0.5', 443],
      ],
    );
    assert.equal(k.hatalar.length, 0, JSON.stringify(k.hatalar));
    assert.equal(k.vhostlar.length, 1);
    const v = k.vhostlar[0];
    assert.equal(v.server_name, 'app1.ornek.local');
    assert.deepEqual(v.aliases, ['app1', 'app1-eski.ornek.local']);
    assert.deepEqual(v.adres, ['10.0.0.5:443']);
    assert.equal(v.dosya, path.join(ihs, 'conf.d', 'app1.conf'));
    assert.equal(v.satir, 1);
    assert.deepEqual(v.ssl, { sertifika: path.join(ihs, 'conf', 'ssl', 'app1.crt'), var: true });
    assert.deepEqual(
      v.jk_mount.map((m) => [m.yol, m.worker]),
      [
        ['/app1/*', 'app1lb'],
        ['/servis/*', 'app1lb'],
      ],
    );
    assert.equal(k.jk.workers.durum, 'OKUNDU');
    const w = Object.fromEntries(k.jk.workers.workerlar.map((x) => [x.ad, x]));
    assert.deepEqual(w.app1lb.uyeler, ['app1a', 'app1b']);
    assert.equal(w.app1lb.tur, 'lb');
    assert.equal(w.app1lb.listede, true);
    // reference: tur ve port sablondan, host kendinden
    assert.deepEqual([w.app1a.tur, w.app1a.host, w.app1a.port], ['ajp13', 'appsrv01', 8009]);
    assert.deepEqual([w.app1b.host, w.app1b.port], ['10.0.1.7', 8109]);
    assert.equal(k.jk.log, path.join(ihs, 'logs', 'mod_jk.log'));
    // IfModule karari kayitli (denetlenebilir)
    assert.ok(
      k.if_kararlari.some(
        (x) => x.tur === 'IfModule' && x.deger === 'mod_jk.c' && x.sonuc === true,
      ),
    );
  },
);

// ── WT2 RHA + mod_proxy / mod_cluster ─────────────────────────────────────────────────────────
test(
  'WT2 RHA: balancer, Location ProxyPass, RewriteRule [P], mod_cluster dinamik balancer, Define',
  { skip: SKIP },
  () => {
    const kok = geciciKok();
    const rha = path.join(kok, 'jbcs', 'httpd');
    yaz(
      path.join(rha, 'conf', 'httpd.conf'),
      [
        'Define APPIP 10.0.0.9',
        'Listen ${APPIP}:80',
        'Listen 6666',
        'LoadModule proxy_module modules/mod_proxy.so',
        'LoadModule proxy_ajp_module modules/mod_proxy_ajp.so',
        'LoadModule manager_module modules/mod_manager.so',
        'LoadModule proxy_cluster_module modules/mod_proxy_cluster.so',
        'CustomLog "logs/access_log" combined',
        '<VirtualHost ${APPIP}:80>',
        '  ServerName app2.ornek.local',
        '  ProxyPass / balancer://app2/',
        '  ProxyPass /hc !',
        '  <Location /eski>',
        '    ProxyPass http://user:sir@eskisrv:8080/eski',
        '  </Location>',
        '  RewriteRule ^/yeni/(.*)$ ajp://yenisrv:8209/yeni/$1 [P,L]',
        '  RewriteRule ^/x$ /y [R]',
        '</VirtualHost>',
        '<VirtualHost *:80>',
        '  ServerName app3.ornek.local',
        '  ProxyPass /app3 balancer://statikbal/app3',
        '</VirtualHost>',
        '<Proxy balancer://statikbal>',
        '  BalancerMember ajp://appsrv02:8009 route=a',
        '  BalancerMember ajp://appsrv03:8009 route=b',
        '</Proxy>',
        '<VirtualHost *:6666>',
        '  EnableMCPMReceive',
        '  ManagerBalancerName mycluster',
        '</VirtualHost>',
        '',
      ].join('\n'),
    );
    sahteProc(kok, {
      surecler: [['/opt/jbcs/httpd/sbin/httpd', '-d', rha, '-f', 'conf/httpd.conf']],
    });
    const y = kos(kok);
    const k = y.kurulumlar[0];
    assert.equal(k.urun, 'RHA');
    assert.deepEqual(
      k.dinle.map((d) => [d.adres, d.port]),
      [
        ['10.0.0.9', 80],
        ['*', 6666],
      ],
    );
    const v = Object.fromEntries(k.vhostlar.map((x) => [x.server_name, x]));
    assert.deepEqual(v['app2.ornek.local'].adres, ['10.0.0.9:80']);
    const h = v['app2.ornek.local'].hedefler;
    // ProxyPass /hc ! hedef degil; RewriteRule [R] hedef degil
    assert.deepEqual(
      h.map((x) => [x.tur, x.yol, x.sema, x.host, x.port]),
      [
        ['mc', '/', 'balancer', 'app2', null],
        ['proxy', '/eski', 'http', 'eskisrv', 8080],
        ['rewrite', '^/yeni/(.*)$', 'ajp', 'yenisrv', 8209],
      ],
    );
    // URL'deki kullanici bilgisi pakete girmez
    assert.ok(!JSON.stringify(y).includes('sir@'));
    assert.equal(h[0].balancer_tanimli, false);
    const h3 = v['app3.ornek.local'].hedefler[0];
    assert.equal(h3.tur, 'proxy');
    assert.equal(h3.balancer_tanimli, true);
    assert.deepEqual(
      k.balancerlar.find((b) => b.ad === 'statikbal').uyeler.map((u) => [u.host, u.port]),
      [
        ['appsrv02', 8009],
        ['appsrv03', 8009],
      ],
    );
    assert.equal(k.mod_cluster.yuklu, true);
    assert.equal(k.mod_cluster.yonergeler.managerbalancername, 'mycluster');
    assert.deepEqual(
      k.mod_cluster.mcmp_vhostlari.map((x) => x.adres),
      [['*:6666']],
    );
  },
);

// ── WT3 WAS eklentisi ──────────────────────────────────────────────────────────────────────────
test(
  'WT3 WAS eklentisi: plugin-cfg.xml cluster / transport / route; DOCTYPE reddedilir',
  { skip: SKIP },
  () => {
    const kok = geciciKok();
    const ihs = path.join(kok, 'HTTPServer');
    const plugin = path.join(kok, 'Plugins', 'config', 'web1', 'plugin-cfg.xml');
    yaz(
      path.join(ihs, 'conf', 'httpd.conf'),
      [
        'LoadModule was_ap24_module /opt/IBM/WebSphere/Plugins/bin/64bits/mod_was_ap24_http.so',
        `WebSpherePluginConfig ${plugin}`,
        '<VirtualHost *:80>',
        '  ServerName was1.ornek.local',
        '</VirtualHost>',
        '',
      ].join('\n'),
    );
    yaz(
      plugin,
      `<?xml version="1.0" encoding="ISO-8859-1"?>
<Config>
  <Log LogLevel="Error" Name="/opt/IBM/WebSphere/Plugins/logs/web1/http_plugin.log"/>
  <VirtualHostGroup Name="default_host"><VirtualHost Name="*:80"/><VirtualHost Name="*:443"/></VirtualHostGroup>
  <ServerCluster Name="Cluster1">
    <Server Name="was01_srv1"><Transport Hostname="was01" Port="9080" Protocol="http"/><Transport Hostname="was01" Port="9443" Protocol="https"/></Server>
    <Server Name="was02_srv1"><Transport Hostname="was02" Port="9080" Protocol="http"/></Server>
  </ServerCluster>
  <UriGroup Name="Cluster1_URIs"><Uri Name="/app4/*"/></UriGroup>
  <Route ServerCluster="Cluster1" UriGroup="Cluster1_URIs" VirtualHostGroup="default_host"/>
</Config>`,
    );
    sahteProc(kok, { surecler: [[`${ihs}/bin/httpd`, '-d', ihs]] });
    const y = kos(kok);
    const k = y.kurulumlar[0];
    assert.equal(k.urun, 'IHS');
    assert.equal(k.was.durum, 'OKUNDU');
    assert.equal(k.was.log, '/opt/IBM/WebSphere/Plugins/logs/web1/http_plugin.log');
    assert.deepEqual(
      k.was.clusterlar[0].sunucular.map((s) => [s.ad, s.host, s.port, s.protokol]),
      [
        ['was01_srv1', 'was01', 9080, 'http'],
        ['was01_srv1', 'was01', 9443, 'https'],
        ['was02_srv1', 'was02', 9080, 'http'],
      ],
    );
    assert.deepEqual(k.was.urigruplari, { Cluster1_URIs: ['/app4/*'] });
    assert.deepEqual(k.was.vhostgruplari, { default_host: ['*:80', '*:443'] });
    assert.deepEqual(k.was.rotalar, [
      { cluster: 'Cluster1', urigroup: 'Cluster1_URIs', vhostgroup: 'default_host' },
    ]);
    // DOCTYPE'li eklenti yapilandirmasi AYRISTIRILMAZ
    fs.writeFileSync(
      plugin,
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Config>&e;</Config>',
    );
    const y2 = kos(kok);
    assert.equal(y2.kurulumlar[0].was.durum, 'REDDEDILDI');
    assert.deepEqual(y2.kurulumlar[0].was.clusterlar, []);
  },
);

// ── WT4 config hatalari ve kosullu bloklar ─────────────────────────────────────────────────────
test(
  'WT4 eksik Include, IncludeOptional, dongu, IfModule / IfDefine; ps gorunmezse BELIRSIZ',
  { skip: SKIP },
  () => {
    const kok = geciciKok();
    const r = path.join(kok, 'httpd');
    yaz(
      path.join(r, 'conf', 'httpd.conf'),
      [
        'Include conf/yok.conf',
        'Include conf/eksik.d/*.conf',
        'IncludeOptional conf/opsiyonel/*.conf',
        'Include conf/a.conf',
        '<IfModule mod_yok.c>',
        '  <VirtualHost *:81>',
        '    ServerName atlanan.ornek.local',
        '  </VirtualHost>',
        '</IfModule>',
        '<IfModule !mod_yok.c>',
        '  <VirtualHost *:82>',
        '    ServerName olumsuz.ornek.local',
        '  </VirtualHost>',
        '</IfModule>',
        '<IfDefine OZEL>',
        '  <VirtualHost *:83>',
        '    ServerName tanimli.ornek.local',
        '  </VirtualHost>',
        '</IfDefine>',
        '',
      ].join('\n'),
    );
    yaz(path.join(r, 'conf', 'a.conf'), 'Include conf/b.conf\n');
    yaz(path.join(r, 'conf', 'b.conf'), 'Include conf/a.conf\n');
    fs.mkdirSync(path.join(r, 'conf', 'eksik.d'), { recursive: true });
    sahteProc(kok, { surecler: [['/usr/sbin/httpd', '-d', r]] });
    const y = kos(kok);
    const k = y.kurulumlar[0];
    const turler = k.hatalar.map((h) => `${h.tur}:${h.deger}`);
    assert.ok(turler.includes('EKSIK_INCLUDE:conf/yok.conf'), turler.join(' '));
    assert.ok(turler.includes('EKSIK_INCLUDE:conf/eksik.d/*.conf'), turler.join(' '));
    assert.ok(!turler.some((x) => x.includes('opsiyonel')), 'IncludeOptional eksikligi hata degil');
    assert.ok(k.hatalar.some((h) => h.tur === 'DONGU'));
    // ps gorunur, -D OZEL yok: IfDefine blogu ATLANIR
    assert.deepEqual(
      k.vhostlar.map((v) => v.server_name),
      ['olumsuz.ornek.local'],
    );
    assert.ok(
      k.if_kararlari.some((x) => x.tur === 'IfDefine' && x.sonuc === false && x.belirsiz === false),
    );
    // ps gorunmez (hidepid): tanim bilinemez -> blok ISLENIR ama belirsiz isaretlenir
    const kok2 = geciciKok();
    fs.cpSync(r, path.join(kok2, 'httpd'), { recursive: true });
    sahteProc(kok2, { gorunur: false });
    const y2 = kos(kok2, { EAR_WEB_KOKLER: path.join(kok2, 'httpd') });
    const k2 = y2.kurulumlar[0];
    assert.equal(y2.ps_gorunur, false);
    assert.equal(k2.kaynak, 'aday');
    assert.equal(k2.calisiyor, null, 'gorunmeyen surec "calismiyor" sayilmaz');
    const tanimli = k2.vhostlar.find((v) => v.server_name === 'tanimli.ornek.local');
    assert.ok(tanimli && tanimli.belirsiz === true);
    assert.equal(k2.vhostlar.find((v) => v.server_name === 'olumsuz.ornek.local').belirsiz, false);
  },
);

// ── WT5 soketler ve IP'ler ─────────────────────────────────────────────────────────────────────
test(
  'WT5 LISTEN soketleri /proc/net/tcp{,6}, IP listesi `ip -o addr`; ip yoksa OLCULEMEDI',
  { skip: SKIP },
  () => {
    const kok = geciciKok();
    // 0500000A:01BB = 10.0.0.5:443 LISTEN; 00000000:0050 = 0.0.0.0:80 LISTEN; 0100007F:1F90 ESTABLISHED (01)
    sahteProc(kok, {
      tcp:
        '   0: 0500000A:01BB 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1\n' +
        '   1: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2\n' +
        '   2: 0100007F:1F90 0100007F:D431 01 00000000:00000000 00:00000000 00000000     0        0 3\n',
      tcp6: '   0: 00000000000000000000000000000000:1A0A 00000000000000000000000000000000:0000 0A 0 0 0 0 0 4\n',
    });
    const ipDosya = path.join(kok, 'ip.txt');
    yaz(
      ipDosya,
      '1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever\n' +
        '2: eth0    inet 10.0.0.5/24 brd 10.0.0.255 scope global eth0\\       valid_lft forever\n' +
        '2: eth0    inet 10.0.0.6/24 brd 10.0.0.255 scope global secondary eth0:1\\       valid_lft forever\n' +
        '2: eth0    inet6 fe80::1/64 scope link \\       valid_lft forever\n',
    );
    const y = kos(kok, { EAR_WEB_IP_DOSYA: ipDosya });
    assert.equal(y.durum, 'WEB_YOK');
    assert.deepEqual(
      y.soketler.dinlenen.map((s) => [s.adres, s.port, s.aile]),
      [
        ['10.0.0.5', 443, 4],
        ['0.0.0.0', 80, 4],
        ['::', 6666, 6],
      ],
    );
    assert.deepEqual(
      y.ipler.liste.map((x) => [x.ip, x.onek, x.iface, x.aile]),
      [
        ['127.0.0.1', 8, 'lo', 4],
        ['10.0.0.5', 24, 'eth0', 4],
        ['10.0.0.6', 24, 'eth0', 4],
        ['fe80::1', 64, 'eth0', 6],
      ],
    );
    const y2 = kos(kok, { EAR_WEB_IP_DOSYA: path.join(kok, 'yok.txt') });
    assert.equal(y2.ipler.durum, 'OLCULEMEDI');
    assert.deepEqual(y2.ipler.liste, []);
  },
);

// ── WT6 access log ozeti ───────────────────────────────────────────────────────────────────────
function logluAgac(kok, { satirlar, ayri = true, desen = null }) {
  const r = path.join(kok, 'IBMIHS');
  yaz(
    path.join(r, 'conf', 'httpd.conf'),
    [
      `ServerRoot "${r}"`,
      desen ? `CustomLog "${desen}" combined` : 'CustomLog logs/access_log combined',
      '<VirtualHost *:80>',
      '  ServerName ana.ornek.local',
      ayri ? '  CustomLog logs/ana_access_log combined' : '',
      '</VirtualHost>',
      '<VirtualHost *:80>',
      '  ServerName miras1.ornek.local',
      '</VirtualHost>',
      '<VirtualHost *:80>',
      '  ServerName miras2.ornek.local',
      '</VirtualHost>',
      '',
    ].join('\n'),
  );
  sahteProc(kok, { surecler: [[`${r}/bin/httpd`, '-d', r]] });
  return r;
}

test(
  'WT6 access log: sinif sayilari, pencere, kapsama, hc istemcileri, gz, paylasilan, KISMI / OLCULEMEDI',
  { skip: SKIP },
  () => {
    const kok = geciciKok();
    const r = logluAgac(kok, {});
    const s = SIMDI;
    const H = 3600;
    const D = 86400;
    // Guncel log: son 3 gun; donmus .gz: 3..8 gun once (pencere 7 gun -> 8. gun disarida)
    const guncel =
      erisim('10.9.9.1', s - 2 * H, '/app/hc.jsp') +
      erisim('10.9.9.1', s - 3 * H, '/hc.html') +
      erisim('10.9.9.2', s - 4 * H, '/hc.jsp') +
      erisim('10.1.1.10', s - 5 * H, '/app/islem?id=5', 200) +
      erisim('10.1.1.11', s - 30 * H, '/app/rapor', 500) +
      erisim('10.1.1.10', s - 2 * D, '/static/a.css') +
      erisim('10.1.1.12', s - 2.5 * D, '/diger/sayfa', 302);
    const eski =
      erisim('10.1.1.13', s - 4 * D, '/app/eski', 404) +
      erisim('10.1.1.14', s - 8 * D, '/app/pencere-disi');
    yaz(path.join(r, 'logs', 'ana_access_log'), guncel, s - 60);
    yaz(path.join(r, 'logs', 'ana_access_log.1.gz'), zlib.gzipSync(eski), s - 3 * D);
    yaz(path.join(r, 'logs', 'access_log'), erisim('10.2.2.2', s - H, '/x/y'), s - 60);
    const y = kos(kok);
    const k = y.kurulumlar[0];
    const v = Object.fromEntries(k.vhostlar.map((x) => [x.server_name, x]));
    const o = v['ana.ornek.local'].loglar[0];
    assert.equal(o.durum, 'OLCULDU', o.neden);
    assert.equal(o.paylasilan, false);
    assert.deepEqual([o.gercek_24s, o.gercek_7g, o.hc_24s, o.hc_7g, o.statik_7g], [1, 4, 3, 3, 1]);
    assert.deepEqual(o.durum_sinif, { '2xx': 1, '3xx': 1, '4xx': 1, '5xx': 1 });
    assert.equal(o.son_gercek, s - 5 * H);
    assert.ok(o.kapsama_bas <= s - 7 * D, 'kapsama pencereyi ortuyor');
    assert.deepEqual(o.hc_istemcileri, [
      { ip: '10.9.9.1', n: 2 },
      { ip: '10.9.9.2', n: 1 },
    ]);
    assert.equal(o.istemci_sayisi, 4);
    assert.equal(o.ilk_yollar[0].yol, '/app');
    assert.ok(!JSON.stringify(o).includes('id=5'), 'sorgu dizesi pakete girmez');
    // Iki vhost ana logu MIRAS alir: paylasilan + miras, okuma bir kez
    assert.equal(v['miras1.ornek.local'].loglar[0].paylasilan, true);
    assert.equal(v['miras1.ornek.local'].loglar[0].miras, true);
    assert.equal(v['miras1.ornek.local'].loglar[0].gercek_7g, 1);
    // KISA PENCERE: log 3 gunluk, donmus yok -> KISMI (asla "7 gun 0 istek" kurulmaz)
    fs.unlinkSync(path.join(r, 'logs', 'ana_access_log.1.gz'));
    const o2 = kos(kok).kurulumlar[0].vhostlar.find((x) => x.server_name === 'ana.ornek.local')
      .loglar[0];
    assert.equal(o2.durum, 'KISMI');
    assert.match(o2.neden, /7 gunden kisa/);
    // BUTCE: 1 MB butceyle buyuk log kuyruktan okunur -> KISMI, ornek
    const buyuk = path.join(r, 'logs', 'ana_access_log');
    const satir = erisim('10.1.1.10', s - 6 * D, '/app/doldurma');
    fs.writeFileSync(buyuk, satir.repeat(Math.ceil((1.5 * 1024 * 1024) / satir.length)) + guncel);
    fs.utimesSync(buyuk, s - 60, s - 60);
    const o3 = kos(kok, { EAR_WEB_LOG_MB: '1' }).kurulumlar[0].vhostlar.find(
      (x) => x.server_name === 'ana.ornek.local',
    ).loglar[0];
    assert.equal(o3.ornek, true);
    assert.equal(o3.durum, 'KISMI');
    // LOGFORMAT FARKLI: satirlar ayristirilamaz -> OLCULEMEDI (0 istek DEGIL)
    fs.writeFileSync(
      buyuk,
      'baska bicim satiri 1\nbaska bicim satiri 2\n' + erisim('10.1.1.1', s - H, '/a'),
    );
    fs.utimesSync(buyuk, s - 60, s - 60);
    const o4 = kos(kok).kurulumlar[0].vhostlar.find((x) => x.server_name === 'ana.ornek.local')
      .loglar[0];
    assert.equal(o4.durum, 'OLCULEMEDI');
    // LOG YOK: pencerede dosya yok -> OLCULEMEDI
    fs.unlinkSync(buyuk);
    const o5 = kos(kok).kurulumlar[0].vhostlar.find((x) => x.server_name === 'ana.ornek.local')
      .loglar[0];
    assert.equal(o5.durum, 'OLCULEMEDI');
  },
);

test('WT6b rotatelogs borusu: tarih desenli dosyalar okunur', { skip: SKIP }, () => {
  const kok = geciciKok();
  const r = path.join(kok, 'IBMIHS');
  const s = SIMDI;
  logluAgac(kok, { ayri: false, desen: `|${r}/bin/rotatelogs ${r}/logs/rot_access.%Y%m%d 86400` });
  yaz(path.join(r, 'logs', 'rot_access.20261107'), erisim('10.1.1.1', s - 3600, '/app/a'), s - 60);
  yaz(
    path.join(r, 'logs', 'rot_access.20261101'),
    erisim('10.1.1.2', s - 6 * 86400, '/app/b'),
    s - 6 * 86400,
  );
  const o = kos(kok).kurulumlar[0].vhostlar[0].loglar[0];
  assert.equal(o.desen, `|${r}/logs/rot_access.%Y%m%d`);
  assert.equal(o.gercek_7g, 2);
  assert.equal(o.dosyalar.length, 2);
});

// ── WT7 error loglari ──────────────────────────────────────────────────────────────────────────
test(
  'WT7 arka uca baglanamama: proxy / mod_jk / WAS eklentisi, pencere disi sayilmaz',
  { skip: SKIP },
  () => {
    const kok = geciciKok();
    const ihs = ihsAgaci(kok);
    const s = SIMDI;
    yaz(
      path.join(ihs, 'logs', 'error_log'),
      hataSatiri(
        s - 3600,
        '[proxy:error] [pid 1] AH00957: AJP: attempt to connect to 10.0.1.7:8109 (10.0.1.7) failed',
      ) +
        hataSatiri(
          s - 7200,
          '[proxy:error] [pid 1] AH00957: AJP: attempt to connect to 10.0.1.7:8109 (10.0.1.7) failed',
        ) +
        hataSatiri(
          s - 9000,
          '[proxy_http:error] [pid 2] AH01114: HTTP: failed to make connection to backend: eskisrv',
        ) +
        hataSatiri(
          s - 9 * 86400,
          '[proxy:error] AH00957: AJP: attempt to connect to eskihost:8009 (x) failed',
        ) +
        hataSatiri(s - 100, '[core:notice] AH00094: Command line: httpd'),
    );
    yaz(
      path.join(ihs, 'logs', 'mod_jk.log'),
      hataSatiri(
        s - 500,
        '[1:2] [error] ajp_connect_to_endpoint::jk_ajp_common.c (1068): (app1a) Failed opening socket to (10.0.1.8:8009) (errno=111)',
      ),
    );
    sahteProc(kok, { surecler: [[`${ihs}/bin/httpd`, '-d', ihs]] });
    const k = kos(kok).kurulumlar[0];
    const e = Object.fromEntries(k.error_loglari.map((x) => [path.basename(x.yol), x]));
    assert.deepEqual(
      e.error_log.hatalar.map((h) => [h.tur, h.hedef, h.n]),
      [
        ['proxy', '10.0.1.7:8109', 2],
        ['proxy', 'eskisrv', 1],
      ],
    );
    assert.equal(e.error_log.hatalar[0].son, s - 3600);
    assert.deepEqual(
      e['mod_jk.log'].hatalar.map((h) => [h.tur, h.hedef, h.n]),
      [['jk', '10.0.1.8:8009', 1]],
    );
  },
);

// ── WT8 salt okunur ────────────────────────────────────────────────────────────────────────────
function agacIzi(dizin) {
  const out = [];
  const gez = (d) => {
    for (const ad of fs.readdirSync(d).sort()) {
      const p = path.join(d, ad);
      const st = fs.lstatSync(p);
      const rel = path.relative(dizin, p);
      if (st.isDirectory()) {
        out.push(`${rel}/ d ${st.mode} ${st.mtimeMs}`);
        gez(p);
      } else
        out.push(
          `${rel} ${st.mode} ${st.size} ${st.mtimeMs} ${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`,
        );
    }
  };
  gez(dizin);
  return out;
}

test('WT8 SALT OKUNUR: agac tarama oncesi / sonrasi ayni', { skip: SKIP }, () => {
  const kok = geciciKok();
  const ihs = ihsAgaci(kok);
  yaz(
    path.join(ihs, 'logs', 'app1_access_log'),
    erisim('10.1.1.1', SIMDI - 60, '/app1/x'),
    SIMDI - 60,
  );
  yaz(
    path.join(ihs, 'logs', 'error_log'),
    hataSatiri(SIMDI - 60, 'AH00957: AJP: attempt to connect to a:1 (a) failed'),
  );
  sahteProc(kok, { surecler: [[`${ihs}/bin/httpd`, '-d', ihs]] });
  const once = agacIzi(kok);
  kos(kok);
  assert.deepEqual(agacIzi(kok), once);
});

// ── WT9 / WT10 kaynak bekcileri ────────────────────────────────────────────────────────────────
test(
  'WT9 kaynak: Python 3.6 sozdizimi; Jinja / heredoc sonu / ters tirnak / $( yok',
  { skip: SKIP },
  () => {
    const kod = KAYNAK.split('\n')
      .filter((s) => !/^\s*#/.test(s))
      .join('\n');
    assert.ok(!/\{\{|\{%|\{#/.test(KAYNAK), 'Jinja isareti: Ansible raw icinde sablonlanir');
    assert.ok(!KAYNAK.includes('EAR_WEB_SON'), 'heredoc sonu isareti betikte gecemez');
    assert.ok(!kod.includes('`') && !kod.includes('$('), 'kodda kabuk ikamesi yok');
    // f-string, walrus, := ve 3.6'da olmayan sozdizimi: feature_version=(3, 6) ile ayristir
    const r = spawnSync(
      PY.komut,
      [...PY.on, '-c', 'import ast,sys; ast.parse(sys.stdin.read(), feature_version=(3, 6))'],
      {
        input: KAYNAK,
      },
    );
    assert.equal(r.status, 0, String(r.stderr));
  },
);

const AST_DENETIM = `
import ast, json, sys
kaynak = sys.stdin.read()
agac = ast.parse(kaynak)
ithal = set()
for n in ast.walk(agac):
    if isinstance(n, ast.Import):
        ithal.update(a.name.split('.')[0] for a in n.names)
    elif isinstance(n, ast.ImportFrom):
        ithal.add((n.module or '').split('.')[0])
cagri = []
for n in ast.walk(agac):
    if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name):
        argv = None
        if n.args and isinstance(n.args[0], ast.List):
            argv = [e.value if isinstance(e, ast.Constant) else '<degisken>' for e in n.args[0].elts]
        kip = None
        for a in n.args[1:2]:
            if isinstance(a, ast.Constant) and isinstance(a.value, str):
                kip = a.value
        for kw in n.keywords:
            if kw.arg == 'mode' and isinstance(kw.value, ast.Constant):
                kip = kw.value.value
        bayrak = ast.dump(n.args[1]) if n.func.attr == 'open' and len(n.args) > 1 else None
        cagri.append([n.func.value.id, n.func.attr, argv, kip, bayrak])
print(json.dumps({'ithal': sorted(ithal), 'cagri': cagri}))
`;

test(
  'WT10 kaynak AST: tek alt surec ip, salt okunur acma, yazma yalniz stdout, ag yok',
  { skip: SKIP },
  () => {
    const r = spawnSync(PY.komut, [...PY.on, '-c', AST_DENETIM], { input: KAYNAK });
    assert.equal(r.status, 0, String(r.stderr));
    const { ithal, cagri } = JSON.parse(String(r.stdout));
    for (const yasak of [
      'urllib',
      'http',
      'requests',
      'shutil',
      'tempfile',
      'ftplib',
      'smtplib',
      'pty',
      'ctypes',
    ])
      assert.ok(!ithal.includes(yasak), `yasak modul: ${yasak}`);
    const IZIN = {
      os: ['environ', 'lstat', 'stat', 'open', 'fdopen', 'listdir', 'fstat', 'getuid'],
      'os.path': [],
      subprocess: ['check_output'],
      socket: ['gethostname', 'inet_ntop'],
      gzip: ['GzipFile'],
      re: ['compile', 'match', 'sub', 'search'],
      json: ['dumps'],
      zlib: ['compress'],
      base64: ['b64encode'],
      time: ['monotonic', 'time', 'strftime', 'gmtime'],
      calendar: ['timegm'],
      fnmatch: ['fnmatch'],
      sys: [],
      ElementTree: ['fromstring'],
      stat: ['S_ISREG', 'S_ISLNK'],
    };
    for (const [nesne, nitelik, argv, kip, bayrak] of cagri) {
      if (!(nesne in IZIN)) continue;
      if (nesne === 'os' && nitelik === 'environ') continue;
      assert.ok(IZIN[nesne].includes(nitelik), `izin listesinde yok: ${nesne}.${nitelik}`);
      if (nesne === 'subprocess')
        assert.deepEqual(
          argv,
          ['<degisken>', '-o', 'addr', 'show'],
          'tek alt surec ip -o addr show',
        );
      if (nesne === 'os' && nitelik === 'open')
        assert.match(String(bayrak), /O_RDONLY/, 'os.open yalniz O_RDONLY');
      if (nesne === 'os' && nitelik === 'fdopen') assert.equal(kip, 'rb');
      if (nesne === 'gzip') assert.equal(kip, 'rb');
    }
    assert.equal(cagri.filter(([n]) => n === 'subprocess').length, 1);
    // stdout disinda yazma yok: .write cagrilari yalniz sys.stdout uzerinden
    const kod = KAYNAK.split('\n').filter((s) => !/^\s*#/.test(s));
    const yazan = kod.filter((s) => /\.write\(/.test(s) && !/sys\.stdout\.write\(/.test(s));
    assert.deepEqual(yazan, []);
    // ip ikilisi yalniz sabit aday listesinden
    assert.match(
      KAYNAK,
      /IP_ADAYLARI = \('\/usr\/sbin\/ip', '\/sbin\/ip', '\/usr\/bin\/ip', '\/bin\/ip'\)/,
    );
  },
);

// ── WT11 web yok ───────────────────────────────────────────────────────────────────────────────
test('WT11 web yok: ps gorunur -> WEB_YOK; ps gorunmez -> OLCULEMEDI', { skip: SKIP }, () => {
  const kok = geciciKok();
  sahteProc(kok, {});
  assert.equal(kos(kok).durum, 'WEB_YOK');
  const kok2 = geciciKok();
  sahteProc(kok2, { gorunur: false });
  const y = kos(kok2);
  assert.equal(y.durum, 'OLCULEMEDI');
  assert.equal(y.ps_gorunur, false);
});
