// server/audit/__tests__/spa-pattern.test.cjs — "bu uygulama SPA mi" kurali.
//
// GUN ICINDE IKI KARAR (2026-09-28):
//   1) Kural "-v0/-v1 ile de bitebilir" diye genisletildi (kullanici: "bazi SPA
//      uygulamalarinin standarta uymayan kalibi var, bence genisletelim").
//   2) Ayni gun GERI ALINDI (kullanici: "bu geliştirmeyi direkt geri alalım, -app-v ve
//      -app-emb-v kuralı tekrar geçerli olsun"). Surum eki SPA'ya OZGU degil - bir API de
//      "-v1" ile biter; ada bakip SPA demek uydurma bir olcute guvenmekti.
//
// Buradaki bekciler iki seyi korur:
//   * kural DAR kalir - genisletme yanlislikla geri gelmez,
//   * kural TEK YERDE durur - yeni bir kopya acilirsa ekranlar birbirini tutmaz.
//
// SIRADAKI: kullanicinin container icinde nginx process'i arayan betigi. Olcut adin
// yerine KANIT olacak; degisiklik spa-pattern.cjs'teki iki fonksiyonda yapilacak ve bu
// dosyadaki beklentiler o zaman birlikte guncellenecek.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isSpaApp, isSpaLabel, SPA_RE, SPA_PATTERN_LABEL } = require('../spa-pattern.cjs');

// Kurumsal kalip - SPA sayilir.
const STANDART = [
  'sube-portali-app-v1',
  'x-app-emb-v2',
  'fund-management-app-emb-v1',
  'cust-limit-mgmt-app-v0',
  'x-app-v0-y',
];
// Surum ekiyle biten ama kurumsal kalibi tasimayan adlar. Bir sure SPA sayildilar,
// GERI ALINDI - ad tek basina yeterli kanit degil.
const SURUM_EKLI = [
  'non-core-assets-v0',
  'doc-acceptance-frontend-v0',
  'digital-fast-limit-cf-v0',
  'disney-bonus-cfa-v0',
  'dlyd-prdct-rstrctring-v0',
  'investor-dps-mngmnt-v0',
];
// Ne kurumsal kalip ne surum eki.
const API = ['apigw', 'ps-api-orch-management', 'digi-money-transfers', 'some-backend'];

test('SP1: kural DAR - yalnizca kurumsal kalip SPA sayilir', () => {
  for (const a of STANDART) assert.equal(isSpaApp(a), true, a);
  for (const a of API) assert.equal(isSpaApp(a), false, a);
});

test('SP2: surum eki TEK BASINA SPA yapmaz (genisletme geri alindi)', () => {
  for (const a of SURUM_EKLI) {
    assert.equal(
      isSpaApp(a),
      false,
      `${a} yeniden SPA sayiliyor — genisletme geri geldi. Kullanici bunu 2026-09-28'de ` +
        `geri aldirdi; dogru olcut ad degil, container'da nginx process'i (bkz. spa-pattern.cjs).`,
    );
  }
  // Kural gercekten "-app-v/-app-emb-v icerir" olmali: kalibi tasiyan her ad SPA.
  for (const a of [...STANDART, ...SURUM_EKLI, ...API]) {
    assert.equal(isSpaApp(a), SPA_RE.test(a), `${a}: kural SPA_RE'den sapmis`);
  }
});

test('SP3: etiket kurali - alan adi kuyrugu karari ETKILEMEZ', () => {
  const APPS = '.apps.fw.garanti.com.tr';
  assert.equal(isSpaLabel('sube-portali-app-v1-kurumsal-prod' + APPS), true);
  assert.equal(isSpaLabel('fund-management-app-emb-v1-fund-management-ch' + APPS), true);
  assert.equal(isSpaLabel('non-core-assets-v0-front-architecture' + APPS), false);
  assert.equal(isSpaLabel('apigw' + APPS), false);
  // Yalniz ILK etikete bakilir: alan adindan SPA cikarilmamali.
  assert.equal(
    isSpaLabel('apigw.x-app-v1-sahte.example.com'),
    false,
    'alan adindan SPA cikarilmis',
  );
});

test('SP4: kalip TEK DOSYADA tanimli - kopya acilirsa ekranlar birbirini tutmaz', () => {
  const KOK = path.join(__dirname, '..', '..');
  const KAYNAK = path.join(KOK, 'audit', 'spa-pattern.cjs');
  const kopyalar = [];
  const gez = (dir) => {
    for (const ad of fs.readdirSync(dir)) {
      const tam = path.join(dir, ad);
      const st = fs.statSync(tam);
      // Bekciler kalibi metin olarak ANMAK zorunda (bu dosya gibi); onlar haric.
      if (st.isDirectory()) {
        if (ad === 'node_modules' || ad === '__tests__') continue;
        gez(tam);
      } else if (ad.endsWith('.cjs') && tam !== KAYNAK) {
        const src = fs.readFileSync(tam, 'utf8');
        if (/\/-app\(-emb\)\?-v\//.test(src)) kopyalar.push(path.relative(KOK, tam));
      }
    }
  };
  gez(KOK);
  assert.deepEqual(
    kopyalar,
    [],
    `SPA kalibi su dosyalarda YENIDEN tanimlanmis: ${kopyalar.join(', ')} — ` +
      `kural degisince biri unutulur ve ayni uygulama bir ekranda SPA, otekinde degil gorunur. ` +
      `Ozellikle onemli: nginx-process olcutu geldiginde TEK dosya degisecek.`,
  );
});

test('SP5: ekranda gosterilen kalip metni GERCEK kurali anlatir', () => {
  assert.equal(SPA_PATTERN_LABEL, '-app-v / -app-emb-v');
  // Genisletme geri alindi: metin surum ekinden SOZ ETMEMELI, yoksa ekran kullaniciya
  // uygulanmayan bir kurali anlatir.
  assert.doesNotMatch(SPA_PATTERN_LABEL, /surum|-v</i);
});
