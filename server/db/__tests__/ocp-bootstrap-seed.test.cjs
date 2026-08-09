// server/db/__tests__/ocp-bootstrap-seed.test.cjs — OCP katalogu bir-kerelik ilk kurulumu.
// EN KRITIK GARANTILER: (1) isaret varsa seed HIC calismaz (admin'in sildigi cluster geri
// gelmez), (2) var olan satira DOKUNULMAZ, (3) yeni satirlar PASIF gelir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../index.cjs');
const settings = require('../settings.cjs');
const seed = require('../ocp-bootstrap-seed.cjs');

// ── parseInventoryKey: kullanicinin verdigi gercek anahtarlar ──────────────────

test('parseInventoryKey(): son alt cizgi env, oncesi tenant', () => {
  assert.deepEqual(seed.parseInventoryKey('ark_prod'), { tenant: 'ark', env: 'prod' });
  assert.deepEqual(seed.parseInventoryKey('hosting_dev'), { tenant: 'hosting', env: 'dev' });
});

test('parseInventoryKey(): tenant icinde tire/alt cizgi olabilir', () => {
  assert.deepEqual(seed.parseInventoryKey('istirak-hosting_prod'), { tenant: 'istirak-hosting', env: 'prod' });
  assert.deepEqual(seed.parseInventoryKey('metaco_das_test'), { tenant: 'metaco_das', env: 'test' });
  assert.deepEqual(seed.parseInventoryKey('digital_assets_wyden_qa'), { tenant: 'digital_assets_wyden', env: 'qa' });
});

test('parseInventoryKey(): alt cizgisiz anahtar kendi ortami olur (cicd)', () => {
  assert.deepEqual(seed.parseInventoryKey('cicd'), { tenant: 'cicd', env: 'cicd' });
});

test('parseInventoryKey(): bozuk girdilerde patlamaz', () => {
  assert.deepEqual(seed.parseInventoryKey(''), { tenant: '', env: '' });
  assert.deepEqual(seed.parseInventoryKey('_prod'), { tenant: '_prod', env: '_prod' }, 'basta alt cizgi → bolme yok');
  assert.deepEqual(seed.parseInventoryKey('ark_'), { tenant: 'ark_', env: 'ark_' }, 'sonda alt cizgi → bolme yok');
});

// ── buildSeedRows: envanterden satir uretimi ──────────────────────────────────

test('buildSeedRows(): her cluster api_url + credential anahtari tasir, PAROLA YOK', () => {
  const rows = seed.buildSeedRows();
  // KESIN sayi: envanterin yarisi silinse 'rows.length > 40' testi yine gecerdi.
  assert.equal(rows.length, 62, 'envanterdeki (tenant_env, cluster) ciftlerinin TAMAMI uretilmeli');
  const keys = new Set(rows.map((r) => `${r.env}|${r.tenant}|${r.cluster_name}`));
  assert.equal(keys.size, rows.length, 'UNIQUE(env,tenant,cluster_name) ile cakisma OLMAMALI');
  for (const r of rows) {
    assert.ok(r.api_url.startsWith('https://api.'), `api_url bekleniyor: ${r.cluster_name}`);
    assert.ok(r.vault_credential_key, `credential anahtari bekleniyor: ${r.cluster_name}`);
    assert.ok(!('password' in r), 'PAROLA asla seed verisinde olmamali');
  }
});

test('buildSeedRows(): cluster-ozel jump server varsa tasinir, yoksa NULL (yedege duser)', () => {
  const rows = seed.buildSeedRows();
  const prod1 = rows.find((r) => r.cluster_name === 'gbocpprod1');
  assert.equal(prod1.terminal_host, 'gbarkp51', 'kullanicinin verdigi esleme uygulanmali');
  assert.equal(prod1.tenant, 'ark');
  assert.equal(prod1.env, 'prod');

  const test1 = rows.find((r) => r.cluster_name === 'gbocptest1');
  assert.equal(test1.terminal_host, null, 'eslemesi olmayan cluster NULL kalmali (tenant/env yedegi devreye girer)');
});

test('buildSeedRows(): her satir `oc login` kullanici adini tasir', () => {
  // Bu alan YOKKEN playbook degeri yalnizca AWX'teki openshift_inventory_vars.yaml'dan
  // okuyabiliyordu; o dosya AWX'te olmadigi icin 2026-08-09'da tum cluster'lar dustu.
  const rows = seed.buildSeedRows();
  assert.ok(rows.every((r) => r.ocp_username === 'uxmid'), 'tum seed satirlari kullanici adi tasimali');
});

test('VAULT_KEYS: kullanicinin verdigi 7 anahtarin TAMAMI var ve PAROLA yok', () => {
  const { VAULT_KEYS } = require('../data/ocp-inventory-seed.cjs');
  const names = VAULT_KEYS.map((k) => k.key_name).sort();
  assert.deepEqual(names, [
    'uxmid_das', 'uxmid_gar', 'uxmid_gohas', 'uxmid_gtdmz',
    'uxmid_gtek', 'uxmid_gtekdmz', 'uxmid_takasnet',
  ]);
  // Anahtar ADI Ansible degisken adi kurallarina uymali (lookup('vars', <ad>)).
  assert.ok(VAULT_KEYS.every((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k.key_name)));
  assert.ok(!JSON.stringify(VAULT_KEYS).match(/password|parola|secret/i), 'PAROLA TUTULMAZ');
});

