// server/app-hub/__tests__/app-hub-agir-paralel.test.cjs - JBoss ayrintisi agir JVM okumasi (2026-11-12).
//
// Eskiden sunucu basina SIRALI loadJvmAgir (her biri sema + JOIN): 60 sunucuda 120 sorgu ardi ardina.
//   AP1 sinirliParalel: sonuc girdi sirasinda, eszamanlilik tavani asilmaz
//   AP2 jbossDetay: cagrilar bir oncekinin bitmesini beklemeden baslar (<= 6 eszamanli),
//       bitis sirasi ters olsa da JVM listesi sunucu sirasinda; sema bir kez okunup paylasilir
//   AP3 bir sunucunun okumasi duserse yalniz o sunucunun agir alanlari bos, digerleri gelir
//   AP4 semaOku yoksa (eski Server Hub) eski cagri bicimi: loadJvmAgir(host) tek arguman
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const HOSTLAR = Array.from({ length: 10 }, (_, i) => `GOJBAP${String(i + 1).padStart(2, '0')}`);

sahte(require.resolve('../../inventory/mssql.cjs'), {
  sql: { NVarChar: () => 'nvarchar' },
  query: async (t) => {
    if (t.includes('FROM dbo.MWAppsInventory'))
      return { recordset: HOSTLAR.map((h) => ({ app: 'MUSTERI', host: h, env: 'Production' })) };
    return { recordset: [] };
  },
});
sahte(require.resolve('../../db/index.cjs'), { query: async () => ({ rows: [] }) });
sahte(require.resolve('../../config/apps-table.cjs'), {
  getAppsTable: () => 'MWAppsInventory',
  getWasAppsTable: () => 'WASAppsInventory',
});
sahte(require.resolve('../../retirement/discover.cjs'), {
  parseAppName: (a) => ({ base: String(a), env: 'PROD' }),
  discover: async () => ({ targets: [], summary: {} }),
});

const izler = { basla: [], bitir: [], anlik: 0, tepe: 0, sema: 0, argSayilari: [] };
const ayar = { dus: new Set(), gecikme: null };
function loadJvmAgir(host, opts) {
  izler.argSayilari.push(arguments.length);
  izler.basla.push(host);
  izler.anlik += 1;
  izler.tepe = Math.max(izler.tepe, izler.anlik);
  // Sonraki sunucu DAHA KISA surer: bitis sirasi girdi sirasinin tersi olur.
  const i = HOSTLAR.indexOf(String(host).split('.')[0]);
  return (async () => {
    try {
      if (opts && opts.kol) assert.equal((await opts.kol).ok, true);
      await bekle(ayar.gecikme ? ayar.gecikme(host) : 5 + (HOSTLAR.length - i) * 4);
      if (ayar.dus.has(host)) throw new Error('okunamadi');
      return new Map([[`8|musteri`, { jvm_args: `-Dhost=${host}` }]]);
    } finally {
      izler.anlik -= 1;
      izler.bitir.push(host);
    }
  })();
}
const shSahte = {
  getAssessment: async () => ({
    latestScan: '2026-11-12',
    hosts: HOSTLAR.map((h) => ({ host: h, fresh: true, scanDate: '2026-11-12', jvms: [{ name: 'MUSTERI', gen: 8, running: true }] })),
  }),
  loadJvmAgir,
  hostDetail: (h, agir) => ({
    jvms: h.jvms.map((j) => ({ ...j, jvmArgs: (agir.get(`${j.gen}|${j.name.toLowerCase()}`) || {}).jvm_args || null })),
  }),
};
loadJvmAgir.semaOku = async () => {
  izler.sema += 1;
  return { ok: true, cols: new Map() };
};
sahte(require.resolve('../../server-hub/index.cjs'), shSahte);

const V = require('../veri.cjs');

function sifirla() {
  Object.assign(izler, { basla: [], bitir: [], anlik: 0, tepe: 0, sema: 0, argSayilari: [] });
  ayar.dus = new Set();
  ayar.gecikme = null;
}

test('AP1 sinirliParalel: girdi sirasi ve tavan', async () => {
  const { sinirliParalel } = V._ic;
  let anlik = 0;
  let tepe = 0;
  const r = await sinirliParalel([30, 5, 20, 1, 10, 2, 8], 3, async (ms, i) => {
    anlik += 1;
    tepe = Math.max(tepe, anlik);
    await bekle(ms);
    anlik -= 1;
    return `${i}:${ms}`;
  });
  assert.deepEqual(r, ['0:30', '1:5', '2:20', '3:1', '4:10', '5:2', '6:8']);
  assert.equal(tepe, 3);
  assert.deepEqual(await sinirliParalel([], 6, async () => 1), []);
});

