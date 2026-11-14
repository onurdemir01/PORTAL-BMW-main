// server/nginx-loadtest/__tests__/rapor.test.cjs - Yuk Testi "Toplu rapor" (2026-11-04).
//
// SAF (gercek analiz.cjs + gorunum.cjs, DB yok):
//   RP1 sira ve satir: kosu x hiz (kosu sirasi korunur, hiz artan), kolon anahtarlari kullanicinin sirasiyla, kombo kosunun kendi
//   RP2 tekrar: olculer ortalama (p95 grup degeriyle ayni), sayaclar toplam, NIC en yuksek en buyuk, tekrar sayisi
//   RP3 eski kosu: sunucu ayari '-', olcu alanlari null (0 degil)
//   RP4 sunucu ayari: seviye / static alanlari ae'ye gore; kanit istenenin ONUNE gecer; static seviye dosya_seviye'den, kanit yoksa
//       secilen, identity 9; hazirlik.sh bu satirlari gercekten yaziyor (gercek girdi: sunucu-ayar.test.cjs SA7c)
//   RP5 gecerlilik: gecersiz adimin olculmus degeri gizlenmez, yuk doymus adim kume disi, TUR'suz kosu nedeni satiri gecersiz yapar,
//       TUR'lu neden diger hizi bozmaz
//   RP6 atlananlar: olcum_yok, hesaplanamadi (kalan kosular yazilir)
// ROUTER (gercek index.cjs; db / kimlik / gorunurluk sahte):
//   RP7 100 siniri, 400 durumlari, parametreli IN, iki sorgu
//   RP8 atlananlar: bulunamadi / on_kontrol / bitmemis; istek dusmez
//   RP9 kuyruk: sira, kosusu olmayan oge kosu_baslamadi, 409 kuyruk_yok
//   RP10 yetki: Admin olmayan okur, oturumsuz 401; ADMIN_DISI_OKUMA'da
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const analiz = require('../analiz.cjs');
const gorunum = require('../gorunum.cjs');
const rapor = require('../rapor.cjs');

function adim(kid, hiz, r, o = {}) {
  const ae = o.ae || 'br';
  const kip = o.kip || 'ka';
  return {
    id: kid * 1000 + hiz * 10 + r, kosu_id: kid, tur: `R${kid}_K_${kip}_${ae}_${hiz}_r${r}`, senaryo: 'K', kip, ae, hiz, deneme: r,
    gecerlilik: o.g || 'GECERLI', nedenler: JSON.stringify(o.nedenler || []), p50: o.p50 ?? 5, p95: o.p95 ?? 20, p99: o.p99 ?? 40, cpu_ms_istek: o.cpu ?? 1.0,
    hata_orani: o.hata ?? 0, n_429: o.n429 ?? 0, n_5xx: 0, n_istek: o.nIstek ?? 3000, dropped: 0, host_cpu_ort: o.hostCpu ?? 30, kapasite_rps: 8000,
    gercek_rps: hiz, bayt_istek: 5000, ttfb_p95: 12, tls_p95: 3, connect_p95: 1, srt_p95: 9, ham: JSON.stringify({ adim: `R${kid}`, ...(o.ham || {}) }),
  };
}
const deve = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const gorunumu = (r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k === 'nedenler' || k === 'ham' ? k : deve(k)] = k === 'nedenler' || k === 'ham' ? JSON.parse(v) : v;
  return gorunum.adimGorunumu(o, {});
};
const analizi = (r) => ({ ...r, nedenler: JSON.parse(r.nedenler), ham: JSON.parse(r.ham) });
function kosu(id, adimlar, o = {}) {
  return {
    meta: { id, etiket: `E${id}`, createdAt: '2026-11-03T20:00:00.000Z', durum: 'DONE', gecerlilik: 'GECERLI', protokol: 'h2', ...(o.meta || {}) },
    parametreler: o.parametreler ?? { ae: 'br' }, analizAdimlari: adimlar.map(analizi), gorunumAdimlari: adimlar.map(gorunumu),
    analizOzeti: o.ozet ?? null, kosuUyarilari: [], gecersizNedenleri: o.nedenler ?? [], startedAt: '2026-11-03T20:00:00.000Z', finishedAt: '2026-11-03T20:05:30.000Z',
  };
}
const kur = (kosular, a = analiz) => rapor.raporKur({ kosular, analiz: a, gorunum });

