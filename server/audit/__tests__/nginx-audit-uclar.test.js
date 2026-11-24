// server/audit/__tests__/nginx-audit-uclar.test.js - Denetim > Nginx Audit, Proxy, API ve Upstream envanteri
// uclari gercek express ile (2026-11-24, kapsam PR-2). Sahte olan: dis DB (Nginx_Audit_*, Nginx_Config_Audit,
// NginxRateLimitInventory, nginx_inventory), Portal DB (istisna / kabul edilen deger), kimlik.
//   NA1 /nginx-audit: tablo yok (sema hazir degil) / tarama yok / dolu; dosya tablosu yoksa filesReady=false
//   NA2 /nginx-audit/host/:h: gecersiz ad 400; sunucu ayrintisi yalniz o sunucuyu SQL'de suzer
//   NA3 kabul edilen degerler: liste; Admin disi yazamaz; direktif / deger dogrulamasi; ayni deger tekrar yazilmaz; sil
//   NA4 sunucu istisnasi: Admin disi 403; ad / not dogrulamasi; ekle / guncelle / sil + denetim kaydi; DB hatasi 503
//   NA5 /nginx-proxy: sema hazir degil nedeni soyler; tarama yok; dolu yanit aynalanan tanimi tekillestirir
//   NA6 /nginx-api: tarama yok bos sekil; dolu ozet ve tarih listesi; DB hatasi 503
//   NA7 /nginx-upstreams: tablo yok / tarama yok; ozet; ?host ayrintisi; ?ara (kisa 400, LIKE kacisi); ?liste=1
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const KOK = path.join(__dirname, '..', '..');
const sahte = (rel, exports) => {
  const yol = path.join(KOK, rel);
  require.cache[Module._resolveFilename(yol, module)] = {
    id: yol,
    filename: yol,
    loaded: true,
    exports,
  };
};

const SCAN = '2026-11-20';
const D = {
  auditYok: false,
  auditTarih: SCAN,
  dosyaYok: false,
  proxyKolon: 4,
  proxyTarih: SCAN,
  apiTarih: SCAN,
  apiHata: null,
  upsServers: true,
  sorgular: [],
};
const AUDIT = {
  hosts: [
    { host: 'ORNGXP01', status: 'OK', files: 3, server_blocks: 2, locations: 5, upstreams: 2 },
    { host: 'ORNGXT02', status: 'OK', files: 1, server_blocks: 1, locations: 1, upstreams: 1 },
  ],
  servers: [{ host: 'ORNGXP01', conf_file: '/etc/nginx/conf.d/a.conf', seq: 1, listen: '443 ssl' }],
  locations: [
    {
      host: 'ORNGXP01',
      conf_file: '/etc/nginx/conf.d/a.conf',
      srv_seq: 1,
      location: '/api/',
      proxy_target: 'ups_a',
      target_kind: 'upstream',
    },
  ],
  upstreams: [
    {
      host: 'ORNGXP01',
      conf_file: '/etc/nginx/conf.d/a.conf',
      name: 'ups_a',
      server: '10.0.0.1:8443',
      servers: '10.0.0.1:8443,10.0.0.2:8443',
      resolve: 1,
      keepalive: 1,
      zone: 1,
      used: 1,
    },
  ],
  settings: [
    {
      host: 'ORNGXP01',
      conf_file: 'nginx.conf',
      context: 'http',
      directive: 'client_max_body_size',
      value: '50m',
      reference_value: '10m',
      matches: 0,
    },
  ],
};

