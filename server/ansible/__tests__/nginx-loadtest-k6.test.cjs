// server/ansible/__tests__/nginx-loadtest-k6.test.cjs - Yuk Testi k6 betigi (aynadaki files/yuk_k6.js) mantigi.
//
// El kitinin testler/test_k6_mantik.mjs testinin node:test portu: k6 KURULU OLMADAN, sahte k6 modulleriyle
// (globalThis.__k6) betik yuklenir. Kitten gelen iddialar (init dogrulamalari, yalniz Host/Accept-Encoding/
// User-Agent basliklari, bos cookie jar, agirlikli secim, setup'ta TUM tekil yollarin 200 on kontrolu,
// sikistirma tespiti, handleSummary CSV kolonlari, dropped/5xx'in yalniz olcum fazindan okunmasi) +
// Portal farklari: User-Agent oneki UA_ONEK (varsayilan portal-yuktesti), HOST_BASLIGI ZORUNLU (GLOMO
// varsayilani yok), SNI'da hosts eslemesi HOST_BASLIGI ile.
// K7: k6 ve wrk istemci dosyalari ayni semayi tasir: ozet_hesapla ciktisinin anahtar sirasi = wrk_kos.sh
// JSON_ANAHTARLARI (wrk_kos.sh'in awk bicimleyicisi bu sirayla yazar; Portal okuyucusu iki motorda tek).
// K-H1..K-H3 (h2 sozlesmesi): PROTOKOL h1 | h2 (h2 yalniz KIP=ka, yoksa h1), beklenen surum disi yanit
// protokol_uyumsuz sayacina (esik count<1 abortOnFail), HTTP/2.0 yanit http2_kullanildi'ya (esiksiz bilgi), setup HER
// kontrol yolunun surumune bakar; CSV/JSON 32 kolon (sona protokol, protokol_uyumsuz).
// Gercek k6 davranisini (TLS, ALPN ile h2 / HTTP/1.1, esik iptali) DOGRULAMAZ; o kisim ilk kanarya kosusunda gorulur.
// YUK_K6 / WRK_KOS: mutasyon kopyalari (verilmezse aynadaki betikler).
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BETIK =
  process.env.YUK_K6 || path.join(__dirname, '..', 'bmw_portal', 'nginx_loadtest', 'files', 'yuk_k6.js');
const KAYNAK = fs.readFileSync(BETIK, 'utf8');
const WRK_KOS =
  process.env.WRK_KOS || path.join(__dirname, '..', 'bmw_portal', 'nginx_loadtest', 'files', 'wrk_kos.sh');
let GECICI;
let SENARYO;
let KOTU;
let sayac = 0;
const sahte = { cagrilar: [], yanit: null, sayaclar: {} };
const brYanit = () => ({ status: 200, proto: 'HTTP/1.1', headers: { 'Content-Encoding': 'br' } });

before(() => {
  GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'nlk6_'));
  SENARYO = path.join(GECICI, 'K.tsv');
  fs.writeFileSync(SENARYO, '1\t1\thtml\tkucuk\t/app-v1/\n3\t1\tjs\tbuyuk\t/app-v1/assets/a.js\n');
  KOTU = path.join(GECICI, 'kotu.tsv');
  fs.writeFileSync(KOTU, '1\t1\tjs\tkucuk\t/app-v1/a.js?token=x\n');
  sahte.yanit = brYanit;
  globalThis.__k6 = {
    http: {
      get(u, p) {
        sahte.cagrilar.push({ u, p });
        return sahte.yanit(u, p);
      },
      CookieJar: class {
        constructor() {
          this.bos = true;
        }
      },
    },
    metrics: {
      Counter: class {
        constructor(ad) {
          this.ad = ad;
          sahte.sayaclar[ad] = 0;
        }
        add(v) {
          sahte.sayaclar[this.ad] += v;
        }
      },
    },
    // `new SharedArray(...)`: ok fonksiyon kurucu olamaz, duz function gerekir.
    data: {
      SharedArray: function (ad, fn) {
        return fn();
      },
    },
  };
  globalThis.open = (p) => fs.readFileSync(p, 'utf8');
});

after(() => {
  fs.rmSync(GECICI, { recursive: true, force: true });
});

