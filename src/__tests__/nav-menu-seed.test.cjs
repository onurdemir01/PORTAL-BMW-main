// src/__tests__/nav-menu-seed.test.cjs — sol menu UC YERDE birden tanimli.
//
// 2026-09-28, GERCEK OLAY: "OCO Takvimi" sayfasi eklendi; DB seed'i (ELEMENT_SEED),
// App.tsx route'u ve gorunurluk kurallari yazildi — ama src/config/elements.ts'teki
// PAGES listesine EKLENMEDI. Sonuc: sayfa /oco-takvimi adresinden ACILIYOR, DB'de
// kayitli, Admin > Sayfa Erisimi'nde gorunuyor; SOL MENUDE HIC YOK.
//
// Sebep PageNav.tsx'te: menu ogeleri `PAGES` listesinden turuyor
//     const ALL_NAV_ITEMS = PAGES.map(...)
// DB'den gelen nav gruplari yalnizca GRUPLAMAYI/SIRAYI belirliyor; PAGES'te karsiligi
// olmayan bir anahtar `itemById.get(id)` ile eslesmedigi icin SESSIZCE dusuyor.
// Yani eksik satir ne derleme, ne test, ne de calisma zamani hatasi uretiyor.
//
// Bu bekci o sessizligi kaldirir: DB'ye seed edilen her SAYFA, frontend PAGES listesinde
// ve bir nav grubunda da olmak zorunda.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Tirnak bicimi ONEMSIZ: prettier tek/cift tirnagi degistirdiginde bekci kirmiziya
// donmemeli (2026-09-28'de dokuz bekci tam bu yuzden kirilmisti).
const norm = (s) => s.replace(/"/g, "'");

/** `const <ad> = [` ile baslayan dizinin GOVDESI (kapanis parantezine kadar). */
function diziGovdesi(src, ad) {
  // TS tip aciklamasi araya girebilir: `export const PAGES: PageElement[] = [`.
  const m = new RegExp(`\\b${ad}\\b[^=\\n]*=\\s*\\[`).exec(src);
  assert.ok(m, `${ad} bulunamadi`);
  let i = src.indexOf('[', m.index + m[0].length - 1);
  let derinlik = 0;
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    if (c === '[') derinlik += 1;
    else if (c === ']') {
      derinlik -= 1;
      if (derinlik === 0) return src.slice(i + 1, j);
    }
  }
  throw new Error(`${ad} dizisi kapanmiyor`);
}

/** Dizi govdesindeki UST SEVIYE `{...}` girdileri (ic ice suslu parantezler dahil). */
function girdiler(govde) {
  const out = [];
  let derinlik = 0;
  let bas = -1;
  for (let i = 0; i < govde.length; i += 1) {
    const c = govde[i];
    if (c === '{') {
      if (derinlik === 0) bas = i;
      derinlik += 1;
    } else if (c === '}') {
      derinlik -= 1;
      if (derinlik === 0) out.push(govde.slice(bas, i + 1));
    }
  }
  return out;
}

const alan = (blok, ad) => {
  const m = new RegExp(`${ad}:\\s*'([^']*)'`).exec(blok);
  return m ? m[1] : null;
};

/** ELEMENT_SEED'deki sayfa ogeleri: {key, parent, route}. */
function seedSayfalari() {
  const src = norm(read('server/db/mssql-setup.cjs'));
  return girdiler(diziGovdesi(src, 'ELEMENT_SEED'))
    .filter((b) => /element_type:\s*'page'/.test(b))
    .map((b) => ({
      key: alan(b, 'element_key'),
      parent: alan(b, 'parent_key'),
      route: alan(b, 'route'),
    }));
}

/** elements.ts PAGES: {id, route}. */
function frontendSayfalari() {
  const src = norm(read('src/config/elements.ts'));
  return girdiler(diziGovdesi(src, 'PAGES')).map((b) => ({
    id: alan(b, 'id'),
    route: alan(b, 'route'),
  }));
}

/** elements.ts NAV_GROUPS: id -> itemIds[]. */
function navGruplari() {
  const src = norm(read('src/config/elements.ts'));
  const m = new Map();
  for (const b of girdiler(diziGovdesi(src, 'NAV_GROUPS'))) {
    const id = alan(b, 'id');
    const liste = /itemIds:\s*\[([^\]]*)\]/.exec(b);
    const ogeler = liste ? [...liste[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
    if (id) m.set(id, ogeler);
  }
  return m;
}

test('NM1: DB seed edilen her sayfa frontend PAGES listesinde AYNI route ile var', () => {
  const front = new Map(frontendSayfalari().map((p) => [p.id, p.route]));
  for (const s of seedSayfalari()) {
    assert.ok(
      front.has(s.key),
      `"${s.key}" DB'ye seed ediliyor ama src/config/elements.ts PAGES listesinde YOK — ` +
        `sayfa adresten acilir, SOL MENUDE GORUNMEZ (PageNav ALL_NAV_ITEMS'i PAGES'ten turetir).`,
    );
    assert.equal(
      front.get(s.key),
      s.route,
      `"${s.key}" route'u iki yerde farkli: seed=${s.route}, elements.ts=${front.get(s.key)}`,
    );
  }
});

test('NM2: her sayfa, seed parent_key ile AYNI nav grubunda listeli', () => {
  const gruplar = navGruplari();
  for (const s of seedSayfalari()) {
    if (!s.parent || !s.parent.startsWith('navgroup:')) continue;
    const grup = s.parent.replace(/^navgroup:/, '');
    const ogeler = gruplar.get(grup);
    assert.ok(ogeler, `"${s.key}" icin nav grubu "${grup}" elements.ts'te YOK`);
    assert.ok(
      ogeler.includes(s.key),
      `"${s.key}" NAV_GROUPS "${grup}" grubunda YOK — DB'ye ulasilamazsa (fallback yolu) ` +
        `menuden duser ve sebebi hicbir yerde gorunmez.`,
    );
  }
});

test('NM3: PAGES icindeki her route App.tsx te bagli', () => {
  const app = norm(read('src/App.tsx'));
  for (const p of frontendSayfalari()) {
    assert.match(
      app,
      new RegExp(`path='${p.route.replace(/\//g, '\\/')}'`),
      `"${p.id}" menude var ama App.tsx'te ${p.route} route'u YOK — tiklayinca bos sayfa.`,
    );
  }
});

test('NM4: OCO Takvimi UC YERDE de kayitli (2026-09-28 olayinin kendisi)', () => {
  assert.ok(
    seedSayfalari().some((s) => s.key === 'OcoTakvimi'),
    'ELEMENT_SEED',
  );
  assert.ok(
    frontendSayfalari().some((p) => p.id === 'OcoTakvimi'),
    'elements.ts PAGES',
  );
  assert.match(norm(read('src/App.tsx')), /path='\/oco-takvimi'/, 'App.tsx route');
});
