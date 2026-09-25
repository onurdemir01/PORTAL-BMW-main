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
    assert.equal(ns.trim(), t.namespace, `${t.key}: namespace ayristi`);
    assert.equal(cl.trim(), t.cluster, `${t.key}: cluster ayristi`);
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

  // Sunucu yalnizca ekrana guvenmemeli: /overview ve /rescan de kapali kiraciyi kesmeli.
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const kesmeSayisi = (src.match(/if \(!isOpen\(tenant\)\) return res\.status\(403\)/g) || []).length;
  assert.equal(kesmeSayisi, 2, 'overview ve rescan uclarinin IKISI de kapali kiraciyi 403 ile kesmeli');
});
