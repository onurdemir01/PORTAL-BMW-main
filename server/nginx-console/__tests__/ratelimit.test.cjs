// server/nginx-console/__tests__/ratelimit.test.cjs — Nginx Hub › Rate Limit (v2).
//
// Kullanici duzeltmesi (2026-09-26): ilk surum APIGW envanterini gosteriyordu ve ~50.000
// satir yukleyip sayfayi OOM'a dusurdu. Bu surum TUM nginx sunucularinin
// /usr/nginx/conf/rate_limits.conf degerlerini nginx -T ciktisindan (dbo.Nginx_Audit_Settings)
// okur ve SUNUCU BASINA tek satir uretir.
//
// RL1 ayristirma: zone tanimi ve uygulama satirlari
// RL2 durum: standart / farkli / EKSIK (tanimli ama uygulanmiyor DA eksiktir)
// RL3 rapor: sunucu basina satir, Excel uyumlu CSV
// RL4 OOM korumasi: ekran satir listesi degil SUNUCU listesi gosterir, detay sinirli
// RL5 dogru kaynak: APIGW envanteri DEGIL, nginx -T tabanli audit tablosu
// RL6 OLCULMEDI != EKSIK: tarama direktifi hic toplamadiysa iddia yok
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rl = require('../ratelimit.cjs');

test('RL1: zone tanimi ve uygulama satirlari dogru ayristirilir', () => {
  assert.deepEqual(
    rl.parseReqZone('$binary_remote_addr zone=request_limit:20m rate=500r/s'),
    { name: 'request_limit', size: '20m', rate: '500r/s', variable: '$binary_remote_addr' },
  );
  // NGINX Plus kume senkronu: `sync` eki oranı bozmamali.
  assert.equal(rl.parseReqZone('$server_name zone=server_limit:50m rate=5000r/s sync').rate, '5000r/s');
  assert.deepEqual(rl.parseReqApply('zone=request_limit burst=200 nodelay'), { name: 'request_limit', burst: 200, nodelay: true });
  assert.equal(rl.parseReqApply('zone=request_limit').nodelay, false);
  assert.deepEqual(rl.parseConnApply('limit_connection_perip 200'), { name: 'limit_connection_perip', conn: 200 });
});

test('RL2: "tanimli ama uygulanmiyor" EKSIK sayilir', () => {
  const tam = {
    zones: { request_limit: { rate: '500r/s' }, server_limit: { rate: '5000r/s' }, limit_connection_perip: {} },
    applied: { request_limit: { burst: 200, nodelay: true }, server_limit: { burst: 200, nodelay: true }, limit_connection_perip: { conn: 200 } },
  };
  assert.equal(rl.hostStatus(tam).durum, 'standart');

  // Zone var ama limit_req YOK: bellekte duran ama HICBIR ISTEGI sinirlamayan bir zone.
  // Bu sessiz durumu "standart" saymak, olmayan bir korumayi var gostermek olurdu.
  const uygulanmiyor = { zones: { request_limit: { rate: '500r/s' } }, applied: {} };
  const st = rl.hostStatus(uygulanmiyor);
  assert.equal(st.durum, 'eksik');
  assert.ok(st.eksikler.some((x) => x.includes('UYGULANMIYOR')));

  // Oran/burst/nodelay farki: "farkli" - yanlis olmak zorunda degil ama gorunur olmali.
  const farkli = JSON.parse(JSON.stringify(tam));
  farkli.zones.request_limit.rate = '100r/s';
  farkli.applied.server_limit.nodelay = false;
  const f = rl.hostStatus(farkli);
  assert.equal(f.durum, 'farkli');
  assert.ok(f.farklar.some((x) => x.includes('100r/s')));
  assert.ok(f.farklar.some((x) => x.includes('nodelay')));

  // EKSIK, FARKLI'yi bastirir: bir zone hic uygulanmiyorsa oncelik odur.
  const ikisi = JSON.parse(JSON.stringify(farkli));
  delete ikisi.applied.limit_connection_perip;
  assert.equal(rl.hostStatus(ikisi).durum, 'eksik');
});

