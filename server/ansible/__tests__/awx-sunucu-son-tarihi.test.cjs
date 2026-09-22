// server/ansible/__tests__/awx-sunucu-son-tarihi.test.cjs
//
// TEK BIR AWX SUNUCUSU TUM YANITI REHIN ALMASIN (P2-2).
//
// Uretim olcumu: `GET /api/ansible/awx/recent-jobs` 112 yavas istek, ortalama
// 4,2 sn, EN FAZLA 25,0 sn. Bu uc gosterge panosundan 15 SANIYEDE BIR
// yoklaniyor (DashboardPage), yani 25 saniyelik bir yanit yoklamalarin ust uste
// binmesi demek.
//
// MEVCUT `timeout` DEGERLERI BU ISI GORMEZ — hepsi HAREKETSIZLIK zaman asimi:
// damla damla veri gonderen bir sunucu onlari her parcada sifirlar. Ayrica
// token alimi tek basina zincirleniyor (OAuth2 iki yol + /api/v2/tokens/).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER_SRC = fs.readFileSync(path.join(ROOT, 'server/ansible/runner.cjs'), 'utf8');

/**
 * ASILMAYA DAYANIKLI BEKLEME. Bu suitteki testlerin konusu ZAMAN ASIMIDIR;
 * yarismayi bozan bir mutasyon promise'i hic cozmez ve `await` YALNIZCA o
 * testi degil DOSYADAKI HEPSINI sonsuza dek bloklar — yani mutasyon turu
 * "kor bekci" degil "hic bitmedi" uretirdi. Her bekleyis kendi sinirini tasir.
 * (Ayni ders `job-output-bounds.test.cjs`te de yazili.)
 */
