// server/audit/__tests__/warm-cache.test.cjs — WC1..WC3 (2026-09-21).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWarmCache } = require('../warm-cache.cjs');
const quiet = { warn() {}, log() {} };

test('WC1: ilk istek hesabi bekler, sonrakiler aninda doner; ayni anda gelenler tek hesap paylasir', async () => {
  let n = 0;
  const c = createWarmCache({ name: 't', ttlMs: 60000, compute: async () => { n += 1; await new Promise((r) => setTimeout(r, 20)); return { ok: true, n }; }, log: quiet });
  const [a, b] = await Promise.all([c.get(), c.get()]);
  assert.equal(n, 1); assert.equal(a.n, 1); assert.equal(b.n, 1);
  assert.equal(a._cache.stale, false);
  const d = await c.get(); assert.equal(n, 1); assert.equal(d.n, 1);
});

test('WC2: suresi dolunca bayat deger ANINDA doner, arka planda yenilenir', async () => {
  let n = 0;
  const c = createWarmCache({ name: 't', ttlMs: 10, compute: async () => { n += 1; return { ok: true, n }; }, log: quiet });
  await c.get();
  await new Promise((r) => setTimeout(r, 25));
  const stale = await c.get();
  assert.equal(stale.n, 1); assert.equal(stale._cache.stale, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await c.get()).n, 2);
});

test('WC3: fresh=1 hesabi bekler ve yeni degeri doner', async () => {
  let n = 0;
  const c = createWarmCache({ name: 't', ttlMs: 60000, compute: async () => ({ ok: true, n: ++n }), log: quiet });
  await c.get();
  assert.equal((await c.get({ fresh: true })).n, 2);
});

// -- WC4..WC10 (2026-11-13, SlowQuery): degisim belirteci + stabilite + azami yas + seri ----
// Isitici her 10 dakikada 1,56M satiri yeniden cekiyordu; kaynak gunde bir yaziliyor.
function saat(bas = 1_000_000) {
  let t = bas;
  const now = () => t;
  now.ileri = (ms) => { t += ms; };
  return now;
}
function belirtecli({ maxAgeMs = 6 * 3600_000, ttlMs = 600_000, tokenFn, seri = null, computeMs = 0, sayac } = {}) {
  const now = saat();
  const st = { n: 0, tk: 'A' };
  const c = createWarmCache({
    name: 't', ttlMs, maxAgeMs, seri, now, log: quiet,
    token: tokenFn || (async () => st.tk),
    compute: async () => {
      st.n += 1;
      if (sayac) { sayac.aktif += 1; sayac.enCok = Math.max(sayac.enCok, sayac.aktif); }
      if (computeMs) await new Promise((r) => setTimeout(r, computeMs));
      if (sayac) sayac.aktif -= 1;
      return { ok: true, n: st.n };
    },
  });
  return { c, st, now };
}

test('WC4: belirtec ayni -> hesap yok, checkedAt ilerler, stale false', async () => {
  const { c, st, now } = belirtecli();
  await c.get();
  assert.equal(st.n, 1);
  now.ileri(11 * 60_000);
  await c.kontrol();
  assert.equal(st.n, 1, 'belirtec degismedigi halde yeniden hesaplandi');
  assert.equal(c.peek().checkedAt, now(), 'checkedAt ilerlemedi');
  const g = await c.get();
  assert.equal(g._cache.stale, false, 'kontrol edilmis deger bayat gosterildi');
  assert.equal(g._cache.computedAt, new Date(1_000_000).toISOString(), 'computedAt verinin gercek yasini gostermeli');
});

test('WC5: belirtec degisti -> ilk kontrolde bekler, ikinci kontrolde (stabil) 1 kez hesaplar', async () => {
  const { c, st } = belirtecli();
  await c.get();
  st.tk = 'B';
  await c.kontrol();
  assert.equal(st.n, 1, 'yukleme surerken (ilk gorulen degisim) hesaplandi');
  st.tk = 'C';
  await c.kontrol();
  assert.equal(st.n, 1, 'hala degisen belirtecle hesaplandi');
  await c.kontrol();
  assert.equal(st.n, 2, 'stabil degisimde hesaplanmadi');
  await c.kontrol();
  assert.equal(st.n, 2, 'hesap sonrasi ayni belirtecle tekrar hesaplandi');
  assert.equal(c.peek().token, 'C');
});

test('WC6: azami yas asildi, belirtec ayni -> 1 kez hesaplar', async () => {
  const { c, st, now } = belirtecli({ maxAgeMs: 60_000 });
  await c.get();
  now.ileri(59_000);
  await c.kontrol();
  assert.equal(st.n, 1);
  now.ileri(2_000);
  await c.kontrol();
  assert.equal(st.n, 2, 'azami yas emniyeti calismadi');
});

test('WC7: belirtec okunamazsa yas < maxAgeMs iken hesap yok; yas >= maxAgeMs iken emniyet hesaplar', async () => {
  let hata = false;
  const { c, st, now } = belirtecli({ tokenFn: async () => { if (hata) throw new Error('db yok'); return 'A'; } });
  await c.get();
  hata = true;
  now.ileri(5 * 3600_000);
  const v = await c.kontrol();
  assert.equal(st.n, 1, 'belirtec hatasi (yas < maxAgeMs) agir hesabi tetikledi');
  assert.equal(v.payload.n, 1);
  assert.equal((await c.get()).n, 1);
  await new Promise((r) => setTimeout(r, 5)); // get()'in arka plan kontrolu bitsin
  // Inceleme 2026-11-13: belirtec surekli dusuyorsa onbellek suresiz donmamali.
  now.ileri(2 * 3600_000);
  await c.kontrol();
  assert.equal(st.n, 2, 'belirtec hatasinda azami yas emniyeti calismadi (onbellek suresiz donar)');
});

