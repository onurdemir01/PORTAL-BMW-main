// server/nginx-loadtest/__tests__/dogrula.test.cjs - Yuk Testi girdi ve guvenlik kapilari (2026-10-27).
//
//   YD1 ortam kapisi: ad kurali ESAS; PROD / EDU / BILINMIYOR reddedilir
//   YD2 baska kaynaktan gelen HER uretim isareti kapatir (nginx_inventory.env, Inventory.env, PROD RP listesi)
//   YD3 envanterde olmayan hedef ve bos / okunamayan envanter (424, "yok" SAYILMAZ)
//   YD4 yuk makinesi: izin listesi, hedeften farkli, non-prod, envanterde
//   YD5 sinirlar ve butce (sozlesme formulu), rate limit / limit_conn daraltmasi
//   YD6 senaryo satirlari: beyaz liste, '//' / '..' / ters egik / kodlu nokta / sorgu, kisisel veri
//   YD7 Host (vhost) ve IP enjeksiyonu: CRLF, port, joker, regex, geri donus IP'si
//   YD8 on kontrol degerlendirmesi: engeller ve acik onay isteyen uyarilar
//   YD9 extra_vars son kapisi: fazladan anahtar (LIMIT_MUAF), bozuk b64 / sha, kanonik TSV
//   YD10 kaynaklariOku: dogru tablolar, IN listesi parametreli, tablo yoksa "veri yok", hata 424
//   YD11 e-posta suphesi DOGRUSAL: eski ifadeyle rastgele 20.000+ dizgide birebir ayni, 2 KB < 50 ms
//   YD12 ';' (yol parametresi, ;jsessionid) her katmanda reddedilir
//   YD13 boyut / satir sayisi siniri satir denetiminden ONCE
//   YD14 olculmus limit 0 (limit_req < 2 r/s, limit_conn <= 1) hedefi kapatir; global tavana DUSMEZ
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const dg = require('../dogrula.cjs');

const SATIR = (yol, ek = {}) => ({ agirlik: 1, har: 1, tur: 'js', boyut: 'kucuk', yol, ...ek });

test('YD1 ortam kapisi: ad kurali esas, yalniz DEV/TEST/QA', () => {
  const kaynak = { nginxSatiri: { env: 'test' }, invEnv: 'Test' };
  assert.equal(dg.hedefKapisi('GBNGXT33', kaynak).ok, true);
  assert.equal(dg.hedefKapisi('GBNGXD01', { nginxSatiri: { env: 'dev' } }).ok, true);
  assert.equal(dg.hedefKapisi('GBNGWQ02', { nginxSatiri: { env: 'qa' } }).ok, true);
  for (const [host, env] of [['GBNGXP40', 'PROD'], ['GBRVPP01', 'PROD'], ['GBNGXAP32', 'PROD'], ['GBNGXT51', 'EDU'], ['GBLABT02', 'BILINMIYOR'], ['WEBSRV01', 'BILINMIYOR']]) {
    const r = dg.hedefKapisi(host, kaynak);
    assert.equal(r.ok, false, `${host} gecti`);
    assert.equal(r.status, 409);
    assert.equal(r.code, 'hedef_uretim', host);
    assert.equal(r.env, env, host);
  }
  // Ad kurali, envanter TEST dese bile kazanir (envanter yalniz uretim ISARETI ekler).
  assert.equal(dg.hedefKapisi('GBNGXP40', { nginxSatiri: { env: 'test' }, invEnv: 'Test' }).code, 'hedef_uretim');
});

test('YD2 baska kaynaktan gelen her uretim isareti kapatir; kapi gevsemez', () => {
  for (const kaynak of [
    { nginxSatiri: { env: 'Production' }, invEnv: 'Test' },
    { nginxSatiri: { env: 'prod' }, invEnv: null },
    { nginxSatiri: { env: 'test' }, invEnv: 'Production' },
    { nginxSatiri: { env: 'test' }, invEnv: 'PRD' },
    { nginxSatiri: { env: 'canli' }, invEnv: undefined },
  ]) {
    const r = dg.hedefKapisi('GBNGXT33', kaynak);
    assert.equal(r.ok, false, JSON.stringify(kaynak));
    assert.equal(r.code, 'hedef_uretim');
    assert.match(r.message, /üretim işareti/);
  }
  // preprod / nonprod uretim DEGIL (prod-approval kurali): kapi acik kalir.
  assert.equal(dg.hedefKapisi('GBNGXT33', { nginxSatiri: { env: 'preprod' }, invEnv: 'nonprod' }).ok, true);
  // PROD RP listesindeki bir host (ad kurali D/T/Q dese bile) kapanir.
  const { internetRpHosts } = require('../../audit/nginx-hosts.cjs');
  const prodRp = internetRpHosts().byEnv.PROD.find((h) => /^GBNG[WX]A?[DTQ]/.test(h));
  if (prodRp) assert.equal(dg.hedefKapisi(prodRp, { nginxSatiri: { env: 'test' } }).code, 'hedef_uretim');
  assert.match(String(dg.uretimIsareti({ host: 'GBNGXT33', nginxEnv: 'x', invEnv: 'Production' })), /Inventory\.env=Production/);
});

