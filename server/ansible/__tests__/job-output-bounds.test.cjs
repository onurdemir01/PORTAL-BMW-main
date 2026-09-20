// server/ansible/__tests__/job-output-bounds.test.cjs
// AWX CIKTISI BELLEGE SINIRSIZ ALINMASIN — URETIMDE IKI KEZ COKERTTI.
//
// 2026-09-19, `prod.out`: iki ayri OOM, ikisi de ~2 GB heap tavaninda.
//   Mark-Compact 2090.0 (2122.6) -> 2065.6 (2107.6) MB ... allocation failure
//   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
//
// ONEMLI AYRIM: iki cokmenin son JS karesi FARKLI —
//   OOM #1: Runtime_AllocateInYoungGeneration   (split YOK)
//   OOM #2: Runtime_StringSplit
// Yani `split` SON DAMLAYDI, SEBEP DEGIL. Mark-Compact'tan SONRA hala 2065 MB
// canliydi: sorun TUTULAN (retained) tamponlar. Sebep `fetchAwxPlainText`in
// `data += chunk` ile sinirsiz tamponlamasi ve ayni ciktinin HER YOKLAMADA
// yeniden indirilmesi.
//
// Bu testler GERCEK kod yolunu sahte bir HTTP katmaniyla kosturur — kaynak
// taramasi bu sinifi goremez (kapinin VAR olmasi yetmez, CALISMASI gerekir).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER_SRC = fs.readFileSync(path.join(ROOT, 'server/ansible/runner.cjs'), 'utf8');

/** Belirtilen boyutta duz metin donduren gecici bir HTTP sunucusu. */
function sahteAwx(bayt) {
  const parca = 'x'.repeat(64 * 1024);
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      let yazilan = 0;
      const yaz = () => {
        while (yazilan < bayt) {
          yazilan += parca.length;
          if (!res.write(parca)) return res.once('drain', yaz);
        }
        res.end();
      };
      yaz();
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/**
 * ASILMAYA DAYANIKLI BEKLEME. Bir mutasyon promise'i cozulmez birakirsa (bkz.
 * JO1b), `await` suiti SONSUZA DEK bloklar ve dosyadaki DIGER testler de hic
 * kosmaz — yani tek bir hata butun bekciyi sustururdu. Her cagri kendi sinirini
 * tasir.
 */
function sureSinirli(p, ms, etiket) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${etiket}: promise ${ms} ms icinde cozulmedi`)), ms)),
  ]);
}

/**
 * `fetchAwxPlainText` disa acilmiyor; kaynaktan cikarilip AYNI bagimliliklarla
 * kosturulur — kopyasi degil, GERCEK govde. (Sabitler de birlikte alinir, yoksa
 * `AWX_RESPONSE_MAX_BYTES` tanimsiz kalir.)
 */
function gercekFetch() {
  const i = RUNNER_SRC.indexOf('function fetchAwxPlainText');
  const j = RUNNER_SRC.indexOf('function isAwxStdoutTooLarge');
  const k = RUNNER_SRC.indexOf('const JOB_OUTPUT_MAX_BYTES');
  assert.ok(i > 0 && j > i && k > 0 && k < i, 'kaynak cikarimi bozuldu — desen degismis');
  return new Function(
    'http',
    'https',
    'URL',
    `${RUNNER_SRC.slice(k, i)}\n${RUNNER_SRC.slice(i, j)}\n` +
      'return { fetchAwxPlainText, AWX_RESPONSE_MAX_BYTES, AWX_TRUNCATION_NOTICE };',
  )(http, require('node:https'), URL);
}

// JO1 — ASIL KAPI. Buyuk yanit bellege OLDUGU GIBI alinmamali.
test('JO1 `fetchAwxPlainText` buyuk yaniti KIRPIYOR ve sessiz kalmiyor', async () => {
  const fn = gercekFetch();
  const { srv, port } = await sahteAwx(20 * 1024 * 1024);
  try {
    const out = await sureSinirli(
      fn.fetchAwxPlainText(`http://127.0.0.1:${port}`, 't', '/stdout'),
      15000,
      'JO1',
    );
    assert.ok(
      out.length <= fn.AWX_RESPONSE_MAX_BYTES + fn.AWX_TRUNCATION_NOTICE.length + 65536,
      `yanit kirpilmadi: ${Math.round(out.length / 1024 / 1024)} MB alindi`,
    );
    assert.ok(out.includes('KIRPILDI'), 'kirpma SESSIZCE yapildi — kullanici yarim logu tam sanar');
  } finally {
    srv.close();
  }
});

