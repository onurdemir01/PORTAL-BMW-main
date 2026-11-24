// server/ansible/is-kaydi.cjs - acilan AWX isinin Portal kaydi (2026-11-24 ortak; Server Hub, Retirement ve
// Nginx Console ayni iki adimi kopya tasiyordu).
//   1. ansible_job_history: sonuc / durum uclarinin IDOR korumasi ("bu is kime ait") ve Is Gecmisi ekrani bu
//      kayda bakar. Yazilamazsa yalniz uyari (is zaten acildi).
//   2. Portal denetimi (auditPortal): detaya isin numarasi eklenir; best-effort.
// params cagiranin verdigi nesnedir; sir ya da buyuk icerik tasiyorsa cagiran kisaltir (or. content_b64).
'use strict';

async function isKaydiYaz(
  req,
  user,
  { serverId, templateId, templateName, result, params, etiket, denetimTuru, detay },
) {
  try {
    await require('../db/index.cjs').query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user.username || 'unknown',
        serverId,
        templateId,
        templateName,
        result?.jobId,
        result?.status || 'pending',
        JSON.stringify(params),
      ],
    );
  } catch (e) {
    console.warn(`[${etiket}] job gecmisi yazilamadi:`, e.message);
  }
  try {
    require('../audit/index.cjs').auditPortal(req, denetimTuru, {
      detail: JSON.stringify({ ...detay, jobId: result?.jobId ?? null }),
    });
  } catch {
    /* best-effort */
  }
}

module.exports = { isKaydiYaz };
