// server/logx/v2/__tests__/legacy-inventory-readonly.test.cjs
// ELLE GIRILEN AD ENVANTERE YAZILMAZ.
//
// KULLANICI KARARI (2026-09-08): "listede yoksa elle girme ... ile job calissin ama
// db ye bu eklenmesin, duzenli taramalarla eklensin".
//
// Bu bugun DOGRU: kurumsal uygulama envanteri (`MWAppsInventory`, bkz.
// server/config/apps-table.cjs) portalin kendi semasi DEGIL — ayri bir havuzda
// (server/inventory/mssql.cjs) yasar ve portal oraya yalnizca SELECT atar. Ama bu
// karar HICBIR YERDE OLCULMUYORDU: "kullanici zaten yaziyor, kaydedelim de listede
// gorunsun" diyen tek satirlik bir ekleme sessizce girebilirdi ve ortaya cikan sey
// gercek envanterle karisan, tarama tarafindan asla dogrulanmamis kayitlar olurdu.
//
// Ekrandaki soz de burada kilitlenir (IR4): kullaniciya "envantere kaydedilmez"
// deniyorsa, kodun bunu GERCEKTEN yapiyor olmasi gerekir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const LOGX = path.join(ROOT, 'server', 'logx');

function cjsFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.cjs')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// Yalnizca CALISAN metin: bu dosyanin da, kaynagin da aciklamalarinda "INSERT" gibi
// kelimeler geciyor. Bekcinin kendi belgesini kod sanmasi bilinen bir korluk deseni.
const codeOnly = (src) =>
  src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

const WRITE_VERB = /\b(INSERT\s+INTO|UPDATE\s+[A-Za-z_${]|MERGE\s+[A-Za-z_${]|DELETE\s+FROM)\b/i;

test('IR1 uygulama envanteri tablosuna atilan HER sorgu SELECT', () => {
  const bulunan = [];
  for (const f of cjsFiles(LOGX)) {
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    // Tablo adi sablonla geliyor: `... FROM ${getAppsTable()} ...`
    for (const m of src.matchAll(/`([^`]*\$\{getAppsTable\(\)\}[^`]*)`/g)) {
      const metin = m[1].replace(/\s+/g, ' ').trim();
      // SQL OLMAYANI ELE. Tablo adi bir LOG MESAJINDA da geciyor
      // ("[LogXv2] ${getAppsTable()} sorgusu basarisiz...") ve bekcinin ilk hali onu
      // "SELECT ile baslamayan sorgu" sanip sahte kirmizi verdi.
      if (!/\b(SELECT|INSERT|UPDATE|MERGE|DELETE)\b/i.test(metin)) continue;
      bulunan.push({ file: path.relative(ROOT, f), sql: metin });
    }
  }

  // Toplayici yanlis dizine bakarsa bekci bos kumeyle sessizce yesil kalmasin.
  assert.ok(
    bulunan.length >= 4,
    `yalnizca ${bulunan.length} envanter sorgusu goruldu (>=4 bekleniyor) — toplayici bozuk`,
  );

  const yazanlar = bulunan.filter((q) => !/^SELECT\b/i.test(q.sql));
  assert.deepEqual(
    yazanlar.map((q) => `${q.file}: ${q.sql.slice(0, 90)}`),
    [],
    'Uygulama envanterine SELECT DISI bir sorgu atiliyor.\n' +
      'Bu tablo portalin degil, kurumsal envanterin; oraya yalnizca duzenli tarama yazar.\n' +
      'Elle girilen adin buraya kaydedilmesi, tarama tarafindan hic dogrulanmamis\n' +
      'kayitlarin gercek envanterle karismasi demektir (kullanici karari, 2026-09-08).',
  );
});

test('IR2 kurumsal envanter havuzunu kullanan dosyalarda YAZMA fiili yok', () => {
  // IR1 tablo ADINA bakar; bu kural HAVUZA bakar. Baska bir tabloya yazan yeni bir
  // sorgu (ornegin "elle girilenleri ayri bir tabloya kaydedelim") IR1'i gecerdi.
  const kullananlar = [];
  for (const f of cjsFiles(LOGX)) {
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    if (!/require\(['"][^'"]*inventory\/mssql\.cjs['"]\)/.test(src)) continue;
    kullananlar.push(path.relative(ROOT, f));
    const m = src.match(WRITE_VERB);
    assert.equal(
      m,
      null,
      `${path.relative(ROOT, f)}: kurumsal envanter havuzunu kullanan dosyada yazma fiili var: ` +
        `"${m && m[0]}"`,
    );
  }
  assert.ok(kullananlar.length >= 1, 'kurumsal envanter havuzunu kullanan dosya bulunamadi');
});

test('IR3 discover() elle girilen adi YALNIZCA istek kaydina ve denetime yaziyor', () => {
  const src = codeOnly(fs.readFileSync(path.join(LOGX, 'v2', 'legacy.cjs'), 'utf8'));

  // Fonksiyonun TAM govdesi (suslu parantez esleyerek). Sabit pencere bu depoda
  // defalarca komsu koda tasip bekciyi kor birakti.
  const i = src.indexOf('async function discover(');
  assert.ok(i >= 0, 'discover() bulunamadi');

  // GOVDE, PARAMETRE LISTESINDEN SONRA BASLAR.
  //
  // `indexOf('{', i)` YETMEZ: imza `discover(requestRow, app, selectedHosts, options = {})`
  // ve oradaki `{}` VARSAYILAN PARAMETRE. Bekcinin ilk hali onu govde baslangici sanip
  // imzayi "govde" olarak cikardi ve icinde manualHosts bulamayip sahte kirmizi verdi.
  // Once parametre listesinin kapanis parantezi bulunur.
  let paren = 0;
  let afterParams = -1;
  for (let k = src.indexOf('(', i); k < src.length; k++) {
    if (src[k] === '(') paren++;
    else if (src[k] === ')' && --paren === 0) {
      afterParams = k;
      break;
    }
  }
  assert.ok(afterParams > 0, 'discover() parametre listesi kapanmadi');

  let depth = 0;
  let end = -1;
  for (let k = src.indexOf('{', afterParams); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) {
      end = k;
      break;
    }
  }
  const fn = src.slice(i, end + 1);

  assert.doesNotMatch(fn, WRITE_VERB, 'discover() bir yazma sorgusu iceriyor');
  assert.match(fn, /manualHosts/, 'elle girilen sunucular izlenmiyor');
  assert.match(fn, /manualApp/, 'elle girilen uygulama izlenmiyor');
  // Kalici tek yer: istek kaydi (logx_v2_requests). Denetim kaydi route katmaninda.
  assert.match(
    fn,
    /requests\.updateRequest\(/,
    'elle giris istek kaydina yazilmiyor — "bu is nereye gitti" sorusu cevapsiz kalir',
  );
});

test('IR4 ekrandaki SOZ yazili (kullaniciya verilen taahhut)', () => {
  const steps = [
    'src/components/logx_v2/steps/legacy/AppSearchStep.tsx',
    'src/components/logx_v2/steps/legacy/HostSelectStep.tsx',
  ];
  for (const rel of steps) {
    const ui = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ');
    assert.match(
      ui,
      /envantere kaydedilmez/i,
      `${rel}: "envantere kaydedilmez" sozu ekranda YOK — kullanici elle yazdiginin ` +
        'kaydedildigini sanabilir',
    );
    assert.match(
      ui,
      /düzenli taramayla güncellenir/i,
      `${rel}: adin envantere NASIL girecegi yazmiyor — kullanici ne yapacagini bilemez`,
    );
  }
});
