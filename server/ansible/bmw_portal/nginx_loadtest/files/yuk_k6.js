// yuk_k6.js - Portal Nginx Hub "Yuk Testi" icin ACIK DONGU yuk testi: sabit varis hizi, her iterasyon TEK istek.
// Kaynak  : el kiti f5_rehber/har_yuk_testi/yuk_k6.js; Portal farki YALNIZ UA oneki (UA_ONEK) ve zorunlu
//           HOST_BASLIGI (varsayilan host YOK). Geri kalan her satir kitle ayni (bkz. README "Betikler").
// Amac    : nginx ayarlari arasinda istek basina CPU ve yanit suresini adil karsilastirmak (kos.sh cagirir).
// Kullanim: GODEBUG=http2client=0 k6 run -e HEDEF=https://<nginx_ip> -e HOST_BASLIGI=<vhost> -e SENARYO=<MUTLAK yol>/K.tsv \
//             -e TUR=R17_K_yeni_br_250_r1 [-e HIZ=250 -e KIP=yeni|ka -e AE=br|gzip|identity -e ISINMA=30s \
//             -e SURE=120s -e CIKTI=<dizin> -e DENEME=1 -e UA_ONEK=portal-yuktesti] yuk_k6.js
// Gonderilen basliklar YALNIZ: Host, Accept-Encoding, User-Agent (<UA_ONEK>/<TUR>/<faz>/<deneme>). Cerez
// yok: her istek bos bir cookie jar ile gider. URL her zaman HEDEF + yol; host HAR'dan alinmaz.
// DENEME: ayni TUR'un kacinci kosusu (kos.sh verir); DUR'dan sonra tekrar kosulan TUR'un eski log satirlari
// boylece karsilastir.py'de ayrilir.
// On kontrol (setup): senaryodaki HER tekil yol cerezsiz 200 donmeli; donmeyen varsa kosu baslamaz.
// Cikti   : <CIKTI>/istemci_<TUR>.json ve .csv (yalniz secilmis sayilar).
/* eslint-disable -- k6 betigi (Node degil; __ENV/open k6 globalleri). Portal aynasinda ESLint bu dosyayi denetlemez. */
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const HEDEF = (__ENV.HEDEF || '').replace(/\/+$/, '');
const HOST = __ENV.HOST_BASLIGI || '';
const UA_ONEK = __ENV.UA_ONEK || 'portal-yuktesti';
const TUR = __ENV.TUR || '';
const DENEME = __ENV.DENEME || '1';
const ADIM = __ENV.ADIM || '';
const SEN = __ENV.SEN || '';
const HIZ = Number(__ENV.HIZ || 100);
const ISINMA = __ENV.ISINMA || '30s';
const SURE = __ENV.SURE || '120s';
const KIP = __ENV.KIP || 'yeni';
const AE = __ENV.AE || 'br';
const LIMIT_MUAF = __ENV.LIMIT_MUAF === '1';
const MAXVU = Number(__ENV.MAXVU || 150);
const CIKTI = (__ENV.CIKTI || '.').replace(/[\\/]+$/, '');
const SNI = __ENV.SNI === '1';
const IP_SINIRI = 450; // rate_limits.conf: limit_req 500 r/s/IP (burst 200); pay birakildi
const AE_DEGER = { br: 'gzip, deflate, br, zstd', gzip: 'gzip', identity: 'identity' };
const YOL_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/;
const TURLER = ['js', 'css', 'html', 'json', 'config'];

function saniye(s) {
  const m = /^(\d+)(s|m)?$/.exec(String(s));
  if (!m) throw new Error('sure bicimi taninmadi: ' + s + ' (ornek 30s, 2m)');
  return Number(m[1]) * (m[2] === 'm' ? 60 : 1);
}

