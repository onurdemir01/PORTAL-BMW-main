#!/bin/bash
# hazirlik.sh - Portal Nginx Hub "Yuk Testi": kosu oncesi hedef nginx ayari (yuk_srv_ayar=1). Hedefte www ile calisir.
# Kullanim: hazirlik.sh uygula|dosyalar|kanit|geri_al
#   uygula  : yarim kalan yedek varsa once geri alir; 3 konf dosyasinin yedegini <UST>/hazirlik altina (kosu dizini DISINDA,
#             0700) yazar, dosyalari duzenler, nginx -t, nginx -T ile dogrular, reload, eski worker'lari bekler. Beklenen
#             satir ya da yazma izni yoksa HICBIR sey degismeden FAIL; nginx -t duserse dosyalar geri, FAIL.
#   dosyalar: (yalniz kosu) DIZIN altinda istenmeyen .gz / .br silinir, istenen tur HER SEFERINDE secilen seviyeyle yeniden
#             uretilir (baska seviyeden kalan dosya olcumu bozar). Yeni olusturulanlar manifest'e yazilir; eski .gz / .br yeniden
#             uretilse de manifest'e girmez. Kanit sonuc dizinine yazilir.
#   kanit   : (yalniz kosu; dosyalar sonrasi, kaydedici oncesi) static kosuda senaryodaki yollardan en buyuk 3 ornek gercek nginx'ten
#             istenir: 200 + istenen Content-Encoding + Content-Length = diskteki .br / .gz boyutu degilse FAIL. brotli on acik
#             kaldigi icin .br bulunamazsa nginx sessizce anlik sikistirmaya duserdi. Static kapaliysa disk_kanit yok, OK.
#   geri_al : manifest'teki dosyalari siler; konf dosyasi hala bizim yazdigimizsa (ya da yazimimiz yarim kaldiysa: yaz<i> isareti)
#             yedegi yazar, degilse DOKUNMAZ, ozgun kopyayi <UST>/hazirlik_dokunulmadi_<kosu>/ altina alir ve UYARI basar; nginx -t,
#             reload, yedek silinir. Yedek yoksa no-op OK. -t / reload duserse yedek KORUNUR (yeniden denenir).
#             Yedek BU kosunun degilse (meta kosu != KOSU_ID) ve DEVRAL=1 degilse HIC dokunmaz (geri_al_durum baska): eski bir
#             kosunun Durdur'u kilitsiz calisir, suren kosunun konfunu geri almamali. DEVRAL=1 yalniz hedef kilidini tutan is
#             (on_kontrol / kosu) icindir; uygula da devralir.
# Ortam   : PROTOKOL(h1|h2) AE(br|gzip|identity) SEVIYE('' ya da rakam) STATIK(0|1) DIZIN KOSU_ID UST(<www ev>/.portal_yuktesti)
#           SONUC(kosu dizini; kanit <SONUC>/R<id>/) [NGINX_PREFIX(/usr/nginx) NGINX_BIN NGINX_ERRLOG(/web_log/error.log)
#           UYGULAMA_KOK(/usr/nginx/applications) RELOAD_BEKLE(90) BR_OMUR(600) BR_MODUL KILIT_BEKLE(60)]. geri_al UST, KOSU_ID
#           ve DEVRAL(0|1) ister. kanit ek olarak HEDEF_IP, HOST_BASLIGI ve <SONUC>/senaryo.tsv ister.
# Kilit   : uc kip <UST>/hazirlik.lock uzerinde flock ile siralanir (flock yoksa UYARI, devam); Portal kilidine tek basina
#           guvenilmez. Baska kosunun yedegine bakan geri_al kilit BEKLEMEZ (dokunmayacagi seyi beklemesin).
# Konf    : <prefix>/conf.d/default.conf 'http2 on;' (h2 acik, h1 yorumlu); <prefix>/conf/gzip.conf gzip_comp_level ve
#           gzip_static; <prefix>/conf/brotli.conf brotli_comp_level ve brotli_static. Seviye yalniz secilen sikistirmanin
#           konfunda degisir. static: ae=br -> brotli_static on; ae=gzip|identity -> gzip_static on; digerleri off.
#           Satir yoksa comp_level satirinin ardina eklenir. Dosyalar yerinde yazilir (sahip / izin korunur).
# .br     : sunucuda brotli ikilisi yok. Ayni nginx ikilisiyle gecici, ayricaliksiz ornek (127.0.0.1, bos yuksek port) acilir;
#           her dosya 'Accept-Encoding: br' ile alinir. Ornek trap ile kapanir, KILL'e karsi 'timeout BR_OMUR' altinda kosar.
# Cikti   : anahtar<TAB>deger satirlari, UYARI<TAB>metin; son satir SONUC<TAB><OK|FAIL><TAB><metin>. nginx -T ciktisi BASILMAZ.
# Cikis   : 0 tamam, 1 FAIL, 2 girdi hatasi.
# Betik CRLF ile gelmisse (zip tasimasi) LF kopyasiyla yeniden baslar; bu satirin sonundaki # CR'yi yutar. Kopya betigin yaninda
# sabit adla (<betik>.lf): durdur.sh kosu dizinindeki hazirlik.sh.lf'yi de tanir, /tmp'deki kopya durdurulamazdi.
if [ -z "${HAZIRLIK_LF:-}" ] && grep -q "$(printf '\r')" "$0" 2>/dev/null; then HAZIRLIK_LF="$0.lf" && export HAZIRLIK_LF && tr -d '\r' < "$0" > "$HAZIRLIK_LF" && exec bash "$HAZIRLIK_LF" "$@"; fi #
set -u
export LC_ALL=C
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

MOD="${1:-}"
PREFIX="${NGINX_PREFIX:-/usr/nginx}"
BIN="${NGINX_BIN:-$PREFIX/sbin/nginx}"
ERRLOG="${NGINX_ERRLOG:-/web_log/error.log}"
UYG_KOK="${UYGULAMA_KOK:-/usr/nginx/applications}"
BR_MODUL="${BR_MODUL:-$PREFIX/modules/ngx_http_brotli_filter_module.so}"
RELOAD_BEKLE="${RELOAD_BEKLE:-90}"
BR_OMUR="${BR_OMUR:-600}"
KILIT_BEKLE="${KILIT_BEKLE:-60}"
UST="${UST:-}"
YEDEK="$UST/hazirlik"
KONF=("" "$PREFIX/conf.d/default.conf" "$PREFIX/conf/gzip.conf" "$PREFIX/conf/brotli.conf")
RE_HTTP2='^[[:space:]]*#*[[:space:]]*http2[[:space:]]+on[[:space:]]*;[[:space:]]*(#.*)?$'
RE_GZ_SEVIYE='^[[:space:]]*gzip_comp_level[[:space:]]+[0-9]+[[:space:]]*;'
RE_BR_SEVIYE='^[[:space:]]*brotli_comp_level[[:space:]]+[0-9]+[[:space:]]*;'
SURE0="$SECONDS"

