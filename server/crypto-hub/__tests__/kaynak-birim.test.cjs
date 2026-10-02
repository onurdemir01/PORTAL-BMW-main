// server/crypto-hub/__tests__/kaynak-birim.test.cjs — B5 + kayit (2026-10-02).
//
// Kullanici: CPU/bellek Portal'dan degissin ve Helm'e KALICI islensin. Kararlar (2026-10-02):
// requests <= limits (calisan degerler uzerinden), birim dogrulamasi, LimitRange; tek seferde
// <= 2 kat / >= yari; limits.cpu <= 16 cekirdek; limits.memory <= 32Gi ve >= 512Mi; Admin
// GEREKCE ile oran/tavan/tabani asar, Kubernetes kurali ve LimitRange ASILAMAZ.
//
// KR1 birimler: '512M' != '512Mi', '8' == '8000m', e-notasyon / eksi / bellekte 'm' RET
// KR2 standart bicim ve standartlastirma (tirnakli yazilacak deger)
// KR3 degisiklik girdisi: 1-4 oge, yalniz {alan, eski, yeni}, ayni deger RET, 2048 siniri
// KR4 requests <= limits CALISAN degerler uzerinden (girilmeyen alan canlidan), ASILAMAZ
// KR5 politika: oran / tavan / taban; Admin + gerekce asar, Admin OLMAYAN asamaz
// KR6 LimitRange: okunamadi -> 'olculemedi' ('gecti' DEGIL); max/min ASILAMAZ (Admin dahil)
// KR7 yol KAYDI: yalniz 'kayitli' yaziya acik; olu / tahmin / kapsam disi YAZILMAZ
// KR8 riskli bilesen adi Ansible deseniyle AYNI
// KR9 yazma kapisi: prod 403, Metaco 501, values dosyasi tanimsiz 409 - KATALOGDAN
// KR10 heap tahmini = limit x 0.75
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KR = require('../../../shared/cryptoHubResources.cjs');
const { CRYPTO_TENANTS, tenantOf } = require('../../../shared/cryptoHubTenants.cjs');

const MI = 1024n * 1024n;
const deger = (s, tur) => {
  const m = KR.miktar(s, tur);
  return m.n / m.d;
};

test('KR1 birimler normallestirilir; 512M != 512Mi, 8 == 8000m; e/eksi/bellek-m RET', () => {
  assert.equal(KR.ayniMiktar('8', '8000m', 'cpu'), true);
  assert.equal(KR.ayniMiktar('1', '1000m', 'cpu'), true);
  assert.equal(KR.ayniMiktar('0.5', '500m', 'cpu'), true);
  assert.equal(KR.ayniMiktar('512M', '512Mi', 'memory'), false, '512M onluk, 512Mi ikilik');
  assert.equal(deger('512Mi', 'memory'), 512n * MI);
  assert.equal(deger('512M', 'memory'), 512000000n);
  assert.equal(KR.ayniMiktar('1Gi', '1024Mi', 'memory'), true);
  assert.equal(KR.ayniMiktar('1G', '1000M', 'memory'), true);
  for (const kotu of ['1e3', '-1', '1.5e2Mi', 'abc', '', '1 Gi', '0x10']) {
    assert.throws(() => KR.miktar(kotu, 'memory'), KR.BirimHatasi, `bellek: ${kotu}`);
  }
  assert.throws(() => KR.miktar('500m', 'memory'), /m \(mili\)/, 'bellekte m reddedilmeli');
  assert.throws(() => KR.miktar('2Gi', 'cpu'), /cpu için geçersiz birim/);
  assert.throws(() => KR.miktar('-500m', 'cpu'), KR.BirimHatasi);
  assert.throws(() => KR.miktar('1e3m', 'cpu'), KR.BirimHatasi);
  // Buyuk bellek: Number hassasiyetini asar (2^53) - BigInt ile tam.
  assert.equal(KR.ayniMiktar('9999999Gi', '10239998976Mi', 'memory'), true);
  assert.equal(KR.ayniMiktar('9999999Gi', '10239998977Mi', 'memory'), false);
});

