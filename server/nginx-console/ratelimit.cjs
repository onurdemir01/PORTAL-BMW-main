// server/nginx-console/ratelimit.cjs — Nginx Hub › Rate Limit sekmesi (2026-09-26).
//
// Kullanıcı: "tüm Nginx sunucularının rate limitlerini de Nginx Hub'da ayrı bir sekmede
// görüntülemek, raporu indirebilmek istiyorum."
//
// Kaynak: dbo.NginxRateLimitInventory — bir satır = (host, config_file, api_location) ve
// o location'a uygulanan iki zone: ip_rate_limit / server_rate_limit.
//
// DENETİM'DEKİ "API ENVANTERİ" EKRANIYLA AYNI TABLO AMA FARKLI SORU: orası "hangi API
// hangi sunucuda var" diye sorar ve (host, config) düzeyinde sayı verir. Burada soru
// "limitler ne" — bu yüzden satır düzeyinde, limit değerleriyle ve filtrelenebilir.
//
// ÜÇ SÖZLEŞME:
//  1) "LİMİTİ YOK" ile "ÖLÇÜLMEDİ" AYRI. Tarama o sunucuyu hiç görmediyse satır yoktur;
//     satır varsa ve iki alan da boşsa GERÇEKTEN limit yoktur. Ekran ikisini karıştırmaz.
//  2) SERVER SEVİYESİ MİRAS SAYILIR: nginx'te `limit_req` server bloğunda tanımlıysa
//     location'a MİRAS kalır. Tarayıcı bunu zaten çözüp server_rate_limit'e yazıyor;
//     burada "kaynak" sütunu bunu görünür kılar (location mı, miras mı).
//  3) RAPOR SUNUCUDA ÜRETİLİR: 50.000 satırlık bir dökümü tarayıcıda birleştirmek yerine
//     CSV akış olarak iner; Excel'in ayraç tahminini bozmamak için UTF-8 BOM eklenir.
'use strict';

const TABLE = 'dbo.NginxRateLimitInventory';

// ── ESTATE STANDARDI: /usr/nginx/conf/rate_limits.conf (kullanici, 2026-09-26) ────────
// Uc tanim da HTTP SEVIYESINDE hem tanimlanir hem uygulanir; yani her server/location
// bunlari MIRAS ALIR - location'inda `limit_req` gormemek "limitsizim" demek degildir.
// Kaynak dosya: bmw_nginx/configuration_delivery/files/rate_limits.conf
//
// Tarama tablosu zone ADINI degil ORANI tutuyor (parse: rate, yoksa zone adi). Bu yuzden
// standart/ozel ayrimi ORAN uzerinden yapilir.
const ZONE_CATALOG = Object.freeze([
  {
    key: 'request_limit', kind: 'ip', rate: '500r/s', burst: 200, nodelay: true,
    variable: '$binary_remote_addr', size: '20m',
    label: 'IP başına istek', desc: 'Aynı IP saniyede 500 istek (burst 200, nodelay)',
  },
  {
    key: 'server_limit', kind: 'server', rate: '5000r/s', burst: 200, nodelay: true,
    variable: '$server_name', size: '50m',
    label: 'Sunucu adı başına istek', desc: 'Bir vhost saniyede 5000 istek (burst 200, nodelay)',
  },
  {
    key: 'limit_connection_perip', kind: 'conn', limit: 200,
    variable: '$binary_remote_addr', size: '20m',
    label: 'IP başına eşzamanlı bağlantı', desc: 'Aynı IP en fazla 200 eşzamanlı bağlantı',
    // Baglanti limiti location bazli DEGIL: tarama bunu satir satir olcmez, http
    // seviyesinde herkese uygulanir. Ekranda bilgi olarak durur, sutun olarak degil.
    perLocation: false,
  },
]);
const STD_IP = ZONE_CATALOG.find((z) => z.key === 'request_limit').rate;
const STD_SRV = ZONE_CATALOG.find((z) => z.key === 'server_limit').rate;
const LIMIT_FILE = '/usr/nginx/conf/rate_limits.conf';

/** Deger estate standardi mi? (bos = limit yok, standart disi = ozel ayar) */
function standardMi(deger, beklenen) {
  if (!deger) return null;
  return String(deger).trim() === beklenen;
}

/** Ortam: sunucu ADINDAN türetilir (dosya adından DEĞİL — aynı ad her ortamda var). */
function envOfHost(host) {
  const h = String(host || '').toUpperCase();
  if (/^GBNGX?P|^GBRVP/.test(h)) return 'PROD';
  if (/T\d*$/.test(h) || /TEST/.test(h)) return 'TEST';
  return 'DIGER';
}

/** Satırın limit durumu: ikisinden biri varsa limitli. */
function limitState(row) {
  const ip = row.ip_rate_limit || null;
  const srv = row.server_rate_limit || null;
  if (ip && srv) return 'ikisi';
  if (ip) return 'ip';
  if (srv) return 'server';
  return 'yok';
}

