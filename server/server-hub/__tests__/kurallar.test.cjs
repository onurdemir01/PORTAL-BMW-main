// server/server-hub/__tests__/kurallar.test.cjs - Server Hub > Kurallar & Limitler (2026-10-20).
//
// Kullanici: "hangi maddeler taraniyor ve hangi maddelerin hangi ciktilari kritik, uyari, bilgi ve
// sorun yok olarak algilaniyor ... istedigimde kritiklik seviyesini degistirebilmek istiyorum" ve
// "tek seferde kac sunucu yazilabilecegini oraya goster ... limitin arttirilabilmesi icin adminlere
// yetki ver".
//   KR1 katalog = assess.cjs: her add() cagrisi duz yazili (seviye, alan, KOD); her kod katalogda,
//       varsayilan seviye ve alan AYNI; katalogda olup artik uretilmeyen kod yok; her maddede tek
//       "sorun yok" ciktisi
//   KR2 assess seviye degisikligini uygular: sunucu durumu / sayaclar / ozet yeni seviyeyle;
//       'ok' bulgu listede kalir ama sayilmaz; defaultSeverity yalniz degisende; gecersiz deger yok sayilir
//   KR3 ayarlar: okuma (gecersiz satir yok sayilir), okunamadi -> varsayilan + bayrak (onbellege
//       alinmaz), yazma (UPDATE/INSERT, varsayilana donus DELETE, degismeyen yazilmaz), gecmis eski -> yeni,
//       dogrulama (bilinmeyen kod / seviye / limit disi -> 400), okunamazken yazma 503
//   KR4 uclar (GERCEK initServerHub): GET /kurallar maddeler + sayim, PUT seviye -> degerlendirme
//       yeni seviyeyle, PUT limit, GET /limitler
//   KR5 limitler uygulanir: Simdi tara, Acilis Hazirligi, Reboot Kontrolu ayardaki sayiyla; mesaj
//       sayiyi ve nereden artirilacagini soyler
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

