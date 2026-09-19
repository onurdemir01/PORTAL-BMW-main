// server/nginx-console/history.cjs — Nginx Hub konfigurasyon GECMISI (Git benzeri, 2026-09-19).
//
// Fikir: Git'in icerik adresli deposu. Her benzersiz dosya icerigi sha256'siyla BIR KEZ
// /sw/BMW_PORTAL/nginx_console/objects/<sha> altina yazilir (ayni servisin 20 sunucusundaki
// ayni dosya = tek blob; degismeyen dosya bir daha yazilmaz). Boyut: filo ~20-40 MB + degisiklik
// basina birkac KB. DB'ye ICERIK GITMEZ.
//
// DB'de iki kucuk tablo (bkz. mssql-setup.cjs):
//   nginx_hub_file_state   — (host, path) basina SON bilinen sha/boyut/mtime (degisiklik tespiti;
//                            restart'ta bellek kaybolmasin diye DB'de)
//   nginx_hub_file_history — YALNIZ degisiklikte bir satir: eski sha, yeni sha, kaynak
//                            (first-seen | server | portal-publish | deleted), kim, job.
//   Taramada degismeyen dosya icin HIC satir yazilmaz -> tablo tarama sayisiyla degil,
//   degisiklik sayisiyla buyur (yilda binler). Transaction log'a yuk yok.
//
// Kaynak tespiti: Portal'dan Publish aninda 'portal-publish' satiri BEKLEMEDE (pending=1,
// requester+job) yazilir; dokum o sha'yi gorunce satir baglanir (pending=0, dump zamani).
// Beklemede eslesme yoksa degisiklik 'server' (sunucuda elle) sayilir.
//
// Ingest tetigi: loadDump yeni bir dokum (mtime degisti) ayristirdiginda + 5 dk'lik arka plan
// tarayicisi (ekran acik olmasa da gecmis islenir).
'use strict';

const fs = require('fs');
const path = require('path');

let _deps = null; // { consoleDir(), ensureIngested(host), listDumpedHosts() } — index.cjs verir (dongusel require yok)
function init(deps) {
  _deps = deps;
}

function objectsDir() {
  return path.join(_deps.consoleDir(), 'objects');
}
function blobPath(sha) {
  return path.join(objectsDir(), sha.slice(0, 2), sha);
}
function putBlob(sha, content) {
  if (!/^[0-9a-f]{64}$/.test(sha)) return false;
  const p = blobPath(sha);
  if (fs.existsSync(p)) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp' + process.pid;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, p);
  return true;
}
function getBlob(sha) {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  try {
    return fs.readFileSync(blobPath(sha), 'utf8');
  } catch {
    return null;
  }
}
function hasBlob(sha) {
  return /^[0-9a-f]{64}$/.test(sha) && fs.existsSync(blobPath(sha));
}

// ── Degisiklik tespiti (SAF) ───────────────────────────────────────────────────────────
/**
 * prevState: Map(path -> {sha256,size,mtime}); tree: dokumdaki dosyalar [{path,sha256,size,mtime,owner}]
 * -> { added:[...], changed:[{...,oldSha}], deleted:[{path, oldSha}] }
 */
function diffState(prevState, tree) {
  const added = [], changed = [], deleted = [];
  const seen = new Set();
  for (const f of tree) {
    seen.add(f.path);
    const prev = prevState.get(f.path);
    if (!prev) added.push(f);
    else if (prev.sha256 !== f.sha256) changed.push({ ...f, oldSha: prev.sha256 });
  }
  for (const [p, prev] of prevState) if (!seen.has(p)) deleted.push({ path: p, oldSha: prev.sha256 });
  return { added, changed, deleted };
}

// ── Ingest ───────────────────────────────────────────────────────────────────────────
const _ingested = new Map(); // HOST -> dumpedAt (ayni dokum iki kez islenmesin)
const _inflight = new Set();

