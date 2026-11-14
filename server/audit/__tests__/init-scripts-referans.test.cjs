// server/audit/__tests__/init-scripts-referans.test.cjs - IR1..IR9 + IR2b (2026-11-14).
//
// Kullanici: "Denetim > Init Scripts'te bazi sunucularda appdomain.service dagitilan surumle
// ayni olmasina ragmen farkliymis gibi gorunuyor." Kok neden: ham sha512 son satir sonu / CRLF /
// satir sonu boslugunu da surum sayiyordu ve referans COGUNLUKTU. Kilitlenen iddialar:
//   IR1 ekip referansi + ayrinti varken: yalniz bicim farki sapma DEGIL, tek icerik surumu,
//       depo kopyasinin birebir aynisi "uyumlu"; referenceSource 'ekip'.
//   IR2 ayrinti/referans tablolari YOKKEN (eski veri) davranis birebir eskisi: ham hash +
//       cogunluk, 3 surum, 8 sapan.
//   IR3 .sh/.jy dosyasinda CR: sapma sayilmaz ama "crlf" olarak ayri sayilir ve sunucu
//       "tam uyumlu" sayilmaz; .service'te CR uyari degildir.
//   IR4 gercek icerik farki sapmadir; MISSING ve UNREADABLE ayri listelenir.
//   IR2b eski veri BIREBIR: 2026-11-14 oncesi algoritmanin (bu dosyada kopyasi) tum alanlari ayni;
//       ozel sunucular dahil, iki kok dahil; OTEKI kokun tablosu ve ayrinti/referans satirlari
//       hic okunmaz.
//   IR5 appdomain.service (sunucu geneli): AYRINTI VARKEN referans iki tablonun birlesiminden -
//       iki sekmede AYNI. Eski veride her sekme kendi cogunlugu.
//   IR6 GBEVM/GBPRV genel envanterin referansina gore olculur (ekip referansi dahil).
//   IR7 ek tablo sorgusu duserse uc 200 doner, extrasError dolar, eski davranis.
//   IR10 KISMI ek tablo hatasi (ayrinti okundu, referans dustu): yari yeni yol URETILMEZ,
//       tamamen eski yol + extrasError (ekrandaki "okunamadi" notuyla tutarli).
//   IR11 normu bilinmeyen kopya (ayrinti satiri eksik) ayni ham hash'in normunu alir: ayni
//       icerik iki surum sayilmaz.
//   IR12 startCustom.sh'ta CR: script satirindaki CRLF sayimi sunucu satirinda da gorunur.
//   IR13 referans tablosunda dosya basina birden cok satir: sirali ILK kazanir (deterministik).
//   IR14 istemci: ekip surumu yokken (eski veri / Deployment) "Cogunluk" basligi, cip yok,
//       Deployment CSV'si eski sutunlar; "sapma sayilmaz" yalniz referans surumunde; tum filo
//       ekip surumunden sapiyorsa "1 surum" yesil degil.
//   IR8 verinin yasi: load_date sutunu varsa ondan (SQL'de metin + DATEDIFF), yoksa
//       InitScriptsDetail.scan_date, ikisi de yoksa null (ekran "yas bilinmiyor" der).
//       AWX job 13418 /sw'ye yazamadi ve tablolar sessizce eskidi - yas gorunmeli.
// Normallestirme kurali bmw_wds_scripts/initialize/README.md ile ayni (test icinde JS esi).
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', '..');
function sahteModul(rel, exportsObj) {
  const p = require.resolve(path.join(SERVER, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj, children: [], paths: [] };
}
const gec = (_req, _res, next) => next();

const sha = (s) => crypto.createHash('sha512').update(Buffer.from(s, 'binary')).digest('hex');
function norm(s) {
  const lines = s.replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l + '\n').join('');
}
const APP = '[Unit]\nDescription=App domain\n\n[Service]\nType=oneshot\n\n[Install]\nWantedBy=default.target';
const V = {
  repo: APP,
  nl: APP + '\n',
  crlf: (APP + '\n').replace(/\n/g, '\r\n'),
  real: (APP + '\n').replace('oneshot', 'simple'),
};
const SH = '#!/bin/bash\necho start\n';
const SH_CRLF = SH.replace(/\n/g, '\r\n');
const fp = (s) => ({ raw: sha(s), norm: sha(norm(s)), cr: s.includes('\r') });

// Sahte veritabani durumu (her test kendi kurar)
let DB = null;
const rs = (recordset) => ({ recordset });
const ALL_COLS = ['host', 'appdomain_service', 'start_sh'];

function satir(host, app, start) {
  return { host, appdomain_service: app ? fp(app).raw : null, start_sh: start ? fp(start).raw : null };
}