// JO1b — ASILMA YOK. `req.destroy()` cagrildiginda `end` olayi ARTIK GELMEZ;
// yalnizca `end` icinde cozen bir kapi promise'i SONSUZA DEK asili birakirdi —
// sinirsiz tamponlamadan DAHA KOTU bir hata. (Ilk yazimda tam bu tuzaga dustum.)
test('JO1b kirpma promise`i ASILI BIRAKMIYOR', async () => {
  const fn = gercekFetch();
  const { srv, port } = await sahteAwx(20 * 1024 * 1024);
  try {
    const yaris = await Promise.race([
      fn.fetchAwxPlainText(`http://127.0.0.1:${port}`, 't', '/stdout').then(() => 'cozuldu'),
      new Promise((r) => setTimeout(() => r('ASILDI'), 15000)),
    ]);
    assert.equal(yaris, 'cozuldu', 'promise cozulmedi — cagiran taraf sonsuza dek bekler');
  } finally {
    srv.close();
  }
});

// JO2 — KUCUK YANIT DOKUNULMADAN GECMELI (asiri sikilasma yok).
test('JO2 kucuk yanit kirpilmiyor ve uyari metni EKLENMIYOR', async () => {
  const fn = gercekFetch();
  const { srv, port } = await sahteAwx(128 * 1024);
  try {
    const out = await sureSinirli(
      fn.fetchAwxPlainText(`http://127.0.0.1:${port}`, 't', '/stdout'),
      15000,
      'JO2',
    );
    assert.equal(out.length, 128 * 1024, 'kucuk yanit degistirildi');
    assert.ok(!out.includes('KIRPILDI'), 'kirpilmayan yanita uyari eklendi');
  } finally {
    srv.close();
  }
});

// JO3 — `changed=` kontrolu DIZI AYIRMADAN yapilmali. OOM #2'nin son JS karesi
// (`Runtime_StringSplit`) tam olarak buydu ve amaci yalnizca bir regex testiydi.
test('JO3 `changed=` kontrolu tum ciktiyi diziye AYIRMIYOR', () => {
  const kod = RUNNER_SRC.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(
    kod,
    /const lines = output\.split\('\\n'\)/,
    'cikti yine diziye ayriliyor — OOM #2 bu satirda oldu',
  );
  assert.match(kod, /changed=\\s\*\[1-9\]\/m\.test\(output\)/, 'regex dogrudan metne uygulanmiyor');
});

// JO4 — EVENT YEDEGINDE BAYT BUTCESI. Tavan "event sayisi" (40000) idi; bayt
// degil. Event basina stdout birkac KB olabildigi icin birikim yuzlerce MB'a
// cikiyordu — yani yanlis eksende sinirlanmisti.
test('JO4 `collectJobEventsStdout` BAYT butcesi tasiyor (event sayisi degil)', () => {
  const govde = RUNNER_SRC.slice(
    RUNNER_SRC.indexOf('async function collectJobEventsStdout'),
    RUNNER_SRC.indexOf('function applyOutputFilter'),
  );
  assert.match(govde, /JOB_OUTPUT_MAX_BYTES/, 'bayt butcesi yok');
  assert.match(govde, /kirpildi/, 'kirpma bayragi yok');
  assert.match(govde, /AWX_TRUNCATION_NOTICE/, 'kirpma SESSIZ — kullaniciya soylenmiyor');
});

// ── JO5/JO6 — JSON YOLU (URETIMDEKI UCUNCU OOM) ────────────────────────────
//
// 2026-09-19 21:02: portal acilistan 1 dk 52 sn sonra oldu.
//   Mark-Compact (reduce) 2046.8 (2068.4) -> 2046.3 (2068.7) MB ... allocation failure
// GC HICBIR SEY bosaltamiyor — 2 GB TUTULAN veriydi.
//
// Zincir: ScaleX uzlastiricisi acilistan saniyeler sonra kosuyor (log: "uzlastirici:
// 1 is sonuclandirildi") -> `getJobStatusOnServer` -> `/api/v2/jobs/<id>/` -> o yanit
// `artifacts` tasiyor -> SINIRSIZ tampon + `JSON.parse` (metnin 3-6 kati nesne grafigi).
//
// PR #106 yalnizca DUZ METIN yolunu kapatmisti; JSON yolu acik kalmisti.
let TEST_AWX_URL = 'http://127.0.0.1:1';

