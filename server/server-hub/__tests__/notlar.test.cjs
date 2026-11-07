// server/server-hub/__tests__/notlar.test.cjs — kalici Admin notlari / siniflar (2026-11-07).
//
//   NT1 not ve sinif dogrulama (400 bicim, 422 bilinmeyen sinif; etiket / metin sinirlari; yayilim varsayilani)
//   NT2 yayilim: YALNIZ / ASAGI (app -> kopya -> vhost -> IP) / ZINCIR; yetim not (konu grafikte yok); arsiv disarida
//   NT3 imza ve "veri degisti"; BILINEN etkili sinif maddeyi / varligin tamamini bastirir, BILGI bastirmaz
//   NT4 DB: ekleme + gecmis, iyimser kilit 409, arsiv / kalici sil / geri al + gecmis, sinif silme kurallari,
//       okunamayan depo okunamadi (dusmez)
//   NT5 uclar: POST 201 (imza saklanir, yetim), 400 / 422, PUT konu degismez / eski surum 409, DELETE arsiv /
//       kalici onay ister, geri al, gecmis, siniflar
//   NT6 kararlar + notlar: BILINEN uygulama ana sayimdan duser; madde isareti; KARAR DEGISMEZ
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const F = require('./fixtures/ear-envanter.cjs');
const { grafikKur, A } = require('../iliski-grafigi.cjs');
const { dogrula } = require('../dogrulama.cjs');
const { kararla } = require('../senaryo.cjs');

let N;
function yukle() {
  delete require.cache[require.resolve('../notlar.cjs')];
  N = require('../notlar.cjs');
  return N;
}
afterEach(() => F.dbKaldir());

const SINIF = () => yukle().SINIF_VARSAYILAN.map((s) => ({ ...s }));

// Kucuk grafik: app APP1 -> jvm (APPSRV01) <- vhost (WEBSRV01) -> ip; ikinci uygulama BASKA ayni sunucuda.
function grafik() {
  const shV = {
    product: 'IHS',
    listen: '10.0.0.10:80',
    serverName: 'app1.ornek.local',
    aliases: '',
    req7d: 0,
    trafficState: 'NO_RECENT_TRAFFIC',
  };
  const hosts = [
    {
      host: 'APPSRV01',
      env: 'PROD',
      scanDate: '2026-11-07',
      fresh: true,
      ips: [{ ip: '10.0.1.1' }],
      web: [],
      vhosts: [],
      jvms: [
        {
          gen: 8,
          name: 'APP1',
          running: false,
          runningKnown: true,
          autoStart: 'false',
          ports: [8109],
          cfgPorts: [],
          cfgPortsAuth: false,
          vhosts: [{ host: 'WEBSRV01', v: shV, kind: 'EXACT_JVM' }],
        },
        {
          gen: 8,
          name: 'BASKA',
          running: true,
          runningKnown: true,
          autoStart: 'true',
          ports: [8209],
          cfgPorts: [],
          cfgPortsAuth: false,
          vhosts: [],
        },
      ],
    },
    {
      host: 'WEBSRV01',
      env: 'PROD',
      scanDate: '2026-11-07',
      fresh: true,
      ips: [{ ip: '10.0.0.10' }],
      jvms: [],
      web: [{ product: 'IHS', running: true, runningKnown: true }],
      vhosts: [shV],
    },
  ];
  const veri = { hostlar: new Map(), ipEnvanteri: { okunamadi: false, satirlar: [] } };
  const g = grafikKur({ hosts, veri });
  const kararlar = kararla({ g, dogrulamalar: dogrula(g, { veri }), hosts });
  return { hosts, veri, g, kararlar };
}
const not = (ek = {}) => ({
  id: 1,
  konu: 'app:APP1',
  supheli_kod: null,
  sinif: 'BILINEN',
  etiketler: [],
  metin: 'bilinen durum',
  yayilim: 'YALNIZ',
  durum: 'AKTIF',
  imza: null,
  surum: 1,
  ...ek,
});