BR_PID=""; CURL_PID=""; BR_DIZIN=""; ISLENEN=""; GECICI=""
UYARI_N=0

sonuc() { printf 'SONUC\t%s\t%s\n' "$1" "$(temiz "$2" | cut -c1-300)"; }
temiz() { printf '%s' "$1" | tr '\t\r\n' '   ' | tr -cd ' -~'; }
kir() { sonuc FAIL "$1"; exit "${2:-1}"; }
uyari() {
  UYARI_N=$((UYARI_N + 1))
  printf 'UYARI\t%s\n' "$(temiz "$1" | cut -c1-300)"
  [ -d "$YEDEK" ] && printf 'uyari\t%s\n' "$(temiz "$1" | cut -c1-300)" >> "$YEDEK/kanit" 2>/dev/null
  return 0
}
ozet() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
meta() { awk -F'\t' -v k="$1" '$1 == k { print $2; exit }' "$YEDEK/meta" 2>/dev/null; }
hata_satiri() {   # nginx ciktisindan tek satir: once [emerg] / [crit] / [alert], yoksa ilk 'failed' / 'error', yoksa ilk satir
  grep -m1 -E '\[(emerg|crit|alert)\]' "$1" 2>/dev/null || grep -m1 -iE 'failed|error|denied|not found' "$1" 2>/dev/null || head -n 1 "$1" 2>/dev/null
}

temizle() {
  if [ -n "$CURL_PID" ]; then
    kill -TERM "$CURL_PID" 2>/dev/null
    wait "$CURL_PID" 2>/dev/null
    CURL_PID=""
  fi
  if [ -n "$BR_PID" ]; then
    kill -TERM "$BR_PID" 2>/dev/null
    wait "$BR_PID" 2>/dev/null
    BR_PID=""
  fi
  [ -n "$ISLENEN" ] && rm -f -- "$ISLENEN"
  [ -n "$BR_DIZIN" ] && rm -rf -- "$BR_DIZIN"
  [ -n "$GECICI" ] && rm -rf -- "$GECICI"
  [ -n "${HAZIRLIK_LF:-}" ] && rm -f -- "$HAZIRLIK_LF"
}
trap temizle EXIT
trap 'exit 143' TERM INT

# nginx_kos <arg...>: non_prod_create.yaml ile AYNI estate komutu (dzdo <nginx> -p ... -c ... -e ...). Yalniz cikis kodu ve
# ciktisi doner; cagiran dosyaya yonlendirir.
nginx_kos() { dzdo "$BIN" -p "$PREFIX/" -c "$PREFIX/nginx.conf" -e "$ERRLOG" "$@" < /dev/null; }

# worker_bekle: reload sonrasi 'worker process is shutting down' suzulene dek en cok RELOAD_BEKLE sn. Olcumu eski worker'lar
# bozmasin. [n]ginx kalibi: awk'in arguman metni ps'te gorunur, kacissiz desen kendini bulurdu. Ilk 1 sn: sinyal daha islenmemis
# olabilir. Bitmezse UYARI, devam (yuk testi uzun baglantili ortamda da kosabilir).
worker_bekle() {
  local i=0 n liste
  sleep 1
  while :; do
    if ! liste="$(ps -eo pid=,args= -ww 2>/dev/null)" || [ -z "$liste" ]; then
      uyari "ps calismadi; eski worker'lar olculemedi"
      return 0
    fi
    n="$(printf '%s\n' "$liste" | awk '/[n]ginx: worker process is shutting down/ { c++ } END { print c + 0 }')"
    if [ "$n" = 0 ]; then
      printf 'worker_bekleme_sn\t%d\n' "$i"
      return 0
    fi
    if [ "$i" -ge "$RELOAD_BEKLE" ]; then
      uyari "reload sonrasi $RELOAD_BEKLE sn gecti, $n eski worker hala kapaniyor (olcum etkilenebilir)"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
}

# kilit_al: kipler arasi flock. Fd 9 cocuklara miras kalir: uzun yasayan cocuklarda (gecici nginx, curl) kapatilir. flock yoksa
# UYARI satiri, devam (yalniz Portal kilidi kalir); sayaca girmez: her geri alma 'uyari' olmasin.
kilit_al() {
  if ! command -v flock > /dev/null 2>&1; then
    printf 'UYARI\tflock yok; hazirlik kipleri yalniz Portal kilidiyle siralaniyor\n'
    return 0
  fi
  exec 9> "$UST/hazirlik.lock" || return 1
  flock -w "$KILIT_BEKLE" 9
}

# yaz_dogrula <kaynak> <hedef> <i>: yerinde yazma (sahip / izin korunur) + ozet denetimi. Yazim basarmazsa yaz<i> isareti KALIR:
# sonraki geri_al yarim dosyayi "baskasi degistirmis" sanmaz, yeniden yazar (disk dolu gibi yollar tek yedegi sildiriyordu).
yaz_dogrula() {
  local bek
  bek="$(ozet "$1")"
  [ -n "$bek" ] || return 1
  : > "$YEDEK/yaz$3" || return 1
  cat "$1" > "$2" || return 1
  [ "$(ozet "$2")" = "$bek" ] || return 1
  rm -f -- "$YEDEK/yaz$3"
}

# ozgun_sakla <i>: baskasinin degistirdigi dosyaya dokunulmaz ama yedek silinecek; ozgun kopya kaybolmasin. Son 5 kosu tutulur.
ozgun_sakla() {
  local d
  d="$UST/hazirlik_dokunulmadi_$(meta kosu)"
  ( umask 077; mkdir -p "$d" ) || return 1
  cp -p -- "$YEDEK/o$1" "$d/${KONF[$1]##*/}" || return 1
  ls -dt "$UST"/hazirlik_dokunulmadi_* 2>/dev/null | tail -n +6 | while IFS= read -r p; do rm -rf -- "$p"; done
  KORUNAN="$d"
}

# br_artik_kapat: KILL ile olen dosyalar kipinin gecici nginx'i BR_OMUR dolana dek yasardi. Pid yalniz argv'sinde br_gecici varsa
# kapatilir (pid yeniden kullanilmis olabilir).
br_artik_kapat() {
  local p
  p="$(head -c 32 "$YEDEK/br_gecici/nginx.pid" 2>/dev/null | tr -cd '0-9')"
  [ -n "$p" ] || return 0
  if tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "$YEDEK/br_gecici/"; then kill -TERM "$p" 2>/dev/null; fi
  return 0
}

