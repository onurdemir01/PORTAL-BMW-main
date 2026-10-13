// server/scalex/__tests__/fixtures/scalex-sim.cjs — ScaleX SUNUCU SIMULATORU.
// Test dosyasi DEGIL (run-tests.cjs yalniz *.test.cjs toplar).
//
// NEDEN VAR (2026-10-14). ScaleX'in onay kapilari uretimde iki kez "yazilmis ama hic
// calismamis" cikti: 2026-09-20'de OCO koduna ulasilamiyordu, 2026-10-13'te SMART yolu
// hic acilamiyordu. Ikisinde de bekciler YESILDI, cunku KAYNAK METNINE bakiyorlardi
// ("su satir su satirdan sonra mi"). Bu duzenek istegi GERCEK yonlendiriciden gecirir
// ve "AWX'e ne gitti, OCO soruldu mu, bilet acildi mi, hangi satir yazildi" diye olcer.
//
// GERCEK olanlar: Express ucu (initScaleX), server/scalex/{index,launch,config,result,
//   reconciler}, ortak kapi (ansible/change-gates), smart-gate, admin-smart-atla,
//   oco/window, oco/prod-detect, smart/metadata (nunjucks), template-preflight ve
//   runner.cjs — AWX'e yerel SAHTE bir HTTP sunucusu uzerinden gider, yani baslatma
//   basina AWX istegi GERCEKTEN sayilir.
// SAHTE olanlar (require.cache): DB, oturum/gorunurluk, kullanici tercihleri, denetim,
//   playbook kaydi, sablon ozellestirmesi, katalog, durum aynasi, LogX cluster verisi,
//   OCO servisi + kayit deposu, SMART servisi + bilet deposu.
//
// SAHTE DB SESSIZ DEGILDIR: `scalex_operations` ya da `ansible_job_history`ye dokunan ve
// TANIMADIGI bir sorguda HATA firlatir ve `kayit.taninmayanSql`e yazar. Sessizce bos
// donmek, yeni yazilmis bir sorgunun "hic satir yok" diye yesil gecmesi demekti.
// Baska tablolara giden sorgular (runner'in ic okumalari) bos doner ve `kayit.digerSql`de
// gorunur.
//
// Kullanim: dosyanin EN BASINDA `require` (sahteler index.cjs/runner.cjs'ten once
// kurulmali), `await sim.baslat()` (before), `sim.sifirla()` (beforeEach), `await
// sim.durdur()` (after).
'use strict';

const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');

const SERVER = path.join(__dirname, '..', '..', '..');
const SUNUCU_ID = 1;
const TOKEN = 'SX-SIM-TOKEN-5d21c0';
const ATLA_ANAHTARI = 'guvenlik.smart_onayi_atla';

for (const k of Object.keys(process.env)) {
  if (/^AWX_/.test(k) || /^SCALEX_/.test(k) || /^(HTTPS?_PROXY|https?_proxy)$/.test(k)) {
    delete process.env[k];
  }
}

const yol = (rel) => path.join(SERVER, rel);
const sahte = (rel, exports) => {
  const file = yol(rel);
  const m = new Module(file);
  m.filename = file;
  m.loaded = true;
  m.exports = exports;
  require.cache[file] = m;
  return exports;
};
const hata = (mesaj, status, ek = {}) => Object.assign(new Error(mesaj), { status, ...ek });

const KULLANICILAR = {
  // Oturum nesnesi GERCEK sekliyle: `mail` (auth/index.cjs `email` YAZMAZ).
  ayse: { username: 'ayse', mail: 'ayse@ornek.test', displayName: 'Ayse Ornek', role: 'User', groups: ['ekip-a'] },
  bora: { username: 'bora', mail: 'bora@ornek.test', displayName: 'Bora Ornek', role: 'User', groups: ['ekip-b'] },
  yonetici: { username: 'yonetici', mail: 'yonetici@ornek.test', displayName: 'Yonetici', role: 'Admin', groups: ['yoneticiler'] },
};

// SMART'in "kullanima hazir" hali: dort parcanin dordu de dolu.
const SMART_HAZIR = Object.freeze({
  enabled: true,
  flowKey: 'SCALEX_AKIS',
  metadataFields: 'Talep: {{ scalex.ozet }}\nTalepEden: {{ username }}\nOrtam: {{ scalex.ortam }}',
});

const sim = {
  SUNUCU_ID,
  KULLANICILAR,
  SMART_HAZIR,
  ATLA_ANAHTARI,
  ayar: null,
  kayit: null,
  awx: { srv: null, port: 0 },
  portal: { srv: null, port: 0 },
};

