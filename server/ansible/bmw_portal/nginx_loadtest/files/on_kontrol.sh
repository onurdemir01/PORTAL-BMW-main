#!/bin/bash
# on_kontrol.sh - Portal Nginx Hub "Yuk Testi" on kontrolu. YUK URETMEZ, hicbir dosyaya/konfigurasyona yazmaz.
# Kullanim: on_kontrol.sh hedef    (hedef nginx sunucusunda, www ile)
#             ortam: HEDEF_IP HOST_BASLIGI [LOGDIR(/web_log) NGINX_PREFIX(/usr/nginx) NGINX_BIN NGINX_ERRLOG PROC_ROOT]
#           on_kontrol.sh yollar   (yuk makinesinde, www ile)
#             ortam: HEDEF_IP HOST_BASLIGI SNI(0|1) SENARYO(<tsv>) [UA_ONEK(portal-yuktesti) PARALEL(4) ZAMAN(5) CURL(curl)]
# Cikti   : SEKME ayrimli satirlar; son satir SONUC<TAB><OK|FAIL><TAB><mesaj>. '-' = olculemedi.
#   hedef : ip_yerel 1|0|-, nginx_T ok|fail, server_name_var 1|0|-, master_sayisi <n>, web_log_df <yuzde>|-,
#           log_dizini_okunur 1|0, log_format_ua 1|0|-, statik_direktif 1|0|-
#   yollar: ip_yuk_makinesinde 1|0|-, YOL<TAB><status><TAB><http surumu><TAB><content-encoding|-><TAB><content-length 1|0><TAB><yol>
#           (senaryo sirasiyla), HATA<TAB><status><TAB><yol> (200 olmayan ilk 20), OZET<TAB><toplam><TAB><n200><TAB>
#           <statik><TAB><dinamik><TAB><sikistirmasiz> (sikistirma yalniz 200 yanitlarda sayilir)
# Istek   : tekil yol basina TEK HTTP/1.1 GET (en cok 400 yol, istek basina 5 sn, en cok 4 paralel); https://<ip><yol> +
#           Host basligi (SNI=1: https://<host><yol> + --resolve host:443:ip). Accept-Encoding: br, gzip;
#           User-Agent <UA_ONEK>/onkontrol/1. Cerez, vekil sunucu ve ~/.curlrc YOK (-q, --noproxy '*', proxy env silinir).
# nginx -T: nginx_console_dump.sh ile AYNI estate komutu (dzdo <nginx> -p ... -c ... -e ... -T; dzdo yoksa/reddederse
#           dzdo'suz). Ciktisi yalniz gecici dosyada aranir, BASILMAZ (konfigurasyon icerigi loga dusmez).
# Cikis   : 0 olcum yapildi (sonucu satirlar soyler), 2 girdi hatasi, 3 guvenlik reddi (hedef IP yuk makinesinde yerel).
set -u
export LC_ALL=C
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

IP_RE='^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])[.]){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$'
HOST_RE='^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
# kos.sh / yuk_k6.js / har_senaryo.py ile AYNI beyaz liste (5 kolon, sorgu yok)
DESEN=$'^[0-9.]+\t[0-9]+\t[a-z]+\t[a-z]+\t/[A-Za-z0-9._~!$&\'()*+,;=:@%/-]*$'
YOL_SINIRI=400

sonuc() { printf 'SONUC\t%s\t%s\n' "$1" "$(printf '%s' "$2" | tr '\t\r\n' '   ' | cut -c1-300)"; }
red() { sonuc FAIL "$1"; exit "${2:-2}"; }
GECICI=""; d=""
trap '[ -n "$GECICI" ] && rm -rf "$GECICI"' EXIT

# ip_yerel_mi <ip>: 1 (bu sunucuda tanimli), 0 (degil), - (olculemedi)
ip_yerel_mi() {
  local ipk out=""
  for ipk in ip /sbin/ip /usr/sbin/ip; do
    if command -v "$ipk" >/dev/null 2>&1; then out="$("$ipk" -o -4 addr show 2>/dev/null)" && break; fi
  done
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | awk -v ip="$1" '{ for (i = 1; i < NF; i++) if ($i == "inet") { split($(i + 1), a, "/"); if (a[1] == ip) b = 1 } } END { print b ? 1 : 0 }'
    return
  fi
  out="$(hostname -I 2>/dev/null)" || out=""
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | tr ' ' '\n' | awk -v ip="$1" '$1 == ip { b = 1 } END { print b ? 1 : 0 }'
    return
  fi
  echo "-"
}

