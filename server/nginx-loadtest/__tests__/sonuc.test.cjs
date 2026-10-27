// server/nginx-loadtest/__tests__/sonuc.test.cjs -- kosu dizini okuyucu (sonuc.cjs).
//
// OKUNAMADI != GECERSIZ: okuyucu yalniz veri GUVENILMEZ oldugunda (dizin yok, tavan, bozuk gzip,
// SHA256SUMS tutmuyor, bicim bozuk, symlink) `.code = 'OKUNAMADI'` atar; eksik istege bagli dosya
// hata DEGILDIR (analiz null/GECERSIZ uretir). Butun dizinler os.tmpdir() altinda kurulur.
//
//   SN1  dizin yok / dosya / bos ad -> OKUNAMADI
//   SN2  bayt tavani: ham boyut on kontrolu VE acilmis bayt (gzip bombasi) akista kesilir
//   SN3  bozuk / yarim gzip -> OKUNAMADI
//   SN4  SHA256SUMS: dogrulanir; degismis / eksik dosya, bozuk satir, dizin disi ad -> OKUNAMADI
//   SN5  istege bagli dosyalar eksik -> hata yok, alanlar bos/null, uyari
//   SN6  log .tsv ve .tsv.gz birlikte -> duz olan okunur, cift sayilmaz
//   SN7  satir bolucu: \r\n / \r / \n parca sinirinda, BOM, UTF-8 parca bolunmesi, asiri uzun satir
//   SN8  CSV: tirnak, fazla/eksik alan, yinelenen baslik, bos satir (Python csv.DictReader gibi)
//   SN9  sunucu_*.csv: kolon eksik -> OKUNAMADI; bozuk satir atlanir; kesirli epoch; siralama
//   SN10 log_*.tsv: baslik taninmazsa OKUNAMADI; '-' = NaN; sutunlu tipli depo; atlanan sayilir
//   SN11 bilinen adli girdi normal dosya degil (dizin / symlink) -> OKUNAMADI
//   SN12 dosya sayisi tavani
//   SN13 istemci / hatali_istemci ayrimi, bilgi/diger/NOT/konf ayrisdirma, bilgi yoksa yedek
//   SN14 gzip saydam: ayni fikstur .gz'li ve .gz'siz okununca log deposu ayni
//   SN16 adim suzgeci: baska ADIM'in log satiri depoya girmez, TEK uyariyla sayilir (S6)
//   SN17 log deposunda en cok 64 farkli TUR; fazlasi OKUNAMADI (inceleme guvenlik-log-tur-oom)
//   SN18 Kolon baslangic kapasitesi 16, ikiye katlayarak buyur
//   SN19 satir tavanlari: zaman/baslatilan 2000, istemci/hatali 100, sunucu 20000, diger 20000 saniye,
//        bilgi uyari=/gecersiz= 2000 -> asilinca dosya adiyla OKUNAMADI; log= tavansiz (her *.log bir satir)
//   SN20 faz kodu haritasi 256 adla sinirli (cikti ayni)
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const sonuc = require('../sonuc.cjs');
const { kosuDiziniOku } = sonuc;
const { Kurgu, standart, portalDuzeniYaz, KOLON, tl } = require('./fixtures/kurgu.cjs');

const KOK = fs.mkdtempSync(path.join(os.tmpdir(), 'yuktesti-sonuc-'));
after(() => fs.rmSync(KOK, { recursive: true, force: true }));
let sira = 0;
function yeniDizin(dosyalar = {}) {
  const d = path.join(KOK, `d${++sira}`);
  fs.mkdirSync(d);
  for (const [ad, icerik] of Object.entries(dosyalar)) fs.writeFileSync(path.join(d, ad), icerik);
  return d;
}

async function okunamadi(fn, desen) {
  await assert.rejects(fn, (e) => {
    assert.equal(e.code, 'OKUNAMADI', `kod OKUNAMADI olmali: ${e.code} ${e.message}`);
    if (desen) assert.match(e.message, desen);
    return true;
  });
}

const ISTEMCI = KOLON.join(',') + '\n' + KOLON.map((k) => (k === 'tur' ? 'R1_K_yeni_br_250_r1' : k === 'adim' ? 'R1' : '1')).join(',') + '\n';
const LOG_BAS = 'tur\tfaz\ttime_local\tstatus\tyol\trequest_time\tresponse_lenght\tconnection_request\tdeneme\n';

test('SN1 dizin yok / dosya / bos ad -> OKUNAMADI', async () => {
  await okunamadi(() => kosuDiziniOku(path.join(KOK, 'yok-boyle-dizin')), /kosu dizini okunamadi/);
  const d = yeniDizin({ 'x.txt': 'x' });
  await okunamadi(() => kosuDiziniOku(path.join(d, 'x.txt')), /dizin degil/);
  await okunamadi(() => kosuDiziniOku(''), /verilmedi/);
  await assert.rejects(() => kosuDiziniOku(d, { maxBayt: -1 }), TypeError);
});

