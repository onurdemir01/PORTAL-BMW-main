// server/__tests__/fixtures/acilis-on.cjs — sunucu-acilis.test.js'in alt surecine `node -r` ile yuklenir.
//
// 1) dotenv etkisiz ve kayitli: gelistiricinin .env dosyalari (gercek DB adresi tasiyabilir) test
//    surecine girmez; giris noktasinin hangi dosyalari hangi sirayla istedigi stdout'a yazilir.
// 2) Dinlenen gercek port yazilir: sunucu PORT=0 ile acilir (paralel testlerde port yarisi yok),
//    acilis satiri ise yapilandirilan degeri (`:0`) yazar.
// 3) ACILIS_SAHTE (JSON) acilis adimlarina hata ya da deger enjekte eder:
//      { "boz": [["opsx/index.cjs", "initOpsX"]], "setupTablesBoz": true,
//        "envOverrides": { "PORT": "0" } | "boz", "yakalanmamis": true }
//    Giris noktasi bazi islevleri yuklenirken yapi bozumuyla alir (initAuth, setupTables): bu
//    yuzden degisim giris noktasi yuklenmeden ONCE, burada yapilir.
// 4) SIGTERM -> process.exit(0): kapsam verisi (NODE_V8_COVERAGE) yalniz duzgun cikista yazilir.
'use strict';

const path = require('node:path');
const net = require('node:net');

const SERVER = path.join(__dirname, '..', '..');
const KOK = path.join(SERVER, '..');

const dotenv = require('dotenv');
dotenv.config = (secenek = {}) => {
  console.log(`[acilis-on] dotenv ${path.relative(KOK, secenek.path)}`);
  return { parsed: {} };
};

const asilListen = net.Server.prototype.listen;
net.Server.prototype.listen = function listen(...argumanlar) {
  this.once('listening', () => console.log(`[acilis-on] port ${this.address().port}`));
  return asilListen.apply(this, argumanlar);
};

const sahte = JSON.parse(process.env.ACILIS_SAHTE || '{}');

for (const [modul, islev] of sahte.boz || []) {
  require(path.join(SERVER, modul))[islev] = () => {
    throw new Error(`sahte ${islev} hatasi`);
  };
}
if (sahte.setupTablesBoz) {
  require(path.join(SERVER, 'db', 'mssql-setup.cjs')).setupTables = async () => {
    throw new Error('sahte setupTables hatasi');
  };
}
if ('envOverrides' in sahte) {
  require(path.join(SERVER, 'db', 'env-overrides.cjs')).loadEnvOverrides = async () => {
    if (sahte.envOverrides === 'boz') throw new Error('sahte override hatasi');
    Object.assign(process.env, sahte.envOverrides);
  };
}
if (sahte.yakalanmamis) {
  // Giris noktasinin dinleyicileri esitzamanli kodda kurulur; zamanlayici ondan SONRA atar. Red
  // BILEREK yakalanmaz (`void`: beklenmedigi acik); sinanan, surecin buna ragmen dusmemesi.
  setTimeout(() => {
    void Promise.reject(new Error('sahte red'));
    setTimeout(() => {
      throw new Error('sahte istisna');
    }, 0);
  }, 0);
}

process.on('SIGTERM', () => process.exit(0));
