// server/spa-report/__tests__/gecis.test.cjs — Glomo Gecis Plani (2026-10-13).
//
// Kullanici: Excel'deki takvim (Calisma 1-7) Portal'a; eksikler Calisma 7'ye; herkes "kullanimda mi"
// + "katilacak kisi" girer, set tarihi / OCO / gecti / gecis tarihi yalniz Admin; tabloyu
// dolduranin adi TUTULMAZ.
// 2026-10-16: Set 6 bitti, talep listesi (glomo-gecis-set7-talep.json) TEK SEFERLIK gocle Set 7'ye
// tasinir, girisler korunur (GG5-GG6, GG8); herkes "Kontrol Ettim" der, kim TUTULMAZ (GG7).
// Denetim (2026-10-16): sahte DB SIKI - bilinmeyen SQL / kosul / ifade HATA verir, goc toplu SQL'i
// yapisiyla yorumlanir (XACT_ABORT, tablo on kontrolu BEGIN TRAN'dan ONCE, kilitli IF govdesi);
// sema bekcisi (GG10), goc durumu + Admin'e ozel alanlar (GG11), talep dosyasi yoksa rapor ayakta (GG12).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const DB_YOL = path.join(__dirname, '..', '..', 'db', 'index.cjs');
const SIMDI = new Date('2026-10-16T08:30:00.000Z');
const sets = new Map();
const apps = new Map();
const goc = new Set();
const sorgular = [];
// gocTabloYok: spa_gecis_goc tablosu yok. Gercek SQL Server'da tablo yokken BEGIN TRAN'dan sonra
// gelen 208 (ertelenmis ad cozumu) DERLEME hatasidir; XACT_ABORT onu geri almaz ve havuzdaki
// baglantida ACIK ISLEM kalir. Sahte DB bunu acikIslem sayaciyla taklit eder: tablo on kontrolu
// BEGIN TRAN'dan once yoksa sayac artar.
let gocTabloYok = false;
let acikIslem = 0;

/** "kol = ifade, kol = ifade" atamalarini satira uygular ($n parametre, NULL, GETUTCDATE(), sayi). */
function ata(a, atamalar, p) {
  for (const at of atamalar.split(', ')) {
    const [kol, ifade] = at.split(' = ');
    if (kol === 'updated_at') continue;
    if (/^\$\d+$/.test(ifade)) a[kol] = p[Number(ifade.slice(1)) - 1];
    else if (ifade === 'NULL') a[kol] = null;
    else if (ifade === 'GETUTCDATE()') a[kol] = SIMDI;
    else if (/^\d+$/.test(ifade)) a[kol] = Number(ifade);
    else throw new Error(`sahte DB bu ifadeyi bilmiyor: ${at}`);
  }
}

/** "kol <> $n" / "kol = $n" / "kol = 0" kosulunu satira uygular; bilinmeyen kosul HATA. */
function kosulSagla(a, kosul, p) {
  const m = /^(\w+) (<>|=) (\$\d+|\d+)$/.exec(kosul.trim());
  if (!m) throw new Error(`sahte DB bu kosulu bilmiyor: ${kosul}`);
  const deger = Number(m[3].startsWith('$') ? p[Number(m[3].slice(1)) - 1] : m[3]);
  const alan = Number(a[m[1]]);
  return m[2] === '=' ? alan === deger : alan !== deger;
}

const GOC_ON_KONTROL = /^SET XACT_ABORT ON; IF OBJECT_ID\(N'spa_gecis_goc', N'U'\) IS NULL THROW 5\d{4}, N'[^']*', 1; BEGIN TRAN; /;
const GOC_YAPI = /^SET XACT_ABORT ON; IF OBJECT_ID\(N'spa_gecis_goc', N'U'\) IS NULL THROW 5\d{4}, N'[^']*', 1; BEGIN TRAN; IF NOT EXISTS \(SELECT 1 FROM spa_gecis_goc WITH \(UPDLOCK, HOLDLOCK\) WHERE ad = \$1\) BEGIN (.+) END COMMIT;$/;

