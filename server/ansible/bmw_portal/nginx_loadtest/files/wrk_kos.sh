#!/bin/bash
# wrk_kos.sh - Portal Nginx Hub "Yuk Testi": bir ADIM icin wrk kosularini sirayla calistirir (wrk + yuk_wrk.lua).
# Amac    : her (baglanti, tekrar) icin ayni sabit yukle bir kosu; zaman.csv'ye bas/bit; yarida kalirsa kaldigi yerden.
# Kullanim: HEDEF=https://<IPv4> HOST_BASLIGI=<vhost> TAVAN_RPS=<n> ./wrk_kos.sh <ADIM> <K|B> [--kuru]
# Ortam   : HOST_BASLIGI ve TAVAN_RPS (zorunlu) BAGLANTILAR("2 4 8"; B icin "2") IS_PARCACIGI(2) TEKRAR(2) KIP(yeni|ka)
#           AE(br|gzip|identity) ISINMA(30s) SURE(120s) BOSLUK(30 sn) WRK(wrk) UA_ONEK(portal-yuktesti)
#           SENARYO_DIZIN(./senaryo) SONUC(./sonuc) SNI(yalniz 0) LIMIT_MUAF(yalniz 0); HIZLAR, MAXVU, K6 yok sayilir.
# Cikis   : 0 tamam, 2 girdi / on kosul hatasi (HATA: stderr; yuk YOK), 4 DUR (DUR: stdout), 130 boslukta kesildi.
# Portal  : Portal'a ozgu (el kitinde yok); dis sozlesme kos.sh ile AYNI (cikis kodlari, DUR/HATA satirlari, sonuc/<ADIM>/
#           dosya adlari ve semasi, pid $SONUC/../kos.pid, INT/TERM trap'i calisan wrk'yi da durdurur).
# Model   : KAPALI DONGU. Adim = baglanti sayisi (N); yuk_wrk.lua her istekten once baglanti basina EN AZ D =
#           ceil(N*1000/TAVAN_RPS) ms bekler: toplam hiz ORTALAMADA <= TAVAN_RPS. Baglantilar birlikte baslar; Lua is
#           parcacigi basina ilk N/T beklemeyi rastgele [D, 2D) araligina yayar (T = IS_PARCACIGI, wrk ortamina da verilir)
#           ama istekler kumelenebilir: burst'u N'den kucuk ya da burst'suz limit_req'te 429 -> DUR (README "Tuzaklar":
#           k6 ya da az baglanti). Gecikme yuzdelikleri wrk'nin
#           koordineli ihmal (CO) duzeltmeli dagilimidir; TLS surumu sabitlenemez ve oturum devami olabilir (k6 1.2'ye
#           sabit): wrk ve k6 sonuclari karsilastirilmaz.
# Sira    : girdi denetimi -> plan (--kuru burada biter) -> HEDEF/HOST_BASLIGI -> hedef IP yuk makinesinde yerel mi (yerel ya
#           da olculemediyse wrk HIC cagrilmaz) -> curl -> wrk -v (surum >= 4) -> yuk_wrk.lua yukleme sinamasi (istek
#           GONDERMEZ: env -i, kapali loopback portu) -> her TUR: 200 kapisi (curl, sirali, en cok 180 sn) -> isinma -> olcum.
# DUR     : sayac tutarsizligi, 429, 5xx, soket hatasi > SOKET_HATA_ESIGI, hata orani > HATA_ORANI_ESIGI (faz basina), wrk rc,
#           bos ozet. Lua ilk 429 ya da >= 500 yanitta is parcacigini durdurur (wrk.thread:stop).
# Dosyalar: sonuc/<ADIM>/istemci_<TUR>.csv|json (yuk_k6.js ile AYNI kolonlar ve JSON anahtar sirasi; olculmeyen alan bos /
#           null, asla 0), zaman.csv, baslatilan.csv. Ara dosyalar $SONUC/../wrk_ara/ (sonuc/<ADIM>/ DISINDA; Portal
#           toplamaz): ozet_<faz>_<TUR>.tsv (Lua done() -> 21 satir anahtar<TAB>tamsayi), wrk_<faz>_<TUR>.out.
set -u
export LC_ALL=C
BURASI="$(cd "$(dirname "$0")" && pwd)"
kullanim() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
hata() { echo "HATA: $*" >&2; exit 2; }

KOLONLAR="tur,adim,senaryo,kip,ae,hiz,n_olcum,rps_gercek,p50,p95,p99,ttfb_p95,tls_p95,connect_p95,hata_orani,n_429,n_5xx,dropped,http2,bayt_istek,p95_js,p95_css,p95_html,p95_json,p95_config,p95_buyuk,sikistirma_turu,isinma_sn,sure_sn,deneme"
JSON_ANAHTARLARI="tur adim senaryo kip ae hiz n_olcum rps_gercek p50 p95 p99 ttfb_p95 tls_p95 connect_p95 hata_orani n_429 n_5xx dropped http2 bayt_istek p95_buyuk sikistirma_turu isinma_sn sure_sn deneme p95_js p95_css p95_html p95_json p95_config"
OZET_ANAHTARLARI="surum istek bayt sure_us e_connect e_read e_write e_timeout e_status s1xx s2xx s3xx s429 s4xx s5xx sdiger lat_max_us p50_us p95_us p99_us is_parcacigi"
WRK_ZAMAN_ASIMI=10s
SOKET_HATA_ESIGI=10
HATA_ORANI_ESIGI=0.01

