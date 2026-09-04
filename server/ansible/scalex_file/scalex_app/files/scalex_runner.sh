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
PACKAGE_VERSION="3"

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

sanitize() {
  printf '%s' "${1:-}" | tr '\n\r;' '   ' | sed 's/[[:space:]][[:space:]]*/ /g' | cut -c1-1600
}

log() {
  local cluster jump app kind step result detail
  cluster="$(sanitize "${1:-GLOBAL}")"
  jump="$(sanitize "${2:--}")"
  app="$(sanitize "${3:--}")"
  kind="$(sanitize "${4:--}")"
  step="$(sanitize "${5:-INFO}")"
  result="$(sanitize "${6:-INFO}")"
  detail="$(sanitize "${7:-}")"
  printf '%s;%s;%s;%s;%s;%s;%s\n' "$cluster" "$jump" "$app" "$kind" "$step" "$result" "$detail"
}

cleanup() {
  if [ -n "$KUBECONFIG_FILE" ]; then
    rm -f "$KUBECONFIG_FILE" >/dev/null 2>&1 || true
  fi
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
    workloads|state|health) ;;
    *) log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Unsupported DISCOVERY_MODE=$DISCOVERY_MODE"; exit 0 ;;
  esac
fi

if [ -z "$CLUSTER" ] || [ -z "$JUMP_SERVER" ] || [ -z "$API_URL" ] || [ -z "$OCP_USERNAME" ] || [ -z "$OCP_PASSWORD" ] || [ -z "$NS" ]; then
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

if ! printf '%s' "$NS" | grep -Eq '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$' || [ "$(printf '%s' "$NS" | wc -c)" -gt 63 ]; then
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "INPUT" "FAIL" "Namespace failed shell-side Kubernetes-safe validation"
  exit 0
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

APPS_TEXT="$(printf '%s\n' "$APP_RAW" | tr ',;' '\n\n' | awk '{$1=$1}; NF && !seen[$0]++ {print}')"
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
  STEP="LOGIN"; [ "$PHASE" = "execute" ] && STEP="RECHECK"
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "$STEP" "FAIL" "OpenShift login failed for configured service user"
  exit 0
fi
[ "$PHASE" = "precheck" ] && log "$CLUSTER" "$JUMP_SERVER" "-" "-" "LOGIN" "OK" "Login success"

if ! oc project "$NS" >/dev/null 2>&1; then
  STEP="NAMESPACE"; [ "$PHASE" = "execute" ] && STEP="RECHECK"
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "$STEP" "FAIL" "Namespace/project not found or not accessible: $NS"
  exit 0
fi
{ [ "$PHASE" = "precheck" ] || [ "$PHASE" = "discover" ]; } && log "$CLUSTER" "$JUMP_SERVER" "-" "-" "NAMESPACE" "OK" "Using project $NS"

# Namespace-level RBAC checks. HPA visibility is mandatory because the policy is deliberately HPA-aware/read-only.
if [ "$PHASE" = "precheck" ]; then
  _rbac_block=0
  if ! oc auth can-i list hpa -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "FAIL" "Missing permission: list horizontalpodautoscalers in namespace"
    _rbac_block=1
  else
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "OK" "HPA read permission available; HPA will remain untouched"
  fi
  if ! oc auth can-i list pods -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "WARN" "Missing list pods permission; post-operation pod reporting will be limited"
  fi
  if [ "$ACTION" = "stop" ]; then
    for _verb in get create patch; do
      if ! oc auth can-i "$_verb" configmaps -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
        log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "FAIL" "Missing ConfigMap permission: $_verb (required for reversible scale-down state)"
        _rbac_block=1
      fi
    done
  elif [ "$ACTION" = "restore" ]; then
    if ! oc auth can-i get configmaps -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
      log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "FAIL" "Missing ConfigMap get permission required for restore"
      _rbac_block=1
    fi
    _can_delete="$(oc auth can-i delete configmaps -n "$NS" 2>/dev/null || true)"
    _can_patch_cm="$(oc auth can-i patch configmaps -n "$NS" 2>/dev/null || true)"
    if ! printf '%s\n%s\n' "$_can_delete" "$_can_patch_cm" | grep -qi '^yes$'; then
      log "$CLUSTER" "$JUMP_SERVER" "-" "-" "RBAC" "FAIL" "Restore requires either delete or patch permission on ConfigMaps for state finalization"
      _rbac_block=1
    fi
  fi
  if [ "$_rbac_block" -ne 0 ]; then
    exit 0
  fi
