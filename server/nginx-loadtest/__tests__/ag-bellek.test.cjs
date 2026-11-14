// server/nginx-loadtest/__tests__/ag-bellek.test.cjs -- 2026-11-03 bant genisligi ve bellek ayrisimi (YALNIZ BILGI).
//
//   AB1 sonuc.cjs ag_*.csv: arayuz basina kumulatif sayac -> ornek anina TOPLAM; 32 bit sarma (+2^32), 64 bit sarma,
//       sifirlama (0 + sayac); ayni epoch'taki arayuzler toplanir; bozuk satir / geri giden epoch atlanir; eksik kolon,
//       satir / ornek tavani, dizin: kosu OKUNAMADI DEGIL (kesit sorunlu); ag_*.txt (rol) csv'siz de kesit olur
//   AB2 sonuc.cjs bdetay_*.csv ({t,n,k,an,sh,fi,pss,mr,mp,bg}; bos -> null) ve istemci JSON ag_* -> istemciAg (yalniz
//       anahtar varsa; negatif / metin -> null); SHA256SUMS yeni dosyalari da baglar
//   AB3 analiz: ham.ag test trafigi (bayt x 8 / sure), hedef NIC (CPU penceresi, 32 bit sarmali sayac), yuk NIC (yuk
//       penceresi), arayuz hizi -> kullanim %, > %70 TUR uyarisi ag_kullanim_yuksek; ozet ag_kesitler / ag_bosta (ilk adimdan
//       once); serbestte hedef NIC yok sayilir; gecerlilik / nedenler DEGISMEZ
//   AB4 analiz: ham.bellek_detay taban (adim oncesi) / son (pencere sonu) / dinlenme (bosluk sonu) noktalari, pencere
//       ortalamalari, saat farki log penceresinden; ozet bdetay_kesitler
//   AB5 karisik surum: eski Portal (125f5ea) yeni dosyalarla analizi dosyasiz dizinle AYNI; yeni Portal eski playbook
//       dizininde eski Portal'la AYNI (eski kosu analizi bayt bayt; ozet.sha256 / okunan_bayt haric)
//   AB6 gorunum: agGorunumu / bellekDetayGorunumu camelCase, eski satir null; bellekNedenleri kurallari (tampon,
//       anon_kalici, paylasilan, dosya, reload, artis_yok) esik sinirlariyla; bellekSizinti Anon kurali + RSS uyarisi
//       birlesik (olasi_sizinti anon / rss, rss_artisi_anon_degil); sonucOzeti agBosta
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sonuc = require('../sonuc.cjs');
const { kosuDiziniOku } = sonuc;
const { kosuAnaliz, NEDEN_KALIPLARI } = require('../analiz.cjs');
const gorunum = require('../gorunum.cjs');
const { standart, portalDuzeniYaz } = require('./fixtures/kurgu.cjs');

const KOK = fs.mkdtempSync(path.join(os.tmpdir(), 'yuktesti-agbellek-'));
after(() => fs.rmSync(KOK, { recursive: true, force: true }));
let sira = 0;
function yeniDizin(dosyalar) {
  const d = path.join(KOK, `d${++sira}`);
  fs.mkdirSync(d);
  for (const [ad, icerik] of Object.entries(dosyalar)) fs.writeFileSync(path.join(d, ad), icerik);
  return d;
}
const AG_BAS = 'epoch,arayuz,rx_bayt,tx_bayt\n';
const BD_BAS = 'epoch,isci_sayi,kapanan_sayi,anon_kb,shmem_kb,file_kb,pss_kb,master_rss_kb,master_pss_kb,baglanti\n';
const IKI32 = 2 ** 32;

test('AB1 ag_*.csv: toplam, sarma, sifirlama, bozuk satir; sorunlu dosya kosuyu OKUNAMADI yapmaz; txt rol', async () => {
  const csv = AG_BAS + [
    `100.5,eth0,${IKI32 - 1000},10`, '100.5,eth1,500,20',
    '101.5,eth0,4000,30', '101.5,eth1,700,25',
    '101.0,eth0,1,1',
    '102.5,eth0,6000,40', '102.5,eth1,100,26',
    '102.5,eth;0,1,1', '102.5,eth1,-5,1', 'x,eth0,1,1', 'kisa',
  ].join('\n') + '\n';
  const v = await kosuDiziniOku(yeniDizin({ 'ag_R1_h.csv': csv, 'ag_R1_h.txt': 'surum=1\nrol=hedef\narayuz=\nsecim=lo_disi_toplam(hedef_ip_yok)\nhiz_mbps=\n' }));
  const k = v.agKesitler[0];
  // 100.5 taban; 101.5: eth0 32 bit sarma (+5000 bayt), eth1 +200; 102.5: eth0 +2000, eth1 sifirlandi (0).
  assert.deepEqual(k.ornekler.map((o) => [o.t, o.rx, o.tx]), [[100.5, 0, 0], [101.5, 5200, 25], [102.5, 7200, 36]]);
  assert.deepEqual([k.anahtar, k.dosya, k.arayuzSayisi, k.sarma, k.sifirlama, k.bilgi.rol, 'sorun' in k], ['R1_h', 'ag_R1_h.csv', 2, 1, 1, 'hedef', false]);
  // 64 bit sarma (2^64 - 4096 tam temsil edilir): 4096 + 90.
  assert.equal(sonuc._sayacFarkiForTest(2 ** 64 - 4096, 90, { sarma: 0, sifirlama: 0 }), 4186);
  assert.equal(sonuc._sayacFarkiForTest(IKI32 - 10, 5, { sarma: 0, sifirlama: 0 }), 15);
  const o = { sarma: 0, sifirlama: 0 };
  assert.equal(sonuc._sayacFarkiForTest(1e9, 100, o), 0, 'fark + 2^32 >= 2^31: sarma degil, sifirlama');
  assert.deepEqual(o, { sarma: 0, sifirlama: 1 });
  // Eksik kolon / tavan / dizin / csv'siz txt: kosu okunur, kesit sorunlu ve bos.
  const ek = await kosuDiziniOku(yeniDizin({ 'ag_R1_h.csv': 'epoch,arayuz\n1,eth0\n', 'ag_R1_y.txt': 'rol=yuk\n' }));
  assert.deepEqual(ek.agKesitler.map((x) => [x.anahtar, x.ornekler.length, x.sorun, x.bilgi && x.bilgi.rol]), [
    ['R1_h', 0, 'ag_R1_h.csv: eksik kolon rx_bayt,tx_bayt', null], ['R1_y', 0, 'ag_R1_y.csv yok', 'yuk'],
  ]);
  const cok = AG_BAS + Array.from({ length: 20001 }, (_, i) => `${1000 + i},eth0,${i},${i}`).join('\n') + '\n';
  const tv = await kosuDiziniOku(yeniDizin({ 'ag_R1_h.csv': cok }));
  assert.deepEqual(tv.agKesitler.map((x) => [x.ornekler.length, x.sorun]), [[0, 'ag_R1_h.csv: ornek tavani asildi (en cok 20000 ornek)']]);
  const d = yeniDizin({});
  fs.mkdirSync(path.join(d, 'ag_R1_h.csv'));
  fs.mkdirSync(path.join(d, 'bdetay_R1_h.csv'));
  const dz = await kosuDiziniOku(d);
  assert.deepEqual(dz.agKesitler.map((x) => x.sorun), ['ag_R1_h.csv: normal dosya degil']);
  assert.deepEqual(dz.bdetayKesitler.map((x) => x.sorun), ['bdetay_R1_h.csv: normal dosya degil']);
  // Dosya yok: bos listeler (eski playbook).
  const yok = await kosuDiziniOku(yeniDizin({ 'NOT.txt': 'x\n' }));
  assert.deepEqual([yok.agKesitler, yok.bdetayKesitler, yok.istemciAg.size], [[], [], 0]);
});

