'use strict';
// OCP CLUSTER KATALOGU (server/ansible/ocp-store.cjs) — ansible_ocp_clusters deposu, ortak
// ocp_cluster_index'e ayna yazimi (dual-write) ve tek seferlik goc. Gercek DB yok: iki tablo ve
// portal_config_blobs bellek ici taklit (db.query cagri aninda okunur). Eski JSON dosyasi
// (server/ansible/ocp-clusters.json, git disi) yalniz O YOL icin sahte. Modul her testte taze.
// Ayna satirinin temel kurallari (pasif yer tutucu tenant, terminal_host) ocp-catalog-merge'de.
//   OC1 acilis: bos tabloya eski dosyadan goc (normalize), ortak indekse ayna, sonra DB'den yukleme.
//   OC2 dosya yok / bos / bozuksa blob'dan goc; tablo doluysa goc yok; bozuk blob goc saymaz.
//   OC3 DB yuklenemezse liste eski dosyadan; bozuk dosya bos liste.
//   OC4 ekleme: yeni kimlik, satir + ayna, onbellek; ayna dusse de ekleme basarili.
//   OC5 guncelleme: yalniz verilen alanlar degisir; bilinmeyen kimlik null; ayna UPDATE yolu.
//   OC6 silme: satir yoksa false (ayna dokunulmaz); ayna silme dusse de true.
//   OC7 baglanti durumu yazimi ve satir eslemesi (aktiflik 1 / true / 0).
//   OC8 indeks senkronu: satir hatasi digerlerini durdurmaz; senkron dusse de katalog yuklenir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../../db/index.cjs');

const MODUL = require.resolve('../ocp-store.cjs');
const ESKI_DOSYA = path.join(__dirname, '..', 'ocp-clusters.json');
const SUTUNLAR = [
  'id',
  'name',
  'display',
  'env',
  'api_url',
  'console_url',
  'token',
  'description',
  'namespace',
  'jump_host',
  'is_active',
  'created_by',
  'tenant',
];

