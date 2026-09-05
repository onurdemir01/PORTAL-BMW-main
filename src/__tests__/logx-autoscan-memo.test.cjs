// src/__tests__/logx-autoscan-memo.test.cjs — SONSUZ KESIF DONGUSU: ekran tarafi bekcileri.
//
// KOK NEDEN: otomatik tarama hafizasi `AppNameStep` icinde bir `useRef`ti, ama
// `LogXWizardPage`teki `<div key={step}>` adim degistiginde o bileseni UNMOUNT/REMOUNT
// ediyor. Tarama akisi adimi ZORUNLU olarak degistiriyor:
//     ocp_app_name -> ocp_app_discovering -> ocp_app_name
// yani tarama biter bitmez ref `null`'a donuyor ve "bir kez tara" korumasi HIC
// calismiyordu. Sonuc onbellege yazilamadiysa sihirbaz ayni taramayi sonsuza kadar
// yeniden basliyordu.
//
// Bu bekcinin olcegi: hafiza REMOUNT SINIRININ USTUNDE mi duruyor.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// Bicim degil KURAL: prettier bu depoda tek seferde 14 bekci kirdi.
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

// YORUMLARI AT: bekci kendi ACIKLAMASIYLA eslesmemeli. Bu depoda tam olarak bu hata
// yapildi — yasakladigi ifadeyi yorumunda yazan bekci kendini bulup yesil kaliyordu.
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

const PAGE = read('components/logx_v2/LogXWizardPage.tsx');
const STEP = read('components/logx_v2/steps/ocp/AppNameStep.tsx');

test('AM1 tarama hafizasi SAYFA seviyesinde tanimli (remount sinirinin USTUNDE)', () => {
  assert.match(
    norm(PAGE),
    /const autoScanMemoRef = useRef<Map<string, number>>\(new Map\(\)\)/,
    'sayfa seviyesinde tarama hafizasi yok — bilesen ici ref remount ile sifirlanir',
  );
});

test('AM2 hafiza AppNameStep`e GERCEKTEN geciriliyor (tanim degil KULLANIM)', () => {
  // Bu depoda bekciler defalarca tanimlayicinin VARLIGIYLA eslesip, karar noktasindaki
  // kullanim silindiginde yesil kaldi. O yuzden prop GECISI aranir.
  assert.match(
    norm(PAGE),
    /autoScanMemo=\{autoScanMemoRef\.current\}/,
    'hafiza AppNameStep`e geciriliyor gorunmuyor — bilesen kendi ref`ine duser',
  );
});

test('AM3 AppNameStep otomatik taramayi PAYLASILAN hafizaya gore yapiyor', () => {
  const n = norm(STEP);
  assert.match(
    n,
    /const scanMemo = autoScanMemo \?\? localScanRef\.current;/,
    'paylasilan hafiza kullanilmiyor',
  );
  // KARAR SATIRI: tarama yalnizca hafizada YOKSA tetiklenmeli.
  assert.match(
    n,
    /if \(onDiscover && !scanMemo\.has\(key\)\)/,
    'otomatik tarama karari paylasilan hafizaya bakmiyor',
  );
  assert.match(
    n,
    /scanMemo\.set\(key, Date\.now\(\)\)/,
    'tarama sonrasi hafizaya yazilmiyor — koruma tek seferlik bile degil',
  );
});

test('AM4 eski bilesen-ici `autoScanRef` KALMADI', () => {
  // Kalirsa iki hafiza olur; biri remount ile sifirlanir ve dongu geri gelir.
  assert.ok(
    !/autoScanRef/.test(STEP),
    'bilesen ici autoScanRef hala duruyor — remount ile sifirlanan eski koruma',
  );
});

test('AM5 tarama kaydi OKUNAMADIGINDA otomatik tarama YAPILMAZ', () => {
  // "Hic taranmadi" ile "kaydi okuyamadim" ayni sey degil: kayit okunamiyorsa
  // taradiktan sonra da okunamayacak, yani otomatik tarama sonsuza kadar tekrarlanir.
  assert.match(
    norm(STEP),
    /if \(r\?\.scanUnknown\) return;/,
    'scanUnknown durumunda otomatik tarama durdurulmuyor — okunamayan kayit dongu uretir',
  );
});

test('AM6 elle tarama yolu KAPATILMADI (kullanicinin kacis yolu)', () => {
  // Otomatik taramayi kismak, kullaniciyi calisan bir yoldan mahrum birakmamali.
  assert.match(norm(STEP), /async function handleDiscover\(\)/, 'elle tarama yolu kaldirilmis');
});

test('AM7 is kaydi bulunamayan adimlar BOS KART birakmiyor', () => {
  // Eskiden bes dalda `if (!job) return null;` vardi: kullanici sonsuza kadar bos bir
  // kutuya bakiyor, cikis yolu bile bulamiyordu.
  const code = codeOnly(PAGE);
  const n = norm(code);
  // DEGISMEZ OLCUT: her `if (!job)` dali bir kurtarma karti render ETMELI.
  // Metni harfi harfine aramak yetmiyordu — ilk surum yalnizca
  // `if (!job) return null;` ariyordu ve suslu parantezli bicim
  // (`if (!job) { return null; }`) mutasyonda SESSIZCE geciyordu.
  const jobGuards = (n.match(/if \(!job\)/g) || []).length;
  const recoveries = (n.match(/<MissingJobCard/g) || []).length;
  assert.ok(jobGuards > 0, 'is-kaydi kontrolu hic yok — test yanlis yere bakiyor');
  assert.equal(
    recoveries,
    jobGuards,
    `${jobGuards} adet "is bulunamadi" dali var ama ${recoveries} kurtarma karti — ` +
      'en az bir dal kullaniciyi BOS kartla birakiyor',
  );
  // Kurtarma gercekten cikis yolu vermeli.
  assert.match(n, /onRetry=\{\(\) => refresh\(requestId\)\}/, 'yenileme yolu yok');
  assert.match(n, /onRestart=\{restart\}/, 'bastan baslama yolu yok');
});