test('NT1 dogrulama', () => {
  const s = SINIF();
  const n = N.notDogrula(
    {
      konu: 'app:APP1',
      sinif: 'bilinen',
      etiketler: ['geçiş', 'geçiş', ' SCC-123 '],
      metin: 'Planlı kapanış',
    },
    s,
  );
  assert.deepEqual(n, {
    konu: 'app:APP1',
    supheli_kod: null,
    sinif: 'BILINEN',
    etiketler: ['geçiş', 'SCC-123'],
    metin: 'Planlı kapanış',
    yayilim: 'YALNIZ',
  });
  assert.equal(
    N.notDogrula(
      {
        konu: 'vhost:WEB|IHS|a|80',
        sinif: 'DUZELTILECEK',
        metin: 'abc',
        supheli_kod: 'web_yalniz_hc',
        yayilim: 'zincir',
      },
      s,
    ).supheli_kod,
    'WEB_YALNIZ_HC',
  );
  const atar = (b, kod) =>
    assert.throws(
      () => N.notDogrula(b, s),
      (e) => e.status === kod,
      JSON.stringify(b),
    );
  atar({ konu: 'uygulama:X', sinif: 'BILINEN', metin: 'abc' }, 400);
  atar({ konu: 'app:X', sinif: 'YOK_BOYLE', metin: 'abc' }, 422);
  atar({ konu: 'app:X', sinif: 'BILINEN', metin: 'ab' }, 400);
  atar({ konu: 'app:X', sinif: 'BILINEN', metin: 'abc', etiketler: ['<script>'] }, 400);
  atar(
    {
      konu: 'app:X',
      sinif: 'BILINEN',
      metin: 'abc',
      etiketler: Array.from({ length: 21 }, (_, i) => `e${i}`),
    },
    400,
  );
  atar({ konu: 'app:X', sinif: 'BILINEN', metin: 'abc', supheli_kod: 'kod boslukla' }, 400);
  assert.deepEqual(
    N.sinifDogrula({
      ad: 'lb_cikarildi',
      baslik: 'LB’den çıkarıldı',
      renk: 'bilgi',
      etki: 'bilgi',
      sira: 5,
    }),
    {
      ad: 'LB_CIKARILDI',
      baslik: 'LB’den çıkarıldı',
      renk: 'bilgi',
      etki: 'BILGI',
      aciklama: '',
      sira: 5,
    },
  );
  assert.throws(
    () => N.sinifDogrula({ ad: 'X1', baslik: 'ab', renk: 'mor', etki: 'BILGI' }),
    (e) => e.status === 400,
  );
});

test('NT2 yayilim, yetim, arsiv', () => {
  yukle();
  const { g } = grafik();
  const jvm = A.jvm('APPSRV01', 8, 'APP1');
  const vh = A.vhost('WEBSRV01', 'IHS', 'app1.ornek.local', 80);
  assert.deepEqual([...N.yayilimKumesi(g, 'app:APP1', 'YALNIZ').keys()], ['app:APP1']);
  const asagi = N.yayilimKumesi(g, 'app:APP1', 'ASAGI');
  assert.deepEqual(
    asagi.get('ip:10.0.0.10'),
    ['app:APP1', jvm, vh, 'ip:10.0.0.10'],
    'app -> kopya -> vhost -> IP yolu',
  );
  assert.ok(!asagi.has('sunucu:APPSRV01'), 'ASAGI yukari (sunucu) cikmaz');
  assert.ok(!asagi.has('app:BASKA'));
  const zincir = N.yayilimKumesi(g, 'app:APP1', 'ZINCIR');
  assert.ok(
    zincir.has('sunucu:APPSRV01') && zincir.has('app:BASKA'),
    'ZINCIR bagli bileseni kapsar',
  );
  const { varlikNotlari, yetimler } = N.notlariIndeksle(
    [
      not({ id: 1, yayilim: 'ASAGI' }),
      not({ id: 2, konu: 'app:ESKIUYG' }),
      not({ id: 3, durum: 'ARSIV' }),
    ],
    g,
  );
  assert.deepEqual(
    yetimler.map((x) => x.id),
    [2],
    'konu grafikte yok: yetim (silinmez)',
  );
  assert.deepEqual(
    varlikNotlari.get(vh).map((x) => [x.not.id, x.dogrudan]),
    [[1, false]],
  );
  assert.ok(!varlikNotlari.has('sunucu:APPSRV01'));
  assert.ok(![...varlikNotlari.values()].flat().some((x) => x.not.id === 3), 'arsiv uygulanmaz');
});

