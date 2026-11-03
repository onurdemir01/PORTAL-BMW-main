#!/bin/bash
# yuk_cpu_kaydedici.sh - Portal Nginx Hub "Yuk Testi": kosu boyunca YUK MAKINESININ toplam CPU'sunu saniyede bir kaydeder.
# Amac    : yuk makinesi doydu mu (bosta CPU dusuk mu)? Portal adim basina bosta CPU ortalamasini hesaplar; %20'nin
#           altinda adim YUK_DOYDU isaretlenir (sonuc hedefin degil yuk makinesinin sinirini gosterebilir).
# Kullanim: SONUC=<dizin> [SURE=<sn>] [ARALIK=1] ./yuk_cpu_kaydedici.sh <ADIM>     TERM / INT ile biter (ya da SURE ile).
# Ortam   : SONUC(./sonuc) SURE(0 = sinirsiz) ARALIK(1) ARAC_DIZIN(<SONUC'un ust dizini>/arac) PROC_ROOT(/proc; sinama)
# Portal  : Portal'a ozgu (el kitinde yok). SALT OKUNUR: yalniz /proc/stat okur; nginx, dzdo, root gerekmez (www).
#           cpu_kaydedici.sh yeniden kullanilmaz: o nginx master ve LOGDIR ister, sunucu_*/bilgi_* adlari da eski
#           Portal'da ikinci hedef kesiti sayilir. Buradaki yukcpu_ oneki hicbir eski Portal desenine uymaz.
# Dosyalar: $SONUC/<ADIM>/yukcpu_<ADIM>_<host>.csv (epoch,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,
#           cpu_softirq,cpu_steal; /proc/stat ilk 'cpu' satiri, tik; 2026-11-03 bellek: mem_total_kb,mem_available_kb
#           (/proc/meminfo), arac_rss_kb (argv0'i ARAC_DIZIN/ ile baslayan k6 / wrk surecinin VmRSS'i; yoksa bos)) ve
#           bitiste yukcpu_<ADIM>_<host>.txt (surum=1 host nproc clk_tck bas_epoch bit_epoch ornek_sayisi; anahtar=deger).
#           Arac sureci her ornekte aranmaz: bulunan pid canli kaldikca kullanilir, yoksa en cok 5 sn'de bir /proc taranir.
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
[ -r "$PROC/stat" ] || hata "$PROC/stat okunamiyor"

HOSTK="$(hostname -s 2>/dev/null || uname -n)"; HOSTK="$(printf '%s' "${HOSTK%%.*}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-')"
OUT="$SONUC/$ADIM"
mkdir -p "$OUT" || hata "dizin olusturulamadi: $OUT"
TABAN="${ADIM}_${HOSTK}"
CSV="$OUT/yukcpu_${TABAN}.csv"; BILGI="$OUT/yukcpu_${TABAN}.txt"
CLK="$(getconf CLK_TCK 2>/dev/null)"; [[ "$CLK" =~ ^[0-9]+$ ]] || CLK=100
NPROC="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
simdi() { if [ -n "${EPOCHSECONDS:-}" ]; then echo "$EPOCHSECONDS"; else date +%s; fi; }
BAS_EPOCH="$(simdi)"
NORNEK=0
ARAC_PID=""; ARAC_TARAMA=0

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
  t="${EPOCHREALTIME:-}"; [ -n "$t" ] || t="$(date +%s)"
  read -r ad cu cn cs ci cw cq csq cst _ < "$PROC/stat" || return 0
  [ "$ad" = cpu ] || return 0
  while read -r k v _; do
    case "$k" in MemTotal:) mt="$v" ;; MemAvailable:) ma="$v" ;; esac
    [ -n "$mt" ] && [ -n "$ma" ] && break
  done 2>/dev/null < "$PROC/meminfo"
  [[ "$mt" =~ ^[0-9]+$ ]] || mt=""; [[ "$ma" =~ ^[0-9]+$ ]] || ma=""
  arac_bul
  if [ -n "$ARAC_PID" ]; then
    while read -r k v _; do
      if [ "$k" = "VmRSS:" ]; then [[ "$v" =~ ^[0-9]+$ ]] && ar="$v"; break; fi
    done 2>/dev/null < "$PROC/$ARAC_PID/status"
  fi
  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$t" "${cu:-0}" "${cn:-0}" "${cs:-0}" "${ci:-0}" "${cw:-0}" "${cq:-0}" "${csq:-0}" \
    "${cst:-0}" "$mt" "$ma" "$ar" >> "$CSV"
  NORNEK=$((NORNEK + 1))
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
  } > "$BILGI"
  echo "== yuk_cpu_kaydedici ozeti ($ADIM, $HOSTK): ornek=$NORNEK dosyalar: $CSV $BILGI"
  exit 0
}
# Baslik trap'ten ONCE: TERM bu araliga duserse dosya ya hic yok ya da basliktir (basliksiz CSV kalmaz).
echo "epoch,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal,mem_total_kb,mem_available_kb,arac_rss_kb" > "$CSV" || hata "yazilamadi: $CSV"
trap bitir INT TERM
echo "== yuk_cpu_kaydedici: adim=$ADIM host=$HOSTK nproc=$NPROC clk_tck=$CLK cikti=$CSV"
BAS="$(simdi)"
while :; do
  ornek_al
  if [ "$SURE" -gt 0 ] && [ $(( $(simdi) - BAS )) -ge "$SURE" ]; then bitir; fi
  sleep "$ARALIK" &
  wait $! 2>/dev/null || :
done
