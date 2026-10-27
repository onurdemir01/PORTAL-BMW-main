// server/nginx-loadtest/__tests__/kapi.test.cjs - Yuk Testi router'i GERCEK; db / AWX / envanter /
// kimlik / gorunurluk / denetim sahte (require.cache). (2026-10-27)
//
//   YKP1 kapilar (davranis): oturumsuz 401; Admin olmayan her yazan uca ve /durum'a 403, DB'ye
//        dokunmadan; sekmesi kapali 403; Admin olmayan yalniz salt okunur GET'lere gecer
//   YKP2 kapi sirasi (kaynak): requireAuth -> adminOkumaKapisi -> sayfa -> sekme -> uclar; router
//        nginxRedCevirici `haric` listesinde DEGIL; ADMIN_DISI_OKUMA ornekli ve /durum'u kapsamaz
//   YKP3 kimlikler istemciden alinmaz: sunucu / template / limit / extra_vars kayittan, govdedeki
//        fazlalik yok sayilir; /durum ve /durdur is numarasini satirdan okur
//   YKP4 on kontrol 409 / 424 kodlari: her reddedilen istek AWX'e GITMEZ, kilit kalmaz, ret denetlenir
//   YKP5 basarili on kontrol: satir RUNNING + adim, T+L kilidi ise bagli, gecmiste senaryo maskeli
//   YKP6 kosu: on kontrol kapisi (sahip, DONE/OK, 15 dk, onay metni, engel, uyari onayi), G+T+L,
//        govdedeki hedef/parametre YOK SAYILIR, yeniden olcum (envanter uretime dondu -> red)
//   YKP7 AWX degiskenleri yuttu: is iptal, kilit o ise bagli, satir FAILED
//   YKP8 /durum: maskeli, artimli (since), playbook baglamasi, AWX okunamadi 424, arsiv yedegi
//   YKP9 /durdur: iptal + durdur kipi, satirdan kimlik, denetim
//   YKP10 senaryolar: dogrulama, sha256, yumusak silme
//   YKP11 karsilastir: kararVer DB adimlariyla; on kontrol karsilastirilmaz
//   YKP12 hedefler: uygun / degil + neden, yuk makineleri, sinirlar
//   -- tur 2 (2026-10-27 inceleme) --
//   YKP14 /durdur: baslatma penceresinde 409 baslatiliyor; kosu icin durdur isi yoksa 424
//         durdur_baslatilamadi (iptal basarili olsa da); baslarsa kilitler durdur isine baglanir
//   YKP15 baslatma yarisi: is numarasi her zaman yazilir; satir bu arada CANCELED olduysa is iptal
//   YKP16 /yeniden-oku: yalniz Admin, yalniz sonucu okunamamis is numarali kosu; sayac sifir
//   YKP17 /kosular suzgeci + sayfalama: islem / durum / hedef / onceki / limit, dahaVar, 400
//   YKP18 kosu ayrintisi: durdurIsi, sonuclandirmaDenemesi; olculmus limit 0 hedefi /hedefler'de kapali
//   YKP19 bayat kilit: baslatma yolu AWX durumunu iletir; kural bag turune gore birakir / tutar
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function sahte(rel, exports) {
  const p = Module._resolveFilename(path.join(__dirname, rel), module);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
// C'nin modulleri: poller.cModulu once require.cache'e bakar (dosya olmasa da sahte calisir).
function sahteC(ad, exports) {
  const p = path.join(__dirname, '..', ad);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const BAS = Date.parse('2026-10-27T10:00:00Z');
const D = {};
function sifirla() {
  Object.assign(D, {
    simdi: BAS,
    sorgular: [],
    senaryolar: [],
    kosular: [],
    adimlar: [],
    kilitler: new Map(),
    gecmis: [],
    arsiv: [],
    denetim: [],
    launch: [],
    iptal: [],
    statusCagri: [],
    ciktiCagri: [],
    registry: { enabled: true, awxTemplateId: 44, awxServerId: 3 },
    playbookUyusmaz: false,
    launchHata: null,
    launchKanca: null,
    iptalHata: null,
    yutulan: undefined,
    sonrakiIs: 900,
    awxDurum: { status: 'running', playbook: 'bmw_portal/nginx_loadtest/nginx_loadtest.yml', artifacts: {}, eventProcessingFinished: true },
    awxHata: null,
    cikti: 'TASK [x]\npassword=gizli123 ok\n',
    invHata: null,
    nginxEnv: { GBNGXT33: 'test' },
    invEnv: { GBNGXT33: 'Test', GBNGXT34: 'Test' },
    kilitDbHata: false,
    ayarlar: null,
    tetiklenen: [],
  });
}
sifirla();

// `locked_until = CASE ... DATEADD(SECOND, $n, ...)`: en az simdi + n sn (kisaltmaz).
function sureUzat(r, q, params) {
  const m = /locked_until = CASE WHEN locked_until IS NULL OR locked_until < DATEADD\(SECOND, \$(\d), GETUTCDATE\(\)\) THEN DATEADD\(SECOND, \$\1, GETUTCDATE\(\)\) ELSE locked_until END/.exec(q);
  if (!m) throw new Error(`sure uzatma ifadesi taninmadi: ${q}`);
  const hedef = D.simdi + Number(params[Number(m[1]) - 1]) * 1000;
  if (r.locked_until == null || r.locked_until < hedef) r.locked_until = hedef;
}

function kilitSorgusu(q, params) {
  const s = D.kilitler;
  if (/nginx_loadtest_kilitleri/.test(q) && D.kilitDbHata) throw new Error('kilit tablosu yok');
  if (/^IF NOT EXISTS \(SELECT 1 FROM nginx_loadtest_kilitleri/.test(q)) {
    if (!s.has(params[0])) s.set(params[0], { id: s.size + 1, lock_key: params[0], held: 0 });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET held = 1/.test(q)) {
    const r = s.get(params[0]);
    const dolmus = r && r.locked_until != null && r.locked_until < D.simdi;
    // Suresi dolmus kilit yalniz ise bagli degilse (ya da 12 saat once dolmussa) devralinir.
    const bos = r && (!r.held || (dolmus && r.awx_job_id == null) || (r.locked_until != null && r.locked_until < D.simdi - 12 * 3600000));
    if (!bos) return { rows: [], rowCount: 0 };
    Object.assign(r, { held: 1, holder: params[1], lock_id: params[2], target_desc: params[3], locked_until: D.simdi + params[4] * 60000, awx_server_id: null, awx_job_id: null, bag_turu: null });
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT TOP 1 lock_key/.test(q)) return { rows: s.has(params[0]) ? [{ ...s.get(params[0]) }] : [] };
  if (/^UPDATE nginx_loadtest_kilitleri SET held = 0,.* WHERE lock_key = \$1 AND lock_id = \$2/.test(q)) {
    const r = s.get(params[0]);
    if (!r || r.lock_id !== params[1] || !r.held) return { rows: [], rowCount: 0 };
    r.held = 0;
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = \$3, awx_job_id = \$4, bag_turu = \$5/.test(q)) {
    const r = s.get(params[0]);
    if (r && r.lock_id === params[1] && r.held) Object.assign(r, { awx_server_id: params[2], awx_job_id: params[3], bag_turu: params[4] });
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = \$2, awx_job_id = \$3, bag_turu = 'durdur', locked_until = CASE .* WHERE lock_id = \$1 AND held = 1$/.test(q)) {
    let n = 0;
    for (const r of s.values()) {
      if (r.held && r.lock_id === params[0]) {
        sureUzat(r, q, params);
        Object.assign(r, { awx_server_id: params[1], awx_job_id: params[2], bag_turu: 'durdur' });
        n += 1;
      }
    }
    return { rows: [], rowCount: n };
  }
  if (/^UPDATE nginx_loadtest_kilitleri SET awx_server_id = NULL, awx_job_id = NULL, bag_turu = NULL/.test(q)) {
    let n = 0;
    for (const r of s.values()) {
      if (r.held && r.awx_server_id === params[0] && r.awx_job_id === params[1]) {
        if (params.length > 2) sureUzat(r, q, params);
        Object.assign(r, { awx_server_id: null, awx_job_id: null, bag_turu: null });
        n += 1;
      }
    }
    return { rows: [], rowCount: n };
  }
  return null;
}

function kosuSatiri(r) {
  const sen = D.senaryolar.find((x) => x.id === r.senaryo_id);
  return {
    ...r, senaryo_ad: sen ? sen.ad : null, yas_sn: r.finished_at == null ? null : Math.round((D.simdi - r.finished_at) / 1000),
    olusma_yas_sn: r.created_at == null ? null : Math.round((D.simdi - Number(r.created_at)) / 1000),
  };
}

// Liste ucunun WHERE'i SQL metninden uygulanir (`k.<kolon> =|< $n`): sahte, yazilan sorgunun anlamini sinar.
function listeSuz(q, params) {
  if (!/ORDER BY k\.id DESC$/.test(q)) throw new Error(`liste sirasi bozuk: ${q}`);
  const m0 = q.match(/ WHERE (.*) ORDER BY k\.id DESC$/);
  const kosullar = m0 ? m0[1].split(' AND ') : [];
  return (x) => kosullar.every((c) => {
    const m = /^k\.(\w+) (=|<) \$(\d+)$/.exec(c);
    if (!m) throw new Error(`taninmayan liste kosulu: ${c}`);
    const v = params[Number(m[3]) - 1];
    return m[2] === '=' ? x[m[1]] === v : x[m[1]] < v;
  });
}

sahte('../../db/index.cjs', {
  query: async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ').trim();
    D.sorgular.push({ q, params });
    const k = kilitSorgusu(q, params);
    if (k) return k;
    if (/^SELECT id, ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by, created_at, silindi FROM nginx_loadtest_senaryolar WHERE id = \$1$/.test(q)) {
      return { rows: D.senaryolar.filter((x) => x.id === params[0]) };
    }
    if (/^SELECT TOP 200 id, ad, aciklama/.test(q)) return { rows: D.senaryolar.filter((x) => !x.silindi).slice().reverse() };
    if (/^INSERT INTO nginx_loadtest_senaryolar/.test(q)) {
      const [ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by] = params;
      const id = D.senaryolar.length + 1;
      D.senaryolar.push({ id, ad, aciklama, vhost, senaryo_tur, tsv, sha256, yol_sayisi, ozet, kaynak, created_by, created_at: new Date(D.simdi), silindi: 0 });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (/^UPDATE nginx_loadtest_senaryolar SET silindi = 1 WHERE id = \$1 AND silindi = 0$/.test(q)) {
      const s = D.senaryolar.find((x) => x.id === params[0] && !x.silindi);
      if (s) s.silindi = 1;
      return { rows: [], rowCount: s ? 1 : 0 };
    }
    if (/FROM nginx_loadtest_kosular k LEFT JOIN nginx_loadtest_senaryolar s ON s\.id = k\.senaryo_id WHERE k\.id = \$1$/.test(q)) {
      return { rows: D.kosular.filter((x) => x.id === params[0]).map(kosuSatiri) };
    }
    if (/^SELECT TOP \(\$1\)/.test(q)) {
      return { rows: D.kosular.filter(listeSuz(q, params)).sort((a, b) => b.id - a.id).slice(0, params[0]).map(kosuSatiri) };
    }
    if (/^INSERT INTO nginx_loadtest_kosular \(senaryo_id, on_kontrol_kosu_id, islem, etiket, hedef_host, hedef_ip, vhost, yuk_host, parametreler, durum, created_by, kilit_id\)/.test(q)) {
      const [senaryo_id, on_kontrol_kosu_id, islem, etiket, hedef_host, hedef_ip, vhost, yuk_host, parametreler, created_by, kilit_id] = params;
      const id = 100 + D.kosular.length + 1;
      D.kosular.push({ id, senaryo_id, on_kontrol_kosu_id, islem, etiket, hedef_host, hedef_ip, vhost, yuk_host, parametreler, created_by, kilit_id, durum: 'QUEUED', created_at: new Date(D.simdi), sonuclandirma_denemesi: 0 });
      return { rows: [{ id }], rowCount: 1 };
    }
    // Baslatma sonrasi: is numarasi is numarasiz satira HER ZAMAN yazilir; durum yalniz QUEUED ise RUNNING.
    if (/^UPDATE nginx_loadtest_kosular SET adim = \$2, awx_server_id = \$3, awx_job_id = \$4, sw_dizin = \$5, started_at = GETUTCDATE\(\), durum = CASE WHEN durum = 'QUEUED' THEN 'RUNNING' ELSE durum END WHERE id = \$1 AND awx_job_id IS NULL$/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0] && x.awx_job_id == null);
      if (r) Object.assign(r, { durum: r.durum === 'QUEUED' ? 'RUNNING' : r.durum, adim: params[1], awx_server_id: params[2], awx_job_id: params[3], sw_dizin: params[4], started_at: new Date(D.simdi) });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^SELECT durum FROM nginx_loadtest_kosular WHERE id = \$1$/.test(q)) return { rows: D.kosular.filter((x) => x.id === params[0]).map((x) => ({ durum: x.durum })) };
    if (/^UPDATE nginx_loadtest_kosular SET durdur_awx_server_id = \$2, durdur_awx_job_id = \$3 WHERE id = \$1$/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0]);
      if (r) Object.assign(r, { durdur_awx_server_id: params[1], durdur_awx_job_id: params[2] });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'FINALIZING', sonuclandirma_denemesi = 0 WHERE id = \$1 AND islem = 'kosu' AND awx_job_id IS NOT NULL AND \(durum = 'OKUNAMADI' OR gecerlilik = 'OKUNAMADI'\)$/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0] && x.islem === 'kosu' && x.awx_job_id != null && (x.durum === 'OKUNAMADI' || x.gecerlilik === 'OKUNAMADI'));
      if (r) Object.assign(r, { durum: 'FINALIZING', sonuclandirma_denemesi: 0 });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'FAILED', adim = \$2/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0] && x.durum === 'QUEUED');
      if (r) Object.assign(r, { durum: 'FAILED', adim: params[1], sonuc: params[2], awx_server_id: params[3], awx_job_id: params[4] });
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET iptal_eden = \$2 WHERE id = \$1$/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0]);
      if (r) r.iptal_eden = params[1];
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^UPDATE nginx_loadtest_kosular SET durum = 'CANCELED'/.test(q)) {
      const r = D.kosular.find((x) => x.id === params[0] && x.durum === 'QUEUED' && x.awx_job_id == null);
      if (r) r.durum = 'CANCELED';
      return { rows: [], rowCount: r ? 1 : 0 };
    }
    if (/^SELECT \* FROM nginx_loadtest_adimlar WHERE kosu_id = \$1/.test(q)) return { rows: D.adimlar.filter((x) => x.kosu_id === params[0]) };
    if (/^SELECT on_kontrol_ozet FROM nginx_loadtest_kosular WHERE id = \$1$/.test(q)) {
      return { rows: D.kosular.filter((x) => x.id === params[0]).map((x) => ({ on_kontrol_ozet: x.on_kontrol_ozet })) };
    }
    if (/^INSERT INTO ansible_job_history/.test(q)) {
      D.gecmis.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT TOP 1 stdout FROM ansible_job_output/.test(q)) return { rows: D.arsiv.filter((a) => a.sid === params[0] && a.jid === params[1]) };
    // poller.tetikle: sonuclandirma poller testinde olculur; burada yalniz TETIKLENDIGI.
    if (/^SELECT id, islem, durum, awx_server_id, awx_job_id, parametreler, .* FROM nginx_loadtest_kosular WHERE id = \$1$/.test(q)) {
      D.tetiklenen.push(params[0]);
      return { rows: [] };
    }
    throw new Error(`beklenmeyen Portal sorgusu: ${q}`);
  },
});

