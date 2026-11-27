// server/nginx-migration/__tests__/nginx-migration-takip.test.js — Nginx PROD tasimasi GECIS TAKIBI,
// yonetici ayari ve tarama tazeleme uclari (2026-11-27, kapsam PR-2; index.cjs dal dusuk).
//
// Ekranin (NginxProdMigration) okudugu / yazdigi takip uclari hicbir testte kosmuyordu: dogrulama,
// ekle / guncelle ayrimi, toplu kaydin "ya hepsi dogrulanir ya hicbiri yazilmaz" kurali, kismi yazim,
// AWX is durumunun takibe islenmesi (uzlastirma) yalnizca yorumdaydi. Duzenek ortak (_harness.cjs):
// gercek Express ucu, gercek runner (sahte AWX), gercek gorunurluk motoru; DB yanitlari test basina.
//   NT1 takip listesi: satir ve yol bazli is eslemesi; yol kayitlari okunamazsa liste yine gelir; DB yoksa 503
//   NT2 uzlastirma: canli gorunen isler AWX'e sorulur, durum takibe islenir (terminalde bitis zamani)
//   NT3 tek kayit: dogrulama, ekle / guncelle, normallestirme, denetim, DB hatasi
//   NT4 toplu kayit: bos / 200 ustu / tek gecersiz oge hicbirini yazmaz; kismi yazim; liste okunamadi
//   NT5 yonetici ayari: yalniz Admin, zorunlu alanlar, ekle / guncelle, DB hatasi
//   NT6 tarama tazeleme: AWX kaydi tanimli degilse 501
'use strict';

const h = require('./_harness.cjs');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

before(h.start);
after(h.stop);
beforeEach(h.reset);

const T = '/api/nginx-migration/tracking';
const TAKIP = { group: 'other', namespace: 'webforms-ch-prod', application: 'base-app-v0' };
const satir = (o = {}) => ({
  group_id: 'other',
  namespace: 'webforms-ch-prod',
  application: 'base-app-v0',
  state: null,
  planned_date: null,
  migrated_date: null,
  note: null,
  in_use: null,
  in_use_by: null,
  in_use_at: null,
  config_job_id: null,
  config_created_at: null,
  config_created_by: null,
  config_job_status: null,
  config_job_finished_at: null,
  config_service: null,
  config_location: null,
  delete_job_id: null,
  delete_requested_at: null,
  delete_requested_by: null,
  delete_job_status: null,
  updated_by: null,
  updated_at: null,
  ...o,
});
const yazimlar = (re) => h.appQueries().filter((q) => re.test(q.sql));