async function yukle(env) {
  globalThis.__ENV = env;
  const kod = KAYNAK.replace(/^import .* from 'k6[^']*';\s*$/gm, '').replace(
    /^/,
    'const http = globalThis.__k6.http; const { Counter } = globalThis.__k6.metrics; ' +
      'const { SharedArray } = globalThis.__k6.data;\n',
  );
  const dosya = path.join(GECICI, `k6_${sayac++}.mjs`);
  fs.writeFileSync(dosya, kod);
  return import(pathToFileURL(dosya).href);
}

const temel = () => ({
  HEDEF: 'https://10.1.2.3',
  HOST_BASLIGI: 'vhost.test.example',
  SENARYO,
  TUR: 'R17_K_yeni_br_250_r1',
  ADIM: 'R17',
  SEN: 'K',
  HIZ: '250',
  CIKTI: 'C:/sonuc/R17',
});

async function hataVerir(env, desen) {
  await assert.rejects(() => yukle(env), (e) => desen.test(String(e.message)));
}

test('K1 secenekler: hiz, sure, TLS 1.2, 429/http2 kesme esikleri, govde atilir, yonlendirme yok', async () => {
  const o = (await yukle(temel())).options;
  assert.equal(o.noConnectionReuse, true, 'KIP=yeni -> her istek yeni baglanti');
  assert.equal(o.scenarios.olcum.rate, 250);
  assert.equal(o.scenarios.olcum.startTime, '30s');
  assert.equal(o.scenarios.olcum.duration, '120s');
  assert.equal(o.scenarios.isinma.executor, 'constant-arrival-rate');
  assert.equal(o.scenarios.olcum.maxVUs, 150);
  assert.deepEqual(o.tlsVersion, { min: 'tls1.2', max: 'tls1.2' });
  assert.equal(o.thresholds.durum_429[0].abortOnFail, true);
  // h2 sozlesmesi D5: kesme esigi protokol_uyumsuz (beklenen surum disi yanit); http2_kullanildi yalniz bilgi (esiksiz)
  assert.deepEqual(o.thresholds.protokol_uyumsuz, [{ threshold: 'count<1', abortOnFail: true }]);
  assert.equal(o.thresholds.http2_kullanildi, undefined, 'http2_kullanildi esigi YOK (h2 kosusunda her yanitta dolu)');
  assert.ok(o.thresholds['dropped_iterations{scenario:olcum}'] && o.thresholds['durum_5xx{scenario:olcum}']);
  assert.equal(o.hosts, undefined, 'SNI yokken hosts eslemesi yok');
  assert.equal(o.discardResponseBodies, true);
  assert.equal(o.maxRedirects, 0);
  assert.equal(o.userAgent, 'portal-yuktesti/R17_K_yeni_br_250_r1/setup/1', 'setup UA varsayilan onekle');
});

test('K2 istekler: URL = HEDEF + yol, yalniz uc baslik, Host = HOST_BASLIGI, bos cookie jar, UA portal-yuktesti', async () => {
  const m = await yukle(temel());
  sahte.cagrilar = [];
  const asil = Math.random;
  try {
    Math.random = () => 0.24;
    m.olcum();
    Math.random = () => 0.26;
    m.isinma();
  } finally {
    Math.random = asil;
  }
  const [c1, c2] = sahte.cagrilar;
  assert.equal(c1.u, 'https://10.1.2.3/app-v1/', 'agirlik sinirinin alti ilk yol');
  assert.equal(c2.u, 'https://10.1.2.3/app-v1/assets/a.js', 'agirlik sinirinin ustu ikinci yol');
  for (const c of sahte.cagrilar) {
    assert.deepEqual(Object.keys(c.p.headers).sort(), ['Accept-Encoding', 'Host', 'User-Agent']);
    assert.equal(c.p.headers.Host, 'vhost.test.example');
    assert.equal(c.p.headers['Accept-Encoding'], 'gzip, deflate, br, zstd');
    assert.equal(c.p.jar && c.p.jar.bos, true, 'her istek bos cookie jar');
    assert.ok(!/\s/.test(c.p.headers['User-Agent']), 'UA bosluksuz (log ayristirma)');
  }
  assert.equal(c1.p.headers['User-Agent'], 'portal-yuktesti/R17_K_yeni_br_250_r1/olcum/1');
  assert.equal(c2.p.headers['User-Agent'], 'portal-yuktesti/R17_K_yeni_br_250_r1/isinma/1');
  assert.equal(c2.p.tags.tur, 'js');
  assert.equal(c2.p.tags.boyut, 'buyuk');
});