# geri_al_is: GERI_DURUM yok|baska|ok|uyari|hata, GERI_METIN. SONUC satiri basmaz (uygula da cagirir, DEVRAL_IS=1 ile).
geri_al_is() {
  local i k cur oz uy dizin yeniden=0 yuklenen=0 dokunulmayan=0 silinen=0 p o sahip
  GERI_DURUM=ok; GERI_METIN=""
  if [ ! -d "$YEDEK" ]; then
    GERI_DURUM=yok; GERI_METIN="yedek yok"
    return 0
  fi
  sahip="$(meta kosu)"
  if [ "${DEVRAL_IS:-0}" != 1 ] && [ "$sahip" != "$KOSU_ID" ]; then
    GERI_DURUM=baska; GERI_METIN="yedek baska kosunun (R${sahip:-?}), dokunulmadi"
    return 0
  fi
  br_artik_kapat
  dizin="$(meta dizin)"
  if [ -f "$YEDEK/manifest" ] && [ -n "$dizin" ]; then
    while IFS= read -r -d '' p; do
      case "$p" in "$dizin"/*.gz | "$dizin"/*.br) ;; *) continue ;; esac
      case "$p" in *"/../"*) continue ;; esac
      if [ -f "$p" ] && [ ! -L "$p" ]; then
        rm -f -- "$p" && silinen=$((silinen + 1))
      fi
    done < "$YEDEK/manifest"
  fi
  [ -n "$dizin" ] && [ -d "$dizin" ] && find "$dizin" -type f -name '*.hazirlik_tmp' -delete 2>/dev/null
  [ -f "$YEDEK/reload_gerek" ] && yeniden=1
  for i in 1 2 3; do
    k="${KONF[$i]}"
    cur="$(ozet "$k")"; oz="$(meta "o$i")"; uy="$(meta "u$i")"
    if [ -z "$oz" ] || [ -z "$uy" ]; then
      GERI_DURUM=hata; GERI_METIN="yedek bozuk: $k ozeti yok"
      continue
    fi
    if [ "$cur" = "$oz" ]; then
      rm -f -- "$YEDEK/yaz$i"
      continue
    fi
    if [ "$cur" = "$uy" ] || [ -f "$YEDEK/yaz$i" ]; then
      : > "$YEDEK/reload_gerek"
      if yaz_dogrula "$YEDEK/o$i" "$k" "$i"; then
        touch -r "$YEDEK/o$i" "$k" 2>/dev/null
        yeniden=1; yuklenen=$((yuklenen + 1))
      else
        GERI_DURUM=hata; GERI_METIN="$k yazilamadi, yedek korundu"
      fi
    elif ozgun_sakla "$i"; then
      dokunulmayan=$((dokunulmayan + 1))
      uyari "$k baskasi tarafindan degistirilmis, geri alinmadi; ozgun kopya $KORUNAN altinda"
    else
      GERI_DURUM=hata; GERI_METIN="$k baskasi tarafindan degistirilmis ve ozgun kopya saklanamadi, yedek korundu"
    fi
  done
  printf 'silinen\t%d\ngeri_yuklenen\t%d\ndokunulmayan\t%d\n' "$silinen" "$yuklenen" "$dokunulmayan"
  [ "$GERI_DURUM" = hata ] && return 1
  if [ "$yeniden" = 1 ]; then
    o="$YEDEK/nginx.out"
    if ! nginx_kos -t > "$o" 2>&1; then
      GERI_DURUM=hata; GERI_METIN="geri alma nginx -t basarisiz, yedek korundu: $(hata_satiri "$o")"
      return 1
    fi
    if ! nginx_kos -s reload > "$o" 2>&1; then
      GERI_DURUM=hata; GERI_METIN="geri alma reload basarisiz, yedek korundu: $(hata_satiri "$o")"
      return 1
    fi
    worker_bekle
  fi
  if ! rm -rf -- "$YEDEK"; then
    GERI_DURUM=hata; GERI_METIN="yedek dizini silinemedi: $YEDEK"
    return 1
  fi
  if [ "$UYARI_N" -gt 0 ] || [ "$dokunulmayan" -gt 0 ]; then
    GERI_DURUM=uyari
  fi
  GERI_METIN="$yuklenen konf geri yuklendi, $silinen dosya silindi, $dokunulmayan konf dokunulmadi"
  return 0
}

girdi_ust() {
  [[ "$UST" =~ ^/[A-Za-z0-9._/-]+/[.]portal_yuktesti$ ]] || kir "UST gecersiz: $UST" 2
  [[ "$UST" != *"/../"* ]] || kir "UST icinde .. var" 2
}

girdi_kosu() {
  KOSU_ID="${KOSU_ID:-}"
  [[ "$KOSU_ID" =~ ^[0-9]{1,10}$ ]] || kir "KOSU_ID gecersiz" 2
}

girdi() {
  PROTOKOL="${PROTOKOL:-}"; AE="${AE:-}"; SEVIYE="${SEVIYE:-}"; STATIK="${STATIK:-}"; DIZIN="${DIZIN:-}"; KOSU_ID="${KOSU_ID:-}"; SONUC_KOK="${SONUC:-}"
  girdi_ust
  [[ "$PROTOKOL" == h1 || "$PROTOKOL" == h2 ]] || kir "PROTOKOL h1 ya da h2 olmali" 2
  [[ "$AE" == br || "$AE" == gzip || "$AE" == identity ]] || kir "AE br, gzip ya da identity olmali" 2
  [[ "$STATIK" == 0 || "$STATIK" == 1 ]] || kir "STATIK 0 ya da 1 olmali" 2
  girdi_kosu
  case "$AE" in
    br) [[ "$SEVIYE" =~ ^[1-9][0-9]?$ ]] && [ "$SEVIYE" -le 11 ] || kir "brotli seviyesi 1-11 olmali" 2 ;;
    gzip) [[ "$SEVIYE" =~ ^[1-9]$ ]] || kir "gzip seviyesi 1-9 olmali" 2 ;;
    identity) [ -z "$SEVIYE" ] || kir "identity iken seviye bos olmali" 2 ;;
  esac
  [[ "$DIZIN" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$DIZIN" == "$UYG_KOK"/* ]] && [[ "$DIZIN" != *..* ]] && [[ "$DIZIN" != *//* ]] && [[ "$DIZIN" != */ ]] \
    || kir "DIZIN $UYG_KOK altinda olmali: $DIZIN" 2
}