test('RP1 sira: kosu x hiz, kolon sirasi, kosunun kombosu', () => {
  const r = kur([
    kosu(7, [adim(7, 400, 1), adim(7, 100, 1), adim(7, 250, 1)]),
    kosu(3, [adim(3, 100, 1, { kip: 'yeni', ae: 'gzip' })], { parametreler: { ae: 'gzip' }, meta: { protokol: 'h1' } }),
  ]);
  assert.deepEqual(r.satirlar.map((s) => [s.kosuNo, s.hiz]), [[7, 100], [7, 250], [7, 400], [3, 100]]);
  assert.deepEqual([r.satirlar[0].protokol, r.satirlar[0].kip, r.satirlar[0].ae], ['h2', 'ka', 'br']);
  assert.deepEqual([r.satirlar[3].protokol, r.satirlar[3].kip, r.satirlar[3].ae], ['h1', 'yeni', 'gzip']);
  assert.deepEqual(Object.keys(r.satirlar[0]).slice(0, 18), ['kosuNo', 'etiket', 'hiz', 'protokol', 'kip', 'ae', 'brotliSeviye', 'gzipSeviye', 'gzipStatikSeviye',
    'gzipStatik', 'brotliStatikSeviye', 'brotliStatik', 'toplamIstek', 'p50', 'p95', 'p99', 'hostCpu', 'bantBps']);
  assert.equal(r.satirlar[0].sureSn, 330);
  assert.deepEqual(r.atlananlar, []);
});

test('RP2 tekrar: olcu ortalama, sayac toplam, NIC en yuksek en buyuk', () => {
  const ag = (x) => ({ ag: { test_alinan_bps: x, test_gonderilen_bps: x / 10, hedef: { rx_ort_bps: 1, tx_ort_bps: x, tx_max_bps: x * 2 } } });
  const adimlar = [adim(1, 100, 1, { p95: 10, p99: 30, nIstek: 1000, n429: 2, hostCpu: 20, ham: ag(1e6) }), adim(1, 100, 2, { p95: 30, p99: 50, nIstek: 3000, n429: 1, hostCpu: 40, ham: ag(3e6) })];
  const [s] = kur([kosu(1, adimlar)]).satirlar;
  const g = analiz.hizOzeti(adimlar.map(analizi)).gruplar.get(100);
  assert.equal(s.p95, g.p95, 'p95 kararVer grubuyla ayni');
  assert.deepEqual([s.p95, s.p99, s.hostCpu, s.bantBps, s.testGonderilenBps, s.nicOrtBps], [20, 40, 30, 2e6, 2e5, 2e6]);
  assert.deepEqual([s.toplamIstek, s.n429, s.nicMaxBps, s.tekrar, s.gecerliTekrar], [4000, 3, 6e6, 2, 2]);
});

test('RP3 eski kosu: sunucu ayari tire, olculmeyen null', () => {
  const [s] = kur([kosu(1, [adim(1, 100, 1)], { parametreler: { ae: 'br', hizlar: [100] } })]).satirlar;
  for (const k of ['brotliSeviye', 'gzipSeviye', 'gzipStatikSeviye', 'gzipStatik', 'brotliStatikSeviye', 'brotliStatik']) assert.equal(s[k], '-', k);
  for (const k of ['bantBps', 'testGonderilenBps', 'nicOrtBps', 'nicMaxBps', 'bellekMb', 'bellekArtisiMb', 'yukCpuBosta', 'yukBellekYuzde', 'gzUretilen', 'brUretilen', 'diskKanit']) assert.equal(s[k], null, k);
  assert.deepEqual([s.bellekKaynak, s.kipDogrulama, s.yukDoydu], [null, 'olculmedi', false]);
});