test('YD3 envanterde olmayan hedef 409; bos ya da okunamayan envanter 424 (yok SAYILMAZ)', async () => {
  const r = dg.hedefKapisi('GBNGXT33', { nginxSatiri: null, invEnv: null });
  assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'hedef_envanterde_yok']);
  const sql = { NVarChar: () => 'nv' };
  await assert.rejects(dg.kaynaklariOku({ sql, query: async () => ({ recordset: [] }) }), (e) => e.status === 424 && e.code === 'envanter_okunamadi');
  await assert.rejects(
    dg.kaynaklariOku({ sql, query: async () => { throw new Error('baglanti yok'); } }),
    (e) => e.status === 424 && e.code === 'envanter_okunamadi' && /nginx_inventory/.test(e.message),
  );
  // Ikinci kaynak (dbo.Inventory) okunamazsa da 424.
  await assert.rejects(
    dg.kaynaklariOku({
      sql,
      hostlar: ['GBNGXT33'],
      query: async (q) => {
        if (/FROM dbo\.nginx_inventory/.test(q)) return { recordset: [{ hostname: 'GBNGXT33', env: 'test', ip: '10.0.0.5' }] };
        throw new Error('Inventory kapali');
      },
    }),
    (e) => e.status === 424 && /dbo\.Inventory/.test(e.message),
  );
});

test('YD4 yuk makinesi: izin listesi, hedeften farkli, non-prod, envanterde', () => {
  const izinli = ['GBNGXT34', 'GBNGXP50', 'GBLABT02'];
  const tamam = { izinli, hedef: 'GBNGXT33', nginxSatiri: { env: 'test' }, invEnv: 'Test', invVar: true };
  assert.equal(dg.yukHostKapisi('GBNGXT34', tamam).ok, true);
  assert.equal(dg.yukHostKapisi('GBNGXT35', tamam).code, 'yuk_host_izinsiz');
  assert.equal(dg.yukHostKapisi('GBNGXT34', { ...tamam, hedef: 'GBNGXT34' }).code, 'ayni_host');
  assert.equal(dg.yukHostKapisi('GBNGXP50', tamam).code, 'yuk_host_izinsiz', 'prod yuk makinesi izin listesinde diye gecti');
  assert.equal(dg.yukHostKapisi('GBLABT02', tamam).code, 'yuk_host_izinsiz', 'BILINMIYOR ortamli yuk makinesi gecti');
  assert.equal(dg.yukHostKapisi('GBNGXT34', { ...tamam, invEnv: 'Production' }).code, 'yuk_host_izinsiz');
  assert.equal(dg.yukHostKapisi('GBNGXT34', { ...tamam, nginxSatiri: null, invVar: false }).code, 'yuk_host_izinsiz');
  assert.equal(dg.yukHostKapisi('GBNGXT34', { ...tamam, nginxSatiri: null, invVar: true }).ok, true);
  // Izin listesi env'den: bos -> varsayilan; gecersiz girdi atilir (liste daralir, genislemez).
  assert.deepEqual(dg.yukHostlari({}), ['GBNGXT34']);
  assert.deepEqual(dg.yukHostlari({ NGINX_LOADTEST_YUK_HOSTLARI: 'gbngxt34, GBNGXD02;bad_host;' }), ['GBNGXT34', 'GBNGXD02']);
  assert.deepEqual(dg.yukHostlari({ NGINX_LOADTEST_YUK_HOSTLARI: '!!!' }), []);
});

