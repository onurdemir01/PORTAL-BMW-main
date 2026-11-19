// server/audit/nginx-upstream-envanter.cjs - Nginx Hub > Upstream Envanteri (2026-11-19) (SAF).
//
// Kullanici: "Nginx Envanteri gibi bir envanter daha istiyorum: hangi sunucu herhangi bir
// upstream'a bagli mi, bagliysa hangi upstream'e bagli".
// Kaynak (nginx_audit, son tarama): Nginx_Audit_Upstreams (tanim + TUM server satirlari, servers
// kolonu; used = location ya da stream proxy_pass kullaniyor), Nginx_Audit_Locations (hedef + tur),
// Nginx_Audit_Servers (server_name).
// "Bagli" = en az bir upstream'i KULLANILIYOR (location ya da stream server proxy_pass ile). Tanimli
// ama kullanilmayan upstream bagli SAYILMAZ, ayrica "kullanilmayan" sayilir.
// Taramasi basarisiz / nginx'i kurulu olmayan sunucu "bagli degil" SAYILMAZ: "olculmedi".
// servers NULL = OLCULMEDI (eski tarayici yalniz SON server satirini yazardi): tek server SANILMAZ.
// servers sonu " ; +N" = analiz 2000 karakterde kesti; N satir listede yok (kesik).
// HTTP/2 (kullanici 2026-11-19: "upstream envanteri ile http2 envanterini ortaklastiralim"): kaynak
// Nginx_Audit_Servers.http2 / http2_source (bkz. nginx-http2.cjs). Kolon yoksa alanlar null
// (olculmedi); olculmeyen blok "kapali" SAYILMAZ.
// Ag bilgisi (kullanici 2026-11-19: "sunucularin yanina listen IP'sini, domain ve subnet bilgisini"):
//   listen IP : Nginx_Audit_Servers.listen (blogun TUM listen degerleri bosluklu tek metin; adres
//               belirteci parametrelerden ayiklanir). '*' = tum arayuzler (443, *:443, 0.0.0.0:443).
//   ip / domain / subnet : dbo.nginx_inventory (nginx_metadata; BIRINCIL arayuz). Subnet yalniz
//               birincil IP'nin agidir: belirli bir IP'yi dinleyen blok o subnet'in disindaysa
//               "subnet disi" diye isaretlenir, subnet'i uydurulmaz. 'unknown' = null.
'use strict';

const { h2Degeri, HTTP_DISI } = require('./nginx-http2.cjs');

const bit = (v) => v === true || v === 1 || v === '1';
const sayi = (v) => Number(v) || 0;
const H = (v) =>
  String(v || '')
    .trim()
    .toUpperCase();

/** Upstream'i atlayan / dogrudan hedef turleri (Nginx_Audit_Locations.target_kind). */
const DOGRUDAN_TURLER = ['fqdn', 'variable', 'unix', 'undefined'];

/**
 * "a:443 resolve ; b:443 backup ; +3" -> {liste: ['a:443 resolve', 'b:443 backup'], kesik: 3};
 * NULL -> null (olculmedi).
 */
function serverListesi(servers) {
  if (servers == null) return null;
  const parca = String(servers)
    .split(' ; ')
    .map((s) => s.trim())
    .filter(Boolean);
  let kesik = 0;
  const son = parca[parca.length - 1];
  if (son && /^\+\d+$/.test(son)) {
    kesik = Number(son.slice(1));
    parca.pop();
  }
  return { liste: parca, kesik };
}

/** Server satirindan adres: 'a.example:443 resolve weight=2' -> 'a.example:443'. */
function adresOf(server) {
  return (
    String(server || '')
      .trim()
      .split(/\s+/)[0] || ''
  );
}

/** nginx `listen` parametrelerinin '=' icermeyen (ciplak) olanlari: adres SANILMAZ. */
const LISTEN_PARAM = new Set([
  'default_server',
  'default',
  'ssl',
  'http2',
  'http3',
  'quic',
  'proxy_protocol',
  'deferred',
  'bind',
  'reuseport',
  'spdy',
]);
/** Analiz listen metnini bu uzunlukta keser (Nginx_Audit_Servers.listen NVARCHAR(400)). */
const LISTEN_SINIR = 400;

/**
 * Listen metninden dinlenen adresler (port ve parametre olmadan), sirali ve tekil.
 * '443 ssl 10.1.2.3:8443 ssl http2 [::]:443' -> ['*', '10.1.2.3', '[::]'].
 * '*' = tum IPv4 arayuzleri; unix soketi atlanir; parametreler (ssl, backlog=..) adres sayilmaz.
 * Bos metin = blokta listen YOK: nginx *:80'i (root degilse *:8000) dinler -> ['*'].
 * null = bilinmiyor (blok bulunamadi) -> [].
 * Metin analiz sinirinda (400) ise son belirtec yarim olabilir: atilir (sahte IP / '*' uretmez).
 */