test('KR2 standart bicim (yazilacak deger) ve oneriler', () => {
  for (const ok of ['1500m', '2', '100', '1m', '999999m'])
    assert.ok(KR.standartMi(ok, 'cpu'), ok);
  for (const kotu of ['0', '1.5', '1500', '0500m', '1000000m', '2Gi', ''])
    assert.ok(!KR.standartMi(kotu, 'cpu'), kotu);
  for (const ok of ['512Mi', '4Gi', '9999999Gi']) assert.ok(KR.standartMi(ok, 'memory'), ok);
  for (const kotu of ['512M', '4G', '4096', '0Gi', '1.5Gi', '512Ki', '512mi'])
    assert.ok(!KR.standartMi(kotu, 'memory'), kotu);
  assert.equal(KR.standartla('1.5', 'cpu'), '1500m');
  assert.equal(KR.standartla('2', 'cpu'), '2000m');
  assert.equal(KR.standartla('2048Mi', 'memory'), '2Gi');
  assert.equal(KR.standartla('1536Mi', 'memory'), '1536Mi');
  assert.equal(KR.standartla('512M', 'memory'), null, 'onluk deger ikilik standarta ESIT degil');
  assert.equal(KR.bicimle('2', 'cpu'), '2000m');
  assert.equal(KR.bicimle('4096Mi', 'memory'), '4Gi');
});

test('KR3 degisiklik girdisi: 1-4 oge, yalniz alan/eski/yeni, ayni deger RET, 2048 siniri', () => {
  const coz = (x) => KR.degisiklikleriCoz(x);
  assert.throws(() => coz([]), /1-4/);
  assert.throws(
    () => coz(Array.from({ length: 5 }, () => ({ alan: 'limits.cpu', eski: '', yeni: '1' }))),
    /1-4/,
  );
  assert.throws(() => coz([{ alan: 'limits.cpu', eski: '', yeni: '2', icerik: 'x' }]), /yalnız/);
  assert.throws(() => coz([{ alan: 'limits.gpu', eski: '', yeni: '2' }]), /Geçersiz alan/);
  assert.throws(
    () =>
      coz([
        { alan: 'limits.cpu', eski: '', yeni: '2' },
        { alan: 'limits.cpu', eski: '', yeni: '3' },
      ]),
    /iki kez/,
  );
  assert.throws(() => coz([{ alan: 'limits.memory', eski: '', yeni: '4G' }]), (e) => e.kod === 'BIRIM_GECERSIZ');
  assert.throws(() => coz([{ alan: 'limits.cpu', eski: '2', yeni: '2000m' }]), /aynı/, '2 == 2000m');
  assert.throws(() => coz([{ alan: 'limits.cpu', eski: '1e3', yeni: '2' }]), (e) => e.kod === 'BIRIM_GECERSIZ');
  const k = coz([
    { alan: 'limits.memory', eski: '2Gi', yeni: '3Gi' },
    { alan: 'requests.cpu', eski: '', yeni: '500m' },
  ]);
  assert.deepEqual(
    k.map((x) => x.alan),
    ['requests.cpu', 'limits.memory'],
    'kanonik sira ALANLAR sirasi (plan jetonu kanonik JSON ister)',
  );
  const b64 = KR.degisiklikB64(k);
  assert.ok(b64.length <= KR.DEGISIKLIK_AZAMI);
  assert.deepEqual(JSON.parse(Buffer.from(b64, 'base64').toString('utf8')), k);
  assert.throws(
    () => KR.degisiklikB64([{ alan: 'limits.cpu', eski: 'x'.repeat(2000), yeni: '2' }]),
    /2048/,
    'sinir asilinca AWX kanalina gitmez',
  );
});

const tam = { 'requests.cpu': '500m', 'requests.memory': '1Gi', 'limits.cpu': '2', 'limits.memory': '2Gi' };
const lrYok = { durum: 'yok', kurallar: [] };