test('K3 Portal: UA_ONEK ortamdan, HOST_BASLIGI zorunlu, GLOMO varsayilanlari yok', async () => {
  const m = await yukle({ ...temel(), UA_ONEK: 'baska-onek', DENEME: '2' });
  sahte.cagrilar = [];
  m.olcum();
  assert.equal(sahte.cagrilar[0].p.headers['User-Agent'], 'baska-onek/R17_K_yeni_br_250_r1/olcum/2');
  assert.equal(m.ozet_hesapla({ metrics: {} }).deneme, 2);
  await hataVerir({ ...temel(), HOST_BASLIGI: '' }, /HOST_BASLIGI/);
  const { HOST_BASLIGI, ...hostsuz } = temel();
  assert.ok(HOST_BASLIGI);
  await hataVerir(hostsuz, /HOST_BASLIGI/);
  await hataVerir({ ...temel(), UA_ONEK: 'Kotu Onek' }, /UA_ONEK/);
  await hataVerir({ ...temel(), UA_ONEK: 'a.b' }, /UA_ONEK/);
  assert.ok(!KAYNAK.includes('glomo-yuktesti') && !KAYNAK.includes('garantibbva'), 'GLOMO UA/host varsayilani kalmamali');
});

test('K4 setup: sikistirma turu ve senaryodaki HER tekil yolun 200 on kontrolu', async () => {
  const m = await yukle(temel());
  sahte.yanit = brYanit;
  sahte.cagrilar = [];
  assert.equal(m.setup().sikistirma_turu, 'DINAMIK', 'Content-Length yok + br');
  assert.ok(sahte.cagrilar[0].u.endsWith('/assets/a.js'), 'sikistirma buyuk js ile denetlenir');
  sahte.yanit = () => ({ status: 200, proto: 'HTTP/1.1', headers: { 'Content-Encoding': 'br', 'Content-Length': '100' } });
  assert.equal(m.setup().sikistirma_turu, 'STATIK');
  sahte.yanit = () => ({ status: 200, proto: 'HTTP/1.1', headers: {} });
  assert.equal(m.setup().sikistirma_turu, 'YOK');
  sahte.yanit = () => ({ status: 404, proto: 'HTTP/1.1', headers: {} });
  assert.throws(() => m.setup(), /404/);
  sahte.yanit = () => ({ status: 200, proto: 'HTTP/2.0', headers: {} });
  assert.throws(() => m.setup(), /HTTP\/1\.1/);
  sahte.yanit = brYanit;
  sahte.cagrilar = [];
  m.setup();
  assert.equal(sahte.cagrilar.length, 2, 'her tekil yol bir kez');
  assert.ok(sahte.cagrilar.every((c) => c.p.headers['User-Agent'] === 'portal-yuktesti/R17_K_yeni_br_250_r1/setup/1'));
  sahte.yanit = (u) => (u.endsWith('/app-v1/') ? { status: 404, proto: 'HTTP/1.1', headers: {} } : brYanit());
  assert.throws(() => m.setup(), (e) => /1\/2 yol 200 donmedi/.test(e.message) && e.message.includes('/app-v1/ -> HTTP 404'));
  sahte.yanit = brYanit;
});

