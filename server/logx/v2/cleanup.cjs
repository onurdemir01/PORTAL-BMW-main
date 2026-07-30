// server/logx/v2/cleanup.cjs — TTL temizlik job'i (5dk'da bir) — suresi dolmus
// istek/indirmelerin DB satirlarini ve staged dosyalarini temizler.
'use strict';

const requests = require('./requests.cjs');
const downloads = require('./downloads.cjs');
const ingest = require('./ingest.cjs');

function startCleanupJob() {
  setInterval(async () => {
    try {
      const expiredRequests = await requests.expireOldRequests(downloads.deleteStagedFile);
      const expiredDownloads = await downloads.cleanupExpiredDownloads();
      const expiredIngest = await ingest.cleanupExpiredIngest();
      if (expiredRequests > 0 || expiredDownloads > 0 || expiredIngest > 0) {
        console.log(`[LogXv2] Temizlik: ${expiredRequests} istek, ${expiredDownloads} indirme, ${expiredIngest} ingest suresi doldu.`);
      }
    } catch (err) {
      console.error('[LogXv2] Temizlik job hatasi:', err.message);
    }
  }, 5 * 60 * 1000);
}

module.exports = { startCleanupJob };
