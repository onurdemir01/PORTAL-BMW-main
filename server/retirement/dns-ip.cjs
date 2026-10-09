// server/retirement/dns-ip.cjs — Retirement: silinecek DNS kayitlari ve iade edilecek IP'ler (2026-10-09).
//
// Kullanici: "DNS silme ve IP iadesi adiminda hangi IP'nin iade edilecegi ve hangi DNS'in
// sildirilecegi guzelce gosterilsin." Kararlar (ayni gun):
//   * IP: IKISI BIRDEN - DNS adinin cozuldugu IP (LB VIP) VE web sunucusunda vhost'un dinledigi IP.
//     "Vhost'un dinledigi IP BASKA bir vhost tarafindan da dinleniyorsa IADE EDILMEZ."
//   * DNS turu (intranet 2523535_Delete_6 / internet 349792_Delete) TAHMIN EDILMEZ; Portal yalniz
//     listeler, turu kullanici secer (retirement_records.dns_turleri_json).
//
// Portal bu adimi CALISTIRMAZ (Smart kayitlari ekip tarafindan aciliyor); yalniz NE yapilacagini
// kanitlariyla gosterir.
//
// OLCULEMEDI != YOK (depo kurali):
//   * DNS cozulemediyse VIP "cozulemedi" - "IP yok" DEGIL.
//   * Vhost'un web sunucusu Server Hub'da taranmamissa IP'nin PAYLASILIP PAYLASILMADIGI
//     bilinmez: "olculemedi" - "iade edilebilir" DEGIL.
//   * '*' / '_default_' / bos listen: vhost belirli bir IP'ye bagli degil -> iade edilecek vhost IP'si YOK.
// PAYLASIM kendi kaydinin vhost'lari HARIC tutularak olculur (ayni uygulamanin :80 ve :443 bloklari
// ayni IP'yi dinler; bu paylasim sayilmaz).
'use strict';

const U = (s) => String(s ?? '').trim().toUpperCase();
const L = (s) => String(s ?? '').trim().toLowerCase();
const adlar = (v) => [v.server_name, ...String(v.aliases || '').split(/[\s,]+/)].map(L).filter(Boolean);
const gecerliAd = (a) => a && a.includes('.') && !a.includes('*') && !a.startsWith('~') && a !== 'localhost';
const OZEL_IP_YOK = new Set(['', '*', '0.0.0.0', '_default_', '[::]', '::']);
const ipOf = (listen) => {
  const ilk = String(listen || '').trim().split(/[\s,]+/)[0] || '';
  const i = ilk.lastIndexOf(':');
  return (i > 0 ? ilk.slice(0, i) : ilk.includes('.') ? ilk : '').replace(/^\[|\]$/g, '');
};

/**
 * Saf hesap (test edilir).
 * @param {{targets: {host:string, appName:string, web:{host:string, serverName:string, port?:string, confFile?:string}[]}[], dnsReuse?:boolean, lbReuse?:boolean}} rec
 * @param {{vhostRows: object[], certRows: object[], cozum: Record<string, {ips?: string[], hata?: string}>, turler?: Record<string,string>, taranan?: Set<string>}} veri
 */