test('AB2 bdetay_*.csv ve istemci JSON ag_* okunur; SHA256SUMS baglar', async () => {
  const bd = BD_BAS + '11.5,2,1,15000,28000,7000,,8000,,3\n10.5,2,0,1,2,3,4,5,6,7\nx,1,1,1,1,1,1,1,1,1\n';
  const json = (tur, ek) => JSON.stringify({ tur, hiz: 1, ...ek }, null, 2) + '\n';
  const v = await kosuDiziniOku(yeniDizin({
    'bdetay_R1_h.csv': bd,
    'istemci_R1_K_ka_br_10_r1.json': json('R1_K_ka_br_10_r1', { ag_alinan_bayt: 1000, ag_gonderilen_bayt: null, ag_sure_sn: 10 }),
    'istemci_R1_K_ka_br_10_r2.json': json('R1_K_ka_br_10_r2', { ag_alinan_bayt: -1, ag_gonderilen_bayt: '5', ag_sure_sn: 10, kodlama: { br: 1 } }),
    'istemci_R1_K_ka_br_20_r1.json': json('R1_K_ka_br_20_r1', {}),
  }));
  assert.deepEqual(v.bdetayKesitler, [{ anahtar: 'R1_h', dosya: 'bdetay_R1_h.csv', ornekler: [
    { t: 10.5, n: 2, k: 0, an: 1, sh: 2, fi: 3, pss: 4, mr: 5, mp: 6, bg: 7 },
    { t: 11.5, n: 2, k: 1, an: 15000, sh: 28000, fi: 7000, pss: null, mr: 8000, mp: null, bg: 3 },
  ] }]);
  assert.deepEqual([...v.istemciAg.entries()], [
    ['R1_K_ka_br_10_r1', { alinan: 1000, gonderilen: null, sure: 10 }],
    ['R1_K_ka_br_10_r2', { alinan: null, gonderilen: null, sure: 10 }],
  ]);
  assert.equal(v.istemciKodlama.get('R1_K_ka_br_10_r2').br, 1, 'kodlama ayni JSON dosyasindan aynen');
  const crypto = require('node:crypto');
  const sha = crypto.createHash('sha256').update(bd).digest('hex');
  await assert.rejects(kosuDiziniOku(yeniDizin({ 'bdetay_R1_h.csv': bd, SHA256SUMS: `${'0'.repeat(64)}  bdetay_R1_h.csv\n` })), /SHA256SUMS tutmuyor: bdetay_R1_h\.csv/);
  assert.equal((await kosuDiziniOku(yeniDizin({ 'bdetay_R1_h.csv': bd, SHA256SUMS: `${sha}  bdetay_R1_h.csv\n` }))).sha256.durum, 'dogrulandi');
});

