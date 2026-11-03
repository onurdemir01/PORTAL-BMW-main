// server/crypto-hub/__tests__/node-uclar.test.cjs - Indexer / Node uclari davranis bekcileri.
//
// N6 /node-change kapilari, N7 tek acik talep + Smart hata yollari, N8 openSmartTicket cagrisi
// birebir ve sira, N9 sonuc taramasi (tek kez kapatma), N10 erisim (node-only), N11 sir yok
// (pending_launch_json, ansible_job_history, denetim, loglar), okuma uclari.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./_node_harness.cjs');

const { K, GOVDE, T, G_EVM, G_BTC, G_LTC, SIR } = H;

async function ile(fn) {
  const h = await H.kur();
  try {
    await fn(h);
  } finally {
    await h.kapat();
  }
}

test('N6 /node-change kapilari (yetki, prod, bayat, Smart yok, indeks yok, gerekce, ad yazdirma)', () =>
  ile(async (h) => {
    h.okumaVer();
    const post = (u, b) => h.istek('POST', '/node-change', u, b);
    let r = await post(K.yetkisiz, GOVDE());
    assert.equal(r.status, 403);
    assert.equal(r.body.blocked, 'node_yetki_yok');
    r = await post(K.metacocu, GOVDE());
    assert.equal(r.status, 403, 'app:metaco tek basina talep actirdi');
    assert.equal(r.body.blocked, 'node_yetki_yok');
    r = await post({ ...K.nodecu, motorBozuk: true }, GOVDE());
    assert.equal(r.status, 403, 'yetki motoru okunamazken talep acildi');
    r = await post(K.nodecu, GOVDE({ tenant: 'metaco_das_prod' }));
    assert.equal(r.status, 403);
    assert.equal(r.body.blocked, 'node_kapali');
    r = await post(K.nodecu, GOVDE({ tenant: 'wyden_test' }));
    assert.equal(r.status, 400);
    r = await post(K.nodecu, GOVDE({ gerekce: 'kisa' }));
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'node_gerekce');
    r = await post(K.nodecu, GOVDE({ grup: 'UIS:X' }));
    assert.equal(r.body.blocked, 'node_girdi');
    // bayat okuma
    h.NODE.NODE_OKUMA.clear();
    h.okumaVer({}, Date.now() - 11 * 60 * 1000);
    r = await post(K.nodecu, GOVDE());
    assert.equal(r.status, 409);
    assert.equal(r.body.blocked, 'node_okuma_bayat');
    h.NODE.NODE_OKUMA.clear();
    h.okumaVer({ eksik: true });
    r = await post(K.nodecu, GOVDE());
    assert.equal(r.body.blocked, 'node_okuma_bayat', 'eksik okumayla talep acildi');
    h.NODE.NODE_OKUMA.clear();
    h.okumaVer();
    // Smart yok -> 503; OpsX'te Smart KAPALI (enabled:false) olsa bile onaysiz kosmaz.
    const flow = h.d.opsxCfg.smart.openshift.flowKey;
    h.d.opsxCfg.smart.openshift = { ...h.d.opsxCfg.smart.openshift, flowKey: '', enabled: false };
    const envOnce = process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT;
    delete process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT;
    r = await post(K.nodecu, GOVDE());
    if (envOnce !== undefined) process.env.OPSX_SMART_FLOW_KEY_OPENSHIFT = envOnce;
    assert.equal(r.status, 503);
    assert.equal(r.body.blocked, 'crypto_node_smart_yok');
    assert.equal(h.d.launches.length, 0, 'Smart yokken is baslatildi');
    h.d.opsxCfg.smart.openshift = { ...h.d.opsxCfg.smart.openshift, flowKey: flow, enabled: false };
    r = await post(K.nodecu, GOVDE());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.pendingApproval, true, 'enabled:false iken onay atlandi');
    assert.equal(h.d.smartCreated.length, 1);
    assert.equal(h.d.launches.length, 0, 'node_change dogrudan baslatildi');
    // indeks yok -> 503 (yeni grup)
    h.d.indeks = false;
    h.NODE._sifirla();
    h.okumaVer();
    r = await post(K.nodecu, GOVDE({ grup: G_BTC, nodeId: 'das_test_btc_b' }));
    assert.equal(r.status, 503);
    assert.equal(r.body.blocked, 'node_kilit_indeksi_yok');
  }));

