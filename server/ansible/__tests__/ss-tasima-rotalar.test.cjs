// server/ansible/__tests__/ss-tasima-rotalar.test.cjs - Self Servis Tasima uclari (2026-11-10).
//
// Sahte app + sahte DB + sahte AWX ile davranis:
//   ST7  tasi: tek dbx.query'de BEGIN TRAN; kart UPDATE'i yalniz baglanti kolonlari + CAS;
//        kaynak ayar satirina DELETE/UPDATE yok; commit sonrasi hedef ayar ONBELLEGE yazilir
//        (yazilmazsa hedefte is Smart / OCO kapisi olmadan kosar), invalidate + kart tazeleme
//   ST8  hata eslemesi (51001 / engel / UNIQUE -> 409), planHash uyusmazligi 409, deneme sarti,
//        kisa gerekce 400
//   ST9  geri alma: kart bagi degismisse 409 (onayla da gecilmez); hedef ayar degismisse onay;
//        hedefte bekleyen Smart varsa 409; hedef ayar satiri SILINMEZ. Survey yazici yalniz hedefe.
//   ST10 her tasima ucu requireAuth + requireAdmin arkasinda; admin olmayan 403, handler cagrilmaz
//   ST19-ST24 dogrulayici turu 1: bayat hedef ayar silinir, kaynak DB kopyasi, survey-yaz hedef
//        bag / hash / ayni host / yarim yazim denetimi, Smart denemesi reddi, sunucu tarafi
//        cakisma, geri almada kaynak sunucu / kayit kapatma, kirli onbellek, istemci kaydi
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const T = require('../ss-tasima.cjs');
const { kaydet } = require('../ss-tasima-rotalari.cjs');

function sahteApp() {
  const rotalar = [];
  const app = {};
  for (const m of ['get', 'post', 'put', 'delete']) app[m] = (p, ...h) => rotalar.push({ m, p, h });
  return { app, rotalar };
}

