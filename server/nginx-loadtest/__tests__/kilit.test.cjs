// server/nginx-loadtest/__tests__/kilit.test.cjs - Yuk Testi CAS kilidi (2026-10-27).
//
//   YK1 anahtarlar: kosu G + T + L, on kontrol T + L; sira HER ZAMAN G, T, L; host buyuk harf
//   YK2 tumu ya da hicbiri: biri doluysa alinanlar geri birakilir
//   YK3 dolu kilit ikinci isi reddeder; baska lock_id birakamaz; sahibi birakinca alinir
//   YK4 bayat kilit: bagli is TERMINAL ise devralinir (bitis zamani yazilir); okunamazsa DOLU kalir
//   YK5 TTL dolan kilit devralinir; TTL siniri (65..720, varsayilan 75)
//   YK6 ise baglama + is bitince TUM kilitler birakilir; supurme listesi tekil
//   YK7 satir SILINMEZ (kodda DELETE yok); sorgular parametreli
//   YK9 bagliIsKarari: bag turu x AWX durumu tablosu (tur 2: iptal/hata uzaktaki yuku DURDURMAZ)
//   YK10 acquireLocks bayat-kilit yolu kurala uyar: 'tut' -> dolu kalir ve isten cozulur
//   YK11 casLock: suresi dolmus kilidi YALNIZ ise bagli degilse devralir (12 saat tavani haric)
//   YK12 isinKilitleriniCoz: yalniz o isin dolu kilitleri; uzatma kisaltmaz
//   YK13 durdurIsineBagla: kosunun kilit_id'li dolu kilitleri durdur isine baglanir, sure uzar
//   YK14 tur 3 anahtarlari: serbest on kontrol de G alir, T|IP:<ip>; gecersiz IP / tur hata (sessiz
//        T|NULL yok); doluKilitMesaji T|IP dali (G metni degismez)
//   YK15 kilit alma ortasinda istisna: acquireLocks firlatir (alinani birakmaz, cagiran birakir);
//        releaseLocks yalniz bu lock_id'li dolu satirlari birakir (yabanci kilit kalir)
//
// Sahte db kilit tablosunun ANLAMINI uygular: CAS kosulu SQL metninden okunur, yani WHERE'deki
// bir kosulu silen degisiklik buradaki davranisi da degistirir (mutasyonla olculdu).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const kl = require('../kilit.cjs');

const SAAT = 3600000;

