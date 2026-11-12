// server/nginx-console/__tests__/eski-sunucu.test.cjs - Nginx Hub eski (kapatilmis) sunucular
// (kullanici, 2026-11-12). Kural: envanterde (dbo.Inventory, nginx_version dolu) YOK ve 14+ gundur
// hicbir kaynakta gorulmedi -> eski. Envanter okunamazsa hicbiri eski degil (fail-closed).
// Temizlik: yeniden kontrol, parcali silme (TOP 5000), istek basina 50 sunucu / 20000 satir,
// kati yol icerme, yalniz Admin.
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-eski-'));
const raw = path.join(dir, 'raw');
fs.mkdirSync(raw);
process.env.NGINX_CONSOLE_DIR = dir;
delete process.env.NGINX_ESKI_SUNUCU_GUN;
const nc = require('../index.cjs');
const es = require('../eski-sunucu.cjs');

const SIMDI = Date.parse('2026-11-12T12:00:00Z');
const GUN = 24 * 3600 * 1000;
const gunOnce = (n) => new Date(SIMDI - n * GUN);
const tarih = (n) => gunOnce(n).toISOString().slice(0, 10);

// -- Sahte TBMWANS ----------------------------------------------------------------------
function sahteTbmwans() {
  const t = {
    envanter: [{ host: 'GBNGXP01' }, { host: 'gbngxp02.bmw.local' }, { host: 'GBNGXP03' }],
    envanterHata: null,
    sinyalHata: null,
    tablolar: new Map(), // 'dbo.X' -> [{host, scan_date}]
    nginxInv: [],
    deletes: [],
    deleteHata: new Map(), // tablo -> mesaj
    normalSilmez: false, // normallestirilmis DELETE hic satir silmesin (kalan satir senaryosu)
    sorgular: [],
  };
  const sql = { Date: 'Date', Int: 'Int', NVarChar: (n) => `NVarChar(${n})` };
  async function query(text, params = []) {
    t.sorgular.push({ text, params });
    const p = Object.fromEntries(params.map((x) => [x.name, x]));
    if (/FROM dbo\.Inventory WHERE nginx_version/.test(text)) {
      if (t.envanterHata) throw new Error(t.envanterHata);
      return { recordset: t.envanter };
    }
    if (/OBJECT_ID\('/.test(text)) {
      const satir = {};
      for (const m of text.matchAll(/OBJECT_ID\('([^']+)'\) AS (t\d+)/g)) {
        const ad = m[1];
        satir[m[2]] = ad === 'dbo.nginx_inventory' || t.tablolar.has(ad) ? 1 : null;
      }
      return { recordset: [satir] };
    }
    let m = /SELECT DISTINCT UPPER\(LTRIM\(RTRIM\(host\)\)\) AS host FROM (dbo\.\w+) WHERE scan_date >= @esik/.exec(text);
    if (m) {
      if (t.sinyalHata) throw new Error(t.sinyalHata);
      assert.equal(p.esik.type, 'Date');
      const rows = (t.tablolar.get(m[1]) || []).filter((r) => new Date(r.scan_date) >= p.esik.value);
      return { recordset: [...new Set(rows.map((r) => r.host.trim().toUpperCase()))].map((host) => ({ host })) };
    }
    if (/FROM dbo\.nginx_inventory/.test(text)) return { recordset: t.nginxInv };
    m = /FROM (dbo\.\w+) GROUP BY UPPER/.exec(text);
    if (m && /COUNT_BIG/.test(text)) {
      const g = new Map();
      for (const r of t.tablolar.get(m[1]) || []) {
        const h = r.host.trim().toUpperCase();
        const x = g.get(h) || { host: h, n: '0', son: null };
        x.n = String(Number(x.n) + 1); // bigint string gibi
        if (!x.son || r.scan_date > x.son) x.son = r.scan_date;
        g.set(h, x);
      }
      return { recordset: [...g.values()] };
    }
    m = /^DELETE TOP \(@n\) FROM (dbo\.\w+) WHERE (host|UPPER\(LTRIM\(RTRIM\(host\)\)\)) = @h$/.exec(text);
    if (m) {
      assert.equal(p.n.type, 'Int');
      assert.equal(p.h.type, 'NVarChar(64)');
      if (t.deleteHata.has(m[1])) throw new Error(t.deleteHata.get(m[1]));
      const normal = m[2] !== 'host';
      // SQL Server: duz esitlik sondaki boslugu yok sayar (harf duyarsiz harmanlama), bastakini SAYMAZ.
      const esit = normal
        ? (h) => !t.normalSilmez && h.trim().toUpperCase() === p.h.value
        : (h) => h.replace(/\s+$/, '').toUpperCase() === p.h.value;
      const rows = t.tablolar.get(m[1]) || [];
      let k = 0;
      const kalan = [];
      for (const r of rows) {
        if (k < p.n.value && esit(r.host)) k++;
        else kalan.push(r);
      }
      t.tablolar.set(m[1], kalan);
      t.deletes.push({ tablo: m[1], n: p.n.value, host: p.h.value, k, normal });
      return { recordset: [], rowsAffected: [k] };
    }
    throw new Error('beklenmeyen sorgu: ' + text);
  }
  t.api = { query, queryLong: query, sql };
  return t;
}

// -- Sahte Portal DB --------------------------------------------------------------------
function sahtePortal() {
  const t = { tablolar: new Map(), deletes: [], hata: new Map() };
  async function query(text, params = [], opts = {}) {
    let m = /COUNT\(\*\) AS n FROM (\w+) WHERE host IS NOT NULL GROUP BY/.exec(text);
    if (m) {
      if (!t.tablolar.has(m[1])) throw new Error(`Invalid object name '${m[1]}'.`);
      const g = new Map();
      for (const r of t.tablolar.get(m[1])) if (r.host != null) g.set(r.host.trim().toUpperCase(), (g.get(r.host.trim().toUpperCase()) || 0) + 1);
      return { rows: [...g].map(([host, n]) => ({ host, n })), rowCount: g.size };
    }
    m = /^DELETE TOP \((\d+)\) FROM (\w+) WHERE (host|UPPER\(LTRIM\(RTRIM\(host\)\)\)) = \$1$/.exec(text);
    if (m) {
      assert.equal(opts.tekrar, false, 'silme yeniden denenmemeli');
      if (t.hata.has(m[2])) throw new Error(t.hata.get(m[2]));
      const n = Number(m[1]);
      const normal = m[3] !== 'host';
      const esit = (h) =>
        h != null && (normal ? h.trim().toUpperCase() : h.replace(/\s+$/, '').toUpperCase()) === params[0];
      let k = 0;
      const kalan = [];
      for (const r of t.tablolar.get(m[2]) || []) {
        if (k < n && esit(r.host)) k++;
        else kalan.push(r);
      }
      t.tablolar.set(m[2], kalan);
      t.deletes.push({ tablo: m[2], n, k, normal });
      return { rows: [], rowCount: k };
    }
    throw new Error('beklenmeyen portal sorgusu: ' + text);
  }
  t.api = { query };
  return t;
}

let tb;
let pdb;
function dosya(ad, gunOnceN, icerik = 'x') {
  const p = path.join(raw, ad);
  fs.writeFileSync(p, icerik);
  const t = gunOnce(gunOnceN);
  fs.utimesSync(p, t, t);
  return p;
}
function rawTemizle() {
  for (const ad of fs.readdirSync(raw)) fs.rmSync(path.join(raw, ad), { recursive: true, force: true });
}

beforeEach(() => {
  rawTemizle();
  delete process.env.NGINX_ESKI_SUNUCU_GUN;
  tb = sahteTbmwans();
  pdb = sahtePortal();
  es._test.sifirla();
  es._test.bagla({ tbmwans: () => tb.api, portal: () => pdb.api, simdi: () => SIMDI });
});

test('ES1 esik gun: varsayilan 14, ortam degiskeni, alt sinir 7, gecersiz deger 14', () => {
  assert.equal(es.esikGun(), 14);
  process.env.NGINX_ESKI_SUNUCU_GUN = '30';
  assert.equal(es.esikGun(), 30);
  process.env.NGINX_ESKI_SUNUCU_GUN = '2';
  assert.equal(es.esikGun(), 7);
  process.env.NGINX_ESKI_SUNUCU_GUN = 'abc';
  assert.equal(es.esikGun(), 14);
  process.env.NGINX_ESKI_SUNUCU_GUN = '';
  assert.equal(es.esikGun(), 14);
});

test('ES2 kural: envanterde yok + 14 gun hicbir kaynakta yok -> eski; herhangi bir taze sinyal korur', async () => {
  tb.tablolar.set('dbo.Nginx_Audit_Hosts', [
    { host: 'GBTAZEA1', scan_date: tarih(1) },
    { host: 'GBESKI01', scan_date: tarih(40) },
  ]);
  tb.tablolar.set('dbo.Nginx_Cis_Hosts', [{ host: 'gbtazec1 ', scan_date: tarih(13) }]);
  tb.tablolar.set('dbo.Nginx_Audit_Settings', [{ host: 'GBALTT01', scan_date: tarih(1) }]); // sinyal tablosu degil
  tb.nginxInv = [
    { hostname: 'GBINVT01', source_last_update: gunOnce(2).toISOString() },
    { hostname: 'GBINVE01', source_last_update: gunOnce(30).toISOString() },
    { hostname: 'GBINVN01', source_last_update: null },
  ];
  dosya('GBDUMPT1.txt', 3);
  dosya('GBDUMPE1.txt', 20);
  dosya('GBSEEN01.txt', 30);
  fs.writeFileSync(path.join(raw, '_seen.json'), JSON.stringify({ at: gunOnce(1).toISOString(), hosts: { gbseen01: gunOnce(1).toISOString() } }));
  const d = await es.durum();
  assert.equal(d.ok, true, d.hata);
  const eski = (h) => es.eskiMi(d, h);
  assert.equal(eski('GBNGXP01'), false, 'envanterde');
  assert.equal(eski('GBNGXP02'), false, 'envanterde FQDN ile (kisa ad)');
  assert.equal(eski('gbngxp02.bmw.local'), false);
  assert.equal(eski('gbngxp03.bmw.local'), false, 'tabloda FQDN, envanterde kisa ad');
  assert.equal(eski('GBTAZEA1'), false, 'audit taramasi taze');
  assert.equal(eski('GBTAZEC1'), false, 'CIS 13 gun once (esik icinde)');
  assert.equal(eski('GBINVT01'), false, 'nginx_inventory taze');
  assert.equal(eski('GBINVN01'), false, 'nginx_inventory tarihsiz satir gorulmus sayilir');
  assert.equal(eski('GBDUMPT1'), false, 'dokum 3 gun once');
  assert.equal(eski('GBSEEN01'), false, '_seen.json dokumden yeni');
  assert.equal(eski('GBESKI01'), true, '40 gun once taranmis');
  assert.equal(eski('GBINVE01'), true, 'nginx_inventory 30 gun eski');
  assert.equal(eski('GBDUMPE1'), true, 'yalniz 20 gunluk dokum');
  assert.equal(eski('GBALTT01'), true, 'alt tablo sinyal sayilmaz (ayni isin Hosts tablosu belirler)');
  assert.equal(eski('GBHICYOK'), true);
  assert.equal(eski(''), false);
  process.env.NGINX_ESKI_SUNUCU_GUN = '30';
  const d30 = await es.durum({ taze: true });
  assert.equal(es.eskiMi(d30, 'GBDUMPE1'), false, '30 gun esikte 20 gunluk dokum taze');
});

for (const [ad, kur] of [
  ['envanter sorgusu hata', () => { tb.envanterHata = 'Login failed'; }],
  ['envanter bos', () => { tb.envanter = []; }],
  ['sinyal tablosu okunamadi', () => { tb.tablolar.set('dbo.Nginx_Audit_Hosts', []); tb.sinyalHata = 'timeout'; }],
  ['raw dizini yok', () => { es._test.bagla({ tbmwans: () => tb.api, portal: () => pdb.api, simdi: () => SIMDI, yerel: () => ({ ...nc, rawDir: () => path.join(dir, 'yok') }) }); }],
]) {
  test(`ES3 fail-closed (${ad}): hicbir sunucu eski degil, liste degismez, aday listesi 503`, async () => {
    kur();
    const d = await es.durum({ taze: true });
    assert.equal(d.ok, false);
    assert.equal(es.eskiMi(d, 'GBHICYOK'), false);
    const s = await es.suzgec({ query: {} });
    const rows = [{ host: 'GBHICYOK' }, { host: 'GBNGXP01' }];
    assert.deepEqual(s.ayir(rows), rows);
    assert.equal(s.bilgi().sayi, 0);
    assert.equal(s.bilgi().olculemedi, true);
    await assert.rejects(es.adaylar(), (e) => e.status === 503);
    await assert.rejects(es.temizle({ hosts: ['GBHICYOK'], onay: 'SIL' }), (e) => e.status === 503);
    assert.equal(tb.deletes.length + pdb.deletes.length, 0, 'fail-closed iken hicbir DELETE');
  });
}

test('ES4 suzgec: eskiler gizlenir ve sayilir; ?eskiler=1 gizlemeyi kapatir; tek ucus + onbellek', async () => {
  const s = await es.suzgec({ query: {} });
  const out = s.ayir([{ host: 'GBNGXP01' }, { host: 'GBOLU001' }, { host: 'gbolu001' }, { hostname: 'X' }]);
  assert.deepEqual(out.map((r) => r.host), ['GBNGXP01', undefined]);
  assert.deepEqual(s.bilgi(), { sayi: 1, hostlar: ['GBOLU001'], gun: 14, gosteriliyor: false, olculemedi: false });
  const g = await es.suzgec({ query: { eskiler: '1' } });
  assert.equal(g.ayir([{ host: 'GBOLU001' }]).length, 1);
  assert.equal(g.bilgi().gosteriliyor, true);
  // Onbellek: ikinci suzgec yeni envanter sorgusu atmaz; ayni anda iki cagri tek hesap.
  const once = tb.sorgular.filter((q) => /dbo\.Inventory/.test(q.text)).length;
  es.sifirla();
  await Promise.all([es.durum(), es.durum(), es.suzgec({ query: {} })]);
  await es.suzgec({ query: {} });
  assert.equal(tb.sorgular.filter((q) => /dbo\.Inventory/.test(q.text)).length, once + 1);
});

function senaryo() {
  tb.tablolar.set('dbo.Nginx_Audit_Hosts', [
    { host: 'GBNGXP01', scan_date: tarih(1) },
    { host: 'GBOLU001', scan_date: tarih(30) },
    { host: 'GBOLU001', scan_date: tarih(31) },
  ]);
  tb.tablolar.set('dbo.Nginx_Config_Audit', [{ host: 'GBOLU001', scan_date: tarih(30) }]);
  pdb.tablolar.set('nginx_hub_file_history', [{ host: 'GBOLU001' }, { host: 'GBOLU001' }, { host: 'GBNGXP01' }]);
  pdb.tablolar.set('nginx_hub_file_state', [{ host: 'GBOLU001' }]);
  pdb.tablolar.set('nginx_cis_exceptions', [{ host: null }, { host: 'GBOLU001' }]);
  // nginx_audit_exceptions YOK (tablo eksik): sayim atlanir
  dosya('GBOLU001.txt', 30);
  dosya('GBOLU001.summary.json', 30);
  dosya('GBOLU001.summary.json.tmp1234', 30);
  dosya('GBOLU0011.txt', 30); // ayni onekli BASKA sunucu
  dosya('GBNGXP01.txt', 1);
  fs.writeFileSync(path.join(raw, '_seen.json'), JSON.stringify({ at: gunOnce(1).toISOString(), hosts: { GBNGXP01: gunOnce(1).toISOString(), gbolu001: gunOnce(30).toISOString() } }));
}

test('ES5 aday listesi: kaynak basina sayim, dosyalar, son gorulme; envanterdeki sunucu aday degil', async () => {
  senaryo();
  const a = await es.adaylar();
  assert.deepEqual(a.adaylar.map((x) => x.host), ['GBOLU001', 'GBOLU0011']);
  const x = a.adaylar[0];
  assert.deepEqual(x.dosyalar, ['GBOLU001.summary.json', 'GBOLU001.summary.json.tmp1234', 'GBOLU001.txt']);
  assert.deepEqual(x.tbmwans, { 'dbo.Nginx_Audit_Hosts': 2, 'dbo.Nginx_Config_Audit': 1 });
  assert.deepEqual(x.portal, { nginx_hub_file_history: 2, nginx_hub_file_state: 1, nginx_cis_exceptions: 1 });
  assert.equal(x.toplamSatir, 7);
  assert.equal(x.sonTarama, tarih(30));
  assert.ok(x.sonGorulme && Date.parse(x.sonGorulme) <= SIMDI - 29 * GUN);
  assert.deepEqual(a.sinirlar, { maksHost: 50, maksSatir: 20000, parca: 5000 });
  // dbo.nginx_inventory ve dbo.Inventory hic sayilmaz/silinmez
  assert.ok(!tb.sorgular.some((q) => /COUNT_BIG[\s\S]*(nginx_inventory|dbo\.Inventory)/.test(q.text)));
});

test('ES6 istek dogrulama: onay SIL zorunlu, en fazla 50 sunucu, gecersiz ad', async () => {
  for (const [govde, re] of [
    [{ hosts: ['GBOLU001'] }, /Onay eksik/],
    [{ hosts: ['GBOLU001'], onay: 'sil' }, /Onay eksik/],
    [{ hosts: [], onay: 'SIL' }, /En az bir/],
    [{ hosts: Array.from({ length: 51 }, (_, i) => `GBX${String(i).padStart(4, '0')}`), onay: 'SIL' }, /en fazla 50/],
    [{ hosts: ['../etc'], onay: 'SIL' }, /Geçersiz sunucu/],
    [{ hosts: ['GB OLU'], onay: 'SIL' }, /Geçersiz sunucu/],
  ]) {
    await assert.rejects(es.temizle(govde), (e) => e.status === 400 && re.test(e.message));
  }
  assert.equal(tb.sorgular.length, 0, 'gecersiz istekte DB okunmaz bile');
});

test('ES7 silme aninda yeniden kontrol: envanterdeki / yeni taranmis sunucu istenirse HICBIR SEY silinmez', async () => {
  senaryo();
  await assert.rejects(es.temizle({ hosts: ['GBOLU001', 'GBNGXP01'], onay: 'SIL' }), (e) => e.status === 409 && e.reddedilen.join() === 'GBNGXP01');
  // Ekran listeledikten sonra sunucu yeniden taranmis:
  await es.adaylar();
  tb.tablolar.get('dbo.Nginx_Audit_Hosts').push({ host: 'GBOLU001', scan_date: tarih(0) });
  await assert.rejects(es.temizle({ hosts: ['GBOLU001'], onay: 'SIL' }), (e) => e.status === 409);
  assert.equal(tb.deletes.length + pdb.deletes.length, 0);
  assert.ok(fs.existsSync(path.join(raw, 'GBOLU001.txt')));
});

test('ES8 temizlik: DB satirlari + yalniz o sunucunun dosyalari + _seen anahtari; NULL istisna ve komsu sunucu korunur', async () => {
  senaryo();
  let dinlendi = 0;
  es.onTemizlik(() => dinlendi++);
  const r = await es.temizle({ hosts: ['gbolu001'], onay: 'SIL' });
  assert.equal(r.kalanVar, false);
  assert.equal(r.toplamSatir, 7);
  const h = r.hosts[0];
  assert.equal(h.tamam, true, JSON.stringify(h.hatalar));
  assert.deepEqual(h.dosyalar.sort(), ['GBOLU001.summary.json', 'GBOLU001.summary.json.tmp1234', 'GBOLU001.txt']);
  assert.equal(h.seen, true);
  assert.deepEqual(fs.readdirSync(raw).sort(), ['GBNGXP01.txt', 'GBOLU0011.txt', '_seen.json']);
  const seen = JSON.parse(fs.readFileSync(path.join(raw, '_seen.json'), 'utf8'));
  assert.deepEqual(Object.keys(seen.hosts), ['GBNGXP01']);
  assert.deepEqual(pdb.tablolar.get('nginx_cis_exceptions'), [{ host: null }], 'filo geneli istisna (host NULL) kalir');
  assert.deepEqual(pdb.tablolar.get('nginx_hub_file_history'), [{ host: 'GBNGXP01' }]);
  assert.deepEqual(tb.tablolar.get('dbo.Nginx_Audit_Hosts').map((x) => x.host), ['GBNGXP01']);
  assert.equal(dinlendi, 1, 'temizlik dinleyicisi (onbellekler) cagrildi');
  // Portal once, sonra TBMWANS; her DELETE TOP <= 5000
  assert.ok([...tb.deletes, ...pdb.deletes].every((d) => d.n <= 5000));
  const ikinci = await es.adaylar();
  assert.ok(!ikinci.adaylar.some((x) => x.host === 'GBOLU001'), 'temizlenen sunucu artik aday degil');
});

test('ES9 parcali silme ve istek basina 20000 satir siniri: kalan rapor edilir, yarim kalan sunucunun dosyasi silinmez', async () => {
  const rows = (h, n) => Array.from({ length: n }, () => ({ host: h, scan_date: tarih(40) }));
  tb.tablolar.set('dbo.Nginx_Audit_Settings', [...rows('GBAAA001', 12000), ...rows('GBBBB001', 9000), ...rows('GBCCC001', 10)]);
  tb.tablolar.set('dbo.Nginx_Audit_Hosts', [...rows('GBAAA001', 1), ...rows('GBBBB001', 1), ...rows('GBCCC001', 1)]);
  dosya('GBAAA001.txt', 40);
  dosya('GBBBB001.txt', 40);
  dosya('GBCCC001.txt', 40);
  const r = await es.temizle({ hosts: ['GBAAA001', 'GBBBB001', 'GBCCC001'], onay: 'SIL' });
  assert.equal(r.toplamSatir, 20000);
  assert.equal(r.butceDoldu, true);
  assert.equal(r.kalanVar, true);
  const [a, b, c] = r.hosts;
  assert.equal(a.tamam, true);
  assert.deepEqual(a.silinenSatir, { 'dbo.Nginx_Audit_Hosts': 1, 'dbo.Nginx_Audit_Settings': 12000 });
  assert.equal(b.tamam, false);
  assert.equal(b.silinenSatir['dbo.Nginx_Audit_Hosts'], 1);
  assert.equal(b.silinenSatir['dbo.Nginx_Audit_Settings'], 20000 - 12001 - 1);
  assert.deepEqual(b.dosyalar, [], 'yarim kalan sunucunun dokumu silinmez (aday listesinde kalir)');
  assert.equal(c.islenmedi, true);
  assert.ok(fs.existsSync(path.join(raw, 'GBBBB001.txt')) && fs.existsSync(path.join(raw, 'GBCCC001.txt')));
  assert.ok(!fs.existsSync(path.join(raw, 'GBAAA001.txt')));
  // Parcalar: 12000 -> 5000, 5000, 2000; hicbir parca 5000'i asmaz, butce asilmaz.
  const aParca = tb.deletes.filter((d) => d.host === 'GBAAA001' && d.tablo === 'dbo.Nginx_Audit_Settings').map((d) => d.k);
  assert.deepEqual(aParca, [5000, 5000, 2000]);
  assert.ok(tb.deletes.every((d) => d.n >= 1 && d.n <= 5000));
  // Ikinci kosu kalani bitirir.
  const r2 = await es.temizle({ hosts: ['GBBBB001', 'GBCCC001'], onay: 'SIL' });
  assert.equal(r2.kalanVar, false);
  assert.equal(r2.toplamSatir, 9000 - 7998 + 11);
  assert.deepEqual(fs.readdirSync(raw), []);
});

test('ES10 silme hatasi (izin yok): hata raporlanir, diger tablolar denenir, dosyalar SILINMEZ', async () => {
  senaryo();
  tb.deleteHata.set('dbo.Nginx_Config_Audit', "The DELETE permission was denied on the object 'Nginx_Config_Audit'");
  const r = await es.temizle({ hosts: ['GBOLU001'], onay: 'SIL' });
  const h = r.hosts[0];
  assert.equal(h.tamam, false);
  assert.match(h.hatalar[0].mesaj, /permission was denied/);
  assert.equal(h.silinenSatir['dbo.Nginx_Audit_Hosts'], 2);
  assert.ok(fs.existsSync(path.join(raw, 'GBOLU001.txt')));
  assert.equal(r.kalanVar, true);
});

test('ES11 yol icerme: dizin ve sembolik bag silinmez; yalniz HOST.(txt|summary.json[.tmpN]) kalibi', async () => {
  fs.mkdirSync(path.join(raw, 'GBOLU002.txt')); // dosya degil dizin
  dosya('GBOLU002.summary.json', 30);
  dosya('GBOLU002.txt.bak', 30);
  dosya('GBOLU002.summary.json.tmpX', 30);
  const disari = path.join(dir, 'disari.txt');
  fs.writeFileSync(disari, 'dokunma');
  let bag = false;
  try {
    fs.symlinkSync(disari, path.join(raw, 'GBOLU003.txt'));
    bag = true;
  } catch {
    /* Windows'ta yetki yoksa sembolik bag kurulamaz; bu alt kontrol atlanir */
  }
  const f = es._test.hostDosyalariniSil('GBOLU002');
  assert.deepEqual(f.silinen, ['GBOLU002.summary.json']);
  assert.deepEqual(f.atlanan, ['GBOLU002.txt']);
  assert.ok(fs.existsSync(path.join(raw, 'GBOLU002.txt.bak')) && fs.existsSync(path.join(raw, 'GBOLU002.summary.json.tmpX')));
  if (bag) {
    const g = es._test.hostDosyalariniSil('GBOLU003');
    assert.deepEqual(g.silinen, []);
    assert.ok(fs.existsSync(disari));
  }
  assert.throws(() => es._test.hostDosyalariniSil('../x'), /gecersiz host/);
  assert.throws(() => es._test.hostDosyalariniSil('GB/OLU'), /gecersiz host/);
});

test('ES12 SQL: silme parametreli ve whitelist tablo; tablo adi dogrulanir', async () => {
  await assert.rejects(es._test.parcaliSil('tbmwans', 'dbo.X; DROP TABLE y', 'GBOLU001', 10), /gecersiz/);
  await assert.rejects(es._test.parcaliSil('tbmwans', 'dbo.Nginx_Audit_Hosts', "GB'X", 10), /gecersiz/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'eski-sunucu.cjs'), 'utf8');
  assert.ok(src.includes('DELETE TOP (@n) FROM ${tablo} WHERE host = @h'));
  assert.ok(src.includes('DELETE TOP (${n}) FROM ${tablo} WHERE host = $1'));
  assert.ok(!/nginx_inventory'?\s*}?,?\s*\n?\s*{ tablo: 'dbo\.Inventory/.test(src));
  for (const t of [...es.TBMWANS_TABLOLARI, ...es.PORTAL_TABLOLARI]) {
    assert.ok(!/nginx_inventory$|\.Inventory$/i.test(t.tablo), `${t.tablo} baska isin tablosu, silinmemeli`);
  }
  assert.deepEqual(es.SINIRLAR, { PARCA: 5000, MAKS_HOST: 50, MAKS_SATIR: 20000 });
});

