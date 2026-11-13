// server/audit/__tests__/veri-katalogu.test.cjs - Denetim > Veri Katalogu ucu (2026-11-13).
//
// Kilitlenen davranis (sahte DB ile, gercek SQL sunucusu yok):
//   VK1 sapma: katalogda olmayan tablo / veritabaninda olmayan girdi; sema ve buyuk-kucuk harf
//   VK2 bir DB okunamaz: o DB 'bilinmiyor', sapmasi HESAPLANMAZ; diger DB etkilenmez
//   VK2b biri okunamaz (fiziksellik bilinmiyor): okunan DB'nin farki iki katalogun birlesimiyle suzulur
//   VK3 iki havuz ayni fiziksel DB: sapma birlesik (TBMWANS tablolari Portal'a "katalogda yok" olmaz)
//   VK4 izin yok (dm_db_partition_stats): sys.partitions'a duser, satir var boyut yok
//   VK5 onbellek: ikinci cagri DB'ye gitmez; fresh atlar; esz. cagrilar tek ucus; hatali sonuc kisa TTL
//   VK6 zaman asimi: asili DB sayfayi asmaz, o DB hata olur
//   VK7 gercek initDenetim: /veri-katalogu 'tab:denetim:katalog' kapisindan gecer (403 / 200)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const vk = require('../veri-katalogu.cjs');

const G = (db, tablo, o = {}) => ({
  db,
  tablo,
  amac: `${tablo} amaci`,
  alan: 'Envanter',
  yazanlar: [{ tur: 'portal', ad: 'x', dosya: 'a.cjs:1', nasil: 'INSERT', ne_zaman: 'her gun' }],
  okuyanlar: [{ ad: 'y', dosya: 'b.cjs:2' }],
  saklama: '',
  notlar: '',
  kullanilmiyor: false,
  guven: 'KESIN',
  ...o,
});
const KATALOG = [G('Portal', 'portal_users'), G('Portal', 'eski_tablo'), G('TBMWANS', 'Inventory'), G('TBMWANS', 'Servers')];

const satir = (db_adi, tablo, satir = 10, sayfa = 128, sema = 'dbo', sunucu = 'SQL1') => ({ db_adi, sunucu, sema, tablo, satir, sayfa });

function sahteDb(rows, { hata = null, izinYok = false, gecikme = 0 } = {}) {
  const calls = [];
  const fn = async (sqlText) => {
    calls.push(sqlText);
    if (gecikme) await new Promise((r) => setTimeout(r, gecikme));
    if (hata) throw new Error(hata);
    if (izinYok && sqlText.includes('dm_db_partition_stats')) throw new Error('VIEW DATABASE STATE permission denied in database');
    return { recordset: rows.map((r) => (sqlText.includes('dm_db_partition_stats') ? r : { ...r, sayfa: undefined })) };
  };
  fn.calls = calls;
  return fn;
}

test('VK1 sapma: katalogda yok / veritabaninda yok; ad buyuk-kucuk harf ve sema', async () => {
  const p = await vk.canliOku('Portal', sahteDb([satir('PORTALDB', 'PORTAL_USERS', 5, 256), satir('PORTALDB', 'yeni_tablo', 3, 8), satir('PORTALDB', 'portal_users', 1, 8, 'arsiv')]), 1000);
  const t = await vk.canliOku('TBMWANS', sahteDb([satir('TBMWANS', 'Inventory', 100, 1280), satir('TBMWANS', 'Servers', 0, 0)]), 1000);
  const r = vk.katalogDurumu(KATALOG, { Portal: p, TBMWANS: t });
  const by = Object.fromEntries(r.tablolar.map((x) => [`${x.db}:${x.tablo}`, x]));
  assert.equal(by['Portal:portal_users'].durum, 'var');
  assert.equal(by['Portal:portal_users'].satir, 5, 'dbo semasi eslesmeli, arsiv.portal_users DEGIL');
  assert.equal(by['Portal:portal_users'].mb, 2);
  assert.equal(by['Portal:eski_tablo'].durum, 'yok');
  assert.equal(by['TBMWANS:Inventory'].mb, 10);
  assert.deepEqual(
    r.sapma.katalogdaYok.map((x) => `${x.db}:${x.tablo}`),
    ['Portal:arsiv.portal_users', 'Portal:yeni_tablo'],
  );
  assert.deepEqual(r.sapma.veritabanindaYok.map((x) => `${x.db}:${x.tablo}`), ['Portal:eski_tablo']);
  const pv = r.veritabanlari.find((v) => v.db === 'Portal');
  assert.equal(pv.ok, true);
  assert.equal(pv.tabloSayisi, 3);
  assert.equal(pv.katalogSayisi, 2);
  assert.equal(r.ayniFiziksel, false);
});