test('SN2 bayt tavani: ham boyut on kontrolu ve acilmis bayt (gzip bombasi) akista kesilir', async () => {
  const d = yeniDizin({ 'istemci_R1_K_yeni_br_250_r1.csv': ISTEMCI });
  // On kontrol: ham boyut toplami okumadan once reddedilir (akis kesmesinden ayri mesaj).
  await okunamadi(() => kosuDiziniOku(d, { maxBayt: 10 }), new RegExp(`bayt tavanini asti \\(${Buffer.byteLength(ISTEMCI)} > 10\\)`));
  // 4 MB sifir -> ~4 KB gzip: ham boyut tavanin cok altinda, acilinca ustunde.
  const bomba = zlib.gzipSync(Buffer.concat([Buffer.from(LOG_BAS), Buffer.alloc(4 * 1024 * 1024, 0x41)]));
  const g = yeniDizin({ 'log_R1_h.tsv.gz': bomba });
  assert.ok(bomba.length < 64 * 1024);
  await okunamadi(() => kosuDiziniOku(g, { maxBayt: 1024 * 1024 }), /bayt tavanini asti \(1048576 bayt; log_R1_h\.tsv\.gz/);
  // Tavan yeterliyse ayni dosya okunur (uzun satir atlanir, sayilir).
  const v = await kosuDiziniOku(g, { maxBayt: 8 * 1024 * 1024 });
  assert.ok(v.uyarilar.some((u) => u.startsWith('uzun_satir_atlandi:log_R1_h.tsv.gz(')), v.uyarilar.join(' | '));
  assert.equal(sonuc.VARSAYILAN_MAX_BAYT, 200 * 1024 * 1024);
});

test('SN3 bozuk / yarim gzip -> OKUNAMADI', async () => {
  const tam = zlib.gzipSync(Buffer.from(LOG_BAS + 'R1_K_yeni_br_250_r1\tolcum\t27/Oct/2026:10:00:00 +0300\t200\t/a\t0.010\t10\t1\t1\n'));
  await okunamadi(() => kosuDiziniOku(yeniDizin({ 'log_R1_h.tsv.gz': tam.subarray(0, tam.length - 10) })), /log_R1_h\.tsv\.gz: gzip acilamadi/);
  await okunamadi(() => kosuDiziniOku(yeniDizin({ 'log_R1_h.tsv.gz': 'duz metin, gzip degil\n' })), /gzip acilamadi/);
  const v = await kosuDiziniOku(yeniDizin({ 'log_R1_h.tsv.gz': tam }));
  assert.equal(v.loglar[0].satir, 1);
});

function sha(b) {
  return crypto.createHash('sha256').update(b).digest('hex');
}

test('SN4 SHA256SUMS: dogrulanir; degisen / eksik dosya, bozuk satir, dizin disi ad -> OKUNAMADI', async () => {
  const k = standart('R1', { hizlar: [250], tekrar: 1 });
  const d = portalDuzeniYaz(path.join(KOK, 'sha1'), k.dosyalar());
  const v = await kosuDiziniOku(d);
  assert.equal(v.sha256.durum, 'dogrulandi');
  assert.ok(v.sha256.dosya_sayisi >= 8, `liste: ${v.sha256.dosya_sayisi}`);
  // Bir bayt degisirse (kopya bozuk) okunamadi.
  const ist = path.join(d, 'istemci_R1_K_yeni_br_250_r1.csv');
  const asil = fs.readFileSync(ist);
  fs.writeFileSync(ist, Buffer.concat([asil, Buffer.from('\n')]));
  await okunamadi(() => kosuDiziniOku(d), /SHA256SUMS tutmuyor: istemci_R1_K_yeni_br_250_r1\.csv/);
  fs.writeFileSync(ist, asil);
  // Listelenen dosya yoksa (kopya yarim) okunamadi.
  const not = path.join(d, 'NOT.txt');
  const notIcerik = fs.readFileSync(not);
  fs.rmSync(not);
  await okunamadi(() => kosuDiziniOku(d), /SHA256SUMS'teki dosya kosu dizininde yok: NOT\.txt/);
  fs.writeFileSync(not, notIcerik);
  await kosuDiziniOku(d);

  const a = Buffer.from(ISTEMCI);
  const ek = Buffer.from('kaydedici ciktisi\n');
  // sha256sum bicimleri: "  ad", " *ad", "./ad"; dosyanin kendi satiri (bos haliyle) atlanir;
  // bilinmeyen adli ama listelenmis dosya da dogrulanir.
  const liste = [`${sha(a)} *./istemci_R1_K_yeni_br_250_r1.csv`, `${sha(ek)}  kaydedici.out`, `${sha('')}  SHA256SUMS`, ''].join('\n');
  const d2 = yeniDizin({ 'istemci_R1_K_yeni_br_250_r1.csv': a, 'kaydedici.out': ek, SHA256SUMS: liste });
  assert.equal((await kosuDiziniOku(d2)).sha256.dosya_sayisi, 2);
  fs.writeFileSync(path.join(d2, 'kaydedici.out'), 'baska\n');
  await okunamadi(() => kosuDiziniOku(d2), /SHA256SUMS tutmuyor: kaydedici\.out/);
  await okunamadi(() => kosuDiziniOku(yeniDizin({ SHA256SUMS: 'bozuk satir\n' })), /satir bicimi taninmadi/);
  await okunamadi(() => kosuDiziniOku(yeniDizin({ SHA256SUMS: `${sha('')}  ../disari.txt\n` })), /duz dizin disi ad/);
  await okunamadi(() => kosuDiziniOku(yeniDizin({ SHA256SUMS: `${sha('')}  alt/dosya.txt\n` })), /duz dizin disi ad/);
});

test('SN5 istege bagli dosyalar eksik: hata yok, alanlar bos/null, uyari', async () => {
  const v = await kosuDiziniOku(yeniDizin({ 'istemci_R1_K_yeni_br_250_r1.csv': ISTEMCI, 'baska.dosya': 'yok sayilir' }));
  assert.equal(v.istemci.length, 1);
  assert.equal(v.zaman, null);
  assert.equal(v.baslatilan, null);
  assert.deepEqual(v.kesitler, []);
  assert.deepEqual(v.loglar, []);
  assert.equal(v.diger.size, 0);
  assert.equal(v.not, '');
  assert.equal(v.log.turlar.size, 0);
  assert.deepEqual(v.dosyalar, [{ ad: 'istemci_R1_K_yeni_br_250_r1.csv', bayt: Buffer.byteLength(ISTEMCI) }]);
  assert.deepEqual(v.sha256, { durum: 'yok', dosya_sayisi: 0 });
  assert.ok(v.uyarilar.includes('SHA256SUMS_yok(butunluk_dogrulanamadi)'));
  const bos = await kosuDiziniOku(yeniDizin());
  assert.deepEqual([bos.istemci, bos.hataliIstemci, bos.kesitler], [[], [], []]);
});

test('SN6 log .tsv ve .tsv.gz birlikte: duz olan okunur, satirlar cift sayilmaz', async () => {
  const icerik = LOG_BAS + 'R1_K_yeni_br_250_r1\tolcum\t27/Oct/2026:10:00:00 +0300\t200\t/a\t0.010\t10\t1\t1\n';
  const d = yeniDizin({ 'log_R1_h.tsv': icerik, 'log_R1_h.tsv.gz': zlib.gzipSync(Buffer.from(icerik)).subarray(0, 12) });
  const v = await kosuDiziniOku(d);
  assert.deepEqual(v.loglar.map((l) => [l.dosya, l.satir]), [['log_R1_h.tsv', 1]]);
  assert.equal(v.log.turlar.get('R1_K_yeni_br_250_r1').n, 1);
  assert.ok(v.uyarilar.includes('gz_ve_duz_birlikte:log_R1_h.tsv.gz(duz_dosya_okundu)'));
});

async function bol(parcalar) {
  const out = [];
  const y = new sonuc._SatirYaziciForTest((s) => out.push(s));
  await pipeline(Readable.from(parcalar.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))), y);
  return { out, uzun: y.uzun };
}