function eslesir(desen, yol) {
  const a = desen.split('/');
  const b = yol.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function cagir(rotalar, m, url, { body = {}, user = { username: 'admin1', role: 'Admin' } } = {}) {
  const [yol, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  for (const r of rotalar) {
    if (r.m !== m) continue;
    const params = eslesir(r.p, yol);
    if (!params) continue;
    const req = { params, query, body, session: { user } };
    const res = {
      statusCode: 200,
      govde: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(g) {
        this.govde = g;
        return this;
      },
    };
    let i = 0;
    const next = async () => {
      const h = r.h[i++];
      if (h) await h(req, res, next);
    };
    await next();
    return res;
  }
  throw new Error(`rota yok: ${m} ${url}`);
}

const SPEC = [{ variable: 'env', type: 'text', required: true, default: 'dev', question_name: 'Ortam' }];

function ortam(ayar = {}) {
  const items = [
    { id: 'svc1', title: 'Servis Bir', description: '', awxServerId: 2, awxTemplateId: 20, enabled: true, order: 0, accessMode: 'herkes', accessGroups: [] },
  ];
  const custom = new Map([['2_20', { smartApproval: { enabled: true, flowKey: 'F', metadataFields: 'env: {{extraVars.env}}' } }]]);
  const dbCustom = new Map(); // tasima transaction'inin DB'ye yazdigi hedef satirlar (ham metin)
  const gocler = [];
  const sorgular = [];
  const cagrilar = [];
  const db = {
    query: async (sql, params = [], opts) => {
      sorgular.push({ sql, params, opts });
      if (ayar.dbHook) {
        const r = ayar.dbHook(sql, params);
        if (r) return r;
      }
      if (/^SELECT data FROM ansible_ss_customizations WHERE awx_server_id = \$1 AND template_id = \$2/.test(sql)) {
        const k = `${params[0]}_${params[1]}`;
        return { rows: custom.has(k) ? [{ data: JSON.stringify(custom.get(k)) }] : [] };
      }
      if (sql === T.TASIMA_SQL) {
        const [from, fromT, to, toT, itemId, kaynakVar, data] = params;
        if (ayar.tasimaHatasi) throw ayar.tasimaHatasi;
        // Transaction icindeki kaynak kilidi + karsilastirma (51004) ve hedef satirin kopya/silme kurali.
        const kk = `${from}_${fromT}`;
        if (kaynakVar === 1 && (!custom.has(kk) || JSON.stringify(custom.get(kk)) !== data))
          throw Object.assign(new Error('ss_tasima_kaynak_degisti'), { number: 51004 });
        if (kaynakVar === 0 && custom.has(kk)) throw Object.assign(new Error('ss_tasima_kaynak_degisti'), { number: 51004 });
        const it = items.find((i) => i.id === itemId && i.awxServerId === from && i.awxTemplateId === fromT);
        if (!it) throw Object.assign(new Error('ss_tasima_cas'), { number: 51001 });
        it.awxServerId = to;
        it.awxTemplateId = toT;
        if (kaynakVar === 1) {
          cagrilar.push(['dbCustom', `${to}_${toT}`, JSON.parse(data)]);
          dbCustom.set(`${to}_${toT}`, data);
        } else {
          cagrilar.push(['dbCustomSil', `${to}_${toT}`]);
          dbCustom.delete(`${to}_${toT}`);
        }
        const acik = gocler.find((g) => g.item_id === itemId && g.status === 'HAZIRLIK');
        if (acik) Object.assign(acik, { status: 'TASINDI', uygulanan_json: params[10], onceki_json: params[9] });
        else gocler.push({ id: gocler.length + 1, item_id: itemId, status: 'TASINDI', from_server: from, from_template: fromT, to_server: to, to_template: toT, eslesme: params[14], uygulanan_json: params[10], onceki_json: params[9], survey_yazildi: 0 });
        return { rows: [{ id: gocler.length }], rowCount: 1 };
      }
      if (sql === T.GERI_AL_SQL) {
        const [to, toT, from, fromT, itemId, mid] = params;
        const it = items.find((i) => i.id === itemId && i.awxServerId === to && i.awxTemplateId === toT);
        if (!it) throw Object.assign(new Error('ss_geri_al_cas'), { number: 51011 });
        it.awxServerId = from;
        it.awxTemplateId = fromT;
        gocler.find((g) => g.id === mid).status = 'GERI_ALINDI';
        return { rows: [], rowCount: 1 };
      }
      if (/FROM ansible_ss_migrations WHERE item_id = \$1 AND status IN/.test(sql)) {
        const r = gocler.filter((g) => g.item_id === params[0] && (g.status === 'HAZIRLIK' || g.status === 'TASINDI'));
        return { rows: r.slice(-1) };
      }
      if (/FROM ansible_ss_migrations ORDER BY id DESC/.test(sql)) return { rows: gocler.slice().reverse() };
      if (/INSERT INTO ansible_ss_migrations/.test(sql)) {
        gocler.push({ id: gocler.length + 1, item_id: params[0], from_server: params[1], from_template: params[2], to_server: params[4], to_template: params[5], status: 'HAZIRLIK', eslesme: params[7], survey_yazildi: 0 });
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT TOP 20 \* FROM ansible_ss_migrations WHERE item_id = \$1/.test(sql)) {
        return { rows: gocler.filter((g) => g.item_id === params[0]).slice().reverse() };
      }
      if (/WHERE status = 'HAZIRLIK' AND item_id <> \$1/.test(sql)) {
        return { rows: gocler.filter((g) => g.status === 'HAZIRLIK' && g.item_id !== params[0]) };
      }
      if (/UPDATE ansible_ss_migrations\s+SET from_server = \$1/.test(sql)) {
        const g = gocler.find((x) => x.id === params[7] && x.status === 'HAZIRLIK');
        if (!g) return { rows: [], rowCount: 0 };
        Object.assign(g, { from_server: params[0], from_template: params[1], to_server: params[3], to_template: params[4], eslesme: params[6], deneme_job_id: null, deneme_kaynak_hash: null, deneme_hedef_survey_hash: null, survey_yazildi: 0 });
        return { rows: [], rowCount: 1 };
      }
      if (/SET status = 'KAPANDI'/.test(sql)) {
        const g = gocler.find((x) => x.id === params[2] && x.item_id === params[3] && x.status === 'TASINDI');
        if (!g) return { rows: [], rowCount: 0 };
        g.status = 'KAPANDI';
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE ansible_ss_migrations\s+SET deneme_job_id/.test(sql)) {
        const g = gocler.find((x) => x.id === params[3]);
        Object.assign(g, { deneme_job_id: params[0], deneme_kaynak_hash: params[1], deneme_hedef_survey_hash: params[2] });
        return { rows: [], rowCount: 1 };
      }
      if (/smart_tickets/.test(sql)) return { rows: [{ n: (ayar.smart && ayar.smart(params)) || 0 }] };
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
      return { rows: [], rowCount: 0 };
    },
  };
  const awx = {
    '2:20': { detail: { id: 20, name: 'Servis Sablonu', survey_enabled: true, playbook: 'a.yml', ask_variables_on_launch: true }, spec: SPEC },
    '3:30': { detail: { id: 30, name: 'Servis Sablonu', survey_enabled: true, playbook: 'a.yml', ask_variables_on_launch: true }, spec: SPEC },
  };
  const deps = {
    requireAuth: (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ ok: false })),
    requireAdmin: (req, res, next) => (req.session.user.role === 'Admin' ? next() : res.status(403).json({ ok: false })),
    dbx: db,
    getServerById: (n) =>
      ({
        2: { id: 2, name: 'maestro2', url: 'https://maestro2.local' },
        3: { id: 3, name: 'maestro3', url: 'https://maestro3.local' },
        4: { id: 4, name: 'maestro2-takma', url: 'https://MAESTRO2.local/' },
        ...(ayar.sunucular || {}),
      })[Number(n)] || null,
    readSsItems: () => items.map((i) => ({ ...i })),
    reloadSsItemsCache: async () => cagrilar.push(['reloadItems']),
    reloadSsCustomCache: async () => cagrilar.push(['reloadCustom']),
    readCustom: (s, t) => custom.get(`${s}_${t}`) || {},
    writeCustom: async (s, t, data, o) => {
      cagrilar.push(['writeCustom', `${s}_${t}`, o && o.reason]);
      custom.set(`${s}_${t}`, data);
    },
    setCustomCache: (s, t, data) => {
      cagrilar.push(['setCustomCache', `${s}_${t}`]);
      if (ayar.onbellekYazma) return;
      if (data && Object.keys(data).length) custom.set(`${s}_${t}`, data);
      else custom.delete(`${s}_${t}`);
    },
    ssItemsKirliIsaretle: () => cagrilar.push(['kirli']),
    smartGerekliMi: (sa) => !!(sa && sa.enabled) && !ayar.smartGereksiz,
    adminSmartAtliyor: async () => !!ayar.smartAtla,
    invalidate: () => cagrilar.push(['invalidate']),
    listTemplatesForServer: async (s) => (s.id === 2 ? [{ id: 20, name: 'Servis Sablonu' }] : [{ id: 30, name: 'Servis Sablonu' }]),
    getTemplateDetailOnServer: async (s, t) => {
      cagrilar.push(['awxGET', `${s}:${t}`]);
      const x = awx[`${s}:${t}`];
      if (!x) throw Object.assign(new Error('yok'), { status: 404 });
      return x.detail;
    },
    getSurveySpecOnServer: async (s, t) => ({ spec: (awx[`${s}:${t}`] || {}).spec || [] }),
    writeSurveySpecOnServer: async (s, t) => {
      cagrilar.push(['surveyYaz', s, t]);
      return { ok: true, hash: 'h', fark: null };
    },
    setSurveyEnabledOnServer: async (s, t) => {
      cagrilar.push(['surveyKapat', s, t]);
      return { ok: true, hash: 'h' };
    },
    getJobOnServer: async (s, id) => ({ id, status: 'successful', jobTemplate: 30 }),
    listTemplateSchedulesOnServer: async () => [],
    resolveSsLaunchPlan: async (server, toT) => ({
      extraVars: { env: 'dev' },
      resolvedLaunchOptions: {},
      overrides: custom.get(`${server.id}_${toT}`) || {},
      gateVars: {},
    }),
    ssTestKosusuBaslat: async (req, server, toT) => {
      cagrilar.push(['testRun', server.id, toT]);
      return { status: 200, body: { ok: true, jobId: 555 } };
    },
    sonTarihli: (is) => is,
    audit: (req, action) => cagrilar.push(['audit', action]),
    longJobConfig: async () => ({ templates: [] }),
    env: {},
  };
  const { app, rotalar } = sahteApp();
  kaydet(app, deps);
  return { rotalar, items, custom, dbCustom, gocler, sorgular, cagrilar, awx, deps };
}

