// server/ansible/__tests__/scalex-precheck-toplu.test.cjs
//
// PRECHECK TOPLU OKUMA — uygulama basina degil, namespace basina.
//
// OLCULDU (bu bekcilerin fixture'i, GERCEK betik): 5 uygulamalik `stop`
// precheck'i 64, `restore` precheck'i 104 `oc` cagrisi yapiyordu. Bastion
// uzerinden cagri basina ~150 ms; 19 uygulama x 3 cluster'da precheck tek
// basina dakikalar suruyordu.
//
// IKI SEY BIRLIKTE KORUNUR:
//   * HIZ: cagri sayisi uygulama sayisindan BAGIMSIZ (J1).
//   * DOGRULUK: satirlar BIREBIR ayni (J2). Altin cikti toplu okumaya gecmeden
//     ONCEKI betikle uretildi; rapor bu satirlardan kuruluyor.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SENARYOLAR, HARITA, kostur } = require('./fixtures/scalex-precheck-senaryolar.cjs');
const ALTIN = require('./fixtures/scalex-precheck-altin.json');

// Yerel cagrilar (ikili secimi) aga cikmaz; butceye sayilmaz.
const agda = (cagrilar) => cagrilar.filter((c) => !/^version --client\b/.test(c));

// ── J2: SATIRLAR BIREBIR AYNI ───────────────────────────────────────────────
//
// On senaryo: harita/auto/istenen tip; stop/restore/scale; yetki reddi; API'si
// olmayan tip; okunamayan tip; durum kaydi listesi yasak. Son uc, toplu
// okumanin YETKILI OLMADIGI hallerde eski yola dustugunu da kanitlar — orada
// dizini kullanmak var olan bir uygulamayi "bulunamadi" diye reddederdi.
for (const [ad, senaryo] of Object.entries(SENARYOLAR)) {
  test(`J2 precheck satirlari altin ciktiyla BIREBIR ayni: ${ad}`, () => {
    const { satirlar } = kostur(senaryo);
    assert.deepEqual(satirlar, ALTIN[ad]);
  });
}

// ── J1: CAGRI SAYISI UYGULAMA SAYISINDAN BAGIMSIZ ───────────────────────────
//
// KORLUK PANZEHIRI: yalnizca kucuk N ile olcmek, uygulama basina kalan bir
// cagriyi gizler. N=2 ve N=12 AYNI sayida cagri yapmali. J2 ayni anda
// sonucun degismedigini kilitliyor — cagri dusurmenin en kolay yolu
// kontrolleri silmek olurdu.
function nUygulama(n) {
  const adlar = Array.from({ length: n }, (_, i) => `app-${i}`);
  return {
    env: {
      ACTION: 'stop',
      WORKLOAD_KINDS: adlar.map((a) => `${a}=deploy`).join(','),
      APP_RAW: adlar.join(','),
    },
    model: {
      nesneler: { deploy: adlar.map((a) => ({ name: a, spec: 2 })), sts: [], dc: [], rollout: [] },
    },
  };
}
test('J1 precheck cagri sayisi uygulama sayisiyla ARTMIYOR', () => {
  const kucuk = kostur(nUygulama(2));
  const buyuk = kostur(nUygulama(12));
  const bicim = (c) => `${c.length} cagri:\n  ${c.join('\n  ')}`;
  assert.equal(
    agda(buyuk.cagrilar).length,
    agda(kucuk.cagrilar).length,
    `12 uygulama ${agda(buyuk.cagrilar).length}, 2 uygulama ${agda(kucuk.cagrilar).length} cagri — ` +
      `uygulama basina cagri kalmis. ${bicim(agda(buyuk.cagrilar))}`,
  );
  // Ve 12 uygulamanin HEPSI kontrol edilmis olmali.
  assert.equal(
    buyuk.satirlar.filter((l) => /;PRECHECK;OK;/.test(l)).length,
    12,
    'uygulamalarin bir kismi kontrol edilmemis',
  );
});

// ── J3: MUTLAK BUTCE ────────────────────────────────────────────────────────
test('J3 bes uygulamalik stop/restore precheck butcesi', () => {
  for (const ad of ['stop-harita', 'restore-harita']) {
    const c = agda(kostur(SENARYOLAR[ad]).cagrilar);
    // login + project + 9 can-i + hpa + cm + dizin + 4 tablo = 18 (onceden 64 / 104).
    assert.ok(c.length <= 18, `${ad}: ${c.length} cagri\n  ${c.join('\n  ')}`);
    // Uygulama adiyla yapilan TEK bir `get` bile kalmamali.
    const tekil = c.filter((x) =>
      /^get \S+ (odeme-api|kafka|eski-app|sifir-app|legacy-app|faz-app|scalex-state-|chaos-scale-state-)/.test(
        x,
      ),
    );
    assert.deepEqual(tekil, [], `${ad}: uygulama basina okuma kalmis`);
  }
});