// ── KURGU DUGMELERI ──────────────────────────────────────────────────────────
function varsayilanAyar() {
  return {
    kullanici: KULLANICILAR.ayse,
    // SCALEX_PROD_SMART_MODE: undefined = ayar hic girilmemis (varsayilan `required`).
    smartKipi: undefined,
    // `ansible_ss_customizations` satiri. null = satir YOK (uretimdeki durum).
    ozellestirme: null,
    smartBaglanti: true,
    smartHatasi: null,
    // kullanici adi -> tercih nesnesi
    tercihler: {},
    // OCO servisinin o numara icin ne dedigi:
    //   icinde | once | gecti | yok | tarihsiz | servis_hatasi
    oco: 'icinde',
    sablonlar: {
      scalex_run: { keyName: 'scalex_run', enabled: true, awxTemplateId: 4711, awxServerId: SUNUCU_ID },
      scalex_discovery: { keyName: 'scalex_discovery', enabled: true, awxTemplateId: 4712, awxServerId: SUNUCU_ID },
    },
    katalog: {
      clusters: ['c1', 'c2'],
      namespaces: ['odeme', 'kredi'],
      apps: ['api', 'worker', 'batch'],
    },
    awx: {
      gecikmeMs: 0,
      promptAcik: true,
      anketAcik: true,
      anket: [{ variable: 'execution_mode', required: false, default: 'dry_run' }],
      // AWX bu degiskenleri (ayar ne olursa olsun) yok sayar — bellek bayatken admin'in
      // "Prompt on launch"i kapattigi yarisin kurgusu.
      yokSay: [],
      // Sablon listesi kac sayfa (eski on kontrol butun listeyi cekiyordu).
      listeSayfasi: 3,
      baslatmaDurumu: 0,
      // Bitmis isin tam ciktisi kac ms'de iner (sonucun ciktiyi BEKLEMEDIGINI olcmek icin).
      ciktiGecikmeMs: 0,
    },
  };
}

function bosKayit() {
  return {
    denetim: [],
    islemler: [],
    isGecmisi: [],
    ayna: new Map(),
    taninmayanSql: [],
    digerSql: [],
    awxIstekleri: [],
    isler: new Map(),
    ocoSorgulari: [],
    ocoKayitlari: [],
    smartTalepleri: [],
    biletler: [],
  };
}
let sonId = 0;
const yeniId = () => ++sonId;
let sonIs = 9000;

sim.sifirla = () => {
  sim.ayar = varsayilanAyar();
  sim.kayit = bosKayit();
  delete process.env.SCALEX_PROD_SMART_MODE;
};
sim.sifirla();

/** SMART kipi `config.smartMode()` her cagrida process.env'den okur; dugme oraya yazar. */
sim.smartKipi = (deger) => {
  sim.ayar.smartKipi = deger;
  if (deger === undefined) delete process.env.SCALEX_PROD_SMART_MODE;
  else process.env.SCALEX_PROD_SMART_MODE = deger;
};
/** Bellekleri (on kontrol, anket) SOGUK bir sablon kimligine gecirir. */
let sogukSayac = 5000;
sim.soguk = () => {
  sogukSayac += 10;
  sim.ayar.sablonlar.scalex_run.awxTemplateId = sogukSayac;
  return sogukSayac;
};
sim.adminAtlasin = (kim = 'yonetici') => {
  sim.ayar.tercihler[kim] = { [ATLA_ANAHTARI]: '1' };
};

// ── SAHTE DB ─────────────────────────────────────────────────────────────────
const duz = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const SIKI_TABLO = /\b(scalex_operations|scalex_state_mirror|ansible_job_history)\b/;
const simdi = () => new Date();

