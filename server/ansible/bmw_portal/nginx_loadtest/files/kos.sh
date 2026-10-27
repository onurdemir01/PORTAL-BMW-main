#!/bin/bash
# kos.sh - bir ADIM icin yuk kosularini sirayla calistirir (k6 + yuk_k6.js); sonuclar sonuc/<ADIM>/ altina.
# Amac    : her (hiz, tekrar) icin ayni sabit yukle bir kosu; zaman.csv'ye bas/bit; yarida kalirsa kaldigi yerden.
# Kullanim: HEDEF=https://<nginx_ip> HOST_BASLIGI=<vhost> ./kos.sh <ADIM> <K|B> [--kuru]
#   ornek : HEDEF=https://10.1.2.3 ./kos.sh R17 K         KIP=ka TEKRAR=1 HEDEF=... ./kos.sh R17 K
#           AE=identity HIZLAR=250 HEDEF=... ./kos.sh R17 K   ./kos.sh R17 K --kuru  (yalniz plani yazar)
# Ortam   : HOST_BASLIGI(zorunlu) SENARYO_DIZIN(./senaryo) SONUC(./sonuc) HIZLAR("100 250 400"; B icin "10") TEKRAR(2)
#           KIP(yeni|ka) AE(br|gzip|identity) ISINMA(30s) SURE(120s) BOSLUK(30 sn) K6(k6) MAXVU SNI UA_ONEK
# Portal  : el kiti f5_rehber/har_yuk_testi/kos.sh'in kopyasi. Farklar YALNIZ: UA_ONEK k6'ya gecer, HOST_BASLIGI
#           varsayilansiz, LIMIT_MUAF yasak (hep 0), kendi pid'i $SONUC/../kos.pid, TERM (Portal durdur / timeout)
#           calisan k6'yi da sonlandirir (k6 ve bosluk beklemesi arka planda + wait: trap ertelenmez).
set -u
BURASI="$(cd "$(dirname "$0")" && pwd)"
kullanim() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
hata() { echo "HATA: $*" >&2; exit 2; }

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

HEDEF="${HEDEF:-}"; HEDEF="${HEDEF%/}"
HOST_BASLIGI="${HOST_BASLIGI:-}"
UA_ONEK="${UA_ONEK:-portal-yuktesti}"
[[ "$UA_ONEK" =~ ^[a-z][a-z0-9-]{2,30}$ ]] || hata "UA_ONEK yalniz kucuk harf, rakam ve - (3-31 karakter): '$UA_ONEK'"
[ "${LIMIT_MUAF:-0}" = 0 ] || hata "LIMIT_MUAF Portal kosusunda desteklenmez (IP basina limit_req 500 r/s; HIZ en fazla 450)"
SENARYO_DIZIN="${SENARYO_DIZIN:-./senaryo}"
SONUC="${SONUC:-./sonuc}"
if [ "$SEN" = B ]; then HIZLAR="${HIZLAR:-10}"; else HIZLAR="${HIZLAR:-100 250 400}"; fi
TEKRAR="${TEKRAR:-2}"; KIP="${KIP:-yeni}"; AE="${AE:-br}"
# BOSLUK 30: arka plan CPU'su icin kosular arasinda ~20 sn kalir (dislama -2/+8 sn); 3+ sn saat farkina dayanir.
ISINMA="${ISINMA:-30s}"; SURE="${SURE:-120s}"; BOSLUK="${BOSLUK:-30}"; K6="${K6:-k6}"
LIMIT_MUAF=0; MAXVU="${MAXVU:-150}"; SNI="${SNI:-0}"