// ---------------------------------------------------------------------------------------------
// Kurgu tabanli analiz: standart ADIM (100/250/400 x 2), t0 = 1800000000, ilk adim t0 + 60'ta.
// Hedef NIC: yuk araliginda (Kurgu aralik) saniyede rx 1e6 / tx 2e6 bayt, disarida 125000 / 250000; sayac 32 bit sarmali.
// Yuk NIC: zaman.csv araliginda rx 500000 / tx 50000, disarida 0. Istemci JSON: 60 sn olcumde 60e6 / 6e6 bayt.
// ---------------------------------------------------------------------------------------------
const T0 = 1800000000;
function sunucuZamanlari(d) {
  const ad = [...d.keys()].find((x) => /^sunucu_.*\.csv$/.test(x));
  return { anahtar: ad.slice('sunucu_'.length, -'.csv'.length), ts: d.get(ad).icerik.trim().split('\n').slice(1).map((s) => Number(s.split(',')[0])) };
}
const dosya = (icerik) => ({ icerik, py: false, portal: true, log: false });
function agEkle(k, d, { hiz = 100, yukHiz = 1000, yuk = true, hedef = true, json = true } = {}) {
  const out = new Map(d);
  const { anahtar, ts } = sunucuZamanlari(d);
  if (hedef) {
    let rx = IKI32 - 3000000;
    let tx = 7;
    const satir = [];
    for (const t of ts) {
      satir.push(`${t}.250000,bond0,${rx % IKI32},${tx}`);
      const yukte = k.aralik.some(([a, b]) => a <= t && t < b);
      rx += yukte ? 1000000 : 125000;
      tx += yukte ? 2000000 : 250000;
    }
    out.set(`ag_${anahtar}.csv`, dosya(AG_BAS + satir.join('\n') + '\n'));
    out.set(`ag_${anahtar}.txt`, dosya(`surum=1\nrol=hedef\nhost=test\nsecim=hedef_ip\narayuz=bond0\nhiz_mbps=${hiz}\narayuz_siniri=32\n`));
  }
  if (yuk) {
    const z = d.get('zaman.csv').icerik.trim().split('\n').slice(1).map((s) => s.split(',').map(Number));
    const bas = Math.min(...z.map((x) => x[1])) - 30;
    const bit = Math.max(...z.map((x) => x[2])) + 30;
    let rx = 0;
    let tx = 0;
    const satir = [];
    for (let t = bas; t <= bit; t++) {
      satir.push(`${t}.5,eth0,${rx},${tx}`);
      const yukte = z.some((x) => x[1] <= t && t < x[2]);
      rx += yukte ? 500000 : 0;
      tx += yukte ? 50000 : 0;
    }
    const ya = `${k.adim}_ymak01`;
    out.set(`ag_${ya}.csv`, dosya(AG_BAS + satir.join('\n') + '\n'));
    out.set(`ag_${ya}.txt`, dosya(`surum=1\nrol=yuk\nhost=ymak01\nsecim=ip_route\narayuz=eth0\nhiz_mbps=${yukHiz}\n`));
  }
  if (json) {
    for (const [ad, f] of d) {
      if (!/^istemci_.*\.json$/.test(ad)) continue;
      const j = JSON.parse(f.icerik);
      out.set(ad, { ...f, icerik: JSON.stringify({ ...j, ag_alinan_bayt: 60e6, ag_gonderilen_bayt: 6e6, ag_sure_sn: 60 }, null, 2) + '\n' });
    }
  }
  return out;
}
/** bdetay: yuk araliginda Anon 95 MB / baglanti 900, disarida 40 MB / 4; Shmem ilk adimdan itibaren 74 MB (oncesi 10). */
function bdetayEkle(k, d, { anon = null } = {}) {
  const out = new Map(d);
  const { anahtar, ts } = sunucuZamanlari(d);
  const ilk = Math.min(...k.zaman.map((x) => x[1]));
  const satir = ts.map((t) => {
    const yukte = k.aralik.some(([a, b]) => a <= t && t < b);
    const an = (() => { if (anon) return anon(t, yukte); if (yukte) return 95 * 1024; return 40 * 1024; })();
    const sh = t >= ilk ? 74 * 1024 : 10 * 1024;
    return `${t}.250000,2,0,${an},${sh},${20 * 1024},${an + sh / 8},8000,,${yukte ? 900 : 4}`;
  });
  out.set(`bdetay_${anahtar}.csv`, dosya(BD_BAS + satir.join('\n') + '\n'));
  return out;
}
async function analizEt(k, donustur = (d) => d, secenek = {}) {
  const dizin = portalDuzeniYaz(path.join(KOK, `k-${k.adim}-${++sira}`), donustur(k.dosyalar({})));
  const veri = await kosuDiziniOku(dizin, { adim: k.adim });
  return { dizin, veri, analiz: kosuAnaliz(veri, { adim: k.adim, ...secenek }) };
}
/** Yeni (bilgi) alanlar cikarilinca analiz: ham.ag / bellek_detay, ag_kullanim_yuksek uyarilari, ozet ag_ / bdetay_. */
function yeniAlanlarsiz(an) {
  const x = JSON.parse(JSON.stringify(an));
  for (const s of x.adimlar) {
    delete s.ham.ag;
    delete s.ham.bellek_detay;
    s.ham.uyarilar = s.ham.uyarilar.filter((u) => !u.startsWith('ag_kullanim_yuksek('));
  }
  x.uyarilar = x.uyarilar.filter((u) => !/(^|: )ag_kullanim_yuksek\(/.test(u));
  for (const a of ['ag_kesitler', 'ag_bosta', 'bdetay_kesitler']) delete x.ozet[a];
  x.ozet.okunan_bayt = null;
  x.ozet.sha256 = null;
  return x;
}
const yakin = (a, b, msg) => assert.ok(a !== null && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} != ${b}`);

test('AB3 ham.ag: test trafigi, hedef NIC (32 bit sarma), yuk NIC, kullanim %, uyari; ozet; serbest; gecerlilik ayni', async () => {
  const k = standart('R130');
  const eski = (await analizEt(k)).analiz;
  assert.ok(eski.adimlar.every((s) => !('ag' in s.ham) && !('bellek_detay' in s.ham)) && !('ag_kesitler' in eski.ozet) && !('ag_bosta' in eski.ozet));
  const { analiz: a } = await analizEt(k, (d) => agEkle(k, d));
  for (const s of a.adimlar) {
    const g = s.ham.ag;
    yakin(g.test_alinan_bps, 8e6, `${s.tur} test alinan`);
    yakin(g.test_gonderilen_bps, 8e5, `${s.tur} test gonderilen`);
    yakin(g.hedef.rx_ort_bps, 8e6, `${s.tur} hedef rx`);
    yakin(g.hedef.tx_ort_bps, 16e6, `${s.tur} hedef tx`);
    yakin(g.hedef.rx_max_bps, 8e6, `${s.tur} hedef rx max`);
    yakin(g.hedef.kullanim_max_yuzde, 16, `${s.tur} kullanim (16 Mbps / 100 Mbps)`);
    assert.deepEqual([g.hedef.arayuz, g.hedef.secim, g.hedef.hiz_mbps], ['bond0', 'hedef_ip', 100]);
    yakin(g.yuk.rx_ort_bps, 4e6, `${s.tur} yuk rx`);
    yakin(g.yuk.tx_ort_bps, 4e5, `${s.tur} yuk tx`);
    yakin(g.yuk.kullanim_max_yuzde, 0.4, `${s.tur} yuk kullanim`);
    assert.ok(!s.ham.uyarilar.some((u) => u.startsWith('ag_kullanim_yuksek(')), s.tur);
  }
  assert.deepEqual(a.ozet.ag_kesitler.map((x) => [x.anahtar, x.rol, x.arayuz, x.hiz_mbps, x.sarma > 0, x.sifirlama]), [
    ['R130_test', 'hedef', 'bond0', 100, true, 0], ['R130_ymak01', 'yuk', 'eth0', 1000, false, 0],
  ]);
  yakin(a.ozet.ag_bosta.hedef.rx_bps, 1e6, 'bosta hedef rx (125000 B/sn)');
  yakin(a.ozet.ag_bosta.hedef.tx_bps, 2e6, 'bosta hedef tx');
  assert.ok(a.ozet.ag_bosta.hedef.sn >= 50 && a.ozet.ag_bosta.hedef.secim === 'hedef_ip');
  yakin(a.ozet.ag_bosta.yuk.rx_bps, 0, 'bosta yuk (kayit adimdan 30 sn once baslar)');
  // Bilgi alanlari disinda analiz AYNI (gecerlilik, nedenler, CPU, karar).
  assert.deepEqual(yeniAlanlarsiz(a), yeniAlanlarsiz(eski));
  // Arayuz 10 Mbps: hedef kullanimi %160 -> TUR uyarisi (bilgi), gecerlilik degismez.
  const u = (await analizEt(k, (d) => agEkle(k, d, { hiz: 10, yukHiz: 4 }))).analiz;
  for (const s of u.adimlar) {
    assert.ok(s.ham.uyarilar.includes('ag_kullanim_yuksek(hedef,%160.0)'), `${s.tur}: ${s.ham.uyarilar}`);
    assert.ok(s.ham.uyarilar.includes('ag_kullanim_yuksek(yuk,%100.0)'), `${s.tur}: ${s.ham.uyarilar}`);
  }
  assert.ok(NEDEN_KALIPLARI.some((x) => x.kod === 'ag_kullanim_yuksek' && x.tur === 'uyari' && x.re.test('ag_kullanim_yuksek(hedef,%160.0)')));
  assert.deepEqual(u.adimlar.map((s) => [s.gecerlilik, s.nedenler]), eski.adimlar.map((s) => [s.gecerlilik, s.nedenler]));
  // Esik alti: 16 Mbps / 23 Mbps = %69,6 -> uyari yok.
  const esik = (await analizEt(k, (d) => agEkle(k, d, { hiz: 23, yuk: false }))).analiz;
  assert.ok(esik.adimlar.every((s) => !s.ham.uyarilar.some((x) => x.startsWith('ag_kullanim_yuksek('))));
  // Yalniz istemci JSON (NIC yok): test trafigi var, hedef / yuk null.
  const j = (await analizEt(k, (d) => agEkle(k, d, { hedef: false, yuk: false }))).analiz;
  assert.deepEqual([j.adimlar[0].ham.ag.hedef, j.adimlar[0].ham.ag.yuk, 'ag_kesitler' in j.ozet], [null, null, false]);
  // Serbest hedef: hedef ag dosyasi yok sayilir, yuk NIC ve test trafigi kalir.
  const k2 = standart('R131');
  const sr = (await analizEt(k2, (d) => agEkle(k2, d), { hedefTuru: 'serbest' })).analiz;
  assert.ok(sr.adimlar.every((s) => s.ham.ag.hedef === null && s.ham.ag.yuk !== null), 'serbest: hedef NIC yok');
  assert.equal(sr.ozet.ag_bosta && sr.ozet.ag_bosta.hedef, null);
});

test('AB4 ham.bellek_detay: taban / son / dinlenme, pencere ortalamalari; ozet bdetay_kesitler', async () => {
  const k = standart('R132');
  const { analiz: a } = await analizEt(k, (d) => bdetayEkle(k, d));
  assert.deepEqual(a.ozet.bdetay_kesitler.map((x) => [x.anahtar, x.ornek > 100]), [['R132_test', true]]);
  const satirlar = a.adimlar.slice().sort((x, y) => x.ham.bellek_detay.t0 - y.ham.bellek_detay.t0);
  const z = new Map(k.zaman.map((x) => [x[0], x]));
  satirlar.forEach((s, i) => {
    const b = s.ham.bellek_detay;
    const [, bas, bit] = z.get(s.tur);
    assert.equal(b.anon_ort_mb, 95, s.tur);
    assert.equal(b.baglanti_ort, 900);
    assert.deepEqual([b.baglanti_max, b.isci_max, b.kapanan_max], [900, 2, 0]);
    assert.deepEqual(b.son, { t: b.son.t, anon_mb: 95, shmem_mb: 74, file_mb: 20, pss_mb: 95 + 74 / 8, baglanti: 900 });
    // Saat farki: log ilk olcum = bas + 1 + isinma -> fark 1 -> hedef - yuk = -1; taban = bas - 1'den onceki son ornek.
    assert.equal(b.taban.t, bas - 1 + 0.25 - 1, `${s.tur} taban ani`);
    assert.deepEqual([b.taban.anon_mb, b.taban.shmem_mb, b.taban.baglanti], [40, i === 0 ? 10 : 74, 4], s.tur);
    assert.deepEqual([b.dinlenme.anon_mb, b.dinlenme.baglanti], [40, 4], s.tur);
    if (i < satirlar.length - 1) {
      const sonraki = z.get(satirlar[i + 1].tur)[1];
      assert.ok(b.dinlenme.t < sonraki - 1 && b.dinlenme.t >= bit - 1 + 3, `${s.tur} dinlenme ${b.dinlenme.t} (bit ${bit}, sonraki ${sonraki})`);
      assert.equal(b.dinlenme_sn, b.dinlenme.t - (bit - 1));
    } else {
      assert.ok(b.dinlenme_sn >= 3, 'son adim: kaydin sonuna kadar');
    }
  });
  // Bilgi alanlari disinda analiz AYNI.
  assert.deepEqual(yeniAlanlarsiz(a), yeniAlanlarsiz((await analizEt(k)).analiz));
  // Serbest: hedef bdetay yok sayilir.
  const k3 = standart('R133');
  const sr = (await analizEt(k3, (d) => bdetayEkle(k3, d), { hedefTuru: 'serbest' })).analiz;
  assert.ok(sr.adimlar.every((s) => !('bellek_detay' in s.ham)) && !('bdetay_kesitler' in sr.ozet));
});

test('AB5 karisik surum: eski Portal (125f5ea) yeni dosyalari atlar; yeni Portal eski dizinde eskiyle bayt bayt ayni', async (t) => {
  const { execFileSync } = require('node:child_process');
  const kok = path.join(__dirname, '..', '..', '..');
  const eskiDizin = path.join(KOK, 'eski-portal');
  try {
    fs.mkdirSync(eskiDizin, { recursive: true });
    for (const ad of ['sonuc.cjs', 'analiz.cjs']) {
      fs.writeFileSync(path.join(eskiDizin, ad), execFileSync('git', ['show', `125f5ea:server/nginx-loadtest/${ad}`], { cwd: kok }));
    }
  } catch (e) {
    t.skip(`125f5ea okunamadi (git yok ya da sig klon): ${e.message}`);
    return;
  }
  const eskiSonuc = require(path.join(eskiDizin, 'sonuc.cjs'));
  const eskiAnaliz = require(path.join(eskiDizin, 'analiz.cjs'));
  assert.ok(!/ag_|bdetay_/.test(fs.readFileSync(path.join(eskiDizin, 'sonuc.cjs'), 'utf8')), 'eski okuyucu ag_ / bdetay_ desenini taniyor olmamali');
  const k = standart('R134');
  const dYeni = portalDuzeniYaz(path.join(KOK, 'ks-yeni'), bdetayEkle(k, agEkle(k, k.dosyalar({}))));
  const dEski = portalDuzeniYaz(path.join(KOK, 'ks-eski'), k.dosyalar({}));
  const sums = fs.readFileSync(path.join(dYeni, 'SHA256SUMS'), 'utf8');
  for (const ad of ['ag_R134_test.csv', 'ag_R134_test.txt', 'ag_R134_ymak01.csv', 'bdetay_R134_test.csv']) assert.ok(sums.includes(`  ${ad}\n`), `${ad} SHA256SUMS'ta`);
  const temiz = (an) => ({ ...an, ozet: { ...an.ozet, okunan_bayt: null, sha256: null } });
  const aE = eskiAnaliz.kosuAnaliz(await eskiSonuc.kosuDiziniOku(dEski, { adim: 'R134' }), { adim: 'R134' });
  const vY = await eskiSonuc.kosuDiziniOku(dYeni, { adim: 'R134' });
  assert.equal(vY.sha256.durum, 'dogrulandi');
  // istemci JSON'daki ag_* anahtarlari eski okuyucuda yalniz ozetlenir / kodlama icin okunur: analiz ayni.
  assert.deepEqual(temiz(eskiAnaliz.kosuAnaliz(vY, { adim: 'R134' })), temiz(aE), 'eski Portal: yeni dosyalarla analiz ayni');
  const nE = kosuAnaliz(await kosuDiziniOku(dEski, { adim: 'R134' }), { adim: 'R134' });
  assert.equal(JSON.stringify(temiz(nE)), JSON.stringify(temiz(aE)), 'yeni Portal eski playbook dizininde eski ciktiyi BAYT BAYT uretir');
});