test('YD5 sinirlar, butce formulu ve rate limit daraltmasi', () => {
  const ok = dg.parametreler({}, { sni: false });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.deger, { hizlar: [100, 250, 400], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'yeni', ae: 'br', sni: false, butceSn: 60 + 3 * 2 * (30 + 120 + 30 + 20) + 120 });
  // Ayni girdi -> ayni nesne (on kontrol / kosu "ayni parametre" kosulu buna dayanir).
  assert.deepEqual(dg.parametreler({ ...ok.deger }, { sni: false }).deger, ok.deger);
  const asim = (p, ek) => {
    const r = dg.parametreler(p, { sni: false, ...ek });
    assert.equal(r.ok, false, JSON.stringify(p));
    return r;
  };
  for (const p of [
    { hizlar: [451] }, { hizlar: [0] }, { hizlar: [1, 2, 3, 4, 5, 6] }, { hizlar: [100, 100] }, { tekrar: 4 }, { tekrar: 0 },
    { isinma: 4 }, { isinma: 61 }, { sure: 29 }, { sure: 39 }, { sure: 301 }, { bosluk: 121 }, { bosta: 29 }, { bosta: 121 },
    { maxvu: 9 }, { maxvu: 200 },
  ]) assert.equal(asim(p).code, 'sinir_asildi', JSON.stringify(p));
  // Analiz penceresi >= 30 sn ister ([+3, -2] kirpma, 1 sn ornek): olcum suresi en az 40 sn.
  assert.equal(dg.SINIRLAR.sureMin, 40);
  assert.match(asim({ sure: 39 }).message, /süre 39 \(izinli 40\.\.300\)/);
  assert.equal(dg.parametreler({ sure: 40 }, { sni: false }).ok, true);
  assert.ok(dg.ekstraDegiskenleriDenetle(evOrnek({ yuk_sure_sn: '39' })).includes('yuk_sure_sn'), 'son kapi 39 sn kabul etti');
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(evOrnek({ yuk_sure_sn: '40' })), []);
  // Butce: 5 hiz x 3 tekrar x (60+300+120) > 2700.
  const b = asim({ hizlar: [10, 20, 30, 40, 50], tekrar: 3, isinma: 60, sure: 300, bosluk: 120 });
  assert.match(b.message, /toplam süre \d+ sn > 2700/);
  // Adim basina 20 sn ek pay (k6 acilisi, setup yoklamasi, gracefulStop): playbook'un `>= ek paysiz formul`
  // kapisini her zaman gecer, 15 adimli kosuda kos.sh timeout'a dusmez.
  assert.equal(dg.ADIM_EK_SN, 20);
  assert.equal(dg.butceSn({ hizlar: [1, 2], tekrar: 1, isinma: 5, sure: 30, bosluk: 0, bosta: 30 }), 30 + 2 * (35 + 20) + 120);
  // Tip hatasi 400; enum hatasi 400.
  assert.equal(asim({ tekrar: 'iki' }).status, 400);
  assert.equal(asim({ kip: 'cok' }).status, 400);
  assert.equal(asim({ ae: 'zstd' }).status, 400);
  assert.equal(dg.parametreler({}, {}).status, 400, 'sni boolean degilse gecti');
  // Rate limit daraltmasi: hiz <= 0.9 x olculen limit_req, maxvu <= limit_conn - 1.
  const t = dg.rateLimitTavani([
    { directive: 'limit_req_zone', value: '$binary_remote_addr zone=request_limit:20m rate=200r/s' },
    { directive: 'limit_req_zone', value: '$server_name zone=server_limit:50m rate=5000r/s' },
    { directive: 'limit_req', value: 'zone=request_limit burst=200 nodelay' },
    { directive: 'limit_conn_zone', value: '$binary_remote_addr zone=limit_connection_perip:20m' },
    { directive: 'limit_conn', value: 'limit_connection_perip 100' },
  ]);
  assert.deepEqual(t, { hizSiniri: 180, vuSiniri: 99 });
  assert.equal(asim({ hizlar: [181] }, t).code, 'sinir_asildi');
  assert.equal(asim({ maxvu: 100 }, t).code, 'sinir_asildi');
  assert.equal(dg.parametreler({ hizlar: [180], maxvu: 99 }, { sni: true, ...t }).ok, true);
  // Olcum yoksa daraltma yok (null); dakika birimi saniyeye cevrilir.
  assert.deepEqual(dg.rateLimitTavani([]), { hizSiniri: null, vuSiniri: null });
  assert.equal(dg.rateLimitTavani([{ directive: 'limit_req_zone', value: '$binary_remote_addr zone=z:1m rate=600r/m' }]).hizSiniri, 9);
});

test('YD6 senaryo satirlari: beyaz liste ve enjeksiyon yollari reddedilir', () => {
  for (const yol of ['/a.js', '/static/js/main.4f2a.js', "/x/(a)!$&'*+,=:@~-_.%20b.css", '/']) {
    assert.equal(dg.yolDenetle(yol), '', yol);
  }
  for (const yol of [
    '//evil.com/x', '/a/../etc/passwd', '/..', '/a?b=1', '/a#x', '/a\\b', '/a b', 'a.js', 'https://evil.com/a',
    '/a%2e%2e/b', '/a%2F..', '/a%5cb', '/a%00', '/a%0d%0aX:1', '/a%252e', '/a%zz', '/a\r\nHost: x', '/123456/x',
    '/kullanici/ali@ornek.com', '/tckn/12345678901', '/x'.repeat(1100),
  ]) assert.notEqual(dg.yolDenetle(yol), '', `kabul edildi: ${JSON.stringify(yol).slice(0, 60)}`);
  // Statik dosya adinda @ kisisel veri sayilmaz (python ile ayni).
  assert.equal(dg.yolDenetle('/img/logo@2x.png'), '');

  const s = dg.senaryoSatirlari([SATIR('/a.js'), SATIR('/b.css', { agirlik: 2.5, tur: 'css' }), SATIR('/a.js', { har: 2 })]);
  assert.equal(s.ok, true);
  assert.equal(s.tsv, '1\t1\tjs\tkucuk\t/a.js\n2.5\t1\tcss\tkucuk\t/b.css\n1\t2\tjs\tkucuk\t/a.js\n');
  assert.equal(s.yolSayisi, 2);
  assert.equal(s.sha256, dg.sha256Hex(s.tsv));
  // Kanonik agirlik: kos.sh deseni [0-9.]+ (us YOK).
  assert.equal(dg.agirlikBicim(1e-7), null);
  assert.equal(dg.agirlikBicim(0.0000015), '0.000002');
  assert.equal(dg.agirlikBicim('3'), '3');
  assert.equal(dg.agirlikBicim(-1), null);
  for (const kotu of [[], null, [SATIR('/a?x')], [SATIR('/a', { tur: 'exe' })], [SATIR('/a', { boyut: 'dev' })], [SATIR('/a', { har: -1 })], [SATIR('/a', { agirlik: 0 })], ['x']]) {
    assert.equal(dg.senaryoSatirlari(kotu).ok, false, JSON.stringify(kotu));
  }
  const cok = dg.senaryoSatirlari(Array.from({ length: 401 }, (_, i) => SATIR(`/p${i}.js`)));
  assert.deepEqual([cok.status, cok.code], [409, 'sinir_asildi']);
  assert.equal(dg.senaryoSatirlari(Array.from({ length: 400 }, (_, i) => SATIR(`/p${i}.js`))).ok, true);
  const buyuk = dg.senaryoSatirlari(Array.from({ length: 200 }, (_, i) => SATIR(`/${'a'.repeat(1100)}${i}.js`)));
  assert.equal(buyuk.code, 'sinir_asildi', '200 KB siniri uygulanmadi');

  const g = dg.senaryoGovdesi({ ad: ' K ', senaryoTur: 'K', kaynak: 'har', vhost: 'App.Test.Local', satirlar: [SATIR('/a.js')], ozet: { K_satir: 1, tur: { js: 1 } } });
  assert.equal(g.ok, true);
  assert.equal(g.deger.ad, 'K');
  assert.equal(g.deger.vhost, 'app.test.local');
  assert.equal(g.deger.ozet, '{"K_satir":1,"tur":{"js":1}}');
  assert.equal(dg.senaryoGovdesi({ ad: 'K', senaryoTur: 'X', kaynak: 'har', satirlar: [SATIR('/a')] }).ok, false);
  assert.equal(dg.senaryoGovdesi({ ad: 'K', senaryoTur: 'K', kaynak: 'url', satirlar: [SATIR('/a')] }).ok, false);
  assert.equal(dg.senaryoGovdesi({ ad: 'K', senaryoTur: 'K', kaynak: 'har', vhost: 'a.b:443', satirlar: [SATIR('/a')] }).ok, false);
  assert.equal(dg.senaryoGovdesi({ ad: 'K', senaryoTur: 'K', kaynak: 'har', satirlar: [SATIR('/a')], ozet: { a: 'x\ny' } }).ok, false);
  assert.equal(dg.senaryoGovdesi({ ad: 'K', senaryoTur: 'K', kaynak: 'har', satirlar: [SATIR('/a')], ozet: [1] }).ok, false);
  assert.equal(dg.senaryoGovdesi({ ad: '', senaryoTur: 'K', kaynak: 'har', satirlar: [SATIR('/a')] }).ok, false);
});

