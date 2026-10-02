// server/server-hub/__tests__/ui-v2.test.cjs - Server Hub sozlesme v3, dalga 1, UI bekcisi (G11).
//
// Kapsam: D1-U01..U09 + ek EK-2 (staleFleet bandi) + kural 6 ("olculemedi" ile "yok" karismaz)
// UI tarafi. Sunucu tarafi (assess/index) v2-guvenlik.test.cjs'tedir (C); burasi YALNIZ ekranin
// olculemeyeni "kapali / yok / 0 / temiz" diye gostermedigini kilitler.
// Dalga 1 dogrulama duzeltmeleri: D1 RetirementTab summary.hubUnavailable ('Server Hub okunamadi'
// + STOP onay uyarisi), D2 EK-1 /overview rollback bandi, D3 EK-2 /findings staleFleet ->
// Bulgular sekmesi bandi. D1/D2/D3 SUNUCU YANITI -> EKRAN baglantisini da sinar: gercek
// discover() ve gercek index.cjs router'i (sahte mssql) ciktisi ekranin yardimcilarina verilir.
// Dalga 2 (T2-D1/T2-D2): bantlar ve uyari kutusu bilesen olarak CAGRILIR (ekrana ne cikiyor),
// yerlesim AST ile denetlenir; schemaUnknown (C3), targetsTruncated (C4), unattributed[] (EK-3),
// JVM_UNDEFINED_PROCESS / tanimsiz-surec (T2-C2) ve hazirlik sebep kodlari ekrana baglanir.
// Sema bilinmiyorken Sunucular sekmesi ozet/liste basliklari da sebebi sema yazar (olcumSebebi),
// RetirementTab kesif hucresi (HubHucresi) de bilesen olarak cagrilir ve AST ile yerlestirilir.
//
// UC KATMAN:
//   1) DAVRANIS: ServerHubPage.tsx ve RetirementTab.tsx GERCEK kaynaktan typescript ile
//      CommonJS'e cevrilir, modul disariya acilmayan saf yardimcilar (jvmDurumu, ipKullanan,
//      logKanitMetni, ...) sahte require ile yuklenip CAGRILIR. 'react/jsx-runtime' icin kucuk
//      bir GERCEK fabrika verilir (jsx/jsxs -> { type, props }): hook kullanmayan bilesenler
//      (GeriAlmaBandi, BayatFiloBandi, SemaBandi, StopHubUyari, ...) duz fonksiyon olarak
//      cagrilir ve DONEN OGE denetlenir (null mu, metin, title, hidden/display:none).
//   2) YERLESIM (AST, typescript): bilesenin ilgili sekmede GERCEKTEN basildigi - kac kez, hangi
//      kosul altinda ({false && ...} / ternary / if), ana return'de mi, gizli bir atanin
//      (hidden, display:'none', <details>) altinda mi, hangi alani okudugu. Bicimlendiriciden
//      bagimsizdir (prettier satir bolse de AST ayni).
//   3) BAGLANTI (metin, guard-text normalize()): kalan dizgi bekcileri. Depo prettier-bicimli
//      degil; normalize() bosluk ve tirnak farkini yutar.
//
// ARAC KOSMADI = KIRMIZI: typescript paketi yoksa test acik hatayla duser, yesil donmez.
//
// Korluk: gorsel render sinanmaz (renk/konum/tek satirin gercekten tek satir kalmasi manuel
// ekran kontrolu, yayin adimi). Hook kullanan sekmeler (HostsTab, FindingsTab, HostModal,
// RecordModal) render EDILMEZ: onlarin icindeki yerlesim AST ile, yerlestirilen bilesenin
// davranisi cagrilarak sinanir. Bir atanin CSS sinifi disinda (ust bilesenin kosullu render'i,
// Modal'in kapali olmasi) gizlenme AST'de gorunmez. Alan adlari C'nin index.cjs yanitiyla
// sozlesmedeki donuk adlarla eslesir (jvmsUnmeasured, runningKnown, runningSrc,
// summary.jvm.unmeasured, retireBlockedByWebTier, notRunningUnmeasured, staleFleet, rollback,
// schemaUnknown, targetsTruncated, unattributed[].kind/.target).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../../util/guard-text.cjs');

const ROOT = path.join(__dirname, '..', '..', '..');
const PAGE_PATH = path.join(ROOT, 'src', 'components', 'server_hub', 'ServerHubPage.tsx');
const RT_PATH = path.join(ROOT, 'src', 'components', 'server_hub', 'RetirementTab.tsx');
const RT_API_PATH = path.join(ROOT, 'src', 'api', 'retirementApi.ts');
const PAGE_RAW = fs.readFileSync(PAGE_PATH, 'utf8');
const RT_RAW = fs.readFileSync(RT_PATH, 'utf8');
const PAGE = normalize(PAGE_RAW);
const RT = normalize(RT_RAW);

function tsYukle() {
  try {
    return require('typescript');
  } catch (e) {
    throw new Error(
      'typescript paketi yuklenemedi - UI davranis bekcisi KOSAMADI (yesil sayilmaz): ' + e.message,
    );
  }
}

// Her ozellik okumasinda kendini, her cagrida kendini donduren sahte modul. Ust duzey kod
// yalniz sabit tanimlar (SEV, AREA ...) ve ithal edilen adlari OKUR; hook'lu bilesenler cagrilmaz.
function sahteModul() {
  const hedef = function () {};
  const p = new Proxy(hedef, {
    get(_t, k) {
      if (k === '__esModule') return true;
      if (k === Symbol.toPrimitive) return () => '';
      return p;
    },
    apply() {
      return p;
    },
    construct() {
      return p;
    },
  });
  return p;
}

// GERCEK (kucuk) jsx fabrikasi: bilesen cagrildiginda donen oge { type, props } olur; boylece
// bandin null mu dondugu, metni, title'i ve gizlenip gizlenmedigi OLCULUR (T2-D1).
const jsxFab = (type, props) => ({ type, props: props || {} });
const JSX_RUNTIME = { __esModule: true, jsx: jsxFab, jsxs: jsxFab, Fragment: 'Fragment' };

