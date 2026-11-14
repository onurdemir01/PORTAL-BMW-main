'use strict';

// Kontrol karakteri (C0/DEL, istege bagli C1, satir/paragraf ayirici ve
// gorunmez Unicode) tespiti ve temizligi. ESLint `no-control-regex` uyarisi ve
// gereksiz `eslint-disable` yorumlari olmadan ayni sinifi saglar.

const INVISIBLE_RE = /[\u200b-\u200f\u2060\ufeff]/;
const LINE_SEP_RE = /[\u2028\u2029]/;

/**
 * Verilen degerde kontrol karakteri olup olmadigini doner.
 * Varsayilan kapsam: ASCII C0 (0x00..0x1f) ve DEL (0x7f).
 */
function hasControlChars(value, opts = {}) {
  const s = String(value == null ? '' : value);
  const c1 = Boolean(opts.c1);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
    if (c1 && code >= 0x80 && code <= 0x9f) return true;
  }
  if (opts.lineSep && LINE_SEP_RE.test(s)) return true;
  if (opts.invisible && INVISIBLE_RE.test(s)) return true;
  return false;
}

/**
 * ASCII C0 (0x00..0x1f) ve DEL (0x7f) kontrol karakterlerini tek bosluga
 * cevirir (ardisik kontrol karakterleri tek bosluk olur).
 */
function replaceControlCharsWithSpace(value) {
  const s = String(value == null ? '' : value);
  let out = '';
  let inCtrl = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      if (!inCtrl) {
        out += ' ';
        inCtrl = true;
      }
    } else {
      out += s[i];
      inCtrl = false;
    }
  }
  return out;
}

module.exports = {
  hasControlChars,
  replaceControlCharsWithSpace,
};
