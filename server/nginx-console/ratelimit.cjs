// server/nginx-console/ratelimit.cjs — Nginx Hub › Rate Limit (2026-09-26, v2).
//
// KULLANICI DÜZELTMESİ: ilk sürüm yanlış kaynaktan besleniyordu.
//   * dbo.NginxRateLimitInventory = APIGW'lerdeki API location'larının limitleri
//   * İstenen = TÜM nginx sunucularındaki /usr/nginx/conf/rate_limits.conf değerleri
// Kullanıcı: "bunlar birbirinden komple farklı; tüm Nginx'lerin taranmasını ve
// rate_limits.conf içindeki değerleri görmek istiyorum. İstersen nginx -T çıktısıyla
// runtime'da uygulanıp uygulanmadığını da test edebilirsin."
//
// YENİ JOB GEREKMEDİ: nginx_audit zaten tüm filoda `nginx -T` koşuyor (yani DOSYAYI değil
// ÇALIŞAN konfigürasyonu okuyor) ve limit_* direktiflerini dbo.Nginx_Audit_Settings'e
// yazıyor. Yani "tanımlı mı" ile "runtime'da uygulanıyor mu" AYNI kaynaktan gelir.
//
// OOM DERSİ (ilk sürüm): ekran ~50.000 location satırını tarayıcıya yığıyordu ve sayfa
// çöküyordu. Bu sürüm SUNUCU BAŞINA tek satır üretir (~300 satır): soru zaten
// "hangi sunucuda hangi limit var", location başına döküm değil.
'use strict';

const TABLE = 'dbo.Nginx_Audit_Settings';
const LIMIT_FILE = '/usr/nginx/conf/rate_limits.conf';

// Estate standardı — bmw_nginx/configuration_delivery/files/rate_limits.conf.
// Üçü de http seviyesinde tanımlanır VE uygulanır; her server/location miras alır.
const ZONE_CATALOG = Object.freeze([
  { key: 'request_limit', kind: 'req', variable: '$binary_remote_addr', size: '20m', rate: '500r/s', burst: 200, nodelay: true,
    label: 'IP başına istek', desc: 'Aynı IP saniyede 500 istek (burst 200, nodelay)' },
  { key: 'server_limit', kind: 'req', variable: '$server_name', size: '50m', rate: '5000r/s', burst: 200, nodelay: true,
    label: 'Sunucu adı başına istek', desc: 'Bir vhost saniyede 5000 istek (burst 200, nodelay)' },
  { key: 'limit_connection_perip', kind: 'conn', variable: '$binary_remote_addr', size: '20m', conn: 200,
    label: 'IP başına eşzamanlı bağlantı', desc: 'Aynı IP en fazla 200 eşzamanlı bağlantı' },
]);

const DIRECTIVES = ['limit_req_zone', 'limit_conn_zone', 'limit_req', 'limit_conn', 'limit_req_status', 'limit_conn_status'];

const rx = {
  zone: /zone=([A-Za-z0-9_.\-]+)(?::([0-9]+[kmg]?))?/i,
  rate: /rate=([0-9]+r\/[sm])/i,
  burst: /burst=([0-9]+)/i,
  firstWord: /^\s*(\S+)/,
};

/** `$binary_remote_addr zone=request_limit:20m rate=500r/s` → {name,size,rate,variable} */
function parseReqZone(value) {
  const v = String(value || '');
  const z = rx.zone.exec(v);
  return {
    name: z ? z[1] : null,
    size: z && z[2] ? z[2] : null,
    rate: (rx.rate.exec(v) || [])[1] || null,
    variable: (rx.firstWord.exec(v) || [])[1] || null,
  };
}

/** `limit_conn limit_connection_perip 200` → {name, conn} */
function parseConnApply(value) {
  const p = String(value || '').trim().split(/\s+/);
  return { name: p[0] || null, conn: p[1] != null && /^\d+$/.test(p[1]) ? Number(p[1]) : null };
}

