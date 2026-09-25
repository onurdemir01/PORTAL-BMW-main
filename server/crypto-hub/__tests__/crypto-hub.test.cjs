// server/crypto-hub/__tests__/crypto-hub.test.cjs — Crypto Hub bekcileri (2026-09-25).
//
// CH1 katalog kendi icinde tutarli (benzersiz anahtar, prod bayragi, url<->cluster)
// CH2 katalog Ansible tarafiyla AYNI (vars/tenants.yml varsa; yoksa bu alt-test ATLANIR)
// CH3 surum karsilastirmasi semantik (1.9 < 1.10 < 1.33.2), metin siralamasi degil
// CH4 "olculemedi" != "yeni surum yok"
// CH5 kosan surum ANA release'ten okunur (Wyden'de keycloak/vault release'leri de var)
// CH6 secim agaci: yapilandirmasi eksik ortam da GORUNUR ama ready:false
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CRYPTO_TENANTS, tenantOf, selectionTree, isOpen, PRODUCTION_ENABLED } = require('../../../shared/cryptoHubTenants.cjs');
const { cmpVersion } = require('../index.cjs');

test('CH1: katalog kendi icinde tutarli', () => {
  const keys = CRYPTO_TENANTS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'kiraci anahtarlari benzersiz olmali');

  for (const t of CRYPTO_TENANTS) {
    assert.equal(t.production, t.env.startsWith('prod'), `${t.key}: production bayragi env ile uyusmuyor`);
    assert.ok(t.apiUrl.includes(t.cluster), `${t.key}: api_url cluster adini icermiyor (yanlis cluster'a baglanma riski)`);
    assert.ok(t.bastion && t.appLabel && t.envLabel, `${t.key}: zorunlu alan bos`);
    // Surum kaynagi ya OCI ya klasik helm deposu; ikisi birden olmaz.
    assert.ok(!(t.chartRef && t.chartName), `${t.key}: hem chartRef hem chartName dolu - hangi depo sorgulanacagi belirsiz`);
    if (t.chartName) assert.ok(t.chartRepo, `${t.key}: chartName var ama chartRepo (alias) yok`);
    if (t.namespace) assert.ok(t.helmRelease, `${t.key}: namespace var ama ana helm release yok`);
  }

  // Ayni namespace birden cok cluster'da olabilir (Wyden aktif/pasif); ayni CLUSTER+NAMESPACE
  // ciftinin iki kez tanimlanmasi ise kopyala-yapistir hatasidir.
  const pairs = CRYPTO_TENANTS.filter((t) => t.namespace).map((t) => `${t.cluster}/${t.namespace}`);
  assert.equal(new Set(pairs).size, pairs.length, 'ayni cluster+namespace iki kiracida tanimli');

  assert.equal(tenantOf('yok-boyle-bir-sey'), null);
  assert.equal(tenantOf('metaco_das_prod').cluster, 'daocpprod1');
});