saniye() {   # 30s | 2m | 30  ->  saniye
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
[[ "$TEKRAR" =~ ^[1-9][0-9]*$ ]] || hata "TEKRAR pozitif tam sayi olmali"
[[ "$BOSLUK" =~ ^[0-9]+$ ]] || hata "BOSLUK saniye (tam sayi) olmali"
[[ "$KIP" == yeni || "$KIP" == ka ]] || hata "KIP yeni ya da ka olmali"
[[ "$AE" == br || "$AE" == gzip || "$AE" == identity ]] || hata "AE br, gzip ya da identity olmali"
[ -n "${HIZLAR//[[:space:]]/}" ] || hata "HIZLAR bos olamaz (ornek: HIZLAR=\"100 250 400\")"
for h in $HIZLAR; do
  [[ "$h" =~ ^[1-9][0-9]*$ ]] || hata "HIZLAR icinde gecersiz deger: '$h'"
  if [ "$h" -gt 450 ] && [ "$LIMIT_MUAF" != 1 ]; then
    hata "HIZ $h > 450: IP basina limit_req 500 r/s; 429 alirsiniz. Yalniz limit_*_dry_run acikken LIMIT_MUAF=1 ile."
  fi
done

SENARYO="$SENARYO_DIZIN/$SEN.tsv"
[ -s "$SENARYO" ] || hata "senaryo dosyasi yok: $SENARYO (once: python3 -I har_senaryo.py ... --cikti $SENARYO_DIZIN)"
# Ayni beyaz liste har_senaryo.py ve yuk_k6.js'de de var: yuk makinesine yalniz yol listesi gider.
DESEN=$'^[0-9.]+\t[0-9]+\t[a-z]+\t[a-z]+\t/[A-Za-z0-9._~!$&\'()*+,;=:@%/-]*$'
BOZUK=$(tr -d '\r' < "$SENARYO" | grep -v '^#' | grep -v '^$' | grep -cvE "$DESEN")
[ "$BOZUK" -eq 0 ] || hata "$SENARYO icinde $BOZUK satir beklenen bicimde degil (5 kolon, yol beyaz listede, sorgu yok)"
SATIR=$(tr -d '\r' < "$SENARYO" | grep -cvE '^(#|$)')

KOSULAR=()
for h in $HIZLAR; do
  for ((r = 1; r <= TEKRAR; r++)); do KOSULAR+=("${ADIM}_${SEN}_${KIP}_${AE}_${h}_r${r}:$h"); done
done
DIZIN="$SONUC/$ADIM"
TOPLAM=$(( ${#KOSULAR[@]} * (ISINMA_SN + SURE_SN + BOSLUK + 5) ))
echo "== kos.sh  adim=$ADIM senaryo=$SEN ($SATIR satir) kip=$KIP ae=$AE hizlar=[$HIZLAR] tekrar=$TEKRAR"
echo "   her kosu: ${ISINMA_SN}s isinma + ${SURE_SN}s olcum + ${BOSLUK}s bosluk;  toplam ~$(( TOPLAM / 60 )) dk $(( TOPLAM % 60 )) sn"
echo "   hedef=${HEDEF:-<HEDEF verilmedi>} host=$HOST_BASLIGI sonuc=$DIZIN"
for k in ${KOSULAR[@]+"${KOSULAR[@]}"}; do
  t="${k%%:*}"
  if [ -s "$DIZIN/istemci_$t.csv" ]; then echo "   - $t  (VAR, atlanacak)"; else echo "   - $t"; fi
done
[ "$KURU" = 1 ] && { echo "(--kuru: hicbir sey kosulmadi)"; exit 0; }

[[ "$HEDEF" =~ ^https://[^/?#[:space:]]+$ ]] || hata "HEDEF=https://<nginx_ip> verin (ornek: HEDEF=https://10.1.2.3 ./kos.sh $ADIM $SEN)"
[ -n "$HOST_BASLIGI" ] || hata "HOST_BASLIGI=<vhost> verin (varsayilan host yok)"
command -v "$K6" >/dev/null 2>&1 || hata "k6 bulunamadi ('$K6'). Kurumun onayli kanalindan getirin, sha256'sini dogrulayin; K6=/yol/k6 ile verin."
SURUM="$("$K6" version 2>/dev/null | head -1)"
if [[ "$SURUM" =~ v([0-9]+)\.([0-9]+) ]]; then
  if [ "${BASH_REMATCH[1]}" -eq 0 ] && [ "${BASH_REMATCH[2]}" -lt 45 ]; then hata "k6 surumu eski: $SURUM (en az v0.45)"; fi
else
  echo "UYARI: k6 surumu okunamadi: '$SURUM'" >&2
fi

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy
export GODEBUG="${GODEBUG:+$GODEBUG,}http2client=0"
mutlak() {   # k6 Windows'ta yerel bicimde (C:/...) yol ister; Linux'ta mutlak POSIX yol
  local d b; d="$(cd "$(dirname "$1")" && pwd)"; b="$(basename "$1")"
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$d/$b"; else echo "$d/$b"; fi
}
mkdir -p "$DIZIN" || hata "dizin olusturulamadi: $DIZIN"
echo "$$" > "$SONUC/../kos.pid" || hata "pid dosyasi yazilamadi: $SONUC/../kos.pid"
[ -s "$DIZIN/zaman.csv" ] || echo "tur,bas_epoch,bit_epoch,rc,deneme" > "$DIZIN/zaman.csv"
[ -s "$DIZIN/baslatilan.csv" ] || echo "tur,bas_epoch,deneme" > "$DIZIN/baslatilan.csv"
SENARYO_M="$(mutlak "$SENARYO")"; DIZIN_M="$(mutlak "$DIZIN")"; BETIK_M="$(mutlak "$BURASI/yuk_k6.js")"

kolon() {   # kolon <csv> <ad> -> deger
  awk -F, -v ad="$2" 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == ad) c = i; next } NR == 2 && c { print $c }' "$1" | tr -d '\r'
}
KESILDI=0; SINYAL=""; COCUK=""
kesildi() {   # INT (Ctrl-C) ya da TERM (Portal durdur / timeout): calisan k6 ya da bosluk beklemesi de biter
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
n=0
for k in ${KOSULAR[@]+"${KOSULAR[@]}"}; do
  TUR="${k%%:*}"; HIZ="${k##*:}"; n=$((n + 1))
  CSV="$DIZIN/istemci_$TUR.csv"
  [ -s "$CSV" ] && continue
  # Deneme no: bu TUR daha once BASLATILDIYSA 2, 3 ... User-Agent'a girer; karsilastir.py onceki denemenin
  # log satirlarini boylece ayirir. Sayim k6'dan ONCE yazilan baslatilan.csv'den: kos.sh oldurulurse (SSH
  # koptu, pencere kapandi) zaman.csv satiri yazilmaz ama baslatilan.csv satiri kalir; numara cakismaz.
  n_bit=$(grep -c "^$TUR," "$DIZIN/zaman.csv" || :); n_bas=$(grep -c "^$TUR," "$DIZIN/baslatilan.csv" 2>/dev/null || :)
  DENEME=$(( ${n_bas:-0} > ${n_bit:-0} ? ${n_bas:-0} + 1 : ${n_bit:-0} + 1 ))
  echo; echo ">> [$n/${#KOSULAR[@]}] $TUR  ($(date '+%H:%M:%S'))$([ "$DENEME" -gt 1 ] && echo "  deneme $DENEME")"
  bas=$(date +%s)
  echo "$TUR,$bas,$DENEME" >> "$DIZIN/baslatilan.csv"
  "$K6" run --quiet \
    -e HEDEF="$HEDEF" -e HOST_BASLIGI="$HOST_BASLIGI" -e SENARYO="$SENARYO_M" -e TUR="$TUR" -e ADIM="$ADIM" \
    -e SEN="$SEN" -e HIZ="$HIZ" -e KIP="$KIP" -e AE="$AE" -e ISINMA="${ISINMA_SN}s" -e SURE="${SURE_SN}s" \
    -e CIKTI="$DIZIN_M" -e LIMIT_MUAF="$LIMIT_MUAF" -e MAXVU="$MAXVU" -e SNI="$SNI" -e DENEME="$DENEME" \
    -e UA_ONEK="$UA_ONEK" "$BETIK_M" &
  COCUK=$!
  [ "$KESILDI" = 1 ] && kill -TERM "$COCUK" 2>/dev/null
  rc=0; bekle_cocuk "$COCUK" || rc=$?
  COCUK=""
  bit=$(date +%s)
  echo "$TUR,$bas,$bit,$rc,$DENEME" >> "$DIZIN/zaman.csv"
  neden=""
  if [ "$KESILDI" = 1 ]; then
    if [ "$SINYAL" = TERM ]; then neden="durduruldu (TERM: Portal durdur ya da zaman siniri)"; else neden="kullanici durdurdu (Ctrl-C)"; fi
  elif [ ! -s "$CSV" ]; then
    neden="k6 sonuc yazmadi (rc=$rc). Yukaridaki k6 hatasina bakin (on kontrol: senaryodaki yollarin hepsi 200 mu? SENARYO/HEDEF?)"
  else
    n429="$(kolon "$CSV" n_429)"; h2="$(kolon "$CSV" http2)"; dr="$(kolon "$CSV" dropped)"; no="$(kolon "$CSV" n_olcum)"
    if [ "${n429:-0}" != 0 ]; then
      neden="429 alindi ($n429): IP basina rate limit asildi. HIZLAR'i dusurun; baska yuk testi var mi bakin."
    elif [ "${h2:-0}" != 0 ]; then
      neden="HTTP/2 kullanildi ($h2): GODEBUG=http2client=0 tutmadi; k6 surumunu kontrol edin."
    elif [ "$rc" != 0 ]; then
      neden="k6 rc=$rc (esik ya da hata). Yukaridaki ciktiya bakin."
    elif [ -z "$no" ] || [ "$no" = 0 ]; then
      neden="k6 ozetinde olcum istegi yok (n_olcum='$no'): k6 surumu ozet bicimini degistirmis olabilir ($SURUM). Sonuc kullanilamaz."
    elif [ "${dr:-0}" != 0 ]; then
      echo "UYARI: dropped_iterations=$dr - istenen hiz tutturulamadi (yuk makinesi yetmedi ya da sunucu doydu). Kosu DOYMA sayilir."
    fi
  fi
  if [ -n "$neden" ]; then
    for e in csv json; do [ -f "$DIZIN/istemci_$TUR.$e" ] && mv -f "$DIZIN/istemci_$TUR.$e" "$DIZIN/hatali_istemci_$TUR.$e"; done
    echo; echo "DUR: $TUR - $neden"
    echo "     Bu kosunun sonucu 'hatali_' onekiyle saklandi. Nedeni giderip AYNI komutu tekrar calistirin;"
    echo "     tamamlanan kosular atlanir, kaldigi yerden devam eder."
    exit 4
  fi
  echo "   bosluk ${BOSLUK}s (arka plan CPU ornegi)..."
  sleep "$BOSLUK" &
  COCUK=$!
  [ "$KESILDI" = 1 ] && kill -TERM "$COCUK" 2>/dev/null
  bekle_cocuk "$COCUK" || :
  COCUK=""
  [ "$KESILDI" = 1 ] && { echo "DUR: kullanici durdurdu; tamamlanan kosular saklandi."; exit 130; }
done
echo
echo "Bitti: $DIZIN  (zaman.csv + istemci_*.csv)."
echo "SIMDI: nginx sunucusunda cpu_kaydedici.sh'i Ctrl-C ile durdurun (bu adimda baska kosu kalmadiysa),"
echo "       sonra iki taraftaki sonuc/$ADIM/ dizinlerini dizustunde AYNI sonuc/$ADIM/ altinda birlestirin."
