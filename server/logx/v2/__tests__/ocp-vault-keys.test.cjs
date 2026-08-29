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

// ── ON KONTROL: katalogda olmayan anahtarla is HIC baslatilmaz ────────────────
//
// URETIMDE NE OLDU (2026-08-28): Telnet `gbocpcicd2` icin `credential_key: "uxmid_gar"`
// gonderdi, AWX vault'unda o ad cozulemedi. Kullanici 12 saniye bekleyip ham AWX log'u
// okumak zorunda kaldi. Katalog tablosu ZATEN VARDI — yalnizca admin CRUD'unda
// kullaniliyordu, hicbir yerde DOGRULAMA icin okunmuyordu.

const ocp = require('../ocp.cjs');

function withKnownKeys(names, fn) {
  const orig = adminData.listActiveVaultKeyNames;
  adminData.listActiveVaultKeyNames = async () => names;
  return Promise.resolve(fn()).finally(() => { adminData.listActiveVaultKeyNames = orig; });
}

test('on kontrol: katalogda olmayan anahtar 400 doner, mesaj cluster + anahtar adini icerir', async () => {
  await withKnownKeys(['uxmid_ocp', 'gar_ocp'], async () => {
    await assert.rejects(
      () => ocp.assertVaultKeysKnownOrThrow({
        gbocpcicd2: { vault_credential_key: 'uxmid_gar', api_url: 'https://a' },
      }),
      (err) => {
        assert.equal(err.status, 400, 'HTTP 400 olmali');
        assert.equal(err.code, 'vault_key_unknown');
        // Mesaj TESHIS EDILEBILIR olmali: hangi cluster, hangi anahtar, nereden duzeltilir.
        assert.match(err.message, /gbocpcicd2/, 'cluster adi mesajda yok');
        assert.match(err.message, /uxmid_gar/, 'anahtar adi mesajda yok');
        assert.match(err.message, /Vault Anahtarları/, 'duzeltme yeri mesajda yok');
        return true;
      }
    );
  });
});

test('on kontrol: katalogdaki anahtar gecer', async () => {
  await withKnownKeys(['uxmid_gar'], async () => {
    await ocp.assertVaultKeysKnownOrThrow({
      gbocpcicd2: { vault_credential_key: 'uxmid_gar' },
      gbocpcicd3: { vault_credential_key: 'uxmid_gar' },
    });
  });
});

test('on kontrol: BOS anahtar hata DEGILDIR (asamali gecis yolu korunur)', async () => {
  // `resolveClusterContextOrThrow`'un mevcut sozlesmesi: api_url/credential_key eksikse
  // o cluster icin alanlar gonderilmez ve playbook eski inventory yoluna duser. Bu kontrol
  // o yolu KAPATMAMALI — yoksa bugun calisan cluster'lar bir anda 400 almaya baslardi.
  await withKnownKeys([], async () => {
    await ocp.assertVaultKeysKnownOrThrow({
      eski_cluster: { vault_credential_key: '', api_url: '' },
      bos_cluster: {},
      null_cluster: { vault_credential_key: null },
    });
  });
});

test('on kontrol: katalog OKUNAMAZSA is engellenmez (kolaylik kontrolu, guvenlik kapisi degil)', async () => {
  const orig = adminData.listActiveVaultKeyNames;
  adminData.listActiveVaultKeyNames = async () => { throw new Error('DB dustu'); };
  try {
    await ocp.assertVaultKeysKnownOrThrow({ c1: { vault_credential_key: 'her_neyse' } });
  } finally {
    adminData.listActiveVaultKeyNames = orig;
  }
});

test('on kontrol: birden fazla bilinmeyen anahtarin HEPSI raporlanir', async () => {
  // Tek tek raporlansa kullanici duzeltip yeniden deneyip bir sonrakini gorurdu.
  await withKnownKeys(['iyi_anahtar'], async () => {
    await assert.rejects(
      () => ocp.assertVaultKeysKnownOrThrow({
        c1: { vault_credential_key: 'kotu_bir' },
        c2: { vault_credential_key: 'iyi_anahtar' },
        c3: { vault_credential_key: 'kotu_iki' },
      }),
      (err) => {
        assert.match(err.message, /kotu_bir/);
        assert.match(err.message, /kotu_iki/);
        assert.doesNotMatch(err.message, /iyi_anahtar/, 'gecerli anahtar hataya karismamali');
        return true;
      }
    );
  });
});