test('YD7 Host ve IP enjeksiyonu reddedilir', () => {
  for (const v of ['app.test.local', 'a', 'x-1.y2.z']) assert.equal(dg.gecerliVhost(v), true, v);
  for (const v of ['App.test.local', 'a.b:443', '*.a.b', '~^a', 'a b', 'a.b\r\nX-Evil: 1', 'a..b', '-a.b', 'a.b.', '', 'a/b', 'a_b.c', `${'a'.repeat(64)}.b`]) {
    assert.equal(dg.gecerliVhost(v), false, JSON.stringify(v));
  }
  for (const ip of ['10.1.2.3', '192.168.0.10']) assert.equal(dg.kullanilabilirIp(ip), true, ip);
  for (const ip of ['127.0.0.1', '0.0.0.0', '169.254.1.1', '224.0.0.1', '255.255.255.255', '10.1.2', '10.1.2.3.4', '010.1.2.3', '10.1.2.256', ' 10.1.2.3', '10.1.2.3\n', 'evil.com']) {
    assert.equal(dg.kullanilabilirIp(ip), false, JSON.stringify(ip));
  }
  for (const h of ['GBNGXT33', ' gbngxt33 ']) assert.equal(dg.hostNormalle(h), 'GBNGXT33');
  for (const h of ['GB NG', 'GBNGXT33;rm', 'G', '-GB', 'GBNGXT33\r\nX', 'A'.repeat(32), '../x']) assert.equal(dg.hostNormalle(h), '', JSON.stringify(h));
  // Aday IP: listen'den ve envanterden; joker / geri donus / IPv6 aday OLMAZ.
  assert.deepEqual(
    dg.adayIpler({ listenler: ['10.0.0.9:443 ssl', '443', '*:80', '[::]:443', '127.0.0.1:8080', '10.0.0.10:443', '10.0.0.9:80'], envanterIp: '10.0.0.5' }),
    ['10.0.0.5', '10.0.0.9', '10.0.0.10'],
  );
  assert.deepEqual(dg.vhostlar(['a.test.local b.test.local', '_', '*.wild.local ~^re$', 'LOCALHOST', 'c.test.local;']), ['a.test.local', 'b.test.local', 'c.test.local']);
});

