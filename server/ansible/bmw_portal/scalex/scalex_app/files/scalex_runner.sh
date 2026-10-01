#!/bin/bash
set -u
set -o pipefail
set +x
umask 077

# ── PAKET SURUMU ────────────────────────────────────────────────────────────
# Bu paket AWX'e ELLE kopyalaniyor ve portal calisan surumu goremiyordu. Ekran
# "playbook'un guncel surumu kopyalanmamis olabilir" diye TAHMIN ediyordu; artik
# calistirici surumu bildiriyor ve portal kendi bekledigi surumle karsilastirip
# SOYLUYOR. Bu dosya `scalex_app/VERSION` ile ayni sayiyi tasimali (test kilitler).
PACKAGE_VERSION="24"

PHASE="${SCALEX_PHASE:-${CHAOS_PHASE:-precheck}}"
CLUSTER="${CLUSTER:-}"
JUMP_SERVER="${JUMP_SERVER:-}"
API_URL="${API_URL:-}"
OCP_USERNAME="${OCP_USERNAME:-}"
OCP_PASSWORD="${OCP_PASSWORD:-}"
OCP_OC_PATHS="${OCP_OC_PATHS:-/bin/oc:/usr/local/bin/oc:/usr/bin/oc}"
NS="${NS:-}"
APP_RAW="${APP_RAW:-}"
ACTION="${ACTION:-}"
TARGET="${TARGET:-}"
REQUESTED_KIND="${WORKLOAD_KIND:-auto}"
# UYGULAMA BASINA TIP HARITASI: "kafka=sts,odeme-api=deploy".
# Portal kesifte her uygulamanin tipini ZATEN biliyor; artik gonderiyor. Boylece
# `auto` taramasinin "ayni ad hem Deployment hem DeploymentConfig olarak var" halinde
# `ambiguous` deyip isi dusurmesi ortadan kalkiyor — kullaniciya yeni bir adim
# eklemeden. Bos birakilirsa bugunku `auto` davranisi AYNEN surer.
WORKLOAD_KINDS_MAP="${WORKLOAD_KINDS:-}"
# ── DOGRULAMA SURELERI ───────────────────────────────────────────────────────
#
# KULLANICI KARARI (2026-09-17):
#   ACMA  (target > 0): 5 dk dolunca BEKLEMEYI BIRAK, UYARI yaz, is BASARILI bitsin.
#                       ("aciliyor, 0/1, 5 dk'dir" — replica degisikligi zaten uygulandi)
#   KAPATMA (target = 0): 5 dk'da UYARI yaz ama BEKLEMEYE DEVAM et; 10 dk'da FAIL.
#                       ("scale 0 calisti ama 0 olmasi 5 dk'yi gecti")
#
# `WAIT_ATTEMPTS`/`WAIT_SECONDS` GERIYE UYUM icin duruyor: eski bir AWX surumu ya da
# elle calistirma bunlari gonderirse butce onlardan turetilir. Portal artik saniye
# cinsinden butce gonderiyor.
VERIFY_WARN_SECONDS="${VERIFY_WARN_SECONDS:-300}"
VERIFY_FAIL_SECONDS="${VERIFY_FAIL_SECONDS:-600}"
WAIT_ATTEMPTS="${WAIT_ATTEMPTS:-30}"
WAIT_SECONDS="${WAIT_SECONDS:-2}"
JOB_ID="${JOB_ID:-N/A}"
CREATED_BY="${CREATED_BY:-${OCP_USERNAME:-unknown}}"
TLS_VERIFY="${TLS_VERIFY:-false}"
SCALE_WARN_THRESHOLD="${SCALE_WARN_THRESHOLD:-100}"
# HPA SABITLEME. Varsayilan KAPALI ve oyle kalmali: bu otomasyonun kurucu ilkesi
# "HPA okunur, ASLA degistirilmez" idi. Portal bu bayragi YALNIZCA kullanici ekranda
# acikca isaretlediginde ve yalnizca `stop` DISI islemlerde gonderir (replica 0'da HPA
# zaten devre disi kalir ve `minReplicas: 0` API tarafindan reddedilir).
HPA_PIN="${HPA_PIN:-false}"
# KESIF FAZI. Ayri bir betik YAZILMADI: oturum acma, `oc` yolu bulma, kubeconfig
# hazirlama ve satir bicimi bu dosyada zaten var; ikinci bir kopya, birinde yapilan
# duzeltmenin digerinde sessizce eskimesi demekti (bu depoda tam olarak bu yasandi).
# Kesif HICBIR MUTASYON YAPMAZ — yalnizca `oc get` ve `oc auth can-i`.
DISCOVERY_MODE="${DISCOVERY_MODE:-workloads}"
WORKDIR=""
KUBECONFIG_FILE=""

# ── SATIR BASMA YOLUNDA ALT KABUK YOK ───────────────────────────────────────
#
# OLCULDU (AWX 3365168/81/88, 2026-09-30): 19 uygulamalik kesif 1 uygulamalikten
# ~3,5 sn uzun suruyordu. Sebep `oc` degil, satir basina acilan surecler: eski
# `log` alanin her biri icin `$(sanitize)` = bir alt kabuk + `tr | sed | cut`;
# satir basina ~28 surec, kesif satirinda ~70-80. Jump sunucusunda surec acmak
# ~2-3 ms. Donusumler artik bash parametre acilimi; SONUC eski boru hattiyla
# BAYT BAYT ayni (N2 altin cikti + N4 fuzz bekcisi kilitler).
_NL=$'\n'
_CR=$'\r'
_TAB=$'\t'

# `sanitize`in alt kabuksuz esi: sonucu $1 adli degiskene yazar.
#   tr '\n\r;' '   '  ->  sed 's/[[:space:]][[:space:]]*/ /g'  ->  cut -c1-1600
# `cut -c` GNU'da BAYT sayar (jump sunuculari Linux): kesim C yerel ayariyla.
sanitize_v() {
  local _s="${2:-}"
  _s="${_s//$_NL/ }"
  _s="${_s//$_CR/ }"
  _s="${_s//;/ }"
  _s="${_s//[[:space:]]/ }"
  while [[ "$_s" == *"  "* ]]; do _s="${_s//  / }"; done
  if [ "${#_s}" -gt 400 ]; then
    local LC_ALL=C
    _s="${_s:0:1600}"
  fi
  printf -v "$1" '%s' "$_s"
}

sanitize() {
  local _sv
  sanitize_v _sv "${1:-}"
  printf '%s' "$_sv"
}

log() {
  local cluster jump app kind step result detail
  sanitize_v cluster "${1:-GLOBAL}"
  sanitize_v jump "${2:--}"
  sanitize_v app "${3:--}"
  sanitize_v kind "${4:--}"
  sanitize_v step "${5:-INFO}"
  sanitize_v result "${6:-INFO}"
  sanitize_v detail "${7:-}"
  printf '%s;%s;%s;%s;%s;%s;%s\n' "$cluster" "$jump" "$app" "$kind" "$step" "$result" "$detail"
}

# ── SURE OLCUMU ─────────────────────────────────────────────────────────────
# Kesfin "cok yavas" oldugu biliniyordu ama NEREDE yavas oldugu bilinmiyordu:
# AWX kuyrugu mu, bastion uzerinden `oc login` mi, yoksa tip taramasi mi. Tahminle
# optimizasyon yapmamak icin betik kendi suresini BILDIRIR; portal onu Admin'de
# gosterir ve her iyilestirmenin etkisi URETIMDE olculur.
#
# UC KADEMELI SAAT, cunku hicbiri her yerde YOK.
#   1) `$EPOCHREALTIME` (bash 5+): mikrosaniye, DIS SUREC CAGIRMAZ. Ondalik
#      ayraci yerel ayara gore nokta ya da virgul olabilir.
#   2) `date +%s%3N`: GNU'ya ozgu. BSD/macOS `%3N`i cozmez ve metni OLDUGU GIBI
#      birakir (hata da vermez) - bu yuzden olcut "cikti rakamlardan mi olusuyor
#      ve milisaniye uzunlugunda mi". `date`in hata BICIMINI tahmin eden bir
#      desen yazmak, tahmin uzerine tahmin olurdu.
#   3) `date +%s` x 1000: her yerde var ama cozunurluk 1 SANIYE. Olcum kabalasir,
#      KAYBOLMAZ - ve bu yolun kosmasi ancak GNU olmayan bir jump sunucusunda
#      mumkun.
now_ms() {
  local s="" e sec frac
  e="${EPOCHREALTIME:-}"
  if [ -n "$e" ]; then
    sec="${e%%[.,]*}"
    frac="${e#*[.,]}000"
    s="${sec}${frac:0:3}"
  fi
  case "$s" in ''|*[!0-9]*) s="$(date +%s%3N 2>/dev/null || true)" ;; esac
  case "$s" in ''|*[!0-9]*) s="" ;; esac
  if [ -n "$s" ] && [ "${#s}" -ge 13 ]; then
    printf '%s' "$s"
  else
    printf '%s' "$(( $(date +%s 2>/dev/null || echo 0) * 1000 ))"
  fi
}

# OLCEMEDIYSE '-' DER, SIFIR DEMEZ. Uydurulmus bir sifir, grafikte "bu adim bedava"
# diye okunur ve yanlis kaldiraca yatirim yaptirir.
ms_delta() {
  local a="${1:-0}" b="${2:-0}" d
  case "$a$b" in *[!0-9]*) printf '%s' '-'; return 0 ;; esac
  d=$(( b - a ))
  if [ "$a" -le 0 ] || [ "$b" -le 0 ] || [ "$d" -lt 0 ]; then printf '%s' '-'; else printf '%s' "$d"; fi
}

SCRIPT_START_MS="$(now_ms)"
# Kesif tarama maliyetinin iki belirleyicisi: taranan tip sayisi ve yetenek
# onbelleginin ISE YARAYIP yaramadigi. Ikisi de yalnizca `workloads` modunda
# anlamli; diger modlar '-' birakir ve ekran "olculmedi" der.
TIMING_KINDS="-"
TIMING_CACHED="-"

cleanup() {
  if [ -n "$KUBECONFIG_FILE" ]; then
    rm -f "$KUBECONFIG_FILE" >/dev/null 2>&1 || true
  fi
  # Precheck toplu okuma dizini (RBAC blogu erken `exit` yapabilir).
  [ -n "${PC_DIR:-}" ] && rm -rf "$PC_DIR" >/dev/null 2>&1
  unset OCP_PASSWORD 2>/dev/null || true
}
trap cleanup EXIT INT TERM HUP

normalize_lower() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | awk '{$1=$1};1'
}

ACTION="$(normalize_lower "$ACTION")"
REQUESTED_KIND="$(normalize_lower "$REQUESTED_KIND")"
PHASE="$(normalize_lower "$PHASE")"
TLS_VERIFY="$(normalize_lower "$TLS_VERIFY")"
NS="$(printf '%s' "$NS" | awk '{$1=$1};1')"
TARGET="$(printf '%s' "$TARGET" | awk '{$1=$1};1')"
APP_RAW="$(printf '%s' "$APP_RAW" | awk '{$1=$1};1')"

DISCOVERY_MODE="$(normalize_lower "$DISCOVERY_MODE")"

if [ "$PHASE" != "precheck" ] && [ "$PHASE" != "execute" ] && [ "$PHASE" != "discover" ]; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Unsupported SCALEX_PHASE=$PHASE"
  exit 0
fi
if [ "$PHASE" = "discover" ]; then
  case "$DISCOVERY_MODE" in
    workloads|state|health|capabilities) ;;
    *) log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Unsupported DISCOVERY_MODE=$DISCOVERY_MODE"; exit 0 ;;
  esac
fi

# NAMESPACE, `capabilities` DISINDA zorunludur. O mod CLUSTER DUZEYIDIR: hicbir
# namespace nesnesine bakmaz, yalnizca API kaynak listesi ve yetki yoklamasi
# yapar. Namespace istemek, admin'e anlamsiz bir alan doldurtmak olurdu.
if [ -z "$CLUSTER" ] || [ -z "$JUMP_SERVER" ] || [ -z "$API_URL" ] || [ -z "$OCP_USERNAME" ] || [ -z "$OCP_PASSWORD" ] \
   || { [ -z "$NS" ] && [ "$DISCOVERY_MODE" != "capabilities" ]; }; then
  log "${CLUSTER:-GLOBAL}" "${JUMP_SERVER:--}" "-" "-" "INPUT" "FAIL" "Required runtime input is missing (cluster/jump/api/user/password/namespace)"
  exit 0
fi
# MUTASYON YOLU: uygulama listesi ve islem ZORUNLU.
# KESIF YOLU: `health` disinda uygulama listesi OPSIYONEL — ekran namespace'i
# tarayip uygulama listesini ogrenmek icin cagiriyor; liste zorunlu olsaydi
# kullanici uygulama adini ezberden bilmek zorunda kalirdi.
if [ "$PHASE" != "discover" ] && { [ -z "$APP_RAW" ] || [ -z "$ACTION" ]; }; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Required runtime input is missing (apps/action)"
  exit 0
fi
if [ "$PHASE" = "discover" ] && [ "$DISCOVERY_MODE" = "health" ] && [ -z "$APP_RAW" ]; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Health discovery requires at least one application"
  exit 0
fi

# `capabilities` NAMESPACE'SIZ KOSAR — yukaridaki zorunluluk kurali onu bilerek
# disarida birakiyor ve asagidaki `oc project` adimi da atlaniyor. BU dogrulama o
# istisnayi TANIMIYORDU: bos NS regex'e takiliyor ve cluster duzeyindeki mod
# "Namespace failed shell-side Kubernetes-safe validation" ile duruyordu. Yetenek
# onbellegini dolduran TEK yol bu mod oldugu icin tablo uretimde bos kaliyor,
# her kesif de soguk yolu kosuyordu.
if [ -n "$NS" ] || [ "$DISCOVERY_MODE" != "capabilities" ]; then
  if ! printf '%s' "$NS" | grep -Eq '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$' || [ "$(printf '%s' "$NS" | wc -c)" -gt 63 ]; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Namespace failed shell-side Kubernetes-safe validation"
    exit 0
  fi
fi

if [ "$PHASE" != "discover" ]; then
  case "$ACTION" in
    stop|restore|scale) ;;
    *) log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Unsupported action=$ACTION"; exit 0 ;;
  esac
fi
case "$REQUESTED_KIND" in
  auto|dc|deploy|sts|rollout) ;;
  ds|daemonset)
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" \
      "DaemonSet cannot be scaled by replicas; it follows node scheduling (kind=$REQUESTED_KIND)"; exit 0 ;;
  cronjob|cronjobs)
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" \
      "CronJob is stopped with spec.suspend, not replicas; unsupported operation (kind=$REQUESTED_KIND)"; exit 0 ;;
  *) log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Unsupported workload kind=$REQUESTED_KIND"; exit 0 ;;
esac
if [ "$ACTION" = "scale" ] && ! printf '%s' "$TARGET" | grep -Eq '^[0-9]+$'; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "TARGET must be a non-negative integer for scale"
  exit 0
fi
if [ "$TLS_VERIFY" != "true" ] && [ "$TLS_VERIFY" != "false" ]; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "TLS_VERIFY must be true or false"
  exit 0
fi
if ! printf '%s' "$WAIT_ATTEMPTS" | grep -Eq '^[1-9][0-9]*$' || ! printf '%s' "$WAIT_SECONDS" | grep -Eq '^[1-9][0-9]*$'; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Invalid verification wait configuration"
  exit 0
fi
# VERIFY_*_SECONDS DOGRULAMASI — SESSIZ KAPIYI KAPATIR.
#
# Bu iki deger `verify_replicas` icinde `[ "$elapsed" -ge "$VERIFY_FAIL_SECONDS" ]`
# ile karsilastiriliyor. Sayisal DEGILSE `test` "integer expression expected" yazip
# rc=2 doner; betik `set -e` ILE KOSMUYOR (bkz. dosya basi), yani kosul sessizce
# YANLIS sayilir ve KAPATMANIN FAIL ESIGI HIC ATESLENMEZ: pod'lar hic 0'a inmese
# bile is "basarili" biter. Ekran "tamam" der.
#
# `WAIT_*` icin bu dogrulama zaten VARDI; butce saniyeye gecince (PR #98) yeni iki
# degisken ayni korumayi ALMAMISTI.
if ! printf '%s' "$VERIFY_WARN_SECONDS" | grep -Eq '^[1-9][0-9]*$' \
  || ! printf '%s' "$VERIFY_FAIL_SECONDS" | grep -Eq '^[1-9][0-9]*$'; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" \
    "Invalid verification budget: warn=$VERIFY_WARN_SECONDS fail=$VERIFY_FAIL_SECONDS (positive integers required)"
  exit 0
fi

APPS_TEXT="$(printf '%s\n' "$APP_RAW" | tr ',;' '\n\n' | awk '{$1=$1}; NF && !seen[$0]++ {print}')"

# CANLI YOKLAMA LISTESI — YALNIZCA `state` KESFINDE, YALNIZCA `LIVE` SATIRLARI ICIN.
#
# NEDEN `APPS_TEXT` DEGIL: `APPS_TEXT` ConfigMap listelemesini de SUZUYOR
# (`disc_app_wanted`). Portal aynasindaki uygulamalarla suzseydik, cluster'da
# durdurulmus ama portalda kaydi OLMAYAN uygulamalar (`unknown_to_portal`) gorunmez
# olurdu — yani sapma tespitinin YARISI kaybolurdu. Ayri degisken sart.
LIVE_PROBE_TEXT="$(printf '%s\n' "${SCALEX_LIVE_PROBE_APPS:-}" | tr ',;' '\n\n' | awk '{$1=$1}; NF && !seen[$0]++ {print}')"

# CLUSTER YETENEK ONBELLEGI — OLCULEN DARBOGAZIN TEK CAGRIYLA ATLANMASI.
#
# `load_extra_scalable_resources` cluster basina ~50 `oc get --raw` yapiyor
# (API grubu basina bir tane). Bu liste — cluster'da `scale` alt kaynagi olan
# CRD'ler — NAMESPACE'TEN, UYGULAMADAN ve KULLANICIDAN BAGIMSIZDIR ve bir
# operator kurulmadikca AYLARCA degismez. Yani her kesifte yeniden hesaplamak
# saf israf.
#
# Portal bu listeyi DB'de tutuyor ve doluysa buradan geciriyor; dolu geldiginde
# asagidaki fonksiyon HIC `oc` cagirmaz.
#
# FAIL-SAFE: bos gelirse (onbellek yok / bayat / okunamadi) ESKI yol aynen
# kosar. "Onbellek yok"u "CRD yok" saymak, olceklenebilir operator nesnelerini
# SESSIZCE listeden dusurmek olurdu — bu depodaki en pahali hata sinifi.
EXTRA_KINDS_TEXT="$(printf '%s\n' "${SCALEX_EXTRA_KINDS:-}" | tr ',;' '\n\n' | awk '{$1=$1}; NF && !seen[$0]++ {print}')"
# ── "TARANDI AMA BOS" — BOS LISTEDEN AYRI BIR HAL ───────────────────────────
#
# `SCALEX_EXTRA_KINDS=''` betik tarafinda "onbellek YOK" demek ve eski yolu
# kosturur. Ama portal "bu cluster tarandi, olceklenebilir EKSTRA CRD YOK" da
# diyebiliyor ve bu bilgi tam olarak en pahali adimi (API grubu basina
# `oc get --raw`, ~50 cagri) atlatan bilgi. Ikisini ayni degerle anlatmak,
# ekstra CRD'si olmayan cluster'lari sonsuza dek soguk yolda birakiyordu.
#
# AYRI DEGISKEN, ORTAK DEGERE ISARET KOYMAK DEGIL: `SCALEX_EXTRA_KINDS='-'`
# gibi bir isaret degeri, ESKI bir paket tarafindan gercek bir tip adi
# sanilirdi (`oc get -` denenir, sahte bir WARN satiri cikardi). Tanimadigi
# bir ortam degiskenini ise eski paket sessizce YOK SAYAR.
EXTRA_KINDS_SCANNED="$(normalize_lower "${SCALEX_EXTRA_KINDS_SCANNED:-no}")"

# ── COK NAMESPACE: TEK ISTE ─────────────────────────────────────────────────
#
# OLCULEN TABAN: `namespace` TEKILDI, yani "3 namespace" = 3 AYRI AWX isi = AWX
# sabit maliyeti (kuyruk + SSH + `oc login`) UC KEZ. `oc` cagrilarini sifira
# indirsen bile 3 x ~6 sn = ~18 sn taban kaliyordu; kullanicinin ≤20 sn hedefi
# bu olmadan TUTMUYOR.
#
# `NS` KALIYOR: eski AWX paketleri ve mutasyon yolu onu okuyor. `NS_LIST` yalnizca
# EKLENIYOR ve bos geldiginde liste `NS`ten turetiliyor — yani eski davranis
# birebir korunur.
#
# `NAMESPACES` ADI KULLANILMIYOR: `namespace` Jinja'nin kendi global adi ve
# playbook tarafinda `is defined` HEP true doner (bkz. jinja-global-tuzagi).
# Buradaki kabuk degiskeni de o aileyle karistirilmasin diye `NS_LIST`.
NS_LIST_TEXT="$(printf '%s\n' "${NS_LIST:-}" | tr ',;' '\n\n' | awk '{$1=$1}; NF && !seen[$0]++ {print}')"
if [ -z "$NS_LIST_TEXT" ] && [ -n "$NS" ]; then
  NS_LIST_TEXT="$NS"