/** Goc toplusunu yorumlar: IF govdesindeki her ifade ayri yurur; goc satiri ikinci kez PK hatasi. */
function gocYorumla(t, p) {
  if (gocTabloYok) {
    if (GOC_ON_KONTROL.test(t)) throw new Error('spa_gecis_goc tablosu yok');
    acikIslem++;
    throw new Error("Invalid object name 'spa_gecis_goc'.");
  }
  const yapi = GOC_YAPI.exec(t);
  if (!yapi) throw new Error(`sahte DB: goc SQL yapisi beklenmedik: ${t.slice(0, 200)}`);
  if (goc.has(p[0])) return { rows: [], rowCount: 0 };
  const cikti = [];
  for (const st of yapi[1].split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = /^UPDATE spa_gecis_app SET (.+?) OUTPUT (.+?) WHERE (.+) AND app_key IN \(([^)]*)\)$/.exec(st);
    if (m) {
      const kolonlar = m[2].split(', ').map((c) => {
        if (!/^DELETED\.\w+$/.test(c)) throw new Error(`sahte DB bu OUTPUT kolonunu bilmiyor: ${c}`);
        return c.slice('DELETED.'.length);
      });
      const kosullar = m[3].split(' AND ');
      for (const ph of m[4].split(', ')) {
        const a = apps.get(p[Number(ph.slice(1)) - 1]);
        if (!a) continue;
        if (!kosullar.every((x) => kosulSagla(a, x, p))) continue;
        cikti.push(Object.fromEntries(kolonlar.map((c) => [c, a[c] === true ? 1 : a[c] === false ? 0 : a[c]])));
        ata(a, m[1], p);
      }
    } else if (/^INSERT INTO spa_gecis_goc \(ad\) VALUES \(\$1\)$/.test(st)) {
      if (goc.has(p[0])) throw new Error('Violation of PRIMARY KEY constraint (spa_gecis_goc)');
      goc.add(p[0]);
    } else throw new Error(`sahte DB: goc govdesinde bilinmeyen ifade: ${st.slice(0, 120)}`);
  }
  return { rows: cikti, rowCount: cikti.length };
}

const sahteDb = {
  query: async (sql, p = []) => {
    const t = String(sql).replace(/\s+/g, ' ').trim();
    sorgular.push({ t, p });
    if (t.includes('spa_gecis_goc')) return gocYorumla(t, p);
    if (t === 'IF NOT EXISTS (SELECT 1 FROM spa_gecis_set WHERE no = $1) INSERT INTO spa_gecis_set (no) VALUES ($1)') { if (!sets.has(p[0])) sets.set(p[0], { no: p[0], calisma_at: null, oco_no: null }); return { rows: [], rowCount: 1 }; }
    if (t === 'SELECT app_key FROM spa_gecis_app') return { rows: [...apps.keys()].map((x) => ({ app_key: x })) };
    if (/^INSERT INTO spa_gecis_app \(app_key, namespace, application, set_no, kaynak\) VALUES \(\$1, \$2, \$3, \$4, '(excel|portal)'\)$/.test(t)) {
      if (apps.has(p[0])) throw new Error('Violation of UNIQUE KEY constraint (spa_gecis_app.app_key)');
      apps.set(p[0], { namespace: p[1], application: p[2], set_no: p[3], kaynak: t.includes("'portal'") ? 'portal' : 'excel', kullanimda: null, katilimci: null, gecti: false, gecis_tarihi: null, kontrol_at: null });
      return { rows: [], rowCount: 1 };
    }
    if (t === 'SELECT no, calisma_at, oco_no FROM spa_gecis_set ORDER BY no') return { rows: [...sets.values()] };
    if (t.startsWith('SELECT namespace, application, set_no')) return { rows: [...apps.values()] };
    // Tek uygulama guncellemeleri: SET atamalarinin HEPSI uygulanir (gizli bir sifirlama gorunur).
    const tek = /^UPDATE spa_gecis_app SET (.+) WHERE app_key = \$1( RETURNING kontrol_at)?$/.exec(t);
    if (tek) {
      const a = apps.get(p[0]); if (!a) return { rows: [], rowCount: 0 };
      ata(a, tek[1], p);
      return { rows: tek[2] ? [{ kontrol_at: a.kontrol_at }] : [], rowCount: 1 };
    }
    if (t === 'UPDATE spa_gecis_set SET calisma_at = $2, oco_no = $3, updated_at = GETUTCDATE() WHERE no = $1') { const s = sets.get(p[0]); s.calisma_at = p[1]; s.oco_no = p[2]; return { rowCount: 1 }; }
    if (t.startsWith('UPDATE spa_gecis_app SET gecti = 1, gecis_tarihi = COALESCE(gecis_tarihi, $2)')) { let n = 0; for (const a of apps.values()) if (a.set_no === p[0] && !a.gecti) { a.gecti = true; a.gecis_tarihi = a.gecis_tarihi || p[1]; n++; } return { rowCount: n }; }
    throw new Error(`sahte DB bilinmeyen SQL: ${t.slice(0, 200)}`);
  },
};
require.cache[Module._resolveFilename(DB_YOL, module)] = { id: DB_YOL, filename: DB_YOL, loaded: true, exports: sahteDb };

const gecis = require('../gecis.cjs');
const SEED = require('../glomo-gecis-seed.json');
const TALEP = require('../glomo-gecis-set7-talep.json');