test('AB6 gorunum: ag / bellekDetay camelCase, eski null; neden kurallari; sizinti birlesik; agBosta', () => {
  const { adimGorunumu, agGorunumu, bellekDetayGorunumu, bellekNedenleri, bellekSizinti, sonucOzeti, BELLEK_NEDEN_ESIKLERI: E } = gorunum;
  const eski = adimGorunumu({ tur: 'R1_K_ka_br_100_r1', ham: { uyarilar: [] }, nedenler: [] });
  assert.deepEqual([eski.ag, eski.bellekDetay], [null, null]);
  assert.equal(agGorunumu({ test_alinan_bps: null, hedef: null, yuk: { rx_ort_bps: null } }), null);
  assert.deepEqual(agGorunumu({ test_alinan_bps: 8e6, test_gonderilen_bps: null, hedef: { rx_ort_bps: 1, tx_ort_bps: 2, rx_max_bps: 3, tx_max_bps: 4, hiz_mbps: 100, kullanim_max_yuzde: 0.1, arayuz: 'bond0', secim: 'hedef_ip' } }), {
    testAlinanBps: 8e6, testGonderilenBps: null, yuk: null,
    hedef: { rxOrtBps: 1, txOrtBps: 2, rxMaxBps: 3, txMaxBps: 4, hizMbps: 100, kullanimMaxYuzde: 0.1, arayuz: 'bond0', secim: 'hedef_ip' },
  });
  const nokta = (anon, shmem, file, bag, t = 0) => ({ t, anon_mb: anon, shmem_mb: shmem, file_mb: file, pss_mb: anon, baglanti: bag });
  const det = (taban, son, dinlenme, ek = {}) => bellekDetayGorunumu({ t0: 1, anon_ort_mb: 90, pss_ort_mb: 90, baglanti_ort: 900, baglanti_max: 950, isci_max: 2, kapanan_max: 0, taban, son, dinlenme, dinlenme_sn: 10, ...ek });
  // tampon: Anon +55, dinlenmede -47 (>= yarisi), baglanti yukte fazla
  assert.deepEqual(det(nokta(40, 74, 20, 4), nokta(95, 74, 20, 900), nokta(48, 74, 20, 6)).nedenler, ['tampon']);
  // esik siniri: tam ANON_MB artis ve tam yarisi inis -> tampon; ANON_MB alti -> artis_yok
  assert.deepEqual(bellekNedenleri(det(nokta(40, 74, 20, 4), nokta(40 + E.ANON_MB, 74, 20, 900), nokta(40 + E.ANON_MB / 2, 74, 20, 6))), ['tampon']);
  assert.deepEqual(det(nokta(40, 74, 20, 4), nokta(40 + E.ANON_MB - 0.01, 74, 20, 900), nokta(40, 74, 20, 6)).nedenler, ['artis_yok']);
  // anon_kalici: artti, dinlenmede inmedi
  assert.deepEqual(det(nokta(40, 74, 20, 4), nokta(95, 74, 20, 900), nokta(90, 74, 20, 6)).nedenler, ['anon_kalici']);
  // paylasilan (plato) + dosya; dinlenmede Shmem indiyse paylasilan degil
  assert.deepEqual(det(nokta(40, 10, 20, 4), nokta(41, 74, 25, 900), nokta(40, 74, 25, 6)).nedenler, ['paylasilan', 'dosya']);
  assert.deepEqual(det(nokta(40, 10, 20, 4), nokta(41, 74, 20, 900), nokta(40, 70, 20, 6)).nedenler, ['artis_yok']);
  assert.deepEqual(det(nokta(40, 10, 20, 4), nokta(41, 10 + E.SHMEM_MB, 20, 900), null).nedenler, ['paylasilan'], 'dinlenme yok: plato varsayilir');
  // reload
  assert.deepEqual(det(nokta(40, 74, 20, 4), nokta(41, 74, 20, 900), nokta(40, 74, 20, 6), { kapanan_max: 2 }).nedenler, ['reload']);
  assert.equal(bellekDetayGorunumu({ t0: 1 }), null, 'son noktasi yok: null');
  // Sizinti: dinlenme Anon 48 -> 61 -> 77 (artan, kalici), baglanti sabit -> olasi_sizinti (anon)
  const adim = (t0, taban, son, din, bag = 900) => ({ bellekDetay: det(nokta(taban, 74, 20, 4), nokta(son, 74, 20, bag), nokta(din, 74, 20, 6), { t0, baglanti_ort: bag }) });
  const sz = [adim(3, 52, 64, 61), adim(1, 40, 50, 48), adim(5, 61, 80, 77)];
  assert.deepEqual(bellekSizinti(sz, []), { durum: 'olasi_sizinti', kaynak: 'anon', rssUyarisi: null });
  const rss = 'nginx_bellek_artisi(ilk=100MB,son=200MB,kosu_sonu=210MB)';
  assert.deepEqual(bellekSizinti(sz, [rss]), { durum: 'olasi_sizinti', kaynak: 'anon', rssUyarisi: rss });
  // dinlenmede indi (tampon): RSS uyarisi olsa da Anon kaynakli degil
  const tampon = [adim(1, 40, 95, 41), adim(2, 41, 96, 42)];
  assert.deepEqual(bellekSizinti(tampon, [rss]), { durum: 'rss_artisi_anon_degil', kaynak: 'anon', rssUyarisi: rss });
  assert.equal(bellekSizinti(tampon, []), null);
  // baglanti artiyor (x2): sabit degil -> sizinti degil
  assert.equal(bellekSizinti([adim(1, 40, 50, 48, 400), adim(3, 52, 64, 61, 900), adim(5, 61, 80, 77, 900)], []), null);
  // toplam artis esik alti (ilk 40 -> son 48: 8 MB < 10)
  assert.equal(bellekSizinti([adim(1, 40, 46, 45), adim(2, 45, 49, 48)], []), null);
  // Anon olcumu yok + RSS uyarisi: olasi_sizinti (rss)
  assert.deepEqual(bellekSizinti([{ bellekDetay: null }], [rss]), { durum: 'olasi_sizinti', kaynak: 'rss', rssUyarisi: rss });
  // sonucOzeti: agBosta camelCase + bellekSizinti
  const o = sonucOzeti(sz.map((x, i) => ({ tur: `R1_a_${i}`, gecerlilik: 'GECERLI', ...x })), { ag_bosta: { hedef: { rx_bps: 1e6, tx_bps: 2e6, sn: 58, hiz_mbps: 100, arayuz: 'bond0', secim: 'hedef_ip' }, yuk: null } }, []);
  assert.deepEqual(o.agBosta, { hedef: { rxBps: 1e6, txBps: 2e6, sn: 58, hizMbps: 100, arayuz: 'bond0', secim: 'hedef_ip' }, yuk: null });
  assert.equal(o.bellekSizinti.durum, 'olasi_sizinti');
});