const SORGULAR = [
  [
    /^INSERT INTO scalex_operations \(request_key, username, env, tenant, cluster_name, namespace, action, execution_mode, target_replicas, app_names_json, awx_server_id, awx_job_id, status, oco_number, reason, smart_ticket_id, approval_state, username_groups\) VALUES/,
    (p) => {
      const [request_key, username, env, tenant, cluster_name, namespace, action, execution_mode,
        target_replicas, app_names_json, awx_server_id, awx_job_id, status, oco_number, reason,
        smart_ticket_id, approval_state, username_groups] = p;
      sim.kayit.islemler.push({
        id: yeniId(), request_key, username, env, tenant, cluster_name, namespace, action,
        execution_mode, target_replicas, app_names_json, awx_server_id, awx_job_id, status,
        oco_number, reason, smart_ticket_id, approval_state, username_groups,
        overall_status: null, result_json: null, error_message: null,
        created_at: simdi(), updated_at: simdi(),
      });
      return { rows: [], rowCount: 1 };
    },
  ],
  [
    /^INSERT INTO ansible_job_history \(username, awx_server_id, template_id, template_name, job_id, status, started_at, params\) VALUES/,
    (p) => {
      sim.kayit.isGecmisi.push({ username: p[0], awx_server_id: p[1], template_id: p[2], template_name: p[3], job_id: p[4], status: p[5] });
      return { rows: [], rowCount: 1 };
    },
  ],
  [
    /^SELECT TOP 1 username FROM ansible_job_history WHERE job_id = \$1 AND awx_server_id = \$2$/,
    (p) => ({
      rows: sim.kayit.isGecmisi
        .filter((r) => Number(r.job_id) === Number(p[0]) && Number(r.awx_server_id) === Number(p[1]))
        .slice(0, 1)
        .map((r) => ({ username: r.username })),
    }),
  ],
  [
    /^SELECT \* FROM scalex_operations WHERE awx_server_id = \$1 AND awx_job_id = \$2$/,
    (p) => ({
      rows: sim.kayit.islemler
        .filter((r) => Number(r.awx_server_id) === Number(p[0]) && Number(r.awx_job_id) === Number(p[1]))
        .map((r) => ({ ...r })),
    }),
  ],
  [
    /^UPDATE scalex_operations SET status = 'FINISHED', overall_status = \$3, result_json = \$4, updated_at = GETUTCDATE\(\) WHERE awx_server_id = \$1 AND awx_job_id = \$2 AND status = 'RUNNING'$/,
    (p) => guncelle(
      (r) => Number(r.awx_server_id) === Number(p[0]) && Number(r.awx_job_id) === Number(p[1]) && r.status === 'RUNNING',
      (r) => Object.assign(r, { status: 'FINISHED', overall_status: p[2], result_json: p[3] }),
    ),
  ],
  [
    /^SELECT TOP 50 request_key, MIN\(created_at\) AS created_at FROM scalex_operations WHERE status = 'SCHEDULED' AND request_key LIKE 'oco:%' GROUP BY request_key ORDER BY MIN\(created_at\) ASC$/,
    () => {
      const gruplar = new Map();
      for (const r of sim.kayit.islemler) {
        if (r.status !== 'SCHEDULED' || !String(r.request_key).startsWith('oco:')) continue;
        const eski = gruplar.get(r.request_key);
        if (!eski || r.created_at < eski) gruplar.set(r.request_key, r.created_at);
      }
      return { rows: [...gruplar].map(([request_key, created_at]) => ({ request_key, created_at })) };
    },
  ],
  [
    /^UPDATE scalex_operations SET status = \$2, error_message = \$3, updated_at = GETUTCDATE\(\) WHERE request_key = \$1 AND status = 'SCHEDULED'$/,
    (p) => guncelle(
      (r) => r.request_key === p[0] && r.status === 'SCHEDULED',
      (r) => Object.assign(r, { status: p[1], error_message: p[2] }),
    ),
  ],
  [
    /^UPDATE scalex_operations SET status = 'CANCELLED', error_message = \$2, updated_at = GETUTCDATE\(\) WHERE request_key = \$1 AND status = 'SCHEDULED'$/,
    (p) => guncelle(
      (r) => r.request_key === p[0] && r.status === 'SCHEDULED',
      (r) => Object.assign(r, { status: 'CANCELLED', error_message: p[1] }),
    ),
  ],
  [
    /^UPDATE scalex_operations SET status = 'RUNNING', awx_job_id = \$2, awx_server_id = COALESCE\(awx_server_id, \$3\), request_key = CONCAT\(CAST\(COALESCE\(awx_server_id, \$3\) AS NVARCHAR\(20\)\), ':', CAST\(\$2 AS NVARCHAR\(20\)\)\), updated_at = GETUTCDATE\(\) WHERE request_key = \$1 AND status = 'SCHEDULED'$/,
    (p) => guncelle(
      (r) => r.request_key === p[0] && r.status === 'SCHEDULED',
      (r) => {
        const sunucu = r.awx_server_id ?? p[2];
        Object.assign(r, { status: 'RUNNING', awx_job_id: p[1], awx_server_id: sunucu, request_key: `${sunucu}:${p[1]}` });
      },
    ),
  ],
];

function guncelle(secici, uygula) {
  let n = 0;
  for (const r of sim.kayit.islemler) {
    if (!secici(r)) continue;
    uygula(r);
    r.updated_at = simdi();
    n++;
  }
  return { rows: [], rowCount: n };
}

sahte('db/index.cjs', {
  query: async (sql, params = []) => {
    const metin = duz(sql);
    for (const [desen, isle] of SORGULAR) {
      if (desen.test(metin)) return isle(params);
    }
    if (SIKI_TABLO.test(metin)) {
      sim.kayit.taninmayanSql.push(metin);
      throw new Error(`[scalex-sim] taninmayan SQL: ${metin.slice(0, 160)}`);
    }
    sim.kayit.digerSql.push(metin);
    return { rows: [], rowCount: 0 };
  },
});