fi

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
load_extra_scalable_resources() {
  local res group seen_groups="" gv
  [ "$CLUSTER_RESOURCES_OK" = "yes" ] || return 0
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
    gv="$(oc get --raw "/apis/$group" 2>/dev/null | tr ',' '\n' | grep -o '"groupVersion":"[^"]*"' | head -n 1 | sed 's/.*:"//;s/"//')"
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
    res="$(first_working_resource "$mapped" "$app" || true)"
    if [ -n "$res" ]; then
      DETECTED_KIND="$mapped"; DETECTED_RESOURCE="$res"; return 0
    fi
    DETECT_ERROR="not_found_as_portal_kind:$mapped"
    return 1
  fi

  if [ "$REQUESTED_KIND" != "auto" ]; then
    res="$(first_working_resource "$REQUESTED_KIND" "$app" || true)"
    if [ -n "$res" ]; then
      DETECTED_KIND="$REQUESTED_KIND"; DETECTED_RESOURCE="$res"; return 0
    fi
    DETECT_ERROR="not_found_as_requested_kind:$REQUESTED_KIND"
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
    if oc auth can-i patch "$candidate" -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
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
get_spec_replicas() { local v; v="$(oc_get_jsonpath "$1" "$2" '{.spec.replicas}')"; [ -z "$v" ] && v=0; echo "$v"; }
get_status_replicas() { local v; v="$(oc_get_jsonpath "$1" "$2" '{.status.replicas}')"; [ -z "$v" ] && v=0; echo "$v"; }
get_ready_replicas() { local v; v="$(oc_get_jsonpath "$1" "$2" '{.status.readyReplicas}')"; [ -z "$v" ] && v=0; echo "$v"; }

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
state_cm_name() {
  local app="$1" n l
  if [ -n "$_STATE_CM_APP" ] && [ "$_STATE_CM_APP" = "$app" ]; then
    printf '%s' "$_STATE_CM_NAME"; return 0
  fi
  n="${STATE_CM_PREFIX}$(safe_name "$app")"
  l="${STATE_CM_PREFIX_LEGACY}$(safe_name "$app")"
  if oc get cm "$n" -n "$NS" >/dev/null 2>&1; then
    _STATE_CM_NAME="$n"
  elif oc get cm "$l" -n "$NS" >/dev/null 2>&1; then
    _STATE_CM_NAME="$l"
  else
    _STATE_CM_NAME="$n"
  fi
  _STATE_CM_APP="$app"
  printf '%s' "$_STATE_CM_NAME"
}

# Kayit silindiginde/olusturuldugunda onbellek BAYATLAR. Silme sonrasi bayat ad,
# "hala var" yanilgisi uretirdi.
state_cm_cache_clear() { _STATE_CM_APP=""; _STATE_CM_NAME=""; }
get_cm_data() { oc get cm "$1" -n "$NS" -o "jsonpath={.data.$2}" 2>/dev/null || true; }
state_exists() { oc get cm "$(state_cm_name "$1")" -n "$NS" >/dev/null 2>&1; }
get_restore_target() {
  local cm v; cm="$(state_cm_name "$1")"; v="$(get_cm_data "$cm" previous_replicas)"
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
  prev="$(get_cm_data "$cm" previous_replicas)"
  state_app="$(get_cm_data "$cm" app)"; state_ns="$(get_cm_data "$cm" namespace)"; state_cluster="$(get_cm_data "$cm" cluster)"
  state_kind="$(get_cm_data "$cm" kind)"; state_res="$(get_cm_data "$cm" resource)"; state_phase="$(get_cm_data "$cm" phase)"; state_version="$(get_cm_data "$cm" version)"
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
  local cm; cm="$(state_cm_name "$1")"
  oc patch cm "$cm" -n "$NS" --type=merge -p "{\"data\":{\"phase\":\"scaled_down\",\"updated_at\":\"$(date -u +%FT%TZ)\"}}" >/dev/null 2>&1 || true
}
mark_state_restore_completed() {
  local cm; cm="$(state_cm_name "$1")"
  oc patch cm "$cm" -n "$NS" --type=merge -p "{\"data\":{\"phase\":\"restore_completed\",\"updated_at\":\"$(date -u +%FT%TZ)\"}}" >/dev/null 2>&1 || true
}
finalize_restore_state() {
  local app="$1" kind_display="$2" cm; cm="$(state_cm_name "$app")"
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
  exact="$(oc get hpa "$app" -n "$NS" --no-headers 2>/dev/null || true)"
  target="$(oc get hpa -n "$NS" --no-headers 2>/dev/null | awk -v app="$app" 'index($0, "/" app) > 0 {print}' || true)"
  lines="$(printf '%s\n%s\n' "$exact" "$target" | awk 'NF && !seen[$0]++')"
  if [ -n "$lines" ]; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "HPA" "INFO" "HPA_PRESENT read-only policy; left untouched: $lines"
  else
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "HPA" "INFO" "No HPA found for application/scaleTargetRef"
  fi
}
log_object_line() {
  local app="$1" display="$2" res="$3" line
  line="$(oc get "$res" "$app" -n "$NS" --no-headers 2>/dev/null || true)"
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

verify_replicas() {
  local app="$1" display="$2" res="$3" target="$4" desired current ready i
  desired=""; current=""; ready=""; i=1
  while [ "$i" -le "$WAIT_ATTEMPTS" ]; do
    desired="$(get_spec_replicas "$res" "$app")"; current="$(get_status_replicas "$res" "$app")"; ready="$(get_ready_replicas "$res" "$app")"
    [ "$desired" = "$target" ] && [ "$current" = "$target" ] && break
    sleep "$WAIT_SECONDS"; i=$((i + 1))
  done
  if [ "$desired" = "$target" ] && [ "$current" = "$target" ]; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "VERIFY" "OK" "desired=$desired current=$current ready=$ready target=$target"
    if [ "$target" != "0" ] && [ "$ready" != "$target" ]; then
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "READINESS" "INFO" "Replica change succeeded; pod readiness is still converging ready=$ready target=$target"
    fi
    return 0
  fi
  log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "VERIFY" "FAIL" "Replica verification timed out expected=$target desired=$desired current=$current ready=$ready"
  return 1
}

precheck_app() {
  local app="$1" display current cm prev
  if ! detect_workload "$app"; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "-" "PRECHECK" "FAIL" "Workload detection failed: ERROR:$DETECT_ERROR"
    return 1
  fi
  display="$(kind_to_display "$DETECTED_KIND")"; current="$(get_spec_replicas "$DETECTED_RESOURCE" "$app")"; cm="$(state_cm_name "$app")"
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

execute_app() {
  local app="$1" display current effective_target action_step cm prev
  if ! detect_workload "$app"; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "-" "RECHECK" "FAIL" "Workload detection failed immediately before mutation: ERROR:$DETECT_ERROR"
    return 1
  fi
  display="$(kind_to_display "$DETECTED_KIND")"; current="$(get_spec_replicas "$DETECTED_RESOURCE" "$app")"; cm="$(state_cm_name "$app")"
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
          verify_replicas "$app" "$display" "$DETECTED_RESOURCE" "0" || return 1
          log_object_line "$app" "$display" "$DETECTED_RESOURCE"
          log_pod_state "$app" "$display" "0"
          return 0
        fi
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "RECHECK" "FAIL" "Already replicas=0 but reversible state is missing/invalid"
        return 1
      fi
      if ! save_scale_down_state "$app" "$DETECTED_KIND" "$DETECTED_RESOURCE" "$current"; then
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "FAIL" "Failed to save previous_replicas=$current to $cm"
        return 1
      fi
      log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "OK" "Saved reversible state previous_replicas=$current cm=$cm job_id=$JOB_ID"
      ;;
    restore)
      action_step="GERI_AL"
      if ! validate_restore_state "$app" "$DETECTED_KIND" "$DETECTED_RESOURCE" "no"; then
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "RECHECK" "FAIL" "Restore state became missing/invalid before mutation"
        return 1
      fi
      effective_target="$(get_restore_target "$app" || true)"
      if [ "$current" = "$effective_target" ]; then
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "$action_step" "OK" "Already at restore target replicas=$effective_target; no patch required"
        verify_replicas "$app" "$display" "$DETECTED_RESOURCE" "$effective_target" || return 1
        finalize_restore_state "$app" "$display"
        log_object_line "$app" "$display" "$DETECTED_RESOURCE"; log_pod_state "$app" "$display" "$effective_target"
        return 0
      fi
      ;;
    scale)
      action_step="SCALE"; effective_target="$TARGET"
      if [ "$current" = "$effective_target" ]; then
        log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "$action_step" "OK" "Already at requested replicas=$effective_target; no patch required"
        verify_replicas "$app" "$display" "$DETECTED_RESOURCE" "$effective_target" || return 1
        log_object_line "$app" "$display" "$DETECTED_RESOURCE"; log_pod_state "$app" "$display" "$effective_target"
        return 0
      fi
      ;;
  esac
  log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "$action_step" "INFO" "Current replicas=$current target=$effective_target; workload spec.replicas will be patched. HPA will not be changed."
  if ! patch_replicas "$DETECTED_KIND" "$app" "$effective_target"; then
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "$action_step" "FAIL" "Patch command failed for target replicas=$effective_target"
    return 1
  fi
  log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "$action_step" "OK" "Patch accepted replicas=$effective_target.$(hpa_pin_wanted "$effective_target" && printf '%s' ' HPA will be pinned to the target.' || printf '%s' ' HPA was not changed.')"
  # HPA SABITLEME. Varsayilan davranis (bayrak kapali) DEGISMEDI: HPA okunur,
  # dokunulmaz. Bayrak acikken bile hedef 0 ise sabitleme YAPILMAZ — `minReplicas: 0`
  # ya API tarafindan reddedilir (HPAScaleToZero kapali) ya da uygulamayi 0'da
  # KILITLER, yani "geri al" hicbir seyi ayaga kaldirmaz.
  if hpa_pin_wanted "$effective_target"; then
    pin_hpa "$app" "$display" "$effective_target"
  fi
  if ! verify_replicas "$app" "$display" "$DETECTED_RESOURCE" "$effective_target"; then
    return 1
  fi
  if [ "$ACTION" = "stop" ]; then
    mark_state_scaled_down "$app"
    log "$CLUSTER" "$JUMP_SERVER" "$app" "$display" "STATE" "OK" "Marked state ConfigMap $cm as scaled_down"
  elif [ "$ACTION" = "restore" ]; then
    finalize_restore_state "$app" "$display"
  fi
  log_object_line "$app" "$display" "$DETECTED_RESOURCE"
  log_pod_state "$app" "$display" "$effective_target"
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
  local v
  v="$(printf '%s' "${1:-}" | tr -d '\n\r' | tr ' \t;' '___')"
  [ -z "$v" ] && v="-"
  printf '%s' "$v"
}

# Namespace'teki HPA hedefleri — uygulama basina `oc get hpa` yerine TEK cagri.
DISC_HPA_TARGETS=""
disc_load_hpa() {
  DISC_HPA_TARGETS="$(oc get hpa -n "$NS" -o jsonpath='{range .items[*]}{.spec.scaleTargetRef.name}{"\n"}{end}' 2>/dev/null || true)"
}
disc_has_hpa() {
  [ -z "$DISC_HPA_TARGETS" ] && { printf '%s' "no"; return 0; }
  if printf '%s\n' "$DISC_HPA_TARGETS" | grep -qx -- "$1"; then printf '%s' "yes"; else printf '%s' "no"; fi
}

# PDB namespace duzeyinde bildirilir: bir PDB'nin hangi workload'u kapsadigini
# ucuza ve dogru kanitlamak mumkun degil (selector eslesmesi gerekir). Portal da
# bunu namespace uyarisi olarak gosteriyor.
disc_pdb() {
  local lines count
  if ! oc auth can-i list poddisruptionbudgets -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    return 0
  fi
  lines="$(oc get pdb -n "$NS" --no-headers 2>/dev/null || true)"
  [ -z "$lines" ] && return 0
  count="$(printf '%s\n' "$lines" | grep -c . || true)"
  log "$CLUSTER" "$JUMP_SERVER" "-" "-" "PDB" "WARN" \
    "$(disc_val "PDB_COUNT=$count") namespace=$(disc_val "$NS") pdb=$(printf '%s\n' "$lines" | awk '{print $1}' | paste -sd, - | tr -d ' ')"
}

# Durum kaydindan (varsa) `phase` ve `previous_replicas` okur; `state_cm_name`
# eski oneki de tanidigi icin bugun durdurulmus uygulamalar da gorunur.
DISC_STATE_PHASE="-"
DISC_STATE_PREV="-"
disc_read_state() {
  local app="$1" cm
  DISC_STATE_PHASE="-"; DISC_STATE_PREV="-"
  cm="$(state_cm_name "$app")"
  oc get cm "$cm" -n "$NS" >/dev/null 2>&1 || return 0
  DISC_STATE_PHASE="$(get_cm_data "$cm" phase)"
  DISC_STATE_PREV="$(get_cm_data "$cm" previous_replicas)"
  [ -z "$DISC_STATE_PHASE" ] && DISC_STATE_PHASE="-"
  printf '%s' "$DISC_STATE_PREV" | grep -Eq '^[0-9]+$' || DISC_STATE_PREV="-"
}

# ArgoCD/operator etiketleri. ArgoCD auto-sync acikken replica 0 birkac DAKIKADA
# sessizce geri alinir — dogrula-ve-tut penceresi (saniyeler) bunu yakalayamaz,
# o yuzden kullaniciya ONCEDEN soylenmesi gerekiyor.
disc_gitops() {
  local argo="$1" managed="$2"
  if [ -n "$argo" ]; then printf 'argocd:%s' "$(disc_val "$argo")"; return 0; fi
  if [ -n "$managed" ]; then printf 'managed_by:%s' "$(disc_val "$managed")"; return 0; fi
  printf '%s' "no"
}

# Istenen uygulama listesi bosken NAMESPACE'IN TAMAMI listelenir (ekran uygulama
# adini ezberden bilmek zorunda kalmasin); doluysa yalnizca istenenler.
disc_app_wanted() {
  [ -z "$APPS_TEXT" ] && return 0
  printf '%s\n' "$APPS_TEXT" | grep -qx -- "$1"
}

# Her tip icin replica/durum alanlarini veren jsonpath. Alanlar SIRAYLA:
#   ad | istenen | mevcut | hazir | image | argocd-etiketi | managed-by-etiketi
# DaemonSet ve CronJob'un replica'si YOKTUR; onlarin karsiliklari kullanilir
# (DaemonSet: desired/ready dugum sayisi, CronJob: suspend durumu).
disc_jsonpath() {
  local argo='{.metadata.labels['"'"'argocd\.argoproj\.io/instance'"'"']}' 
  local mgd='{.metadata.labels['"'"'app\.kubernetes\.io/managed-by'"'"']}'
  case "$1" in
    ds)
      printf '%s' '{range .items[*]}{.metadata.name}{"|"}{.status.desiredNumberScheduled}{"|"}{.status.currentNumberScheduled}{"|"}{.status.numberReady}{"|"}{.spec.template.spec.containers[0].image}{"|"}'"$argo"'{"|"}'"$mgd"'{"\n"}{end}' ;;
    cronjob)
      # CronJob'un container'i `jobTemplate` altinda — digerlerinden FARKLI yol.
      printf '%s' '{range .items[*]}{.metadata.name}{"|"}{.spec.suspend}{"|"}{.spec.schedule}{"|"}{.status.active}{"|"}{.spec.jobTemplate.spec.template.spec.containers[0].image}{"|"}'"$argo"'{"|"}'"$mgd"'{"\n"}{end}' ;;
    *)
      printf '%s' '{range .items[*]}{.metadata.name}{"|"}{.spec.replicas}{"|"}{.status.replicas}{"|"}{.status.readyReplicas}{"|"}{.spec.template.spec.containers[0].image}{"|"}'"$argo"'{"|"}'"$mgd"'{"\n"}{end}' ;;
  esac
}

