// server/nginx-console/__tests__/memory.test.cjs — URETIM OOM'U (2026-09-20):
// "FATAL ERROR: Reached heap limit ... Runtime_StringSplit". Ilk surum 311 host'un TAM
// ayristirilmis dokumunu (icerikler dahil) bellekte tutuyor, /hosts + /certs + gecmis
// taramasi hepsini birden yukluyordu. Bu test 120 sentetik host x ~2 MB dokumla /hosts
// benzeri "hepsini ozetle" akisini kosturur ve heap artisinin SINIRLI kalmasini ister.
// Eski davranisla (tam dokum onbellegi) bu test ~240 MB+ artis gosterirdi; ozet katmaniyla
// artis onlarca MB'yi gecmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('MEM1 120 host x ~2 MB dokum: ozet katmani heap\'i sinirli tutar, icerik yalniz LRU\'da', async () => {
  // Olcum GC'siz anlamsiz (toplanmamis cop artisi sisirir): --expose-gc yoksa kendini o
  // bayrakla alt surecte kosturur ve sonucunu bekler.
  if (!global.gc) {
    const { spawnSync } = require('node:child_process');
    // node --test'in alt surec ortam degiskenleri (NODE_TEST_CONTEXT...) torun surecte
    // kosuyu sessizce atlatiyor (66 ms'de status 0, olcum yok) — temizlenir; dosya
    // dogrudan (--test'siz) kosturulur, node:test tek dosyada da calisir.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST')));
    const r = spawnSync(process.execPath, ['--expose-gc', __filename], { encoding: 'utf8', env });
    const out = (r.stdout || '') + (r.stderr || '');
    const m = /\[MEM1\] heap artisi ([\d.]+) MB/.exec(out);
    assert.equal(r.status, 0, `alt surec basarisiz:\n${out.slice(-1500)}`);
    assert.ok(m, `alt surec olcum uretmedi:\n${out.slice(-800)}`);
    if (m) console.log(`[MEM1] heap artisi ${m[1]} MB (alt surec, --expose-gc)`);
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-mem-'));
  process.env.NGINX_CONSOLE_DIR = dir;
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  // ~2 MB dokum: 400 dosya x ~5 KB icerik
  const body = 'server {\n' + '  location /x { proxy_pass http://upstream; }\n'.repeat(110) + '}\n';
  const files = [];
  for (let i = 0; i < 400; i++) {
    const p = `/usr/nginx/conf.d/application-confs/app-${i}.conf`;
    files.push(`@@FILE ${p} ${String(i).padStart(64, '0')} ${body.length}\n${body}@@END`);
  }
  const tree = files.map((_, i) => `${body.length}\t2026-09-20 00:00:00\t${String(i).padStart(64, '0')}\twww\t/usr/nginx/conf.d/application-confs/app-${i}.conf`).join('\n');
  const dumpText = `@@HOST HOSTX\n@@TIME 2026-09-20T00:00:00Z\n@@PREFIX /usr/nginx\n@@NGINX_T ok\nok\n@@END\n@@TREE\n${tree}\n@@END\n${files.join('\n')}\n`;
  const HOSTS = 120;
  for (let h = 0; h < HOSTS; h++) fs.writeFileSync(path.join(dir, 'raw', `GBNGX${String(h).padStart(3, '0')}.txt`), dumpText.replace('HOSTX', `GBNGX${String(h).padStart(3, '0')}`));
  assert.ok(dumpText.length > 1_500_000, `dokum yeterince buyuk olmali: ${dumpText.length}`);

  // gecmis ingest DB ister; testte devre disi (ingestDump null doner)
  const history = require('../history.cjs');
  history.ingestDump = async () => null;
  const idx = require('../index.cjs');

  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  const hosts = fs.readdirSync(path.join(dir, 'raw')).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4));
  for (const h of hosts) {
    const sm = idx._loadSummaryForTest(h);
    assert.equal(sm.fileCount, 400);
    assert.equal(sm.certs.length, 0);
    assert.ok(!('files' in sm), 'ozet icerik tasimamali');
  }
  // yan dosyalar yazildi mi
  assert.ok(fs.existsSync(path.join(dir, 'raw', 'GBNGX000.summary.json')));
  // tam icerik: LRU en fazla 4
  for (let h = 0; h < 10; h++) {
    const full = idx._loadFullForTest(`GBNGX${String(h).padStart(3, '0')}`);
    assert.equal(full.files.size, 400);
  }
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  const growthMb = (after - before) / 1048576;
  // 120 host x 2 MB = 240 MB ham; eski davranis en az bu kadar tutardi. Ozet+LRU(4) ile < 80 MB.
  console.log(`[MEM1] heap artisi ${growthMb.toFixed(1)} MB`);
  assert.ok(growthMb < 80, `heap artisi ${growthMb.toFixed(1)} MB — tam dokumlar bellekte tutuluyor olabilir`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── MEM2/MEM3 — DOKUM BOYUT TAVANI ────────────────────────────────────────────
//
// 2026-09-20 OOM'unda KAC dokumun bellekte tutuldugu sinirlandi (`FULL_MAX = 4`),
// ama TEK BIR dokumun NE KADAR BUYUK olabilecegi hic kontrol edilmedi. Dosyayi
// AWX yaziyor ve icinde tum nginx conf agaci var; sismis tek bir host 50-200 MB
// uretebilir ve `parseDump` ustune `split('\n')` yapiyor. 4 x 200 MB yine OOM.
//
// Bu testler DESEN ARAMAZ — gercek `loadFull`/`loadSummary` cagrilir.

function devDokumKur(boyutBayt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-big-'));
  process.env.NGINX_CONSOLE_DIR = dir;
  fs.mkdirSync(path.join(dir, 'raw'), { recursive: true });
  const bas = '@@HOST BIGHOST\n@@TIME 2026-09-20T00:00:00Z\n@@PREFIX /usr/nginx\n@@TREE\n@@END\n';
  const akis = fs.createWriteStream(path.join(dir, 'raw', 'BIGHOST.txt'));
  akis.write(bas);
  const parca = '# ' + 'x'.repeat(4094) + '\n';
  let yazilan = bas.length;
  while (yazilan < boyutBayt) {
    akis.write(parca);
    yazilan += parca.length;
  }
  return new Promise((r) => akis.end(() => r(dir)));
}

test('MEM2 TAVANI ASAN dokum ayristirilmaz — `loadFull` "cok buyuk" der', async () => {
  const onceki = process.env.NGINX_CONSOLE_DIR;
  const dir = await devDokumKur(26 * 1024 * 1024); // tavan 24 MB
  try {
    delete require.cache[require.resolve('../index.cjs')];
    const mod = require('../index.cjs');
    let hata = null;
    try {
      mod._loadFullForTest('BIGHOST');
    } catch (e) {
      hata = e;
    }
    assert.ok(hata, 'dev dokum ayristirildi — bayt kapisi ATES ALMADI');
    assert.equal(hata.tooLarge, true, 'hata "cok buyuk" olarak isaretlenmemis');
    assert.equal(hata.status, 413);
    assert.match(hata.message, /boyut/i, 'kullaniciya NEDEN soylenmiyor');
  } finally {
    if (onceki === undefined) delete process.env.NGINX_CONSOLE_DIR;
    else process.env.NGINX_CONSOLE_DIR = onceki;
    fs.rmSync(dir, { recursive: true, force: true });
    delete require.cache[require.resolve('../index.cjs')];
  }
});

test('MEM3 dev dokum host\'u LISTEDEN DUSURMEZ — `loadSummary` bayrakla doner', async () => {
  const onceki = process.env.NGINX_CONSOLE_DIR;
  const dir = await devDokumKur(26 * 1024 * 1024);
  try {
    delete require.cache[require.resolve('../index.cjs')];
    const mod = require('../index.cjs');
    // `/hosts` 311 host'un hepsinde bunu cagiriyor: tek dev dokum TUM listeyi
    // 500'e dusurmemeli.
    const ozet = mod._loadSummaryForTest('BIGHOST');
    assert.ok(ozet, 'ozet null dondu — host listeden dusuyor');
    assert.equal(ozet.tooLarge, true, '"cok buyuk" bayragi yok');
    assert.equal(ozet.host, 'BIGHOST');
    assert.equal(ozet.contentAvailable, false, 'icerik yok bayragi eksik');
    assert.ok(!('files' in ozet), 'dosya icerikleri bellege alinmis');
    // 2026-09-22: ozet artik AKISLA (diskten parca parca) uretiliyor, bu yuzden yan
    // dosyaya yazilabilir. Kalici yanlis bilgi riski yok: kayit dokumun mtime'ini
    // tasir, dokum degisince (kuculunce de) yeniden uretilir.
    const yan = path.join(dir, 'raw', 'BIGHOST.summary.json');
    if (fs.existsSync(yan)) {
      const kayit = JSON.parse(fs.readFileSync(yan, 'utf8'));
      assert.equal(kayit.tooLarge, true);
      assert.equal(kayit.contentAvailable, false);
      assert.equal(
        kayit.mtimeMs,
        fs.statSync(path.join(dir, 'raw', 'BIGHOST.txt')).mtimeMs,
        'yan dosya dokum damgasini tasimali — yoksa duzelen dokum bir daha okunmaz',
      );
    }
  } finally {
    if (onceki === undefined) delete process.env.NGINX_CONSOLE_DIR;
    else process.env.NGINX_CONSOLE_DIR = onceki;
    fs.rmSync(dir, { recursive: true, force: true });
    delete require.cache[require.resolve('../index.cjs')];
  }
});


// ── MEM4 — DEV DOKUMUN YEDEK OZETI, NORMAL OZETLE AYNI SEKILDE OLMALI ─────────
//
// URETIM (2026-09-22): 8 reverse-proxy sunucusunun dokumu tavani asti ve Nginx Hub
// HIC ACILMAMAYA basladi:
//   GET /api/nginx-console/certs 500 "d.certUses is not iterable"
//   GET /api/nginx-console/hosts 500 "Cannot read properties of undefined (reading 'status')"
// Sebep: "cok buyuk" yedek ozetinde `certUses` dizi yerine {} idi ve `nginxT` hic yoktu.
// MEM3 bayragi kontrol ediyordu ama SEKLI kontrol etmiyordu; bu test onu kapatir.
test('MEM4 dev dokum ozeti normal ozetle AYNI alanlari tasir — /hosts ve /certs patlamaz', async () => {
  const onceki = process.env.NGINX_CONSOLE_DIR;
  const dir = await devDokumKur(26 * 1024 * 1024);
  try {
    // Ayni dizine KUCUK bir dokum de koy: karsilastirma icin normal ozet gerekiyor.
    const kucuk =
      '@@HOST SMALLHOST\n@@TIME 2026-09-20T00:00:00Z\n@@PREFIX /usr/nginx\n' +
      '@@NGINX_T ok\nok\n@@END\n@@TREE\n@@END\n';
    fs.writeFileSync(path.join(dir, 'raw', 'SMALLHOST.txt'), kucuk);

    delete require.cache[require.resolve('../index.cjs')];
    const mod = require('../index.cjs');
    const dev = mod._loadSummaryForTest('BIGHOST');
    const normal = mod._loadSummaryForTest('SMALLHOST');

    for (const alan of Object.keys(normal)) {
      assert.ok(alan in dev, `yedek ozette "${alan}" alani yok — tuketici uclar patlar`);
      if (Array.isArray(normal[alan])) assert.ok(Array.isArray(dev[alan]), `"${alan}" dizi olmali`);
    }
    assert.equal(typeof dev.nginxT?.status, 'string', 'nginxT.status yok — /hosts 500 doner');
    assert.ok(Array.isArray(dev.certUses), 'certUses dizi olmali — /certs 500 doner');

    // /certs ucunun yaptigi donusumun AYNISI: bozuk ozet zinciri dusurmemeli.
    const { aggregateCerts } = require('../dump-parse.cjs');
    const dumps = [dev, normal].map((sm) => ({
      host: sm.host,
      certUses: Array.isArray(sm.certUses) ? sm.certUses : [],
      certs: new Map((Array.isArray(sm.certs) ? sm.certs : []).map((c) => [c.path, c])),
      loaded: sm.loaded ?? null,
    }));
    assert.deepEqual(aggregateCerts(dumps), [], 'sertifika birlestirme dev dokumda patliyor');
  } finally {
    if (onceki === undefined) delete process.env.NGINX_CONSOLE_DIR;
    else process.env.NGINX_CONSOLE_DIR = onceki;
    fs.rmSync(dir, { recursive: true, force: true });
    delete require.cache[require.resolve('../index.cjs')];
  }
});


// ── MEM5 — AKISLI OZET: 30 MB'lik dokum Hub'da GORUNUR kalir ──────────────────
//
// Uretimde 8 reverse-proxy dokumu 31-33 MB (tavan 24 MB) ve bu sunucular Hub'da
// bos gorunuyordu. Artik dosya BELLEGE ALINMADAN, diskten parca parca okunarak
// ozetleniyor: agac, sertifikalar ve nginx -t durumu geliyor; yalniz dosya
// icerikleri gelmiyor (icerik isteyen uclar zaten "cok buyuk" diyor).
test('MEM5 akisli ayristirici: bellekteki ayristiriciyla AYNI sonucu verir; dev dokum ozetlenir', async () => {
  const { parseDump, parseDumpFileSync } = require('../dump-parse.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-stream-'));
  try {
    const govde = 'server {\n  location /x { proxy_pass http://up; }\n}\n';
    const kucukMetin =
      '@@HOST STREAMHOST\n@@TIME 2026-09-22T00:00:00Z\n@@PREFIX /usr/nginx\n' +
      '@@NGINX_T ok\nconfiguration file test is successful\n@@END\n' +
      '@@LOADED\n/usr/nginx/nginx.conf\n@@END\n' +
      '@@TREE\n120\t2026-09-22 00:00:00\tabc\twww\t/usr/nginx/nginx.conf\n@@END\n' +
      `@@FILE /usr/nginx/nginx.conf abc ${govde.length}\n${govde}@@END\n` +
      '@@CERTUSE /usr/nginx/nginx.conf\twww.example.com\t/usr/nginx/ssl/a.crt\t/usr/nginx/ssl/a.key\tok\n' +
      '@@CERT /usr/nginx/ssl/a.crt\nexists=1\nsubject=CN=www.example.com\n@@END\n';
    const dosya = path.join(dir, 'STREAMHOST.txt');
    fs.writeFileSync(dosya, kucukMetin);

    const bellekte = parseDump(kucukMetin);
    const akisla = parseDumpFileSync(dosya);
    assert.deepEqual(akisla.tree, bellekte.tree, 'agac farkli');
    assert.deepEqual([...akisla.certs.keys()], [...bellekte.certs.keys()], 'sertifikalar farkli');
    assert.deepEqual(akisla.certUses, bellekte.certUses, 'sertifika kullanimlari farkli');
    assert.deepEqual(akisla.loaded, bellekte.loaded, 'yuklenen dosya listesi farkli');
    assert.equal(akisla.nginxT.status, 'ok');
    assert.equal(akisla.files.get('/usr/nginx/nginx.conf').content, govde.trimEnd());

    // skipFileContent: icerik saklanmaz, geri kalan ayni
    const icerikSiz = parseDumpFileSync(dosya, { skipFileContent: true });
    assert.equal(icerikSiz.files.size, 0, 'icerik atlanmadi');
    assert.deepEqual(icerikSiz.tree, bellekte.tree);

    // ~26 MB dokum: 1 MB'lik okuma parcalarinin ICINDE kalan bloklar da dogru okunmali
    const buyuk = path.join(dir, 'BIGSTREAM.txt');
    const akis = fs.createWriteStream(buyuk);
    akis.write('@@HOST BIGSTREAM\n@@PREFIX /usr/nginx\n@@TREE\n');
    for (let i = 0; i < 2000; i++) akis.write(`100\t2026-09-22 00:00:00\tsha${i}\twww\t/usr/nginx/conf.d/app-${i}.conf\n`);
    akis.write('@@END\n');
    const dolgu = '# ' + 'x'.repeat(4094) + '\n';
    for (let i = 0; i < 6500; i++) akis.write(`@@FILE /usr/nginx/conf.d/app-${i % 2000}.conf sha${i} 4096\n${dolgu}@@END\n`);
    akis.write('@@CERT /usr/nginx/ssl/b.crt\nexists=1\nsubject=CN=b.example.com\n@@END\n');
    await new Promise((r) => akis.end(r));
    assert.ok(fs.statSync(buyuk).size > 25 * 1024 * 1024, 'test dokumu yeterince buyuk degil');

    const devOzet = parseDumpFileSync(buyuk, { skipFileContent: true });
    assert.equal(devOzet.host, 'BIGSTREAM');
    assert.equal(devOzet.tree.length, 2000, 'dev dokumun agaci eksik okundu');
    assert.equal(devOzet.certs.size, 1, 'dev dokumun sertifikasi okunmadi');
    assert.equal(devOzet.files.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