test('NT1 takip listesi: satır ve yol bazlı iş eşlemesi; yol kayıtları okunamazsa liste gelir; DB yoksa 503', async () => {
  const d = new Date('2026-11-20T08:30:00Z');
  h.dbYanit = (sql) => {
    if (/SELECT TOP 10 config_job_id/.test(sql)) return { rows: [] };
    if (/FROM nginx_migration_path_jobs/.test(sql))
      return {
        rows: [
          {
            group_id: 'other',
            namespace: 'webforms-ch-prod',
            application: 'base-app-v0',
            service: 'WEBFORMS',
            location: '/base/',
            job_id: '41',
            status: 'successful',
            created_at: d,
            created_by: 'odemir',
            finished_at: d,
          },
          {
            group_id: 'other',
            namespace: 'x',
            application: 'y',
            service: 'S',
            location: '/',
            job_id: null,
            status: null,
            created_at: null,
            created_by: null,
            finished_at: null,
          },
        ],
      };
    if (/FROM nginx_migration_tracking/.test(sql))
      return {
        rows: [
          satir({
            state: 'planned',
            planned_date: d,
            migrated_date: '2026-12-01T00:00:00',
            note: 'OCO-1',
            in_use: 1,
            in_use_by: 'ekip',
            in_use_at: d,
            config_job_id: '41',
            config_created_at: d,
            config_created_by: 'odemir',
            config_job_status: 'successful',
            config_job_finished_at: d,
            config_service: 'WEBFORMS',
            config_location: '/base/',
            delete_job_id: 52,
            delete_requested_at: d,
            delete_requested_by: 'yonetici',
          }),
          satir({ application: 'bos-app' }),
        ],
      };
    return undefined;
  };
  let r = await h.call('GET', T);
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(r.json.rows[0], {
    group: 'other',
    namespace: 'webforms-ch-prod',
    application: 'base-app-v0',
    state: 'planned',
    plannedDate: '2026-11-20',
    migratedDate: '2026-12-01',
    note: 'OCO-1',
    inUse: '1',
    inUseBy: 'ekip',
    inUseAt: d.toISOString(),
    configJobId: 41,
    configCreatedAt: d.toISOString(),
    configCreatedBy: 'odemir',
    configJobStatus: 'successful',
    configJobFinishedAt: d.toISOString(),
    configService: 'WEBFORMS',
    configLocation: '/base/',
    deleteJobId: 52,
    deleteRequestedAt: d.toISOString(),
    deleteRequestedBy: 'yonetici',
    ...pickRest(r.json.rows[0]),
  });
  assert.equal(r.json.rows[1].state, 'none');
  assert.equal(r.json.rows[1].plannedDate, null);
  assert.equal(r.json.rows[1].inUse, null);
  assert.equal(r.json.rows[1].configJobId, null);
  assert.deepEqual(r.json.pathJobs, [
    {
      group: 'other',
      namespace: 'webforms-ch-prod',
      application: 'base-app-v0',
      service: 'WEBFORMS',
      location: '/base/',
      jobId: 41,
      status: 'successful',
      createdAt: d.toISOString(),
      createdBy: 'odemir',
      finishedAt: d.toISOString(),
    },
    {
      group: 'other',
      namespace: 'x',
      application: 'y',
      service: 'S',
      location: '/',
      jobId: null,
      status: null,
      createdAt: null,
      createdBy: null,
      finishedAt: null,
    },
  ]);

  // yol bazli kayitlar okunamazsa liste yine gelir (pathJobs bos)
  h.dbYanit = (sql) => {
    if (/SELECT TOP 10 config_job_id/.test(sql)) return { rows: [] };
    if (/FROM nginx_migration_path_jobs/.test(sql)) throw new Error('tablo yok');
    if (/FROM nginx_migration_tracking/.test(sql)) return { rows: [satir()] };
    return undefined;
  };
  r = await h.call('GET', T);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.pathJobs, []);
  assert.equal(r.json.rows.length, 1);

  // takip tablosu okunamazsa 503 (bos liste uydurulmaz)
  h.dbYanit = (sql) => {
    if (/FROM nginx_migration_tracking\s*$/.test(sql.trim()) || /in_use_by, in_use_at,/.test(sql))
      throw new Error('DB yok');
    return { rows: [] };
  };
  r = await h.call('GET', T);
  assert.equal(r.status, 503);
  assert.equal(r.json.ok, false);
  assert.match(r.json.message, /DB yok/);
});

// rowToTracking'in yukarida ayrica sinanmayan alanlari (varsa) birebir esitlikte gurultu yapmasin
function pickRest(row) {
  const bilinen = new Set([
    'group',
    'namespace',
    'application',
    'state',
    'plannedDate',
    'migratedDate',
    'note',
    'inUse',
    'inUseBy',
    'inUseAt',
    'configJobId',
    'configCreatedAt',
    'configCreatedBy',
    'configJobStatus',
    'configJobFinishedAt',
    'configService',
    'configLocation',
    'deleteJobId',
    'deleteRequestedAt',
    'deleteRequestedBy',
  ]);
  return Object.fromEntries(Object.entries(row).filter(([k]) => !bilinen.has(k)));
}