test('RL3: rapor sunucu basina satir, Excel uyumlu', () => {
  const hosts = [{
    host: 'GBNGXP40', env: 'PROD', requestRate: '500r/s', serverRate: '5000r/s', connLimit: 200,
    applied: ['request_limit', 'server_limit'], zoneCount: 3, fileLoaded: true, mismatch: 0,
    durum: 'farkli', eksikler: [], farklar: ['server_limit burst=100 (standart 200)'], detay: [],
  }];
  const csv = rl.toCsv(hosts, '2026-09-26');
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'BOM yoksa Excel Turkce karakteri bozar');
  assert.ok(csv.includes('Sunucu;Ortam'), 'TR Excel icin noktali virgul');
  assert.ok(csv.includes('GBNGXP40;PROD;500r/s;5000r/s;200'));
  assert.ok(csv.includes('\r\n'));
  // Ayrac iceren metin kacisli olmali - yoksa sutunlar kayar.
  const kacisli = rl.toCsv([{ ...hosts[0], farklar: ['a;b'] }], '2026-09-26');
  assert.ok(kacisli.includes('"a;b"'));
});

test('RL4: OOM korumasi - ekran SUNUCU listeler, detay sinirli', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'ratelimit.cjs'), 'utf8');
  // Sunucu basina ham direktif sayisi sinirli olmali (detay icin, liste icin degil).
  assert.match(srv, /h\.raw\.length < 20/, 'ham satirlar sinirlandirilmamis');
  // Yanit SUNUCU dizisi dondurmeli; location satir dizisi DEGIL.
  assert.match(srv, /hosts,\n\s*summary: summarize\(hosts\)/);

  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'RateLimitTab.tsx'), 'utf8');
  assert.match(ui, /data\?\.hosts/, 'ekran sunucu listesi okumali');
  assert.ok(!/data\?\.rows/.test(ui), 'ekran hala location satirlarini okuyor (OOM riski)');
  // Detay yalnizca ACILAN sunucu icin render edilmeli.
  assert.match(ui, /\{open && \(/);
});

test('RL5: kaynak APIGW envanteri DEGIL, nginx -T tabanli audit', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'ratelimit.cjs'), 'utf8');
  assert.match(srv, /dbo\.Nginx_Audit_Settings/);
  // YORUMLARI AY: dosyanin basindaki "eski kaynak neydi" aciklamasi bir ihlal degil.
  const kod = srv.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
  assert.ok(!/NginxRateLimitInventory/.test(kod),
    'APIGW envanteri farkli bir veri - bu sekme tum filonun rate_limits.conf degerlerini gosterir');
  // Estate katalogu rate_limits.conf ile ayni uc tanimi tasimali.
  const anahtarlar = rl.ZONE_CATALOG.map((z) => z.key).sort();
  assert.deepEqual(anahtarlar, ['limit_connection_perip', 'request_limit', 'server_limit']);
  assert.equal(rl.LIMIT_FILE, '/usr/nginx/conf/rate_limits.conf');
  // Sorgu, zone tanimini da uygulamasini da cekmeli - biri olmadan "uygulanmiyor" denemez.
  for (const d of ['limit_req_zone', 'limit_conn_zone', 'limit_req', 'limit_conn']) {
    assert.ok(rl.DIRECTIVES.includes(d), `${d} sorgulanmali`);
  }
});

test('RL6: tarama limit direktiflerini toplamadiysa "eksik" DENMEZ', () => {
  // 2026-09-26 kullanici bulgusu: "tum sunucularda eksik geldi, halbuki neredeyse
  // tum sunucularda var". Kok neden ekran degil TARAMAYDI - nginx_audit_scan.sh'in
  // WATCH listesinde limit_req_zone/limit_conn_zone/limit_req/limit_conn YOKTU,
  // yani dbo.Nginx_Audit_Settings'e hic satir yazilmamisti. Sifir satiri "limit yok"
  // diye okumak, ekranin BILMEDIGI bir seyi iddia etmesidir.
  const bos = { zones: {}, applied: {} };
  assert.equal(rl.hostStatus(bos, false).durum, 'bilinmiyor');
  assert.deepEqual(rl.hostStatus(bos, false).eksikler, [], 'olculmeyen sunucuya eksik yazilamaz');
  // Olculdugu HALDE bossa: bu gercek bir eksiktir, yumusatilmaz.
  assert.equal(rl.hostStatus(bos, true).durum, 'eksik');
  // Varsayilan geriye donuk uyumlu olmali (olculdu).
  assert.equal(rl.hostStatus(bos).durum, 'eksik');

  // Sunucu kodu bu ayrimi yanita tasimali; ekran da sebebi yazmali.
  const srv = fs.readFileSync(path.join(__dirname, '..', 'ratelimit.cjs'), 'utf8');
  assert.match(srv, /directivesMissing/);
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'RateLimitTab.tsx'), 'utf8');
  assert.match(ui, /data\?\.directivesMissing/, 'ekran sebebi gostermiyor, filoyu kirmiziya boyar');
});

