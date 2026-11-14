// server/server-hub/__tests__/toplu-autostart.test.cjs - Toplu Auto-Start (2026-11-14) davranisi.
//
// Kullanici: "auto-start'lari toplu duzeltebilmek icin bir sayfa ve tek bir buton hazirlayabilir misin?"
// Guvenlik modeli (toplu-autostart.cjs basligi):
//   TA1 adaylar: yalniz taze + sema bilinen + tanimli + calisan/durmus uyumsuz JVM; bayat / sema / UNAVAILABLE /
//       olculemeyen / dogrulanmis / suren isli / bulgusu olmayan JVM disarida (nedeniyle)
//   TA2 olustur: limit 400, aday olmayan 400, ayni JVM iki kez 400, aktif is 409; is + ogeler + denetim
//   TA3 plan: host basina TEK plan isi (plan_only true, target_host tek, jvm_items); PLAN -> gecti, SKIP -> dustu
//       ("tarama eski"), FAIL -> dustu, set_stats yok -> dustu ("playbook guncel mi")
//   TA4 onay: plan 15 dk'dan eskiyse PLAN_ESKIDI (409), onay olmadan uygulama yok
//   TA5 uygulama: host basina TEK is, SIRAYLA (ikinci host ancak birinci terminal olunca), FAIL durdurmaz ->
//       BITTI_HATALI; OK ogeler dogrulama katmanina yazilir (is 'failed' olsa da); bitis denetimi
//   TA6 iptal: suren is biter, bekleyenler IPTAL, yeni is acilmaz
//   TA7 yeniden baslatma: kirasi dusmus is YARIM_KALDI, launch YOK; is numarasiz BASLATILIYOR YARIM_KALDI;
//       is numarali CALISIYOR yalniz izlenir (sonucu yazilir). Kirasi canli baska surecin isine dokunulmaz.
//   TA8 kilit: toplu isin bekleyen ogesi tek satir dugmesini (topluKilidi) ve surenIs'i (host isi) kilitler
//   TA9 ogeSonuclari: liste kipi esleme; plan kipi dogrulamaz; baska eylem satiri eslesmez
//   TA10 HTTP: uclar (adaylar / olustur / onayla confirmed / iptal) router uzerinden
//   TA11 YARIM_KALDI oge (is numarasi yazilamadi) varken is BITTI_HATALI (yesil 'Tamamlandi' degil)
//   TA12 onaylanmayan PLAN_HAZIR: 15 dk icinde dokunulmaz (kira dusse de); sonra yurutucu PLAN_ESKIDI yapar, kilit kalkar
//   TA13 onay aninda JVM kapisi: plandan sonra baslatilan JVM'in KAPAT ogesi duser (betik reddetmeden)
'use strict';

const { test: nodeTest, beforeEach } = require('node:test');
const test = (ad, fn) => nodeTest(ad, { timeout: 15000 }, fn);
const assert = require('node:assert/strict');
const Module = require('node:module');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

// ── SAHTE DB: modulun kullandigi T-SQL alt kumesini yorumlar (UPDATE ... SET ... WHERE ve(AND) kosullari,
// [NOT] EXISTS alt sorgulari, ozel SELECT'ler). Bilinmeyen sorgu HATA atar (sessiz gecmez).
const DB = { isler: [], ogeler: [], sira: 0, sorgular: [], kayma: 0, dus: null, uxYok: false };
const simdi = () => new Date(Date.now() + DB.kayma);
const temiz = (q) => String(q).replace(/\s+/g, ' ').trim();
const tablo = (ad) => (ad === 'server_hub_toplu_isler' ? DB.isler : DB.ogeler);

function deger(ifade, p) {
  const e = ifade.trim();
  let m;
  if ((m = /^\$(\d+)$/.exec(e))) return p[Number(m[1]) - 1];
  if ((m = /^'([^']*)'$/.exec(e))) return m[1];
  if (e === 'NULL') return null;
  if (e === 'SYSUTCDATETIME()') return simdi();
  if ((m = /^DATEADD\(second, (\d+), SYSUTCDATETIME\(\)\)$/.exec(e))) return new Date(simdi().getTime() + Number(m[1]) * 1000);
  if (/^-?\d+$/.test(e)) return Number(e);
  throw new Error(`sahte DB: deger yorumlanamadi: ${e}`);
}

/** Ust duzeyde ayirici ile bol (parantez icini bolmez). */
function bol(s, ayirici) {
  const out = [];
  let d = 0;
  let bas = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '(') d += 1;
    else if (s[i] === ')') d -= 1;
    else if (d === 0 && s.startsWith(ayirici, i)) {
      out.push(s.slice(bas, i));
      bas = i + ayirici.length;
      i += ayirici.length - 1;
    }
  }
  out.push(s.slice(bas));
  return out.map((x) => x.trim()).filter(Boolean);
}

const esit = (a, b) => (a instanceof Date || b instanceof Date ? +a === +b : String(a) === String(b));

function kosul(c, row, p) {
  const k = c.trim().replace(/^\w+\./, '');
  let m;
  if ((m = /^(NOT )?EXISTS \(SELECT 1 FROM (\w+)(?: \w+)?(?: WITH \([^)]*\))? WHERE (.*)\)$/.exec(k))) {
    const var_ = tablo(m[2]).some((r) => kosullar(m[3], r, p));
    return m[1] ? !var_ : var_;
  }
  if ((m = /^\((.*)\)$/.exec(k)) && / OR /.test(m[1])) return bol(m[1], ' OR ').some((x) => kosul(x, row, p));
  const t = k.replace(/^(\w+)\.(\w+)/, '$2');
  if ((m = /^(\w+) IS NULL$/.exec(t))) return row[m[1]] == null;
  if ((m = /^(\w+) IS NOT NULL$/.exec(t))) return row[m[1]] != null;
  if ((m = /^(\w+) IN \((.*)\)$/.exec(t))) return bol(m[2], ',').some((x) => esit(row[m[1]], deger(x, p)));
  if ((m = /^(\w+) < SYSUTCDATETIME\(\)$/.exec(t))) return row[m[1]] != null && row[m[1]] < simdi();
  if ((m = /^(\w+) <> (.*)$/.exec(t))) return !esit(row[m[1]], deger(m[2], p));
  if ((m = /^(\w+) = (.*)$/.exec(t))) return esit(row[m[1]], deger(m[2], p));
  throw new Error(`sahte DB: kosul yorumlanamadi: ${c}`);
}
const kosullar = (w, row, p) => bol(w, ' AND ').every((c) => kosul(c, row, p));

