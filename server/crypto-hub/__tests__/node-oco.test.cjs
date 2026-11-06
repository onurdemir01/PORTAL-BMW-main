// server/crypto-hub/__tests__/node-oco.test.cjs - node talebinin OCO penceresi (D8).
//
// O: karar, kapi, bekleme, kapanis. Gercek talepAc + gercek poller + gercek pencere hesabi; sahte olan
// OCO servisi, Smart API, AWX ve DB. "Production OCO ister" kararlari resolver biriminde sinanir:
// NODE_PROD_ACIK bos oldugundan uc testi 403 kapisina kor kalirdi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_node_harness.cjs');
const N = require('../../../shared/cryptoHubNodes.cjs');
const { CRYPTO_TENANTS, tenantOf } = require('../../../shared/cryptoHubTenants.cjs');

const { K, GOVDE, T, G_EVM, SIR } = H;
const DK = 60000;
const NO = '22502813';

async function ile(fn, o) {
  const h = await H.kur(o);
  try {
    await fn(h);
  } finally {
    await h.kapat();
  }
}

const ocoAcik = (h, ek = {}) => {
  h.d.cryptoSmart = { enabled: true, flowKey: '', metadataFields: '', ocoTest: true, ...ek };
  h.okumaVer();
};
const talep = (h, o = {}) => h.istek('POST', '/node-change', K.nodecu, GOVDE({ ocoNumber: NO, ...o }));
const paket = (h, i = 0) => JSON.parse(h.d.smartTickets[i].pending_launch_json);
const aksiyon = (h, ad) => h.d.audits.filter((a) => a.action === ad);
const detay = (h, ad) => JSON.parse(aksiyon(h, ad)[0].opts.detail);
const onayla = (h) => {
  h.d.smartDurum = { completed: true, rejected: false, stateName: 'Tamamlandi' };
};
const hicBirSeyYok = (h) => {
  assert.equal(h.d.rows.length, 0, 'satir yazildi');
  assert.equal(h.d.smartCreated.length, 0, 'Smart bileti acildi');
  assert.equal(h.d.ssLaunches.length, 0, 'is baslatildi');
};

test('O1 ocoGerekliMi: production ocoTest:false iken de true; test kiracida yalniz ocoTest true', () =>
  ile(async (h) => {
    const prodlar = CRYPTO_TENANTS.filter((t) => t.production !== false);
    const testler = CRYPTO_TENANTS.filter((t) => t.production === false);
    assert.ok(prodlar.length > 0 && testler.length > 0, 'kiraci listesi bos (bekci kor)');
    for (const t of prodlar) {
      for (const blob of [null, {}, { ocoTest: false }, { ocoTest: 'true' }]) {
        assert.equal(h.SA.ocoGerekliMi(t, blob), true, `${t.key} OCO'suz kaldi`);
      }
      h.d.cryptoSmart = { ocoTest: false, flowKey: '', metadataFields: '' };
      assert.equal((await h.SA.cryptoSmartCoz(t)).ocoGerekli, true, `${t.key} cozumde OCO'suz kaldi`);
    }
    assert.ok(prodlar.some((t) => t.key === 'metaco_das_prod_ank'), 'Ankara listede degil (bekci kor)');
    for (const t of testler) {
      assert.equal(h.SA.ocoGerekliMi(t, null), false);
      assert.equal(h.SA.ocoGerekliMi(t, { ocoTest: false }), false);
      assert.equal(h.SA.ocoGerekliMi(t, { ocoTest: 'true' }), false, 'gercek true olmadan acildi');
      assert.equal(h.SA.ocoGerekliMi(t, { ocoTest: true }), true);
    }
    // Etiket savunmasi: production yanlis yazilsa da uretim etiketli kiraci OCO'suz kalmaz.
    const test = testler[0];
    assert.equal(h.SA.ocoGerekliMi({ ...test, key: 'metaco_das_prod' }, { ocoTest: false }), true);
    assert.equal(h.SA.ocoGerekliMi({ ...test, cluster: 'prod_ank' }, { ocoTest: false }), true);
    assert.equal(h.SA.ocoGerekliMi(null, { ocoTest: false }), true, 'kiraci yokken OCO dustu');
    assert.equal(h.SA.ocoGerekliMi({ ...test, production: undefined }, { ocoTest: false }), true);
  }));

test('O2 ayar okunamazsa talep 503: OCO sorulmaz, satir yazilmaz; /nodes ekrani fail-closed', () =>
  ile(async (h) => {
    h.okumaVer();
    h.d.cryptoSmartBozuk = true;
    const r = await talep(h);
    assert.equal(r.status, 503);
    assert.equal(r.body.blocked, 'crypto_node_smart_okunamadi');
    assert.equal(h.d.ocoCagri.length, 0);
    hicBirSeyYok(h);
    const n = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(n.body.ocoGerekli, true);
  }));

