// server/logx/v2/ingest.cjs — A4 fetch-back: log-kaynak host PAYLASILAN NFS'e erisemezse,
// arsivi dogrudan portal'a HTTP ile PUSH eder. Portal streaming olarak (bellekte buffer'lamadan)
// yerel fallback dizinine yazar; download resolver zaten fallback dizinini kontrol ettigi icin
// indirme calisir. Kimlik dogrulama = tek-kullanimlik, TTL'li KRIPTO token (kaynak host'un portal
// session'i yoktur) — bu yuzden route requireAuth DISINDA mount edilir.
//
// Akis:
//   1) transfer/discover-fetch launch aninda portal issueIngestToken() ile token uretir ve
//      playbook'a `ingest_url` extra_var'i olarak verir.
//   2) Playbook NFS'e yazamazsa: `curl -X POST --data-binary @<arsiv> -H "Content-Type:
//      application/octet-stream" <ingest_url>` ile arsivi portal'a yukler.
//   3) Portal token'i dogrular, akisi `${LOGX_STAGING_FALLBACK_DIR}/<filename>`'e yazar,
//      token'i tuketilmis isaretler. Indirme resolver fallback dizininden okur.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../db/index.cjs');
const { isUnderStagingRoot } = require('./downloads.cjs');

const INGEST_TTL_MINUTES = Number(process.env.LOGX_INGEST_TTL_MINUTES || 60);
const MAX_INGEST_BYTES = Number(process.env.LOGX_INGEST_MAX_BYTES || 200 * 1024 * 1024); // 200MB

function fallbackDir() {
  return path.resolve(process.env.LOGX_STAGING_FALLBACK_DIR || path.join(process.cwd(), 'data', 'logx-v2-fallback'));
}

// Portal'in kaynak host'lardan ERISILEBILIR taban URL'i (ters-proxy veya dogrudan host:port).
function ingestBaseUrl() {
  return (process.env.LOGX_INGEST_BASE_URL || `http://localhost:${process.env.PORT || 5055}`).replace(/\/+$/, '');
}

// Launch aninda cagrilir — ingest token uretir ve upload URL'ini doner. DB yoksa null doner
// (fallback devre disi; sadece NFS yolu kalir — graceful).
async function issueIngestToken({ requestId, filename }) {
  const token = crypto.randomBytes(32).toString('hex');
  const base = path.basename(String(filename || 'logs.zip'));
  const dir = fallbackDir();
  await db.query(
    `INSERT INTO logx_v2_ingest (token, request_id, filename, fallback_dir, expires_at)
     VALUES ($1,$2,$3,$4, DATEADD(MINUTE, $5, GETUTCDATE()))`,
    [token, requestId, base, dir, INGEST_TTL_MINUTES]
  );
  return { token, url: `${ingestBaseUrl()}/api/logx/v2/ingest/${token}` };
}

// POST /api/logx/v2/ingest/:token — kaynak host arsivi yukler. requireAuth UYGULANMAZ
// (auth = token). Body streaming olarak diske yazilir (express.json/raw devre disi olmali —
// bkz. index.cjs; upload Content-Type application/json OLMAMALI ki global parser yutmasin).
async function handleIngestRoute(req, res) {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ ok: false, message: 'Geçersiz token.' });

  const { rows } = await db.query(`SELECT * FROM logx_v2_ingest WHERE token = $1`, [token]).catch(() => ({ rows: [] }));
  const rec = rows[0];
  if (!rec) return res.status(404).json({ ok: false, message: 'İngest kaydı bulunamadı.' });
  if (rec.consumed) return res.status(409).json({ ok: false, message: 'Bu ingest zaten kullanıldı.' });
  if (new Date(rec.expires_at) < new Date()) return res.status(410).json({ ok: false, message: 'İngest süresi doldu.' });

  // Yalniz KENDI fallback dizinimize, KENDI belirledigimiz (basename'lenmis) filename ile yaz.
  // fallback_dir bugun icin her zaman fallbackDir()'in sunucu-taraf sabit degeri (bkz.
  // issueIngestToken) — istismar edilebilir bir yol yok, ama savunma-derinligi olarak
  // downloads.cjs'deki staging-root kontrolu burada da uygulanir (kurumsal AI kod
  // incelemesi, review.md #6).
  const destDir = path.resolve(rec.fallback_dir);
  if (!isUnderStagingRoot(destDir)) {
    return res.status(403).json({ ok: false, message: 'Geçersiz hedef dizin.' });
  }
  const dest = path.join(destDir, path.basename(rec.filename));
  try { fs.mkdirSync(destDir, { recursive: true }); } catch { /* zaten olabilir */ }

  let bytes = 0;
  let aborted = false;
  let magicChecked = false;
  let headerBuf = Buffer.alloc(0);
  const ws = fs.createWriteStream(dest);

  const abort = (status, message) => {
    if (aborted) return;
    aborted = true;
    ws.destroy();
    fs.promises.unlink(dest).catch(() => {});
    if (!res.headersSent) res.status(status).json({ ok: false, message });
    req.destroy();
  };

  // Yalniz ZIP arsivlerine izin verilir (issueIngestToken hep .zip filename uretiyor —
  // bkz. legacy.cjs/ocp.cjs). Ilk birkac byte biriktirilip magic number dogrulanir;
  // Content-Type header'ina guvenilmez (kurumsal AI kod incelemesi, review.md #5).
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_INGEST_BYTES) return abort(413, 'Dosya boyutu sınırını aştı.');
    if (!magicChecked) {
      headerBuf = headerBuf.length ? Buffer.concat([headerBuf, chunk]) : chunk;
      if (headerBuf.length >= 4) {
        magicChecked = true;
        const isZip = headerBuf[0] === 0x50 && headerBuf[1] === 0x4b && [0x03, 0x05, 0x07].includes(headerBuf[2]);
        if (!isZip) return abort(415, 'Beklenmeyen dosya formatı (zip bekleniyor).');
      }
    }
  });
  req.on('error', () => abort(400, 'Yükleme akışı hatası.'));
  ws.on('error', (err) => abort(500, 'Diske yazma hatası: ' + err.message));
  ws.on('finish', async () => {
    if (aborted) return;
    if (bytes === 0) return abort(400, 'Boş dosya.');
    await db.query(`UPDATE logx_v2_ingest SET consumed = 1, received_bytes = $1 WHERE token = $2`, [bytes, token]).catch(() => {});
    // Indirme audit'ine paralel: fetch-back tamamlandi.
    try { require('../audit.cjs').log({ username: 'system', action: 'v2_ingest', result: 'ok', detail: `request=${rec.request_id} filename=${path.basename(rec.filename)} bytes=${bytes}` }).catch(() => {}); } catch { /* yoksay */ }
    res.json({ ok: true, bytes, filename: path.basename(rec.filename) });
  });

  req.pipe(ws);
}

// Suresi dolan ingest token'larini temizler (cleanup job'inin bir ayagi).
async function cleanupExpiredIngest() {
  const { rowCount } = await db.query(`DELETE FROM logx_v2_ingest WHERE expires_at < GETUTCDATE()`).catch(() => ({ rowCount: 0 }));
  return rowCount || 0;
}

module.exports = { issueIngestToken, handleIngestRoute, cleanupExpiredIngest, ingestBaseUrl, fallbackDir };