function gercekJsonIstek(fnAdi) {
  let i = RUNNER_SRC.indexOf(`function ${fnAdi}(`);
  assert.ok(i > 0, `${fnAdi} bulunamadi`);
  // `async` oneki KESILMEMELI: kesilirse govdedeki `await` sozdizimi hatasi verir
  // ve bekci gercek kodu hic kosturmadan "kirmizi" gorunur.
  if (RUNNER_SRC.slice(i - 6, i) === 'async ') i -= 6;
  // Govde: bir sonraki ust duzey `function` bildirimine kadar.
  const sonraki = RUNNER_SRC.indexOf('\nfunction ', i + 16);
  const sonrakiAsync = RUNNER_SRC.indexOf('\nasync function ', i + 16);
  const son = Math.min(...[sonraki, sonrakiAsync].filter((n) => n > 0));
  const k = RUNNER_SRC.indexOf('const JOB_OUTPUT_MAX_BYTES');
  const sabitSon = RUNNER_SRC.indexOf('function fetchAwxPlainText');
  const kaynak = `${RUNNER_SRC.slice(k, sabitSon)}\n${RUNNER_SRC.slice(i, son)}`;

  // Cikarilan govde birkac yardimciya bagli; testin konusu OLMAYAN bu yardimcilar
  // en sade halleriyle enjekte edilir. Olculen sey BAYT KAPISI, yol esleme degil.
  // ADAPTIF: kaynakta ZATEN ust duzey bildirilen bir adi enjekte etmek
  // "Identifier has already been declared" verir — o adlar elenir.
  const stoklar = {
    mapApiPath: (_s, yol) => yol,
    summarizeAwxErrorBody: () => null,
    _tokenCache: { token: null, expiresAt: null },
    getConfig: () => ({ url: TEST_AWX_URL }),
    getToken: async () => 'test-token',
  };
  const adlar = [];
  const degerler = [];
  for (const [ad, deger] of Object.entries(stoklar)) {
    if (new RegExp(`^(const|let|var|function|async function) ${ad}\\b`, 'm').test(kaynak)) continue;
    adlar.push(ad);
    degerler.push(deger);
  }

  return new Function(
    'http',
    'https',
    'URL',
    ...adlar,
    `${kaynak}\nreturn { fn: ${fnAdi}, AWX_JSON_MAX_BYTES };`,
  )(http, require('node:https'), URL, ...degerler);
}

for (const fnAdi of ['awxRequestToServer', 'awxRequest']) {
  test(`JO5 ${fnAdi}: dev JSON yaniti REDDEDILIYOR (OOM yolu kapali)`, async () => {
    const mod = gercekJsonIstek(fnAdi);
    // 12 MB'lik gecerli JSON — tavan 4 MB.
    const { srv, port } = await sahteAwx(12 * 1024 * 1024);
    try {
      const cagir =
        fnAdi === 'awxRequestToServer'
          ? mod.fn({ url: `http://127.0.0.1:${port}` }, 't', 'GET', '/api/v2/jobs/1/')
          : (() => {
              TEST_AWX_URL = `http://127.0.0.1:${port}`;
              return gercekJsonIstek(fnAdi).fn('GET', '/api/v2/jobs/1/');
            })();
      await assert.rejects(
        () => sureSinirli(cagir, 15000, fnAdi),
        (e) => {
          assert.ok(e.tooLarge, `hata "cok buyuk" olarak isaretlenmedi: ${e.message}`);
          assert.match(e.message, /çok büyük/, 'kullaniciya sebep soylenmiyor');
          return true;
        },
        'dev JSON yaniti KABUL EDILDI — OOM yolu hala acik',
      );
    } finally {
      srv.close();
    }
  });
}

