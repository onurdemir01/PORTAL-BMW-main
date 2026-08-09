// server/logx/v2/__tests__/ocp-vault-keys.test.cjs — vault anahtar katalogu.
//
// EN KRITIK GARANTI: bu tablo PAROLA TUTMAZ. "Vault Anahtari" basligini goren bir admin
// oraya gercek parolayi yapistirabilir; kabul edilen degerin bir Ansible DEGISKEN ADI
// olmasi zorunludur (lookup('vars', <ad>) ile cozulecek). Ikinci garanti: kullanimdaki
// bir anahtar silinemez — silinirse onu kullanan cluster'lar calisma aninda parolasiz kalir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const adminData = require('../admin.cjs');

function withQuery(handler, fn) {
  const orig = db.query;
  db.query = handler;
  return Promise.resolve(fn()).finally(() => { db.query = orig; });
}

// ── Anahtar adi dogrulamasi ──────────────────────────────────────────────────

test('createVaultKey(): Ansible degisken adi olmayan girdi 400 ile reddedilir', async () => {
  const bad = [
    'Parola123!',            // parola gibi — ozel karakter
    '1uxmid',                // rakamla baslayamaz
    'uxmid gar',             // bosluk
    'uxmid-gar',             // tire Ansible degisken adinda gecersiz
    '',                      // bos
    'a'.repeat(129),         // cok uzun
  ];
  for (const value of bad) {
    await withQuery(
      async () => { throw new Error('DB\'ye HIC gidilmemeliydi'); },
      async () => {
        await assert.rejects(
          () => adminData.createVaultKey({ key_name: value }),
          (err) => err.status === 400,
          `reddedilmeliydi: ${JSON.stringify(value)}`
        );
      }
    );
  }
});

test('createVaultKey(): gecerli anahtarlar kabul edilir ve PAROLA kolonu yoktur', async () => {
  const seen = [];
  await withQuery(
    async (sql, params) => {
      seen.push({ sql, params });
      return { rows: [{ id: 1, key_name: params[0], default_username: params[1], description: params[2], is_active: 1 }] };
    },
    async () => {
      const row = await adminData.createVaultKey({
        key_name: 'uxmid_gohas', default_username: 'uxmid', description: 'Gohas',
      });
      assert.equal(row.key_name, 'uxmid_gohas');
      assert.equal(row.is_active, true, 'BIT degeri boolean\'a cevrilmeli');
    }
  );
  const insert = seen.find((c) => /INSERT INTO ocp_vault_key_catalog/i.test(c.sql));
  assert.ok(insert, 'INSERT calismali');
  assert.ok(!/password|parola|token/i.test(insert.sql), 'semada parola alani OLMAMALI');
  assert.equal(insert.params.length, 4, 'key_name, default_username, description, is_active');
});

test('createVaultKey(): kullanici adi kabuk metakarakteri iceremez', async () => {
  await withQuery(
    async (sql, params) => ({ rows: [{ id: 1, key_name: params[0], default_username: params[1] }] }),
    async () => {
      const row = await adminData.createVaultKey({ key_name: 'uxmid_gar', default_username: '; rm -rf /' });
      assert.equal(row.default_username, null, 'gecersiz kullanici adi NULL\'lanmali');
    }
  );
});

// ── Silme korumasi ───────────────────────────────────────────────────────────

test('deleteVaultKey(): anahtar KULLANIMDA ise 409 ile reddedilir', async () => {
  await withQuery(
    async (sql) => {
      if (/FROM ocp_vault_key_catalog WHERE id/i.test(sql)) return { rows: [{ key_name: 'uxmid_gar' }] };
      if (/FROM ocp_cluster_index WHERE vault_credential_key/i.test(sql)) {
        return { rows: [{ env: 'prod', tenant: 'ark', cluster_name: 'gbocpprod2' }] };
      }
      throw new Error(`beklenmeyen sorgu: ${sql}`);   // DELETE calismamali
    },
    async () => {
      await assert.rejects(
        () => adminData.deleteVaultKey(1),
        (err) => err.status === 409 && /gbocpprod2/.test(err.message),
        'hangi cluster\'in engellediği mesajda YAZMALI'
      );
    }
  );
});

test('deleteVaultKey(): kullanimda DEGILSE silinir', async () => {
  let deleted = false;
  await withQuery(
    async (sql) => {
      // DELETE once kontrol edilir: "DELETE FROM ... WHERE id" metni SELECT desenini de
      // icerir, sirasi ters olsa mock yanlis dali secerdi.
      if (/^\s*DELETE FROM ocp_vault_key_catalog/i.test(sql)) { deleted = true; return { rowCount: 1 }; }
      if (/FROM ocp_vault_key_catalog WHERE id/i.test(sql)) return { rows: [{ key_name: 'uxmid_eski' }] };
      if (/FROM ocp_cluster_index WHERE vault_credential_key/i.test(sql)) return { rows: [] };
      throw new Error(`beklenmeyen sorgu: ${sql}`);
    },
    async () => {
      assert.equal(await adminData.deleteVaultKey(9), true);
      assert.ok(deleted);
    }
  );
});

test('deleteVaultKey(): olmayan id icin false — 500 atmaz', async () => {
  await withQuery(async () => ({ rows: [] }), async () => {
    assert.equal(await adminData.deleteVaultKey(404), false);
  });
});

// ── Cluster satirindaki kullanici adi ────────────────────────────────────────

test('normalizeOcpUsername(): kabuk metakarakteri ELENIR, mesru adlar gecer', () => {
  const n = adminData.normalizeOcpUsername;
  for (const bad of ['; rm -rf /', 'a b', '$(id)', '`id`', 'a|b', '-baslangic', '', null, undefined, 'a'.repeat(129)]) {
    assert.equal(n(bad), null, `reddedilmeliydi: ${JSON.stringify(bad)}`);
  }
  for (const good of ['uxmid', 'svc-ocp', 'svc_ocp.1', 'user@realm', 'A1']) {
    assert.equal(n(good), good, `kabul edilmeliydi: ${good}`);
  }
  assert.equal(n('  uxmid  '), 'uxmid', 'bosluklar kirpilmali');
});
