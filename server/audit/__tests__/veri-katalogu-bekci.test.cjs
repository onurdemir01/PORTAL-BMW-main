// server/audit/__tests__/veri-katalogu-bekci.test.cjs - Veri Katalogu BEKCILERI (2026-11-13).
//
// NEDEN: katalog (server/katalog/tablolar.json) elle tutulur. Yeni bir tablo eklenip kataloga
// yazilmazsa Denetim > Veri Katalogu sessizce eksik kalir; bu bekciler o anda KIRMIZI olur.
//   VB1 Portal kodundaki her CREATE TABLE (server/**, testler haric) icin Portal girdisi var
//   VB2 her girdi: db/alan/guven/yazan turu gecerli, amac bos degil, (db, tablo) tekil
//   VB3 Ansible deposu varsa (VERI_KATALOGU_ANSIBLE_DIR ya da ~/Downloads/Compressed/
//       gar_bmt_ansible_scripts) orada YAZILAN her tablo icin db=TBMWANS girdisi var; depo yoksa
//       ATLANIR. VB3a toplayicinin ad bicimlerini depodan bagimsiz sabitler.
//   VB4 her dosya/uzerinden basvurusu gercek: dosya + satir var, satir baska tabloyu gostermiyor,
//       tabloya giden modul adi KODDA (yorumda degil) geciriyor. VB4a sahte dosyalarla kilit.
//   VB5 Portal kodunun dbo.X ile okudugu her tablo (ve FALLBACK_TABLES) katalogda.
// Toplayicilarin alt siniri var: bir regex bozulup SIFIR ad dondururse bekci sessizce gecmesin.
// Mutasyonla dogrulandi (2026-11-13): girdi silme / CREATE TABLE ekleme / bos amac / gecersiz alan
// / Ansible'a yeni INSERT INTO dbo.X / SmartOperations girdisi silme / [TBMWANS].[dbo].[Yeni] INSERT /
// kaymis satir / yorum-okuyucu / Portal'da yeni dbo.X okumasi -> ilgili test kirmizi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { katalogOku, VERITABANLARI, ALANLAR, YAZAN_TURLERI, GUVENLER } = require('../veri-katalogu.cjs');

const KOK = path.join(__dirname, '..', '..', '..');
const KATALOG = katalogOku();
const ad = (s) => String(s || '').replace(/^\[?dbo\]?\./i, '').replace(/[[\]]/g, '').toLowerCase();
const katalogAdlari = (db) => new Set(KATALOG.filter((g) => !db || g.db === db).map((g) => ad(g.tablo)));

function dosyalar(dizin, uzantilar, cikti = []) {
  let girdiler;
  try {
    girdiler = fs.readdirSync(dizin, { withFileTypes: true });
  } catch {
    return cikti;
  }
  for (const g of girdiler) {
    if (['node_modules', '.git', '__pycache__', '__tests__', '.claude', 'dist'].includes(g.name)) continue;
    const p = path.join(dizin, g.name);
    if (g.isDirectory()) dosyalar(p, uzantilar, cikti);
    else if (uzantilar.some((u) => g.name.toLowerCase().endsWith(u))) cikti.push(p);
  }
  return cikti;
}

// "CREATE TABLE ad (" - parantez SART: yorumdaki "CREATE TABLE blogu" eslesmesin.
const CREATE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\[?dbo\]?\.)?\[?([A-Za-z_]\w*)\]?\s*\(/gi;

function portalCreateTablolari() {
  const bulunan = new Map();
  for (const f of dosyalar(path.join(KOK, 'server'), ['.cjs', '.js', '.mjs', '.sql'])) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(CREATE_RE)) {
      const t = m[1];
      if (!bulunan.has(t.toLowerCase())) bulunan.set(t.toLowerCase(), `${path.relative(KOK, f)}: ${t}`);
    }
  }
  return bulunan;
}

