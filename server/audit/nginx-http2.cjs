// server/audit/nginx-http2.cjs - Nginx Envanteri > HTTP/2 (2026-11-18) ozetleme (SAF).
//
// Kaynak: dbo.Nginx_Audit_Servers.http2 / http2_source (bmw_nginx/nginx_audit). Deger, nginx'in
// kendi kuraliyla hesaplanmis ETKIN durumdur (bkz. bmw_nginx/nginx_audit/README.md "HTTP/2 etkin
// mi"). Acik bloklarda kaynak:
//   server  : blokta `http2 on;`              listen  : blogun kendi `listen ... http2`'si
//   http    : http{} duzeyinden miras         socket  : ayni adres:port'taki baska blogun parametresi
//   default : TLS'siz soket; soketin varsayilan server'inda http2 acik (h2c ona gore kabul edilir)
// Kapali blokta kaynak 'stream' / 'mail' ise blok HTTP degildir (TCP / posta vekili): "kapali"
// sayilmaz, ayri sayilir ("HTTP degil").
// http2 NULL = OLCULMEDI (eski tarayici satiri, baglami cozulemeyen `http2` / `listen`). Olculmeyen
// blok "kapali" SAYILMAZ: kanitsiz kapali demek, acik bir sunucuyu temiz gosterirdi.
'use strict';

const KAYNAKLAR = ['server', 'listen', 'http', 'socket', 'default'];
const HTTP_DISI = ['stream', 'mail'];

/** BIT -> true/false; NULL/bilinmeyen -> null (olculmedi). */
function h2Degeri(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  return null;
}

function bosKaynak() {
  return Object.fromEntries(KAYNAKLAR.map((k) => [k, 0]));
}

const kaynakOf = (r) => String(r.http2_source || '').trim();

/**
 * Host bazinda sayim. Girdi: GROUP BY satirlari {host, http2, http2_source, n}.
 * @returns {{hosts: object[], totals: object}}
 */
function http2Ozeti(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const host = String(r.host || '')
      .trim()
      .toUpperCase();
    if (!host) continue;
    const n = Number(r.n) || 0;
    if (!m.has(host))
      m.set(host, {
        host,
        toplam: 0,
        acik: 0,
        kapali: 0,
        olculmedi: 0,
        httpDisi: 0,
        kaynak: bosKaynak(),
      });
    const h = m.get(host);
    const d = h2Degeri(r.http2);
    const k = kaynakOf(r);
    h.toplam += n;
    if (d === true) {
      h.acik += n;
      if (KAYNAKLAR.includes(k)) h.kaynak[k] += n;
    } else if (d === false && HTTP_DISI.includes(k)) h.httpDisi += n;
    else if (d === false) h.kapali += n;
    else h.olculmedi += n;
  }
  const hosts = [...m.values()].sort((a, b) => b.acik - a.acik || a.host.localeCompare(b.host));
  const kaynak = bosKaynak();
  for (const h of hosts) for (const k of KAYNAKLAR) kaynak[k] += h.kaynak[k];
  const topla = (alan) => hosts.reduce((s, h) => s + h[alan], 0);
  return {
    hosts,
    totals: {
      hosts: hosts.length,
      hostsAcik: hosts.filter((h) => h.acik > 0).length,
      hostsOlculmedi: hosts.filter((h) => h.olculmedi > 0).length,
      bloklar: topla('toplam'),
      acik: topla('acik'),
      kapali: topla('kapali'),
      olculmedi: topla('olculmedi'),
      httpDisi: topla('httpDisi'),
      kaynak,
    },
  };
}

/**
 * Bir sunucunun server bloklari: acik olanlar once, sonra olculmeyen, sonra kapali, en son HTTP
 * olmayanlar; dosya + sira. Girdi: {conf_file, seq, listen, server_name, ssl, http2, http2_source}.
 */
function http2Satirlari(rows) {
  const sira = (x) => (x.http2 === true ? 0 : x.http2 === null ? 1 : x.httpDisi ? 3 : 2);
  return (rows || [])
    .map((r) => {
      const http2 = h2Degeri(r.http2);
      const k = kaynakOf(r);
      return {
        confFile: String(r.conf_file || ''),
        seq: Number(r.seq) || 0,
        serverName: r.server_name ? String(r.server_name) : null,
        listen: r.listen ? String(r.listen) : null,
        ssl: h2Degeri(r.ssl) === true,
        http2,
        kaynak: http2 === true && KAYNAKLAR.includes(k) ? k : null,
        httpDisi: http2 === false && HTTP_DISI.includes(k) ? k : null,
      };
    })
    .sort((a, b) => sira(a) - sira(b) || a.confFile.localeCompare(b.confFile) || a.seq - b.seq);
}

module.exports = { KAYNAKLAR, HTTP_DISI, h2Degeri, http2Ozeti, http2Satirlari };