test('ES13 yalniz Admin: uclar Admin disi okuma listesinde degil, router requireAdmin kullanir; uc denetim kaydi yazar', async () => {
  const { adminOkumaKapisi } = require('../../auth/admin-okuma-kapisi.cjs');
  assert.ok(adminOkumaKapisi);
  const kapi = nc._adminKapisi(() => true);
  const kos = (rol, method, p) => {
    let gecti = false;
    let durum = 200;
    const req = { method, path: p, session: { user: { username: 'u', role: rol } } };
    const res = { status(c) { durum = c; return this; }, json() { return this; } };
    kapi(req, res, () => { gecti = true; });
    return { gecti, durum };
  };
  for (const [m, p] of [['GET', '/eski-sunucular'], ['POST', '/eski-sunucular/temizle']]) {
    assert.equal(kos('User', m, p).gecti, false, `${m} ${p} Admin disina acik`);
    assert.equal(kos('Admin', m, p).gecti, true);
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.ok(src.includes("router.get('/eski-sunucular', requireAdmin, eskiAdaylarUcu);"));
  assert.ok(src.includes("router.post('/eski-sunucular/temizle', requireAdmin, eskiTemizleUcu);"));

  // Denetim kaydi: sahte audit modulu (require onbellegi)
  const auditYolu = require.resolve('../../audit/index.cjs');
  const kayitlar = [];
  const eski = require.cache[auditYolu];
  require.cache[auditYolu] = { id: auditYolu, filename: auditYolu, loaded: true, exports: { auditPortal: (req, action, opts) => kayitlar.push({ action, ...opts }) } };
  try {
    senaryo();
    const cevap = () => { const r = { kod: 200, govde: null, status(c) { r.kod = c; return r; }, json(b) { r.govde = b; return r; } }; return r; };
    const r1 = cevap();
    await nc._eskiUclariForTest.temizle({ body: { hosts: ['GBNGXP01'], onay: 'SIL' }, session: { user: { username: 'adm', role: 'Admin' } } }, r1);
    assert.equal(r1.kod, 409);
    assert.equal(kayitlar.at(-1).action, 'nginx_eski_sunucu_temizlik');
    assert.equal(kayitlar.at(-1).result, 'denied');
    const r2 = cevap();
    await nc._eskiUclariForTest.temizle({ body: { hosts: ['GBOLU001'], onay: 'SIL' }, session: { user: { username: 'adm', role: 'Admin' } } }, r2);
    assert.equal(r2.kod, 200);
    assert.equal(r2.govde.ok, true);
    const k = kayitlar.at(-1);
    assert.equal(k.result, 'ok');
    assert.equal(k.targetHost, 'GBOLU001');
    const detay = JSON.parse(k.detail);
    assert.equal(detay.toplamSatir, 7);
    assert.equal(detay.hosts[0].tamam, true);
    const r3 = cevap();
    await nc._eskiUclariForTest.adaylar({}, r3);
    assert.equal(r3.govde.ok, true);
    assert.ok(Array.isArray(r3.govde.adaylar));
  } finally {
    if (eski) require.cache[auditYolu] = eski;
    else delete require.cache[auditYolu];
  }
});

test('ES14 eszamanli temizlik reddedilir (kilit)', async () => {
  senaryo();
  let birak;
  const bekle = new Promise((r) => { birak = r; });
  const asil = pdb.api.query;
  pdb.api.query = async (...a) => { await bekle; return asil(...a); };
  const ilk = es.temizle({ hosts: ['GBOLU001'], onay: 'SIL' });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(es.temizle({ hosts: ['GBOLU001'], onay: 'SIL' }), (e) => e.status === 409 && /sürüyor/.test(e.message));
  birak();
  const r = await ilk;
  assert.equal(r.hosts[0].tamam, true);
});

test('ES15 uclar: listeleme uclari eskiGizli yazar ve suzgec ozetten once uygulanir (metin bekcisi)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  for (const s of [
    'hosts: es.ayir(hosts),',
    ': es.ayir(listDumpedHosts()).map((d) => d.host);',
    'const hosts = es.ayir(inv).filter(',
    'suz: (rows) => es.ayir(rows),',
    'changes: req.query.host ? rows : es.ayir(rows), eskiGizli: es.bilgi()',
  ]) assert.ok(src.includes(s), s);
  const cis = fs.readFileSync(path.join(__dirname, '..', '..', 'nginx-cis', 'index.cjs'), 'utf8');
  assert.ok(cis.indexOf('results: es.ayir(ham.results)') > 0 && cis.indexOf('results: es.ayir(ham.results)') < cis.indexOf('scoreAll({ ...raw, ...rules })'));
  const den = fs.readFileSync(path.join(__dirname, '..', '..', 'audit', 'denetim.cjs'), 'utf8');
  for (const s of [
    'hosts: suz(hosts.recordset || []),',
    'summarize(es.ayir(aggRes.recordset || []), es.ayir(srvRes.recordset || []), etk.m)',
    'summarizeLocations(es.ayir(r.recordset || []))',
    'es.ayir(r.recordset || [], (x) => x.hostname)',
    'const raw = es.ayir(rowsRes.recordset || []);',
  ]) assert.ok(den.includes(s), s);
  const rl = fs.readFileSync(path.join(__dirname, '..', 'ratelimit.cjs'), 'utf8');
  assert.ok(rl.indexOf("typeof suz === 'function'") < rl.indexOf('const ozet = summarize(hosts);'));
});