test('K5 handleSummary: CSV kolonlari (Portal analizi ve karsilastir.py ile ayni), olcum fazi alt metrikleri', async () => {
  const m = await yukle(temel());
  const veri = {
    metrics: {
      'http_reqs{scenario:olcum}': { values: { count: 30000, rate: 250 } },
      'http_req_duration{scenario:olcum}': { values: { count: 30000, med: 12.3456, 'p(95)': 40, 'p(99)': 80 } },
      'http_req_waiting{scenario:olcum}': { values: { count: 30000, 'p(95)': 30 } },
      'http_req_tls_handshaking{scenario:olcum}': { values: { count: 30000, 'p(95)': 5 } },
      'http_req_connecting{scenario:olcum}': { values: { count: 30000, 'p(95)': 1 } },
      'http_req_failed{scenario:olcum}': { values: { rate: 0 } },
      'data_received{scenario:olcum}': { values: { count: 300000000 } },
      'http_req_duration{scenario:olcum,tur:json}': { values: { count: 0, 'p(95)': 0 } },
      'http_req_duration{scenario:olcum,tur:js}': { values: { count: 100, 'p(95)': 42 } },
      durum_429: { values: { count: 0 } },
      sikistirma_dinamik: { values: { count: 1 } },
    },
  };
  const cikti = m.handleSummary(veri);
  const csvAd = 'C:/sonuc/R17/istemci_R17_K_yeni_br_250_r1.csv';
  assert.ok(csvAd in cikti && 'C:/sonuc/R17/istemci_R17_K_yeni_br_250_r1.json' in cikti, Object.keys(cikti).join(','));
  const [bas, satir] = cikti[csvAd].trim().split('\n');
  assert.equal(
    bas,
    'tur,adim,senaryo,kip,ae,hiz,n_olcum,rps_gercek,p50,p95,p99,ttfb_p95,tls_p95,connect_p95,hata_orani,n_429,n_5xx,' +
      'dropped,http2,bayt_istek,p95_js,p95_css,p95_html,p95_json,p95_config,p95_buyuk,sikistirma_turu,isinma_sn,sure_sn,deneme,' +
      'protokol,protokol_uyumsuz',
  );
  const s = Object.fromEntries(bas.split(',').map((k, i) => [k, satir.split(',')[i]]));
  assert.equal(s.protokol, 'h1', 'PROTOKOL verilmezse h1');
  assert.equal(s.protokol_uyumsuz, '0', 'olculmemis uyumsuz sayaci 0 (bos degil)');
  assert.equal(s.n_olcum, '30000');
  assert.equal(s.rps_gercek, '250');
  assert.equal(s.p50, '12.346');
  assert.equal(s.bayt_istek, '10000');
  assert.equal(s.p95_js, '42');
  assert.equal(s.p95_json, '', 'olculmeyen alt metrik bos (0 degil)');
  assert.equal(s.sikistirma_turu, 'DINAMIK');
  assert.equal(s.adim, 'R17');
  const o2 = m.ozet_hesapla({
    metrics: {
      ...veri.metrics,
      dropped_iterations: { values: { count: 7 } },
      'dropped_iterations{scenario:olcum}': { values: { count: 0 } },
      durum_5xx: { values: { count: 3 } },
      'durum_5xx{scenario:olcum}': { values: { count: 1 } },
      durum_429: { values: { count: 2 } },
    },
  });
  assert.equal(o2.dropped, 0, 'isinmadaki dusme sayilmaz');
  assert.equal(o2.n_5xx, 1, 'yalniz olcum fazi 5xx');
  assert.equal(o2.n_429, 2, '429 butun fazlardan');
});

test('K6 sinirlar ve girdi dogrulamasi; SNI=1 hosts eslemesi HOST_BASLIGI ile', async () => {
  await hataVerir({ ...temel(), HIZ: '5001' }, /5000|LIMIT_MUAF/);
  await hataVerir({ ...temel(), MAXVU: '1001' }, /MAXVU/);
  // K1 (2026-11-03): HIZ 5000 / MAXVU 1000 kabul; onVU HIZ <= 450'de kit kurali, ustunde max(90, HIZ/20), MAXVU ile sinirli.
  for (const [hiz, maxvu, bek] of [['250', '150', 50], ['450', '199', 90], ['451', '1000', 90], ['5000', '1000', 250], ['5000', '100', 100]]) {
    const y = await yukle({ ...temel(), HIZ: hiz, MAXVU: maxvu });
    assert.equal(y.options.scenarios.olcum.preAllocatedVUs, bek, `onVU HIZ=${hiz} MAXVU=${maxvu}`);
    assert.equal(y.options.scenarios.olcum.maxVUs, Number(maxvu));
  }
  await hataVerir({ ...temel(), TUR: 'R17 K' }, /TUR/);
  await hataVerir({ ...temel(), DENEME: '0' }, /DENEME/);
  await hataVerir({ ...temel(), HEDEF: 'https://10.1.2.3/yol' }, /HEDEF/);
  await hataVerir({ ...temel(), HEDEF: 'http://10.1.2.3' }, /HEDEF/);
  await hataVerir({ ...temel(), SENARYO: KOTU }, /beyaz liste/);
  const ka = await yukle({ ...temel(), KIP: 'ka', AE: 'identity' });
  assert.equal(ka.options.noConnectionReuse, false);
  const sni = await yukle({ ...temel(), SNI: '1' });
  assert.equal(sni.options.hosts['vhost.test.example'], '10.1.2.3');
  sahte.cagrilar = [];
  sni.olcum();
  assert.ok(sahte.cagrilar[0].u.startsWith('https://vhost.test.example/'), sahte.cagrilar[0].u);
});

