// server/nginx-loadtest/__tests__/sunucu-ayar.test.cjs - kosu oncesi sunucu ayari (2026-11-04).
//
// Kullanici: gece kuyruguyla 30 senaryo; http2 / comp_level / static / .gz .br elle degistirilmesin. Sozlesme: yuk_srv_*.
//   SA1 parametreler: yoksa null; kanonik nesne; br 1-11, gzip 1-9, identity seviyesiz; static boolean; dizin kurali;
//       serbest hedefte 400; h2 + sunucu ayari serbest (plan kapisi hedefin h2'sine bakmaz); wrk + ayar kabul
//   SA2 ekstraDegiskenler: 4 anahtar sonda, hep metin, ayarsizda 0/''/0/''; durdur kipinde '1' GITMEZ
//   SA3 son kapi: seviye / static / dizin / serbest / durdur ihlalleri; ayar 0 iken dolu alan ihlal; eksik anahtar ihlal
//   SA4 onKontrolDegerlendir: "on-sikistirilmis dosya" uyarisi sunucu ayarli kosuda kuyruk ogesini atlatmaz
//   SA5 sonuc.cjs: hazirlik_*.txt taninir (tab ya da =, CRLF, uyari satirlari); olmayan dizinde liste bos
//   SA6 analiz: kanit uyumlu -> gecerlilik degismez, ozet.sunucu_ayar; ayarsiz kosu cikti BIREBIR eskisi
//   SA7 analiz: kanit yok / http2 / ae / seviye / static / dizin / 0 dosya -> GECERSIZ sunucu_ayari_kanitsiz(...)
//   SA7b static kosu: disk_kanit ok degil / dosya_seviye yok ya da farkli (eski hazirlik.sh) -> GECERSIZ; static kapali aranmaz
//   SA7c gercek hazirlik dosyasi -> analiz -> rapor: static seviye ve disk kaniti kolonlari kanittan gelir
//   SA8 gorunum.sunucuAyari: ayarsizda null; kanit, geri alma; bilinmeyen geri alma durumu 'hata'
//   SA9 kuyruk: hazirlikPayiSn yalniz static; sure kapisi pay ile; zamanlama oge butce_sn'den
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dg = require('../dogrula.cjs');
const sonuc = require('../sonuc.cjs');
const { kosuAnaliz, NEDEN_KALIPLARI, NEDENLER } = require('../analiz.cjs');
const gorunum = require('../gorunum.cjs');
const rapor = require('../rapor.cjs');
const kuyruk = require('../kuyruk.cjs');
const { portalDuzeniYaz, standart } = require('./fixtures/kurgu.cjs');

const DIZIN = '/usr/nginx/applications/glomo/dist';
const SIMDI = 1800000000;
const KOK = fs.mkdtempSync(path.join(os.tmpdir(), 'yuktesti-srv-'));
after(() => fs.rmSync(KOK, { recursive: true, force: true }));

const par = (sunucuAyar, ek = {}, secenek = {}) => dg.parametreler({ ae: 'br', sunucuAyar, ...ek }, { sni: false, ...secenek });
const SENARYO = { tur: 'K', tsv: 'K\tjs\tkucuk\t1\t/a.js\n', sha256: '' };
SENARYO.sha256 = require('node:crypto').createHash('sha256').update(SENARYO.tsv, 'utf8').digest('hex');
const ARAC = { dizin: '/sw/BMW_PORTAL/nginx_loadtest/araclar/5', k6Sha256: 'a'.repeat(64), wrkSha256: 'b'.repeat(64) };
function ev(p, ek = {}) {
  return dg.ekstraDegiskenler({
    islem: 'kosu', kosuId: 17, hedefHost: 'GBNGXT33', yukHost: 'GBNGXT34', hedefIp: '10.0.0.5', vhost: 'app.test.local', senaryo: SENARYO, p,
    kok: '/sw/BMW_PORTAL/nginx_loadtest', arac: ARAC, simdiSn: SIMDI, ...ek,
  });
}
const den = (x) => dg.ekstraDegiskenleriDenetle(x, { simdiSn: SIMDI });

