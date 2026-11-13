// server/nginx-loadtest/__tests__/dogrula.test.cjs - Yuk Testi girdi ve guvenlik kapilari (2026-10-27).
//
//   YD1 ortam kapisi (tek hedef modeli 2026-11-13): dbo.Inventory satirlarinin HEPSI DEV/TEST/QA, addan PROD / EDU red
//   YD2 baska kaynaktan gelen HER uretim isareti kapatir (nginx_inventory.env, Inventory.env, PROD RP listesi)
//   YD3 envanterde olmayan hedef ve bos / okunamayan envanter (424, "yok" SAYILMAZ)
//   YD4 yuk makinesi: izin listesi, hedeften farkli, hostOrtami (ad kurali yok); YD4b ad listesi yok, son kapi + playbook
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
//   -- tur 3 (2026-10-28: elle hedef IP sunucu | serbest, wrk motoru, D7) --
//   YD15 serbestAglar (en kucuk /24, host bitli / ozel aralik / bicimsiz atilir, tek IP /32, tekil, <= 64,
//        uyari bir kez) ve serbestYasak (gecersiz girdi ATILMAZ, hatali'ya girer)
//   YD16 agIcinde + ag / yayin adresi dislamasi (/30 ve alti; /31 ve /32 serbest)
//   YD17 ipSinifla tablosu (kaynaklariOku uzerinden): sunucu / paylasilan VIP / belirsiz / cozulemeyen
//        sahip / yasak / uretim / ayni_host / serbest / kapali / ag disi / envanter yok / bayat / FQDN /
//        IPInventory tireli host onarimi
//   YD18 parametreler wrk (kanonik nesne, tavan_rps hesaplanir, mesajlar) + k6 serbest tavanlari
//   YD19 butceSn adim sayisi motora gore (motor'suz eski nesne k6)
//   YD20 ekstraDegiskenler / son kapi: 33 anahtar (tur 4), yuk_son_epoch penceresi, wrk + serbest kurallari
//   YD21 onKontrolDegerlendir: k6 + sunucu SABIT fikstur (tur 2 + yalniz D7), wrk iki engel, serbest
//   YD22 kaynaklariOku ip / vhost: parametreli, IP SQL metninde YOK; ip'siz cagrinin sorgulari tur 2 ile ayni
//   YD23 D7: server_name_var false / null -> uyari (listenin basinda), engel degil
//   YD24 Host basligi: server_name eslesmesi, host_uretim (iki kip), serbest plan uyarilari
//   -- tur 3 inceleme (2026-10-28) --
//   YD25 tarama listen alani bloktaki TUM listen'leri tasir (tarayici birlestirir): her belirtec sahiplik
//        (PROD'un ikinci listen IP'si hedef_uretim, serbest DEGIL) ve aday IP sayilir
//   YD26 yarim tarama gunu (MAX(scan_date) yarim, dun tam): sahiplik ve uretim adlari iki gunun birlesimi,
//        non-prod adlar / hedef satirlari / limitler hostun en son gunundan (yalniz-MAX okumasi kirmizi)
//   YD26b host_uretim kume kurallari ayri fiksturle: P iki gunun birlesimi (PROD bugun yalniz baska adla
//         yazildi: dunku ad yine 409), S = P + N (non-prod hostun dunku bayat adi 'taramada yok' uyarisini
//         susturmaz)
//   -- tur 4 (2026-11-02: arac setleri) --
//   YD40 extra_vars arac alanlari + son kapi; YD41 onKontrolDegerlendir aracli / eski satir birebir
//   -- HTTP/2 secimi (2026-11-02, h2_sozlesme.md) --
//   DG-H1 parametreler protokol: yoksa h1 (k6 + wrk), h2 + ka kabul; gecersiz deger / wrk + h2 / h2 + yeni 400 metni; butce ayni
//   DG-H2 extra_vars yuk_protokol (34. anahtar, her zaman): h1 / h2; son kapi ihlalleri; durdurda h1, ihlal yok
//   DG-H3 onKontrolDegerlendir protokol: h1 cikti birebir (h2 alanlari okunmaz); h2 TEK engel sirasi
//   -- tek hedef modeli (2026-11-13) --
//   YD-T1 onKontrolDegerlendir hedef_nginx false / null / yok; YD-T2 Inventory IP'leri aday + nginx'siz sunucu hedefi;
//   YD-T3 hedefAdaylariOku (sys.columns urun kolonlari, ipucu, k birlestirme, host listesi, 424)
//   YD-T4 FQDN ile kayitli dbo.Inventory satiri kisa adin ortamina katilir (kisa ad Test + FQDN Production -> 409)
//   YD-T5 cok IP'li dbo.Inventory hucresi IP sahibi aramasinda da gorunur (paylasilan VIP'in uretim sahibi -> 409)
//   YD-T6 /hedefler yolu (hostlar yok): ad kalibi disi ama taranmis hedefin tarama / limit verisi okunur
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const dg = require('../dogrula.cjs');

const SATIR = (yol, ek = {}) => ({ agirlik: 1, har: 1, tur: 'js', boyut: 'kucuk', yol, ...ek });

// Tek hedef modeli (2026-11-13): kapilar kaynaklariOku donusunu (invTum + nginx) alir. KK: host -> Inventory env satirlari.
const KK = (inv = {}, nginx = {}) => ({
  invTum: new Map(Object.entries(inv)),
  nginx: new Map(Object.entries(nginx).map(([h, env]) => [h, { host: h, env, ip: null }])),
});

test('YD1 ortam kapisi (tek hedef modeli): dbo.Inventory satirlari DEV/TEST/QA, addan PROD / EDU red, ad kurali aranmaz', () => {
  const ok = (host, inv, nginx) => dg.hedefKapisi(host, KK({ [host]: inv }, nginx ? { [host]: nginx } : {}));
  assert.deepEqual([ok('GBNGXT33', ['Test'], 'test').ok, ok('GBNGXT33', ['Test'], 'test').env], [true, 'TEST']);
  // Ad DEV/TEST/QA diyorsa etiket addan (envanter daha kaba: D.. -> Test).
  assert.equal(ok('GBNGXD01', ['Test'], 'dev').env, 'DEV');
  assert.equal(ok('GBNGWQ02', ['QA'], 'qa').env, 'QA');
  // Ad kurali disi makine: yalniz Inventory (gercek ornek GBJWLT01, Inventory Test, nginx envanteri yok).
  assert.deepEqual([ok('GBJWLT01', ['Test']).ok, ok('GBJWLT01', ['Test']).env], [true, 'TEST']);
  assert.equal(ok('GBLABT02', ['QA']).env, 'QA');
  // Karisik non-prod satirlar kabul; etiket sirali birlesim.
  assert.deepEqual([ok('GBJALT02', ['Test', 'QA', 'qa ']).ok, ok('GBJALT02', ['Test', 'QA']).env], [true, 'QA/TEST']);
  // Addan PROD / EDU: Inventory Test dese de red (envanter yalniz ISARET ekler, addaki uretimi gevsetemez).
  for (const [host, env] of [['GBNGXP40', 'PROD'], ['GBRVPP01', 'PROD'], ['GBNGXAP32', 'PROD'], ['GBNGXT51', 'EDU']]) {
    const r = ok(host, ['Test'], 'test');
    assert.deepEqual([r.ok, r.status, r.code, r.env], [false, 409, 'hedef_uretim', env], host);
  }
  // Satirlardan biri bile DEV/TEST/QA degil: red (bos / taninmayan dahil).
  for (const kotu of [['Production'], ['PROD'], ['EDU'], ['Alpha'], ['ODM'], [null], [''], ['Test', 'Production'], ['Test', null]]) {
    const r = ok('GBJWLT01', kotu);
    assert.deepEqual([r.ok, r.code], [false, 'hedef_uretim'], JSON.stringify(kotu));
    assert.match(r.message, /dbo\.Inventory ortamı .*yalnız DEV\/TEST\/QA/);
  }
  // dbo.Inventory'de hic satir yok: hedef_envanterde_yok (nginx envanterinde olsa bile; ortam kanitlanamiyor).
  const yok = dg.hedefKapisi('GBNGXT33', KK({}, { GBNGXT33: 'test' }));
  assert.deepEqual([yok.ok, yok.status, yok.code], [false, 409, 'hedef_envanterde_yok']);
  assert.match(yok.message, /dbo\.Inventory'de kayıtlı değil/);
  // Gecersiz ad.
  assert.equal(dg.hostOrtami('bad host', KK()).ok, false);
});

test('YD2 baska kaynaktan gelen her uretim isareti kapatir; kapi gevsemez', () => {
  for (const [nginxEnv, inv] of [['Production', ['Test']], ['prod', ['Test']], ['canli', ['Test']]]) {
    const r = dg.hedefKapisi('GBNGXT33', KK({ GBNGXT33: inv }, { GBNGXT33: nginxEnv }));
    assert.equal(r.ok, false, JSON.stringify([nginxEnv, inv]));
    assert.equal(r.code, 'hedef_uretim');
    assert.match(r.message, /üretim işareti/);
  }
  // Inventory satirindaki uretim degeri ortam kuralinda zaten red (PRD taninmayan ortam).
  assert.equal(dg.hedefKapisi('GBNGXT33', KK({ GBNGXT33: ['Test', 'PRD'] }, { GBNGXT33: 'test' })).code, 'hedef_uretim');
  // preprod nginx_inventory etiketi uretim DEGIL (prod-approval kurali): kapi acik kalir.
  assert.equal(dg.hedefKapisi('GBNGXT33', KK({ GBNGXT33: ['Test'] }, { GBNGXT33: 'preprod' })).ok, true);
  // PROD RP listesindeki bir host (ad kurali D/T/Q dese bile) kapanir.
  const { internetRpHosts } = require('../../audit/nginx-hosts.cjs');
  const prodRp = internetRpHosts().byEnv.PROD.find((h) => /^GBNG[WX]A?[DTQ]/.test(h));
  if (prodRp) assert.equal(dg.hedefKapisi(prodRp, KK({ [prodRp]: ['Test'] }, { [prodRp]: 'test' })).code, 'hedef_uretim');
  assert.match(String(dg.uretimIsareti({ host: 'GBNGXT33', nginxEnv: 'x', invEnv: 'Production' })), /Inventory\.env=Production/);
});

test('YD3 envanterde olmayan hedef 409; bos ya da okunamayan envanter 424 (yok SAYILMAZ)', async () => {
  const r = dg.hedefKapisi('GBNGXT33', KK());
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

test('YD4 yuk makinesi: izin listesi, hedeften farkli, hostOrtami kurali (ad kurali aranmaz)', () => {
  const izinli = ['GBNGXT34', 'GBNGXP50', 'GBLABT02', 'GBJWLT01', 'GBJALT02'];
  const k = KK({ GBNGXT34: ['Test'], GBNGXP50: ['Test'], GBLABT02: ['Test'], GBJWLT01: ['Test'], GBJALT02: ['QA'] }, { GBNGXT34: 'test' });
  const y = (h, ek = {}) => dg.yukHostKapisi(h, ek.k || k, { izinli, hedef: 'GBNGXT33', ...ek });
  assert.deepEqual([y('GBNGXT34').ok, y('GBNGXT34').env], [true, 'TEST']);
  // Gercek ornekler: nginx'siz makineler yalniz Inventory ile; GBLABT02 de artik kurala gore gecer (ad listesi yok).
  for (const h of ['GBJWLT01', 'GBJALT02', 'GBLABT02']) assert.equal(y(h).ok, true, h);
  assert.equal(y('GBNGXT35').code, 'yuk_host_izinsiz');
  assert.equal(y('GBNGXT34', { hedef: 'GBNGXT34' }).code, 'ayni_host');
  assert.equal(y('GBNGXP50').code, 'yuk_host_izinsiz', 'addan prod yuk makinesi izin listesinde diye gecti');
  assert.match(y('GBNGXP50').message, /yük makinesi yalnız DEV\/TEST\/QA olabilir/);
  assert.equal(y('GBNGXT34', { k: KK({ GBNGXT34: ['Production'] }) }).code, 'yuk_host_izinsiz');
  assert.equal(y('GBNGXT34', { k: KK({ GBNGXT34: ['Test', 'Production'] }) }).code, 'yuk_host_izinsiz');
  assert.equal(y('GBNGXT34', { k: KK({}, { GBNGXT34: 'test' }) }).code, 'yuk_host_izinsiz', 'Inventory satirsiz yuk makinesi gecti');
  assert.match(y('GBNGXT34', { k: KK({}, { GBNGXT34: 'test' }) }).message, /dbo\.Inventory'de kayıtlı değil/);
  assert.equal(y('GBNGXT34', { k: KK({ GBNGXT34: ['Test'] }, { GBNGXT34: 'Production' }) }).code, 'yuk_host_izinsiz');
  assert.equal(y('GBNGXT51', { izinli: ['GBNGXT51'], k: KK({ GBNGXT51: ['Test'] }) }).code, 'yuk_host_izinsiz', 'EDU yuk makinesi gecti');
  // Izin listesi env'den: bos -> varsayilan; gecersiz girdi atilir (liste daralir, genislemez).
  assert.deepEqual(dg.yukHostlari({}), ['GBNGXT34']);
  assert.deepEqual(dg.yukHostlari({ NGINX_LOADTEST_YUK_HOSTLARI: 'gbngxt34, GBNGXD02;bad_host;' }), ['GBNGXT34', 'GBNGXD02']);
  assert.deepEqual(dg.yukHostlari({ NGINX_LOADTEST_YUK_HOSTLARI: '!!!' }), []);
});

test('YD4b ad listesi yok: son kapi ve playbook ad kuralina bakmaz, uretim adi / EDU yine red', () => {
  assert.equal(dg.AD_DISI_YUK_HOSTLARI, undefined, 'ad disi yuk makinesi listesi geri geldi');
  // Son kapi: ad kurali disi makine hedef de yuk makinesi de olabilir; addan PROD / EDU red; hedef != yuk.
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(evOrnek({ yuk_yuk_host: 'GBJWLT01' })), []);
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(evOrnek({ yuk_hedef_host: 'GBJWLT01' })), []);
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(evOrnek({ yuk_yuk_host: 'GBLABT02' })), []);
  for (const [k, v] of [['yuk_hedef_host', 'GBNGXP40'], ['yuk_hedef_host', 'GBRVPP01'], ['yuk_hedef_host', 'GBNGXT51'], ['yuk_yuk_host', 'GBNGXAP32'], ['yuk_yuk_host', 'GBNGXT51']]) {
    assert.ok(dg.ekstraDegiskenleriDenetle(evOrnek({ [k]: v })).includes(k), `${k}=${v} gecti`);
  }
  assert.ok(dg.ekstraDegiskenleriDenetle(evOrnek({ yuk_hedef_host: 'GBJWLT01', yuk_yuk_host: 'GBJWLT01' })).includes('yuk_yuk_host'));
  // Playbook ayni kurali uygular: ek liste yok, ad kurali yok, uretim adi ve EDU listesi var.
  const pb = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'ansible', 'bmw_portal', 'nginx_loadtest', 'nginx_loadtest.yml'), 'utf8');
  assert.doesNotMatch(pb, /yt_extra_load_hosts|yt_cpu_target_extra_hosts/);
  assert.doesNotMatch(pb, /\(yuk_(hedef|yuk)_host \| string\) is match\(yt_re_nonprod_adi\)/);
  assert.match(pb, /yt_re_prod_adi: '\^\(GBRVP\|GBNG\[WX\]A\?P\)'/);
  assert.match(pb, /not \(\(yuk_yuk_host \| string\) is match\(yt_re_prod_adi\)\)/);
  assert.match(pb, /\(yuk_yuk_host \| string\) not in yt_edu_hostlari/);
  // Portal'in ad tabanli uretim kurali playbook'unkiyle ayni: envOfHost PROD <=> yt_re_prod_adi, EDU <=> yt_edu_hostlari.
  const { envOfHost } = require('../../audit/nginx-hosts.cjs');
  const re = /^(GBRVP|GBNG[WX]A?P)/;
  for (const h of ['GBNGXP40', 'GBNGWP01', 'GBNGXAP32', 'GBNGWAP02', 'GBRVPP01', 'GBRVPAP01', 'GBNGXT33', 'GBJWLT01', 'GBLABT02', 'GBNGXQ02']) {
    assert.equal(envOfHost(h) === 'PROD', re.test(h), h);
  }
  assert.deepEqual(/yt_edu_hostlari: \[([^\]]*)\]/.exec(pb)[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')), ['GBNGXT51']);
  assert.equal(envOfHost('GBNGXT51'), 'EDU');
});

