// server/logx/v2/__tests__/logx-yonetim-ekrani.test.cjs
//
// LogX YONETIMI EKRANININ SUNUCU UCLARI (L5, 2026-10-01):
//   Y1 "Neden reddedildi?" — kullaniciyi ADIM ADIM sinar (sayfa gorunurlugu → ortam →
//      kaynak), gruplar LDAP'tan CANLI; LDAP yoksa bu SOYLENIR. Yalnizca Admin.
//   Y2 Red gunlugu — `v2_denied` kayitlari ayristirilmis doner. Yalnizca Admin.
//   Y3 Ortam etiketleri — OCP katalogu + Legacy son-ek eslemesi YAN YANA, kaynaklariyla.
//   Y4 Altyapi teshisi — eksik kimlik alanlari; bastion yedegi EKSIK sayilmaz.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../../../db/index.cjs');
const audit = require('../../audit.cjs');
const ldap = require('../../../auth/ldap.cjs');
const visibility = require('../../../auth/visibility.cjs');
const adminData = require('../admin.cjs');

const PROD_GRUP = 'CN=prod-log,OU=Groups,DC=example,DC=com';
const y = {};
let ldapKullanici = null;
let ldapHata = null;

before(async () => {
  y.query = db.query;
  db.query = async (sql, p = []) => {
    const s = String(sql);
    if (/FROM logx_v2_restrictions r/.test(s) && /r.resource_key = \$2/.test(s)) {
      if (p[0] === 'env' && p[1] === 'PROD')
        return { rows: [{ id: 1, username: null, group_dn: PROD_GRUP }] };
      return { rows: [] };
    }
    return { rows: [] };
  };
  y.getLogs = audit.getLogs;
  audit.getLogs = async (q) => {
    y.sonGetLogs = q;
    return [
      {
        id: 7,
        created_at: '2026-10-01T10:00:00Z',
        username: 'veli',
        detail: JSON.stringify({
          type: 'env',
          key: 'PROD',
          route: 'POST /api/logx/v2/ocp/r1/select',
        }),
      },
      { id: 8, created_at: '2026-10-01T10:01:00Z', username: 'ali', detail: 'bozuk{' },
    ];
  };
  y.find = ldap.findLdapUserByUsername;
  ldap.findLdapUserByUsername = async (u) => {
    if (ldapHata) throw new Error(ldapHata);
    return ldapKullanici ? { username: u, mail: '', groups: ldapKullanici } : null;
  };
  y.explainVis = visibility.explainVisibility;
  visibility.explainVisibility = async () => ({ gorunur: true, sebep: 'varsayilan acik' });
  y.cluster = adminData.listClusterIndex;
  adminData.listClusterIndex = async () => [
    {
      env: 'prod',
      tenant: 'ark',
      cluster_name: 'c1',
      is_active: 1,
      api_url: 'https://a',
      vault_credential_key: 'k',
      terminal_host: null,
    },
    {
      env: 'prd',
      tenant: 'ark',
      cluster_name: 'c2',
      is_active: 1,
      api_url: '',
      vault_credential_key: null,
      terminal_host: 'b',
    },
    {
      env: 'test',
      tenant: 'ark',
      cluster_name: 'c3',
      is_active: 0,
      api_url: '',
      vault_credential_key: null,
      terminal_host: 'b',
    },
  ];
  y.suffix = adminData.listEnvSuffixMap;
  adminData.listEnvSuffixMap = async () => [
    { suffix: '', env_label: 'PROD' },
    { suffix: '-T', env_label: 'TEST' },
  ];

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (y.oturum) req.session = { user: y.oturum };
    next();
  });
  require('../index.cjs').initLogXv2(app);
  await new Promise((r) => {
    y.server = app.listen(0, '127.0.0.1', r);
  });
  y.base = `http://127.0.0.1:${y.server.address().port}`;
});

after(() => {
  db.query = y.query;
  audit.getLogs = y.getLogs;
  ldap.findLdapUserByUsername = y.find;
  visibility.explainVisibility = y.explainVis;
  adminData.listClusterIndex = y.cluster;
  adminData.listEnvSuffixMap = y.suffix;
  y.server && y.server.close();
});

function al(yol, user) {
  y.oturum = user;
  return new Promise((resolve, reject) => {
    http
      .get(`${y.base}/api/logx/v2${yol}`, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
      })
      .on('error', reject);
  });
}
const admin = { username: 'boss', role: 'Admin', authSource: 'ldap', groups: [] };
const kullanici = { username: 'ali', role: 'User', authSource: 'ldap', groups: [] };