sahte('../../inventory/mssql.cjs', {
  sql: { NVarChar: (n) => `nvarchar(${n})` },
  query: async (q, params = []) => {
    if (D.invHata) throw D.invHata;
    const hostlar = new Set(params.map((p) => p.value));
    if (/FROM dbo\.nginx_inventory/.test(q)) {
      return { recordset: [
        { hostname: 'GBNGXT33', env: D.nginxEnv.GBNGXT33, ip: '10.0.0.5' },
        { hostname: 'GBNGXT34', env: 'test', ip: '10.0.0.6' },
        { hostname: 'GBNGXP40', env: 'Production', ip: '10.9.0.1' },
        { hostname: 'GBNGXT51', env: 'test', ip: '10.0.0.51' },
      ] };
    }
    if (/FROM dbo\.Inventory/.test(q)) return { recordset: Object.entries(D.invEnv).filter(([h]) => hostlar.has(h)).map(([host, env]) => ({ host, env })) };
    if (/OBJECT_ID/.test(q)) return { recordset: [{ oid: 7 }] };
    if (/FROM dbo\.Nginx_Audit_Servers/.test(q)) {
      return { recordset: [
        { host: 'GBNGXT33', listen: '10.0.0.9:443 ssl', server_name: 'app.test.local api.test.local' },
        { host: 'GBNGXT34', listen: '443 ssl', server_name: 'rp.test.local' },
      ].filter((r) => hostlar.has(r.host)) };
    }
    if (/FROM dbo\.Nginx_Audit_Settings/.test(q)) {
      return { recordset: (D.ayarlar || [
        { host: 'GBNGXT33', directive: 'limit_req_zone', value: '$binary_remote_addr zone=request_limit:20m rate=300r/s' },
        { host: 'GBNGXT33', directive: 'limit_req', value: 'zone=request_limit burst=200 nodelay' },
      ]).filter((r) => hostlar.has(r.host)) };
    }
    throw new Error(`beklenmeyen envanter sorgusu: ${q}`);
  },
});