test('YD5 sinirlar, butce formulu ve olculmus rate limit (2026-11-03: daraltma yok, uyari)', () => {
  const ok = dg.parametreler({}, { sni: false });
  assert.equal(ok.ok, true);
  // Tur 3: kanonik k6 nesnesi motor:'k6' tasir (ilgisiz wrk anahtarlari GIRMEZ).
  assert.deepEqual(ok.deger, { motor: 'k6', hizlar: [100, 250, 400], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'yeni', ae: 'br', sni: false, protokol: 'h1', sunucuAyar: null, butceSn: 60 + 3 * 2 * (30 + 120 + 30 + 20) + 120 });
  assert.deepEqual(Object.keys(ok.deger), ['motor', 'hizlar', 'tekrar', 'isinma', 'sure', 'bosluk', 'bosta', 'maxvu', 'kip', 'ae', 'sni', 'protokol', 'sunucuAyar', 'butceSn']);
  // Ayni girdi -> ayni nesne (on kontrol / kosu "ayni parametre" kosulu buna dayanir).
  assert.deepEqual(dg.parametreler({ ...ok.deger }, { sni: false }).deger, ok.deger);
  const asim = (p, ek) => {
    const r = dg.parametreler(p, { sni: false, ...ek });
    assert.equal(r.ok, false, JSON.stringify(p));
    return r;
  };
  for (const p of [
    { hizlar: [5001] }, { hizlar: [0] }, { hizlar: [1, 2, 3, 4, 5, 6] }, { hizlar: [100, 100] }, { tekrar: 4 }, { tekrar: 0 },
    { isinma: 4 }, { isinma: 61 }, { sure: 29 }, { sure: 39 }, { sure: 301 }, { bosluk: 121 }, { bosta: 29 }, { bosta: 121 },
    { maxvu: 9 }, { maxvu: 1001 },
  ]) assert.equal(asim(p).code, 'sinir_asildi', JSON.stringify(p));
  // K1: sunucu hedefinde hiz 5000 / maxvu 1000 kabul (butce sabit; 1 hiz x 2 tekrar).
  assert.equal(dg.parametreler({ hizlar: [1000, 5000], maxvu: 1000 }, { sni: false }).ok, true);
  assert.deepEqual([dg.SINIRLAR.maxHiz, dg.SINIRLAR.maxVu, dg.SINIRLAR.maxBaglanti, dg.SINIRLAR.maxTavanRps], [5000, 1000, 199, 5000]);
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
  // K2: olculmus rate limit DARALTMAZ (hiz 0.9 x limit_req'i, maxvu limit_conn - 1'i asabilir); ham degerler uyari icin.
  const t = dg.rateLimitTavani([
    { directive: 'limit_req_zone', value: '$binary_remote_addr zone=request_limit:20m rate=200r/s' },
    { directive: 'limit_req_zone', value: '$server_name zone=server_limit:50m rate=5000r/s' },
    { directive: 'limit_req', value: 'zone=request_limit burst=200 nodelay' },
    { directive: 'limit_conn_zone', value: '$binary_remote_addr zone=limit_connection_perip:20m' },
    { directive: 'limit_conn', value: 'limit_connection_perip 100' },
  ]);
  assert.deepEqual(t, { hizSiniri: 180, vuSiniri: 99, limitReq: 200, limitConn: 100 });
  assert.equal(dg.parametreler({ hizlar: [181] }, { sni: false, ...t }).ok, true);
  assert.equal(dg.parametreler({ maxvu: 100 }, { sni: false, ...t }).ok, true);
  assert.equal(dg.parametreler({ hizlar: [5000], maxvu: 1000 }, { sni: true, ...t }).ok, true);
  // Olcum yoksa (null); dakika birimi saniyeye cevrilir.
  assert.deepEqual(dg.rateLimitTavani([]), { hizSiniri: null, vuSiniri: null, limitReq: null, limitConn: null });
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
  // D7 (tur 3): server_name nginx -T'de yok ENGEL degil, onay isteyen uyari (YD21 / YD23).
  assert.equal(e({ server_name_var: false }).length, 0);
  assert.deepEqual(u({ server_name_var: false }), [dg.HOST_LISTEDE_YOK_UYARISI]);
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

// Tur 4: etkin arac seti (ekstraDegiskenler `arac`).
const ARAC = Object.freeze({ dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/5', k6Sha256: 'cd'.repeat(32), wrkSha256: 'ef'.repeat(32) });

function evOrnek(ek = {}) {
  const s = dg.senaryoSatirlari([SATIR('/a.js'), SATIR('/b.css', { tur: 'css' })]);
  const p = dg.parametreler({}, { sni: false }).deger;
  return {
    ...dg.ekstraDegiskenler({
      islem: 'kosu', kosuId: 17, hedefHost: 'GBNGXT33', yukHost: 'GBNGXT34', hedefIp: '10.0.0.5', vhost: 'app.test.local',
      senaryo: { tur: 'K', tsv: s.tsv, sha256: s.sha256 }, p, kok: '/sw/BMW_PORTAL/nginx_loadtest', arac: ARAC,
    }),
    ...ek,
  };
}

test('YD9 extra_vars son kapisi: yalniz sozlesme anahtarlari, hepsi metin, b64 ve sha tutarli', () => {
  const ev = evOrnek();
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(ev), []);
  assert.deepEqual(Object.keys(ev).sort(), [...dg.EKSTRA_ANAHTARLAR].sort());
  // Tur 4: 33 anahtar - tur 2'nin 23'u aynen, tur 3'un 7'si, ardindan tur 4'un 3 arac anahtari; HTTP/2 secimi yuk_protokol (34).
  assert.equal(dg.EKSTRA_ANAHTARLAR.length, 38);
  assert.deepEqual(dg.EKSTRA_ANAHTARLAR.slice(0, 23), [
    'yuk_islem', 'yuk_run_id', 'yuk_hedef_host', 'yuk_yuk_host', 'yuk_hedef_ip', 'yuk_host_basligi', 'yuk_sni',
    'yuk_senaryo_tur', 'yuk_senaryo_b64', 'yuk_senaryo_sha256', 'yuk_hizlar', 'yuk_tekrar', 'yuk_kip', 'yuk_ae',
    'yuk_isinma_sn', 'yuk_sure_sn', 'yuk_bosluk_sn', 'yuk_bosta_bas_sn', 'yuk_maxvu', 'yuk_butce_sn', 'yuk_k6_yolu',
    'yuk_ua_onek', 'yuk_cikti_kok',
  ]);
  assert.deepEqual(dg.EKSTRA_ANAHTARLAR.slice(23, 30), ['yuk_hedef_turu', 'yuk_motor', 'yuk_baglantilar', 'yuk_is_parcacigi', 'yuk_wrk_yolu', 'yuk_tavan_rps', 'yuk_son_epoch']);
  assert.deepEqual(dg.EKSTRA_ANAHTARLAR.slice(30), ['yuk_arac_dizin', 'yuk_k6_sha256', 'yuk_wrk_sha256', 'yuk_protokol', 'yuk_srv_ayar', 'yuk_srv_seviye', 'yuk_srv_static', 'yuk_srv_dizin']);
  assert.deepEqual([ev.yuk_hedef_turu, ev.yuk_motor, ev.yuk_baglantilar, ev.yuk_is_parcacigi, ev.yuk_tavan_rps, ev.yuk_wrk_yolu], ['sunucu', 'k6', '', '', '', '/yeni-playbook-gerekli/wrk']);
  for (const [k, v] of Object.entries(ev)) assert.equal(typeof v, 'string', k);
  assert.equal(ev.yuk_hizlar, '100 250 400');
  assert.equal(ev.yuk_butce_sn, '1380'); // 60 + 6 x (30 + 120 + 30 + 20) + 120
  assert.equal(ev.yuk_ua_onek, 'portal-yuktesti');
  assert.equal(Buffer.from(ev.yuk_senaryo_b64, 'base64').toString('utf8'), '1\t1\tjs\tkucuk\t/a.js\n1\t1\tcss\tkucuk\t/b.css\n');
  const ihlal = (ek) => dg.ekstraDegiskenleriDenetle(evOrnek(ek));
  assert.deepEqual(ihlal({ LIMIT_MUAF: '1' }), ['LIMIT_MUAF']);
  assert.deepEqual(ihlal({ http_proxy: 'http://x' }), ['http_proxy']);
  assert.ok(ihlal({ yuk_hizlar: '100 5001' }).includes('yuk_hizlar'));
  assert.ok(ihlal({ yuk_hizlar: '100 10000' }).includes('yuk_hizlar'));
  assert.ok(!ihlal({ yuk_hizlar: '1000 5000' }).includes('yuk_hizlar'), 'son kapi 4 haneli hizi (5000) reddetti');
  assert.ok(ihlal({ yuk_maxvu: '1001' }).includes('yuk_maxvu'));
  assert.ok(!ihlal({ yuk_maxvu: '1000' }).includes('yuk_maxvu'));
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
  // Tur 4: kok yoksa arac dizini de dogrulanamaz (startsWith kok + '/araclar/').
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(eksik), ['yuk_cikti_kok', 'yuk_arac_dizin']);
  // Is gecmisine senaryo govdesi gitmez.
  const m = dg.gecmisIcinMaskele(ev);
  assert.match(m.yuk_senaryo_b64, /^<\d+ b64>$/);
  assert.equal(m.yuk_hedef_host, 'GBNGXT33');
  // Ortam: gecersiz kok yolu varsayilana duser; kosu dizini sunucuda kurulur. Tur 4: k6 / wrk yolu
  // env'den OKUNMAZ (NGINX_LOADTEST_K6 / _WRK kalkti; yollar isaret degeri).
  assert.equal(dg.k6Yolu, undefined);
  assert.equal(dg.wrkYolu, undefined);
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
    // Settings: gun seek'i (d / o), host basina varlik, etkin gunun limit satirlari.
    if (/ AS d,\s+CONVERT/.test(q)) return { recordset: [{ d: '2026-10-28', o: '2026-10-27' }] };
    if (/ AS d_var,/.test(q)) return { recordset: params.filter((p) => /^a\d+$/.test(p.name)).map((p) => ({ host: p.value, d_var: 1, o_var: 1 })) };
    if (/Nginx_Audit_Settings/.test(q)) return { recordset: [{ host: 'GBNGXT33', directive: 'limit_req_zone', value: '$binary_remote_addr zone=r:1m rate=100r/s' }] };
    throw new Error(`beklenmeyen sorgu: ${q}`);
  };
  const k = await dg.kaynaklariOku({ query: veri(true), sql });
  assert.deepEqual([...k.nginx.keys()].sort(), ['GBNGXP40', 'GBNGXT33', 'GBNGXT34']);
  const ay = dg.hedefAyrintisi(k, 'GBNGXT33');
  assert.deepEqual(ay, { ipler: ['10.0.0.5', '10.0.0.9'], vhostlar: ['app.test.local'], hizSiniri: 90, vuSiniri: null, limitReq: 100, limitConn: null });
  // /hedefler yolu (tek hedef modeli): tarama yalniz hostOrtami'ndan gecen hostlar icin (ad kurali yok); prod host
  // (GBNGXP40) ve dbo.Inventory satiri olmayan host (GBNGXT34) tarama / limit okumasina girmez.
  const tarama = sorgular.find((s) => /Nginx_Audit_Servers\s+WHERE[\s\S]*host IN/.test(s.q));
  assert.deepEqual(tarama.params.map((p) => p.value).sort(), ['GBNGXT33']);
  for (const s of sorgular) {
    assert.doesNotMatch(s.q, /GBNGXT3/, 'host adi SQL metnine gomuldu');
  }
  // Tablo yoksa "veri yok" (null): vhost denetimi atlanir, IP envanterden.
  const k2 = await dg.kaynaklariOku({ query: veri(false), sql, hostlar: ['GBNGXT33'] });
  assert.equal(k2.sunucular, null);
  assert.deepEqual(dg.hedefAyrintisi(k2, 'GBNGXT33'), { ipler: ['10.0.0.5'], vhostlar: null, hizSiniri: null, vuSiniri: null, limitReq: null, limitConn: null });
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

test('YD14 (B3) olculmus cok kucuk limit (eski sifir sinir) hedefi KAPATMAZ: 409 yok, ayni limit uyarisi', () => {
  const t1 = dg.rateLimitTavani([
    { directive: 'limit_req_zone', value: '$binary_remote_addr zone=login:10m rate=1r/s' },
    { directive: 'limit_req', value: 'zone=login burst=5' },
  ]);
  assert.deepEqual(t1, { hizSiniri: 0, vuSiniri: null, limitReq: 1, limitConn: null });
  const t2 = dg.rateLimitTavani([
    { directive: 'limit_conn_zone', value: '$binary_remote_addr zone=c:10m' },
    { directive: 'limit_conn', value: 'c 1' },
  ]);
  assert.deepEqual(t2, { hizSiniri: null, vuSiniri: 0, limitReq: null, limitConn: 1 });
  assert.equal(dg.rateLimitTavani([{ directive: 'limit_req_zone', value: '$binary_remote_addr zone=z:1m rate=30r/m' }]).hizSiniri, 0);
  // B3 (K2 "olculmus limit artik sinirlamaz"): parametreler limiti hic gormez; 409 YOK. Asim plan uyarisi (onay ister).
  const p10 = dg.parametreler({ hizlar: [10], maxvu: 10 }, { sni: false });
  assert.equal(p10.ok, true, JSON.stringify(p10));
  assert.deepEqual(dg.limitUyarilari(p10.deger, t1), ['Seçilen hız (10/sn) hedefin ölçülmüş limit_req değerini (1 r/s) aşıyor; 429 alınırsa koşu durur.']);
  assert.deepEqual(dg.limitUyarilari(p10.deger, t2), ['Seçilen en çok VU (10) hedefin ölçülmüş limit_conn değerini (1) aşıyor; bu kadar bağlantı aynı anda açılırsa fazlası reddedilir (429 ya da 503) ve koşu durur ya da adım geçersiz sayılır.']);
  const w = dg.parametreler({ motor: 'wrk', baglantilar: [2, 4] }, { sni: false });
  assert.equal(w.ok, true);
  assert.deepEqual(dg.limitUyarilari(w.deger, t2), ['Seçilen en çok bağlantı (4) hedefin ölçülmüş limit_conn değerini (1) aşıyor; fazla bağlantılar reddedilir (429 ya da 503) ve koşu durur.']);
  assert.equal(dg.sifirSinir, undefined, 'sifir sinir kapisi kaldirildi');
  assert.equal(dg.SIFIR_SINIR_MESAJI, undefined);
  assert.equal(dg.parametreler({ hizlar: [5000] }, { sni: false }).ok, true);
  const t3 = dg.rateLimitTavani([{ directive: 'limit_req_zone', value: '$binary_remote_addr zone=z:1m rate=2r/s' }]);
  assert.equal(t3.hizSiniri, 1);
  assert.equal(dg.parametreler({ hizlar: [1], maxvu: 10 }, { sni: false, ...t3 }).ok, true);
  assert.equal(dg.parametreler({ hizlar: [2], maxvu: 10 }, { sni: false, ...t3 }).ok, true);
});

// ── TUR 3 (2026-10-28) ─────────────────────────────────────────────────────────────────────

// LIKE (yalniz %) -> tam eslesme: sahte TBMWANS parametreli LIKE'i ANLAMIYLA uygular.
const like = (deger, desen) => new RegExp(`^${String(desen).split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(String(deger));
const ONCEKI_GUN = (g) => new Date(Date.parse(`${g}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const TEKIL = (satirlar) => [...new Map(satirlar.map((r) => [JSON.stringify(r), r])).values()];
// Son iki tarama gunu penceresi (kaynaklariOku SON_IKI_TARAMA_GUNU) ve Settings sorgulari: metin BIREBIR.
const INV_KISA_AD = "UPPER(LEFT(LTRIM(RTRIM(host)), CHARINDEX('.', LTRIM(RTRIM(host)) + '.') - 1))";
const SON_IKI = 'scan_date >= DATEADD(day, -1, (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Servers))';
const SON_TEK = 'scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Servers)';
const AYAR_GUNLERI = 'SELECT CONVERT(varchar(10), m.d, 23) AS d, CONVERT(varchar(10), (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Settings WHERE scan_date < m.d), 23) AS o FROM (SELECT MAX(scan_date) AS d FROM dbo.Nginx_Audit_Settings) AS m';
const AYAR_VARLIK = (n) => 'SELECT h.host, CASE WHEN EXISTS (SELECT 1 FROM dbo.Nginx_Audit_Settings s WHERE s.scan_date = CONVERT(date, @d, 23) AND s.host = h.host) THEN 1 ELSE 0 END AS d_var, '
  + 'CASE WHEN EXISTS (SELECT 1 FROM dbo.Nginx_Audit_Settings s WHERE s.scan_date = CONVERT(date, @o, 23) AND s.host = h.host) THEN 1 ELSE 0 END AS o_var '
  + `FROM (VALUES ${Array.from({ length: n }, (_, i) => `(@a${i})`).join(', ')}) AS h(host)`;
const AYAR_LIMIT = (n) => "SELECT host, directive, value FROM dbo.Nginx_Audit_Settings WHERE scan_date = CONVERT(date, @g, 23) AND directive IN ('limit_req_zone', 'limit_conn_zone', 'limit_req', 'limit_conn') "
  + `AND host IN (${Array.from({ length: n }, (_, i) => `@a${i}`).join(',')})`;
const LIMIT_DIREKTIF = new Set(['limit_req_zone', 'limit_conn_zone', 'limit_req', 'limit_conn']);

/**
 * Sahte TBMWANS: kaynaklariOku'nun her sorgusunu METNIYLE tanir ve parametreleri anlamiyla uygular
 * (= / LIKE / IN; IP SQL metninde DEGIL, parametrede). Tanimadigi sorgu HATA. `ek` varsayilan
 * veriyi ezer; tablo null = tablo yok (OBJECT_ID null). Gun: tarama / ayar satirinin `gun` alani
 * (yoksa taramaGun / ayarGun); Servers sorgulari son iki gun penceresini (MAX - 1 gun), Settings
 * sorgulari gun seek'ini (d = MAX, o = d'den onceki) ve host basina varligi ANLAMIYLA uygular.
 */
function tbmwans(ek = {}) {
  const d = {
    nginx: [
      { hostname: 'GBNGXT33', env: 'test', ip: '10.0.0.5' }, { hostname: 'GBNGXT34', env: 'test', ip: '10.0.0.6' },
      { hostname: 'GBNGXT35', env: 'test', ip: '10.0.0.7' }, { hostname: 'GBNGXP40', env: 'Production', ip: '10.9.0.1' },
      { hostname: 'GBNGXT51', env: 'test', ip: '10.0.0.51' },
    ],
    // Tek hedef modeli (2026-11-13): her hedef / IP sahibi dbo.Inventory'de olmali (GBNGXT35 paylasilan VIP sahibi).
    inventory: [{ host: 'GBNGXT33', env: 'Test', ip: '10.0.0.5' }, { host: 'GBNGXT34', env: 'Test', ip: '10.0.0.6' }, { host: 'GBNGXT35', env: 'Test', ip: '10.0.0.7' }],
    ipEnvanteri: [{ host: 'GBNGXT33', ip: '10.0.0.5' }, { host: 'GBNGXT34', ip: '10.0.0.6' }],
    ipEnvanteriYasSaat: 3,
    ipEnvanteriSon: '2026-10-28 06:00:00',
    tarama: [
      { host: 'GBNGXT33', listen: '10.0.0.9:443 ssl', server_name: 'app.test.local api.test.local' },
      { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local' },
      { host: 'GBNGXT33', listen: '10.0.0.100:443 ssl', server_name: 'vip.test.local' },
      { host: 'GBNGXT35', listen: '10.0.0.100:443 ssl', server_name: 'vip.test.local paylasilan.test.local' },
      { host: 'GBNGXP40', listen: '10.9.0.1:443 ssl', server_name: 'prod.only.local paylasilan.test.local' },
    ],
    taramaYasGun: 0,
    taramaSon: '2026-10-28',
    taramaGun: '2026-10-28',
    ayarlar: [],
    ayarGun: '2026-10-28',
    ...ek,
  };
  const sorgular = [];
  const tGun = (r) => r.gun || d.taramaGun;
  const aGun = (r) => r.gun || d.ayarGun;
  // dbo.Nginx_Audit_Servers penceresi: son iki gun (scan_date >= MAX - 1 gun; kod) ya da yalniz MAX gunu
  // (eski okuma: mutasyon olcumunde ANLAMIYLA uygulanir, metin hatasina dusmez).
  const enSon = () => d.tarama.map(tGun).sort().at(-1);
  const pencereli = (t) => {
    if (t.includes(SON_IKI)) return [t.replace(SON_IKI, '<P>'), d.tarama.filter((r) => tGun(r) >= ONCEKI_GUN(enSon()))];
    if (t.includes(SON_TEK)) return [t.replace(SON_TEK, '<P>'), d.tarama.filter((r) => tGun(r) === enSon())];
    return [t, null];
  };
  const query = async (q, params = []) => {
    const t = String(q).replace(/\s+/g, ' ').trim();
    sorgular.push({ q: t, params });
    const deger = (ad) => (params.find((p) => p.name === ad) || {}).value;
    const kume = new Set(params.map((p) => p.value));
    if (t === 'SELECT hostname, env, ip, service FROM dbo.nginx_inventory') return { recordset: d.nginx };
    // IP sahibi: LIKE anlamiyla (cok IP'li hucre de gelir; kesin eslesme kodda).
    if (t === 'SELECT host, env, ip FROM dbo.Inventory WHERE ip LIKE @ip0') {
      return { recordset: d.inventory.filter((r) => like(String(r.ip ?? ''), deger('ip0'))) };
    }
    // Host listesi: kisa ad ifadesi (INV_KISA_AD) FQDN satirini da eslestirir; eski birebir metin (mutasyon) birebir ad.
    if (t.startsWith(`SELECT host, env, ip FROM dbo.Inventory WHERE ${INV_KISA_AD} IN (`)) {
      return { recordset: d.inventory.filter((r) => kume.has(String(r.host).trim().split('.')[0].toUpperCase())) };
    }
    if (/^SELECT host, env, ip FROM dbo\.Inventory WHERE UPPER\(LTRIM\(RTRIM\(host\)\)\) IN \(/.test(t)) {
      return { recordset: d.inventory.filter((r) => kume.has(String(r.host).trim().toUpperCase())) };
    }
    if (t === "SELECT OBJECT_ID('dbo.IPInventory') AS oid") return { recordset: [{ oid: d.ipEnvanteri ? 11 : null }] };
    if (t === "SELECT OBJECT_ID('dbo.Nginx_Audit_Servers') AS oid") return { recordset: [{ oid: d.tarama ? 12 : null }] };
    if (t === "SELECT OBJECT_ID('dbo.Nginx_Audit_Settings') AS oid") return { recordset: [{ oid: d.ayarlar ? 13 : null }] };
    if (t === 'SELECT TOP 1 1 AS x FROM dbo.IPInventory') return { recordset: d.ipEnvanteri.length ? [{ x: 1 }] : [] };
    if (t === 'SELECT host, ip FROM dbo.IPInventory WHERE LTRIM(RTRIM(ip)) = @ip1 OR LTRIM(RTRIM(ip)) LIKE @ip2') {
      return { recordset: d.ipEnvanteri.filter((r) => String(r.ip ?? '').trim() === deger('ip1') || like(String(r.ip ?? '').trim(), deger('ip2'))) };
    }
    if (t === 'SELECT DATEDIFF(HOUR, MAX(last_seen_at), GETDATE()) AS yas_saat, CONVERT(varchar(19), MAX(last_seen_at), 120) AS son FROM dbo.IPInventory') {
      return { recordset: [{ yas_saat: d.ipEnvanteriYasSaat, son: d.ipEnvanteriSon }] };
    }
    if (t === 'SELECT DATEDIFF(DAY, MAX(scan_date), CAST(GETDATE() AS DATE)) AS yas_gun, CONVERT(varchar(10), MAX(scan_date), 23) AS son FROM dbo.Nginx_Audit_Servers') {
      return { recordset: [{ yas_gun: d.taramaYasGun, son: d.taramaSon }] };
    }
    const [tp, pen] = pencereli(t);
    if (pen && tp === 'SELECT DISTINCT host FROM dbo.Nginx_Audit_Servers WHERE <P>') {
      return { recordset: TEKIL(pen.map((r) => ({ host: r.host }))) };
    }
    if (pen && tp === 'SELECT DISTINCT host, listen FROM dbo.Nginx_Audit_Servers WHERE <P> AND listen LIKE @ip3') {
      return { recordset: TEKIL(pen.filter((r) => like(r.listen, deger('ip3'))).map(({ host, listen }) => ({ host, listen }))) };
    }
    if (pen && tp === 'SELECT DISTINCT host, server_name, CONVERT(varchar(10), scan_date, 23) AS gun FROM dbo.Nginx_Audit_Servers WHERE <P>') {
      return { recordset: TEKIL(pen.map((r) => ({ host: r.host, server_name: r.server_name ?? null, gun: tGun(r) }))) };
    }
    if (pen && tp.startsWith('SELECT host, listen, server_name, CONVERT(varchar(10), scan_date, 23) AS gun FROM dbo.Nginx_Audit_Servers WHERE <P> AND host IN (')) {
      return { recordset: pen.filter((r) => kume.has(r.host)).map((r) => ({ host: r.host, listen: r.listen, server_name: r.server_name, gun: tGun(r) })) };
    }
    const hostParam = params.filter((p) => /^a\d+$/.test(p.name)).map((p) => p.value);
    if (t === AYAR_GUNLERI) {
      const gunler = [...new Set(d.ayarlar.map(aGun))].sort();
      return { recordset: [{ d: gunler.at(-1) ?? null, o: gunler.length > 1 ? gunler.at(-2) : null }] };
    }
    if (t === AYAR_VARLIK(hostParam.length)) {
      const var1 = (h, g) => (g != null && d.ayarlar.some((r) => r.host === h && aGun(r) === g) ? 1 : 0);
      return { recordset: hostParam.map((h) => ({ host: h, d_var: var1(h, deger('d')), o_var: var1(h, deger('o')) })) };
    }
    if (t === AYAR_LIMIT(hostParam.length)) {
      return { recordset: d.ayarlar.filter((r) => hostParam.includes(r.host) && aGun(r) === deger('g') && LIMIT_DIREKTIF.has(r.directive)).map(({ host, directive, value }) => ({ host, directive, value })) };
    }
    throw new Error(`beklenmeyen sorgu: ${t}`);
  };
  return { query, sorgular, sql: { NVarChar: (n) => `nv${n}` }, d };
}
const AG = (metin) => dg.serbestAglar({ NGINX_LOADTEST_SERBEST_AGLAR: metin });
const YASAK = (metin) => dg.serbestYasak({ NGINX_LOADTEST_SERBEST_YASAK: metin });
/** kaynaklariOku (ip ile) + ipSinifla. */
async function sinifla(ip, { veri = {}, hedefHost = null, yukHost = 'GBNGXT34', aglar = AG('10.20.30.0/24'), yasak = YASAK('') } = {}) {
  const t = tbmwans(veri);
  const k = await dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: [hedefHost, yukHost].filter(Boolean), ip });
  return { r: dg.ipSinifla(ip, k, { aglar, yasak, hedefHost, yukHost }), k, t };
}

test('YD15 serbestAglar fail-closed (/24 tabani, host bitli / ozel / bicimsiz atilir, tek uyari) ve serbestYasak', () => {
  assert.deepEqual(dg.serbestAglar({}), []);
  assert.deepEqual(AG('  '), []);
  const uyarilar = [];
  const eskiWarn = console.warn;
  console.warn = (...a) => uyarilar.push(a.join(' '));
  try {
    const l = AG('10.20.30.0/24, 10.20.31.15;10.20.30.0/24 YD15-bicimsiz 10.21.0.3/24 10.22.0.0/23 127.0.0.0/24 169.254.9.0/24 224.1.1.0/24 0.0.0.0/24 10.23.0.0/33 10.24.0.0/024 010.1.2.3 10.25.0.128/25');
    assert.deepEqual(l.map((a) => a.metin), ['10.20.30.0/24', '10.20.31.15/32', '10.25.0.128/25']);
    assert.deepEqual(l[0], { metin: '10.20.30.0/24', ag: 10 * 16777216 + 20 * 65536 + 30 * 256, maske: 4294967040, onek: 24, agAdresi: '10.20.30.0', yayin: '10.20.30.255' });
    assert.deepEqual([l[1].onek, l[1].agAdresi, l[1].yayin, l[1].maske], [32, '10.20.31.15', '10.20.31.15', 4294967295]);
    assert.equal(l[2].yayin, '10.25.0.255');
    // Her atilan ham deger icin TEK ASCII uyari; ikinci okuma uyari tekrarlamaz.
    assert.equal(uyarilar.length, 10, uyarilar.join('\n'));
    for (const u of uyarilar) assert.match(u, /^\[NginxYukTesti\] NGINX_LOADTEST_SERBEST_AGLAR girdisi kullanilmadi \(/);
    for (const u of uyarilar) assert.match(u, /^[\x20-\x7e]*$/, `uyari ASCII degil: ${u}`);
    assert.ok(uyarilar.some((u) => /\(host bitleri dolu\): "10\.21\.0\.3\/24"/.test(u)), 'host bitli girdi normallestirildi');
    assert.ok(uyarilar.some((u) => /\(onek \/23 < \/24\): "10\.22\.0\.0\/23"/.test(u)));
    const n = uyarilar.length;
    AG('10.20.30.0/24 YD15-bicimsiz 10.21.0.3/24 127.0.0.0/24');
    assert.equal(uyarilar.length, n, 'ayni ham deger icin uyari tekrarlandi');
    // En cok 64 girdi (tekillestirmeden sonra); fazlasi atilir (liste daralir).
    const l64 = AG(Array.from({ length: 70 }, (_, i) => `10.30.${i}.0/24`).join(','));
    assert.equal(l64.length, 64);
    assert.equal(l64[63].metin, '10.30.63.0/24');
    assert.ok(uyarilar.some((u) => /en cok 64 girdi/.test(u)));
    // Yasak listesi: ayni bicim, onek 0..32 (genis yasak guvenli), gecersiz girdi ATILMAZ -> hatali.
    assert.deepEqual(YASAK(''), { liste: [], hatali: [] });
    assert.deepEqual(dg.serbestYasak({}), { liste: [], hatali: [] });
    const y = YASAK('10.0.0.0/8, 192.168.1.7 YD15-yasak-bozuk 10.1.2.3/24 172.16.0.0/12 10.0.0.0/8');
    assert.deepEqual(y.liste.map((a) => a.metin), ['10.0.0.0/8', '192.168.1.7/32', '172.16.0.0/12']);
    assert.deepEqual(y.hatali, ['YD15-yasak-bozuk', '10.1.2.3/24']);
    assert.deepEqual(YASAK('0.0.0.0/0 127.0.0.0/8 10.0.0.0/16').liste.map((a) => a.metin), ['0.0.0.0/0', '127.0.0.0/8', '10.0.0.0/16']);
    assert.deepEqual(YASAK('0.0.0.0/0').liste[0].maske, 0);
  } finally {
    console.warn = eskiWarn;
  }
});

test('YD16 agIcinde ve ag / yayin adresi dislamasi (/30 ve alti; /31, /32 serbest)', async () => {
  const [a24] = AG('10.20.30.0/24');
  assert.equal(dg.agIcinde('10.20.30.40', a24), true);
  assert.equal(dg.agIcinde('10.20.31.40', a24), false);
  for (const kotu of ['10.20.30.256', 'x', '', null]) assert.equal(dg.agIcinde(kotu, a24), false, String(kotu));
  assert.equal(dg.agIcinde('10.20.30.40', null), false);
  assert.equal(dg.agIcinde('223.255.255.254', YASAK('0.0.0.0/0').liste[0]), true);
  const [a8] = YASAK('10.0.0.0/8').liste;
  assert.equal(dg.agIcinde('10.255.255.255', a8), true);
  assert.equal(dg.agIcinde('11.0.0.0', a8), false);
  // 2^31 ustu adres: isaretli tasma yok.
  const [yuksek] = AG('200.1.2.0/24');
  assert.equal(dg.agIcinde('200.1.2.77', yuksek), true);
  assert.equal(dg.agIcinde('200.1.3.77', yuksek), false);
  const aglar = AG('10.20.30.0/24 10.20.40.4/30 10.20.50.8/31 10.20.60.9/32');
  const bul = (ip) => (dg.serbestAgBul(ip, aglar) || {}).metin || null;
  assert.deepEqual(['10.20.30.0', '10.20.30.255', '10.20.30.1', '10.20.30.254'].map(bul), [null, null, '10.20.30.0/24', '10.20.30.0/24']);
  assert.deepEqual(['10.20.40.4', '10.20.40.5', '10.20.40.6', '10.20.40.7'].map(bul), [null, '10.20.40.4/30', '10.20.40.4/30', null]);
  assert.deepEqual(['10.20.50.8', '10.20.50.9'].map(bul), ['10.20.50.8/31', '10.20.50.8/31']);
  assert.equal(bul('10.20.60.9'), '10.20.60.9/32');
  assert.equal(dg.serbestAgBul('10.20.30.1', null), null);
  // ipSinifla ayni kurali uygular: izinli agin ag / yayin adresi hedef olamaz.
  for (const ip of ['10.20.30.0', '10.20.30.255']) {
    const { r } = await sinifla(ip);
    assert.deepEqual([r.status, r.code], [409, 'ip_izinli_agda_degil'], ip);
  }
  assert.deepEqual((await sinifla('10.20.30.1')).r, { ok: true, tur: 'serbest', host: null, ag: '10.20.30.0/24', digerSahipler: [] });
});

test('YD17 ipSinifla: sahiplik kaynaklari, baglayici sira ve metinler', async () => {
  // Tek nginx sahibi (son taramanin listen'i) -> sunucu.
  let { r, k } = await sinifla('10.0.0.9');
  assert.deepEqual(r, { ok: true, tur: 'sunucu', host: 'GBNGXT33' });
  assert.deepEqual([...k.ipSahipleri.get('GBNGXT33')], ['tarama']);
  // Envanter IP'si: nginx_inventory + Inventory + IPInventory ayni host -> tek sahip -> sunucu.
  ({ r, k } = await sinifla('10.0.0.5'));
  assert.deepEqual([r.tur, r.host], ['sunucu', 'GBNGXT33']);
  assert.deepEqual([...k.ipSahipleri.get('GBNGXT33')].sort(), ['dbo.IPInventory', 'dbo.Inventory', 'dbo.nginx_inventory']);
  // Paylasilan VIP + hedefHost -> sunucu (host secici; diger sahip de kurala uymali - tek hedef modeli).
  ({ r } = await sinifla('10.0.0.100', { hedefHost: 'GBNGXT33' }));
  assert.deepEqual(r, { ok: true, tur: 'sunucu', host: 'GBNGXT33' });
  // hedefHost IP'nin sahibi degil -> ip_hedefte_yok (metni cagiran aday listesiyle kurar).
  ({ r } = await sinifla('10.0.0.9', { hedefHost: 'GBNGXT35' }));
  assert.deepEqual([r.status, r.code], [409, 'ip_hedefte_yok']);
  // Iki sahip, hedefHost'suz -> ip_belirsiz.
  ({ r } = await sinifla('10.0.0.100'));
  assert.deepEqual([r.status, r.code, r.message], [409, 'ip_belirsiz', '10.0.0.100 birden çok sunucuda tanımlı (GBNGXT33, GBNGXT35); hedef sunucuyu listeden seçin.']);
  assert.deepEqual(r.sahipler, [{ host: 'GBNGXT33', env: 'TEST', nginx: true, kaynaklar: ['tarama'] }, { host: 'GBNGXT35', env: 'TEST', nginx: true, kaynaklar: ['tarama'] }]);
  // nginx sahibi + Inventory'de baska host -> ip_belirsiz (nginx'li / nginx'siz ayrimi yok); host secici iki sahipten birini secer.
  const ikiSahip = { inventory: [...tbmwans().d.inventory, { host: 'GBAPPT09', env: 'Test', ip: '10.0.0.9' }] };
  ({ r } = await sinifla('10.0.0.9', { veri: ikiSahip }));
  assert.deepEqual([r.code, r.message], ['ip_belirsiz', '10.0.0.9 birden çok sunucuda tanımlı (GBAPPT09, GBNGXT33); hedef sunucuyu listeden seçin.']);
  for (const h of ['GBAPPT09', 'GBNGXT33']) assert.deepEqual((await sinifla('10.0.0.9', { veri: ikiSahip, hedefHost: h })).r, { ok: true, tur: 'sunucu', host: h }, h);
  // Paylasilan IP'nin sahiplerinden biri kurala uymazsa host secici de red (fail-closed).
  ({ r } = await sinifla('10.0.0.9', { veri: { inventory: [...tbmwans().d.inventory, { host: 'GBAPPP09', env: 'Production', ip: '10.0.0.9' }] }, hedefHost: 'GBNGXT33' }));
  assert.deepEqual([r.code, r.message], ['hedef_uretim', '10.0.0.9, GBAPPP09 sunucusuna ait (dbo.Inventory ortamı Production); yük testi yapılmaz.']);
  // Adi cozulemeyen sahip -> ip_sahibi_cozulemedi, hedefHost'suz VE hedefHost'lu (fail-closed).
  const bozukAd = { ipEnvanteri: [{ host: 'GBNGXT33', ip: '10.0.0.5' }, { host: 'bad_host!', ip: '10.0.0.9' }] };
  for (const hedefHost of [null, 'GBNGXT33']) {
    ({ r } = await sinifla('10.0.0.9', { veri: bozukAd, hedefHost }));
    assert.deepEqual([r.status, r.code, r.message], [409, 'ip_sahibi_cozulemedi', "10.0.0.9 adı çözülemeyen bir envanter kaydına ait (dbo.IPInventory); IP'nin sahibi bilinmediği için yük testi yapılmaz."], String(hedefHost));
  }
  // Yasak listesinde gecersiz girdi -> tum yuk testi kapali (sunucu IP'sinde de).
  for (const ip of ['10.0.0.9', '10.20.30.40']) {
    ({ r } = await sinifla(ip, { yasak: YASAK('10.50.0.0/16 YD17-bozuk') }));
    assert.deepEqual([r.status, r.code, r.message], [409, 'ip_yasak_listesi_gecersiz', 'NGINX_LOADTEST_SERBEST_YASAK okunamadı (geçersiz girdi: YD17-bozuk); liste düzeltilene kadar yük testi yapılmaz.'], ip);
  }
  // Yasakli ag -> ip_yasakli_agda (sunucu IP'sinde de; izin listesinden ONCE).
  for (const [ip, ag] of [['10.0.0.9', '10.0.0.0/24'], ['10.20.30.40', '10.20.30.40/32']]) {
    ({ r } = await sinifla(ip, { yasak: YASAK(`10.99.0.0/16 ${ag}`) }));
    assert.deepEqual([r.status, r.code, r.message], [409, 'ip_yasakli_agda', `${ip} yasaklı bir ağda (${ag}, NGINX_LOADTEST_SERBEST_YASAK); yük testi yapılmaz.`], ip);
  }
  // Addan PROD / EDU, dbo.Inventory'de olmayan, ALPHA / Production Inventory sahibi ve uretim isareti -> hedef_uretim.
  const uretim = async (ip, veri, sebep, host) => {
    const { r: x } = await sinifla(ip, { veri });
    assert.deepEqual([x.status, x.code, x.message], [409, 'hedef_uretim', `${ip}, ${host} sunucusuna ait (${sebep}); yük testi yapılmaz.`], ip);
    assert.ok(Array.isArray(x.sahipler) && x.sahipler.some((s) => s.host === host), 'sahipler govdede yok');
  };
  await uretim('10.9.0.1', {}, 'ortamı PROD', 'GBNGXP40');
  await uretim('10.0.0.51', {}, 'ortamı EDU', 'GBNGXT51');
  await uretim('10.20.30.60', { ipEnvanteri: [{ host: 'WEBSRV01', ip: '10.20.30.60' }] }, "dbo.Inventory'de kayıtlı değil", 'WEBSRV01');
  await uretim('10.20.30.51', { inventory: [{ host: 'GBALP01', env: 'Alpha', ip: '10.20.30.51' }] }, 'dbo.Inventory ortamı Alpha', 'GBALP01');
  await uretim('10.20.30.50', { inventory: [{ host: 'GBDBP01', env: 'Production', ip: '10.20.30.50' }] }, 'dbo.Inventory ortamı Production', 'GBDBP01');
  const isaretli = tbmwans().d.nginx.map((x) => (x.hostname === 'GBNGXT35' ? { ...x, env: 'Production' } : x));
  await uretim('10.0.0.7', { nginx: isaretli }, 'üretim işareti: dbo.nginx_inventory.env=Production', 'GBNGXT35');
  // Yuk makinesinin kendi IP'si -> ayni_host; yukHost verilmezse denetim atlanir.
  ({ r } = await sinifla('10.0.0.6'));
  assert.deepEqual([r.code, r.message], ['ayni_host', "10.0.0.6 yük makinesinin (GBNGXT34) kendi IP'si; hedef olamaz."]);
  ({ r } = await sinifla('10.0.0.6', { yukHost: null }));
  assert.deepEqual([r.tur, r.host], ['sunucu', 'GBNGXT34']);
  // Tek hedef modeli: nginx olmayan TEST Inventory sahibi -> sunucu (izinli agda olsa da serbest DEGIL); sahipsiz -> serbest.
  ({ r } = await sinifla('10.20.30.41', { veri: { inventory: [{ host: 'GBAPPT01', env: 'Test', ip: '10.20.30.41' }] } }));
  assert.deepEqual(r, { ok: true, tur: 'sunucu', host: 'GBAPPT01' });
  ({ r } = await sinifla('10.20.30.41', { veri: { inventory: [{ host: 'GBAPPT01', env: 'Test', ip: '10.20.30.41' }] }, aglar: [] }));
  assert.deepEqual(r, { ok: true, tur: 'sunucu', host: 'GBAPPT01' });
  ({ r } = await sinifla('10.20.30.40'));
  assert.deepEqual(r, { ok: true, tur: 'serbest', host: null, ag: '10.20.30.0/24', digerSahipler: [] });
  // Sahipsiz + izin listesi bos -> serbest_kapali.
  ({ r } = await sinifla('10.20.30.40', { aglar: [] }));
  assert.deepEqual([r.status, r.code, r.message], [409, 'serbest_kapali', '10.20.30.40 hiçbir envanterde kayıtlı değil ve serbest hedef kapalı (NGINX_LOADTEST_SERBEST_AGLAR tanımlı değil).']);
  // Izinli aglarin disi -> ip_izinli_agda_degil.
  ({ r } = await sinifla('10.20.31.40', { aglar: AG('10.20.30.0/24 10.20.32.7') }));
  assert.deepEqual([r.status, r.code, r.message], [409, 'ip_izinli_agda_degil', '10.20.31.40 hiçbir envanterde kayıtlı değil ve izinli ağların (10.20.30.0/24, 10.20.32.7/32) dışında.']);
  // Tarama yok / IPInventory yok / bos -> 424 envanter_okunamadi (sahipsizlik kanitlanamaz).
  for (const [veri, eksik] of [
    [{ tarama: null }, 'dbo.Nginx_Audit_Servers'], [{ ipEnvanteri: null }, 'dbo.IPInventory'], [{ ipEnvanteri: [] }, 'dbo.IPInventory'],
    [{ tarama: null, ipEnvanteri: null }, 'dbo.Nginx_Audit_Servers ve dbo.IPInventory'],
  ]) {
    ({ r } = await sinifla('10.20.30.40', { veri }));
    assert.deepEqual([r.status, r.code, r.message], [424, 'envanter_okunamadi', `Serbest hedef için IP sahipliği doğrulanamadı: ${eksik} okunamadı ya da boş.`], JSON.stringify(veri));
  }
  // Sunucu IP'si icin IPInventory eksikligi siniflandirmayi durdurmaz (yalniz serbest ister).
  assert.equal((await sinifla('10.0.0.5', { veri: { ipEnvanteri: null } })).r.tur, 'sunucu');
  // Bayat envanter -> 424 envanter_bayat (metinde tarih ve yas; yalniz tutmayan parcalar).
  ({ r } = await sinifla('10.20.30.40', { veri: { ipEnvanteriYasSaat: 49, ipEnvanteriSon: '2026-10-26 05:00:00' } }));
  assert.deepEqual([r.status, r.code, r.message], [424, 'envanter_bayat', 'Serbest hedef için envanter bayat: dbo.IPInventory son yükleme 2026-10-26 05:00:00 (49 saat önce, en çok 48); yükleyici / tarama işlerini kontrol edin.']);
  ({ r } = await sinifla('10.20.30.40', { veri: { taramaYasGun: 3, taramaSon: '2026-10-25' } }));
  assert.equal(r.message, 'Serbest hedef için envanter bayat: nginx taraması 2026-10-25 (3 gün önce, en çok 2); yükleyici / tarama işlerini kontrol edin.');
  ({ r } = await sinifla('10.20.30.40', { veri: { ipEnvanteriYasSaat: null, ipEnvanteriSon: null, taramaYasGun: null, taramaSon: null } }));
  assert.deepEqual([r.code, r.message], ['envanter_bayat', 'Serbest hedef için envanter bayat: dbo.IPInventory son yükleme ? (? saat önce, en çok 48); nginx taraması ? (? gün önce, en çok 2); yükleyici / tarama işlerini kontrol edin.']);
  assert.equal((await sinifla('10.20.30.40', { veri: { ipEnvanteriYasSaat: 48, taramaYasGun: 2 } })).r.tur, 'serbest', 'sinirdaki taze envanter reddedildi');
  // FQDN ve kucuk harfli sahip adi normallesir; FQDN Inventory satirinin ortami IP satirindan (host IN okumasi bulmaz).
  ({ r, k } = await sinifla('10.20.30.41', { veri: { inventory: [{ host: 'gbappt01.bmw.local', env: 'Test', ip: ' 10.20.30.41 ' }] } }));
  assert.deepEqual(r, { ok: true, tur: 'sunucu', host: 'GBAPPT01' });
  assert.deepEqual(k.invTum.get('GBAPPT01'), ['Test']);
  ({ r } = await sinifla('10.20.30.41', { veri: { inventory: [{ host: 'gbappt01.bmw.local', env: 'Production', ip: '10.20.30.41' }] } }));
  assert.equal(r.code, 'hedef_uretim');
  ({ r } = await sinifla('10.20.30.42', { veri: { tarama: [{ host: 'gbngxt35', listen: '10.20.30.42:443 ssl', server_name: 'x.test.local' }] } }));
  assert.deepEqual(r, { ok: true, tur: 'sunucu', host: 'GBNGXT35' });
  // IPInventory tireli host onarimi: yukleyici 'GB-PRODDB01-10.20.30.45' satirini ilk '-'ten boler
  // (host 'GB', ip 'PRODDB01-10.20.30.45'); onarim olmasa IP sahipsiz gorunur ve serbest olurdu.
  ({ r, k } = await sinifla('10.20.30.45', { veri: { ipEnvanteri: [{ host: 'GB', ip: 'PRODDB01-10.20.30.45' }], inventory: [{ host: 'gb-proddb01', env: 'Production', ip: '10.99.0.1' }] } }));
  assert.deepEqual([...k.ipSahipleri.keys()], ['GB-PRODDB01']);
  assert.deepEqual([r.code, r.message], ['hedef_uretim', '10.20.30.45, GB-PRODDB01 sunucusuna ait (dbo.Inventory ortamı Production); yük testi yapılmaz.']);
  // sahipler govdesi en cok 10.
  const cok = Array.from({ length: 12 }, (_, i) => ({ host: `GBNGXT${60 + i}`, listen: '10.0.0.200:443', server_name: 'c.test.local' }));
  const cokInv = [...tbmwans().d.inventory, ...cok.map((x) => ({ host: x.host, env: 'Test', ip: '10.0.1.1' }))];
  ({ r } = await sinifla('10.0.0.200', { veri: { tarama: cok, inventory: cokInv } }));
  assert.deepEqual([r.code, r.sahipler.length], ['ip_belirsiz', 10]);
  // Gecersiz / kullanilamaz IP -> 400 (siniflandirma yok).
  for (const ip of ['127.0.0.1', '0.1.2.3', '224.0.0.1', '169.254.1.1']) {
    assert.deepEqual(dg.ipSinifla(ip, { nginx: new Map(), inv: new Map() }, {}), dg.red(400, 'gecersiz_istek', 'hedefIp kullanılabilir bir IPv4 değil (0/8, 127/8, 169.254/16, 224+ olamaz).'), ip);
  }
});

test('YD18 parametreler wrk: kanonik nesne, hesaplanan tavan, her mesaj; k6 serbest tavanlari', () => {
  const w = dg.parametreler({ motor: 'wrk' }, { sni: false });
  assert.equal(w.ok, true);
  assert.deepEqual(w.deger, { motor: 'wrk', baglantilar: [2, 4, 8], is_parcacigi: 2, tavan_rps: 5000, tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, kip: 'yeni', ae: 'br', sni: false, protokol: 'h1', sunucuAyar: null, butceSn: 1380 });
  assert.deepEqual(Object.keys(w.deger), ['motor', 'baglantilar', 'is_parcacigi', 'tavan_rps', 'tekrar', 'isinma', 'sure', 'bosluk', 'bosta', 'kip', 'ae', 'sni', 'protokol', 'sunucuAyar', 'butceSn']);
  // Ayni girdi -> ayni nesne; gonderilen tavan_rps / hizlar / maxvu yok sayilir (kanonik nesneye girmez).
  assert.deepEqual(dg.parametreler({ ...w.deger }, { sni: false }).deger, w.deger);
  assert.deepEqual(dg.parametreler({ motor: 'wrk', tavan_rps: 9999, hizlar: [450], maxvu: 199 }, { sni: false }).deger, w.deger);
  // K2 (2026-11-03): tavan sunucuda HER ZAMAN 5000 (olculen limit_req daraltmaz; asim uyaridir), serbestte 200.
  assert.equal(dg.parametreler({ motor: 'wrk' }, { sni: false, hizSiniri: 270, vuSiniri: 99 }).deger.tavan_rps, 5000);
  assert.equal(dg.parametreler({ motor: 'wrk' }, { sni: false, hizSiniri: 999 }).deger.tavan_rps, 5000);
  assert.equal(dg.parametreler({ motor: 'wrk', tavan_rps: 450 }, { sni: false, hedefTuru: 'serbest' }).deger.tavan_rps, 200);
  const m400 = (ham, ek = {}) => {
    const r = dg.parametreler(ham, { sni: false, ...ek });
    assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'gecersiz_istek'], JSON.stringify(ham));
    return r.message;
  };
  assert.equal(m400({ motor: 'k7' }), "motor 'k6' ya da 'wrk' olmalı.");
  assert.equal(m400({ motor: null }), "motor 'k6' ya da 'wrk' olmalı.");
  assert.equal(m400({ motor: 'wrk', baglantilar: [] }), 'baglantilar en az bir değer içermeli.');
  assert.equal(m400({ motor: 'wrk', baglantilar: '2 4' }), 'baglantilar en az bir değer içermeli.');
  assert.equal(m400({ motor: 'wrk', baglantilar: [2, 'dort'] }), 'baglantilar tam sayı olmalı.');
  assert.equal(m400({ motor: 'wrk', baglantilar: [2.5] }), 'baglantilar tam sayı olmalı.');
  assert.equal(m400({ motor: 'wrk', is_parcacigi: 'iki' }), 'is_parcacigi tam sayı olmalı.');
  assert.equal(m400({ motor: 'wrk' }, { sni: true }), "wrk SNI'yi Host başlığına göre seçemez (IP adresi SNI olarak gider); SNI kutusunu kapatın.");
  assert.equal(m400({}, { hedefTuru: 'lb' }), "hedefTuru 'sunucu' ya da 'serbest' olmalı.");
  const asim = (ham, ek = {}) => {
    const r = dg.parametreler(ham, { sni: false, ...ek });
    assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'sinir_asildi'], JSON.stringify(ham));
    return r.asimlar;
  };
  assert.deepEqual(asim({ motor: 'wrk', baglantilar: [2, 4, 6, 8, 10, 12] }), ['en çok 5 bağlantı kademesi']);
  assert.deepEqual(asim({ motor: 'wrk', baglantilar: [4, 4] }), ['aynı bağlantı sayısı iki kez']);
  assert.deepEqual(asim({ motor: 'wrk', baglantilar: [2, 200] }), ['bağlantı 200 izinli aralıkta değil (1..199)']);
  assert.equal(dg.parametreler({ motor: 'wrk', baglantilar: [2, 4] }, { sni: false, vuSiniri: 3 }).ok, true, 'K2: limit_conn baglantiyi daraltmaz');
  assert.deepEqual(asim({ motor: 'wrk', baglantilar: [2, 52] }, { hedefTuru: 'serbest' }), ['bağlantı 52 izinli aralıkta değil (1..50, serbest hedef tavanı)']);
  assert.equal(dg.parametreler({ motor: 'wrk', baglantilar: [2, 50] }, { sni: false, hedefTuru: 'serbest' }).ok, true);
  assert.deepEqual(asim({ motor: 'wrk', is_parcacigi: 17, baglantilar: [32] }), ['iş parçacığı 17 (izinli 1..16)']);
  assert.deepEqual(asim({ motor: 'wrk', is_parcacigi: 0 }), ['iş parçacığı 0 (izinli 1..16)']);
  assert.deepEqual(asim({ motor: 'wrk', is_parcacigi: 4 }), ['iş parçacığı 4 en küçük bağlantı sayısından (2) büyük', 'bağlantı 2, iş parçacığı sayısına (4) tam bölünmüyor']);
  assert.deepEqual(asim({ motor: 'wrk', baglantilar: [3, 6, 9], is_parcacigi: 2 }), ['bağlantı 3, iş parçacığı sayısına (2) tam bölünmüyor', 'bağlantı 9, iş parçacığı sayısına (2) tam bölünmüyor']);
  assert.equal(dg.parametreler({ motor: 'wrk', baglantilar: [3, 6, 9], is_parcacigi: 3 }, { sni: false }).ok, true);
  assert.match(dg.parametreler({ motor: 'wrk', baglantilar: [1, 2, 3, 4, 5], is_parcacigi: 1, tekrar: 3, sure: 300, isinma: 60, bosluk: 120 }, { sni: false }).message, /toplam süre \d+ sn > 2700/);
  // B3: eski "sifir sinir" (hizSiniri / vuSiniri 0) wrk'de de 409 DEGIL (parametreler limiti okumaz).
  for (const t of [{ hizSiniri: 0 }, { vuSiniri: 0 }]) {
    const r = dg.parametreler({ motor: 'wrk' }, { sni: false, ...t });
    assert.equal(r.ok, true, JSON.stringify(t));
  }
  // k6 serbest: tanimsiz hizlar / maxvu VARSAYILAN.serbest'ten; tavanlar 200 / 50 ve ek metin.
  assert.deepEqual(dg.parametreler({}, { sni: true, hedefTuru: 'serbest' }).deger, { motor: 'k6', hizlar: [50, 100, 200], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 50, kip: 'yeni', ae: 'br', sni: true, protokol: 'h1', sunucuAyar: null, butceSn: 1380 });
  assert.deepEqual(asim({ hizlar: [201] }, { hedefTuru: 'serbest' }), ['hız 201 izinli aralıkta değil (1..200, serbest hedef tavanı)']);
  assert.deepEqual(asim({ maxvu: 51 }, { hedefTuru: 'serbest' }), ['maxvu 51 (izinli 10..50, serbest hedef tavanı)']);
  assert.equal(dg.parametreler({ hizlar: [200], maxvu: 50 }, { sni: false, hedefTuru: 'serbest' }).ok, true);
  // Sunucudaki k6 metinleri tur 2 ile BIREBIR.
  assert.deepEqual(asim({ hizlar: [5001] }), ['hız 5001 izinli aralıkta değil (1..5000)']);
  assert.equal(dg.parametreler({ hizlar: [181] }, { sni: false, hizSiniri: 180 }).ok, true, 'K2: limit_req hizi daraltmaz');
  assert.deepEqual(asim({ maxvu: 1001 }), ['maxvu 1001 (izinli 10..1000)']);
  assert.equal(dg.parametreler({ maxvu: 100 }, { sni: false, vuSiniri: 99 }).ok, true, 'K2: limit_conn VU daraltmaz');
  // Sinirlar ve varsayilanlar (kod sabiti).
  assert.deepEqual(
    ['baglantiMin', 'maxBaglanti', 'maxBaglantiSayisi', 'isParcacigiMin', 'maxIsParcacigi', 'serbestMinOnek', 'serbestTavanRps', 'serbestMaxBaglanti', 'isGecerlilikSn', 'ipEnvanteriMaxYasSaat', 'taramaMaxYasGun'].map((x) => dg.SINIRLAR[x]),
    [1, 199, 5, 1, 16, 24, 200, 50, 900, 48, 2],
  );
  assert.deepEqual([dg.VARSAYILAN.motor, dg.VARSAYILAN.baglantilar, dg.VARSAYILAN.is_parcacigi, dg.VARSAYILAN.serbest], ['k6', [2, 4, 8], 2, { hizlar: [50, 100, 200], maxvu: 50 }]);
  assert.ok(Object.isFrozen(dg.VARSAYILAN.serbest) && Object.isFrozen(dg.VARSAYILAN.baglantilar));
  assert.deepEqual([[...dg.MOTORLAR], [...dg.HEDEF_TURLERI], dg.WRK_SURUM, dg.ESKI_K6_ISARETI, dg.ESKI_WRK_ISARETI],
    [['k6', 'wrk'], ['sunucu', 'serbest'], '4.2.0', '/yeni-playbook-gerekli/k6', '/yeni-playbook-gerekli/wrk']);
  assert.equal(dg.VARSAYILAN_WRK, undefined);
});

test('YD19 butceSn: adim sayisi motora gore; motor\'suz eski nesne k6', () => {
  const ortak = { tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60 };
  assert.equal(dg.butceSn({ ...ortak, hizlar: [1, 2, 3] }), 60 + 3 * 2 * 200 + 120);
  assert.equal(dg.butceSn({ ...ortak, motor: 'k6', hizlar: [1, 2], baglantilar: [1, 2, 3, 4] }), 60 + 2 * 2 * 200 + 120);
  assert.equal(dg.butceSn({ ...ortak, motor: 'wrk', baglantilar: [2, 4, 8, 16], hizlar: [1] }), 60 + 4 * 2 * 200 + 120);
  // hizlar'siz wrk nesnesi cokmez.
  assert.equal(dg.butceSn({ ...ortak, motor: 'wrk', baglantilar: [2] }), 60 + 1 * 2 * 200 + 120);
  const w = dg.parametreler({ motor: 'wrk', baglantilar: [2, 4] }, { sni: false }).deger;
  assert.equal(w.butceSn, dg.butceSn(w));
  assert.equal(w.butceSn, 60 + 2 * 2 * (30 + 120 + 30 + 20) + 120);
});

const SIMDI = 1793000000;
function evKur({ p = dg.parametreler({}, { sni: false }).deger, hedefTuru = 'sunucu', islem = 'kosu', simdiSn = SIMDI, arac = islem === 'durdur' ? null : ARAC } = {}) {
  const s = dg.senaryoSatirlari([SATIR('/a.js'), SATIR('/b.css', { tur: 'css' })]);
  return dg.ekstraDegiskenler({
    islem, kosuId: 17, hedefHost: 'GBNGXT33', yukHost: 'GBNGXT34', hedefIp: hedefTuru === 'serbest' ? '10.20.30.40' : '10.0.0.5', vhost: 'app.test.local',
    senaryo: { tur: 'K', tsv: s.tsv, sha256: s.sha256 }, p, kok: '/sw/BMW_PORTAL/nginx_loadtest', arac, hedefTuru, simdiSn,
  });
}

test('YD20 extra_vars tur 3: k6 / wrk x sunucu / serbest, is gecerlilik penceresi, son kapi kurallari', () => {
  const den = (ev, simdiSn = SIMDI) => dg.ekstraDegiskenleriDenetle(ev, { simdiSn });
  const k6 = evKur();
  assert.deepEqual(den(k6), []);
  assert.equal(Object.keys(k6).length, 38);
  assert.deepEqual(Object.keys(k6), [...dg.EKSTRA_ANAHTARLAR]);
  assert.deepEqual(
    [k6.yuk_hedef_turu, k6.yuk_hedef_host, k6.yuk_motor, k6.yuk_hizlar, k6.yuk_maxvu, k6.yuk_baglantilar, k6.yuk_is_parcacigi, k6.yuk_tavan_rps, k6.yuk_son_epoch, k6.yuk_wrk_yolu, k6.yuk_k6_yolu],
    ['sunucu', 'GBNGXT33', 'k6', '100 250 400', '150', '', '', '', String(SIMDI + 900), '/yeni-playbook-gerekli/wrk', '/yeni-playbook-gerekli/k6'],
  );
  const pws = dg.parametreler({ motor: 'wrk' }, { sni: false, hedefTuru: 'serbest' }).deger;
  const ws = evKur({ p: pws, hedefTuru: 'serbest' });
  assert.deepEqual(den(ws), []);
  assert.deepEqual(
    [ws.yuk_hedef_turu, ws.yuk_hedef_host, ws.yuk_motor, ws.yuk_hizlar, ws.yuk_maxvu, ws.yuk_baglantilar, ws.yuk_is_parcacigi, ws.yuk_tavan_rps, ws.yuk_sni, ws.yuk_butce_sn],
    ['serbest', '', 'wrk', '', '', '2 4 8', '2', '200', '0', '1380'],
  );
  const wu = evKur({ p: dg.parametreler({ motor: 'wrk' }, { sni: false, hizSiniri: 270 }).deger });
  assert.deepEqual(den(wu), []);
  assert.equal(wu.yuk_tavan_rps, '5000');
  const k6s = evKur({ p: dg.parametreler({}, { sni: true, hedefTuru: 'serbest' }).deger, hedefTuru: 'serbest' });
  assert.deepEqual(den(k6s), []);
  assert.deepEqual([k6s.yuk_hizlar, k6s.yuk_maxvu, k6s.yuk_sni], ['50 100 200', '50', '1']);
  // Eski (motor'suz) p -> k6.
  const eskiP = { hizlar: [100], tekrar: 1, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'ka', ae: 'gzip', sni: false, butceSn: 380 };
  const ek6 = evKur({ p: eskiP });
  assert.deepEqual([ek6.yuk_motor, ek6.yuk_hizlar, ek6.yuk_baglantilar, ek6.yuk_tavan_rps], ['k6', '100', '', '']);
  assert.deepEqual(den(ek6), []);
  // Is gecerlilik penceresi: simdi <= deger <= simdi + 1800; 10 hane; metin.
  const ihlal = (ev, anahtar) => den(ev).includes(anahtar);
  assert.ok(ihlal({ ...k6, yuk_son_epoch: String(SIMDI - 5) }, 'yuk_son_epoch'), 'gecmis epoch kabul edildi');
  assert.ok(ihlal({ ...k6, yuk_son_epoch: String(SIMDI + 1801) }, 'yuk_son_epoch'), 'simdi + 1801 kabul edildi');
  assert.ok(ihlal({ ...k6, yuk_son_epoch: '179300090' }, 'yuk_son_epoch'), '9 hane kabul edildi');
  assert.ok(ihlal({ ...k6, yuk_son_epoch: SIMDI + 900 }, 'yuk_son_epoch'), 'sayi tipi kabul edildi');
  assert.deepEqual(den({ ...k6, yuk_son_epoch: String(SIMDI + 1800) }), []);
  assert.deepEqual(den({ ...k6, yuk_son_epoch: String(SIMDI) }), []);
  // 900 sn sonra baslatilan ayni degiskenler hala gecerli, 1801 sn sonra degil (Relaunch kapisi playbook'ta).
  assert.ok(ihlal(k6, 'yuk_son_epoch') === false);
  assert.ok(den(k6, SIMDI + 901).includes('yuk_son_epoch'));
  // Her kural (sozlesme bolum 3) - ihlal edilen anahtar listede.
  for (const [ev, ek, anahtar] of [
    [k6, { yuk_hedef_turu: 'Sunucu' }, 'yuk_hedef_turu'],
    [k6, { yuk_hedef_turu: 'x' }, 'yuk_hedef_turu'],
    [ws, { yuk_hedef_host: 'GBNGXT33' }, 'yuk_hedef_host'],
    [k6, { yuk_hedef_host: '' }, 'yuk_hedef_host'],
    [k6, { yuk_hedef_host: 'GBNGXP40' }, 'yuk_hedef_host'],
    [k6, { yuk_hedef_host: 'GBNGXT51' }, 'yuk_hedef_host'],
    [k6, { yuk_yuk_host: 'GBNGXP50' }, 'yuk_yuk_host'],
    [k6, { yuk_yuk_host: 'GBNGXT51' }, 'yuk_yuk_host'],
    [k6, { yuk_motor: 'K6' }, 'yuk_motor'],
    [ws, { yuk_sni: '1' }, 'yuk_sni'],
    [ws, { yuk_hizlar: '100' }, 'yuk_hizlar'],
    [ws, { yuk_maxvu: '50' }, 'yuk_maxvu'],
    [ws, { yuk_tavan_rps: '' }, 'yuk_tavan_rps'],
    [k6, { yuk_baglantilar: '2 4' }, 'yuk_baglantilar'],
    [k6, { yuk_is_parcacigi: '2' }, 'yuk_is_parcacigi'],
    [k6, { yuk_tavan_rps: '450' }, 'yuk_tavan_rps'],
    [k6s, { yuk_hizlar: '50 201' }, 'yuk_hizlar'],
    [k6s, { yuk_maxvu: '51' }, 'yuk_maxvu'],
    [wu, { yuk_baglantilar: '2 200' }, 'yuk_baglantilar'],
    [ws, { yuk_baglantilar: '2 52' }, 'yuk_baglantilar'],
    [wu, { yuk_baglantilar: '0 2' }, 'yuk_baglantilar'],
    [wu, { yuk_baglantilar: '2 02' }, 'yuk_baglantilar'],
    [wu, { yuk_baglantilar: '2 4 6 8 10 12' }, 'yuk_baglantilar'],
    [wu, { yuk_baglantilar: '2,4' }, 'yuk_baglantilar'],
    [wu, { yuk_is_parcacigi: '0' }, 'yuk_is_parcacigi'],
    [wu, { yuk_is_parcacigi: '17' }, 'yuk_is_parcacigi'],
    [wu, { yuk_is_parcacigi: '4' }, 'yuk_is_parcacigi'],
    [wu, { yuk_baglantilar: '3 6 9', yuk_is_parcacigi: '2' }, 'yuk_is_parcacigi'],
    [wu, { yuk_tavan_rps: '0' }, 'yuk_tavan_rps'],
    [wu, { yuk_tavan_rps: '5001' }, 'yuk_tavan_rps'],
    [wu, { yuk_tavan_rps: '50000' }, 'yuk_tavan_rps'],
    [ws, { yuk_tavan_rps: '201' }, 'yuk_tavan_rps'],
    [wu, { yuk_butce_sn: '1259' }, 'yuk_butce_sn'],
    [k6, { yuk_butce_sn: '1259' }, 'yuk_butce_sn'],
    [wu, { yuk_wrk_yolu: 'wrk' }, 'yuk_wrk_yolu'],
    [wu, { yuk_wrk_yolu: '/home/www/../tmp/wrk' }, 'yuk_wrk_yolu'],
    [wu, { yuk_wrk_yolu: '/home/www/bin/wrk;id' }, 'yuk_wrk_yolu'],
    [k6, { yuk_wrk_yolu: '/home/www/../tmp/wrk' }, 'yuk_wrk_yolu'],
  ]) assert.ok(ihlal({ ...ev, ...ek }, anahtar), `${JSON.stringify(ek)} -> ${anahtar} beklendi: ${JSON.stringify(den({ ...ev, ...ek }))}`);
  // Butce ek paysiz formulun tam sinirinda gecer (1260 = 60 + 3 * 2 * 180 + 120).
  assert.deepEqual(den({ ...wu, yuk_butce_sn: '1260' }), []);
  // Durdur: "on_kontrol, kosu" kurallari DENETLENMEZ (eski satir), hedef turu yoksa sunucu sayilir
  // ama anahtar eksik oldugu icin yine reddedilir (Portal her zaman 33 anahtar gonderir).
  const dk = evKur({ islem: 'durdur', p: eskiP });
  assert.deepEqual(den(dk), []);
  assert.deepEqual(den({ ...dk, yuk_sure_sn: '30', yuk_son_epoch: '1', yuk_hizlar: '999' }), [], 'durdurda kosu kurallari denetlendi');
  const dkEksik = { ...dk };
  delete dkEksik.yuk_hedef_turu;
  assert.deepEqual(den(dkEksik), ['yuk_hedef_turu']);
  assert.deepEqual(den({ ...dk, yuk_hedef_turu: 'x' }), ['yuk_hedef_turu']);
  const ds = evKur({ islem: 'durdur', p: pws, hedefTuru: 'serbest' });
  assert.deepEqual(den(ds), []);
  assert.deepEqual(den({ ...ds, yuk_hedef_host: 'GBNGXT33' }), ['yuk_hedef_host']);
  assert.deepEqual(den({ ...dk, yuk_hedef_host: 'GBNGXP40' }), ['yuk_hedef_host'], 'durdurda ad kurali denetlenmedi');
});

// Tur 2 onKontrolDegerlendir ciktisi + YALNIZ D7 donusumu (server_name engeli kalkar, uyari listesinin
// basina HOST_LISTEDE_YOK). Beklenenler eski fonksiyondan uretildi ve SABIT yazildi.
const YD21_TEMIZ = {
  ip_yerel: true, server_name_var: true, master_sayisi: 1, web_log_df: 40, log_dizini_okunur: true, log_format_ua: true,
  statik_direktif: false, k6_var: true, yollar_toplam: 10, yollar_200: 10, sikistirma: { statik: 0, dinamik: 5, sikistirmasiz: 5 },
};
const H = '<HOST_LISTEDE_YOK>';
const YD21_SABIT = [
  ['temiz', {}, { engeller: [], uyarilar: [] }],
  ['ip yerel degil', { ip_yerel: false }, { engeller: ['seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)'], uyarilar: [] }],
  ['server_name false', { server_name_var: false }, { engeller: [], uyarilar: [H] }],
  ['server_name null', { server_name_var: null }, { engeller: [], uyarilar: [H] }],
  ['k6 yok', { k6_var: false }, { engeller: ['k6 yük makinesinde bulunamadı'], uyarilar: [] }],
  ['log dizini okunamiyor', { log_dizini_okunur: false }, { engeller: ['log dizini /web_log okunamıyor'], uyarilar: [] }],
  ['yol denenmedi', { yollar_toplam: 0 }, { engeller: ['ön kontrolde hiçbir yol denenmedi'], uyarilar: [] }],
  ['200 olculemedi', { yollar_200: null }, { engeller: [], uyarilar: ['200 dönen yol sayısı ölçülemedi'] }],
  ['yol 200 donmedi', { yollar_200: 7 }, { engeller: [], uyarilar: ['3/10 yol 200 dönmedi'] }],
  ['on-sikistirilmis', { sikistirma: { statik: 3 } }, { engeller: [], uyarilar: ['hedefte ön-sıkıştırılmış dosyalar var (3 yol)'] }],
  ['df olculemedi', { web_log_df: null }, { engeller: [], uyarilar: ['/web_log doluluğu ölçülemedi'] }],
  ['df dolu', { web_log_df: 70 }, { engeller: [], uyarilar: ['/web_log %70 dolu (>= %65: disk temizleyici koşu sırasında logları silebilir)'] }],
  ['ua yok', { log_format_ua: false }, { engeller: [], uyarilar: ["etkin log_format'ta user-agent= yok: sunucu tarafı ölçüm eksik kalır"] }],
  ['master olculemedi', { master_sayisi: null }, { engeller: [], uyarilar: ['nginx master süreç sayısı ölçülemedi (1 bekleniyor)'] }],
  ['master 2', { master_sayisi: 2 }, { engeller: ['nginx master süreç sayısı 2 (1 bekleniyor; CPU kaydedici bu durumda başlamaz)'], uyarilar: [] }],
  ['hepsi kotu', { ip_yerel: false, server_name_var: false, k6_var: false, log_dizini_okunur: false, yollar_toplam: 0, sikistirma: { statik: 3 }, web_log_df: null, log_format_ua: false, master_sayisi: 2 }, {
    engeller: ['seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)', 'k6 yük makinesinde bulunamadı', 'log dizini /web_log okunamıyor', 'ön kontrolde hiçbir yol denenmedi', 'nginx master süreç sayısı 2 (1 bekleniyor; CPU kaydedici bu durumda başlamaz)'],
    uyarilar: [H, 'hedefte ön-sıkıştırılmış dosyalar var (3 yol)', '/web_log doluluğu ölçülemedi', "etkin log_format'ta user-agent= yok: sunucu tarafı ölçüm eksik kalır"],
  }],
  ['metin bicimi', { ip_yerel: 'True', server_name_var: 'no', master_sayisi: '1', web_log_df: '66', log_dizini_okunur: 'false', yollar_200: '9', yollar_toplam: '10' }, {
    engeller: ['log dizini /web_log okunamıyor'],
    uyarilar: [H, '1/10 yol 200 dönmedi', '/web_log %66 dolu (>= %65: disk temizleyici koşu sırasında logları silebilir)'],
  }],
];

test('YD21 onKontrolDegerlendir: k6 + sunucu sabit fikstur (D7 haric tur 2 ile birebir), wrk iki engel, serbest', () => {
  for (const [ad, ek, b] of YD21_SABIT) {
    const beklenen = { engeller: b.engeller, uyarilar: b.uyarilar.map((u) => (u === H ? dg.HOST_LISTEDE_YOK_UYARISI : u)) };
    assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...ek }, { hedefTuru: 'sunucu', motor: 'k6' }), beklenen, ad);
    assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...ek }), beklenen, `${ad} (varsayilan secenek)`);
  }
  // Sunucu + wrk: motor engeli k6 satirinin yerinde; iki durum iki metin; sabit WRK uyarisi sonda.
  const wrkTemiz = { ...YD21_TEMIZ, k6_var: null, wrk_var: true, wrk_calisiyor: true, wrk_surum: 'wrk 4.2.0 [epoll] Copyright (C) 2012 Will Glozer' };
  assert.deepEqual(dg.onKontrolDegerlendir(wrkTemiz, { motor: 'wrk' }), { engeller: [], uyarilar: [dg.WRK_UYARISI] });
  assert.deepEqual(dg.onKontrolDegerlendir({ ...wrkTemiz, wrk_var: false, wrk_calisiyor: false }, { motor: 'wrk' }).engeller, ['wrk yük makinesinde bulunamadı ya da çalıştırılamıyor']);
  assert.deepEqual(dg.onKontrolDegerlendir({ ...wrkTemiz, wrk_var: false, wrk_calisiyor: true, wrk_surum: 'wrk  [epoll] Copyright' }, { motor: 'wrk' }).engeller,
    ['wrk yük makinesinde çalışıyor ama sürümü okunamadı ya da 4 altında (wrk  [epoll] Copyright); araç setini yeniden hazırlayın (Yük Testi › Araçlar)']);
  assert.deepEqual(dg.onKontrolDegerlendir({ ...wrkTemiz, wrk_var: 'false', wrk_calisiyor: 'true', wrk_surum: null }, { motor: 'wrk' }).engeller,
    ['wrk yük makinesinde çalışıyor ama sürümü okunamadı ya da 4 altında (-); araç setini yeniden hazırlayın (Yük Testi › Araçlar)']);
  const wk = dg.onKontrolDegerlendir({ ...wrkTemiz, ip_yerel: false, wrk_var: false, wrk_calisiyor: false, log_dizini_okunur: false, server_name_var: false }, { motor: 'wrk' });
  assert.deepEqual(wk.engeller, ['seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)', 'wrk yük makinesinde bulunamadı ya da çalıştırılamıyor', 'log dizini /web_log okunamıyor']);
  assert.deepEqual(wk.uyarilar, [dg.HOST_LISTEDE_YOK_UYARISI, dg.WRK_UYARISI]);
  // k6 motorunda wrk alanlari, wrk motorunda k6 alani okunmaz.
  assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ, wrk_var: false }).engeller, []);
  // Serbest: hedef kurallari (ip_yerel, server_name, log dizini, master, df, log_format) degerlendirilmez.
  const serbestTemiz = {
    ip_yerel: null, server_name_var: null, master_sayisi: null, web_log_df: null, log_dizini_okunur: null, log_format_ua: null, statik_direktif: null,
    ip_yuk_makinesinde: false, serbest_ag: '10.20.30.0/24', k6_var: true, yollar_toplam: 2, yollar_200: 2, sikistirma: { statik: 0 },
  };
  assert.deepEqual(dg.onKontrolDegerlendir(serbestTemiz, { hedefTuru: 'serbest' }), { engeller: [], uyarilar: [dg.SERBEST_UYARISI] });
  assert.deepEqual(dg.onKontrolDegerlendir({ ...serbestTemiz, log_dizini_okunur: false, master_sayisi: 3, web_log_df: 99 }, { hedefTuru: 'serbest' }), { engeller: [], uyarilar: [dg.SERBEST_UYARISI] });
  for (const v of [null, true, undefined, 'True', '-']) {
    assert.deepEqual(dg.onKontrolDegerlendir({ ...serbestTemiz, ip_yuk_makinesinde: v }, { hedefTuru: 'serbest' }).engeller, ['hedef IP yük makinesinde yerel ya da ölçülemedi'], String(v));
  }
  assert.deepEqual(dg.onKontrolDegerlendir({ ...serbestTemiz, ip_yuk_makinesinde: 'false' }, { hedefTuru: 'serbest' }).engeller, []);
  // Serbest + wrk: iki sabit uyari (serbest once); motor engeli ayni kural.
  assert.deepEqual(dg.onKontrolDegerlendir({ ...serbestTemiz, k6_var: null, wrk_var: true }, { hedefTuru: 'serbest', motor: 'wrk' }), { engeller: [], uyarilar: [dg.SERBEST_UYARISI, dg.WRK_UYARISI] });
  assert.deepEqual(dg.onKontrolDegerlendir({ ...serbestTemiz, wrk_var: null }, { hedefTuru: 'serbest', motor: 'wrk' }).engeller, ['wrk yük makinesinde bulunamadı ya da çalıştırılamıyor']);
  // Yollar ve sikistirma iki kipte ayni (yuk makinesi tarafi).
  assert.deepEqual(dg.onKontrolDegerlendir({ ...serbestTemiz, yollar_200: 1, sikistirma: { statik: 1 } }, { hedefTuru: 'serbest' }).uyarilar,
    ['1/2 yol 200 dönmedi', 'hedefte ön-sıkıştırılmış dosyalar var (1 yol)', dg.SERBEST_UYARISI]);
  assert.deepEqual(dg.onKontrolDegerlendir({ ...serbestTemiz, yollar_toplam: 0 }, { hedefTuru: 'serbest' }).engeller, ['ön kontrolde hiçbir yol denenmedi']);
  // Taninmayan tur / motor fail-closed.
  for (const s of [{ hedefTuru: 'lb' }, { motor: 'k7' }]) assert.equal(dg.onKontrolDegerlendir(YD21_TEMIZ, s).engeller.length, 1, JSON.stringify(s));
  assert.equal(dg.SERBEST_UYARISI.startsWith('Serbest hedef: sunucu tarafı ölçüm (CPU, nginx logu) yapılmaz;'), true);
  assert.equal(dg.WRK_UYARISI.endsWith('wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz.'), true);
  // Arayuz (yukTestiOrtak.ts WRK_UYARISI) ayni metni gosterir: BIREBIR. Tavan ORTALAMA hizi sinirlar
  // (anlik kumelenme olur); burst'u baglanti sayisindan kucuk / burst'suz yolda 429 -> DUR.
  assert.equal(dg.WRK_UYARISI, 'wrk kapalı döngüdür: her bağlantı yanıtı alınca yeni istek gönderir. Portal her isteğe bağlantı başına sabit bekleme ekler; toplam hız ORTALAMADA koşunun tavanını (sunucu hedefinde en çok 5000; serbest hedefte 200 istek/sn) aşmaz; bağlantılar birlikte başlar, ilk istekler rastgele yayılır ama istekler kümelenebilir. limit_req burst\'ü bağlantı sayısından küçük ya da burst\'süz yollarda 429 alınır ve koşu durur; böyle yollarda k6 kullanın ya da bağlantı sayısını düşük tutun. Sunucu hedefinde tavan hedefin ölçülmüş limit_req değerine göre düşürülmez ve bunun için ayrıca uyarı çıkmaz: ölçülmüş limit_req\'i olan hedefte gerçek hız onu aşabilir; böyle hedefte k6 kullanın. İlk 429 ya da 5xx yanıtta iş parçacığı yük üretmeyi keser; 429, 5xx, 10\'dan fazla soket hatası ya da %1 üstü hata oranında koşu durur (DUR). Gecikme yüzdelikleri wrk\'nin koordineli ihmal düzeltmesiyle hesaplanır; wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz.');
  // Onay metni: sunucuda host, serbestte IP (bos beklenen hicbir metni kabul etmez).
  assert.equal(dg.onayMetniDogru(' 10.20.30.40 ', '10.20.30.40'), true);
  assert.equal(dg.onayMetniDogru('', ''), false);
  assert.equal(dg.onayMetniDogru('x', null), false);
});

