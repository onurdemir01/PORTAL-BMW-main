// server/server-hub/__tests__/domain-kapali.test.js - JBoss DOMAIN KAPALI (2026-11-15).
//
// Uretim: Toplu Auto-Start'ta GBBFAA01 JVM'i canli okumada dustu: "host controller'a baglanilamadi ...
// Connection refused gbbfaa01:9990 - HICBIR SEY DEGISMEDI". Kok neden: gece taramasinda host controller
// calismiyordu; server_hub_scan.sh (PROC_VIS=FULL) CLI'yi acmadi (not "host controller calismiyor, CLI
// acilmadi"), JVM satirlari host XML'den geldi (hepsi durmus, auto-start XML'den true) -> her JVM icin
// kritik STOPPED_AUTOSTART_ON + jboss_autostart_off -> toplu "kapat" adayi -> canli okuma basarisiz.
//   DK1 domain kapali (prod / ortam bilinmiyor): sunucu+nesil basina TEK JBOSS_DOMAIN_DOWN (uyari), JVM
//       bazinda STOPPED_AUTOSTART_ON YOK, auto-start eylemi yok; CLI_SKIP kalir; retire adayi (R8) AYNEN kalir
//   DK2 Non-Production: bilgi (varsayilan uyari, ortamTavani); Admin seviyesi gecerli (kritik -> non-prod tavani)
//   DK3 BLIND / baska SKIP notu / CLI FAIL "Connection refused" domain kapali SAYILMAZ (CLI denendi)
//   DK4 host controller calisiyor: STOPPED_AUTOSTART_ON + jboss_autostart_off eskisi gibi
//   DK5 ayni sunucuda JBoss 7 kapali, JBoss 8 acik: yalniz 7 bastirilir
//   DK6 Toplu Auto-Start adaylari: domain kapali JVM aday DEGIL, dislanan nedeni acik; tek JVM kapisi iki yonde
//   DK7 tutarlilik: Acilis Hazirligi'nda auto-start riski yok (domain 'unknown'), Uygulama 360 uyumsuz saymaz
//   DK8 katalog: JBOSS_DOMAIN_DOWN varsayilan uyari, alan jboss
//   DK9 metin (inceleme A#1/A#2): host XML'de auto-start acik sayisi yazilir; JVM satiri yoksa "JVM tanimi okunamadi"
//   DK10 non-prod tavani prodSeverity (inceleme A#3): Admin uyari->kritik yaptiysa ekran "prod'da Kritik" der
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assess: assessHam, flattenFindings } = require('../assess.cjs');
const { KODLAR } = require('../kural-katalogu.cjs');
const { jvmAutoStartKapisi } = require('../autostart-dogrulama.cjs');
const { rebootReadiness } = require('../reboot-readiness.cjs');
const { kopyaOf } = require('../uygulama-360.cjs');
const T = require('../toplu-autostart.cjs');

const GUN = '2026-11-15';
const NOW = Date.parse(`${GUN}T10:00:00Z`);
const assess = (d, o) => assessHam(d, { now: NOW, ...(o || {}) });
// server_hub_scan.sh'in birebir notu (PROC_VIS=FULL dali).
const HC_NOT = 'host controller calismiyor, CLI acilmadi';

const hostSatiri = (host, vis = 'FULL') => ({
  host,
  scan_date: GUN,
  products: 'JBOSS7 JBOSS8',
  wall_s: 1,
  cpu_s: 0.1,
  note: '',
  scan_ver: '2.4',
  rec_counts: '',
  scan_errors: '',
  proc_visibility: vis,
  sock_visibility: 'PID',
  loaded_at: `${GUN}T06:00:00Z`,
});
const jvm = (host, gen, ad, running, autoStart, ek = {}) => ({
  host,
  gen,
  jvm: ad,
  grp: `${ad}-group`,
  running,
  auto_start: autoStart,
  server_state: running ? 'running' : 'stopped',
  ports: '',
  running_src: 'PS',
  cfg_src: 'XML',
  ...ek,
});
/** host: sunucu; jboss: JBOSS satirlari; jvms: JVM satirlari. */
const veri = (host, jboss, jvms, vis) => ({
  hosts: [hostSatiri(host, vis)],
  init: [],
  jboss,
  jvms,
  web: [],
  vhosts: [],
  ips: [],
});
const kapaliVeri = (host) =>
  veri(
    host,
    [{ host, gen: 8, host_name: 'master', host_state: '', cli: 'SKIP', note: `${HC_NOT}; host XML tahmini: host.xml` }],
    [jvm(host, 8, 'app1', 0, 'true'), jvm(host, 8, 'app2', 0, 'true'), jvm(host, 8, 'app3', 0, 'false')],
  );