test('K7 ozet_hesapla anahtar sirasi = wrk_kos.sh JSON_ANAHTARLARI (iki motorun istemci JSON semasi ayni)', async () => {
  const m = await yukle(temel());
  const jsonAnahtarlari = (fs.readFileSync(WRK_KOS, 'utf8').match(/^JSON_ANAHTARLARI="([^"]*)"$/m) || [])[1];
  assert.ok(jsonAnahtarlari, 'wrk_kos.sh JSON_ANAHTARLARI satiri okunamadi');
  const bos = Object.keys(m.ozet_hesapla({ metrics: {} }));
  const dolu = Object.keys(
    m.ozet_hesapla({
      metrics: { 'http_reqs{scenario:olcum}': { values: { count: 10 } }, 'data_received{scenario:olcum}': { values: { count: 100 } } },
      setup_data: { sikistirma_turu: 'STATIK' },
    }),
  );
  // 2026-11-03 (kip dogrulamasi): k6'ya ozgu bilgi anahtari `kodlama` (Content-Encoding sayaclari) SONDA; wrk olcmez,
  // JSON'unda yok (Portal ikisini de okur: anahtar yoksa 'olculmedi'). Geri kalan sira iki motorda AYNI.
  assert.equal(bos[bos.length - 1], 'kodlama', 'k6 JSON son anahtari kodlama');
  assert.deepEqual(bos.slice(0, -1), jsonAnahtarlari.split(' '), 'ozet_hesapla (bos metrik, kodlama haric) anahtar sirasi');
  assert.deepEqual(dolu, bos, 'anahtar sirasi metrik dolulugundan bagimsiz');
  // handleSummary'nin yazdigi JSON da ayni sirada (wrk_kos.sh JSON'u bununla karsilastirilir)
  const cikti = m.handleSummary({ metrics: {} });
  const json = Object.entries(cikti).find(([ad]) => ad.endsWith('.json'));
  assert.ok(json, 'handleSummary JSON yazmadi');
  assert.deepEqual(Object.keys(JSON.parse(json[1])), bos);
  // h2 sozlesmesi D6: 30 kolon AYNEN + sona protokol, protokol_uyumsuz (wrk_kos.sh KOLONLAR da ayni; NA6 (c))
  const kolonlar = (KAYNAK.match(/const KOLONLAR = \[([^\]]*)\]/) || [])[1];
  const liste = [...String(kolonlar).matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
  assert.equal(liste.length, 32, 'KOLONLAR 32');
  assert.deepEqual(liste.slice(-2), ['protokol', 'protokol_uyumsuz'], 'son iki kolon protokol, protokol_uyumsuz');
  // 2026-11-03 (bant genisligi): protokol_uyumsuz'dan sonra ag_alinan_bayt / ag_gonderilen_bayt / ag_sure_sn (CSV'de YOK), sonra kodlama.
  assert.deepEqual(bos.slice(-6, -1), ['protokol', 'protokol_uyumsuz', 'ag_alinan_bayt', 'ag_gonderilen_bayt', 'ag_sure_sn'], 'ozet_hesapla kodlama oncesi son bes anahtar (wrk JSON_ANAHTARLARI sonu ile ayni)');
  assert.ok(!liste.some((k) => k.startsWith('ag_')), 'ag_ CSV kolonu DEGIL (32 kolon aynen)');
  assert.ok(!liste.includes('kodlama'), 'kodlama CSV kolonu DEGIL (32 kolon aynen; eski Portal CSV okuyucusu)');
});

// ---------------------------------------------------------------- h2 sozlesmesi (A1-A5)
const h2Yanit = () => ({ status: 200, proto: 'HTTP/2.0', headers: { 'Content-Encoding': 'br' } });

