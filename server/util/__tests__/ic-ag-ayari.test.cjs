// server/util/__tests__/ic-ag-ayari.test.cjs — ic ag adresleri ayarda, kodda degil (2026-11-15).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rvpAltAglari, webAppDnsSunuculari } = require('../ic-ag-ayari.cjs');

const KOK = path.join(__dirname, '..', '..', '..');

test('IA1 alt aglar: gecerli CIDR alinir, bozuk girdi atilir ve sebep soylenir', () => {
  assert.deepEqual(rvpAltAglari({}), { altAglar: {}, hata: 'NGINX_RVP_ALT_AGLARI tanimli degil' });
  assert.deepEqual(rvpAltAglari({ NGINX_RVP_ALT_AGLARI: '{bozuk' }), {
    altAglar: {},
    hata: 'NGINX_RVP_ALT_AGLARI gecerli bir JSON nesnesi degil',
  });
  assert.deepEqual(rvpAltAglari({ NGINX_RVP_ALT_AGLARI: '[]' }).altAglar, {});
  const r = rvpAltAglari({
    NGINX_RVP_ALT_AGLARI: JSON.stringify({
      gbngxd02: '192.0.2.0/24',
      GBNGXT34: '198.51.100.0/23',
      KOTU1: '300.1.1.0/24',
      KOTU2: '192.0.2.0/33',
      KOTU3: '192.0.2.0',
      'ad bosluklu': '192.0.2.0/24',
    }),
  });
  assert.deepEqual(r.altAglar, { GBNGXD02: '192.0.2.0/24', GBNGXT34: '198.51.100.0/23' });
  assert.equal(r.hata, 'NGINX_RVP_ALT_AGLARI: 4 gecersiz girdi atildi');
});

test('IA2 DNS sunuculari: bolge > site > IPv4 listesi; bozuk site / IP atilir', () => {
  assert.deepEqual(webAppDnsSunuculari({}), {
    bolgeler: {},
    hata: 'WEB_APP_DNS_SUNUCULARI tanimli degil',
  });
  const r = webAppDnsSunuculari({
    WEB_APP_DNS_SUNUCULARI: JSON.stringify({
      gtdmz: { Pendik: ['192.0.2.22', 'x'], Ankara: ['198.51.100.22'] },
      fw: { Pendik: [], Ankara: '198.51.100.1' },
      bos: [],
    }),
  });
  assert.deepEqual(r.bolgeler, { gtdmz: { Pendik: ['192.0.2.22'], Ankara: ['198.51.100.22'] } });
  assert.equal(r.hata, 'WEB_APP_DNS_SUNUCULARI: 3 gecersiz girdi atildi');
});

test('IA3 kurum ic ag adresleri kodda yok (belge araliklari haric)', () => {
  // RFC 5737 belge araliklari ve geri donus adresi serbest; digerleri ayara tasindi.
  const SERBEST = /^(?:192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|127\.|0\.0\.0\.0)/;
  for (const f of ['src/components/nginx_console/rvpSecim.ts', 'server/audit/web-app.cjs']) {
    const ipler =
      fs.readFileSync(path.join(KOK, f), 'utf8').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
    const kalan = ipler.filter((ip) => !SERBEST.test(ip));
    assert.deepEqual(kalan, [], `${f}: kodda ic ag adresi var`);
  }
});

test('IA4 ayar her cagrida okunur (Admin degisikligi yeniden baslatma istemez)', () => {
  const eski = process.env.NGINX_RVP_ALT_AGLARI;
  try {
    process.env.NGINX_RVP_ALT_AGLARI = JSON.stringify({ A1: '192.0.2.0/24' });
    assert.deepEqual(rvpAltAglari().altAglar, { A1: '192.0.2.0/24' });
    process.env.NGINX_RVP_ALT_AGLARI = JSON.stringify({ A1: '198.51.100.0/24' });
    assert.deepEqual(rvpAltAglari().altAglar, { A1: '198.51.100.0/24' });
  } finally {
    if (eski === undefined) delete process.env.NGINX_RVP_ALT_AGLARI;
    else process.env.NGINX_RVP_ALT_AGLARI = eski;
  }
});
