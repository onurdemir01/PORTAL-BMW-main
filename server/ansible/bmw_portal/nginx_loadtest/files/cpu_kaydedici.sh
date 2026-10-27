#!/bin/bash
# cpu_kaydedici.sh - nginx test sunucusunda yuk testi boyunca worker CPU'sunu (user/sys) saniyede bir kaydeder.
# Amac    : istek basina CPU icin zaman serisi + YALNIZ test isteklerinin log satirlari (User-Agent <UA_ONEK>/).
#           SALT OKUNUR: nginx'e dokunmaz, reload yapmaz, log'a yazmaz; root gerekmez (www kullanicisi yeter).
# Kullanim: ./cpu_kaydedici.sh <ADIM> ["degisiklik notu"]      Ctrl-C ile biter (ya da SURE=<sn> ile).
#   ornek : ./cpu_kaydedici.sh T1 "brotli_comp_level 6->4, min_length 1024"
# Ortam   : LOGDIR(/web_log) NGINX_KONF_DIZIN("/usr/nginx") BOSTA_BAS(60) ARALIK(1) SURE(0) SONUC(./sonuc)
#           LOG_BEKLE(6 sn; access_log buffer/flush icin) MASTER_PID (birden fazla nginx varsa)
#           UA_ONEK(portal-yuktesti; k6'nin User-Agent oneki, kos.sh/yuk_k6.js ile AYNI olmali)
# Portal  : el kiti f5_rehber/har_yuk_testi/cpu_kaydedici.sh'in kopyasi. Farklar: (1) UA oneki UA_ONEK; (2) test
#           satiri YALNIZ bu kaydin ADIM'inin satiriysa sayilir: user-agent=<UA_ONEK>/<ADIM>_... (birlesik bicimde
#           tirnakli <UA_ONEK>/<ADIM>_...; ADIM awk'a -v ADIM ile gider); baska ADIM'in satiri (or. yetim kalmis
#           eski bir k6) 'diger' trafiktir. Portal TERM ile durdurur (trap bitir: bilgi_*.txt yazilir); cikti
#           dosyalari ve bicimleri kitle ayni.
set -u
export LC_ALL=C
kullanim() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
hata() { echo "HATA: $*" >&2; exit 2; }

[ $# -ge 1 ] && [ $# -le 2 ] || kullanim
case "$1" in -h|--help) kullanim ;; esac
ADIM="$1"; NOT="${2:-}"
[[ "$ADIM" =~ ^[A-Za-z0-9-]+$ ]] || hata "ADIM yalniz harf, rakam ve - icerebilir (alt cizgi YOK): '$ADIM'"
LOGDIR="${LOGDIR:-/web_log}"
NGINX_KONF_DIZIN="${NGINX_KONF_DIZIN:-/usr/nginx}"
BOSTA_BAS="${BOSTA_BAS:-60}"; ARALIK="${ARALIK:-1}"; SURE="${SURE:-0}"; LOG_BEKLE="${LOG_BEKLE:-6}"
SONUC="${SONUC:-./sonuc}"
UA_ONEK="${UA_ONEK:-portal-yuktesti}"
[[ "$UA_ONEK" =~ ^[a-z][a-z0-9-]{2,30}$ ]] || hata "UA_ONEK yalniz kucuk harf, rakam ve - (3-31 karakter): '$UA_ONEK'"
PROC="${PROC_ROOT:-/proc}"
for v in BOSTA_BAS SURE LOG_BEKLE; do [[ "${!v}" =~ ^[0-9]+$ ]] || hata "$v tam sayi (saniye) olmali"; done
[[ "$ARALIK" =~ ^[0-9]+([.][0-9]+)?$ ]] || hata "ARALIK saniye olmali"
[ -d "$LOGDIR" ] || hata "LOGDIR yok: $LOGDIR"
[ -r "$PROC/stat" ] || hata "$PROC/stat okunamiyor"