async function query(text, params) {
  const t = String(text);
  if (DB && DB.sorgular) DB.sorgular.push(t);
  const p = Object.fromEntries((params || []).map((x) => [x.name, x.value]));
  if (t.includes('MAX(load_date)')) {
    if (!t.includes('FROM dbo.InitScriptsInventory')) throw new Error('load_date yanlis tablodan');
    if (DB.ageThrow) throw new Error('yas sorgusu dustu');
    return rs([DB.loadDate || { t: null, m: null }]);
  }
  if (t.includes('MAX(scan_date)')) {
    if (p.root !== DB.expectRoot && DB.expectRoot) throw new Error('scan_date kok parametresi yok');
    return rs([DB.scanDate || { t: null, m: null }]);
  }
  if (t.includes('FROM sys.columns') && t.includes("OBJECT_ID('dbo.InitScriptsInventory8')"))
    return rs((DB.cols8 || ALL_COLS).map((name) => ({ name })));
  if (t.includes('FROM sys.columns') && t.includes("OBJECT_ID('dbo.InitScriptsInventory')"))
    return rs((DB.cols || ALL_COLS).map((name) => ({ name })));
  if (t.includes("OBJECT_ID('dbo.InitScriptsDetail') AS d")) {
    if (DB.extrasThrow) throw new Error('detay sorgusu dustu');
    return rs([{ d: DB.detail ? 1 : null, r: DB.refs ? 1 : null, o: DB.rows8 ? 1 : null }]);
  }
  if (t.includes('FROM dbo.InitScriptsDetail')) {
    const out = [];
    for (const d of DB.detail || []) {
      if (d.root === p.root || (d.root === p.other && d.script === p.hw0)) out.push(d);
    }
    return rs(out);
  }
  if (t.includes('FROM dbo.InitScriptsReference')) {
    if (DB.refThrow) throw new Error('referans sorgusu dustu');
    const refs = [...(DB.refs || [])];
    // SQL ORDER BY'in esi: sorgu siralamiyorsa sahte DB de siralamaz (girdi sirasi).
    if (/ORDER BY script, norm_sha512/.test(t)) {
      refs.sort((a, b) => a.script.localeCompare(b.script) || a.norm_sha512.localeCompare(b.norm_sha512));
    }
    return rs(refs);
  }
  if (t.includes('FROM dbo.InitScriptsInventory8')) return rs(DB.rows8 || []);
  if (t.includes('FROM dbo.InitScriptsInventory')) return rs(DB.rows || []);
  return rs([]);
}
sahteModul('inventory/mssql.cjs', { query, queryLong: query, sql: new Proxy({}, { get: () => 'tip' }) });
sahteModul('auth/index.cjs', { requireAuth: gec, requireAdmin: gec, getRequestUser: () => null });
sahteModul('auth/visibility.cjs', { requireVisiblePrefix: () => gec, requireVisible: () => gec });

let sunucu = null;
let taban = '';
before(async () => {
  const express = require('express');
  const app = express();
  require('../denetim.cjs').initDenetim(app);
  await new Promise((ok) => {
    sunucu = app.listen(0, '127.0.0.1', ok);
  });
  taban = `http://127.0.0.1:${sunucu.address().port}/api/denetim`;
});
after(() => sunucu && sunucu.close());

const al = async (root = 'vhosting') => {
  const r = await fetch(`${taban}/init-scripts?root=${root}&fresh=1`);
  assert.equal(r.status, 200);
  return r.json();
};
const script = (j, key) => j.scripts.find((s) => s.key === key);

/** Teshisteki dagilim: 30 "LF + son satir sonu", 5 depo birebir, 3 CRLF. */
function filo() {
  const hosts = [];
  for (let i = 0; i < 30; i++) hosts.push([`GBNL${String(i).padStart(2, '0')}`, V.nl]);
  for (let i = 0; i < 5; i++) hosts.push([`GBREPO${i}`, V.repo]);
  for (let i = 0; i < 3; i++) hosts.push([`GBCRLF${i}`, V.crlf]);
  return hosts;
}
function detay(root, host, script, s, state = 'OK') {
  if (!s) return { host, root, script, norm_sha512: null, has_cr: null, state };
  const f = fp(s);
  return { host, root, script, norm_sha512: f.norm, has_cr: f.cr, state };
}