test("NT2 uzlaştırma: canlı görünen işler AWX'e sorulur, durum takibe işlenir", async (t) => {
  h.awx.jobStatus = 'successful';
  h.dbYanit = (sql) => {
    if (/SELECT TOP 10 config_job_id/.test(sql)) return { rows: [{ job_id: String(h.JOB_ID) }] };
    if (/^\s*UPDATE nginx_migration_(path_jobs|tracking)/.test(sql))
      return { rows: [], rowCount: 1 };
    if (/FROM nginx_migration/.test(sql)) return { rows: [] };
    return undefined;
  };
  let r = await h.call('GET', T);
  assert.equal(r.status, 200, r.body);
  assert.ok(
    h.awx.istekler.some((q) => q.method === 'GET' && q.yol === `/api/v2/jobs/${h.JOB_ID}/`),
  );
  const up = yazimlar(/^\s*UPDATE nginx_migration_(path_jobs|tracking)/);
  assert.equal(up.length, 3);
  assert.ok(up.every((q) => q.params[0] === h.JOB_ID && q.params[1] === 'successful'));
  assert.match(up[0].sql, /finished_at = COALESCE\(finished_at, GETUTCDATE\(\)\)/);
  assert.match(up[1].sql, /config_job_finished_at = COALESCE/);
  // terminal olmayan durumda bitis zamani yazilmaz
  h.reset();
  h.awx.jobStatus = 'running';
  h.dbYanit = (sql) => {
    if (/SELECT TOP 10 config_job_id/.test(sql)) return { rows: [{ job_id: h.JOB_ID }] };
    if (/FROM nginx_migration/.test(sql) || /^\s*UPDATE/.test(sql)) return { rows: [] };
    return undefined;
  };
  r = await h.call('GET', T);
  const up2 = yazimlar(/^\s*UPDATE nginx_migration_(path_jobs|tracking)/);
  assert.equal(up2.length, 3);
  assert.ok(up2.every((q) => !/finished_at = COALESCE/.test(q.sql)));
  // uzlastirma sorgusu duserse liste yine gelir
  h.reset();
  const k = h.mockConsole(t);
  h.dbYanit = (sql) => {
    if (/SELECT TOP 10 config_job_id/.test(sql)) throw new Error('kilit');
    if (/FROM nginx_migration/.test(sql)) return { rows: [satir()] };
    return undefined;
  };
  r = await h.call('GET', T);
  assert.equal(r.status, 200);
  assert.equal(r.json.rows.length, 1);
  assert.ok(k.warn.some((w) => /uzlastirma atlandi: kilit/.test(w)));
});