const sunucu = (r, host) => r.hosts.find((h) => h.host === host);
const kodlar = (h, kod) => h.findings.filter((f) => f.code === kod);

test('DK1 domain kapali: tek JBOSS_DOMAIN_DOWN (uyari), JVM bazinda STOPPED_AUTOSTART_ON yok, eylem yok; R8 aynen', () => {
  for (const host of ['GBBFAA01', 'GBBFAP01']) {
    const h = sunucu(assess(kapaliVeri(host)), host);
    assert.equal(h.envGroup, host === 'GBBFAA01' ? 'Bilinmiyor' : 'Production');
    const d = kodlar(h, 'JBOSS_DOMAIN_DOWN');
    assert.equal(d.length, 1, 'sunucu+nesil basina tek bulgu');
    assert.equal(d[0].severity, 'warning');
    assert.equal(d[0].area, 'jboss');
    assert.equal(d[0].defaultSeverity, undefined);
    assert.equal(d[0].ortamTavani, undefined);
    assert.equal(d[0].fix, null);
    assert.equal(d[0].autoStartAcik, 2);
    assert.equal(
      d[0].text,
      "JBoss 8 domain kapalı (host controller çalışmıyor) — 3 JVM durmuş (2 tanesinde host XML'de auto-start açık: reboot'ta açılabilir); JVM bazında auto-start bulgusu üretilmedi",
    );
    assert.equal(kodlar(h, 'STOPPED_AUTOSTART_ON').length, 0, 'JVM bazinda kritik bulgu uretilmemeli');
    assert.ok(!h.findings.some((f) => f.fix && /^jboss_autostart_/.test(f.fix.action)), 'auto-start eylemi kalmamali');
    assert.equal(kodlar(h, 'CLI_SKIP').length, 1, 'CLI_SKIP teshisi kalir');
    assert.deepEqual(h.jbossDomainKapali, [8]);
    assert.ok(h.jvms.every((j) => j.domainKapali === true));
    assert.notEqual(h.status, 'danger', 'domain kapali sunucu kritik sayilmamali');
    // retirement adaylari bulgudan ayri: R8 (kapali + auto-start acik) AYNEN
    assert.deepEqual(
      h.retireAdaylari.filter((a) => a.kural === 'R8').map((a) => a.ad).sort(),
      ['app1', 'app2'],
    );
  }
});

test('DK1b domain kapali nesilde calisan + auto-start kapali JVM: REBOOT_RISK kalir ama auto-start eylemi yok', () => {
  const host = 'GBBFAP01';
  const d = kapaliVeri(host);
  d.jvms.push(jvm(host, 8, 'kosan', 1, 'false'));
  const h = sunucu(assess(d), host);
  const [f] = kodlar(h, 'REBOOT_RISK');
  assert.ok(f, 'reboot riski bulgusu kalir');
  assert.equal(f.fix, null, 'domain kapali: jboss_autostart_on onerilmez');
  assert.match(kodlar(h, 'JBOSS_DOMAIN_DOWN')[0].text, / 3 JVM durmuş \(2 tanesinde host XML'de auto-start açık: reboot'ta açılabilir\), 1 JVM süreci görünüyor;/);
});

