// server/audit/__tests__/denetim-mounts.test.cjs
//
// NEDEN VAR (2026-09-10 uretim hatasi): Denetim sekmesindeki HER SEY 404 donuyordu.
// Sebep: `server/audit/nginx-locations.cjs` ZATEN VARDI (24 Agustos'tan beri "Location
// Detayi" modulu, `registerNginxLocations` disa aktariyordu). Yeni bir ozet modulu
// AYNI YOLA yazilinca eski dosya USTUNE YAZILDI; initDenetim acilirken
// `require('./nginx-locations.cjs').registerNginxLocations is not a function` ile
// patladi. Modul `optional: true` oldugu icin sunucu ayaga kalkmaya DEVAM ETTI ve hata
// yalnizca bir uyari satiri olarak gecti - disaridan gorunen tek belirti 404'lerdi.
//
// Bu test o sessiz kirilmayi gurultulu hale getirir: initDenetim GERCEKTEN calistirilir.
// DB gerekmez - rotalar tanimlanirken sorgu atilmaz, yalniz kayit yapilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('initDenetim HATASIZ mount oluyor (alt modullerin hepsi cozulebiliyor)', () => {
  const app = express();
  assert.doesNotThrow(() => {
    require('../denetim.cjs').initDenetim(app);
  }, 'Denetim mount edilemezse sekmedeki TUM uclar 404 doner');
});

// Alt moduller ADIYLA ve BEKLENEN DISA AKTARIMLA cozulmeli. Dosya adi cakismasi ya da
// yanlislikla ustune yazma tam burada yakalanir.
const REQUIRED = [
  ['./app-envs.cjs', 'registerAppEnvs'],
  ['./web-app.cjs', 'registerWebApp'],
  ['./nginx-locations.cjs', 'registerNginxLocations'],
];

for (const [mod, fn] of REQUIRED) {
  test(`${mod} -> ${fn} dışa aktariliyor`, () => {
    const m = require('../' + mod.replace('./', ''));
    assert.equal(typeof m[fn], 'function', `${mod} icinde ${fn} yok - ustune yazilmis olabilir`);
  });
}

test('ozet modulleri AYRI dosyalarda (ad cakismasi yok)', () => {
  // nginx-locations.cjs  = Location Detayi rotasi (registerNginxLocations)
  // nginx-api-locations.cjs = API bazli ozetleyici (summarizeLocations)
  // Ikisi FARKLI islerdir; ayni ada konulmasi yukaridaki uretim hatasina yol acmisti.
  const detay = require('../nginx-locations.cjs');
  const ozet = require('../nginx-api-locations.cjs');
  assert.equal(typeof detay.registerNginxLocations, 'function');
  assert.equal(typeof ozet.summarizeLocations, 'function');
  assert.ok(!detay.summarizeLocations, 'iki modul birbirine karismis');
  assert.ok(!ozet.registerNginxLocations, 'iki modul birbirine karismis');
});
