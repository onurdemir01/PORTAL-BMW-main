// server/crypto-hub/__tests__/smart-ayar.test.cjs - Crypto Hub kendi Smart ayari ve Smart kapali
// dogrudan yol (D7).
//
// SA: ayar uclari, token, blok kurali, okuma hatasi, kiraci kapisi, kaynak baglami, denetim.
// DY: dogrudan yol. "Production kapali olamaz" kararlari RESOLVER biriminde sinanir: NODE_PROD_ACIK
// bos oldugundan /node-change prod kiraciyi 403'te durdurur, uc testi bu kapiya kor kalirdi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_node_harness.cjs');
const { CRYPTO_TENANTS, tenantOf } = require('../../../shared/cryptoHubTenants.cjs');

const { K, GOVDE, T, G_EVM, G_BTC, SIR } = H;
const TOKEN = 'CRYPTO+TOKEN/abc123=';
const SABLON = 'KONU: {{ opsx.kiraci }}\nACIKLAMA: {{ opsx.aciklama }}';
const YORUM = '# KONU: {{ opsx.kiraci }}\n   # ACIKLAMA: x\n';
const KENDI = { enabled: true, flowKey: 'FLOW_CRYPTO', metadataFields: SABLON };

async function ile(fn, o) {
  const h = await H.kur(o);
  try {
    await fn(h);
  } finally {
    await h.kapat();
  }
}

const put = (h, smart, user = K.admin) => h.istek('PUT', '/smart-config', user, { smart });
const dogrudanAc = (h) => {
  h.d.cryptoSmart = { enabled: false, flowKey: '', metadataFields: '', integrationKey: '' };
  h.okumaVer();
};
// Sihirbaz onaysiz metni gosterdiyse gonderir; kapiyi acmaz, uyusmazlikta durdurur (DY13).
const DG = (o = {}) => GOVDE({ onaysizKabul: true, ...o });
const aksiyonlar = (h) => h.d.audits.map((a) => a.action);
const denetimDetay = (h, ad) => JSON.parse(h.d.audits.find((a) => a.action === ad).opts.detail);

test('SA1 uclar yalniz Admin; requireAdmin yoksa DENY', async () => {
  await ile(async (h) => {
    for (const [m, u, b] of [
      ['GET', '/smart-config'],
      ['PUT', '/smart-config', { smart: { enabled: false } }],
      ['POST', '/smart-config/onizle', { metadataFields: SABLON }],
    ]) {
      assert.equal((await h.istek(m, u, K.nodecu, b)).status, 403, `${m} ${u} Admin olmayana acik`);
      assert.equal((await h.istek(m, u, null, b)).status, 401, `${m} ${u} oturumsuz acik`);
    }
    assert.equal(h.d.cryptoSmart, null, 'Admin olmayan yazdi');
    assert.equal((await h.istek('GET', '/smart-config', K.admin)).status, 200);
  });
  await ile(
    async (h) => {
      const r = await h.istek('GET', '/smart-config', K.admin);
      assert.equal(r.status, 403, 'auth modulu admin kapisi vermezken uc acik kaldi');
    },
    { adminYok: true },
  );
});

test('SA2 token sifreli saklanir, API ve denetime donmez; bos token korunur', () =>
  ile(async (h) => {
    let r = await put(h, { ...KENDI, integrationKey: TOKEN });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.smart.integrationKeySet, true);
    assert.ok(!JSON.stringify(r.body).includes(TOKEN), 'PUT yaniti token dondurdu');
    assert.ok(String(h.d.cryptoSmart.integrationKey).startsWith('enc:v1:'), 'token sifresiz saklandi');
    r = await h.istek('GET', '/smart-config', K.admin);
    assert.equal(r.body.smart.integrationKeySet, true);
    assert.ok(!('integrationKey' in r.body.smart));
    assert.ok(!JSON.stringify(r.body).includes(h.d.cryptoSmart.integrationKey), 'GET sifreli degeri dondurdu');
    assert.ok(!JSON.stringify(h.d.audits).includes(TOKEN), 'token denetime yazildi');
    assert.ok(!JSON.stringify(h.d.audits).includes(h.d.cryptoSmart.integrationKey), 'sifreli token denetime yazildi');
    assert.ok(!h.d.logs.join('\n').includes(TOKEN), 'token loga yazildi');
    const saklanan = h.d.cryptoSmart.integrationKey;
    r = await put(h, { ...KENDI, integrationKey: '' });
    assert.equal(r.status, 200);
    assert.equal(h.d.cryptoSmart.integrationKey, saklanan, 'bos token mevcut degeri sildi');
    // flowKey + sablon birlikte silinir: token da gider.
    r = await put(h, { flowKey: '', metadataFields: '' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(h.d.cryptoSmart.integrationKey, '', 'flow silindi, token kaldi');
    r = await put(h, { integrationKey: TOKEN });
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'crypto_smart_token_flowsuz');
    assert.equal(h.d.cryptoSmart.integrationKey, '');
  }));

test('SA2b token bekleyen pakete inmez: createTicket alir, pending_launch_json tasimaz', () =>
  ile(async (h) => {
    assert.equal((await put(h, { ...KENDI, integrationKey: TOKEN })).status, 200);
    h.okumaVer();
    const r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(h.d.smartCreated[0].integrationKey, TOKEN, 'bilet token ile acilmadi');
    const t = h.d.smartTickets[0];
    assert.ok(!t.pending_launch_json.includes(TOKEN), 'cozulmus token pending_launch_json a yazildi');
    const paket = JSON.parse(t.pending_launch_json);
    assert.deepEqual(paket.overrides, {}, 'bekleyen pakette smartApproval kaldi');
    assert.equal(paket.launchOncesi, 'crypto_hub_node');
    // Kanca (onay sonrasi) bu paketle calismaya devam eder.
    const kanca = await h.kanca(t.id);
    assert.ok(kanca.extraVars.crypto_hub_node_yeni_b64);
  }));

test('SA2c OpsX blogunun token i da bekleyen pakete inmez', () =>
  ile(async (h) => {
    h.okumaVer();
    const r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(h.d.smartCreated[0].integrationKey, 'RFF');
    assert.deepEqual(JSON.parse(h.d.smartTickets[0].pending_launch_json).overrides, {});
  }));