test('ES16 suresi dolan deger hemen doner, yenisi arka planda hesaplanir (liste uclari beklemez)', async () => {
  let saat = SIMDI;
  es._test.bagla({ tbmwans: () => tb.api, portal: () => pdb.api, simdi: () => saat });
  const d1 = await es.durum();
  assert.equal(es.eskiMi(d1, 'GBOLU009'), true);
  tb.envanter.push({ host: 'GBOLU009' });
  saat += 11 * 60 * 1000;
  const d2 = await es.durum();
  assert.equal(d2, d1, 'eski deger aninda');
  await new Promise((r) => setTimeout(r, 20));
  const d3 = await es.durum();
  assert.notEqual(d3, d1);
  assert.equal(es.eskiMi(d3, 'GBOLU009'), false, 'arka plan hesabi yeni envanteri gordu');
  // Silme yolu (taze) onbellege hic guvenmez.
  tb.envanter = [{ host: 'GBNGXP01' }];
  assert.equal(es.eskiMi(await es.durum({ taze: true }), 'GBOLU009'), true);
});

test('ES17 FQDN/kisa ad: kaynak sunucuyu yalniz FQDN ile gorduyse kisa adli dokum ESKI DEGIL, aday degil, silinmez', async () => {
  // Envanterde yok; dokum 30 gun once (kisa ad). Taze sinyal yalniz FQDN ile.
  for (const [ad, kur] of [
    ['TBMWANS tarama tablosu', () => tb.tablolar.set('dbo.Nginx_Cis_Hosts', [{ host: 'gbngxp09.bmw.local', scan_date: tarih(1) }])],
    ['dbo.nginx_inventory', () => { tb.nginxInv = [{ hostname: 'gbngxp09.bmw.local', source_last_update: gunOnce(1).toISOString() }]; }],
    ['_seen.json', () => fs.writeFileSync(path.join(raw, '_seen.json'), JSON.stringify({ at: gunOnce(1).toISOString(), hosts: { 'gbngxp09.bmw.local': gunOnce(1).toISOString() } }))],
  ]) {
    rawTemizle();
    tb = sahteTbmwans();
    es._test.bagla({ tbmwans: () => tb.api, portal: () => pdb.api, simdi: () => SIMDI });
    dosya('GBNGXP09.txt', 30);
    kur();
    const d = await es.durum({ taze: true });
    assert.equal(d.ok, true, d.hata);
    assert.equal(es.eskiMi(d, 'GBNGXP09'), false, `${ad}: FQDN ile taze, kisa ad eski sayildi`);
    assert.equal(es.eskiMi(d, 'gbngxp09.bmw.local'), false, ad);
    const a = await es.adaylar();
    assert.ok(!a.adaylar.some((x) => x.host === 'GBNGXP09'), `${ad}: canli sunucu aday listesinde`);
    await assert.rejects(es.temizle({ hosts: ['GBNGXP09'], onay: 'SIL' }), (e) => e.status === 409, ad);
    assert.ok(fs.existsSync(path.join(raw, 'GBNGXP09.txt')), `${ad}: canli sunucunun dokumu silindi`);
  }
  // Ters yon de: tabloda kisa ad taze, sorulan FQDN.
  tb.tablolar.set('dbo.Nginx_Audit_Hosts', [{ host: 'GBNGXP10', scan_date: tarih(1) }]);
  assert.equal(es.eskiMi(await es.durum({ taze: true }), 'gbngxp10.bmw.local'), false);
  assert.equal(tb.deletes.length + pdb.deletes.length, 0);
});

