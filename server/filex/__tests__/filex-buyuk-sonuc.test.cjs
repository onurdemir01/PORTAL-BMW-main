// server/filex/__tests__/filex-buyuk-sonuc.test.cjs — buyuk FileX sonucu GOSTERILIR,
// bellek sinirli kalir.
//
// URETIM (13 Ekim): 9 FileX isinin 3'u hic sonuc gostermedi. Hepsi TEK sunucuydu; o
// sunucunun dosya listesi `/api/v2/jobs/<id>/` yanitini genel 4 MB bayt kapisinin
// ustune cikardi, uc 502 dondu, kurumsal vekil govdeyi degistirdi ve ekran "Portal
// yeniden baslatiliyor" dedi. Kullanici isi iki kez daha baslatti — sonuc hicbir
// denemede gorunemezdi.
//
// Bu testler GERCEK runner'i (bayt kapisi dahil) sahte bir AWX'e karsi kosturur:
//   FB1 4 MB'i asan sonuc artik okunuyor ve dosyalar donuyor
//   FB2 ust uste gelen yoklamalar TEK genis okuma yapiyor; bitmis is yeniden indirilmiyor
//   FB3 genis tavani da asan is 422 + acik mesaj; sonraki yoklama AWX'e gitmiyor
//   FB4 iki farkli buyuk is AYNI ANDA genis okunmuyor (bellek tavani)
//   FB5 kucuk is ve calisan is: tek okuma, davranis degismedi
//   FB6 genis okuma surerken gelen yoklama 4 MB normal okumayi tekrarlamaz
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const MB = 1024 * 1024;

// ── Sahte AWX ───────────────────────────────────────────────────────────────
// Is no -> yanit govdesi. Her istek icin "tamamlandi mi (istemci sonuna kadar okudu mu)"
// ve zaman araligi kaydedilir: tamamlanan istek = genis okuma (normal okuma 4 MB'ta keser).
const govdeler = new Map();
const kayit = [];
const gecikmeler = new Map();

function filexGovdesi(jobId, dosyaSayisi, { bitti = true } = {}) {
  const meta = [];
  const sha = [];
  const hash = 'a'.repeat(128);
  for (let i = 0; i < dosyaSayisi; i++) {
    const yol = `/opt/jboss/standalone/deployments/uygulama.ear/lib/modul-${String(i).padStart(6, '0')}-surum-1.2.3.jar`;
    meta.push(`644|jboss|jboss|${1000 + i}|1697123456.0000000000|${yol}`);
    sha.push(`${hash}  ${yol}`);
  }
  return JSON.stringify({
    id: jobId,
    status: bitti ? 'successful' : 'running',
    created: '2026-10-14T10:00:00Z',
    started: '2026-10-14T10:00:01Z',
    finished: bitti ? '2026-10-14T10:01:00Z' : null,
    elapsed: 59,
    failed: false,
    playbook: 'filex_list_files.yml',
    artifacts: bitti
      ? {
          filex_result: {
            overall_status: 'success',
            hosts: [
              {
                host: 'H1',
                status: 'ok',
                ear_dirs: ['/opt/x.ear'],
                meta_raw: meta.join('\n'),
                sha_raw: sha.join('\n'),
              },
            ],
          },
        }
      : {},
  });
}

let awx;
let app;
let portal;