function kilitDb() {
  const satirlar = new Map();
  let sira = 0;
  const durum = { simdi: Date.parse('2026-10-27T10:00:00Z'), sorgular: [], satirlar };
  const dolmus = (r) => r.locked_until != null && r.locked_until < durum.simdi;
  // CAS kosulu SQL METNINDEN: hangi yan cumle varsa o anlam uygulanir.
  const bosMu = (r, q) => !r.held
    || (q.includes('locked_until IS NULL OR') && r.locked_until == null)
    || (q.includes('(locked_until < GETUTCDATE() AND awx_job_id IS NULL)')
      ? dolmus(r) && r.awx_job_id == null
      : q.includes('locked_until < GETUTCDATE()') && dolmus(r))
    || (q.includes('locked_until < DATEADD(HOUR, -12, GETUTCDATE())') && r.locked_until != null && r.locked_until < durum.simdi - 12 * SAAT);
  const sonIs = (r, fin) => {
    if (fin && (!r.last_op_finished_at || r.last_op_finished_at < fin)) r.last_op_finished_at = fin;
  };
  // `locked_until = CASE ... DATEADD(SECOND, $n, ...)`: en az simdi + n sn (kisaltmaz).
  const uzat = (r, q, params) => {
    const m = /locked_until = CASE WHEN locked_until IS NULL OR locked_until < DATEADD\(SECOND, \$(\d), GETUTCDATE\(\)\) THEN DATEADD\(SECOND, \$\1, GETUTCDATE\(\)\) ELSE locked_until END/.exec(q);
    if (!m) return;
    const hedef = durum.simdi + Number(params[Number(m[1]) - 1]) * 1000;
    if (r.locked_until == null || r.locked_until < hedef) r.locked_until = hedef;
  };
  durum.query = async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    durum.sorgular.push({ q, params });
    if (/^IF NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kilitleri WHERE lock_key = \$1\) INSERT INTO nginx_loadtest_kilitleri/.test(q)) {
      if (!satirlar.has(params[0])) satirlar.set(params[0], { id: ++sira, lock_key: params[0], held: 0, locked_until: null });
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE nginx_loadtest_kilitleri SET held = 1/.test(q)) {
      const r = satirlar.get(params[0]);
      if (!r || !bosMu(r, q)) return { rows: [], rowCount: 0 };
      Object.assign(r, { held: 1, holder: params[1], lock_id: params[2], target_desc: params[3], locked_until: durum.simdi + params[4] * 60000, awx_server_id: null, awx_job_id: null, ttl: params[4] });
      if (q.includes('bag_turu = NULL')) r.bag_turu = null;
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT TOP 1 lock_key, held, holder, lock_id/.test(q)) {
      const r = satirlar.get(params[0]);
      return { rows: r ? [{ ...r }] : [] };
    }
    if (/^UPDATE nginx_loadtest_kilitleri SET held = 0,.* WHERE lock_key = \$1 AND lock_id = \$2 AND held = 1$/.test(q)) {
      const r = satirlar.get(params[0]);
      if (!r || r.lock_id !== params[1] || !r.held) return { rows: [], rowCount: 0 };
      r.held = 0;
      sonIs(r, params[2]);
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = \$3, awx_job_id = \$4, bag_turu = \$5, updated_at = GETUTCDATE\(\) WHERE lock_key = \$1 AND lock_id = \$2 AND held = 1$/.test(q)) {
      const r = satirlar.get(params[0]);
      if (!r || r.lock_id !== params[1] || !r.held) return { rows: [], rowCount: 0 };
      Object.assign(r, { awx_server_id: params[2], awx_job_id: params[3], bag_turu: params[4] });
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE nginx_loadtest_kilitleri SET held = 0,.* WHERE awx_server_id = \$1 AND awx_job_id = \$2 AND held = 1$/.test(q)) {
      let n = 0;
      for (const r of satirlar.values()) {
        if (r.held && r.awx_server_id === params[0] && r.awx_job_id === params[1]) {
          r.held = 0;
          sonIs(r, params[2]);
          n += 1;
        }
      }
      return { rows: [], rowCount: n };
    }
    // isinKilitleriniCoz: isten COZ (birakma); istege bagli sure uzatma.
    if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = NULL, awx_job_id = NULL, bag_turu = NULL, updated_at = GETUTCDATE\(\)(, locked_until = CASE .* END)? WHERE awx_server_id = \$1 AND awx_job_id = \$2 AND held = 1$/.test(q)) {
      let n = 0;
      for (const r of satirlar.values()) {
        if (r.held && r.awx_server_id === params[0] && r.awx_job_id === params[1]) {
          uzat(r, q, params);
          Object.assign(r, { awx_server_id: null, awx_job_id: null, bag_turu: null });
          n += 1;
        }
      }
      return { rows: [], rowCount: n };
    }
    // durdurIsineBagla: kilit_id ile, yalniz DOLU kilitler.
    if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = \$2, awx_job_id = \$3, bag_turu = 'durdur', locked_until = CASE .* END, updated_at = GETUTCDATE\(\) WHERE lock_id = \$1 AND held = 1$/.test(q)) {
      let n = 0;
      for (const r of satirlar.values()) {
        if (r.held && r.lock_id === params[0]) {
          uzat(r, q, params);
          Object.assign(r, { awx_server_id: params[1], awx_job_id: params[2], bag_turu: 'durdur' });
          n += 1;
        }
      }
      return { rows: [], rowCount: n };
    }
    if (/^SELECT TOP 50 awx_server_id, awx_job_id, bag_turu FROM nginx_loadtest_kilitleri/.test(q)) {
      return { rows: [...satirlar.values()].filter((r) => r.held && r.awx_server_id != null && r.awx_job_id != null).map((r) => ({ awx_server_id: r.awx_server_id, awx_job_id: r.awx_job_id, bag_turu: r.bag_turu ?? null })) };
    }
    throw new Error(`beklenmeyen sorgu: ${q}`);
  };
  return durum;
}

const AL = (db, keys, lockId, ek = {}) => kl.acquireLocks(db, keys, { lockId, holder: 'onur', desc: 'test', ttlMin: 75, ...ek });

test('YK1 anahtarlar ve sira', () => {
  assert.deepEqual(kl.kilitAnahtarlari({ hedef: 'gbngxt33', yuk: ' GBNGXT34 ', kosu: true }), ['G|global', 'T|GBNGXT33', 'L|GBNGXT34']);
  assert.deepEqual(kl.kilitAnahtarlari({ hedef: 'GBNGXT33', yuk: 'GBNGXT34' }), ['T|GBNGXT33', 'L|GBNGXT34']);
});

