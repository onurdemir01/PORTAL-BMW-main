#!/bin/bash
# yuk_cpu_kaydedici.sh - Portal Nginx Hub "Yuk Testi": kosu boyunca YUK MAKINESININ toplam CPU'sunu saniyede bir kaydeder.
# Amac    : yuk makinesi doydu mu (bosta CPU dusuk mu)? Portal adim basina bosta CPU ortalamasini hesaplar; %20'nin
#           altinda adim YUK_DOYDU isaretlenir (sonuc hedefin degil yuk makinesinin sinirini gosterebilir).
# Kullanim: SONUC=<dizin> [SURE=<sn>] [ARALIK=1] ./yuk_cpu_kaydedici.sh <ADIM>     TERM / INT ile biter (ya da SURE ile).
# Ortam   : SONUC(./sonuc) SURE(0 = sinirsiz) ARALIK(1) ARAC_DIZIN(<SONUC'un ust dizini>/arac) PROC_ROOT(/proc; sinama)
#           ROL(yuk|hedef; varsayilan yuk) BOSTA_BAS(0; sn, bos ornek suresi)
# 2026-11-13 ROL=hedef: nginx'i OLMAYAN sunucu hedefinde (on_kontrol.sh nginx -> nginx_var 0; ornegin Apache; www,
#           yalniz /proc okunur). Playbook SONUC=<kosu dizini> verir: dosyalar <kosu dizini>/R<id>'ye (Play 5 toplar). Onek
#           hedefcpu_ (hedefcpu_<ADIM>_<host>.csv ayni kolonlar, arac_rss_kb hep bos; .txt'ye ek rol=hedef bosta_bas),
#           ag_*.txt rol=hedef secim=hedef_ip (arayuz: HEDEF_IP'nin atali oldugu arayuz, 'ip -o -4 addr'), arac aranmaz.
#           ROL=hedef ya da BOSTA_BAS > 0 iken BOSTA_BAS sn sonra bir kez '>>> ... YUKU SIMDI BASLATIN' basilir (playbook
#           bunu bekler). Varsayilanlarla (ROL=yuk, BOSTA_BAS=0) cikti eskisiyle BIREBIR ayni.
# Portal  : Portal'a ozgu (el kitinde yok). SALT OKUNUR: yalniz /proc/stat okur; nginx, dzdo, root gerekmez (www).
#           cpu_kaydedici.sh yeniden kullanilmaz: o nginx master ve LOGDIR ister, sunucu_*/bilgi_* adlari da eski
#           Portal'da ikinci hedef kesiti sayilir. Buradaki yukcpu_ oneki hicbir eski Portal desenine uymaz.
# Dosyalar: $SONUC/<ADIM>/yukcpu_<ADIM>_<host>.csv (epoch,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,
#           cpu_softirq,cpu_steal; /proc/stat ilk 'cpu' satiri, tik; 2026-11-03 bellek: mem_total_kb,mem_available_kb
#           (/proc/meminfo), arac_rss_kb (argv0'i ARAC_DIZIN/ ile baslayan k6 / wrk surecinin VmRSS'i; yoksa bos)) ve
#           bitiste yukcpu_<ADIM>_<host>.txt (surum=1 host nproc clk_tck bas_epoch bit_epoch ornek_sayisi; anahtar=deger).
#           Arac sureci her ornekte aranmaz: bulunan pid canli kaldikca kullanilir, yoksa en cok 5 sn'de bir /proc taranir.
#           2026-11-03 (bant genisligi, YALNIZ BILGI): ag_<ADIM>_<host>.csv (epoch,arayuz,rx_bayt,tx_bayt; /proc/net/dev
#           kumulatif) + ag_<ADIM>_<host>.txt (rol=yuk, secim, arayuz, hiz_mbps). Arayuz: 'ip route get <HEDEF_IP>' -> dev;
#           bulunamazsa lo disi her arayuz (en cok 32; secim= nedenini yazar). Ortam: HEDEF_IP (Portal verir), SYS_ROOT
#           (/sys; sinama). yukcpu_*.csv semasi DEGISMEZ; ag_ oneki hicbir eski Portal desenine uymaz. 2026-11-04: ornek
#           epoch'u bash < 5'te de kesirli (date +%s.%N); bitiste ag txt'ye kaydedici_cpu_ms ve kaydedici_sure_sn.
set -u
export LC_ALL=C
kullanim() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
hata() { echo "HATA: $*" >&2; exit 2; }

