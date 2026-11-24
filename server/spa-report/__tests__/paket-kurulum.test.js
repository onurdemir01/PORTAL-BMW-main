// server/spa-report/__tests__/paket-kurulum.test.js - PK1..PK17 (2026-11-23).
//
// Intranet SPA paket kurulumu (paket-kurulum.cjs). Bastionsuz (kullanici karari "A"): playbook OCP'yi
// okumaz; application.json route'taki /config'ten Nginx sunucusunca cekilir. Kilitler:
//   PK1 imajCoz: registry:port, digest, etiketsiz, derin yol
//   PK2 aday: yalniz PROD + kurulum 'yok'; hedef = taranan ve status YOK; taranmayan bilgi (engel degil)
//   PK3 surum: en yeni basarili PROD okumasi; prod cluster'lari arasinda farkli etiket, imaj yolu ns/app
//       uyusmazligi, digest / etiketsiz, PROD cluster yok, okuma yok -> engel; katalogda olmayan cluster
//       bilgi; 3 saatten eski okuma 'bayat' ENGEL; route adresi yoksa 'config-adresi-yok' ENGEL
//   PK4 POST yetki ve girdi: Admin degil 403; kurulabilir degil 400; >10 400; apply onayMetni != PROD 428
//       (AWX cagrilmaz); registry yok 501
//   PK5 POST extra_vars YALNIZ spi_mode + spi_items (terminal_hosts / ocp_clusters YOK), kalem config_urls
//       route adreslerinden; istemcinin surum / host / config_urls'u yok sayilir; is gecmisi params ve
//       denetim config_urls tasimaz
//   PK6 GET is: sahiplik yoksa 404; templateId uyusmazsa 409; artifact kalemleri uyusmazsa 409
//   PK7 GET is: bitince tabloya bir kez yazar (ikinci cagri yazmaz); apply OK -> intranet onbellegi silinir
//   PK8 uygula plana bagli: plan yok 404, baska kullanici / tur / sablon / sunucu 409, 2 saatten eski 409,
//       bitmemis / sonucsuz / AWX okunamayan plan 409; hicbirinde AWX isi baslamaz
//   PK9 uygula: secim plan alt kumesi; taze surum != plan surumu 409; sunucular PLAN_OK ile taze hedeflerin
//       kesisimi; PLAN_OK sunucusu kalmayan kalem cikar, hic kalem kalmazsa 409
//   PK10 eszamanli is: son 24 saatte secimle kesisen bitmemis is 409 (plan ve uygula); AWX okunamazsa 409
//   PK11 son 24 saatte apply OK sunucu hedeften cikar; hepsi cikarsa 'yakin-zamanda-kuruldu' engeli
//   PK12 ayni uyari kodu tek uyarida birlesir (iki PROD digest -> tek 'etiketsiz')
//   PK13 uretilen her uyari kodu UYARI_KODLARI'nda; ekranin PAKET_UYARI_KODLARI'yla birebir
//   PK14 yoklanmamis bitmis apply eszamanli denetimde tabloya yazilir; is gecmisi yazilamazsa yanit ve
//       denetim uyarir; uygulama imaji birden cok etiketle kosuyorsa 'surum-farkli' engeli
//   PK15 config_urls: yalniz PROD cluster + SPA + paylasilmayan route adresi (yol tabanli route yanlis
//       /config dondurmesin), IP / localhost / tek etiket yok, intranet once, en cok 3; elenen sayisi
//       'config-adresi-elendi' bilgi; katalog okunamazsa 'katalog-yok' engel
//   PK16 bayat siniri 3 saat; bayat aday POST'ta 400 (AWX cagrilmaz)
//   PK17 registry seed: bastionlu ilk aciklama YALNIZ birebir eskiyse yenisiyle degisir
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const SAAT = 60 * 60 * 1000;
const once = (ms) => new Date(Date.now() - ms).toISOString();

const kayit = {
  launch: [],
  gecmis: [],
  denetim: [],
  tablo: [],
  tabloInsert: 0,
  onbellek: 0,
  durumSorgu: [],
};
const ortam = {
  templateId: 77,
  isKayit: new Map(),
  durum: { status: 'successful', templateId: 77, artifacts: {} },
  durumlar: new Map(),
  awxHata: null,
};
const okumalar = new Map();

sahte(require.resolve('../../auth/index.cjs'), {
  requireAdmin: (req, res, next) =>
    req.session?.user?.role === 'Admin' ? next() : res.status(403).json({ ok: false }),
});
sahte(require.resolve('../../ansible/playbook-registry.cjs'), {
  getByKey: async (k) => ({ key: k, enabled: true, awxServerId: 2 }),
  getEffectiveTemplateId: () => ortam.templateId,
});
sahte(require.resolve('../../ansible/template-preflight.cjs'), {
  assertRegistryPlaybook: async () => {},
  assertTemplateAcceptsExtraVars: async () => {},
});
sahte(require.resolve('../../ansible/runner.cjs'), {
  launchJobOnServer: async (serverId, templateId, extraVars) => {
    kayit.launch.push({ serverId, templateId, extraVars });
    return { jobId: 500 + kayit.launch.length, status: 'pending' };
  },
  getJobStatusOnServer: async (serverId, jobId) => {
    kayit.durumSorgu.push(jobId);
    if (ortam.awxHata) throw new Error(ortam.awxHata);
    return ortam.durumlar.get(jobId) || ortam.durum;
  },
});
sahte(require.resolve('../../opsx/index.cjs'), {
  extractStatsKey: (art, k) => (art && art[k]) || null,
});
sahte(require.resolve('../../audit/index.cjs'), {
  auditPortal: (_req, eylem, o) => kayit.denetim.push({ eylem, detail: JSON.parse(o.detail) }),
});
sahte(require.resolve('../../audit/ocp-platforms.cjs'), {
  platformOfCluster: (c) => (String(c).startsWith('ark') ? 'ark' : 'diger'),
});

const KATALOG = {
  arkprod1: { env: 'PROD', tenant: 'ark' },
  arkprod2: { env: 'prod', tenant: 'ark' },
  arktest1: { env: 'TEST', tenant: 'ark' },
};
const gercekVeri = require('../../app-hub/veri.cjs');
sahte(require.resolve('../../app-hub/veri.cjs'), {
  ...gercekVeri,
  clusterIndeksi: async () =>
    new Map(Object.entries(KATALOG).map(([ad, v]) => [ad, [{ ...v, ad }]])),
});
const gercekFilo = require('../../app-hub/filo.cjs');
sahte(require.resolve('../../app-hub/filo.cjs'), {
  ...gercekFilo,
  filoOkumalari: async (app) => (okumalar.get(app) || []).filter((o) => o.kaynak === 'saatlik'),
});
// Bastionsuz (2026-11-23 karar "A"): canli.cjs'ten yalniz son okumalar kullanilir; hedefleriKur
// sahtede YOK, cagrilirsa test patlar.
sahte(require.resolve('../../app-hub/canli.cjs'), {
  sonOkumalar: async (app) => (okumalar.get(app) || []).filter((o) => o.kaynak !== 'saatlik'),
});