test('N6b prod kiracida ad yazdirma (prod acik benzetimi)', () =>
  ile(async (h) => {
    const N = require('../../../shared/cryptoHubNodes.cjs');
    const once = N.nodeAcikMi;
    N.nodeAcikMi = (t) => !!t && t.app === 'metaco';
    try {
      h.okumaVer({}, Date.now(), 'metaco_das_prod');
      const g = GOVDE({ tenant: 'metaco_das_prod' });
      let r = await h.istek('POST', '/node-change', K.nodecu, { ...g, onayMetni: 'yanlis' });
      assert.equal(r.status, 400);
      assert.equal(r.body.blocked, 'node_onay_metni');
      r = await h.istek('POST', '/node-change', K.nodecu, { ...g, onayMetni: G_EVM });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      // D4: Istanbul talebinden sonra Ankara onerisi
      assert.equal(r.body.esTalepOnerisi.tenant, 'metaco_das_prod_ank');
      assert.equal(r.body.esTalepOnerisi.esTalepId, r.body.talepId);
      assert.equal(r.body.esTalepOnerisi.nodeId, null, 'Ankara okumasi yokken node on secildi');
      const ist = r.body;
      const meta = h.d.smartCreated[0].metadata;
      assert.equal(meta.JRENV, 'Production_9');
      assert.match(meta.ACIKLAMA, /Lokasyon: İstanbul/);
      // Ankara talebi: ayri bilet, Istanbul satirina bagli.
      h.okumaVer({}, Date.now(), 'metaco_das_prod_ank');
      r = await h.istek('POST', '/node-change', K.nodecu, {
        ...g,
        tenant: 'metaco_das_prod_ank',
        onayMetni: G_EVM,
        esTalepId: ist.talepId,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.notEqual(r.body.externalTicketId, ist.externalTicketId);
      const ank = h.d.rows.find((x) => x.id === r.body.talepId);
      assert.equal(ank.es_talep_id, ist.talepId);
      assert.equal(ank.lokasyon, 'Ankara');
      assert.match(h.d.smartCreated[1].metadata.ACIKLAMA, new RegExp(`İstanbul talebi: Smart #${ist.externalTicketId}`));
      assert.equal(r.body.esTalepOnerisi, undefined, 'Ankara talebinde yeniden oneri');
      // Yanlis es talep
      r = await h.istek('POST', '/node-change', K.nodecu, {
        ...g,
        grup: G_BTC,
        nodeId: 'das_test_btc_b',
        tenant: 'metaco_das_prod_ank',
        onayMetni: G_BTC,
        esTalepId: ist.talepId,
      });
      assert.equal(r.status, 400);
    } finally {
      N.nodeAcikMi = once;
    }
  }));

test('N7 tek acik talep: esszamanli iki istek -> biri 409; BTC/LTC ortak kilit', () =>
  ile(async (h) => {
    h.okumaVer();
    const [a, b] = await Promise.all([
      h.istek('POST', '/node-change', K.nodecu, GOVDE()),
      h.istek('POST', '/node-change', K.nodecu, GOVDE()),
    ]);
    const kodlar = [a.status, b.status].sort();
    assert.deepEqual(kodlar, [200, 409], JSON.stringify([a.body, b.body]));
    const red = a.status === 409 ? a : b;
    assert.equal(red.body.blocked, 'node_bekleyen_talep');
    assert.match(red.body.message, /Smart #/);
    let r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ grup: G_BTC, nodeId: 'das_test_btc_b' }));
    assert.equal(r.status, 200);
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ grup: G_LTC, nodeId: 'das_test_ltc_b' }));
    assert.equal(r.status, 409, 'ayni deploymenta iki esszamanli talep acildi');
  }));

test('N7b Smart hatasi satiri HATA ile kapatir; store_failed BEKLIYOR birakir; sablon hatasi 400', () =>
  ile(async (h) => {
    h.okumaVer();
    h.d.smartHata = 'Smart 500';
    let r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 502);
    assert.equal(r.body.blocked, 'crypto_node_smart_hata');
    let row = h.d.rows[0];
    assert.equal(row.durum, 'HATA');
    assert.ok(row.kapandi_at, 'Smart hatasinda satir acik kaldi (kilit tutulur)');
    h.d.smartHata = null;
    h.d.storeHata = 'db yok';
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 500);
    assert.equal(r.body.blocked, 'smart_ticket_store_failed');
    assert.match(r.body.message, /Smart'ta reddettirin/);
    row = h.d.rows[1];
    assert.equal(row.durum, 'BEKLIYOR');
    assert.equal(row.kapandi_at, null, 'yetim bilette satir kapandi - ikinci talep acilabilir');
    assert.equal(row.external_ticket_id, r.body.externalTicketId);
    h.d.storeHata = null;
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 409);
    // Sablon OpsX'e ozgu degiskeni default'suz kullaniyor -> 400, bilet acilmaz.
    h.d.opsxCfg.smart.openshift.metadataFields = 'OP: {{ extraVars.openshift_operations }}';
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ grup: G_BTC, nodeId: 'das_test_btc_b' }));
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'crypto_node_smart_sablon');
    assert.equal(h.d.smartCreated.length, 1, 'render hatasinda Smart cagrildi');
    assert.equal(h.d.rows[2].durum, 'HATA');
    h.d.opsxCfg.smart.openshift.metadataFields = '';
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ grup: G_BTC, nodeId: 'das_test_btc_b' }));
    assert.equal(r.status, 400, 'bos sablonla sabit nesneyle bilet acildi');
  }));