test('IR1 ekip referansi + ayrinti: bicim farki sapma degil, depo kopyasi uyumlu', async () => {
  const hosts = filo();
  DB = {
    rows: hosts.map(([h, s]) => satir(h, s, SH)),
    detail: hosts.flatMap(([h, s]) => [
      detay('vhosting', h, 'appdomain.service', s),
      detay('vhosting', h, 'start.sh', SH),
    ]),
    refs: [
      { script: 'appdomain.service', raw_sha512: fp(V.repo).raw, norm_sha512: fp(V.repo).norm },
      { script: 'start.sh', raw_sha512: fp(SH).raw, norm_sha512: fp(SH).norm },
    ],
  };
  const j = await al();
  const a = script(j, 'appdomain_service');
  assert.equal(a.referenceSource, 'ekip');
  assert.equal(j.referenceSource, 'ekip');
  assert.equal(j.detailAvailable, true);
  assert.equal(j.teamReferenceAvailable, true);
  assert.equal(a.deviatingCount, 0, 'bicim farki sapma sayilmamali');
  assert.equal(a.variantCount, 1, 'tek icerik surumu');
  assert.equal(a.rawVariantCount, 3);
  // depo kopyasi ham==referans ham, LF+son satir sonu ham==referans normu (kanonik bicim):
  // ikisi de uyumlu; yalniz CRLF kopyalar "bicim farki".
  assert.equal(a.formatOnlyCount, 3, 'yalniz CRLF kopyalar bicim farki');
  assert.equal(a.referenceCount, 38);
  assert.equal(a.crlfCount, 0, '.service dosyasinda CR uyari degil');
  assert.equal(a.variants[0].isReference, true);
  assert.equal(j.identicalHosts, 38);
  const repo = j.hostRows.find((r) => r.host === 'GBREPO0');
  assert.deepEqual([repo.deviations, repo.formatOnly], [[], []], 'depo birebir kopyasi uyumlu');
  const nl = j.hostRows.find((r) => r.host === 'GBNL00');
  assert.deepEqual([nl.deviations, nl.formatOnly], [[], []], 'kanonik bicim uyumlu');
  const crlf = j.hostRows.find((r) => r.host === 'GBCRLF0');
  assert.deepEqual(crlf.formatOnly, ['appdomain.service']);
  assert.equal(crlf.deviationCount, 0);
});

test('IR2 eski veri (ayrinti/referans yok): ham hash + cogunluk, davranis degismez', async () => {
  const hosts = filo();
  DB = { rows: hosts.map(([h, s]) => satir(h, s, SH)) };
  const j = await al();
  const a = script(j, 'appdomain_service');
  assert.equal(a.referenceSource, 'cogunluk');
  assert.equal(j.referenceSource, 'cogunluk');
  assert.equal(j.detailAvailable, false);
  assert.equal(a.variantCount, 3);
  assert.equal(a.majorityHash, fp(V.nl).raw);
  assert.equal(a.majorityCount, 30);
  assert.equal(a.deviatingCount, 8);
  assert.equal(a.formatOnlyCount, 0);
  assert.equal(j.identicalHosts, 30);
});

test('IR3 .sh dosyasinda CRLF: sapma degil ama ayri sayilir, tam uyumlu sayilmaz', async () => {
  const hosts = [['GBA1', SH], ['GBA2', SH], ['GBA3', SH_CRLF]];
  DB = {
    rows: hosts.map(([h, s]) => satir(h, V.nl, s)),
    detail: hosts.flatMap(([h, s]) => [detay('vhosting', h, 'start.sh', s), detay('vhosting', h, 'appdomain.service', V.nl)]),
  };
  const j = await al();
  const s = script(j, 'start_sh');
  assert.equal(s.referenceSource, 'cogunluk');
  assert.equal(s.deviatingCount, 0);
  assert.equal(s.formatOnlyCount, 1);
  assert.equal(s.crlfCount, 1);
  assert.deepEqual(s.crlfHosts, ['GBA3']);
  const h = j.hostRows.find((r) => r.host === 'GBA3');
  assert.deepEqual(h.crlf, ['start.sh']);
  assert.equal(h.deviationCount, 0);
  assert.equal(j.crlfHosts, 1);
  assert.equal(j.identicalHosts, 2, 'CRLF betikli sunucu tam uyumlu sayilmaz');
});

