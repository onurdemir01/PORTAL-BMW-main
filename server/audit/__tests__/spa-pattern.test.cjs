// server/audit/__tests__/spa-pattern.test.cjs — "bu uygulama SPA mi" kurali.
//
// Kullanici (2026-09-28): "bazi SPA uygulamalarinin standarta uymayan kalibi var evet
// haklisin, bence genisletelim." Kural artik iki kalibi birden kabul ediyor ve BES
// dosyanin ortak kaynagi. Buradaki bekciler iki seyi korur:
//   * genisletme GERI ALMA degildir - eski kurala gore SPA olan her ad hala SPA,
//   * kural TEK YERDE durur - yeni bir kopya acilirsa ekranlar birbirini tutmaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isSpaApp, isSpaLabel, SPA_RE, SPA_PATTERN_LABEL } = require('../spa-pattern.cjs');

// Uretimde gorulen, ESKI kurala takilan ve bu yuzden "SPA degil" sayilan uygulamalar
// (kullanicinin ekran goruntusundeki "SPA olmayan hedefler" listesi).
const STANDART_DISI = [
  'non-core-assets-v0',
  'doc-acceptance-frontend-v0',
  'digital-fast-limit-cf-v0',
  'disney-bonus-cfa-v0',
  'dlyd-prdct-rstrctring-v0',
  'investor-dps-mngmnt-v0',
];
// Kurumsal standarda uyanlar - eskiden de SPA'ydilar, OYLE KALMALI.
const STANDART = [
  'sube-portali-app-v1',
  'x-app-emb-v2',
  'fund-management-app-emb-v1',
  'x-app-v0-y',
];
// Gercek API / arka uc: surum eki de tasimiyorlar.
const API = ['apigw', 'ps-api-orch-management', 'digi-money-transfers', 'some-backend'];

test('SP1: standarta uymayan surum ekli adlar da SPA sayilir', () => {
  for (const a of STANDART_DISI) assert.equal(isSpaApp(a), true, a);
});

test('SP2: GENISLETME, geri alma degil - eski kurala gore SPA olan her ad hala SPA', () => {
  for (const a of [...STANDART, ...STANDART_DISI]) {
    if (SPA_RE.test(a))
      assert.equal(isSpaApp(a), true, `${a} eski kurala gore SPA'ydi, artik degil`);
  }
  // Ve API'ler SPA sayilmamali: kural "her sey SPA" haline gelmis olmamali.
  for (const a of API) assert.equal(isSpaApp(a), false, a);
});

test('SP3: route adresi/etiketi icin surum eki ORTADA da olabilir', () => {
  const APPS = '.apps.fw.garanti.com.tr';
  // "<app>-<ns>" : surum eki ortada
  assert.equal(isSpaLabel('non-core-assets-v0-front-architecture' + APPS), true);
  assert.equal(isSpaLabel('fund-management-app-emb-v1-fund-management-ch' + APPS), true);
  // Uygulama adi tek basina (ns yok): sonda
  assert.equal(isSpaLabel('non-core-assets-v0' + APPS), true);
  // API adresleri
  assert.equal(isSpaLabel('apigw' + APPS), false);
  assert.equal(isSpaLabel('foreign-money-transfer-digi-money-transfers-ch-prod' + APPS), false);
  // Alan adi kuyrugu karari ETKILEMEZ: yalniz ilk etikete bakilir.
  assert.equal(isSpaLabel('apigw.v0-sahte.example.com'), false, 'alan adindan SPA cikarilmis');
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
        // Kuralin KENDISININ yeniden yazilmasi: /-app(-emb)?-v/ gibi bir regex tanimi.
        if (/\/-app\(-emb\)\?-v\//.test(src)) kopyalar.push(path.relative(KOK, tam));
      }
    }
  };
  gez(KOK);
  assert.deepEqual(
    kopyalar,
    [],
    `SPA kalibi su dosyalarda YENIDEN tanimlanmis: ${kopyalar.join(', ')} — ` +
      `kural degisince biri unutulur ve ayni uygulama bir ekranda SPA, otekinde degil gorunur.`,
  );
});

test('SP5: ekranda gosterilen kalip metni GERCEK kurali anlatir', () => {
  // Metin eski halinde kalirsa ("-app-v / -app-emb-v") kullanici, surum ekli uygulamalarin
  // neden SPA sayildigini ekranda hicbir yerde goremezdi.
  assert.match(SPA_PATTERN_LABEL, /-app-v/);
  assert.match(SPA_PATTERN_LABEL, /-v<surum>|-v\\d/);
});