test('RL7: nginx kurulu degil / calismiyor, "limit eksik" DEMEK degildir', () => {
  // Kullanici (2026-09-26): "bir Nginx instance'i calismiyorsa ve Nginx dizini var ancak
  // Nginx hic kurulu degilse bunu belirtmeni istiyorum." Kurulu olmayan bir sunucuda
  // limit sayisi 0'dir - ama bu bir EKSIKLIK degil, olcumun konusu olmamasidir.
  const bos = { zones: {}, applied: {} };
  assert.equal(rl.hostStatus(bos, true, 'kurulumyok').durum, 'kurulumyok');
  assert.deepEqual(rl.hostStatus(bos, true, 'kurulumyok').eksikler, [],
    'kurulu olmayan sunucuya eksik yazilamaz');
  assert.equal(rl.hostStatus(bos, true, 'configbozuk').durum, 'configbozuk');
  assert.equal(rl.hostStatus(bos, true, 'bilinmiyor').durum, 'bilinmiyor');

  // DURAN nginx bastirilmaz: `nginx -T` calistigi icin degerler OLCULMUSTUR. Onlari
  // gizlemek, dogru olcumu atmak olurdu; ekran ayrica "calismiyor" bayragini gosterir.
  const tam = {
    zones: { request_limit: { rate: '500r/s' }, server_limit: { rate: '5000r/s' }, limit_connection_perip: {} },
    applied: { request_limit: { burst: 200, nodelay: true }, server_limit: { burst: 200, nodelay: true }, limit_connection_perip: { conn: 200 } },
  };
  assert.equal(rl.hostStatus(tam, true, 'calismiyor').durum, 'standart');

  // Sunucu kodu host durumlarini AYRI tablodan okumali; ayar satiri olmayan sunucu da
  // listede kalmali (eskiden listeden tamamen dusuyor, "sorun yok" gibi gorunuyordu).
  const srv = fs.readFileSync(path.join(__dirname, '..', 'ratelimit.cjs'), 'utf8');
  assert.match(srv, /nginx-host-state\.cjs/, 'sunucu durumlari okunmuyor');
  assert.match(srv, /if \(!byHost\.has\(host\)\) al\(host\)/,
    'ayar satiri olmayan sunucu listeden dusuyor');

  // CSV raporu da ayni ayrimi tasimali.
  const csv = rl.toCsv([{
    host: 'GBNGXP99', env: 'PROD', requestRate: null, serverRate: null, connLimit: null,
    applied: [], zoneCount: 0, fileLoaded: false, mismatch: 0, durum: 'kurulumyok',
    eksikler: [], farklar: [], detay: [], calisiyor: null,
  }], '2026-09-26');
  assert.match(csv, /NGINX KURULU DEĞİL/, 'rapor sebebi yazmiyor, "eksik" gibi okunur');
});