test('O3 ocoTest: varsayilan kapali, kismi govde degistirmez, denetimde onceki -> yeni', () =>
  ile(async (h) => {
    let g = await h.istek('GET', '/smart-config', K.admin);
    assert.equal(g.body.smart.ocoTest, false);
    await h.istek('PUT', '/smart-config', K.admin, { smart: { ocoTest: true } });
    assert.equal(h.d.cryptoSmart.ocoTest, true);
    assert.deepEqual(detay(h, 'crypto_hub_smart_config_save').ocoTest, { onceki: false, yeni: true });
    await h.istek('PUT', '/smart-config', K.admin, { smart: { enabled: true } });
    assert.equal(h.d.cryptoSmart.ocoTest, true, 'kismi govde ocoTest i sifirladi');
    await h.istek('PUT', '/smart-config', K.admin, { smart: { ocoTest: 'hayir' } });
    assert.equal(h.d.cryptoSmart.ocoTest, true, 'boolean olmayan deger yazildi');
    g = await h.istek('GET', '/smart-config', K.admin);
    assert.equal(g.body.smart.ocoTest, true);
    const n = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(n.body.ocoGerekli, true);
  }));

test('O4 OCO gerekmeyen test kiracisi: numara gonderilse de OCO okunmaz, satira yazilmaz', () =>
  ile(async (h) => {
    h.okumaVer();
    const n = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(n.body.ocoGerekli, false);
    const r = await talep(h);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(h.d.ocoCagri.length, 0);
    assert.equal(h.d.rows[0].oco_no, null);
    assert.equal(paket(h).onayZamanAsimiDk, N.ONAY_DK);
    assert.equal(paket(h).pencereBekle, undefined);
    assert.equal(r.body.onayZamanAsimiDk, N.ONAY_DK);
    assert.match(r.body.message, /24 saat/);
    assert.ok(!('ocoNo' in detay(h, 'crypto_hub_node_change_talep')), 'OCO suz denetim satiri degisti');
  }));

test('O5 numara yok: 400 ocoRequired, satir ve bilet yok, OCO okunmaz', () =>
  ile(async (h) => {
    ocoAcik(h);
    for (const ocoNumber of [undefined, '', '   ']) {
      const r = await talep(h, { ocoNumber });
      assert.equal(r.status, 400);
      assert.equal(r.body.ocoRequired, true);
      assert.equal(r.body.blocked, 'node_oco_gerekli');
    }
    assert.equal(h.d.ocoCagri.length, 0);
    hicBirSeyYok(h);
  }));

test('O6 OCO servis hatasi: kod ocoClient.httpStatus, metin aynen; satir yok', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.ocoHata = Object.assign(new Error('OCO bulunamadi'), { status: 404 });
    const r = await talep(h);
    assert.equal(r.status, 400, '404 nginx e yakalanir, 400 e cevrilmeli');
    assert.equal(r.body.message, 'OCO bulunamadi');
    assert.equal(r.body.ocoRequired, true);
    hicBirSeyYok(h);
  }));

test('O7 tarihi olmayan OCO reddedilir', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.oco = null;
    const r = await talep(h);
    assert.equal(r.status, 400);
    assert.match(r.body.message, /planlanan kesinti tarihi yok/);
    hicBirSeyYok(h);
  }));

test('O8 kapanmis pencere: 400 ocoExpired', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(-300, -60);
    const r = await talep(h);
    assert.equal(r.status, 400);
    assert.equal(r.body.ocoExpired, true);
    assert.equal(r.body.blocked, 'node_oco_gecti');
    hicBirSeyYok(h);
  }));

test('O9 ufuk: baslangic 7 gunden uzaksa red, icindeyse kabul', () =>
  ile(async (h) => {
    ocoAcik(h);
    const ufuk = N.OCO_UFUK_GUN * 24 * 60;
    assert.equal(N.OCO_UFUK_GUN, 7);
    h.d.oco = H.ocoPencere(ufuk + 5, ufuk + 120);
    let r = await talep(h);
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'node_oco_ufuk');
    hicBirSeyYok(h);
    h.d.oco = H.ocoPencere(ufuk - 5, ufuk + 120);
    r = await talep(h);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }));

test('O10 son baslama: pencere sonuna 30 dk kala red; 30 dk dan kisa pencere hic acilmaz', () =>
  ile(async (h) => {
    ocoAcik(h);
    assert.equal(N.OCO_SON_PAY_DK, 30);
    h.d.oco = H.ocoPencere(-60, 29);
    let r = await talep(h);
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'node_oco_son_baslama');
    h.d.oco = H.ocoPencere(60, 80);
    r = await talep(h);
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'node_oco_kisa');
    hicBirSeyYok(h);
    h.d.oco = H.ocoPencere(-60, 31);
    r = await talep(h);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }));