function dnsIpOzeti(rec, { vhostRows = [], certRows = [], cozum = {}, turler = {}, taranan = new Set() }) {
  const bizim = [];
  for (const t of rec.targets || []) for (const w of t.web || []) bizim.push({ ...w, host: U(w.host), serverName: L(w.serverName), uygulama: t.appName, hedefHost: U(t.host) });
  const bizimMi = (host, sn) => bizim.some((w) => w.host === U(host) && w.serverName === L(sn));

  // ── DNS adlari: vhost ServerName + Server Hub'daki ServerAlias'lar
  const dnsMap = new Map();
  const ekle = (ad, w) => {
    if (!gecerliAd(ad)) return;
    if (!dnsMap.has(ad)) dnsMap.set(ad, { ad, vhostlar: [] });
    const d = dnsMap.get(ad);
    if (!d.vhostlar.some((x) => x.host === w.host && x.serverName === w.serverName)) d.vhostlar.push({ host: w.host, serverName: w.serverName });
  };
  for (const w of bizim) {
    ekle(w.serverName, w);
    for (const v of vhostRows) if (U(v.host) === w.host && L(v.server_name) === w.serverName) for (const a of adlar(v)) ekle(a, w);
  }
  const dns = [...dnsMap.values()].map((d) => {
    const paylasilan = [];
    for (const v of vhostRows) {
      if (bizimMi(v.host, v.server_name)) continue;
      if (adlar(v).includes(d.ad) && !paylasilan.some((p) => p.host === U(v.host) && p.serverName === L(v.server_name)))
        paylasilan.push({ host: U(v.host), serverName: L(v.server_name), confFile: v.conf_file || '' });
    }
    const c = cozum[d.ad] || {};
    const tur = turler[d.ad] === 'intranet' || turler[d.ad] === 'internet' ? turler[d.ad] : null;
    return {
      ...d,
      vip: Array.isArray(c.ips) ? c.ips : null,
      cozumHata: c.hata || null,
      paylasilan,
      tur,
      smartAkisi: tur === 'intranet' ? '2523535_Delete_6' : tur === 'internet' ? '349792_Delete' : null,
      durum: rec.dnsReuse ? 'kalacak' : paylasilan.length ? 'silinmemeli' : 'silinecek',
    };
  }).sort((a, b) => a.ad.localeCompare(b.ad));

  // ── VHOST IP'leri (web sunucusunda vhost'un dinledigi IP)
  const vhostIp = new Map();
  for (const w of bizim) {
    const hub = vhostRows.filter((v) => U(v.host) === w.host && L(v.server_name) === w.serverName);
    const cert = certRows.filter((c) => U(c.host) === w.host && L(c.server_name) === w.serverName);
    const ipler = new Set([...hub.map((v) => ipOf(v.listen)), ...cert.map((c) => String(c.ip || '').trim())].filter((x) => !OZEL_IP_YOK.has(x)));
    if (!ipler.size) {
      const k = `${w.host}|-|${w.serverName}`;
      if (!vhostIp.has(k)) vhostIp.set(k, { ip: null, host: w.host, vhostlar: [w.serverName], durum: hub.length || cert.length ? 'ozel_ip_yok' : 'olculemedi', digerleri: [] });
      continue;
    }
    for (const ip of ipler) {
      const k = `${w.host}|${ip}`;
      if (!vhostIp.has(k)) vhostIp.set(k, { ip, host: w.host, vhostlar: [], durum: null, digerleri: [] });
      const e = vhostIp.get(k);
      if (!e.vhostlar.includes(w.serverName)) e.vhostlar.push(w.serverName);
    }
  }
  for (const e of vhostIp.values()) {
    if (!e.ip) continue;
    const digerleri = [];
    for (const v of vhostRows) if (U(v.host) === e.host && ipOf(v.listen) === e.ip && !bizimMi(v.host, v.server_name)) digerleri.push(L(v.server_name) || '(adsiz vhost)');
    for (const c of certRows) if (U(c.host) === e.host && String(c.ip || '').trim() === e.ip && !bizimMi(c.host, c.server_name)) digerleri.push(L(c.server_name) || '(adsiz vhost)');
    e.digerleri = [...new Set(digerleri)].sort();
    e.durum = e.digerleri.length ? 'iade_edilmez' : taranan.has(e.host) ? 'iade' : 'olculemedi';
  }

  // ── LB VIP'leri (DNS'in cozuldugu IP'ler)
  const vipMap = new Map();
  for (const d of dns) for (const ip of d.vip || []) {
    if (!vipMap.has(ip)) vipMap.set(ip, { ip, dnsler: [] });
    vipMap.get(ip).dnsler.push(d.ad);
  }
  const vip = [...vipMap.values()].map((x) => {
    const silinmeyen = dns.filter((d) => d.durum === 'silinmemeli' && (d.vip || []).includes(x.ip)).map((d) => d.ad);
    return { ...x, durum: rec.lbReuse ? 'kalacak' : silinmeyen.length ? 'iade_edilmez' : 'iade', sebep: silinmeyen.length ? `başka vhost'un da kullandığı DNS bu IP'ye çözülüyor: ${silinmeyen.join(', ')}` : null };
  }).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));

  return { dns, vip, vhostIp: [...vhostIp.values()].sort((a, b) => a.host.localeCompare(b.host) || String(a.ip).localeCompare(String(b.ip))) };
}

/** DNS adlarini Portal sunucusunun cozumleyicisiyle IPv4'e cevirir (ad basina zaman asimi). */
async function cozumle(adListesi, { sureMs = 3000 } = {}) {
  const dns = require('node:dns').promises;
  const out = {};
  await Promise.all(adListesi.map(async (ad) => {
    try {
      const r = await Promise.race([
        dns.lookup(ad, { all: true, family: 4 }),
        new Promise((_, red) => setTimeout(() => red(new Error('zaman asimi')), sureMs)),
      ]);
      out[ad] = { ips: [...new Set(r.map((x) => x.address))].sort() };
    } catch (e) {
      out[ad] = { hata: e.code === 'ENOTFOUND' ? 'DNS kaydi bulunamadi (NXDOMAIN)' : String(e.code || e.message || e) };
    }
  }));
  return out;
}

/** Kayit icin ozet: Server Hub vhost'lari + sertifika envanteri (TBMWANS) + DNS cozumu. */
async function dnsIpHesapla(rec, { turler = {}, db } = {}) {
  const { query } = db || require('../inventory/mssql.cjs');
  const hostlar = [...new Set((rec.targets || []).flatMap((t) => (t.web || []).map((w) => U(w.host))))].filter((h) => /^[A-Z0-9][A-Z0-9._-]{0,62}$/.test(h));
  let hubHata = null;
  const [vhostRows, certRows] = hostlar.length ? await Promise.all([
    query(`SELECT v.host, v.server_name, v.aliases, v.listen, v.conf_file
             FROM dbo.Server_Hub_Vhosts v
             JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m ON m.host = v.host AND m.d = v.scan_date
            WHERE v.host IN (${hostlar.map((h) => `'${h}'`).join(',')})`).then((r) => r.recordset || []).catch((e) => { hubHata = String(e.message || e); return []; }),
    query(`SELECT host, ip, port, server_name FROM dbo.BMW_Certificates_Inventory WHERE UPPER(host) IN (${hostlar.map((h) => `'${h}'`).join(',')})`).then((r) => r.recordset || []).catch(() => []),
  ]) : [[], []];
  const taranan = new Set(vhostRows.map((v) => U(v.host)));
  const ilk = dnsIpOzeti(rec, { vhostRows, certRows, cozum: {}, turler, taranan });
  const cozum = await cozumle(ilk.dns.map((d) => d.ad));
  return { ...dnsIpOzeti(rec, { vhostRows, certRows, cozum, turler, taranan }), hubHata, taranmayan: hostlar.filter((h) => !taranan.has(h)) };
}

module.exports = { dnsIpOzeti, dnsIpHesapla, cozumle, ipOf };