test('SN7 satir bolucu: parca sinirinda \\r\\n, tek \\r, BOM, bolunmus UTF-8, asiri uzun satir', async () => {
  assert.deepEqual((await bol(['a\r', '\nb\rc\n', 'd'])).out, ['a', 'b', 'c', 'd']);
  assert.deepEqual((await bol(['x\r\n', '\r\n', 'y\r'])).out, ['x', '', 'y']);
  assert.deepEqual((await bol(['\ufeffbas,x\n\ufeffikinci\n'])).out, ['bas,x', '\ufeffikinci'], 'BOM yalniz dosya basinda atilir');
  const s = Buffer.from('\u015f\u00fc\n', 'utf8');
  assert.deepEqual((await bol([s.subarray(0, 1), s.subarray(1)])).out, ['\u015f\u00fc']);
  assert.deepEqual((await bol([Buffer.from([0x61, 0xff, 0x0a])])).out, ['a\ufffd'], 'gecersiz UTF-8 -> U+FFFD (Python errors=replace)');
  const uzun = 'z'.repeat(sonuc._MAX_SATIR_KAR + 10);
  const r = await bol(['once\n', uzun.slice(0, 40000), uzun.slice(40000), uzun.slice(0, 10), '\nsonra\n']);
  assert.deepEqual(r.out, ['once', 'sonra']);
  assert.equal(r.uzun, 1);
  assert.deepEqual((await bol([])).out, []);
});

test('SN8 CSV: Python csv.DictReader + csv_oku ile ayni', () => {
  const ayir = sonuc._csvAyirForTest;
  assert.deepEqual(ayir('a,"b,c",d'), ['a', 'b,c', 'd']);
  assert.deepEqual(ayir('"x""y",'), ['x"y', '']);
  assert.deepEqual(ayir('ab"c,d'), ['ab"c', 'd']);
  assert.deepEqual(ayir(''), []);
  assert.deepEqual(ayir(' '), [' ']);
  const o = sonuc._csvSozlukOkuyucuForTest();
  for (const s of [' tur , a ,a,b', 'T1, 1 ,2,3,4,5', '', 'T2', 'T3,x']) o.satir(s);
  const rows = o.bitir().map((x) => ({ ...x }));
  // ' a ' ve 'a' kirpilinca ayni anahtar: sonraki kazanir; fazla alan atilir; eksik alan ''.
  assert.deepEqual(rows, [{ tur: 'T1', a: '2', b: '3' }, { tur: 'T2', a: '', b: '' }, { tur: 'T3', a: '', b: '' }]);
  assert.equal(Object.getPrototypeOf(o.bitir()[0]), null, 'veriden gelen anahtar prototipe yazilamaz');
});

const SUNUCU_BAS = 'epoch,isci_utime,isci_stime,isci_sayi,kapanan_sayi,pidler,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal\n';

