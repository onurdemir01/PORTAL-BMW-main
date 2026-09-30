// server/ansible/__tests__/fixtures/scalex-execute-senaryolar.cjs
//
// Execute ALTIN CIKTI senaryolari. Altin dosya (`scalex-execute-altin.json`)
// toplu execute'a gecilmeden ONCEKI betikle (origin/main) uretildi.
//
// IKI SEY KARSILASTIRILIR:
//   * SATIRLAR — uygulama BASINA sirasiyla. Toplu yol uygulamalari faz faz
//     isler; uygulamalar arasi sira degisir ama rapor satirlari (cluster,
//     uygulama) ile gruplayip grup icindeki ILK satiri kullaniyor
//     (20_build_report.yml). Yani uygulama ICI sira korunmali, arasi degil.
//   * CLUSTER'IN SON DURUMU — replica sayilari, durum kayitlari, HPA
//     sabitlemesi. Ayni satirlari basip farkli bir son durum birakan bir
//     degisiklik, raporu dogru ama cluster'i yanlis birakirdi.
'use strict';

const { TEMEL_MODEL, HARITA, kostur } = require('./scalex-precheck-senaryolar.cjs');

const kopya = (x) => JSON.parse(JSON.stringify(x));
function modelle(degistir) {
  const m = kopya(TEMEL_MODEL);
  degistir(m);
  return m;
}
const nesne = (m, k, ad) => m.nesneler[k].find((o) => o.name === ad);

const SENARYOLAR = {
  'stop-harita': {
    env: {
      ACTION: 'stop',
      WORKLOAD_KINDS: HARITA,
      APP_RAW: 'odeme-api,kafka,eski-app,sifir-app,yok-app',
    },
    model: modelle((m) => {
      nesne(m, 'sts', 'kafka').gecikme = 1;
    }),
  },
  'restore-harita': {
    env: {
      ACTION: 'restore',
      WORKLOAD_KINDS: HARITA,
      APP_RAW: 'eski-app,legacy-app,faz-app,odeme-api',
    },
  },
  'scale-degisen': {
    env: { ACTION: 'scale', TARGET: '2', WORKLOAD_KINDS: HARITA, APP_RAW: 'odeme-api,kafka' },
  },
  'scale-zaten-hedefte': {
    env: { ACTION: 'scale', TARGET: '3', WORKLOAD_KINDS: HARITA, APP_RAW: 'odeme-api,kafka' },
  },
  // Takili uygulama: KAPATMA'da WARN sonra FAIL; digeri ETKILENMEMELI.
  'stop-takili': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'odeme-api,kafka' },
    model: modelle((m) => {
      nesne(m, 'sts', 'kafka').takili = true;
    }),
  },
  // ACMA'da takili: WARN applied=yes ve BASARILI; HPA sabitleme acikca istendi.
  'restore-takili-hpa-pin': {
    env: {
      ACTION: 'restore',
      WORKLOAD_KINDS: HARITA,
      APP_RAW: 'eski-app,faz-app',
      HPA_PIN: 'true',
    },
    model: modelle((m) => {
      nesne(m, 'deploy', 'faz-app').takili = true;
      m.hpa.push({ name: 'eski-hpa', target: 'eski-app', kind: 'DeploymentConfig' });
    }),
  },
  'stop-patch-red': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'kafka,odeme-api' },
    model: { patchRed: ['sts'] },
  },
  'stop-durum-yazilamaz': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'odeme-api,kafka' },
    model: { cmYazmaRed: true },
  },
};

/** Satirlari uygulama basina gruplar (uygulama ICI sira korunur). */
function uygulamaBasina(satirlar) {
  const g = {};
  for (const l of satirlar) {
    const app = l.split(';')[2];
    (g[app] = g[app] || []).push(l);
  }
  // Anahtarlar ADA gore: uygulamalarin ILK gorundugu sira toplu yolda degisir
  // ve rapor icin anlamsizdir (bkz. dosya basi).
  return Object.fromEntries(
    Object.keys(g)
      .sort()
      .map((k) => [k, g[k]]),
  );
}

/** Karsilastirilacak son durum: zaman damgalari atilir. */
function sonDurum(model) {
  const nes = {};
  for (const [k, liste] of Object.entries(model.nesneler || {}))
    for (const o of liste) nes[`${k}/${o.name}`] = o.spec;
  const cm = {};
  for (const [ad, d] of Object.entries(model.cm || {})) {
    const { created_at: _a, updated_at: _b, ...kalan } = d;
    cm[ad] = kalan;
  }
  return { nesneler: nes, cm, hpaPin: model.hpaPin || [] };
}

function executeKostur(senaryo, secenek = {}) {
  const r = kostur(senaryo, { ...secenek, faz: 'execute' });
  return { ...r, gruplu: uygulamaBasina(r.satirlar), son: sonDurum(r.model) };
}

module.exports = { SENARYOLAR, executeKostur, uygulamaBasina, sonDurum };
