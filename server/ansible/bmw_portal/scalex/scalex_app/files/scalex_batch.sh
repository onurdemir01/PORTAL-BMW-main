# ScaleX TOPLU KESIF SARMALAYICISI — jump sunucusu basina TEK SSH turu.
#
# ── NEDEN (AWX 3365168/3365181/3365188, 2026-09-30) ────────────────────────
# Runner cluster basina 3-8 sn surerken is 40+ sn suruyordu. Fark SSH modul
# turlariydi: cluster BASINA copy + launch + async_status + remove = 3 cluster
# icin ~12 tur, her biri ~2-3 sn. Bu betik hepsini TEK tura indirir:
#   * runner STDIN ile gelir (ayri copy/remove turu yok),
#   * cluster'lar burada, arka planda AYNI ANDA kosar,
#   * `wait` ile beklenir — async yoklamasi yok.
#
# `/bin/bash -c` ile kosar (Ansible `shell` gorevinin `cmd`i). Kendi basina
# calistirilabilir bir betik DEGIL: satirlar ortamdan beslenir.
#
# GIRDI (ortam):
#   SCALEX_BATCH_IDX      bu jump'taki cluster'larin sira numaralari ("0 2")
#   SCALEX_BATCH_TIMEOUT  cluster basina saniye butcesi (async butcesinin aynisi)
#   SCALEX_T<i>_*         cluster'a ozgu degerler; runner'a AYNI ADLA ama
#                         onek-siz verilir. Diger cluster'larin degerleri (parola
#                         dahil) runner'in ortamindan SILINIR.
#   ortak degiskenler     (NS, APP_RAW, ...) oldugu gibi gecer.
#   SCALEX_BATCH_KEYS     (ops.) cluster'a ozgu anahtar listesi; yoksa kesifinki.
#                         Precheck/execute (12_run_phase_batch.yml) kendi
#                         listesini verir (APP_RAW, WORKLOAD_KINDS cluster'a ozgu).
#   SCALEX_BATCH_LABEL    (ops.) FAIL metninin oznesi: "Discovery" (varsayilan)
#                         ya da "Runner" — her yolun ESKI metniyle ayni kalsin.
#
# CIKTI: her cluster icin, sirayla, runner'in satirlari. Basarisizlik satirlari
# BURADA yazilir ve metni eski paralel yolunkiyle (10_discover_parallel.yml)
# AYNIDIR:
#   rc != 0      -> RUNNER;FAIL;<LABEL> could not complete ... (rc=N: stderr)
#                   (zaman asimi: rc=124)
#   satir yok    -> RUNNER;FAIL;<LABEL> returned no structured result rows
# Her cluster'in sonunda `__SCALEX_DONE__;<cluster>` yazilir: bu isaret
# gelmediyse (sarmalayici oldurulduyse, SSH koptuysa) Ansible o cluster'i
# tasima hatasi sayar. Isaret 7 alanli satir bicimine UYMAZ, satir sayilmaz.
#
# PAROLA ARGV'DE YOK: yalnizca ortamda durur; `timeout` ve `bash` argumanlari
# yalnizca dosya yolu.
set -u
PER_CLUSTER_KEYS="CLUSTER JUMP_SERVER API_URL OCP_PASSWORD OCP_OC_PATHS TLS_VERIFY SCALEX_EXTRA_KINDS SCALEX_EXTRA_KINDS_SCANNED"
PER_CLUSTER_KEYS="${SCALEX_BATCH_KEYS:-$PER_CLUSTER_KEYS}"
LABEL="${SCALEX_BATCH_LABEL:-Discovery}"
ROW_RE='^[^;]*;[^;]*;[^;]*;[^;]*;[^;]*;[^;]*;'

# Gecici dizin: `/tmp` NOEXEC olabilir (AWX 3365082) — betik yalnizca OKUNUR
# (`/bin/bash <dosya>`), calistirma biti gerekmez.
d="$(mktemp -d "${TMPDIR:-/tmp}/scalex_batch_XXXXXX" 2>/dev/null)" || d=""
if [ -z "$d" ]; then
  echo "scalex_batch: gecici dizin kurulamadi" >&2
  exit 3
fi
trap 'rm -rf "$d"' EXIT
# Sonlandirilirsa (AWX iptali, SSH kopmasi): cocuklar da durur, dizin silinir.
# Isleyicisiz bir sinyal EXIT tuzagini CALISTIRMAZ; bu yuzden acikca `exit`.
trap 'kill $(jobs -p) 2>/dev/null; exit 143' TERM INT HUP
chmod 700 "$d"
umask 077
cat >"$d/runner.sh"

t="${SCALEX_BATCH_TIMEOUT:-900}"
for i in $SCALEX_BATCH_IDX; do
  (
    for k in $PER_CLUSTER_KEYS; do
      v="SCALEX_T${i}_${k}"
      export "$k=${!v-}"
    done
    # Diger cluster'larin degerleri (parolalar) bu runner'a SIZMASIN.
    for v in $(compgen -e); do
      case "$v" in SCALEX_T[0-9]*) unset "$v" ;; esac
    done
    unset SCALEX_BATCH_IDX SCALEX_BATCH_TIMEOUT SCALEX_BATCH_KEYS SCALEX_BATCH_LABEL
    # Arka planda + `wait`: alt kabuk sinyal alinca `timeout`u (o da runner'i)
    # oldurebilsin. On planda kosan cocuk, alt kabuk olunce OKSUZ kalip
    # cluster'a `oc` cagirmaya devam ediyordu (mutasyon turunda olculdu).
    timeout "$t" /bin/bash "$d/runner.sh" >"$d/out.$i" 2>"$d/err.$i" &
    tp=$!
    trap 'kill "$tp" 2>/dev/null; exit 143' TERM INT HUP
    rc=0
    wait "$tp" || rc=$?
    printf '%s' "$rc" >"$d/rc.$i"
  ) &
done
wait

for i in $SCALEX_BATCH_IDX; do
  c_var="SCALEX_T${i}_CLUSTER"; j_var="SCALEX_T${i}_JUMP_LABEL"
  c="${!c_var-}"; j="${!j_var-}"
  rc="$(cat "$d/rc.$i" 2>/dev/null || echo 255)"
  cat "$d/out.$i" 2>/dev/null
  if [ "$rc" != "0" ]; then
    sebep="$(tr '\n' '\t' <"$d/err.$i" 2>/dev/null | awk '{ gsub(/[;\r\t]+/, " "); sub(/^[ ]+/, ""); sub(/[ ]+$/, ""); printf "%s", substr($0, 1, 200) }')"
    printf '%s;%s;-;-;RUNNER;FAIL;%s could not complete because of SSH/transport/shell/runtime failure (rc=%s: %s)\n' "$c" "$j" "$LABEL" "$rc" "$sebep"
  elif ! grep -Eq "$ROW_RE" "$d/out.$i" 2>/dev/null; then
    printf '%s;%s;-;-;RUNNER;FAIL;%s returned no structured result rows\n' "$c" "$j" "$LABEL"
  fi
  printf '__SCALEX_DONE__;%s\n' "$c"
done
exit 0
