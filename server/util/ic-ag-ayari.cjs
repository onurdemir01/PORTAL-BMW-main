// server/util/ic-ag-ayari.cjs — kurum ic ag adresleri KOD DISINDA, ortam ayarinda (2026-11-15).
//
// Repo public: alt aglar ve DNS sunucu adresleri koda yazilmaz (SonarQube S1313). Iki ayar da JSON:
//   NGINX_RVP_ALT_AGLARI     {"<SUNUCU>": "<a.b.c.d/nn>", ...}   RP Secimi ekraninin alt ag sutunu
//   WEB_APP_DNS_SUNUCULARI   {"<bolge>": {"<site>": ["<a.b.c.d>", ...]}, ...}   Web uygulamasi DNS cozumu
// Ayar her cagrida process.env'den okunur (Admin ortam degiskeni degisikligi aninda gecer).
// Tanimsiz ya da bozuk ayar uygulamayi DUSURMEZ: bos doner ve `hata` sebebi soyler; bozuk tek girdi
// atilir, gecerli olanlar kullanilir.
'use strict';

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const AD = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

function jsonNesne(ham, ad) {
  const metin = String(ham ?? '').trim();
  if (!metin) return { nesne: {}, hata: `${ad} tanimli degil` };
  try {
    const n = JSON.parse(metin);
    if (n && typeof n === 'object' && !Array.isArray(n)) return { nesne: n, hata: null };
  } catch {
    /* asagida tek hata metni */
  }
  return { nesne: {}, hata: `${ad} gecerli bir JSON nesnesi degil` };
}

const cidrMi = (v) => {
  const [ip, onek, ...fazla] = String(v).split('/');
  return !fazla.length && IPV4.test(ip) && /^\d{1,2}$/.test(onek || '') && Number(onek) <= 32;
};

/** NGINX_RVP_ALT_AGLARI -> { altAglar: {SUNUCU: cidr}, hata }. Saf islev. */
function rvpAltAglari(env = process.env) {
  const { nesne, hata } = jsonNesne(env.NGINX_RVP_ALT_AGLARI, 'NGINX_RVP_ALT_AGLARI');
  const altAglar = {};
  let atilan = 0;
  for (const [k, v] of Object.entries(nesne)) {
    if (AD.test(k) && cidrMi(v)) altAglar[k.toUpperCase()] = String(v);
    else atilan += 1;
  }
  return {
    altAglar,
    hata: hata || (atilan ? `NGINX_RVP_ALT_AGLARI: ${atilan} gecersiz girdi atildi` : null),
  };
}

/** WEB_APP_DNS_SUNUCULARI -> { bolgeler: {bolge: {site: [ip]}}, hata }. Saf islev. */
function webAppDnsSunuculari(env = process.env) {
  const { nesne, hata } = jsonNesne(env.WEB_APP_DNS_SUNUCULARI, 'WEB_APP_DNS_SUNUCULARI');
  const bolgeler = {};
  let atilan = 0;
  for (const [bolge, siteler] of Object.entries(nesne)) {
    if (!AD.test(bolge) || !siteler || typeof siteler !== 'object' || Array.isArray(siteler)) {
      atilan += 1;
      continue;
    }
    const temiz = {};
    for (const [site, ipler] of Object.entries(siteler)) {
      const liste = Array.isArray(ipler) ? ipler.map(String).filter((ip) => IPV4.test(ip)) : [];
      if (AD.test(site) && liste.length) temiz[site] = liste;
      else atilan += 1;
    }
    if (Object.keys(temiz).length) bolgeler[bolge] = temiz;
  }
  return {
    bolgeler,
    hata: hata || (atilan ? `WEB_APP_DNS_SUNUCULARI: ${atilan} gecersiz girdi atildi` : null),
  };
}

module.exports = { rvpAltAglari, webAppDnsSunuculari };