test('SN9 sunucu_*.csv: kolon eksik -> OKUNAMADI; bozuk satir atlanir; kesirli epoch ve siralama', async () => {
  await okunamadi(() => kosuDiziniOku(yeniDizin({ 'sunucu_R1_h.csv': 'epoch,isci_utime\n1,2\n' })), /sunucu_R1_h\.csv: eksik kolon isci_stime,isci_sayi/);
  const icerik = SUNUCU_BAS + [
    '1800000002.5,20,4,2,0,101+102,30,0,0,70,0,0,0,0',
    '1800000001.25,10,2,2,0,101+102,10,1,2,80,3,4,5,6',
    'nan,1,1,1,0,p,1,1,1,1,1,1,1,1',
    '1800000003,x,1,1,0,p,1,1,1,1,1,1,1,1',
    '1800000004,1,1,1,0,p,1.5,1,1,1,1,1,1,1',
    '1800000005,1,1,1,0',
    '1800000006,1_0,1,1,0,p,1,1,1,1,1,1,1,1',
  ].join('\n') + '\n';
  const v = await kosuDiziniOku(yeniDizin({ 'sunucu_R1_h.csv': icerik, 'bilgi_R1_h.txt': 'nproc=4\n' }));
  const o = v.kesitler[0].ornekler;
  assert.deepEqual(o.map((x) => x.t), [1800000001.25, 1800000002.5, 1800000006]);
  // busy = user+nice+system+irq+softirq+steal; tot = busy + idle + iowait
  assert.deepEqual(o[0], { t: 1800000001.25, u: 10, s: 2, n: 2, k: 0, p: '101+102', busy: 10 + 1 + 2 + 4 + 5 + 6, tot: 28 + 80 + 3 });
  assert.equal(o[2].u, 10, "Python int('1_0') = 10");
  const bos = await kosuDiziniOku(yeniDizin({ 'sunucu_R1_h.csv': '' }));
  assert.deepEqual(bos.kesitler[0].ornekler, []);
});

test('SN10 log_*.tsv: baslik taninmazsa OKUNAMADI; sutunlu tipli depo; eksik deger NaN; atlanan sayilir', async () => {
  await okunamadi(() => kosuDiziniOku(yeniDizin({ 'log_R1_h.tsv': 'a\tb\tc\n1\t2\t3\n' })), /log_R1_h\.tsv: baslik satiri taninmadi/);
  const satir = (s) => s.join('\t');
  const icerik = '\n' + LOG_BAS + [
    satir(['T', 'olcum', '27/Oct/2026:10:00:00 +0300', '200', '/a', '0.010', '1000', '1', '2']),
    satir(['T', 'setup', '27/Oct/2026:10:00:01 +0300', '-', '/a', '-', '-', '-', '-']),
    satir(['T', 'olcum', 'bozuk zaman', '200', '/a', '0.010', '1000', '1', '1']),
    satir(['T', 'olcum', '27/Oct/2026:10:00:02 +0300', '200']),
    satir(['U', 'isinma', '27/Oct/2026:10:00:03 +0300', '429.9', '/b', '1e-2', '7', '3', '1']),
    '',
  ].join('\n');
  const v = await kosuDiziniOku(yeniDizin({ 'log_R1_h.tsv': icerik }));
  assert.deepEqual(v.loglar, [{ dosya: 'log_R1_h.tsv', satir: 3, atlanan: 2, baslik: true }]);
  assert.deepEqual(v.log.fazlar, ['olcum', 'setup', 'isinma']);
  const t = v.log.turlar.get('T');
  for (const k of ['t', 'rt', 'cr', 'bl', 'd']) assert.ok(t[k] instanceof Float64Array, `${k} sutunu Float64Array (bellek: nesne dizisi DEGIL)`);
  assert.ok(t.faz instanceof Uint8Array && t.durum instanceof Int32Array);
  assert.equal(t.n, 2);
  assert.deepEqual([...t.t], [Date.UTC(2026, 9, 27, 7, 0, 0) / 1000, Date.UTC(2026, 9, 27, 7, 0, 1) / 1000]);
  assert.deepEqual([...t.durum], [200, 0], "status '-' -> 0 (Python: int(durum) if durum else 0)");
  assert.deepEqual([...t.rt].map(String), ['0.01', 'NaN']);
  assert.deepEqual([...t.d].map(String), ['2', 'NaN']);
  const u = v.log.turlar.get('U');
  assert.deepEqual([u.durum[0], u.rt[0], u.cr[0], u.bl[0], u.d[0], u.faz[0]], [429, 0.01, 3, 7, 1, 2], 'int(429.9) = 429');
  // Deneme kolonu olmayan (eski kaydedici) log: d hep NaN.
  const eski = await kosuDiziniOku(yeniDizin({ 'log_R1_h.tsv': 'tur\tfaz\ttime_local\nT\tolcum\t27/Oct/2026:10:00:00 +0300\n' }));
  assert.ok(Number.isNaN(eski.log.turlar.get('T').d[0]));
});