test('O11 bilet paketi: pencere alanlari var, onayZamanAsimiDk yok; deger ve numara AWX e gitmez', () =>
  ile(async (h) => {
    ocoAcik(h, {
      flowKey: 'FLOW_CRYPTO',
      metadataFields: "ACIKLAMA: {{ opsx.aciklama }}\nOCO: {{ opsx.ocoNo | default('') }}\nPENCERE: {{ opsx.ocoPencere | default('') }}",
    });
    h.d.oco = H.ocoPencere(120, 360);
    const r = await talep(h);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = paket(h);
    assert.equal(p.ocoNumber, NO);
    assert.equal(p.pencereBekle, true);
    assert.equal(p.ocoWindowStartIso, new Date(h.d.oco.basMs).toISOString());
    assert.equal(p.ocoWindowEndIso, new Date(h.d.oco.sonMs).toISOString());
    assert.equal(p.sonBaslamaIso, new Date(h.d.oco.sonMs - 30 * DK).toISOString());
    assert.ok(!('onayZamanAsimiDk' in p), 'pencereli bilette sure kurali kaldi');
    assert.ok(!('onayZamanAsimiDk' in r.body));
    assert.doesNotMatch(r.body.message, /24 saat/);
    // AWX'e giden paket
    assert.equal(p.extraVars.crypto_hub_node_yeni_b64, '');
    for (const k of Object.keys(p.extraVars)) assert.doesNotMatch(k, /oco/i, `extra_vars a ${k} girdi`);
    assert.ok(!JSON.stringify(p.extraVars).includes(NO), 'numara extra_vars a girdi');
    assert.ok(!h.d.smartTickets[0].pending_launch_json.includes(SIR), 'deger pakete girdi');
    // Satir ve denetim
    const row = h.d.rows[0];
    assert.equal(row.oco_no, NO);
    assert.equal(new Date(row.oco_pencere_bas).getTime(), h.d.oco.basMs);
    assert.equal(new Date(row.oco_pencere_son).getTime(), h.d.oco.sonMs);
    const a = detay(h, 'crypto_hub_node_change_talep');
    assert.equal(a.ocoNo, NO);
    assert.equal(a.pencere.son, p.ocoWindowEndIso);
    assert.equal(a.pencere.sonBaslama, p.sonBaslamaIso);
    // Smart metni
    const meta = h.d.smartCreated[0].metadata;
    assert.equal(meta.OCO, NO);
    assert.match(meta.PENCERE, /^\S+ \S+ – \S+ \S+$/, 'opsx.ocoPencere sablonda bos');
    assert.match(meta.ACIKLAMA, new RegExp(`OCO: ${NO} \\(pencere `));
    assert.ok(h.d.sira.indexOf('oco') < h.d.sira.indexOf('preflight'), 'OCO satirdan once okunmadi');
  }));

test('O12 plan_sha ve extra_vars OCO dan bagimsiz', async () => {
  let sade;
  await ile(async (h) => {
    h.okumaVer();
    await talep(h);
    sade = { sha: h.d.rows[0].plan_sha, ev: Object.keys(paket(h).extraVars).sort() };
  });
  await ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(120, 360);
    await talep(h);
    assert.equal(h.d.rows[0].plan_sha, sade.sha);
    assert.deepEqual(Object.keys(paket(h).extraVars).sort(), sade.ev);
  });
});

test('O13 before + onay: poller claim etmez, onay ani yazilir; pencere acilinca claim eder, is baslar', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  return ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(120, 360);
    const r = await talep(h);
    assert.equal(r.body.oco.bekleyecek, true);
    const bilet = h.d.smartTickets[0];
    await h.pollerTuru();
    assert.equal(bilet.status, 'PENDING');
    assert.equal(bilet.approved_at, undefined, 'onay yokken onay ani yazildi');

    onayla(h);
    await h.pollerTuru();
    assert.equal(bilet.status, 'PENDING', 'onay pencereden once sahiplendi');
    assert.ok(bilet.approved_at, 'onay ani yazilmadi');
    const ilk = bilet.approved_at;
    assert.equal(h.d.ssLaunches.length, 0, 'is pencereden once basladi');
    await h.pollerTuru();
    assert.equal(bilet.approved_at, ilk, 'onay ani yeniden yazildi');

    let g = await h.istek('GET', `/node-change/${r.body.talepId}`, K.nodecu);
    assert.equal(g.body.smart.pencereBekliyor, true);
    assert.equal(g.body.talep.ocoNo, NO);
    assert.equal(g.body.talep.ocoPencereBas, new Date(h.d.oco.basMs).toISOString());
    assert.equal(g.body.talep.ocoPencereSon, new Date(h.d.oco.sonMs).toISOString());
    assert.equal(g.body.talep.durum, 'BEKLIYOR');
    const n = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(n.body.gecmis[0].pencereBekliyor, true);
    assert.equal(n.body.gecmis[0].ocoNo, NO);
    assert.equal(n.body.gecmis[0].ocoPencereSon, new Date(h.d.oco.sonMs).toISOString());
    assert.equal(n.body.gruplar.find((x) => x.id === G_EVM).bekleyen.pencereBekliyor, true);
    assert.ok(h.d.rows[0].yeni_deger_secret, 'deger bekleme sirasinda silindi');

    t.mock.timers.setTime(h.d.oco.basMs + DK);
    await h.pollerTuru();
    assert.equal(bilet.status, 'LAUNCHED', 'pencere acilinca sahiplenilmedi');
    assert.equal(h.d.ssLaunches.length, 1);
    assert.notEqual(h.d.ssLaunches[0].extraVars.crypto_hub_node_yeni_b64, '', 'kanca degeri eklemedi');
    g = await h.istek('GET', `/node-change/${r.body.talepId}`, K.nodecu);
    assert.equal(g.body.talep.durum, 'CALISIYOR');
    assert.equal(h.d.rows[0].yeni_deger_secret, null);
  });
});