async function tekIstek(env, yanit) {
  const m = await yukle(env); // Counter kurucusu sayaci sifirlar
  const asil = sahte.yanit;
  try {
    sahte.yanit = yanit;
    m.olcum();
  } finally {
    sahte.yanit = asil;
  }
  return { uyumsuz: sahte.sayaclar.protokol_uyumsuz, http2: sahte.sayaclar.http2_kullanildi };
}

test('K-H1 istek(): beklenen surum disi yanit protokol_uyumsuz, HTTP/2.0 yanit http2_kullanildi (bilgi)', async () => {
  const h2 = { ...temel(), PROTOKOL: 'h2', KIP: 'ka' };
  const yanit = (proto) => () => ({ status: 200, proto, headers: {} });
  assert.deepEqual(await tekIstek(temel(), yanit('HTTP/2.0')), { uyumsuz: 1, http2: 1 }, 'h1 + HTTP/2.0');
  assert.deepEqual(await tekIstek(temel(), yanit('HTTP/1.1')), { uyumsuz: 0, http2: 0 }, 'h1 + HTTP/1.1');
  assert.deepEqual(await tekIstek(h2, yanit('HTTP/1.1')), { uyumsuz: 1, http2: 0 }, 'h2 + HTTP/1.1');
  assert.deepEqual(await tekIstek(h2, yanit('HTTP/2.0')), { uyumsuz: 0, http2: 1 }, 'h2 + HTTP/2.0');
  assert.deepEqual(await tekIstek(h2, yanit('')), { uyumsuz: 0, http2: 0 }, 'h2 + bos proto (basarisiz istek: hata oranina girer)');
  assert.deepEqual(await tekIstek(temel(), yanit('')), { uyumsuz: 0, http2: 0 }, 'h1 + bos proto');
});

test('K-H2 setup(): HER kontrol yolunun surumu beklenenle karsilastirilir (200 denetiminden sonra)', async () => {
  const h2 = await yukle({ ...temel(), PROTOKOL: 'h2', KIP: 'ka' });
  sahte.yanit = h2Yanit;
  assert.equal(h2.setup().sikistirma_turu, 'DINAMIK', 'h2 + butun yollar HTTP/2.0 gecer');
  // sikistirma denetim yolu (a.js) h2, ikinci yol (/app-v1/) h1
  sahte.yanit = (u) => (u.endsWith('/app-v1/') ? { status: 200, proto: 'HTTP/1.1', headers: {} } : h2Yanit());
  assert.throws(
    () => h2.setup(),
    (e) =>
      /1 yol HTTP\/2\.0 disinda yanit verdi \(ilk: \/app-v1\/ -> HTTP\/1\.1\)/.test(e.message) && /ALPN/.test(e.message) &&
      !/GODEBUG/.test(e.message),
  );
  const h1 = await yukle(temel());
  sahte.yanit = (u) => (u.endsWith('/app-v1/') ? { status: 200, proto: 'HTTP/2.0', headers: {} } : brYanit());
  assert.throws(
    () => h1.setup(),
    (e) =>
      /1 yol HTTP\/1\.1 disinda yanit verdi \(ilk: \/app-v1\/ -> HTTP\/2\.0\)/.test(e.message) &&
      /GODEBUG=http2client=0/.test(e.message) && !/ALPN/.test(e.message),
    'h1: IKINCI yolun HTTP/2.0 yaniti da reddedilir (bugun yalniz ilk yola bakiliyordu)',
  );
  // 200 denetimi once: 404 + yanlis surum -> 200 iletisi
  sahte.yanit = () => ({ status: 404, proto: 'HTTP/1.1', headers: {} });
  assert.throws(() => h2.setup(), /404/);
  sahte.yanit = brYanit;
});