test('YD22 kaynaklariOku ip / vhost: parametreli, IP SQL metninde YOK; ip\'siz cagrinin kaynaklari ve sirasi tur 2 ile ayni', async () => {
  const AYAR1 = [{ host: 'GBNGXT33', directive: 'limit_req_zone', value: '$binary_remote_addr zone=r:1m rate=100r/s' }];
  const t = tbmwans({ ayarlar: AYAR1 });
  const k = await dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: ['GBNGXT34'], ip: '10.0.0.9', vhost: 'app.test.local' });
  for (const s of t.sorgular) assert.doesNotMatch(s.q, /10\.0\.0\.9|GBNGXT3|2026-10/, `IP / host / gun SQL metnine gomuldu: ${s.q}`);
  const ipParam = t.sorgular.flatMap((s) => s.params).filter((p) => /^ip\d$/.test(p.name));
  assert.deepEqual(ipParam.map((p) => [p.name, p.type, p.value]), [['ip0', 'nv64', '%10.0.0.9%'], ['ip1', 'nv64', '10.0.0.9'], ['ip2', 'nv64', '%-10.0.0.9'], ['ip3', 'nv64', '%10.0.0.9%']]);
  // Tarama: son IKI gunun birlesimi / host basina en son gun; tazelik MAX(scan_date) uzerinde kalir.
  // Settings: gun seek'i (d, o), host basina varlik (EXISTS seek'i), etkin gunun limit satirlari.
  assert.deepEqual(t.sorgular.map((s) => s.q), [
    'SELECT hostname, env, ip, service FROM dbo.nginx_inventory',
    'SELECT host, env, ip FROM dbo.Inventory WHERE ip LIKE @ip0',
    "SELECT OBJECT_ID('dbo.IPInventory') AS oid",
    'SELECT TOP 1 1 AS x FROM dbo.IPInventory',
    'SELECT host, ip FROM dbo.IPInventory WHERE LTRIM(RTRIM(ip)) = @ip1 OR LTRIM(RTRIM(ip)) LIKE @ip2',
    'SELECT DATEDIFF(HOUR, MAX(last_seen_at), GETDATE()) AS yas_saat, CONVERT(varchar(19), MAX(last_seen_at), 120) AS son FROM dbo.IPInventory',
    "SELECT OBJECT_ID('dbo.Nginx_Audit_Servers') AS oid",
    `SELECT DISTINCT host, listen FROM dbo.Nginx_Audit_Servers WHERE ${SON_IKI} AND listen LIKE @ip3`,
    'SELECT DATEDIFF(DAY, MAX(scan_date), CAST(GETDATE() AS DATE)) AS yas_gun, CONVERT(varchar(10), MAX(scan_date), 23) AS son FROM dbo.Nginx_Audit_Servers',
    `SELECT DISTINCT host, server_name, CONVERT(varchar(10), scan_date, 23) AS gun FROM dbo.Nginx_Audit_Servers WHERE ${SON_IKI}`,
    `SELECT host, env, ip FROM dbo.Inventory WHERE ${INV_KISA_AD} IN (@h0,@h1)`,
    `SELECT host, listen, server_name, CONVERT(varchar(10), scan_date, 23) AS gun FROM dbo.Nginx_Audit_Servers WHERE ${SON_IKI} AND host IN (@s0,@s1)`,
    "SELECT OBJECT_ID('dbo.Nginx_Audit_Settings') AS oid",
    AYAR_GUNLERI,
    AYAR_VARLIK(2),
    AYAR_LIMIT(1),
  ]);
  // Bulunan sahip (GBNGXT33) Inventory env / tarama / limit okumasina girer (elle IP'de hedef hostu budur).
  assert.deepEqual(t.sorgular[10].params.map((p) => p.value), ['GBNGXT34', 'GBNGXT33']);
  // Gunler parametre (NVarChar(10)); limit sorgusu yalniz o gun satiri olan host(lar) icin.
  assert.deepEqual(t.sorgular[14].params.map((p) => [p.name, p.type, p.value]), [['a0', 'nv64', 'GBNGXT34'], ['a1', 'nv64', 'GBNGXT33'], ['d', 'nv10', '2026-10-28'], ['o', 'nv10', null]]);
  assert.deepEqual(t.sorgular[15].params.map((p) => [p.name, p.type, p.value]), [['a0', 'nv64', 'GBNGXT33'], ['g', 'nv10', '2026-10-28']]);
  assert.ok(k.sunucular.has('GBNGXT33'));
  assert.equal(dg.hedefAyrintisi(k, 'GBNGXT33').hizSiniri, 90);
  assert.deepEqual([k.taramaVar, k.ipEnvanteriVar, k.ipEnvanteriYasSaat, k.ipEnvanteriSon, k.taramaYasGun, k.taramaSon], [true, true, 3, '2026-10-28 06:00:00', 0, '2026-10-28']);
  assert.deepEqual(k.taramaAdlari.map((x) => [x.host, x.guncel]), [['GBNGXT33', true], ['GBNGXT34', true], ['GBNGXT33', true], ['GBNGXT35', true], ['GBNGXP40', true]]);
  assert.deepEqual(k.ipTaninmayan, []);
  // ip'siz / vhost'suz cagri (/hedefler): aday = nginx envanteri + son iki taramanin hostlari; dbo.Inventory kisa adla
  // okunur, tarama / limit yalniz hostOrtami'ndan gecenler icin (TEK HEDEF MODELI: ad kurali yok; GBNGXT51 EDU, GBNGXP40
  // uretim). Tarama / limit sorgulari iki gunluk pencereyle (2026-10-28 inceleme: yarim tarama gunu).
  const t2 = tbmwans({ ayarlar: AYAR1 });
  const k2 = await dg.kaynaklariOku({ query: t2.query, sql: t2.sql, ekHostlar: ['GBNGXT34'] });
  const nonProd = ['GBNGXT33', 'GBNGXT34', 'GBNGXT35'];
  assert.deepEqual(t2.sorgular.map((s) => [s.q, s.params.map((p) => p.value)]), [
    ['SELECT hostname, env, ip, service FROM dbo.nginx_inventory', []],
    ["SELECT OBJECT_ID('dbo.Nginx_Audit_Servers') AS oid", []],
    [`SELECT DISTINCT host FROM dbo.Nginx_Audit_Servers WHERE ${SON_IKI}`, []],
    [`SELECT host, env, ip FROM dbo.Inventory WHERE ${INV_KISA_AD} IN (@h0,@h1,@h2,@h3,@h4)`, ['GBNGXP40', ...nonProd, 'GBNGXT51']],
    [`SELECT host, listen, server_name, CONVERT(varchar(10), scan_date, 23) AS gun FROM dbo.Nginx_Audit_Servers WHERE ${SON_IKI} AND host IN (@s0,@s1,@s2)`, nonProd],
    ["SELECT OBJECT_ID('dbo.Nginx_Audit_Settings') AS oid", []],
    [AYAR_GUNLERI, []],
    [AYAR_VARLIK(3), [...nonProd, '2026-10-28', null]],
    [AYAR_LIMIT(1), ['GBNGXT33', '2026-10-28']],
  ]);
  assert.equal(k2.ipSahipleri.size, 0);
  assert.equal('taramaAdlari' in k2, false);
  // Bos Settings tablosu: gun yok -> limit sorgusu YOK, ayarlar bos (rate limit verisi var, hedefte limit yok).
  const t6 = tbmwans();
  const k6 = await dg.kaynaklariOku({ query: t6.query, sql: t6.sql, ekHostlar: ['GBNGXT34'] });
  assert.deepEqual([t6.sorgular.at(-1).q, k6.ayarlar.size], [AYAR_GUNLERI, 0]);
  // IP / ad / limit okuma hatasi 424 (okunamadi != yok).
  for (const [desen, kaynak] of [
    [/FROM dbo\.Inventory WHERE ip LIKE/, 'dbo.Inventory'], [/OBJECT_ID\('dbo\.IPInventory'\)/, 'dbo.IPInventory'], [/TOP 1 1 AS x/, 'dbo.IPInventory'],
    [/FROM dbo\.IPInventory WHERE/, 'dbo.IPInventory'], [/DATEDIFF\(HOUR/, 'dbo.IPInventory'], [/listen LIKE/, 'dbo.Nginx_Audit_Servers'],
    [/DATEDIFF\(DAY/, 'dbo.Nginx_Audit_Servers'], [/SELECT DISTINCT host, server_name, CONVERT/, 'dbo.Nginx_Audit_Servers'],
    [/SELECT host, listen, server_name, CONVERT/, 'dbo.Nginx_Audit_Servers'], [/AS d,\s+CONVERT/, 'dbo.Nginx_Audit_Settings'],
    [/AS d_var/, 'dbo.Nginx_Audit_Settings'], [/CONVERT\(date, @g, 23\)/, 'dbo.Nginx_Audit_Settings'],
  ]) {
    const t3 = tbmwans({ ayarlar: AYAR1 });
    await assert.rejects(
      dg.kaynaklariOku({ sql: t3.sql, ip: '10.0.0.9', vhost: 'app.test.local', query: (q, p) => (desen.test(q) ? Promise.reject(new Error('zaman asimi')) : t3.query(q, p)) }),
      (e) => e.status === 424 && e.code === 'envanter_okunamadi' && e.message.startsWith(`${kaynak} okunamadı`),
      String(desen),
    );
  }
  // Gecersiz IP SQL'e hic gitmez (LIKE joker enjeksiyonu yok).
  const t5 = tbmwans();
  await assert.rejects(dg.kaynaklariOku({ query: t5.query, sql: t5.sql, ip: '10.0.0.%' }), (e) => e.status === 400 && e.code === 'gecersiz_istek');
  assert.equal(t5.sorgular.length, 0);
  // vhost var, tarama tablosu yok -> taramaAdlari null ("veri yok").
  const t4 = tbmwans({ tarama: null });
  assert.equal((await dg.kaynaklariOku({ query: t4.query, sql: t4.sql, hostlar: ['GBNGXT34'], vhost: 'app.test.local' })).taramaAdlari, null);
});