test('O14 inside + onay: beklemez, ayni turda baslar', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(-10, 120);
    const r = await talep(h);
    assert.equal(r.body.oco.bekleyecek, false);
    onayla(h);
    await h.pollerTuru();
    assert.equal(h.d.smartTickets[0].status, 'LAUNCHED');
    assert.equal(h.d.smartTickets[0].approved_at, undefined);
    assert.equal(h.d.ssLaunches.length, 1);
  }));

test('O15 son baslama gecince TIMEOUT: onay gelmisse is baslamaz, mesaj dogrusunu soyler, deger silinir', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  return ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(120, 360);
    const r = await talep(h);
    onayla(h);
    await h.pollerTuru();
    // Smart API pencere boyunca kapali: sahiplenme olmadi.
    t.mock.timers.setTime(h.d.oco.sonMs - 30 * DK + DK);
    await h.pollerTuru();
    const b = h.d.smartTickets[0];
    assert.equal(b.status, 'TIMEOUT');
    assert.equal(h.d.ssLaunches.length, 0, 'son baslamadan sonra is basladi');
    assert.match(b.error, /Smart onayı alınmıştı/);
    assert.doesNotMatch(b.error, /onayı gelmedi/);
    const g = await h.istek('GET', `/node-change/${r.body.talepId}`, K.nodecu);
    assert.equal(g.body.talep.durum, 'ZAMAN_ASIMI');
    assert.equal(g.body.talep.sonuc.smart.onayGeldi, true);
    assert.equal(h.d.rows[0].yeni_deger_secret, null);
  });
});

test('O16 onay gorulmeden TIMEOUT: "gelmedi" diye kesin konusmaz, sonradan gelen onay isi baslatmaz', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  return ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(-10, 120);
    const r = await talep(h);
    t.mock.timers.setTime(h.d.oco.sonMs - 29 * DK);
    await h.pollerTuru();
    assert.equal(h.d.smartTickets[0].status, 'TIMEOUT');
    assert.match(h.d.smartTickets[0].error, /Portal Smart onayı görmedi/);
    assert.match(h.d.smartTickets[0].error, /Onay bu sırada verilmiş olabilir/);
    assert.doesNotMatch(h.d.smartTickets[0].error, /onayı gelmedi/);
    onayla(h);
    await h.pollerTuru();
    assert.equal(h.d.ssLaunches.length, 0);
    const g = await h.istek('GET', `/node-change/${r.body.talepId}`, K.nodecu);
    assert.equal(g.body.talep.sonuc.smart.onayGeldi, undefined);
  });
});

test('O17 pencereBekle siz bilet: davranis ayni, onay turunda baslar, onay ani yazilmaz', () =>
  ile(async (h) => {
    h.okumaVer();
    await talep(h);
    onayla(h);
    await h.pollerTuru();
    assert.equal(h.d.smartTickets[0].status, 'LAUNCHED');
    assert.equal(h.d.smartTickets[0].approved_at, undefined);
    assert.equal(h.d.ssLaunches.length, 1);
  }));

test('O18 launchPenceresiDenetle: schedule ve none throw; son baslama sonrasi throw; OCO suz gecer', () =>
  ile(async (h) => {
    const bas = Date.now();
    const pl = {
      ocoWindowStartIso: new Date(bas).toISOString(),
      ocoWindowEndIso: new Date(bas + 120 * DK).toISOString(),
      sonBaslamaIso: new Date(bas + 90 * DK).toISOString(),
      pencereBekle: true,
    };
    const d = h.NODE.launchPenceresiDenetle;
    assert.doesNotThrow(() => d({}));
    assert.doesNotThrow(() => d(pl, new Date(bas + DK)));
    assert.doesNotThrow(() => d(pl, new Date(bas + 90 * DK)));
    assert.throws(() => d(pl, new Date(bas - DK)), /penceresi açılmadı/, 'schedule rettir');
    assert.throws(() => d(pl, new Date(bas + 91 * DK)), /Son başlama saati geçti/);
    assert.throws(() => d(pl, new Date(bas + 120 * DK + 30000)), /Son başlama saati geçti/, 'nextRunAt toleransi son baslamayi gecemez');
    assert.throws(() => d(pl, new Date(bas + 200 * DK)), /kapandı/);
    assert.throws(() => d({ ...pl, pencereBekle: undefined }, new Date(bas + DK)), /eksik/);
    assert.throws(() => d({ ...pl, ocoWindowStartIso: undefined }, new Date(bas + DK)), /eksik/);
    assert.throws(() => d({ ...pl, sonBaslamaIso: 'bozuk' }, new Date(bas + DK)), /Son başlama saati geçti/);
  }));

