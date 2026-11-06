// server/crypto-hub/__tests__/node-birim.test.cjs - Indexer / Node saf fonksiyonlari (2026-11-02).
//
// N1 desenler, N2 satir ayristirici (NODECAT yok sayilir, NODESUM plan_sha), N3 grup plani
// (serbest metin yeni deger: rol kumesi, bicim, bos onayi, ayni deger, tutarsizlik), N4 extra_vars
// (yer tutucu yeni_b64), N5 Smart metadata (yalniz maskeli), N17 deger dogrulama / maskeleme
// (Python ile ayni kural), N18 launch oncesi kanca (sifreli kolon -> extra_vars).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const N = require('../../../shared/cryptoHubNodes.cjs');
const NODE = require('../node.cjs');
const H = require('./_node_harness.cjs');
const { tenantOf } = require('../../../shared/cryptoHubTenants.cjs');

const okuma = (o) => ({ parsed: NODE.parseNodeLines(H.satirlar(o)), at: Date.now() });
const coz = (b) => JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
const BOS_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('N1 uis deseni: hmz/hmzbank, 4 bilesen; eski desen uis- almaz', () => {
  const das = N.uisDeseni('hmz');
  const gar = N.uisDeseni('hmzbank');
  for (const b of ['adapter', 'api', 'indexer', 'processor']) {
    const m = das.exec(`hmz-harmonize-uis-${b}-evm-ethereum-mainnet`);
    assert.ok(m, `das ${b}`);
    assert.equal(m[1], b);
    assert.equal(m[2], 'evm-ethereum-mainnet');
    assert.ok(gar.exec(`hmzbank-harmonize-uis-${b}-xrpl-mainnet`), `gar ${b}`);
  }
  assert.equal(das.exec('hmzbank-harmonize-uis-api-evm-x'), null, 'DAS deseni GAR adini almamali');
  assert.equal(gar.exec('hmz-harmonize-uis-api-evm-x'), null, 'GAR deseni DAS adini almamali');
  assert.equal(das.exec('hmz-harmonize-uis-foo-x1'), null, 'bilinmeyen bilesen dissarida');
  const eski = N.eskiDeseni('hmz');
  assert.ok(eski.exec('hmz-harmonize-nbxplorer-mainnet'));
  assert.ok(eski.exec('hmz-harmonize-substrate-polkadot-assethub'));
  assert.equal(eski.exec('hmz-harmonize-uis-indexer-evm-ethereum-mainnet'), null, 'eski desen yeni tipi almamali');
  // Okumadan gruplar: xrpl'de adapter yok -> grup var, adapter null.
  const t = tenantOf('metaco_das_test');
  const g = NODE.taramadanGruplar(
    t,
    [
      { kind: 'Deployment', name: 'hmz-harmonize-uis-indexer-xrpl-mainnet', want: 1, ready: 1, state: 'running' },
      { kind: 'Deployment', name: 'hmz-harmonize-uis-api-xrpl-mainnet', want: 1, ready: 1, state: 'running' },
      { kind: 'Deployment', name: 'hmz-harmonize-gateway', want: 1, ready: 1 },
      { kind: 'StatefulSet', name: 'hmz-harmonize-uis-indexer-evm-x', want: 1, ready: 1 },
    ],
    { nodeAcik: true, talepYetkisi: true, bekleyenler: new Map() },
  );
  assert.equal(g.length, 1);
  assert.equal(g[0].id, 'uis:xrpl-mainnet');
  assert.equal(g[0].kilit, 'uis-xrpl-mainnet');
  assert.equal(g[0].bilesenler.adapter, null);
  assert.equal(g[0].bilesenler.indexer.ad, 'hmz-harmonize-uis-indexer-xrpl-mainnet');
  assert.equal(g[0].okumaBekleniyor, true);
  assert.ok(!('adaylar' in g[0]), 'okumasiz grupta aday alani kaldi');
  assert.equal(N.NODE_ID_RE, undefined, 'node id deseni kaldirilmadi');
});

test('N1b nodeAcikMi / lokasyon / es kiraci', () => {
  assert.equal(N.nodeAcikMi(tenantOf('metaco_das_test')), true);
  assert.equal(N.nodeAcikMi(tenantOf('metaco_gar_test')), true);
  for (const k of ['metaco_das_prod', 'metaco_das_prod_ank', 'metaco_gar_prod']) {
    assert.equal(N.nodeAcikMi(tenantOf(k)), false, `${k} faz 1'de kapali olmali`);
  }
  assert.equal(N.nodeAcikMi(tenantOf('wyden_test')), false, 'Wyden node degisikligi yok');
  assert.equal(N.lokasyon(tenantOf('metaco_das_prod_ank')), 'Ankara');
  assert.equal(N.lokasyon(tenantOf('metaco_das_prod')), 'İstanbul');
  assert.equal(N.esKiraciOf('metaco_das_prod'), 'metaco_das_prod_ank');
  assert.equal(N.esKiraciOf('metaco_gar_prod'), null, 'GAR prodda Ankara onerisi yok');
  assert.deepEqual([...N.NODE_PROD_ACIK], []);
  assert.ok(Object.isFrozen(N.NODE_PROD_ACIK));
});

test("N2 parseNodeLines: tum satir turleri; NODECAT yok sayilir; NODESUM plan_sha; eksik alan hatalar'a", () => {
  const t = H.T;
  const PS = 'a'.repeat(64);
  const lines = [
    ...H.satirlar(),
    `NODECAT\t${t}\teski_id\t${H.G_EVM}\trpc\tEski kayit\t${H.URL_B}\t${H.SHA.b}\t-`,
    `NODECHG\t${t}\t${H.D.idx}\tapp\tETH_INDEXER_NODE_URI\t${H.URL_A}\t${H.URL_B}\tyazildi`,
    `ROLLOUT\t${t}\t${H.D.idx}\tok\t42`,
    `VERIFY\t${t}\t${H.D.idx}\tapp\tETH_INDEXER_NODE_URI\tok`,
    `ROLLBACK\t${t}\t${H.D.adp}\tok`,
    `NODEYEDEK\t${t}\t/vhosting/crypto-hub/node-backup/${t}/x/a.yaml`,
    `NODEYEDEK\t${t}\tsupurme\t3`,
    `ERR\t${t}\tgitops\tApplication listesi okunamadi`,
    `NODEDEP\t${t}\teksik`,
    `BILINMEYEN\t${t}\tx`,
  ];
  const p = NODE.parseNodeLines(lines);
  assert.equal(p.tenantKey, t);
  assert.equal(p.araclar.stdinEnv, 'var');
  assert.equal(p.araclar.python, '3.6.8');
  assert.equal(p.gruplar.size, 4);
  assert.equal(p.gruplar.get(H.G_BTC).kilit, p.gruplar.get(H.G_LTC).kilit, 'BTC ve LTC ayni kilit');
  assert.ok(p.deps.length >= 6);
  assert.ok(p.allow.find((a) => a.env === 'SIDECAR_AUTH_VALUE' && a.bicim === 'sir'));
  assert.equal(p.end.durum, 'ok');
  assert.equal(p.degisiklikler.length, 1);
  assert.equal(p.rollout[0].sureSn, 42);
  assert.equal(p.verify[0].durum, 'ok');
  assert.equal(p.rollback[0].durum, 'ok');
  assert.equal(p.yedek.length, 1);
  assert.equal(p.supurme, 3);
  assert.ok(p.hatalar.some((h) => h.stage === 'ayristir'), 'eksik alanli satir sessizce atildi');
  assert.ok(p.hatalar.some((h) => h.stage === 'gitops'));
  assert.equal(p.sum, null, 'NODESUM yokken sonuc uydurulmamali');
  // NODECAT artik tanimsiz tur: alan yok, hata da yok (eski betik satiri sessizce yok sayilir).
  assert.ok(!('katalog' in p), 'ayristiricida katalog alani kaldi');
  assert.ok(!p.hatalar.some((h) => /NODECAT/.test(h.message)));
  const s = NODE.parseNodeLines([`NODESUM\t${t}\tgeri_alindi\t${PS}\t42\tROLLOUT`]);
  assert.deepEqual(s.sum, { sonuc: 'geri_alindi', planSha: PS, talepId: '42', kod: 'ROLLOUT' });
  assert.equal(NODE.parseNodeLines([`NODESUM\t${t}\tfail\t-\t-\tGIRDI`]).sum.planSha, '-');
  assert.equal(
    NODE.parseNodeLines([`NODESUM\t${t}\tok\tdas_test_eth_b\t42\t-`]).sum.planSha,
    '-',
    'plan_sha olmayan 3. alan (eski betik node id) kabul edildi',
  );
  const bozuk = NODE.parseNodeLines([`NODESUM\t${t}\tbelki\tx\t1\t-`]);
  assert.equal(bozuk.sum, null, 'tanimsiz sonuc kabul edildi');
  const karisik = NODE.parseNodeLines([`NODEEND\t${t}\tnode_env_get\tok`, `NODESUM\tbaska\tok\tx\t1\t-`]);
  assert.equal(karisik.sum, null, 'baska kiracinin satiri kabul edildi');
  assert.equal(NODE.parseNodeLines(null), null);
});