const tabloSorgu = (t, p) => {
  if (/^SELECT TOP 1 id FROM spa_paket_kurulum/.test(t))
    return { rows: kayit.tablo.filter((r) => r.server_id === p[0] && r.job_id === p[1]) };
  if (/^INSERT INTO spa_paket_kurulum/.test(t)) {
    kayit.tabloInsert += 1;
    for (const r of JSON.parse(p[3]))
      kayit.tablo.push({ ...r, server_id: p[0], job_id: p[1], mod: p[2], kullanici: p[4] });
    return { rows: [], rowCount: 1 };
  }
  throw new Error(`sahte tx bilinmeyen SQL: ${t.slice(0, 80)}`);
};
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
/** ansible_job_history: elle kaydedilenler + POST'un yazdiklari (gercek tablo gibi tek kaynak). */
function gecmisSatirlari() {
  const yazilan = kayit.gecmis.map((p) => ({
    username: p[0],
    awx_server_id: p[1],
    template_id: p[2],
    template_name: p[3],
    job_id: p[4],
    params: p[6],
    started_at: new Date(),
  }));
  return [...ortam.isKayit.values(), ...yazilan];
}
const tabloIs = (p) => kayit.tablo.filter((r) => r.server_id === p[0] && r.job_id === p[1]);
sahte(require.resolve('../../db/index.cjs'), {
  query: async (sql, p = []) => {
    const t = norm(sql);
    if (t.includes('FROM spa_paket_kurulum k'))
      return { rows: kayit.tablo.map((r) => ({ ...r, zaman: r.zaman || new Date() })) };
    if (t.startsWith('SELECT namespace, application, host, MAX(zaman)'))
      return {
        rows: kayit.tablo
          .filter((r) => r.mod === 'apply' && r.status === 'OK')
          .map((r) => ({ ...r, zaman: r.zaman || new Date() })),
      };
    if (t.startsWith('SELECT namespace, application, host, status FROM spa_paket_kurulum'))
      return { rows: tabloIs(p) };
    if (t.startsWith('SELECT TOP 1 1 AS var FROM spa_paket_kurulum'))
      return { rows: tabloIs(p).slice(0, 1) };
    if (t.startsWith('INSERT INTO ansible_job_history')) {
      if (ortam.gecmisHata) throw new Error(ortam.gecmisHata);
      kayit.gecmis.push(p);
      return { rows: [] };
    }
    if (t.startsWith('SELECT TOP 2 template_id')) {
      assert.equal(p[2], 'Intranet SPA paket kurulumu%');
      return {
        rows: gecmisSatirlari()
          .filter((r) => r.awx_server_id === p[0] && r.job_id === p[1])
          .slice(0, 2),
      };
    }
    if (t.startsWith('SELECT awx_server_id, job_id, params, started_at FROM ansible_job_history'))
      return { rows: gecmisSatirlari() };
    throw new Error(`sahte DB bilinmeyen SQL: ${t.slice(0, 80)}`);
  },
  transaction: async (work) => work({ query: async (sql, p) => tabloSorgu(norm(sql), p) }),
});

const { imajCoz } = require('../../../shared/ocpImaj.cjs');
const P = require('../paket-kurulum.cjs');

// ── Veri ──────────────────────────────────────────────────────────────────────

const REG = 'registry.example:5000';
function satir(app, ek = {}) {
  const r = {
    env: 'PROD',
    namespace: 'kart-prod',
    application: app,
    clusters: ['arkprod1', 'arkprod2', 'arktest1'],
    adresler: [`${app}.apps.invalid`],
    kurulum: {
      durum: 'yok',
      sunucular: [
        { host: 'NGINXP01', status: 'YOK' },
        { host: 'NGINXP02', status: 'YOK' },
      ],
      taranmayan: [],
    },
    ...ek,
  };
  // Kesifteki route ayrintisi: satirin adresi, satirin cluster'larinda, intranet SPA route'u.
  if (!('routeDetay' in ek))
    r.routeDetay = r.adresler.map((host) => ({
      host,
      clusters: [...r.clusters],
      terms: ['reencrypt'],
      spa: true,
      paylasilan: false,
    }));
  return r;
}
function okuma(cluster, imaj, ek = {}) {
  return {
    cluster,
    namespace: 'kart-prod',
    ok: true,
    alinma: once(SAAT),
    kaynak: 'saatlik',
    nesneler: [
      { tur: 'Deployment', istenen: 0, containerlar: [{ ad: 'x', imaj: `${REG}/eski/eski:0` }] },
      { tur: 'Argo Rollout', istenen: 2, containerlar: [{ ad: 'web', imaj }] },
    ],
    ...ek,
  };
}
const imaj = (app, etiket, ns = 'kart-prod') => `${REG}/${ns}/${app}:${etiket}`;

const RAPOR = {
  dizinTarihi: '2026-11-22',
  dizinDurum: 'var',
  rows: [
    satir('a-ui', {
      kurulum: {
        durum: 'yok',
        sunucular: [
          { host: 'NGINXP01', status: 'YOK' },
          { host: 'NGINXP02', status: 'YOK' },
        ],
        taranmayan: ['NGINXP03'],
      },
    }),
    satir('test-ui', { env: 'TEST' }),
    satir('kismi-ui', { kurulum: { durum: 'kismi', sunucular: [], taranmayan: [] } }),
    satir('farkli-ui'),
    satir('yol-ui'),
    satir('digest-ui'),
    satir('etiketsiz-ui'),
    satir('katalog-ui', { clusters: ['arkprod1', 'arkprod9'] }),
    satir('prodsuz-ui', { clusters: ['arktest1'] }),
    satir('bayat-ui', { clusters: ['arkprod2'] }),
    satir('iki-ui', { clusters: ['arkprod2'] }),
    satir('rotasiz-ui', { clusters: ['arkprod1'], adresler: [], routeDetay: [] }),
    satir('okumasiz-ui'),
    satir('hedefsiz-ui', {
      clusters: ['arkprod1'],
      kurulum: { durum: 'yok', sunucular: [], taranmayan: ['NGINXP03'] },
    }),
    satir('k-ui', { clusters: ['arkprod1'] }),
  ],
};
function okumalariKur() {
  okumalar.clear();
  okumalar.set('a-ui', [
    okuma('arkprod1', imaj('a-ui', '1.2.3-10-prod'), { alinma: once(SAAT), kaynak: 'canli' }),
    okuma('arkprod2', imaj('a-ui', '1.2.3-10-prod'), { alinma: once(2 * SAAT) }),
    // Test cluster'inin farkli surumu hesaba girmez.
    okuma('arktest1', imaj('a-ui', '9.9.9-1-test')),
    // Basarisiz okuma surum vermez.
    okuma('arkprod2', imaj('a-ui', '0.0.1'), { ok: false, alinma: once(10), kaynak: 'canli' }),
  ]);
  okumalar.set('farkli-ui', [
    okuma('arkprod1', imaj('farkli-ui', '1.0.0')),
    okuma('arkprod2', imaj('farkli-ui', '1.0.1')),
  ]);
  okumalar.set('yol-ui', [okuma('arkprod1', imaj('yol-ui', '1.0.0', 'baska-prod'))]);
  okumalar.set('digest-ui', [okuma('arkprod1', `${REG}/kart-prod/digest-ui@sha256:abc`)]);
  okumalar.set('etiketsiz-ui', [okuma('arkprod1', `${REG}/kart-prod/etiketsiz-ui`)]);
  okumalar.set('katalog-ui', [okuma('arkprod1', imaj('katalog-ui', '1.0.0'))]);
  okumalar.set('prodsuz-ui', [okuma('arktest1', imaj('prodsuz-ui', '1.0.0'))]);
  okumalar.set('bayat-ui', [
    okuma('arkprod2', imaj('bayat-ui', '2.0.0'), { alinma: once(3 * SAAT + 60000) }),
  ]);
  okumalar.set('iki-ui', [
    okuma('arkprod2', imaj('iki-ui', '2.0.0'), { alinma: once(3 * SAAT - 60000) }),
  ]);
  okumalar.set('rotasiz-ui', [okuma('arkprod1', imaj('rotasiz-ui', '1.0.0'))]);
  okumalar.set('hedefsiz-ui', [okuma('arkprod1', imaj('hedefsiz-ui', '1.0.0'))]);
  okumalar.set('k-ui', [okuma('arkprod1', imaj('k-ui', '3.0.0'))]);
}