test('N8 openSmartTicket argumanlari birebir; preflight + prefill bilet ONCESI', () =>
  ile(async (h) => {
    h.okumaVer();
    const r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const a = h.d.gateArgs;
    assert.equal(a.templateName, `Crypto Hub: node_change @ ${T}`);
    assert.deepEqual(a.server, { id: 1 });
    assert.equal(a.templateId, 77);
    assert.equal(a.username, 'nodecu');
    assert.equal(a.email, 'nodecu@x.test');
    assert.deepEqual(a.detail, { ask_limit_on_launch: false });
    assert.deepEqual(a.resolvedLaunchOptions, {});
    assert.deepEqual(a.specFields, []);
    assert.deepEqual(a.pendingLaunchExtras, { onayZamanAsimiDk: 1440, yutmaKorumasi: true });
    assert.equal(a.auditAction, 'crypto_hub_node_change_ticket_open');
    assert.equal(a.overrides.smartApproval.flowKey, 'FLOW_OPENSHIFT', 'OpsX OpenShift flow key kullanilmadi');
    assert.equal(a.extraVars.zorunlu_alan, 'varsayilan', 'prefill sonucu bilete gitmedi');
    assert.equal(a.extraVars.crypto_hub_node_talep, r.body.talepId);
    const i = (x) => h.d.sira.indexOf(x);
    assert.ok(i('preflight') >= 0 && i('preflight') < i('prefill'), h.d.sira.join(','));
    assert.ok(i('prefill') < i('openSmartTicket'));
    assert.ok(i('sablon:55') >= 0 && i('sablon:55') < i('openSmartTicket'), 'OpsX OpenShift template degiskenleri okunmadi');
    assert.equal(h.d.smartCreated[0].flowKey, 'FLOW_OPENSHIFT');
    assert.equal(h.d.smartCreated[0].integrationKey, 'RFF');
    const t = h.d.smartTickets[0];
    const pl = JSON.parse(t.pending_launch_json);
    assert.equal(pl.onayZamanAsimiDk, 1440);
    assert.equal(pl.yutmaKorumasi, true);
    assert.equal(pl.templateName, `Crypto Hub: node_change @ ${T}`);
    const row = h.d.rows[0];
    assert.equal(row.durum, 'BEKLIYOR');
    assert.equal(row.smart_ticket_id, t.id);
    assert.equal(row.external_ticket_id, r.body.externalTicketId);
    assert.equal(r.body.onayZamanAsimiDk, 1440);
    assert.ok(h.d.audits.some((x) => x.action === 'crypto_hub_node_change_talep'));
    const m = h.d.smartCreated[0].metadata;
    assert.equal(m.JRENV, 'Test_3');
    assert.match(m.ACIKLAMA, /Crypto Hub Indexer\/Node Change/);
    assert.equal(m.CLUSTER, 'metaco_das');
  }));

test('N8c Smart bileti satira baglanamazsa basari uydurmaz ve PENDING bileti iptal eder', () =>
  ile(async (h) => {
    h.okumaVer();
    h.d.baglamaNoop = true;
    const r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.equal(r.body.blocked, 'smart_ticket_link_failed');
    assert.equal(h.d.smartTickets[0].status, 'CANCELLED');
    assert.equal(h.d.rows[0].durum, 'HATA');
    assert.equal(h.d.rows[0].sonuc_kod, 'SMART_BAGLAMA');
  }));

test('N8b preflight hatasi: bilet acilmaz, satir HATA', () =>
  ile(async (h) => {
    h.okumaVer();
    h.d.preflightHata = 'Prompt on launch kapali';
    const r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 409);
    assert.equal(h.d.smartCreated.length, 0);
    assert.equal(h.d.rows[0].durum, 'HATA');
    assert.equal(h.d.rows[0].sonuc_kod, 'PREFLIGHT');
  }));