async function ingestDump(parsed) {
  const host = String(parsed.host || '').toUpperCase();
  if (!host || !parsed.dumpedAt) return null;
  if (_ingested.get(host) === parsed.dumpedAt || _inflight.has(host)) return null;
  _inflight.add(host);
  try {
    const db = require('../db/index.cjs');
    // 1) blob'lar (yalniz icerigi dokumde olanlar; 512 KB ustu icerik yok -> yalniz sha izlenir)
    let newBlobs = 0;
    for (const [p, f] of parsed.files) {
      if (f.sha256 && putBlob(f.sha256, f.content)) newBlobs++;
    }
    // 2) onceki durum
    const st = await db.query(`SELECT path, sha256, size, mtime FROM nginx_hub_file_state WHERE host = $1`, [host]);
    const prev = new Map(st.rows.map((r) => [r.path, { sha256: r.sha256, size: r.size, mtime: r.mtime }]));
    const firstTime = prev.size === 0;
    const { added, changed, deleted } = diffState(prev, parsed.tree);
    // 3) beklemedeki publish'ler (bu host, son 7 gun) — kaynak eslestirme
    const pend = await db.query(
      `SELECT id, path, new_sha256 FROM nginx_hub_file_history WHERE host = $1 AND pending = 1 AND seen_at > DATEADD(day, -7, GETUTCDATE())`,
      [host],
    );
    const pendingByKey = new Map(pend.rows.map((r) => [`${r.path}|${r.new_sha256}`, r.id]));
    const dumpTime = parsed.time ? new Date(parsed.time) : new Date(parsed.dumpedAt);
    const events = [];
    for (const f of added) events.push({ kind: firstTime ? 'first-seen' : 'server', f, oldSha: null });
    for (const f of changed) events.push({ kind: 'server', f, oldSha: f.oldSha });
    for (const d of deleted) events.push({ kind: 'deleted', f: { path: d.path, sha256: null, size: null, mtime: null, owner: null }, oldSha: d.oldSha });
    for (const e of events) {
      const key = `${e.f.path}|${e.f.sha256}`;
      const pendingId = e.f.sha256 ? pendingByKey.get(key) : null;
      if (pendingId) {
        await db.query(
          `UPDATE nginx_hub_file_history SET pending = 0, old_sha256 = COALESCE(old_sha256, $2), size = $3, file_mtime = $4, file_owner = $5, dump_time = $6 WHERE id = $1`,
          [pendingId, e.oldSha, e.f.size, e.f.mtime, e.f.owner || null, dumpTime],
        );
        pendingByKey.delete(key);
      } else {
        await db.query(
          `INSERT INTO nginx_hub_file_history (host, path, old_sha256, new_sha256, size, file_mtime, file_owner, source, requester, job_id, seen_at, dump_time, pending)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, GETUTCDATE(), $9, 0)`,
          [host, e.f.path, e.oldSha, e.f.sha256, e.f.size, e.f.mtime, e.f.owner || null, e.kind, dumpTime],
        );
      }
    }
    // 4) durum tablosu (MERGE yerine sil/yaz — satir sayisi kucuk, host basina ~200)
    if (added.length || changed.length || deleted.length) {
      for (const f of [...added, ...changed]) {
        await db.query(
          `UPDATE nginx_hub_file_state SET sha256 = $3, size = $4, mtime = $5, last_seen = GETUTCDATE() WHERE host = $1 AND path = $2`,
          [host, f.path, f.sha256, f.size, f.mtime],
        ).then(async (r) => {
          if (!r.rowCount) await db.query(`INSERT INTO nginx_hub_file_state (host, path, sha256, size, mtime, last_seen) VALUES ($1, $2, $3, $4, $5, GETUTCDATE())`, [host, f.path, f.sha256, f.size, f.mtime]);
        });
      }
      for (const d of deleted) await db.query(`DELETE FROM nginx_hub_file_state WHERE host = $1 AND path = $2`, [host, d.path]);
    }
    _ingested.set(host, parsed.dumpedAt);
    const summary = { host, newBlobs, added: added.length, changed: changed.length, deleted: deleted.length, firstTime };
    if (added.length || changed.length || deleted.length) console.log(`[NginxHub] gecmis: ${JSON.stringify(summary)}`);
    return summary;
  } catch (e) {
    console.warn('[NginxHub] gecmis islenemedi:', host, e.message);
    return null;
  } finally {
    _inflight.delete(host);
  }
}