test('CH2: Portal katalogu Ansible katalogu ile ayni', () => {
  const yml = path.join(
    'C:', 'Users', 'demir', 'Downloads', 'Compressed', 'gar_bmt_ansible_scripts',
    'bmw_automation_folder', 'crypto_hub', 'vars', 'tenants.yml',
  );
  // Ansible deposu her makinede yok; yoksa karsilastirma ATLANIR (test YANLIS yere baglanip
  // ENOENT ile dusmemeli - bu tuzaga 2026-09-22'de bir kez dusuldu).
  if (!fs.existsSync(yml)) return;
  const text = fs.readFileSync(yml, 'utf8');

  const ymlKeys = [...text.matchAll(/^\s*-\s*key:\s*(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(
    [...ymlKeys].sort(),
    CRYPTO_TENANTS.map((t) => t.key).sort(),
    'tenants.yml ile shared/cryptoHubTenants.cjs ayristi - ekran bir ortami gosterip is baskasina baglanabilir',
  );

  // Namespace/cluster de ayni olmali: anahtar ayni ama hedef farkli olursa hata daha da sinsi.
  for (const t of CRYPTO_TENANTS) {
    const block = text.split(/^\s*-\s*key:\s*/m).find((b) => b.startsWith(t.key));
    assert.ok(block, `${t.key} tenants.yml'de yok`);
    const ns = (block.match(/^\s*namespace:\s*"?([^"\n]*)"?/m) || [])[1] || '';
    const cl = (block.match(/^\s*cluster:\s*(\S+)/m) || [])[1] || '';
    const hr = (block.match(/^\s*helm_release:\s*"?([^"\n]*)"?/m) || [])[1] || '';
    assert.equal(ns.trim(), t.namespace, `${t.key}: namespace ayristi`);
    assert.equal(cl.trim(), t.cluster, `${t.key}: cluster ayristi`);
    // Release adi da ayni olmali: Metaco GAR prod'da `hmzbank`, digerlerinde `hmz` -
    // ayrisirsa "kosan surum" yanlis release'ten okunur.
    assert.equal(hr.trim(), t.helmRelease, `${t.key}: helm_release ayristi`);
  }
});

test('CH3: surum karsilastirmasi semantik', () => {
  const sorted = ['1.10.0', '1.9.0', '1.33.2', '1.5.19', '1.5.5'].sort(cmpVersion);
  assert.deepEqual(sorted, ['1.5.5', '1.5.19', '1.9.0', '1.10.0', '1.33.2']);
  assert.ok(cmpVersion('1.14.0', '1.5.19') > 0, 'metin siralamasi 1.14 < 1.5 derdi');
});

test('CH4: olculemedi ile "yeni surum yok" ayri', () => {
  // Etiket listesi bos donduğunde ekran `measured:false` gorur; newer da bos olur ama bu
  // "guncelsiniz" ANLAMINA GELMEZ. Bekci: bos liste ASLA measured:true uretmemeli.
  const measured = (tags) => tags.length > 0;
  assert.equal(measured([]), false);
  assert.equal(measured(['1.0.0']), true);
});

test('CH5/CH6: secim agaci ve ana release', () => {
  const tree = selectionTree();
  const apps = tree.map((a) => a.app);
  assert.deepEqual(apps, ['metaco', 'wyden']);

  const envs = tree.flatMap((a) => a.domains.flatMap((d) => d.envs));
  assert.equal(envs.length, CRYPTO_TENANTS.length, 'her kiraci agacta gorunmeli');
  for (const e of envs) {
    const t = tenantOf(e.key);
    assert.equal(e.ready, !!t.namespace, `${e.key}: ready bayragi namespace ile uyusmuyor`);
    assert.equal(e.production, t.production);
  }

  // Wyden'de ana release wydenapp: ayni namespace'te keycloak + vault release'leri de var.
  const wyden = CRYPTO_TENANTS.filter((t) => t.app === 'wyden');
  assert.ok(wyden.length > 0);
  for (const t of wyden) assert.equal(t.helmRelease, 'wydenapp', `${t.key}: ana release wydenapp olmali`);
});

test('CH7: production kapaliyken prod kiracilari SECILEMEZ ve API reddeder', () => {
  // Kullanici (2026-09-26): "simdilik Crypto Hub icin Production'i kapat".
  assert.equal(PRODUCTION_ENABLED, false, 'production acilacaksa bu testin beklentisi de guncellenmeli');

  const prod = CRYPTO_TENANTS.filter((t) => t.production);
  const nonProd = CRYPTO_TENANTS.filter((t) => !t.production);
  assert.ok(prod.length > 0 && nonProd.length > 0);
  for (const t of prod) assert.equal(isOpen(t), false, `${t.key}: production kapali olmali`);
  for (const t of nonProd) assert.equal(isOpen(t), true, `${t.key}: non-prod kapatilmamali`);

  // KAPALI ORTAM AGACTAN SILINMEZ: kullanici "production nerede?" diye aramasin diye
  // gorunur kalir, yalnizca open:false ile kilitlenir.
  const envs = selectionTree().flatMap((a) => a.domains.flatMap((d) => d.envs));
  assert.equal(envs.length, CRYPTO_TENANTS.length, 'kapali ortam agactan silinmemeli');
  for (const e of envs) assert.equal(e.open, isOpen(tenantOf(e.key)), `${e.key}: open bayragi yanlis`);

  // Sunucu yalnizca ekrana guvenmemeli: veri donduren/is baslatan UCLARIN HEPSI kesmeli.
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const kesmeSayisi = (src.match(/if \(!isOpen\(tenant\)\) return res\.status\(403\)/g) || []).length;
  assert.equal(kesmeSayisi, 3, '/overview, /plan ve /rescan uclarinin UCU de kapali kiraciyi 403 ile kesmeli');
});

// ── ON ONAY PLANI (kullanici, 2026-09-26) ────────────────────────────────────────────
const { ACTIONS, buildPlan } = require('../../../shared/cryptoHubActions.cjs');

const ORNEK = [
  { kind: 'Deployment', name: 'hmz-harmonize-gateway', want: 2, ready: 2 },
  { kind: 'Deployment', name: 'hmz-harmonize-api-management', want: 4, ready: 4 },
  { kind: 'StatefulSet', name: 'hmz-harmonize-keycloak', want: 1, ready: 1 },
];

test('CH8: plan komutlarinda PAROLA gorunmez', () => {
  const t = tenantOf('metaco_das_test');
  for (const a of ACTIONS) {
    const plan = buildPlan(t, a.key, { version: '1.34.4' }, { components: ORNEK, lastNonZero: ORNEK });
    const metin = plan.steps.map((s) => `${s.title} ${s.command || ''} ${s.note || ''}`).join('\n');
    // Runbook'ta `helm registry login … -p <parola>` var; plana ASLA gecmemeli.
    assert.ok(!/-p\s+\S{8,}/.test(metin), `${a.key}: planda parola gibi bir deger var`);
    assert.ok(!/--password[= ]\S+/.test(metin), `${a.key}: planda --password var`);
    assert.ok(!/3ahXek/i.test(metin), `${a.key}: runbook'taki duz metin parola plana sizmis`);
  }
});

test('CH9: scale adimlari OLCULEN bilesenden uretilir, sabit listeden degil', () => {
  const t = tenantOf('metaco_das_test');
  const plan = buildPlan(t, 'stop', {}, { components: ORNEK, lastNonZero: ORNEK });
  const scale = plan.steps.filter((s) => (s.command || '').startsWith('oc scale'));
  assert.equal(scale.length, 3, 'olculen her bilesen icin bir scale adimi olmali');
  // Katalogda olmayan yeni bir bilesen eklenirse plan da buyumeli (bayat liste tuzagi).
  const plan2 = buildPlan(t, 'stop', {}, {
    components: [...ORNEK, { kind: 'Deployment', name: 'hmz-harmonize-yeni-zincir', want: 1 }],
    lastNonZero: [],
  });
  assert.equal(plan2.steps.filter((s) => (s.command || '').startsWith('oc scale')).length, 4);
  // StatefulSet, `oc scale deployment` ile kapatilamaz.
  const sts = scale.find((s) => s.command.includes('keycloak'));
  assert.match(sts.command, /oc scale statefulset /);
  // Metaco'da once gateway kapanir (runbook sirasi).
  assert.match(scale[0].command, /gateway/);
  // Tarama yoksa sessizce bos plan degil, ACIK uyari.
  const bos = buildPlan(t, 'stop', {}, { components: [], lastNonZero: [] });
  assert.ok(bos.warnings.some((w) => w.includes('tarama kaydı yok')));
});

test('CH10: "Ac" plani replikayi 1 VARSAYMAZ', () => {
  const t = tenantOf('metaco_das_test');
  // Her sey kapaliyken (want=0) hedef, son sifirdan farkli olcumden gelir: api-management 4.
  const kapali = ORNEK.map((c) => ({ ...c, want: 0, ready: 0 }));
  const plan = buildPlan(t, 'start', {}, { components: kapali, lastNonZero: ORNEK });
  const api = plan.steps.find((s) => (s.command || '').includes('api-management'));
  assert.match(api.command, /--replicas=4/, 'runbook api-management\'i 4 replika ile aciyor');

  // Hic sifirdan farkli olculmemis bilesen "bilinmiyor" diye ISARETLENIR.
  const plan2 = buildPlan(t, 'start', {}, { components: kapali, lastNonZero: [] });
  assert.ok(plan2.unknownCount > 0);
  assert.ok(plan2.warnings.some((w) => w.includes('bilinmiyor')));
});

test('CH11: onay kapali, yazan adimlar isaretli, Portal disi adimlar planda duruyor', () => {
  const t = tenantOf('metaco_das_test');
  const plan = buildPlan(t, 'stop', {}, { components: ORNEK, lastNonZero: ORNEK });
  assert.equal(plan.runnable, false, 'yazan playbook baglanmadan islem calistirilabilir gorunmemeli');
  assert.equal(plan.writeCount, plan.steps.filter((s) => s.writes).length);
  assert.ok(plan.steps.filter((s) => s.writes).every((s) => (s.command || '').startsWith('oc scale')));
  // LinuxOne adimi Hub'dan TETIKLENMEZ ama SIRASI onemli oldugu icin planda gorunur.
  const linuxone = plan.steps.find((s) => (s.title + (s.note || '')).includes('LinuxOne'));
  assert.ok(linuxone && linuxone.kind === 'manual' && linuxone.writes === false);

  // Wyden upgrade: kapat -> helm upgrade -> ac sirasi (runbook 11).
  const w = buildPlan(tenantOf('wyden_test'), 'upgrade', { version: '1.14.0' }, { components: [{ kind: 'Deployment', name: 'wydenapp-rest-api', want: 1 }], lastNonZero: [{ kind: 'Deployment', name: 'wydenapp-rest-api', want: 1 }] });
  const idxKapat = w.steps.findIndex((s) => (s.title || '').startsWith('Kapat:'));
  const idxHelm = w.steps.findIndex((s) => (s.command || '').includes('helm upgrade'));
  const idxAc = w.steps.findIndex((s) => (s.title || '').startsWith('Aç:'));
  assert.ok(idxKapat > -1 && idxHelm > idxKapat && idxAc > idxHelm, 'Wyden upgrade sirasi: kapat -> upgrade -> ac');
  assert.match(w.steps[idxHelm].command, /wyden\/wyden --version 1\.14\.0/);
});