test('KR4 requests <= limits CALISAN degerlerle; girilmeyen alan canlidan; ASILAMAZ', () => {
  // Yalniz limits.cpu dusuruluyor: canli requests.cpu 500m -> 400m limit < 500m request.
  let d = KR.dogrula({
    degisiklikler: [{ alan: 'limits.cpu', eski: '2', yeni: '400m' }],
    canli: { ...tam, 'limits.cpu': '800m' },
    limitRange: lrYok,
  });
  assert.equal(d.ok, false);
  assert.ok(d.hatalar.some((h) => h.kod === 'K8S_KURAL' && !h.asilabilir));
  // Admin + gerekce bile K8S kuralini ASAMAZ.
  d = KR.dogrula({
    degisiklikler: [{ alan: 'limits.cpu', eski: '2', yeni: '400m' }],
    canli: { ...tam, 'limits.cpu': '800m' },
    limitRange: lrYok,
    asim: true,
    admin: true,
    gerekce: 'acil kapasite ihtiyaci var',
  });
  assert.ok(d.hatalar.some((h) => h.kod === 'K8S_KURAL'));
  // Canli olculemediyse 'gecti' DENMEZ: uyari 'olculemedi'.
  d = KR.dogrula({
    degisiklikler: [{ alan: 'limits.cpu', eski: '2', yeni: '3' }],
    canli: null,
    limitRange: lrYok,
  });
  assert.equal(d.kontroller.find((k) => k.kontrol === 'k8s_kural').durum, 'olculemedi');
  assert.ok(d.uyarilar.some((u) => u.kod === 'K8S_KURAL' && u.durum === 'olculemedi'));
  // Bir turun 'olculemedi'si otekinin 'dur'unu ORTMEZ.
  d = KR.dogrula({
    degisiklikler: [
      { alan: 'requests.cpu', eski: '', yeni: '3' },
      { alan: 'limits.cpu', eski: '', yeni: '2' },
      { alan: 'limits.memory', eski: '', yeni: '2Gi' },
    ],
    canli: null,
    limitRange: lrYok,
  });
  assert.equal(d.kontroller.find((k) => k.kontrol === 'k8s_kural').durum, 'dur');
  // spec'te limit YOK -> requests artisi kuralla catismaz (LimitRange varsayilani bastion'da).
  d = KR.dogrula({
    degisiklikler: [{ alan: 'requests.cpu', eski: '', yeni: '900m' }],
    canli: { ...tam, 'limits.cpu': null },
    limitRange: lrYok,
  });
  assert.ok(!d.hatalar.some((h) => h.kod === 'K8S_KURAL'));
});

test('KR5 politika: 2 kat / yari / 16 cekirdek / 32Gi / 512Mi; Admin + gerekce asar', () => {
  const p = (deg, ek = {}) =>
    KR.dogrula({ degisiklikler: deg, canli: tam, limitRange: lrYok, ...ek });
  assert.ok(p([{ alan: 'limits.memory', eski: '2Gi', yeni: '4Gi' }]).ok, 'tam 2 kat serbest');
  assert.equal(p([{ alan: 'limits.memory', eski: '2Gi', yeni: '4097Mi' }]).ok, false, '2 kattan fazla');
  assert.ok(p([{ alan: 'limits.memory', eski: '2Gi', yeni: '1Gi' }]).ok, 'tam yari serbest');
  // requests.memory canlida YOK: ret yalniz ORAN kuralindan gelmeli (K8S degil).
  const yari = KR.dogrula({
    degisiklikler: [{ alan: 'limits.memory', eski: '2Gi', yeni: '1023Mi' }],
    canli: { ...tam, 'requests.memory': null },
    limitRange: lrYok,
  });
  assert.equal(yari.ok, false, 'yaridan az');
  assert.deepEqual(yari.hatalar.map((h) => h.kod), ['POLITIKA']);
  assert.match(yari.hatalar[0].mesaj, /yarıya/);
  // Taban CANLI degerdir (dosya degil): canli 2 cekirdek, dosya 1 -> 4 serbest.
  assert.ok(p([{ alan: 'limits.cpu', eski: '1', yeni: '4' }]).ok);
  const tavan = KR.dogrula({
    degisiklikler: [{ alan: 'limits.cpu', eski: '', yeni: '17' }],
    canli: { ...tam, 'limits.cpu': '16' },
    limitRange: lrYok,
  });
  assert.equal(tavan.ok, false);
  assert.match(tavan.hatalar.map((h) => h.mesaj).join(' '), /16 çekirdek/);
  const ust = KR.dogrula({
    degisiklikler: [{ alan: 'limits.memory', eski: '', yeni: '33Gi' }],
    canli: { ...tam, 'limits.memory': '20Gi' },
    limitRange: lrYok,
  });
  assert.match(ust.hatalar.map((h) => h.mesaj).join(' '), /32Gi/);
  const alt = KR.dogrula({
    degisiklikler: [{ alan: 'limits.memory', eski: '', yeni: '511Mi' }],
    canli: { ...tam, 'requests.memory': '256Mi', 'limits.memory': '600Mi' },
    limitRange: lrYok,
  });
  assert.match(alt.hatalar.map((h) => h.mesaj).join(' '), /512Mi/);
  assert.ok(alt.hatalar.every((h) => h.kod !== 'POLITIKA' || h.asilabilir));
  // Admin + gecerli gerekce: politika uyariya doner.
  const asim = p([{ alan: 'limits.memory', eski: '2Gi', yeni: '8Gi' }], {
    asim: true,
    admin: true,
    gerekce: 'yuk testi icin gecici artis',
  });
  assert.equal(asim.ok, true);
  assert.equal(asim.asimKullanildi, true);
  // Admin OLMAYAN asamaz; gerekcesiz Admin de asamaz.
  for (const ek of [
    { asim: true, admin: false, gerekce: 'yuk testi icin gecici artis' },
    { asim: true, admin: true, gerekce: 'kisa' },
  ]) {
    const r = p([{ alan: 'limits.memory', eski: '2Gi', yeni: '8Gi' }], ek);
    assert.equal(r.ok, false, JSON.stringify(ek));
  }
});