// Canli rapor: Excel'deki ilk uygulama + Excel'de OLMAYAN bir Glomo uygulamasi + baska servis.
const ilk = SEED[0];
const rapor = {
  ok: true,
  scanDate: '2026-10-12',
  rows: [
    { service: 'GLOMO', namespace: ilk.namespace, application: ilk.application, location: '/x/', team: ['GT-Ekip'], traffic: { state: 'active', req7: 10 } },
    { service: 'GLOMO', namespace: 'yeni-ns-prod', application: 'yeni-app-v0', location: '/yeni/', team: ['GT-Yeni'], traffic: null },
    { service: 'WEBFORMS', namespace: 'w-ns', application: 'w-app', location: '/w/', team: [], traffic: null },
  ],
};
let raporAktif = rapor;

let rol = 'User';
async function sunucu(modul = gecis) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: { username: 'ali', role: rol } }; next(); });
  const router = express.Router();
  modul.mountGecis(router, {
    loadReport: async () => raporAktif,
    // Namespace sahibi tablosu: e-posta buradan gelir.
    sahipYukle: async () => ({ ready: true, byNs: new Map([[ilk.namespace.toLowerCase(), { group: 'GT-Ekip', email: 'gt-ekip@banka.com', status: 'OK' }]]) }),
  });
  app.use('/api/spa-report', router);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { s, base: `http://127.0.0.1:${s.address().port}/api/spa-report` };
}
const istek = (base, yol, method = 'GET', body) =>
  fetch(base + yol, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, j: await r.json() }));

/** console.* cagrilarini toplar (kullanici adi loga gidiyor mu?). debug / trace de: yalniz
 *  log/info/warn/error izlenince console.debug ile yazan mutasyon yesil kaliyordu (denetim tur 2). */
function loglariTopla(t) {
  const loglar = [];
  for (const f of ['log', 'info', 'warn', 'error', 'debug', 'trace']) t.mock.method(console, f, (...a) => loglar.push({ f, m: a.map(String).join(' ') }));
  return loglar;
}
const kullaniciAdiVar = (metin) => /(^|[^a-z_])ali([^a-z_]|$)/.test(metin);

test('GG1 Excel 210 uygulama Set 1-7; Excel\'de olmayan canli Glomo uygulamasi Set 7\'ye eklenir, baska servis eklenmez', async () => {
  const { s, base } = await sunucu();
  try {
    const { j } = await istek(base, '/gecis');
    assert.equal(j.ok, true);
    assert.equal(j.sets.length, 7);
    assert.equal(j.apps.filter((a) => a.kaynak === 'excel').length, 210);
    const yeni = j.apps.find((a) => a.application === 'yeni-app-v0');
    assert.equal(yeni?.setNo, 7);
    assert.equal(yeni?.kaynak, 'portal');
    assert.ok(!j.apps.some((a) => a.application === 'w-app'), 'Glomo disi servis plana girdi');
    const x = j.apps.find((a) => a.application === ilk.application);
    assert.deepEqual(x.ekip, ['GT-Ekip']);
    assert.equal(x.yuk.state, 'active');
    assert.equal(x.taramadaYok, false);
    assert.equal(x.kontrolAt, null);
    assert.equal(j.apps.find((a) => a.application === SEED[1].application).taramadaYok, true);
    assert.equal(j.admin, false);
  } finally { s.close(); }
});

test('GG2 herkes kullanimda + katilimci girer; kim yazdi TUTULMAZ (hicbir sorguda / logda); "hayir" katilimciyi bosaltir', async (t) => {
  rol = 'User';
  const loglar = loglariTopla(t);
  const { s, base } = await sunucu();
  try {
    await istek(base, '/gecis');
    const bas = sorgular.length;
    let r = await istek(base, '/gecis/app', 'PUT', { namespace: ilk.namespace, application: ilk.application, kullanimda: 'yes', katilimci: 'Ayse Yilmaz' });
    assert.equal(r.j.ok, true);
    const yeni = sorgular.slice(bas);
    assert.ok(yeni.length > 0 && yeni.every((q) => q.t.startsWith('UPDATE spa_gecis_app SET kullanimda')), `kullanimda ucunda beklenmeyen sorgu: ${yeni.map((q) => q.t.slice(0, 60)).join(' | ')}`);
    assert.ok(yeni.every((q) => !q.p.includes('ali') && !kullaniciAdiVar(q.t)), 'yazan kullanici kaydediliyor');
    assert.ok(!yeni.some((q) => /_by\b/.test(q.t)), 'yazan kullanici kolonu var');
    r = await istek(base, '/gecis', 'GET');
    assert.equal(r.j.apps.find((a) => a.application === ilk.application).katilimci, 'Ayse Yilmaz');
    assert.ok(!JSON.stringify(r.j).includes('"ali"'), 'yanitta dolduranin adi var');
    await istek(base, '/gecis/app', 'PUT', { namespace: ilk.namespace, application: ilk.application, kullanimda: 'no', katilimci: 'X' });
    r = await istek(base, '/gecis', 'GET');
    const a = r.j.apps.find((x) => x.application === ilk.application);
    assert.equal(a.kullanimda, 'no');
    assert.equal(a.katilimci, '');
    assert.ok(!loglar.some((l) => kullaniciAdiVar(l.m)), 'kullanici adi loga yazildi');
  } finally { s.close(); }
});