fi
if [ -z "$APPS_TEXT" ] && [ "$PHASE" != "discover" ]; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "No application remained after parsing input"
  exit 0
fi
while IFS= read -r _app; do
  [ -z "$_app" ] && continue
  if ! printf '%s' "$_app" | grep -Eq '^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$' || [ "$(printf '%s' "$_app" | wc -c)" -gt 253 ]; then
    log "$CLUSTER" "$JUMP_SERVER" "$_app" "-" "INPUT" "FAIL" "Application name failed shell-side Kubernetes-safe validation"
    exit 0
  fi
done <<EOF_APPS_VALIDATE
$APPS_TEXT
EOF_APPS_VALIDATE

try_workdir() {
  local dir="$1" test_file
  mkdir -p "$dir" 2>/dev/null || return 1
  chmod 0775 "$dir" 2>/dev/null || true
  test_file="${dir}/.chaos_write_test_$$"
  if touch "$test_file" 2>/dev/null; then
    rm -f "$test_file" >/dev/null 2>&1 || true
    printf '%s\n' "$dir"
    return 0
  fi
  return 1
}

select_workdir() {
  local home_dir user_name
  if try_workdir "/sw/openshift/chaos-scale-job"; then return 0; fi
  if mkdir -p "/vhosting/openshift-works" 2>/dev/null; then
    chmod 0775 "/vhosting/openshift-works" 2>/dev/null || true
    if try_workdir "/vhosting/openshift-works/chaos-scale-job"; then return 0; fi
  fi
  home_dir="${HOME:-}"
  if [ -z "$home_dir" ]; then
    user_name="$(id -un 2>/dev/null || true)"
    home_dir="$(getent passwd "$user_name" 2>/dev/null | cut -d: -f6 || true)"
  fi
  [ -n "$home_dir" ] && try_workdir "${home_dir}/chaos-scale-job"
}

WORKDIR="$(select_workdir || true)"
if [ -z "$WORKDIR" ]; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "WORKDIR" "FAIL" "No writable workdir found. Tried /sw/openshift/chaos-scale-job, /vhosting/openshift-works/chaos-scale-job and ~/chaos-scale-job"
  exit 0
fi
[ "$PHASE" = "precheck" ] && log "$CLUSTER" "$JUMP_SERVER" "-" "-" "WORKDIR" "INFO" "Selected writable workdir=$WORKDIR"

resolve_oc_binary() {
  local paths candidate oldifs path_candidate
  paths="${OCP_OC_PATHS:-}"
  oldifs="$IFS"
  IFS=':'
  for candidate in $paths; do
    IFS="$oldifs"
    candidate="$(printf '%s' "$candidate" | awk '{$1=$1};1')"
    [ -z "$candidate" ] && { IFS=':'; continue; }
    case "$candidate" in
      /*) ;;
      *) IFS=':'; continue ;;
    esac

    # Do not rely only on test -x. Validate the actual client can start in the
    # non-interactive AAP SSH session. This also catches symlink/ACL/loader issues.
    if { [ -e "$candidate" ] || [ -L "$candidate" ]; } && [ ! -d "$candidate" ]; then
      if "$candidate" version --client >/dev/null 2>&1; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
    IFS=':'
  done
  IFS="$oldifs"

  # AAP normally uses a non-login shell, so make the standard OpenShift client
  # locations explicit before checking PATH.
  PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
  export PATH
  path_candidate="$(command -v oc 2>/dev/null || true)"
  if [ -n "$path_candidate" ] && "$path_candidate" version --client >/dev/null 2>&1; then
    printf '%s\n' "$path_candidate"
    return 0
  fi
  return 1
}

oc_path_diagnostics() {
  local paths candidate oldifs exists executable target rc details
  paths="${OCP_OC_PATHS:-}"
  details="user=$(id -un 2>/dev/null || echo unknown) host=$(hostname -s 2>/dev/null || echo unknown)"
  oldifs="$IFS"
  IFS=':'
  for candidate in $paths; do
    IFS="$oldifs"
    candidate="$(printf '%s' "$candidate" | awk '{$1=$1};1')"
    [ -z "$candidate" ] && { IFS=':'; continue; }
    case "$candidate" in
      /*) ;;
      *) IFS=':'; continue ;;
    esac

    exists=no
    executable=no
    target="-"
    rc="na"
    { [ -e "$candidate" ] || [ -L "$candidate" ]; } && exists=yes
    [ -x "$candidate" ] && executable=yes
    target="$(readlink -f "$candidate" 2>/dev/null || true)"
    [ -z "$target" ] && target="-"
    if [ "$exists" = "yes" ] && [ ! -d "$candidate" ]; then
      "$candidate" version --client >/dev/null 2>&1
      rc=$?
    fi
    details="$details | $candidate exists=$exists executable=$executable target=$target version_rc=$rc"
    IFS=':'
  done
  IFS="$oldifs"
  printf '%s\n' "$details"
}

OC_BIN="$(resolve_oc_binary || true)"
if [ -z "$OC_BIN" ]; then
  SEARCHED="$(printf '%s' "$OCP_OC_PATHS" | tr ':' ',')"
  OC_DIAG="$(oc_path_diagnostics)"
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "CLIENT" "FAIL" "OpenShift oc client could not be executed. Searched=$SEARCHED and PATH. $OC_DIAG"
  exit 0
fi

# Keep the rest of the runner readable while pinning every command to the resolved binary.
oc() {
  "$OC_BIN" "$@"
}

# Hata metnindeki YOK tiplerin kisa adlari (satir basina bir tane). Kesif ve
# precheck ortak kullanir; precheck ust duzeyde (RBAC blogunda) kostugu icin
# tanim burada, cagrilardan ONCE.
disc_absent_names() {
  sed -n 's/.*resource type "\([^"]*\)".*/\1/p' "$1" 2>/dev/null | sed 's/\..*//' | sort -u
}

# Hata metnindeki YETKISIZ tiplerin TAM kaynak adlari (satir basina bir tane).
# kubectl her reddedilen tip icin sunucunun metnini basar:
#   Error from server (Forbidden): deployments.apps is forbidden: User "..." cannot list ...
# Kaynak adi komut satirindaki TAM adla gelir (cekirdek grupta grupsuz: `pods`).
disc_forbidden_names() {
  sed -n 's/^Error from server (Forbidden): \([^ ]*\) is forbidden.*/\1/p' "$1" 2>/dev/null | sort -u
}

# ═══════════════════════════════════════════════════════════════════════════
# PRECHECK TOPLU OKUMA — UYGULAMA BASINA DEGIL, NAMESPACE BASINA.
#
# OLCULDU (sahte `oc` ile, gercek betik): 5 uygulamalik bir `stop` precheck'i 64,
# `restore` precheck'i 104 `oc` cagrisi yapiyordu. Uygulama basina: tespit (1-3
# `get`), spec, durum kaydi adi (1-2), OBJECT satiri, HPA (2), `can-i patch`
# (1-3) ve geri alma icin durum dogrulamasi (9 ayri `get`). Bastion uzerinden
# cagri basina ~150 ms: 19 uygulama x 3 cluster'da precheck tek basina dakikalar.
#
# Bu katman ayni bilgiyi NAMESPACE BASINA BIR KEZ ve AYNI ANDA okur:
#   is yuku dizini (dc/deploy/sts/rollout, tek cok tipli `get`), HPA listesi,
#   durum kayitlari (tek liste), OBJECT tablolari (tip basina), `can-i` sorulari.
#
# SATIRLAR DEGISMEZ: rapor bu satirlardan kuruluyor. Altin cikti bekcisi (J2)
# on senaryoda satirlarin BIREBIR ayni oldugunu kilitliyor.
#
# YALNIZCA YETKILI BILGI KULLANILIR. Bir tip okunamadiysa (yetki reddi, atif
# dogrulanamadi) ya da liste yasaksa o soru icin ESKI uygulama-basina yol kosar.
# "Listede yok" yalnizca liste GERCEKTEN okunduysa "yok" demektir — aksi halde
# var olan bir uygulamayi "bulunamadi" diye reddederdik.
#
# YALNIZCA PRECHECK'TE: execute her uygulamayi mutasyondan HEMEN once taze okur
# (arada baska biri degistirmis olabilir) ve orada faz basindan kalma bir
# onbellek tehlikelidir.
# ═══════════════════════════════════════════════════════════════════════════
PC_ON="no"
PC_DIR=""
PC_INDEX_OK=" "     # dizini YETKILI olan tipler (okundu ya da API'si yok)
PC_CM_OK="no"       # durum kaydi listesi okundu mu
PC_HPA_OK="no"

pc_kind_of() {
  case "$1" in
    DeploymentConfig) echo dc ;; Deployment) echo deploy ;;
    StatefulSet) echo sts ;; Rollout) echo rollout ;; *) echo "" ;;
  esac
}
pc_full() {
  case "$1" in
    dc) echo deploymentconfigs.apps.openshift.io ;; deploy) echo deployments.apps ;;
    sts) echo statefulsets.apps ;; rollout) echo rollouts.argoproj.io ;;
  esac
}

# Durum kayitlarinin TUM alanlari tek satirda. `validate_restore_state` dokuz
# ayri `get` yapiyordu; bu tek liste (ya da liste yasaksa kayit basina TEK
# `get`) ayni bilgiyi verir.
PC_CM_FIELDS='{.data.previous_replicas}|{.data.app}|{.data.namespace}|{.data.cluster}|{.data.kind}|{.data.resource}|{.data.phase}|{.data.version}'

# Precheck'in sordugu `can-i`ler. Sira ve anlam RBAC blogundakiyle ayni.
pc_cani_sorulari() {
  printf '%s\n' "list hpa" "list pods"
  case "$ACTION" in
    stop) printf '%s\n' "get configmaps" "create configmaps" "patch configmaps" ;;
    restore) printf '%s\n' "get configmaps" "delete configmaps" "patch configmaps" ;;
  esac
  printf '%s\n' "patch dc" "patch deploy" "patch sts" "patch rollout"
}
pc_cani_dosya() { printf '%s/cani_%s' "$PC_DIR" "$(printf '%s' "$1" | tr ' ' '_')"; }

# `oc auth can-i` CIKTISINI dondurur (onbellekten ya da canli). Cagiranlar
# ciktiyi `grep -qi '^yes$'` ile degerlendiriyor — anlam degismez.
pc_cani_raw() {
  local f
  if [ "$PC_ON" = "yes" ]; then
    f="$(pc_cani_dosya "$1 $2")"
    if [ -f "$f" ]; then cat "$f"; return 0; fi
  fi
  oc auth can-i "$1" "$2" -n "$NS" 2>/dev/null || true
}
pc_cani() { pc_cani_raw "$1" "$2" | grep -qi '^yes$'; }

# Kullanilacak tipler: haritada/istenen tipte gecenler, `auto`da dordu birden.
pc_kinds_needed() {
  local k
  if [ "$REQUESTED_KIND" != "auto" ]; then printf '%s\n' "$REQUESTED_KIND"; fi
  if [ -n "$WORKLOAD_KINDS_MAP" ]; then
    printf '%s\n' "$WORKLOAD_KINDS_MAP" | tr ',' '\n' | sed -n 's/^[^=]*=//p' | while IFS= read -r k; do normalize_lower "$k"; echo; done
  fi
  if [ "$REQUESTED_KIND" = "auto" ]; then printf '%s\n' dc deploy sts rollout; fi
}

pc_prefetch() {
  local q f k kinds csv="" pids="" p
  PC_DIR="$(mktemp -d "${WORKDIR}/.scalex_pc_XXXXXX" 2>/dev/null || true)"
  [ -z "$PC_DIR" ] && return 0
  kinds="$(pc_kinds_needed | awk '$0 ~ /^(dc|deploy|sts|rollout)$/ && !s[$0]++')"
  for k in $kinds; do
    if [ -z "$csv" ]; then csv="$(pc_full "$k")"; else csv="$csv,$(pc_full "$k")"; fi
  done
  # Hepsi AYNI ANDA: bagimsiz sorular, sure en yavasinin suresi.
  while IFS= read -r q; do
    [ -z "$q" ] && continue
    f="$(pc_cani_dosya "$q")"
    # shellcheck disable=SC2086
    ( oc auth can-i $q -n "$NS" >"$f" 2>/dev/null || true ) &
    pids="$pids $!"
  done <<EOF_PC_CANI
$(pc_cani_sorulari)
EOF_PC_CANI
  ( oc get hpa -n "$NS" --no-headers >"$PC_DIR/hpa" 2>/dev/null; echo "$?" >"$PC_DIR/hpa.rc" ) &
  pids="$pids $!"
  ( oc get cm -n "$NS" -o "jsonpath={range .items[*]}{.metadata.name}|${PC_CM_FIELDS}{\"\\n\"}{end}" \
      >"$PC_DIR/cm" 2>/dev/null; echo "$?" >"$PC_DIR/cm.rc" ) &
  pids="$pids $!"
  if [ -n "$csv" ]; then
    ( oc get "$csv" -n "$NS" --allow-missing-template-keys=true \
        -o 'jsonpath={range .items[*]}{.kind}|{.metadata.name}|{.spec.replicas}{"\n"}{end}' \
        >"$PC_DIR/wl" 2>"$PC_DIR/wl.err"; echo "$?" >"$PC_DIR/wl.rc" ) &
    pids="$pids $!"
  fi
  # OBJECT satirlari: tip basina TEK tablo. Kisa ad (`deploy`) BILEREK: eski
  # `log_object_line` da `oc get <kisa-ad> <app> --no-headers` basiyordu ve
  # tablo sutunlari ada gore degismez.
  for k in $kinds; do
    ( oc get "$k" -n "$NS" --no-headers >"$PC_DIR/obj_$k" 2>/dev/null; echo "$?" >"$PC_DIR/obj_$k.rc" ) &
    pids="$pids $!"
  done
  for p in $pids; do wait "$p" 2>/dev/null; done
  PC_ON="yes"
  [ "$(cat "$PC_DIR/hpa.rc" 2>/dev/null)" = "0" ] && PC_HPA_OK="yes"
  [ "$(cat "$PC_DIR/cm.rc" 2>/dev/null)" = "0" ] && PC_CM_OK="yes"
  [ -n "$csv" ] && pc_index_finish "$kinds" "$csv"
  return 0
}

# Dizinin hangi tipler icin YETKILI oldugunu belirler; API'si olmayan tipi
# cikarip kalanla yeniden dener (kesifteki `disc_scan_chunk` ile ayni kural).
pc_index_finish() {
  local kinds="$1" csv="$2" rc yok k bad kalan tur=0
  : >"$PC_DIR/wl.yok"
  while :; do
    rc="$(cat "$PC_DIR/wl.rc" 2>/dev/null || echo 1)"
    if [ ! -s "$PC_DIR/wl" ] && [ "$rc" != "0" ]; then
      yok="$(disc_absent_names "$PC_DIR/wl.err")"
      [ -z "$yok" ] && return 0            # sebebi bilinmiyor: HICBIR tip yetkili degil
      kalan=""
      for k in $kinds; do
        if printf '%s\n' "$yok" | grep -qx -- "$(pc_full "$k" | sed 's/\..*//')"; then
          echo "$k" >>"$PC_DIR/wl.yok"       # API YOK: "bulunamadi" yetkili bir cevap
        else
          kalan="$kalan $k"
        fi
      done
      [ "$kalan" = " $kinds" ] && return 0
      kinds="$kalan"; csv=""
      for k in $kinds; do
        if [ -z "$csv" ]; then csv="$(pc_full "$k")"; else csv="$csv,$(pc_full "$k")"; fi
      done
      tur=$((tur + 1))
      if [ -z "$csv" ] || [ "$tur" -gt 4 ]; then
        PC_INDEX_OK=" $(tr '\n' ' ' <"$PC_DIR/wl.yok")"
        return 0
      fi
      rc=0
      oc get "$csv" -n "$NS" --allow-missing-template-keys=true \
        -o 'jsonpath={range .items[*]}{.kind}|{.metadata.name}|{.spec.replicas}{"\n"}{end}' \
        >"$PC_DIR/wl" 2>"$PC_DIR/wl.err" || rc=1
      echo "$rc" >"$PC_DIR/wl.rc"
      continue
    fi
    break
  done
  # ATIF DOGRULANIR: `{.kind}` bos ya da beklenmeyen bir satir varsa dizin
  # hicbir tip icin kullanilmaz (eski yol kosar).
  bad="$(awk -F'|' 'NF >= 2 && $2 != "" && $1 !~ /^(DeploymentConfig|Deployment|StatefulSet|Rollout)$/ { n++ } END { print n + 0 }' "$PC_DIR/wl")"
  [ "$bad" -gt 0 ] && return 0
  PC_INDEX_OK=" $(tr '\n' ' ' <"$PC_DIR/wl.yok")"
  for k in $kinds; do
    # Cagri rc=1 dondu ve hata metni bu tipi aniyorsa (yetki reddi) tip YETKILI DEGIL.
    if [ "$rc" != "0" ] && grep -qF -- "$(pc_full "$k")" "$PC_DIR/wl.err" 2>/dev/null; then continue; fi
    PC_INDEX_OK="$PC_INDEX_OK$k "
  done
}

pc_index_ok() { [ "$PC_ON" = "yes" ] && case "$PC_INDEX_OK" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
# Uygulama o tipte var mi (dizin YETKILI iken cagrilir).
pc_index_has() {
  grep -qx -- "$1" "$PC_DIR/wl.yok" 2>/dev/null && return 1
  awk -F'|' -v a="$2" -v k="$1" '
    ($1 == "DeploymentConfig" && k == "dc") || ($1 == "Deployment" && k == "deploy") ||
    ($1 == "StatefulSet" && k == "sts") || ($1 == "Rollout" && k == "rollout") { if ($2 == a) f = 1 }
    END { exit f ? 0 : 1 }' "$PC_DIR/wl"
}
# Kisa ad: eski `first_working_resource`in ILK adayi — satirlarda ve durum
# kaydinda (`resource=`) gorunen ad budur.
pc_short() { resource_candidates "$1" | head -n 1; }

# 0 = bulundu, 1 = yok (YETKILI cevap), 2 = bilinmiyor (eski yol kossun)
pc_detect_kind() {
  pc_index_ok "$1" || return 2
  pc_index_has "$1" "$2" && return 0
  return 1
}
pc_kind_name() {
  case "$1" in
    dc) echo DeploymentConfig ;; deploy) echo Deployment ;;
    sts) echo StatefulSet ;; rollout) echo Rollout ;;
  esac
}

# PAKET SURUMU HER FAZDA BILDIRILIR. Portal bunu okuyup kendi bekledigi surumle
# karsilastiriyor; uyusmazlikta ekran "guncel olmayabilir" diye tahmin etmek yerine
# hangi surumun kostugunu SOYLUYOR. AWX'e elle kopyalanan bir pakette tek kanit bu.
log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RUNNER" "INFO" "package_version=$PACKAGE_VERSION phase=$PHASE"

if [ "$PHASE" = "precheck" ]; then
  OC_VERSION="$(oc version --client 2>/dev/null | head -n 1 || true)"
  [ -z "$OC_VERSION" ] && OC_VERSION="version output unavailable"
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "CLIENT" "OK" "oc_path=$OC_BIN $OC_VERSION"
fi

API_HOST="$(printf '%s' "$API_URL" | sed -E 's#^https?://([^/:]+).*#\1#')"
# API ERISILEBILIRLIGI — bir TESHIS adimi: `oc login` dustugunde "API'ye
# ulasilamiyor" ile "kimlik reddedildi"yi ayirir.
#
# KESIFTE YALNIZCA LOGIN DUSERSE sorulur. Basarili bir login erisilebilirligin
# KENDISI kanitidir; o halde curl ayni cevabi bir TLS el sikismasi (~0,1-0,5 sn,
# cluster basina, her kesifte) pahasina verir. Precheck/execute'ta sira ve
# satirlar AYNEN korunur (kullanici o satirlari rapor olarak okuyor).
api_check() {
  if command -v curl >/dev/null 2>&1; then
    CURL_TLS_ARGS=""
    [ "$TLS_VERIFY" = "false" ] && CURL_TLS_ARGS="-k"
    if curl $CURL_TLS_ARGS -sS -o /dev/null --connect-timeout 5 "${API_URL%/}/version" >/dev/null 2>&1; then
      [ "$PHASE" = "precheck" ] && log "$CLUSTER" "$JUMP_SERVER" "-" "-" "API" "OK" "API endpoint reachable host=$API_HOST tls_verify=$TLS_VERIFY"
    else
      STEP="API"; [ "$PHASE" = "execute" ] && STEP="RECHECK"
      log "$CLUSTER" "$JUMP_SERVER" "-" "-" "$STEP" "FAIL" "API endpoint is not reachable from jump server host=$API_HOST"
      exit 0
    fi
  else
    [ "$PHASE" = "precheck" ] && log "$CLUSTER" "$JUMP_SERVER" "-" "-" "API" "WARN" "curl is unavailable; API reachability will be determined by oc login"
  fi
}
[ "$PHASE" != "discover" ] && api_check

KUBECONFIG_FILE="$(mktemp "${WORKDIR}/.chaos_kubeconfig_${CLUSTER}_XXXXXX" 2>/dev/null || true)"
if [ -z "$KUBECONFIG_FILE" ]; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "WORKDIR" "FAIL" "Unable to create ephemeral kubeconfig in selected workdir"
  exit 0
