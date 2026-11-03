// server/nginx-loadtest/__tests__/kuyruk.test.cjs - Yuk Testi GECE KUYRUGU yurutucusu (2026-11-03).
// kuyruk.cjs GERCEK; DB sahte (kuyruk-sahte-tablo.cjs, yaris kosullari SQL metninden), `islem` sahte (index.cjs'in
// kapilari kapi.test.cjs'te uctan uca sinanir). Sahte on kontrol / kosu baslatma gercegiyle AYNI sirada: satir ->
// kosuKaydedildi kancasi -> (kanca tutarsa) launch.
//
//   KQ1  sira: ogeler sirayla; ikinci oge birinci bitmeden baslamaz
//   KQ2  dinlenme kosu kilidi BIRAKILDIKTAN SONRA baslar ve bekleme_dk kadar surer
//   KQ3  ATLANDI: on kontrol FAILED (engel), kosu kapisi 409, yeni uyari TURU (ayni tur farkli sayi gecer), sure yetmedi,
//        yetki dustu, plan kapisi 409, hedef degisti; yuk uretmeyen atlamadan sonra dinlenme yok
//   KQ4  hatadan sonra devam: kosu FAILED / CANCELED (Durdur) -> HATALI, dinlenme, siradaki
//   KQ5  iptal: bekleyenler IPTAL; on kontrolu suren oge kosu BASLATMAZ; suren kosu izlenir (BITTI), dinlenme yok;
//        iptal sahiplenme ile kanca arasinda: is baslamaz, oge IPTAL
//   KQ6  yeniden baslatma: numarasiz CALISIYOR oge geri alinir ve TEK kez baslar; numarali oge yeniden baslatilmaz;
//        kirasi gecerli kuyruga ikinci surec dokunmaz, kira dolunca devralir; ikinci calisan oge (NOT EXISTS + indeks)
//   KQ7  ayni hedef kilidi (kilit_dolu): oge bekler (deneme sayilmaz), kilit acilinca baslar
//   KQ8  gecici hata: geri cekilmeyle (1, 2, 4, 8, 15 dk) 6 denemede HATALI; kosuId'li ama kesin baslamamis 424 (gercek
//        akis: satir + numara, sonra AWX sablonu dogrulanamadi) gecici, numara silinir; belirsiz -> HATALI + dinlenme
//   KQ8e yetki DB hatasi gecici (fail-closed)   KQ8f hataSifirla; HATALI kuyrugun calisan ogesi yetim kalmaz
//   KQ9  on kontrol kilit beklenirken eskidi: yeniden on kontrol
//   KQ10 SQL sozlesmesi (kosullu yazimlar metinde)
//   KQ11 uyari turu, govde dogrulama, zamanlama, kuyruk HATALI (KUYRUK_HATA_SINIRI=120 ardisik hata, ~30 dk)
//   KQ12 iptal ile geri alma yarisi (yetim BEKLIYOR yok); bitmis kuyruk iptal edilmez
//   KQ13 sira sutunu   KQ14 ikinci sure kapisi (plan butcesi)   KQ15 kirasiz surec yazmaz   KQ16 etiket kontrol karakteri
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const kuyruk = require('../kuyruk.cjs');
const { kuyrukSorgusu, kuyrukKur } = require('./kuyruk-sahte-tablo.cjs');

const BAS = Date.parse('2026-11-03T21:00:00Z');
const D = {};
const DK = 60000;

function sifirla() {
  for (const k of Object.keys(D)) delete D[k];
  Object.assign(D, { simdi: BAS, kuyruk: [], ogeler: [], kosular: [], kilitler: new Map(), kuyrukSorgular: [] });
}
const db = {
  query: async (sql, params = []) => {
    const r = kuyrukSorgusu(D, sql, params);
    if (!r) throw new Error(`beklenmeyen sorgu: ${sql}`);
    return r;
  },
};

/** Sahte islem: index.cjs ile ayni sira (satir -> kanca -> launch). */
function sahteIslem() {
  const I = {
    launch: [], cagri: [], yetki: { ok: true }, planHata: null, okHata: [], kosuHata: [], uyarilar: [], butce: 600, hedef: 'GBNGXT33', oncesiKanca: null,
    // launchHata: satir + kanca SONRASI (gercek kosuyuBaslat gibi) hata; kosuId eklenir, satir FAILED. okOncesi: on kontrol hatasindan once.
    launchHata: [], okOncesi: null,
    yetkiVarMi: async (u) => {
      I.cagri.push(['yetki', u]);
      if (I.yetki instanceof Error) throw I.yetki;
      return I.yetki;
    },
    plan: async (g) => {
      I.cagri.push(['plan', g.etiket]);
      if (I.planHata) throw I.planHata;
      return { hedefTuru: 'sunucu', hedefHost: I.hedef, hedefIp: g.hedefIp, parametreler: { butceSn: I.butce }, uyarilar: [], etiket: g.etiket };
    },
    kosuOku: async (id) => {
      const k = D.kosular.find((x) => x.id === id);
      return k ? { ...k, yas_sn: k.finished_at == null ? null : Math.round((D.simdi - k.finished_at) / 1000) } : null;
    },
    onKontrolBaslat: async (u, plan, kanca) => {
      I.cagri.push(['onKontrol', plan.etiket]);
      if (I.okOncesi) await I.okOncesi();
      if (I.okHata.length) throw I.okHata.shift();
      return baslat('on_kontrol', u, plan.etiket, kanca);
    },
    kosuBaslat: async (u, { okId, confirmText, onaylananTurler, kosuKaydedildi }) => {
      I.cagri.push(['kosu', okId, confirmText]);
      kuyruk.uyariKarariOf(onaylananTurler)(I.uyarilar);
      if (I.kosuHata.length) throw I.kosuHata.shift();
      return baslat('kosu', u, `kosu<-${okId}`, kosuKaydedildi);
    },
  };
  async function baslat(islem, u, etiket, kanca) {
    const id = 100 + D.kosular.length + 1;
    D.kosular.push({ id, islem, etiket, durum: 'QUEUED', created_by: u, kilit_id: `L${id}`, parametreler: JSON.stringify({ butceSn: I.butce }), finished_at: null });
    if (I.oncesiKanca) await I.oncesiKanca(id);
    try {
      await kanca(id);
    } catch (e) {
      D.kosular.find((x) => x.id === id).durum = 'FAILED';
      throw e;
    }
    if (I.launchHata.length) {
      const e = I.launchHata.shift();
      D.kosular.find((x) => x.id === id).durum = 'FAILED';
      throw Object.assign(e, { kosuId: id });
    }
    I.launch.push([islem, id]);
    D.kosular.find((x) => x.id === id).durum = 'RUNNING';
    return { kosuId: id };
  }
  return I;
}