test('DK2 Non-Production: bilgi (varsayilan uyari, ortamTavani); Admin seviyesi ortam inisinden once gelir', () => {
  const host = 'GBBFAT01';
  const h = sunucu(assess(kapaliVeri(host)), host);
  assert.equal(h.envGroup, 'Non-Production');
  const [f] = kodlar(h, 'JBOSS_DOMAIN_DOWN');
  assert.deepEqual([f.severity, f.defaultSeverity, f.ortamTavani, f.prodSeverity], ['info', 'warning', true, 'warning']);
  assert.equal(h.status, 'info');
  // Admin kritik yapti: non-prod tavani kritigi uyariya indirir (genel kural), bilgiye degil
  const k = kodlar(sunucu(assess(kapaliVeri(host), { seviyeler: { JBOSS_DOMAIN_DOWN: 'danger' } }), host), 'JBOSS_DOMAIN_DOWN')[0];
  assert.deepEqual([k.severity, k.defaultSeverity, k.ortamTavani], ['warning', 'warning', true]);
  // ekran "prod'da Kritik" demeli (Admin kritik yapti), varsayilan uyariyi DEGIL (inceleme A#3)
  assert.equal(k.prodSeverity, 'danger');
  // Admin acikca uyari dedi: o gecerli (ortam inisi yok)
  const u = kodlar(sunucu(assess(kapaliVeri(host), { seviyeler: { JBOSS_DOMAIN_DOWN: 'warning' } }), host), 'JBOSS_DOMAIN_DOWN')[0];
  assert.deepEqual([u.severity, u.ortamTavani], ['warning', undefined]);
  // Admin prod'da bilgi yapti
  const p = kodlar(sunucu(assess(kapaliVeri('GBBFAP01'), { seviyeler: { JBOSS_DOMAIN_DOWN: 'info' } }), 'GBBFAP01'), 'JBOSS_DOMAIN_DOWN')[0];
  assert.deepEqual([p.severity, p.defaultSeverity], ['info', 'warning']);
});

test('DK3 BLIND / baska SKIP notu / CLI FAIL "Connection refused" domain kapali sayilmaz', () => {
  const host = 'GBBFAP01';
  const durumlar = [
    // BLIND: tarayici CLI'yi yine dener; dustuyse FAIL yazar (bu not yazilmaz)
    { vis: 'BLIND', b: { cli: 'FAIL', note: 'cli rc=1 Failed to connect to the controller: Connection refused' } },
    { vis: 'FULL', b: { cli: 'SKIP', note: 'dzdo yok, was olarak kosulamaz' } },
    { vis: 'FULL', b: { cli: 'SKIP', note: 'jboss-cli GORULEMEDI (/usr/jboss8/bin) - izin, dosya orada olabilir' } },
  ];
  for (const { vis, b } of durumlar) {
    const d = veri(host, [{ host, gen: 8, host_name: 'master', host_state: '', ...b }], [jvm(host, 8, 'app1', 0, 'true')], vis);
    const h = sunucu(assess(d), host);
    assert.equal(kodlar(h, 'JBOSS_DOMAIN_DOWN').length, 0, `${vis} ${b.note}`);
    assert.ok(!h.jvms.some((j) => j.domainKapali), `${vis} ${b.note}: JVM isaretlenmemeli`);
    assert.deepEqual(h.jbossDomainKapali, []);
    assert.equal(kodlar(h, 'STOPPED_AUTOSTART_ON').length, 1, `${vis} ${b.note}: bulgu eskisi gibi`);
  }
});

test('DK4 host controller calisiyor: STOPPED_AUTOSTART_ON + jboss_autostart_off eskisi gibi', () => {
  const host = 'GBBFAP01';
  const d = veri(
    host,
    [{ host, gen: 8, host_name: 'master', host_state: 'running', cli: 'OK', note: '' }],
    [jvm(host, 8, 'app1', 0, 'true', { cfg_src: 'CLI_WILDCARD' })],
  );
  const h = sunucu(assess(d), host);
  const s = kodlar(h, 'STOPPED_AUTOSTART_ON');
  assert.equal(s.length, 1);
  assert.equal(s[0].severity, 'danger');
  assert.deepEqual(s[0].fix, { action: 'jboss_autostart_off', gen: 8, jvm: 'app1' });
  assert.equal(kodlar(h, 'JBOSS_DOMAIN_DOWN').length, 0);
});

test('DK5 ayni sunucuda JBoss 7 kapali, JBoss 8 acik: yalniz 7 bastirilir; ayni nesilde iki satir tek bulgu', () => {
  const host = 'GBBFAP01';
  const d = veri(
    host,
    [
      { host, gen: 7, host_name: 'master', host_state: '', cli: 'SKIP', note: HC_NOT },
      { host, gen: 7, host_name: 'slave', host_state: '', cli: 'SKIP', note: HC_NOT },
      { host, gen: 8, host_name: 'master', host_state: 'running', cli: 'OK', note: '' },
    ],
    [jvm(host, 7, 'eski', 0, 'true'), jvm(host, 8, 'yeni', 0, 'true', { cfg_src: 'CLI_WILDCARD' })],
  );
  const h = sunucu(assess(d), host);
  assert.equal(kodlar(h, 'JBOSS_DOMAIN_DOWN').length, 1);
  assert.match(kodlar(h, 'JBOSS_DOMAIN_DOWN')[0].text, /^JBoss 7 domain kapalı .* 1 JVM durmuş/);
  assert.deepEqual(kodlar(h, 'STOPPED_AUTOSTART_ON').map((f) => f.fix && f.fix.jvm), ['yeni']);
  assert.equal(h.jvms.find((j) => j.name === 'eski').domainKapali, true);
  assert.equal(h.jvms.find((j) => j.name === 'yeni').domainKapali, undefined);
});

