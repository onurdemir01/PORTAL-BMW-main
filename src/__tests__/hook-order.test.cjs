// src/__tests__/hook-order.test.cjs — "erken return'den SONRA hook" avcısı.
//
// GERCEK ARIZA (2026-08-10, uretim): LogXWizardPage'de `if (loading) return <...>`
// erken cikisinin ALTINDA iki hook kalmisti (`useRef` + `useEffect`). Ilk render
// `loading === true` ile 17 hook calistirip erken donuyor, ikinci render 19 hook
// calistiriyordu → React "Rendered more hooks than during the previous render."
// firlatti, agac unmount oldu ve /logx BEMBEYAZ acildi. Sayfaya giren herkes gordu.
//
// NEDEN BU TEST: TypeScript bunu yakalamaz, `npm run build` sorunsuz gecer, HAR'da
// tum bundle'lar 200 doner. Hata yalnizca tarayicida, ikinci render'da ortaya cikar.
// Repoda ESLint (dolayisiyla react-hooks/rules-of-hooks) YOK; bu test onun yerine
// TypeScript derleyici API'siyle — repoda zaten kurulu, yeni bagimlilik yok — ayni
// kurali kilitler.
//
// KAPSAM (bilerek dar tutuldu, yanlis pozitif uretmemeli): yalnizca bir fonksiyon
// govdesinin UST SEVIYESI taranir. Ic ice fonksiyonlara inilmez — bir effect'in
// cleanup `return`'u, `useMemo` govdesindeki `return` ya da bir callback icindeki
// erken cikis hook kuralini ihlal etmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const SRC = path.join(__dirname, '..');
const HOOK_NAME = /^use[A-Z]/;

function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

// Bir dugumun ICINDE (ic ice fonksiyonlara inmeden) return var mi?
function containsReturn(node) {
  let found = false;
  (function walk(n) {
    if (found) return;
    if (ts.isReturnStatement(n)) { found = true; return; }
    if (ts.isFunctionLike(n)) return;   // ic fonksiyonun return'u bizi ilgilendirmez
    ts.forEachChild(n, walk);
  })(node);
  return found;
}

// Bir ust-seviye ifadenin icinde hook cagrisi var mi? Ic fonksiyonlara inilmez:
// `useEffect(() => { ... })` icindeki cagrilar hook DEGILDIR (o gövde render'da calismaz).
function findHookCall(statement) {
  let hit = null;
  (function walk(n) {
    if (hit) return;
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const name = ts.isIdentifier(e)
        ? e.text
        : (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) ? e.name.text : '');
      if (HOOK_NAME.test(name)) { hit = { name, node: n }; return; }
    }
    if (ts.isFunctionLike(n) && n !== statement) return;
    ts.forEachChild(n, walk);
  })(statement);
  return hit;
}

function violationsIn(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  function scanBody(body) {
    if (!body || !ts.isBlock(body)) return;
    let earlyReturnLine = null;
    for (const st of body.statements) {
      if (earlyReturnLine === null) {
        // Govdenin son ifadesi olan `return` erken cikis DEGILDIR; ondan sonra zaten
        // hicbir sey calismaz. Onu da isaretlemek zararsiz: sonrasinda hook olamaz.
        if (ts.isReturnStatement(st) || (ts.isIfStatement(st) && containsReturn(st.thenStatement))) {
          earlyReturnLine = lineOf(st);
        }
        continue;
      }
      const hook = findHookCall(st);
      if (hook) {
        found.push(`${path.relative(SRC, file)}:${lineOf(hook.node)} — ${hook.name}() ` +
          `(satir ${earlyReturnLine}'deki erken return'den SONRA)`);
      }
    }
  }

  (function walk(n) {
    if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) scanBody(n.body);
    ts.forEachChild(n, walk);
  })(sf);
  return found;
}

test('hicbir bilesende erken return SONRASI hook cagrisi yok (beyaz ekran korumasi)', () => {
  const all = sourceFiles(SRC).flatMap(violationsIn);
  assert.deepEqual(
    all,
    [],
    'Kosullu calisan hook React\'i "Rendered more hooks than during the previous render." ' +
    'ile dusurur ve sayfa BEYAZ kalir. Erken return TUM hook\'larin ALTINA tasinmali:\n' +
    all.join('\n')
  );
});

test('dedektorun kendisi calisiyor: enjekte edilmis ihlali yakalar', () => {
  // Testin sessizce "her sey temiz" demesini onler: bozuk bir ornekle kaniti uretir.
  const tmp = path.join(require('node:os').tmpdir(), `hook-order-probe-${process.pid}.tsx`);
  fs.writeFileSync(tmp, [
    'const C = () => {',
    '  const [a, setA] = useState(0);',
    '  if (!a) return null;',
    '  const r = useRef(null);',            // ← ihlal
    '  useEffect(() => { return () => {}; }, []);',  // ← ihlal (cleanup return'u sayilmaz)
    '  return a;',
    '};',
  ].join('\n'), 'utf8');
  try {
    const hits = violationsIn(tmp);
    assert.equal(hits.length, 2, `dedektor iki ihlali de yakalamali, buldugu: ${hits.length}`);
    assert.match(hits[0], /useRef/);
    assert.match(hits[1], /useEffect/);
  } finally {
    fs.unlinkSync(tmp);
  }
});