test('YD23 D7: server_name olcumu engel degil, uyari listesinin basinda; olculmusse yok', () => {
  const o = { ip_yerel: true, server_name_var: true, master_sayisi: 1, web_log_df: 70, log_dizini_okunur: true, log_format_ua: true, k6_var: true, yollar_toplam: 2, yollar_200: 2 };
  for (const v of [false, null, undefined, 'false', '', 'no']) {
    const r = dg.onKontrolDegerlendir({ ...o, server_name_var: v });
    assert.deepEqual(r.engeller, [], `server_name_var ${JSON.stringify(v)} engel oldu`);
    assert.deepEqual(r.uyarilar, [dg.HOST_LISTEDE_YOK_UYARISI, '/web_log %70 dolu (>= %65: disk temizleyici koşu sırasında logları silebilir)'], JSON.stringify(v));
  }
  for (const v of [true, 'True', 'yes', '1']) {
    const r = dg.onKontrolDegerlendir({ ...o, server_name_var: v });
    assert.deepEqual(r, { engeller: [], uyarilar: ['/web_log %70 dolu (>= %65: disk temizleyici koşu sırasında logları silebilir)'] }, String(v));
  }
  // wrk motorunda da ayni; serbestte server_name hic degerlendirilmez.
  assert.equal(dg.onKontrolDegerlendir({ ...o, k6_var: null, wrk_var: true, server_name_var: false }, { motor: 'wrk' }).uyarilar[0], dg.HOST_LISTEDE_YOK_UYARISI);
  assert.ok(!dg.onKontrolDegerlendir({ ...o, server_name_var: false, ip_yuk_makinesinde: false }, { hedefTuru: 'serbest' }).uyarilar.includes(dg.HOST_LISTEDE_YOK_UYARISI));
  assert.equal(dg.HOST_LISTEDE_YOK_UYARISI, "Host başlığı (vhost) hedefin nginx -T çıktısındaki server_name'ler arasında yok ya da ölçülemedi (joker / regex ad olabilir; değilse istek default_server'a düşer). Ön kontroldeki 200 sonuçlarına bakın.");
});

