// server/nginx-console/index.cjs — "Nginx Hub" (2026-09-19): tum nginx sunucularinin
// konfigurasyon agaci, dosya icerikleri, sertifika envanteri ve TEK dosya push'u.
//
// MIMARI (kullanici kisitlari): Portal sunuculara YALNIZ Ansible ile ulasir; nginx
// dosyalarina www kullanicisiyla (dzdo) dokunulur. Bu yuzden:
//   - OKUMA: nginx_console_fetch.yml secilen host(lar)ta files/nginx_console_dump.sh'i kosar,
//     ciktiyi GBLABT02 uzerinden /sw/BMW_PORTAL/nginx_console/raw/<HOST>.txt'ye yazar;
//     Portal AYNI mount'u dogrudan okur (bkz. hafiza: Portal /sw'ye dogrudan erisir).
//     Tum filo taramasi 30-40 dk surer (kullanici deneyimi) -> ekrandaki "Yenile" yalniz
//     secilen hostlari gonderir; tam tarama AWX'te gece zamanlanir.
//   - YAZMA: nginx_console_push.yml (yol beyaz listesi, deployment kilidi, yedek, nginx -t,
//     geri alma, reload) ve ardindan o host'un dokumu yenilenir. Yalniz Admin.
//
// Dokum ayristirma SAF modulde (dump-parse.cjs) — test edilir. Bu dosya: HTTP + AWX + cache.
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseDump, buildTree, aggregateCerts, daysLeft, orphansOf } = require('./dump-parse.cjs');
const history = require('./history.cjs');

const REGISTRY_KEYS = Object.freeze({
  fetch: 'nginx_console_fetch',
  push: 'nginx_console_push',
});

function consoleDir() {
  return (process.env.NGINX_CONSOLE_DIR || '/sw/BMW_PORTAL/nginx_console').replace(/\/+$/, '');
}
function rawDir() {
  return path.join(consoleDir(), 'raw');
}

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/;
const ALLOWED_PATH_RE = /^\/usr\/nginx\/(conf\.d|conf)\/[^\0]+$/;
const MAX_CONTENT = 512 * 1024;

// ── Dokum onbellegi ───────────────────────────────────────────────────────────────────
// URETIM OOM'U (2026-09-20, "Reached heap limit ... Runtime_StringSplit"): ilk surum HER
// host'un TAM ayristirilmis dokumunu (dosya icerikleri dahil) bellekte tutuyordu ve /hosts,
// /certs, gecmis taramasi 311 host'u birden yukluyordu -> GB'larca heap. Simdi iki katman:
//   - OZET (summary): agac (yol/sha/boyut/mtime/sahip), nginx -t, sertifikalar, kullanimlar —
//     dosya ICERIGI YOK. Host basina ~50 KB. raw/<HOST>.summary.json yan dosyasina yazilir
//     (mtime damgali); bellekte de kucuk bir harita. /hosts, /certs, /tree, /compare, /push bunu okur.
//   - TAM (full): icerikli ayristirma yalniz /file icin, en fazla 4 host LRU. Yeni dokumda bir
//     kez tam ayristirilir (ozet + gecmis ingest), sonra birakilir.
const _summaries = new Map(); // HOST -> { mtimeMs, summary }
const _full = new Map(); // HOST -> { mtimeMs, parsed }  (LRU, FULL_MAX)
const FULL_MAX = 4;

function dumpPathOf(host) {
  return path.join(rawDir(), `${String(host).toUpperCase()}.txt`);
}
function summaryPathOf(host) {
  return path.join(rawDir(), `${String(host).toUpperCase()}.summary.json`);
}

function statDump(host) {
  try {
    return fs.statSync(dumpPathOf(host));
  } catch {
    return null;
  }
}

// DOKUM BOYUT TAVANI.
//
// 2026-09-20 OOM'unda (`f1b1ee2`) KAC dokumun bellekte tutuldugu sinirlandi
// (`FULL_MAX = 4`), ama TEK BIR dokumun NE KADAR BUYUK olabilecegi hic
// kontrol edilmedi. Dosyayi AWX yaziyor (`nginx_console_dump.sh`) ve icinde
// `@@FILE` bloklariyla TUM nginx conf agaci var — conf agaci sismis tek bir
// host 50-200 MB uretebilir. `parseDump` ustune `split('\n')` yapiyor
// (`dump-parse.cjs:19`), yani heap'te birkac kati. 4 x 200 MB yine OOM demekti.
//
// Kod yorumu "host basina ~2 MB" diyordu — bu bir GOZLEM, bir SINIR degildi.
const DUMP_MAX_BYTES = 24 * 1024 * 1024;