test('KR6 LimitRange: okunamadi -> olculemedi (gecti DEGIL); max/min ASILAMAZ', () => {
  const deg = [{ alan: 'limits.memory', eski: '2Gi', yeni: '3Gi' }];
  const olcmedi = KR.dogrula({ degisiklikler: deg, canli: tam, limitRange: { durum: 'olculemedi' } });
  assert.equal(olcmedi.kontroller.find((k) => k.kontrol === 'limitrange').durum, 'olculemedi');
  assert.ok(olcmedi.uyarilar.some((u) => u.kod === 'LIMITRANGE' && u.durum === 'olculemedi'));
  const bos = KR.dogrula({ degisiklikler: deg, canli: tam });
  assert.equal(
    bos.kontroller.find((k) => k.kontrol === 'limitrange').durum,
    'olculemedi',
    'LimitRange bilgisi hic yoksa da olculemedi',
  );
  const lr = {
    durum: 'olculdu',
    kurallar: [
      { ad: 'lr', tur: 'Container', ozellik: 'max', kaynak: 'memory', deger: '2560Mi' },
      { ad: 'lr', tur: 'Container', ozellik: 'min', kaynak: 'cpu', deger: '100m' },
    ],
  };
  const r = KR.dogrula({
    degisiklikler: deg,
    canli: tam,
    limitRange: lr,
    asim: true,
    admin: true,
    gerekce: 'admin limitrange asmayi deniyor',
  });
  assert.equal(r.ok, false, 'LimitRange Admin ile de asilmaz');
  assert.ok(r.hatalar.some((h) => h.kod === 'LIMITRANGE' && !h.asilabilir));
  const min = KR.dogrula({
    degisiklikler: [{ alan: 'requests.cpu', eski: '', yeni: '50m' }],
    canli: tam,
    limitRange: lr,
  });
  assert.ok(min.hatalar.some((h) => h.kod === 'LIMITRANGE'));
  const iyi = KR.dogrula({
    degisiklikler: [{ alan: 'limits.memory', eski: '2Gi', yeni: '2560Mi' }],
    canli: tam,
    limitRange: lr,
  });
  assert.equal(iyi.kontroller.find((k) => k.kontrol === 'limitrange').durum, 'gecti');
});

test('KR7 yol KAYDI: yalniz kayitli yaziya acik; olu / tahmin / kapsam disi YAZILMAZ', () => {
  const ag = KR.yolKaydi('wyden', 'access-gateway');
  assert.equal(KR.yazilabilirKayit(ag), true);
  assert.equal(ag.kap, 'app');
  assert.ok(ag.kanit, 'kayitli yolun kaniti olmali');
  for (const y of ['aeron-cluster.memory-requester', 'target-registry.connectorTemplate', 'wyden-ui']) {
    const k = KR.yolKaydi('wyden', y);
    assert.ok(k, `${y} kayitta olmali (aciklamasiyla)`);
    assert.equal(KR.yazilabilirKayit(k), false, `${y} yaziya KAPALI olmali (${k.durum})`);
  }
  assert.equal(KR.yolKaydi('wyden', 'uydurma-bilesen'), null);
  assert.equal(KR.yazilabilirKayit(null), false);
  // Metaco icin kayit YOK (plan/uygula kapali; tahmin edilmez).
  assert.equal(KR.YOL_KAYDI.filter((k) => k.app === 'metaco').length, 0);
  // Her kayitli yolun kaniti ve kabi var; yollar benzersiz.
  const yollar = KR.YOL_KAYDI.map((k) => `${k.app}:${k.yol}`);
  assert.equal(new Set(yollar).size, yollar.length);
  for (const k of KR.YOL_KAYDI.filter((x) => x.durum === 'kayitli')) {
    assert.ok(k.kap && k.kanit && KR.BILESEN_RE.test(k.yol) && KR.KAP_RE.test(k.kap), k.yol);
  }
  // Is yuku -> kayit: ad <release>-<is>, tur da eslesmeli.
  const ar = KR.isYukuKayitlari('wyden', 'wydenapp', 'Deployment', 'wydenapp-aeron-cluster-archive');
  assert.deepEqual(ar.map((k) => k.kap).sort(), ['backup', 'snapshot']);
  assert.equal(KR.isYukuKayitlari('wyden', 'wydenapp', 'StatefulSet', 'wydenapp-access-gateway').length, 0);
  assert.equal(KR.isYukuKayitlari('wyden', '', 'Deployment', 'access-gateway').length, 0);
});

