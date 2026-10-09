// server/retirement/__tests__/dns-ip.test.cjs — DI1..DI6 (2026-10-09).
//
// Kullanici: "hangi IP'nin iade edilecegi ve hangi DNS'in sildirilecegi guzelce gosterilsin;
// vhost'un dinledigi IP baska vhost tarafindan dinleniyorsa iade edilmeyecek; DNS turunu ben secerim."
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dnsIpOzeti, ipOf } = require('../dns-ip.cjs');

const REC = {
  dnsReuse: false, lbReuse: false,
  targets: [
    { host: 'GBJBOP10', appName: 'RECON', web: [
      { host: 'GBNGXP10', serverName: 'recon.fw.garanti.com.tr', port: '443' },
      { host: 'GBNGXP10', serverName: 'recon.fw.garanti.com.tr', port: '80' },
    ] },
    { host: 'GBJBOP11', appName: 'RECON', web: [{ host: 'GBNGXP11', serverName: 'recon2.fw.garanti.com.tr', port: '443' }] },
  ],
};
const V = (host, sn, listen, aliases = '') => ({ host, server_name: sn, listen, aliases, conf_file: `/c/${sn}.conf` });
const VHOST = [
  V('GBNGXP10', 'recon.fw.garanti.com.tr', '10.1.1.5:443', 'recon-eski.fw.garanti.com.tr'),
  V('GBNGXP10', 'recon.fw.garanti.com.tr', '10.1.1.5:80'),
  V('GBNGXP11', 'recon2.fw.garanti.com.tr', '10.2.2.7:443'),
  V('GBNGXP11', 'baska.fw.garanti.com.tr', '10.2.2.7:443'),
  V('GBNGXP12', 'diger.fw.garanti.com.tr', '10.9.9.9:443', 'recon-eski.fw.garanti.com.tr'),
];
const COZ = { 'recon.fw.garanti.com.tr': { ips: ['10.50.0.1'] }, 'recon2.fw.garanti.com.tr': { ips: ['10.50.0.2'] }, 'recon-eski.fw.garanti.com.tr': { ips: ['10.50.0.1'] } };
const taranan = new Set(['GBNGXP10', 'GBNGXP11', 'GBNGXP12']);

test('DI1 kendi :80/:443 bloklari paylasim SAYILMAZ -> vhost IP iade; baska vhost dinliyorsa iade EDILMEZ', () => {
  const o = dnsIpOzeti(REC, { vhostRows: VHOST, cozum: COZ, taranan });
  const a = o.vhostIp.find((x) => x.ip === '10.1.1.5');
  assert.equal(a.durum, 'iade');
  const b = o.vhostIp.find((x) => x.ip === '10.2.2.7');
  assert.equal(b.durum, 'iade_edilmez', 'baska vhost dinledigi halde IP iade ediliyor');
  assert.deepEqual(b.digerleri, ['baska.fw.garanti.com.tr']);
});

test('DI2 DNS adlari ServerName + ServerAlias; baska vhost ayni adi kullaniyorsa SILINMEMELI', () => {
  const o = dnsIpOzeti(REC, { vhostRows: VHOST, cozum: COZ, taranan });
  assert.deepEqual(o.dns.map((d) => d.ad), ['recon-eski.fw.garanti.com.tr', 'recon.fw.garanti.com.tr', 'recon2.fw.garanti.com.tr']);
  const eski = o.dns.find((d) => d.ad === 'recon-eski.fw.garanti.com.tr');
  assert.equal(eski.durum, 'silinmemeli');
  assert.equal(o.dns.find((d) => d.ad === 'recon.fw.garanti.com.tr').durum, 'silinecek');
  // Silinmemesi gereken DNS'in cozuldugu VIP de iade EDILMEZ
  assert.equal(o.vip.find((x) => x.ip === '10.50.0.1').durum, 'iade_edilmez');
  assert.equal(o.vip.find((x) => x.ip === '10.50.0.2').durum, 'iade');
});

test('DI3 OLCULEMEDI != iade: web sunucusu taranmadiysa IP paylasimi bilinmez; DNS cozulemediyse VIP "yok" degil', () => {
  const o = dnsIpOzeti(REC, { vhostRows: VHOST, cozum: { 'recon.fw.garanti.com.tr': { hata: 'zaman asimi' } }, taranan: new Set(['GBNGXP11']) });
  assert.equal(o.vhostIp.find((x) => x.ip === '10.1.1.5').durum, 'olculemedi');
  const d = o.dns.find((x) => x.ad === 'recon.fw.garanti.com.tr');
  assert.equal(d.vip, null);
  assert.equal(d.cozumHata, 'zaman asimi');
});

test('DI4 belirli IP\'ye bagli olmayan vhost (*:443) iade edilecek IP uretmez', () => {
  const rec = { targets: [{ host: 'A', appName: 'X', web: [{ host: 'W', serverName: 'x.fw.garanti.com.tr' }] }] };
  const o = dnsIpOzeti(rec, { vhostRows: [V('W', 'x.fw.garanti.com.tr', '*:443')], taranan: new Set(['W']) });
  assert.deepEqual(o.vhostIp.map((x) => [x.ip, x.durum]), [[null, 'ozel_ip_yok']]);
  assert.equal(ipOf('10.0.0.1:443'), '10.0.0.1');
  assert.equal(ipOf('*:80'), '*');
});

test('DI5 DNS turu TAHMIN EDILMEZ; secilince Smart akisi; dnsReuse/lbReuse "kalacak"', () => {
  let o = dnsIpOzeti(REC, { vhostRows: VHOST, cozum: COZ, taranan });
  assert.ok(o.dns.every((d) => d.tur === null && d.smartAkisi === null), 'tur tahmin edildi');
  o = dnsIpOzeti(REC, { vhostRows: VHOST, cozum: COZ, taranan, turler: { 'recon.fw.garanti.com.tr': 'internet', 'recon2.fw.garanti.com.tr': 'intranet', x: 'uydurma' } });
  assert.equal(o.dns.find((d) => d.ad === 'recon.fw.garanti.com.tr').smartAkisi, '349792_Delete');
  assert.equal(o.dns.find((d) => d.ad === 'recon2.fw.garanti.com.tr').smartAkisi, '2523535_Delete_6');
  o = dnsIpOzeti({ ...REC, dnsReuse: true, lbReuse: true }, { vhostRows: VHOST, cozum: COZ, taranan });
  assert.ok(o.dns.every((d) => d.durum === 'kalacak'));
  assert.ok(o.vip.every((x) => x.durum === 'kalacak'));
});

test('DI6 sertifika envanteri de paylasim kaniti: ayni IP\'de baska server_name varsa iade EDILMEZ', () => {
  const o = dnsIpOzeti(REC, { vhostRows: VHOST.filter((v) => v.server_name !== 'baska.fw.garanti.com.tr'), certRows: [{ host: 'GBNGXP11', ip: '10.2.2.7', server_name: 'sertifikali.fw.garanti.com.tr' }], cozum: COZ, taranan });
  assert.equal(o.vhostIp.find((x) => x.ip === '10.2.2.7').durum, 'iade_edilmez');
});