test('N2b maske suzgeci: ham deger hicbir alanda kalmaz; (bos) gecer', () => {
  const p = NODE.parseNodeLines(H.satirlar());
  const ham = JSON.stringify({ e: p.envler });
  assert.ok(!ham.includes(H.SIR), 'ham sir ayristiricidan gecti');
  const auth = p.envler.find((e) => e.env === 'SIDECAR_AUTH_VALUE');
  assert.equal(auth.maskeli, '****');
  assert.equal(p.envler.find((e) => e.env === 'SIDECAR_URL').maskeli, '****', 'yolda anahtar olan URL maskelenmeli');
  assert.equal(p.envler.find((e) => e.env === 'NBXPLORER_BTCNODEENDPOINT').maskeli, '10.1.2.3:8333');
  assert.ok(p.maskeDuzeltildi >= 2);
  for (const [girdi, beklenen] of [
    ['https://eth-a.example.net/****', 'https://eth-a.example.net/****'],
    ['wss://h.example:8546', 'wss://h.example:8546'],
    ['https://u:p@h.example', '****'],
    ['https://h.example/v3/abc', '****'],
    ['https://h.example?key=abc', '****'],
    ['****', '****'],
    ['-', null],
    ['(bos)', '(bos)'],
    ['(bos) x', '****'],
    ['abc def', '****'],
    ['tcp://h.example:3001', 'tcp://h.example:3001'],
    ['ws://[fd00::1]:8546/****', 'ws://[fd00::1]:8546/****'],
    ['javascript:alert(1)', '****'],
  ]) {
    assert.equal(NODE.maskeGuvenli(girdi).deger, beklenen, girdi);
  }
  // Betigin bos literal deger icin bastigi (bos) suzgecten DUZELTILMEDEN gecer.
  const bos = NODE.parseNodeLines([
    `NODEENV\t${H.T}\t${H.G_BTC}\t${H.D.nbx}\tnbxplorer\tNBXPLORER_BTCNODEENDPOINT\tp2p\tliteral\t(bos)\t${BOS_SHA}\thayir`,
    `NODECHG\t${H.T}\t${H.D.nbx}\tnbxplorer\tNBXPLORER_BTCNODEENDPOINT\t10.1.2.3:8333\t(bos)\tyazildi`,
  ]);
  assert.equal(bos.envler[0].maskeli, '(bos)');
  assert.equal(bos.degisiklikler[0].yeni, '(bos)');
  assert.equal(bos.maskeDuzeltildi, 0, '(bos) maske hatasi sayildi');
});

test('N3 grupPlaniKur: kapilar, yeni deger sekli / bicimi / bos onayi / ayni deger, plan', () => {
  const Y = H.YENI_GOVDE;
  const kod = (o, g, yeni, opts) => NODE.grupPlaniKur(okuma(o), g, yeni, opts).blocked || 'ok';
  assert.equal(kod({}, H.G_EVM, Y[H.G_EVM]), 'ok');
  assert.equal(kod({ tutarsiz: true }, H.G_EVM, Y[H.G_EVM]), 'node_tutarsiz_onay');
  assert.equal(kod({ tutarsiz: true }, H.G_EVM, Y[H.G_EVM], { tutarsizlikOnay: true }), 'ok');
  // envFrom = kaynak degiskeni KESIN tanimliyor (referans); belirsiz = kaynak okunamadi (olculemedi).
  assert.equal(kod({ kaynak: 'envFrom' }, H.G_EVM, Y[H.G_EVM]), 'node_referans');
  assert.equal(kod({ kaynak: 'belirsiz' }, H.G_EVM, Y[H.G_EVM]), 'node_olculemedi');
  assert.equal(kod({ kaynak: 'bilinmeyen' }, H.G_EVM, Y[H.G_EVM]), 'node_olculemedi');
  assert.equal(kod({ kaynak: 'secretRef' }, H.G_EVM, Y[H.G_EVM]), 'node_referans');
  assert.equal(kod({ gitops: { adapter: 'evet' } }, H.G_EVM, Y[H.G_EVM]), 'node_gitops');
  assert.equal(kod({ gitops: { api: 'olculemedi' } }, H.G_EVM, Y[H.G_EVM]), 'node_gitops', 'olculemedi gitops izinli sayildi');
  assert.equal(kod({ stdin: 'yok', patch: 'olculemedi' }, H.G_EVM, Y[H.G_EVM]), 'node_arac_yok');
  assert.equal(kod({ stdin: 'yok', patch: 'var' }, H.G_EVM, Y[H.G_EVM]), 'ok');
  assert.equal(kod({}, 'uis:yok-grup', Y[H.G_EVM]), 'node_girdi');
  assert.equal(kod({}, H.G_EVM, Y[H.G_EVM], { production: true, onayMetni: 'uis:evm' }), 'node_onay_metni');
  assert.equal(kod({}, H.G_EVM, Y[H.G_EVM], { production: true, onayMetni: H.G_EVM }), 'ok');
  // Izin listesi yok -> node_izin_yok (eski node_katalog_disi adi kalkti).
  const izinsiz = H.satirlar().filter((l) => !(l.startsWith('NODEALLOW\t') && l.includes(`\t${H.G_EVM}\t`)));
  const iz = NODE.grupPlaniKur({ parsed: NODE.parseNodeLines(izinsiz), at: Date.now() }, H.G_EVM, Y[H.G_EVM]);
  assert.equal(iz.blocked, 'node_izin_yok');
  assert.equal(iz.status, 409);
  assert.equal(iz.message, NODE.METIN.aileYok);

  // Yeni deger sekli: rol kumesi grubun rolleriyle BIREBIR, degerler metin.
  for (const yanlis of [null, undefined, [], 'x', {}, { rpc: Y[H.G_EVM].rpc, ws: 'wss://a.invalid' }, { rpc: 5 }, { RPC: 'https://a.invalid' }]) {
    const r = NODE.grupPlaniKur(okuma(), H.G_EVM, yanlis);
    assert.equal(r.blocked, 'node_girdi', JSON.stringify(yanlis));
    assert.equal(r.status, 400);
  }
  assert.equal(kod({}, H.G_BTC, { p2p: H.YENI.btcP2p }), 'node_girdi', 'eksik rol kabul edildi');
  // Bicim: ilk hatali rol (a.roller sirasi) ve neden kodu.
  const b = NODE.grupPlaniKur(okuma(), H.G_EVM, { rpc: 'https://x.invalid/a b' });
  assert.equal(b.blocked, 'node_deger_bicim');
  assert.equal(b.status, 400);
  assert.equal(b.rol, 'rpc');
  assert.equal(b.neden, 'url');
  assert.equal(b.message, 'Geçersiz değer (rpc): url.');
  // KIRPMA YOK: bas/son bosluk desene takilir (sir sessizce degismesin).
  assert.equal(NODE.grupPlaniKur(okuma(), H.G_EVM, { rpc: ` ${Y[H.G_EVM].rpc}` }).neden, 'url');
  assert.equal(NODE.grupPlaniKur(okuma(), H.G_DOT, { url: H.YENI.dotUrl, auth: `${H.YENI.dotAuth} ` }).neden, 'sir');
  const bb = NODE.grupPlaniKur(okuma(), H.G_BTC, { p2p: 'btc.invalid:0', rpc: 'ftp://x.invalid' });
  assert.deepEqual([bb.rol, bb.neden], ['p2p', 'hostport'], 'rol sirasi a.roller degil');
  assert.equal(NODE.grupPlaniKur(okuma(), H.G_DOT, { url: H.YENI.dotUrl, auth: 'a;b' }).neden, 'yasak');

  // Bos rol: onaysiz 400; onayli ok (env bos degere yazilir).
  const bosYeni = { p2p: '', rpc: H.YENI.btcRpc };
  assert.equal(kod({}, H.G_BTC, bosYeni), 'node_bos_onay');
  assert.equal(kod({}, H.G_BTC, bosYeni, { bosOnay: 'evet' }), 'node_bos_onay', 'true disi onay kabul edildi');
  const bo = NODE.grupPlaniKur(okuma(), H.G_BTC, bosYeni, { bosOnay: true });
  assert.equal(bo.ok, true, JSON.stringify(bo));
  assert.deepEqual(bo.bosRoller, ['p2p']);
  assert.equal(bo.newSha.p2p, BOS_SHA);
  assert.deepEqual(coz(bo.yeniB64), { degerler: { p2p: '', rpc: H.YENI.btcRpc }, bos_onay: ['p2p'] });
  assert.equal(bo.yeniMaskeli.p2p, '(bos)');
  assert.match(bo.yeniOzet, /^p2p=\(bos\); rpc=http:\/\/btc-c\.node\.invalid:8332\/\*\*\*\*$/);

  // Ayni deger: girilen degerin sha'si secilen her literal satirdakiyle ayni -> 409.
  assert.equal(kod({}, H.G_EVM, { rpc: H.VAL.a }), 'node_ayni_node');
  const ayni = NODE.grupPlaniKur(okuma(), H.G_EVM, { rpc: H.VAL.a });
  assert.equal(ayni.status, 409);
  assert.equal(ayni.message, 'Girilen değer seçilen bileşenlerde zaten kullanımda — değişiklik yok.');
  assert.equal(kod({}, H.G_BTC, { p2p: H.VAL.btcP2p, rpc: H.VAL.btcRpc }), 'node_ayni_node');
  assert.equal(kod({}, H.G_BTC, { p2p: H.VAL.btcP2p, rpc: H.YENI.btcRpc }), 'ok', 'tek rol degisimi ayni sayildi');

  const p = NODE.grupPlaniKur(okuma(), H.G_EVM, Y[H.G_EVM]);
  // Varsayilan: node tasiyan TUM bilesenler (adapter/api/indexer); processor node tasimaz.
  assert.deepEqual(p.hedefler, [H.D.adp, H.D.api, H.D.idx].sort());
  assert.deepEqual(p.secilenler, ['adapter', 'api', 'indexer']);
  assert.deepEqual(p.secilmeyenler, []);
  assert.equal(p.plan.length, 3);
  assert.deepEqual(Object.keys(p.newSha), ['rpc']);
  assert.equal(p.newSha.rpc, H.hex(H.YENI.evm), 'new_sha girilen degerin sha256si degil');
  assert.deepEqual(coz(p.yeniB64), { degerler: { rpc: H.YENI.evm }, bos_onay: [] });
  assert.deepEqual(p.bosRoller, []);
  assert.equal(p.expect[`${H.D.idx}/app/NODE_URI_EVM_ETHEREUM_MAINNET`], H.SHA.a);
  assert.equal(p.expect[`${H.D.adp}/app/NODE_ADDR`], H.SHA.a);
  assert.ok(!('node' in p), 'plan node kaydi tasiyor');
  // api bileseni env TASIMIYORSA: plana girmez, dokunulmaz, secilemez.
  const pa = NODE.grupPlaniKur(okuma({ apiTasimaz: true }), H.G_EVM, Y[H.G_EVM]);
  assert.deepEqual(pa.hedefler, [H.D.adp, H.D.idx].sort());
  assert.equal(
    NODE.grupPlaniKur(okuma({ apiTasimaz: true }), H.G_EVM, Y[H.G_EVM], { bilesenler: [H.D.api] }).blocked,
    'node_secim',
  );
  assert.equal(p.eskiOzet, 'rpc=https://eth-a.example.net/****');
  assert.equal(p.yeniOzet, 'rpc=https://eth-c.node.invalid/****');
  for (const k of ['metaco_das_test', 'metaco_das_prod_ank']) {
    const oz = NODE.ozetKur({ tenant: tenantOf(k), plani: p, gerekce: 'gerekce metni yeterli', username: 'u' });
    assert.doesNotMatch(JSON.stringify(oz), /katalog/i, `${k}: Smart metninde "katalog" kaldi`);
    assert.ok(JSON.stringify(oz).includes('rpc=https://eth-a.example.net/****'), `${k}: eski maskeli deger yok`);
    assert.ok(!JSON.stringify(oz).includes(H.SIR), `${k}: Smart metninde ham deger`);
  }

  // Cok env'li grup ATOMIK: iki rol de planda.
  const bt = NODE.grupPlaniKur(okuma(), H.G_BTC, Y[H.G_BTC]);
  assert.equal(bt.ok, true);
  assert.deepEqual(Object.keys(bt.newSha).sort(), ['p2p', 'rpc']);
  assert.equal(bt.plan.length, 2);
  assert.equal(bt.grup.kilit, 'eski-nbxplorer-mainnet');
  // Sir rolu: plan ve ozetlerde deger yok.
  const dot = NODE.grupPlaniKur(okuma(), H.G_DOT, Y[H.G_DOT]);
  assert.equal(dot.ok, true);
  const disari = JSON.stringify({ plan: dot.plan, e: dot.eskiOzet, y: dot.yeniOzet, m: dot.yeniMaskeli, s: dot.newSha });
  assert.ok(!disari.includes(H.SIR), 'plan / ozet / maske ham deger tasiyor');
  assert.equal(dot.yeniOzet, 'auth=****; url=https://dot-c.node.invalid/****');

  // Onizleme: deger almaz, ayni-deger / bos kontrolu yok, yeni ozet (önizleme).
  const on = NODE.grupPlaniKur(okuma(), H.G_DOT, null, { onizleme: true, tutarsizlikOnay: true });
  assert.equal(on.ok, true, JSON.stringify(on));
  assert.equal(on.yeniOzet, 'auth=(önizleme); url=(önizleme)');
  assert.equal(on.yeniB64, null);
});

