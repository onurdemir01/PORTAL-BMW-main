// server/opsx/__tests__/ocp-prod-restart-gate.test.cjs — PK1..PK9 (2026-10-06).
//
// GECICI KAPI: OpsX > Openshift > uygulama restart, PRODUCTION cluster secildiginde
// reddedilir; ADMINLER MUAF (kullanicinin duran kurali). Kullanici talebi:
// "Opsix OpenShift tarafinda eger Production Cluster'i secilirse uygulama restart
//  yapilamasin, izin verilmesin. Ancak adminler her isi yapabilir."
//
// Bu bekciler kapinin IKI yanlisini birden kilitler:
//   - FAIL-OPEN: 'prod1' / 'prod-tr' gibi serbest yazilmis bir etiket kapiyi acmasin
//     (ocp_cluster_index.env admin tarafindan yazilan serbest metin). Bir guvenlik
//     kapisinin sessizce acilmasi, kapiyi hic koymamaktan kotudur.
//   - KACAK YOL: 'poddelete' de bir restart'tir (dugmenin metni "podlarimi silmek
//     (restart etmek) istiyorum" diyor). Yalniz /api/opsx/run kapatilsaydi kisit,
//     uzerinde "restart" yazan bir dugmeyle tek tikta asilabilirdi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ocpProdRestartEngeli, uretimEtiketi, uretimSecimi } = require('../ocp-prod-restart-gate.cjs');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

const req = (role) => ({ session: { user: { role, username: 'u', mail: 'u@x' } } });

test('PK1 URETIM etiketleri yakalanir (serbest yazim dahil)', () => {
  for (const e of [
    'prod',
    'PROD',
    'Prod',
    'prd',
    'PRD',
    'production',
    'Production',
    'prod1',
    'prod-tr',
    'tr-prod',
    'ark_prod',
    // GERCEK cluster adlari: isaret ayirici olmadan kelime icinde gomulu gelir
    'giocpank3rdwyprod1',
    'gbocpprod1',
    'canli',
    'canlı',
  ])
    assert.equal(uretimEtiketi(e), true, `uretim sayilmadi: ${e}`);
});

test('PK2 URETIM OLMAYAN etiketler engellenmez', () => {
  for (const e of ['test', 'TEST', 'qa', 'lab', 'dev', 'edu', 'alpha', 'odm', '', null, undefined])
    assert.equal(uretimEtiketi(e), false, `yanlislikla uretim sayildi: ${String(e)}`);
});

test('PK3 preprod / nonprod URETIM DEGILDIR (yanlis pozitif kapisi)', () => {
  // Bu etiketler "prod" icerir ama uretim degildir; desen eslemesinin bedeli
  // bunlari ayiklamaktir.
  for (const e of [
    'preprod',
    'pre-prod',
    'pre_prod',
    'nonprod',
    'non-prod',
    'non_prod',
    'prod-test',
    'sandbox',
  ])
    assert.equal(uretimEtiketi(e), false, `yanlislikla uretim sayildi: ${e}`);
});

test('PK4 ADMIN MUAF: production'.concat(" secili olsa da engel YOK"), () => {
  const engel = ocpProdRestartEngeli(req('Admin'), {
    env: 'prod',
    tenant: 'ark',
    clusters: ['gbocpprod1'],
  });
  assert.equal(engel, null, 'admin engellendi (duran kural: adminler her isi yapabilir)');
});

test('PK5 ADMIN OLMAYAN production restart REDDEDILIR (403 + sebep)', () => {
  const engel = ocpProdRestartEngeli(req('User'), {
    env: 'prod',
    tenant: 'ark',
    clusters: ['gbocpprod1'],
  });
  assert.ok(engel, 'production restart gecti');
  assert.equal(engel.status, 403);
  assert.match(engel.sebep, /ortam=prod/);
  assert.match(engel.message, /Production/);
  // Mesaj tani islemlerinin ETKILENMEDIGINI soylemeli: aksi halde kullanici
  // dump da alamadigini sanir.
  assert.match(engel.message, /dump/i);
});

test('PK6 test ortaminda engel YOK (kisit yalniz production)', () => {
  for (const env of ['test', 'qa', 'lab'])
    assert.equal(
      ocpProdRestartEngeli(req('User'), { env, tenant: 'ark', clusters: ['gbocptest1'] }),
      null,
      `${env} engellendi`,
    );
});

