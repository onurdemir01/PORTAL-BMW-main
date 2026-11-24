// server/oco/__tests__/oco-store-durum.test.js - oco_scheduled_launches durum makinesi bellek ici tabloyla
// (2026-11-24, kapsam PR-2). Sahte DB, store'un gonderdigi SQL'i YORUMLAR: kosullu UPDATE'in WHERE durum
// sarti gercekten uygulanir. Boylece "iptal edilen kayit LAUNCHED'a geri doner" sinifi davranisla sinanir.
//   OS1  create / createAwxScheduled / get: alan eslemesi, grup bilgisi null ile bos dizi ayri
//   OS2  listScheduled yalniz SCHEDULED (AWX_SCHEDULED'a poller dokunmaz)
//   OS3  claim yarisi: ikinci claim bos; markLaunched yalniz LAUNCHING'de
//   OS4  tetik sirasinda admin iptali: markLaunched / markFailed iptali ezmez
//   OS5  onay yolu: PENDING_APPROVAL -> AWX_SCHEDULED / LAUNCHED / sonuclandi
//   OS6  smart-first: talep aninda bilet yalniz SCHEDULED'i ceker (2026-10-08 cift bilet olayi)
//   OS7  adoptTicket: bilet durumu -> kayit durumu tablosu; SCHEDULED olmayan kayda dokunmaz
//   OS8  markRetriggered: gecersiz durum firlatir; yalniz FAILED; LAUNCHED kapatir, AWX_SCHEDULED acik birakir
//   OS9  update yalniz SCHEDULED, verilmeyen alan korunur; markExpired yalniz SCHEDULED
//   OS10 iptal turleri: sahip (cancel), grup (cancelBy), admin (adminCancel) durum kumeleri
//   OS11 gorunurluk: canManage, gruplarKesisiyor, listForUser (eski kayit grupla gorunmez, tavan)
//   OS12 listAll: suzgecler, sayfalama, toplam
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// --- bellek ici tablo -----------------------------------------------------------------------
let tablo = [];
let sira = 0;
const sorgular = [];