test('NT3 imza, veri degisti, BILINEN / BILGI', () => {
  yukle();
  const { g, kararlar } = grafik();
  const jvm = A.jvm('APPSRV01', 8, 'APP1');
  const imza = N.imzaOf(g, kararlar, jvm);
  assert.match(imza, /^[0-9a-f]{32}$/);
  assert.equal(N.imzaOf(g, kararlar, 'app:YOK'), null);
  const siniflar = SINIF();
  const ctx = (notlar) => ({ indeks: N.notlariIndeksle(notlar, g), siniflar, g, kararlar });
  const k1 = N.kararNotlari(jvm, ctx([not({ id: 1, konu: jvm, imza, supheli_kod: 'JVM_KAPALI' })]));
  assert.equal(k1.notlar[0].veriDegisti, false);
  assert.equal(k1.bilinenKodlar.get('JVM_KAPALI').id, 1);
  assert.equal(k1.tumuBilinen, null);
  const k2 = N.kararNotlari(jvm, ctx([not({ id: 2, konu: jvm, imza: 'f'.repeat(32) })]));
  assert.equal(k2.notlar[0].veriDegisti, true, 'imza degisti: not KALIR, rozet');
  assert.equal(k2.tumuBilinen.id, 2);
  const k3 = N.kararNotlari(jvm, ctx([not({ id: 3, konu: jvm, sinif: 'DUZELTILECEK' })]));
  assert.equal(k3.tumuBilinen, null, 'BILGI etkili sinif bastirmaz');
  assert.equal(k3.notlar.length, 1);
});

function sahte(kurallar) {
  const s = F.sahteDb(kurallar);
  F.dbKur(s);
  return s;
}
const satir = (ek = {}) => ({
  id: 7,
  konu: 'app:APP1',
  supheli_kod: null,
  sinif: 'BILINEN',
  etiketler: '[]',
  metin: 'm',
  yayilim: 'YALNIZ',
  durum: 'AKTIF',
  imza: null,
  surum: 2,
  olusturan: 'ayse',
  olusturuldu: new Date(),
  ...ek,
});