test('SA2d Flow Key degisince eski token silinir; ayni flow ve kismi govde korur; yeni token yazilir', () =>
  ile(async (h) => {
    await put(h, { ...KENDI, integrationKey: TOKEN });
    const saklanan = h.d.cryptoSmart.integrationKey;
    assert.equal((await put(h, { flowKey: 'FLOW_CRYPTO', integrationKey: '' })).status, 200);
    assert.equal(h.d.cryptoSmart.integrationKey, saklanan, 'ayni flow token sildi');
    assert.equal((await put(h, { metadataFields: 'X: 1' })).status, 200);
    assert.equal(h.d.cryptoSmart.integrationKey, saklanan, 'flow dokunulmadi, token silindi');
    let r = await put(h, { flowKey: 'FLOW_YENI', integrationKey: '' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(h.d.cryptoSmart.integrationKey, '', 'eski token yeni flow a yapisti');
    assert.equal(r.body.smart.integrationKeySet, false);
    assert.equal(denetimDetay(h, 'crypto_hub_smart_config_save').integrationKeySet, true, 'ilk kayit');
    assert.equal(JSON.parse(h.d.audits.filter((a) => a.action === 'crypto_hub_smart_config_save').at(-1).opts.detail).integrationKeyDegisti, true);
    await put(h, { flowKey: 'FLOW_IKI', integrationKey: TOKEN });
    assert.ok(h.d.cryptoSmart.integrationKey.startsWith('enc:v1:'), 'flow ile birlikte gelen token yazilmadi');
  }));

test('SA3 sifreleme anahtari yoksa token reddedilir, duz metin yazilmaz', () =>
  ile(async (h) => {
    const once = process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
    delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
    try {
      const r = await put(h, { ...KENDI, integrationKey: TOKEN });
      assert.equal(r.status, 400);
      assert.equal(r.body.blocked, 'crypto_smart_sifreleme_yok');
      assert.equal(h.d.cryptoSmart, null, 'anahtarsiz token kaydi satir yazdi');
      // Tokensiz kayit anahtar gerektirmez.
      assert.equal((await put(h, KENDI)).status, 200);
      assert.equal((await h.istek('GET', '/smart-config', K.admin)).body.sifrelemeVar, false);
    } finally {
      process.env.ENV_OVERRIDES_ENCRYPTION_KEY = once;
    }
  }));

test('SA4 gecersiz desen bildirilir ve hicbir sey yazilmaz', () =>
  ile(async (h) => {
    await put(h, KENDI);
    const yedek = JSON.stringify(h.d.cryptoSmart);
    for (const [govde, alan] of [
      [{ flowKey: 'bosluk var' }, 'flowKey'],
      [{ integrationKey: 'sat\nir' }, 'integrationKey'],
      [{ metadataFields: `A: ${'x'.repeat(20001)}` }, 'metadataFields'],
    ]) {
      const r = await put(h, { ...govde, enabled: false });
      assert.equal(r.status, 400, alan);
      assert.deepEqual(r.body.reddedilen, [alan]);
      assert.equal(JSON.stringify(h.d.cryptoSmart), yedek, `reddedilen govde yazdi: ${alan}`);
    }
    assert.ok(!aksiyonlar(h).includes('crypto_hub_smart_kapatildi'), 'reddedilen kayit denetime kapatma yazdi');
  }));

test('SA5 kismi govde enabled degistirmez; yalniz gercek boolean degistirir', () =>
  ile(async (h) => {
    await put(h, { enabled: false });
    assert.equal(h.d.cryptoSmart.enabled, false);
    await put(h, { flowKey: '', metadataFields: '' });
    assert.equal(h.d.cryptoSmart.enabled, false, 'kismi govde kapaliyi acti');
    await put(h, { enabled: true });
    await put(h, {});
    assert.equal(h.d.cryptoSmart.enabled, true, 'bos govde acigi kapatti');
    for (const v of ['false', 0, null]) {
      await put(h, { enabled: v });
      assert.equal(h.d.cryptoSmart.enabled, true, `enabled=${JSON.stringify(v)} Smart'i kapatti`);
    }
    // DB'deki bozuk deger de kapatmaz.
    h.d.cryptoSmart = { enabled: 'false' };
    assert.equal((await h.SA.oku()).enabled, true);
  }));

test('SA6 okuma hatasi "satir yok" degildir: 503, OpsX flow una DUSMEZ, yazmaz', () =>
  ile(async (h) => {
    h.okumaVer();
    for (const bozuk of [
      (d) => (d.cryptoSmartBozuk = true),
      (d) => (d.cryptoSmart = '{bozuk json'),
      (d) => (d.cryptoSmart = '[1,2]'),
    ]) {
      bozuk(h.d);
      await assert.rejects(h.SA.cryptoSmartCoz(tenantOf(T)));
      let r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
      assert.equal(r.status, 503, JSON.stringify(r.body));
      assert.equal(r.body.blocked, 'crypto_node_smart_okunamadi');
      r = await h.istek('POST', '/node-smart-onizle', K.admin, { tenant: T, grup: G_EVM });
      assert.equal(r.status, 503);
      r = await h.istek('GET', '/smart-config', K.admin);
      assert.equal(r.status, 503);
      r = await put(h, { enabled: false });
      assert.equal(r.status, 503, 'okunamayan satirin ustune yazildi');
      assert.equal(h.d.smartCreated.length, 0, 'okuma hatasinda OpsX flow una bilet acildi');
      assert.equal(h.d.ssLaunches.length, 0);
      assert.equal(h.d.rows.length, 0);
      h.d.cryptoSmartBozuk = false;
      h.d.cryptoSmart = null;
    }
    // /nodes acilir ama "kapali" uydurmaz.
    h.d.cryptoSmartBozuk = true;
    const r = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(r.status, 200);
    assert.equal(r.body.smartMod, 'onay');
  }));

test('SA7 dort hucreli blok tablosu + yalniz yorum sablon', () =>
  ile(async (h) => {
    const hucre = [
      [{ flowKey: '', metadataFields: '' }, 'bos'],
      [{ flowKey: 'F', metadataFields: SABLON }, 'dolu'],
      [{ flowKey: 'F', metadataFields: '' }, 'yarim'],
      [{ flowKey: '', metadataFields: SABLON }, 'yarim'],
      [{ flowKey: 'F', metadataFields: YORUM }, 'yarim'],
      [{ flowKey: '', metadataFields: YORUM }, 'bos'],
    ];
    h.okumaVer();
    for (const [blok, beklenen] of hucre) {
      assert.equal(h.SA.blokDurumu(blok), beklenen, JSON.stringify(blok));
      h.d.cryptoSmart = null;
      const r = await put(h, blok);
      assert.equal(r.status, beklenen === 'yarim' ? 400 : 200, JSON.stringify(blok));
      if (beklenen === 'yarim') {
        assert.equal(r.body.blocked, 'crypto_smart_yarim');
        assert.equal(h.d.cryptoSmart, null, 'yarim blok yazildi');
        // DB'ye baska yoldan gelmis yarim satir: resolver reddeder.
        h.d.cryptoSmart = blok;
        const t = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
        assert.equal(t.status, 503, JSON.stringify(t.body));
        assert.equal(t.body.blocked, 'crypto_node_smart_yarim');
        assert.equal(h.d.smartCreated.length, 0, 'yarim blokla bilet acildi');
      }
    }
    // Gecersiz flow key DB'den gelirse yarim sayilir.
    assert.equal(h.SA.blokDurumu({ flowKey: 'bos luk', metadataFields: SABLON }), 'yarim');
    // Kendi flow'un yalniz yorum sablonu cryptoNodeMetadata'dan da gecmez.
    assert.throws(() => h.NODE.cryptoNodeMetadata(YORUM, {}, {}, {}, { kaynak: 'crypto' }), /Crypto Hub Smart şablonu boş/);
    assert.throws(() => h.NODE.cryptoNodeMetadata(YORUM, {}, {}, {}, {}), /OpsX OpenShift Smart şablonu boş/);
  }));

test('SA8 production kiracida enabled:false Smart yolunda kalir (resolver birimi, tum kiracilar)', () =>
  ile(async (h) => {
    h.d.cryptoSmart = { enabled: false, flowKey: '', metadataFields: '' };
    const sayac = { kapali: 0, onay: 0 };
    for (const t of CRYPTO_TENANTS) {
      const k = await h.SA.cryptoSmartCoz(t);
      if (t.production !== false) assert.equal(k.mod, 'onay', `${t.key}: production kiracida Smart kapandi`);
      else assert.equal(k.mod, 'kapali', `${t.key}: test kiracisinda ayar etkisiz`);
      sayac[k.mod] += 1;
    }
    assert.ok(sayac.onay > 0 && sayac.kapali > 0);
    // Saf karar: savunma kademeleri.
    const K0 = h.SA.smartKapaliMi;
    const kapali = { enabled: false };
    assert.equal(K0(tenantOf(T), kapali), true);
    assert.equal(K0(tenantOf(T), { enabled: true }), false);
    assert.equal(K0(tenantOf(T), {}), false);
    assert.equal(K0(tenantOf(T), null), false);
    assert.equal(K0(null, kapali), false);
    assert.equal(K0({ production: undefined, key: 'x' }, kapali), false, 'production tanimsiz kiraci kapali sayildi');
    assert.equal(K0({ production: 0, key: 'x' }, kapali), false, 'production falsy kiraci kapali sayildi');
    // Listede `production` yanlis yazilsa bile etiket kapiyi tutar.
    assert.equal(K0({ production: false, key: 'metaco_das_prod' }, kapali), false, 'prod anahtari gecti');
    assert.equal(K0({ production: false, key: 'x', cluster: 'giocpank3rdwyprod1' }, kapali), false, 'prod cluster gecti');
    assert.equal(K0({ production: false, key: 'x', env: 'prod' }, kapali), false, 'prod ortam gecti');
  }));

test('SA8b production kiraci acik benzetiminde enabled:false yine bilet acar, is baslatmaz', () =>
  ile(async (h) => {
    const N = require('../../../shared/cryptoHubNodes.cjs');
    const once = N.nodeAcikMi;
    N.nodeAcikMi = (t) => !!t && t.app === 'metaco';
    try {
      h.d.cryptoSmart = { enabled: false, flowKey: '', metadataFields: '' };
      h.okumaVer({}, Date.now(), 'metaco_das_prod');
      const r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ tenant: 'metaco_das_prod', onayMetni: G_EVM }));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.pendingApproval, true);
      assert.equal(h.d.smartCreated.length, 1, 'production kiracida bilet acilmadi');
      assert.equal(h.d.ssLaunches.length, 0, 'production kiracida onaysiz is baslatildi');
      assert.ok(!aksiyonlar(h).includes('crypto_hub_node_onaysiz_calisti'));
    } finally {
      N.nodeAcikMi = once;
    }
  }));