/** ansible_ocp_clusters + ocp_cluster_index + portal_config_blobs; `bozuk` desenine uyan sorgu duser. */
function sahteDb(t, { katalog = [], indeks = [], blob, bozuk, satirHatasi } = {}) {
  const k = katalog.map((r) => ({ ...r }));
  const ix = indeks.map((r) => ({ ...r }));
  const sorgular = [];
  t.mock.method(db, 'query', async (sql, p = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    sorgular.push({ q, p });
    if (bozuk && bozuk.test(q)) throw new Error('DB yok');
    if (q === 'SELECT COUNT(*) AS n FROM ansible_ocp_clusters') return { rows: [{ n: k.length }] };
    if (q.startsWith('SELECT data FROM portal_config_blobs'))
      return { rows: blob === undefined ? [] : [{ data: blob }] };
    if (q.startsWith('SELECT * FROM ansible_ocp_clusters ORDER BY'))
      return {
        rows: [...k].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      };
    if (q === 'SELECT * FROM ansible_ocp_clusters') return { rows: k };
    if (q.startsWith('INSERT INTO ansible_ocp_clusters')) {
      if (satirHatasi && satirHatasi(p)) throw new Error('kisit ihlali');
      k.push(Object.fromEntries(SUTUNLAR.map((s, i) => [s, p[i]])));
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('UPDATE ansible_ocp_clusters SET name=')) {
      const r = k.find((x) => x.id === p[11]);
      if (r)
        Object.assign(r, {
          name: p[0],
          display: p[1],
          env: p[2],
          api_url: p[3],
          console_url: p[4],
          token: p[5],
          description: p[6],
          namespace: p[7],
          jump_host: p[8],
          is_active: p[9],
          tenant: p[10],
        });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (q.startsWith('UPDATE ansible_ocp_clusters SET connection_status=')) {
      const r = k.find((x) => x.id === p[1]);
      if (r) Object.assign(r, { connection_status: p[0], last_checked_at: 'simdi' });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (q.startsWith('DELETE FROM ansible_ocp_clusters')) {
      const once = k.length;
      k.splice(0, k.length, ...k.filter((x) => x.id !== p[0]));
      return { rows: [], rowCount: once - k.length };
    }
    if (q.startsWith('SELECT id FROM ocp_cluster_index WHERE legacy_id'))
      return { rows: ix.filter((x) => x.legacy_id === p[0]).map((x) => ({ id: x.id })) };
    if (q.startsWith('INSERT INTO ocp_cluster_index')) {
      ix.push({
        id: ix.length + 1,
        env: p[0],
        tenant: p[1],
        cluster_name: p[2],
        legacy_id: p[11],
        is_active: p[12],
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('UPDATE ocp_cluster_index')) {
      const r = ix.find((x) => x.legacy_id === p[10]);
      if (r) Object.assign(r, { env: p[0], tenant: p[1], cluster_name: p[2], terminal_host: p[3] });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (q.startsWith('DELETE FROM ocp_cluster_index')) {
      ix.splice(0, ix.length, ...ix.filter((x) => x.legacy_id !== p[0]));
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`beklenmeyen sorgu: ${q}`);
  });
  return { k, ix, sorgular };
}

/** Eski JSON dosyasi: yalniz o yol sahte (undefined = yok). */
function eskiDosya(t, icerik) {
  const varMi = fs.existsSync;
  const oku = fs.readFileSync;
  t.mock.method(fs, 'existsSync', (p, ...a) =>
    p === ESKI_DOSYA ? icerik !== undefined : varMi.call(fs, p, ...a),
  );
  t.mock.method(fs, 'readFileSync', (p, ...a) =>
    p === ESKI_DOSYA ? icerik : oku.call(fs, p, ...a),
  );
}

function taze(t) {
  const log = t.mock.method(console, 'log', () => {});
  const uyari = t.mock.method(console, 'warn', () => {});
  delete require.cache[MODUL];
  return { store: require(MODUL), log, uyari };
}

const satirlar = (m) => m.mock.calls.map((c) => c.arguments.join(' '));
const kayit = (o) => ({
  id: 'k1',
  name: 'ocp-a',
  display: 'A',
  env: 'prod',
  api_url: 'https://a',
  console_url: '',
  token: 't',
  description: '',
  namespace: 'ns',
  jump_host: 'j1',
  is_active: 1,
  created_by: 'admin',
  tenant: 'ana',
  ...o,
});

test('OC1 acilista eski dosyadan goc, ortak indekse ayna, DB yukleme', async (t) => {
  eskiDosya(
    t,
    JSON.stringify({
      clusters: [
        { name: ' ocp-b ', env: 'staging', apiUrl: ' https://b ', isActive: false },
        {
          id: 'sabit',
          name: 'ocp-a',
          display: 'A Cluster',
          env: 'qa',
          tenant: 'ana',
          jumpHost: 'j1',
        },
      ],
    }),
  );
  const { k, ix } = sahteDb(t);
  const { store, log } = taze(t);
  await store.loadOcpStore();

  assert.equal(k.length, 2);
  const b = k.find((r) => r.name === 'ocp-b');
  assert.match(b.id, /^[0-9a-f-]{36}$/, 'kimliksiz kayda UUID uretilmedi');
  assert.deepEqual(
    [b.display, b.env, b.api_url, b.is_active, b.tenant, b.created_by],
    ['ocp-b', 'prod', 'https://b', false, null, null],
  );
  assert.equal(k.find((r) => r.name === 'ocp-a').id, 'sabit');

  // Ayna: tenant'siz kayit yer tutucu tenant ile PASIF, tenant'li kayit aktif.
  assert.deepEqual(ix.map((r) => [r.cluster_name, r.tenant, r.is_active]).sort(), [
    ['ocp-a', 'ana', 1],
    ['ocp-b', store.UNASSIGNED_TENANT, 0],
  ]);
  const l = satirlar(log);
  assert.ok(l.includes('[DB] migrated ocp-clusters (2 satir)'));
  assert.ok(
    l.includes('[OcpStore] 2 cluster ocp_cluster_index ile senkronlandi (katalog birlestirme).'),
  );
  assert.ok(l.includes("[OcpStore] 2 cluster DB'den yuklendi."));

  const liste = store.getOcpClusters();
  assert.deepEqual(
    liste.map((c) => c.name),
    ['ocp-a', 'ocp-b'],
  );
  assert.deepEqual(liste[0], {
    id: 'sabit',
    name: 'ocp-a',
    display: 'A Cluster',
    env: 'qa',
    apiUrl: '',
    consoleUrl: '',
    token: '',
    description: '',
    namespace: '',
    tenant: 'ana',
    jumpHost: 'j1',
    isActive: true,
    createdAt: null,
    createdBy: null,
    lastCheckedAt: null,
    connectionStatus: null,
  });
  liste.pop();
  assert.equal(store.getOcpClusters().length, 2, 'liste onbellegin kendisi olarak verildi');
});

test('OC2 dosya yok, bos ya da bozuksa blobdan; tablo doluysa goc yok', async (t) => {
  for (const dosya of [undefined, '{bozuk', JSON.stringify({ clusters: [] }), JSON.stringify({})]) {
    t.mock.restoreAll();
    eskiDosya(t, dosya);
    const { k } = sahteDb(t, {
      blob: JSON.stringify({ clusters: [{ name: 'blobdan', tenant: 'x' }] }),
    });
    const { store } = taze(t);
    await store.loadOcpStore();
    assert.deepEqual(
      k.map((r) => r.name),
      ['blobdan'],
      `dosya=${dosya}`,
    );
  }
  for (const blob of ['{bozuk', JSON.stringify({ clusters: [] }), undefined]) {
    t.mock.restoreAll();
    eskiDosya(t, undefined);
    const { k } = sahteDb(t, { blob });
    const { store, log } = taze(t);
    await store.loadOcpStore();
    assert.equal(k.length, 0, `blob=${blob}`);
    assert.ok(!satirlar(log).some((l) => l.includes('migrated')), `blob=${blob}`);
  }
  t.mock.restoreAll();
  eskiDosya(t, JSON.stringify({ clusters: [{ name: 'yeni' }] }));
  const dolu = sahteDb(t, { katalog: [kayit({})] });
  const { store } = taze(t);
  await store.loadOcpStore();
  assert.deepEqual(
    dolu.k.map((r) => r.name),
    ['ocp-a'],
  );
  assert.ok(!dolu.sorgular.some((x) => x.q.startsWith('SELECT data FROM portal_config_blobs')));
});

test('OC2b goc satiri eklenemezse digerleri surer', async (t) => {
  eskiDosya(t, JSON.stringify({ clusters: [{ name: 'kotu' }, { name: 'iyi' }] }));
  const { k } = sahteDb(t, { satirHatasi: (p) => p[1] === 'kotu' });
  const { store, log, uyari } = taze(t);
  await store.loadOcpStore();
  assert.deepEqual(
    k.map((r) => r.name),
    ['iyi'],
  );
  assert.ok(satirlar(uyari).includes('[OcpStore] import satiri eklenemedi (kotu): kisit ihlali'));
  assert.ok(satirlar(log).includes('[DB] migrated ocp-clusters (1 satir)'));
});

test('OC3 DB yuklenemezse liste eski dosyadan; bozuk dosya bos liste', async (t) => {
  eskiDosya(t, JSON.stringify({ clusters: [{ id: 'd1', name: ' dosyadan ', env: 'dev' }] }));
  sahteDb(t, { bozuk: /./ });
  let s = taze(t);
  await s.store.loadOcpStore();
  assert.ok(satirlar(s.uyari).includes('[OcpStore] DB yuklenemedi, dosya fallback aktif: DB yok'));
  const liste = s.store.getOcpClusters();
  assert.deepEqual(
    liste.map((c) => [c.id, c.name, c.env, c.isActive]),
    [['d1', 'dosyadan', 'dev', true]],
  );

  for (const dosya of ['{bozuk', JSON.stringify({ clusters: 'dizi degil' }), undefined]) {
    t.mock.restoreAll();
    eskiDosya(t, dosya);
    sahteDb(t, { bozuk: /./ });
    s = taze(t);
    await s.store.loadOcpStore();
    assert.deepEqual(s.store.getOcpClusters(), [], `dosya=${dosya}`);
  }
});

test('OC4 ekleme: yeni kimlik, satir + ayna, onbellek; ayna dusse de basarili', async (t) => {
  eskiDosya(t, undefined);
  const { k, ix } = sahteDb(t);
  const { store, uyari } = taze(t);
  await store.loadOcpStore();
  const c = await store.addOcpCluster({
    id: 'verilen',
    name: ' ocp-x ',
    env: 'test',
    tenant: 'ana',
    createdBy: ' ali ',
  });
  assert.notEqual(c.id, 'verilen', 'istemcinin verdigi kimlik kullanildi');
  assert.match(c.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual([c.name, c.env, c.createdBy, c.isActive], ['ocp-x', 'test', 'ali', true]);
  assert.equal(k[0].id, c.id);
  assert.deepEqual(
    ix.map((r) => [r.legacy_id, r.tenant, r.is_active]),
    [[c.id, 'ana', 1]],
  );
  assert.deepEqual(
    store.getOcpClusters().map((x) => x.id),
    [c.id],
  );
  // Tenant'i olan ama pasif eklenen kayit aynada da pasif.
  const pasif = await store.addOcpCluster({ name: 'ocp-p', tenant: 'ana', isActive: false });
  assert.equal(ix.find((r) => r.legacy_id === pasif.id).is_active, 0);

  t.mock.restoreAll();
  eskiDosya(t, undefined);
  const d = sahteDb(t, { bozuk: /ocp_cluster_index/ });
  const s2 = taze(t);
  await s2.store.loadOcpStore();
  const c2 = await s2.store.addOcpCluster({ name: 'ocp-y' });
  assert.equal(d.k.length, 1, 'ayna dusunce ekleme de dustu');
  assert.ok(
    satirlar(s2.uyari).includes(
      '[OcpStore] ocp_cluster_index aynasi guncellenemedi (add ocp-y): DB yok',
    ),
  );
  assert.equal(s2.store.getOcpClusters()[0].id, c2.id);
  assert.ok(uyari);
});

test('OC5 guncelleme: yalniz verilen alanlar; bilinmeyen kimlik null; ayna guncellenir', async (t) => {
  eskiDosya(t, undefined);
  const { k, ix, sorgular } = sahteDb(t, {
    katalog: [kayit({})],
    indeks: [{ id: 5, legacy_id: 'k1', tenant: 'ana', cluster_name: 'ocp-a', is_active: 1 }],
  });
  const { store } = taze(t);
  await store.loadOcpStore();

  const once = sorgular.length;
  assert.equal(await store.updateOcpCluster('yok', { name: 'x' }), null);
  assert.equal(sorgular.length, once, 'bilinmeyen kimlikte sorgu atildi');

  const m = await store.updateOcpCluster('k1', {
    name: ' ocp-a2 ',
    env: 'gecersiz',
    jumpHost: undefined,
    token: '',
    isActive: false,
    tenant: 'yeni-tenant',
    id: 'baska',
  });
  assert.equal(m.id, 'k1', 'kimlik degisti');
  assert.deepEqual(
    [m.name, m.env, m.jumpHost, m.token, m.isActive, m.tenant, m.display, m.apiUrl],
    ['ocp-a2', 'prod', 'j1', '', false, 'yeni-tenant', 'A', 'https://a'],
  );
  assert.deepEqual(
    [k[0].name, k[0].jump_host, k[0].token, k[0].is_active, k[0].tenant],
    ['ocp-a2', 'j1', '', false, 'yeni-tenant'],
  );
  assert.equal(ix.length, 1, 'ayna yeni satir acti');
  assert.deepEqual(
    [ix[0].cluster_name, ix[0].tenant, ix[0].terminal_host],
    ['ocp-a2', 'yeni-tenant', 'j1'],
  );
  assert.equal(store.getOcpClusters()[0].name, 'ocp-a2');

  // Tum alanlar tek tek guncellenebilir; tenant bosaltilinca null yazilir.
  const tam = await store.updateOcpCluster('k1', {
    display: 'D',
    apiUrl: 'https://yeni',
    consoleUrl: 'https://konsol',
    description: 'acik',
    namespace: 'ns2',
    jumpHost: 'j9',
    env: 'qa',
    tenant: '',
  });
  assert.deepEqual(
    [
      tam.display,
      tam.apiUrl,
      tam.consoleUrl,
      tam.description,
      tam.namespace,
      tam.jumpHost,
      tam.env,
    ],
    ['D', 'https://yeni', 'https://konsol', 'acik', 'ns2', 'j9', 'qa'],
  );
  assert.equal(k[0].tenant, null);
});

test('OC6 silme', async (t) => {
  eskiDosya(t, undefined);
  const { k, ix, sorgular } = sahteDb(t, {
    katalog: [kayit({}), kayit({ id: 'k2', name: 'ocp-b' })],
    indeks: [{ id: 1, legacy_id: 'k1' }],
  });
  const { store } = taze(t);
  await store.loadOcpStore();
  assert.equal(await store.deleteOcpCluster('yok'), false);
  assert.ok(
    !sorgular.some((x) => x.q.startsWith('DELETE FROM ocp_cluster_index')),
    'olmayan kayit icin ayna silindi',
  );
  assert.equal(await store.deleteOcpCluster('k1'), true);
  assert.deepEqual(
    k.map((r) => r.id),
    ['k2'],
  );
  // Acilis senkronu k2'yi de aynalamisti; silinen yalniz k1'in aynasi.
  assert.deepEqual(
    ix.map((r) => r.legacy_id),
    ['k2'],
  );
  assert.deepEqual(
    store.getOcpClusters().map((c) => c.id),
    ['k2'],
  );

  t.mock.restoreAll();
  eskiDosya(t, undefined);
  sahteDb(t, { katalog: [kayit({})], bozuk: /^DELETE FROM ocp_cluster_index/ });
  const s2 = taze(t);
  await s2.store.loadOcpStore();
  assert.equal(await s2.store.deleteOcpCluster('k1'), true);
  assert.ok(satirlar(s2.uyari).includes('[OcpStore] ocp_cluster_index ayna silme hatasi: DB yok'));
});

test('OC7 baglanti durumu ve satir eslemesi', async (t) => {
  eskiDosya(t, undefined);
  const { k } = sahteDb(t, {
    katalog: [
      kayit({}),
      kayit({ id: 'k2', name: 'ocp-b', is_active: true, display: null, created_at: 'c1' }),
      kayit({ id: 'k3', name: 'ocp-c', is_active: 0, env: null, tenant: null, jump_host: null }),
    ],
  });
  const { store } = taze(t);
  await store.loadOcpStore();
  await store.setClusterConnectionStatus('k1', 'ok');
  assert.equal(k[0].connection_status, 'ok');
  const [a, b, c] = store.getOcpClusters();
  assert.deepEqual([a.connectionStatus, a.lastCheckedAt, a.isActive], ['ok', 'simdi', true]);
  assert.deepEqual([b.isActive, b.display, b.createdAt], [true, 'ocp-b', 'c1']);
  assert.deepEqual([c.isActive, c.env, c.tenant, c.jumpHost], [false, 'prod', '', '']);
});

test('OC8 indeks senkronu satir hatasinda surer; senkron dusse de katalog yuklenir', async (t) => {
  eskiDosya(t, undefined);
  const { ix } = sahteDb(t, { katalog: [kayit({}), kayit({ id: 'k2', name: 'ocp-b' })] });
  const asil = db.query;
  t.mock.method(db, 'query', async (sql, p) => {
    if (sql.includes('SELECT id FROM ocp_cluster_index') && p[0] === 'k1') throw new Error('kilit');
    return asil(sql, p);
  });
  let s = taze(t);
  await s.store.syncClustersIntoIndex();
  assert.deepEqual(
    ix.map((r) => r.legacy_id),
    ['k2'],
  );
  assert.ok(satirlar(s.uyari).includes("[OcpStore] 'ocp-a' ocp_cluster_index'e tasinamadi: kilit"));
  assert.ok(
    satirlar(s.log).includes(
      '[OcpStore] 1 cluster ocp_cluster_index ile senkronlandi (katalog birlestirme).',
    ),
  );

  t.mock.restoreAll();
  eskiDosya(t, undefined);
  sahteDb(t, { katalog: [] });
  s = taze(t);
  await s.store.syncClustersIntoIndex();
  assert.ok(!satirlar(s.log).some((l) => l.includes('senkronlandi')), 'bos katalogda senkron logu');

  t.mock.restoreAll();
  eskiDosya(t, undefined);
  sahteDb(t, { katalog: [kayit({})], bozuk: /^SELECT \* FROM ansible_ocp_clusters$/ });
  s = taze(t);
  await s.store.loadOcpStore();
  assert.ok(satirlar(s.uyari).includes('[OcpStore] indeks senkronu atlandi: DB yok'));
  assert.ok(satirlar(s.log).includes("[OcpStore] 1 cluster DB'den yuklendi."));
  assert.equal(s.store.getOcpClusters().length, 1);
});