test('Y1a aciklayici: ortam kurali REDDEDER, adimlar ve sebep doner (gruplar LDAP`tan)', async () => {
  ldapKullanici = ['CN=baska,OU=x'];
  ldapHata = null;
  const r = await al(
    '/manage/explain?username=veli&resourceType=ocp_namespace&resourceKey=ark/prod/c1/odeme',
    admin,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.kimlikKaynagi, 'ldap');
  assert.equal(r.body.kullanici.grupSayisi, 1);
  const adlar = r.body.adimlar.map((a) => a.ad);
  assert.deepEqual(adlar, ['LogX sayfa görünürlüğü', 'Ortam kuralı (PROD)', 'Kaynak kuralı']);
  const ortam = r.body.adimlar[1];
  assert.equal(ortam.izin, false);
  assert.match(ortam.aciklama, /PROD ortamı LogX'te kısıtlı/);
  assert.equal(r.body.adimlar[2].izin, true);
  assert.equal(r.body.sonuc, 'red');
});

test('Y1b aciklayici: LDAP grubu izinliyse IZIN', async () => {
  ldapKullanici = [PROD_GRUP];
  const r = await al('/manage/explain?username=veli&resourceType=env&resourceKey=prod', admin);
  assert.equal(r.body.sonuc, 'izin');
  assert.equal(r.body.adimlar.length, 2, 'ortam tipinde ayri kaynak adimi olmamali');
});

test('Y1c aciklayici: LDAP okunamazsa/bulunamazsa SOYLENIR (eksik veri kesin cevap gibi gorunmez)', async () => {
  ldapKullanici = null;
  const a = await al('/manage/explain?username=yok&resourceType=env&resourceKey=PROD', admin);
  assert.match(a.body.kimlikUyarisi, /LDAP'ta bulunamadı/);
  ldapHata = 'zaman asimi';
  const b = await al('/manage/explain?username=yok&resourceType=env&resourceKey=PROD', admin);
  assert.match(b.body.kimlikUyarisi, /LDAP okunamadı \(zaman asimi\)/);
  ldapHata = null;
});

test('Y1d aciklayici, red gunlugu, etiketler ve altyapi YALNIZCA Admin', async () => {
  for (const yol of [
    '/manage/explain?username=veli',
    '/manage/denials',
    '/manage/env-labels',
    '/manage/infra',
  ]) {
    const r = await al(yol, kullanici);
    assert.equal(r.status, 403, `${yol} admin-disina acik`);
  }
});

test('Y2 red gunlugu: v2_denied ayristirilir; bozuk detay dusurmez; kullanici suzgeci gider', async () => {
  const r = await al('/manage/denials?username=veli', admin);
  assert.equal(r.status, 200);
  assert.equal(y.sonGetLogs.action, 'v2_denied');
  assert.equal(y.sonGetLogs.username, 'veli');
  assert.deepEqual(r.body.denials[0], {
    id: 7,
    at: '2026-10-01T10:00:00Z',
    username: 'veli',
    resourceType: 'env',
    resourceKey: 'PROD',
    route: 'POST /api/logx/v2/ocp/r1/select',
  });
  assert.equal(r.body.denials[1].resourceKey, null);
});

test('Y3 ortam etiketleri: iki kaynak yan yana, BUYUK harf, kaynaklariyla', async () => {
  const r = await al('/manage/env-labels', admin);
  assert.deepEqual(r.body.labels, [
    { label: 'PRD', sources: ['ocp'] },
    { label: 'PROD', sources: ['legacy', 'ocp'] },
    { label: 'TEST', sources: ['legacy', 'ocp'] },
  ]);
});

test('Y4 altyapi: eksik kimlik alanlari; bastion yedegi EKSIK sayilmaz', async () => {
  const r = await al('/manage/infra', admin);
  const c1 = r.body.clusters.find((c) => c.cluster === 'c1');
  const c2 = r.body.clusters.find((c) => c.cluster === 'c2');
  assert.deepEqual(c1.eksik, []);
  assert.equal(c1.notlar.length, 1, 'bastion notu');
  assert.deepEqual(c2.eksik, ['api_url', 'vault anahtarı']);
  assert.equal(r.body.clusters.find((c) => c.cluster === 'c3').active, false);
});