test('K-H3 PROTOKOL girdisi: h1 | h2, h2 yalniz KIP=ka, yoksa h1', async () => {
  await hataVerir({ ...temel(), PROTOKOL: 'h3' }, /PROTOKOL h1 ya da h2 olmali/);
  await hataVerir({ ...temel(), PROTOKOL: 'H2', KIP: 'ka' }, /PROTOKOL h1 ya da h2 olmali/);
  await hataVerir({ ...temel(), PROTOKOL: 'h2' }, /PROTOKOL=h2 yalniz KIP=ka/, 'KIP verilmezse yeni: h2 reddedilir');
  await hataVerir({ ...temel(), PROTOKOL: 'h2', KIP: 'yeni' }, /PROTOKOL=h2 yalniz KIP=ka/);
  const varsayilan = await yukle(temel());
  assert.equal(varsayilan.ozet_hesapla({ metrics: {} }).protokol, 'h1', 'PROTOKOL yoksa h1');
  const h2 = await yukle({ ...temel(), PROTOKOL: 'h2', KIP: 'ka' });
  assert.equal(h2.options.noConnectionReuse, false, 'h2 + ka: baglanti yeniden kullanilir');
  const o = h2.ozet_hesapla({ metrics: { protokol_uyumsuz: { values: { count: 4 } }, http2_kullanildi: { values: { count: 900 } } } });
  assert.equal(o.protokol, 'h2');
  assert.equal(o.protokol_uyumsuz, 4);
  assert.equal(o.http2, 900, 'http2 kolonu HTTP/2.0 yanit sayisi (bilgi)');
  const cikti = h2.handleSummary({ metrics: { protokol_uyumsuz: { values: { count: 4 } } } });
  assert.match(cikti.stdout, / protokol=h2 {2}uyumsuz=4/, 'ozet metin satiri protokol ve uyumsuz');
  const csv = Object.entries(cikti).find(([ad]) => ad.endsWith('.csv'))[1].trim().split('\n');
  assert.ok(csv[1].endsWith(',h2,4'), `CSV son iki hucre h2,4: ${csv[1]}`);
});

// K-KD (2026-11-03, kip dogrulamasi): YALNIZ olcum yanitlarinin Content-Encoding'i sayilir (isinma / setup sayilmaz);
// br / gzip / deflate / zstd / yok / diger; yok + Content-Length < 1024 ayrica yok_1kb_alti. ozet_hesapla `kodlama`
// anahtarina yazar, CSV'de kolonu yok (32 kolon, eski Portal okuyucusu).
test('K-KD olcum yanitlarinin Content-Encoding sayaclari; JSON kodlama, CSV 32 kolon aynen', async () => {
  const m = await yukle(temel());
  const asil = sahte.yanit;
  const yanitlar = [
    { 'Content-Encoding': 'br' }, { 'Content-Encoding': 'BR ' }, { 'Content-Encoding': 'gzip' }, { 'Content-Encoding': 'deflate' },
    { 'Content-Encoding': 'zstd' }, { 'Content-Encoding': 'gzip, br' }, {}, { 'Content-Length': '1023' }, { 'Content-Length': '1024' },
  ];
  try {
    for (const h of yanitlar) {
      sahte.yanit = () => ({ status: 200, proto: 'HTTP/1.1', headers: h });
      m.olcum();
    }
    sahte.yanit = () => ({ status: 200, proto: 'HTTP/1.1', headers: { 'Content-Encoding': 'br' } });
    m.isinma();
    m.setup();
  } finally {
    sahte.yanit = asil;
  }
  const s = sahte.sayaclar;
  assert.deepEqual(
    [s.kodlama_br, s.kodlama_gzip, s.kodlama_deflate, s.kodlama_zstd, s.kodlama_yok, s.kodlama_diger, s.kodlama_yok_1kb_alti],
    [2, 1, 1, 1, 3, 1, 1],
    'yalniz olcum fazi; buyuk/kucuk harf ve bosluk normallesir; 1 KB alti yalniz Content-Length < 1024',
  );
  const metr = (ad, n) => ({ [ad]: { values: { count: n } } });
  const o = m.ozet_hesapla({ metrics: { ...metr('kodlama_br', 7), ...metr('kodlama_yok', 3), ...metr('kodlama_yok_1kb_alti', 2) } });
  assert.deepEqual(o.kodlama, { br: 7, gzip: 0, deflate: 0, zstd: 0, yok: 3, diger: 0, yok_1kb_alti: 2 });
  const cikti = m.handleSummary({ metrics: metr('kodlama_br', 7) });
  const json = JSON.parse(Object.entries(cikti).find(([ad]) => ad.endsWith('.json'))[1]);
  assert.equal(json.kodlama.br, 7, 'JSON kodlama');
  const csv = Object.entries(cikti).find(([ad]) => ad.endsWith('.csv'))[1].trim().split('\n');
  assert.equal(csv[0].split(',').length, 32, 'CSV baslik 32 kolon');
  assert.ok(!csv[0].includes('kodlama'), 'CSV kodlama kolonu yok');
});