sahte('../../auth/index.cjs', { requireAuth: (req, res, next) => (req.session && req.session.user ? next() : res.status(401).json({ ok: false, kimlik: true })) });
sahte('../../auth/visibility.cjs', {
  requireVisiblePrefix: (anahtar) => (req, res, next) => (req.gizli === anahtar ? res.status(403).json({ ok: false, gorunurluk: anahtar }) : next()),
  requireVisible: (anahtar) => (req, res, next) => (req.gizli === anahtar ? res.status(403).json({ ok: false, gorunurluk: anahtar }) : next()),
});
sahte('../../audit/index.cjs', { auditPortal: (req, eylem, o) => D.denetim.push({ eylem, ...o }) });
sahte('../../ansible/playbook-registry.cjs', { getByKey: async () => D.registry, getEffectiveTemplateId: (r) => r.awxTemplateId || null });
const uyusmaz = () => Object.assign(new Error('yanlis sablon'), { status: 409, code: 'awx_template_playbook_mismatch' });
sahte('../../ansible/template-preflight.cjs', {
  BEKLENEN_PLAYBOOK: { nginx_loadtest_run: 'nginx_loadtest.yml' },
  assertRegistryPlaybook: async () => { if (D.playbookUyusmaz) throw uyusmaz(); },
  assertTemplatePlaybook: async () => { if (D.playbookUyusmaz) throw uyusmaz(); },
  assertTemplateAcceptsExtraVars: async () => {},
  promptKapaliHatasi: ({ degiskenSayisi }) => Object.assign(new Error(`prompt kapali (${degiskenSayisi})`), { status: 409, code: 'awx_prompt_on_launch_disabled' }),
});
sahte('../../ansible/runner.cjs', {
  redactSecrets: (s) => s,
  getServerById: () => null,
  launchJobOnServer: async (...a) => {
    D.launch.push(a);
    if (D.launchKanca) await D.launchKanca(a);
    if (D.launchHata) throw D.launchHata;
    return { jobId: D.sonrakiIs++, status: 'pending', ...(D.yutulan ? { ignoredFields: D.yutulan } : {}) };
  },
  getJobStatusOnServer: async (sid, jid) => {
    D.statusCagri.push([sid, jid]);
    if (D.awxHata) throw D.awxHata;
    return { jobId: jid, ...D.awxDurum };
  },
  getJobOutputOnServer: async (sid, jid, o) => {
    D.ciktiCagri.push([sid, jid, o]);
    return { output: D.cikti };
  },
  cancelJobOnServer: async (sid, jid) => {
    D.iptal.push([sid, jid]);
    if (D.iptalHata) throw D.iptalHata;
    return { canceled: true };
  },
});
const kararCagri = [];
sahteC('analiz.cjs', {
  kararVer: (r, a, s) => (kararCagri.push({ r, a, s }), {
    karar: 'NOTR', nedenler: ['fark esik altinda'], tablo: [{ hiz: 100 }], kademe: { cpu: 100, p95: 100 }, kombinasyon: { senaryo: 'K', kip: 'yeni', ae: 'br' },
  }),
});

const IDX_YOL = path.join(__dirname, '..', 'index.cjs');
const yt = require('../index.cjs');
const dg = require('../dogrula.cjs');
const router = yt._yonlendiriciKurForTest();

const ADMIN = { user: { username: 'onur', role: 'Admin' } };
const KULLANICI = { user: { username: 'veli', role: 'User' } };

function istek(method, url, { session = ADMIN, body, gizli = null, query: sorgu = null } = {}) {
  const [yol, qs] = url.split('?');
  const query = sorgu || Object.fromEntries(new URLSearchParams(qs || ''));
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: null,
      headersSent: false,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; this.headersSent = true; resolve(this); return this; },
      setHeader() {}, getHeader() {},
    };
    const req = { method, url, headers: {}, session, body, query, gizli, get path() { return yol; } };
    router.handle(req, res, (err) => resolve({ statusCode: 'sonraki', body: { err: err && err.message } }));
  });
}

function senaryoEkle(ek = {}) {
  const s = dg.senaryoSatirlari([{ agirlik: 1, har: 1, tur: 'js', boyut: 'kucuk', yol: '/a.js' }, { agirlik: 2, har: 1, tur: 'css', boyut: 'orta', yol: '/b.css' }]);
  const id = D.senaryolar.length + 1;
  D.senaryolar.push({ id, ad: `S${id}`, aciklama: null, vhost: 'app.test.local', senaryo_tur: 'K', tsv: s.tsv, sha256: s.sha256, yol_sayisi: 2, ozet: null, kaynak: 'har', created_by: 'onur', created_at: new Date(BAS), silindi: 0, ...ek });
  return id;
}
const GOVDE = (ek = {}) => ({ senaryoId: 1, hedefHost: 'GBNGXT33', hedefIp: '10.0.0.9', vhost: 'app.test.local', yukHost: 'GBNGXT34', sni: false, parametreler: { hizlar: [100, 250] }, etiket: 'T0', ...ek });
const OK_OZET = {
  ip_yerel: true, server_name_var: true, master_sayisi: 1, web_log_df: 30, log_dizini_okunur: true, log_format_ua: true, statik_direktif: null,
  k6_var: true, k6_surum: 'k6 v0.49.0', k6_sha256: 'a'.repeat(64), yollar_toplam: 2, yollar_200: 2, ilk_hatalar: [], sikistirma: { statik: 0, dinamik: 2, sikistirmasiz: 0 },
};
/** Tamamlanmis on kontrol satiri (gercek on kontrol ucundan gecmis gibi). */
async function onKontrolHazirla({ ozet = OK_OZET, yasDk = 5, sahip = 'onur', durum = 'DONE', sonucDurum = 'OK' } = {}) {
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const k = D.kosular.find((x) => x.id === r.body.kosuId);
  Object.assign(k, { durum, created_by: sahip, finished_at: D.simdi - yasDk * 60000, sonuc: JSON.stringify({ durum: sonucDurum, run_id: String(k.id), islem: 'on_kontrol', on_kontrol: ozet }), on_kontrol_ozet: JSON.stringify(ozet) });
  for (const kl of D.kilitler.values()) kl.held = 0; // poller birakmis gibi
  return k;
}

test('YKP1 kapilar: oturum, Admin, sayfa/sekme gorunurlugu (davranis)', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  assert.equal((await istek('GET', '/hedefler', { session: null })).statusCode, 401);
  const yazanlar = [
    ['POST', '/senaryolar', {}], ['DELETE', '/senaryolar/1'], ['POST', '/kosular/on-kontrol', GOVDE()], ['POST', '/kosular', { onKontrolKosuId: 1 }],
    ['POST', '/kosular/1/durdur', {}], ['GET', '/kosular/1/durum'], ['PUT', '/senaryolar/1', {}], ['POST', '/kosular/1/yeniden-oku', {}],
  ];
  for (const [m, u, b] of yazanlar) {
    D.sorgular = [];
    const r = await istek(m, u, { session: KULLANICI, body: b });
    assert.equal(r.statusCode, 403, `${m} ${u}: Admin olmayan gecti`);
    assert.equal(D.sorgular.length, 0, `${m} ${u}: uc DB'ye dokundu`);
  }
  assert.equal(D.launch.length, 0);
  for (const u of ['/hedefler', '/senaryolar', '/senaryolar/1', '/kosular', '/kosular/101', '/karsilastir?ref=1&aday=2']) {
    const r = await istek('GET', u, { session: KULLANICI });
    assert.notEqual(r.statusCode, 403, `salt okunur ${u} Admin olmayana kapali`);
    assert.notEqual(r.statusCode, 401, u);
  }
  for (const anahtar of ['NginxConsole', 'tab:nginx:yuktesti']) {
    const r = await istek('GET', '/senaryolar', { session: KULLANICI, gizli: anahtar });
    assert.deepEqual([r.statusCode, r.body.gorunurluk], [403, anahtar], `${anahtar} kapisi uygulanmiyor`);
  }
  // Isleyici de Admin ister (kapi atlansa bile): dogrudan isleyici kontrolu kaynakta.
  const kod = fs.readFileSync(IDX_YOL, 'utf8');
  for (const uc of ["router.post('/senaryolar'", "router.delete('/senaryolar/:id'", "router.post('/kosular/on-kontrol'", "router.post('/kosular'", "router.get('/kosular/:id/durum'", "router.post('/kosular/:id/durdur'", "router.post('/kosular/:id/yeniden-oku'"]) {
    const i = kod.indexOf(uc);
    assert.ok(i > 0, uc);
    assert.match(kod.slice(i, i + 400), /adminSart\(req\)/, `${uc} isleyicide Admin denetlemiyor`);
  }
});

test('YKP2 kapi sirasi, nginxRed haric listesi, ADMIN_DISI_OKUMA', () => {
  const kod = fs.readFileSync(IDX_YOL, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const sira = ['router.use(requireAuth);', 'adminOkumaKapisi({', "router.use(requireVisiblePrefix('NginxConsole'));", "router.use(requireVisible('tab:nginx:yuktesti'));", "router.get('/hedefler'"];
  let onceki = -1;
  for (const s of sira) {
    const i = kod.indexOf(s);
    assert.ok(i > onceki, `kapi sirasi bozuk: ${s}`);
    onceki = i;
  }
  assert.match(kod, /app\.use\('\/api\/nginx-loadtest', yonlendiriciKur\(\)\)/);
  const servis = fs.readFileSync(path.join(__dirname, '..', '..', 'service.cjs'), 'utf8');
  const haric = servis.match(/haric:\s*\[([^\]]*)\]/);
  assert.ok(haric, 'nginxRedCevirici haric listesi okunamadi');
  assert.doesNotMatch(haric[1], /nginx-loadtest/, 'yuk testi router\'i haric: 403/404 govdeleri HTML\'e doner');
  const ornek = ['/hedefler', '/senaryolar', '/senaryolar/12', '/kosular', '/kosular/12', '/karsilastir'];
  for (const re of yt._ADMIN_DISI_OKUMA) assert.ok(ornek.some((o) => re.test(o)), `ornegi olmayan desen: ${re}`);
  for (const yasak of ['/kosular/12/durum', '/kosular/12/durdur', '/kosular/on-kontrol', '/senaryolar/12/sil', '/kosular/12/yeniden-oku']) {
    assert.ok(!yt._ADMIN_DISI_OKUMA.some((re) => re.test(yasak)), `${yasak} Admin olmayana acik`);
  }
});