// ── OTURUM, GORUNURLUK, DENETIM ──────────────────────────────────────────────
sahte('auth/index.cjs', {
  requireAuth: (req, res, next) =>
    req.session && req.session.user ? next() : res.status(401).json({ ok: false, message: 'Oturum yok' }),
  requireAdmin: (req, res, next) =>
    req.session?.user?.role === 'Admin' ? next() : res.status(403).json({ ok: false, message: 'Admin' }),
  getRequestUser: (req) => (req.session && req.session.user) || null,
});
// Gorunurluk motoru bu duzenegin konusu degil (kendi testleri var): gecirgen.
sahte('auth/visibility.cjs', {
  requireVisiblePrefix: () => (_req, _res, next) => next(),
  bumpVersion: () => {},
});
sahte('auth/users.cjs', {
  getPrefs: async (kim) => {
    if (sim.ayar.tercihHatasi) throw sim.ayar.tercihHatasi;
    return sim.ayar.tercihler[kim] || {};
  },
});
sahte('audit/index.cjs', {
  auditPortal: (req, action, opts = {}) => {
    sim.kayit.denetim.push({
      action,
      username: opts.username || req?.session?.user?.username || null,
      result: opts.result || 'ok',
      detail: (() => {
        try {
          return JSON.parse(opts.detail || 'null');
        } catch {
          return opts.detail;
        }
      })(),
    });
  },
});

// ── PLAYBOOK KAYDI, SABLON OZELLESTIRMESI ────────────────────────────────────
sahte('ansible/playbook-registry.cjs', {
  // GERCEK IMZA: `async` (await unutulursa her cagri 501'e duser — bkz. resolveByKey).
  getByKey: async (keyName) => sim.ayar.sablonlar[keyName] || null,
  getEffectiveTemplateId: (row) => (row && row.awxTemplateId) || null,
});
// GERCEK `readCustom` DB okunamayinca FIRLATMAZ, bos nesne doner: "satir yok" ile
// "okunamadi" ayni kurgudur (`ozellestirme: null`).
sahte('ansible/ss-customizations.cjs', {
  readCustom: async () => sim.ayar.ozellestirme || {},
  invalidate: () => {},
});

// ── LOGX CLUSTER VERISI, KATALOG, AYNA ───────────────────────────────────────
sahte('logx/v2/admin.cjs', {
  resolveClusterMeta: async (_env, _tenant, clusters) =>
    Object.fromEntries(clusters.map((c) => [c, { api_url: `https://api.${c}.ornek.test:6443`, vault_credential_key: `vault_${c}` }])),
  resolveTerminalHosts: async (_env, _tenant, clusters) => ({
    hosts: Object.fromEntries(clusters.map((c) => [c, `jump-${c}`])),
    missing: [],
  }),
});
sahte('logx/v2/ocp.cjs', {
  assertVaultKeysKnownOrThrow: async () => {},
  cacheNamespaceDiscovery: async () => ({}),
});
sahte('logx/v2/ocp-cache.cjs', { putApps: async () => {} });

const katalogdaYok = (ne, deger) => hata(`${ne} katalogda yok ya da yetkiniz yok: ${deger}`, 403);
sahte('scalex/catalog.cjs', {
  assertClustersExist: async ({ clusters }) => {
    for (const c of clusters) if (!sim.ayar.katalog.clusters.includes(c)) throw katalogdaYok('Cluster', c);
  },
  assertNamespaceAllowed: async ({ namespace }) => {
    if (!sim.ayar.katalog.namespaces.includes(namespace)) throw katalogdaYok('Namespace', namespace);
  },
  assertAppsAllowed: async ({ apps }) => {
    for (const a of apps) if (!sim.ayar.katalog.apps.includes(a)) throw katalogdaYok('Uygulama', a);
  },
  filterStoppedForUser: async (rows) => rows,
  filterStoppedByOwnership: (rows) => rows,
  getClusterTree: async () => [],
  getNamespaces: async () => sim.ayar.katalog.namespaces,
  listApps: async () => sim.ayar.katalog.apps,
});