before(async () => {
  awx = http.createServer((q, r) => {
    const m = /^\/api\/v2\/jobs\/(\d+)\/$/.exec(q.url);
    const govde = m ? govdeler.get(Number(m[1])) : null;
    if (!govde) {
      r.writeHead(404, { 'content-type': 'application/json' });
      return r.end('{"detail":"Not found."}');
    }
    const k = { jobId: Number(m[1]), bas: Date.now(), son: null, tamam: false };
    kayit.push(k);
    r.on('finish', () => {
      k.tamam = true;
      k.son = Date.now();
    });
    r.on('close', () => {
      if (!k.son) k.son = Date.now();
    });
    r.writeHead(200, { 'content-type': 'application/json' });
    // Parca parca yaz: genis okumalarin ZAMAN araligi olcullebilsin (FB4).
    const parca = 1 * MB;
    let i = 0;
    const yaz = () => {
      while (i < govde.length) {
        const ok = r.write(govde.slice(i, i + parca));
        i += parca;
        if (!ok) return r.once('drain', () => setTimeout(yaz, 5));
      }
      r.end();
    };
    // FB6: isin N. istegi geciktirilebilir (genis okuma surerken baska yoklama gelsin).
    const gecikme = gecikmeler.get(k.jobId);
    const sira = kayit.filter((x) => x.jobId === k.jobId).length;
    if (gecikme && gecikme.sira === sira) setTimeout(yaz, gecikme.ms);
    else yaz();
  });
  await new Promise((ok) => awx.listen(0, '127.0.0.1', ok));
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.address().port}`;
  process.env.AWX_1_TOKEN = 'filex-test-token';
  process.env.AWX_1_NAME = 'awx-filex-test';

  // Auth ve gorunurluk: testin konusu degil. Admin oturumu sahiplik sorgusunu (DB) atlar.
  const yer = (p, exports) => {
    const tam = require.resolve(p);
    require.cache[tam] = { id: tam, filename: tam, loaded: true, exports };
  };
  yer('../../auth/index.cjs', {
    requireAuth: (req, _res, next) => {
      req.session = { user: { username: 'yonetici', role: 'Admin' } };
      next();
    },
  });
  yer('../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _r, n) => n() });

  const express = require('express');
  app = express();
  const filexYolu = path.join(__dirname, '..', 'index.cjs');
  delete require.cache[require.resolve(filexYolu)];
  require(filexYolu).initFileX(app);
  portal = app.listen(0, '127.0.0.1');
  await new Promise((ok) => portal.once('listening', ok));
});

after(() => {
  portal && portal.close();
  awx && awx.close();
});

async function durum(jobId) {
  const r = await fetch(
    `http://127.0.0.1:${portal.address().port}/api/filex/job-status/1/${jobId}`,
  );
  return { status: r.status, body: await r.json() };
}
const isinIstekleri = (jobId) => kayit.filter((k) => k.jobId === jobId);

test('FB1 4 MB bayt kapisini asan FileX sonucu artik GOSTERILIYOR', async () => {
  govdeler.set(101, filexGovdesi(101, 24000));
  assert.ok(govdeler.get(101).length > 6 * MB, 'test verisi 4 MB kapisini asmiyor');
  const { status, body } = await durum(101);
  assert.equal(status, 200, `beklenen 200, gelen ${status}: ${body.message}`);
  assert.equal(body.ok, true);
  assert.equal(body.failed, false);
  assert.equal(body.result.hosts[0].files.length, 24000, 'dosyalarin hepsi donmedi');
  assert.equal(body.result.hosts[0].files[0].sha512.length, 128);
});

test('FB2 ust uste yoklamalar TEK genis okuma yapar; bitmis is yeniden INDIRILMEZ', async () => {
  govdeler.set(102, filexGovdesi(102, 24000));
  const cevaplar = await Promise.all([durum(102), durum(102), durum(102)]);
  for (const c of cevaplar) {
    assert.equal(c.status, 200);
    assert.equal(c.body.result.hosts[0].files.length, 24000);
  }
  const tamamlanan = isinIstekleri(102).filter((k) => k.tamam).length;
  assert.equal(tamamlanan, 1, `ayni is icin ${tamamlanan} genis okuma yapildi (tek ucus yok)`);

  const once = isinIstekleri(102).length;
  const sonra = await durum(102);
  assert.equal(sonra.status, 200);
  assert.equal(
    isinIstekleri(102).length,
    once,
    'bitmis buyuk is her yoklamada yeniden indiriliyor',
  );
});