test('SN11 bilinen adli girdi normal dosya degil (dizin / symlink) -> OKUNAMADI', async (t) => {
  const d = yeniDizin();
  fs.mkdirSync(path.join(d, 'zaman.csv'));
  await okunamadi(() => kosuDiziniOku(d), /zaman\.csv: normal dosya degil/);
  const d2 = yeniDizin({ 'hedef.txt': 'x' });
  fs.mkdirSync(path.join(d2, 'alt'));
  await kosuDiziniOku(d2);
  const d3 = yeniDizin();
  try {
    fs.symlinkSync(path.join(d2, 'hedef.txt'), path.join(d3, 'log_R1_h.tsv'));
  } catch (e) {
    t.diagnostic(`symlink kurulamadi (${e.code}); symlink kolu atlandi`);
    return;
  }
  await okunamadi(() => kosuDiziniOku(d3), /log_R1_h\.tsv: normal dosya degil/);
});

test('SN12 dosya sayisi tavani', async () => {
  const d = yeniDizin();
  for (let i = 0; i < 501; i++) fs.writeFileSync(path.join(d, `istemci_R1_K_yeni_br_${i}_r1.csv`), '');
  await okunamadi(() => kosuDiziniOku(d), /cok fazla dosya: 501/);
});

test('SN13 istemci / hatali ayrimi; bilgi, diger, NOT, konf ayrisdirma; bilgi yoksa yedek', async () => {
  const hatali = ISTEMCI.replace('R1_K_yeni_br_250_r1', 'R1_K_yeni_br_400_r1');
  const tursuz = KOLON.join(',') + '\n' + KOLON.map(() => '').join(',') + '\n';
  const v = await kosuDiziniOku(yeniDizin({
    'istemci_R1_K_yeni_br_250_r1.csv': ISTEMCI + '\n',
    'istemci_R1_K_yeni_br_250_r1.json': '{"bozuk json analizde okunmaz"',
    'istemci_R1_bos.csv': tursuz,
    'hatali_istemci_R1_K_yeni_br_400_r1.csv': hatali,
    'sunucu_R1_h.csv': SUNUCU_BAS,
    'sunucu_R1_h_2.csv': SUNUCU_BAS,
    'bilgi_R1_h.txt': '# yorum=atlanir\nnproc=8\nuyari=a=b\nuyari=c\ngecersiz=log_dondu:x.log\nsatir esittirsiz\nclk_tck = 100 \n',
    'diger_R1_h.tsv': 'time_local\tadet\n27/Oct/2026:10:00:00 +0300\t2.9\nbozuk\t1\n27/Oct/2026:10:00:01 +0300\t-\n',
    'diger_R1_h_2.tsv.gz': zlib.gzipSync('27/Oct/2026:10:00:00 +0300\t3\n'),
    'NOT.txt': '\n  \n  portal run 17  (2026-10-27, h)\nikinci\n',
    'konf_R1_h.txt': '# konf_R1_h: x\n# dosya_sayisi=12 ozet=0123abcd\n',
    'zaman.csv': '\ufefftur,bas_epoch,bit_epoch,rc,deneme\r\nR1_K_yeni_br_250_r1,1,2,0,1\r\n',
  }));
  assert.deepEqual(v.istemci.map((x) => x.satir.tur), ['R1_K_yeni_br_250_r1'], 'tur alani bos satir atilir');
  assert.deepEqual(v.hataliIstemci.map((x) => [x.dosya, x.satir.tur]), [['hatali_istemci_R1_K_yeni_br_400_r1.csv', 'R1_K_yeni_br_400_r1']]);
  assert.equal(v.zaman[0].tur, 'R1_K_yeni_br_250_r1', 'BOM ve CRLF');
  const [k1, k2] = v.kesitler;
  assert.equal(k1.anahtar, 'R1_h');
  assert.equal(k1.bilgiVar, true);
  assert.equal(k1.bilgi.nproc, '8');
  assert.equal(k1.bilgi.clk_tck, '100');
  assert.deepEqual(k1.bilgi.uyari, ['a=b', 'c']);
  assert.deepEqual(k1.bilgi.gecersiz, ['log_dondu:x.log']);
  assert.equal(k1.bilgi['# yorum'], undefined);
  assert.equal(k2.anahtar, 'R1_h_2');
  assert.equal(k2.bilgiVar, false);
  assert.deepEqual([...k2.bilgi.uyari], ['bilgi dosyasi yok']);
  const t0 = Date.UTC(2026, 9, 27, 7, 0, 0) / 1000;
  assert.deepEqual([...v.diger], [[t0, 5]], 'iki dosya toplanir; int(2.9) = 2; "-" atlanir');
  assert.equal(v.not, 'portal run 17  (2026-10-27, h)');
  assert.deepEqual(v.konf, [{ dosya: 'konf_R1_h.txt', dosya_sayisi: 12, ozet: '0123abcd' }]);
  assert.ok(v.dosyalar.some((x) => x.ad === 'istemci_R1_K_yeni_br_250_r1.json'), 'json listelenir');
});

test('SN14 gzip saydam: ayni fikstur .gz ile ve .gz olmadan okununca log deposu ve okunan bayt ayni', async () => {
  const k = standart('R2', { hizlar: [100], tekrar: 2 });
  k.yarim({ hiz: 100, r: 3 });
  const dosyalar = k.dosyalar();
  // SHA256SUMS'siz: .gz adlari listeyi 3'er bayt uzatirdi.
  const a = await kosuDiziniOku(portalDuzeniYaz(path.join(KOK, 'gz1'), dosyalar, { gz: true, sha: false }));
  const b = await kosuDiziniOku(portalDuzeniYaz(path.join(KOK, 'gz2'), dosyalar, { gz: false, sha: false }));
  assert.deepEqual(a.log, b.log);
  assert.equal(a.okunanBayt, b.okunanBayt, 'tavan ACILMIS bayti sayar');
  assert.deepEqual(a.loglar.map((l) => l.satir), b.loglar.map((l) => l.satir));
  assert.ok(a.loglar[0].dosya.endsWith('.tsv.gz') && b.loglar[0].dosya.endsWith('.tsv'));
  assert.equal(a.hataliIstemci.length, 1);
  assert.equal(a.log.turlar.size, 3);
});