// ── J4: TOPLU OKUMALAR AYNI ANDA ────────────────────────────────────────────
//
// Sure olculmuyor (duvar saati esigi makine yukunu olcer). Sahte `oc` her
// cagrinin baslangicini ve bitisini ayni log'a yazamiyor; bunun yerine
// "yavas" bir HPA listesi kurulur ve oteki okumalarin o bitmeden BASLADIGI
// cagri gunlugunun SIRASINDAN okunur: seri kosuda HPA'dan sonraki her cagri
// HPA bittikten sonra loglanir.
test('J4 hpa, durum kaydi ve is yuku dizini AYNI ANDA okunuyor (kaynak sirasi)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'bmw_portal/scalex/scalex_app/files/scalex_runner.sh'),
    'utf8',
  );
  const i = src.indexOf('pc_prefetch() {');
  const govde = src.slice(i, src.indexOf('\n}\n', i));
  // METIN BEKCISI (acikca): her okuma arka planda baslatilir ve SONRA hepsi
  // beklenir. Davranissal kanit: J3'teki 18 cagrinin seri kosulsa bile
  // gececegi dogru — bu yuzden sirayi yapisal olarak kilitliyoruz.
  for (const okuma of ['get hpa', 'get cm', 'get "$csv"', 'auth can-i']) {
    const j = govde.indexOf(okuma);
    assert.ok(j > 0, `${okuma} toplu okumada yok`);
    const satirSonu = govde.indexOf(') &', j);
    const sonrakiOkuma = govde.indexOf('oc ', j + okuma.length);
    assert.ok(
      satirSonu > 0 && (sonrakiOkuma < 0 || satirSonu < sonrakiOkuma),
      `${okuma} arka planda baslatilmiyor (seri)`,
    );
  }
  assert.match(govde, /for p in \$pids; do wait "\$p"/, 'arka plan okumalari beklenmiyor');
});

// ── J5: GERI DUSUS YOLUNDA AD ONBELLEGI GERCEKTEN TUTUYOR ───────────────────
//
// `cm="$(state_cm_name ...)"` alt kabukta kosuyordu; onbellege yazilan deger
// kayboluyor ve ayni uygulama icin ad aramasi her cagrida yeniden yapiliyordu
// (durum kaydi listesi yasakken eski-app icin 8 `get cm`).
test('J5 durum kaydi listesi yasakken ad aramasi uygulama basina BIR kez', () => {
  const { cagrilar } = kostur(SENARYOLAR['stop-cm-listesi-yasak']);
  const eski = cagrilar.filter((c) =>
    /^get cm (scalex-state-|chaos-scale-state-)eski-app -n ns1$/.test(c),
  );
  // Yeni onek yok -> eski onek var: iki arama, bir kez.
  assert.equal(eski.length, 2, `eski-app icin ${eski.length} ad aramasi:\n  ${eski.join('\n  ')}`);
});

// ── J6: YETKILI OLMAYAN DIZIN KULLANILMAZ ───────────────────────────────────
//
// StatefulSet listesi YASAK: dizinde `kafka` hic yok. Dizini kullanmak onu
// "bulunamadi" diye reddederdi; eski yol (tekil `get`) onu bulur. J2 satirlari
// kilitliyor; bu bekci geri dususun GERCEKTEN yapildigini ayrica gosterir.
test('J6 okunamayan tipte uygulama tekil okumayla bulunur (dizin "yok" demez)', () => {
  const { cagrilar, satirlar } = kostur({
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'kafka' },
    model: {
      yasakTipler: ['sts'],
      nesneler: { sts: [{ name: 'kafka', spec: 3 }], deploy: [], dc: [], rollout: [] },
    },
  });
  // Sahte `oc` liste yasagini tekil `get`e de uyguluyor (gercek RBAC'ta
  // `get` ile `list` ayri fiillerdir); yani burada BEKLENEN "bulunamadi".
  // Onemli olan, kararin dizinden degil TEKIL OKUMADAN gelmesi.
  assert.ok(
    cagrilar.some((c) => /^get sts kafka -n ns1$/.test(c)),
    'okunamayan tipte tekil okuma yapilmadi — dizinin "yok" cevabi yetkisiz kullanildi',
  );
  assert.ok(satirlar.some((l) => /;kafka;-;PRECHECK;FAIL;/.test(l)));
});

// ── J7: API'SI OLMAYAN TIP "YOK" DIYE YETKILI CEVAPTIR ──────────────────────
//
// Argo Rollouts ve DeploymentConfig kurulu olmayan bir cluster'da `auto`
// tespiti dort tipin DORDUNU de yetkili ister. Olmayan tipleri "bilinmiyor"
// saymak, her uygulama icin eski tekil yola (tip basina 3 aday) dusurur —
// sonuc ayni, maliyet uygulama sayisiyla carpilir.
test('J7 API`si olmayan tipler `auto` tespitini tekil okumaya DUSURMEZ', () => {
  const { cagrilar } = kostur(SENARYOLAR['stop-auto-iki-tip-yok']);
  const tekil = cagrilar.filter((c) => /^get \S+ (odeme-api|kafka|yok-app)\b/.test(c));
  assert.deepEqual(tekil, [], `uygulama basina tespit okumasi yapilmis:\n  ${tekil.join('\n  ')}`);
});