test('GG3 set / gecti / gecis tarihi yalniz Admin', async () => {
  rol = 'User';
  let { s, base } = await sunucu();
  try {
    assert.equal((await istek(base, '/gecis/set', 'PUT', { no: 6, calismaAt: '2026-10-15T23:00', ocoNo: 'OCO-1' })).status, 403);
    assert.equal((await istek(base, '/gecis/app-admin', 'PUT', { namespace: ilk.namespace, application: ilk.application, gecti: true })).status, 403);
    assert.equal((await istek(base, '/gecis/set/1/gecti', 'POST', { tarih: '2026-10-01' })).status, 403);
  } finally { s.close(); }
  rol = 'Admin';
  ({ s, base } = await sunucu());
  try {
    assert.equal((await istek(base, '/gecis/set', 'PUT', { no: 6, calismaAt: '2026-10-15T23:00', ocoNo: 'OCO-1' })).j.ok, true);
    assert.equal((await istek(base, '/gecis/set', 'PUT', { no: 6, calismaAt: '15.10.2026', ocoNo: '' })).status, 400);
    assert.equal((await istek(base, '/gecis/app-admin', 'PUT', { namespace: ilk.namespace, application: ilk.application, gecti: true, gecisTarihi: '2026-09-30' })).j.ok, true);
    const t = await istek(base, '/gecis/set/1/gecti', 'POST', { tarih: '2026-10-01' });
    assert.equal(t.j.guncellenen, SEED.filter((x) => x.set === 1).length - 1);
    const { j } = await istek(base, '/gecis');
    assert.equal(j.admin, true);
    assert.deepEqual(j.sets.find((x) => x.no === 6), { no: 6, calismaAt: '2026-10-15T23:00', ocoNo: 'OCO-1' });
    assert.equal(j.apps.find((a) => a.application === ilk.application).gecisTarihi, '2026-09-30', 'toplu islem elle girilen tarihi ezdi');
    assert.ok(j.apps.filter((a) => a.setNo === 1).every((a) => a.gecti));
  } finally { s.close(); rol = 'User'; }
});

test('GG4 ekip e-postasi namespace sahibi tablosundan gelir; canli raporda olmayan uygulamada da', async () => {
  rol = 'User';
  const { s, base } = await sunucu();
  try {
    const { j } = await istek(base, '/gecis');
    assert.equal(j.epostaVar, true);
    const x = j.apps.find((a) => a.application === ilk.application);
    assert.deepEqual(x.ekipEposta, ['gt-ekip@banka.com']);
    assert.deepEqual(x.ekip, ['GT-Ekip']);
    const yok = j.apps.find((a) => a.namespace === ilk.namespace && a.application !== ilk.application && a.taramadaYok);
    if (yok) assert.deepEqual(yok.ekipEposta, ['gt-ekip@banka.com'], 'canli raporda olmayan uygulama e-postayi alamadi');
  } finally { s.close(); }
});

// ── 2026-10-16: Set 7 talebi gocu + Kontrol ─────────────────────────────────────────────────
const k = (ns, app) => gecis.appKey(ns, app);
const talepKey = new Set(TALEP.uygulamalar.map((u) => `${u.namespace}/${u.application}`));
const seedTalepte = (set) => SEED.filter((x) => x.set === set && talepKey.has(`${x.namespace}/${x.application}`));
const seedTalepDisi = (set) => SEED.filter((x) => x.set === set && !talepKey.has(`${x.namespace}/${x.application}`));
const A6 = seedTalepte(6)[0];
const A7 = seedTalepte(7)[0];
const B6 = seedTalepDisi(6)[0];
const SEED_DISI = TALEP.uygulamalar.filter((u) => !SEED.some((x) => x.namespace === u.namespace && x.application === u.application));
const ESKI_KONTROL = new Date('2026-10-14T10:00:00.000Z');
const bulApp = (j, x) => j.apps.find((a) => a.namespace === x.namespace && a.application === x.application);

