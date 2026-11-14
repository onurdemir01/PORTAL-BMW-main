// server/server-hub/__tests__/toplu-restart.test.cjs - Toplu Restart (2026-11-14, JVM_PARAM_FARKI) davranisi.
//
// Kullanici: "JVM parametreleri calisan surectekinden FARKLI uyarilari ... bunlar icin de toplu restart et sayfasi".
// Guvenlik modeli (toplu-restart.cjs basligi):
//   TR1 adaylar: yalniz taze + sema bilinen + calisan (olculmus) + argFark 1 + envanterde + prod / ortam bilinmiyor /
//       standalone degil; digerleri nedeniyle disarida ("OpsX'ten tek tek"); fark maskeli, anahtarlar cikar
//   TR2 olustur: limit 400, aday disi 400, cift 400, aktif 409, kilit 409; ogeler ADAY, kopyalar ardisik degil,
//       ek'te onceki loaded_at / surec baslangici; denetim
//   TR3 onizleme: TEK server_hub_scan isi (secilen sunucular); yukleme kaniti (hosts / excluded / loaded_at ilerledi);
//       durmus / fark kalmadi / fark degisti / envanterde yok -> dustu; gecenler PLAN_GECTI; is PLAN_HAZIR
//   TR4 onay: 15 dk'dan eski -> PLAN_ESKIDI; sablon limit'i kabul etmiyorsa onay YOK; onay -> CALISIYOR + BEKLIYOR
//   TR5 tek tek: bir tick'te tek restart; suren restart varken yenisi yok; STARTED -> tek sunucu dogrulama taramasi;
//       tarama yuklendi + surec yeni + fark 0 -> KAPANDI, fark 1 -> KAPANMADI (yanlis uyari notu); sonra siradaki
//   TR6 basarisizlik: NOT_STARTED -> FAIL, ayni uygulamanin bekleyen kopyalari ATLANDI, digerleri devam;
//       BITTI_HATALI + bitis denetimi
//   TR7 kanit: surec baslangici degismedi -> FAIL; set_stats yok + is basarili + surec yeni -> KAPANDI;
//       set_stats yok + is dustu -> FAIL; tarama sunucuyu yuklemedi -> FAIL
//   TR8 OpsX reddi: uretim -> ATLANDI; sablon limit'i -> FAIL + kalanlar ATLANDI; kilit -> ATLANDI
//   TR9 iptal: suren JVM biter (restart + tarama), bekleyenler IPTAL, yeni restart yok, is IPTAL
//   TR10 yeniden baslatma: kirasi dusmus is YARIM_KALDI, suren oge is numarasiyla YARIM_KALDI, launch YOK;
//        kirasi canli baska surecin isine dokunulmaz
//   TR11 kilit / yardimcilar: topluKilidi; farkOzeti maskeler; yuklemeKaniti; siraKarisik
//   TR12 HTTP: uclar router uzerinden
//   TR14 belirsiz launch (AWX'e gitmis olabilir): oge YARIM_KALDI, 'dokunulmadi' DENMEZ, toplu is durur (kopya dahil
//        siradaki baslamaz), JVM kilitli; kesin ret (4xx) FAIL 'dokunulmadi' + devam
//   TR15 takili BASLATILIYOR (is numarasi yazilamadi): YARIM_KALDI + toplu is durur
//   TR16 Portal restart surerken yeniden basladi: YARIM_KALDI oge AWX isi bitene kadar kilitli; yeni toplu iste
//        kopyasi ATLANDI, baska JVM BEKLER, AWX bitince baslar
//   TR17 restart 45 dk'da bitmedi: FAIL + toplu is durur (onceki is surerken siradaki baslamaz)
//   TR18 STARTED ama durdurma kaniti yok (NOT_STOPPED + KILL_COKLU): FAIL 'durdurulamadi', kopyalar ATLANDI,
//        tarama yok; NOT_STOPPED + KILL_OK -> dogrulama taramasi
//   TR19 onaylanmayan PLAN_HAZIR: 15 dk icinde dokunulmaz (kira dusse de YARIM_KALDI olmaz); sonra PLAN_ESKIDI,
//        ogeler IPTAL, kilit kalkar
//   TR20 ad kurali: envanter TEST + ad prod (ortam harfi P) -> 'OpsX'ten tek tek'
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

// ── SAHTE DB (toplu-autostart.test.cjs ile ayni yorumlayici; RESTART ogesi 10 kolon + ek) ─────────────
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