test("SA9 OpsX'in enabled:false'u Crypto Hub'i acmaz; Crypto ayari yokken eski davranis", () =>
  ile(async (h) => {
    h.okumaVer();
    h.d.opsxCfg.smart.openshift.enabled = false;
    const k = await h.SA.cryptoSmartCoz(tenantOf(T));
    assert.equal(k.mod, 'onay', 'OpsX enabled:false Crypto modunu degistirdi');
    assert.equal(k.kaynak, 'opsx');
    const r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.pendingApproval, true);
    assert.equal(h.d.smartCreated[0].flowKey, 'FLOW_OPENSHIFT');
    assert.equal(h.d.ssLaunches.length, 0);
    assert.equal(h.d.smartCreated[0].integrationKey, 'RFF', 'OpsX blogunda OpsX token i kullanilmadi');
    assert.match(h.d.smartCreated[0].metadata.ACIKLAMA, /OpsX OpenShift onay akışı ortak kullanılır/);
    assert.ok(h.d.sira.includes('sablon:55'), 'OpsX bloğunda OpsX template i okunmadi');
  }));

test('SA10 kendi blok: token Crypto nun, yoksa sistem token i (OpsX in degil); baglam OPS_KEY, anahtarlar bos', () =>
  ile(async (h) => {
    h.okumaVer();
    h.d.opsxCfg.openshift.extraVars = 'job_type: rollout';
    h.d.opsxCfg.openshift.ocClusterKey = 'opsx_cluster_adi';
    h.d.sablonVarsayilan = { kaynak_isareti: 'ops' };
    await put(h, { flowKey: 'FLOW_CRYPTO', metadataFields: `${SABLON}\nVAR: {{ extraVars.kaynak_isareti }}\nCL: {{ extraVars.oc_cluster }}` });
    let r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = h.d.smartCreated[0];
    assert.equal(s.flowKey, 'FLOW_CRYPTO');
    assert.equal(s.integrationKey, undefined, 'sistem token i yerine OpsX token i gitti');
    assert.equal(s.metadata.KONU, T);
    assert.equal(s.metadata.VAR, 'ops');
    assert.equal(s.metadata.CL, 'metaco_das', 'kendi blokta OpsX anahtar adi kullanildi');
    assert.doesNotMatch(s.metadata.ACIKLAMA, /OpsX OpenShift onay akışı/);
    assert.match(s.metadata.ACIKLAMA, /NODE DEĞİŞİKLİĞİ \(rollout\/restart değil\)/);
    assert.ok(h.d.sira.includes('sablon:77') && !h.d.sira.includes('sablon:55'), 'kendi blokta OpsX template i okundu');
    // Kendi token: bilete cozulmus gider.
    await put(h, { integrationKey: TOKEN });
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ grup: G_BTC }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(h.d.smartCreated[1].integrationKey, TOKEN);
    assert.ok(!JSON.stringify(h.d.audits).includes(TOKEN), 'token denetime gitti');
    // Bozuk sifreli token okuma hatasidir: sistem token ina ya da OpsX'e dusmez.
    h.d.cryptoSmart.integrationKey = 'enc:v1:bozuk';
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ grup: H.G_LTC }));
    assert.equal(r.status, 503);
    assert.equal(r.body.blocked, 'crypto_node_smart_okunamadi');
    assert.equal(h.d.smartCreated.length, 2);
  }));