KURU=0; ARGS=()
for a in "$@"; do
  case "$a" in
    --kuru) KURU=1 ;;
    -h|--help) kullanim ;;
    *) ARGS+=("$a") ;;
  esac
done
[ "${#ARGS[@]}" -eq 2 ] || kullanim
ADIM="${ARGS[0]}"; SEN="${ARGS[1]}"
[[ "$ADIM" =~ ^[A-Za-z0-9-]+$ ]] || hata "ADIM yalniz harf, rakam ve - icerebilir (alt cizgi YOK): '$ADIM'"
[[ "$SEN" == K || "$SEN" == B ]] || hata "senaryo K ya da B olmali: '$SEN'"

# on_kontrol.sh ile AYNI desenler (IP_RE, HOST_RE); kos.sh / yuk_k6.js / har_senaryo.py ile AYNI beyaz liste (DESEN)
IP_RE='^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])[.]){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$'
HOST_RE='^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
DESEN=$'^[0-9.]+\t[0-9]+\t[a-z]+\t[a-z]+\t/[A-Za-z0-9._~!$&\'()*+,;=:@%/-]*$'
WRK_SURUM_RE='^wrk ([0-9]+)[.]([0-9]+)'

HEDEF="${HEDEF:-}"; HEDEF="${HEDEF%/}"
HOST_BASLIGI="${HOST_BASLIGI:-}"
UA_ONEK="${UA_ONEK:-portal-yuktesti}"
[[ "$UA_ONEK" =~ ^[a-z][a-z0-9-]{2,30}$ ]] || hata "UA_ONEK yalniz kucuk harf, rakam ve - (3-31 karakter): '$UA_ONEK'"
[ "${LIMIT_MUAF:-0}" = 0 ] || hata "LIMIT_MUAF Portal kosusunda desteklenmez"
SNI="${SNI:-0}"
[ "$SNI" != 1 ] || hata "wrk SNI'yi Host basligina gore secemez (IP adresi SNI olarak gider); SNI=0 kullanin"
[ "$SNI" = 0 ] || hata "SNI yalniz bos ya da 0 olabilir: '$SNI'"
SENARYO_DIZIN="${SENARYO_DIZIN:-./senaryo}"
SONUC="${SONUC:-./sonuc}"
if [ "$SEN" = B ]; then BAGLANTILAR="${BAGLANTILAR:-2}"; else BAGLANTILAR="${BAGLANTILAR:-2 4 8}"; fi
IS_PARCACIGI="${IS_PARCACIGI:-2}"; TAVAN_RPS="${TAVAN_RPS:-}"
TEKRAR="${TEKRAR:-2}"; KIP="${KIP:-yeni}"; AE="${AE:-br}"
ISINMA="${ISINMA:-30s}"; SURE="${SURE:-120s}"; BOSLUK="${BOSLUK:-30}"; WRK="${WRK:-wrk}"

[ -n "${BAGLANTILAR//[[:space:]]/}" ] || hata "BAGLANTILAR bos olamaz (ornek: BAGLANTILAR=\"2 4 8\")"
NB=0; EN_KUCUK=""; GORULEN=" "
for b in $BAGLANTILAR; do
  [[ "$b" =~ ^[1-9][0-9]*$ ]] || hata "BAGLANTILAR icinde gecersiz deger: '$b'"
  { [ "${#b}" -le 3 ] && [ "$b" -le 199 ]; } || hata "BAGLANTI $b > 199: IP basina limit_conn 200 (ornek: BAGLANTILAR=\"2 4 8\")"
  case "$GORULEN" in *" $b "*) hata "BAGLANTILAR icinde $b iki kez" ;; esac
  GORULEN="$GORULEN$b "; NB=$((NB + 1))
  if [ -z "$EN_KUCUK" ] || [ "$b" -lt "$EN_KUCUK" ]; then EN_KUCUK="$b"; fi
done
[ "$NB" -le 5 ] || hata "BAGLANTILAR en cok 5 deger olabilir ($NB verildi)"
{ [[ "$IS_PARCACIGI" =~ ^[1-9][0-9]*$ ]] && [ "${#IS_PARCACIGI}" -le 2 ] && [ "$IS_PARCACIGI" -le 16 ]; } \
  || hata "IS_PARCACIGI 1..16 olmali: '$IS_PARCACIGI'"
[ "$IS_PARCACIGI" -le "$EN_KUCUK" ] || hata "IS_PARCACIGI ($IS_PARCACIGI) en kucuk baglanti sayisindan ($EN_KUCUK) buyuk olamaz"
for b in $BAGLANTILAR; do
  [ $(( b % IS_PARCACIGI )) -eq 0 ] || hata "BAGLANTI $b, IS_PARCACIGI ($IS_PARCACIGI) sayisina tam bolunmuyor (wrk baglantilari c/t tam bolmeyle dagitir)"