test('RL8: siralama - sorunlu ustte, oranlar SAYISAL, olculemeyen sona', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'RateLimitTab.tsx'), 'utf8');

  // Varsayilan "sorun": bu bir envanter degil DENETIM ekrani, once bakilmasi gereken ustte.
  assert.match(ui, /useState<Sira>\('sorun'\)/, 'varsayilan siralama sorunlu-ustte degil');
  assert.match(ui, /DURUM_AGIRLIK/, 'durum agirliklari yok, alfabetik siralaniyor');

  // Agirlik sirasi ANLAMLI olmali: kurulu degil > config bozuk > eksik > standart.
  const blok = ui.slice(ui.indexOf('DURUM_AGIRLIK'), ui.indexOf('type Sira'));
  const agirlik = (k) => {
    // RegExp KURMUYORUZ: bu dosyaya yazilirken kacis karakterleri bozulabiliyor
    // (heredoc), sessizce eslesmeyen bir kalip bekciyi kor yapardi. Duz ayristirma.
    const i = blok.indexOf(k + ':');
    assert.ok(i >= 0, `${k} agirligi yok`);
    const n = Number(blok.slice(i + k.length + 1, blok.indexOf(',', i)).trim());
    assert.ok(Number.isFinite(n), `${k} agirligi sayi degil`);
    return n;
  };
  const sira = ['kurulumyok', 'configbozuk', 'eksik', 'bilinmiyor', 'farkli', 'standart'].map(agirlik);
  for (let i = 1; i < sira.length; i += 1) {
    assert.ok(sira[i] > sira[i - 1], 'durum agirliklari artan sirada degil: ' + sira.join(','));
  }

  // ORAN METIN DEGIL SAYI olarak karsilastirilmali. Metin siralamasi "100r/s" > "50r/s"
  // derdi ve rapor yanlis okunurdu.
  assert.match(ui, /function oranSayi/, 'oran metinden sayiya cevrilmiyor');
  assert.ok(ui.includes(String.raw`r\/(s|m)`), 'r/m birimi taninmiyor');

  // OLCULEMEYEN (null) deger HER ZAMAN sona: 0 gibi davranmasi, limiti olmayan sunucuyu
  // "en dusuk limitli" gibi gosterirdi - bugun duzelttigimiz hata sinifinin aynisi.
  assert.match(ui, /function sayiKarsilastir/);
  const sk = ui.slice(ui.indexOf('function sayiKarsilastir'), ui.indexOf('function sayiKarsilastir') + 400);
  assert.match(sk, /if \(a == null\) return 1;/, 'null deger sona gitmiyor');
  assert.match(sk, /if \(b == null\) return -1;/);

  // Yanit dizisi YERINDE siralanmamali: data.hosts yanitin kendisi.
  assert.match(ui, /\[\.\.\.suzulmus\]\.sort/, 'yanit dizisi yerinde sort ediliyor');
  // Esitlik bozulmasi kararli olmali (ad ile), yoksa her render sira degistirir.
  assert.match(ui, /localeCompare\(b\.host, 'tr'\)/, 'esitlikte kararli siralama yok');
});

test('RL9: ortam sunucu adindan OKUNUR (sayilardan onceki harf), uydurulmaz', () => {
  // Kullanici kurali (2026-09-26): "sunucunun sayilardan onceki ilk harf P ise Production,
  // Q-T-D ise Non-Production". Onceki surum bir on-ek kalibiydi ve UYDURMAYDI: GBNGXAP32
  // kalibi tutmuyor, GBNGXQ01 hic taninmiyordu; ikisi de "DIGER" dusuyordu - ekran, adindan
  // ortami okunabilen sunucular icin "bilmiyorum" diyordu.
  for (const h of ['GBNGXP40', 'GBNGXP41', 'GBNGXP44', 'GBNGXP58', 'GBNGXP50',
                   'GBNGXAP32', 'GBNGXAP34', 'GBRVPP07', 'GBRVPAP01']) {
    assert.equal(rl.envOfHost(h), 'Production', `${h} Production olmali`);
  }
  for (const h of ['GBNGXT33', 'GBNGXT34', 'GBNGXQ01', 'GBNGXQ50', 'GBNGXD01', 'GBNGXD50',
                   'GBLABT02']) {
    assert.equal(rl.envOfHost(h), 'Non-Production', `${h} Non-Production olmali`);
  }

  // Kucuk harf ve bosluk gelse de ayni cevap.
  assert.equal(rl.envOfHost(' gbngxap34 '), 'Production');

  // HICBIR SUNUCU "DIGER" diye dusmemeli - kalip tutmayan girdi bunun disinda.
  assert.equal(rl.envOfHost('GBEVM01'), 'DIGER', 'M harfi ortam kuralinda yok');
  assert.equal(rl.envOfHost('SAYISIZ'), 'DIGER');
  assert.equal(rl.envOfHost(''), 'DIGER');
  assert.equal(rl.envOfHost(null), 'DIGER');

  // Kural TEK harfe bakmali: on-ek kalibina geri donulmemeli.
  const srv = fs.readFileSync(path.join(__dirname, '..', 'ratelimit.cjs'), 'utf8');
  // YORUMLARI AY: eski kalibi ACIKLAYAN yorum bir ihlal degil. (Bugun ucuncu kez ayni
  // tuzak: bekci kendi aciklamasini bulup kirmiziya donuyor.)
  const srvKod = srv.split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('//')).join(String.fromCharCode(10));
  assert.ok(!srvKod.includes('^GBNGX?P'), 'on-ek kalibi geri gelmis (GBNGXAP32 tutmuyordu)');
  assert.match(srv, /ENV_HARF/, 'harf -> ortam eslemesi yok');
  // P/Q/T/D dordu birden tanimli olmali; biri eksikse o sunucular sessizce DIGER olur.
  for (const harf of ['P', 'Q', 'T', 'D']) {
    assert.ok(Object.prototype.hasOwnProperty.call(rl.ENV_HARF, harf), `${harf} harfi tanimli degil`);
  }
});

