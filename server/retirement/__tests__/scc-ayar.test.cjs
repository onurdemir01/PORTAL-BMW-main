// server/retirement/__tests__/scc-ayar.test.cjs — SA1..SA6 (2026-10-08).
//
// Kullanici: SCC bilgilendirme adresini (eskiden YALNIZ RETIREMENT_SCC_MAIL_TO ortam
// degiskeni) "application retirement sayfasinda girmek istiyorum". Oncelik: ekran > ortam
// degiskeni > yok; kaynak her zaman soylenir. Ayrinti: ../ayar.cjs.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function yukle(baslangic = null, { okumaHatasi = false } = {}) {
  const dbPath = require.resolve('../../db/index.cjs');
  const ayarPath = require.resolve('../ayar.cjs');
  const saved = require.cache[dbPath];
  let blob = baslangic;
  const sorgular = [];
  require.cache[dbPath] = new Module(dbPath, null);
  require.cache[dbPath].exports = {
    query: async (sql, p) => {
      sorgular.push(sql);
      if (/^SELECT/.test(sql)) { if (okumaHatasi) throw new Error('db yok'); return { rows: blob ? [{ data: blob, updated_at: null }] : [] }; }
      if (/^UPDATE/.test(sql)) { if (!blob) return { rowCount: 0 }; blob = p[0]; return { rowCount: 1 }; }
      if (/^INSERT/.test(sql)) { blob = p[1]; return { rowCount: 1 }; }
      if (/^DELETE/.test(sql)) { blob = null; return { rowCount: 1 }; }
      return { rows: [] };
    },
  };
  require.cache[dbPath].loaded = true;
  delete require.cache[ayarPath];
  const m = require('../ayar.cjs');
  return { m, sorgular, restore: () => { if (saved) require.cache[dbPath] = saved; else delete require.cache[dbPath]; delete require.cache[ayarPath]; } };
}
function envIle(to, cc, fn) {
  const e = [process.env.RETIREMENT_SCC_MAIL_TO, process.env.RETIREMENT_SCC_MAIL_CC];
  if (to == null) delete process.env.RETIREMENT_SCC_MAIL_TO; else process.env.RETIREMENT_SCC_MAIL_TO = to;
  if (cc == null) delete process.env.RETIREMENT_SCC_MAIL_CC; else process.env.RETIREMENT_SCC_MAIL_CC = cc;
  return Promise.resolve(fn()).finally(() => {
    if (e[0] === undefined) delete process.env.RETIREMENT_SCC_MAIL_TO; else process.env.RETIREMENT_SCC_MAIL_TO = e[0];
    if (e[1] === undefined) delete process.env.RETIREMENT_SCC_MAIL_CC; else process.env.RETIREMENT_SCC_MAIL_CC = e[1];
  });
}

test('SA1 adres ayristirma: ; , bosluk ayiraclari, tekil, kucuk harf; bozuk adres REDDEDILIR', () => {
  const { adresleriAyristir } = require('../ayar.cjs');
  assert.deepEqual(adresleriAyristir(' A@x.com; b@x.com,  a@x.com ').liste, ['a@x.com', 'b@x.com']);
  assert.equal(adresleriAyristir('Ad Soyad <a@x.com>').ok, false, 'isim + adres yapistirmasi gecti');
  assert.equal(adresleriAyristir('a@x').ok, false, 'alan adinda nokta yok ama gecti');
  assert.equal(adresleriAyristir('').ok, true);
  assert.equal(adresleriAyristir(Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(',')).ok, false, 'adres sinirsiz');
});

test('SA2 ONCELIK: ekran > ortam degiskeni > yok; kaynak soylenir', async () => {
  await envIle('env@x.com', null, async () => {
    const { m, restore } = yukle(JSON.stringify({ to: ['ekran@x.com'], cc: ['c@x.com'], updatedBy: 'onur' }));
    try {
      const a = await m.sccAyar();
      assert.deepEqual([a.to, a.cc, a.kaynak, a.guncelleyen], ['ekran@x.com', 'c@x.com', 'ekran', 'onur']);
    } finally { restore(); }
    const b = yukle(null);
    try { const a = await b.m.sccAyar(); assert.deepEqual([a.to, a.kaynak], ['env@x.com', 'env']); } finally { b.restore(); }
  });
  await envIle(null, null, async () => {
    const { m, restore } = yukle(null);
    try { const a = await m.sccAyar(); assert.deepEqual([a.to, a.kaynak], ['', 'yok']); } finally { restore(); }
  });
});

test('SA3 kaydet -> bir sonraki okumada GECERLI (yeniden baslatma yok); "Kime" bos -> ortam degiskenine duser', async () => {
  await envIle('env@x.com', null, async () => {
    const { m, restore } = yukle(null);
    try {
      let r = await m.sccKaydet({ to: 'scc@x.com, scc2@x.com', cc: '' }, 'onur');
      assert.equal(r.ok, true);
      assert.deepEqual([(await m.sccAyar()).to, (await m.sccAyar()).kaynak], ['scc@x.com,scc2@x.com', 'ekran']);
      r = await m.sccKaydet({ to: '', cc: '' }, 'onur');
      assert.deepEqual([r.ayar.to, r.ayar.kaynak], ['env@x.com', 'env'], 'bos kayit ekran degerini kaldirmadi');
    } finally { restore(); }
  });
});

test('SA4 bozuk girdi KAYDEDILMEZ; CC tek basina kaydedilmez', async () => {
  const { m, sorgular, restore } = yukle(null);
  try {
    assert.equal((await m.sccKaydet({ to: 'bozuk', cc: '' })).ok, false);
    assert.equal((await m.sccKaydet({ to: '', cc: 'c@x.com' })).ok, false);
    assert.ok(!sorgular.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q)), 'gecersiz girdi DB\'ye yazildi');
  } finally { restore(); }
});

test('SA5 DB OKUNAMAZSA ortam degiskenine duser ve bunu SOYLER', async () => {
  await envIle('env@x.com', null, async () => {
    const { m, restore } = yukle(null, { okumaHatasi: true });
    try {
      const a = await m.sccAyar();
      assert.equal(a.to, 'env@x.com');
      assert.match(String(a.dbHatasi), /db yok/, 'okuma hatasi gizlendi');
    } finally { restore(); }
  });
});

test('SA6 index.cjs adresi MODUL YUKLENIRKEN dondurmaz; her kullanim taze okur', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.ok(!/^const SCC_MAIL_TO = \(process\.env/m.test(idx), 'adres acilista donduruluyor - ekrandan girilen deger kullanilmaz');
  assert.ok((idx.match(/await sccAyar\(\)/g) || []).length >= 4, 'STOP / zamanlanmis STOP / sonuclandirma / config taze okumuyor');
  assert.match(idx, /router\.put\('\/config\/scc'/, 'kaydetme ucu yok');
});