# dizin_denetle: yok, symlink ya da gercek yolu uygulama kokunun disinda ise FAIL.
dizin_denetle() {
  local g k
  [ -d "$DIZIN" ] || kir "dizin yok: $DIZIN"
  [ ! -L "$DIZIN" ] || kir "dizin symlink: $DIZIN"
  g="$(readlink -f "$DIZIN" 2>/dev/null)"; k="$(readlink -f "$UYG_KOK" 2>/dev/null)"
  [ -n "$g" ] && [ -n "$k" ] && [[ "$g" == "$k"/* ]] || kir "dizin uygulama kokunun disina cikiyor: $DIZIN"
}

# dizin_yazma_denetle: on kontrol (uygula) sorunu gecelik kuyruktan once gorsun; yoksa her static kosu iki reload harcayip duserdi.
# Static kapali kosuda yazma yalniz silinecek dosya varsa gerekir: UYARI.
dizin_yazma_denetle() {
  local y
  y="$(find "$DIZIN" -type d ! -writable -print -quit 2>/dev/null)"
  [ -n "$y" ] || return 0
  [ "$STATIK" = 1 ] && kir "dizine yazma izni yok: $y (static dosyalari uretilemez); hicbir sey degismedi"
  uyari "dizine yazma izni yok: $y; .gz / .br varsa silinemez"
}

# br_konf_yaz <dizin> <port>: gecici nginx konfu. Yollar elle verilir: derleme varsayilanlari ayricaliksiz acilamaz.
br_konf_yaz() {
  local d="$1" port="$2"
  {
    [ -f "$BR_MODUL" ] && printf 'load_module %s;\n' "$BR_MODUL"
    printf 'worker_processes 1;\ndaemon off;\nmaster_process off;\npid %s/nginx.pid;\nerror_log %s/error.log;\n' "$d" "$d"
    printf 'events { worker_connections 64; }\nhttp {\n  default_type application/octet-stream;\n  access_log off;\n'
    printf '  client_body_temp_path %s/t_body;\n  proxy_temp_path %s/t_proxy;\n  fastcgi_temp_path %s/t_fcgi;\n' "$d" "$d" "$d"
    printf '  uwsgi_temp_path %s/t_uwsgi;\n  scgi_temp_path %s/t_scgi;\n' "$d" "$d"
    printf '  gzip off;\n  brotli on;\n  brotli_comp_level %s;\n  brotli_types *;\n  brotli_min_length 0;\n' "$SEVIYE"
    printf '  server {\n    listen 127.0.0.1:%s;\n    root %s;\n    location / { }\n  }\n}\n' "$port" "$DIZIN"
  } > "$d/nginx.conf"
}

# br_on_denetim <dizin>: curl ve modul (gecici konfun -t'si, ayricaliksiz). uygula'da da kosar: on kontrol sorunu gecelik
# kuyruktan once gorsun.
br_on_denetim() {
  local d="$1"
  command -v curl > /dev/null 2>&1 || kir "curl yok: .br uretilemez"
  [ -x "$BIN" ] || kir "nginx ikilisi www ile calistirilamiyor: $BIN (.br uretilemez)"
  br_konf_yaz "$d" 65000
  if ! "$BIN" -p "$d/" -c "$d/nginx.conf" -e "$d/error.log" -t > "$d/t.out" 2>&1 < /dev/null; then
    kir "gecici nginx konfu reddedildi (brotli modulu yok ya da yuklenemiyor, $BR_MODUL): $(hata_satiri "$d/t.out")"
  fi
}

# awk: satir sonundaki CR korunur; son satirda yeni satir yoksa eklenir (yedek baytlari birebir saklar).
http2_duzenle() {   # http2_duzenle <kaynak> <hedef> <acik|yorum>
  awk -v mod="$3" '
    { s = $0; cr = ""; if (sub(/\r$/, "", s)) cr = "\r"
      if (s ~ /^[ \t]*#*[ \t]*http2[ \t]+on[ \t]*;[ \t]*(#.*)?$/) {
        match(s, /^[ \t]*/); ind = substr(s, 1, RLENGTH); r = substr(s, RLENGTH + 1)
        yorumlu = (r ~ /^#/)
        if (mod == "acik" && yorumlu) { sub(/^#*[ \t]*/, "", r); print ind r cr; next }
        if (mod == "yorum" && !yorumlu) { print ind "#" r cr; next }
      }
      print $0 }' "$1" > "$2"
}

sikistirma_duzenle() {   # sikistirma_duzenle <kaynak> <hedef> <gzip|brotli> <seviye|''> <on|off>
  local var=0
  grep -Eq "^[[:space:]]*$3_static[[:space:]]+(on|off|always)[[:space:]]*;" "$1" && var=1
  awk -v ad="$3" -v seviye="$4" -v durum="$5" -v var="$var" '
    BEGIN { re_sev = "^[ \t]*" ad "_comp_level[ \t]+[0-9]+[ \t]*;"; re_st = "^[ \t]*" ad "_static[ \t]+(on|off|always)[ \t]*;" }
    { s = $0; cr = ""; if (sub(/\r$/, "", s)) cr = "\r"
      match(s, /^[ \t]*/); ind = substr(s, 1, RLENGTH)
      if (s ~ re_sev) {
        if (seviye != "") print ind ad "_comp_level " seviye ";" cr; else print $0
        if (!var && !eklendi) { print ind ad "_static " durum ";" cr; eklendi = 1 }
        next }
      if (s ~ re_st) { print ind ad "_static " durum ";" cr; next }
      print $0 }' "$1" > "$2"
}

# konf_dogrula <-T dosyasi>: duzenlenen direktif etkin konfta gorunuyor mu; baska dosyada ayni direktif UYARI. Cikis 1: etkin konf
# istenen degil (T_METIN). -T ciktisi yalniz gecici dosyada aranir, BASILMAZ.
konf_dogrula() {
  local t="$1" sev_ad="" yan satir tur a b gorulen=0 farkli=0 h2=0
  [ "$AE" = gzip ] && sev_ad=gzip_comp_level
  [ "$AE" = br ] && sev_ad=brotli_comp_level
  T_METIN=""
  if ! grep -q '^# configuration file ' "$t"; then
    uyari "nginx -T ciktisi beklenen bicimde degil; etkin konf dogrulanamadi"
    return 0
  fi
  yan="$t.ozet"
  awk -v df="${KONF[1]}" -v gf="${KONF[2]}" -v bf="${KONF[3]}" '
    /^# configuration file / { f = $4; sub(/:[ \t\r]*$/, "", f); next }
    { s = $0; sub(/\r$/, "", s); sub(/#.*/, "", s)
      if (s ~ /^[ \t]*(gzip|brotli)_comp_level[ \t]+[0-9]+[ \t]*;/) {
        split(s, p, /[ \t;]+/); i = (p[1] == "") ? 2 : 1
        if ((p[i] == "gzip_comp_level" && f == gf) || (p[i] == "brotli_comp_level" && f == bf)) print "seviye\t" p[i] "\t" p[i + 1]
        else print "baska\t" p[i] "\t" f }
      if (s ~ /^[ \t]*http2[ \t]+on[ \t]*;/) { if (f == df) print "http2\tdefault\t1"; else print "baska\thttp2\t" f }
      if (s ~ /^[ \t]*listen[ \t].*[ \t]http2[ \t;]/) print "baska\tlisten_http2\t" f
    }' "$t" | sort -u > "$yan"
  while IFS=$'\t' read -r tur a b; do
    case "$tur" in
      seviye) if [ "$a" = "$sev_ad" ]; then if [ "$b" = "$SEVIYE" ]; then gorulen=1; else farkli=1; fi; fi ;;
      http2) h2=1 ;;
      baska)
        case "$a" in
          http2 | listen_http2) uyari "$b icinde $a var; HTTP/2 ayari etkisiz olabilir" ;;
          "$sev_ad") uyari "$b icinde $a var; seviye ayari etkisiz olabilir" ;;
        esac ;;
    esac
  done < "$yan"
  if [ -n "$sev_ad" ] && { [ "$gorulen" = 0 ] || [ "$farkli" = 1 ]; }; then
    T_METIN="etkin konfta $sev_ad $SEVIYE gorunmuyor (konf dosyasi include edilmiyor olabilir)"
    return 1
  fi
  if { [ "$PROTOKOL" = h2 ] && [ "$h2" = 0 ]; } || { [ "$PROTOKOL" = h1 ] && [ "$h2" = 1 ]; }; then
    T_METIN="etkin konfta default.conf http2 durumu istenen degil ($PROTOKOL)"
    return 1
  fi
  return 0
}