test('SA1 parametreler: kanonik nesne ve kurallar', () => {
  assert.equal(dg.parametreler({}, { sni: false }).deger.sunucuAyar, null, 'alan yok -> null');
  assert.equal(par(null).deger.sunucuAyar, null);
  assert.deepEqual(par({ seviye: 6, static: true, dizin: DIZIN }).deger.sunucuAyar, { seviye: 6, static: true, dizin: DIZIN });
  // Fazla alan kanonik nesneye GIRMEZ; metin seviye sayiya doner; static yoksa false.
  assert.deepEqual(par({ seviye: '11', dizin: DIZIN, x: 1 }).deger.sunucuAyar, { seviye: 11, static: false, dizin: DIZIN });
  assert.deepEqual(par({ seviye: 9, dizin: DIZIN }, { ae: 'gzip' }).deger.sunucuAyar, { seviye: 9, static: false, dizin: DIZIN });
  assert.deepEqual(par({ static: true, dizin: DIZIN }, { ae: 'identity' }).deger.sunucuAyar, { seviye: null, static: true, dizin: DIZIN });
  const ret = (r, re) => {
    assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'gecersiz_istek'], JSON.stringify(r));
    assert.match(r.message, re);
  };
  ret(par('evet'), /nesne/);
  ret(par([]), /nesne/);
  ret(par({ seviye: 12, dizin: DIZIN }), /brotli için 1–11/);
  ret(par({ seviye: 0, dizin: DIZIN }), /brotli için 1–11/);
  ret(par({ dizin: DIZIN }), /brotli için 1–11/);
  ret(par({ seviye: 10, dizin: DIZIN }, { ae: 'gzip' }), /gzip için 1–9/);
  ret(par({ seviye: 2.5, dizin: DIZIN }, { ae: 'gzip' }), /gzip için 1–9/);
  ret(par({ seviye: 1, dizin: DIZIN }, { ae: 'identity' }), /identity/);
  ret(par({ seviye: 6, static: 'evet', dizin: DIZIN }), /static/);
  for (const d of ['', undefined, '/usr/nginx/applications', '/usr/nginx/applications/', '/usr/nginx/conf', '/usr/nginx/applications/a/../../conf', '/usr/nginx/applications/a..b', '/usr/nginx/applications/a b', '/usr/nginx/applications/a/', '/usr/nginx/applications/a\n', '/usr/nginx/applications/a;rm']) {
    ret(par({ seviye: 6, dizin: d }), /applications/);
  }
  ret(par({ seviye: 6, dizin: DIZIN }, {}, { hedefTuru: 'serbest' }), /serbest/);
  // Plan kapisi hedefin h2'sine BAKMAZ (kutu acikken h2 serbest); wrk + h2 ve h2 + yeni kurallari aynen.
  assert.equal(par({ seviye: 6, dizin: DIZIN }, { protokol: 'h2', kip: 'ka' }).ok, true);
  assert.equal(par({ seviye: 6, dizin: DIZIN }, { protokol: 'h2', kip: 'yeni' }).ok, false);
  assert.equal(par({ seviye: 6, dizin: DIZIN }, { motor: 'wrk', protokol: 'h2' }).ok, false);
  assert.deepEqual(par({ seviye: 6, dizin: DIZIN }, { motor: 'wrk' }).deger.sunucuAyar, { seviye: 6, static: false, dizin: DIZIN });
  // Imza: sunucu ayari farkli -> kanonik JSON farkli (on kontrol eskir).
  assert.notEqual(JSON.stringify(par({ seviye: 6, dizin: DIZIN }).deger), JSON.stringify(par({ seviye: 7, dizin: DIZIN }).deger));
});

test('SA2 ekstraDegiskenler: anahtarlar, ayarsiz varsayilan, durdurda 1 gitmez', () => {
  assert.deepEqual(dg.EKSTRA_ANAHTARLAR.slice(33), ['yuk_protokol', 'yuk_srv_ayar', 'yuk_srv_seviye', 'yuk_srv_static', 'yuk_srv_dizin']);
  const srv = (e) => [e.yuk_srv_ayar, e.yuk_srv_seviye, e.yuk_srv_static, e.yuk_srv_dizin];
  const ayarsiz = ev(par(null).deger);
  assert.deepEqual(srv(ayarsiz), ['0', '', '0', '']);
  assert.deepEqual(den(ayarsiz), []);
  const eski = { ...par(null).deger };
  delete eski.sunucuAyar;
  assert.deepEqual(srv(ev(eski)), ['0', '', '0', ''], 'alani olmayan eski satir');
  const br = ev(par({ seviye: 6, static: true, dizin: DIZIN }).deger);
  assert.deepEqual(srv(br), ['1', '6', '1', DIZIN]);
  assert.deepEqual(den(br), []);
  const id = ev(par({ dizin: DIZIN }, { ae: 'identity' }).deger, { islem: 'on_kontrol' });
  assert.deepEqual(srv(id), ['1', '', '0', DIZIN]);
  assert.deepEqual(den(id), []);
  const dur = ev(par({ seviye: 6, static: true, dizin: DIZIN }).deger, { islem: 'durdur', arac: null });
  assert.deepEqual(srv(dur), ['0', '', '0', ''], 'playbook durdur kipinde ayar 1 reddeder');
  assert.deepEqual(den(dur), []);
});