function sayimlar(id) {
  const og = DB.ogeler.filter((o) => o.is_id === id);
  const n = (f) => og.filter(f).length;
  return {
    aday: og.length,
    plan_gecti: n((o) => !['ADAY', 'PLANLANIYOR', 'DUSTU'].includes(o.durum)),
    dusen: n((o) => o.durum === 'DUSTU'),
    ok_sayisi: n((o) => o.durum === 'OK'),
    skip_sayisi: n((o) => o.durum === 'SKIP'),
    fail_sayisi: n((o) => o.durum === 'FAIL'),
  };
}

async function query(sql, p = []) {
  const q = temiz(sql);
  DB.sorgular.push(q);
  if (DB.dus) throw new Error(DB.dus);
  let m;
  if (/^SELECT TOP 1 \* FROM server_hub_toplu_isler WHERE tur = \$1 AND durum IN/.test(q)) {
    const w = /WHERE (.*) ORDER BY id DESC$/.exec(q)[1];
    return { rows: DB.isler.filter((r) => kosullar(w, r, p)).sort((a, b) => b.id - a.id).slice(0, 1), rowCount: 0 };
  }
  if (/^SELECT TOP 10 \* FROM server_hub_toplu_isler/.test(q))
    return { rows: DB.isler.filter((r) => r.tur === p[0]).sort((a, b) => b.id - a.id).slice(0, 10) };
  if (/^SELECT \* FROM server_hub_toplu_isler WHERE id = \$1 AND tur = \$2$/.test(q))
    return { rows: DB.isler.filter((r) => r.id === p[0] && r.tur === p[1]).map((r) => ({ ...r })) };
  if (/^SELECT \* FROM server_hub_toplu_ogeler WHERE is_id = \$1 ORDER BY sira$/.test(q))
    return { rows: DB.ogeler.filter((r) => r.is_id === p[0]).sort((a, b) => a.sira - b.sira).map((r) => ({ ...r })) };
  if (/^SELECT \*, CASE WHEN kira_bitis IS NULL OR kira_bitis < SYSUTCDATETIME\(\) THEN 1 ELSE 0 END AS kira_dustu/.test(q)) {
    const w = /WHERE (.*) ORDER BY id$/.exec(q)[1];
    return {
      rows: DB.isler
        .filter((r) => kosullar(w, r, p))
        .sort((a, b) => a.id - b.id)
        .map((r) => ({ ...r, kira_dustu: r.kira_bitis == null || r.kira_bitis < simdi() ? 1 : 0 })),
    };
  }
  if (/^SELECT DISTINCT i\.\* FROM server_hub_toplu_isler i JOIN server_hub_toplu_ogeler o/.test(q))
    return {
      rows: DB.isler
        .filter((i) => i.tur === p[0] && i.durum === 'YARIM_KALDI' && DB.ogeler.some((o) => o.is_id === i.id && o.durum === 'CALISIYOR'))
        .map((r) => ({ ...r })),
    };
  if (/^SELECT TOP 1 o\.is_id, o\.durum FROM server_hub_toplu_ogeler o JOIN server_hub_toplu_isler i/.test(q)) {
    const liste = bol(/o\.durum IN \((.*)\) ORDER BY/.exec(q)[1], ',').map((x) => deger(x, p));
    const r = DB.ogeler
      .filter((o) => {
        const i = DB.isler.find((x) => x.id === o.is_id);
        return i && i.tur === p[0] && o.host === p[1] && o.gen === p[2] && o.jvm.toLowerCase() === String(p[3]).toLowerCase() && liste.includes(o.durum);
      })
      .sort((a, b) => b.is_id - a.is_id)[0];
    return { rows: r ? [{ is_id: r.is_id, durum: r.durum }] : [] };
  }
  if (/^INSERT INTO server_hub_toplu_isler/.test(q)) {
    const aktif = ['PLANLANIYOR', 'PLAN_HAZIR', 'CALISIYOR', 'IPTAL_ISTENDI'];
    if (!DB.uxYok && DB.isler.some((r) => r.tur === p[0] && aktif.includes(r.durum)))
      throw new Error("Cannot insert duplicate key row in object 'dbo.server_hub_toplu_isler' with unique index 'UX_shti_aktif'");
    DB.sira += 1;
    const r = {
      id: DB.sira, tur: p[0], durum: 'PLANLANIYOR', olusturan: p[1], ust_sinir: p[2], aday: p[3], kira_id: p[4],
      kira_bitis: deger('DATEADD(second, 120, SYSUTCDATETIME())', p), created_at: simdi(), plan_gecti: 0, dusen: 0,
      ok_sayisi: 0, skip_sayisi: 0, fail_sayisi: 0, onaylayan: null, iptal_eden: null, hata: null, plan_bitis_at: null,
      onay_at: null, bitis_at: null,
    };
    DB.isler.push(r);
    return { rows: [{ id: r.id }], rowCount: 1 };
  }
  if (/^INSERT INTO server_hub_toplu_ogeler/.test(q)) {
    const n = (q.match(/'ADAY'\)/g) || []).length;
    for (let i = 0; i < n; i += 1) {
      const x = p.slice(i * 11, i * 11 + 11);
      DB.sira += 1;
      DB.ogeler.push({
        id: DB.sira, is_id: x[0], sira: x[1], host: x[2], env: x[3], gen: x[4], jvm: x[5], eylem: x[6], hedef: x[7],
        tarama_degeri: x[8], calisiyor: x[9], tarama_scan_date: x[10], durum: 'ADAY', neden: null, plan_awx_server_id: null,
        plan_job_id: null, awx_server_id: null, awx_job_id: null, sonuc_satiri: null, dogrulandi: 0, baslama_at: null, bitis_at: null,
      });
    }
    return { rows: [], rowCount: n };
  }
  if (/^UPDATE server_hub_toplu_isler SET aday = \(SELECT COUNT/.test(q)) {
    const r = DB.isler.find((x) => x.id === p[0]);
    if (r) Object.assign(r, sayimlar(r.id));
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if ((m = /^UPDATE (\w+) SET (.*?) WHERE (.*)$/.exec(q))) {
    const atamalar = bol(m[2], ',').map((a) => {
      const [k, ...v] = a.split(' = ');
      return [k.trim(), v.join(' = ')];
    });
    let n = 0;
    for (const r of tablo(m[1])) {
      if (!kosullar(m[3], r, p)) continue;
      for (const [k, v] of atamalar) r[k] = deger(v, p);
      n += 1;
    }
    return { rows: [], rowCount: n };
  }
  throw new Error(`sahte DB: bilinmeyen sorgu: ${q.slice(0, 120)}`);
}
stub('../../db/index.cjs', { query });

// Sahte AWX: is durumlari (jobId -> {status, artifacts}).
const AWX = new Map();
stub('../../ansible/runner.cjs', {
  getJobStatusOnServer: async (_s, jobId) => AWX.get(Number(jobId)) || { status: 'running', artifacts: {} },
});
stub('../../opsx/index.cjs', {
  extractStatsKey: (a, k) => (a && a[k] && typeof a[k] === 'object' ? a[k] : null),
});

const T = require('../toplu-autostart.cjs');
const AS = require('../autostart-dogrulama.cjs');

// ── DEGERLENDIRME FIXTURE ──────────────────────────────────────────────────────────────────────
const J = (name, ek) => ({ name, gen: 7, running: false, runningKnown: true, autoStart: 'false', source: 'xml', cfgSrc: 'XML', ...ek });
function host(ad, jvms, ek = {}) {
  const findings = [];
  for (const j of jvms) {
    if (ek.fresh === false || ek.schemaUnknown) continue;
    if (j.source === 'cli' && j.cfgSrc === 'UNAVAILABLE') continue;
    if (j.runningKnown !== false && j.running && j.autoStart === 'false')
      findings.push({ code: 'REBOOT_RISK', fix: { action: 'jboss_autostart_on', gen: j.gen, jvm: j.name } });
    if (j.runningKnown !== false && !j.running && j.autoStart === 'true' && !j.bulgusuz)
      findings.push({ code: 'STOPPED_AUTOSTART_ON', fix: { action: 'jboss_autostart_off', gen: j.gen, jvm: j.name } });
  }
  return { host: ad, env: 'Test', envGroup: 'Non-Production', fresh: true, schemaUnknown: false, scanDate: '2026-11-14', loadedAt: 1000, jvms, findings, ...ek };
}
let A;
function filo() {
  A = {
    hosts: [
      host('APP01', [J('ac1', { running: true }), J('kapat1', { autoStart: 'true' }), J('uyumlu', { running: true, autoStart: 'true' })]),
      host('APP02', [J('ac2', { running: true })]),
      host('APP03', [J('kapat3', { autoStart: 'true', gen: 8 })]),
      host('BAYAT01', [J('ac9', { running: true })], { fresh: false }),
      host('SEMA01', [J('ac8', { running: true })], { schemaUnknown: true }),
      host('GIZLI01', [J('gizli', { running: false, runningKnown: false, autoStart: 'true' }), J('tanimsiz', { running: true, source: 'cli', cfgSrc: 'UNAVAILABLE' }), J('bulgusuz', { autoStart: 'true', bulgusuz: true })]),
    ],
  };
}

let katman;
let launchlar;
let denetimler;
let limitDeger;
let launchHata;
const istek = (u = 'ayse') => ({ session: { user: { username: u, role: 'Admin' } } });

function kurDeps() {
  T.kur({
    launch: async (req, key, ad, ev, detail) => {
      if (launchHata) throw Object.assign(new Error(launchHata), { status: 500 });
      const jobId = 500 + launchlar.length;
      launchlar.push({ user: req.session.user.username, key, ad, ev: JSON.parse(JSON.stringify(ev)), detail, jobId });
      return { jobId, status: 'pending', awxServerId: 1 };
    },
    getAssessment: async () => A,
    autoStart: () => katman,
    ayarlar: { limit: async () => limitDeger },
    HOST_RE: /^[A-Z0-9][A-Z0-9.-]{0,63}$/,
    surenIsKilidi: async (h, g, j) => {
      const s = katman.surenIs(h, g, j);
      return s ? `is #${s.jobId} suruyor` : null;
    },
    audit: (req, d) => denetimler.push({ user: req.session.user.username, ...d }),
  });
}

beforeEach(() => {
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  DB.sira = 0;
  DB.sorgular.length = 0;
  DB.kayma = 0;
  DB.dus = null;
  DB.uxYok = false;
  AWX.clear();
  katman = AS.kur();
  launchlar = [];
  denetimler = [];
  limitDeger = 50;
  launchHata = null;
  filo();
  kurDeps();
});

const tum = () => [
  { host: 'APP01', gen: 7, jvm: 'ac1', eylem: 'ac' },
  { host: 'APP01', gen: 7, jvm: 'kapat1', eylem: 'kapat' },
  { host: 'APP02', gen: 7, jvm: 'ac2', eylem: 'ac' },
  { host: 'APP03', gen: 8, jvm: 'kapat3', eylem: 'kapat' },
];
const ogeDurumlari = () => Object.fromEntries(DB.ogeler.map((o) => [`${o.host}/${o.jvm}`, o.durum]));
const sonuc = (action, items, plan) => ({
  status: items.some((x) => /\tFAIL\t/.test(x.line)) ? 'failed' : 'successful',
  artifacts: { server_hub_fix_result: { host: 'x', action, plan_only: plan, line: 'RESULT\tjboss_autostart_items\tOK\tozet', items } },
});
const satir = (action, durum, mesaj = '') => `RESULT\t${action}\t${durum}\t${mesaj}`;

/** Plani tamamlar: tum ogeler PLAN (hala uyumsuz). */
async function planla(secim = tum()) {
  const r = await T.olustur(istek(), secim);
  await T.tick();
  for (const l of launchlar.filter((x) => x.ev.plan_only === true))
    AWX.set(l.jobId, sonuc(l.ev.action, l.ev.jvm_items.map((x) => ({ ...x, line: satir(x.action, 'PLAN', `${x.jvm} auto-start canli -> hedef`) })), true));
  await T.tick();
  return r.id;
}

test('TA1 adaylar: yalniz taze, sema bilinen, tanimli, olculmus uyumsuz JVM; digerleri nedeniyle disarida', () => {
  // ayni JVM'de suren tek satir isi
  katman.isKaydet(1, 77, { host: 'APP02', gen: 7, jvm: 'ac2', action: 'jboss_autostart_on', h: A.hosts[1] });
  const { adaylar, dislananlar } = T.adaylariTuret(A, { autoStart: katman });
  assert.deepEqual(
    adaylar.map((x) => `${x.host}/${x.jvm}/${x.eylem}`),
    ['APP01/ac1/ac', 'APP01/kapat1/kapat', 'APP03/kapat3/kapat'],
  );
  const neden = Object.fromEntries(dislananlar.map((x) => [x.jvm, x.neden]));
  assert.match(neden.ac2, /iş #77 sürüyor/);
  assert.match(neden.ac9, /bayat/);
  assert.match(neden.ac8, /şeması/);
  assert.match(neden.tanimsiz, /tanım kaynağında yok/);
  assert.match(neden.bulgusuz, /Bulgu düzeltme önermiyor/);
  assert.ok(!('gizli' in neden) && !adaylar.some((x) => x.jvm === 'gizli'), 'olculemeyen JVM aday ya da dislanan olmamali (uyumsuzluk bilinmiyor)');
  assert.ok(!adaylar.some((x) => x.jvm === 'uyumlu'));
  // dogrulanmis deger: is #78 APP01/ac1'i acti -> artik aday degil, "dogrulandi" diye dislanir
  katman.isKaydet(1, 78, { host: 'APP01', gen: 7, jvm: 'ac1', action: 'jboss_autostart_on', h: A.hosts[0] });
  katman.isBitti(1, 78, 'successful', { action: 'jboss_autostart_on', plan_only: false, line: satir('jboss_autostart_on', 'OK') });
  const t2 = T.adaylariTuret(A, { autoStart: katman });
  assert.ok(!t2.adaylar.some((x) => x.jvm === 'ac1'));
  assert.match(t2.dislananlar.find((x) => x.jvm === 'ac1').neden, /iş #78 ile doğrulandı/);
});

test('TA2 olustur: limit, aday disi, cift secim, aktif is; kayit ve denetim', async () => {
  limitDeger = 3;
  await assert.rejects(T.olustur(istek(), tum()), (e) => e.status === 400 && /en fazla 3 JVM/.test(e.message) && /Kurallar & Limitler/.test(e.message));
  limitDeger = 50;
  await assert.rejects(T.olustur(istek(), [{ host: 'BAYAT01', gen: 7, jvm: 'ac9', eylem: 'ac' }]), (e) => e.status === 400 && /artık aday değil.*bayat/.test(e.message));
  // istemci eylemi tersine ceviremez
  await assert.rejects(T.olustur(istek(), [{ host: 'APP01', gen: 7, jvm: 'ac1', eylem: 'kapat' }]), (e) => e.status === 400);
  await assert.rejects(T.olustur(istek(), [tum()[0], tum()[0]]), (e) => e.status === 400 && /iki kez/.test(e.message));
  await assert.rejects(T.olustur(istek(), [{ host: 'APP01,APP02', gen: 7, jvm: 'ac1', eylem: 'ac' }]), (e) => e.status === 400);
  assert.equal(DB.isler.length, 0, 'reddedilen istek kayit acmamali');
  const r = await T.olustur(istek(), tum());
  assert.deepEqual([r.adet, r.hostSayisi], [4, 3]);
  assert.equal(DB.isler[0].durum, 'PLANLANIYOR');
  assert.equal(DB.isler[0].kira_id, T.SUREC_ID, 'olusturan surec kirayi almali');
  assert.deepEqual(new Set(DB.ogeler.map((o) => o.durum)), new Set(['ADAY']));
  assert.deepEqual(denetimler.map((d) => d.op), ['toplu_autostart_olustur']);
  assert.deepEqual(denetimler[0].hostlar, ['APP01', 'APP02', 'APP03']);
  await assert.rejects(T.olustur(istek('mehmet'), tum().slice(0, 1)), (e) => e.status === 409);
  // filtreli tekil indeks (UX_shti_aktif) olmasa da uc aktif isi okuyup reddeder (iki katman)
  DB.uxYok = true;
  await assert.rejects(T.olustur(istek('mehmet'), tum().slice(0, 1)), (e) => e.status === 409 && /hâlâ aktif/.test(e.message));
  assert.equal(DB.isler.length, 1);
  assert.equal(launchlar.length, 0, 'olusturma is BASLATMAZ (plan yurutucude)');
});

test('TA2b ortak kapilar (/jvm-autostart ile ayni): calisan JVM kapat, zaten hedefte, tanimsiz, olculemeyen', () => {
  const k = (j, enable) => AS.jvmAutoStartKapisi(j, { host: 'H', jvm: 'x', gen: 7, enable });
  assert.match(k(J('x', { running: true, autoStart: 'true' }), false).message, /ÇALIŞIYOR — çalışan JVM'in auto-start'ı kapatılmaz/);
  assert.equal(k(J('x', { running: true, runningKnown: false, autoStart: 'true' }), false), null, 'olculemeyen JVM kapi degil');
  assert.match(k(J('x', { autoStart: 'false' }), false).message, /zaten auto-start KAPALI/);
  assert.match(k(J('x', { running: true, source: 'cli', cfgSrc: 'UNAVAILABLE' }), true).message, /tanım kaynağında yok/);
  assert.match(k(undefined, true).message, /taramada yok/);
  assert.equal(k(J('x', { running: true }), true), null);
  assert.match(AS.sunucuYazmaKapisi({ schemaUnknown: true }, {}, 'H').message, /şeması/);
  assert.match(AS.sunucuYazmaKapisi({}, { fresh: false, scanDate: 'd', loadExcluded: true }, 'H').message, /bayat .*son yükleme dışlandı/);
  assert.equal(AS.sunucuYazmaKapisi({}, { fresh: true }, 'H'), null);
});

test('TA3 plan: host basina tek salt okunur is; PLAN gecer, SKIP/FAIL/sonucsuz duser', async () => {
  await T.olustur(istek(), tum());
  await T.tick();
  assert.equal(launchlar.length, 3, 'host basina TEK plan isi');
  for (const l of launchlar) {
    assert.equal(l.ev.plan_only, true);
    assert.equal(l.ev.action, 'jboss_autostart_items');
    assert.ok(!String(l.ev.target_host).includes(','), 'virgullu hedef');
    assert.equal(l.key, 'server_hub_fix');
  }
  const l1 = launchlar.find((l) => l.ev.target_host === 'APP01');
  assert.deepEqual(l1.ev.jvm_items, [
    { gen: 7, jvm: 'ac1', action: 'jboss_autostart_on' },
    { gen: 7, jvm: 'kapat1', action: 'jboss_autostart_off' },
  ]);
  // ikinci tick: isler bitmedi -> yeni is yok
  await T.tick();
  assert.equal(launchlar.length, 3);
  const id = (h) => launchlar.find((l) => l.ev.target_host === h).jobId;
  AWX.set(id('APP01'), sonuc('jboss_autostart_items', [
    { gen: 7, jvm: 'ac1', action: 'jboss_autostart_on', line: satir('jboss_autostart_on', 'PLAN', 'ac1 auto-start false -> true') },
    { gen: 7, jvm: 'kapat1', action: 'jboss_autostart_off', line: satir('jboss_autostart_off', 'SKIP', 'kapat1 auto-start zaten false') },
  ], true));
  AWX.set(id('APP02'), { status: 'failed', artifacts: {} });
  AWX.set(id('APP03'), sonuc('jboss_autostart_items', [
    { gen: 8, jvm: 'kapat3', action: 'jboss_autostart_off', line: satir('jboss_autostart_off', 'FAIL', 'kapat3 su an CALISIYOR') },
  ], true));
  await T.tick();
  assert.deepEqual(ogeDurumlari(), { 'APP01/ac1': 'PLAN_GECTI', 'APP01/kapat1': 'DUSTU', 'APP02/ac2': 'DUSTU', 'APP03/kapat3': 'DUSTU' });
  const neden = Object.fromEntries(DB.ogeler.map((o) => [o.jvm, o.neden]));
  assert.match(neden.kapat1, /canlı değer zaten false — tarama eski/);
  assert.match(neden.ac2, /plan okunamadı.*playbook güncel mi/);
  assert.match(neden.kapat3, /CALISIYOR/);
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR');
  assert.deepEqual([DB.isler[0].plan_gecti, DB.isler[0].dusen], [1, 3]);
  assert.equal(launchlar.length, 3, 'plan bitince uygulama ONAYSIZ baslamaz');
  await T.tick();
  assert.equal(launchlar.length, 3);
});

test('TA4 onay: 15 dk siniri; onaydan sonra CALISIYOR ve BEKLIYOR', async () => {
  const id = await planla();
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR');
  DB.isler[0].plan_bitis_at = new Date(Date.now() - 16 * 60 * 1000);
  await assert.rejects(T.onayla(istek('mehmet'), id), (e) => e.status === 409 && e.code === 'plan_eskidi');
  assert.equal(DB.isler[0].durum, 'PLAN_ESKIDI');
  assert.ok(DB.ogeler.every((o) => o.durum === 'IPTAL'));
  // yeni is acilabilir (PLAN_ESKIDI aktif degil)
  const id2 = await planla();
  const r = await T.onayla(istek('mehmet'), id2);
  assert.equal(r.adet, 4);
  const is2 = DB.isler.find((x) => x.id === id2);
  assert.deepEqual([is2.durum, is2.onaylayan], ['CALISIYOR', 'mehmet']);
  assert.ok(DB.ogeler.filter((o) => o.is_id === id2).every((o) => o.durum === 'BEKLIYOR'));
  await assert.rejects(T.onayla(istek(), id2), (e) => e.status === 409, 'ikinci onay');
  assert.ok(denetimler.some((d) => d.op === 'toplu_autostart_onay' && d.id === id2 && d.user === 'mehmet'));
});

test('TA4b onay aninda bayatlayan sunucunun ogeleri duser', async () => {
  const id = await planla();
  A.hosts[1].fresh = false;
  const r = await T.onayla(istek(), id);
  assert.equal(r.adet, 3);
  const o = DB.ogeler.find((x) => x.host === 'APP02');
  assert.equal(o.durum, 'DUSTU');
  assert.match(o.neden, /onay anında: APP02 taraması bayat/);
});

test('TA5 uygulama: host basina tek is, SIRAYLA; FAIL durdurmaz; OK dogrulanir; BITTI_HATALI', async () => {
  const id = await planla();
  await T.onayla(istek('mehmet'), id);
  const uygulama = () => launchlar.filter((l) => l.ev.plan_only === false);
  await T.tick();
  assert.equal(uygulama().length, 1, 'ilk tick yalniz ILK host');
  const u1 = uygulama()[0];
  assert.equal(u1.ev.target_host, 'APP01');
  assert.equal(u1.user, 'mehmet', 'AWX isi onaylayan adina');
  assert.deepEqual(u1.ev.jvm_items.map((x) => x.jvm), ['ac1', 'kapat1']);
  // suren host isinin JVM'i tek satir icin kilitli (bellek) - toplu is (DB) de
  assert.equal(katman.surenIs('APP01', 7, 'ac1').toplu, true);
  assert.match(await T.topluKilidi('APP02', 7, 'ac2'), /toplu auto-start işi #\d+ içinde \(BEKLIYOR\)/);
  await T.tick();
  await T.tick();
  assert.equal(uygulama().length, 1, 'birinci host bitmeden ikinci baslamaz');
  // APP01: ac1 OK, kapat1 FAIL -> is 'failed'; ac1 yine de dogrulanir
  AWX.set(u1.jobId, sonuc('jboss_autostart_items', [
    { gen: 7, jvm: 'ac1', action: 'jboss_autostart_on', line: satir('jboss_autostart_on', 'OK', 'ac1 auto-start true (dogrulandi)') },
    { gen: 7, jvm: 'kapat1', action: 'jboss_autostart_off', line: satir('jboss_autostart_off', 'FAIL', 'yazilamadi') },
  ], false));
  await T.tick();
  assert.deepEqual([ogeDurumlari()['APP01/ac1'], ogeDurumlari()['APP01/kapat1']], ['OK', 'FAIL']);
  assert.equal(DB.ogeler.find((o) => o.jvm === 'ac1').dogrulandi, 1);
  const j = katman.uygulaJvm(A.hosts[0], A.hosts[0].jvms[0]);
  assert.deepEqual([j.autoStart, j.autoStartTarama, j.autoStartDogrulama.jobId], ['true', 'false', u1.jobId], 'dogrulama katmani guncellenmedi');
  assert.equal(katman.uygulaJvm(A.hosts[0], A.hosts[0].jvms[1]).autoStartDogrulama, undefined, 'FAIL oge dogrulanmamali');
  assert.equal(uygulama().length, 2, 'FAIL toplu isi durdurmamali: ikinci host basladi');
  const u2 = uygulama()[1];
  assert.equal(u2.ev.target_host, 'APP02');
  AWX.set(u2.jobId, sonuc('jboss_autostart_items', [{ gen: 7, jvm: 'ac2', action: 'jboss_autostart_on', line: satir('jboss_autostart_on', 'SKIP', 'zaten true') }], false));
  await T.tick();
  const u3 = uygulama()[2];
  assert.equal(u3.ev.target_host, 'APP03');
  // sonuc set_stats'siz (is 'error'): FAIL "sonuc okunamadi"
  AWX.set(u3.jobId, { status: 'error', artifacts: {} });
  await T.tick();
  assert.deepEqual(ogeDurumlari(), { 'APP01/ac1': 'OK', 'APP01/kapat1': 'FAIL', 'APP02/ac2': 'SKIP', 'APP03/kapat3': 'FAIL' });
  assert.match(DB.ogeler.find((o) => o.jvm === 'kapat3').neden, /sonuç okunamadı \(iş #\d+ error\)/);
  const is = DB.isler[0];
  assert.deepEqual([is.durum, is.ok_sayisi, is.skip_sayisi, is.fail_sayisi], ['BITTI_HATALI', 1, 1, 2]);
  assert.equal(is.kira_id, null);
  const b = denetimler.find((d) => d.op === 'toplu_autostart_bitti');
  assert.deepEqual([b.durum, b.ok, b.fail], ['BITTI_HATALI', 1, 2]);
  await T.tick();
  assert.equal(uygulama().length, 3, 'biten is yeniden kosmaz');
});

test('TA5b launch hatasi o hostu FAIL yapar, sonraki host yine baslar', async () => {
  const id = await planla(tum().slice(2));
  await T.onayla(istek(), id);
  launchHata = 'AWX erisilemedi';
  await T.tick();
  assert.equal(ogeDurumlari()['APP02/ac2'], 'FAIL');
  assert.match(DB.ogeler.find((o) => o.jvm === 'ac2').neden, /iş başlatılamadı: AWX erisilemedi/);
  launchHata = null;
  await T.tick();
  assert.equal(launchlar.filter((l) => l.ev.plan_only === false).length, 1);
  assert.equal(launchlar.at(-1).ev.target_host, 'APP03');
});

test('TA6 iptal: suren is biter, bekleyenler IPTAL, yeni host acilmaz', async () => {
  const id = await planla();
  await T.onayla(istek(), id);
  await T.tick();
  const u1 = launchlar.at(-1);
  const r = await T.iptal(istek('ali'), id);
  assert.equal(r.durum, 'IPTAL_ISTENDI');
  assert.deepEqual(new Set(DB.ogeler.filter((o) => o.host !== 'APP01').map((o) => o.durum)), new Set(['IPTAL']));
  await T.tick();
  assert.equal(DB.isler[0].durum, 'IPTAL_ISTENDI', 'suren is bitmeden kapanmamali');
  AWX.set(u1.jobId, sonuc('jboss_autostart_items', u1.ev.jvm_items.map((x) => ({ ...x, line: satir(x.action, 'OK') })), false));
  await T.tick();
  assert.equal(DB.isler[0].durum, 'IPTAL');
  assert.deepEqual([ogeDurumlari()['APP01/ac1'], ogeDurumlari()['APP01/kapat1']], ['OK', 'OK'], 'suren isin sonucu yazilmali');
  assert.equal(launchlar.filter((l) => l.ev.plan_only === false).length, 1, 'iptalden sonra yeni host acildi');
  assert.ok(denetimler.some((d) => d.op === 'toplu_autostart_iptal' && d.user === 'ali'));
});

test('TA6b plan sirasinda iptal: suren plan biter, is IPTAL, uygulama yok', async () => {
  const r = await T.olustur(istek(), tum());
  await T.tick();
  await T.iptal(istek(), r.id);
  for (const l of launchlar) AWX.set(l.jobId, sonuc(l.ev.action, l.ev.jvm_items.map((x) => ({ ...x, line: satir(x.action, 'PLAN') })), true));
  await T.tick();
  assert.equal(DB.isler[0].durum, 'IPTAL');
  assert.ok(DB.ogeler.every((o) => o.durum === 'IPTAL'));
  assert.equal(launchlar.length, 3);
});

test('TA7 yeniden baslatma: kirasi dusen is YARIM_KALDI, launch YOK; calisan host isi yalniz izlenir', async () => {
  const id = await planla();
  await T.onayla(istek(), id);
  await T.tick();
  const u1 = launchlar.at(-1);
  // Portal yeniden basladi: kira baska (eski) surecte ve suresi doldu; bir oge is numarasiz BASLATILIYOR'da kaldi.
  const is = DB.isler[0];
  is.kira_id = 'eski-surec';
  is.kira_bitis = new Date(Date.now() - 1000);
  Object.assign(DB.ogeler.find((o) => o.host === 'APP02'), { durum: 'BASLATILIYOR', awx_job_id: null });
  const once = launchlar.length;
  await T.tick();
  assert.equal(launchlar.length, once, 'yeniden baslatmada is ACILMAMALI');
  assert.equal(is.durum, 'YARIM_KALDI');
  assert.match(is.hata, /DEVAM ETTİRİLMEDİ/);
  const d = ogeDurumlari();
  assert.deepEqual([d['APP01/ac1'], d['APP02/ac2'], d['APP03/kapat3']], ['CALISIYOR', 'YARIM_KALDI', 'YARIM_KALDI']);
  assert.match(DB.ogeler.find((o) => o.host === 'APP02').neden, /AWX'e gitmiş olabilir/);
  assert.match(DB.ogeler.find((o) => o.host === 'APP03').neden, /çalıştırılmadı/);
  assert.ok(denetimler.some((x) => x.op === 'toplu_autostart_yarim_kaldi'));
  // calisan host isi biter -> sonucu yazilir (izleme), yine launch yok
  AWX.set(u1.jobId, sonuc('jboss_autostart_items', u1.ev.jvm_items.map((x) => ({ ...x, line: satir(x.action, 'OK') })), false));
  await T.tick();
  assert.deepEqual([ogeDurumlari()['APP01/ac1'], ogeDurumlari()['APP01/kapat1']], ['OK', 'OK']);
  assert.equal(launchlar.length, once);
  assert.equal(is.durum, 'YARIM_KALDI');
  // yeni toplu is acilabilir (YARIM_KALDI aktif degil); ama yarim kalan JVM'ler kilitli degil
  assert.equal(await T.topluKilidi('APP03', 8, 'kapat3'), null);
});

test('TA7b kirasi CANLI baska surecin isine dokunulmaz; plan fazinda kira dusunce plan isi acilmaz', async () => {
  const r = await T.olustur(istek(), tum());
  DB.isler[0].kira_id = 'baska-surec';
  await T.tick();
  assert.equal(launchlar.length, 0);
  assert.equal(DB.isler[0].durum, 'PLANLANIYOR');
  DB.isler[0].kira_bitis = new Date(Date.now() - 1);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'YARIM_KALDI');
  assert.ok(DB.ogeler.every((o) => o.durum === 'YARIM_KALDI'));
  assert.equal(launchlar.length, 0);
  assert.ok(r.id);
});

test('TA7c olusturma yarim kaldiysa (kira OLUSTURULUYOR) yurutucu ogeleri baslatmaz', async () => {
  const r = await T.olustur(istek(), tum());
  DB.isler[0].kira_id = 'OLUSTURULUYOR';
  await T.tick();
  assert.equal(launchlar.length, 0);
  assert.ok(r.id);
});

test('TA8 kilit: toplu isin ogesi tek satir dugmesini kilitler; is bitince kalkar', async () => {
  const r = await T.olustur(istek(), tum().slice(0, 1));
  assert.match(await T.topluKilidi('app01', 7, 'AC1'), new RegExp(`#${r.id} içinde \\(ADAY\\)`));
  assert.equal(await T.topluKilidi('APP01', 7, 'kapat1'), null);
  await T.iptal(istek(), r.id);
  await T.tick();
  assert.equal(await T.topluKilidi('APP01', 7, 'ac1'), null);
  DB.dus = 'baglanti yok';
  assert.equal(await T.topluKilidi('APP01', 7, 'ac1'), null, 'DB okunamazsa tek satir yolu kilitlenmez');
});

test('TA9 ogeSonuclari: liste esleme, plan kipi dogrulamaz, eylem eslesmesi sart', () => {
  const items = [
    { gen: 7, jvm: 'a', action: 'jboss_autostart_on' },
    { gen: 7, jvm: 'b', action: 'jboss_autostart_off' },
    { gen: 8, jvm: 'c', action: 'jboss_autostart_on' },
  ];
  const r = {
    action: 'jboss_autostart_items',
    plan_only: false,
    items: [
      { gen: '7', jvm: 'A', action: 'jboss_autostart_on', line: satir('jboss_autostart_on', 'OK', 'a true') },
      { gen: 7, jvm: 'b', action: 'jboss_autostart_off', line: satir('jboss_autostart_on', 'OK', 'yanlis eylem satiri') },
    ],
  };
  const s = AS.ogeSonuclari(items, r);
  assert.deepEqual(s.map((x) => [x.durum, x.dogrulandi]), [['OK', true], [null, false], [null, false]]);
  assert.ok(AS.ogeSonuclari(items, { ...r, plan_only: true }).every((x) => !x.dogrulandi), 'plan kipi dogrulamaz');
  assert.ok(AS.ogeSonuclari(items, { ...r, action: 'jboss_autostart_on' }).every((x) => x.durum === null), 'tek JVM sonucu liste sayilmaz');
  assert.ok(AS.ogeSonuclari(items, null).every((x) => x.durum === null));
  // katman: toplu kayit bir kez islenir, tek-JVM haritasini bozmaz
  const k = AS.kur();
  k.isKaydetToplu(1, 9, { host: 'H1', h: { scanDate: 'd', loadedAt: 5 }, items });
  assert.equal(k.surenIs('h1', 8, 'C').jobId, 9);
  assert.deepEqual(k._boyut().isler, 0);
  const b = k.isBitti(1, 9, 'failed', r);
  assert.deepEqual([b.kayitli, b.toplu, b.ogeler.filter((x) => x.dogrulandi).length], [true, true, 1]);
  assert.equal(k.surenIs('H1', 8, 'c'), null);
  assert.deepEqual(k.isBitti(1, 9, 'failed', r), { kayitli: false });
});

test('TA10 HTTP: uclar router uzerinden (adaylar, olustur 400/409, onay confirmed, iptal)', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { role: 'Admin', username: 'ayse' } };
    next();
  });
  const router = express.Router();
  const log = console.log;
  T.mount(router, {
    launch: async () => ({ jobId: 1, awxServerId: 1 }),
    getAssessment: async () => A,
    autoStart: () => katman,
    ayarlar: { limit: async () => limitDeger },
    audit: () => {},
  });
  console.log = log;
  app.use('/api/server-hub', router);
  const srv = app.listen(0);
  try {
    const kok = `http://127.0.0.1:${srv.address().port}/api/server-hub`;
    const J = (r) => r.json().then((body) => ({ status: r.status, body }));
    const post = (p, b) => fetch(kok + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(J);
    const ad = await fetch(`${kok}/toplu-autostart/adaylar?fresh=1`).then(J);
    assert.equal(ad.status, 200);
    assert.equal(ad.body.adaylar.length, 4);
    assert.equal(ad.body.limit, 50);
    assert.equal(ad.body.aktif, null);
    limitDeger = 2;
    assert.equal((await post('/toplu-autostart', { secim: tum() })).status, 400);
    limitDeger = 50;
    const c = await post('/toplu-autostart', { secim: tum() });
    assert.equal(c.status, 200);
    assert.equal((await post('/toplu-autostart', { secim: tum() })).status, 409);
    const d = await fetch(`${kok}/toplu-autostart/${c.body.id}`).then(J);
    assert.equal(d.body.is.durum, 'PLANLANIYOR');
    assert.equal(d.body.ogeler.length, 4);
    const liste = await fetch(`${kok}/toplu-autostart`).then(J);
    assert.equal(liste.body.aktif.id, c.body.id);
    assert.equal((await post(`/toplu-autostart/${c.body.id}/onayla`, {})).status, 400, 'confirmed olmadan onay yok');
    assert.equal((await post(`/toplu-autostart/${c.body.id}/onayla`, { confirmed: true })).status, 409, 'plan bitmeden onay yok');
    assert.equal((await post(`/toplu-autostart/${c.body.id}/iptal`, {})).body.durum, 'IPTAL_ISTENDI');
    assert.equal((await fetch(`${kok}/toplu-autostart/abc`).then(J)).status, 400);
  } finally {
    srv.close();
  }
});

test('TA11 YARIM_KALDI oge varken is BITTI_HATALI', async () => {
  const id = await planla(tum().slice(2));
  await T.onayla(istek(), id);
  const o = DB.ogeler.find((x) => x.jvm === 'ac2');
  Object.assign(o, { durum: 'BASLATILIYOR', baslama_at: new Date(Date.now() - 11 * 60 * 1000) });
  await T.tick();
  assert.equal(o.durum, 'YARIM_KALDI');
  for (let i = 0; i < 4 && DB.isler[0].durum === 'CALISIYOR'; i += 1) {
    const u = launchlar.filter((l) => l.ev.plan_only === false).at(-1);
    if (u && !AWX.has(u.jobId))
      AWX.set(u.jobId, sonuc('jboss_autostart_items', u.ev.jvm_items.map((x) => ({ ...x, line: satir(x.action, 'OK', 'dogrulandi') })), false));
    await T.tick();
  }
  assert.equal(DB.ogeler.find((x) => x.jvm === 'kapat3').durum, 'OK');
  assert.equal(DB.isler[0].fail_sayisi, 0);
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI', 'AWX e gitmis olabilecek oge yesil ozetle gizlenmez');
  assert.ok(denetimler.some((d) => d.op === 'toplu_autostart_bitti' && d.durum === 'BITTI_HATALI'));
});

test('TA12 PLAN_HAZIR: 15 dk icinde dokunulmaz; sonra PLAN_ESKIDI, ogeler IPTAL, kilit kalkar', async () => {
  const id = await planla();
  DB.isler[0].kira_id = 'eski-surec';
  DB.isler[0].kira_bitis = new Date(Date.now() - 1000);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR', 'onay bekleyen is YARIM_KALDI yapilmaz');
  assert.match(await T.topluKilidi('APP01', 7, 'ac1'), /PLAN_GECTI/);
  DB.isler[0].plan_bitis_at = new Date(Date.now() - 16 * 60 * 1000);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'PLAN_ESKIDI');
  assert.ok(DB.ogeler.every((o) => o.durum === 'IPTAL'));
  assert.equal(await T.topluKilidi('APP01', 7, 'ac1'), null, 'terk edilen plan JVM kilitlemez');
  assert.ok(denetimler.some((d) => d.op === 'toplu_autostart_plan_eskidi' && d.id === id));
  assert.equal(launchlar.filter((l) => l.ev.plan_only === false).length, 0);
});

test('TA13 onay aninda JVM kapisi: plandan sonra baslayan JVM in KAPAT ogesi duser', async () => {
  const id = await planla();
  A.hosts[0].jvms.find((j) => j.name === 'kapat1').running = true;
  const r = await T.onayla(istek(), id);
  assert.equal(r.adet, 3);
  const o = DB.ogeler.find((x) => x.jvm === 'kapat1');
  assert.equal(o.durum, 'DUSTU');
  assert.match(o.neden, /onay anında: kapat1 son taramada ÇALIŞIYOR/);
  assert.equal(DB.ogeler.find((x) => x.jvm === 'ac1').durum, 'BEKLIYOR');
});

test('TA14 savunma: ayni sunucuda ayni (gen, JVM) iki kayit ve gen 7/8 disi -> aday degil, nedeniyle disarida', () => {
  // uretim 2026-11-14: GBSTPQ01/8/GBSTPMAINWEB taramada iki satir; Portal ikisini birden gonderip reddedildi
  A.hosts.push(host('CIFT01', [J('cift', { running: true, gen: 8 }), J('cift', { running: true, gen: 8 }), J('tek', { running: true, gen: 8 })]));
  A.hosts.push(host('GEN01', [J('gensiz', { running: true, gen: 0 })]));
  const { adaylar, dislananlar } = T.adaylariTuret(A, { autoStart: katman });
  assert.ok(!adaylar.some((x) => x.jvm === 'cift'), 'iki kez gorulen JVM aday olmamali');
  const cift = dislananlar.filter((x) => x.host === 'CIFT01' && x.jvm === 'cift');
  assert.equal(cift.length, 1, 'dislanan listesinde bir kez');
  assert.match(cift[0].neden, /iki kez/);
  assert.ok(adaylar.some((x) => x.host === 'CIFT01' && x.jvm === 'tek'), 'ayni sunucudaki tekil JVM etkilenmemeli');
  assert.ok(!adaylar.some((x) => x.jvm === 'gensiz'));
  assert.match(dislananlar.find((x) => x.jvm === 'gensiz').neden, /7\/8/);
});