test('SA10b kendi blokta sablon hatasi OpsX ipucu vermez; onizleme kaynak ve mod doner', () =>
  ile(async (h) => {
    h.okumaVer();
    await put(h, { flowKey: 'FLOW_CRYPTO', metadataFields: 'A: {{ opsx.olmayan }}' });
    const r = await h.istek('POST', '/node-smart-onizle', K.admin, { tenant: T, grup: G_EVM });
    assert.equal(r.status, 200);
    assert.equal(r.body.kaynak, 'crypto');
    assert.equal(r.body.smartMod, 'onay');
    assert.equal(r.body.flowKey, 'FLOW_CRYPTO');
    assert.ok(r.body.hata && !/OpsX'e özgü/.test(r.body.hata), r.body.hata);
    h.d.cryptoSmart = null;
    const o = await h.istek('POST', '/node-smart-onizle', K.admin, { tenant: T, grup: G_EVM });
    assert.equal(o.body.kaynak, 'opsx');
    assert.ok(o.body.metadata);
  }));

test('SA11 denetim: kaydet + kapatma/acma deltasi davranissal', () =>
  ile(async (h) => {
    await put(h, { enabled: false });
    assert.deepEqual(denetimDetay(h, 'crypto_hub_smart_config_save').enabled, { onceki: true, yeni: false });
    assert.deepEqual(denetimDetay(h, 'crypto_hub_smart_kapatildi'), { onceki: true, yeni: false });
    assert.ok(!aksiyonlar(h).includes('crypto_hub_smart_acildi'));
    h.d.audits.length = 0;
    await put(h, { flowKey: '' });
    assert.deepEqual(aksiyonlar(h), ['crypto_hub_smart_config_save'], 'enabled degismeden delta yazildi');
    h.d.audits.length = 0;
    await put(h, { enabled: true });
    assert.deepEqual(denetimDetay(h, 'crypto_hub_smart_acildi'), { onceki: false, yeni: true });
    assert.ok(!aksiyonlar(h).includes('crypto_hub_smart_kapatildi'));
  }));

test('SA12 taslak onizleme: gercek cryptoNodeMetadata, Smart a gitmez, yazmaz', () =>
  ile(async (h) => {
    h.d.sablonVarsayilan = { kaynak_isareti: 'ops' };
    const o = (metadataFields) => h.istek('POST', '/smart-config/onizle', K.admin, { metadataFields });
    let r = await o(`${SABLON}\nVAR: {{ extraVars.kaynak_isareti }}\nCOK: {{ extraVars.choise }}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.metadata.KONU, 'metaco_das_test');
    assert.equal(r.body.metadata.VAR, 'ops');
    assert.equal(r.body.metadata.COK, 'true', 'gercek metaGorunum kullanilmadi');
    assert.match(r.body.metadata.ACIKLAMA, /NODE DEĞİŞİKLİĞİ/);
    assert.doesNotMatch(r.body.metadata.ACIKLAMA, /OpsX OpenShift onay akışı/);
    assert.equal(h.d.smartCreated.length, 0);
    assert.equal(h.d.cryptoSmart, null, 'onizleme kayit yazdi');
    r = await o('');
    assert.equal(r.status, 200);
    assert.equal(r.body.metadata, null);
    assert.match(r.body.hata, /Crypto Hub Smart şablonu boş/);
    r = await o(YORUM);
    assert.match(r.body.hata, /şablonu boş/, 'yalniz yorum sablon bos sayilmadi');
    r = await o('A: {{ extraVars.openshift_operations }}');
    assert.ok(r.body.hata, 'openshift_operations kullanan sablon render edildi');
    r = await o(`A: ${'x'.repeat(20001)}`);
    assert.equal(r.status, 400);
  }));

test('SA13 /nodes smartMod + smartKaynak; ekran ozeti dort durum', () =>
  ile(async (h) => {
    const nodes = async () => (await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu)).body;
    const ozet = async () => (await h.istek('GET', '/smart-config', K.admin)).body;
    let n = await nodes();
    assert.deepEqual([n.smartMod, n.smartKaynak], ['onay', 'opsx']);
    let o = await ozet();
    assert.deepEqual([o.durum, o.kaynak, o.opsxFlowKey], ['opsx', 'opsx', 'FLOW_OPENSHIFT']);
    assert.ok(!JSON.stringify(o).includes('RFF'), 'OpsX token i ekrana dondu');
    await put(h, KENDI);
    n = await nodes();
    assert.deepEqual([n.smartMod, n.smartKaynak], ['onay', 'crypto']);
    assert.equal((await ozet()).durum, 'kendi');
    await put(h, { enabled: false });
    n = await nodes();
    assert.deepEqual([n.smartMod, n.smartKaynak], ['kapali', 'crypto']);
    assert.equal((await ozet()).durum, 'testte_kapali');
    await put(h, { enabled: true, flowKey: '', metadataFields: '' });
    const flow = h.d.opsxCfg.smart.openshift.flowKey;
    h.d.opsxCfg.smart.openshift.flowKey = '';
    const envOnce = process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT;
    delete process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT;
    o = await ozet();
    if (envOnce !== undefined) process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT = envOnce;
    h.d.opsxCfg.smart.openshift.flowKey = flow;
    assert.deepEqual([o.durum, o.kaynak], ['eksik', null]);
    h.d.cryptoSmart = { flowKey: 'F', metadataFields: '' };
    assert.equal((await ozet()).durum, 'eksik');
  }));

test('SA13b ekran durumu talebin gercek sonucunu gizlemez: yarim+kapali eksik, cozulemeyen token ayri', () =>
  ile(async (h) => {
    const durum = async () => (await h.istek('GET', '/smart-config', K.admin)).body;
    h.okumaVer();
    h.d.cryptoSmart = { enabled: false, flowKey: 'FLOW_CRYPTO', metadataFields: '' };
    let b = await durum();
    assert.equal(b.durum, 'eksik', 'yarim blok testte_kapali gosterildi');
    let t = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(t.body.blocked, 'crypto_node_smart_yarim');
    for (const enabled of [true, false]) {
      h.d.cryptoSmart = { ...KENDI, enabled, integrationKey: 'enc:v1:bozuk' };
      b = await durum();
      assert.equal(b.durum, 'token_cozulemedi', `enabled=${enabled}: bozuk token gizlendi`);
      assert.ok(!JSON.stringify(b).includes('bozuk'), 'saklanan deger ekrana dondu');
      t = await h.istek('POST', '/node-change', K.nodecu, enabled ? GOVDE() : DG());
      assert.equal(t.body.blocked, 'crypto_node_smart_okunamadi');
    }
    await put(h, { ...KENDI, enabled: true, integrationKey: TOKEN });
    assert.equal((await durum()).durum, 'kendi', 'cozulen token uyari verdi');
    h.d.cryptoSmart = { ...KENDI, enabled: false };
    assert.equal((await durum()).durum, 'testte_kapali', 'tokensiz dolu blok kapali gorunmedi');
  }));

test('SA14 kapi kaynagi: govdeden alan okunmaz, NODE_ENV kullanilmaz, admin atlama baglanmaz', () =>
  ile(async (h) => {
    const dizin = path.join(__dirname, '..');
    const AYAR = fs.readFileSync(path.join(dizin, 'smart-ayar.cjs'), 'utf8');
    const NODE = fs.readFileSync(path.join(dizin, 'node.cjs'), 'utf8');
    assert.doesNotMatch(AYAR, /process.env/);
    assert.doesNotMatch(AYAR + NODE, /admin-smart-atla|adminSmartAtliyor/);
    // Davranis: Smart acikken govdedeki hicbir alan modu cevirmez.
    h.okumaVer();
    const r = await h.istek('POST', '/node-change', K.nodecu, { ...GOVDE(), production: false, smartMod: 'kapali', enabled: false, onaysiz: true });
    assert.equal(r.body.pendingApproval, true);
    assert.equal(h.d.ssLaunches.length, 0);
    // NODE_ENV=production test kiracisini kapatmaz, prod kiraciyi acmaz.
    const once = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      h.d.cryptoSmart = { enabled: false };
      assert.equal((await h.SA.cryptoSmartCoz(tenantOf(T))).mod, 'kapali');
      assert.equal((await h.SA.cryptoSmartCoz(tenantOf('metaco_das_prod'))).mod, 'onay');
    } finally {
      if (once === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = once;
    }
  }));

// ── Dogrudan yol ─────────────────────────────────────────────────────────────────────
const ps = (h, id) => h.d.rows.find((x) => x.id === id).plan_sha;
const isBitir = (h, jobId, lines, status = 'successful') =>
  h.d.jobs.set(jobId, { status, artifacts: { crypto_hub_ops_result: { tenant: T, action: 'node_change', lines } } });

test('DY1 Smart kapali test kiracisi: is baslar, bilet yok, deger korunur, kilit tarama ile kapanir', () =>
  ile(async (h) => {
    dogrudanAc(h);
    const r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const b = r.body;
    assert.equal(b.ok, true);
    assert.equal(b.pendingApproval, false);
    assert.equal(b.onaysiz, true);
    assert.equal(b.awxServerId, 1);
    assert.ok(b.jobId > 0 && b.talepId > 0);
    assert.equal(b.ticketId, undefined);
    assert.equal(h.d.smartCreated.length, 0, 'Smart yoluna gidildi');
    assert.equal(h.d.smartTickets.length, 0);
    assert.equal(h.d.launches.length, 0, 'launchJobOnServer kullanildi (gizliler yok)');
    assert.equal(h.d.ssLaunches.length, 1);
    const l = h.d.ssLaunches[0];
    assert.equal(l.yutmaKorumasi, true);
    assert.equal(l.templateId, 77);
    assert.deepEqual(l.specFields, [{ variable: 'crypto_hub_node_yeni_b64', type: 'password' }]);
    assert.deepEqual(l.detail, { ask_limit_on_launch: false });
    assert.ok(l.gizliler.includes(H.YENI.evm), 'hata metni temizligi icin deger gizlilere girmedi');
    const zarf = JSON.parse(Buffer.from(l.extraVars.crypto_hub_node_yeni_b64, 'base64').toString('utf8'));
    assert.equal(zarf.degerler.rpc, H.YENI.evm, 'isin extra_vars i gercek degeri tasimiyor');
    assert.equal(l.extraVars.crypto_hub_node_talep, b.talepId);
    assert.equal(l.extraVars.zorunlu_alan, 'varsayilan', 'prefill sonucu launch a gitmedi');
    // Satir
    const row = h.d.rows.find((x) => x.id === b.talepId);
    assert.equal(row.durum, 'CALISIYOR');
    assert.equal(row.smart_ticket_id, null);
    assert.equal(row.awx_job_id, b.jobId);
    assert.equal(row.awx_server_id, 1);
    assert.equal(row.yeni_deger_secret, null, 'secret NULL degil');
    // Is gecmisi / denetim / log degeri tasimaz
    const hist = h.d.history.find((x) => x.job_id === b.jobId);
    assert.ok(hist, 'is gecmisi yazilmadi');
    assert.equal(JSON.parse(hist.params).crypto_hub_node_yeni_b64, '***gizli***');
    const dis = JSON.stringify([h.d.history, h.d.audits, h.d.logs, b]);
    assert.ok(!dis.includes(SIR), 'deger gecmis/denetim/log/yanita sizdi');
    assert.ok(!dis.includes(l.extraVars.crypto_hub_node_yeni_b64), 'b64 deger sizdi');
    // Denetim: AWX'ten ONCE; sonra talep kaydi ticketId:null.
    assert.ok(aksiyonlar(h).includes('crypto_hub_node_onaysiz_calisti'));
    const talepD = denetimDetay(h, 'crypto_hub_node_change_talep');
    assert.equal(talepD.ticketId, null);
    assert.equal(talepD.onaysiz, true);
    assert.equal(talepD.talepId, b.talepId);
    // Kilit: ikinci talep reddedilir, tarama isi bitirince acilir.
    let ikinci = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(ikinci.status, 409);
    assert.equal(ikinci.body.blocked, 'node_bekleyen_talep');
    assert.equal(await h.NODE.nodeSonuclariniTara(), 0, 'surerken kapandi');
    isBitir(h, b.jobId, [`NODESUM\t${T}\tok\t${ps(h, b.talepId)}\t${b.talepId}\t-`]);
    assert.equal(await h.NODE.nodeSonuclariniTara(), 1);
    assert.equal(row.durum, 'BASARILI');
    assert.ok(row.kapandi_at);
    assert.equal(row.sonuc_kod, null, 'ONAYSIZ isareti kapanista silinmedi');
    ikinci = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(ikinci.status, 200, 'kilit acilmadi');
    // Ekran detayi
    const det = await h.istek('GET', `/node-change/${b.talepId}`, K.nodecu);
    assert.equal(det.body.talep.durum, 'BASARILI');
    assert.equal(det.body.smart, null);
  }));

test('DY1b denetim AWX baslatmadan once yazilir; satir once sahiplenilir', () =>
  ile(async (h) => {
    dogrudanAc(h);
    let launchAnindaDenetim = null;
    let launchAnindaDurum = null;
    let launchAnindaSecret = 'x';
    const gercek = h.d.ssLaunches.push.bind(h.d.ssLaunches);
    h.d.ssLaunches.push = (x) => {
      launchAnindaDenetim = aksiyonlar(h).slice();
      launchAnindaDurum = h.d.rows[0].durum;
      launchAnindaSecret = h.d.rows[0].yeni_deger_secret;
      return gercek(x);
    };
    const r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(launchAnindaDenetim.includes('crypto_hub_node_onaysiz_calisti'), 'denetim AWX ten sonra');
    assert.ok(!launchAnindaDenetim.includes('crypto_hub_node_change_talep'));
    assert.equal(launchAnindaDurum, 'CALISIYOR');
    assert.equal(launchAnindaSecret, null, 'launch aninda deger hala kolonda');
  }));

test('DY2 job yok: 90 dk TAKILDI; sinir icinde acik; AWX okunamazsa sinirda kapanir', () =>
  ile(async (h) => {
    const once = (dk) => new Date(Date.now() - dk * 60000);
    const satir = (o) => {
      const r = { id: h.d.nextId++, tenant_key: T, grup: G_EVM, kilit: `k${h.d.nextId}`, durum: 'CALISIYOR', smart_ticket_id: null, external_ticket_id: null, awx_server_id: null, awx_job_id: null, kapandi_at: null, username: 'u', plan_sha: 'a', ...o };
      h.d.rows.push(r);
      return r;
    };
    const a = satir({ created_at: once(89) });
    const b = satir({ created_at: once(91) });
    const c = satir({ created_at: once(91), awx_server_id: 1, awx_job_id: 9001 });
    h.d.jobs.set(9001, { status: 'running', artifacts: {} });
    await h.NODE.nodeSonuclariniTara();
    assert.equal(a.kapandi_at, null, '89 dk lik satir kapandi');
    assert.equal(b.durum, 'OLCULEMEDI');
    assert.equal(b.sonuc_kod, 'TAKILDI');
    assert.equal(JSON.parse(b.sonuc_json).neden, 'dogrudan_job_yok');
    assert.equal(c.kapandi_at, null, 'AWX te suren is kapatildi');
    h.d.awxBozuk = true;
    await h.NODE.nodeSonuclariniTara();
    assert.equal(c.sonuc_kod, 'TAKILDI');
    assert.equal(JSON.parse(c.sonuc_json).neden, 'awx_okunamadi');
    assert.equal(h.NODE.DOGRUDAN_TAKILDI_DK, 90);
    assert.equal((h.d.iptaller || []).length, 0, 'bileti olmayan satirda iptal denendi');
  }));

test('DY3 CAS kaybi baslatmaz; tarama satiri kapattiysa is baslamaz', () =>
  ile(async (h) => {
    dogrudanAc(h);
    h.d.casKayip = true;
    let r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.blocked, 'crypto_node_dogrudan_sahiplenme');
    assert.equal(h.d.ssLaunches.length, 0, 'CAS kaybinda is baslatildi');
    assert.ok(!aksiyonlar(h).includes('crypto_hub_node_onaysiz_calisti'), 'baslamayan is onaysiz calisti yazildi');
    h.d.casKayip = false;
    // Gercek yaris: preflight sirasinda tarama satiri kapatir, CAS durum kosuluna takilir.
    h.d.preflightKanca = () => {
      const row = h.d.rows.find((x) => x.grup === G_BTC);
      row.durum = 'HATA';
      row.kapandi_at = new Date();
      row.yeni_deger_secret = null;
    };
    r = await h.istek('POST', '/node-change', K.nodecu, DG({ grup: G_BTC }));
    assert.ok(r.status >= 400, JSON.stringify(r.body));
    assert.equal(h.d.ssLaunches.length, 0, 'kapanmis satirla is baslatildi');
  }));

test('DY3b CAS yarisi: kanca ile sahiplenme arasinda satir degisirse is baslamaz', () =>
  ile(async (h) => {
    dogrudanAc(h);
    for (const [ad, degisim] of [
      ['durum', { durum: 'BEKLIYOR' }],
      ['kapandi_at', { kapandi_at: new Date() }],
    ]) {
      h.d.rows.length = 0;
      h.d.casOncesi = () => Object.assign(h.d.rows[0], degisim);
      const r = await h.istek('POST', '/node-change', K.nodecu, DG());
      assert.equal(r.status, 409, `${ad}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.blocked, 'crypto_node_dogrudan_sahiplenme');
      assert.equal(h.d.ssLaunches.length, 0, `${ad} degisti, is yine basladi`);
    }
  }));