async function hazirla(o) {
  const plan = await cagir(o.rotalar, 'get', '/api/ansible/ss/tasima/plan?from=2&to=3');
  assert.equal(plan.statusCode, 200, JSON.stringify(plan.govde));
  return plan.govde.satirlar.find((s) => s.itemId === 'svc1');
}

test('ST7 tasi: tek transaction, yalniz baglanti kolonlari, onbellek yazilir', async () => {
  const o = ortam({ smartAtla: true });
  const s = await hazirla(o);
  assert.equal(s.durum, 'HAZIR', JSON.stringify(s));
  assert.equal(s.eslesme, 'ad');
  assert.equal(s.hedefTemplate.id, 30);
  // Deneme kosusu (gercek) -> kayit
  const d = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/deneme', { body: { to: 3, toT: 30, sadeceDogrula: false, confirm: true, extraVars: {} } });
  assert.equal(d.statusCode, 200, JSON.stringify(d.govde));
  assert.equal(d.govde.jobId, 555);
  assert.deepEqual(o.cagrilar.find((c) => c[0] === 'writeCustom'), ['writeCustom', '3_30', 'migrate:stage:2_20'], 'ayar hedefe sahnelenmedi');
  const s2 = await hazirla(o);
  assert.equal(s2.deneme && s2.deneme.gecerli, true, JSON.stringify(s2.deneme));
  o.cagrilar.length = 0;
  o.sorgular.length = 0;
  const r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/tasi', { body: { to: 3, toT: 30, planHash: s2.planHash } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  const tx = o.sorgular.filter((q) => /BEGIN TRAN/.test(q.sql));
  assert.equal(tx.length, 1, 'tasima tek transaction degil');
  assert.equal(tx[0].opts && tx[0].opts.tekrar, false, 'transaction yeniden denenebilir');
  const sql = tx[0].sql;
  const kartUpd = sql.match(/UPDATE ansible_ss_items\s+SET ([^\n]+)\n\s+WHERE ([^;]+);/);
  assert.ok(kartUpd, 'kart UPDATE yok');
  assert.equal(kartUpd[1].trim(), 'awx_server_id = $3, awx_template_id = $4, updated_at = GETUTCDATE()');
  assert.match(kartUpd[2], /id = \$5 AND awx_server_id = \$1 AND awx_template_id = \$2/, 'CAS yok');
  // Tek DELETE: hedef ayar satiri (kaynakta ayar yoksa). Kart / kaynak satir / kayit silinmez.
  for (const d of sql.match(/DELETE[^;]*;/gi) || []) assert.equal(d, 'DELETE FROM ansible_ss_customizations WHERE awx_server_id = $3 AND template_id = $4;');
  const ayarUpd = sql.match(/UPDATE ansible_ss_customizations SET[^;]*;/g) || [];
  assert.equal(ayarUpd.length, 1);
  for (const u of ayarUpd) assert.match(u, /WHERE awx_server_id = \$3 AND template_id = \$4;$/, 'kaynak ayar satiri guncelleniyor');
  for (const sorgu of o.sorgular) assert.doesNotMatch(sorgu.sql, /DELETE FROM ansible_ss_items/);
  const sira = o.cagrilar.map((c) => c[0]);
  assert.ok(sira.includes('setCustomCache') && sira.includes('invalidate') && sira.includes('reloadItems'));
  assert.ok(sira.indexOf('setCustomCache') < sira.indexOf('reloadItems'));
  assert.deepEqual(o.deps.readCustom(3, 30), o.deps.readCustom(2, 20), 'hedef onbellek kaynak veriyle esit degil');
  assert.equal(o.items[0].awxServerId, 3);
  assert.equal(o.items[0].enabled, true, 'enabled degisti');
  assert.equal(o.items[0].accessMode, 'herkes');
  assert.ok(o.cagrilar.some((c) => c[0] === 'audit' && c[1] === 'ss_migration_apply'));
  // Plan artik TASINDI gosterir
  const s3 = await hazirla(o);
  assert.equal(s3.durum, 'TASINDI');
});

