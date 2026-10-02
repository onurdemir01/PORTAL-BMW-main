// server/crypto-hub/__tests__/kaynak-uclar.test.cjs — Crypto Hub uclari DAVRANISLA (2026-10-02).
//
// GERCEK express yonlendiricisi + sahte AWX / DB / yetki (bkz. _kaynak_harness.cjs).
//
// B4  /ops-result ve /job-status: uygulama kapisi + is sahipligi, fail-closed
//     (kayit yok -> 403, DB okunamaz -> 503, baska kullanici -> 403, baska uygulama -> 403)
// K3  gecmis kaydi: values_put / configmap_put ICERIGI yok, yalniz sha256 + boyut; runner'in
//     survey redaksiyonu da uygulanir; helm_template onizlemesinde Secret degerleri maskeli
// KP  plan kapilari: prod 403, Metaco 501, values dosyasi tanimsiz 409, kayitsiz/olu yol 409,
//     politika 422, Admin disi asim 403; Admin asimi gerekceyle (gerekce AWX'e GITMEZ)
// KJ  plan jetonu: yalniz plani baslatan kullaniciya, yalniz temiz plana; kiraciya bagli;
//     tek kullanimlik; AWX sha/jetonu SUNUCUDAN gider
// KR  riskli bilesen ve bekleyen fark: ayri onay SUNUCUDA zorunlu
// KK  DB kilidi: ikinci uygulama 409; is bitince UPDATE ile birakilir (DELETE yok);
//     baslatma duserse birakilir; yetim kilit (is AWX'te bitmis) devralinir
// B3  resources_* extra_vars ve gecmiste dosya icerigi yok + uzunluk siniri
// Dogrulayici bulgulari (2026-10-02):
// KJ  jeton suresi plan URETILDIGINDE baslar (gunler sonra yoklanan plan jeton almaz);
//     kullanilmis plan isi yeniden yoklaninca ikinci jeton YOK (MK1)
// KR  bekleyen riskli is yuku (RESAFFECT) RESPLAN 'hayir' dese de ayri onay ister
// B4  kapali kiracinin isi /job-status ile de kapali (MK4); DB-only tarama kaydi cozulur (MK6)
// KK  kilitAl yarisi -> mesgul (MK7); values_put/values_restore/helm_upgrade kilit varken 409
// KS  uygulama SONUC kaydi istemciden bagimsiz (job-status, devralma, suresi dolmus kilit,
//     arka plan taramasi), is sahibi adina, yoklayan ayri, DB isaretiyle TEK kez
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { kur, ornek, KULLANICI: U, PLAN_GOVDE, T, hex } = require('./_kaynak_harness.cjs');

async function opsBaslat(h, user, body) {
  const r = await h.istek('POST', '/ops', user, body);
  return r;
}

async function planUret(h, user = U.ali, secenek = {}, govde = PLAN_GOVDE) {
  const r = await opsBaslat(h, user, govde);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  h.bitir(r.body.jobId, 'resources_plan', govde.tenant, ornek.plan({ t: govde.tenant, ...secenek }));
  const s = await h.istek('GET', `/ops-result/1/${r.body.jobId}`, user);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return { jobId: r.body.jobId, res: s.body.result.resources };
}

const APPLY = (planToken, ek = {}) => ({
  tenant: T,
  action: 'resources_apply',
  targets: [],
  confirmed: true,
  planToken,
  ...ek,
});

test('B4 /ops-result: uygulama kapisi + sahiplik, kayit yoksa 403, DB okunamazsa 503', async () => {
  const h = await kur();
  try {
    const r = await opsBaslat(h, U.ali, { tenant: T, action: 'pods', targets: [] });
    assert.equal(r.status, 200);
    const j = r.body.jobId;
    h.bitir(j, 'pods', T, [`POD\t${T}\tp-0\tRunning\ttrue,\t0,\t2026-10-02T08:00:00Z\tn1`]);
    assert.equal((await h.istek('GET', `/ops-result/1/${j}`, U.ali)).status, 200, 'sahibi okur');
    assert.equal((await h.istek('GET', `/ops-result/1/${j}`, U.admin)).status, 200, 'Admin okur');
    const veli = await h.istek('GET', `/ops-result/1/${j}`, U.veli);
    assert.equal(veli.status, 403, 'baska kullanicinin isi');
    assert.match(veli.body.message, /size ait değil/);
    const mete = await h.istek('GET', `/ops-result/1/${j}`, { ...U.metacocu, username: 'ali' });
    assert.equal(mete.status, 403, 'ayni ad ama uygulamaya yetkisiz: uygulama kapisi');
    assert.equal((await h.istek('GET', `/ops-result/1/999999`, U.admin)).status, 403, 'kayitsiz is (Admin dahil)');
    // Bellek bos (baska Portal ornegi): ansible_job_history'den cozulur.
    h.RES._sifirla();
    assert.equal((await h.istek('GET', `/ops-result/1/${j}`, U.ali)).status, 200, 'DB yedegi');
    assert.equal((await h.istek('GET', `/ops-result/1/${j}`, U.veli)).status, 403);
    // Crypto Hub disi bir is (baska modulun gecmis kaydi).
    h.durum.history.push({ username: 'ali', awx_server_id: 1, job_id: 4242, template_name: 'OpsX: restart' });
    const yab = await h.istek('GET', `/ops-result/1/4242`, U.ali);
    assert.equal(yab.status, 403, 'yabanci is');
    assert.match(yab.body.message, /Crypto Hub işi değil/, 'yabanci is kendi nedeniyle reddedilmeli');
    // DB okunamiyor ve bellekte yok: erisim VERILMEZ.
    h.durum.dbBozuk = true;
    assert.equal((await h.istek('GET', `/ops-result/1/${j}`, U.ali)).status, 503);
    h.durum.dbBozuk = false;
    // Is ciktisi kayittaki kiraciyla celisiyorsa sonuc verilmez.
    h.bitir(j, 'pods', 'wyden_qa_h3', [`POD\twyden_qa_h3\tp-0\tRunning\ttrue,\t0,\tx\tn1`]);
    assert.equal((await h.istek('GET', `/ops-result/1/${j}`, U.ali)).status, 403, 'cikti baska kiraci');
    h.bitir(j, 'values_get', T, [`VAL\t${T}\tdb:`]);
    assert.equal((await h.istek('GET', `/ops-result/1/${j}`, U.ali)).status, 403, 'cikti baska islem');
    // Gecmis kaydi YAZILAMASA da sahibi kendi isini izler (bellek kaydi); baskasi izleyemez.
    h.durum.dbBozuk = true;
    const r2 = await opsBaslat(h, U.ali, { tenant: T, action: 'pods', targets: [] });
    assert.equal(r2.status, 200);
    h.bitir(r2.body.jobId, 'pods', T, [`POD\t${T}\tp-1\tRunning\ttrue,\t0,\tx\tn1`]);
    assert.equal((await h.istek('GET', `/ops-result/1/${r2.body.jobId}`, U.ali)).status, 200, 'bellek kaydi');
    assert.equal((await h.istek('GET', `/ops-result/1/${r2.body.jobId}`, U.veli)).status, 403);
    h.durum.dbBozuk = false;
  } finally {
    await h.kapat();
  }
});