test('YKP3 kimlikler istemciden alinmaz (baslatma, durum, durdurma)', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const r = await istek('POST', '/kosular/on-kontrol', {
    body: GOVDE({ awxServerId: 9, serverId: 9, jobId: 5, templateId: 77, limit: 'GBNGXP40', extra_vars: { yuk_hedef_host: 'GBNGXP40' }, LIMIT_MUAF: '1', yuk_maxvu: '500' }),
  });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(D.launch.length, 1);
  const [sid, tid, ev, limit] = D.launch[0];
  assert.deepEqual([sid, tid, limit], [3, 44, ''], 'sunucu/template kayittan, limit bos degil');
  assert.deepEqual(Object.keys(ev).sort(), [...dg.EKSTRA_ANAHTARLAR].sort(), 'govdedeki fazlalik extra_vars\'a sizdi');
  assert.equal(ev.yuk_hedef_host, 'GBNGXT33');
  assert.equal(ev.yuk_islem, 'on_kontrol');
  assert.equal(ev.yuk_run_id, String(r.body.kosuId));
  assert.deepEqual([r.body.awxServerId, r.body.jobId], [3, 900]);
  // Kayitta sunucu yoksa NGINX_LOADTEST_AWX_SERVER_ID, o da yoksa 1 - ASLA 0.
  D.registry = { enabled: true, awxTemplateId: 44, awxServerId: null };
  for (const k of D.kilitler.values()) k.held = 0;
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(D.launch[1][0], 1, 'sunucusuz kayit 0\'a dustu');
  // /durum ve /durdur: sorgudaki / govdedeki kimlik yok sayilir.
  const kosu = D.kosular[0];
  await istek('GET', `/kosular/${kosu.id}/durum?serverId=9&jobId=5`);
  assert.deepEqual(D.statusCagri.at(-1), [3, 900]);
  await istek('POST', `/kosular/${kosu.id}/durdur`, { body: { awxServerId: 9, jobId: 5 } });
  assert.deepEqual(D.iptal.at(-1), [3, 900]);
});

