// server/ansible/__tests__/is-kaydi.test.js - acilan AWX isinin Portal kaydi (is-kaydi.cjs, 2026-11-24).
//   IK1 is gecmisi satiri (kullanici, sunucu, sablon, ad, is no, durum, params JSON) + denetim (detay + is no)
//   IK2 kullanici adi / durum yoksa varsayilanlar; is numarasi yoksa denetimde null
//   IK3 gecmis yazilamazsa yalniz uyari (etiketli); denetim hatasi yutulur; ikisi de cagirani dusurmez
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const D = { sorgular: [], denetim: [], dbHata: null, denetimHata: null };
function stub(rel, exports) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('../../db/index.cjs', {
  query: async (sql, p) => {
    if (D.dbHata) throw new Error(D.dbHata);
    D.sorgular.push([sql, p]);
    return { rows: [] };
  },
});
stub('../../audit/index.cjs', {
  auditPortal: (req, tur, o) => {
    if (D.denetimHata) throw new Error(D.denetimHata);
    D.denetim.push([req.id, tur, JSON.parse(o.detail)]);
  },
});
const { isKaydiYaz } = require('../is-kaydi.cjs');

beforeEach(() => {
  Object.assign(D, { sorgular: [], denetim: [], dbHata: null, denetimHata: null });
});

const girdi = (ek = {}) => ({
  serverId: 2,
  templateId: 301,
  templateName: 'Server Hub: tarama',
  result: { jobId: 77, status: 'pending' },
  params: { host: 'APP01', plan_only: true },
  etiket: 'ServerHub',
  denetimTuru: 'server_hub',
  detay: { op: 'tara', host: 'APP01' },
  ...ek,
});

test('IK1 is gecmisi satiri ve denetim kaydi', async () => {
  await isKaydiYaz({ id: 'r1' }, { username: 'ayse' }, girdi());
  assert.equal(D.sorgular.length, 1);
  const [sql, p] = D.sorgular[0];
  assert.match(
    sql,
    /^INSERT INTO ansible_job_history \(username, awx_server_id, template_id, template_name, job_id, status, params\)/,
  );
  assert.deepEqual(p, [
    'ayse',
    2,
    301,
    'Server Hub: tarama',
    77,
    'pending',
    '{"host":"APP01","plan_only":true}',
  ]);
  assert.deepEqual(D.denetim, [['r1', 'server_hub', { op: 'tara', host: 'APP01', jobId: 77 }]]);
});

test('IK2 eksik kullanici / durum / is numarasi varsayilanlari', async () => {
  await isKaydiYaz({ id: 'r2' }, {}, girdi({ result: {} }));
  const [, p] = D.sorgular[0];
  assert.equal(p[0], 'unknown');
  assert.equal(p[4], undefined);
  assert.equal(p[5], 'pending');
  assert.equal(D.denetim[0][2].jobId, null);
});

test('IK3 gecmis ya da denetim yazilamazsa cagiran dusmez; gecmis hatasi etiketle uyarilir', async (t) => {
  const uyarilar = [];
  t.mock.method(console, 'warn', (...a) => uyarilar.push(a.join(' ')));
  D.dbHata = 'baglanti yok';
  D.denetimHata = 'denetim kapali';
  await isKaydiYaz({ id: 'r3' }, { username: 'ali' }, girdi({ etiket: 'Retirement' }));
  assert.deepEqual(uyarilar, ['[Retirement] job gecmisi yazilamadi: baglanti yok']);
  assert.deepEqual(D.denetim, []);
});
