// server/audit/__tests__/memory-bounds.test.cjs
//
// YUKSEK RISKLI SINIRSIZ-BELLEK YOLLARI — hepsi GERCEK kod kosturularak sinanir.
//
// Portal 2026-09'da UC KEZ OOM ile coktu; ucunun de koku ayni sinifti: sinirsiz
// tamponlama. Uc yol kapatildiktan sonra yapilan taramada DORT YUKSEK riskli yol
// daha bulundu — biri, OOM'a karsi yazilmis denetim spool'unun KENDISI.
//
// BU TESTLER DESEN ESLEMESI YAPMAZ. Bir bekci "kapi var mi" diye kaynak metne
// bakarsa, kapi yanlis dala konulmus ya da hic ates almiyor olsa bile yesil
// kalir (bu depoda tam bu bicimde defalarca kor bekci cikti). Burada her kapi
// GERCEK girdiyle tetiklenir ve DAVRANIS olculur.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ── SP: server/audit/spool.cjs ──────────────────────────────────────────────

function geciciSpool() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spool-'));
  const onceki = process.env.LOG_DIR;
  process.env.LOG_DIR = dir;
  // `spoolPath` LOG_DIR'i CAGRI ANINDA okuyor, modul yuklenirken degil — yine de
  // onbellege guvenmemek icin modulu taze cozumluyoruz.
  delete require.cache[require.resolve('../spool.cjs')];
  const spool = require('../spool.cjs');
  return {
    spool,
    dir,
    temizle() {
      if (onceki === undefined) delete process.env.LOG_DIR;
      else process.env.LOG_DIR = onceki;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('SP1 tek girdi SATIR TAVANINI asamaz (detail kirpilir, girdi ATILMAZ)', () => {
  const { spool, temizle } = geciciSpool();
  try {
    const dev = 'x'.repeat(5 * 1024 * 1024); // 5 MB detail
    assert.equal(spool.append('t', { username: 'u', action: 'a', detail: dev }), true);

    const satirlar = fs
      .readFileSync(spool.spoolPath('t'), 'utf8')
      .split('\n')
      .filter((l) => l.trim());
    assert.equal(satirlar.length, 1, 'girdi ATILMIS — kayip kabul edilemez');
    assert.ok(
      Buffer.byteLength(satirlar[0], 'utf8') <= spool.SPOOL_MAX_LINE_BYTES,
      `satir tavani asildi: ${Buffer.byteLength(satirlar[0], 'utf8')}`,
    );
    const kayit = JSON.parse(satirlar[0]);
    assert.equal(kayit.entry.username, 'u', 'kim alani KAYBOLMUS');
    assert.equal(kayit.entry.action, 'a', 'ne alani KAYBOLMUS');
    assert.match(kayit.entry.detail, /KIRPILDI/, 'kirpma SESSIZ — soylenmiyor');
  } finally {
    temizle();
  }
});

test('SP2 dosya TAVANA ulasinca yeni girdi REDDEDILIR (sessizce buyumez)', () => {
  const { spool, temizle } = geciciSpool();
  const hatalar = [];
  const ozgun = console.error;
  console.error = (...a) => hatalar.push(a.join(' '));
  try {
    // Tavani asan bir dosyayi dogrudan kur — milyonlarca append atmadan.
    fs.mkdirSync(path.dirname(spool.spoolPath('t')), { recursive: true });
    fs.writeFileSync(spool.spoolPath('t'), 'x'.repeat(spool.SPOOL_MAX_BYTES + 1));

    assert.equal(
      spool.append('t', { username: 'u', action: 'a', detail: 'd' }),
      false,
      'tavan asilmisken append true dondu — dosya sinirsiz buyur',
    );
    assert.ok(
      hatalar.some((h) => /KAYIT KAYBI/.test(h)),
      'tavan asildi ama SESSIZ kalindi',
    );
  } finally {
    console.error = ozgun;
    temizle();
  }
});

test('SP3 `depth` dosyayi BELLEGE ALMADAN sayar', () => {
  const { spool, temizle } = geciciSpool();
  try {
    const file = spool.spoolPath('t');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 200 bin satir ~ 10 MB. Eski hali readFileSync + split('\n') yapiyordu ve
    // bu fonksiyon HER 5 DAKIKADA cagriliyor.
    const satir = JSON.stringify({ ts: 'x', entry: { username: 'u', action: 'a', detail: 'd' } });
    const parca = (satir + '\n').repeat(1000);
    const akis = fs.createWriteStream(file);
    for (let i = 0; i < 200; i++) akis.write(parca);
    akis.end();

    return new Promise((cozumle) => {
      akis.on('close', () => {
        if (global.gc) global.gc();
        const onceHeap = process.memoryUsage().heapUsed;
        assert.equal(spool.depth('t'), 200000, 'satir sayisi yanlis');
        const sonraHeap = process.memoryUsage().heapUsed;
        const artis = sonraHeap - onceHeap;
        const boyut = fs.statSync(file).size;
        // Dosya ~10 MB. `readFileSync` + `split` en az dosya boyutu kadar (pratikte
        // 3-4 kati) heap ister. Dosya boyutunun YARISI bile kalici olarak
        // artmamali — akis tabanli sayim sabit bellek kullanir.
        assert.ok(
          artis < boyut / 2,
          `depth() dosyayi bellege aldi: dosya ${boyut} B, heap artisi ${artis} B`,
        );
        temizle();
        cozumle();
      });
    });
  } catch (e) {
    temizle();
    throw e;
  }
});

test('SP4 `drain` sirayi korur, ILK BASARISIZLIKTA durur, kalani dosyada birakir', async () => {
  const { spool, temizle } = geciciSpool();
  try {
    for (let i = 1; i <= 5; i++) {
      spool.append('t', { username: 'u', action: `a${i}`, detail: 'd' });
    }
    const gorulen = [];
    const sonuc = await spool.drain('t', async (entry) => {
      gorulen.push(entry.action);
      return entry.action !== 'a3'; // 3. kayitta DB hala bozuk
    });

    assert.deepEqual(gorulen, ['a1', 'a2', 'a3'], 'sira bozuldu ya da durmadi');
    assert.equal(sonuc.drained, 2, 'basarisiz kayit aktarilmis sayildi');
    assert.equal(sonuc.remaining, 3, 'kalan sayisi yanlis');

    // Kalanlar DOSYADA, ve SIRASI korunmus olmali.
    const kalan = fs
      .readFileSync(spool.spoolPath('t'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l).entry.action);
    assert.deepEqual(kalan, ['a3', 'a4', 'a5'], 'kalan kayitlar/sira bozuk');
  } finally {
    temizle();
  }
});

test('SP5 `drain` tek turda TUR TAVANINDAN fazlasini aktarmaz', async () => {
  const { spool, temizle } = geciciSpool();
  try {
    const n = spool.DRAIN_BATCH_LINES + 250;
    const file = spool.spoolPath('t');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let metin = '';
    for (let i = 0; i < n; i++) {
      metin += JSON.stringify({ ts: 'x', entry: { username: 'u', action: 'a', detail: 'd' } }) + '\n';
    }
    fs.writeFileSync(file, metin);

    const sonuc = await spool.drain('t', async () => true);
    assert.equal(sonuc.drained, spool.DRAIN_BATCH_LINES, 'tur tavani uygulanmadi');
    assert.equal(sonuc.remaining, 250, 'kalanlar dosyada tutulmadi');

    // Sonraki tur kaldigi yerden devam etmeli.
    const ikinci = await spool.drain('t', async () => true);
    assert.equal(ikinci.drained, 250);
    assert.equal(ikinci.remaining, 0);
    assert.equal(fs.existsSync(file), false, 'bosalan spool dosyasi silinmedi');
  } finally {
    temizle();
  }
});

// ── DT: server/dynatrace/cache.cjs ──────────────────────────────────────────

test('DT1 onbellek GIRIS SAYISINI sinirlar (kullanici anahtari heap doldurmaz)', () => {
  delete require.cache[require.resolve('../../dynatrace/cache.cjs')];
  const cache = require('../../dynatrace/cache.cjs');
  cache.clear();
  // `?host=` serbest metin: saldirgan/dikkatsiz bir dongu binlerce anahtar uretir.
  for (let i = 0; i < 5000; i++) cache.set(`events-prod-x-1-host("h${i}")`, { i });
  assert.ok(
    cache.stats().entries <= cache.MAX_ENTRIES,
    `giris sayisi sinirsiz: ${cache.stats().entries}`,
  );
  cache.clear();
});

test('DT2 TAVANI ASAN yanit onbellege ALINMAZ', () => {
  delete require.cache[require.resolve('../../dynatrace/cache.cjs')];
  const cache = require('../../dynatrace/cache.cjs');
  cache.clear();
  cache.set('dev', { blob: 'x'.repeat(cache.MAX_ENTRY_BYTES + 1024) });
  assert.equal(cache.get('dev', 60000), null, 'dev yanit onbellege alindi');
  assert.equal(cache.stats().entries, 0);
  cache.clear();
});

test('DT3 SURESI DOLAN giris SILINIR (TTL bellegi de korur)', () => {
  delete require.cache[require.resolve('../../dynatrace/cache.cjs')];
  const cache = require('../../dynatrace/cache.cjs');
  cache.clear();
  cache.set('k', { a: 1 });
  assert.equal(cache.stats().entries, 1);
  assert.equal(cache.get('k', 0), null, 'suresi dolmus giris veri dondu');
  assert.equal(
    cache.stats().entries,
    0,
    'suresi dolan giris SILINMEDI — TTL yalnizca tazeligi koruyor, bellegi degil',
  );
  cache.clear();
});

// ── VC: verifyChain sayfalamasi ─────────────────────────────────────────────

test('VC1 `verifyChain` TUM tabloyu tek sorguda ISTEMEZ ve zinciri sayfalar arasi TASIR', async () => {
  // Sahte bir `db`: her sorguyu kaydeder, sayfali dilim dondurur.
  const crypto = require('node:crypto');
  const HASH_PREFIX = 'v3:';
  const hash = (prev, u, a, d) =>
    HASH_PREFIX + crypto.createHash('sha256').update(`${prev}|${u}|${a}|${d}`).digest('hex');

  const N = 4500; // sayfa boyu 2000 -> uc sayfa
  const rows = [];
  let prev = '';
  for (let i = 1; i <= N; i++) {
    const h = hash(prev, 'u', 'a', `d${i}`);
    rows.push({ id: i, username: 'u', action: 'a', detail: `d${i}`, prev_hash: prev, entry_hash: h });
    prev = h;
  }

  const sorgular = [];
  const db = {
    async query(sql, params) {
      sorgular.push({ sql, params });
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: N }] };
      assert.match(sql, /OFFSET .* FETCH NEXT/, 'zincir sorgusu SAYFASIZ — tum tablo bellege gider');
      const [offset, limit] = params;
      return { rows: rows.slice(offset, offset + limit) };
    },
  };

  const { createAuditChain } = loadAuditModule(db);
  const chain = createAuditChain('portal_audit_logs');
  const sonuc = await chain.verifyChain();

  assert.equal(sonuc.ok, true, 'saglam zincir KIRIK raporlandi');
  assert.equal(sonuc.verified, N, `dogrulanan sayi yanlis: ${sonuc.verified}`);
  assert.equal(sonuc.broken, 0);
  const sayfali = sorgular.filter((q) => /OFFSET/.test(q.sql));
  assert.ok(sayfali.length >= 3, `sayfalama yapilmadi (${sayfali.length} sorgu)`);
  for (const q of sayfali) {
    assert.ok(q.params[1] <= 5000, `sayfa boyu cok buyuk: ${q.params[1]}`);
  }
});