HOSTK="$(hostname -s 2>/dev/null || uname -n)"; HOSTK="$(printf '%s' "${HOSTK%%.*}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
OUT="$SONUC/$ADIM"
mkdir -p "$OUT" || hata "dizin olusturulamadi: $OUT"
OUT_R="$(cd "$OUT" && pwd -P)"; LOG_R="$(cd "$LOGDIR" && pwd -P)"
case "$OUT_R/" in "$LOG_R"/*) hata "SONUC log dizininin ($LOGDIR) altinda olamaz (disk_cleaner/log toplayici); ev dizininde calistirin" ;; esac
TABAN="${ADIM}_${HOSTK}"; i=2
while [ -e "$OUT/sunucu_${TABAN}.csv" ]; do TABAN="${ADIM}_${HOSTK}_$i"; i=$((i + 1)); done
CSV="$OUT/sunucu_${TABAN}.csv"; BILGI="$OUT/bilgi_${TABAN}.txt"; KONF="$OUT/konf_${TABAN}.txt"
LOGTSV="$OUT/log_${TABAN}.tsv"; DIGER="$OUT/diger_${TABAN}.tsv"
[ -n "$NOT" ] && printf '%s  %s\n' "$NOT" "($(date '+%F %T'), $HOSTK)" >> "$OUT/NOT.txt"

# --- nginx master ve worker'lar (/proc taramasi; pgrep gerekmez) --------------------------------------------
masterlari_bul() {
  local f c p
  for f in "$PROC"/[0-9]*/cmdline; do
    c=""; IFS= read -r -d '' c < "$f" 2>/dev/null
    case "$c" in "nginx: master process"*) p=${f%/cmdline}; echo "${p##*/}" ;; esac
  done
}
if [ -n "${MASTER_PID:-}" ]; then
  MASTER="$MASTER_PID"
else
  M=($(masterlari_bul))
  [ "${#M[@]}" -ge 1 ] || hata "nginx master bulunamadi. /proc 'hidepid' ile baglanmis olabilir (mount | grep proc); bu durumda 'dzdo ./cpu_kaydedici.sh ...' gerekir."
  [ "${#M[@]}" -eq 1 ] || hata "birden fazla nginx master var (${M[*]:-}); glomo-test'i sunani MASTER_PID=<pid> ile verin."
  MASTER="${M[0]}"
fi
IU=0; IS=0; IN=0; IK=0; IP="-"
isci_topla() {   # MASTER'in "nginx: worker process" cocuklari: utime/stime toplami (tik), sayi, kapanan, pid listesi
  local f c p st rest pids="" adaylar=""
  IU=0; IS=0; IN=0; IK=0
  if [ -r "$PROC/$MASTER/task/$MASTER/children" ]; then
    read -r adaylar < "$PROC/$MASTER/task/$MASTER/children" || :
  else
    for f in "$PROC"/[0-9]*; do adaylar="$adaylar ${f##*/}"; done
  fi
  for p in $adaylar; do
    c=""; IFS= read -r -d '' c < "$PROC/$p/cmdline" 2>/dev/null
    case "$c" in "nginx: worker process"*) ;; *) continue ;; esac
    st=""; IFS= read -r st < "$PROC/$p/stat" 2>/dev/null
    [ -n "$st" ] || continue
    rest=${st##*) }
    set -f; set -- $rest; set +f
    [ "$#" -ge 13 ] && [ "$2" = "$MASTER" ] || continue
    IU=$((IU + ${12})); IS=$((IS + ${13})); IN=$((IN + 1))
    case "$c" in *"shutting down"*) IK=$((IK + 1)) ;; esac
    pids="${pids:+$pids+}$p"
  done
  IP="${pids:--}"
}
ornek_al() {
  local t cu cn cs ci cw cq csq cst
  t="${EPOCHREALTIME:-}"; [ -n "$t" ] || t="$(date +%s)"
  isci_topla
  read -r _ cu cn cs ci cw cq csq cst _ < "$PROC/stat"
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$t" "$IU" "$IS" "$IN" "$IK" "$IP" "${cu:-0}" "${cn:-0}" \
    "${cs:-0}" "${ci:-0}" "${cw:-0}" "${cq:-0}" "${csq:-0}" "${cst:-0}" >> "$CSV"
  NORNEK=$((NORNEK + 1))
}
simdi() { if [ -n "${EPOCHSECONDS:-}" ]; then echo "$EPOCHSECONDS"; else date +%s; fi; }
df_yuzde() { df -P "$1" 2>/dev/null | awk 'NR == 2 { sub(/%$/, "", $5); print $5 + 0 }'; }
konf_dosyalari() { local d; for d in $NGINX_KONF_DIZIN; do find "$d" -maxdepth 4 -type f -name '*.conf' -readable 2>/dev/null; done | sort; }
konf_hash() {
  local f
  konf_dosyalari | while IFS= read -r f; do sha256sum "$f" 2>/dev/null; done | sha256sum | cut -c1-16
}