function sureSinirli(p, ms, etiket) {
  // Kendi zamanlayicisini TEMIZLER: aksi halde SN4'un (sizinti) sayimi bu
  // yardimcinin zamanlayicisini gorur ve URETIM kodunu degil KENDINI olcerdi.
  let t = null;
  const sinir = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${etiket}: ${ms} ms icinde cozulmedi`)), ms);
  });
  return Promise.race([p, sinir]).finally(() => clearTimeout(t));
}

function kodOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Fail-closed dilim: sinir bulunamazsa testi DUSUR. */
function dilim(src, bas, son) {
  const i = src.indexOf(bas);
  assert.ok(i >= 0, `dilim baslangici yok: ${bas}`);
  const j = src.indexOf(son, i + bas.length);
  assert.ok(j > i, `dilim sonu yok: ${son}`);
  return src.slice(i, j);
}

/**
 * GERCEK `sonTarihli` govdesi — kopyasi degil.
 *
 * `sayac` verilirse zamanlayicilar SAYILIR. Bu gerekli, cunku uretim kodu
 * `unref()` cagiriyor ve `process.getActiveResourcesInfo()` unref'li bir
 * zamanlayiciyi GORMEZ — o olcuyle yazilan ilk SN4 KORDU (mutasyon
 * `clearTimeout`u kaldirdiginda bile geciyordu). Zamanlayicilari dogrudan
 * saymak, olcmek istedigimiz degismeze birebir baglidir.
 */
function gercekSonTarihli(sayac = null) {
  const i = RUNNER_SRC.indexOf('function sonTarihli(');
  const j = RUNNER_SRC.indexOf('\nfunction getServers()');
  assert.ok(i > 0 && j > i, 'kaynak cikarimi bozuldu — desen degismis');
  const st = sayac
    ? (fn, ms) => { sayac.kurulan++; return setTimeout(fn, ms); }
    : setTimeout;
  const ct = sayac
    ? (t) => { if (t) sayac.temizlenen++; return clearTimeout(t); }
    : clearTimeout;
  return new Function('setTimeout', 'clearTimeout',
    `${RUNNER_SRC.slice(i, j)}\nreturn sonTarihli;`)(st, ct);
}

test('SN1 son tarih gecince YEDEK doner ve BEKLEMEZ', async () => {
  const sonTarihli = gercekSonTarihli();
  const asilan = new Promise(() => {}); // hicbir zaman cozulmez
  const t0 = Date.now();
  const r = await sureSinirli(
    sonTarihli(asilan, 120, () => ({ ok: false, error: 'zaman asimi' })),
    5000,
    'SN1',
  );
  const gecen = Date.now() - t0;
  assert.equal(r.error, 'zaman asimi');
  assert.ok(gecen < 2000, `${gecen} ms beklendi — son tarih isletilmedi`);
});

test('SN2 is ZAMANINDA biterse GERCEK sonuc doner (yedek kazanmaz)', async () => {
  const sonTarihli = gercekSonTarihli();
  const hizli = Promise.resolve({ ok: true, jobs: [1, 2, 3] });
  const r = await sureSinirli(sonTarihli(hizli, 5000, () => ({ ok: false, error: 'olmamali' })), 5000, 'SN2');
  assert.equal(r.ok, true);
  assert.deepEqual(r.jobs, [1, 2, 3]);
});

test('SN3 yedek TEMBEL: is zamaninda biterse yedek HIC uretilmez', async () => {
  const sonTarihli = gercekSonTarihli();
  let uretildi = 0;
  await sureSinirli(sonTarihli(Promise.resolve('ok'), 5000, () => { uretildi++; return 'yedek'; }), 5000, 'SN3');
  assert.equal(uretildi, 0, 'yedek her cagride uretiliyor — yan etkili bir yedek zarar verirdi');
});

test('SN4 KURULAN her zamanlayici TEMIZLENIR (sizinti yok)', async () => {
  const sayac = { kurulan: 0, temizlenen: 0 };
  const sonTarihli = gercekSonTarihli(sayac);
  await sureSinirli(
    Promise.all(Array.from({ length: 30 }, () => sonTarihli(Promise.resolve(1), 60_000, () => 2))),
    5000,
    'SN4',
  );
  assert.equal(sayac.kurulan, 30, 'zamanlayici kurulmamis — son tarih yok');
  assert.equal(
    sayac.temizlenen, 30,
    `${sayac.kurulan - sayac.temizlenen} zamanlayici asili kaldi; her biri 60 sn boyunca ` +
      'kapanisini (ve icindeki `server`/`yedek` nesnelerini) tutar',
  );
});

test('SN5 is REDDEDERSE red gecer (hata yutulmaz)', async () => {
  const sonTarihli = gercekSonTarihli();
  await assert.rejects(
    () => sureSinirli(sonTarihli(Promise.reject(new Error('patladi')), 5000, () => 'yedek'), 5000, 'SN5'),
    /patladi/,
    'red sessizce yedege cevrildi — gercek hata kaybolurdu',
  );
});

test('SN6 recent-jobs HER sunucuyu son tarihe bagliyor', () => {
  const kod = kodOnly(RUNNER_SRC);
  const d = dilim(kod, "app.get('/api/ansible/awx/recent-jobs'", 'res.json({ ok: true, servers: results });');
  assert.match(d, /servers\.map\(\(server\) =>\s*\n?\s*sonTarihli\(/, 'sunucular son tarihe baglanmamis');
  assert.doesNotMatch(d, /if\s*\(\s*(false|0|null|undefined)\s*\)/, 'olu dal');
});

test('SN7 son tarih ISTEMCININ YOKLAMA ARALIGINDAN kucuk', () => {
  // Pano `recent-jobs`i 15 sn'de bir yokluyor. Son tarih bundan buyuk olursa
  // yoklamalar ust uste biner ve duzeltme HICBIR SEY cozmez.
  const m = RUNNER_SRC.match(/const AWX_SUNUCU_SON_TARIH_MS = (\d+);/);
  assert.ok(m, 'AWX_SUNUCU_SON_TARIH_MS bulunamadi');
  const sonTarih = Number(m[1]);

  const pano = fs.readFileSync(path.join(ROOT, 'src/components/DashboardPage.tsx'), 'utf8');
  const i = pano.indexOf('.recentJobs()');
  assert.ok(i > 0, 'panoda recentJobs cagrisi bulunamadi');
  const arayikMetni = pano.slice(i, i + 900).match(/setInterval\(load,\s*([\d_]+)\)/);
  assert.ok(arayikMetni, 'yoklama araligi bulunamadi');
  const aralik = Number(arayikMetni[1].replace(/_/g, ''));

  assert.ok(
    sonTarih < aralik,
    `son tarih ${sonTarih} ms, yoklama araligi ${aralik} ms — yoklamalar ust uste biner`,
  );
});

test('SN8 son tarih MEVCUT idle timeoutlardan kucuk (yoksa hic ateslenmez)', () => {
  const m = RUNNER_SRC.match(/const AWX_SUNUCU_SON_TARIH_MS = (\d+);/);
  const sonTarih = Number(m[1]);
  // `awxRequestToServer`in kendi (hareketsizlik) zaman asimi.
  const istek = dilim(kodOnly(RUNNER_SRC), 'function awxRequestToServer(', 'const req = lib.request(');
  const t = istek.match(/timeout:\s*(\d+)/);
  assert.ok(t, 'awxRequestToServer timeout bulunamadi');
  assert.ok(
    sonTarih < Number(t[1]),
    `son tarih (${sonTarih}) istek zaman asimindan (${t[1]}) buyuk — pratikte HIC ateslenmez`,
  );
});

test('SN9 yedek sonuc ucun SOZLESMESINE uyar (ekran onu cizebilmeli)', () => {
  const kod = kodOnly(RUNNER_SRC);
  const d = dilim(kod, 'sonTarihli(sunucununIsleri(server)', 'res.json({ ok: true, servers: results });');
  for (const alan of ['serverId', 'serverName', 'ok', 'jobs', 'error']) {
    assert.match(d, new RegExp(`${alan}\\s*:`), `yedek sonucta ${alan} yok — ekran cizemez`);
  }
  // `jobs` DIZI olmali: ekran `s.jobs.length` okuyor, `undefined` patlatirdi.
  assert.match(d, /jobs:\s*\[\]/, 'yedekte jobs bos DIZI degil');
});
