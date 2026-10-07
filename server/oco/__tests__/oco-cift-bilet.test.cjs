// server/oco/__tests__/oco-cift-bilet.test.cjs — CB1..CB7 (2026-10-08 uretim olayi).
//
// Kullanici: "Nginx RP production delete... OCO kontrolu gecti, Smart kaydi acildi, onayladim,
// scheduled job tetiklendi. 23:00'te bu job calisti. Ama portala girdim, IKINCI bir Smart
// kaydi acilmis. Neden?"
//
// ZINCIR: smart-first yolu (change-gates.cjs, pencere ileride + Smart gerekli) kaydi
// 'SCHEDULED' olusturup bileti hemen aciyor, sonra `markPendingApproval` ile kaydi
// 'PENDING_APPROVAL'a cekmeye calisiyordu. O fonksiyon YALNIZ 'LAUNCHING' gunceller ->
// HICBIR SEY yazilmadi (donus degerine bakilmiyordu). Kayit 'SCHEDULED' kaldi. Onayda AWX
// schedule kuruldu (kaydi AWX_SCHEDULED yapma da 'PENDING_APPROVAL' kosuluna takildi).
// 23:00'te AWX isi calistirdi VE Portal'in OCO zamanlayicisi 'SCHEDULED' kaydi alip prod
// kapisindan gecirdi -> IKINCI bilet. Onaylansaydi is IKINCI KEZ kosacakti.
//
// Eski bekci (smart-first-scheduling OS7) HATALI cagrinin METNINI kilitliyordu. Bu dosya
// DAVRANISI kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function yukle({ records, biletler = new Map(), biletHatasi = null }) {
  const storePath = require.resolve('../store.cjs');
  const smartPath = require.resolve('../../smart/store.cjs');
  const pollerPath = require.resolve('../poller.cjs');
  const saved = [storePath, smartPath, pollerPath].map((p) => [p, require.cache[p]]);
  const calls = [];
  const sahte = (p, exports) => { require.cache[p] = new Module(p, null); require.cache[p].exports = exports; require.cache[p].loaded = true; };
  sahte(storePath, {
    listScheduled: async () => records,
    claimForLaunch: async (id) => { calls.push(['claim', id]); return records.find((r) => r.id === id); },
    markLaunched: async (id, j) => { calls.push(['markLaunched', id, j]); return true; },
    markPendingApproval: async (id, i) => { calls.push(['markPendingApproval', id, i]); return true; },
    markFailed: async (id) => { calls.push(['markFailed', id]); return true; },
    markExpired: async (id) => { calls.push(['markExpired', id]); return true; },
    adoptTicket: async (id, t) => { calls.push(['adopt', id, t.status]); return 'X'; },
  });
  sahte(smartPath, {
    findByOcoRecordIds: async (ids) => { calls.push(['bilet-sorgu', ids]); if (biletHatasi) throw biletHatasi; return biletler; },
  });
  delete require.cache[pollerPath];
  const poller = require('../poller.cjs');
  const launches = [];
  poller.startPoller(async (rec) => { launches.push(rec.id); return { pendingApproval: true, ticketId: 99, externalTicketId: 'IKINCI' }; });
  const restore = () => {
    poller.stopPoller?.();
    for (const [p, v] of saved) { if (v) require.cache[p] = v; else delete require.cache[p]; }
  };
  return { poller, calls, launches, restore };
}
const kayit = (id, { due = true } = {}) => ({
  id, ocoNumber: 'OCO-1', awxServerId: 1, awxTemplateId: 2, pendingLaunch: {},
  runAt: new Date(Date.now() + (due ? -60000 : 3600000)).toISOString(),
  windowEnd: new Date(Date.now() + 7200000).toISOString(),
});

test('CB1 OLAYIN KENDISI: saati gelen SCHEDULED kaydin onaylanmis bileti varsa IKINCI bilet ACILMAZ', async () => {
  const { poller, calls, launches, restore } = yukle({
    records: [kayit(7)],
    biletler: new Map([[7, { id: 5, externalTicketId: '23337000', status: 'SCHEDULED', awxScheduleId: 44 }]]),
  });
  try {
    await poller.tick();
    assert.deepEqual(launches, [], 'kayit kapidan YENIDEN gecirildi - ikinci Smart bileti acilir');
    assert.ok(!calls.some((c) => c[0] === 'claim'), 'bagli bileti olan kayit claim edildi');
    assert.deepEqual(calls.find((c) => c[0] === 'adopt'), ['adopt', 7, 'SCHEDULED'], 'kayit bilete esitlenmedi');
  } finally { restore(); }
});