discover_workloads() {
  local kind res candidate name f2 f3 f4 image argo managed found_any=0 kind_count reason verb
  local full_name kinds_to_scan extra
  disc_load_hpa
  disc_pdb

  # CLUSTER NE DIYORSA O. Sabit liste iki soruyu birden cevaplayamiyordu ("bu tip
  # var mi" / "listeleyebiliyor muyum") ve cluster'da olup listemizde olmayan hicbir
  # sey gorunmuyordu. `oc api-resources` ikisini de kesinlestirir ve YETKI GEREKTIRMEZ.
  load_cluster_resources

  # Bilinen alti tip + cluster'da bulunan, `scale` alt kaynagi olan diger tipler
  # (operator CRD'leri). Ikinci kume envanter okunamadiginda BOS kalir; davranis
  # bugunku sabit listeye duser, gerilemez.
  kinds_to_scan="$DISCOVERY_KINDS"
  extra="$(load_extra_scalable_resources 2>/dev/null | awk 'NF' | sort -u || true)"
  if [ -n "$extra" ]; then
    kinds_to_scan="$kinds_to_scan $(printf '%s' "$extra" | tr '\n' ' ')"
  fi

  for kind in $kinds_to_scan; do
    res=""
    # RBAC kurallari TAM ADLA yazilir; `sts` gibi kisa adlar `oc auth can-i` tarafindan
    # guvenilir cozulmez. Hem yetki sorusu hem kullaniciya verilen cumle tam adi kullanir.
    full_name="$(full_resource_name "$kind")"
    # Tek tip patlayabilir (kapali DeploymentConfig API'si, kurulu olmayan Rollout
    # CRD'si, RBAC reddi). OLCUT "satir geldi mi" olmali; rc'ye bakmak, calisan
    # tiplerin ciktisini da atardi.
    while IFS= read -r candidate; do
      [ -z "$candidate" ] && continue
      if oc get "$candidate" -n "$NS" >/dev/null 2>&1; then res="$candidate"; break; fi
    done <<EOF_DISC_CAND
$(resource_candidates "$kind")
EOF_DISC_CAND

    # ── SESSIZ ATLAMA BITTI ─────────────────────────────────────────────────
    # Okunamayan bir tip eskiden hicbir iz birakmadan atlaniyordu: ekran
    # "StatefulSet yok" ile "StatefulSet'e bakamadim"i AYIRT EDEMIYORDU ve
    # uretimde hangisinin yasandigini kimse soyleyemiyordu. Artik her tip icin
    # bir satir cikar ve nedeni AYRILIR: yetki eksikligi kullanicinin platformdan
    # isteyecegi bir sey, API/CRD yoklugu ise hakkinda yapilacak bir sey olmayan
    # bir olgu.
    if [ -z "$res" ]; then
      verb="list"
      # ── NEDEN ARTIK TAHMIN DEGIL ───────────────────────────────────────────
      # Eskiden karar `oc auth can-i`nin BASARISINA dayaniyordu: "yes" derse
      # `api_absent`, aksi halde `no_permission`. `can-i`nin KENDISI hata verdiginde
      # (kaldirilmis DeploymentConfig API'si, kurulu olmayan Rollout CRD'si) sonuc
      # TERSINE doniyordu ve ekran kullaniciyi ASLA cozulmeyecek bir RBAC talebine
      # gonderiyordu. Artik olcut cluster'in kaynak envanteri: tip orada YOKSA
      # `api_absent`, VARSA ama okunamiyorsa `no_permission`.
      if [ "$CLUSTER_RESOURCES_OK" = "yes" ] && ! resource_exists "$full_name"; then
        reason="api_absent"
      else
        reason="no_permission"
      fi
      log "$CLUSTER" "$JUMP_SERVER" "-" "$(kind_to_display "$kind")" "WORKLOAD_KIND" "WARN" \
        "kind=$(disc_val "$kind") resource=$(disc_val "$full_name") reason=$(disc_val "$reason") verb=$(disc_val "$verb") namespace=$(disc_val "$NS")"
      continue
    fi

    kind_count=0
    while IFS='|' read -r name f2 f3 f4 image argo managed; do
      [ -z "$name" ] && continue
      disc_app_wanted "$name" || continue
      found_any=1
      kind_count=$((kind_count + 1))
      disc_read_state "$name"
      if kind_is_scalable "$kind"; then
        [ -z "$f2" ] && f2=0
        [ -z "$f3" ] && f3=0
        [ -z "$f4" ] && f4=0
        log "$CLUSTER" "$JUMP_SERVER" "$name" "$(kind_to_display "$kind")" "WORKLOAD" "OK" \
          "resource=$(disc_val "$res") scalable=yes spec=$(disc_val "$f2") status=$(disc_val "$f3") ready=$(disc_val "$f4") hpa=$(disc_has_hpa "$name") state_phase=$(disc_val "$DISC_STATE_PHASE") previous_replicas=$(disc_val "$DISC_STATE_PREV") image=$(disc_val "$image") gitops=$(disc_gitops "$argo" "$managed")"
      elif kind_is_discovered_crd "$kind"; then
        # Cluster'dan kesfedildi, `scale` alt kaynagi var — ama islem yolu bu tip icin
        # kanitlanmadi (bkz. kind_is_discovered_crd). Gorunur, secilemez.
        [ -z "$f2" ] && f2=0
        [ -z "$f4" ] && f4=0
        log "$CLUSTER" "$JUMP_SERVER" "$name" "$(kind_to_display "$kind")" "WORKLOAD" "OK" \
          "resource=$(disc_val "$res") scalable=no reason=unsupported_kind spec=$(disc_val "$f2") ready=$(disc_val "$f4") image=$(disc_val "$image") gitops=$(disc_gitops "$argo" "$managed")"
      elif [ "$kind" = "cronjob" ]; then
        # `spec.suspend` bos gelebilir (alan hic yazilmamissa) — o durumda CronJob
        # AKTIFTIR, "bilinmiyor" degil.
        [ -z "$f2" ] && f2="false"
        log "$CLUSTER" "$JUMP_SERVER" "$name" "$(kind_to_display "$kind")" "WORKLOAD" "OK" \
          "resource=$(disc_val "$res") scalable=no reason=suspend_not_replicas suspended=$(disc_val "$f2") schedule=$(disc_val "$f3") image=$(disc_val "$image") gitops=$(disc_gitops "$argo" "$managed")"
      else
        [ -z "$f2" ] && f2=0
        [ -z "$f4" ] && f4=0
        log "$CLUSTER" "$JUMP_SERVER" "$name" "$(kind_to_display "$kind")" "WORKLOAD" "OK" \
          "resource=$(disc_val "$res") scalable=no reason=node_scheduled desired=$(disc_val "$f2") ready=$(disc_val "$f4") image=$(disc_val "$image") gitops=$(disc_gitops "$argo" "$managed")"
      fi
    done <<EOF_DISC_ITEMS
$(oc get "$res" -n "$NS" -o jsonpath="$(disc_jsonpath "$kind")" 2>/dev/null || true)
EOF_DISC_ITEMS

    log "$CLUSTER" "$JUMP_SERVER" "-" "$(kind_to_display "$kind")" "WORKLOAD_KIND" "OK" \
      "kind=$(disc_val "$kind") resource=$(disc_val "$res") found=$(disc_val "$kind_count") scalable=$(kind_is_scalable "$kind" && echo yes || echo no)$(kind_is_discovered_crd "$kind" && printf ' %s' 'discovered=yes' || true)"
  done
  if [ "$found_any" -eq 0 ]; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "WORKLOAD" "WARN" "No workload matched in namespace $(disc_val "$NS")"
  fi
}