test('YD24 Host basligi: server_name eslesmesi, host_uretim iki kipte, serbest plan uyarilari', async () => {
  const E = dg.serverNameEslesir;
  for (const [ad, vhost, beklenen] of [
    ['app.test.local', 'app.test.local', true], ['APP.test.local;', 'app.test.local', true], ['"app.test.local"', 'app.test.local', true],
    ['app.test.local', 'app.test.locals', false],
    ['*.wild.test.local', 'a.wild.test.local', true], ['*.wild.test.local', 'a.b.wild.test.local', true], ['*.wild.test.local', 'wild.test.local', false],
    ['.dot.test.local', 'dot.test.local', true], ['.dot.test.local', 'x.dot.test.local', true], ['.dot.test.local', 'xdot.test.local', false],
    ['pre.*', 'pre.test.local', true], ['pre.*', 'pre', false], ['pre.*', 'prefix.test.local', false],
    ['~^app\\.test\\.local$', 'app.test.local', false], ['~app', 'app.test.local', false], ['_', 'app.test.local', false], ['', 'app.test.local', false],
    ['*', 'app.test.local', false], ['*.', 'app.test.local', false], ['.', 'app.test.local', false], ['.*', 'app.test.local', false],
  ]) assert.equal(E(ad, vhost), beklenen, `${ad} ~ ${vhost}`);
  const hb = async (vhost, { hedefTuru = 'sunucu', yukHost = 'GBNGXT34', veri = {} } = {}) => {
    const t = tbmwans(veri);
    const k = await dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: [yukHost], vhost });
    return dg.hostBasligiDegerlendir(vhost, k, { hedefTuru, yukHost });
  };
  // Yalniz uretimde tanimli ad -> iki kipte 409 host_uretim (sahipler govdede).
  for (const tur of ['sunucu', 'serbest']) {
    const r = await hb('prod.only.local', { hedefTuru: tur });
    assert.deepEqual([r.ok, r.status, r.code, r.message], [false, 409, 'host_uretim', 'Host başlığı (prod.only.local) son taramada yalnız üretim / EDU / ortamı bilinmeyen nginx sunucularında tanımlı (GBNGXP40); bu adla yük testi yapılmaz.'], tur);
    assert.deepEqual(r.sahipler, [{ host: 'GBNGXP40', env: 'PROD', nginx: true, kaynaklar: ['tarama'] }]);
  }
  // Joker eslesme, EDU ve uretim isaretli sunucu da P sayilir.
  const ek = (satirlar, digeri = {}) => ({ veri: { tarama: [...tbmwans().d.tarama, ...satirlar], ...digeri } });
  assert.equal((await hb('a.prodwild.local', ek([{ host: 'GBNGXP41', listen: '443', server_name: '*.prodwild.local' }]))).code, 'host_uretim');
  assert.equal((await hb('edu.test.local', ek([{ host: 'GBNGXT51', listen: '443', server_name: 'edu.test.local' }]))).code, 'host_uretim');
  const isaretli = tbmwans().d.nginx.map((x) => (x.hostname === 'GBNGXT35' ? { ...x, env: 'Production' } : x));
  assert.equal((await hb('t35.test.local', ek([{ host: 'GBNGXT35', listen: '443', server_name: 't35.test.local' }], { nginx: isaretli }))).code, 'host_uretim');
  // > 5 uretim hostu: sirali ilk 5 + ' …'.
  const altiP = Array.from({ length: 6 }, (_, i) => ({ host: `GBNGXP${46 - i}`, listen: '443', server_name: 'cok.prod.local' }));
  assert.equal((await hb('cok.prod.local', ek(altiP))).message, 'Host başlığı (cok.prod.local) son taramada yalnız üretim / EDU / ortamı bilinmeyen nginx sunucularında tanımlı (GBNGXP41, GBNGXP42, GBNGXP43, GBNGXP44, GBNGXP45 …); bu adla yük testi yapılmaz.');
  // Uretim + TEST -> engel yok; sunucuda uyari yok, serbestte uretimde de var uyarisi.
  assert.deepEqual(await hb('paylasilan.test.local'), { ok: true, uyarilar: [] });
  assert.deepEqual(await hb('paylasilan.test.local', { hedefTuru: 'serbest' }), {
    ok: true, uyarilar: [dg.HOST_URETIMDE_DE_VAR_UYARISI('paylasilan.test.local', ['GBNGXP40']), dg.YUK_MAKINESI_RP_UYARISI('GBNGXT34')],
  });
  // Hicbir yerde yok -> sunucuda hicbir sey (D7: engel degil), serbestte taramada yok uyarisi.
  assert.deepEqual(await hb('yok.test.local'), { ok: true, uyarilar: [] });
  assert.deepEqual((await hb('yok.test.local', { hedefTuru: 'serbest' })).uyarilar, [dg.HOST_TARAMADA_YOK_UYARISI('yok.test.local'), dg.YUK_MAKINESI_RP_UYARISI('GBNGXT34')]);
  // Yuk makinesi havuzda (kendi server_name'i) ve internet RP'si -> iki uyari; RP olmayan yuk makinesi -> yok.
  assert.deepEqual((await hb('rp.test.local', { hedefTuru: 'serbest' })).uyarilar, [dg.YUK_MAKINESI_HAVUZDA_UYARISI('rp.test.local', 'GBNGXT34'), dg.YUK_MAKINESI_RP_UYARISI('GBNGXT34')]);
  assert.deepEqual(await hb('app.test.local', { hedefTuru: 'serbest', yukHost: 'GBNGXT35' }), { ok: true, uyarilar: [] });
  // Tarama tablosu yok -> sunucuda ok (veri yok), serbestte 424.
  assert.deepEqual(await hb('prod.only.local', { veri: { tarama: null } }), { ok: true, uyarilar: [] });
  const r424 = await hb('app.test.local', { hedefTuru: 'serbest', veri: { tarama: null } });
  assert.deepEqual([r424.status, r424.code], [424, 'envanter_okunamadi']);
  // Plan uyarisi metinleri (sozlesme 11) AYNEN; P sirali ilk 5.
  assert.equal(dg.HOST_TARAMADA_YOK_UYARISI('a.b'), 'Host başlığı (a.b) son nginx taramasında hiçbir sunucunun server_name listesinde yok: hedefin (LB / yönetilmeyen sunucu) bu adı nereye yönlendireceği bilinmiyor.');
  assert.equal(dg.HOST_URETIMDE_DE_VAR_UYARISI('a.b', ['GBNGXP06', 'GBNGXP01', 'GBNGXP05', 'GBNGXP02', 'GBNGXP04', 'GBNGXP03']), 'Host başlığı (a.b) üretim / EDU / ortamı bilinmeyen sunucularda da tanımlı (GBNGXP01, GBNGXP02, GBNGXP03, GBNGXP04, GBNGXP05): LB ya da reverse proxy bu adı üretim havuzuna yönlendirebilir; VIP’in hangi havuza gittiğini doğrulayın.');
  assert.equal(dg.YUK_MAKINESI_HAVUZDA_UYARISI('a.b', 'GBNGXT34'), 'Host başlığı (a.b) yük sunucusunun (GBNGXT34) kendi server_name listesinde: VIP’in havuzunda yük sunucusu da olabilir; yükün bir kısmı yük sunucusunun kendi nginx’ine döner ve istemci ölçümü bozulur. Mümkünse başka bir yük sunucusu seçin.');
  assert.equal(dg.YUK_MAKINESI_RP_UYARISI('GBNGXT34'), 'Yük sunucusu (GBNGXT34) bir internet reverse proxy’si; hedef VIP’in havuzunda kendisi de olabilir. Havuzu doğrulayın.');
});

