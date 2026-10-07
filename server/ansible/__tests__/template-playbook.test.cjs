// server/ansible/__tests__/template-playbook.test.cjs — TP1..TP5 (2026-10-08 uretim olayi).
//
// Retirement'in vhost kapatma isi (server_hub_fix) AWX'te "App Retirement - GERI AL"
// playbook'unu kosturdu (job 3386869): Playbook Kayitlari'nda `server_hub_fix` satirina rollback
// sablonunun ID'si girilmisti. Playbook girdi kontrolunde durdu; ama yanlis eslenmis bir sablon
// baska bir isin degiskenleriyle baska bir isi KOSTURUR. Portal artik baslatmadan once sablonun
// GERCEKTE hangi playbook'u kosturdugunu dogrular.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function yukle(sablonlar) {
  const runnerPath = require.resolve('../runner.cjs');
  const prePath = require.resolve('../template-preflight.cjs');
  const saved = require.cache[runnerPath];
  require.cache[runnerPath] = new Module(runnerPath, null);
  require.cache[runnerPath].exports = {
    getServers: () => [{ id: 1 }],
    listTemplatesForServer: async () => { if (sablonlar instanceof Error) throw sablonlar; return sablonlar; },
  };
  require.cache[runnerPath].loaded = true;
  delete require.cache[prePath];
  const m = require('../template-preflight.cjs');
  return { m, restore: () => { if (saved) require.cache[runnerPath] = saved; else delete require.cache[runnerPath]; delete require.cache[prePath]; } };
}
const T = (id, playbook, name = `tpl${id}`) => ({ id, name, playbook, ask_variables: true });

test('TP1 OLAYIN KENDISI: server_hub_fix satirinda rollback sablonu -> RED (409), is baslatilmaz', async () => {
  const { m, restore } = yukle([T(77, 'bmw_automation_folder/app_retirement/app_retirement_rollback.yml', 'App Retirement - Geri Al')]);
  try {
    await assert.rejects(() => m.assertRegistryPlaybook(1, 77, 'server_hub_fix'), (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, 'awx_template_playbook_mismatch');
      assert.match(e.message, /app_retirement_rollback\.yml/);
      assert.match(e.message, /server_hub_fix\.yml/);
      return true;
    });
  } finally { restore(); }
});

test('TP2 dogru sablon GECER; dizin farki onemsiz (yalniz dosya adi), kasa duyarsiz', async () => {
  const { m, restore } = yukle([T(5, 'baska/proje/dizini/Server_Hub_Fix.yml')]);
  try { await m.assertRegistryPlaybook(1, 5, 'server_hub_fix'); } finally { restore(); }
});

test('TP3 FAIL-OPEN: metadata okunamaz / sablon yok / playbook alani bos -> engellemez', async () => {
  for (const s of [new Error('awx yok'), [], [T(5, '')]]) {
    const { m, restore } = yukle(s);
    try { await m.assertRegistryPlaybook(1, 5, 'server_hub_fix'); } finally { restore(); }
  }
});

test('TP4 eslemede olmayan anahtar KONTROL EDILMEZ; retirement/server hub anahtarlarinin hepsi eslemede', async () => {
  const { m, restore } = yukle([T(5, 'x.yml')]);
  try {
    await m.assertRegistryPlaybook(1, 5, 'bilinmeyen_anahtar');
    for (const k of ['app_retirement_stop', 'app_retirement_delete', 'app_retirement_rollback', 'server_hub_scan', 'server_hub_fix'])
      assert.equal(m.BEKLENEN_PLAYBOOK[k], `${k}.yml`, `${k} eslemede yok`);
  } finally { restore(); }
});

test('TP5 HER baslatma noktasi korumayi isi baslatmadan ONCE cagirir', () => {
  const kaynak = (p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  const noktalar = [
    ...[...kaynak(['retirement', 'index.cjs']).matchAll(/assertRegistryPlaybook\([\s\S]{0,400}?launchJobOnServer\(/g)],
    ...[...kaynak(['server-hub', 'index.cjs']).matchAll(/assertRegistryPlaybook\([\s\S]{0,400}?launchJobOnServer\(/g)],
  ];
  assert.equal(noktalar.length, 4, `korunan baslatma noktasi sayisi ${noktalar.length} (beklenen 4: retirement launch, web kapat, web geri ac, server hub launch)`);
  const ri = kaynak(['retirement', 'index.cjs']);
  assert.equal((ri.match(/launchJobOnServer\(/g) || []).length, 3, 'retirement\'ta korumasiz yeni bir baslatma noktasi eklenmis olabilir');
});
