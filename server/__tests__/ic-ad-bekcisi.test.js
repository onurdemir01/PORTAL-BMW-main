// server/__tests__/ic-ad-bekcisi.test.js — kurum ic adi bekcisi (K17, scripts/ic-ad-bekcisi.cjs).
//
// Ornekler calisma aninda birlestirilir (sir-tarama testleriyle ayni yol): bu dosyanin kendisi bekcinin
// --tum taramasina girer ve gercek bicimde bir ad tasimamalidir.
//   IA1 her desen kendi ornegini yakalar (buyuk / kucuk harf sunucu, istirak OCP, .com.tr alan adi)
//   IA2 kurgusal ve zararsiz bicimler bulgu DEGIL (OR oneki, *.invalid, joker *.com.tr, karisik harfli
//       base64, rakamsiz onek, sozcuk icindeki parca)
//   IA3 metinTara satir numarasi verir; commit mesajinda '#' satirlari atlanir; ikili dosya taranmaz
//   IA4 CLI --mesaj: ihlalde 1, temizde 0; bulunan DEGER ciktiya yazilmaz (CI gunlugu public)
//   IA5 kancalar ve CI bekciyi cagirir (K17 kapisi kapi.cjs'te; belge satiri kalite-kapilari.test.js'te)
//   IA6 kurum adi mantigi KURGUSAL ozetlerle: ayirt edici sozcuk, bilesik kimlik parcasi, "<marka> <unvan>"
//       ikilisi yakalanir; marka sozcugu TEK BASINA (siradan sozcuk) serbest
//   IA7 kurum ic agi mantigi KURGUSAL ozetlerle: 10.x /16, 192.168.x /24; komsu ag, kurgusal adres, surum
//       numarasi ve bes oktet yakalanmaz
//   IA8 gercek ozet listeleri bos degil ve bicimi dogru (64 hane hex); ad ya da ag metni tasimaz
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ia = require('../../scripts/ic-ad-bekcisi.cjs');

const KOK = path.join(__dirname, '..', '..');
const BETIK = path.join(KOK, 'scripts', 'ic-ad-bekcisi.cjs');
const oku = (f) => fs.readFileSync(path.join(KOK, f), 'utf8');

// Calisma aninda kurulan ornekler (dosyada gercek bicimde ad durmaz).
const ONEK = ['G', 'B'].join('');
const ornek = {
  buyuk: `${ONEK}NGXT${'33'}`,
  buyukHarfli: `${ONEK}RVPP${'01'}A`,
  kucuk: `${ONEK.toLowerCase()}ngxt${'33'}`,
  istirakOcp: `${'gi'}aocp${'01'}`,
  istirakHst: `${'gi'}hstp${'51'}`,
  dijital: `${'da'}ocpprod${'1'}`,
  alan: `smtp.${'kurum'}.com${'.tr'}`,
  eposta: `ali@${'ornek'}.com${'.tr'}`,
};

test('IA1 her desen kendi ornegini yakalar', () => {
  const sunucu = 'kurum sunucu adi';
  const istirak = 'istirak OCP / sunucu adi';
  const alan = 'kurum alan adi (.com.tr)';
  for (const [s, beklenen] of [
    [`delegate_to: ${ornek.buyuk}`, [sunucu]],
    [`hosts: ['${ornek.buyukHarfli}']`, [sunucu]],
    [`host=${ornek.kucuk} master=1`, [sunucu]],
    [`api.${ornek.istirakOcp}.fw:6443`, [istirak]],
    [`jump: ${ornek.istirakHst}`, [istirak]],
    [`kume ${ornek.dijital}`, [istirak]],
    [`SERVER=${ornek.alan},1453`, [alan]],
    [`mail_from: ${ornek.eposta}`, [alan]],
    [`name: /ui\\.apps\\.fw\\.${'kurum'}\\.com\\${'.tr'}/,`, [alan]], // regex icinde kacisli
    [`${ornek.buyuk} -> https://${ornek.alan}`, [sunucu, alan]],
    [`ad kurali ${ONEK}NGXT.. ve ${ONEK}RVP*`, ['kurum onekli ad kalibi']], // rakamsiz kalip
    [`https://${ONEK.toLowerCase()}ca.fw.ornek.invalid`, ['kurum onekli ad kalibi']], // kisa host etiketi
  ])
    assert.deepEqual(ia.satirTara(s), beklenen, s.replace(ONEK, '<onek>'));
});

test('IA2 kurgusal ve zararsiz bicimler bulgu degil', () => {
  for (const s of [
    'delegate_to: ORNGXT33', // kurgusal onek
    'host=orngxt33',
    'api.oiaocp01.fw.teknoloji.invalid:6443',
    'smtp.sirket.invalid',
    "'self' https://*.com.tr", // joker kamu soneki (ayar kurali bunu sinar)
    'https://portal.gov.tr',
    `"integrity": "sha512-BMhLD/Sw+${ONEK.charAt(0)}${ONEK.charAt(1).toLowerCase()}JC21C/Ugy"`, // karisik harf
    `${ONEK}18030 kodlamasi`, // onekten sonra harf yok
    `ab${ONEK}NGXT33`, // sozcuk icinde
    'kurum alan adi uzantisi `.com.tr`',
    'giris ve dagitim', // 'gi'/'da' ile baslayan siradan sozcukler
  ])
    assert.deepEqual(ia.satirTara(s), [], s);
});