test('B4 /job-status: yalniz kendi Crypto Hub isi (onceden HER AWX isi donuyordu)', async () => {
  const h = await kur();
  try {
    const r = await h.istek('POST', '/rescan', U.ali, { tenant: T });
    assert.equal(r.status, 200);
    const j = r.body.jobId;
    const ok = await h.istek('GET', `/job-status/1/${j}`, U.ali);
    assert.equal(ok.status, 200);
    assert.match(ok.body.output, /cikti/);
    assert.equal((await h.istek('GET', `/job-status/1/${j}`, U.veli)).status, 403);
    assert.equal((await h.istek('GET', `/job-status/1/${j}`, U.metacocu)).status, 403);
    assert.equal((await h.istek('GET', `/job-status/1/31337`, U.ali)).status, 403, 'rastgele is');
    assert.equal((await h.istek('GET', `/job-status/1/31337`, U.admin)).status, 403, 'kayitsiz is Admin icin de');
    // Tarama baslarken gecmis yazilamadi: sahiplik bellekten (DB okunamasa da).
    h.durum.dbBozuk = true;
    const r2 = await h.istek('POST', '/rescan', U.ali, { tenant: T });
    assert.equal(r2.status, 200);
    assert.equal((await h.istek('GET', `/job-status/1/${r2.body.jobId}`, U.ali)).status, 200, 'bellek kaydi');
    h.RES._sifirla();
    assert.equal((await h.istek('GET', `/job-status/1/${j}`, U.ali)).status, 503);
  } finally {
    await h.kapat();
  }
});

test('K3 gecmis kaydi: icerik YOK, sha256 + boyut; runner redaksiyonu da uygulanir', async () => {
  const h = await kur({ gizliAlan: 'crypto_hub_targets' });
  try {
    const icerik = 'db:\n  password: COKGIZLI123\nimage:\n  tag: 1\n';
    const r = await opsBaslat(h, U.ali, {
      tenant: T,
      action: 'values_put',
      targets: [],
      confirmed: true,
      valuesPath: '/vhosting/a/garanti_values.yaml',
      content: icerik,
    });
    assert.equal(r.status, 200);
    const awx = h.durum.launches.at(-1).extraVars;
    assert.ok(awx.crypto_hub_values_b64, 'AWX tarafinda icerik hala gidiyor (README acik is)');
    const g = h.durum.history.at(-1);
    const b64 = Buffer.from(icerik).toString('base64');
    assert.ok(!g.params.includes('COKGIZLI'), 'parola gecmiste');
    assert.ok(!g.params.includes(b64), 'base64 icerik gecmiste');
    const p = JSON.parse(g.params);
    assert.equal(p.crypto_hub_values_b64.sha256, require('node:crypto').createHash('sha256').update(icerik).digest('hex'));
    assert.equal(p.crypto_hub_values_b64.bayt, Buffer.byteLength(icerik));
    assert.equal(p.crypto_hub_targets, '***gizli***', "runner'in redaksiyonu uygulanmadi");
    // configmap_put patch'i de icerik tasir.
    await opsBaslat(h, U.ali, {
      tenant: T,
      action: 'configmap_put',
      targets: [],
      confirmed: true,
      cmName: 'ledger-accounting-config',
      data: { 'app.properties': 'db.password=COKGIZLI456' },
    });
    const g2 = h.durum.history.at(-1).params;
    assert.ok(!g2.includes('COKGIZLI456') && !g2.includes(Buffer.from('COKGIZLI456').toString('base64').slice(0, 12)));
    assert.match(g2, /sha256/);
    // ESKI satirlar (/api/ansible/history cevabi): icerik ozetlenir.
    const eski = {
      template_name: 'Crypto Hub: values_put @ wyden_qa_h2',
      params: JSON.stringify({ crypto_hub_values_b64: b64, crypto_hub_values_path: '/vhosting/a' }),
    };
    const temiz = h.RES.gecmisSatiriniTemizle(eski);
    assert.ok(!temiz.params.includes(b64));
    assert.match(temiz.params, /\/vhosting\/a/, 'icerik disi alanlar korunur');
    const baska = { template_name: 'OpsX: x', params: '{"a":"b"}' };
    assert.equal(h.RES.gecmisSatiriniTemizle(baska), baska, 'Crypto Hub disi satira dokunulmaz');
    const bozuk = { template_name: 'Crypto Hub: x @ y', params: 'x'.repeat(5000) };
    assert.ok(h.RES.gecmisSatiriniTemizle(bozuk).params.length < 500, 'JSON olmayan uzun params ozetlenir');
    // Anahtar adi degisse bile uzun deger ozetlenir (B3 korlugu).
    const ad = h.RES.gecmisParametreleri({ crypto_hub_baska_ad: 'A'.repeat(3000), kisa: 'x' });
    assert.equal(ad.crypto_hub_baska_ad.gecmiseYazilmadi, true);
    assert.equal(ad.kisa, 'x');
  } finally {
    await h.kapat();
  }
});

