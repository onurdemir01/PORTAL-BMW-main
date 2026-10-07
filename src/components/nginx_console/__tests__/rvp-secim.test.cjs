// src/components/nginx_console/__tests__/rvp-secim.test.cjs — "RP Secimi" sihirbazinin KARAR
// TABLOSU bekcisi (kullanici, 2026-10-05).
//
// Karar tablosu kullanicinin iki turda verdigi cevaplardan gelir; yanlis kutu yanlis reverse
// proxy'ye deployment yaptirir. Bu yuzden her kutu ADI ADINA kilitlenir: liste degisirse KIRMIZI.
//
// rvpSecim.ts typescript ile CommonJS'e cevrilip CAGRILIR (dizgi eslemesi DEGIL): sunucu
// listeleri, soru sirasi ve "tanimsiz" durumu gercek donus degerinden okunur.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(KOK, 'src', 'components', 'nginx_console', 'rvpSecim.ts');
const TAB = path.join(KOK, 'src', 'components', 'nginx_console', 'RvpSecimTab.tsx');

function tsYukle() {
  try {
    return require('typescript');
  } catch (e) {
    throw new Error('typescript paketi yok - RP Secimi bekcisi KOSAMADI (yesil sayilmaz): ' + e.message);
  }
}
function yukle(dosya) {
  const ts = tsYukle();
  const cikti = ts.transpileModule(fs.readFileSync(dosya, 'utf8'), {
    fileName: path.basename(dosya),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', cikti)(m, m.exports, () => {
    throw new Error('rvpSecim.ts disa bagimli olmamali (saf veri + karar)');
  });
  return m.exports;
}

const M = yukle(SRC);
const TAB_RAW = fs.readFileSync(TAB, 'utf8');
/** Kutunun sunucu adlari (sira onemsiz, kume olarak). */
const adlar = (blok) => (blok && blok.sunucular ? blok.sunucular.map((s) => s.host).sort() : null);
const T14_21 = ['GBNGXT14', 'GBNGXT15', 'GBNGXT16', 'GBNGXT17', 'GBNGXT18', 'GBNGXT19', 'GBNGXT20', 'GBNGXT21'];

// ── RVP-1 soru sirasi ─────────────────────────────────────────────────────────────────
test('RVP-1 soru sirasi: glomo yalniz ARK+internet, nprAcik yalniz internet ve Glomo DISINDA', () => {
  const sor = M.rvpSiradakiSoru;
  assert.equal(sor({}), 'backend');
  assert.equal(sor({ backend: 'hicbiri' }), null, "'hicbiri' baska soru sormamali");
  assert.equal(sor({ backend: 'ark' }), 'kitle');
  assert.equal(sor({ backend: 'ark', kitle: 'internet' }), 'glomo');
  assert.equal(
    sor({ backend: 'hosting', kitle: 'internet' }),
    'nprAcik',
    'Hosting dalinda Glomo ayrimi YOK, dogrudan nprAcik sorulmali',
  );
  assert.equal(
    sor({ backend: 'ark', kitle: 'internet', glomo: 'glomo' }),
    null,
    'Glomo her halde RVP kaydina gider - nprAcik sormak gereksiz soru',
  );
  assert.equal(sor({ backend: 'ark', kitle: 'internet', glomo: 'nonglomo' }), 'nprAcik');
  assert.equal(sor({ backend: 'ark', kitle: 'internet', glomo: 'nonglomo', nprAcik: 'evet' }), null);
  assert.equal(sor({ backend: 'ark', kitle: 'intranet' }), null, 'intranette nprAcik sorulmamali');
  assert.equal(sor({ backend: 'hosting', kitle: 'intranet' }), null);
});

test('RVP-1b eksik secimde oneri YOK (yarim cevapla sunucu gosterilmez)', () => {
  for (const s of [{}, { backend: 'ark' }, { backend: 'ark', kitle: 'internet' }, { backend: 'hosting', kitle: 'internet' }])
    assert.equal(M.rvpOner(s), null, JSON.stringify(s));
});

// ── RVP-2 'hicbiri' -> ekip ───────────────────────────────────────────────────────────
test("RVP-2 'hicbiri': sunucu gosterilmez, GT Agile BMW ekibine yonlendirir", () => {
  const r = M.rvpOner({ backend: 'hicbiri' });
  assert.equal(r.durum, 'ekip');
  assert.match(r.baslik, /GT Agile BMW/);
  assert.equal(r.nonProd, undefined, "'hicbiri' dalinda sunucu blogu OLMAMALI");
  assert.equal(r.prod, undefined);
});