tek_yol() {   # tek_yol "<sira><TAB><yol>": tek istek, tek satir (PIPE_BUF altinda: paralel cikti karismaz)
  local sira="${1%%$'\t'*}" yol="${1#*$'\t'}" url ust out
  local a=(-q -sS -o /dev/null -D - --max-time "$ZAMAN" --connect-timeout "$ZAMAN" -k --noproxy '*'
           -H 'Accept-Encoding: br, gzip' -A "$UA_ONEK/onkontrol/1" -w '\n@@KOD %{http_code}\n')
  [ "$HTTP11" = 1 ] && a+=(--http1.1)
  if [ "$SNI" = 1 ]; then
    a+=(--resolve "$HOST_BASLIGI:443:$HEDEF_IP"); url="https://$HOST_BASLIGI$yol"
  else
    a+=(-H "Host: $HOST_BASLIGI"); url="https://$HEDEF_IP$yol"
  fi
  out="$("$CURL" ${a[@]+"${a[@]}"} "$url" 2>/dev/null)"
  printf '%s\n' "$out" | tr -d '\r' | awk -F'\t' -v sira="$sira" -v yol="$yol" '
    /^HTTP\/[0-9.]+ [0-9][0-9][0-9]/ { split($0, s, " "); ver = s[1]; ce = "-"; cl = 0; next }
    tolower($0) ~ /^content-encoding:/ { v = $0; sub(/^[^:]*:[ ]*/, "", v); sub(/[ ]+$/, "", v); if (v != "") ce = tolower(v); next }
    tolower($0) ~ /^content-length:/ { cl = 1; next }
    /^@@KOD [0-9]+$/ { kod = substr($0, 7) }
    END {
      if (kod == "") kod = "000"
      if (ver == "") { ver = "-"; ce = "-"; cl = 0 }
      printf "%s\tYOL\t%s\t%s\t%s\t%d\t%s\n", sira, kod, ver, (ce == "" ? "-" : ce), cl, yol
    }'
}

