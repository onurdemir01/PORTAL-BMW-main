// server/audit/nginx-http2.cjs - Nginx_Audit_Servers.http2 degerinin okunmasi (SAF).
//
// Kaynak: dbo.Nginx_Audit_Servers.http2 / http2_source (bmw_nginx/nginx_audit). Deger, nginx'in
// kendi kuraliyla hesaplanmis ETKIN durumdur (bkz. bmw_nginx/nginx_audit/README.md "HTTP/2 etkin
// mi"). Kullanan: Nginx Hub > Envanter > Upstream Envanteri (nginx-upstream-envanter.cjs). Eski
// ayri "HTTP/2" sekmesi 2026-11-19'da kaldirildi; HTTP/2 durumu Upstream Envanteri'nde yasiyor.
// Kapali blokta kaynak 'stream' / 'mail' ise blok HTTP degildir (TCP / posta vekili): "kapali"
// sayilmaz, ayri sayilir ("HTTP degil").
// http2 NULL = OLCULMEDI (eski tarayici satiri, baglami cozulemeyen `http2` / `listen`). Olculmeyen
// blok "kapali" SAYILMAZ: kanitsiz kapali demek, acik bir sunucuyu temiz gosterirdi.
'use strict';

const HTTP_DISI = ['stream', 'mail'];

/** BIT -> true/false; NULL/bilinmeyen -> null (olculmedi). */
function h2Degeri(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  return null;
}

module.exports = { HTTP_DISI, h2Degeri };