function listenIpleri(listen) {
  if (listen == null) return [];
  const metin = String(listen);
  if (!metin.trim()) return ['*'];
  const belirtecler = metin.trim().split(/\s+/);
  if (metin.length >= LISTEN_SINIR) belirtecler.pop();
  const out = new Set();
  for (const t of belirtecler) {
    if (!t || t.includes('=') || t.startsWith('unix:') || LISTEN_PARAM.has(t.toLowerCase()))
      continue;
    let ip = null;
    if (/^\d+$/.test(t) || /^\*(:\d+)?$/.test(t)) ip = '*';
    else if (/^\[[0-9a-f:.]*\](:\d+)?$/i.test(t)) ip = t.slice(0, t.indexOf(']') + 1).toLowerCase();
    else if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(t)) ip = t.split(':')[0];
    else if (/^[a-z0-9][\w.-]*:\d+$/i.test(t)) ip = t.slice(0, t.lastIndexOf(':')).toLowerCase();
    // portsuz ad (`listen localhost;`, `listen app.example ssl;`): nginx :80 sayar
    else if (/^[a-z0-9][\w.-]*$/i.test(t)) ip = t.toLowerCase();
    if (ip === '0.0.0.0') ip = '*';
    if (ip) out.add(ip);
  }
  return [...out].sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)));
}

const ipSayi = (ip) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip || '');
  if (!m || m.slice(1).some((x) => Number(x) > 255)) return null;
  return m.slice(1).reduce((s, x) => s * 256 + Number(x), 0);
};

/** IPv4 adres CIDR icinde mi: true / false; karsilastirilamazsa (IPv6, ad, bozuk) null. */
function subnetIcinde(ip, cidr) {
  const [ag, onek] = String(cidr || '').split('/');
  const a = ipSayi(ip);
  const b = ipSayi(ag);
  const n = Number(onek);
  if (a == null || b == null || !/^\d+$/.test(onek || '') || n > 32) return null;
  const boy = 2 ** (32 - n);
  return Math.floor(a / boy) === Math.floor(b / boy);
}

/** Envanter adi -> Upstream Envanteri anahtari (buyuk harf, alan adi olmadan). */
const kisaAd = (v) => H(v).split('.')[0];
const bilinen = (v) => {
  const t = String(v ?? '').trim();
  return t && t.toLowerCase() !== 'unknown' ? t : null;
};

/** dbo.nginx_inventory satirlari -> Map(HOST -> {ip, domain, subnet}). */
function agHaritasi(invRows) {
  const m = new Map();
  for (const r of invRows || []) {
    const k = kisaAd(r.hostname);
    if (!k || m.has(k)) continue;
    m.set(k, { ip: bilinen(r.ip), domain: bilinen(r.domain), subnet: bilinen(r.subnet) });
  }
  return m;
}

/** Belirli (joker olmayan) IPv4 listen adreslerinden birincil subnet disinda kalanlar. */
function subnetDisi(ipler, subnet) {
  if (!subnet) return [];
  return ipler.filter((ip) => ip !== '*' && subnetIcinde(ip, subnet) === false);
}

/**
 * Ozet satirlarina ag bilgisi ekler (sunucu basina: ip, domain, subnet, listen IP'leri).
 * @param {object} ozet          upstreamOzeti sonucu
 * @param {object[]|null} invRows dbo.nginx_inventory {hostname, ip, domain, subnet}; null = okunamadi
 * @param {object[]|null} listenRows Nginx_Audit_Servers DISTINCT {host, listen}; null = okunamadi
 */
function agBilgisiEkle(ozet, invRows, listenRows) {
  const ag = invRows ? agHaritasi(invRows) : null;
  const dinle = new Map();
  for (const r of listenRows || []) {
    const k = H(r.host);
    if (!dinle.has(k)) dinle.set(k, new Set());
    for (const ip of listenIpleri(r.listen)) dinle.get(k).add(ip);
  }
  const hosts = (ozet.hosts || []).map((h) => {
    const a = ag ? ag.get(h.host) || null : null;
    const listenIp = listenRows
      ? [...(dinle.get(h.host) || [])].sort((x, y) =>
          x === '*' ? -1 : y === '*' ? 1 : x.localeCompare(y),
        )
      : null;
    return {
      ...h,
      ip: a ? a.ip : null,
      domain: a ? a.domain : null,
      subnet: a ? a.subnet : null,
      listenIp,
      subnetDisi: listenIp && a ? subnetDisi(listenIp, a.subnet) : [],
    };
  });
  return {
    ...ozet,
    hosts,
    totals: {
      ...ozet.totals,
      agOlculdu: Boolean(invRows),
      listenOlculdu: Boolean(listenRows),
      agBilinmeyen: ag ? hosts.filter((h) => !ag.has(h.host)).length : hosts.length,
    },
  };
}

