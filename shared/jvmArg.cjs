// shared/jvmArg.cjs - JVM arguman metnini (anahtar -> etkin deger) haritasina ayirir. Sunucu
// (server/app-hub/jvm-karsilastir.cjs, Toplu JVM karsilastir) ve ekran (src/components/app_hub/ocpKarsilastir.ts,
// OCP ortam ici cluster karsilastirmasi) AYNI kurali kullanir.
//
// Kurallar: arguman kumesi SIRASIZ; -Dk=v -> (-Dk, v), -Xmx2g -> (-Xmx, 2g), -XX:+Foo -> (-XX:Foo, +),
// -XX:Foo=v -> (-XX:Foo, v), -Xlog:x -> (-Xlog, x), --add-opens=v -> (--add-opens, v). Tekrar eden anahtarda
// son deger etkindir (tekrarlar listesine yazilir); cok degerli bayraklar (--add-opens, -javaagent, -Xlog...)
// sirasiz birlestirilir. Tarayicinin kesme belirteci '...+N' arguman sayilmaz (kesik).
'use strict';

// Array.prototype.sort varsayilan sirasi (server/util/siralama.cjs varsayilanSira ile ayni; shared sunucuya bagimli degil).
function varsayilanSira(a, b) {
  const x = String(a);
  const y = String(b);
  if (x < y) return -1;
  return x > y ? 1 : 0;
}

// Degeri ayri belirtec olarak alan bayraklar (-cp <yol>).
const DEGERLI_BAYRAK = new Set([
  '-cp',
  '-classpath',
  '-jar',
  '-mp',
  '--module-path',
  '-p',
  '--add-modules',
  '--add-opens',
  '--add-exports',
  '--add-reads',
  '--patch-module',
]);
// Birden cok kez verilmesi olagan, her degeri ayri gecerli olan bayraklar: sirasiz birlestirilir.
const COK_DEGERLI = new Set([
  '--add-modules',
  '--add-opens',
  '--add-exports',
  '--add-reads',
  '--patch-module',
  '-javaagent',
  '-agentlib',
  '-agentpath',
  '-Xlog',
  '-verbose',
]);
// Tarayicinin kesme belirteci (server_hub_scan.sh SH_JA_CUT_AWK): son belirtec '...+N'.
const KESIK_RE = /^\.\.\.\+(\d+)$/;

/** Tek belirteci (anahtar, deger) ciftine ayirir. */
function anahtarDeger(tok) {
  const s = String(tok);
  if (s.startsWith('-D')) {
    const eq = s.indexOf('=');
    return eq < 0 ? [s, ''] : [s.slice(0, eq), s.slice(eq + 1)];
  }
  if (s.startsWith('-XX:')) {
    const govde = s.slice(4);
    if (govde.startsWith('+') || govde.startsWith('-')) return [`-XX:${govde.slice(1)}`, govde[0]];
    const eq = govde.indexOf('=');
    return eq < 0 ? [s, ''] : [`-XX:${govde.slice(0, eq)}`, govde.slice(eq + 1)];
  }
  const xm = /^-X(ms|mx|ss|mn)(.*)$/.exec(s);
  if (xm) return [`-X${xm[1]}`, xm[2]];
  if (
    s.startsWith('-X') ||
    s.startsWith('-javaagent') ||
    s.startsWith('-agentlib') ||
    s.startsWith('-agentpath') ||
    s.startsWith('-verbose')
  ) {
    const c = s.indexOf(':');
    return c < 0 ? [s, ''] : [s.slice(0, c), s.slice(c + 1)];
  }
  if (s.startsWith('--')) {
    const eq = s.indexOf('=');
    return eq < 0 ? [s, ''] : [s.slice(0, eq), s.slice(eq + 1)];
  }
  return [s, ''];
}

/**
 * Arguman metni -> { h: Map(anahtar -> etkin deger), kesik: N|null, tekrarlar: [anahtar] }.
 * Tekrar eden anahtarda son deger etkindir (JVM / System property kurali); COK_DEGERLI bayraklar sirasiz birlesir.
 */
function argOzu(metin) {
  const tok = String(metin || '')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  let kesik = null;
  const km = tok.length ? KESIK_RE.exec(tok[tok.length - 1]) : null;
  if (km) {
    kesik = Number(km[1]);
    tok.pop();
  }
  const coklu = new Map();
  for (let i = 0; i < tok.length; i++) {
    let anahtar;
    let deger;
    if (DEGERLI_BAYRAK.has(tok[i]) && i + 1 < tok.length && !tok[i + 1].startsWith('-')) {
      anahtar = tok[i];
      deger = tok[i + 1];
      i++;
    } else {
      [anahtar, deger] = anahtarDeger(tok[i]);
    }
    if (!coklu.has(anahtar)) coklu.set(anahtar, []);
    coklu.get(anahtar).push(deger);
  }
  const h = new Map();
  const tekrarlar = [];
  for (const [k, v] of coklu) {
    if (v.length === 1) h.set(k, v[0]);
    else if (COK_DEGERLI.has(k)) h.set(k, [...v].sort(varsayilanSira).join(' | '));
    else {
      h.set(k, v[v.length - 1]);
      tekrarlar.push(k);
    }
  }
  return { h, kesik, tekrarlar };
}

module.exports = { anahtarDeger, argOzu, DEGERLI_BAYRAK, COK_DEGERLI, KESIK_RE };