test('N3b ekran gruplari: rozetler, engel sirasi, BTC/LTC ortak bekleyen; aday alani yok', () => {
  const parsed = NODE.parseNodeLines(H.satirlar({ tutarsiz: true, replicas: 0, apiTasimaz: true }));
  const bekleyenler = new Map([['eski-nbxplorer-mainnet', { talepId: 9, externalTicketId: 'SM-1', username: 'x', createdAt: null, durum: 'BEKLIYOR' }]]);
  const g = NODE.gruplariKur(parsed, { nodeAcik: true, talepYetkisi: true, bekleyenler });
  const evm = g.find((x) => x.id === H.G_EVM);
  assert.equal(evm.tutarsiz, true);
  assert.equal(evm.bilesenler.api.nodeBagli, false);
  assert.equal(evm.bilesenler.api.secilebilir, false);
  assert.equal(evm.bilesenler.indexer.nodeBagli, true);
  assert.equal(evm.bilesenler.indexer.secilebilir, true);
  // Bilesen basina su anki deger: yalniz maskeli (tutarsiz grupta bilesenler farkli).
  assert.deepEqual(evm.bilesenler.indexer.mevcutNode, { maskeli: { rpc: H.URL_A } });
  assert.deepEqual(evm.bilesenler.adapter.mevcutNode, { maskeli: { rpc: H.URL_B } });
  assert.equal(evm.bilesenler.processor.nodeBagli, false, 'processor node tasimaz');
  assert.equal(evm.bilesenler.processor.envFrom, 'var', 'NODEDEP envFrom notu ekrana gelmedi');
  assert.equal(evm.durdurulmus.length, 4);
  assert.deepEqual(Object.keys(evm.mevcutNode), ['maskeli']);
  assert.ok(!('adaylar' in evm), 'grup aday listesi tasiyor');
  assert.ok(evm.envler.every((e) => !('katalogId' in e)), 'env satiri liste eslesmesi tasiyor');
  assert.equal(evm.degistirilebilir, true);
  for (const id of [H.G_BTC, H.G_LTC]) {
    const x = g.find((y) => y.id === id);
    assert.equal(x.degistirilebilir, false, `${id} ortak kilitte bekleyen talep varken degistirilebilir`);
    assert.match(x.engel, /Smart #SM-1/);
  }
  const kapali = NODE.gruplariKur(parsed, { nodeAcik: false, talepYetkisi: true, bekleyenler: new Map() });
  assert.ok(kapali.every((x) => x.engel === NODE.METIN.kapali));
  const yetkisiz = NODE.gruplariKur(parsed, { nodeAcik: true, talepYetkisi: false, bekleyenler: new Map() });
  assert.ok(yetkisiz.every((x) => x.engel === NODE.METIN.yetkiYok));
  assert.ok(!JSON.stringify(g).includes(H.SIR), 'ekran ciktisinda ham sir');
  assert.doesNotMatch(JSON.stringify(g), /katalog/i);
});

test('N4 nodeExtraVars: sozlesme 1.1 anahtar kumesi birebir; yeni_b64 yer tutucu; node id yok', () => {
  const p = NODE.grupPlaniKur(okuma(), H.G_DOT, H.YENI_GOVDE[H.G_DOT]);
  const ev = NODE.nodeExtraVars({
    tenantKey: H.T,
    grupId: H.G_DOT,
    talepId: 42,
    plan: p.plan,
    expect: p.expect,
    newSha: p.newSha,
    hedefler: p.hedefler,
    email: 'a@b.c',
  });
  assert.deepEqual(Object.keys(ev).sort(), [
    'crypto_hub_action',
    'crypto_hub_node_expect_b64',
    'crypto_hub_node_grup',
    'crypto_hub_node_new_sha_b64',
    'crypto_hub_node_plan_b64',
    'crypto_hub_node_talep',
    'crypto_hub_node_yeni_b64',
    'crypto_hub_targets',
    'crypto_hub_tenant',
    'crypto_hub_timeout',
    'email',
  ]);
  assert.equal(ev.crypto_hub_node_yeni_b64, '', 'bekleyen pakette deger var');
  assert.ok(!('crypto_hub_node_id' in ev));
  assert.equal(ev.crypto_hub_action, 'node_change');
  assert.equal(ev.crypto_hub_timeout, 1800);
  assert.equal(ev.crypto_hub_node_talep, 42);
  assert.equal(ev.crypto_hub_targets, `deployment/${H.D.dot}`);
  const plan = coz(ev.crypto_hub_node_plan_b64);
  assert.deepEqual(Object.keys(plan[0]).sort(), ['c', 'd', 'e', 'r'], 'plan satirinda deger alani var');
  assert.deepEqual(coz(ev.crypto_hub_node_new_sha_b64), { auth: H.hex(H.YENI.dotAuth), url: H.hex(H.YENI.dotUrl) });
  const hepsi = JSON.stringify(ev) + Object.values(ev).map((v) => (typeof v === 'string' ? Buffer.from(v, 'base64').toString('latin1') : '')).join('');
  assert.ok(!hepsi.includes(H.SIR), 'extra_vars deger tasiyor');
  for (const k of ['crypto_hub_node_plan_b64', 'crypto_hub_node_expect_b64', 'crypto_hub_node_new_sha_b64']) {
    assert.ok(ev[k].length <= 8192);
  }
  const k1 = NODE.planKodla(p.plan, p.expect, p.newSha, p.yeniB64);
  assert.match(k1.planSha, /^[0-9a-f]{64}$/);
  assert.equal(
    k1.planSha,
    H.hex(ev.crypto_hub_node_plan_b64 + ev.crypto_hub_node_expect_b64 + ev.crypto_hub_node_new_sha_b64),
    'plan_sha yeni_b64 icermemeli',
  );
  const buyuk = Array.from({ length: 400 }, (_, i) => ({ d: `hmz-harmonize-x-${i}`, c: 'app', e: 'ETH_INDEXER_NODE_URI', r: 'rpc' }));
  assert.throws(() => NODE.planKodla(buyuk, {}, {}), /8192/);
  assert.throws(() => NODE.planKodla(p.plan, p.expect, p.newSha, 'A'.repeat(N.YENI_B64_AZAMI + 1)), /16384/);
  assert.doesNotThrow(() => NODE.planKodla(p.plan, p.expect, p.newSha, 'A'.repeat(N.YENI_B64_AZAMI)));
  // Iki rol x 2048 karakter, JSON kacisi en kotu durum (sir rolunde " ve \ serbest) sinirin altinda.
  const kotu = NODE.grupPlaniKur(okuma(), H.G_DOT, { url: `https://d.invalid/${'a'.repeat(2030)}`, auth: '"\\'.repeat(1024) });
  assert.equal(kotu.ok, true, JSON.stringify(kotu));
  assert.ok(kotu.yeniB64.length <= N.YENI_B64_AZAMI, String(kotu.yeniB64.length));
});

const OPSX_SABLON = [
  'JRDESTAPPLICATION_1: {{opsx.hedefler}}',
  'ACIKLAMA: {{opsx.islem}}',
  "JRENV: {% if opsx.ortam == 'prod' %}Production_9{% else %}Test{% endif %}",
  'TAM: {{ opsx.aciklama | default(opsx.islem) }}',
  'CL: {{ extraVars.oc_cluster }}',
  'JT: {{ extraVars.job_type }}',
].join('\n');

function ornekOzet(tenantKey = H.T, esTalep = null) {
  const t = tenantOf(tenantKey);
  const p = NODE.grupPlaniKur(okuma({ t: tenantKey }), H.G_DOT, H.YENI_GOVDE[H.G_DOT], {
    production: t.production,
    onayMetni: H.G_DOT,
  });
  assert.equal(p.ok, true);
  return { t, p, ozet: NODE.ozetKur({ tenant: t, plani: p, gerekce: 'Gerekce\tsekmeli metin', username: 'nodecu', esTalep }) };
}

test('N5 cryptoNodeMetadata: OpsX sablonu ayni sozlukle render; yeni deger maskeli; bos/rollout sablonu 400; sir yok', () => {
  const { ozet } = ornekOzet();
  assert.equal(ozet.ortam, 'test');
  assert.equal(ozet.cluster, 'metaco_das');
  assert.equal(ozet.hedefler, `harmonize-test,${H.D.dot}`);
  assert.ok(ozet.islem.length <= 400);
  for (const s of ['Crypto Hub Indexer/Node Change', H.T, 'İstanbul', H.G_DOT, '-> auth=****; url=https://dot-c.node.invalid/****']) {
    assert.ok(ozet.islem.includes(s), `islem ozetinde yok: ${s}`);
  }
  // K5: opsx.yeniNode maskeli ozet; yeniNodeAd yok; bosRoller her zaman metin.
  assert.equal(ozet.yeniNode, 'auth=****; url=https://dot-c.node.invalid/****');
  assert.ok(!('yeniNodeAd' in ozet), 'opsx.yeniNodeAd kaldi');
  assert.equal(ozet.bosRoller, '');
  assert.match(ozet.aciklama, /\nYeni node \(maskeli\): auth=\*\*\*\*; url=https:\/\/dot-c\.node\.invalid\/\*\*\*\*\n/);
  assert.doesNotMatch(ozet.aciklama, /boş değerle yazılacak/);
  const m = NODE.cryptoNodeMetadata(OPSX_SABLON, { username: 'nodecu', email: 'n@x' }, ozet, { job_type: 'run', openshift_operations: 'openshift_application_rollout' });
  assert.equal(m.JRDESTAPPLICATION_1, ozet.hedefler);
  assert.equal(m.JRENV, 'Test');
  assert.equal(m.CL, 'metaco_das');
  assert.equal(m.JT, 'run', 'OpsX template degiskenleri baglamda yok');
  assert.match(m.TAM, /^Crypto Hub Indexer\/Node Change — NODE DEĞİŞİKLİĞİ \(rollout\/restart değil[^\n]*\nKiracı: metaco_das_test/);
  assert.match(m.TAM, /\nDeğişecek bileşenler: hmz-harmonize-substrate-polkadot-assethub\n/);
  assert.match(m.TAM, /Lokasyon: İstanbul/);
  assert.match(m.TAM, /Gerekçe: Gerekce sekmeli metin/);
  assert.ok(!JSON.stringify(m).includes(H.SIR), 'metadata sir tasiyor');
  assert.ok(!/[0-9a-f]{64}/.test(JSON.stringify(ozet)), 'Smart metninde sha256 var (en az sizinti: yok)');
  // Bos rol: aciklamada uyari satiri, opsx.bosRoller dolu.
  const tb = tenantOf(H.T);
  const pb = NODE.grupPlaniKur(okuma(), H.G_BTC, { p2p: '', rpc: H.YENI.btcRpc }, { bosOnay: true });
  const ob = NODE.ozetKur({ tenant: tb, plani: pb, gerekce: 'gerekce metni yeterli', username: 'u' });
  assert.equal(ob.bosRoller, 'p2p');
  assert.match(ob.aciklama, /\nUyarı: p2p boş değerle yazılacak \(talep eden onayladı; uygulama node'suz kalabilir\)\./);
  assert.ok(ob.islem.includes('-> p2p=(bos); rpc=http://btc-c.node.invalid:8332/****'), ob.islem);
  // Ayni sablon OpsX baglaminda da render olur (default dali): OpsX bozulmaz.
  const opsx = require('../../smart/metadata.cjs').buildSmartMetadata(OPSX_SABLON, {
    username: 'u',
    extraVars: { oc_cluster: 'ark', job_type: 'run' },
    opsx: { islem: 'Openshift rollout (restart)', ortam: 'prod', hedefler: 'ns,app' },
  });
  assert.equal(opsx.TAM, 'Openshift rollout (restart)');
  assert.equal(opsx.JRENV, 'Production_9');
  // Prod kiracida Production_9 (ayni sozluk).
  const prod = ornekOzet('metaco_das_prod_ank', { externalTicketId: 'SM-77' }).ozet;
  assert.equal(prod.ortam, 'prod');
  assert.equal(prod.lokasyon, 'Ankara');
  assert.match(prod.aciklama, /İstanbul talebi: Smart #SM-77/);
  assert.equal(NODE.cryptoNodeMetadata(OPSX_SABLON, {}, prod, { job_type: 'run' }).JRENV, 'Production_9');
  // openshift_operations VERILMEZ: kullanan sablon dusmeli.
  assert.throws(
    () => NODE.cryptoNodeMetadata('X: {{ extraVars.openshift_operations }}', {}, ozet, { openshift_operations: 'openshift_application_rollout' }),
    (e) => e.status === 400 && e.blocked === 'crypto_node_smart_sablon' && /default/.test(e.message),
  );
  assert.throws(
    () => NODE.cryptoNodeMetadata('  ', {}, ozet, {}),
    (e) => e.status === 400 && e.blocked === 'crypto_node_smart_sablon',
  );
});

// ── 2026-11-02 duzeltme turu: bilesen secimi, gercek env adlari, PS1/PS3/PS4/PS7 ─────────

test('N3c bilesen secimi: alt kume, secime gore tutarsizlik onayi ve ayni deger, dogrulama', () => {
  const o = okuma({ tutarsiz: true }); // adapter=B, api=A, indexer=A
  const plan = (sec, opts = {}, yeni = H.YENI_GOVDE[H.G_EVM]) =>
    NODE.grupPlaniKur(o, H.G_EVM, yeni, { bilesenler: sec, ...opts });
  // Yalniz indexer (su an A) -> C: secim tek degerde, ek onay GEREKMEZ.
  const p = plan([H.D.idx]);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.hedefler, [H.D.idx]);
  assert.deepEqual(p.plan.map((x) => x.d), [H.D.idx]);
  assert.deepEqual(p.secilenler, ['indexer']);
  assert.deepEqual(p.secilmeyenler.sort(), ['adapter', 'api']);
  // expect grubun TAMAMI: secilmeyen bilesenin bayatligi da betikte olculur.
  assert.deepEqual(Object.keys(p.expect).sort(), [
    `${H.D.adp}/app/NODE_ADDR`,
    `${H.D.api}/app/NODE_ADDR`,
    `${H.D.idx}/app/NODE_URI_EVM_ETHEREUM_MAINNET`,
  ]);
  assert.equal(p.tutarsizToplama, false);
  // adapter (B) + indexer (A) -> C: secilenler farkli degerde -> ek onay ZORUNLU.
  assert.equal(plan([H.D.adp, H.D.idx]).blocked, 'node_tutarsiz_onay');
  const t = plan([H.D.adp, H.D.idx], { tutarsizlikOnay: true });
  assert.equal(t.ok, true);
  assert.equal(t.tutarsizToplama, true);
  // Yalniz adapter (zaten B) -> B: secilenlerin hepsi zaten bu degerde.
  assert.equal(plan([H.D.adp], {}, { rpc: H.VAL.b }).blocked, 'node_ayni_node');
  // adapter + indexer -> B: indexer A'da, ayni DEGIL (tutarsizlik onayi ister).
  assert.equal(plan([H.D.adp, H.D.idx], {}, { rpc: H.VAL.b }).blocked, 'node_tutarsiz_onay');
  // Grup genelinde tutarsiz ama secim yoksa (varsayilan HEPSI) onay ister.
  assert.equal(NODE.grupPlaniKur(o, H.G_EVM, H.YENI_GOVDE[H.G_EVM]).blocked, 'node_tutarsiz_onay');
  // Dogrulama: bos, grup disi, tekrar, dizi degil.
  assert.equal(plan([]).blocked, 'node_secim');
  assert.equal(plan(['hmz-harmonize-uis-processor-evm-ethereum-mainnet']).blocked, 'node_secim', 'processor secilebildi');
  assert.equal(plan(['baska-deployment']).blocked, 'node_secim');
  assert.equal(plan([H.D.idx, H.D.idx]).blocked, 'node_girdi');
  assert.equal(plan(H.D.idx).blocked, 'node_girdi');
  assert.equal(plan([1]).blocked, 'node_girdi');
  // Bilet metni: degisecek ve DEGISMEYECEK bilesenler acikca.
  const oz = NODE.ozetKur({ tenant: tenantOf(H.T), plani: p, gerekce: 'gerekce metni yeterli', username: 'u' });
  assert.match(oz.aciklama, /\nDeğişecek bileşenler: indexer\n/);
  assert.match(oz.aciklama, /\nDeğişmeyecek bileşenler: adapter, api\n/);
  assert.ok(oz.islem.includes('Bileşenler: indexer'), oz.islem);
  const oz2 = NODE.ozetKur({ tenant: tenantOf(H.T), plani: t, gerekce: 'gerekce metni yeterli', username: 'u' });
  assert.match(oz2.aciklama, /farklı node'lara bağlı; talep hepsini tek node'a topluyor/);
});

test('N3d degisken yok: kurala uymayan uis grubu acik metinle degistirilemez; yasak ad suzulur', () => {
  const satir = H.satirlar().filter((l) => !(l.startsWith('NODEENV\t') && l.includes(`\t${H.G_EVM}\t`)));
  const parsed = NODE.parseNodeLines(satir);
  const g = NODE.gruplariKur(parsed, { nodeAcik: true, talepYetkisi: true, bekleyenler: new Map() });
  const evm = g.find((x) => x.id === H.G_EVM);
  assert.equal(evm.degistirilebilir, false);
  assert.equal(evm.degiskenYok, true);
  assert.equal(evm.engel, NODE.METIN.degiskenYok);
  assert.match(NODE.METIN.degiskenYok, /^Değiştirilemez: node değişkeni bulunamadı/);
  assert.equal(
    NODE.grupPlaniKur({ parsed, at: Date.now() }, H.G_EVM, H.YENI_GOVDE[H.G_EVM]).blocked,
    'node_degisken_yok',
  );
  // Asla degismeyenler: betik hatasiyla gelse bile izin listesine / plana girmez.
  const T = H.T;
  const yasak = NODE.parseNodeLines([
    ...H.satirlar(),
    `NODEALLOW\t${T}\t${H.G_EVM}\trpc\tHTTP_PROXY\turl`,
    `NODEENV\t${T}\t${H.G_EVM}\t${H.D.api}\tapp\tNO_PROXY\trpc\tliteral\thttps://p.example.net\t${H.SHA.a}\thayir`,
    `NODEALLOW\t${T}\t${H.G_EVM}\trpc\tCHAIN_ID\turl`,
    `NODEALLOW\t${T}\t${H.G_EVM}\trpc\tADDRESS_API_URL_ETH\turl`,
  ]);
  assert.ok(!yasak.allow.some((a) => N.YASAK_ENV_RE.test(a.env)), 'yasak ad izin listesine girdi');
  assert.ok(!yasak.envler.some((e) => N.YASAK_ENV_RE.test(e.env)));
  assert.equal(yasak.hatalar.filter((x) => /yasak değişken/.test(x.message)).length, 4);
  const pl = NODE.grupPlaniKur({ parsed: yasak, at: Date.now() }, H.G_EVM, H.YENI_GOVDE[H.G_EVM]);
  assert.ok(!JSON.stringify(pl.plan).match(/PROXY|CHAIN_ID|ADDRESS_API/));
  for (const ad of ['HTTP_PROXY', 'https_proxy', 'NO_PROXY', 'ADAPTER_ADDR', 'EVENT_API_URL', 'ADDRESS_API_URL_X', 'CHAIN_ID', 'CHAIN_ID_HEX']) {
    assert.ok(N.YASAK_ENV_RE.test(ad), ad);
  }
  for (const ad of ['NODE_ADDR', 'NODE_URI_EVM_ETHEREUM_MAINNET', 'NBXPLORER_BTCRPCURL', 'SIDECAR_URL']) {
    assert.ok(!N.YASAK_ENV_RE.test(ad), ad);
  }
});

test('N5b PS1 kisa alan: bilesen listesi ASLA kesilmez; yeni maskeli ozet 160ta kirpilir (iki uzun maske)', () => {
  const T = H.T;
  const uzun = (h) => `https://${h.repeat(110)}.example.net/****`;
  const L = H.satirlar().filter((l) => !(l.startsWith('NODEENV\t') && l.includes(`\t${H.G_EVM}\t`)));
  L.push(`NODEENV\t${T}\t${H.G_EVM}\t${H.D.adp}\tapp\tNODE_ADDR\trpc\tliteral\t${uzun('a')}\t${H.hex('u1')}\thayir`);
  L.push(`NODEENV\t${T}\t${H.G_EVM}\t${H.D.api}\tapp\tNODE_ADDR\trpc\tliteral\t${uzun('b')}\t${H.hex('u2')}\thayir`);
  L.push(`NODEENV\t${T}\t${H.G_EVM}\t${H.D.idx}\tapp\tNODE_URI_EVM_ETHEREUM_MAINNET\trpc\tliteral\t${uzun('c')}\t${H.hex('u3')}\thayir`);
  const parsed = NODE.parseNodeLines(L);
  const yeniUzun = { rpc: `https://${'n'.repeat(190)}.invalid/${H.SIR}` };
  const p = NODE.grupPlaniKur({ parsed, at: Date.now() }, H.G_EVM, yeniUzun, { tutarsizlikOnay: true });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.ok(p.eskiOzet.length > 300, `eski ozet kisa kaldi (${p.eskiOzet.length}) - test kor`);
  assert.ok(p.yeniOzet.length > 160, `yeni ozet kisa kaldi (${p.yeniOzet.length}) - test kor`);
  // Iki rol x uzun maske (DOT): yeni ozet 400'u asabilecek boyda.
  const dot = NODE.grupPlaniKur(okuma(), H.G_DOT, { url: `https://${'d'.repeat(190)}.invalid/x`, auth: H.YENI.dotAuth });
  assert.equal(dot.ok, true);
  for (const k of ['metaco_das_test', 'metaco_das_prod_ank']) {
    for (const [plani, bilesen] of [
      [p, 'Bileşenler: adapter, api, indexer'],
      [dot, `Bileşenler: ${H.D.dot}`],
    ]) {
      const oz = NODE.ozetKur({ tenant: tenantOf(k), plani, gerekce: 'gerekce metni yeterli', username: 'u' });
      assert.ok(oz.islem.length <= 400, `${k}: ${oz.islem.length}`);
      assert.ok(oz.islem.includes(bilesen), `${k}: bilesen listesi kesildi: ${oz.islem}`);
      const yeniKisim = oz.islem.slice(oz.islem.indexOf(' -> ') + 4, oz.islem.indexOf(' | Bileşenler:'));
      assert.ok(yeniKisim.length <= 160, `yeni maskeli ozet 160'i asti (${yeniKisim.length})`);
      assert.ok(oz.islem.indexOf(' -> ') < oz.islem.indexOf('Eski:') || !oz.islem.includes('Eski:'), 'yeni ozet eski ozetten sonra');
      // Tam hali aciklama ve opsx.yeniNode'da.
      assert.equal(oz.yeniNode, plani.yeniOzet);
      assert.ok(oz.aciklama.includes(`Yeni node (maskeli): ${plani.yeniOzet}`));
      assert.ok(!JSON.stringify(oz).includes(H.SIR));
    }
  }
});

// ── PS3 / PS4: OpsX esligi GERCEK opsxProductionKapisi baglamina karsi ───────────────────
const fs = require('node:fs');
const path = require('node:path');
const KOK = path.join(__dirname, '..', '..');
const cozYol = (p) => require.resolve(path.join(KOK, p));

function opsxAnahtarlari() {
  const src = fs.readFileSync(path.join(KOK, 'opsx', 'index.cjs'), 'utf8');
  // Legacy ve OpenShift dallari ayni acilisla baslar: OpenShift blogu openshift_operations tasiyandir.
  const ACILIS = '      extraVars = {\n        ...staticVars,';
  let bas = -1;
  let son = -1;
  for (let i = src.indexOf(ACILIS); i >= 0; i = src.indexOf(ACILIS, i + 1)) {
    const s2 = src.indexOf('\n      };', i);
    if (/openshift_operations:/.test(src.slice(i, s2))) {
      bas = i;
      son = s2;
    }
  }
  assert.ok(bas > 0 && son > bas, 'OpsX OpenShift extraVars blogu bulunamadi (bekci kor)');
  const blok = src.slice(bas, son)
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  const ev = new Set();
  for (const m of blok.matchAll(/(?:^\s*|[{,]\s*)([a-z_][a-z0-9_]*)\s*:/gm)) ev.add(m[1]);
  for (const m of blok.matchAll(/\[cfg\.(ocClusterKey|ocInputKey)\]/g)) ev.add(m[1] === 'ocClusterKey' ? 'oc_cluster' : 'oc_input');
  for (const k of ['email', 'oc_environment', 'oc_cluster', 'oc_input', 'openshift_operations', 'choise', 'target_cluster']) {
    assert.ok(ev.has(k), `OpsX extraVars taramasi ${k} bulamadi (bekci kor): ${[...ev]}`);
  }
  assert.match(blok, /choise: true/);
  const oz = /: \{ (ortam: [^}]*)\},/.exec(src.slice(src.indexOf("ozet: plat === 'legacy'")));
  assert.ok(oz, 'OpsX OpenShift ozet nesnesi bulunamadi');
  const ozet = [...oz[1].matchAll(/([a-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]);
  return { ev: [...ev], ozet };
}

async function sahteyle(sahteler, fn) {
  const once = new Map();
  for (const [p, exp] of Object.entries(sahteler)) {
    const r = cozYol(p);
    once.set(r, require.cache[r]);
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exp };
  }
  try {
    return await fn();
  } finally {
    for (const [r, e] of once) {
      if (e) require.cache[r] = e;
      else delete require.cache[r];
    }
  }
}

test('N5c PS3 OpsX esligi: gercek opsxProductionKapisi baglaminin anahtarlari node baglaminda (istisnalar adiyla)', async () => {
  const { ev, ozet } = opsxAnahtarlari();
  const ISTISNA = ['openshift_operations', 'target_cluster'];
  const yakala = [];
  const sablonVar = { job_type: 'run' };
  const sabit = { ek_sabit: 'v1', email: '' };
  const metaSahte = {
    parseSimpleYaml: require('../../smart/metadata.cjs').parseSimpleYaml,
    buildSmartMetadata: (raw, ctx) => (yakala.push(ctx), { X: 'y' }),
  };
  const opsxCtx = await sahteyle(
    {
      'opsx/config.cjs': {
        getConfig: async () => ({ smart: { openshift: { flowKey: 'F', metadataFields: 'X: {{ opsx.islem }}', enabled: true } } }),
        parseExtraVarLines: require('../../opsx/config.cjs').parseExtraVarLines,
      },
      'ansible/admin-smart-atla.cjs': { adminSmartAtliyor: async () => false, atlamayiDenetle() {} },
      'ansible/runner.cjs': {
        prefillSurveyDefaultsOnServer: async (_s, _t, e) => e,
        getTemplateVariableDefaultsOnServer: async () => ({ ...sablonVar }),
      },
      'ansible/change-gates.cjs': {
        openSmartTicket: async (a) => {
          a.buildSmartMetadata('X: y', { username: a.username, email: a.email, templateName: a.templateName, templateId: a.templateId, extraVars: a.extraVars });
          return { ticketId: 1, externalTicketId: 'SM-1' };
        },
      },
      'smart/metadata.cjs': metaSahte,
      'audit/index.cjs': { auditPortal() {} },
    },
    async () => {
      const pa = require('../../opsx/prod-approval.cjs');
      const extraVars = { ...sabit };
      for (const k of ev) if (!(k in extraVars)) extraVars[k] = k === 'choise' ? true : `${k}-x`;
      extraVars.oc_environment = 'prod';
      const r = await pa.opsxProductionKapisi({
        platform: 'openshift',
        serverId: 1,
        templateId: 55,
        extraVars,
        etiketler: [{ alan: 'ortam', deger: 'prod' }],
        req: { session: { user: { username: 'nodecu', mail: 'n@x.test' } } },
        islemAdi: 'Openshift rollout (restart)',
        ozet: Object.fromEntries(ozet.map((k) => [k, `${k}-o`])),
      });
      assert.equal(r.proceed, false);
      assert.equal(r.body.pendingApproval, true, JSON.stringify(r.body));
      return yakala.pop();
    },
  );
  assert.ok(opsxCtx && opsxCtx.opsx && opsxCtx.extraVars, 'OpsX baglami yakalanamadi');
  // Node baglami: ayni metadata sahtesiyle cryptoNodeMetadata.
  const t = tenantOf('metaco_das_prod');
  const p = NODE.grupPlaniKur(okuma({ t: t.key }), H.G_DOT, H.YENI_GOVDE[H.G_DOT], { production: true, onayMetni: H.G_DOT });
  const oz = NODE.ozetKur({ tenant: t, plani: p, gerekce: 'gerekce metni yeterli', username: 'nodecu' });
  const nodeCtx = await sahteyle({ 'smart/metadata.cjs': metaSahte }, async () => {
    NODE.cryptoNodeMetadata('X: y', { username: 'nodecu', email: 'n@x.test', templateName: 'T', templateId: 77, extraVars: { crypto_hub_action: 'node_change' } }, oz, sablonVar, {
      ocClusterKey: 'oc_cluster',
      ocInputKey: 'oc_input',
      staticVars: sabit,
    });
    return yakala.pop();
  });
  for (const k of Object.keys(opsxCtx)) assert.ok(k in nodeCtx, `ust baglam anahtari eksik: ${k}`);
  for (const k of Object.keys(opsxCtx.opsx)) assert.ok(k in nodeCtx.opsx, `opsx.${k} node baglaminda yok`);
  for (const k of Object.keys(opsxCtx.extraVars)) {
    if (ISTISNA.includes(k)) continue;
    assert.ok(k in nodeCtx.extraVars, `extraVars.${k} node baglaminda yok`);
  }
  assert.ok(!('openshift_operations' in nodeCtx.extraVars), 'node bileti rollout iş tipini tasidi');
  // Degerler: ayni sozluk.
  assert.equal(opsxCtx.opsx.uretimSebebi, 'ortam=prod');
  assert.equal(nodeCtx.opsx.uretimSebebi, opsxCtx.opsx.uretimSebebi, 'uretimSebebi OpsX ile ayni degil');
  assert.equal(nodeCtx.opsx.talepEden, 'nodecu');
  assert.equal(nodeCtx.opsx.talepEden, opsxCtx.opsx.talepEden);
  assert.equal(nodeCtx.opsx.platform, opsxCtx.opsx.platform);
  assert.equal(nodeCtx.extraVars.oc_environment, 'prod');
  assert.equal(nodeCtx.extraVars.choise, true);
  assert.equal(nodeCtx.extraVars.ek_sabit, 'v1', 'OpsX sabit ek degiskeni node baglaminda yok');
  assert.equal(nodeCtx.extraVars.email, 'n@x.test', 'sabitlerdeki bos email oturum e-postasini ezdi');
  assert.equal(nodeCtx.extraVars.job_type, 'run', 'JOBTYPE OpsX template degerinden gelmeli');
  assert.ok(String(nodeCtx.opsx.islem).startsWith('Crypto Hub Indexer/Node Change'), 'islem metni bize ozgu degil');
  // Test kiracida OpsX bilet acmaz; node bileti ortam=test, uretimSebebi bos (bilinen fark, belge T14).
  const ozT = ornekOzet().ozet;
  assert.equal(ozT.uretimSebebi, '');
  assert.equal(ozT.ortam, 'test');
});

test('N5d PS4 sabit ek degisken ve choise kullanan sablon node baglaminda da render olur', () => {
  const { ozet } = ornekOzet();
  const sab = 'S: {{ extraVars.ek_sabit }}\nC: {{ extraVars.choise }}\nE: {{ extraVars.email }}';
  const m = NODE.cryptoNodeMetadata(sab, { email: 'n@x' }, ozet, {}, { staticVars: { ek_sabit: 'v1' } });
  assert.equal(m.S, 'v1');
  assert.equal(String(m.C).toLowerCase(), 'true');
  assert.equal(m.E, 'n@x');
  const m2 = NODE.cryptoNodeMetadata(sab, { email: 'n@x' }, ozet, {}, { staticVars: { ek_sabit: 'v1', email: 'sabit@x' } });
  assert.equal(m2.E, 'sabit@x', 'OpsX gibi: sabitlerdeki email onceliklidir');
});

test('N7c PS7 talep numarasi metni sunucu ve ekranda AYNI', () => {
  assert.equal(N.talepNoMetni('SM-12', 5), 'Smart #SM-12');
  assert.equal(N.talepNoMetni(null, 12), 'Portal #12');
  assert.equal(N.talepNoMetni('', 12), 'Portal #12');
  assert.equal(N.talepNoMetni(null, null), 'Portal #?');
  assert.equal(
    NODE.METIN.bekleyen(N.talepNoMetni(null, 12)),
    'Bu grup için açık bir talep var (Portal #12). Sonuçlanmadan yeni talep açılamaz.',
  );
  const parsed = NODE.parseNodeLines(H.satirlar());
  const g = NODE.gruplariKur(parsed, {
    nodeAcik: true,
    talepYetkisi: true,
    bekleyenler: new Map([['uis-evm-ethereum-mainnet', { talepId: 12, externalTicketId: null, username: 'x', createdAt: null, durum: 'ACILIYOR' }]]),
  });
  assert.equal(g.find((x) => x.id === H.G_EVM).engel, 'Bu grup için açık bir talep var (Portal #12). Sonuçlanmadan yeni talep açılamaz.');
  const tg = NODE.taramadanGruplar(
    tenantOf(H.T),
    [{ kind: 'Deployment', name: H.D.idx, want: 1, ready: 1 }],
    { nodeAcik: true, talepYetkisi: true, bekleyenler: new Map([['uis-evm-ethereum-mainnet', { talepId: 3, externalTicketId: 'SM-9' }]]) },
  );
  assert.match(tg[0].engel, /\(Smart #SM-9\)/);
  assert.ok(!/Smart #\?|açılıyor, talep/.test(JSON.stringify(g) + JSON.stringify(tg)));
});

// ── N17 deger dogrulama + maskeleme (sozlesme 3; Python ile AYNI kural) ─────────────────
test('N17 degerDogrula / maskele: sozlesme vektorleri; desen kaynak metinleri sozlesmeyle birebir', () => {
  // Sozlesme 3.1 metinleri (bagimsiz kopya: kaynak metin sapinca kirmizi).
  assert.deepEqual({ ...N.DESEN }, {
    ascii: String.raw`^[\x20-\x7e]+$`,
    yasak: String.raw`[;\x60]|\$\(`,
    url: String.raw`^(https?|wss?)://[^\x20\x22\x24\x27\x3b\x3c\x3e\x5c\x60]+$`,
    hostport: String.raw`^[A-Za-z0-9.-]+:[0-9]{1,5}$`,
    sir: String.raw`^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$`,
  });
  assert.equal(N.DEGER_EN_COK, 2048);
  assert.equal(N.BOS_MASKE, '(bos)');
  assert.equal(N.YENI_B64_AZAMI, 16384);
  assert.deepEqual([...N.BICIMLER], ['url', 'hostport', 'sir']);
  const dol = (s, n) => s + 'a'.repeat(n - s.length);
  const V = [
    ['https://eth.node.invalid/v3/KEY123', 'url', null, 'https://eth.node.invalid/****'],
    ['https://h.invalid:8545', 'url', null, 'https://h.invalid:8545'],
    ['https://h.invalid/', 'url', null, 'https://h.invalid'],
    ['wss://u:p@xrpl.invalid:51233', 'url', null, 'wss://xrpl.invalid:51233/****'],
    ['https://h.invalid?auth=K', 'url', null, 'https://h.invalid/****'],
    ['wss://sol.invalid:8443/websocket?auth=K', 'url', null, 'wss://sol.invalid:8443/****'],
    ['https://[::1]:8545/x', 'url', null, 'https://[::1]:8545/****'],
    [dol('https://h.invalid/', 2048), 'url', null, 'https://h.invalid/****'],
    [dol('https://h.invalid/', 2049), 'url', 'uzun'],
    ['HTTPS://h.invalid', 'url', 'url'],
    ['ftp://h.invalid', 'url', 'url'],
    ['https://h.invalid/a b', 'url', 'url'],
    ['https://h.invalid/"x', 'url', 'url'],
    ["https://h.invalid/'x", 'url', 'url'],
    ['https://h.invalid/<x>', 'url', 'url'],
    ['https://h.invalid/x\\y', 'url', 'url'],
    ['https://h.invalid/$x', 'url', 'url'],
    ['https://h.invalid/;x', 'url', 'yasak'],
    ['https://h.invalid/$(id)', 'url', 'yasak'],
    ['https://h.invalid/`id`', 'url', 'yasak'],
    ['https://h.invalid/x\n', 'url', 'karakter'],
    ['https://h.invalid/\tx', 'url', 'karakter'],
    ['https://h.invalid/ü', 'url', 'karakter'],
    ['btc.invalid:8333', 'hostport', null, 'btc.invalid:8333'],
    ['btc.invalid:0', 'hostport', 'hostport'],
    ['btc.invalid:65536', 'hostport', 'hostport'],
    ['btc.invalid:8333/x', 'hostport', 'hostport'],
    ['Bearer abc', 'sir', null, '****'],
    [' abc', 'sir', 'sir'],
    ['abc ', 'sir', 'sir'],
    ['a;b', 'sir', 'yasak'],
    ['', 'url', null, '(bos)'],
    ['', 'sir', null, '(bos)'],
    ['', 'hostport', null, '(bos)'],
    ['x', 'baska', 'bicim'],
    ['', 'baska', 'bicim'],
  ];
  assert.equal(V.length, 36);
  for (const [deger, bicim, neden, maske] of V) {
    assert.equal(N.degerDogrula(deger, bicim), neden, `${JSON.stringify(deger)} / ${bicim}`);
    if (neden === null) assert.equal(N.maskele(deger, bicim), maske, `maske ${JSON.stringify(deger)}`);
  }
  assert.equal(N.degerDogrula(5, 'url'), 'tip');
  assert.equal(N.degerDogrula(null, 'sir'), 'tip');
  assert.equal(N.maskele(null, 'url'), '-');
  assert.equal(N.maskele('x'.repeat(300), 'hostport'), '****');
  // Sozlesme 3.3 adim 6: sonuc her bicimde en cok 200 karakter (hostport dahil).
  assert.equal(N.maskele(`${'h'.repeat(250)}:8333`, 'hostport').length, 200);
  assert.ok(N.maskele(`https://${'h'.repeat(250)}.invalid/x`, 'url').length <= 200);
  // Python ayni kumeyi disarida birakir (\r, U+2028, U+2029): canli degerin maskesi iki tarafta ayni.
  for (const ayrac of ['\r', ' ', ' ']) assert.equal(N.maskele(`https://h.invalid/a${ayrac}b`, 'url'), '****');
  // Maskeli cikti Portal suzgecinden duzeltilmeden gecer (betikle ayni bicim).
  for (const [deger, bicim, neden] of V) {
    if (neden !== null) continue;
    const m = N.maskele(deger, bicim);
    assert.equal(NODE.maskeGuvenli(m).duzeltildi, false, `suzgec ${m} maskesini bozdu`);
  }
});

// ── N18 launch oncesi kanca (sozlesme 4.3) ───────────────────────────────────────────
function kancaKur(o = {}) {
  const env = require('../../db/env-overrides.cjs');
  const grup = o.grup || H.G_BTC;
  const yeni = o.yeni || { p2p: '', rpc: H.YENI.btcRpc };
  const p = NODE.grupPlaniKur(okuma(), grup, yeni, { bosOnay: true });
  assert.equal(p.ok, true, JSON.stringify(p));
  const ev = NODE.nodeExtraVars({
    tenantKey: H.T,
    grupId: grup,
    talepId: 42,
    plan: p.plan,
    expect: p.expect,
    newSha: p.newSha,
    hedefler: p.hedefler,
    email: 'a@b.c',
  });
  const k = NODE.planKodla(p.plan, p.expect, p.newSha, p.yeniB64);
  const row = {
    id: 42,
    tenant_key: H.T,
    grup,
    plan_sha: k.planSha,
    smart_ticket_id: 7,
    kapandi_at: null,
    yeni_deger_secret: env.encryptSecretValue(p.yeniB64),
  };
  const db = { sorgular: [], async query(sql, prm) { this.sorgular.push(sql); return { rows: db.satir ? [{ ...db.satir }] : [] }; } };
  db.satir = row;
  const ticket = { id: 7, pendingLaunch: { extraVars: { ...ev, zorunlu_alan: 'v' }, launchOncesi: 'crypto_hub_node' } };
  return { p, ev, row, db, ticket, env };
}

test('N18 launchOncesiDegerEkle: mutlu yol, her ret ayri, hata metninde deger yok, paket degismez', async () => {
  const { p, db, ticket, row, env } = kancaKur();
  assert.match(row.yeni_deger_secret, /^enc:v1:/, 'test anahtari kurulmadi (deger duz kaldi)');
  const once = JSON.stringify(ticket.pendingLaunch);
  const r = await NODE.launchOncesiDegerEkle(ticket, { db });
  assert.equal(r.extraVars.crypto_hub_node_yeni_b64, p.yeniB64);
  assert.equal(r.extraVars.zorunlu_alan, 'v', 'prefill alanlari korunmadi');
  assert.deepEqual(r.gizliler.sort(), [p.yeniB64, H.YENI.btcRpc].sort(), 'bos deger gizli listesine girmemeli');
  assert.equal(JSON.stringify(ticket.pendingLaunch), once, 'bekleyen paket degisti');
  assert.match(db.sorgular[0], /SELECT id, tenant_key, grup, plan_sha, smart_ticket_id, kapandi_at, yeni_deger_secret FROM crypto_hub_node_changes WHERE id = \$1/);
  // ACILIYOR'da kalmis satir (bilet baglanamadi): smart_ticket_id null kabul.
  db.satir = { ...row, smart_ticket_id: null };
  assert.equal((await NODE.launchOncesiDegerEkle(ticket, { db })).extraVars.crypto_hub_node_yeni_b64, p.yeniB64);

  const sifrele = (o) => env.encryptSecretValue(Buffer.from(JSON.stringify(o), 'utf8').toString('base64'));
  const durumlar = [
    ['talep no gecersiz', (t) => (t.pendingLaunch.extraVars.crypto_hub_node_talep = 'x')],
    ['bekleyen pakette deger var (beklenmiyor)', (t) => (t.pendingLaunch.extraVars.crypto_hub_node_yeni_b64 = p.yeniB64)],
    ['bekleyen pakette deger var (beklenmiyor)', (t) => delete t.pendingLaunch.extraVars.crypto_hub_node_yeni_b64],
    ['kayit yok', (_t, d) => (d.satir = null)],
    ['talep kapanmis', (_t, d) => (d.satir.kapandi_at = new Date())],
    ['kayit uyusmuyor', (_t, d) => (d.satir.tenant_key = 'metaco_gar_test')],
    ['kayit uyusmuyor', (_t, d) => (d.satir.grup = H.G_LTC)],
    ['bilet uyusmuyor', (_t, d) => (d.satir.smart_ticket_id = 8)],
    ['plan ozeti uyusmuyor', (t) => (t.pendingLaunch.extraVars.crypto_hub_node_expect_b64 += 'x')],
    ['deger yok (temizlenmis)', (_t, d) => (d.satir.yeni_deger_secret = null)],
    ['deger yok (temizlenmis)', (_t, d) => (d.satir.yeni_deger_secret = '')],
    ['deger cozulemedi', (_t, d) => (d.satir.yeni_deger_secret = 'enc:v1:bozuk')],
    ['deger bicimi gecersiz', (_t, d) => (d.satir.yeni_deger_secret = env.encryptSecretValue('{bozuk}'))],
    ['deger bicimi gecersiz', (_t, d) => (d.satir.yeni_deger_secret = sifrele({ degerler: { p2p: '', rpc: H.YENI.btcRpc }, bos_onay: ['p2p'], x: 1 }))],
    ['deger bicimi gecersiz', (_t, d) => (d.satir.yeni_deger_secret = sifrele({ degerler: { p2p: '', rpc: H.YENI.btcRpc }, bos_onay: [] }))],
    ['deger bicimi gecersiz', (_t, d) => (d.satir.yeni_deger_secret = sifrele({ degerler: { p2p: '', rpc: H.YENI.btcRpc }, bos_onay: ['p2p', 'rpc'] }))],
    ['deger bicimi gecersiz', (_t, d) => (d.satir.yeni_deger_secret = sifrele({ degerler: { p2p: 1, rpc: H.YENI.btcRpc }, bos_onay: [] }))],
    ['deger ozeti uyusmuyor', (_t, d) => (d.satir.yeni_deger_secret = sifrele({ degerler: { p2p: 'btc-x.invalid:1', rpc: H.YENI.btcRpc }, bos_onay: [] }))],
    ['deger ozeti uyusmuyor', (_t, d) => (d.satir.yeni_deger_secret = sifrele({ degerler: { rpc: H.YENI.btcRpc }, bos_onay: [] }))],
  ];
  for (const [neden, boz] of durumlar) {
    const k = kancaKur();
    boz(k.ticket, k.db);
    const pl = JSON.stringify(k.ticket.pendingLaunch);
    await assert.rejects(
      () => NODE.launchOncesiDegerEkle(k.ticket, { db: k.db }),
      (e) => {
        assert.match(e.message, /^Crypto Hub node talebi #(42|\?): /);
        assert.ok(e.message.endsWith(neden), `${neden} beklendi: ${e.message}`);
        assert.ok(!e.message.includes(H.SIR) && !e.message.includes(k.p.yeniB64), 'hata metninde deger');
        return true;
      },
      neden,
    );
    assert.equal(JSON.stringify(k.ticket.pendingLaunch), pl, `${neden}: paket degisti`);
  }
  // Production: enc:v1: onekli olmayan deger reddedilir (anahtar tanimli olsa da).
  const k2 = kancaKur();
  k2.db.satir.yeni_deger_secret = k2.p.yeniB64;
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => NODE.launchOncesiDegerEkle(k2.ticket, { db: k2.db }), /deger sifresiz$/);
    const k3 = kancaKur();
    assert.equal((await NODE.launchOncesiDegerEkle(k3.ticket, { db: k3.db })).extraVars.crypto_hub_node_yeni_b64, k3.p.yeniB64);
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
});

test('N18b gizliTemizle: uzun gizli once, butun gecisler, 500 karakter', () => {
  const b64 = Buffer.from(`{"degerler":{"rpc":"${H.YENI.evm}"}}`).toString('base64');
  const m = `AWX 400: {"extra_vars":{"crypto_hub_node_yeni_b64":"${b64}","x":"${H.YENI.evm}"}} ${H.YENI.evm}`;
  const t = NODE.gizliTemizle(m, [H.YENI.evm, b64, '', null]);
  assert.ok(!t.includes(H.SIR) && !t.includes(b64), t);
  assert.equal(t.split('****').length - 1, 3);
  assert.equal(NODE.gizliTemizle('x'.repeat(900), []).length, 500);
  // Kisa gizli uzunun parcasiysa uzun once degisir (parca kalmaz).
  assert.equal(NODE.gizliTemizle('abcdef', ['abc', 'abcdef']), '****');
});
