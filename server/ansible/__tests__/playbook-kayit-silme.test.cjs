// server/ansible/__tests__/playbook-kayit-silme.test.cjs - PK1..PK9 (2026-11-02).
//
// Kullanici: "Admin > Playbook Kayitlari'nda sildigim varsayilan satirlar restart sonrasi geri
// geliyor." Sebep: seedPlaybookRegistry (server/db/mssql-setup.cjs) her acilista
// PLAYBOOK_REGISTRY_SEED satirlarini "yoksa ekle" diye yeniden ekliyordu. Simdi varsayilan satir
// silinirken ansible_playbook_registry_silinen'e iz yazilir, seed izli anahtari eklemez,
// "Geri yukle" izi siler ve seed satirini seed degerleriyle yeniden ekler. Silmeden once ekran
// anahtari kullanan Portal ozelligini gosterir (server/ansible/playbook-kullanim.cjs).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', '..');
const SETUP_YOL = path.join(SERVER, 'db', 'mssql-setup.cjs');
const SETUP_SRC = fs.readFileSync(SETUP_YOL, 'utf8');
const { PLAYBOOK_REGISTRY_SEED, seedPlaybookRegistry } = require(SETUP_YOL);
const { KULLANIM, kullananOzellik } = require('../playbook-kullanim.cjs');
const SEED_ANAHTAR = new Set(PLAYBOOK_REGISTRY_SEED.map((r) => r.key_name));

// -- Sahte db (playbook-registry.cjs '../db/index.cjs' ister) --
const DB_YOL = require.resolve('../../db/index.cjs');
const db = { cagrilar: [], yanit: /** @type {(sql?: string, params?: any[]) => any} */ (() => ({ rows: [], rowCount: 0 })) };
require.cache[DB_YOL] = {
  id: DB_YOL,
  filename: DB_YOL,
  loaded: true,
  exports: {
    query: async (sql, params = []) => {
      db.cagrilar.push({ sql, params });
      return db.yanit(sql, params);
    },
  },
};
const registry = require('../playbook-registry.cjs');
function dbSifirla(yanit) {
  db.cagrilar = [];
  db.yanit = yanit || (() => ({ rows: [], rowCount: 0 }));
}

function kodDosyalari(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) kodDosyalari(p, out);
    else if (e.name.endsWith('.cjs')) out.push(p);
  }
  return out;
}

