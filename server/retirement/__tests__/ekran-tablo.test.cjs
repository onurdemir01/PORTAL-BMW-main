// server/retirement/__tests__/ekran-tablo.test.cjs — Retirement tablo yeniden tasarimi, KAYNAK bekcileri (2026-10-26).
//
// RetirementTab.tsx ve yeni ortak dosyalar kaynak / AST (typescript) olarak okunur. Kilitlenenler:
//   RTU1 RecordModal ayrinti satiri: colSpan={kolonlar.length} (sayisal colSpan yok); <tr data-rt-ayrinti> ana
//        satirla (<tr data-tid>) AYNI map geri donusunde, ayni Fragment'ta (tbody sonuna DEGIL); satir td = kolon
//   RTU2 CreateModal bos satiri TableEmptyRow colSpan={CM_KOLONLAR.length}; satirdaki td sayisi = kolon sayisi
//   RTU3 tanimsiz token / sabit hex / sari-kirmizi METIN rengi yok: RetirementTab.tsx'in TAMAMI (CreateModal,
//        RecordModal, ust duzey yardimcilar) ve yeni / dokunulan dosyalar; `renk:` alani da (DEG_RENK, SIM, hub)
//   RTU4 smBtn birincil dali --text-on-accent
//   RTU5 CreateModal ve RecordModal'da erken return yok (ui-v2 `anaDonus` `if (...) return`'u gormuyor)
//   IPK1 CreateModal in-place uyarisini SECILI hedeflerle, yalniz `disc &&` altinda, gizlemeden basar
//   IPK2 in-place ENGELLEMEZ: create() ve "Kaydi ac" inPlace'e bakmaz; uyari dosyasinda dugme / toast yok
//   IPK3 hedef hucresinde 'in-place' cipi (Cip: kirilmaz) ipucuyla; CreateModal hucreyi t ile basar
//   IPK4 SOZLESME: gercek buildTargets (in-place senaryosu) ciktisi istemcinin inPlaceOzeti'ne verilir
//   RTU6 GA12 erken uyari: geri alma kosulundan "Geri aktif et</button>" sonuna <= 1300 karakter (bekci siniri 1500)
//   IPK5 kayit satiri in-place bilgisini kayittan, yoksa TEMBEL kesiften alir (BIR kez, catch'li: kesif dusse de ekran)
//   IPK6 STOP onayinda in-place uyarisi yalniz `ask &&` altinda, baglam 'stop'; son onay dugmesi / stopCalistir inPlace OKUMAZ
//   IPK7 is sonrasi not yalniz in-place hedefte (ipAsama), gizlenmeden; ayrinti satirina in-place bilgisi gider
//   ISK1 is ciktisi dosyalari eski (yan etkili) jobStatus ucunu CAGIRMAZ; istemci sunucu / is no gondermez
//   RTU7 (denetim D1-5 / B12) WebKaynak / WebAyrinti cipleri metne YAPISMAZ: her cagri yerinin kabi gap-x'li flex
//   RTU8 (denetim B6) focus-visible:outline-offset-2 ONEMLI (!) ile: katmansiz `:focus-visible { outline-offset: 1px }` ezer
//   IPK8 (denetim B8) CreateModal in-place uyarisi surum kutusundan HEMEN sonra (ozel uyari, yigindaki yeri)
//   RTU9 yerlesim / erisilebilirlik duzeltmeleri kaynakta (jsdom olcmez; tarayici olcumu raporda): paket adi BASTAN
//        kisaltilir (sonek gorunur), hub hucresi flex (ilk satir 20px), eylem kolonu ilk satir ortasi hizali (-2px +
//        24px satirlar), form etiketleri input'larla iliskili, terminal basligi AA (white/60)
// Korluk: RTU3 `renk:` dolaylamasini yalniz adi `renk` olan alanlarda gorur (baska adli degisken gorulmez);
// gorsel yerlesim (tek satir, hiza) jsdom/AST ile olculmez, sartname §11. Davranis: vitest retirement-kayit (RK1-RK6).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../../util/guard-text.cjs');
const { buildTargets } = require('../discover.cjs');

const ROOT = path.join(__dirname, '..', '..', '..');
const SH = path.join(ROOT, 'src', 'components', 'server_hub');
const RT_PATH = path.join(SH, 'RetirementTab.tsx');
const RT_RAW = fs.readFileSync(RT_PATH, 'utf8');
const YENI = ['retirementStil.ts', 'RetirementUi.tsx', 'RetirementWebSatir.tsx', 'RetirementInPlace.tsx', 'retirementSatir.ts',
  'retirementCikti.ts', 'RetirementIsCiktisi.tsx', 'RetirementHedefAyrinti.tsx', 'RetirementCanli.tsx', 'RetirementAkis.tsx',
  // Kayit penceresinin icinde (denetim B15: sari metin acik temada 2.2:1).
  'RetirementDnsIp.tsx'];