test('VC2 SAYFA SINIRINDAKI kurcalama gorulur (zincir sayfa basinda sifirlanmiyor)', async () => {
  const crypto = require('node:crypto');
  const HASH_PREFIX = 'v3:';
  const hash = (prev, u, a, d) =>
    HASH_PREFIX + crypto.createHash('sha256').update(`${prev}|${u}|${a}|${d}`).digest('hex');

  const N = 4500;
  const rows = [];
  let prev = '';
  for (let i = 1; i <= N; i++) {
    const h = hash(prev, 'u', 'a', `d${i}`);
    rows.push({ id: i, username: 'u', action: 'a', detail: `d${i}`, prev_hash: prev, entry_hash: h });
    prev = h;
  }
  // TAM SAYFA SINIRINDA (2001. kayit, ikinci sayfanin ILK satiri) zinciri kopar:
  // kendi hash'i kendi `prev_hash`iyle tutarli, ama ONCEKI sayfanin sonuna
  // baglanmiyor. Sayfa basinda `runningPrev` sifirlansaydi bu KACARDI.
  const kurban = rows[2000];
  kurban.prev_hash = HASH_PREFIX + 'deadbeef';
  kurban.entry_hash = hash(kurban.prev_hash, 'u', 'a', kurban.detail);

  const db = {
    async query(sql, params) {
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: N }] };
      const [offset, limit] = params;
      return { rows: rows.slice(offset, offset + limit) };
    },
  };
  const { createAuditChain } = loadAuditModule(db);
  const sonuc = await createAuditChain('portal_audit_logs').verifyChain();

  assert.equal(sonuc.ok, false, 'SAYFA SINIRINDAKI kurcalama GORULMEDI');
  assert.equal(sonuc.firstBrokenId, 2001, `yanlis kayit isaretlendi: ${sonuc.firstBrokenId}`);
});

/**
 * `server/audit/index.cjs` modul kapsaminda bir `db` bagimliligi tutuyor.
 * Onu enjekte edebilmek icin kaynak metni sahte `require` ile degerlendiriyoruz —
 * boylece test DESEN degil GERCEK `verifyChain` govdesini kosturuyor.
 */
function loadAuditModule(db) {
  const Module = require('node:module');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const m = new Module(path.join(__dirname, '..', 'index.cjs'));
  m.filename = path.join(__dirname, '..', 'index.cjs');
  m.paths = Module._nodeModulePaths(path.join(__dirname, '..'));
  const sahteRequire = (id) => {
    if (id.includes('db')) return db;
    return m.require(id);
  };
  sahteRequire.resolve = (id) => require.resolve(id);
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', src);
  fn(m.exports, sahteRequire, m, m.filename, path.dirname(m.filename));
  return m.exports;
}