test('FB3 genis tavani da asan is: 422 + acik mesaj, sonraki yoklama AWX`e GITMEZ', async () => {
  govdeler.set(103, filexGovdesi(103, 125000));
  assert.ok(govdeler.get(103).length > 32 * MB, 'test verisi genis tavani asmiyor');
  const ilk = await durum(103);
  assert.equal(
    ilk.status,
    422,
    'vekilin degistirmedigi bir 4xx bekleniyordu (5xx govdesi kullaniciya ulasmaz)',
  );
  assert.equal(ilk.body.code, 'filex_result_too_large');
  assert.match(ilk.body.message, /AWX iş #103/);
  assert.doesNotMatch(
    ilk.body.message,
    /tekrar deneyin/i,
    'kalici durumda "tekrar deneyin" denmemeli',
  );

  const once = isinIstekleri(103).length;
  const ikinci = await durum(103);
  assert.equal(ikinci.status, 422);
  assert.equal(isinIstekleri(103).length, once, 'cok buyuk is her yoklamada yeniden indiriliyor');
});

test('FB4 iki farkli buyuk is AYNI ANDA genis okunmaz (surec basina tek)', async () => {
  govdeler.set(104, filexGovdesi(104, 24000));
  govdeler.set(105, filexGovdesi(105, 24000));
  const [a, b] = await Promise.all([durum(104), durum(105)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const genis = kayit.filter((k) => (k.jobId === 104 || k.jobId === 105) && k.tamam);
  assert.equal(genis.length, 2);
  const [x, y] = genis.sort((p, q) => p.bas - q.bas);
  assert.ok(
    y.bas >= x.son,
    `iki genis okuma ust uste bindi (${x.bas}-${x.son} / ${y.bas}-${y.son})`,
  );
});

test('FB5 kucuk ve calisan is: TEK okuma, cevap bicimi ayni', async () => {
  govdeler.set(106, filexGovdesi(106, 10));
  const kucuk = await durum(106);
  assert.equal(kucuk.status, 200);
  assert.deepEqual(Object.keys(kucuk.body).sort(), [
    'failed',
    'finished',
    'ok',
    'result',
    'status',
  ]);
  assert.equal(kucuk.body.result.hosts[0].files.length, 10);
  assert.equal(isinIstekleri(106).length, 1);

  govdeler.set(107, filexGovdesi(107, 0, { bitti: false }));
  const calisan = await durum(107);
  assert.equal(calisan.status, 200);
  assert.equal(calisan.body.finished, null);
  assert.equal(calisan.body.result, null);
  assert.equal(isinIstekleri(107).length, 1);
});

test('FB6 genis okuma surerken gelen yoklama normal okumayi TEKRARLAMAZ', async () => {
  // Ekran 2,5 sn'de bir yokluyor; genis okuma bundan uzun surebilir. Is "buyuk" diye
  // isaretlenmezse araya giren her yoklama once 4 MB indirip kesiyor, sonra bekliyordu.
  govdeler.set(108, filexGovdesi(108, 24000));
  gecikmeler.set(108, { sira: 2, ms: 400 }); // 2. istek = genis okuma
  const ilk = durum(108);
  const bas = Date.now();
  while (isinIstekleri(108).length < 2) {
    assert.ok(Date.now() - bas < 5000, 'genis okuma hic baslamadi');
    await new Promise((ok) => setTimeout(ok, 5));
  }
  const ikinci = durum(108);
  const [a, b] = await Promise.all([ilk, ikinci]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.body.result.hosts[0].files.length, 24000);
  const istekler = isinIstekleri(108);
  assert.equal(
    istekler.filter((k) => !k.tamam).length,
    1,
    'ikinci yoklama da once normal okuma yapip 4 MB indirdi',
  );
  assert.equal(istekler.length, 2);
});
