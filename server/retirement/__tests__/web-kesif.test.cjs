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
  return IDX.slice(i, IDX.indexOf("router.post('/:id/targets/:tid/refresh-status'", i));
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