test('K3 helm_template onizlemesi: Secret data/stringData ve sir adli degerler MASKELI', async () => {
  const h = await kur();
  try {
    const r = await opsBaslat(h, U.ali, {
      tenant: T,
      action: 'helm_template',
      targets: [],
      release: 'wydenapp',
      valuesPath: '/vhosting/a/garanti_values.yaml',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const tpl = [
      '---',
      'apiVersion: v1',
      'data:',
      '  DB_PASSWORD: U0VDUkVUMQ==',
      '  cert.pem: |',
      '    -----BEGIN KEY-----',
      '    SECRETBLOCK2',
      'kind: Secret',
      'metadata:',
      '  name: wydenapp-db',
      'stringData:',
      // Anahtar adi sir GIBI DEGIL: yalniz Secret kurali yakalar.
      '  connection-url: jdbc://u:SECRET3@db',
      '---',
      'kind: ConfigMap',
      'data:',
      '  app.yaml: |',
      '    keystorePassword: >-',
      '      SECRET7',
      '    level: debug',
      'kind: Deployment',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: app',
      '          env:',
      '            - name: DB_PASSWORD',
      '              value: SECRET4',
      '            - name: LOG_LEVEL',
      '              value: info',
      '          resources:',
      '            limits:',
      '              memory: 2Gi',
    ];
    h.bitir(r.body.jobId, 'helm_template', T, [
      `TPLO\t${T}\tSecret\twydenapp-db`,
      ...tpl.map((l) => `TPL\t${T}\t${l}`),
    ]);
    const s = await h.istek('GET', `/ops-result/1/${r.body.jobId}`, U.ali);
    assert.equal(s.status, 200);
    const metin = s.body.result.template.lines.join('\n');
    assert.match(metin, /level: debug/, 'blok skaler sonrasi sirsiz satir korunur');
    for (const sir of ['U0VDUkVUMQ', 'SECRETBLOCK2', 'BEGIN KEY', 'SECRET3', 'SECRET4', 'SECRET7']) {
      assert.ok(!metin.includes(sir), `onizlemede sir: ${sir}`);
    }
    assert.match(metin, /DB_PASSWORD: \*\*\*\*/);
    assert.match(metin, /value: info/, 'sir olmayan deger korunur');
    assert.match(metin, /memory: 2Gi/, 'resources okunur kalir');
    assert.equal(s.body.result.template.masked, true);
    assert.deepEqual(s.body.result.template.objects, [{ kind: 'Secret', name: 'wydenapp-db' }]);
    // MASKE DUSERSE ham manifest DONMEZ (fail-closed); nesne ozeti yine gelir.
    h.RES.maskeleManifest = () => {
      throw new Error('maske bozuldu');
    };
    const s2 = await h.istek('GET', `/ops-result/1/${r.body.jobId}`, U.ali);
    assert.equal(s2.status, 200);
    assert.deepEqual(s2.body.result.template.lines, []);
    assert.equal(s2.body.result.template.maskeHatasi, true);
    assert.equal(s2.body.result.template.objects.length, 1);
  } finally {
    await h.kapat();
  }
});

test('KP plan kapilari: prod 403, Metaco 501, dosya tanimsiz 409, kayitsiz/olu yol 409, politika 422', async () => {
  const h = await kur({ prodAcik: true });
  try {
    const prod = await opsBaslat(h, U.ali, { ...PLAN_GOVDE, tenant: 'wyden_prod_h3' });
    assert.equal(prod.status, 403, 'PRODUCTION_ENABLED acik olsa bile prod plan KAPALI');
    assert.equal(prod.body.code, 'PROD_KAPALI');
    const prodGet = await opsBaslat(h, U.ali, { tenant: 'wyden_prod_h3', action: 'resources_get', targets: [] });
    assert.equal(prodGet.status, 200, 'prod okuma (resources_get) serbest');
    const metaco = await opsBaslat(h, U.metacocu, { ...PLAN_GOVDE, tenant: 'metaco_das_test' });
    assert.equal(metaco.status, 501);
    assert.equal(metaco.body.code, 'CHART_YOK');
    const metacoGet = await opsBaslat(h, U.metacocu, { tenant: 'metaco_das_test', action: 'resources_get', targets: [] });
    assert.equal(metacoGet.status, 200, 'Metaco gosterim acik');
    const dev = await opsBaslat(h, U.ali, { ...PLAN_GOVDE, tenant: 'wyden_dev' });
    assert.equal(dev.status, 409);
    assert.equal(dev.body.code, 'DOSYA_TANIMSIZ');
    const kayitsiz = await opsBaslat(h, U.ali, { ...PLAN_GOVDE, component: 'uydurma' });
    assert.equal(kayitsiz.status, 409);
    const olu = await opsBaslat(h, U.ali, {
      ...PLAN_GOVDE,
      component: 'aeron-cluster.memory-requester',
      container: 'memory-requester',
      kind: 'StatefulSet',
      name: 'wydenapp-aeron-cluster',
    });
    assert.equal(olu.status, 409, 'olu anahtara yazilmaz');
    const kap = await opsBaslat(h, U.ali, { ...PLAN_GOVDE, container: 'vault-proxy' });
    assert.equal(kap.status, 409, 'kayitla uyusmayan kap');
    const isyuku = await opsBaslat(h, U.ali, { ...PLAN_GOVDE, name: 'wydenapp-rest-api' });
    assert.equal(isyuku.status, 409, 'kayitla uyusmayan is yuku');
    const yolGovdede = await opsBaslat(h, U.ali, { ...PLAN_GOVDE, valuesPath: '/etc/passwd' });
    assert.equal(yolGovdede.status, 200, 'govdedeki yol YOK SAYILIR');
    assert.ok(!JSON.stringify(h.durum.launches.at(-1).extraVars).includes('/etc/passwd'));
    const pol = await opsBaslat(h, U.ali, {
      ...PLAN_GOVDE,
      changes: [{ alan: 'limits.memory', eski: '2Gi', yeni: '8Gi' }],
      live: { 'requests.cpu': '500m', 'requests.memory': null, 'limits.cpu': '2', 'limits.memory': '2Gi' },
    });
    assert.equal(pol.status, 422);
    assert.equal(pol.body.code, 'POLITIKA');
    const asimUser = await opsBaslat(h, U.ali, {
      ...PLAN_GOVDE,
      changes: [{ alan: 'limits.memory', eski: '2Gi', yeni: '8Gi' }],
      policyOverride: true,
      reason: 'kendi kendime asiyorum',
    });
    assert.equal(asimUser.status, 403, 'Admin olmayan asamaz');
    const once = h.durum.launches.length;
    const asim = await opsBaslat(h, U.admin, {
      ...PLAN_GOVDE,
      changes: [{ alan: 'limits.memory', eski: '2Gi', yeni: '8Gi' }],
      live: { 'requests.cpu': '500m', 'requests.memory': null, 'limits.cpu': '2', 'limits.memory': '2Gi' },
      policyOverride: true,
      reason: 'kapasite testi icin gecici artis',
    });
    assert.equal(asim.status, 200, JSON.stringify(asim.body));
    assert.equal(h.durum.launches.length, once + 1);
    const ev = h.durum.launches.at(-1).extraVars;
    assert.equal(ev.crypto_hub_res_policy_override, true);
    assert.ok(!JSON.stringify(ev).includes('kapasite testi'), 'gerekce AWX\'e GITMEZ');
    const den = h.durum.audits.find((a) => a.action === 'crypto_hub_resources_plan' && /kapasite testi/.test(a.opts.detail));
    assert.ok(den, 'gerekce denetim kaydina girmeli');
    // Bicimi bozuk birim / requests > limits (K8S) Admin asimiyla da gecmez.
    const k8s = await opsBaslat(h, U.admin, {
      ...PLAN_GOVDE,
      changes: [{ alan: 'requests.cpu', eski: '500m', yeni: '3' }],
      live: { 'requests.cpu': '500m', 'requests.memory': null, 'limits.cpu': '2', 'limits.memory': '2Gi' },
      policyOverride: true,
      reason: 'kapasite testi icin gecici artis',
    });
    assert.equal(k8s.status, 422);
    assert.equal(k8s.body.code, 'K8S_KURAL');
    const birim = await opsBaslat(h, U.ali, { ...PLAN_GOVDE, changes: [{ alan: 'limits.memory', eski: '2Gi', yeni: '3G' }] });
    assert.equal(birim.status, 400);
  } finally {
    await h.kapat();
  }
});

test('KP canli deger SUNUCUNUN olcumunden (istemcinin soyledigi degil)', async () => {
  const h = await kur();
  try {
    const govde = {
      ...PLAN_GOVDE,
      // Dosyada yok (eski ''), canlida yok: oran tabani yok -> yalniz requests <= limits.
      changes: [{ alan: 'requests.memory', eski: '', yeni: '3Gi' }],
      // Istemci limiti 100Gi gosteriyor (bayat ya da uydurma).
      live: { 'requests.cpu': '500m', 'requests.memory': null, 'limits.cpu': '2', 'limits.memory': '100Gi' },
    };
    // Sunucu olcumu YOKKEN istemcinin degeri yalniz on eleme: gecer, kaynak 'istemci'.
    const once = await opsBaslat(h, U.ali, govde);
    assert.equal(once.status, 200, JSON.stringify(once.body));
    assert.equal(once.body.canliKaynagi, 'istemci');
    const g = await opsBaslat(h, U.ali, { tenant: T, action: 'resources_get', targets: [] });
    h.bitir(g.body.jobId, 'resources_get', T, ornek.get());
    const s = await h.istek('GET', `/ops-result/1/${g.body.jobId}`, U.ali);
    assert.equal(s.body.result.resources.live[0]['limits.memory'], '2Gi');
    // Sunucu canli limiti 2Gi olcmus: 3Gi request > 2Gi limit -> K8S (istemci ne derse desin).
    const r = await opsBaslat(h, U.ali, govde);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, 'K8S_KURAL');
    const iyi = await opsBaslat(h, U.ali, { ...govde, changes: [{ alan: 'requests.memory', eski: '', yeni: '2Gi' }] });
    assert.equal(iyi.status, 200);
    assert.equal(iyi.body.canliKaynagi, 'sunucu');
  } finally {
    await h.kapat();
  }
});

test('KJ plan jetonu: kullaniciya + kiraciya bagli, yalniz temiz plana, tek kullanimlik', async () => {
  const h = await kur();
  try {
    const { jobId, res } = await planUret(h);
    assert.match(res.planJetonu, /^[0-9a-f]{64}$/);
    assert.notEqual(res.planJetonu, hex('jeton'), 'Portal jetonu AWX jetonu DEGIL');
    // Admin baskasinin plan sonucunu okuyabilir ama JETON ALAMAZ.
    const adm = await h.istek('GET', `/ops-result/1/${jobId}`, U.admin);
    assert.equal(adm.body.result.resources.planJetonu, null);
    // Ayni kullanici ikinci yoklamada AYNI jetonu alir.
    const ikinci = await h.istek('GET', `/ops-result/1/${jobId}`, U.ali);
    assert.equal(ikinci.body.result.resources.planJetonu, res.planJetonu);
    const tok = res.planJetonu;
    assert.equal((await opsBaslat(h, U.ali, { ...APPLY(tok), confirmed: undefined })).status, 428, 'onaysiz');
    assert.equal((await opsBaslat(h, U.veli, APPLY(tok))).body.code, 'JETON_BASKASI');
    assert.equal((await opsBaslat(h, U.ali, { ...APPLY(tok), tenant: 'wyden_qa_h3' })).body.code, 'JETON_KIRACI');
    assert.equal((await opsBaslat(h, U.ali, APPLY(hex('uydurma')))).status, 409, 'bilinmeyen jeton');
    const once = h.durum.launches.length;
    const ap = await opsBaslat(h, U.ali, { ...APPLY(tok), planSha: hex('sahte'), component: 'storage' });
    assert.equal(ap.status, 200, JSON.stringify(ap.body));
    assert.equal(h.durum.launches.length, once + 1);
    const ev = h.durum.launches.at(-1).extraVars;
    assert.equal(ev.crypto_hub_action, 'resources_apply');
    assert.equal(ev.crypto_hub_res_plan_sha, hex('dosya'), 'sha SUNUCUNUN plan kaydindan');
    assert.equal(ev.crypto_hub_res_plan_token, hex('jeton'), 'AWX jetonu sunucudan');
    assert.equal(ev.crypto_hub_res_component, 'access-gateway', 'govdedeki bilesen YOK SAYILIR');
    assert.equal(ev.crypto_hub_res_container, 'app');
    assert.equal(ev.crypto_hub_expect_version, '1.5.19');
    assert.ok(ev.crypto_hub_timeout >= 2400, 'async alt siniri 2400 sn');
    // MK1 (dogrulayici): uygulama basladiktan sonra AYNI plan isi yeniden yoklaninca ikinci
    // jeton VERILMEZ - aksi halde ayni plan iki kez AWX'e giderdi.
    const sayi = h.durum.launches.length;
    const yeniden = await h.istek('GET', `/ops-result/1/${jobId}`, U.ali);
    assert.equal(yeniden.status, 200);
    assert.equal(yeniden.body.result.resources.planJetonDurumu, 'kullanildi');
    assert.equal(yeniden.body.result.resources.planJetonu, null, 'kullanilmis plana yeni jeton verildi');
    assert.equal(h.durum.launches.length, sayi);
    // Kilit de 409 verir; burada nedenin JETON oldugu olculur (kilit bosaltilir).
    h.durum.locks.clear();
    const tekrar = await opsBaslat(h, U.ali, APPLY(tok));
    assert.equal(tekrar.status, 409, 'jeton TEK kullanimlik');
    assert.equal(tekrar.body.code, 'JETON_YOK');
    // DUR plan: jeton yok.
    const dur = await planUret(h, U.ali, { durum: 'dur', kod: 'OLU_ANAHTAR' });
    assert.equal(dur.res.planJetonu, null);
    assert.equal(dur.res.plan.kod, 'OLU_ANAHTAR');
    // Sure: 15 dk (saf fonksiyon, saat parametreli).
    const p2 = await planUret(h);
    const simdi = Date.now();
    assert.ok(h.RES.planAl(p2.res.planJetonu, 'ali', T, simdi + 14 * 60 * 1000).plan);
    assert.equal(h.RES.planAl(p2.res.planJetonu, 'ali', T, simdi + 16 * 60 * 1000).hata, 'JETON_SURESI');
  } finally {
    await h.kapat();
  }
});

test('KJ surum plan ile uygulama arasinda degisti -> 409 SURUM_BAYAT', async () => {
  const h = await kur();
  try {
    const { res } = await planUret(h);
    h.durum.kosan = '1.5.20';
    const r = await opsBaslat(h, U.ali, APPLY(res.planJetonu));
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SURUM_BAYAT');
    h.durum.kosan = '';
    const p = await opsBaslat(h, U.ali, PLAN_GOVDE);
    assert.equal(p.status, 409, 'kosan surum olculemedi -> plan baslamaz');
  } finally {
    await h.kapat();
  }
});

test('KR riskli bilesen ve bekleyen fark: ayri onay SUNUCUDA zorunlu', async () => {
  const h = await kur();
  try {
    const { res } = await planUret(h, U.ali, { riskli: 'evet' });
    const yok = await opsBaslat(h, U.ali, APPLY(res.planJetonu));
    assert.equal(yok.status, 428);
    assert.equal(yok.body.needsRiskyAck, true);
    const evet = await opsBaslat(h, U.ali, APPLY(res.planJetonu, { riskyAck: true }));
    assert.equal(evet.status, 200);
    assert.equal(h.durum.launches.at(-1).extraVars.crypto_hub_res_risky_ack, true);
    // Kayit riskli (aeron) ise RESPLAN 'hayir' dese de onay gerekir.
    const aeron = await planUret(h, U.ali, {}, {
      ...PLAN_GOVDE,
      component: 'aeron-cluster',
      container: 'aeron-node',
      kind: 'StatefulSet',
      name: 'wydenapp-aeron-cluster',
      changes: [{ alan: 'limits.cpu', eski: '', yeni: '2' }],
    });
    h.durum.locks.clear();
    const a1 = await opsBaslat(h, U.ali, APPLY(aeron.res.planJetonu));
    assert.equal(a1.status, 428, 'ad deseni riskli');
    const bek = await planUret(h, U.ali, { bekleyen: 'abcdef0123456789' });
    h.durum.locks.clear();
    const b1 = await opsBaslat(h, U.ali, APPLY(bek.res.planJetonu));
    assert.equal(b1.status, 428);
    assert.equal(b1.body.needsPendingAck, true);
    const b2 = await opsBaslat(h, U.ali, APPLY(bek.res.planJetonu, { acceptPending: true }));
    assert.equal(b2.status, 200);
    assert.equal(h.durum.launches.at(-1).extraVars.crypto_hub_res_accept_pending, true);
  } finally {
    await h.kapat();
  }
});

test('KK DB kilidi: ikinci uygulama 409; is bitince UPDATE ile birakilir; DELETE yok', async () => {
  const h = await kur();
  try {
    const p1 = await planUret(h);
    const p2 = await planUret(h);
    const a1 = await opsBaslat(h, U.ali, APPLY(p1.res.planJetonu));
    assert.equal(a1.status, 200);
    const kilit = h.durum.locks.get(`${T}|wydenapp`);
    assert.equal(kilit.held, 1);
    assert.equal(kilit.awx_job_id, a1.body.jobId, 'kilit ise baglandi');
    const a2 = await opsBaslat(h, U.ali, APPLY(p2.res.planJetonu));
    assert.equal(a2.status, 409);
    assert.equal(a2.body.code, 'KILIT');
    // Is biter, sonuc yoklanir: kilit birakilir.
    h.bitir(a1.body.jobId, 'resources_apply', T, ornek.apply());
    const s = await h.istek('GET', `/ops-result/1/${a1.body.jobId}`, U.ali);
    assert.equal(s.body.result.resources.end.sonuc, 'uygulandi');
    assert.equal(h.durum.locks.get(`${T}|wydenapp`).held, 0);
    assert.ok(!h.durum.sqlLog.some((q) => /DELETE/i.test(q)), 'TBMWANS: DELETE yok');
    const denetim = h.durum.audits.filter((a) => a.action === 'crypto_hub_resources_apply');
    assert.deepEqual(denetim.map((a) => JSON.parse(a.opts.detail).asama), ['baslatildi', 'sonuc']);
    await h.istek('GET', `/ops-result/1/${a1.body.jobId}`, U.ali);
    assert.equal(h.durum.audits.filter((a) => a.action === 'crypto_hub_resources_apply').length, 2, 'sonuc bir kez denetlenir');
    // Ikinci plan artik uygulanabilir (onceki jeton kullanilmadi).
    const p3 = await planUret(h);
    const a3 = await opsBaslat(h, U.ali, APPLY(p3.res.planJetonu));
    assert.equal(a3.status, 200);
    // YETIM KILIT: is AWX'te bitti, kimse yoklamadi -> sonraki uygulama devralir.
    h.durum.jobs.set(a3.body.jobId, { status: 'failed', artifacts: {} });
    const p4 = await planUret(h);
    const a4 = await opsBaslat(h, U.ali, APPLY(p4.res.planJetonu));
    assert.equal(a4.status, 200, 'bitmis isin kilidi devralinir');
    // BASLATMA DUSERSE kilit birakilir.
    h.bitir(a4.body.jobId, 'resources_apply', T, ornek.apply());
    await h.istek('GET', `/job-status/1/${a4.body.jobId}`, U.ali);
    assert.equal(h.durum.locks.get(`${T}|wydenapp`).held, 0, '/job-status da birakir');
    const p5 = await planUret(h);
    h.durum.launchHata = 'AWX erisilemez';
    const a5 = await opsBaslat(h, U.ali, APPLY(p5.res.planJetonu));
    assert.equal(a5.status, 502);
    assert.equal(h.durum.locks.get(`${T}|wydenapp`).held, 0, 'baslatilamayan isin kilidi kalmaz');
    h.durum.launchHata = null;
    // Baslamayan is jetonu TUKETMEZ: ayni plan yeniden denenebilir (ve sonra tukenir).
    const a5b = await opsBaslat(h, U.ali, APPLY(p5.res.planJetonu));
    assert.equal(a5b.status, 200, 'baslatilamayan uygulamanin jetonu gecerli kalir');
    h.bitir(a5b.body.jobId, 'resources_apply', T, ornek.apply());
    await h.istek('GET', `/ops-result/1/${a5b.body.jobId}`, U.ali);
    const tuk = await opsBaslat(h, U.ali, APPLY(p5.res.planJetonu));
    assert.equal(tuk.status, 409, 'baslayan isin jetonu tukenir');
    assert.equal(tuk.body.code, 'JETON_YOK');
    // DB kilidi okunamazsa uygulama BASLAMAZ (fail-closed).
    const p6 = await planUret(h);
    const once = h.durum.launches.length;
    h.durum.dbBozuk = true;
    const a6 = await opsBaslat(h, U.ali, APPLY(p6.res.planJetonu));
    h.durum.dbBozuk = false;
    assert.equal(a6.status, 503);
    assert.equal(h.durum.launches.length, once);
  } finally {
    await h.kapat();
  }
});

test('B3 resources_* extra_vars ve gecmis: dosya icerigi YOK, her deger <= 2048, yol yok', async () => {
  const h = await kur();
  try {
    await opsBaslat(h, U.ali, { tenant: T, action: 'resources_get', targets: [], content: 'x'.repeat(4000) });
    const p = await planUret(h);
    await opsBaslat(h, U.ali, APPLY(p.res.planJetonu, { content: 'GIZLI'.repeat(900), valuesPath: '/vhosting/z' }));
    const kaynak = h.durum.launches.filter((l) => /^resources_/.test(l.extraVars.crypto_hub_action));
    assert.equal(kaynak.length, 3);
    for (const l of kaynak) {
      for (const [k, v] of Object.entries(l.extraVars)) {
        assert.ok(!/values_b64|values_path|values_paths|content|chart_ref|backup_path/.test(k), `${k} kaynak isinde olmamali`);
        assert.ok(String(v).length <= 2048, `${k} 2048'i asiyor`);
      }
      if (l.extraVars.crypto_hub_res_changes_b64) {
        const ch = JSON.parse(Buffer.from(l.extraVars.crypto_hub_res_changes_b64, 'base64').toString('utf8'));
        for (const o of ch) assert.deepEqual(Object.keys(o).sort(), ['alan', 'eski', 'yeni']);
      }
    }
    for (const g of h.durum.history.filter((x) => /resources_/.test(x.template_name))) {
      const p2 = JSON.parse(g.params);
      for (const [k, v] of Object.entries(p2)) assert.ok(JSON.stringify(v).length <= 2100, `gecmis ${k}`);
      assert.ok(!g.params.includes('GIZLI'), 'gecmiste icerik');
    }
  } finally {
    await h.kapat();
  }
});

test('RES ayristirici: olculemedi ile yok/gecti KARISMAZ', () => {
  const { parseResourceLines } = require('../resources.cjs');
  const a = parseResourceLines(ornek.get());
  assert.equal(a.limitRange.durum, 'yok', "'- - - - YOK' = olculdu ve yok");
  assert.equal(a.quota.durum, 'yok');
  assert.equal(a.live[0]['requests.memory'], null, 'YOK = spec te yok');
  const b = parseResourceLines([
    `RESLR\t${T}\tlr\tContainer\tmax\tmemory\t4Gi`,
    `RESERR\t${T}\tlimitrange\tForbidden`,
    `RESEND\t${T}\tresources_get\tkismi\tOLCULEMEDI`,
  ]);
  assert.equal(b.limitRange.durum, 'olculemedi', 'okunamadi satiri varken kismi satir olculdu SAYILMAZ');
  assert.equal(b.quota.durum, 'olculemedi', 'satir hic yoksa olculemedi (yok DEGIL)');
  // M3 (entegrasyon denetcisi): LimitRange/kota satiri HIC gelmezse (bastion'da python3 yok,
  // cikti kesik) durum 'olculemedi' kalir - 'yok' DEGIL. Iki kaynak icin de ayri olculur.
  const hic = parseResourceLines([`RESEND\t${T}\tresources_get\tkismi\tOLCULEMEDI`]);
  assert.equal(hic.limitRange.durum, 'olculemedi', 'LimitRange satiri yokken yok sayildi');
  assert.equal(hic.quota.durum, 'olculemedi', 'kota satiri yokken yok sayildi');
  const yalnizKota = parseResourceLines([`RESQUOTA\t${T}\t-\t-\t-\tYOK`]);
  assert.equal(yalnizKota.quota.durum, 'yok');
  assert.equal(yalnizKota.limitRange.durum, 'olculemedi', 'kota yok satiri LimitRange icin yok SAYILMAZ');
  // RESAFFECT 7. alan: bekleyen is yuku (eski betik basmaz -> hedef).
  const af = parseResourceLines([
    `RESAFFECT\t${T}\tStatefulSet\twydenapp-aeron-cluster\tRollingUpdate\t3\tevet\tbekleyen`,
    `RESAFFECT\t${T}\tDeployment\twydenapp-access-gateway\tRollingUpdate\t2\thayir`,
  ]);
  assert.deepEqual(af.affect.map((a) => [a.ad, a.riskli, a.bekleyen]), [
    ['wydenapp-aeron-cluster', true, true],
    ['wydenapp-access-gateway', false, false],
  ]);
  const c = parseResourceLines([`RESPLAN\t${T}\tok\t-\tkisa\t${hex(1)}\t${hex(2)}\t-\thayir\t${hex(3)}`, `RESEND\t${T}\tresources_plan\tok\t-`]);
  assert.equal(require('../resources.cjs').planTemizMi(c), false, 'sha bicimi bozuk plan temiz SAYILMAZ');
  // CELISKILI cikti (RESPLAN dur ama jeton ve RESEND ok): jeton VERILMEZ - her parca ayri sart.
  const celiski = parseResourceLines([
    `RESPLAN\t${T}\tdur\tOLU_ANAHTAR\t${hex(1)}\t${hex(2)}\t${hex(3)}\t-\thayir\t${hex(4)}`,
    `RESEND\t${T}\tresources_plan\tok\t-`,
  ]);
  assert.equal(require('../resources.cjs').planTemizMi(celiski), false, 'DUR plan temiz sayildi');
  const sonsuz = parseResourceLines([
    `RESPLAN\t${T}\tok\t-\t${hex(1)}\t${hex(2)}\t${hex(3)}\t-\thayir\t${hex(4)}`,
    `RESEND\t${T}\tresources_plan\tdur\tKOTA`,
  ]);
  assert.equal(require('../resources.cjs').planTemizMi(sonsuz), false, 'RESEND dur iken temiz sayildi');
  const tam = parseResourceLines([
    `RESPLAN\t${T}\tok\t-\t${hex(1)}\t${hex(2)}\t${hex(3)}\t-\thayir\t${hex(4)}`,
    `RESEND\t${T}\tresources_plan\tok\t-`,
  ]);
  assert.equal(require('../resources.cjs').planTemizMi(tam), true);
  const d = parseResourceLines([`RESPEND\t${T}\tkaynak_disi\tSecret\tx\tdata.parola\tSIR\tSIR2`]);
  assert.equal(d.pending[0].canli, '', 'kaynak disi farkta deger tasinmaz');
  assert.equal(parseResourceLines(null), null);
});

// --- Dogrulayici bulgulari (2026-10-02) ---------------------------------------------

function sonucKayitlari(h) {
  return h.durum.audits
    .filter((x) => x.action === 'crypto_hub_resources_apply' && /"asama":"sonuc"/.test(x.opts.detail))
    .map((x) => ({ ...x, detay: JSON.parse(x.opts.detail) }));
}

test('KJ jeton suresi plan URETILDIGINDE baslar: eski plan isi taze jeton ALAMAZ', async () => {
  const h = await kur();
  const gercek = Date.now;
  const yokla = async (jobId, ofsMs, t) => {
    Date.now = () => t + ofsMs;
    try {
      return (await h.istek('GET', `/ops-result/1/${jobId}`, U.ali)).body.result.resources;
    } finally {
      Date.now = gercek;
    }
  };
  try {
    // (a) AWX bitis ani biliniyor: jeton bitis + 15 dk'da biter; 20 dk sonra yoklanan plan almaz.
    const a = await opsBaslat(h, U.ali, PLAN_GOVDE);
    const t0 = gercek();
    h.bitir(a.body.jobId, 'resources_plan', T, ornek.plan(), 'successful', new Date(t0 + 60000).toISOString());
    const ra = await yokla(a.body.jobId, 20 * 60000, t0);
    assert.equal(ra.planJetonDurumu, 'suresi_doldu');
    assert.equal(ra.planJetonu, null, 'suresi dolmus plana jeton verildi');
    // Ayni durum 10 dk sonra: jeton var, bitisi AWX bitisi + 15 dk (ilk yoklama + 15 DEGIL).
    const b = await opsBaslat(h, U.ali, PLAN_GOVDE);
    const t1 = gercek();
    h.bitir(b.body.jobId, 'resources_plan', T, ornek.plan(), 'successful', new Date(t1 + 60000).toISOString());
    const rb = await yokla(b.body.jobId, 10 * 60000, t1);
    assert.match(rb.planJetonu, /^[0-9a-f]{64}$/);
    assert.equal(rb.planBitis, t1 + 16 * 60000);
    // (b) AWX bitis ani bilinmiyor: plan baslangici + async (15 dk) + 15 dk ust siniri.
    const c = await opsBaslat(h, U.ali, PLAN_GOVDE);
    const t2 = gercek();
    h.bitir(c.body.jobId, 'resources_plan', T, ornek.plan());
    assert.equal((await yokla(c.body.jobId, 40 * 60000, t2)).planJetonDurumu, 'suresi_doldu');
    // (c) Gunler sonra (P1): jeton yok, uygulama da yok.
    const d = await opsBaslat(h, U.ali, PLAN_GOVDE);
    const t3 = gercek();
    h.bitir(d.body.jobId, 'resources_plan', T, ornek.plan());
    const rd = await yokla(d.body.jobId, 3 * 24 * 3600 * 1000, t3);
    assert.equal(rd.planJetonDurumu, 'suresi_doldu');
    assert.equal(rd.planJetonu, null);
  } finally {
    Date.now = gercek;
    await h.kapat();
  }
});

test('KR bekleyen riskli is yuku: RESPLAN riskli=hayir olsa da RESAFFECT riskli satiri ayri onay ister', async () => {
  const h = await kur();
  try {
    const r = await opsBaslat(h, U.ali, PLAN_GOVDE);
    const lines = ornek.plan();
    lines.splice(lines.length - 2, 0, `RESAFFECT\t${T}\tStatefulSet\twydenapp-aeron-cluster\tRollingUpdate\t3\tevet\tbekleyen`);
    h.bitir(r.body.jobId, 'resources_plan', T, lines);
    const s = await h.istek('GET', `/ops-result/1/${r.body.jobId}`, U.ali);
    const tok = s.body.result.resources.planJetonu;
    assert.match(tok, /^[0-9a-f]{64}$/);
    const yok = await opsBaslat(h, U.ali, APPLY(tok));
    assert.equal(yok.status, 428, JSON.stringify(yok.body));
    assert.equal(yok.body.code, 'RISKLI_ONAYSIZ');
  } finally {
    await h.kapat();
  }
});

test('B4 is kapisi: kapali (prod) kiracinin isi kapali; DB-only tarama kaydi sahibine acik', async () => {
  const h = await kur();
  try {
    // MK4: PRODUCTION_ENABLED acikken baslatilmis prod isi, kapaliyken /job-status ile okunamaz.
    h.RES.isKaydet(1, 5555, { username: 'ali', tenantKey: 'wyden_prod_h3', action: 'pods' });
    for (const u of [U.ali, U.admin]) {
      const js = await h.istek('GET', '/job-status/1/5555', u);
      assert.equal(js.status, 403, `kapali kiracinin is ciktisi okundu (${u.username})`);
      assert.equal(js.body.closed, true);
      assert.ok(!JSON.stringify(js.body).includes('cikti 5555'));
    }
    // MK6: Portal yeniden basladi (bellek bos); tarama kaydi yalniz DB'de "Crypto Hub: <kiraci>".
    h.RES._sifirla();
    h.durum.history.push({ username: 'ali', awx_server_id: 1, job_id: 7777, template_name: 'Crypto Hub: wyden_qa_h2' });
    const ok = await h.istek('GET', '/job-status/1/7777', U.ali);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await h.istek('GET', '/job-status/1/7777', U.veli)).status, 403);
    h.durum.history.push({ username: 'veli', awx_server_id: 1, job_id: 7778, template_name: 'Crypto Hub: pods @ wyden_qa_h2' });
    assert.equal((await h.istek('GET', '/job-status/1/7778', U.veli)).status, 200);
  } finally {
    await h.kapat();
  }
});