test('NT4 DB islemleri', async () => {
  let s = sahte([[/INSERT INTO server_hub_notlar/, () => ({ rows: [{ id: 7 }] })]]);
  yukle();
  const id = await N.notEkle(
    {
      konu: 'app:APP1',
      supheli_kod: null,
      sinif: 'BILINEN',
      etiketler: ['a'],
      metin: 'mmm',
      yayilim: 'YALNIZ',
    },
    { kim: 'ayse', imza: 'a'.repeat(32) },
  );
  assert.equal(id, 7);
  assert.ok(
    s.cagrilar.some(
      (c) => /INSERT INTO server_hub_not_gecmisi/.test(c.sql) && c.params[1] === 'EKLE',
    ),
  );
  // iyimser kilit
  s = sahte([
    [/SELECT id, konu/, () => ({ rows: [satir()] })],
    [/UPDATE server_hub_notlar/, () => ({ rowCount: 0 })],
  ]);
  yukle();
  await assert.rejects(
    N.notGuncelle(
      7,
      { supheli_kod: null, sinif: 'BILINEN', etiketler: [], metin: 'yeni', yayilim: 'YALNIZ' },
      { kim: 'x', surum: 1, imza: null },
    ),
    (e) => e.status === 409,
    'eski surum',
  );
  await assert.rejects(
    N.notGuncelle(
      7,
      { supheli_kod: null, sinif: 'BILINEN', etiketler: [], metin: 'yeni', yayilim: 'YALNIZ' },
      { kim: 'x', surum: 2, imza: null },
    ),
    (e) => e.status === 409,
    'arada degisti (rowCount 0)',
  );
  // arsiv / sil / geri al -> gecmis
  for (const [durum, islem, re] of [
    ['ARSIV', 'ARSIV', /UPDATE server_hub_notlar SET durum/],
    ['SIL', 'SIL', /DELETE FROM server_hub_notlar/],
    ['AKTIF', 'GERI_AL', /UPDATE server_hub_notlar SET durum/],
  ]) {
    s = sahte([[/SELECT id, konu/, () => ({ rows: [satir()] })]]);
    yukle();
    await N.notDurum(7, durum, { kim: 'ayse' });
    assert.ok(
      s.cagrilar.some((c) => re.test(c.sql)),
      durum,
    );
    const g = s.cagrilar.find((c) => /server_hub_not_gecmisi/.test(c.sql));
    assert.equal(g.params[1], islem);
    assert.equal(JSON.parse(g.params[2]).id, 7, 'onceki hali gecmise');
  }
  s = sahte([[/SELECT id, konu/, () => ({ rows: [] })]]);
  yukle();
  await assert.rejects(N.notDurum(99, 'ARSIV', { kim: 'x' }), (e) => e.status === 409);
  // sinif silme
  await assert.rejects(N.sinifSil('bilinen'), (e) => e.status === 409, 'varsayilan silinmez');
  s = sahte([[/SELECT COUNT/, () => ({ rows: [{ n: 2 }] })]]);
  yukle();
  await assert.rejects(
    N.sinifSil('LB_CIKARILDI'),
    (e) => e.status === 409,
    'aktif notu olan sinif silinmez',
  );
  s = sahte([
    [/SELECT COUNT/, () => ({ rows: [{ n: 0 }] })],
    [/DELETE FROM server_hub_siniflar/, () => ({ rows: [{ ad: 'LB_CIKARILDI' }] })],
  ]);
  yukle();
  await N.sinifSil('LB_CIKARILDI');
  // okunamayan depo
  F.dbKur({
    mod: {
      query: async () => {
        throw new Error('tablo yok');
      },
    },
  });
  yukle();
  const o = await N.notlariOku();
  assert.deepEqual([o.okunamadi, o.notlar.length], [true, 0]);
  const so = await N.siniflariOku();
  assert.equal(so.okunamadi, true);
  assert.equal(so.siniflar.length, 5, 'okunamazsa varsayilanlar');
});