/**
 * Bir server_name'in (ayni ada sahip TUM server bloklari) HTTP/2 durumu.
 * Girdi: [{http2, http2_source}]. Cikti: 'acik' | 'kismen' (bazi bloklar acik) | 'kapali' |
 * 'http_degil' (stream / mail) | 'olculmedi'. Acik blok yoksa ve biri olculmediyse 'olculmedi'
 * (kanitsiz "kapali" denmez).
 */
function http2Durumu(rows) {
  const d = new Set();
  for (const r of rows || []) {
    const v = h2Degeri(r.http2);
    if (v === true) d.add('acik');
    else if (v === false && HTTP_DISI.includes(String(r.http2_source || '').trim()))
      d.add('http_degil');
    else if (v === false) d.add('kapali');
    else d.add('olculmedi');
  }
  if (d.has('acik')) return d.size === 1 ? 'acik' : 'kismen';
  if (!d.size || d.has('olculmedi')) return 'olculmedi';
  return d.has('kapali') ? 'kapali' : 'http_degil';
}

/**
 * Sunucu basina ozet.
 * @param {object[]} hostRows  Nginx_Audit_Hosts {host, status}
 * @param {object[]} upsAgg    {host, n, kullanilan, resolve_yok, keepalive_yok}
 * @param {object[]} locAgg    {host, target_kind, n}
 * @param {(h:string)=>string} envOf
 * @param {object[]|null} [h2Agg]  Nginx_Audit_Servers {host, n, acik}; null = http2 kolonu yok
 */
function upstreamOzeti(hostRows, upsAgg, locAgg, envOf, h2Agg = null) {
  const m = new Map();
  const al = (host) => {
    const k = H(host);
    if (!k) return null;
    if (!m.has(k))
      m.set(k, {
        host: k,
        ortam: envOf(k),
        durum: null,
        upstream: 0,
        kullanilan: 0,
        kullanilmayan: 0,
        resolveYok: 0,
        keepaliveYok: 0,
        upstreamLocation: 0,
        dogrudanLocation: 0,
        degiskenLocation: 0,
        tanimsizLocation: 0,
        bagli: false,
        olculmedi: false,
        http2Acik: h2Agg ? 0 : null,
        http2Blok: h2Agg ? 0 : null,
      });
    return m.get(k);
  };
  for (const r of hostRows || []) {
    const h = al(r.host);
    if (h) h.durum = r.status ? String(r.status) : null;
  }
  for (const r of upsAgg || []) {
    const h = al(r.host);
    if (!h) continue;
    h.upstream += sayi(r.n);
    h.kullanilan += sayi(r.kullanilan);
    h.resolveYok += sayi(r.resolve_yok);
    h.keepaliveYok += sayi(r.keepalive_yok);
  }
  for (const r of locAgg || []) {
    const h = al(r.host);
    if (!h) continue;
    const k = String(r.target_kind || '');
    if (k === 'upstream') h.upstreamLocation += sayi(r.n);
    else if (k === 'fqdn') h.dogrudanLocation += sayi(r.n);
    else if (k === 'variable') h.degiskenLocation += sayi(r.n);
    else if (k === 'undefined') h.tanimsizLocation += sayi(r.n);
  }
  for (const r of h2Agg || []) {
    // yalniz upstream envanterinde olan sunucular (Hosts satiri olmayan sunucu eklenmez)
    const h = m.get(H(r.host));
    if (!h) continue;
    h.http2Blok += sayi(r.n);
    h.http2Acik += sayi(r.acik);
  }
  const hosts = [...m.values()].map((h) => {
    const bagli = h.kullanilan > 0;
    return {
      ...h,
      kullanilmayan: Math.max(0, h.upstream - h.kullanilan),
      bagli,
      // tarama ok degilse "bagli degil" kanitsiz olurdu (bagli kaniti varsa bagli kalir)
      olculmedi: !bagli && h.durum !== 'ok',
    };
  });
  hosts.sort((a, b) => Number(b.bagli) - Number(a.bagli) || a.host.localeCompare(b.host));
  const topla = (k) => hosts.reduce((s, h) => s + h[k], 0);
  return {
    hosts,
    totals: {
      hosts: hosts.length,
      bagli: hosts.filter((h) => h.bagli).length,
      bagliDegil: hosts.filter((h) => !h.bagli && !h.olculmedi).length,
      olculmedi: hosts.filter((h) => h.olculmedi).length,
      upstreamsiz: hosts.filter((h) => h.upstream === 0 && !h.olculmedi).length,
      upstream: topla('upstream'),
      kullanilmayan: topla('kullanilmayan'),
      dogrudanLocation: topla('dogrudanLocation'),
      degiskenLocation: topla('degiskenLocation'),
      tanimsizLocation: topla('tanimsizLocation'),
      http2Olculdu: Boolean(h2Agg),
      http2Host: hosts.filter((h) => h.http2Acik > 0).length,
    },
  };
}