/**
 * Tavani asan dokum icin firlatilir. `tooLarge` isareti cagiranin bunu
 * "okunamadi" degil "cok buyuk" diye AYIRT etmesini saglar — kullanici
 * bos bir ekran yerine ne yapacagini soyleyen bir mesaj gorur.
 */
function dumpTooLargeError(host, boyut) {
  return Object.assign(
    new Error(
      `${String(host).toUpperCase()} dokumu portalin isleyebilecegi boyutu asiyor ` +
        `(${Math.round(boyut / (1024 * 1024))} MB > ` +
        `${Math.round(DUMP_MAX_BYTES / (1024 * 1024))} MB). ` +
        'Dokum sunucuda incelenmeli.',
    ),
    { status: 413, tooLarge: true, host: String(host).toUpperCase(), size: boyut },
  );
}

function parseFull(host, st) {
  // `st` ZATEN bir `fs.Stats` — boyut elimizde, ek bir sistem cagrisi gerekmiyor.
  if (st.size > DUMP_MAX_BYTES) throw dumpTooLargeError(host, st.size);
  const parsed = parseDump(fs.readFileSync(dumpPathOf(host), 'utf8'));
  parsed.dumpedAt = st.mtime.toISOString();
  parsed.host = parsed.host || host.toUpperCase();
  return parsed;
}

function summaryOf(parsed, mtimeMs, ingested) {
  return {
    mtimeMs,
    ingested: !!ingested,
    host: parsed.host,
    dumpedAt: parsed.dumpedAt,
    time: parsed.time,
    prefix: parsed.prefix,
    nginxT: parsed.nginxT,
    tree: parsed.tree,
    certs: [...parsed.certs.values()],
    certUses: parsed.certUses,
    fileCount: parsed.tree.length,
    loaded: parsed.loaded, // nginx -T'nin yukledigi dosyalar (eski dokumda null)
    sslFiles: parsed.sslFiles,
  };
}
function writeSummary(host, summary) {
  try {
    const p = summaryPathOf(host);
    const tmp = p + '.tmp' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(summary));
    fs.renameSync(tmp, p);
  } catch (e) {
    console.warn('[NginxHub] ozet yazilamadi:', host, e.message);
  }
}

/** Ozet (icerik YOK). Yeni dokumda bir kez tam ayristirir, ozeti yazar, gecmisi isler. */
function loadSummary(host) {
  const H = String(host).toUpperCase();
  const st = statDump(H);
  if (!st) return null;
  const hit = _summaries.get(H);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.summary;
  // yan dosya
  try {
    const raw = JSON.parse(fs.readFileSync(summaryPathOf(H), 'utf8'));
    if (raw && raw.mtimeMs === st.mtimeMs) {
      _summaries.set(H, { mtimeMs: st.mtimeMs, summary: raw });
      if (!raw.ingested) scheduleIngest(H, st);
      return raw;
    }
  } catch { /* yok/bozuk -> yeniden uret */ }
  // COK BUYUK DOKUM HOST'U LISTEDEN DUSURMEZ.
  //
  // Bu fonksiyon `/hosts` icin 311 host'un hepsinde cagriliyor. Tavani asan TEK
  // bir dokumun burada firlatmasina izin verseydik, o tek host yuzunden TUM host
  // listesi 500 donerdi — bir bellek korumasinin butun ekrani karartmasi.
  // Bunun yerine host listede KALIR ve `tooLarge` bayragiyla NEDENINI soyler.
  let tam;
  try {
    tam = parseFull(H, st);
  } catch (e) {
    if (!e || !e.tooLarge) throw e;
    console.warn('[NginxHub] dokum cok buyuk, ozet uretilemedi:', H, e.message);
    const bozuk = {
      mtimeMs: st.mtimeMs,
      ingested: false,
      host: H,
      dumpedAt: st.mtime.toISOString(),
      tooLarge: true,
      tooLargeBytes: st.size,
      error: e.message,
      tree: [],
      certs: [],
      certUses: {},
      fileCount: 0,
    };
    _summaries.set(H, { mtimeMs: st.mtimeMs, summary: bozuk });
    // Yan dosyaya YAZILMAZ: dokum kuculdugunde (ya da tavan yukseldiginde)
    // yeniden denensin; "cok buyuk" kararini diske kalici yazmak, duzelmis bir
    // dokumu sonsuza dek bozuk gosterirdi.
    return bozuk;
  }
  // JSON gidis-donus BILEREK: split()/slice() ile uretilen alt-dizgeler V8'de "sliced string"
  // olur ve 2 MB'lik ham dokum metnini canli tutar (120 host x 2 MB = 274 MB, MEM1 testi).
  // JSON.parse duz kopyalar uretir; tam ayristirma bu satirdan sonra cop olur.
  const summary = JSON.parse(JSON.stringify(summaryOf(tam, st.mtimeMs, false)));
  _summaries.set(H, { mtimeMs: st.mtimeMs, summary });
  writeSummary(H, summary);
  runIngest(H, st);
  return summary;
}