test('buildSeedRows(): metaco/das cluster\'lari uxmid_das anahtarini kullanir', () => {
  const rows = seed.buildSeedRows();
  const das = rows.find((r) => r.cluster_name === 'daocpprod1');
  assert.equal(das.vault_credential_key, 'uxmid_das');
  assert.match(das.api_url, /dijitalvarlik\.com\.tr/);
});

// ── Bir-kerelik davranis ──────────────────────────────────────────────────────

function withMocks(fn, { flag = null, existingClusters = new Set(), insertFails = false } = {}) {
  const origGetStrict = settings.getSettingStrict;
  const origSet = settings.setSetting;
  const origQuery = db.query;
  const calls = { inserts: [], selects: 0 };

  settings.getSettingStrict = async () => flag;
  settings.setSetting = async (k, v) => ({ key: k, value: v });
  db.query = async (sql, params) => {
    if (/SELECT TOP 1 id FROM ocp_cluster_index/i.test(sql)) {
      calls.selects++;
      return { rows: existingClusters.has(params[2]) ? [{ id: 1 }] : [] };
    }
    if (/INSERT INTO ocp_cluster_index/i.test(sql)) {
      if (insertFails) throw new Error("Invalid column name 'vault_credential_key'");
      calls.inserts.push({ sql, params });
      return { rows: [] };
    }
    if (/FROM ocp_terminal_host_map/i.test(sql)) return { rows: [{ id: 1 }] };  // hepsi var say
    return { rows: [], rowCount: 1 };
  };

  return Promise.resolve(fn(calls)).finally(() => {
    settings.getSettingStrict = origGetStrict;
    settings.setSetting = origSet;
    db.query = origQuery;
  });
}

test('seedOcpBootstrapOnce(): isaret VARSA hicbir sorgu calismaz (silinen cluster geri gelmez)', async () => {
  await withMocks(async (calls) => {
    const r = await seed.seedOcpBootstrapOnce();
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'already_seeded');
    assert.equal(calls.selects, 0, 'DB\'ye hic gidilmemeli');
    assert.equal(calls.inserts.length, 0);
  }, { flag: '{"at":"2026-01-01"}' });
});

test('seedOcpBootstrapOnce(): yeni satirlar PASIF (is_active=0) ve source=inventory-seed', async () => {
  await withMocks(async (calls) => {
    await seed.seedOcpBootstrapOnce();
    assert.ok(calls.inserts.length > 0, 'satir eklenmeli');
    const first = calls.inserts[0];
    // env, tenant, cluster_name, api_url, vault_credential_key, ocp_username, terminal_host
    assert.equal(first.params.length, 7, 'parola gibi fazladan bir alan gonderilmemeli');
    // Anahtar ADI ile PAROLA karistirilmasin: gonderilen degerlerin hicbiri parola olamaz.
    assert.ok(first.params.every((v) => v == null || !/pass|parola|secret/i.test(String(v))));
    // SQL METNINI dogrula: is_active/source sabit yazili oldugu icin parametrelere
    // bakmak yetmez — biri 0'i 1 yapsa test yine gecerdi.
    assert.match(first.sql, /'inventory-seed'\s*,\s*0\s*\)/,
      "yeni satirlar source='inventory-seed' ve is_active=0 ile eklenmeli");
  }, { flag: null });
});

test('seedOcpBootstrapOnce(): TUM insert\'ler patlarsa isaret ATILMAZ (katalog bos kalmasin)', async () => {
  let flagWritten = false;
  const origSet = settings.setSetting;
  settings.setSetting = async () => { flagWritten = true; };
  try {
    await withMocks(async () => {
      const r = await seed.seedOcpBootstrapOnce();
      assert.equal(r.incomplete, true, 'eksik kurulum olarak isaretlenmeli');
      assert.equal(flagWritten, false, "hicbir satir yazilamadiysa 'yapildi' isareti ATILMAMALI");
    }, { flag: null, insertFails: true });
  } finally {
    settings.setSetting = origSet;
  }
});

test('seedOcpBootstrapOnce(): DB\'de ZATEN olan cluster atlanir (admin duzenlemesi korunur)', async () => {
  await withMocks(async (calls) => {
    await seed.seedOcpBootstrapOnce();
    const inserted = calls.inserts.map((c) => c.params[2]);
    assert.ok(!inserted.includes('gbocpprod1'), 'var olan satir yeniden eklenmemeli');
    assert.ok(inserted.includes('gbocpprod2'), 'olmayan satir eklenmeli');
  }, { flag: null, existingClusters: new Set(['gbocpprod1']) });
});

test('seedOcpBootstrapOnce(): isaret OKUNAMAZSA seed atlanir (mukerrer satir riski alinmaz)', async () => {
  const orig = settings.getSettingStrict;
  settings.getSettingStrict = async () => { throw new Error('DB erisilemiyor'); };
  try {
    const r = await seed.seedOcpBootstrapOnce();
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'flag_read_failed');
  } finally {
    settings.getSettingStrict = orig;
  }
});