test('AB7 uctan: analizin ham.bellek_detay alani gorunumde tampon / paylasilan nedenine cevrilir', async () => {
  const k = standart('R135');
  const { analiz: a } = await analizEt(k, (d) => bdetayEkle(k, d));
  const g = a.adimlar.map((s) => gorunum.adimGorunumu({ tur: s.tur, ham: s.ham, nedenler: s.nedenler }));
  g.sort((x, y) => x.bellekDetay.t0 - y.bellekDetay.t0);
  assert.deepEqual(g.map((x) => x.bellekDetay.nedenler), [['tampon', 'paylasilan'], ['tampon'], ['tampon'], ['tampon'], ['tampon'], ['tampon']]);
  assert.equal(gorunum.bellekSizinti(g, a.uyarilar), null);
  // Anon her adimda kalici artar (dinlenmede inmez), baglanti sabit -> kosu duzeyinde olasi sizinti.
  const ilk = Math.min(...k.zaman.map((x) => x[1]));
  const { analiz: s } = await analizEt(k, (d) => bdetayEkle(k, d, { anon: (t) => 40 * 1024 + Math.max(0, t - ilk) * 50 }));
  const gs = s.adimlar.map((x) => gorunum.adimGorunumu({ tur: x.tur, ham: x.ham, nedenler: x.nedenler }));
  assert.deepEqual(gorunum.bellekSizinti(gs, s.uyarilar).durum, 'olasi_sizinti');
});

// ---------------------------------------------------------------------------------------------
// 2026-11-04: inceleme bulgulari (B1-B9) ve mutasyon kor noktalari.
//   AB8  gorunum bellekNedenleri / bellekSizinti: anon_artti_dinlenme_yok (B2), isci_degisti (B5), belirsiz (B1: rampa,
//        tek adim, taban yok, anon inmedi), sizinti kurali kosullari tek tek (artan, kalici, oran, tum adimlar, taban)
//   AB9  analiz NIC: kayan pencere tepesi (B3: tam saniyelik epoch + 1,4 sn dongu sahte uyari vermez; ani yukselme tepeye
//        girer), esik %70 siniri, hiz 0 -> null, kesit adi secimi, yuk penceresi isinmayi disarida birakir
//   AB10 analiz bosta taban (B6: hedef saat farkiyla; ofs null -> hedef yok; en kisa sure) ve bdetay (dinlenme en kisa
//        bosluk, isci_degisti taban / dinlenme); uctan: saat farki tavani, log satiri yok
//   AB11 okuma: ag_ / bdetay_ G/C hatasi kosuyu OKUNAMADI yapmaz; 64 bit esigi; ozet.ag_kesitler kaydedici maliyeti (B4);
//        hedef rol suzgeci (yuk kesiti bosta hedef tabanina girmez)
// ---------------------------------------------------------------------------------------------
const { _agBellekForTest: AB } = require('../analiz.cjs');

