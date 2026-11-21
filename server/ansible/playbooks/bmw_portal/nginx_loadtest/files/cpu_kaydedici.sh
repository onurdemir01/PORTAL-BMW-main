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
#           eski bir k6) 'diger' trafiktir. Portal TERM ile durdurur (trap bitir: bilgi_*.txt yazilir); kitin cikti
#           dosyalari ve bicimleri ayni. (3) 2026-11-03: ek dosya bellek_<TABAN>.csv (epoch,nginx_rss_kb,isci_sayi,
#           mem_total_kb,mem_available_kb; her ornekte worker VmRSS toplami + /proc/meminfo). sunucu_*.csv semasina
#           kolon EKLENMEZ: eski Portal ve karsilastir.py bellek_ onekini tanimaz, dosyayi atlar. (4) 2026-11-03 (bant
#           genisligi / bellek ayrisimi, YALNIZ BILGI): ag_<TABAN>.csv (epoch,arayuz,rx_bayt,tx_bayt; /proc/net/dev
#           kumulatif sayac) + ag_<TABAN>.txt (rol=hedef, secim, arayuz, hiz_mbps) ve bdetay_<TABAN>.csv (epoch,isci_sayi,
#           kapanan_sayi,anon_kb,shmem_kb,file_kb,pss_kb,master_rss_kb,master_pss_kb,baglanti; worker RssAnon / RssShmem /
#           RssFile toplami, smaps_rollup Pss, master ayri, HEDEF_IP:HEDEF_PORT ESTABLISHED sayisi). Arayuz: HEDEF_IP'nin
#           atali oldugu (ip -o -4 addr); bulunamazsa ya da lo ise lo disi her arayuz (en cok 32; secim= nedenini yazar).
#           Ortam: HEDEF_IP (Portal verir) HEDEF_PORT(443) SYS_ROOT(/sys; sinama). ag_ / bdetay_ onekleri hicbir eski
#           Portal / karsilastir.py desenine uymaz (eski okuyucu atlar). (5) 2026-11-04: ornek epoch'u bash < 5'te de
#           kesirli (date +%s.%N; bash 5 EPOCHREALTIME ile zaten kesirliydi); bitiste ag txt'ye kaydedici_cpu_ms (kendi +
#           cocuk surec CPU'su) ve kaydedici_sure_sn eklenir (kaydedici maliyeti gercek kosuda olculur).
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
LOGTSV="$OUT/log_${TABAN}.tsv"; DIGER="$OUT/diger_${TABAN}.tsv"; BELLEK="$OUT/bellek_${TABAN}.csv"
AG_CSV="$OUT/ag_${TABAN}.csv"; AG_TXT="$OUT/ag_${TABAN}.txt"; BDETAY="$OUT/bdetay_${TABAN}.csv"
SYS="${SYS_ROOT:-/sys}"; HEDEF_PORT="${HEDEF_PORT:-443}"
HEDEF_IP_OK=""; [[ "${HEDEF_IP:-}" =~ ^[0-9]{1,3}([.][0-9]{1,3}){3}$ ]] && HEDEF_IP_OK=1
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
  # 2026-11-04: bash < 5 (RHEL 7/8; EPOCHREALTIME yok) de kesirli epoch (date +%s.%N; ayni tek fork): tam saniyede ardisik ornek
  # farki 1 sn sayilip gercekte 1,4 sn olabiliyordu (NIC tepesi / kullanim % sisiyordu). %N yoksa eskisi gibi tam saniye.
  t="${EPOCHREALTIME:-}"; [ -n "$t" ] || t="$(date +%s.%N 2>/dev/null)"; [[ "$t" =~ ^[0-9]+([.][0-9]+)?$ ]] || t="$(date +%s)"
  isci_topla
  read -r _ cu cn cs ci cw cq csq cst _ < "$PROC/stat"
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$t" "$IU" "$IS" "$IN" "$IK" "$IP" "${cu:-0}" "${cn:-0}" \
    "${cs:-0}" "${ci:-0}" "${cw:-0}" "${cq:-0}" "${csq:-0}" "${cst:-0}" >> "$CSV"
  NORNEK=$((NORNEK + 1))
  bellek_al "$t"
  ag_al "$t"
  bdetay_al "$t"
}
bellek_al() {   # worker'larin VmRSS toplami (kB, IP listesi) + MemTotal / MemAvailable; okunamayan alan bos (bilgi)
  local p k v _ rss=0 mt="" ma=""
  for p in ${IP//+/ }; do
    [[ "$p" =~ ^[0-9]+$ ]] || continue
    while read -r k v _; do
      if [ "$k" = "VmRSS:" ]; then [[ "$v" =~ ^[0-9]+$ ]] && rss=$((rss + v)); break; fi
    done 2>/dev/null < "$PROC/$p/status"
  done
  while read -r k v _; do
    case "$k" in MemTotal:) mt="$v" ;; MemAvailable:) ma="$v" ;; esac
    [ -n "$mt" ] && [ -n "$ma" ] && break
  done 2>/dev/null < "$PROC/meminfo"
  [[ "$mt" =~ ^[0-9]+$ ]] || mt=""; [[ "$ma" =~ ^[0-9]+$ ]] || ma=""
  printf '%s,%s,%s,%s,%s\n' "$1" "$rss" "$IN" "$mt" "$ma" >> "$BELLEK"
}
# --- 2026-11-03 ag (bant genisligi, YALNIZ BILGI): /proc/net/dev kumulatif rx/tx baytlari ---------------------------
ag_arayuz_bul() {   # hedef: HEDEF_IP'nin atali oldugu arayuz (ip -o -4 addr; vlan 'x@y' -> x)
  "$1" -o -4 addr show 2>/dev/null | awk -v ip="$HEDEF_IP" '{ for (i = 1; i < NF; i++) if ($i == "inet") { split($(i + 1), a, "/"); if (a[1] == ip) { d = $2; sub(/@.*/, "", d); sub(/:$/, "", d); print d; exit } } }'
}
AG_ROL=hedef; AG_SECIM_ADI=hedef_ip
AG_ACIK=0; AG_ARAYUZ=""; AG_SECIM=""; AG_HIZ=""; AG_MAX=32
ag_ip_komutu() { local k; for k in ip /sbin/ip /usr/sbin/ip; do if command -v "$k" >/dev/null 2>&1; then echo "$k"; return 0; fi; done; return 1; }
ag_arayuz_var() {
  local s ad
  while IFS= read -r s; do
    case "$s" in *:*) ad="${s%%:*}"; ad="${ad//[[:space:]]/}"; [ "$ad" = "$1" ] && return 0 ;; esac
  done 2>/dev/null < "$PROC/net/dev"
  return 1
}
ag_hazirla() {   # AG_ARAYUZ (bos = lo disi her arayuz), AG_SECIM (neden), AG_HIZ (Mbps; /sys/class/net/<if>/speed > 0 ise)
  local ipk d="" v=""
  if [ ! -r "$PROC/net/dev" ]; then AG_SECIM="olculemedi(net_dev_okunamadi)"; return 0; fi
  AG_ACIK=1
  if [ -z "$HEDEF_IP_OK" ]; then AG_SECIM="lo_disi_toplam(hedef_ip_yok)"; return 0; fi
  if ! ipk="$(ag_ip_komutu)"; then AG_SECIM="lo_disi_toplam(ip_komutu_yok)"; return 0; fi
  d="$(ag_arayuz_bul "$ipk")"
  if [ -z "$d" ]; then AG_SECIM="lo_disi_toplam(arayuz_bulunamadi)"; return 0; fi
  if [ "$d" = lo ]; then AG_SECIM="lo_disi_toplam(hedef_ip_lo_uzerinde)"; return 0; fi
  if ! [[ "$d" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || ! ag_arayuz_var "$d"; then AG_SECIM="lo_disi_toplam(arayuz_net_dev_de_yok)"; return 0; fi
  AG_ARAYUZ="$d"; AG_SECIM="$AG_SECIM_ADI"
  IFS= read -r v 2>/dev/null < "$SYS/class/net/$d/speed" || v=""
  if [[ "$v" =~ ^[0-9]{1,7}$ ]] && [ "$v" -gt 0 ]; then AG_HIZ="$v"; fi
  return 0
}
ag_maliyet_yaz() {   # 2026-11-04 (bilgi): kaydedicinin kendi CPU'su (utime+stime+cutime+cstime, /proc/$$/stat) ve suresi ag txt'ye
  local s ms=""
  [ -f "$AG_TXT" ] || return 0
  IFS= read -r s 2>/dev/null < "/proc/$$/stat" || s=""
  s="${s##*) }"
  set -f; set -- $s; set +f
  if [ "$#" -ge 15 ] && [[ "${12}${13}${14}${15}" =~ ^[0-9]+$ ]]; then ms=$(( (${12} + ${13} + ${14} + ${15}) * 1000 / CLK )); fi
  { echo "kaydedici_cpu_ms=$ms"; echo "kaydedici_sure_sn=$(( $(simdi) - BAS_EPOCH ))"; } >> "$AG_TXT"
}
ag_bilgi_yaz() {   # ag_<TABAN>.txt (anahtar=deger) + ag_<TABAN>.csv basligi (yalniz /proc/net/dev okunabiliyorsa)
  local x
  {
    echo "surum=1"; echo "rol=$AG_ROL"; echo "host=$HOSTK"; echo "secim=$AG_SECIM"; echo "arayuz=$AG_ARAYUZ"; echo "hiz_mbps=$AG_HIZ"
    echo "arayuz_siniri=$AG_MAX"
    for x in "$@"; do echo "$x"; done
  } > "$AG_TXT"
  if [ "$AG_ACIK" = 1 ]; then echo "epoch,arayuz,rx_bayt,tx_bayt" > "$AG_CSV"; fi
}
ag_al() {   # $1 epoch: secili arayuz (yoksa lo disi en cok AG_MAX arayuz) icin bir satir; sayac sarmasi Portal'da
  local t="$1" s ad r n=0 satir=""
  [ "$AG_ACIK" = 1 ] || return 0
  while IFS= read -r s; do
    case "$s" in *:*) ;; *) continue ;; esac
    ad="${s%%:*}"; ad="${ad//[[:space:]]/}"; r="${s#*:}"
    if [ -n "$AG_ARAYUZ" ]; then
      [ "$ad" = "$AG_ARAYUZ" ] || continue
    else
      [ "$ad" != lo ] || continue
      n=$((n + 1)); [ "$n" -le "$AG_MAX" ] || break
    fi
    [[ "$ad" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || continue
    set -f; set -- $r; set +f
    [ "$#" -ge 9 ] && [[ "$1" =~ ^[0-9]{1,20}$ ]] && [[ "$9" =~ ^[0-9]{1,20}$ ]] || continue
    satir="$satir$t,$ad,$1,$9"$'\n'
  done 2>/dev/null < "$PROC/net/dev"
  [ -z "$satir" ] || printf '%s' "$satir" >> "$AG_CSV"
}
# --- 2026-11-03 bellek ayrisimi (YALNIZ BILGI): worker Anon / Shmem / File / Pss toplami, master, baglanti sayisi ------
BAG_SS=""; BAG_SS_KIP="-tn"
baglanti_hazirla() {
  local k
  [[ "$HEDEF_PORT" =~ ^[0-9]{1,5}$ ]] || return 0
  for k in ss /usr/sbin/ss /sbin/ss; do if command -v "$k" >/dev/null 2>&1; then BAG_SS="$k"; break; fi; done
  [ -n "$BAG_SS" ] || return 0
  "$BAG_SS" -Htn state established >/dev/null 2>&1 && BAG_SS_KIP="-Htn"
  return 0
}
baglanti_say() {   # HEDEF_IP:HEDEF_PORT (IP yoksa yalniz port) ESTABLISHED sayisi; ss yok / hata: bos
  local o
  [ -n "$BAG_SS" ] || return 0
  if [ -n "$HEDEF_IP_OK" ]; then
    o="$("$BAG_SS" "$BAG_SS_KIP" state established src "$HEDEF_IP:$HEDEF_PORT" 2>/dev/null)" || return 0
  else
    o="$("$BAG_SS" "$BAG_SS_KIP" state established "( sport = :$HEDEF_PORT )" 2>/dev/null)" || return 0
  fi
  printf '%s\n' "$o" | awk 'NF && $1 != "State" && $1 != "Recv-Q" && $1 != "Netid" { n++ } END { print n + 0 }'
}
bdetay_al() {   # $1 epoch. kB; RssAnon/RssShmem/RssFile hic okunamazsa bos (RHEL 7 cekirdegi yok); Pss bir worker'da okunamazsa bos
  local p k v _ an=0 sh=0 dos=0 ps=0 var=0 pok=1 isci=0 mr="" mp="" bg
  for p in ${IP//+/ }; do
    [[ "$p" =~ ^[0-9]+$ ]] || continue
    isci=1
    while read -r k v _; do
      case "$k" in
        RssAnon:) if [[ "$v" =~ ^[0-9]+$ ]]; then an=$((an + v)); var=1; fi ;;
        RssFile:) if [[ "$v" =~ ^[0-9]+$ ]]; then dos=$((dos + v)); fi ;;
        RssShmem:) if [[ "$v" =~ ^[0-9]+$ ]]; then sh=$((sh + v)); fi; break ;;
      esac
    done 2>/dev/null < "$PROC/$p/status"
    v=""
    while read -r k v _; do [ "$k" = "Pss:" ] && break; v=""; done 2>/dev/null < "$PROC/$p/smaps_rollup"
    if [[ "$v" =~ ^[0-9]+$ ]]; then ps=$((ps + v)); else pok=0; fi
  done
  [ "$var" = 1 ] || { an=""; sh=""; dos=""; }
  [ "$pok" = 1 ] && [ "$isci" = 1 ] || ps=""
  while read -r k v _; do
    if [ "$k" = "VmRSS:" ]; then [[ "$v" =~ ^[0-9]+$ ]] && mr="$v"; break; fi
  done 2>/dev/null < "$PROC/$MASTER/status"
  v=""
  while read -r k v _; do [ "$k" = "Pss:" ] && break; v=""; done 2>/dev/null < "$PROC/$MASTER/smaps_rollup"
  [[ "$v" =~ ^[0-9]+$ ]] && mp="$v"
  bg="$(baglanti_say)"
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$1" "$IN" "$IK" "$an" "$sh" "$dos" "$ps" "$mr" "$mp" "$bg" >> "$BDETAY"
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
echo "epoch,nginx_rss_kb,isci_sayi,mem_total_kb,mem_available_kb" > "$BELLEK"
ag_hazirla; baglanti_hazirla
ag_bilgi_yaz "baglanti_olcer=${BAG_SS:+ss}" "hedef_port=$HEDEF_PORT"
echo "epoch,isci_sayi,kapanan_sayi,anon_kb,shmem_kb,file_kb,pss_kb,master_rss_kb,master_pss_kb,baglanti" > "$BDETAY"
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
  ag_maliyet_yaz
  echo
  echo "== cpu_kaydedici ozeti ($ADIM, $HOSTK)"
  echo "   ornek=$NORNEK  test_satiri=$TEST  diger_satiri=$DIGERN  bozuk=$BOZUK  worker=$ISCI_BAS->$IN"
  [ "$PID_BAS" = "$IP" ] || echo "   NOT: worker PID kumesi kayit sirasinda degisti (reload) - o andaki kosular GECERSIZ sayilir."
  for x in ${UYARI[@]+"${UYARI[@]}"}; do echo "   UYARI: $x"; done
  for x in ${GECERSIZ[@]+"${GECERSIZ[@]}"}; do echo "   GECERSIZ: $x"; done
  echo "   dosyalar: $CSV"
  echo "             $LOGTSV  $DIGER  $BILGI  $KONF  $BELLEK"
  echo "             $AG_TXT  $BDETAY$([ "$AG_ACIK" = 1 ] && echo "  $AG_CSV")  (ag: $AG_SECIM${AG_ARAYUZ:+ $AG_ARAYUZ})"
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