async function talepAc(h, govde = GOVDE()) {
  const r = await h.istek('POST', '/node-change', K.nodecu, govde);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

function onayla(h, ticketId, jobId) {
  const t = h.d.smartTickets.find((x) => x.id === ticketId);
  Object.assign(t, { status: 'LAUNCHED', awx_job_id: jobId, awx_server_id: 1 });
}

function isBitir(h, jobId, lines, status = 'successful') {
  h.d.jobs.set(jobId, { status, artifacts: { crypto_hub_ops_result: { tenant: T, action: 'node_change', lines } } });
}

test('N9 tarama: Smart durumlari ve AWX sonucu; NODESUM yok -> OLCULEMEDI; tek denetim', () =>
  ile(async (h) => {
    h.okumaVer();
    const kapanis = async (govde, hazirla) => {
      const b = await talepAc(h, govde);
      hazirla(b);
      await h.NODE.nodeSonuclariniTara();
      await h.NODE.nodeSonuclariniTara();
      return h.d.rows.find((x) => x.id === b.talepId);
    };
    for (const [st, beklenen] of [
      ['REJECTED', 'REDDEDILDI'],
      ['TIMEOUT', 'ZAMAN_ASIMI'],
      ['CANCELLED', 'IPTAL'],
      ['ERROR', 'HATA'],
    ]) {
      const row = await kapanis(GOVDE(), (b) => {
        h.d.smartTickets.find((x) => x.id === b.ticketId).status = st;
      });
      assert.equal(row.durum, beklenen, st);
      assert.ok(row.kapandi_at);
    }
    const sonuclar = [
      ['ok', '-', 'BASARILI'],
      ['geri_alindi', 'ROLLOUT', 'GERI_ALINDI'],
      ['bayat', 'BAYAT_ESKI_DEGER', 'BAYAT'],
      ['fail', 'GERI_ALMA', 'BASARISIZ'],
    ];
    for (const [sonuc, kod, beklenen] of sonuclar) {
      let jobId;
      const row = await kapanis(GOVDE(), (b) => {
        jobId = 9000 + b.talepId;
        onayla(h, b.ticketId, jobId);
        isBitir(h, jobId, [
          `NODECHG\t${T}\t${H.D.idx}\tapp\tETH_INDEXER_NODE_URI\t${H.URL_A}\t${H.URL_B}\tyazildi`,
          `NODESUM\t${T}\t${sonuc}\tdas_test_eth_b\t${b.talepId}\t${kod}`,
        ]);
      });
      assert.equal(row.durum, beklenen, sonuc);
      assert.equal(row.awx_job_id, jobId);
      assert.equal(row.sonuc_kod, kod === '-' ? null : kod);
      const sj = JSON.parse(row.sonuc_json);
      assert.equal(sj.sum.sonuc, sonuc);
    }
    // Betik girdiyi reddettiyse kimlik '-': olumsuz sonuc kabul, basari ASLA.
    const girdi = await kapanis(GOVDE(), (b) => {
      onayla(h, b.ticketId, 8500 + b.talepId);
      isBitir(h, 8500 + b.talepId, [`NODESUM\t${T}\tfail\t-\t-\tGIRDI`], 'failed');
    });
    assert.equal(girdi.durum, 'BASARISIZ');
    assert.equal(girdi.sonuc_kod, 'GIRDI');
    // NODESUM yok -> OLCULEMEDI (BASARILI uydurulmaz); baska talebin / kimliksiz basari sayilmaz.
    for (const satir of [[], [`NODESUM\t${T}\tok\tdas_test_eth_b\t99999\t-`], [`NODESUM\t${T}\tok\t-\t-\t-`]]) {
      const row = await kapanis(GOVDE(), (b) => {
        onayla(h, b.ticketId, 8000 + b.talepId);
        isBitir(h, 8000 + b.talepId, satir, 'failed');
      });
      assert.equal(row.durum, 'OLCULEMEDI');
    }
    // AWX okunamazsa satir acik kalir
    const b = await talepAc(h);
    onayla(h, b.ticketId, 7777);
    h.d.awxBozuk = true;
    await h.NODE.nodeSonuclariniTara();
    h.d.awxBozuk = false;
    const row = h.d.rows.find((x) => x.id === b.talepId);
    assert.equal(row.kapandi_at, null);
    assert.equal(row.durum, 'CALISIYOR');
    // Esszamanli iki tarama -> TEK denetim kaydi
    isBitir(h, 7777, [`NODESUM\t${T}\tok\tdas_test_eth_b\t${b.talepId}\t-`]);
    const once = h.d.audits.filter((x) => x.action === 'crypto_hub_node_change_result').length;
    await Promise.all([h.NODE.nodeSonuclariniTara(), h.NODE.nodeSonuclariniTara()]);
    const sonra = h.d.audits.filter((x) => x.action === 'crypto_hub_node_change_result');
    assert.equal(sonra.length - once, 1, 'sonuc denetimi iki kez yazildi');
    assert.equal(sonra[sonra.length - 1].opts.username, 'nodecu', 'denetim talep sahibi adina degil');
  }));

test('N9b ACILIYOR > 10 dk kapanir (bilet varsa sahiplenilir); yetim > 1440 dk kapanir', () =>
  ile(async (h) => {
    const eski = (dk) => new Date(Date.now() - dk * 60000);
    const yeni = (o) => {
      const r = { id: h.d.nextId++, tenant_key: T, grup: G_EVM, kilit: `k${h.d.nextId}`, durum: 'ACILIYOR', smart_ticket_id: null, external_ticket_id: null, awx_server_id: null, awx_job_id: null, kapandi_at: null, username: 'u', yeni_node_id: 'n', created_at: eski(1), ...o };
      h.d.rows.push(r);
      return r;
    };
    const a = yeni({ created_at: eski(5) });
    const b = yeni({ created_at: eski(11) });
    const c = yeni({ created_at: eski(11) });
    h.d.smartTickets.push({ id: 444, external_ticket_id: 'SM-444', status: 'PENDING', pending_launch_json: JSON.stringify({ extraVars: { crypto_hub_node_talep: c.id, x: 1 } }), created_at: new Date() });
    const d = yeni({ durum: 'BEKLIYOR', external_ticket_id: 'SM-1', created_at: eski(1000) });
    const e = yeni({ durum: 'BEKLIYOR', external_ticket_id: 'SM-2', created_at: eski(1441) });
    await h.NODE.nodeSonuclariniTara();
    assert.equal(a.kapandi_at, null, '5 dk lik ACILIYOR kapandi');
    assert.equal(b.durum, 'HATA');
    assert.equal(b.sonuc_kod, 'ACILIS_KESILDI');
    assert.equal(c.durum, 'BEKLIYOR', 'bileti olan ACILIYOR satir sahiplenilmedi');
    assert.equal(c.smart_ticket_id, 444);
    assert.equal(c.kapandi_at, null);
    assert.equal(d.kapandi_at, null);
    assert.equal(e.durum, 'HATA');
    assert.equal(e.sonuc_kod, 'YETIM_BILET');
  }));

test('N10 erisim: node-only kullanici yalniz node uclari; /tenants isaretleri; is erisimi node dali', () =>
  ile(async (h) => {
    let r = await h.istek('GET', '/tenants', K.nodecu);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.apps.map((a) => a.app), ['metaco'], 'node-only kullaniciya Wyden dali dondu');
    const envs = r.body.apps[0].domains.flatMap((d) => d.envs);
    assert.ok(envs.every((e) => e.nodeOnly === true));
    assert.equal(envs.find((e) => e.key === 'metaco_das_test').nodeOpen, true);
    assert.equal(envs.find((e) => e.key === 'metaco_das_prod').nodeOpen, false);
    r = await h.istek('GET', '/tenants', K.metacocu);
    assert.ok(r.body.apps[0].domains[0].envs.every((e) => e.nodeOnly === false));
    r = await h.istek('GET', '/tenants', K.yetkisiz);
    assert.deepEqual(r.body.apps, []);
    r = await h.istek('GET', '/tenants', K.wydenci);
    assert.deepEqual(r.body.apps.map((a) => a.app), ['wyden']);

    r = await h.istek('POST', '/ops', K.nodecu, { tenant: T, action: 'rollout', targets: ['deployment/x'], confirmed: true });
    assert.equal(r.status, 403, 'node-only kullanici /ops rollout calistirdi');
    r = await h.istek('GET', `/overview?tenant=${T}`, K.nodecu);
    assert.equal(r.status, 403);
    // /ops node islemlerini TANIMAZ (Smart'siz node_change yolu yok) - metaco yetkilisi icin de.
    for (const action of ['node_change', 'node_env_get']) {
      r = await h.istek('POST', '/ops', K.metacocu, { tenant: T, action, targets: ['deployment/x'], confirmed: true });
      assert.equal(r.status, 400, `/ops ${action} kabul etti`);
    }
    assert.equal(h.d.launches.length, 0);

    r = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(r.status, 200);
    assert.equal(r.body.yetki.talep, true);
    r = await h.istek('GET', `/nodes?tenant=${T}`, K.metacocu);
    assert.equal(r.status, 200);
    assert.equal(r.body.yetki.talep, false);
    assert.ok(r.body.gruplar.every((g) => g.engel !== null || g.okumaBekleniyor));
    r = await h.istek('GET', `/nodes?tenant=${T}`, K.wydenci);
    assert.equal(r.status, 403);
    assert.equal(r.body.blocked, 'node_okuma_yetki_yok');
    r = await h.istek('GET', '/nodes?tenant=metaco_das_prod', K.nodecu);
    assert.equal(r.status, 403);
    assert.equal(r.body.blocked, 'node_kapali');

    // isErisimKarari node dali yalniz node islerinde
    const RES = h.RES;
    const { tenantOf, isOpen } = require('../../../shared/cryptoHubTenants.cjs');
    const N = require('../../../shared/cryptoHubNodes.cjs');
    const karar = (action, o = {}) =>
      RES.isErisimKarari({
        kayit: { username: 'nodecu', tenantKey: T, action },
        user: { username: 'nodecu', role: 'User' },
        gorunen: new Set(),
        tenantOf,
        isOpen,
        nodeGorunen: true,
        nodeAcik: N.nodeAcikMi,
        ...o,
      }).izin;
    assert.equal(karar('node_change'), true);
    assert.equal(karar('node_env_get'), true);
    assert.equal(karar('rollout'), false, 'node dali diger islere uygulandi');
    assert.equal(karar('node_change', { nodeGorunen: false }), false);
    assert.equal(karar('node_change', { nodeAcik: null }), false, 'nodeAcik yokken acik sayildi');
    assert.equal(karar('node_change', { user: { username: 'baska', role: 'User' } }), false, 'sahiplik aranmadi');
  }));