fi
export KUBECONFIG="$KUBECONFIG_FILE"

if [ "$TLS_VERIFY" = "true" ]; then
  oc login "$API_URL" -u "$OCP_USERNAME" -p "$OCP_PASSWORD" --kubeconfig="$KUBECONFIG_FILE" >/dev/null 2>&1
  LOGIN_RC=$?
else
  oc login "$API_URL" -u "$OCP_USERNAME" -p "$OCP_PASSWORD" --insecure-skip-tls-verify=true --kubeconfig="$KUBECONFIG_FILE" >/dev/null 2>&1
  LOGIN_RC=$?
fi
if [ "$LOGIN_RC" -ne 0 ]; then
  # Kesifte teshis simdi: API'ye ulasilamiyorsa `api_check` kendi FAIL satirini
  # basip cikar; ulasiliyorsa sorun kimlikte.
  [ "$PHASE" = "discover" ] && api_check
  STEP="LOGIN"; [ "$PHASE" = "execute" ] && STEP="RECHECK"
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "$STEP" "FAIL" "OpenShift login failed for configured service user"
  exit 0
fi
[ "$PHASE" = "precheck" ] && log "$CLUSTER" "$JUMP_SERVER" "-" "-" "LOGIN" "OK" "Login success"

# `capabilities` CLUSTER DUZEYIDIR: namespace'e gecmez, cunku bakacagi hicbir
# namespace nesnesi yok. Var olmayan bir namespace'e gecmeye calismak, yetenek
# taramasini alakasiz bir sebeple dusururdu.
if [ "$DISCOVERY_MODE" != "capabilities" ]; then
  if ! oc project "$NS" >/dev/null 2>&1; then
    STEP="NAMESPACE"; [ "$PHASE" = "execute" ] && STEP="RECHECK"
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "$STEP" "FAIL" "Namespace/project not found or not accessible: $NS"
    exit 0
  fi
  { [ "$PHASE" = "precheck" ] || [ "$PHASE" = "discover" ]; } && log "$CLUSTER" "$JUMP_SERVER" "-" "-" "NAMESPACE" "OK" "Using project $NS"
fi

# Namespace-level RBAC checks. HPA visibility is mandatory because the policy is deliberately HPA-aware/read-only.
if [ "$PHASE" = "precheck" ]; then
  pc_prefetch
  _rbac_block=0
  if ! pc_cani list hpa; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "FAIL" "Missing permission: list horizontalpodautoscalers in namespace"
    _rbac_block=1
  else
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "OK" "HPA read permission available; HPA will remain untouched"
  fi
  if ! pc_cani list pods; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "WARN" "Missing list pods permission; post-operation pod reporting will be limited"
  fi
  if [ "$ACTION" = "stop" ]; then
    for _verb in get create patch; do
      if ! pc_cani "$_verb" configmaps; then
        log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "FAIL" "Missing ConfigMap permission: $_verb (required for reversible scale-down state)"
        _rbac_block=1
      fi
    done
  elif [ "$ACTION" = "restore" ]; then
    if ! pc_cani get configmaps; then
      log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "FAIL" "Missing ConfigMap get permission required for restore"
      _rbac_block=1
    fi
    _can_delete="$(pc_cani_raw delete configmaps)"
    _can_patch_cm="$(pc_cani_raw patch configmaps)"
    if ! printf '%s\n%s\n' "$_can_delete" "$_can_patch_cm" | grep -qi '^yes$'; then
      log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "FAIL" "Restore requires either delete or patch permission on ConfigMaps for state finalization"
      _rbac_block=1
    fi
  fi
  if [ "$_rbac_block" -ne 0 ]; then
    exit 0
  fi
fi

# `kind_to_display`in alt kabuksuz esi (sonuc $1 adli degiskene).
kind_to_display_v() {
  local _b
  case "$2" in
    dc) _b="DeploymentConfig" ;;
    deploy) _b="Deployment" ;;
    sts) _b="StatefulSet" ;;
    rollout) _b="ArgoRollout" ;;
    ds) _b="DaemonSet" ;;
    cronjob) _b="CronJob" ;;
    *.*) _b="${2%%.*}"; _b="${_b%s} (${2#*.})" ;;
    *) _b="$2" ;;
  esac
  printf -v "$1" '%s' "$_b"
}

kind_to_display() {
  case "$1" in
    dc) echo "DeploymentConfig" ;;
    deploy) echo "Deployment" ;;
    sts) echo "StatefulSet" ;;
    rollout) echo "ArgoRollout" ;;
    ds) echo "DaemonSet" ;;
    cronjob) echo "CronJob" ;;
    # Cluster'dan KESFEDILEN tip ("kafkas.kafka.strimzi.io"). Kaynak adi okunur hale
    # getirilir: "Kafka (kafka.strimzi.io)". Ad zaten `disc_val`den geciyor.
    *.*) printf '%s (%s)\n' "$(printf '%s' "${1%%.*}" | sed 's/s$//')" "${1#*.}" ;;
    *) echo "$1" ;;
  esac
}

# OLCEKLENEBILIR TIPLER — replica ile durdurulup geri alinabilenler. Operasyon
# YALNIZCA bunlara dokunur.
SCALABLE_KINDS="dc deploy sts rollout"
# KESIFTE LISTELENEN TIPLER. DaemonSet ve CronJob replica semantigi TASIMAZ
# (DaemonSet dugum sayisiyla olceklenir, CronJob `spec.suspend` ile durdurulur) —
# listelenirler ki kullanici "namespace'imde bu da var ama ScaleX'te gormuyorum"
# demesin, ama `scalable=no` ile gelir ve ekran onlari SECTIRMEZ.
#
# ReplicaSet / ReplicationController / Pod BILEREK DISARIDA: bunlar Deployment ve
# DeploymentConfig'in SAHIP OLDUGU nesneler. Listelemek her uygulamayi iki kez
# gosterir ve kullaniciya denetleyicinin saniyeler icinde geri alacagi bir
# "olcekle" dugmesi sunardi.
DISCOVERY_KINDS="deploy sts dc rollout ds cronjob"

kind_is_scalable() {
  case " $SCALABLE_KINDS " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# ── KESFEDILEN CRD'LER: GORUNUR AMA HENUZ ISLENEMEZ ─────────────────────────
# `scale` alt kaynagi olan bir CRD teknik olarak `oc patch ... spec.replicas` ile
# olceklenebilir. Yine de `scalable=no` ile listeleniyorlar, cunku islem yolu bu
# tipler icin UCTAN UCA denenmedi: portalin tip haritasi (buildWorkloadKindMap)
# yalnizca bilinen dort tipi taniyor ve `detect_workload`un `auto` taramasi da
# oyle. `scalable=yes` demek, kullaniciya calisacagini KANITLAMADIGIMIZ bir dugme
# sunmak olurdu — bu depoda tam olarak bu sinif hata pahaliya mal oldu.
# Kullanicinin istegi ("on cesit varsa onunu da denesin") GORUNURLUK; islem
# destegi ayri ve kanitlanmasi gereken bir adim.
kind_is_discovered_crd() {
  case "$1" in
    deploy|sts|dc|rollout|ds|cronjob) return 1 ;;
    *.*) return 0 ;;
    *) return 1 ;;
  esac
}

# ── CLUSTER'IN KENDI KAYNAK ENVANTERI ───────────────────────────────────────
# Sabit bir tip listesi iki soruyu birden CEVAPLAYAMIYOR: "bu tip bu cluster'da
# VAR MI" ve "listeleyebiliyor muyum". `oc api-resources` ilkini kesin cevaplar ve
# YETKI GEREKTIRMEZ (discovery her kimlige aciktir) — yani `oc get` dustugunde
# nedenin API yoklugu mu yetki eksikligi mi oldugu artik TAHMIN degil.
#
# Ayrica cluster'da olup listemizde olmayan olceklenebilir tipler (operator CRD'leri)
# bu yolla gorunur hale gelir: kullanicinin "on cesit varsa onunu da denesin" istegi.
CLUSTER_RESOURCES=""
CLUSTER_RESOURCES_OK="no"
load_cluster_resources() {
  CLUSTER_RESOURCES="$(oc api-resources --namespaced=true --verbs=list -o name 2>/dev/null | awk 'NF' | sort -u)"
  if [ -n "$CLUSTER_RESOURCES" ]; then CLUSTER_RESOURCES_OK="yes"; fi
}

# ── KESIF KRITIK YOLUNDA `api-resources` YOK ────────────────────────────────
#
# OLCULDU (uretim AWX loglari, 2026-09-30): `oc api-resources` ISTEMCI tarafinda
# 1-3 SANIYE, ve arka plana alinmasi bile yetmedi — kesif cluster basina 11-15 sn
# surdu. Kesif (`workloads`) artik onu HIC cagirmaz:
#
#   * bilinen alti tipin KIND'i SABIT tablodan gelir (`kind_of_resource`);
#   * `api_absent` / `no_permission` ayrimi `oc get`in KENDI stderr'inden okunur
#     (`disc_reason`) — kubectl API yoklugunda "doesn't have a resource type",
#     yetki reddinde "Forbidden" yazar; ikisi karismaz.
#
# `load_cluster_resources` YALNIZCA `capabilities` modunda (Admin / arka plan
# taramasi) kosar. Orada sure kullaniciyi BEKLETMEZ.

# Tam ad ("statefulsets.apps") ya da grupsuz ad ("statefulsets") ile eslesir.
resource_exists() {
  [ "$CLUSTER_RESOURCES_OK" = "yes" ] || return 0   # envanter okunamadiysa ENGELLEME
  printf '%s\n' "$CLUSTER_RESOURCES" | grep -qx -- "$1" && return 0
  printf '%s\n' "$CLUSTER_RESOURCES" | grep -q "^$1\." && return 0
  return 1
}

# Bir kanonik tipin bu cluster'daki TAM kaynak adi. `oc auth can-i` kisa adlari
# (sts/ds/cronjob) GUVENILIR cozmez; RBAC kurallari tam adla yazilir. Bu yuzden
# yetki sorusu da, kullaniciya verilen RBAC cumlesi de tam adi kullanmali.
full_resource_name() {
  local kind="$1" candidate
  while IFS= read -r candidate; do
    [ -z "$candidate" ] && continue
    case "$candidate" in
      *.*) if resource_exists "$candidate"; then printf '%s' "$candidate"; return 0; fi ;;
    esac
  done <<EOF_FULLNAME
$(resource_candidates "$kind")
EOF_FULLNAME
  # Envanterde bulunamadi: en spesifik adayi (tam adi) yine de dondur ki mesaj bos kalmasin.
  resource_candidates "$kind" | tail -n 1
}

# Listemizde OLMAYAN ama cluster'da bulunan olceklenebilir tipler.
# Olceklenebilirligin kesin olcutu `scale` alt kaynagidir. Grup keşif belgesi
# duz metin olarak taranir — jump sunucularinda `jq` OLMAYABILIR.
EXTRA_SCALABLE_RESOURCES=""
# TERCIH EDILEN GRUP SURUMLERI — TEK CAGRIDA.
#
# OLCULEN DARBOGAZ: `load_extra_scalable_resources` her API GRUBU icin IKI
# `oc get --raw` yapiyordu (once `/apis/<group>` ile tercih edilen surumu ogren,
# sonra `/apis/<gv>` ile kaynaklari listele). Gercek bir OpenShift'te ~50 namespace'li
# API grubu var: 100 API gidis-donusu, CLUSTER BASINA, HER KESIFTE.
#
# Sahte `oc` `--raw`a `exit 1` dondurdugu icin bu maliyet olcumlerde HIC gorunmuyordu
# (bkz. D12 bekcisi: artik `--raw`a CEVAP VEREN bir fixture ile sayiliyor).
#
# `/apis` TEK cagrida tum gruplarin `preferredVersion`unu doner; ilk cagri grup
# basina degil, KESIF BASINA bir kez yapilir. 2N -> 1+N.
#
# FAIL-SAFE: `/apis` okunamazsa liste bos kalir ve asagidaki dongu ESKI yola
# (grup basina sorgu) duser — davranis gerilemez, yalnizca yavaslar.
_APIS_PREFERRED=""
_APIS_PREFERRED_LOADED="no"

load_preferred_group_versions() {
  [ "$_APIS_PREFERRED_LOADED" = "yes" ] && return 0
  _APIS_PREFERRED_LOADED="yes"
  # `"preferredVersion":{"groupVersion":"apps/v1"` — aralarinda virgul YOK, bu yuzden
  # `tr ','` sonrasi ayni parcada kalirlar ve tercih edilmeyen surumlerle karismazlar.
  _APIS_PREFERRED="$(oc get --raw /apis 2>/dev/null \
    | tr ',' '\n' \
    | grep -o '"preferredVersion":{"groupVersion":"[^"]*"' \
    | sed 's/.*groupVersion":"//; s/"$//' || true)"
}

preferred_gv() {
  [ -z "$_APIS_PREFERRED" ] && return 1
  printf '%s\n' "$_APIS_PREFERRED" | grep -m1 "^$1/" 2>/dev/null || return 1
}

# ── YALNIZCA ISE YARAYAN EKSTRA TIPLER ──────────────────────────────────────
#
# URETIMDE OLCULDU (2026-09-30, iki AWX isi): enumerasyonun buldugu "ekstra"
# tiplerin HICBIRI kullaniciya bir sey kazandirmadi:
#   * `apps` grubunun KENDI tipleri (statefulsets.apps, replicasets.apps,
#     deployments.apps) YENIDEN basiliyordu. Sebep: grup bir kez atlanmayan
#     bir kaynak (controllerrevisions.apps) yuzunden taranir ve o grubun BUTUN
#     `*/scale` kaynaklari yayilirdi. Tekrar eden tip cok tipli cagrinin atifini
#     bozuyor ve tekil cagrilara dusuruyordu.
#   * Geri kalanlar platform altyapisi (machine/operator.openshift.io,
#     monitoring.coreos.com): uygulama ekibinin olcekleyecegi bir sey degil ve
#     servis hesabinin zaten okuma yetkisi yok — her kesifte bir `no_permission`
#     WARN'i uretip ekrani kirletiyordu.
#
# TEK SUZGEC, IKI KULLANIM: enumerasyonun ciktisi da, portaldan gelen (BAYAT
# olabilecek) onbellek listesi de buradan gecer. Yalnizca birine uygulamak,
# eski onbellekteki tekrarlari sonsuza dek tasirdi.
extra_kind_filter() {
  awk '
    NF == 0 { next }
    # Bilinen ve BILEREK disarida birakilan tipler (tam adlariyla).
    $0 == "deployments.apps" || $0 == "statefulsets.apps" || $0 == "daemonsets.apps" { next }
    $0 == "replicasets.apps" || $0 == "controllerrevisions.apps" { next }
    $0 == "cronjobs.batch" || $0 == "jobs.batch" { next }
    $0 == "deploymentconfigs.apps.openshift.io" || $0 == "rollouts.argoproj.io" { next }
    # Grupsuz ad: cekirdek API (replicationcontrollers, pods) — sahip olunan nesneler.
    $0 !~ /\./ { next }
    # Platform altyapisi gruplari.
    $0 ~ /\.openshift\.io$/ || $0 ~ /\.k8s\.io$/ { next }
    $0 ~ /\.monitoring\.coreos\.com$/ || $0 ~ /\.operators\.coreos\.com$/ { next }
    !seen[$0]++ { print }
  '
}

load_extra_scalable_resources() {
  local res group seen_groups="" gv
  [ "$CLUSTER_RESOURCES_OK" = "yes" ] || return 0
  load_preferred_group_versions
  while IFS= read -r res; do
    [ -z "$res" ] && continue
    case "$res" in
      # Zaten bildigimiz tipler ve BILEREK disarida biraktiklarimiz.
      deployments.apps|statefulsets.apps|daemonsets.apps|cronjobs.batch) continue ;;
      deploymentconfigs.apps.openshift.io|rollouts.argoproj.io) continue ;;
      # SAHIP OLUNAN nesneler: denetleyici saniyeler icinde geri alir.
      replicasets.apps|replicationcontrollers|pods|jobs.batch) continue ;;
      *.*) group="${res#*.}" ;;
      *) continue ;;
    esac
    case " $seen_groups " in *" $group "*) continue ;; esac
    seen_groups="$seen_groups $group"
    # ONCE toplu listeden; yoksa (eski yol) grup basina sorgu.
    gv="$(preferred_gv "$group" || true)"
    if [ -z "$gv" ]; then
      gv="$(oc get --raw "/apis/$group" 2>/dev/null | tr ',' '\n' | grep -o '"groupVersion":"[^"]*"' | head -n 1 | sed 's/.*:"//;s/"//')"
    fi
    [ -z "$gv" ] && continue
    oc get --raw "/apis/$gv" 2>/dev/null | tr ',' '\n' | grep -o '"name":"[^"]*/scale"' \
      | sed 's/.*:"//;s|/scale"||' | while IFS= read -r parent; do
        [ -z "$parent" ] && continue
        printf '%s.%s\n' "$parent" "$group"
      done
  done <<EOF_EXTRA
$CLUSTER_RESOURCES
EOF_EXTRA
}

# Enumerasyon + suzgec. `capabilities` modunun TEK girisi.
enumerate_extra_kinds() {
  load_extra_scalable_resources | extra_kind_filter | sort -u
}

resource_candidates() {
  case "$1" in
    dc) printf '%s\n' "dc" "deploymentconfig" "deploymentconfigs.apps.openshift.io" ;;
    deploy) printf '%s\n' "deploy" "deployment" "deployments.apps" ;;
    sts) printf '%s\n' "sts" "statefulset" "statefulsets.apps" ;;
    rollout) printf '%s\n' "rollout" "rollouts" "rollouts.argoproj.io" ;;
    ds) printf '%s\n' "ds" "daemonset" "daemonsets.apps" ;;
    cronjob) printf '%s\n' "cronjob" "cronjobs" "cronjobs.batch" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

canonical_kind_from_resource() {
  case "$1" in
    dc|deploymentconfig|deploymentconfigs.apps.openshift.io) echo "dc" ;;
    deploy|deployment|deployments.apps) echo "deploy" ;;
    sts|statefulset|statefulsets.apps) echo "sts" ;;
    rollout|rollouts|rollouts.argoproj.io) echo "rollout" ;;
    ds|daemonset|daemonsets.apps) echo "ds" ;;
    cronjob|cronjobs|cronjobs.batch) echo "cronjob" ;;
    *) echo "" ;;
  esac
}

# Portalin gonderdigi "app=kind,app=kind" haritasindan bu uygulamanin tipini okur.
# Bos doner: harita yok ya da bu uygulama haritada degil -> `auto` taramasi.
kind_from_map() {
  local app="$1" pair k
  [ -z "$WORKLOAD_KINDS_MAP" ] && return 0
  # SON SATIR NEWLINE ILE BITMELI. `printf '%s'` kullanildiginda `tr` ciktisinin son
  # satiri sonlandirilmamis kaliyor, `read` 1 donuyor ve dongu govdesi O SATIR ICIN
  # HIC CALISMIYOR. Tek ciftlik bir haritada ("kafka=sts") sonuc her zaman bos
  # oluyordu — yani ozellik sessizce hic calismiyordu.
  printf '%s\n' "$WORKLOAD_KINDS_MAP" | tr ',' '\n' | while IFS= read -r pair; do
    [ -z "$pair" ] && continue
    case "$pair" in
      "$app="*) k="${pair#*=}"; printf '%s' "$(normalize_lower "$k")"; break ;;
    esac
  done
}

first_working_resource() {
  local kind="$1" app="$2" candidate
  while IFS= read -r candidate; do
    [ -z "$candidate" ] && continue
    if oc get "$candidate" "$app" -n "$NS" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done <<EOF_RESOURCE_CANDIDATES
$(resource_candidates "$kind")
EOF_RESOURCE_CANDIDATES
  return 1
}