/** `zone=request_limit burst=200 nodelay` → {name, burst, nodelay} */
function parseReqApply(value) {
  const v = String(value || '');
  const z = rx.zone.exec(v);
  return {
    name: z ? z[1] : null,
    burst: (rx.burst.exec(v) || [])[1] ? Number((rx.burst.exec(v) || [])[1]) : null,
    nodelay: /\bnodelay\b/i.test(v),
  };
}

/**
 * Sunucu başına durum. Üç ayrı soruyu AYRI AYRI cevaplar:
 *   tanimli  — zone `nginx -T` çıktısında var mı (limit_req_zone / limit_conn_zone)
 *   uygulanan— o zone GERÇEKTEN uygulanıyor mu (limit_req / limit_conn)
 *   standart — değer estate standardıyla aynı mı
 * "Tanımlı ama uygulanmamış" sessiz ve tehlikeli bir durumdur: zone bellekte durur,
 * hiçbir isteği sınırlamaz. Bu yüzden ayrı bir durum olarak gösterilir.
 */
function hostStatus(h, olculdu = true, hostDurum = null) {
  // SUNUCU DURUMU OLCUMU BASTIRIR (2026-09-26, kullanici). nginx kurulu degilse ya da
  // durum hic olculmediyse "limit eksik" DEMEK yanlistir: eksik olan limit degil, olcum.
  // Calisan ama duran bir nginx'te konfigurasyon okunabilir, o yuzden onu bastirmayiz -
  // degerleri gosteririz, ama ekran "su an uygulanmiyor" der.
  if (hostDurum === 'kurulumyok') return { durum: 'kurulumyok', eksikler: [], farklar: [] };
  if (hostDurum === 'configbozuk') return { durum: 'configbozuk', eksikler: [], farklar: [] };
  if (hostDurum === 'bilinmiyor') return { durum: 'bilinmiyor', eksikler: [], farklar: [] };
  // OLCULMEDI != EKSIK (2026-09-26). nginx_audit'in WATCH listesinde limit_req_zone /
  // limit_conn_zone / limit_req / limit_conn YOKTU; tabloda hic satir olmadigi icin ilk
  // surum TUM FILOYU "eksik" diye kirmiziya boyadi - oysa sunucularda limitler duruyordu.
  // Direktifler henuz taranmamissa hicbir iddiada BULUNMAYIZ.
  if (!olculdu) return { durum: 'bilinmiyor', eksikler: [], farklar: [] };
  const eksikler = [];
  const farklar = [];
  for (const z of ZONE_CATALOG) {
    const tanim = h.zones[z.key];
    if (!tanim) { eksikler.push(`${z.key} tanımlı değil`); continue; }
    const uyg = h.applied[z.key];
    if (!uyg) { eksikler.push(`${z.key} tanımlı ama UYGULANMIYOR`); continue; }
    if (z.kind === 'req') {
      if (z.rate && tanim.rate && tanim.rate !== z.rate) farklar.push(`${z.key} rate=${tanim.rate} (standart ${z.rate})`);
      if (z.burst != null && uyg.burst != null && uyg.burst !== z.burst) farklar.push(`${z.key} burst=${uyg.burst} (standart ${z.burst})`);
      if (z.nodelay && uyg.nodelay === false) farklar.push(`${z.key} nodelay YOK`);
    } else if (z.conn != null && uyg.conn != null && uyg.conn !== z.conn) {
      farklar.push(`${z.key} ${uyg.conn} bağlantı (standart ${z.conn})`);
    }
  }
  const durum = eksikler.length ? 'eksik' : farklar.length ? 'farkli' : 'standart';
  return { durum, eksikler, farklar };
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
    return { ok: true, scanDate: null, availableDates: [], hosts: [], summary: emptySummary(), catalog: { file: LIMIT_FILE, zones: ZONE_CATALOG } };
  }

  const [setRes, datesRes] = await Promise.all([
    query(
      `SELECT host, conf_file, context, directive, value, reference_value, matches
         FROM ${TABLE}
        WHERE scan_date = @d AND directive IN (${DIRECTIVES.map((_, i) => `@x${i}`).join(',')})
        ORDER BY host, directive`,
      [
        { name: 'd', type: sql.NVarChar(10), value: effectiveDate },
        ...DIRECTIVES.map((v, i) => ({ name: `x${i}`, type: sql.NVarChar(64), value: v })),
      ],
    ),
    query(`SELECT DISTINCT TOP 30 CONVERT(varchar(10), scan_date, 23) AS d FROM ${TABLE} ORDER BY d DESC`),
  ]);

  const byHost = new Map();
  const al = (host) => {
    if (!byHost.has(host)) {
      byHost.set(host, { host, zones: {}, applied: {}, files: new Set(), status: null, mismatch: 0, raw: [] });
    }
    return byHost.get(host);
  };

  for (const r of setRes.recordset || []) {
    const h = al(r.host);
    if (r.conf_file) h.files.add(r.conf_file);
    if (r.matches === false || r.matches === 0) h.mismatch += 1;
    const v = r.value || '';
    switch (r.directive) {
      case 'limit_req_zone': {
        const z = parseReqZone(v);
        if (z.name) h.zones[z.name] = { kind: 'req', ...z, file: r.conf_file, context: r.context };
        break;
      }
      case 'limit_conn_zone': {
        const z = parseReqZone(v);
        if (z.name) h.zones[z.name] = { kind: 'conn', ...z, file: r.conf_file, context: r.context };
        break;
      }
      case 'limit_req': {
        const a = parseReqApply(v);
        if (a.name) h.applied[a.name] = { kind: 'req', ...a, context: r.context };
        break;
      }
      case 'limit_conn': {
        const a = parseConnApply(v);
        if (a.name) h.applied[a.name] = { kind: 'conn', ...a, context: r.context };
        break;
      }
      default:
        break; // limit_*_status: ekranda ayrica gosterilmiyor
    }
    // Ham satirlar yalnizca DETAY icin tutulur; sunucu basina en fazla 20 satir - ekran
    // bir sunucuyu acinca gosterir, listeye HEPSI birden gonderilmez (OOM dersi).
    // nginx_audit_analyze.py, referansta olup sunucuda bulunmayan direktif icin SENTETIK
    // bir satir yazar: conf_file bos, value bos, reference_value standart deger. Bu bir
    // OLCUM degil, bir YOKLUK kaydidir - degeri bos oldugu icin yukarida zone olarak
    // ayristirilmaz (sahte "standart" uretmez), ama detayda bos satir gibi gorunmesin.
    const sentetik = !r.conf_file && !v;
    if (h.raw.length < 20) {
      h.raw.push({
        file: r.conf_file || (sentetik ? '(sunucuda yok)' : ''),
        context: r.context,
        directive: r.directive,
        value: sentetik ? `— referansta: ${r.reference_value || ''}` : v,
        matches: r.matches === true || r.matches === 1,
      });
    }
  }

  // Filodaki HICBIR sunucuda zone/uygulama satiri yoksa: direktifler taranmamis demektir
  // (eski nginx_audit surumu). Tek tek sunucularda eksiklik ARAMAYIZ.
  const olculdu = [...byHost.values()].some((h) => Object.keys(h.zones).length > 0 || Object.keys(h.applied).length > 0);

  // SUNUCU DURUMLARI: nginx kurulu degilse o sunucunun HIC ayar satiri olmaz ve eski
  // surumde listeden TAMAMEN dusuyordu - "sorun yok" gibi gorunuyordu. Artik host
  // listesi Nginx_Audit_Hosts'tan gelir; ayar satiri olmayan sunucu da sebebiyle cikar.
  const { loadHostStates } = require('../audit/nginx-host-state.cjs');
  let durumlar = new Map();
  try {
    durumlar = await loadHostStates({ query, sql, scanDate: effectiveDate });
  } catch (e) {
    console.warn('[ratelimit] sunucu durumlari okunamadi:', e.message);
  }
  for (const [host] of durumlar) if (!byHost.has(host)) al(host);

  const hosts = [...byHost.values()].map((h) => {
    const d = durumlar.get(String(h.host || '').toUpperCase()) || null;
    const st = hostStatus(h, olculdu, d ? d.durum : null);
    return {
      host: h.host,
      env: envOfHost(h.host),
      // Ayri gercekler, ayri alanlar: "kurulu mu", "calisiyor mu", "konfigurasyon gecerli mi".
      kurulu: d ? d.durum !== 'kurulumyok' : null,
      calisiyor: d ? (d.runState === 'running' ? true : d.runState === 'stopped' ? false : null) : null,
      hostDurum: d ? d.durum : 'bilinmiyor',
      hostDurumLabel: d ? d.label : 'ölçülmedi',
      hostDurumHint: d ? d.hint : 'Bu sunucu için tarama kaydı yok.',
      hostDurumMsg: d ? (d.statusMsg || d.runMsg || null) : null,
      // Estate zone'larinin OZETI: ekranda sutun olarak gosterilir.
      requestRate: h.zones.request_limit?.rate || null,
      serverRate: h.zones.server_limit?.rate || null,
      connLimit: h.applied.limit_connection_perip?.conn ?? null,
      applied: Object.keys(h.applied),
      zoneCount: Object.keys(h.zones).length,
      // rate_limits.conf gercekten yuklenmis mi (nginx -T dokumu bu dosyayi gosteriyor mu)
      fileLoaded: [...h.files].some((f) => String(f || '').includes('rate_limits.conf')),
      mismatch: h.mismatch,
      durum: st.durum,
      eksikler: st.eksikler,
      farklar: st.farklar,
      detay: h.raw,
    };
  }).sort((a, b) => a.host.localeCompare(b.host));

  return {
    ok: true,
    scanDate: effectiveDate,
    availableDates: (datesRes.recordset || []).map((x) => x.d),
    hosts,
    summary: summarize(hosts),
    catalog: { file: LIMIT_FILE, zones: ZONE_CATALOG },
    // Ekran bunu gorursa "eksik" DEMEZ, "henuz olculmedi" der.
    directivesMissing: !olculdu && hosts.length > 0,
    message: !olculdu && hosts.length > 0
      ? 'Bu taramada limit direktifleri yok: nginx_audit\'in WATCH listesine limit_req_zone / '
        + 'limit_conn_zone / limit_req / limit_conn eklendi, ama o sürüm henüz koşmamış. '
        + 'Sunucularda limit OLMADIĞI anlamına GELMEZ.'
      : undefined,
  };
}

