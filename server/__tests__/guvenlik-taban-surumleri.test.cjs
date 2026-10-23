// server/__tests__/guvenlik-taban-surumleri.test.cjs
//
// GUVENLIK TABAN SURUMLERI (2026-10-23).
//
// Depo paralel gelistiriliyor ve package-lock.json sik sik baska dallardan birlesiyor; eski
// bir kilit dosyasi yamali surumu sessizce geri alabilir. Bu bekci, bilinen acigi olan
// paketlerin KILITTEKI her kopyasinin yamali surumde ya da ustunde oldugunu dogrular.
//
//   GT1 kilitteki her kopya taban surumde ya da ustunde (ic ice kopyalar dahil)
//   GT2 nodeGuvenlikDurumu: Ekim 2026 Node yayini tabani (22.23.4 / 24.22.1 / 26.12.1);
//       20 ve tek sayili hatlar destek disi; tablodan yeni hat uyari vermez
//   GT3 acilis satiri Node surumunu yazar ve taban altindaysa [Guvenlik] uyarisi verir
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { nodeGuvenlikDurumu, YAMALI } = require('../node-guvenlik.cjs');

const ROOT = path.join(__dirname, '..', '..');

// Paket -> ilk yamali surum ve gerekce (GHSA kimligi). Yalnizca YUKSELTILIR.
const TABAN = {
  // Calisma zamani
  compression: ['1.8.2', 'GHSA-vc2v-76pw-4v95: kopan yanitta zlib bellegi sizar (oturumsuz DoS)'],
  'proxy-addr': ['2.0.8', 'GHSA-jqcg-44mw-7w3h: IPv4-mapped IPv6 guven alt agi ile IP sahteciligi'],
  'body-parser': ['2.3.0', 'GHSA-v422-hmwv-36x6: gecersiz limit boyut sinirini kapatir'],
  qs: ['6.16.0', 'GHSA-4mjr-xmp4-gh2g / GHSA-x5fp-wj9c-mxmx: DoS, dizi siniri atlatma'],
  '@modelcontextprotocol/sdk': [
    '1.32.0',
    'GHSA-6prh-2h8m-c8cw: capraz koken yonlendirmede ozel basliklari (Dynatrace belirteci) yeniden gonderir',
  ],
  'fast-uri': ['3.1.8', 'GHSA-f65p-4m7j-42xc ve digerleri: host karisikligi / SSRF'],
  'ip-address': ['10.7.4', 'GHSA-rxp7-6hxx-x8q5 ve digerleri: SSRF siniflandirma, DoS'],
  hono: ['4.13.11', 'GHSA-5r4p-p66f-jhc7 ve digerleri'],
  '@hono/node-server': ['1.19.15', 'GHSA-frvp-7c67-39w9'],
  'react-router': ['7.18.2', 'GHSA-qwww-vcr4-c8h2'],
  'react-router-dom': ['7.18.2', 'GHSA-qwww-vcr4-c8h2'],
  // Derleme / gelistirme: uretim sunucusunda da `npm ci` + `vite build` ile kurulur;
  // gelistirme sunucusu 0.0.0.0'da dinler (vite.config.ts).
  vite: ['6.4.4', 'GHSA-rq7h-c2jc-7f22: server.fs.allow disindaki dosyalar sunulabilir'],
  vitest: ['5.0.3', 'GHSA-qxg6-89mg-rqv8'],
  postcss: ['8.5.23', 'GHSA-fxqj-rqcc-2cmp: sourceMappingURL ile .map dosyasi okuma'],
};

function parcala(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(String(v));
  if (!m) return null;
  return { n: [Number(m[1]), Number(m[2]), Number(m[3])], on: m[4] || '' };
}

/** a >= b (on surum, ayni cekirdekteki surumden kucuk sayilir). */
function buyukEsit(a, b) {
  const x = parcala(a);
  const y = parcala(b);
  assert.ok(x && y, `surum okunamadi: ${a} / ${b}`);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i];
  if (x.on && !y.on) return false;
  return true;
}