DETECTED_KIND=""
DETECTED_RESOURCE=""
DETECT_ERROR=""
detect_workload() {
  local app="$1" kind res found found_count mapped
  DETECTED_KIND=""; DETECTED_RESOURCE=""; DETECT_ERROR=""; found=""

  # ONCE PORTALIN SOYLEDIGI TIP. Portal kesifte bu uygulamanin tipini zaten gordu;
  # tahmin etmek yerine onu kullanmak `auto`'nun "ayni ad iki tipte var" halinde
  # isi dusurmesini ortadan kaldirir. Harita yanlissa (uygulama o tipte YOK) sessizce
  # kabul edilmez — `auto` taramasina DUSULMEZ, cunku bu bir yazim hatasi degil,
  # portalin kesfiyle cluster'in gercekliginin ayrismasidir ve sessizce baska bir
  # nesneye islem yapmak en tehlikeli sonuc olurdu.
  mapped="$(kind_from_map "$app")"
  if [ -n "$mapped" ]; then
    if ! kind_is_scalable "$mapped"; then
      DETECT_ERROR="not_scalable:$mapped"; return 1
    fi
    pc_detect_kind "$mapped" "$app"; case "$?" in
      0) DETECTED_KIND="$mapped"; DETECTED_RESOURCE="$(pc_short "$mapped")"; return 0 ;;
      1) DETECT_ERROR="not_found_as_portal_kind:$mapped"; return 1 ;;
    esac
    res="$(first_working_resource "$mapped" "$app" || true)"
    if [ -n "$res" ]; then
      DETECTED_KIND="$mapped"; DETECTED_RESOURCE="$res"; return 0
    fi
    DETECT_ERROR="not_found_as_portal_kind:$mapped"
    return 1
  fi

  if [ "$REQUESTED_KIND" != "auto" ]; then
    pc_detect_kind "$REQUESTED_KIND" "$app"; case "$?" in
      0) DETECTED_KIND="$REQUESTED_KIND"; DETECTED_RESOURCE="$(pc_short "$REQUESTED_KIND")"; return 0 ;;
      1) DETECT_ERROR="not_found_as_requested_kind:$REQUESTED_KIND"; return 1 ;;
    esac
    res="$(first_working_resource "$REQUESTED_KIND" "$app" || true)"
    if [ -n "$res" ]; then
      DETECTED_KIND="$REQUESTED_KIND"; DETECTED_RESOURCE="$res"; return 0
    fi
    DETECT_ERROR="not_found_as_requested_kind:$REQUESTED_KIND"
    return 1
  fi
  # AUTO: dort tipin DORDU de yetkiliyse dizinden; biri bile degilse hepsi eski
  # yoldan — karisik kaynakli bir "tek tipte bulundu" karari, okunamayan tipteki
  # ayni adi gormeyip belirsizligi SESSIZCE kaybederdi.
  if pc_index_ok dc && pc_index_ok deploy && pc_index_ok sts && pc_index_ok rollout; then
    for kind in dc deploy sts rollout; do
      pc_index_has "$kind" "$app" && found="${found}${kind}|$(pc_short "$kind")\n"
    done
    found_count="$(printf '%b' "$found" | awk 'NF{c++} END{print c+0}')"
    if [ "$found_count" -eq 1 ]; then
      DETECTED_KIND="$(printf '%b' "$found" | awk -F'|' 'NF{print $1; exit}')"
      DETECTED_RESOURCE="$(printf '%b' "$found" | awk -F'|' 'NF{print $2; exit}')"
      return 0
    fi
    if [ "$found_count" -gt 1 ]; then
      DETECT_ERROR="ambiguous:$(printf '%b' "$found" | awk -F'|' 'NF{print $1}' | paste -sd ',' -):rerun_discovery_or_set_workload_kind"
      return 1
    fi
    DETECT_ERROR="not_found"
    return 1
  fi
  for kind in dc deploy sts rollout; do
    res="$(first_working_resource "$kind" "$app" || true)"
    [ -n "$res" ] && found="${found}${kind}|${res}\n"
  done
  found_count="$(printf '%b' "$found" | awk 'NF{c++} END{print c+0}')"
  if [ "$found_count" -eq 1 ]; then
    DETECTED_KIND="$(printf '%b' "$found" | awk -F'|' 'NF{print $1; exit}')"
    DETECTED_RESOURCE="$(printf '%b' "$found" | awk -F'|' 'NF{print $2; exit}')"
    return 0
  fi
  if [ "$found_count" -gt 1 ]; then
    # Ayni ad birden fazla tipte var. Portal tip haritasini gonderdiginde bu dala
    # HIC girilmez; elle calistirmada kullaniciya ne yapacagi soylenir.
    DETECT_ERROR="ambiguous:$(printf '%b' "$found" | awk -F'|' 'NF{print $1}' | paste -sd ',' -):rerun_discovery_or_set_workload_kind"
    return 1
  fi
  # Last-resort combined scan retained for compatibility with older oc discovery behavior.
  local combined
  combined="$(oc get dc,deploy,sts,rollout -n "$NS" --no-headers 2>/dev/null | awk -v app="$app" '
    $1 == "deploymentconfig.apps.openshift.io/" app || $1 == "dc/" app {print "dc|dc"}
    $1 == "deployment.apps/" app || $1 == "deploy/" app {print "deploy|deploy"}
    $1 == "statefulset.apps/" app || $1 == "sts/" app {print "sts|sts"}
    $1 == "rollout.argoproj.io/" app || $1 == "rollouts.argoproj.io/" app || $1 == "rollout/" app {print "rollout|rollout"}
  ' | awk 'NF && !seen[$0]++')"
  found_count="$(printf '%s\n' "$combined" | awk 'NF{c++} END{print c+0}')"
  if [ "$found_count" -eq 1 ]; then
    DETECTED_KIND="$(printf '%s\n' "$combined" | awk -F'|' 'NF{print $1; exit}')"
    DETECTED_RESOURCE="$(printf '%s\n' "$combined" | awk -F'|' 'NF{print $2; exit}')"
    return 0
  fi
  [ "$found_count" -gt 1 ] && DETECT_ERROR="ambiguous:$(printf '%s\n' "$combined" | awk -F'|' 'NF{print $1}' | paste -sd ',' -)" || DETECT_ERROR="not_found"
  return 1
}

can_patch_kind() {
  local kind="$1" candidate
  while IFS= read -r candidate; do
    [ -z "$candidate" ] && continue
    if pc_cani patch "$candidate"; then
      return 0
    fi
  done <<EOF_PATCH_CANDIDATES
$(resource_candidates "$kind")
EOF_PATCH_CANDIDATES
  return 1
}

oc_get_jsonpath() {
  local res="$1" app="$2" jp="$3"
  oc get "$res" "$app" -n "$NS" -o "jsonpath=${jp}" 2>/dev/null || true
}
get_spec_replicas() {
  local v k
  # Dizin yetkiliyse spec oradan (ayni `{.spec.replicas}` alani).
  k="$(canonical_kind_from_resource "$1")"
  if [ -n "$k" ] && pc_index_ok "$k" && pc_index_has "$k" "$2"; then
    v="$(awk -F'|' -v a="$2" -v kn="$(pc_kind_name "$k")" '$1 == kn && $2 == a { print $3; exit }' "$PC_DIR/wl")"
  else
    v="$(oc_get_jsonpath "$1" "$2" '{.spec.replicas}')"
  fi
  [ -z "$v" ] && v=0; echo "$v"
}
get_status_replicas() { local v; v="$(oc_get_jsonpath "$1" "$2" '{.status.replicas}')"; [ -z "$v" ] && v=0; echo "$v"; }
get_ready_replicas() { local v; v="$(oc_get_jsonpath "$1" "$2" '{.status.readyReplicas}')"; [ -z "$v" ] && v=0; echo "$v"; }

# UC ALAN, TEK CAGRI — doğrulama dongusunun maliyeti.
#
# `verify_replicas` her denemede yukaridaki UC fonksiyonu ayri ayri cagiriyordu,
# yani deneme basina UC `oc` gidis-donusu. Butce 60 sn iken bu 90 cagriydi; 300 sn'ye
# cikarilinca 450 olurdu. Tek jsonpath ucunu birden getirir: 450 -> 150, kademeli
# bekleme ile ~40.
#
# `RV_*` degiskenleri BILEREK global: `local` bir fonksiyondan cagirana deger
# donduremez ve uc degeri stdout'tan ayristirmak ek bir alt kabuk demekti.
RV_DESIRED=0; RV_CURRENT=0; RV_READY=0
read_replica_state() {
  local raw
  raw="$(oc_get_jsonpath "$1" "$2" '{.spec.replicas}|{.status.replicas}|{.status.readyReplicas}')"
  RV_DESIRED="${raw%%|*}"; raw="${raw#*|}"
  RV_CURRENT="${raw%%|*}"
  RV_READY="${raw#*|}"
  # Alan yoksa `oc` BOS birakir (0 yazmaz) — okunmayan alan 0 sayilir.
  [ -z "$RV_DESIRED" ] && RV_DESIRED=0
  [ -z "$RV_CURRENT" ] && RV_CURRENT=0
  [ -z "$RV_READY" ] && RV_READY=0
}

# KADEMELI BEKLEME. Sabit 2 sn ile 300 sn'lik butce 150 deneme demekti; ilk
# saniyeler disinda o siklikta sormanin bir faydasi yok. Ilk 30 sn 2 sn, 2 dk'ya
# kadar 5 sn, sonrasi 10 sn: 150 -> ~40 deneme.
# "300" -> "5 dk", "90" -> "1 dk 30 sn", "45" -> "45 sn".
# `$((x / 60))` kullanmak kisa surelerde "0 dk" yaziyordu.
human_seconds() {
  local n="$1" m sec
  m=$((n / 60)); sec=$((n % 60))
  if [ "$m" -eq 0 ]; then printf '%s sn' "$sec"
  elif [ "$sec" -eq 0 ]; then printf '%s dk' "$m"
  else printf '%s dk %s sn' "$m" "$sec"; fi
}

verify_sleep_for() {
  local elapsed="$1"
  if [ "$elapsed" -lt 30 ]; then printf '2'
  elif [ "$elapsed" -lt 120 ]; then printf '5'
  else printf '10'; fi
}

patch_replicas() {
  local kind="$1" app="$2" target="$3" candidate
  while IFS= read -r candidate; do
    [ -z "$candidate" ] && continue
    if oc get "$candidate" "$app" -n "$NS" >/dev/null 2>&1 && \
       oc patch "$candidate" "$app" -n "$NS" --type=merge -p "{\"spec\":{\"replicas\":${target}}}" >/dev/null 2>&1; then
      DETECTED_RESOURCE="$candidate"
      return 0
    fi
  done <<EOF_PATCH_RESOURCE
$(resource_candidates "$kind")
EOF_PATCH_RESOURCE
  return 1
}

safe_name() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9.-]/-/g' | sed 's/^-*//;s/-*$//' | cut -c1-180
}
# DURUM KAYDI ONEKI DEGISTI: `chaos-scale-state-` -> `scalex-state-`.
#
# ESKI ONEK OKUNMAYA DEVAM ETMEK ZORUNDA. Bugun durdurulmus olan uygulamalarin
# kaydi eski onekle duruyor; yalnizca yeni onege bakmak, o uygulamalarin
# GERI ALINAMAZ hale gelmesi demekti (portal "Su an durdurulmus" der, geri alma
# "state ConfigMap not found" ile duser). Portal da bunu bekliyor: kesif satiri
# eski kayitlari `legacy=yes` rozetiyle isaretliyor (bkz. server/scalex/result.cjs).
#
# COZUM: `state_cm_name` VAR OLAN kaydin adini doner (once yeni onek, sonra eski).
# Hicbiri yoksa YENI onekli adi doner — yani yazim her zaman yeni oneke gider ama
# eski bir kayit varsa YERINDE guncellenir. Boylece "tek uygulama, tek kayit"
# degismezi korunur; iki onekli iki kayit olusmaz.
STATE_CM_PREFIX="scalex-state-"
STATE_CM_PREFIX_LEGACY="chaos-scale-state-"

# Tek girisli onbellek: betik uygulamalari SIRAYLA isliyor ve bu fonksiyon uygulama
# basina birkac kez cagriliyor. Onbelleksiz her cagri fazladan bir `oc get` demekti.
_STATE_CM_APP=""
_STATE_CM_NAME=""
# Ad aramasi kaydin VAR olup olmadigini da ogrenir; `state_exists` ayni soruyu
# ikinci bir `oc get` ile sormasin.
_STATE_CM_EXISTS=""
state_cm_name() {
  local app="$1" n l
  if [ -n "$_STATE_CM_APP" ] && [ "$_STATE_CM_APP" = "$app" ]; then
    printf '%s' "$_STATE_CM_NAME"; return 0
  fi
  n="${STATE_CM_PREFIX}$(safe_name "$app")"
  l="${STATE_CM_PREFIX_LEGACY}$(safe_name "$app")"
  _STATE_CM_EXISTS="yes"
  if [ "$PC_ON" = "yes" ] && [ "$PC_CM_OK" = "yes" ]; then
    if pc_cm_has "$n"; then _STATE_CM_NAME="$n"
    elif pc_cm_has "$l"; then _STATE_CM_NAME="$l"
    else _STATE_CM_NAME="$n"; _STATE_CM_EXISTS="no"; fi
  elif oc get cm "$n" -n "$NS" >/dev/null 2>&1; then
    _STATE_CM_NAME="$n"
  elif oc get cm "$l" -n "$NS" >/dev/null 2>&1; then
    _STATE_CM_NAME="$l"
  else
    _STATE_CM_NAME="$n"; _STATE_CM_EXISTS="no"
  fi
  _STATE_CM_APP="$app"
  printf '%s' "$_STATE_CM_NAME"
}

# Kayit silindiginde/olusturuldugunda onbellek BAYATLAR. Silme sonrasi bayat ad,
# "hala var" yanilgisi uretirdi.
state_cm_cache_clear() { _STATE_CM_APP=""; _STATE_CM_NAME=""; _STATE_CM_EXISTS=""; }
get_cm_data() { oc get cm "$1" -n "$NS" -o "jsonpath={.data.$2}" 2>/dev/null || true; }
state_exists() {
  # Onbellek BU uygulama icin gecerliyse ad aramasinin ogrendigi yeterli.
  if [ "$_STATE_CM_APP" = "$1" ] && [ -n "$_STATE_CM_EXISTS" ]; then
    [ "$_STATE_CM_EXISTS" = "yes" ]; return
  fi
  if [ "$PC_ON" = "yes" ] && [ "$PC_CM_OK" = "yes" ]; then pc_cm_has "$(state_cm_name "$1")"; return; fi
  oc get cm "$(state_cm_name "$1")" -n "$NS" >/dev/null 2>&1
}
pc_cm_has() { awk -F'|' -v n="$1" '$1 == n { f = 1 } END { exit f ? 0 : 1 }' "$PC_DIR/cm"; }

# DURUM KAYDININ TUM ALANLARI — TEK OKUMA. `validate_restore_state` ve
# `get_restore_target` eskiden alan basina ayri `get` yapiyordu (dokuz cagri).
# Precheck'te listeden, degilse kayit basina TEK `get` (execute'ta TAZE okuma).
CMR_PREV=""; CMR_APP=""; CMR_NS=""; CMR_CLUSTER=""; CMR_KIND=""; CMR_RES=""; CMR_PHASE=""; CMR_VERSION=""
cm_record() {
  local line
  if [ "$PC_ON" = "yes" ] && [ "$PC_CM_OK" = "yes" ]; then
    line="$(awk -F'|' -v n="$1" '$1 == n { sub(/^[^|]*\|/, ""); print; exit }' "$PC_DIR/cm")"
  else
    line="$(oc get cm "$1" -n "$NS" -o "jsonpath=${PC_CM_FIELDS}" 2>/dev/null || true)"
  fi
  IFS='|' read -r CMR_PREV CMR_APP CMR_NS CMR_CLUSTER CMR_KIND CMR_RES CMR_PHASE CMR_VERSION <<EOF_CMR
$line
EOF_CMR
}
get_restore_target() {
  local cm v; cm="$(state_cm_name "$1")"; cm_record "$cm"; v="$CMR_PREV"
  printf '%s' "$v" | grep -Eq '^[0-9]+$' || return 1
  echo "$v"
}