test('N10b okuma uclari: launch, ayni okuma tekrar, sonuc bellege; is gecmisi adi', () =>
  ile(async (h) => {
    let r = await h.istek('POST', '/node-read', K.nodecu, { tenant: T });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.devam, false);
    const jobId = r.body.jobId;
    assert.deepEqual(h.d.launches[0].extraVars, {
      crypto_hub_tenant: T,
      crypto_hub_action: 'node_env_get',
      crypto_hub_targets: '',
      crypto_hub_timeout: 600,
    });
    assert.equal(h.d.history[0].template_name, `Crypto Hub: node_env_get @ ${T}`);
    r = await h.istek('POST', '/node-read', K.metacocu, { tenant: T });
    assert.equal(r.body.devam, true);
    assert.equal(r.body.jobId, jobId);
    assert.equal(h.d.launches.length, 1);
    r = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(r.body.okuma.durum, 'suruyor');
    r = await h.istek('GET', `/node-read/1/${jobId}`, K.metacocu);
    assert.equal(r.status, 200);
    assert.equal(r.body.bitti, false);
    h.bitir(jobId, H.satirlar());
    r = await h.istek('GET', `/node-read/1/${jobId}`, K.metacocu);
    assert.equal(r.body.bitti, true);
    assert.equal(r.body.okuma.eksik, false);
    r = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(r.body.okuma.durum, 'taze');
    const evm = r.body.gruplar.find((g) => g.id === G_EVM);
    assert.equal(evm.degistirilebilir, true);
    assert.equal(evm.mevcutNode.katalogId, 'das_test_eth_a');
    assert.equal(evm.adaylar.find((a) => a.id === 'das_test_eth_a').kullanimda, true);
    assert.ok(!JSON.stringify(r.body).includes(SIR), '/nodes cevabinda ham sir');
    // Wyden kullanicisi bu isin sonucunu okuyamaz; baska tur is node okumasi sayilmaz.
    r = await h.istek('GET', `/node-read/1/${jobId}`, K.wydenci);
    assert.equal(r.status, 403);
    r = await h.istek('GET', '/node-read/1/123456', K.nodecu);
    assert.equal(r.status, 403);
    // Talep sonrasi /node-change/:id
    const b = await talepAc(h);
    r = await h.istek('GET', `/node-change/${b.talepId}`, K.metacocu);
    assert.equal(r.status, 200);
    assert.equal(r.body.talep.durum, 'BEKLIYOR');
    assert.equal(r.body.smart.status, 'PENDING');
    assert.ok(r.body.smart.sonTarih);
    r = await h.istek('GET', `/node-change/${b.talepId}`, K.wydenci);
    assert.equal(r.status, 403);
    r = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(r.body.gecmis[0].talepId, b.talepId);
    assert.equal(r.body.gruplar.find((g) => g.id === G_EVM).bekleyen.talepId, b.talepId);
    // admin onizleme Smart'a gitmez
    const once = h.d.smartCreated.length;
    r = await h.istek('POST', '/node-smart-onizle', K.nodecu, { tenant: T, grup: G_BTC, nodeId: 'das_test_btc_b' });
    assert.equal(r.status, 403);
    r = await h.istek('POST', '/node-smart-onizle', K.admin, { tenant: T, grup: G_BTC, nodeId: 'das_test_btc_b' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.flowKey, 'FLOW_OPENSHIFT');
    assert.match(r.body.metadata.ACIKLAMA, /nbxplorer-mainnet \(BTC\)/);
    assert.equal(h.d.smartCreated.length, once, 'onizleme Smart bileti acti');
    assert.equal(h.d.rows.length, 1, 'onizleme satir yazdi');
  }));