// ORTAM, SUNUCU ADINDAN OKUNUR (2026-09-26, kullanici kurali):
// "sunucunun sayilardan onceki ilk harf P ise Production, Q-T-D ise Non-Production".
//
// Onceki surum bir on-ek kalibiydi (`^GBNGX?P|^GBRVP`) ve UYDURMAYDI: GBNGXAP32 kalibi
// tutmuyordu (GBNGX + optional X + P), GBNGXQ01 hic taninmiyordu. Ikisi de "DIGER"
// olarak dusuyordu - yani ekran, adindan ortami OKUNABILEN sunucular icin "bilmiyorum"
// diyordu. Kural artik tek ve net: SAYILARDAN HEMEN ONCEKI HARF.
//
//   GBNGXP40 -> P   Production      GBRVPAP01 -> P   Production
//   GBNGXAP34 -> P  Production      GBNGXT33  -> T   Non-Production
//   GBNGXQ01 -> Q   Non-Production  GBNGXD01  -> D   Non-Production
//
// DIGER yalnizca adi bu kalibi hic tutmayan sunucu icin kalir (harf+sayi degil). Bu bir
// tahmin degil, "olcemedim" demektir.
const ENV_HARF = { P: 'Production', Q: 'Non-Production', T: 'Non-Production', D: 'Non-Production' };