test('SA3 son kapi: playbook kapisiyla ayni kurallar', () => {
  const tamam = ev(par({ seviye: 6, static: true, dizin: DIZIN }).deger);
  const ihlal = (ek, taban = tamam) => den({ ...taban, ...ek });
  assert.deepEqual(ihlal({ yuk_srv_ayar: '2' }), ['yuk_srv_ayar']);
  assert.deepEqual(ihlal({ yuk_srv_seviye: '12' }), ['yuk_srv_seviye']);
  assert.deepEqual(ihlal({ yuk_srv_seviye: '0' }), ['yuk_srv_seviye']);
  assert.deepEqual(ihlal({ yuk_srv_seviye: '' }), ['yuk_srv_seviye']);
  assert.deepEqual(ihlal({ yuk_srv_seviye: 6 }), ['yuk_srv_seviye'], 'metin olmali');
  assert.deepEqual(ihlal({ yuk_srv_static: '' }), ['yuk_srv_static']);
  assert.deepEqual(ihlal({ yuk_srv_dizin: '' }), ['yuk_srv_dizin']);
  assert.deepEqual(ihlal({ yuk_srv_dizin: '/usr/nginx/applications/a/../b' }), ['yuk_srv_dizin']);
  assert.deepEqual(ihlal({ yuk_srv_dizin: '/etc' }), ['yuk_srv_dizin']);
  const gz = ev(par({ seviye: 9, dizin: DIZIN }, { ae: 'gzip' }).deger);
  assert.deepEqual(den(gz), []);
  assert.deepEqual(den({ ...gz, yuk_srv_seviye: '10' }), ['yuk_srv_seviye'], 'gzip en cok 9');
  const id = ev(par({ dizin: DIZIN }, { ae: 'identity' }).deger);
  assert.deepEqual(den({ ...id, yuk_srv_seviye: '1' }), ['yuk_srv_seviye'], 'identity seviyesiz');
  const yok = ev(par(null).deger);
  assert.deepEqual(den({ ...yok, yuk_srv_seviye: '6' }), ['yuk_srv_seviye']);
  assert.deepEqual(den({ ...yok, yuk_srv_static: '1' }), ['yuk_srv_static']);
  assert.deepEqual(den({ ...yok, yuk_srv_dizin: DIZIN }), ['yuk_srv_dizin']);
  const serbest = ev(dg.parametreler({}, { sni: false, hedefTuru: 'serbest' }).deger, { hedefTuru: 'serbest', hedefIp: '10.20.30.40' });
  assert.deepEqual(den(serbest), []);
  assert.ok(den({ ...serbest, yuk_srv_ayar: '1', yuk_srv_seviye: '6', yuk_srv_dizin: DIZIN }).includes('yuk_srv_ayar'), 'serbest hedefte ayar yok');
  const dur = ev(par(null).deger, { islem: 'durdur', arac: null });
  assert.ok(den({ ...dur, yuk_srv_ayar: '1' }).includes('yuk_srv_ayar'), 'durdur kipinde 1 yok');
  const eksik = { ...tamam };
  delete eksik.yuk_srv_dizin;
  assert.ok(den(eksik).includes('yuk_srv_dizin'), 'eksik anahtar');
});

test('SA4 on kontrol: on-sikistirilmis dosya uyarisi sunucu ayarinda cikmaz (kuyruk ogesi atlanmasin)', () => {
  const OK = { ip_yerel: true, server_name_var: true, k6_var: true, yollar_toplam: 2, yollar_200: 2, web_log_df: 10, master_sayisi: 1, sikistirma: { statik: 3 } };
  const uyari = (kp) => dg.onKontrolDegerlendir(OK, { parametreler: kp }).uyarilar.filter((u) => /ön-sıkıştırılmış/.test(u));
  assert.equal(uyari(null).length, 1, 'ayarsiz koşuda uyari aynen');
  assert.equal(uyari({ sunucuAyar: null }).length, 1);
  assert.deepEqual(uyari({ sunucuAyar: { seviye: 6, static: false, dizin: DIZIN } }), []);
});