const aynaAnahtari = (t) => [t.env, t.tenant, t.clusterName, t.namespace, t.appName].join('|');
sahte('scalex/state.cjs', {
  MIRROR_LIMIT: 500,
  DRIFT: { IN_SYNC: 'in_sync' },
  tryLockRestore: async (t) => {
    const r = sim.kayit.ayna.get(aynaAnahtari(t));
    if (!r) return 'absent';
    if (r.phase === 'restoring') return 'busy';
    r.phase = 'restoring';
    return 'locked';
  },
  unlockRestore: async (t) => {
    const r = sim.kayit.ayna.get(aynaAnahtari(t));
    if (r) r.phase = 'scaled_down';
  },
  listLockedRestores: async () => [...sim.kayit.ayna.values()].filter((r) => r.phase === 'restoring'),
  listMirrorAll: async () => [...sim.kayit.ayna.values()],
  listMirror: async ({ env, tenant }) =>
    [...sim.kayit.ayna.values()].filter((r) => r.env === env && r.tenant === tenant),
  upsertStopped: async (t) => {
    sim.kayit.ayna.set(aynaAnahtari(t), { ...t, phase: 'scaled_down', driftStatus: 'in_sync' });
  },
  clearRestored: async (t) => {
    sim.kayit.ayna.delete(aynaAnahtari(t));
  },
  recordRestoreFailure: async (t) => {
    const r = sim.kayit.ayna.get(aynaAnahtari(t));
    if (r) Object.assign(r, { phase: 'scaled_down', lastRestoreError: t.error });
  },
  refreshDrift: async () => ({ updated: 0 }),
  adopt: async (t) => t,
  classifyDrift: () => 'in_sync',
});
/** Aynaya "portaldan durdurulmus" bir uygulama koyar (geri alma kurgulari icin). */
sim.durdurulmusEkle = ({ env = 'prod', tenant = 't1', clusterName = 'c1', namespace = 'odeme', appName = 'api', workloadKind = 'Deployment' } = {}) => {
  const t = { env, tenant, clusterName, namespace, appName, workloadKind };
  sim.kayit.ayna.set(aynaAnahtari(t), { ...t, phase: 'scaled_down', driftStatus: 'in_sync', stoppedBy: 'ayse' });
  return t;
};

// ── OCO SERVISI + KAYIT DEPOSU ───────────────────────────────────────────────
const SAAT = 3600 * 1000;
// WCF bicimi MUTLAK andir; `dd.MM.yyyy HH:mm` yerel saat dilimine bagli olurdu ve
// duzenek baska bir saat diliminde kosunca pencere kayardi.
const wcf = (ms) => `/Date(${ms})/`;
function ocoYaniti(numara) {
  const d = sim.ayar.oco;
  if (d === 'servis_hatasi') throw hata('OCO servisine ulaşılamadı (test).', 502);
  if (d === 'yok') {
    throw hata(`OCO ${numara} bulunamadı. Numarayı kontrol edin — kayıt OCO sisteminde açılmış olmalı.`, 404);
  }
  const t = Date.now();
  const aralik = {
    icinde: [t - SAAT, t + SAAT],
    once: [t + 6 * SAAT, t + 8 * SAAT],
    gecti: [t - 5 * SAAT, t - 3 * SAAT],
    tarihsiz: null,
  }[d];
  if (aralik === undefined) throw new Error(`[scalex-sim] bilinmeyen OCO kurgusu: ${d}`);
  const Result = { OcoWfIdSubject: `Planli calisma ${numara}` };
  if (aralik) {
    Result.PlannedStartDate = wcf(aralik[0]);
    Result.PlannedEndDate = wcf(aralik[1]);
  }
  return {
    payload: { GetChangeOrderByWfInstanceIdResult: { ResultCode: 1000, Result } },
    result: Result,
    resultCode: 1000,
  };
}
// Proxy'nin yuttugu kodlar 400'e cevrilir — GERCEK modulle AYNI kural (bkz. oco/client.cjs).
const NGINX_INTERCEPTED = new Set([403, 404, 500, 502, 503, 504]);
sahte('oco/client.cjs', {
  NGINX_INTERCEPTED,
  httpStatus: (err) => {
    const s = Number((err && err.status) || 400);
    return NGINX_INTERCEPTED.has(s) ? 400 : s;
  },
  normalizeOcoNumber: (n) => String(n || '').trim(),
  getChangeOrder: async (numara) => {
    sim.kayit.ocoSorgulari.push(String(numara));
    return ocoYaniti(String(numara));
  },
});

