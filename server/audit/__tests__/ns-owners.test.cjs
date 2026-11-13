// server/audit/__tests__/ns-owners.test.cjs — uygulama -> sorumlu ekip (namespace sahibi).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { indexOwners, ownersFor, loadNamespaceOwners, _resetCache } = require('../ns-owners.cjs');

test('ekip ozeti: birden fazla namespace, ayni ekip tek kez, sahipsiz namespace gorunur', () => {
  const byNs = indexOwners([
    { namespace: 'glomo-dev', owner_group_name: 'GT-GLOMO-DEV', owner_email: 'glomo@x', lookup_status: 'OK' },
    { namespace: 'GLOMO-PROD', owner_group_name: 'GT-GLOMO-DEV', owner_email: 'glomo@x', lookup_status: 'OK' },
    { namespace: 'saklama-prod', owner_group_name: null, owner_email: null, lookup_status: 'SORUMLU_YOK' },
  ]);
  const o = ownersFor(byNs, ['glomo-dev', 'glomo-prod', 'saklama-prod', 'hic-yok', null]);
  assert.deepEqual(o.groups, ['GT-GLOMO-DEV']);
  assert.deepEqual(o.emails, ['glomo@x']);
  assert.deepEqual(o.unknownNs, ['saklama-prod', 'hic-yok']);
});

test('tablo yoksa ready=false ve bos harita (ekran "veri yok" der, "bilinmiyor" degil)', async () => {
  _resetCache();
  const r = await loadNamespaceOwners(async () => { throw new Error("Invalid object name 'dbo.Openshift_Namespace_Owners'"); });
  assert.equal(r.ready, false);
  assert.equal(r.byNs.size, 0);
  _resetCache();
});

test('Nginx_Config_Audit sutun adi location_path (job_3315997 sonrasi: "Invalid column name location")', () => {
  // Sorgu nginx-migration.cjs/loadMigration'a tasindi (2026-09-14); iki dosya da taranir.
  const src = ['denetim.cjs', 'nginx-migration.cjs']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
    .join('\n');
  // Nginx_Config_Audit'ten okuyan her SELECT'te ciplak "location" sutunu olmamali.
  const selects = src.split('FROM dbo.Nginx_Config_Audit').slice(0, -1).map((s) => s.slice(s.lastIndexOf('SELECT')));
  assert.ok(selects.length >= 3);
  for (const sel of selects) {
    assert.ok(!/(?<!AS\s)(?<=[\s,])location(?=[\s,])/.test(sel), 'Nginx_Config_Audit\'te "location" yok, "location_path" var:\n' + sel);
  }
  assert.ok(src.includes('location_path AS location'), 'tasima sorgusu location_path AS location kullanmali');
});

// 2026-09-14 canli hata: "loadNamespaceOwners is not defined" - yukleyici tasinirken import
// silindi, /nginx-spa hala kullaniyordu. Testler route'u kosturmadigi icin yakalayamadi.
// Bekci: denetim.cjs'te CAGRILAN her ns-owners / nginx-migration fonksiyonu import edilmis olmali.
test('denetim.cjs: kullanilan yardimci fonksiyonlar gercekten import edilmis', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  for (const fn of ['loadNamespaceOwners', 'ownersFor', 'ownersForApp', 'loadMigration', 'summarizeAudit']) {
    const used = (src.match(new RegExp(`\\b${fn}\\(`, 'g')) || []).length;
    if (!used) continue;
    const imported = new RegExp(`\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*=\\s*require\\(`).test(src);
    assert.ok(imported, `${fn} kullaniliyor (${used} yer) ama import edilmemis`);
  }
});

// -- O1..O5 (2026-11-13, SlowQuery: App_Owners 61k satir 25-237 sn) ----------
// Tek-ucus, bayatken aninda donus + arka planda tek yenileme, gecici hatada onceki iyi deger.
const ns = require('../ns-owners.cjs');
function sahipSorgu() {
  const st = { n: 0, appHata: null, nsHata: null, grup: 'G1', gecikme: 5, aktif: 0, enCok: 0 };
  const q = async (t) => {
    const s = String(t);
    st.n += 1;
    st.aktif += 1;
    st.enCok = Math.max(st.enCok, st.aktif);
    await new Promise((r) => setTimeout(r, st.gecikme));
    st.aktif -= 1;
    if (s.includes('dbo.Openshift_Namespace_Owners')) {
      if (st.nsHata) throw st.nsHata;
      return { recordset: [{ namespace: 'a-prod', owner_group_name: 'NS', owner_email: null, lookup_status: 'OK' }] };
    }
    if (s.includes('dbo.Openshift_App_Owners')) {
      if (st.appHata) throw st.appHata;
      return { recordset: [{ cluster: 'c', namespace: 'a-prod', application: 'app', owner_group_name: st.grup, kaynak: 'SI51_AGILE', lookup_status: 'OK' }] };
    }
    throw new Error('beklenmeyen sorgu');
  };
  return { q, st };
}