test('YKP4 on kontrol 409/424 kodlari: AWX\'e gitmez, kilit kalmaz, ret denetlenir', { timeout: 20000 }, async () => {
  const durumlar = [
    ['uretim hedefi', () => {}, GOVDE({ hedefHost: 'GBNGXP40' }), 409, 'hedef_uretim'],
    ['EDU hedefi', () => {}, GOVDE({ hedefHost: 'GBNGXT51' }), 409, 'hedef_uretim'],
    ['envanterde yok', () => {}, GOVDE({ hedefHost: 'GBNGXT99' }), 409, 'hedef_envanterde_yok'],
    ['envanter uretim isareti', () => { D.nginxEnv.GBNGXT33 = 'Production'; }, GOVDE(), 409, 'hedef_uretim'],
    ['Inventory uretim isareti', () => { D.invEnv.GBNGXT33 = 'PROD'; }, GOVDE(), 409, 'hedef_uretim'],
    ['izinsiz yuk makinesi', () => {}, GOVDE({ yukHost: 'GBNGXT33' }), 409, 'ayni_host'],
    ['listede olmayan yuk makinesi', () => {}, GOVDE({ yukHost: 'GBNGXD01' }), 409, 'yuk_host_izinsiz'],
    ['IP hedefte yok', () => {}, GOVDE({ hedefIp: '10.0.0.6' }), 409, 'ip_hedefte_yok'],
    ['vhost hedefte yok', () => {}, GOVDE({ vhost: 'baska.test.local' }), 409, 'vhost_hedefte_yok'],
    ['olculen limit_req asildi', () => {}, GOVDE({ parametreler: { hizlar: [271] } }), 409, 'sinir_asildi'],
    ['butce asildi', () => {}, GOVDE({ parametreler: { hizlar: [10, 20, 30, 40, 50], tekrar: 3, sure: 300 } }), 409, 'sinir_asildi'],
    ['senaryo yok', () => {}, GOVDE({ senaryoId: 99 }), 409, 'senaryo_yok'],
    ['silinmis senaryo', () => { D.senaryolar[0].silindi = 1; }, GOVDE(), 409, 'senaryo_yok'],
    ['bozulmus senaryo', () => { D.senaryolar[0].tsv += '1\t1\tjs\tkucuk\t/x\n'; }, GOVDE(), 409, 'senaryo_yok'],
    ['sablon yok', () => { D.registry = { enabled: true, awxTemplateId: null }; }, GOVDE(), 409, 'sablon_yok'],
    ['kayit kapali', () => { D.registry = { enabled: false, awxTemplateId: 44 }; }, GOVDE(), 409, 'sablon_yok'],
    ['kilit dolu', () => { D.kilitler.set('T|GBNGXT33', { lock_key: 'T|GBNGXT33', held: 1, lock_id: 'x', holder: 'ali', locked_until: BAS + 3600000 }); }, GOVDE(), 409, 'kilit_dolu'],
    ['yanlis sablon', () => { D.playbookUyusmaz = true; }, GOVDE(), 409, 'awx_template_playbook_mismatch'],
    ['envanter okunamadi', () => { D.invHata = new Error('TBMWANS kapali'); }, GOVDE(), 424, 'envanter_okunamadi'],
    ['kilit tablosu okunamadi', () => { D.kilitDbHata = true; }, GOVDE(), 424, 'db_okunamadi'],
    ['host CRLF', () => {}, GOVDE({ vhost: 'app.test.local\r\nX-Evil: 1' }), 400, 'gecersiz_istek'],
    ['host port', () => {}, GOVDE({ vhost: 'app.test.local:443' }), 400, 'gecersiz_istek'],
    ['IP metni', () => {}, GOVDE({ hedefIp: 'evil.com' }), 400, 'gecersiz_istek'],
    ['sni metin', () => {}, GOVDE({ sni: 'true' }), 400, 'gecersiz_istek'],
  ];
  for (const [ad, hazirla, govde, http, kod] of durumlar) {
    sifirla();
    senaryoEkle();
    hazirla();
    const r = await istek('POST', '/kosular/on-kontrol', { body: govde });
    assert.deepEqual([r.statusCode, r.body.code], [http, kod], `${ad}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, false, ad);
    assert.equal(D.launch.length, 0, `${ad}: AWX isi baslatildi`);
    if (kod !== 'kilit_dolu') {
      for (const [k, v] of D.kilitler) assert.ok(!v.held, `${ad}: ${k} kilidi tutulu kaldi`);
    }
    if (http === 409 || http === 424) {
      const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol');
      assert.ok(d && d.result === 'fail', `${ad}: ret denetime yazilmadi`);
    }
    // Kapilar satirdan ONCE: yalniz sablon dogrulamasi (AWX'e ilk temas) satir yazildiktan sonra
    // duser ve satir FAILED kalir; diger her red satir birakmaz.
    if (kod === 'awx_template_playbook_mismatch') assert.deepEqual(D.kosular.map((x) => x.durum), ['FAILED'], ad);
    else assert.equal(D.kosular.length, 0, `${ad}: kapidan once kosu satiri yazildi`);
  }
  // Kapidan ONCE red: hicbir kosu satiri olusmaz (sablon_yok dahil - sablon kilitten once cozulur).
  sifirla();
  senaryoEkle();
  D.registry = null;
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(D.kosular.length, 0);
});

test('YKP4b AWX baslatma hatasi: kesin ret kilidi birakir, belirsiz hata kilidi TTL\'e birakir', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  D.launchHata = Object.assign(new Error('400 variables_needed_to_start password=abc'), { status: 400 });
  let r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  assert.doesNotMatch(r.body.message, /abc/, 'AWX hata metni maskelenmedi');
  assert.ok([...D.kilitler.values()].every((k) => !k.held), 'kesin retten sonra kilit tutuldu');
  assert.equal(D.kosular[0].durum, 'FAILED');
  sifirla();
  senaryoEkle();
  D.launchHata = new Error('socket hang up');
  r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  assert.ok([...D.kilitler.values()].some((k) => k.held), 'belirsiz hatada kilit birakildi (is baslamis olabilir)');
  assert.equal(D.kosular[0].durum, 'FAILED');
  assert.match(D.kosular[0].sonuc, /"belirsiz":true/);
});

test('YKP5 basarili on kontrol: satir, kilitler, gecmis, denetim', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ sni: true }) });
  assert.equal(r.statusCode, 200);
  const k = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([k.durum, k.adim, k.awx_server_id, k.awx_job_id, k.islem, k.sw_dizin], ['RUNNING', `R${k.id}`, 3, 900, 'on_kontrol', null]);
  assert.deepEqual(JSON.parse(k.parametreler), { hizlar: [100, 250], tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60, maxvu: 150, kip: 'yeni', ae: 'br', sni: true, butceSn: 60 + 2 * 2 * (30 + 120 + 30 + 20) + 120 });
  assert.equal(D.launch[0][2].yuk_sni, '1');
  assert.deepEqual([...D.kilitler.keys()].sort(), ['L|GBNGXT34', 'T|GBNGXT33'], 'on kontrol global kilit aldi ya da hedef/yuk kilidini almadi');
  for (const v of D.kilitler.values()) assert.deepEqual([v.held, v.awx_server_id, v.awx_job_id], [1, 3, 900]);
  const params = JSON.parse(D.gecmis[0][6]);
  assert.match(params.yuk_senaryo_b64, /^<\d+ b64>$/, 'is gecmisine senaryo govdesi yazildi');
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_on_kontrol');
  assert.deepEqual([d.targetHost, d.targetIp], ['GBNGXT33', '10.0.0.9']);
  assert.ok(JSON.parse(d.detail).jobId === 900);
});

test('YKP6 kosu: on kontrol kapisi, istemci govdesi yok sayilir, yeniden olcum', { timeout: 20000 }, async () => {
  const kosuIste = (ok, ek = {}) => istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33', uyariOnay: false, ...ek } });
  const reddet = async (ad, hazirla, ek, kod, http = 409) => {
    sifirla();
    senaryoEkle();
    const ok = await hazirla();
    const once = D.launch.length;
    const r = await kosuIste(ok, ek);
    assert.deepEqual([r.statusCode, r.body.code], [http, kod], `${ad}: ${JSON.stringify(r.body)}`);
    assert.equal(D.launch.length, once, `${ad}: kosu baslatildi`);
    return r;
  };
  await reddet('yok', async () => ({ id: 555 }), {}, 'on_kontrol_eski');
  await reddet('baskasinin', () => onKontrolHazirla({ sahip: 'ali' }), {}, 'on_kontrol_eski');
  await reddet('bitmemis', () => onKontrolHazirla({ durum: 'RUNNING' }), {}, 'on_kontrol_eski');
  await reddet('OK degil', () => onKontrolHazirla({ sonucDurum: 'FAIL' }), {}, 'on_kontrol_eski');
  await reddet('16 dk once', () => onKontrolHazirla({ yasDk: 16 }), {}, 'on_kontrol_eski');
  await reddet('onay metni', () => onKontrolHazirla(), { confirmText: 'gbngxt33' }, 'onay_metni');
  await reddet('onay metni yok', () => onKontrolHazirla(), { confirmText: undefined }, 'onay_metni');
  await reddet('IP yerel degil', () => onKontrolHazirla({ ozet: { ...OK_OZET, ip_yerel: false } }), { uyariOnay: true }, 'on_kontrol_eski');
  const u = await reddet('uyari onaysiz', () => onKontrolHazirla({ ozet: { ...OK_OZET, yollar_200: 1, web_log_df: 70 } }), {}, 'uyari_onayi');
  assert.equal(u.body.uyarilar.length, 2);
  assert.match(u.body.uyarilar.join(), /1\/2 yol 200 dönmedi/);
  await reddet('uyariOnay metin', () => onKontrolHazirla({ ozet: { ...OK_OZET, web_log_df: 70 } }), { uyariOnay: 'true' }, 'uyari_onayi');
  // Olculmus master != 1 uyari degil ENGEL: uyariOnay ile de gecilmez (kaydedici baslamazdi).
  await reddet('master 2', () => onKontrolHazirla({ ozet: { ...OK_OZET, master_sayisi: 2 } }), { uyariOnay: true }, 'on_kontrol_eski');
  await reddet('envanter artik uretim', async () => {
    const ok = await onKontrolHazirla();
    D.invEnv.GBNGXT33 = 'Production';
    return ok;
  }, {}, 'hedef_uretim');
  await reddet('kosu satiri on kontrol degil', async () => {
    const ok = await onKontrolHazirla();
    ok.islem = 'kosu';
    return ok;
  }, {}, 'on_kontrol_eski');

  // Basari: uyarilar acikca onaylandi; govdedeki hedef/IP/parametre YOK SAYILIR.
  sifirla();
  senaryoEkle();
  const ok = await onKontrolHazirla({ ozet: { ...OK_OZET, sikistirma: { statik: 2 } } });
  const r = await kosuIste(ok, { uyariOnay: true, hedefHost: 'GBNGXP40', hedefIp: '10.9.0.1', yukHost: 'GBNGXT51', parametreler: { hizlar: [450], maxvu: 199 }, awxServerId: 9 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ev = D.launch.at(-1)[2];
  assert.deepEqual([ev.yuk_islem, ev.yuk_hedef_host, ev.yuk_hedef_ip, ev.yuk_yuk_host, ev.yuk_hizlar, ev.yuk_maxvu], ['kosu', 'GBNGXT33', '10.0.0.9', 'GBNGXT34', '100 250', '150']);
  assert.equal(D.launch.at(-1)[0], 3);
  const kosu = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([kosu.islem, kosu.on_kontrol_kosu_id, kosu.durum, kosu.sw_dizin], ['kosu', ok.id, 'RUNNING', `/sw/BMW_PORTAL/nginx_loadtest/${kosu.id}`]);
  assert.deepEqual([...D.kilitler.entries()].filter(([, v]) => v.held).map(([k]) => k).sort(), ['G|global', 'L|GBNGXT34', 'T|GBNGXT33']);
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_baslat');
  assert.ok(d && d.targetHost === 'GBNGXT33' && d.targetIp === '10.0.0.9');
  assert.match(JSON.parse(d.detail).onaylananUyarilar.join(), /ön-sıkıştırılmış/, 'onaylanan uyarilar denetime yazilmadi');
  // Ikinci kosu global kilitte durur.
  const r2 = await kosuIste(ok, { uyariOnay: true });
  assert.equal(r2.body.code, 'kilit_dolu');
});

test('YKP7 AWX degiskenleri yuttu: is iptal edilir, kilit o ise baglanir, satir FAILED', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  D.yutulan = ['extra_vars.yuk_islem', 'extra_vars.yuk_hedef_host'];
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([r.statusCode, r.body.code], [409, 'awx_prompt_on_launch_disabled']);
  assert.deepEqual(D.iptal, [[3, 900]], 'yutulan degiskenli is iptal edilmedi');
  for (const v of D.kilitler.values()) assert.deepEqual([v.held, v.awx_job_id], [1, 900], 'kilit iptal edilen ise baglanmadi');
  assert.deepEqual([D.kosular[0].durum, D.kosular[0].awx_job_id], ['FAILED', 900]);
});

test('YKP8 /durum: maskeli artimli cikti, playbook baglamasi, okunamadi ve arsiv', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const b = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  const id = b.body.kosuId;
  let r = await istek('GET', `/kosular/${id}/durum`);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.finished, false);
  assert.doesNotMatch(r.body.output, /gizli123/, 'cikti maskelenmedi');
  assert.deepEqual(D.ciktiCagri.at(-1)[2], { artimli: true }, 'suren is artimli okunmadi');
  const tam = r.body.output;
  r = await istek('GET', `/kosular/${id}/durum?since=5`);
  assert.deepEqual([r.body.output, r.body.outputOffset, r.body.outputLength], [tam.slice(5), 5, tam.length]);
  r = await istek('GET', `/kosular/${id}/durum?since=999999`);
  assert.equal(r.body.outputOffset, 0, 'metinden uzun since tamamini dondurmedi');
  // Bitti: tam cekim + sonuclandirma tetiklenir + set_stats maskeli doner.
  D.awxDurum = { ...D.awxDurum, status: 'successful', artifacts: { nginx_loadtest_result: JSON.stringify({ durum: 'OK', hata: 'token=abc123' }) } };
  D.sorgular = [];
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.body.status, r.body.finished], ['successful', true]);
  assert.deepEqual(D.ciktiCagri.at(-1)[2], { artimli: false });
  assert.equal(r.body.result.durum, 'OK');
  assert.doesNotMatch(JSON.stringify(r.body.result), /abc123/, 'set_stats maskelenmedi');
  await new Promise((s) => setImmediate(s));
  assert.deepEqual(D.tetiklenen, [id], 'biten is sonuclandirmaya tetiklenmedi');
  // Baska playbook'un ayni numarali isi gosterilmez.
  D.awxDurum = { ...D.awxDurum, playbook: 'bmw_portal/opsx_was/opsx_was_operation.yml' };
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'awx_template_playbook_mismatch']);
  D.awxDurum = { ...D.awxDurum, playbook: '' };
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  // AWX okunamadi 424; sunucu kapali / is silinmis -> arsiv (maskeli).
  D.awxHata = Object.assign(new Error('ETIMEDOUT'), { status: 504 });
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
  D.awxHata = Object.assign(new Error('sunucu yok'), { status: 404, code: 'awx_server_missing' });
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.code], [409, 'awx_okunamadi']);
  D.arsiv.push({ sid: 3, jid: 900, stdout: 'eski password=s3cret' });
  r = await istek('GET', `/kosular/${id}/durum`);
  assert.deepEqual([r.statusCode, r.body.kaynak, r.body.finished], [200, 'arsiv', true]);
  assert.doesNotMatch(r.body.output, /s3cret/);
  r = await istek('GET', '/kosular/999/durum');
  assert.deepEqual([r.statusCode, r.body.code], [409, 'kosu_yok']);
});

test('YKP9 /durdur: AWX iptal + durdur kipi playbook, satirdan kimlik, denetim', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const ok = await onKontrolHazirla();
  const r0 = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33' } });
  const id = r0.body.kosuId;
  const r = await istek('POST', `/kosular/${id}/durdur`, { body: {} });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(D.iptal.at(-1), [3, r0.body.jobId]);
  const ev = D.launch.at(-1)[2];
  assert.deepEqual([ev.yuk_islem, ev.yuk_run_id, ev.yuk_hedef_host], ['durdur', String(id), 'GBNGXT33']);
  assert.deepEqual(dg.ekstraDegiskenleriDenetle(ev), []);
  assert.ok(r.body.durdurIsi && r.body.durdurIsi.jobId);
  assert.equal(D.kosular.find((x) => x.id === id).iptal_eden, 'onur');
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_durdur' && x.targetHost === 'GBNGXT33'));
  // Durdurma ortam kapisindan GECMEZ (envanter uretime donmus olsa da durdurulur).
  D.invEnv.GBNGXT33 = 'Production';
  const r2 = await istek('POST', `/kosular/${id}/durdur`);
  assert.equal(r2.statusCode, 200);
  // Bitmis kosu durdurulmaz.
  D.kosular.find((x) => x.id === id).durum = 'DONE';
  const r3 = await istek('POST', `/kosular/${id}/durdur`);
  assert.deepEqual([r3.statusCode, r3.body.code], [409, 'kosu_bitti']);
});

test('YKP10 senaryolar: dogrulama, sha256, yumusak silme', { timeout: 10000 }, async () => {
  sifirla();
  const satirlar = [{ agirlik: 3, har: 1, tur: 'js', boyut: 'kucuk', yol: '/a.js' }];
  let r = await istek('POST', '/senaryolar', { body: { ad: 'GLOMO', senaryoTur: 'K', kaynak: 'har', vhost: 'app.test.local', satirlar, ozet: { K_satir: 1 } } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const s = D.senaryolar[0];
  assert.deepEqual([s.tsv, s.sha256, s.yol_sayisi, s.created_by], ['3\t1\tjs\tkucuk\t/a.js\n', dg.sha256Hex('3\t1\tjs\tkucuk\t/a.js\n'), 1, 'onur']);
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_senaryo_ekle'));
  r = await istek('POST', '/senaryolar', { body: { ad: 'X', senaryoTur: 'K', kaynak: 'har', satirlar: [{ ...satirlar[0], yol: '/a?token=1' }, { ...satirlar[0], yol: '//evil.com/x' }] } });
  assert.deepEqual([r.statusCode, r.body.code, r.body.hatalar.length], [400, 'gecersiz_istek', 2]);
  assert.equal(D.senaryolar.length, 1);
  r = await istek('GET', '/senaryolar/1');
  assert.deepEqual([r.body.senaryo.tsv, r.body.senaryo.ozet, r.body.senaryo.senaryoTur], [s.tsv, { K_satir: 1 }, 'K']);
  r = await istek('DELETE', '/senaryolar/1');
  assert.equal(r.statusCode, 200);
  assert.equal(D.senaryolar.length, 1, 'senaryo satiri silindi (yumusak olmali)');
  assert.deepEqual((await istek('GET', '/senaryolar')).body.senaryolar, []);
  assert.equal((await istek('GET', '/senaryolar/1')).body.code, 'senaryo_yok');
  assert.equal((await istek('DELETE', '/senaryolar/1')).body.code, 'senaryo_yok');
});

test('YKP11 karsilastir: DB adimlariyla kararVer; on kontrol karsilastirilmaz', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  D.kosular.push(
    { id: 1, islem: 'kosu', durum: 'DONE', etiket: 'T0', created_at: new Date(BAS), senaryo_id: 1 },
    { id: 2, islem: 'kosu', durum: 'DONE', etiket: 'T1', created_at: new Date(BAS), senaryo_id: 1 },
    { id: 3, islem: 'on_kontrol', durum: 'DONE', created_at: new Date(BAS), senaryo_id: 1 },
  );
  D.adimlar.push({ id: 1, kosu_id: 1, tur: 'R1_K_yeni_br_100_r1', hiz: 100, cpu_ms_istek: 0.5, nedenler: '["x"]', ham: null }, { id: 2, kosu_id: 2, tur: 'R2_K_yeni_br_100_r1', hiz: 100, cpu_ms_istek: 0.4, nedenler: null, ham: '{"a":1}' });
  const r = await istek('GET', '/karsilastir?ref=1&aday=2&esikCpu=5');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.karar, r.body.ref.etiket, r.body.aday.etiket], ['NOTR', 'T0', 'T1']);
  // kararVer'in kademe / kombinasyon'u ekrana gecer (UI CPU ve p95 kademesini bundan gosterir).
  assert.deepEqual([r.body.kademe, r.body.kombinasyon], [{ cpu: 100, p95: 100 }, { senaryo: 'K', kip: 'yeni', ae: 'br' }]);
  const c = kararCagri.at(-1);
  assert.deepEqual([c.r[0].tur, c.r[0].nedenler, c.a[0].ham, c.a[0].nedenler, c.s], ['R1_K_yeni_br_100_r1', ['x'], { a: 1 }, [], { esikCpu: 5 }]);
  assert.equal((await istek('GET', '/karsilastir?ref=1&aday=3')).body.code, 'kosu_yok');
  assert.equal((await istek('GET', '/karsilastir?ref=1')).statusCode, 400);
  assert.equal((await istek('GET', '/karsilastir?ref=1&aday=2&esikP95=500')).statusCode, 400);
});

test('YKP12 hedefler: uygunluk ve neden, yuk makineleri, sinirlar', { timeout: 10000 }, async () => {
  sifirla();
  const r = await istek('GET', '/hedefler');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const h = Object.fromEntries(r.body.hedefler.map((x) => [x.host, x]));
  assert.deepEqual([h.GBNGXT33.uygun, h.GBNGXT33.ipler, h.GBNGXT33.vhostlar, h.GBNGXT33.hizSiniri], [true, ['10.0.0.5', '10.0.0.9'], ['api.test.local', 'app.test.local'], 270]);
  assert.deepEqual([h.GBNGXP40.uygun, h.GBNGXP40.ipler], [false, []]);
  assert.match(h.GBNGXP40.neden, /üretim/);
  assert.equal(h.GBNGXT51.uygun, false, 'EDU hedef uygun gorundu');
  assert.deepEqual(r.body.yukHostlari, [{ host: 'GBNGXT34', env: 'TEST', uygun: true, neden: null }]);
  assert.equal(r.body.sinirlar.maxHiz, 450);
  assert.equal(r.body.sinirlar.maxButceSn, 2700);
  assert.deepEqual(r.body.varsayilan.hizlar, [100, 250, 400]);
  D.invHata = new Error('kapali');
  const r2 = await istek('GET', '/hedefler');
  assert.deepEqual([r2.statusCode, r2.body.code], [424, 'envanter_okunamadi']);
});

test('YKP13 kurulum: modul kaydi, tablolar + indeksler, sekme ve kayit seed\'leri, test dizini', () => {
  const kok = path.join(__dirname, '..', '..', '..');
  const oku = (p) => fs.readFileSync(path.join(kok, p), 'utf8');
  assert.match(oku('server/index.cjs'), /require\('\.\/nginx-loadtest\/index\.cjs'\)\.initNginxLoadtest\(app\)/, 'modul kayitli degil');
  const kur = oku('server/db/mssql-setup.cjs');
  for (const t of ['nginx_loadtest_senaryolar', 'nginx_loadtest_kosular', 'nginx_loadtest_adimlar', 'nginx_loadtest_kilitleri']) {
    assert.match(kur, new RegExp(`name: '${t}',\\s+sql: .\\s+CREATE TABLE ${t} \\(`), `${t} tablosu yok`);
  }
  assert.match(kur, /CREATE TABLE nginx_loadtest_kilitleri \([\s\S]*?UNIQUE\(lock_key\)/, 'kilit anahtari tekil degil');
  // Tur 2 kolonlari dogrudan CREATE TABLE icinde (tablolar hic dagitilmadi: ALTER yok).
  const tablo = (t) => {
    const i = kur.indexOf(`CREATE TABLE ${t} (`);
    return kur.slice(i, kur.indexOf('`', i));
  };
  for (const [t, kolon] of [
    ['nginx_loadtest_kosular', /\bkilit_id\s+NVARCHAR\(64\) NULL/],
    ['nginx_loadtest_kosular', /\bdurdur_awx_server_id\s+INT NULL/],
    ['nginx_loadtest_kosular', /\bdurdur_awx_job_id\s+INT NULL/],
    ['nginx_loadtest_kosular', /\bsonuclandirma_denemesi\s+INT NOT NULL DEFAULT 0/],
    ['nginx_loadtest_kilitleri', /\bbag_turu\s+NVARCHAR\(12\) NULL/],
  ]) assert.match(tablo(t), kolon, `${t}: ${kolon} kolonu yok`);
  for (const [ad, tablo, kolon] of [['IX_nlk_job', 'nginx_loadtest_kosular', 'awx_server_id, awx_job_id'], ['IX_nlk_hedef', 'nginx_loadtest_kosular', 'hedef_host, created_at'], ['IX_nla_kosu', 'nginx_loadtest_adimlar', 'kosu_id']]) {
    assert.ok(kur.includes(`{ name: '${ad}', table: '${tablo}', cols: '${kolon}' }`), `${ad} indeksi yok`);
  }
  const reg = kur.slice(kur.indexOf("key_name: 'nginx_loadtest_run',"), kur.indexOf("key_name: 'nginx_loadtest_run',") + 1200);
  assert.match(reg, /category: 'nginx',/);
  assert.match(reg, /env_var_name: 'NGINX_LOADTEST_RUN_TEMPLATE_ID',/);
  const tabSeed = kur.match(/const NGINX_TAB_KEYS_SEED = \[([\s\S]*?)\];/);
  assert.ok(tabSeed && /'yuktesti'/.test(tabSeed[1]), 'NGINX_TAB_KEYS_SEED yuktesti tasimiyor');
  assert.match(oku('scripts/run-tests.cjs'), /'server\/nginx-loadtest\/__tests__',/);
  // Kod sabitleri ile seed birbirini tutar.
  const baslat = require('../baslat.cjs');
  assert.equal(baslat.KAYIT_ANAHTARI, 'nginx_loadtest_run');
  assert.equal(baslat.BEKLENEN_PLAYBOOK_ADI, 'nginx_loadtest.yml');
});

/** Tamamlanmis on kontrolden baslatilmis kosu (RUNNING, kilitler kosu isine bagli). */
async function kosuBaslat() {
  const ok = await onKontrolHazirla();
  const r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  return { ...r.body, kosu: D.kosular.find((x) => x.id === r.body.kosuId) };
}

test('YKP14 /durdur: baslatma penceresi, kosu icin durdur isi zorunlu, kilitler durdur isine baglanir', { timeout: 20000 }, async () => {
  // (a) Baslatma suren satir (QUEUED, is numarasiz, 120 sn'den yeni): 409, hicbir sey yapilmaz.
  sifirla();
  senaryoEkle();
  const p = dg.parametreler({ hizlar: [100, 250] }, { sni: false }).deger;
  D.kosular.push({ id: 500, islem: 'kosu', durum: 'QUEUED', senaryo_id: 1, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', vhost: 'app.test.local', yuk_host: 'GBNGXT34', parametreler: JSON.stringify(p), created_at: new Date(D.simdi - 60 * 1000), kilit_id: 'yarim' });
  let r = await istek('POST', '/kosular/500/durdur');
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'baslatiliyor', 'Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin.']);
  assert.deepEqual([D.launch.length, D.iptal.length, D.kosular[0].durum, D.kosular[0].iptal_eden], [0, 0, 'QUEUED', undefined]);
  // 120 sn'den eski yarim satir eskisi gibi CANCELED olur; kosu oldugu icin durdur isi yine baslar.
  D.kosular[0].created_at = new Date(D.simdi - 121 * 1000);
  r = await istek('POST', '/kosular/500/durdur');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual([D.kosular[0].durum, D.launch.at(-1)[2].yuk_islem, D.iptal.length], ['CANCELED', 'durdur', 0]);

  // (b) Kosu: iptal basarili ama durdur isi baslatilamadi -> 424 durdur_baslatilamadi (BASARI DEGIL).
  sifirla();
  senaryoEkle();
  const k0 = await kosuBaslat();
  D.launchHata = Object.assign(new Error('AWX 503 Service Unavailable'), { status: 503 });
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.deepEqual([r.statusCode, r.body.code, r.body.ok], [424, 'durdur_baslatilamadi', false]);
  assert.deepEqual([r.body.iptal, r.body.iptalHatasi], [{ canceled: true }, null]);
  assert.equal(r.body.durdurHatasi, 'AWX işi başlatılamadı: AWX 503 Service Unavailable');
  assert.equal(r.body.message, "AWX işi iptal edildi, ancak durdurma işi başlatılamadı: AWX işi başlatılamadı: AWX 503 Service Unavailable. Uzaktaki k6 / kaydedici sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.");
  D.launchHata = Object.assign(new Error('AWX 503 password=gizli'), { status: 503 });
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.equal(r.body.code, 'durdur_baslatilamadi');
  assert.doesNotMatch(JSON.stringify(r.body), /gizli/, 'AWX hata metni maskelenmedi');
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.held, v.awx_job_id, v.bag_turu], [1, k0.jobId, 'kosu'], `${kk}: kilit kosu isinden ayrildi`);
  assert.equal(k0.kosu.durdur_awx_job_id, undefined);
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_durdur' && x.result === 'fail'), 'basarisiz durdur denetime yazilmadi');
  // Iptal de basarisiz: metin "iptal edilemedi".
  D.iptalHata = new Error('AWX 403');
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.deepEqual([r.statusCode, r.body.code, r.body.iptal], [424, 'durdur_baslatilamadi', null]);
  assert.match(r.body.message, /^AWX işi iptal edilemedi, ancak durdurma işi başlatılamadı: /);
  assert.match(r.body.iptalHatasi, /AWX 403/);

  // (c) Durdur isi basladi: satira yazilir, kilitler durdur isine baglanir, sure en az butce + 180.
  D.launchHata = null;
  D.iptalHata = null;
  D.simdi += 70 * 60000; // kosu kilidinin 5 dk'si kaldi
  const butce = JSON.parse(k0.kosu.parametreler).butceSn;
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['durdurHatasi', 'durdurIsi', 'iptal', 'iptalHatasi', 'ok']);
  assert.equal(r.body.durdurHatasi, null);
  const dj = r.body.durdurIsi.jobId;
  assert.deepEqual([k0.kosu.durdur_awx_server_id, k0.kosu.durdur_awx_job_id], [3, dj]);
  for (const [kk, v] of D.kilitler) {
    assert.deepEqual([v.held, v.awx_server_id, v.awx_job_id, v.bag_turu], [1, 3, dj, 'durdur'], kk);
    assert.equal(v.locked_until, D.simdi + (butce + 180) * 1000, `${kk}: sure butce + 180'e uzamadi`);
  }
  const g = await istek('GET', `/kosular/${k0.kosuId}`);
  assert.deepEqual(g.body.kosu.durdurIsi, { awxServerId: 3, awxJobId: dj });
  // CANCELED kosuya yeniden Durdur serbest (kalan surec temizligi); DONE 409 (YKP9).
  k0.kosu.durum = 'CANCELED';
  r = await istek('POST', `/kosular/${k0.kosuId}/durdur`);
  assert.equal(r.statusCode, 200);
  assert.equal(k0.kosu.durdur_awx_job_id, r.body.durdurIsi.jobId);

  // (d) Iptal BASARISIZ ama durdur isi basladi: kosu isi hala calisiyor olabilir; kilit kosu isinde kalir.
  sifirla();
  senaryoEkle();
  const k2 = await kosuBaslat();
  D.iptalHata = new Error('AWX 403');
  r = await istek('POST', `/kosular/${k2.kosuId}/durdur`);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.durdurIsi && /AWX 403/.test(r.body.iptalHatasi));
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.awx_job_id, v.bag_turu], [k2.jobId, 'kosu'], `${kk}: iptal edilemeyen kosunun kilidi durdur isine tasindi`);
  assert.equal(k2.kosu.durdur_awx_job_id, r.body.durdurIsi.jobId);

  // (e) On kontrol: durdur isi yok; 200, durdurIsi null; iptal edilemezse 424 (eskisi gibi).
  sifirla();
  senaryoEkle();
  const ok3 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  r = await istek('POST', `/kosular/${ok3.body.kosuId}/durdur`);
  assert.deepEqual([r.statusCode, r.body.durdurIsi, D.launch.length], [200, null, 1]);
  D.iptalHata = new Error('AWX kapali');
  r = await istek('POST', `/kosular/${ok3.body.kosuId}/durdur`);
  assert.deepEqual([r.statusCode, r.body.code], [424, 'awx_okunamadi']);
});