/** Ust duzey virgullerden boler (parantez ve tirnak icini korur). */
function bol(s) {
  const out = [];
  let derin = 0;
  let tirnak = false;
  let cur = '';
  for (const ch of s) {
    if (ch === "'") tirnak = !tirnak;
    if (!tirnak && ch === '(') derin++;
    if (!tirnak && ch === ')') derin--;
    if (!tirnak && derin === 0 && ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function deger(expr, params, satir) {
  const e = expr.trim();
  let m;
  if ((m = /^\$(\d+)$/.exec(e))) return params[Number(m[1]) - 1];
  if ((m = /^N?'(.*)'$/s.exec(e))) return m[1];
  if (e === 'NULL') return null;
  if (e === 'GETUTCDATE()') return new Date();
  if ((m = /^COALESCE\((.+)\)$/s.exec(e))) {
    const [a, b] = bol(m[1]);
    return deger(a, params, satir) ?? deger(b, params, satir);
  }
  if (/^\w+$/.test(e) && satir) return satir[e];
  throw new Error(`sahte DB: anlasilmayan ifade ${e}`);
}
function durumSarti(sql, params) {
  const m1 = /status = '(\w+)'/.exec(sql.split('WHERE')[1] || '');
  if (m1) return [m1[1]];
  const m2 = /status IN \(([^)]+)\)/.exec(sql.split('WHERE')[1] || '');
  if (m2) return bol(m2[1]).map((x) => deger(x, params));
  return null;
}
function like(v, kalip) {
  return String(v ?? '')
    .toLowerCase()
    .includes(String(kalip).replaceAll('%', '').toLowerCase());
}

const sahteDb = {
  async query(sql, params = []) {
    sorgular.push({ sql, params });
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO oco_scheduled_launches')) {
      const [, kol, deg] = /\(([^)]+)\) OUTPUT INSERTED\.\* VALUES \((.+)\)$/.exec(s);
      const satir = { id: ++sira, created_at: new Date(), updated_at: new Date() };
      const kolonlar = bol(kol);
      bol(deg).forEach((d, i) => (satir[kolonlar[i]] = deger(d, params)));
      tablo.push(satir);
      return { rows: [{ ...satir }] };
    }
    if (s.startsWith('UPDATE oco_scheduled_launches')) {
      const set = /SET (.+?)(?: OUTPUT INSERTED\.(?:\*|id))? WHERE/.exec(s)[1];
      const izin = durumSarti(s, params);
      const sahip = / AND username = \$(\d+)/.exec(s);
      const satir = tablo.find((r) => r.id === params[0]);
      if (!satir || (izin && !izin.includes(satir.status))) return { rows: [] };
      if (sahip && satir.username !== params[Number(sahip[1]) - 1]) return { rows: [] };
      const yeni = {};
      for (const atama of bol(set)) {
        const [kol, ...ifade] = atama.split('=');
        yeni[kol.trim()] = deger(ifade.join('='), params, satir);
      }
      Object.assign(satir, yeni);
      if (/OUTPUT INSERTED\.\*/.test(s)) return { rows: [{ ...satir }] };
      if (/OUTPUT INSERTED\.id/.test(s)) return { rows: [{ id: satir.id }] };
      return { rows: [] };
    }
    if (/^SELECT \* FROM oco_scheduled_launches WHERE id = \$1$/.test(s))
      return { rows: tablo.filter((r) => r.id === params[0]).map((r) => ({ ...r })) };
    if (s === "SELECT * FROM oco_scheduled_launches WHERE status = 'SCHEDULED'")
      return { rows: tablo.filter((r) => r.status === 'SCHEDULED') };
    let m;
    if (
      (m = /^SELECT TOP \((\d+)\) \* FROM oco_scheduled_launches( WHERE username = \$1)?/.exec(s))
    ) {
      let rows = [...tablo].sort((a, b) => b.id - a.id);
      if (m[2]) rows = rows.filter((r) => r.username === params[0]);
      return { rows: rows.slice(0, Number(m[1])) };
    }
    const suz = (rows) => {
      const w = /oco_scheduled_launches (WHERE .+?)(?: ORDER BY|$)/.exec(s);
      if (!w) return rows;
      return rows.filter((r) =>
        w[1]
          .slice(6)
          .split(' AND ')
          .every((k) => {
            const n = Number(/\$(\d+)/.exec(k)[1]) - 1;
            if (k.startsWith('status =')) return r.status === params[n];
            if (k.startsWith('username LIKE')) return like(r.username, params[n]);
            return [r.oco_number, r.oco_subject, r.pending_launch_json].some((v) =>
              like(v, params[n]),
            );
          }),
      );
    };
    if ((m = /OFFSET (\d+) ROWS FETCH NEXT (\d+) ROWS ONLY$/.exec(s))) {
      const rows = suz([...tablo].sort((a, b) => b.id - a.id));
      return { rows: rows.slice(Number(m[1]), Number(m[1]) + Number(m[2])) };
    }
    if (s.startsWith('SELECT COUNT(*) AS n FROM oco_scheduled_launches'))
      return { rows: [{ n: suz(tablo).length }] };
    throw new Error(`sahte DB: beklenmeyen sorgu ${s}`);
  },
};
const dbYolu = require.resolve(path.join(__dirname, '..', '..', 'db', 'index.cjs'));
require.cache[dbYolu] = { id: dbYolu, filename: dbYolu, loaded: true, exports: sahteDb };

const store = require('../store.cjs');

const kayit = (ek = {}) => ({
  username: 'ornekkisi',
  awxServerId: 2,
  awxTemplateId: 41,
  ocoNumber: '22502813',
  ocoSubject: 'Node gecisi',
  runAt: new Date('2026-12-01T22:00:00Z'),
  windowEnd: new Date('2026-12-02T02:00:00Z'),
  pendingLaunch: { templateName: 'scalex_stop', extraVars: { hedef: 'ORNAPP01' } },
  ownerGroups: ['GT-Middleware'],
  ...ek,
});
const durumu = (id) => tablo.find((r) => r.id === id).status;

beforeEach(() => {
  tablo = [];
  sira = 0;
  sorgular.length = 0;
});