test('YD8 on kontrol: engeller ve acik onay isteyen uyarilar', () => {
  const temiz = {
    ip_yerel: true, server_name_var: true, master_sayisi: 1, web_log_df: 40, log_dizini_okunur: true, log_format_ua: true,
    statik_direktif: false, k6_var: true, yollar_toplam: 10, yollar_200: 10, sikistirma: { statik: 0, dinamik: 5, sikistirmasiz: 5 },
  };
  assert.deepEqual(dg.onKontrolDegerlendir(temiz), { engeller: [], uyarilar: [] });
  // Degerler metin olarak da gelebilir (set_stats).
  assert.deepEqual(dg.onKontrolDegerlendir({ ...temiz, ip_yerel: 'True', master_sayisi: '1', web_log_df: '40' }).engeller, []);
  const u = (ek) => dg.onKontrolDegerlendir({ ...temiz, ...ek }).uyarilar;
  assert.match(u({ yollar_200: 8 }).join(), /2\/10 yol 200 dönmedi/);
  assert.match(u({ sikistirma: { statik: 3 } }).join(), /ön-sıkıştırılmış dosyalar var/);
  assert.match(u({ web_log_df: 65 }).join(), /%65/);
  assert.match(u({ web_log_df: null }).join(), /ölçülemedi/);
  assert.match(u({ log_format_ua: false }).join(), /user-agent=/);
  assert.match(u({ master_sayisi: null }).join(), /master süreç sayısı ölçülemedi/);
  assert.equal(u({ log_format_ua: null }).length, 0, 'olculemeyen log_format_ua uyari uretmemeli (best effort)');
  const e = (ek) => dg.onKontrolDegerlendir({ ...temiz, ...ek }).engeller;
  assert.equal(e({ ip_yerel: false }).length, 1);
  assert.equal(e({ ip_yerel: null }).length, 1, 'olculemeyen ip_yerel engel degil');
  assert.equal(e({ server_name_var: false }).length, 1);
  assert.equal(e({ k6_var: false }).length, 1);
  assert.equal(e({ yollar_toplam: 0 }).length, 1);
  // /web_log okunamiyorsa ENGEL (playbook da engel sayar); olculemediyse (null) engel degil.
  assert.deepEqual(e({ log_dizini_okunur: false }), ['log dizini /web_log okunamıyor']);
  assert.deepEqual(e({ log_dizini_okunur: 'false' }), ['log dizini /web_log okunamıyor']);
  assert.equal(u({ log_dizini_okunur: false }).length, 0, 'okunamayan log dizini uyari sayildi');
  assert.deepEqual(e({ log_dizini_okunur: null }), []);
  // cpu_kaydedici.sh 0 ya da 2+ master gorurse baslamaz: olculmus != 1 ENGEL (uyari degil).
  assert.match(e({ master_sayisi: 2 }).join(), /master süreç sayısı 2/);
  assert.equal(e({ master_sayisi: '0' }).length, 1);
  assert.equal(u({ master_sayisi: 2 }).length, 0);
  assert.equal(e({ master_sayisi: null }).length, 0, 'olculemeyen master engel degil');
  assert.deepEqual(dg.onKontrolDegerlendir(null).engeller.length, 1);
  assert.equal(dg.onayMetniDogru(' GBNGXT33 ', 'GBNGXT33'), true);
  assert.equal(dg.onayMetniDogru('gbngxt33', 'GBNGXT33'), false);
  assert.equal(dg.onayMetniDogru(undefined, 'GBNGXT33'), false);
});

function evOrnek(ek = {}) {
  const s = dg.senaryoSatirlari([SATIR('/a.js'), SATIR('/b.css', { tur: 'css' })]);
  const p = dg.parametreler({}, { sni: false }).deger;
  return {
    ...dg.ekstraDegiskenler({
      islem: 'kosu', kosuId: 17, hedefHost: 'GBNGXT33', yukHost: 'GBNGXT34', hedefIp: '10.0.0.5', vhost: 'app.test.local',
      senaryo: { tur: 'K', tsv: s.tsv, sha256: s.sha256 }, p, k6: '/home/www/bin/k6', kok: '/sw/BMW_PORTAL/nginx_loadtest',
    }),
    ...ek,
  };
}

test('YD9 extra_vars son kapisi: yalniz sozlesme anahtarlari, hepsi metin, b64 ve sha tutarli', () => {
  const ev = evOrnek();
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(ev), []);
  assert.deepEqual(Object.keys(ev).sort(), [...dg.EKSTRA_ANAHTARLAR].sort());
  for (const [k, v] of Object.entries(ev)) assert.equal(typeof v, 'string', k);
  assert.equal(ev.yuk_hizlar, '100 250 400');
  assert.equal(ev.yuk_butce_sn, '1380'); // 60 + 6 x (30 + 120 + 30 + 20) + 120
  assert.equal(ev.yuk_ua_onek, 'portal-yuktesti');
  assert.equal(Buffer.from(ev.yuk_senaryo_b64, 'base64').toString('utf8'), '1\t1\tjs\tkucuk\t/a.js\n1\t1\tcss\tkucuk\t/b.css\n');
  const ihlal = (ek) => dg.ekstraDegiskenleriDenetle(evOrnek(ek));
  assert.deepEqual(ihlal({ LIMIT_MUAF: '1' }), ['LIMIT_MUAF']);
  assert.deepEqual(ihlal({ http_proxy: 'http://x' }), ['http_proxy']);
  assert.ok(ihlal({ yuk_hizlar: '100 451' }).includes('yuk_hizlar'));
  assert.ok(ihlal({ yuk_yuk_host: 'GBNGXT33' }).includes('yuk_yuk_host'));
  assert.ok(ihlal({ yuk_hedef_ip: '127.0.0.1' }).includes('yuk_hedef_ip'));
  assert.ok(ihlal({ yuk_host_basligi: 'a.b\r\nX: 1' }).includes('yuk_host_basligi'));
  assert.ok(ihlal({ yuk_senaryo_sha256: '0'.repeat(64) }).includes('yuk_senaryo_sha256'));
  assert.ok(ihlal({ yuk_senaryo_b64: Buffer.from('1\t1\tjs\tkucuk\t//evil/x\n').toString('base64') }).includes('yuk_senaryo_b64'));
  assert.ok(ihlal({ yuk_k6_yolu: '/home/../etc/k6' }).includes('yuk_k6_yolu'));
  assert.ok(ihlal({ yuk_cikti_kok: '/sw/../x' }).includes('yuk_cikti_kok'));
  assert.ok(ihlal({ yuk_butce_sn: '2701' }).includes('yuk_butce_sn'));
  assert.ok(ihlal({ yuk_tekrar: 2 }).includes('yuk_tekrar'), 'sayi tipi kabul edildi (metin bekleniyor)');
  const eksik = evOrnek();
  delete eksik.yuk_cikti_kok;
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(eksik), ['yuk_cikti_kok']);
  // Is gecmisine senaryo govdesi gitmez.
  const m = dg.gecmisIcinMaskele(ev);
  assert.match(m.yuk_senaryo_b64, /^<\d+ b64>$/);
  assert.equal(m.yuk_hedef_host, 'GBNGXT33');
  // Ortam: gecersiz k6 / kok yolu varsayilana duser; kosu dizini sunucuda kurulur.
  assert.equal(dg.k6Yolu({ NGINX_LOADTEST_K6: '/opt/k6/bin/k6' }), '/opt/k6/bin/k6');
  assert.equal(dg.k6Yolu({ NGINX_LOADTEST_K6: 'k6; rm -rf /' }), '/home/www/bin/k6');
  assert.equal(dg.ciktiKok({ NGINX_LOADTEST_DIR: '/sw/BMW_PORTAL_DEV/nginx_loadtest/' }), '/sw/BMW_PORTAL_DEV/nginx_loadtest');
  assert.equal(dg.ciktiKok({}), '/sw/BMW_PORTAL/nginx_loadtest');
  assert.equal(dg.kosuDizini('/sw/BMW_PORTAL/nginx_loadtest', '17'), '/sw/BMW_PORTAL/nginx_loadtest/17');
});