// JO6 — GEVSEMEDIGINI KANITLA: normal boyutta JSON dokunulmadan gecmeli.
test('JO6 normal JSON yaniti REDDEDILMIYOR', async () => {
  const mod = gercekJsonIstek('awxRequestToServer');
  const govde = JSON.stringify({ id: 1, status: 'successful', artifacts: { a: 'b' } });
  const srv = http.createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'application/json' });
    r.end(govde);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const out = await sureSinirli(
      mod.fn({ url: `http://127.0.0.1:${srv.address().port}` }, 't', 'GET', '/api/v2/jobs/1/'),
      15000,
      'JO6',
    );
    assert.equal(out.status, 'successful', 'normal yanit bozuldu');
  } finally {
    srv.close();
  }
});

// ── JO7 — BAYT KAPISI REDDI SONSUZ INDIRME DONGUSU BIRAKMIYOR ──────────────
//
// Uzlastirici her turda yarim kalmis isleri yeniden yokluyor. Bayt kapisi bir isi
// reddettiginde o red KALICIDIR (yanit bir sonraki turda kuculmez). `staleHours`
// dolana kadar beklemek, ayni dev yaniti saatlerce her turda yeniden indirmeye
// calismak olurdu — OOM'u cozup yerine bir indirme dongusu birakmak.
test('JO7 `tooLarge` reddi YASI BEKLEMEDEN "bilinmiyor" isaretleniyor', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scalex', 'reconciler.cjs'),
    'utf8',
  );
  const i = src.indexOf('const ageHours = j.created_at');
  assert.ok(i > 0, 'uzlastiricinin hata dali bulunamadi');
  const dal = src.slice(i, i + 900);
  assert.match(dal, /e\s*&&\s*e\.tooLarge/, '`tooLarge` dali yok — dev yanit her turda yeniden indirilir');
  // Kapi yas kontrolunden ONCE gelmeli; sonra gelseydi hic ates almazdi.
  assert.ok(
    dal.indexOf('tooLarge') < dal.indexOf('ageHours >= cfg.staleHours'),
    '`tooLarge` dali yas kontrolunden SONRA — yas dolana kadar ates almaz',
  );
});

// ── JO8/JO9/JO10 — CIKTI FILTRESI (OOM'UN SON ACIK YOLU) ───────────────────
//
// 2026-09-20 log turunda uretimde 7 OOM olctum (onceki turda 3 saymistim; o
// analiz daha kucuk bir log dilimindeydi). 7'nin 4'unde son JS karesi:
//   13: v8::internal::Runtime_StringSplit(...)
//
// `getJobOutput` bu teshisi dogru yapip KENDI satirindaki `split`i kaldirmisti,
// ama 30 satir yukaridaki `applyOutputFilter` ATLANMISTI ve ayni `split`i
// yapmaya devam ediyordu. `GET /jobs/N/output` uretimde ortalama 20.846 ms
// suruyor ve tam bu yoldan geciyor.
//
// Bu testler DESEN ARAMAZ — gercek `applyOutputFilter` govdesi kosturulur.

function gercekFiltre() {
  const i = RUNNER_SRC.indexOf('function applyOutputFilter');
  const j = RUNNER_SRC.indexOf('async function getJobOutput');
  assert.ok(i > 0 && j > i, 'applyOutputFilter bulunamadi');
  return new Function(
    'AWX_TRUNCATION_NOTICE',
    'FILTERED_OUTPUT_MAX_BYTES',
    `${RUNNER_SRC.slice(i, j)}\nreturn applyOutputFilter;`,
  )('\n... [PORTAL] KIRPILDI', 4 * 1024 * 1024);
}

test('JO8 filtre 16 MB ciktiyi DIZIYE AYIRMIYOR (heap olculur)', () => {
  const filtre = gercekFiltre();
  // ~16 MB: 200 bin satir x ~80 bayt. Eski hali bunu 200 bin elemanli bir
  // diziye aciyordu; V8'de her kucuk string ~40-60 bayt ek yuk tasir, yani
  // kaynak metin HALA CANLIYKEN ustune ~100-150 MB.
  const satir = 'ok: [host-0123456789] => changed=false  elapsed=0.01s  msg=done';
  const metin = new Array(200000).fill(satir).join('\n');
  const boyut = Buffer.byteLength(metin, 'utf8');

  if (global.gc) global.gc();
  const once = process.memoryUsage().heapUsed;
  const r = filtre(metin, { outputFilter: { enabled: true, contains: 'ZZZ-HICBIR-SEY' } });
  const artis = process.memoryUsage().heapUsed - once;

  assert.equal(r.totalLines, 200000, 'satir sayisi yanlis');
  assert.equal(r.matchedLines, 0);
  assert.equal(r.output, '');
  // Hicbir satir eslesmedigi halde diziye acilsaydi artis kaynak boyutunun
  // KATLARI olurdu. Kaynagin YARISI bile asilmamali.
  assert.ok(
    artis < boyut / 2,
    `filtre girdiyi diziye acti: girdi ${boyut} B, heap artisi ${artis} B`,
  );
});

