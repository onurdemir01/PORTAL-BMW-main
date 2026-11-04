// server/server-hub/ear-envanter-sorgu.cjs - Uygulama Envanteri okuma sorgulari (2026-11-04).
//
// "SON DURUM": her hostun veri tasiyan (veri_var = 1) EN SON kosusu. Haftalik taramada bir host
// dusse bile onceki haftanin verisi gorunur; ekran verinin tarihini (taranma_utc) yaninda gosterir.
// kosu > 0 verilirse yalniz o kosu okunur.
//
// ESLENIKLER: ayni uygulama (EAR adi) + ayni ortam + ayni JBoss nesli birden cok hostta. Sonuc:
//   AYNI              yapi izi ve kutuphane izi hepsinde ayni
//   FARKLI_KUTUPHANE  kutuphane izi farkli (jar ya da surum farki)
//   FARKLI_YAPI       kutuphaneler ayni, dosya yapisi farkli
//   EKSIK_TARAMA      en az bir kopya TAM taranmamis: karsilastirma yapilmaz (eksik veri "ayni" sayilmaz)
//   KARSILASTIRILAMAZ kopyalar farkli kipte taranmis (OZET izi TAM iziyle kiyaslanmaz)
// IKI NESIL: ayni hostta ayni EAR hem /vhosting (7) hem /vhosting8 (8) altinda (pilotta goruldu).
'use strict';

const db = () => require('../db/index.cjs');
const SON_SINIR = 200000;

/** LIKE icin kacisli desen ('%x%'); bos -> ''. */
function likeDeseni(s) {
  const t = String(s == null ? '' : s)
    .trim()
    .slice(0, 100);
  return t ? `%${t.replace(/[\\%_[]/g, (c) => `\\${c}`)}%` : '';
}
const kosuNo = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// $1: kosu (0 = son durum). Host basina veri tasiyan son kosu.
const SON_CTE = `son AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari
                          WHERE veri_var = 1 AND ($1 = 0 OR kosu_id = $1) GROUP BY host)`;

const UYG_SECIM = `u.kosu_id, u.host, h.ortam, u.uyg_no, u.kip, u.kok, u.jboss, u.ad, u.bicim, u.durum, u.bag_hedefi,
  u.war_sayisi, u.giris, u.jsp, u.tld, u.jar, u.class_sayisi, u.application_xml, u.ear_kutuphane_sayisi,
  u.spring_boot, u.spring_framework, u.log4j, u.servlet, u.yapi_izi, u.kutuphane_izi, u.uyari_sayisi, h.taranma_utc`;

