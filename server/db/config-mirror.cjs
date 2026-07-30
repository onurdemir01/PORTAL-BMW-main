// server/db/config-mirror.cjs — JSON-dosya tabanli config depolarini portal DB'de
// DURABLE olarak yansitir (mirror). Amac: config (links, self-service, duty-roster,
// ocp-clusters) artik DB'de merkezî ve kalici tutulur (redeploy/dosya kaybina dayanir),
// ama JSON dosyasi hizli yerel cache + DB-outage fallback olarak KALIR.
//
// Tasarim karari: mevcut store'lar SENKRON (sync read/modify/write) oldugu ve bu ortamda
// MSSQL ile dogrulanamadigi icin, request handler'lari async'e cevirmek yerine dusuk-riskli
// "DB-mirror + dosya-fallback" deseni kullanilir:
//   - writeX(): once dosyaya yazar (bugunku gibi, sync), sonra mirrorToDb() ile DB'ye
//     fire-and-forget yansitir (best-effort; DB yoksa sessizce yalniz dosya).
//   - startup: restoreFileFromDb() — dosya yoksa ama DB blob'u varsa dosyayi DB'den geri
//     yukler (yeni deploy'da config kaybolmaz).
// Boylece DB kaynakliysa da erisilemezse de uygulama calisir; config DB'de kalici olur.
'use strict';

const fs = require('fs');
const db = require('./index.cjs');

// Bir config blob'unu (tum JSON) DB'ye yansitir. Fire-and-forget; DB yoksa sessiz.
function mirrorToDb(name, value) {
  const json = JSON.stringify(value);
  (async () => {
    try {
      const ex = await db.query(`SELECT 1 FROM portal_config_blobs WHERE name = $1`, [name]);
      if (ex.rows.length) {
        await db.query(`UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`, [json, name]);
      } else {
        await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [name, json]);
      }
    } catch { /* DB yok/erisilemez → yalnizca dosya kalir (fallback) */ }
  })();
}

// Deploy sonrasi kurtarma: dosya YOKSA ama DB'de blob VARSA dosyayi DB'den geri yazar.
// Ayrica dosya varsa DB bossa, ilk mirror'i tetiklemek icin dosya icerigini DB'ye seed eder.
async function restoreFileFromDb(name, filePath) {
  try {
    const fileExists = fs.existsSync(filePath);
    const { rows } = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [name]);
    const hasBlob = rows.length > 0;

    if (!fileExists && hasBlob) {
      // Dosya yok, DB var → dosyayi DB'den geri yukle (redeploy kurtarma).
      fs.writeFileSync(filePath, JSON.stringify(JSON.parse(rows[0].data), null, 2));
      console.log(`[DB] config '${name}' dosyasi DB'den geri yuklendi.`);
      return 'restored';
    }
    if (fileExists && !hasBlob) {
      // Dosya var, DB bos → ilk kez DB'ye seed et (JSON→DB gocu).
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [name, JSON.stringify(data)]);
      console.log(`[DB] config '${name}' ilk kez DB'ye tasindi (JSON→DB).`);
      return 'seeded';
    }
    return 'noop';
  } catch {
    return 'skip'; // DB yok → yalnizca dosya deseni surer
  }
}

// Startup'ta tum bilinen config blob'larini uzlastirir. Yollar server/db'ye gorelidir.
const path = require('path');
const CONFIG_BLOBS = [
  { name: 'links',        file: path.join(__dirname, '..', 'data', 'important-links.json') },
  { name: 'selfservice',  file: path.join(__dirname, '..', 'data', 'selfservice.json') },
  { name: 'duty-roster',  file: path.join(__dirname, '..', 'data', 'duty-roster.json') },
  { name: 'ocp-clusters', file: path.join(__dirname, '..', 'ansible', 'ocp-clusters.json') },
];

async function reconcileAllConfigBlobs() {
  for (const { name, file } of CONFIG_BLOBS) {
    await restoreFileFromDb(name, file);
  }
}

module.exports = { mirrorToDb, restoreFileFromDb, reconcileAllConfigBlobs, CONFIG_BLOBS };