test('O1 esanli iki cagri tek okuma paylasir; iki tablo paralel okunur', async () => {
  ns._resetCache();
  const { q, st } = sahipSorgu();
  try {
    const [a, b] = await Promise.all([ns.loadNamespaceOwners(q), ns.loadNamespaceOwners(q)]);
    assert.equal(st.n, 2, `sorgu sayisi ${st.n} (tek-ucus yok)`);
    assert.equal(a, b);
    assert.equal(st.enCok, 2, 'iki tablo sirali okundu');
    assert.equal(ns.TTL_MS, 30 * 60 * 1000);
  } finally {
    ns._resetCache();
  }
});

test('O2 TTL asildi: eski deger ANINDA doner, arka planda tek yenileme (2 sorgu)', async () => {
  ns._resetCache();
  const { q, st } = sahipSorgu();
  try {
    await ns.loadNamespaceOwners(q);
    st.grup = 'G2';
    st.gecikme = 30;
    ns._yaslandir(ns.TTL_MS + 1);
    const t0 = Date.now();
    const [x, y] = await Promise.all([ns.loadNamespaceOwners(q), ns.loadNamespaceOwners(q)]);
    assert.ok(Date.now() - t0 < st.gecikme, 'bayat deger icin okuma beklendi');
    assert.equal(x.byApp.get('a-prod/app').group, 'G1');
    assert.equal(y, x);
    await new Promise((r) => setTimeout(r, st.gecikme * 3));
    assert.equal(st.n, 4, `arka plan yenilemesi tek-ucus degil: ${st.n}`);
    assert.equal((await ns.loadNamespaceOwners(q)).byApp.get('a-prod/app').group, 'G2');
  } finally {
    ns._resetCache();
  }
});

test('O3 yenilemede App_Owners gecici duserse onceki iyi deger korunur', async () => {
  ns._resetCache();
  const { q, st } = sahipSorgu();
  try {
    await ns.loadNamespaceOwners(q);
    st.appHata = new Error('Timeout: Request failed to complete in 180000ms');
    ns._yaslandir(ns.TTL_MS + 1);
    await ns.loadNamespaceOwners(q);
    await new Promise((r) => setTimeout(r, st.gecikme * 3));
    const o = await ns.loadNamespaceOwners(q);
    assert.equal(o.appReady, true, 'gecici dusus iyi degeri sildi');
    assert.equal(o.byApp.get('a-prod/app').group, 'G1');
    assert.equal(o.appError, undefined);
  } finally {
    ns._resetCache();
  }
});

test('O4 ilk yuklemede gecici hata: sonuc doner (appError), onbellege alinmaz', async () => {
  ns._resetCache();
  const { q, st } = sahipSorgu();
  try {
    st.appHata = new Error('Login timeout expired');
    const o = await ns.loadNamespaceOwners(q);
    assert.deepEqual([o.ready, o.nsReady, o.appReady, o.appError], [true, true, false, 'gecici']);
    st.appHata = null;
    const o2 = await ns.loadNamespaceOwners(q);
    assert.equal(o2.appReady, true, 'gecici sonuc onbellege girdi');
    assert.equal(o2.appError, undefined);
    // Tablo YOK (208) kalici: appError yok, onbellege girer.
    ns._resetCache();
    st.appHata = Object.assign(new Error("Invalid object name 'dbo.Openshift_App_Owners'."), { number: 208 });
    const o3 = await ns.loadNamespaceOwners(q);
    assert.equal(o3.appError, undefined);
    const n = st.n;
    await ns.loadNamespaceOwners(q);
    assert.equal(st.n, n);
  } finally {
    ns._resetCache();
  }
});

test('O5 _resetCache sirasinda ucusta olan eski okuma yeni onbellegi ezmez', async () => {
  ns._resetCache();
  const { q, st } = sahipSorgu();
  try {
    const eski = ns.loadNamespaceOwners(q);
    ns._resetCache();
    st.grup = 'YENI';
    const yeni = await ns.loadNamespaceOwners(q);
    await eski;
    assert.equal(yeni.byApp.get('a-prod/app').group, 'YENI');
    assert.equal((await ns.loadNamespaceOwners(q)).byApp.get('a-prod/app').group, 'YENI');
  } finally {
    ns._resetCache();
  }
});