test('IR4 gercek icerik farki sapmadir; MISSING ve UNREADABLE ayri', async () => {
  DB = {
    rows: [satir('GBB1', V.nl, SH), satir('GBB2', V.nl, SH), satir('GBB3', V.real, SH), satir('GBB4', null, SH), satir('GBB5', null, SH)],
    detail: [
      detay('vhosting', 'GBB1', 'appdomain.service', V.nl),
      detay('vhosting', 'GBB2', 'appdomain.service', V.nl),
      detay('vhosting', 'GBB3', 'appdomain.service', V.real),
      detay('vhosting', 'GBB4', 'appdomain.service', null, 'MISSING'),
      detay('vhosting', 'GBB5', 'appdomain.service', null, 'UNREADABLE'),
    ],
    refs: [{ script: 'appdomain.service', raw_sha512: fp(V.repo).raw, norm_sha512: fp(V.repo).norm }],
  };
  const j = await al();
  const a = script(j, 'appdomain_service');
  assert.equal(a.deviatingCount, 1);
  assert.equal(a.variantCount, 2);
  assert.deepEqual(a.missingHosts, ['GBB4']);
  assert.deepEqual(a.unreadableHosts, ['GBB5']);
  assert.equal(a.present, 3);
  const b5 = j.hostRows.find((r) => r.host === 'GBB5');
  assert.deepEqual([b5.unreadable, b5.missing], [['appdomain.service'], []]);
  assert.deepEqual(j.hostRows.find((r) => r.host === 'GBB3').deviations, ['appdomain.service']);
});

test('IR5 appdomain.service referansi iki tablodan (ayrinti varken): iki sekmede ayni', async () => {
  const X = 'x'.repeat(128);
  const Y = 'y'.repeat(128);
  const r = (host, app) => ({ host, appdomain_service: app, start_sh: null });
  const d = (root, host, h) => ({ host, root, script: 'appdomain.service', norm_sha512: h, has_cr: 0, state: 'OK' });
  const rows = [r('GBH1', X), r('GBH2', X), r('GBH3', X), r('GBH4', Y), r('GBH5', Y)];
  const rows8 = [r('GBH4', Y), r('GBH5', Y), r('GBH6', Y), r('GBH7', Y)];
  DB = {
    rows,
    rows8,
    detail: [
      ...rows.map((x) => d('vhosting', x.host, x.appdomain_service)),
      ...rows8.map((x) => d('vhosting8', x.host, x.appdomain_service)),
    ],
  };
  const j1 = await al('vhosting');
  const j8 = await al('vhosting8');
  const a1 = script(j1, 'appdomain_service');
  const a8 = script(j8, 'appdomain_service');
  assert.equal(a1.hostWide, true);
  assert.equal(a1.referenceHash, Y, 'sekme ici cogunluk (X) degil, birlesik cogunluk (Y)');
  assert.equal(a8.referenceHash, Y);
  assert.equal(a1.deviatingCount, 3);
  assert.equal(a8.deviatingCount, 0);

  // Ayni veri, ayrinti tablosu YOK: eski davranis, her sekme kendi cogunlugu (X / Y)
  DB = { rows, rows8 };
  const e1 = script(await al('vhosting'), 'appdomain_service');
  assert.equal(e1.referenceHash, X, 'eski veride birlesik referans kullanilmamali');
  assert.equal(e1.deviatingCount, 2);
});

/*
 * 2026-11-14 ONCESI algoritma: denetim.cjs'teki halinin BIREBIR kopyasi (git adcd3056).
 * Eski veri yolunun "davranis degismedi" iddiasi bu kopyaya karsi alan alan denetlenir.
 */