test('ST7b onbellek yazilmazsa bekci kirmiziya doner (mutasyon)', async () => {
  const o = ortam({ onbellekYazma: true });
  // Hedefte onceden ayar yok; tasima sonrasi onbellek kaynak veriyi tasimali.
  const s = await hazirla(o);
  const r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/tasi', { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  assert.notDeepEqual(o.deps.readCustom(3, 30), o.deps.readCustom(2, 20), 'mutasyon yakalanmadi');
});

test('ST8 hata eslemesi, planHash, deneme sarti, gerekce', async () => {
  for (const [err, re] of [
    [Object.assign(new Error('ss_tasima_cas'), { number: 51001 }), /Kart siz bakarken/],
    [Object.assign(new Error('ss_tasima_engel_smart'), { number: 51002 }), /Smart/],
    [Object.assign(new Error('ss_tasima_engel_oco'), { number: 51003 }), /OCO/],
    [Object.assign(new Error("Cannot insert duplicate key row ... 'UX_ss_migrations_acik'"), { number: 2601 }), /başka bir taşıma açık/],
    [Object.assign(new Error('Violation of UNIQUE KEY constraint'), { number: 2627 }), /başka bir servise bağlandı/],
  ]) {
    const o = ortam({ tasimaHatasi: err });
    const s = await hazirla(o);
    const r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/tasi', { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'en az on karakter' } });
    assert.equal(r.statusCode, 409, err.message);
    assert.match(r.govde.message, re);
  }
  const o = ortam({ smartAtla: true });
  const s = await hazirla(o);
  let r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/tasi', { body: { to: 3, toT: 30, planHash: 'eski' } });
  assert.equal(r.statusCode, 409);
  assert.match(r.govde.message, /siz bakarken/);
  r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/tasi', { body: { to: 3, toT: 30, planHash: s.planHash } });
  assert.equal(r.statusCode, 409, 'deneme ve gerekce yokken tasindi');
  assert.match(r.govde.message, /deneme/i);
  r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/tasi', { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'kisa' } });
  assert.equal(r.statusCode, 400);
  // Deneme sonrasi kaynak ayari degisirse deneme gecersiz
  await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/deneme', { body: { to: 3, toT: 30, sadeceDogrula: false, confirm: true } });
  o.custom.set('2_20', { smartApproval: { enabled: true, flowKey: 'G', metadataFields: '' } });
  const s2 = await hazirla(o);
  assert.equal(s2.deneme.gecerli, false);
  assert.match(s2.deneme.neden, /kaynak ayarları değişti/);
  // Bekleyen Smart bileti -> ENGEL, tasima reddedilir
  const o2 = ortam({ smart: (p) => (p[0] === 2 && p[1] === 20 ? 1 : 0) });
  const s3 = await hazirla(o2);
  assert.equal(s3.durum, 'ENGEL');
  r = await cagir(o2.rotalar, 'post', '/api/ansible/ss/tasima/svc1/tasi', { body: { to: 3, toT: 30, planHash: s3.planHash, denemesizGerekce: 'en az on karakter' } });
  assert.equal(r.statusCode, 409);
});

test('ST8b ayni sunucu ve okunamayan engel sorgusu', async () => {
  const o = ortam({ dbHook: (sql) => (/oco_scheduled_launches/.test(sql) && /COUNT/.test(sql) ? (() => { throw new Error('tablo yok'); })() : null) });
  const r = await cagir(o.rotalar, 'get', '/api/ansible/ss/tasima/plan?from=2&to=2');
  assert.equal(r.statusCode, 400);
  const s = await hazirla(o);
  assert.equal(s.durum, 'ENGEL', 'okunamayan sorgu sifir sayildi');
  assert.ok(s.okunamayan.some((x) => x.anahtar === 'oco'));
});