test('KK kilitAl yarisi: UPDATE 0 satir + INSERT UNIQUE hatasi -> mesgul (alindi DEGIL); satir yoksa hata', async () => {
  const RES = require('../resources.cjs');
  const yaris = (ikinciSatir) => {
    let secim = 0;
    return {
      async query(sql) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (/^UPDATE crypto_hub_locks SET held = 1/.test(s)) return { rows: [], rowCount: 0 };
        if (/^SELECT TOP 1 held/.test(s)) {
          secim += 1;
          if (secim === 1 || !ikinciSatir) return { rows: [], rowCount: 0 };
          return { rows: [{ held: 1, holder: 'veli', awx_server_id: 1, awx_job_id: 9 }], rowCount: 1 };
        }
        if (/^INSERT INTO crypto_hub_locks/.test(s)) throw new Error('UNIQUE KEY ihlali');
        throw new Error(`beklenmeyen sorgu: ${s.slice(0, 60)}`);
      },
    };
  };
  const g = { tenantKey: T, release: 'wydenapp', username: 'ali', lockId: 'x' };
  const k = await RES.kilitAl(yaris(true), g);
  assert.equal(k.durum, 'mesgul', 'yarista ikinci istek de kilidi aldigini sandi');
  assert.equal(k.sahip.holder, 'veli');
  await assert.rejects(RES.kilitAl(yaris(false), g), /UNIQUE/);
});