function envOfHost(host) {
  const h = String(host || '').trim().toUpperCase();
  // Sondaki sayi grubu ve ondan hemen onceki harf.
  const m = /^([A-Z]+)(\d+)[A-Z]*$/.exec(h);
  if (!m) return 'DIGER';
  return ENV_HARF[m[1].slice(-1)] || 'DIGER';
}

function emptySummary() {
  return { hosts: 0, standart: 0, farkli: 0, eksik: 0, bilinmiyor: 0, kurulumyok: 0, calismiyor: 0, configbozuk: 0, dosyaYuklenmemis: 0, byEnv: {}, rates: [] };
}

function summarize(hosts) {
  const s = emptySummary();
  s.hosts = hosts.length;
  const rate = new Map();
  for (const h of hosts) {
    s[h.durum] += 1;
    if (!h.fileLoaded) s.dosyaYuklenmemis += 1;
    const e = (s.byEnv[h.env] = s.byEnv[h.env] || { hosts: 0, standart: 0, farkli: 0, eksik: 0, bilinmiyor: 0, kurulumyok: 0, calismiyor: 0, configbozuk: 0 });
    // "Calismiyor" bir DURUM degil bir BAYRAK: limit degerleri yine olculmustur, ama
    // su an uygulanmiyor. Ayri sayilir ki ozet "her sey standart" demesin.
    if (h.calisiyor === false && h.durum !== 'kurulumyok') s.calismiyor += 1;
    e.hosts += 1;
    e[h.durum] += 1;
    const k = `${h.requestRate || '—'} / ${h.serverRate || '—'}`;
    rate.set(k, (rate.get(k) || 0) + 1);
  }
  // Filoda kac FARKLI limit kombinasyonu var: tek satirda "filo tek tip mi" cevabi.
  s.rates = [...rate.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ combo: k, hosts: n }));
  return s;
}