test('VK2 bir DB okunamaz: durum bilinmiyor, sapma o DB icin yok, diger DB tam', async () => {
  const p = await vk.canliOku('Portal', sahteDb([], { hata: 'Login failed for user' }), 1000);
  const t = await vk.canliOku('TBMWANS', sahteDb([satir('TBMWANS', 'Inventory'), satir('TBMWANS', 'Fazla')]), 1000);
  const r = vk.katalogDurumu(KATALOG, { Portal: p, TBMWANS: t });
  assert.equal(r.ok, true);
  const pv = r.veritabanlari.find((v) => v.db === 'Portal');
  assert.equal(pv.ok, false);
  assert.match(pv.hata, /Login failed/);
  for (const x of r.tablolar.filter((x) => x.db === 'Portal')) {
    assert.equal(x.durum, 'bilinmiyor');
    assert.equal(x.satir, null);
  }
  assert.ok(!r.sapma.veritabanindaYok.some((x) => x.db === 'Portal'), 'okunamayan DB "yok" sayildi');
  assert.deepEqual(r.sapma.veritabanindaYok.map((x) => x.tablo), ['Servers']);
  assert.deepEqual(r.sapma.katalogdaYok.map((x) => `${x.db}:${x.tablo}`), ['TBMWANS:Fazla']);
});

test('VK2b tek DB okunur, fiziksellik bilinmiyor: karsi katalogun tablolari "katalogda yok" sayilmaz', async () => {
  // Iki havuz ayni fiziksel DB'yi gosterir ama biri duser (kendi zaman asimi / cooldown'u):
  // ayniFiziksel kanitlanamaz. Okunan DB'nin listesi diger katalogun tablolarini da icerir.
  const rows = [satir('TBMWANS', 'portal_users'), satir('TBMWANS', 'Inventory'), satir('TBMWANS', 'Servers'), satir('TBMWANS', 'Yabanci')];
  for (const [okunan, dusen] of [['Portal', 'TBMWANS'], ['TBMWANS', 'Portal']]) {
    const ok = await vk.canliOku(okunan, sahteDb(rows), 1000);
    const yok = await vk.canliOku(dusen, sahteDb([], { hata: 'zaman asimi' }), 1000);
    const r = vk.katalogDurumu(KATALOG, { [okunan]: ok, [dusen]: yok });
    assert.equal(r.ayniFiziksel, false);
    assert.equal(r.sapmaKismi, true);
    assert.deepEqual(r.sapma.katalogdaYok.map((x) => `${x.db}:${x.tablo}`), [`${okunan}:Yabanci`], `${dusen} dustu`);
  }
  const iki = vk.katalogDurumu(KATALOG, {
    Portal: await vk.canliOku('Portal', sahteDb([satir('PORTALDB', 'portal_users')]), 1000),
    TBMWANS: await vk.canliOku('TBMWANS', sahteDb([satir('TBMWANS', 'Inventory')]), 1000),
  });
  assert.equal(iki.sapmaKismi, false);
});

test('VK3 ayni fiziksel veritabani: sapma birlesik hesaplanir', async () => {
  const rows = [satir('TBMWANS', 'portal_users'), satir('TBMWANS', 'Inventory'), satir('TBMWANS', 'Servers'), satir('TBMWANS', 'Yabanci')];
  const p = await vk.canliOku('Portal', sahteDb(rows), 1000);
  const t = await vk.canliOku('TBMWANS', sahteDb(rows), 1000);
  const r = vk.katalogDurumu(KATALOG, { Portal: p, TBMWANS: t });
  assert.equal(r.ayniFiziksel, true);
  assert.deepEqual(r.sapma.katalogdaYok.map((x) => `${x.db}:${x.tablo}`), ['Portal + TBMWANS:Yabanci']);
  assert.deepEqual(r.sapma.veritabanindaYok.map((x) => x.tablo), ['eski_tablo']);
});

test('VK4 izin yok: sys.partitions yedegi, satir gelir boyut gelmez', async () => {
  const db = sahteDb([satir('TBMWANS', 'Inventory', 42, 999)], { izinYok: true });
  const t = await vk.canliOku('TBMWANS', db, 1000);
  assert.equal(t.ok, true);
  assert.equal(t.boyutVar, false);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[1], /sys\.partitions/);
  const r = vk.katalogDurumu(KATALOG, { Portal: { ok: false, hata: 'x' }, TBMWANS: t });
  const inv = r.tablolar.find((x) => x.tablo === 'Inventory');
  assert.deepEqual([inv.satir, inv.mb], [42, null]);
  assert.equal(r.veritabanlari.find((v) => v.db === 'TBMWANS').toplamMb, null);
});