done
[ -n "$TAVAN_RPS" ] || hata "TAVAN_RPS verilmedi (toplam istek/sn tavani; varsayilan YOK, Portal hesaplar)"
{ [[ "$TAVAN_RPS" =~ ^[1-9][0-9]*$ ]] && [ "${#TAVAN_RPS}" -le 3 ] && [ "$TAVAN_RPS" -le 450 ]; } \
  || hata "TAVAN_RPS 1..450 olmali: '$TAVAN_RPS' (IP basina limit_req 500 r/s)"
[[ "$TEKRAR" =~ ^[1-9][0-9]*$ ]] || hata "TEKRAR pozitif tam sayi olmali"
[[ "$KIP" == yeni || "$KIP" == ka ]] || hata "KIP yeni ya da ka olmali"
[[ "$AE" == br || "$AE" == gzip || "$AE" == identity ]] || hata "AE br, gzip ya da identity olmali"
saniye() {   # 30s | 2m | 30  ->  saniye (kos.sh ile AYNI)
  case "$1" in
    *[!0-9sm]*|"") return 1 ;;
    *m) [[ "${1%m}" =~ ^[0-9]+$ ]] && echo $(( ${1%m} * 60 )) ;;
    *s) [[ "${1%s}" =~ ^[0-9]+$ ]] && echo $(( ${1%s} )) ;;
    *) [[ "$1" =~ ^[0-9]+$ ]] && echo "$1" ;;
  esac
}
ISINMA_SN="$(saniye "$ISINMA")" || hata "ISINMA bicimi: $ISINMA (ornek 30s)"
SURE_SN="$(saniye "$SURE")" || hata "SURE bicimi: $SURE (ornek 120s)"
[ "$SURE_SN" -ge 30 ] || hata "SURE en az 30s olmali"
[[ "$BOSLUK" =~ ^[0-9]+$ ]] || hata "BOSLUK saniye (tam sayi) olmali"
SENARYO="$SENARYO_DIZIN/$SEN.tsv"
[ -s "$SENARYO" ] || hata "senaryo dosyasi yok: $SENARYO"
BOZUK=$(tr -d '\r' < "$SENARYO" | grep -v '^#' | grep -v '^$' | grep -cvE "$DESEN")
[ "$BOZUK" -eq 0 ] || hata "$SENARYO icinde $BOZUK satir beklenen bicimde degil (5 kolon, yol beyaz listede, sorgu yok)"
SATIR=$(tr -d '\r' < "$SENARYO" | grep -cvE '^(#|$)')

KOSULAR=()
for b in $BAGLANTILAR; do
  for ((r = 1; r <= TEKRAR; r++)); do KOSULAR+=("${ADIM}_${SEN}_${KIP}_${AE}_${b}_r${r}:$b"); done
