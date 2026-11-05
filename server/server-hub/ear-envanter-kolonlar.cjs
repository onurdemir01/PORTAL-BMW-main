// server/server-hub/ear-envanter-kolonlar.cjs - Uygulama Envanteri tablolari: sutun suzgeci, siralama ve
// acilir liste degerleri (2026-11-05).
//
// Kullanici: "tablolarimiza sutun satir olarak filtreleme drop down arama secme secenekleri koy ... veriler
// cok olabilir optimize gosterelim ama eksik olmasin asla".
//
// GUVENLIK: her gorunumun kolonlari BEYAZ LISTEDIR; kolonun SQL ifadesi bu dosyada sabittir. Istekten
// gelen kolon adi yalniz bu listede ARANIR, SQL metnine asla girmez; degerler yalniz parametredir.
// Sinirlar: en cok 20 suzgec, kolon basina 50 deger, deger en cok 200 karakter.
//
// Suzgec bicimi (istekte `f`, JSON dizi): { k: kolon, op, v }
//   in    v: [deger | null]      birebir (null = bos)       icerir  v: metin (LIKE, kacisli)
//   esit  v: metin               birebir                    bos / dolu
//   min / max  v: sayi           gun  v: son N gun (tarih)  evet / hayir (bit)
//   eksik                        durum <> 'TAM'
// Siralama (`s`): "kolon:asc" | "kolon:desc"; esitlikte sabit anahtar (host, kok, ad, id).
'use strict';

const SINIR_SUZGEC = 20;
const SINIR_DEGER = 50;
const SINIR_METIN = 200;
const SINIR_F = 8000;
const SINIR_SECENEK = 200;

const ISLECLER = new Set([
  'in',
  'icerir',
  'esit',
  'bos',
  'dolu',
  'min',
  'max',
  'gun',
  'evet',
  'hayir',
  'eksik',
]);
const TIP_ISLEC = {
  metin: new Set(['in', 'icerir', 'esit', 'bos', 'dolu', 'eksik']),
  sayi: new Set(['in', 'min', 'max', 'bos', 'dolu']),
  tarih: new Set(['gun', 'bos', 'dolu']),
  bit: new Set(['evet', 'hayir']),
};

const SON_JOIN_U = `JOIN son ON son.host = u.host AND son.kosu_id = u.kosu_id
       JOIN ear_envanter_hostlari h ON h.kosu_id = u.kosu_id AND h.host = u.host`;
const ORTAM_IFADE = 'UPPER(LTRIM(RTRIM(h.ortam)))';
const WAR_VAR = (ifade) =>
  `EXISTS (SELECT 1 FROM ear_envanter_warlari w WHERE w.kosu_id = u.kosu_id AND w.host = u.host AND w.uyg_no = u.uyg_no AND ${ifade})`;

const m = (ifade, ek = {}) => ({ ifade, tip: 'metin', secim: true, sirala: true, ...ek });
const n = (ifade, ek = {}) => ({ ifade, tip: 'sayi', secim: false, sirala: true, ...ek });
const b = (ifade) => ({ ifade, tip: 'bit', secim: false, sirala: true });

// WAR teknolojileri uygulama duzeyinde: suzgec EXISTS ile; deger sayfadaki satirlara ayrica eklenir.
const WAR_TEK = ['spring_security', 'logback', 'jackson', 'thymeleaf', 'struts'];