const tur = (I, kira = 'P1') => kuyruk.tick({ db, islem: I, kira });
const oge = (id) => D.ogeler.find((o) => o.id === id);
const kq = (id) => D.kuyruk.find((k) => k.id === id);
const kosu = (id) => D.kosular.find((k) => k.id === id);
function bitir(id, durum = 'DONE', ek = {}) {
  Object.assign(kosu(id), { durum, finished_at: D.simdi, sonuc: JSON.stringify({ durum: durum === 'DONE' ? 'OK' : 'FAIL', ...(ek.hata ? { hata: ek.hata } : {}) }), ...ek });
}

test('KQ1 sira: ogeler sirayla, ikinci oge birinci bitmeden baslamaz; on kontrol -> kosu', async () => {
  sifirla();
  const I = sahteIslem();
  const id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  await tur(I);
  assert.equal(kq(id).durum, 'CALISIYOR');
  assert.deepEqual(I.launch, [['on_kontrol', 101]]);
  assert.equal(oge(1).durum, 'CALISIYOR');
  assert.equal(oge(1).on_kontrol_kosu_id, 101, 'numara ogeye yazilmadi');
  assert.equal(oge(2).durum, 'BEKLIYOR');
  assert.ok(I.cagri.some((c) => c[0] === 'plan' && c[1] === '[K1] A1'), 'kosu etiketi [K<id>] <etiket> degil');
  await tur(I);
  assert.equal(I.launch.length, 1, 'on kontrol surerken ikinci is basladi');
  bitir(101);
  await tur(I);
  assert.deepEqual(I.launch[1], ['kosu', 102]);
  assert.deepEqual(I.cagri.find((c) => c[0] === 'kosu'), ['kosu', 101, 'GBNGXT33'], 'onay metni kuyrugun onay hedefi degil');
  assert.equal(oge(1).kosu_id, 102);
  assert.equal(oge(2).durum, 'BEKLIYOR');
});

