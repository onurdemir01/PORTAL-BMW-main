#!/bin/bash
# durdur.sh - Portal Nginx Hub "Yuk Testi": bir kosunun BU sunucuda kalan sureclerini durdurur.
# Kullanim: durdur.sh <kosu_dizini>          (www ile; dizin <www ev>/.portal_yuktesti/<kosu_id>)
# Hedef   : komut satiri "<kosu_dizini>/" iceren su surecler (baska hicbir surece dokunulmaz):
#             1) <kosu_dizini>/*.pid dosyalarindaki pid'ler (pid yeniden kullanilmissa komut satiri tutmaz, dokunulmaz)
#             2) 'k6 run' surecleri (argv[0] adi k6..., argv[1] 'run')
#             3) bash <kosu_dizini>/kos.sh | cpu_kaydedici.sh | on_kontrol.sh (timeout KILL'lenirse yetim kalmasin)
#           Once TERM; 10 sn icinde bitmeyene KILL; 2 sn sonra hala duran KALDI sayilir.
# Eslesme : ps -eo pid=,args= -ww | awk. Dizin awk'a ORTAM degiskeniyle gider (awk'in kendi komut satirinda yok)
#           ve k6 deseni [k]6: awk kendi satirini eslemez (bkz. README "Tuzaklar": ps|awk kendine eslesir).
# Cikti   : DURDUR<TAB><pid><TAB><ad><TAB><TERM|KILL|KALDI>; son satir SONUC<TAB><OK|FAIL><TAB><n><TAB><mesaj>
# Cikis   : 0 durdurulacak surec kalmadi, 1 en az bir surec durdurulamadi ya da olculemedi, 2 girdi hatasi.
set -u
export LC_ALL=C
DIZIN="${1:-}"
DIZIN="${DIZIN%/}"
BEKLE="${DURDUR_BEKLE:-10}"
sonuc() { printf 'SONUC\t%s\t%s\t%s\n' "$1" "$2" "$(printf '%s' "$3" | tr '\t\r\n' '   ' | cut -c1-300)"; }
[[ "$DIZIN" =~ ^/[A-Za-z0-9._/-]+/[.]portal_yuktesti/[0-9]{1,10}$ ]] || { sonuc FAIL 0 "kosu dizini gecersiz: $DIZIN"; exit 2; }
[[ "$DIZIN" != *"/../"* ]] || { sonuc FAIL 0 "kosu dizininde .. var"; exit 2; }
[[ "$BEKLE" =~ ^[0-9]{1,3}$ ]] || { sonuc FAIL 0 "DURDUR_BEKLE gecersiz"; exit 2; }

PIDLER=" "
for f in "$DIZIN"/*.pid; do
  [ -f "$f" ] || continue
  p="$(head -c 32 "$f" 2>/dev/null | tr -cd '0-9')"
  [ -n "$p" ] && PIDLER="$PIDLER$p "
done

if ! LISTE="$(ps -eo pid=,args= -ww 2>/dev/null)" || [ -z "$LISTE" ]; then
  sonuc FAIL 0 "ps calismadi; surecler olculemedi, hicbir surec durdurulmadi"
  exit 1
fi
ADAY="$(printf '%s\n' "$LISTE" | D="$DIZIN/" PIDLER="$PIDLER" BEN="$$" UST="$PPID" awk '
  {
    p = $1
    if (p == ENVIRON["BEN"] || p == ENVIRON["UST"]) next
    if (index($0, ENVIRON["D"]) == 0) next
    if ($2 ~ /(^|\/)[k]6[^\/]*$/ && $3 == "run") { print p "\tk6"; next }
    if ($2 ~ /(^|\/)(ba)?sh$/ && ($3 == ENVIRON["D"] "kos.sh" || $3 == ENVIRON["D"] "cpu_kaydedici.sh" || $3 == ENVIRON["D"] "on_kontrol.sh")) {
      n = split($3, a, "/"); print p "\t" a[n]; next
    }
    if (index(ENVIRON["PIDLER"], " " p " ") > 0) print p "\tkayitli"
  }')"

if [ -z "$ADAY" ]; then
  sonuc OK 0 "durdurulacak surec yok"
  exit 0
fi

declare -A AD=()
SIRA=()
while IFS=$'\t' read -r p ad; do
  [ -n "$p" ] || continue
  AD[$p]="$ad"; SIRA+=("$p")
  kill -TERM "$p" 2>/dev/null
done <<< "$ADAY"

canli() { local p n=0; for p in ${SIRA[@]+"${SIRA[@]}"}; do kill -0 "$p" 2>/dev/null && n=$((n + 1)); done; echo "$n"; }
i=0
while [ "$i" -lt "$BEKLE" ] && [ "$(canli)" -gt 0 ]; do sleep 1; i=$((i + 1)); done
declare -A SON=()
for p in ${SIRA[@]+"${SIRA[@]}"}; do
  if kill -0 "$p" 2>/dev/null; then kill -KILL "$p" 2>/dev/null; SON[$p]=KILL; else SON[$p]=TERM; fi
done
[ "$(canli)" -gt 0 ] && sleep 2
KALAN=0
for p in ${SIRA[@]+"${SIRA[@]}"}; do
  if kill -0 "$p" 2>/dev/null; then SON[$p]=KALDI; KALAN=$((KALAN + 1)); fi
  printf 'DURDUR\t%s\t%s\t%s\n' "$p" "${AD[$p]}" "${SON[$p]}"
done
if [ "$KALAN" -gt 0 ]; then
  sonuc FAIL "${#SIRA[@]}" "$KALAN surec durdurulamadi"
  exit 1
fi
sonuc OK "${#SIRA[@]}" "${#SIRA[@]} surec durduruldu"