function eskiRapor(raw, scripts, majorityOverride) {
  const hostCount = raw.length;
  const scriptStats = scripts.map((sc) => {
    const byHash = new Map();
    const absent = [];
    for (const r of raw) {
      const host = String(r.host).trim();
      const h = r[sc.key] ? String(r[sc.key]).trim() : '';
      if (!h) {
        absent.push(host);
        continue;
      }
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(host);
    }
    const variants = [...byHash.entries()]
      .map(([hash, hosts]) => ({ hash, count: hosts.length, hosts: hosts.sort() }))
      .sort((a, b) => b.count - a.count || a.hash.localeCompare(b.hash));
    const majority = variants[0] || null;
    return {
      key: sc.key,
      label: sc.label,
      perServer: !!sc.perServer,
      present: hostCount - absent.length,
      missing: absent.length,
      missingHosts: absent.sort(),
      variantCount: variants.length,
      majorityHash: majority ? majority.hash : null,
      majorityCount: majority ? majority.count : 0,
      deviatingCount: majority ? variants.slice(1).reduce((a, v) => a + v.count, 0) : 0,
      variants,
    };
  });
  const majorityOf = majorityOverride || new Map(scriptStats.map((sc) => [sc.key, sc.majorityHash]));
  const hostRows = raw.map((r) => {
    const deviations = [];
    const missing = [];
    let customHash = null;
    for (const sc of scripts) {
      const val = r[sc.key] ? String(r[sc.key]).trim() : '';
      if (sc.perServer) {
        customHash = val || null;
        continue;
      }
      if (!val) {
        missing.push(sc.label);
        continue;
      }
      const maj = majorityOf.get(sc.key);
      if (maj && val !== maj) deviations.push(sc.label);
    }
    return {
      host: String(r.host).trim(),
      deviations,
      deviationCount: deviations.length,
      missing,
      missingCount: missing.length,
      hasCustom: !!customHash,
      customHash,
    };
  });
  return { scriptStats, hostRows };
}
function eskiOzet(scripts, scriptStats, hostRows) {
  return {
    hosts: hostRows.length,
    scriptCount: scripts.length,
    identicalHosts: hostRows.filter((r) => r.deviationCount === 0 && r.missingCount === 0).length,
    totalVariants: scriptStats.filter((sc) => !sc.perServer).reduce((a, sc) => a + sc.variantCount, 0),
    customHosts: hostRows.filter((r) => r.hasCustom).length,
    scripts: scriptStats,
    hostRows,
  };
}
// 2026-11-14 oncesi INIT_SCRIPTS etiketleri (git adcd3056): eski missingColumns bu listeden.
const ESKI_INIT_ETIKETLER = [
  ['appdomain_service', 'appdomain.service'], ['start_sh', 'start.sh'], ['functions_sh', 'functions.sh'],
  ['startCTG_sh', 'startCTG.sh'], ['startWAS_sh', 'startWAS.sh'], ['startWEB_sh', 'startWEB.sh'],
  ['startJboss_sh', 'startJboss.sh'], ['startJboss8_sh', 'startJboss8.sh'], ['startNginx_sh', 'startNginx.sh'],
  ['startIHS_sh', 'startIHS.sh'], ['exceptionList_ini', 'exceptionList.ini'],
  ['startApplicationServers_jy', 'startApplicationServers.jy'], ['stopApplicationServers_jy', 'stopApplicationServers.jy'],
  ['startCustom_sh', 'startCustom.sh'],
];
function eskiYanit(rows, scripts) {
  const g = rows.filter((r) => !/^(GBEVM|GBPRV)/i.test(r.host));
  const o = rows.filter((r) => /^(GBEVM|GBPRV)/i.test(r.host));
  const genel = eskiRapor(g, scripts);
  let special = null;
  if (o.length) {
    const m = new Map(genel.scriptStats.map((sc) => [sc.key, sc.majorityHash]));
    const oz = eskiRapor(o, scripts, m);
    special = eskiOzet(scripts, oz.scriptStats, oz.hostRows);
  }
  return { ...eskiOzet(scripts, genel.scriptStats, genel.hostRows), special };
}
/** Yeni yanittan yalniz ESKI yanitta olan alanlari secer (ek alanlar serbest). */
function eskiAlanlar(yeni, eski) {
  if (yeni === null || typeof yeni !== 'object') return yeni;
  if (Array.isArray(yeni)) return yeni.map((x, i) => eskiAlanlar(x, eski && eski[i]));
  if (!eski || typeof eski !== 'object') return yeni;
  return Object.fromEntries(Object.keys(eski).map((k) => [k, eskiAlanlar(yeni[k], eski[k])]));
}

