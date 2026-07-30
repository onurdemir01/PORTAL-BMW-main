// server/logx/v2/__tests__/downloads-resolver.test.cjs — Indirme resolver'i: arsivi
// playbook'un bildirdigi yola koru korune bagli kalmadan, portalin KENDI staging koklerinde
// filename ile bulur (paylasilan NFS'te mount yolu farkli olsa bile). Gercek tmp FS kullanir.
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const downloads = require('../downloads.cjs');

let tmpRoot, legacyDir, ocpDir, fallbackDir;
const savedEnv = {};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'logx-dl-'));
  legacyDir = path.join(tmpRoot, 'legacy');
  ocpDir = path.join(tmpRoot, 'ocp');
  fallbackDir = path.join(tmpRoot, 'fallback');
  for (const d of [legacyDir, ocpDir, fallbackDir]) fs.mkdirSync(d, { recursive: true });
  for (const k of ['LOGX_V2_STAGING_LEGACY_DIR', 'LOGX_V2_STAGING_OCP_DIR', 'LOGX_STAGING_FALLBACK_DIR']) savedEnv[k] = process.env[k];
  process.env.LOGX_V2_STAGING_LEGACY_DIR = legacyDir;
  process.env.LOGX_V2_STAGING_OCP_DIR = ocpDir;
  process.env.LOGX_STAGING_FALLBACK_DIR = fallbackDir;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* yoksay */ }
});

test('staged_path yanlış/erişilemez olsa da dosya, staging kökünde filename ile bulunur', () => {
  const filename = `${crypto.randomBytes(8).toString('hex')}.zip`;
  fs.writeFileSync(path.join(ocpDir, filename), 'zip-bytes');
  // Playbook kaynak host'un YEREL yolunu bildirdi; portal o yolu goremiyor.
  const bogus = '/some/source-host/local/path/' + filename;
  const resolved = downloads.resolveStagedFile({ stagedPath: bogus, filename });
  assert.equal(resolved, path.join(ocpDir, filename));
});

test('staged_path doğrudan mevcutsa o kullanılır (mount yolları birebir eşleşiyor)', () => {
  const filename = `${crypto.randomBytes(8).toString('hex')}.zip`;
  const direct = path.join(legacyDir, filename);
  fs.writeFileSync(direct, 'zip');
  const resolved = downloads.resolveStagedFile({ stagedPath: direct, filename });
  assert.equal(resolved, path.resolve(direct));
});

test('hiçbir yerde yoksa null (→ route 404 döner)', () => {
  const filename = `${crypto.randomBytes(8).toString('hex')}.zip`;
  const resolved = downloads.resolveStagedFile({ stagedPath: '/nope/' + filename, filename });
  assert.equal(resolved, null);
});

test('güvenlik: filename içindeki path-traversal basename ile kırpılır, kökten kaçılamaz', () => {
  // Kokun DISINA yazilmis bir dosya, traversal iceren filename ile servis EDILMEMELI.
  const outside = path.join(tmpRoot, 'secret.zip');
  fs.writeFileSync(outside, 'secret');
  const resolved = downloads.resolveStagedFile({ stagedPath: '', filename: '../secret.zip' });
  // basename('../secret.zip') = 'secret.zip' → yalniz koklerde aranir, tmpRoot/secret.zip'e ulasilmaz.
  assert.equal(resolved, null);
});

test('güvenlik: staged_path staging kökü DIŞINDA var olan gerçek bir dosyaya işaret ederse reddedilir (path traversal)', () => {
  // Gercek exploit senaryosu: staged_path DB sutunu (playbook set_stats ciktisi) manipule
  // edilmis/kotu niyetli olsa bile — staging koklerinin disindaki GERCEK bir dosya asla
  // servis edilmemeli, filename de hicbir kokte eslesmiyorsa null donmeli.
  const outsideFile = path.join(tmpRoot, 'not-a-staging-root', 'etc-passwd-equivalent.txt');
  fs.mkdirSync(path.dirname(outsideFile), { recursive: true });
  fs.writeFileSync(outsideFile, 'hassas-icerik');
  const filename = `${crypto.randomBytes(8).toString('hex')}.zip`; // hicbir kokte yok
  const resolved = downloads.resolveStagedFile({ stagedPath: outsideFile, filename });
  assert.equal(resolved, null, 'staging kökü dışındaki dosya asla servis edilmemeli');
});

test('fallback dizininde de bulunur (NFS erişilemezse yerel yedek)', () => {
  const filename = `${crypto.randomBytes(8).toString('hex')}.zip`;
  fs.writeFileSync(path.join(fallbackDir, filename), 'zip');
  const resolved = downloads.resolveStagedFile({ stagedPath: null, filename });
  assert.equal(resolved, path.join(fallbackDir, filename));
});