test('YD25 tarama listen alani bloktaki TUM listen direktiflerini tasir: her belirtec sahiplik ve aday IP sayilir', async () => {
  // nginx_audit_scan.sh ayni server blogundaki listen'leri boslukla birlestirir (gercek tarayici ciktisi):
  // `listen 10.9.0.1:443 ssl http2; listen 10.20.30.40:443 ssl;` -> '10.9.0.1:443 ssl http2 10.20.30.40:443 ssl'.
  assert.deepEqual(dg.listenIpleri('10.9.0.1:443 ssl http2 10.20.30.40:443 ssl'), ['10.9.0.1', '10.20.30.40']);
  assert.deepEqual(dg.listenIpleri('443 ssl 10.20.30.41:8443 ssl default_server [::]:443 *:80 [::ffff:10.1.1.1]:443 unix:/run/n.sock backlog=511'), ['10.20.30.41']);
  for (const bos of [null, undefined, '', '443', 'ssl http2']) assert.deepEqual(dg.listenIpleri(bos), [], String(bos));
  // PROD nginx'in IKINCI listen IP'si: IPInventory'de yok, izin listesinde (10.20.30.0/24). Ilk belirtece
  // bakan eslesme bu IP'yi sahipsiz (serbest) sayardi; dogru sonuc PROD sahip -> hedef_uretim.
  const prod = { host: 'GBNGXP40', listen: '10.9.0.1:443 ssl http2 10.20.30.40:443 ssl', server_name: 'www.ornek.com.tr' };
  let { r, k } = await sinifla('10.20.30.40', { veri: { tarama: [...tbmwans().d.tarama, prod] } });
  assert.deepEqual([r.ok, r.status, r.code, r.message], [false, 409, 'hedef_uretim', '10.20.30.40, GBNGXP40 sunucusuna ait (ortamı PROD); yük testi yapılmaz.']);
  assert.deepEqual(r.sahipler, [{ host: 'GBNGXP40', env: 'PROD', nginx: true, kaynaklar: ['tarama'] }]);
  assert.deepEqual([...k.ipSahipleri.get('GBNGXP40')], ['tarama']);
  // TEST hostun ikinci listen IP'si (IPInventory'de o hostun): aday listesinde; host secici ve elle IP sunucu.
  const t33 = { host: 'GBNGXT33', listen: '10.0.0.9:443 ssl 10.0.0.77:443 ssl', server_name: 'app.test.local' };
  const veri = { tarama: [t33, ...tbmwans().d.tarama.slice(1)], ipEnvanteri: [...tbmwans().d.ipEnvanteri, { host: 'GBNGXT33', ip: '10.0.0.77' }] };
  for (const hedefHost of ['GBNGXT33', null]) {
    ({ r, k } = await sinifla('10.0.0.77', { veri, hedefHost }));
    assert.deepEqual(r, { ok: true, tur: 'sunucu', host: 'GBNGXT33' }, String(hedefHost));
    assert.deepEqual([...k.ipSahipleri.get('GBNGXT33')].sort(), ['dbo.IPInventory', 'tarama'], String(hedefHost));
    // /ip-sinifi "uygun" ve kosuPlani aday savunmasi bu listeye bakar (ip_hedefte_yok olmamali).
    assert.deepEqual(dg.hedefAyrintisi(k, 'GBNGXT33').ipler, ['10.0.0.5', '10.0.0.9', '10.0.0.77', '10.0.0.100'], String(hedefHost));
  }
});

test('YD26 yarim tarama gunu: sahiplik / adlar son iki gunden, hedef satirlari ve limitler hostun en son gunundan', async () => {
  // Analizci gunu 5000'lik commit'li partilerle yazar: bugun (MAX) YARIM, dun TAM. Bugun yalniz GBNGXT34 ve
  // GBNGXT35 yazildi; GBNGXT33 ve GBNGXP40 henuz yok. Yalniz MAX(scan_date) okuyan kod bu satirlari gormezdi.
  const DUN = '2026-10-27';
  const BUGUN = '2026-10-28';
  const YARIM = [
    { host: 'GBNGXT33', listen: '10.0.0.9:443 ssl', server_name: 'app.test.local api.test.local', gun: DUN },
    { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local', gun: DUN },
    { host: 'GBNGXT35', listen: '10.0.0.100:443 ssl', server_name: 'vip.test.local tasinan.test.local', gun: DUN },
    { host: 'GBNGXP40', listen: '10.9.0.1:443 ssl', server_name: 'prod.only.local tasinan.test.local', gun: DUN },
    { host: 'GBNGXP40', listen: '10.20.30.40:443 ssl', server_name: 'www.prodapp.local', gun: DUN },
    { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local', gun: BUGUN },
    { host: 'GBNGXT35', listen: '10.0.0.100:443 ssl', server_name: 'vip.test.local', gun: BUGUN },
  ];
  // (1) Sahiplik: PROD'un IP'si yalniz dunku Servers'ta -> 409 hedef_uretim (serbest DEGIL).
  let { r, k } = await sinifla('10.20.30.40', { veri: { tarama: YARIM } });
  assert.deepEqual([r.status, r.code, r.message], [409, 'hedef_uretim', '10.20.30.40, GBNGXP40 sunucusuna ait (ortamı PROD); yük testi yapılmaz.']);
  assert.deepEqual([...k.ipSahipleri.get('GBNGXP40')], ['tarama']);
  // (2) Host basligi: yalniz uretimde tanimli ad yalniz dunku satirda -> iki kipte 409 host_uretim.
  const hb = async (vhost, veri, hedefTuru = 'sunucu') => {
    const t = tbmwans(veri);
    const kk = await dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: ['GBNGXT34'], vhost });
    return dg.hostBasligiDegerlendir(vhost, kk, { hedefTuru, yukHost: 'GBNGXT34' });
  };
  for (const tur of ['sunucu', 'serbest']) {
    const x = await hb('prod.only.local', { tarama: YARIM }, tur);
    assert.deepEqual([x.status, x.code, x.sahipler.map((s) => s.host)], [409, 'host_uretim', ['GBNGXP40']], tur);
  }
  // (3) Non-prod ad yalniz hostun EN SON gunundan: GBNGXT35 adi bugun kaldirmis (bugunku satiri var, adsiz);
  // dunku bayat ad uretim engelini KALDIRMAZ. GBNGXP40 bugun henuz yazilmadi: dunku adi uretim sayilir.
  assert.equal((await hb('tasinan.test.local', { tarama: YARIM })).code, 'host_uretim');
  // Ayni ad GBNGXT35'in BUGUNKU satirinda da varsa engel yok (paylasilan ad; serbestte uyari).
  const bugunAdli = YARIM.map((x) => (x.host === 'GBNGXT35' && x.gun === BUGUN ? { ...x, server_name: 'vip.test.local tasinan.test.local' } : x));
  assert.deepEqual(await hb('tasinan.test.local', { tarama: bugunAdli }), { ok: true, uyarilar: [] });
  assert.deepEqual((await hb('tasinan.test.local', { tarama: bugunAdli }, 'serbest')).uyarilar[0], dg.HOST_URETIMDE_DE_VAR_UYARISI('tasinan.test.local', ['GBNGXP40']));
  // guncel alani: hostun iki gun icindeki en son gunu.
  const tk = tbmwans({ tarama: YARIM });
  const kk = await dg.kaynaklariOku({ query: tk.query, sql: tk.sql, hostlar: ['GBNGXT34'], vhost: 'x.test.local' });
  assert.deepEqual(kk.taramaAdlari.map((x) => `${x.host}:${x.guncel}`), ['GBNGXT33:true', 'GBNGXT34:false', 'GBNGXT35:false', 'GBNGXP40:true', 'GBNGXP40:true', 'GBNGXT34:true', 'GBNGXT35:true']);
  // (4) Hedef satirlari: bugun henuz yazilmamis GBNGXT33 dunku tam satirlarini kullanir (aday IP, vhost).
  const oku = async (veri) => {
    const t = tbmwans(veri);
    return dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: ['GBNGXT33', 'GBNGXT34'] });
  };
  k = await oku({ tarama: YARIM });
  assert.deepEqual([dg.hedefAyrintisi(k, 'GBNGXT33').ipler, dg.hedefAyrintisi(k, 'GBNGXT33').vhostlar], [['10.0.0.5', '10.0.0.9'], ['api.test.local', 'app.test.local']]);
  // Bugunku satiri varsa YALNIZ bugunku (iki gun karistirilmaz: dunku 10.0.0.9 aday olmaz).
  k = await oku({ tarama: [...YARIM, { host: 'GBNGXT33', listen: '10.0.0.19:443 ssl', server_name: 'yeni.test.local', gun: BUGUN }] });
  assert.deepEqual([dg.hedefAyrintisi(k, 'GBNGXT33').ipler, dg.hedefAyrintisi(k, 'GBNGXT33').vhostlar], [['10.0.0.5', '10.0.0.19'], ['yeni.test.local']]);
  // (5) Limitler: GBNGXT33 bugunku Settings'te yok (bugun yalniz GBNGXT35 yazildi), dunku limit 100 r/s uygulanir.
  const limit = (host, rate, gun) => [
    { host, directive: 'limit_req_zone', value: `$binary_remote_addr zone=r:1m rate=${rate}`, gun },
    { host, directive: 'limit_req', value: 'zone=r burst=20 nodelay', gun },
  ];
  const diger = { host: 'GBNGXT35', directive: 'worker_processes', value: 'auto', gun: BUGUN };
  k = await oku({ ayarlar: [diger, ...limit('GBNGXT33', '100r/s', DUN)] });
  const ay = dg.hedefAyrintisi(k, 'GBNGXT33');
  assert.equal(ay.hizSiniri, 90, 'dunku limit uygulanmadi (global tavana dustu)');
  assert.equal(ay.limitReq, 100);
  // K2: limit daraltmaz, plan uyarisi verir (dunku limitle).
  const p = dg.parametreler({ hizlar: [400] }, { sni: false, hizSiniri: ay.hizSiniri, vuSiniri: ay.vuSiniri });
  assert.equal(p.ok, true);
  assert.deepEqual(dg.limitUyarilari(p.deger, ay), ['Seçilen hız (400/sn) hedefin ölçülmüş limit_req değerini (100 r/s) aşıyor; 429 alınırsa koşu durur.']);
  assert.equal(dg.parametreler({ motor: 'wrk' }, { sni: false, hizSiniri: ay.hizSiniri, vuSiniri: ay.vuSiniri }).deger.tavan_rps, 5000);
  // Dunku 1 r/s: hizSiniri 0 (yalniz bilgi; B3 hedefi kapatmaz), limitReq 1 -> plan uyarisi.
  k = await oku({ ayarlar: [diger, ...limit('GBNGXT33', '1r/s', DUN)] });
  assert.deepEqual([dg.hedefAyrintisi(k, 'GBNGXT33').hizSiniri, dg.hedefAyrintisi(k, 'GBNGXT33').limitReq], [0, 1]);
  // Bugunku Settings satiri varsa bugunku: limit 300 r/s -> 270; bugun limitsiz (yalniz baska direktif) -> null.
  k = await oku({ ayarlar: [...limit('GBNGXT33', '300r/s', BUGUN), ...limit('GBNGXT33', '100r/s', DUN)] });
  assert.equal(dg.hedefAyrintisi(k, 'GBNGXT33').hizSiniri, 270);
  k = await oku({ ayarlar: [{ ...diger, host: 'GBNGXT33' }, ...limit('GBNGXT33', '100r/s', DUN)] });
  assert.equal(dg.hedefAyrintisi(k, 'GBNGXT33').hizSiniri, null, 'limit_req kaldirilmis hedefe dunku limit uygulandi');
  // Iki host iki farkli gunde: limit sorgusu gun basina (yalniz o gunun satirlari).
  const t2 = tbmwans({ ayarlar: [...limit('GBNGXT34', '200r/s', BUGUN), ...limit('GBNGXT33', '100r/s', DUN)] });
  k = await dg.kaynaklariOku({ query: t2.query, sql: t2.sql, hostlar: ['GBNGXT33', 'GBNGXT34'] });
  assert.deepEqual([dg.hedefAyrintisi(k, 'GBNGXT33').hizSiniri, dg.hedefAyrintisi(k, 'GBNGXT34').hizSiniri], [90, 180]);
  assert.deepEqual(t2.sorgular.filter((s) => s.q.startsWith('SELECT host, directive, value')).map((s) => s.params.map((x) => x.value)), [['GBNGXT33', DUN], ['GBNGXT34', BUGUN]]);
});

test('YD26b host_uretim kume kurallari: P iki gunun birlesimi, S = P + N (bayat non-prod ad uyariyi susturmaz)', async () => {
  // YD26'nin YARIM fiksturu ikisini ayiramaz: orada GBNGXP40'in bugun hic satiri yok (dunku satirlari guncel)
  // ve 'tasinan.test.local' GBNGXP40'ta da var. Ad yalniz hostun guncel OLMAYAN gununde: ayri fikstur.
  const DUN = '2026-10-27';
  const BUGUN = '2026-10-28';
  const oku = async (vhost, tarama) => {
    const t = tbmwans({ tarama });
    return dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: ['GBNGXT34'], vhost });
  };
  const hb = async (vhost, tarama, hedefTuru) => dg.hostBasligiDegerlendir(vhost, await oku(vhost, tarama), { hedefTuru, yukHost: 'GBNGXT34' });
  const guncel = async (vhost, tarama) => (await oku(vhost, tarama)).taramaAdlari.map((x) => `${x.host}:${x.server_name}:${x.guncel}`);
  // (1) GBNGXP40 bugun yazildi ama yalniz baska adli blokla (yarim yuklemede ad blogu henuz yazilmadi ya da
  // ad bugun kaldirildi); ad yalniz dunku satirda, baska sahibi yok -> P birlesimden: iki kipte 409.
  const p = [
    { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local', gun: BUGUN },
    { host: 'GBNGXP40', listen: '10.9.0.1:443 ssl', server_name: 'prod.only.local', gun: DUN },
    { host: 'GBNGXP40', listen: '10.9.0.1:443 ssl', server_name: 'baska.prod.local', gun: BUGUN },
  ];
  assert.deepEqual(await guncel('prod.only.local', p), ['GBNGXT34:rp.test.local:true', 'GBNGXP40:prod.only.local:false', 'GBNGXP40:baska.prod.local:true'], 'fikstur');
  for (const tur of ['sunucu', 'serbest']) {
    const x = await hb('prod.only.local', p, tur);
    assert.deepEqual([x.status, x.code], [409, 'host_uretim'], `${tur}: ${JSON.stringify(x)}`);
    assert.deepEqual(x.sahipler.map((s) => s.host), ['GBNGXP40'], tur);
  }
  // (2) Non-prod GBNGXT35 adi dun tasiyordu, bugun yalniz baska adla; ad hicbir uretim satirinda yok -> N bos
  // (guncel degil), S = P + N bos: serbestte 'taramada yok' uyarisi (S birlesimden kurulsa susardi).
  const s = [
    { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local', gun: BUGUN },
    { host: 'GBNGXT35', listen: '10.0.0.100:443 ssl', server_name: 'tasindi.test.local', gun: DUN },
    { host: 'GBNGXT35', listen: '10.0.0.100:443 ssl', server_name: 'vip.test.local', gun: BUGUN },
  ];
  assert.deepEqual(await guncel('tasindi.test.local', s), ['GBNGXT34:rp.test.local:true', 'GBNGXT35:tasindi.test.local:false', 'GBNGXT35:vip.test.local:true'], 'fikstur');
  const y = await hb('tasindi.test.local', s, 'serbest');
  assert.equal(y.ok, true, JSON.stringify(y));
  assert.equal(y.uyarilar[0], dg.HOST_TARAMADA_YOK_UYARISI('tasindi.test.local'));
});

// ── TUR 4 (2026-11-02, arac_sozlesme 3.1 / 3.7) ──────────────────────────────────────────────
//   YD40 extra_vars arac alanlari: 33 anahtar, isaret degerleri, durdurda ''; son kapi her arac kuralini
//        yakalar (eski Portal yolu, kok disi dizin, '..', rakamsiz id, buyuk harfli / bozuk sha; motor k6'da da
//        wrk sha'si); durdurda degerler denetlenmez ama anahtarlar zorunlu
//   YD41 onKontrolDegerlendir: aracli false -> cikti BIREBIR secenegsiz cagriyla ayni (eski satir); aracli true
//        -> dort engel metni; wrk yeni metin