const DOMAIN_MESAJ =
  'JBoss 8 domain kapalı (taramada host controller çalışmıyordu) — auto-start canlı okunamaz; iş açılmaz. Domain sonradan açıldıysa önce sunucuyu yeniden tarayın.';

test('DK6 Toplu Auto-Start: domain kapali JVM aday degil, dislanan nedeni acik; tek JVM kapisi iki yonde kapali', () => {
  const host = 'GBBFAA01';
  const acik = 'GBBFAB01';
  const d = kapaliVeri(host);
  d.hosts.push(hostSatiri(acik));
  d.jboss.push({ host: acik, gen: 8, host_name: 'master', host_state: 'running', cli: 'OK', note: '' });
  d.jvms.push(jvm(acik, 8, 'acikapp', 0, 'true', { cfg_src: 'CLI_WILDCARD' }));
  const A = assess(d);
  const { adaylar, dislananlar, xmlAdaylar } = T.adaylariTuret(A, { autoStart: null });
  assert.deepEqual(adaylar.map((x) => `${x.host}/${x.jvm}/${x.eylem}`), [`${acik}/acikapp/kapat`]);
  // 2026-11-15 ("olur ekle lutfen"): domain kapali durmus + auto-start true JVM'ler CLI adayi degil, dislanan da
  // degil: ayri host XML grubu (xmlAdaylar, eylem xml_kapat, prod isaretli).
  assert.deepEqual(dislananlar.filter((x) => x.host === host), []);
  assert.deepEqual(
    xmlAdaylar.map((x) => `${x.host}/${x.jvm}/${x.eylem}/${x.action}/${x.prod}`).sort(),
    [`${host}/app1/xml_kapat/jboss_autostart_xml_off/true`, `${host}/app2/xml_kapat/jboss_autostart_xml_off/true`],
  );
  // tek satir dugmesi (/jvm-autostart) ayni kapi: iki yon de
  const j = sunucu(A, host).jvms.find((x) => x.name === 'app1');
  for (const enable of [false, true]) {
    const k = jvmAutoStartKapisi(j, { host, jvm: 'app1', gen: 8, enable });
    assert.deepEqual(k, { status: 400, message: DOMAIN_MESAJ });
  }
  assert.equal(jvmAutoStartKapisi({ ...j, domainKapali: undefined }, { host, jvm: 'app1', gen: 8, enable: false }), null);
});

test('DK7 tutarlilik: Acilis Hazirligi auto-start riski saymaz; Uygulama 360 uyumsuz saymaz', () => {
  const host = 'GBBFAP01';
  const A = assess(kapaliVeri(host));
  const r = rebootReadiness(A.hosts, [host]);
  const satir = r.rows[0];
  assert.ok(!satir.reasons.some((x) => x.code === 'STOPPED_AUTOSTART_ON'), 'auto-start riski sayilmamali');
  const dd = satir.reasons.find((x) => x.code === 'JBOSS_DOMAIN_DOWN');
  assert.ok(dd, 'domain kapali nedeni gorunmeli');
  assert.equal(dd.tip, 'unknown');
  assert.equal(satir.verdict, 'unknown');
  const h = sunucu(A, host);
  for (const j of h.jvms) assert.equal(kopyaOf(h, j).autostartUyumsuz, null, j.name);
  // host controller calisan sunucuda uyumsuzluk eskisi gibi
  const j0 = { ...h.jvms[0], domainKapali: undefined };
  assert.equal(kopyaOf(h, j0).autostartUyumsuz, 'STOPPED_AUTOSTART_ON');
});