/** Plani "goc oncesi uretim" durumuna getirir: seed zaten yazilmis, kullanicilar giris yapmis. */
function gocOncesi() {
  apps.clear(); sets.clear(); goc.clear(); sorgular.length = 0; gecis._sifirla(); gocTabloYok = false; acikIslem = 0;
  for (const x of SEED) {
    apps.set(k(x.namespace, x.application), { namespace: x.namespace, application: x.application, set_no: x.set, kaynak: 'excel', kullanimda: null, katilimci: null, gecti: false, gecis_tarihi: null, kontrol_at: null });
  }
  Object.assign(apps.get(k(A6.namespace, A6.application)), { kullanimda: 'yes', katilimci: 'Ayse Yilmaz', gecti: true, gecis_tarihi: '2026-10-10', kontrol_at: ESKI_KONTROL });
  Object.assign(apps.get(k(A7.namespace, A7.application)), { kullanimda: 'no', gecti: true, gecis_tarihi: '2026-10-01' });
  Object.assign(apps.get(k(B6.namespace, B6.application)), { kullanimda: 'yes', katilimci: 'Veli', kontrol_at: ESKI_KONTROL });
}

test('GG5 goc: talepteki Set 6/4 uygulamalari Set 7\'ye tasinir (gecti olanlar dahil), girisler korunur, gecti sifirlanir; planda olmayan EKLENMEZ; tekrar uygulanmaz', async (t) => {
  assert.ok(A6 && A7 && B6 && SEED_DISI.length >= 2, 'fikstur: talep listesi beklenen karisimi icermiyor');
  gocOncesi();
  const loglar = loglariTopla(t);
  // Canli raporda talepteki seed-disi uygulamalardan biri Glomo'da var: "eksik" mantigi ekler.
  const canliTalep = SEED_DISI[0];
  raporAktif = { ok: true, scanDate: '2026-10-16', rows: [{ service: 'GLOMO', namespace: canliTalep.namespace, application: canliTalep.application, location: '/c/', team: [], traffic: null }] };
  rol = 'User';
  let { s, base } = await sunucu();
  try {
    const { j } = await istek(base, '/gecis');
    const bul = (x) => bulApp(j, x);
    const a6 = bul(A6);
    assert.equal(a6.setNo, 7, 'Set 6 talebi Set 7\'ye tasinmadi');
    assert.equal(a6.kullanimda, 'yes');
    assert.equal(a6.katilimci, 'Ayse Yilmaz', 'katilimci girisi etkilendi');
    assert.equal(a6.kontrolAt, ESKI_KONTROL.toISOString(), 'kontrol girisi etkilendi');
    assert.equal(a6.gecti, false, 'gecti sifirlanmadi (Set 7\'de gorunmez)');
    assert.equal(a6.gecisTarihi, null, 'gecis tarihi sifirlanmadi');
    const a7 = bul(A7);
    assert.equal(a7.setNo, 7);
    assert.equal(a7.gecti, true, 'zaten Set 7 olana dokunuldu');
    assert.equal(a7.gecisTarihi, '2026-10-01', 'zaten Set 7 olana dokunuldu');
    assert.equal(bul(B6).setNo, 6, 'talepte olmayan Set 6 uygulamasi tasindi');
    assert.equal(bul(B6).katilimci, 'Veli');
    for (const x of seedTalepte(4)) assert.equal(bul(x).setNo, 7, `Set 4 talebi tasinmadi: ${x.application}`);
    assert.equal(j.apps.filter((a) => a.kaynak === 'excel' && a.setNo === 7).length, seedTalepte(7).length + seedTalepte(6).length + seedTalepte(4).length + seedTalepDisi(7).length);
    // Planda olmayan EKLENMEZ; canlida olan "eksik" olarak (portal) Set 7'de.
    assert.equal(bul(SEED_DISI[1]), undefined, 'planda olmayan talep uygulamasi uyduruldu');
    assert.equal(bul(canliTalep).kaynak, 'portal');
    assert.equal(bul(canliTalep).setNo, 7);
    assert.equal(apps.size, SEED.length + 1, 'goc plana satir ekledi');
    // talepEslesmeyen DINAMIK (Admin'e): User yanitinda bos.
    assert.deepEqual(j.talepEslesmeyen, []);
    assert.deepEqual(j.goc, { ad: TALEP.ad, uygulandi: true });
    // SQL: girisler SQL'de yok, goc adi parametre; yapi sahte DB'de (GOC_YAPI) dogrulanir.
    const g = sorgular.filter((q) => q.t.includes('spa_gecis_goc'));
    assert.equal(g.length, 1);
    assert.ok(!/kullanimda|katilimci|kontrol_at/.test(g[0].t), 'goc girislere dokunuyor');
    assert.equal(g[0].p[0], TALEP.ad);
    // IZ: tasinan her uygulama onceki set / gecti / gecis tarihiyle loglanir (elle geri donus icin).
    const iz = loglar.filter((l) => l.f === 'log' && l.m.includes(TALEP.ad));
    const a6iz = iz.find((l) => l.m.includes(`${A6.namespace}/${A6.application}`));
    assert.ok(a6iz, 'tasinan uygulama loglanmadi');
    assert.match(a6iz.m, /Set 6 -> 7/);
    assert.match(a6iz.m, /gecti=1/);
    assert.match(a6iz.m, /2026-10-10/);
    assert.ok(!iz.some((l) => l.m.includes(`${A7.namespace}/${A7.application}`)), 'tasinmayan uygulama tasindi diye loglandi');
    assert.equal(iz.filter((l) => / Set \d+ -> 7 /.test(l.m)).length, seedTalepte(6).length + seedTalepte(4).length);
  } finally { s.close(); }

  // Admin: talepEslesmeyen dolu, goc uygulandi.
  rol = 'Admin';
  ({ s, base } = await sunucu());
  try {
    const { j } = await istek(base, '/gecis');
    assert.equal(j.talepEslesmeyen.length, SEED_DISI.length - 1);
    assert.ok(j.talepEslesmeyen.some((u) => u.application === SEED_DISI[1].application));
    assert.ok(!j.talepEslesmeyen.some((u) => u.application === canliTalep.application), 'canlidan eklenen hala eslesmeyen sayiliyor (statik hesap?)');
    assert.deepEqual(j.goc, { ad: TALEP.ad, uygulandi: true, hata: null });
    // Admin sonradan A6'yi Set 6'ya geri alir; surec yeniden baslar (bayraklar sifir): goc TEKRAR UYGULANMAZ.
    assert.equal((await istek(base, '/gecis/app-admin', 'PUT', { namespace: A6.namespace, application: A6.application, setNo: 6 })).j.ok, true);
    gecis._sifirla();
    const r = await istek(base, '/gecis');
    assert.equal(bulApp(r.j, A6).setNo, 6, 'goc ikinci kez uygulandi, Admin\'in tasidigi geri cekildi');
    assert.ok(!loglar.some((l) => l.f === 'error'), `uygulanmis goc yeniden calisinca hata: ${loglar.filter((l) => l.f === 'error').map((l) => l.m).join(' | ')}`);
  } finally { s.close(); raporAktif = rapor; rol = 'User'; }
});