test('RP4 sunucu ayari: ae, static, kanit onceligi, static seviye kanittan', () => {
  const sa = (ae, seviye, st) => rapor.sunucuAlanlari({ ae, sunucuAyar: { seviye, static: st, dizin: '/usr/nginx/applications/a' } }, null);
  assert.deepEqual(sa('br', 4, false), { brotliSeviye: 4, gzipSeviye: '-', gzipStatikSeviye: '-', gzipStatik: false, brotliStatikSeviye: '-', brotliStatik: false, gzUretilen: null, brUretilen: null, diskKanit: null });
  const b = sa('br', 4, true);
  assert.deepEqual([b.brotliStatik, b.brotliStatikSeviye, b.gzipStatik, b.gzipStatikSeviye], [true, 4, false, '-']);
  const g = sa('gzip', 6, true);
  assert.deepEqual([g.gzipSeviye, g.brotliSeviye, g.gzipStatik, g.gzipStatikSeviye, g.brotliStatik], [6, '-', true, 6, false]);
  const i = sa('identity', null, true);
  assert.deepEqual([i.gzipSeviye, i.brotliSeviye, i.gzipStatik, i.gzipStatikSeviye], ['-', '-', true, 9]);
  const k = rapor.sunucuAlanlari({ ae: 'gzip', sunucuAyar: { seviye: 6, static: true, dizin: '/d' } },
    { sunucu_ayar: { seviye: 3, static: false, gz_uretilen: 12, br_uretilen: 0, disk_kanit: 'x'.repeat(400) } });
  assert.deepEqual([k.gzipSeviye, k.gzipStatik, k.gzipStatikSeviye, k.gzUretilen, k.brUretilen, k.diskKanit.length], [3, false, '-', 12, 0, 300]);
  // dosya_seviye secilenin ONUNE gecer (uyusmazsa satir zaten gecersiz); brotli 1 / gzip 1 sabit degerlere donmez.
  const ks = (ae, seviye, dosya) => rapor.sunucuAlanlari({ ae, sunucuAyar: { seviye, static: true, dizin: '/d' } }, { sunucu_ayar: { seviye, static: true, dosya_seviye: dosya } });
  assert.equal(ks('br', 1, 1).brotliStatikSeviye, 1);
  assert.equal(ks('gzip', 1, 1).gzipStatikSeviye, 1);
  assert.equal(ks('br', 5, 11).brotliStatikSeviye, 11);
  assert.equal(ks('identity', null, 9).gzipStatikSeviye, 9);
  assert.equal(ks('gzip', 6, null).gzipStatikSeviye, 6, 'kanitta yoksa secilen');
  assert.equal(rapor.STATIK_VARSAYILAN_SEVIYE, 9);
  assert.deepEqual(['evet', 'hayir', 'ok', null], [true, false, { durum: 'ok' }, undefined].map(rapor.diskKanitMetni));
  const betik = fs.readFileSync(path.join(__dirname, '../../ansible/bmw_portal/nginx_loadtest/files/hazirlik.sh'), 'utf8');
  assert.ok(betik.includes(`dosya_seviye="\${SEVIYE:-${rapor.STATIK_VARSAYILAN_SEVIYE}}"`), 'hazirlik.sh seviyesiz static varsayilani degisti');
  assert.ok(betik.includes('dosya_seviye\\t%s'), 'hazirlik.sh dosya_seviye yazmiyor');
  assert.ok(betik.includes('disk_kanit\\t%s'), 'hazirlik.sh disk_kanit yazmiyor');
});

test('RP5 gecerlilik: gecersiz deger gizlenmez, doymus adim disarida, kosu nedeni', () => {
  // Tek tekrar GECERSIZ: olculmus deger yazilir, gecerlilik soyler.
  let [s] = kur([kosu(1, [adim(1, 100, 1, { g: 'GECERSIZ', p95: 77, nedenler: ['kayit:log_dondu'] })])]).satirlar;
  assert.deepEqual([s.p95, s.gecerlilik, s.gecerliTekrar, s.tekrar, s.nedenler], [77, 'GECERSIZ', 0, 1, ['kayit:log_dondu']]);
  // Iki tekrardan biri GECERSIZ: ortalamaya girmez, KISMI.
  [s] = kur([kosu(1, [adim(1, 100, 1, { p95: 10 }), adim(1, 100, 2, { g: 'GECERSIZ', p95: 500 })])]).satirlar;
  assert.deepEqual([s.p95, s.gecerlilik], [10, 'KISMI']);
  // Yuk makinesi doymus adim p95 kumesine girmez; satir isaretli.
  [s] = kur([kosu(1, [adim(1, 100, 1, { p95: 10 }), adim(1, 100, 2, { g: 'DOYMA', p95: 500, nedenler: ['doyma:yuk_cpu_bosta_12'] })])]).satirlar;
  assert.deepEqual([s.p95, s.yukDoydu], [10, true]);
  // Kosu geneli neden (TUR'suz): adimlar gecerli olsa da satir GECERSIZ; TUR'lu neden tasinmaz.
  const l = kur([kosu(1, [adim(1, 100, 1), adim(1, 250, 1)], { meta: { gecerlilik: 'GECERSIZ' }, nedenler: ['sunucu_ayari_kanitsiz(seviye)'] })]).satirlar;
  assert.deepEqual(l.map((x) => x.gecerlilik), ['GECERSIZ', 'GECERSIZ']);
  assert.deepEqual(l[0].kosuNedenleri, ['sunucu_ayari_kanitsiz(seviye)']);
  const t = kur([kosu(1, [adim(1, 100, 1), adim(1, 250, 1, { g: 'GECERSIZ' })], { meta: { gecerlilik: 'GECERSIZ' }, nedenler: ['R1_K_ka_br_250_r1(kayit:log_dondu)'] })]).satirlar;
  assert.deepEqual(t.map((x) => [x.gecerlilik, x.kosuNedenleri.length]), [['GECERLI', 0], ['GECERSIZ', 0]]);
});

