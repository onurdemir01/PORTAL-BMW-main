// server/ansible/__tests__/awx-sunucu-devre-disi.test.cjs
//
// AWX sunucusunu devre disi birakma (2026-10-26). Kullanici: "maestro 1'e olan baglantiyi
// kapatmak istiyorum ... Ansible info'da bunu kaldiramiyorum ... 2-3 yilda bir."
//   AD1 ozet temiz: engel / uyari yok, kapatilabilir
//   AD2 her engel sayilir ve kapatmayi engeller
//   AD3 okunamayan sorgu SIFIR sayilmaz: kapatilabilir DEGIL
//   AD4 uyarilar: Self Servis, Playbook Kayitlari, (#1 icin) sunucusuz kayit, *_AWX_SERVER_ID, AWX_URL
//   AD5 sorgular parametreli (sunucu numarasi SQL metnine yazilmaz)
//   AD6 runner: kapali sunucu listede yok, env'den DIRILMEZ, "devre disi" der, sirri maskelenir
//   AD7 uclar: admin; son etkin sunucu kapatilmaz; ozet UPDATE'ten once; satir silinmez; restart'siz
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { bagimlilikOzeti, _ENGELLER } = require('../awx-sunucu-bagimlilik.cjs');

function sahteDb(cevap) {
  const sorgular = [];
  return {
    sorgular,
    query: async (sql, params) => {
      sorgular.push({ sql, params });
      return cevap(sql, params);
    },
  };
}
const bos = () => ({ rows: [{ n: 0 }] });

test('AD1 ozet temiz: kapatilabilir', async () => {
  const db = sahteDb((sql) => (/COUNT|CASE WHEN/.test(sql) ? bos() : { rows: [] }));
  const o = await bagimlilikOzeti(2, { db, env: {}, sunucuUrl: 'https://maestro2.fw' });
  assert.deepEqual(o.engeller, []);
  assert.deepEqual(o.uyarilar, []);
  assert.deepEqual(o.okunamayan, []);
  assert.equal(o.kapatilabilir, true);
});

test('AD2 her engel sayilir ve kapatmayi engeller', async () => {
  for (const e of _ENGELLER) {
    const db = sahteDb((sql) => (sql === e.sql ? { rows: [{ n: 3 }] } : /COUNT|CASE WHEN/.test(sql) ? bos() : { rows: [] }));
    const o = await bagimlilikOzeti(1, { db, env: {} });
    assert.equal(o.kapatilabilir, false, e.anahtar);
    assert.deepEqual(o.engeller.map((x) => [x.anahtar, x.adet]), [[e.anahtar, 3]]);
  }
  const anahtarlar = _ENGELLER.map((e) => e.anahtar).sort();
  assert.deepEqual(anahtarlar, ['kilit', 'logx', 'oco', 'opsx', 'retirement', 'scalex', 'smart']);
  const oco = _ENGELLER.find((e) => e.anahtar === 'oco').sql;
  assert.match(oco, /'AWX_SCHEDULED'/, 'maestro nun kendi zamanlamasi engel sayilmiyor');
});

test('AD3 okunamayan sorgu sifir sayilmaz', async () => {
  const db = sahteDb((sql) => {
    if (/smart_tickets/.test(sql)) throw new Error("Invalid object name 'smart_tickets'");
    return /COUNT|CASE WHEN/.test(sql) ? bos() : { rows: [] };
  });
  const o = await bagimlilikOzeti(1, { db, env: {} });
  assert.deepEqual(o.engeller, []);
  assert.equal(o.okunamayan.length, 1);
  assert.match(o.okunamayan[0].hata, /smart_tickets/);
  assert.equal(o.kapatilabilir, false);
});

test('AD4 uyarilar', async () => {
  const db = sahteDb((sql) => {
    if (/FROM ansible_ss_items/.test(sql)) return { rows: [{ title: 'Nginx - RVP Operations' }] };
    if (/awx_server_id IS NULL/.test(sql)) return { rows: [{ key_name: 'logx_legacy_discovery' }] };
    if (/FROM ansible_playbook_registry WHERE enabled = 1 AND awx_server_id = \$1/.test(sql))
      return { rows: [{ key_name: 'opsx_was_restart' }] };
    return bos();
  });
  const env = { AWX_LOGX_SERVER_ID: '1', OPSX_AWX_SERVER_ID: '2', SCALEX_AWX_SERVER_ID: ' 1 ', AWX_URL: 'https://MAESTRO.fwgaranti.com.tr/' };
  const o = await bagimlilikOzeti(1, { db, env, sunucuUrl: 'https://maestro.fwgaranti.com.tr' });
  const k = Object.fromEntries(o.uyarilar.map((u) => [u.anahtar, u]));
  assert.deepEqual(k.ss.ornekler, ['Nginx - RVP Operations']);
  assert.deepEqual(k.kayit.ornekler, ['opsx_was_restart']);
  assert.deepEqual(k.kayit_bos.ornekler, ['logx_legacy_discovery']);
  assert.deepEqual(k.env.ornekler, ['AWX_LOGX_SERVER_ID', 'SCALEX_AWX_SERVER_ID']);
  assert.ok(k.awx_url, 'eski AWX_URL ayni sunucuyu gosterdigi halde uyari yok');
  assert.equal(o.kapatilabilir, true, 'uyari kapatmayi engellememeli');

  // #1 disi sunucuda sunucusuz kayit uyarisi yok; AWX_URL baska sunucudaysa uyari yok
  const o2 = await bagimlilikOzeti(2, { db, env, sunucuUrl: 'https://maestro2.fwgaranti.com.tr' });
  assert.equal(o2.uyarilar.some((u) => u.anahtar === 'kayit_bos'), false);
  assert.equal(o2.uyarilar.some((u) => u.anahtar === 'awx_url'), false);
});