test('N11 sir hicbir yere gitmez: pending_launch_json, is gecmisi, denetim, Smart, loglar', () =>
  ile(async (h) => {
    let r = await h.istek('POST', '/node-read', K.nodecu, { tenant: T });
    h.bitir(r.body.jobId, H.satirlar());
    await h.istek('GET', `/node-read/1/${r.body.jobId}`, K.nodecu);
    await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    const b = await talepAc(h, GOVDE({ grup: H.G_DOT, nodeId: 'das_test_dot_b' }));
    onayla(h, b.ticketId, 6001);
    isBitir(h, 6001, [
      `NODECHG\t${T}\t${H.D.dot}\tsidecar\tSIDECAR_AUTH_VALUE\t${SIR}\t${SIR}\tyazildi`,
      `NODESUM\t${T}\tok\tdas_test_dot_b\t${b.talepId}\t-`,
    ]);
    await h.NODE.nodeSonuclariniTara();
    r = await h.istek('GET', `/node-change/${b.talepId}`, K.nodecu);
    const yerler = {
      smartTickets: JSON.stringify(h.d.smartTickets),
      smartMetadata: JSON.stringify(h.d.smartCreated),
      history: JSON.stringify(h.d.history),
      audits: JSON.stringify(h.d.audits.map((a) => a.opts)),
      rows: JSON.stringify(h.d.rows),
      logs: h.d.logs.join('\n'),
      cevap: JSON.stringify(r.body),
    };
    for (const [ad, metin] of Object.entries(yerler)) {
      assert.ok(!metin.includes(SIR), `${ad} sahte sir dizesini iceriyor`);
    }
    assert.equal(h.d.rows[0].durum, 'BASARILI');
  }));

// ── 2026-11-02 duzeltme turu ────────────────────────────────────────────────────────────

test('N12 bilesen secimi uctan: secilenler plana/hedefe, bilet metni bilesenleri sayar; gecersiz secim 400', () =>
  ile(async (h) => {
    h.okumaVer();
    let r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ bilesenler: [] }));
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'node_secim');
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ bilesenler: [H.D.prc] }));
    assert.equal(r.body.blocked, 'node_secim', 'processor secilebildi');
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ bilesenler: [H.D.adp, H.D.api] }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ev = h.d.gateArgs.extraVars;
    assert.equal(ev.crypto_hub_targets, `deployment/${H.D.adp},deployment/${H.D.api}`);
    const plan = JSON.parse(Buffer.from(ev.crypto_hub_node_plan_b64, 'base64').toString('utf8'));
    assert.deepEqual(plan.map((p) => p.d).sort(), [H.D.adp, H.D.api].sort());
    const expect = JSON.parse(Buffer.from(ev.crypto_hub_node_expect_b64, 'base64').toString('utf8'));
    assert.equal(Object.keys(expect).length, 3, 'expect grubun tamamini tasimali');
    const m = h.d.smartCreated[0].metadata;
    assert.match(m.ACIKLAMA, /Değişecek bileşenler: adapter, api\n/);
    assert.match(m.ACIKLAMA, /Değişmeyecek bileşenler: indexer\n/);
    const row = h.d.rows[0];
    assert.equal(row.hedefler, `${H.D.adp},${H.D.api}`);
    const a = h.d.audits.find((x) => x.action === 'crypto_hub_node_change_talep');
    assert.deepEqual(JSON.parse(a.opts.detail).bilesenler, ['adapter', 'api']);
    // GET /nodes: bilesen basina mevcut node ve secilebilirlik ekrana gelir.
    r = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    const evm = r.body.gruplar.find((g) => g.id === G_EVM);
    const idx = evm.deploymentlar.find((d) => d.ad === H.D.idx);
    assert.equal(idx.secilebilir, true);
    assert.equal(idx.mevcutNode.katalogId, 'das_test_eth_a');
    assert.equal(evm.deploymentlar.find((d) => d.ad === H.D.prc).secilebilir, false);
  }));

test('N7d PS7 409 node_bekleyen_talep ve ACILIYOR engeli birebir metin', () =>
  ile(async (h) => {
    h.okumaVer();
    const b = await talepAc(h);
    let r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 409);
    assert.equal(
      r.body.message,
      `Bu grup için açık bir talep var (Smart #${b.externalTicketId}). Sonuçlanmadan yeni talep açılamaz.`,
    );
    const row = h.d.rows.find((x) => x.id === b.talepId);
    Object.assign(row, { external_ticket_id: null, durum: 'ACILIYOR' });
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.body.message, `Bu grup için açık bir talep var (Portal #${b.talepId}). Sonuçlanmadan yeni talep açılamaz.`);
    r = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(
      r.body.gruplar.find((g) => g.id === G_EVM).engel,
      `Bu grup için açık bir talep var (Portal #${b.talepId}). Sonuçlanmadan yeni talep açılamaz.`,
    );
  }));

test('N13 PS8 baska kiracinin NODESUM satiri talebi kapatamaz; gecmis okunamazsa hicbir grup degismez', () =>
  ile(async (h) => {
    h.okumaVer();
    const b = await talepAc(h);
    const row = h.d.rows.find((x) => x.id === b.talepId);
    const st = {
      status: 'successful',
      artifacts: { crypto_hub_ops_result: { lines: [`NODESUM\tmetaco_gar_test\tok\tdas_test_eth_b\t${b.talepId}\t-`] } },
    };
    const s = h.NODE.isSonucu(row, st);
    assert.equal(s.durum, 'OLCULEMEDI', 'baska kiracinin basari satiri kabul edildi');
    assert.equal(s.kod, 'NODESUM_UYUSMUYOR');
    assert.equal(h.NODE.isSonucu(row, { ...st, artifacts: { crypto_hub_ops_result: { lines: [`NODESUM\t${T}\tok\tdas_test_eth_b\t${b.talepId}\t-`] } } }).durum, 'BASARILI');
    // Gecmis (acik talepler) okunamazsa: fail-closed, Degistir hicbir grupta acik degil.
    h.d.dbBozuk = true;
    const r = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    h.d.dbBozuk = false;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.gecmisOkunamadi, true);
    assert.ok(r.body.gruplar.length > 0);
    assert.ok(r.body.gruplar.every((g) => g.degistirilebilir === false), 'gecmis okunamazken grup degistirilebilir');
  }));