const GORUNUMLER = Object.freeze({
  uygulamalar: {
    kaynak: `ear_envanter_uygulamalari u
       ${SON_JOIN_U}`,
    ara: (p) => `(u.ad LIKE ${p} ESCAPE '\\' OR u.host LIKE ${p} ESCAPE '\\')`,
    sabitSira: ['u.host', 'u.kok', 'u.ad', 'u.id'],
    kolonlar: {
      host: m('u.host'),
      ortam: m(ORTAM_IFADE),
      jboss: m('u.jboss'),
      kok: m('u.kok'),
      ad: m('u.ad'),
      bicim: m('u.bicim'),
      bag_hedefi: m('u.bag_hedefi'),
      kip: m('u.kip'),
      durum: m('u.durum'),
      war_sayisi: n('u.war_sayisi'),
      giris: n('u.giris'),
      jsp: n('u.jsp'),
      tld: n('u.tld'),
      jar: n('u.jar'),
      class_sayisi: n('u.class_sayisi'),
      ear_kutuphane_sayisi: n('u.ear_kutuphane_sayisi'),
      uyari_sayisi: n('u.uyari_sayisi'),
      application_xml: b('u.application_xml'),
      spring_boot: m('u.spring_boot'),
      spring_framework: m('u.spring_framework'),
      log4j: m('u.log4j'),
      servlet: m('u.servlet'),
      taranma_utc: { ifade: 'h.taranma_utc', tip: 'tarih', secim: false, sirala: true },
      ...Object.fromEntries(
        WAR_TEK.map((k) => [
          k,
          { ifade: `w.${k}`, tip: 'metin', secim: true, sirala: false, war: true },
        ]),
      ),
      eslenik_ortam_ici: { tip: 'metin', secim: true, sirala: false, eslenik: 'ortam_ici' },
      eslenik_ortamlar_arasi: {
        tip: 'metin',
        secim: true,
        sirala: false,
        eslenik: 'ortamlar_arasi',
      },
      eslenik_nesil: { tip: 'metin', secim: true, sirala: false, eslenik: 'nesil' },
    },
  },
  warlar: {
    kaynak: `ear_envanter_warlari w
       JOIN son ON son.host = w.host AND son.kosu_id = w.kosu_id
       JOIN ear_envanter_uygulamalari u ON u.kosu_id = w.kosu_id AND u.host = w.host AND u.uyg_no = w.uyg_no
       JOIN ear_envanter_hostlari h ON h.kosu_id = w.kosu_id AND h.host = w.host`,
    ara: (p) =>
      `(w.ad LIKE ${p} ESCAPE '\\' OR u.ad LIKE ${p} ESCAPE '\\' OR w.host LIKE ${p} ESCAPE '\\')`,
    sabitSira: ['w.host', 'u.kok', 'u.ad', 'w.war_no', 'w.id'],
    kolonlar: {
      host: m('w.host'),
      ortam: m(ORTAM_IFADE),
      jboss: m('u.jboss'),
      kok: m('u.kok'),
      uygulama: m('u.ad'),
      ad: m('w.ad'),
      yol: m('w.yol'),
      bicim: m('w.bicim'),
      durum: m('w.durum'),
      jsp: n('w.jsp'),
      tld: n('w.tld'),
      tld_dizini: b('w.tld_dizini'),
      jar: n('w.jar'),
      class_sayisi: n('w.class_sayisi'),
      web_xml: b('w.web_xml'),
      web_varyantlari: m('w.web_varyantlari'),
      jboss_web_xml: b('w.jboss_web_xml'),
      jboss_deployment_structure: b('w.jboss_deployment_structure'),
      spring_boot: m('w.spring_boot'),
      spring_framework: m('w.spring_framework'),
      spring_security: m('w.spring_security'),
      log4j: m('w.log4j'),
      logback: m('w.logback'),
      jackson: m('w.jackson'),
      thymeleaf: m('w.thymeleaf'),
      struts: m('w.struts'),
      servlet: m('w.servlet'),
      kutuphane_sayisi: n('w.kutuphane_sayisi'),
    },
  },
  kutuphaneler: {
    // Toplanmis gorunum: ad / surum WHERE'de, sayilar HAVING'de.
    toplu: true,
    ara: (p) => `s.ad LIKE ${p} ESCAPE '\\'`,
    sabitSira: ['s.ad', 's.surum'],
    kolonlar: {
      ad: m('s.ad'),
      surum: m('s.surum'),
      host_sayisi: n('COUNT(DISTINCT k.host)', { having: true }),
      uygulama_sayisi: n("COUNT(DISTINCT CONCAT(k.host, '|', k.uyg_no))", { having: true }),
      kopya: n('COUNT(*)', { having: true }),
    },
  },
});