const kesisiyor = (a, b) => Array.isArray(a) && Array.isArray(b) && a.some((g) => b.includes(g));
const ocoKaydi = (id) => sim.kayit.ocoKayitlari.find((r) => r.id === Number(id)) || null;
sahte('oco/store.cjs', {
  create: async ({ username, awxServerId, awxTemplateId, ocoNumber, ocoSubject, runAt, windowEnd, pendingLaunch, ownerGroups }) => {
    const rec = {
      id: yeniId(), username, awxServerId, awxTemplateId, ocoNumber, ocoSubject: ocoSubject || null,
      runAt, windowEnd, status: 'SCHEDULED',
      // Gercek depo JSON'a cevirip geri okur: nesne KOPYADIR, cagiranin sonradan
      // degistirdigi alan kayda sizmaz.
      pendingLaunch: JSON.parse(JSON.stringify(pendingLaunch)),
      awxJobId: null, awxScheduleId: null, smartTicketId: null,
      ownerGroups: Array.isArray(ownerGroups) ? ownerGroups.slice() : null,
      cancelledBy: null, cancelNote: null, errorMessage: null, createdAt: simdi(),
    };
    sim.kayit.ocoKayitlari.push(rec);
    return rec;
  },
  createAwxScheduled: async () => {
    // ScaleX `preferPortalScheduler: true` gecer; buraya gelmek AWX-native zamanlamaya
    // dusmek demektir (portaldan iptal edilemeyen kayit).
    throw new Error('[scalex-sim] ScaleX AWX-native zamanlama ACMAMALI');
  },
  get: async (id) => ocoKaydi(id),
  listAll: async () => ({ items: sim.kayit.ocoKayitlari.slice(), total: sim.kayit.ocoKayitlari.length }),
  listForUser: async ({ username, groups }) => ({
    items: sim.kayit.ocoKayitlari.filter((r) => r.username === username || kesisiyor(r.ownerGroups, groups)),
    truncated: false,
  }),
  canManage: (rec, { username, groups, role }) =>
    !!rec && (role === 'Admin' || rec.username === username || kesisiyor(rec.ownerGroups, groups)),
  update: async (id, { ocoNumber, runAt, windowEnd }) => {
    const r = ocoKaydi(id);
    if (!r || r.status !== 'SCHEDULED') return null;
    Object.assign(r, { ocoNumber: ocoNumber ?? r.ocoNumber, runAt: runAt ?? r.runAt, windowEnd: windowEnd ?? r.windowEnd });
    return r;
  },
  cancelBy: async (id, { cancelledBy, note }) => {
    const r = ocoKaydi(id);
    if (!r || !['SCHEDULED', 'AWX_SCHEDULED', 'PENDING_APPROVAL'].includes(r.status)) return null;
    Object.assign(r, { status: 'CANCELLED', cancelledBy: cancelledBy || null, cancelNote: note || null });
    return r;
  },
  markPendingApprovalAtRequest: async (id, { smartTicketId }) => {
    const r = ocoKaydi(id);
    if (!r || r.status !== 'SCHEDULED') return false;
    Object.assign(r, { status: 'PENDING_APPROVAL', smartTicketId });
    return true;
  },
});
/** Zamanlayicinin (oco/poller) pencere saatinde yaptigini taklit eder. */
sim.zamanlananiBaslat = (kayitId, jobId) => {
  const r = ocoKaydi(kayitId);
  Object.assign(r, { status: 'LAUNCHED', awxJobId: jobId });
  return r;
};
sim.ocoKaydi = ocoKaydi;

// ── SMART SERVISI + BILET DEPOSU ─────────────────────────────────────────────
sahte('smart/client.cjs', {
  isConfigured: () => sim.ayar.smartBaglanti === true,
  // GERCEK istemcinin govde kurulumu BIREBIR (smart/client.cjs createTicket):
  // `Object.entries(metadata)`. Metadata DIZI gelirse anahtarlar "0, 1, 2" olur —
  // 2026-10-13'te bulunan ve biletin hic acilamamasina yol acan hata tam buydu.
  createTicket: async ({ flowKey, username, metadata, integrationKey }) => {
    if (sim.ayar.smartHatasi) throw sim.ayar.smartHatasi;
    const metadatas = Object.entries(metadata || {}).map(([key, value]) => ({ key, value: String(value) }));
    const ticketId = `SMT-${yeniId()}`;
    sim.kayit.smartTalepleri.push({ ticketId, flowKey, logonName: username, integrationKey, metadatas });
    return { ticketId };
  },
});
sahte('smart/store.cjs', {
  createTicket: async ({ externalTicketId, username, awxServerId, awxTemplateId, flowKey, pendingLaunch }) => {
    const b = {
      id: yeniId(), externalTicketId, username, awxServerId, awxTemplateId, flowKey, status: 'PENDING',
      pendingLaunch: JSON.parse(JSON.stringify(pendingLaunch)), awxJobId: null,
    };
    sim.kayit.biletler.push(b);
    return b;
  },
  getTicket: async (id) => sim.kayit.biletler.find((b) => b.id === Number(id)) || null,
  listPending: async () => sim.kayit.biletler.filter((b) => b.status === 'PENDING'),
});