const KANIT = ['http2\tacik', 'ae\tbr', 'seviye\t6', 'static\t1', `dizin\t${DIZIN}`, 'gz_uretilen\t0', 'br_uretilen\t100', 'atlanan\t20', 'dosya_seviye\t6', 'sure_uygula_sn\t2', 'disk_kanit\tok', 'disk_ornek\t3', 'disk_yol\t/app/a.js'];
const kanitDosyasi = (satirlar) => ({ icerik: `${satirlar.join('\n')}\n`, portal: true });

async function oku(ad, dosyalar) {
  const dizin = portalDuzeniYaz(path.join(KOK, ad), dosyalar);
  return sonuc.kosuDiziniOku(dizin, { adim: 'R17' });
}
const STD = () => standart('R17').dosyalar();
function kanitli(satirlar, adim = 'R17') {
  const m = new Map(STD());
  m.set(`hazirlik_${adim}_gbngxt33.txt`, kanitDosyasi(satirlar));
  return m;
}
let sira = 0;
const sa = (ek = {}) => ({ sunucuAyar: { seviye: 6, static: true, dizin: DIZIN }, ae: 'br', protokol: 'h2', ...ek });
async function analiz(satirlar, secenek = sa(), adim = 'R17') {
  sira += 1;
  const veri = await oku(`k${sira}`, satirlar ? kanitli(satirlar, adim) : STD());
  return kosuAnaliz(veri, { adim: 'R17', ...secenek });
}

test('SA5 sonuc.cjs: hazirlik dosyasi taninir, CRLF ve = bicimi, uyari satirlari', async () => {
  const veri = await oku('sa5', kanitli(['http2=acik\r', 'ae\tbr\r', 'uyari\tbaska dosyada gzip_comp_level var', 'uyarilar\t', 'uyari=ikinci', '# yorum', 'SONUC\tOK\ttamam', 'dizin=/a=b']));
  assert.equal(veri.hazirliklar.length, 1);
  const { anahtar, dosya, bilgi } = veri.hazirliklar[0];
  assert.deepEqual([anahtar, dosya], ['R17_gbngxt33', 'hazirlik_R17_gbngxt33.txt']);
  assert.deepEqual([bilgi.http2, bilgi.ae, bilgi.dizin], ['acik', 'br', '/a=b']);
  assert.deepEqual(bilgi.uyarilar, ['baska dosyada gzip_comp_level var', 'ikinci']);
  assert.ok(veri.dosyalar.some((d) => d.ad === 'hazirlik_R17_gbngxt33.txt'));
  assert.deepEqual((await oku('sa5b', STD())).hazirliklar, []);
});

test('SA6 analiz: uyumlu kanit gecerliligi degistirmez; ayarsiz kosu BIREBIR eskisi', async () => {
  const ayarsiz = await analiz(null, {});
  assert.equal(ayarsiz.gecerlilik, 'GECERLI');
  assert.equal('sunucu_ayar' in ayarsiz.ozet, false);
  // Kanit dosyasi durur ama kosu ayarsiz: analiz ona bakmaz.
  const yanlis = await analiz(['http2\tkapali'], {});
  assert.equal(yanlis.gecerlilik, 'GECERLI');
  // Kanit var, protokol h1: k6 satirlari h1 oldugundan kosu h1 secenegiyle.
  const a = await analiz(KANIT.map((s) => (s.startsWith('http2') ? 'http2\tkapali' : s)), sa({ protokol: 'h1' }));
  assert.deepEqual([a.gecerlilik, a.nedenler], ['GECERLI', []]);
  assert.deepEqual(a.ozet.sunucu_ayar, {
    durum: 'uyumlu', sapmalar: [], http2: false, ae: 'br', seviye: 6, static: true, dizin: DIZIN, gz_uretilen: 0, br_uretilen: 100, atlanan: 20, dosya_seviye: 6, disk_kanit: 'ok', uyarilar: [], dosya: 'hazirlik_R17_gbngxt33.txt',
  });
  // Deger yazimi: 1 / 0 da kanittir.
  const b = await analiz(KANIT.map((s) => (s.startsWith('http2') ? 'http2\t0' : s)), sa({ protokol: 'h1' }));
  assert.equal(b.ozet.sunucu_ayar.durum, 'uyumlu');
  // Identity + static kapali: seviye bos olmali.
  const c = await analiz(['http2\t0', 'ae\tidentity', 'seviye\t', 'static\t0', `dizin\t${DIZIN}`, 'gz_uretilen\t0', 'br_uretilen\t0', 'atlanan\t0'], { sunucuAyar: { seviye: null, static: false, dizin: DIZIN }, ae: 'identity', protokol: 'h1' });
  assert.equal(c.ozet.sunucu_ayar.durum, 'uyumlu', JSON.stringify(c.ozet.sunucu_ayar));
});

