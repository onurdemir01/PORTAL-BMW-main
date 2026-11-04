// server/server-hub/__tests__/fixtures/ear-envanter.cjs - Uygulama Envanteri testlerinin ortak fiksturu.
//
// sahteDb: SQL metnine gore (regex) yanit veren, her cagriyi kaydeden db modulu. require.cache'e
// server/db/index.cjs olarak konur; moduller db'yi cagri aninda require ettigi icin gecerli olur.
// paketYap: ear_tara.py'nin cikti bicimi (isaretler arasinda zlib + base64, 4000 karakterlik satirlar).
'use strict';

const path = require('node:path');
const zlib = require('node:zlib');

const DB_YOLU = path.join(__dirname, '..', '..', '..', 'db', 'index.cjs');

/**
 * kurallar: [[RegExp, (params, sql) => ({ rows, rowCount }) | undefined], ...]; ilk eslesen kural.
 * Eslesmeyen sorgu { rows: [], rowCount: 0 } doner ve `eslesmeyen`e yazilir.
 */
function sahteDb(kurallar = []) {
  const cagrilar = [];
  const eslesmeyen = [];
  const mod = {
    query: async (sql, params = [], opts = {}) => {
      cagrilar.push({ sql, params, opts });
      for (const [re, fn] of kurallar) {
        if (re.test(sql)) {
          const r = await fn(params, sql);
          return { rows: [], rowCount: 0, ...(r || {}) };
        }
      }
      eslesmeyen.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };
  return { mod, cagrilar, eslesmeyen };
}

function dbKur(sahte) {
  require.cache[DB_YOLU] = { id: DB_YOLU, filename: DB_YOLU, loaded: true, exports: sahte.mod };
}
function dbKaldir() {
  delete require.cache[DB_YOLU];
}

function paketYap(yuk, { bozukBase64 = false } = {}) {
  let b64 = zlib.deflateSync(Buffer.from(JSON.stringify(yuk)), { level: 6 }).toString('base64');
  if (bozukBase64) b64 = b64.slice(0, Math.floor(b64.length / 2));
  const satirlar = [];
  for (let i = 0; i < b64.length; i += 4000) satirlar.push(b64.slice(i, i + 4000));
  return Buffer.from(
    `onceki satir\r\n@@EAR_ENVANTER_BASLA@@\r\n${satirlar.join('\r\n')}\r\n@@EAR_ENVANTER_BITTI@@\r\n`,
  );
}

function ornekWar(ek = {}) {
  return {
    yol: 'ORNEKPANEL.war',
    ad: 'ORNEKPANEL.war',
    bicim: 'ACIK',
    durum: 'TAM',
    jsp: 12,
    tld: 3,
    jar: 4,
    class: 120,
    tld_dizini: true,
    web_xml: true,
    web_varyantlari: ['prod', 'test'],
    jboss_web_xml: true,
    jboss_deployment_structure: false,
    kutuphaneler: [
      ['spring-boot', '4.0.8', 1372569],
      ['spring-core', '7.0.9', 2035755],
      ['thymeleaf', '3.1.5.RELEASE', 945388],
      ['log4j-core', '2.24.3', 1900000],
    ],
    ...ek,
  };
}

function ornekUygulama(ek = {}) {
  return {
    kok: '/vhosting8',
    ad: 'ORNEKPANEL.ear',
    bicim: 'ACIK',
    durum: 'TAM',
    bag_hedefi: '',
    giris: 180,
    jsp: 12,
    tld: 3,
    jar: 4,
    class: 120,
    application_xml: true,
    ear_kutuphaneleri: [],
    warlar: [ornekWar()],
    yapi_izi: 'a1b2c3d4e5f60718',
    kutuphane_izi: '0011223344556677',
    uyari_sayisi: 0,
    uyarilar: [],
    satirlar: [
      ['ORNEKPANEL.war', 'D', 'drwxr-xr-x', 1001, 1001, 4096, 1761000000, 11, ''],
      ['ORNEKPANEL.war/index.jsp', 'F', '-rw-r--r--', 1001, 1001, 512, 1761000100, 12, ''],
    ],
    ...ek,
  };
}

function ornekYuk(ek = {}) {
  return {
    sema: 1,
    tarayici_surum: 1,
    host: 'appsrv01.ornek.local',
    kip: 'TAM',
    python: '3.6.8',
    uid: 1001,
    kullanici: 'svc',
    baslangic_utc: '2026-11-04T10:00:00Z',
    sinirlar: {},
    kokler: [
      { yol: '/vhosting', durum: 'YOK' },
      { yol: '/vhosting8', durum: 'VAR' },
    ],
    uygulamalar: [ornekUygulama()],
    durum: 'TAM',
    uyarilar: [],
    sure_sn: 1.25,
    giris: 180,
    ...ek,
  };
}

module.exports = { DB_YOLU, sahteDb, dbKur, dbKaldir, paketYap, ornekWar, ornekUygulama, ornekYuk };
