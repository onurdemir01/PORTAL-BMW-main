// server/retirement/__tests__/web-kesif.test.cjs — WK1..WK5 (2026-10-13).
//
// Kullanici: GFY_INTERNET_SERVICES retirement kaydinda tum hedeflerde "web bulunamadi". Iki sebep:
//   1) web listesi kayit ACILIRKEN donduruluyor; sonraki kesif duzeltmeleri eski kayda ulasmiyor
//      (PROD hedefi OCO penceresinde vhost'u kapatmadan duracakti) -> /:id/web-kesif
//   2) alan adinda alt cizgi olamaz: `gfy_internet_services` vhost'ta `gfy-internet-services`
//      ya da `gfyinternetservices` olur -> ad varyantlari
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildTargets } = require('../discover.cjs');
const { adVaryantlari } = require('../../audit/web-app.cjs');
const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const UC = (() => {
  const i = IDX.indexOf("router.post('/:id/web-kesif'");
  assert.ok(i > 0, 'web-kesif ucu yok');
  // Yalniz bu uc: bir sonraki router tanimina kadar.
  return IDX.slice(i, IDX.indexOf('router.', i + 20));
})();

test('WK1 alt cizgili ad: tire ve bitisik bicim de denenir', () => {
  assert.deepEqual(adVaryantlari('GFY_INTERNET_SERVICES-D'), ['gfy_internet_services-d', 'gfy-internet-services-d', 'gfyinternetservices-d']);
  assert.deepEqual(adVaryantlari('crm-d'), ['crm-d']);
});

test('WK2 GFY_INTERNET_SERVICES: sertifika (tire) ve Server Hub (bitisik, BIREBIR ilk etiket) bulunur', () => {
  const inv = [
    { app: 'GFY_INTERNET_SERVICES', host: 'GOJBAP10', env: 'PROD', domain: 'gtdmz.com.tr', jboss_version: '7' },
    { app: 'GFY_INTERNET_SERVICES-T', host: 'GOJBAT01', env: 'Test', domain: 'gtdmz.com.tr', jboss_version: '7' },
  ];
  const certs = [{ host: 'GOJBWP10', server_name: 'gfy-internet-services.gtdmz.com.tr', port: '443', conf_file: '/a.conf', product: 'IHS' }];
  const vh = [
    { host: 'GOJBWT01', server_name: 'gfyinternetservices-t.gtdmz.com.tr', aliases: '', listen: '*:443', conf_file: '/t.conf', product: 'IHS' },
    // Kardes ortamin vhost'u -T hedefine BAGLANMAMALI (ilk etiket birebir).
    { host: 'GOJBWT01', server_name: 'gfyinternetservices-d.gtdmz.com.tr', aliases: '', listen: '*:443', conf_file: '/d.conf', product: 'IHS' },
  ];
  const t = buildTargets('GFY_INTERNET_SERVICES', inv, certs, [], vh).targets;
  const prod = t.find((x) => x.host === 'GOJBAP10');
  const test_ = t.find((x) => x.host === 'GOJBAT01');
  assert.equal(prod.web[0]?.host, 'GOJBWP10', prod.webHow);
  assert.deepEqual(test_.web.map((w) => w.serverName), ['gfyinternetservices-t.gtdmz.com.tr'], test_.webHow);
});

test('WK3 onizleme HICBIR SEY yazmaz (tum yazimlar uygula kosulunda)', () => {
  const yazimlar = [...UC.matchAll(/UPDATE retirement_targets/g)].map((m) => m.index);
  assert.ok(yazimlar.length >= 2, 'yazim yok');
  // Her `if (uygula) {` blogunun [bas, son) araligi suslu parantez eslemesiyle bulunur;
  // her yazim bu araliklardan birinin ICINDE olmali.
  const bloklar = [];
  for (let k = UC.indexOf('if (uygula) {'); k >= 0; k = UC.indexOf('if (uygula) {', k + 1)) {
    let d = 0;
    let son = -1;
    for (let m = UC.indexOf('{', k); m < UC.length; m++) {
      if (UC[m] === '{') d++;
      else if (UC[m] === '}') { d--; if (d === 0) { son = m; break; } }
    }
    bloklar.push([k, son]);
  }
  for (const i of yazimlar)
    assert.ok(bloklar.some(([a, b]) => i > a && i < b), `uygula disinda yazim: ...${UC.slice(i, i + 60)}`);
  assert.match(UC, /const uygula = req\.body\?\.uygula === true;/, 'uygula varsayilani kesin true olmali (yanlislikla yazim yok)');
});

