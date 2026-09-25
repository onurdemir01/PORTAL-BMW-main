// server/nginx-console/__tests__/seen.test.cjs — "Cogu sunucu Offline" (2026-09-22).
//
// fetch playbook'u parmak izi degismeyen sunucuda dokumu yeniden yazmaz; Portal "online"i
// dokum mtime'indan turetiyordu -> konfigurasyonu degismeyen her sunucu Offline gorunuyordu.
// Simdi raw/_seen.json ({at, hosts:{HOST: iso}}) okunur, son gorulme = max(dokum, seen).
// Ayrica: dump betigi nginx -t'yi estate standardiyla (dzdo, -e /web_log/error.log) kosar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-seen-'));
fs.mkdirSync(path.join(dir, 'raw'));
process.env.NGINX_CONSOLE_DIR = dir;
const nc = require('../index.cjs');
const seenAtOf = nc._seenAtOfForTest;
const seenMap = nc._seenMapForTest;
const seenPath = path.join(dir, 'raw', '_seen.json');

test('SEEN1 _seen.json yokken son gorulme = dokum mtime; dokum da yoksa null', () => {
  assert.equal(seenAtOf('GBNGXP40', null), null);
  assert.equal(seenAtOf('GBNGXP40', '2026-09-20T01:00:00.000Z'), '2026-09-20T01:00:00.000Z');
});

test('SEEN2 host bazli kayit: seen > dokum ise seen; baska host etkilenmez; kucuk harf host', () => {
  fs.writeFileSync(seenPath, JSON.stringify({ at: '2026-09-22T02:00:00Z', hosts: { GBNGXP40: '2026-09-22T02:00:00Z', gbngxp41: '2026-09-21T02:00:00Z' } }));
  assert.equal(seenAtOf('GBNGXP40', '2026-09-20T01:00:00.000Z'), '2026-09-22T02:00:00.000Z');
  assert.equal(seenAtOf('gbngxp41', null), '2026-09-21T02:00:00.000Z');
  // dokum daha yeni ise dokum kazanir
  assert.equal(seenAtOf('GBNGXP41', '2026-09-22T05:00:00.000Z'), '2026-09-22T05:00:00.000Z');
  assert.equal(seenAtOf('GBNGXP99', null), null);
  assert.equal(seenMap().at, '2026-09-22T02:00:00.000Z');
});

test('SEEN3 dosya degisince yeniden okunur (mtime); eski liste bicimi (hosts: []) da kabul', async () => {
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(seenPath, JSON.stringify({ at: '2026-09-23T02:00:00Z', hosts: ['GBNGXP50'] }));
  const now = new Date(); fs.utimesSync(seenPath, now, now);
  assert.equal(seenAtOf('GBNGXP50', null), '2026-09-23T02:00:00.000Z');
  assert.equal(seenAtOf('GBNGXP40', null), null, 'yeni dosyada olmayan host dusmeli');
});

test('SEEN4 bozuk JSON: hata firlatmaz, yalniz dokum mtime kullanilir', async () => {
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(seenPath, '{bozuk');
  const now = new Date(); fs.utimesSync(seenPath, now, now);
  assert.equal(seenAtOf('GBNGXP50', '2026-09-01T00:00:00.000Z'), '2026-09-01T00:00:00.000Z');
});

test('SEEN5 playbook _seen.json yazar (birlestirerek) ve dump betigi nginx -t\'yi dzdo + -e ile kosar', () => {
  const pb = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'bmw_portal', 'nginx_console', 'nginx_console_fetch.yml'), 'utf8');
  assert.ok(pb.includes("/raw/_seen.json"), 'playbook _seen.json yazmali');
  assert.ok(/ansible\.builtin\.slurp:[\s\S]*_seen\.json/.test(pb), 'once mevcut dosya okunmali (secili yenileme digerlerini silmesin)');
  assert.ok(/combine\(seen_new\)/.test(pb), 'onceki kayitlarla birlestirilmeli');
  assert.ok(/selectattr\('ok'\)/.test(pb.slice(pb.indexOf('seen_hosts:'))), 'yalniz ulasilan (ok) hostlar yazilmali');
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'bmw_portal', 'nginx_console', 'files', 'nginx_console_dump.sh'), 'utf8');
  assert.ok(/dzdo -n "\$\{NGINX_T_CMD\[@\]\}"/.test(sh), 'nginx -t dzdo ile kosmali (estate standardi)');
  assert.ok(/-e "\$\{NGINX_ERRLOG:-\/web_log\/error\.log\}" -t/.test(sh), 'nginx -t -e /web_log/error.log ile kosmali');
  assert.ok(/elif out="\$\("\$\{NGINX_T_CMD\[@\]\}" 2>&1\)"/.test(sh), 'dzdo olmazsa eski yol denenmeli');
});

test('SEEN6 Nginx Hub UI: Online = son gorulme (seenAt), Denetim nginx sekmeleri Hub\'da, seed temiz', () => {
  const nim = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'NimTabs.tsx'), 'utf8');
  assert.ok(/export function lastSeen\(h: NcHost\)/.test(nim) && /const s = lastSeen\(h\);/.test(nim), 'isOnline lastSeen uzerinden olmali');
  assert.ok(nim.includes('Production: Pendik / Ankara') && nim.includes('title="Kaynaklar"'), 'Dashboard kaynak + lokasyon kartlari');
  assert.ok(/<Th>Son görülme<\/Th><Th>Son dokum<\/Th>/.test(nim), 'Instances: son gorulme ve son dokum ayri sutun');
  const hub = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'nginx_console', 'NginxConsolePage.tsx'), 'utf8');
  // Kapi (canSee) arada olabilir: sekmenin BIR BILESEN actigini dogrula, yazimini degil.
  for (const id of ['spa', 'api', 'envanter', 'audit']) {
    assert.ok(new RegExp(`\\{tab === '${id}'[\\s\\S]{0,80}<`).test(hub), `Hub sekmesi yok: ${id}`);
  }
  const den = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'DenetimPage.tsx'), 'utf8');
  assert.ok(!/id: 'nginx(api|env|audit)?'/.test(den), 'Denetim sekme cubugunda nginx kalmamali');
  assert.ok(/export function NginxSpaAudit\(\)/.test(den) && /export const NGINX_DENETIM_HELP/.test(den), 'NginxSpaAudit + yardim export');
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.ok(!/element_key: 'tab:denetim:nginx/.test(setup), 'tab:denetim:nginx* seed\'i kalmamali');
  assert.ok(/await removeMovedDenetimTabs\(pool\)/.test(setup), 'eski satirlar acilista silinmeli');
  const gate = fs.readFileSync(path.join(__dirname, '..', '..', 'audit', 'denetim.cjs'), 'utf8');
  // Kural ayni, YAZIMI degisti (ic ice sekme kapisi eklendi): metin yerine ANLAM aranir.
  const i = gate.indexOf('NGINX_PATH.test(req.path)');
  assert.ok(i > 0, 'nginx denetim uclari icin ayri yol suzgeci yok');
  assert.match(gate.slice(i, i + 400), /requireVisible\('NginxConsole'\)/,
    'nginx denetim uclari NginxConsole sayfa kapisiyla');
  const vis = fs.readFileSync(path.join(__dirname, '..', '..', 'auth', 'visibility-routes.cjs'), 'utf8');
  assert.ok(!/DENETIM_TAB_KEYS = \[[^\]]*'nginx'/.test(vis), 'Denetim Erisimi listesinde nginx kalmamali');
});
