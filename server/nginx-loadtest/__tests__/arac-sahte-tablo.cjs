// server/nginx-loadtest/__tests__/arac-sahte-tablo.cjs - sahte nginx_loadtest_araclar tablosu (tur 4).
// kapi.test.cjs ve araclar.test.cjs ortak kullanir. WHERE / ORDER BY / TOP SQL METNINDEN uygulanir
// (sorgunun anlami sinanir: kosulu silinen sorgu farkli satir dondurur). Taninmayan kosul HATA.
// D1 (2026-11-02): etkin set su anki env sabit ozetlerini ister; ozetEnvKur() iki env'i bu dosyanin
// SHA_K6_ARSIV / SHA_WRK_KAYNAK degerlerine kurar (aracSatiri'nin istenen ozetleri de bunlar).
'use strict';

const SHA_K6 = 'c'.repeat(64);
const SHA_WRK = 'd'.repeat(64);
const SHA_K6_ARSIV = 'e'.repeat(64);
const SHA_WRK_KAYNAK = 'f'.repeat(64);

/** Hazir (DONE, sabit ozetlerle, geri cekilmemis) arac seti satiri. */
function aracSatiri(ek = {}) {
  const id = ek.id ?? 5;
  return {
    id, durum: 'DONE', derleme_host: 'GBLABT02', k6_surum: 'v0.49.0', wrk_surum: '4.2.0',
    istenen_k6_arsiv_sha256: SHA_K6_ARSIV, istenen_wrk_kaynak_sha256: SHA_WRK_KAYNAK,
    k6_sha256: SHA_K6, wrk_sha256: SHA_WRK, k6_arsiv_sha256: SHA_K6_ARSIV, wrk_kaynak_sha256: SHA_WRK_KAYNAK,
    kaynak_onay: 1, onaylayan: 'onur', onay_at: new Date('2026-11-01T09:00:00Z'), sw_dizin: `/sw/BMW_PORTAL/nginx_loadtest/araclar/${id}`,
    derleme_rhel: '8', derleme_glibc: '2.28', wrk_glibc_gerekli: '2.17', hata: null,
    sonuc: JSON.stringify({ araclar: { wrk_openssl: 'OpenSSL 1.1.1i  8 Dec 2020', wrk_luajit: 'LuaJIT 2.1.0-beta3' } }),
    awx_server_id: 3, awx_job_id: 700 + id, kilit_id: null, sonuclandirma_denemesi: 1, created_by: 'onur',
    created_at: new Date('2026-11-01T08:00:00Z'), started_at: new Date('2026-11-01T08:00:05Z'), finished_at: new Date('2026-11-01T08:10:00Z'),
    finalized_at: new Date('2026-11-01T08:10:30Z'), calisma_yas_sn: 600, geri_ceken: null, geri_cekme_at: null,
    ...ek,
  };
}

/** Iki sabit ozet env'ini kurar (deger verilmezse sahte tablonun arsiv ozetleri). null -> env silinir. */
function ozetEnvKur({ k6 = SHA_K6_ARSIV, wrk = SHA_WRK_KAYNAK } = {}) {
  for (const [ad, v] of [['NGINX_LOADTEST_K6_ARSIV_SHA256', k6], ['NGINX_LOADTEST_WRK_KAYNAK_SHA256', wrk]]) {
    if (v == null) delete process.env[ad];
    else process.env[ad] = v;
  }
}

// araclariSonuclandir sirasi: genc (yas <= esik) once en yeni, sonra eski en eski once (yas = calisma_yas_sn).
const YAS_SIRASI = /^(.*) ORDER BY CASE WHEN DATEDIFF\(SECOND, COALESCE\(started_at, created_at\), GETUTCDATE\(\)\) > (\d+) THEN 1 ELSE 0 END, CASE WHEN DATEDIFF\(SECOND, COALESCE\(started_at, created_at\), GETUTCDATE\(\)\) > \2 THEN id ELSE -id END$/;

function kosulSuz(kosullar, params) {
  return (r) => kosullar.every((c) => {
    let m = /^(\w+) = '([A-Z]+)'$/.exec(c);
    if (m) return r[m[1]] === m[2];
    m = /^(\w+) = (\d+)$/.exec(c);
    if (m) return Number(r[m[1]]) === Number(m[2]);
    m = /^(\w+) = \$(\d+)$/.exec(c);
    if (m) return r[m[1]] === params[Number(m[2]) - 1];
    m = /^(\w+) IS NOT NULL$/.exec(c);
    if (m) return r[m[1]] != null;
    m = /^(\w+) IS NULL$/.exec(c);
    if (m) return r[m[1]] == null;
    m = /^(\w+) IN \(([^)]*)\)$/.exec(c);
    if (m) return m[2].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).includes(r[m[1]]);
    m = /^created_at < DATEADD\(MINUTE, -(\d+), GETUTCDATE\(\)\)$/.exec(c);
    if (m) return r.created_at < new Date(Date.now() - Number(m[1]) * 60000);
    throw new Error(`taninmayan arac kosulu: ${c}`);
  });
}