test('AP2 jbossDetay: eszamanli baslar, sira korunur, sema bir kez', async () => {
  sifirla();
  const d = await V.jbossDetay('MUSTERI');
  assert.ok(izler.tepe > 1, `cagrilar sirali kostu (tepe=${izler.tepe})`);
  assert.ok(izler.tepe <= V._ic.JVM_AGIR_ESZAMAN, `tavan asildi (tepe=${izler.tepe})`);
  // Ikinci cagri birincisi bitmeden basladi.
  assert.equal(izler.basla[1], HOSTLAR[1]);
  assert.notDeepEqual(izler.bitir, HOSTLAR, 'bitis sirasi girdiyle ayni: test ters bitisi kurmadi');
  assert.equal(izler.sema, 1, 'sema sunucu basina okundu');
  const jvmHostlari = d.sunucular.flatMap((s) => s.jvmler.map((j) => j.host));
  assert.deepEqual(jvmHostlari, HOSTLAR);
  for (const s of d.sunucular) assert.equal(s.jvmler[0].jvmArgs, `-Dhost=${s.host}`);
  assert.equal(d.ozet.jvmSayisi, HOSTLAR.length);
});

test('AP2b ikinci cagri birincisi bitmeden baslar', async () => {
  sifirla();
  const zaman = [];
  const asil = shSahte.loadJvmAgir;
  const sarili = function (host, opts) {
    zaman.push({ host, olay: 'basla' });
    return asil(host, opts).finally(() => zaman.push({ host, olay: 'bitir' }));
  };
  sarili.semaOku = asil.semaOku;
  shSahte.loadJvmAgir = sarili;
  try {
    await V.jbossDetay('MUSTERI');
  } finally {
    shSahte.loadJvmAgir = asil;
  }
  const ilkBitis = zaman.findIndex((z) => z.olay === 'bitir' && z.host === HOSTLAR[0]);
  const ikinciBaslama = zaman.findIndex((z) => z.olay === 'basla' && z.host === HOSTLAR[1]);
  assert.ok(ikinciBaslama >= 0 && ikinciBaslama < ilkBitis, 'ikinci cagri birincinin bitmesini bekledi');
});

test('AP3 tek sunucu duserse yalniz onun agir alani bos', async () => {
  sifirla();
  ayar.dus = new Set([HOSTLAR[3]]);
  const d = await V.jbossDetay('MUSTERI');
  const j = new Map(d.sunucular.map((s) => [s.host, s.jvmler[0].jvmArgs]));
  assert.equal(j.get(HOSTLAR[3]), null);
  assert.equal(j.get(HOSTLAR[4]), `-Dhost=${HOSTLAR[4]}`);
  assert.equal(d.ozet.jvmSayisi, HOSTLAR.length);
});

test('AP4 semaOku yoksa loadJvmAgir tek argumanla cagrilir', async () => {
  sifirla();
  const s = loadJvmAgir.semaOku;
  delete loadJvmAgir.semaOku;
  try {
    const d = await V.jbossDetay('MUSTERI');
    assert.ok(izler.argSayilari.length === HOSTLAR.length && izler.argSayilari.every((n) => n === 1));
    assert.equal(izler.sema, 0);
    assert.equal(d.ozet.jvmSayisi, HOSTLAR.length);
  } finally {
    loadJvmAgir.semaOku = s;
  }
});

test('AP5 ayni anahtara dusen iki kayit (kisa ad + FQDN): yavas olan once gelse de sira korunur', async () => {
  sifirla();
  const asil = shSahte.getAssessment;
  shSahte.getAssessment = async () => ({
    latestScan: '2026-11-12',
    hosts: [
      { host: HOSTLAR[0], fresh: true, scanDate: 'ilk', jvms: [{ name: 'MUSTERI', gen: 8, running: true }] },
      { host: `${HOSTLAR[0]}.bank.local`, fresh: true, scanDate: 'ikinci', jvms: [{ name: 'MUSTERI', gen: 8, running: true }] },
    ],
  });
  ayar.gecikme = (h) => (h.includes('.') ? 2 : 40);
  try {
    const d = await V.jbossDetay('MUSTERI');
    assert.deepEqual(izler.bitir, [`${HOSTLAR[0]}.bank.local`, HOSTLAR[0]], 'ters bitis kurulamadi');
    const s = d.sunucular.find((x) => x.host === HOSTLAR[0]);
    assert.deepEqual(s.jvmler.map((j) => j.taramaTarihi), ['ilk', 'ikinci']);
    assert.deepEqual(s.jvmler.map((j) => j.jvmArgs), [`-Dhost=${HOSTLAR[0]}`, `-Dhost=${HOSTLAR[0]}.bank.local`]);
  } finally {
    shSahte.getAssessment = asil;
  }
});
