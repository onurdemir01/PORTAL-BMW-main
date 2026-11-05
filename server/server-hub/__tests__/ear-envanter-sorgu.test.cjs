// server/server-hub/__tests__/ear-envanter-sorgu.test.cjs - Uygulama Envanteri sorgulari ve sutun suzgeci.
// (Eslenik karar tablosu: ear-envanter-eslenik.test.cjs.)
//
//   ES7  uygulama sorgusu: SON DURUM CTE'si, kacisli LIKE, eski parametreler, sayfa ust siniri, sayfasiz = tumu
//   ES8  ozet hostlari cekmez; bulunamayan eslenik grubu 409
//   ES9  sutun suzgeci GUVENLIGI: beyaz liste, islec / tip, 20 suzgec, deger sayilari; girdi SQL metnine girmez
//   ES10 kesilme yok: kutuphaneler / kullananlar / warlar TOP'suz, toplamli; sayilar HAVING'de
//   ES11 sunucu satiri: neden ve playbook metni hep dolu
//   ES12 acilir liste degerleri: kendi suzgeci haric, WAR teknolojisi uygulama basina, eslenik analizden
//   ES13 eslenik listesi: tur, birebir ortam, sayfa + toplam; eski cagri bicimi
//   ES14 tarih farki alt / ust siniri birlikte; kosu listesi plan anahtarini tasir (plan 1 / plan 2 etiketi)
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/ear-envanter.cjs');

const sorgu = require('../ear-envanter-sorgu.cjs');
const kolonlar = require('../ear-envanter-kolonlar.cjs');
const E = require('../ear-envanter-eslenik.cjs');

afterEach(() => {
  F.dbKaldir();
  E._sifirlaForTest();
});

/** Eslenik analizi bos donsun (uygulama satirlarina ek). */
const bosAnaliz = [
  [/SELECT COUNT\(\*\) AS n, MAX\(id\) AS m/, () => ({ rows: [{ n: 0, m: 0 }] })],
];