test('KK values_put / values_restore / helm_upgrade: CPU/bellek uygulamasi surerken 409; kilit okunamazsa 503', async () => {
  const h = await kur();
  try {
    const p = await planUret(h);
    const a = await opsBaslat(h, U.ali, APPLY(p.res.planJetonu));
    assert.equal(a.status, 200);
    const yol = '/vhosting/a/garanti_values.yaml';
    const govdeler = [
      { tenant: T, action: 'values_put', targets: [], confirmed: true, valuesPath: yol, content: 'a: 1\n' },
      { tenant: T, action: 'values_restore', targets: [], confirmed: true, valuesPath: yol, backupPath: `${yol}.20261002.bak` },
      { tenant: T, action: 'helm_upgrade', targets: [], confirmed: true, release: 'wydenapp', valuesPath: yol },
    ];
    const once = h.durum.launches.length;
    for (const g of govdeler) {
      const r = await opsBaslat(h, U.veli, g);
      assert.equal(r.status, 409, `${g.action}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, 'KILIT');
    }
    assert.equal(h.durum.launches.length, once, 'kilit varken AWX isi baslatildi');
    h.durum.dbBozuk = true;
    const bozuk = await opsBaslat(h, U.veli, govdeler[0]);
    h.durum.dbBozuk = false;
    assert.equal(bozuk.status, 503, 'kilit okunamadan yazan islem baslatildi');
    // Uygulama bitti (kimse yoklamadi): values_put gecer, onceki isin sonucu da kapatilir.
    h.bitir(a.body.jobId, 'resources_apply', T, ornek.apply());
    const sonra = await opsBaslat(h, U.veli, govdeler[0]);
    assert.equal(sonra.status, 200, JSON.stringify(sonra.body));
    const s = sonucKayitlari(h);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].detay.yol, s[0].detay.isSahibi, s[0].detay.yoklayan], ['devralma', 'ali', 'veli']);
  } finally {
    await h.kapat();
  }
});

test('KS uygulama SONUC kaydi istemciden bagimsiz: /job-status, devralma, suresi dolmus kilit, tarama; tek kez', async () => {
  const h = await kur();
  const kilit = () => h.durum.locks.get(`${T}|wydenapp`);
  try {
    // (1) Ekran kapandi; is-takipcisi yalniz /job-status'u yokluyor.
    const p1 = await planUret(h);
    const a1 = await opsBaslat(h, U.ali, APPLY(p1.res.planJetonu));
    h.bitir(a1.body.jobId, 'resources_apply', T, ornek.apply({ sonuc: 'geri_alinamadi' }), 'failed');
    assert.equal((await h.istek('GET', `/job-status/1/${a1.body.jobId}`, U.ali)).status, 200);
    let s = sonucKayitlari(h);
    assert.equal(s.length, 1, '/job-status yolunda sonuc kaydi yazilmadi');
    assert.deepEqual([s[0].detay.sonuc, s[0].detay.yol, s[0].opts.username], ['geri_alinamadi', 'job-status', 'ali']);
    assert.equal(kilit().held, 0);
    await h.istek('GET', `/ops-result/1/${a1.body.jobId}`, U.ali);
    assert.equal(sonucKayitlari(h).length, 1, 'ayni sonuc ikinci kez yazildi');
    // (2) Devralma: ali'nin isi bitti, kimse yoklamadi; veli yeni uygulama baslatiyor.
    const p2 = await planUret(h);
    const a2 = await opsBaslat(h, U.ali, APPLY(p2.res.planJetonu));
    h.bitir(a2.body.jobId, 'resources_apply', T, ornek.apply({ sonuc: 'uygulandi_sorunlu' }));
    const p3 = await planUret(h, U.veli);
    const a3 = await opsBaslat(h, U.veli, APPLY(p3.res.planJetonu));
    assert.equal(a3.status, 200, JSON.stringify(a3.body));
    s = sonucKayitlari(h);
    assert.equal(s.length, 2, 'devralmada onceki isin sonucu kaydedilmedi');
    assert.deepEqual(
      [s[1].detay.sonuc, s[1].detay.yol, s[1].detay.isSahibi, s[1].detay.yoklayan, s[1].opts.username],
      ['uygulandi_sorunlu', 'devralma', 'ali', 'veli', 'ali'],
    );
    // (3) Suresi dolmus (yetim) kilit: CAS UPDATE devralmadan ONCE onceki isin sonucu kapatilir.
    h.bitir(a3.body.jobId, 'resources_apply', T, ornek.apply());
    kilit().locked_until = Date.now() - 1000;
    const p4 = await planUret(h);
    const a4 = await opsBaslat(h, U.ali, APPLY(p4.res.planJetonu));
    assert.equal(a4.status, 200);
    s = sonucKayitlari(h);
    assert.equal(s.length, 3, 'suresi dolmus kilidin isinin sonucu kayboldu');
    assert.equal(s[2].detay.isSahibi, 'veli');
    // (4) Arka plan taramasi (pencere kapali, kimse yoklamiyor). Sonuc satiri yoksa 'olculemedi'.
    h.bitir(a4.body.jobId, 'resources_apply', T, [], 'failed');
    assert.equal(await h.mod.uygulamaSonuclariniTara(), 1);
    s = sonucKayitlari(h);
    assert.deepEqual(
      [s[3].detay.yol, s[3].detay.yoklayan, s[3].detay.isSahibi, s[3].detay.sonuc],
      ['tarama', 'sistem', 'ali', 'olculemedi'],
    );
    assert.equal(kilit().held, 0);
    assert.equal(await h.mod.uygulamaSonuclariniTara(), 0, 'tarama ayni sonucu ikinci kez yazdi');
    // (5) Portal yeniden basladi (bellek bos): yoklama ikinci kayit URETMEZ (isaret DB'de).
    h.RES._sifirla();
    assert.equal((await h.istek('GET', `/ops-result/1/${a4.body.jobId}`, U.ali)).status, 200);
    assert.equal(sonucKayitlari(h).length, 4);
  } finally {
    await h.kapat();
  }
});

test('KS sonucu ilk Admin acsa da kayit IS SAHIBI adina; yoklayan ayri alan', async () => {
  const h = await kur();
  try {
    const p = await planUret(h);
    const a = await opsBaslat(h, U.ali, APPLY(p.res.planJetonu));
    h.bitir(a.body.jobId, 'resources_apply', T, ornek.apply());
    assert.equal((await h.istek('GET', `/ops-result/1/${a.body.jobId}`, U.admin)).status, 200);
    const s = sonucKayitlari(h);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].opts.username, s[0].detay.isSahibi, s[0].detay.yoklayan], ['ali', 'ali', 'boss']);
    await h.istek('GET', `/ops-result/1/${a.body.jobId}`, U.ali);
    assert.equal(sonucKayitlari(h).length, 1);
  } finally {
    await h.kapat();
  }
});
