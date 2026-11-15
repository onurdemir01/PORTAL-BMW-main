// server/server-hub/__tests__/toplu-autostart.test.cjs - Toplu Auto-Start (2026-11-14) davranisi.
//
// Kullanici: "auto-start'lari toplu duzeltebilmek icin bir sayfa ve tek bir buton hazirlayabilir misin?"
// Guvenlik modeli (toplu-autostart.cjs basligi):
//   TA1 adaylar: yalniz taze + sema bilinen + tanimli + calisan/durmus uyumsuz JVM; bayat / sema / UNAVAILABLE /
//       olculemeyen / dogrulanmis / suren isli / bulgusu olmayan JVM disarida (nedeniyle)
//   TA2 olustur: limit 400, ayni JVM iki kez 400, aktif is 409; istek taze OKUMAZ, ogeler SECIM; aday olmayan /
//       eylemi ters secim yurutucunun secimDogrula adiminda DUSTU (nedeniyle); is + ogeler + denetim
//   TA2c taze okuma hatasi: en erken 30 sn sonra yeniden denenir (is hatasi), 10 dk sonra DUSTU + PLAN_HATA;
//       beklenmeyen hata (turetme) da ayni yol; SECIM kilitler
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
//   TA11 YARIM_KALDI oge (is numarasi yazilamadi) varken is BITTI_HATALI (yesil 'Tamamlandi' degil); 2026-11-15'ten
//       beri toplu is de DURUR (bekleyenler "calistirilmadi")
//   TA12 onaylanmayan PLAN_HAZIR: 15 dk icinde dokunulmaz (kira dusse de); sonra yurutucu PLAN_ESKIDI yapar, kilit kalkar
//   TA13 onay aninda JVM kapisi: plandan sonra baslatilan JVM'in KAPAT ogesi duser (betik reddetmeden)
//   PARCALAMA (2026-11-15, AWX isi basina en cok limit:toplu_is_basina_jvm JVM):
//   TA15 35 JVM'li host N=10 -> 4 plan isi, paralellik IS sayisiyla (5); uygulamada 4 SIRALI is, sonra diger hostlar;
//        parca ogeleri ayni is numarasi, set_stats sonucu parca basina, dogrulama katmani parca isiyle
//   TA16 parca boyutu ayardan (plan + uygulama); okunamaz / gecersizse varsayilan 10
//   TA17 parcalar arasinda iptal; TA18 / TA18b sonucu belirsiz parca (launchBelirsiz, 3 saat, is numarasi
//        yazilamadi) toplu isi durdurur, kesin red durdurmaz; TA19 parca ortasinda kira kaybi -> YARIM_KALDI
//   TA15 ayrica: plan hostta ayni anda tek is (PLAN_HOST_PARALEL, inceleme B4)
//   TA20 / TA20b sonucu belirsiz oge (BELIRSIZ_IZ) JVM'i AWX isi bitene kadar kilitler, "calistirilmadi" kilitlemez,
//        yeni toplu iste secim dogrulamasinda duser (inceleme B1); TA21 karisik sirali secimde uygulama host host (B2)
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
  if ((m = /^(\w+) NOT IN \((.*)\)$/.exec(t))) return !bol(m[2], ',').some((x) => esit(row[m[1]], deger(x, p)));
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
    plan_gecti: n((o) => !['SECIM', 'ADAY', 'PLANLANIYOR', 'DUSTU'].includes(o.durum)),
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
        return i && i.tur === p[0] && o.host === p[1] && o.gen === p[2] && o.jvm.toLowerCase() === String(p[3]).toLowerCase() && liste.includes(o.durum) && (!/o\.is_id <> \$5/.test(q) || o.is_id !== p[4]);
      })
      .sort((a, b) => b.is_id - a.is_id)[0];
    return { rows: r ? [{ is_id: r.is_id, durum: r.durum }] : [] };
  }
  // belirsizOgeler: sonucu belirsiz (neden LIKE %iz%) YARIM_KALDI / FAIL ogeler, son N saat
  if ((m = /^SELECT o\.id, o\.is_id, o\.host, o\.gen, o\.jvm, o\.awx_server_id, o\.awx_job_id, o\.baslama_at FROM server_hub_toplu_ogeler o JOIN server_hub_toplu_isler i ON i\.id = o\.is_id WHERE i\.tur = \$1 AND o\.durum IN \('YARIM_KALDI', 'FAIL'\) AND o\.neden LIKE \$2 AND o\.bitis_at > DATEADD\(hour, -(\d+), SYSUTCDATETIME\(\)\)$/.exec(q))) {
    const iz = String(p[1]).replace(/^%|%$/g, '').toLowerCase();
    const sinir = simdi().getTime() - Number(m[1]) * 3600 * 1000;
    return {
      rows: DB.ogeler
        .filter((o) => {
          const i = DB.isler.find((x) => x.id === o.is_id);
          return i && i.tur === p[0] && ['YARIM_KALDI', 'FAIL'].includes(o.durum) && String(o.neden || '').toLowerCase().includes(iz) && o.bitis_at && +o.bitis_at > sinir;
        })
        .map((o) => ({ id: o.id, is_id: o.is_id, host: o.host, gen: o.gen, jvm: o.jvm, awx_server_id: o.awx_server_id, awx_job_id: o.awx_job_id, baslama_at: o.baslama_at })),
    };
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
    const durumlar_ = [...q.matchAll(/'(ADAY|SECIM)'\)/g)].map((x) => x[1]);
    const n = durumlar_.length;
    for (let i = 0; i < n; i += 1) {
      const x = p.slice(i * 11, i * 11 + 11);
      DB.sira += 1;
      DB.ogeler.push({
        id: DB.sira, is_id: x[0], sira: x[1], host: x[2], env: x[3], gen: x[4], jvm: x[5], eylem: x[6], hedef: x[7],
        tarama_degeri: x[8], calisiyor: x[9], tarama_scan_date: x[10], durum: durumlar_[i], neden: null, plan_awx_server_id: null,
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
let launchEk;
let parcaDeger;
const istek = (u = 'ayse') => ({ session: { user: { username: u, role: 'Admin' } } });

function kurDepsNesnesi() {
  return {
    launch: async (req, key, ad, ev, detail) => {
      if (launchHata) throw Object.assign(new Error(launchHata), { status: 500 }, launchEk || {});
      const jobId = 500 + launchlar.length;
      launchlar.push({ user: req.session.user.username, key, ad, ev: JSON.parse(JSON.stringify(ev)), detail, jobId });
      return { jobId, status: 'pending', awxServerId: 1 };
    },
    getAssessment: async () => A,
    autoStart: () => katman,
    ayarlar: { limit: async (ad) => (ad === 'toplu_is_basina_jvm' ? parcaDeger : limitDeger) },
    HOST_RE: /^[A-Z0-9][A-Z0-9.-]{0,63}$/,
    surenIsKilidi: async (h, g, j) => {
      const s = katman.surenIs(h, g, j);
      return s ? `is #${s.jobId} suruyor` : null;
    },
    audit: (req, d) => denetimler.push({ user: req.session.user.username, ...d }),
  };
}
function kurDeps() {
  T.kur(kurDepsNesnesi());
}

beforeEach(() => {
  T._secimBeklemeSifirlaForTest();
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
  launchEk = null;
  parcaDeger = 10;
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
  await assert.rejects(T.olustur(istek(), [tum()[0], tum()[0]]), (e) => e.status === 400 && /iki kez/.test(e.message));
  await assert.rejects(T.olustur(istek(), [{ host: 'APP01,APP02', gen: 7, jvm: 'ac1', eylem: 'ac' }]), (e) => e.status === 400);
  await assert.rejects(T.olustur(istek(), [{ host: 'APP01', gen: 7, jvm: 'ac1', eylem: 'tersine' }]), (e) => e.status === 400);
  assert.equal(DB.isler.length, 0, 'reddedilen istek kayit acmamali');
  let okuma = 0;
  const asil = A;
  T.kur({ ...kurDepsNesnesi(), getAssessment: async () => ((okuma += 1), asil) });
  // aday disi (bayat) + eylemi tersine cevrilmis secim: is acilir, ikisi taze degerlendirmede DUSTU
  const secim = [...tum(), { host: 'BAYAT01', gen: 7, jvm: 'ac9', eylem: 'ac' }, { host: 'APP02', gen: 7, jvm: 'ac2', eylem: 'kapat' }];
  secim.splice(2, 1);
  const r = await T.olustur(istek(), secim);
  assert.equal(okuma, 0, 'istek taze degerlendirme OKUMAZ (yurutucude)');
  assert.deepEqual([r.adet, r.hostSayisi, r.dogrulaniyor], [5, 4, true]);
  assert.equal(DB.isler[0].durum, 'PLANLANIYOR');
  assert.equal(DB.isler[0].kira_id, T.SUREC_ID, 'olusturan surec kirayi almali');
  assert.deepEqual(new Set(DB.ogeler.map((o) => o.durum)), new Set([T.SECIM]));
  assert.deepEqual(denetimler.map((d) => d.op), ['toplu_autostart_olustur']);
  assert.deepEqual(denetimler[0].hostlar, ['APP01', 'APP03', 'BAYAT01', 'APP02']);
  await assert.rejects(T.olustur(istek('mehmet'), tum().slice(0, 1)), (e) => e.status === 409);
  // filtreli tekil indeks (UX_shti_aktif) olmasa da uc aktif isi okuyup reddeder (iki katman)
  DB.uxYok = true;
  await assert.rejects(T.olustur(istek('mehmet'), tum().slice(0, 1)), (e) => e.status === 409 && /hâlâ aktif/.test(e.message));
  DB.uxYok = false;
  assert.equal(DB.isler.length, 1);
  assert.equal(launchlar.length, 0, 'olusturma is BASLATMAZ (plan yurutucude)');
  await T.tick();
  assert.equal(okuma, 1);
  const o = (jvm) => DB.ogeler.find((x) => x.jvm === jvm);
  assert.equal(o('ac9').durum, 'DUSTU');
  assert.match(o('ac9').neden, /^seçim doğrulamasında düştü: artık aday değil \(.*bayat/);
  assert.equal(o('ac2').durum, 'DUSTU', 'istemci eylemi tersine ceviremez');
  assert.match(o('ac2').neden, /artık aday değil \(eylem değişti\)/);
  assert.deepEqual(['ac1', 'kapat1', 'kapat3'].map((j) => o(j).durum), ['PLANLANIYOR', 'PLANLANIYOR', 'PLANLANIYOR']);
  assert.deepEqual([o('ac1').env, o('ac1').tarama_degeri, o('ac1').calisiyor], ['Test', 'false', 1], 'taze degerler dogrulamada yazilir');
  assert.deepEqual(launchlar.map((l) => l.ev.target_host).sort(), ['APP01', 'APP03'], 'dusenlerin sunucusu planlanmaz');
});

test('TA2c taze degerlendirme okunamazsa yeniden denenir; 10 dk sonra DUSTU + PLAN_HATA; kendi SECIM i kilitlemez', async () => {
  let dus = 'Timeout: Request failed to complete in 30000ms';
  let okuma = 0;
  T.kur({
    ...kurDepsNesnesi(),
    getAssessment: async () => {
      okuma += 1;
      if (dus === 'BOZUK') return { get hosts() { throw new TypeError('bozuk degerlendirme'); } };
      if (dus) throw new Error(dus);
      return A;
    },
  });
  const uyari = console.warn;
  console.warn = () => {};
  try {
    const r = await T.olustur(istek(), tum());
    assert.match(await T.topluKilidi('APP01', 7, 'ac1'), /\(SECIM\)/, 'SECIM ogesi tek satir dugmesini kilitler');
    assert.equal(await T.topluKilidi('APP01', 7, 'ac1', { haricIs: r.id }), null);
    await T.tick();
    assert.equal(DB.isler[0].durum, 'PLANLANIYOR');
    assert.match(DB.isler[0].hata, /Taze değerlendirme okunamadı \(Timeout.*yeniden deneniyor/);
    assert.ok(DB.ogeler.every((o) => o.durum === T.SECIM));
    dus = null;
    await T.tick();
    assert.equal(okuma, 1, 'SECIM_YENIDEN_MS dolmadan yeniden okuma yok');
    T._secimBeklemeSifirlaForTest();
    await T.tick();
    assert.equal(DB.isler[0].hata, null);
    assert.equal(launchlar.length, 3);
    DB.isler.length = 0;
    DB.ogeler.length = 0;
    dus = 'MSSQL bağlantısı yok';
    await T.olustur(istek(), tum());
    DB.isler[0].created_at = new Date(Date.now() - T.SECIM_ZAMAN_ASIMI_MS - 1000);
    await T.tick();
    assert.ok(DB.ogeler.every((o) => o.durum === 'DUSTU' && /^seçim doğrulanamadı: .*MSSQL/.test(o.neden)));
    assert.equal(DB.isler[0].durum, 'PLAN_HATA');
    assert.equal(launchlar.length, 3);
    // beklenmeyen hata (turetme TypeError): is sonsuza dek PLANLANIYOR kalmaz
    DB.isler.length = 0;
    DB.ogeler.length = 0;
    T._secimBeklemeSifirlaForTest();
    dus = 'BOZUK';
    await T.olustur(istek(), tum());
    await T.tick();
    assert.equal(DB.isler[0].durum, 'PLANLANIYOR');
    assert.match(DB.isler[0].hata, /^Seçim doğrulaması hata verdi \(bozuk degerlendirme\) — yeniden deneniyor/);
    T._secimBeklemeSifirlaForTest();
    DB.isler[0].created_at = new Date(Date.now() - T.SECIM_ZAMAN_ASIMI_MS - 1000);
    await T.tick();
    assert.ok(DB.ogeler.every((o) => o.durum === 'DUSTU' && /Seçim doğrulaması hata verdi/.test(o.neden)));
    assert.equal(DB.isler[0].durum, 'PLAN_HATA');
    assert.equal(launchlar.length, 3);
  } finally {
    console.warn = uyari;
  }
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
  assert.match(await T.topluKilidi('app01', 7, 'AC1'), new RegExp(`#${r.id} içinde \\(SECIM\\)`));
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
    assert.equal(ad.body.isBasinaJvm, 50, 'AWX isi basina JVM ayari yanitta');
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
    // 5xx: POST 424 + upstreamStatus (nginx 500 govdesini yutar), loglanir; GET 5xx eskisi gibi
    const hatalar = [];
    const err = console.error;
    console.error = (...x) => hatalar.push(x.join(' '));
    DB.dus = 'Timeout: Request failed to complete in 30000ms';
    try {
      const h5 = await post('/toplu-autostart', { secim: tum() });
      assert.equal(h5.status, 424);
      assert.deepEqual([h5.body.upstreamStatus, h5.body.nginxRed], [500, true]);
      assert.match(h5.body.message, /Timeout/);
      assert.equal((await fetch(`${kok}/toplu-autostart`).then(J)).status, 500);
    } finally {
      DB.dus = null;
      console.error = err;
    }
    assert.ok(hatalar.some((x) => x.startsWith('[TopluAutoStart] POST /api/server-hub/toplu-autostart 500:')), hatalar.join(' | '));
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
  // 2026-11-15 (parcalama): sonucu belirsiz parca toplu isi DURDURUR; bekleyen JVM calistirilmaz.
  const k3 = DB.ogeler.find((x) => x.jvm === 'kapat3');
  assert.equal(k3.durum, 'YARIM_KALDI');
  assert.match(k3.neden, /^çalıştırılmadı: toplu iş durduruldu — APP02 parçasının iş numarası yazılamadı/);
  assert.ok(denetimler.some((d) => d.op === 'toplu_autostart_durduruldu'));
  await T.tick();
  assert.equal(launchlar.filter((l) => l.ev.plan_only === false).length, 0, 'durdurulan toplu is yeni AWX isi acmamali');
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

// ── PARCALAMA (2026-11-15): AWX isi basina en cok limit:toplu_is_basina_jvm JVM ─────────────────
// Kullanici: "toplu auto start duzeltme job'inda 15 dakika timeout var, ancak ben 300 kusur JVM secmisim".
const buyukHost = (ad, n) => host(ad, Array.from({ length: n }, (_, i) => J(`j${String(i).padStart(2, '0')}`, { running: true })));
const buyukSecim = (ad, n) => Array.from({ length: n }, (_, i) => ({ host: ad, gen: 7, jvm: `j${String(i).padStart(2, '0')}`, eylem: 'ac' }));
const planIsleri = () => launchlar.filter((l) => l.ev.plan_only === true);
const uygulamaIsleri = () => launchlar.filter((l) => l.ev.plan_only === false);
/** Sonucu yazilmamis isleri bitirir (plan: PLAN, uygulama: OK). */
function bitir(liste) {
  for (const l of liste)
    if (!AWX.has(l.jobId))
      AWX.set(l.jobId, sonuc('jboss_autostart_items', l.ev.jvm_items.map((x) => ({ ...x, line: satir(x.action, l.ev.plan_only ? 'PLAN' : 'OK', `${x.jvm} tamam`) })), l.ev.plan_only));
}
async function buyukPlanla(secim) {
  const r = await T.olustur(istek(), secim);
  for (let i = 0; i < 10 && DB.isler[0].durum === 'PLANLANIYOR'; i += 1) {
    await T.tick();
    bitir(planIsleri());
  }
  return r.id;
}

test('TA15 parcalama: 35 JVM tek host + karisik hostlar, N=10 -> 4 plan isi (ayni anda en cok 5 IS, hostta 1), uygulamada 4 SIRALI is', async () => {
  A.hosts.push(buyukHost('BUYUK01', 35), buyukHost('KUCUK01', 2), buyukHost('KUCUK02', 2), buyukHost('KUCUK03', 2));
  const secim = [
    ...buyukSecim('BUYUK01', 35),
    { host: 'APP02', gen: 7, jvm: 'ac2', eylem: 'ac' },
    { host: 'APP03', gen: 8, jvm: 'kapat3', eylem: 'kapat' },
    ...buyukSecim('KUCUK01', 2),
    ...buyukSecim('KUCUK02', 2),
    ...buyukSecim('KUCUK03', 2),
  ];
  const r = await T.olustur(istek(), secim);
  await T.tick();
  // 9 parca (BUYUK01: 10+10+10+5, APP02, APP03, KUCUK01..03); ayni anda en cok PLAN_PARALEL (5) AWX isi,
  // ayni hostta en cok PLAN_HOST_PARALEL (1): BUYUK01'in ikinci parcasi ilki bitmeden acilmaz (inceleme B4).
  assert.equal(T.PLAN_HOST_PARALEL, 1);
  assert.equal(planIsleri().length, T.PLAN_PARALEL);
  assert.deepEqual(planIsleri().map((l) => l.ev.target_host), ['BUYUK01', 'APP02', 'APP03', 'KUCUK01', 'KUCUK02']);
  assert.equal(planIsleri()[0].ev.jvm_items.length, 10);
  assert.match(planIsleri()[0].ad, /plan @ BUYUK01 \(10 JVM\)/);
  await T.tick();
  assert.equal(planIsleri().length, 5, 'suren 5 is varken yeni plan isi acilmaz');
  const surenler = () => planIsleri().filter((l) => !AWX.has(l.jobId));
  for (let i = 0; i < 20 && DB.isler[0].durum === 'PLANLANIYOR'; i += 1) {
    // her turda en eski suren isi bitir, bir tick; hicbir anda ayni hostta iki plan isi / 5'ten fazla is yok
    bitir(surenler().slice(0, 1));
    await T.tick();
    const s = surenler();
    assert.ok(s.length <= T.PLAN_PARALEL, 'ayni anda 5ten fazla plan isi');
    assert.equal(new Set(s.map((l) => l.ev.target_host)).size, s.length, 'ayni hostta ayni anda iki plan isi');
  }
  const buyuk = planIsleri().filter((l) => l.ev.target_host === 'BUYUK01');
  assert.deepEqual(buyuk.map((l) => l.ev.jvm_items.length), [10, 10, 10, 5], 'BUYUK01 4 plan isine bolunmeli');
  assert.equal(new Set(buyuk.flatMap((l) => l.ev.jvm_items.map((x) => x.jvm))).size, 35, 'her JVM tek parcada');
  for (const l of buyuk) {
    const ogeIs = DB.ogeler.filter((o) => l.ev.jvm_items.some((x) => x.jvm === o.jvm) && o.host === 'BUYUK01').map((o) => o.plan_job_id);
    assert.deepEqual([...new Set(ogeIs)], [l.jobId], 'parcanin ogeleri ayni plan is numarasini tasimali');
  }
  assert.equal(planIsleri().length, 9);
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR');
  assert.equal(DB.isler[0].plan_gecti, 43);
  await T.onayla(istek('mehmet'), r.id);
  // UYGULAMA: ayni anda TEK is; BUYUK01'in 4 parcasi sirayla, sonra diger hostlar
  const sira = [];
  for (let i = 0; i < 30 && DB.isler[0].durum === 'CALISIYOR'; i += 1) {
    const once = uygulamaIsleri().length;
    await T.tick();
    const yeni = uygulamaIsleri().slice(once);
    assert.ok(yeni.length <= 1, 'bir tick en cok bir uygulama isi acar');
    if (yeni.length) {
      const u = yeni[0];
      sira.push(`${u.ev.target_host}:${u.ev.jvm_items.length}`);
      // acildigi anda baska hicbir oge BASLATILIYOR / CALISIYOR degil
      const calisanlar = DB.ogeler.filter((o) => o.durum === 'CALISIYOR' && o.awx_job_id !== u.jobId);
      assert.equal(calisanlar.length, 0, 'onceki is terminal olmadan yeni parca acildi');
      assert.equal(katman.surenIs(u.ev.target_host, u.ev.jvm_items[0].gen, u.ev.jvm_items[0].jvm).jobId, u.jobId, 'dogrulama katmanina parca isi kaydedilmedi');
      // ikinci tick: is bitmedi -> yeni is yok
      await T.tick();
      assert.equal(uygulamaIsleri().length, once + 1, 'is bitmeden ayni hostun sonraki parcasi acildi');
      bitir([u]);
    }
  }
  assert.deepEqual(sira, ['BUYUK01:10', 'BUYUK01:10', 'BUYUK01:10', 'BUYUK01:5', 'APP02:1', 'APP03:1', 'KUCUK01:2', 'KUCUK02:2', 'KUCUK03:2']);
  assert.equal(DB.isler[0].durum, 'BITTI');
  assert.equal(DB.isler[0].ok_sayisi, 43);
  assert.ok(DB.ogeler.every((o) => o.durum === 'OK' && o.dogrulandi === 1), 'her parcanin set_stats sonucu kendi ogelerine yazilmali');
  assert.equal(new Set(DB.ogeler.filter((o) => o.host === 'BUYUK01').map((o) => o.awx_job_id)).size, 4);
});

test('TA16 parca boyutu Admin ayarindan (toplu_is_basina_jvm); gecersizse varsayilan 10', async () => {
  A.hosts.push(buyukHost('BUYUK01', 7));
  parcaDeger = 3;
  await buyukPlanla(buyukSecim('BUYUK01', 7));
  assert.deepEqual(planIsleri().map((l) => l.ev.jvm_items.length), [3, 3, 1]);
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  launchlar.length = 0;
  AWX.clear();
  katman = AS.kur();
  parcaDeger = undefined;
  A.hosts.push(buyukHost('BUYUK02', 12));
  await buyukPlanla(buyukSecim('BUYUK02', 12));
  assert.deepEqual(planIsleri().map((l) => l.ev.jvm_items.length), [T.IS_BASINA_JVM_VARSAYILAN, 2]);
  assert.equal(T.IS_BASINA_JVM_VARSAYILAN, 10);
  assert.deepEqual(T.parcala([{ host: 'A' }, { host: 'B' }, { host: 'A' }, { host: 'A' }], 2).map((p) => `${p.host}:${p.liste.length}`), ['A:2', 'A:1', 'B:1']);
  // uygulamada da ayni ayar
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  launchlar.length = 0;
  AWX.clear();
  katman = AS.kur();
  parcaDeger = 4;
  const id = await buyukPlanla(buyukSecim('BUYUK01', 7));
  await T.onayla(istek(), id);
  await T.tick();
  assert.deepEqual(uygulamaIsleri().map((l) => l.ev.jvm_items.length), [4]);
  bitir(uygulamaIsleri());
  await T.tick();
  assert.deepEqual(uygulamaIsleri().map((l) => l.ev.jvm_items.length), [4, 3]);
});

test('TA17 parcalar arasinda iptal: suren parca biter, ayni hostun kalan parcalari IPTAL, yeni is yok', async () => {
  A.hosts.push(buyukHost('BUYUK01', 25));
  const id = await buyukPlanla(buyukSecim('BUYUK01', 25));
  await T.onayla(istek(), id);
  await T.tick();
  assert.equal(uygulamaIsleri().length, 1);
  bitir(uygulamaIsleri());
  await T.tick();
  assert.equal(uygulamaIsleri().length, 2, 'ikinci parca basladi');
  await T.iptal(istek('ali'), id);
  const say = (d) => DB.ogeler.filter((o) => o.durum === d).length;
  assert.deepEqual([say('OK'), say('CALISIYOR'), say('IPTAL')], [10, 10, 5]);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'IPTAL_ISTENDI');
  bitir(uygulamaIsleri());
  await T.tick();
  assert.equal(DB.isler[0].durum, 'IPTAL');
  assert.deepEqual([say('OK'), say('IPTAL')], [20, 5], 'suren parcanin sonucu yazilmali');
  assert.equal(uygulamaIsleri().length, 2, 'iptalden sonra yeni parca acildi');
});

test('TA18 sonucu belirsiz parca toplu isi DURDURUR (launchBelirsiz, 3 saat); kesin red durdurmaz', async () => {
  A.hosts.push(buyukHost('BUYUK01', 25));
  let id = await buyukPlanla(buyukSecim('BUYUK01', 25));
  await T.onayla(istek(), id);
  await T.tick();
  bitir(uygulamaIsleri());
  // ikinci parca: launch istegi belirsiz hatayla doner (AWX'te olusmus olabilir)
  launchHata = 'socket hang up';
  launchEk = { launchBelirsiz: true };
  await T.tick();
  launchHata = null;
  launchEk = null;
  const d = (j) => DB.ogeler.find((o) => o.jvm === j);
  assert.equal(d('j10').durum, 'YARIM_KALDI');
  assert.match(d('j10').neden, /belirsiz hatayla döndü \(AWX'e gitmiş olabilir, sonucu belirsiz\): socket hang up/);
  assert.equal(d('j20').durum, 'YARIM_KALDI');
  assert.match(d('j20').neden, /^çalıştırılmadı: toplu iş durduruldu — BUYUK01 parçasının iş isteği belirsiz/);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI');
  await T.tick();
  assert.equal(uygulamaIsleri().length, 1, 'belirsiz parcadan sonra yeni is acildi');
  assert.ok(denetimler.some((x) => x.op === 'toplu_autostart_durduruldu' && x.adet === 5));

  // kesin red (4xx, launchBelirsiz yok): parca FAIL, ayni hostun sonraki parcasi yine baslar
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  launchlar.length = 0;
  AWX.clear();
  katman = AS.kur();
  id = await buyukPlanla(buyukSecim('BUYUK01', 25));
  await T.onayla(istek(), id);
  launchHata = 'sablon reddetti';
  launchEk = { status: 400 };
  await T.tick();
  launchHata = null;
  launchEk = null;
  assert.equal(d('j00').durum, 'FAIL');
  assert.match(d('j00').neden, /iş başlatılamadı: sablon reddetti/);
  await T.tick();
  assert.deepEqual(uygulamaIsleri().map((l) => l.ev.jvm_items[0].jvm), ['j10'], 'kesin red toplu isi durdurmamali');

  // 3 saatte bitmeyen parca: FAIL + toplu is durur
  const calisan = DB.ogeler.filter((o) => o.durum === 'CALISIYOR');
  for (const o of calisan) o.baslama_at = new Date(Date.now() - 3 * 60 * 60 * 1000 - 1000);
  await T.tick();
  assert.ok(calisan.every((o) => o.durum === 'FAIL' && /3 saatte bitmedi/.test(o.neden)));
  assert.equal(d('j20').durum, 'YARIM_KALDI');
  assert.match(d('j20').neden, /toplu iş durduruldu — BUYUK01 işi #\d+ 3 saatte bitmedi/);
  assert.equal(uygulamaIsleri().length, 1);
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI');
});

test('TA18b is numarasi yazilamayan parca (BASLATILIYOR takili) 10 dk sonra YARIM_KALDI ve toplu isi durdurur', async () => {
  A.hosts.push(buyukHost('BUYUK01', 15));
  const id = await buyukPlanla(buyukSecim('BUYUK01', 15));
  await T.onayla(istek(), id);
  for (const o of DB.ogeler.slice(0, 10)) Object.assign(o, { durum: 'BASLATILIYOR', baslama_at: new Date(Date.now() - 60 * 1000) });
  await T.tick();
  assert.equal(uygulamaIsleri().length, 0, 'takili parca varken yeni parca acilmaz');
  for (const o of DB.ogeler.slice(0, 10)) o.baslama_at = new Date(Date.now() - 11 * 60 * 1000);
  await T.tick();
  assert.ok(DB.ogeler.slice(0, 10).every((o) => o.durum === 'YARIM_KALDI' && /iş numarası yazılamadı/.test(o.neden)));
  assert.ok(DB.ogeler.slice(10).every((o) => o.durum === 'YARIM_KALDI' && /toplu iş durduruldu/.test(o.neden)));
  assert.equal(uygulamaIsleri().length, 0);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI');
});

test('TA19 parca ortasinda kira kaybi: is YARIM_KALDI, suren parca yalniz izlenir, kalan parcalar calistirilmaz', async () => {
  A.hosts.push(buyukHost('BUYUK01', 25));
  const id = await buyukPlanla(buyukSecim('BUYUK01', 25));
  await T.onayla(istek(), id);
  await T.tick();
  const u1 = uygulamaIsleri()[0];
  const is = DB.isler[0];
  is.kira_id = 'eski-surec';
  is.kira_bitis = new Date(Date.now() - 1000);
  await T.tick();
  assert.equal(is.durum, 'YARIM_KALDI');
  const say = (d) => DB.ogeler.filter((o) => o.durum === d).length;
  assert.deepEqual([say('CALISIYOR'), say('YARIM_KALDI')], [10, 15]);
  assert.ok(DB.ogeler.filter((o) => o.durum === 'YARIM_KALDI').every((o) => /çalıştırılmadı/.test(o.neden)));
  bitir([u1]);
  await T.tick();
  assert.deepEqual([say('OK'), say('YARIM_KALDI')], [10, 15], 'suren parcanin sonucu izlenip yazilmali');
  await T.tick();
  assert.equal(uygulamaIsleri().length, 1, 'kira kaybindan sonra yeni parca acildi');
  // plan fazinda kira kaybi: iki parca PLANLANIYOR -> YARIM_KALDI, launch yok
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  launchlar.length = 0;
  AWX.clear();
  katman = AS.kur();
  await T.olustur(istek(), buyukSecim('BUYUK01', 25));
  await T.tick();
  // hostta ayni anda tek plan isi (PLAN_HOST_PARALEL): 3 parcanin yalniz ilki acik
  assert.equal(planIsleri().length, 1);
  DB.isler[0].kira_id = 'eski-surec';
  DB.isler[0].kira_bitis = new Date(Date.now() - 1000);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'YARIM_KALDI');
  assert.ok(DB.ogeler.every((o) => o.durum === 'YARIM_KALDI'));
  assert.equal(planIsleri().length, 1);
});

test('TA20 sonucu belirsiz oge JVM i kilitler (AWX isi bitene kadar); calistirilmayan kilitlemez; yeni toplu iste duser', async () => {
  // inceleme 2026-11-15 B1 (X1): 25 JVM, N=10, ikinci parcanin launch istegi belirsiz -> j10..j19 YARIM_KALDI
  A.hosts.push(buyukHost('BUYUK01', 25));
  const id = await buyukPlanla(buyukSecim('BUYUK01', 25));
  await T.onayla(istek(), id);
  await T.tick();
  bitir(uygulamaIsleri());
  launchHata = 'socket hang up';
  launchEk = { launchBelirsiz: true };
  await T.tick();
  launchHata = null;
  launchEk = null;
  await T.tick();
  const d = (j) => DB.ogeler.find((o) => o.jvm === j && o.is_id === id);
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI');
  assert.match(d('j10').neden, new RegExp(T.BELIRSIZ_IZ));
  assert.doesNotMatch(d('j20').neden, new RegExp(T.BELIRSIZ_IZ), 'calistirilmayan oge belirsiz izi tasimamali');
  assert.match(await T.topluKilidi('BUYUK01', 7, 'j10'), new RegExp(`#${id} öğesinin sonucu bilinmiyor \\(iş numarası yok`));
  assert.match(await T.topluKilidi('buyuk01', 7, 'J19'), /sonucu bilinmiyor/);
  assert.equal(await T.topluKilidi('BUYUK01', 7, 'j20'), null, 'calistirilmadi YARIM_KALDI kilitlemez');
  assert.equal(await T.topluKilidi('BUYUK01', 7, 'j00'), null, 'OK oge kilitlemez');
  // yeni toplu is ayni JVM'leri secerse: belirsiz olan secim dogrulamasinda DUSER, digerleri plana gider
  const once = uygulamaIsleri().length;
  const r2 = await T.olustur(istek(), buyukSecim('BUYUK01', 25).filter((x) => ['j10', 'j11', 'j20'].includes(x.jvm)));
  await T.tick();
  const d2 = (j) => DB.ogeler.find((o) => o.jvm === j && o.is_id === r2.id);
  assert.equal(d2('j10').durum, 'DUSTU');
  assert.match(d2('j10').neden, /seçim doğrulamasında düştü: .*sonucu bilinmiyor/);
  assert.equal(d2('j11').durum, 'DUSTU');
  assert.equal(d2('j20').durum, 'PLANLANIYOR');
  assert.deepEqual(planIsleri().at(-1).ev.jvm_items.map((x) => x.jvm), ['j20'], 'belirsiz JVM plan isine girmemeli');
  assert.equal(uygulamaIsleri().length, once);
  // is numarasi yok: baslamasindan IS_ZAMAN_ASIMI (3 saat) sonra kilit kalkar
  d('j10').baslama_at = new Date(Date.now() - 3 * 60 * 60 * 1000 - 1000);
  assert.equal(await T.topluKilidi('BUYUK01', 7, 'j10'), null);
  assert.match(await T.topluKilidi('BUYUK01', 7, 'j11'), /sonucu bilinmiyor/);
  // is numarali belirsiz (3 saatte bitmedi): AWX isi terminal olana kadar kilitli; pencere (6 saat) sonra kalkar
  Object.assign(d('j11'), { durum: 'FAIL', awx_server_id: 1, awx_job_id: 777, neden: `iş #777 3 saatte bitmedi (${T.BELIRSIZ_IZ}) — x` });
  assert.match(await T.topluKilidi('BUYUK01', 7, 'j11'), /AWX işi #777 henüz bitmedi/);
  AWX.set(777, { status: 'failed', artifacts: {} });
  assert.equal(await T.topluKilidi('BUYUK01', 7, 'j11'), null, 'AWX isi bitince kilit kalkar');
  AWX.delete(777);
  d('j11').bitis_at = new Date(Date.now() - 7 * 60 * 60 * 1000);
  assert.equal(await T.topluKilidi('BUYUK01', 7, 'j11'), null, 'pencere disi kayit kilitlemez');
  DB.dus = 'baglanti yok';
  assert.equal(await T.topluKilidi('BUYUK01', 7, 'j12'), null, 'DB okunamazsa tek satir yolu kilitlenmez (eski kural)');
  DB.dus = null;
});

test('TA20b 3 saatte bitmeyen parca ve kira kaybinda is numarasiz BASLATILIYOR da belirsiz izi tasir (kilit)', async () => {
  A.hosts.push(buyukHost('BUYUK01', 15));
  let id = await buyukPlanla(buyukSecim('BUYUK01', 15));
  await T.onayla(istek(), id);
  await T.tick();
  const calisan = DB.ogeler.filter((o) => o.durum === 'CALISIYOR');
  for (const o of calisan) o.baslama_at = new Date(Date.now() - 3 * 60 * 60 * 1000 - 1000);
  await T.tick();
  assert.ok(calisan.length === 10 && calisan.every((o) => o.durum === 'FAIL' && o.neden.includes(T.BELIRSIZ_IZ)));
  assert.match(await T.topluKilidi('BUYUK01', 7, 'j00'), /AWX işi #\d+ henüz bitmedi/);
  // takili BASLATILIYOR (is numarasi yazilamadi) -> YARIM_KALDI + iz
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  launchlar.length = 0;
  AWX.clear();
  katman = AS.kur();
  id = await buyukPlanla(buyukSecim('BUYUK01', 15));
  await T.onayla(istek(), id);
  for (const o of DB.ogeler.slice(0, 10)) Object.assign(o, { durum: 'BASLATILIYOR', baslama_at: new Date(Date.now() - 11 * 60 * 1000) });
  await T.tick();
  assert.ok(DB.ogeler.slice(0, 10).every((o) => o.durum === 'YARIM_KALDI' && o.neden.includes(T.BELIRSIZ_IZ)));
  assert.match(await T.topluKilidi('BUYUK01', 7, 'j00'), /sonucu bilinmiyor/);
  assert.equal(await T.topluKilidi('BUYUK01', 7, 'j10'), null);
  // kira kaybi: is numarasiz BASLATILIYOR -> YARIM_KALDI + iz; baslamamislar izsiz
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  launchlar.length = 0;
  AWX.clear();
  katman = AS.kur();
  id = await buyukPlanla(buyukSecim('BUYUK01', 15));
  await T.onayla(istek(), id);
  Object.assign(DB.ogeler[0], { durum: 'BASLATILIYOR', baslama_at: new Date() });
  DB.isler[0].kira_id = 'eski-surec';
  DB.isler[0].kira_bitis = new Date(Date.now() - 1000);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'YARIM_KALDI');
  assert.ok(DB.ogeler[0].neden.includes(T.BELIRSIZ_IZ));
  assert.match(await T.topluKilidi('BUYUK01', 7, 'j00'), /sonucu bilinmiyor/);
  assert.equal(await T.topluKilidi('BUYUK01', 7, 'j01'), null);
});

test('TA21 secim sirasi hostlari karistirsa da uygulama bir hostun tum parcalarini bitirip sonraki hosta gecer', async () => {
  // inceleme 2026-11-15 B2 (X2): N=1, secim [HA, HB, HA, HB, HA, HB]
  A.hosts.push(buyukHost('HA', 3), buyukHost('HB', 3));
  parcaDeger = 1;
  const a = buyukSecim('HA', 3);
  const b = buyukSecim('HB', 3);
  const id = await buyukPlanla([a[0], b[0], a[1], b[1], a[2], b[2]]);
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR');
  await T.onayla(istek(), id);
  for (let i = 0; i < 20 && DB.isler[0].durum === 'CALISIYOR'; i += 1) {
    await T.tick();
    bitir(uygulamaIsleri());
  }
  assert.deepEqual(uygulamaIsleri().map((l) => `${l.ev.target_host}:${l.ev.jvm_items[0].jvm}`), ['HA:j00', 'HA:j01', 'HA:j02', 'HB:j00', 'HB:j01', 'HB:j02']);
  assert.equal(DB.isler[0].durum, 'BITTI');
});
