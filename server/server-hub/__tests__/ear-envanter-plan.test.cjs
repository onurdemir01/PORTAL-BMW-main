// server/server-hub/__tests__/ear-envanter-plan.test.cjs - Uygulama Envanteri: plan ve kapsam uclari (2026-11-05).
//
//   EK1 POST /ear/kosu kapsam: ORTAM listesi normalize edilip gider; ORTAM listesiz / bilinmeyen kapsam 400;
//       SORUNLU kabul; SECILI bos liste 400 (bos liste asla filo degil)
//   EK2 /ear/kapsam-onizleme kosu ACMAZ; SECILI icin 400
//   EK3 PUT /ear/plan/:plan tek transaction; gecersiz alan 400 ve yazma yok; yanit planlarin yeni metnini tasir
//   EK4 /ear/ozet: iki plan, sonraki calismalar; eski zamanlayici alani planlardan turetilir
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const F = require('./fixtures/ear-envanter.cjs');

const REG_YOLU = path.join(__dirname, '..', '..', 'ansible', 'playbook-registry.cjs');
afterEach(() => {
  F.dbKaldir();
  delete require.cache[REG_YOLU];
});

async function sunucu(fn) {
  const poller = require('../ear-envanter-poller.cjs');
  const ayar = require('../ear-envanter-ayar.cjs');
  ayar.onbellekSil();
  const asil = { kosuOlustur: poller.kosuOlustur, kapsamOnizleme: poller.kapsamOnizleme };
  const cagrilar = [];
  poller.kosuOlustur = async (a) => (cagrilar.push(a), { id: 9, beklenen: 3, partiSayisi: 1 });
  poller.kapsamOnizleme = async (kapsam, kip) => (
    cagrilar.push({ onizleme: kapsam, kip }),
    { sunucu: 3, parti: 1, ornek: [] }
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
    Object.assign(poller, asil);
    poller._durdurForTest();
  }
}
const istek = (url, method, govde) =>
  fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(govde),
  });

test('EK1 POST /ear/kosu kapsamlari', async () => {
  await sunucu(async (kok, c) => {
    assert.equal(
      (
        await istek(`${kok}/ear/kosu`, 'POST', {
          kip: 'OZET',
          kapsam: 'ORTAM',
          ortamlar: [' test', 'PROD'],
        })
      ).status,
      200,
    );
    assert.deepEqual([c[0].kapsam, c[0].hedefler], ['ORTAM:PROD,TEST', null]);
    assert.equal(
      (await istek(`${kok}/ear/kosu`, 'POST', { kip: 'OZET', kapsam: 'ORTAM' })).status,
      400,
    );
    assert.equal(
      (await istek(`${kok}/ear/kosu`, 'POST', { kip: 'OZET', kapsam: 'HEPSI' })).status,
      400,
    );
    assert.equal(
      (await istek(`${kok}/ear/kosu`, 'POST', { kip: 'TAM', kapsam: 'SORUNLU' })).status,
      200,
    );
    assert.equal(c[1].kapsam, 'SORUNLU');
    assert.equal(
      (await istek(`${kok}/ear/kosu`, 'POST', { kip: 'TAM', kapsam: 'SECILI', hostlar: [] }))
        .status,
      400,
    );
    assert.equal(
      (
        await istek(`${kok}/ear/kosu`, 'POST', {
          kip: 'TAM',
          kapsam: 'SECILI',
          hostlar: 'APPSRV01',
        })
      ).status,
      200,
    );
    assert.deepEqual([c[2].kapsam, c[2].hedefler], [null, [{ host: 'APPSRV01' }]]);
  });
});

test('EK2 kapsam onizleme', async () => {
  await sunucu(async (kok, c) => {
    const r = await (
      await fetch(`${kok}/ear/kapsam-onizleme?kapsam=ORTAM&ortamlar=prod&kip=TAM`)
    ).json();
    assert.deepEqual([r.kapsam, r.sunucu, r.parti], ['ORTAM:PROD', 3, 1]);
    assert.deepEqual(c, [{ onizleme: 'ORTAM:PROD', kip: 'TAM' }], 'kosu acilmadi');
    assert.equal((await fetch(`${kok}/ear/kapsam-onizleme?kapsam=SECILI`)).status, 400);
  });
});

test('EK3 PUT /ear/plan', async () => {
  const db = F.sahteDb([[/SELECT anahtar, deger/, () => ({ rows: [] })]]);
  F.dbKur(db);
  await sunucu(async (kok) => {
    const kotu = await istek(`${kok}/ear/plan/p2`, 'PUT', { acik: 'ACIK', sira: 'BESINCI' });
    assert.equal(kotu.status, 400);
    assert.ok(!db.cagrilar.some((x) => /BEGIN TRAN/.test(x.sql)), 'gecersiz alanda yazma yok');
    assert.equal((await istek(`${kok}/ear/plan/p9`, 'PUT', { acik: 'ACIK' })).status, 400);
    const r = await (
      await istek(`${kok}/ear/plan/p2`, 'PUT', { acik: 'ACIK', sira: 'SON', aralik: '3' })
    ).json();
    assert.equal(r.ok, true);
    assert.deepEqual(r.degisen.map((x) => x.anahtar).sort(), ['p2_acik', 'p2_aralik', 'p2_sira']);
    assert.equal(db.cagrilar.filter((x) => /BEGIN TRAN/.test(x.sql)).length, 1, 'tek transaction');
    assert.equal(r.planlar.length, 2);
  });
});

test('EK4 ozet planlari', async () => {
  F.dbKur(
    F.sahteDb([
      [/SELECT anahtar, deger/, () => ({ rows: [{ anahtar: 'p2_acik', deger: 'ACIK' }] })],
      [/FROM ear_envanter_kosulari k ORDER BY id DESC/, () => ({ rows: [] })],
    ]),
  );
  require.cache[REG_YOLU] = {
    id: REG_YOLU,
    filename: REG_YOLU,
    loaded: true,
    exports: { getByKey: async () => null, getEffectiveTemplateId: () => null },
  };
  await sunucu(async (kok) => {
    const r = await (await fetch(`${kok}/ear/ozet`)).json();
    assert.deepEqual(
      r.planlar.map((p) => [p.ad, p.acik, p.kip]),
      [
        ['P1', false, 'OZET'],
        ['P2', true, 'TAM'],
      ],
    );
    assert.equal(r.planlar[0].sonraki.length, 0);
    assert.equal(r.planlar[1].sonraki.length, 3);
    assert.equal(r.zamanlayici.acik, true);
    assert.equal(r.zamanlayici.sonraki, r.planlar[1].sonraki[0]);
    assert.match(r.zamanlayici.metin, /^P2: Her 2 ayda bir · ayın ilk Pazarı 03:00/);
  });
});
