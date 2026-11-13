// server/audit/nginx-audit-token.cjs - nginx_audit degisim belirteci (2026-11-13, SlowQuery).
//
// Denetim > Nginx Audit sicak onbellegi her 10 dakikada Nginx_Audit_Settings'in 1,56M satirini
// yeniden cekiyordu; kaynak (nginx_audit_analyze.py) gunde bir yazar, ayni gun tekrar kosuda o
// gunun satirlarini silip yeniden yazar. Tum Nginx_Audit_* tablolarinda id BIGINT IDENTITY
// PRIMARY KEY var: MAX(id) kumelenmis indeksin sonundan tek seek (ucuz) ve yeniden yazimda artar.
// MAX(scan_date) gun degisimini, MAX(id) ayni gun yeniden yazimi yakalar.
//
// Belirtec ANA havuzdan okunur (uzun havuzun 4 baglantisini isgal etmez). Nginx_Audit_Files
// sonradan eklendi: yoksa o parca 'yok'. Cekirdek sorgu duserse hata firlatilir (warm-cache
// bunu yas < maxAgeMs iken "atla + uyari" sayar; azami yas asildiysa yine hesaplar).
'use strict';

const CEKIRDEK_SQL = `SELECT CONVERT(varchar(10), (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Hosts), 23) AS d,
       (SELECT MAX(id) FROM dbo.Nginx_Audit_Hosts) AS h_id,
       (SELECT MAX(id) FROM dbo.Nginx_Audit_Servers) AS sv_id,
       (SELECT MAX(id) FROM dbo.Nginx_Audit_Locations) AS l_id,
       (SELECT MAX(id) FROM dbo.Nginx_Audit_Upstreams) AS u_id,
       (SELECT MAX(id) FROM dbo.Nginx_Audit_Settings) AS st_id`;
const FILES_SQL = `SELECT MAX(id) AS f_id FROM dbo.Nginx_Audit_Files`;

// Prod Tasima'nin (loadMigration) okudugu, id tasimayan tarihli kaynaklar. Tablo yoksa 'yok'.
const MIGRATION_TARIH_TABLOLARI = Object.freeze([
  'dbo.Nginx_Config_Audit',
  'dbo.Nginx_Intranet_Audit',
  'dbo.Nginx_Spa_Traffic',
]);

const parca = (v) => (v == null ? '-' : String(v));

/** @param query mssql query(text) - ana havuz */
async function nginxAuditToken(query) {
  const [c, f] = await Promise.all([
    query(CEKIRDEK_SQL),
    query(FILES_SQL).then(
      (r) => parca(r && r.recordset && r.recordset[0] && r.recordset[0].f_id),
      () => 'yok',
    ),
  ]);
  const r = (c && c.recordset && c.recordset[0]) || {};
  return [r.d, r.h_id, r.sv_id, r.l_id, r.u_id, r.st_id].map(parca).join(',') + ',' + f;
}

/** Prod Tasima belirteci: nginx_audit belirteci + tarihli kaynaklarin MAX(scan_date)'i. */
async function migrationToken(query) {
  const [audit, ...tarihler] = await Promise.all([
    nginxAuditToken(query),
    ...MIGRATION_TARIH_TABLOLARI.map((t) =>
      query(`SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM ${t}`).then(
        (r) => parca(r && r.recordset && r.recordset[0] && r.recordset[0].d),
        () => 'yok',
      ),
    ),
  ]);
  return `${audit}|${tarihler.join(',')}`;
}

module.exports = { nginxAuditToken, migrationToken, CEKIRDEK_SQL, FILES_SQL, MIGRATION_TARIH_TABLOLARI };