test('YKP15 baslatma yarisi: is numarasi yazilir; satir bu arada CANCELED olduysa is iptal edilir', { timeout: 20000 }, async () => {
  sifirla();
  senaryoEkle();
  const ok = await onKontrolHazirla();
  // Kosu AWX'e gonderilirken satir CANCELED oluyor (eski yarim satiri durduran baska bir istek gibi).
  D.launchKanca = async () => {
    const x = D.kosular.find((y) => y.islem === 'kosu' && y.durum === 'QUEUED');
    if (x) x.durum = 'CANCELED';
  };
  const r = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok.id, confirmText: 'GBNGXT33' } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const kosu = D.kosular.find((x) => x.id === r.body.kosuId);
  assert.deepEqual([kosu.durum, kosu.awx_job_id], ['CANCELED', r.body.jobId], 'is numarasi yazilmadi ya da CANCELED ezildi');
  assert.deepEqual(D.iptal, [[3, r.body.jobId]], 'takipsiz kalan is iptal edilmedi');
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.held, v.awx_job_id, v.bag_turu], [1, r.body.jobId, 'kosu'], kk);
  // Bayat kuyruk (FAILED) da ayni: is takipsiz kalmasin.
  sifirla();
  senaryoEkle();
  const ok2 = await onKontrolHazirla();
  D.launchKanca = async () => {
    const x = D.kosular.find((y) => y.islem === 'kosu' && y.durum === 'QUEUED');
    if (x) x.durum = 'FAILED';
  };
  const r2 = await istek('POST', '/kosular', { body: { onKontrolKosuId: ok2.id, confirmText: 'GBNGXT33' } });
  assert.deepEqual(D.iptal, [[3, r2.body.jobId]]);
  // Normal yol: RUNNING, iptal YOK; kilit_id satira yazildi ve kilitlerin lock_id'si.
  sifirla();
  senaryoEkle();
  const k = await kosuBaslat();
  assert.deepEqual([k.kosu.durum, D.iptal.length], ['RUNNING', 0]);
  assert.ok(k.kosu.kilit_id, 'kilit_id yazilmadi');
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.lock_id, v.bag_turu], [k.kosu.kilit_id, 'kosu'], kk);
  // On kontrolun kilidi 'on_kontrol' turuyle baglanir.
  sifirla();
  senaryoEkle();
  await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  for (const v of D.kilitler.values()) assert.equal(v.bag_turu, 'on_kontrol');
});