validate_restore_state() {
  local app="$1" kind="$2" res="$3" verbose="${4:-yes}" cm prev state_app state_ns state_cluster state_kind state_res state_phase state_version display state_res_kind
  display="$(kind_to_display "$kind")"; cm="$(state_cm_name "$app")"
  if ! state_exists "$app"; then
    [ "$verbose" = "yes" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "Restore state ConfigMap not found: $cm. Run stop first."
    return 1
  fi
  cm_record "$cm"
  prev="$CMR_PREV"
  state_app="$CMR_APP"; state_ns="$CMR_NS"; state_cluster="$CMR_CLUSTER"
  state_kind="$CMR_KIND"; state_res="$CMR_RES"; state_phase="$CMR_PHASE"; state_version="$CMR_VERSION"
  if ! printf '%s' "$prev" | grep -Eq '^[0-9]+$'; then
    [ "$verbose" = "yes" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "State $cm contains invalid previous_replicas=$prev"
    return 1
  fi
  [ -n "$state_app" ] && [ "$state_app" != "$app" ] && { [ "$verbose" = "yes" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "State app mismatch current=$app state=$state_app"; return 1; }
  [ -n "$state_ns" ] && [ "$state_ns" != "$NS" ] && { [ "$verbose" = "yes" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "State namespace mismatch current=$NS state=$state_ns"; return 1; }
  [ -n "$state_cluster" ] && [ "$state_cluster" != "$CLUSTER" ] && { [ "$verbose" = "yes" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "State cluster mismatch current=$CLUSTER state=$state_cluster"; return 1; }
  [ -n "$state_kind" ] && [ "$state_kind" != "$kind" ] && { [ "$verbose" = "yes" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "State workload kind mismatch current=$kind state=$state_kind"; return 1; }
  if [ -n "$state_res" ]; then
    state_res_kind="$(canonical_kind_from_resource "$state_res")"
    [ -n "$state_res_kind" ] && [ "$state_res_kind" != "$kind" ] && { [ "$verbose" = "yes" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "State resource mismatch current_kind=$kind state_resource=$state_res"; return 1; }
  fi
  if [ "$verbose" = "yes" ]; then
    if [ -z "$state_version" ]; then
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "INFO" "Legacy state accepted for backward compatibility cm=$cm previous_replicas=$prev"
    elif [ "$state_phase" = "scaled_down" ]; then
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "OK" "Restore target from state: previous_replicas=$prev cm=$cm version=$state_version"
    else
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "WARN" "State phase=$state_phase; restore will use stored previous_replicas=$prev cm=$cm"
    fi
  fi
  return 0
}

save_scale_down_state() {
  local app="$1" kind="$2" res="$3" previous="$4" cm phase existing_prev ts display
  cm="$(state_cm_name "$app")"; ts="$(date -u +%FT%TZ)"; display="$(kind_to_display "$kind")"
  if state_exists "$app"; then
    phase="$(get_cm_data "$cm" phase)"; existing_prev="$(get_cm_data "$cm" previous_replicas)"
    if [ "$phase" = "scaled_down" ] && printf '%s' "$existing_prev" | grep -Eq '^[0-9]+$'; then
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "WARN" "Existing scaled_down state retained; previous_replicas=$existing_prev cm=$cm"
      return 0
    fi
  fi
  oc create cm "$cm" -n "$NS" \
    --from-literal=version="2" \
    --from-literal=app="$app" \
    --from-literal=namespace="$NS" \
    --from-literal=cluster="$CLUSTER" \
    --from-literal=kind="$kind" \
    --from-literal=resource="$res" \
    --from-literal=previous_replicas="$previous" \
    --from-literal=phase="preparing" \
    --from-literal=created_at="$ts" \
    --from-literal=job_id="$JOB_ID" \
    --from-literal=created_by="$CREATED_BY" \
    --dry-run=client -o yaml | oc apply -n "$NS" -f - >/dev/null 2>&1
  local rc=$?
  # Kayit YENI olusturulmus olabilir; ad onbellegi bayatladi.
  state_cm_cache_clear
  return $rc
}

mark_state_scaled_down() {
  local cm; cm="${2:-}"; [ -z "$cm" ] && cm="$(state_cm_name "$1")"
  oc patch cm "$cm" -n "$NS" --type=merge -p "{\"data\":{\"phase\":\"scaled_down\",\"updated_at\":\"$(date -u +%FT%TZ)\"}}" >/dev/null 2>&1 || true
}
mark_state_restore_completed() {
  local cm; cm="$(state_cm_name "$1")"
  oc patch cm "$cm" -n "$NS" --type=merge -p "{\"data\":{\"phase\":\"restore_completed\",\"updated_at\":\"$(date -u +%FT%TZ)\"}}" >/dev/null 2>&1 || true
}
finalize_restore_state() {
  local app="$1" kind_display="$2" cm; cm="${3:-}"; [ -z "$cm" ] && cm="$(state_cm_name "$app")"
  if oc auth can-i delete configmaps -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    if oc delete cm "$cm" -n "$NS" --ignore-not-found=true >/dev/null 2>&1; then
      # Silindi: bayat ad "kayit hala var" yanilgisi uretmesin.
      state_cm_cache_clear
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$kind_display" "STATE" "OK" "Deleted restore state ConfigMap $cm after successful restore"
      return 0
    fi
  fi
  if oc auth can-i patch configmaps -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    mark_state_restore_completed "$app"
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$kind_display" "STATE" "WARN" "Restore completed; state could not be deleted and was marked restore_completed cm=$cm"
    return 0
  fi
  log "$CLUSTER" "$JUMP_SERVER" "$app" "$kind_display" "STATE" "WARN" "Restore completed but state ConfigMap could not be deleted or marked complete cm=$cm"
  return 0
}

# Sabitleme yalnizca su UC kosul birlikte saglandiginda anlamli:
#   * kullanici EKRANDA acikca istedi (`hpa_pin=true`)
#   * islem `stop` DEGIL (0'da HPA zaten devre disi kalir)
#   * hedef >= 1 (`minReplicas: 0` reddedilir ya da uygulamayi 0'da kilitler)
# Portal ayni kurali sunucuda da uyguluyor (launch.isHpaPinAllowed); burada TEKRAR
# uygulaniyor cunku betik AWX'ten ELLE de calistirilabilir ve o yolda portal yok.
hpa_pin_wanted() {
  local target="$1"
  [ "$(normalize_lower "$HPA_PIN")" = "true" ] || return 1
  [ "$ACTION" != "stop" ] || return 1
  printf '%s' "$target" | grep -Eq '^[0-9]+$' || return 1
  [ "$target" -ge 1 ] || return 1
  return 0
}

# HPA'nin min/max degerlerini hedefe esitler. HPA YOKSA sessizce gecer — sabitleme
# istegi, olmayan bir HPA yuzunden islemi DUSURMEMELI (kullanici replica'yi zaten
# istedigi yere cekti; sabitleme bir ek koruma).
pin_hpa() {
  local app="$1" display="$2" target="$3" hpa_name
  hpa_name="$(oc get hpa -n "$NS" -o jsonpath="{range .items[?(@.spec.scaleTargetRef.name==\"$app\")]}{.metadata.name}{end}" 2>/dev/null || true)"
  [ -z "$hpa_name" ] && hpa_name="$(oc get hpa "$app" -n "$NS" -o jsonpath='{.metadata.name}' 2>/dev/null || true)"
  if [ -z "$hpa_name" ]; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "HPA" "INFO" "HPA pin requested but no HPA targets this workload; nothing to pin"
    return 0
  fi
  if ! oc auth can-i patch hpa -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "HPA" "WARN" "HPA pin requested but patch permission is missing hpa=$hpa_name"
    return 0
  fi
  if oc patch hpa "$hpa_name" -n "$NS" --type=merge -p "{\"spec\":{\"minReplicas\":$target,\"maxReplicas\":$target}}" >/dev/null 2>&1; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "HPA" "OK" "HPA pinned hpa=$hpa_name min=$target max=$target (explicitly requested)"
  else
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "HPA" "WARN" "HPA pin failed hpa=$hpa_name target=$target; replicas were still set"
  fi
  return 0
}

log_hpa_state() {
  local app="$1" display="$2" exact target lines
  if [ "$PC_ON" = "yes" ] && [ "$PC_HPA_OK" = "yes" ]; then
    # Tek liste: adi uygulamayla ayni olan satir (`oc get hpa <app>`in basacagi
    # satirin AYNISI) + hedefi uygulamayi gosterenler.
    exact="$(awk -v app="$app" '$1 == app' "$PC_DIR/hpa")"
    target="$(awk -v app="$app" 'index($0, "/" app) > 0 {print}' "$PC_DIR/hpa")"
  else
    exact="$(oc get hpa "$app" -n "$NS" --no-headers 2>/dev/null || true)"
    target="$(oc get hpa -n "$NS" --no-headers 2>/dev/null | awk -v app="$app" 'index($0, "/" app) > 0 {print}' || true)"
  fi
  lines="$(printf '%s\n%s\n' "$exact" "$target" | awk 'NF && !seen[$0]++')"
  if [ -n "$lines" ]; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "HPA" "INFO" "HPA_PRESENT read-only policy; left untouched: $lines"
  else
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "HPA" "INFO" "No HPA found for application/scaleTargetRef"
  fi
}
log_object_line() {
  local app="$1" display="$2" res="$3" line
  if [ "$PC_ON" = "yes" ] && [ "$(cat "$PC_DIR/obj_$res.rc" 2>/dev/null)" = "0" ]; then
    line="$(awk -v app="$app" '$1 == app' "$PC_DIR/obj_$res")"
  else
    line="$(oc get "$res" "$app" -n "$NS" --no-headers 2>/dev/null || true)"
  fi
  [ -n "$line" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "OBJECT" "INFO" "$line"
}
log_pod_state() {
  local app="$1" display="$2" target="$3" pods
  if ! oc auth can-i list pods -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PODS" "WARN" "Pod reporting skipped because list pods permission is unavailable"
    return 0
  fi
  pods="$(oc get pods -n "$NS" --no-headers 2>/dev/null | grep -F "$app" || true)"
  if [ -z "$pods" ]; then
    [ "$target" = "0" ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PODS" "OK" "No pod found; expected for target replicas=0" || log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PODS" "INFO" "No matching pod visible yet; readiness may still be converging"
  else
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PODS" "INFO" "$pods"
  fi
}

# ── DOGRULAMA: ACMA ve KAPATMA ARTIK AYNI SEY DEGIL ──────────────────────────
#
# KULLANICI KARARI (2026-09-17). Eski davranis simetrikti: tek bir butce, dolunca
# her iki yon de FAIL. Iki sorunu vardi:
#
#   * KAPATMA'da erken FAIL YANILTICIYDI. `oc patch` basarili olmus, pod'lar
#     terminationGracePeriod boyunca kapaniyor olabilir. "FAIL" diyen bir satir,
#     aslinda calisan bir islemi basarisiz gosteriyordu.
#   * ACMA'da FAIL GEREKSIZDI. Replica degisikligi UYGULANDI; pod'un hazir olmasi
#     imaj cekme/probe suresine bagli ve otomasyonun sorumlulugunda degil.
#
# YENI TABLO:
#   ACMA  (target > 0): WARN esiginde BEKLEMEYI BIRAK, uyari yaz, BASARILI don.
#   KAPATMA (target = 0): WARN esiginde uyari yaz ama BEKLEMEYE DEVAM; FAIL esiginde FAIL.
#
# "0/0" ve "0/1": olcut artik `ready`yi de iceriyor (kullanicinin kendi ifadesi).
# TEK DEGERLENDIRME — seri ve toplu dogrulama AYNI karar tablosunu kullanir.
# RV_* (okunmus durum) ve gecen sure verilir; satiri basar ve doner:
#   0 = bitti, basarili   1 = bitti, FAIL   2 = beklemeye devam
# $5 bu uygulama icin uyari DAHA ONCE basildi mi (0/1). Kapatma uyarisini
# basarsa `VE_WARNED=1` yapar; cagiran bunu hatirlamali (uyari BIR kez).
VE_WARNED=0
verify_eval() {
  local app="$1" display="$2" target="$3" elapsed="$4" warned="$5"
  VE_WARNED=0
  # BASARI OLCUTU — IKI YONDE FARKLI.
  #
  # KAPATMA ("0/0"): istenen 0 VE ayakta pod yok.
  # ACMA   ("N/N"): istenen ve ayakta olan hedefte OLMASI YETMEZ, HAZIR da olmali.
  #
  # OLCULDU: `.status.replicas` pod olusur olusmaz hedefe esitleniyor, yani eski
  # olcutle acma HEMEN "OK" donuyordu ve kullanicinin istedigi "aciliyor, 0/1,
  # 5 dk'dir" uyarisi HIC ATESLENEMIYORDU. Beklenen sey pod'un HAZIR olmasi.
  if [ "$target" = "0" ]; then
    if [ "$RV_DESIRED" = "0" ] && [ "$RV_CURRENT" = "0" ]; then
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "VERIFY" "OK" \
        "desired=$RV_DESIRED current=$RV_CURRENT ready=$RV_READY target=0"
      return 0
    fi
  else
    if [ "$RV_DESIRED" = "$target" ] && [ "$RV_CURRENT" = "$target" ] && [ "$RV_READY" = "$target" ]; then
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "VERIFY" "OK" \
        "desired=$RV_DESIRED current=$RV_CURRENT ready=$RV_READY target=$target"
      return 0
    fi
  fi

  if [ "$elapsed" -ge "$VERIFY_WARN_SECONDS" ] && [ "$warned" -eq 0 ]; then
    VE_WARNED=1
    if [ "$target" = "0" ]; then
      # KAPATMA: uyar ama BEKLEMEYE DEVAM.
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "VERIFY" "WARN" \
        "scale 0 komutu calisti ama 0 olmasi $(human_seconds "$VERIFY_WARN_SECONDS") gecti; hala $RV_CURRENT pod var — beklemeye devam ediliyor (fail esigi $(human_seconds "$VERIFY_FAIL_SECONDS"))"
    else
      # ACMA: uyar ve BIRAK — is basarili sayilir.
      #
      # `applied=yes` MAKINE BELIRTECI. `VERIFY;OK` BASMIYORUZ: pod hazir degilken
      # "dogrulandi" demek yalan olurdu. Ama rapor asamasi (20_build_report.yml)
      # hedef durumunu `VERIFY;OK` satirinin VARLIGINA gore veriyordu, yani bu
      # satir hicbir makine-okunur sinyal tasimadigi icin hedef "yalnizca uyari"
      # dalina dusuyor, portal de onu GERI ALMA HATASI sayiyordu (2026-09-17
      # uretim tespiti: is ConfigMap'i silmisti, ekran "geri alinamadi" diyordu).
      # Dogru bilgi "uygulandi ama hazir degil" ve satir artik bunu SOYLUYOR.
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "VERIFY" "WARN" \
        "applied=yes aciliyor, $RV_READY/$target, $(human_seconds "$VERIFY_WARN_SECONDS") bekleniyor; replica degisikligi UYGULANDI, pod hazir olmayi surduruyor"
      return 0
    fi
  fi

  # FAIL ESIGI YALNIZCA KAPATMADA. Acma yukarida zaten donmus olur.
  if [ "$target" = "0" ] && [ "$elapsed" -ge "$VERIFY_FAIL_SECONDS" ]; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "VERIFY" "FAIL" \
      "0 olmasi $(human_seconds "$VERIFY_FAIL_SECONDS") gecti expected=$target desired=$RV_DESIRED current=$RV_CURRENT ready=$RV_READY"
    return 1
  fi
  return 2
}

verify_replicas() {
  local app="$1" display="$2" res="$3" target="$4"
  local start now elapsed warned=0 sl v
  start="$(date +%s)"
  while :; do
    read_replica_state "$res" "$app"
    now="$(date +%s)"; elapsed=$((now - start))
    verify_eval "$app" "$display" "$target" "$elapsed" "$warned"; v=$?
    [ "$v" -eq 0 ] && return 0
    [ "$v" -eq 1 ] && return 1
    [ "$VE_WARNED" -eq 1 ] && warned=1
    sl="$(verify_sleep_for "$elapsed")"
    sleep "$sl"
  done
}

# ── TOPLU DOGRULAMA: TEK DONGU, TUM UYGULAMALAR ─────────────────────────────
#
# Seri yolda her uygulama KENDI dogrulamasini bitirene kadar sonrakine
# gecilmiyordu: 19 uygulama = 19 ardisik pod sonlanma beklemesi. Oysa pod'lar
# PARALEL kapanir; beklemeyi sirayla yapmak toplam sureyi uygulama sayisiyla
# carpiyordu.
#
# Burada her turda bekleyen HER uygulama yoklanir — tip basina TEK liste
# okumasiyla — ve karar `verify_eval`e (seri yolun AYNI tablosu) birakilir.
# Biten duser; esigi asan KENDI WARN/FAIL satirini alir. Toplam bekleme = EN
# YAVAS uygulamanin suresi.
#
# $1: satir basina `app|display|res|target|...` (ek alanlar tasinir)
# Sonuc: `VM_OK` — basariyla biten satirlar (girdi sirasi korunur).
VM_OK=""
verify_many() {
  local liste="$1" start now elapsed sl pending yeni warned=" " satir a d r t kalan tipler tip dosya rcs v
  VM_OK=""
  start="$(date +%s)"
  pending="$liste"
  dosya="$(mktemp -d "${WORKDIR}/.scalex_vm_XXXXXX" 2>/dev/null || true)"
  while :; do
    # Bekleyen tiplerin HER BIRI icin tek liste okumasi.
    tipler="$(printf '%s' "$pending" | awk -F'|' 'NF >= 4 && !s[$3]++ { print $3 }')"
    rcs=" "
    if [ -n "$dosya" ]; then
      for tip in $tipler; do
        if oc get "$tip" -n "$NS" \
            -o 'jsonpath={range .items[*]}{.metadata.name}|{.spec.replicas}|{.status.replicas}|{.status.readyReplicas}{"\n"}{end}' \
            >"$dosya/$tip" 2>/dev/null; then
          rcs="$rcs$tip "
        fi
      done
    fi
    now="$(date +%s)"; elapsed=$((now - start))
    yeni=""
    while IFS= read -r satir; do
      [ -z "$satir" ] && continue
      IFS='|' read -r a d r t kalan <<EOF_VM_SATIR
$satir
EOF_VM_SATIR
      case "$rcs" in
        *" $r "*)
          # Listede YOKSA (silinmis) tekil okuma gibi 0/0/0 sayilir.
          IFS='|' read -r RV_DESIRED RV_CURRENT RV_READY <<EOF_VM_DURUM
$(awk -F'|' -v a="$a" '$1 == a { print $2 "|" $3 "|" $4; exit }' "$dosya/$r")
EOF_VM_DURUM
          [ -z "$RV_DESIRED" ] && RV_DESIRED=0
          [ -z "$RV_CURRENT" ] && RV_CURRENT=0
          [ -z "$RV_READY" ] && RV_READY=0
          ;;
        # Liste okunamadi (yetki/gecici hata): o uygulama TEKIL okunur.
        *) read_replica_state "$r" "$a" ;;
      esac
      case "$warned" in *" $a "*) w=1 ;; *) w=0 ;; esac
      verify_eval "$a" "$d" "$t" "$elapsed" "$w"; v=$?
      if [ "$v" -eq 0 ]; then
        VM_OK="${VM_OK}${satir}
"
      elif [ "$v" -eq 2 ]; then
        [ "$VE_WARNED" -eq 1 ] && warned="$warned$a "
        yeni="${yeni}${satir}
"
      fi
    done <<EOF_VM_LISTE
$pending
EOF_VM_LISTE
    pending="$yeni"
    [ -z "$(printf '%s' "$pending" | awk 'NF')" ] && break
    sl="$(verify_sleep_for "$elapsed")"
    sleep "$sl"
  done
  [ -n "$dosya" ] && rm -rf "$dosya" >/dev/null 2>&1
  return 0
}

precheck_app() {
  local app="$1" display current cm prev
  if ! detect_workload "$app"; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "-" "PRECHECK" "FAIL" "Workload detection failed: ERROR:$DETECT_ERROR"
    return 1
  fi
  display="$(kind_to_display "$DETECTED_KIND")"; current="$(get_spec_replicas "$DETECTED_RESOURCE" "$app")"
  # AD ONBELLEGI ANA KABUKTA DOLAR. `cm="$(state_cm_name ...)"` alt kabukta
  # kosuyordu ve onbellege yazilan deger KAYBOLUYORDU: ayni uygulama icin ad
  # aramasi (iki `oc get cm`) her cagrida yeniden yapiliyordu. Burada bir kez
  # dogrudan cagrilir; sonraki `$(state_cm_name ...)`ler onbellekten okur.
  state_cm_name "$app" >/dev/null; cm="$_STATE_CM_NAME"
  log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "DISCOVERY" "OK" "Detected resource=$DETECTED_RESOURCE current_spec_replicas=$current"
  log_object_line "$app" "$display" "$DETECTED_RESOURCE"
  log_hpa_state "$app" "$display"
  if ! can_patch_kind "$DETECTED_KIND"; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PRECHECK" "FAIL" "Missing patch permission for workload kind=$DETECTED_KIND namespace=$NS"
    return 1
  fi
  case "$ACTION" in
    stop)
      if [ "$current" = "0" ]; then
        if validate_restore_state "$app" "$DETECTED_KIND" "$DETECTED_RESOURCE" "no"; then
          prev="$(get_restore_target "$app" || true)"
          log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PRECHECK" "OK" "Workload is already 0 but valid reversible state exists previous_replicas=$prev cm=$cm"
          return 0
        fi
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PRECHECK" "FAIL" "Workload is already 0 and no valid previous-replica state exists; refusing to create misleading previous_replicas=0 state"
        return 1
      fi
      ;;
    restore)
      validate_restore_state "$app" "$DETECTED_KIND" "$DETECTED_RESOURCE" "yes" || return 1
      prev="$(get_restore_target "$app" || true)"
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PRECHECK" "OK" "Patch permission OK; restore target previous_replicas=$prev"
      return 0
      ;;
    scale)
      if [ "$TARGET" -ge "$SCALE_WARN_THRESHOLD" ] 2>/dev/null && [ "$TARGET" -gt "$current" ] 2>/dev/null; then
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "SCALE_GUARD" "WARN" "Large requested target replicas=$TARGET current=$current; review capacity before apply"
      fi
      ;;
  esac
  log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PRECHECK" "OK" "Patch permission OK for workload kind=$DETECTED_KIND"
  return 0
}

# ── EXECUTE DORT PARCA ──────────────────────────────────────────────────────
#
# Seri yol (`execute_app`) ve toplu yol (`execute_batch`) AYNI parcalari
# kullanir; seri yol parcalarin art arda cagrilmasindan ibaret. Boylece iki
# yolun satirlari ve kararlari TANIM GEREGI ayni kalir — toplu yol yalnizca
# SIRAYI degistirir (once hepsi hazirlanir, sonra hepsi patch'lenir, sonra
# TEK dogrulama dongusu).
#
# 1. execute_prepare — TAZE okuma + durum kaydi + "zaten hedefte" kisa devresi.
#    GUVENLIK SIRASI KORUNUR: `stop`ta durum kaydi YAZILAMAYAN uygulama patch
#    listesine HIC girmez (bugunku "kayit yoksa patch yok" kurali, uygulama
#    basina).
# 2. ex_patch       — `spec.replicas` patch'i (+ acikca istenmisse HPA sabitleme).
# 3. dogrulama      — `verify_replicas` (seri) / `verify_many` (toplu).
# 4. ex_finish      — durum kaydini isaretle/sonlandir, OBJECT ve PODS satirlari.
#    Dogrulamasi DUSEN uygulamada KOSMAZ (bugunku davranis).
EX_DISPLAY=""; EX_TARGET=""; EX_STEP=""; EX_CURRENT=""; EX_CM=""; EX_PATCH="no"; EX_POST="none"
execute_prepare() {
  local app="$1" display current effective_target action_step cm prev
  EX_PATCH="no"; EX_POST="none"
  if ! detect_workload "$app"; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "-" "RECHECK" "FAIL" "Workload detection failed immediately before mutation: ERROR:$DETECT_ERROR"
    return 1
  fi
  display="$(kind_to_display "$DETECTED_KIND")"; current="$(get_spec_replicas "$DETECTED_RESOURCE" "$app")"
  state_cm_name "$app" >/dev/null; cm="$_STATE_CM_NAME"
  if ! can_patch_kind "$DETECTED_KIND"; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "RECHECK" "FAIL" "Patch permission is no longer available for workload kind=$DETECTED_KIND"
    return 1
  fi
  case "$ACTION" in
    stop)
      action_step="KAPAT"; effective_target=0
      if [ "$current" = "0" ]; then
        if validate_restore_state "$app" "$DETECTED_KIND" "$DETECTED_RESOURCE" "no"; then
          prev="$(get_restore_target "$app" || true)"
          log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "$action_step" "OK" "Already replicas=0; existing reversible state retained previous_replicas=$prev cm=$cm"
        else
          log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "RECHECK" "FAIL" "Already replicas=0 but reversible state is missing/invalid"
          return 1
        fi
      else
        if ! save_scale_down_state "$app" "$DETECTED_KIND" "$DETECTED_RESOURCE" "$current"; then
          log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "Failed to save previous_replicas=$current to $cm"
          return 1
        fi
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "OK" "Saved reversible state previous_replicas=$current cm=$cm job_id=$JOB_ID"
        EX_PATCH="yes"; EX_POST="mark"
      fi
      ;;
    restore)
      action_step="GERI_AL"; EX_POST="finalize"
      if ! validate_restore_state "$app" "$DETECTED_KIND" "$DETECTED_RESOURCE" "no"; then
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "RECHECK" "FAIL" "Restore state became missing/invalid before mutation"
        return 1
      fi
      effective_target="$(get_restore_target "$app" || true)"
      if [ "$current" = "$effective_target" ]; then
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "$action_step" "OK" "Already at restore target replicas=$effective_target; no patch required"
      else
        EX_PATCH="yes"
      fi
      ;;
    scale)
      action_step="SCALE"; effective_target="$TARGET"
      if [ "$current" = "$effective_target" ]; then
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "$action_step" "OK" "Already at requested replicas=$effective_target; no patch required"
      else
        EX_PATCH="yes"
      fi
      ;;
  esac
  EX_DISPLAY="$display"; EX_TARGET="$effective_target"; EX_STEP="$action_step"; EX_CURRENT="$current"; EX_CM="$cm"
  return 0
}

# DETECTED_KIND / DETECTED_RESOURCE ve EX_* kurulmus olmali. Basarida
# DETECTED_RESOURCE patch'in GERCEKTEN uygulandigi aday adina guncellenir.
ex_patch() {
  local app="$1"
  log "$CLUSTER" "$JUMP_SERVER" "$app" "$EX_DISPLAY" "$EX_STEP" "INFO" "Current replicas=$EX_CURRENT target=$EX_TARGET; workload spec.replicas will be patched. HPA will not be changed."
  if ! patch_replicas "$DETECTED_KIND" "$app" "$EX_TARGET"; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$EX_DISPLAY" "$EX_STEP" "FAIL" "Patch command failed for target replicas=$EX_TARGET"
    return 1
  fi
  log "$CLUSTER" "$JUMP_SERVER" "$app" "$EX_DISPLAY" "$EX_STEP" "OK" "Patch accepted replicas=$EX_TARGET.$(hpa_pin_wanted "$EX_TARGET" && printf '%s' ' HPA will be pinned to the target.' || printf '%s' ' HPA was not changed.')"
  # HPA SABITLEME. Varsayilan davranis (bayrak kapali) DEGISMEDI: HPA okunur,
  # dokunulmaz. Bayrak acikken bile hedef 0 ise sabitleme YAPILMAZ — `minReplicas: 0`
  # ya API tarafindan reddedilir (HPAScaleToZero kapali) ya da uygulamayi 0'da
  # KILITLER, yani "geri al" hicbir seyi ayaga kaldirmaz.
  if hpa_pin_wanted "$EX_TARGET"; then
    pin_hpa "$app" "$EX_DISPLAY" "$EX_TARGET"
  fi
  return 0
}

# $1 app $2 display $3 res $4 target $5 post (mark|finalize|none) $6 cm
ex_finish() {
  local app="$1" display="$2" res="$3" target="$4" post="$5" cm="$6"
  if [ "$post" = "mark" ]; then
    mark_state_scaled_down "$app" "$cm"
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "OK" "Marked state ConfigMap $cm as scaled_down"
  elif [ "$post" = "finalize" ]; then
    finalize_restore_state "$app" "$display" "$cm"
  fi
  log_object_line "$app" "$display" "$res"
  log_pod_state "$app" "$display" "$target"
  return 0
}

execute_app() {
  local app="$1"
  execute_prepare "$app" || return 1
  if [ "$EX_PATCH" = "yes" ]; then
    ex_patch "$app" || return 1
  fi
  verify_replicas "$app" "$EX_DISPLAY" "$DETECTED_RESOURCE" "$EX_TARGET" || return 1
  ex_finish "$app" "$EX_DISPLAY" "$DETECTED_RESOURCE" "$EX_TARGET" "$EX_POST" "$EX_CM"
}

# ── TOPLU EXECUTE ───────────────────────────────────────────────────────────
#
# OLCULDU: seri yolda her uygulama kendi dogrulamasini BITIRMEDEN sonrakine
# gecilmiyordu; kapatmada bu, pod'larin terminationGracePeriod'u kadar bekleme
# demek — 19 uygulama x 30 sn = ~10 dk, CLUSTER BASINA. Pod'lar ise PARALEL
# kapanir. Toplu yolda toplam bekleme en yavas uygulamanin suresi.
#
# Satirlar uygulama ICINDE ayni sirada basilir; uygulamalar ARASI sira degisir
# (rapor (cluster, uygulama) ile grupladigi icin bu anlamsiz — bkz. altin cikti
# bekcisi K2).
#
# GERI DONUS: `SCALEX_BATCH_EXECUTE=false` -> seri yol birebir (kod silinmedi).
execute_batch() {
  local app plan="" dogrulanacak="" a d k r t p post cm cur step
  while IFS= read -r app; do
    [ -z "$app" ] && continue
    execute_prepare "$app" || continue
    plan="${plan}${app}|${EX_DISPLAY}|${DETECTED_KIND}|${DETECTED_RESOURCE}|${EX_TARGET}|${EX_PATCH}|${EX_POST}|${EX_CM}|${EX_CURRENT}|${EX_STEP}
"
  done <<EOF_EX_APPS
$APPS_TEXT
EOF_EX_APPS

  while IFS='|' read -r a d k r t p post cm cur step; do
    [ -z "$a" ] && continue
    if [ "$p" = "yes" ]; then
      DETECTED_KIND="$k"; DETECTED_RESOURCE="$r"
      EX_DISPLAY="$d"; EX_TARGET="$t"; EX_STEP="$step"; EX_CURRENT="$cur"
      ex_patch "$a" || continue
      r="$DETECTED_RESOURCE"
    fi
    dogrulanacak="${dogrulanacak}${a}|${d}|${r}|${t}|${post}|${cm}
"
  done <<EOF_EX_PLAN
$plan
EOF_EX_PLAN

  [ -z "$dogrulanacak" ] && return 0
  verify_many "$dogrulanacak"

  while IFS='|' read -r a d r t post cm; do
    [ -z "$a" ] && continue
    ex_finish "$a" "$d" "$r" "$t" "$post" "$cm"
  done <<EOF_EX_OK
$VM_OK
EOF_EX_OK
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════
# KESIF (salt okunur) — portalin `scalex_discovery` template'i buradan beslenir.
#
# CIKTI SOZLESMESI: portal `detail` alanini `anahtar=deger` ciftleri olarak
# ayristirir; ayrac BOSLUK, dolayisiyla DEGERLERDE BOSLUK OLAMAZ ve bilinmeyen
# deger `-` yazilir (bkz. server/scalex/result.cjs parseDetailPairs).
# `disc_val` bu kurali TEK yerden uygular — her deger buradan gecmeli.
# ═══════════════════════════════════════════════════════════════════════════

# Bosluk/`;` iceren ya da bos olan degeri guvenli hale getirir. `;` YASAK cunku
# satir ayraci odur; bosluk YASAK cunku `detail` icindeki cift ayracidir.
disc_val() {
  local _dvv
  disc_val_v _dvv "${1:-}"
  printf '%s' "$_dvv"
}

# `disc_val`in alt kabuksuz esi (sonuc $1 adli degiskene):
#   tr -d '\n\r'  ->  tr ' \t;' '___'  ->  bos ise "-"
disc_val_v() {
  local _v="${2:-}"
  _v="${_v//$_NL/}"
  _v="${_v//$_CR/}"
  _v="${_v// /_}"
  _v="${_v//$_TAB/_}"
  _v="${_v//;/_}"
  [ -z "$_v" ] && _v="-"
  printf -v "$1" '%s' "$_v"
}

# Namespace'teki HPA hedefleri — uygulama basina `oc get hpa` yerine TEK cagri.
DISC_HPA_TARGETS=""
disc_load_hpa() {
  DISC_HPA_TARGETS="$(oc get hpa -n "$NS" -o jsonpath='{range .items[*]}{.spec.scaleTargetRef.name}{"\n"}{end}' 2>/dev/null || true)"
}
# DUZ METIN esleme (eskiden `grep -qx`, yani REGEX: `a.b` adi `axb` hedefini
# de "HPA'li" sayiyordu). Satir basina surec acmaz.
disc_has_hpa_v() {
  case "$_NL$DISC_HPA_TARGETS$_NL" in
    *"$_NL$2$_NL"*) printf -v "$1" '%s' "yes" ;;
    *) printf -v "$1" '%s' "no" ;;
  esac
}
disc_has_hpa() {
  local _hv
  disc_has_hpa_v _hv "$1"
  printf '%s' "$_hv"
}

