// server/crypto-hub/__tests__/kaynak-sozlesme.test.cjs — Portal <-> AWX sozlesmesi (2026-10-02).
//
// URETIM DERSI (tasarim K-1, K-2): playbook'un izin listesi 7 islem kabul ediyordu, betik 16
// islem taniyordu, Portal 16'sini gonderiyordu - fark/onizleme/uygula/geri yukle AWX'te ilk
// adimda dusuyordu ve bekci yalniz betige baktigi icin YESIL kaliyordu. Config map
// degiskenleri playbook'tan betige HIC gecmiyordu.
//
// SB1 Portal OPS == ekranin WRITES haritasi == API tip birligi (okur/yazar ayni)
// SB2 Portal OPS == playbook ch_islemler == betik case listesi (Ansible deposu varsa)
// SB3 Portal'in gonderdigi her crypto_hub_* playbook'ta ortama gecer ve betik onu okur
// SB4 yol / release / chart / values icerigi resources_* islerinde Portal'dan GITMEZ
// SB5 katalog: Portal res_* alanlari tenants.yml ile AYNI
//
// Ansible deposu: CRYPTO_HUB_ANSIBLE_ROOT (yoksa bu makinedeki varsayilan). Bulunamazsa
// capraz karsilastirmalar ATLANIR ama Portal'in kendi icindeki tutarlilik yine denetlenir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { flatten } = require('../../util/guard-text.cjs');

const KOK = path.join(__dirname, '..', '..', '..');
const ANSIBLE =
  process.env.CRYPTO_HUB_ANSIBLE_ROOT ||
  path.join('C:', 'Users', 'demir', 'Downloads', 'Compressed', 'gar_bmt_ansible_scripts');
const CH = path.join(ANSIBLE, 'bmw_automation_folder', 'crypto_hub');
const oku = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const ansibleVar = () => fs.existsSync(path.join(CH, 'crypto_hub_ops.yml'));

const IDX = oku(__dirname, '..', 'index.cjs');
const { OPS, kaynakExtraVars } = require('../index.cjs');
const { CRYPTO_TENANTS } = require('../../../shared/cryptoHubTenants.cjs');

/** Yorum satirlarini atar (# ile baslayan). */
const kodsuz = (s) =>
  s
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

test('SB1 Portal OPS == ekran WRITES == API tip birligi (okur/yazar ayni)', () => {
  const panel = oku(KOK, 'src', 'components', 'crypto_hub', 'OpsPanel.tsx');
  const m = /const WRITES: Record<CryptoOpsAction, boolean> = \{([\s\S]*?)\n\};/.exec(panel);
  assert.ok(m, 'OpsPanel WRITES haritasi bulunamadi');
  const ekran = Object.fromEntries(
    [...m[1].matchAll(/^\s+([a-z_]+): (true|false),/gm)].map((x) => [x[1], x[2] === 'true']),
  );
  const sunucu = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [k, v.writes]));
  assert.deepEqual(ekran, sunucu, 'ekranin okur/yazar haritasi sunucudan ayristi');
  const api = oku(KOK, 'src', 'api', 'cryptoHubApi.ts');
  const t = /export type CryptoOpsAction =([\s\S]*?);/.exec(api);
  assert.ok(t);
  const tip = [...t[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(tip, Object.keys(OPS).sort(), 'API tip birligi OPS ile ayni degil');
  for (const a of ['resources_get', 'resources_plan', 'resources_apply']) assert.ok(OPS[a], a);
  assert.equal(OPS.resources_get.writes, false);
  assert.equal(OPS.resources_plan.writes, false, 'plan dosyaya/kumeye yazmaz');
  assert.equal(OPS.resources_apply.writes, true);
});

test('SB2 Portal OPS == playbook ch_islemler == betik case listesi (Ansible deposu varsa)', (t) => {
  if (!ansibleVar()) return t.skip('Ansible deposu bu makinede yok (CRYPTO_HUB_ANSIBLE_ROOT)');
  const yml = kodsuz(oku(CH, 'crypto_hub_ops.yml'));
  const blok = /ch_islemler:\n((?:\s+- [a-z_]+\n)+)/.exec(yml);
  assert.ok(blok, 'playbook ch_islemler listesi bulunamadi');
  const playbook = [...blok[1].matchAll(/- ([a-z_]+)/g)].map((x) => x[1]).sort();
  const sh = kodsuz(oku(CH, 'files', 'crypto_hub_ops.sh'));
  const c = /^ {2}([a-z_]+(?:\|[a-z_]+)+)\) ;;$/m.exec(sh);
  assert.ok(c, 'betikteki izin satiri bulunamadi');
  const betik = c[1].split('|').sort();
  const portal = Object.keys(OPS).sort();
  assert.deepEqual(playbook, portal, 'Portal OPS != playbook ch_islemler');
  assert.deepEqual(betik, portal, 'Portal OPS != betik islem listesi');
  for (const a of portal) {
    assert.match(sh, new RegExp(`^ {2}${a}\\)$`, 'm'), `betikte '${a}' case dali yok`);
  }
});