test('O19 runner: crypto bileti createOcoAwxSchedule a ulasamaz', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'runner.cjs'), 'utf8');
  const bas = src.indexOf("require('../smart/poller.cjs').startPoller(async (ticket) =>");
  const son = src.indexOf("console.warn('[Smart] poller baslatilamadi:'", bas);
  assert.ok(bas > 0 && son > bas, 'poller geri cagrisi bulunamadi (bekci kor)');
  const dilim = src.slice(bas, son);
  const dal = dilim.indexOf('if (!cryptoBilet && ocoWindowStartIso && ocoWindowEndIso) {');
  const sched = dilim.indexOf('createOcoAwxSchedule(');
  assert.ok(dal > 0 && sched > dal, 'schedule cagrisi cryptoBilet kosulunun disinda');
  assert.equal(dilim.split('createOcoAwxSchedule(').length, 2, 'ikinci schedule cagrisi eklendi');
  assert.match(dilim.slice(sched, sched + 200), /extraVars, resolvedLaunchOptions/, 'schedule launchExtraVars almamali');
  assert.doesNotMatch(dilim, /launchExtraVars, resolvedLaunchOptions/);
});

test('O20 Smart kapali + before: red, satir yok; pencere acilinca tekrar acin der', () =>
  ile(async (h) => {
    ocoAcik(h, { enabled: false });
    h.d.oco = H.ocoPencere(120, 360);
    const r = await talep(h, { onaysizKabul: true });
    assert.equal(r.status, 400);
    assert.equal(r.body.blocked, 'node_oco_pencere_bekleniyor');
    assert.match(r.body.message, /pencere açılınca tekrar açın/);
    hicBirSeyYok(h);
  }));

test('O21 Smart kapali + inside: dogrudan baslar, denetimde OCO var, satirda pencere var', () =>
  ile(async (h) => {
    ocoAcik(h, { enabled: false });
    h.d.oco = H.ocoPencere(-10, 120);
    const r = await talep(h, { onaysizKabul: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.onaysiz, true);
    assert.equal(h.d.ssLaunches.length, 1);
    assert.equal(h.d.smartCreated.length, 0);
    assert.equal(h.d.rows[0].oco_no, NO);
    assert.equal(detay(h, 'crypto_hub_node_onaysiz_calisti').ocoNo, NO);
    assert.equal(detay(h, 'crypto_hub_node_change_talep').ocoNo, NO);
    assert.ok(!Object.keys(h.d.ssLaunches[0].extraVars).some((k) => /oco/i.test(k)));
  }));

test('O22 dogrudan yol: preflight sirasinda ocoTest acildiysa is baslamaz', () =>
  ile(async (h) => {
    h.d.cryptoSmart = { enabled: false, flowKey: '', metadataFields: '', ocoTest: false };
    h.okumaVer();
    h.d.preflightKanca = () => {
      h.d.cryptoSmart = { ...h.d.cryptoSmart, ocoTest: true };
    };
    const r = await talep(h, { onaysizKabul: true });
    assert.equal(r.status, 409);
    assert.equal(h.d.ssLaunches.length, 0);
    assert.equal(h.d.rows[0].durum, 'HATA');
    assert.equal(h.d.rows[0].yeni_deger_secret, null);
  }));

test('O23 dogrudan yol: son baslama preflight sirasinda gectiyse is baslamaz', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  return ile(async (h) => {
    ocoAcik(h, { enabled: false });
    h.d.oco = H.ocoPencere(-10, 120);
    h.d.preflightKanca = () => t.mock.timers.setTime(h.d.oco.sonMs - 29 * DK);
    const r = await talep(h, { onaysizKabul: true });
    assert.equal(r.status, 409);
    assert.equal(r.body.blocked, 'node_oco_son_baslama');
    assert.equal(h.d.ssLaunches.length, 0);
    assert.equal(h.d.rows[0].durum, 'HATA');
  });
});

test('O24 TAKILDI uzun pencerede erken kapatmaz; pencere sonu + 90 dk dan sonra kapatir', () =>
  ile(async (h) => {
    ocoAcik(h);
    const gun5 = 5 * 24 * 60;
    h.d.oco = H.ocoPencere(gun5, gun5 + 240);
    await talep(h);
    const db = require('../../db/index.cjs');
    const row = h.d.rows[0];
    const yas = (dk) => new Date(row.created_at).getTime() + dk * DK;
    assert.equal(await h.NODE.satiriIlerlet(db, { ...row }, 'tarama', yas(N.TAKILDI_DK + 60)), null);
    assert.equal(h.d.smartTickets[0].status, 'PENDING', 'bilet TAKILDI_DK da iptal edildi');
    assert.equal(row.kapandi_at, null);
    assert.equal(await h.NODE.satiriIlerlet(db, { ...row }, 'tarama', h.d.oco.sonMs + 89 * DK), null);
    assert.equal(row.kapandi_at, null);
    assert.equal(await h.NODE.satiriIlerlet(db, { ...row }, 'tarama', h.d.oco.sonMs + 91 * DK), 'kapandi');
    assert.equal(row.durum, 'OLCULEMEDI');
    assert.equal(row.sonuc_kod, 'TAKILDI');
    assert.equal(h.d.smartTickets[0].status, 'CANCELLED');
  }));