function hata(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function likeDeseni(s) {
  const t = String(s == null ? '' : s)
    .trim()
    .slice(0, 100);
  return t ? `%${t.replace(/[\\%_[]/g, (c) => `\\${c}`)}%` : '';
}

const metinOf = (v) => String(v == null ? '' : v).slice(0, SINIR_METIN);

/** Istekteki `f` -> dogrulanmis suzgec listesi. Bilinmeyen kolon / islec / bicim 400. */
function suzgecleriAyristir(gorunum, ham) {
  const g = GORUNUMLER[gorunum];
  if (!g) throw hata(400, 'Bilinmeyen görünüm.', 'gecersiz_gorunum');
  if (ham == null || ham === '') return [];
  let dizi = ham;
  if (typeof ham === 'string') {
    if (ham.length > SINIR_F) throw hata(400, 'Süzgeç çok uzun.', 'gecersiz_suzgec');
    try {
      dizi = JSON.parse(ham);
    } catch {
      throw hata(400, 'Süzgeç okunamadı (JSON).', 'gecersiz_suzgec');
    }
  }
  if (!Array.isArray(dizi)) throw hata(400, 'Süzgeç bir liste olmalı.', 'gecersiz_suzgec');
  if (dizi.length > SINIR_SUZGEC)
    throw hata(400, `En çok ${SINIR_SUZGEC} süzgeç uygulanabilir.`, 'cok_suzgec');
  return dizi.map((x) => {
    const k = String((x && x.k) || '');
    const op = String((x && x.op) || '');
    const kol = Object.prototype.hasOwnProperty.call(g.kolonlar, k) ? g.kolonlar[k] : null;
    if (!kol) throw hata(400, `Bilinmeyen kolon: ${k.slice(0, 40)}`, 'gecersiz_kolon');
    if (!ISLECLER.has(op) || !TIP_ISLEC[kol.tip].has(op))
      throw hata(400, `${k} için geçersiz işlem: ${op.slice(0, 20)}`, 'gecersiz_islec');
    let v = x.v;
    if (op === 'in') {
      if (!Array.isArray(v) || !v.length || v.length > SINIR_DEGER)
        throw hata(400, `${k}: 1-${SINIR_DEGER} değer seçilmeli.`, 'gecersiz_deger');
      v = v.map((d) => (d == null ? null : metinOf(d)));
      // Sayi kolonunda metin deger SQL donusum hatasina (500) gitmesin: once burada reddedilir.
      if (kol.tip === 'sayi' && v.some((d) => d != null && !/^\d{1,12}$/.test(d)))
        throw hata(400, `${k}: değerler sayı olmalı.`, 'gecersiz_deger');
    } else if (op === 'icerir' || op === 'esit') {
      v = metinOf(v);
      if (!v) throw hata(400, `${k}: değer boş.`, 'gecersiz_deger');
    } else if (op === 'min' || op === 'max' || op === 'gun') {
      v = Number(v);
      if (!Number.isFinite(v) || v < 0 || v > 1e12)
        throw hata(400, `${k}: sayı geçersiz.`, 'gecersiz_deger');
    } else v = null;
    return { k, op, v, kol };
  });
}

/** Siralama: beyaz listeden; yoksa sabit sira. */
function siraAyristir(gorunum, ham) {
  const g = GORUNUMLER[gorunum];
  const sabit = g.sabitSira.join(', ');
  const s = String(ham || '');
  if (!s) return sabit;
  const [k, yon] = s.split(':');
  const kol = Object.prototype.hasOwnProperty.call(g.kolonlar, k) ? g.kolonlar[k] : null;
  if (!kol || !kol.sirala || !['asc', 'desc'].includes(yon))
    throw hata(400, `Bu kolona göre sıralanamaz: ${String(k).slice(0, 40)}`, 'gecersiz_sira');
  return `${kol.ifade} ${yon === 'desc' ? 'DESC' : 'ASC'}, ${sabit}`;
}

/**
 * Suzgecler -> { where: [], having: [], params } (parametre numaralari `ilk`ten baslar).
 * eslenikAnahtarlari(alan, kararlar) -> Promise<string[]> (kopya anahtari "host|kok|ad").
 */
async function kosullar(gorunum, suzgecler, { ilk, q, eslenikAnahtarlari, haric } = {}) {
  const g = GORUNUMLER[gorunum];
  const params = [];
  const where = [];
  const having = [];
  const p = (v) => {
    params.push(v);
    return `$${ilk + params.length - 1}`;
  };
  const qd = likeDeseni(q);
  if (qd) where.push(g.ara(p(qd)));
  for (const s of suzgecler) {
    if (haric && s.k === haric) continue;
    const kol = s.kol;
    if (kol.eslenik) {
      const anahtarlar = eslenikAnahtarlari
        ? await eslenikAnahtarlari(kol.eslenik, s.op === 'in' ? s.v : null, s.op)
        : [];
      where.push(
        `CONCAT(u.host, '|', u.kok, '|', u.ad) IN (SELECT value FROM OPENJSON(${p(JSON.stringify(anahtarlar))}))`,
      );
      continue;
    }
    const e = kol.ifade;
    let k;
    if (s.op === 'in') {
      const dolu = s.v.filter((x) => x != null);
      const parca = [];
      if (dolu.length)
        parca.push(`${e} IN (SELECT value FROM OPENJSON(${p(JSON.stringify(dolu))}))`);
      if (dolu.length !== s.v.length) parca.push(`${e} IS NULL`);
      k = `(${parca.join(' OR ')})`;
    } else if (s.op === 'icerir') k = `${e} LIKE ${p(likeDeseni(s.v))} ESCAPE '\\'`;
    else if (s.op === 'esit') k = `${e} = ${p(s.v)}`;
    else if (s.op === 'bos')
      k = kol.tip === 'metin' ? `(${e} IS NULL OR ${e} = '')` : `${e} IS NULL`;
    else if (s.op === 'dolu')
      k = kol.tip === 'metin' ? `(${e} IS NOT NULL AND ${e} <> '')` : `${e} IS NOT NULL`;
    else if (s.op === 'min') k = `${e} >= ${p(s.v)}`;
    else if (s.op === 'max') k = `${e} <= ${p(s.v)}`;
    else if (s.op === 'gun') k = `${e} >= DATEADD(day, -${p(Math.floor(s.v))}, SYSUTCDATETIME())`;
    else if (s.op === 'evet') k = `${e} = 1`;
    else if (s.op === 'hayir') k = `(${e} = 0 OR ${e} IS NULL)`;
    else if (s.op === 'eksik') k = `${e} <> 'TAM'`;
    if (kol.war) where.push(WAR_VAR(k));
    else if (kol.having) having.push(k);
    else where.push(k);
  }
  return { where, having, params };
}

const kolonOf = (gorunum, k) => {
  const g = GORUNUMLER[gorunum];
  return g && Object.prototype.hasOwnProperty.call(g.kolonlar, k) ? g.kolonlar[k] : null;
};

module.exports = {
  GORUNUMLER,
  WAR_TEK,
  SINIR_SUZGEC,
  SINIR_DEGER,
  SINIR_SECENEK,
  ORTAM_IFADE,
  likeDeseni,
  suzgecleriAyristir,
  siraAyristir,
  kosullar,
  kolonOf,
};