test('N14 PS2 bilete bagli takili satir yas sinirinda TAKILDI kapanir; PENDING bilet yerelde iptal; sinir icinde acik', () =>
  ile(async (h) => {
    const N = require('../../../shared/cryptoHubNodes.cjs');
    const once = (dk) => new Date(Date.now() - dk * 60000);
    let tid = 900;
    const satir = (bilet, o = {}) => {
      const t = { id: tid++, external_ticket_id: `SM-${tid}`, status: 'PENDING', pending_launch_json: '{}', created_at: new Date(), ...bilet };
      h.d.smartTickets.push(t);
      const r = { id: h.d.nextId++, tenant_key: T, grup: G_EVM, kilit: `k${h.d.nextId}`, durum: 'BEKLIYOR', smart_ticket_id: t.id, external_ticket_id: t.external_ticket_id, awx_server_id: null, awx_job_id: null, kapandi_at: null, username: 'u', yeni_node_id: 'das_test_eth_b', created_at: once(N.TAKILDI_DK + 5), ...o };
      h.d.rows.push(r);
      return { r, t };
    };
    const launching = satir({ status: 'LAUNCHING' });
    const jobsuz = satir({ status: 'LAUNCHED', awx_job_id: null });
    const scheduled = satir({ status: 'SCHEDULED' });
    const pending = satir({ status: 'PENDING' });
    const awx = satir({ status: 'LAUNCHED', awx_job_id: 4242, awx_server_id: 1 }, { durum: 'CALISIYOR', awx_server_id: 1, awx_job_id: 4242 });
    const taze = satir({ status: 'LAUNCHING' }, { created_at: once(N.TAKILDI_DK - 30) });
    const tazeAwx = satir({ status: 'LAUNCHED', awx_job_id: 4343, awx_server_id: 1 }, { durum: 'CALISIYOR', awx_server_id: 1, awx_job_id: 4343, created_at: once(30) });
    h.d.awxBozuk = true;
    await h.NODE.nodeSonuclariniTara();
    h.d.awxBozuk = false;
    for (const [ad, x] of Object.entries({ launching, jobsuz, scheduled, pending, awx })) {
      assert.equal(x.r.durum, 'OLCULEMEDI', ad);
      assert.equal(x.r.sonuc_kod, 'TAKILDI', ad);
      assert.ok(x.r.kapandi_at, ad);
      assert.match(JSON.parse(x.r.sonuc_json).not, /durum bilinmiyor/);
    }
    assert.equal(pending.t.status, 'CANCELLED', 'PENDING bilet yerelde iptal edilmedi (onay gelirse is baslardi)');
    assert.equal(launching.t.status, 'LAUNCHING', 'PENDING olmayan bilete dokunuldu');
    assert.equal(taze.r.kapandi_at, null, 'sinir icindeki satir kapandi');
    assert.equal(tazeAwx.r.kapandi_at, null, 'AWX gecici hatasinda sinir icindeki satir kapandi');
    assert.equal(h.d.audits.filter((x) => x.action === 'crypto_hub_node_change_result').length, 5);
  }));

test('N15 PS2 Admin gerekceyle takili talebi kapatir (denetim + PENDING bilet iptali); digerleri kapatamaz', () =>
  ile(async (h) => {
    h.okumaVer();
    const b = await talepAc(h);
    const yol = `/node-change/${b.talepId}/kapat`;
    let r = await h.istek('POST', yol, K.nodecu, { gerekce: 'takildi, kapatiyorum lutfen' });
    assert.equal(r.status, 403);
    r = await h.istek('POST', yol, K.admin, { gerekce: 'kisa' });
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'node_gerekce');
    r = await h.istek('POST', yol, K.admin, { gerekce: 'Bilet Smart tarafinda takildi, kilit aciliyor' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.talep.durum, 'IPTAL');
    assert.equal(r.body.talep.sonucKod, 'ADMIN_KAPATTI');
    assert.equal(r.body.smart.yerelIptal, true);
    assert.equal(h.d.smartTickets.find((x) => x.id === b.ticketId).status, 'CANCELLED');
    assert.ok(h.d.audits.some((x) => x.action === 'crypto_hub_node_change_admin_kapat'));
    const sonuc = h.d.audits.filter((x) => x.action === 'crypto_hub_node_change_result');
    assert.equal(JSON.parse(sonuc[sonuc.length - 1].opts.detail).yol, 'admin');
    r = await h.istek('POST', yol, K.admin, { gerekce: 'Bilet Smart tarafinda takildi, kilit aciliyor' });
    assert.equal(r.status, 409, 'kapali talep yeniden kapatildi');
    // Kilit acildi: ayni grup icin yeni talep acilabilir.
    r = await h.istek('POST', '/node-change', K.nodecu, GOVDE());
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }));