test('DY1c acilis satiri ONAYSIZ isaretiyle yazilir (tarama Smart metni yazmasin)', () =>
  ile(async (h) => {
    dogrudanAc(h);
    let acilista = null;
    h.d.preflightKanca = () => {
      acilista = h.d.rows[0].sonuc_kod;
    };
    assert.equal((await h.istek('POST', '/node-change', K.nodecu, DG())).status, 200);
    assert.equal(acilista, 'ONAYSIZ');
  }));

test('DY1d Smart akisi hic tanimli degilken: kapali modda is baslar, onizleme 503 kalir', () =>
  ile(async (h) => {
    const envOnce = process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT;
    delete process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT;
    try {
      dogrudanAc(h);
      h.d.opsxCfg.smart.openshift = { ...h.d.opsxCfg.smart.openshift, flowKey: '' };
      const o = await h.istek('POST', '/node-smart-onizle', K.admin, { tenant: T, grup: G_EVM });
      assert.equal(o.status, 503, JSON.stringify(o.body));
      assert.equal(o.body.blocked, 'crypto_node_smart_yok');
      const r = await h.istek('POST', '/node-change', K.nodecu, DG());
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.onaysiz, true);
      assert.equal(h.d.ssLaunches.length, 1);
    } finally {
      if (envOnce !== undefined) process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT = envOnce;
    }
  }));

