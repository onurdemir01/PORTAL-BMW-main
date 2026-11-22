// server/retirement/__tests__/dns-ip.test.js — DI1..DI6 (2026-10-09).
//
// Kullanici: "hangi IP'nin iade edilecegi ve hangi DNS'in sildirilecegi guzelce gosterilsin;
// vhost'un dinledigi IP baska vhost tarafindan dinleniyorsa iade edilmeyecek; DNS turunu ben secerim."
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dnsIpOzeti, ipOf } = require('../dns-ip.cjs');

const REC = {
  dnsReuse: false,
  lbReuse: false,
  targets: [
    {
      host: 'ORJBOP10',
      appName: 'RECON',
      web: [
        { host: 'ORNGXP10', serverName: 'recon.fw.sirket.invalid', port: '443' },
        { host: 'ORNGXP10', serverName: 'recon.fw.sirket.invalid', port: '80' },
      ],
    },
    {
      host: 'ORJBOP11',
      appName: 'RECON',
      web: [{ host: 'ORNGXP11', serverName: 'recon2.fw.sirket.invalid', port: '443' }],
    },
  ],
};
const V = (host, sn, listen, aliases = '') => ({
  host,
  server_name: sn,
  listen,
  aliases,
  conf_file: `/c/${sn}.conf`,
});
const VHOST = [
  V('ORNGXP10', 'recon.fw.sirket.invalid', '10.1.1.5:443', 'recon-eski.fw.sirket.invalid'),
  V('ORNGXP10', 'recon.fw.sirket.invalid', '10.1.1.5:80'),
  V('ORNGXP11', 'recon2.fw.sirket.invalid', '10.2.2.7:443'),
  V('ORNGXP11', 'baska.fw.sirket.invalid', '10.2.2.7:443'),
  V('ORNGXP12', 'diger.fw.sirket.invalid', '10.9.9.9:443', 'recon-eski.fw.sirket.invalid'),
];
const COZ = {
  'recon.fw.sirket.invalid': { ips: ['10.50.0.1'] },
  'recon2.fw.sirket.invalid': { ips: ['10.50.0.2'] },
  'recon-eski.fw.sirket.invalid': { ips: ['10.50.0.1'] },
};
const taranan = new Set(['ORNGXP10', 'ORNGXP11', 'ORNGXP12']);

test('DI1 kendi :80/:443 bloklari paylasim SAYILMAZ -> vhost IP iade; baska vhost dinliyorsa iade EDILMEZ', () => {
  const o = dnsIpOzeti(REC, { vhostRows: VHOST, cozum: COZ, taranan });
  const a = o.vhostIp.find((x) => x.ip === '10.1.1.5');
  assert.equal(a.durum, 'iade');
  const b = o.vhostIp.find((x) => x.ip === '10.2.2.7');
  assert.equal(b.durum, 'iade_edilmez', 'baska vhost dinledigi halde IP iade ediliyor');
  assert.deepEqual(b.digerleri, ['baska.fw.sirket.invalid']);
});

test('DI2 DNS adlari ServerName + ServerAlias; baska vhost ayni adi kullaniyorsa SILINMEMELI', () => {
  const o = dnsIpOzeti(REC, { vhostRows: VHOST, cozum: COZ, taranan });
  assert.deepEqual(
    o.dns.map((d) => d.ad),
    ['recon-eski.fw.sirket.invalid', 'recon.fw.sirket.invalid', 'recon2.fw.sirket.invalid'],
  );
  const eski = o.dns.find((d) => d.ad === 'recon-eski.fw.sirket.invalid');
  assert.equal(eski.durum, 'silinmemeli');
  assert.equal(o.dns.find((d) => d.ad === 'recon.fw.sirket.invalid').durum, 'silinecek');
  // Silinmemesi gereken DNS'in cozuldugu VIP de iade EDILMEZ
  assert.equal(o.vip.find((x) => x.ip === '10.50.0.1').durum, 'iade_edilmez');
  assert.equal(o.vip.find((x) => x.ip === '10.50.0.2').durum, 'iade');
});

test('DI3 OLCULEMEDI != iade: web sunucusu taranmadiysa IP paylasimi bilinmez; DNS cozulemediyse VIP "yok" degil', () => {
  const o = dnsIpOzeti(REC, {
    vhostRows: VHOST,
    cozum: { 'recon.fw.sirket.invalid': { hata: 'zaman asimi' } },
    taranan: new Set(['ORNGXP11']),
  });
  assert.equal(o.vhostIp.find((x) => x.ip === '10.1.1.5').durum, 'olculemedi');
  const d = o.dns.find((x) => x.ad === 'recon.fw.sirket.invalid');
  assert.equal(d.vip, null);
  assert.equal(d.cozumHata, 'zaman asimi');
});

test("DI4 belirli IP'ye bagli olmayan vhost (*:443) iade edilecek IP uretmez", () => {
  const rec = {
    targets: [{ host: 'A', appName: 'X', web: [{ host: 'W', serverName: 'x.fw.sirket.invalid' }] }],
  };
  const o = dnsIpOzeti(rec, {
    vhostRows: [V('W', 'x.fw.sirket.invalid', '*:443')],
    taranan: new Set(['W']),
  });
  assert.deepEqual(
    o.vhostIp.map((x) => [x.ip, x.durum]),
    [[null, 'ozel_ip_yok']],
  );
  assert.equal(ipOf('10.0.0.1:443'), '10.0.0.1');
  assert.equal(ipOf('*:80'), '*');
});

test('DI5 DNS turu TAHMIN EDILMEZ; secilince Smart akisi; dnsReuse/lbReuse "kalacak"', () => {
  let o = dnsIpOzeti(REC, { vhostRows: VHOST, cozum: COZ, taranan });
  assert.ok(
    o.dns.every((d) => d.tur === null && d.smartAkisi === null),
    'tur tahmin edildi',
  );
  o = dnsIpOzeti(REC, {
    vhostRows: VHOST,
    cozum: COZ,
    taranan,
    turler: {
      'recon.fw.sirket.invalid': 'internet',
      'recon2.fw.sirket.invalid': 'intranet',
      x: 'uydurma',
    },
  });
  assert.equal(o.dns.find((d) => d.ad === 'recon.fw.sirket.invalid').smartAkisi, '349792_Delete');
  assert.equal(
    o.dns.find((d) => d.ad === 'recon2.fw.sirket.invalid').smartAkisi,
    '2523535_Delete_6',
  );
  o = dnsIpOzeti(
    { ...REC, dnsReuse: true, lbReuse: true },
    { vhostRows: VHOST, cozum: COZ, taranan },
  );
  assert.ok(o.dns.every((d) => d.durum === 'kalacak'));
  assert.ok(o.vip.every((x) => x.durum === 'kalacak'));
});

test("DI6 sertifika envanteri de paylasim kaniti: ayni IP'de baska server_name varsa iade EDILMEZ", () => {
  const o = dnsIpOzeti(REC, {
    vhostRows: VHOST.filter((v) => v.server_name !== 'baska.fw.sirket.invalid'),
    certRows: [{ host: 'ORNGXP11', ip: '10.2.2.7', server_name: 'sertifikali.fw.sirket.invalid' }],
    cozum: COZ,
    taranan,
  });
  assert.equal(o.vhostIp.find((x) => x.ip === '10.2.2.7').durum, 'iade_edilmez');
});