test('WC8: fresh=1 ve run() belirtecten bagimsiz hesaplar; get bayatken kontrol yoluna gider', async () => {
  const { c, st, now } = belirtecli();
  await c.get();
  assert.equal((await c.get({ fresh: true })).n, 2);
  await c.run();
  assert.equal(st.n, 3);
  now.ileri(11 * 60_000);
  const g = await c.get();
  assert.equal(g.n, 3);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(st.n, 3, 'get() bayat yolunda belirtec ayni iken hesapladi');
  assert.ok(c.peek().checkedAt === now(), 'get() bayat yolunda kontrol yapilmadi');
});

test('WC9: seri - ayni seri adli iki onbellegin hesaplari ayni anda calismaz', async () => {
  const sayac = { aktif: 0, enCok: 0 };
  const a = belirtecli({ seri: 'tbmwans-agir-test', computeMs: 15, sayac });
  const b = belirtecli({ seri: 'tbmwans-agir-test', computeMs: 15, sayac });
  await Promise.all([a.c.get(), b.c.get(), a.c.get({ fresh: true })]);
  assert.equal(sayac.enCok, 1, `esanli agir hesap: ${sayac.enCok}`);
  // Seri olmayanlar paralel kosabilir (geriye uyum).
  const s2 = { aktif: 0, enCok: 0 };
  const x = belirtecli({ computeMs: 15, sayac: s2 });
  const y = belirtecli({ computeMs: 15, sayac: s2 });
  await Promise.all([x.c.get(), y.c.get()]);
  assert.equal(s2.enCok, 2);
  // Zincirdeki bir hata sonrakini durdurmaz.
  const { _seriyeKoy } = require('../warm-cache.cjs');
  const p1 = _seriyeKoy('z', async () => { throw new Error('x'); });
  const p2 = _seriyeKoy('z', async () => 7);
  await assert.rejects(p1, /x/);
  assert.equal(await p2, 7);
});

test('WC10: hesap sirasinda belirtec degisirse bir sonraki kontrolde yakalanir', async () => {
  const st = { n: 0, tk: 'A' };
  const c = createWarmCache({
    name: 't', log: quiet, token: async () => st.tk,
    compute: async () => { st.n += 1; st.tk = 'B'; return { n: st.n }; },
  });
  await c.get();
  assert.equal(c.peek().token, 'A', 'belirtec hesaptan once okunmali');
  await c.kontrol();
  await c.kontrol();
  assert.equal(st.n, 2, 'hesap sirasindaki degisim kacti');
});

// -- WC11..WC13 (2026-11-13, inceleme) ----------------------------------------------------
test('WC11: hesap ucustayken run() (Admin yazimi) ucusa katilmaz, ardindan TEK ek hesap kosar', async () => {
  const girdi = { v: 1 };
  let n = 0;
  let birak;
  const kapi = new Promise((r) => { birak = r; });
  const c = createWarmCache({
    name: 't', log: quiet, token: async () => 'A',
    compute: async () => {
      n += 1;
      const okunan = girdi.v; // girdiler hesabin BASINDA okunur (allowedQ / excQ gibi)
      if (n === 1) await kapi;
      return { okunan };
    },
  });
  const ilk = c.get();
  await new Promise((r) => setTimeout(r, 5));
  girdi.v = 2; // Admin istisna ekledi
  const r1 = c.run();
  const r2 = c.run(); // ayni anda ikinci yazim: ayni ek hesabi paylasir
  const taze = c.get({ fresh: true }); // ekranin refreshQuietly'si
  birak();
  await ilk;
  await Promise.all([r1, r2]);
  assert.equal(n, 2, `ek hesap sayisi yanlis: ${n}`);
  assert.equal(c.peek().payload.okunan, 2, 'ucus sirasindaki degisiklik hesaba girmedi');
  assert.equal((await taze).okunan, 2, 'fresh=1 eski ucusun sonucunu dondu');
  // Ucus yokken run() dogrudan hesaplar.
  await c.run();
  assert.equal(n, 3);
});

test('WC12: maxAgeMs fonksiyon olabilir (eksik girdiyle hesap kisa omurlu)', async () => {
  const now = saat();
  let n = 0;
  let eksik = true;
  const c = createWarmCache({
    name: 't', log: quiet, now, token: async () => 'A',
    maxAgeMs: (p) => (p && p.eksik ? 10 * 60_000 : 6 * 3600_000),
    compute: async () => ({ n: ++n, eksik }),
  });
  await c.get();
  now.ileri(11 * 60_000);
  eksik = false;
  await c.kontrol();
  assert.equal(n, 2, 'eksik girdili hesap kisa yasla yenilenmedi');
  now.ileri(11 * 60_000);
  await c.kontrol();
  assert.equal(n, 2, 'tam hesap kisa yasla yenilendi');
});

test('WC13: _cache hesabin gercek yasini (yasMs) ve son kontrolu (checkedAt) tasir', async () => {
  const { c, now } = belirtecli();
  await c.get();
  now.ileri(30 * 60_000);
  await c.kontrol();
  const g = await c.get();
  assert.equal(g._cache.yasMs, 30 * 60_000);
  assert.equal(g._cache.checkedAt, new Date(now()).toISOString());
  assert.equal(g._cache.stale, false);
});