test('DY4 belirsiz launch hatasi satiri acik birakir; kesin hata kapatir', () =>
  ile(async (h) => {
    dogrudanAc(h);
    const belirsizler = [
      Object.assign(new Error('AWX HTTP 502: bad gateway'), { status: 502 }),
      Object.assign(new Error('AWX HTTP 500'), { status: 500 }),
      new Error('AWX isteği zaman aşımına uğradı.'),
      Object.assign(new Error('AWX HTTP 408'), { status: 408 }),
      Object.assign(new Error('yutuldu'), { status: 409, code: 'awx_prompt_on_launch_disabled', iptalEdildi: false }),
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('AWX yanıtı JSON değil (502): <html>'), { httpStatus: 502 }),
    ];
    for (const e of belirsizler) {
      h.d.rows.length = 0;
      h.d.ssHata = e;
      const r = await h.istek('POST', '/node-change', K.nodecu, DG());
      assert.equal(r.status, 424, `${e.message}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.blocked, 'crypto_node_dogrudan_belirsiz');
      assert.equal(r.body.talepId, h.d.rows[0].id);
      const row = h.d.rows[0];
      assert.equal(row.durum, 'CALISIYOR', `${e.message}: kilit birakildi`);
      assert.equal(row.kapandi_at, null);
      assert.equal(row.yeni_deger_secret, null);
    }
    const kesinler = [
      Object.assign(new Error(`AWX HTTP 400: gecersiz ${H.YENI.evm}`), { status: 400 }),
      Object.assign(new Error('AWX sunucusu bulunamadı.'), { status: 404, code: 'awx_server_missing' }),
      Object.assign(new Error('yutuldu'), { status: 409, code: 'awx_prompt_on_launch_disabled', iptalEdildi: true }),
      Object.assign(new Error('AWX başlatıcısı hazır değil.'), { status: 503, code: 'ss_launch_hazir_degil' }),
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('getaddrinfo ENOTFOUND awx'), { code: 'ENOTFOUND' }),
      Object.assign(new Error('AWX yanıtı JSON değil (403): <html>'), { httpStatus: 403 }),
      Object.assign(new Error('OAuth2 yaniti: {"sir":"x"}'), { postOncesi: true }),
    ];
    for (const e of kesinler) {
      h.d.rows.length = 0;
      h.d.ssHata = e;
      const r = await h.istek('POST', '/node-change', K.nodecu, DG());
      assert.equal(r.status, 409, `${e.message}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.blocked, 'crypto_node_dogrudan_hata');
      assert.ok(!r.body.message.includes(SIR), 'hata metni degeri tasidi');
      if (e.postOncesi) assert.ok(!/OAuth2|sir/.test(r.body.message), 'token ucu yaniti kullaniciya gitti');
      const row = h.d.rows[0];
      if (e.postOncesi) assert.ok(!String(row.sonuc_json).includes('OAuth2'), 'token ucu yaniti sonuc_json a yazildi');
      assert.equal(row.durum, 'HATA');
      assert.equal(row.sonuc_kod, 'DOGRUDAN_HATA');
      assert.ok(row.kapandi_at);
      assert.equal(row.yeni_deger_secret, null);
      assert.ok(!String(row.sonuc_json).includes(SIR), 'sonuc_json degeri tasidi');
    }
    assert.ok(!JSON.stringify([h.d.audits, h.d.logs]).includes(SIR), 'deger denetim/loga sizdi');
  }));

