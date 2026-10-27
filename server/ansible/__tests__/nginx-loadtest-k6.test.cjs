// server/ansible/__tests__/nginx-loadtest-k6.test.cjs - Yuk Testi k6 betigi (aynadaki files/yuk_k6.js) mantigi.
//
// El kitinin testler/test_k6_mantik.mjs testinin node:test portu: k6 KURULU OLMADAN, sahte k6 modulleriyle
// (globalThis.__k6) betik yuklenir. Kitten gelen iddialar (init dogrulamalari, yalniz Host/Accept-Encoding/
// User-Agent basliklari, bos cookie jar, agirlikli secim, setup'ta TUM tekil yollarin 200 on kontrolu,
// sikistirma tespiti, handleSummary CSV kolonlari, dropped/5xx'in yalniz olcum fazindan okunmasi) +
// Portal farklari: User-Agent oneki UA_ONEK (varsayilan portal-yuktesti), HOST_BASLIGI ZORUNLU (GLOMO
// varsayilani yok), SNI'da hosts eslemesi HOST_BASLIGI ile.
// Gercek k6 davranisini (TLS, HTTP/1.1, esik iptali) DOGRULAMAZ; o kisim ilk kanarya kosusunda gorulur.
// YUK_K6: mutasyon kopyasi (verilmezse aynadaki betik).
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
  assert.equal(o.thresholds.http2_kullanildi[0].abortOnFail, true);
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
      'dropped,http2,bayt_istek,p95_js,p95_css,p95_html,p95_json,p95_config,p95_buyuk,sikistirma_turu,isinma_sn,sure_sn,deneme',
  );
  const s = Object.fromEntries(bas.split(',').map((k, i) => [k, satir.split(',')[i]]));
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
  await hataVerir({ ...temel(), HIZ: '451' }, /429|LIMIT_MUAF/);
  await hataVerir({ ...temel(), MAXVU: '200' }, /MAXVU/);
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