// Gecmis ingest: tam ayristirma gerektirir. TEK ISCI KUYRUGU — ayni anda en fazla BIR
// host'un icerikli dokumu bellekte (311 host'un tam dokumunu ayni anda tutmak OOM'du).
// Kuyrukta ayristirilmis veri DEGIL, yalniz (host, mtime) durur; isci sirasi gelince ayristirir.
const _ingestQueue = [];
const _queued = new Set();
let _ingestBusy = false;
function runIngest(H, st) {
  if (_queued.has(H)) return;
  _queued.add(H);
  _ingestQueue.push({ H, mtimeMs: st.mtimeMs });
  pumpIngest();
}
function pumpIngest() {
  if (_ingestBusy) return;
  const job = _ingestQueue.shift();
  if (!job) return;
  _ingestBusy = true;
  (async () => {
    const { H, mtimeMs } = job;
    try {
      const st = statDump(H);
      if (!st || st.mtimeMs !== mtimeMs) return; // dokum bu arada degisti; yeni mtime ayrica kuyruga girer
      const parsed = parseFull(H, st);
      const r = await history.ingestDump(parsed);
      if (r) {
        const cur = _summaries.get(H);
        if (cur && cur.mtimeMs === mtimeMs) {
          cur.summary.ingested = true;
          writeSummary(H, cur.summary);
        }
      }
    } catch (e) {
      console.warn('[NginxHub] ingest hatasi:', H, e.message);
    } finally {
      _queued.delete(H);
      _ingestBusy = false;
      setImmediate(pumpIngest);
    }
  })();
}
function scheduleIngest(H, st) {
  runIngest(H, st);
}
/** Arka plan taramasi icin: ozet guncel + ingest edilmis degilse isler. */
function ensureIngested(host) {
  const sum = loadSummary(host);
  if (sum && !sum.ingested) {
    const st = statDump(host);
    if (st && st.mtimeMs === sum.mtimeMs) scheduleIngest(String(host).toUpperCase(), st);
  }
  return sum;
}

/** TAM dokum (icerikler dahil) — yalniz /file; LRU. */
function loadFull(host) {
  const H = String(host).toUpperCase();
  const st = statDump(H);
  if (!st) return null;
  const hit = _full.get(H);
  if (hit && hit.mtimeMs === st.mtimeMs) {
    _full.delete(H);
    _full.set(H, hit); // LRU: en yeni sona
    return hit.parsed;
  }
  const parsed = parseFull(H, st);
  _full.set(H, { mtimeMs: st.mtimeMs, parsed });
  while (_full.size > FULL_MAX) _full.delete(_full.keys().next().value);
  loadSummary(H); // ozet/ingest de guncel olsun
  return parsed;
}

// Geriye uyumluluk (eski ad): OZET doner, icerik icermez.
const loadDump = loadSummary;

function listDumpedHosts() {
  try {
    return fs
      .readdirSync(rawDir())
      .filter((f) => f.endsWith('.txt') && !f.endsWith('.summary.json'))
      .map((f) => {
        const st = fs.statSync(path.join(rawDir(), f));
        return { host: f.slice(0, -4).toUpperCase(), dumpedAt: st.mtime.toISOString(), size: st.size };
      });
  } catch {
    return [];
  }
}