// ── RVP-3 ARK + internet + Glomo -> RVP kaydi ─────────────────────────────────────────
test('RVP-3 ARK + internet + Glomo: sunucu DEGIL, RVP kaydina yonlendirir', () => {
  const r = M.rvpOner({ backend: 'ark', kitle: 'internet', glomo: 'glomo' });
  assert.equal(r.durum, 'rvp');
  assert.equal(r.rvpYolu, '/self-service/nginx-rvp-operations');
  assert.equal(r.nonProd, undefined, 'Glomo dalinda sunucu listesi gosterilmemeli');
  assert.equal(r.prod, undefined);
});

// ── RVP-4 ARK + internet + Non-Glomo ─────────────────────────────────────────────────
test('RVP-4 ARK + internet + Non-Glomo: non-prod nprAcik ile DEGISIR, prod sabit', () => {
  const acik = M.rvpOner({ backend: 'ark', kitle: 'internet', glomo: 'nonglomo', nprAcik: 'evet' });
  assert.deepEqual(adlar(acik.nonProd), ['GBNGXD02', 'GBNGXQ02', 'GBNGXT34']);
  const kapali = M.rvpOner({ backend: 'ark', kitle: 'internet', glomo: 'nonglomo', nprAcik: 'hayir' });
  assert.deepEqual(adlar(kapali.nonProd), T14_21.slice().sort());
  assert.match(kapali.nonProd.not, /internete açılmayacak/i, 'T14-21 kutusunun sebebi yazili degil');
  // production ikisinde de AYNI ve kullanicinin verdigi liste
  const bekl = ['GBNGXAP28', 'GBNGXAP29', 'GBNGXP44', 'GBNGXP45', 'GBNGXP58', 'GBNGXP59'];
  assert.deepEqual(adlar(acik.prod), bekl);
  assert.deepEqual(adlar(kapali.prod), bekl);
});

// ── RVP-5 ARK + intranet ─────────────────────────────────────────────────────────────
test('RVP-5 ARK + intranet: D50/T50/Q50 ve P50-53 + AP50/51', () => {
  const r = M.rvpOner({ backend: 'ark', kitle: 'intranet' });
  assert.deepEqual(adlar(r.nonProd), ['GBNGXD50', 'GBNGXQ50', 'GBNGXT50']);
  assert.deepEqual(adlar(r.prod), ['GBNGXAP50', 'GBNGXAP51', 'GBNGXP50', 'GBNGXP51', 'GBNGXP52', 'GBNGXP53']);
});

// ── RVP-6 Hosting ────────────────────────────────────────────────────────────────────
test('RVP-6 Hosting + internet: non-prod GBRNAT01 / T14-21, prod GBRNAP + GBRNAAP', () => {
  const acik = M.rvpOner({ backend: 'hosting', kitle: 'internet', nprAcik: 'evet' });
  assert.deepEqual(adlar(acik.nonProd), ['GBRNAT01']);
  const kapali = M.rvpOner({ backend: 'hosting', kitle: 'internet', nprAcik: 'hayir' });
  assert.deepEqual(adlar(kapali.nonProd), T14_21.slice().sort());
  assert.deepEqual(adlar(acik.prod), ['GBRNAAP01', 'GBRNAAP02', 'GBRNAP01', 'GBRNAP02']);
});

test("RVP-6b Hosting + intranet: production TANIMSIZ - bos liste 'sunucu yok' demek DEGIL", () => {
  const r = M.rvpOner({ backend: 'hosting', kitle: 'intranet' });
  assert.deepEqual(adlar(r.nonProd), T14_21.slice().sort());
  assert.equal(r.prod.durum, 'tanimsiz', 'production kutusu tanimsiz isaretlenmemis');
  assert.deepEqual(r.prod.sunucular, []);
  assert.match(r.prod.not, /HENÜZ TANIMLI DEĞİL/);
  assert.match(r.prod.not, /GT Agile BMW/);
});