const deps = {
  loadIntranet: async () => RAPOR,
  intranetOnbellekSil: () => {
    kayit.onbellek += 1;
  },
};

async function istek(method, yol, govde, rol = 'Admin') {
  const app = express();
  app.use(express.json());
  app.use((req, _r, n) => {
    req.session = { user: { username: 'onur', role: rol } };
    n();
  });
  const router = express.Router();
  P.mount(router, deps);
  app.use('/api/spa-report', router);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/spa-report${yol}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: govde ? JSON.stringify(govde) : undefined,
    });
    return { status: r.status, body: await r.json() };
  } finally {
    srv.close();
  }
}

function sifirla() {
  kayit.launch.length = 0;
  kayit.gecmis.length = 0;
  kayit.denetim.length = 0;
  kayit.tablo.length = 0;
  kayit.tabloInsert = 0;
  kayit.onbellek = 0;
  kayit.durumSorgu.length = 0;
  ortam.templateId = 77;
  ortam.isKayit.clear();
  ortam.durum = { status: 'successful', templateId: 77, artifacts: {} };
  ortam.durumlar.clear();
  ortam.awxHata = null;
  ortam.gecmisHata = null;
  okumalariKur();
  P.onbellekSil();
}

const kodlar = (a) => a.uyarilar.map((u) => `${u.kod}:${u.engel ? 'E' : 'b'}`);

// ── Testler ───────────────────────────────────────────────────────────────────

test('PK1 imajCoz: registry:port, digest, etiketsiz, derin yol', () => {
  assert.deepEqual(imajCoz(`${REG}/kart-prod/a-ui:1.2.3-10-prod`), {
    yol: 'kart-prod/a-ui',
    registry: REG,
    namespace: 'kart-prod',
    uygulama: 'a-ui',
    etiket: '1.2.3-10-prod',
    digest: null,
  });
  const d = imajCoz('reg.example/ns/app:1.0@sha256:abc');
  assert.deepEqual([d.etiket, d.digest, d.uygulama], ['1.0', 'sha256:abc', 'app']);
  const e = imajCoz('reg.example:5000/ns/app');
  assert.deepEqual([e.etiket, e.registry, e.namespace], [null, 'reg.example:5000', 'ns']);
  const derin = imajCoz('reg.example/a/b/ns/app:2');
  assert.deepEqual([derin.yol, derin.namespace, derin.uygulama], ['a/b/ns/app', 'ns', 'app']);
  assert.deepEqual([imajCoz('app:1').namespace, imajCoz('app:1').etiket], [null, '1']);
  // Sinir: bos etiket etiketsiz (ekran imajSurumu da 'latest (etiketsiz)' der; OK1).
  const bos = imajCoz('reg.example/ns/app:');
  assert.deepEqual([bos.etiket, bos.uygulama, bos.namespace], [null, 'app', 'ns']);
  assert.equal(imajCoz('').yol, null);
  assert.equal(imajCoz('ns//app:1').yol, null);
  assert.equal(imajCoz(null).uygulama, null);
});

test('PK2-PK3 aday hesabi: kapsam, hedefler, surum ve engeller', async () => {
  sifirla();
  const r = await istek('GET', '/intranet/paket/adaylar?fresh=1');
  assert.equal(r.status, 200);
  const b = r.body;
  const ix = new Map(b.adaylar.map((a) => [a.application, a]));
  // Yalniz PROD + kurulum 'yok'.
  assert.equal(ix.has('test-ui'), false);
  assert.equal(ix.has('kismi-ui'), false);
  assert.equal(b.dizinTarihi, '2026-11-22');
  const a = ix.get('a-ui');
  assert.equal(a.kurulabilir, true);
  assert.equal(a.surum, '1.2.3-10-prod');
  assert.equal(a.cluster, 'arkprod1');
  assert.equal(a.imaj, imaj('a-ui', '1.2.3-10-prod'));
  assert.deepEqual(a.clusters, ['arkprod1', 'arkprod2']);
  assert.deepEqual(a.hedefler, ['NGINXP01', 'NGINXP02']);
  assert.deepEqual(a.taranmayan, ['NGINXP03']);
  assert.deepEqual(kodlar(a), ['taranmayan:b']);
  assert.deepEqual(kodlar(ix.get('farkli-ui')), ['surum-farkli:E']);
  assert.equal(ix.get('farkli-ui').kurulabilir, false);
  assert.deepEqual(kodlar(ix.get('yol-ui')), ['imaj-yolu-farkli:E', 'surum-yok:b']);
  assert.deepEqual(kodlar(ix.get('digest-ui')), ['etiketsiz:E', 'surum-yok:b']);
  assert.deepEqual(kodlar(ix.get('etiketsiz-ui')), ['etiketsiz:E', 'surum-yok:b']);
  assert.equal(ix.get('etiketsiz-ui').surum, null);
  // Katalogda olmayan cluster artik bilgi (OCP okumasi yok); PROD cluster'i olan kurulabilir.
  const katalog = ix.get('katalog-ui');
  assert.deepEqual([kodlar(katalog), katalog.kurulabilir], [['katalog-yok:b'], true]);
  assert.match(katalog.uyarilar[0].metin, /arkprod9/);
  // PROD ortamli ARK cluster'i yok: engel; route'u da yalniz PROD disi cluster'da (adres alinmaz).
  assert.deepEqual(kodlar(ix.get('prodsuz-ui')), [
    'katalog-yok:E',
    'surum-yok:E',
    'config-adresi-yok:E',
    'config-adresi-elendi:b',
  ]);
  assert.match(
    ix.get('prodsuz-ui').uyarilar.at(-1).metin,
    /^\/config için denenmeyen route adresi: PROD dışı cluster'da 1$/,
  );
  // Bayat: kullanilan PROD okumasi 3 saatten eski -> ENGEL (playbook surumu teyit etmiyor).
  const bayat = ix.get('bayat-ui');
  assert.deepEqual([bayat.kurulabilir, bayat.surum], [false, '2.0.0']);
  assert.deepEqual(kodlar(bayat), ['bayat:E']);
  assert.match(bayat.uyarilar[0].metin, /3 saatten eski/);
  const iki = ix.get('iki-ui');
  assert.deepEqual(
    [kodlar(iki), iki.kurulabilir],
    [[], true],
    '3 saatin altindaki okuma bayat degil',
  );
  const rotasiz = ix.get('rotasiz-ui');
  assert.deepEqual([kodlar(rotasiz), rotasiz.kurulabilir], [['config-adresi-yok:E'], false]);
  assert.equal('_configUrls' in a, false, 'ic alan yanita sizmamali');
  assert.deepEqual(kodlar(ix.get('okumasiz-ui')), ['surum-yok:E']);
  assert.deepEqual(kodlar(ix.get('hedefsiz-ui')), ['hedef-yok:E', 'taranmayan:b']);
  assert.deepEqual(b.ozet, { toplam: 13, kurulabilir: 4 });
});