test('VB1 Portal kodundaki her CREATE TABLE katalogda (db=Portal)', () => {
  const bulunan = portalCreateTablolari();
  assert.ok(bulunan.size >= 100, `toplayici bozuk: yalniz ${bulunan.size} CREATE TABLE okundu`);
  assert.ok(bulunan.has('portal_users') && bulunan.has('ai_conversations'), 'bilinen tablolar okunamadi');
  const portal = katalogAdlari('Portal');
  const eksik = [...bulunan.entries()].filter(([k]) => !portal.has(k)).map(([, v]) => v);
  assert.deepEqual(eksik, [], `Kataloga yazilmamis Portal tablolari (server/katalog/tablolar.json, bkz. docs/VERI-KATALOGU.md):\n${eksik.join('\n')}`);
});

test('VB2 her girdi gecerli: db/alan/guven/yazan turu, bos olmayan amac, tekil (db, tablo)', () => {
  assert.ok(KATALOG.length >= 150, `katalog beklenenden kucuk: ${KATALOG.length}`);
  const hatalar = [];
  const gorulen = new Set();
  for (const [i, g] of KATALOG.entries()) {
    const yer = `#${i} ${g.db}:${g.tablo}`;
    if (!VERITABANLARI.includes(g.db)) hatalar.push(`${yer} gecersiz db '${g.db}'`);
    if (typeof g.tablo !== 'string' || !/^[A-Za-z_]\w*$/.test(g.tablo)) hatalar.push(`${yer} gecersiz tablo adi`);
    if (typeof g.amac !== 'string' || g.amac.trim().length < 10) hatalar.push(`${yer} amac bos/kisa`);
    if (!ALANLAR.includes(g.alan)) hatalar.push(`${yer} gecersiz alan '${g.alan}' (ALANLAR listesine bakin)`);
    if (!GUVENLER.includes(g.guven)) hatalar.push(`${yer} gecersiz guven '${g.guven}'`);
    if (typeof g.kullanilmiyor !== 'boolean') hatalar.push(`${yer} kullanilmiyor boolean degil`);
    if (typeof g.saklama !== 'string' || typeof g.notlar !== 'string') hatalar.push(`${yer} saklama/notlar metin degil`);
    if (!Array.isArray(g.yazanlar) || !Array.isArray(g.okuyanlar)) hatalar.push(`${yer} yazanlar/okuyanlar dizi degil`);
    for (const y of g.yazanlar || []) {
      if (!YAZAN_TURLERI.includes(y.tur)) hatalar.push(`${yer} gecersiz yazan turu '${y.tur}'`);
      if (!String(y.ad || '').trim()) hatalar.push(`${yer} yazan adi bos`);
      for (const k of ['dosya', 'nasil', 'ne_zaman']) if (typeof y[k] !== 'string') hatalar.push(`${yer} yazan.${k} metin degil`);
    }
    for (const o of g.okuyanlar || []) {
      if (!String(o.ad || '').trim()) hatalar.push(`${yer} okuyan adi bos`);
      if (typeof o.dosya !== 'string') hatalar.push(`${yer} okuyan.dosya metin degil`);
    }
    for (const r of [...(g.yazanlar || []), ...(g.okuyanlar || [])]) {
      if (r.uzerinden !== undefined && (typeof r.uzerinden !== 'string' || !r.uzerinden.trim())) hatalar.push(`${yer} uzerinden bos/metin degil`);
    }
    const k = `${g.db}:${ad(g.tablo)}`;
    if (gorulen.has(k)) hatalar.push(`${yer} tekrar eden girdi`);
    gorulen.add(k);
  }
  assert.deepEqual(hatalar, []);
});