const oku = (ad) => fs.readFileSync(path.join(SH, ad), 'utf8');

function tsYukle() {
  try {
    return require('typescript');
  } catch (e) {
    throw new Error('typescript paketi yuklenemedi - bekci KOSAMADI (yesil sayilmaz): ' + e.message);
  }
}
const ts = tsYukle();
const SF = ts.createSourceFile('RetirementTab.tsx', RT_RAW, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
const ustFonksiyon = (ad) => {
  const fn = SF.statements.find((s) => ts.isFunctionDeclaration(s) && s.name && s.name.text === ad);
  assert.ok(fn && fn.body, `${ad} ust duzey fonksiyonu RetirementTab.tsx'te yok`);
  return fn;
};
const metin = (n) => normalize(n.getText(SF));
/** Ust duzey fonksiyonun kaynak metni (ham). */
const govdeHam = (ad) => ustFonksiyon(ad).getText(SF);
const ustSabit = (ad) => {
  for (const s of SF.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) if (d.name.getText(SF) === ad) return d;
  }
  assert.fail(`${ad} ust duzey sabiti yok`);
};
/** fonksiyon icinde etiket ogeleri: kosullar (distan ice), gizli, ana return'de mi. */
function yerlesim(fnAd, etiket) {
  const fn = ustFonksiyon(fnAd);
  const ifadeler = fn.body.statements;
  const son = ifadeler[ifadeler.length - 1];
  const out = [];
  const gizliSinif = /(^|[\s'`{])(hidden|invisible|sr-only)(?=[\s'`}]|$)/;
  const gizlilik = (attrs) => attrs.properties.filter((a) => ts.isJsxAttribute(a)).flatMap((a) => {
    const ad = a.name.getText(SF);
    const d = a.initializer ? metin(a.initializer) : '{true}';
    if (ad === 'hidden' && d !== '{false}') return [`hidden=${d}`];
    if (ad === 'aria-hidden' && !/false/.test(d)) return [`aria-hidden=${d}`];
    if (ad === 'className' && gizliSinif.test(d)) return [`className=${d}`];
    if (ad === 'style' && /display: ?'none'|visibility: ?'hidden'|opacity: ?0(?![.\d])/.test(d)) return [`style=${d}`];
    return [];
  });
  const gez = (n) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(SF) === etiket) {
      const ozellik = {};
      for (const a of n.attributes.properties) if (ts.isJsxAttribute(a)) ozellik[a.name.getText(SF)] = a.initializer ? metin(a.initializer).replace(/^\{|\}$/g, '') : true;
      const kosullar = [];
      const gizli = gizlilik(n.attributes);
      let cocuk = ts.isJsxOpeningElement(n) ? n.parent : n;
      let ustIfade = null;
      for (let p = cocuk.parent; p && p !== fn; cocuk = p, p = p.parent) {
        if (p === fn.body) { ustIfade = cocuk; break; }
        if (ts.isBinaryExpression(p) && ['&&', '||', '??'].includes(p.operatorToken.getText(SF))) kosullar.push(p.right === cocuk ? `${metin(p.left)} ${p.operatorToken.getText(SF)}` : `${p.operatorToken.getText(SF)} ${metin(p.right)}`);
        else if (ts.isConditionalExpression(p)) { if (p.whenTrue === cocuk) kosullar.push(`${metin(p.condition)} ?`); else if (p.whenFalse === cocuk) kosullar.push(`${metin(p.condition)} :`); }
        else if (ts.isIfStatement(p)) kosullar.push(`if (${metin(p.expression)})`);
        else if (ts.isFunctionLike(p)) kosullar.push('=>');
        else if (ts.isJsxElement(p)) {
          if (p.openingElement.tagName.getText(SF) === 'details') gizli.push('<details>');
          gizli.push(...gizlilik(p.openingElement.attributes));
        }
      }
      out.push({ ozellik, kosullar: kosullar.reverse(), gizli, anaDonus: ustIfade === son && ts.isReturnStatement(son), dugum: n });
    }
    ts.forEachChild(n, gez);
  };
  gez(fn.body);
  return out;
}

test('RTU2 CreateModal: bos satir kolon sabitinden, satirdaki td sayisi = kolon sayisi', () => {
  const cm = normalize(govdeHam('CreateModal'));
  assert.ok(cm.includes('<TableEmptyRow colSpan={CM_KOLONLAR.length}'), 'bos satir colSpan kolon sabitine bagli degil');
  assert.ok(!/colSpan=\{\d+\}/.test(cm), 'CreateModal sayisal colSpan sabiti tasiyor');
  const kol = ustSabit('CM_KOLONLAR').initializer;
  assert.ok(kol && ts.isArrayLiteralExpression(kol), 'CM_KOLONLAR dizi literali degil');
  // Satir: disc.targets.map((t) => (<tr ...>)) ; dogrudan td cocuklari kolon kadar.
  const tr = yerlesim('CreateModal', 'tr').find((y) => y.kosullar.join(' / ') === 'disc && / disc.targets.length === 0 : / =>');
  assert.ok(tr, 'kesif satiri (<tr>) beklenen yerde degil');
  const el = tr.dugum.parent;
  const etiketi = (c) => (ts.isJsxElement(c) ? c.openingElement.tagName.getText(SF) : ts.isJsxSelfClosingElement(c) ? c.tagName.getText(SF) : null);
  const tdler = el.children.filter((c) => etiketi(c) === 'td');
  assert.equal(tdler.length, kol.elements.length, `satirda ${tdler.length} td, colgroup'ta ${kol.elements.length} kolon`);
  assert.ok(cm.includes('<TabloIskelet kolonlar={CM_KOLONLAR}'), 'baslik ve colgroup kolon sabitinden gelmiyor');
});

test('RTU3 tanimsiz token, sabit hex ve sari/kirmizi METIN rengi yok (RetirementTab tamami + yeni / dokunulan dosyalar)', () => {
  const kapsam = [['RetirementTab.tsx', RT_RAW], ...YENI.map((ad) => [ad, oku(ad)])];
  // Kapsam gercekten RecordModal'i iceriyor (dosya bolunurse bekci sessizce daralmasin).
  assert.ok(govdeHam('RecordModal').length > 10000 && RT_RAW.includes(govdeHam('RecordModal')), 'RecordModal kapsamda degil');
  const metinRengi = /(^|[\s{,(])color: [^,}\n]*?'var\(--status-(?:warning|danger)\)'/m;
  for (const [ad, kaynak] of kapsam) {
    const kod = kaynak.replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!metinRengi.test(kod), `${ad}: metin rengi --status-warning/--status-danger (AA alti; -text tokeni kullanin): ${(kod.match(metinRengi) || [''])[0]}`);
    assert.ok(!/#15803d|--accent-fg|--status-ok/.test(kod), `${ad}: tanimsiz token ya da sabit yesil`);
    assert.ok(!/(?:color|background|borderColor)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/.test(kod), `${ad}: sabit hex renk`);
  }
  // `renk` alani METIN rengi olur: hub yardimcilari (HubHucresi), DEG_RENK (once/sonra satirlari), SIM (akis).
  for (const [ad, kaynak] of [['RetirementTab.tsx', RT_RAW], ['RetirementAkis.tsx', oku('RetirementAkis.tsx')]])
    assert.ok(!/renk: 'var\(--status-(?:warning|danger)\)'/.test(kaynak.replace(/^\s*\/\/.*$/gm, '')), `${ad}: renk alani metin olarak sari/kirmizi`);
  for (const ad of ['hubDurumu', 'hubHucresi']) assert.ok(govdeHam(ad).includes('renk:'), `${ad}: renk alani bulunamadi (bekci kor)`);
});

test('RTU4 smBtn birincil dali --text-on-accent', () => {
  const stil = normalize(oku('retirementStil.ts'));
  assert.match(stil, /export const smBtn = \(primary = false\): React\.CSSProperties => \(primary \? \{ background: 'var\(--accent\)', borderColor: 'var\(--accent\)', color: 'var\(--text-on-accent\)' \}/);
  assert.ok(!/const smBtn|const SM_BTN/.test(RT_RAW), 'RetirementTab yerel smBtn / SM_BTN tanimliyor (tek kaynak retirementStil.ts)');
});

test('RTU5 CreateModal ve RecordModal: erken return yok (if icindekiler dahil)', () => {
  for (const ad of ['CreateModal', 'RecordModal']) {
    const fn = ustFonksiyon(ad);
    const ifadeler = fn.body.statements;
    const son = ifadeler[ifadeler.length - 1];
    assert.ok(son && ts.isReturnStatement(son), `${ad}: son ifade return degil`);
    const erken = [];
    const gez = (n) => {
      if (n !== fn && ts.isFunctionLike(n)) return; // ic fonksiyonlarin return'u serbest
      if (ts.isReturnStatement(n) && n !== son) erken.push(n.getText(SF).slice(0, 60));
      ts.forEachChild(n, gez);
    };
    ts.forEachChild(fn.body, gez);
    assert.deepEqual(erken, [], `${ad}: erken return (hook sirasi / yerlesim bekcileri bunu gormez)`);
  }
});

test('IPK1 CreateModal in-place uyarisini secili hedeflerle, gizlemeden basar', () => {
  const y = yerlesim('CreateModal', 'InPlaceUyari');
  assert.equal(y.length, 1, `InPlaceUyari ${y.length} kez basiliyor (1 bekleniyor)`);
  assert.deepEqual(y[0].kosullar, ['disc &&'], `InPlaceUyari beklenmeyen kosul altinda: ${y[0].kosullar.join(' / ')}`);
  assert.deepEqual(y[0].gizli, [], `InPlaceUyari gizli: ${y[0].gizli.join(', ')}`);
  assert.ok(y[0].anaDonus, 'InPlaceUyari ana return disinda');
  assert.equal(y[0].ozellik.hedefler, 'selected', 'uyari SECILI hedeflerle beslenmiyor');
  assert.ok(!('baglam' in y[0].ozellik) || y[0].ozellik.baglam === "'kayit'", 'yeni kayitta STOP baglami');
});

test('IPK2 in-place ENGELLEMEZ: create() ve "Kaydı aç" inPlace okumaz; uyari dosyasinda dugme / toast yok', () => {
  const cm = govdeHam('CreateModal');
  const i = cm.indexOf('const create = async () => {');
  assert.ok(i > 0, 'create() yok');
  const create = cm.slice(i, cm.indexOf('\n  };', i));
  assert.ok(!/inPlace|InPlace/.test(create), 'create() in-place hedefte kaydi engelliyor ya da degistiriyor');
  const dugme = yerlesim('CreateModal', 'button').find((b) => b.ozellik.onClick === 'create');
  assert.ok(dugme, '"Kaydı aç" dugmesi bulunamadi');
  assert.equal(dugme.ozellik.disabled, 'busy || !disc', `"Kaydı aç" kapisi degismis: ${dugme.ozellik.disabled}`);
  const ip = oku('RetirementInPlace.tsx').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/<button|disabled|toast|onChange/.test(ip), 'in-place uyarisi bir eylemi kapatiyor ya da soruyor');
});

test("IPK3 hedef hucresinde 'in-place' cipi ipucuyla; CreateModal hucreyi t ile basar", () => {
  const cip = yerlesim('HedefHucresi', 'Cip').filter((c) => /inPlaceIpucu/.test(String(c.ozellik.title)));
  assert.equal(cip.length, 1, "in-place cipi hedef hucresinde yok");
  assert.deepEqual(cip[0].kosullar, ['h.inPlace &&']);
  assert.equal(cip[0].ozellik.title, 'inPlaceIpucu(h.digerSurumler)');
  assert.equal(cip[0].ozellik.ton, "'uyari'");
  assert.equal(normalize(cip[0].dugum.parent.getText(SF)), "<Cip ton='uyari' title={inPlaceIpucu(h.digerSurumler)}>in-place</Cip>");
  const h = yerlesim('CreateModal', 'HedefHucresi');
  assert.equal(h.length, 1);
  assert.equal(h[0].ozellik.h, 't');
  // Cip kirilmaz (whitespace-nowrap) - vitest RUI2 davranisi, burada kaynak.
  assert.match(oku('RetirementUi.tsx'), /export function Cip[\s\S]*?className="[^"]*\bwhitespace-nowrap\b[^"]*"/);
});

// TS modulunu typescript ile CommonJS'e cevirip saf yardimcisini cagirir (ithal adlar sahte).
function tsModul(dosya, adlar) {
  const kaynak = oku(dosya);
  const cikti = ts.transpileModule(kaynak, { fileName: dosya, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const sahte = new Proxy(function () {}, { get: (_t, k) => (k === '__esModule' ? true : sahte), apply: () => sahte });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', cikti)(m, m.exports, () => sahte);
  for (const a of adlar) assert.equal(typeof m.exports[a], 'function', `${dosya}: ${a} disari acilmiyor`);
  return m.exports;
}

test('IPK4 SOZLESME: gercek kesif (in-place) ciktisi istemcinin inPlaceOzeti alanlariyla okunur', () => {
  const { inPlaceOzeti } = tsModul('RetirementInPlace.tsx', ['inPlaceOzeti']);
  const r7 = { app: 'GBPOSWEBAPI', host: 'GOJBAP05', env: 'Production', domain: 'garanti.com.tr', jboss_version: '7.4.8', app_path: '/vhosting/GBPOSWEBAPI.ear', status: 'running' };
  const r8 = { ...r7, jboss_version: '8.0.0', app_path: '/vhosting8/GBPOSWEBAPI.ear' };
  const certs = [{ host: 'GOJBWP05', ip: '', port: '443', server_name: 'gbposwebapi.garanti.com.tr', conf_file: '/ihs/GBPOSWEBAPI.conf', product: 'IHS', env: 'PROD' }];
  const t = buildTargets('GBPOSWEBAPI', [r7, r8], certs, [], [], []).targets;
  const yedi = t.find((x) => x.gen === 7);
  assert.ok(yedi && yedi.inPlace === true, 'kesif in-place isaretlemedi (senaryo bozuk)');
  const [o] = inPlaceOzeti([yedi]);
  assert.ok(o, 'istemci gercek kesif ciktisinda in-place hedefi gormuyor (alan adi ayristi)');
  assert.deepEqual(o.diger, [8], 'istemci digerSurumler alanini okuyamiyor');
  assert.ok(o.elle >= 1, 'istemci web[].elle alanini okuyamiyor');
  assert.deepEqual(o.digerSecili, []);
  assert.deepEqual(inPlaceOzeti(t).map((x) => x.digerSecili), [[8], [7]]);
  const tek = buildTargets('GBPOSWEBAPI', [r7], certs, [], [], []).targets;
  assert.deepEqual(inPlaceOzeti(tek), [], 'tek kurulumlu hedef in-place uyarisi uretiyor');
});

// ── KAYIT AYRINTISI (RecordModal) ──────────────────────────────────────────────────────────────
const etiketi = (c) => (ts.isJsxElement(c) ? c.openingElement.tagName.getText(SF) : ts.isJsxSelfClosingElement(c) ? c.tagName.getText(SF) : null);
const enYakinFonksiyon = (n) => { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p; return null; };
const enYakinJsx = (n) => { for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) || ts.isJsxFragment(p)) return p; return null; };

test('RTU1 RecordModal: ayrinti satiri tiklanan satirin altinda (ayni map / Fragment), colSpan kolon sayisindan', () => {
  const rm = normalize(govdeHam('RecordModal'));
  assert.ok(!/colSpan=\{\d+\}/.test(rm), 'RecordModal sayisal colSpan sabiti tasiyor');
  assert.ok(rm.includes('<TableEmptyRow colSpan={kolonlar.length}'), 'bos satir colSpan kolon dizisine bagli degil');
  const trler = yerlesim('RecordModal', 'tr');
  const ana = trler.filter((y) => 'data-tid' in y.ozellik);
  const ayr = trler.filter((y) => 'data-rt-ayrinti' in y.ozellik);
  assert.equal(ana.length, 1, `ana satir ${ana.length} kez`);
  assert.equal(ayr.length, 1, `ayrinti satiri ${ayr.length} kez`);
  // Ayni map geri donusu (tbody sonuna basilan ayri blok DEGIL) ve ayni Fragment.
  const fn = enYakinFonksiyon(ana[0].dugum);
  assert.ok(fn && fn === enYakinFonksiyon(ayr[0].dugum), 'ayrinti satiri ana satirla ayni map geri donusunde degil');
  assert.ok(ts.isCallExpression(fn.parent) && /\.map$/.test(fn.parent.expression.getText(SF)), 'satirlar map icinde degil');
  const kap = enYakinJsx(ana[0].dugum.parent);
  assert.ok(kap && kap === enYakinJsx(ayr[0].dugum.parent), 'ayrinti satiri ana satirla ayni Fragment icinde degil');
  assert.ok(ts.isJsxElement(kap) && /Fragment$/.test(kap.openingElement.tagName.getText(SF)), 'satirlar Fragment icinde degil');
  const sira = kap.children.map((c) => c.getText(SF));
  const anaI = sira.findIndex((x) => x.includes('data-tid'));
  const ayrI = sira.findIndex((x) => x.includes('data-rt-ayrinti'));
  assert.ok(anaI >= 0 && ayrI > anaI, 'ayrinti satiri ana satirdan once ya da ayni Fragment cocugu degil');
  // Ayrinti hucresi tam genislik: colSpan={kolonlar.length}.
  const td = ayr[0].dugum.parent.children.find((c) => etiketi(c) === 'td');
  assert.ok(td && normalize(td.openingElement.getText(SF)).includes('colSpan={kolonlar.length}'), 'ayrinti hucresi tam genislikte degil');
  // Satirdaki td sayisi = rmKolonlar dizisi.
  const kol = ustSabit('rmKolonlar').initializer;
  assert.ok(kol && ts.isArrowFunction(kol) && ts.isArrayLiteralExpression(kol.body), 'rmKolonlar dizi donduren ok fonksiyonu degil');
  const tdler = ana[0].dugum.parent.children.filter((c) => etiketi(c) === 'td');
  assert.equal(tdler.length, kol.body.elements.length, `satirda ${tdler.length} td, kolonlarda ${kol.body.elements.length}`);
  assert.ok(rm.includes('const kolonlar = rmKolonlar(topluVar);') && rm.includes('<TabloIskelet kolonlar={kolonlar} />'), 'baslik / colgroup kolon dizisinden gelmiyor');
});

test('RTU6 GA12 erken uyari: kosuldan "Geri aktif et</button>" sonuna <= 1300 karakter', () => {
  const m = RT_RAW.match(/\{\(t\.status === 'stopped' \|\| t\.status === 'rollback_failed' \|\| \(t\.status === 'failed' && [^\n]*?\)\)([^\n]*)&& \(/);
  assert.ok(m, 'geri alma kosulu bulunamadi (GA12 de kirmizi olur)');
  const bas = RT_RAW.indexOf(m[0]);
  const son = RT_RAW.indexOf('Geri aktif et</button>', bas);
  assert.ok(son > bas, 'kosuldan sonra "Geri aktif et</button>" yok');
  const mesafe = son + 'Geri aktif et</button>'.length - bas;
  assert.ok(mesafe <= 1300, `mesafe ${mesafe} > 1300 (GA12 siniri 1500; blok buyuyor)`);
});

test('IPK5 kayit satiri in-place bilgisini kayittan, yoksa TEMBEL kesiften alir', () => {
  const rm = normalize(govdeHam('RecordModal'));
  assert.ok(rm.includes('const ipHarita = ipKesif ?? inPlaceHaritasi(askDisc);'), 'harita: once tembel kesif, sonra onay kesfi degil');
  // Ucuncu arguman kaydin hedefleri: diger kurulum da bu kayittaysa metin "hala calisiyor mu" demez (denetim B1).
  assert.ok(rm.includes('const ipOf = (t: RtTarget) => inPlaceBilgisi(t, ipHarita, rec?.targets);'), 'satir bilgisi inPlaceBilgisi (kayit oncelikli, kayittaki diger kurulum) ile degil');
  const h = yerlesim('RecordModal', 'HedefHucresi');
  assert.equal(h.length, 1);
  assert.equal(h[0].ozellik.h, '{ ...t, inPlace: ip.inPlace, digerSurumler: ip.digerSurumler }', 'hedef hucresi in-place bilgisini ipOf ile almiyor');
  assert.ok(rm.includes('const ip = ipOf(t);'), 'satirda ip = ipOf(t) yok');
  // Tembel kesif: yalniz isaretsiz (null / yok) hedef varken, BIR kez, hata yutulur (ekran calisir).
  assert.match(rm, /const ipGerek = !!rec && rec\.targets\.some\(\(t\) => t\.inPlace == null && /);
  const i = rm.indexOf('useAsyncEffect(async (alive) => {');
  assert.ok(i > 0, 'tembel kesif useAsyncEffect ile degil (effect govdesinde setState uyarisi)');
  const blok = rm.slice(i, rm.indexOf('}, [ipGerek, recApp]);', i));
  assert.ok(blok.includes('if (!ipGerek || !recApp || ipIstendi.current) return;') && blok.includes('ipIstendi.current = true;'), 'kesif bir kez ile sinirli degil');
  assert.ok(blok.includes('await retirementApi.discover(recApp)') && blok.includes('if (alive()) setIpKesif(inPlaceHaritasi(d));'), 'kesif sonucu haritaya yazilmiyor');
  assert.match(blok, /\} catch \{/, 'kesif hatasi yutulmuyor: ekran duser');
});

test("IPK6 STOP onayinda in-place uyarisi ENGELLEMEZ: yalniz `ask &&` altinda, baglam 'stop'", () => {
  const y = yerlesim('RecordModal', 'InPlaceUyari');
  assert.equal(y.length, 1, `STOP onayinda InPlaceUyari ${y.length} kez`);
  assert.deepEqual(y[0].kosullar, ['ask &&'], `beklenmeyen kosul: ${y[0].kosullar.join(' / ')}`);
  assert.deepEqual(y[0].gizli, []);
  assert.equal(y[0].ozellik.baglam, "'stop'");
  assert.equal(y[0].ozellik.hedefler, 'ask.ts.map((t) => ({ ...t, ...ipOf(t) }))', 'uyari onaydaki hedeflerle (in-place bilgisiyle) beslenmiyor');
  // Diger kurulum KAYITTA hedefse (onayda olmasa da) "bu kayitta hedef" der, "hala calisiyor mu" demez (denetim B1).
  assert.equal(y[0].ozellik.kayittakiler, "rec?.targets.filter((x) => x.status !== 'skipped')", 'STOP onayi kayittaki diger kurulumu bilmiyor');
  const rm = govdeHam('RecordModal');
  const oc = rm.indexOf('onClick={() => stopCalistir(ask.ts, true');
  const dugme = rm.slice(rm.lastIndexOf('<button', oc), rm.indexOf('</button>', oc));
  assert.ok(oc > 0 && !/inPlace|ipOf|ipHarita|InPlace/.test(dugme), 'son onay dugmesi in-place bilgisine bagli');
  const sc = rm.slice(rm.indexOf('const stopCalistir = async'), rm.indexOf('const stop = (t: RtTarget'));
  assert.ok(sc.length > 100 && !/inPlace|ipOf/.test(sc), 'stopCalistir in-place hedefi engelliyor ya da degistiriyor');
});

test('IPK7 is sonrasi kontrol notu yalniz in-place hedefte, gizlenmeden; ayrinti satirina in-place bilgisi gider', () => {
  const rm = normalize(govdeHam('RecordModal'));
  assert.ok(rm.includes('const ipAsama = ip.inPlace ? inPlaceAsamasi(t) : null;'), 'asama in-place olmayan hedefte de hesaplaniyor');
  const not = yerlesim('RecordModal', 'div').filter((y) => 'data-rt-inplace-not' in y.ozellik);
  assert.equal(not.length, 1);
  assert.equal(not[0].kosullar[not[0].kosullar.length - 1], 'ipAsama &&');
  assert.deepEqual(not[0].gizli, [], `not gizli: ${not[0].gizli.join(', ')}`);
  const ay = yerlesim('RecordModal', 'RetirementHedefAyrinti');
  assert.equal(ay.length, 1);
  assert.equal(ay[0].ozellik.inPlace, 'ip');
  assert.equal(ay[0].ozellik.onIsBitti, 'load', 'is bitince kayit yeniden okunmuyor');
});

test('ISK1 is ciktisi eski jobStatus ucunu cagirmaz; uc istemciden sunucu / is no almaz', () => {
  for (const ad of ['RetirementIsCiktisi.tsx', 'RetirementHedefAyrinti.tsx', 'retirementCikti.ts']) {
    const k = oku(ad).replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/jobStatus\(|job-status/.test(k), `${ad} eski (yan etkili) job-status ucunu cagiriyor`);
  }
  assert.match(oku('RetirementIsCiktisi.tsx'), /retirementApi\.isCiktisi\(kayitId, tid, is\.adim, is\.web, ac\.signal\)/);
  const api = fs.readFileSync(path.join(ROOT, 'src', 'api', 'retirementApi.ts'), 'utf8');
  const m = api.match(/isCiktisi: \(([^)]*)\)[^\n]*\n\s*fetch\(`([^`]*)`/);
  assert.ok(m, 'isCiktisi tanimi bulunamadi');
  assert.equal(m[1], 'id: number, tid: number, adim: RtIsAdim, web?: number, signal?: AbortSignal');
  assert.ok(!/jobId|serverId|awxServerId/.test(m[2]), `URL istemciden is / sunucu numarasi tasiyor: ${m[2]}`);
});

// ── DUSMANCA DENETIM TUR 2 ─────────────────────────────────────────────────────────────────────
test('RTU7 WebKaynak / WebAyrinti cipleri metne yapismaz: her cagri yerinin kabi gap-x li flex', () => {
  const dosyalar = [['RetirementTab.tsx', SF], ['RetirementWebSatir.tsx', ts.createSourceFile('RetirementWebSatir.tsx', oku('RetirementWebSatir.tsx'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX)]];
  let sayi = 0;
  for (const [ad, sf] of dosyalar) {
    const gez = (n) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && ['WebKaynak', 'WebAyrinti'].includes(n.tagName.getText(sf))) {
        let p = n.parent;
        while (p && !ts.isJsxElement(p)) p = p.parent;
        if (p && p.openingElement === n) { p = p.parent; while (p && !ts.isJsxElement(p)) p = p.parent; }
        assert.ok(p, `${ad}: <${n.tagName.getText(sf)}> ust ogesi yok`);
        const sinif = p.openingElement.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className');
        const metin = sinif ? sinif.getText(sf) : '';
        assert.ok(/\bflex\b/.test(metin) && /\bgap-x-/.test(metin), `${ad}: <${n.tagName.getText(sf)}> kabi gap-x'li flex degil (cip metne yapisir): ${metin || '(sinif yok)'}`);
        sayi += 1;
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  assert.ok(sayi >= 3, `cagri yeri bulunamadi (bekci kor): ${sayi}`);
});

test('RTU8 focus-visible:outline-offset-2 onemli (!): katmansiz :focus-visible kurali ezmesin', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'index.css'), 'utf8');
  assert.match(css, /:focus-visible\s*\{[^}]*outline-offset:\s*1px/, 'index.css kurali degisti: bu bekci yeniden degerlendirilmeli');
  let sayi = 0;
  for (const [ad, kaynak] of [['RetirementTab.tsx', RT_RAW], ...YENI.map((x) => [x, oku(x)])]) {
    assert.ok(!/focus-visible:outline-offset-2(?!!)/.test(kaynak), `${ad}: focus-visible:outline-offset-2 onemsiz (index.css 1px ile ezer)`);
    sayi += (kaynak.match(/focus-visible:outline-offset-2!/g) || []).length;
  }
  assert.ok(sayi >= 4, `onemli odak kaymasi bulunamadi (bekci kor): ${sayi}`);
});

test('IPK8 CreateModal in-place uyarisi surum kutusundan hemen sonra, trafik / web uyarilarindan once', () => {
  const cm = govdeHam('CreateModal');
  const ip = cm.indexOf('<InPlaceUyari');
  const surum = cm.indexOf('Seçimde birden fazla sürüm var');
  const trafik = cm.indexOf('{trafikli.length > 0 && (');
  const webYok = cm.indexOf('{webYokHedefler.length > 0 && (');
  assert.ok(surum > 0 && trafik > 0 && webYok > 0, 'uyari yigini bulunamadi');
  assert.ok(ip > surum && ip < trafik && ip < webYok, 'in-place uyarisi yigindaki yerinde degil (surum kutusundan hemen sonra)');
  assert.match(oku('RetirementInPlace.tsx'), /<UyariKutusu ton="uyari" vurgu baslik=\{<><Cip ton="uyari" cerceve>IN-PLACE<\/Cip>/, 'in-place uyarisi digerlerinden ayrismiyor (vurgu + IN-PLACE cipi)');
});

test('RTU9 yerlesim / erisilebilirlik duzeltmeleri (paket sonek, hub 20px, eylem hizasi, form etiketleri, terminal basligi)', () => {
  const paket = govdeHam('PaketHucresi');
  assert.match(paket, /style=\{\{ color: 'var\(--text-primary\)', direction: 'rtl' \}\}[^>]*><bdi dir="ltr">\{ad\}<\/bdi>/, 'paket adi bastan kisaltilmiyor (ayirt edici -Q/-T.ear soneki kesilir)');
  const cm = govdeHam('CreateModal');
  assert.ok(cm.includes('<div className="flex min-w-0 text-[11px] leading-5 break-words"><HubHucresi hub={t.hub} okunamadi={hubYok} /></div>'), 'hub hucresi flex kapta degil (inline-flex satiri 23px yapar)');
  const etiketler = (cm.match(/<label htmlFor="rt-cm-[a-z]+"/g) || []).length;
  const idler = (cm.match(/id="rt-cm-[a-z]+"/g) || []).length;
  assert.ok(etiketler === 7 && idler === 7, `form etiketleri input'larla iliskili degil (${etiketler} etiket / ${idler} id)`);
  const rm = govdeHam('RecordModal');
  assert.ok(rm.includes('<div className="-mt-0.5 flex min-w-0 flex-col items-start gap-1">'), 'eylem kolonu ilk satir hizasi (-2px) yok');
  assert.ok(rm.includes('inline-flex min-h-6 items-center text-[11px] leading-4') && rm.includes('flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">') && rm.includes('not-first:pt-0.5'), 'eylem kolonunun metin satirlari 24px degil');
  const term = fs.readFileSync(path.join(ROOT, 'src', 'components', 'common', 'AnsibleLogTerminal.tsx'), 'utf8');
  assert.ok(!/text-white\/(?:30|40)\b/.test(term), 'terminal basligi AA alti (white/30-40 koyu zeminde 2.6-3.8:1)');
});