# geri_yaz: uygula icinde dusen -t / dogrulama sonrasi ozgun baytlar; basarirsa yedek silinir. Cikis 1: Play 7 yeniden dener.
geri_yaz() {
  local i
  for i in 1 2 3; do
    yaz_dogrula "$YEDEK/o$i" "${KONF[$i]}" "$i" || return 1
    touch -r "$YEDEK/o$i" "${KONF[$i]}" 2>/dev/null
  done
  rm -rf -- "$YEDEK"
}

# direktif_oku <dosya> <ad>: yorum olmayan son deger (nginx de sonuncuyu alir).
direktif_oku() {
  tr -d '\r' < "$1" | awk -v ad="$2" '{ s = $0; sub(/#.*/, "", s); n = split(s, p, /[ \t;]+/); i = (p[1] == "") ? 2 : 1; if (n >= i + 1 && p[i] == ad) v = p[i + 1] } END { print v }'
}

# uygulanan_oku: kanit ISTENENI degil diskteki konfu yazar; uygula'daki bir hata istenen degeri kanita tasiyip Portal'a "uyumlu"
# dedirtmesin. Cikti: UG_HTTP2 UG_SEVIYE UG_STATIK (acik|kapali|karisik).
uygulanan_oku() {
  local gz br
  UG_HTTP2=kapali
  [ "$(direktif_oku "${KONF[1]}" http2)" = on ] && UG_HTTP2=acik
  UG_SEVIYE=""
  [ "$AE" = gzip ] && UG_SEVIYE="$(direktif_oku "${KONF[2]}" gzip_comp_level)"
  [ "$AE" = br ] && UG_SEVIYE="$(direktif_oku "${KONF[3]}" brotli_comp_level)"
  gz="$(direktif_oku "${KONF[2]}" gzip_static)"; br="$(direktif_oku "${KONF[3]}" brotli_static)"
  if [ "$gz" = off ] && [ "$br" = off ]; then UG_STATIK=kapali
  elif { [ "$AE" = br ] && [ "$br" = on ] && [ "$gz" = off ]; } || { [ "$AE" != br ] && [ "$gz" = on ] && [ "$br" = off ]; }; then UG_STATIK=acik
  else UG_STATIK=karisik
  fi
}

uygula() {
  local i k st_gz=off st_br=off sv_gz="" sv_br="" h2mod=yorum o t
  girdi
  mkdir -p "$UST" || kir "UST olusturulamadi: $UST"
  kilit_al || kir "baska bir hazirlik islemi suruyor ($KILIT_BEKLE sn beklendi); hicbir sey degismedi"
  if [ -d "$YEDEK" ]; then
    printf 'yarim_kalan\t1\n'
    DEVRAL_IS=1
    geri_al_is || kir "yarim kalan yedek geri alinamadi, yeni ayar uygulanmadi: $GERI_METIN"
  fi
  dizin_denetle
  dizin_yazma_denetle
  if [ "$STATIK" = 1 ]; then
    command -v curl > /dev/null 2>&1 || kir "curl yok: disk kaniti alinamaz; hicbir sey degismedi"
  fi
  for i in 1 2 3; do
    k="${KONF[$i]}"
    [ -f "$k" ] || kir "konf dosyasi yok: $k; hicbir sey degismedi"
    [ -r "$k" ] || kir "konf dosyasi okunamiyor: $k; hicbir sey degismedi"
    [ -w "$k" ] || kir "konf dosyasina yazma izni yok: $k; hicbir sey degismedi"
  done
  grep -Eq "$RE_HTTP2" "${KONF[1]}" || kir "beklenen satir yok: ${KONF[1]} icinde 'http2 on;' (acik ya da yorumlu); hicbir sey degismedi"
  grep -Eq "$RE_GZ_SEVIYE" "${KONF[2]}" || kir "beklenen satir yok: ${KONF[2]} icinde gzip_comp_level; hicbir sey degismedi"
  grep -Eq "$RE_BR_SEVIYE" "${KONF[3]}" || kir "beklenen satir yok: ${KONF[3]} icinde brotli_comp_level; hicbir sey degismedi"

  [ "$PROTOKOL" = h2 ] && h2mod=acik
  if [ "$STATIK" = 1 ]; then
    if [ "$AE" = br ]; then st_br=on; else st_gz=on; fi
  fi
  [ "$AE" = gzip ] && sv_gz="$SEVIYE"
  [ "$AE" = br ] && sv_br="$SEVIYE"

  # Yedek once hazirlik dizininde kurulur, tek mv ile yayinlanir: yarim yedek hic gorunmez; uygulanan ozet yazmadan once belli.
  rm -rf -- "$UST"/.hazirlik_yeni.*
  GECICI="$UST/.hazirlik_yeni.$$"
  ( umask 077; mkdir "$GECICI" ) || kir "yedek dizini olusturulamadi: $GECICI"
  if [ "$AE" = br ] && [ "$STATIK" = 1 ]; then
    mkdir "$GECICI/br"
    br_on_denetim "$GECICI/br"
    rm -rf -- "$GECICI/br"
  fi
  printf 'kosu\t%s\ndizin\t%s\n' "$KOSU_ID" "$DIZIN" > "$GECICI/meta" || kir "yedek yazilamadi"
  for i in 1 2 3; do
    cp -p -- "${KONF[$i]}" "$GECICI/o$i" || kir "yedek alinamadi: ${KONF[$i]}"
  done
  http2_duzenle "$GECICI/o1" "$GECICI/u1" "$h2mod" || kir "default.conf duzenlenemedi; hicbir sey degismedi"
  sikistirma_duzenle "$GECICI/o2" "$GECICI/u2" gzip "$sv_gz" "$st_gz" || kir "gzip.conf duzenlenemedi; hicbir sey degismedi"
  sikistirma_duzenle "$GECICI/o3" "$GECICI/u3" brotli "$sv_br" "$st_br" || kir "brotli.conf duzenlenemedi; hicbir sey degismedi"
  for i in 1 2 3; do
    printf 'o%s\t%s\nu%s\t%s\n' "$i" "$(ozet "$GECICI/o$i")" "$i" "$(ozet "$GECICI/u$i")" >> "$GECICI/meta" || kir "yedek yazilamadi"
  done
  mv -T -- "$GECICI" "$YEDEK" || kir "yedek yayinlanamadi: $YEDEK"
  GECICI=""

  o="$YEDEK/nginx.out"
  for i in 1 2 3; do
    if ! yaz_dogrula "$YEDEK/u$i" "${KONF[$i]}" "$i"; then
      geri_yaz || kir "${KONF[$i]} yazilamadi ve geri donulemedi; yedek korundu"
      kir "${KONF[$i]} yazilamadi; dosyalar geri alindi"
    fi
  done
  if ! nginx_kos -t > "$o" 2>&1; then
    t="$(hata_satiri "$o")"
    geri_yaz || kir "nginx -t basarisiz ve geri donulemedi, yedek korundu: $t"
    kir "nginx -t basarisiz, dosyalar geri alindi: $t"
  fi
  t="$YEDEK/nginx_T"
  : > "$t"; chmod 600 "$t"
  if nginx_kos -T > "$t" 2>/dev/null; then
    if ! konf_dogrula "$t"; then
      rm -f -- "$t" "$t.ozet"
      geri_yaz || kir "$T_METIN ve geri donulemedi; yedek korundu"
      kir "$T_METIN; dosyalar geri alindi"
    fi
  else
    uyari "nginx -T calismadi; etkin konf dogrulanamadi"
  fi
  rm -f -- "$t" "$t.ozet"
  if ! nginx_kos -s reload > "$o" 2>&1; then
    t="$(hata_satiri "$o")"
    geri_yaz || kir "reload basarisiz ve geri donulemedi, yedek korundu: $t"
    kir "reload basarisiz, dosyalar geri alindi: $t"
  fi
  worker_bekle
  uygulanan_oku
  printf 'http2\t%s\nae\t%s\nseviye\t%s\nstatic\t%s\ndizin\t%s\n' "$UG_HTTP2" "$AE" "$UG_SEVIYE" "$UG_STATIK" "$DIZIN" | tee -a "$YEDEK/kanit"
  printf 'sure_uygula_sn\t%d\n' "$((SECONDS - SURE0))" | tee -a "$YEDEK/kanit"
  sonuc OK "sunucu ayari uygulandi"
}

