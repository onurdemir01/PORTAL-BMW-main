// src/__tests__/oco-prewarn.test.cjs — OP1..OP5 (2026-09-21).
//
// NE OLDU: Otomasyon'da OCO kontrolu yalnizca launch-ss'in `ocoRequired` yanitiyla, yani
// form doldurulup "Baslat"a basildiktan SONRA ortaya cikiyordu. Kullanici: "insanlar o
// yuzden en basta is tetiklemeye korkuyor". Cozum: survey yaniti kapi bilgisini (`gates`)
// tasir, form EN USTTE renkli bir seritle "bir sonraki adimda OCO sorulacak" der; secim
// prod'a donunce serit uyari tonuna gecer. Ayrica secili servis URL'de yasar
// (/self-service/nginx-rvp-operations).
//
// Bu testler kaynak duzeyinde kilit: serit form alanlarindan ONCE, kapi bilgisi HER IKI
// survey donusunde, slug rotasi App'te.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('OP1: survey rotasi kapi bilgisini (gates) HER IKI donuste de verir', () => {
  const src = read('server/ansible/runner.cjs');
  const start = src.indexOf("app.get('/api/ansible/survey/:serverId/:templateId'");
  assert.ok(start > 0);
  const end = src.indexOf('app.get(', start + 10);
  const route = src.slice(start, end);
  const gatesReturns = route.match(/templateId: req\.params\.templateId,\s*gates,/g) || [];
  assert.equal(gatesReturns.length, 2, 'ozel alanlar ve normal survey donuslerinin ikisi de gates tasimali');
  assert.match(route, /oco: !!overrides\.ocoCheck\?\.enabled/);
  assert.match(route, /smart: !!overrides\.smartApproval\?\.enabled/);
});

test('OP2: OCO on uyarisi form alanlarindan ONCE, yalniz form asamasinda', () => {
  const src = read('src/components/SelfServicePage.tsx');
  const banner = src.indexOf('data-testid="oco-prewarn"');
  const fields = src.indexOf('{visibleFields.map((f) => {');
  assert.ok(banner > 0 && fields > 0 && banner < fields, 'serit alanlardan once gelmeli');
  const guard = src.slice(src.lastIndexOf('{!loading', banner), banner);
  assert.match(guard, /!ocoState && ocoHint &&/, 'OCO paneli acikken / kapi yokken serit gosterilmez');
});

test('OP3: uyari tonu sunucu kurali ile ayni anahtar/degerleri kullanir (env|ortam = prod|production)', () => {
  const src = read('src/components/SelfServicePage.tsx');
  const { ENV_KEYS, PROD_VALUES } = require('../../server/oco/prod-detect.cjs');
  for (const k of ENV_KEYS) assert.ok(src.includes(`'${k}'`), `anahtar ${k} client kopyasinda yok`);
  for (const v of PROD_VALUES) assert.ok(src.includes(`'${v}'`), `deger ${v} client kopyasinda yok`);
  assert.match(src, /data-tone=\{ocoHint\.willAsk \? 'warning' : 'info'\}/);
});

test('OP4: servis basina URL — App rotasi ve slug uretimi', () => {
  assert.match(read('src/App.tsx'), /path="\/self-service\/:slug"/);
  const src = read('src/components/SelfServicePage.tsx');
  assert.match(src, /export function ssSlug\(/);
  assert.match(src, /navigate\(id === 'ansible' \? '\/self-service' : `\/self-service\/\$\{SLUG\[id\]\}`\)/);
});

test('OP5: AnsibleSection mount anindaki bos listeyi ust bilesene bildirmez (slug cozumu bozulmasin)', () => {
  const src = read('src/components/SelfServicePage.tsx');
  assert.match(src, /if \(loading\) return;\s*onItems\?\.\(/);
});