test('KQ2 dinlenme kosu kilidi birakildiktan SONRA baslar, bekleme_dk surer', async () => {
  sifirla();
  const I = sahteIslem();
  const id = kuyrukKur(D, { kuyruk: { bekleme_dk: 5 }, ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  await tur(I);
  bitir(101);
  await tur(I);
  // Kosu bitti ama kilidi (iptal / hata 'tut' kurali gibi) hala tutuluyor.
  D.kilitler.set('G|global', { lock_id: 'L102', held: 1, locked_until: D.simdi + 20 * DK, awx_job_id: null });
  bitir(102);
  await tur(I);
  assert.equal(oge(1).durum, 'BITTI');
  assert.equal(kq(id).durum, 'DINLENME');
  assert.equal(kq(id).dinlenme_bitis, null, 'kilit tutulurken dinlenme sayaci basladi');
  D.simdi += 12 * DK;
  await tur(I);
  assert.equal(kq(id).dinlenme_bitis, null, 'kilit hala tutuluyor');
  assert.equal(I.launch.length, 2);
  D.kilitler.get('G|global').held = 0;
  const birakma = D.simdi;
  await tur(I);
  assert.equal(kq(id).dinlenme_bitis, birakma + 5 * DK, 'bekleme kilit birakildiktan sonra sayilmali');
  D.simdi += 4 * DK + 59000;
  await tur(I);
  assert.equal(kq(id).durum, 'DINLENME');
  assert.equal(I.launch.length, 2, 'bekleme dolmadan siradaki basladi');
  D.simdi += 1000;
  await tur(I);
  assert.deepEqual(I.launch[2], ['on_kontrol', 103]);
  assert.equal(oge(2).durum, 'CALISIYOR');
  // Ise bagli (awx_job_id dolu) suresi gecmis kilit da TUTULUYOR sayilir (casLock devralmaz).
  sifirla();
  const I2 = sahteIslem();
  const id2 = kuyrukKur(D, { ogeler: [{ etiket: 'B1' }, { etiket: 'B2' }] });
  await tur(I2);
  bitir(101);
  await tur(I2);
  D.kilitler.set('T|GBNGXT33', { lock_id: 'L102', held: 1, locked_until: D.simdi - DK, awx_job_id: 900 });
  bitir(102);
  await tur(I2);
  await tur(I2);
  assert.equal(kq(id2).dinlenme_bitis, null, 'ise bagli kilit bos sayildi');
});

test('KQ3 ATLANDI kurallari: engel, kosu kapisi, yeni uyari turu, sure, yetki, plan kapisi, hedef', async () => {
  // a) on kontrol FAILED (engel / playbook reddi): ATLANDI, kosu yok, dinlenme yok, siradaki hemen.
  sifirla();
  let I = sahteIslem();
  let id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  await tur(I);
  bitir(101, 'FAILED', { hata: 'ip yerel degil' });
  await tur(I);
  assert.equal(oge(1).durum, 'ATLANDI');
  assert.match(oge(1).neden, /ön kontrol #101 FAILED: ip yerel degil/);
  assert.ok(!I.cagri.some((c) => c[0] === 'kosu'), 'engelli on kontrolden kosu baslatildi');
  assert.equal(kq(id).durum, 'CALISIYOR', 'yuk uretmeyen atlamadan sonra dinlenme olmamali');
  assert.deepEqual(I.launch.at(-1), ['on_kontrol', 102], 'siradaki hemen baslamadi');

  // b) kosu kapisi 409 (on kontrolde engel) -> ATLANDI.
  sifirla();
  I = sahteIslem();
  I.kosuHata.push(Object.assign(new Error('Ön kontrol koşuya izin vermiyor: log dizini okunamıyor.'), { status: 409, code: 'on_kontrol_eski' }));
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  await tur(I);
  bitir(101);
  await tur(I);
  assert.equal(oge(1).durum, 'ATLANDI');
  assert.match(oge(1).neden, /koşu kapısı: Ön kontrol koşuya izin vermiyor/);

  // c) uyari turleri: onaylanan "/web_log %70 dolu" turu ayni turun farkli sayisini gecirir; yeni tur ATLANDI.
  sifirla();
  I = sahteIslem();
  const onayli = kuyruk.uyariTurleri(['/web_log %70 dolu (>= %65)']);
  kuyrukKur(D, { kuyruk: { onaylanan_turler: JSON.stringify(onayli) }, ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  I.uyarilar = ['/web_log %81 dolu (>= %65)'];
  await tur(I);
  bitir(101);
  await tur(I);
  assert.deepEqual(I.launch.at(-1), ['kosu', 102], 'ayni tur farkli sayi kosuyu durdurdu');
  I.uyarilar = ['/web_log %81 dolu (>= %65)', 'etkin log_format\'ta user-agent= yok'];
  bitir(102);
  await tur(I);
  D.simdi += 6 * DK;
  await tur(I);
  bitir(103);
  await tur(I);
  assert.equal(oge(2).durum, 'ATLANDI');
  assert.match(oge(2).neden, /^yeni uyarı: U[0-9a-f]{10} etkin log_format/);
  assert.equal(oge(2).kosu_id, null);

  // d) sure yetmedi: kalan 10 dk < 300 sn pay + 600 sn butce; kucuk butceli oge sigar.
  sifirla();
  I = sahteIslem();
  kuyrukKur(D, { kuyruk: { en_gec_bitis: BAS + 10 * DK }, ogeler: [{ etiket: 'uzun', butce_sn: 600 }, { etiket: 'kisa', butce_sn: 200 }] });
  I.butce = 200;
  await tur(I);
  assert.equal(oge(1).durum, 'ATLANDI');
  assert.match(oge(1).neden, /^süre yetmedi: tahmini 15 dk, en geç bitişe 10 dk kaldı/);
  assert.ok(!I.cagri.some((c) => c[0] === 'onKontrol' && c[1] === '[K1] uzun'), 'suresi yetmeyen oge on kontrole gitti');
  assert.equal(oge(2).durum, 'CALISIYOR', 'sigan oge baslamadi');
  // kosu oncesi de: on kontrol uzadi, kalan butceye yetmiyor.
  D.simdi += 7 * DK;
  bitir(101);
  await tur(I);
  assert.equal(oge(2).durum, 'ATLANDI');
  assert.match(oge(2).neden, /^süre yetmedi/);
  assert.ok(!I.cagri.some((c) => c[0] === 'kosu'));

  // e) yetki dustu -> ATLANDI (on kontrolde de kosu oncesinde de).
  sifirla();
  I = sahteIslem();
  I.yetki = { ok: false, neden: 'onur kullanıcısının rolü artık User (Admin değil)' };
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  await tur(I);
  assert.equal(oge(1).durum, 'ATLANDI');
  assert.match(oge(1).neden, /^yetki: onur kullanıcısının rolü artık User/);
  assert.equal(I.launch.length, 0);
  sifirla();
  I = sahteIslem();
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  await tur(I);
  I.yetki = { ok: false, neden: 'rol User' };
  bitir(101);
  await tur(I);
  assert.equal(oge(1).durum, 'ATLANDI');
  assert.equal(I.launch.length, 1, 'yetkisi dusen kullanici icin kosu baslatildi');

  // f) plan kapisi 409 (siniflandirma / PROD-EDU) ve g) hedef degisti.
  sifirla();
  I = sahteIslem();
  I.planHata = Object.assign(new Error('GBNGXT33 üretim sunucusu'), { status: 409, code: 'hedef_uretim' });
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  await tur(I);
  assert.equal(oge(1).durum, 'ATLANDI');
  assert.match(oge(1).neden, /^kapı: GBNGXT33 üretim sunucusu/);
  sifirla();
  I = sahteIslem();
  I.hedef = 'GBNGXT99';
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  await tur(I);
  assert.equal(oge(1).durum, 'ATLANDI');
  assert.match(oge(1).neden, /^hedef değişti: onaylanan GBNGXT33, şimdi GBNGXT99/);
  assert.equal(I.launch.length, 0);
});

test('KQ4 hatadan sonra devam: FAILED / OKUNAMADI / CANCELED (Durdur) -> HATALI, dinlenme, siradaki', async () => {
  for (const [durum, re] of [['FAILED', /^koşu #102 FAILED$/], ['OKUNAMADI', /^koşu #102 OKUNAMADI$/], ['CANCELED', /^koşu #102 durduruldu \(CANCELED\)$/]]) {
    sifirla();
    const I = sahteIslem();
    const id = kuyrukKur(D, { kuyruk: { bekleme_dk: 2 }, ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
    await tur(I);
    bitir(101);
    await tur(I);
    bitir(102, durum);
    await tur(I);
    assert.equal(oge(1).durum, 'HATALI', durum);
    assert.match(oge(1).neden, re);
    assert.equal(kq(id).durum, 'DINLENME', `${durum}: yuk uretmis olabilir, dinlenme gerekli`);
    D.simdi += 2 * DK;
    await tur(I);
    assert.deepEqual(I.launch.at(-1), ['on_kontrol', 103], `${durum}: kuyruk devam etmedi`);
  }
});

test('KQ5 iptal: bekleyenler IPTAL, on kontrol sonrasi kosu yok, suren kosu izlenir, kanca yarisi', async () => {
  const iptal = async (id) => {
    await db.query(kuyruk.SQL.kuyrukIptal, [id, 'onur']);
    await db.query(kuyruk.SQL.ogelerIptal, [id, 'kuyruk iptal edildi (onur)']);
  };
  // a) on kontrol surerken iptal.
  sifirla();
  let I = sahteIslem();
  let id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  await tur(I);
  await iptal(id);
  assert.equal(oge(2).durum, 'IPTAL');
  bitir(101);
  await tur(I);
  assert.equal(oge(1).durum, 'IPTAL');
  assert.match(oge(1).neden, /kuyruk iptal edildi; ön kontrol #101 sonrası koşu başlatılmadı/);
  assert.ok(!I.cagri.some((c) => c[0] === 'kosu'), 'iptalden sonra kosu baslatildi');
  assert.equal(kq(id).durum, 'IPTAL');
  assert.deepEqual((await db.query(kuyruk.SQL.aktifKuyruklar)).rows, [], 'biten iptal kuyrugu aktif listede');
  // b) kosu surerken iptal: kosu DURDURULMAZ, izlenir, BITTI; dinlenme yok.
  sifirla();
  I = sahteIslem();
  id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  await tur(I);
  bitir(101);
  await tur(I);
  await iptal(id);
  await tur(I);
  assert.equal(oge(1).durum, 'CALISIYOR');
  bitir(102);
  await tur(I);
  assert.equal(oge(1).durum, 'BITTI');
  assert.equal(kq(id).durum, 'IPTAL');
  assert.equal(I.launch.length, 2);
  // c) iptal sahiplenme ile kanca ARASINDA: kanca tutmaz, is baslamaz (launch yok), oge sonraki turda IPTAL.
  sifirla();
  I = sahteIslem();
  id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  I.oncesiKanca = async () => iptal(id);
  await tur(I);
  assert.equal(I.launch.length, 0, 'iptal edilen kuyrukta is baslatildi');
  assert.equal(kosu(101).durum, 'FAILED');
  I.oncesiKanca = null;
  await tur(I);
  assert.equal(oge(1).durum, 'IPTAL');
  assert.equal(I.launch.length, 0);
});

test('KQ6 yeniden baslatma ve birden cok surec: cift baslatma yok', async () => {
  // a) numarasiz CALISIYOR (surec kanca oncesi oldu), eski kiranin suresi gecmis: geri alinir, TEK kez baslar.
  sifirla();
  let I = sahteIslem();
  let id = kuyrukKur(D, { kuyruk: { durum: 'CALISIYOR', kira_id: 'P0', kira_bitis: BAS - 1000 }, ogeler: [{ etiket: 'A1', durum: 'CALISIYOR', asama: 'on_kontrol', deneme_id: 'eski' }, { etiket: 'A2' }] });
  await tur(I);
  assert.deepEqual(I.launch, [['on_kontrol', 101]], 'numarasiz oge tek kez baslamali');
  assert.equal(oge(1).on_kontrol_kosu_id, 101);
  assert.equal(oge(2).durum, 'BEKLIYOR');
  // b) numarali oge (kosu suruyor): yeni surec yeniden BASLATMAZ.
  sifirla();
  I = sahteIslem();
  D.kosular.push({ id: 77, islem: 'kosu', durum: 'RUNNING', kilit_id: 'L77' }, { id: 76, islem: 'on_kontrol', durum: 'DONE', kilit_id: 'L76', finished_at: BAS });
  id = kuyrukKur(D, { kuyruk: { durum: 'CALISIYOR', kira_id: 'P0', kira_bitis: BAS - 1000 }, ogeler: [{ etiket: 'A1', durum: 'CALISIYOR', asama: 'kosu', deneme_id: 'x', on_kontrol_kosu_id: 76, kosu_id: 77 }, { etiket: 'A2' }] });
  await tur(I);
  await tur(I);
  assert.equal(I.launch.length, 0, 'suren kosu yeniden baslatildi');
  assert.equal(oge(1).durum, 'CALISIYOR');
  kosu(77).durum = 'DONE';
  await tur(I);
  assert.equal(oge(1).durum, 'BITTI');
  assert.equal(kq(id).durum, 'DINLENME');
  // c) on kontrol numarali, kosu numarasiz (kosu kancasindan once oldu): kosu yeniden denenir, on kontrol TEKRARLANMAZ.
  sifirla();
  I = sahteIslem();
  D.kosular.push({ id: 50, islem: 'on_kontrol', durum: 'DONE', kilit_id: 'L50', finished_at: BAS - DK, parametreler: '{"butceSn":600}' });
  kuyrukKur(D, { kuyruk: { durum: 'CALISIYOR', kira_id: null }, ogeler: [{ etiket: 'A1', durum: 'CALISIYOR', asama: 'kosu', deneme_id: 'y', on_kontrol_kosu_id: 50 }] });
  await tur(I);
  assert.deepEqual(I.launch, [['kosu', 102]]);
  assert.equal(oge(1).kosu_id, 102);
  assert.ok(!I.cagri.some((c) => c[0] === 'onKontrol'));
  // d) kirasi GECERLI kuyruga ikinci surec dokunmaz; kira dolunca devralir.
  sifirla();
  I = sahteIslem();
  id = kuyrukKur(D, { kuyruk: { kira_id: 'P0', kira_bitis: BAS + 5 * DK }, ogeler: [{ etiket: 'A1' }] });
  await tur(I, 'P1');
  assert.equal(I.launch.length, 0, 'baska surecin kuyrugu islendi');
  assert.equal(kq(id).durum, 'BEKLIYOR');
  D.simdi += 5 * DK + 1000;
  await tur(I, 'P1');
  assert.equal(I.launch.length, 1);
  assert.equal(kq(id).kira_id, 'P1');
  // e) ikinci calisan oge: NOT EXISTS reddeder; indeks de (NOT EXISTS'i gecen yaris) UNIQUE ihlali -> 'dur'.
  sifirla();
  id = kuyrukKur(D, { kuyruk: { durum: 'CALISIYOR', kira_id: 'P1', kira_bitis: BAS + DK }, ogeler: [{ etiket: 'A1', durum: 'CALISIYOR', asama: 'on_kontrol', on_kontrol_kosu_id: 5 }, { etiket: 'A2' }] });
  const r = await db.query(kuyruk.SQL.ogeSahiplen, [2, 't', 'P1']);
  assert.equal(r.rowCount, 0, 'ikinci oge sahiplenildi');
  assert.equal(oge(2).durum, 'BEKLIYOR');
});

test('KQ7 ayni hedef kilidi: kilit_dolu -> oge bekler (deneme sayilmaz), kilit acilinca baslar', async () => {
  sifirla();
  const I = sahteIslem();
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  I.okHata.push(Object.assign(new Error('GBNGXT33 üzerinde başka bir iş var (veli). İş bitince kilit kendiliğinden bırakılır.'), { status: 409, code: 'kilit_dolu' }));
  await tur(I);
  assert.equal(oge(1).durum, 'BEKLIYOR');
  assert.match(oge(1).neden, /^bekliyor: GBNGXT33 üzerinde başka bir iş var/);
  assert.equal(oge(1).deneme, 0);
  assert.equal(I.launch.length, 0);
  await tur(I);
  assert.deepEqual(I.launch, [['on_kontrol', 101]]);
  // kosu asamasinda kilit dolu: on kontrol asamasina doner, sonra baslar.
  I.kosuHata.push(Object.assign(new Error('Başka bir yük testi koşuyor (veli).'), { status: 409, code: 'kilit_dolu' }));
  bitir(101);
  await tur(I);
  assert.equal(oge(1).asama, 'on_kontrol');
  assert.match(oge(1).neden, /^bekliyor: Başka bir yük testi koşuyor/);
  await tur(I);
  assert.deepEqual(I.launch.at(-1), ['kosu', 102]);
});

test('KQ8 gecici hata: geri cekilmeyle 6 denemede HATALI; kosuId\'li ama kesin baslamamis 424 gecici; belirsiz -> HATALI + dinlenme', async () => {
  const awx424 = () => Object.assign(new Error('AWX şablonu doğrulanamadı: ECONNREFUSED'), { status: 424, code: 'awx_okunamadi', belirsiz: false });
  // a) Gercek akis: satir + numara (kanca) yazildi, sonra AWX sablon dogrulamasi 424 (belirsiz degil, is yok, kilit birakildi).
  //    Kisa AWX kesintisi kuyrugu BITIRMEZ: numara silinir, oge geri cekilmeyle (1, 2, 4, 8, 15 dk) ayni yerde bekler.
  sifirla();
  let I = sahteIslem();
  let id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  for (let i = 0; i < 6; i += 1) I.launchHata.push(awx424());
  for (let i = 1; i <= 5; i += 1) {
    await tur(I);
    assert.equal(oge(1).durum, 'BEKLIYOR', `deneme ${i}`);
    assert.equal(oge(1).deneme, i);
    assert.equal(oge(1).on_kontrol_kosu_id, null, 'basarisiz denemenin numarasi ogede kaldi');
    assert.match(oge(1).neden, new RegExp(`^geçici hata \\(${i}/6\\): AWX şablonu doğrulanamadı`));
    assert.equal(oge(2).durum, 'BEKLIYOR', 'kisa kesintide siradaki ogeye gecildi');
    const bekle = kuyruk.GERI_CEKILME_SN[i - 1] * 1000;
    const cagri = I.cagri.filter((c) => c[0] === 'onKontrol').length;
    D.simdi += bekle - 1000;
    await tur(I);
    assert.equal(I.cagri.filter((c) => c[0] === 'onKontrol').length, cagri, `geri cekilme (${bekle / 1000} sn) dolmadan yeniden denendi`);
    D.simdi += 1000;
  }
  await tur(I);
  assert.equal(oge(1).durum, 'HATALI');
  assert.match(oge(1).neden, /^geçici hata \(6\/6\): AWX şablonu doğrulanamadı/);
  assert.deepEqual(I.launch, [['on_kontrol', 107]], 'HATALI ogeden sonra kuyruk devam etmedi');
  assert.equal(kq(id).durum, 'CALISIYOR');
  assert.equal(D.kosular.filter((k) => k.durum === 'FAILED').length, 6);
  // b) Kosu asamasinda ayni hata: kosu numarasi silinir, on kontrol TEKRARLANMAZ, geri cekilme sonra kosu baslar.
  sifirla();
  I = sahteIslem();
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  await tur(I);
  bitir(101);
  I.launchHata.push(awx424());
  await tur(I);
  assert.deepEqual([oge(1).durum, oge(1).asama, oge(1).kosu_id, oge(1).on_kontrol_kosu_id, oge(1).deneme], ['CALISIYOR', 'on_kontrol', null, 101, 1]);
  assert.equal(kosu(102).durum, 'FAILED');
  await tur(I);
  assert.equal(I.launch.length, 1, 'geri cekilmede kosu denendi');
  D.simdi += 60000;
  await tur(I);
  assert.deepEqual(I.launch.at(-1), ['kosu', 103]);
  assert.equal(oge(1).kosu_id, 103);
  assert.equal(I.cagri.filter((c) => c[0] === 'onKontrol').length, 1, 'on kontrol tekrarlandi');
  // c) Kosu baslatma belirsiz (AWX'e gitti, cevap yok; kilit TTL'de): oge HATALI, kuyruk DINLENME; kilit tutuldukca
  //    sayac baslamaz, birakilinca bekleme_dk.
  sifirla();
  I = sahteIslem();
  id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  await tur(I);
  bitir(101);
  I.launchHata.push(Object.assign(new Error('AWX işi başlatılamadı: zaman aşımı'), { status: 424, code: 'awx_okunamadi', belirsiz: true }));
  D.kilitler.set('T|GBNGXT33', { lock_id: 'L102', held: 1, locked_until: D.simdi + 60 * 60000, awx_job_id: null });
  await tur(I);
  assert.equal(oge(1).durum, 'HATALI');
  assert.match(oge(1).neden, /^koşu başlatılamadı: AWX işi başlatılamadı/);
  assert.deepEqual([kq(id).durum, kq(id).dinlenme_kosu_id, kq(id).dinlenme_bitis], ['DINLENME', 102, null], 'belirsiz baslatmadan sonra dinlenme yok');
  D.simdi += 10 * 60000;
  await tur(I);
  assert.equal(kq(id).dinlenme_bitis, null, 'kilit tutulurken dinlenme sayaci basladi');
  assert.equal(oge(2).durum, 'BEKLIYOR');
  D.kilitler.get('T|GBNGXT33').held = 0;
  await tur(I);
  assert.equal(kq(id).dinlenme_bitis, D.simdi + 5 * 60000);
  // d) AWX is numarali hata (degisken yutuldu, is iptal edildi): HATALI (atla degil).
  assert.equal(kuyruk.hataSinifi({ status: 409, kosuId: 5, jobId: 77, belirsiz: false }), 'hatali');
  assert.equal(kuyruk.hataSinifi({ status: 424, kosuId: 5, belirsiz: false }), 'gecici');
  assert.equal(kuyruk.hataSinifi({ status: 409, kosuId: 5, belirsiz: false }), 'atla');
});

test('KQ8e yetki DB hatasi gecicidir (fail-closed): oge bekler, is yok; sinirda HATALI', async () => {
  sifirla();
  const I = sahteIslem();
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  I.yetki = new Error('Portal veritabanı okunamadı');
  await tur(I);
  assert.deepEqual([oge(1).durum, oge(1).deneme, I.launch.length], ['BEKLIYOR', 1, 0]);
  assert.ok(!I.cagri.some((c) => c[0] === 'plan'), 'yetki okunamadan plana gecildi');
  oge(1).deneme = 5;
  D.simdi += 60000;
  await tur(I);
  assert.equal(oge(1).durum, 'HATALI');
  assert.equal(I.launch.length, 0);
});

test('KQ8f ardisik olmayan tur hatalari birikmez (hataSifirla); kuyruk HATALI olunca calisan oge yetim kalmaz', async () => {
  sifirla();
  const I = sahteIslem();
  D.kosular.push({ id: 9, islem: 'on_kontrol', durum: 'RUNNING', kilit_id: 'L9', finished_at: null });
  const id = kuyrukKur(D, { kuyruk: { durum: 'CALISIYOR' }, ogeler: [{ etiket: 'A1', durum: 'CALISIYOR', asama: 'on_kontrol', on_kontrol_kosu_id: 9 }, { etiket: 'A2' }] });
  const gercek = I.kosuOku;
  const bozuk = async () => { throw new Error('Portal veritabanı okunamadı'); };
  I.kosuOku = bozuk;
  for (let i = 0; i < kuyruk.KUYRUK_HATA_SINIRI - 1; i += 1) await tur(I);
  I.kosuOku = gercek;
  await tur(I);
  assert.equal(kq(id).hata_sayisi, 0, 'basarili tur sayaci sifirlamadi');
  I.kosuOku = bozuk;
  for (let i = 0; i < kuyruk.KUYRUK_HATA_SINIRI - 1; i += 1) await tur(I);
  assert.equal(kq(id).durum, 'CALISIYOR', 'ardisik olmayan hatalar kuyrugu durdurdu');
  await tur(I);
  assert.equal(kq(id).durum, 'HATALI');
  assert.equal(oge(2).durum, 'ATLANDI');
  // DB dondu, on kontrol bitti: HATALI kuyrugun calisan ogesi izlenir ve kapanir (kosu baslatilmaz).
  I.kosuOku = gercek;
  bitir(9);
  await tur(I);
  assert.equal(oge(1).durum, 'IPTAL');
  assert.match(oge(1).neden, /^kuyruk HATALI; ön kontrol #9 sonrası koşu başlatılmadı/);
  assert.ok(!I.cagri.some((c) => c[0] === 'kosu'));
  assert.deepEqual((await db.query(kuyruk.SQL.aktifKuyruklar)).rows, []);
});

test('KQ9 on kontrol kilit beklenirken eskidi: yeniden on kontrol', async () => {
  sifirla();
  const I = sahteIslem();
  kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  await tur(I);
  bitir(101);
  I.kosuHata.push(Object.assign(new Error('Başka bir yük testi koşuyor.'), { status: 409, code: 'kilit_dolu' }));
  await tur(I);
  D.simdi += 15 * DK;
  await tur(I);
  assert.deepEqual(I.launch.at(-1), ['on_kontrol', 102], 'eski on kontrolle kosu denendi');
  assert.equal(oge(1).on_kontrol_kosu_id, 102);
});

test('KQ10 SQL sozlesmesi: kosullu yazimlar', () => {
  const S = kuyruk.SQL;
  const t = (q) => q.replace(/\s+/g, ' ');
  assert.match(t(S.ogeSahiplen), /WHERE id = \$1 AND durum = 'BEKLIYOR' AND on_kontrol_kosu_id IS NULL AND kosu_id IS NULL AND EXISTS \(SELECT 1 FROM nginx_loadtest_kuyruk q WHERE q\.id = nginx_loadtest_kuyruk_ogeler\.kuyruk_id AND q\.durum = 'CALISIYOR' AND q\.kira_id = \$3\) AND NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kuyruk_ogeler o2 WHERE o2\.kuyruk_id = nginx_loadtest_kuyruk_ogeler\.kuyruk_id AND o2\.durum = 'CALISIYOR'\)/);
  for (const ad of ['okKaydet', 'kosuKaydet']) assert.match(t(S[ad]), /WHERE id = \$1 AND deneme_id = \$3 AND durum = 'CALISIYOR' AND asama = '(on_kontrol|kosu)' AND (on_kontrol_kosu_id|kosu_id) IS NULL AND EXISTS \(.*q\.durum = 'CALISIYOR' AND q\.kira_id = \$4\)/, ad);
  assert.match(t(S.kiraAl), /WHERE id = \$1 AND \(kira_id IS NULL OR kira_id = \$2 OR kira_bitis IS NULL OR kira_bitis < GETUTCDATE\(\)\)/);
  assert.match(t(S.dinlenmeBaslat), /AND durum = 'DINLENME' AND dinlenme_bitis IS NULL$/);
  assert.match(t(S.dinlenmeBitti), /dinlenme_bitis <= GETUTCDATE\(\)$/);
  assert.match(t(S.kilitTutuluyor), /lock_id = \$1 AND held = 1 AND locked_until IS NOT NULL AND locked_until >= DATEADD\(HOUR, -12, GETUTCDATE\(\)\) AND \(locked_until >= GETUTCDATE\(\) OR awx_job_id IS NOT NULL\)/);
  assert.match(t(S.kuyrukBitti), /NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kuyruk_ogeler o WHERE o\.kuyruk_id = \$1 AND o\.durum IN \('BEKLIYOR', 'CALISIYOR'\)\)/);
  assert.match(t(S.ogeGeriAl), /on_kontrol_kosu_id IS NULL AND kosu_id IS NULL AND \(deneme_id = \$2 OR \$2 IS NULL\)/);
  assert.match(t(S.aktifKuyruklar), /q\.hazir = 1/);
  // Inceleme 2 kor noktalari: kosullar metinde (sahte tablo da metinden uygular).
  assert.match(t(S.siradakiOge), /durum = 'BEKLIYOR' ORDER BY sira ASC, id ASC$/);
  assert.match(t(S.calisanOge), /durum = 'CALISIYOR' ORDER BY sira ASC, id ASC$/);
  assert.match(t(S.kosuGeriAl), /asama = 'kosu' AND kosu_id IS NULL AND \(deneme_id = \$2 OR \$2 IS NULL\)/);
  assert.match(t(S.aktifKuyruklar), /q\.durum IN \('BEKLIYOR', 'CALISIYOR', 'DINLENME'\) OR \(q\.durum IN \('IPTAL', 'HATALI'\) AND EXISTS \(SELECT 1 FROM nginx_loadtest_kuyruk_ogeler o WHERE o\.kuyruk_id = q\.id AND o\.durum = 'CALISIYOR'\)\)/);
  assert.match(t(S.dinlenmeBaslat), /SET dinlenme_bitis = DATEADD\(MINUTE, bekleme_dk, GETUTCDATE\(\)\)/);
  assert.match(t(S.kuyrukIptal), /WHERE id = \$1 AND durum IN \('BEKLIYOR', 'CALISIYOR', 'DINLENME'\)$/);
  assert.match(t(S.kosuAsamasi), /on_kontrol_kosu_id = \$2 AND kosu_id IS NULL AND EXISTS \(.*q\.durum = 'CALISIYOR' AND q\.kira_id = \$4\)$/);
  // BEKLIYOR'a geri alma yalniz kuyruk CALISIYOR iken (iptal yarisinda yetim oge yok).
  for (const ad of ['ogeGeriAl', 'kosuGeriAl', 'onKontrolYenile', 'okSifirla', 'kosuSifirla']) {
    assert.match(t(S[ad]), /AND EXISTS \(SELECT 1 FROM nginx_loadtest_kuyruk q WHERE q\.id = nginx_loadtest_kuyruk_ogeler\.kuyruk_id AND q\.durum = 'CALISIYOR'\)$/, ad);
  }
  assert.match(t(S.okSifirla), /WHERE id = \$1 AND deneme_id = \$2 AND durum = 'CALISIYOR' AND asama = 'on_kontrol' AND on_kontrol_kosu_id = \$5 AND kosu_id IS NULL/);
  assert.match(t(S.kosuSifirla), /WHERE id = \$1 AND deneme_id = \$2 AND durum = 'CALISIYOR' AND asama = 'kosu' AND kosu_id = \$5/);
  assert.match(t(S.ogeErtele), /SET sonraki_deneme_at = DATEADD\(SECOND, \$2, GETUTCDATE\(\)\) WHERE id = \$1 AND durum IN \('BEKLIYOR', 'CALISIYOR'\)$/);
  assert.match(t(S.ayniHedefAktif), /WHERE onay_hedefi = \$1 AND hazir = 1 AND durum IN \('BEKLIYOR', 'CALISIYOR', 'DINLENME'\)/);
  // db/index.cjs RETURNING cevirisi ^INSERT ister: etiket ilk anahtar sozcukten SONRA.
  for (const [ad, q] of Object.entries(S)) assert.match(q.trimStart(), /^(SELECT|UPDATE|INSERT) \/\*KQ:\w+\*\//, ad);
  const dbi = require('../../db/index.cjs');
  assert.match(dbi._adaptSql(S.kuyrukEkle), /OUTPUT INSERTED\.id VALUES/);
  // Sema: iki tablo setup'ta, kuyruk basina tek calisan oge filtreli tekil indeksle.
  const kur = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const tb of ['nginx_loadtest_kuyruk', 'nginx_loadtest_kuyruk_ogeler']) assert.match(kur, new RegExp(`name: '${tb}',\\s+sql: .\\s+CREATE TABLE ${tb} \\(`), tb);
  assert.match(kur, /CREATE UNIQUE INDEX UX_nlko_calisan ON nginx_loadtest_kuyruk_ogeler \(kuyruk_id\) WHERE durum = 'CALISIYOR'/);
  assert.match(kur, /hazir\s+BIT NOT NULL DEFAULT 0/);
  // Geri cekilme sutunu: yeni kurulumda CREATE TABLE'da, ilk surumle kurulmus tabloda ALTER ile.
  assert.match(kur, /CREATE TABLE nginx_loadtest_kuyruk_ogeler \([^`]*sonraki_deneme_at\s+DATETIME2 NULL/);
  assert.match(kur, /table: 'nginx_loadtest_kuyruk_ogeler',\s+col: 'sonraki_deneme_at',\s+sql: `ALTER TABLE nginx_loadtest_kuyruk_ogeler ADD sonraki_deneme_at DATETIME2 NULL`/);
  // Sira: tek ifade, yalniz BEKLIYOR.
  assert.match(t(kuyruk.siraSql(2)), /SET sira = CASE id WHEN \$2 THEN \$4 \+ 1 WHEN \$3 THEN \$4 \+ 2 END WHERE kuyruk_id = \$1 AND durum = 'BEKLIYOR' AND id IN \(\$2, \$3\)$/);
});

test('KQ11 uyari turu, govde dogrulama, zamanlama, kuyruk HATALI', async () => {
  assert.equal(kuyruk.uyariTuru('3/12 yol 200 dönmedi'), kuyruk.uyariTuru('7/12 yol 200 dönmedi'));
  assert.notEqual(kuyruk.uyariTuru('3/12 yol 200 dönmedi'), kuyruk.uyariTuru('/web_log %70 dolu'));
  assert.deepEqual(kuyruk.uyariTurleri(['a 1', 'a 2', 'b']).map((t) => t.ornek), ['a 1', 'b']);
  assert.throws(() => kuyruk.uyariKarariOf([{ kod: kuyruk.uyariTuru('a 1') }])(['a 9', 'b']), (e) => e.code === 'yeni_uyari' && /U[0-9a-f]{10} b/.test(e.message));
  assert.doesNotThrow(() => kuyruk.uyariKarariOf([kuyruk.uyariTuru('a 1')])(['a 9']));
  const simdiMs = BAS;
  const govde = { senaryoId: 1 };
  assert.throws(() => kuyruk.kuyrukGovdesi({ ogeler: [{ etiket: ' ', govde }] }, { simdiMs }), /etiket zorunlu/);
  assert.throws(() => kuyruk.kuyrukGovdesi({ ogeler: [] }, { simdiMs }), /en az bir öğe/);
  assert.throws(() => kuyruk.kuyrukGovdesi({ beklemeDk: 31, ogeler: [{ etiket: 'a', govde }] }, { simdiMs }), /1–30/);
  assert.throws(() => kuyruk.kuyrukGovdesi({ beklemeDk: 0, ogeler: [{ etiket: 'a', govde }] }, { simdiMs }), /1–30/);
  assert.throws(() => kuyruk.kuyrukGovdesi({ baslangic: new Date(BAS + 2 * 3600000).toISOString(), enGecBitis: new Date(BAS + 3600000).toISOString(), ogeler: [{ etiket: 'a', govde }] }, { simdiMs }), /başlangıçtan sonra/);
  assert.throws(() => kuyruk.kuyrukGovdesi({ ogeler: [{ etiket: 'x'.repeat(101), govde }] }, { simdiMs }), /en çok 100/);
  const g = kuyruk.kuyrukGovdesi({ ogeler: [{ etiket: ' A3 brotli seviye 4 ', govde, onKontrolKosuId: '12' }], onaylananTurler: ['U0123456789', 'kotu'] }, { simdiMs });
  assert.equal(g.beklemeDk, 5);
  assert.deepEqual(g.ogeler[0], { etiket: 'A3 brotli seviye 4', govde, onKontrolKosuId: 12 });
  assert.deepEqual(g.onaylananTurler, ['U0123456789'], 'gecersiz kod suzulmedi');
  assert.equal(kuyruk.kosuEtiketi(12, 'A3'), '[K12] A3');
  // Zamanlama: dinlenmede 2 bekleyen oge (butce 600): 4 dk 12 sn sonra birinci, ardindan bekleme.
  const k = { durum: 'DINLENME', bekleme_dk: 5, dinlenme_bitis: new Date(BAS + 252000), dinlenme_kalan_sn: 252, en_gec_bitis: new Date(BAS + 30 * DK) };
  const z = kuyruk.zamanlama(k, [{ id: 1, durum: 'BITTI' }, { id: 2, durum: 'BEKLIYOR', butce_sn: 600 }, { id: 3, durum: 'BEKLIYOR', butce_sn: 600 }], BAS);
  assert.equal(z.siradakiKalanSn, 252);
  assert.equal(z.ogeler.get(2).tahminiBaslangic, new Date(BAS + 252000).toISOString());
  assert.equal(z.ogeler.get(3).tahminiBaslangic, new Date(BAS + 252000 + 900000 + 300000).toISOString());
  assert.equal(z.ogeler.get(2).sureYetmeyebilir, false);
  assert.equal(z.ogeler.get(3).sureYetmeyebilir, true);
  assert.equal(z.tahminiBitis, new Date(BAS + 252000 + 2 * 900000 + 300000).toISOString());
  // KUYRUK_HATA_SINIRI (120, ~30 dk) ardisik yurutucu hatasi: kuyruk HATALI, bekleyenler ATLANDI; 10 hata (2,5 dk) yetmez.
  assert.equal(kuyruk.KUYRUK_HATA_SINIRI, 120);
  sifirla();
  const I = sahteIslem();
  const id = kuyrukKur(D, { kuyruk: { durum: 'CALISIYOR' }, ogeler: [{ etiket: 'A1', durum: 'CALISIYOR', asama: 'on_kontrol', on_kontrol_kosu_id: 9 }, { etiket: 'A2' }] });
  I.kosuOku = async () => { throw new Error('Portal veritabanı okunamadı'); };
  for (let i = 0; i < kuyruk.KUYRUK_HATA_SINIRI - 1; i += 1) await tur(I);
  assert.equal(kq(id).durum, 'CALISIYOR');
  await tur(I);
  assert.equal(kq(id).durum, 'HATALI');
  assert.equal(oge(2).durum, 'ATLANDI');
  assert.match(oge(2).neden, /120 kez üst üste hata/);
});

test('KQ12 iptal ile geri alma yarisi: iptal edilen kuyrukta oge BEKLIYOR\'a donmez, sonraki tur IPTAL kapatir', async () => {
  const iptal = async (id) => {
    await db.query(kuyruk.SQL.kuyrukIptal, [id, 'onur']);
    await db.query(kuyruk.SQL.ogelerIptal, [id, 'kuyruk iptal edildi (onur)']);
  };
  // a) sahiplenmeden sonra iptal, on kontrol kilit_dolu (geri alma): oge yetim kalmaz.
  sifirla();
  let I = sahteIslem();
  let id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }, { etiket: 'A2' }] });
  I.okOncesi = async () => iptal(id);
  I.okHata.push(Object.assign(new Error('GBNGXT33 üzerinde başka bir iş var (veli).'), { status: 409, code: 'kilit_dolu' }));
  await tur(I);
  assert.notEqual(oge(1).durum, 'BEKLIYOR', 'iptal edilen kuyrukta oge BEKLIYOR\'a dondu');
  I.okOncesi = null;
  await tur(I);
  assert.deepEqual(D.ogeler.map((o) => o.durum), ['IPTAL', 'IPTAL']);
  assert.match(oge(1).neden, /^kuyruk iptal edildi; iş başlatılmamıştı/);
  assert.equal(I.launch.length, 0);
  assert.deepEqual((await db.query(kuyruk.SQL.aktifKuyruklar)).rows, []);
  // b) kosu asamasinda kilit_dolu ve on kontrol eskimesi (onKontrolYenile): iptalde de oge kapanir.
  sifirla();
  I = sahteIslem();
  id = kuyrukKur(D, { ogeler: [{ etiket: 'A1' }] });
  await tur(I);
  bitir(101);
  D.simdi += 15 * 60000;
  await iptal(id);
  const r = await db.query(kuyruk.SQL.onKontrolYenile, [1, 101, 'eski']);
  assert.equal(r.rowCount, 0, 'iptal edilen kuyrukta on kontrol yenilendi (oge BEKLIYOR olurdu)');
  await tur(I);
  assert.equal(oge(1).durum, 'IPTAL');
  // c) bitmis kuyruk yeniden iptal edilemez (durum filtresi).
  sifirla();
  id = kuyrukKur(D, { kuyruk: { durum: 'BITTI' }, ogeler: [] });
  assert.equal((await db.query(kuyruk.SQL.kuyrukIptal, [id, 'onur'])).rowCount, 0);
  assert.equal(kq(id).durum, 'BITTI');
});

test('KQ13 sira sutunu: once sira degeri kucuk olan oge baslar (id sirasi degil)', async () => {
  sifirla();
  const I = sahteIslem();
  kuyrukKur(D, { ogeler: [{ etiket: 'A1', sira: 5 }, { etiket: 'A2', sira: 2 }] });
  await tur(I);
  assert.deepEqual([oge(1).durum, oge(2).durum], ['BEKLIYOR', 'CALISIYOR']);
  assert.ok(I.cagri.some((c) => c[0] === 'onKontrol' && c[1] === '[K1] A2'));
});

test('KQ14 sure kapisi plandaki butceyle de: saklanan butce kucuk, yeniden olculen buyuk -> ATLANDI', async () => {
  sifirla();
  const I = sahteIslem();
  kuyrukKur(D, { kuyruk: { en_gec_bitis: BAS + 10 * DK }, ogeler: [{ etiket: 'A1', butce_sn: 100 }] });
  I.butce = 600;
  await tur(I);
  assert.equal(oge(1).durum, 'ATLANDI');
  assert.match(oge(1).neden, /^süre yetmedi: tahmini 15 dk, en geç bitişe 10 dk kaldı/);
  assert.equal(I.launch.length, 0);
});

test('KQ15 kirasi baska surecte olan kuyruga dokunulmaz (numarasiz calisan oge geri alinmaz, yazim yok)', async () => {
  sifirla();
  const I = sahteIslem();
  kuyrukKur(D, { kuyruk: { durum: 'CALISIYOR', kira_id: 'P0', kira_bitis: BAS + 5 * DK }, ogeler: [{ etiket: 'A1', durum: 'CALISIYOR', asama: 'on_kontrol', deneme_id: 'p0' }] });
  D.kuyrukSorgular = [];
  await tur(I, 'P1');
  assert.deepEqual(D.kuyrukSorgular.map((x) => x.ad), ['aktifKuyruklar', 'kiraAl'], 'kirasiz surec kuyrugu isledi');
  assert.deepEqual([oge(1).durum, oge(1).deneme_id], ['CALISIYOR', 'p0']);
  assert.equal(I.cagri.length, 0);
});

test('KQ16 kuyruk etiketi / adi kontrol karakteri tasiyamaz', () => {
  const govde = { senaryoId: 1 };
  for (const etiket of ['a\nb', 'a\u0007', 'x\ty']) {
    assert.throws(() => kuyruk.kuyrukGovdesi({ ogeler: [{ etiket, govde }] }, { simdiMs: BAS }), /Öğe 1: etiket satır sonu \/ kontrol karakteri içeremez/, JSON.stringify(etiket));
  }
  assert.throws(() => kuyruk.kuyrukGovdesi({ ad: 'gece\u0007x', ogeler: [{ etiket: 'a', govde }] }, { simdiMs: BAS }), /Kuyruk adı/);
  assert.equal(kuyruk.kuyrukGovdesi({ ogeler: [{ etiket: 'A3 brotli 4 – ç', govde }] }, { simdiMs: BAS }).ogeler[0].etiket, 'A3 brotli 4 – ç');
});