test('YD40 extra_vars tur 4: arac dizini + iki sha, isaret yollari, durdurda bos, son kapi kurallari', () => {
  const den = (ev, simdiSn = SIMDI) => dg.ekstraDegiskenleriDenetle(ev, { simdiSn });
  assert.equal(dg.EKSTRA_ANAHTARLAR.length, 38);
  for (const [ad, p] of [['k6', dg.parametreler({}, { sni: false }).deger], ['wrk', dg.parametreler({ motor: 'wrk' }, { sni: false, hizSiniri: 270 }).deger]]) {
    const ev = evKur({ p });
    assert.deepEqual(den(ev), [], ad);
    assert.deepEqual([ev.yuk_arac_dizin, ev.yuk_k6_sha256, ev.yuk_wrk_sha256, ev.yuk_k6_yolu, ev.yuk_wrk_yolu],
      [ARAC.dizin, ARAC.k6Sha256, ARAC.wrkSha256, dg.ESKI_K6_ISARETI, dg.ESKI_WRK_ISARETI], ad);
    assert.deepEqual(Object.keys(ev), [...dg.EKSTRA_ANAHTARLAR], ad);
  }
  const k6 = evKur();
  const wrk = evKur({ p: dg.parametreler({ motor: 'wrk' }, { sni: false, hizSiniri: 270 }).deger });
  // Arac seti verilmezse uc alan '' -> on kontrol / kosu son kapisi reddeder.
  const aracsiz = evKur({ arac: null });
  assert.deepEqual([aracsiz.yuk_arac_dizin, aracsiz.yuk_k6_sha256, aracsiz.yuk_wrk_sha256], ['', '', '']);
  assert.deepEqual(den(aracsiz), ['yuk_arac_dizin', 'yuk_k6_sha256', 'yuk_wrk_sha256']);
  for (const [ev, ek, anahtar] of [
    [k6, { yuk_k6_yolu: '/home/www/bin/k6' }, 'yuk_k6_yolu'],
    [k6, { yuk_wrk_yolu: '/home/www/bin/wrk' }, 'yuk_wrk_yolu'],
    [wrk, { yuk_wrk_yolu: '/home/www/bin/wrk' }, 'yuk_wrk_yolu'],
    [k6, { yuk_arac_dizin: '' }, 'yuk_arac_dizin'],
    [k6, { yuk_arac_dizin: '/sw/BMW_PORTAL/baska/araclar/5' }, 'yuk_arac_dizin'],
    [k6, { yuk_arac_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/../5' }, 'yuk_arac_dizin'],
    [k6, { yuk_arac_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/abc' }, 'yuk_arac_dizin'],
    [k6, { yuk_arac_dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/5/k6' }, 'yuk_arac_dizin'],
    [k6, { yuk_arac_dizin: '/tmp/araclar/5' }, 'yuk_arac_dizin'],
    [k6, { yuk_arac_dizin: 5 }, 'yuk_arac_dizin'],
    [k6, { yuk_k6_sha256: 'CD'.repeat(32) }, 'yuk_k6_sha256'],
    [k6, { yuk_k6_sha256: 'c'.repeat(63) }, 'yuk_k6_sha256'],
    [wrk, { yuk_k6_sha256: '' }, 'yuk_k6_sha256'],
    [k6, { yuk_wrk_sha256: 'x'.repeat(64) }, 'yuk_wrk_sha256'],
    [k6, { yuk_wrk_sha256: '' }, 'yuk_wrk_sha256'],
  ]) assert.ok(den({ ...ev, ...ek }).includes(anahtar), `${JSON.stringify(ek)} -> ${anahtar} beklendi: ${JSON.stringify(den({ ...ev, ...ek }))}`);
  // Kok DEV iken dizin de DEV kokunde olmali (startsWith yuk_cikti_kok + '/araclar/').
  const dev = { ...k6, yuk_cikti_kok: '/sw/BMW_PORTAL_DEV/nginx_loadtest' };
  assert.deepEqual(den(dev), ['yuk_arac_dizin']);
  assert.deepEqual(den({ ...dev, yuk_arac_dizin: '/sw/BMW_PORTAL_DEV/nginx_loadtest/araclar/5' }), []);
  // Durdur: arac null -> uc alan ''; degerler denetlenmez, anahtarlar zorunlu.
  const eskiP = { hizlar: [100], tekrar: 1, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'ka', ae: 'gzip', sni: false, butceSn: 380 };
  const dk = evKur({ islem: 'durdur', p: eskiP });
  assert.deepEqual([dk.yuk_arac_dizin, dk.yuk_k6_sha256, dk.yuk_wrk_sha256, dk.yuk_k6_yolu, dk.yuk_wrk_yolu], ['', '', '', dg.ESKI_K6_ISARETI, dg.ESKI_WRK_ISARETI]);
  assert.deepEqual(den(dk), []);
  assert.deepEqual(den({ ...dk, yuk_arac_dizin: '/x', yuk_k6_sha256: 'Z', yuk_k6_yolu: '/home/www/bin/k6' }), [], 'durdurda arac degerleri denetlendi');
  for (const k of ['yuk_arac_dizin', 'yuk_k6_sha256', 'yuk_wrk_sha256']) {
    const eksik = { ...dk };
    delete eksik[k];
    assert.deepEqual(den(eksik), [k], `durdurda ${k} eksigi yakalanmadi`);
  }
});

test('YD41 onKontrolDegerlendir tur 4: aracli false birebir eski; aracli true dort engel; wrk yeni metin', () => {
  const ARAC_OK = { arac_dogrulandi: true, arac_sha256: 'cd'.repeat(32), arac_glibc: '2.28', arac_hata: null };
  // aracli false (eski satir): arac alanlari olsa da olmasa da cikti secenegsiz cagriyla AYNI.
  for (const [ad, ek] of YD21_SABIT) {
    for (const arac of [{}, ARAC_OK, { arac_dogrulandi: false, arac_hata: 'sha256 farkli' }]) {
      const ok = { ...YD21_TEMIZ, ...ek, ...arac };
      assert.deepEqual(dg.onKontrolDegerlendir(ok, { aracli: false, aracSha256: 'ab'.repeat(32) }), dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...ek }), `${ad} ${JSON.stringify(arac)}`);
    }
  }
  const sha = 'cd'.repeat(32);
  const e = (arac, s = { aracli: true, aracSha256: sha }) => dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...arac }, s).engeller;
  assert.deepEqual(e(ARAC_OK), []);
  assert.deepEqual(e({ ...ARAC_OK, arac_dogrulandi: false, arac_hata: 'sha256 farkli (beklenen cdcdcdcdcdcd..., bulunan 000000000000...)' }),
    ['yük aracı kopyası doğrulanamadı: sha256 farkli (beklenen cdcdcdcdcdcd..., bulunan 000000000000...)']);
  for (const v of [null, undefined, 'true', 1]) {
    assert.deepEqual(e({ ...ARAC_OK, arac_dogrulandi: v, arac_hata: null }),
      ['yük aracı kopyası doğrulanamadı: ölçülemedi (playbook araç kopyalamayı desteklemiyor olabilir; Ansible deposunu güncelleyin)'], String(v));
  }
  // Eski playbook (arac_* hic yok): olculemedi engeli.
  assert.deepEqual(e({}), ['yük aracı kopyası doğrulanamadı: ölçülemedi (playbook araç kopyalamayı desteklemiyor olabilir; Ansible deposunu güncelleyin)']);
  assert.deepEqual(e({ ...ARAC_OK, arac_sha256: 'ab'.repeat(32) }), ["yük aracı kopyasının sha256'sı araç setiyle aynı değil"]);
  assert.deepEqual(e({ ...ARAC_OK, arac_sha256: 'ab'.repeat(32) }, { aracli: true }), [], 'aracSha256 verilmeden sha karsilastirildi');
  assert.deepEqual(e({ ...ARAC_OK, arac_hata: 'glibc uyumsuz: makinede glibc 2.28, arac GLIBC_2.34 istiyor' }),
    ['yük aracı çalıştırılamadı: glibc uyumsuz: makinede glibc 2.28, arac GLIBC_2.34 istiyor']);
  // Arac engeli yollar maddesinden ONCE, motor ve log dizini engellerinden SONRA.
  assert.deepEqual(e({ k6_var: false, log_dizini_okunur: false, yollar_toplam: 0, arac_dogrulandi: false, arac_hata: 'kopya yok ya da duzenli dosya degil' }), [
    'k6 yük makinesinde bulunamadı', 'log dizini /web_log okunamıyor', 'yük aracı kopyası doğrulanamadı: kopya yok ya da duzenli dosya degil', 'ön kontrolde hiçbir yol denenmedi',
  ]);
  // Serbest ve wrk kiplerinde de arac engeli.
  const serbest = { ip_yuk_makinesinde: false, k6_var: true, yollar_toplam: 2, yollar_200: 2 };
  assert.deepEqual(dg.onKontrolDegerlendir(serbest, { hedefTuru: 'serbest', aracli: true }).engeller.length, 1);
  assert.deepEqual(dg.onKontrolDegerlendir({ ...serbest, ...ARAC_OK }, { hedefTuru: 'serbest', aracli: true, aracSha256: sha }).engeller, []);
  const w = { ...YD21_TEMIZ, k6_var: null, wrk_var: false, wrk_calisiyor: true, wrk_surum: 'wrk 3.1.2', ...ARAC_OK };
  assert.deepEqual(dg.onKontrolDegerlendir(w, { motor: 'wrk', aracli: true, aracSha256: sha }).engeller,
    ['wrk yük makinesinde çalışıyor ama sürümü okunamadı ya da 4 altında (wrk 3.1.2); araç setini yeniden hazırlayın (Yük Testi › Araçlar)']);
});

// -- HTTP/2 secimi (h2_sozlesme.md 4.1) --
const H2_WRK_MESAJI = 'HTTP/2 yalnız k6 ile seçilebilir; wrk yalnız HTTP/1.1 konuşur.';
const H2_KIP_MESAJI = 'HTTP/2 yalnız keep-alive (ka) bağlantı kipiyle koşulur; HTTP/2’de her isteğe yeni bağlantı tarayıcı davranışı değildir.';

test('DG-H1 parametreler protokol: varsayilan h1, h2 + ka kabul, gecersiz / wrk + h2 / h2 + yeni 400, butce ayni', () => {
  assert.deepEqual(dg.PROTOKOLLER, ['h1', 'h2']);
  assert.ok(Object.isFrozen(dg.PROTOKOLLER));
  assert.equal(dg.VARSAYILAN.protokol, 'h1');
  // Alan yok -> h1 (k6 ve wrk); kanonik nesnede sni'den sonra, butceSn'den once.
  const k6 = dg.parametreler({}, { sni: false }).deger;
  const wrk = dg.parametreler({ motor: 'wrk' }, { sni: false }).deger;
  assert.deepEqual([k6.protokol, wrk.protokol], ['h1', 'h1']);
  assert.deepEqual(Object.keys(k6).slice(-4), ['sni', 'protokol', 'sunucuAyar', 'butceSn']);
  assert.deepEqual(Object.keys(wrk).slice(-4), ['sni', 'protokol', 'sunucuAyar', 'butceSn']);
  assert.deepEqual(dg.parametreler({ protokol: 'h1' }, { sni: false }).deger, k6, 'acik h1 = varsayilan');
  assert.deepEqual(dg.parametreler({ motor: 'wrk', protokol: 'h1' }, { sni: false }).deger, wrk);
  // h2 + ka kabul; butce formulu protokolden bagimsiz.
  const h2 = dg.parametreler({ protokol: 'h2', kip: 'ka' }, { sni: true });
  assert.equal(h2.ok, true, JSON.stringify(h2));
  assert.equal(h2.deger.protokol, 'h2');
  const h1ka = dg.parametreler({ kip: 'ka' }, { sni: true }).deger;
  assert.equal(h2.deger.butceSn, h1ka.butceSn);
  assert.deepEqual({ ...h2.deger, protokol: 'h1' }, h1ka, 'protokol disinda kanonik nesne ayni');
  // Gecersiz deger: 400 ve AYNI metin (sessiz varsayim yok).
  for (const v of ['h3', 'H2', 'http2', '', null, 2, ['h2'], {}]) {
    assert.deepEqual(dg.parametreler({ protokol: v, kip: 'ka' }, { sni: false }), dg.red(400, 'gecersiz_istek', "protokol 'h1' ya da 'h2' olmalı."), JSON.stringify(v));
  }
  // wrk + h2: 400 (kip ka olsa da); h2 + yeni (acik ya da varsayilan kip): 400.
  assert.deepEqual(dg.parametreler({ motor: 'wrk', protokol: 'h2', kip: 'ka' }, { sni: false }), dg.red(400, 'gecersiz_istek', H2_WRK_MESAJI));
  assert.deepEqual(dg.parametreler({ protokol: 'h2', kip: 'yeni' }, { sni: false }), dg.red(400, 'gecersiz_istek', H2_KIP_MESAJI));
  assert.deepEqual(dg.parametreler({ protokol: 'h2' }, { sni: false }), dg.red(400, 'gecersiz_istek', H2_KIP_MESAJI), 'varsayilan kip yeni');
  // Denetim sirasi: kip / ae denetiminden SONRA, sni denetiminden ONCE.
  assert.match(dg.parametreler({ protokol: 'h3', kip: 'x' }, { sni: false }).message, /^kip /);
  assert.match(dg.parametreler({ protokol: 'h3', ae: 'x' }, { sni: false }).message, /^ae /);
  assert.match(dg.parametreler({ protokol: 'h3', kip: 'ka' }, { sni: 'evet' }).message, /^protokol /);
  assert.equal(dg.parametreler({ motor: 'wrk', protokol: 'h2', kip: 'ka' }, { sni: true }).message, H2_WRK_MESAJI, 'wrk + SNI metninden once');
});

test('DG-H2 extra_vars yuk_protokol: 34. anahtar, her zaman metin; son kapi ihlalleri; durdurda h1', () => {
  const den = (ev) => dg.ekstraDegiskenleriDenetle(ev, { simdiSn: SIMDI });
  assert.equal(dg.EKSTRA_ANAHTARLAR.length, 38);
  assert.equal(dg.EKSTRA_ANAHTARLAR[33], 'yuk_protokol');
  const h1 = evKur();
  assert.equal(h1.yuk_protokol, 'h1');
  assert.deepEqual(den(h1), []);
  const pH2 = dg.parametreler({ protokol: 'h2', kip: 'ka' }, { sni: false }).deger;
  const h2 = evKur({ p: pH2 });
  assert.deepEqual([h2.yuk_protokol, h2.yuk_kip, h2.yuk_motor], ['h2', 'ka', 'k6']);
  assert.deepEqual(den(h2), []);
  // Eski (protokolsuz) kanonik nesne -> h1; wrk nesnesi -> h1.
  const { protokol: _, ...eski } = dg.parametreler({}, { sni: false }).deger;
  assert.equal(evKur({ p: eski }).yuk_protokol, 'h1');
  assert.equal(evKur({ p: dg.parametreler({ motor: 'wrk' }, { sni: false }).deger }).yuk_protokol, 'h1');
  // Son kapi: anahtar yok, gecersiz deger, wrk + h2, h2 + yeni -> ihlal 'yuk_protokol'.
  const { yuk_protokol: __, ...eksik } = h1;
  assert.deepEqual(den(eksik), ['yuk_protokol']);
  for (const v of ['h3', 'H2', '', 'h1 ', null, 2]) assert.deepEqual(den({ ...h1, yuk_protokol: v }), ['yuk_protokol'], JSON.stringify(v));
  const w = evKur({ p: dg.parametreler({ motor: 'wrk', kip: 'ka' }, { sni: false }).deger });
  assert.deepEqual(den(w), []);
  assert.deepEqual(den({ ...w, yuk_protokol: 'h2' }), ['yuk_protokol']);
  assert.deepEqual(den({ ...h2, yuk_kip: 'yeni' }), ['yuk_protokol']);
  assert.deepEqual(den({ ...h1, yuk_kip: 'yeni' }), [], 'h1 + yeni gecerli');
  // Durdur: eski / h2 satirdan kurulur; deger denetlenmez (yuku durdurmanin yolu kapanmaz), anahtar yine zorunlu.
  const d = evKur({ islem: 'durdur', p: eski });
  assert.equal(d.yuk_protokol, 'h1');
  assert.deepEqual(den(d), []);
  assert.deepEqual(den({ ...d, yuk_protokol: 'h3' }), []);
  const { yuk_protokol: ___, ...dEksik } = d;
  assert.deepEqual(den(dEksik), ['yuk_protokol']);
});

test('DG-H3 onKontrolDegerlendir protokol: h1 cikti birebir; h2 TEK engel (h2 icin yapilmadi > curl > ALPN > olculemedi)', () => {
  const H2_TAM = { protokol: 'h2', curl_h2: true, alpn_h2: true, yollar_yanitli: 10, yollar_h2: 10 };
  // h1: YD21 sabit fiksturunun her durumu, h2 alanlari ne olursa olsun, BIREBIR (acik h1 = varsayilan).
  for (const [ad, ek, b] of YD21_SABIT) {
    const beklenen = { engeller: b.engeller, uyarilar: b.uyarilar.map((u) => (u === H ? dg.HOST_LISTEDE_YOK_UYARISI : u)) };
    for (const h2Alan of [{}, { protokol: 'h1' }, { curl_h2: false, alpn_h2: false }, { protokol: 'h2', alpn_h2: null }]) {
      assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...ek, ...h2Alan }, { protokol: 'h1' }), beklenen, `${ad} ${JSON.stringify(h2Alan)}`);
    }
  }
  const e = (ek, sec = {}) => dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...H2_TAM, ...ek }, { protokol: 'h2', ...sec });
  // h2 + alpn true: ek engel / uyari yok (h1 ile ayni cikti).
  assert.deepEqual(e({}), dg.onKontrolDegerlendir({ ...YD21_TEMIZ }));
  assert.deepEqual(e({ protokol: undefined }), { engeller: [], uyarilar: [] }, 'protokol yankisi yok ama alpn true');
  const ALPN = (n2, ny) => `Hedef bu Host için HTTP/2 sunmuyor (ALPN): ${n2}/${ny} yol HTTP/2 ile yanıt verdi. nginx’te bu server bloğunda http2 açık değil ya da SNI kapalıyken IP:443’ün varsayılan sunucusu HTTP/2 sunmuyor; HTTP/1.1 ile koşun ya da SNI’yi açın.`;
  const OLCULEMEDI = 'HTTP/2 desteği ölçülemedi (playbook HTTP/2 ön kontrolünü desteklemiyor olabilir; Ansible deposunu güncelleyin)';
  const CURL = 'yük makinesindeki curl HTTP/2 desteklemiyor; HTTP/2 ön kontrolü yapılamadı';
  const YAPILMADI = 'ön kontrol HTTP/2 için yapılmadı; ön kontrolü yeniden çalıştırın';
  assert.deepEqual(e({ alpn_h2: false, yollar_h2: 3, yollar_yanitli: 10 }).engeller, [ALPN(3, 10)]);
  assert.deepEqual(e({ alpn_h2: false, yollar_h2: '0', yollar_yanitli: '4' }).engeller, [ALPN(0, 4)]);
  assert.deepEqual(e({ alpn_h2: false, yollar_h2: null, yollar_yanitli: undefined }).engeller, [ALPN('?', '?')]);
  // Olculemedi (fail-closed): alan yok (eski playbook), null, metin 'true' (yalniz gercek true gecer).
  const { alpn_h2: _a, curl_h2: _c, protokol: _p, yollar_h2: _y, yollar_yanitli: _z, ...eskiPlaybook } = H2_TAM;
  assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...eskiPlaybook }, { protokol: 'h2' }).engeller, [OLCULEMEDI]);
  for (const v of [null, undefined, 'true', 1, '1']) assert.deepEqual(e({ alpn_h2: v }).engeller, [OLCULEMEDI], JSON.stringify(v));
  // curl h2'siz: curl metni (alpn ne olursa olsun); on kontrol h1 icin yapilmis: yapilmadi metni (curl / alpn'den once).
  assert.deepEqual(e({ curl_h2: false, alpn_h2: null }).engeller, [CURL]);
  assert.deepEqual(e({ curl_h2: false, alpn_h2: false }).engeller, [CURL]);
  assert.deepEqual(e({ protokol: 'h1', curl_h2: false, alpn_h2: false }).engeller, [YAPILMADI]);
  assert.deepEqual(e({ protokol: 'h1', alpn_h2: true }).engeller, [YAPILMADI], 'h1 on kontrol h2 kosusuna gecmez');
  // AWX 3477866: curl h2'siz yuk makinesi, ALPN openssl ile olculdu (alpn_kaynak 'openssl'): curl engeli yok.
  const OPENSSL = 'Hedef bu Host için HTTP/2 sunmuyor (ALPN, openssl ile ölçüldü; yük makinesindeki curl HTTP/2 desteklemediği için yollar HTTP/1.1 ile denendi). nginx’te bu server bloğunda http2 açık değil ya da SNI kapalıyken IP:443’ün varsayılan sunucusu HTTP/2 sunmuyor; HTTP/1.1 ile koşun ya da SNI’yi açın.';
  const OSSL = { curl_h2: false, alpn_kaynak: 'openssl', yollar_h2: '-', yollar_yanitli: 10 };
  assert.deepEqual(e({ ...OSSL, alpn_h2: true }), dg.onKontrolDegerlendir({ ...YD21_TEMIZ }), 'openssl + alpn true: engel yok');
  assert.deepEqual(e({ ...OSSL, alpn_h2: false }).engeller, [OPENSSL]);
  assert.deepEqual(e({ ...OSSL, alpn_h2: false, curl_h2: true }).engeller, [OPENSSL], 'openssl kaynagi metni curl_h2 ne olursa olsun');
  for (const v of [null, undefined, '-', 'true']) assert.deepEqual(e({ ...OSSL, alpn_h2: v }).engeller, [OLCULEMEDI], `openssl ${JSON.stringify(v)}`);
  // Fail-closed: kaynak yok / 'curl' / gecersiz -> bugunku curl engeli (alpn ne olursa olsun).
  for (const k of [undefined, null, 'curl', 'OpenSSL', 'openssl ', 1, true]) {
    for (const a of [true, false, null]) assert.deepEqual(e({ ...OSSL, alpn_kaynak: k, alpn_h2: a }).engeller, [CURL], `kaynak ${JSON.stringify(k)} alpn ${a}`);
  }
  assert.deepEqual(e({ curl_h2: true, alpn_kaynak: 'curl', alpn_h2: false, yollar_h2: 3, yollar_yanitli: 10 }).engeller, [ALPN(3, 10)], 'curl kaynagi bugunku sayili metin');
  assert.deepEqual(e({ ...OSSL, protokol: 'h1', alpn_h2: true }).engeller, [YAPILMADI], 'openssl de yapilmadi kuralini gecmez');
  assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...OSSL, alpn_h2: false }, { protokol: 'h1' }), dg.onKontrolDegerlendir({ ...YD21_TEMIZ }), 'h1 kosusu alpn_kaynak okumaz');
  // TEK engel ve yeri: motor engelinden HEMEN sonra, /web_log engelinden once; uyarilar degismez.
  assert.deepEqual(e({ ip_yerel: false, k6_var: false, alpn_h2: false, yollar_h2: 0, yollar_yanitli: 2, log_dizini_okunur: false, master_sayisi: 2 }).engeller, [
    'seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)', 'k6 yük makinesinde bulunamadı', ALPN(0, 2), 'log dizini /web_log okunamıyor',
    'nginx master süreç sayısı 2 (1 bekleniyor; CPU kaydedici bu durumda başlamaz)',
  ]);
  assert.deepEqual(e({ alpn_h2: false, yollar_h2: 0, yollar_yanitli: 2, web_log_df: 70 }).uyarilar, ['/web_log %70 dolu (>= %65: disk temizleyici koşu sırasında logları silebilir)']);
  // Serbest hedefte de ayni kural.
  assert.deepEqual(dg.onKontrolDegerlendir({ ip_yuk_makinesinde: false, k6_var: true, yollar_toplam: 2, yollar_200: 2, ...H2_TAM, alpn_h2: false, yollar_h2: 1, yollar_yanitli: 2 },
    { hedefTuru: 'serbest', protokol: 'h2' }).engeller, [ALPN(1, 2)]);
  // Gecersiz protokol secenegi: okunamadi (sessiz h1 yok).
  for (const p of ['h3', null, 'H2']) {
    assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ }, { protokol: p }), { engeller: ['ön kontrol sonucu okunamadı (protokol tanınmadı)'], uyarilar: [] }, String(p));
  }
});

// ── 2026-11-03: 5000/sn, limit uyarisi, yuk makinesi olcumu (K1-K3) ──────────────────────────

test('YD30 limitUyarilari: olcum yoksa bos; esitlik asim degil; k6 hiz / VU, wrk yalniz baglanti (B5: tavan uyarisi yok); deterministik Y', () => {
  const k6 = dg.parametreler({ hizlar: [100, 600], maxvu: 300 }, { sni: false }).deger;
  assert.deepEqual(dg.limitUyarilari(k6, {}), []);
  assert.deepEqual(dg.limitUyarilari(k6, { limitReq: null, limitConn: null }), []);
  assert.deepEqual(dg.limitUyarilari(k6, { limitReq: 600, limitConn: 300 }), [], 'esitlik asim degil');
  assert.deepEqual(dg.limitUyarilari(k6, { limitReq: 500, limitConn: 200 }), [
    'Seçilen hız (600/sn) hedefin ölçülmüş limit_req değerini (500 r/s) aşıyor; 429 alınırsa koşu durur.',
    'Seçilen en çok VU (300) hedefin ölçülmüş limit_conn değerini (200) aşıyor; bu kadar bağlantı aynı anda açılırsa fazlası reddedilir (429 ya da 503) ve koşu durur ya da adım geçersiz sayılır.',
  ]);
  // Kesirli r/m: 30r/m = 0,5 r/s (tek ondalik, virgul); 100r/m = 1,7.
  assert.deepEqual(dg.limitUyarilari(k6, { limitReq: 0.5 }), ['Seçilen hız (600/sn) hedefin ölçülmüş limit_req değerini (0,5 r/s) aşıyor; 429 alınırsa koşu durur.']);
  assert.equal(dg.limitMetni(100 / 60), '1,7');
  assert.equal(dg.limitMetni(500), '500');
  const w = dg.parametreler({ motor: 'wrk', baglantilar: [2, 4, 150] }, { sni: false }).deger;
  assert.equal(w.tavan_rps, 5000);
  // B5: wrk tavani (hep 5000) hiz degil ust sinir: limit_req uyarisi URETILMEZ (ne kadar kucuk olursa olsun).
  assert.deepEqual(dg.limitUyarilari(w, { limitReq: 500, limitConn: 100 }), [
    'Seçilen en çok bağlantı (150) hedefin ölçülmüş limit_conn değerini (100) aşıyor; fazla bağlantılar reddedilir (429 ya da 503) ve koşu durur.',
  ]);
  assert.deepEqual(dg.limitUyarilari(w, { limitReq: 0.5 }), []);
  assert.deepEqual(dg.limitUyarilari(w, { limitReq: 5000, limitConn: 150 }), []);
  // rateLimitTavani'nin ham degerleri dogrudan verilebilir (kosuPlani hedefAyrintisi'ni verir).
  const t = dg.rateLimitTavani([
    { directive: 'limit_req_zone', value: '$binary_remote_addr zone=r:1m rate=500r/s' },
    { directive: 'limit_conn_zone', value: '$binary_remote_addr zone=c:1m' },
    { directive: 'limit_conn', value: 'c 200' },
  ]);
  assert.equal(dg.limitUyarilari(k6, t).length, 2);
  assert.deepEqual(dg.limitUyarilari(null, t), []);
});