test('PK1 kod icinde adiyla anilan HER seed anahtari kullanim haritasinda; harita seed ile birebir', () => {
  const haric = new Set([SETUP_YOL, require.resolve('../playbook-kullanim.cjs')]);
  const anilan = new Map();
  for (const f of kodDosyalari(SERVER)) {
    if (haric.has(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const k of SEED_ANAHTAR) {
      if (new RegExp(`['"\`]${k}['"\`]`).test(src)) {
        if (!anilan.has(k)) anilan.set(k, []);
        anilan.get(k).push(path.relative(SERVER, f));
      }
    }
  }
  for (const k of ['nginx_loadtest_run', 'filex_list_files', 'logx_legacy_discovery', 'opsx_was_operation'])
    assert.ok(anilan.has(k), `tarama ${k} anahtarini bulamadi (bekci kendini dogrulayamiyor)`);
  for (const [k, yerler] of anilan)
    assert.ok(kullananOzellik(k), `${k} kodda kullaniliyor (${yerler.join(', ')}) ama kullanim haritasinda yok`);
  for (const k of Object.keys(KULLANIM)) assert.ok(SEED_ANAHTAR.has(k), `haritada seed'de olmayan anahtar: ${k}`);
  for (const k of SEED_ANAHTAR) assert.ok(KULLANIM[k], `seed anahtari haritada yok: ${k}`);
  assert.equal(kullananOzellik('nginx_loadtest_run'), 'Nginx Hub > Yük Testi');
  assert.equal(kullananOzellik('admin_elle_acti'), null);
  assert.equal(kullananOzellik('constructor'), null, 'prototip anahtari ozellik sanilmamali');
});

function sahtePool({ mevcut = [], silinen = [], silinenHata = null }) {
  const eklenen = [];
  return {
    eklenen,
    request() {
      const girdi = {};
      return {
        input(k, v) {
          girdi[k] = v;
          return this;
        },
        async query(sql) {
          if (/FROM ansible_playbook_registry_silinen/.test(sql)) {
            if (silinenHata) throw typeof silinenHata === 'string' ? new Error(silinenHata) : silinenHata;
            return { recordset: silinen.map((key_name) => ({ key_name })) };
          }
          if (/SELECT 1 FROM ansible_playbook_registry WHERE key_name/.test(sql))
            return { recordset: mevcut.includes(girdi.key_name) ? [{ x: 1 }] : [] };
          if (/INSERT INTO ansible_playbook_registry\b/.test(sql)) eklenen.push(girdi.key_name);
          return { recordset: [] };
        },
      };
    },
  };
}

function sessiz(fn) {
  const [l, w] = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  return Promise.resolve(fn()).finally(() => {
    console.log = l;
    console.warn = w;
  });
}

test('PK2 seed izli (silinmis) varsayilani GERI EKLEMEZ, digerlerini ekler', async () => {
  const pool = sahtePool({ mevcut: ['ocp_pod_status'], silinen: ['nginx_loadtest_run', 'jvm_heap_status'] });
  await sessiz(() => seedPlaybookRegistry(pool));
  assert.ok(!pool.eklenen.includes('nginx_loadtest_run'), 'silinen varsayilan restart\'ta geri geldi');
  assert.ok(!pool.eklenen.includes('jvm_heap_status'), 'silinen varsayilan restart\'ta geri geldi');
  assert.ok(!pool.eklenen.includes('ocp_pod_status'), 'mevcut satir yeniden eklendi');
  assert.equal(pool.eklenen.length, PLAYBOOK_REGISTRY_SEED.length - 3);
  assert.ok(pool.eklenen.includes('filex_list_files'));
});

test('PK3 iz tablosu YOKSA seed bugunku gibi; baska okuma hatasinda HIC ekleme yapmaz', async () => {
  const yok = sahtePool({ silinenHata: "Invalid object name 'ansible_playbook_registry_silinen'." });
  await sessiz(() => seedPlaybookRegistry(yok));
  assert.equal(yok.eklenen.length, PLAYBOOK_REGISTRY_SEED.length);
  const tr = sahtePool({ silinenHata: Object.assign(new Error("Gecersiz nesne adi 'ansible_playbook_registry_silinen'."), { number: 208 }) });
  await sessiz(() => seedPlaybookRegistry(tr));
  assert.equal(tr.eklenen.length, PLAYBOOK_REGISTRY_SEED.length, 'tablo-yok (208) oturum dili Ingilizce degilken taninmadi');
  const dusen = sahtePool({ silinenHata: 'Connection lost' });
  await sessiz(() => seedPlaybookRegistry(dusen));
  assert.deepEqual(dusen.eklenen, [], 'iz okunamadan seed calisti: silinmis satirlar geri gelebilir');
});

test('PK4 varsayilan satir silinirken iz AYNI islemde yazilir; elle acilan satirda iz yok', async () => {
  dbSifirla((sql) =>
    /^SELECT \* FROM ansible_playbook_registry WHERE id/.test(sql)
      ? { rows: [{ id: 7, key_name: 'nginx_loadtest_run', display_name: 'Yuk' }], rowCount: 1 }
      : { rows: [{ key_name: 'nginx_loadtest_run' }], rowCount: 1 },
  );
  const s = await registry.remove('7', { username: 'ali' });
  assert.deepEqual(s, { keyName: 'nginx_loadtest_run', displayName: 'Yuk', varsayilan: true });
  const sil = db.cagrilar[1];
  assert.equal(db.cagrilar.length, 2, 'iz ve silme tek batch olmali');
  assert.match(sil.sql, /SET XACT_ABORT ON/);
  assert.match(sil.sql, /BEGIN TRANSACTION[\s\S]*INSERT INTO ansible_playbook_registry_silinen[\s\S]*DELETE FROM ansible_playbook_registry[\s\S]*COMMIT/);
  assert.deepEqual(sil.params, ['7', 'nginx_loadtest_run', 'ali']);

  dbSifirla((sql) =>
    /^SELECT \*/.test(sql)
      ? { rows: [{ id: 9, key_name: 'admin_elle_acti', display_name: 'X' }], rowCount: 1 }
      : { rows: [], rowCount: 1 },
  );
  const e = await registry.remove('9', { username: 'ali' });
  assert.equal(e.varsayilan, false);
  assert.ok(!db.cagrilar.some((c) => /_silinen/.test(c.sql)), 'varsayilan olmayan satir icin iz yazildi');

  dbSifirla(() => ({ rows: [], rowCount: 0 }));
  assert.equal(await registry.remove('404'), null);
  assert.equal(db.cagrilar.length, 1);
});

test('PK5 geri yukleme izi siler ve SEED DEGERLERIYLE ekler; seed disi anahtar reddedilir', async () => {
  dbSifirla(() => ({ rows: [], rowCount: 0 }));
  await assert.rejects(() => registry.geriYukle('admin_elle_acti'), (e) => e.status === 400);
  assert.equal(db.cagrilar.length, 0);

  const seed = PLAYBOOK_REGISTRY_SEED.find((r) => r.key_name === 'filex_list_files');
  dbSifirla((sql) => (/^SELECT \*/.test(sql) ? { rows: [{ id: 3, key_name: seed.key_name }], rowCount: 1 } : { rows: [], rowCount: 1 }));
  const row = await registry.geriYukle('filex_list_files');
  assert.equal(row.keyName, 'filex_list_files');
  const q = db.cagrilar[0];
  assert.match(q.sql, /SET XACT_ABORT ON[\s\S]*BEGIN TRANSACTION[\s\S]*DELETE FROM ansible_playbook_registry_silinen[\s\S]*IF NOT EXISTS[\s\S]*INSERT INTO ansible_playbook_registry[\s\S]*COMMIT/);
  assert.deepEqual(q.params, [seed.key_name, seed.display_name, seed.description, seed.category, seed.handler, seed.playbook_path, seed.env_var_name]);
  // Kolon listesi seedPlaybookRegistry'deki INSERT ile ayni olmali (ayrisirsa geri yuklenen satir farkli olur).
  const kolon = (src) => (src.match(/INSERT INTO ansible_playbook_registry\s*\(([^)]+)\)/) || [])[1].replace(/\s+/g, '');
  const fn = SETUP_SRC.slice(SETUP_SRC.indexOf('async function seedPlaybookRegistry'));
  assert.equal(kolon(q.sql), kolon(fn));
});