// ── RVP-7 ustveri Excel'den; uydurma yok ─────────────────────────────────────────────
test("RVP-7 her onerilen sunucunun Excel ustverisi var; bilinmeyen ad '?' ile isaretlenir", () => {
  const hepsi = [
    { backend: 'ark', kitle: 'internet', glomo: 'nonglomo', nprAcik: 'evet' },
    { backend: 'ark', kitle: 'internet', glomo: 'nonglomo', nprAcik: 'hayir' },
    { backend: 'ark', kitle: 'intranet' },
    { backend: 'hosting', kitle: 'internet', nprAcik: 'evet' },
    { backend: 'hosting', kitle: 'internet', nprAcik: 'hayir' },
    { backend: 'hosting', kitle: 'intranet' },
  ];
  let n = 0;
  for (const s of hepsi) {
    const r = M.rvpOner(s);
    for (const blok of [r.nonProd, r.prod]) {
      if (!blok || blok.durum !== 'sunucu') continue;
      for (const srv of blok.sunucular) {
        n++;
        assert.match(srv.host, /^GB[A-Z0-9]+$/, srv.host);
        assert.ok(srv.domain !== '?' && srv.domain, `${srv.host}: domain ustverisi yok`);
        assert.ok(srv.subnet !== '?' && srv.subnet, `${srv.host}: subnet ustverisi yok`);
        assert.ok(srv.surum !== '?' && srv.surum, `${srv.host}: nginx surumu yok`);
        assert.ok(['Pendik', 'Ankara'].includes(srv.lokasyon), `${srv.host}: lokasyon`);
      }
    }
  }
  assert.ok(n >= 30, `onerilen sunucu sayisi beklenenden az: ${n}`);
  const yok = M.rvpSunucu('GBYOK99');
  assert.equal(yok.domain, '?', 'bilinmeyen sunucu ustverisi UYDURULUYOR');
});

test('RVP-7b onayli liste disindakiler oneri olarak CIKMAZ (GBNGXT07, Edu asamasi, Ankara QA intranet)', () => {
  const cikanlar = new Set();
  for (const s of [
    { backend: 'ark', kitle: 'internet', glomo: 'nonglomo', nprAcik: 'evet' },
    { backend: 'ark', kitle: 'internet', glomo: 'nonglomo', nprAcik: 'hayir' },
    { backend: 'ark', kitle: 'intranet' },
    { backend: 'hosting', kitle: 'internet', nprAcik: 'evet' },
    { backend: 'hosting', kitle: 'internet', nprAcik: 'hayir' },
    { backend: 'hosting', kitle: 'intranet' },
  ]) {
    const r = M.rvpOner(s);
    for (const blok of [r.nonProd, r.prod])
      if (blok && blok.durum === 'sunucu') for (const srv of blok.sunucular) cikanlar.add(srv.host);
  }
  // GBNGXT07: 2026-10-01'de onayli reverse proxy listesinin disinda birakildi.
  // GBNGXT39/40/41/42, GBNGXT51: Edu asamasi - kullanici "yalniz saydiklarim" dedi.
  // GBNGXAQ50: Ankara QA intranet - ayni karar.
  for (const h of ['GBNGXT07', 'GBNGXT39', 'GBNGXT40', 'GBNGXT41', 'GBNGXT42', 'GBNGXT51', 'GBNGXAQ50'])
    assert.ok(!cikanlar.has(h), `${h} oneri olarak cikiyor - onayli liste disinda`);
});

// ── RVP-8 ekran: salt okunur, sorular tek yerden, secim degisince alt cevaplar silinir ─
test('RVP-8 ekran salt okunur: is baslatan/yazan hicbir cagri yok', () => {
  for (const kotu of ['fetch(', 'Api.', 'axios', 'POST', 'method:'])
    assert.ok(!TAB_RAW.includes(kotu), `RP Secimi ekraninda yazma/istek izi var: ${kotu}`);
  assert.ok(TAB_RAW.includes('rvpOner(secim)'), 'ekran karar fonksiyonunu kullanmiyor');
  assert.ok(TAB_RAW.includes('rvpSiradakiSoru(secim)'), 'ekran soru sirasini kendi uyduruyor');
  // Dort soru da TEK YERDE (RVP_SORULAR); ekranda ayri bir soru metni dizisi olmamali.
  // Sayim YALNIZ RVP_SORULAR govdesinde: `type Soru` bildirimindeki birlesim de eslesiyordu.
  const b = TAB_RAW.indexOf('export const RVP_SORULAR');
  assert.ok(b > 0, 'RVP_SORULAR kaynakta yok');
  const govde = TAB_RAW.slice(b, TAB_RAW.indexOf('] as const;', b));
  const sorular = (govde.match(/^\s{4}anahtar: '(backend|kitle|glomo|nprAcik)',$/gm) || []).length;
  assert.equal(sorular, 4, `RVP_SORULAR dort soru tasimiyor: ${sorular}`);
  for (const a of ['backend', 'kitle', 'glomo', 'nprAcik'])
    assert.ok(govde.includes(`anahtar: '${a}',`), `RVP_SORULAR'da ${a} sorusu yok`);
  assert.ok(
    /for \(const k of sira\.slice\(i\)\) delete yeni\[k\]/.test(TAB_RAW),
    'bir soru degistirildiginde SONRAKI cevaplar silinmiyor - eski cevapla yeni dal karisir',
  );
});