isci_topla
[ "$IN" -gt 0 ] || hata "master $MASTER icin worker bulunamadi (hidepid? yanlis MASTER_PID?)"
CLK="$(getconf CLK_TCK 2>/dev/null)"; [[ "$CLK" =~ ^[0-9]+$ ]] || CLK=100
NPROC="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
DF_BAS="$(df_yuzde "$LOGDIR")"
KONF_SAYI="$(konf_dosyalari | wc -l | tr -d ' ')"
KONF_BAS="$(konf_hash)"
BAS_EPOCH="$(simdi)"
ISCI_BAS="$IN"; PID_BAS="$IP"
UYARI=()
[ "$KONF_SAYI" -gt 0 ] || UYARI+=("konf_okunamadi:$NGINX_KONF_DIZIN(NGINX_KONF_DIZIN verin)")
if [ -n "$DF_BAS" ] && [ "$DF_BAS" -ge 65 ]; then
  UYARI+=("disk_%$DF_BAS:$LOGDIR(>=65: disk_cleaner loglari sifirlayabilir)")
  echo "UYARI: $LOGDIR %$DF_BAS dolu (>= 65). disk_cleaner loglari sifirlayabilir; kosular GECERSIZ sayilir." >&2
fi
{
  echo "# konf_${TABAN}: yalniz dosya adlari, ozetler ve sinirli direktif satirlari (tam nginx -T YOK)"
  echo "# dosya_sayisi=$KONF_SAYI ozet=$KONF_BAS"
  konf_dosyalari | while IFS= read -r f; do printf '%s  %s\n' "$(sha256sum "$f" 2>/dev/null | cut -c1-16)" "$f"; done
  echo "# direktifler"
  konf_dosyalari | while IFS= read -r f; do
    grep -HnE '^[[:space:]]*(brotli|gzip|ssl_session|keepalive|access_log|open_file_cache|worker_|limit_req|limit_conn|sendfile)' "$f" 2>/dev/null \
      | grep -viE 'key|secret|pass'
  done
} > "$KONF"