// Portal'in ADLANDIRDIGI ama ops playbook'unun ortamina gecmeyen (bilerek) adlar.
const PLAY_DUZEYI = new Set([
  'crypto_hub_tenant', // play 1'de kiraci cozumu
  'crypto_hub_timeout', // async
  'crypto_hub_keys', // tarama playbook'u (rescan)
]);
const DEGISKEN_DEGIL = /^crypto_hub_(ops|ops_result|inventory|values_reveal|resources_plan|resources_apply|locks)$/;

test('SB3 Portal crypto_hub_* degiskenleri playbook ortamina gecer, betik okur', (t) => {
  // Kaynak islerinin TUM bayraklari acik ornegi: hicbir dal atlanmasin.
  const tam = {
    bilesen: 'access-gateway',
    kap: 'app',
    degisiklikler: [{ alan: 'limits.memory', eski: '2Gi', yeni: '3Gi' }],
    kosan: '1.5.19',
    asim: true,
    awxSha: 'a'.repeat(64),
    awxJeton: 'b'.repeat(64),
    riskyAck: true,
    acceptPending: true,
  };
  const plan = kaynakExtraVars('resources_plan', tam);
  const uyg = kaynakExtraVars('resources_apply', tam);
  for (const k of [
    'crypto_hub_res_component',
    'crypto_hub_res_container',
    'crypto_hub_res_changes_b64',
    'crypto_hub_expect_version',
    'crypto_hub_res_plan_sha',
    'crypto_hub_res_plan_token',
    'crypto_hub_res_risky_ack',
    'crypto_hub_res_accept_pending',
    'crypto_hub_res_policy_override',
    'crypto_hub_res_observe_sec',
  ]) {
    assert.ok(k in uyg, `uygulama ${k} gondermiyor`);
  }
  assert.ok(!('crypto_hub_res_plan_sha' in plan), 'plan, uygulama alanlarini gondermemeli');
  assert.ok(uyg.crypto_hub_timeout >= 2400 && plan.crypto_hub_timeout >= 900);
  assert.throws(() => kaynakExtraVars('resources_get', tam), /beklenmeyen/);

  if (!ansibleVar()) return t.skip('Ansible deposu bu makinede yok');
  const yml = oku(CH, 'crypto_hub_ops.yml');
  const sh = kodsuz(oku(CH, 'files', 'crypto_hub_ops.sh'));
  const env = /environment:\n([\s\S]*?)\n\s+register: ch_ops/.exec(yml);
  assert.ok(env, 'playbook environment blogu bulunamadi');
  const esle = new Map();
  for (const m of env[1].matchAll(/^\s+([A-Z][A-Z0-9_]*): "(.*)"$/gm)) {
    for (const v of m[2].matchAll(/\b(crypto_hub_[a-z0-9_]+)\b/g)) esle.set(v[1], m[1]);
  }
  const portal = new Set([
    ...[...IDX.matchAll(/\b(crypto_hub_[a-z0-9_]+)\b/g)].map((m) => m[1]),
    ...Object.keys(plan),
    ...Object.keys(uyg),
  ]);
  for (const v of [...portal].sort()) {
    if (DEGISKEN_DEGIL.test(v) || PLAY_DUZEYI.has(v)) continue;
    const e = esle.get(v);
    assert.ok(e, `Portal '${v}' gonderiyor ama playbook bunu betige GECIRMIYOR (CM_NAME tuzagi)`);
    assert.ok(
      new RegExp(`\\$\\{#?${e}\\b|\\$${e}\\b`).test(sh),
      `playbook ${v} -> ${e} geciriyor ama betik ${e} OKUMUYOR`,
    );
  }
});

test('SB4 resources_* islerinde yol / release / chart / values icerigi Portal\'dan GITMEZ', () => {
  const tam = {
    bilesen: 'access-gateway',
    kap: 'app',
    degisiklikler: [{ alan: 'limits.memory', eski: '2Gi', yeni: '3Gi' }],
    kosan: '1.5.19',
    awxSha: 'a'.repeat(64),
    awxJeton: 'b'.repeat(64),
  };
  for (const a of ['resources_plan', 'resources_apply']) {
    const ev = kaynakExtraVars(a, tam);
    for (const k of Object.keys(ev)) {
      assert.ok(
        !/values_path|values_b64|values_paths|chart_ref|release$|backup_path|content/.test(k),
        `${a}: ${k} istemci/Portal tarafindan gonderilmemeli (katalogdan)`,
      );
      assert.ok(String(ev[k]).length <= 2048, `${a}: ${k} 2048'i asiyor`);
    }
  }
  // Kaynak dallarinda AWX'e giden yol/release satiri YOK (helm_upgrade dalindan farkli).
  const f = flatten(IDX);
  const dal = f.slice(
    f.indexOf("if (params.action === 'resources_plan' || params.action === 'resources_apply') { // KOSAN"),
    f.indexOf("await require('../ansible/template-preflight.cjs')"),
  );
  assert.ok(dal.length > 100, 'kaynak dali bulunamadi');
  assert.ok(!/crypto_hub_values_path|crypto_hub_release|crypto_hub_chart_ref/.test(dal));
});

