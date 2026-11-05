// server/server-hub/__tests__/ear-envanter-uclar.test.cjs - Uygulama Envanteri uclari, kapilar, saklama.
//
//   EU1  KAPI: ear-envanter.cjs Server Hub router'ina Admin ve gorunurluk kapisindan SONRA baglanir;
//        yurutucu ayri modul girdisiyle baslar (Server Hub testleri zamanlayici kurmaz)
//   EU2  POST /ear/kosu: kapsam ACIK yazilmali; bos liste filo DEGILDIR; gecersiz ad 400; filo cagrisi
//        hedefler=null ile gider
//   EU3  durum kodlari proxy'den gecer (404/403/501 -> 409, 502-504 -> 424); 500 govdesi genel mesaj
//   EU4  CSV ucu bilinmeyen gorunumu reddeder; dosya BOM'lu ve indirme basligiyla gelir
//   EU5  SAKLAMA /sw: yalniz kosu-<n> GERCEK dizinleri; korunan ve DB'de bilinmeyen yeni dizin kalir;
//        kok sembolik bagsa hicbir sey silinmez; DB okunamazsa hicbir sey silinmez
//   EU6  SAKLAMA DB: son N FILO kosusu sayilir (secili / pilot kosulari filo kosusunu sildirmez),
//        silme parcali (TOP)
//   EU7  SAKLAMA /sw awx-<is>: kosusu korunan kalir, korunmayan silinir; henuz alinmamis is 7 gun kalir
//   EU8  AGAC: AWX'ten alinan kosunun ham dosyasi awx-<is>/raw'dan okunur (ayni numarali kosu-<n> degil)
//   EU9  CSV AKISI: 12.000 satir 5000'lik parcalarla EKSIKSIZ gelir; suzgec / siralama aynen gider;
//        gecersiz suzgec baslik gitmeden 400; veri akista degisirse baglanti kesilir (yarim dosya yok)
//   EU10 /ear/warlar set izini istemciye vermez; /ear/degerler gecersiz kolonu 400 ile reddeder
//   EU11 /ear/yapi-farki: parametre bicimi; OZET kopyada fark yerine neden
//   EU12 eslenik uclari: tur ve suzgec parametreleri motora gider; bilinmeyen grup 409
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const F = require('./fixtures/ear-envanter.cjs');

afterEach(() => F.dbKaldir());

test('EU1 kapidan sonra baglanir; yurutucu ayri baslar', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const kapi = kaynak.indexOf("router.use(requireVisiblePrefix('ServerHub'))");
  const admin = kaynak.indexOf(
    "res.status(403).json({ ok: false, message: 'Server Hub yalnız Admin.' })",
  );
  const bag = kaynak.indexOf("require('./ear-envanter.cjs').mount(router");
  assert.ok(kapi > 0 && admin > 0 && bag > 0, 'isaretler bulunamadi (kor)');
  assert.ok(bag > kapi && bag > admin, 'Uygulama Envanteri uclari kapidan once baglanmis');
  assert.ok(!/startPoller/.test(kaynak), 'Server Hub router kurulumu zamanlayici baslatmamali');
  const giris = fs.readFileSync(path.join(__dirname, '..', '..', 'index.cjs'), 'utf8');
  assert.match(
    giris,
    /name: 'earEnvanter',\s*init: \(\) => require\('\.\/server-hub\/ear-envanter-poller\.cjs'\)\.startPoller\(\)/,
  );
});