# PDB namespace duzeyinde bildirilir: bir PDB'nin hangi workload'u kapsadigini
# ucuza ve dogru kanitlamak mumkun degil (selector eslesmesi gerekir). Portal da
# bunu namespace uyarisi olarak gosteriyor.
disc_pdb() {
  disc_pdb_emit "$(oc get pdb -n "$NS" --no-headers 2>/dev/null || true)"
}
disc_pdb_emit() {
  local lines="$1" count
  [ -z "$lines" ] && return 0
  count="$(printf '%s\n' "$lines" | grep -c . || true)"
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "PDB" "WARN" \
    "$(disc_val "PDB_COUNT=$count") namespace=$(disc_val "$NS") pdb=$(printf '%s\n' "$lines" | awk '{print $1}' | paste -sd, - | tr -d ' ')"
}

# Durum kaydindan (varsa) `phase` ve `previous_replicas` okur; `state_cm_name`
# eski oneki de tanidigi icin bugun durdurulmus uygulamalar da gorunur.
DISC_STATE_PHASE="-"
DISC_STATE_PREV="-"
# ── DURUM KAYITLARI: NAMESPACE BASINA TEK CAGRI ──────────────────────────────
#
# OLCULEN DARBOGAZ. `disc_read_state` uygulama BASINA 5'e kadar `oc` calistiriyordu:
# `state_cm_name` yeni oneki dener (1), legacy oneki dener (2), sonra varlik
# kontrolu (3) ve iki `jsonpath` okumasi (4-5). Her biri bastion uzerinden tam bir
# API gidis-donusu.
#
# `backend-architecture-test` olcegi: 22 uygulama x 2 tip = ~44 satir x 3 cluster
# = 132 satir x 5 = ~660 `oc` cagrisi. ~150 ms'den ~100 sn — kullanicinin
# bildirdigi "1 dk 36 sn" ile ortusuyor.
#
# `discover_state` ZATEN dogru deseni kullaniyordu (namespace basina TEK toplu
# okuma). Ayni cagri burada da kullanilir; sonuc bellekte aranir. 660 -> 1.
#
# NOT: `disc_load_hpa` ve `disc_pdb` namespace basina BIRER cagridir (uygulama
# basina degil) — onlar darbogaz DEGILDI, dokunulmadi.
DISC_STATES=""

disc_load_states() {
  # Yetki yoksa `get` reddedilir ve cikti BOS kalir; durum alanlari "-" olur.
  # Kesif bundan dolayi DUSMEZ: durum kaydi bir zenginlestirmedir. (Ayri bir
  # `oc auth can-i` on kontrolu ayni sonucu bir gidis-donus PAHASINA veriyordu.)
  DISC_STATES="$(oc get cm -n "$NS" -o jsonpath="$(disc_states_jsonpath)" 2>/dev/null || true)"
}

# `discover_state` ile BIREBIR AYNI alan duzeni:
#   name|app|kind|previous_replicas|phase|created_at|created_by|job_id
# Iki yerin ayni sozlesmeyi paylasmasi, birinin sessizce eskimesini onler.
disc_states_jsonpath() {
  printf '%s' '{range .items[*]}{.metadata.name}{"|"}{.data.app}{"|"}{.data.kind}{"|"}{.data.previous_replicas}{"|"}{.data.phase}{"|"}{.data.created_at}{"|"}{.data.created_by}{"|"}{.data.job_id}{"\n"}{end}'
}

disc_read_state() {
  local app="$1" n l line
  DISC_STATE_PHASE="-"; DISC_STATE_PREV="-"
  [ -z "$DISC_STATES" ] && return 0
  n="${STATE_CM_PREFIX}$(safe_name "$app")"
  l="${STATE_CM_PREFIX_LEGACY}$(safe_name "$app")"
  # ONCELIK YENI ONEKTE. Iki kayit birden varsa (gecis donemi) yeni olan gecerlidir;
  # `oc`nin listeleme sirasina birakmak, ayni namespace'te iki farkli sonuc uretirdi.
  line="$(printf '%s\n' "$DISC_STATES" | awk -F'|' -v n="$n" '$1==n {print; exit}')"
  if [ -z "$line" ]; then
    line="$(printf '%s\n' "$DISC_STATES" | awk -F'|' -v l="$l" '$1==l {print; exit}')"
  fi
  # `data.app` dolu olan kayitlar icin ad eslesmesi de kabul edilir: eski kayitlarda
  # CM adi uygulamanin `safe_name`inden farkli olabiliyor.
  if [ -z "$line" ]; then
    line="$(printf '%s\n' "$DISC_STATES" | awk -F'|' -v a="$app" '$2==a {print; exit}')"
  fi
  [ -z "$line" ] && return 0
  DISC_STATE_PREV="$(printf '%s' "$line" | cut -d'|' -f4)"
  DISC_STATE_PHASE="$(printf '%s' "$line" | cut -d'|' -f5)"
  [ -z "$DISC_STATE_PHASE" ] && DISC_STATE_PHASE="-"
  printf '%s' "$DISC_STATE_PREV" | grep -Eq '^[0-9]+$' || DISC_STATE_PREV="-"
}

# ── DURUM KAYITLARI: TIP BASINA TEK `awk` ───────────────────────────────────
#
# `disc_read_state` SATIR BASINA iki `safe_name` alt kabugu, uc `awk`, iki
# `cut` ve bir `grep` aciyordu (uygulama sayisiyla buyuyen maliyet). Burada
# AYNI kural tip BASINA bir kez uygulanir: her satirin ONUNE `prev|phase`
# eklenir. Oncelik ve bicim `disc_read_state` ile BIREBIR:
#   yeni onek + safe_name  >  eski onek + safe_name  >  `data.app` eslesmesi
#   ilk eslesen kayit; `phase` bossa "-"; `prev` yalnizca rakamsa, degilse "-"
# `safe_name` awk'ta: kucuk harf, [^a-z0-9.-] -> "-", bastaki/sondaki "-"
# kirpilir, SONRA 180 karakter.
#
# $1 satir dosyasi  $2 cikti dosyasi. Basarisizsa (awk yok/yazilamadi) satirlar
# `?|?|` ile isaretlenir ve cagiran eski tekil yola (`disc_read_state`) duser —
# durum bilgisi SESSIZCE kaybolmaz.
disc_join_states() {
  local src="$1" dst="$2" stf="${2}.s" l
  if printf '%s\n' "$DISC_STATES" >"$stf" 2>/dev/null && awk -F'|' \
      -v sf="$stf" -v np="$STATE_CM_PREFIX" -v lp="$STATE_CM_PREFIX_LEGACY" '
    function sn(x) {
      x = tolower(x); gsub(/[^a-z0-9.-]/, "-", x)
      sub(/^-+/, "", x); sub(/-+$/, "", x)
      return substr(x, 1, 180)
    }
    FILENAME == sf {
      if ($0 == "") next
      if (!($1 in byn)) byn[$1] = $0
      if ($2 != "" && !($2 in bya)) bya[$2] = $0
      next
    }
    {
      line = ""; s = sn($2)
      if ((np s) in byn) line = byn[np s]
      else if ((lp s) in byn) line = byn[lp s]
      else if ($2 != "" && ($2 in bya)) line = bya[$2]
      prev = "-"; phase = "-"
      if (line != "") {
        split(line, f, "|"); prev = f[4]; phase = f[5]
        if (phase == "") phase = "-"
        if (prev !~ /^[0-9]+$/) prev = "-"
      }
      print prev "|" phase "|" $0
    }' "$stf" "$src" >"$dst" 2>/dev/null; then
    rm -f "$stf" >/dev/null 2>&1
    return 0
  fi
  rm -f "$stf" >/dev/null 2>&1
  while IFS= read -r l; do printf '?|?|%s\n' "$l"; done <"$src" >"$dst"
}

# ArgoCD/operator etiketleri. ArgoCD auto-sync acikken replica 0 birkac DAKIKADA
# sessizce geri alinir — dogrula-ve-tut penceresi (saniyeler) bunu yakalayamaz,
# o yuzden kullaniciya ONCEDEN soylenmesi gerekiyor.
disc_gitops() {
  local _gv
  disc_gitops_v _gv "$1" "$2"
  printf '%s' "$_gv"
}
disc_gitops_v() {
  local _g
  if [ -n "$2" ]; then disc_val_v _g "$2"; printf -v "$1" 'argocd:%s' "$_g"; return 0; fi
  if [ -n "$3" ]; then disc_val_v _g "$3"; printf -v "$1" 'managed_by:%s' "$_g"; return 0; fi
  printf -v "$1" '%s' "no"
}

# Istenen uygulama listesi bosken NAMESPACE'IN TAMAMI listelenir (ekran uygulama
# adini ezberden bilmek zorunda kalmasin); doluysa yalnizca istenenler.
#
# Ham satir BASINA cagrilir (istenmeyen uygulamalar dahil): surec acmaz. Esleme
# DUZ METIN (eskiden `grep -qx` = regex; `.` her karakterle eslesiyordu).
disc_app_wanted() {
  [ -z "$APPS_TEXT" ] && return 0
  case "$_NL$APPS_TEXT$_NL" in
    *"$_NL$1$_NL"*) return 0 ;;
  esac
  return 1
}

# ── TEK USTKUME JSONPATH ────────────────────────────────────────────────────
#
# ESKIDEN tip basina AYRI jsonpath vardi (deploy/sts/dc/rollout bir bicim, ds bir
# bicim, cronjob bir bicim) ve bu, tip basina AYRI bir `oc get` demekti. Cok tipli
# tek cagri ancak TEK bir jsonpath ile yapilabilir; o yuzden alanlarin USTKUMESI
# basilir ve OLMAYAN alanlar BOS gelir (`--allow-missing-template-keys=true`).
# Okuyan taraf hangi alanin hangi tipte anlamli oldugunu zaten biliyor.
#
# ALAN SIRASI (14, `|` ayracli) — DEGISTIRMEDEN once `disc_emit_row`a bak:
#   1 kind   2 name   3 spec.replicas   4 status.replicas   5 status.readyReplicas
#   6 spec.suspend    7 spec.schedule
#   8 desiredNumberScheduled  9 currentNumberScheduled  10 numberReady
#   11 image (template)  12 image (cronjob jobTemplate)  13 argocd  14 managed-by
#
# `{.kind}` ILK ALAN: cok tipli bir cagrida satirin hangi tipten geldigini ancak o
# soyler. Bu desen bu depoda URETIMDE kullaniliyor (LogX `logx_ocp_app_discovery.yml`
# cok tipli `oc get`i, `{.kind}` ile ayni sekilde ayristiriyor).
disc_jsonpath_all() {
  local argo='{.metadata.labels['"'"'argocd\.argoproj\.io/instance'"'"']}'
  local mgd='{.metadata.labels['"'"'app\.kubernetes\.io/managed-by'"'"']}'
  printf '%s' '{range .items[*]}{.kind}{"|"}{.metadata.name}{"|"}{.spec.replicas}{"|"}{.status.replicas}{"|"}{.status.readyReplicas}{"|"}{.spec.suspend}{"|"}{.spec.schedule}{"|"}{.status.desiredNumberScheduled}{"|"}{.status.currentNumberScheduled}{"|"}{.status.numberReady}{"|"}{.spec.template.spec.containers[0].image}{"|"}{.spec.jobTemplate.spec.template.spec.containers[0].image}{"|"}'"$argo"'{"|"}'"$mgd"'{"\n"}{end}'
}

# ── KIND -> TAM KAYNAK ADI: SABIT TABLO ─────────────────────────────────────
#
# Cok tipli cagrinin dondurdugu `{.kind}` bir KIND'dir ("Deployment"), kaynak adi
# degil. Bilinen alti tip icin esleme DEGISMEZ (Kubernetes/OpenShift API'si), bu
# yuzden cluster'a SORULMAZ — eskiden `oc api-resources` ile okunuyordu ve kesfin
# en pahali tek adimiydi (istemci tarafi 1-3 sn).
#
# Ekstra CRD'lerin KIND'i burada YOK ve TAHMIN EDILMEZ: coguldan tekile giden
# bir kural yok ("prometheuses" -> "Prometheus", "kafkas" -> "Kafka"). Bos donmesi o tipin TEKIL cekilmesi demek; satirlarin tipi o zaman cagirandan
# bilinir, atif gerekmez.
kind_of_resource() {
  case "$1" in
    deployments.apps) echo "Deployment" ;;
    statefulsets.apps) echo "StatefulSet" ;;
    deploymentconfigs.apps.openshift.io) echo "DeploymentConfig" ;;
    rollouts.argoproj.io) echo "Rollout" ;;
    daemonsets.apps) echo "DaemonSet" ;;
    cronjobs.batch) echo "CronJob" ;;
    *) echo "" ;;
  esac
}

# ── OKUNAMAYAN TIPIN SEBEBI: `oc`NIN KENDI HATA METNINDEN ───────────────────
#
# kubectl API yoklugunu kaynak cozumlemesinde yakalar ve SUNUCUYA GITMEDEN
# `the server doesn't have a resource type "<kaynak>"` yazar (grup kismi YOK:
# `rollouts.argoproj.io` icin "rollouts"). Yetki reddi ise sunucudan gelir:
# `Error from server (Forbidden): ...`. Ikisi ayri metinler; `oc auth can-i`ye
# bakilmaz (kendisi hata verdiginde sonuc TERSINE doner — D7b'nin sebebi).
#
# Envanter okunmussa (`capabilities` modu) o da kabul edilir; okunmamissa karar
# yalnizca hata metnine dayanir. Metin taninmazsa `no_permission` — eski
# davranis: "bakamadim" demek, "yok" demekten GUVENLI.
disc_reason() {
  local res="$1" hata="${2:-}" kisa
  kisa="${res%%.*}"
  if [ -n "$hata" ] && [ -s "$hata" ] && grep -Eq -- "resource type \"($kisa|$res)\"" "$hata" 2>/dev/null; then
    echo "api_absent"; return 0
  fi
  if [ "$CLUSTER_RESOURCES_OK" = "yes" ] && ! resource_exists "$res"; then
    echo "api_absent"; return 0
  fi
  echo "no_permission"
}

# ── OBEK BUYUKLUGU ──────────────────────────────────────────────────────────
# Tek cagriya konan tip sayisi. Sinirsiz birakmak, bozuk TEK bir tipin butun
# taramayi tekil cagrilara dusurmesi demekti; 20, "cagri sayisi" ile "yikim
# yaricapi" arasinda olculebilir bir orta yol.
DISC_CHUNK=20

DISC_FOUND_ANY=0

# ── BIR TIPIN OKUNUP OKUNAMADIGI ────────────────────────────────────────────
#
# Probe dongusunun TEK gercek isi buydu: "bu tipi listeleyebiliyor muyum".
# Cevabi ayri bir cagriyla (`oc auth can-i --list`) almak denendi ve GERI ALINDI:
# RBAC "evet" dese bile okuma baska bir sebeple dusebilir (kapatilmis aggregated
# APIService, gecici sunucu hatasi) ve o durumda ekran "namespace'te yok" derdi —
# tam olarak probe'un engelledigi yanilgi.
#
# Cagrinin KENDI rc'si ve stderr'i ayni soruyu BEDAVA cevapliyor; eski kod onlari
# `2>/dev/null || true` ile atiyordu. Artik atmiyoruz.

# Tek tip icin tekil cekim (GERI DUSUS YOLU ve atif kurulamayan tipler).
# Cikti bicimi birlesik cagriyla AYNI ustkume satiridir; tek fark `{.kind}`
# alaninin BOS gelmesi (tek tipli `oc get` TypeMeta yazmaz) — okuyan taraf tipi
# zaten cagirandan biliyor. DONUS DEGERI ONEMLI: 0 = okundu, 1 = okunamadi.
disc_fetch_single() {
  oc get "$1" -n "$NS" --allow-missing-template-keys=true \
    -o jsonpath="$(disc_jsonpath_all)" >"$2" 2>"${3:-/dev/null}"
}