test('DY5 ayar preflight sirasinda acilirsa is baslamaz; bozulursa 503', () =>
  ile(async (h) => {
    dogrudanAc(h);
    h.d.preflightKanca = () => {
      h.d.cryptoSmart = { enabled: true };
    };
    let r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.blocked, 'crypto_node_smart_degisti');
    assert.equal(h.d.rows[0].durum, 'HATA');
    assert.equal(h.d.rows[0].yeni_deger_secret, null);
    assert.equal(h.d.ssLaunches.length, 0);
    h.d.preflightKanca = () => {
      h.d.cryptoSmartBozuk = true;
    };
    h.d.cryptoSmart = { enabled: false };
    r = await h.istek('POST', '/node-change', K.nodecu, DG({ grup: G_BTC }));
    h.d.cryptoSmartBozuk = false;
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(h.d.ssLaunches.length, 0);
  }));

test('DY5b kanca reddederse (plan ozeti) satir sahiplenilmez, is baslamaz', () =>
  ile(async (h) => {
    dogrudanAc(h);
    h.d.preflightKanca = () => {
      h.d.rows[0].plan_sha = 'f'.repeat(64);
    };
    const r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.blocked, 'crypto_node_dogrudan_hazirlik');
    assert.equal(h.d.rows[0].durum, 'HATA');
    assert.equal(h.d.rows[0].sonuc_kod, 'DOGRUDAN_HAZIRLIK');
    assert.equal(h.d.ssLaunches.length, 0);
  }));

test('DY6 /kapat ticket siz CALISIYOR icin dogru metin; kilit acilmaz', () =>
  ile(async (h) => {
    dogrudanAc(h);
    h.d.ssHata = new Error('belirsiz');
    const r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(r.status, 424);
    const row = h.d.rows[0];
    const k = await h.istek('POST', `/node-change/${row.id}/kapat`, K.admin, { gerekce: 'Takili gorunuyor, kilit acilsin lutfen' });
    assert.equal(k.status, 409);
    assert.match(k.body.message, /Smart onayı olmadan başlatıldı/);
    assert.doesNotMatch(k.body.message, /bağlanmadı/);
    assert.equal(row.kapandi_at, null);
  }));

test('DY7 kapali modda onizleme Smart yolunda: is yok, satir yok', () =>
  ile(async (h) => {
    dogrudanAc(h);
    const r = await h.istek('POST', '/node-smart-onizle', K.admin, { tenant: T, grup: G_EVM });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.smartMod, 'kapali');
    assert.equal(r.body.kaynak, 'opsx');
    assert.ok(r.body.metadata);
    assert.equal(h.d.rows.length, 0);
    assert.equal(h.d.ssLaunches.length, 0);
  }));