test('CB2 saati GELMEMIS kayit da bilete esitlenir (ekran bugunden duzelsin)', async () => {
  const { poller, calls, launches, restore } = yukle({
    records: [kayit(8, { due: false })],
    biletler: new Map([[8, { id: 6, externalTicketId: 'B', status: 'PENDING' }]]),
  });
  try {
    await poller.tick();
    assert.deepEqual(launches, []);
    assert.deepEqual(calls.find((c) => c[0] === 'adopt'), ['adopt', 8, 'PENDING']);
  } finally { restore(); }
});

test('CB3 bileti OLMAYAN kayit eskisi gibi baslatilir (eski yedek yol: bilet pencere saatinde)', async () => {
  const { poller, calls, launches, restore } = yukle({ records: [kayit(9), kayit(10)], biletler: new Map([[10, { id: 1, status: 'LAUNCHED' }]]) });
  try {
    await poller.tick();
    assert.deepEqual(launches, [9], 'biletsiz kayit baslatilmadi ya da biletli kayit baslatildi');
    assert.ok(calls.some((c) => c[0] === 'claim' && c[1] === 9));
  } finally { restore(); }
});

test('CB4 bilet sorgusu DUSERSE bu tur HICBIR SEY baslatilmaz (bakamadigimiz kayit cift bilet dogurur)', async () => {
  const { poller, calls, launches, restore } = yukle({ records: [kayit(11)], biletHatasi: new Error('db yok') });
  try {
    await poller.tick();
    assert.deepEqual(launches, []);
    assert.ok(!calls.some((c) => c[0] === 'claim'), 'bilet bilinmeden claim edildi');
  } finally { restore(); }
});

test('CB5 smart-first yolu dogru gecisi kullanir ve sonucu DENETLER', () => {
  const gates = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'change-gates.cjs'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '..', 'store.cjs'), 'utf8');
  assert.match(gates, /const yazildi = await ocoStore\.markPendingApprovalAtRequest\(rec\.id/, 'sonuc denetlenmiyor');
  assert.match(gates, /if \(!yazildi\) console\.warn/, 'yazilamazsa sessiz kaliyor');
  const fn = store.slice(store.indexOf('async function markPendingApprovalAtRequest'), store.indexOf('const BILET_KAYIT'));
  assert.match(fn, /WHERE id = \$1 AND status = 'SCHEDULED'/, "yeni kayit 'SCHEDULED' - baska kosul hicbir sey yazmaz");
});

test('CB6 bilet -> kayit eslemesi: onaylanmis bilet kaydi tekrar BASLATILABILIR birakmaz', () => {
  const { BILET_KAYIT } = require('../store.cjs');
  for (const s of ['PENDING', 'LAUNCHING', 'SCHEDULED', 'LAUNCHED', 'REJECTED', 'CANCELLED', 'TIMEOUT', 'FAILED', 'ERROR'])
    assert.notEqual(BILET_KAYIT[s] ?? 'SCHEDULED', 'SCHEDULED', `${s} bileti kaydi SCHEDULED birakiyor - poller yine baslatir`);
  assert.equal(BILET_KAYIT.SCHEDULED, 'AWX_SCHEDULED');
  assert.equal(BILET_KAYIT.LAUNCHED, 'LAUNCHED');
  const store = fs.readFileSync(path.join(__dirname, '..', 'store.cjs'), 'utf8');
  const fn = store.slice(store.indexOf('async function adoptTicket'));
  assert.match(fn.slice(0, 900), /WHERE id = \$1 AND status = 'SCHEDULED'/, 'esitleme iptal edilmis kaydi ezebilir');
});

test('CB7 bilet aramasi kayit numarasini KESIN esler (12 ile 123 karismaz), en yeni bilet secilir', async () => {
  const dbPath = require.resolve('../../db/index.cjs');
  const smartPath = require.resolve('../../smart/store.cjs');
  const savedDb = require.cache[dbPath];
  const savedSmart = require.cache[smartPath];
  require.cache[dbPath] = new Module(dbPath, null);
  const satir = (id, oco) => ({ id, external_ticket_id: `E${id}`, status: 'PENDING', pending_launch_json: JSON.stringify({ ocoRecordId: oco }) });
  require.cache[dbPath].exports = { query: async () => ({ rows: [satir(9, 123), satir(8, 12), satir(3, 12), { id: 2, pending_launch_json: '{bozuk' }] }) };
  require.cache[dbPath].loaded = true;
  delete require.cache[smartPath];
  try {
    const { findByOcoRecordIds } = require('../../smart/store.cjs');
    const m = await findByOcoRecordIds([12]);
    assert.deepEqual([...m.keys()], [12]);
    assert.equal(m.get(12).id, 8, 'en yeni bilet secilmedi ya da 123 eslesti');
    assert.equal((await findByOcoRecordIds([])).size, 0);
  } finally {
    if (savedDb) require.cache[dbPath] = savedDb; else delete require.cache[dbPath];
    if (savedSmart) require.cache[smartPath] = savedSmart; else delete require.cache[smartPath];
  }
});