test('AB8 gorunum: B1 belirsiz, B2 anon_artti_dinlenme_yok, B5 isci_degisti; sizinti kosullari', () => {
  const { bellekDetayGorunumu, bellekNedenleri, bellekSizinti, agGorunumu, BELLEK_NEDEN_ESIKLERI: E } = gorunum;
  const nokta = (anon, shmem, file, bag, t = 0) => ({ t, anon_mb: anon, shmem_mb: shmem, file_mb: file, pss_mb: anon, baglanti: bag });
  const det = (taban, son, dinlenme, ek = {}) => bellekDetayGorunumu({ t0: 1, anon_ort_mb: 90, pss_ort_mb: 90, baglanti_ort: 900, baglanti_max: 950, isci_max: 2, kapanan_max: 0, taban, son, dinlenme, dinlenme_sn: 10, ...ek });
  // B2: Anon +40 MB, dinlenme olculmedi -> 'artis_yok' DEGIL
  assert.deepEqual(det(nokta(40, 74, 20, 4), nokta(80, 74, 20, 900), null).nedenler, ['anon_artti_dinlenme_yok']);
  assert.deepEqual(det(nokta(40, 74, 20, 4), nokta(40 + E.ANON_MB - 0.01, 74, 20, 900), null).nedenler, ['artis_yok'], 'esik alti: artis_yok');
  // Anon olculmedi (taban / son null), baska neden yok: bos liste (artis_yok degil)
  assert.deepEqual(det(nokta(null, 74, 20, 4), nokta(null, 74, 20, 900), nokta(null, 74, 20, 6)).nedenler, []);
  // Baglanti tabandan fazla degil: inis olsa da tampon degil anon_kalici
  assert.deepEqual(det(nokta(40, 74, 20, 900), nokta(95, 74, 20, 900), nokta(41, 74, 20, 6), { baglanti_ort: 900 }).nedenler, ['anon_kalici']);
  // B5: taban ile son arasinda worker degisti -> yalniz isci_degisti; dinlenmede degisti -> dinlenme yok sayilir
  assert.deepEqual(det(nokta(40, 10, 20, 4), nokta(95, 74, 25, 900), nokta(41, 74, 25, 6), { taban_isci_degisti: true }).nedenler, ['isci_degisti']);
  assert.deepEqual(det(nokta(40, 74, 20, 4), nokta(95, 74, 20, 900), nokta(41, 74, 20, 6), { dinlenme_isci_degisti: true }).nedenler, ['isci_degisti', 'anon_artti_dinlenme_yok']);
  assert.deepEqual(det(nokta(40, 74, 20, 4), nokta(95, 74, 20, 900), nokta(41, 74, 20, 6), { taban_isci_degisti: false, dinlenme_isci_degisti: false }).nedenler, ['tampon']);
  assert.equal(det(nokta(40, 74, 20, 4), nokta(95, 74, 20, 900), null, { taban_isci_degisti: 'evet' }).tabanIsciDegisti, null, 'bool disi: olculmedi');
  assert.deepEqual(bellekNedenleri(null), []);
  // Sizinti kurali
  const adim = (t0, taban, son, din, bag = 900, ek = {}) => ({ bellekDetay: det(nokta(taban, 74, 20, 4), nokta(son, 74, 20, bag), din === null ? null : nokta(din, 74, 20, 6), { t0, baglanti_ort: bag, ...ek }) });
  const rss = 'nginx_bellek_artisi(ilk=100MB,son=200MB,kosu_sonu=210MB)';
  // B1 rampa: dinlenme Anon 58 -> 108 -> 168, baglanti x5 -> belirsiz (baglanti_degisti); RSS'siz null
  const rampa = [adim(1, 50, 70, 58, 200), adim(2, 58, 120, 108, 600), adim(3, 108, 180, 168, 1000)];
  assert.deepEqual(bellekSizinti(rampa, [rss]), { durum: 'belirsiz', kaynak: 'anon', rssUyarisi: rss, neden: 'baglanti_degisti' });
  assert.equal(bellekSizinti(rampa, []), null);
  // B1 tek adim, dinlenme yok
  assert.deepEqual(bellekSizinti([adim(1, 40, 95, null)], [rss]), { durum: 'belirsiz', kaynak: 'anon', rssUyarisi: rss, neden: 'dinlenme_yok' });
  // bir adimin dinlenmesinde worker degisti: dinlenme yok sayilir
  assert.equal(bellekSizinti([adim(1, 40, 95, 41), adim(2, 41, 96, 42, 900, { dinlenme_isci_degisti: true })], [rss]).neden, 'dinlenme_yok');
  // taban yok
  assert.equal(bellekSizinti([{ bellekDetay: det(null, nokta(95, 74, 20, 900), nokta(41, 74, 20, 6)) }], [rss]).neden, 'taban_yok');
  // ilk adimin tabaninda worker degisti: taban yok sayilir
  assert.equal(bellekSizinti([adim(1, 40, 95, 41, 900, { taban_isci_degisti: true })], [rss]).neden, 'taban_yok');
  // baglanti sabit, Anon tabana inmedi ama artan da degil -> anon_inmedi
  assert.equal(bellekSizinti([adim(1, 40, 95, 70), adim(2, 70, 96, 60)], [rss]).neden, 'anon_inmedi');
  // tek adim, dinlenme tabana indi -> rss_artisi_anon_degil (esik siniri dahil)
  assert.equal(bellekSizinti([adim(1, 40, 95, 40 + E.ANON_MB)], [rss]).durum, 'rss_artisi_anon_degil');
  assert.equal(bellekSizinti([adim(1, 40, 95, 40 + E.ANON_MB + 0.01)], [rss]).durum, 'belirsiz');
  // kosullar: artmayan (48 -> 77 -> 61), kalici degil (dinlenme < %90 son), oran alti (500 MB'de +20), son adimda dinlenme yok
  assert.equal(bellekSizinti([adim(1, 40, 50, 48), adim(2, 48, 80, 77), adim(3, 77, 64, 61)], []), null, 'artan degil');
  assert.equal(bellekSizinti([adim(1, 40, 50, 48), adim(2, 48, 80, 61), adim(3, 61, 80, 77)], []), null, 'kalici degil (61 < 0,9 x 80)');
  assert.equal(bellekSizinti([adim(1, 500, 505, 505), adim(2, 505, 512, 510), adim(3, 510, 522, 520)], []), null, 'oran esik alti (20 < %10 x 500)');
  assert.equal(bellekSizinti([adim(1, 500, 505, 505), adim(2, 505, 512, 510), adim(3, 510, 562, 560)], []).durum, 'olasi_sizinti', 'oran esik ustu (60 >= 50)');
  assert.equal(bellekSizinti([adim(1, 40, 50, 48), adim(3, 52, 64, 61), adim(5, 61, 80, null)], []), null, 'son adimda dinlenme yok');
  // ilk deger taban: taban 40, dinlenme 45 -> 48 -> 51 (taban'dan +11 >= 10; ilk dinlenmeden +6 olurdu)
  assert.equal(bellekSizinti([adim(1, 40, 46, 45), adim(2, 45, 50, 48), adim(3, 48, 53, 51)], []).durum, 'olasi_sizinti');
  // N69: yalniz tx olculmus NIC nesne doner
  assert.deepEqual(agGorunumu({ hedef: { rx_ort_bps: null, tx_ort_bps: 5 } }).hedef.txOrtBps, 5);
});

