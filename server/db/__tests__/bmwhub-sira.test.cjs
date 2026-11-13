// server/db/__tests__/bmwhub-sira.test.cjs - BH1..BH3 (2026-11-13).
//
// Kullanici: "Reboot Kontrolu ile Retirement'i BMW Hub'a eklemeni istemistim" - iki sayfa BMW Hub grubunda Acik
// Isler'in HEMEN ALTINDA. Seed yalniz eksik satiri ekler; mevcut kurulumda Envanter=2, Denetim=3 ... dolu oldugu
// icin tek seferlik placeBmwHubFlowPages() sirayi kaydirir.
//   BH1 mevcut kurulum: Acik Isler'den sonraki sayfalar 2 kayar, yeni iki sayfa araya girer; isaret yazilir
//   BH2 isaret varsa hicbir sey yapmaz (tek seferlik; adminin sonraki duzeni ezilmez)
//   BH3 yeni sayfa grupta yoksa (seed basarisiz / admin tasidi) dokunmaz ve isaret YAZMAZ (sonraki aciliste dener)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { _placeBmwHubFlowPages } = require('../mssql-setup.cjs');

// portal_elements + portal_config_blobs icin kucuk bellek ici sahte (yalniz bu fonksiyonun SQL kaliplari).
function sahteHavuz(satirlar, isaretler = new Set()) {
  const yaz = [];
  return {
    satirlar,
    isaretler,
    yaz,
    request() {
      const p = {};
      return {
        input(k, v) { p[k] = v; return this; },
        async query(sql) {
          const s = String(sql).replace(/\s+/g, ' ').trim();
          if (s.startsWith('SELECT 1 FROM portal_config_blobs')) return { recordset: isaretler.has(p.n) ? [{ x: 1 }] : [] };
          if (s.startsWith('INSERT INTO portal_config_blobs')) { isaretler.add(p.n); return { recordset: [] }; }
          if (s.startsWith('SELECT element_key, sort_order FROM portal_elements')) {
            return { recordset: satirlar.filter((r) => r.parent_key === 'navgroup:bmwhub' && r.element_type === 'page').map((r) => ({ element_key: r.element_key, sort_order: r.sort_order })) };
          }
          if (s.startsWith('UPDATE portal_elements SET sort_order = sort_order + 2')) {
            yaz.push('kaydir');
            for (const r of satirlar) {
              if (r.parent_key === 'navgroup:bmwhub' && r.element_type === 'page' && !['BmwHub', 'RebootKontrolu', 'Retirement'].includes(r.element_key) && r.sort_order > p.t) r.sort_order += 2;
            }
            return { recordset: [] };
          }
          if (s.startsWith('UPDATE portal_elements SET sort_order = @o WHERE element_key = @k')) {
            yaz.push(`yerlestir:${p.k}`);
            for (const r of satirlar) if (r.element_key === p.k && r.parent_key === 'navgroup:bmwhub') r.sort_order = p.o;
            return { recordset: [] };
          }
          throw new Error(`beklenmeyen SQL: ${s}`);
        },
      };
    },
  };
}

const sayfa = (element_key, sort_order, parent_key = 'navgroup:bmwhub') => ({ element_key, sort_order, parent_key, element_type: 'page' });
const sira = (h) =>
  h.satirlar
    .filter((r) => r.parent_key === 'navgroup:bmwhub')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => r.element_key);

test('BH1 mevcut kurulum: yeni iki sayfa Acik Isler in hemen altina girer, goreli sira korunur', async () => {
  const h = sahteHavuz([
    sayfa('BmwHub', 1), sayfa('Envanter', 2), sayfa('Denetim', 3), sayfa('Nöbet', 4), sayfa('OcoTakvimi', 5),
    sayfa('IpSorgu', 6), sayfa('OcpSorgu', 7), sayfa('YukTesti', 8), sayfa('RebootKontrolu', 2), sayfa('Retirement', 3),
    sayfa('LogX', 1, 'navgroup:otomasyon'),
  ]);
  await _placeBmwHubFlowPages(h);
  assert.deepEqual(sira(h), ['BmwHub', 'RebootKontrolu', 'Retirement', 'Envanter', 'Denetim', 'Nöbet', 'OcoTakvimi', 'IpSorgu', 'OcpSorgu', 'YukTesti']);
  assert.equal(new Set(h.satirlar.filter((r) => r.parent_key === 'navgroup:bmwhub').map((r) => r.sort_order)).size, 10, 'esit sira kaldi');
  assert.equal(h.satirlar.find((r) => r.element_key === 'LogX').sort_order, 1, 'baska grup degisti');
  assert.equal(h.isaretler.size, 1);
});

test('BH2 isaret varsa dokunmaz', async () => {
  const h = sahteHavuz([sayfa('BmwHub', 1), sayfa('Envanter', 2), sayfa('RebootKontrolu', 9), sayfa('Retirement', 10)], new Set(['migration:bmwhub-reboot-retirement-sira-2026-11-13']));
  await _placeBmwHubFlowPages(h);
  assert.deepEqual(h.yaz, []);
  assert.deepEqual(sira(h), ['BmwHub', 'Envanter', 'RebootKontrolu', 'Retirement']);
});

test('BH3 yeni sayfa grupta yoksa dokunmaz, isaret yazmaz', async () => {
  const h = sahteHavuz([sayfa('BmwHub', 1), sayfa('Envanter', 2), sayfa('RebootKontrolu', 2), sayfa('Retirement', 3, 'navgroup:serverhub')]);
  await _placeBmwHubFlowPages(h);
  assert.deepEqual(h.yaz, []);
  assert.equal(h.isaretler.size, 0);
});