// ── RVP-9 sekme kaydi: sayfa + gorunurluk + seed ucunun UCU birden ───────────────────
test('RVP-9 sekme uc yerde de kayitli (sayfa, gorunurluk uclari, DB seed) ve varsayilan KAPALI', () => {
  const page = fs.readFileSync(path.join(KOK, 'src', 'components', 'nginx_console', 'NginxConsolePage.tsx'), 'utf8');
  assert.ok(/'rvpsecim'/.test(page), 'Tab birlesiminde/TABS dizisinde rvpsecim yok');
  assert.ok(page.includes("{ id: 'rvpsecim', label: 'RP Seçimi'"), 'HUB_TABS kaydi yok');
  assert.ok(
    page.includes("tab === 'rvpsecim' && canSee('tab:nginx:rvpsecim') && <RvpSecimTab />"),
    'sekme icerigi gorunurluk kapisindan gecmiyor',
  );
  const vis = fs.readFileSync(path.join(KOK, 'server', 'auth', 'visibility-routes.cjs'), 'utf8');
  const i = vis.indexOf('const NGINX_TAB_KEYS = [');
  assert.ok(
    vis.slice(i, vis.indexOf('];', i)).includes("'rvpsecim'"),
    'NGINX_TAB_KEYS\'te yok - Admin ekranindan YETKILENDIRILEMEZ (sekme hic gorunmez)',
  );
  const db = fs.readFileSync(path.join(KOK, 'server', 'db', 'mssql-setup.cjs'), 'utf8');
  const j = db.indexOf("element_key: 'tab:nginx:rvpsecim',");
  assert.ok(j > 0, 'DB seed kaydi yok');
  const blk = db.slice(j, j + 300);
  assert.ok(blk.includes("parent_key: 'NginxConsole'"), 'seed parent yanlis');
  assert.ok(blk.includes('default_visible: 0'), 'seed varsayilani ACIK');
  const k = db.indexOf('const NGINX_TAB_KEYS_SEED = [');
  assert.ok(db.slice(k, db.indexOf('];', k)).includes("'rvpsecim'"), 'NGINX_TAB_KEYS_SEED\'te yok');
});

// ── RVP-10 kaynak notu: bu sekme HICBIR ISTEN beslenmez ──────────────────────────────
// Nginx Hub her sekmenin basinda "hangi is besliyor" yazar. Bu sekmeyi var olan bir job'a
// baglamak, elle guncellenen Excel listesini TAZE OLCUM gibi gosterirdi.
test('RVP-10 kaynak notu var olan bir AWX isini sahiplenmez; elle guncellendigini soyler', () => {
  const page = fs.readFileSync(path.join(KOK, 'src', 'components', 'nginx_console', 'NginxConsolePage.tsx'), 'utf8');
  assert.ok(page.includes("rvpsecim: 'rvpstatic'"), 'SOURCE_OF kaydi yok ya da baska bir kaynaga bagli');
  const note = fs.readFileSync(path.join(KOK, 'src', 'components', 'nginx_console', 'SourceNote.tsx'), 'utf8');
  const i = note.indexOf('rvpstatic: {');
  assert.ok(i > 0, 'rvpstatic kaynagi tanimli degil');
  const blk = note.slice(i, note.indexOf('},', i));
  assert.ok(!/job: '[a-z_]+'/.test(blk), 'rvpstatic var olan bir job adini sahipleniyor');
  assert.match(blk, /elle güncellen/i, 'notta listenin elle guncellendigi yazili degil');
  assert.match(blk, /taramadan GELMEZ/, 'notta "taramadan gelmez" uyarisi yok');
});