test('YKP16 /yeniden-oku: yalniz sonucu okunamamis is numarali kosu; sayac sifirlanir', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const satir = (id, ek) => ({ id, islem: 'kosu', awx_server_id: 3, awx_job_id: 70 + id, hedef_host: 'GBNGXT33', hedef_ip: '10.0.0.9', created_at: new Date(BAS), senaryo_id: 1, sonuclandirma_denemesi: 4, ...ek });
  D.kosular.push(
    satir(1, { durum: 'OKUNAMADI', gecerlilik: 'OKUNAMADI' }),
    satir(2, { durum: 'FAILED', gecerlilik: 'OKUNAMADI' }),
    satir(3, { durum: 'DONE', gecerlilik: 'GECERLI' }),
    satir(4, { islem: 'on_kontrol', durum: 'OKUNAMADI', gecerlilik: null }),
    satir(5, { durum: 'OKUNAMADI', gecerlilik: 'OKUNAMADI', awx_job_id: null }),
    satir(6, { durum: 'FAILED', gecerlilik: 'KISMI' }),
  );
  let r = await istek('POST', '/kosular/1/yeniden-oku');
  assert.deepEqual([r.statusCode, r.body], [200, { ok: true }]);
  assert.deepEqual([D.kosular[0].durum, D.kosular[0].sonuclandirma_denemesi], ['FINALIZING', 0]);
  await new Promise((s) => setImmediate(s));
  assert.deepEqual(D.tetiklenen, [1], 'poller tetiklenmedi');
  const d = D.denetim.find((x) => x.eylem === 'nginx_loadtest_yeniden_oku');
  assert.ok(d && d.targetHost === 'GBNGXT33' && d.targetIp === '10.0.0.9' && d.result !== 'fail', 'yeniden okuma denetime yazilmadi');
  r = await istek('POST', '/kosular/2/yeniden-oku');
  assert.equal(r.statusCode, 200, 'FAILED + gecerlilik OKUNAMADI yeniden okunamadi');
  for (const id of [3, 4, 5, 6, 99]) {
    r = await istek('POST', `/kosular/${id}/yeniden-oku`);
    assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'yeniden_okunamaz', 'Yalnız sonucu okunamamış koşular yeniden okunabilir.'], String(id));
  }
  assert.deepEqual(D.kosular.slice(2).map((x) => x.durum), ['DONE', 'OKUNAMADI', 'OKUNAMADI', 'FAILED'], 'reddedilen satir degisti');
  assert.ok(D.denetim.some((x) => x.eylem === 'nginx_loadtest_yeniden_oku' && x.result === 'fail'), 'ret denetime yazilmadi');
  assert.equal((await istek('POST', '/kosular/abc/yeniden-oku')).statusCode, 400);
});