LOGLAR=(); LOG_INODE=(); LOG_OFS=()
for f in "$LOGDIR"/*.log; do
  [ -f "$f" ] && [ -r "$f" ] || continue
  LOGLAR+=("$f"); LOG_INODE+=("$(stat -c %i -- "$f")"); LOG_OFS+=("$(stat -c %s -- "$f")")
done
[ "${#LOGLAR[@]}" -gt 0 ] || UYARI+=("okunabilir_log_yok:$LOGDIR/*.log")

echo "epoch,isci_utime,isci_stime,isci_sayi,kapanan_sayi,pidler,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal" > "$CSV"
NORNEK=0

log_cikar() {   # yeni baytlardan yalniz test satirlari -> LOGTSV; digerleri yalniz saniye basina adet -> DIGER
  local j f ino boy ofs sonuc
  # deneme: UA'nin 4. parcasi (<UA_ONEK>/<TUR>/<faz>/<deneme>, kos.sh verir); eski k6 betiginde yok -> 1
  printf 'tur\tfaz\ttime_local\tstatus\tyol\trequest_time\tresponse_lenght\tconnection_request\tdeneme\n' > "$LOGTSV"
  : > "$DIGER.tmp"
  TEST=0; DIGERN=0; BOZUK=0; LOGDURUM=()
  for ((j = 0; j < ${#LOGLAR[@]}; j++)); do
    f="${LOGLAR[$j]}"; ofs="${LOG_OFS[$j]}"
    ino="$(stat -c %i -- "$f" 2>/dev/null)"; boy="$(stat -c %s -- "$f" 2>/dev/null)"
    if [ "$ino" != "${LOG_INODE[$j]}" ] || [ -z "$boy" ] || [ "$boy" -lt "$ofs" ]; then
      LOGDURUM+=("log=$(basename "$f")|${LOG_INODE[$j]}|$ofs|${boy:-?}|dondu")
      GECERSIZ+=("log_dondu:$(basename "$f")")
      continue
    fi
    LOGDURUM+=("log=$(basename "$f")|$ino|$ofs|$boy|tamam")
    [ "$boy" -gt "$ofs" ] || continue
    sonuc="$(tail -c +"$((ofs + 1))" -- "$f" | head -c "$((boy - ofs))" | awk -v LOGOUT="$LOGTSV" -v DOUT="$DIGER.tmp" -v UA="$UA_ONEK" -v ADIM="$ADIM" '
      function kv(k,   n) {
        if (match($0, " " k "=[^ ]*")) { n = length(k) + 2; return substr($0, RSTART + n, RLENGTH - n) }
        return "-"
      }
      BEGIN { OFS = "\t" }
      {
        bmw = index($0, " user-agent=" UA "/" ADIM "_") > 0
        if (!bmw && index($0, "\"" UA "/" ADIM "_") == 0) {
          if (match($0, / time=[^ ]+ [^ ]+/)) d[substr($0, RSTART + 6, RLENGTH - 6)]++
          else if (match($0, /\[[^]]+\]/)) d[substr($0, RSTART + 1, RLENGTH - 2)]++
          diger++
          next
        }
        c = index($0, " cookie=")
        if (c > 0) $0 = substr($0, 1, c - 1)
        if (bmw) {
          ua = kv("user-agent"); tl = "-"
          if (match($0, / time=[^ ]+ [^ ]+/)) tl = substr($0, RSTART + 6, RLENGTH - 6)
          st = kv("status"); yol = kv("request"); rt = kv("request_time"); bl = kv("response_lenght")
          cr = kv("connection_request")
        } else {
          tl = "-"; if (match($0, /\[[^]]+\]/)) tl = substr($0, RSTART + 1, RLENGTH - 2)
          yol = "-"; if (match($0, /"[A-Z]+ [^ "]+/)) { yol = substr($0, RSTART + 1, RLENGTH - 1); sub(/^[A-Z]+ /, "", yol) }
          st = "-"; bl = "-"
          if (match($0, /" [0-9][0-9][0-9] [0-9-]+/)) { split(substr($0, RSTART + 2, RLENGTH - 2), P, " "); st = P[1]; bl = P[2] }
          ua = ""; if (match($0, "\"" UA "/[^\"]*\"")) ua = substr($0, RSTART + 1, RLENGTH - 2)
          rt = "-"; cr = "-"
        }
        sub(/\?.*/, "", yol)
        n = split(ua, U, "/")
        dn = (n >= 4) ? U[4] : "1"
        if (n < 3 || U[2] !~ /^[A-Za-z0-9_-]+$/ || U[3] !~ /^[a-z]+$/ || dn !~ /^[0-9]+$/ || yol ~ /[\t]/) { bozuk++; next }
        print U[2], U[3], tl, st, yol, rt, bl, cr, dn >> LOGOUT
        test++
      }
      END {
        for (k in d) print k "\t" d[k] >> DOUT
        printf "%d %d %d\n", test, diger, bozuk
      }')"
    set -- $sonuc
    TEST=$((TEST + ${1:-0})); DIGERN=$((DIGERN + ${2:-0})); BOZUK=$((BOZUK + ${3:-0}))
  done
  printf 'time_local\tadet\n' > "$DIGER"
  awk -F'\t' '{ a[$1] += $2 } END { for (k in a) print k "\t" a[k] }' "$DIGER.tmp" | sort >> "$DIGER"
  rm -f "$DIGER.tmp"
}