// -- O6..O9 (2026-11-13, inceleme): uzun havuz, geri cekilme, yas bilgisi, bekle ------------
test('O6 ana havuz query verilse de okuma uzun havuzdan yapilir (30 sn hatasi uzun havuz cagiranina gecmez)', async () => {
  ns._resetCache();
  const m = require('../../inventory/mssql.cjs');
  const asil = { query: m.query, queryLong: m.queryLong };
  const ana = sahipSorgu();
  const uzun = sahipSorgu();
  ana.st.appHata = new Error('Timeout: Request failed to complete in 30000ms');
  m.query = ana.q;
  m.queryLong = uzun.q;
  try {
    const anaCagiran = ns.loadNamespaceOwners(m.query); // denetim.cjs / gecis.cjs gibi
    const uzunCagiran = ns.loadNamespaceOwners(m.queryLong); // nginx-migration gibi
    const [a, b] = await Promise.all([anaCagiran, uzunCagiran]);
    assert.equal(ana.st.n, 0, 'ana havuzdan okundu');
    assert.equal(uzun.st.n, 2);
    for (const o of [a, b]) {
      assert.equal(o.appReady, true, 'ana havuz hatasi uzun havuz cagiranina gecti');
      assert.equal(o.appError, undefined);
    }
    // Baska bir fonksiyon (test sahtesi) oldugu gibi kullanilir.
    ns._resetCache();
    const diger = sahipSorgu();
    await ns.loadNamespaceOwners(diger.q);
    assert.equal(diger.st.n, 2);
  } finally {
    m.query = asil.query;
    m.queryLong = asil.queryLong;
    ns._resetCache();
  }
});

test('O7 basarisiz yenilemeden sonra geri cekilme: her istek yeni okuma baslatmaz', async () => {
  ns._resetCache();
  const { q, st } = sahipSorgu();
  try {
    await ns.loadNamespaceOwners(q);
    st.appHata = new Error('Timeout');
    ns._yaslandir(ns.TTL_MS + 1);
    await ns.loadNamespaceOwners(q);
    await new Promise((r) => setTimeout(r, st.gecikme * 3));
    const n = st.n;
    for (let i = 0; i < 5; i += 1) await ns.loadNamespaceOwners(q);
    await new Promise((r) => setTimeout(r, st.gecikme * 3));
    assert.equal(st.n, n, `geri cekilme yok: ${st.n - n} ek sorgu`);
    // Geri cekilme bitince yeniden denenir.
    st.appHata = null;
    ns._yaslandir(ns.GERI_CEKILME_MS + 1);
    await ns.loadNamespaceOwners(q);
    await new Promise((r) => setTimeout(r, st.gecikme * 3));
    assert.equal(st.n, n + 2, 'geri cekilmeden sonra yeniden denenmedi');
    // Onbellek YOKKEN geri cekilme yok: tablo geri gelince ilk istek hemen okur (AO15).
    ns._resetCache();
    st.appHata = new Error('Timeout');
    const ilk = await ns.loadNamespaceOwners(q);
    assert.equal(ilk.appError, 'gecici');
    st.appHata = null;
    const ikinci = await ns.loadNamespaceOwners(q);
    assert.equal(ikinci.appReady, true, 'onbellek yokken geri cekilme kullaniciyi bekletti');
  } finally {
    ns._resetCache();
  }
});

test('O8 donus yas bilgisi tasir: asOf, yasMs, stale (TTL asimi ya da son yenileme hatali)', async () => {
  ns._resetCache();
  const { q, st } = sahipSorgu();
  try {
    const o = await ns.loadNamespaceOwners(q);
    assert.equal(typeof o.asOf, 'string');
    assert.equal(o.stale, false);
    ns._yaslandir(ns.TTL_MS + 1);
    st.appHata = new Error('Timeout');
    const bayat = await ns.loadNamespaceOwners(q);
    assert.equal(bayat.stale, true, 'TTL asimi stale degil');
    assert.ok(bayat.yasMs >= ns.TTL_MS);
    await new Promise((r) => setTimeout(r, st.gecikme * 3));
    const h = await ns.loadNamespaceOwners(q);
    assert.equal(h.stale, true, 'son yenileme hatali iken stale degil');
  } finally {
    ns._resetCache();
  }
});

test('O9 bekle:true bayat degeri dondurmez, yenilemeyi bekler', async () => {
  ns._resetCache();
  const { q, st } = sahipSorgu();
  try {
    await ns.loadNamespaceOwners(q);
    st.grup = 'G2';
    ns._yaslandir(ns.TTL_MS + 1);
    const o = await ns.loadNamespaceOwners(q, { bekle: true });
    assert.equal(o.byApp.get('a-prod/app').group, 'G2', 'bekle:true bayat sahibi dondu');
    assert.equal(o.stale, false);
    // TTL icinde bekle:true okuma yapmaz.
    const n = st.n;
    await ns.loadNamespaceOwners(q, { bekle: true });
    assert.equal(st.n, n);
  } finally {
    ns._resetCache();
  }
});