test('SN15 Kurgu ornegi: okunan dosya kumesi ve kesit bilgisi', async () => {
  const k = new Kurgu('R3');
  k.kosu({ hiz: 250 });
  const v = await kosuDiziniOku(portalDuzeniYaz(path.join(KOK, 'k3'), k.dosyalar()));
  assert.deepEqual(v.dosyalar.map((x) => x.ad), [
    'NOT.txt', 'SHA256SUMS', 'baslatilan.csv', 'bilgi_R3_test.txt', 'istemci_R3_K_yeni_br_250_r1.csv',
    'istemci_R3_K_yeni_br_250_r1.json', 'konf_R3_test.txt', 'log_R3_test.tsv.gz', 'sunucu_R3_test.csv', 'zaman.csv',
  ]);
  assert.equal(v.baslatilan[0].tur, 'R3_K_yeni_br_250_r1');
  assert.equal(v.kesitler[0].bilgi.nproc, '8');
  assert.equal(v.log.turlar.get('R3_K_yeni_br_250_r1').n, 1400);
  assert.ok(v.okunanBayt > 0);
});

/** Tek log satiri (LOG_BAS kolonlariyla). */
function logSatiri(tur) {
  return [tur, 'olcum', '27/Oct/2026:10:00:00 +0300', '200', '/a', '0.010', '10', '1', '1'].join('\t');
}
const logDosyasi = (turlar) => LOG_BAS + turlar.map(logSatiri).join('\n') + '\n';
const sirali = (n, onek) => Array.from({ length: n }, (_, i) => `${onek}${i}`);

test('SN16 adim suzgeci: baska ADIM in log satiri depoya girmez, TEK uyariyla sayilir; adim yoksa suzgec yok', async () => {
  const d = yeniDizin({
    // 'R10_' / 'R1' / 'X' baska ADIM (alt cizgi siniri: R10, R1'in uzantisi DEGIL); kolonu eksik satir bozuktur.
    'log_R1_h.tsv': logDosyasi(['R1_K_yeni_br_250_r1', 'R10_K_yeni_br_250_r1', 'R1', 'X', 'R1_K_yeni_br_250_r1']) + 'R1_K_yeni_br_250_r1\tolcum\n',
    // Ikinci dosya (gzip) ayni sayaca eklenir; buyuk-kucuk harf duyarli ('r1_' baska ADIM).
    'log_R1_h_2.tsv.gz': zlib.gzipSync(logDosyasi(['R2_K_yeni_br_100_r1', 'R1_K_yeni_br_100_r1', 'r1_K_yeni_br_100_r1'])),
  });
  const v = await kosuDiziniOku(d, { adim: 'R1' });
  assert.deepEqual([...v.log.turlar.keys()], ['R1_K_yeni_br_250_r1', 'R1_K_yeni_br_100_r1']);
  assert.equal(v.log.turlar.get('R1_K_yeni_br_250_r1').n, 2);
  // satir = depoya giren, atlanan = bozuk; baska ADIM satiri ikisine de girmez.
  assert.deepEqual(v.loglar.map((l) => [l.dosya, l.satir, l.atlanan]), [['log_R1_h.tsv', 2, 1], ['log_R1_h_2.tsv.gz', 1, 0]]);
  assert.deepEqual(v.uyarilar.filter((u) => u.startsWith('log_baska_adim_satiri')), ['log_baska_adim_satiri:5'], 'iki dosyanin toplami, TEK uyari');
  // adim verilmezse (eski cagri / null / undefined) suzgec yok, uyari yok.
  for (const secenek of [undefined, {}, { adim: null }, { adim: undefined }]) {
    const h = await kosuDiziniOku(d, secenek);
    assert.equal(h.log.turlar.size, 7, JSON.stringify(secenek));
    assert.ok(!h.uyarilar.some((u) => u.startsWith('log_baska_adim_satiri')), JSON.stringify(secenek));
  }
  // Butun satirlar bu ADIM'inse uyari yok.
  const temiz = await kosuDiziniOku(yeniDizin({ 'log_R1_h.tsv': logDosyasi(['R1_K_yeni_br_250_r1']) }), { adim: 'R1' });
  assert.deepEqual(temiz.uyarilar, ['SHA256SUMS_yok(butunluk_dogrulanamadi)']);
  // Gecersiz adim programlama hatasidir (poller 'R' + id verir).
  for (const adim of ['', 'R1_x', 'R 1', 17, {}]) {
    await assert.rejects(() => kosuDiziniOku(d, { adim }), TypeError, `adim=${JSON.stringify(adim)}`);
  }
});