/** Uygulama listesi (suzgec + sayfa). sayfa yoksa disa aktarim: en cok SON_SINIR satir. */
async function uygulamalar({ kosu, q, ortam, jboss, durum, servlet, limit, offset } = {}) {
  const lim = limit == null ? SON_SINIR : Math.max(1, Math.min(500, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  const qd = likeDeseni(q);
  const od = likeDeseni(ortam);
  const sd = likeDeseni(servlet);
  const { rows } = await db().query(
    `WITH ${SON_CTE}
     SELECT ${UYG_SECIM}, COUNT(*) OVER() AS toplam
       FROM ear_envanter_uygulamalari u
       JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id
       JOIN ear_envanter_hostlari h ON h.kosu_id = u.kosu_id AND h.host = u.host
      WHERE ($2 = '' OR u.ad LIKE $2 ESCAPE '\\' OR u.host LIKE $2 ESCAPE '\\')
        AND ($3 = '' OR h.ortam LIKE $3 ESCAPE '\\')
        AND ($4 = '' OR u.jboss = $4)
        AND ($5 = '' OR u.durum = $5 OR ($5 = 'EKSIK' AND u.durum <> 'TAM'))
        AND ($6 = '' OR u.servlet LIKE $6 ESCAPE '\\')
      ORDER BY u.host, u.kok, u.ad
      OFFSET $7 ROWS FETCH NEXT $8 ROWS ONLY`,
    [
      kosuNo(kosu),
      qd,
      od,
      ['7', '8', '?'].includes(jboss) ? jboss : '',
      String(durum || '').slice(0, 24),
      sd,
      off,
      lim,
    ],
  );
  return { satirlar: rows || [], toplam: rows && rows[0] ? Number(rows[0].toplam) : 0 };
}

async function warlar({ kosu } = {}) {
  const { rows } = await db().query(
    `WITH ${SON_CTE}
     SELECT TOP (${SON_SINIR}) w.kosu_id, w.host, h.ortam, u.jboss, u.kok, u.ad AS uygulama, w.war_no, w.yol, w.ad, w.bicim, w.durum,
            w.jsp, w.tld, w.tld_dizini, w.jar, w.class_sayisi, w.web_xml, w.web_varyantlari, w.jboss_web_xml,
            w.jboss_deployment_structure, w.spring_boot, w.spring_framework, w.spring_security, w.log4j, w.logback,
            w.jackson, w.thymeleaf, w.struts, w.servlet, w.kutuphane_sayisi, w.kutuphane_seti
       FROM ear_envanter_warlari w
       JOIN son ON son.host = w.host AND son.kosu_id = w.kosu_id
       JOIN ear_envanter_uygulamalari u ON u.kosu_id = w.kosu_id AND u.host = w.host AND u.uyg_no = w.uyg_no
       JOIN ear_envanter_hostlari h ON h.kosu_id = w.kosu_id AND h.host = w.host
      ORDER BY w.host, u.kok, u.ad, w.war_no`,
    [kosuNo(kosu)],
  );
  return rows || [];
}

/** Her hostun son satiri (veri tasimasa da) + son verisinin kosusu. */
async function hostlar({ kosu } = {}) {
  const { rows } = await db().query(
    `WITH son AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari WHERE ($1 = 0 OR kosu_id = $1) GROUP BY host),
          veri AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari WHERE veri_var = 1 GROUP BY host)
     SELECT TOP (${SON_SINIR}) h.host, h.kosu_id, h.parti_no, h.ortam, h.durum, h.playbook_durum, h.veri_var, h.uygulama_sayisi,
            h.war_sayisi, h.giris, h.sure_sn, h.python, h.kullanici, h.kokler, h.uyarilar, h.hata, h.ham_bayt,
            h.taranma_utc, h.alindi_at, h.bildirilen_host, veri.kosu_id AS veri_kosu_id
       FROM ear_envanter_hostlari h
       JOIN son ON son.host = h.host AND son.kosu_id = h.kosu_id
       LEFT JOIN veri ON veri.host = h.host
      ORDER BY h.host`,
    [kosuNo(kosu)],
  );
  return rows || [];
}

// Son durumdaki tum kutuphane kullanimlari (WAR'in WEB-INF/lib'i ve EAR'in lib/'i).
const KULLANIM_CTE = `${SON_CTE},
  k AS (SELECT w.host, w.uyg_no, w.kutuphane_seti AS iz FROM ear_envanter_warlari w
          JOIN son ON son.host = w.host AND son.kosu_id = w.kosu_id WHERE w.kutuphane_seti IS NOT NULL
        UNION ALL
        SELECT u.host, u.uyg_no, u.ear_kutuphane_seti FROM ear_envanter_uygulamalari u
          JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id WHERE u.ear_kutuphane_seti IS NOT NULL)`;

/** Kutuphane -> surum -> kac host / uygulama. */
async function kutuphaneler({ kosu, q } = {}) {
  const qd = likeDeseni(q);
  const { rows } = await db().query(
    `WITH ${KULLANIM_CTE}
     SELECT TOP (20000) s.ad, s.surum, COUNT(DISTINCT k.host) AS host_sayisi,
            COUNT(DISTINCT CONCAT(k.host, '|', k.uyg_no)) AS uygulama_sayisi, COUNT(*) AS kopya
       FROM k JOIN ear_envanter_set_kutuphaneleri s ON s.iz = k.iz
      WHERE ($2 = '' OR s.ad LIKE $2 ESCAPE '\\')
      GROUP BY s.ad, s.surum
      ORDER BY s.ad, s.surum`,
    [kosuNo(kosu), qd],
  );
  return rows || [];
}

/** Bir kutuphane surumunu kullanan uygulamalar. */
async function kutuphaneKullananlar({ kosu, ad, surum }) {
  const { rows } = await db().query(
    `WITH ${KULLANIM_CTE}
     SELECT DISTINCT TOP (5000) u.host, h.ortam, u.kok, u.jboss, u.ad AS uygulama, u.kosu_id, u.uyg_no, u.durum
       FROM k JOIN ear_envanter_set_kutuphaneleri s ON s.iz = k.iz
       JOIN ear_envanter_uygulamalari u ON u.host = k.host AND u.uyg_no = k.uyg_no
       JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id
       JOIN ear_envanter_hostlari h ON h.kosu_id = u.kosu_id AND h.host = u.host
      WHERE s.ad = $2 AND s.surum = $3
      ORDER BY u.host, u.ad`,
    [kosuNo(kosu), String(ad || '').slice(0, 200), String(surum ?? '').slice(0, 100)],
  );
  return rows || [];
}

/** Tek uygulama: satir, WAR'lar, kutuphane listeleri, ayni adli kopyalar. */
async function uygulamaDetay({ kosu, host, uygNo }) {
  const a = await db().query(
    `SELECT u.*, h.ortam, h.taranma_utc, h.durum AS host_durum FROM ear_envanter_uygulamalari u
       JOIN ear_envanter_hostlari h ON h.kosu_id = u.kosu_id AND h.host = u.host
      WHERE u.kosu_id = $1 AND u.host = $2 AND u.uyg_no = $3`,
    [kosu, host, uygNo],
  );
  const u = a.rows && a.rows[0];
  if (!u) return null;
  const w = await db().query(
    `SELECT * FROM ear_envanter_warlari WHERE kosu_id = $1 AND host = $2 AND uyg_no = $3 ORDER BY war_no`,
    [kosu, host, uygNo],
  );
  const izler = [
    ...new Set(
      [u.ear_kutuphane_seti, ...(w.rows || []).map((x) => x.kutuphane_seti)]
        .filter(Boolean)
        .map((x) => String(x).trim()),
    ),
  ];
  const setler = await setSatirlari(izler);
  const kopyalar = await db().query(
    `WITH ${SON_CTE}
     SELECT u.host, h.ortam, u.kok, u.jboss, u.durum, u.kip, u.yapi_izi, u.kutuphane_izi, u.kosu_id, u.uyg_no, h.taranma_utc
       FROM ear_envanter_uygulamalari u
       JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id
       JOIN ear_envanter_hostlari h ON h.kosu_id = u.kosu_id AND h.host = u.host
      WHERE u.ad = $2
      ORDER BY u.host, u.kok`,
    [0, u.ad],
  );
  return {
    uygulama: u,
    warlar: (w.rows || []).map((x) => ({
      ...x,
      kutuphaneler: setler.get(String(x.kutuphane_seti || '').trim()) || [],
    })),
    earKutuphaneleri: setler.get(String(u.ear_kutuphane_seti || '').trim()) || [],
    kopyalar: kopyalar.rows || [],
  };
}

/** iz -> [{ad, surum, boyut}] */
async function setSatirlari(izler) {
  const harita = new Map();
  if (!izler.length) return harita;
  const { rows } = await db().query(
    `SELECT iz, sira, ad, surum, boyut FROM ear_envanter_set_kutuphaneleri WHERE iz IN (SELECT value FROM OPENJSON($1)) ORDER BY iz, sira`,
    [JSON.stringify(izler.slice(0, 2000))],
  );
  for (const r of rows || []) {
    const iz = String(r.iz).trim();
    if (!harita.has(iz)) harita.set(iz, []);
    harita
      .get(iz)
      .push({ ad: r.ad, surum: r.surum, boyut: r.boyut == null ? null : Number(r.boyut) });
  }
  return harita;
}

// ── ESLENIKLER ──────────────────────────────────────────────────────────────────────────────────

/** Uygulama satirlari -> eslenik gruplari + iki nesil listesi. Saf fonksiyon (test edilir). */
function eslenikAnalizi(satirlar, { tumu = false } = {}) {
  const gruplar = new Map();
  const nesil = new Map();
  for (const r of satirlar || []) {
    const ortam = String(r.ortam || '') || '?';
    const anahtar = `${r.ad}\u0000${ortam}\u0000${r.jboss}`;
    if (!gruplar.has(anahtar))
      gruplar.set(anahtar, { uygulama: r.ad, ortam, jboss: r.jboss, kopyalar: [] });
    gruplar.get(anahtar).kopyalar.push(r);
    const nk = `${r.host}\u0000${r.ad}`;
    if (!nesil.has(nk)) nesil.set(nk, []);
    nesil.get(nk).push(r);
  }
  const sonuc = [];
  for (const g of gruplar.values()) {
    const k = g.kopyalar;
    const hostSayisi = new Set(k.map((x) => x.host)).size;
    if (hostSayisi < 2 && !tumu) continue;
    let karar;
    if (hostSayisi < 2) karar = 'TEK';
    else if (k.some((x) => x.durum !== 'TAM')) karar = 'EKSIK_TARAMA';
    else if (new Set(k.map((x) => x.kip)).size > 1) karar = 'KARSILASTIRILAMAZ';
    else if (new Set(k.map((x) => x.kutuphane_izi || '')).size > 1) karar = 'FARKLI_KUTUPHANE';
    else if (new Set(k.map((x) => x.yapi_izi || '')).size > 1) karar = 'FARKLI_YAPI';
    else karar = 'AYNI';
    const izGrup = new Map();
    for (const x of k) {
      const iz = `${x.yapi_izi || '-'}/${x.kutuphane_izi || '-'}`;
      if (!izGrup.has(iz)) izGrup.set(iz, []);
      izGrup.get(iz).push(x.host);
    }
    sonuc.push({
      uygulama: g.uygulama,
      ortam: g.ortam,
      jboss: g.jboss,
      karar,
      host_sayisi: hostSayisi,
      hostlar: [...new Set(k.map((x) => x.host))].sort(),
      eksik: k.filter((x) => x.durum !== 'TAM').map((x) => `${x.host}:${x.durum}`),
      gruplar: [...izGrup.entries()].map(([iz, hs]) => ({ iz, hostlar: hs.sort() })),
    });
  }
  const SIRA = {
    FARKLI_KUTUPHANE: 0,
    FARKLI_YAPI: 1,
    EKSIK_TARAMA: 2,
    KARSILASTIRILAMAZ: 3,
    AYNI: 4,
    TEK: 5,
  };
  sonuc.sort(
    (a, b) =>
      SIRA[a.karar] - SIRA[b.karar] ||
      a.uygulama.localeCompare(b.uygulama) ||
      a.ortam.localeCompare(b.ortam),
  );
  const ikiNesil = [];
  for (const k of nesil.values()) {
    const n = new Set(k.map((x) => x.jboss));
    if (n.has('7') && n.has('8')) {
      const yedi = k.find((x) => x.jboss === '7');
      const sekiz = k.find((x) => x.jboss === '8');
      ikiNesil.push({
        host: k[0].host,
        uygulama: k[0].ad,
        ortam: String(k[0].ortam || '') || '?',
        ayni_kutuphane:
          yedi.durum === 'TAM' && sekiz.durum === 'TAM' && yedi.kip === sekiz.kip
            ? yedi.kutuphane_izi === sekiz.kutuphane_izi
            : null,
      });
    }
  }
  ikiNesil.sort((a, b) => a.host.localeCompare(b.host) || a.uygulama.localeCompare(b.uygulama));
  return { gruplar: sonuc, ikiNesil };
}

async function eslenikler({ kosu, ortam, tumu = false } = {}) {
  const { satirlar } = await uygulamalar({ kosu, ortam });
  return eslenikAnalizi(satirlar, { tumu });
}

/**
 * Tek eslenik grubunun kutuphane farki: her kopyanin (WAR + EAR lib) "ad@surum" kumesi; hepsinde
 * olmayanlar hangi hostta oldugu ile.
 */
async function eslenikFarki({ kosu, ad, ortam, jboss }) {
  // Ortami bos kopyalar '?' grubundadir; LIKE '%?%' onlari bulamaz, suzgec JS'te yapilir.
  const { satirlar } = await uygulamalar({ kosu, q: '', ortam: ortam === '?' ? '' : ortam });
  const kopyalar = satirlar.filter(
    (r) =>
      r.ad === ad &&
      String(r.jboss) === String(jboss) &&
      (String(r.ortam || '') || '?') === (ortam || '?'),
  );
  const kumeler = [];
  for (const k of kopyalar) {
    const d = await uygulamaDetay({ kosu: k.kosu_id, host: k.host, uygNo: k.uyg_no });
    const s = new Set();
    for (const x of d ? d.earKutuphaneleri : []) s.add(`${x.ad}@${x.surum}`);
    for (const w of d ? d.warlar : [])
      for (const x of w.kutuphaneler) s.add(`${w.ad}:${x.ad}@${x.surum}`);
    kumeler.push({ host: k.host, durum: k.durum, kip: k.kip, kume: s });
  }
  const tum = new Set();
  for (const k of kumeler) for (const x of k.kume) tum.add(x);
  const farklar = [];
  for (const x of [...tum].sort()) {
    const olan = kumeler.filter((k) => k.kume.has(x)).map((k) => k.host);
    if (olan.length !== kumeler.length)
      farklar.push({
        kutuphane: x,
        olan,
        olmayan: kumeler.filter((k) => !k.kume.has(x)).map((k) => k.host),
      });
  }
  return {
    kopyalar: kumeler.map(({ host, durum, kip, kume }) => ({
      host,
      durum,
      kip,
      kutuphane_sayisi: kume.size,
    })),
    farklar: farklar.slice(0, 500),
  };
}

// ── KOSULAR / OZET ──────────────────────────────────────────────────────────────────────────────

async function kosular(limit = 20) {
  const { rows } = await db().query(
    `SELECT TOP (${Math.max(1, Math.min(100, Number(limit) || 20))}) id, kip, kaynak, kapsam, durum, beklenen, tam, kismi, kok_yok,
            basarisiz, parti_sayisi, baslatan, hata, created_at, finished_at,
            (SELECT COUNT(*) FROM ear_envanter_hostlari h WHERE h.kosu_id = k.id) AS alinan
       FROM ear_envanter_kosulari k ORDER BY id DESC`,
  );
  return rows || [];
}

/** hostlarla=false: ozet ekrani her yoklamada 1000 host satiri cekmesin. */
async function kosuDetay(id, { hostlarla = true } = {}) {
  const k = await db().query(
    `SELECT id, kip, kaynak, kapsam, durum, beklenen, tam, kismi, kok_yok, basarisiz, parti_sayisi, parametreler, baslatan,
            hata, zamanlayici_anahtari, created_at, finished_at FROM ear_envanter_kosulari WHERE id = $1`,
    [id],
  );
  const kosu = k.rows && k.rows[0];
  if (!kosu) return null;
  const p = await db().query(
    `SELECT parti_no, host_sayisi, durum, awx_server_id, awx_job_id, awx_durum, baslatma_denemesi, alim_denemesi, hata,
            started_at, finished_at FROM ear_envanter_partileri WHERE kosu_id = $1 ORDER BY parti_no`,
    [id],
  );
  const h = hostlarla ? await hostlar({ kosu: id }) : [];
  let parametre = {};
  try {
    parametre = JSON.parse(kosu.parametreler || '{}');
  } catch {
    parametre = {};
  }
  delete kosu.parametreler;
  return { kosu: { ...kosu, parametreler: parametre }, partiler: p.rows || [], hostlar: h };
}

/** Son durumun sayilari. */
async function sayilar() {
  const { rows } = await db().query(
    `WITH ${SON_CTE}
     SELECT (SELECT COUNT(*) FROM son) AS host,
            (SELECT COUNT(*) FROM ear_envanter_uygulamalari u JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id) AS uygulama,
            (SELECT COUNT(*) FROM ear_envanter_uygulamalari u JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id WHERE u.durum <> 'TAM') AS eksik_uygulama,
            (SELECT COUNT(*) FROM ear_envanter_warlari w JOIN son ON son.host = w.host AND son.kosu_id = w.kosu_id) AS war`,
    [0],
  );
  const r = (rows && rows[0]) || {};
  return {
    host: Number(r.host || 0),
    uygulama: Number(r.uygulama || 0),
    eksikUygulama: Number(r.eksik_uygulama || 0),
    war: Number(r.war || 0),
  };
}

module.exports = {
  likeDeseni,
  uygulamalar,
  warlar,
  hostlar,
  kutuphaneler,
  kutuphaneKullananlar,
  uygulamaDetay,
  setSatirlari,
  eslenikAnalizi,
  eslenikler,
  eslenikFarki,
  kosular,
  kosuDetay,
  sayilar,
};