test('PK2b hedef tavani: 8 sunucudan fazlasi engel', () => {
  const sunucular = Array.from({ length: 9 }, (_, i) => ({ host: `NGINXP1${i}`, status: 'YOK' }));
  const a = P._ic.adayKur(
    satir('k-ui', { clusters: ['arkprod1'], kurulum: { durum: 'yok', sunucular } }),
    {
      katalog: new Map([['arkprod1', [{ env: 'PROD', tenant: 'ark', ad: 'arkprod1' }]]]),
      okumalar: [okuma('arkprod1', imaj('k-ui', '3.0.0'))],
      simdi: Date.now(),
    },
  );
  assert.deepEqual(kodlar(a), ['hedef-fazla:E']);
  assert.equal(a.kurulabilir, false);
});

test('PK4 POST yetki ve girdi kapilari', async () => {
  sifirla();
  for (const [m, y] of [
    ['GET', '/intranet/paket/adaylar'],
    ['POST', '/intranet/paket/kur'],
    ['GET', '/intranet/paket/is/2/501'],
  ])
    assert.equal((await istek(m, y, m === 'POST' ? { secim: [] } : null, 'User')).status, 403);
  const kur = (g) => istek('POST', '/intranet/paket/kur', g);
  assert.equal((await kur({ secim: [] })).status, 400);
  assert.equal(P.KALEM_TAVAN, 50);
  const fazla = Array.from({ length: 51 }, (_, i) => ({
    namespace: 'kart-prod',
    application: `u${i}`,
  }));
  const r51 = await kur({ secim: fazla });
  assert.deepEqual([r51.status, r51.body.error], [400, 'Bir işte en çok 50 uygulama.']);
  assert.equal(
    (await kur({ secim: [{ namespace: 'kart-prod', application: 'farkli-ui' }] })).status,
    400,
  );
  assert.equal(
    (await kur({ secim: [{ namespace: 'Kart Prod', application: 'a-ui' }] })).status,
    400,
  );
  const a = { namespace: 'kart-prod', application: 'a-ui' };
  assert.equal((await kur({ secim: [a, a] })).status, 400);
  assert.equal((await kur({ secim: [a], apply: true })).status, 428);
  assert.equal((await kur({ secim: [a], apply: true, onayMetni: 'prod' })).status, 428);
  // Uygula plana bagli: plan yok / gecersiz -> 400.
  for (const plan of [undefined, {}, { serverId: 2 }, { serverId: 2, jobId: 'x' }]) {
    const r = await kur({ secim: [a], apply: true, onayMetni: 'PROD', plan });
    assert.equal(r.status, 400, JSON.stringify(plan));
    assert.match(r.body.error, /plana bağlı/);
  }
  ortam.templateId = null;
  assert.equal((await kur({ secim: [a] })).status, 501);
  assert.equal(kayit.launch.length, 0, 'hicbir kapida AWX cagrilmamali');
});