# ── TEKIL CEKIMLER: AYNI ANDA, SINIRLI ──────────────────────────────────────
#
# URETIMDE OLCULDU (AWX 3365168/81/88): onbellekteki ekstra CRD'ler (KIND'leri
# sabit tabloda yok, atif kurulamaz) her kesifte SIRAYLA tekil cekiliyordu;
# yetkisiz iki tip bile bastion uzerinden saniyeler ekliyordu. Cagrilar
# birbirinden BAGIMSIZ: dalga basina en fazla DISC_PAR tanesi arka planda
# kosar (bash 3.2'de `wait -n` yok — dalga dalga).
#
# $1 dizin, kalan argumanlar TIP kodlari. i. tip -> $1/s.<i> (satirlar),
# $1/s.<i>.err, $1/s.<i>.rc (0 okundu / 1 okunamadi). Sonuclar
# `disc_emit_fetched` ile SIRAYLA basilir.
DISC_PAR=8
disc_fetch_many() {
  local dir="$1" i=0 n=0 k pids=""
  shift
  for k in "$@"; do
    (
      r="$(full_resource_name "$k")"
      _src=0
      disc_fetch_single "$r" "$dir/s.$i" "$dir/s.$i.err" || _src=1
      printf '%s' "$_src" >"$dir/s.$i.rc"
    ) &
    pids="$pids $!"
    i=$((i + 1)); n=$((n + 1))
    if [ "$n" -ge "$DISC_PAR" ]; then
      wait $pids 2>/dev/null
      pids=""; n=0
    fi
  done
  [ -n "$pids" ] && wait $pids 2>/dev/null
  return 0
}

# `disc_fetch_many`in i. sonucunu basar. `.rc` dosyasi YOKSA (alt kabuk
# oldu) okuma DUSMUS sayilir — "bulunamadi" demek "bakamadim"dan tehlikeli.
disc_emit_fetched() {
  local k="$1" dir="$2" i="$3" r rf=yes
  r="$(full_resource_name "$k")"
  [ -f "$dir/s.$i" ] || : >"$dir/s.$i"
  [ "$(cat "$dir/s.$i.rc" 2>/dev/null)" = "0" ] && rf=no
  disc_emit_kind "$k" "$r" "$dir/s.$i" "$rf" "$dir/s.$i.err"
}

# Bir tipin satirlarini WORKLOAD satirlarina cevirir ve SONUNDA tam olarak BIR
# `WORKLOAD_KIND` satiri basar.
#
# DEGISMEZ KURAL: `kinds_to_scan` icindeki HER tip icin tam olarak BIR
# `WORKLOAD_KIND` satiri cikar — ya `OK found=N` ya `WARN reason=...`. Ekran
# "StatefulSet yok" ile "StatefulSet'e bakamadim"i bu satirla ayiriyor.
#
# $1 kind  $2 kaynak adi  $3 satir dosyasi  $4 okuma dustu mu (yes|no)
# $5 o cagrinin stderr dosyasi (sebep oradan okunur; bos olabilir)
disc_emit_kind() {
  local kind="$1" res="$2" dosya="$3" okuma_dustu="$4" hata="${5:-}"
  local name f2 f3 f4 image argo managed sprev sphase
  local k_field r3 r4 r5 susp sched dsr cur rdy img cjimg
  local count=0 raw=0 reason verb
  local disp v_ns v_res v2 v3 v4 v_img v_ph v_pr v_hpa v_git j
  # SATIR DONGUSUNDE `$(...)` YOK (N1 bekcisi kilitler): tipe ve namespace'e
  # ait degerler burada BIR KEZ, satira ait olanlar `*_v` ile degiskene yazilir.
  kind_to_display_v disp "$kind"
  disc_val_v v_ns "$NS"
  disc_val_v v_res "$res"
  j="${dosya}.j"
  disc_join_states "$dosya" "$j"
  while IFS='|' read -r sprev sphase k_field name r3 r4 r5 susp sched dsr cur rdy img cjimg argo managed; do
    [ -z "$name" ] && continue
    raw=$((raw + 1))
    disc_app_wanted "$name" || continue
    DISC_FOUND_ANY=1
    count=$((count + 1))
    if [ "$sprev" = "?" ]; then
      disc_read_state "$name"
      sprev="$DISC_STATE_PREV"; sphase="$DISC_STATE_PHASE"
    fi
    # USTKUME SATIRINDAN TIPE OZGU ALANLAR. Hangi alanin hangi tipte anlamli
    # oldugu BURADA, tek yerde yazili.
    case "$kind" in
      ds)      f2="$dsr"; f3="$cur"; f4="$rdy"; image="$img" ;;
      cronjob) f2="$susp"; f3="$sched"; f4=""; image="$cjimg" ;;
      *)       f2="$r3"; f3="$r4"; f4="$r5"; image="$img" ;;
    esac
    disc_val_v v_img "$image"
    disc_gitops_v v_git "$argo" "$managed"
    if kind_is_scalable "$kind"; then
      [ -z "$f2" ] && f2=0
      [ -z "$f3" ] && f3=0
      [ -z "$f4" ] && f4=0
      disc_val_v v2 "$f2"; disc_val_v v3 "$f3"; disc_val_v v4 "$f4"
      disc_has_hpa_v v_hpa "$name"
      disc_val_v v_ph "$sphase"; disc_val_v v_pr "$sprev"
      log "$CLUSTER" "$JUMP_SERVER" "$name" "$disp" "WORKLOAD" "OK" \
        "namespace=$v_ns resource=$v_res scalable=yes spec=$v2 status=$v3 ready=$v4 hpa=$v_hpa state_phase=$v_ph previous_replicas=$v_pr image=$v_img gitops=$v_git"
    elif kind_is_discovered_crd "$kind"; then
      # Cluster'dan kesfedildi, `scale` alt kaynagi var — ama islem yolu bu tip icin
      # kanitlanmadi (bkz. kind_is_discovered_crd). Gorunur, secilemez.
      [ -z "$f2" ] && f2=0
      [ -z "$f4" ] && f4=0
      disc_val_v v2 "$f2"; disc_val_v v4 "$f4"
      log "$CLUSTER" "$JUMP_SERVER" "$name" "$disp" "WORKLOAD" "OK" \
        "namespace=$v_ns resource=$v_res scalable=no reason=unsupported_kind spec=$v2 ready=$v4 image=$v_img gitops=$v_git"
    elif [ "$kind" = "cronjob" ]; then
      # `spec.suspend` bos gelebilir (alan hic yazilmamissa) — o durumda CronJob
      # AKTIFTIR, "bilinmiyor" degil.
      [ -z "$f2" ] && f2="false"
      disc_val_v v2 "$f2"; disc_val_v v3 "$f3"
      log "$CLUSTER" "$JUMP_SERVER" "$name" "$disp" "WORKLOAD" "OK" \
        "namespace=$v_ns resource=$v_res scalable=no reason=suspend_not_replicas suspended=$v2 schedule=$v3 image=$v_img gitops=$v_git"
    else
      [ -z "$f2" ] && f2=0
      [ -z "$f4" ] && f4=0
      disc_val_v v2 "$f2"; disc_val_v v4 "$f4"
      log "$CLUSTER" "$JUMP_SERVER" "$name" "$disp" "WORKLOAD" "OK" \
        "namespace=$v_ns resource=$v_res scalable=no reason=node_scheduled desired=$v2 ready=$v4 image=$v_img gitops=$v_git"
    fi
  done < "$j"
  rm -f "$j" >/dev/null 2>&1

  # SATIR GELDIYSE ya da OKUMA DUSMEDIYSE tip okunabilmistir. (`count` 0 olabilir —
  # istenen uygulama suzgeci; bu "bakamadim" DEGIL.)
  if [ "$raw" -gt 0 ] || [ "$okuma_dustu" != "yes" ]; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "$(kind_to_display "$kind")" "WORKLOAD_KIND" "OK" \
      "namespace=$(disc_val "$NS") kind=$(disc_val "$kind") resource=$(disc_val "$res") found=$(disc_val "$count") scalable=$(kind_is_scalable "$kind" && echo yes || echo no)$(kind_is_discovered_crd "$kind" && printf ' %s' 'discovered=yes' || true)"
    return 0
  fi

  # ── OKUNAMADI: IKI AYRI SEBEP ─────────────────────────────────────────────
  # Eskiden karar `oc auth can-i`nin BASARISINA dayaniyordu ve `can-i`nin KENDISI
  # hata verdiginde sonuc TERSINE doniyordu. Olcut artik `oc get`in KENDI hata
  # metni (bkz. disc_reason).
  verb="list"
  reason="$(disc_reason "$res" "$hata")"
  log "$CLUSTER" "$JUMP_SERVER" "-" "$(kind_to_display "$kind")" "WORKLOAD_KIND" "WARN" \
    "kind=$(disc_val "$kind") resource=$(disc_val "$res") reason=$(disc_val "$reason") verb=$(disc_val "$verb") namespace=$(disc_val "$NS")"
}

# Bir obegi TEK `oc get` ile tarar.
#
# $1 tipler  $2..$4 (opsiyonel) ONCEDEN CEKILMIS ilk denemenin cikti/hata/rc
# dosyalari — `disc_ns_prefetch` ilk cagriyi namespace okumalariyla AYNI ANDA
# yapar; burada yeniden yapilmaz.
#
# ATIF KURULAMAYAN TIPLER OBEGI OLDURMEZ — AYRILIR ve tekil cekilir. Bilinen bir
# tip icin bu bir GERI DUSUSTUR ve `SCAN;WARN;combined_fallback=yes` ile SOYLENIR.
# Kesfedilen bir CRD icin ise BEKLENEN yoldur (KIND'i sabit tabloda yok) ve WARN
# basilmaz — her kesifte ayni uyariyi basmak ekrani anlamsiz kirletirdi.
#
# API'SI OLMAYAN TIP: kubectl kaynak cozumlemesinde durur ve obekteki HICBIR tipin
# satirini basmaz. Hata metni hangi tipin olmadigini soyler; o tip `api_absent`
# ile raporlanir, obekten cikarilir ve cagri KALANLARLA bir kez daha yapilir.
# Tekil cagrilara dusmekten ucuz (Argo Rollouts kurulu olmayan her cluster'da
# 6 cagri yerine 2) ve SESSIZ DEGIL: tipin kendi `WORKLOAD_KIND;WARN` satiri var.
disc_scan_chunk() {
  local kinds="$1" on_out="${2:-}" on_err="${3:-}" on_rc="${4:-}"
  local k r kind_name pairs="" tekiller="" seen="" kinds_re="" res_csv=""
  local out err tek rc bad ayrisan=0 rf yok yasak kalan cikan deneme=0 i tdir

  for k in $kinds; do
    r="$(full_resource_name "$k")"
    kind_name="$(kind_of_resource "$r")"
    if [ -z "$kind_name" ]; then
      tekiller="$tekiller $k"
      kind_is_discovered_crd "$k" || ayrisan=$((ayrisan + 1))
      continue
    fi
    # IKI tip ayni KIND'e dusuyor: satirlar dogru tipe YAZILAMAZ, tahmin yok.
    case " $seen " in
      *" $kind_name "*) tekiller="$tekiller $k"; ayrisan=$((ayrisan + 1)); continue ;;
    esac
    seen="$seen $kind_name"
    pairs="${pairs}${kind_name}	${k}	${r}
"
  done

  out="$(mktemp "${WORKDIR}/.scalex_scan_XXXXXX" 2>/dev/null || true)"
  err="$(mktemp "${WORKDIR}/.scalex_scan_err_XXXXXX" 2>/dev/null || true)"
  tek="$(mktemp "${WORKDIR}/.scalex_scan_one_XXXXXX" 2>/dev/null || true)"
  if [ -z "$out" ] || [ -z "$err" ] || [ -z "$tek" ]; then
    # Buraya normalde GELINMEZ: gecici dosya yaratilamiyorsa betik kubeconfig
    # adiminda coktan durmus olurdu. Yine de sessiz kalmiyoruz.
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "SCAN" "FAIL" \
      "combined_fallback=no reason=workdir_unavailable namespace=$(disc_val "$NS")"
    rm -f "$out" "$err" "$tek" >/dev/null 2>&1 || true
    return 0
  fi

  if [ "$ayrisan" -gt 0 ]; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "SCAN" "WARN" \
      "combined_fallback=yes reason=attribution_unavailable kinds=$(disc_val "$ayrisan") namespace=$(disc_val "$NS")"
  fi

  while [ -n "$(printf '%s' "$pairs" | awk 'NF')" ]; do
    res_csv="$(printf '%s' "$pairs" | awk -F'\t' 'NF >= 3 { printf "%s%s", s, $3; s = "," }')"
    kinds_re="$(printf '%s' "$pairs" | awk -F'\t' 'NF >= 3 { printf "%s%s", s, $1; s = "|" }')"
    rc=0; bad=0
    if [ "$deneme" -eq 0 ] && [ -n "$on_out" ] && [ -f "$on_out" ]; then
      cat "$on_out" >"$out" 2>/dev/null || true
      cat "$on_err" >"$err" 2>/dev/null || true
      rc="$(cat "$on_rc" 2>/dev/null || echo 1)"
      case "$rc" in 0) ;; *) rc=1 ;; esac
    else
      # `|| rc=1` SART: TEK bir tip dusse bile (bir tipte RBAC reddi) `oc` rc=1
      # doner. Olcut RC DEGIL "satir geldi mi" — aksi halde BASARIYLA listelenmis
      # tiplerin ciktisi da atilirdi. Ayni gerekce LogX'in cok tipli `oc get`inde.
      oc get "$res_csv" -n "$NS" --allow-missing-template-keys=true \
        -o jsonpath="$(disc_jsonpath_all)" >"$out" 2>"$err" || rc=1
    fi
    deneme=$((deneme + 1))

    # ── API'SI OLMAYAN TIP: CIKAR VE KALANLARLA TEKRAR DENE ─────────────────
    # Ust sinir obekteki tip sayisi: her turda EN AZ bir tip cikar, yoksa dongu
    # bu daldan cikmaz ve asagidaki genel geri dususe gider.
    if [ ! -s "$out" ] && [ "$rc" -ne 0 ]; then
      yok="$(disc_absent_names "$err")"
      if [ -n "$yok" ]; then
        kalan=""; cikan=0
        while IFS='	' read -r kind_name k r; do
          [ -z "$k" ] && continue
          if printf '%s\n' "$yok" | grep -qx -- "${r%%.*}"; then
            : >"$tek"
            disc_emit_kind "$k" "$r" "$tek" "yes" "$err"
            cikan=$((cikan + 1))
          else
            kalan="${kalan}${kind_name}	${k}	${r}
"
          fi
        done <<EOF_DISC_ABSENT
$pairs
EOF_DISC_ABSENT
        if [ "$cikan" -gt 0 ]; then
          pairs="$kalan"
          continue
        fi
      fi

      # ── YETKISIZ TIP: CIKAR VE KALANLARLA TEKRAR DENE ─────────────────────
      # Satirsiz + rc=1 ve API YOKLUGU degilse, sebep cogunlukla bir tipin
      # RBAC reddidir (bos bir namespace'te digerleri zaten satir basmaz).
      # Eskiden bu hal `call_failed` ile obegin TAMAMINI SIRAYLA tekil
      # cagrilara dusuruyordu (6 tip = 6 gidis-donus). Hata metni reddedilen
      # tipleri TAM adiyla soyler: onlar `no_permission` ile basilir, kalanlar
      # TEK cagriyla yeniden denenir. Tanimadigimiz bir metin gelirse (hicbir
      # tip eslesmez) asagidaki genel geri dusus AYNEN calisir.
      yasak="$(disc_forbidden_names "$err")"
      if [ -n "$yasak" ]; then
        kalan=""; cikan=0
        while IFS='	' read -r kind_name k r; do
          [ -z "$k" ] && continue
          case "$_NL$yasak$_NL" in
            *"$_NL$r$_NL"*)
              : >"$tek"
              disc_emit_kind "$k" "$r" "$tek" "yes" "$err"
              cikan=$((cikan + 1))
              ;;
            *)
              kalan="${kalan}${kind_name}	${k}	${r}
"
              ;;
          esac
        done <<EOF_DISC_FORBIDDEN
$pairs
EOF_DISC_FORBIDDEN
        if [ "$cikan" -gt 0 ]; then
          pairs="$kalan"
          continue
        fi
      fi
    fi

    # ── KENDINI DOGRULAYAN ATIF ───────────────────────────────────────────────
    # Cok tipli bir cagrida satirin tipini yalnizca `{.kind}` soyler. Bir `oc`
    # surumu TypeMeta yazmazsa alan BOS gelir ve satirlar SESSIZCE YANLIS tipe
    # yazilirdi — bu depodaki en pahali hata sinifi. O yuzden atif DOGRULANIR:
    # obege ait olmayan tek bir satir bile tekil cagrilara dusurur.
    if [ -s "$out" ]; then
      bad="$(awk -F'|' -v re="^($kinds_re)\$" 'NF >= 2 && $2 != "" && $1 !~ re { n++ } END { print n + 0 }' "$out")"
    fi

    if { [ ! -s "$out" ] && [ "$rc" -ne 0 ]; } || [ "$bad" -gt 0 ]; then
      log "$CLUSTER" "$JUMP_SERVER" "-" "-" "SCAN" "WARN" \
        "combined_fallback=yes reason=$([ "$bad" -gt 0 ] && echo unattributed_rows || echo call_failed) kinds=$(disc_val "$(printf '%s\n' "$pairs" | awk 'NF' | wc -l | tr -d ' ')") namespace=$(disc_val "$NS")"
      tekiller="$tekiller $(printf '%s\n' "$pairs" | awk -F'\t' 'NF >= 2 { printf "%s ", $2 }')"
    else
      while IFS='	' read -r kind_name k r; do
        [ -z "$k" ] && continue
        awk -F'|' -v kn="$kind_name" '$1 == kn' "$out" > "$tek"
        # OKUMA DUSTU MU: birlesik cagri rc=1 dondurduyse hangi tipin dustugunu
        # stderr soyler. `oc` hata metninde komut satirinda verilen kaynak adini
        # yazar; baska hicbir sey bunu tip bazinda soyleyemez.
        rf=no
        if [ "$rc" -ne 0 ] && [ ! -s "$tek" ] && grep -qF -- "$r" "$err" 2>/dev/null; then rf=yes; fi
        disc_emit_kind "$k" "$r" "$tek" "$rf" "$err"
      done <<EOF_DISC_PAIRS
$pairs
EOF_DISC_PAIRS
    fi
    break
  done

  # TEKIL CEKIMLER AYNI ANDA (eskiden SIRAYLA: tip basina bir gidis-donus).
  # Satirlar yine `tekiller` SIRASIYLA basilir.
  if [ -n "${tekiller// /}" ]; then
    tdir="$(mktemp -d "${WORKDIR}/.scalex_one_XXXXXX" 2>/dev/null || true)"
    if [ -n "$tdir" ]; then
      set -- $tekiller
      disc_fetch_many "$tdir" "$@"
      i=0
      for k in $tekiller; do
        disc_emit_fetched "$k" "$tdir" "$i"
        i=$((i + 1))
      done
      rm -rf "$tdir" >/dev/null 2>&1 || true
    else
      for k in $tekiller; do
        r="$(full_resource_name "$k")"
        if disc_fetch_single "$r" "$tek" "$err"; then rf=no; else rf=yes; fi
        disc_emit_kind "$k" "$r" "$tek" "$rf" "$err"
      done
    fi
  fi
  rm -f "$out" "$err" "$tek" >/dev/null 2>&1 || true
}