test('PK7 KATALOG HATASI KAPIYI ACMAZ: tenant ya da cluster adi uretim isaretliyse engel var', () => {
  // Playbook hedefi `{{ oc_cluster }}_{{ env }}`; katalogda yanlis `env` ile kaydedilmis
  // bir satir yuzunden uretim cluster'ina restart gitmesin (defence in depth).
  const t = ocpProdRestartEngeli(req('User'), { env: 'test', tenant: 'ark_prod', clusters: [] });
  assert.ok(t, 'uretim isaretli tenant gecti');
  assert.match(t.sebep, /cluster grubu=ark_prod/);
  const c = ocpProdRestartEngeli(req('User'), {
    env: 'test',
    tenant: 'ark',
    clusters: ['gbocptest1', 'giocpank3rdwyprod1'],
  });
  assert.ok(c, 'uretim isaretli cluster gecti');
  assert.match(c.sebep, /cluster=giocpank3rdwyprod1/);
  // Gercek filodaki test cluster adlari yanlislikla engellenmemeli
  assert.equal(
    uretimSecimi({
      env: 'test',
      tenant: 'ark',
      clusters: ['gbocptest1', 'gbocpqa2', 'daocptest1', 'gbocplab1', 'gbocp3rdtest4'],
    }).uretim,
    false,
  );
});

test('PK8 HER IKI RESTART UCU da kapiya baglanmis (poddelete bir kacak yoldu)', () => {
  // Kapi cagrisi: /api/opsx/run (rollout) VE /api/opsx/poddelete/openshift. Dump ucu
  // KAPSAM DISI olmali (salt tani).
  const cagri = SRC.match(/ocpProdRestartEngeli\(/g) || [];
  assert.ok(
    cagri.length >= 3,
    `kapi cagrisi eksik (run + poddelete + operations listesi beklenir, bulunan: ${cagri.length})`,
  );
  // poddelete govdesinde cagri VAR MI: 'cleanPodTargets' ve kapi ayni blokta
  const pd = SRC.slice(SRC.indexOf("'/api/opsx/poddelete/openshift'"));
  assert.ok(
    pd.includes('ocpProdRestartEngeli('),
    'poddelete ucu kapiya baglanmamis - "restart etmek" yazan dugmeyle kisit asilir',
  );
  // CAGRININ VARLIGI YETMEZ, ARGUMANI DA DOGRU OLMALI: kapi KATALOGDAN COZULMUS
  // degerlerle beslenmeli. Sabit/bos arguman gecirmek cagriyi yerinde birakip kapiyi
  // etkisizlestirirdi ve "cagri var mi" diye bakan bir bekci bunu goremezdi.
  assert.ok(
    /ocpProdRestartEngeli\(req, \{\s*env: envKey,\s*tenant: tenantKey,\s*clusters: neededClusters,/.test(
      pd,
    ),
    'poddelete kapisi katalogdan cozulmus env/tenant/cluster ile cagrilmiyor',
  );
  const run = SRC.slice(SRC.indexOf("openshift_operations: 'openshift_application_rollout'") - 6000);
  assert.ok(
    /ocpProdRestartEngeli\(req, \{\s*env: envKey,\s*tenant: tenantKey,\s*clusters: targetCluster \? \[targetCluster\] : clusterNames,/.test(
      run,
    ),
    'restart (rollout) kapisi katalogdan cozulmus degerlerle cagrilmiyor; "Tum cluster\'lar" ' +
      'secildiginde grubun TAMAMI olculmeli',
  );
  // dump ucu kapiya BAGLANMAMIS olmali
  const dumpBas = SRC.indexOf("'/api/opsx/dump/openshift'");
  const dumpSon = SRC.indexOf("'/api/opsx/poddelete/openshift'");
  assert.ok(dumpBas > 0 && dumpSon > dumpBas, 'uc siralamasi beklenenden farkli');
  assert.ok(
    !SRC.slice(dumpBas, dumpSon).includes('ocpProdRestartEngeli('),
    'dump ucu da engellenmis - kullanici yalniz restart icin istedi (tani kapanmamali)',
  );
});

test('PK9 REDDETME SESSIZ DEGIL: denetim kaydi + makine-okur isaret', () => {
  // IKI UC DA yazmali: tek occurrence aramak kordu (bir ucun olay adi sessizce
  // degistirilse digerinden bulunup bekci susuyordu - mutasyon M8).
  assert.equal(
    (SRC.match(/opsx_ocp_restart_blocked/g) || []).length,
    2,
    'reddetme denetim kaydi iki restart ucunun IKISINDE de yok (run + poddelete)',
  );
  assert.ok(
    SRC.includes("blocked: 'ocp_prod_restart'"),
    'yanitta makine-okur engel isareti yok',
  );
  // Operasyon listesi ucu da kapiyi uygular (onyuz dugmeyi BASTAN kapatsin)
  assert.ok(
    /RESTART_ISLEMLERI\s*=\s*new Set\(\['restart', 'poddelete'\]\)/.test(SRC),
    'operasyon listesinde restart sayilan islemler kumesi yok ya da poddelete eksik',
  );
});