// ── Son gorulme (raw/_seen.json) ─────────────────────────────────────────────────────
// "Cogu sunucu Offline" (kullanici, 2026-09-22): fetch playbook'u parmak izi degismeyen
// sunucuda dokumu YENIDEN YAZMAZ (dogru), ama Portal "online"i dokum dosyasinin mtime'indan
// turetiyordu -> konfigurasyonu 2 gundur degismeyen her sunucu Offline gorunuyordu. Playbook
// artik her kosuda ulasabildigi sunuculari raw/_seen.json'a yazar ({at, hosts: {HOST: iso}};
// secili host yenilemesi digerlerini SILMEZ, playbook birlestirir); son gorulme =
// max(dokum mtime, seen[host]). Dosya yoksa eski davranis (yalniz dokum mtime).
let _seen = { mtimeMs: 0, at: null, hosts: new Map() };
function seenMap() {
  const p = path.join(rawDir(), '_seen.json');
  try {
    const st = fs.statSync(p);
    if (st.mtimeMs !== _seen.mtimeMs) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
      const at = j.at && !Number.isNaN(new Date(j.at).getTime()) ? new Date(j.at).toISOString() : st.mtime.toISOString();
      const hosts = new Map();
      if (Array.isArray(j.hosts)) for (const h of j.hosts) hosts.set(String(h).toUpperCase(), at);
      else if (j.hosts && typeof j.hosts === 'object') for (const [h, v] of Object.entries(j.hosts)) { const d = new Date(v); if (!Number.isNaN(d.getTime())) hosts.set(String(h).toUpperCase(), d.toISOString()); }
      _seen = { mtimeMs: st.mtimeMs, at, hosts };
    }
  } catch {
    _seen = { mtimeMs: 0, at: null, hosts: new Map() };
  }
  return _seen;
}
/** Sunucunun son gorulme zamani: dokum mtime ile _seen.json kaydinin buyugu (ikisi de yoksa null). */
function seenAtOf(host, dumpedAt) {
  const s = seenMap();
  const a = dumpedAt ? new Date(dumpedAt).getTime() : 0;
  const v = s.hosts.get(String(host).toUpperCase());
  const b = v ? new Date(v).getTime() : 0;
  const m = Math.max(a || 0, b || 0);
  return m > 0 ? new Date(m).toISOString() : null;
}

// ── Envanter: nginx sunuculari (dbo.nginx_inventory, nginx_metadata job'i) ──────────────
// + dbo.Inventory'den kaynak (cpu, memory GB, os) — Dashboard "Kaynaklar" ve "Pendik/Ankara"
// kartlari icin (kullanici, 2026-09-22). Inventory sorgusu dusse de liste gelir (kaynak null).
async function inventoryHosts() {
  const { query } = require('../inventory/mssql.cjs');
  const r = await query(
    `SELECT hostname, env, location, service, services, nginx_version, nginx_prefix, config_count, ip
       FROM dbo.nginx_inventory ORDER BY env, service, hostname`,
  );
  let res = new Map();
  try {
    const rr = await query(
      `SELECT host, TRY_CONVERT(float, cpu) AS cpu, TRY_CONVERT(float, memory) AS memory, os, os_version FROM dbo.Inventory WHERE nginx_version IS NOT NULL AND LTRIM(RTRIM(nginx_version)) <> ''`,
    );
    res = new Map((rr.recordset || []).map((x) => [String(x.host || '').trim().toUpperCase(), x]));
  } catch (e) {
    console.warn('[NginxHub] Inventory kaynak sorgusu:', e.message);
  }
  const { siteOfHost } = require('../audit/nginx-hosts.cjs');
  return (r.recordset || []).map((x) => ({
    host: String(x.hostname || '').trim().toUpperCase(),
    env: String(x.env || '').trim().toLowerCase() || null,
    location: x.location || null,
    site: siteOfHost(x.hostname) || null,
    cpu: res.get(String(x.hostname || '').trim().toUpperCase())?.cpu ?? null,
    memoryGb: res.get(String(x.hostname || '').trim().toUpperCase())?.memory ?? null,
    os: (() => { const i = res.get(String(x.hostname || '').trim().toUpperCase()); return i ? [i.os, i.os_version].filter(Boolean).join(' ') || null : null; })(),
    service: x.service || null,
    services: String(x.services || '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    nginxVersion: x.nginx_version || null,
    prefix: x.nginx_prefix || null,
    configCount: x.config_count == null ? null : Number(x.config_count),
    ip: x.ip || null,
  })).filter((h) => h.host);
}

// ── AWX ─────────────────────────────────────────────────────────────────────────────────
async function resolveByKey(keyName) {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(keyName).catch(() => null);
  if (!row || row.enabled === false) return { templateId: null, serverId: null, keyName };
  const templateId = reg.getEffectiveTemplateId(row);
  const serverId = row.awxServerId != null ? Number(row.awxServerId) : 0;
  return { templateId: templateId || null, serverId, keyName };
}

async function launch(req, keyName, templateName, extraVars, platformDetail) {
  const { templateId, serverId } = await resolveByKey(keyName);
  if (!templateId) {
    throw Object.assign(
      new Error(`AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${keyName}" satırına Template ID girilmeli.`),
      { status: 501 },
    );
  }
  const runner = require('../ansible/runner.cjs');
  await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: keyName });
  const user = req.session?.user || {};
  const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '', user);
  try {
    const db = require('../db/index.cjs');
    await db.query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.username || 'unknown', serverId, templateId, templateName, result?.jobId, result?.status || 'pending', JSON.stringify({ ...extraVars, content_b64: extraVars.content_b64 ? `<${extraVars.content_b64.length} b64>` : undefined })],
    );
  } catch (e) {
    console.warn('[NginxConsole] job gecmisi yazilamadi:', e.message);
  }
  try {
    require('../audit/index.cjs').auditPortal(req, 'nginx_console', { detail: JSON.stringify({ ...platformDetail, jobId: result?.jobId ?? null }) });
  } catch { /* best-effort */ }
  return { jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId };
}