for (const [ad, icerik] of [
  ['yarim yazim', '{"at": "2026-11-11T00:00:00Z", "hosts": {"GBX'],
  ['JSON degil', 'merhaba'],
  ['nesne degil', '42'],
  ['hosts bicimsiz', '{"hosts": "GBX"}'],
]) {
  test(`ES18 _seen.json var ama okunamiyor (${ad}): hesap fail-closed, hicbir sunucu eski degil`, async () => {
    dosya('GBOLU001.txt', 30);
    fs.writeFileSync(path.join(raw, '_seen.json'), icerik);
    const d = await es.durum({ taze: true });
    assert.equal(d.ok, false, 'bozuk _seen.json "gorulmedi" diye okundu');
    assert.equal(es.eskiMi(d, 'GBOLU001'), false);
    await assert.rejects(es.temizle({ hosts: ['GBOLU001'], onay: 'SIL' }), (e) => e.status === 503);
    assert.ok(fs.existsSync(path.join(raw, 'GBOLU001.txt')));
  });
}

test('ES18b _seen.json yoksa eski davranis (yalniz dokum mtime); dizi bicimi "at" ile okunur', async () => {
  dosya('GBOLU001.txt', 30);
  let d = await es.durum({ taze: true });
  assert.equal(d.ok, true, d.hata);
  assert.equal(es.eskiMi(d, 'GBOLU001'), true);
  fs.writeFileSync(path.join(raw, '_seen.json'), JSON.stringify({ at: gunOnce(1).toISOString(), hosts: ['gbolu001'] }));
  d = await es.durum({ taze: true });
  assert.equal(d.ok, true, d.hata);
  assert.equal(es.eskiMi(d, 'GBOLU001'), false);
});