const disDb = async (q, params = []) => {
  const s = String(q).replace(/\s+/g, ' ');
  D.sorgular.push({ s, params });
  const p = Object.fromEntries((params || []).map((x) => [x.name, x.value]));
  const hostSuz = (rows) => (p.host ? rows.filter((r) => r.host === p.host) : rows);
  if (s.includes('MAX(scan_date), 23) AS d FROM dbo.Nginx_Audit_Hosts')) {
    if (D.auditYok)
      throw Object.assign(new Error("Invalid object name 'dbo.Nginx_Audit_Hosts'"), {
        number: 208,
      });
    return { recordset: [{ d: D.auditTarih }] };
  }
  if (s.includes('FROM dbo.Nginx_Audit_Files')) {
    if (D.dosyaYok) throw new Error('Invalid object name');
    return { recordset: [] };
  }
  if (s.includes('FROM dbo.Inventory')) return { recordset: [{ host: 'ORNGXT02', env: 'TEST' }] };
  if (s.includes('FROM dbo.Nginx_Audit_Hosts') && s.includes('settings_mismatch'))
    return { recordset: hostSuz(AUDIT.hosts) };
  if (s.includes('seq, listen, server_name, ssl')) return { recordset: hostSuz(AUDIT.servers) };
  if (s.includes('srv_seq, location, behaviour')) return { recordset: hostSuz(AUDIT.locations) };
  if (s.includes('name, server, resolve, keepalive, zone, used FROM dbo.Nginx_Audit_Upstreams'))
    return { recordset: hostSuz(AUDIT.upstreams) };
  if (s.includes('FROM dbo.Nginx_Audit_Settings')) return { recordset: hostSuz(AUDIT.settings) };
  // scanStamp ve degisim belirtecleri
  if (/MAX\(scanned_at\)|MAX\(id\)/.test(s)) return { recordset: [{}] };
  // Proxy
  if (s.includes('FROM sys.columns')) return { recordset: [{ n: D.proxyKolon }] };
  if (s.includes("FROM dbo.Nginx_Config_Audit WHERE kind = 'proxy'"))
    return { recordset: [{ d: D.proxyTarih }] };
  if (s.includes('CAST(@d AS DATE)')) return { recordset: [{ d: p.d }] };
  if (s.includes("FROM dbo.Nginx_Config_Audit WHERE scan_date = @d AND kind = 'proxy'"))
    return {
      recordset: ['ORNGXP01', 'ORNGXP02'].flatMap((host) => [
        {
          service: 'GLOMO',
          env: 'prod',
          host,
          vhost: 'GLOMO-PROD',
          location_path: '/kart/',
          upstream_name: 'kart_ups',
          target_url: 'https://kart.ornek.invalid',
          upstream_defined: 1,
          in_ocp_inventory: 1,
          status: 'OK',
        },
        {
          service: 'GLOMO',
          env: 'prod',
          host,
          vhost: 'GLOMO-PROD',
          location_path: '/eski/',
          upstream_name: 'eski_ups',
          target_url: 'https://eski-test.ornek.invalid',
          upstream_defined: 0,
          in_ocp_inventory: 0,
          status: 'NON_PROD_TARGET',
        },
      ]),
    };
  // API
  if (s.includes('MAX(scan_date), 23) AS d FROM dbo.NginxRateLimitInventory')) {
    if (D.apiHata) throw D.apiHata;
    return { recordset: [{ d: D.apiTarih }] };
  }
  if (s.includes('GROUP BY host, config_file'))
    return {
      recordset: [
        {
          host: 'ORNGXP01',
          config_file: 'a.conf',
          locations: 4,
          no_limit: 1,
          ip_limited: 3,
          srv_limited: 0,
        },
      ],
    };
  if (s.includes('SELECT DISTINCT CONVERT(varchar(10), scan_date, 23) AS d'))
    return { recordset: [{ d: SCAN }, { d: '2026-11-13' }] };
  if (s.includes('WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Servers)'))
    return {
      recordset: [{ host: 'ORNGXP01', conf_file: 'a.conf', server_name: 'kart.ornek.invalid' }],
    };
  // Upstream envanteri
  if (s.includes("COL_LENGTH('dbo.Nginx_Audit_Upstreams', 'servers')"))
    return { recordset: [{ s: D.upsServers ? 1 : null, h: null, k: null }] };
  if (s.includes('FROM dbo.nginx_inventory')) throw new Error('izin yok');
  if (s.includes('conf_file, name, server,') && s.includes('AND host = @host'))
    return { recordset: hostSuz(AUDIT.upstreams) };
  if (s.includes('conf_file, srv_seq, location, proxy_target, target_kind'))
    return { recordset: hostSuz(AUDIT.locations) };
  if (s.includes('SELECT seq, server_name, conf_file FROM dbo.Nginx_Audit_Servers'))
    return { recordset: [{ seq: 1, server_name: 'kart.ornek.invalid', conf_file: 'a.conf' }] };
  if (s.includes('SELECT DISTINCT l.host, s.server_name'))
    return {
      recordset: [
        {
          host: 'ORNGXP01',
          server_name: 'kart.ornek.invalid',
          upstream: 'ups_a',
          server: '10.0.0.1:8443',
          servers: '10.0.0.1:8443,10.0.0.2:8443',
          http2: null,
          http2_source: null,
          listen: '443 ssl',
        },
      ],
    };
  if (s.includes('SELECT TOP (2000) host, name, server,'))
    return {
      recordset: [
        {
          host: 'ORNGXP01',
          name: 'ups_a',
          server: '10.0.0.1:8443',
          servers: '10.0.0.1:8443',
          used: 1,
        },
      ],
    };
  if (s.includes('SELECT host, status FROM dbo.Nginx_Audit_Hosts'))
    return { recordset: AUDIT.hosts };
  if (s.includes('SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) AS kullanilan'))
    return {
      recordset: [{ host: 'ORNGXP01', n: 2, kullanilan: 1, resolve_yok: 0, keepalive_yok: 1 }],
    };
  if (s.includes('SELECT host, target_kind, COUNT(*) AS n'))
    return { recordset: [{ host: 'ORNGXP01', target_kind: 'upstream', n: 3 }] };
  if (s.includes('SELECT DISTINCT host, listen FROM dbo.Nginx_Audit_Servers'))
    return { recordset: [{ host: 'ORNGXP01', listen: '10.1.1.5:443 ssl' }] };
  return { recordset: [] };
};