async function sunucu(fn, { kurallar = [], notDurumu = null } = {}) {
  const s = sahte(kurallar);
  yukle();
  const gr = grafik();
  const audit = [];
  const app = express();
  app.use(express.json());
  app.use(
    (req, res, next) => ((req.session = { user: { username: 'ayse', role: 'Admin' } }), next()),
  );
  const router = express.Router();
  const hesap = require('../iliski-uclar.cjs').mount(router, {
    getAssessment: async () => ({ tableMissing: false, hosts: gr.hosts }),
    iliskiVerisi: async () => gr.veri,
    ...(notDurumu ? { notDurumu } : {}),
  });
  require('../notlar-uclar.cjs').mount(router, {
    iliskiHesabi: hesap,
    audit: (req, d) => audit.push(d),
  });
  app.use('/api/server-hub', router);
  const srv = app.listen(0);
  const kok = `http://127.0.0.1:${srv.address().port}/api/server-hub`;
  const J = async (u, method = 'GET', govde) => {
    const r = await fetch(kok + u, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: govde ? JSON.stringify(govde) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    await fn({ J, s, audit, gr });
  } finally {
    srv.close();
  }
}

test('NT5 uclar', async () => {
  await sunucu(
    async ({ J, s, audit, gr }) => {
      const r = await J('/notlar', 'POST', {
        konu: A.jvm('APPSRV01', 8, 'APP1'),
        sinif: 'BILINEN',
        metin: 'Planlı kapalı',
        supheli_kod: 'JVM_KAPALI',
      });
      assert.deepEqual([r.status, r.body.id, r.body.yetim], [201, 7, false]);
      const ins = s.cagrilar.find((c) => /INSERT INTO server_hub_notlar/.test(c.sql));
      assert.equal(
        ins.params[6],
        require('../notlar.cjs').imzaOf(gr.g, gr.kararlar, A.jvm('APPSRV01', 8, 'APP1')),
        'yazildigi anki imza saklanir',
      );
      assert.equal(
        (await J('/notlar', 'POST', { konu: 'app:YOKUYG', sinif: 'BILINEN', metin: 'abc' })).body
          .yetim,
        true,
      );
      assert.equal(
        (await J('/notlar', 'POST', { konu: 'bozuk', sinif: 'BILINEN', metin: 'abc' })).status,
        400,
      );
      assert.equal(
        (await J('/notlar', 'POST', { konu: 'app:X', sinif: 'YOK', metin: 'abc' })).status,
        422,
      );
      assert.equal(
        (
          await J('/notlar/7', 'PUT', {
            konu: 'app:BASKA',
            sinif: 'BILINEN',
            metin: 'abc',
            surum: 2,
          })
        ).status,
        400,
        'konu degismez',
      );
      assert.equal(
        (await J('/notlar/7', 'PUT', { sinif: 'BILINEN', metin: 'abc', surum: 1 })).status,
        409,
        'eski surum',
      );
      assert.equal(
        (await J('/notlar/7', 'PUT', { sinif: 'BILINEN', metin: 'abc', surum: 2 })).status,
        200,
      );
      assert.equal((await J('/notlar/abc', 'PUT', {})).status, 400);
      assert.equal((await J('/notlar/7', 'DELETE')).body.durum, 'ARSIV');
      assert.equal(
        (await J('/notlar/7?kalici=1', 'DELETE')).status,
        400,
        'kalici silme onay ister',
      );
      assert.equal((await J('/notlar/7?kalici=1&onay=1', 'DELETE')).body.durum, 'SILINDI');
      assert.equal((await J('/notlar/7/geri-al', 'POST')).body.durum, 'AKTIF');
      assert.ok(Array.isArray((await J('/notlar/7/gecmis')).body.gecmis));
      const l = await J('/notlar');
      assert.equal(l.status, 200);
      assert.equal(l.body.notlar[0].yetim, false);
      assert.equal(l.body.siniflar.length, 5);
      assert.equal(
        (
          await J('/siniflar', 'PUT', {
            ad: 'lb_cikarildi',
            baslik: 'LB’den çıkarıldı',
            renk: 'bilgi',
            etki: 'BILGI',
          })
        ).status,
        200,
      );
      assert.equal((await J('/siniflar/BILINEN', 'DELETE')).status, 409);
      assert.deepEqual(
        audit.map((a) => a.op),
        [
          'not_ekle',
          'not_ekle',
          'not_guncelle',
          'not_arsivle',
          'not_sil',
          'not_geri_al',
          'sinif_kaydet',
        ],
      );
    },
    {
      kurallar: [
        [/INSERT INTO server_hub_notlar/, () => ({ rows: [{ id: 7 }] })],
        [
          /SELECT id, konu, supheli_kod, sinif, etiketler, metin, yayilim, durum, imza, surum, olusturan, olusturuldu, guncelleyen, guncellendi\s+FROM server_hub_notlar WHERE id/,
          () => ({ rows: [satir({ konu: A.jvm('APPSRV01', 8, 'APP1') })] }),
        ],
        [/UPDATE server_hub_notlar\s+SET supheli_kod/, () => ({ rowCount: 1 })],
        [
          /FROM server_hub_notlar/,
          () => ({ rows: [satir({ konu: A.jvm('APPSRV01', 8, 'APP1') })] }),
        ],
        [
          /FROM server_hub_not_gecmisi/,
          () => ({ rows: [{ islem: 'EKLE', onceki: null, kim: 'ayse', zaman: new Date() }] }),
        ],
      ],
    },
  );
});

test('NT6 kararlar + notlar: BILINEN ayri, madde isareti, karar degismez', async () => {
  const siniflar = SINIF();
  const jvm = A.jvm('APPSRV01', 8, 'APP1');
  const notDurumu = async () => ({
    okunamadi: false,
    siniflar,
    notlar: [
      not({
        id: 1,
        konu: 'app:APP1',
        sinif: 'OLMASI_GEREKEN',
        metin: 'test ortami, kapali olmasi normal',
      }),
      not({
        id: 2,
        konu: jvm,
        sinif: 'DUZELTILECEK',
        supheli_kod: 'JVM_KAPALI',
        metin: 'acilacak',
      }),
      not({
        id: 4,
        konu: jvm,
        sinif: 'BILINEN',
        supheli_kod: 'WEB_TRAFIK_YOK',
        metin: 'trafik baska kopyaya alindi',
      }),
      not({ id: 3, konu: 'app:BASKA', sinif: 'SAHIBINE_SORULDU', metin: 'soruldu' }),
    ],
  });
  await sunucu(
    async ({ J, gr }) => {
      const l = await J('/iliski/kararlar?fresh=1');
      assert.equal(l.status, 200);
      const app1 = l.body.uygulamalar.find((u) => u.anahtar === 'app:APP1');
      const baska = l.body.uygulamalar.find((u) => u.anahtar === 'app:BASKA');
      assert.equal(app1.bilinen.id, 1, 'OLMASI_GEREKEN (BILINEN etkili) -> Bilinen bolumu');
      assert.equal(baska.bilinen, null, 'SAHIBINE_SORULDU bilgi');
      assert.equal(baska.notSayisi, 1);
      assert.equal(l.body.bilinenSayisi, 1);
      const toplam = Object.values(l.body.sayilar).reduce((a, b) => a + b, 0);
      assert.equal(toplam, l.body.uygulamalar.length - 1, 'bilinen ana sayimda yok');
      const motor = gr.kararlar.uygulamalar.get('app:APP1');
      assert.equal(app1.karar, motor.karar, 'not karari DEGISTIRMEZ');
      const d = await J(`/iliski/karar?anahtar=${encodeURIComponent('app:APP1')}`);
      const k = d.body.kopyalar[0];
      assert.deepEqual(
        k.notlar.map((n) => n.id).sort(),
        [2, 4],
        'uygulamaya yazilan not (YALNIZ) kopyaya yayilmaz',
      );
      assert.equal(
        k.maddeler.find((x) => x.kod === 'JVM_KAPALI').bilinen,
        null,
        'DUZELTILECEK (BILGI) bastirmaz',
      );
      assert.equal(
        k.maddeler.find((x) => x.kod === 'WEB_TRAFIK_YOK').bilinen.id,
        4,
        'BILINEN not yalniz kendi maddesini bastirir',
      );
      assert.equal(k.bilinen, null, 'kopyanin tamami bilinen degil');
      assert.equal(d.body.uygulama.bilinen.id, 1);
      assert.equal(k.karar, gr.kararlar.kopyalar.get(jvm).karar);
    },
    { notDurumu },
  );
});