/** Kumulatif ornek uretici: gercek zamanlar, hiz(t) B/sn (0,01 sn adimla tumlenir); epoch `yuvarla` ile yazilir. */
function nicOrnekler(gercekler, hiz, yuvarla = (x) => x) {
  const o = [];
  let rx = 0;
  let once = null;
  for (const g of gercekler) {
    if (once !== null) {
      const n = Math.round((g - once) / 0.01);
      for (let i = 0; i < n; i++) rx += hiz(once + i * 0.01) * 0.01;
    }
    once = g;
    o.push({ t: yuvarla(g), rx: Math.round(rx), tx: 0 });
  }
  return o;
}
const nicKesit = (anahtar, ornekler, bilgi = {}) => ({ anahtar, ornekler, bilgi: { rol: 'hedef', arayuz: 'bond0', secim: 'hedef_ip', hiz_mbps: '1000', ...bilgi } });
const agCtx = (o = {}) => ({ istemciAg: new Map(), agHedef: [], agYuk: [], ...o });

test('AB9 analiz NIC: kayan pencere tepesi (B3), esik %70, hiz 0, kesit secimi, yuk isinma kaydirmasi', () => {
  // B3: tam saniyelik epoch, gercek dongu 1,4 sn, 550 Mbps sabit: ardisik farkla %77 (sahte uyari); kayan pencereyle < %70
  const gercek = Array.from({ length: 80 }, (_, i) => 1000 + 1.4 * i);
  const k = nicKesit('H', nicOrnekler(gercek, () => 550e6 / 8, Math.floor));
  const u = [];
  const o = AB.agOlc(agCtx({ agHedef: [k] }), 'T', 'H', 1000, 1110, null, 0, u);
  assert.deepEqual(u, [], `sahte uyari: ${u}`);
  assert.ok(o.hedef.kullanim_max_yuzde > 50 && o.hedef.kullanim_max_yuzde < 70, `kullanim ${o.hedef.kullanim_max_yuzde}`);
  // Ani yukselme: 10 sn 60 Mbps (taban 10 Mbps), 100 Mbps arayuz -> kullanim tepeden (%60), ortalamadan degil
  const ts = Array.from({ length: 101 }, (_, i) => 2000 + i + 0.5);
  const s = AB.nicOlc(nicKesit('H', nicOrnekler(ts, (x) => (x >= 2040 && x < 2050 ? 60e6 : 10e6) / 8), { hiz_mbps: '100' }), 2000, 2101);
  assert.ok(Math.abs(s.kullanim_max_yuzde - 60) < 0.5, `tepe ${s.kullanim_max_yuzde}`);
  assert.ok(s.rx_ort_bps < 20e6, 'ortalama dusuk');
  // Pencere AG_TEPE_SN'den kisa: tepe null (kullanim ortalamadan)
  const kisa = AB.nicPencere([{ t: 1, rx: 0, tx: 0 }, { t: 1 + AB.AG_TEPE_SN - 1, rx: 100, tx: 0 }], 0, 100);
  assert.deepEqual([kisa.rx_max_bps, kisa.rx_ort_bps], [null, 200]);
  // Esik: tam %70,0 uyari yok; %75 uyari
  const dz = Array.from({ length: 101 }, (_, i) => ({ t: 2000 + i, rx: i * 1750000, tx: 0 }));
  const e1 = [];
  const r1 = AB.agOlc(agCtx({ agHedef: [nicKesit('H', dz, { hiz_mbps: '20' })] }), 'T', 'H', 2000, 2101, null, 0, e1);
  assert.equal(r1.hedef.kullanim_max_yuzde, 70, 'tam esik (14 / 20 Mbps)');
  assert.deepEqual(e1, []);
  const d75 = dz.map((x, i) => ({ ...x, rx: i * 1875000 }));
  const e2 = [];
  AB.agOlc(agCtx({ agHedef: [nicKesit('H', d75, { hiz_mbps: '20' })] }), 'T', 'H', 2000, 2101, null, 0, e2);
  assert.deepEqual(e2, ['ag_kullanim_yuksek(hedef,%75.0)']);
  // hiz 0 (sanal NIC): hiz / kullanim null, uyari yok
  const e3 = [];
  const r3 = AB.agOlc(agCtx({ agHedef: [nicKesit('H', d75, { hiz_mbps: '0' })] }), 'T', 'H', 2000, 2101, null, 0, e3);
  assert.deepEqual([r3.hedef.hiz_mbps, r3.hedef.kullanim_max_yuzde, e3], [null, null, []]);
  // Kesit adi: ikinci hedef kesiti (_2) kendi hiziyla
  const r4 = AB.agOlc(agCtx({ agHedef: [nicKesit('H', d75, { hiz_mbps: '20' }), nicKesit('H_2', d75, { hiz_mbps: '1000' })] }), 'T', 'H_2', 2000, 2101, null, 0, []);
  assert.equal(r4.hedef.hiz_mbps, 1000);
  // Yuk penceresi: zaman [3000, 3100], isinma 30 -> [3033, 3098]; isinmada 80 Mbps, sonra 8 Mbps
  const yts = Array.from({ length: 121 }, (_, i) => 2990 + i + 0.5);
  const yk = nicKesit('Y', nicOrnekler(yts, (x) => (x < 3030 ? 80e6 : 8e6) / 8), { rol: 'yuk' });
  const r5 = AB.agOlc(agCtx({ agYuk: [yk] }), 'T', null, null, null, [3000, 3100], 30, []);
  assert.ok(Math.abs(r5.yuk.rx_ort_bps - 8e6) < 1e5, `yuk ort isinmasiz ${r5.yuk.rx_ort_bps}`);
});