function bol(s, ayirici) {
  const out = [];
  let d = 0;
  let bas = 0;
  let tirnak = false;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "'") tirnak = !tirnak;
    if (tirnak) continue;
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
    dusen: n((o) => o.durum === 'DUSTU' || o.durum === 'ATLANDI'),
    ok_sayisi: n((o) => o.durum === 'KAPANDI'),
    skip_sayisi: n((o) => o.durum === 'KAPANMADI'),
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
  if (/^SELECT o\.id, o\.is_id, o\.host, o\.gen, o\.jvm, o\.ek, o\.awx_server_id, o\.awx_job_id, o\.baslama_at FROM server_hub_toplu_ogeler o JOIN/.test(q)) {
    // yetimRestartlar: durum YARIM_KALDI|FAIL, neden LIKE %iz%, bitis_at > simdi - N saat
    const saat = Number(/DATEADD\(hour, -(\d+), SYSUTCDATETIME\(\)\)/.exec(q)[1]);
    assert.match(q, /o\.durum IN \('YARIM_KALDI', 'FAIL'\) AND o\.neden LIKE \$2/);
    const iz = String(p[1]).replace(/^%|%$/g, '');
    const sinir = simdi().getTime() - saat * 3600 * 1000;
    return {
      rows: DB.ogeler
        .filter((o) => {
          const i = DB.isler.find((x) => x.id === o.is_id);
          return i && i.tur === p[0] && ['YARIM_KALDI', 'FAIL'].includes(o.durum) && String(o.neden || '').includes(iz) && o.bitis_at && +o.bitis_at > sinir;
        })
        .map((o) => ({ ...o })),
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
  if (/^INSERT INTO server_hub_toplu_ogeler \(is_id, sira, host, env, gen, jvm, eylem, calisiyor, tarama_scan_date, ek, durum\)/.test(q)) {
    const n = (q.match(/'ADAY'\)/g) || []).length;
    for (let i = 0; i < n; i += 1) {
      const x = p.slice(i * 10, i * 10 + 10);
      DB.sira += 1;
      DB.ogeler.push({
        id: DB.sira, is_id: x[0], sira: x[1], host: x[2], env: x[3], gen: x[4], jvm: x[5], eylem: x[6], calisiyor: x[7],
        tarama_scan_date: x[8], ek: x[9], durum: 'ADAY', neden: null, plan_awx_server_id: null, plan_job_id: null,
        awx_server_id: null, awx_job_id: null, sonuc_satiri: null, dogrulandi: 0, baslama_at: null, bitis_at: null,
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

// Sahte AWX
const AWX = new Map();
stub('../../ansible/runner.cjs', {
  getJobStatusOnServer: async (_s, jobId) => AWX.get(Number(jobId)) || { status: 'running', artifacts: {} },
});

// Sahte OpsX: topluRestartBaslat cagrilarini kaydeder; envanter INV'den.
let restartlar;
let restartHata;
let limitHata;
const INV = new Map();
const OPSX = {
  extractStatsKey: (a, k) => (a && a[k] && typeof a[k] === 'object' ? a[k] : null),
  metadatahubHostMu: (h) => ['GBABAT01', 'GBABAT02', 'GBABAP01', 'GBABAP02'].some((x) => String(h || '').toUpperCase().startsWith(x)),
  hostsForApp: async (app) => INV.get(app) || [],
  legacyLimitKontrol: async () => {
    if (limitHata) throw Object.assign(new Error(limitHata), { status: 409, code: 'limit_kabul_edilmiyor' });
    return { templateId: 1, serverId: 1, keyName: 'opsx_legacy_operation' };
  },
  topluRestartBaslat: async (x) => {
    if (restartHata) {
      const h = typeof restartHata === 'function' ? restartHata(x) : restartHata;
      if (h) throw Object.assign(new Error(h.message), { status: h.status || 409, code: h.code, ...(h.belirsiz ? { launchBelirsiz: true } : {}) });
    }
    const jobId = 900 + restartlar.length;
    restartlar.push({ ...x, user: x.req.session.user.username, jobId });
    return { jobId, awxServerId: 2, status: 'pending' };
  },
};
stub('../../opsx/index.cjs', OPSX);

const T = require('../toplu-restart.cjs');
const AS = require('../autostart-dogrulama.cjs');

// ── FILO ──────────────────────────────────────────────────────────────────────────────────────────
const J = (name, ek) => ({ name, gen: 8, group: `${name}_Group`, running: true, runningKnown: true, argFark: 1, processStartEpoch: 1000, source: 'cli', cfgSrc: 'CLI', invStatus: 'running', ...ek });
const H = (ad, jvms, ek = {}) => ({ host: ad, env: 'TEST', envGroup: 'Non-Production', fresh: true, schemaUnknown: false, scanDate: '2026-11-14', loadedAt: 100, loadExcluded: false, jvms, findings: [], ...ek });
const DIFF = new Map();
let A;
function filo() {
  A = {
    hosts: [
      H('APP01', [J('crm'), J('esit', { argFark: 0 }), J('olcme', { argFark: 2 }), J('durmus', { running: false })]),
      H('APP02', [J('crm'), J('pay')]),
      H('APP03', [J('doc', { gen: 7, group: 'doc_Group' })]),
      H('APP04', [J('envyok', { invStatus: undefined })]),
      H('PRD01', [J('prod1')], { env: 'PROD', envGroup: 'Production' }),
      H('APPX05', [J('envprod')], { env: 'PROD', envGroup: 'Production' }),
      H('NEO01', [J('bilinmez')], { env: 'BILINMIYOR' }),
      H('GBABAT01', [J('meta')]),
      H('BAYAT01', [J('bayat')], { fresh: false }),
      H('SEMA01', [J('sema')], { schemaUnknown: true }),
      H('GIZ01', [J('tanimsiz', { cfgSrc: 'UNAVAILABLE' }), J('olcul', { runningKnown: false })]),
    ],
  };
  delete A.hosts[3].jvms[0].invStatus;
  DIFF.clear();
  for (const h of A.hosts) for (const j of h.jvms) DIFF.set(`${h.host}|${j.gen}|${j.name}`, '-Xmx running=2g configured=4g; -Ddb.password running=a configured=b');
  INV.clear();
  INV.set('crm', [{ host: 'APP01', kurulum: '8' }, { host: 'APP02', kurulum: '8' }]);
  INV.set('pay', [{ host: 'APP02', kurulum: '8' }]);
  INV.set('doc', [{ host: 'APP03', kurulum: '7' }]);
}
const jvmBul = (host, jvm) => A.hosts.find((h) => h.host === host).jvms.find((j) => j.name === jvm);

let katman;
let launchlar;
let denetimler;
let limitDeger;
let launchHata;
let kilitler;
let silindi;
const istek = (u = 'ayse') => ({ session: { user: { username: u, role: 'Admin' } } });

function loadJvmAgir(host) {
  const m = new Map();
  for (const [k, v] of DIFF) {
    const [h, g, j] = k.split('|');
    if (h === host) m.set(`${g}|${j.toLowerCase()}`, { gen: Number(g), jvm: j, jvm_arg_diff: v });
  }
  return Promise.resolve(m);
}
loadJvmAgir.semaOku = () => Promise.resolve({ ok: true });

function kurDeps() {
  T.kur({
    launch: async (req, key, ad, ev, detail) => {
      if (launchHata) throw Object.assign(new Error(launchHata), { status: 500 });
      const jobId = 500 + launchlar.length;
      launchlar.push({ user: req.session.user.username, key, ad, ev: JSON.parse(JSON.stringify(ev)), detail, jobId });
      return { jobId, status: 'pending', awxServerId: 1 };
    },
    getAssessment: async () => A,
    onbellekSil: () => {
      silindi += 1;
    },
    loadJvmAgir,
    autoStart: () => katman,
    ayarlar: { limit: async (ad) => (ad === 'tara' ? 50 : limitDeger) },
    HOST_RE: /^[A-Z0-9][A-Z0-9.-]{0,63}$/,
    surenIsKilidi: async (h, g, j) => kilitler.get(`${h}|${g}|${j}`) || null,
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
  restartlar = [];
  restartHata = null;
  limitHata = null;
  denetimler = [];
  limitDeger = 50;
  launchHata = null;
  kilitler = new Map();
  silindi = 0;
  filo();
  kurDeps();
});

const secimHepsi = () => [
  { host: 'APP01', gen: 8, jvm: 'crm' },
  { host: 'APP02', gen: 8, jvm: 'crm' },
  { host: 'APP02', gen: 8, jvm: 'pay' },
  { host: 'APP03', gen: 7, jvm: 'doc' },
];
const durumlar = () => Object.fromEntries(DB.ogeler.map((o) => [`${o.host}/${o.jvm}`, o.durum]));
/** Son toplu isin ogesi (onceki islerin ayni JVM ogeleri karismasin). */
const oge = (host, jvm) => DB.ogeler.filter((o) => o.host === host && o.jvm === jvm).sort((a, b) => b.is_id - a.is_id)[0];
const ek = (host, jvm) => JSON.parse(oge(host, jvm).ek || '{}');
/** Suren restart'lari STARTED + kapanan farkla bitirir; is bitene kadar ilerletir. */
async function hepsiniBitir(sinir = 20) {
  for (let i = 0; i < sinir && ['CALISIYOR', 'IPTAL_ISTENDI'].includes(DB.isler[DB.isler.length - 1].durum); i += 1) {
    const r = restartlar[restartlar.length - 1];
    if (r && !AWX.has(r.jobId)) await restartBitir('STARTED');
    else await T.tick();
  }
}
const taramaSonucu = (hosts, ek2 = {}) => ({
  status: 'successful',
  artifacts: { server_hub_scan_result: { hosts, rows: 10, loader: { rc: 0, excluded: [], ...ek2 } } },
});
const restartSonucu = (host, jvm, gen, start, status = 'successful') => ({
  status,
  artifacts: {
    opsx_serverconfig_ops_result: {
      [host]: [{ name: jvm, jbossMajor: String(gen), host_controller: 'hx01', operation: 'restart', stop_state: 'STOPPED', kill_result: '', start_state: start }],
    },
  },
});

/** Onizlemeyi tamamlar: tarama tum sunuculari yukler (loaded_at ilerler). */
async function onizle(secim = secimHepsi()) {
  const r = await T.olustur(istek(), secim);
  await T.tick();
  const l = launchlar[launchlar.length - 1];
  const hosts = l.ev.target_hosts.split(',');
  for (const h of A.hosts) if (hosts.includes(h.host)) h.loadedAt += 10;
  AWX.set(l.jobId, taramaSonucu(hosts));
  await T.tick();
  return r.id;
}
async function onayli(secim) {
  const id = await onizle(secim);
  await T.onayla(istek('mehmet'), id);
  return id;
}
/** Suren restart'i bitirir (start durumuyla) ve dogrulama taramasini yukler; JVM yeni surecle (ps) ve fark ile. */
async function restartBitir(start, { ps = 2000, fark = 0, yukle = true } = {}) {
  const r = restartlar[restartlar.length - 1];
  AWX.set(r.jobId, restartSonucu(r.host, r.jvm, r.gen, start));
  await T.tick();
  const l = launchlar[launchlar.length - 1];
  if (l && l.detail.op === 'toplu_restart_dogrulama' && !AWX.has(l.jobId)) {
    const h = A.hosts.find((x) => x.host === r.host);
    const j = jvmBul(r.host, r.jvm);
    if (yukle) h.loadedAt += 10;
    j.processStartEpoch = ps;
    j.argFark = fark;
    AWX.set(l.jobId, taramaSonucu(yukle ? [r.host] : []));
    await T.tick();
  }
}

test('TR1 adaylar: yalniz taze + calisan + fark + envanterde + prod degil; digerleri nedeniyle; fark maskeli', async () => {
  const agir = new Map();
  for (const h of A.hosts) agir.set(h.host, await loadJvmAgir(h.host));
  const { adaylar, dislananlar } = T.adaylariTuret(A, agir);
  assert.deepEqual(adaylar.map((x) => `${x.host}/${x.jvm}`), ['APP01/crm', 'APP02/crm', 'APP02/pay', 'APP03/doc']);
  const n = Object.fromEntries(dislananlar.map((x) => [x.jvm, x.neden]));
  assert.match(n.prod1, /prod — OpsX'ten tek tek/);
  assert.match(n.envprod, /prod — OpsX'ten tek tek/, 'envanter ortami PROD (ad prod gorunmese de)');
  assert.match(n.bilinmez, /ortamı bilinmiyor.*OpsX'ten tek tek/);
  assert.match(n.meta, /standalone/);
  assert.match(n.envyok, /envanterde/);
  assert.match(n.bayat, /bayat/);
  assert.match(n.sema, /şeması/);
  assert.match(n.tanimsiz, /tanım kaynağında yok/);
  for (const j of ['esit', 'olcme', 'durmus', 'olcul']) assert.ok(!(j in n) && !adaylar.some((x) => x.jvm === j), `${j} aday/dislanan olmamali`);
  const c = adaylar[0];
  assert.equal(c.grp, 'crm_Group');
  assert.deepEqual(c.anahtarlar, ['-Xmx', '-Ddb.password']);
  assert.ok(!/running=a /.test(c.fark) && /\*\*\*/.test(c.fark), `sir maskelenmedi: ${c.fark}`);
  // suren auto-start isi olan JVM dislanir
  katman.isKaydet(1, 77, { host: 'APP02', gen: 8, jvm: 'pay', action: 'jboss_autostart_on', h: A.hosts[1] });
  assert.match(T.adaylariTuret(A, agir).dislananlar.find((x) => x.jvm === 'pay').neden, /auto-start işi #77/);
  // SUNUCU ADI prod (env TEST olsa da)
  A.hosts[0].host = 'APPPROD01';
  assert.match(T.restartKapisi(A, A.hosts[0], A.hosts[0].jvms[0]), /prod/);
});

test('TR2 olustur: limit, aday disi, cift, aktif, kilit; ogeler, sira, ek, denetim', async () => {
  limitDeger = 3;
  await assert.rejects(T.olustur(istek(), secimHepsi()), (e) => e.status === 400 && /en fazla 3 JVM/.test(e.message));
  limitDeger = 50;
  await assert.rejects(T.olustur(istek(), [{ host: 'PRD01', gen: 8, jvm: 'prod1' }]), (e) => e.status === 400 && /OpsX'ten tek tek/.test(e.message));
  await assert.rejects(T.olustur(istek(), [{ host: 'APP01', gen: 8, jvm: 'crm' }, { host: 'app01', gen: 8, jvm: 'CRM' }]), (e) => e.status === 400 && /iki kez/.test(e.message));
  await assert.rejects(T.olustur(istek(), [{ host: 'APP01', gen: 9, jvm: 'crm' }]), (e) => e.status === 400);
  kilitler.set('APP02|8|pay', 'pay toplu auto-start isi #4 icinde');
  await assert.rejects(T.olustur(istek(), secimHepsi()), (e) => e.status === 409 && /auto-start/.test(e.message));
  kilitler.clear();
  const r = await T.olustur(istek(), secimHepsi());
  assert.deepEqual([r.adet, r.hostSayisi], [4, 3]);
  await assert.rejects(T.olustur(istek(), secimHepsi()), (e) => e.status === 409 && e.code === 'aktif_is');
  // UX_shti_aktif olmasa da (okuma katmani) ikinci aktif is acilmaz
  DB.uxYok = true;
  await assert.rejects(T.olustur(istek(), secimHepsi()), (e) => e.status === 409 && /hâlâ aktif/.test(e.message));
  DB.uxYok = false;
  const is = DB.isler[0];
  assert.deepEqual([is.tur, is.durum, is.olusturan, is.ust_sinir], ['RESTART', 'PLANLANIYOR', 'ayse', 50]);
  assert.equal(is.kira_id, T.SUREC_ID);
  const sira = DB.ogeler.sort((a, b) => a.sira - b.sira).map((o) => o.jvm);
  for (let i = 1; i < sira.length; i += 1) assert.notEqual(sira[i], sira[i - 1], `kopyalar ardisik: ${sira}`);
  assert.ok(DB.ogeler.every((o) => o.durum === 'ADAY' && o.eylem === 'restart'));
  assert.deepEqual([ek('APP01', 'crm').loadedAt, ek('APP01', 'crm').processStart, ek('APP01', 'crm').grp], [100, 1000, 'crm_Group']);
  assert.ok(!/running=a /.test(oge('APP01', 'crm').ek), 'ham sir DB\'ye yazilmamali');
  assert.deepEqual(denetimler.map((d) => d.op), ['toplu_restart_olustur']);
});

test('TR3 onizleme: tek tarama isi; yukleme kaniti; durmus / fark yok / fark degisti / envanter -> dustu', async () => {
  await T.olustur(istek(), secimHepsi());
  await T.tick();
  assert.equal(launchlar.length, 1, 'tek onizleme taramasi');
  const l = launchlar[0];
  assert.equal(l.key, 'server_hub_scan');
  assert.deepEqual(l.ev.target_hosts.split(',').sort(), ['APP01', 'APP02', 'APP03']);
  assert.equal(restartlar.length, 0, 'onizlemede restart YOK');
  await T.tick();
  assert.equal(launchlar.length, 1, 'suren onizleme varken yeni tarama yok');
  // APP01 yuklendi ama crm durdu; APP02: pay'in farki kalmadi, crm'in farkli anahtari degisti; APP03 yuklenmedi.
  A.hosts[0].loadedAt += 10;
  A.hosts[1].loadedAt += 10;
  jvmBul('APP01', 'crm').running = false;
  jvmBul('APP02', 'pay').argFark = 0;
  DIFF.set('APP02|8|crm', '-XX:MaxMetaspaceSize running=256m configured=512m');
  AWX.set(l.jobId, taramaSonucu(['APP01', 'APP02', 'APP03']));
  await T.tick();
  const d = durumlar();
  assert.deepEqual(d, { 'APP01/crm': 'DUSTU', 'APP02/crm': 'DUSTU', 'APP02/pay': 'DUSTU', 'APP03/doc': 'DUSTU' });
  assert.match(oge('APP01', 'crm').neden, /çalışmıyor/);
  assert.match(oge('APP02', 'pay').neden, /fark kalmadı/);
  assert.match(oge('APP02', 'crm').neden, /fark değişti/);
  assert.match(oge('APP03', 'doc').neden, /yüklemedi: yükleme zamanı ilerlemedi/);
  assert.ok(silindi >= 1, 'onbellek silinmeli');
  assert.equal(DB.isler[0].durum, 'BITTI');
});

test('TR3b onizleme: yukleyici dislamasi, sonucsuz is, envanter kurulum kolu; gecenler PLAN_GECTI', async () => {
  INV.set('doc', [{ host: 'APP03', kurulum: '8' }]);
  await T.olustur(istek(), secimHepsi());
  await T.tick();
  const l = launchlar[0];
  for (const h of A.hosts) h.loadedAt += 10;
  jvmBul('APP01', 'crm').processStartEpoch = 1500;
  AWX.set(l.jobId, taramaSonucu(['APP01', 'APP02', 'APP03'], { excluded: [{ host: 'APP02', issue: 'ROW_COUNT_MISMATCH' }] }));
  await T.tick();
  assert.equal(oge('APP01', 'crm').durum, 'PLAN_GECTI');
  assert.match(oge('APP02', 'crm').neden, /yükleyici dışladı \(ROW_COUNT_MISMATCH\)/);
  assert.match(oge('APP03', 'doc').neden, /envanterde APP03 JBoss 7 kurulumunda "doc" uygulaması yok/);
  assert.deepEqual([ek('APP01', 'crm').application, ek('APP01', 'crm').processStart, ek('APP01', 'crm').loadedAt], ['crm', 1500, 110]);
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR');
  // sonucsuz is (set_stats yok)
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  await T.olustur(istek(), [{ host: 'APP01', gen: 8, jvm: 'crm' }]);
  await T.tick();
  AWX.set(launchlar[launchlar.length - 1].jobId, { status: 'failed', artifacts: {} });
  await T.tick();
  assert.match(oge('APP01', 'crm').neden, /sonuç \(set_stats\) okunamadı/);
  assert.equal(DB.isler[0].durum, 'PLAN_HATA');
});

test('TR4 onay: 15 dk siniri, sablon limit kapisi, onay -> CALISIYOR', async () => {
  const id = await onizle();
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR');
  limitHata = 'Limit Prompt on launch kapali';
  await assert.rejects(T.onayla(istek(), id), (e) => e.code === 'limit_kabul_edilmiyor');
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR', 'limit kapisi gecmeden onay yok');
  assert.equal(restartlar.length, 0);
  limitHata = null;
  DB.isler[0].plan_bitis_at = new Date(Date.now() - 16 * 60 * 1000);
  await assert.rejects(T.onayla(istek(), id), (e) => e.status === 409 && e.code === 'plan_eskidi');
  assert.equal(DB.isler[0].durum, 'PLAN_ESKIDI');
  // yeni onizleme + onay
  const id2 = await onizle();
  // onay aninda bayatlayan sunucu dusurulur
  A.hosts[2].fresh = false;
  const r = await T.onayla(istek('mehmet'), id2);
  assert.equal(r.adet, 3);
  const is = DB.isler.find((x) => x.id === id2);
  assert.deepEqual([is.durum, is.onaylayan], ['CALISIYOR', 'mehmet']);
  assert.match(oge('APP03', 'doc').neden, /onay anında: tarama bayat/);
  assert.ok(denetimler.some((d) => d.op === 'toplu_restart_onay' && d.adet === 3 && d.user === 'mehmet'));
});

test('TR5 tek tek: tek restart, STARTED -> dogrulama taramasi, KAPANDI / KAPANMADI, sonra siradaki', async () => {
  await onayli();
  await T.tick();
  assert.equal(restartlar.length, 1, 'bir tick bir JVM');
  const r1 = restartlar[0];
  assert.equal(r1.user, 'mehmet');
  assert.equal(r1.application, r1.jvm);
  await T.tick();
  await T.tick();
  assert.equal(restartlar.length, 1, 'suren restart varken yenisi acilmaz');
  // STARTED -> dogrulama taramasi (tek sunucu)
  AWX.set(r1.jobId, restartSonucu(r1.host, r1.jvm, r1.gen, 'STARTED'));
  await T.tick();
  const t1 = launchlar[launchlar.length - 1];
  assert.deepEqual([t1.key, t1.ev.target_hosts, t1.detail.op], ['server_hub_scan', r1.host, 'toplu_restart_dogrulama']);
  assert.equal(oge(r1.host, r1.jvm).durum, 'TARANIYOR');
  await T.tick();
  assert.equal(restartlar.length, 1, 'dogrulama taramasi bitmeden siradaki yok');
  A.hosts.find((h) => h.host === r1.host).loadedAt += 10;
  jvmBul(r1.host, r1.jvm).processStartEpoch = 5000;
  jvmBul(r1.host, r1.jvm).argFark = 0;
  AWX.set(t1.jobId, taramaSonucu([r1.host]));
  await T.tick();
  assert.equal(oge(r1.host, r1.jvm).durum, 'KAPANDI');
  await T.tick();
  assert.equal(restartlar.length, 2);
  // ikinci: fark kapanmadi
  await restartBitir('STARTED', { fark: 1 });
  const r2 = restartlar[1];
  assert.equal(oge(r2.host, r2.jvm).durum, 'KAPANMADI');
  assert.match(oge(r2.host, r2.jvm).neden, /tarama yanlış uyarı veriyor olabilir \(server-group jvm ayarı domain\.xml'de olabilir/);
  await hepsiniBitir();
  assert.equal(restartlar.length, 4);
  assert.equal(DB.isler[0].durum, 'BITTI', 'KAPANMADI hata degil');
  assert.ok(denetimler.some((d) => d.op === 'toplu_restart_bitti' && d.durum === 'BITTI' && d.kapanmadi === 1));
  // ayni anda iki restart hic olmadi: her restart bir oncekinin taramasindan sonra
  const sira = restartlar.map((x) => `${x.host}/${x.jvm}`);
  assert.equal(new Set(sira).size, 4);
});

test('TR6 basarisizlik: NOT_STARTED -> FAIL, kopyalar ATLANDI, digerleri devam, BITTI_HATALI', async () => {
  await onayli();
  await T.tick();
  const r1 = restartlar[0];
  assert.equal(r1.jvm, 'crm', 'en kalabalik grup once');
  AWX.set(r1.jobId, restartSonucu(r1.host, 'crm', 8, 'NOT_STARTED'));
  await T.tick();
  assert.equal(oge(r1.host, 'crm').durum, 'FAIL');
  assert.match(oge(r1.host, 'crm').neden, /STARTED olmadı/);
  const kopya = DB.ogeler.find((o) => o.jvm === 'crm' && o.host !== r1.host);
  assert.equal(kopya.durum, 'ATLANDI');
  assert.match(kopya.neden, /aynı uygulamanın kopyası/);
  // digerleri devam
  for (let i = 0; i < 6 && restartlar.length < 3; i += 1) {
    await T.tick();
    if (restartlar.length > 1 && !AWX.has(restartlar[restartlar.length - 1].jobId)) await restartBitir('STARTED');
  }
  await T.tick();
  assert.ok(!restartlar.some((x) => x.host === kopya.host && x.jvm === 'crm'), 'atlanan kopya restart edilmemeli');
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI');
  const b = denetimler.find((d) => d.op === 'toplu_restart_bitti');
  assert.deepEqual([b.durum, b.fail], ['BITTI_HATALI', 1]);
});

test('TR7 kanit: surec degismedi FAIL; set_stats yok + basarili + yeni surec KAPANDI; set_stats yok + dustu FAIL; yuklenmedi FAIL', async () => {
  await onayli([{ host: 'APP01', gen: 8, jvm: 'crm' }, { host: 'APP02', gen: 8, jvm: 'pay' }, { host: 'APP03', gen: 7, jvm: 'doc' }]);
  await T.tick();
  await restartBitir('STARTED', { ps: 1000 });
  let r = restartlar[0];
  assert.equal(oge(r.host, r.jvm).durum, 'FAIL');
  assert.match(oge(r.host, r.jvm).neden, /süreç başlangıç zamanı değişmedi/);
  await T.tick();
  r = restartlar[1];
  AWX.set(r.jobId, { status: 'successful', artifacts: {} });
  await T.tick();
  const t = launchlar[launchlar.length - 1];
  A.hosts.find((h) => h.host === r.host).loadedAt += 10;
  jvmBul(r.host, r.jvm).processStartEpoch = 7000;
  jvmBul(r.host, r.jvm).argFark = 0;
  AWX.set(t.jobId, taramaSonucu([r.host]));
  await T.tick();
  assert.equal(oge(r.host, r.jvm).durum, 'KAPANDI', 'eski playbook: kanit taramadan');
  await T.tick();
  r = restartlar[2];
  AWX.set(r.jobId, { status: 'failed', artifacts: {} });
  await T.tick();
  assert.equal(oge(r.host, r.jvm).durum, 'FAIL');
  assert.match(oge(r.host, r.jvm).neden, /failed; bu JVM için sonuç/);
  // set_stats yok + is basarili + surec baslangici OLCULEMEDI -> kanit yok, FAIL
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  restartlar.length = 0;
  filo();
  await onayli([{ host: 'APP01', gen: 8, jvm: 'crm' }]);
  await T.tick();
  r = restartlar[0];
  AWX.set(r.jobId, { status: 'successful', artifacts: {} });
  await T.tick();
  A.hosts[0].loadedAt += 10;
  jvmBul('APP01', 'crm').processStartEpoch = null;
  jvmBul('APP01', 'crm').argFark = 0;
  AWX.set(launchlar[launchlar.length - 1].jobId, taramaSonucu(['APP01']));
  await T.tick();
  assert.equal(oge('APP01', 'crm').durum, 'FAIL');
  assert.match(oge('APP01', 'crm').neden, /restart kanıtı yok/);
  // yuklenmeyen dogrulama taramasi
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  restartlar.length = 0;
  filo();
  await onayli([{ host: 'APP01', gen: 8, jvm: 'crm' }]);
  await T.tick();
  await restartBitir('STARTED', { yukle: false });
  assert.equal(oge('APP01', 'crm').durum, 'FAIL');
  assert.match(oge('APP01', 'crm').neden, /doğrulama taraması .* yüklemedi/);
});

test('TR8 OpsX reddi: uretim ATLANDI; sablon limiti FAIL + kalanlar ATLANDI; kilit ATLANDI', async () => {
  await onayli();
  restartHata = (x) => (x.host === 'APP01' ? { code: 'uretim', message: "prod (ortam=Production) — OpsX'ten tek tek (Smart onayı)." } : null);
  kilitler.set('APP02|8|crm', 'crm toplu auto-start isi #3 icinde');
  await hepsiniBitir();
  assert.equal(oge('APP01', 'crm').durum, 'ATLANDI');
  assert.match(oge('APP01', 'crm').neden, /OpsX'ten tek tek/);
  assert.equal(oge('APP02', 'crm').durum, 'ATLANDI');
  assert.match(oge('APP02', 'crm').neden, /auto-start/);
  assert.ok(!restartlar.some((x) => x.jvm === 'crm'), 'atlanan JVM restart edilmedi');
  assert.equal(DB.isler[0].durum, 'BITTI');
  // sablon limiti: bu JVM FAIL (dokunulmadi), kalanlar ATLANDI
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  restartlar.length = 0;
  kilitler.clear();
  restartHata = null;
  filo();
  await onayli();
  restartHata = { code: 'limit_kabul_edilmiyor', message: 'Limit Prompt on launch kapali' };
  await T.tick();
  const f = DB.ogeler.filter((o) => o.durum === 'FAIL');
  assert.equal(f.length, 1);
  assert.match(f[0].neden, /JVM'e dokunulmadı/);
  assert.ok(DB.ogeler.filter((o) => o.durum !== 'FAIL').every((o) => o.durum === 'ATLANDI'));
  await T.tick();
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI');
});

test('TR9 iptal: suren JVM biter, bekleyenler IPTAL, yeni restart yok', async () => {
  const id = await onayli();
  await T.tick();
  assert.equal(restartlar.length, 1);
  const r = await T.iptal(istek('ali'), id);
  assert.equal(r.durum, 'IPTAL_ISTENDI');
  assert.equal(DB.ogeler.filter((o) => o.durum === 'IPTAL').length, 3);
  await restartBitir('STARTED');
  const r1 = restartlar[0];
  assert.equal(oge(r1.host, r1.jvm).durum, 'KAPANDI', 'suren JVM dogrulamasiyla tamamlanir');
  await T.tick();
  await T.tick();
  assert.equal(restartlar.length, 1, 'iptalden sonra yeni restart yok');
  assert.equal(DB.isler[0].durum, 'IPTAL');
  assert.ok(denetimler.some((d) => d.op === 'toplu_restart_iptal' && d.user === 'ali'));
  // savunma: IPTAL_ISTENDI isinde BEKLIYOR oge kalmis olsa da (yarim yazim) yeni restart acilmaz
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  restartlar.length = 0;
  filo();
  await onayli();
  DB.isler[0].durum = 'IPTAL_ISTENDI';
  await T.tick();
  await T.tick();
  assert.equal(restartlar.length, 0, 'iptal istenen iste restart yok');
});

test('TR10 yeniden baslatma: kirasi dusmus is YARIM_KALDI, suren oge is numarasiyla, launch YOK', async () => {
  await onayli();
  await T.tick();
  const r1 = restartlar[0];
  // baska surec (yeniden baslamis Portal) gibi: kira bizim degil ve dusmus
  DB.isler[0].kira_id = 'eski-surec';
  DB.isler[0].kira_bitis = new Date(Date.now() - 1000);
  const once = [launchlar.length, restartlar.length];
  await T.tick();
  assert.deepEqual([launchlar.length, restartlar.length], once, 'yeniden koşma YOK');
  assert.equal(DB.isler[0].durum, 'YARIM_KALDI');
  const s = oge(r1.host, r1.jvm);
  assert.deepEqual([s.durum, s.awx_job_id], ['YARIM_KALDI', r1.jobId]);
  assert.match(s.neden, /restart işi sürüyordu/);
  assert.ok(DB.ogeler.filter((o) => o.id !== s.id).every((o) => o.durum === 'YARIM_KALDI' && /çalıştırılmadı/.test(o.neden)));
  assert.ok(denetimler.some((d) => d.op === 'toplu_restart_yarim_kaldi'));
  // kirasi CANLI baska surecin isine dokunulmaz
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  await onayli();
  DB.isler[0].kira_id = 'canli-surec';
  DB.isler[0].kira_bitis = new Date(Date.now() + 60000);
  const n = restartlar.length;
  await T.tick();
  assert.equal(DB.isler[0].durum, 'CALISIYOR');
  assert.equal(restartlar.length, n);
});

test('TR11 kilit ve yardimcilar: topluKilidi, farkOzeti, yuklemeKaniti, siraKarisik', async () => {
  await T.olustur(istek(), secimHepsi());
  assert.match(await T.topluKilidi('app01', 8, 'CRM'), /toplu restart işi #\d+ içinde \(ADAY\)/);
  assert.equal(await T.topluKilidi('APP01', 7, 'crm'), null);
  DB.dus = 'baglanti yok';
  assert.equal(await T.topluKilidi('APP01', 8, 'crm'), null, 'DB okunamazsa kilit acik (auto-start betigi canli okur)');
  DB.dus = null;
  const f = T.farkOzeti('partial; -Xmx running=1g configured=2g; -Dapp.secret running=x configured=y ...+3');
  assert.deepEqual(f.anahtarlar, ['-Xmx', '-Dapp.secret']);
  assert.ok(/^partial; /.test(f.metin) && !/running=x/.test(f.metin));
  assert.deepEqual(T.farkOzeti('reason=CLI_FAIL').anahtarlar, []);
  assert.equal(T.farkOzeti(null).metin, '');
  const h = { host: 'APP01', loadedAt: 20, loadExcluded: false };
  assert.equal(T.yuklemeKaniti({ hosts: ['app01.dom'], loader: { excluded: [] } }, h, 'APP01', 10), null);
  assert.match(T.yuklemeKaniti({ hosts: ['APP01'] }, h, 'APP01', 20), /ilerlemedi/);
  assert.match(T.yuklemeKaniti({ hosts: [] }, h, 'APP01', 10), /satır üretmedi/);
  assert.match(T.yuklemeKaniti(null, h, 'APP01', 10), /set_stats/);
  assert.match(T.yuklemeKaniti({ hosts: ['APP01'] }, { ...h, loadExcluded: true }, 'APP01', 10), /dışlandı/);
  const s = T.siraKarisik(['a', 'a', 'a', 'b', 'b', 'c'].map((jvm, i) => ({ jvm, host: `H${i}` }))).map((x) => x.jvm);
  for (let i = 1; i < s.length; i += 1) assert.notEqual(s[i], s[i - 1], s.join(','));
});

test('TR12 HTTP: uclar router uzerinden', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { role: 'Admin', username: 'ayse' } };
    next();
  });
  const router = express.Router();
  T.mount(router, {
    launch: async () => ({ jobId: 1, awxServerId: 1 }),
    getAssessment: async () => A,
    loadJvmAgir,
    autoStart: () => katman,
    ayarlar: { limit: async () => limitDeger },
    audit: () => {},
  });
  app.use('/api/server-hub', router);
  const srv = app.listen(0);
  try {
    const kok = `http://127.0.0.1:${srv.address().port}/api/server-hub`;
    const J2 = (r) => r.json().then((body) => ({ status: r.status, body }));
    const post = (p, b) => fetch(kok + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(J2);
    const ad = await fetch(`${kok}/toplu-restart/adaylar?fresh=1`).then(J2);
    assert.equal(ad.status, 200);
    assert.equal(ad.body.adaylar.length, 4);
    assert.ok(ad.body.adaylar[0].fark.includes('-Xmx'));
    limitDeger = 2;
    assert.equal((await post('/toplu-restart', { secim: secimHepsi() })).status, 400);
    limitDeger = 50;
    const c = await post('/toplu-restart', { secim: secimHepsi() });
    assert.equal(c.status, 200);
    assert.equal((await post('/toplu-restart', { secim: secimHepsi() })).status, 409);
    const d = await fetch(`${kok}/toplu-restart/${c.body.id}`).then(J2);
    assert.equal(d.body.is.durum, 'PLANLANIYOR');
    assert.equal(d.body.ogeler.length, 4);
    assert.equal(d.body.ogeler[0].grp.endsWith('_Group'), true);
    assert.equal((await post(`/toplu-restart/${c.body.id}/onayla`, {})).status, 400, 'confirmed olmadan onay yok');
    assert.equal((await post(`/toplu-restart/${c.body.id}/onayla`, { confirmed: true })).status, 409, 'onizleme bitmeden onay yok');
    assert.equal((await post(`/toplu-restart/${c.body.id}/iptal`, {})).body.durum, 'IPTAL_ISTENDI');
    assert.equal((await fetch(`${kok}/toplu-restart/abc`).then(J2)).status, 400);
  } finally {
    srv.close();
  }
});

test('TR13 baglanti: index.cjs restart kilidini auto-start kapilarina ekler ve modulu baglar', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const kilit = src.slice(src.indexOf('async function surenIsKilidi('), src.indexOf('/** /findings satirlari'));
  assert.match(kilit, /if \(!restartHaric\) \{\s*const rk = await require\('\.\/toplu-restart\.cjs'\)\.topluKilidi\(host, gen, jvm\);\s*if \(rk\) return rk;/);
  assert.match(src, /require\('\.\/toplu-restart\.cjs'\)\.mount\(router, \{[\s\S]{0,400}surenIsKilidi: \(host, gen, jvm\) => surenIsKilidi\(host, gen, jvm, \{ restartHaric: true \}\)/);
  // Toplu Auto-Start yurutucusu (topluHaric) restart kilidini YINE gorur
  assert.match(src, /surenIsKilidi: \(host, gen, jvm\) => surenIsKilidi\(host, gen, jvm, \{ topluHaric: true \}\)/);
  const srv = fs.readFileSync(path.join(__dirname, '..', '..', 'index.cjs'), 'utf8');
  assert.match(srv, /name: 'topluRestart',\s*init: \(\) => require\('\.\/server-hub\/toplu-restart\.cjs'\)\.startPoller\(\)/);
});

const UC = [
  { host: 'APP01', gen: 8, jvm: 'crm' },
  { host: 'APP02', gen: 8, jvm: 'crm' },
  { host: 'APP02', gen: 8, jvm: 'pay' },
];
const ilkHata = (h) => {
  let ilk = true;
  return () => {
    if (!ilk) return null;
    ilk = false;
    return h;
  };
};

test('TR14 belirsiz launch: YARIM_KALDI, dokunulmadi denmez, toplu is durur, JVM kilitli; kesin ret devam', async () => {
  await onayli(UC);
  restartHata = ilkHata({ message: 'AWX istegi zaman asimi', status: 500, belirsiz: true });
  await T.tick();
  const o1 = oge('APP01', 'crm');
  assert.equal(o1.durum, 'YARIM_KALDI');
  assert.ok(o1.neden.includes(T.BELIRSIZ_IZ) && !/dokunulmadı/.test(o1.neden), o1.neden);
  assert.deepEqual([oge('APP02', 'crm').durum, oge('APP02', 'pay').durum], ['ATLANDI', 'ATLANDI']);
  assert.match(oge('APP02', 'crm').neden, /toplu iş durduruldu/);
  await T.tick();
  await T.tick();
  assert.equal(restartlar.length, 0, 'belirsiz launch sonrasi hicbir JVM baslatilmaz');
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI');
  assert.match(DB.isler[0].hata, /toplu iş durduruldu/);
  assert.match(await T.topluKilidi('APP01', 8, 'crm'), /sonucu bilinmiyor/);
  // kesin ret (AWX 4xx, kodsuz): JVM'e dokunulmadi -> FAIL, kalanlar devam eder
  DB.isler.length = 0;
  DB.ogeler.length = 0;
  restartlar.length = 0;
  filo();
  await onayli(UC);
  restartHata = ilkHata({ message: 'AWX HTTP 400: gecersiz', status: 400 });
  await T.tick();
  assert.equal(oge('APP01', 'crm').durum, 'FAIL');
  assert.match(oge('APP01', 'crm').neden, /dokunulmadı/);
  await T.tick();
  assert.equal(restartlar.length, 1, 'kesin retten sonra siradaki baslar');
});

test('TR15 takili BASLATILIYOR: YARIM_KALDI + toplu is durur, kopya baslamaz', async () => {
  await onayli(UC);
  const o1 = oge('APP01', 'crm');
  Object.assign(o1, { durum: 'BASLATILIYOR', baslama_at: new Date(Date.now() - 11 * 60 * 1000) });
  await T.tick();
  assert.equal(oge('APP01', 'crm').durum, 'YARIM_KALDI');
  assert.ok(oge('APP01', 'crm').neden.includes(T.BELIRSIZ_IZ));
  await T.tick();
  await T.tick();
  assert.equal(restartlar.length, 0, 'takili oge varken siradaki (kopya) baslamaz');
  assert.deepEqual([oge('APP02', 'crm').durum, DB.isler[0].durum], ['ATLANDI', 'BITTI_HATALI']);
  assert.match(await T.topluKilidi('APP01', 8, 'crm'), /sonucu bilinmiyor/, '45 dk icinde kilitli');
  oge('APP01', 'crm').baslama_at = new Date(Date.now() - 46 * 60 * 1000);
  assert.equal(await T.topluKilidi('APP01', 8, 'crm'), null, 'is numarasiz belirsizlik 45 dk sonra kalkar');
});

test('TR16 Portal yeniden basladi: AWX isi bitene kadar kilit; yeni iste kopya ATLANDI, digeri BEKLER', async () => {
  await onayli([{ host: 'APP01', gen: 8, jvm: 'crm' }, { host: 'APP03', gen: 7, jvm: 'doc' }]);
  await T.tick();
  const r1 = restartlar[0];
  assert.equal(`${r1.host}/${r1.jvm}`, 'APP01/crm');
  DB.isler[0].kira_id = 'eski-surec';
  DB.isler[0].kira_bitis = new Date(Date.now() - 1000);
  await T.tick();
  assert.equal(oge('APP01', 'crm').durum, 'YARIM_KALDI');
  assert.match(await T.topluKilidi('APP01', 8, 'crm'), new RegExp(`restart işi #${r1.jobId}`), 'AWX isi surerken kilit kalkmaz');
  // yeni toplu is: APP02/crm (kopya) + APP02/pay
  await onayli([{ host: 'APP02', gen: 8, jvm: 'crm' }, { host: 'APP02', gen: 8, jvm: 'pay' }]);
  const n = restartlar.length;
  await T.tick();
  await T.tick();
  assert.equal(oge('APP02', 'crm').durum, 'ATLANDI');
  assert.match(oge('APP02', 'crm').neden, /aynı uygulamanın kopyası APP01\/crm/);
  assert.equal(oge('APP02', 'pay').durum, 'BEKLIYOR');
  assert.match(oge('APP02', 'pay').neden, /bekliyor: APP01\/crm/);
  assert.equal(restartlar.length, n, 'onceki restart surerken yeni restart yok');
  AWX.set(r1.jobId, restartSonucu('APP01', 'crm', 8, 'STARTED'));
  assert.equal(await T.topluKilidi('APP01', 8, 'crm'), null, 'AWX isi bitince kilit kalkar');
  await T.tick();
  assert.equal(restartlar.length, n + 1);
  assert.equal(restartlar[restartlar.length - 1].jvm, 'pay');
  assert.equal(oge('APP02', 'pay').neden, null, 'bekleme notu silinir');
});

test('TR17 restart 45 dk: FAIL + toplu is durur, siradaki baslamaz', async () => {
  await onayli(UC);
  await T.tick();
  const o1 = oge('APP01', 'crm');
  assert.equal(o1.durum, 'CALISIYOR');
  o1.baslama_at = new Date(Date.now() - 46 * 60 * 1000);
  await T.tick();
  assert.equal(oge('APP01', 'crm').durum, 'FAIL');
  assert.ok(oge('APP01', 'crm').neden.includes(T.BELIRSIZ_IZ));
  assert.equal(oge('APP02', 'pay').durum, 'ATLANDI', 'kopya olmayan da baslamaz (onceki is suruyor olabilir)');
  await T.tick();
  assert.equal(restartlar.length, 1);
  assert.equal(DB.isler[0].durum, 'BITTI_HATALI');
  assert.match(await T.topluKilidi('APP01', 8, 'crm'), /sonucu bilinmiyor/);
});

test('TR18 STARTED ama durdurma kaniti yok: FAIL durdurulamadi, kopyalar ATLANDI; KILL_OK gecer', async () => {
  await onayli(UC);
  await T.tick();
  const r1 = restartlar[0];
  const nL = launchlar.length;
  jvmBul('APP01', 'crm').processStartEpoch = null;
  AWX.set(r1.jobId, {
    status: 'successful',
    artifacts: { opsx_serverconfig_ops_result: { APP01: [{ name: 'crm', jbossMajor: '8', stop_state: 'NOT_STOPPED', kill_result: 'KILL_COKLU', start_state: 'STARTED' }] } },
  });
  await T.tick();
  assert.equal(oge('APP01', 'crm').durum, 'FAIL');
  assert.match(oge('APP01', 'crm').neden, /JVM durdurulamadı \(stop_state=NOT_STOPPED, kill=KILL_COKLU/);
  assert.equal(oge('APP02', 'crm').durum, 'ATLANDI');
  assert.equal(launchlar.length, nL, 'durmamis JVM icin dogrulama taramasi acilmaz');
  await T.tick();
  const r2 = restartlar[1];
  assert.equal(r2.jvm, 'pay');
  AWX.set(r2.jobId, {
    status: 'successful',
    artifacts: { opsx_serverconfig_ops_result: { APP02: [{ name: 'pay', jbossMajor: '8', stop_state: 'NOT_STOPPED', kill_result: 'KILL_OK', start_state: 'STARTED' }] } },
  });
  await T.tick();
  assert.equal(oge('APP02', 'pay').durum, 'TARANIYOR', 'kill -9 basarili: durdurma kaniti var');
});

test('TR19 PLAN_HAZIR: 15 dk icinde dokunulmaz; sonra PLAN_ESKIDI, ogeler IPTAL, kilit kalkar', async () => {
  const id = await onizle(UC);
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR');
  DB.isler[0].kira_id = 'eski-surec';
  DB.isler[0].kira_bitis = new Date(Date.now() - 1000);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'PLAN_HAZIR', 'onay bekleyen is YARIM_KALDI yapilmaz');
  assert.match(await T.topluKilidi('APP01', 8, 'crm'), /PLAN_GECTI/);
  DB.isler[0].plan_bitis_at = new Date(Date.now() - 16 * 60 * 1000);
  await T.tick();
  assert.equal(DB.isler[0].durum, 'PLAN_ESKIDI');
  assert.ok(DB.ogeler.every((o) => o.durum === 'IPTAL'), JSON.stringify(durumlar()));
  assert.equal(await T.topluKilidi('APP01', 8, 'crm'), null);
  assert.ok(denetimler.some((d) => d.op === 'toplu_restart_plan_eskidi' && d.id === id));
  await assert.rejects(T.onayla(istek(), id), (e) => e.status === 409);
  assert.equal(restartlar.length, 0);
});

test('TR20 ad kurali: envanter TEST + ad prod -> OpsX ten tek tek', () => {
  const j = J('crm');
  assert.match(T.restartKapisi(A, H('GBJBOP18', [j]), j), /sunucu adı kuralına göre prod \(envanter TEST/);
  assert.match(T.restartKapisi(A, H('gojbwp03.dom', [j]), j), /kuralına göre prod/);
  assert.equal(T.restartKapisi(A, H('GBJBOT18', [j]), j), null);
  assert.equal(T.adKuraliProd('APP01'), false);
});
