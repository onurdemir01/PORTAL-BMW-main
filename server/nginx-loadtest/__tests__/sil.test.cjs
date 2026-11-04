// server/nginx-loadtest/__tests__/sil.test.cjs - Yuk Testi kosu sonucu silme (2026-11-04).
//
// SAF (sil.cjs):
//   SL1 SQL: parametreli IN listesi (sayi gomulmez), XACT_ABORT + BEGIN TRAN / COMMIT, UPDLOCK + HOLDLOCK, "hepsi ya da hic"
//       (IF COUNT = $n+1), adimlar kosulardan ONCE; engel kodlari ve sirasi; onay metni
// ROUTER (gercek index.cjs; db / kimlik / gorunurluk / denetim sahte). Sahte DB "SQL'e duyarli": islem sorgusundaki her
// kosul YALNIZ SQL metninde varsa uygulanir (SQL'den bir kosul silinirse davranis testi de kirmiziya doner).
//   SL2 yetki: baslatan kisi (Admin olmasa da) kendi kosusunu siler; baskasininkini 403 (hicbir sey silinmez, denetim
//       'fail'); Admin herkesinkini; Admin olmayan icin kapi YALNIZ iki silme ucunu acar
//   SL3 suren (QUEUED / RUNNING / FINALIZING) ve kilidi tutulan kosu 409; kilit bitince silinir
//   SL4 gece kuyrugu: BEKLIYOR / CALISIYOR ogeye bagli (kosu ya da on kontrol) ve DINLENME 409 "once kuyruktan cikarin";
//       bitmis ogenin kosusu silinir, oge satiri ve numarasi kalir, kuyruk ayrintisi kosuSilindi gosterir
//   SL5 toplu: atomik (bir kayit silinemezse HIC biri silinmez, nedenler listelenir), eszamanli baslama (okuma ile
//       islem arasinda), on kontrol + kosusu birlikte, tekrar / 50 siniri
//   SL6 onay metni: tekli kosu numarasi ("#12" de), toplu secilen sayi; yanlissa 400 ve DB'ye gidilmez
//   SL7 bagli tablolar: yalniz silinen kosularin adimlari gider; denetim kaydi (kim / hangi kosular / hedef / etiket)
//   SL8 404 (tekli), toplu bulunamayan 409, DB okuma / islem hatasi 424
// -- inceleme 2026-11-04 --
//   SL9 kapi yontem + yol birlikte: Admin olmayana PATCH /kosular/:id ve GET /kosular/sil 403 (DB yok)
//   SL10 gorunurluk motoru yuklenemezse silme istisnasi KAPALI: Admin olmayanin kendi kaydi da 403 (DB yok); Admin siler
//   SL11 INT ustu (sayi) numara 400, DB yok
//   SL12 silme islemi yeniden denenmez ({ tekrar: false }); denetim: 403 / 409 / 424 yazilir, 400 / 404 yazilmaz (belge)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const sil = require('../sil.cjs');