test('YD31 onKontrolDegerlendir + parametreler: yuk makinesi port / bellek uyarisi; alan yoksa ya da parametresiz BIREBIR', () => {
  const p = dg.parametreler({ hizlar: [1000, 5000], maxvu: 1000 }, { sni: false }).deger;
  const temel = dg.onKontrolDegerlendir(YD21_TEMIZ, { hedefTuru: 'sunucu', motor: 'k6' });
  // Eski playbook (alan yok): parametre verilse de cikti ayni.
  assert.deepEqual(dg.onKontrolDegerlendir(YD21_TEMIZ, { hedefTuru: 'sunucu', motor: 'k6', parametreler: p }), temel);
  const olcum = { ...YD21_TEMIZ, yukm_port_sayisi: 28232, yukm_tw_reuse: 2, yukm_tcp_ts: 1, yukm_nproc: 8, yukm_mem_kb: 4 * 1024 * 1024 };
  // Parametresiz: yeni alanlar okunmaz.
  assert.deepEqual(dg.onKontrolDegerlendir(olcum, { hedefTuru: 'sunucu', motor: 'k6' }), temel);
  const r = dg.onKontrolDegerlendir(olcum, { hedefTuru: 'sunucu', motor: 'k6', parametreler: p });
  assert.deepEqual(r.engeller, temel.engeller);
  assert.deepEqual(r.uyarilar, [...temel.uyarilar,
    'Yük makinesinin yerel port aralığı 28232 port (tcp_tw_reuse 2, tcp_timestamps 1): "yeni" kipte istemci bağlantıyı önce kapatırsa saniyede yaklaşık 470 yeni bağlantıya yeter; seçilen hız (5000/sn) bunu aşıyor. Bağlantıyı hangi tarafın önce kapattığı (TIME_WAIT\'in nerede biriktiği) doğrulanmadı; bağlantı hatası görürseniz hızı düşürün ya da "ka" kipini seçin.',
    'Yük makinesinde boş bellek 4096 MB; en çok 1000 VU için önerilen en az 8000 MB. k6 bellek yetmezliğinden düşebilir; en çok VU\'yu azaltın.',
  ]);
  // ka kipinde port uyarisi yok; dusuk hizda yok; bellek yeterliyse yok.
  const ka = dg.parametreler({ hizlar: [5000], maxvu: 100, kip: 'ka' }, { sni: false }).deger;
  assert.deepEqual(dg.onKontrolDegerlendir(olcum, { motor: 'k6', parametreler: ka }), temel);
  const dusuk = dg.parametreler({ hizlar: [400], maxvu: 100 }, { sni: false }).deger;
  assert.deepEqual(dg.onKontrolDegerlendir(olcum, { motor: 'k6', parametreler: dusuk }), temel);
  // Olculemeyen ('-' / null) alan uyari uretmez.
  assert.deepEqual(dg.onKontrolDegerlendir({ ...olcum, yukm_port_sayisi: null, yukm_mem_kb: '-' }, { motor: 'k6', parametreler: p }), temel);
  // B5: wrk'de port uyarisi YOK (tavan 5000 gercek hiz degil), bellek uyarisi yok: cikti parametresizle BIREBIR.
  const w = dg.parametreler({ motor: 'wrk' }, { sni: false }).deger;
  const wr = dg.onKontrolDegerlendir({ ...olcum, wrk_var: true, yukm_port_sayisi: 100 }, { motor: 'wrk', parametreler: w });
  assert.deepEqual(wr, dg.onKontrolDegerlendir({ ...olcum, wrk_var: true, yukm_port_sayisi: 100 }, { motor: 'wrk' }));
  assert.equal(wr.uyarilar[wr.uyarilar.length - 1], dg.WRK_UYARISI);
  assert.ok(!wr.uyarilar.some((u) => /port aralığı/.test(u)), wr.uyarilar.join(' | '));
  assert.deepEqual(dg.yukMakinesiUyarilari({ yukm_port_sayisi: 100, yukm_mem_kb: 1 }, { ...w, motor: 'wrk' }), []);
});

test('YD32 son kapi ve parametreler: 4 haneli hiz 5000 / maxvu 1000 / wrk tavan 5000 kabul; 5001 / 1001 / 10000 red', () => {
  assert.equal(dg.parametreler({ hizlar: [5000] }, { sni: false }).ok, true);
  assert.equal(dg.parametreler({ hizlar: [10000] }, { sni: false }).code, 'sinir_asildi');
  assert.equal(dg.parametreler({ maxvu: 1000 }, { sni: false }).ok, true);
  // Serbest tavanlari DEGISMEZ (K1).
  assert.equal(dg.parametreler({ hizlar: [201] }, { sni: false, hedefTuru: 'serbest' }).code, 'sinir_asildi');
  assert.equal(dg.parametreler({ maxvu: 51 }, { sni: false, hedefTuru: 'serbest' }).code, 'sinir_asildi');
  assert.equal(dg.parametreler({ motor: 'wrk', baglantilar: [2, 200] }, { sni: false }).code, 'sinir_asildi', 'wrk baglanti 199 kalir');
});

// -- TEK HEDEF MODELI (2026-11-13): nginx'siz hedef, Inventory IP'leri, /hedefler aday okumasi --

test('YD-T1 onKontrolDegerlendir hedef_nginx: false -> nginx kurallari yok + uyari; null -> engel; alan yok -> BIREBIR eskisi', () => {
  // Alan yok (eski playbook): YD21 sabit fiksturu birebir (yalniz nginx hedefe kosabilirdi).
  for (const [ad, ek, b] of YD21_SABIT) {
    const beklenen = { engeller: b.engeller, uyarilar: b.uyarilar.map((u) => (u === H ? dg.HOST_LISTEDE_YOK_UYARISI : u)) };
    assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...ek }), beklenen, ad);
    // hedef_nginx true da ayni (nginx hedefi).
    assert.deepEqual(dg.onKontrolDegerlendir({ ...YD21_TEMIZ, ...ek, hedef_nginx: true }), beklenen, `${ad} (true)`);
  }
  // Nginx'siz hedef: nginx -T / log olcumleri yok (playbook '-' / null basar); yalniz NGINX_YOK_UYARISI.
  const nginxsiz = {
    ...YD21_TEMIZ, hedef_nginx: false, hedef_nproc: 8, server_name_var: null, master_sayisi: 0, web_log_df: null, log_dizini_okunur: false, log_format_ua: null,
  };
  assert.deepEqual(dg.onKontrolDegerlendir(nginxsiz), { engeller: [], uyarilar: [dg.NGINX_YOK_UYARISI] });
  assert.equal(dg.NGINX_YOK_UYARISI, 'Nginx bulunamadı: ayrıntılı metrikler ve sunucu ayarları kapalı; CPU ve istemci metrikleri ölçülür.');
  // ip_yerel, yuk araci ve yollar kurallari aynen gecerli; wrk sabit uyarisi NGINX_YOK_UYARISI'ndan sonra.
  assert.deepEqual(dg.onKontrolDegerlendir({ ...nginxsiz, ip_yerel: false, yollar_toplam: 0 }).engeller,
    ['seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)', 'ön kontrolde hiçbir yol denenmedi']);
  const wrk = dg.onKontrolDegerlendir({ ...nginxsiz, k6_var: null, wrk_var: true }, { motor: 'wrk' });
  assert.deepEqual(wrk, { engeller: [], uyarilar: [dg.NGINX_YOK_UYARISI, dg.WRK_UYARISI] });
  // Sunucu ayarli kosu nginx'siz hedefte ENGEL (srv_hazirlik engeli yerine tek metin).
  const srv = { sunucuAyar: { seviye: 6, static: false, dizin: '/usr/nginx/applications/a' }, ae: 'br' };
  assert.deepEqual(dg.onKontrolDegerlendir({ ...nginxsiz, srv_hazirlik: 'fail' }, { parametreler: srv }).engeller, [dg.NGINX_YOK_AYAR_ENGELI]);
  assert.equal(dg.NGINX_YOK_AYAR_ENGELI, 'hedefte nginx yok: sunucu ayarı uygulanamaz');
  // Belirsiz (playbook '-' -> null ya da taninmayan deger): ip_yerel'den hemen sonra ENGEL; nginx kurallari yine uygulanir.
  for (const v of [null, '-', 'evet', 1]) {
    const r = dg.onKontrolDegerlendir({ ...YD21_TEMIZ, hedef_nginx: v, ip_yerel: false });
    assert.deepEqual(r.engeller.slice(0, 2), ['seçilen IP hedef sunucuda yerel değil (ya da ölçülemedi)', dg.NGINX_BELIRSIZ_ENGELI], String(v));
  }
  // Serbest hedefte alan yok sayilir.
  const serbest = { ip_yuk_makinesinde: false, k6_var: true, yollar_toplam: 2, yollar_200: 2, sikistirma: { statik: 0 } };
  for (const v of [false, null, true]) {
    assert.deepEqual(dg.onKontrolDegerlendir({ ...serbest, hedef_nginx: v }, { hedefTuru: 'serbest' }), { engeller: [], uyarilar: [dg.SERBEST_UYARISI] }, String(v));
  }
});

test('YD-T2 hedefAyrintisi Inventory IPlerini de aday sayar; kaynaklariOku invIp; nginx olmayan makine sunucu hedefi', async () => {
  const t = tbmwans({ inventory: [...tbmwans().d.inventory, { host: 'GBJWLT01', env: 'Test', ip: '10.151.166.144' }, { host: 'GBJWLT01', env: 'Test', ip: '10.151.166.145, 300.1.1.1' }] });
  const k = await dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: ['GBJWLT01', 'GBNGXT14'], ip: '10.151.166.144' });
  assert.deepEqual(k.invIp.get('GBJWLT01'), ['10.151.166.144', '10.151.166.145']);
  assert.deepEqual(k.invTum.get('GBJWLT01'), ['Test', 'Test']);
  const ay = dg.hedefAyrintisi(k, 'GBJWLT01');
  assert.deepEqual([ay.ipler, ay.vhostlar, ay.hizSiniri], [['10.151.166.144', '10.151.166.145'], null, null]);
  // Nginx host: tarama listen + nginx_inventory + Inventory IP birlesimi (sirali, tekil).
  assert.deepEqual(dg.hedefAyrintisi(k, 'GBNGXT33').ipler, dg.hedefAyrintisi({ ...k, invIp: new Map() }, 'GBNGXT33').ipler);
  const r = dg.ipSinifla('10.151.166.144', k, { aglar: [], yasak: { liste: [], hatali: [] }, yukHost: 'GBNGXT14' });
  assert.deepEqual(r, { ok: true, tur: 'sunucu', host: 'GBJWLT01' });
  assert.deepEqual(dg.hedefKapisi('GBJWLT01', k), { ok: true, env: 'TEST' });
});

test('YD-T3 hedefAdaylariOku: urun kolonlari sys.columns ile, ipucu, k birlestirme, host listesi, 424', async () => {
  const sorgular = [];
  const satirlar = [
    { host: 'GBJWLT01', env: 'Test', ip: '10.151.166.144', nginx_version: '1.24.0', rha_version: null },
    { host: 'gbjwlt01', env: 'Test', ip: '10.151.166.145', nginx_version: '', rha_version: '2.4' },
    { host: 'GBNGXT33', env: 'Test', ip: '10.0.0.5', nginx_version: null, rha_version: null },
    { host: 'bad host', env: 'Test', ip: '10.0.0.1', nginx_version: null, rha_version: null },
  ];
  const q = (kolonlar) => async (sql, params = []) => {
    const t = String(sql).replace(/\s+/g, ' ').trim();
    sorgular.push({ t, params });
    if (t === "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Inventory')") return { recordset: kolonlar.map((name) => ({ name })) };
    if (/^SELECT host, env, ip(, \w+)* FROM dbo\.Inventory WHERE host IS NOT NULL$/.test(t)) {
      const sec = t.slice('SELECT '.length, t.indexOf(' FROM')).split(', ');
      return { recordset: satirlar.map((r) => Object.fromEntries(sec.map((c) => [c, r[c]]))) };
    }
    if (t.endsWith(` FROM dbo.Inventory WHERE ${INV_KISA_AD} IN (@h0)`) && /^SELECT host, env, ip(, \w+)* FROM/.test(t)) {
      return { recordset: satirlar.filter((r) => String(r.host).split('.')[0].toUpperCase() === params[0].value) };
    }
    throw new Error(`beklenmeyen sorgu: ${t}`);
  };
  const k = { inv: new Map(), invTum: new Map([['GBNGXT33', ['Test']]]), invIp: new Map() };
  const a = await dg.hedefAdaylariOku({ query: q(['host', 'env', 'ip', 'NGINX_VERSION', 'rha_version', 'jboss_version']), k });
  assert.deepEqual([...a.keys()], ['GBJWLT01', 'GBNGXT33']);
  assert.deepEqual(a.get('GBJWLT01'), { nginxEnvanter: true, urunler: ['NGINX', 'RHA'] });
  assert.deepEqual(a.get('GBNGXT33'), { nginxEnvanter: false, urunler: [] });
  assert.match(sorgular[1].t, /^SELECT host, env, ip, nginx_version, rha_version FROM dbo\.Inventory WHERE host IS NOT NULL$/);
  // k: okunmamis host eklenir, onceden okunmus host (GBNGXT33) cift satir almaz.
  assert.deepEqual([k.invTum.get('GBJWLT01'), k.invIp.get('GBJWLT01'), k.invTum.get('GBNGXT33')], [['Test', 'Test'], ['10.151.166.144', '10.151.166.145'], ['Test']]);
  // nginx_version kolonu yok: ipucu null (kolon yok != envanterde yok).
  const b = await dg.hedefAdaylariOku({ query: q(['host', 'env', 'ip', 'rha_version']) });
  assert.deepEqual(b.get('GBJWLT01'), { nginxEnvanter: null, urunler: ['RHA'] });
  // Host listesi: IN parametreli.
  const c = await dg.hedefAdaylariOku({ query: q(['host', 'env', 'ip', 'nginx_version']), sql: { NVarChar: (n) => `nv${n}` }, hostlar: ['gbjwlt01'] });
  assert.deepEqual([...c.keys()], ['GBJWLT01']);
  assert.deepEqual(await dg.hedefAdaylariOku({ query: q([]), hostlar: ['bad host'] }), new Map());
  // Okunamazsa 424 (yok SAYILMAZ).
  await assert.rejects(dg.hedefAdaylariOku({ query: async () => { throw new Error('kapali'); } }), (e) => e.status === 424 && e.code === 'envanter_okunamadi');
  // FQDN ile kayitli satir kisa adla listelenir (atilmaz) ve k'ya kisa adla girer; host listesi FQDN satirini da okur.
  satirlar.push({ host: 'gbfqdt01.bmw.local', env: 'Test', ip: '10.151.166.170', nginx_version: '1.24.0', rha_version: null });
  const k2 = { inv: new Map(), invTum: new Map(), invIp: new Map() };
  const f = await dg.hedefAdaylariOku({ query: q(['host', 'env', 'ip', 'nginx_version']), k: k2 });
  assert.deepEqual([f.get('GBFQDT01'), k2.invTum.get('GBFQDT01'), k2.invIp.get('GBFQDT01')], [{ nginxEnvanter: true, urunler: ['NGINX'] }, ['Test'], ['10.151.166.170']]);
  const f2 = await dg.hedefAdaylariOku({ query: q(['host', 'env', 'ip']), sql: { NVarChar: (n) => `nv${n}` }, hostlar: ['GBFQDT01'] });
  assert.deepEqual([...f2.keys()], ['GBFQDT01']);
});

test('YD-T4 FQDN ile kayitli dbo.Inventory satiri: kisa ad Test + FQDN Production -> 409 (hedef, yuk makinesi, IP sahibi)', async () => {
  const taban = tbmwans().d.inventory;
  // Kisa ad satiri Test, ayni makinenin FQDN satiri Production: satirlarin HEPSI DEV/TEST/QA DEGIL.
  const karisik = [...taban, { host: 'GBX01', env: 'Test', ip: '10.151.166.150' }, { host: 'gbx01.bmw.local', env: 'Production', ip: '10.151.166.151' }];
  for (const cagri of [
    (t) => dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: ['GBX01', 'GBNGXT34'] }),
    (t) => dg.kaynaklariOku({ query: t.query, sql: t.sql, ekHostlar: ['GBX01'] }),
    (t) => dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: ['GBNGXT34'], ip: '10.151.166.150' }),
  ]) {
    const t = tbmwans({ inventory: karisik });
    const k = await cagri(t);
    assert.deepEqual(k.invTum.get('GBX01'), ['Test', 'Production']);
    const o = dg.hedefKapisi('GBX01', k);
    assert.deepEqual([o.ok, o.status, o.code], [false, 409, 'hedef_uretim']);
    assert.equal(dg.yukHostKapisi('GBX01', k, { izinli: ['GBX01'] }).code, 'yuk_host_izinsiz');
  }
  const t1 = tbmwans({ inventory: karisik });
  const k1 = await dg.kaynaklariOku({ query: t1.query, sql: t1.sql, hostlar: ['GBNGXT34'], ip: '10.151.166.150' });
  const r1 = dg.ipSinifla('10.151.166.150', k1, { yukHost: 'GBNGXT34' });
  assert.deepEqual([r1.ok, r1.code], [false, 'hedef_uretim']);
  // Ikinci varyant: yalniz FQDN satirlari; IP X satiri Test, IP Y satiri Production. IP X ile gelinse bile 409.
  const t2 = tbmwans({ inventory: [...taban, { host: 'gby01.bmw.local', env: 'Test', ip: '10.151.166.160' }, { host: 'GBY01.bmw.local', env: 'Production', ip: '10.151.166.161' }] });
  const k2 = await dg.kaynaklariOku({ query: t2.query, sql: t2.sql, hostlar: ['GBNGXT34'], ip: '10.151.166.160' });
  assert.deepEqual(k2.invTum.get('GBY01'), ['Test', 'Production']);
  const r2 = dg.ipSinifla('10.151.166.160', k2, { yukHost: 'GBNGXT34' });
  assert.deepEqual([r2.ok, r2.code], [false, 'hedef_uretim']);
  // Yalniz FQDN satiri olan, satirlarinin hepsi Test makine: kisa adla gecer (ortam kanitli).
  const t3 = tbmwans({ inventory: [...taban, { host: 'gbz01.bmw.local', env: 'Test', ip: '10.151.166.170' }] });
  const k3 = await dg.kaynaklariOku({ query: t3.query, sql: t3.sql, hostlar: ['GBZ01', 'GBNGXT34'] });
  assert.deepEqual(dg.hedefKapisi('GBZ01', k3), { ok: true, env: 'TEST' });
  assert.deepEqual(k3.invIp.get('GBZ01'), ['10.151.166.170']);
});

test('YD-T5 cok IP\'li dbo.Inventory hucresi: IP sahibi aramasi aday uretimiyle ayni ayristirma (paylasilan VIP)', async () => {
  const taban = tbmwans().d.inventory;
  // Uretim makinesi P'nin hucresi iki IP; test makinesi T'nin hucresi yalniz VIP. Sahip listesi P'yi de gormeli.
  const inv = [...taban, { host: 'GBAPPP77', env: 'Production', ip: '10.1.1.5, 10.151.166.200' }, { host: 'GBAPPT77', env: 'Test', ip: '10.151.166.200' }];
  const t = tbmwans({ inventory: inv });
  const k = await dg.kaynaklariOku({ query: t.query, sql: t.sql, hostlar: ['GBAPPT77', 'GBNGXT34'], ip: '10.151.166.200' });
  assert.deepEqual([...k.ipSahipleri.keys()].sort(), ['GBAPPP77', 'GBAPPT77']);
  const r = dg.ipSinifla('10.151.166.200', k, { hedefHost: 'GBAPPT77', yukHost: 'GBNGXT34' });
  assert.deepEqual([r.ok, r.code], [false, 'hedef_uretim']);
  assert.match(r.message, /GBAPPP77 sunucusuna ait/);
  // Ikinci etki: T'nin kendi cok IP'li hucresinden gelen aday IP icin T sahip sayilir (seciciden secilebilir).
  const t2 = tbmwans({ inventory: [...taban, { host: 'GBAPPT78', env: 'Test', ip: '10.151.166.210;10.151.166.211' }] });
  const k2 = await dg.kaynaklariOku({ query: t2.query, sql: t2.sql, hostlar: ['GBAPPT78', 'GBNGXT34'], ip: '10.151.166.211' });
  assert.deepEqual(dg.hedefAyrintisi(k2, 'GBAPPT78').ipler, ['10.151.166.210', '10.151.166.211']);
  assert.deepEqual(dg.ipSinifla('10.151.166.211', k2, { hedefHost: 'GBAPPT78', yukHost: 'GBNGXT34' }), { ok: true, tur: 'sunucu', host: 'GBAPPT78' });
  // Alt dize eslesmesi sahip YAPMAZ (10.151.166.21 != 10.151.166.211).
  const k3 = await dg.kaynaklariOku({ query: t2.query, sql: t2.sql, hostlar: ['GBNGXT34'], ip: '10.151.166.21' });
  assert.equal(k3.ipSahipleri.has('GBAPPT78'), false);
});

test('YD-T6 /hedefler yolu (hostlar yok): ad kalibi disi ama taranmis Inventory hedefinin tarama ve limit verisi okunur', async () => {
  const t = tbmwans({
    inventory: [...tbmwans().d.inventory, { host: 'GBJWLT01', env: 'Test', ip: '10.151.166.144' }, { host: 'GBAPPP79', env: 'Production', ip: '10.9.9.79' }],
    tarama: [...tbmwans().d.tarama,
      { host: 'GBJWLT01', listen: '10.151.166.146:443 ssl', server_name: 'jw.test.local' },
      { host: 'GBAPPP79', listen: '10.9.9.79:443 ssl', server_name: 'p79.prod.local' }],
    ayarlar: [{ host: 'GBJWLT01', directive: 'limit_req_zone', value: '$binary_remote_addr zone=r:1m rate=120r/s' }],
  });
  const k = await dg.kaynaklariOku({ query: t.query, sql: t.sql, ekHostlar: ['GBNGXT34'] });
  const ay = dg.hedefAyrintisi(k, 'GBJWLT01');
  assert.deepEqual([ay.ipler, ay.vhostlar, ay.limitReq], [['10.151.166.144', '10.151.166.146'], ['jw.test.local'], 120]);
  assert.deepEqual(dg.hedefKapisi('GBJWLT01', k), { ok: true, env: 'TEST' });
  // Uretim Inventory makinesi (taranmis) tarama / limit okumasina girmez.
  const okunan = t.sorgular.filter((x) => /Nginx_Audit_(Servers|Settings) WHERE .*host IN|AS h\(host\)/.test(x.q)).flatMap((x) => x.params.map((p) => p.value));
  assert.equal(okunan.includes('GBAPPP79'), false);
  assert.equal(okunan.includes('GBJWLT01'), true);
});