test('O25 kisa pencere TAKILDI_DK yi kisaltmaz', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(-10, 120);
    await talep(h);
    const db = require('../../db/index.cjs');
    const row = h.d.rows[0];
    const simdi = new Date(row.created_at).getTime() + (N.TAKILDI_DK - 5) * DK;
    assert.equal(await h.NODE.satiriIlerlet(db, { ...row }, 'tarama', simdi), null);
    assert.equal(row.kapandi_at, null);
  }));

test('O26 eski sema: OCO lu talep 503, satir yok; OCO suz akis calisir', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(120, 360);
    h.d.ocoKolon = false;
    const r = await talep(h);
    assert.equal(r.status, 503);
    assert.equal(r.body.blocked, 'node_oco_kolon_yok');
    assert.equal(h.d.ocoCagri.length, 0);
    hicBirSeyYok(h);

    h.d.cryptoSmart = { ...h.d.cryptoSmart, ocoTest: false };
    const ok = await talep(h);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(!h.d.logs.some((l) => /^INSERT INTO crypto_hub_node_changes.*oco_no/.test(l)), 'OCO suz INSERT kolon adiyor');
    const g = await h.istek('GET', `/node-change/${ok.body.talepId}`, K.nodecu);
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.equal(g.body.talep.ocoNo, null);
    const n = await h.istek('GET', `/nodes?tenant=${T}`, K.nodecu);
    assert.equal(n.body.gecmisOkunamadi, false, 'liste eski semada dustu');
    assert.equal(n.body.gecmis.length, 1);
    assert.equal(await h.NODE.nodeSonuclariniTara(), 0);
  }));

test('O27 onizleme OCO sormaz, numara istemez', () =>
  ile(async (h) => {
    ocoAcik(h);
    const r = await h.istek('POST', '/node-smart-onizle', K.admin, { tenant: T, grup: G_EVM });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(h.d.ocoCagri.length, 0);
    assert.equal(h.d.rows.length, 0);
  }));

test('O28 smart.sonTarih poller ile ayni: pencerede son baslama, OCO suzda +1440 dk', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(120, 360);
    const r = await talep(h);
    let g = await h.istek('GET', `/node-change/${r.body.talepId}`, K.nodecu);
    assert.equal(g.body.smart.sonTarih, new Date(h.d.oco.sonMs - 30 * DK).toISOString());
    assert.equal(g.body.smart.pencereBekliyor, false);
    h.d.cryptoSmart = { ...h.d.cryptoSmart, ocoTest: false };
    const r2 = await talep(h, { grup: H.G_BTC });
    g = await h.istek('GET', `/node-change/${r2.body.talepId}`, K.nodecu);
    const acilis = h.d.smartTickets[1].created_at.getTime();
    assert.equal(g.body.smart.sonTarih, new Date(acilis + N.ONAY_DK * DK).toISOString());
  }));

test('O29 ocoPencereKarari sinirlari', () => {
  const bas = 1_000_000_000_000;
  const k = (simdiMs, o = {}) =>
    N.ocoPencereKarari({ basMs: bas, sonMs: bas + 120 * DK, simdiMs, smartKapali: false, ...o }).kod;
  assert.equal(k(bas - DK), 'bekle');
  assert.equal(k(bas - DK, { smartKapali: true }), 'bekle_kapali');
  assert.equal(k(bas), 'acik');
  assert.equal(k(bas, { smartKapali: true }), 'acik');
  assert.equal(k(bas + 90 * DK), 'acik', 'son baslama ani hala kabul');
  assert.equal(k(bas + 90 * DK + 1), 'son_pay');
  assert.equal(k(bas + 120 * DK + 1), 'gecti');
  assert.equal(k(bas - 7 * 86400000), 'bekle', 'tam 7 gun kabul');
  assert.equal(k(bas - 7 * 86400000 - 1), 'ufuk');
  assert.equal(k(bas, { sonMs: bas + 30 * DK }), 'kisa');
  assert.equal(k(bas, { sonMs: NaN }), 'gecersiz');
  // Uzun pencere: 'kisa' ve 'son_pay' son baslama tavanindan etkilenmez.
  const uzun = { sonMs: bas + 400 * 1440 * DK };
  assert.equal(k(bas + 300 * 1440 * DK, uzun), 'acik');
  assert.equal(k(bas - 1440 * DK, uzun), 'bekle');
});