done
DIZIN="$SONUC/$ADIM"
TOPLAM=$(( ${#KOSULAR[@]} * (ISINMA_SN + SURE_SN + BOSLUK + 5) ))
echo "== wrk_kos.sh  adim=$ADIM senaryo=$SEN ($SATIR satir) kip=$KIP ae=$AE baglantilar=[$BAGLANTILAR] is_parcacigi=$IS_PARCACIGI tavan=$TAVAN_RPS/sn tekrar=$TEKRAR"
echo "   her kosu: ${ISINMA_SN}s isinma + ${SURE_SN}s olcum + ${BOSLUK}s bosluk;  toplam ~$(( TOPLAM / 60 )) dk $(( TOPLAM % 60 )) sn"
echo "   hedef=${HEDEF:-<HEDEF verilmedi>} host=$HOST_BASLIGI sonuc=$DIZIN"
for k in ${KOSULAR[@]+"${KOSULAR[@]}"}; do
  t="${k%%:*}"
  if [ -s "$DIZIN/istemci_$t.csv" ]; then echo "   - $t  (VAR, atlanacak)"; else echo "   - $t"; fi
done
[ "$KURU" = 1 ] && { echo "(--kuru: hicbir sey kosulmadi)"; exit 0; }

# --- guvenlik kapisi ikiliden ONCE: hedef IP bu (yuk) makinede yerelse yuk hedefe degil kendi nginx'ine gider ----------
HEDEF_IP="${HEDEF#https://}"
{ [ "$HEDEF_IP" != "$HEDEF" ] && [[ "$HEDEF_IP" =~ $IP_RE ]]; } || hata "HEDEF=https://<IPv4> verin (yol ve port YOK): '$HEDEF'"
[[ "$HOST_BASLIGI" =~ $HOST_RE ]] || hata "HOST_BASLIGI=<vhost> verin (kucuk harf ad; varsayilan host yok): '$HOST_BASLIGI'"
ip_yerel_mi() {   # ip_yerel_mi <ip>: 1 (bu sunucuda tanimli), 0 (degil), - (olculemedi); on_kontrol.sh ile AYNI
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
[ "$(ip_yerel_mi "$HEDEF_IP")" = 0 ] || hata "hedef IP yuk makinesinde yerel ya da olculemedi; yuk gonderilmedi"
command -v curl >/dev/null 2>&1 || hata "curl bulunamadi"
command -v "$WRK" >/dev/null 2>&1 || hata "wrk bulunamadi ya da calistirilamiyor: $WRK"
# wrk -v surum satiri + kullanim basar ve 1 ile cikar: rc'ye bakilmaz (istek gondermez)
WRK_SATIR="$("$WRK" -v 2>&1 | head -5 | grep -m 1 '^wrk ')"
[ -n "$WRK_SATIR" ] || hata "wrk calistirilamiyor (-v ciktisi yok): $WRK"
if ! [[ "$WRK_SATIR" =~ $WRK_SURUM_RE ]] || [ "${#BASH_REMATCH[1]}" -gt 3 ] || [ "${BASH_REMATCH[1]}" -lt 4 ]; then
  hata "wrk surumu okunamadi ya da 4 altinda ('${WRK_SATIR:0:80}'); make VER=4.2.0 ile derleyin"
fi

# --- hazirlik --------------------------------------------------------------------------------------------------------
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy
ARA="$SONUC/../wrk_ara"
mkdir -p "$DIZIN" "$ARA" || hata "dizin olusturulamadi: $DIZIN / $ARA"
echo "$$" > "$SONUC/../kos.pid" || hata "pid dosyasi yazilamadi: $SONUC/../kos.pid"
[ -s "$DIZIN/zaman.csv" ] || echo "tur,bas_epoch,bit_epoch,rc,deneme" > "$DIZIN/zaman.csv"
[ -s "$DIZIN/baslatilan.csv" ] || echo "tur,bas_epoch,deneme" > "$DIZIN/baslatilan.csv"
ARA="$(cd "$ARA" && pwd)"
SENARYO_M="$(cd "$(dirname "$SENARYO")" && pwd)/$(basename "$SENARYO")"
BETIK_M="$BURASI/yuk_wrk.lua"

KESILDI=0; SINYAL=""; COCUK=""
kesildi() {   # INT (Ctrl-C) ya da TERM (Portal durdur / timeout): calisan wrk ya da bosluk beklemesi de biter (kos.sh ile AYNI)
  KESILDI=1; SINYAL="$1"
  [ -n "$COCUK" ] && kill -TERM "$COCUK" 2>/dev/null
  return 0
}
trap 'kesildi INT' INT
trap 'kesildi TERM' TERM
bekle_cocuk() {   # bekle_cocuk <pid>: trap wait'i keserse cocuk bitene dek yeniden bekler; donus cocugun rc'si
  local r=0
  wait "$1" || r=$?
  while kill -0 "$1" 2>/dev/null; do r=0; wait "$1" || r=$?; done
  return "$r"
}

# Yukleme sinamasi: wrk betik hatasini YALNIZ stderr'e yazar ve VARSAYILAN istekle yuke devam eder. Betik ancak sonuna
# kadar yuklenip calistiysa son blok isaret dosyasini yazar (olumlu kanit; stderr kalibi aranmaz). Hic istek gitmez:
# ortam bos (env -i: init() HOST_BASLIGI'siz duser), hedef kapali loopback portu.
rm -f "$ARA/lua_yuklendi"
timeout -k 5 30 env -i PATH="$PATH" LC_ALL=C LUA_YUKLEME_ISARETI="$ARA/lua_yuklendi" FAZ=sinama \
  "$WRK" -t 1 -c 1 -d 1s -s "$BETIK_M" https://127.0.0.1:1/ > "$ARA/lua_sinama.out" 2>&1
if [ ! -f "$ARA/lua_yuklendi" ]; then
  hata "yuk_wrk.lua wrk ile yuklenemedi (istek gonderilmedi): $(head -c 300 "$ARA/lua_sinama.out" 2>/dev/null | tr '\t\r\n' '   ')"
fi

case "$AE" in br) AE_DEGER='gzip, deflate, br, zstd' ;; gzip) AE_DEGER='gzip' ;; *) AE_DEGER='identity' ;; esac
HTTP11=0
curl --version 2>/dev/null | grep -qiE '^features:.*http2' && HTTP11=1
# 200 kapisinin yollari (yuk_k6.js setup() ile ayni): kontrol yolu = ilk buyuk js/css (yoksa ilk satir), sonra TEKIL yollar
tr -d '\r' < "$SENARYO" | grep -v '^#' | grep -v '^$' > "$ARA/senaryo_satirlari"
KONTROL_YOL="$(awk -F'\t' '($3 == "js" || $3 == "css") && $4 != "kucuk" { print $5; exit }' "$ARA/senaryo_satirlari")"
[ -n "$KONTROL_YOL" ] || KONTROL_YOL="$(head -1 "$ARA/senaryo_satirlari" | cut -f5)"
{ printf '%s\n' "$KONTROL_YOL"; cut -f5 "$ARA/senaryo_satirlari"; } | awk '!g[$0]++' > "$ARA/kapi_yollari"

kolon() {   # kolon <csv> <ad> -> deger (kos.sh ile AYNI)
  awk -F, -v ad="$2" 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == ad) c = i; next } NR == 2 && c { print $c }' "$1" | tr -d '\r'
}