test('YKP17 /kosular: islem / durum / hedef suzgeci, onceki sayfalama, dahaVar, gecersiz deger 400', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  for (let i = 1; i <= 7; i += 1) {
    D.kosular.push({ id: i, islem: i % 2 ? 'kosu' : 'on_kontrol', durum: i <= 4 ? 'DONE' : 'FAILED', hedef_host: i === 7 ? 'GBNGXT40' : 'GBNGXT33', created_at: new Date(BAS), senaryo_id: 1 });
  }
  const ids = (b) => b.kosular.map((x) => x.id);
  let r = await istek('GET', '/kosular');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[7, 6, 5, 4, 3, 2, 1], false]);
  r = await istek('GET', '/kosular?islem=kosu&durum=DONE&limit=200');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[3, 1], false]);
  r = await istek('GET', '/kosular?limit=2');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[7, 6], true]);
  r = await istek('GET', '/kosular?limit=2&onceki=6');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[5, 4], true]);
  r = await istek('GET', '/kosular?limit=2&onceki=3');
  assert.deepEqual([ids(r.body), r.body.dahaVar], [[2, 1], false]);
  r = await istek('GET', '/kosular?hedef=gbngxt40&islem=kosu');
  assert.deepEqual(ids(r.body), [7]);
  r = await istek('GET', '/kosular?durum=FAILED&onceki=7');
  assert.deepEqual(ids(r.body), [6, 5]);
  // Degerler SQL metnine gomulmez; TOP limit + 1 (fazlasi dahaVar).
  const son = D.sorgular.filter((s) => /^SELECT TOP \(\$1\)/.test(s.q)).at(-1);
  assert.doesNotMatch(son.q, /FAILED|'7'|\b7\b/, 'suzgec degeri SQL metnine gomuldu');
  assert.deepEqual(son.params, [51, 'FAILED', 7]);
  for (const bozuk of ['islem=x', 'islem=KOSU', 'durum=done', 'durum=BITTI', 'limit=0', 'limit=201', 'limit=abc', 'limit=-1', 'onceki=0', 'onceki=abc', 'onceki=-3', 'hedef=GB%20NG']) {
    r = await istek('GET', `/kosular?${bozuk}`);
    assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek'], bozuk);
  }
  // Tekrarlanan parametre (dizi) de gecersiz: sessizce ilkini almaz. Tek elemanli dizi metne
  // cevrilince gecerli bir ada donusurdu (String(['X']) === 'X'): tur denetimi bunu da reddeder.
  for (const query of [{ islem: ['kosu', 'on_kontrol'] }, { hedef: ['GBNGXT33'] }, { onceki: ['3'] }]) {
    r = await istek('GET', '/kosular', { query });
    assert.deepEqual([r.statusCode, r.body.code], [400, 'gecersiz_istek'], JSON.stringify(query));
  }
  // Admin olmayan da suzer (salt okunur uc).
  r = await istek('GET', '/kosular?islem=kosu', { session: KULLANICI });
  assert.deepEqual(ids(r.body), [7, 5, 3, 1]);
});

test('YKP18 kosu ayrintisi yeni alanlar; olculmus limit 0 hedefi kapatir', { timeout: 10000 }, async () => {
  sifirla();
  senaryoEkle();
  const r0 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  let g = await istek('GET', `/kosular/${r0.body.kosuId}`);
  assert.deepEqual([g.body.kosu.durdurIsi, g.body.kosu.sonuclandirmaDenemesi], [null, 0]);
  D.kosular[0].sonuclandirma_denemesi = 2;
  g = await istek('GET', `/kosular/${r0.body.kosuId}`);
  assert.equal(g.body.kosu.sonuclandirmaDenemesi, 2);
  assert.ok(!JSON.stringify(g.body).includes(D.kosular[0].kilit_id), 'kilit kimligi ekrana sizdi');
  // 1 r/s zone: tavan 0 -> hedef /hedefler'de kapali (ayni metin), baslatma 409.
  sifirla();
  senaryoEkle();
  D.ayarlar = [
    { host: 'GBNGXT33', directive: 'limit_req_zone', value: '$binary_remote_addr zone=login:10m rate=1r/s' },
    { host: 'GBNGXT33', directive: 'limit_req', value: 'zone=login burst=5' },
  ];
  const h = await istek('GET', '/hedefler');
  const t33 = h.body.hedefler.find((x) => x.host === 'GBNGXT33');
  assert.deepEqual([t33.uygun, t33.kod, t33.neden, t33.hizSiniri], [false, 'sinir_asildi', dg.SIFIR_SINIR_MESAJI, 0]);
  assert.ok(t33.ipler.length > 0, 'IP yoklugu limit nedenini maskeledi');
  const r = await istek('POST', '/kosular/on-kontrol', { body: GOVDE({ parametreler: { hizlar: [1], maxvu: 10 } }) });
  assert.deepEqual([r.statusCode, r.body.code, r.body.message], [409, 'sinir_asildi', dg.SIFIR_SINIR_MESAJI]);
  assert.equal(D.launch.length, 0);
});

test('YKP19 bayat kilit: baslatma yolu AWX durumunu iletir; kural bag turune gore birakir / tutar', { timeout: 10000 }, async () => {
  // Biten (successful) on kontrolun kilidi supurme gelmeden dolu: yeni on kontrol devralir.
  sifirla();
  senaryoEkle();
  const r1 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(r1.statusCode, 200);
  D.awxDurum = { ...D.awxDurum, status: 'successful' };
  const r2 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.equal(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.ok(D.statusCagri.some(([sid, jid]) => sid === 3 && jid === r1.body.jobId), 'bayat kilidin isi AWX\'e sorulmadi');
  // Iptal edilen KOSU isinin kilidi: uzak k6 surebilir -> 409 kilit_dolu; TUM kilitler isten cozulur.
  sifirla();
  senaryoEkle();
  const k = await kosuBaslat();
  D.awxDurum = { ...D.awxDurum, status: 'canceled' };
  const r3 = await istek('POST', '/kosular/on-kontrol', { body: GOVDE() });
  assert.deepEqual([r3.statusCode, r3.body.code], [409, 'kilit_dolu'], JSON.stringify(r3.body));
  for (const [kk, v] of D.kilitler) assert.deepEqual([v.held, v.lock_id, v.awx_job_id, v.bag_turu], [1, k.kosu.kilit_id, null, null], kk);
});