test('ST9 geri alma: bag, onay, engel; hedef ayar silinmez; survey yalniz hedefe', async () => {
  const o = ortam();
  const s = await hazirla(o);
  await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/tasi', { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  const kayit = o.gocler.find((g) => g.status === 'TASINDI');
  // Hedef ayar degisti -> onay gerekli
  o.custom.set('3_30', { smartApproval: { enabled: false } });
  let r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/geri-al', { body: { migrationId: kayit.id } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.govde.onayGerekli, true);
  // Kart baska yere baglandi -> onayla da gecilmez
  o.items[0].awxTemplateId = 31;
  r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/geri-al', { body: { migrationId: kayit.id, degisiklikleriOnayla: true } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.govde.bagUygun, false);
  o.items[0].awxTemplateId = 30;
  // Hedefte bekleyen Smart -> 409
  const o2smart = { n: 1 };
  o.deps.dbx.query = ((asil) => async (sql, p, x) => (/^SELECT COUNT\(\*\) AS n FROM smart_tickets/.test(sql) && p[0] === 3 ? { rows: [{ n: o2smart.n }] } : asil(sql, p, x)))(o.deps.dbx.query);
  r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/geri-al', { body: { migrationId: kayit.id, degisiklikleriOnayla: true } });
  assert.equal(r.statusCode, 409);
  o2smart.n = 0;
  o.sorgular.length = 0;
  r = await cagir(o.rotalar, 'post', '/api/ansible/ss/tasima/svc1/geri-al', { body: { migrationId: kayit.id, degisiklikleriOnayla: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  assert.equal(o.items[0].awxServerId, 2);
  assert.equal(o.items[0].awxTemplateId, 20);
  assert.equal(kayit.status, 'GERI_ALINDI');
  assert.ok(o.custom.has('3_30'), 'hedef ayar satiri silindi');
  for (const q of o.sorgular) assert.doesNotMatch(q.sql, /DELETE FROM ansible_ss_customizations/);
  assert.match(T.GERI_AL_SQL, /WHERE id = \$5 AND awx_server_id = \$1 AND awx_template_id = \$2/);

  // Survey yazici yalniz hedef sunucuya
  const o3 = ortam();
  o3.awx['3:30'].spec = [];
  const plan = await hazirla(o3);
  assert.equal(plan.durum, 'SURVEY_BOS');
  r = await cagir(o3.rotalar, 'post', '/api/ansible/ss/tasima/svc1/survey-yaz', { body: { to: 3, toT: 30, onay: true, beklenenHedefHash: plan.hedefSurveyHash } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  const yazilar = o3.cagrilar.filter((c) => c[0] === 'surveyYaz' || c[0] === 'surveyKapat');
  assert.deepEqual(yazilar, [['surveyYaz', 3, 30]]);
  r = await cagir(o3.rotalar, 'post', '/api/ansible/ss/tasima/svc1/survey-yaz', { body: { to: 3, toT: 30, beklenenHedefHash: plan.hedefSurveyHash } });
  assert.equal(r.statusCode, 400, 'onaysiz yazildi');
});

test('ST10 tum tasima uclari Admin; admin olmayan 403 ve handler cagrilmaz', async () => {
  const o = ortam();
  const yollar = o.rotalar.map((r) => r.p);
  assert.equal(yollar.length, 9);
  for (const r of o.rotalar) {
    assert.ok(r.p.startsWith('/api/ansible/ss/tasima/'), r.p);
    assert.equal(r.h[0], o.deps.requireAuth, `${r.p} requireAuth ilk degil`);
    assert.equal(r.h[1], o.deps.requireAdmin, `${r.p} requireAdmin ikinci degil`);
    const url = r.p.replace(':itemId', 'svc1') + (r.p.endsWith('/plan') ? '?from=2&to=3' : '');
    const res = await cagir([r], r.m, url, { body: { to: 3, toT: 30, onay: true, confirm: true }, user: { username: 'u', role: 'User' } });
    assert.equal(res.statusCode, 403, `${r.m} ${r.p}`);
  }
  assert.equal(o.sorgular.length, 0, 'admin olmayan istekte DB sorgulandi');
  const src = fs.readFileSync(path.join(__dirname, '..', 'ss-tasima-rotalari.cjs'), 'utf8');
  const kayitlar = [...src.matchAll(/app\.(get|post|put|delete)\(([^\n]+)/g)].map((m) => m[2]);
  assert.equal(kayitlar.length, 9);
  for (const k of kayitlar) assert.match(k, /^`\$\{BASE\}[^`]*`, requireAuth, requireAdmin, async/, k);
  const runner = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
  assert.match(runner, /require\('\.\/ss-tasima-rotalari\.cjs'\)\.kaydet\(app, \{\s*requireAuth,\s*requireAdmin,/);
});

// ---------------------------------------------------------------------------
// Dogrulayici turu 1 (2026-11-10) duzeltmelerinin davranis testleri
// ---------------------------------------------------------------------------
const P = '/api/ansible/ss/tasima/svc1';

test('ST19 kaynakta ayar yoksa hedefteki bayat ayar tasimada silinir; plan uyarir, hash hedef icerigini izler', async () => {
  const o = ortam();
  o.custom.delete('2_20');
  o.custom.set('3_30', { rawExtraVars: 'danger: 1' });
  const s = await hazirla(o);
  assert.equal(s.durum, 'HAZIR', JSON.stringify(s));
  assert.ok(s.uyarilar.some((u) => /ayar satırı var ama kaynakta yok; taşımada silinir/.test(u)), 'bayat hedef ayar uyarisi yok');
  // Plan ile tasi arasinda hedef ayar degisirse planHash tutmaz
  o.custom.set('3_30', { rawExtraVars: 'danger: 2' });
  let r = await cagir(o.rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  assert.equal(r.statusCode, 409, 'hedef ayar degisimi planHash ile yakalanmadi');
  const s2 = await hazirla(o);
  r = await cagir(o.rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: s2.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  assert.ok(o.cagrilar.some((c) => c[0] === 'dbCustomSil' && c[1] === '3_30'), 'hedef satir DB tarafinda silinmedi');
  assert.equal(o.custom.has('3_30'), false, 'hedef onbellek bayat ayari tutuyor');
  assert.deepEqual(o.deps.readCustom(3, 30), {});
});

test('ST19b kaynak ayar plan ile tasi arasinda degisirse 409 (onbellekten eski kopya yazilmaz)', async () => {
  const o = ortam();
  const s = await hazirla(o);
  // Onbellek eski kalir, DB satiri degisir (baska surec /ss/custom kaydetti)
  const eski = o.custom.get('2_20');
  o.deps.dbx.query = ((asil) => async (sql, p, x) =>
    /^SELECT data FROM ansible_ss_customizations/.test(sql) ? { rows: [{ data: JSON.stringify({ ...eski, rawExtraVars: 'yeni: 1' }) }] } : asil(sql, p, x))(o.deps.dbx.query);
  o.sorgular.length = 0;
  const r = await cagir(o.rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  assert.equal(r.statusCode, 409);
  assert.match(r.govde.message, /Kaynak ayarları siz bakarken/);
  assert.equal(o.items[0].awxServerId, 2, 'kart tasindi');
  // Ilk savunma transaction'dan ONCE: eski kopya DB'ye hic gonderilmez.
  assert.equal(o.sorgular.filter((q) => /BEGIN TRAN/.test(q.sql)).length, 0, 'degisen kaynak transactiona kadar gitti');
});

test('ST20 survey-yaz: hedef baska karta / Playbook Kayitlarina bagli, izin listesi disi -> 409, AWX yazimi yok', async () => {
  for (const [ad, ayar, hazirlik] of [
    ['baska kart', {}, (o) => o.items.push({ id: 'svc2', title: 'Canli', awxServerId: 3, awxTemplateId: 30, enabled: true })],
    ['playbook kaydi', { dbHook: (sql) => (/ansible_playbook_registry/.test(sql) ? { rows: [{ key_name: 'opsx.was' }] } : null) }, () => {}],
    ['izin listesi', {}, (o) => (o.deps.env.AWX_READ_ONLY_TEMPLATE_IDS = '20,31')],
  ]) {
    const o = ortam(ayar);
    o.awx['3:30'].spec = [];
    hazirlik(o);
    // Gecerli hash ile: 409'u hash uyusmazligi degil hedef bag kontrolu vermeli.
    const s = await hazirla(o);
    assert.ok(s.hedefSurveyHash, `${ad}: plan hash yok`);
    const r = await cagir(o.rotalar, 'post', `${P}/survey-yaz`, { body: { to: 3, toT: 30, onay: true, beklenenHedefHash: s.hedefSurveyHash } });
    assert.equal(r.statusCode, 409, `${ad}: ${JSON.stringify(r.govde)}`);
    assert.match(r.govde.message, /yazılamaz/, `${ad}: ${r.govde.message}`);
    assert.equal(o.cagrilar.filter((c) => c[0] === 'surveyYaz' || c[0] === 'surveyKapat').length, 0, `${ad}: AWX'e yazildi`);
  }
});

test('ST20b survey-yaz: hash zorunlu ve esit olmali; ayni host 400; yarim yazim denetime "hata" olarak duser', async () => {
  const o = ortam();
  o.awx['3:30'].spec = [];
  const s = await hazirla(o);
  let r = await cagir(o.rotalar, 'post', `${P}/survey-yaz`, { body: { to: 3, toT: 30, onay: true } });
  assert.equal(r.statusCode, 400, 'hash olmadan yazildi');
  r = await cagir(o.rotalar, 'post', `${P}/survey-yaz`, { body: { to: 3, toT: 30, onay: true, beklenenHedefHash: 'eski' } });
  assert.equal(r.statusCode, 409, 'hash uyusmazligi yakalanmadi');
  r = await cagir(o.rotalar, 'post', `${P}/survey-yaz`, { body: { to: 4, toT: 30, onay: true, beklenenHedefHash: s.hedefSurveyHash } });
  assert.equal(r.statusCode, 400, 'ayni host (takma ad kaydi) hedef sayildi');
  assert.equal(o.cagrilar.filter((c) => c[0] === 'surveyYaz').length, 0);
  // Yarim yazim: yazici firlatir -> denetim yine yazilir (sonuc hata)
  const denetimler = [];
  const o2 = ortam();
  o2.awx['3:30'].spec = [];
  o2.deps.writeSurveySpecOnServer = async () => {
    throw Object.assign(new Error('PATCH 500'), { status: 500 });
  };
  const { app, rotalar } = sahteApp();
  kaydet(app, { ...o2.deps, audit: (req, action, x) => denetimler.push([action, JSON.parse(x.detail)]) });
  const s2 = (await cagir(rotalar, 'get', '/api/ansible/ss/tasima/plan?from=2&to=3')).govde.satirlar[0];
  r = await cagir(rotalar, 'post', `${P}/survey-yaz`, { body: { to: 3, toT: 30, onay: true, beklenenHedefHash: s2.hedefSurveyHash } });
  assert.ok(r.statusCode >= 500, JSON.stringify(r.govde));
  const d = denetimler.find((x) => x[0] === 'ss_migration_survey_write');
  assert.ok(d, 'yarim yazim denetime dusmedi');
  assert.equal(d[1].sonuc, 'hata');
  // Basarili yazim da denetlenir
  r = await cagir(o.rotalar, 'post', `${P}/survey-yaz`, { body: { to: 3, toT: 30, onay: true, beklenenHedefHash: s.hedefSurveyHash } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  assert.ok(o.cagrilar.some((c) => c[0] === 'audit' && c[1] === 'ss_migration_survey_write'));
});

test('ST21 deneme: hedefte kosar, confirm sart, Smart gerekiyorsa ve atlanmiyorsa bilet acmadan 409', async () => {
  let o = ortam();
  let r = await cagir(o.rotalar, 'post', `${P}/deneme`, { body: { to: 3, toT: 30, sadeceDogrula: false, extraVars: {} } });
  assert.equal(r.statusCode, 400, 'confirm olmadan gercek is');
  r = await cagir(o.rotalar, 'post', `${P}/deneme`, { body: { to: 3, toT: 30, sadeceDogrula: false, confirm: true, extraVars: {} } });
  assert.equal(r.statusCode, 409, 'Smart gerektiren deneme reddedilmedi');
  assert.equal(r.govde.smartGerekli, true);
  assert.equal(o.cagrilar.filter((c) => c[0] === 'testRun').length, 0, 'Smart talebi acilabilirdi');
  o = ortam({ smartAtla: true });
  r = await cagir(o.rotalar, 'post', `${P}/deneme`, { body: { to: 3, toT: 30, sadeceDogrula: false, confirm: true, extraVars: {} } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  assert.deepEqual(o.cagrilar.find((c) => c[0] === 'testRun'), ['testRun', 3, 30], 'deneme kaynakta kostu');
  // Hedef baska karta bagli: sahneleme de yapilmaz
  o = ortam({ smartAtla: true });
  o.items.push({ id: 'svc2', title: 'Canli', awxServerId: 3, awxTemplateId: 30, enabled: true });
  r = await cagir(o.rotalar, 'post', `${P}/deneme`, { body: { to: 3, toT: 30, sadeceDogrula: true, extraVars: {} } });
  assert.equal(r.statusCode, 409);
  assert.equal(o.cagrilar.filter((c) => c[0] === 'writeCustom').length, 0, 'baska servisin ayar satiri ezildi');
});

test('ST21b deneme gecerliligi: is baska template -> gecersiz; hedef degisince deneme izi sifirlanir', async () => {
  const o = ortam({ smartAtla: true });
  o.awx['3:31'] = { detail: { id: 31, name: 'Baska', survey_enabled: true, playbook: 'a.yml', ask_variables_on_launch: true }, spec: SPEC };
  await cagir(o.rotalar, 'post', `${P}/deneme`, { body: { to: 3, toT: 30, sadeceDogrula: false, confirm: true, extraVars: {} } });
  o.deps.getJobOnServer = async (s, id) => ({ id, status: 'successful', jobTemplate: 99 });
  const { app, rotalar } = sahteApp();
  kaydet(app, o.deps);
  let s = (await cagir(rotalar, 'get', '/api/ansible/ss/tasima/plan?from=2&to=3')).govde.satirlar[0];
  assert.equal(s.deneme.gecerli, false, 'baska template isi gecerli deneme sayildi');
  // Hedef degisti -> deneme izi silinir
  const r = await cagir(o.rotalar, 'post', `${P}/hedef`, { body: { to: 3, toT: 31 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  const g = o.gocler.find((x) => x.status === 'HAZIRLIK');
  assert.equal(g.deneme_job_id, null, 'hedef degisince deneme izi kaldi');
  assert.equal(g.to_template, 31);
});

test('ST22 cakisma sunucu tarafinda: baska servisin HAZIRLIK kaydi ya da ayni kaynak adi -> tasi 409', async () => {
  // Kayit tabanli
  let o = ortam();
  const s = await hazirla(o);
  o.items.push({ id: 'svc2', title: 'Iki', awxServerId: 2, awxTemplateId: 21, enabled: true });
  o.gocler.push({ id: 90, item_id: 'svc2', status: 'HAZIRLIK', from_server: 2, from_template: 21, to_server: 3, to_template: 30, eslesme: 'elle' });
  let r = await cagir(o.rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  assert.equal(r.statusCode, 409, JSON.stringify(r.govde));
  assert.ok((r.govde.engeller || []).some((e) => e.anahtar === 'hedef_cakisiyor'));
  // Ad tabanli: ayni kaynak sunucuda ayni adli ikinci template'e bagli kart
  o = ortam();
  o.items.push({ id: 'svc2', title: 'Iki', awxServerId: 2, awxTemplateId: 21, enabled: true });
  o.deps.listTemplatesForServer = async (sv) => (sv.id === 2 ? [{ id: 20, name: 'Servis Sablonu' }, { id: 21, name: 'Servis Sablonu' }] : [{ id: 30, name: 'Servis Sablonu' }]);
  const { app, rotalar } = sahteApp();
  kaydet(app, o.deps);
  const plan = (await cagir(rotalar, 'get', '/api/ansible/ss/tasima/plan?from=2&to=3')).govde;
  const s1 = plan.satirlar.find((x) => x.itemId === 'svc1');
  assert.equal(s1.durum, 'ENGEL');
  r = await cagir(rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: s1.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  assert.equal(r.statusCode, 409, 'API ile cakisan satir tasindi');
  assert.equal(o.items[0].awxServerId, 2);
});

test('ST23 geri alma: kaynak sunucu yoksa 409; kart baska baga donmusse yalniz kayit kapatilir', async () => {
  let o = ortam({ sunucular: {} });
  let s = await hazirla(o);
  await cagir(o.rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  let kayit = o.gocler.find((g) => g.status === 'TASINDI');
  // maestro2 Portal'dan kaldirildi
  const asilSunucu = o.deps.getServerById;
  o.deps.getServerById = (n) => (Number(n) === 2 ? null : asilSunucu(n));
  let k2 = sahteApp();
  kaydet(k2.app, o.deps);
  let r = await cagir(k2.rotalar, 'post', `${P}/geri-al`, { body: { migrationId: kayit.id, degisiklikleriOnayla: true } });
  assert.equal(r.statusCode, 409, 'olu sunucuya geri alindi');
  assert.ok((r.govde.engeller || []).some((e) => e.anahtar === 'kaynak_sunucu_yok'));
  assert.equal(o.items[0].awxServerId, 3);
  // Salt-okunur plan: kaynak devre disiyken TASINDI satiri gorunur
  const p = await cagir(k2.rotalar, 'get', '/api/ansible/ss/tasima/plan?from=2&to=3');
  assert.equal(p.statusCode, 200, JSON.stringify(p.govde));
  assert.equal(p.govde.saltOkunur, true);
  assert.equal(p.govde.satirlar[0].durum, 'TASINDI');
  // Kaynak template okunamiyor -> 409
  o = ortam();
  s = await hazirla(o);
  await cagir(o.rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  kayit = o.gocler.find((g) => g.status === 'TASINDI');
  delete o.awx['2:20'];
  r = await cagir(o.rotalar, 'post', `${P}/geri-al`, { body: { migrationId: kayit.id, degisiklikleriOnayla: true } });
  assert.equal(r.statusCode, 409, 'kaynak template okunamadan geri alindi');
  o.awx['2:20'] = { detail: { id: 20, name: 'Servis Sablonu', survey_enabled: true }, spec: SPEC };
  // Kart elle kaynaga dondu: geri al 409, kaydiKapat ile KAPANDI, kart degismez
  o.items[0].awxServerId = 2;
  o.items[0].awxTemplateId = 20;
  const plan = await hazirla(o);
  assert.ok(plan.engeller.some((e) => e.anahtar === 'tutarsiz_kayit'), 'tutarsiz kayit gorunmuyor');
  r = await cagir(o.rotalar, 'post', `${P}/geri-al`, { body: { migrationId: kayit.id } });
  assert.equal(r.statusCode, 409);
  r = await cagir(o.rotalar, 'post', `${P}/geri-al`, { body: { migrationId: kayit.id, kaydiKapat: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  assert.equal(kayit.status, 'KAPANDI');
  assert.deepEqual([o.items[0].awxServerId, o.items[0].awxTemplateId], [2, 20]);
  assert.ok(o.cagrilar.some((c) => c[0] === 'audit' && c[1] === 'ss_migration_record_close'));
  // Artik yeniden hazirlanabilir
  r = await cagir(o.rotalar, 'post', `${P}/hedef`, { body: { to: 3, toT: 30 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
});

test('ST24 denetim kayitlari, onbellek kirli isareti, hazirlik yarisi, istemciye ayar JSON gitmez', async () => {
  const o = ortam();
  const s = await hazirla(o);
  // Commit sonrasi kart tazelenemezse liste yazimi kilitlenir
  o.deps.reloadSsItemsCache = async () => {
    throw new Error('db koptu');
  };
  const k = sahteApp();
  kaydet(k.app, o.deps);
  let r = await cagir(k.rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: s.planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  assert.ok(o.cagrilar.some((c) => c[0] === 'kirli'), 'tazeleme dustu ama liste yazimi kilitlenmedi');
  const kayit = o.gocler.find((g) => g.status === 'TASINDI');
  r = await cagir(k.rotalar, 'post', `${P}/geri-al`, { body: { migrationId: kayit.id, degisiklikleriOnayla: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  assert.ok(o.cagrilar.filter((c) => c[0] === 'kirli').length >= 2, 'geri almada kirli isareti yok');
  assert.ok(o.cagrilar.some((c) => c[0] === 'audit' && c[1] === 'ss_migration_rollback'), 'geri alma denetimi yok');
  // Detay ve onizleme: onceki/uygulanan JSON istemciye gitmez
  r = await cagir(o.rotalar, 'post', `${P}/tasi`, { body: { to: 3, toT: 30, planHash: (await hazirla(o)).planHash, denemesizGerekce: 'zararsiz okuma servisi' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.govde));
  const d = await cagir(o.rotalar, 'get', `${P}/detay?to=3&toT=30`);
  assert.equal(d.statusCode, 200, JSON.stringify(d.govde));
  assert.ok(!/flowKey/.test(JSON.stringify(d.govde)), 'detay ayar JSONunu donduruyor');
  const on = await cagir(o.rotalar, 'get', `${P}/geri-al-onizleme`);
  assert.equal(on.govde.kayit.uygulanan, undefined, 'onizleme ayar JSONunu donduruyor');
  assert.equal(on.govde.kaynakSunucuAdi, 'maestro2');
  // Hazirlik iptali denetlenir
  const o2 = ortam();
  await cagir(o2.rotalar, 'post', `${P}/hedef`, { body: { to: 3, toT: 30 } });
  r = await cagir(o2.rotalar, 'post', `${P}/hazirlik-iptal`, {});
  assert.ok(o2.cagrilar.some((c) => c[0] === 'audit' && c[1] === 'ss_migration_prep_cancel'), 'hazirlik iptali denetlenmedi');
  // Eszamanli hazirlik: UX ihlali 409 (500 degil)
  const o3 = ortam({
    dbHook: (sql) => {
      if (/INSERT INTO ansible_ss_migrations/.test(sql)) throw Object.assign(new Error("duplicate key 'UX_ss_migrations_acik'"), { number: 2601 });
      return null;
    },
  });
  r = await cagir(o3.rotalar, 'post', `${P}/hedef`, { body: { to: 3, toT: 30 } });
  assert.equal(r.statusCode, 409, JSON.stringify(r.govde));
  // Detay: ayni sunucu 400; tasindi + kart geri donmus -> tutarsiz
  r = await cagir(o3.rotalar, 'get', `${P}/detay?to=2&toT=20`);
  assert.equal(r.statusCode, 400);
});