// -- SAF --------------------------------------------------------------------------------
test('SL1 SQL bicimi, engel kodlari, onay metni', () => {
  const tx = sil.silmeSql(3);
  assert.match(tx, /^SET XACT_ABORT ON;\s*BEGIN TRAN;/);
  assert.match(tx, /COMMIT;$/);
  assert.match(tx, /FROM nginx_loadtest_kosular k WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(tx, /k\.id IN \(\$1, \$2, \$3\)/);
  assert.match(tx, /IF \(SELECT COUNT\(1\) FROM @sil\) = \$4/);
  assert.ok(tx.indexOf('DELETE FROM nginx_loadtest_adimlar') < tx.indexOf('DELETE FROM nginx_loadtest_kosular'), 'adimlar kosulardan once');
  assert.match(tx, /OUTPUT DELETED\.id/);
  assert.ok(!/\b\d{2,}\b/.test(tx.replace(/DATEADD\(HOUR, -12/, '')), 'kosu numarasi SQL metnine gomulmez');
  // Islem icinde de (okuma adimindaki engellerden bagimsiz) yalniz kosu / on kontrol satiri secilir.
  assert.match(tx, /WHERE k\.id IN \(\$1, \$2, \$3\) AND k\.islem IN \('kosu', 'on_kontrol'\) AND k\.durum NOT IN \('QUEUED', 'RUNNING', 'FINALIZING'\)/);
  assert.match(sil.okumaSql(2), /WHERE k\.id IN \(\$1, \$2\)$/);
  assert.equal(sil.MAX_TOPLU, 50);
  // Engeller: istenen sirayla, tek neden (en agir).
  const rows = [
    { id: 1, islem: 'kosu', durum: 'RUNNING', kilitli: 1 },
    { id: 2, islem: 'kosu', durum: 'CANCELED', kilitli: 1 },
    { id: 3, islem: 'kosu', durum: 'DONE', kilitli: 0, kuyruk_oge: 7 },
    { id: 4, islem: 'kosu', durum: 'DONE', kilitli: 0, kuyruk_dinlenme: 8 },
    { id: 5, islem: 'on_kontrol', durum: 'DONE', kilitli: 0, bagli_kosu: 6 },
    { id: 9, islem: 'kosu', durum: 'DONE', kilitli: 0 },
  ];
  const e = sil.engeller([5, 4, 3, 2, 1, 9, 77], rows);
  assert.deepEqual(e.map((x) => [x.id, x.kod]), [[5, 'on_kontrol_bagli'], [4, 'kuyruga_bagli'], [3, 'kuyruga_bagli'], [2, 'kosu_kilitli'], [1, 'kosu_suruyor'], [77, 'kosu_yok']]);
  assert.match(e[2].metin, /önce kuyruktan çıkarın/);
  assert.equal(e[2].kuyrukId, 7);
  assert.equal(e[0].bagliKosuId, 6);
  assert.deepEqual(sil.engeller([9], rows), []);
  // Onay
  assert.ok(sil.onayDogru('12', 12) && sil.onayDogru(' #12 ', 12));
  for (const x of ['13', '', null, 12, '012', '# 12']) assert.equal(sil.onayDogru(x, 12), false, JSON.stringify(x));
  assert.equal(sil.denetimMetni({ id: 3, islem: 'kosu', hedef_host: '', hedef_ip: '10.0.0.9', etiket: 'A1' }), '#3 kosu 10.0.0.9 A1');
});

// -- ROUTER -----------------------------------------------------------------------------
const SAAT = 3600 * 1000;
const D = { kosular: [], adimlar: [], kilitler: [], ogeler: [], kuyruklar: [], sorgular: [], denetim: [], dbHata: null, txHata: null, txOncesi: null, txBos: false };
function sifirla() {
  Object.assign(D, { kosular: [], adimlar: [], kilitler: [], ogeler: [], kuyruklar: [], sorgular: [], denetim: [], dbHata: null, txHata: null, txOncesi: null, txBos: false });
}
/** SQL'e duyarli kosul: parca SQL'de YOKSA kosul uygulanmaz (true). */
const varsa = (q, parca, fn) => (q.includes(parca) ? fn() : true);
function bayraklar(q, k, ids) {
  const simdi = Date.now();
  const kilitli = varsa(q, 'l.held = 1', () => true) && !!k.kilit_id && D.kilitler.some((l) => l.lock_id === k.kilit_id && l.held === 1 && l.locked_until != null
    && l.locked_until.getTime() >= simdi - 12 * SAAT && (l.locked_until.getTime() >= simdi || l.awx_job_id != null));
  const oge = q.includes("o.durum IN ('BEKLIYOR', 'CALISIYOR')")
    ? D.ogeler.find((o) => (o.kosu_id === k.id || o.on_kontrol_kosu_id === k.id) && ['BEKLIYOR', 'CALISIYOR'].includes(o.durum)) : null;
  const dinlenme = q.includes("q.durum = 'DINLENME'") ? D.kuyruklar.find((x) => x.dinlenme_kosu_id === k.id && x.durum === 'DINLENME') : null;
  const bagli = q.includes('k2.on_kontrol_kosu_id = k.id') && k.islem === 'on_kontrol' ? D.kosular.find((x) => x.on_kontrol_kosu_id === k.id && varsa(q, 'AND k2.id NOT IN (', () => !ids.includes(x.id))) : null;
  return { kilitli: kilitli && q.includes('l.held = 1') ? 1 : 0, kuyruk_oge: oge ? oge.kuyruk_id : null, kuyruk_dinlenme: dinlenme ? dinlenme.id : null, bagli_kosu: bagli ? bagli.id : null };
}
const yerKontrol = (q, ids) => {
  const m = /k\.id IN \((\$\d+(?:, \$\d+)*)\)/.exec(q);
  assert.ok(m, 'IN listesi yok');
  assert.deepEqual(m[1].split(', ').map((x) => Number(x.slice(1))), ids.map((_, i) => i + 1), 'IN listesi $1..$n olmali');
};
sahte('../../db/index.cjs', {
  query: async (sql, params = [], opts) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    D.sorgular.push({ q, params, opts });
    if (q.includes('/*SIL:oku*/')) {
      if (D.dbHata) throw D.dbHata;
      const ids = params;
      yerKontrol(q, ids);
      const rows = D.kosular.filter((k) => ids.includes(k.id)).map((k) => ({ ...k, ...bayraklar(q, k, ids) }));
      if (D.txOncesi) { const f = D.txOncesi; D.txOncesi = null; f(); }
      return { rows };
    }
    if (q.includes('/*SIL:tx*/')) {
      if (D.txHata) throw D.txHata;
      if (D.txBos) return { rows: [] };
      assert.match(q, /^SET XACT_ABORT ON; BEGIN TRAN;/);
      const ids = params.slice(0, -1);
      const beklenen = params.at(-1);
      yerKontrol(q, ids);
      const uygun = D.kosular.filter((k) => ids.includes(k.id)
        && varsa(q, "k.islem IN ('kosu', 'on_kontrol')", () => ['kosu', 'on_kontrol'].includes(k.islem))
        && varsa(q, "k.durum NOT IN ('QUEUED', 'RUNNING', 'FINALIZING')", () => !['QUEUED', 'RUNNING', 'FINALIZING'].includes(k.durum))).filter((k) => {
        const b = bayraklar(q, k, ids);
        return !b.kilitli && b.kuyruk_oge == null && b.kuyruk_dinlenme == null && b.bagli_kosu == null;
      });
      const atomik = /IF \(SELECT COUNT\(1\) FROM @sil\) = \$\d+/.test(q);
      if (atomik && uygun.length !== beklenen) return { rows: [] };
      const silId = new Set(uygun.map((k) => k.id));
      if (q.includes('DELETE FROM nginx_loadtest_adimlar WHERE kosu_id IN (SELECT id FROM @sil)')) D.adimlar = D.adimlar.filter((a) => !silId.has(a.kosu_id));
      D.kosular = D.kosular.filter((k) => !silId.has(k.id));
      return { rows: uygun.map((k) => ({ id: k.id, islem: k.islem, etiket: k.etiket, hedef_host: k.hedef_host, hedef_ip: k.hedef_ip, hedef_turu: k.hedef_turu })) };
    }
    if (q.includes('/*SIL:mevcut*/')) return { rows: D.kosular.filter((k) => params.includes(k.id)).map((k) => ({ id: k.id })) };
    if (q.includes('/*KQ:kuyrukOku*/')) return { rows: D.kuyruklar.filter((x) => x.id === params[0]).map((x) => ({ bekleme_dk: 5, onay_hedefi: 'GBNGXT33', hedef_turu: 'sunucu', ...x })) };
    if (q.includes('/*KQ:ogeListe*/')) return { rows: D.ogeler.filter((o) => o.kuyruk_id === params[0]).map((o, i) => ({ sira: i + 1, etiket: `A${i + 1}`, govde: '{}', ...o })) };
    throw new Error(`beklenmeyen sorgu: ${q.slice(0, 120)}`);
  },
});
sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ ok: false })) });
sahte('../../auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next(), requireVisible: () => (req, res, next) => next() });
sahte('../../audit/index.cjs', { auditPortal: (req, eylem, o) => D.denetim.push({ eylem, kim: req.session && req.session.user && req.session.user.username, ...o }) });

const yt = require('../index.cjs');
const router = yt._yonlendiriciKurForTest();
const ADMIN = { user: { username: 'onur', role: 'Admin' } };
const VELI = { user: { username: 'veli', role: 'User' } };
function istek(method, url, { session = ADMIN, body } = {}) {
  const [yol, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, body: null, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; this.headersSent = true; resolve(this); return this; },
      setHeader() {}, getHeader() {},
    };
    const req = { method, url, headers: {}, session, body, query, get path() { return yol; } };
    router.handle(req, res, (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }));
  });
}
function kosuEkle(id, o = {}) {
  D.kosular.push({ id, islem: 'kosu', durum: 'DONE', etiket: `E${id}`, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', hedef_turu: 'sunucu', created_by: 'onur', kilit_id: `L${id}`, on_kontrol_kosu_id: null, ...o });
  D.adimlar.push({ id: id * 10 + 1, kosu_id: id }, { id: id * 10 + 2, kosu_id: id });
}
const ids = () => D.kosular.map((k) => k.id).sort((a, b) => a - b);
const tekli = (id, o = {}) => istek('DELETE', `/kosular/${id}`, { body: { confirmText: String(id) }, ...o });
const toplu = (liste, o = {}) => istek('POST', '/kosular/sil', { body: { kosular: liste, confirmText: String(liste.length) }, ...o });

test('SL2 yetki: baslatan kisi ya da Admin; baskasinin kosusu 403; kapi yalniz silme uclarini acar', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(1, { created_by: 'veli' });
  kosuEkle(2, { created_by: 'onur' });
  kosuEkle(3, { created_by: 'VELI ' });
  // Admin olmayan, baskasinin kosusu: 403, hicbir sey silinmez, denetim 'fail'.
  let r = await tekli(2, { session: VELI });
  assert.deepEqual([r.statusCode, r.body.code], [403, 'yetki_yok'], JSON.stringify(r.body));
  assert.match(r.body.message, /Yalnız koşuyu başlatan kişi ya da Admin/);
  assert.deepEqual(ids(), [1, 2, 3]);
  assert.equal(D.sorgular.filter((s) => s.q.includes('/*SIL:tx*/')).length, 0, 'islem calismaz');
  assert.deepEqual([D.denetim.at(-1).eylem, D.denetim.at(-1).result, D.denetim.at(-1).kim], ['nginx_loadtest_kosu_sil', 'fail', 'veli']);
  // Toplu karisik (kendi + baskasinin): 403, kendisininki de SILINMEZ.
  r = await toplu([1, 2], { session: VELI });
  assert.deepEqual([r.statusCode, r.body.yetkisiz], [403, [2]]);
  assert.deepEqual(ids(), [1, 2, 3]);
  // Kendi kosusu (Admin degil; ad buyuk / kucuk harf ve bosluk duyarsiz): silinir.
  r = await toplu([1, 3], { session: VELI });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(ids(), [2]);
  // Admin baskasinin kosusunu da siler.
  kosuEkle(4, { created_by: 'ayse' });
  r = await tekli(4);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(ids(), [2]);
  // Kapi dar: Admin olmayan icin baska yazan uclar hala 403 (DB'ye gidilmez).
  D.sorgular = [];
  for (const [m, u] of [['DELETE', '/senaryolar/1'], ['POST', '/kosular/2/durdur'], ['PUT', '/kosular/2/etiket'], ['POST', '/kosular/sil/x'], ['DELETE', '/kosular/2/x']]) {
    const x = await istek(m, u, { session: VELI, body: { confirmText: '2', kosular: [2] } });
    assert.equal(x.statusCode, 403, `${m} ${u}: ${JSON.stringify(x.body)}`);
  }
  assert.equal(D.sorgular.length, 0);
  assert.equal((await tekli(2, { session: null })).statusCode, 401);
  assert.deepEqual(ids(), [2]);
});

test('SL3 suren ve kilitli kosu 409; kilit bitince silinir', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(1, { durum: 'RUNNING' });
  kosuEkle(2, { durum: 'FINALIZING' });
  kosuEkle(3, { durum: 'QUEUED' });
  kosuEkle(4, { durum: 'CANCELED' });
  kosuEkle(5, { durum: 'FAILED', islem: 'on_kontrol' });
  D.kilitler.push({ lock_id: 'L4', held: 1, locked_until: new Date(Date.now() + SAAT), awx_job_id: null });
  for (const id of [1, 2, 3]) {
    const r = await tekli(id);
    assert.deepEqual([r.statusCode, r.body.code], [409, 'kosu_suruyor'], `${id}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.message, /bitmeden silinemez/);
    assert.deepEqual(r.body.silinemeyenler.map((x) => x.id), [id]);
  }
  let r = await tekli(4);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kosu_kilitli']);
  assert.equal(D.denetim.at(-1).result, 'fail', '409 ret denetime yazilir');
  // Suresi dolmus ve ise bagli olmayan kilit artik engel degil.
  D.kilitler[0].locked_until = new Date(Date.now() - 60 * 1000);
  r = await tekli(4);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  // Suresi dolmus ama ise bagli (12 saatten taze) kilit hala tutuluyor (kuyruk.cjs kilitTutuluyor kurali).
  D.kilitler.push({ lock_id: 'L5', held: 1, locked_until: new Date(Date.now() - SAAT), awx_job_id: 99 });
  r = await tekli(5);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kosu_kilitli']);
  D.kilitler[1].held = 0;
  assert.equal((await tekli(5)).statusCode, 200);
  assert.deepEqual(ids(), [1, 2, 3]);
});

test('SL4 gece kuyrugu: bekleyen / calisan / dinlenen 409; bitmis ogenin kosusu silinir, oge kalir, silindi gosterilir', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(10, { islem: 'on_kontrol' });
  kosuEkle(11, { on_kontrol_kosu_id: 10 });
  kosuEkle(12);
  kosuEkle(13);
  kosuEkle(14, { islem: 'on_kontrol' });
  D.kuyruklar.push({ id: 3, durum: 'CALISIYOR', dinlenme_kosu_id: null }, { id: 4, durum: 'DINLENME', dinlenme_kosu_id: 13 });
  D.ogeler.push(
    { id: 1, kuyruk_id: 3, durum: 'BITTI', kosu_id: 12, on_kontrol_kosu_id: null },
    { id: 2, kuyruk_id: 3, durum: 'CALISIYOR', kosu_id: 11, on_kontrol_kosu_id: 10 },
    { id: 3, kuyruk_id: 3, durum: 'BEKLIYOR', kosu_id: null, on_kontrol_kosu_id: 14 },
  );
  let r = await tekli(11);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kuyruga_bagli'], JSON.stringify(r.body));
  assert.match(r.body.message, /K3 .*önce kuyruktan çıkarın/);
  assert.equal(r.body.silinemeyenler[0].kuyrukId, 3);
  r = await tekli(14);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kuyruga_bagli'], 'bekleyen ogenin on kontrolu');
  r = await tekli(13);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kuyruga_bagli']);
  assert.match(r.body.message, /K4 bu koşudan sonra dinleniyor/);
  // Bitmis oge: kosu silinir; oge satiri ve kosu numarasi KALIR (NULL'lanmaz).
  r = await tekli(12);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(D.ogeler.find((o) => o.id === 1), { id: 1, kuyruk_id: 3, durum: 'BITTI', kosu_id: 12, on_kontrol_kosu_id: null });
  assert.ok(!D.sorgular.some((s) => /UPDATE nginx_loadtest_kuyruk/.test(s.q)), 'kuyruk tablolarina yazilmaz');
  // Kuyruk ayrintisi: silinen kosu "silindi"; duranlar degil.
  r = await istek('GET', '/kuyruklar/3', { session: VELI });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const o = (id) => r.body.ogeler.find((x) => x.id === id);
  assert.deepEqual([o(1).kosuId, o(1).kosuSilindi, o(1).onKontrolSilindi], [12, true, false]);
  assert.deepEqual([o(2).kosuSilindi, o(2).onKontrolSilindi], [false, false]);
  // Kuyruk bittikten sonra (oge BITTI, kuyruk dinlenmiyor) silinebilir.
  D.ogeler[1].durum = 'BITTI';
  D.kuyruklar[1].durum = 'BITTI';
  r = await toplu([10, 11, 13]);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(ids(), [14]);
});

test('SL5 toplu: atomik (hepsi ya da hic), eszamanli baslama, on kontrol + kosusu, sinirlar', { timeout: 10000 }, async () => {
  sifirla();
  for (const id of [1, 2, 3, 4]) kosuEkle(id);
  D.kosular[2].durum = 'RUNNING';
  let r = await toplu([1, 2, 3]);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'silinemez'], JSON.stringify(r.body));
  assert.deepEqual(r.body.silinemeyenler.map((x) => [x.id, x.kod]), [[3, 'kosu_suruyor']]);
  assert.match(r.body.message, /hiçbir kayıt silinmedi/);
  assert.deepEqual(ids(), [1, 2, 3, 4]);
  assert.equal(D.adimlar.length, 8);
  // Okuma ile islem arasinda bir kayit baslar: islem kosulu tutmaz, HICBIR sey silinmez; neden yeniden okunur.
  D.kosular[2].durum = 'DONE';
  D.txOncesi = () => { D.kosular[1].durum = 'RUNNING'; };
  r = await toplu([1, 2, 3]);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'silinemez'], JSON.stringify(r.body));
  assert.deepEqual(r.body.silinemeyenler.map((x) => [x.id, x.kod]), [[2, 'kosu_suruyor']]);
  assert.deepEqual(ids(), [1, 2, 3, 4]);
  assert.equal(D.adimlar.length, 8);
  // On kontrol ve ona dayanan kosu: tek basina on kontrol 409, birlikte 200.
  kosuEkle(20, { islem: 'on_kontrol' });
  kosuEkle(21, { on_kontrol_kosu_id: 20 });
  r = await tekli(20);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'on_kontrol_bagli']);
  assert.match(r.body.message, /koşu #21 var/);
  r = await toplu([21, 20]);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.silinen.map((x) => x.id), [21, 20], 'istek sirasiyla');
  // Sinirlar: tekrar, 50, bos, gecersiz numara -> 400, DB'ye gidilmez.
  D.sorgular = [];
  for (const kosular of [[1, 1], Array.from({ length: 51 }, (_, i) => i + 1), [], [0], [-1], [1.5], ['abc'], 'x', null]) {
    const x = await istek('POST', '/kosular/sil', { body: { kosular, confirmText: String(Array.isArray(kosular) ? kosular.length : 0) } });
    assert.deepEqual([x.statusCode, x.body.code], [400, 'gecersiz_istek'], JSON.stringify(kosular));
  }
  assert.equal(D.sorgular.length, 0);
  // 50 kayit gecer.
  for (let id = 100; id < 150; id += 1) kosuEkle(id);
  r = await toplu(Array.from({ length: 50 }, (_, i) => 100 + i));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.sayi, 50);
});

test('SL6 onay metni: tekli kosu numarasi, toplu secilen sayi; yanlis 400, DB yok', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(12);
  kosuEkle(13);
  kosuEkle(14);
  for (const confirmText of ['13', '', ' ', 'on iki', undefined, 12, '#13']) {
    const r = await istek('DELETE', '/kosular/12', { body: confirmText === undefined ? {} : { confirmText } });
    assert.deepEqual([r.statusCode, r.body.code], [400, 'onay_metni'], JSON.stringify(confirmText));
    assert.match(r.body.message, /koşu numarasını \(12\)/);
  }
  for (const confirmText of ['3', '#2', '13,14', '', 'iki', 2]) {
    const r = await istek('POST', '/kosular/sil', { body: { kosular: [13, 14], confirmText } });
    assert.deepEqual([r.statusCode, r.body.code], [400, 'onay_metni'], JSON.stringify(confirmText));
  }
  assert.equal(D.sorgular.length, 0, 'onay metni DB okunmadan denetlenir');
  assert.equal((await istek('DELETE', '/kosular/abc', { body: { confirmText: 'abc' } })).statusCode, 400);
  assert.deepEqual(ids(), [12, 13, 14]);
  assert.equal((await istek('DELETE', '/kosular/12', { body: { confirmText: ' #12 ' } })).statusCode, 200);
  assert.equal((await istek('POST', '/kosular/sil', { body: { kosular: ['13', 14], confirmText: ' 2 ' } })).statusCode, 200);
  assert.deepEqual(ids(), []);
});

test('SL7 bagli tablolar temizlenir (yalniz silinenler); denetim kaydi', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(1, { etiket: '[K3] A1 temel' });
  kosuEkle(2, { hedef_host: '', hedef_ip: '10.9.9.9', hedef_turu: 'serbest', etiket: null });
  kosuEkle(3);
  const r = await toplu([2, 1]);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.silinen, [
    { id: 2, islem: 'kosu', etiket: null, hedefHost: null, hedefIp: '10.9.9.9', hedefTuru: 'serbest' },
    { id: 1, islem: 'kosu', etiket: '[K3] A1 temel', hedefHost: 'GBNGXT33', hedefIp: '10.0.0.9', hedefTuru: 'sunucu' },
  ]);
  assert.deepEqual(D.adimlar.map((a) => a.kosu_id), [3, 3], 'yalniz silinen kosularin adimlari gider');
  const tx = D.sorgular.find((s) => s.q.includes('/*SIL:tx*/'));
  assert.deepEqual(tx.params, [2, 1, 2], 'numaralar + beklenen sayi parametre');
  const d = D.denetim.at(-1);
  assert.deepEqual([d.eylem, d.kim, d.result, d.targetHost, d.targetIp], ['nginx_loadtest_kosu_sil', 'onur', undefined, null, null]);
  assert.deepEqual(JSON.parse(d.detail), { toplu: true, sayi: 2, kosuIdleri: [2, 1], kosular: ['#2 kosu 10.9.9.9', '#1 kosu GBNGXT33 [K3] A1 temel'] });
  // Tekli: tek hedef -> targetHost / targetIp dolu.
  assert.equal((await tekli(3)).statusCode, 200);
  const t = D.denetim.at(-1);
  assert.deepEqual([t.targetHost, t.targetIp, JSON.parse(t.detail).toplu], ['GBNGXT33', '10.0.0.9', false]);
  assert.deepEqual(D.adimlar, []);
});

test('SL8 404 tekli, toplu bulunamayan 409, DB hatasi 424', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(1);
  let r = await tekli(77);
  assert.deepEqual([r.statusCode, r.body.code], [404, 'kosu_yok']);
  assert.match(r.body.message, /silinmiş olabilir/);
  r = await toplu([1, 77]);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'silinemez']);
  assert.deepEqual(r.body.silinemeyenler.map((x) => [x.id, x.kod]), [[77, 'kosu_yok']]);
  assert.deepEqual(ids(), [1]);
  D.dbHata = new Error('baglanti yok');
  r = await tekli(1);
  assert.deepEqual([r.statusCode, r.body.code], [424, 'db_okunamadi']);
  D.dbHata = null;
  D.txHata = new Error('deadlock victim');
  r = await tekli(1);
  assert.deepEqual([r.statusCode, r.body.code], [424, 'db_okunamadi']);
  assert.match(r.body.message, /tamamlanmadıysa hiçbir kayıt silinmez/);
  assert.deepEqual(ids(), [1]);
  D.txHata = null;
  // Islem kosulu tutmadi (o anlik), yeniden okumada neden yok: 409 eszamanli_degisti, hicbir sey silinmez.
  D.txBos = true;
  r = await tekli(1);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'eszamanli_degisti'], JSON.stringify(r.body));
  assert.deepEqual(ids(), [1]);
});

test('SL9 kapi yontem ve yolu birlikte esler: Admin olmayana PATCH /kosular/:id ve GET /kosular/sil 403', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(5, { created_by: 'veli' });
  for (const [m, u] of [['PATCH', '/kosular/5'], ['GET', '/kosular/sil'], ['PUT', '/kosular/5'], ['POST', '/kosular/5'], ['DELETE', '/kosular/sil']]) {
    const x = await istek(m, u, { session: VELI, body: { confirmText: '5', kosular: [5] } });
    assert.equal(x.statusCode, 403, `${m} ${u}: ${JSON.stringify(x.body)}`);
  }
  assert.equal(D.sorgular.length, 0);
  assert.deepEqual(ids(), [5]);
});

test('SL10 gorunurluk motoru yuklenemezse silme istisnasi kapali (Admin olmayan 403, DB yok); Admin siler', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(6, { created_by: 'veli' });
  kosuEkle(7, { created_by: 'veli' });
  const p = Module._resolveFilename(path.join(__dirname, '../../auth/visibility.cjs'), module);
  const onceki = require.cache[p];
  require.cache[p] = { id: p, filename: p, loaded: true, exports: Object.defineProperty({}, 'requireVisiblePrefix', { get() { throw new Error('motor yok'); } }) };
  let motorsuz;
  try {
    motorsuz = yt._yonlendiriciKurForTest();
  } finally {
    require.cache[p] = onceki;
  }
  const iste = (method, url, session, body) => new Promise((resolve) => {
    const res = {
      statusCode: 200, body: null, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; this.headersSent = true; resolve(this); return this; },
      setHeader() {}, getHeader() {},
    };
    motorsuz.handle({ method, url, headers: {}, session, body, query: {}, path: url }, res, (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }));
  });
  for (const [m, u, b] of [['DELETE', '/kosular/6', { confirmText: '6' }], ['POST', '/kosular/sil', { kosular: [6, 7], confirmText: '2' }]]) {
    const x = await iste(m, u, VELI, b);
    assert.equal(x.statusCode, 403, `${m} ${u}: ${JSON.stringify(x.body)}`);
  }
  assert.equal(D.sorgular.length, 0, 'isleyiciye gelinmez');
  assert.deepEqual(ids(), [6, 7]);
  const a = await iste('DELETE', '/kosular/6', ADMIN, { confirmText: '6' });
  assert.equal(a.statusCode, 200, JSON.stringify(a.body));
  assert.deepEqual(ids(), [7]);
});

test('SL11 INT ustu numara (sayi) 400, DB yok', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(8);
  for (const kosular of [[2147483648], [8, 2147483648], [1e12]]) {
    const x = await istek('POST', '/kosular/sil', { body: { kosular, confirmText: String(kosular.length) } });
    assert.deepEqual([x.statusCode, x.body.code], [400, 'gecersiz_istek'], JSON.stringify(kosular));
  }
  assert.equal(D.sorgular.length, 0);
  // INT_MAX gecerli numaradir (bulunamazsa toplu 409 kosu_yok).
  const r = await istek('POST', '/kosular/sil', { body: { kosular: [8, 2147483647], confirmText: '2' } });
  assert.deepEqual([r.statusCode, r.body.silinemeyenler.map((x) => [x.id, x.kod])], [409, [[2147483647, 'kosu_yok']]]);
  assert.deepEqual(ids(), [8]);
});

test('SL12 silme yeniden denenmez; denetim 403 / 409 / 424 yazar, 400 / 404 yazmaz', { timeout: 10000 }, async () => {
  sifirla();
  kosuEkle(9);
  kosuEkle(10, { created_by: 'ayse' });
  assert.equal((await tekli(9)).statusCode, 200);
  const tx = D.sorgular.find((x) => x.q.includes('/*SIL:tx*/'));
  assert.deepEqual(tx.opts, { tekrar: false }, 'islem SQL yeniden calistirilmaz');
  assert.ok(D.sorgular.filter((x) => x.q.includes('/*SIL:oku*/')).every((x) => x.opts === undefined), 'okuma varsayilan (yeniden denenir)');
  D.denetim = [];
  // 400 (onay metni / gecersiz girdi) ve 404: denetime YAZILMAZ.
  assert.equal((await istek('DELETE', '/kosular/10', { body: { confirmText: '11' } })).statusCode, 400);
  assert.equal((await istek('POST', '/kosular/sil', { body: { kosular: [], confirmText: '0' } })).statusCode, 400);
  assert.equal((await tekli(77)).statusCode, 404);
  assert.deepEqual(D.denetim, []);
  // 403 (sahiplik, isleyicide), 409, 424: yazilir ('fail').
  assert.equal((await tekli(10, { session: VELI })).statusCode, 403);
  D.kosular.find((k) => k.id === 10).durum = 'RUNNING';
  assert.equal((await tekli(10)).statusCode, 409);
  D.dbHata = new Error('baglanti yok');
  assert.equal((await tekli(10)).statusCode, 424);
  assert.deepEqual(D.denetim.map((d) => [d.eylem, d.result]), [['nginx_loadtest_kosu_sil', 'fail'], ['nginx_loadtest_kosu_sil', 'fail'], ['nginx_loadtest_kosu_sil', 'fail']]);
});