test('RL10: bilerek KAPALI (include yorumlu) eksik DEGILDIR, ayri durumdur', () => {
  // rate_limit_enabled = false (2026-11-09): nginx.conf'ta `#include .../rate_limits.conf;`.
  // nginx -T yorumlu satiri gostermez; sinyal nginx_audit_analyze.py'nin ham nginx.conf'tan
  // yazdigi Nginx_Audit_Settings satiri: directive=rate_limits_include, value=enabled|disabled|missing.
  assert.equal(rl.INCLUDE_SIGNAL, 'rate_limits_include');
  assert.ok(rl.SORGU_DIREKTIFLERI.includes('rate_limits_include'), 'sinyal sorgulanmiyor');
  const bos = { zones: {}, applied: {} };
  assert.equal(rl.hostStatus({ ...bos, include: 'disabled' }).durum, 'kapali');
  assert.deepEqual(rl.hostStatus({ ...bos, include: 'disabled' }).eksikler, []);
  // Olculmedi (eski filo) bile olsa kapali sinyali kendi hukmudur.
  assert.equal(rl.hostStatus({ ...bos, include: 'disabled' }, false).durum, 'kapali');
  // Sunucu durumu yine once gelir.
  assert.equal(rl.hostStatus({ ...bos, include: 'disabled' }, true, 'configbozuk').durum, 'configbozuk');
  // "Uc zone yok" TEK BASINA kapali degildir: dosya kaybolmus olabilir.
  assert.equal(rl.hostStatus({ ...bos, include: 'enabled' }).durum, 'eksik');
  assert.equal(rl.hostStatus({ ...bos, include: null }).durum, 'eksik');
  // Satir HIC yoksa eksik + sebep (toggle satiri eklemez).
  const yok = rl.hostStatus({ ...bos, include: 'missing' });
  assert.equal(yok.durum, 'eksik');
  assert.ok(yok.eksikler[0].includes('include satırı yok'));
  // "Include yorumlu" TEK BASINA kapali degildir: zone baska dosyadan geliyorsa olculur.
  const tam = {
    zones: { request_limit: { rate: '500r/s' }, server_limit: { rate: '5000r/s' }, limit_connection_perip: {} },
    applied: { request_limit: { burst: 200, nodelay: true }, server_limit: { burst: 200, nodelay: true }, limit_connection_perip: { conn: 200 } },
  };
  assert.equal(rl.hostStatus({ ...tam, include: 'disabled' }).durum, 'standart');
  const kismi = { zones: { request_limit: { rate: '500r/s' } }, applied: {}, include: 'disabled' };
  assert.equal(rl.hostStatus(kismi).durum, 'eksik');
  const yalnizUygulama = { zones: {}, applied: { server_limit: { burst: 200, nodelay: true } }, include: 'disabled' };
  assert.equal(rl.hostStatus(yalnizUygulama).durum, 'eksik', 'uygulanan zone varken kapali denildi');

  // Ozet: kapali kendi sayacinda, "dosya yuklu degil" sayacina GIRMEZ.
  const H = (host, durum, fileLoaded) => ({ host, env: 'Production', durum, fileLoaded, calisiyor: true, requestRate: null, serverRate: null });
  const s = rl.summarize([H('A1', 'kapali', false), H('A2', 'eksik', false), H('A3', 'standart', true)]);
  assert.equal(s.kapali, 1);
  assert.equal(s.eksik, 1);
  assert.equal(s.dosyaYuklenmemis, 1, 'kapali sunucu "dosya yuklu degil" sayildi');
  assert.equal(s.byEnv.Production.kapali, 1);
  assert.equal(rl.kapaliMesaji(rl.summarize([H('A3', 'standart', true)])), undefined);
  assert.match(rl.kapaliMesaji(rl.summarize([H('A1', 'kapali', false), H('A2', 'kapali', false)])), /^Tüm sunucularda/);
  assert.match(rl.kapaliMesaji(s), /^1 sunucuda/);

  // CSV: kapali ayri deger tasir, EKSIK/HAYIR yazmaz.
  const csv = rl.toCsv([{
    host: 'GBNGXP98', env: 'Production', requestRate: null, serverRate: null, connLimit: null,
    applied: [], zoneCount: 0, fileLoaded: false, mismatch: 0, durum: 'kapali',
    eksikler: [], farklar: [], detay: [], calisiyor: true,
  }], '2026-11-09');
  assert.ok(csv.includes('hayır (bilerek kapalı);Kapalı (bilerek)'), csv);
  assert.ok(!/EKSİK|HAYIR/.test(csv), 'kapali sunucu raporda eksik gibi okunur');

  // UI: notr bilgi tonu, kendi KPI'si, etiket.
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'RateLimitTab.tsx'), 'utf8');
  const satir = ui.split(String.fromCharCode(10)).find((l) => l.trim().startsWith('kapali: {'));
  assert.ok(satir, 'DURUM.kapali yok');
  assert.ok(satir.includes("'Kapalı (bilerek)'") && satir.includes('--status-info') && !satir.includes('--status-danger'),
    'kapali etiketi/rengi yanlis: ' + satir);
  assert.ok(ui.includes('title="Kapalı (bilerek)" value={s.kapali}'), 'kapali KPI yok');
  assert.ok(ui.includes("h.durum !== 'kapali' && ("), 'kapali sunucuda "rate_limits.conf yok" rozeti cikiyor');
  assert.ok(ui.includes('data?.kapaliMessage'), 'kapali bilgi metni gosterilmiyor');
  assert.ok(!ui.includes('Vazgeç'));
});