test('SA7 analiz: kanit yok ya da uyusmuyor -> GECERSIZ sunucu_ayari_kanitsiz', async () => {
  const h1 = sa({ protokol: 'h1' });
  const K = KANIT.map((s) => (s.startsWith('http2') ? 'http2\tkapali' : s));
  const degis = (on, satir) => K.map((s) => (s.startsWith(on) ? satir : s));
  const denet = async (a, neden) => {
    assert.equal(a.gecerlilik, 'GECERSIZ', JSON.stringify(a.nedenler));
    assert.equal(a.nedenler[0], neden);
    assert.ok(NEDEN_KALIPLARI.some((k) => k.kod === 'sunucu_ayari_kanitsiz' && k.tur === 'neden' && k.re.test(a.nedenler[0])), 'kalip listesinde');
    assert.ok(NEDENLER.some((n) => a.nedenler[0].startsWith(n.onek)), 'NEDENLER listesinde');
    assert.equal(a.ozet.sunucu_ayar.durum, 'kanitsiz');
  };
  await denet(await analiz(null, h1), 'sunucu_ayari_kanitsiz(yok)');
  await denet(await analiz(K, h1, 'R99'), 'sunucu_ayari_kanitsiz(yok)'); // baska kosunun kaniti sayilmaz
  await denet(await analiz(degis('http2', 'http2\tacik'), h1), 'sunucu_ayari_kanitsiz(http2)');
  await denet(await analiz(degis('http2', 'http2\tbelki'), h1), 'sunucu_ayari_kanitsiz(http2)');
  await denet(await analiz(K.filter((s) => !s.startsWith('http2')), h1), 'sunucu_ayari_kanitsiz(http2)');
  await denet(await analiz(degis('ae', 'ae\tgzip'), h1), 'sunucu_ayari_kanitsiz(ae)');
  await denet(await analiz(degis('seviye', 'seviye\t5'), h1), 'sunucu_ayari_kanitsiz(seviye)');
  await denet(await analiz(degis('seviye', 'seviye\t'), h1), 'sunucu_ayari_kanitsiz(seviye)');
  await denet(await analiz(degis('static', 'static\t0'), h1), 'sunucu_ayari_kanitsiz(static)');
  await denet(await analiz(degis('dizin', 'dizin\t/usr/nginx/applications/baska'), h1), 'sunucu_ayari_kanitsiz(dizin)');
  await denet(await analiz(K.map((s) => (s.startsWith('br_uretilen') ? 'br_uretilen\t0' : s.startsWith('atlanan') ? 'atlanan\t0' : s)), h1), 'sunucu_ayari_kanitsiz(dosya)');
  await denet(await analiz(degis('seviye', 'seviye\t1').map((s) => (s.startsWith('dosya_seviye') ? 'dosya_seviye\t9' : s)), { ...h1, sunucuAyar: { seviye: null, static: true, dizin: DIZIN }, ae: 'identity' }), 'sunucu_ayari_kanitsiz(ae,seviye)');
  await denet(await analiz(degis('ae', 'ae\tbr').concat(['static\tacik']), sa({ protokol: 'h2' })), 'sunucu_ayari_kanitsiz(http2)');
});