[ $# -eq 1 ] || kullanim
case "$1" in -h|--help) kullanim ;; esac
ADIM="$1"
[[ "$ADIM" =~ ^[A-Za-z0-9-]+$ ]] || hata "ADIM yalniz harf, rakam ve - icerebilir (alt cizgi YOK): '$ADIM'"
SONUC="${SONUC:-./sonuc}"; SURE="${SURE:-0}"; ARALIK="${ARALIK:-1}"
ARAC_DIZIN="${ARAC_DIZIN:-$(dirname -- "$SONUC")/arac}"
PROC="${PROC_ROOT:-/proc}"
[[ "$SURE" =~ ^[0-9]{1,6}$ ]] || hata "SURE tam sayi (saniye) olmali"
[[ "$ARALIK" =~ ^[0-9]+([.][0-9]+)?$ ]] || hata "ARALIK saniye olmali"
ROL="${ROL:-yuk}"; BOSTA_BAS="${BOSTA_BAS:-0}"
case "$ROL" in yuk) ONEK=yukcpu ;; hedef) ONEK=hedefcpu ;; *) hata "ROL yuk ya da hedef olmali: '$ROL'" ;; esac
[[ "$BOSTA_BAS" =~ ^[0-9]{1,4}$ ]] || hata "BOSTA_BAS tam sayi (saniye) olmali"
[ -r "$PROC/stat" ] || hata "$PROC/stat okunamiyor"

HOSTK="$(hostname -s 2>/dev/null || uname -n)"; HOSTK="$(printf '%s' "${HOSTK%%.*}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
OUT="$SONUC/$ADIM"
mkdir -p "$OUT" || hata "dizin olusturulamadi: $OUT"
TABAN="${ADIM}_${HOSTK}"
CSV="$OUT/${ONEK}_${TABAN}.csv"; BILGI="$OUT/${ONEK}_${TABAN}.txt"
AG_CSV="$OUT/ag_${TABAN}.csv"; AG_TXT="$OUT/ag_${TABAN}.txt"; SYS="${SYS_ROOT:-/sys}"
HEDEF_IP_OK=""; [[ "${HEDEF_IP:-}" =~ ^[0-9]{1,3}([.][0-9]{1,3}){3}$ ]] && HEDEF_IP_OK=1
CLK="$(getconf CLK_TCK 2>/dev/null)"; [[ "$CLK" =~ ^[0-9]+$ ]] || CLK=100
NPROC="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
simdi() { if [ -n "${EPOCHSECONDS:-}" ]; then echo "$EPOCHSECONDS"; else date +%s; fi; }
BAS_EPOCH="$(simdi)"
NORNEK=0
ARAC_PID=""; ARAC_TARAMA=0

# --- 2026-11-03 ag (bant genisligi, YALNIZ BILGI): /proc/net/dev kumulatif rx/tx baytlari ---------------------------
ag_arayuz_bul() {   # yuk makinesi: hedefe giden yolun arayuzu (ip route get <HEDEF_IP> -> dev)
  "$1" route get "$HEDEF_IP" 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
}
AG_ROL=yuk; AG_SECIM_ADI=ip_route
if [ "$ROL" = hedef ]; then
  ag_arayuz_bul() {   # CPU olculen hedef: HEDEF_IP'nin atali oldugu arayuz (cpu_kaydedici.sh ile ayni; vlan 'x@y' -> x)
    "$1" -o -4 addr show 2>/dev/null | awk -v ip="$HEDEF_IP" '{ for (i = 1; i < NF; i++) if ($i == "inet") { split($(i + 1), a, "/"); if (a[1] == ip) { d = $2; sub(/@.*/, "", d); sub(/:$/, "", d); print d; exit } } }'
  }
  AG_ROL=hedef; AG_SECIM_ADI=hedef_ip