test('RP6 atlananlar: olcum_yok, hesaplanamadi; kalanlar yazilir', () => {
  const bozuk = { ...analiz, hizOzeti: (x) => { if (x[0].kosu_id === 2) { throw new Error('bozuk'); } return analiz.hizOzeti(x); } };
  const r = kur([kosu(1, []), kosu(2, [adim(2, 100, 1)]), kosu(3, [adim(3, 100, 1)]), kosu(4, [adim(4, 100, 1, { g: 'HATALI' })])], bozuk);
  assert.deepEqual(r.satirlar.map((s) => s.kosuNo), [3]);
  assert.deepEqual(r.atlananlar.map((a) => [a.kosuId, a.neden]), [[1, 'olcum_yok'], [2, 'hesaplanamadi'], [4, 'olcum_yok']]);
});

// ── ROUTER ─────────────────────────────────────────────────────────────
const D = { kosular: [], adimlar: [], ogeler: [], sorgular: [] };
const sifirla = () => Object.assign(D, { kosular: [], adimlar: [], ogeler: [], sorgular: [] });
sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    D.sorgular.push({ q, params });
    if (/FROM nginx_loadtest_kuyruk_ogeler WHERE kuyruk_id = \$1 ORDER BY sira ASC, id ASC$/.test(q)) { return { rows: D.ogeler.filter((o) => o.kuyruk_id === params[0]) }; }
    if (/FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s\.id = k\.senaryo_id WHERE k\.id IN \(/.test(q)) {
      assert.match(q, new RegExp(`IN \\(${params.map((_, i) => "\\$" + (i + 1)).join(', ')}\\)$`), 'IN listesi parametreli');
      return { rows: D.kosular.filter((k) => params.includes(k.id)) };
    }
    if (/^SELECT \* FROM nginx_loadtest_adimlar WHERE kosu_id IN \(/.test(q)) { return { rows: D.adimlar.filter((a) => params.includes(a.kosu_id)) }; }
    throw new Error(`beklenmeyen sorgu: ${q}`);
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ ok: false })) });
sahte('../../auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next(), requireVisible: () => (req, res, next) => next() });
sahte('../../audit/index.cjs', { auditPortal: () => {} });

const yt = require('../index.cjs');
const router = yt._yonlendiriciKurForTest();
const ADMIN = { user: { username: 'onur', role: 'Admin' } };
const KULLANICI = { user: { username: 'veli', role: 'User' } };
function istek(url, { session = ADMIN, method = 'GET' } = {}) {
  const [yol, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, body: null, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; this.headersSent = true; resolve(this); return this; },
      setHeader() {}, getHeader() {},
    };
    const req = { method, url, headers: {}, session, query, get path() { return yol; } };
    router.handle(req, res, (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }));
  });
}
function kosuSatiri(id, o = {}) {
  return {
    id, senaryo_id: 1, islem: 'kosu', etiket: `E${id}`, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', vhost: 'v', durum: 'DONE', gecerlilik: 'GECERLI', hedef_turu: 'sunucu', motor: 'k6',
    parametreler: JSON.stringify({ ae: 'br', protokol: 'h2', sunucuAyar: { seviye: 5, static: false, dizin: '/usr/nginx/applications/a' } }), created_at: new Date('2026-11-03T20:00:00Z'),
    started_at: new Date('2026-11-03T20:00:00Z'), finished_at: new Date('2026-11-03T20:01:00Z'), gecersiz_nedenleri: null,
    sonuc: JSON.stringify({ portal_analiz: { ozet: { sunucu_ayar: { seviye: 5, static: false, gz_uretilen: 0, br_uretilen: 0 } }, uyarilar: [] } }), ...o,
  };
}
function kur2(n) {
  for (let i = 1; i <= n; i += 1) {
    D.kosular.push(kosuSatiri(i));
    D.adimlar.push(adim(i, 100, 1), adim(i, 250, 1));
  }
}