test('SA7b static kosu: disk kaniti ve dosya seviyesi denetlenir', async () => {
  const h1 = sa({ protokol: 'h1' });
  const K = KANIT.map((s) => (s.startsWith('http2') ? 'http2\tkapali' : s));
  const yeni = (on, satir) => K.map((s) => (s.startsWith(on) ? satir : s));
  const sonuc1 = async (satirlar, secenek = h1) => {
    const a = await analiz(satirlar, secenek);
    return [a.gecerlilik, a.nedenler[0] ?? null, a.ozet.sunucu_ayar.durum];
  };
  const kanitsiz = (x) => ['GECERSIZ', `sunucu_ayari_kanitsiz(${x})`, 'kanitsiz'];
  assert.deepEqual(await sonuc1(yeni('disk_kanit', 'disk_kanit\tyok')), kanitsiz('disk_kanit'));
  assert.deepEqual(await sonuc1(K.filter((s) => !s.startsWith('disk_kanit'))), kanitsiz('disk_kanit'));
  assert.deepEqual(await sonuc1(yeni('dosya_seviye', 'dosya_seviye\t11')), kanitsiz('dosya_seviye'));
  assert.deepEqual(await sonuc1(yeni('dosya_seviye', 'dosya_seviye\t')), kanitsiz('dosya_seviye'));
  // Eski zip: seviye konfta tutar, iki satir hic yok.
  const eski = K.filter((s) => !/^(disk_|dosya_seviye)/.test(s));
  assert.deepEqual(await sonuc1(eski), kanitsiz('disk_kanit,dosya_seviye'));
  // Identity + gzip_static: seviye secilmez, dosya 9.
  const idn = ['http2\tkapali', 'ae\tidentity', 'seviye\t', 'static\t1', `dizin\t${DIZIN}`, 'gz_uretilen\t100', 'br_uretilen\t0', 'atlanan\t0', 'disk_kanit\tok'];
  const idSec = { sunucuAyar: { seviye: null, static: true, dizin: DIZIN }, ae: 'identity', protokol: 'h1' };
  assert.deepEqual(await sonuc1([...idn, 'dosya_seviye\t9'], idSec), ['GECERLI', null, 'uyumlu']);
  assert.deepEqual(await sonuc1([...idn, 'dosya_seviye\t6'], idSec), kanitsiz('dosya_seviye'));
  // Static kapali: iki alan aranmaz (betik `disk_kanit yok`, bos dosya_seviye yazar).
  const kapali = K.map((s) => (s.startsWith('static') ? 'static\t0' : s.startsWith('disk_kanit') ? 'disk_kanit\tyok' : s.startsWith('dosya_seviye') ? 'dosya_seviye\t' : s));
  assert.deepEqual(await sonuc1(kapali, sa({ protokol: 'h1', sunucuAyar: { seviye: 6, static: false, dizin: DIZIN } })), ['GECERLI', null, 'uyumlu']);
});

test('SA7c gercek hazirlik dosyasi: rapor kolonlari kanittan', async () => {
  const K = (seviye, ae) => ['http2\tkapali', `ae\t${ae}`, `seviye\t${seviye}`, 'static\t1', `dizin\t${DIZIN}`, 'gz_uretilen\t100', 'br_uretilen\t100', 'atlanan\t0', `dosya_seviye\t${seviye}`, 'disk_kanit\tok'];
  const alan = async (seviye, ae) => {
    const sunucuAyar = { seviye, static: true, dizin: DIZIN };
    const a = await analiz(K(seviye, ae), { sunucuAyar, ae, protokol: 'h1' });
    assert.equal(a.gecerlilik, 'GECERLI', JSON.stringify(a.nedenler));
    return rapor.sunucuAlanlari({ ae, sunucuAyar }, a.ozet);
  };
  const b = await alan(1, 'br');
  assert.deepEqual([b.brotliSeviye, b.brotliStatik, b.brotliStatikSeviye, b.gzipStatikSeviye, b.diskKanit], [1, true, 1, '-', 'ok']);
  const g = await alan(6, 'gzip');
  assert.deepEqual([g.gzipSeviye, g.gzipStatik, g.gzipStatikSeviye, g.brotliStatikSeviye, g.diskKanit], [6, true, 6, '-', 'ok']);
});

test('SA8 gorunum.sunucuAyari', () => {
  assert.equal(gorunum.sunucuAyari(null, null, null), null);
  assert.equal(gorunum.sunucuAyari({ protokol: 'h1', ae: 'br', sunucuAyar: null }, null, null), null);
  const p = { protokol: 'h2', ae: 'br', sunucuAyar: { seviye: 6, static: true, dizin: DIZIN } };
  assert.deepEqual(gorunum.sunucuAyari(p, null, null), { http2: true, ae: 'br', seviye: 6, static: true, dizin: DIZIN, kanit: null, geriAlma: null, uyarilar: [] });
  const oz = { sunucu_ayar: { durum: 'uyumlu', sapmalar: [], gz_uretilen: 0, br_uretilen: 100, atlanan: 20, uyarilar: ['baska dosyada http2 on'] } };
  const g = gorunum.sunucuAyari(p, { sunucu_ayar: { geri_alma: 'UYARI', geri_alma_metin: 'gzip.conf baskasi degistirmis' } }, oz);
  assert.deepEqual(g.kanit, { durum: 'uyumlu', sapmalar: [], gzUretilen: 0, brUretilen: 100, atlanan: 20, uyarilar: ['baska dosyada http2 on'] });
  assert.deepEqual(g.geriAlma, { durum: 'uyari', metin: 'gzip.conf baskasi degistirmis' });
  assert.deepEqual(gorunum.sunucuAyari(p, { sunucu_ayar: { geri_alma: 'ok' } }, null).geriAlma, { durum: 'ok', metin: null });
  assert.deepEqual(gorunum.sunucuAyari(p, { sunucu_ayar: { geri_alma: 'bilinmez' } }, null).geriAlma.durum, 'hata', 'tanimayan durum yutulmaz');
  assert.equal(gorunum.sunucuAyari(p, { sunucu_ayar: {} }, null).geriAlma, null);
});