test('AB10 analiz bosta taban (B6) ve bdetay (dinlenme, isci_degisti); uctan saat farki tavani / log yok', async () => {
  // Hedef saati 20 sn geride (ofs -20): yuk hedef saatinde ilkBas - 20'de baslar
  const ts = Array.from({ length: 200 }, (_, i) => 900 + i + 0.5);
  const ilk = 1060;
  const hd = nicKesit('H', nicOrnekler(ts, (x) => (x >= ilk - 20 ? 80e6 : 1e6) / 8));
  const yk = nicKesit('Y', nicOrnekler(ts, (x) => (x >= ilk ? 80e6 : 2e6) / 8), { rol: 'yuk' });
  const c = { agHedef: [hd], agYuk: [yk] };
  const b = AB.agBosta(c, ilk, -20);
  assert.ok(Math.abs(b.hedef.rx_bps - 1e6) < 2e4, `hedef bosta ${b.hedef.rx_bps}`);
  assert.ok(Math.abs(b.yuk.rx_bps - 2e6) < 2e4, `yuk bosta ${b.yuk.rx_bps}`);
  const bn = AB.agBosta(c, ilk, null);
  assert.deepEqual([bn.hedef, bn.yuk !== null], [null, true], 'ofs null: hedef tabani yok');
  // En kisa sure: kayit ilk adimdan 3 sn once basliyor -> null
  assert.equal(AB.agBosta({ agHedef: [nicKesit('H', [{ t: ilk - 3, rx: 0, tx: 0 }, { t: ilk - 2.5, rx: 1, tx: 0 }, { t: ilk - 2.1, rx: 2, tx: 0 }])], agYuk: [] }, ilk, 0), null);
  // bdetay: adim [1000, 1060], sonraki 1062'de -> bosluk 2 sn: dinlenme yok
  const bd = (t, k = 0, an = 40 * 1024) => ({ t, n: 2, k, an, sh: 0, fi: 0, pss: an, mr: 1, mp: null, bg: 4 });
  const ornek = Array.from({ length: 200 }, (_, i) => bd(950 + i));
  const sun = (degis) => ({ anahtar: 'H', ornekler: ornek.map((x) => ({ t: x.t, k: 0, p: degis && x.t >= degis ? '201+202' : '101+102' })) });
  const ctx = (zamanTum, kesitler = [sun(null)], ekOrnek = ornek) => ({ bdetayKesitler: [{ anahtar: 'H', ornekler: ekOrnek }], zamanTum, kesitler });
  const z1 = [['A', 1000, 1060], ['B', 1062, 1120]];
  const d1 = AB.bdetayOlc(ctx(z1), 'H', 1030, 1058, [1000, 1060], 0);
  assert.deepEqual([d1.dinlenme, d1.taban.t, d1.taban_isci_degisti, d1.dinlenme_isci_degisti], [null, 1000, false, null]);
  const z2 = [['A', 1000, 1060], ['B', 1080, 1120]];
  const d2 = AB.bdetayOlc(ctx(z2), 'H', 1030, 1058, [1000, 1060], 0);
  assert.deepEqual([d2.dinlenme.t, d2.dinlenme_sn, d2.dinlenme_isci_degisti], [1079, 19, false]);
  // B5: son ile dinlenme arasinda pid degisti; taban ile son arasinda degisti; tabanda shutting down worker
  assert.equal(AB.bdetayOlc(ctx(z2, [sun(1070)]), 'H', 1030, 1058, [1000, 1060], 0).dinlenme_isci_degisti, true);
  assert.equal(AB.bdetayOlc(ctx(z2, [sun(1040)]), 'H', 1030, 1058, [1000, 1060], 0).taban_isci_degisti, true);
  assert.equal(AB.bdetayOlc(ctx(z2, [sun(null)], ornek.map((x) => (x.t === 1000 ? bd(1000, 1) : x))), 'H', 1030, 1058, [1000, 1060], 0).taban_isci_degisti, true);
  // dinlenme orneginde shutting down worker (bdetay k); sunucu_ orneginde k > 0 (pid ayni)
  assert.equal(AB.bdetayOlc(ctx(z2, [sun(null)], ornek.map((x) => (x.t === 1079 ? bd(1079, 1) : x))), 'H', 1030, 1058, [1000, 1060], 0).dinlenme_isci_degisti, true);
  const sunK = { anahtar: 'H', ornekler: ornek.map((x) => ({ t: x.t, k: x.t === 1070 ? 1 : 0, p: '101+102' })) };
  assert.equal(AB.bdetayOlc(ctx(z2, [sunK]), 'H', 1030, 1058, [1000, 1060], 0).dinlenme_isci_degisti, true);
  assert.deepEqual([AB.isciDegisti({ kesitler: [] }, 'H', 1, 2), AB.isciDegisti({ kesitler: [sun(null)] }, 'H', 5000, 5001)], [null, null]);
  // Uctan: bir adimin log saati 120 sn kayik -> o adimda taban / dinlenme yok; log satiri yok -> saat farki 0, noktalar dolu
  const { Kurgu } = require('./fixtures/kurgu.cjs');
  const k = new Kurgu('R136');
  k.kosu({ hiz: 100 });
  k.kosu({ hiz: 250, kayma: 120 });
  k.kosu({ hiz: 400, bosluk: 200 });
  k.kosu({ hiz: 500 });
  const { analiz: a } = await analizEt(k, (d) => bdetayEkle(k, d));
  assert.ok(a.adimlar.some((s) => s.ham.bellek_detay && s.ham.bellek_detay.taban !== null), 'kaymayan adimlarda taban var');
  const kayik = a.adimlar.filter((s) => s.ham.uyarilar.some((u) => u.startsWith('saat_farki~')));
  assert.ok(kayik.length >= 1, 'kayik adim var');
  for (const s of kayik) assert.deepEqual([s.ham.bellek_detay && s.ham.bellek_detay.taban, s.ham.bellek_detay && s.ham.bellek_detay.dinlenme], [null, null], s.tur);
  const k2 = standart('R137');
  const dz = portalDuzeniYaz(path.join(KOK, `k-R137-${++sira}`), bdetayEkle(k2, k2.dosyalar({ logYok: true })));
  const a2 = kosuAnaliz(await kosuDiziniOku(dz, { adim: 'R137' }), { adim: 'R137' });
  const bds = a2.adimlar.map((s) => s.ham.bellek_detay).filter(Boolean);
  assert.ok(bds.length > 0 && bds.every((x) => x.taban !== null && x.dinlenme !== null), 'log yok: istemci saati, noktalar dolu');
});

test('AB11 okuma: ag_ / bdetay_ G/C hatasi kosuyu okutur; 64 bit esigi; ozet kaydedici maliyeti (B4); rol suzgeci', async (t) => {
  const asil = fs.createReadStream;
  const { Readable } = require('node:stream');
  t.mock.method(fs, 'createReadStream', function (yol, ...geri) {
    if (/(^|[\\/])(ag_R1_h\.csv|bdetay_R1_h\.csv)$/.test(String(yol))) {
      const r = new Readable({ read() {} });
      process.nextTick(() => r.destroy(Object.assign(new Error(`EIO: i/o error, read '${yol}'`), { code: 'EIO' })));
      return r;
    }
    return asil.call(fs, yol, ...geri);
  });
  const v = await kosuDiziniOku(yeniDizin({ 'ag_R1_h.csv': AG_BAS + '1,eth0,1,1\n', 'ag_R1_h.txt': 'rol=hedef\n', 'bdetay_R1_h.csv': BD_BAS }));
  assert.match(v.agKesitler[0].sorun, /EIO/);
  assert.match(v.bdetayKesitler[0].sorun, /EIO/);
  t.mock.restoreAll();
  // 64 bit esigi: once 2^62 civari (2^63 alti) geri gidis sarma degil sifirlama
  const o = { sarma: 0, sifirlama: 0 };
  assert.equal(sonuc._sayacFarkiForTest(2 ** 62 + 4096, 10, o), 0);
  assert.deepEqual(o, { sarma: 0, sifirlama: 1 });
  // Kaydedici maliyeti ag txt'den ozete (bilgi); yoksa null. Ek yuk kesiti (cok ornekli) hedef bosta tabanina girmez.
  const k = standart('R138');
  const { analiz: a } = await analizEt(k, (d) => {
    const m = agEkle(k, d);
    const ad = 'ag_R138_test.txt';
    m.set(ad, { ...m.get(ad), icerik: m.get(ad).icerik + 'kaydedici_cpu_ms=1234\nkaydedici_sure_sn=600\n' });
    const ya = 'ag_R138_ymak01.txt';
    m.set(ya, { ...m.get(ya), icerik: m.get(ya).icerik + 'kaydedici_cpu_ms=-5\nkaydedici_sure_sn=x\n' });
    const cok = Array.from({ length: 3000 }, (_, i) => `${T0 - 1000 + i}.5,eth9,${i * 999},0`).join('\n');
    m.set('ag_R138_ymak02.csv', dosya(AG_BAS + cok + '\n'));
    m.set('ag_R138_ymak02.txt', dosya('surum=1\nrol=yuk\nhost=ymak02\nsecim=ip_route\narayuz=eth9\nhiz_mbps=\n'));
    return m;
  });
  assert.deepEqual(a.ozet.ag_kesitler.map((x) => [x.anahtar, x.kaydedici_cpu_ms, x.kaydedici_sure_sn]), [['R138_test', 1234, 600], ['R138_ymak01', null, null], ['R138_ymak02', null, null]]);
  assert.equal(a.ozet.ag_bosta.hedef.arayuz, 'bond0', 'hedef tabani yalniz rol=hedef kesitinden');
});