function yukle(dosya, kaynak, adlar) {
  const ts = tsYukle();
  const cikti = ts.transpileModule(kaynak, {
    fileName: path.basename(dosya),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const ek =
    '\n;module.exports.__yardimcilar = {' +
    adlar.map((a) => `${a}: (typeof ${a} === 'undefined' ? undefined : ${a})`).join(', ') +
    '};\n';
  const m = { exports: {} };
  const sahteRequire = (ad) => (ad === 'react/jsx-runtime' ? JSX_RUNTIME : sahteModul());
  new Function('module', 'exports', 'require', cikti + ek)(m, m.exports, sahteRequire);
  return m.exports.__yardimcilar;
}

const P = yukle(PAGE_PATH, PAGE_RAW, [
  'jvmCalismaBilinir',
  'jvmDurumu',
  'webDurumu',
  'olcumSebebi',
  'olculemeyenAciklama',
  'jvmSayimMetni',
  'autoStartOnayMetni',
  'ipKullanan',
  'logKanitMetni',
  'initDurumu',
  'KOD_ETIKET',
  'kodEtiketi',
  'hazirlikSebebi',
  'AUTOSTART_SEBEP_ETIKET',
  'autoBilinmiyorKirilimi',
  'yukleyiciOzeti',
  'bayatFiloMetni',
  'BayatFiloBandi',
  'geriAlmaMetni',
  'GeriAlmaBandi',
  'semaBilinmiyorMetni',
  'SemaBandi',
  'hedefKesikRozeti',
  'HedefKesikRozeti',
  'ATF_TUR',
  'atfedilemeyenSatiri',
  'AtfedilemeyenTrafik',
]);
const R = yukle(RT_PATH, RT_RAW, [
  'hubDurumu',
  'hubOkunamadi',
  'hubHucresi',
  'HubHucresi',
  'stopHubDurumu',
  'stopHubUyarisi',
  'StopHubUyari',
]);

/**
 * Ust duzey bir fonksiyonun (bilesen ya da yardimci) govdesi, normalize() edilmis. Sinir: bir
 * sonraki SATIR BASI 'function' / 'export function' / 'export default function'. Ic ice
 * (girintili) fonksiyonlar siniri kesmez.
 */
function govde(raw, ad) {
  const bas = new RegExp(`\\n(?:export )?(?:default )?function ${ad}\\(`).exec(raw);
  assert.ok(bas, `${ad} fonksiyonu kaynakta yok`);
  const sonraki = /\n(?:export )?(?:default )?function /g;
  sonraki.lastIndex = bas.index + 1;
  const son = sonraki.exec(raw);
  return normalize(raw.slice(bas.index, son ? son.index : undefined));
}

const fonksiyon = (o, ad) => {
  assert.equal(typeof o[ad], 'function', `${ad} yardimcisi yok - UI olculemeyeni ayirt edemiyor`);
  return o[ad];
};
const say = (metin, alt) => metin.split(alt).length - 1;

// ── Donen ogenin denetimi (jsx fabrikasi ciktisi) ──────────────────────────────────────
/** Ogedeki tum duz metin (children agaci). Sahte modul (fonksiyon) atlanir. */
function metinleri(dugum) {
  const out = [];
  const gez = (x) => {
    if (x == null || typeof x === 'boolean') return;
    if (typeof x === 'string' || typeof x === 'number') {
      out.push(String(x));
      return;
    }
    if (Array.isArray(x)) {
      x.forEach(gez);
      return;
    }
    if (typeof x === 'object' && x.props) gez(x.props.children);
  };
  gez(dugum);
  return out.join('');
}
const GIZLI_SINIF = /(^|[\s'`{])(hidden|invisible|sr-only)(?=[\s'`}]|$)/;
const GIZLI_STIL = /display: ?'none'|visibility: ?'hidden'|opacity: ?0(?![.\d])/;
/** Donen ogede gorunurlugu kapatan bir sey var mi (hidden, sinif, stil). */
function gorunurlukSorunlari(el) {
  const p = (el && el.props) || {};
  const s = [];
  if (p.hidden) s.push('hidden');
  if (p['aria-hidden'] && String(p['aria-hidden']) !== 'false') s.push('aria-hidden');
  if (GIZLI_SINIF.test(` ${p.className || ''} `)) s.push(`className '${p.className}'`);
  const st = p.style || {};
  if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === 0) s.push(`style ${JSON.stringify(st)}`);
  return s;
}

// ── YERLESIM (AST) ─────────────────────────────────────────────────────────────────────
const _agaclar = new Map();
function kaynakAgaci(raw, dosya) {
  if (!_agaclar.has(raw)) {
    const ts = tsYukle();
    _agaclar.set(raw, ts.createSourceFile(path.basename(dosya), raw, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX));
  }
  return _agaclar.get(raw);
}
function ustFonksiyon(raw, dosya, ad) {
  const ts = tsYukle();
  const sf = kaynakAgaci(raw, dosya);
  const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name && s.name.text === ad);
  assert.ok(fn && fn.body, `${ad} ust duzey fonksiyonu kaynakta yok`);
  return { ts, sf, fn };
}
const dugumMetni = (sf, n) => normalize(n.getText(sf));
/** JSX ozniteliklerinde gorunurlugu kapatan bir sey (hidden, sinif, stil). */
function gizlilik(ts, sf, attrs) {
  const out = [];
  for (const a of attrs.properties) {
    if (!ts.isJsxAttribute(a)) continue;
    const ad = a.name.getText(sf);
    const d = a.initializer ? dugumMetni(sf, a.initializer) : '{true}';
    if (ad === 'hidden' && d !== '{false}') out.push(`hidden=${d}`);
    if (ad === 'aria-hidden' && !/false/.test(d)) out.push(`aria-hidden=${d}`);
    if (ad === 'className' && GIZLI_SINIF.test(d)) out.push(`className=${d}`);
    if (ad === 'style' && GIZLI_STIL.test(d)) out.push(`style=${d}`);
  }
  return out;
}
/**
 * Ust duzey `fonksiyon` icinde <etiket ...> ogesinin her gecisi:
 *   ozellik  : { prop: ifade metni (normalize) }
 *   kosullar : distan ice ata kosullari ('x &&', 'c ?', 'c :', 'if (c)', '=>' ic fonksiyon)
 *   gizli    : oge ya da JSX atalarindaki hidden / gizleyen sinif / display:'none' / <details>
 *   anaDonus : fonksiyonun SON ifadesi olan return'un icinde ve oncesinde kosulsuz return yok
 */
function yerlesim(raw, dosya, fonksiyon, etiket) {
  const { ts, sf, fn } = ustFonksiyon(raw, dosya, fonksiyon);
  const ifadeler = fn.body.statements;
  const son = ifadeler[ifadeler.length - 1];
  const oluKod = ifadeler.slice(0, -1).some((s) => ts.isReturnStatement(s));
  const out = [];
  const gez = (n) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === etiket) {
      const ozellik = {};
      for (const a of n.attributes.properties) {
        if (ts.isJsxAttribute(a)) {
          const ini = a.initializer;
          ozellik[a.name.getText(sf)] = !ini
            ? true
            : ts.isJsxExpression(ini)
              ? ini.expression
                ? dugumMetni(sf, ini.expression)
                : ''
              : dugumMetni(sf, ini);
        } else ozellik['...'] = dugumMetni(sf, a);
      }
      const kosullar = [];
      const gizli = gizlilik(ts, sf, n.attributes);
      let cocuk = ts.isJsxOpeningElement(n) ? n.parent : n;
      let ustIfade = null;
      for (let p = cocuk.parent; p && p !== fn; cocuk = p, p = p.parent) {
        if (p === fn.body) {
          ustIfade = cocuk;
          break;
        }
        if (ts.isBinaryExpression(p)) {
          const op = p.operatorToken.getText(sf);
          if (['&&', '||', '??'].includes(op))
            kosullar.push(p.right === cocuk ? `${dugumMetni(sf, p.left)} ${op}` : `${op} ${dugumMetni(sf, p.right)}`);
        } else if (ts.isConditionalExpression(p)) {
          if (p.whenTrue === cocuk) kosullar.push(`${dugumMetni(sf, p.condition)} ?`);
          else if (p.whenFalse === cocuk) kosullar.push(`${dugumMetni(sf, p.condition)} :`);
        } else if (ts.isIfStatement(p)) kosullar.push(`if (${dugumMetni(sf, p.expression)})`);
        else if (ts.isFunctionLike(p)) kosullar.push('=>');
        else if (ts.isJsxElement(p)) {
          if (p.openingElement.tagName.getText(sf) === 'details') gizli.push('<details> (kapali)');
          gizli.push(...gizlilik(ts, sf, p.openingElement.attributes));
        }
      }
      out.push({
        ozellik,
        kosullar: kosullar.reverse(),
        gizli,
        anaDonus: !oluKod && ustIfade === son && ts.isReturnStatement(son),
      });
    }
    ts.forEachChild(n, gez);
  };
  gez(fn.body);
  return out;
}
/** Tek ve gorunur yerlesim; beklenen kosullar ve ozellikler. Donen: o yerlesim. */
function tekYerlesim(raw, dosya, fonksiyon, etiket, { kosullar = [], ozellik = {} } = {}) {
  const y = yerlesim(raw, dosya, fonksiyon, etiket);
  assert.equal(y.length, 1, `${fonksiyon}: <${etiket}> ${y.length} kez basiliyor (1 bekleniyor) - gosterilmiyor ya da cift`);
  const [e] = y;
  assert.deepEqual(e.kosullar, kosullar, `${fonksiyon}: <${etiket}> beklenmeyen kosul altinda: [${e.kosullar.join(' / ')}]`);
  assert.deepEqual(e.gizli, [], `${fonksiyon}: <${etiket}> gizli: ${e.gizli.join(', ')}`);
  assert.ok(e.anaDonus, `${fonksiyon}: <${etiket}> fonksiyonun ana return'unde degil (olu dal / erken donus)`);
  for (const [k, v] of Object.entries(ozellik))
    assert.equal(e.ozellik[k], v, `${fonksiyon}: <${etiket} ${k}={${e.ozellik[k]}}> (beklenen {${v}})`);
  return e;
}
/** Fonksiyon icindeki `ad(...)` cagrilarinin arguman metinleri (normalize). */
function cagrilar(raw, dosya, fonksiyon, ad) {
  const { ts, sf, fn } = ustFonksiyon(raw, dosya, fonksiyon);
  const out = [];
  const gez = (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === ad) out.push(n.arguments.map((a) => dugumMetni(sf, a)));
    ts.forEachChild(n, gez);
  };
  gez(fn.body);
  return out;
}
/** '<Bilesen prop={data.X} />' yerlesiminden ekranin OKUDUGU anahtar X (nesne adi da sinanir). */
function okunanAnahtar(raw, dosya, fonksiyon, etiket, prop, nesne, kosullar = []) {
  const e = tekYerlesim(raw, dosya, fonksiyon, etiket, { kosullar });
  const m = /^(\w+)\??\.(\w+)$/.exec(String(e.ozellik[prop] || ''));
  assert.ok(m && m[1] === nesne, `${fonksiyon}: <${etiket} ${prop}={${e.ozellik[prop]}}> '${nesne}.<alan>' okumuyor`);
  return m[2];
}

// ── D1-U01 IP 'unverified' ────────────────────────────────────────────────────────────
test("D1-U01 IP 'unverified' ayri etiket (DOGRULANAMADI) ve ayri renk; toUpperCase'e dusmez", () => {
  const ip = fonksiyon(P, 'ipKullanan');
  const u = ip('unverified');
  const bos = ip('none');
  assert.equal(u.etiket, 'DOĞRULANAMADI');
  assert.notEqual(u.etiket, 'UNVERIFIED', "'unverified' urun adi gibi basiliyor");
  assert.notEqual(u.renk, bos.renk, "'unverified' BOSTA ile ayni renkte - atil sanilir");
  assert.equal(bos.etiket, 'BOŞTA');
  assert.equal(ip('wildcard').etiket, 'joker dinleyici (*)');
  assert.equal(ip('other').etiket, 'web dışı soket');
  assert.equal(ip('ihs').etiket, 'IHS', 'urun adlari eskisi gibi buyuk harf');
  assert.ok(PAGE.includes('ipKullanan(ip.usedBy)'), 'IP tablosu yardimciyi kullanmiyor');
  // Ozet karti: total - unused 'unverified'i de icerir; o dilim "kullanimda" diye ADLANDIRILAMAZ.
  assert.ok(
    !/\{ value: s\.ips\.total - s\.ips\.unused, color: SEV\.ok\.color, title: 'kullanımda',? \}/.test(PAGE),
    "dogrulanamayan IP ozet kartinda 'kullanimda' sayiliyor",
  );
  assert.ok(PAGE.includes("title: 'boşta değil (doğrulanamayan dahil)'"), 'ozet karti dilim etiketi kayip');
});

// ── D1-U02 log kaniti ─────────────────────────────────────────────────────────────────
test("D1-U02 log kaniti: okunamayan 'OKUNAMADI'; '7g -1' ve olculmeyen icin '7g 0' basilamaz", () => {
  const lk = fonksiyon(P, 'logKanitMetni');
  const a = lk({ read: false, req7d: -1, sampled: false });
  assert.match(a, /OKUNAMADI/);
  assert.ok(!a.includes('7g -1'), "'7g -1' basildi");
  // Sunucu read=true dese bile -1 olcum DEGILDIR (eski Portal yaniti ya da ara surum).
  const b = lk({ read: true, req7d: -1, sampled: false });
  assert.match(b, /OKUNAMADI/, 'read=true + req7d=-1 olcum sayildi');
  assert.ok(!b.includes('7g -1'));
  const c = lk({ read: true, req7d: null, sampled: false });
  assert.ok(!/7g 0\b/.test(c), "olculmeyen (null) '7g 0' basildi");
  assert.match(c, /OKUNAMADI/);
  assert.match(lk({ read: true, req7d: 0, sampled: false }), /7g 0\b/, 'olculmus 0 gosterilmeli');
  assert.match(lk({ read: true, req7d: 12, sampled: true }), /7g 12 \(alt sınır/);
  assert.ok(PAGE.includes('logKanitMetni(l)'), 'log listesi yardimciyi kullanmiyor');
  assert.ok(!PAGE.includes('7g ${l.req7d ?? 0}'), "'7g ${l.req7d ?? 0}' geri gelmis");
});

// ── D1-U03 / U09 / EK-3 / EK-5 kod etiketleri ─────────────────────────────────────────
test('D1-U03/U09 yeni bulgu kodlarinin etiketleri var ve listelerde kullaniliyor', () => {
  const KOD = P.KOD_ETIKET;
  assert.ok(KOD && typeof KOD === 'object', 'KOD_ETIKET yok');
  const yeni = [
    'RUNNING_UNMEASURED',
    'TRAFFIC_UNVERIFIED',
    'INIT_UNREADABLE',
    'LOAD_EXCLUDED',
    'JVM_DATA_MISSING',
    'JVM_INVENTORY_UNMEASURED',
    'SCAN_PARTIAL',
    'LOAD_DUPLICATE',
    // Baglayici ek: EK-3 ve EK-5
    'TRAFFIC_UNATTRIBUTED',
    'WEB_PRESENCE_UNKNOWN',
    // Dalga 2: T2-C2 tanimsiz surec, C3 hazirlik sebebi
    'JVM_UNDEFINED_PROCESS',
    'SCHEMA_UNKNOWN',
  ];
  for (const k of yeni) {
    assert.equal(typeof KOD[k], 'string', `${k} etiketi yok`);
    assert.ok(KOD[k].trim().length > 3, `${k} etiketi bos`);
  }
  const ke = fonksiyon(P, 'kodEtiketi');
  assert.ok(ke('RUNNING_UNMEASURED').includes('RUNNING_UNMEASURED'), 'kod adi kayboldu');
  assert.ok(ke('RUNNING_UNMEASURED').includes(KOD.RUNNING_UNMEASURED));
  assert.equal(ke('BILINMEYEN_KOD_X'), 'BILINMEYEN_KOD_X', 'etiketsiz kod oldugu gibi kalmali');
  // Sunucu penceresi bulgu listesi + Bulgular sekmesi tablosu
  assert.ok(say(PAGE, 'kodEtiketi(f.code)') >= 2, 'kod etiketi listelerde kullanilmiyor');
});

// ── D1-U04 / U09 tarama isi sonucu (loader) ───────────────────────────────────────────
test('D1-U04/U09 tarama sonucu: yazilamayan sunucu sayisi + sebep, NOT_ATTEMPTED sayisi', () => {
  const yo = fonksiyon(P, 'yukleyiciOzeti');
  const r = yo({
    loader: {
      rc: 4,
      hosts_total: 10,
      hosts_written: 7,
      hosts_excluded: 2,
      hosts_not_attempted: 1,
      excluded: [
        { host: 'GBAPPT01', issue: 'FORMAT' },
        { host: 'GBAPPT02', issue: 'CTRL_CHAR' },
      ],
    },
  });
  const t = r.satirlar.join(' | ');
  assert.equal(r.sorun, true);
  assert.match(t, /2 sunucu yazılamadı/);
  assert.match(t, /FORMAT/);
  assert.match(t, /GBAPPT02/);
  assert.match(t, /1 sunucu denenmedi/);
  assert.match(t, /NOT_ATTEMPTED/);
  assert.match(t, /7\/10/);
  // JSON dizgisi olarak gelen sonuc da okunur
  const s = yo({ loader: JSON.stringify({ hosts_total: 3, hosts_written: 3, hosts_excluded: 0, hosts_not_attempted: 0 }) });
  assert.equal(s.sorun, false);
  assert.ok(!s.satirlar.join(' ').includes('yazılamadı'));
  // Sonuc yoksa "hepsi yazildi" DENMEZ (kural 6)
  for (const bos of [null, undefined, {}, { loader: {} }, { loader: 'bozuk{' }]) {
    const x = yo(bos);
    assert.equal(x.sorun, true, 'yukleyici sonucu yokken sorun yok denildi');
    assert.match(x.satirlar.join(' '), /bilinmiyor/);
  }
  assert.ok(PAGE.includes('yukleyiciOzeti(result)'), 'tarama isi bitince sonuc okunmuyor');
});

// ── D1-U05 SH12/BA3 dizgileri ve RetirementTab ─────────────────────────────────────────
test("D1-U05 SH12 ve BA3 dizgileri korunur; RetirementTab olculemeyende 'bilinmiyor'", () => {
  assert.ok(!/Bulk/.test(PAGE_RAW), "ekranda 'Bulk' bileseni/tipi var (BA3, kural 3)");
  assert.ok(!PAGE_RAW.includes('Toplu: auto-start'));
  for (const d of [
    "onGoFindings({ area: 'init' })",
    "onGoFindings({ area: 'web', code: 'SYNTAX_FAIL', product: p })",
    'Ortam kırılımı',
    'onGoFindings({ envGroup: g })',
  ])
    assert.ok(PAGE.includes(d), `SH12 dizgisi kayip: ${d}`);
  const hd = fonksiyon(R, 'hubDurumu');
  const u = hd({ running: false, autoStart: 'true', scanDate: '2026-10-01', runningKnown: false });
  assert.match(u.metin, /bilinmiyor/);
  assert.ok(!/kapalı/.test(u.metin), "olculemeyen JVM 'kapali' gosteriliyor");
  assert.equal(hd({ running: false, autoStart: 'true', scanDate: null, runningKnown: true }).metin, 'kapalı');
  assert.equal(hd({ running: false, autoStart: 'true', scanDate: null }).metin, 'kapalı', 'alan yoksa eski davranis');
  assert.equal(hd({ running: true, autoStart: 'true', scanDate: null, runningKnown: true }).metin, 'çalışıyor');
  // Hucre hubHucresi uzerinden hubDurumu'nu kullanir (davranis: olculemeyen -> 'bilinmiyor').
  const hh = fonksiyon(R, 'hubHucresi');
  assert.match(hh({ running: false, autoStart: 'true', scanDate: null, runningKnown: false }, false).metin, /^bilinmiyor · auto-start true$/);
  assert.equal(hh({ running: true, autoStart: 'false', scanDate: null }, false).metin, 'çalışıyor · auto-start false');
  assert.ok(RT.includes('<HubHucresi hub={t.hub} okunamadi={hubYok} />'), 'kesif tablosu hucre yardimcisini kullanmiyor');
  assert.ok(govde(RT_RAW, 'HubHucresi').includes('hubHucresi(hub, okunamadi)'), 'HubHucresi yardimciyi kullanmiyor');
  assert.ok(!/t\.hub\.running \? 'çalışıyor' : 'kapalı'/.test(RT), 'RetirementTab eski ikili metne donmus');
});

// -- D1 (kural 6) RetirementTab: Server Hub OKUNAMADI != tarama yok --------------------
// Dogrulayici bulgusu (KESIN): discover.cjs Server_Hub_Jvms sorgusu duserse
// summary.hubUnavailable=true dondururdu ama ekran okumuyordu; tum hedefler 'tarama yok' (yani
// "taranmadi") gorunuyordu. Bu test GERCEK discover() ciktisini ekranin yardimcilarina verir:
// alan adi iki tarafta ayrisirsa da kirmiziya doner.
const { discover } = require('../../retirement/discover.cjs');
const KESIF_ENVANTER = [
  { app: 'CRM', host: 'GBCRAP01', env: 'Production', domain: '', jboss_version: '7.4', app_path: '/a', status: 'running' },
  { app: 'CRM-T', host: 'GBCRAAT02', env: 'Test', domain: '', jboss_version: '8.0', app_path: '/b', status: 'running' },
];
const kesifDb = (jvmDussun) => ({
  sql: { NVarChar: () => 'nvarchar' },
  query: async (s) => {
    const q = String(s);
    if (/sys\.columns/.test(q)) return { recordset: ['host', 'jvm', 'running', 'auto_start', 'scan_date', 'running_src'].map((name) => ({ name })) };
    if (/dbo\.MWAppsInventory/.test(q)) return { recordset: KESIF_ENVANTER };
    if (/BMW_Certificates_Inventory/.test(q)) return { recordset: [] };
    if (/dbo\.Server_Hub_Jvms/.test(q)) {
      if (jvmDussun) throw new Error('Timeout: Request failed to complete in 15000ms');
      return { recordset: [] };
    }
    throw new Error(`sahte kesif: beklenmeyen SQL ${q.slice(0, 60)}`);
  },
});
async function kesif(jvmDussun) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    // /api/retirement/discover yaniti: { ok: true, ...discover(base) }
    return { ok: true, ...(await discover('CRM', kesifDb(jvmDussun))) };
  } finally {
    console.warn = warn;
  }
}

test("D1 RetirementTab: Server Hub okunamadiysa her hedef 'Server Hub okunamadi' (tarama yok DEGIL)", async () => {
  const ho = fonksiyon(R, 'hubOkunamadi');
  const hh = fonksiyon(R, 'hubHucresi');
  assert.equal(ho({ summary: { hubUnavailable: true } }), true);
  assert.equal(ho({ summary: { hubUnavailable: false } }), false);
  assert.equal(ho({ summary: {} }), false, 'alan yoksa (eski yanit) okundu sayilir');
  assert.equal(ho(null), false);
  const ok = hh(null, true);
  assert.equal(ok.metin, 'Server Hub okunamadı');
  assert.ok(!/tarama yok/.test(ok.metin), "okunamayan hub 'tarama yok' gosterildi");
  assert.match(ok.aciklama, /ölçülemedi/);
  assert.equal(hh(null, false).metin, 'tarama yok', 'okunduysa ve satir yoksa tarama yok');
  assert.notEqual(ok.renk, hh(null, false).renk, 'okunamadi ile tarama yok ayni renkte');
  // okunamadi her zaman kazanir: hub satiri olsa bile (ornegin eski onbellek) olcum gosterilmez
  assert.equal(hh({ running: true, autoStart: 'true', scanDate: null }, true).metin, 'Server Hub okunamadı');

  // GERCEK discover(): Jvms sorgusu duserse -> her hedefte 'Server Hub okunamadi'
  const dus = await kesif(true);
  assert.equal(dus.targets.length, 2);
  assert.equal(ho(dus), true, "discover hubUnavailable'i ekranin okudugu yerde tasimiyor");
  for (const t of dus.targets) {
    assert.equal(t.hub, null);
    assert.equal(hh(t.hub, ho(dus)).metin, 'Server Hub okunamadı', `${t.host}: 'tarama yok' gosterildi`);
  }
  // Jvms okundu ama satir yok -> gercekten 'tarama yok'
  const bos = await kesif(false);
  assert.equal(ho(bos), false);
  for (const t of bos.targets) assert.equal(hh(t.hub, ho(bos)).metin, 'tarama yok');

  // DAVRANIS (T2-D1 kardesi): hucre BILESEN olarak cagrilir - ekrana cikan metin/title, gizli degil.
  const HH = fonksiyon(R, 'HubHucresi');
  for (const t of dus.targets) {
    const el = HH({ hub: t.hub, okunamadi: ho(dus) });
    assert.ok(el, `${t.host}: hub hucresi null`);
    assert.equal(metinleri(el), 'Server Hub okunamadı', `${t.host}: hucre ekranda okunamadi demiyor`);
    assert.equal(el.props.title, ok.aciklama, 'hucrenin title aciklamasi yardimcinin degil');
    assert.deepEqual(gorunurlukSorunlari(el), [], 'hub hucresi gizli');
  }
  assert.equal(metinleri(HH({ hub: null, okunamadi: ho(bos) })), 'tarama yok');
  // YERLESIM (AST): kesif tablosunda her hedef satirinda TEK kez, gizlenmeden, bayrak hubYok
  tekYerlesim(RT_RAW, RT_PATH, 'CreateModal', 'HubHucresi', {
    kosullar: ['disc &&', 'disc.targets.length === 0 :', '=>'],
    ozellik: { hub: 't.hub', okunamadi: 'hubYok' },
  });

  // BAGLANTI: hucre bayragi kesif yanitindan alir
  const cm = govde(RT_RAW, 'CreateModal');
  assert.ok(cm.includes('const hubYok = hubOkunamadi(disc);'), 'kesif tablosu hubUnavailable okumuyor');
  assert.ok(cm.includes('<HubHucresi hub={t.hub} okunamadi={hubYok} />'), 'hucre bayragi kullanmiyor');
  assert.ok(!cm.includes('tarama yok'), "kesif tablosunda bayraktan bagimsiz 'tarama yok' dali geri gelmis");
});

test('D1 RetirementTab STOP onayi: Server Hub okunamadiysa uyari EKRANA cikar; dugme kapanmaz', async () => {
  const sd = fonksiyon(R, 'stopHubDurumu');
  const su = fonksiyon(R, 'stopHubUyarisi');
  assert.equal(sd(await kesif(true)), 'okunamadi', 'GERCEK discover hubUnavailable -> okunamadi degil');
  assert.equal(sd(await kesif(false)), 'okundu');
  assert.equal(sd(null), 'okunamadi', 'yanit yok -> okunamadi');
  assert.equal(sd({ ok: false, message: 'x' }), 'okunamadi', 'kesif hatasi -> okunamadi');
  const u = su('okunamadi');
  assert.match(u, /Server Hub okunamadı/);
  assert.match(u, /ölçülemedi/);
  assert.match(u, /SAYILMADI/);
  assert.equal(su('okundu'), null, 'okunduysa uyari yok');
  const d = su('denetleniyor');
  assert.ok(d && !/okunamadı/.test(d), "denetlenirken 'okunamadi' denmez");

  // DAVRANIS (T2-D1): uyari kutusu bilesen olarak CAGRILIR - donen oge ekrana cikan seydir.
  const SU = fonksiyon(R, 'StopHubUyari');
  const k = SU({ durum: 'okunamadi' });
  assert.ok(k, 'okunamadi iken uyari kutusu null dondu - ekranda yok');
  assert.equal(k.type, 'div');
  assert.equal(k.props.role, 'alert', 'okunamadi uyarisi alert degil');
  assert.equal(metinleri(k), u, 'kutunun metni stopHubUyarisi degil');
  assert.deepEqual(gorunurlukSorunlari(k), [], 'uyari kutusu gizli (hidden / display:none / gizleyen sinif)');
  assert.equal(SU({ durum: 'okundu' }), null, 'okunduysa kutu basildi');
  const dn = SU({ durum: 'denetleniyor' });
  assert.ok(dn && metinleri(dn) === d && dn.props.role !== 'alert', 'denetlenirken kutu yanlis');
  assert.deepEqual(gorunurlukSorunlari(dn), []);
  // YERLESIM (AST): onay penceresinde ({ask && ...}) TEK kez, kosulsuz ve gizlenmeden.
  tekYerlesim(RT_RAW, RT_PATH, 'RecordModal', 'StopHubUyari', { kosullar: ['ask &&'], ozellik: { durum: 'hubDurum' } });

  // BAGLANTI (RecordModal): STOP dugmesi kontrollu acar; yanit/hata durumu yazar
  const rm = govde(RT_RAW, 'RecordModal');
  assert.ok(rm.includes('onClick={() => stopSor(t)}'), 'STOP dugmesi Server Hub denetimini atliyor');
  assert.ok(!rm.includes('onClick={() => setAsk({ t })}'), 'STOP dugmesi onayi denetimsiz aciyor');
  const i = rm.indexOf('const stopSor = (t: RtTarget) => {');
  assert.ok(i >= 0, 'stopSor yok');
  // prettier zinciri satirlara boler ('retirementApi\n.discover'); normalize sonrasi ' .' -> '.'
  const sor = rm.slice(i, rm.indexOf('};', i)).replace(/ \.(?=\w)/g, '.');
  assert.ok(sor.includes('retirementApi.discover(rec.app)'), 'onayda kesif okunmuyor');
  assert.ok(sor.includes('setHubDurum(stopHubDurumu(d))'), 'kesif yaniti durum yardimcisindan gecmiyor');
  assert.ok(sor.includes(".catch(() => { if (hubIstek.current === no) setHubDurum('okunamadi'); })"), "kesif dusunce 'okunamadi' yazilmiyor");
  // Kural 7 deseni: uyari yalniz bilgi; onay dugmesi hub durumuna bagli KAPANMAZ
  assert.ok(rm.includes("<button onClick={() => stop(ask.t, true)} className={SM_BTN}"), 'onay dugmesi degismis');
  assert.ok(!/disabled=\{[^}]*hubDurum/.test(rm), 'onay dugmesi hub durumuna gore kapatiliyor');
});

test("T2-D2 retirementApi: RtDiscovery.summary.hubUnavailable tipte; RetirementTab'da yerel RtDiscoveryV3 yok", () => {
  const ts = tsYukle();
  const raw = fs.readFileSync(RT_API_PATH, 'utf8');
  const sf = kaynakAgaci(raw, RT_API_PATH);
  const rd = sf.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'RtDiscovery');
  assert.ok(rd, 'retirementApi.ts RtDiscovery arayuzu yok');
  const sm = rd.members.find((m) => m.name && m.name.getText(sf) === 'summary');
  assert.ok(sm && sm.type && ts.isTypeLiteralNode(sm.type), 'RtDiscovery.summary tip literali degil');
  const hu = sm.type.members.find((m) => m.name && m.name.getText(sf) === 'hubUnavailable');
  assert.ok(hu, 'RtDiscovery.summary.hubUnavailable tipte yok (ekran yerel tipe donmus olur)');
  assert.ok(hu.questionToken, 'hubUnavailable istege bagli degil (eski sunucu yaniti alani tasimaz)');
  assert.equal(hu.type.getText(sf), 'boolean');
  const rt = kaynakAgaci(RT_RAW, RT_PATH);
  const yerel = rt.statements.filter((s) => (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && /^RtDiscovery/.test(s.name.text));
  assert.deepEqual(yerel.map((s) => s.name.text), [], 'RetirementTab yerel RtDiscovery* tipi tanimliyor');
});

// ── D1-U06 JVM Durum hucresi ──────────────────────────────────────────────────────────
test("D1-U06 JVM tablosu: runningKnown=false satirinda 'kapali' YOK, 'bilinmiyor (surec gorunmuyor)' VAR", () => {
  const jb = fonksiyon(P, 'jvmCalismaBilinir');
  assert.equal(jb({ running: false, runningKnown: false, runningSrc: 'UNMEASURED' }), false);
  assert.equal(jb({ running: false, runningSrc: 'UNMEASURED' }), false, 'runningSrc tek basina yetmeli');
  assert.equal(jb({ running: false, runningKnown: true, runningSrc: 'PS_ABSENT' }), true);
  assert.equal(jb({ running: true, runningKnown: true, runningSrc: 'PS' }), true, 'BLIND+PS bilinen');
  assert.equal(jb({ running: false }), true, 'eski yanit (alan yok) bilinen sayilir (C: NULL bilinen)');
  const jd = fonksiyon(P, 'jvmDurumu');
  const u = jd({ running: false, runningKnown: false, runningSrc: 'UNMEASURED' });
  assert.equal(u.metin, 'bilinmiyor (süreç görünmüyor)');
  assert.ok(!u.metin.includes('kapalı'));
  assert.equal(jd({ running: false, runningKnown: true, runningSrc: 'PS_ABSENT' }).metin, 'kapalı');
  assert.equal(jd({ running: true, runningKnown: true, runningSrc: 'PS' }).metin, 'çalışıyor');
  assert.notEqual(u.renk, jd({ running: false, runningKnown: true }).renk, 'bilinmiyor kapali ile ayni renkte');
  // T2-D2 (C3): sema okunamadiysa sebep hidepid DEGIL sema
  const s = jd({ running: false, runningKnown: false, runningSrc: null }, true);
  assert.equal(s.metin, 'bilinmiyor (şema okunamadı)');
  assert.ok(!/süreç görünmüyor/.test(s.metin) && !/hidepid/.test(s.aciklama), 'sema bilinmiyorken hidepid sebebi gosterildi');
  assert.match(s.aciklama, /sys\.columns/);
  assert.equal(jd({ running: false, runningKnown: true, runningSrc: 'PS_ABSENT' }, true).metin, 'kapalı', 'sema bayragi olculmus satiri degistirdi');
  // BAGLANTI (AST): HostModal'daki HER jvmDurumu cagrisi ayrintinin schemaUnknown'unu verir
  const c = cagrilar(PAGE_RAW, PAGE_PATH, 'HostModal', 'jvmDurumu');
  assert.ok(c.length >= 1, 'Durum hucresi jvmDurumu kullanmiyor');
  for (const a of c) assert.deepEqual(a, ['j', 'd.schemaUnknown === true'], `jvmDurumu(${a.join(', ')}) sema bayragini vermiyor`);
  assert.ok(!/j\.running \? 'çalışıyor' : 'kapalı'/.test(PAGE), 'Durum hucresi eski ikili metne donmus');
});

// ── D1-U07 tek-JVM auto-start onayi ───────────────────────────────────────────────────
test("D1-U07 auto-start onay metni olculemeyende 'calisma durumu olculemedi' der; dugme acik kalir (kural 7)", () => {
  const om = fonksiyon(P, 'autoStartOnayMetni');
  const j = { gen: 7, name: 'crm', autoStart: 'true', running: false, runningKnown: false, runningSrc: 'UNMEASURED' };
  const t = om('GBAPPT01', j, false);
  assert.match(t, /çalışma durumu ölçülemedi/);
  assert.match(t, /süreç görünmüyor/);
  assert.match(t, /Yalnız bu JVM etkilenir/, 'kapsam cumlesi kayip (SB5)');
  assert.match(t, /GBAPPT01/);
  assert.match(t, /KAPATILACAK/);
  const k = om('GBAPPT01', { ...j, runningKnown: true, runningSrc: 'PS_ABSENT' }, true);
  assert.ok(!/ölçülemedi/.test(k), 'olculmus JVM icin gereksiz uyari');
  assert.match(k, /AÇILACAK/);
  // T2-D2 (C3): sema bilinmiyorken sebep sema
  const s = om('GBAPPT01', { ...j, runningSrc: null }, false, true);
  assert.match(s, /çalışma durumu ölçülemedi \(Server Hub şeması okunamadı\)/);
  assert.ok(!/süreç görünmüyor/.test(s), 'sema bilinmiyorken hidepid sebebi');
  // BAGLANTI (AST): onay metni yardimcidan ve sema bayragiyla
  assert.deepEqual(
    cagrilar(PAGE_RAW, PAGE_PATH, 'HostModal', 'window.confirm'),
    [['autoStartOnayMetni(host, j, ac, d?.schemaUnknown === true)']],
    'onay metni yardimcidan (sema bayragiyla) gelmiyor',
  );
  // Kural 7: olculemeyen satirda dugme admine KAPANMAZ - disabled yalniz is suruyorken.
  assert.ok(
    PAGE.includes('onClick={() => jvmAutoStart(j)} disabled={asBusy === `${j.gen}|${j.name}`}'),
    'auto-start dugmesinin disabled kosulu degismis (olculemeyende admine kapanmamali)',
  );
});

// ── D1-U08 sunucu listesi ─────────────────────────────────────────────────────────────
test("D1-U08 sunucu listesi: 'calisan/toplam' yaninda jvmsUnmeasured>0 iken '? N'", () => {
  const sm = fonksiyon(P, 'jvmSayimMetni');
  const a = sm({ jvms: 4, jvmsRunning: 1, jvmsUnmeasured: 3 });
  assert.ok(a.startsWith('1/4'), a);
  assert.match(a, /\? 3/);
  const b = sm({ jvms: 4, jvmsRunning: 4, jvmsUnmeasured: 0 });
  assert.equal(b, '4/4');
  assert.equal(sm({ jvms: 2, jvmsRunning: 1 }), '1/2', 'eski yanit (alan yok)');
  assert.equal(sm({ jvms: 0, jvmsRunning: 0, jvmsUnmeasured: 0 }), '—');
  assert.ok(PAGE.includes('jvmSayimMetni(h)'), 'liste hucresi yardimciyi kullanmiyor');
});

// ── D1-U09 ozet kartlari ──────────────────────────────────────────────────────────────
test('D1-U09 ozet kartlari olculemeyen sayaclarini AYRI gosterir; bulgu metni oldugu gibi', () => {
  for (const d of [
    's.jvm.unmeasured',
    's.jvm.retireBlockedByWebTier',
    'w.notRunningUnmeasured',
    'e.jvmUnmeasured',
  ])
    assert.ok(PAGE.includes(d), `ozet alani gosterilmiyor: ${d}`);
  // 'bayat kanit: <host> <tarih>' sunucunun yazdigi metindir; ekran onu degistirmeden basar.
  assert.ok(say(PAGE, '{f.text}') >= 2, 'bulgu metni oldugu gibi basilmiyor');
  assert.ok(!/f\.text\.replace\(/.test(PAGE), 'bulgu metni ekranda degistiriliyor');
});

// ── EK-2 bayat filo bandi ─────────────────────────────────────────────────────────────
test("EK-2 staleFleet: kirmizi bant 'Son basarili yukleme N gun once - eylemler kapali'", () => {
  const bf = fonksiyon(P, 'bayatFiloMetni');
  assert.equal(bf({ lastLoad: '2026-09-28', ageDays: 3 }), 'Son başarılı yükleme 3 gün önce — eylemler kapalı');
  assert.equal(bf(null), null);
  assert.equal(bf(undefined), null);
  const x = bf({ lastLoad: null, ageDays: null });
  assert.match(x, /eylemler kapalı/, 'yas bilinmiyorken bant kayboldu');
  assert.match(x, /bilinmiyor/);
  const bant = govde(PAGE_RAW, 'BayatFiloBandi');
  assert.ok(bant.includes('bayatFiloMetni(sf)'), 'bant metni yardimcidan gelmiyor');
});

// ── T2-D1 bantlar EKRANA cikiyor mu (bilesen cagrisi + AST yerlesim) ──────────────────
// Dogrulayici bulgusu (KESIN): dort mantik mutanti (GeriAlmaBandi / BayatFiloBandi 'if (!metin)'
// ters, '{false && <GeriAlmaBandi .../>}', STOP uyari div'ine 'hidden') eski bekcide 17/17
// yesil kaliyordu: bilesenler hic cagrilmiyor, yerlesim capasiz regex'le araniyordu.
test('T2-D1 GeriAlmaBandi ve BayatFiloBandi: dolu veride oge doner (null degil), bossa null; gizli degil', () => {
  const GA = fonksiyon(P, 'GeriAlmaBandi');
  const gm = fonksiyon(P, 'geriAlmaMetni');
  const rb = { allowed: false, v3Hosts: 3, message: 'X mesaji.' };
  const el = GA({ rb });
  assert.ok(el, 'allowed=false iken geri alma bandi null dondu - ekranda yok');
  assert.equal(el.type, 'div');
  assert.equal(el.props.title, gm(rb), 'bandin title metni yardimcinin metni degil');
  assert.equal(metinleri(el), gm(rb), 'bandin gorunen metni yardimcinin metni degil');
  assert.ok(/(^|\s)truncate(\s|$)/.test(el.props.className), 'bant tek satir degil (truncate yok)');
  assert.deepEqual(gorunurlukSorunlari(el), [], 'geri alma bandi gizli');
  for (const bos of [{ allowed: true, v3Hosts: 0, message: '' }, null, undefined])
    assert.equal(GA({ rb: bos }), null, `geri alma serbestken bant basildi: ${JSON.stringify(bos)}`);

  const BF = fonksiyon(P, 'BayatFiloBandi');
  const bf = fonksiyon(P, 'bayatFiloMetni');
  const sf = { lastLoad: null, ageDays: 3 };
  const b = BF({ sf });
  assert.ok(b, 'bayat filoda bant null dondu - ekranda yok');
  assert.equal(b.type, 'div');
  assert.equal(b.props.role, 'alert');
  assert.equal(metinleri(b), bf(sf), 'bandin gorunen metni yardimcinin metni degil');
  assert.equal(b.props.style.borderColor, 'var(--status-danger)', 'bant kirmizi degil');
  assert.deepEqual(gorunurlukSorunlari(b), [], 'bayat filo bandi gizli');
  for (const bos of [null, undefined]) assert.equal(BF({ sf: bos }), null, 'bayat degilken bant basildi');
});

test('T2-D1 bant yerlesimi (AST): Sunucular ve Bulgular sekmesinde TEK, kosulsuz, gizlenmeden, ana return icinde', () => {
  tekYerlesim(PAGE_RAW, PAGE_PATH, 'HostsTab', 'BayatFiloBandi', { ozellik: { sf: 'data.staleFleet' } });
  tekYerlesim(PAGE_RAW, PAGE_PATH, 'HostsTab', 'GeriAlmaBandi', { ozellik: { rb: 'data.rollback' } });
  tekYerlesim(PAGE_RAW, PAGE_PATH, 'FindingsTab', 'BayatFiloBandi', { ozellik: { sf: 'data?.staleFleet' } });
  // kendi kendini sinama: yerlesim denetimi kosulu, gizli atayi ve olu donusu GERCEKTEN goruyor
  const dene = (kaynak) => yerlesim(kaynak, 'x.tsx', 'F', 'B')[0];
  assert.deepEqual(dene('function F() {\n  return <div>{false && (\n    <B a={x.y} />\n  )}</div>;\n}\n').kosullar, ['false &&']);
  assert.deepEqual(dene("function F() {\n  return <div className='p hidden'><B a={x.y} /></div>;\n}\n").gizli, ["className='p hidden'"]);
  assert.deepEqual(dene("function F() {\n  return <div style={{ display: 'none' }}><B /></div>;\n}\n").gizli.length, 1);
  assert.equal(dene('function F() {\n  return null;\n  return <div><B /></div>;\n}\n').anaDonus, false);
  assert.deepEqual(dene('function F() {\n  return <div>{c ? <B /> : null}</div>;\n}\n').kosullar, ['c ?']);
  assert.deepEqual(dene('function F() {\n  return <details><B /></details>;\n}\n').gizli, ['<details> (kapali)']);
  assert.deepEqual(dene('function F() {\n  return <div><B /></div>;\n}\n'), { ozellik: {}, kosullar: [], gizli: [], anaDonus: true });
});

// -- Sunucu yaniti -> ekran (D2 EK-1 geri alma, D3 EK-2 Bulgular bandi, C3 sema, EK-3) --
// Dogrulayici bulgusu (KESIN): metin bekcisi '<BayatFiloBandi sf={data?.staleFleet} />'
// yazildigini gorur ama /findings'in alani GERCEKTEN verip vermedigini goremez; bant olu koddu.
// Bu yardimci GERCEK index.cjs router'ini sahte mssql ile ayaga kaldirir. Testler yaniti,
// ekranin OKUDUGU anahtarla (AST'den cikarilir) bilesene verir: alan sunucuda yoksa, adi iki
// tarafta ayrisirsa ya da bant kaldirilirsa KIRMIZI.
const Module = require('node:module');
const SH_SEMA = {
  Server_Hub_Hosts: ['host', 'scan_date', 'products', 'wall_s', 'cpu_s', 'note', 'scan_ver', 'rec_counts', 'scan_errors', 'proc_visibility', 'sock_visibility', 'loaded_at'],
  Server_Hub_Init: ['host', 'scan_date', 'root', 'file', 'status', 'sha512'],
  Server_Hub_Jboss: ['host', 'scan_date', 'gen', 'host_name', 'host_state', 'cli', 'note'],
  Server_Hub_Jvms: ['host', 'scan_date', 'gen', 'jvm', 'grp', 'running', 'auto_start', 'server_state', 'ports', 'running_src', 'cfg_src'],
  Server_Hub_Web: ['host', 'scan_date', 'product', 'running', 'syntax', 'detail'],
  Server_Hub_Vhosts: ['host', 'scan_date', 'product', 'listen', 'server_name', 'aliases', 'access_log', 'proxy_targets', 'req_24h', 'req_7d', 'hc_24h', 'shared', 'sampled', 'conf_file'],
  Server_Hub_Ips: ['host', 'scan_date', 'ip', 'iface', 'used_by', 'is_primary'],
  Server_Hub_Sshd: ['host', 'scan_date', 'max_sessions', 'max_startups', 'active_sessions'],
};
/** index.cjs'in BEKLEDIGI tam kolon listesi (v3 semasi); test kendi listesini uydurmaz. */
function tamSema() {
  const yol = require.resolve('../index.cjs');
  const once = require.cache[yol];
  const { SH_KOLONLAR } = require('../index.cjs');
  if (!once) delete require.cache[yol];
  return Object.fromEntries(Object.entries(SH_KOLONLAR).map(([t, c]) => [t.replace(/^dbo\./, ''), [...c]]));
}
const gunOnce = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const APP = 'GBCJAP01';
const WEB = 'GBCJWP01';
const SENARYO = {
  // EK-1/EK-2: son yukleme 5 gun once, v3 tarayici (scan_ver dolu)
  bayat: () => {
    const gun = gunOnce(5);
    return {
      sema: SH_SEMA,
      hostlar: [],
      satir: {
        Server_Hub_Hosts: [{ host: APP, scan_date: gun, products: 'JBOSS7', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.1', proc_visibility: 'FULL', sock_visibility: 'PID', loaded_at: `${gun}T06:00:00Z` }],
        Server_Hub_Jvms: [{ host: APP, scan_date: gun, gen: 7, jvm: 'crm', grp: 'g', running: 0, auto_start: 'true', server_state: 'stopped', ports: '', running_src: 'PS_ABSENT', cfg_src: 'CLI_WILDCARD' }],
      },
    };
  },
  // C3: sys.columns sorgusu DUSER (sema = null). Bugunun taramasi; durmus JVM ve calismayan web.
  sema: () => {
    const gun = gunOnce(0);
    return {
      sema: null,
      hostlar: [APP, WEB],
      hazirlik: `${APP},${WEB}`,
      satir: {
        Server_Hub_Hosts: [
          { host: APP, scan_date: gun, products: 'JBOSS7', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.1' },
          { host: WEB, scan_date: gun, products: 'IHS', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.1' },
        ],
        Server_Hub_Jvms: [{ host: APP, scan_date: gun, gen: 7, jvm: 'crm', grp: 'g', running: 0, auto_start: 'true', server_state: 'stopped', ports: '', running_src: 'UNMEASURED' }],
        Server_Hub_Web: [{ host: WEB, scan_date: gun, product: 'IHS', running: 0, syntax: 'OK', detail: '', running_src: 'UNMEASURED' }],
      },
    };
  },
  // EK-3 C1/C4: durmus crm (NRT esli vhost) + ayni katmanda 5000 istekli api.bmw.de; hedefi
  // cozulemeyen VIP adi ve yukleyicide KESILMIS liste ('~TRUNC').
  ek3: () => {
    const gun = gunOnce(0);
    const v = (server_name, ek) => ({
      host: WEB, scan_date: gun, product: 'IHS', listen: '10.0.0.1:443', server_name, aliases: '', access_log: `/l/${server_name}`,
      proxy_targets: '', req_24h: 0, req_7d: 0, hc_24h: 3, shared: 0, sampled: 0, conf_file: `/c/${server_name}.conf`,
      traffic_state: 'NO_RECENT_TRAFFIC', traffic_reason: 'OK', cover_from_epoch: 1, last_req_epoch: null, last_line_epoch: null, log_read_as: 'www', ...ek,
    });
    const h = (host, products) => ({
      host, scan_date: gun, products, wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.1', rec_counts: '', scan_errors: '',
      proc_visibility: 'FULL', sock_visibility: 'PID', loaded_at: `${gun}T06:00:00Z`,
    });
    return {
      sema: tamSema(),
      hostlar: [APP, WEB],
      satir: {
        Server_Hub_Hosts: [h(APP, 'JBOSS7'), h(WEB, 'IHS')],
        Server_Hub_Jvms: [{ host: APP, scan_date: gun, gen: 7, jvm: 'crm', grp: 'g', running: 0, auto_start: 'false', server_state: 'stopped', ports: '', running_src: 'PS_ABSENT', cfg_src: 'CLI_WILDCARD' }],
        Server_Hub_Web: [{ host: WEB, scan_date: gun, product: 'IHS', running: 1, syntax: 'OK', detail: '2 vhost', check_class: 'OK', syntax_verification: 'VERIFIED', run_as: 'www', check_rc: 0, vhost_trust: 'FULL', running_src: 'PS' }],
        Server_Hub_Vhosts: [
          v('crm.bmw.de'),
          v('api.bmw.de', { proxy_targets: 'crm-vip.bmw.local:8180,~TRUNC', req_24h: 700, req_7d: 5000, traffic_state: 'ACTIVE' }),
        ],
        Server_Hub_Ips: [{ host: APP, scan_date: gun, ip: '10.1.2.3', iface: 'eth0', used_by: 'other', is_primary: 1 }],
      },
    };
  },
};
const _yanitlar = {};
function sunucuYanitlari(ad = 'bayat') {
  if (!_yanitlar[ad]) _yanitlar[ad] = sunucuyuKostur(SENARYO[ad]());
  return _yanitlar[ad];
}
async function sunucuyuKostur({ sema, satir, hostlar = [], hazirlik = null }) {
  const sorgu = async (sqlText) => {
    const s = String(sqlText);
    if (/OBJECT_ID\('dbo\.Server_Hub_Hosts'\) AS oid/.test(s)) return { recordset: [{ oid: 1 }] };
    if (/FROM sys\.columns c WHERE c\.object_id IN/.test(s)) {
      if (!sema) throw new Error('Timeout: sys.columns okunamadi (sahte)');
      const out = [];
      for (const m of s.matchAll(/OBJECT_ID\('dbo\.(\w+)'\)/g)) for (const c of sema[m[1]] || []) out.push({ tbl: m[1], name: c });
      return { recordset: out };
    }
    const m = /FROM dbo\.(Server_Hub_\w+) t\b/.exec(s);
    if (m) {
      const sec = [...s.matchAll(/\bt\.\[?(\w+)\]?/g)].map((x) => x[1]);
      return { recordset: (satir[m[1]] || []).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => sec.includes(k)))) };
    }
    return { recordset: [] };
  };
  const stublar = [
    ['../../inventory/mssql.cjs', { query: sorgu, sql: { NVarChar: () => 'nvarchar' } }],
    ['../../auth/index.cjs', { requireAuth: (_q, _s, n) => n() }],
    ['../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() }],
  ].map(([rel, exports]) => {
    const p = require.resolve(rel);
    const eski = require.cache[p];
    const m = new Module(p);
    m.filename = p;
    m.loaded = true;
    m.exports = exports;
    require.cache[p] = m;
    return [p, eski];
  });
  const indexYol = require.resolve('../index.cjs');
  delete require.cache[indexYol];
  let srv = null;
  const log = console.log;
  try {
    const { initServerHub } = require('../index.cjs');
    const express = require('express');
    const app = express();
    app.use((req, _res, next) => {
      req.session = { user: { role: 'Admin', username: 'test' } };
      next();
    });
    console.log = () => {};
    try {
      initServerHub(app);
    } finally {
      console.log = log;
    }
    srv = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });
    const kok = `http://127.0.0.1:${srv.address().port}/api/server-hub`;
    const o = await fetch(`${kok}/overview?fresh=1`);
    const f = await fetch(`${kok}/findings?fresh=1`);
    assert.equal(o.status, 200, '/overview 200 donmedi');
    assert.equal(f.status, 200, '/findings 200 donmedi');
    const h = {};
    for (const ad of hostlar) {
      const r = await fetch(`${kok}/host/${ad}?fresh=1`);
      assert.equal(r.status, 200, `/host/${ad} 200 donmedi`);
      h[ad] = (await r.json()).host;
    }
    let hz = null;
    if (hazirlik) {
      const r = await fetch(`${kok}/reboot-readiness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hosts: hazirlik }),
      });
      assert.equal(r.status, 200, '/reboot-readiness 200 donmedi');
      hz = await r.json();
    }
    return { o: await o.json(), f: await f.json(), h, hz };
  } finally {
    console.log = log;
    if (srv) {
      if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
      srv.close();
    }
    delete require.cache[indexYol];
    for (const [p, eski] of stublar) {
      if (eski) require.cache[p] = eski;
      else delete require.cache[p];
    }
  }
}

test("D2 EK-1 geri alma bandi: /overview rollback.allowed=false iken tek satir 'Portal'i geri almadan once: <mesaj>'", async () => {
  const gm = fonksiyon(P, 'geriAlmaMetni');
  assert.equal(gm(null), null);
  assert.equal(gm(undefined), null, 'alan yoksa (eski Portal yaniti) bant yok');
  assert.equal(gm({ allowed: true, v3Hosts: 0, message: '' }), null, 'geri alma serbestken bant gosterildi');
  assert.equal(gm({ allowed: false, v3Hosts: 3, message: 'X mesaji.' }), "Portal'ı geri almadan önce: X mesaji.");
  assert.match(gm({ allowed: false, v3Hosts: 2, message: '' }), /^Portal'ı geri almadan önce: 2 sunucunun son taraması yeni tarayıcıdan/);
  assert.match(gm({ allowed: false }), /^Portal'ı geri almadan önce: .*geri alınmamalı/, 'mesaj ve sayi yokken bant bos kaldi');

  const { o } = await sunucuYanitlari('bayat');
  assert.ok(o.rollback && o.rollback.allowed === false, '/overview v3 veride rollback.allowed=false dondurmedi');
  const k = okunanAnahtar(PAGE_RAW, PAGE_PATH, 'HostsTab', 'GeriAlmaBandi', 'rb', 'data');
  const el = fonksiyon(P, 'GeriAlmaBandi')({ rb: o[k] });
  assert.ok(el, `Sunucular sekmesi '${k}' okuyor; /overview yanitinda bu alan bant uretmiyor`);
  const metin = metinleri(el);
  assert.ok(metin.startsWith("Portal'ı geri almadan önce: "), metin);
  assert.ok(metin.includes(o.rollback.message), 'sunucunun mesaji bantta yok');
  assert.equal(el.props.title, metin, 'kesilen metnin tamami title da yok');
});

test('D3 EK-2 Bulgular sekmesi bandi: /findings staleFleet tasir ve sekme bandi o alani okur', async () => {
  const BF = fonksiyon(P, 'BayatFiloBandi');
  const { o, f } = await sunucuYanitlari('bayat');
  assert.ok(o.staleFleet && o.staleFleet.ageDays > 2, '/overview bayat filoda staleFleet dondurmedi (duzenek)');
  const beklenen = `Son başarılı yükleme ${o.staleFleet.ageDays} gün önce — eylemler kapalı`;
  // Sunucular sekmesi
  const kH = okunanAnahtar(PAGE_RAW, PAGE_PATH, 'HostsTab', 'BayatFiloBandi', 'sf', 'data');
  const bH = BF({ sf: o[kH] });
  assert.ok(bH && metinleri(bH).startsWith(beklenen), 'Sunucular sekmesinde bayat filo bandi cikmiyor');
  // Bulgular sekmesi: veriyi /findings'ten alir
  const ft = govde(PAGE_RAW, 'FindingsTab');
  assert.ok(ft.includes('serverHubApi.findings(fresh)'), 'Bulgular sekmesi veriyi /findings ten almiyor');
  const kF = okunanAnahtar(PAGE_RAW, PAGE_PATH, 'FindingsTab', 'BayatFiloBandi', 'sf', 'data');
  assert.ok(
    Object.prototype.hasOwnProperty.call(f, kF),
    `/findings yaniti '${kF}' tasimiyor (anahtarlar: ${Object.keys(f).join(',')}) - Bulgular sekmesindeki EK-2 bandi hic gorunmez`,
  );
  assert.deepEqual(f[kF], o.staleFleet, '/findings ve /overview bayatligi farkli bildiriyor');
  const bF = BF({ sf: f[kF] });
  assert.ok(bF && metinleri(bF).startsWith(beklenen), 'Bulgular sekmesinde bayat filo bandi cikmiyor');
});

// ── T2-D2 C3 sema bilinmiyor ──────────────────────────────────────────────────────────
// C <-> D uyumsuzlugu (KESIN, grep 0): /overview, /findings ve hostDetail schemaUnknown tasiyor,
// ekran okumuyordu; JVM satirlari 'bilinmiyor (surec gorunmuyor)' + hidepid aciklamasiyla
// gorunuyordu (yanlis sebep).
test("T2-D2 schemaUnknown: 'Tarayici sema surumu bilinmiyor; eylemler kapali' bandi uc yerde ve sunucu yanitindan", async () => {
  const sm = fonksiyon(P, 'semaBilinmiyorMetni');
  const SB = fonksiyon(P, 'SemaBandi');
  assert.equal(sm(true), 'Tarayıcı şema sürümü bilinmiyor; eylemler kapalı');
  for (const x of [false, null, undefined]) {
    assert.equal(sm(x), null, `schemaUnknown=${x} iken bant metni`);
    assert.equal(SB({ su: x }), null, `schemaUnknown=${x} iken bant basildi`);
  }
  const el = SB({ su: true });
  assert.ok(el, 'schemaUnknown=true iken sema bandi null dondu - ekranda yok');
  assert.equal(el.props.role, 'alert');
  assert.equal(metinleri(el), sm(true));
  assert.match(el.props.title, /sys\.columns/, 'bandin aciklamasi sebebi (sys.columns) soylemiyor');
  assert.deepEqual(gorunurlukSorunlari(el), [], 'sema bandi gizli');

  // YERLESIM (AST) + SUNUCU YANITI: her ekran kendi yanitinin alanini okur
  const { o, f, h } = await sunucuYanitlari('sema');
  assert.equal(o.schemaUnknown, true, '/overview sema dusunce schemaUnknown=true dondurmedi (duzenek)');
  const kO = okunanAnahtar(PAGE_RAW, PAGE_PATH, 'HostsTab', 'SemaBandi', 'su', 'data');
  const kF = okunanAnahtar(PAGE_RAW, PAGE_PATH, 'FindingsTab', 'SemaBandi', 'su', 'data');
  const kH = okunanAnahtar(PAGE_RAW, PAGE_PATH, 'HostModal', 'SemaBandi', 'su', 'd', ['d &&']);
  assert.ok(SB({ su: o[kO] }), `Sunucular sekmesi '${kO}' okuyor; /overview yanitinda sema bandi cikmiyor`);
  assert.ok(SB({ su: f[kF] }), `Bulgular sekmesi '${kF}' okuyor; /findings yanitinda sema bandi cikmiyor`);
  for (const ad of [APP, WEB]) assert.ok(SB({ su: h[ad][kH] }), `${ad} ayrintisi '${kH}' tasimiyor - sema bandi cikmiyor`);

  // Ayrintidaki JVM ve web satirlari: sebep SEMA, hidepid DEGIL; yine de "kapali/calismiyor" DEGIL.
  // HostModal'in cagrilarina verdigi bayrak ayni alani okur (AST).
  const bayrak = (ad) => {
    const c = cagrilar(PAGE_RAW, PAGE_PATH, 'HostModal', ad);
    assert.ok(c.length >= 1, `${ad} cagrisi yok`);
    const m = /^d\??\.(\w+) === true$/.exec(c[0][c[0].length - 1]);
    assert.ok(m, `${ad} sema bayragini ayrintidan almiyor: ${c[0].join(', ')}`);
    return m[1];
  };
  const jvm = h[APP].jvms.find((j) => j.name === 'crm');
  assert.ok(jvm && jvm.runningKnown === false, 'duzenek: sema bilinmiyorken durmus JVM bilinmiyor gelmedi');
  const jd = fonksiyon(P, 'jvmDurumu')(jvm, h[APP][bayrak('jvmDurumu')] === true);
  assert.equal(jd.metin, 'bilinmiyor (şema okunamadı)', 'sema bilinmiyorken JVM satiri yanlis sebep gosteriyor');
  assert.ok(!/hidepid/.test(jd.aciklama));
  const web = h[WEB].web.find((w) => w.product === 'IHS');
  assert.ok(web, 'duzenek: web satiri yok');
  const wd = fonksiyon(P, 'webDurumu')(web, h[WEB][bayrak('webDurumu')] === true);
  assert.equal(wd.metin, 'bilinmiyor (şema okunamadı)', `sema bilinmiyorken web satiri: ${wd.metin}`);
});

// Sunucular sekmesinin ozet kartlari ve liste hucresi basliklari da olculemeyen sayaclarin
// sebebini yazar ('bilinmiyor (surec gorunmuyor)', hidepid). Sema bilinmiyorken bu sebep de
// yanlis: basliklar /overview schemaUnknown'unu okumali.
test('T2-D2 Sunucular sekmesi ozet/liste basliklari: sema bilinmiyorken olculemeyenin sebebi sema, hidepid DEGIL', async () => {
  const os = fonksiyon(P, 'olcumSebebi');
  const oa = fonksiyon(P, 'olculemeyenAciklama');
  assert.equal(os(false), 'süreç görünmüyor');
  assert.equal(os(true), 'şema okunamadı');
  for (const tur of ['jvm', 'web']) {
    assert.match(oa(tur, false), /hidepid/, `${tur}: sema okunurken hidepid aciklamasi kayip`);
    const s = oa(tur, true);
    assert.match(s, /sys\.columns/, `${tur}: sema bilinmiyorken sebep sema degil: ${s}`);
    assert.ok(!/hidepid|Süreç listesi/.test(s), `${tur}: sema bilinmiyorken hidepid sebebi: ${s}`);
  }
  assert.notEqual(oa('jvm', true), oa('web', true));

  // BAGLANTI (AST): HostsTab'in 'sema' bayragi /overview alanindan; her sebep cagrisi onu verir;
  // bayraktan bagimsiz sabit hidepid / 'surec gorunmuyor' metni (dizgi, sablon, JSX metni) yok.
  const { ts, sf, fn } = ustFonksiyon(PAGE_RAW, PAGE_PATH, 'HostsTab');
  const ilkler = [];
  const sabit = [];
  const gez = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'sema') ilkler.push(n.initializer ? dugumMetni(sf, n.initializer) : '');
    if (
      (ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateHead(n) ||
        ts.isTemplateMiddle(n) ||
        ts.isTemplateTail(n) ||
        ts.isJsxText(n)) &&
      /hidepid|süreç görünmüyor/i.test(n.text)
    )
      sabit.push(normalize(n.text));
    ts.forEachChild(n, gez);
  };
  gez(fn.body);
  assert.equal(ilkler.length, 1, `HostsTab 'sema' bayragi ${ilkler.length} kez tanimli`);
  const m = /^data\??\.(\w+) === true$/.exec(ilkler[0]);
  assert.ok(m, `HostsTab sema bayragi /overview alanindan gelmiyor: ${ilkler[0]}`);
  assert.deepEqual(sabit, [], `HostsTab'da sema bayragindan bagimsiz sebep metni: ${sabit.join(' | ')}`);
  const cs = cagrilar(PAGE_RAW, PAGE_PATH, 'HostsTab', 'olcumSebebi');
  assert.ok(cs.length >= 3, `olcumSebebi ${cs.length} yerde (donut dilimi, ortam basligi, liste hucresi bekleniyor)`);
  for (const a of cs) assert.deepEqual(a, ['sema'], `olcumSebebi(${a.join(', ')}) sema bayragini vermiyor`);
  const ca = cagrilar(PAGE_RAW, PAGE_PATH, 'HostsTab', 'olculemeyenAciklama').map((a) => a.join(', '));
  assert.deepEqual(ca.sort(), ["'jvm', sema", "'web', sema"], `olculemeyenAciklama cagrilari: ${ca.join(' / ')}`);

  // SUNUCU YANITI: sema dusukken /overview bayragi true; okunan alan ayni ad
  const { o } = await sunucuYanitlari('sema');
  assert.equal(o[m[1]], true, `/overview '${m[1]}' tasimiyor - basliklar hidepid sebebini gosterir`);
  const { o: ob } = await sunucuYanitlari('bayat');
  assert.notEqual(ob[m[1]], true, 'sema okunurken bayrak true');
});

test('T2-D2 rollback.schemaUnknown: v3 sayimi yapilamadi - bant sebebi sema, "N sunucu yeni tarayicidan" denmez', async () => {
  const gm = fonksiyon(P, 'geriAlmaMetni');
  const bosMesaj = gm({ allowed: false, v3Hosts: null, schemaUnknown: true, message: '' });
  assert.match(bosMesaj, /şeması okunamadı/);
  assert.ok(!/yeni tarayıcıdan \(scan_ver dolu\)/.test(bosMesaj), 'sema bilinmiyorken v3 sunucu sayisi uyduruldu');
  assert.ok(!/Bazı sunucunun/.test(bosMesaj));
  const { o } = await sunucuYanitlari('sema');
  assert.equal(o.rollback && o.rollback.schemaUnknown, true, '/overview rollback.schemaUnknown tasimiyor (duzenek)');
  const k = okunanAnahtar(PAGE_RAW, PAGE_PATH, 'HostsTab', 'GeriAlmaBandi', 'rb', 'data');
  const el = P.GeriAlmaBandi({ rb: o[k] });
  assert.ok(el, 'sema bilinmiyorken geri alma bandi cikmiyor');
  assert.ok(metinleri(el).includes(o.rollback.message), 'sunucunun sema mesaji bantta yok');
  // sunucu mesaji bos gelse de sebep sema
  assert.match(gm({ ...o.rollback, message: '' }), /şeması okunamadı/);
});

test('T2-D2 hazirlik sebep kodlari: SCHEMA_UNKNOWN / STALE_EVIDENCE ve her olculemeyen (unknown) kodun etiketi var; ham kod basilmaz', async () => {
  const KOD = P.KOD_ETIKET;
  const hs = fonksiyon(P, 'hazirlikSebebi');
  const { KOD_ANLAMI, SEMA, BAYAT } = require('../reboot-readiness.cjs');
  const gerekli = [SEMA.code, BAYAT.code, ...Object.entries(KOD_ANLAMI).filter(([, v]) => v.tip === 'unknown').map(([k]) => k)];
  const eksik = gerekli.filter((k) => typeof KOD[k] !== 'string' || KOD[k].trim().length < 4);
  assert.deepEqual(eksik, [], `ekran etiketi eksik (hazirlikta 'bilinmiyor' sayilan kod): ${eksik.join(', ')}`);
  assert.match(KOD.SCHEMA_UNKNOWN, /şema/i);
  for (const k of gerekli) assert.equal(hs({ code: k, aciklama: '' }), KOD[k], `${k}: aciklama bossa ham kod basildi`);
  assert.equal(hs({ code: 'SCHEMA_UNKNOWN', aciklama: ' sunucu metni ' }), 'sunucu metni', 'sunucunun aciklamasi kullanilmadi');
  assert.equal(hs({ code: 'YENI_X', aciklama: '' }), 'YENI_X', 'etiketsiz kod dusuruldu');
  // GERCEK /reboot-readiness (sema dusuk): her sebep ekranda etiketli
  const { hz } = await sunucuYanitlari('sema');
  assert.ok(hz && hz.rows && hz.rows.length === 2, '/reboot-readiness duzenegi');
  for (const r of hz.rows) {
    assert.equal(r.verdict, 'unknown', `${r.host}: sema bilinmiyorken kova ${r.verdict}`);
    assert.ok(r.reasons.some((y) => y.code === 'SCHEMA_UNKNOWN'), `${r.host}: SCHEMA_UNKNOWN sebebi yok`);
  }
  for (const t of hz.topReasons) {
    assert.ok(KOD[t.code], `hazirlik sebebi ${t.code} ekranda etiketsiz`);
    assert.notEqual(hs(t), t.code);
  }
  // BAGLANTI (AST): Sebepler listesi ve satirlar yardimcidan gecer; sebep satirinin title'i kod etiketi
  const c = cagrilar(PAGE_RAW, PAGE_PATH, 'ReadinessTab', 'hazirlikSebebi');
  assert.deepEqual(c.map((a) => a[0]).sort(), ['t', 'y'], `hazirlikSebebi cagrilari: ${JSON.stringify(c)}`);
  assert.deepEqual(cagrilar(PAGE_RAW, PAGE_PATH, 'ReadinessTab', 'kodEtiketi'), [['t.code']]);
  assert.ok(!/\{t\.aciklama\} —/.test(govde(PAGE_RAW, 'ReadinessTab')), 'Sebepler listesi ham aciklamaya donmus');
});

// ── T2-D2 C4 targetsTruncated rozeti ve EK-3 unattributed ayrintisi ───────────────────
test("T2-D2 vhosts[].targetsTruncated: 'hedef listesi kesik' rozeti (sunucu yanitindan, gorunur)", async () => {
  const hr = fonksiyon(P, 'hedefKesikRozeti');
  const HR = fonksiyon(P, 'HedefKesikRozeti');
  const rz = hr(true);
  assert.ok(rz, 'targetsTruncated=true iken rozet bilgisi null');
  assert.equal(rz.metin, 'hedef listesi kesik');
  assert.match(rz.aciklama, /bilinmiyor/);
  for (const x of [false, null, undefined]) {
    assert.equal(hr(x), null);
    assert.equal(HR({ kesik: x }), null, `targetsTruncated=${x} iken rozet basildi`);
  }
  const el = HR({ kesik: true });
  assert.ok(el, 'kesik listede rozet null dondu');
  assert.equal(metinleri(el), 'hedef listesi kesik');
  assert.equal(el.props.title, hr(true).aciklama);
  assert.deepEqual(gorunurlukSorunlari(el), [], 'rozet gizli');
  // YERLESIM: Web/vhost sekmesinde her vhost satirinda (map geri cagrisi), truncate div'inin DISINDA
  const e = tekYerlesim(PAGE_RAW, PAGE_PATH, 'HostModal', 'HedefKesikRozeti', {
    kosullar: ['d &&', "tab === 'web' &&", 'd.vhosts.length === 0 :', '=>'],
  });
  const m = /^v\.(\w+)$/.exec(String(e.ozellik.kesik));
  assert.ok(m, `rozet vhost alanini okumuyor: ${e.ozellik.kesik}`);
  // SUNUCU YANITI: '~TRUNC' ile biten liste -> targetsTruncated, kesiksiz -> yok
  const { h } = await sunucuYanitlari('ek3');
  const vh = h[WEB].vhosts;
  const api = vh.find((x) => x.serverName === 'api.bmw.de');
  const crm = vh.find((x) => x.serverName === 'crm.bmw.de');
  assert.ok(api && crm, 'duzenek: vhost satirlari yok');
  assert.ok(HR({ kesik: api[m[1]] }), `sunucu kesik listeyi '${m[1]}' alaninda tasimiyor - rozet cikmiyor`);
  assert.equal(HR({ kesik: crm[m[1]] }), null, 'kesiksiz listede rozet');
  assert.ok(!String(api.proxyTargets).includes('TRUNC'), 'kesik jetonu hedef olarak gosterildi');
});

test('T2-D2 TRAFFIC_UNATTRIBUTED: unattributed[].kind ve .target ayrinti panelinde; etiket katman genisliginde', async () => {
  const KOD = P.KOD_ETIKET;
  assert.ok(!/bu sunucuya|sunucusuna/.test(KOD.TRAFFIC_UNATTRIBUTED), `etiket hala sunucuya ozel: ${KOD.TRAFFIC_UNATTRIBUTED}`);
  assert.match(KOD.TRAFFIC_UNATTRIBUTED, /katman/);
  const as = fonksiyon(P, 'atfedilemeyenSatiri');
  const TUR = P.ATF_TUR;
  for (const k of ['PORT', 'HEDEF', 'EKSIK']) assert.ok(TUR && TUR[k], `${k} turu etiketsiz`);
  const hedefS = as({ host: 'GBCJWP01', serverName: 'api.bmw.de', port: 8180, target: 'crm-vip.bmw.local:8180', kind: 'HEDEF', req7d: 5000, trafficState: 'ACTIVE' });
  assert.ok(hedefS.includes('crm-vip.bmw.local:8180') && hedefS.includes(TUR.HEDEF) && hedefS.includes('GBCJWP01/api.bmw.de'), hedefS);
  assert.ok(!hedefS.includes(':8180 (:8180)'), 'port iki kez');
  const portS = as({ host: 'GBCJWP01', serverName: 'b', port: 8443, target: null, kind: 'PORT', req7d: -1, trafficState: null });
  assert.ok(portS.includes(':8443') && portS.includes(TUR.PORT) && /ölçülemedi/.test(portS), portS);
  const eksikS = as({ host: 'W', serverName: 'c', port: null, target: '~', kind: 'EKSIK', req7d: 0, trafficState: 'NO_RECENT_TRAFFIC' });
  assert.ok(eksikS.includes(TUR.EKSIK) && eksikS.includes('~'), eksikS);
  assert.ok(as({ kind: 'YENI', target: 'x:1' }).includes('YENI'), 'bilinmeyen tur dusuruldu');

  const AT = fonksiyon(P, 'AtfedilemeyenTrafik');
  assert.equal(AT({ f: { code: 'X', text: '' } }), null);
  assert.equal(AT({ f: { code: 'X', text: '', unattributed: [] } }), null);
  // YERLESIM: sunucu penceresinin bulgu listesinde, her bulgunun altinda
  tekYerlesim(PAGE_RAW, PAGE_PATH, 'HostModal', 'AtfedilemeyenTrafik', {
    kosullar: ['d &&', "tab === 'findings' &&", 'd.findings.length === 0 :', '=>'],
    ozellik: { f: 'f' },
  });
  // SUNUCU YANITI: gercek assess + hostDetail; HEDEF (VIP adi) ve EKSIK (~TRUNC) kayitlari ekranda
  const { h } = await sunucuYanitlari('ek3');
  const tu = h[APP].findings.filter((x) => x.code === 'TRAFFIC_UNATTRIBUTED');
  assert.equal(tu.length, 1, `duzenek: TRAFFIC_UNATTRIBUTED ${tu.length}`);
  const liste = tu[0].unattributed;
  assert.ok(Array.isArray(liste) && liste.length >= 2, 'hostDetail unattributed[] tasimiyor');
  const el = AT({ f: tu[0] });
  assert.ok(el, 'TRAFFIC_UNATTRIBUTED ayrinti paneli null');
  assert.deepEqual(gorunurlukSorunlari(el), []);
  const yazi = metinleri(el);
  assert.ok(yazi.includes(`Atfedilemeyen proxy: ${liste.length}`), 'ozet satiri sayiyi gostermiyor');
  for (const x of liste) {
    assert.ok(TUR[x.kind], `sunucunun turu (${x.kind}) ekranda etiketsiz`);
    assert.ok(yazi.includes(TUR[x.kind]), `${x.kind} turu panelde yok`);
    if (x.kind !== 'EKSIK') assert.ok(yazi.includes(String(x.target)), `${x.target} hedefi panelde yok`);
  }
  assert.deepEqual([...new Set(liste.map((x) => x.kind))].sort(), ['EKSIK', 'HEDEF']);
  assert.ok(yazi.includes('crm-vip.bmw.local:8180'));
});

// ── T2-D2 T2-C2 tanimsiz surec (UNAVAILABLE) ve auto-start sebep etiketleri ────────────
// GERCEK assess: CLI OK + tanimda olmayan calisan JVM (cfg_src=UNAVAILABLE) ve PS_ONLY. Uretilen
// her bulgu kodunun ve auto-start sebebinin ekran etiketi olmali; UNAVAILABLE'a ozel kodun etiketi
// "okunamadi" (yanlis kok neden) DEMEZ.
const { assess } = require('../assess.cjs');
function tanimKur(cfgSrc) {
  const g = gunOnce(0);
  return {
    hosts: [{ host: APP, scan_date: g, products: 'JBOSS7', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.1', rec_counts: '', scan_errors: '', proc_visibility: 'FULL', sock_visibility: 'PID', loaded_at: `${g}T06:00:00Z` }],
    init: [],
    jboss: [{ host: APP, scan_date: g, gen: 7, host_name: 'h', host_state: 'running', cli: cfgSrc === 'PS_ONLY' ? 'FAIL' : 'OK', note: '' }],
    jvms: [
      { host: APP, scan_date: g, gen: 7, jvm: 'tanimli', grp: 'g', running: 1, auto_start: 'true', server_state: 'running', ports: '8080', running_src: 'PS', cfg_src: cfgSrc === 'PS_ONLY' ? 'PS_ONLY' : 'CLI_WILDCARD' },
      { host: APP, scan_date: g, gen: 7, jvm: 'hayalet', grp: '', running: 1, auto_start: '', server_state: 'running', ports: '8090', running_src: 'PS', cfg_src: cfgSrc },
    ],
    web: [],
    vhosts: [],
    ips: [],
    sshd: [],
  };
}
test("T2-D2 UNAVAILABLE/tanimsiz-surec: uretilen her kod ve auto-start sebebi etiketli; UNAVAILABLE etiketi 'okunamadi' demez", () => {
  const KOD = P.KOD_ETIKET;
  const SEBEP = P.AUTOSTART_SEBEP_ETIKET;
  const kir = fonksiyon(P, 'autoBilinmiyorKirilimi');
  const kosu = (c) => assess(tanimKur(c), { now: Date.now() });
  const u = kosu('UNAVAILABLE');
  const p = kosu('PS_ONLY');
  const kodlar = (r) => new Set(r.hosts[0].findings.map((f) => f.code));
  const ku = kodlar(u);
  const kp = kodlar(p);
  for (const k of new Set([...ku, ...kp])) assert.ok(KOD[k], `${k} uretiliyor ama ekranda etiketi yok`);
  const ozel = [...ku].filter((k) => !kp.has(k));
  assert.ok(ozel.length >= 1, `UNAVAILABLE'a ozel bulgu kodu yok (kodlar: ${[...ku].join(',')}) - PS_ONLY ile ayni metin mi?`);
  for (const k of ozel) {
    assert.ok(!/okunamad|cevap vermedi/.test(KOD[k]), `${k} etiketi yanlis kok neden soyluyor: ${KOD[k]}`);
    assert.match(KOD[k], /tanım/, `${k} etiketi 'tanimda yok' demiyor`);
  }
  // auto-start sebepleri: ozet anahtarlari ve bulgu ekleri
  const sebepler = new Set();
  for (const r of [u, p]) {
    for (const k of Object.keys(r.summary.jvm.autoUnknownBy || {})) sebepler.add(k);
    for (const f of r.hosts[0].findings) if (f.autoStartReason) sebepler.add(f.autoStartReason);
  }
  assert.ok(sebepler.has('tanimsiz-surec'), 'duzenek: tanimsiz-surec sebebi uretilmedi');
  for (const s of sebepler) assert.ok(SEBEP[s], `auto-start sebebi '${s}' ekranda etiketsiz`);
  assert.ok(!/CLI|okunamad/.test(SEBEP['tanimsiz-surec']), `tanimsiz-surec etiketi yanlis: ${SEBEP['tanimsiz-surec']}`);
  // kirilim: gercek ozet -> etiketli; etiketi olmayan yeni anahtar DUSURULMEZ; 0'lar yazilmaz
  const ku_ = kir(u.summary.jvm.autoUnknownBy);
  assert.ok(ku_.includes(`${SEBEP['tanimsiz-surec']}: 1`), ku_);
  assert.ok(!ku_.includes('CLI cevap vermedi'), `sifir sayac yazildi: ${ku_}`);
  assert.ok(kir({ 'yeni-sebep': 2 }).includes('yeni-sebep: 2'), 'bilinmeyen sebep dusuruldu');
  assert.equal(kir(null), '');
  // BAGLANTI (AST): ozet karti dilim basligi kirilimi yardimcidan alir
  const c = cagrilar(PAGE_RAW, PAGE_PATH, 'HostsTab', 'autoBilinmiyorKirilimi');
  assert.ok(c.length >= 1 && c.every((a) => a[0] === 's.jvm.autoUnknownBy'), `kirilim cagrisi: ${JSON.stringify(c)}`);
  assert.ok(!PAGE.includes("['cli-okunamadi', 'CLI cevap vermedi'],"), 'eski sabit uc-sebep listesi geri gelmis');
});

// ── Kural 6: init ve web ──────────────────────────────────────────────────────────────
test("K6 init UNREADABLE 'yok' DEGIL; bilinmeyen durum da 'yok' degil", () => {
  const id = fonksiyon(P, 'initDurumu');
  const u = id('UNREADABLE');
  assert.match(u.etiket, /okunamadı/);
  assert.ok(!/^yok$/.test(u.etiket));
  assert.equal(id('MISSING').etiket, 'yok');
  assert.equal(id('OK').etiket, 'referansla aynı');
  assert.equal(id('DIFF').etiket, 'FARKLI');
  assert.notEqual(id('BASKA').etiket, 'yok', "bilinmeyen durum 'yok' basildi");
  assert.notEqual(u.renk, id('MISSING').renk, 'okunamadi ile yok ayni renkte');
  assert.ok(PAGE.includes('initDurumu(i.status)'), 'init tablosu yardimciyi kullanmiyor');
});

test("K6 web running_src=UNMEASURED 'calismiyor' DEGIL", () => {
  const wd = fonksiyon(P, 'webDurumu');
  const u = wd({ running: false, runningSrc: 'UNMEASURED' });
  assert.match(u.metin, /bilinmiyor/);
  assert.ok(!u.metin.includes('çalışmıyor'));
  assert.equal(wd({ running: false, runningSrc: 'PS_ABSENT' }).metin, 'çalışmıyor');
  assert.equal(wd({ running: false }).metin, 'çalışmıyor', 'eski yanit');
  assert.equal(wd({ running: true, runningSrc: 'PS' }).metin, 'çalışıyor');
  assert.equal(wd({ running: false, runningSrc: 'UNMEASURED' }, true).metin, 'bilinmiyor (şema okunamadı)');
  const c = cagrilar(PAGE_RAW, PAGE_PATH, 'HostModal', 'webDurumu');
  assert.ok(c.length >= 1, 'web karti yardimciyi kullanmiyor');
  for (const a of c) assert.deepEqual(a, ['w', 'd.schemaUnknown === true'], `webDurumu(${a.join(', ')}) sema bayragini vermiyor`);
});

// ── Kural 3: toplu JVM islemi yok ─────────────────────────────────────────────────────
test('K3 toplu JVM islemi yok: auto-start cagrisi tek (host, jvm)', () => {
  const cagri = PAGE.match(/serverHubApi\.jvmAutoStart\(/g) || [];
  assert.equal(cagri.length, 2, 'auto-start cagrisi sayisi degisti (yalniz satir ve bulgu satiri)');
  assert.ok(!/\.map\([^)]*jvmAutoStart/.test(PAGE), 'auto-start bir liste uzerinde donuyor');
  assert.ok(!/for \([^)]*\) [^;]*jvmAutoStart/.test(PAGE), 'auto-start dongude cagriliyor');
});