discover_state() {
  local cmname app kind prev phase created_at created_by jid legacy found_any=0
  if ! oc auth can-i list configmaps -n "$NS" 2>/dev/null | grep -qi '^yes$'; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "STATE" "FAIL" "Missing permission: list configmaps in namespace"
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
      "cm=$(disc_val "$cmname") legacy=$legacy previous_replicas=$(disc_val "$prev") phase=$(disc_val "$phase") created_at=$(disc_val "$created_at") created_by=$(disc_val "$created_by") job_id=$(disc_val "$jid")"
  done <<EOF_DISC_STATE
$(oc get cm -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.data.app}{"|"}{.data.kind}{"|"}{.data.previous_replicas}{"|"}{.data.phase}{"|"}{.data.created_at}{"|"}{.data.created_by}{"|"}{.data.job_id}{"\n"}{end}' 2>/dev/null || true)
EOF_DISC_STATE
  if [ "$found_any" -eq 0 ]; then
    log "$CLUSTER" "$JUMP_SERVER" "-" "-" "STATE" "OK" "No reversible state record found in namespace $(disc_val "$NS")"
  fi
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

rc=0
if [ "$PHASE" = "discover" ]; then
  case "$DISCOVERY_MODE" in
    workloads) discover_workloads ;;
    state)     discover_state ;;
    health)    discover_health ;;
  esac
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