test('PK5 POST plan ve uygula: extra_vars sozlesmesi, istemci verisi yok sayilir, is gecmisi', async () => {
  sifirla();
  const secim = [
    { namespace: 'kart-prod', application: 'a-ui', surum: '6.6.6', hosts: ['KOTU01'] },
    { namespace: 'kart-prod', application: 'iki-ui', cluster: 'arktest1', config_urls: ['x'] },
    { namespace: 'kart-prod', application: 'k-ui' },
  ];
  const r = await istek('POST', '/intranet/paket/kur', { secim, surum: '6.6.6' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const beklenenKalem = [
    {
      id: 'kart-prod/a-ui',
      namespace: 'kart-prod',
      application: 'a-ui',
      version: '1.2.3-10-prod',
      cluster: 'arkprod1',
      hosts: ['NGINXP01', 'NGINXP02'],
    },
    {
      id: 'kart-prod/iki-ui',
      namespace: 'kart-prod',
      application: 'iki-ui',
      version: '2.0.0',
      cluster: 'arkprod2',
      hosts: ['NGINXP01', 'NGINXP02'],
    },
    {
      id: 'kart-prod/k-ui',
      namespace: 'kart-prod',
      application: 'k-ui',
      version: '3.0.0',
      cluster: 'arkprod1',
      hosts: ['NGINXP01', 'NGINXP02'],
    },
  ];
  assert.deepEqual(r.body, {
    ok: true,
    serverId: 2,
    jobId: 501,
    mod: 'plan',
    items: beklenenKalem,
  });
  assert.equal(kayit.launch.length, 1);
  const { serverId, templateId, extraVars } = kayit.launch[0];
  assert.deepEqual([serverId, templateId], [2, 77]);
  // Bastionsuz: extra_vars YALNIZ spi_mode + spi_items; kalem config_urls tasir (route adreslerinden).
  const cfg = (app) => [`https://${app}.apps.invalid/config`];
  const gidenKalem = beklenenKalem.map((k) => ({ ...k, config_urls: cfg(k.application) }));
  assert.deepEqual(extraVars, { spi_mode: 'plan', spi_items: gidenKalem });
  for (const yasak of ['terminal_hosts', 'ocp_clusters', 'oc_binary'])
    assert.equal(yasak in extraVars, false, `extra_vars'ta ${yasak}`);
  const g = kayit.gecmis[0];
  assert.deepEqual(g.slice(0, 6), [
    'onur',
    2,
    77,
    'Intranet SPA paket kurulumu: plan',
    501,
    'pending',
  ]);
  assert.deepEqual(JSON.parse(g[6]), {
    platform: 'spa-package-install',
    mode: 'plan',
    items: beklenenKalem,
  });
  assert.equal(kayit.denetim[0].eylem, 'spa_paket_kurulum_plan');
  assert.deepEqual(kayit.denetim[0].detail.items, beklenenKalem);

  // Plan 501 bitti: a-ui yalniz NGINXP01'de PLAN_OK; k-ui hic PLAN_OK degil.
  ortam.durumlar.set(
    501,
    planBitti(beklenenKalem, {
      'kart-prod/a-ui': { NGINXP01: 'PLAN_OK', NGINXP02: 'SKIP' },
      'kart-prod/iki-ui': { NGINXP01: 'PLAN_OK', NGINXP02: 'PLAN_OK' },
      'kart-prod/k-ui': { NGINXP01: 'FAIL', NGINXP02: 'FAIL' },
    }),
  );
  const u = await istek('POST', '/intranet/paket/kur', {
    secim: [secim[0], secim[2]],
    apply: true,
    onayMetni: ' PROD ',
    plan: { serverId: 2, jobId: 501 },
  });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.mod, 'apply');
  const gonderilen = [{ ...beklenenKalem[0], hosts: ['NGINXP01'] }];
  assert.deepEqual(u.body.items, gonderilen, 'PLAN_OK olmayan sunucu ve kalem gonderilmez');
  assert.equal(kayit.launch[1].extraVars.spi_mode, 'apply');
  assert.deepEqual(kayit.launch[1].extraVars, {
    spi_mode: 'apply',
    spi_items: [{ ...gonderilen[0], config_urls: cfg('a-ui') }],
  });
  assert.equal(kayit.gecmis[1][3], 'Intranet SPA paket kurulumu: uygula');
  assert.deepEqual(JSON.parse(kayit.gecmis[1][6]).items, gonderilen);
  assert.equal(kayit.denetim[1].eylem, 'spa_paket_kurulum_uygula');
  // Plan sonucu AWX'ten okunup tabloya yazildi (6 satir, mod plan).
  assert.equal(kayit.tabloInsert, 1);
  assert.deepEqual([...new Set(kayit.tablo.map((t) => `${t.job_id}:${t.mod}`))], ['501:plan']);
});

/** Bitmis plan isi: items plan kalemleri, durumlar id -> {host: status}. */
function planBitti(items, durumlar) {
  return {
    status: 'successful',
    templateId: 77,
    artifacts: sonucArtifact(
      'plan',
      items.map((k) => ({
        ...k,
        hosts: Object.entries(durumlar[k.id] || {}).map(([host, status]) => ({
          host,
          status,
          step: 'check',
          message: status,
        })),
      })),
    ),
  };
}

function isKaydet(serverId, jobId, mode, items, ek = {}) {
  ortam.isKayit.set(`${serverId}|${jobId}`, {
    awx_server_id: serverId,
    job_id: jobId,
    template_id: 77,
    template_name: `Intranet SPA paket kurulumu: ${mode === 'apply' ? 'uygula' : 'plan'}`,
    params: JSON.stringify({ platform: 'spa-package-install', mode, items }),
    username: 'onur',
    started_at: new Date(),
    ...ek,
  });
}
const KALEM = {
  id: 'kart-prod/a-ui',
  namespace: 'kart-prod',
  application: 'a-ui',
  version: '1.2.3-10-prod',
  cluster: 'arkprod1',
  hosts: ['NGINXP01', 'NGINXP02'],
};
function sonucArtifact(mode, items) {
  return { spa_package_install_result: { mode, overall: 'partial', items } };
}

test('PK6 GET is: sahiplik, sablon kimligi, artifact eslesmesi', async () => {
  sifirla();
  assert.equal((await istek('GET', '/intranet/paket/is/2/700')).status, 404);
  assert.equal((await istek('GET', '/intranet/paket/is/x/700')).status, 400);
  isKaydet(2, 700, 'apply', [KALEM]);
  ortam.durum = { status: 'successful', templateId: 78, artifacts: {} };
  assert.equal((await istek('GET', '/intranet/paket/is/2/700')).status, 409);
  ortam.durum = { status: 'running', templateId: 77, artifacts: {} };
  assert.deepEqual((await istek('GET', '/intranet/paket/is/2/700')).body, {
    ok: true,
    status: 'running',
    finished: false,
  });
  ortam.durum = {
    status: 'successful',
    templateId: 77,
    artifacts: sonucArtifact('apply', [{ ...KALEM, id: 'kart-prod/baska-ui', hosts: [] }]),
  };
  assert.equal((await istek('GET', '/intranet/paket/is/2/700')).status, 409);
  ortam.durum = {
    status: 'successful',
    templateId: 77,
    artifacts: sonucArtifact('plan', [{ id: KALEM.id, hosts: [] }]),
  };
  assert.equal((await istek('GET', '/intranet/paket/is/2/700')).status, 409, 'mod uyusmazligi');
  ortam.durum = { status: 'failed', templateId: 77, artifacts: {} };
  const y = await istek('GET', '/intranet/paket/is/2/700');
  assert.equal(y.body.finished, true);
  assert.match(y.body.error, /sonuç yayınlanmadı/);
  // Girdi kapisi dustu (2026-11-24, PR-R): kalem yok + error -> sebep gosterilir, "eslesmiyor" (409) denmez.
  ortam.durum = {
    status: 'failed',
    templateId: 77,
    artifacts: {
      spa_package_install_result: {
        mode: 'apply',
        overall: 'failed',
        error: 'AWX sablon degiskenleri eksik ya da gecersiz',
        items: [],
      },
    },
  };
  const g = await istek('GET', '/intranet/paket/is/2/700');
  assert.equal(g.status, 200);
  assert.equal(g.body.finished, true);
  assert.equal(
    g.body.error,
    'Kurulum başlamadı (girdi kapısı): AWX sablon degiskenleri eksik ya da gecersiz',
  );
  assert.equal(kayit.tabloInsert, 0);
});

test('PK7 GET is: bitince bir kez yazar; apply OK onbellegi siler; son deneme adayda gorunur', async () => {
  sifirla();
  isKaydet(2, 701, 'apply', [KALEM]);
  ortam.durum = {
    status: 'successful',
    templateId: 77,
    artifacts: sonucArtifact('apply', [
      {
        ...KALEM,
        hosts: [
          { host: 'NGINXP01', status: 'OK', step: 'cleanup', message: 'kuruldu' },
          { host: 'NGINXP99', status: 'OK', step: 'cleanup', message: 'planda yok' },
        ],
      },
    ]),
  };
  const r = await istek('GET', '/intranet/paket/is/2/701');
  assert.equal(r.status, 200);
  assert.equal(r.body.finished, true);
  assert.equal(r.body.sonuc.overall, 'partial');
  assert.equal(kayit.tabloInsert, 1);
  assert.deepEqual(
    kayit.tablo.map((t) => [t.host, t.status, t.step, t.version, t.mod, t.kullanici]),
    [
      ['NGINXP01', 'OK', 'cleanup', '1.2.3-10-prod', 'apply', 'onur'],
      ['NGINXP02', 'FAIL', 'sonuc-yok', '1.2.3-10-prod', 'apply', 'onur'],
    ],
  );
  assert.equal(kayit.onbellek, 1);
  await istek('GET', '/intranet/paket/is/2/701');
  assert.equal(kayit.tabloInsert, 1, 'ikinci cagri tekrar yazmamali');
  assert.equal(kayit.onbellek, 1);
  const ad = await istek('GET', '/intranet/paket/adaylar');
  const a = ad.body.adaylar.find((x) => x.application === 'a-ui');
  assert.deepEqual(
    [a.sonDeneme.jobId, a.sonDeneme.mod, a.sonDeneme.sunucular.map((s) => s.status)],
    [701, 'apply', ['OK', 'FAIL']],
  );
});

// -- PK8.. ---------------------------------------------------------------------

const A_UI = { namespace: 'kart-prod', application: 'a-ui' };
const K_UI_KALEM = {
  id: 'kart-prod/k-ui',
  namespace: 'kart-prod',
  application: 'k-ui',
  version: '3.0.0',
  cluster: 'arkprod1',
  hosts: ['NGINXP01', 'NGINXP02'],
};
const uygula = (secim, plan) =>
  istek('POST', '/intranet/paket/kur', { secim, apply: true, onayMetni: 'PROD', plan });
/** Plan 900: tablo satirlari hazir (AWX okunmaz). */
function planTablosu(jobId, satirlar) {
  for (const [ns, app, host, status] of satirlar)
    kayit.tablo.push({
      server_id: 2,
      job_id: jobId,
      mod: 'plan',
      namespace: ns,
      application: app,
      host,
      status,
    });
}

test('PK8 uygula plana bagli: sahiplik, tur, kullanici, omur, bitmis olma', async () => {
  sifirla();
  const plan = { serverId: 2, jobId: 900 };
  let r = await uygula([A_UI], plan);
  assert.equal(r.status, 404, 'plan kaydi yok');
  isKaydet(2, 900, 'plan', [KALEM], { username: 'baska' });
  r = await uygula([A_UI], plan);
  assert.deepEqual([r.status, r.body.error], [409, 'Plan başka bir kullanıcıya ait.']);
  isKaydet(2, 900, 'apply', [KALEM]);
  r = await uygula([A_UI], plan);
  assert.deepEqual([r.status, r.body.error], [409, 'Belirtilen iş bir plan işi değil.']);
  isKaydet(2, 900, 'plan', [KALEM], { template_name: 'Intranet SPA paket kurulumu: uygula' });
  assert.equal((await uygula([A_UI], plan)).status, 409, 'sablon adi plan degil');
  isKaydet(2, 900, 'plan', [KALEM], { started_at: new Date(Date.now() - 2 * SAAT - 60000) });
  r = await uygula([A_UI], plan);
  assert.deepEqual([r.status, r.body.error], [409, 'Plan 2 saatten eski; yeniden planlayın.']);
  isKaydet(2, 900, 'plan', [KALEM], { template_id: 78 });
  assert.equal((await uygula([A_UI], plan)).status, 409, 'baska sablon');
  assert.equal((await uygula([A_UI], { serverId: 3, jobId: 900 })).status, 409, 'baska sunucu');
  isKaydet(2, 900, 'plan', [KALEM]);
  ortam.durumlar.set(900, { status: 'running', templateId: 77, artifacts: {} });
  r = await uygula([A_UI], plan);
  assert.deepEqual([r.status, r.body.error], [409, 'Plan işi henüz bitmedi.']);
  ortam.durumlar.set(900, { status: 'successful', templateId: 77, artifacts: {} });
  assert.match((await uygula([A_UI], plan)).body.error, /sonucu yayınlanmadı/);
  ortam.durumlar.set(900, { status: 'successful', templateId: 78, artifacts: {} });
  assert.equal((await uygula([A_UI], plan)).status, 409, 'AWX sablon kimligi');
  ortam.durumlar.delete(900);
  ortam.awxHata = 'baglanti yok';
  assert.match((await uygula([A_UI], plan)).body.error, /Plan işinin durumu okunamadı/);
  assert.equal(kayit.launch.length, 0, 'hicbir durumda AWX isi baslatilmamali');
});

test('PK9 uygula: secim plan alt kumesi, surum degisti 409, sunucular daraltilir, PLAN_OK yok kalem cikar', async () => {
  sifirla();
  const plan = { serverId: 2, jobId: 901 };
  isKaydet(2, 901, 'plan', [KALEM]);
  planTablosu(901, [
    ['kart-prod', 'a-ui', 'NGINXP01', 'SKIP'],
    ['kart-prod', 'a-ui', 'NGINXP02', 'PLAN_OK'],
    ['kart-prod', 'a-ui', 'NGINXP07', 'PLAN_OK'],
  ]);
  let r = await uygula([A_UI, { namespace: 'kart-prod', application: 'k-ui' }], plan);
  assert.deepEqual([r.status, r.body.error], [409, 'Planda olmayan seçim: kart-prod/k-ui']);
  r = await uygula([A_UI], plan);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // NGINXP07 planda PLAN_OK ama artik hedef degil; NGINXP01 planda SKIP.
  assert.deepEqual(r.body.items, [{ ...KALEM, hosts: ['NGINXP02'] }]);
  assert.deepEqual(kayit.durumSorgu, [], 'plan tablosu varken AWX okunmaz');

  // Surum plandan sonra degisti.
  isKaydet(2, 902, 'plan', [{ ...KALEM, version: '1.2.3-9-prod' }]);
  planTablosu(902, [['kart-prod', 'a-ui', 'NGINXP01', 'PLAN_OK']]);
  r = await uygula([A_UI], { serverId: 2, jobId: 902 });
  assert.equal(r.status, 409);
  assert.match(
    r.body.error,
    /^kart-prod\/a-ui: sürüm plandan sonra değişti \(plan 1\.2\.3-9-prod, şimdi 1\.2\.3-10-prod\)/,
  );

  // Iki kalem: biri PLAN_OK, digeri degil -> yalniz biri gider; hicbiri -> 409.
  isKaydet(2, 903, 'plan', [KALEM, K_UI_KALEM]);
  planTablosu(903, [
    ['kart-prod', 'a-ui', 'NGINXP01', 'FAIL'],
    ['kart-prod', 'k-ui', 'NGINXP01', 'PLAN_OK'],
    ['kart-prod', 'k-ui', 'NGINXP02', 'PLAN_OK'],
  ]);
  const ikisi = [A_UI, { namespace: 'kart-prod', application: 'k-ui' }];
  r = await uygula(ikisi, { serverId: 2, jobId: 903 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items, [K_UI_KALEM]);
  isKaydet(2, 904, 'plan', [KALEM]);
  planTablosu(904, [['kart-prod', 'a-ui', 'NGINXP01', 'FAIL']]);
  r = await uygula([A_UI], { serverId: 2, jobId: 904 });
  assert.deepEqual(
    [r.status, r.body.error],
    [409, 'Planda PLAN_OK sunucusu kalan kalem yok; yeniden planlayın.'],
  );
  assert.equal(kayit.launch.length, 2);
});

test('PK10 eszamanli is: secimle kesisen bitmemis is 409; bitmis / kesismeyen / eski serbest; AWX okunamazsa 409', async () => {
  sifirla();
  const plan = (app) =>
    istek('POST', '/intranet/paket/kur', { secim: [{ namespace: 'kart-prod', application: app }] });
  isKaydet(2, 600, 'apply', [KALEM]);
  ortam.durumlar.set(600, { status: 'running', templateId: 77, artifacts: {} });
  let r = await plan('a-ui');
  assert.deepEqual(
    [r.status, r.body.error],
    [409, 'Bu uygulama için süren bir kurulum işi var (#600).'],
  );
  // Uygulamada da (plan dogrulandiktan sonra) ayni kapi.
  isKaydet(2, 905, 'plan', [KALEM]);
  planTablosu(905, [['kart-prod', 'a-ui', 'NGINXP01', 'PLAN_OK']]);
  r = await uygula([A_UI], { serverId: 2, jobId: 905 });
  assert.deepEqual(
    [r.status, r.body.error],
    [409, 'Bu uygulama için süren bir kurulum işi var (#600).'],
  );
  assert.equal(kayit.launch.length, 0);
  assert.equal((await plan('k-ui')).status, 200, 'kesismeyen uygulama serbest');
  ortam.awxHata = 'zaman asimi';
  r = await plan('a-ui');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /#600 durumu AWX'ten okunamadı; .*zaman asimi/);
  ortam.awxHata = null;
  ortam.durumlar.set(600, { status: 'failed', templateId: 77, artifacts: {} });
  assert.equal((await plan('a-ui')).status, 200, 'AWX bitti diyor');
  ortam.durumlar.set(600, { status: 'pending', templateId: 77, artifacts: {} });
  planTablosu(600, [['kart-prod', 'a-ui', 'NGINXP01', 'FAIL']]);
  assert.equal((await plan('a-ui')).status, 200, 'sonucu tabloda olan is bitmis sayilir');
  kayit.tablo.length = 0;
  ortam.durumlar.set(600, { status: 'running', templateId: 77, artifacts: {} });
  isKaydet(2, 600, 'apply', [KALEM], { started_at: new Date(Date.now() - 4 * SAAT) });
  assert.equal((await plan('a-ui')).status, 409, '4 saatlik is hala sayilir (pencere 24 saat)');
  isKaydet(2, 600, 'apply', [KALEM], { started_at: new Date(Date.now() - 25 * SAAT) });
  assert.equal((await plan('a-ui')).status, 200, '24 saatten eski is sayilmaz');
});

test('PK14 yoklanmamis bitmis apply eszamanli denetimde tabloya yazilir; gecmis yazilamazsa yanit uyarir; coklu etiket engel', async () => {
  sifirla();
  isKaydet(2, 610, 'apply', [KALEM]);
  ortam.durumlar.set(610, {
    status: 'successful',
    templateId: 77,
    artifacts: sonucArtifact('apply', [
      {
        ...KALEM,
        hosts: [
          { host: 'NGINXP01', status: 'OK', step: 'cleanup', message: 'kuruldu' },
          { host: 'NGINXP02', status: 'OK', step: 'cleanup', message: 'kuruldu' },
        ],
      },
    ]),
  });
  const r = await istek('POST', '/intranet/paket/kur', { secim: [A_UI] });
  // Ekran isi hic yoklamadi; eszamanli denetim bitmis isi gorur, sonucunu yazar, 24 saat kapisi isler.
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /Kurulabilir değil: kart-prod\/a-ui/);
  assert.equal(kayit.tabloInsert, 1);
  assert.deepEqual(
    kayit.tablo.map((t) => [t.job_id, t.host, t.status]),
    [
      [610, 'NGINXP01', 'OK'],
      [610, 'NGINXP02', 'OK'],
    ],
  );
  assert.equal(kayit.launch.length, 0);

  sifirla();
  ortam.gecmisHata = 'baglanti koptu';
  const g = await istek('POST', '/intranet/paket/kur', {
    secim: [{ namespace: 'kart-prod', application: 'k-ui' }],
  });
  assert.equal(g.status, 200);
  assert.equal(kayit.launch.length, 1);
  assert.match(g.body.uyari, /iş geçmişine yazılamadı \(baglanti koptu\)/);
  assert.equal(kayit.denetim.at(-1).detail.gecmisYazilamadi, true);

  const s = P._ic.okumaSurumu(
    {
      cluster: 'arkprod1',
      alinma: null,
      nesneler: [
        {
          tur: 'Deployment',
          istenen: 2,
          containerlar: [
            { ad: 'web', imaj: imaj('a-ui', '1.0.0') },
            { ad: 'yan', imaj: imaj('a-ui', '1.0.1') },
          ],
        },
      ],
    },
    'kart-prod',
    'a-ui',
  );
  assert.equal(s.hata.kod, 'surum-farkli');
  assert.equal(s.hata.engel, true);
  assert.match(s.hata.metin, /birden çok etiketle koşuyor \(1\.0\.0, 1\.0\.1\)/);
});

test('PK11 son 24 saatte kurulan sunucu hedeften cikar; hepsi cikarsa yakin-zamanda-kuruldu engeli', async () => {
  sifirla();
  const ok = (host, zaman) =>
    kayit.tablo.push({
      server_id: 2,
      job_id: 800,
      mod: 'apply',
      namespace: 'kart-prod',
      application: 'a-ui',
      host,
      status: 'OK',
      zaman,
    });
  ok('NGINXP01', new Date(Date.now() - 2 * SAAT));
  const aday = async () =>
    (await istek('GET', '/intranet/paket/adaylar?fresh=1')).body.adaylar.find(
      (x) => x.application === 'a-ui',
    );
  let a = await aday();
  assert.deepEqual(a.hedefler, ['NGINXP02']);
  assert.equal(a.kurulabilir, true);
  assert.deepEqual(kodlar(a), ['yakin-zamanda-kuruldu:b', 'taranmayan:b']);
  ok('NGINXP02', new Date(Date.now() - SAAT));
  a = await aday();
  assert.deepEqual([a.hedefler, a.kurulabilir], [[], false]);
  assert.deepEqual(kodlar(a), ['yakin-zamanda-kuruldu:E', 'taranmayan:b']);
  assert.match(
    a.uyarilar[0].metin,
    /^son kurulum \d{4}-.*; dizin taraması bekleniyor \(NGINXP01, NGINXP02\)$/,
  );
  assert.ok(a.uyarilar[0].metin.includes(new Date(Date.now() - SAAT).toISOString().slice(0, 13)));
  kayit.tablo.forEach((t) => {
    t.zaman = new Date(Date.now() - 25 * SAAT);
  });
  a = await aday();
  assert.deepEqual([a.hedefler, a.kurulabilir], [['NGINXP01', 'NGINXP02'], true]);
});

test('PK12 ayni uyari kodu cluster basina tekrarlanmaz: iki PROD digest -> tek etiketsiz', () => {
  const a = P._ic.adayKur(satir('k-ui', { clusters: ['arkprod1', 'arkprod2'] }), {
    katalog: new Map([
      ['arkprod1', [{ env: 'PROD', tenant: 'ark', ad: 'arkprod1' }]],
      ['arkprod2', [{ env: 'PROD', tenant: 'ark', ad: 'arkprod2' }]],
    ]),
    okumalar: [
      okuma('arkprod1', `${REG}/kart-prod/k-ui@sha256:aaa`),
      okuma('arkprod2', `${REG}/kart-prod/k-ui@sha256:bbb`),
    ],
    simdi: Date.now(),
  });
  assert.deepEqual(kodlar(a), ['etiketsiz:E']);
  assert.match(a.uyarilar[0].metin, /^arkprod1: .*; arkprod2: /);
  assert.deepEqual(
    P._ic.uyarilariBirlestir([
      { kod: 'surum-yok', metin: 'x', engel: false },
      { kod: 'bayat', metin: 'b', engel: false },
      { kod: 'surum-yok', metin: 'y', engel: true },
    ]),
    [
      { kod: 'surum-yok', metin: 'x; y', engel: true },
      { kod: 'bayat', metin: 'b', engel: false },
    ],
  );
});

test('PK15 config_urls route ayrintisindan: PROD + SPA + paylasilmayan, intranet once, en cok 3; katalog okunamazsa engel', () => {
  const PRODA = new Set(['arkprod1']);
  const d = (host, ek = {}) => ({
    host,
    clusters: ['arkprod1'],
    terms: ['reencrypt'],
    spa: true,
    paylasilan: false,
    ...ek,
  });
  const ca = (detay) => P._ic.configAdresleri(detay, PRODA);
  // Bicim: kucuk harf, tekil; port / kullanici / bosluk / IP / localhost / tek etiket / sayisal TLD gecmez.
  const bicim = ca([
    d('A-UI.Apps.Invalid'),
    d('a-ui.apps.invalid'),
    ...[
      'kotu host.invalid',
      'x.invalid:8443',
      'u@y.invalid',
      '',
      null,
      '127.0.0.1',
      '169.254.169.254',
      'localhost',
      'intranetapp',
      'a.b.123',
      `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.invalid`,
    ].map((h) => d(h)),
  ]);
  assert.deepEqual(bicim.urls, ['https://a-ui.apps.invalid/config']);
  assert.equal(bicim.elenen.gecersiz, 9, JSON.stringify(bicim.elenen));
  // PROD disi cluster, SPA olmayan route ve paylasilan adres alinmaz; sayilir.
  const ele = ca([
    d('test.apps.invalid', { clusters: ['arktest1'] }),
    d('api.apps.invalid', { spa: false }),
    d('ortak.apps.invalid', { paylasilan: true }),
    d('iyi.apps.invalid', { clusters: ['arktest1', 'ARKPROD1'] }),
  ]);
  assert.deepEqual(ele.urls, ['https://iyi.apps.invalid/config']);
  assert.deepEqual(ele.elenen, { gecersiz: 0, spaDegil: 1, prodDisi: 1, paylasilan: 1 });
  // Sira: intranet (reencrypt) once, belirsiz / edge ortada, yalniz internet (passthrough) sonda.
  assert.deepEqual(
    ca([
      d('a.invalid', { terms: ['passthrough'] }),
      d('b.invalid', { terms: ['passthrough'] }),
      d('c.invalid', { terms: ['edge'] }),
      d('d.invalid', { terms: ['passthrough', 'reencrypt'] }),
      d('e.invalid'),
    ]).urls,
    ['https://d.invalid/config', 'https://e.invalid/config', 'https://c.invalid/config'],
  );
  assert.deepEqual(P._ic.configAdresleri(undefined, PRODA).urls, []);
  // Aday: paylasilan tek adres -> config-adresi-yok ENGEL + elendi bilgisi (adres metne yazilmaz).
  const paylasilan = P._ic.adayKur(
    satir('k-ui', {
      clusters: ['arkprod1'],
      routeDetay: [d('k-ui.apps.invalid', { paylasilan: true })],
    }),
    {
      katalog: new Map([['arkprod1', [{ env: 'PROD', tenant: 'ark', ad: 'arkprod1' }]]]),
      okumalar: [okuma('arkprod1', imaj('k-ui', '3.0.0'))],
      simdi: Date.now(),
    },
  );
  assert.deepEqual(
    [kodlar(paylasilan), paylasilan.kurulabilir],
    [['config-adresi-yok:E', 'config-adresi-elendi:b'], false],
  );
  assert.ok(!JSON.stringify(paylasilan.uyarilar).includes('apps.invalid'), 'adres uyariya yazildi');
  const ctx = {
    katalog: new Map(),
    katalogHata: 'baglanti yok',
    okumalar: [okuma('arkprod1', imaj('k-ui', '3.0.0'))],
    simdi: Date.now(),
  };
  const a = P._ic.adayKur(satir('k-ui', { clusters: ['arkprod1'] }), ctx);
  assert.equal(a.kurulabilir, false);
  assert.equal(a.uyarilar[0].kod, 'katalog-yok');
  assert.equal(a.uyarilar[0].engel, true);
  assert.match(a.uyarilar[0].metin, /okunamadı: baglanti yok/);
});

test('PK16 bayat sinir: 3 saat; bayat aday POST ile de kurulamaz (AWX cagrilmaz)', async () => {
  const kur = (dk) =>
    P._ic.adayKur(satir('k-ui', { clusters: ['arkprod1'] }), {
      katalog: new Map([['arkprod1', [{ env: 'PROD', tenant: 'ark', ad: 'arkprod1' }]]]),
      okumalar: [okuma('arkprod1', imaj('k-ui', '3.0.0'), { alinma: once(dk * 60000) })],
      simdi: Date.now(),
    });
  assert.deepEqual([kur(179).kurulabilir, kodlar(kur(179))], [true, []]);
  assert.deepEqual([kur(181).kurulabilir, kodlar(kur(181))], [false, ['bayat:E']]);
  sifirla();
  const r = await istek('POST', '/intranet/paket/kur', {
    secim: [{ namespace: 'kart-prod', application: 'bayat-ui' }],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Kurulabilir değil: kart-prod\/bayat-ui/);
  assert.equal(kayit.launch.length, 0);
});

test('PK13 uyari kodlari: sunucunun urettigi her kod UYARI_KODLARI listesinde ve ekran tipiyle birebir', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'paket-kurulum.cjs'), 'utf8');
  const uretilen = new Set([...kaynak.matchAll(/uyari\(\s*'([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(uretilen.size >= 10, `kod taramasi kor: ${[...uretilen]}`);
  const liste = new Set(P.UYARI_KODLARI);
  assert.equal(liste.size, P.UYARI_KODLARI.length, 'listede tekrar');
  assert.deepEqual(
    [...uretilen].filter((k) => !liste.has(k)),
    [],
    'listede olmayan kod',
  );
  assert.deepEqual(
    [...liste].filter((k) => !uretilen.has(k)),
    [],
    'uretilmeyen kod',
  );
  const ts = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'api', 'arkSpaApi.ts'),
    'utf8',
  );
  const blok = /export const PAKET_UYARI_KODLARI = \[([^\]]*)\] as const;/.exec(ts);
  assert.ok(blok, 'arkSpaApi.ts PAKET_UYARI_KODLARI dizisi bulunamadi');
  const tsKodlar = [...blok[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...tsKodlar].sort(), [...P.UYARI_KODLARI].sort());
  assert.match(ts, /export type PaketUyariKod = \(typeof PAKET_UYARI_KODLARI\)\[number\];/);
});