# ── NAMESPACE OKUMALARI + ILK TARAMA: AYNI ANDA ─────────────────────────────
#
# Dort cagri (HPA hedefleri, PDB, durum kayitlari, bilinen tiplerin birlesik
# `oc get`i) birbirinden BAGIMSIZ ve eskiden SIRAYLA kosuyordu: bastion uzerinden
# her biri ~150 ms+, namespace basina ~4 gidis-donus. Hepsi arka planda baslatilir
# ve BIRLIKTE beklenir: sure en yavasinin suresine iner.
#
# `oc auth can-i` ON KONTROLLERI KALDIRILDI (pdb, configmaps): `get` reddedilirse
# cikti zaten BOS kalir ve sonuc can-i'nin "no" dedigi hal ile BIREBIR ayni
# (PDB satiri yok, durum alanlari "-"). Kontrol bilgi eklemiyor, gidis-donus
# ekliyordu.
#
# FAIL-SAFE: gecici dizin kurulamazsa her okuma SENKRON yapilir; davranis ayni.
#
# EKSTRA CRD'LER DE BURADA: KIND'leri sabit tabloda olmadigi icin zaten TEKIL
# cekiliyorlardi — ama taramanin SONUNDA ve SIRAYLA. Artik ($2...) ayni dalgada,
# `$DISC_PF_DIR/x` altinda baslarlar; `discover_workloads` sonuclari SIRAYLA basar.
DISC_PF_DIR=""
DISC_PF_EXTRA="no"
disc_ns_prefetch() {
  local known_csv="$1" p_hpa p_pdb p_cm p_wl p_x=""
  shift
  DISC_PF_EXTRA="no"
  DISC_PF_DIR="$(mktemp -d "${WORKDIR}/.scalex_ns_XXXXXX" 2>/dev/null || true)"
  if [ -z "$DISC_PF_DIR" ]; then
    disc_load_hpa
    disc_pdb
    disc_load_states
    return 0
  fi
  oc get hpa -n "$NS" -o jsonpath='{range .items[*]}{.spec.scaleTargetRef.name}{"\n"}{end}' \
    >"$DISC_PF_DIR/hpa" 2>/dev/null &
  p_hpa=$!
  oc get pdb -n "$NS" --no-headers >"$DISC_PF_DIR/pdb" 2>/dev/null &
  p_pdb=$!
  oc get cm -n "$NS" -o jsonpath="$(disc_states_jsonpath)" >"$DISC_PF_DIR/cm" 2>/dev/null &
  p_cm=$!
  p_wl=""
  if [ -n "$known_csv" ]; then
    {
      _prc=0
      oc get "$known_csv" -n "$NS" --allow-missing-template-keys=true \
        -o jsonpath="$(disc_jsonpath_all)" >"$DISC_PF_DIR/wl" 2>"$DISC_PF_DIR/wl.err" || _prc=1
      printf '%s' "$_prc" >"$DISC_PF_DIR/wl.rc"
    } &
    p_wl=$!
  fi
  if [ "$#" -gt 0 ] && mkdir "$DISC_PF_DIR/x" 2>/dev/null; then
    disc_fetch_many "$DISC_PF_DIR/x" "$@" &
    p_x=$!
    DISC_PF_EXTRA="yes"
  fi
  wait "$p_hpa" 2>/dev/null
  wait "$p_pdb" 2>/dev/null
  wait "$p_cm" 2>/dev/null
  [ -n "$p_wl" ] && wait "$p_wl" 2>/dev/null
  [ -n "$p_x" ] && wait "$p_x" 2>/dev/null
  DISC_HPA_TARGETS="$(cat "$DISC_PF_DIR/hpa" 2>/dev/null || true)"
  disc_pdb_emit "$(cat "$DISC_PF_DIR/pdb" 2>/dev/null || true)"
  DISC_STATES="$(cat "$DISC_PF_DIR/cm" 2>/dev/null || true)"
}

disc_ns_prefetch_cleanup() {
  [ -n "$DISC_PF_DIR" ] && rm -rf "$DISC_PF_DIR" >/dev/null 2>&1
  DISC_PF_DIR=""
  DISC_PF_EXTRA="no"
}

discover_workloads() {
  local kind extra obek n=0 known_csv="" k
  # ── KRITIK YOLDA ENUMERASYON YOK ──────────────────────────────────────────
  #
  # URETIMDE OLCULDU (2026-09-30): her kesif SOGUK yolu kosuyordu (`cached=no`)
  # ve soguk yol API grubu basina bir `oc get --raw` (~50 cagri) + iki
  # `oc api-resources` demekti — cluster basina 11-15 sn. Bulunan "ekstra"
  # tiplerin hepsi ya `apps` tekrari ya da platform altyapisiydi (bkz.
  # extra_kind_filter). Yani kullanici en pahali adimi HIC BIR SEY icin
  # bekliyordu.
  #
  # Artik: bilinen alti tip HER ZAMAN, ekstra CRD'ler YALNIZCA onbellekten
  # (`SCALEX_EXTRA_KINDS`). Onbellegi portal ARKA PLANDA bir `capabilities` isiyle
  # doldurur — kullanici onu beklemez, bir sonraki kesif yeni tipi kendiliginden
  # tarar. Soguk ve sicak yol artik AYNI hizda.
  if [ -n "$EXTRA_KINDS_TEXT" ] || [ "$EXTRA_KINDS_SCANNED" = "yes" ]; then
    TIMING_CACHED="yes"
  else
    TIMING_CACHED="no"
  fi
  # Onbellek BAYAT olabilir (bu surumden once yazilmis `statefulsets.apps` gibi
  # tekrarlar): ayni suzgecten gecer.
  extra="$(printf '%s\n' "$EXTRA_KINDS_TEXT" | extra_kind_filter | sort -u)"

  for k in $DISCOVERY_KINDS; do
    if [ -z "$known_csv" ]; then known_csv="$(full_resource_name "$k")"; else known_csv="$known_csv,$(full_resource_name "$k")"; fi
  done
  TIMING_KINDS="$(printf '%s %s' "$DISCOVERY_KINDS" "$(printf '%s' "$extra" | tr '\n' ' ')" | wc -w | tr -d ' ')"

  # NAMESPACE BASINA TAZE: durum kayitlari ve HPA hedefleri her namespace icin
  # YENIDEN okunur (asagidaki cagri ikisini de kosulsuz atar). Eskiden durum
  # kayitlari bir bayrakla "bir kez" yukleniyordu ve bayrak namespace degisince
  # SIFIRLANMIYORDU: ikinci namespace ILKININ kayitlarini kullaniyordu (H5).
  # `$extra` BILEREK tirnaksiz: satir basina bir tip, bosluk icermez
  # (`extra_kind_filter` yalnizca `grup.adi` bicimini gecirir).
  # shellcheck disable=SC2086
  disc_ns_prefetch "$known_csv" $extra

  DISC_FOUND_ANY=0
  if [ -n "$DISC_PF_DIR" ] && [ -f "$DISC_PF_DIR/wl.rc" ]; then
    disc_scan_chunk "$DISCOVERY_KINDS" "$DISC_PF_DIR/wl" "$DISC_PF_DIR/wl.err" "$DISC_PF_DIR/wl.rc"
  else
    disc_scan_chunk "$DISCOVERY_KINDS"
  fi

  # Ekstra CRD'ler on-cekimde okunduysa sonuclari SIRAYLA basilir. Eski yolla
  # (asagidaki obek dongusu) AYNI satirlar: o yolda da her CRD tekil cekilir.
  if [ "$DISC_PF_EXTRA" = "yes" ]; then
    n=0
    for kind in $extra; do
      disc_emit_fetched "$kind" "$DISC_PF_DIR/x" "$n"
      n=$((n + 1))
    done
    extra=""
    n=0
  fi
  disc_ns_prefetch_cleanup

  obek=""
  for kind in $extra; do
    obek="$obek $kind"
    n=$((n + 1))
    if [ "$n" -ge "$DISC_CHUNK" ]; then
      disc_scan_chunk "$obek"
      obek=""
      n=0
    fi
  done
  [ -n "$obek" ] && disc_scan_chunk "$obek"

  if [ "$DISC_FOUND_ANY" -eq 0 ]; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "WORKLOAD" "WARN" "No workload matched namespace=$(disc_val "$NS")"
  fi
}

discover_state() {
  local cmname app kind prev phase created_at created_by jid legacy found_any=0
  if ! oc auth can-i list configmaps -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "STATE" "FAIL" "Missing permission: list configmaps namespace=$(disc_val "$NS")"
    return 0
  fi
  while IFS='|' read -r cmname app kind prev phase created_at created_by jid; do
    [ -z "$cmname" ] && continue
    legacy="no"
    case "$cmname" in
      "${STATE_CM_PREFIX}"*) ;;
      "${STATE_CM_PREFIX_LEGACY}"*) legacy="yes" ;;
      *) continue ;;
    esac
    # `data.app` bos olan eski kayitlar icin adin onekten sonraki kismi kullanilir.
    if [ -z "$app" ]; then
      if [ "$legacy" = "yes" ]; then app="${cmname#"$STATE_CM_PREFIX_LEGACY"}"; else app="${cmname#"$STATE_CM_PREFIX"}"; fi
    fi
    disc_app_wanted "$app" || continue
    found_any=1
    printf '%s' "$prev" | grep -Eq '^[0-9]+$' || prev="-"
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$(kind_to_display "${kind:--}")" "STATE" "OK" \
      "namespace=$(disc_val "$NS") cm=$(disc_val "$cmname") legacy=$legacy previous_replicas=$(disc_val "$prev") phase=$(disc_val "$phase") created_at=$(disc_val "$created_at") created_by=$(disc_val "$created_by") job_id=$(disc_val "$jid")"
  done <<EOF_DISC_STATE
$(oc get cm -n "$NS" -o jsonpath="$(disc_states_jsonpath)" 2>/dev/null || true)
EOF_DISC_STATE
  if [ "$found_any" -eq 0 ]; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "STATE" "OK" "No reversible state record found namespace=$(disc_val "$NS")"
  fi
  discover_live_probe
}

# ── CANLI REPLICA YOKLAMASI ─────────────────────────────────────────────────
#
# NEDEN VAR (2026-09-17 uretim tespiti): durum ConfigMap'i YOKSA portal bugune kadar
# "portal kaydi var, cluster'da yok — biri elle geri almis olabilir" diyordu. Bu bir
# TAHMINDI ve iki farkli gercegi ayni sekilde gosteriyordu:
#
#   * uygulama AYAKTA  → biri (ya da bizim kendi isimiz) geri almis; SORUN YOK,
#     portal kaydi anlamsiz kalmis, kapatilmali.
#   * uygulama 0'DA    → ConfigMap kaybolmus ama uygulama hala kapali; geri alma
#     bilgisi KAYIP, kullanicinin GERCEKTEN bakmasi gereken durum bu.
#
# Ayirt etmek icin CANLI replica gerekiyordu; `discover_state` yalnizca ConfigMap
# listeliyordu. Maliyet: yoklama uygulamasi basina `detect_workload` + bir
# `read_replica_state` (tek `oc get`, bkz. PR #98).
discover_live_probe() {
  local app display
  [ -z "$LIVE_PROBE_TEXT" ] && return 0
  while IFS= read -r app; do
    [ -z "$app" ] && continue
    if ! detect_workload "$app"; then
      # Tip bulunamadi: uygulama namespace'te YOK (silinmis olabilir). Bu da bir
      # CEVAP — "bakamadim" ile karistirilmasin diye ayri bir belirtec tasiyor.
      log "$CLUSTER" "$JUMP_SERVER" "$app" "-" "LIVE" "INFO" "namespace=$(disc_val "$NS") workload_absent=yes"
      continue
    fi
    display="$(kind_to_display "$DETECTED_KIND")"
    read_replica_state "$DETECTED_RESOURCE" "$app"
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "LIVE" "OK" \
      "namespace=$(disc_val "$NS") spec=$(disc_val "$RV_DESIRED") status=$(disc_val "$RV_CURRENT") ready=$(disc_val "$RV_READY")"
  done <<EOF_LIVE_PROBE
$LIVE_PROBE_TEXT
EOF_LIVE_PROBE
}

# ── SAGLIK KESFI ────────────────────────────────────────────────────────────
#
# CIKTI MAKINE-OKUNUR. Onceki hali ham `oc get` satirlarini oldugu gibi basiyordu ve
# ekran onlari birebir gosteriyordu: kullanici "merchant-info-27-qkjbw 0/1
# ContainerCreating 0 22s" ve "Missing list events permission" goruyordu. Ikincisi
# ustelik WARN seviyesindeydi, yani bir YETKI YOKLUGU ekranda HATA gibi duruyordu.
#
# Artik her satir `anahtar=deger` ciftleri tasiyor (WORKLOAD/STATE ile ayni sozlesme)
# ve portal bunlari Turkce cumleye ceviriyor. Coklu pod'lar TEK satirda birlestirilmiyor
# — her pod kendi satirini aliyor, cunku bosluklarla birlestirilmis bir liste
# ayristirilamaz.
#
# YETKI YOKLUGU `INFO`: bir uyari degil, bir bilgi. `WARN` olsaydi portalin `problems`
# listesine duser ve gercek sorunlarla ayni yerde gorunurdu.
discover_health() {
  local app display line pod ready st restarts age reason object seen
  while IFS= read -r app; do
    [ -z "$app" ] && continue
    display="-"
    if detect_workload "$app"; then display="$(kind_to_display "$DETECTED_KIND")"; fi

    if oc auth can-i list pods -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
      seen=0
      # `oc get pods --no-headers` kolonlari: NAME READY STATUS RESTARTS AGE
      while read -r pod ready st restarts age; do
        [ -z "$pod" ] && continue
        seen=$((seen + 1))
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PODS" "OK" \
          "pod=$(disc_val "$pod") ready=$(disc_val "$ready") status=$(disc_val "$st") restarts=$(disc_val "$restarts") age=$(disc_val "$age")"
      done <<EOF_PODS
$(oc get pods -n "$NS" --no-headers 2>/dev/null | grep -F "$app" | head -20 || true)
EOF_PODS
      [ "$seen" -eq 0 ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PODS" "OK" "pods=0"
    else
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "PODS" "INFO" "permission_missing=yes verb=list resource=pods"
    fi

    if oc auth can-i list events -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
      seen=0
      # `oc get events --no-headers` kolonlari: LAST-SEEN TYPE REASON OBJECT MESSAGE.
      # MESSAGE serbest metin ve bosluk icerir — ALINMAZ; `reason`/`object` zaten
      # "ne oldu" sorusunu cevapliyor ve ayrintiya AWX log'undan bakilir.
      while read -r age _type reason object _rest; do
        [ -z "$reason" ] && continue
        seen=$((seen + 1))
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "EVENTS" "WARN" \
          "reason=$(disc_val "$reason") object=$(disc_val "$object") age=$(disc_val "$age")"
      done <<EOF_EVENTS
$(oc get events -n "$NS" --field-selector type=Warning --sort-by=.lastTimestamp --no-headers 2>/dev/null | grep -F "$app" | tail -5 || true)
EOF_EVENTS
      [ "$seen" -eq 0 ] && log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "EVENTS" "OK" "events=0"
    else
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "EVENTS" "INFO" "permission_missing=yes verb=list resource=events"
    fi
  done <<EOF_DISC_HEALTH
$APPS_TEXT
EOF_DISC_HEALTH
}

# ── CLUSTER YETENEK TARAMASI (`capabilities`) ────────────────────────────────
#
# NEDEN AYRI BIR MOD: kesifteki en pahali iki kalem — API grubu sayimi
# (cluster basina ~50 `oc get --raw`) ve yetki yoklamalari — NAMESPACE'TEN,
# UYGULAMADAN ve KULLANICIDAN BAGIMSIZ. Bir operator kurulmadikca aylarca
# degismezler. Her kesifte yeniden hesaplamak saf israf.
#
# Admin bunu CLUSTER BASINA BIR KEZ kosturur; portal sonucu saklar ve kesifler
# `SCALEX_EXTRA_KINDS` ile oradan okur.
#
# BU MOD NAMESPACE ISTEMEZ ve hicbir namespace nesnesine BAKMAZ.
discover_capabilities() {
  # Bu mod onbellegi URETIR, tuketmez: enumerasyon `EXTRA_KINDS_TEXT`e hic
  # bakmaz, yani bayat bir liste kendini yeniden dogrulatamaz.
  load_cluster_resources

  local kinds n=0
  kinds="$(enumerate_extra_kinds)"
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    n=$((n + 1))
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "CAP_KIND" "OK" "kind=$(disc_val "$k")"
  done <<EOF_CAPS
$kinds
EOF_CAPS

  # OKUNAMADI ile BOS AYRI SEYLER. `oc api-resources` dusmusse liste bos gorunur
  # ama bu "cluster'da olceklenebilir CRD yok" DEMEK DEGILDIR. Portal bu ayrimi
  # gormeli: okunamamis bir tarama onbellege YAZILMAMALI, yoksa tum operator
  # nesneleri sessizce kaybolur — bu depodaki en pahali hata sinifi.
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "CAP_SUMMARY" \
    "$([ "$CLUSTER_RESOURCES_OK" = "yes" ] && echo OK || echo WARN)" \
    "kinds=$n resources_readable=$(disc_val "$CLUSTER_RESOURCES_OK")"

  # YETKI TARAMASI — bugun kesif sirasinda DAGITIK yapiliyor (`disc_pdb`,
  # `disc_load_states` her kesifte `oc auth can-i` cagiriyor). Burada TOPLU ve
  # cluster duzeyinde olculur ki ekran "hangi cluster'da neyi okuyamiyoruz"
  # sorusunu tek bakista cevaplasin.
  local res
  for res in deployments statefulsets deploymentconfigs replicasets \
             poddisruptionbudgets configmaps horizontalpodautoscalers; do
    if oc auth can-i list "$res" >/dev/null 2>&1; then
      log "$CLUSTER" "$JUMP_SERVER" "-" "-" "CAP_RBAC" "OK" "resource=$(disc_val "$res") verb=list allowed=yes"
    else
      log "$CLUSTER" "$JUMP_SERVER" "-" "-" "CAP_RBAC" "WARN" "resource=$(disc_val "$res") verb=list allowed=no"
    fi
  done
}

# SURE RAPORU — NAMESPACE BASINA BIR SATIR.
#
# `INFO`: OK/WARN/FAIL sayaclarina ve `overall_status`a KARISMAZ, `problems[]`e
# dusmez. Olcum bir ariza degildir.
#
# `setup_ms` oturum acmaya kadar geceni (AWX'ten sonraki bastion + `oc login` +
# kubeconfig) olcer ve TEK ISTEKI TUM namespace satirlarinda AYNIDIR — cunku o
# maliyet gercekten PAYLASILIR; cok namespace'e gecmenin butun kazanci zaten
# onu bir kez odemekten geliyor. `discover_ms` yalnizca O NAMESPACE'in
# taramasidir. Ikisini AYIRMAK sart: toplam sureye bakip `oc` cagrisi azaltmak,
# darbogaz login tarafindaysa hicbir sey kazandirmaz.
#
# `elapsed_ms` betigin BASINDAN o satirin basildigi ana kadar gecen SURE. Tek
# namespace'li bir iste bu `setup + discover`a esittir, yani onceki davranisla
# birebir ayni. Cok namespace'te ikinci satirin `elapsed_ms`i birincinin
# taramasini da ICERIR — bu bir hata degil, "bu is su ana kadar ne kadar surdu"
# sorusunun cevabi; namespace'in KENDI maliyeti `discover_ms`tir.
disc_timing_row() {
  local bas="$1" simdi
  simdi="$(now_ms)"
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "TIMING" "INFO" \
    "phase=discover mode=$(disc_val "$DISCOVERY_MODE") namespace=$(disc_val "${NS:-}") kinds=$(disc_val "$TIMING_KINDS") cached=$(disc_val "$TIMING_CACHED") setup_ms=$(ms_delta "$SCRIPT_START_MS" "$DISC_START_MS") discover_ms=$(ms_delta "$bas" "$simdi") elapsed_ms=$(ms_delta "$SCRIPT_START_MS" "$simdi")"
}

rc=0
if [ "$PHASE" = "discover" ]; then
  DISC_START_MS="$(now_ms)"
  if [ "$DISCOVERY_MODE" = "capabilities" ]; then
    # CLUSTER DUZEYI: namespace'e hic girmez (yukaridaki `oc project` de atlanir).
    discover_capabilities
    disc_timing_row "$DISC_START_MS"
  else
    # ── NAMESPACE DONGUSU, TEK LOGIN ─────────────────────────────────────────
    #
    # AWX sabit maliyeti (kuyruk + SSH + `oc login`) IS BASINA odenir, namespace
    # basina DEGIL. Tek iste uc namespace taramak o maliyeti UCE BOLER.
    #
    # BIR NAMESPACE'IN DUSMESI DIGERLERINI DUSURMEZ: `oc project` basarisizsa o
    # namespace icin FAIL satiri cikar ve dongu DEVAM eder. Aksi halde erisilemez
    # tek bir namespace, ayni isteki digerlerinin sonucunu da goturmus olurdu —
    # bu depoda "tek tip patlayinca hepsi gitti" olarak yasanan hata sinifi.
    _aktif_ns="$NS"
    while IFS= read -r _ns; do
      [ -z "$_ns" ] && continue
      NS="$_ns"
      # `oc project` ERISIM KANITIDIR (butun okumalar zaten `-n` ile yapiliyor;
      # var olmayan bir namespace'te `oc get` BOS doner, hata vermez). Kurulumda
      # dogrulanan namespace icin ikinci kez sorulmaz — ayni cevabin bedeli bir
      # gidis-donus. Olcut SIRA degil AD: liste o namespace ile baslamasa da dogru.
      if [ "$NS" = "$_aktif_ns" ]; then
        _aktif_ns=""
      elif ! oc project "$NS" >/dev/null 2>&1; then
        log "$CLUSTER" "$JUMP_SERVER" "-" "-" "NAMESPACE" "FAIL" \
          "Namespace/project not found or not accessible: $NS namespace=$(disc_val "$NS")"
        continue
      fi
      NS_START_MS="$(now_ms)"
      case "$DISCOVERY_MODE" in
        workloads)    discover_workloads ;;
        state)        discover_state ;;
        health)       discover_health ;;
      esac
      disc_timing_row "$NS_START_MS"
    done <<EOF_NS_LIST
$NS_LIST_TEXT
EOF_NS_LIST
  fi
elif [ "$PHASE" = "execute" ] && [ "$(normalize_lower "${SCALEX_BATCH_EXECUTE:-true}")" != "false" ]; then
  execute_batch
else
  while IFS= read -r app; do
    [ -z "$app" ] && continue
    if [ "$PHASE" = "precheck" ]; then
      precheck_app "$app" || rc=1
    else
      execute_app "$app" || rc=1
    fi
  done <<EOF_APPS
$APPS_TEXT
EOF_APPS
fi

# Business failures are represented in structured rows; keep process exit 0 so the controller can aggregate every cluster.
exit 0