const P = { istisna: [], kabul: [], yazim: [], hata: null };
const portalDb = {
  query: async (q, params = []) => {
    const s = String(q);
    if (P.hata && P.hata.test(s)) throw new Error('portal db hatasi');
    if (/^SELECT id, directive, value/.test(s)) return { rows: P.kabul };
    if (/^SELECT host, note, created_by/.test(s)) return { rows: P.istisna };
    if (/^SELECT 1 FROM nginx_audit_allowed_values/.test(s))
      return { rows: P.kabul.filter((k) => k.directive === params[0] && k.value === params[1]) };
    if (/^SELECT 1 FROM nginx_audit_exceptions/.test(s))
      return { rows: P.istisna.filter((k) => k.host === params[0]) };
    P.yazim.push({ s, params });
    return { rows: [], rowCount: 1 };
  },
};
const denetimKaydi = [];

let _srv = null;
async function sunucu() {
  if (_srv) return _srv;
  sahte('auth/index.cjs', {
    requireAuth: (req, res, next) => {
      req.user = {
        username: req.headers['x-kim'] || 'ornek',
        role: req.headers['x-rol'] || 'User',
      };
      req.session = { user: req.user };
      next();
    },
    requireAdmin: (req, res, next) =>
      req.user?.role === 'Admin'
        ? next()
        : res.status(403).json({ ok: false, message: 'Yetki yok.' }),
    getRequestUser: (req) => req.user,
  });
  sahte('auth/visibility.cjs', {});
  sahte('inventory/mssql.cjs', {
    query: disDb,
    queryLong: disDb,
    sql: new Proxy({}, { get: () => () => 'tip' }),
  });
  sahte('db/index.cjs', portalDb);
  sahte('audit/index.cjs', { auditPortal: (req, olay, ek) => denetimKaydi.push({ olay, ek }) });
  sahte('nginx-console/eski-sunucu.cjs', {
    onTemizlik: () => {},
    suzgec: async () => ({
      damga: '',
      eskiMi: () => false,
      ayir: (rows) => rows,
      bilgi: () => ({ sayi: 0, hostlar: [] }),
    }),
  });
  const { initDenetim } = require('../denetim.cjs');
  const app = express();
  initDenetim(app);
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  _srv = { s, base: `http://127.0.0.1:${s.address().port}/api/denetim` };
  return _srv;
}
after(() => _srv && _srv.s.close());