test('DY8 ACILIYOR 10 dk: onaysiz satir bilet aramaz, Smart metni yazmaz', () =>
  ile(async (h) => {
    const eski = new Date(Date.now() - 11 * 60000);
    const yeni = (o) => {
      const r = { id: h.d.nextId++, tenant_key: T, grup: G_EVM, kilit: `k${h.d.nextId}`, durum: 'ACILIYOR', smart_ticket_id: null, external_ticket_id: null, awx_server_id: null, awx_job_id: null, kapandi_at: null, username: 'u', created_at: eski, ...o };
      h.d.rows.push(r);
      return r;
    };
    const onaysiz = yeni({ sonuc_kod: 'ONAYSIZ' });
    const smart = yeni({});
    await h.NODE.nodeSonuclariniTara();
    assert.equal(onaysiz.sonuc_kod, 'ACILIS_KESILDI');
    assert.doesNotMatch(JSON.parse(onaysiz.sonuc_json).not, /Smart'ta kayıt/);
    assert.match(JSON.parse(smart.sonuc_json).not, /Smart'ta kayıt açılmış olabilir/);
    assert.equal(h.d.logs.filter((s) => /smart_tickets WHERE pending_launch_json/.test(s)).length, 1, 'onaysiz satir icin bilet arandi');
  }));

test('DY9 /ops node_change i Smart kapali iken de tanimaz; sifreleme kapisi dogrudan yolda da gecerli', () =>
  ile(async (h) => {
    dogrudanAc(h);
    const r = await h.istek('POST', '/ops', K.nodecu, { tenant: T, action: 'node_change' });
    assert.ok(r.status >= 400, JSON.stringify(r.body));
    assert.equal(h.d.launches.length + h.d.ssLaunches.length, 0);
    const once = { env: process.env.NODE_ENV, key: process.env.ENV_OVERRIDES_ENCRYPTION_KEY };
    process.env.NODE_ENV = 'production';
    delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
    try {
      const t = await h.istek('POST', '/node-change', K.nodecu, DG());
      assert.equal(t.status, 503);
      assert.equal(t.body.blocked, 'node_sifreleme_yok');
    } finally {
      if (once.env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = once.env;
      process.env.ENV_OVERRIDES_ENCRYPTION_KEY = once.key;
    }
    assert.equal(h.d.ssLaunches.length, 0);
  }));

test('DY10 Ankara/Istanbul onerisi test kiracisinda yok; dogrudan yanit dis alan tasimaz', () =>
  ile(async (h) => {
    dogrudanAc(h);
    const r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.deepEqual(Object.keys(r.body).sort(), ['awxServerId', 'jobId', 'message', 'ok', 'onaysiz', 'pendingApproval', 'talepId']);
  }));

test('DY11 kesinRet tablosu', () =>
  ile(async (h) => {
    const k = h.NODE.kesinRet;
    for (const st of [400, 401, 403, 404, 409, 429]) assert.equal(k({ status: st }), true, String(st));
    for (const st of [408, 500, 502, 503, 504, undefined, 200]) assert.equal(k({ status: st }), false, String(st));
    assert.equal(k(null), false);
    assert.equal(k({ code: 'ss_launch_hazir_degil', status: 503 }), true);
    assert.equal(k({ code: 'awx_prompt_on_launch_disabled', status: 409, iptalEdildi: false }), false);
    assert.equal(k({ code: 'awx_prompt_on_launch_disabled', status: 409, iptalEdildi: true }), true);
    for (const c of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']) assert.equal(k({ code: c }), true, c);
    for (const c of ['ECONNRESET', 'ETIMEDOUT', 'EPIPE']) assert.equal(k({ code: c }), false, c);
    assert.equal(k({ httpStatus: 403 }), true);
    assert.equal(k({ httpStatus: 408 }), false);
    assert.equal(k({ httpStatus: 502 }), false);
    assert.equal(k({ postOncesi: true }), true);
  }));

test('DY11b runner is baslamadi bilgisini kaybetmez: token hatasi postOncesi, JSON olmayan yanit httpStatus', () => {
  const r = fs.readFileSync(path.join(__dirname, '../../ansible/runner.cjs'), 'utf8');
  const launch = r.slice(r.indexOf('async function performSsLaunch('));
  assert.match(
    launch.slice(0, launch.indexOf('KIM TETIKLEDI')),
    /getTokenForServer\(server\)\.catch\(\(e\) => \{\s*throw Object\.assign\(e, \{ postOncesi: true \}\);/,
    'launch oncesi token hatasi isaretlenmiyor',
  );
  const istek = r.slice(r.indexOf('function awxRequestToServer('), r.indexOf('// Kirpma sonrasi'));
  assert.match(istek, /AWX yanıtı JSON değil[^\n]*\n\s*\{ httpStatus: res\.statusCode \}/, 'JSON olmayan yanit kodu kayboldu');
});

test('DY13 ekranin gordugu mod kapi acmaz, yalniz durdurur', () =>
  ile(async (h) => {
    h.okumaVer();
    // Sihirbaz Smart metniyle acik; admin bu arada kapatti.
    assert.equal((await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu)).body.smartMod, 'onay');
    await put(h, { enabled: false });
    let r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.blocked, 'crypto_node_smart_mod_degisti');
    assert.equal(h.d.ssLaunches.length, 0, 'gormedigi halde is baslatildi');
    assert.equal(h.d.rows.length, 0, 'satir yazildi');
    assert.equal(h.d.smartCreated.length, 0);
    // Ters yon: onaysiz metniyle acik; admin Smart'i acti. Bilet de acilmaz, is de baslamaz.
    await put(h, { enabled: true });
    r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.blocked, 'crypto_node_smart_mod_degisti');
    assert.equal(h.d.ssLaunches.length, 0, 'onaysizKabul Smart acikken is baslatti');
    assert.equal(h.d.smartCreated.length, 0, 'onaysiz metni goren kullaniciya bilet acildi');
    assert.equal(h.d.rows.length, 0);
    // Yalniz dogru esleme gecer.
    assert.equal((await h.istek('POST', '/node-change', K.nodecu, GOVDE())).status, 200);
    assert.equal(h.d.smartCreated.length, 1);
  }));

test('DY14 yutma korumasi isi iptal edemedi: job baglanir, metin dogru, sonuc okunup kilit kapanir', () =>
  ile(async (h) => {
    dogrudanAc(h);
    const kayitlar = [];
    const gercekKaydet = h.RES.isKaydet;
    h.RES.isKaydet = (s, j, k) => {
      kayitlar.push(j);
      return gercekKaydet(s, j, k);
    };
    h.d.ssHata = Object.assign(new Error('yutuldu'), { status: 409, code: 'awx_prompt_on_launch_disabled', jobId: 4242, iptalEdildi: false });
    const r = await h.istek('POST', '/node-change', K.nodecu, DG());
    assert.equal(r.status, 424, JSON.stringify(r.body));
    assert.equal(r.body.blocked, 'crypto_node_dogrudan_belirsiz');
    assert.equal(r.body.jobId, 4242);
    assert.match(r.body.message, /iş #4242 iptal edilemedi/);
    assert.doesNotMatch(r.body.message, /yanıtı alınamadı/);
    const row = h.d.rows[0];
    assert.equal(row.durum, 'CALISIYOR');
    assert.equal(row.awx_job_id, 4242, 'kosan is satira baglanmadi');
    assert.equal(row.awx_server_id, 1);
    assert.equal(row.yeni_deger_secret, null);
    h.RES.isKaydet = gercekKaydet;
    assert.deepEqual(kayitlar, [4242], 'is kaydi yazilmadi');
    assert.equal(await h.NODE.nodeSonuclariniTara(), 0, 'is surerken kilit acildi');
    isBitir(h, 4242, [`NODESUM\t${T}\tok\t${ps(h, row.id)}\t${row.id}\t-`]);
    assert.equal(await h.NODE.nodeSonuclariniTara(), 1, 'sonuc okunmadi');
    assert.ok(row.kapandi_at);
  }));

test('DY12 kopru runner baslatilmadan fail-closed (gercek runner)', async () => {
  const { performSsLaunchOnServer } = require('../../ansible/runner.cjs');
  await assert.rejects(performSsLaunchOnServer(1, 77, {}), (e) => e.code === 'ss_launch_hazir_degil' && e.status === 503);
});