url_kodla() {   # yol parcalarini yuzde kodlar ('/' kalir); bayt bayt (LC_ALL=C)
  local s="$1" i c h o=""
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [A-Za-z0-9._~/-]) o+="$c" ;;
      *) printf -v h '%%%02X' "$(($(printf '%d' "'$c") & 255))"; o+="$h" ;;
    esac
  done
  printf '%s' "$o"
}

# br_baslat: BR_DIZIN'de gecici nginx, bos port denemeyle (bind hatasi sonraki porta gecer; yaris yok). Ayricaliksiz, dzdo YOK.
br_baslat() {
  local deneme=0 port i kod
  BR_DIZIN="$YEDEK/br_gecici"
  rm -rf -- "$BR_DIZIN"
  ( umask 077; mkdir "$BR_DIZIN" ) || kir "gecici nginx dizini olusturulamadi: $BR_DIZIN"
  br_on_denetim "$BR_DIZIN"
  while [ "$deneme" -lt 5 ]; do
    deneme=$((deneme + 1))
    port=$((20000 + (RANDOM * 32768 + RANDOM) % 40000))
    br_konf_yaz "$BR_DIZIN" "$port"
    timeout -k 5 "$BR_OMUR" "$BIN" -p "$BR_DIZIN/" -c "$BR_DIZIN/nginx.conf" -e "$BR_DIZIN/error.log" < /dev/null > "$BR_DIZIN/out" 2>&1 9>&- &
    BR_PID=$!
    i=0
    while [ "$i" -lt 50 ]; do
      kod="$(curl -q -s --noproxy '*' --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" 2>/dev/null)"
      if [ -n "$kod" ] && [ "$kod" != 000 ]; then
        BR_PORT="$port"
        return 0
      fi
      kill -0 "$BR_PID" 2>/dev/null || break
      sleep 0.2
      i=$((i + 1))
    done
    kill -TERM "$BR_PID" 2>/dev/null
    wait "$BR_PID" 2>/dev/null
    BR_PID=""
    grep -qi 'address already in use' "$BR_DIZIN/error.log" "$BR_DIZIN/out" 2>/dev/null || break
  done
  kir "gecici nginx baslatilamadi (.br uretilemez): $(hata_satiri "$BR_DIZIN/error.log")"
}