test('NT3 tek kayıt: doğrulama, ekle / güncelle, normalleştirme, denetim, DB hatası', async () => {
  const yaz = (b) => h.call('PUT', T, b);
  for (const [b, mesaj] of [
    [{ ...TAKIP, application: '' }, 'group, namespace, application zorunlu.'],
    [{ ...TAKIP, state: 'bitti' }, 'Gecersiz durum: bitti'],
    [
      { ...TAKIP, state: 'planned', plannedDate: '20.12.2026' },
      'Tarih YYYY-AA-GG olmali: 20.12.2026',
    ],
    [{ ...TAKIP, state: 'migrated' }, '"Gecti" icin gecis tarihi zorunlu.'],
    [{ ...TAKIP, state: 'planned' }, '"Planlandi" icin planlanan tarih zorunlu.'],
  ]) {
    const r = await yaz(b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(r.json.message, mesaj);
  }
  assert.equal(yazimlar(/nginx_migration_tracking/).length, 0);

  // yeni kayit: INSERT, normallestirilmis degerler, denetim, guncel satir doner
  let mevcut = false;
  h.dbYanit = (sql, p) => {
    if (/SELECT id FROM nginx_migration_tracking/.test(sql))
      return { rows: mevcut ? [{ id: 1 }] : [] };
    if (/^\s*(INSERT|UPDATE)/.test(sql)) return { rows: [], rowCount: 1 };
    if (/FROM nginx_migration_tracking WHERE group_id/.test(sql))
      return {
        rows: [
          satir({
            state: 'planned',
            planned_date: '2026-12-10',
            note: 'not',
            namespace: p[1],
            application: p[2],
          }),
        ],
      };
    return undefined;
  };
  const uzun = 'x'.repeat(600);
  let r = await yaz({
    group: ' other ',
    namespace: ' WebForms-CH-Prod ',
    application: 'Base-App-V0',
    state: ' PLANNED ',
    plannedDate: '2026-12-10',
    note: ` ${uzun} `,
  });
  assert.equal(r.status, 200, r.body);
  const ins = yazimlar(/^\s*INSERT INTO nginx_migration_tracking/);
  assert.equal(ins.length, 1);
  assert.deepEqual(ins[0].params, [
    'other',
    'webforms-ch-prod',
    'base-app-v0',
    'planned',
    '2026-12-10',
    null,
    'x'.repeat(500),
    'odemir',
  ]);
  assert.equal(r.json.row.state, 'planned');
  assert.equal(r.json.row.plannedDate, '2026-12-10');
  const den = h.audits.find((a) => a.action === 'nginx_prod_migration_track');
  assert.equal(den.username, 'odemir');
  assert.equal(JSON.parse(den.detail).namespace, 'webforms-ch-prod');
  // var olan kayit: UPDATE; bos not null
  mevcut = true;
  r = await yaz({ ...TAKIP, state: 'migrated', migratedDate: '2026-12-11', note: '   ' });
  const upd = yazimlar(/^\s*UPDATE nginx_migration_tracking/);
  assert.equal(upd.length, 1);
  assert.deepEqual(upd[0].params, [
    'other',
    'webforms-ch-prod',
    'base-app-v0',
    'migrated',
    null,
    '2026-12-11',
    null,
    'odemir',
  ]);
  // satir okunamadiysa row null
  h.dbYanit = (sql) => {
    if (/SELECT id FROM/.test(sql)) return { rows: [] };
    if (/^\s*INSERT/.test(sql)) return { rows: [] };
    if (/WHERE group_id/.test(sql)) return { rows: [] };
    return undefined;
  };
  r = await yaz(TAKIP);
  assert.equal(r.json.row, null);
  // DB hatasi 503
  h.dbYanit = (sql) => {
    if (/nginx_migration_tracking/.test(sql)) throw new Error('baglanti koptu');
    return undefined;
  };
  r = await yaz(TAKIP);
  assert.equal(r.status, 503);
  assert.match(r.json.message, /baglanti koptu/);
});

test('NT4 toplu kayıt: boş / 200 üstü / tek geçersiz öğe hiçbirini yazmaz; kısmi yazım; liste okunamadı', async () => {
  const toplu = (b) => h.call('PUT', `${T}/bulk`, b);
  let r = await toplu({ items: [] });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'En az bir uygulama seçilmeli.');
  r = await toplu({});
  assert.equal(r.status, 400);
  r = await toplu({
    items: Array.from({ length: 201 }, (_, i) => ({ ...TAKIP, application: `a${i}` })),
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'Tek seferde en fazla 200 uygulama güncellenebilir (seçilen: 201).');
  // bir oge gecersiz: HICBIRI yazilmaz, mesaj ogeyi adlandirir
  r = await toplu({
    state: 'planned',
    plannedDate: '2026-12-10',
    items: [TAKIP, { group: 'other', namespace: 'ns-b', application: '' }],
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, '(uygulama?) · ns-b: group, namespace, application zorunlu.');
  r = await toplu({ state: 'migrated', items: [{ ...TAKIP }] });
  assert.equal(
    r.json.message,
    'base-app-v0 · webforms-ch-prod: "Gecti" icin gecis tarihi zorunlu.',
  );
  assert.equal(yazimlar(/nginx_migration_tracking/).length, 0);

  // kismi yazim: ikinci oge DB'de duser; ortak alanlar govdeden, oge kendi alanini ezer
  h.dbYanit = (sql, p) => {
    if (/SELECT id FROM nginx_migration_tracking/.test(sql))
      return { rows: p[2] === 'var-app' ? [{ id: 9 }] : [] };
    if (/^\s*(INSERT|UPDATE)/.test(sql)) {
      if (p[2] === 'kotu-app') throw new Error('kilit zaman asimi');
      return { rows: [] };
    }
    if (/FROM nginx_migration_tracking\s*$/.test(sql.trim()))
      return {
        rows: [
          satir({ application: 'yeni-app', state: 'planned', planned_date: '2026-12-10' }),
          satir({ application: 'var-app', state: 'planned', planned_date: '2026-12-10' }),
          satir({ application: 'kotu-app' }),
          satir({ application: 'baska' }),
        ],
      };
    return undefined;
  };
  r = await toplu({
    state: 'planned',
    plannedDate: '2026-12-10',
    note: 'toplu',
    items: [
      { ...TAKIP, application: 'yeni-app' },
      { ...TAKIP, application: 'kotu-app' },
      { ...TAKIP, application: 'var-app', note: 'kendi notu' },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.written, 2);
  assert.deepEqual(r.json.failed, [
    { namespace: 'webforms-ch-prod', application: 'kotu-app', message: 'kilit zaman asimi' },
  ]);
  assert.deepEqual(
    r.json.rows.map((x) => x.application),
    ['yeni-app', 'var-app'],
  );
  const ins = yazimlar(/^\s*INSERT INTO nginx_migration_tracking/);
  const upd = yazimlar(/^\s*UPDATE nginx_migration_tracking/);
  assert.deepEqual(
    ins.map((q) => q.params[2]),
    ['yeni-app', 'kotu-app'],
  );
  assert.deepEqual(
    upd.map((q) => [q.params[2], q.params[6]]),
    [['var-app', 'kendi notu']],
  );
  assert.equal(ins[0].params[6], 'toplu');
  const den = h.audits.find((a) => a.action === 'nginx_prod_migration_track_bulk');
  assert.equal(den.result, 'partial');
  assert.deepEqual(JSON.parse(den.detail), {
    count: 3,
    written: 2,
    failed: 1,
    state: 'planned',
    plannedDate: '2026-12-10',
    migratedDate: null,
    apps: ['webforms-ch-prod/yeni-app', 'webforms-ch-prod/var-app'],
  });

  // tam basari + son liste okunamazsa: kaydedildi ama liste yok
  h.reset();
  h.dbYanit = (sql) => {
    if (/SELECT id FROM/.test(sql)) return { rows: [] };
    if (/^\s*INSERT/.test(sql)) return { rows: [] };
    if (/FROM nginx_migration_tracking\s*$/.test(sql.trim())) throw new Error('okuma zaman asimi');
    return undefined;
  };
  r = await toplu({ state: 'none', items: [TAKIP] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, {
    ok: true,
    written: 1,
    failed: [],
    rows: [],
    message: 'Kaydedildi ama liste okunamadı: okuma zaman asimi',
  });
  assert.equal(h.audits.at(-1).result, 'ok');
});

test('NT5 yönetici ayarı: yalnız Admin, zorunlu alanlar, ekle / güncelle, DB hatası', async () => {
  const C = '/api/nginx-migration/config';
  let r = await h.call('GET', C);
  assert.deepEqual(r.json, {
    ok: true,
    config: { awxServerId: 1, templateId: h.CREATE_TPL, deleteTemplateId: h.DELETE_TPL },
  });
  r = await h.call('PUT', C, { awxServerId: 1, templateId: 10 });
  assert.equal(r.status, 403);
  h.sessionUser = h.USERS.admin;
  r = await h.call('PUT', C, { awxServerId: 0, templateId: 10 });
  assert.equal(r.status, 400);
  assert.equal(r.json.message, 'AWX sunucusu ve template ID zorunlu.');
  r = await h.call('PUT', C, { awxServerId: '2', templateId: 'abc' });
  assert.equal(r.status, 400);
  let var_ = false;
  h.dbYanit = (sql) => {
    if (/SELECT 1 FROM portal_config_blobs/.test(sql)) return { rows: var_ ? [{ 1: 1 }] : [] };
    if (/^\s*(INSERT|UPDATE) /.test(sql) && /portal_config_blobs/.test(sql)) return { rows: [] };
    return undefined;
  };
  r = await h.call('PUT', C, { awxServerId: '2', templateId: '30' });
  assert.deepEqual(r.json, {
    ok: true,
    config: { awxServerId: 2, templateId: 30, deleteTemplateId: 0 },
  });
  assert.equal(yazimlar(/INSERT INTO portal_config_blobs/).length, 1);
  var_ = true;
  r = await h.call('PUT', C, { awxServerId: 2, templateId: 30, deleteTemplateId: 31 });
  assert.equal(r.json.config.deleteTemplateId, 31);
  const up = yazimlar(/UPDATE portal_config_blobs/);
  assert.equal(up.length, 1);
  assert.deepEqual(JSON.parse(up[0].params[1]), {
    awxServerId: 2,
    templateId: 30,
    deleteTemplateId: 31,
  });
  h.dbYanit = (sql) => {
    if (/SELECT 1 FROM portal_config_blobs/.test(sql)) throw new Error('DB yok');
    return undefined;
  };
  r = await h.call('PUT', C, { awxServerId: 2, templateId: 30 });
  assert.equal(r.status, 503);
});

test('NT6 tarama tazeleme: AWX kaydı tanımlı değilse 501', async () => {
  const r = await h.call('POST', '/api/nginx-migration/rescan', { hosts: ['ornginxp44'] });
  assert.equal(r.status, 501);
  assert.match(r.json.message, /Playbook Kayıtları › "nginx_config_audit"/);
  assert.equal(h.launches().length, 0);
});