test('GG5b goc ayni surecte ikinci okumada SQL kosmaz (bellek bayragi)', async () => {
  gocOncesi();
  const { s, base } = await sunucu();
  try {
    await istek(base, '/gecis');
    await istek(base, '/gecis');
    await istek(base, '/gecis');
    assert.equal(sorgular.filter((q) => q.t.includes('spa_gecis_goc')).length, 1, 'goc her okumada kosuyor (UPDLOCK/HOLDLOCK islemi)');
  } finally { s.close(); }
});

test('GG6 goc tablosu yoksa: islem ACILMADAN temiz hata, sayfa acilir, hata loglanir, Admin goc durumunu gorur, sonra yeniden denenir', async (t) => {
  gocOncesi();
  gocTabloYok = true;
  const hata = t.mock.method(console, 'error', () => {});
  rol = 'Admin';
  const { s, base } = await sunucu();
  try {
    let r = await istek(base, '/gecis');
    assert.equal(r.status, 200);
    assert.equal(r.j.ok, true);
    assert.equal(acikIslem, 0, 'tablo yokken BEGIN TRAN acik kaldi (tablo on kontrolu BEGIN TRAN\'dan once olmali)');
    assert.ok(hata.mock.calls.some((c) => String(c.arguments.join(' ')).includes('spa_gecis_goc')), 'goc hatasi loglanmadi');
    assert.equal(bulApp(r.j, A6).setNo, 6);
    assert.equal(r.j.goc.uygulandi, false, 'goc uygulanamadi ama yanit uygulandi diyor');
    assert.match(String(r.j.goc.hata), /spa_gecis_goc/);
    gocTabloYok = false;
    r = await istek(base, '/gecis');
    assert.equal(bulApp(r.j, A6).setNo, 7, 'goc yeniden denenmedi');
    assert.deepEqual(r.j.goc, { ad: TALEP.ad, uygulandi: true, hata: null });
  } finally { s.close(); rol = 'User'; }
});