test('IR2b eski veri BIREBIR eski algoritma (ozel sunucular, eksik, startCustom, iki kok)', async () => {
  const K = ['host', 'appdomain_service', 'start_sh', 'functions_sh', 'startCustom_sh'];
  const SC = [
    { key: 'appdomain_service', label: 'appdomain.service' },
    { key: 'start_sh', label: 'start.sh' },
    { key: 'functions_sh', label: 'functions.sh' },
    { key: 'startCustom_sh', label: 'startCustom.sh', perServer: true },
  ];
  const h = (c) => c.repeat(128);
  // functions.sh: ozel kumenin kendi cogunlugu (z) genelinkinden (f) farkli - eski kod ozel
  // satirlarini GENEL cogunluga, ozel istatistigi KENDI cogunluguna gore sayardi; aynen kalmali.
  const rows = [
    { host: 'GBA01', appdomain_service: h('a'), start_sh: h('s'), functions_sh: h('f'), startCustom_sh: h('1') },
    { host: 'GBA02', appdomain_service: h('a'), start_sh: h('s'), functions_sh: null, startCustom_sh: null },
    { host: 'GBA03', appdomain_service: h('b'), start_sh: h('s'), functions_sh: h('f'), startCustom_sh: h('2') },
    { host: 'GBA04', appdomain_service: h('b'), start_sh: h('t'), functions_sh: h('g'), startCustom_sh: null },
    { host: 'GBA05', appdomain_service: h('a'), start_sh: null, functions_sh: null, startCustom_sh: null },
    { host: 'GBEVM01', appdomain_service: h('b'), start_sh: h('t'), functions_sh: null, startCustom_sh: h('3') },
    { host: 'GBEVM02', appdomain_service: h('b'), start_sh: h('t'), functions_sh: h('z'), startCustom_sh: null },
    { host: 'GBPRV01', appdomain_service: h('a'), start_sh: h('s'), functions_sh: h('z'), startCustom_sh: null },
  ];
  for (const root of ['vhosting', 'vhosting8']) {
    const sorgular = [];
    DB = { rows, rows8: rows, cols: K, cols8: K, sorgular };
    const j = await al(root);
    const eski = eskiYanit(rows, SC);
    assert.deepEqual(eskiAlanlar(j, eski), eski, `${root}: eski alanlar birebir olmali`);
    // Eski loader startRHA/startLiberty sutunu yazmaz: "henuz sutun yok" uyarisina girmemeli.
    const eskiEksik = ESKI_INIT_ETIKETLER.filter(([k]) => !K.includes(k)).map(([, l]) => l);
    assert.deepEqual(j.missingColumns, eskiEksik, `${root}: missingColumns eskisiyle ayni olmali`);
    assert.equal(j.detailAvailable, false);
    assert.equal(j.teamReferenceAvailable, false);
    assert.equal(j.formatOnlyHosts, 0);
    assert.equal(j.crlfHosts, 0);
    assert.equal(j.referenceSource, 'cogunluk');
    assert.equal(j.special.formatOnlyHosts, 0);
    // Eski veride yalniz kendi tablosu okunur: OTEKI kokun satir/sutun sorgusu yok.
    const oteki = root === 'vhosting' ? 'dbo.InitScriptsInventory8' : 'dbo.InitScriptsInventory';
    const tablo = root === 'vhosting' ? 'dbo.InitScriptsInventory' : 'dbo.InitScriptsInventory8';
    const okunan = sorgular
      .filter((t) => /^\s*SELECT (host|c\.name)/.test(t))
      .map((t) => (t.match(/FROM (dbo\.\w+)\s/) || t.match(/OBJECT_ID\('([^']+)'\)/) || [])[1]);
    assert.ok(!okunan.includes(oteki), `${root}: oteki kok okunmamali (${okunan})`);
    assert.ok(okunan.includes(tablo));
  }
});

test('IR6 GBEVM/GBPRV genel envanterin ekip referansina gore olculur', async () => {
  DB = {
    rows: [satir('GBN1', V.nl, SH), satir('GBN2', V.nl, SH), satir('GBEVM01', V.repo, SH), satir('GBPRV01', V.real, SH)],
    detail: [
      detay('vhosting', 'GBN1', 'appdomain.service', V.nl),
      detay('vhosting', 'GBN2', 'appdomain.service', V.nl),
      detay('vhosting', 'GBEVM01', 'appdomain.service', V.repo),
      detay('vhosting', 'GBPRV01', 'appdomain.service', V.real),
    ],
    refs: [{ script: 'appdomain.service', raw_sha512: fp(V.repo).raw, norm_sha512: fp(V.repo).norm }],
  };
  const j = await al();
  assert.ok(j.special);
  const s = script(j.special, 'appdomain_service');
  assert.equal(s.referenceSource, 'ekip');
  assert.equal(s.deviatingCount, 1, 'GBPRV01 gercek fark');
  assert.deepEqual(j.special.hostRows.find((r) => r.host === 'GBEVM01').deviations, []);
});

test('IR7 ek tablo sorgusu duserse 200, extrasError dolu, eski davranis', async () => {
  const hosts = filo();
  DB = { rows: hosts.map(([h, s]) => satir(h, s, SH)), extrasThrow: true };
  const j = await al();
  assert.match(j.extrasError, /detay sorgusu dustu/);
  assert.equal(script(j, 'appdomain_service').deviatingCount, 8);
  assert.equal(j.detailAvailable, false);
});

test('IR8 verinin yasi: load_date > scan_date > bilinmiyor', async () => {
  const rows = [satir('GBY1', V.nl, SH)];
  DB = { rows, cols: [...ALL_COLS, 'load_date'], loadDate: { t: '2026-11-11 03:00:00', m: 3 * 1440 + 30 } };
  let j = await al();
  assert.deepEqual([j.loadedAt, j.ageDays, j.ageMinutes, j.ageSource], ['2026-11-11 03:00:00', 3, 3 * 1440 + 30, 'load_date']);

  // load_date sutunu yok (eski loader) ama ayrinti tablosu var -> scan_date
  DB = {
    rows,
    detail: [detay('vhosting', 'GBY1', 'appdomain.service', V.nl)],
    scanDate: { t: '2026-11-14 01:00:00', m: 90 },
    expectRoot: 'vhosting',
  };
  j = await al();
  assert.deepEqual([j.loadedAt, j.ageDays, j.ageSource], ['2026-11-14 01:00:00', 0, 'scan_date']);

  // sutun var ama bos (hic yuklenmemis) ve ayrinti yok -> bilinmiyor
  DB = { rows, cols: [...ALL_COLS, 'load_date'] };
  j = await al();
  assert.deepEqual([j.loadedAt, j.ageDays, j.ageSource], [null, null, null]);

  // hicbiri yok (eski veri)
  DB = { rows };
  j = await al();
  assert.equal(j.loadedAt, null);
  assert.equal(j.ageSource, null);
  assert.equal(script(j, 'appdomain_service').majorityCount, 1, 'yas sorgusu raporu bozmamali');

  // yas sorgusu duserse ekran yine 200 doner, yas bilinmiyor
  DB = { rows, cols: [...ALL_COLS, 'load_date'], ageThrow: true };
  j = await al();
  assert.deepEqual([j.loadedAt, j.ageSource], [null, null]);
});

test('IR9 istemci: veri yasi seridi, yas bilinmiyorsa uyari, bicim/CRLF/okunamaz ayrimi', () => {
  const fs = require('node:fs');
  const page = fs.readFileSync(path.join(SERVER, '..', 'src', 'components', 'DenetimPage.tsx'), 'utf8');
  const tek = page.replace(/\s+/g, ' ');
  assert.ok(tek.includes('{data && data.ageSource !== undefined && <InitDataAge data={data} job={meta.job} />}'), 'yas seridi cizilmiyor');
  assert.match(page, /const INIT_STALE_DAYS = 2;/);
  assert.match(page, /const old = known && \(minutes \?\? \(days as number\) \* 1440\) > INIT_STALE_DAYS \* 1440;/);
  assert.match(page, /const stale = !known \|\| old;/);
  assert.ok(
    tek.includes('<b>Veri {days} gün önce yüklendi — <code>{job}</code> işi çalışmıyor olabilir.</b>'),
    '2 gunden eski veri uyarisi yok',
  );
  assert.ok(
    tek.includes("{data.detailAvailable ? 'Yalnız boşluk/satır sonu farkı olan kopyalar sapma sayılmaz.'"),
    'eski veride bicim farki iddiasi yapilmamali',
  );
  assert.ok(page.includes('Verinin yaşı bilinmiyor (eski yükleyici); sonuçlar güncel olmayabilir.'));
  for (const alan of [
    '(h.formatOnly || []).map(',
    '(h.crlf || []).map(',
    '(h.unreadable || []).map(',
    'sc.crlfHosts!.slice(0, 40)',
    'sc.unreadableHosts!.slice(0, 40)',
    'v.rawVariants!.map(',
  ]) {
    assert.ok(page.includes(alan), `${alan} ekranda gosterilmiyor`);
  }
});

test('IR10 kismi ek tablo hatasi: ayrinti okundu ama referans dustu -> tamamen eski yol', async () => {
  const hosts = filo();
  DB = {
    rows: hosts.map(([h, s]) => satir(h, s, SH)),
    detail: hosts.flatMap(([h, s]) => [detay('vhosting', h, 'appdomain.service', s), detay('vhosting', h, 'start.sh', SH)]),
    refs: [{ script: 'appdomain.service', raw_sha512: fp(V.repo).raw, norm_sha512: fp(V.repo).norm }],
    refThrow: true,
  };
  const j = await al();
  assert.match(j.extrasError, /referans sorgusu dustu/);
  assert.equal(j.detailAvailable, false, 'yarim okunan ayrinti kullanilmamali');
  assert.equal(j.formatOnlyHosts, 0);
  const a = script(j, 'appdomain_service');
  assert.deepEqual([a.variantCount, a.deviatingCount, a.formatOnlyCount], [3, 8, 0], 'eski yol (ham + cogunluk)');
});

test('IR11 ayrinti satiri eksik kopya ayni ham hash uzerinden normu alir: tek surum', async () => {
  const hosts = filo();
  DB = {
    rows: hosts.map(([h, s]) => satir(h, s, SH)),
    // GBCRLF1..2 icin ayrinti satiri YOK (ornegin yarim tarama); ham hash GBCRLF0 ile ayni.
    // (CRLF secildi: kanonik LF kopyanin ham hash'i normuyla ZATEN ayni, kor kalirdi.)
    detail: hosts
      .filter(([h]) => !/^GBCRLF[12]$/.test(h))
      .flatMap(([h, s]) => [detay('vhosting', h, 'appdomain.service', s), detay('vhosting', h, 'start.sh', SH)]),
  };
  const j = await al();
  const a = script(j, 'appdomain_service');
  assert.equal(j.detailAvailable, true);
  assert.equal(a.variantCount, 1, 'ayni icerik ham/norm anahtari yuzunden iki surum sayildi');
  assert.equal(a.deviatingCount, 0, 'ayni icerik sapma sayildi');
  assert.equal(a.formatOnlyCount, 8, 'depo (5) + CRLF (3) kopyalar yalniz bicim farki');
  assert.equal(j.totalVariants, 2);
});

test('IR12 startCustom.sh CRLF: script ve sunucu satiri tutarli', async () => {
  const C = ['host', 'appdomain_service', 'startCustom_sh'];
  const rows = [
    { host: 'GBC1', appdomain_service: fp(V.nl).raw, startCustom_sh: fp(SH_CRLF).raw },
    { host: 'GBC2', appdomain_service: fp(V.nl).raw, startCustom_sh: fp(SH).raw },
  ];
  DB = {
    rows,
    cols: C,
    detail: [
      detay('vhosting', 'GBC1', 'appdomain.service', V.nl),
      detay('vhosting', 'GBC2', 'appdomain.service', V.nl),
      detay('vhosting', 'GBC1', 'startCustom.sh', SH_CRLF),
      detay('vhosting', 'GBC2', 'startCustom.sh', SH),
    ],
  };
  const j = await al();
  const c = script(j, 'startCustom_sh');
  assert.deepEqual(c.crlfHosts, ['GBC1']);
  assert.deepEqual(j.hostRows.find((r) => r.host === 'GBC1').crlf, ['startCustom.sh']);
  assert.equal(j.crlfHosts, 1);
});

test('IR13 referans tablosunda cift satir: sirali ilk kazanir', async () => {
  const a = fp(V.repo);
  const b = fp(V.real);
  const [kucuk, buyuk] = a.norm < b.norm ? [a, b] : [b, a];
  DB = {
    rows: [satir('GBR1', V.nl, SH)],
    detail: [detay('vhosting', 'GBR1', 'appdomain.service', V.nl)],
    // girdi sirasi: buyuk once - sorgu siralamazsa ya da son kazanirsa sonuc degisir
    refs: [
      { script: 'appdomain.service', raw_sha512: buyuk.raw, norm_sha512: buyuk.norm },
      { script: 'appdomain.service', raw_sha512: kucuk.raw, norm_sha512: kucuk.norm },
    ],
  };
  const j = await al();
  assert.equal(script(j, 'appdomain_service').referenceNorm, kucuk.norm);
});

test('IR14 istemci: eski veri/Deployment gorunumu korunur, yaniltici "sapma sayilmaz" yok', () => {
  const fs = require('node:fs');
  const page = fs.readFileSync(path.join(SERVER, '..', 'src', 'components', 'DenetimPage.tsx'), 'utf8');
  const tek = page.replace(/\s+/g, ' ');
  const var_ = (s, m) => assert.ok(tek.includes(s), m || s);
  var_("const ekipVar = shown?.referenceSource === 'ekip' || shown?.referenceSource === 'karma';");
  var_("{ekipVar ? 'Referans' : 'Çoğunluk'}", 'eski veride baslik Cogunluk kalmali');
  var_('{ekipVar && sc.referenceSource && !sc.perServer && (', 'cogunluk cipi eski veride cizilmemeli');
  var_("...(kind === 'init' ? ['bicim_farki', 'crlf', 'okunamayan'] : []),", 'Deployment sunucu CSV eski sutunlar');
  var_("...(kind === 'init' ? [ 'referans_kaynak',", 'Deployment script CSV eski sutunlar');
  var_("{!sc.perServer && isRef ? ' — referansla aynı içerik, sapma sayılmaz:'", 'sapma sayilmaz yalniz referans surumunde');
  assert.ok(!tek.includes('(satır sonu / boşluk) — sapma sayılmaz:'), 'kosulsuz sapma sayilmaz metni kaldi');
  var_('const tumuSapiyor = !sc.perServer && n <= 1 && sc.deviatingCount > 0;');
  var_(": tumuSapiyor ? 'bg-amber-50 text-amber-700 border-amber-200'", 'tum filo sapiyorken yesil');
  var_('{sc.hostWide && shown?.detailAvailable && (', 'eski veride sunucu geneli iddiasi');
  var_('{sc.referenceHash || sc.referenceNorm ? (sc.referenceCount ?? sc.majorityCount) : sc.majorityCount}', 'startCustom adedi 0 gorunur');
});