test('GT1 kilitteki her kopya guvenlik tabaninda', () => {
  const kilit = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const bulunan = {};
  const eksikler = [];
  for (const [yol, bilgi] of Object.entries(kilit.packages || {})) {
    if (!yol) continue;
    const ad = yol.replace(/^.*node_modules\//, '');
    if (!TABAN[ad]) continue;
    bulunan[ad] = (bulunan[ad] || 0) + 1;
    const [taban, neden] = TABAN[ad];
    if (!buyukEsit(bilgi.version, taban))
      eksikler.push(`${yol}@${bilgi.version} < ${taban} (${neden})`);
  }
  assert.deepEqual(eksikler, [], `yamasiz kopya:\n${eksikler.join('\n')}`);
  // Bekci kor kalmasin: listedeki her paket kilitte gercekten var.
  for (const ad of Object.keys(TABAN))
    assert.ok(bulunan[ad] > 0, `${ad} kilitte yok - liste eskidi mi?`);
});

test('GT1b karsilastirma kendisi dogru', () => {
  assert.equal(buyukEsit('1.8.2', '1.8.2'), true);
  assert.equal(buyukEsit('1.8.1', '1.8.2'), false);
  assert.equal(buyukEsit('1.10.0', '1.8.2'), true);
  assert.equal(buyukEsit('2.0.0', '10.7.4'), false);
  assert.equal(buyukEsit('1.8.2-beta.1', '1.8.2'), false);
});

test('GT2 nodeGuvenlikDurumu', () => {
  const ok = (v) => nodeGuvenlikDurumu(v).ok;
  for (const v of [
    'v22.23.4',
    'v22.24.0',
    'v24.22.1',
    'v24.23.0',
    'v26.12.1',
    'v26.13.0',
    '26.12.1',
    'v27.0.0',
  ]) {
    assert.equal(ok(v), true, `yamali sayilmali: ${v}`);
  }
  for (const v of [
    'v22.23.3',
    'v22.9.0',
    'v24.22.0',
    'v24.1.0',
    'v26.0.0',
    'v26.12.0',
    'v20.20.2',
    'v20.18.0',
    'v18.20.0',
    'v23.11.0',
    'v25.9.0',
    'tuhaf',
  ]) {
    assert.equal(ok(v), false, `yamasiz sayilmali: ${v}`);
  }
  assert.match(nodeGuvenlikDurumu('v20.20.2').mesaj, /destek disi/);
  assert.match(nodeGuvenlikDurumu('v24.22.0').mesaj, /En az 24\.22\.1 gerekir/);
  assert.deepEqual(Object.keys(YAMALI).sort(), ['22', '24', '26']);
  // Uyari log satirina gider: lint:ascii (console satirlarinda Turkce harf yok).
  for (const v of ['v20.20.2', 'v22.1.0', 'bozuk']) {
    assert.doesNotMatch(nodeGuvenlikDurumu(v).mesaj, /[çğıöşüÇĞİÖŞÜ]/, v);
  }
});

test('GT3 acilis satiri Node surumunu yazar ve tabani denetler', () => {
  const kaynak = fs.readFileSync(path.join(ROOT, 'server', 'index.cjs'), 'utf8');
  const dinle = kaynak.indexOf('app.listen(PORT');
  assert.ok(dinle > 0, 'app.listen bulunamadi');
  const blok = kaynak.slice(dinle, kaynak.indexOf('});', dinle));
  assert.match(blok, /node=\$\{process\.version\}/, 'acilis satiri Node surumunu yazmiyor');
  assert.match(blok, /nodeGuvenlikDurumu\(\)/, 'acilista Node tabani denetlenmiyor');
  assert.match(
    blok,
    /if \(!nodeDurumu\.ok\) console\.warn\(`\[Guvenlik\] \$\{nodeDurumu\.mesaj\}`\)/,
  );
});