async function istek(yol, { rol = 'User', method = 'GET', body } = {}) {
  const { base } = await sunucu();
  const ek = method === 'GET' ? `${yol.includes('?') ? '&' : '?'}fresh=1` : '';
  const r = await fetch(`${base}${yol}${ek}`, {
    method,
    headers: {
      'x-rol': rol,
      'x-kim': 'adm1',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

test('NA1 /nginx-audit: tablo yok, tarama yok, dolu', async () => {
  D.auditYok = true;
  let r = await istek('/nginx-audit');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.schemaReady, false);
  assert.deepEqual(r.body.hosts, []);
  D.auditYok = false;
  D.auditTarih = null;
  r = await istek('/nginx-audit');
  assert.equal(r.body.schemaReady, true);
  assert.equal(r.body.scanDate, null);
  D.auditTarih = SCAN;
  D.dosyaYok = true;
  P.istisna = [{ host: 'ORNGXT02', note: 'devreden cikiyor', created_by: 'adm1' }];
  r = await istek('/nginx-audit');
  D.dosyaYok = false;
  P.istisna = [];
  assert.equal(r.body.scanDate, SCAN);
  assert.equal(r.body.filesReady, false, 'dosya tablosu yokken hazir dendi');
  assert.deepEqual(r.body.hosts.map((h) => h.host).sort(), ['ORNGXP01', 'ORNGXT02']);
  assert.ok(r.body.hosts.find((h) => h.host === 'ORNGXT02').exception, 'istisna yansimadi');
  assert.ok(r.body.totals);
});

test('NA2 /nginx-audit/host/:h: dogrulama ve tek sunucu', async () => {
  assert.equal((await istek('/nginx-audit/host/kotu%20ad')).status, 400);
  D.sorgular = [];
  const r = await istek('/nginx-audit/host/orngxp01');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.host.host, 'ORNGXP01');
  const ayar = D.sorgular.find((q) => q.s.includes('FROM dbo.Nginx_Audit_Settings'));
  assert.match(ayar.s, /AND host = @host/, 'tek sunucu SQL de suzulmeli');
  const yok = await istek('/nginx-audit/host/ORNGXP77');
  assert.equal(yok.body.host, null);
});

test('NA3 kabul edilen degerler: liste, yetki, dogrulama, tekrar yazmama, sil', async () => {
  P.kabul = [{ id: 1, directive: 'client_max_body_size', value: '50m' }];
  let r = await istek('/nginx-audit/allowed');
  assert.deepEqual(r.body.rows, P.kabul);
  const govde = { directive: 'Client_Max_Body_Size', value: '100m', note: 'kurum karari' };
  assert.equal((await istek('/nginx-audit/allowed', { method: 'PUT', body: govde })).status, 403);
  for (const [b, re] of [
    [{ directive: '1kotu', value: 'x' }, /Direktif adı geçersiz/],
    [{ directive: 'gzip', value: '' }, /Değer zorunlu/],
    [{ directive: 'gzip', value: 'x'.repeat(257) }, /Değer zorunlu/],
  ]) {
    r = await istek('/nginx-audit/allowed', { rol: 'Admin', method: 'PUT', body: b });
    assert.equal(r.status, 400);
    assert.match(r.body.message, re);
  }
  P.yazim = [];
  r = await istek('/nginx-audit/allowed', { rol: 'Admin', method: 'PUT', body: govde });
  assert.equal(r.status, 200);
  assert.deepEqual(P.yazim[0].params, ['client_max_body_size', '100m', 'kurum karari', 'adm1']);
  P.yazim = [];
  await istek('/nginx-audit/allowed', {
    rol: 'Admin',
    method: 'PUT',
    body: { directive: 'client_max_body_size', value: '50m' },
  });
  assert.equal(P.yazim.length, 0, 'ayni deger ikinci kez yazildi');
  assert.equal(
    (await istek('/nginx-audit/allowed/0', { rol: 'Admin', method: 'DELETE' })).status,
    400,
  );
  r = await istek('/nginx-audit/allowed/1', { rol: 'Admin', method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual(P.yazim.at(-1).params, [1]);
  P.hata = /nginx_audit_allowed_values/;
  assert.equal((await istek('/nginx-audit/allowed')).status, 500);
  P.hata = null;
});

test('NA4 sunucu istisnasi: yetki, dogrulama, ekle / guncelle / sil, denetim kaydi', async () => {
  assert.equal(
    (await istek('/nginx-audit/exceptions/ORNGXP01', { method: 'PUT', body: { note: 'n' } }))
      .status,
    403,
  );
  let r = await istek('/nginx-audit/exceptions/kotu%20ad', {
    rol: 'Admin',
    method: 'PUT',
    body: { note: 'n' },
  });
  assert.equal(r.status, 400);
  r = await istek('/nginx-audit/exceptions/ORNGXP01', {
    rol: 'Admin',
    method: 'PUT',
    body: { note: ' ' },
  });
  assert.match(r.body.message, /İstisna notu zorunlu/);
  P.yazim = [];
  P.istisna = [];
  r = await istek('/nginx-audit/exceptions/orngxp01', {
    rol: 'Admin',
    method: 'PUT',
    body: { note: 'gecis suruyor' },
  });
  assert.deepEqual(r.body, { ok: true, host: 'ORNGXP01', note: 'gecis suruyor', by: 'adm1' });
  assert.match(P.yazim[0].s, /^INSERT INTO nginx_audit_exceptions/);
  assert.equal(denetimKaydi.at(-1).olay, 'nginx_audit_exception_set');
  P.istisna = [{ host: 'ORNGXP01', note: 'eski' }];
  P.yazim = [];
  await istek('/nginx-audit/exceptions/ORNGXP01', {
    rol: 'Admin',
    method: 'PUT',
    body: { note: 'yeni' },
  });
  assert.match(P.yazim[0].s, /^UPDATE nginx_audit_exceptions/);
  r = await istek('/nginx-audit/exceptions/ORNGXP01', { rol: 'Admin', method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(denetimKaydi.at(-1).olay, 'nginx_audit_exception_clear');
  assert.equal(
    (await istek('/nginx-audit/exceptions/kotu%20ad', { rol: 'Admin', method: 'DELETE' })).status,
    400,
  );
  P.hata = /nginx_audit_exceptions/;
  assert.equal(
    (
      await istek('/nginx-audit/exceptions/ORNGXP01', {
        rol: 'Admin',
        method: 'PUT',
        body: { note: 'n' },
      })
    ).status,
    503,
  );
  assert.equal(
    (await istek('/nginx-audit/exceptions/ORNGXP01', { rol: 'Admin', method: 'DELETE' })).status,
    503,
  );
  P.hata = null;
  P.istisna = [];
});

test('NA5 /nginx-proxy: sema hazir degil, tarama yok, tekillestirilmis dolu yanit', async (t) => {
  D.proxyKolon = 2;
  let r = await istek('/nginx-proxy');
  assert.equal(r.body.schemaReady, false, 'eksik kolonda "tanim yok" dendi');
  assert.deepEqual(r.body.rows, []);
  // Kolon denetimi 60 sn onbellekli: saat ileri alinir, sema hazir.
  D.proxyKolon = 4;
  const gercek = Date.now;
  t.mock.method(Date, 'now', () => gercek() + 61_000);
  D.proxyTarih = null;
  r = await istek('/nginx-proxy');
  assert.equal(r.body.schemaReady, true);
  assert.equal(r.body.scanDate, null);
  assert.equal(r.body.totals.rows, 0);
  D.proxyTarih = SCAN;
  r = await istek('/nginx-proxy');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.scanDate, SCAN);
  assert.equal(r.body.rows.length, 2, 'iki sunucuda aynalanan tanim tekillesmedi');
  const kart = r.body.rows.find((x) => x.locationPath === '/kart/');
  assert.deepEqual(kart.hosts, ['ORNGXP01', 'ORNGXP02']);
  assert.equal(kart.env, 'PROD');
  assert.equal(kart.upstreamDefined, true);
  assert.deepEqual(r.body.totals, {
    rows: 2,
    vhosts: 1,
    hosts: 2,
    nonProdTarget: 1,
    undefinedUpstream: 1,
  });
  assert.deepEqual(r.body.envs, ['PROD']);
  assert.deepEqual(r.body.services, ['GLOMO']);
  r = await istek('/nginx-proxy?scanDate=2026-11-13');
  assert.equal(r.body.scanDate, '2026-11-13');
});

test('NA6 /nginx-api: tarama yok, dolu ozet, hata 503', async () => {
  D.apiTarih = null;
  let r = await istek('/nginx-api');
  assert.equal(r.body.scanDate, null);
  assert.deepEqual(r.body.availableDates, []);
  D.apiTarih = SCAN;
  r = await istek('/nginx-api');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.scanDate, SCAN);
  assert.deepEqual(r.body.availableDates, [SCAN, '2026-11-13']);
  r = await istek('/nginx-api?scanDate=2026-11-13');
  assert.equal(r.body.scanDate, '2026-11-13');
  D.apiHata = new Error('zaman asimi');
  r = await istek('/nginx-api');
  D.apiHata = null;
  assert.equal(r.status, 503);
  assert.equal(r.body.message, 'zaman asimi');
});

test('NA7 /nginx-upstreams: hazir degil, ozet, ayrinti, arama, liste', async () => {
  D.auditYok = true;
  let r = await istek('/nginx-upstreams');
  assert.deepEqual(r.body, { ok: true, hazir: false, neden: 'tablo' });
  D.auditYok = false;
  D.auditTarih = null;
  r = await istek('/nginx-upstreams');
  assert.deepEqual(r.body, { ok: true, hazir: false, neden: 'tarama' });
  D.auditTarih = SCAN;

  r = await istek('/nginx-upstreams');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.hazir, true);
  assert.equal(r.body.serversOlculdu, true);
  const h1 = r.body.hosts.find((h) => h.host === 'ORNGXP01');
  assert.equal(h1.upstream, 2);
  assert.equal(h1.kullanilmayan, 1);

  r = await istek('/nginx-upstreams?host=orngxp01');
  assert.equal(r.body.host, 'ORNGXP01');
  assert.equal(r.body.hazir, true);

  r = await istek('/nginx-upstreams?ara=a');
  assert.equal(r.status, 400);
  D.sorgular = [];
  r = await istek('/nginx-upstreams?ara=' + encodeURIComponent('10_0%'));
  assert.equal(r.status, 200);
  assert.equal(r.body.kesildi, false);
  const arama = D.sorgular.find((q) => q.s.includes('SELECT TOP (2000)'));
  assert.equal(arama.params.find((x) => x.name === 'ara').value, '%10[_]0[%]%', 'LIKE kacisi');
  assert.match(arama.s, /OR servers LIKE @ara/);

  D.upsServers = false;
  r = await istek('/nginx-upstreams?liste=1');
  D.upsServers = true;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.serversOlculdu, false);
  assert.equal(r.body.agOlculdu, false, 'nginx_inventory okunamadi ama ag olculdu dendi');
  assert.ok(Array.isArray(r.body.satirlar));
});