// Ansible tarafinda YAZMA (VB3). Ad bicimleri (2026-11-13 dogrulama bulgusu: ilk surum 66 TBMWANS
// girdisinin 17'sini GOREMIYORDU):
//   - INSERT/MERGE/UPDATE/TRUNCATE/CREATE/DELETE/BULK INSERT + dbo.X, ISTEGE BAGLI veritabani onekiyle
//     ([TBMWANS].[dbo].[X] - SmartOperations, CloudformsServices, Truststore*, trash_olds/*)
//   - yukleyici sabitleri: TABLE = "dbo.X" / TABLE_NAME = "dbo.X" ve tek basina tirnakli "dbo.X"
//     (initiliaze_scripts_inventory.py FILES listesi -> f"TRUNCATE TABLE {table}")
//   - tablo adi + CSV dosyasi demeti: ("WDS_CTG", "ctg.csv", ...) (wds_db_loader.py KINDS sozlugu;
//     ad "[" + DATABASE + "].[dbo].[" + table + "]" ile birlestirilir)
const DB_ONEKI = String.raw`(?:\[?TBMWANS\]?\.)?`;
const YAZMA_RE = new RegExp(
  String.raw`\b(?:INSERT\s+INTO|MERGE(?:\s+INTO)?|UPDATE|TRUNCATE\s+TABLE|CREATE\s+TABLE|DELETE(?:\s+FROM)?|BULK\s+INSERT)\s+` +
    DB_ONEKI +
    String.raw`\[?dbo\]?\.\[?([A-Za-z_]\w*)`,
  'gi',
);
const SABIT_RE = new RegExp(String.raw`\bTABLE(?:_NAME)?\s*=\s*["']` + DB_ONEKI + String.raw`\[?dbo\]?\.\[?([A-Za-z_]\w*)`, 'g');
const TIRNAKLI_RE = new RegExp(String.raw`["']` + DB_ONEKI + String.raw`\[?dbo\]?\.\[?([A-Za-z_]\w*)\]?["']`, 'g');
const CSV_DEMET_RE = /\(\s*["']([A-Za-z_]\w*)["']\s*,\s*["'][\w.-]+\.csv["']/g;
const ANSIBLE_RES = [YAZMA_RE, SABIT_RE, TIRNAKLI_RE, CSV_DEMET_RE];

function ansibleDizini() {
  return process.env.VERI_KATALOGU_ANSIBLE_DIR || path.join(os.homedir(), 'Downloads', 'Compressed', 'gar_bmt_ansible_scripts');
}

/** Ansible deposunda yazilan tablo adlari: Map(kucuk ad -> "dosya: ad"). Kaynak metinler testte verilebilir. */
function ansibleYazilanlar(metinler) {
  const bulunan = new Map();
  for (const [dosya, src] of metinler) {
    for (const re of ANSIBLE_RES) {
      for (const m of src.matchAll(re)) {
        // "dbo.Server_Hub_" + t gibi birlestirme onekleri tablo degil (hicbir tablo '_' ile bitmez).
        if (m[1].endsWith('_')) continue;
        const k = m[1].toLowerCase();
        if (!bulunan.has(k)) bulunan.set(k, `${dosya}: ${m[1]}`);
      }
    }
  }
  return bulunan;
}

function ansibleMetinleri(dizin) {
  return dosyalar(dizin, ['.yml', '.yaml', '.py', '.sh', '.sql', '.j2', '.ps1']).map((f) => [path.relative(dizin, f), fs.readFileSync(f, 'utf8')]);
}

test('VB3a toplayici her ad bicimini gorur (Ansible deposundan bagimsiz)', () => {
  const ornek = [
    ['a.py', 'cur.execute("INSERT INTO dbo.Duz (a) VALUES (?)")'],
    ['b.yml', `query: "INSERT INTO [TBMWANS].[dbo].[UcParcali] (job_type) VALUES ('x')"`],
    ['c.yml', 'query: "delete from [TBMWANS].[dbo].[KucukHarf] where a = 1"'],
    ['d.py', 'TABLE_NAME = "[TBMWANS].[dbo].[SabitOnekli]"'],
    ['e.py', 'FILES = [\n    ("x.csv", "dbo.TirnakliSabit"),\n]\ncursor.execute(f"TRUNCATE TABLE {table}")'],
    ['f.py', 'KINDS = {\n    "ctg": ("WDS_DEMET", "ctg.csv", _BASE),\n}\ntarget = "[" + DATABASE + "].[dbo].[" + table + "]"'],
    ['g.sh', 'sqlcmd -Q "MERGE INTO dbo.[Koseli] AS t USING ..."'],
    ['i.py', 'bilgi.get("dbo.Server_Hub_" + t, {})'],
  ];
  const bulunan = ansibleYazilanlar(ornek);
  for (const ad of ['duz', 'ucparcali', 'kucukharf', 'sabitonekli', 'tirnaklisabit', 'wds_demet', 'koseli']) {
    assert.ok(bulunan.has(ad), `toplayici '${ad}' bicimini goremiyor`);
  }
  // Okuma ve yorum degil: SELECT ... FROM dbo.X ve "dbo.X_*" yazma sayilmaz.
  const okuma = ansibleYazilanlar([['h.py', 'cur.execute("SELECT a FROM dbo.SadeceOkunan WHERE b = 1")']]);
  assert.equal(okuma.has('sadeceokunan'), false);
  assert.equal(bulunan.has('server_hub_'), false, 'birlestirme oneki tablo sayildi');
});

test('VB3 Ansible deposunda yazilan her tablo TBMWANS katalogunda', (t) => {
  const dizin = ansibleDizini();
  if (!fs.existsSync(dizin)) {
    t.skip(`Ansible deposu yok (${dizin}); VERI_KATALOGU_ANSIBLE_DIR ile verilebilir`);
    return;
  }
  const bulunan = ansibleYazilanlar(ansibleMetinleri(dizin));
  assert.ok(bulunan.size >= 60, `toplayici bozuk: Ansible deposunda yalniz ${bulunan.size} yazilan tablo okundu`);
  for (const bilinen of ['smartoperations', 'wds_ctg', 'initscriptsinventory', 'cloudformsservices']) {
    assert.ok(bulunan.has(bilinen), `toplayici bilinen '${bilinen}' tablosunu goremiyor`);
  }
  // Yalniz TBMWANS girdileri: Ansible'in yazdigi ad bir Portal girdisiyle eslesip gecmesin.
  const tbmwans = katalogAdlari('TBMWANS');
  const eksik = [...bulunan.entries()].filter(([k]) => !tbmwans.has(k)).map(([, v]) => v);
  assert.deepEqual(eksik, [], `Kataloga (db=TBMWANS) yazilmamis tablolar:\n${eksik.join('\n')}`);
});

// VB5 Portal kodunun TBMWANS'tan okudugu her tablo katalogda: server/** icinde yorum olmayan satirdaki
// dbo.X (dbo.X_* gibi joker anlatimlar haric) ve envanter tarayicisinin FALLBACK_TABLES listesi.
const PORTAL_DBO_RE = /(?<![\w.])\[?dbo\]?\.\[?([A-Za-z_]\w*)(?![\w*])/g;
const YORUM_SATIRI = /^\s*(\/\/|\/\*|\*|#)/;

test('VB5 Portal kodunun dbo.X ile okudugu her tablo katalogda', () => {
  const bulunan = new Map();
  for (const f of dosyalar(path.join(KOK, 'server'), ['.cjs', '.js', '.mjs'])) {
    const satirlar = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    satirlar.forEach((s, i) => {
      if (YORUM_SATIRI.test(s)) return;
      for (const m of s.matchAll(PORTAL_DBO_RE)) {
        const k = m[1].toLowerCase();
        if (!bulunan.has(k)) bulunan.set(k, `${path.relative(KOK, f)}:${i + 1}: dbo.${m[1]}`);
      }
    });
  }
  const inv = fs.readFileSync(path.join(KOK, 'server', 'inventory', 'index.cjs'), 'utf8');
  const fb = /const FALLBACK_TABLES = \[([\s\S]*?)\]/.exec(inv);
  assert.ok(fb, 'inventory/index.cjs FALLBACK_TABLES bulunamadi (bekci bozuk)');
  for (const m of fb[1].matchAll(/'([A-Za-z_]\w*)'/g)) {
    const k = m[1].toLowerCase();
    if (!bulunan.has(k)) bulunan.set(k, `server/inventory/index.cjs FALLBACK_TABLES: ${m[1]}`);
  }
  assert.ok(bulunan.size >= 30, `toplayici bozuk: Portal kodunda yalniz ${bulunan.size} dbo.X okundu`);
  assert.ok(bulunan.has('ekip_infos') && bulunan.has('inventory'), 'bilinen TBMWANS okumalari gorulmedi');
  const hepsi = katalogAdlari();
  const eksik = [...bulunan.entries()].filter(([k]) => !hepsi.has(k)).map(([, v]) => v);
  assert.deepEqual(eksik, [], `Portal kodunun okudugu ama katalogda olmayan tablolar:\n${eksik.join('\n')}`);
});

// VB4 BASVURU BUTUNLUGU: katalogdaki "dosya" (yol[:satir]) ve "uzerinden" yollari GERCEK olmali.
// (2026-11-13 dogrulama bulgusu: eski-sunucu.cjs satirlari kaymis, baska tabloyu gosteriyordu;
// oco/store.cjs:135, telnet/index.cjs:285, history-config.cjs:40 tabloyu yalniz YORUMDA anan
// dosyalardi.) Kurallar:
//   a) dosya var, satir dosyanin icinde (Ansible yollari yalniz depo varsa denetlenir)
//   b) satir BASKA bir katalog tablosunu adiyla aniyor ama bu tabloyu anmiyorsa -> kaymis basvuru
//   c) tabloya giden dosya (uzerinden varsa O, yoksa dosya) tablo adini YORUM OLMAYAN bir satirda
//      geciriyor: tabloyu yalniz yorumda anan ya da hic anmayan modul "okuyan/yazan" degildir;
//      yardimci modul uzerinden okuyorsa `uzerinden` alanina o modul yazilir.
const YOL_RE = /^([\w.-]+(?:\/[\w.-]+)+)(?::(\d+))?$/;
const PORTAL_KOKLERI = ['server/', 'src/', 'scripts/', 'docs/', 'deploy/'];

function basvurular(katalog) {
  const out = [];
  for (const g of katalog) {
    for (const [liste, kayitlar] of [['yazanlar', g.yazanlar || []], ['okuyanlar', g.okuyanlar || []]]) {
      kayitlar.forEach((r, i) => out.push({ g, yer: `${g.db}:${g.tablo} ${liste}[${i}]`, r }));
    }
  }
  return out;
}

function cozumle(yol, ansible) {
  if (PORTAL_KOKLERI.some((k) => yol.startsWith(k))) return { tam: path.join(KOK, ...yol.split('/')), portal: true };
  if (!ansible) return null;
  return { tam: path.join(ansible, ...yol.split('/')), portal: false };
}

function kelimeRe(ad) {
  return new RegExp(`(^|[^A-Za-z0-9_])${ad}([^A-Za-z0-9_]|$)`, 'i');
}

/** Saf denetim: hata listesi doner. okuyucu(tamYol) -> metin | null (yok). */
function basvuruHatalari(katalog, { ansible, okuyucu }) {
  const tumAdlar = new Set(katalog.map((g) => ad(g.tablo)));
  const hatalar = [];
  const satirlar = (tam) => {
    const m = okuyucu(tam);
    return m == null ? null : m.split(/\r?\n/);
  };
  const kodda = (L, re) => L.some((s) => !YORUM_SATIRI.test(s) && re.test(s));
  for (const { g, yer, r } of basvurular(katalog)) {
    const own = ad(g.tablo);
    const re = kelimeRe(g.tablo);
    const m = YOL_RE.exec(String(r.dosya || '').trim());
    if (!m) continue; // "(yok)", bos ya da serbest metin
    const c = cozumle(m[1], ansible);
    if (!c) continue; // Ansible yolu, depo yok
    const L = satirlar(c.tam);
    if (!L) {
      hatalar.push(`${yer} dosya yok: ${r.dosya}`);
      continue;
    }
    if (m[2]) {
      const n = Number(m[2]);
      if (n < 1 || n > L.length) hatalar.push(`${yer} satir dosyada yok: ${r.dosya} (${L.length} satir)`);
      else {
        const toks = (L[n - 1].match(/[A-Za-z_]\w*/g) || []).map((x) => x.toLowerCase());
        if (!toks.includes(own) && toks.some((x) => x !== own && tumAdlar.has(x))) {
          hatalar.push(`${yer} ${r.dosya} baska bir tabloyu gosteriyor: ${L[n - 1].trim().slice(0, 100)}`);
        }
      }
    }
    let hedef = L;
    let hedefAd = r.dosya;
    if (r.uzerinden != null) {
      const u = YOL_RE.exec(String(r.uzerinden).trim());
      const cu = u && !u[2] ? cozumle(u[1], ansible) : null;
      if (!u || u[2]) {
        hatalar.push(`${yer} uzerinden gecersiz (satirsiz yol olmali): ${r.uzerinden}`);
        continue;
      }
      if (!cu) continue;
      hedef = satirlar(cu.tam);
      hedefAd = r.uzerinden;
      if (!hedef) {
        hatalar.push(`${yer} uzerinden dosyasi yok: ${r.uzerinden}`);
        continue;
      }
    }
    if (!kodda(hedef, re)) {
      hatalar.push(`${yer} ${hedefAd} tabloyu kodda anmiyor (yalniz yorumda ya da hic); yardimci modul varsa 'uzerinden' yazin`);
    }
  }
  return hatalar;
}

const diskOkuyucu = (tam) => {
  try {
    return fs.statSync(tam).isFile() ? fs.readFileSync(tam, 'utf8') : null;
  } catch {
    return null;
  }
};

test('VB4a basvuru denetimi kaymis satiri, yorum-okuyucuyu ve eksik dosyayi yakalar (sahte dosyalar)', () => {
  const dosyalarSahte = {
    [path.join(KOK, 'server', 'x', 'liste.cjs')]: "const T = [\n  { tablo: 'dbo.Alfa' },\n  { tablo: 'dbo.Beta' },\n];\nawait q(`DELETE FROM ${t}`);",
    [path.join(KOK, 'server', 'x', 'yorum.cjs')]: '// Alfa tablosuna benzer desen\nmodule.exports = {};',
    [path.join(KOK, 'server', 'x', 'yardimci.cjs')]: 'const r = await q(`SELECT * FROM Alfa`);',
    [path.join(KOK, 'server', 'x', 'cagiran.cjs')]: "const { oku } = require('./yardimci.cjs');\nawait oku();",
  };
  const okuyucu = (tam) => dosyalarSahte[tam] ?? null;
  const G = (tablo, okuyanlar) => ({ db: 'Portal', tablo, yazanlar: [], okuyanlar });
  const temiz = basvuruHatalari(
    [G('Alfa', [{ ad: 'liste', dosya: 'server/x/liste.cjs:2' }, { ad: 'cagiran', dosya: 'server/x/cagiran.cjs:2', uzerinden: 'server/x/yardimci.cjs' }]), G('Beta', [])],
    { ansible: null, okuyucu },
  );
  assert.deepEqual(temiz, []);
  const kirli = basvuruHatalari(
    [
      G('Alfa', [
        { ad: 'kaymis', dosya: 'server/x/liste.cjs:3' },
        { ad: 'yorum', dosya: 'server/x/yorum.cjs:1' },
        { ad: 'uzerinden yok', dosya: 'server/x/cagiran.cjs:2' },
        { ad: 'dosya yok', dosya: 'server/x/yok.cjs:1' },
        { ad: 'satir yok', dosya: 'server/x/liste.cjs:99' },
        { ad: 'ansible depo yok', dosya: 'bmw_x/files/a.py:3' },
      ]),
      G('Beta', []),
    ],
    { ansible: null, okuyucu },
  );
  assert.equal(kirli.length, 5, kirli.join('\n'));
  assert.match(kirli[0], /baska bir tabloyu gosteriyor/);
  assert.match(kirli[1], /yorum\.cjs:1 tabloyu kodda anmiyor/);
  assert.match(kirli[2], /cagiran\.cjs:2 tabloyu kodda anmiyor/);
  assert.match(kirli[3], /dosya yok/);
  assert.match(kirli[4], /satir dosyada yok/);
});

test('VB4 katalogdaki her dosya/uzerinden basvurusu gercek ve tabloyu kodda aniyor', () => {
  const dizin = ansibleDizini();
  const ansible = fs.existsSync(dizin) ? dizin : null;
  const hatalar = basvuruHatalari(KATALOG, { ansible, okuyucu: diskOkuyucu });
  assert.deepEqual(hatalar, [], `Katalog basvurulari bozuk (server/katalog/tablolar.json):\n${hatalar.join('\n')}`);
});