test('RL11: uctan uca - tum filo kapaliyken "surum kosmamis" DENMEZ', async () => {
  const mssqlYol = require.resolve('../../inventory/mssql.cjs');
  const durumYol = require.resolve('../../audit/nginx-host-state.cjs');
  const rlYol = require.resolve('../ratelimit.cjs');
  const eski = { m: require.cache[mssqlYol], d: require.cache[durumYol], r: require.cache[rlYol] };
  const satirlar = (hostlar) => hostlar.map(([host, value, matches]) => ({
    host, conf_file: '/usr/nginx/nginx.conf', context: 'http', directive: 'rate_limits_include',
    value, reference_value: matches === false ? 'enabled' : null, matches,
  }));
  const sahte = (yol, exports) => ({ id: yol, filename: yol, loaded: true, exports });
  const kur = (rows) => {
    require.cache[mssqlYol] = sahte(mssqlYol, {
      sql: { NVarChar: () => 'nv' },
      query: async (q) => {
        if (/MAX\(scan_date\)/.test(q) || /DISTINCT TOP 30/.test(q)) return { recordset: [{ d: '2026-11-09' }] };
        // Gercek SQL gibi: yalniz sorgulanan direktifler doner (sinyal sorgudan duserse gorunur).
        // Liste SQL'e LITERAL gomulu (2026-11-13; filtrelenmis indeks icin).
        const m = /directive IN \(([^)]*)\)/.exec(q);
        const istenen = new Set(m ? m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')) : []);
        return { recordset: rows.filter((r) => istenen.has(r.directive)) };
      },
    });
    require.cache[durumYol] = sahte(durumYol, { loadHostStates: async () => new Map() });
    delete require.cache[rlYol];
    return require('../ratelimit.cjs');
  };
  try {
    const r = await kur(satirlar([['GBNGXP01', 'disabled', null], ['GBNGXP02', 'disabled', null]])).loadRateLimits();
    assert.equal(r.directivesMissing, false, 'tum filo kapaliyken "olculmedi" denildi');
    assert.equal(r.message, undefined, 'yaniltici "surum henuz kosmamis" mesaji');
    assert.deepEqual(r.hosts.map((h) => h.durum), ['kapali', 'kapali']);
    assert.equal(r.hosts[0].rateLimitInclude, 'disabled');
    assert.equal(r.summary.kapali, 2);
    assert.equal(r.summary.dosyaYuklenmemis, 0);
    assert.match(r.kapaliMessage, /^Tüm sunucularda/);
    // Sinyal satiri nginx -T detayina girmez.
    assert.deepEqual(r.hosts[0].detay, []);

    // Karisik: biri acik ama zone yok (dosya kaybolmus) -> eksik; biri yok + sapma.
    const r2 = await kur(satirlar([['GBNGXP01', 'disabled', null], ['GBNGXP03', 'enabled', null], ['GBNGXP04', 'missing', false]])).loadRateLimits();
    const d = Object.fromEntries(r2.hosts.map((h) => [h.host, h]));
    assert.equal(d.GBNGXP01.durum, 'kapali');
    assert.equal(d.GBNGXP03.durum, 'eksik');
    assert.equal(d.GBNGXP04.durum, 'eksik');
    assert.equal(d.GBNGXP04.mismatch, 1);
    assert.equal(r2.summary.dosyaYuklenmemis, 2);
    assert.match(r2.kapaliMessage, /^1 sunucuda/);

    // Eski analizci degerleri (acik/kapali/yok) yeni degerlere cevrilir.
    const r3 = await kur(satirlar([['GBNGXP01', 'kapali', null], ['GBNGXP02', 'kapali', null]])).loadRateLimits();
    assert.deepEqual(r3.hosts.map((h) => h.durum), ['kapali', 'kapali'], 'eski "kapali" degeri taninmadi');
    assert.equal(r3.hosts[0].rateLimitInclude, 'disabled');
    assert.equal(r3.summary.kapali, 2);
    assert.equal(r3.directivesMissing, false);
    const r3b = await kur(satirlar([['GBNGXP03', 'acik', null], ['GBNGXP04', 'yok', false]])).loadRateLimits();
    const e = Object.fromEntries(r3b.hosts.map((h) => [h.host, h]));
    assert.equal(e.GBNGXP03.rateLimitInclude, 'enabled');
    assert.equal(e.GBNGXP04.rateLimitInclude, 'missing');
    assert.ok(e.GBNGXP04.eksikler[0].includes('include satırı yok'), 'eski "yok" degerinde sebep kayboldu');

    // Sinyal yoksa (eski analiz) eski davranis: olculmedi.
    const r4 = await kur([{ host: 'GBNGXP05', conf_file: '/usr/nginx/conf/x.conf', context: 'main', directive: 'limit_req_status', value: '429', reference_value: '429', matches: true }]).loadRateLimits();
    assert.equal(r4.directivesMissing, true);
    assert.equal(r4.hosts[0].durum, 'bilinmiyor');
    assert.equal(r4.hosts[0].rateLimitInclude, null);
    assert.equal(r4.kapaliMessage, undefined);
  } finally {
    for (const [k, v] of [[mssqlYol, eski.m], [durumYol, eski.d], [rlYol, eski.r]]) {
      if (v) require.cache[k] = v; else delete require.cache[k];
    }
  }
});