test('OS1 create / createAwxScheduled / get: alan eslemesi ve grup bilgisi', async () => {
  const a = await store.create(kayit({ ocoSubject: '' }));
  assert.equal(a.status, 'SCHEDULED');
  assert.equal(a.ocoSubject, null);
  assert.deepEqual(a.pendingLaunch, kayit().pendingLaunch);
  assert.deepEqual(a.ownerGroups, ['GT-Middleware']);
  assert.equal(a.awxScheduleId, null);
  assert.equal(a.smartTicketId, null);
  assert.equal(a.cancelledBy, null);

  const b = await store.createAwxScheduled(kayit({ awxScheduleId: 77, ownerGroups: undefined }));
  assert.equal(b.status, 'AWX_SCHEDULED');
  assert.equal(b.awxScheduleId, 77);
  assert.equal(b.ownerGroups, null, 'grup bilgisi yoksa null (bos dizi degil)');
  const c = await store.create(kayit({ ownerGroups: ['', 'GT-A'] }));
  assert.deepEqual(c.ownerGroups, ['GT-A']);

  assert.deepEqual((await store.get(a.id)).pendingLaunch, a.pendingLaunch);
  assert.equal(await store.get(999), null);
  // Bozuk ya da dizi olmayan grup alani null okunur (eski kayit gibi).
  tablo[0].owner_groups = '{bozuk';
  assert.equal((await store.get(a.id)).ownerGroups, null);
  tablo[0].owner_groups = '{"a":1}';
  assert.equal((await store.get(a.id)).ownerGroups, null);
});

test('OS2 listScheduled yalniz SCHEDULED kayitlari doner', async () => {
  const a = await store.create(kayit());
  await store.createAwxScheduled(kayit({ awxScheduleId: 1 }));
  const c = await store.create(kayit());
  await store.cancel(c.id, 'ornekkisi');
  assert.deepEqual(
    (await store.listScheduled()).map((r) => r.id),
    [a.id],
  );
});

test('OS3 claim yarisi: yalniz ilk claim kazanir; markLaunched yalniz LAUNCHING', async () => {
  const a = await store.create(kayit());
  assert.equal(await store.markLaunched(a.id, 5), false, 'SCHEDULED kayit tetiklendi sayilmamali');
  const ilk = await store.claimForLaunch(a.id);
  assert.equal(ilk.status, 'LAUNCHING');
  assert.equal(await store.claimForLaunch(a.id), null, 'ikinci poller ayni kaydi aldi');
  assert.equal(await store.markLaunched(a.id, 501), true);
  assert.equal(durumu(a.id), 'LAUNCHED');
  assert.equal(tablo[0].awx_job_id, 501);
  assert.ok(tablo[0].resolved_at instanceof Date);
  assert.equal(await store.markLaunched(a.id, 502), false);
  assert.equal(tablo[0].awx_job_id, 501);
});

test('OS4 tetik sirasinda admin iptali sonucu ezmez', async () => {
  const a = await store.create(kayit());
  await store.claimForLaunch(a.id);
  const ipt = await store.adminCancel(a.id, { cancelledBy: 'admin1', note: 'x'.repeat(1500) });
  assert.equal(ipt.status, 'CANCELLED');
  assert.equal(ipt.cancelNote.length, 1000);
  assert.equal(await store.markLaunched(a.id, 9), false);
  assert.equal(await store.markFailed(a.id, 'AWX hatasi'), false);
  assert.equal(await store.markPendingApproval(a.id, { smartTicketId: 1 }), false);
  assert.equal(durumu(a.id), 'CANCELLED');
  // Sonuclanmis kayit tekrar iptal edilmez.
  assert.equal(await store.adminCancel(a.id, {}), null);
  // markFailed sonuclanmamis kaydi kapatir, mesaji 4000'de keser.
  const b = await store.create(kayit());
  assert.equal(await store.markFailed(b.id, 'h'.repeat(5000)), true);
  assert.equal(tablo[1].error_message.length, 4000);
});