test('VK5 onbellek: tekrar DB yok, fresh atlar, tek ucus, hatali sonuc kisa TTL', async () => {
  let saat = 1_000_000;
  const p = sahteDb([satir('P', 'portal_users')], { gecikme: 5 });
  const t = sahteDb([satir('T', 'Inventory')], { gecikme: 5 });
  const k = vk.createVeriKatalogu({ portalSorgu: p, tbmwansSorgu: t, katalogYukle: () => KATALOG, simdi: () => saat, onbellekMs: 600_000, hataliOnbellekMs: 60_000 });
  const [a, b, c] = await Promise.all([k.sonuc(), k.sonuc(), k.sonuc(true)]);
  assert.equal(p.calls.length, 1, 'eszamanli cagrilar tek ucus olmali');
  assert.ok(a === b && b === c);
  saat += 300_000;
  await k.sonuc();
  assert.equal(p.calls.length, 1, '10 dk dolmadan DB\'ye gidildi');
  await k.sonuc(true);
  assert.equal(p.calls.length, 2, 'fresh onbellegi atlamadi');
  saat += 600_001;
  await k.sonuc();
  assert.equal(p.calls.length, 3, 'TTL dolunca yenilenmedi');

  // Hatali sonuc: 1 dk sonra yeniden denenir.
  let bozuk = true;
  const ph = async (s) => {
    ph.n = (ph.n || 0) + 1;
    if (bozuk) throw new Error('baglanti yok');
    return { recordset: [satir('P', 'portal_users')] };
  };
  const k2 = vk.createVeriKatalogu({ portalSorgu: ph, tbmwansSorgu: t, katalogYukle: () => KATALOG, simdi: () => saat, onbellekMs: 600_000, hataliOnbellekMs: 60_000 });
  const h1 = await k2.sonuc();
  assert.equal(h1.veritabanlari[0].ok, false);
  saat += 30_000;
  await k2.sonuc();
  assert.equal(ph.n, 1, 'hata 1 dk icinde tekrar denendi');
  bozuk = false;
  saat += 30_001;
  const h2 = await k2.sonuc();
  assert.equal(ph.n, 2);
  assert.equal(h2.veritabanlari[0].ok, true);
});

test('VK6 zaman asimi: asili DB sayfayi asmaz', async () => {
  const asili = () => new Promise(() => {});
  const k = vk.createVeriKatalogu({
    portalSorgu: asili,
    tbmwansSorgu: sahteDb([satir('T', 'Inventory')]),
    katalogYukle: () => KATALOG,
    zamanAsimiMs: 30,
  });
  const r = await k.sonuc();
  const pv = r.veritabanlari.find((v) => v.db === 'Portal');
  assert.equal(pv.ok, false);
  assert.match(pv.hata, /yanıt gelmedi/);
  assert.equal(r.veritabanlari.find((v) => v.db === 'TBMWANS').ok, true);
});

// ── VK7: gercek initDenetim + sahte gorunurluk ──────────────────────────────────────────────
const KOK = path.join(__dirname, '..', '..');
const sahte = (rel, exports) => {
  const yol = path.join(KOK, rel);
  require.cache[Module._resolveFilename(yol, module)] = { id: yol, filename: yol, loaded: true, exports };
};
const IZIN = new Set();
let _srv = null;
async function sunucu() {
  if (_srv) return _srv;
  const sorgu = async (s) => (String(s).includes('sys.tables') ? { recordset: [satir('TBMWANS', 'Inventory')] } : { recordset: [] });
  sahte('auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
  sahte('auth/visibility.cjs', {
    requireVisiblePrefix: () => (_q, _s, n) => n(),
    requireVisible: (k) => (_q, res, n) => (IZIN.has(k) ? n() : res.status(403).json({ ok: false, message: `gizli: ${k}` })),
  });
  sahte('inventory/mssql.cjs', { query: sorgu, queryLong: sorgu, sql: new Proxy({}, { get: () => () => 'tip' }) });
  sahte('db/portal-mssql.cjs', { getPool: async () => ({ request: () => ({ query: sorgu }) }) });
  const { initDenetim } = require('../denetim.cjs');
  const app = express();
  initDenetim(app);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  _srv = { s, base: `http://127.0.0.1:${s.address().port}/api/denetim` };
  return _srv;
}
test.after(() => _srv && _srv.s.close());

test('VK7 /veri-katalogu yalniz tab:denetim:katalog izniyle; yanit katalogu + canli bilgiyi tasir', async () => {
  const { base } = await sunucu();
  IZIN.clear();
  IZIN.add('tab:denetim:webapp');
  const r1 = await fetch(`${base}/veri-katalogu`);
  assert.equal(r1.status, 403, 'baska sekme izni bu ucu acmamali');
  IZIN.add('tab:denetim:katalog');
  const r2 = await fetch(`${base}/veri-katalogu?fresh=1`);
  assert.equal(r2.status, 200);
  const j = await r2.json();
  assert.equal(j.ok, true);
  assert.ok(j.tablolar.length > 100, 'gercek katalog okunmadi');
  assert.ok(j.veritabanlari.every((v) => v.ok), JSON.stringify(j.veritabanlari));
  assert.equal(j.ayniFiziksel, true, 'iki sahte havuz ayni DB adini donuyor');
  assert.equal(j.tablolar.find((x) => x.db === 'TBMWANS' && x.tablo === 'Inventory').durum, 'var');
  // Yanit onbellegi gorunurluk kapisindan SONRA: izin kalkinca onbellekteki govde sizmamali.
  IZIN.delete('tab:denetim:katalog');
  const r3 = await fetch(`${base}/veri-katalogu`);
  assert.equal(r3.status, 403, 'onbellek yetki kapisini atladi');
});
