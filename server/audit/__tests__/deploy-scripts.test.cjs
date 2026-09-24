// server/audit/__tests__/deploy-scripts.test.cjs — Denetim > Deployment Scripts (2026-09-18):
// /vhosting[8]/HYSUXSCRIPTS/*.sh sha512 sapmasi. Init Script ile AYNI ekran ve yanit sekli;
// veri dbo.DeployScriptsInventory (uzun bicim). Kaynak-sozlesme testi: uc, sekme kapisi,
// sekme kaydi (UI + seed + erisim anahtarlari) birlikte var mi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('DS1 sunucu: /deploy-scripts ucu, uzun tablodan pivot, tab kapisi "deploy"', () => {
  const src = read('server/audit/denetim.cjs');
  assert.match(src, /router\.get\('\/deploy-scripts'/);
  assert.match(src, /dbo\.DeployScriptsInventory/);
  assert.ok(src.includes(String.raw`deploy-scripts(\/|$)/, 'deploy']`), 'TAB_OF_PATH deploy kapisi yok');
  // root parametresi SQL'e metin olarak DEGIL, bagli parametre olarak girer
  assert.match(src, /WHERE root = @root/);
  assert.match(src, /\[\{ name: 'root', type: sql\.NVarChar, value: root \}\]/);
  // Init ile ortak hesap
  // 2026-09-24: ucuncu parametre (majorityOverride) eklendi - GBEVM/GBPRV sunuculari GENEL
  // envanterin cogunluguna gore olculur. Init ve Deployment ekranlari ayni fonksiyonu paylasir.
  assert.match(src, /function scriptDeviationReport\(raw, scripts, majorityOverride\)/);
  assert.equal((src.match(/scriptDeviationReport\(/g) || []).length, 4, 'tanim + init(genel) + init(GBEVM/GBPRV) + deploy');
});

test('DS2 istemci: sekme, tip, liste, yardim bolumu, API', () => {
  const page = read('src/components/DenetimPage.tsx');
  assert.match(page, /\| 'deploy'/);
  assert.match(page, /'init', 'deploy',/);
  assert.match(page, /\{ id: 'deploy', label: 'Deployment Scripts'/);
  assert.ok(page.includes(`activeTab === 'deploy' && <ScriptsAudit kind="deploy" />`), 'deploy sekmesi render edilmiyor');
  assert.match(page, /title: 'Deployment Scripts Audit'/);
  const api = read('src/api/denetimApi.ts');
  assert.match(api, /deployScripts: \(root: string\)/);
  assert.match(api, /\/deploy-scripts\?root=/);
});

test('DS3 erisim: seed tab:denetim:deploy + DENETIM_TAB_KEYS', () => {
  assert.match(read('server/db/mssql-setup.cjs'), /element_key: 'tab:denetim:deploy'/);
  assert.match(read('server/auth/visibility-routes.cjs'), /'init', 'deploy', 'routetraffic', 'envanter'/);
});

test('DS4 Ansible job dosyalari repo icinde belgelenmis (tablo adi ve CSV sozlesmesi ayni)', () => {
  // Portal tablo adi ile Ansible loader'in tablo adi AYNI olmali (iki repo, tek sozlesme)
  const ans = 'C:/Users/demir/Downloads/Compressed/gar_bmt_ansible_scripts/bmw_wds_scripts/deployment_scripts';
  if (!fs.existsSync(ans)) return; // baska makinede Ansible deposu yoksa atla
  const loader = fs.readFileSync(path.join(ans, 'files', 'deployment_scripts_inventory.py'), 'utf8');
  assert.match(loader, /dbo\.DeployScriptsInventory/);
  assert.match(loader, /scan_date, host, root, script, sha512, size_bytes, mtime/);
  assert.doesNotMatch(loader, /PWD=[A-Za-z0-9]{8,}/, 'loader parola icermemeli');
});