kapi() {   # 200 kapisi: her yola SIRAYLA tek istek (cerezsiz, vekilsiz); KAPI_NEDENI ve SIK (kontrol yolunun sikistirmasi)
  local yol out kod ce cl ilk=1 h=0 m=0 liste="" bas="$SECONDS"
  local a=(-q -sS -o /dev/null -D - -k --noproxy '*' --max-time 5 --connect-timeout 5 -H "Host: $HOST_BASLIGI"
           -H "Accept-Encoding: $AE_DEGER" -A "$UA_ONEK/$TUR/setup/$DENEME" -w '\n@@KOD %{http_code}\n')
  [ "$HTTP11" = 1 ] && a+=(--http1.1)
  while IFS= read -r yol; do
    [ "$KESILDI" = 1 ] && return 0
    if [ $(( SECONDS - bas )) -gt 180 ]; then
      KAPI_NEDENI="on kontrol 180 sn'de bitmedi ($m yol denendi); hedef yavas ya da erisilemiyor."
      return 0
    fi
    out="$(curl ${a[@]+"${a[@]}"} "$HEDEF$yol" 2>/dev/null)"
    m=$((m + 1))
    IFS=$'\t' read -r kod ce cl <<< "$(printf '%s\n' "$out" | tr -d '\r' | awk '
      /^HTTP\/[0-9.]+ [0-9][0-9][0-9]/ { ce = "-"; cl = 0; next }
      tolower($0) ~ /^content-encoding:/ { v = $0; sub(/^[^:]*:[ ]*/, "", v); sub(/[ ]+$/, "", v); if (v != "") ce = tolower(v); next }
      tolower($0) ~ /^content-length:/ { cl = 1; next }
      /^@@KOD [0-9]+$/ { kod = substr($0, 7) }
      END { printf "%s\t%s\t%d\n", (kod == "" ? "000" : kod), (ce == "" ? "-" : ce), cl }')"
    if [ "$kod" != 200 ]; then
      h=$((h + 1))
      [ "$h" -le 5 ] && liste="$liste${liste:+, }$yol -> HTTP $kod"
    fi
    if [ "$ilk" = 1 ]; then
      ilk=0
      if [ "$kod" = 200 ]; then
        if [ "$ce" = "-" ]; then SIK=YOK; elif [ "$cl" = 1 ]; then SIK=STATIK; else SIK=DINAMIK; fi
      fi
    fi
    [ "$KESILDI" = 1 ] && return 0
  done < "$ARA/kapi_yollari"
  [ "$h" -eq 0 ] || KAPI_NEDENI="on kontrol: $h/$m yol 200 donmedi (ilk 5: $liste). HAR alindiktan sonra deploy olmus olabilir: senaryoyu yenileyin."
  return 0
}

wrk_cagir() {   # wrk_cagir <faz> <sn>: wrk arka planda (trap ertelenmez); ozet $ARA/ozet_<faz>_<TUR>.tsv; RC = ilk sifir olmayan
  local faz="$1" sn="$2" r=0
  rm -f "$ARA/ozet_${faz}_$TUR.tsv" "$ARA/ozet_${faz}_$TUR.tsv.tmp"
  env -u LUA_YUKLEME_ISARETI FAZ="$faz" TUR="$TUR" ADIM="$ADIM" SEN="$SEN" DENEME="$DENEME" KIP="$KIP" AE="$AE" BAGLANTI="$N" \
    IS_PARCACIGI="$IS_PARCACIGI" TAVAN_RPS="$TAVAN_RPS" HOST_BASLIGI="$HOST_BASLIGI" UA_ONEK="$UA_ONEK" SENARYO="$SENARYO_M" \
    WRK_OZET="$ARA/ozet_${faz}_$TUR.tsv" \
    "$WRK" -t "$IS_PARCACIGI" -c "$N" -d "${sn}s" --timeout "$WRK_ZAMAN_ASIMI" --latency -s "$BETIK_M" "$HEDEF/" \
    > "$ARA/wrk_${faz}_$TUR.out" 2>&1 &
  COCUK=$!
  [ "$KESILDI" = 1 ] && kill -TERM "$COCUK" 2>/dev/null
  bekle_cocuk "$COCUK" || r=$?
  COCUK=""
  cat "$ARA/wrk_${faz}_$TUR.out" 2>/dev/null
  [ "$RC" != 0 ] || RC="$r"
  return 0
}

ozet_oku() {   # ozet_oku <dosya>: tam 21 satir, OZET_ANAHTARLARI sirasiyla, deger tam sayi, surum 1 -> degerler tek satirda; aksi rc 1 + ayrinti
  awk -F'\t' -v anahtarlar="$OZET_ANAHTARLARI" '
    BEGIN { n = split(anahtarlar, A, " ") }
    e == "" { s++
      if (NF != 2) e = "satir " s ": anahtar<TAB>deger degil"
      else if (s > n) e = "fazla satir (" s ")"
      else if ($1 != A[s]) e = "satir " s ": " A[s] " bekleniyordu, " $1 " geldi"
      else if ($2 !~ /^[0-9]+$/) e = A[s] ": tam sayi degil"
      else V[s] = $2 }
    END {
      if (e == "" && s != n) e = (s + 0) " satir (" n " bekleniyordu)"
      if (e == "" && V[1] + 0 != 1) e = "surum " V[1] " (1 bekleniyordu)"
      if (e != "") { print e; exit 1 }
      out = sprintf("%.0f", V[1]); for (i = 2; i <= n; i++) out = out " " sprintf("%.0f", V[i]); print out
    }' "$1"
}

