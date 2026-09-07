// src/__tests__/scalex-stopped-scale.test.cjs — durdurulmus listesi OLCEKTE kullanilabilir mi.
//
// Liste `MIRROR_LIMIT` (500) satira kadar cikabiliyor. Kullanicinin gercek sorusu ise
// genellikle DAR: "dortten hangi ikisi geri alinamadi?", "su uygulama nerede
// durdurulmus?". Duz bir listede bu sorularin cevabi gozle taranarak bulunuyordu.
//
// EN ONEMLI KONTROL BURADA GUVENLIKLE ILGILI (SC5): suzgec eklemek, TOPLU GERI ALMAYI
// daraltmaz — sunucu ucu env/tenant kapsaminda calisir ve ekrandaki suzgeci BILMEZ.
// Kullanici listeyi 3 kayda daraltip "hepsini geri al" derse 100 kayit geri alinir.
// Bu fark ekranda ACIKCA yazmali.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'scalex', 'StoppedPanel.tsx'),
  'utf8',
);
const flat = SRC.replace(/\s+/g, ' ');
const codeOnly = SRC.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
  .join('\n');

test('SC1 arama var ve UC alanda birden calisir', () => {
  assert.match(codeOnly, /setQuery\(/, 'arama kutusu yok');
  // Uygulama adi tek basina yetmez: kullanici cogu zaman "su cluster'da ne durdurulmus"
  // ya da "su namespace" diye ariyor.
  for (const field of ['appName', 'scopeText', 'clusterName']) {
    assert.ok(
      flat.includes(`${field}.toLowerCase().includes(q)`),
      `arama ${field} alaninda calismiyor`,
    );
  }
});

test('SC2 "geri alinamadi" suzgeci var — kullanicinin ASIL sorusu', () => {
  assert.match(codeOnly, /onlyFailed/, 'basarisiz geri almalar suzulemiyor');
  assert.match(flat, /if \(onlyFailed && g\.failed === 0\) return false;/, 'suzgec uygulanmiyor');
});

test('SC3 suzgecler VARSAYILAN KAPALI (mevcut davranis degismesin)', () => {
  // YALNIZCA SUZGEC DURUMLARINA bakilir. Ilk halim dosyadaki HER `useState(true)`i
  // yasakliyordu ve ilgisiz bir durum (`loading`) yuzunden kirmizi donuyordu —
  // olcut, suzgeclerin KENDI varsayilani olmali.
  assert.ok(flat.includes("const [query, setQuery] = useState('')"), 'arama varsayilani bos degil');
  assert.ok(
    flat.includes('const [onlyFailed, setOnlyFailed] = useState(false)'),
    'onlyFailed varsayilan ACIK — mevcut davranis sessizce degisir',
  );
  assert.ok(
    flat.includes('const [onlyDrifted, setOnlyDrifted] = useState(false)'),
    'onlyDrifted varsayilan ACIK — mevcut davranis sessizce degisir',
  );
});

test('SC4 cip sayaclari SUZGECTEN BAGIMSIZ hesaplanir', () => {
  // Suzulmus listeden hesaplasaydik, cip acikken kendi sayisini gosterip
  // kapaliyken baska bir sayi gosterirdi — kullanici tiklamadan sonucu bilemezdi.
  assert.match(flat, /const allGroups = React\.useMemo\(/, 'suzgecten bagimsiz kume yok');
  assert.match(
    flat,
    /failedGroupCount = allGroups\.filter/,
    'sayac suzulmus listeden hesaplaniyor',
  );
  assert.match(flat, /\}, \[items\]\);/, 'sayac kumesi suzgeclere bagimli — dongusel');
});

test('SC5 TOPLU geri almanin suzgecten BAGIMSIZ oldugu ACIKCA yaziyor', () => {
  // Sunucu ucu (`/restore-all`) env/tenant kapsaminda calisir; ekrandaki suzgeci
  // BILMEZ. Bu fark soylenmezse kullanici 3 gorup 100 kayit geri alir.
  assert.match(codeOnly, /daraltmaz/, 'suzgecin toplu islemi daraltmadigi soylenmiyor');
  // Uyari yalnizca suzgec AKTIFKEN cikmali — her zaman gostermek gurultu olur ve
  // gurultu okunmaz.
  assert.match(
    flat,
    /\{\(query\.trim\(\) \|\| onlyFailed \|\| onlyDrifted\) && \(/,
    'uyari suzgec durumuna bagli degil',
  );
});

test('SC6 suzulmus/toplam sayisi HER ZAMAN gorunur', () => {
  // "Bos liste" ile "suzgec her seyi eledi" ayni ekran degildir.
  assert.match(
    flat,
    /\{groupedItems\.length\} \/ \{totalGroupCount\}/,
    'suzulmus/toplam sayaci yok',
  );
});