test('PK6 silinen listesi seed\'den cikmis anahtari gostermez (geri yuklenemez)', async () => {
  dbSifirla(() => ({
    rows: [
      { key_name: 'nginx_loadtest_run', deleted_by: 'ali', deleted_at: '2026-11-02T10:00:00Z' },
      { key_name: 'eski_kaldirilmis', deleted_by: 'veli', deleted_at: null },
    ],
  }));
  const l = await registry.listSilinenVarsayilanlar();
  assert.deepEqual(l.map((x) => x.keyName), ['nginx_loadtest_run']);
  assert.equal(l[0].deletedBy, 'ali');
  assert.match(db.cagrilar[0].sql, /NOT EXISTS \(SELECT 1 FROM ansible_playbook_registry r WHERE r.key_name = s.key_name\)/);
});

function sahteApp() {
  const rotalar = {};
  const ekle = (m) => (yol, ...h) => {
    rotalar[`${m} ${yol}`] = h;
  };
  return { rotalar, get: ekle('GET'), delete: ekle('DELETE'), post: ekle('POST') };
}
const AUTH = () => {};
const ADMIN = () => {};
async function cagir(handlers, req) {
  const res = {
    kod: 200,
    govde: null,
    status(k) {
      this.kod = k;
      return this;
    },
    json(b) {
      this.govde = b;
      return this;
    },
  };
  await handlers[handlers.length - 1]({ session: { user: { username: 'ali' } }, params: {}, ...req }, res);
  return res;
}