// ── sahte Portal DB (yalniz ayarlar.cjs ve reboot-check'in sorgulari) ─────────────────────────
const DB = { ayar: new Map(), gecmis: [], dus: false, sorgular: [] };
const N = (s) => String(s).replace(/\s+/g, ' ').trim();
stub('../../db/index.cjs', {
  query: async (sql, p = []) => {
    const s = N(sql);
    DB.sorgular.push(s);
    if (DB.dus) throw new Error('baglanti yok');
    if (s.startsWith('SELECT anahtar, deger, aciklama, updated_by, updated_at FROM server_hub_ayarlar'))
      return { rows: [...DB.ayar.values()], rowCount: DB.ayar.size };
    if (s.startsWith('UPDATE server_hub_ayarlar SET deger = $1')) {
      const r = DB.ayar.get(p[3]);
      if (!r) return { rows: [], rowCount: 0 };
      Object.assign(r, { deger: p[0], aciklama: p[1], updated_by: p[2], updated_at: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO server_hub_ayarlar')) {
      DB.ayar.set(p[0], { anahtar: p[0], deger: p[1], aciklama: p[2], updated_by: p[3], updated_at: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('DELETE FROM server_hub_ayarlar WHERE anahtar = $1')) {
      const v = DB.ayar.delete(p[0]);
      return { rows: [], rowCount: v ? 1 : 0 };
    }
    if (s.startsWith('INSERT INTO server_hub_ayar_gecmisi')) {
      DB.gecmis.push({ id: DB.gecmis.length + 1, anahtar: p[0], eski: p[1], yeni: p[2], aciklama: p[3], degistiren: p[4], zaman: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT TOP \d+ anahtar, eski, yeni, aciklama, degistiren, zaman FROM server_hub_ayar_gecmisi ORDER BY id DESC/.test(s))
      return { rows: [...DB.gecmis].reverse(), rowCount: DB.gecmis.length };
    if (s.startsWith('INSERT INTO reboot_checks')) return { rows: [{ id: 1 }], rowCount: 1 };
    throw new Error(`sahte DB bilinmeyen SQL: ${s.slice(0, 100)}`);
  },
});
const sifirla = () => {
  DB.ayar.clear();
  DB.gecmis.length = 0;
  DB.dus = false;
  DB.sorgular.length = 0;
  require('../ayarlar.cjs').onbellekSil();
};
const satir = (anahtar, deger) => DB.ayar.set(anahtar, { anahtar, deger, aciklama: 'not', updated_by: 'ayse', updated_at: new Date('2026-10-20T08:00:00Z') });

const { MADDELER, KODLAR } = require('../kural-katalogu.cjs');
const ayarlar = require('../ayarlar.cjs');
const { assess, flattenFindings } = require('../assess.cjs');

test('KR1 katalog assess.cjs ile ayni: kod, varsayilan seviye, alan; olu kod yok', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assess.cjs'), 'utf8');
  const bas = src.indexOf('const add = (severity, area, code, text, fix, ek) =>');
  assert.ok(bas > 0, 'add tanimi bulunamadi');
  const govde = src.slice(bas + 10);
  // yalniz bulgu yardimcisi: Set.add / kaynaklar.add gibi metot cagrilari sayilmaz
  const cagri = (govde.match(/(?<![.\w])add\(/g) || []).length;
  const re = /(?<![.\w])add\(\s*'(danger|warning|info)',\s*'([a-z]+)',\s*'([A-Z0-9_]+)'/g;
  const bulunan = [...govde.matchAll(re)].map((m) => ({ seviye: m[1], alan: m[2], kod: m[3] }));
  assert.equal(bulunan.length, cagri, 'seviyesi / alani / kodu duz yazili olmayan add() var: katalog onu ifade edemez');
  const kaynak = new Map();
  for (const b of bulunan) {
    const once = kaynak.get(b.kod);
    assert.ok(!once || (once.seviye === b.seviye && once.alan === b.alan), `${b.kod} iki farkli seviye/alanla uretiliyor`);
    kaynak.set(b.kod, b);
  }
  for (const [kod, b] of kaynak) {
    assert.ok(KODLAR.has(kod), `${kod} katalogda yok (ekranda listelenmez, seviyesi degistirilemez)`);
    assert.equal(KODLAR.get(kod).seviye, b.seviye, `${kod} katalog varsayilani assess ile tutmuyor`);
    assert.equal(KODLAR.get(kod).alan, b.alan, `${kod} katalog alani assess ile tutmuyor`);
  }
  for (const kod of KODLAR.keys()) assert.ok(kaynak.has(kod), `${kod} katalogda var ama assess artik uretmiyor`);
  const tum = MADDELER.flatMap((m) => m.ciktilar.filter((c) => c.kod).map((c) => c.kod));
  assert.equal(new Set(tum).size, tum.length, 'ayni kod iki maddede');
  for (const m of MADDELER) {
    const ok = m.ciktilar.filter((c) => !c.kod);
    assert.equal(ok.length, 1, `${m.id}: tek "sorun yok" ciktisi olmali`);
    assert.equal(ok[0].seviye, 'ok');
    assert.ok(m.ad && m.neTaranir && m.ciktilar.every((c) => c.kosul), `${m.id}: ad / ne taranir / kosul bos`);
  }
});

// ── assess: SYNTAX_UNVERIFIED (uyari) + IP_UNUSED (bilgi) ureten tek web sunucusu ────────────
const GUN = '2026-10-20';
const NOW = Date.parse(`${GUN}T10:00:00Z`);
const WEB = 'GBCJWP01';
const veri = () => ({
  hosts: [{ host: WEB, scan_date: GUN, products: 'IHS', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.4', rec_counts: '', scan_errors: '', proc_visibility: 'FULL', sock_visibility: 'PID', loaded_at: `${GUN}T06:00:00Z` }],
  web: [{ host: WEB, product: 'IHS', running: 1, syntax: 'UNKNOWN', detail: 'sozdizimi OLCULEMEDI (kosan: www): httpd: Could not open configuration file /usr/IBMIHS/conf/httpd.conf', check_class: 'ACCESS_DENIED', syntax_verification: 'NOT_VERIFIED', run_as: 'www', check_rc: 1, vhost_trust: 'NONE', running_src: 'PS' }],
  ips: [{ host: WEB, ip: '10.1.1.99', iface: 'eth0:1', primary: 0, used_by: 'none' }],
});
const sunucu = (r) => r.hosts.find((h) => h.host === WEB);
const bulgu = (h, kod) => h.findings.find((f) => f.code === kod);

test('KR2 assess seviye degisikligini uygular; sorun yok sayilmaz; varsayilan isaretli', () => {
  const v = sunucu(assess(veri(), { now: NOW }));
  assert.deepEqual([v.status, v.counts.warning, v.counts.info], ['warning', 1, 1]);
  assert.equal(bulgu(v, 'SYNTAX_UNVERIFIED').defaultSeverity, undefined, 'degismeyen bulguda defaultSeverity olmamali');

  const r = assess(veri(), { now: NOW, seviyeler: { SYNTAX_UNVERIFIED: 'danger' } });
  const k = sunucu(r);
  assert.deepEqual([k.status, k.counts.danger, k.counts.warning], ['danger', 1, 0]);
  assert.deepEqual([bulgu(k, 'SYNTAX_UNVERIFIED').severity, bulgu(k, 'SYNTAX_UNVERIFIED').defaultSeverity], ['danger', 'warning']);
  assert.equal(r.summary.hosts.danger, 1, 'ozet yeni seviyeyle sayilmali');
  const satirlar = flattenFindings(r.hosts);
  assert.deepEqual(satirlar[0].code, 'SYNTAX_UNVERIFIED', 'siralama yeni seviyeyle');
  assert.equal(satirlar[0].defaultSeverity, 'warning');
  assert.equal(satirlar.find((x) => x.code === 'IP_UNUSED').defaultSeverity, undefined);

  // sorun yok: bulgu listede, sayilmaz, durumu etkilemez
  const o = sunucu(assess(veri(), { now: NOW, seviyeler: { SYNTAX_UNVERIFIED: 'ok', IP_UNUSED: 'ok' } }));
  assert.equal(o.status, 'ok');
  assert.deepEqual(o.counts, { danger: 0, warning: 0, info: 0 });
  assert.equal(o.findings.length, 2, 'sorun yok yapilan bulgu listeden dusmemeli');
  assert.ok(o.findings.every((f) => f.severity === 'ok'));

  // gecersiz / bilinmeyen deger yok sayilir (varsayilan gecerli)
  const g = sunucu(assess(veri(), { now: NOW, seviyeler: { SYNTAX_UNVERIFIED: 'kritik' } }));
  assert.equal(bulgu(g, 'SYNTAX_UNVERIFIED').severity, 'warning');
});

test('KR6 kurallar sayimi: taramadan dusen sunucu sayilmaz; sunucu tekil', () => {
  const { sayimlar } = require('../kurallar.cjs');
  const s = sayimlar({
    hosts: [
      { host: 'A', findings: [{ code: 'NO_LOAD' }, { code: 'NO_LOAD' }] },
      { host: 'B', findings: [{ code: 'NO_LOAD' }] },
      { host: 'C', taramadanDustu: true, findings: [{ code: 'NO_LOAD' }, { code: 'IP_UNUSED' }] },
    ],
  });
  assert.deepEqual([s.get('NO_LOAD').bulgu, s.get('NO_LOAD').sunucu.size], [3, 2]);
  assert.equal(s.has('IP_UNUSED'), false, 'taramadan dusen sunucunun bulgusu sayildi');
});

test('KR3 ayarlar: okuma, okunamadi, yazma, gecmis, dogrulama', async () => {
  sifirla();
  satir('seviye:REBOOT_RISK', 'warning');
  satir('seviye:YOK_BOYLE', 'danger');
  satir('seviye:NO_LOAD', 'kritik');
  satir('limit:reboot', '200');
  satir('limit:tara', '99999');
  satir('limit:hazirlik', 'x');
  let a = await ayarlar.oku(true);
  assert.deepEqual(a.seviyeler, { REBOOT_RISK: 'warning' }, 'gecersiz satir yok sayilmali');
  assert.deepEqual(a.limitler, { tara: 50, reboot: 200, hazirlik: 500 });
  assert.equal(a.kayitlar['seviye:REBOOT_RISK'].updatedBy, 'ayse');

  // okunamadi: varsayilan + bayrak; onbellege alinmaz
  sifirla();
  DB.dus = true;
  a = await ayarlar.oku();
  assert.deepEqual([a.okunamadi, a.limitler.reboot, Object.keys(a.seviyeler).length], [true, 50, 0]);
  assert.match(a.hata, /baglanti yok/);
  await assert.rejects(ayarlar.seviyeYaz({ kod: 'NO_LOAD', seviye: 'danger', kim: 'ayse' }), (e) => e.status === 503);
  DB.dus = false;
  satir('limit:reboot', '120');
  assert.equal(await ayarlar.limit('reboot'), 120, 'okunamadi sonucu onbellege alindi');

  // yazma: yeni -> INSERT, gecmis eski=varsayilan
  sifirla();
  let w = await ayarlar.seviyeYaz({ kod: 'NO_LOAD', seviye: 'danger', aciklama: 'prod icin onemli', kim: 'ayse' });
  assert.deepEqual([w.eski, w.yeni, w.varsayilan], ['warning', 'danger', false]);
  assert.equal(DB.ayar.get('seviye:NO_LOAD').deger, 'danger');
  assert.deepEqual(DB.gecmis.map((x) => [x.anahtar, x.eski, x.yeni, x.degistiren, x.aciklama]), [['seviye:NO_LOAD', 'warning', 'danger', 'ayse', 'prod icin onemli']]);
  assert.deepEqual((await ayarlar.oku()).seviyeler, { NO_LOAD: 'danger' }, 'yazma sonrasi onbellek silinmedi');
  // guncelleme -> UPDATE
  w = await ayarlar.seviyeYaz({ kod: 'NO_LOAD', seviye: 'info', kim: 'veli' });
  assert.deepEqual([w.eski, w.yeni], ['danger', 'info']);
  assert.equal(DB.ayar.get('seviye:NO_LOAD').updated_by, 'veli');
  // degismeyen: yazilmaz, gecmis yok
  const once = DB.gecmis.length;
  w = await ayarlar.seviyeYaz({ kod: 'NO_LOAD', seviye: 'info', kim: 'veli' });
  assert.equal(w.degismedi, true);
  assert.equal(DB.gecmis.length, once);
  // varsayilana donus -> DELETE + gecmis
  w = await ayarlar.seviyeYaz({ kod: 'NO_LOAD', seviye: 'warning', kim: 'veli' });
  assert.deepEqual([w.varsayilan, DB.ayar.has('seviye:NO_LOAD'), DB.gecmis.at(-1).yeni], [true, false, 'warning']);

  // dogrulama
  for (const [kod, seviye] of [['YOK_BOYLE', 'danger'], ['NO_LOAD', 'kritik'], ['', 'ok']])
    await assert.rejects(ayarlar.seviyeYaz({ kod, seviye, kim: 'a' }), (e) => e.status === 400, `${kod}/${seviye} kabul edildi`);
  for (const deger of [0, 501, 1.5, 'abc', ''])
    await assert.rejects(ayarlar.limitYaz({ ad: 'reboot', deger, kim: 'a' }), (e) => e.status === 400 && /1 ile 500/.test(e.message), `limit ${deger} kabul edildi`);
  await assert.rejects(ayarlar.limitYaz({ ad: 'yok', deger: 5, kim: 'a' }), (e) => e.status === 400);
  w = await ayarlar.limitYaz({ ad: 'reboot', deger: '500', kim: 'a' });
  assert.deepEqual([w.eski, w.yeni], ['50', '500']);
  assert.equal(await ayarlar.limit('reboot'), 500);
  w = await ayarlar.limitYaz({ ad: 'reboot', deger: 50, kim: 'a' });
  assert.equal(DB.ayar.has('limit:reboot'), false, 'varsayilana donen limit satiri silinmeli');
  const g = await ayarlar.gecmis(10);
  assert.deepEqual([g[0].anahtar, g[0].eski, g[0].yeni], ['limit:reboot', '500', '50'], 'gecmis en yeni once');
});

// ── uctan uca: gercek initServerHub, sahte mssql (bos tarama) + sahte AWX kaydi ──────────────
let tarama = null;
stub('../../inventory/mssql.cjs', {
  query: async (q) => {
    const s = String(q);
    if (/OBJECT_ID\('dbo\.Server_Hub_Hosts'\) AS oid/.test(s)) return { recordset: [{ oid: tarama ? 1 : null }] };
    if (/FROM sys\.columns c WHERE c\.object_id IN/.test(s)) {
      const { SH_KOLONLAR } = require('../index.cjs');
      return { recordset: Object.entries(SH_KOLONLAR).flatMap(([t, cs]) => cs.map((name) => ({ tbl: t.replace('dbo.', ''), name }))) };
    }
    const m = /FROM dbo\.Server_Hub_(\w+) t\b/.exec(s);
    if (m && tarama) return { recordset: tarama[m[1]] || [] };
    return { recordset: [] };
  },
  sql: { NVarChar: () => 'nvarchar', Int: 'int' },
});
stub('../../ansible/playbook-registry.cjs', { getByKey: async () => null, getEffectiveTemplateId: () => null });
const denetim = [];
stub('../../audit/index.cjs', { auditPortal: (_req, kat, d) => denetim.push([kat, JSON.parse(d.detail)]) });

async function httpIle(fn) {
  stub('../../auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
  stub('../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
  const { initServerHub } = require('../index.cjs');
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { role: 'Admin', username: 'ayse' } };
    next();
  });
  const log = console.log;
  console.log = () => {};
  try {
    initServerHub(app);
  } finally {
    console.log = log;
  }
  const srv = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}/api/server-hub`);
  } finally {
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close();
  }
}
const J = async (r) => ({ status: r.status, body: await r.json() });
const put = (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(J);
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(J);

test('KR4 uclar: kurallar listesi + sayim, seviye degisikligi degerlendirmeye yansir, limit', async () => {
  sifirla();
  denetim.length = 0;
  tarama = null;
  await httpIle(async (kok) => {
    // tarama tablosu yokken sayim OLCULEMEDI (null), 0 degil
    let r = await fetch(`${kok}/kurallar`).then(J);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.maddeler.length, MADDELER.length);
    const cikti = (b, kod) => b.maddeler.flatMap((m) => m.ciktilar).find((c) => c.kod === kod);
    assert.equal(r.body.sayimOlculdu, false);
    assert.equal(cikti(r.body, 'REBOOT_RISK').bulgu, null);
    assert.deepEqual([cikti(r.body, 'REBOOT_RISK').varsayilan, cikti(r.body, 'REBOOT_RISK').gecerli], ['danger', 'danger']);
    assert.ok(r.body.maddeler.every((m) => m.ciktilar.some((c) => c.kod === null && c.gecerli === 'ok')));
    assert.deepEqual(r.body.gecmis, []);
  });
  // tarama verisiyle: sayim + seviye degisikligi aninda yansir
  const v = veri();
  const bugun = new Date().toISOString().slice(0, 10);
  tarama = {
    Hosts: v.hosts.map((h) => ({ ...h, scan_date: bugun, loaded_at: `${bugun}T06:00:00Z` })),
    Web: v.web.map((w) => ({ ...w, scan_date: bugun })),
    Ips: v.ips.map((i) => ({ ...i, scan_date: bugun })),
  };
  await httpIle(async (kok) => {
    let r = await fetch(`${kok}/kurallar?fresh=1`).then(J);
    const cikti = (b, kod) => b.maddeler.flatMap((m) => m.ciktilar).find((c) => c.kod === kod);
    assert.equal(r.body.sayimOlculdu, true);
    assert.deepEqual([cikti(r.body, 'SYNTAX_UNVERIFIED').bulgu, cikti(r.body, 'SYNTAX_UNVERIFIED').sunucu], [1, 1]);
    assert.equal(cikti(r.body, 'REBOOT_RISK').bulgu, 0);
    let o = await fetch(`${kok}/overview?fresh=1`).then(J);
    assert.equal(o.body.hosts[0].status, 'warning');
    const w = await put(`${kok}/kurallar/seviye/SYNTAX_UNVERIFIED`, { seviye: 'danger', aciklama: 'IHS onemli' });
    assert.deepEqual([w.status, w.body.eski, w.body.yeni], [200, 'warning', 'danger']);
    o = await fetch(`${kok}/overview`).then(J);
    assert.equal(o.body.hosts[0].status, 'danger', 'seviye degisikligi onbellek yuzunden yansimadi');
    assert.deepEqual(o.body.ayar, { okunamadi: false, seviyeDegisen: 1 });
    const f = await fetch(`${kok}/findings`).then(J);
    assert.deepEqual([f.body.findings[0].severity, f.body.findings[0].defaultSeverity], ['danger', 'warning']);
    r = await fetch(`${kok}/kurallar`).then(J);
    const c = cikti(r.body, 'SYNTAX_UNVERIFIED');
    assert.deepEqual([c.gecerli, c.varsayilan, c.degistiren, c.aciklama], ['danger', 'warning', 'ayse', 'IHS onemli']);
    assert.deepEqual([r.body.gecmis[0].anahtar, r.body.gecmis[0].eski, r.body.gecmis[0].yeni], ['seviye:SYNTAX_UNVERIFIED', 'warning', 'danger']);
    assert.deepEqual(denetim.at(-1), ['server_hub', { op: 'seviye_degistir', kod: 'SYNTAX_UNVERIFIED', eski: 'warning', yeni: 'danger' }]);
    assert.equal((await put(`${kok}/kurallar/seviye/YOK_BOYLE`, { seviye: 'danger' })).status, 400);
    assert.equal((await put(`${kok}/kurallar/seviye/NO_LOAD`, { seviye: 'kritik' })).status, 400);
    // limit
    const l = await put(`${kok}/kurallar/limit/tara`, { deger: 200 });
    assert.deepEqual([l.status, l.body.yeni], [200, '200']);
    assert.equal((await put(`${kok}/kurallar/limit/tara`, { deger: 5000 })).status, 400);
    const lim = await fetch(`${kok}/limitler`).then(J);
    assert.deepEqual(lim.body.limitler.map((x) => [x.ad, x.gecerli, x.varsayilan, x.ust]), [['tara', 200, 50, 1000], ['reboot', 50, 50, 500], ['hazirlik', 500, 500, 5000]]);
    assert.equal(lim.body.limitler[0].degistiren, 'ayse');
  });
  tarama = null;
});

test('KR5 limitler uygulanir: Simdi tara, Acilis Hazirligi, Reboot Kontrolu', async () => {
  sifirla();
  satir('limit:tara', '2');
  satir('limit:hazirlik', '3');
  satir('limit:reboot', '2');
  const H = (n) => Array.from({ length: n }, (_, i) => `GBJBOP${String(i + 10)}`);
  await httpIle(async (kok) => {
    let r = await post(`${kok}/scan`, { hosts: H(3) });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /en fazla 2 sunucu/);
    assert.match(r.body.message, /Kurallar & Limitler/);
    r = await post(`${kok}/scan`, { hosts: H(2) });
    assert.doesNotMatch(String(r.body.message || ''), /arası geçerli sunucu/, 'sinir icindeki liste reddedildi');
    r = await post(`${kok}/reboot-readiness`, { hosts: H(4).join(',') });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /en fazla 3 sunucu sorgulanabilir \(4 girildi/);
    r = await post(`${kok}/reboot-readiness`, { hosts: H(3).join(',') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await post(`${kok}/reboot-check`, { hosts: H(3) });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /en fazla 2 sunucu/);
    r = await post(`${kok}/reboot-check`, { hosts: H(2) });
    assert.doesNotMatch(String(r.body.message || ''), /arası geçerli sunucu/);
  });
  // ayar okunamazsa varsayilanlar (50 / 500 / 50)
  sifirla();
  DB.dus = true;
  await httpIle(async (kok) => {
    const r = await post(`${kok}/scan`, { hosts: H(51) });
    assert.match(r.body.message, /en fazla 50 sunucu/);
  });
  DB.dus = false;
});