function csvField(v) {
  const t = v == null ? '' : String(v);
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Rapor: sunucu başına tek satır (TR Excel: noktalı virgül + UTF-8 BOM). */
function toCsv(hosts, scanDate) {
  const head = ['Tarama', 'Sunucu', 'Ortam', 'IP istek limiti/kullanıcı başına', 'Sunucu limiti', 'Concurrent bağlantı limiti/kullanıcı başına',
    'Uygulanan zone sayısı', 'rate_limits.conf yüklü', 'Durum', 'Eksikler', 'Farklar'];
  const lines = [head.join(';')];
  for (const h of hosts) {
    lines.push([
      scanDate, h.host, h.env, h.requestRate, h.serverRate, h.connLimit,
      h.applied.length, h.fileLoaded ? 'evet' : 'HAYIR',
      { standart: 'standart', farkli: 'FARKLI', eksik: 'EKSİK', bilinmiyor: 'ölçülmedi',
      kurulumyok: 'NGINX KURULU DEĞİL', calismiyor: 'nginx ÇALIŞMIYOR', configbozuk: 'KONFİGÜRASYON GEÇERSİZ' }[h.durum]
      + (h.calisiyor === false && h.durum !== 'kurulumyok' ? ' (nginx çalışmıyor)' : ''),
      h.eksikler.join(' | '), h.farklar.join(' | '),
    ].map(csvField).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = {
  loadRateLimits, summarize, toCsv, csvField, envOfHost, hostStatus, ENV_HARF,
  parseReqZone, parseReqApply, parseConnApply,
  ZONE_CATALOG, LIMIT_FILE, DIRECTIVES, TABLE,
};
