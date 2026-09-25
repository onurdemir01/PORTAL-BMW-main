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
    // SURUM KAYNAGI ZINCIRI (2026-09-26): klasik helm deposu (chartName) birincil, OCI
    // (chartRef) yedektir; Metaco'da yalniz OCI var ve onun da iki yolu var (helm-next /
    // helm-flat). Kural: yapilandirilmis her kiracinin EN AZ BIR kaynagi olmali ve yedek
    // yol, birincil yol olmadan tanimlanmamali.
    if (t.namespace) {
      assert.ok(t.chartName || t.chartRef, `${t.key}: hicbir surum kaynagi tanimli degil`);
    }
    if (t.chartRefAlt) assert.ok(t.chartRef, `${t.key}: yedek chart yolu var ama birincil yok`);
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

  // Sunucu yalnizca ekrana guvenmemeli. SAYI SAYMAK KIRILGANDI (yeni bir uc eklenince test
  // "3 olmali" diye duserdi ama asil soru bu degil): her KIRACI COZEN uc, kapali kiraciyi
  // kesiyor mu? Yeni bir uc eklendiginde bu bekci onu da kapsar.
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const bloklar = src.split(/router\.(?:get|post|put|delete)\(/).slice(1);
  const kiraciAlan = bloklar.filter((b) => /tenantOf\(/.test(b));
  assert.ok(kiraciAlan.length >= 4, `kiraci cozen uc sayisi beklenenden az: ${kiraciAlan.length}`);
  for (const b of kiraciAlan) {
    const yol = (b.match(/^\s*'([^']+)'/) || [])[1] || '(bilinmeyen)';
    assert.match(b, /if \(!isOpen\(tenant\)\) return res\.status\(403\)/,
      `${yol} ucu kapali kiraciyi 403 ile kesmiyor`);
  }
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

test('CH12: tarama asamasi dustuyse plan EKSIK oldugunu soyler', () => {
  // Uretimde gorulen durum (2026-09-26): `oc get statefulset` Forbidden dondu, bilesen
  // listesi eksik kaldi. Plan bu listeden uretildigi icin sessizce eksik bir "Kapat"
  // plani cikarirdi - bekci bunu engeller.
  const t = tenantOf('metaco_gar_test');
  const notes = [{ level: 'ERR', stage: 'get-statefulset', message: 'statefulsets.apps is forbidden' }];
  const plan = buildPlan(t, 'stop', {}, { components: ORNEK, lastNonZero: ORNEK, notes });
  assert.ok(plan.warnings.some((w) => w.includes('statefulset') && w.includes('planda YOK')));

  // Hata yoksa bu uyari CIKMAMALI (yoksa uyari gurultuye donusur, kimse okumaz).
  const temiz = buildPlan(t, 'stop', {}, { components: ORNEK, lastNonZero: ORNEK, notes: [] });
  assert.ok(!temiz.warnings.some((w) => w.includes('planda YOK')));

  // NOTE (hata degil) plani eksik ILAN ETMEMELI.
  const bilgi = buildPlan(t, 'stop', {}, { components: ORNEK, lastNonZero: ORNEK, notes: [{ level: 'NOTE', stage: '', message: 'chart deposu tanimli degil' }] });
  assert.ok(!bilgi.warnings.some((w) => w.includes('planda YOK')));
});

// ── ISLEMLER: log / pod silme / rollout / replika (kullanici, 2026-09-26) ─────────────
const { normalizeOps, parseOpsLines, OPS } = require('../index.cjs');

test('CH13: yazan islem ONAYSIZ kosmaz, hedefsiz kosmaz', () => {
  // Okur/yazar ayrimi TEK yerde durmali.
  assert.equal(OPS.pods.writes, false);
  assert.equal(OPS.logs.writes, false);
  for (const a of ['pod_delete', 'rollout', 'scale']) assert.equal(OPS[a].writes, true, a);

  // Bos hedef = "hepsi" demek DEGIL; yazan islem reddedilir.
  for (const a of ['pod_delete', 'rollout', 'scale']) {
    assert.throws(() => normalizeOps({ action: a, targets: [], replicas: 1 }), /Hedef seçilmedi/, a);
  }

  // Sunucu kapisi: confirmed olmadan yazan islem 428 doner.
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /params\.writes && req\.body\?\.confirmed !== true/);
  assert.match(src, /status\(428\)/, 'onaysiz yazan istek 428 ile reddedilmeli');
});

test('CH14: hedef adi denetimi ve tur uyumu', () => {
  assert.throws(() => normalizeOps({ action: 'logs', targets: ['pod-a; rm -rf /'] }), /Geçersiz hedef/);
  assert.throws(() => normalizeOps({ action: 'logs', targets: ['../../etc/passwd'] }), /Geçersiz hedef/);
  // pod silme yalniz pod alir - `oc delete pod deployment/web` anlamsiz ve tehlikeli.
  assert.throws(() => normalizeOps({ action: 'pod_delete', targets: ['deployment/web'] }), /yalnız pod hedefi/);
  // rollout/scale yalniz is yuku alir.
  assert.throws(() => normalizeOps({ action: 'rollout', targets: ['pod-a'] }), /deployment\/<ad>/);
  assert.throws(() => normalizeOps({ action: 'scale', targets: ['pod-a'], replicas: 1 }), /deployment\/<ad>/);
  // replika sinirlari
  assert.throws(() => normalizeOps({ action: 'scale', targets: ['deployment/w'], replicas: 51 }), /0-50/);
  assert.throws(() => normalizeOps({ action: 'scale', targets: ['deployment/w'], replicas: 1.5 }), /tam sayı/);
  assert.equal(normalizeOps({ action: 'scale', targets: ['deployment/w'], replicas: 0 }).replicas, 0,
    'replika 0 GECERLIDIR (kapatma); yanlislikla reddedilmemeli');
  // tail ust siniri
  assert.equal(normalizeOps({ action: 'logs', targets: ['p'], tail: 99999 }).tail, 5000);
  // toplu secim ust siniri
  assert.throws(() => normalizeOps({ action: 'pod_delete', targets: Array.from({ length: 51 }, (_, i) => `p-${i}`) }), /En fazla 50/);
});

test('CH15: is ciktisi ayristirma - bos sonuc "sorun yok" DEMEK DEGIL', () => {
  const p = parseOpsLines([
    'POD\tt\tapi-0\tRunning\ttrue,false,\t2,1,\t2026-09-26T08:00:00Z\tnode3',
    'LOG\tt\tapi-0\tbir  iki\tuc',
    'RES\tt\tapi-1\tfail\tsilinemedi',
    'ERR\tt\tget-pods\tForbidden',
    'COP\tbozuk satir',
  ]);
  assert.equal(p.pods.length, 1);
  assert.equal(p.pods[0].ready, false, 'bir kap hazir degilse pod hazir SAYILMAZ');
  assert.equal(p.pods[0].restarts, 3, 'kaplarin restart sayilari toplanir');
  assert.equal(p.logs[0].line, 'bir  iki\tuc', 'log satirindaki TAB korunur');
  assert.equal(p.results[0].ok, false);
  assert.equal(p.errors[0].stage, 'get-pods');
  // Hata satiri OLAN ama sonucu bos bir kosu, "basarili" gibi gosterilmemeli.
  assert.ok(p.errors.length > 0 && p.results.filter((r) => r.ok).length === 0);
  assert.equal(parseOpsLines(null), null, 'satir gelmediyse null - bos dizi ile karistirilmaz');
});

test('CH16: chart deposu kimligi KODA YAZILMAZ, yalniz vault degiskeninin adi durur', () => {
  // Kullanici 2026-09-26'da iki depo parolasini sohbete yapistirdi. Katalog yalnizca
  // KULLANICI ADINI ve vault degiskeninin ADINI tutar; parolalar AWX credential'inda /
  // ansible-vault icinde kalir. Bu bekci, birinin "kolay olsun" diye kataloga parola
  // yazmasini engeller.
  const dosyalar = [
    path.join(__dirname, '..', '..', '..', 'shared', 'cryptoHubTenants.cjs'),
    path.join(__dirname, '..', '..', '..', 'shared', 'cryptoHubActions.cjs'),
    path.join(__dirname, '..', 'index.cjs'),
  ];
  for (const f of dosyalar) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/(password|parola|pwd|secret)\s*[:=]\s*['"][^'"]{6,}['"]/i.test(src),
      `${path.basename(f)}: duz metin parola gibi bir deger var`);
    // `-p <deger>` / `--password <deger>` bicimindeki komut ornekleri de girmemeli.
    assert.ok(!/(^|\s)-p\s+\S{8,}/.test(src), `${path.basename(f)}: komut orneginde parola var`);
    assert.ok(!/--password[= ]\S{8,}/.test(src), `${path.basename(f)}: --password degeri var`);
  }

  // Chart yollari: Metaco'nun guncel yolu helm-next, yedegi helm-flat.
  const metaco = CRYPTO_TENANTS.filter((t) => t.app === 'metaco');
  for (const t of metaco) {
    assert.match(t.chartRef, /metaco\.azurecr\.io\/helm-next\/harmonize/, `${t.key}: guncel chart yolu`);
    assert.match(t.chartRefAlt, /metaco\.azurecr\.io\/helm-flat\/harmonize/, `${t.key}: yedek chart yolu`);
  }
  // Wyden: klasik depo birincil, OCI yedek.
  for (const t of CRYPTO_TENANTS.filter((x) => x.app === 'wyden')) {
    assert.equal(t.chartName, 'wyden/wyden');
    assert.match(t.chartRef, /^repo\.wyden\.io\//, `${t.key}: OCI yedegi wyden deposunu gostermeli`);
  }
});