// ── SAHTE AWX ────────────────────────────────────────────────────────────────
// AWX'in sessiz yutma kurali: "Prompt on launch > Variables" kapaliyken ankette OLMAYAN
// degiskenler yok sayilir ve baslatma yanitinin `ignored_fields`ine duser.
function awxIstegi(req, res, govde) {
  const a = sim.ayar.awx;
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  sim.kayit.awxIstekleri.push({ method: req.method, yol: p, sorgu: u.search, auth: req.headers.authorization || null });
  const gonder = (kod, nesne, ekGecikme = 0) =>
    setTimeout(() => {
      res.writeHead(kod, { 'Content-Type': typeof nesne === 'string' ? 'text/plain' : 'application/json' });
      res.end(nesne === undefined ? '' : typeof nesne === 'string' ? nesne : JSON.stringify(nesne));
    }, a.gecikmeMs + ekGecikme);

  if (req.method === 'GET' && p === '/api/v2/job_templates/') {
    const sayfa = Number(u.searchParams.get('page') || 1);
    const sonraki = sayfa < a.listeSayfasi ? `/api/v2/job_templates/?page=${sayfa + 1}` : null;
    const results = sayfa === a.listeSayfasi
      ? Object.values(sim.ayar.sablonlar).map((s) => ({
        id: s.awxTemplateId, name: `ScaleX ${s.keyName}`, ask_variables_on_launch: a.promptAcik, survey_enabled: a.anketAcik,
      }))
      : Array.from({ length: 3 }, (_, i) => ({ id: sayfa * 100 + i, name: `baska-${sayfa}-${i}`, ask_variables_on_launch: true }));
    return gonder(200, { count: a.listeSayfasi * 3, next: sonraki, previous: null, results });
  }
  let m = /^\/api\/v2\/job_templates\/(\d+)\/$/.exec(p);
  if (req.method === 'GET' && m) {
    return gonder(200, { id: Number(m[1]), name: 'ScaleX', ask_variables_on_launch: a.promptAcik, survey_enabled: a.anketAcik, extra_vars: '' });
  }
  m = /^\/api\/v2\/job_templates\/(\d+)\/survey_spec\/$/.exec(p);
  if (req.method === 'GET' && m) {
    return gonder(200, a.anketAcik ? { name: '', description: '', spec: a.anket } : {});
  }
  m = /^\/api\/v2\/job_templates\/(\d+)\/launch\/$/.exec(p);
  if (req.method === 'POST' && m) {
    if (a.baslatmaDurumu) return gonder(a.baslatmaDurumu, { detail: 'AWX yanit vermiyor (test)' });
    const yuk = JSON.parse(govde || '{}');
    const ev = JSON.parse(yuk.extra_vars || '{}');
    const ankette = new Set((a.anketAcik ? a.anket : []).map((q) => q.variable));
    const yutulan = {};
    for (const [k, v] of Object.entries(ev)) {
      if (a.yokSay.includes(k) || (!a.promptAcik && !ankette.has(k))) yutulan[k] = v;
    }
    const id = ++sonIs;
    sim.kayit.isler.set(id, {
      id, tplId: Number(m[1]), ev, status: 'pending', failed: false, finished: null, artifacts: {},
      stdout: 'PLAY [ScaleX] ***\n', yutulan: Object.keys(yutulan),
    });
    return gonder(201, { job: id, id, status: 'pending', ignored_fields: Object.keys(yutulan).length ? { extra_vars: yutulan } : {} });
  }
  m = /^\/api\/v2\/jobs\/(\d+)\/$/.exec(p);
  if (req.method === 'GET' && m) {
    const is = sim.kayit.isler.get(Number(m[1]));
    if (!is) return gonder(404, { detail: 'Not found.' });
    return gonder(200, {
      id: is.id, status: is.status, failed: is.failed, finished: is.finished, created: '2026-10-14T08:00:00Z',
      started: '2026-10-14T08:00:02Z', elapsed: 12.5, artifacts: is.artifacts, job_template: is.tplId,
      summary_fields: { launched_by: { name: 'portal_svc' } },
    });
  }
  m = /^\/api\/v2\/jobs\/(\d+)\/stdout\/$/.exec(p);
  if (req.method === 'GET' && m) {
    const is = sim.kayit.isler.get(Number(m[1]));
    if (!is) return gonder(404, { detail: 'Not found.' });
    // `start_line` YOKSA tam cekimdir; yalniz o gecikir. Varsa GERCEK AWX gibi o
    // satirdan sonrasi doner (runner bindirme satirini dogrular; tum metni donmek
    // artimli yolu her seferinde tam cekime dusururdu).
    const tam = !u.searchParams.has('start_line');
    if (tam) return gonder(200, is.stdout, a.ciktiGecikmeMs);
    return gonder(200, is.stdout.split('\n').slice(Number(u.searchParams.get('start_line')) || 0).join('\n'));
  }
  m = /^\/api\/v2\/jobs\/(\d+)\/cancel\/$/.exec(p);
  if (req.method === 'POST' && m) {
    const is = sim.kayit.isler.get(Number(m[1]));
    if (is) Object.assign(is, { status: 'canceled', iptal: true });
    return gonder(202);
  }
  return gonder(404, { detail: 'Not found.' });
}