test('GG7 Kontrol Ettim: herkes; true -> an, false -> bos; diger girislere dokunmaz; kim TUTULMAZ (sorgu + log); 400 / 404', async (t) => {
  gocOncesi();
  rol = 'User';
  const loglar = loglariTopla(t);
  const { s, base } = await sunucu();
  try {
    await istek(base, '/gecis');
    const bas = sorgular.length;
    const hedef = { namespace: B6.namespace, application: B6.application };
    let r = await istek(base, '/gecis/app-kontrol', 'PUT', { ...hedef, kontrol: false });
    assert.equal(r.j.kontrolAt, null);
    r = await istek(base, '/gecis/app-kontrol', 'PUT', { ...hedef, kontrol: true });
    assert.equal(r.status, 200);
    assert.equal(r.j.kontrolAt, SIMDI.toISOString());
    const yeni = sorgular.slice(bas);
    assert.ok(yeni.every((q) => q.t.startsWith('UPDATE spa_gecis_app SET kontrol_at')), `kontrol ucunda beklenmeyen sorgu: ${yeni.map((q) => q.t.slice(0, 60)).join(' | ')}`);
    for (const q of yeni) assert.deepEqual(q.p, [k(B6.namespace, B6.application)], 'kontrol SQL\'ine anahtar disinda deger gidiyor (kim?)');
    assert.ok(!yeni.some((q) => /_by\b|kim|kullanici/.test(q.t) || kullaniciAdiVar(q.t)), 'kontrol SQL\'i kimi yaziyor');
    r = await istek(base, '/gecis');
    const b6 = bulApp(r.j, B6);
    assert.equal(b6.kontrolAt, SIMDI.toISOString());
    assert.equal(b6.kullanimda, 'yes', 'Kontrol Ettim kullanimda girisini degistirdi');
    assert.equal(b6.katilimci, 'Veli', 'Kontrol Ettim katilimci girisini degistirdi');
    assert.ok(!JSON.stringify(r.j).includes('"ali"'), 'yanitta basanin adi var');
    r = await istek(base, '/gecis/app-kontrol', 'PUT', { ...hedef, kontrol: false });
    assert.equal(r.j.ok, true);
    assert.equal(r.j.kontrolAt, null);
    r = await istek(base, '/gecis');
    assert.equal(bulApp(r.j, B6).kontrolAt, null);
    assert.equal(bulApp(r.j, B6).katilimci, 'Veli', 'geri al katilimci girisini degistirdi');
    assert.ok(!loglar.some((l) => kullaniciAdiVar(l.m)), 'kullanici adi loga yazildi');
    assert.equal((await istek(base, '/gecis/app-kontrol', 'PUT', { ...hedef, kontrol: 'evet' })).status, 400);
    assert.equal((await istek(base, '/gecis/app-kontrol', 'PUT', { ...hedef })).status, 400);
    assert.equal((await istek(base, '/gecis/app-kontrol', 'PUT', { namespace: '', application: 'x', kontrol: true })).status, 400);
    assert.equal((await istek(base, '/gecis/app-kontrol', 'PUT', { namespace: 'yok-ns', application: 'yok-app', kontrol: true })).status, 404);
  } finally { s.close(); }
});

test('GG9 kullanimda / katilimci degisikligi kontrol isaretini silmez', async () => {
  gocOncesi();
  rol = 'User';
  const { s, base } = await sunucu();
  try {
    await istek(base, '/gecis');
    await istek(base, '/gecis/app', 'PUT', { namespace: A6.namespace, application: A6.application, kullanimda: 'yes', katilimci: 'Baska Kisi' });
    await istek(base, '/gecis/app', 'PUT', { namespace: B6.namespace, application: B6.application, kullanimda: 'no' });
    const { j } = await istek(base, '/gecis');
    assert.equal(bulApp(j, A6).kontrolAt, ESKI_KONTROL.toISOString(), 'katilimci degisikligi kontrolu sildi');
    assert.equal(bulApp(j, B6).kontrolAt, ESKI_KONTROL.toISOString(), 'kullanimda degisikligi kontrolu sildi');
  } finally { s.close(); }
});

test('GG8 TAZE DB: seed + goc ayni ilk okumada (goc seed\'den SONRA); talepteki Set 6/4 Set 7, talep disi yerinde', async () => {
  apps.clear(); sets.clear(); goc.clear(); sorgular.length = 0; gecis._sifirla(); gocTabloYok = false; acikIslem = 0;
  rol = 'User';
  const { s, base } = await sunucu();
  try {
    const { j } = await istek(base, '/gecis');
    assert.equal(bulApp(j, A6).setNo, 7, 'taze DB: talep Set 6 uygulamasi Set 7\'ye gecmedi (goc seed\'den once mi?)');
    for (const x of seedTalepte(4)) assert.equal(bulApp(j, x).setNo, 7);
    assert.equal(bulApp(j, B6).setNo, 6);
    assert.equal(bulApp(j, A7).setNo, 7);
  } finally { s.close(); }
});