test('YK2 tumu ya da hicbiri: dolu anahtar alinan anahtarlari geri birakir', async () => {
  const db = kilitDb();
  assert.equal((await AL(db, ['L|GBNGXT34'], 'baska')).ok, true);
  const r = await AL(db, kl.kilitAnahtarlari({ hedef: 'GBNGXT33', yuk: 'GBNGXT34', kosu: true }), 'ben');
  assert.equal(r.ok, false);
  assert.equal(r.busyKey, 'L|GBNGXT34');
  assert.equal(r.busy.lock_id, 'baska');
  assert.equal(db.satirlar.get('G|global').held, 0, 'G kilidi geri birakilmadi');
  assert.equal(db.satirlar.get('T|GBNGXT33').held, 0, 'T kilidi geri birakilmadi');
  assert.equal(db.satirlar.get('L|GBNGXT34').lock_id, 'baska');
});

test('YK3 dolu kilit ikinci isi reddeder; yabanci lock_id birakamaz', async () => {
  const db = kilitDb();
  const keys = kl.kilitAnahtarlari({ hedef: 'GBNGXT33', yuk: 'GBNGXT34' });
  assert.equal((await AL(db, keys, 'a')).ok, true);
  assert.equal((await AL(db, keys, 'b')).ok, false);
  await kl.releaseLocks(db, keys, 'b');
  assert.equal(db.satirlar.get('T|GBNGXT33').held, 1, 'baska kilit kimligi kilidi birakti');
  await kl.releaseLocks(db, keys, 'a');
  assert.equal((await AL(db, keys, 'b')).ok, true);
  assert.match(kl.doluKilitMesaji('G|global', { holder: 'ali', target_desc: 'yük testi X', awx_job_id: 9 }), /Başka bir yük testi koşuyor \(ali: yük testi X, AWX iş #9\)/);
  assert.match(kl.doluKilitMesaji('T|GBNGXT33', null), /GBNGXT33 üzerinde başka bir iş var/);
});

test('YK4 bayat kilit: bagli is terminalse devralinir; okunamazsa ya da surerse dolu kalir', async () => {
  const db = kilitDb();
  const keys = ['T|GBNGXT33'];
  assert.equal((await AL(db, keys, 'eski')).ok, true);
  await kl.bindLocks(db, keys, 'eski', { awxServerId: 1, awxJobId: 50 });
  const sorulan = [];
  const surer = await AL(db, keys, 'yeni', { isJobTerminal: async (sid, jid) => (sorulan.push([sid, jid]), { terminal: false }) });
  assert.equal(surer.ok, false);
  assert.deepEqual(sorulan, [[1, 50]]);
  const okunamaz = await AL(db, keys, 'yeni', { isJobTerminal: async () => { throw new Error('AWX yok'); } });
  assert.equal(okunamaz.ok, false, 'AWX okunamazken kilit devralindi (fail-open)');
  const bitti = await AL(db, keys, 'yeni', { isJobTerminal: async () => ({ terminal: true, finished: '2026-10-27T09:59:00Z', status: 'successful' }) });
  assert.equal(bitti.ok, true);
  assert.equal(db.satirlar.get('T|GBNGXT33').lock_id, 'yeni');
  assert.equal(db.satirlar.get('T|GBNGXT33').last_op_finished_at, '2026-10-27T09:59:00.000Z');
  // Ise baglanmamis dolu kilit is sorgusuyla devralinamaz.
  const db2 = kilitDb();
  await AL(db2, keys, 'eski');
  let soruldu = false;
  assert.equal((await AL(db2, keys, 'yeni', { isJobTerminal: async () => { soruldu = true; return { terminal: true, status: 'successful' }; } })).ok, false);
  assert.equal(soruldu, false);
});

test('YK5 TTL dolan kilit devralinir; TTL sinirlari', async () => {
  const db = kilitDb();
  const keys = ['G|global'];
  assert.equal((await AL(db, keys, 'a', { ttlMin: 75 })).ok, true);
  assert.equal(db.satirlar.get('G|global').ttl, 75);
  db.simdi += 74 * 60000;
  assert.equal((await AL(db, keys, 'b')).ok, false);
  db.simdi += 2 * 60000;
  assert.equal((await AL(db, keys, 'b')).ok, true, 'suresi dolan (ise bagli olmayan) kilit devralinmadi');
  assert.equal(kl.kilitSuresiDk({}), 75);
  assert.equal(kl.kilitSuresiDk({ NGINX_LOADTEST_LOCK_TTL_MIN: '30' }), 65);
  assert.equal(kl.kilitSuresiDk({ NGINX_LOADTEST_LOCK_TTL_MIN: '5000' }), 720);
  assert.equal(kl.kilitSuresiDk({ NGINX_LOADTEST_LOCK_TTL_MIN: 'abc' }), 75);
  // Gecersiz ttlMin verilirse kod varsayilani (template timeout'tan kisa TTL kabul edilmez).
  const db2 = kilitDb();
  await kl.acquireLocks(db2, keys, { lockId: 'x', holder: 'h', desc: 'd', ttlMin: 10 });
  assert.equal(db2.satirlar.get('G|global').ttl, 75);
});

test('YK6 ise baglama (bag turu ile), is bitince birakma, supurme listesi', async () => {
  const db = kilitDb();
  const keys = kl.kilitAnahtarlari({ hedef: 'GBNGXT33', yuk: 'GBNGXT34', kosu: true });
  assert.equal((await AL(db, keys, 'k1')).ok, true);
  await kl.bindLocks(db, keys, 'k1', { awxServerId: 2, awxJobId: 77, bagTuru: 'kosu' });
  for (const k of keys) assert.equal(db.satirlar.get(k).bag_turu, 'kosu', `${k}: bag turu yazilmadi`);
  // Yabanci kimlik baglayamaz.
  await kl.bindLocks(db, ['G|global'], 'yabanci', { awxServerId: 9, awxJobId: 9, bagTuru: 'on_kontrol' });
  assert.equal(db.satirlar.get('G|global').awx_job_id, 77);
  assert.equal(db.satirlar.get('G|global').bag_turu, 'kosu');
  assert.deepEqual(await kl.bekleyenKilitIsleri(db), [{ serverId: 2, jobId: 77, bagTuru: 'kosu' }], 'is tekil listelenmedi');
  // Ayni ise farkli bag turu (beklenmez) gelirse EN SIKI olani alinir.
  db.satirlar.get('L|GBNGXT34').bag_turu = 'durdur';
  assert.equal((await kl.bekleyenKilitIsleri(db))[0].bagTuru, 'durdur', 'supurme gevsek bag turunu secti');
  db.satirlar.get('L|GBNGXT34').bag_turu = 'kosu';
  assert.equal(await kl.releaseLocksForJob(db, 2, 76), 0);
  assert.equal(await kl.releaseLocksForJob(db, 2, 77, '2026-10-27T10:40:00Z'), 3);
  for (const k of keys) {
    assert.equal(db.satirlar.get(k).held, 0, k);
    assert.equal(db.satirlar.get(k).last_op_finished_at, '2026-10-27T10:40:00.000Z');
  }
  assert.deepEqual(await kl.bekleyenKilitIsleri(db), []);
  // Varsayilan bag turu NULL (on kontrol sutunu).
  await AL(db, ['T|GBNGXT40'], 'k2');
  await kl.bindLocks(db, ['T|GBNGXT40'], 'k2', { awxServerId: 2, awxJobId: 80 });
  assert.deepEqual(await kl.bekleyenKilitIsleri(db), [{ serverId: 2, jobId: 80, bagTuru: null }]);
});

test('YK7 satir silinmez; deger SQL metnine gomulmez', async () => {
  const kod = fs.readFileSync(path.join(__dirname, '..', 'kilit.cjs'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(kod, /\bDELETE\b/i, 'kilit satiri siliniyor (TBMWANS: DELETE yok)');
  const db = kilitDb();
  const keys = kl.kilitAnahtarlari({ hedef: 'GBNGXT33', yuk: 'GBNGXT34', kosu: true });
  await AL(db, keys, 'k1');
  await kl.bindLocks(db, keys, 'k1', { awxServerId: 2, awxJobId: 4321, bagTuru: 'kosu' });
  await kl.durdurIsineBagla(db, 'k1', { awxServerId: 2, awxJobId: 4322, uzatSn: 3333 });
  await kl.isinKilitleriniCoz(db, 2, 4322, 3333);
  for (const s of db.sorgular) assert.doesNotMatch(s.q, /GBNGXT3|k1|onur|432[12]|3333/, `deger SQL metninde: ${s.q}`);
});

test('YK9 bagliIsKarari: bag turu x AWX durumu', () => {
  const beklenen = {
    successful: { on_kontrol: 'birak', null: 'birak', kosu: 'birak', durdur: 'birak' },
    failed: { on_kontrol: 'birak', null: 'birak', kosu: 'birak', durdur: 'tut' },
    canceled: { on_kontrol: 'birak', null: 'birak', kosu: 'tut', durdur: 'tut' },
    error: { on_kontrol: 'birak', null: 'birak', kosu: 'tut', durdur: 'tut' },
  };
  for (const [durum, sutun] of Object.entries(beklenen)) {
    for (const [tur, karar] of Object.entries(sutun)) {
      assert.equal(kl.bagliIsKarari(tur === 'null' ? null : tur, durum), karar, `${tur} + ${durum}`);
    }
  }
  // Bos metin NULL gibi; bilinmeyen bag turu EN SIKI sutun (durdur).
  assert.equal(kl.bagliIsKarari('', 'canceled'), 'birak');
  assert.equal(kl.bagliIsKarari('bilinmeyen', 'failed'), 'tut');
  // Terminal olmayan / bilinmeyen durum asla 'birak' degil.
  for (const s of ['running', 'pending', 'waiting', null, undefined, '']) assert.equal(kl.bagliIsKarari('on_kontrol', s), 'tut', String(s));
});

test('YK10 bayat-kilit yolu kurala uyar: kosu iptali dolu kalir ve isten cozulur', async () => {
  const durum = (status) => async () => ({ terminal: true, finished: '2026-10-27T09:59:00Z', status });
  const kur = async (bagTuru) => {
    const db = kilitDb();
    const keys = kl.kilitAnahtarlari({ hedef: 'GBNGXT33', yuk: 'GBNGXT34', kosu: true });
    await AL(db, keys, 'eski');
    await kl.bindLocks(db, keys, 'eski', { awxServerId: 3, awxJobId: 900, bagTuru });
    return { db, keys };
  };
  // kosu + canceled: devralinmaz; TUM kilitler dolu kalir ama isten cozulur (TTL birakir).
  let { db, keys } = await kur('kosu');
  let r = await AL(db, ['T|GBNGXT33'], 'yeni', { isJobTerminal: durum('canceled') });
  assert.equal(r.ok, false, 'iptal edilen kosunun kilidi devralindi (uzak k6 surebilir)');
  assert.equal(r.busyKey, 'T|GBNGXT33');
  for (const k of keys) {
    const s = db.satirlar.get(k);
    assert.deepEqual([s.held, s.lock_id, s.awx_server_id, s.awx_job_id, s.bag_turu], [1, 'eski', null, null, null], `${k} cozulmedi`);
  }
  // Cozulen kilit artik AWX'e sorulmaz; TTL dolunca (ise bagli degil) devralinir.
  let soruldu = 0;
  r = await AL(db, ['T|GBNGXT33'], 'yeni', { isJobTerminal: async () => { soruldu += 1; return { terminal: true, status: 'successful' }; } });
  assert.deepEqual([r.ok, soruldu], [false, 0]);
  db.simdi += 76 * 60000;
  assert.equal((await AL(db, ['T|GBNGXT33'], 'yeni')).ok, true, 'TTL dolan cozulmus kilit devralinmadi');
  // kosu + error de tutulur; kosu + failed birakilir.
  ({ db } = await kur('kosu'));
  assert.equal((await AL(db, ['T|GBNGXT33'], 'yeni', { isJobTerminal: durum('error') })).ok, false);
  ({ db } = await kur('kosu'));
  assert.equal((await AL(db, ['T|GBNGXT33'], 'yeni', { isJobTerminal: durum('failed') })).ok, true);
  // durdur + failed tutulur (kalan surec olabilir); durdur + successful birakilir.
  ({ db } = await kur('durdur'));
  assert.equal((await AL(db, ['L|GBNGXT34'], 'yeni', { isJobTerminal: durum('failed') })).ok, false);
  assert.equal(db.satirlar.get('L|GBNGXT34').awx_job_id, null);
  ({ db } = await kur('durdur'));
  assert.equal((await AL(db, ['L|GBNGXT34'], 'yeni', { isJobTerminal: durum('successful') })).ok, true);
  // on_kontrol + canceled birakilir (on kontrol yuk uretmez).
  ({ db } = await kur('on_kontrol'));
  assert.equal((await AL(db, ['T|GBNGXT33'], 'yeni', { isJobTerminal: durum('canceled') })).ok, true);
  // Durumu soylemeyen eski bicim (true) fail-closed: kosu kilidi tutulur.
  ({ db } = await kur('kosu'));
  assert.equal((await AL(db, ['T|GBNGXT33'], 'yeni', { isJobTerminal: async () => true })).ok, false);
});

test('YK11 casLock: suresi dolmus kilit yalniz ise bagli degilse devralinir', async () => {
  const db = kilitDb();
  const keys = ['G|global'];
  await AL(db, keys, 'eski');
  await kl.bindLocks(db, keys, 'eski', { awxServerId: 3, awxJobId: 900, bagTuru: 'kosu' });
  db.simdi += 80 * 60000; // TTL doldu, is AWX'te HALA suruyor (uzun pending)
  const sorulan = [];
  const surer = async (sid, jid) => (sorulan.push([sid, jid]), { terminal: false, status: 'running' });
  let r = await AL(db, keys, 'yeni', { isJobTerminal: surer });
  assert.equal(r.ok, false, 'suresi dolan ama suren ise bagli kilit AWX\'e sorulmadan devralindi');
  assert.deepEqual(sorulan, [[3, 900]]);
  // AWX okunamiyor: 12 saat dolmadan devralinmaz; 12 saatten sonra devralinir (sonsuz kilit yok).
  const okunamaz = async () => { throw new Error('AWX kapali'); };
  assert.equal((await AL(db, keys, 'yeni', { isJobTerminal: okunamaz })).ok, false);
  db.simdi += 12 * SAAT;
  r = await AL(db, keys, 'yeni', { isJobTerminal: okunamaz });
  assert.equal(r.ok, true, '12 saat once dolmus kilit devralinmadi');
  assert.deepEqual([db.satirlar.get('G|global').lock_id, db.satirlar.get('G|global').awx_job_id, db.satirlar.get('G|global').bag_turu], ['yeni', null, null]);
});

test('YK12 isinKilitleriniCoz: yalniz o isin dolu kilitleri, uzatma kisaltmaz', async () => {
  const db = kilitDb();
  const keys = kl.kilitAnahtarlari({ hedef: 'GBNGXT33', yuk: 'GBNGXT34', kosu: true });
  await AL(db, keys, 'k1', { ttlMin: 75 });
  await kl.bindLocks(db, keys, 'k1', { awxServerId: 3, awxJobId: 900, bagTuru: 'kosu' });
  await AL(db, ['T|GBNGXT40'], 'k2');
  await kl.bindLocks(db, ['T|GBNGXT40'], 'k2', { awxServerId: 3, awxJobId: 901, bagTuru: 'kosu' });
  const ttlSonu = db.satirlar.get('G|global').locked_until;
  // Uzatmasiz: sure degismez.
  assert.equal(await kl.isinKilitleriniCoz(db, 3, 900), 3);
  for (const k of keys) {
    const s = db.satirlar.get(k);
    assert.deepEqual([s.held, s.awx_job_id, s.bag_turu, s.locked_until], [1, null, null, ttlSonu], k);
  }
  assert.equal(db.satirlar.get('T|GBNGXT40').awx_job_id, 901, 'baska isin kilidi cozuldu');
  // Uzatma: kalan TTL'den uzunsa ileri ceker, kisaysa DOKUNMAZ.
  assert.equal(await kl.isinKilitleriniCoz(db, 3, 901, 60), 1);
  assert.equal(db.satirlar.get('T|GBNGXT40').locked_until, db.simdi + 75 * 60000, 'uzatma kilidi kisaltti');
  await AL(db, ['T|GBNGXT41'], 'k3');
  await kl.bindLocks(db, ['T|GBNGXT41'], 'k3', { awxServerId: 3, awxJobId: 902, bagTuru: 'kosu' });
  await kl.isinKilitleriniCoz(db, 3, 902, 2700 + 180 + 3600);
  assert.equal(db.satirlar.get('T|GBNGXT41').locked_until, db.simdi + (2700 + 180 + 3600) * 1000, 'kilit butce + pay kadar uzatilmadi');
  // Birakilmis kilit cozulmez (held = 0).
  await AL(db, ['T|GBNGXT42'], 'k4');
  await kl.bindLocks(db, ['T|GBNGXT42'], 'k4', { awxServerId: 3, awxJobId: 903 });
  await kl.releaseLocks(db, ['T|GBNGXT42'], 'k4');
  assert.equal(await kl.isinKilitleriniCoz(db, 3, 903), 0);
});

test('YK13 durdurIsineBagla: kosunun dolu kilitleri durdur isine baglanir, sure uzar', async () => {
  const db = kilitDb();
  const keys = kl.kilitAnahtarlari({ hedef: 'GBNGXT33', yuk: 'GBNGXT34', kosu: true });
  await AL(db, keys, 'kosu-kilidi', { ttlMin: 75 });
  await kl.bindLocks(db, keys, 'kosu-kilidi', { awxServerId: 3, awxJobId: 900, bagTuru: 'kosu' });
  await AL(db, ['T|GBNGXT40'], 'baska');
  db.simdi += 70 * 60000; // kosu kilidinin 5 dk'si kaldi
  assert.equal(await kl.durdurIsineBagla(db, 'kosu-kilidi', { awxServerId: 3, awxJobId: 950, uzatSn: 1380 + 180 }), 3);
  for (const k of keys) {
    const s = db.satirlar.get(k);
    assert.deepEqual([s.held, s.awx_server_id, s.awx_job_id, s.bag_turu], [1, 3, 950, 'durdur'], k);
    assert.equal(s.locked_until, db.simdi + (1380 + 180) * 1000, `${k}: sure butce + 180'e uzamadi`);
  }
  assert.equal(db.satirlar.get('T|GBNGXT40').bag_turu ?? null, null, 'baska kilit durdur isine baglandi');
  // Durdur isi basariyla bitince supurme kurali birakir; basarisizsa tutar.
  assert.equal(kl.bagliIsKarari(db.satirlar.get('G|global').bag_turu, 'successful'), 'birak');
  assert.equal(kl.bagliIsKarari(db.satirlar.get('G|global').bag_turu, 'failed'), 'tut');
  // Birakilmis kilit yeniden baglanmaz; kilit_id yoksa sorgu da yok.
  await kl.releaseLocksForJob(db, 3, 950);
  assert.equal(await kl.durdurIsineBagla(db, 'kosu-kilidi', { awxServerId: 3, awxJobId: 951, uzatSn: 100 }), 0);
  const once = db.sorgular.length;
  assert.equal(await kl.durdurIsineBagla(db, null, { awxServerId: 3, awxJobId: 952, uzatSn: 100 }), 0);
  assert.equal(db.sorgular.length, once);
});

test('YK14 tur 3 anahtarlari: serbest on kontrol de G alir, T|IP; gecersiz IP hata; dolu kilit mesaji', async () => {
  // Sunucu hedefi: tur 2 ile ayni (IP anahtara girmez).
  assert.deepEqual(kl.kilitAnahtarlari({ hedef: 'GBNGXT33', hedefIp: '10.0.0.9', yuk: 'GBNGXT34', kosu: true }), ['G|global', 'T|GBNGXT33', 'L|GBNGXT34']);
  assert.deepEqual(kl.kilitAnahtarlari({ hedef: 'gbngxt33', hedefIp: '10.0.0.9', hedefTuru: 'sunucu', yuk: 'GBNGXT34' }), ['T|GBNGXT33', 'L|GBNGXT34']);
  // Serbest hedef: on kontrolde DE G; T anahtari IP.
  assert.deepEqual(kl.kilitAnahtarlari({ hedef: null, hedefIp: '10.20.30.40', hedefTuru: 'serbest', yuk: 'gbngxt34' }), ['G|global', 'T|IP:10.20.30.40', 'L|GBNGXT34']);
  assert.deepEqual(kl.kilitAnahtarlari({ hedef: null, hedefIp: '10.20.30.40', hedefTuru: 'serbest', yuk: 'GBNGXT34', kosu: true }), ['G|global', 'T|IP:10.20.30.40', 'L|GBNGXT34']);
  // Gecerli IPv4 yoksa anahtar URETILMEZ (sessiz T|NULL / T|IP: yok); taninmayan tur da hata.
  for (const ip of [null, undefined, '', '10.20.30', ' 10.20.30.40', '10.20.30.40/24', 'GBNGXT33', '10.20.30.256']) {
    assert.throws(() => kl.kilitAnahtarlari({ hedef: 'GBNGXT33', hedefIp: ip, hedefTuru: 'serbest', yuk: 'GBNGXT34' }), TypeError, String(ip));
  }
  assert.throws(() => kl.kilitAnahtarlari({ hedef: 'GBNGXT33', hedefTuru: 'lb', yuk: 'GBNGXT34' }), TypeError);
  // Serbest anahtarlar ayni CAS ile alinir; ayni IP'ye ikinci is T|IP'de durur.
  const db = kilitDb();
  const s1 = kl.kilitAnahtarlari({ hedefIp: '10.20.30.40', hedefTuru: 'serbest', yuk: 'GBNGXT34' });
  assert.equal((await AL(db, s1, 'a')).ok, true);
  db.satirlar.get('G|global').held = 0;
  db.satirlar.get('L|GBNGXT34').held = 0;
  const r = await AL(db, kl.kilitAnahtarlari({ hedefIp: '10.20.30.40', hedefTuru: 'serbest', yuk: 'GBNGXT35' }), 'b');
  assert.deepEqual([r.ok, r.busyKey], [false, 'T|IP:10.20.30.40']);
  for (const s of db.sorgular) assert.doesNotMatch(s.q, /10\.20\.30\.40/, `IP SQL metninde: ${s.q}`);
  // doluKilitMesaji: T|IP dali T| dalindan ONCE; G / T / L metinleri degismez.
  assert.equal(
    kl.doluKilitMesaji('T|IP:10.20.30.40', { holder: 'ali', target_desc: 'ön kontrol 10.20.30.40 (serbest) <- GBNGXT34 (wrk)', awx_job_id: 9 }),
    "10.20.30.40 IP'sine yönelik başka bir iş var (ali: ön kontrol 10.20.30.40 (serbest) <- GBNGXT34 (wrk), AWX iş #9). İş bitince kilit kendiliğinden bırakılır.",
  );
  assert.equal(kl.doluKilitMesaji('G|global', { holder: 'ali', target_desc: 'ön kontrol 10.20.30.40 (serbest) <- GBNGXT34' }), 'Başka bir yük testi koşuyor (ali: ön kontrol 10.20.30.40 (serbest) <- GBNGXT34). İş bitince kilit kendiliğinden bırakılır.');
  assert.equal(kl.doluKilitMesaji('T|GBNGXT33', null), 'GBNGXT33 üzerinde başka bir iş var. İş bitince kilit kendiliğinden bırakılır.');
  assert.equal(kl.doluKilitMesaji('L|GBNGXT34', null), 'GBNGXT34 yük makinesi meşgul. İş bitince kilit kendiliğinden bırakılır.');
});

test('YK8 AWX sunucusunu kapatma ozeti suren yuk testini ve tutulan kilidi ENGEL sayar', async () => {
  const { _ENGELLER, bagimlilikOzeti } = require('../../ansible/awx-sunucu-bagimlilik.cjs');
  const e = _ENGELLER.find((x) => x.anahtar === 'kilit');
  assert.ok(e, 'kilit engeli yok');
  const q = e.sql.replace(/\s+/g, ' ');
  assert.match(q, /FROM nginx_loadtest_kilitleri WHERE held = 1 AND awx_server_id = \$1/, 'tutulan yuk testi kilidi sayilmiyor');
  assert.match(q, /FROM nginx_loadtest_kosular WHERE awx_server_id = \$1 AND awx_job_id IS NOT NULL AND durum IN \('QUEUED','RUNNING','FINALIZING'\)/, 'suren yuk testi kosusu sayilmiyor');
  assert.match(q, /UNION/, 'ayni is kilit + satir olarak iki kez sayiliyor');
  // Engel tablosu okunamazsa (tablo yok) ozet "kapatilabilir" DEMEZ.
  const db = { query: async (sql) => {
    if (/nginx_loadtest_/.test(sql)) throw new Error("Invalid object name 'nginx_loadtest_kilitleri'");
    return /COUNT|CASE WHEN/.test(sql) ? { rows: [{ n: 0 }] } : { rows: [] };
  } };
  const o = await bagimlilikOzeti(2, { db, env: {} });
  assert.equal(o.kapatilabilir, false);
  assert.ok(o.okunamayan.some((x) => x.anahtar === 'kilit'));
});

test('YK15 kilit alma ortasinda istisna: acquireLocks firlatir; releaseLocks yalniz bu lock_id\'li dolu satirlari birakir', async () => {
  const db = kilitDb();
  const keys = kl.kilitAnahtarlari({ hedefIp: '10.20.30.40', hedefTuru: 'serbest', yuk: 'GBNGXT34' });
  // L baska bir isin; bu istek G'yi alir, T|IP satir garantisi gecici hata atar (deadlock kurbani).
  assert.equal((await AL(db, ['L|GBNGXT34'], 'yabanci')).ok, true);
  const asil = db.query;
  let atildi = false;
  db.query = async (sql, params = []) => {
    if (!atildi && /^\s*IF NOT EXISTS/.test(sql) && params[0] === 'T|IP:10.20.30.40') {
      atildi = true;
      throw Object.assign(new Error('deadlock kurbani'), { number: 1205 });
    }
    return asil(sql, params);
  };
  await assert.rejects(AL(db, keys, 'ben'), /deadlock kurbani/);
  db.query = asil;
  // acquireLocks istisnada alinmisi BIRAKMAZ: birakma cagiranin (index.cjs kosuyuBaslat catch'i).
  assert.deepEqual([db.satirlar.get('G|global').held, db.satirlar.get('G|global').lock_id], [1, 'ben']);
  await kl.releaseLocks(db, keys, 'ben');
  assert.equal(db.satirlar.get('G|global').held, 0, 'bu istegin G kilidi birakilmadi');
  assert.deepEqual([db.satirlar.get('L|GBNGXT34').held, db.satirlar.get('L|GBNGXT34').lock_id], [1, 'yabanci'], 'yabanci kilit birakildi');
  assert.equal(db.satirlar.has('T|IP:10.20.30.40'), false, 'fikstur: T|IP satiri yazilmamis olmali');
  assert.equal((await AL(db, ['G|global'], 'sonraki')).ok, true, 'birakilan G yeniden alinamadi');
});