/** Bir isi AWX'te "bitmis" yapar; `targets` verilirse `scalex_result` artifact'i uretilir. */
sim.isiBitir = (jobId, { action = 'stop', mode = 'apply', namespace = 'odeme', targets = [], status = 'successful' } = {}) => {
  const is = sim.kayit.isler.get(Number(jobId));
  if (!is) throw new Error(`[scalex-sim] is yok: ${jobId}`);
  const ok = targets.filter((t) => t.status === 'OK').length;
  Object.assign(is, {
    status,
    failed: status !== 'successful',
    finished: '2026-10-14T08:01:00Z',
    stdout: `${is.stdout}TASK [sonuc] ok\nPLAY RECAP ***\n`,
    artifacts: {
      scalex_result: {
        overall_status: ok === targets.length ? 'OK' : 'FAIL',
        stage: 'execution', mode, action, namespace, catalog_source: 'portal', package_version: '24',
        counts: { planned: targets.length, ok, fail: targets.length - ok },
        targets,
      },
    },
  });
  return is;
};
/** AWX'te dogrudan (zamanlayicinin yapacagi gibi) bir is acar. */
sim.awxIsiAc = (ek = {}) => {
  const id = ++sonIs;
  sim.kayit.isler.set(id, { id, tplId: sim.ayar.sablonlar.scalex_run.awxTemplateId, ev: {}, status: 'running', failed: false, finished: null, artifacts: {}, stdout: 'PLAY [ScaleX] ***\n', yutulan: [], ...ek });
  return id;
};

// ── PORTAL ───────────────────────────────────────────────────────────────────
sim.runner = require(yol('ansible/runner.cjs'));
sim.onkontrol = require(yol('ansible/template-preflight.cjs'));
sim.reconciler = require(yol('scalex/reconciler.cjs'));
// Arka plan turu duzenekte KOSMAZ: zamanlayici testi belirsiz kilar ve surec kapanmaz.
sim.reconciler.startReconciler = () => {};
sim.scalex = require(yol('scalex/index.cjs'));
sim.launch = require(yol('scalex/launch.cjs'));

sim.baslat = async () => {
  sim.awx.srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => awxIstegi(req, res, b));
  });
  await new Promise((r) => sim.awx.srv.listen(0, '127.0.0.1', r));
  sim.awx.port = sim.awx.srv.address().port;
  process.env.AWX_1_URL = `http://127.0.0.1:${sim.awx.port}`;
  process.env.AWX_1_TOKEN = TOKEN;
  process.env.AWX_1_NAME = 'awx-sim';

  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    if (sim.ayar.kullanici) req.session = { user: sim.ayar.kullanici };
    next();
  });
  sim.scalex.initScaleX(app);
  sim.portal.srv = http.createServer(app);
  await new Promise((r) => sim.portal.srv.listen(0, '127.0.0.1', r));
  sim.portal.port = sim.portal.srv.address().port;
};

sim.durdur = async () => {
  await new Promise((r) => sim.awx.srv.close(r));
  await new Promise((r) => sim.portal.srv.close(r));
};

sim.istek = (method, urlYolu, govde) =>
  new Promise((resolve, reject) => {
    const veri = govde === undefined ? '' : JSON.stringify(govde);
    const headers = veri ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(veri) } : {};
    const req = http.request({ host: '127.0.0.1', port: sim.portal.port, path: urlYolu, method, headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(b || 'null');
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, metin: b, json });
      });
    });
    req.on('error', reject);
    req.end(veri);
  });

// ── KISA YOLLAR ──────────────────────────────────────────────────────────────
/** Gecerli bir ScaleX istegi govdesi; `ek` ile alanlar degistirilir. */
sim.govde = (ek = {}) => ({
  env: 'prod',
  tenant: 't1',
  namespace: 'odeme',
  clusters: ['c1'],
  apps: ['api'],
  action: 'stop',
  executionMode: 'apply',
  ...ek,
});
sim.onizle = (ek) => sim.istek('POST', '/api/scalex/preview', sim.govde(ek));
sim.calistir = (ek) => sim.istek('POST', '/api/scalex/run', sim.govde(ek));

sim.baslatmalar = () => sim.kayit.awxIstekleri.filter((r) => r.method === 'POST' && /\/launch\/$/.test(r.yol));
sim.iptaller = () => sim.kayit.awxIstekleri.filter((r) => r.method === 'POST' && /\/cancel\/$/.test(r.yol));
sim.tamCiktiOkumalari = () =>
  sim.kayit.awxIstekleri.filter((r) => /\/stdout\/$/.test(r.yol) && !/start_line=/.test(r.sorgu));
sim.denetimde = (action) => sim.kayit.denetim.filter((d) => d.action === action);
sim.islemler = (durum) => sim.kayit.islemler.filter((r) => !durum || r.status === durum);

sim.konsoluSustur = (t) => {
  const cikti = { warn: [], error: [], log: [] };
  for (const n of ['warn', 'error', 'log']) t.mock.method(console, n, (...a) => cikti[n].push(a.join(' ')));
  return cikti;
};

module.exports = sim;