function isAdmin(req) {
  return req.session?.user?.role === 'Admin';
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────
function initNginxConsole(app) {
  const { requireAuth } = require('../auth/index.cjs');
  history.init({ consoleDir, ensureIngested, listDumpedHosts });
  history.startWatcher(5);
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));
  router.use(requireAuth);
  // YALNIZ Admin (kullanici, 2026-09-19): sayfa elementi de Admin'e seed'lenir; burada
  // sunucu tarafinda da kapali ki gorunurluk kurali degistirilse bile uclar acilmasin.
  router.use((req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ ok: false, message: 'Nginx Hub yalnız Admin.' })));
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('NginxConsole'));
  } catch { /* motor yoksa yoksay */ }

  // Sunucu listesi: envanter (env/servis) + dokum durumu (var mi, ne zaman, nginx -t, sertifika sayisi)
  router.get('/hosts', async (_req, res) => {
    try {
      let inv = [];
      let invError = null;
      try {
        inv = await inventoryHosts();
      } catch (e) {
        invError = e.message;
      }
      const dumped = new Map(listDumpedHosts().map((d) => [d.host, d]));
      const seen = new Set();
      const hosts = inv.map((h) => {
        seen.add(h.host);
        const d = dumped.get(h.host);
        const parsed = d ? loadDump(h.host) : null;
        return {
          ...h,
          dumpedAt: d ? d.dumpedAt : null,
          seenAt: seenAtOf(h.host, d ? d.dumpedAt : null),
          nginxT: parsed ? parsed.nginxT.status : null,
          fileCount: parsed ? parsed.tree.length : null,
          certCount: parsed ? parsed.certs.length : null,
          certMinDays: parsed ? minDays(parsed) : null,
        };
      });
      // Envanterde olmayip dokumu olan host'lar da listelenir (envanter gecikmis olabilir)
      for (const d of dumped.values()) {
        if (seen.has(d.host)) continue;
        const parsed = loadDump(d.host);
        hosts.push({ host: d.host, env: null, location: null, site: null, cpu: null, memoryGb: null, os: null, service: null, services: [], nginxVersion: null, prefix: null, configCount: null, ip: null, dumpedAt: d.dumpedAt, seenAt: seenAtOf(d.host, d.dumpedAt), nginxT: parsed ? parsed.nginxT.status : null, fileCount: parsed ? parsed.tree.length : null, certCount: parsed ? parsed.certs.length : null, certMinDays: parsed ? minDays(parsed) : null, inventoryMissing: true });
      }
      res.json({ ok: true, hosts, consoleDir: consoleDir(), inventoryError: invError, seenAt: seenMap().at });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  router.get('/tree/:host', (req, res) => {
    const host = String(req.params.host || '').toUpperCase();
    if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    const d = loadDump(host);
    if (!d) return res.json({ ok: true, host, dumped: false, message: 'Bu sunucu için henüz dokum yok — "Yenile" ile alın.' });
    res.json({
      ok: true,
      host,
      dumped: true,
      dumpedAt: d.dumpedAt,
      time: d.time,
      prefix: d.prefix,
      nginxT: d.nginxT,
      tree: buildTree(d.tree, d.prefix),
      fileCount: d.tree.length,
      certs: d.certs.map((c) => ({ ...c, daysLeft: daysLeft(c.notAfter) })),
      certUses: d.certUses,
    });
  });

  router.get('/file/:host', (req, res) => {
    const host = String(req.params.host || '').toUpperCase();
    const p = String(req.query.path || '');
    if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    const d = loadFull(host);
    if (!d) return res.status(400).json({ ok: false, message: 'Dokum yok.' });
    const f = d.files.get(p);
    const t = d.tree.find((x) => x.path === p);
    if (!f && !t) return res.status(400).json({ ok: false, message: 'Dosya dokumde yok.' });
    res.json({ ok: true, host, path: p, sha256: f ? f.sha256 : t.sha256, size: f ? f.size : t.size, mtime: t ? t.mtime : null, content: f ? f.content : null, tooLarge: !f });
  });

  // Ayni dosya farkli sunucularda: (host -> sha) — "bu dosya hangi sunucuda farkli?"
  router.get('/compare', (req, res) => {
    const p = String(req.query.path || '');
    const hostsParam = String(req.query.hosts || '');
    const hosts = hostsParam ? hostsParam.split(',').map((h) => h.trim().toUpperCase()).filter((h) => HOST_RE.test(h)) : listDumpedHosts().map((d) => d.host);
    const rows = [];
    for (const h of hosts) {
      const d = loadDump(h);
      if (!d) continue;
      const t = d.tree.find((x) => x.path === p);
      rows.push({ host: h, exists: !!t, sha256: t ? t.sha256 : null, size: t ? t.size : null, mtime: t ? t.mtime : null });
    }
    const groups = new Map();
    for (const r of rows) if (r.exists) groups.set(r.sha256, (groups.get(r.sha256) || 0) + 1);
    res.json({ ok: true, path: p, rows, variants: groups.size });
  });

  // Sertifika envanteri (tum dokumler; ?host= ile tek sunucu)
  router.get('/certs', (req, res) => {
    const only = String(req.query.host || '').toUpperCase();
    const hosts = only ? [only] : listDumpedHosts().map((d) => d.host);
    const dumps = hosts
      .map(loadSummary)
      .filter(Boolean)
      .map((sm) => ({ host: sm.host, certUses: sm.certUses, certs: new Map(sm.certs.map((c) => [c.path, c])), loaded: sm.loaded ?? null }));
    const certs = aggregateCerts(dumps);
    const now = Date.now();
    res.json({
      ok: true,
      hostsScanned: dumps.length,
      certs,
      summary: {
        total: certs.length,
        expired: certs.filter((c) => c.daysLeft != null && c.daysLeft < 0).length,
        within30: certs.filter((c) => c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= 30).length,
        within90: certs.filter((c) => c.daysLeft != null && c.daysLeft > 30 && c.daysLeft <= 90).length,
        missing: certs.filter((c) => !c.exists).length,
        selfSigned: certs.filter((c) => c.selfSigned).length,
        // yuklu hicbir conf'ta gecmeyen (yalniz yedek/eski dosyada ya da hic) - loaded bilinen sunucularda
        unused: certs.filter((c) => c.loadedUseCount === 0).length,
        generatedAt: new Date(now).toISOString(),
      },
    });
  });

  // Kullanilmayan dosyalar (2026-09-22): nginx -T'nin yuklemedigi conf dosyalari, yalniz onlarda
  // gecen sertifikalar, ssl/ altinda referanssiz dosyalar. Sunucu bazinda; ?host= tek sunucu.
  router.get('/orphans', (req, res) => {
    const only = String(req.query.host || '').toUpperCase();
    const hosts = only ? [only] : listDumpedHosts().map((d) => d.host);
    const now = Date.now();
    const rows = hosts.map(loadSummary).filter(Boolean).map((sm) => orphansOf(sm, now)).sort((a, b) => a.host.localeCompare(b.host));
    res.json({
      ok: true,
      hosts: rows,
      summary: {
        hostsScanned: rows.length,
        hostsUnknown: rows.filter((r) => !r.known).length,
        unloaded: rows.reduce((a, r) => a + r.unloaded.length, 0),
        backups: rows.reduce((a, r) => a + r.backups.length, 0),
        certs: rows.reduce((a, r) => a + r.certs.length, 0),
        ssl: rows.reduce((a, r) => a + r.ssl.length, 0),
        generatedAt: new Date(now).toISOString(),
      },
    });
  });

  // Dokum yenile: secilen host'lar (tum filo 30-40 dk — istemci uyarir)
  router.post('/refresh', async (req, res) => {
    // all:true -> target_hosts GONDERILMEZ, playbook envanterden tum nginx filosunu kesfeder
    // (nginx_audit ile ayni betik). 30-40 dk; istemci ayrica onaylatir.
    const all = req.body?.all === true;
    const list = Array.isArray(req.body?.hosts) ? req.body.hosts : [];
    const hosts = [...new Set(list.map((h) => String(h || '').trim().toUpperCase()).filter((h) => HOST_RE.test(h)))];
    if (!all && !hosts.length) return res.status(400).json({ ok: false, message: 'En az bir sunucu seçilmeli (ya da tüm filo).' });
    if (hosts.length > 400) return res.status(400).json({ ok: false, message: 'Tek seferde en fazla 400 sunucu.' });
    try {
      // Ekrandan tetiklenen yenileme her zaman TAM dokum (force_full); zamanlanmis gece/30 dk
      // kosusu bunu gondermez -> playbook parmak iziyle degismeyen sunucuyu atlar.
      const extraVars = { ...(all ? {} : { target_hosts: hosts }), force_full: true, console_dir: consoleDir(), requester: req.session?.user?.username || '' };
      const r = await launch(req, REGISTRY_KEYS.fetch, all ? 'Nginx Hub: TUM filo dokumu' : 'Nginx Hub: dokum yenile', extraVars, { op: 'fetch', hosts: all ? 'ALL' : hosts });
      res.json({ ok: true, ...r, hosts: all ? [] : hosts, all });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Publish (NIM "Publish" karsiligi): BIR dosya, bir ya da daha fazla sunucu (instance group =
  // servis). Yalniz Admin. expectedSha: host basina Portal'in gordugu sha (anti-TOCTOU).
  router.post('/push', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, message: 'Konfigürasyon değişikliği yalnız Admin.' });
    const list = Array.isArray(req.body?.hosts) ? req.body.hosts : req.body?.host ? [req.body.host] : [];
    const hosts = [...new Set(list.map((h) => String(h || '').trim().toUpperCase()).filter(Boolean))];
    const filePath = String(req.body?.path || '').trim();
    const mode = String(req.body?.mode || 'update');
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    const expectedIn = req.body?.expectedSha && typeof req.body.expectedSha === 'object' ? req.body.expectedSha : {};
    if (req.body?.expectedSha256 && hosts.length === 1) expectedIn[hosts[0]] = String(req.body.expectedSha256);
    const force = req.body?.force === true;
    if (!hosts.length || hosts.some((h) => !HOST_RE.test(h))) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    if (hosts.length > 50) return res.status(400).json({ ok: false, message: 'Tek seferde en fazla 50 sunucu.' });
    if (!ALLOWED_PATH_RE.test(filePath) || filePath.includes('..') || filePath.includes('/.console_backup/')) {
      return res.status(400).json({ ok: false, message: 'Yol yalnız /usr/nginx/conf.d/ veya /usr/nginx/conf/ altında olabilir.' });
    }
    if (!['create', 'update'].includes(mode)) return res.status(400).json({ ok: false, message: 'mode create|update olmalı.' });
    if (content == null || !content.trim()) return res.status(400).json({ ok: false, message: 'İçerik boş.' });
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT) return res.status(400).json({ ok: false, message: 'İçerik 512 KB sınırını aşıyor.' });
    if (/\x00/.test(content)) return res.status(400).json({ ok: false, message: 'İçerikte geçersiz karakter.' });

    // Host basina on kontrol (dokum uzerinden): update'te dosya var mi + sha; create'te dosya yok mu.
    const expected = {};
    const conflicts = [];
    for (const h of hosts) {
      const d = loadDump(h);
      const t = d ? d.tree.find((x) => x.path === filePath) : null;
      if (mode === 'update') {
        if (!t) { conflicts.push({ host: h, reason: 'dosya dokumde yok (önce Yenile)' }); continue; }
        const exp = String(expectedIn[h] || '').trim();
        if (!force && exp && exp !== t.sha256) conflicts.push({ host: h, reason: 'dosya siz açtıktan sonra değişmiş', currentSha256: t.sha256 });
        expected[h] = t.sha256; // sunucuda son gorulen hal; betik bununla karsilastirir
      } else if (t && !force) {
        conflicts.push({ host: h, reason: 'bu yolda dosya zaten var — update kullanın' });
      }
    }
    if (conflicts.length) return res.status(409).json({ ok: false, message: `Ön kontrol: ${conflicts.map((c) => `${c.host}: ${c.reason}`).join('; ')}`, conflicts, currentSha256: conflicts[0]?.currentSha256 || null });

    const normalized = content.replace(/\r\n/g, '\n');
    const body = normalized.endsWith('\n') ? normalized : normalized + '\n';
    const content_b64 = Buffer.from(body, 'utf8').toString('base64');
    const newSha = crypto.createHash('sha256').update(body).digest('hex');
    try {
      const extraVars = {
        target_hosts: hosts,
        file_path: filePath,
        mode,
        content_b64,
        expected_sha: force ? {} : expected,
        force,
        console_dir: consoleDir(),
        requester: req.session?.user?.username || '',
      };
      const r = await launch(req, REGISTRY_KEYS.push, `Nginx Hub: ${mode} ${path.basename(filePath)} → ${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'}`, extraVars, { op: 'publish', hosts, filePath, mode, newSha256: newSha, force });
      // Gecmis: yeni icerik blob olarak simdiden saklanir + beklemede publish satiri (dokum baglar)
      history.putBlob(newSha, body);
      await history.recordPublishIntent({ hosts, filePath, newSha, expected, requester: req.session?.user?.username || '', jobId: r.jobId });
      res.json({ ok: true, ...r, hosts, path: filePath, mode, newSha256: newSha });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // ── Gecmis (Git benzeri) ─────────────────────────────────────────────────────────
  router.get('/history/:host', async (req, res) => {
    const host = String(req.params.host || '').toUpperCase();
    const p = String(req.query.path || '');
    if (!HOST_RE.test(host) || !p) return res.status(400).json({ ok: false, message: 'Geçersiz istek.' });
    try {
      res.json({ ok: true, host, path: p, versions: await history.fileHistory(host, p) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Filo genelinde son degisiklikler: ?host=&path=&source=&since=ISO&limit=
  router.get('/changes', async (req, res) => {
    try {
      const rows = await history.changes({
        limit: req.query.limit,
        host: req.query.host ? String(req.query.host).toUpperCase() : undefined,
        pathLike: req.query.path ? String(req.query.path) : undefined,
        source: req.query.source ? String(req.query.source) : undefined,
        since: req.query.since ? new Date(String(req.query.since)) : undefined,
      });
      res.json({ ok: true, changes: rows });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Blob icerigi (sha256) — diff/geri donus icin
  router.get('/blob/:sha', (req, res) => {
    const sha = String(req.params.sha || '').toLowerCase();
    const content = history.getBlob(sha);
    if (content == null) return res.status(404).json({ ok: false, message: 'İçerik depoda yok (512 KB üstü ya da geçmiş öncesi).' });
    res.json({ ok: true, sha256: sha, content });
  });

  // Canli job durumu + stdout (JobTracker penceresi)
  router.get('/job-status/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([runner.getJobStatusOnServer(serverId, jobId), runner.getJobOutputOnServer(serverId, jobId)]);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      let result = null;
      if (TERMINAL.has(statusInfo.status)) {
        // Dokum degismis olabilir -> onbellek mtime ile kendini yeniler; ek is yok.
        const { extractStatsKey } = require('../opsx/index.cjs');
        result = extractStatsKey(statusInfo.artifacts, 'nginx_console_push_result') || extractStatsKey(statusInfo.artifacts, 'nginx_console_fetch_result') || null;
      }
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '', result });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/nginx-console', router);
  console.log(`[NginxConsole] mounted at /api/nginx-console (dir: ${consoleDir()})`);
}

function minDays(parsed) {
  let m = null;
  for (const c of parsed.certs) {
    const dl = daysLeft(c.notAfter);
    if (dl == null) continue;
    if (m == null || dl < m) m = dl;
  }
  return m;
}

module.exports = { initNginxConsole, REGISTRY_KEYS, ALLOWED_PATH_RE, HOST_RE, consoleDir, _loadDumpForTest: loadDump, _loadFullForTest: loadFull, _loadSummaryForTest: loadSummary, _seenAtOfForTest: seenAtOf, _seenMapForTest: seenMap };