test('GG10 SEMA bekcisi: spa_gecis_goc tablosu, kontrol_at hem CREATE\'te hem alters\'ta; planYukle kolonlari semada', () => {
  // Yorumlar soyulur: yorum blogu icine alinmis (hic calismayan) TABLES / alters girdisi "var"
  // sayilmasin (denetim tur 2). Once tam satir // yorumlari (icinde 'data/*.json' gibi '/*' var),
  // sonra /* */ bloklari.
  const kaynak = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const tablo = (ad) => {
    const m = new RegExp(`name:\\s*'${ad}',\\s*sql:\\s*\`([^\`]*)\``).exec(kaynak);
    assert.ok(m, `TABLES listesinde ${ad} yok`);
    return m[1];
  };
  const gocSql = tablo('spa_gecis_goc');
  assert.match(gocSql, /CREATE TABLE spa_gecis_goc \(/, 'spa_gecis_goc girdisi baska tablo yaratiyor');
  assert.match(gocSql, /\bad\s+NVARCHAR\(64\)\s+NOT NULL PRIMARY KEY/, 'spa_gecis_goc.ad PRIMARY KEY degil');
  assert.match(gocSql, /\buygulandi_at\s+DATETIME2 NOT NULL DEFAULT GETUTCDATE\(\)/);
  const appSql = tablo('spa_gecis_app');
  assert.match(appSql, /CREATE TABLE spa_gecis_app \(/);
  // Uretimde spa_gecis_app 2026-10-13'ten beri var: kontrol_at'i YALNIZ alters kaydi ekler.
  assert.match(kaynak, /table:\s*'spa_gecis_app',\s*col:\s*'kontrol_at',\s*sql:\s*`ALTER TABLE spa_gecis_app ADD kontrol_at DATETIME2 NULL`/, 'alters: spa_gecis_app.kontrol_at kaydi yok / bozuk');
  // planYukle'nin okudugu her kolon CREATE'te.
  const gecisKaynak = fs.readFileSync(path.join(__dirname, '..', 'gecis.cjs'), 'utf8');
  const sec = /SELECT ([\w, ]+) FROM spa_gecis_app`/.exec(gecisKaynak);
  assert.ok(sec, 'planYukle SELECT bulunamadi');
  for (const kol of sec[1].split(',').map((x) => x.trim())) assert.match(appSql, new RegExp(`\\n\\s*${kol}\\s+[A-Z]`), `spa_gecis_app CREATE'te kolon yok: ${kol}`);
});

test('GG11 Admin\'e ozel alanlar: talepEslesmeyen ve goc hatasi User yanitinda yok', async () => {
  gocOncesi();
  gocTabloYok = true;
  const { s, base } = await sunucu();
  try {
    rol = 'User';
    let r = await istek(base, '/gecis');
    assert.deepEqual(r.j.talepEslesmeyen, []);
    assert.deepEqual(r.j.goc, { ad: TALEP.ad, uygulandi: false });
    rol = 'Admin';
    r = await istek(base, '/gecis');
    assert.ok(r.j.talepEslesmeyen.length > 0);
    assert.equal(r.j.goc.uygulandi, false);
    assert.ok(r.j.goc.hata);
  } finally { s.close(); rol = 'User'; gocTabloYok = false; }
});

test('GG12 talep dosyasi yoksa (commit\'e girmedi) modul yine yuklenir, plan acilir, Admin goc hatasini gorur', async (t) => {
  gocOncesi();
  const hata = t.mock.method(console, 'error', () => {});
  const gecisYol = require.resolve('../gecis.cjs');
  const talepYol = require.resolve('../glomo-gecis-set7-talep.json');
  const eski = { g: require.cache[gecisYol], t: require.cache[talepYol] };
  delete require.cache[gecisYol]; delete require.cache[talepYol];
  const orjLoad = Module._load;
  Module._load = function yukle(istekAdi, ...rest) {
    if (String(istekAdi).endsWith('glomo-gecis-set7-talep.json')) {
      const e = new Error(`Cannot find module '${istekAdi}'`); e.code = 'MODULE_NOT_FOUND'; throw e;
    }
    return orjLoad.call(this, istekAdi, ...rest);
  };
  let taze;
  try { taze = require('../gecis.cjs'); } finally {
    Module._load = orjLoad;
    require.cache[gecisYol] = eski.g; require.cache[talepYol] = eski.t;
  }
  assert.ok(taze && taze !== gecis, 'taze modul yuklenemedi');
  rol = 'Admin';
  const { s, base } = await sunucu(taze);
  try {
    const r = await istek(base, '/gecis');
    assert.equal(r.status, 200);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.goc.uygulandi, false);
    assert.match(String(r.j.goc.hata), /glomo-gecis-set7-talep\.json/);
    assert.deepEqual(r.j.talepEslesmeyen, []);
    assert.equal(bulApp(r.j, A6).setNo, 6, 'talep yokken tasima yapildi');
    assert.ok(hata.mock.calls.some((c) => String(c.arguments.join(' ')).includes('glomo-gecis-set7-talep.json')), 'eksik talep dosyasi loglanmadi');
    assert.equal(sorgular.filter((q) => q.t.includes('spa_gecis_goc')).length, 0, 'talep yokken goc SQL\'i kostu');
  } finally { s.close(); rol = 'User'; }
});