if (!/^https:\/\/[^\/?#\s]+$/.test(HEDEF)) throw new Error('HEDEF https://<nginx_ip> bicminde olmali (yol yok): "' + HEDEF + '"');
if (!HOST) throw new Error('HOST_BASLIGI verilmedi (-e HOST_BASLIGI=<vhost>); varsayilan host yok');
if (!/^[a-z][a-z0-9-]{2,30}$/.test(UA_ONEK)) throw new Error('UA_ONEK yalniz kucuk harf, rakam ve - (3-31 karakter): "' + UA_ONEK + '"');
if (!/^[A-Za-z0-9_-]+$/.test(TUR)) throw new Error('TUR yalniz harf, rakam, _ ve - icerebilir: "' + TUR + '"');
if (!/^[1-9][0-9]*$/.test(DENEME)) throw new Error('DENEME pozitif tam sayi olmali: "' + DENEME + '"');
if (KIP !== 'yeni' && KIP !== 'ka') throw new Error('KIP yeni ya da ka olmali');
if (!(AE in AE_DEGER)) throw new Error('AE br, gzip ya da identity olmali');
if (!(Number.isInteger(HIZ) && HIZ > 0)) throw new Error('HIZ pozitif tam sayi olmali');
if (HIZ > IP_SINIRI && !LIMIT_MUAF) {
  throw new Error('HIZ=' + HIZ + ' > ' + IP_SINIRI + ': tek IP 429 alir. Dusurun ya da limit_*_dry_run acikken -e LIMIT_MUAF=1');
}
if (!(Number.isInteger(MAXVU) && MAXVU > 0 && (MAXVU < 200 || LIMIT_MUAF))) {
  throw new Error('MAXVU 1..199 olmali (limit_conn 200/IP); daha fazlasi yalniz LIMIT_MUAF=1 ile');
}
if (!__ENV.SENARYO) throw new Error('SENARYO verilmedi (-e SENARYO=<MUTLAK yol>/K.tsv)');
const ISINMA_SN = saniye(ISINMA);
const SURE_SN = saniye(SURE);
if (SURE_SN < 30) throw new Error('SURE en az 30s olmali');

const hedefHost = HEDEF.replace(/^https:\/\//, '');
const TABAN = SNI ? 'https://' + HOST + (/:\d+$/.test(hedefHost) ? hedefHost.replace(/^.*(:\d+)$/, '$1') : '') : HEDEF;

const senaryo = new SharedArray('senaryo', function () {
  const satirlar = open(__ENV.SENARYO).split(/\r?\n/);
  const out = [];
  let top = 0;
  for (let i = 0; i < satirlar.length; i++) {
    const s = satirlar[i];
    if (!s.trim() || s.charAt(0) === '#') continue;
    const p = s.split('\t');
    if (p.length !== 5) throw new Error('SENARYO satir ' + (i + 1) + ': 5 kolon bekleniyor (har_senaryo.py ciktisi mi?)');
    const w = Number(p[0]);
    if (!(w > 0)) throw new Error('SENARYO satir ' + (i + 1) + ': agirlik pozitif sayi olmali');
    if (!YOL_RE.test(p[4])) throw new Error('SENARYO satir ' + (i + 1) + ': yol beyaz listeye uymuyor (sorgu/bosluk var mi?)');
    top += w;
    out.push({ k: top, har: p[1], tur: p[2], boyut: p[3], yol: p[4] });
  }
  if (!out.length) throw new Error('SENARYO bos');
  return out;
});
const TOPLAM_AGIRLIK = senaryo[senaryo.length - 1].k;

const http2 = new Counter('http2_kullanildi');
const d429 = new Counter('durum_429');
const d5xx = new Counter('durum_5xx');
const sikDinamik = new Counter('sikistirma_dinamik');
const sikStatik = new Counter('sikistirma_statik');
const sikYok = new Counter('sikistirma_yok');

const onVU = Math.min(MAXVU, Math.max(20, Math.ceil(HIZ / 5)));
const senaryolar = {};
if (ISINMA_SN > 0) {
  senaryolar.isinma = {
    executor: 'constant-arrival-rate', exec: 'isinma', rate: HIZ, timeUnit: '1s', duration: ISINMA_SN + 's',
    preAllocatedVUs: onVU, maxVUs: MAXVU, gracefulStop: '5s',
  };
}
senaryolar.olcum = {
  executor: 'constant-arrival-rate', exec: 'olcum', rate: HIZ, timeUnit: '1s', duration: SURE_SN + 's',
  startTime: ISINMA_SN + 's', preAllocatedVUs: onVU, maxVUs: MAXVU, gracefulStop: '10s',
};

const esikler = {
  http2_kullanildi: [{ threshold: 'count<1', abortOnFail: true }],
  // 429 HER fazda kosuyu keser (n_429 da butun fazlari sayar); dropped ve 5xx ise yalniz olcum fazindan okunur.
  durum_429: [{ threshold: 'count<1', abortOnFail: true }],
  // Asagidakiler sahte esik: alt metriklerin ozet verisinde gorunmesi icin (hic kirmizi olmaz).
  'dropped_iterations{scenario:olcum}': ['count>=0'],
  'durum_5xx{scenario:olcum}': ['count>=0'],
  'http_req_duration{scenario:olcum}': ['max>=0'],
  'http_req_waiting{scenario:olcum}': ['max>=0'],
  'http_req_tls_handshaking{scenario:olcum}': ['max>=0'],
  'http_req_connecting{scenario:olcum}': ['max>=0'],
  'http_req_failed{scenario:olcum}': ['rate>=0'],
  'http_reqs{scenario:olcum}': ['count>=0'],
  'data_received{scenario:olcum}': ['count>=0'],
  'http_req_duration{scenario:olcum,boyut:buyuk}': ['max>=0'],
};
for (let i = 0; i < TURLER.length; i++) esikler['http_req_duration{scenario:olcum,tur:' + TURLER[i] + '}'] = ['max>=0'];

export const options = {
  insecureSkipTLSVerify: true,
  noConnectionReuse: KIP === 'yeni',
  tlsVersion: { min: 'tls1.2', max: 'tls1.2' },
  discardResponseBodies: true,
  maxRedirects: 0,
  userAgent: UA_ONEK + '/' + TUR + '/setup/' + DENEME,
  setupTimeout: '180s',
  systemTags: ['status', 'method', 'proto', 'scenario', 'error', 'error_code', 'tls_version', 'expected_response'],
  summaryTrendStats: ['count', 'med', 'p(95)', 'p(99)', 'avg', 'max'],
  scenarios: senaryolar,
  thresholds: esikler,
};
if (SNI) {
  options.hosts = {};
  options.hosts[HOST] = hedefHost.replace(/:\d+$/, '');
}

function sec() {
  const r = Math.random() * TOPLAM_AGIRLIK;
  let lo = 0;
  let hi = senaryo.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (senaryo[m].k > r) hi = m;
    else lo = m + 1;
  }
  return senaryo[lo];
}

function basliklar(faz) {
  return { Host: HOST, 'Accept-Encoding': AE_DEGER[AE], 'User-Agent': UA_ONEK + '/' + TUR + '/' + faz + '/' + DENEME };
}

function istek(faz) {
  const s = sec();
  const res = http.get(TABAN + s.yol, {
    headers: basliklar(faz),
    tags: { har: s.har, tur: s.tur, boyut: s.boyut },
    jar: new http.CookieJar(),
  });
  if (res.proto && res.proto !== 'HTTP/1.1') http2.add(1);
  if (res.status === 429) d429.add(1);
  else if (res.status >= 500) d5xx.add(1);
  return res;
}

export function isinma() { istek('isinma'); }
export function olcum() { istek('olcum'); }
export default function () { istek('olcum'); }

function kontrolGet(x) {
  return http.get(TABAN + x.yol, { headers: basliklar('setup'), jar: new http.CookieJar(), tags: { har: x.har, tur: 'setup', boyut: x.boyut } });
}

export function setup() {
  let s = null;
  for (let i = 0; i < senaryo.length; i++) {
    const x = senaryo[i];
    if ((x.tur === 'js' || x.tur === 'css') && x.boyut !== 'kucuk') { s = x; break; }
  }
  if (!s) s = senaryo[0];
  const res = kontrolGet(s);
  if (res.status !== 200) {
    throw new Error('on kontrol: ' + s.yol + ' -> HTTP ' + res.status + ' (200 bekleniyordu). HEDEF ve HOST_BASLIGI dogru mu, ' +
      'sunucu cerezsiz yanit veriyor mu? (sertifika/SNI sorunu ise -e SNI=1 deneyin)');
  }
  if (res.proto && res.proto !== 'HTTP/1.1') throw new Error('on kontrol: protokol ' + res.proto + ' (HTTP/1.1 bekleniyordu). GODEBUG=http2client=0 verin.');
  // Senaryodaki BUTUN tekil yollar: hash'li bundle adlari her deploy'da degisir; HAR'dan sonra deploy olduysa
  // 404'ler hata oranina girer ve her adimi RET/GECERSIZ yapar. Kosu baslamadan durdurulur.
  const goruldu = {};
  goruldu[s.yol] = true;
  const hatali = [];
  let n = 1;
  for (let i = 0; i < senaryo.length; i++) {
    const x = senaryo[i];
    if (goruldu[x.yol]) continue;
    goruldu[x.yol] = true;
    n++;
    const r = kontrolGet(x);
    if (r.status !== 200) hatali.push(x.yol + ' -> HTTP ' + r.status);
  }
  if (hatali.length) {
    throw new Error('on kontrol: ' + hatali.length + '/' + n + ' yol 200 donmedi (ilk 5: ' + hatali.slice(0, 5).join(', ') +
      '). HAR alindiktan sonra deploy olmus olabilir: HAR\'lari yenileyip senaryoyu yeniden uretin ya da bu satirlari ' +
      'senaryo dosyasindan silin (butun adimlarda AYNI senaryo kullanilmali).');
  }
  const ce = String(res.headers['Content-Encoding'] || '').toLowerCase();
  const cl = res.headers['Content-Length'];
  let tur = 'YOK';
  if (ce) tur = cl ? 'STATIK' : 'DINAMIK';
  if (tur === 'DINAMIK') sikDinamik.add(1);
  else if (tur === 'STATIK') sikStatik.add(1);
  else sikYok.add(1);
  return { sikistirma_turu: tur, kontrol_turu: s.tur, kontrol_ce: ce || '-' };
}

const KOLONLAR = ['tur', 'adim', 'senaryo', 'kip', 'ae', 'hiz', 'n_olcum', 'rps_gercek', 'p50', 'p95', 'p99', 'ttfb_p95', 'tls_p95',
  'connect_p95', 'hata_orani', 'n_429', 'n_5xx', 'dropped', 'http2', 'bayt_istek', 'p95_js', 'p95_css', 'p95_html',
  'p95_json', 'p95_config', 'p95_buyuk', 'sikistirma_turu', 'isinma_sn', 'sure_sn', 'deneme'];

export function ozet_hesapla(data) {
  const m = data.metrics || {};
  const deger = function (ad, k) {
    const x = m[ad];
    if (!x || !x.values) return null;
    const v = x.values[k];
    return (v === undefined || v === null || Number.isNaN(v)) ? null : v;
  };
  const trend = function (ad, k) {
    const c = deger(ad, 'count');
    if (c === 0) return null;
    return deger(ad, k);
  };
  const n = deger('http_reqs{scenario:olcum}', 'count') || 0;
  const bayt = deger('data_received{scenario:olcum}', 'count');
  let sik = '';
  if (data.setup_data && data.setup_data.sikistirma_turu) sik = data.setup_data.sikistirma_turu;
  else if (deger('sikistirma_statik', 'count')) sik = 'STATIK';
  else if (deger('sikistirma_dinamik', 'count')) sik = 'DINAMIK';
  else if (deger('sikistirma_yok', 'count')) sik = 'YOK';
  const o = {
    tur: TUR, adim: ADIM, senaryo: SEN, kip: KIP, ae: AE, hiz: HIZ, n_olcum: n, rps_gercek: n / SURE_SN,
    p50: trend('http_req_duration{scenario:olcum}', 'med'),
    p95: trend('http_req_duration{scenario:olcum}', 'p(95)'),
    p99: trend('http_req_duration{scenario:olcum}', 'p(99)'),
    ttfb_p95: trend('http_req_waiting{scenario:olcum}', 'p(95)'),
    tls_p95: trend('http_req_tls_handshaking{scenario:olcum}', 'p(95)'),
    connect_p95: trend('http_req_connecting{scenario:olcum}', 'p(95)'),
    hata_orani: deger('http_req_failed{scenario:olcum}', 'rate'),
    n_429: deger('durum_429', 'count') || 0,
    n_5xx: deger('durum_5xx{scenario:olcum}', 'count') || 0,
    dropped: deger('dropped_iterations{scenario:olcum}', 'count') || 0,
    http2: deger('http2_kullanildi', 'count') || 0,
    bayt_istek: (n && bayt !== null) ? bayt / n : null,
    p95_buyuk: trend('http_req_duration{scenario:olcum,boyut:buyuk}', 'p(95)'),
    sikistirma_turu: sik, isinma_sn: ISINMA_SN, sure_sn: SURE_SN, deneme: Number(DENEME),
  };
  for (let i = 0; i < TURLER.length; i++) o['p95_' + TURLER[i]] = trend('http_req_duration{scenario:olcum,tur:' + TURLER[i] + '}', 'p(95)');
  return o;
}

function hucre(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v).replace(/[,\r\n]/g, ' ');
}

export function handleSummary(data) {
  const o = ozet_hesapla(data);
  const csv = KOLONLAR.join(',') + '\n' + KOLONLAR.map(function (k) { return hucre(o[k]); }).join(',') + '\n';
  const metin = [
    '', '== ' + TUR + '  (' + HIZ + ' istek/sn, kip=' + KIP + ', ae=' + AE + ', sikistirma=' + (o.sikistirma_turu || '?') + ')',
    '   olcum istek=' + o.n_olcum + '  gercek=' + hucre(o.rps_gercek) + '/sn  p50=' + hucre(o.p50) + '  p95=' + hucre(o.p95) +
      '  p99=' + hucre(o.p99) + ' ms  ttfb_p95=' + hucre(o.ttfb_p95) + '  tls_p95=' + hucre(o.tls_p95),
    '   hata=' + hucre(o.hata_orani) + '  429=' + o.n_429 + '  5xx=' + o.n_5xx + '  dropped=' + o.dropped + '  http2=' + o.http2 +
      '  bayt/istek=' + hucre(o.bayt_istek),
    '   yazildi: ' + CIKTI + '/istemci_' + TUR + '.csv', '',
  ].join('\n');
  const out = { stdout: metin };
  out[CIKTI + '/istemci_' + TUR + '.json'] = JSON.stringify(o, null, 2) + '\n';
  out[CIKTI + '/istemci_' + TUR + '.csv'] = csv;
  return out;
}