test('SA10 gorunum: Play 7 kosmadiysa kirmizi; durdurma isi bekleniyor / sonucu ana sonucun onune gecer', () => {
  const p = { protokol: 'h2', ae: 'br', sunucuAyar: { seviye: 6, static: true, dizin: DIZIN } };
  const ga = (st, satir) => gorunum.sunucuAyari(p, st, null, satir).geriAlma;
  // Suren is ya da AWX'e hic gitmemis satir: uyari yok.
  assert.equal(ga(null, { terminal: false, isVar: true }), null);
  assert.equal(ga(null, { terminal: true, isVar: false }), null, 'AWX isi yoksa hedef degismedi');
  // Is bitti, sonuc yok: sessiz kalmaz.
  const yok = ga(null, { terminal: true, isVar: true });
  assert.equal(yok.durum, 'hata');
  assert.match(yok.metin, /Durdur/);
  assert.equal(ga({ sunucu_ayar: null }, { terminal: true, isVar: true }).durum, 'hata');
  assert.equal(ga({ sunucu_ayar: { geri_alma: 'ok' } }, { terminal: true, isVar: true }).durum, 'ok');
  // Durdurma isi basladi, sonucu yok.
  const bek = ga(null, { terminal: true, isVar: true, durdurIs: 55 });
  assert.equal(bek.durum, 'bekliyor');
  assert.match(bek.metin, /#55/);
  assert.equal(ga({ sunucu_ayar: { geri_alma: 'hata', geri_alma_metin: 'x' } }, { terminal: true, isVar: true, durdurIs: 55 }).durum, 'bekliyor');
  assert.equal(ga({ sunucu_ayar: { geri_alma: 'ok' } }, { terminal: true, isVar: true, durdurIs: 55 }).durum, 'ok', 'kalan surec temizligi basarili sonucu bozmaz');
  // Durdurma isinin sonucu ana isin 'hata'sini gecer; baska isin sonucu sayilmaz.
  const st = { sunucu_ayar: { geri_alma: 'hata', geri_alma_metin: 'eski' }, durdur_geri_alma: { is: 55, durum: 'ok', metin: 'geri alindi' } };
  assert.deepEqual(ga(st, { terminal: true, isVar: true, durdurIs: 55 }), { durum: 'ok', metin: 'geri alindi' });
  assert.equal(ga(st, { terminal: true, isVar: true, durdurIs: 56 }).durum, 'bekliyor', 'yeni durdurma isi eski sonucu kullanmaz');
  assert.equal(ga({ durdur_geri_alma: { is: 55, durum: 'garip' } }, { terminal: true, isVar: true, durdurIs: 55 }).durum, 'hata');
  // On kontrol uyarilari gorunur (kanit yokken de); kanit + set_stats tekillesir.
  const u = gorunum.sunucuAyari(p, { sunucu_ayar: { geri_alma: 'ok', uyarilar: ['etkisiz olabilir', 'iki'] } }, { sunucu_ayar: { durum: 'uyumlu', uyarilar: ['etkisiz olabilir'] } });
  assert.deepEqual(u.uyarilar, ['etkisiz olabilir', 'iki']);
  assert.deepEqual(gorunum.sunucuAyari(p, { sunucu_ayar: { uyarilar: ['ayar etkisiz'] } }, null).uyarilar, ['ayar etkisiz']);
});

test('SA11 butce tavani: sunucu ayarli kosuda 1800; Portal kapisi ile son kapi ayni', () => {
  assert.equal(dg.SINIRLAR.maxButceSnSunucuAyar, 1800);
  // bosta 30 + adim * (isinma + sure + bosluk + 20) + 120
  const ek = (hiz, sure) => ({ hizlar: hiz, tekrar: 1, isinma: 5, sure, bosluk: 5, bosta: 30 });
  const buyuk = ek([100, 200, 300, 400, 500], 300); // 30 + 5 * 330 + 120 = 1800
  assert.equal(dg.butceSn({ ...buyuk, motor: 'k6' }), 1800);
  const tamam = par({ seviye: 6, dizin: DIZIN }, buyuk);
  assert.equal(tamam.ok, true, JSON.stringify(tamam));
  assert.deepEqual(den(ev(tamam.deger)), []);
  const asan = par({ seviye: 6, dizin: DIZIN }, { ...buyuk, bosta: 31 });
  assert.deepEqual([asan.ok, asan.status, asan.code], [false, 409, 'sinir_asildi']);
  assert.match(asan.asimlar[0], /1801 sn > 1800 sn \(sunucu ayarlı koşu\)/);
  assert.equal(par(null, { ...buyuk, bosta: 31 }).ok, true, 'ayarsiz kosuda tavan degismez');
  const ayarsiz = ev(par(null, { ...buyuk, bosta: 31 }).deger);
  assert.deepEqual(den(ayarsiz), []);
  assert.ok(den({ ...ayarsiz, yuk_srv_ayar: '1', yuk_srv_seviye: '6', yuk_srv_dizin: DIZIN }).includes('yuk_butce_sn'), 'son kapi da 1800 der');
});

test('SA12 son kapi: durdur kipinde seviye / static / dizin dolu gidemez (playbook ile ayni)', () => {
  const dur = ev(par(null).deger, { islem: 'durdur', arac: null });
  assert.deepEqual(den({ ...dur, yuk_srv_seviye: '6' }), ['yuk_srv_seviye']);
  assert.deepEqual(den({ ...dur, yuk_srv_static: '1' }), ['yuk_srv_static']);
  assert.deepEqual(den({ ...dur, yuk_srv_dizin: DIZIN }), ['yuk_srv_dizin']);
});

test('SA13 on kontrol engelleri: eski playbook (srv_hazirlik yok) ve kalmis yedek', () => {
  const OK = { ip_yerel: true, server_name_var: true, k6_var: true, yollar_toplam: 2, yollar_200: 2, web_log_df: 10, master_sayisi: 1 };
  const AYAR = { sunucuAyar: { seviye: 6, static: false, dizin: DIZIN } };
  const eng = (o, kp, ek = {}) => dg.onKontrolDegerlendir({ ...OK, ...o }, { parametreler: kp, ...ek }).engeller;
  assert.deepEqual(eng({ srv_hazirlik: 'ok' }, AYAR), []);
  assert.deepEqual(eng({}, null), [], 'ayarsiz kosu alana bakmaz (eski playbook)');
  assert.deepEqual(eng({ hazirlik_yedek: false }, null), []);
  assert.match(eng({}, AYAR)[0], /Ansible deposunu güncelleyin/);
  assert.match(eng({ srv_hazirlik: null }, AYAR)[0], /doğrulanmadı/);
  assert.match(eng({ srv_hazirlik: 'fail' }, AYAR)[0], /uygulanamadı/);
  assert.match(eng({ hazirlik_yedek: true }, { sunucuAyar: null })[0], /geri alınmamış/);
  assert.deepEqual(eng({ hazirlik_yedek: true, srv_hazirlik: 'ok' }, AYAR), [], 'ayarli on kontrolde yedek kendi yedegidir');
  // Serbest hedefte sunucu ayari yok: alanlara bakilmaz.
  const SERBEST = { ip_yuk_makinesinde: false, k6_var: true, yollar_toplam: 1, yollar_200: 1 };
  assert.deepEqual(dg.onKontrolDegerlendir({ ...SERBEST, hazirlik_yedek: true }, { hedefTuru: 'serbest', parametreler: AYAR }).engeller, []);
});

test('SA9 kuyruk: static payi', async () => {
  assert.equal(kuyruk.HAZIRLIK_PAY_SN, 180);
  assert.equal(kuyruk.hazirlikPayiSn(null), 0);
  assert.equal(kuyruk.hazirlikPayiSn({ sunucuAyar: null }), 0);
  assert.equal(kuyruk.hazirlikPayiSn({ sunucuAyar: { static: false } }), 0);
  assert.equal(kuyruk.hazirlikPayiSn({ sunucuAyar: { static: true } }), 180);
});