test('ES7 uygulama sorgusu', async () => {
  assert.equal(sorgu.likeDeseni('a%b_c[d\\e'), '%a\\%b\\_c\\[d\\\\e%');
  assert.equal(sorgu.likeDeseni('  '), '');
  const db = F.sahteDb([
    ...bosAnaliz,
    [/COUNT\(\*\) OVER\(\) AS toplam\s+FROM ear_envanter_uygulamalari/, () => ({ rows: [{ toplam: 3, host: 'H1', kosu_id: 1, uyg_no: 0 }] })],
  ]);
  F.dbKur(db);
  const u = await sorgu.uygulamalar({ q: 'odeme', jboss: '9', durum: 'EKSIK', ortam: ' prod ', limit: 100000, offset: -5 });
  assert.equal(u.toplam, 3);
  const c = db.cagrilar.find((x) => /OVER\(\) AS toplam/.test(x.sql));
  assert.match(c.sql, /WHERE veri_var = 1 AND \(\$1 = 0 OR kosu_id = \$1\) GROUP BY host/);
  assert.match(c.sql, /ESCAPE '\\'/);
  assert.match(c.sql, /u\.durum <> 'TAM'/, 'EKSIK = TAM olmayan');
  assert.match(c.sql, /UPPER\(LTRIM\(RTRIM\(h\.ortam\)\)\) IN \(SELECT value FROM OPENJSON/, 'ortam BIREBIR (LIKE degil)');
  assert.doesNotMatch(c.sql, /u\.jboss =/, 'gecersiz nesil suzgeci yok sayilir');
  assert.equal(c.params[0], 0);
  assert.ok(c.params.includes('%odeme%'));
  assert.ok(c.params.includes('["PROD"]'), 'ortam normalize');
  assert.deepEqual(c.params.slice(-2), [0, 5000], 'negatif offset 0; sayfa ust siniri');
  await sorgu.uygulamalar({ kosu: '12' });
  const t = db.cagrilar.filter((x) => /OVER\(\) AS toplam/.test(x.sql)).at(-1);
  assert.equal(t.params[0], 12);
  assert.doesNotMatch(t.sql, /OFFSET/, 'sayfasiz cagri TUM satirlar (kesilme yok)');
});

test('ES8 ozet hostlari cekmez; bulunamayan eslenik grubu 409', async () => {
  const db = F.sahteDb([
    ...bosAnaliz,
    [/FROM ear_envanter_kosulari WHERE id = \$1/, () => ({ rows: [{ id: 3, parametreler: '{}' }] })],
  ]);
  F.dbKur(db);
  const d = await sorgu.kosuDetay(3, { hostlarla: false });
  assert.deepEqual(d.hostlar, []);
  assert.ok(!db.cagrilar.some((c) => /veri AS \(SELECT host/.test(c.sql)), 'ozet host listesi sorgulamamali');
  await assert.rejects(sorgu.eslenikFarki({ ad: 'A.ear', ortam: 'PROD', jboss: '8' }), (e) => e.status === 409);
});

test('ES9 sutun suzgeci guvenligi', async () => {
  const kotu = "x'); DROP TABLE ear_envanter_hostlari;--";
  assert.throws(() => kolonlar.suzgecleriAyristir('uygulamalar', [{ k: kotu, op: 'esit', v: 'a' }]), (e) => e.status === 400);
  assert.throws(() => kolonlar.suzgecleriAyristir('uygulamalar', [{ k: 'jsp', op: 'icerir', v: 'a' }]), (e) => e.status === 400, 'sayi kolonunda metin islemi');
  assert.throws(() => kolonlar.suzgecleriAyristir('uygulamalar', [{ k: 'jsp', op: 'in', v: ['1', 'x'] }]), (e) => e.status === 400, 'sayi IN degeri sayi');
  assert.throws(() => kolonlar.suzgecleriAyristir('uygulamalar', Array.from({ length: 21 }, () => ({ k: 'host', op: 'dolu' }))), (e) => e.code === 'cok_suzgec');
  assert.throws(() => kolonlar.suzgecleriAyristir('uygulamalar', [{ k: 'host', op: 'in', v: Array(51).fill('a') }]), (e) => e.status === 400);
  assert.throws(() => kolonlar.suzgecleriAyristir('uygulamalar', '{bozuk'), (e) => e.status === 400);
  assert.throws(() => kolonlar.suzgecleriAyristir('uygulamalar', [{ k: 'constructor', op: 'esit', v: 'a' }]), (e) => e.status === 400, 'prototip anahtari kolon degil');
  assert.throws(() => kolonlar.siraAyristir('uygulamalar', `${kotu}:asc`), (e) => e.status === 400);
  assert.throws(() => kolonlar.siraAyristir('uygulamalar', 'spring_security:asc'), (e) => e.status === 400, 'WAR teknolojisi siralanmaz');
  assert.equal(kolonlar.siraAyristir('uygulamalar', 'jsp:desc'), 'u.jsp DESC, u.host, u.kok, u.ad, u.id');
  const db = F.sahteDb(bosAnaliz);
  F.dbKur(db);
  await sorgu.uygulamalar({
    q: kotu,
    f: JSON.stringify([
      { k: 'ad', op: 'in', v: [kotu, null] },
      { k: 'bag_hedefi', op: 'icerir', v: kotu },
      { k: 'spring_security', op: 'esit', v: kotu },
      { k: 'taranma_utc', op: 'gun', v: 7 },
      { k: 'application_xml', op: 'hayir' },
      { k: 'jsp', op: 'min', v: 1 },
    ]),
    s: 'jsp:asc',
    limit: 50,
  });
  for (const c of db.cagrilar) assert.ok(!c.sql.includes('DROP TABLE'), 'girdi SQL metnine girmedi');
  const c = db.cagrilar.find((x) => /OVER\(\) AS toplam/.test(x.sql));
  assert.match(c.sql, /\(u\.ad IN \(SELECT value FROM OPENJSON\(\$\d+\)\) OR u\.ad IS NULL\)/);
  assert.match(c.sql, /EXISTS \(SELECT 1 FROM ear_envanter_warlari w WHERE .* AND w\.spring_security = \$\d+\)/);
  assert.match(c.sql, /h\.taranma_utc >= DATEADD\(day, -\$\d+, SYSUTCDATETIME\(\)\)/);
  assert.match(c.sql, /\(u\.application_xml = 0 OR u\.application_xml IS NULL\)/);
  assert.match(c.sql, /ORDER BY u\.jsp ASC, u\.host/);
  assert.ok(c.params.includes(JSON.stringify([kotu])));
});

test('ES10 kesilme yok: TOP yok, toplam var', async () => {
  const db = F.sahteDb([
    [/GROUP BY s\.ad, s\.surum/, () => ({ rows: [{ ad: 'a', surum: '1', toplam: 25000 }] })],
    [/x AS \(SELECT DISTINCT/, () => ({ rows: [{ host: 'H1', toplam: 7000 }] })],
    [/FROM ear_envanter_warlari w\s+JOIN son/, () => ({ rows: [{ host: 'H1', toplam: 300000 }] })],
  ]);
  F.dbKur(db);
  const k = await sorgu.kutuphaneler({ f: [{ k: 'host_sayisi', op: 'min', v: 2 }] });
  assert.equal(k.toplam, 25000);
  const ku = await sorgu.kutuphaneKullananlar({ ad: 'a', surum: '1' });
  assert.equal(ku.toplam, 7000);
  const w = await sorgu.warlar({});
  assert.equal(w.toplam, 300000);
  for (const c of db.cagrilar) assert.doesNotMatch(c.sql, /TOP \(\d{4,}\)/, 'sessiz TOP kesmesi yok');
  const kc = db.cagrilar.find((c) => /GROUP BY s\.ad, s\.surum/.test(c.sql));
  assert.match(kc.sql, /HAVING COUNT\(DISTINCT k\.host\) >= \$\d+/);
  await sorgu.kutuphaneler({ limit: 100, offset: 200 });
  assert.match(db.cagrilar.at(-1).sql, /OFFSET \$\d+ ROWS FETCH NEXT \$\d+ ROWS ONLY/);
});

test('ES11 sunucu satiri: neden ve playbook hep dolu', async () => {
  const db = F.sahteDb([
    [/veri AS \(SELECT host/, () => ({
      rows: [
        { host: 'A', durum: 'TAM', uygulama_sayisi: 28, playbook_durum: 'SONUC' },
        { host: 'B', durum: 'KISMI', eksik_uygulama: 3, ilk_eksik_ad: 'X.ear', ilk_eksik_durum: 'KISMI_SINIR', uyarilar: '["derinlik siniri: a/b"]', playbook_durum: 'SONUC' },
        { host: 'C', durum: 'KOK_YOK', kokler: '[{"yol":"/vhosting","durum":"YOK"},{"yol":"/vhosting8","durum":"YOK"}]' },
        { host: 'D', durum: 'ULASILAMADI', hata: null, playbook_durum: 'ULASILAMADI' },
        { host: 'E', durum: 'KISMI', uyarilar: '[]', kokler: '[{"yol":"/vhosting","durum":"HATA","hata":"PermissionError"}]' },
      ],
    })],
  ]);
  F.dbKur(db);
  const h = await sorgu.hostlar({});
  const n = Object.fromEntries(h.map((x) => [x.host, x.neden]));
  assert.equal(n.A, 'başarılı · 28 uygulama tam tarandı');
  assert.equal(n.B, '3 uygulama eksik tarandı: X.ear (kısmi · sınır) … · derinlik siniri: a/b');
  assert.equal(n.C, '/vhosting ve /vhosting8 yok: bu sunucuda taranacak uygulama yok');
  assert.equal(n.D, 'AWX sunucuya bağlanamadı.');
  assert.equal(n.E, '/vhosting okunamadı (PermissionError)');
  for (const x of h) assert.ok(x.neden && x.neden !== '—', `${x.host} nedeni bos`);
  assert.deepEqual(h.map((x) => x.playbook_etiket), ['sonuç geldi', 'sonuç geldi', 'kayıt yok', 'ulaşılamadı', 'kayıt yok']);
  assert.match(db.cagrilar[0].sql, /OUTER APPLY \(SELECT COUNT\(\*\) AS eksik_uygulama/);
});

test('ES12 acilir liste degerleri', async () => {
  const db = F.sahteDb([
    ...bosAnaliz,
    [/AS deger/, () => ({ rows: [{ deger: 'PROD', sayi: 5, farkli: 2 }, { deger: null, sayi: 1, farkli: 2 }] })],
  ]);
  F.dbKur(db);
  const r = await sorgu.degerler({
    gorunum: 'uygulamalar',
    kolon: 'ortam',
    f: JSON.stringify([{ k: 'ortam', op: 'in', v: ['TEST'] }, { k: 'jboss', op: 'esit', v: '8' }]),
    ara: 'pr',
  });
  assert.deepEqual(r, { degerler: [{ deger: 'PROD', sayi: 5 }, { deger: null, sayi: 1 }], farkli: 2 });
  const c = db.cagrilar.find((x) => /AS deger/.test(x.sql));
  assert.doesNotMatch(c.sql, /h\.ortam\)\)\) IN \(SELECT/, 'kolonun kendi suzgeci uygulanmaz');
  assert.match(c.sql, /u\.jboss = \$\d+/, 'oteki suzgecler uygulanir');
  assert.match(c.sql, /TOP \(200\)/);
  await sorgu.degerler({ gorunum: 'uygulamalar', kolon: 'logback' });
  assert.match(db.cagrilar.at(-1).sql, /COUNT\(DISTINCT CONCAT\(u\.kosu_id, '\|', u\.host, '\|', u\.uyg_no\)\)/, 'WAR teknolojisi uygulama basina');
  await assert.rejects(sorgu.degerler({ gorunum: 'uygulamalar', kolon: 'jsp' }), (e) => e.status === 400, 'sayi kolonu acilir liste degil');
  await assert.rejects(sorgu.degerler({ gorunum: 'yok', kolon: 'x' }), (e) => e.status === 400);
});

test('ES13 eslenik listesi', async () => {
  const satir = (host, ortam, ek = {}) => ({
    kosu_id: 1, host, ortam, uyg_no: 0, kok: '/vhosting8', jboss: '8', ad: 'A.ear', durum: 'TAM', kip: 'TAM',
    yapi_izi: 'y', ear_kutuphane_seti: null, bag_hedefi: null, taranma_utc: null, ...ek,
  });
  const db = F.sahteDb([
    [/SELECT COUNT\(\*\) AS n, MAX\(id\) AS m/, () => ({ rows: [{ n: 4, m: 9 }] })],
    [/SELECT u\.kosu_id, u\.host, h\.ortam, u\.uyg_no, u\.kok/, () => ({
      rows: [satir('P1', 'PROD'), satir('P2', 'prod'), satir('Q1', 'PREPROD'), satir('Q2', 'PREPROD', { yapi_izi: 'z' }), satir('X1', null)],
    })],
  ]);
  F.dbKur(db);
  const eski = await sorgu.eslenikler({ ortam: 'prod' });
  assert.deepEqual(eski.gruplar.map((g) => g.ortam), ['PROD'], 'ortam birebir: PREPROD gelmez');
  assert.deepEqual(eski.gruplar[0].gruplar, [{ iz: 'A', hostlar: ['P1', 'P2'] }]);
  assert.equal(eski.ortamYok.length, 1);
  const y = await sorgu.eslenikler({ tur: 'ORTAM_ICI', limit: 1, offset: 0 });
  assert.equal(y.toplam, 2);
  assert.equal(y.satirlar.length, 1);
  assert.equal(y.satirlar[0].karar, 'FARKLI_YAPI', 'farklar once');
  assert.deepEqual(y.sayilar, { FARKLI_YAPI: 1, AYNI: 1 });
  assert.equal(y.satirlar[0].kopyalar, undefined, 'liste kopya ayrintisi tasimaz');
  const ar = await sorgu.eslenikler({ tur: 'ORTAMLAR_ARASI' });
  assert.equal(ar.toplam, 1);
  assert.deepEqual(ar.satirlar[0].ortamlar.map((o) => o.ortam), ['PREPROD', 'PROD']);
  const yok = await sorgu.eslenikler({ tur: 'ORTAM_YOK' });
  assert.deepEqual(yok.satirlar[0].hostlar, ['X1']);
  const k = await sorgu.eslenikler({ tur: 'ORTAM_ICI', karar: 'AYNI' });
  assert.deepEqual(k.satirlar.map((g) => g.ortam), ['PROD']);
});

test('ES14 tarih farki araligi ve plan anahtari', async () => {
  const satir = (host, taranma) => ({
    kosu_id: 1, host, ortam: 'PROD', uyg_no: 0, kok: '/vhosting8', jboss: '8', ad: 'A.ear', durum: 'TAM', kip: 'TAM',
    yapi_izi: 'y', ear_kutuphane_seti: null, bag_hedefi: null, taranma_utc: taranma,
  });
  const db = F.sahteDb([
    [/SELECT COUNT\(\*\) AS n, MAX\(id\) AS m/, () => ({ rows: [{ n: 2, m: 3 }] })],
    [/SELECT u\.kosu_id, u\.host, h\.ortam, u\.uyg_no, u\.kok/, () => ({
      rows: [satir('P1', '2026-10-01T00:00:00'), satir('P2', '2026-11-01T00:00:00')],
    })],
    [/FROM ear_envanter_kosulari k ORDER BY id DESC/, () => ({ rows: [] })],
  ]);
  F.dbKur(db);
  const say = async (o) => (await sorgu.eslenikler({ tur: 'ORTAM_ICI', ...o })).toplam;
  assert.equal(await say({ tarihFarki: 7 }), 1);
  assert.equal(await say({ tarihFarki: 7, tarihFarkiMax: 30 }), 0, '31 gun > 30');
  assert.equal(await say({ tarihFarkiMax: 31 }), 1);
  assert.equal(await say({ tarihFarkiMax: '' }), 1, 'bos ust sinir yok sayilir');
  await sorgu.kosular(10);
  assert.match(db.cagrilar.at(-1).sql, /zamanlayici_anahtari/);
});
