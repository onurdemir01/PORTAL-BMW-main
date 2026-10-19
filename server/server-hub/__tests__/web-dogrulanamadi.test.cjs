// server/server-hub/__tests__/web-dogrulanamadi.test.cjs - "sozdizimi DOGRULANAMADI" bulgusu ve bosta IP
// (2026-10-19).
//
// Kullanici: "Bu hatalar normal mi, urunler gercekten var calisiyor ancak bu kontroller mi yapilamadi?"
// ve "urunlerin gercekten var ve calisiyor olmalari bu kontrollerin sagligini anlamamiz acisindan cok
// onemli". Bulgu once urunun CALISIP CALISMADIGINI (ps), sonra kontrolun NEDEN dogrulayamadigini soyler.
//   WD1 uretimdeki RHA ciktisi: calisiyor + kutuphane yolu (config hatasi degil) + error log yetkisi
//   WD2 uretimdeki IHS ciktisi: varsayilan config dosyasi bulunamadi -> baska config ile calisiyor
//   WD3 calisma durumu uc deger: calisiyor / calismiyor (olculdu) / olculemedi (hidepid)
//   WD4 tanimlanmamis cikti eski genel metni korur; detay her zaman sonda
//   WD5 bosta IP BILGI (uyari degil): sunucuyu 'warning'e cekmez, ozet sayisi yerinde; ekran tonu bilgi
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assess } = require('../assess.cjs');

const BUGUN = '2026-10-19';
const NOW = Date.parse(`${BUGUN}T10:00:00Z`);
const WEB = 'GBCJWP01';
const H = (ek = {}) => ({
  host: WEB, scan_date: BUGUN, products: 'IHS RHA', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.4',
  rec_counts: '', scan_errors: '', proc_visibility: 'FULL', sock_visibility: 'PID', loaded_at: `${BUGUN}T06:00:00Z`, ...ek,
});
const W = (product, detail, ek = {}) => ({
  host: WEB, product, running: 1, syntax: 'UNKNOWN', detail, check_class: 'ACCESS_DENIED',
  syntax_verification: 'NOT_VERIFIED', run_as: 'www', check_rc: 1, vhost_trust: 'NONE', running_src: 'PS', ...ek,
});
const bulgu = (web, host = H()) => {
  const r = assess({ hosts: [host], web: [web] }, { now: NOW });
  return r.hosts.find((h) => h.host === WEB).findings.find((f) => f.code === 'SYNTAX_UNVERIFIED');
};

const RHA_URETIM =
  'sozdizimi OLCULEMEDI (kosan: www): (13)Permission denied: AH00086: httpd: could not open error log file /usr/apache/logs/rha_httpd.log. ' +
  'httpd: Syntax error on satir 120 - /usr/apache/conf/httpd.conf: Syntax error on satir 1 - /usr/apache/conf.modules.d/00-ssl.conf: ' +
  'Cannot load modules/mod_ssl.so into server: libssl.so.1.1: cannot open shared object file: No such file or directory';
const IHS_URETIM =
  'sozdizimi OLCULEMEDI (kosan: www): httpd: Could not open configuration file /usr/IBMIHS/conf/httpd.conf: No such file or directory';

test('WD1 RHA: calisiyor + kutuphane yolu (config hatasi degil) + error log yetkisi', () => {
  const f = bulgu(W('RHA', RHA_URETIM));
  assert.equal(f.severity, 'warning');
  assert.match(f.text, /^RHA sözdizimi DOĞRULANAMADI — ürün ÇALIŞIYOR \(süreç görüldü\); /);
  assert.match(f.text, /kütüphane yolunu göremedi \(ör\. libssl\) — config hatası değil, kontrol ortamı eksik/);
  assert.match(f.text, / \+ www bir dosyaya erişemedi \(yetki\)/);
  assert.ok(f.text.endsWith(RHA_URETIM), 'tarayicinin ham detayi sonda kalmali');
  assert.equal(f.fix, null, 'dogrulanamayan sozdiziminde config degistiren eylem onerildi');
});

test('WD2 IHS: varsayilan config bulunamadi -> baska config ile calisiyor', () => {
  const f = bulgu(W('IHS', IHS_URETIM));
  assert.match(f.text, /^IHS sözdizimi DOĞRULANAMADI — ürün ÇALIŞIYOR/);
  assert.match(f.text, /varsayılan config dosyasını bulamadı — ürün başka bir config \/ kurulum yoluyla çalışıyor/);
  assert.doesNotMatch(f.text, /kütüphane/);
});

test('WD3 calisma durumu: calismiyor (olculdu) ve olculemedi (hidepid) ayri', () => {
  const durmus = bulgu(W('IHS', IHS_URETIM, { running: 0, running_src: 'PS_ABSENT' }));
  assert.match(durmus.text, /— ürün çalışmıyor \(süreç yok\); /);
  const kor = bulgu(W('IHS', IHS_URETIM, { running: 0, running_src: 'UNMEASURED' }), H({ proc_visibility: 'BLIND' }));
  assert.match(kor.text, /— ürünün çalışıp çalışmadığı ölçülemedi \(süreç listesi görünmüyor\); /);
  assert.doesNotMatch(kor.text, /çalışmıyor \(süreç yok\)/, 'gorulmeyen surec "calismiyor" sayildi');
});

test('WD4 tanimlanmamis cikti genel metni korur; sertifika nedeni', () => {
  const f = bulgu(W('IHS', 'sozdizimi OLCULEMEDI (kosan: www): AH00023: Can\'t create directory corresponding to MemManagerFile'));
  assert.match(f.text, /hata bir dosyaya erişimden kaynaklanıyor \(yetki ya da eksik dosya\)/);
  const s = bulgu(W('IHS', 'sozdizimi OLCULEMEDI (kosan: www): SSL0227E: SSL Handshake Failed, key database password is wrong'));
  assert.match(s.text, /www sertifika \/ anahtar deposunu okuyamadı/);
});

test('WD5 bosta IP bilgi: sunucuyu warning e cekmez, sayi yerinde; ekran tonu bilgi', () => {
  const r = assess(
    {
      hosts: [H({ products: 'RHA' })],
      web: [W('RHA', '1 vhost', { syntax: 'OK', check_class: 'OK', syntax_verification: 'VERIFIED', check_rc: 0, vhost_trust: 'FULL' })],
      ips: [{ host: WEB, ip: '10.1.1.99', iface: 'eth0:1', primary: 0, used_by: 'none' }],
    },
    { now: NOW },
  );
  const h = r.hosts.find((x) => x.host === WEB);
  const ip = h.findings.find((f) => f.code === 'IP_UNUSED');
  assert.ok(ip, 'bosta IP bulgusu kayboldu');
  assert.equal(ip.severity, 'info');
  assert.notEqual(h.status, 'warning', 'bosta IP sunucuyu uyariya cekti');
  assert.equal(r.summary.ips.unused, 1, 'bosta IP sayisi yerinde kalmali');
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'server_hub', 'ServerHubPage.tsx'), 'utf8');
  assert.match(ui, /title="Boşta IP"[\s\S]{0,200}tone=\{s\.ips\.unused \? 'info' : 'ok'\}/);
  assert.doesNotMatch(ui, /value: s\.ips\.unused, color: SEV\.warning\.color/);
  assert.doesNotMatch(ui, /h\.unusedIps \? \{ color: SEV\.warning\.color/);
});