test('SB5 katalog: Portal res_* alanlari tenants.yml ile AYNI', (t) => {
  const p = path.join(CH, 'vars', 'tenants.yml');
  if (!fs.existsSync(p)) return t.skip('Ansible deposu bu makinede yok');
  const text = oku(p);
  for (const tn of CRYPTO_TENANTS) {
    const block = text.split(/^\s*-\s*key:\s*/m).find((b) => b.startsWith(tn.key + '\n') || b.startsWith(tn.key + '\r\n'));
    assert.ok(block, `${tn.key} tenants.yml'de yok`);
    const yolm = /^\s*res_values_path:\s*"?([^"\n]*)"?\s*$/m.exec(block);
    assert.ok(yolm, `${tn.key}: res_values_path yok`);
    assert.equal(yolm[1].trim(), tn.resValuesPath, `${tn.key}: values yolu ayristi`);
    const dg = /^\s*res_values_dogrulandi:\s*(\S+)/m.exec(block);
    assert.equal(dg && dg[1], String(tn.resValuesVerified), `${tn.key}: dogrulandi ayristi`);
    const es = /^\s*res_peer_tenants:\s*\[([^\]]*)\]/m.exec(block);
    assert.ok(es, `${tn.key}: res_peer_tenants yok`);
    const esler = es[1].split(',').map((x) => x.trim()).filter(Boolean).sort();
    assert.deepEqual(esler, [...tn.resPeerTenants].sort(), `${tn.key}: es kiracilar ayristi`);
    const ch = /^\s*chart_name:\s*"?([^"\n]*)"?/m.exec(block);
    assert.equal((ch && ch[1].trim()) || '', tn.chartName, `${tn.key}: chart_name ayristi (Metaco kapisi)`);
  }
});

test('SB5b es kiracilar ayni uygulama/namespace/production/release/BASTION (Ansible deposu gerekmez)', () => {
  // Es dosya bu isin bastion'unda okunur/yazilir; farkli bastion'lu es yanlis hostun ayni yoluna
  // dokunurdu (dogrulayici, 2026-10-02). Playbook da reddeder; bu bekci katalogun kendisini tutar.
  const anahtar = new Map(CRYPTO_TENANTS.map((t) => [t.key, t]));
  let es = 0;
  for (const t of CRYPTO_TENANTS) {
    for (const k of t.resPeerTenants || []) {
      const e = anahtar.get(k);
      assert.ok(e, `${t.key}: es kiraci ${k} katalogda yok`);
      assert.notEqual(k, t.key, `${t.key} kendi kendisinin esi`);
      for (const alan of ['app', 'namespace', 'production', 'helmRelease', 'bastion']) {
        assert.equal(e[alan], t[alan], `${t.key} ile esi ${k} farkli ${alan}`);
      }
      es += 1;
    }
  }
  assert.ok(es > 0, 'katalogda hic es kiraci yok - bekci bos kosuyor');
});

test('SB6 /api/ansible/history cevabi Crypto Hub satirlarini temizler; gecmis runner redaksiyonundan gecer', () => {
  // Davranis kaynak-uclar.test.cjs K3'te (gecmisSatiriniTemizle, gizli alan). Burada CEVABIN o
  // fonksiyondan gectigi ve Crypto Hub kaydinin runner redaksiyonunu cagirdigi kilitlenir.
  const runner = flatten(oku(KOK, 'server', 'ansible', 'runner.cjs'));
  const i = runner.indexOf("app.get('/api/ansible/history'");
  assert.ok(i > 0, 'history ucu bulunamadi');
  const blok = runner.slice(i, i + 1600);
  assert.ok(blok.includes("require('../crypto-hub/resources.cjs')"), 'temizleyici yuklenmiyor');
  assert.ok(
    blok.includes('history: (r.rows || []).map(gecmisSatiriniTemizle)'),
    'history cevabi Crypto Hub satirlarini temizlemiyor',
  );
  assert.equal(typeof require('../../ansible/runner.cjs').redactExtraVarsForHistory, 'function');
  assert.ok(
    flatten(IDX).includes('runner.redactExtraVarsForHistory(ozet, [], ov || {})'),
    'Crypto Hub gecmisi runner redaksiyonundan gecmiyor',
  );
});