test('O30 semaya kolonlar: CREATE ve alters; store markApproved yalniz PENDING de yazar', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const k of ['oco_no', 'oco_pencere_bas', 'oco_pencere_son']) {
    assert.match(setup, new RegExp(`ALTER TABLE crypto_hub_node_changes ADD ${k} `));
    assert.match(setup, new RegExp(`\\n\\s+${k}\\s+(NVARCHAR|DATETIME2)`));
  }
  assert.match(setup, /ALTER TABLE smart_tickets ADD approved_at DATETIME2 NULL/);
  assert.match(setup, /\n\s+approved_at\s+DATETIME2 NULL/);
  const store = fs.readFileSync(path.join(__dirname, '..', '..', 'smart', 'store.cjs'), 'utf8');
  assert.match(store, /approved_at = GETUTCDATE\(\)[\s\S]{0,160}WHERE id = \$1 AND status = 'PENDING' AND approved_at IS NULL/);
});

test('O31 ekran tenantOf disinda karar vermez: ocoNumber govdesi production i gevsetmez', () =>
  ile(async (h) => {
    const once = N.nodeAcikMi;
    N.nodeAcikMi = (t) => !!t && t.app === 'metaco';
    try {
      h.d.cryptoSmart = { enabled: false, flowKey: '', metadataFields: '', ocoTest: false };
      h.okumaVer({}, Date.now(), 'metaco_das_prod');
      const r = await h.istek('POST', '/node-change', K.nodecu, GOVDE({ tenant: 'metaco_das_prod', onayMetni: G_EVM }));
      assert.equal(r.status, 400);
      assert.equal(r.body.ocoRequired, true);
      assert.equal(tenantOf('metaco_das_prod').production, true);
      hicBirSeyYok(h);
    } finally {
      N.nodeAcikMi = once;
    }
  }));

test('O32 ocoSonBaslamaMs: normal pencerede pencere sonu - pay; uzun pencerede acildiktan sonra en cok ONAY_DK', () => {
  const bas = 1_000_000_000_000;
  const f = (basDk, sonDk, talepDk = 0) =>
    (N.ocoSonBaslamaMs({ basMs: bas + basDk * DK, sonMs: bas + sonDk * DK, talepMs: bas + talepDk * DK }) - bas) / DK;
  assert.equal(N.OCO_ACIK_BEKLEME_DK, N.ONAY_DK);
  assert.equal(f(60, 300), 270, 'normal pencere degisti');
  assert.equal(f(60, 60 * 1440), 60 + N.ONAY_DK, 'pencere acildiktan sonra sinir yok');
  assert.equal(f(-30 * 1440, 365 * 1440), N.ONAY_DK, 'acik pencerede talepten sayilmali');
  assert.equal(f(7 * 1440, 60 * 1440), 7 * 1440 + N.ONAY_DK, 'ufuk sinirindaki talep pencereye hic girmezdi');
  assert.ok(Number.isNaN(f(NaN, 300)));
});

test('O33 uzun pencere: bilet, kilit ve deger pencere sonuna kadar surmez; sonTarih ayni tavan', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  return ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(-30 * 1440, 365 * 1440);
    const acilis = Date.now();
    const r = await talep(h);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const tavan = new Date(acilis + N.ONAY_DK * DK).toISOString();
    assert.equal(paket(h).sonBaslamaIso, tavan);
    assert.equal(r.body.oco.sonBaslamaIso, tavan);
    assert.equal(detay(h, 'crypto_hub_node_change_talep').pencere.sonBaslama, tavan);
    let g = await h.istek('GET', `/node-change/${r.body.talepId}`, K.nodecu);
    assert.equal(g.body.smart.sonTarih, tavan);
    t.mock.timers.setTime(acilis + (N.ONAY_DK + 1) * DK);
    await h.pollerTuru();
    assert.equal(h.d.smartTickets[0].status, 'TIMEOUT');
    g = await h.istek('GET', `/node-change/${r.body.talepId}`, K.nodecu);
    assert.equal(g.body.talep.durum, 'ZAMAN_ASIMI');
    assert.equal(h.d.rows[0].yeni_deger_secret, null);
    assert.ok(h.d.rows[0].kapandi_at, 'grup kilidi acik kaldi');
  });
});

test('O34 uzun pencere: LAUNCHING de takili satir pencere sonunu beklemez, son baslama + 2 saatte kapanir', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(1440, 60 * 1440);
    await talep(h);
    const db = require('../../db/index.cjs');
    const row = h.d.rows[0];
    h.d.smartTickets[0].status = 'LAUNCHING';
    const sonBaslama = N.ocoSonBaslamaMs({
      basMs: h.d.oco.basMs,
      sonMs: h.d.oco.sonMs,
      talepMs: new Date(row.created_at).getTime(),
    });
    assert.equal(await h.NODE.satiriIlerlet(db, { ...row }, 'tarama', sonBaslama + 119 * DK), null);
    assert.equal(row.kapandi_at, null);
    assert.equal(await h.NODE.satiriIlerlet(db, { ...row }, 'tarama', sonBaslama + 121 * DK), 'kapandi');
    assert.equal(row.sonuc_kod, 'TAKILDI');
    assert.equal(row.yeni_deger_secret, null);
  }));