GECERSIZ=()
BITTI=0
bitir() {
  trap '' INT TERM
  [ "$BITTI" = 1 ] && return
  BITTI=1
  ornek_al
  echo; echo "durduruldu; access_log tamponu bosalsin diye ${LOG_BEKLE}s bekleniyor (Ctrl-C'ye basmayin)..."
  sleep "$LOG_BEKLE"
  ornek_al
  log_cikar
  local df_bit konf_bit bit
  df_bit="$(df_yuzde "$LOGDIR")"; konf_bit="$(konf_hash)"; bit="$(simdi)"
  if [ -n "$df_bit" ] && [ "$df_bit" -ge 65 ] && { [ -z "$DF_BAS" ] || [ "$DF_BAS" -lt 65 ]; }; then
    UYARI+=("disk_%$df_bit:$LOGDIR(>=65)")
  fi
  [ "$konf_bit" = "$KONF_BAS" ] || UYARI+=("konf_degisti(kayit_sirasinda):$KONF_BAS->$konf_bit")
  [ "$TEST" -gt 0 ] || UYARI+=("test_satiri_yok(yanlis_sunucu?_LOGDIR?_log_format_user-agent_iceriyor_mu?)")
  {
    echo "surum=1"; echo "adim=$ADIM"; echo "host=$HOSTK"; echo "nproc=$NPROC"; echo "clk_tck=$CLK"
    echo "master_pid=$MASTER"; echo "bas_epoch=$BAS_EPOCH"; echo "bit_epoch=$bit"
    echo "df_bas=${DF_BAS:-}"; echo "df_bit=${df_bit:-}"
    echo "konf_hash_bas=$KONF_BAS"; echo "konf_hash_bit=$konf_bit"; echo "konf_dosya_sayisi=$KONF_SAYI"
    echo "isci_sayisi_bas=$ISCI_BAS"; echo "isci_pid_bas=$PID_BAS"; echo "isci_pid_bit=$IP"
    echo "ornek_sayisi=$NORNEK"; echo "test_satiri=$TEST"; echo "diger_satiri=$DIGERN"; echo "bozuk_ua_satiri=$BOZUK"
    # ${X[@]+"${X[@]}"}: bash 4.2 (RHEL 7) + set -u bos diziyi 'unbound variable' sayar; 4.4+ saymaz.
    for x in ${LOGDURUM[@]+"${LOGDURUM[@]}"}; do echo "$x"; done
    for x in ${UYARI[@]+"${UYARI[@]}"}; do echo "uyari=$x"; done
    for x in ${GECERSIZ[@]+"${GECERSIZ[@]}"}; do echo "gecersiz=$x"; done
  } > "$BILGI"
  echo
  echo "== cpu_kaydedici ozeti ($ADIM, $HOSTK)"
  echo "   ornek=$NORNEK  test_satiri=$TEST  diger_satiri=$DIGERN  bozuk=$BOZUK  worker=$ISCI_BAS->$IN"
  [ "$PID_BAS" = "$IP" ] || echo "   NOT: worker PID kumesi kayit sirasinda degisti (reload) - o andaki kosular GECERSIZ sayilir."
  for x in ${UYARI[@]+"${UYARI[@]}"}; do echo "   UYARI: $x"; done
  for x in ${GECERSIZ[@]+"${GECERSIZ[@]}"}; do echo "   GECERSIZ: $x"; done
  echo "   dosyalar: $CSV"
  echo "             $LOGTSV  $DIGER  $BILGI  $KONF"
  echo "   Bu dizini (sonuc/$ADIM/) dizustune alin; yuk makinesindeki sonuc/$ADIM/ ile ayni dizinde birlestirin."
  exit 0
}
trap bitir INT TERM

echo "== cpu_kaydedici: adim=$ADIM host=$HOSTK master=$MASTER worker=$IN nproc=$NPROC clk_tck=$CLK"
echo "   log=${#LOGLAR[@]} dosya ($LOGDIR)  konf=$KONF_SAYI dosya  df=%${DF_BAS:-?}  cikti=$CSV"
echo "   ilk ${BOSTA_BAS}s bosta ornek aliniyor (arka plan CPU'su). Bitirmek icin Ctrl-C."
BAS="$(simdi)"; SON_DURUM="$BAS"; DUYURULDU=0; ONCEKI_PID="$IP"
while :; do
  ornek_al
  t="$(simdi)"
  if [ "$IP" != "$ONCEKI_PID" ]; then
    echo "UYARI $(date '+%H:%M:%S'): worker PID kumesi degisti (reload?). Bu andaki kosu GECERSIZ sayilir."
    ONCEKI_PID="$IP"
  fi
  if [ "$DUYURULDU" = 0 ] && [ $((t - BAS)) -ge "$BOSTA_BAS" ]; then
    echo ">>> $(date '+%H:%M:%S') bos ornek tamam: YUKU SIMDI BASLATIN (yuk makinesinde ./kos.sh $ADIM ...)"
    DUYURULDU=1
  fi
  if [ $((t - SON_DURUM)) -ge 60 ]; then
    echo "   $(date '+%H:%M:%S') ornek=$NORNEK worker=$IN (kapanan=$IK)"
    SON_DURUM="$t"
  fi
  if [ "$SURE" -gt 0 ] && [ $((t - BAS)) -ge "$SURE" ]; then bitir; fi
  sleep "$ARALIK"
done
