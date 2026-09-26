// server/audit/__tests__/nginx-host-state.test.cjs — nginx sunucusunun OLCULEBILIRLIK durumu.
//
// Kullanici (2026-09-26): "tum envanterlerde gecerli olmak uzere, bir Nginx instance'i
// calismiyorsa ve Nginx dizini var ancak Nginx hic kurulu degilse bunu belirt."
//
// HS1 siniflandirma: kurulu degil / calismiyor / config bozuk / olculdu / bilinmiyor
// HS2 olculemeyen durum BULGU DEGILDIR (eksik demeyiz)
// HS3 eski sema: run_state kolonu yoksa is dusmez, "calismiyor" da DENMEZ
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const hs = require('../nginx-host-state.cjs');

test('HS1 siniflandirma: uc ayri gercek, uc ayri cevap', () => {
  // Kurulu degilse gerisi anlamsiz: calisma durumu ne derse desin.
  assert.equal(hs.classify({ status: 'noinst', runState: 'stopped' }), 'kurulumyok');
  assert.equal(hs.classify({ status: 'noinst', runState: 'running' }), 'kurulumyok');

  // `nginx -T` nginx AYAKTA OLMASA DA calisir: konfigurasyon gecerli olabilir ama
  // sunucu hizmet vermiyordur. Bunu "saglikli" saymak, duran bir nginx'i gizlerdi.
  assert.equal(hs.classify({ status: 'ok', runState: 'stopped' }), 'calismiyor');

  assert.equal(hs.classify({ status: 'fail', runState: 'running' }), 'configbozuk');
  assert.equal(hs.classify({ status: 'ok', runState: 'running' }), 'olculdu');
});

test('HS2 olculemeyen durum bir BULGU degildir', () => {
  // Tarama kaydi yok.
  assert.equal(hs.classify(null), 'bilinmiyor');
  // Eski tarama calisma durumunu hic basmiyor: "calismiyor" DEMEYIZ.
  assert.equal(hs.classify({ status: 'ok', runState: '?' }), 'bilinmiyor');
  assert.equal(hs.classify({ status: 'ok' }), 'bilinmiyor');
  // 'unknown' da ayni: olcemedik.
  assert.equal(hs.classify({ status: 'ok', runState: 'unknown' }), 'bilinmiyor');

  // Sayisal olcume GUVENILIR mi: kurulu olmayan/olculmeyen sunucuda limit sayilmaz.
  assert.equal(hs.olculebilir('kurulumyok'), false);
  assert.equal(hs.olculebilir('bilinmiyor'), false);
  assert.equal(hs.olculebilir('configbozuk'), false);
  // Duran nginx'te konfigurasyon OKUNABILIR: degerleri gosteririz, ama ekran uyarir.
  assert.equal(hs.olculebilir('calismiyor'), true);
  assert.equal(hs.olculebilir('olculdu'), true);

  // Her durumun kullaniciya SEBEBI soyleyen bir metni olmali.
  for (const d of ['kurulumyok', 'calismiyor', 'configbozuk', 'olculdu', 'bilinmiyor']) {
    const x = hs.describe(d);
    assert.ok(x.label && x.hint, `${d} icin aciklama yok`);
  }
  assert.match(hs.describe('kurulumyok').label, /kurulu değil/);
});

test('HS3 eski sema: run_state kolonu yoksa is DUSMEZ', async () => {
  const sql = { NVarChar: () => 'nvarchar' };
  let denenen = 0;
  const query = async (text) => {
    denenen += 1;
    // Ilk deneme yeni kolonlarla; eski semada SQL hatasi verir.
    if (text.includes('run_state')) throw new Error("Invalid column name 'run_state'.");
    return { recordset: [{ host: 'gbngxp40', status: 'ok', status_msg: null }] };
  };
  const m = await hs.loadHostStates({ query, sql, scanDate: '2026-09-26' });
  assert.equal(denenen, 2, 'eski semaya geri donulmemis');
  const h = m.get('GBNGXP40');
  assert.ok(h, 'host adi buyuk harfe normalize edilmeli');
  // Kolon yokken "calisiyor" da "calismiyor" da DEMEYIZ.
  assert.equal(h.durum, 'bilinmiyor');
  assert.equal(h.runState, '?');

  // Iki sorgu da duserse: bos harita, is patlamaz.
  const bos = await hs.loadHostStates({ query: async () => { throw new Error('yok'); }, sql });
  assert.equal(bos.size, 0);
});
