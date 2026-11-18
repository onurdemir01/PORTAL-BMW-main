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
'use strict';

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

/**
 * Sunucu basina ozet.
 * @param {object[]} hostRows  Nginx_Audit_Hosts {host, status}
 * @param {object[]} upsAgg    {host, n, kullanilan, resolve_yok, keepalive_yok}
 * @param {object[]} locAgg    {host, target_kind, n}
 * @param {(h:string)=>string} envOf
 */
function upstreamOzeti(hostRows, upsAgg, locAgg, envOf) {
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

module.exports = {
  DOGRUDAN_TURLER,
  serverListesi,
  adresOf,
  upstreamOzeti,
  upstreamDetayi,
  aramaSonucu,
};