test('PK17 registry seed: bastionlu ilk aciklama yalniz birebir eskiyse guncellenir', async () => {
  const { PLAYBOOK_REGISTRY_SEED, seedPlaybookRegistry } = require('../../db/mssql-setup.cjs');
  const guncellemeler = [];
  const pool = {
    request() {
      const girdi = {};
      return {
        input(k, v) {
          girdi[k] = v;
          return this;
        },
        async query(sql) {
          if (/^\s*UPDATE ansible_playbook_registry/.test(sql)) guncellemeler.push({ sql, girdi });
          if (/SELECT 1 FROM ansible_playbook_registry WHERE key_name/.test(sql))
            return { recordset: [{ x: 1 }] };
          return { recordset: [] };
        },
      };
    },
  };
  const [l, w] = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    await seedPlaybookRegistry(pool);
  } finally {
    console.log = l;
    console.warn = w;
  }
  const g = guncellemeler.find((x) => /key_name = 'spa_package_install'/.test(x.sql));
  assert.ok(g, 'spa_package_install aciklama guncellemesi yok');
  assert.match(g.sql, /CAST\(description AS NVARCHAR\(MAX\)\) = @old_desc/);
  assert.match(
    g.girdi.old_desc,
    /Bastion: oc get ile kosan imaj etiketi ve application\.json ConfigMap/,
  );
  const seed = PLAYBOOK_REGISTRY_SEED.find((r) => r.key_name === 'spa_package_install');
  assert.equal(g.girdi.new_desc, seed.description);
  assert.doesNotMatch(seed.description, /Bastion:/);
});