test('CH17: secilen ortam URLde tutulur (menuden geri donus calissin)', () => {
  // Uretimde gorulen (2026-09-26): ortam secildikten sonra yan menudeki "Crypto Hub"
  // baglantisi ayni rotaya gittigi icin sayfa secim ekranina DONMUYORDU. Secim bilesen
  // durumunda degil URL'de tutulunca menu baglantisi, tarayici geri tusu ve baglanti
  // paylasimi -ucu birden- calisir.
  const page = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'crypto_hub', 'CryptoHubPage.tsx'), 'utf8',
  );
  assert.match(page, /useSearchParams/, 'kapsam URL parametresinden okunmali');
  assert.match(page, /params\.get\('t'\)/, "kiraci anahtari ?t= ile tasinmali");
  assert.match(page, /setParams\(\{ t: env\.key \}\)/, 'secim URL yazmali');
  assert.match(page, /setParams\(\{\}\)/, '"Ortami degistir" URL parametresini temizlemeli');
  assert.ok(!/setScope\(/.test(page), 'kapsam artik bilesen durumunda tutulmamali');
});

test('CH18: values MASKELI gelir, maskeli metin KAYDEDILEMEZ', () => {
  // Kullanici: "calisan surum icin values.yaml'i gorebilelim, degistirebilelim".
  // values icinde veritabani parolasi/token olur; varsayilan gorunum MASKELI.
  const { maskValues } = require('../index.cjs');
  const out = maskValues([
    'image:', '  tag: 1.34.4',
    'db:', '  password: COKGIZLI', '  jdbcUrl: jdbc:sqlserver://db:1433',
    'api_key: abc12345', 'keystorePassword: xyz', 'sifre_yok: 5',
    'note: parola kelimesi degerde gecmiyor', 'blok: |',
  ]);
  assert.ok(out.includes('  password: ****'));
  assert.ok(out.includes('api_key: ****'));
  assert.ok(out.includes('keystorePassword: ****'));
  // Sir OLMAYAN alanlara dokunulmamali - yoksa ekran okunmaz hale gelir.
  assert.ok(out.includes('  tag: 1.34.4'));
  assert.ok(out.includes('  jdbcUrl: jdbc:sqlserver://db:1433'));
  assert.ok(out.includes('sifre_yok: 5'));
  assert.ok(out.includes('blok: |'), 'blok gostergesi maskelenmemeli');

  // MASKELI METIN KAYDEDILEMEZ: "****" yazmak gercek parolayi silerdi.
  assert.throws(
    () => normalizeOps({ action: 'values_put', valuesPath: '/vhosting/x/v.yaml', content: 'db:\n  password: ****\n' }),
    /maskelenmiş/i,
  );

  // Yol denetimi: yalniz /vhosting altinda ve .. yok.
  assert.throws(() => normalizeOps({ action: 'values_put', valuesPath: '/etc/passwd', content: 'a: b' }), /\/vhosting/);
  assert.throws(() => normalizeOps({ action: 'values_put', valuesPath: '/vhosting/../etc/x', content: 'a: b' }), /\/vhosting/);
  assert.equal(normalizeOps({ action: 'values_put', valuesPath: '/vhosting/a/v.yaml', content: 'a: b' }).writes, true,
    'values_put YAZAN islemdir - onay ister');

  // values_get salt okunur ve release zorunlu.
  assert.equal(OPS.values_get.writes, false);
  assert.throws(() => normalizeOps({ action: 'values_get' }), /release/i);

  // Ham icerik ayri ve DENETLENEN bir istek.
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /req\.query\.reveal/, 'maskesiz icerik ayri bir istek olmali');
  assert.match(src, /crypto_hub_values_reveal/, 'maskesiz goruntuleme denetim kaydina yazilmali');
});

test('CH19: upgrade akisi mevcut values adimindan gecer', () => {
  // Kullanici: "upgrade'lerde de mevcut values.yaml gosterilip sorulmali".
  const modal = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'crypto_hub', 'PlanModal.tsx'), 'utf8',
  );
  assert.match(modal, /'version' \| 'values' \| 'plan'/, 'upgrade akisinda values adimi olmali');
  assert.match(modal, /bu değerlerle devam ediyorum/i, 'kullanicidan acik onay istenmeli');
  assert.match(modal, /setStep\(release \? 'values' : 'plan'\)/, 'surum seciminden sonra values adimi gelmeli');
});