/**
 * Tek sunucunun upstream'leri: tanim, TUM server satirlari, kullanan server_name + location'lar;
 * ayrica upstream'i ATLAYAN location'lar (dogrudan / degisken / unix / tanimsiz) hedefe gore.
 * @param {object[]} upsRows  {conf_file, name, server, servers?, resolve, keepalive, zone, used}
 * @param {object[]} locRows  {conf_file, srv_seq, location, proxy_target, target_kind}
 * @param {object[]} srvRows  {seq, server_name, conf_file}
 * @param {boolean} serversOlculdu  servers kolonu var mi
 */
function upstreamDetayi(upsRows, locRows, srvRows, serversOlculdu) {
  const adOf = new Map((srvRows || []).map((s) => [sayi(s.seq), s.server_name || null]));
  const kullanan = new Map();
  const dogrudan = new Map();
  for (const l of locRows || []) {
    const hedef = String(l.proxy_target || '');
    const k = String(l.target_kind || '');
    const satir = {
      confFile: String(l.conf_file || ''),
      // srv_seq 0 = sahip server bulunamadi (include zinciri cozulemedi): ad uydurulmaz
      serverName: adOf.get(sayi(l.srv_seq)) ?? null,
      location: String(l.location || ''),
    };
    if (k === 'upstream') {
      if (!kullanan.has(hedef)) kullanan.set(hedef, []);
      kullanan.get(hedef).push(satir);
    } else if (DOGRUDAN_TURLER.includes(k)) {
      const a = `${k}\u0000${hedef}`;
      if (!dogrudan.has(a)) dogrudan.set(a, { hedef, tur: k, kullananlar: [] });
      dogrudan.get(a).kullananlar.push(satir);
    }
  }
  const sirala = (xs) =>
    xs.sort(
      (a, b) =>
        String(a.serverName || '').localeCompare(String(b.serverName || '')) ||
        a.location.localeCompare(b.location),
    );
  const upstreams = (upsRows || []).map((u) => {
    const sl = serversOlculdu ? serverListesi(u.servers) : null;
    const ad = String(u.name || '');
    return {
      ad,
      confFile: String(u.conf_file || ''),
      servers: sl ? sl.liste : null,
      serversKesik: sl ? sl.kesik : 0,
      // servers olculmediyse elde yalniz SON server satiri var (tam liste degil)
      sonServer: sl ? null : u.server ? String(u.server) : null,
      resolve: bit(u.resolve),
      keepalive: bit(u.keepalive),
      zone: bit(u.zone),
      kullaniliyor: bit(u.used),
      kullananlar: sirala(kullanan.get(ad) || []),
    };
  });
  upstreams.sort(
    (a, b) =>
      Number(b.kullaniliyor) - Number(a.kullaniliyor) ||
      b.kullananlar.length - a.kullananlar.length ||
      a.ad.localeCompare(b.ad),
  );
  const dogrudanListe = [...dogrudan.values()]
    .map((d) => ({ ...d, kullananlar: sirala(d.kullananlar) }))
    .sort((a, b) => b.kullananlar.length - a.kullananlar.length || a.hedef.localeCompare(b.hedef));
  return { upstreams, dogrudan: dogrudanListe };
}

/**
 * Ters arama sonucu: arka uc / upstream adi eslesen satirlar, sunucu + upstream basina bir satir.
 * Kesik listede (+N) ya da olculmeyen listede `server` kolonu (SON satir) da aranir; o zaman
 * tamListe=false (eslesme olmamasi "bagli degil" demek degildir).
 * @param {object[]} rows {host, name, server, servers?, used}
 * @param {string} q
 */