/** Publish aninda: beklemede 'portal-publish' satiri (dokum sha'yi gorunce baglanir). */
async function recordPublishIntent({ hosts, filePath, newSha, expected, requester, jobId }) {
  try {
    const db = require('../db/index.cjs');
    for (const h of hosts) {
      await db.query(
        `INSERT INTO nginx_hub_file_history (host, path, old_sha256, new_sha256, size, file_mtime, file_owner, source, requester, job_id, seen_at, dump_time, pending)
         VALUES ($1, $2, $3, $4, NULL, NULL, NULL, 'portal-publish', $5, $6, GETUTCDATE(), NULL, 1)`,
        [h, filePath, expected?.[h] || null, newSha, requester || null, jobId || null],
      );
    }
  } catch (e) {
    console.warn('[NginxHub] publish niyeti yazilamadi:', e.message);
  }
}

// ── Sorgular ─────────────────────────────────────────────────────────────────────────
async function fileHistory(host, filePath) {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT TOP 200 id, old_sha256, new_sha256, size, file_mtime, file_owner, source, requester, job_id, seen_at, dump_time, pending
       FROM nginx_hub_file_history WHERE host = $1 AND path = $2 ORDER BY seen_at DESC, id DESC`,
    [host, filePath],
  );
  return rows.map(rowOut);
}

async function changes({ limit = 200, host, pathLike, source, since, hosts } = {}) {
  const db = require('../db/index.cjs');
  const where = ['pending = 0'];
  const params = [];
  if (host) { params.push(host); where.push(`host = $${params.length}`); }
  if (hosts && hosts.length) { params.push(hosts.join(',')); where.push(`host IN (SELECT value FROM STRING_SPLIT($${params.length}, ','))`); }
  if (pathLike) { params.push(`%${pathLike}%`); where.push(`path LIKE $${params.length}`); }
  if (source) { params.push(source); where.push(`source = $${params.length}`); }
  if (since) { params.push(since); where.push(`seen_at >= $${params.length}`); }
  const top = Math.min(1000, Math.max(1, Number(limit) || 200));
  const { rows } = await db.query(
    `SELECT TOP ${top} id, host, path, old_sha256, new_sha256, size, file_mtime, file_owner, source, requester, job_id, seen_at, dump_time
       FROM nginx_hub_file_history WHERE ${where.join(' AND ')} ORDER BY seen_at DESC, id DESC`,
    params,
  );
  return rows.map(rowOut);
}

function rowOut(r) {
  return {
    id: r.id,
    host: r.host,
    path: r.path,
    oldSha256: r.old_sha256 || null,
    newSha256: r.new_sha256 || null,
    size: r.size == null ? null : Number(r.size),
    fileMtime: r.file_mtime || null,
    fileOwner: r.file_owner || null,
    source: r.source,
    requester: r.requester || null,
    jobId: r.job_id == null ? null : Number(r.job_id),
    seenAt: r.seen_at ? new Date(r.seen_at).toISOString() : null,
    dumpTime: r.dump_time ? new Date(r.dump_time).toISOString() : null,
    pending: !!r.pending,
    hasOld: !!(r.old_sha256 && hasBlob(r.old_sha256)),
    hasNew: !!(r.new_sha256 && hasBlob(r.new_sha256)),
  };
}

// ── Arka plan tarayici ───────────────────────────────────────────────────────────────
let _timer = null;
async function sweep() {
  try {
    // Host basina SIRAYLA ve tam ayristirma yalniz ingest edilmemis dokumda (bellek: OOM 2026-09-20).
    for (const d of _deps.listDumpedHosts()) {
      if (_ingested.get(d.host) === d.dumpedAt) continue;
      _deps.ensureIngested(d.host);
      await new Promise((r) => setTimeout(r, 50));
    }
  } catch (e) {
    console.warn('[NginxHub] gecmis taramasi:', e.message);
  }
}
function startWatcher(minutes = 5) {
  if (_timer) return;
  _timer = setInterval(() => sweep().catch(() => {}), minutes * 60 * 1000);
  _timer.unref?.();
  setTimeout(() => sweep().catch(() => {}), 30_000).unref?.();
}

module.exports = { init, putBlob, getBlob, hasBlob, diffState, ingestDump, recordPublishIntent, fileHistory, changes, startWatcher, sweep, _objectsDir: objectsDir };