test('PK7 uclar: liste kullanan + varsayilan + silinenleri dondurur; silme / geri yukleme denetlenir', async () => {
  const app = sahteApp();
  const denetim = [];
  const reg = {
    listAll: async () => [{ keyName: 'nginx_loadtest_run' }, { keyName: 'admin_elle_acti' }],
    getEffectiveTemplateId: () => null,
    varsayilanSatir: (k) => (SEED_ANAHTAR.has(k) ? {} : null),
    listSilinenVarsayilanlar: async () => [{ keyName: 'jvm_heap_status' }],
    remove: async (id) => (id === '7' ? { keyName: 'nginx_loadtest_run', varsayilan: true } : null),
    geriYukle: async (k) => ({ keyName: k }),
  };
  require('../playbook-kayit-rotalari.cjs').kaydet(app, {
    requireAuth: AUTH,
    requireAdmin: ADMIN,
    registry: reg,
    audit: (req, action, o) => denetim.push({ action, ...o }),
  });
  for (const [ad, h] of Object.entries(app.rotalar)) {
    assert.equal(h[0], AUTH, `${ad} requireAuth yok`);
    assert.equal(h[1], ADMIN, `${ad} requireAdmin yok`);
  }

  const l = await cagir(app.rotalar['GET /api/ansible/playbooks']);
  assert.equal(l.govde.playbooks[0].kullanan, 'Nginx Hub > Yük Testi');
  assert.equal(l.govde.playbooks[0].varsayilan, true);
  assert.equal(l.govde.playbooks[1].kullanan, null);
  assert.equal(l.govde.playbooks[1].varsayilan, false);
  assert.deepEqual(l.govde.silinenVarsayilanlar, [{ keyName: 'jvm_heap_status' }]);

  reg.listSilinenVarsayilanlar = async () => {
    throw new Error('tablo yok');
  };
  const l2 = await cagir(app.rotalar['GET /api/ansible/playbooks']);
  assert.equal(l2.kod, 200, 'silinenler okunamayinca liste de dusmemeli');
  assert.equal(l2.govde.silinenVarsayilanlar, null, 'okunamayan liste bos dizi gibi gosterilmemeli');
  assert.equal(l2.govde.silinenHata, 'tablo yok');

  const d = await cagir(app.rotalar['DELETE /api/ansible/playbooks/:id'], { params: { id: '7' } });
  assert.equal(d.govde.kullanan, 'Nginx Hub > Yük Testi');
  assert.equal(denetim.length, 1);
  assert.equal(denetim[0].action, 'playbook_kayit_sil');
  assert.deepEqual(JSON.parse(denetim[0].detail), { keyName: 'nginx_loadtest_run', varsayilan: true, kullanan: 'Nginx Hub > Yük Testi' });
  const d404 = await cagir(app.rotalar['DELETE /api/ansible/playbooks/:id'], { params: { id: '8' } });
  assert.equal(d404.kod, 404);
  assert.equal(denetim.length, 1, 'bulunamayan silme denetime yazildi');

  const G = 'POST /api/ansible/playbooks/silinen/:keyName/geri-yukle';
  const bad = await cagir(app.rotalar[G], { params: { keyName: "x'; DROP" } });
  assert.equal(bad.kod, 400);
  const g = await cagir(app.rotalar[G], { params: { keyName: 'jvm_heap_status' } });
  assert.equal(g.govde.ok, true);
  assert.equal(denetim[1].action, 'playbook_varsayilan_geri_yukle');
  assert.deepEqual(JSON.parse(denetim[1].detail), { keyName: 'jvm_heap_status' });
  reg.geriYukle = async () => {
    throw Object.assign(new Error('varsayilan degil'), { status: 400 });
  };
  const g400 = await cagir(app.rotalar[G], { params: { keyName: 'abc' } });
  assert.equal(g400.kod, 400);
  assert.equal(denetim.length, 2);
});

test('PK8 runner.cjs uclari modulden baglar; eski liste / silme ucu ikinci kez tanimlanmaz', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  assert.match(src, /require\('\.\/playbook-kayit-rotalari\.cjs'\)\.kaydet\(app, \{ requireAuth, requireAdmin \}\)/);
  assert.doesNotMatch(src, /app\.delete\('\/api\/ansible\/playbooks\/:id'/);
  assert.doesNotMatch(src, /app\.get\('\/api\/ansible\/playbooks',/);
});

test('PK9 iz tablosu TABLES icinde (seed\'den once kurulur), anahtar birincil anahtar', () => {
  const tablolar = SETUP_SRC.slice(SETUP_SRC.indexOf('const TABLES'), SETUP_SRC.indexOf('const PLAYBOOK_REGISTRY_SEED'));
  assert.match(tablolar, /CREATE TABLE ansible_playbook_registry_silinen \(\s*key_name\s+NVARCHAR\(100\) NOT NULL PRIMARY KEY/);
});