test('ES19 bas bosluklu host satirlari: duz silme kacirirsa normallestirilmis ikinci gecis; yine kalirsa tamam DEGIL', async () => {
  const kur = () => {
    tb.tablolar.set('dbo.Nginx_Audit_Hosts', [
      { host: 'GBOLU001', scan_date: tarih(30) },
      { host: '  GBOLU001', scan_date: tarih(30) },
      { host: 'gbolu001 ', scan_date: tarih(30) },
      { host: 'GBNGXP01', scan_date: tarih(1) },
    ]);
    pdb.tablolar.set('nginx_hub_file_state', [{ host: ' GBOLU001' }, { host: 'GBOLU001' }]);
    dosya('GBOLU001.txt', 30);
  };
  kur();
  const a = await es.adaylar();
  assert.equal(a.adaylar[0].tbmwans['dbo.Nginx_Audit_Hosts'], 3);
  const r = await es.temizle({ hosts: ['GBOLU001'], onay: 'SIL' });
  const h = r.hosts[0];
  assert.equal(h.tamam, true, JSON.stringify(h.hatalar));
  assert.equal(h.silinenSatir['dbo.Nginx_Audit_Hosts'], 3);
  assert.equal(h.silinenSatir.nginx_hub_file_state, 2);
  assert.deepEqual(tb.tablolar.get('dbo.Nginx_Audit_Hosts').map((x) => x.host), ['GBNGXP01']);
  assert.deepEqual(pdb.tablolar.get('nginx_hub_file_state'), []);
  assert.ok(tb.deletes.some((d) => d.normal && d.k === 1), 'normallestirilmis gecis kosmadi');
  assert.ok(!tb.deletes.some((d) => d.normal && d.tablo !== 'dbo.Nginx_Audit_Hosts'), 'gereksiz normal gecis');
  assert.ok(!fs.existsSync(path.join(raw, 'GBOLU001.txt')));

  // Normal gecis de silemezse: sunucu TAMAM SAYILMAZ, dosya kalir, hata yazilir.
  tb = sahteTbmwans();
  pdb = sahtePortal();
  es._test.bagla({ tbmwans: () => tb.api, portal: () => pdb.api, simdi: () => SIMDI });
  kur();
  tb.normalSilmez = true;
  const r2 = await es.temizle({ hosts: ['GBOLU001'], onay: 'SIL' });
  const h2 = r2.hosts[0];
  assert.equal(h2.tamam, false, 'sayilan satirlar kaldigi halde tamam dendi');
  assert.equal(r2.kalanVar, true);
  assert.match(h2.hatalar.map((x) => x.mesaj).join(' '), /Sayılan 3 satırın 2 kadarı/);
  assert.ok(fs.existsSync(path.join(raw, 'GBOLU001.txt')), 'satirlar kalirken dokum silindi');
});

test('ES20 onay metni: SIL ve Turkce Caps Lock SIL (noktali I) kabul; kucuk harf reddedilir', () => {
  assert.deepEqual(es._test.istekDogrula({ hosts: ['GBOLU001'], onay: 'SIL' }), { hosts: ['GBOLU001'] });
  assert.deepEqual(es._test.istekDogrula({ hosts: ['GBOLU001'], onay: 'SİL' }), { hosts: ['GBOLU001'] });
  assert.deepEqual(es._test.istekDogrula({ hosts: ['GBOLU001'], onay: ' SIL ' }), { hosts: ['GBOLU001'] });
  for (const onay of ['sil', 'si̇l', 'SILL', 42, null]) assert.equal(es._test.istekDogrula({ hosts: ['GBOLU001'], onay }).status, 400, String(onay));
});