fi
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
arac_mi() {   # argv0 ARAC_DIZIN/ ile mi basliyor (kos.sh ve wrk_kos.sh araci tam yoluyla calistirir)
  local c=""
  IFS= read -r -d '' c 2>/dev/null < "$PROC/$1/cmdline"
  case "$c" in "$ARAC_DIZIN"/*) return 0 ;; esac
  return 1
}
arac_bul() {   # ARAC_PID: onceki pid hala arac ise o; degilse en cok 5 sn'de bir /proc taranir (her ornekte degil)
  local f p s
  if [ -n "$ARAC_PID" ] && arac_mi "$ARAC_PID"; then return 0; fi
  ARAC_PID=""
  s="$(simdi)"
  [ $((s - ARAC_TARAMA)) -ge 5 ] || return 0
  ARAC_TARAMA="$s"
  for f in "$PROC"/[0-9]*; do
    p="${f##*/}"
    if arac_mi "$p"; then ARAC_PID="$p"; return 0; fi
  done
}
ornek_al() {
  local t ad cu cn cs ci cw cq csq cst k v _ mt="" ma="" ar=""
  # 2026-11-04: bash < 5 (RHEL 7/8; EPOCHREALTIME yok) de kesirli epoch (date +%s.%N; ayni tek fork): tam saniyede ardisik ornek
  # farki 1 sn sayilip gercekte 1,4 sn olabiliyordu (NIC tepesi / kullanim % sisiyordu). %N yoksa eskisi gibi tam saniye.
  t="${EPOCHREALTIME:-}"; [ -n "$t" ] || t="$(date +%s.%N 2>/dev/null)"; [[ "$t" =~ ^[0-9]+([.][0-9]+)?$ ]] || t="$(date +%s)"
  read -r ad cu cn cs ci cw cq csq cst _ < "$PROC/stat" || return 0
  [ "$ad" = cpu ] || return 0
  while read -r k v _; do
    case "$k" in MemTotal:) mt="$v" ;; MemAvailable:) ma="$v" ;; esac
    [ -n "$mt" ] && [ -n "$ma" ] && break
  done 2>/dev/null < "$PROC/meminfo"
  [[ "$mt" =~ ^[0-9]+$ ]] || mt=""; [[ "$ma" =~ ^[0-9]+$ ]] || ma=""
  [ "$ROL" = hedef ] || arac_bul
  if [ -n "$ARAC_PID" ]; then
    while read -r k v _; do
      if [ "$k" = "VmRSS:" ]; then [[ "$v" =~ ^[0-9]+$ ]] && ar="$v"; break; fi
    done 2>/dev/null < "$PROC/$ARAC_PID/status"
  fi
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$t" "${cu:-0}" "${cn:-0}" "${cs:-0}" "${ci:-0}" "${cw:-0}" "${cq:-0}" "${csq:-0}" \
    "${cst:-0}" "$mt" "$ma" "$ar" >> "$CSV"
  NORNEK=$((NORNEK + 1))
  ag_al "$t"
}

BITTI=0
bitir() {
  trap '' INT TERM
  [ "$BITTI" = 1 ] && return
  BITTI=1
  ornek_al
  {
    echo "surum=1"; echo "adim=$ADIM"; echo "host=$HOSTK"; echo "nproc=$NPROC"; echo "clk_tck=$CLK"
    echo "bas_epoch=$BAS_EPOCH"; echo "bit_epoch=$(simdi)"; echo "ornek_sayisi=$NORNEK"
    if [ "$ROL" = hedef ]; then echo "rol=hedef"; echo "bosta_bas=$BOSTA_BAS"; fi
  } > "$BILGI"
  ag_maliyet_yaz
  echo "== yuk_cpu_kaydedici ozeti ($ADIM, $HOSTK): ornek=$NORNEK dosyalar: $CSV $BILGI $AG_TXT (ag: $AG_SECIM${AG_ARAYUZ:+ $AG_ARAYUZ})"
  exit 0
}
# Baslik trap'ten ONCE: TERM bu araliga duserse dosya ya hic yok ya da basliktir (basliksiz CSV kalmaz).
echo "epoch,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal,mem_total_kb,mem_available_kb,arac_rss_kb" > "$CSV" || hata "yazilamadi: $CSV"
ag_hazirla
ag_bilgi_yaz
trap bitir INT TERM
echo "== yuk_cpu_kaydedici: adim=$ADIM host=$HOSTK nproc=$NPROC clk_tck=$CLK cikti=$CSV"
BAS="$(simdi)"
DUYUR=0; DUYURULDU=0
if [ "$ROL" = hedef ] || [ "$BOSTA_BAS" -gt 0 ]; then DUYUR=1; fi
while :; do
  ornek_al
  if [ "$DUYUR" = 1 ] && [ "$DUYURULDU" = 0 ] && [ $(( $(simdi) - BAS )) -ge "$BOSTA_BAS" ]; then
    DUYURULDU=1
    echo ">>> $(date '+%H:%M:%S') bos ornek tamam: YUKU SIMDI BASLATIN (rol=$ROL adim=$ADIM)"
  fi
  if [ "$SURE" -gt 0 ] && [ $(( $(simdi) - BAS )) -ge "$SURE" ]; then bitir; fi
  sleep "$ARALIK" &
  wait $! 2>/dev/null || :
done