test('N16 iptal yarisi: PENDING bilet iptal edilemezse satir ve kilit acik kalir; AWX isi baslamis talebi Admin kapatamaz', () =>
  ile(async (h) => {
    const N = require('../../../shared/cryptoHubNodes.cjs');
    const once = (dk) => new Date(Date.now() - dk * 60000);
    const t = { id: 990, external_ticket_id: 'SM-990', status: 'PENDING', pending_launch_json: '{}', created_at: new Date() };
    h.d.smartTickets.push(t);
    const r = { id: h.d.nextId++, tenant_key: T, grup: G_EVM, kilit: 'k990', durum: 'BEKLIYOR', smart_ticket_id: t.id, external_ticket_id: t.external_ticket_id, awx_server_id: null, awx_job_id: null, kapandi_at: null, username: 'u', yeni_node_id: 'das_test_eth_b', created_at: once(N.TAKILDI_DK + 5) };
    h.d.rows.push(r);
    h.d.iptalYarisi = true;
    await h.NODE.nodeSonuclariniTara();
    assert.equal(r.kapandi_at, null, 'iptal edilemeyen PENDING biletli satir TAKILDI ile kapandi (is sonradan kosabilir)');
    let res = await h.istek('POST', `/node-change/${r.id}/kapat`, K.admin, { gerekce: 'Bilet Smart tarafinda takildi, kilit aciliyor' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(r.kapandi_at, null, 'Admin iptal edilemeyen bileti kapatti');
    h.d.iptalYarisi = false;
    await h.NODE.nodeSonuclariniTara();
    assert.equal(r.sonuc_kod, 'TAKILDI', 'iptal basarinca sonraki turda kapanmadi');
    const t2 = { id: 991, external_ticket_id: 'SM-991', status: 'LAUNCHED', pending_launch_json: '{}', created_at: new Date() };
    h.d.smartTickets.push(t2);
    const r2 = { ...r, id: h.d.nextId++, kilit: 'k991', durum: 'CALISIYOR', smart_ticket_id: t2.id, external_ticket_id: 'SM-991', awx_server_id: 1, awx_job_id: 5151, kapandi_at: null, sonuc_kod: null, created_at: once(30) };
    h.d.rows.push(r2);
    res = await h.istek('POST', `/node-change/${r2.id}/kapat`, K.admin, { gerekce: 'Is uzun surdu, kilit aciliyor lutfen' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.message, /AWX işi #5151/);
    assert.equal(r2.kapandi_at, null, 'AWX isi suren talep kapatildi (kilit birakilirdi)');
  }));

test('N16b onaylanmis veya okunamayan Smart biletinde Admin kilidi acamaz', () =>
  ile(async (h) => {
    h.okumaVer();
    const b = await talepAc(h);
    const row = h.d.rows.find((x) => x.id === b.talepId);
    const ticket = h.d.smartTickets.find((x) => x.id === b.ticketId);
    const yol = `/node-change/${b.talepId}/kapat`;

    const aciliyor = { ...row, id: h.d.nextId++, kilit: 'aciliyor-kilit', durum: 'ACILIYOR', smart_ticket_id: null, external_ticket_id: null, kapandi_at: null };
    h.d.rows.push(aciliyor);
    let res = await h.istek('POST', `/node-change/${aciliyor.id}/kapat`, K.admin, { gerekce: 'Smart bileti henuz baglanmadi, kilit acilamaz' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(aciliyor.kapandi_at, null, 'ACILIYOR ticketsiz satir kapatildi');

    ticket.status = 'APPROVED';
    res = await h.istek('POST', yol, K.admin, { gerekce: 'Smart onaylandi, kilit guvenle acilamaz' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(row.kapandi_at, null, 'onaylanmis fakat AWX numarasi yazilmamis talep kapatildi');

    ticket.status = 'PENDING';
    h.d.storeOkunamaz = true;
    res = await h.istek('POST', yol, K.admin, { gerekce: 'Smart okunamiyor, kilit guvenle acilamaz' });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(row.kapandi_at, null, 'Smart sahipligi okunamayan talep kapatildi');
  }));

test('N6c PS6 Ankara talebi Istanbul bagini SUNUCUDA kurar (istemci esTalepId gondermese de)', () =>
  ile(async (h) => {
    const N = require('../../../shared/cryptoHubNodes.cjs');
    const once = N.nodeAcikMi;
    N.nodeAcikMi = (t) => !!t && t.app === 'metaco';
    try {
      h.okumaVer({}, Date.now(), 'metaco_das_prod');
      const g = GOVDE({ tenant: 'metaco_das_prod', onayMetni: G_EVM });
      const ist = (await h.istek('POST', '/node-change', K.nodecu, g)).body;
      assert.equal(ist.ok, true, JSON.stringify(ist));
      h.okumaVer({}, Date.now(), 'metaco_das_prod_ank');
      // Sihirbaz kapanip elle yeniden acildi: govdede esTalepId YOK.
      const r = await h.istek('POST', '/node-change', K.nodecu, { ...g, tenant: 'metaco_das_prod_ank' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const ank = h.d.rows.find((x) => x.id === r.body.talepId);
      assert.equal(ank.es_talep_id, ist.talepId, 'Ankara talebi Istanbul talebine baglanmadi');
      assert.match(h.d.smartCreated[1].metadata.ACIKLAMA, new RegExp(`İstanbul talebi: Smart #${ist.externalTicketId}`));
      // Istanbul kiracisinda ve baska grupta bag kurulmaz.
      const b2 = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ tenant: 'metaco_das_prod', grup: G_BTC, nodeId: 'das_test_btc_b', onayMetni: G_BTC }));
      assert.equal(h.d.rows.find((x) => x.id === b2.body.talepId).es_talep_id, null);
    } finally {
      N.nodeAcikMi = once;
    }
  }));