test('WK4 durdurulmus hedefte yeni vhost KENDILIGINDEN kapanmaz (skip; kapatma onizlemeli yeniden deneme ile)', () => {
  const dur = UC.slice(UC.indexOf("if (t.status === 'stopped')"), UC.indexOf('} else if (DUZENLENIR.has(t.status))'));
  assert.match(dur, /status: 'skip'/, "durdurulmus hedefe 'skip' disinda durum yaziliyor");
  assert.ok(!/status: 'pending'/.test(dur) && !dur.includes('webDondur('), "durdurulmus hedefe 'pending' yazilirsa zamanlayici vhost'u ONAYSIZ kapatir");
  assert.match(dur, /AND status = 'stopped'/, 'yazim durum kosulsuz');
});

test('WK5 zamanlanmis STOP yeni vhostlari da kapatir; calisan is ve silinmis hedefe dokunulmaz; mevcut girdiler korunur', () => {
  assert.match(UC, /if \(t\.status === 'stop_scheduled'\)[^]*webDondur\(eklenen\)/, 'zamanlanmis STOP listesine yeni vhost pending eklenmiyor');
  assert.match(UC, /\['stopping', 'deleting', 'rolling_back', 'planning'\]\.includes\(t\.status\)/, 'calisan isteki hedef korunmuyor');
  assert.match(UC, /t\.deletedAt \|\| t\.status === 'deleted'/, 'silinmis hedef korunmuyor');
  assert.match(UC, /const birlesik = \[\.\.\.\(t\.web \|\| \[\]\), \.\.\.eklenen\]/, 'mevcut liste korunmuyor (yalniz eklenmeli)');
});

test('WK6 ad standardi DISI web sunucusu (GOJBAP07 <- GOJBWP03): vhost konfigundeki AJP/proxy hedefinden bulunur', () => {
  // Ad kurali GOJBAP07 icin GOJBWP07 der; gercek web sunucusu GOJBWP03. Kesif TUM taranmis vhost'lara
  // bakar: worker/proxy hedefi bu uygulamanin sunucusu + JVM portu ise vhost bu uygulamanindir.
  const inv = [{ app: 'ODEME', host: 'GOJBAP07', env: 'PROD', domain: 'gtdmz.com.tr', jboss_version: '7' }];
  const jvm = [{ host: 'GOJBAP07', jvm: 'ODEME', running: 1, auto_start: 'true', scan_date: '2026-10-13', ports: '', cfg_ports: '8159,8230' }];
  const ips = [{ host: 'GOJBAP07', ip: '10.5.5.7' }];
  const vh = [
    { host: 'GOJBWP03', server_name: 'odemeportal.gtdmz.com.tr', aliases: '', listen: '*:443', conf_file: '/a.conf', product: 'IHS', proxy_targets: 'gojbap07.gtdmz.com.tr:8159' },
    { host: 'GOJBWP03', server_name: 'baska.gtdmz.com.tr', aliases: '', listen: '*:443', conf_file: '/b.conf', product: 'IHS', proxy_targets: '10.5.5.7:9999' },
    { host: 'GOJBWP04', server_name: 'odeme-ip.gtdmz.com.tr', aliases: '', listen: '*:443', conf_file: '/c.conf', product: 'IHS', proxy_targets: '10.5.5.7:8230' },
  ];
  const t = buildTargets('ODEME', inv, [], jvm, vh, ips).targets[0];
  assert.deepEqual(t.web.map((w) => `${w.host}/${w.serverName}`).sort(), ['GOJBWP03/odemeportal.gtdmz.com.tr', 'GOJBWP04/odeme-ip.gtdmz.com.tr'], t.webHow);
  assert.ok(t.web.every((w) => w.kaynak === 'ajp'));
});