br_uret() {   # br_uret <kaynak> <.br>: dusen her yolda kir (trap ornegi kapatir, gecici dosyayi siler)
  local src="$1" out="$2" yol kod h="$BR_DIZIN/basliklar"
  yol="$(url_kodla "${src#"$DIZIN"/}")"
  ISLENEN="$out.hazirlik_tmp"
  # Arka planda + wait: on planda curl bitene dek TERM trap'i calismaz, durdur.sh 10 sn sonra KILL atar ve temizlik atlanirdi.
  curl -q -sS --noproxy '*' --path-as-is --max-time 300 -H 'Accept-Encoding: br' -D "$h" -o "$ISLENEN" -w '%{http_code}' \
    "http://127.0.0.1:$BR_PORT/$yol" > "$BR_DIZIN/kod" 2>"$BR_DIZIN/curl.err" 9>&- &
  CURL_PID=$!
  wait "$CURL_PID" || { CURL_PID=""; kir "curl basarisiz: $src: $(head -n 1 "$BR_DIZIN/curl.err" 2>/dev/null)"; }
  CURL_PID=""
  kod="$(cat "$BR_DIZIN/kod" 2>/dev/null)"
  [ "$kod" = 200 ] || kir "gecici nginx $kod dondu: $src"
  tr -d '\r' < "$h" | awk 'tolower($0) ~ /^content-encoding:[ \t]*br[ \t]*$/ { b = 1 } END { exit b ? 0 : 1 }' \
    || kir "yanitta Content-Encoding: br yok (brotli sikistirmadi): $src"
  [ -s "$ISLENEN" ] || kir "bos yanit: $src"
  chmod --reference="$src" "$ISLENEN" 2>/dev/null
  touch -r "$src" "$ISLENEN" || kir "zaman damgasi verilemedi: $src"
  mv -f -- "$ISLENEN" "$out" || kir ".br tasinamadi: $out"
  ISLENEN=""
}

# kanit_yolu: <SONUC>/R<id>/hazirlik_R<id>_<host>.txt
kanit_yolu() {
  local hostk
  hostk="$(hostname -s 2>/dev/null || uname -n)"
  hostk="$(printf '%s' "${hostk%%.*}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
  printf '%s/R%s/hazirlik_R%s_%s.txt' "$SONUC_KOK" "$KOSU_ID" "$KOSU_ID" "$hostk"
}

dosyalar() {
  local src e hedef="" out liste gz_u=0 br_u=0 gz_s=0 br_s=0 atlanan=0 n=0 ozel=0 kanit gerekli=0 dosya_seviye=""
  girdi
  [ -d "$YEDEK" ] && [ -f "$YEDEK/meta" ] || kir "yedek yok: once uygula calismali"
  kilit_al || kir "baska bir hazirlik islemi suruyor ($KILIT_BEKLE sn beklendi)"
  [ "$(meta kosu)" = "$KOSU_ID" ] || kir "yedek baska kosunun: R$(meta kosu)"
  [ "$(meta dizin)" = "$DIZIN" ] || kir "yedekteki dizin farkli: $(meta dizin)"
  dizin_denetle
  if [ "$STATIK" = 1 ]; then
    if [ "$AE" = br ]; then hedef=br; else hedef=gz; fi
    dosya_seviye="${SEVIYE:-9}"   # identity + gzip_static: seviye secilmez, en kucuk dosya
  fi
  find "$DIZIN" -type f -name '*.hazirlik_tmp' -delete 2>/dev/null
  liste="$YEDEK/kaynaklar"
  find "$DIZIN" -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.txt' \) -print0 > "$liste" || kir "dizin taranamadi: $DIZIN"

  # Kullanici kurali: .gz yalniz gzip static, .br yalniz brotli static kosusunda durur. Yalniz kaynagi yaninda duran dosya;
  # symlink silinmez, izlenmez. geri_al bunlari GERI GETIRMEZ (turetilmis dosya).
  while IFS= read -r -d '' src; do
    n=$((n + 1))
    for e in gz br; do
      [ "$e" = "$hedef" ] && continue
      out="$src.$e"
      if [ -f "$out" ] && [ ! -L "$out" ]; then
        rm -f -- "$out" || kir "silinemedi: $out"
        if [ "$e" = gz ]; then gz_s=$((gz_s + 1)); else br_s=$((br_s + 1)); fi
      fi
    done
  done < "$liste"

  if [ -n "$hedef" ] && [ "$n" = 0 ]; then
    kir "dizinde sikistirilacak dosya yok (0 dosya, .js .css .svg .txt): $DIZIN"
  fi

  if [ -n "$hedef" ]; then
    # Tur her kosuda yeniden uretilir (mtime karsilastirmasi seviyeyi gormez). Yeni dosya manifest'e URETIMDEN ONCE yazilir:
    # yarida kalan uretimi de geri_al siler; onceden duran dosya manifest'e girmez.
    : > "$YEDEK/uret"
    while IFS= read -r -d '' src; do
      out="$src.$hedef"
      if [ -L "$out" ] || { [ -e "$out" ] && [ ! -f "$out" ]; }; then
        ozel=$((ozel + 1)); atlanan=$((atlanan + 1))
      elif [ "$hedef" = br ] && [ ! -s "$src" ]; then
        atlanan=$((atlanan + 1))   # bos dosya sikistirilmaz (nginx yanit govdesi yok); nginx kaynagi sunar
      else
        if [ ! -e "$out" ]; then
          printf '%s\0' "$out" >> "$YEDEK/manifest" || kir "manifest yazilamadi"
        fi
        printf '%s\0' "$src" >> "$YEDEK/uret"; gerekli=$((gerekli + 1))
      fi
    done < "$liste"
    [ "$ozel" -gt 0 ] && uyari "$ozel .$hedef yolu symlink ya da duzenli dosya degil; atlandi"
    if [ "$hedef" = br ] && [ "$gerekli" -gt 0 ]; then
      br_baslat
    fi
    while IFS= read -r -d '' src; do
      if [ "$hedef" = gz ]; then
        gzip "-$dosya_seviye" -n -k -f -- "$src" || kir "gzip basarisiz: $src"
        gz_u=$((gz_u + 1))
      else
        br_uret "$src" "$src.br"
        br_u=$((br_u + 1))
      fi
    done < "$YEDEK/uret"
  fi

  if [ -n "$BR_PID" ]; then
    kill -TERM "$BR_PID" 2>/dev/null
    wait "$BR_PID" 2>/dev/null
    BR_PID=""
  fi
  kanit="$(kanit_yolu)"
  mkdir -p "${kanit%/*}" || kir "sonuc dizini olusturulamadi: ${kanit%/*}"
  {
    printf 'kaynak_dosya\t%d\ngz_uretilen\t%d\nbr_uretilen\t%d\ngz_silinen\t%d\nbr_silinen\t%d\natlanan\t%d\ndosya_seviye\t%s\nsure_dosyalar_sn\t%d\n' \
      "$n" "$gz_u" "$br_u" "$gz_s" "$br_s" "$atlanan" "$dosya_seviye" "$((SECONDS - SURE0))"
    cat "$YEDEK/kanit" 2>/dev/null
  } > "$kanit" || kir "kanit yazilamadi: $kanit"
  printf 'kaynak_dosya\t%d\ngz_uretilen\t%d\nbr_uretilen\t%d\ngz_silinen\t%d\nbr_silinen\t%d\natlanan\t%d\ndosya_seviye\t%s\nsure_dosyalar_sn\t%d\n' \
    "$n" "$gz_u" "$br_u" "$gz_s" "$br_s" "$atlanan" "$dosya_seviye" "$((SECONDS - SURE0))"
  sonuc OK "$n kaynak dosya: $gz_u .gz, $br_u .br uretildi, $gz_s .gz, $br_s .br silindi, $atlanan atlandi"
}

# yol_coz <url yolu>: yuzde kodunu acar (nginx de acar); disk yolu olamayacak bicimde (NUL, denetim karakteri, ..) cikis 1.
yol_coz() {
  local y="$1"
  case "$y" in *%00*) return 1 ;; esac
  COZULEN="$(printf '%b' "${y//%/\\x}")"
  [[ "$COZULEN" != *[[:cntrl:]]* ]] && [[ "$COZULEN" != *..* ]]
}

# disk_ara <cozulmus yol>: URL yolunun son parcalarini kisaltarak DIZIN altinda dosya arar (/a/b/x.js -> a/b/x.js, b/x.js, x.js);
# URL oneki location / root'a gore degisir. Bos dosya ornek olamaz (.br uretilmez). Bulunan BULUNAN'da.
disk_ara() {
  local p="${1#/}"
  while [ -n "$p" ]; do
    if [ -f "$DIZIN/$p" ] && [ ! -L "$DIZIN/$p" ] && [ -s "$DIZIN/$p" ]; then
      BULUNAN="$DIZIN/$p"
      return 0
    fi
    case "$p" in */*) p="${p#*/}" ;; *) p="" ;; esac
  done
  return 1
}

# kanit_yaz <ok|yok> <ornek> <ilk yol>: kanit dosyasina ekler (dosyalar yazdi; FAIL'de de yazilir), ayni satirlari basar.
kanit_yaz() {
  local f
  f="$(kanit_yolu)"
  mkdir -p "${f%/*}" 2>/dev/null
  printf 'disk_kanit\t%s\ndisk_ornek\t%s\ndisk_yol\t%s\n' "$1" "$2" "$(temiz "$3" | cut -c1-300)" >> "$f" || return 1
  printf 'disk_kanit\t%s\ndisk_ornek\t%s\ndisk_yol\t%s\n' "$1" "$2" "$(temiz "$3" | cut -c1-300)"
}

# kanit_kir <ornek> <ilk yol> <metin>
kanit_kir() {
  kanit_yaz yok "$1" "$2"
  kir "$3"
}