test('JO9 filtre sonucu BAYT TAVANI tasiyor (genis needle kaynak kadar buyumesin)', () => {
  const filtre = gercekFiltre();
  const src = RUNNER_SRC.slice(
    RUNNER_SRC.indexOf('function applyOutputFilter'),
    RUNNER_SRC.indexOf('async function getJobOutput'),
  );
  assert.match(src, /FILTERED_OUTPUT_MAX_BYTES/, 'suzulmus cikti tavani yok');

  // Her satiri eslestiren bir needle: sonuc kaynak kadar buyuk olurdu.
  const satir = 'ok: ' + 'x'.repeat(200);
  const metin = new Array(60000).fill(satir).join('\n'); // ~12 MB
  const r = filtre(metin, { outputFilter: { enabled: true, contains: 'ok:' } });
  assert.ok(
    Buffer.byteLength(r.output, 'utf8') <= 4 * 1024 * 1024 + 200,
    `suzulmus cikti tavani asildi: ${Buffer.byteLength(r.output, 'utf8')}`,
  );
  assert.match(r.output, /KIRPILDI/, 'kirpma SESSIZ — kullaniciya soylenmiyor');
});

test('JO10 filtre SOZLESMESI degismedi (eski uygulamayla birebir ayni)', () => {
  const filtre = gercekFiltre();
  // Eski uygulama, referans olarak.
  const eski = (stdoutText, overrides) => {
    const text = typeof stdoutText === 'string' ? stdoutText : '';
    const filt = overrides?.outputFilter;
    const needle = String(filt?.contains ?? '').trim();
    if (!filt?.enabled || !needle)
      return { output: text, filtered: false, totalLines: 0, matchedLines: 0 };
    const lines = text ? text.split('\n') : [];
    const kept = lines.filter((l) => l.includes(needle)).map((l) => l.trim());
    return {
      output: kept.join('\n'),
      filtered: true,
      totalLines: lines.length,
      matchedLines: kept.filter(Boolean).length,
      needle,
    };
  };

  const parcalar = ['TASK [foo]', '  ok: [host]', 'changed=1', '', '   ', 'fatal: FAILED', 'ok', '\r'];
  let denendi = 0;
  for (let t = 0; t < 1500; t++) {
    const n = t % 11;
    const metin = Array.from({ length: n }, () => parcalar[(t * 7 + n) % parcalar.length]).join('\n');
    for (const needle of ['ok', 'changed', 'TASK', 'zzz', '  ', 'a']) {
      const ov = { outputFilter: { enabled: true, contains: needle } };
      assert.deepEqual(filtre(metin, ov), eski(metin, ov), `sozlesme kaydi: ${JSON.stringify(metin)} / ${needle}`);
      denendi++;
    }
  }
  // Kenar durumlar — `a\nb` ornegini diferansiyel test yakalamisti:
  // `lastIndexOf` negatif `fromIndex`i 0 gibi ele aliyor ve needle satir
  // sinirinin OTESINE tasabiliyordu.
  for (const [metin, needle] of [
    ['', 'x'], ['tek satir', 'tek'], ['a\n', 'a'], ['\n\n', 'x'],
    ['abc', 'abcd'], ['a\nb', 'a\nb'], ['a\nb\nc', 'b\nc'],
  ]) {
    const ov = { outputFilter: { enabled: true, contains: needle } };
    assert.deepEqual(filtre(metin, ov), eski(metin, ov), `kenar: ${JSON.stringify(metin)} / ${JSON.stringify(needle)}`);
    denendi++;
  }
  assert.ok(denendi > 9000, `yeterince durum denenmedi: ${denendi}`);
});