test('WK7 ayni sunucuda ayni adli JBoss 7 ve 8 JVMi: AJP eslesmesi HEDEFIN surumunun portuyla (GOJBAP10 GFYINTERNETBRANCH)', () => {
  const jvm = [
    { host: 'GOJBAP10', jvm: 'GFYINTERNETBRANCH', gen: 7, running: 1, auto_start: 'true', scan_date: '2026-10-13', ports: '', cfg_ports: '8009,8080' },
    { host: 'GOJBAP10', jvm: 'GFYINTERNETBRANCH', gen: 8, running: 0, auto_start: 'false', scan_date: '2026-10-13', ports: '', cfg_ports: '8108,8182' },
  ];
  const ips = [{ host: 'GOJBAP10', ip: '192.168.114.76' }];
  const vh = [
    { host: 'GOJBWP05', server_name: 'isube.garantibbvakirala.com.tr', aliases: '', listen: '*:443', conf_file: '/ihs.conf', product: 'IHS', proxy_targets: '192.168.114.76:8009' },
    { host: 'GOJBWP06', server_name: 'isube8.garantibbvakirala.com.tr', aliases: '', listen: '*:443', conf_file: '/rha.conf', product: 'RHA', proxy_targets: '192.168.114.76:8108' },
  ];
  const yedi = buildTargets('GFYINTERNETBRANCH', [{ app: 'GFYINTERNETBRANCH', host: 'GOJBAP10', env: 'PROD', domain: 'gtdmz.com.tr', jboss_version: '7' }], [], jvm, vh, ips).targets[0];
  const sekiz = buildTargets('GFYINTERNETBRANCH', [{ app: 'GFYINTERNETBRANCH', host: 'GOJBAP10', env: 'PROD', domain: 'gtdmz.com.tr', jboss_version: '8' }], [], jvm, vh, ips).targets[0];
  assert.deepEqual(yedi.web.map((w) => w.serverName), ['isube.garantibbvakirala.com.tr'], 'JBoss 7 hedefine JBoss 8 vhostu baglandi');
  assert.deepEqual(sekiz.web.map((w) => w.serverName), ['isube8.garantibbvakirala.com.tr'], 'JBoss 8 hedefine JBoss 7 vhostu baglandi');
  assert.equal(yedi.hub.running, true, 'JBoss 7 hedefinin calisma durumu JBoss 8 JVMinden okundu');
  assert.equal(sekiz.hub.running, false);
});

// ── MOD_CLUSTER (2026-10-13): Red Hat Apache + JBoss 8, balancer adi = uygulama adi ──────────────
test('WK8 mod_cluster: balancer://<app> vhostu JBoss 8 hedefine baglanir; JBoss 7 hedefine, baska siteye ve baska ortama BAGLANMAZ', () => {
  const vh = [
    { host: 'GOJBWP05', server_name: 'intservices.garantibbvakirala.com.tr', aliases: '', listen: '*:443', conf_file: '/rha/GFYINTERNETSERVICES.conf', product: 'RHA', proxy_targets: '~DYNAMIC,gfyinternetservices' },
    { host: 'GOJBWAP05', server_name: 'intservices-ank.garantibbvakirala.com.tr', aliases: '', listen: '*:443', conf_file: '/rha/a.conf', product: 'RHA', proxy_targets: '~DYNAMIC,gfyinternetservices' },
    { host: 'GOJBWT05', server_name: 'intservices-t.garantibbvakirala.com.tr', aliases: '', listen: '*:443', conf_file: '/rha/t.conf', product: 'RHA', proxy_targets: '~DYNAMIC,gfyinternetservices' },
    { host: 'GOJBWP05', server_name: 'baska.garantibbvakirala.com.tr', aliases: '', listen: '*:443', conf_file: '/rha/b.conf', product: 'RHA', proxy_targets: '~DYNAMIC,gfyinternetservicesx' },
  ];
  const inv = (v) => [{ app: 'GFYINTERNETSERVICES', host: 'GOJBAP10', env: 'PROD', domain: 'gtdmz.com.tr', jboss_version: v }];
  const sekiz = buildTargets('GFYINTERNETSERVICES', inv('8'), [], [], vh).targets[0];
  assert.deepEqual(sekiz.web.map((w) => `${w.host}/${w.serverName}`), ['GOJBWP05/intservices.garantibbvakirala.com.tr'], sekiz.webHow);
  assert.equal(sekiz.web[0].kaynak, 'mc');
  assert.equal(sekiz.web[0].mcBalancer, 'gfyinternetservices');
  const yedi = buildTargets('GFYINTERNETSERVICES', inv('7'), [], [], vh).targets[0];
  assert.equal(yedi.web.length, 0, 'JBoss 7 hedefine mod_cluster (JBoss 8) vhostu baglandi');
});

test('WK9 mod_cluster 2-tier: Apache ve JBoss 8 ayni sunucuda (gbjbop35) - alt cizgili ad da tutar', () => {
  const vh = [{ host: 'GBJBOP35', server_name: 'compass.fw.garanti.com.tr', aliases: '', listen: '*:80', conf_file: '/usr/apache/conf.d/GBSVCCOMPASS.conf', product: 'RHA', proxy_targets: 'gbsvccompass' }];
  const t = buildTargets('GB_SVC_COMPASS', [{ app: 'GB_SVC_COMPASS', host: 'GBJBOP35', env: 'PROD', domain: 'fw.garanti.com.tr', jboss_version: '8' }], [], [], vh).targets[0];
  assert.equal(t.web[0]?.serverName, 'compass.fw.garanti.com.tr', t.webHow);
});