# ornek_iste <url yolu> <Accept-Encoding>: arka planda + wait (TERM trap'i curl'u beklemesin); fd 9 kilidi curl'e gecmez.
# G_KOD G_CE G_CL (yoksa bos). Baslik adlari kucuk harfe indirilir: HTTP/2'de kucuk, HTTP/1.1'de buyuk gelir.
ornek_iste() {
  local rc=0 h="$YEDEK/kanit_baslik"
  curl -q -sk --noproxy '*' --max-time 15 -o /dev/null -D - --resolve "$HOST_BASLIGI:443:$HEDEF_IP" -H "Accept-Encoding: $2" \
    "https://$HOST_BASLIGI$1" > "$h" 2> "$YEDEK/kanit_curl.err" 9>&- &
  CURL_PID=$!
  wait "$CURL_PID" || rc=$?
  CURL_PID=""
  [ "$rc" = 0 ] || return "$rc"
  IFS='|' read -r G_KOD G_CE G_CL < <(tr -d '\r' < "$h" | awk '
    { s = tolower($0) }
    s ~ /^http\// { split(s, p, /[ \t]+/); kod = p[2]; ce = ""; cl = ""; next }
    s ~ /^content-encoding:/ { ce = s; sub(/^content-encoding:[ \t]*/, "", ce); sub(/[ \t]+$/, "", ce); next }
    s ~ /^content-length:/ { cl = s; sub(/^content-length:[ \t]*/, "", cl); sub(/[ \t]+$/, "", cl); next }
    END { print kod "|" ce "|" cl }')
  return 0
}

kanit() {
  local ae uzanti senaryo y yan boyut ornekler ilk="" n=0 rc
  local -a sec=()
  girdi
  [ -d "$YEDEK" ] && [ -f "$YEDEK/meta" ] || kir "yedek yok: once uygula calismali"
  kilit_al || kir "baska bir hazirlik islemi suruyor ($KILIT_BEKLE sn beklendi)"
  [ "$(meta kosu)" = "$KOSU_ID" ] || kir "yedek baska kosunun: R$(meta kosu)"
  [ "$(meta dizin)" = "$DIZIN" ] || kir "yedekteki dizin farkli: $(meta dizin)"
  dizin_denetle
  if [ "$STATIK" != 1 ]; then
    kanit_yaz yok 0 "" || kir "kanit yazilamadi"
    sonuc OK "static kapali, disk kaniti gerekmez"
    return 0
  fi
  HEDEF_IP="${HEDEF_IP:-}"; HOST_BASLIGI="${HOST_BASLIGI:-}"
  [[ "$HEDEF_IP" =~ ^[0-9]{1,3}([.][0-9]{1,3}){3}$ ]] || kir "HEDEF_IP gecersiz" 2
  [[ "$HOST_BASLIGI" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || kir "HOST_BASLIGI gecersiz" 2
  command -v curl > /dev/null 2>&1 || kanit_kir 0 "" "curl yok: disk kaniti alinamadi"
  senaryo="$SONUC_KOK/senaryo.tsv"
  [ -f "$senaryo" ] || kanit_kir 0 "" "senaryo yok: $senaryo"
  if [ "$AE" = br ]; then ae=br; uzanti=br; else ae=gzip; uzanti=gz; fi

  ornekler="$YEDEK/kanit_ornekler"
  : > "$ornekler" || kir "gecici dosya yazilamadi: $ornekler"
  while IFS= read -r y; do
    yol_coz "$y" || continue
    disk_ara "$COZULEN" || continue
    printf '%s\t%s\t%s\n' "$(wc -c < "$BULUNAN" | tr -d ' ')" "$y" "$BULUNAN" >> "$ornekler"
  done < <(tr -d '\r' < "$senaryo" | awk -F'\t' '/^[^#]/ { print $NF }' | grep -E '^/[^?]*[.](js|css|svg|txt)$' | sort -u)
  mapfile -t sec < <(sort -t "$(printf '\t')" -k1,1nr -k2,2 "$ornekler" | head -n 3)
  [ "${#sec[@]}" -gt 0 ] || kanit_kir 0 "" "HAR yollari bu dizinden sunulmuyor, dizini kontrol edin ($DIZIN)"

  ilk="$(printf '%s' "${sec[0]}" | cut -f2)"
  for y in "${sec[@]}"; do
    yan="$(printf '%s' "$y" | cut -f3).$uzanti"
    y="$(printf '%s' "$y" | cut -f2)"
    [ -f "$yan" ] || kanit_kir "$n" "$ilk" "diskte .$uzanti yok: $yan"
    boyut="$(wc -c < "$yan" | tr -d ' ')"
    rc=0
    ornek_iste "$y" "$ae" || rc=$?
    [ "$rc" = 0 ] || kanit_kir "$n" "$ilk" "curl basarisiz (rc $rc): $(head -n 1 "$YEDEK/kanit_curl.err" 2>/dev/null): $y"
    if [ "$G_KOD" != 200 ] || [ "$G_CE" != "$ae" ] || [ "$G_CL" != "$boyut" ]; then
      kanit_kir "$n" "$ilk" "diskten sunulmuyor: beklenen 200 $ae Content-Length $boyut, gelen ${G_KOD:-yok} ${G_CE:-sikistirmasiz} Content-Length ${G_CL:-yok}: $y"
    fi
    n=$((n + 1))
  done
  kanit_yaz ok "$n" "$ilk" || kir "kanit yazilamadi"
  sonuc OK "$n ornek diskten sunuldu ($ae)"
}

geri_al() {
  local rc=0
  girdi_ust
  girdi_kosu
  DEVRAL="${DEVRAL:-0}"
  [[ "$DEVRAL" == 0 || "$DEVRAL" == 1 ]] || kir "DEVRAL 0 ya da 1 olmali" 2
  DEVRAL_IS="$DEVRAL"
  # Once kilitsiz bak: baska kosunun yedegi icin kilit beklenmez. Asil karar kilit altinda yeniden verilir (uygula devralmis olabilir).
  if [ -d "$YEDEK" ] && { [ "$DEVRAL_IS" = 1 ] || [ "$(meta kosu)" = "$KOSU_ID" ]; }; then
    if ! kilit_al; then
      printf 'geri_al_durum\thata\n'
      kir "baska bir hazirlik islemi suruyor ($KILIT_BEKLE sn beklendi), yedek korundu"
    fi
  fi
  geri_al_is || rc=$?
  printf 'geri_al_durum\t%s\n' "$GERI_DURUM"
  if [ "$rc" -ne 0 ]; then
    sonuc FAIL "$GERI_METIN"
    exit 1
  fi
  sonuc OK "$GERI_METIN"
}

case "$MOD" in
  uygula) uygula ;;
  dosyalar) dosyalar ;;
  kanit) kanit ;;
  geri_al) geri_al ;;
  *) kir "kullanim: hazirlik.sh uygula|dosyalar|kanit|geri_al" 2 ;;
esac