test('DK9 metin: JVM satiri yoksa "0 JVM durmus" yazilmaz; auto-start acik yoksa sayi eklenmez', () => {
  const host = 'GBBFAP01';
  // host XML belirsiz (scan "host XML belirsiz: host-master.xml,host-slave.xml"): JVM satiri gelmez
  const bos = sunucu(assess(veri(host, [{ host, gen: 8, host_name: '', host_state: '', cli: 'SKIP', note: HC_NOT }], [])), host);
  assert.equal(
    kodlar(bos, 'JBOSS_DOMAIN_DOWN')[0].text,
    'JBoss 8 domain kapalı (host controller çalışmıyor) — JVM tanımı okunamadı; JVM bazında auto-start bulgusu üretilmedi',
  );
  const d = kapaliVeri(host);
  d.jvms = d.jvms.map((j) => ({ ...j, auto_start: 'false' }));
  const kapali = sunucu(assess(d), host);
  // 2026-11-15 (host XML ile kapatma): hepsi false -> reboot'ta acilacak JVM yok, her ortamda bilgi (xml-autostart-kapat XK2)
  assert.equal(
    kodlar(kapali, 'JBOSS_DOMAIN_DOWN')[0].text,
    "JBoss 8 domain kapalı (host controller çalışmıyor) — 3 JVM durmuş, hepsinde host XML'de auto-start kapalı: reboot'ta açılacak JVM yok; JVM bazında auto-start bulgusu üretilmedi",
  );
  assert.equal(kodlar(kapali, 'JBOSS_DOMAIN_DOWN')[0].autoStartAcik, 0);
  assert.equal(kodlar(kapali, 'JBOSS_DOMAIN_DOWN')[0].severity, 'info');
  // bir JVM'in auto-start'i bilinmiyorsa "acilacak yok" denmez, sayi eklenmez
  const b = kapaliVeri(host);
  b.jvms = b.jvms.map((j, i) => ({ ...j, auto_start: i === 0 ? 'unknown' : 'false' }));
  const bk = kodlar(sunucu(assess(b), host), 'JBOSS_DOMAIN_DOWN')[0];
  assert.equal(bk.text, 'JBoss 8 domain kapalı (host controller çalışmıyor) — 3 JVM durmuş; JVM bazında auto-start bulgusu üretilmedi');
  assert.equal(bk.severity, 'warning');
});

test('DK10 genel non-prod tavani: Admin uyari->kritik yaptiysa prodSeverity kritik; dokunulmayan kritikte de kritik', () => {
  const host = 'GBBFAT01';
  const d = veri(
    host,
    [{ host, gen: 8, host_name: 'master', host_state: 'running', cli: 'OK', note: '' }],
    [jvm(host, 8, 'app1', 0, 'true', { cfg_src: 'CLI_WILDCARD' })],
  );
  const A = assess(d, { seviyeler: { JBOSS_DOMAIN_DOWN: 'danger' } });
  const [s] = kodlar(sunucu(A, host), 'STOPPED_AUTOSTART_ON');
  assert.deepEqual([s.severity, s.defaultSeverity, s.prodSeverity, s.ortamTavani], ['warning', 'danger', 'danger', true]);
  // Bulgular sekmesi / CSV satiri da tasir (ekran isareti oradan okur)
  const satir = flattenFindings(A.hosts).find((x) => x.code === 'STOPPED_AUTOSTART_ON');
  assert.deepEqual([satir.prodSeverity, satir.ortamTavani], ['danger', true]);
  const k = flattenFindings(assess(kapaliVeri(host), { seviyeler: { JBOSS_DOMAIN_DOWN: 'danger' } }).hosts).find((x) => x.code === 'JBOSS_DOMAIN_DOWN');
  assert.deepEqual([k.severity, k.defaultSeverity, k.prodSeverity], ['warning', 'warning', 'danger']);
  // prod sunucuda tavan yok -> prodSeverity yazilmaz
  const p = 'GBBFAP01';
  const dp = veri(p, [{ host: p, gen: 8, host_name: 'master', host_state: 'running', cli: 'OK', note: '' }], [jvm(p, 8, 'app1', 0, 'true', { cfg_src: 'CLI_WILDCARD' })]);
  assert.equal(kodlar(sunucu(assess(dp), p), 'STOPPED_AUTOSTART_ON')[0].prodSeverity, undefined);
});

test('DK8 katalog: JBOSS_DOMAIN_DOWN varsayilan uyari, alan jboss', () => {
  assert.equal(KODLAR.get('JBOSS_DOMAIN_DOWN').seviye, 'warning');
  assert.equal(KODLAR.get('JBOSS_DOMAIN_DOWN').alan, 'jboss');
});