test('YD10 kaynaklariOku: parametreli IN listesi, tablo yoksa veri yok, tarama hatasi 424', async () => {
  const sql = { NVarChar: (n) => `nv${n}` };
  const sorgular = [];
  const veri = (tablolarVar) => async (q, params = []) => {
    sorgular.push({ q, params });
    if (/FROM dbo\.nginx_inventory/.test(q)) {
      return { recordset: [
        { hostname: 'gbngxt33', env: 'test', ip: '10.0.0.5' }, { hostname: 'GBNGXT34', env: 'test', ip: '10.0.0.6' },
        { hostname: 'GBNGXP40', env: 'Production', ip: '10.9.0.1' },
      ] };
    }
    if (/FROM dbo\.Inventory/.test(q)) return { recordset: [{ host: 'GBNGXT33', env: 'Test' }] };
    if (/OBJECT_ID/.test(q)) return { recordset: [{ oid: tablolarVar ? 1 : null }] };
    if (/Nginx_Audit_Servers/.test(q)) return { recordset: [{ host: 'GBNGXT33', listen: '10.0.0.9:443 ssl', server_name: 'app.test.local' }] };
    if (/Nginx_Audit_Settings/.test(q)) return { recordset: [{ host: 'GBNGXT33', directive: 'limit_req_zone', value: '$binary_remote_addr zone=r:1m rate=100r/s' }] };
    throw new Error(`beklenmeyen sorgu: ${q}`);
  };
  const k = await dg.kaynaklariOku({ query: veri(true), sql });
  assert.deepEqual([...k.nginx.keys()].sort(), ['GBNGXP40', 'GBNGXT33', 'GBNGXT34']);
  const ay = dg.hedefAyrintisi(k, 'GBNGXT33');
  assert.deepEqual(ay, { ipler: ['10.0.0.5', '10.0.0.9'], vhostlar: ['app.test.local'], hizSiniri: 90, vuSiniri: null });
  // Prod host tarama sorgusuna girmez (/hedefler yolu yalniz non-prod hostlari okur).
  const tarama = sorgular.find((s) => /Nginx_Audit_Servers\s+WHERE/.test(s.q));
  assert.deepEqual(tarama.params.map((p) => p.value).sort(), ['GBNGXT33', 'GBNGXT34']);
  for (const s of sorgular) {
    assert.doesNotMatch(s.q, /GBNGXT3/, 'host adi SQL metnine gomuldu');
  }
  // Tablo yoksa "veri yok" (null): vhost denetimi atlanir, IP envanterden.
  const k2 = await dg.kaynaklariOku({ query: veri(false), sql, hostlar: ['GBNGXT33'] });
  assert.equal(k2.sunucular, null);
  assert.deepEqual(dg.hedefAyrintisi(k2, 'GBNGXT33'), { ipler: ['10.0.0.5'], vhostlar: null, hizSiniri: null, vuSiniri: null });
  // Tarama sorgusu HATASI 424 (okunamadi != yok).
  await assert.rejects(
    dg.kaynaklariOku({ sql, hostlar: ['GBNGXT33'], query: async (q, p) => (/Nginx_Audit_Servers\s+WHERE/.test(q) ? Promise.reject(new Error('timeout')) : veri(true)(q, p)) }),
    (e) => e.status === 424 && /Nginx_Audit_Servers/.test(e.message),
  );
});