test('KR8 riskli bilesen adi Ansible RISKLI_BILESEN ile AYNI', () => {
  for (const y of ['aeron-cluster', 'aeron-cluster.archive.backup', 'storage', 'x.archive', 'indexers.btc'])
    assert.equal(KR.riskliYol(y), true, y);
  for (const y of ['access-gateway', 'archiver', 'storage-console', 'components.indexers'])
    assert.equal(KR.riskliYol(y), false, y);
  const kok =
    process.env.CRYPTO_HUB_ANSIBLE_ROOT ||
    path.join('C:', 'Users', 'demir', 'Downloads', 'Compressed', 'gar_bmt_ansible_scripts');
  const py = path.join(kok, 'bmw_automation_folder', 'crypto_hub', 'files', 'crypto_hub_resources.py');
  if (!fs.existsSync(py)) return; // Ansible deposu bu makinede yoksa karsilastirma ATLANIR
  const m = /RISKLI_BILESEN = re\.compile\(r'([^']+)'\)/.exec(fs.readFileSync(py, 'utf8'));
  assert.ok(m, 'Ansible RISKLI_BILESEN deseni bulunamadi');
  assert.equal(KR.RISKLI_YOL_RE.source, m[1], 'riskli desen Ansible ile ayristi');
});

test('KR9 yazma kapisi KATALOGDAN: prod 403, Metaco 501, values dosyasi tanimsiz 409', () => {
  const k = (key) => KR.kaynakYazmaKapisi(tenantOf(key));
  assert.equal(k('wyden_prod_h3').status, 403, 'prod (dosyasi tanimli olsa bile) kapali');
  assert.equal(k('wyden_prod_h3').kod, 'PROD_KAPALI');
  assert.equal(k('metaco_das_test').status, 501);
  assert.equal(k('metaco_das_test').kod, 'CHART_YOK');
  assert.equal(k('wyden_dev').status, 409, 'katalogda dosya yok -> tahmin edilmez');
  assert.equal(k('wyden_dev').kod, 'DOSYA_TANIMSIZ');
  assert.equal(k('wyden_qa_h2').acik, true);
  assert.equal(KR.kaynakYazmaKapisi(null).acik, false);
  // Prod kapisi PRODUCTION_ENABLED'dan BAGIMSIZ: kiracinin production bayragina bakar.
  assert.equal(KR.kaynakYazmaKapisi({ ...tenantOf('wyden_qa_h2'), production: true }).acik, false);
  for (const t of CRYPTO_TENANTS) {
    assert.equal(typeof t.resValuesPath, 'string', `${t.key}: resValuesPath yok`);
    assert.equal(t.resValuesVerified, false, `${t.key}: dogrulanmamis esleme 'dogrulandi' yazilmis`);
    assert.ok(Array.isArray(t.resPeerTenants), `${t.key}: resPeerTenants yok`);
    if (t.resValuesPath) {
      assert.match(t.resValuesPath, /^\/vhosting\/[A-Za-z0-9._/-]+$/, t.key);
      assert.ok(!t.resValuesPath.includes('..'), t.key);
      assert.ok(t.resValuesEvidence && !/^BULUNAMADI/.test(t.resValuesEvidence), `${t.key}: dolu yolun kaniti yok`);
    } else {
      assert.match(t.resValuesEvidence, /^BULUNAMADI/, `${t.key}: bos yol BULUNAMADI demeli`);
    }
    if (t.app === 'metaco') assert.equal(t.resValuesPath, '', `${t.key}: Metaco yolu tahminle doldurulmus`);
    for (const e of t.resPeerTenants) {
      const p = tenantOf(e);
      assert.ok(p, `${t.key}: es kiraci yok ${e}`);
      assert.equal(p.app, t.app);
      assert.equal(p.namespace, t.namespace, `${t.key}: es baska namespace`);
      assert.equal(p.production, t.production);
      assert.equal(p.helmRelease, t.helmRelease);
    }
  }
});

test('KR10 heap tahmini = bellek limiti x 0.75', () => {
  assert.equal(KR.heapTahminiMi('4Gi'), 3072);
  assert.equal(KR.heapTahminiMi('2048Mi'), 1536);
  assert.equal(KR.heapTahminiMi(null), null);
  assert.equal(KR.heapTahminiMi('bozuk'), null);
  assert.equal(KR.HEAP_ORANI, 0.75);
});