// RL12 (2026-11-13, SlowQuery): kullaniciya donuk ratelimit okumasi ana havuzda (pool=tbmwans).
// Direktif listesi LITERAL (filtrelenmis indeks ancak boyle eslesir), tarih listesi Hosts'tan,
// ham satirlar nginx_audit belirteciyle onbellekte (ayni tarama yeniden okunmaz).
test('RL12: literal IN, tarih listesi Hosts tablosundan, belirtec ayniyken Settings yeniden okunmaz', async () => {
  const mssqlYol = require.resolve('../../inventory/mssql.cjs');
  const durumYol = require.resolve('../../audit/nginx-host-state.cjs');
  const rlYol = require.resolve('../ratelimit.cjs');
  const eski = { m: require.cache[mssqlYol], d: require.cache[durumYol], r: require.cache[rlYol] };
  const sahte = (yol, exports) => ({ id: yol, filename: yol, loaded: true, exports });
  const st = { stId: 50, kayit: [], tokenHata: false };
  require.cache[mssqlYol] = sahte(mssqlYol, {
    sql: { NVarChar: () => 'nv' },
    query: async (q, params = []) => {
      st.kayit.push({ q, params });
      if (/MAX\(id\)/.test(q)) {
        if (st.tokenHata) throw new Error('belirtec yok');
        return { recordset: [{ d: '2026-11-13', h_id: 1, sv_id: 2, l_id: 3, u_id: 4, st_id: st.stId, f_id: 6 }] };
      }
      if (/MAX\(scan_date\)/.test(q) || /DISTINCT TOP 30/.test(q)) return { recordset: [{ d: '2026-11-13' }] };
      return { recordset: [{ host: 'GBNGXP01', conf_file: '/usr/nginx/nginx.conf', context: 'http', directive: 'rate_limits_include', value: 'disabled', reference_value: null, matches: null }] };
    },
  });
  require.cache[durumYol] = sahte(durumYol, { loadHostStates: async () => new Map() });
  delete require.cache[rlYol];
  try {
    const rl = require('../ratelimit.cjs');
    const settingsSorgulari = () => st.kayit.filter((k) => /FROM dbo\.Nginx_Audit_Settings\s+WHERE scan_date = @d/.test(k.q));
    const r1 = await rl.loadRateLimits();
    assert.equal(r1.hosts[0].durum, 'kapali');
    const s = settingsSorgulari()[0];
    assert.ok(!/@x\d/.test(s.q), 'direktif listesi hala parametreli');
    for (const d of rl.SORGU_DIREKTIFLERI) assert.ok(s.q.includes(`'${d}'`), `${d} literal degil`);
    assert.equal(rl.SORGU_DIREKTIFLERI.length, 7);
    assert.deepEqual(s.params.map((p) => p.name), ['d'], 'direktif parametresi kaldi');
    const tarih = st.kayit.find((k) => /DISTINCT TOP 30/.test(k.q));
    assert.match(tarih.q, /FROM dbo\.Nginx_Audit_Hosts/, 'tarih listesi 1,56M satirlik Settings tablosunu tariyor');
    assert.deepEqual(r1.availableDates, ['2026-11-13']);
    // Inceleme 2026-11-13: varsayilan tarih de Hosts'tan (Settings'te MAX(scan_date) indeks yoksa tam tarama).
    const varsayilan = st.kayit.find((k) => /MAX\(scan_date\), 23\) AS d FROM/.test(k.q));
    assert.ok(varsayilan, 'varsayilan tarih sorgusu yok');
    assert.match(varsayilan.q, /FROM dbo\.Nginx_Audit_Hosts/, 'varsayilan tarih Settings tablosundan okunuyor');

    await rl.loadRateLimits();
    assert.equal(settingsSorgulari().length, 1, 'ayni belirtecle Settings yeniden okundu');
    st.stId = 51;
    await rl.loadRateLimits();
    assert.equal(settingsSorgulari().length, 2, 'belirtec degisince yeniden okunmadi');
    // Belirtec okunamazsa onbellek kullanilmaz (her istek okur), ekran calisir.
    st.tokenHata = true;
    await rl.loadRateLimits();
    await rl.loadRateLimits();
    assert.equal(settingsSorgulari().length, 4);
  } finally {
    for (const [k, v] of [[mssqlYol, eski.m], [durumYol, eski.d], [rlYol, eski.r]]) {
      if (v) require.cache[k] = v; else delete require.cache[k];
    }
  }
});