test('RP7 GET /rapor: 100 siniri, 400 durumlari, iki sorgu', { timeout: 20000 }, async () => {
  sifirla();
  kur2(100);
  const liste = (n) => Array.from({ length: n }, (_, i) => i + 1).join(',');
  let r = await istek(`/rapor?kosular=${liste(100)}`);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.satirlar.length, 200);
  assert.equal(D.sorgular.length, 2, 'kosu ve adim TEK sorgu');
  assert.equal(r.body.satirlar[0].brotliSeviye, 5);
  assert.equal(r.body.satirlar[0].sureSn, 60);
  D.sorgular = [];
  r = await istek(`/rapor?kosular=${liste(101)}`);
  assert.deepEqual([r.statusCode, r.body.code, D.sorgular.length], [400, 'gecersiz_istek', 0]);
  r = await istek(`/rapor?kosular=${liste(100)},1,2,3`);
  assert.equal(r.statusCode, 200, 'tekrar eden numara sinira sayilmaz');
  D.sorgular = [];
  for (const u of ['/rapor', '/rapor?kosular=1&kuyruk=1', '/rapor?kosular=', '/rapor?kosular=abc', '/rapor?kosular=-1', '/rapor?kosular=2147483648', '/rapor?kuyruk=x', '/rapor?kuyruk=0']) {
    assert.equal((await istek(u)).statusCode, 400, u);
  }
  assert.equal(D.sorgular.length, 0, '400 DB\'ye gitmez');
});

test('RP8 atlananlar: bulunamadi, on kontrol, bitmemis; rapor dusmez', { timeout: 10000 }, async () => {
  sifirla();
  kur2(1);
  D.kosular.push(kosuSatiri(2, { islem: 'on_kontrol' }), kosuSatiri(3, { durum: 'RUNNING' }), kosuSatiri(4, { durum: 'FAILED', sonuc: null }), kosuSatiri(5, { sonuc: '{bozuk' }));
  D.adimlar.push(adim(5, 100, 1));
  const r = await istek('/rapor?kosular=5,1,2,3,4,9');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([...new Set(r.body.satirlar.map((s) => s.kosuNo))], [5, 1], 'verilen sira');
  assert.deepEqual(r.body.atlananlar.map((a) => [a.kosuId, a.neden]), [[2, 'on_kontrol'], [3, 'bitmemis'], [9, 'bulunamadi'], [4, 'olcum_yok']]);
  assert.equal(D.sorgular.at(-1).params.includes(3), false, 'bitmemis kosunun adimi okunmaz');
});

test('RP9 kuyruk: sira, kosusuz oge, 409', { timeout: 10000 }, async () => {
  sifirla();
  kur2(2);
  D.ogeler.push({ id: 1, kuyruk_id: 8, etiket: 'A2', durum: 'BITTI', kosu_id: 2 }, { id: 2, kuyruk_id: 8, etiket: 'A1', durum: 'BITTI', kosu_id: 1 }, { id: 3, kuyruk_id: 8, etiket: 'A3', durum: 'ATLANDI', kosu_id: null }, { id: 4, kuyruk_id: 8, etiket: 'A4', durum: 'BITTI', kosu_id: 44 });
  let r = await istek('/rapor?kuyruk=8');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([...new Set(r.body.satirlar.map((s) => s.kosuNo))], [2, 1]);
  assert.deepEqual(r.body.atlananlar, [{ kosuId: null, etiket: 'A3', neden: 'kosu_baslamadi', durum: 'ATLANDI' }, { kosuId: 44, etiket: 'A4', neden: 'bulunamadi', durum: null }]);
  r = await istek('/rapor?kuyruk=9');
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kuyruk_yok']);
  D.ogeler.length = 0;
  D.ogeler.push({ id: 5, kuyruk_id: 8, etiket: 'A5', durum: 'BEKLIYOR', kosu_id: null });
  r = await istek('/rapor?kuyruk=8');
  assert.deepEqual([r.statusCode, r.body.satirlar, r.body.atlananlar.length], [200, [], 1]);
});

test('RP10 yetki: Admin olmayan okur, oturumsuz 401, yazma yok', { timeout: 10000 }, async () => {
  sifirla();
  kur2(2);
  assert.ok(yt._ADMIN_DISI_OKUMA.some((re) => re.test('/rapor')));
  assert.equal((await istek('/rapor?kosular=1,2', { session: KULLANICI })).statusCode, 200);
  assert.equal((await istek('/rapor?kosular=1,2', { session: null })).statusCode, 401);
  assert.equal((await istek('/rapor?kosular=1', { session: KULLANICI, method: 'POST' })).statusCode, 403);
});