faz_karari() {   # faz_karari <degerler>: ilk tutan (TUTARSIZ a b c d t | S429 n | S5XX n | SOKET c r w t | ORAN yuzde | TAMAM)
  awk -v d="$1" -v anahtarlar="$OZET_ANAHTARLARI" -v t="$IS_PARCACIGI" -v se="$SOKET_HATA_ESIGI" -v he="$HATA_ORANI_ESIGI" '
    BEGIN {
      n = split(anahtarlar, A, " "); split(d, V, " ")
      for (i = 1; i <= n; i++) o[A[i]] = V[i] + 0
      top = o["s1xx"] + o["s2xx"] + o["s3xx"] + o["s429"] + o["s4xx"] + o["s5xx"] + o["sdiger"]
      d4 = o["s429"] + o["s4xx"] + o["s5xx"] + o["sdiger"]
      if (o["istek"] != top || o["e_status"] != d4 || o["is_parcacigi"] != t + 0) {
        printf "TUTARSIZ %.0f %.0f %.0f %.0f %.0f\n", o["istek"], top, o["e_status"], d4, o["is_parcacigi"]; exit
      }
      if (o["s429"] > 0) { printf "S429 %.0f\n", o["s429"]; exit }
      if (o["s5xx"] > 0) { printf "S5XX %.0f\n", o["s5xx"]; exit }
      sk = o["e_connect"] + o["e_read"] + o["e_write"] + o["e_timeout"]
      if (sk > se + 0) { printf "SOKET %.0f %.0f %.0f %.0f\n", o["e_connect"], o["e_read"], o["e_write"], o["e_timeout"]; exit }
      pay = o["istek"] + o["e_connect"] + o["e_read"] + o["e_write"]
      if (pay > 0) {
        r = (o["s1xx"] + o["s4xx"] + o["s429"] + o["s5xx"] + o["sdiger"] + sk) / pay
        if (r > 1) r = 1
        if (r > he + 0) { printf "ORAN %.2f\n", 100 * r; exit }
      }
      print "TAMAM"
    }'
}

faz_metni() {   # faz_metni <karar> <faz>: DUR nedeni (TAMAM -> bos). Olcumde tutarsizlik ve 429 metni faz eki almaz.
  local kk a1 a2 a3 a4 a5 ek
  read -r kk a1 a2 a3 a4 a5 <<< "$1"
  ek=""; [ "$2" = isinma ] && ek=", isinma"
  case "$kk" in
    TUTARSIZ) echo "wrk durum sayaclari tutarsiz (istek=$a1, durum toplami=$a2, e_status=$a3, 4xx+5xx+diger=$a4, is_parcacigi=$a5$ek): sonuc kullanilamaz." ;;
    S429) echo "429 alindi ($a1$ek): IP basina rate limit asildi. BAGLANTILAR'i dusurun; ayni IP'den baska yuk var mi bakin." ;;
    S5XX) echo "sunucu hatasi alindi (5xx: $a1, $2): hedef ya da LB hata donuyor; kosu durduruldu. Hedefin durumunu kontrol edin." ;;
    SOKET) echo "soket hatasi esigi asildi (connect $a1 read $a2 write $a3 timeout $a4 > $SOKET_HATA_ESIGI, $2): hedef ya da LB baglantilari reddediyor ya da kesiyor (wrk SNI olarak IP gonderir; katı TLS profili reddedebilir)." ;;
    ORAN) echo "hata orani %$a1 (> %1, $2): 2xx/3xx disi yanit ya da soket hatasi cok; kosu durduruldu." ;;
  esac
}