hedef() {
  local prefix bin tt ipy df okunur=0 f master=0 p c
  [[ "${HEDEF_IP:-}" =~ $IP_RE ]] || red "HEDEF_IP gecersiz"
  [[ "${HOST_BASLIGI:-}" =~ $HOST_RE ]] || red "HOST_BASLIGI gecersiz"
  LOGDIR="${LOGDIR:-/web_log}"
  prefix="${NGINX_PREFIX:-/usr/nginx}"
  bin="${NGINX_BIN:-$prefix/sbin/nginx}"
  PROC="${PROC_ROOT:-/proc}"
  GECICI="$(mktemp -d "${TMPDIR:-/tmp}/onkontrol.XXXXXX")" || red "gecici dizin olusturulamadi"
  d="$GECICI"
  chmod 700 "$d"

  ipy="$(ip_yerel_mi "$HEDEF_IP")"
  printf 'ip_yerel\t%s\n' "$ipy"

  tt=("$bin" -p "$prefix/" -c "$prefix/nginx.conf" -e "${NGINX_ERRLOG:-/web_log/error.log}" -T)
  if { command -v dzdo >/dev/null 2>&1 && dzdo -n ${tt[@]+"${tt[@]}"} > "$d/t" 2>/dev/null; } || ${tt[@]+"${tt[@]}"} > "$d/t" 2>/dev/null; then
    printf 'nginx_T\tok\n'
    # Yorumlar atilir; ';', '{', '}' ile bolunen her ifadede server_name belirtecleri TAM esitlikle aranir (joker/regex sayilmaz).
    awk -v h="$HOST_BASLIGI" '
      { sub(/#.*/, ""); n = split($0, P, /[;{}]/)
        for (j = 1; j <= n; j++) { s = P[j]; sub(/^[[:space:]]+/, "", s)
          if (s !~ /^server_name[[:space:]]/) continue
          m = split(s, T, /[[:space:]]+/)
          for (k = 2; k <= m; k++) { t = tolower(T[k]); gsub(/"/, "", t); if (t == h) b = 1 } } }
      END { printf "server_name_var\t%d\n", b ? 1 : 0 }' "$d/t"
    awk '{ sub(/#.*/, "") } /user-agent=\$http_user_agent/ { b = 1 } END { printf "log_format_ua\t%d\n", b ? 1 : 0 }' "$d/t"
    awk '{ sub(/#.*/, "") } /(^|[;{[:space:]])(brotli|gzip)_static[[:space:]]+(on|always)[[:space:]]*;/ { b = 1 }
         END { printf "statik_direktif\t%d\n", b ? 1 : 0 }' "$d/t"
  else
    printf 'nginx_T\tfail\nserver_name_var\t-\nlog_format_ua\t-\nstatik_direktif\t-\n'
  fi

  # cpu_kaydedici.sh'in gordugu ile AYNI tarama (/proc; hidepid'de www'nin gorduguyle)
  for f in "$PROC"/[0-9]*/cmdline; do
    c=""; IFS= read -r -d '' c < "$f" 2>/dev/null
    case "$c" in "nginx: master process"*) master=$((master + 1)) ;; esac
  done
  printf 'master_sayisi\t%d\n' "$master"

  df="$(df -P "$LOGDIR" 2>/dev/null | awk 'NR == 2 { sub(/%$/, "", $5); if ($5 ~ /^[0-9]+$/) print $5 + 0 }')"
  printf 'web_log_df\t%s\n' "${df:--}"

  if [ -d "$LOGDIR" ] && [ -r "$LOGDIR" ] && [ -x "$LOGDIR" ]; then
    for p in "$LOGDIR"/*.log; do
      if [ -f "$p" ] && [ -r "$p" ]; then okunur=1; break; fi
    done
  fi
  printf 'log_dizini_okunur\t%d\n' "$okunur"
  sonuc OK "hedef olculdu"
}

yollar() {
  local bozuk satir n sira=0 ipy
  [[ "${HEDEF_IP:-}" =~ $IP_RE ]] || red "HEDEF_IP gecersiz"
  [[ "${HOST_BASLIGI:-}" =~ $HOST_RE ]] || red "HOST_BASLIGI gecersiz"
  [[ "${SNI:-}" == 0 || "${SNI:-}" == 1 ]] || red "SNI 0 ya da 1 olmali"
  UA_ONEK="${UA_ONEK:-portal-yuktesti}"
  [[ "$UA_ONEK" =~ ^[a-z][a-z0-9-]{2,30}$ ]] || red "UA_ONEK gecersiz"
  PARALEL="${PARALEL:-4}"; ZAMAN="${ZAMAN:-5}"; CURL="${CURL:-curl}"
  [[ "$PARALEL" =~ ^[1-4]$ ]] || red "PARALEL 1..4 olmali"
  [[ "$ZAMAN" =~ ^[1-9]$ ]] || red "ZAMAN 1..9 sn olmali"
  [ -n "${SENARYO:-}" ] && [ -s "$SENARYO" ] && [ -r "$SENARYO" ] || red "SENARYO dosyasi yok/okunamiyor"
  command -v "$CURL" >/dev/null 2>&1 || red "curl bulunamadi"

  # Hedef IP bu (yuk) makinede yerelse istekler hedefe degil yuk makinesinin kendi nginx'ine gider: RED.
  ipy="$(ip_yerel_mi "$HEDEF_IP")"
  printf 'ip_yuk_makinesinde\t%s\n' "$ipy"
  [ "$ipy" = 0 ] || red "hedef IP yuk makinesinde yerel ya da olculemedi ($ipy); istek gonderilmedi" 3

  GECICI="$(mktemp -d "${TMPDIR:-/tmp}/onkontrol.XXXXXX")" || red "gecici dizin olusturulamadi"
  d="$GECICI"
  chmod 700 "$d"
  bozuk=$(tr -d '\r' < "$SENARYO" | grep -v '^#' | grep -v '^$' | grep -cvE "$DESEN")
  [ "$bozuk" -eq 0 ] || red "senaryoda $bozuk satir beklenen bicimde degil"
  # tekil yollar, senaryo sirasiyla; '//' ile baslayan ya da '..' parcali yol reddedilir
  tr -d '\r' < "$SENARYO" | grep -v '^#' | grep -v '^$' | cut -f5 | awk '!g[$0]++' > "$d/yollar"
  if grep -qE '^//|/[.][.](/|$)' "$d/yollar"; then red "senaryoda '//' ile baslayan ya da '..' parcali yol var"; fi
  n=$(wc -l < "$d/yollar" | tr -d ' ')
  [ "$n" -ge 1 ] || red "senaryoda yol yok"
  [ "$n" -le "$YOL_SINIRI" ] || red "senaryoda $n tekil yol var (en cok $YOL_SINIRI)"

  HTTP11=0
  "$CURL" --version 2>/dev/null | grep -qiE '^features:.*http2' && HTTP11=1
  export HEDEF_IP HOST_BASLIGI SNI UA_ONEK ZAMAN CURL HTTP11
  while IFS= read -r satir; do sira=$((sira + 1)); printf '%d\t%s\0' "$sira" "$satir"; done < "$d/yollar" \
    | xargs -0 -n 1 -P "$PARALEL" bash "$0" _tek > "$d/sonuc"
  sort -n -k1,1 "$d/sonuc" | cut -f2- > "$d/sirali"
  cat "$d/sirali"
  awk -F'\t' '
    $1 == "YOL" { t++
      if ($2 == "200") { o++; if ($4 == "-") y++; else if ($5 == 1) s++; else dn++ }
      else if (h < 20) { printf "HATA\t%s\t%s\n", $2, $6; h++ } }
    END { printf "OZET\t%d\t%d\t%d\t%d\t%d\n", t, o, s, dn, y }' "$d/sirali"
  [ "$(grep -c '^YOL' "$d/sirali")" -eq "$n" ] || red "$n yoldan yalniz $(grep -c '^YOL' "$d/sirali") sonuc dondu"
  sonuc OK "$n yol denendi"
}

case "${1:-}" in
  hedef) hedef ;;
  yollar) yollar ;;
  _tek) tek_yol "${2:-}" ;;
  *) red "kullanim: on_kontrol.sh hedef|yollar" ;;
esac