/**
 * Sorgu isleyici. `D.araclar` satirlar, `D.aracDbHata` (Error) varsa her arac sorgusu atar,
 * `D.aracSorgular` sorgu gunlugu. Arac sorgusu degilse null.
 */
function aracSorgusu(D, q, params) {
  // Yuk makinesi listesi (2026-11-13): bos tablo = ortam listesi (eski davranis). D.yukHostlari / D.yukHostHata.
  if (/FROM nginx_loadtest_yuk_hostlari/.test(q)) {
    if (D.yukHostHata) throw D.yukHostHata;
    return { rows: D.yukHostlari || [] };
  }
  if (!/nginx_loadtest_araclar/.test(q)) return null;
  if (!D.aracSorgular) D.aracSorgular = [];
  D.aracSorgular.push({ q, params });
  if (D.aracDbHata) throw D.aracDbHata;
  const T = D.araclar;
  let m = YAS_SIRASI.exec(q);
  if (m) {
    const esik = Number(m[2]);
    const ic = /^SELECT TOP (\d+) (.+?) FROM nginx_loadtest_araclar WHERE (.+)$/.exec(m[1]);
    if (!ic) throw new Error(`beklenmeyen arac sorgusu: ${q}`);
    const eski = (r) => Number(r.calisma_yas_sn) > esik;
    const r = T.filter(kosulSuz(ic[3].split(' AND '), params))
      .sort((a, b) => (eski(a) - eski(b)) || (eski(a) ? a.id - b.id : b.id - a.id))
      .slice(0, Number(ic[1]));
    return { rows: r.map((x) => ({ ...x })), rowCount: r.length };
  }
  m = /^SELECT (TOP (\d+) )?(.+?) FROM nginx_loadtest_araclar(?: WHERE (.+?))?(?: ORDER BY id( DESC)?)?$/.exec(q);
  if (m) {
    const kosullar = m[4] ? m[4].split(' AND ') : [];
    let r = T.filter(kosulSuz(kosullar, params));
    r = r.slice().sort((a, b) => (m[5] ? b.id - a.id : a.id - b.id));
    if (m[2]) r = r.slice(0, Number(m[2]));
    return { rows: r.map((x) => ({ ...x })), rowCount: r.length };
  }
  if (/^INSERT INTO nginx_loadtest_araclar \(durum, derleme_host, k6_surum, wrk_surum, istenen_k6_arsiv_sha256, istenen_wrk_kaynak_sha256, kilit_id, created_by\) VALUES \('QUEUED', \$1, \$2, \$3, \$4, \$5, \$6, \$7\) RETURNING id$/.test(q)) {
    if (D.aracInsertHata) throw D.aracInsertHata;
    const id = T.reduce((a, r) => Math.max(a, r.id), 0) + 1;
    const [derleme_host, k6_surum, wrk_surum, istenen_k6_arsiv_sha256, istenen_wrk_kaynak_sha256, kilit_id, created_by] = params;
    T.push({
      id, durum: 'QUEUED', derleme_host, k6_surum, wrk_surum, istenen_k6_arsiv_sha256, istenen_wrk_kaynak_sha256, kilit_id, created_by,
      k6_sha256: null, wrk_sha256: null, k6_arsiv_sha256: null, wrk_kaynak_sha256: null, kaynak_onay: 0, onaylayan: null, onay_at: null,
      sw_dizin: null, derleme_rhel: null, derleme_glibc: null, wrk_glibc_gerekli: null, hata: null, sonuc: null, awx_server_id: null, awx_job_id: null,
      sonuclandirma_denemesi: 0, created_at: new Date(), started_at: null, finished_at: null, finalized_at: null, geri_ceken: null, geri_cekme_at: null,
    });
    return { rows: [{ id }], rowCount: 1 };
  }
  const bul = (fn) => T.find(fn);
  if ((m = /^UPDATE nginx_loadtest_araclar SET sw_dizin = \$2 WHERE id = \$1$/.exec(q))) {
    const r = bul((x) => x.id === params[0]);
    if (r) r.sw_dizin = params[1];
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if (/^UPDATE nginx_loadtest_araclar SET durum = 'FAILED', hata = \$2, awx_server_id = \$3, awx_job_id = \$4, finished_at = GETUTCDATE\(\), finalized_at = GETUTCDATE\(\) WHERE id = \$1 AND durum = 'QUEUED'$/.test(q)) {
    const r = bul((x) => x.id === params[0] && x.durum === 'QUEUED');
    if (r) Object.assign(r, { durum: 'FAILED', hata: params[1], awx_server_id: params[2], awx_job_id: params[3] });
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if (/^UPDATE nginx_loadtest_araclar SET awx_server_id = \$2, awx_job_id = \$3, started_at = GETUTCDATE\(\), durum = CASE WHEN durum = 'QUEUED' THEN 'RUNNING' ELSE durum END WHERE id = \$1 AND awx_job_id IS NULL$/.test(q)) {
    const r = bul((x) => x.id === params[0] && x.awx_job_id == null);
    if (r) Object.assign(r, { awx_server_id: params[1], awx_job_id: params[2], started_at: new Date(), durum: r.durum === 'QUEUED' ? 'RUNNING' : r.durum });
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if (/^UPDATE nginx_loadtest_araclar SET geri_ceken = \$2, geri_cekme_at = GETUTCDATE\(\) WHERE id = \$1 AND durum = 'DONE' AND geri_cekme_at IS NULL$/.test(q)) {
    const r = bul((x) => x.id === params[0] && x.durum === 'DONE' && x.geri_cekme_at == null && !D.aracGeriCekYarisi);
    if (r) Object.assign(r, { geri_ceken: params[1], geri_cekme_at: new Date() });
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if (/^UPDATE nginx_loadtest_araclar SET durum = 'RUNNING', started_at = COALESCE\(started_at, GETUTCDATE\(\)\) WHERE id = \$1 AND durum = 'QUEUED'$/.test(q)) {
    const r = bul((x) => x.id === params[0] && x.durum === 'QUEUED');
    if (r) r.durum = 'RUNNING';
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if (/^UPDATE nginx_loadtest_araclar SET durum = 'FINALIZING', sonuclandirma_denemesi = sonuclandirma_denemesi \+ 1 WHERE id = \$1 AND durum IN \('QUEUED', 'RUNNING', 'FINALIZING'\) RETURNING sonuclandirma_denemesi$/.test(q)) {
    const r = bul((x) => x.id === params[0] && ['QUEUED', 'RUNNING', 'FINALIZING'].includes(x.durum) && !D.aracSahiplenmez);
    if (!r) return { rows: [], rowCount: 0 };
    r.durum = 'FINALIZING';
    r.sonuclandirma_denemesi = (r.sonuclandirma_denemesi || 0) + 1;
    return { rows: [{ sonuclandirma_denemesi: r.sonuclandirma_denemesi }], rowCount: 1 };
  }
  if (/^UPDATE nginx_loadtest_araclar SET durum = 'DONE', k6_sha256 = \$2, wrk_sha256 = \$3, k6_arsiv_sha256 = \$4, wrk_kaynak_sha256 = \$5, derleme_rhel = \$6, derleme_glibc = \$7, wrk_glibc_gerekli = \$8, sonuc = \$9, hata = NULL, finished_at = COALESCE\(\$10, finished_at, GETUTCDATE\(\)\), finalized_at = GETUTCDATE\(\) WHERE id = \$1 AND durum = 'FINALIZING'$/.test(q)) {
    const r = bul((x) => x.id === params[0] && x.durum === 'FINALIZING');
    if (r) {
      Object.assign(r, {
        durum: 'DONE', k6_sha256: params[1], wrk_sha256: params[2], k6_arsiv_sha256: params[3], wrk_kaynak_sha256: params[4], derleme_rhel: params[5],
        derleme_glibc: params[6], wrk_glibc_gerekli: params[7], sonuc: params[8], hata: null, finished_at: params[9] || new Date(),
      });
    }
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if (/^UPDATE nginx_loadtest_araclar SET durum = \$2, hata = \$3, sonuc = \$4, finished_at = COALESCE\(\$5, finished_at, GETUTCDATE\(\)\), finalized_at = GETUTCDATE\(\) WHERE id = \$1 AND durum = 'FINALIZING'$/.test(q)) {
    const r = bul((x) => x.id === params[0] && x.durum === 'FINALIZING');
    if (r) Object.assign(r, { durum: params[1], hata: params[2], sonuc: params[3], finished_at: params[4] || new Date() });
    return { rows: [], rowCount: r ? 1 : 0 };
  }
  if ((m = /^UPDATE nginx_loadtest_araclar SET durum = 'FAILED', hata = \$1, finalized_at = GETUTCDATE\(\), finished_at = COALESCE\(finished_at, GETUTCDATE\(\)\) WHERE (.+)$/.exec(q))) {
    const suz = kosulSuz(m[1].split(' AND '), params);
    let n = 0;
    for (const r of T) {
      if (suz(r)) {
        Object.assign(r, { durum: 'FAILED', hata: params[0] });
        n += 1;
      }
    }
    return { rows: [], rowCount: n };
  }
  throw new Error(`beklenmeyen arac sorgusu: ${q}`);
}

module.exports = { SHA_K6, SHA_WRK, SHA_K6_ARSIV, SHA_WRK_KAYNAK, aracSatiri, aracSorgusu, ozetEnvKur };