// Eski (geri izleyen) ifade: KAHIN. Yeni dogrusal uygulama her girdide bununla ayni karari vermeli.
const EPOSTA_ESKI = /[^/@]+@[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
function rastgele(tohum) {
  let a = tohum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('YD11 e-posta suphesi dogrusal: eski ifadeyle birebir ayni karar, 2 KB yol 50 ms altinda', () => {
  const ALFABE = ['a', 'A', '1', '-', '.', '@', '/', '_'];
  const r = rastgele(20261027);
  const sec = (dizi) => dizi[Math.floor(r() * dizi.length)];
  const uret = (n) => Array.from({ length: n }, () => sec(ALFABE)).join('');
  const farklar = [];
  let pozitif = 0;
  let toplam = 0;
  const karsilastir = (s) => {
    toplam += 1;
    const eski = EPOSTA_ESKI.test(s);
    if (eski) pozitif += 1;
    if (dg.epostaMi(s) !== eski && farklar.length < 10) farklar.push(JSON.stringify(s));
  };
  // 1) Duz rastgele: alfabe sabit, uzunluk 0..40.
  for (let i = 0; i < 20000; i += 1) karsilastir(uret(Math.floor(r() * 41)));
  // 2) E-postaya yakin rastgele (ayni alfabe): pozitif ve sinir durumlari bol olsun.
  const etiket = () => Array.from({ length: 1 + Math.floor(r() * 5) }, () => sec(['a', 'A', '1', '-', 'a', 'A'])).join('');
  for (let i = 0; i < 20000; i += 1) {
    const yerel = uret(Math.floor(r() * 6));
    const alan = Array.from({ length: Math.floor(r() * 4) }, etiket).join('.');
    const son = Array.from({ length: Math.floor(r() * 4) }, () => sec(['a', 'A', 'a', '1'])).join('');
    const gurultu = r() < 0.3 ? uret(Math.floor(r() * 3)) : '';
    karsilastir(`${yerel}@${alan}${r() < 0.8 ? '.' : ''}${son}${gurultu}`.slice(0, 40));
  }
  // 3) Elle secilmis sinirlar.
  for (const s of ['a@b.co', '@b.co', 'a@@b.co', '/@b.co', 'a/@b.co', 'a@b@c.co', 'a@1.co', 'a@-a.co', 'a@a..co', 'a@a.c', 'a@a.c1',
    'a@1a.co', 'a@a1.co', 'a_@a.co', 'a@a_b.co', 'a@a/b.co', 'a@.co', 'a@a.co.', 'ali.veli@ornek.com.tr', 'x@y.zz@', '']) karsilastir(s);
  assert.deepEqual(farklar, [], `dogrusal uygulama eski ifadeden farkli karar verdi: ${farklar.join(', ')}`);
  assert.ok(toplam >= 40000);
  assert.ok(pozitif >= 1000 && toplam - pozitif >= 1000, `ornekte yeterli pozitif/negatif yok (${pozitif}/${toplam}) - karsilastirma iki sonucu da sinamali`);
  // Alan kismi 253 karakterden uzunsa e-posta sayilmaz (DNS tavani; ifade asla bu kadar gitmez).
  assert.equal(dg.epostaMi(`a@${'b'.repeat(250)}.com`), false);
  assert.equal(dg.epostaMi(`a@${'b'.repeat(249)}.com`), true);
  // Zaman: eski ifade 2 KB'lik '/a..@a..' yolunda ~0.5 sn geri izliyordu.
  const sure = (yol) => {
    let en = Infinity;
    for (let i = 0; i < 3; i += 1) {
      const t0 = process.hrtime.bigint();
      dg.yolDenetle(yol);
      en = Math.min(en, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return en;
  };
  for (const yol of [`/${'a'.repeat(1000)}@${'a'.repeat(1000)}`, `/${'a'.repeat(1790)}@${'a'.repeat(250)}`, `/${'a'.repeat(600)}@${'a.'.repeat(120)}a`]) {
    assert.ok(yol.length <= dg.SINIRLAR.maxYolUzunlugu);
    const ms = sure(yol);
    assert.ok(ms < 50, `${yol.length} karakterlik '@'li yol ${ms.toFixed(1)} ms surdu (>= 50 ms: geri izleme)`);
  }
  // Uygulama yeri degismedi: PARCA basina (statik uzantili parca muaf, yol ayiraci parcayi boler).
  assert.equal(dg.kisiselVeriSuphesi('/kullanici/ali@ornek.com/x.js'), true);
  assert.equal(dg.kisiselVeriSuphesi('/img/logo@ornek.com.png'), false);
  assert.equal(dg.kisiselVeriSuphesi('/a@b/ornek.com'), false);
});

test('YD12 noktali virgul (yol parametresi) her katmanda reddedilir', () => {
  for (const yol of [
    '/app/login.jsp;jsessionid=8F3A2B9C0D1E2F3A4B5C6D7E8F9A0B1C',
    '/portal/faces/javax.faces.resource/theme.css.xhtml;jsessionid=8F3A2B9C0D1E2F3A4B5C6D7E8F9A0B1C',
    '/a;b', '/a/;/b.js', '/glomo/main.js;JSESSIONID=x', '/x;sid=1/y.css',
  ]) assert.equal(dg.yolDenetle(yol), dg.NOKTALI_VIRGUL_NEDENI, yol);
  assert.equal(dg.NOKTALI_VIRGUL_NEDENI, 'yolda ";" parametresi var (ör. ;jsessionid) — oturum bilgisi senaryoya giremez');
  // Senaryo satiri: 400 + satir numarasi + ayni neden.
  const s = dg.senaryoSatirlari([SATIR('/a.js'), SATIR('/b.js;jsessionid=AB12')]);
  assert.deepEqual([s.ok, s.status, s.code], [false, 400, 'gecersiz_istek']);
  assert.deepEqual(s.hatalar, [{ satir: 2, neden: dg.NOKTALI_VIRGUL_NEDENI }]);
  // Baslatma oncesi son kapi: saklanmis (eski) senaryoda ';' varsa degiskenler gonderilmez.
  const tsv = '1\t1\tjs\tkucuk\t/a.js;jsessionid=AB12\n';
  assert.ok(dg.ekstraDegiskenleriDenetle(evOrnek({ yuk_senaryo_b64: Buffer.from(tsv).toString('base64'), yuk_senaryo_sha256: dg.sha256Hex(tsv) })).includes('yuk_senaryo_b64'));
});

test('YD13 boyut ve satir sayisi siniri satir denetiminden ONCE', () => {
  // Tavani asan govdede satirlar gecersiz olsa da (tur 'exe', yol cok uzun) cevap 409 boyut: satirlar taranmadi.
  const iri = Array.from({ length: 2 }, () => SATIR(`/${'a'.repeat(150 * 1024)}.js`, { tur: 'exe' }));
  const r = dg.senaryoSatirlari(iri);
  assert.deepEqual([r.status, r.code], [409, 'sinir_asildi'], JSON.stringify(r).slice(0, 200));
  assert.match(r.message, /en az \d+ KB; en çok 200 KB/);
  // Satir sayisi da once: 401 gecersiz satir -> 409 (400 degil).
  const cok = dg.senaryoSatirlari(Array.from({ length: 401 }, () => ({ yol: 5 })));
  assert.deepEqual([cok.status, cok.code], [409, 'sinir_asildi']);
  // Alt sinir gecerli senaryoyu REDDETMEZ: kanonik TSV tavanin hemen altindaysa kabul.
  const yol = (i) => `/${String(i).padStart(3, '0')}${'b'.repeat(483)}.js`;
  const sinirda = Array.from({ length: 400 }, (_, i) => SATIR(yol(i)));
  const k = dg.senaryoSatirlari(sinirda);
  assert.equal(k.ok, true, JSON.stringify(k).slice(0, 200));
  assert.ok(Buffer.byteLength(k.tsv) <= dg.SINIRLAR.maxTsvBayt && Buffer.byteLength(k.tsv) > dg.SINIRLAR.maxTsvBayt - 4096);
  // Son kapi: cozulmus hali 200 KB'yi asan b64 reddedilir.
  assert.ok(dg.ekstraDegiskenleriDenetle(evOrnek({ yuk_senaryo_b64: 'A'.repeat(300 * 1024) })).includes('yuk_senaryo_b64'));
});

test('YD14 olculmus limit 0 hedefi kapatir, global tavana dusmez', () => {
  const t1 = dg.rateLimitTavani([
    { directive: 'limit_req_zone', value: '$binary_remote_addr zone=login:10m rate=1r/s' },
    { directive: 'limit_req', value: 'zone=login burst=5' },
  ]);
  assert.deepEqual(t1, { hizSiniri: 0, vuSiniri: null });
  const t2 = dg.rateLimitTavani([
    { directive: 'limit_conn_zone', value: '$binary_remote_addr zone=c:10m' },
    { directive: 'limit_conn', value: 'c 1' },
  ]);
  assert.deepEqual(t2, { hizSiniri: null, vuSiniri: 0 });
  assert.equal(dg.rateLimitTavani([{ directive: 'limit_req_zone', value: '$binary_remote_addr zone=z:1m rate=30r/m' }]).hizSiniri, 0);
  for (const t of [t1, t2, { hizSiniri: 0, vuSiniri: 0 }]) {
    const r = dg.parametreler({ hizlar: [10], maxvu: 10 }, { sni: false, ...t });
    assert.deepEqual([r.ok, r.status, r.code, r.message], [false, 409, 'sinir_asildi', dg.SIFIR_SINIR_MESAJI], JSON.stringify(t));
    assert.equal(dg.sifirSinir(t.hizSiniri, t.vuSiniri), true);
  }
  assert.equal(dg.SIFIR_SINIR_MESAJI, "Hedefin ölçülmüş limit_req değeri 2 r/s'nin altında (ya da limit_conn ≤ 1); bu hedefe yük testi yapılamaz.");
  // Olcum yok (null) ise global tavan; 2 r/s zone tavani 1'e indirir (monoton).
  assert.equal(dg.sifirSinir(null, null), false);
  assert.equal(dg.parametreler({ hizlar: [450] }, { sni: false, hizSiniri: null, vuSiniri: null }).ok, true);
  const t3 = dg.rateLimitTavani([{ directive: 'limit_req_zone', value: '$binary_remote_addr zone=z:1m rate=2r/s' }]);
  assert.equal(t3.hizSiniri, 1);
  assert.equal(dg.parametreler({ hizlar: [1], maxvu: 10 }, { sni: false, ...t3 }).ok, true);
  assert.equal(dg.parametreler({ hizlar: [2], maxvu: 10 }, { sni: false, ...t3 }).code, 'sinir_asildi');
});