test('OS5 onay yolu: PENDING_APPROVAL gecisleri', async () => {
  const a = await store.create(kayit());
  await store.claimForLaunch(a.id);
  assert.equal(
    await store.markPendingApproval(a.id, { smartTicketId: 12, externalTicketId: 'T-9' }),
    true,
  );
  let r = await store.get(a.id);
  assert.equal(r.status, 'PENDING_APPROVAL');
  assert.equal(r.smartTicketId, 12);
  assert.match(r.errorMessage, /#T-9/);
  assert.equal(
    await store.markAwxScheduledAfterApproval(a.id, {
      awxScheduleId: 88,
      runAt: '2026-12-01T23:00:00Z',
    }),
    true,
  );
  r = await store.get(a.id);
  assert.equal(r.status, 'AWX_SCHEDULED');
  assert.equal(r.awxScheduleId, 88);
  assert.equal(new Date(r.runAt).toISOString(), '2026-12-01T23:00:00.000Z');
  // Artik PENDING_APPROVAL degil: onay sonucu ikinci kez yazilmaz.
  assert.equal(await store.markApprovedLaunched(a.id, 3), false);
  assert.equal(await store.markApprovalResolved(a.id, { status: 'FAILED' }), false);

  const b = await store.create(kayit());
  await store.claimForLaunch(b.id);
  await store.markPendingApproval(b.id, {});
  assert.match(tablo[1].error_message, /#\?/);
  assert.equal(await store.markApprovedLaunched(b.id), true);
  r = await store.get(b.id);
  assert.equal(r.status, 'LAUNCHED');
  assert.equal(r.awxJobId, null);
  assert.equal(r.errorMessage, null);

  const c = await store.create(kayit());
  await store.claimForLaunch(c.id);
  await store.markPendingApproval(c.id, { smartTicketId: 4 });
  assert.equal(await store.markApprovalResolved(c.id, { status: 'FAILED', message: '' }), true);
  r = await store.get(c.id);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.errorMessage, null);
  const d = await store.create(kayit());
  await store.claimForLaunch(d.id);
  await store.markPendingApproval(d.id, {});
  await store.markAwxScheduledAfterApproval(d.id, { runAt: new Date('2026-12-03T00:00:00Z') });
  assert.equal((await store.get(d.id)).awxScheduleId, null);
});

test('OS6 smart-first: talep aninda bilet yalniz SCHEDULED kaydi ceker', async () => {
  const a = await store.create(kayit());
  // 2026-10-08 olayi: LAUNCHING'e yazan fonksiyon SCHEDULED kayitta hicbir sey yazmaz.
  assert.equal(await store.markPendingApproval(a.id, { smartTicketId: 1 }), false);
  assert.equal(durumu(a.id), 'SCHEDULED');
  assert.equal(
    await store.markPendingApprovalAtRequest(a.id, { smartTicketId: 1, externalTicketId: 'S1' }),
    true,
  );
  assert.equal(durumu(a.id), 'PENDING_APPROVAL');
  assert.match(tablo[0].error_message, /talep aninda acildi \(#S1\)/);
  // Artik poller'in listesinde yok: ikinci bilet acilamaz.
  assert.equal((await store.listScheduled()).length, 0);
  assert.equal(await store.markPendingApprovalAtRequest(a.id, {}), false);
});

test('OS7 adoptTicket: bilet durumu tablosu ve SCHEDULED disina dokunmama', async () => {
  // Beklenen tablo testte ELLE yazili: store'un kendi tablosundan okunsaydi tablo bozulunca test de
  // onunla birlikte degisirdi (mutasyon turunda kor cikti).
  const BEKLENEN = {
    PENDING: 'PENDING_APPROVAL',
    LAUNCHING: 'PENDING_APPROVAL',
    SCHEDULED: 'AWX_SCHEDULED',
    LAUNCHED: 'LAUNCHED',
    REJECTED: 'CANCELLED',
    CANCELLED: 'CANCELLED',
    TIMEOUT: 'FAILED',
    FAILED: 'FAILED',
    ERROR: 'FAILED',
  };
  assert.deepEqual(Object.keys(store.BILET_KAYIT).sort(), Object.keys(BEKLENEN).sort());
  for (const [bilet, beklenen] of Object.entries(BEKLENEN)) {
    const a = await store.create(kayit());
    const st = await store.adoptTicket(a.id, {
      id: 70,
      status: bilet.toLowerCase(),
      awxScheduleId: 5,
      awxJobId: 6,
      externalTicketId: 'X1',
    });
    assert.equal(st, beklenen, bilet);
    const r = await store.get(a.id);
    assert.equal(r.status, beklenen);
    assert.equal(r.smartTicketId, 70);
    assert.match(r.errorMessage, /#X1, /);
  }
  const b = await store.create(kayit());
  assert.equal(await store.adoptTicket(b.id, { status: 'GARIP' }), 'PENDING_APPROVAL');
  assert.match(tablo.at(-1).error_message, /#\?, GARIP/);
  assert.equal(await store.adoptTicket(b.id, { status: 'LAUNCHED' }), null);
  assert.equal(durumu(b.id), 'PENDING_APPROVAL');
  const c = await store.create(kayit());
  assert.equal(await store.adoptTicket(c.id, null), 'PENDING_APPROVAL');
});

test('OS8 markRetriggered: yalniz FAILED; LAUNCHED kapatir, AWX_SCHEDULED acik birakir', async () => {
  await assert.rejects(store.markRetriggered(1, { status: 'CANCELLED' }), /gecersiz durum/);
  const a = await store.create(kayit());
  assert.equal(await store.markRetriggered(a.id, { status: 'LAUNCHED', awxJobId: 7 }), false);
  await store.markFailed(a.id, 'zaman asimi');
  tablo[0].resolved_at = null;
  assert.equal(await store.markRetriggered(a.id, { status: 'LAUNCHED', awxJobId: 7 }), true);
  let r = await store.get(a.id);
  assert.equal(r.status, 'LAUNCHED');
  assert.equal(r.awxJobId, 7);
  assert.equal(r.ocoNumber, '22502813', 'verilmeyen numara korunmali');
  assert.ok(r.resolvedAt instanceof Date);
  assert.equal(r.errorMessage, null);

  const b = await store.create(kayit());
  await store.markFailed(b.id, 'zaman asimi');
  assert.equal(
    await store.markRetriggered(b.id, {
      status: 'AWX_SCHEDULED',
      awxScheduleId: 31,
      ocoNumber: '22509999',
      runAt: '2026-12-05T22:00:00Z',
      windowEnd: new Date('2026-12-06T02:00:00Z'),
      message: 'yeniden zamanlandi',
    }),
    true,
  );
  r = await store.get(b.id);
  assert.equal(r.status, 'AWX_SCHEDULED');
  assert.equal(r.awxScheduleId, 31);
  assert.equal(r.ocoNumber, '22509999');
  assert.equal(new Date(r.runAt).toISOString(), '2026-12-05T22:00:00.000Z');
  assert.equal(r.resolvedAt, null, 'zamanlanan is henuz sonuclanmadi');
  assert.equal(r.errorMessage, 'yeniden zamanlandi');
  // Iptal edilmis kayda dokunulmaz.
  const c = await store.create(kayit());
  await store.cancel(c.id, 'ornekkisi');
  assert.equal(await store.markRetriggered(c.id, { status: 'LAUNCHED' }), false);
});

test('OS9 update ve markExpired yalniz SCHEDULED', async () => {
  const a = await store.create(kayit());
  const r = await store.update(a.id, { ocoNumber: '22500001' });
  assert.equal(r.ocoNumber, '22500001');
  assert.equal(r.ocoSubject, 'Node gecisi');
  assert.equal(new Date(r.runAt).toISOString(), '2026-12-01T22:00:00.000Z');
  await store.claimForLaunch(a.id);
  assert.equal(await store.update(a.id, { ocoNumber: '1' }), null, 'tetiklenen is guncellendi');
  await store.markExpired(a.id);
  assert.equal(durumu(a.id), 'LAUNCHING');
  const b = await store.create(kayit());
  await store.markExpired(b.id);
  assert.equal(durumu(b.id), 'EXPIRED');
  assert.match(tablo[1].error_message, /penceresi tetikleme yapılmadan kapandı/);
});

test('OS10 iptal turleri: sahip, grup uyesi, admin', async () => {
  const a = await store.create(kayit());
  assert.equal(await store.cancel(a.id, 'baskasi'), null, 'sahip olmayan cancel()');
  assert.equal((await store.cancel(a.id, 'ornekkisi')).status, 'CANCELLED');

  const b = await store.createAwxScheduled(kayit({ awxScheduleId: 2 }));
  assert.equal(await store.cancel(b.id, 'ornekkisi'), null, 'cancel() AWX_SCHEDULED kapsamaz');
  const ipt = await store.cancelBy(b.id, { cancelledBy: 'grupuyesi', note: '' });
  assert.equal(ipt.status, 'CANCELLED');
  assert.equal(ipt.cancelledBy, 'grupuyesi');
  assert.equal(ipt.cancelNote, null);

  const c = await store.create(kayit());
  await store.claimForLaunch(c.id);
  assert.equal(await store.cancelBy(c.id, {}), null, 'grup iptali LAUNCHING kaydi kapatmaz');
  await store.markLaunched(c.id, 4);
  const adm = await store.adminCancel(c.id, { cancelledBy: 'admin1' });
  assert.equal(adm.status, 'CANCELLED', 'admin calisan isi de iptal eder');
  assert.equal(adm.cancelNote, null);
});

test('OS11 gorunurluk: canManage, gruplarKesisiyor, listForUser', async () => {
  assert.equal(store.gruplarKesisiyor([' gt-middleware '], ['GT-Middleware']), true);
  assert.equal(store.gruplarKesisiyor(['GT-MW'], ['GT-MW-ADMIN']), false, 'alt dize eslesmez');
  assert.equal(store.gruplarKesisiyor(null, ['a']), false);
  assert.equal(store.gruplarKesisiyor([], ['a']), false);

  const rec = { username: 'OrnekKisi', ownerGroups: ['GT-A'] };
  assert.equal(store.canManage(null, { role: 'Admin' }), false);
  assert.equal(store.canManage(rec, { role: 'Admin' }), true);
  assert.equal(store.canManage(rec, { username: ' ornekkisi ' }), true);
  assert.equal(store.canManage(rec, { username: 'x', groups: ['gt-a'] }), true);
  assert.equal(store.canManage(rec, { username: 'x', groups: 'GT-A' }), false);

  await store.create(kayit({ username: 'eski', ownerGroups: undefined }));
  await store.create(kayit({ username: 'yabanci', ownerGroups: ['GT-Z'] }));
  await store.create(kayit({ username: 'ben' }));
  await store.create(kayit({ username: 'komsu', ownerGroups: ['GT-B'] }));
  const { items, truncated } = await store.listForUser({ username: 'BEN', groups: ['gt-b'] });
  assert.deepEqual(
    items.map((r) => r.username),
    ['komsu', 'ben'],
  );
  assert.equal(truncated, false);
  const kisa = await store.listForUser({ username: 'ben', groups: ['GT-B'], limit: 1 });
  assert.equal(kisa.items.length, 1);
  assert.equal(kisa.truncated, true);
  const bos = await store.listForUser();
  assert.deepEqual(bos.items, []);
  await store.listForUser({ username: 'ben', limit: 100000 });
  assert.match(sorgular.at(-1).sql, /TOP \(501\)/, 'okuma 500 ile sinirli olmali');
});

test('OS12 listAll ve listByUsername: suzgec, sayfalama, toplam', async () => {
  for (let i = 0; i < 5; i++) await store.create(kayit({ username: i % 2 ? 'ali' : 'veli' }));
  await store.create(kayit({ username: 'veli', ocoNumber: '22599999', ocoSubject: 'Ozel konu' }));
  await store.cancel(1, 'veli');
  let r = await store.listAll();
  assert.equal(r.total, 6);
  assert.deepEqual(
    r.items.map((x) => x.id),
    [6, 5, 4, 3, 2, 1],
  );
  r = await store.listAll({ limit: 2, offset: 1 });
  assert.deepEqual(
    r.items.map((x) => x.id),
    [5, 4],
  );
  assert.equal(r.total, 6);
  r = await store.listAll({ status: 'CANCELLED' });
  assert.deepEqual(
    r.items.map((x) => x.id),
    [1],
  );
  r = await store.listAll({ username: 'al', status: 'SCHEDULED' });
  assert.equal(r.total, 2);
  r = await store.listAll({ q: 'ozel' });
  assert.deepEqual(
    r.items.map((x) => x.id),
    [6],
  );
  r = await store.listAll({ q: 'ORNAPP01', limit: 'x', offset: 'y' });
  assert.equal(r.total, 6, 'q bekleyen paket icinde de arar');
  assert.match(sorgular.at(-2).sql, /OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY/);

  const benim = await store.listByUsername('veli', 2);
  assert.deepEqual(
    benim.map((x) => x.id),
    [6, 5],
  );
  await store.listByUsername('veli', 'x');
  assert.match(sorgular.at(-1).sql, /TOP \(50\)/);
});