yaz_istemci() {   # yaz_istemci <I degerleri|""> <O degerleri|"">: istemci_<TUR>.json ve .csv (.tmp + mv) + 4 satir ozet
  awk -v I="$1" -v O="$2" -v anahtarlar="$OZET_ANAHTARLARI" -v kolonlar="$KOLONLAR" -v jsonlar="$JSON_ANAHTARLARI" \
      -v tur="$TUR" -v adim="$ADIM" -v sen="$SEN" -v kip="$KIP" -v ae="$AE" -v hiz="$N" -v t="$IS_PARCACIGI" -v tavan="$TAVAN_RPS" \
      -v isinma="$ISINMA_SN" -v sure="$SURE_SN" -v deneme="$DENEME" -v sik="$SIK" -v csv="$CSV.tmp" -v json="$JSON.tmp" -v csvad="$CSV" '
    function hucre(k,   v) {   # yuk_k6.js hucre(): sayi Math.round(v*1000)/1000, null bos, metinde virgul/CR/LF bosluk
      if (k in NUM) return sprintf("%.15g", int(NUM[k] * 1000 + 0.5) / 1000)
      if (k in STR) { v = STR[k]; gsub(/[,\r\n]/, " ", v); return v }
      return ""
    }
    function jdeger(k,   v) {   # JSON.stringify: sayi (yuvarlanmamis), null, cift tirnakli metin
      if (k in NUM) return sprintf("%.15g", NUM[k])
      if (k in STR) { v = STR[k]; gsub(/["\\]/, " ", v); return "\"" v "\"" }
      return "null"
    }
    function goster(k) { return (k in NUM) ? hucre(k) : "-" }
    BEGIN {
      n = split(anahtarlar, A, " "); ni = split(I, IV, " "); no = split(O, OV, " ")
      for (i = 1; i <= n; i++) { iv[A[i]] = (ni == n) ? IV[i] + 0 : 0; ov[A[i]] = (no == n) ? OV[i] + 0 : 0 }
      ovar = (no == n)
      STR["tur"] = tur; STR["adim"] = adim; STR["senaryo"] = sen; STR["kip"] = kip; STR["ae"] = ae; STR["sikistirma_turu"] = sik
      NUM["hiz"] = hiz + 0
      NUM["n_olcum"] = ovar ? ov["istek"] : 0
      NUM["rps_gercek"] = NUM["n_olcum"] / sure
      if (ovar && ov["istek"] > 0 && ov["lat_max_us"] > 0) {
        NUM["p50"] = ov["p50_us"] / 1000; NUM["p95"] = ov["p95_us"] / 1000; NUM["p99"] = ov["p99_us"] / 1000
      }
      sk = ov["e_connect"] + ov["e_read"] + ov["e_write"] + ov["e_timeout"]
      pay = ov["istek"] + ov["e_connect"] + ov["e_read"] + ov["e_write"]
      if (ovar && pay > 0) {
        r = (ov["s1xx"] + ov["s4xx"] + ov["s429"] + ov["s5xx"] + ov["sdiger"] + sk) / pay
        NUM["hata_orani"] = (r > 1) ? 1 : r
      }
      NUM["n_429"] = iv["s429"] + ov["s429"]
      NUM["n_5xx"] = ov["s5xx"]
      NUM["http2"] = 0
      if (ovar && ov["istek"] > 0) NUM["bayt_istek"] = ov["bayt"] / ov["istek"]
      NUM["isinma_sn"] = isinma + 0; NUM["sure_sn"] = sure + 0; NUM["deneme"] = deneme + 0
      nj = split(jsonlar, J, " ")
      printf "{\n" > json
      for (i = 1; i <= nj; i++) printf "  \"%s\": %s%s\n", J[i], jdeger(J[i]), (i < nj ? "," : "") > json
      printf "}\n" > json
      close(json)
      nc = split(kolonlar, C, ","); satir = ""
      for (i = 1; i <= nc; i++) satir = satir (i > 1 ? "," : "") hucre(C[i])
      printf "%s\n%s\n", kolonlar, satir > csv
      close(csv)
      printf "\n== %s  (%s baglanti, %s is parcacigi, tavan %s/sn, kip=%s, ae=%s, sikistirma=%s)\n", tur, hiz, t, tavan, kip, ae, (sik == "" ? "?" : sik)
      printf "   olcum istek=%s  gercek=%s/sn  p50=%s  p95=%s  p99=%s ms (CO duzeltmeli)\n", hucre("n_olcum"), hucre("rps_gercek"), goster("p50"), goster("p95"), goster("p99")
      printf "   hata=%s  429=%s  5xx=%s  soket connect/read/write/timeout=%.0f/%.0f/%.0f/%.0f  bayt/istek=%s\n", goster("hata_orani"), hucre("n_429"), hucre("n_5xx"), \
        (ovar ? ov["e_connect"] : iv["e_connect"]), (ovar ? ov["e_read"] : iv["e_read"]), (ovar ? ov["e_write"] : iv["e_write"]), (ovar ? ov["e_timeout"] : iv["e_timeout"]), goster("bayt_istek")
      printf "   yazildi: %s\n\n", csvad
    }' || return 1
  mv -f "$JSON.tmp" "$JSON" && mv -f "$CSV.tmp" "$CSV"
}

n=0
for k in ${KOSULAR[@]+"${KOSULAR[@]}"}; do
  TUR="${k%%:*}"; N="${k##*:}"; n=$((n + 1))
  CSV="$DIZIN/istemci_$TUR.csv"; JSON="$DIZIN/istemci_$TUR.json"
  [ -s "$CSV" ] && continue
  # Deneme no (kos.sh ile AYNI): bu TUR daha once BASLATILDIYSA 2, 3 ... User-Agent'a girer; sayim wrk'den ONCE yazilan
  # baslatilan.csv'den (wrk_kos.sh oldurulurse zaman.csv satiri yazilmaz ama baslatilan.csv satiri kalir).
  n_bit=$(grep -c "^$TUR," "$DIZIN/zaman.csv" || :); n_bas=$(grep -c "^$TUR," "$DIZIN/baslatilan.csv" 2>/dev/null || :)
  DENEME=$(( ${n_bas:-0} > ${n_bit:-0} ? ${n_bas:-0} + 1 : ${n_bit:-0} + 1 ))
  echo; echo ">> [$n/${#KOSULAR[@]}] $TUR  ($(date '+%H:%M:%S'))$([ "$DENEME" -gt 1 ] && echo "  deneme $DENEME")"
  bas=$(date +%s)
  echo "$TUR,$bas,$DENEME" >> "$DIZIN/baslatilan.csv"
  RC=0; KAPI_NEDENI=""; ISINMA_NEDENI=""; SIK=""; I_DEGER=""; O_DEGER=""; O_HATA=""
  kapi
  if [ "$KESILDI" = 0 ] && [ -z "$KAPI_NEDENI" ]; then
    if [ "$ISINMA_SN" -gt 0 ]; then
      wrk_cagir isinma "$ISINMA_SN"
      if [ "$KESILDI" = 0 ]; then
        if [ -f "$ARA/ozet_isinma_$TUR.tsv" ] && I_DEGER="$(ozet_oku "$ARA/ozet_isinma_$TUR.tsv")"; then
          ISINMA_NEDENI="$(faz_metni "$(faz_karari "$I_DEGER")" isinma)"
        else
          I_DEGER=""
          ISINMA_NEDENI="wrk isinma ozeti yazmadi (rc=$RC). Yukaridaki wrk ciktisina bakin."
        fi
        # isinmada durulursa olcum KOSULMAZ; istemci dosyalari yine yazilir (n_olcum 0; k6 gibi n_429 isinmayi da sayar)
        [ -n "$ISINMA_NEDENI" ] && yaz_istemci "$I_DEGER" ""
      fi
    fi
    if [ "$KESILDI" = 0 ] && [ -z "$ISINMA_NEDENI" ]; then
      wrk_cagir olcum "$SURE_SN"
      if [ -f "$ARA/ozet_olcum_$TUR.tsv" ]; then
        if O_DEGER="$(ozet_oku "$ARA/ozet_olcum_$TUR.tsv")"; then yaz_istemci "$I_DEGER" "$O_DEGER"; else O_HATA="$O_DEGER"; O_DEGER=""; fi
      fi
    fi
  fi
  bit=$(date +%s)
  echo "$TUR,$bas,$bit,$RC,$DENEME" >> "$DIZIN/zaman.csv"
  neden=""
  if [ "$KESILDI" = 1 ]; then
    if [ "$SINYAL" = TERM ]; then neden="durduruldu (TERM: Portal durdur ya da zaman siniri)"; else neden="kullanici durdurdu (Ctrl-C)"; fi
  elif [ -n "$KAPI_NEDENI" ]; then
    neden="$KAPI_NEDENI"
  elif [ -n "$ISINMA_NEDENI" ]; then
    neden="$ISINMA_NEDENI"
  elif [ ! -s "$CSV" ]; then
    if [ -n "$O_HATA" ]; then neden="wrk ozeti okunamadi ($ARA/ozet_olcum_$TUR.tsv: $O_HATA)"
    else neden="wrk sonuc yazmadi (rc=$RC). Yukaridaki wrk ciktisina bakin."; fi
  else
    # sayac tutarsizligi 429/5xx'ten ONCE: Lua sayaclari guvenilmezse 429/5xx sayisi da guvenilmez
    karar="$(faz_karari "$O_DEGER")"; n429="$(kolon "$CSV" n_429)"; no="$(kolon "$CSV" n_olcum)"
    case "$karar" in TUTARSIZ*) neden="$(faz_metni "$karar" olcum)" ;; esac
    if [ -z "$neden" ] && [ "${n429:-0}" != 0 ]; then
      neden="429 alindi ($n429): IP basina rate limit asildi. BAGLANTILAR'i dusurun; ayni IP'den baska yuk var mi bakin."
    fi
    if [ -z "$neden" ]; then case "$karar" in S5XX*|SOKET*|ORAN*) neden="$(faz_metni "$karar" olcum)" ;; esac; fi
    if [ -z "$neden" ] && [ "$RC" != 0 ]; then neden="wrk rc=$RC. Yukaridaki ciktiya bakin."; fi
    if [ -z "$neden" ] && { [ -z "$no" ] || [ "$no" = 0 ]; }; then
      neden="wrk ozetinde olcum istegi yok (n_olcum='$no'). Sonuc kullanilamaz."
    fi
  fi
  if [ -n "$neden" ]; then
    for e in csv json; do [ -f "$DIZIN/istemci_$TUR.$e" ] && mv -f "$DIZIN/istemci_$TUR.$e" "$DIZIN/hatali_istemci_$TUR.$e"; done
    echo; echo "DUR: $TUR - $neden"
    echo "     Bu kosunun sonucu 'hatali_' onekiyle saklandi. Nedeni giderip AYNI komutu tekrar calistirin;"
    echo "     tamamlanan kosular atlanir, kaldigi yerden devam eder."
    exit 4
  fi
  echo "   bosluk ${BOSLUK}s..."
  sleep "$BOSLUK" &
  COCUK=$!
  [ "$KESILDI" = 1 ] && kill -TERM "$COCUK" 2>/dev/null
  bekle_cocuk "$COCUK" || :
  COCUK=""
  [ "$KESILDI" = 1 ] && { echo "DUR: kullanici durdurdu; tamamlanan kosular saklandi."; exit 130; }
done
echo
echo "Bitti: $DIZIN  (zaman.csv + istemci_*.csv)."
