// server/ansible/__tests__/admin-smart-atla.test.cjs — AS1..AS5 (2026-10-08).
//
// Kullanici: "Admin'ler istedigi zaman sadece kendi tetiklemelerinde Smart onayini kapatabilsin;
// deneme yapacagimiz zaman tekrar acip akisi test edebiliyor olalim."
// Kilit: yalniz ROLU Admin + kendi tercihi; okunamazsa onay ISTENIR; genel /prefs ucu tercihi
// yazamaz; ortak kapi atlayinca Smart bileti ACILMAZ ama OCO kapisi calismaya devam eder.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const USERS = require.resolve('../../auth/users.cjs');
const AUDIT = require.resolve('../../audit/index.cjs');
let prefs = {};
let prefHata = null;
const denetim = [];
function sahte(yol, exp) {
  const m = new Module(yol, null); m.loaded = true; m.exports = exp; require.cache[yol] = m;
}
sahte(USERS, { getPrefs: async () => { if (prefHata) throw prefHata; return prefs; } });
sahte(AUDIT, { auditPortal: (_req, action, o) => denetim.push({ action, ...o }) });

const atla = require('../admin-smart-atla.cjs');
const req = (role, username = 'onur') => ({ session: { user: { username, role } } });

test('AS1 yalniz Admin + kendi tercihi "1" ise atlar; rol Admin degilse tercih ise yaramaz', async () => {
  prefs = { [atla.ANAHTAR]: '1' };
  assert.equal(await atla.adminSmartAtliyor(req('Admin')), true);
  assert.equal(await atla.adminSmartAtliyor(req('User')), false, 'admin olmayan Smart onayini atladi');
  assert.equal(await atla.adminSmartAtliyor(null), false);
  prefs = {};
  assert.equal(await atla.adminSmartAtliyor(req('Admin')), false);
});

test('AS2 tercih OKUNAMAZSA onay istenir (fail-closed)', async () => {
  prefs = { [atla.ANAHTAR]: '1' };
  prefHata = new Error('db yok');
  try { assert.equal(await atla.adminSmartAtliyor(req('Admin')), false); } finally { prefHata = null; }
});

test('AS3 ortak kapi: admin atlayinca Smart bileti ACILMAZ, denetime yazilir; atlamayan admin onaya gider', async () => {
  const gates = require('../change-gates.cjs');
  const ctx = (r) => ({
    server: { id: 1 }, templateId: 5, username: 'onur', req: r,
    overrides: { smartApproval: { enabled: true, flowKey: '' } }, extraVars: {}, gateVars: {},
    detail: {}, resolvedLaunchOptions: {}, specFields: [], templateName: 'T',
    createOcoAwxSchedule: async () => ({}), friendlyAwxError: (e) => e, buildSmartMetadata: () => ({}),
  });
  prefs = { [atla.ANAHTAR]: '1' };
  denetim.length = 0;
  assert.deepEqual(await gates.runChangeGates(ctx(req('Admin'))), { outcome: 'proceed' });
  assert.ok(denetim.some((d) => d.action === 'smart_onayi_admin_atladi'), 'atlama denetime yazilmadi');
  const kullanici = await gates.runChangeGates(ctx(req('User')));
  assert.notEqual(kullanici.outcome, 'proceed', 'admin olmayan onaysiz gecti');
  prefs = {};
  const adminAcik = await gates.runChangeGates(ctx(req('Admin')));
  assert.notEqual(adminAcik.outcome, 'proceed', 'atlamayan admin onaysiz gecti');
});

test('AS4 genel /prefs ucu korunan tercihi YAZAMAZ; yalniz admin ucu (korunanaIzin) yazar', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'auth', 'users.cjs'), 'utf8');
  assert.match(src, /if \(!korunanaIzin && k\.toLowerCase\(\)\.startsWith\(KORUNAN_ONEK\)\) return null;/);
  assert.ok(atla.ANAHTAR.startsWith('guvenlik.'), 'tercih anahtari korunan onekte degil');
  const auth = fs.readFileSync(path.join(__dirname, '..', '..', 'auth', 'index.cjs'), 'utf8');
  assert.match(auth, /router\.put\("\/smart-atla", requireAdmin,/, 'tercih ucu admin korumali degil');
  assert.match(auth, /\{ korunanaIzin: true \}/);
});

test('AS5 diger kapilar da ayni karari kullanir: OpsX production, admin test araci, OCO zamanlamasi', () => {
  const opsx = fs.readFileSync(path.join(__dirname, '..', '..', 'opsx', 'prod-approval.cjs'), 'utf8');
  assert.match(opsx, /if \(await atla\.adminSmartAtliyor\(req\)\) \{/);
  const runner = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  assert.match(runner, /if \(!plan\.adminSmartAtla && gates\.isSmartRequired\(/, 'zamanlanmis plan pencere saatinde yeniden onay istiyor');
  assert.match(runner, /if \(smartGerekli && !adminAtladi\) \{/);
  const cg = fs.readFileSync(path.join(__dirname, '..', 'change-gates.cjs'), 'utf8');
  assert.match(cg, /const smartAlsoRequired = isSmartRequired\(overrides\.smartApproval, gateVars\) && !adminAtladi;/);
  // OCO kapisi atlanmaz: isOcoGateApplicable cagrisi admin kararindan bagimsiz
  assert.match(cg, /if \(isOcoGateApplicable\(overrides, extraVars, gateVars\)\) \{/);
});