function aramaSonucu(rows, q, serversOlculdu) {
  const ara = String(q || '')
    .trim()
    .toLowerCase();
  const out = [];
  for (const r of rows || []) {
    const sl = serversOlculdu ? serverListesi(r.servers) : null;
    const tum = sl ? [...sl.liste] : [];
    const tamListe = !!sl && !sl.kesik;
    if (!tamListe && r.server && !tum.some((s) => adresOf(s) === adresOf(r.server)))
      tum.push(String(r.server));
    const eslesen = [...new Set(tum.filter((s) => s.toLowerCase().includes(ara)).map(adresOf))];
    const adEsler = String(r.name || '')
      .toLowerCase()
      .includes(ara);
    if (!eslesen.length && !adEsler) continue;
    out.push({
      host: H(r.host),
      upstream: String(r.name || ''),
      eslesen,
      adEsler,
      tamListe,
      kullaniliyor: bit(r.used),
    });
  }
  out.sort((a, b) => a.host.localeCompare(b.host) || a.upstream.localeCompare(b.upstream));
  return out;
}

/**
 * Disa aktarim (kullanici, 2026-11-19: "sunucu - server name - upstream - upstream endpoint"):
 * location -> upstream baglantisi basina, upstream'in HER arka ucu icin bir satir.
 * Girdi: {host, server_name, upstream, server, servers} (Locations x Servers x Upstreams).
 * Arka uc listesi olculmediyse ya da kesikse (+N) eldeki adresler yazilir ve o upstream
 * `eksik` sayilir (ekran indirmeden once soyler; CSV'ye uydurma satir eklenmez).
 * Sahibi bilinmeyen location (srv_seq 0) server_name bos -> "(bilinmiyor)".
 */
function baglantiSatirlari(rows, serversOlculdu, http2Olculdu = false, ag = null) {
  const gor = new Set();
  const eksik = new Set();
  const out = [];
  // HTTP/2 ve listen server_name basina: o adin upstream'e giden TUM bloklari (ayni adli ama
  // upstream'e gitmeyen blok, or. yalniz `return 301` yapan :80 blogu, bu listeye girmez)
  const h2 = new Map();
  for (const r of rows || []) {
    const k = `${H(r.host)}\u0000${r.server_name ? String(r.server_name) : '(bilinmiyor)'}`;
    if (!h2.has(k)) h2.set(k, []);
    h2.get(k).push(r);
  }
  for (const r of rows || []) {
    const host = H(r.host);
    const upstream = String(r.upstream || '');
    if (!host || !upstream) continue;
    const serverName = r.server_name ? String(r.server_name) : '(bilinmiyor)';
    const sl = serversOlculdu ? serverListesi(r.servers) : null;
    let ucler = sl ? sl.liste.map(adresOf) : [];
    if (!sl || sl.kesik) {
      eksik.add(`${host}\u0000${upstream}`);
      if (r.server && !ucler.includes(adresOf(r.server))) ucler = [...ucler, adresOf(r.server)];
    }
    for (const endpoint of ucler.length ? ucler : ['']) {
      const k = `${host}\u0000${serverName}\u0000${upstream}\u0000${endpoint}`;
      if (gor.has(k)) continue;
      gor.add(k);
      const ayni = h2.get(`${host}\u0000${serverName}`) || [r];
      const http2 = http2Olculdu ? http2Durumu(ayni) : null;
      const a = ag ? ag.get(host) || null : null;
      const listenIp = [...new Set(ayni.flatMap((x) => listenIpleri(x.listen)))].sort((x, y) =>
        x === '*' ? -1 : y === '*' ? 1 : x.localeCompare(y),
      );
      out.push({
        host,
        hostIp: a ? a.ip : null,
        domain: a ? a.domain : null,
        subnet: a ? a.subnet : null,
        serverName,
        listenIp,
        subnetDisi: a ? subnetDisi(listenIp, a.subnet) : [],
        upstream,
        endpoint,
        http2,
      });
    }
  }
  out.sort(
    (a, b) =>
      a.host.localeCompare(b.host) ||
      a.serverName.localeCompare(b.serverName) ||
      a.upstream.localeCompare(b.upstream) ||
      a.endpoint.localeCompare(b.endpoint),
  );
  return { satirlar: out, eksikUpstream: eksik.size };
}

module.exports = {
  agBilgisiEkle,
  agHaritasi,
  listenIpleri,
  subnetIcinde,
  baglantiSatirlari,
  http2Durumu,
  DOGRUDAN_TURLER,
  serverListesi,
  adresOf,
  upstreamOzeti,
  upstreamDetayi,
  aramaSonucu,
};