async function sunucu(fn) {
  const poller = require('../ear-envanter-poller.cjs');
  const asil = poller.kosuOlustur;
  const cagrilar = [];
  poller.kosuOlustur = async (a) => (
    cagrilar.push(a),
    { id: 9, beklenen: (a.hedefler || []).length || 1000, partiSayisi: 1 }
  );
  const app = express();
  app.use(express.json());
  app.use(
    (req, res, next) => ((req.session = { user: { username: 'ayse', role: 'Admin' } }), next()),
  );
  const router = express.Router();
  require('../ear-envanter.cjs').mount(router, { launch: async () => ({}), audit: () => {} });
  app.use('/api/server-hub', router);
  const srv = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${srv.address().port}/api/server-hub`, cagrilar);
  } finally {
    srv.close();
    poller.kosuOlustur = asil;
    poller._durdurForTest();
  }
}
const post = (url, govde) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(govde),
  });

test('EU2 POST /ear/kosu kapsam acik', async () => {
  await sunucu(async (kok, cagrilar) => {
    assert.equal((await post(`${kok}/ear/kosu`, { kip: 'TAM' })).status, 400, 'kapsamsiz istek');
    assert.equal((await post(`${kok}/ear/kosu`, { kip: 'TAM', hostlar: [] })).status, 400);
    assert.equal(
      (await post(`${kok}/ear/kosu`, { kip: 'TAM', kapsam: 'SECILI', hostlar: [] })).status,
      400,
      'bos liste',
    );
    assert.equal(
      (await post(`${kok}/ear/kosu`, { kip: 'TAM', kapsam: 'SECILI', hostlar: 'iyi kotu;ad' }))
        .status,
      200,
    );
    assert.equal(
      (await post(`${kok}/ear/kosu`, { kip: 'TAM', kapsam: 'SECILI', hostlar: ['a/b'] })).status,
      400,
    );
    assert.equal(cagrilar.length, 1);
    assert.deepEqual(cagrilar[0].hedefler, [{ host: 'IYI' }, { host: 'KOTU' }, { host: 'AD' }]);
    const r = await post(`${kok}/ear/kosu`, { kip: 'OZET', kapsam: 'FILO', hostlar: ['X1'] });
    assert.equal(r.status, 200);
    assert.equal(cagrilar[1].hedefler, null, 'filo: liste yok sayilir');
    assert.equal(cagrilar[1].baslatan, 'ayse');
    assert.ok(cagrilar[1].req, 'ilk parti istek icinde baslamali');
  });
});

test('EU3 durum kodlari', () => {
  const { durumKodu } = require('../ear-envanter.cjs');
  assert.deepEqual(
    [400, 409, 422, 424, 404, 403, 501, 502, 503, 504, 500, undefined].map(durumKodu),
    [400, 409, 422, 424, 409, 409, 409, 424, 424, 424, 500, 500],
  );
});

test('EU4 CSV ucu', async () => {
  F.dbKur(
    F.sahteDb([
      [
        /WITH son AS/,
        () => ({ rows: [{ host: 'APPSRV01', ad: '=cmd', durum: 'TAM', toplam: 1 }] }),
      ],
    ]),
  );
  await sunucu(async (kok) => {
    assert.equal((await fetch(`${kok}/ear/disa-aktar/gizli.csv`)).status, 400);
    const r = await fetch(`${kok}/ear/disa-aktar/uygulamalar.csv`);
    assert.equal(r.status, 200);
    assert.match(
      r.headers.get('content-disposition'),
      /attachment; filename="ear-envanter_uygulamalar_\d+\.csv"/,
    );
    const metin = Buffer.from(await r.arrayBuffer()).toString('utf8');
    assert.ok(metin.startsWith('\uFEFFsunucu;'));
    assert.ok(metin.includes("APPSRV01;;;;'=cmd;"), metin.split('\r\n')[1]);
  });
});

test('EU5 /sw saklamasi', async () => {
  const saklama = require('../ear-envanter-saklama.cjs');
  const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-sak-')));
  const dizin = path.join(kok, 'BMW', 'ear');
  for (const n of ['kosu-1', 'kosu-2', 'kosu-3', 'kosu-99', 'baska', 'kosu-x'])
    fs.mkdirSync(path.join(dizin, n, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(dizin, 'kosu-4'), 'dosya, dizin degil');
  fs.mkdirSync(path.join(kok, 'disarda'));
  fs.writeFileSync(path.join(kok, 'disarda', 'onemli'), 'x');
  fs.symlinkSync(path.join(kok, 'disarda'), path.join(dizin, 'kosu-5'));
  const eski = new Date(Date.now() - 30 * 86400000);
  fs.utimesSync(path.join(dizin, 'kosu-99'), eski, eski);
  fs.mkdirSync(path.join(dizin, 'kosu-100'));
  F.dbKur(
    F.sahteDb([
      [/SELECT id, kip, durum FROM ear_envanter_kosulari/, () => ({ rows: [{ id: 3 }] })],
      [/SELECT id FROM ear_envanter_kosulari/, () => ({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })],
    ]),
  );
  const r = await saklama.hamSaklama(3, { dizin });
  assert.deepEqual(r.silinen.sort(), ['kosu-1', 'kosu-2', 'kosu-99']);
  const kalan = fs.readdirSync(dizin).sort();
  assert.deepEqual(kalan, ['baska', 'kosu-100', 'kosu-3', 'kosu-4', 'kosu-5', 'kosu-x']);
  assert.ok(fs.existsSync(path.join(kok, 'disarda', 'onemli')), 'bag uzerinden disari silindi');

  // Kok sembolik bag: hicbir sey silinmez.
  fs.symlinkSync(dizin, path.join(kok, 'bag'));
  const b = await saklama.hamSaklama(1, { dizin: path.join(kok, 'bag') });
  assert.deepEqual(b.silinen, []);
  assert.match(b.atlanan[0], /sembolik/);

  // DB okunamaz: hicbir sey silinmez.
  F.dbKur(
    F.sahteDb([
      [
        /ear_envanter_kosulari/,
        () => {
          throw new Error('DB yok');
        },
      ],
    ]),
  );
  await assert.rejects(saklama.hamSaklama(1, { dizin }));
  assert.ok(fs.existsSync(path.join(dizin, 'kosu-3')));
});

test('EU7 /sw saklamasi: AWX dizinleri', async () => {
  const saklama = require('../ear-envanter-saklama.cjs');
  const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-sak-awx-')));
  const dizin = path.join(kok, 'BMW', 'ear');
  for (const n of ['awx-500', 'awx-501', 'awx-502', 'awx-503', 'awx-x'])
    fs.mkdirSync(path.join(dizin, n, 'raw'), { recursive: true });
  const eski = new Date(Date.now() - 30 * 86400000);
  fs.utimesSync(path.join(dizin, 'awx-503'), eski, eski);
  F.dbKur(
    F.sahteDb([
      [/SELECT id, kip, durum FROM ear_envanter_kosulari/, () => ({ rows: [{ id: 7 }] })],
      [/SELECT id FROM ear_envanter_kosulari/, () => ({ rows: [{ id: 7 }, { id: 8 }] })],
      [
        /SELECT p\.awx_job_id, p\.kosu_id FROM ear_envanter_partileri p/,
        () => ({
          rows: [
            { awx_job_id: 500, kosu_id: 7 },
            { awx_job_id: 501, kosu_id: 8 },
          ],
        }),
      ],
    ]),
  );
  const r = await saklama.hamSaklama(3, { dizin });
  // 500: korunan kosu 7; 501: kosu 8 korunmuyor; 502: alinmamis, yeni; 503: alinmamis, 30 gunluk.
  assert.deepEqual(r.silinen.sort(), ['awx-501', 'awx-503']);
  assert.deepEqual(fs.readdirSync(dizin).sort(), ['awx-500', 'awx-502', 'awx-x']);
});

test('EU8 agac AWX kosusunda awx-<is>/raw okunur', async () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-agac-awx-')));
  fs.mkdirSync(path.join(d, 'awx-901', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(d, 'awx-901', 'raw', 'APPSRV01.out'), F.paketYap(F.ornekYuk()));
  // Ayni numarali Portal kosusu dizini: okunursa uygulama yok -> 409.
  fs.mkdirSync(path.join(d, 'kosu-88', 'raw'), { recursive: true });
  fs.writeFileSync(
    path.join(d, 'kosu-88', 'raw', 'APPSRV01.out'),
    F.paketYap(F.ornekYuk({ uygulamalar: [] })),
  );
  const poller = require('../ear-envanter-poller.cjs');
  const asil = poller.kosuOku;
  poller.kosuOku = async (id) => ({
    id: Number(id),
    kaynak: 'AWX',
    parametreler: JSON.stringify({ dizin: d, awx_job_id: 901 }),
  });
  try {
    await sunucu(async (kok) => {
      const r = await fetch(`${kok}/ear/agac/88/APPSRV01/0`);
      assert.equal(r.status, 200, await r.clone().text());
      const j = await r.json();
      assert.equal(j.uygulama.ad, 'ORNEKPANEL.ear');
      assert.equal(j.satirlar.length, 2);
    });
  } finally {
    poller.kosuOku = asil;
  }
});

test('EU6 DB saklamasi', async () => {
  const saklama = require('../ear-envanter-saklama.cjs');
  const db = F.sahteDb([
    [/SELECT COUNT\(\*\) AS adet, MIN\(id\) AS sinir/, () => ({ rows: [{ adet: 12, sinir: 30 }] })],
    [
      /SELECT MIN\(id\) AS id FROM ear_envanter_kosulari WHERE durum = 'CALISIYOR'/,
      () => ({ rows: [{ id: null }] }),
    ],
    [/DELETE TOP/, () => ({ rowCount: 0 })],
  ]);
  F.dbKur(db);
  const r = await saklama.dbSaklama(12);
  assert.equal(r.sinir, 30);
  const sinirSql = db.cagrilar[0].sql;
  assert.match(sinirSql, /WHERE kapsam = 'FILO' AND durum <> 'CALISIYOR'/);
  const silmeler = db.cagrilar.filter((c) => /DELETE TOP \(20000\)/.test(c.sql));
  assert.ok(silmeler.length >= 7, 'silme parcali olmali');
  assert.ok(
    silmeler.some((c) =>
      /FROM ear_envanter_kosulari WHERE id < \$1 AND durum <> 'CALISIYOR'/.test(c.sql),
    ),
  );

  // Yeterli filo kosusu yoksa kosu silinmez (yalniz yetim set temizligi).
  const db2 = F.sahteDb([
    [/SELECT COUNT\(\*\) AS adet/, () => ({ rows: [{ adet: 3, sinir: 1 }] })],
  ]);
  F.dbKur(db2);
  const r2 = await saklama.dbSaklama(12);
  assert.equal(r2.sinir, null);
  assert.ok(!db2.cagrilar.some((c) => /FROM ear_envanter_kosulari WHERE id </.test(c.sql)));
});

test('EU9 CSV akisi eksiksiz, suzgec gider, degisirse kesilir', async () => {
  const E = require('../ear-envanter-eslenik.cjs');
  E._sifirlaForTest();
  let toplam = 12000;
  const db = F.sahteDb([
    [/SELECT COUNT\(\*\) AS n, MAX\(id\) AS m/, () => ({ rows: [{ n: 0, m: 0 }] })],
    [/COUNT\(\*\) OVER\(\) AS toplam\s+FROM ear_envanter_uygulamalari/, (params) => {
      const [off, lim] = params.slice(-2);
      const n = Math.max(0, Math.min(lim, toplam - off));
      return { rows: Array.from({ length: n }, (_, i) => ({ host: `H${off + i}`, ad: 'A.ear', kosu_id: 1, uyg_no: off + i, toplam })) };
    }],
  ]);
  F.dbKur(db);
  await sunucu(async (kok) => {
    const f = encodeURIComponent(JSON.stringify([{ k: 'jboss', op: 'esit', v: '8' }]));
    const r = await fetch(`${kok}/ear/disa-aktar/uygulamalar.csv?f=${f}&s=jsp:desc`);
    assert.equal(r.status, 200);
    const bayt = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...bayt.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
    const metin = bayt.subarray(3).toString('utf8');
    const satirlar = metin.trim().split('\r\n');
    assert.equal(satirlar.length, 12001, 'baslik + 12000 satir');
    assert.ok(metin.startsWith('sunucu;'));
    assert.ok(satirlar[1].startsWith('H0;') && satirlar.at(-1).startsWith('H11999;'));
    assert.equal(new Set(satirlar.slice(1).map((x) => x.split(';')[0])).size, 12000, 'tekrar yok');
    const sorgular = db.cagrilar.filter((c) => /OVER\(\) AS toplam\s+FROM ear_envanter_uygulamalari/.test(c.sql));
    assert.deepEqual(sorgular.map((c) => c.params.slice(-2)), [[0, 1], [0, 5000], [5000, 5000], [10000, 5000]]);
    for (const c of sorgular) {
      assert.match(c.sql, /u\.jboss = \$\d+/, 'ekrandaki suzgec CSV ye de uygulanir');
      assert.match(c.sql, /ORDER BY u\.jsp DESC/);
    }
    const kotu = await fetch(`${kok}/ear/disa-aktar/uygulamalar.csv?f=${encodeURIComponent('[{"k":"yok","op":"esit","v":"a"}]')}`);
    assert.equal(kotu.status, 400, 'gecersiz suzgec baslik gitmeden reddedilir');
    // Akis sirasinda toplam degisir: yarim dosya "tam" sanilmasin, baglanti kesilsin.
    let n = 0;
    const asil = db.mod.query;
    db.mod.query = async (sql, params) => {
      const r2 = await asil(sql, params);
      if (/OVER\(\) AS toplam\s+FROM ear_envanter_uygulamalari/.test(sql) && ++n === 3) toplam = 11000;
      return r2;
    };
    await assert.rejects(
      fetch(`${kok}/ear/disa-aktar/uygulamalar.csv`).then((x) => x.text()),
      'degisen veride indirme hata ile biter',
    );
  });
});

test('EU10 warlar set izi vermez; degerler kolonu dogrular', async () => {
  const db = F.sahteDb([
    [/FROM ear_envanter_warlari w\s+JOIN son/, () => ({ rows: [{ host: 'H1', ad: 'A.war', kutuphane_seti: 'abc', toplam: 1 }] })],
  ]);
  F.dbKur(db);
  await sunucu(async (kok) => {
    const r = await (await fetch(`${kok}/ear/warlar`)).json();
    assert.equal(r.toplam, 1);
    assert.ok(!('kutuphane_seti' in r.satirlar[0]));
    assert.equal((await fetch(`${kok}/ear/degerler/uygulamalar/jsp`)).status, 400);
    assert.equal((await fetch(`${kok}/ear/degerler/yok/host`)).status, 400);
  });
});

test('EU11 yapi farki parametresi ve OZET kopya', async () => {
  const poller = require('../ear-envanter-poller.cjs');
  const alim = require('../ear-envanter-alim.cjs');
  const asilOku = poller.kosuOku;
  const asilHam = alim.hamOku;
  poller.kosuOku = async (id) => ({ id, kaynak: 'PORTAL', parametreler: '{}' });
  alim.hamOku = async () =>
    F.paketYap({ ...F.ornekYuk(), kip: 'OZET', uygulamalar: [{ ...F.ornekUygulama(), satirlar: [] }] });
  try {
    await sunucu(async (kok) => {
      assert.equal((await fetch(`${kok}/ear/yapi-farki?a=1:H1&b=2:H2:0`)).status, 400);
      assert.equal((await fetch(`${kok}/ear/yapi-farki?a=1:H1;x:0&b=2:H2:0`)).status, 400);
      const r = await (await fetch(`${kok}/ear/yapi-farki?a=1:APPSRV01:0&b=2:APPSRV02:0`)).json();
      assert.match(r.hesaplanamadi, /ÖZET taramada dosya ağacı tutulmaz/);
    });
  } finally {
    poller.kosuOku = asilOku;
    alim.hamOku = asilHam;
  }
});

test('EU12 eslenik uclari', async () => {
  require('../ear-envanter-eslenik.cjs')._sifirlaForTest();
  const db = F.sahteDb([[/SELECT COUNT\(\*\) AS n, MAX\(id\) AS m/, () => ({ rows: [{ n: 0, m: 0 }] })]]);
  F.dbKur(db);
  await sunucu(async (kok) => {
    const r = await (await fetch(`${kok}/ear/eslenikler?tur=ortamlar_arasi&karar=FARKLI_KUTUPHANE&limit=10`)).json();
    assert.deepEqual([r.ok, r.toplam, r.satirlar], [true, 0, []]);
    assert.equal((await fetch(`${kok}/ear/eslenik?tur=ORTAM_ICI&ad=A.ear&ortam=PROD&jboss=8`)).status, 409);
    assert.equal((await fetch(`${kok}/ear/eslenik?ad=`)).status, 400);
    assert.equal((await fetch(`${kok}/ear/eslenik?tur=NESIL&ad=A.ear&host=k%C3%B6t%C3%BC`)).status, 400);
    const csv = await fetch(`${kok}/ear/disa-aktar/eslenikler.csv?tur=ORTAMLAR_ARASI`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition'), /eslenikler_ortamlar_arasi_/);
  });
});