test('SN17 log deposunda en cok 64 farkli TUR; fazlasi OKUNAMADI, suzgecle elenen sayilmaz', async () => {
  const d64 = yeniDizin({ 'log_R1_h.tsv': logDosyasi(sirali(64, 'R1_T')) });
  assert.equal((await kosuDiziniOku(d64, { adim: 'R1' })).log.turlar.size, 64);
  const d65 = yeniDizin({ 'log_R1_h.tsv': logDosyasi([...sirali(64, 'R1_T'), 'R1_T0', 'R1_T64']) });
  // Metin aynen (depo dosyalar arasi ortak oldugundan dosya adi yok).
  await okunamadi(() => kosuDiziniOku(d65, { adim: 'R1' }), /^log dosyasinda 64'ten fazla farkli TUR \(Portal kosusu gibi gorunmuyor\)$/);
  await okunamadi(() => kosuDiziniOku(d65), /^log dosyasinda 64'ten fazla farkli TUR/);
  // Tavan depo genelinde: iki dosyaya bolunmus 65 TUR.
  const iki = yeniDizin({ 'log_R1_a.tsv': logDosyasi(sirali(40, 'R1_A')), 'log_R1_b.tsv': logDosyasi(sirali(25, 'R1_B')) });
  await okunamadi(() => kosuDiziniOku(iki, { adim: 'R1' }), /64'ten fazla farkli TUR/);
  // Inceleme senaryosu (kucultulmus): 10.000 farkli yabanci TUR suzgecle elenir, tavana sayilmaz.
  const yabanci = yeniDizin({ 'log_R1_h.tsv': logDosyasi([...sirali(10000, 'X'), ...sirali(3, 'R1_T')]) });
  const v = await kosuDiziniOku(yabanci, { adim: 'R1' });
  assert.equal(v.log.turlar.size, 3);
  assert.ok(v.uyarilar.includes('log_baska_adim_satiri:10000'), v.uyarilar.join(' | '));
  // ... ama suzgecsiz okumada ayni dosya tavana takilir (okuma 65. TUR'da kesilir).
  await okunamadi(() => kosuDiziniOku(yabanci), /64'ten fazla farkli TUR/);
  // LogDeposu dogrudan: var olan TUR'a ekleme serbest, 65. TUR atar.
  const depo = new sonuc.LogDeposu();
  for (const t of sirali(64, 'T')) depo.ekle(t, 'olcum', 1, 200, null, null, null, null);
  depo.ekle('T0', 'olcum', 2, 200, null, null, null, null);
  assert.throws(() => depo.ekle('T64', 'olcum', 1, 200, null, null, null, null), (e) => e.code === 'OKUNAMADI');
  assert.equal(depo.turlar.size, 64);
});

test('SN18 Kolon baslangic kapasitesi 16, ikiye katlayarak buyur; bitir tam boy kopya verir', () => {
  const depo = new sonuc.LogDeposu();
  depo.ekle('T', 'olcum', 1, 200, 0.01, 1, 10, 1);
  const k = depo.turlar.get('T');
  for (const ad of ['faz', 't', 'durum', 'rt', 'cr', 'bl', 'd']) assert.equal(k[ad].a.length, 16, `${ad} kapasitesi`);
  for (let i = 2; i <= 16; i++) depo.ekle('T', 'olcum', i, 200, null, null, null, null);
  assert.equal(k.t.a.length, 16, '16 satir sigar');
  depo.ekle('T', 'olcum', 17, 200, null, null, null, null);
  assert.equal(k.t.a.length, 32, '17. satirda iki katina');
  const b = depo.bitir().turlar.get('T');
  assert.equal(b.n, 17);
  assert.equal(b.t.length, 17);
  assert.deepEqual([...b.t], Array.from({ length: 17 }, (_, i) => i + 1));
});

test('SN19a satir tavani: zaman/baslatilan 2000, istemci/hatali_istemci 100 (bos satir sayilmaz); fazlasi dosya adiyla OKUNAMADI', async () => {
  const csv = (bas, n, satir) => bas + '\n' + Array.from({ length: n }, (_, i) => satir(i)).join('\n') + '\n';
  const zaman = (n) => csv('tur,bas_epoch,bit_epoch,rc,deneme', n, (i) => `R1_T${i},1,2,0,1`);
  const basl = (n) => csv('tur,bas_epoch,deneme', n, (i) => `R1_T${i},1,1`);
  const ist = (n) => csv(KOLON.join(','), n, (i) => KOLON.map((k) => (k === 'tur' ? `R1_T${i}` : '1')).join(','));
  const v = await kosuDiziniOku(yeniDizin({
    'zaman.csv': zaman(2000) + '\n\n\n',
    'baslatilan.csv': basl(2000),
    'istemci_R1_K_yeni_br_250_r1.csv': ist(100),
    'hatali_istemci_R1_K_yeni_br_400_r1.csv': ist(100) + '\n',
  }));
  assert.deepEqual([v.zaman.length, v.baslatilan.length, v.istemci.length, v.hataliIstemci.length], [2000, 2000, 100, 100]);
  for (const [ad, icerik, n] of [
    ['zaman.csv', zaman(2001), 2000],
    ['baslatilan.csv', basl(2001), 2000],
    ['istemci_R1_K_yeni_br_250_r1.csv', ist(101), 100],
    ['hatali_istemci_R1_K_yeni_br_400_r1.csv', ist(101), 100],
  ]) {
    await okunamadi(() => kosuDiziniOku(yeniDizin({ [ad]: icerik })), new RegExp(`^${ad.replace(/\./g, '\\.')}: satir tavani asildi \\(en cok ${n} satir\\)$`));
  }
  // Inceleme senaryosu (8 MiB'lik 'a\n' zaman.csv; burada 100k satir: 8 MiB'yi diske yazmak testi
  // saniyelerce yavaslatir, okuyucu zaten 2001. satirda keser).
  await okunamadi(() => kosuDiziniOku(yeniDizin({ 'zaman.csv': 'tur\n' + 'a\n'.repeat(100000) })), /^zaman\.csv: satir tavani asildi \(en cok 2000 satir\)$/);
});

test('SN19b satir tavani: sunucu_*.csv en cok 20000 ornek (atlanan bozuk satir sayilmaz)', async () => {
  const sunucu = (n, bozuk = 0) => SUNUCU_BAS + Array.from({ length: n }, (_, i) => `${1800000000 + i},1,1,1,0,p,1,1,1,1,1,1,1,1`).join('\n') + '\n' + 'x,1\n'.repeat(bozuk);
  const v = await kosuDiziniOku(yeniDizin({ 'sunucu_R1_h.csv': sunucu(20000, 50) }));
  assert.equal(v.kesitler[0].ornekler.length, 20000);
  await okunamadi(() => kosuDiziniOku(yeniDizin({ 'sunucu_R1_h.csv': sunucu(20001) })), /^sunucu_R1_h\.csv: satir tavani asildi \(en cok 20000 satir\)$/);
});

test('SN19c satir tavani: diger_*.tsv en cok 20000 farkli saniye (dosyalar arasi ortak; tekrar eden saniye yeni anahtar degil)', async () => {
  const t0 = 1800000000;
  const diger = (bas, n) => 'time_local\tadet\n' + Array.from({ length: n }, (_, i) => `${tl(bas + i, 180)}\t1`).join('\n') + '\n';
  // 0..14999 ve 10000..19999: 20000 farkli saniye, 5000'i iki dosyada (toplanir); harita dolduktan
  // SONRA gelen bilinen saniye (t0) yeni anahtar degildir.
  const v = await kosuDiziniOku(yeniDizin({ 'diger_R1_h.tsv': diger(t0, 15000), 'diger_R1_h_2.tsv': diger(t0 + 10000, 10000) + `${tl(t0, 180)}\t4\n` }));
  assert.equal(v.diger.size, 20000);
  assert.deepEqual([v.diger.get(t0 + 12000), v.diger.get(t0 + 19999), v.diger.get(t0)], [2, 1, 5]);
  await okunamadi(() => kosuDiziniOku(yeniDizin({ 'diger_R1_h.tsv': diger(t0, 15000), 'diger_R1_h_2.tsv': diger(t0 + 10000, 10001) })),
    /^diger_R1_h_2\.tsv: anahtar tavani asildi \(en cok 20000 farkli saniye\)$/);
});

test('SN19d satir tavani: bilgi_*.txt uyari= / gecersiz= her biri en cok 2000; log= tavansiz', async () => {
  const bilgi = (u, g, l) => ['nproc=8', ...sirali(u, 'uyari=u'), ...sirali(g, 'gecersiz=g'), ...sirali(l, 'log=l').map((x) => `${x}.log|1|0|1|tamam`)].join('\n') + '\n';
  // Kaydedici /web_log altindaki HER *.log icin bir log= satiri yazar: cok vhost'lu hedefte yuzlerce olur
  // (5000 satir OKUNAMADI DEGIL). log= Python gibi son degeri tutar.
  const v = await kosuDiziniOku(yeniDizin({ 'sunucu_R1_h.csv': SUNUCU_BAS, 'bilgi_R1_h.txt': bilgi(2000, 2000, 5000) }));
  const b = v.kesitler[0].bilgi;
  assert.deepEqual([b.uyari.length, b.gecersiz.length, b.log, b.nproc], [2000, 2000, 'l4999.log|1|0|1|tamam', '8']);
  for (const [k, sayilar] of [['uyari', [2001, 0, 0]], ['gecersiz', [0, 2001, 0]]]) {
    await okunamadi(() => kosuDiziniOku(yeniDizin({ 'bilgi_R1_h.txt': bilgi(...sayilar) })),
      new RegExp(`^bilgi_R1_h\\.txt: ${k}= satir tavani asildi \\(en cok 2000 satir\\)$`));
  }
});

test('SN20 faz kodu haritasi 256 adla sinirli (UA faz alani sinirsiz farkli olabilir); tasan faz son kovada, cikti ayni', () => {
  const depo = new sonuc.LogDeposu();
  for (let i = 0; i < 1000; i++) depo.ekle('T', `f${i}`, i, 200, null, null, null, null);
  depo.ekle('T', 'f999', 1000, 200, null, null, null, null);
  depo.ekle('T', 'f3', 1001, 200, null, null, null, null);
  assert.equal(depo.fazlar.length, 256);
  assert.equal(depo.fazKod.size, 256, 'tasan faz adlari haritada birikmez');
  const b = depo.bitir();
  const faz = b.turlar.get('T').faz;
  assert.deepEqual([...faz.slice(253, 258)], [253, 254, 255, 255, 255]);
  assert.deepEqual([faz[1000], faz[1001]], [255, 3]);
  assert.equal(b.fazlar[255], 'f255');
});