async function loadRateLimits({ scanDate } = {}) {
  const { query, sql } = require('../inventory/mssql.cjs');

  const dRes = await query(
    scanDate
      ? `SELECT CONVERT(varchar(10), CAST(@d AS DATE), 23) AS d`
      : `SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM ${TABLE}`,
    scanDate ? [{ name: 'd', type: sql.NVarChar(10), value: scanDate }] : [],
  );
  const effectiveDate = dRes.recordset?.[0]?.d || null;
  if (!effectiveDate) {
    return { ok: true, scanDate: null, availableDates: [], rows: [], summary: emptySummary(), tableMissing: false };
  }

  const [rowsRes, datesRes] = await Promise.all([
    query(
      `SELECT host, config_file, api_location, ip_rate_limit, server_rate_limit
         FROM ${TABLE}
        WHERE scan_date = @d
        ORDER BY host, config_file, api_location`,
      [{ name: 'd', type: sql.NVarChar(10), value: effectiveDate }],
    ),
    query(`SELECT DISTINCT CONVERT(varchar(10), scan_date, 23) AS d FROM ${TABLE} ORDER BY d DESC`),
  ]);

  const rows = (rowsRes.recordset || []).map((r) => {
    const ipLimit = r.ip_rate_limit || null;
    const serverLimit = r.server_rate_limit || null;
    return {
      host: r.host,
      env: envOfHost(r.host),
      configFile: r.config_file,
      location: r.api_location,
      ipLimit,
      serverLimit,
      state: limitState(r),
      // null = limit yok · true = estate standardi · false = OZEL bir oran (bilincli mi?)
      ipStd: standardMi(ipLimit, STD_IP),
      serverStd: standardMi(serverLimit, STD_SRV),
    };
  });

  return {
    ok: true,
    scanDate: effectiveDate,
    availableDates: (datesRes.recordset || []).map((x) => x.d),
    rows,
    summary: summarize(rows),
    catalog: { file: LIMIT_FILE, zones: ZONE_CATALOG },
  };
}

function emptySummary() {
  return { hosts: 0, rows: 0, limitli: 0, limitsiz: 0, ipOnly: 0, serverOnly: 0, ikisi: 0, ozel: 0, byEnv: {}, topZones: [] };
}

function summarize(rows) {
  const s = emptySummary();
  s.rows = rows.length;
  s.hosts = new Set(rows.map((r) => r.host)).size;
  const zone = new Map();
  for (const r of rows) {
    if (r.state === 'yok') s.limitsiz += 1; else s.limitli += 1;
    if (r.state === 'ip') s.ipOnly += 1;
    if (r.state === 'server') s.serverOnly += 1;
    if (r.state === 'ikisi') s.ikisi += 1;
    // OZEL ORAN: estate standardindan farkli bir deger. Yanlis olmak zorunda degil ama
    // bilerek mi konuldugu sorulmali - bu yuzden ayri sayilir.
    if (r.ipStd === false || r.serverStd === false) s.ozel += 1;
    const e = (s.byEnv[r.env] = s.byEnv[r.env] || { rows: 0, limitsiz: 0, hosts: new Set() });
    e.rows += 1;
    if (r.state === 'yok') e.limitsiz += 1;
    e.hosts.add(r.host);
    for (const z of [r.ipLimit, r.serverLimit]) {
      if (!z) continue;
      zone.set(z, (zone.get(z) || 0) + 1);
    }
  }
  for (const k of Object.keys(s.byEnv)) s.byEnv[k] = { ...s.byEnv[k], hosts: s.byEnv[k].hosts.size };
  s.topZones = [...zone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([z, n]) => ({ zone: z, count: n }));
  return s;
}

/** CSV alanı: ayraç/tırnak/satırsonu içeren değerler tırnaklanır (Excel uyumlu). */
function csvField(v) {
  const t = v == null ? '' : String(v);
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Rapor: noktalı virgül ayraçlı (TR Excel) + UTF-8 BOM. */
function toCsv(rows, scanDate) {
  const head = ['Tarama', 'Sunucu', 'Ortam', 'Konfigürasyon', 'Location', 'IP limiti', 'Server limiti', 'Durum', 'Estate standardı'];
  const durum = { yok: 'limit YOK', ip: 'IP', server: 'server (miras)', ikisi: 'IP + server' };
  const lines = [head.join(';')];
  for (const r of rows) {
    const std = r.ipStd === false || r.serverStd === false ? 'ÖZEL oran'
      : r.state === 'yok' ? '—' : 'standart';
    lines.push([scanDate, r.host, r.env, r.configFile, r.location, r.ipLimit, r.serverLimit, durum[r.state], std]
      .map(csvField).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = { loadRateLimits, summarize, toCsv, csvField, envOfHost, limitState, standardMi, ZONE_CATALOG, LIMIT_FILE, TABLE };