// Pencere 5 gun ileride, talep 30 saatlik: yas TAKILDI_DK yi asti ama sinir pencereden sayilir.
async function eskiTalep(h) {
  ocoAcik(h);
  const gun5 = 5 * 24 * 60;
  h.d.oco = H.ocoPencere(gun5, gun5 + 240);
  const r = await talep(h);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const eski = new Date(Date.now() - 30 * 60 * DK);
  h.d.rows[0].created_at = eski;
  h.d.smartTickets[0].created_at = eski;
  h.NODE._sifirla();
  return r;
}
const dokunulmadi = (h) => {
  const row = h.d.rows[0];
  assert.equal(row.kapandi_at, null, 'satir kapandi');
  assert.equal(row.durum, 'BEKLIYOR');
  assert.equal(h.d.smartTickets[0].status, 'PENDING', 'bilet iptal edildi');
  assert.ok(row.yeni_deger_secret, 'deger silindi');
};

test('O35 kontrol: sema okunuyorken 30 saatlik pencereli talep kapanmaz', () =>
  ile(async (h) => {
    await eskiTalep(h);
    assert.equal(await h.NODE.nodeSonuclariniTara(), 0);
    dokunulmadi(h);
  }));

test('O36 sema okuma hatasi "kolon yok" degildir: tarama pencereli talebi kapatmaz (tek sefer ve kalici)', () =>
  ile(async (h) => {
    await eskiTalep(h);
    h.d.ocoKolonHata = 1;
    assert.equal(await h.NODE.nodeSonuclariniTara(), 0);
    dokunulmadi(h);
    h.d.ocoKolonHata = Infinity;
    assert.equal(await h.NODE.nodeSonuclariniTara(), 0);
    dokunulmadi(h);
    h.d.ocoKolonHata = 0;
    assert.equal(await h.NODE.nodeSonuclariniTara(), 0);
    dokunulmadi(h);
  }));

test('O37 sema okuma hatasi: ekran yolu da talebi kapatmaz', () =>
  ile(async (h) => {
    const r = await eskiTalep(h);
    h.d.ocoKolonHata = Infinity;
    const g = await h.istek('GET', `/node-change/${r.body.talepId}`, K.nodecu);
    assert.equal(g.status, 200, JSON.stringify(g.body));
    dokunulmadi(h);
  }));

test('O38 olumlu sonuc hatada korunur; hic olumlu sonuc yokken talep kapisi 503', () =>
  ile(async (h) => {
    const db = require('../../db/index.cjs');
    const t0 = Date.now();
    assert.equal(await h.NODE.ocoKolonlariVarMi(db, t0), true);
    h.d.ocoKolonHata = Infinity;
    assert.equal(await h.NODE.ocoKolonlariVarMi(db, t0 + 11 * DK), true, 'gecici hata olumlu sonucu sildi');
    h.NODE._sifirla();
    assert.equal(await h.NODE.ocoKolonlariVarMi(db, t0), false, 'bilinmiyor kapidan gecti');
    ocoAcik(h);
    h.d.oco = H.ocoPencere(120, 360);
    const r = await talep(h);
    assert.equal(r.status, 503);
    assert.equal(r.body.blocked, 'node_oco_kolon_yok');
    hicBirSeyYok(h);
  }));

test('O39 gercekten eski sema: TAKILDI korumasi calismaya devam eder', () =>
  ile(async (h) => {
    h.okumaVer();
    await talep(h);
    h.d.ocoKolon = false;
    h.NODE._sifirla();
    const row = h.d.rows[0];
    const eski = new Date(Date.now() - (N.TAKILDI_DK + 10) * DK);
    row.created_at = eski;
    h.d.smartTickets[0].created_at = eski;
    assert.equal(await h.NODE.nodeSonuclariniTara(), 1);
    assert.equal(row.sonuc_kod, 'TAKILDI');
    assert.equal(h.d.smartTickets[0].status, 'CANCELLED');
  }));

test('O40 kismi sema: tek kolon eksikse OCO lu talep 503', async () => {
  for (const eksik of ['oco_no', 'oco_pencere_bas', 'oco_pencere_son', 'approved_at']) {
    await ile(async (h) => {
      ocoAcik(h);
      h.d.oco = H.ocoPencere(120, 360);
      h.d.ocoKolonEksik = [eksik];
      const r = await talep(h);
      assert.equal(r.status, 503, eksik);
      assert.equal(r.body.blocked, 'node_oco_kolon_yok');
      hicBirSeyYok(h);
    });
  }
});

test('O41 launch reddi ekrana giden metin: Turkce, ASCII degil', () =>
  ile(async (h) => {
    ocoAcik(h);
    h.d.oco = H.ocoPencere(-10, 120);
    await talep(h);
    const pl = paket(h);
    assert.throws(() => h.NODE.launchPenceresiDenetle({ ...pl, sonBaslamaIso: 'bozuk' }), { message: h.NODE.METIN.ocoSonGecti });
    assert.match(h.NODE.METIN.ocoSonGecti, /başlama saati geçti/);
    assert.match(h.NODE.METIN.ocoAcilmadi, /açılmadı/);
    assert.match(h.NODE.METIN.ocoPaketEksik, /başlatılmadı/);
  }));