test("IA3 metinTara satir verir; mesajda '#' atlanir; ikili dosya taranmaz", () => {
  const metin = ['temiz', `# yorum ${ornek.buyuk}`, `x ${ornek.alan}`].join('\n');
  assert.deepEqual(
    ia.metinTara(metin).map((b) => b.satir),
    [2, 3],
  );
  assert.deepEqual(
    ia.metinTara(metin, { yorumAtla: true }).map((b) => b.satir),
    [3],
  );
  assert.equal(ia.metinMi(Buffer.from('metin\n')), true);
  assert.equal(ia.metinMi(Buffer.from([0x89, 0x50, 0x00, 0x47])), false);
});

test('IA4 CLI --mesaj: ihlalde 1, temizde 0; deger ciktiya yazilmaz', () => {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-ad-'));
  const kirli = path.join(dizin, 'kirli');
  const temiz = path.join(dizin, 'temiz');
  fs.writeFileSync(kirli, `Yazici sunucu ${ornek.buyuk} oldu\n\nayrinti ${ornek.alan}\n`);
  fs.writeFileSync(temiz, 'Yazici sunucu AWX degiskeninden okunur\n');
  const k = spawnSync(process.execPath, [BETIK, '--mesaj', kirli], { encoding: 'utf8' });
  assert.equal(k.status, 1, k.stdout + k.stderr);
  const cikti = k.stdout + k.stderr;
  assert.match(cikti, /commit mesaji:1 {2}kurum sunucu adi/);
  assert.match(cikti, /commit mesaji:3 {2}kurum alan adi/);
  assert.ok(
    !cikti.includes(ornek.buyuk) && !cikti.includes(ornek.alan),
    'bulunan deger yazdirildi',
  );
  const t = spawnSync(process.execPath, [BETIK, '--mesaj', temiz], { encoding: 'utf8' });
  assert.equal(t.status, 0, t.stdout + t.stderr);
});

test('IA5 kancalar ve CI bekciyi cagirir', () => {
  assert.match(oku('.husky/pre-commit'), /^node scripts\/ic-ad-bekcisi\.cjs --staged$/m);
  assert.match(
    oku('.husky/commit-msg'),
    /^node scripts\/ic-ad-bekcisi\.cjs --mesaj "\$msg_file"$/m,
  );
  const ci = oku('.github/workflows/ci.yml');
  assert.match(ci, /node scripts\/ic-ad-bekcisi\.cjs --tum/);
  assert.match(ci, /node scripts\/ic-ad-bekcisi\.cjs --aralik "\$ARALIK"/);
  const { KAPILAR } = require('../../scripts/kapi.cjs');
  const k17 = KAPILAR.find((k) => k.id === 'K17');
  assert.ok(k17?.hizli, 'K17 hizli kapilarda (push oncesi) olmali');
  assert.deepEqual(k17.komut, ['node', 'scripts/ic-ad-bekcisi.cjs', '--tum']);
});

// Kurgusal sozcuk / ag ozetleri: gercek listeler yalniz ozet olarak bekcide durur (IA8 bicimini sinar).
const kurgu = (liste) => new Set(liste.map(ia.ozet));

test('IA6 kurum adi mantigi: ayirt edici sozcuk, bilesik parca ve ikili yakalanir; tek sozcuk serbest', () => {
  const oz = {
    tek: kurgu(['ornekkisaltma']),
    bilesikParca: ia.ozet('ornekmarka'),
    ikili: kurgu(['ornekmarka teknoloji']),
  };
  const var_ = (s) => ia.markaVar(s, oz);
  for (const s of [
    'kiraci ORNEKKISALTMA tarafi', // ayirt edici sozcuk (harf duyarsiz)
    'client-ornekkisaltma', // bilesik icindeki ayirt edici parca
    '-f ./ornekmarka_values.yaml', // bilesik kimlik parcasi
    '/etc/ssl/ornekmarka-root.pem',
    'fw.ornekmarka icinde',
    'Ornekmarka Teknoloji DMZ', // ikili
  ])
    assert.equal(var_(s), true, s);
  for (const s of [
    'bu sonuc ornekmarka eder', // marka sozcugu tek basina: siradan sozcuk
    'ORNEKMARKA DEGIL',
    'ornekmarkasi var', // ek almis sozcuk bilesik degil
    'Ornekmarka  Teknoloji', // iki bosluk: ikili degil
    'teknoloji ornekmarka',
  ])
    assert.equal(var_(s), false, s);
});

test('IA7 kurum ic agi mantigi: /16 ve /24 yakalanir; komsu, surum, bes oktet yakalanmaz', () => {
  const aglar = { s16: kurgu(['10.77']), s24: kurgu(['192.168.77']) };
  const var_ = (s) => ia.ipAgiVar(s, aglar);
  for (const s of ['proxy_pass http://10.77.1.2:3000/', 'dns 192.168.77.5', 'ip=10.77.0.0'])
    assert.equal(var_(s), true, s);
  for (const s of [
    '10.7.1.2',
    '10.177.1.2',
    '110.77.1.2', // onunde rakam
    '192.168.7.5',
    '192.168.177.5',
    '1.10.77.1.2', // bes oktet
    'surum 10.77.1.2.3',
  ])
    assert.equal(var_(s), false, s);
});

test('IA8 gercek ozet listeleri dolu ve bicimi dogru; ad ya da ag metni tasimaz', () => {
  const hex = /^[0-9a-f]{64}$/;
  for (const k of ['tek', 'ikili']) {
    assert.ok(ia.MARKA[k].size > 0, `MARKA.${k} bos`);
    for (const h of ia.MARKA[k]) assert.match(h, hex);
  }
  assert.match(ia.MARKA.bilesikParca, hex);
  for (const k of ['s16', 's24']) {
    assert.ok(ia.IP_AGLARI[k].size > 0, `IP_AGLARI.${k} bos`);
    for (const h of ia.IP_AGLARI[k]) assert.match(h, hex);
  }
});
