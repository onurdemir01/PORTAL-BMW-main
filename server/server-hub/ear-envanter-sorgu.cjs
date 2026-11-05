// server/server-hub/ear-envanter-sorgu.cjs - Uygulama Envanteri okuma sorgulari (2026-11-04).
//
// "SON DURUM": her hostun veri tasiyan (veri_var = 1) EN SON kosusu. Haftalik taramada bir host
// dusse bile onceki haftanin verisi gorunur; ekran verinin tarihini (taranma_utc) yaninda gosterir.
// kosu > 0 verilirse yalniz o kosu okunur.
//
// SESSIZ KESILME YOK (2026-11-05, kullanici: "eksik olmasin asla"): liste uclari sayfalidir ve TOPLAM
// sayiyi da dondurur; sayfa verilmezse TUM satirlar doner (disa aktarim parca parca akitir).
// Sutun suzgeci / siralama: ear-envanter-kolonlar.cjs (beyaz liste). Eslenikler: ear-envanter-eslenik.cjs.
'use strict';

const db = () => require('../db/index.cjs');
const kolonlar = require('./ear-envanter-kolonlar.cjs');
const eslenik = () => require('./ear-envanter-eslenik.cjs');
const neden = require('./ear-envanter-neden.cjs');

const SAYFA_UST = 5000;
const likeDeseni = kolonlar.likeDeseni;
const kosuNo = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** limit/offset -> SQL parcasi + parametreler. limit null: sayfasiz (tum satirlar). */
function sayfa(limit, offset, ilk) {
  if (limit == null) return { sql: '', params: [] };
  const lim = Math.max(1, Math.min(SAYFA_UST, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  return { sql: `OFFSET $${ilk} ROWS FETCH NEXT $${ilk + 1} ROWS ONLY`, params: [off, lim] };
}

// $1: kosu (0 = son durum). Host basina veri tasiyan son kosu.
const SON_CTE = `son AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari
                          WHERE veri_var = 1 AND ($1 = 0 OR kosu_id = $1) GROUP BY host)`;

const UYG_SECIM = `u.kosu_id, u.host, h.ortam, u.uyg_no, u.kip, u.kok, u.jboss, u.ad, u.bicim, u.durum, u.bag_hedefi,
  u.war_sayisi, u.giris, u.jsp, u.tld, u.jar, u.class_sayisi, u.application_xml, u.ear_kutuphane_sayisi,
  u.spring_boot, u.spring_framework, u.log4j, u.servlet, u.yapi_izi, u.kutuphane_izi, u.uyari_sayisi, u.uyarilar,
  h.taranma_utc`;

const WAR_SECIM = `w.kosu_id, w.host, h.ortam, u.jboss, u.kok, u.ad AS uygulama, w.uyg_no, w.war_no, w.yol, w.ad, w.bicim,
  w.durum, w.jsp, w.tld, w.tld_dizini, w.jar, w.class_sayisi, w.web_xml, w.web_varyantlari, w.jboss_web_xml,
  w.jboss_deployment_structure, w.spring_boot, w.spring_framework, w.spring_security, w.log4j, w.logback,
  w.jackson, w.thymeleaf, w.struts, w.servlet, w.kutuphane_sayisi, w.kutuphane_seti`;

/** Eski ekran parametreleri (q / ortam / jboss / durum / servlet) -> sutun suzgeci. */
function eskiSuzgecler({ ortam, jboss, durum, servlet }) {
  const f = [];
  const o = eslenik().ortamOf(ortam);
  if (o) f.push({ k: 'ortam', op: 'in', v: [o] });
  if (['7', '8', '?'].includes(jboss)) f.push({ k: 'jboss', op: 'esit', v: jboss });
  const d = String(durum || '').slice(0, 24);
  if (d === 'EKSIK') f.push({ k: 'durum', op: 'eksik', v: null });
  else if (d) f.push({ k: 'durum', op: 'esit', v: d });
  const s = String(servlet || '').slice(0, 24);
  if (s) f.push({ k: 'servlet', op: 'icerir', v: s });
  return f;
}

/** Eslenik suzgeci: kararlari tutan kopyalarin anahtarlari (analiz onbellegi). */
function eslenikAnahtarSaglayici(kosu) {
  let a = null;
  return async (alan, kararlar, op) => {
    if (!a) a = await eslenik().analiz({ kosu });
    const out = [];
    for (const [anahtar, k] of a.kopyaKarari) {
      const v = k[alan];
      if (op === 'bos' ? v == null : op === 'dolu' ? v != null : kararlar && kararlar.includes(v))
        out.push(anahtar);
    }
    return out;
  };
}

/** Sayfadaki uygulamalara WAR teknolojileri, WAR adlari ve eslenik kararlari eklenir. */
async function uygulamaEkleri(satirlar, kosu) {
  if (!satirlar.length) return satirlar;
  const anahtarlar = satirlar.map((r) => ({ kosu_id: r.kosu_id, host: r.host, uyg_no: r.uyg_no }));
  const { rows } = await db().query(
    `SELECT w.kosu_id, w.host, w.uyg_no, w.ad, ${kolonlar.WAR_TEK.map((k) => `w.${k}`).join(', ')}
       FROM ear_envanter_warlari w
       JOIN OPENJSON($1) WITH (kosu_id INT, host NVARCHAR(128), uyg_no INT) k
         ON k.kosu_id = w.kosu_id AND k.host = w.host AND k.uyg_no = w.uyg_no
      ORDER BY w.war_no`,
    [JSON.stringify(anahtarlar)],
  );
  const ek = new Map();
  for (const r of rows || []) {
    const a = `${r.kosu_id}|${r.host}|${r.uyg_no}`;
    if (!ek.has(a)) ek.set(a, { warlar: [], ...Object.fromEntries(kolonlar.WAR_TEK.map((k) => [k, new Set()])) });
    const e = ek.get(a);
    e.warlar.push(r.ad);
    for (const k of kolonlar.WAR_TEK) if (r[k]) for (const p of String(r[k]).split(', ')) e[k].add(p);
  }
  let analiz = null;
  try {
    analiz = await eslenik().analiz({ kosu });
  } catch (e) {
    // Eslenik okunamazsa liste yine gelir; kararlar "okunamadi" isaretli (null degil, gizlenmez).
    analiz = { hata: e.message };
  }
  return satirlar.map((r) => {
    const e = ek.get(`${r.kosu_id}|${r.host}|${r.uyg_no}`);
    const k = analiz.kopyaKarari ? analiz.kopyaKarari.get(`${r.host}|${r.kok}|${r.ad}`) : null;
    return {
      ...r,
      war_adlari: e ? e.warlar.join(', ') : '',
      ...Object.fromEntries(
        kolonlar.WAR_TEK.map((t) => [t, e && e[t].size ? [...e[t]].sort().join(', ') : null]),
      ),
      eslenik_ortam_ici: k ? k.ortam_ici : null,
      eslenik_ortamlar_arasi: k ? k.ortamlar_arasi : null,
      eslenik_nesil: k ? k.nesil : null,
      eslenik_okunamadi: analiz.hata ? true : undefined,
    };
  });
}

/**
 * Uygulama listesi. f: sutun suzgecleri (JSON / dizi), s: siralama. Eski parametreler de kabul edilir.
 * limit verilmezse TUM satirlar (disa aktarim).
 */
async function uygulamalar({ kosu, q, ortam, jboss, durum, servlet, f, s, limit, offset } = {}) {
  const k = kosuNo(kosu);
  const suzgec = [
    ...kolonlar.suzgecleriAyristir('uygulamalar', eskiSuzgecler({ ortam, jboss, durum, servlet })),
    ...kolonlar.suzgecleriAyristir('uygulamalar', f),
  ];
  const kos = await kolonlar.kosullar('uygulamalar', suzgec, {
    ilk: 2,
    q,
    eslenikAnahtarlari: eslenikAnahtarSaglayici(k),
  });
  const sira = kolonlar.siraAyristir('uygulamalar', s);
  const sy = sayfa(limit, offset, 2 + kos.params.length);
  const { rows } = await db().query(
    `WITH ${SON_CTE}
     SELECT ${UYG_SECIM}, COUNT(*) OVER() AS toplam
       FROM ${kolonlar.GORUNUMLER.uygulamalar.kaynak}
      ${kos.where.length ? `WHERE ${kos.where.join('\n        AND ')}` : ''}
      ORDER BY ${sira}
      ${sy.sql}`,
    [k, ...kos.params, ...sy.params],
  );
  const satirlar = await uygulamaEkleri(rows || [], k);
  return { satirlar, toplam: rows && rows[0] ? Number(rows[0].toplam) : 0 };
}

/** WAR listesi (sutun suzgeci + sayfa). limit verilmezse tum satirlar. */
async function warlar({ kosu, q, f, s, limit, offset } = {}) {
  const k = kosuNo(kosu);
  const kos = await kolonlar.kosullar('warlar', kolonlar.suzgecleriAyristir('warlar', f), {
    ilk: 2,
    q,
  });
  const sira = kolonlar.siraAyristir('warlar', s);
  const sy = sayfa(limit, offset, 2 + kos.params.length);
  const { rows } = await db().query(
    `WITH ${SON_CTE}
     SELECT ${WAR_SECIM}, COUNT(*) OVER() AS toplam
       FROM ${kolonlar.GORUNUMLER.warlar.kaynak}
      ${kos.where.length ? `WHERE ${kos.where.join('\n        AND ')}` : ''}
      ORDER BY ${sira}
      ${sy.sql}`,
    [k, ...kos.params, ...sy.params],
  );
  return { satirlar: rows || [], toplam: rows && rows[0] ? Number(rows[0].toplam) : 0 };
}

/** Her hostun son satiri (veri tasimasa da) + son verisinin kosusu + neden metni. */
async function hostlar({ kosu } = {}) {
  const { rows } = await db().query(
    `WITH son AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari WHERE ($1 = 0 OR kosu_id = $1) GROUP BY host),
          veri AS (SELECT host, MAX(kosu_id) AS kosu_id FROM ear_envanter_hostlari WHERE veri_var = 1 GROUP BY host)
     SELECT h.host, h.kosu_id, h.parti_no, h.ortam, h.durum, h.playbook_durum, h.veri_var, h.uygulama_sayisi,
            h.war_sayisi, h.giris, h.sure_sn, h.python, h.kullanici, h.kokler, h.uyarilar, h.hata, h.ham_bayt,
            h.taranma_utc, h.alindi_at, h.bildirilen_host, veri.kosu_id AS veri_kosu_id,
            e.eksik_uygulama, f.ilk_eksik_ad, f.ilk_eksik_durum
       FROM ear_envanter_hostlari h
       JOIN son ON son.host = h.host AND son.kosu_id = h.kosu_id
       LEFT JOIN veri ON veri.host = h.host
       OUTER APPLY (SELECT COUNT(*) AS eksik_uygulama FROM ear_envanter_uygulamalari x
                     WHERE x.kosu_id = h.kosu_id AND x.host = h.host AND x.durum <> 'TAM') e
       OUTER APPLY (SELECT TOP 1 x.ad AS ilk_eksik_ad, x.durum AS ilk_eksik_durum FROM ear_envanter_uygulamalari x
                     WHERE x.kosu_id = h.kosu_id AND x.host = h.host AND x.durum <> 'TAM' ORDER BY x.uyg_no) f
      ORDER BY h.host`,
    [kosuNo(kosu)],
  );
  return (rows || []).map((r) => ({
    ...r,
    eksik_uygulama: Number(r.eksik_uygulama || 0),
    neden: neden.nedenMetni(r),
    playbook_etiket: neden.playbookEtiketi(r.playbook_durum),
  }));
}

// Son durumdaki tum kutuphane kullanimlari (WAR'in WEB-INF/lib'i ve EAR'in lib/'i).
const KULLANIM_CTE = `${SON_CTE},
  k AS (SELECT w.host, w.uyg_no, w.kutuphane_seti AS iz FROM ear_envanter_warlari w
          JOIN son ON son.host = w.host AND son.kosu_id = w.kosu_id WHERE w.kutuphane_seti IS NOT NULL
        UNION ALL
        SELECT u.host, u.uyg_no, u.ear_kutuphane_seti FROM ear_envanter_uygulamalari u
          JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id WHERE u.ear_kutuphane_seti IS NOT NULL)`;

/** Kutuphane -> surum -> kac host / uygulama (sutun suzgeci + sayfa + toplam; limit yoksa hepsi). */
async function kutuphaneler({ kosu, q, f, s, limit, offset } = {}) {
  const kos = await kolonlar.kosullar('kutuphaneler', kolonlar.suzgecleriAyristir('kutuphaneler', f), {
    ilk: 2,
    q,
  });
  const sira = kolonlar.siraAyristir('kutuphaneler', s);
  const sy = sayfa(limit, offset, 2 + kos.params.length);
  const { rows } = await db().query(
    `WITH ${KULLANIM_CTE}
     SELECT s.ad, s.surum, COUNT(DISTINCT k.host) AS host_sayisi,
            COUNT(DISTINCT CONCAT(k.host, '|', k.uyg_no)) AS uygulama_sayisi, COUNT(*) AS kopya,
            COUNT(*) OVER() AS toplam
       FROM k JOIN ear_envanter_set_kutuphaneleri s ON s.iz = k.iz
      ${kos.where.length ? `WHERE ${kos.where.join(' AND ')}` : ''}
      GROUP BY s.ad, s.surum
      ${kos.having.length ? `HAVING ${kos.having.join(' AND ')}` : ''}
      ORDER BY ${sira}
      ${sy.sql}`,
    [kosuNo(kosu), ...kos.params, ...sy.params],
  );
  return { satirlar: rows || [], toplam: rows && rows[0] ? Number(rows[0].toplam) : 0 };
}

/** Bir kutuphane surumunu kullanan uygulamalar (sayfa + toplam; limit yoksa hepsi). */
async function kutuphaneKullananlar({ kosu, ad, surum, limit, offset }) {
  const sy = sayfa(limit, offset, 4);
  const { rows } = await db().query(
    `WITH ${KULLANIM_CTE},
     x AS (SELECT DISTINCT u.host, h.ortam, u.kok, u.jboss, u.ad AS uygulama, u.kosu_id, u.uyg_no, u.durum
       FROM k JOIN ear_envanter_set_kutuphaneleri s ON s.iz = k.iz
       JOIN ear_envanter_uygulamalari u ON u.host = k.host AND u.uyg_no = k.uyg_no
       JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id
       JOIN ear_envanter_hostlari h ON h.kosu_id = u.kosu_id AND h.host = u.host
      WHERE s.ad = $2 AND s.surum = $3)
     SELECT x.*, COUNT(*) OVER() AS toplam FROM x
      ORDER BY x.host, x.uygulama, x.kok
      ${sy.sql}`,
    [kosuNo(kosu), String(ad || '').slice(0, 200), String(surum ?? '').slice(0, 100), ...sy.params],
  );
  return { satirlar: rows || [], toplam: rows && rows[0] ? Number(rows[0].toplam) : 0 };
}

/**
 * Acilir liste degerleri: { degerler: [{ deger, sayi }], farkli } (ilk 200; farkli = toplam farkli deger).
 * Oteki suzgecler uygulanir, kolonun kendisininki uygulanmaz (secili degerler listede kalsin).
 */
async function degerler({ gorunum, kolon, kosu, q, f, ara }) {
  const kol = kolonlar.kolonOf(gorunum, kolon);
  if (!kol || !kol.secim)
    throw Object.assign(new Error('Bu kolon için değer listesi yok.'), { status: 400, code: 'gecersiz_kolon' });
  const k = kosuNo(kosu);
  if (kol.eslenik) {
    const a = await eslenik().analiz({ kosu: k });
    const sayi = new Map();
    for (const v of a.kopyaKarari.values()) {
      const d = v[kol.eslenik];
      sayi.set(d, (sayi.get(d) || 0) + 1);
    }
    const l = [...sayi.entries()].map(([deger, n]) => ({ deger, sayi: n }));
    l.sort((x, y) => y.sayi - x.sayi);
    return { degerler: l, farkli: l.length, tumEnvanter: true };
  }
  const suzgec = kolonlar.suzgecleriAyristir(gorunum, f);
  const kos = await kolonlar.kosullar(gorunum, suzgec, {
    ilk: 2,
    q,
    haric: kolon,
    eslenikAnahtarlari: eslenikAnahtarSaglayici(k),
  });
  const aranan = likeDeseni(ara);
  const where = [...kos.where];
  const params = [k, ...kos.params];
  if (aranan) {
    params.push(aranan);
    where.push(`${kol.ifade} LIKE $${params.length} ESCAPE '\\'`);
  }
  let kaynak = kolonlar.GORUNUMLER[gorunum].kaynak;
  let sayim = 'COUNT(*)';
  if (kol.war) {
    // Uygulama duzeyindeki WAR teknolojisi: WAR satirlarindan, uygulama basina bir kez sayilir.
    kaynak = `${kaynak}
       JOIN ear_envanter_warlari w ON w.kosu_id = u.kosu_id AND w.host = u.host AND w.uyg_no = u.uyg_no`;
    sayim = "COUNT(DISTINCT CONCAT(u.kosu_id, '|', u.host, '|', u.uyg_no))";
  }
  const cte = gorunum === 'kutuphaneler' ? KULLANIM_CTE : SON_CTE;
  if (gorunum === 'kutuphaneler') kaynak = 'k JOIN ear_envanter_set_kutuphaneleri s ON s.iz = k.iz';
  const { rows } = await db().query(
    `WITH ${cte}
     SELECT TOP (${kolonlar.SINIR_SECENEK}) ${kol.ifade} AS deger, ${sayim} AS sayi, COUNT(*) OVER() AS farkli
       FROM ${kaynak}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY ${kol.ifade}
      ORDER BY ${sayim} DESC, ${kol.ifade}`,
    params,
  );
  return {
    degerler: (rows || []).map((r) => ({ deger: r.deger == null ? null : r.deger, sayi: Number(r.sayi) })),
    farkli: rows && rows[0] ? Number(rows[0].farkli) : 0,
  };
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

/** iz -> [{ad, surum, boyut}] (parca parca; liste kesilmez). */
async function setSatirlari(izler) {
  const harita = new Map();
  for (let i = 0; i < izler.length; i += 1000) {
    const { rows } = await db().query(
      `SELECT iz, sira, ad, surum, boyut FROM ear_envanter_set_kutuphaneleri WHERE iz IN (SELECT value FROM OPENJSON($1)) ORDER BY iz, sira`,
      [JSON.stringify(izler.slice(i, i + 1000))],
    );
    for (const r of rows || []) {
      const iz = String(r.iz).trim();
      if (!harita.has(iz)) harita.set(iz, []);
      harita
        .get(iz)
        .push({ ad: r.ad, surum: r.surum, boyut: r.boyut == null ? null : Number(r.boyut) });
    }
  }
  return harita;
}

// ── ESLENIKLER ──────────────────────────────────────────────────────────────────────────────────

/**
 * Eslenik listesi (sunucuda suzulur, sayfalanir). tur: ORTAM_ICI | ORTAMLAR_ARASI | NESIL | ORTAM_YOK.
 * Eski cagri (tur yok) { gruplar, ikiNesil } dondurur; ortam suzgeci BIREBIR (normalize).
 */
async function eslenikler({ kosu, ortam, tumu = false, tur, q, karar, kutuphane, yapi, jboss, tarihFarki, limit, offset } = {}) {
  const a = await eslenik().analiz({ kosu });
  const liste = (v) =>
    String(v || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const ortamlar = liste(ortam).map(eslenik().ortamOf);
  const kararlar = liste(karar);
  const kut = liste(kutuphane);
  const yap = liste(yapi);
  const qd = String(q || '').trim().toLowerCase();
  const tfg = Number(tarihFarki);
  const uygun = (g) =>
    (tumu || g.karar !== 'TEK') &&
    (!ortamlar.length ||
      (g.ortamlar ? g.ortamlar.some((o) => ortamlar.includes(o.ortam)) : ortamlar.includes(g.ortam))) &&
    (!kararlar.length || kararlar.includes(String(g.karar))) &&
    (!kut.length || kut.includes(String(g.kutuphane))) &&
    (!yap.length || yap.includes(String(g.yapi))) &&
    (!['7', '8', '?'].includes(jboss) || g.jboss === jboss) &&
    (!(tfg > 0) || (g.tarih_farki_gun || 0) >= tfg) &&
    (!qd ||
      String(g.uygulama).toLowerCase().includes(qd) ||
      (g.hostlar || [g.host]).some((h) => String(h).toLowerCase().includes(qd)));
  if (!tur) {
    const gruplar = a.ortamIci.filter(uygun).map((g) => ({
      ...g,
      // Eski ekran alani: degisken harfi -> hostlar.
      gruplar: g.degiskenler.map((d) => ({ iz: d.harf, hostlar: d.hostlar })),
    }));
    return { gruplar, ikiNesil: a.nesil, ortamYok: a.ortamYok };
  }
  const tumListe = eslenik().turListesi(a, tur).filter(uygun);
  const sayilar = {};
  for (const g of tumListe) sayilar[g.karar || 'ORTAM_YOK'] = (sayilar[g.karar || 'ORTAM_YOK'] || 0) + 1;
  const lim = limit == null ? tumListe.length : Math.max(1, Math.min(SAYFA_UST, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  return {
    satirlar: tumListe.slice(off, off + lim).map((g) => ({ ...g, kopyalar: undefined })),
    toplam: tumListe.length,
    sayilar,
  };
}

/** Tek eslenik grubunun kutuphane farki (eslenik motoru; sayfali, toplamli). */
async function eslenikFarki({ kosu, tur, ad, ortam, jboss, host, limit, offset }) {
  return eslenik().farkAyrintisi({ kosu, tur, ad, ortam, jboss, host, limit, offset });
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
  SON_CTE,
  SAYFA_UST,
  likeDeseni,
  uygulamalar,
  warlar,
  hostlar,
  kutuphaneler,
  kutuphaneKullananlar,
  degerler,
  uygulamaDetay,
  setSatirlari,
  eslenikler,
  eslenikFarki,
  kosular,
  kosuDetay,
  sayilar,
};