test('AD5 sorgular parametreli', async () => {
  const db = sahteDb((sql) => (/COUNT|CASE WHEN/.test(sql) ? bos() : { rows: [] }));
  await bagimlilikOzeti(7, { db, env: {} });
  assert.ok(db.sorgular.length >= _ENGELLER.length + 2);
  for (const q of db.sorgular) {
    assert.deepEqual(q.params, [7]);
    assert.doesNotMatch(q.sql, /\b7\b/, `numara SQL metnine yazildi: ${q.sql}`);
  }
});

test('AD6 runner: kapali sunucu listede yok, env den dirilmez, devre disi der, sirri maskelenir', async () => {
  for (const no of [1, 2]) {
    process.env[`AWX_${no}_URL`] = `https://maestro${no}.ornek.test`;
    process.env[`AWX_${no}_TOKEN`] = `env-token-${no}-uzun`;
  }
  let satirlar = [
    { server_no: 1, name: 'maestro', url: 'https://maestro1.ornek.test', enabled: false, token: 'db-sir-maestro1-xyz' },
    { server_no: 2, name: 'maestro2', url: 'https://maestro2.ornek.test', enabled: true, token: 'db-sir-maestro2-xyz' },
  ];
  const dbYol = require.resolve('../../db/index.cjs');
  require.cache[dbYol] = {
    id: dbYol,
    filename: dbYol,
    loaded: true,
    exports: { query: async (sql) => (/FROM ansible_awx_servers/.test(sql) ? { rows: satirlar } : { rows: [] }) },
  };
  const runner = require('../runner.cjs');
  assert.equal(await runner._loadAwxServers(), true);
  assert.deepEqual(runner.getServers().map((s) => s.id), [2]);
  assert.equal(runner.getServerById(1), null);
  const h = runner._sunucuYokHatasi(1);
  assert.equal(h.code, 'awx_server_missing');
  assert.match(h.message, /#1 \(maestro\) devre dışı/);
  assert.equal(runner._sunucuYokHatasi(5).message, 'AWX sunucusu bulunamadı.');
  assert.equal(runner.redactSecrets('cikti db-sir-maestro1-xyz env-token-1-uzun'), 'cikti *** ***');
  await assert.rejects(runner.launchJobOnServer(1, 10, {}), (e) => e.code === 'awx_server_missing' && /devre dışı/.test(e.message));

  // DB'de etkin satir kalmazsa env fallback'e donulur ama kapatilan #1 geri gelmez
  satirlar = [satirlar[0], { ...satirlar[1], enabled: false }];
  await runner._loadAwxServers();
  assert.deepEqual(runner.getServers().map((s) => s.id), [], 'kapatilan sunucu env den dirildi');
});

test('AD7 uclar', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  assert.match(s, /app\.get\('\/api\/ansible\/awx-servers\/yonetim', requireAuth, requireAdmin,/);
  assert.match(s, /app\.get\('\/api\/ansible\/awx-servers\/:no\/bagimlilik', requireAuth, requireAdmin,/);
  assert.match(s, /app\.post\('\/api\/ansible\/awx-servers\/:no\/durum', requireAuth, requireAdmin,/);
  const i = s.indexOf("app.post('/api/ansible/awx-servers/:no/durum'");
  const b = s.slice(i, i + 4000);
  const sonEtkin = b.indexOf('Son etkin AWX sunucusu');
  const ozet = b.indexOf('ozet.kapatilabilir');
  const guncelle = b.indexOf('UPDATE ansible_awx_servers SET enabled');
  assert.ok(sonEtkin > 0 && ozet > sonEtkin && guncelle > ozet, 'kontroller UPDATE ten once degil');
  assert.match(
    b,
    /if \(!etkin\.some\(\(r\) => Number\(r\.server_no\) !== no\)\) \{\s*return res\.status\(409\)/,
    'son etkin sunucu kosulu yok ya da reddetmiyor',
  );
  assert.match(b, /if \(!ozet\.kapatilabilir\) \{\s*return res\.status\(409\)/);
  assert.match(b.slice(guncelle), /_serverTokenCaches\.delete\(no\)[\s\S]*await loadAwxServers\(\)/);
  assert.doesNotMatch(b, /DELETE FROM ansible_awx_servers/);
  const y = s.indexOf("app.get('/api/ansible/awx-servers/yonetim'");
  assert.doesNotMatch(s.slice(y, y + 900), /token|password|client_secret/, 'liste ucu sir kolonu okuyor');
});
